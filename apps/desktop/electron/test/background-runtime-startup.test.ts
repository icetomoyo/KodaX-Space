import assert from 'node:assert/strict';
import { test } from 'node:test';

import { startBackgroundRuntimeInitialization } from '../kodax/background-runtime-startup.js';

test('background Runtime initialization starts immediately without settling the caller startup', async () => {
  let release!: () => void;
  let initializeCalls = 0;
  let readyCalls = 0;
  const initialization = new Promise<void>((resolve) => {
    release = resolve;
  });

  const ready = startBackgroundRuntimeInitialization({
    initialize: () => {
      initializeCalls += 1;
      return initialization;
    },
    onReady: () => {
      readyCalls += 1;
    },
  });

  assert.equal(initializeCalls, 1);
  assert.equal(readyCalls, 0);

  let settled = false;
  void ready.then(() => {
    settled = true;
  });
  await Promise.resolve();
  assert.equal(settled, false);

  release();
  assert.equal(await ready, true);
  assert.equal(readyCalls, 1);
});

test('background Runtime initialization contains asynchronous failures', async () => {
  const failure = new Error('daemon unavailable');
  let observed: unknown;

  const ready = await startBackgroundRuntimeInitialization({
    initialize: () => Promise.reject(failure),
    onFailure: (error) => {
      observed = error;
    },
  });

  assert.equal(ready, false);
  assert.equal(observed, failure);
});

test('background Runtime initialization contains synchronous setup failures', async () => {
  const failure = new Error('invalid startup state');
  let observed: unknown;

  const ready = await startBackgroundRuntimeInitialization({
    initialize: () => {
      throw failure;
    },
    onFailure: (error) => {
      observed = error;
    },
  });

  assert.equal(ready, false);
  assert.equal(observed, failure);
});

test('background Runtime observers cannot change readiness or reject the tracked task', async () => {
  assert.equal(
    await startBackgroundRuntimeInitialization({
      initialize: () => Promise.resolve(),
      onReady: () => {
        throw new Error('diagnostic refresh failed');
      },
    }),
    true,
  );

  assert.equal(
    await startBackgroundRuntimeInitialization({
      initialize: () => Promise.reject(new Error('daemon unavailable')),
      onFailure: () => {
        throw new Error('failure logger failed');
      },
    }),
    false,
  );
});
