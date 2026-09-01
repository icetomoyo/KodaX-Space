import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';

import { useAppStore } from './appStore.js';

const session = (sessionId: string) => ({
  sessionId,
  projectRoot: 'C:\\project',
  provider: 'mock',
  reasoningMode: 'auto' as const,
  permissionMode: 'accept-edits' as const,
  agentMode: 'ama' as const,
  surface: 'code' as const,
  createdAt: 1,
  lastActivityAt: 1,
});

beforeEach(() => {
  useAppStore.setState({
    currentSessionId: 'visible',
    sessions: [
      'visible',
      'completed',
      'failed',
      'cancelled',
      'structured-cancelled',
      'provider-aborted',
    ].map(session),
    sessionFlags: {},
    eventsBySession: {},
    managedTaskStatusBySession: {},
  });
});

test('background completion and failure mark a Session unread, but cancellation does not', () => {
  const store = useAppStore.getState();
  store.appendEvent({ kind: 'session_complete', sessionId: 'completed' });
  store.appendEvent({ kind: 'session_error', sessionId: 'failed', error: 'provider failed' });
  store.appendEvent({ kind: 'session_error', sessionId: 'cancelled', error: 'cancelled' });
  store.appendEvent({
    kind: 'session_error',
    sessionId: 'structured-cancelled',
    error: 'Runtime run was cancelled by the user.',
    category: 'cancelled',
  });

  const flags = useAppStore.getState().sessionFlags;
  assert.equal(flags.completed?.unread, true);
  assert.equal(flags.failed?.unread, true);
  assert.equal(flags.cancelled?.unread, undefined);
  assert.equal(flags['structured-cancelled']?.unread, undefined);
});

test('structured cancellation deduplicates and clears non-failed queued prompts', () => {
  useAppStore.setState({
    queuedUserMessagesBySession: {
      'structured-cancelled': [
        {
          id: 'queued_pending',
          content: 'pending',
          matchContent: 'pending',
          queueMode: 'after-turn',
          status: 'queued',
          sentAt: 1,
        },
        {
          id: 'queued_failed',
          content: 'failed',
          matchContent: 'failed',
          queueMode: 'after-turn',
          status: 'failed',
          sentAt: 2,
        },
      ],
    },
  });
  const cancellation = {
    kind: 'session_error',
    sessionId: 'structured-cancelled',
    error: 'Runtime run was cancelled by the user.',
    category: 'cancelled',
  } as const;

  useAppStore.getState().appendEvent(cancellation);
  useAppStore.getState().appendEvent(cancellation);

  assert.equal(useAppStore.getState().eventsBySession['structured-cancelled']?.length, 1);
  assert.deepEqual(
    useAppStore.getState().queuedUserMessagesBySession['structured-cancelled']?.map(({ id }) => id),
    ['queued_failed'],
  );
});

test('provider-side abort remains a visible failure and preserves queued prompts', () => {
  useAppStore.setState({
    queuedUserMessagesBySession: {
      'provider-aborted': [
        {
          id: 'queued_after_abort',
          content: 'continue after provider abort',
          matchContent: 'continue after provider abort',
          queueMode: 'after-turn',
          status: 'queued',
          sentAt: 1,
        },
      ],
    },
  });

  useAppStore.getState().appendEvent({
    kind: 'session_error',
    sessionId: 'provider-aborted',
    error: 'Provider request was aborted.',
    failureKind: 'provider_aborted',
    category: 'cancelled',
  });

  assert.equal(useAppStore.getState().sessionFlags['provider-aborted']?.unread, true);
  assert.deepEqual(
    useAppStore.getState().queuedUserMessagesBySession['provider-aborted']?.map(({ id }) => id),
    ['queued_after_abort'],
  );
});

test('a terminal result in the focused Session remains read', () => {
  const store = useAppStore.getState();
  store.appendEvent({ kind: 'session_error', sessionId: 'visible', error: 'provider failed' });
  assert.equal(useAppStore.getState().sessionFlags.visible?.unread, undefined);
});

test('opening a background Session clears its terminal-result attention state', () => {
  useAppStore.getState().appendEvent({ kind: 'session_complete', sessionId: 'completed' });
  assert.equal(useAppStore.getState().sessionFlags.completed?.unread, true);

  useAppStore.getState().setCurrentSession('completed');
  assert.equal(useAppStore.getState().sessionFlags.completed?.unread, undefined);
});
