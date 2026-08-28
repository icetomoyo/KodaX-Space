import { useEffect, useRef } from 'react';
import { useAppStore } from '../../store/appStore.js';
import {
  completionTerminalMatchesPrompt,
  formatElapsed,
  isFreshLivePromptStart,
  liveStartMatchesPromptRun,
  shouldNotifyForCompletion,
  type CompletionFocusSnapshot,
  type CompletionPromptOwner,
} from './sessionCompleteNotificationModel.js';
import { isCancelledSessionError } from '../session/sessionError.js';

type ActivePromptRecord = CompletionPromptOwner;

interface SessionLite {
  readonly sessionId: string;
  readonly title?: string;
}

/**
 * Native OS completion notifications are intentionally driven by live session_start events.
 * Restored history can contain terminal events with old user-message timestamps; without a
 * live start marker those events must never create a new toast.
 */
export function useSessionCompleteNotification(): void {
  const nativeEnabled = useAppStore((s) => s.nativeCompletionNotificationsEnabled);

  const activePromptRef = useRef<Map<string, ActivePromptRecord>>(new Map());
  const notifiedTerminalRef = useRef<Set<string>>(new Set());
  const nativeEnabledRef = useRef(nativeEnabled);

  useEffect(() => {
    nativeEnabledRef.current = nativeEnabled;
  }, [nativeEnabled]);

  useEffect(() => {
    return useAppStore.subscribe((state, previousState) => {
      const event = state.lastEvent;
      if (!event || event === previousState.lastEvent) return;
      const sessionId = event.sessionId;

      if (event.kind === 'session_start') {
        const livePromptStart = getLivePromptStart(state, sessionId, event);
        if (livePromptStart) {
          activePromptRef.current.set(sessionId, livePromptStart);
        }
        return;
      }

      if (event.kind !== 'session_complete' && event.kind !== 'session_error') return;
      const activePrompt = activePromptRef.current.get(sessionId);
      if (
        !activePrompt ||
        !completionTerminalMatchesPrompt(activePrompt, {
          runtimeId: event.runtimeEvent?.runtimeId,
          runId: event.runtimeEvent?.runId,
          turnId: event.turnId,
        })
      ) {
        return;
      }
      if (isCancelledSessionError(event)) {
        activePromptRef.current.delete(sessionId);
        return;
      }

      activePromptRef.current.delete(sessionId);
      const terminalKey = `${sessionId}:${activePrompt.runId ?? activePrompt.userMessageId}:${activePrompt.turnId ?? activePrompt.startedAt}:${event.kind}`;
      if (notifiedTerminalRef.current.has(terminalKey)) return;
      rememberTerminalNotification(notifiedTerminalRef.current, terminalKey);

      void maybeNotify({
        sessionId,
        outcome: event.kind === 'session_complete' ? 'complete' : 'error',
        startedAt: activePrompt.startedAt,
        sessions: state.sessions,
        nativeEnabled: nativeEnabledRef.current,
      });
    });
  }, []);
}

function getLivePromptStart(
  state: ReturnType<typeof useAppStore.getState>,
  sessionId: string,
  event: Extract<
    NonNullable<ReturnType<typeof useAppStore.getState>['lastEvent']>,
    { kind: 'session_start' }
  >,
): ActivePromptRecord | null {
  const messages = state.userMessagesBySession[sessionId] ?? [];
  const last = messages[messages.length - 1];
  if (last?.sentAt && isFreshLivePromptStart(last.sentAt)) {
    const runId = event.runtimeEvent?.runId;
    if (!liveStartMatchesPromptRun(last.runtimeRunId, runId)) {
      return null;
    }
    return {
      userMessageId: last.id,
      startedAt: last.sentAt,
      ...(event.runtimeEvent?.runtimeId !== undefined
        ? { runtimeId: event.runtimeEvent.runtimeId }
        : {}),
      ...(runId !== undefined ? { runId } : {}),
      ...((event.turnId ?? last.turnId) !== undefined
        ? { turnId: event.turnId ?? last.turnId }
        : {}),
    };
  }
  return null;
}

function rememberTerminalNotification(keys: Set<string>, key: string): void {
  keys.add(key);
  if (keys.size <= 200) return;
  const oldest = keys.values().next().value;
  if (typeof oldest === 'string') keys.delete(oldest);
}

async function maybeNotify(input: {
  readonly sessionId: string;
  readonly outcome: 'complete' | 'error';
  readonly startedAt: number;
  readonly sessions: ReadonlyArray<SessionLite>;
  readonly nativeEnabled: boolean;
}): Promise<void> {
  const now = Date.now();
  if (!shouldNotifyForCompletion({ startedAt: input.startedAt, now, focus: getFocusSnapshot() })) {
    return;
  }

  const session = input.sessions.find((s) => s.sessionId === input.sessionId);
  const title = session?.title ?? 'KodaX Space';
  const elapsedLabel = formatElapsed(now - input.startedAt);
  const body =
    input.outcome === 'complete'
      ? `Session done - ${elapsedLabel}`
      : `Session failed - ${elapsedLabel}`;

  useAppStore.getState().pushNotification({
    id: `session-terminal:${input.sessionId}:${input.startedAt}:${input.outcome}`,
    severity: input.outcome === 'complete' ? 'info' : 'error',
    text:
      input.outcome === 'complete'
        ? `Session done: ${title} (${elapsedLabel})`
        : `Session failed: ${title} (${elapsedLabel})`,
    sessionId: input.sessionId,
    createdAt: now,
    dismissOnOutsideInteraction: true,
  });

  if (!input.nativeEnabled || !window.kodaxSpace) return;

  await window.kodaxSpace
    .invoke('notification.show', {
      title,
      body,
      sessionId: input.sessionId,
      silent: false,
    })
    .catch(() => {
      // The in-app notification above remains dismissible even if the OS toast fails.
    });
}

function getFocusSnapshot(): CompletionFocusSnapshot {
  if (typeof document === 'undefined') return { hidden: false, focused: true };
  return { hidden: document.hidden, focused: document.hasFocus() };
}
