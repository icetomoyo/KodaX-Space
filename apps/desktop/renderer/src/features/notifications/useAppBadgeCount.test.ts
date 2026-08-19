import assert from 'node:assert/strict';
import test from 'node:test';

import { subscribeAppBadgeCount, type AppBadgeStoreState } from './useAppBadgeCount.js';

test('badge subscription sends the initial count and only observable count changes', () => {
  const listeners = new Set<(state: AppBadgeStoreState, previous: AppBadgeStoreState) => void>();
  let state: AppBadgeStoreState = {
    sessionFlags: { unread: { unread: true } },
    permissionQueue: [],
    askUserQueue: [],
  };
  const store = {
    getState: () => state,
    subscribe: (listener: (next: AppBadgeStoreState, previous: AppBadgeStoreState) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  const counts: number[] = [];
  const unsubscribe = subscribeAppBadgeCount(store, (count) => counts.push(count));
  assert.deepEqual(counts, [1]);

  const publish = (next: AppBadgeStoreState): void => {
    const previous = state;
    state = next;
    for (const listener of listeners) listener(next, previous);
  };

  publish({ ...state });
  publish({ ...state, permissionQueue: [{ sessionId: 'unread' }] });
  publish({ ...state, askUserQueue: [{ sessionId: 'question' }] });
  assert.deepEqual(counts, [1, 2]);

  publish({ ...state, askUserQueue: [] });
  publish({ ...state, sessionFlags: {}, permissionQueue: [] });
  assert.deepEqual(counts, [1, 2, 1, 0]);

  unsubscribe();
  publish({ ...state, askUserQueue: [{ sessionId: 'ignored-after-cleanup' }] });
  assert.deepEqual(counts, [1, 2, 1, 0]);
});

test('badge subscription clamps the count to the IPC contract maximum', () => {
  const sessionFlags = Object.fromEntries(
    Array.from({ length: 10_001 }, (_, index) => [`session-${index}`, { unread: true }]),
  );
  const counts: number[] = [];

  subscribeAppBadgeCount(
    {
      getState: () => ({ sessionFlags, permissionQueue: [], askUserQueue: [] }),
      subscribe: () => () => undefined,
    },
    (count) => counts.push(count),
  );

  assert.deepEqual(counts, [9999]);
});
