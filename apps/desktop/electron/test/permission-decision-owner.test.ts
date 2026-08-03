import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveSpacePermissionBrokerMode } from '../permission/decision-owner.js';

test('an Auto run delegates the final decision to its installed SDK guardrail', () => {
  assert.equal(resolveSpacePermissionBrokerMode('auto', true), null);
});

test('Auto explicitly degrades the Space broker to accept-edits when guardrail bootstrap is absent', () => {
  assert.equal(resolveSpacePermissionBrokerMode('auto', false), 'accept-edits');
});

test('non-Auto modes retain their existing Space broker policy', () => {
  assert.equal(resolveSpacePermissionBrokerMode('accept-edits', true), 'accept-edits');
  assert.equal(resolveSpacePermissionBrokerMode('plan', true), 'plan');
});

test('the owner decision uses the run-start mode rather than a later UI selection', () => {
  const autoRunMode = 'auto' as const;
  const acceptEditsRunMode = 'accept-edits' as const;

  // Auto -> Accept-edits during the run: the installed guardrail remains owner.
  assert.equal(resolveSpacePermissionBrokerMode(autoRunMode, true), null);
  // Accept-edits -> Auto during the run: no guardrail was installed, so broker remains owner.
  assert.equal(resolveSpacePermissionBrokerMode(acceptEditsRunMode, false), 'accept-edits');
});
