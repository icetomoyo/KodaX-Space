import type { SessionEvent, SpaceRuntimeCursorT } from '@kodax-space/space-ipc-schema';
import { runtimeDeltasShareSnapshotSide } from './runtimeSnapshotHydration.js';

const HIDDEN_SESSION_EVENT_FLUSH_MS = 100;
const MAX_MERGED_EVENT_TEXT = 256 * 1024;

type SessionEventAppender = (event: SessionEvent) => void;
type StreamDeltaEvent = Extract<SessionEvent, { kind: 'text_delta' | 'thinking_delta' }>;
type ToolInputDeltaEvent = Extract<SessionEvent, { kind: 'tool_input_delta' }>;
type ToolProgressEvent = Extract<SessionEvent, { kind: 'tool_progress' }>;

export interface SessionEventBatchScheduler {
  readonly isBackground: () => boolean;
  readonly requestFrame: (callback: () => void) => number;
  readonly cancelFrame: (id: number) => void;
  readonly setTimer: (callback: () => void, delayMs: number) => number;
  readonly clearTimer: (id: number) => void;
}

export interface SessionEventBatcher {
  push(event: SessionEvent): void;
  flush(): void;
  pause(sessionId: string): void;
  /**
   * Deliver one paused Session in original structural order. Adjacent stream fragments may be
   * coalesced only when they stay on the same side of the supplied incoming snapshot barrier.
   */
  drain(sessionId: string, incomingSnapshotCursor?: SnapshotEventBarrierCursor): void;
  resume(sessionId: string): void;
  dispose(): void;
}

type SnapshotEventBarrierCursor = SpaceRuntimeCursorT & {
  readonly runId?: string;
  readonly assistantDraftSeq?: number;
  readonly thinkingDraftSeq?: number;
};

function browserScheduler(): SessionEventBatchScheduler {
  return {
    isBackground: () => document.hidden || !document.hasFocus(),
    requestFrame: (callback) => window.requestAnimationFrame(callback),
    cancelFrame: (id) => window.cancelAnimationFrame(id),
    setTimer: (callback, delayMs) => window.setTimeout(callback, delayMs),
    clearTimer: (id) => window.clearTimeout(id),
  };
}

function isStreamDeltaEvent(event: SessionEvent): event is StreamDeltaEvent {
  return event.kind === 'text_delta' || event.kind === 'thinking_delta';
}

function runtimeOriginsMatch(previous: SessionEvent, event: SessionEvent): boolean {
  const previousOrigin = 'runtimeEvent' in previous ? previous.runtimeEvent : undefined;
  const eventOrigin = 'runtimeEvent' in event ? event.runtimeEvent : undefined;
  if (previousOrigin === undefined || eventOrigin === undefined) {
    return previousOrigin === undefined && eventOrigin === undefined;
  }
  return (
    previousOrigin.runtimeId === eventOrigin.runtimeId &&
    previousOrigin.runId === eventOrigin.runId &&
    previousOrigin.journalEpoch === eventOrigin.journalEpoch
  );
}

function runtimeSequenceIsContinuous(previous: SessionEvent, event: SessionEvent): boolean {
  const previousOrigin = 'runtimeEvent' in previous ? previous.runtimeEvent : undefined;
  const eventOrigin = 'runtimeEvent' in event ? event.runtimeEvent : undefined;
  if (previousOrigin === undefined || eventOrigin === undefined) {
    return previousOrigin === undefined && eventOrigin === undefined;
  }
  return runtimeOriginsMatch(previous, event) && eventOrigin.seq === previousOrigin.seq + 1;
}

function isToolInputDeltaEvent(event: SessionEvent): event is ToolInputDeltaEvent {
  return event.kind === 'tool_input_delta';
}

function isToolProgressEvent(event: SessionEvent): event is ToolProgressEvent {
  return event.kind === 'tool_progress';
}

