import assert from 'node:assert/strict';
import { test } from 'node:test';

import { RendererLoadScheduler } from '../window/renderer-load-scheduler.js';

const waitForTimers = (): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, 10);
  });

test('only the latest renderer recovery request survives the startup gate', async () => {
  let releaseGate!: () => void;
  const gate = new Promise<void>((resolve) => {
    releaseGate = resolve;
  });
  const scheduler = new RendererLoadScheduler(() => gate);
  const runs: string[] = [];

  scheduler.schedule(() => runs.push('initial'), 0);
  scheduler.schedule(() => runs.push('crash-recovery'), 0);
  scheduler.schedule(() => runs.push('load-rejection-retry'), 0);
  releaseGate();
  await gate;
  await waitForTimers();

  assert.deepEqual(runs, ['load-rejection-retry']);
});

test('a later retry cancels an already-timed renderer recovery', async () => {
  const scheduler = new RendererLoadScheduler(() => Promise.resolve());
  const runs: string[] = [];

  scheduler.schedule(() => runs.push('crash-recovery'), 50);
  await Promise.resolve();
  scheduler.schedule(() => runs.push('did-fail-load-retry'), 0);
  await waitForTimers();

  assert.deepEqual(runs, ['did-fail-load-retry']);
});

test('cancel prevents a pending renderer load after fatal startup', async () => {
  const scheduler = new RendererLoadScheduler(() => Promise.resolve());
  let runs = 0;

  scheduler.schedule(() => {
    runs += 1;
  }, 0);
  scheduler.cancel();
  await waitForTimers();

  assert.equal(runs, 0);
});
