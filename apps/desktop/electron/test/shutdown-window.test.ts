import assert from 'node:assert/strict';
import { test } from 'node:test';

import { hideWindowsForShutdown, type ShutdownWindowLike } from '../window/shutdown-window.js';

function createWindow(options?: { destroyed?: boolean; hideError?: Error }): {
  window: ShutdownWindowLike;
  hideCalls: () => number;
} {
  let calls = 0;
  return {
    window: {
      isDestroyed: () => options?.destroyed ?? false,
      hide: () => {
        calls += 1;
        if (options?.hideError) throw options.hideError;
      },
    },
    hideCalls: () => calls,
  };
}

test('shutdown hides every live application window immediately', () => {
  const first = createWindow();
  const second = createWindow();
  const destroyed = createWindow({ destroyed: true });

  hideWindowsForShutdown([first.window, destroyed.window, second.window]);

  assert.equal(first.hideCalls(), 1);
  assert.equal(second.hideCalls(), 1);
  assert.equal(destroyed.hideCalls(), 0);
});

test('one window hide failure does not block the rest of shutdown visibility cleanup', () => {
  const failure = new Error('hide failed');
  const broken = createWindow({ hideError: failure });
  const healthy = createWindow();
  const errors: unknown[] = [];

  hideWindowsForShutdown([broken.window, healthy.window], (error) => errors.push(error));

  assert.equal(broken.hideCalls(), 1);
  assert.equal(healthy.hideCalls(), 1);
  assert.deepEqual(errors, [failure]);
});