function mergeAdjacentSessionEvents(
  events: readonly SessionEvent[],
  snapshotCursor: (sessionId: string) => SnapshotEventBarrierCursor | undefined,
): SessionEvent[] {
  const merged: SessionEvent[] = [];
  for (const event of events) {
    const previous = merged.at(-1);
    if (
      previous !== undefined &&
      isStreamDeltaEvent(previous) &&
      isStreamDeltaEvent(event) &&
      previous.sessionId === event.sessionId &&
      previous.kind === event.kind &&
      runtimeSequenceIsContinuous(previous, event) &&
      runtimeDeltasShareSnapshotSide(previous, event, snapshotCursor(event.sessionId)) &&
      previous.text.length + event.text.length <= MAX_MERGED_EVENT_TEXT
    ) {
      merged[merged.length - 1] = {
        ...event,
        text: previous.text + event.text,
        sentAt: previous.sentAt ?? event.sentAt,
      };
    } else if (
      previous !== undefined &&
      isToolInputDeltaEvent(previous) &&
      isToolInputDeltaEvent(event) &&
      previous.sessionId === event.sessionId &&
      previous.toolId !== undefined &&
      previous.toolId === event.toolId &&
      previous.toolName === event.toolName &&
      runtimeSequenceIsContinuous(previous, event) &&
      previous.partialJson.length + event.partialJson.length <= MAX_MERGED_EVENT_TEXT
    ) {
      merged[merged.length - 1] = {
        ...event,
        partialJson: previous.partialJson + event.partialJson,
      };
    } else if (
      previous !== undefined &&
      isToolProgressEvent(previous) &&
      isToolProgressEvent(event) &&
      previous.sessionId === event.sessionId &&
      previous.toolId === event.toolId &&
      runtimeOriginsMatch(previous, event)
    ) {
      // Progress is a latest-value UI projection. Intermediate adjacent values carry no durable
      // transcript meaning, while retaining only the newest value bounds render work.
      merged[merged.length - 1] = event;
    } else {
      merged.push(event);
    }
  }
  return merged;
}

export function createSessionEventBatcher(
  appendEvent: SessionEventAppender,
  options: {
    readonly snapshotCursor?: (sessionId: string) => SnapshotEventBarrierCursor | undefined;
    readonly scheduler?: SessionEventBatchScheduler;
  } = {},
): SessionEventBatcher {
  const scheduler = options.scheduler ?? browserScheduler();
  const snapshotCursor = options.snapshotCursor ?? (() => undefined);
  let queue: SessionEvent[] = [];
  let frameId: number | null = null;
  let timerId: number | null = null;
  const pausedSessionIds = new Set<string>();

  const clearScheduled = (): void => {
    if (frameId !== null) {
      scheduler.cancelFrame(frameId);
      frameId = null;
    }
    if (timerId !== null) {
      scheduler.clearTimer(timerId);
      timerId = null;
    }
  };

  const flush = (): void => {
    clearScheduled();
    if (queue.length === 0) return;
    const ready = queue.filter((event) => !pausedSessionIds.has(event.sessionId));
    queue = queue.filter((event) => pausedSessionIds.has(event.sessionId));
    if (ready.length === 0) return;
    for (const event of mergeAdjacentSessionEvents(ready, snapshotCursor)) {
      appendEvent(event);
    }
  };

  const schedule = (): void => {
    if (frameId !== null || timerId !== null) return;
    if (!queue.some((event) => !pausedSessionIds.has(event.sessionId))) return;
    if (scheduler.isBackground()) {
      timerId = scheduler.setTimer(flush, HIDDEN_SESSION_EVENT_FLUSH_MS);
      return;
    }
    frameId = scheduler.requestFrame(flush);
  };

  return {
    push(event) {
      queue.push(event);
      schedule();
    },
    flush,
    pause(sessionId) {
      pausedSessionIds.add(sessionId);
    },
    drain(sessionId, incomingSnapshotCursor) {
      const drained = queue.filter((event) => event.sessionId === sessionId);
      queue = queue.filter((event) => event.sessionId !== sessionId);
      const cursorForDrain = (
        candidateSessionId: string,
      ): SnapshotEventBarrierCursor | undefined =>
        candidateSessionId === sessionId && incomingSnapshotCursor !== undefined
          ? incomingSnapshotCursor
          : snapshotCursor(candidateSessionId);
      for (const event of mergeAdjacentSessionEvents(drained, cursorForDrain)) appendEvent(event);
    },
    resume(sessionId) {
      pausedSessionIds.delete(sessionId);
      schedule();
    },
    dispose() {
      clearScheduled();
      queue = [];
      pausedSessionIds.clear();
    },
  };
}
