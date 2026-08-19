import assert from 'node:assert/strict';
import test from 'node:test';

import { INVOKE_CHANNEL_NAMES, invokeChannels } from '../index.js';
import { windowSetBadgeCountChannel } from './window.js';

test('window.setBadgeCount is registered with a bounded integer count', () => {
  assert.equal(invokeChannels['window.setBadgeCount'], windowSetBadgeCountChannel);
  assert.ok(INVOKE_CHANNEL_NAMES.has('window.setBadgeCount'));
  assert.equal(windowSetBadgeCountChannel.input.safeParse({ count: 0 }).success, true);
  assert.equal(windowSetBadgeCountChannel.input.safeParse({ count: 9999 }).success, true);

  for (const count of [-1, 1.5, 10_000, Number.NaN]) {
    assert.equal(windowSetBadgeCountChannel.input.safeParse({ count }).success, false);
  }
  assert.equal(
    windowSetBadgeCountChannel.input.safeParse({ count: 1, image: 'renderer-controlled' }).success,
    false,
  );
  assert.equal(windowSetBadgeCountChannel.output.safeParse({ applied: true }).success, true);
  assert.equal(windowSetBadgeCountChannel.output.safeParse({ applied: 'yes' }).success, false);
});
