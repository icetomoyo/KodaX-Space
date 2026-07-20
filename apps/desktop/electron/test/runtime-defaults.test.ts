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
        autoModeEngine: 'rules',
        reasoningMode: 'quick',
        agentMode: 'sa',
      }),
      loadSettings: async () => ({
        version: 2,
        defaultWorkspace: '/workspace',
        languageMode: 'system',
        runtimeDefaults: {
          permissionMode: 'accept-edits',
          autoModeEngine: 'llm',
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
  assert.equal(out.autoModeEngine, 'rules');
  assert.equal(out.reasoningMode, 'quick');
  assert.equal(out.agentMode, 'sa');
  assert.deepEqual(out.sources, {
    permissionMode: 'explicit',
    autoModeEngine: 'session',
    reasoningMode: 'session',
    agentMode: 'session',
  });
});

test('resolveRuntimeDefaults uses Space before KodaX and KodaX before builtins', async () => {
  const out = await resolveRuntimeDefaults(
    {},
    {
      loadSettings: async () => ({
        version: 2,
        defaultWorkspace: '/workspace',
        languageMode: 'system',
        runtimeDefaults: {
          autoModeEngine: 'rules',
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
  assert.equal(out.autoModeEngine, 'rules');
  assert.equal(out.reasoningMode, 'deep');
  assert.equal(out.agentMode, 'sa');
  assert.deepEqual(out.sources, {
    permissionMode: 'kodax',
    autoModeEngine: 'space',
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
  assert.equal(out.autoModeEngine, 'llm');
  assert.equal(out.reasoningMode, 'auto');
  assert.equal(out.agentMode, 'ama');
  assert.deepEqual(out.sources, {
    permissionMode: 'builtin',
    autoModeEngine: 'builtin',
    reasoningMode: 'builtin',
    agentMode: 'builtin',
  });
});

test('resolveRuntimeDefaults uses the KodaX autoMode engine before the builtin', async () => {
  const out = await resolveRuntimeDefaults(
    {},
    {
      loadSettings: async () => ({
        version: 2,
        defaultWorkspace: '/workspace',
        languageMode: 'system',
        runtimeDefaults: {},
      }),
      loadKodaxDefaults: async () => ({
        autoModeEngine: 'rules',
        customProvidersCount: 0,
      }),
    },
  );

  assert.equal(out.autoModeEngine, 'rules');
  assert.equal(out.sources.autoModeEngine, 'kodax');
});
