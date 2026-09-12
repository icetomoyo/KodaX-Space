import assert from 'node:assert/strict';
import test from 'node:test';
import { readPendingSessionStops, writePendingSessionStops } from './pendingSessionStop.js';

test('pending Stop survives UI reload with its original Session, Run and request binding', () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
  const pending = { sessionId: 'session-1', runId: 'original-run', requestId: 'original-request' };
  writePendingSessionStops(storage, { 'original-request': pending });
  assert.deepEqual(readPendingSessionStops(storage)['original-request'], pending);
  const second = { ...pending, runId: 'later-run', requestId: 'later-request' };
  writePendingSessionStops(storage, {
    ...readPendingSessionStops(storage),
    'later-request': second,
  });
  const records = readPendingSessionStops(storage);
  delete records['later-request'];
  writePendingSessionStops(storage, records);
  assert.deepEqual(readPendingSessionStops(storage)['original-request'], pending);
  writePendingSessionStops(storage, {});
  assert.deepEqual(readPendingSessionStops(storage), {});
});
