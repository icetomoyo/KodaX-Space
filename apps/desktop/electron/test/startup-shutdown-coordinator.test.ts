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
