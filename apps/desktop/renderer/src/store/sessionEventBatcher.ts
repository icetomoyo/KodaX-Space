import type { SessionEvent, SpaceRuntimeCursorT } from '@kodax-space/space-ipc-schema';
import { runtimeDeltasShareSnapshotSide } from './runtimeSnapshotHydration.js';

const HIDDEN_SESSION_EVENT_FLUSH_MS = 100;

type SessionEventAppender = (event: SessionEvent) => void;
type StreamDeltaEvent = Extract<SessionEvent, { kind: 'text_delta' | 'thinking_delta' }>;

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
   * Deliver one paused Session in original event order without coalescing. The caller uses this
   * immediately before applying the snapshot whose cursor is not in the store yet.
   */
  drain(sessionId: string): void;
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

function mergeAdjacentStreamDeltas(
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
      runtimeDeltasShareSnapshotSide(previous, event, snapshotCursor(event.sessionId)) &&
      previous.text.length + event.text.length <= 256 * 1024
    ) {
      merged[merged.length - 1] = { ...event, text: previous.text + event.text };
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
    for (const event of mergeAdjacentStreamDeltas(ready, snapshotCursor)) {
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
    drain(sessionId) {
      const drained = queue.filter((event) => event.sessionId === sessionId);
      queue = queue.filter((event) => event.sessionId !== sessionId);
      for (const event of drained) appendEvent(event);
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
