import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  invokeChannels,
  MAX_SANDBOX_DIAGNOSTICS,
  MAX_SANDBOX_GUIDANCE,
  MAX_SANDBOX_STATUS_TEXT,
  sandboxRefreshChannel,
  sandboxSetupChannel,
  sandboxStatusChannel,
} from '../src/index.js';

const readyStatus = {
  contractVersion: 1 as const,
  sandboxVersion: 5 as const,
  asrtVersion: '0.0.65',
  platform: 'win32' as const,
  backend: 'windows-restricted-user' as const,
  readiness: 'ready' as const,
  setup: {
    canSetup: false,
    mayElevate: true,
    requiresElevation: false,
  },
  diagnosticCount: 0,
  diagnostics: [],
  guidance: ['KodaX sandbox is active (win32, ASRT 0.0.65).'],
  revision: 3,
  checkedAt: '2026-07-31T08:00:00.000Z',
  lastOperation: null,
};

test('sandbox channels are present in the typed invoke registry', () => {
  assert.equal(invokeChannels['sandbox.status'], sandboxStatusChannel);
  assert.equal(invokeChannels['sandbox.refresh'], sandboxRefreshChannel);
  assert.equal(invokeChannels['sandbox.setup'], sandboxSetupChannel);
});

test('sandbox status and refresh accept no renderer payload', () => {
  assert.equal(sandboxStatusChannel.input.safeParse(undefined).success, true);
  assert.equal(sandboxRefreshChannel.input.safeParse(undefined).success, true);
  assert.equal(sandboxStatusChannel.input.safeParse({ refresh: true }).success, false);
  assert.equal(sandboxRefreshChannel.input.safeParse({ refresh: true }).success, false);
});

test('sandbox setup requires an exact confirmation and observed revision', () => {
  assert.equal(
    sandboxSetupChannel.input.safeParse({
      expectedRevision: 3,
      confirmation: 'allow-sandbox-setup',
    }).success,
    true,
  );
  assert.equal(
    sandboxSetupChannel.input.safeParse({
      expectedRevision: 3,
      confirmation: true,
    }).success,
    false,
  );
  assert.equal(
    sandboxSetupChannel.input.safeParse({
      expectedRevision: -1,
      confirmation: 'allow-sandbox-setup',
    }).success,
    false,
  );
  assert.equal(
    sandboxSetupChannel.input.safeParse({
      expectedRevision: 3,
      confirmation: 'allow-sandbox-setup',
      allowElevation: true,
    }).success,
    false,
  );
});

test('sandbox status is bounded and models setup outcome independently from readiness', () => {
  assert.equal(sandboxStatusChannel.output.safeParse(readyStatus).success, true);
  assert.equal(
    sandboxSetupChannel.output.safeParse({
      ...readyStatus,
      revision: 4,
      lastOperation: {
        kind: 'setup',
        outcome: 'cancelled',
        attempted: true,
        message: 'Sandbox setup was cancelled.',
      },
    }).success,
    true,
  );

  assert.equal(
    sandboxStatusChannel.output.safeParse({
      ...readyStatus,
      diagnosticCount: MAX_SANDBOX_DIAGNOSTICS + 1,
      diagnostics: Array.from({ length: MAX_SANDBOX_DIAGNOSTICS + 1 }, () => 'bounded diagnostic'),
    }).success,
    false,
  );
  assert.equal(
    sandboxStatusChannel.output.safeParse({
      ...readyStatus,
      guidance: Array.from({ length: MAX_SANDBOX_GUIDANCE + 1 }, () => 'bounded guidance'),
    }).success,
    false,
  );
  assert.equal(
    sandboxStatusChannel.output.safeParse({
      ...readyStatus,
      diagnostics: ['x'.repeat(MAX_SANDBOX_STATUS_TEXT + 1)],
      diagnosticCount: 1,
    }).success,
    false,
  );
});

test('sandbox status rejects unsupported state and raw extra fields', () => {
  assert.equal(
    sandboxStatusChannel.output.safeParse({
      ...readyStatus,
      readiness: 'installed',
    }).success,
    false,
  );
  assert.equal(
    sandboxStatusChannel.output.safeParse({
      ...readyStatus,
      diagnostics: [],
      rawDoctor: { diagnostics: ['C:\\Users\\secret'] },
    }).success,
    false,
  );
});
