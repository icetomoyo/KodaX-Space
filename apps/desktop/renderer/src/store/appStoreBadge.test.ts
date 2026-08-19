import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';

import { useAppStore } from './appStore.js';

const session = (sessionId: string) => ({
  sessionId,
  projectRoot: 'C:\\project',
  provider: 'mock',
  reasoningMode: 'auto' as const,
  permissionMode: 'accept-edits' as const,
  autoModeEngine: 'llm' as const,
  agentMode: 'ama' as const,
  surface: 'code' as const,
  createdAt: 1,
  lastActivityAt: 1,
});

beforeEach(() => {
  useAppStore.setState({
    currentSessionId: 'visible',
    sessions: ['visible', 'completed', 'failed', 'cancelled'].map(session),
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

  const flags = useAppStore.getState().sessionFlags;
  assert.equal(flags.completed?.unread, true);
  assert.equal(flags.failed?.unread, true);
  assert.equal(flags.cancelled?.unread, undefined);
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
