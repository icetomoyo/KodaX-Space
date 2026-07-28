import assert from 'node:assert/strict';
import { test } from 'node:test';

import { RendererStartupGate } from '../window/renderer-startup-gate.js';

test('renderer startup waits until main-process initialization releases the gate', async () => {
  const gate = new RendererStartupGate();
  let continued = false;
  const waiting = gate.wait().then(() => {
    continued = true;
  });

  await Promise.resolve();
  assert.equal(gate.isReady(), false);
  assert.equal(continued, false);

  gate.release();
  await waiting;
  assert.equal(gate.isReady(), true);
  assert.equal(continued, true);
});

test('renderer startup gate release is idempotent and future waits complete', async () => {
  const gate = new RendererStartupGate();

  gate.release();
  gate.release();

  await gate.wait();
  assert.equal(gate.isReady(), true);
});

test('renderer startup tasks cannot run before release', async () => {
  const gate = new RendererStartupGate();
  let runs = 0;

  gate.run(() => {
    runs += 1;
  });
  await Promise.resolve();
  assert.equal(runs, 0);

  gate.release();
  await gate.wait();
  await Promise.resolve();
  assert.equal(runs, 1);
});
