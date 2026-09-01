import assert from 'node:assert/strict';
import test from 'node:test';

import { invokeChannels } from '@kodax-space/space-ipc-schema';
import {
  CODER_ACTION_MANIFEST,
  CODER_DAEMON_ROUTED_ENTRYPOINTS,
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

test('Space settings mutations remain host projections and explicitly reload daemon config', () => {
  for (const entrypoint of [
    'settings.setCoderRuntimeMode',
    'settings.setRuntimeDefaults',
    'settings.kodaxConfig.applyIntegrationMigration',
    'settings.kodaxConfig.setCompaction',
  ] as const) {
    const entry = CODER_ACTION_MANIFEST.find((item) => item.entrypoint === entrypoint);
    assert.ok(entry);
    assert.equal(entry.targetOwner, 'space-host-provider');
    assert.equal(entry.requiredCapability, undefined);
  }

  for (const entrypoint of [
    'settings.setDefaultWorkspace',
    'settings.setLanguageMode',
    'settings.setTerminalShell',
    'settings.setWindowCloseBehavior',
  ] as const) {
    const entry = CODER_ACTION_MANIFEST.find((item) => item.entrypoint === entrypoint);
    assert.ok(entry);
    assert.equal(entry.targetOwner, 'space-ui-only');
  }
});

test('0.7.72 daemon-routed GA entrypoints are an explicit reviewed subset', () => {
  const routed = CODER_ACTION_MANIFEST.filter((entry) => entry.targetOwner === 'coder-daemon');
  assert.deepEqual(
    routed.map((entry) => entry.entrypoint).sort(),
    [...CODER_DAEMON_ROUTED_ENTRYPOINTS].sort(),
  );
  for (const entry of routed) {
    assert.equal(entry.releasedState, 'ga');
    assert.ok(entry.requiredCapability);
    assert.equal(entry.unavailableBehavior, 'disable-with-reason');
  }
});

test('daemon-dependent experimental routes stay capability-gated', () => {
  for (const entrypoint of ['memory.list'] as const) {
    const entry = CODER_ACTION_MANIFEST.find((item) => item.entrypoint === entrypoint);
    assert.ok(entry);
    assert.equal(entry.releasedState, 'capability-gated');
    assert.equal(entry.unavailableBehavior, 'disable-with-reason');
  }
});
