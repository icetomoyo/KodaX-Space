import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { CompleteExitOverlayPresentation } from '../../renderer/src/shell/CompleteExitOverlay.js';

test('complete-exit overlay gives immediate visible and accessible progress feedback', () => {
  const markup = renderToStaticMarkup(
    createElement(CompleteExitOverlayPresentation, {
      active: true,
      title: 'Quitting KodaX Space…',
      detail: 'Checking active work and stopping Runtime safely. Please wait.',
    }),
  );

  assert.match(markup, /role="status"/);
  assert.match(markup, /aria-busy="true"/);
  assert.match(markup, /Quitting KodaX Space/);
  assert.match(markup, /Checking active work/);
});

test('complete-exit overlay is absent before a quit request', () => {
  const markup = renderToStaticMarkup(
    createElement(CompleteExitOverlayPresentation, {
      active: false,
      title: 'Quitting KodaX Space…',
      detail: 'Checking active work and stopping Runtime safely. Please wait.',
    }),
  );

  assert.equal(markup, '');
});
