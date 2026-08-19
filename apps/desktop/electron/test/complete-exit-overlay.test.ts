import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import {
  CompleteExitOverlayPresentation,
  startCompleteExitElapsedTimer,
} from '../../renderer/src/shell/CompleteExitOverlay.js';

test('complete-exit overlay gives immediate visible and accessible progress feedback', () => {
  const markup = renderToStaticMarkup(
    createElement(CompleteExitOverlayPresentation, {
      active: true,
      title: 'Quitting KodaX Space…',
      detail: 'Checking active work and stopping Runtime safely. Please wait.',
      elapsedLabel: 'Safe cleanup in progress · 20s',
    }),
  );

  assert.match(markup, /role="status"/);
  assert.match(markup, /aria-busy="true"/);
  assert.match(markup, /Quitting KodaX Space/);
  assert.match(markup, /Checking active work/);
  assert.match(markup, /Safe cleanup in progress · 20s/);
});

test('complete-exit overlay is absent before a quit request', () => {
  const markup = renderToStaticMarkup(
    createElement(CompleteExitOverlayPresentation, {
      active: false,
      title: 'Quitting KodaX Space…',
      detail: 'Checking active work and stopping Runtime safely. Please wait.',
      elapsedLabel: 'Safe cleanup in progress · 0s',
    }),
  );

  assert.equal(markup, '');
});

test('complete-exit elapsed timer advances from its start and is disposed', () => {
  let tick: (() => void) | undefined;
  let clearedTimer: number | undefined;
  let elapsed = -1;
  const stop = startCompleteExitElapsedTimer(
    1_000,
    (seconds) => {
      elapsed = seconds;
    },
    {
      now: () => 3_600,
      setInterval: (callback) => {
        tick = callback;
        return 42;
      },
      clearInterval: (timer) => {
        clearedTimer = timer;
      },
    },
  );

  tick?.();
  assert.equal(elapsed, 2);
  stop();
  assert.equal(clearedTimer, 42);
});
