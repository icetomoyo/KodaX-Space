import assert from 'node:assert/strict';
import test from 'node:test';

import { runSerializedSessionHistoryOperation } from '../ipc/session.js';

function deferred(): { readonly promise: Promise<void>; readonly resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

test('history operations are single-writer within one Session', async () => {
  const firstGate = deferred();
  const order: string[] = [];
  const first = runSerializedSessionHistoryOperation('session-a', async () => {
    order.push('first:start');
    await firstGate.promise;
    order.push('first:end');
    return 'first';
  });
  const second = runSerializedSessionHistoryOperation('session-a', async () => {
    order.push('second:start');
    order.push('second:end');
    return 'second';
  });

  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.deepEqual(order, ['first:start']);
  firstGate.resolve();
  assert.deepEqual(await Promise.all([first, second]), ['first', 'second']);
  assert.deepEqual(order, ['first:start', 'first:end', 'second:start', 'second:end']);
});

test('history operations for different Sessions remain parallel', async () => {
  const gate = deferred();
  const started = new Set<string>();
  const first = runSerializedSessionHistoryOperation('session-parallel-a', async () => {
    started.add('a');
    await gate.promise;
  });
  const second = runSerializedSessionHistoryOperation('session-parallel-b', async () => {
    started.add('b');
    await gate.promise;
  });

  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.deepEqual([...started].sort(), ['a', 'b']);
  gate.resolve();
  await Promise.all([first, second]);
});

test('a failed history operation releases the same-Session writer queue', async () => {
  const failure = runSerializedSessionHistoryOperation('session-after-failure', async () => {
    throw new Error('expected history read failure');
  });
  const successor = runSerializedSessionHistoryOperation(
    'session-after-failure',
    async () => 'success',
  );

  await assert.rejects(failure, /expected history read failure/);
  assert.equal(await successor, 'success');
});
