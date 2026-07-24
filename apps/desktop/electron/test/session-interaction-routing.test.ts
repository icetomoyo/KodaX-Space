import assert from 'node:assert/strict';
import test from 'node:test';
import {
  interactionsForSession,
  prioritizeAttentionItems,
} from '../../renderer/src/features/session/sessionInteractionRouting.js';

interface RequestStub {
  readonly reqId: string;
  readonly sessionId: string;
}

test('interactionsForSession exposes only the active Session without mutating the durable queue', () => {
  const queue: readonly RequestStub[] = [
    { reqId: 'background-1', sessionId: 'session-b' },
    { reqId: 'active-1', sessionId: 'session-a' },
    { reqId: 'background-2', sessionId: 'session-b' },
    { reqId: 'active-2', sessionId: 'session-a' },
  ];

  const visible = interactionsForSession(queue, 'session-a');

  assert.deepEqual(
    visible.map((request) => request.reqId),
    ['active-1', 'active-2'],
  );
  assert.equal(queue.length, 4);
  assert.equal(queue[0]?.reqId, 'background-1');
});

test('interactionsForSession hides every modal when no conversation Session is active', () => {
  const queue: readonly RequestStub[] = [{ reqId: 'request-1', sessionId: 'session-a' }];

  assert.deepEqual(interactionsForSession(queue, null), []);
});

interface SessionStub {
  readonly id: string;
  readonly awaiting?: boolean;
}

const sessionId = (session: SessionStub): string => session.id;
const isAwaiting = (session: SessionStub): boolean => session.awaiting === true;

test('prioritizeAttentionItems keeps the selected Session first and surfaces waiting Sessions', () => {
  const sessions: readonly SessionStub[] = [
    { id: 'a' },
    { id: 'b', awaiting: true },
    { id: 'c' },
    { id: 'd', awaiting: true },
    { id: 'e' },
    { id: 'selected' },
  ];

  const visible = prioritizeAttentionItems(sessions, {
    maxVisible: 3,
    currentId: 'selected',
    getId: sessionId,
    isAwaiting,
  });

  assert.deepEqual(
    visible.map((session) => session.id),
    ['selected', 'b', 'd'],
  );
});

test('prioritizeAttentionItems preserves a visible prefix when all attention items are already visible', () => {
  const sessions: readonly SessionStub[] = [
    { id: 'a' },
    { id: 'selected', awaiting: true },
    { id: 'b', awaiting: true },
    { id: 'c' },
  ];

  const visible = prioritizeAttentionItems(sessions, {
    maxVisible: 3,
    currentId: 'selected',
    getId: sessionId,
    isAwaiting,
  });

  assert.deepEqual(
    visible.map((session) => session.id),
    ['a', 'selected', 'b'],
  );
});

test('prioritizeAttentionItems preserves the original list when no cap is exceeded', () => {
  const sessions: readonly SessionStub[] = [{ id: 'a' }, { id: 'b', awaiting: true }];

  const visible = prioritizeAttentionItems(sessions, {
    maxVisible: 5,
    currentId: 'b',
    getId: sessionId,
    isAwaiting,
  });

  assert.equal(visible, sessions);
});

test('prioritizeAttentionItems supports an empty visible cap', () => {
  const sessions: readonly SessionStub[] = [{ id: 'a', awaiting: true }];

  assert.deepEqual(
    prioritizeAttentionItems(sessions, {
      maxVisible: 0,
      currentId: 'a',
      getId: sessionId,
      isAwaiting,
    }),
    [],
  );
});
