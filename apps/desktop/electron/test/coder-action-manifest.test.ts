import assert from 'node:assert/strict';
import test from 'node:test';

import { invokeChannels } from '@kodax-space/space-ipc-schema';
import {
  CODER_ACTION_MANIFEST,
  FROZEN_V0131_CODER_ENTRYPOINTS,
  isCoderEntrypointNamespace,
} from '../kodax/runtime/coder-action-manifest.js';

test('frozen v0.1.31 Coder entrypoint list covers every relevant registered invoke channel', () => {
  const registered = Object.keys(invokeChannels).filter(isCoderEntrypointNamespace).sort();
  const frozen = [...FROZEN_V0131_CODER_ENTRYPOINTS].sort();
  assert.deepEqual(frozen, registered);
});

test('Coder action manifest has one explicit non-inline disposition per entrypoint', () => {
  const entrypoints = CODER_ACTION_MANIFEST.map((entry) => entry.entrypoint);
  assert.equal(new Set(entrypoints).size, entrypoints.length);
  assert.deepEqual([...entrypoints].sort(), [...FROZEN_V0131_CODER_ENTRYPOINTS].sort());

  for (const entry of CODER_ACTION_MANIFEST) {
    assert.notEqual(entry.targetOwner, 'inline-code');
    assert.ok(entry.actionId.length > 0);
    assert.ok(entry.regressionFixture.length > 0);
    if (entry.releasedState === 'ga' && entry.targetOwner === 'coder-daemon') {
      assert.ok(entry.requiredCapability, `${entry.entrypoint} must name a daemon capability`);
    }
  }
});

test('Space Artifact and notification entrypoints remain Space-owned', () => {
  for (const entrypoint of ['artifact.create', 'artifact.read', 'notification.show'] as const) {
    const entry = CODER_ACTION_MANIFEST.find((item) => item.entrypoint === entrypoint);
    assert.ok(entry);
    assert.equal(entry.targetOwner, 'space-host-provider');
  }
});

test('Runtime settings mutations are not misclassified as Space-local UI state', () => {
  for (const entrypoint of [
    'settings.setRuntimeDefaults',
    'settings.kodaxConfig.setCompaction',
  ] as const) {
    const entry = CODER_ACTION_MANIFEST.find((item) => item.entrypoint === entrypoint);
    assert.ok(entry);
    assert.equal(entry.targetOwner, 'coder-daemon');
    assert.equal(entry.requiredCapability, 'runtime.config.cas');
  }

  const workspace = CODER_ACTION_MANIFEST.find(
    (item) => item.entrypoint === 'settings.setDefaultWorkspace',
  );
  assert.ok(workspace);
  assert.equal(workspace.targetOwner, 'space-ui-only');
});

test('daemon-dependent experimental routes stay capability-gated', () => {
  for (const entrypoint of ['memory.list'] as const) {
    const entry = CODER_ACTION_MANIFEST.find((item) => item.entrypoint === entrypoint);
    assert.ok(entry);
    assert.equal(entry.releasedState, 'capability-gated');
    assert.equal(entry.unavailableBehavior, 'disable-with-reason');
  }
});
