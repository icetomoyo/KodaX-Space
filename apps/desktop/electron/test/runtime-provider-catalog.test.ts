import assert from 'node:assert/strict';
import test from 'node:test';

import type { SdkCustomProviderConfig } from '../kodax/user-config.js';
import {
  deleteSpaceCustomProviderFromRuntime,
  restoreDeletedSpaceCustomProviderInRuntime,
  syncSpaceCustomProvidersToRuntime,
  upsertSpaceCustomProviderInRuntime,
  type RuntimeCustomProviderCatalogClient,
} from '../providers/runtime-catalog.js';

function customProvider(id: string, contextWindow = 131_072) {
  return {
    id,
    protocol: 'openai' as const,
    baseUrl: 'http://127.0.0.1:11434/v1',
    skipBaseUrlValidation: true,
    apiKeyEnv: 'OLLAMA_API_KEY',
    defaultModel: 'ornith:35b',
    models: ['ornith:35b'],
    contextWindow,
  };
}

function config(record: Record<string, unknown>): SdkCustomProviderConfig {
  return record as unknown as SdkCustomProviderConfig;
}

function configName(provider: SdkCustomProviderConfig): string {
  return (provider as unknown as { name: string }).name;
}

function fakeClient(
  runtimeSelected = true,
  initial: readonly SdkCustomProviderConfig[] = [],
) {
  const catalog = new Map(initial.map((provider) => [configName(provider), structuredClone(provider)]));
  const upserts: SdkCustomProviderConfig[] = [];
  const deletes: string[] = [];
  const client: RuntimeCustomProviderCatalogClient = {
    isRuntimeSelected: () => runtimeSelected,
    listRuntimeCustomProviders: async () =>
      [...catalog.values()].map((provider) => structuredClone(provider)),
    upsertRuntimeCustomProvider: async (provider) => {
      const cloned = structuredClone(provider);
      upserts.push(cloned);
      catalog.set(configName(cloned), cloned);
      return provider;
    },
    deleteRuntimeCustomProvider: async (name) => {
      deletes.push(name);
      return catalog.delete(name);
    },
  };
  return { client, catalog, upserts, deletes };
}

test('syncSpaceCustomProvidersToRuntime registers Space providers sequentially with context metadata', async () => {
  const fake = fakeClient();
  await syncSpaceCustomProvidersToRuntime(
    [customProvider('custom_0000000000000001'), customProvider('custom_0000000000000002', 262_144)],
    fake.client,
  );

  assert.deepEqual(
    fake.upserts.map((provider) => ({
      name: provider.name,
      baseUrl: provider.baseUrl,
      model: provider.model,
      contextWindow: provider.contextWindow,
    })),
    [
      {
        name: 'custom_0000000000000001',
        baseUrl: 'http://127.0.0.1:11434/v1',
        model: 'ornith:35b',
        contextWindow: 131_072,
      },
      {
        name: 'custom_0000000000000002',
        baseUrl: 'http://127.0.0.1:11434/v1',
        model: 'ornith:35b',
        contextWindow: 262_144,
      },
    ],
  );
});

test('runtime custom provider mutations are no-ops in legacy host mode', async () => {
  const fake = fakeClient(false);
  await upsertSpaceCustomProviderInRuntime(customProvider('custom_0000000000000001'), fake.client);
  const deletion = await deleteSpaceCustomProviderFromRuntime(
    'custom_0000000000000001',
    fake.client,
  );

  assert.deepEqual(fake.upserts, []);
  assert.deepEqual(fake.deletes, []);
  assert.deepEqual(deletion, { runtimeSelected: false, deleted: false });
});

test('upsert preserves Runtime-only fields and matching model descriptors', async () => {
  const id = 'custom_0000000000000001';
  const descriptor = {
    id: 'ornith:35b',
    contextWindow: 262_144,
    maxOutputTokens: 16_384,
  };
  const fake = fakeClient(true, [
    config({
      name: id,
      protocol: 'openai',
      baseUrl: 'https://old.example/v1',
      apiKeyEnv: 'OLD_KEY',
      model: 'old',
      models: [descriptor, { id: 'removed-model', contextWindow: 8_192 }],
      userAgentMode: 'claude-code',
      capabilityProfile: { supportsTools: true },
      maxOutputTokens: 32_768,
      reasoning: { effortStrategy: 'openai-chat-effort', defaultEffort: 'high' },
    }),
  ]);

  await upsertSpaceCustomProviderInRuntime(customProvider(id), fake.client);
  const current = fake.catalog.get(id) as unknown as Record<string, unknown>;

  assert.equal(current.baseUrl, 'http://127.0.0.1:11434/v1');
  assert.equal(current.contextWindow, 131_072);
  assert.equal(current.userAgentMode, 'claude-code');
  assert.deepEqual(current.capabilityProfile, { supportsTools: true });
  assert.equal(current.maxOutputTokens, 32_768);
  assert.deepEqual(current.reasoning, {
    effortStrategy: 'openai-chat-effort',
    defaultEffort: 'high',
  });
  assert.deepEqual(current.models, [descriptor]);
});

