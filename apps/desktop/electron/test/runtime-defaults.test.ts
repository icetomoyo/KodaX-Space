import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveRuntimeDefaults } from '../kodax/runtime-defaults.js';

test('resolveRuntimeDefaults prioritizes explicit over session, Space, KodaX, and builtins', async () => {
  const out = await resolveRuntimeDefaults(
    {
      explicit: { permissionMode: 'auto' },
      sessionId: 's_runtime',
      includeSessionSidecar: true,
    },
    {
      loadSessionRuntime: async () => ({
        permissionMode: 'plan',
        reasoningMode: 'quick',
        agentMode: 'sa',
      }),
      loadSettings: async () => ({
        version: 3,
        defaultWorkspace: '/workspace',
        languageMode: 'system',
        terminalShell: 'auto',
        windowCloseBehavior: 'ask',
        coderRuntimeMode: 'daemon',
        runtimeDefaults: {
          permissionMode: 'accept-edits',
          reasoningMode: 'deep',
          agentMode: 'ama',
        },
      }),
      loadKodaxDefaults: async () => ({
        permissionMode: 'plan',
        reasoningMode: 'balanced',
        customProvidersCount: 0,
      }),
    },
  );

  assert.equal(out.permissionMode, 'auto');
  assert.equal(out.reasoningMode, 'quick');
  assert.equal(out.agentMode, 'sa');
  assert.deepEqual(out.sources, {
    permissionMode: 'explicit',
    reasoningMode: 'session',
    agentMode: 'session',
  });
});

test('resolveRuntimeDefaults uses Space before KodaX and KodaX before builtins', async () => {
  const out = await resolveRuntimeDefaults(
    {},
    {
      loadSettings: async () => ({
        version: 3,
        defaultWorkspace: '/workspace',
        languageMode: 'system',
        terminalShell: 'auto',
        windowCloseBehavior: 'ask',
        coderRuntimeMode: 'daemon',
        runtimeDefaults: {
          agentMode: 'sa',
        },
      }),
      loadKodaxDefaults: async () => ({
        permissionMode: 'plan',
        reasoningMode: 'deep',
        customProvidersCount: 0,
      }),
    },
  );

  assert.equal(out.permissionMode, 'plan');
  assert.equal(out.reasoningMode, 'deep');
  assert.equal(out.agentMode, 'sa');
  assert.deepEqual(out.sources, {
    permissionMode: 'kodax',
    reasoningMode: 'kodax',
    agentMode: 'space',
  });
});

test('resolveRuntimeDefaults falls back to builtins when loaders fail', async () => {
  const out = await resolveRuntimeDefaults(
    { sessionId: 's_missing', includeSessionSidecar: true },
    {
      loadSessionRuntime: async () => {
        throw new Error('sidecar failed');
      },
      loadSettings: async () => {
        throw new Error('settings failed');
      },
      loadKodaxDefaults: async () => {
        throw new Error('kodax failed');
      },
    },
  );

  assert.equal(out.permissionMode, 'accept-edits');
  assert.equal(out.reasoningMode, 'auto');
  assert.equal(out.agentMode, 'ama');
  assert.deepEqual(out.sources, {
    permissionMode: 'builtin',
    reasoningMode: 'builtin',
    agentMode: 'builtin',
  });
});

test('resolveRuntimeDefaults preserves the canonical KodaX full-access profile', async () => {
  const out = await resolveRuntimeDefaults(
    {},
    {
      loadSettings: async () => ({
        version: 3,
        defaultWorkspace: '/workspace',
        languageMode: 'system',
        terminalShell: 'auto',
        windowCloseBehavior: 'ask',
        coderRuntimeMode: 'daemon',
        runtimeDefaults: {},
      }),
      loadKodaxDefaults: async () => ({
        permissionMode: 'full-access',
        customProvidersCount: 0,
      }),
    },
  );
  assert.equal(out.permissionMode, 'full-access');
  assert.equal(out.sources.permissionMode, 'kodax');
});
