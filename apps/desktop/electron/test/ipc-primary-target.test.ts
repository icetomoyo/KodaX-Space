import assert from 'node:assert/strict';
import test from 'node:test';
import type { WebContents } from 'electron';

import { isRendererTarget, setRendererTarget } from '../ipc/push.js';

function fakeWebContents(id: number, destroyed = false): WebContents {
  return {
    id,
    isDestroyed: () => destroyed,
  } as unknown as WebContents;
}

test('primary renderer identity rejects auxiliary and destroyed windows', () => {
  const primary = fakeWebContents(11);
  setRendererTarget(() => primary);
  assert.equal(isRendererTarget(primary), true);
  assert.equal(isRendererTarget(fakeWebContents(12)), false);

  setRendererTarget(() => fakeWebContents(11, true));
  assert.equal(isRendererTarget(primary), false);

  setRendererTarget(() => null);
  assert.equal(isRendererTarget(primary), false);
});