test('failed upsert restores the exact previous Runtime catalog record', async () => {
  const id = 'custom_0000000000000001';
  const previous = config({
    name: id,
    protocol: 'openai',
    baseUrl: 'https://old.example/v1',
    apiKeyEnv: 'OLD_KEY',
    model: 'old',
    reasoningProfile: { defaultEffort: 'high' },
  });
  const fake = fakeClient(true, [previous]);
  const originalUpsert = fake.client.upsertRuntimeCustomProvider;
  let failFirstWrite = true;
  const client: RuntimeCustomProviderCatalogClient = {
    ...fake.client,
    upsertRuntimeCustomProvider: async (provider) => {
      if (failFirstWrite) {
        failFirstWrite = false;
        fake.catalog.set(configName(provider), structuredClone(provider));
        throw new Error('daemon write failed after mutation');
      }
      return originalUpsert(provider);
    },
  };

  await assert.rejects(upsertSpaceCustomProviderInRuntime(customProvider(id), client), /daemon write/);
  assert.deepEqual(fake.catalog.get(id), previous);
});

test('delete returns an exact snapshot that can restore Runtime after a later store failure', async () => {
  const id = 'custom_0000000000000001';
  const previous = config({
    name: id,
    protocol: 'openai',
    baseUrl: 'https://old.example/v1',
    apiKeyEnv: 'OLD_KEY',
    model: 'old',
    replayReasoningContent: true,
  });
  const fake = fakeClient(true, [previous]);

  const deletion = await deleteSpaceCustomProviderFromRuntime(id, fake.client);
  assert.equal(deletion.deleted, true);
  assert.equal(fake.catalog.has(id), false);

  await restoreDeletedSpaceCustomProviderInRuntime(deletion, customProvider(id), fake.client);
  assert.deepEqual(fake.catalog.get(id), previous);
});

test('delete rollback restores its snapshot even when a concurrent removal made delete return false', async () => {
  const id = 'custom_0000000000000001';
  const previous = config({
    name: id,
    protocol: 'openai',
    baseUrl: 'https://old.example/v1',
    apiKeyEnv: 'OLD_KEY',
    model: 'old',
    verifyStrategy: 'openai-models',
  });
  const fake = fakeClient(true, [previous]);
  const client: RuntimeCustomProviderCatalogClient = {
    ...fake.client,
    deleteRuntimeCustomProvider: async (name) => {
      fake.catalog.delete(name);
      return false;
    },
  };

  const deletion = await deleteSpaceCustomProviderFromRuntime(id, client);
  assert.equal(deletion.deleted, false);
  assert.equal(fake.catalog.has(id), false);

  await restoreDeletedSpaceCustomProviderInRuntime(deletion, customProvider(id), client);
  assert.deepEqual(fake.catalog.get(id), previous);
});

test('syncSpaceCustomProvidersToRuntime attempts every provider before reporting failures', async () => {
  const fake = fakeClient();
  const originalUpsert = fake.client.upsertRuntimeCustomProvider;
  let calls = 0;
  const client: RuntimeCustomProviderCatalogClient = {
    ...fake.client,
    upsertRuntimeCustomProvider: async (provider) => {
      calls += 1;
      if (calls === 1) throw new Error('daemon rejected first provider');
      return originalUpsert(provider);
    },
  };

  await assert.rejects(
    syncSpaceCustomProvidersToRuntime(
      [customProvider('custom_0000000000000001'), customProvider('custom_0000000000000002')],
      client,
    ),
    /failed to synchronize 1 custom provider/,
  );
  assert.equal(calls, 2);
  assert.equal(fake.upserts[0]?.name, 'custom_0000000000000002');
});
