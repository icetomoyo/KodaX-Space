import assert from 'node:assert/strict';
import test from 'node:test';

import { runningPeerAction } from '../../renderer/src/shell/runningPeerAction.js';

test('running peers open only sessions present in the renderer session list', () => {
  const known = new Set(['s_peer']);
  assert.equal(runningPeerAction('s_peer', null, known), 'open');
  assert.equal(runningPeerAction('s_missing', null, known), 'explain');
  assert.equal(runningPeerAction(undefined, null, known), 'explain');
  assert.equal(runningPeerAction('s_peer', 's_peer', known), 'none');
});
