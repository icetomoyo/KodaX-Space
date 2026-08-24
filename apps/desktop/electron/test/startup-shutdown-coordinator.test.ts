import assert from 'node:assert/strict';
import { test } from 'node:test';

import { StartupShutdownCoordinator } from '../window/startup-shutdown-coordinator.js';

test('shutdown waits for an in-progress startup before beginning disposal', async () => {
  const coordinator = new StartupShutdownCoordinator();
  let releaseStartup!: () => void;
  const startup = new Promise<void>((resolve) => {
    releaseStartup = resolve;
  });
  coordinator.setStartupPromise(startup);
  coordinator.requestShutdown();

  let disposalStarted = false;
  const disposal = coordinator.disposeAfterStartup(() => {
    disposalStarted = true;
    return [Promise.resolve()];
  });

  await Promise.resolve();
  assert.equal(coordinator.isShutdownRequested(), true);
  assert.equal(disposalStarted, false);

  releaseStartup();
  const results = await disposal;
  assert.equal(disposalStarted, true);
  assert.equal(results[0]?.status, 'fulfilled');
});

test('startup failure still releases bounded shutdown disposal', async () => {
  const coordinator = new StartupShutdownCoordinator();
  coordinator.setStartupPromise(Promise.reject(new Error('startup failed')));

  let disposalStarted = false;
  await coordinator.disposeAfterStartup(() => {
    disposalStarted = true;
    return [];
  });

  assert.equal(disposalStarted, true);
});

test('shutdown also waits for non-blocking work launched during startup', async () => {
  const coordinator = new StartupShutdownCoordinator();
  let releaseBackgroundTask!: () => void;
  const backgroundTask = new Promise<void>((resolve) => {
    releaseBackgroundTask = resolve;
  });
  coordinator.trackStartupTask(backgroundTask);
  coordinator.setStartupPromise(Promise.resolve());
  coordinator.requestShutdown();

  let disposalStarted = false;
  const disposal = coordinator.disposeAfterStartup(() => {
    disposalStarted = true;
    return [];
  });

  await Promise.resolve();
  assert.equal(disposalStarted, false);
  releaseBackgroundTask();
  await disposal;
  assert.equal(disposalStarted, true);
});

test('tracked startup failures settle without blocking disposal', async () => {
  const coordinator = new StartupShutdownCoordinator();
  coordinator.trackStartupTask(Promise.reject(new Error('background startup failed')));

  let disposalStarted = false;
  await coordinator.disposeAfterStartup(() => {
    disposalStarted = true;
    return [];
  });

  assert.equal(disposalStarted, true);
});

test('requesting shutdown aborts startup waits exactly once', () => {
  const coordinator = new StartupShutdownCoordinator();
  let aborts = 0;
  coordinator.shutdownSignal.addEventListener('abort', () => {
    aborts += 1;
  });

  coordinator.requestShutdown();
  coordinator.requestShutdown();

  assert.equal(coordinator.shutdownSignal.aborted, true);
  assert.equal(aborts, 1);
});
