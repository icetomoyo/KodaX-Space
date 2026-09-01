import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import type { ProviderInfo } from '@kodax-space/space-ipc-schema';
import { useAppStore } from '../../renderer/src/store/appStore.js';
import { resolveSessionCreateInputs } from '../../renderer/src/shell/createSession.js';

function provider(id: string, defaultModel: string): ProviderInfo {
  return {
    id,
    displayName: id,
    apiKeyEnv: `${id.toUpperCase().replace(/-/g, '_')}_API_KEY`,
    protocol: 'openai',
    defaultModel,
    models: [defaultModel],
    configured: true,
    configuredSource: 'env',
    isDefault: id === 'zhipu-coding',
    isCustom: false,
  };
}

const providers = [provider('zhipu-coding', 'glm-5.2'), provider('next-provider', 'next-model')];

beforeEach(() => {
  useAppStore.setState({
    providers,
    defaultProviderId: 'zhipu-coding',
    keychainBackend: 'unknown',
    pendingProviderId: null,
    pendingModel: 'glm-5.2',
  });
});

test('setDefaultProviderId immediately aligns the renderer default and catalog flags', () => {
  useAppStore.getState().setDefaultProviderId('next-provider');

  const state = useAppStore.getState();
  assert.equal(state.defaultProviderId, 'next-provider');
  assert.equal(state.providers.find((item) => item.id === 'zhipu-coding')?.isDefault, false);
  assert.equal(state.providers.find((item) => item.id === 'next-provider')?.isDefault, true);
});

test('the synchronized provider and selected model are used by the next Session', () => {
  const store = useAppStore.getState();
  store.setDefaultProviderId('next-provider');
  store.setPendingModel('next-model');
  const state = useAppStore.getState();

  const resolved = resolveSessionCreateInputs({
    projectRoot: '/repo',
    providers: state.providers,
    defaultProviderId: state.defaultProviderId,
    kodaxDefaults: {
      provider: 'zhipu-coding',
      model: 'glm-5.2',
      customProvidersCount: 0,
    },
    pendingProviderId: state.pendingProviderId,
    pendingReasoningMode: null,
    pendingPermissionMode: null,
    pendingAgentMode: null,
    pendingModel: state.pendingModel,
  });

  assert.equal(resolved.provider, 'next-provider');
  assert.equal(resolved.model, 'next-model');
});
