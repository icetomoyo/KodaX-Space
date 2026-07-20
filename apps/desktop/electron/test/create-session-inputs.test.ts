import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ProviderInfo } from '@kodax-space/space-ipc-schema';
import { resolveSessionCreateInputs } from '../../renderer/src/shell/createSession.js';

function provider(
  id: string,
  configured: boolean,
  defaultModel: string,
  models: readonly string[] = [defaultModel],
): ProviderInfo {
  return {
    id,
    displayName: id,
    apiKeyEnv: `${id.toUpperCase().replace(/-/g, '_')}_API_KEY`,
    protocol: 'openai',
    defaultModel,
    models: [...models],
    configured,
    configuredSource: configured ? 'env' : 'none',
    isDefault: false,
    isCustom: id.startsWith('custom_'),
  };
}

test('resolveSessionCreateInputs prefers configured pending provider over defaults', () => {
  const out = resolveSessionCreateInputs({
    projectRoot: '/repo',
    providers: [
      provider('pending-provider', true, 'pending-default', ['pending-default', 'pending-fast']),
      provider('space-default', true, 'space-default-model'),
      provider('kodax-default', true, 'kodax-default-model'),
    ],
    defaultProviderId: 'space-default',
    kodaxDefaults: {
      provider: 'kodax-default',
      model: 'kodax-default-model',
      reasoningMode: 'deep',
      permissionMode: 'plan',
      customProvidersCount: 0,
    },
    pendingProviderId: 'pending-provider',
    pendingReasoningMode: 'quick',
    pendingPermissionMode: 'accept-edits',
    pendingAutoModeEngine: 'rules',
    pendingAgentMode: 'sa',
    pendingModel: 'pending-fast',
  });

  assert.equal(out.provider, 'pending-provider');
  assert.equal(out.model, 'pending-fast');
  assert.equal(out.reasoningMode, 'quick');
  assert.equal(out.permissionMode, 'accept-edits');
  assert.equal(out.autoModeEngine, 'rules');
  assert.equal(out.agentMode, 'sa');
  assert.deepEqual(out.runtimeOverrides, {
    reasoningMode: 'quick',
    permissionMode: 'accept-edits',
    autoModeEngine: 'rules',
    agentMode: 'sa',
  });
});

test('resolveSessionCreateInputs skips unconfigured candidates and avoids mock fallback when possible', () => {
  const out = resolveSessionCreateInputs({
    projectRoot: '/repo',
    providers: [
      provider('mock', true, 'mock-model'),
      provider('pending-provider', false, 'pending-default'),
      provider('space-default', false, 'space-default-model'),
      provider('kodax-default', false, 'kodax-default-model'),
      provider('first-real-configured', true, 'real-default'),
    ],
    defaultProviderId: 'space-default',
    kodaxDefaults: {
      provider: 'kodax-default',
      model: 'kodax-default-model',
      customProvidersCount: 0,
    },
    pendingProviderId: 'pending-provider',
    pendingReasoningMode: null,
    pendingPermissionMode: null,
    pendingAutoModeEngine: null,
    pendingAgentMode: null,
    pendingModel: 'kodax-default-model',
  });

  assert.equal(out.provider, 'first-real-configured');
  assert.equal(out.model, 'real-default');
  assert.equal(out.reasoningMode, 'auto');
  assert.equal(out.permissionMode, 'accept-edits');
  assert.equal(out.autoModeEngine, 'llm');
  assert.equal(out.agentMode, 'ama');
  assert.deepEqual(out.runtimeOverrides, {});
});

test('resolveSessionCreateInputs does not turn hydrated Space defaults into explicit create overrides', () => {
  const out = resolveSessionCreateInputs({
    projectRoot: '/repo',
    providers: [provider('space-default', true, 'space-default-model')],
    defaultProviderId: 'space-default',
    kodaxDefaults: {
      provider: 'space-default',
      model: 'space-default-model',
      reasoningMode: 'deep',
      permissionMode: 'plan',
      customProvidersCount: 0,
    },
    spaceRuntimeDefaults: {
      reasoningMode: 'quick',
      permissionMode: 'auto',
      autoModeEngine: 'rules',
      agentMode: 'sa',
    },
    pendingProviderId: null,
    pendingReasoningMode: 'quick',
    pendingPermissionMode: 'auto',
    pendingAutoModeEngine: 'rules',
    pendingAgentMode: 'sa',
    pendingModel: null,
  });

  assert.equal(out.reasoningMode, 'quick');
  assert.equal(out.permissionMode, 'auto');
  assert.equal(out.autoModeEngine, 'rules');
  assert.equal(out.agentMode, 'sa');
  assert.deepEqual(out.runtimeOverrides, {});
});

test('resolveSessionCreateInputs ignores stale pending model from another provider', () => {
  const out = resolveSessionCreateInputs({
    projectRoot: '/repo',
    providers: [
      provider('space-default', true, 'space-default-model', [
        'space-default-model',
        'space-large',
      ]),
      provider('other-provider', true, 'other-model', ['other-model']),
    ],
    defaultProviderId: 'space-default',
    kodaxDefaults: null,
    pendingProviderId: null,
    pendingReasoningMode: null,
    pendingPermissionMode: null,
    pendingAutoModeEngine: null,
    pendingAgentMode: null,
    pendingModel: 'other-model',
  });

  assert.equal(out.provider, 'space-default');
  assert.equal(out.model, 'space-default-model');
});

test('resolveSessionCreateInputs reflects the KodaX Auto LLM engine when Space has no override', () => {
  const out = resolveSessionCreateInputs({
    projectRoot: '/repo',
    providers: [provider('kodax-default', true, 'kodax-model')],
    defaultProviderId: null,
    kodaxDefaults: {
      provider: 'kodax-default',
      model: 'kodax-model',
      autoModeEngine: 'rules',
      autoModeTimeoutMs: 20_000,
      customProvidersCount: 0,
    },
    pendingProviderId: null,
    pendingReasoningMode: null,
    pendingPermissionMode: null,
    pendingAutoModeEngine: null,
    pendingAgentMode: null,
    pendingModel: null,
  });

  assert.equal(out.autoModeEngine, 'rules');
  assert.deepEqual(out.runtimeOverrides, {});
});
