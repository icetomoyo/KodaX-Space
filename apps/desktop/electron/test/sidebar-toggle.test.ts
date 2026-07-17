import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveRightSidebarToggleAction } from '../../renderer/src/shell/sidebarToggle.js';

test('right sidebar toggle distinguishes responsive hiding from an explicit close', () => {
  assert.equal(resolveRightSidebarToggleAction(true, true), 'close');
  assert.equal(resolveRightSidebarToggleAction(false, false), 'open-default');
  assert.equal(resolveRightSidebarToggleAction(false, true), 'open-balanced');
});
