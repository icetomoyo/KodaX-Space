// ProviderConfigStore tests — FEATURE_004
//
// 验证两个文件（space provider-config.json + custom-providers.json）的
// 持久化、缓存、并发安全、损坏恢复。

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { ProviderConfigStore, type ProviderConfigPersist } from '../providers/config.js';

let tmpDir = '';
let spaceFile = '';
let customFile = '';

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'kodax-provider-test-'));
  spaceFile = path.join(tmpDir, 'space-config.json');
  customFile = path.join(tmpDir, 'custom.json');
});

afterEach(async () => {
  try {
    await fs.rm(tmpDir, { recursive: true, force: true });
  } catch {
    // ignore
  }
});

function newStore(persist?: ProviderConfigPersist): ProviderConfigStore {
  return new ProviderConfigStore(spaceFile, tmpDir, customFile, tmpDir, persist);
}

async function directPersist(dir: string, filePath: string, data: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(filePath, data, 'utf8');
}

test('load: empty when files do not exist', async () => {
  const store = newStore();
  await store.load();
  assert.equal(store.getDefaultProviderId(), null);
  assert.deepEqual(store.listCustom(), []);
});

test('setDefault then getDefaultProviderId', async () => {
  const store = newStore();
  await store.load();
  await store.setDefault('anthropic');
  assert.equal(store.getDefaultProviderId(), 'anthropic');
});

test('default persists across store reinstantiation', async () => {
  const s1 = newStore();
  await s1.load();
  await s1.setDefault('zhipu-coding');

  const s2 = newStore();
  await s2.load();
  assert.equal(s2.getDefaultProviderId(), 'zhipu-coding');
});

test('clearDefault sets to null', async () => {
  const store = newStore();
  await store.load();
  await store.setDefault('anthropic');
  await store.clearDefault();
  assert.equal(store.getDefaultProviderId(), null);
});

test('addCustom generates custom_<hex> id matching schema regex', async () => {
  const store = newStore();
  await store.load();
  const id = await store.addCustom({
    displayName: 'My Gateway',
    protocol: 'openai',
    baseUrl: 'https://gw.example.com/v1',

    apiKeyEnv: 'GW_KEY',
    defaultModel: 'gpt-4o',
  });
  // H3-code fix: randomBytes(8) → 16 hex chars
  assert.match(id, /^custom_[a-f0-9]{16}$/);
});

test('addCustom persists provider with all fields', async () => {
  const store = newStore();
  await store.load();
  const id = await store.addCustom({
    displayName: 'My GW',
    protocol: 'anthropic',
    baseUrl: 'https://api.example.com/v1',
    apiKeyEnv: 'MY_KEY',
    defaultModel: 'claude-3',
    models: ['claude-3', 'claude-3-haiku'],
    promptCacheAffinity: true,
    contextWindow: 131_072,
  });
  const list = store.listCustom();
  assert.equal(list.length, 1);
  assert.equal(list[0].id, id);
  assert.equal(list[0].displayName, 'My GW');
  assert.equal(list[0].protocol, 'anthropic');
  assert.equal(list[0].baseUrl, 'https://api.example.com/v1');
  assert.deepEqual(list[0].models, ['claude-3', 'claude-3-haiku']);
  assert.equal(list[0].promptCacheAffinity, true);
  assert.equal(list[0].contextWindow, 131_072);
});

test('updateCustom replaces editable fields while preserving id and createdAt', async () => {
  const store = newStore();
  await store.load();
  const id = await store.addCustom({
    displayName: 'Old GW',
    protocol: 'openai',
    baseUrl: 'https://old.example.com/v1',
    apiKeyEnv: 'OLD_KEY',
    defaultModel: 'old-model',
    models: ['old-model'],
  });
  const createdAt = store.getCustom(id)?.createdAt;

  assert.equal(
    await store.updateCustom(id, {
      displayName: 'New GW',
      protocol: 'anthropic',
      baseUrl: 'https://new.example.com/v1',
      apiKeyEnv: 'NEW_KEY',
      defaultModel: 'new-model',
      models: ['new-model', 'new-alt'],
      promptCacheAffinity: true,
      contextWindow: 262_144,
    }),
    true,
  );

  const updated = store.getCustom(id);
  assert.equal(updated?.id, id);
  assert.equal(updated?.createdAt, createdAt);
  assert.equal(updated?.displayName, 'New GW');
  assert.equal(updated?.protocol, 'anthropic');
  assert.equal(updated?.baseUrl, 'https://new.example.com/v1');
  assert.equal(updated?.apiKeyEnv, 'NEW_KEY');
  assert.deepEqual(updated?.models, ['new-model', 'new-alt']);
  assert.equal(updated?.promptCacheAffinity, true);
  assert.equal(updated?.contextWindow, 262_144);
});
test('removeCustom returns true for existing, false for missing', async () => {
  const store = newStore();
  await store.load();
  const id = await store.addCustom({
    displayName: 'X',
    protocol: 'openai',
    baseUrl: 'https://x.example.com/v1',
    apiKeyEnv: 'X_KEY',
    defaultModel: 'm',
  });
  assert.equal(await store.removeCustom(id), true);
  assert.equal(await store.removeCustom(id), false);
});

test('removeCustom clears default when deleting the default custom provider', async () => {
  const store = newStore();
  await store.load();
  const id = await store.addCustom({
    displayName: 'Default Custom',
    protocol: 'openai',
    baseUrl: 'https://default-custom.example.com/v1',
    apiKeyEnv: 'DEFAULT_CUSTOM_KEY',
    defaultModel: 'm',
  });
  await store.setDefault(id);

  assert.equal(await store.removeCustom(id), true);
  assert.equal(store.getDefaultProviderId(), null);

  const reloaded = newStore();
  await reloaded.load();
  assert.equal(reloaded.getDefaultProviderId(), null);
});

test('removeCustom leaves built-in default intact when deleting another custom provider', async () => {
  const store = newStore();
  await store.load();
  const id = await store.addCustom({
    displayName: 'Other Custom',
    protocol: 'openai',
    baseUrl: 'https://other-custom.example.com/v1',
    apiKeyEnv: 'OTHER_CUSTOM_KEY',
    defaultModel: 'm',
  });
  await store.setDefault('anthropic');

  assert.equal(await store.removeCustom(id), true);
  assert.equal(store.getDefaultProviderId(), 'anthropic');
});

test('removeCustom refuses to remove a built-in id', async () => {
  const store = newStore();
  await store.load();
  assert.equal(await store.removeCustom('anthropic'), false);
});

test('custom providers persist across store reinstantiation', async () => {
  const s1 = newStore();
  await s1.load();
  await s1.addCustom({
    displayName: 'P1',
    protocol: 'openai',
    baseUrl: 'https://p1.example.com/v1',
    apiKeyEnv: 'P1_KEY',
    defaultModel: 'm1',
  });
  await s1.addCustom({
    displayName: 'P2',
    protocol: 'anthropic',
    baseUrl: 'https://p2.example.com/v1',
    apiKeyEnv: 'P2_KEY',
    defaultModel: 'm2',
  });

  const s2 = newStore();
  await s2.load();
  assert.equal(s2.listCustom().length, 2);
});

test('custom provider image-input opt-in persists across store reinstantiation', async () => {
  const writer = newStore();
  await writer.load();
  const id = await writer.addCustom({
    displayName: 'Vision Gateway',
    protocol: 'openai',
    baseUrl: 'https://vision.example.com/v1',
    apiKeyEnv: 'VISION_GATEWAY_API_KEY',
    defaultModel: 'qwen-vl',
    imageInput: true,
  });

  const reader = newStore();
  await reader.load();
  assert.equal(reader.getCustom(id)?.imageInput, true);
});

test('corrupted JSON: invalid syntax → falls back to empty + no throw', async () => {
  await fs.mkdir(tmpDir, { recursive: true });
  await fs.writeFile(spaceFile, '{not valid', 'utf-8');
  await fs.writeFile(customFile, 'also not valid', 'utf-8');

  const store = newStore();
  await store.load();
  assert.equal(store.getDefaultProviderId(), null);
  assert.deepEqual(store.listCustom(), []);
  // 仍能正常写入
  await store.setDefault('openai');
  assert.equal(store.getDefaultProviderId(), 'openai');
});

test('schema-valid-but-wrong-shape: invalid version → empty fallback', async () => {
  await fs.mkdir(tmpDir, { recursive: true });
  await fs.writeFile(spaceFile, JSON.stringify({ version: 99, defaultProviderId: 'x' }), 'utf-8');
  const store = newStore();
  await store.load();
  assert.equal(store.getDefaultProviderId(), null);
});

test('concurrent addCustom: no lost update', async () => {
  const store = newStore();
  await store.load();
  await Promise.all([
    store.addCustom({
      displayName: 'A',
      protocol: 'openai',
      baseUrl: 'https://a/v1',
      apiKeyEnv: 'A_KEY',
      defaultModel: 'm',
    }),
    store.addCustom({
      displayName: 'B',
      protocol: 'openai',
      baseUrl: 'https://b/v1',
      apiKeyEnv: 'B_KEY',
      defaultModel: 'm',
    }),
    store.addCustom({
      displayName: 'C',
      protocol: 'openai',
      baseUrl: 'https://c/v1',
      apiKeyEnv: 'C_KEY',
      defaultModel: 'm',
    }),
  ]);
  assert.equal(store.listCustom().length, 3);

  const store2 = newStore();
  await store2.load();
  assert.equal(store2.listCustom().length, 3);
});

test('failed add persistence does not publish a ghost provider to the cache', async () => {
  const store = newStore(async () => {
    throw new Error('custom provider write failed');
  });
  await store.load();

  await assert.rejects(
    store.addCustom({
      displayName: 'Ghost',
      protocol: 'openai',
      baseUrl: 'https://ghost.example/v1',
      apiKeyEnv: 'GHOST_KEY',
      defaultModel: 'ghost',
    }),
    /custom provider write failed/,
  );

  assert.deepEqual(store.listCustom(), []);
  const reloaded = newStore();
  await reloaded.load();
  assert.deepEqual(reloaded.listCustom(), []);
});

test('failed update persistence keeps both cache and disk on the previous provider', async () => {
  let customWrites = 0;
  const store = newStore(async (dir, filePath, data) => {
    if (filePath === customFile && ++customWrites === 2) {
      throw new Error('provider update write failed');
    }
    await directPersist(dir, filePath, data);
  });
  await store.load();
  const id = await store.addCustom({
    displayName: 'Before',
    protocol: 'openai',
    baseUrl: 'https://before.example/v1',
    apiKeyEnv: 'BEFORE_KEY',
    defaultModel: 'before',
  });

  await assert.rejects(
    store.updateCustom(id, {
      displayName: 'After',
      protocol: 'openai',
      baseUrl: 'https://after.example/v1',
      apiKeyEnv: 'AFTER_KEY',
      defaultModel: 'after',
    }),
    /provider update write failed/,
  );

  assert.equal(store.getCustom(id)?.displayName, 'Before');
  const reloaded = newStore();
  await reloaded.load();
  assert.equal(reloaded.getCustom(id)?.displayName, 'Before');
});

test('failed default persistence leaves the cached default unchanged', async () => {
  const store = newStore(async (dir, filePath, data) => {
    if (filePath === spaceFile) throw new Error('default write failed');
    await directPersist(dir, filePath, data);
  });
  await store.load();

  await assert.rejects(store.setDefault('openai'), /default write failed/);

  assert.equal(store.getDefaultProviderId(), null);
  const reloaded = newStore();
  await reloaded.load();
  assert.equal(reloaded.getDefaultProviderId(), null);
});

test('removing the default provider compensates the first file when the second write fails', async () => {
  let spaceWrites = 0;
  const store = newStore(async (dir, filePath, data) => {
    if (filePath === spaceFile && ++spaceWrites === 2) {
      throw new Error('default clear write failed');
    }
    await directPersist(dir, filePath, data);
  });
  await store.load();
  const id = await store.addCustom({
    displayName: 'Default',
    protocol: 'openai',
    baseUrl: 'https://default.example/v1',
    apiKeyEnv: 'DEFAULT_KEY',
    defaultModel: 'default',
  });
  await store.setDefault(id);

  await assert.rejects(store.removeCustom(id), /default clear write failed/);

  assert.equal(store.getCustom(id)?.displayName, 'Default');
  assert.equal(store.getDefaultProviderId(), id);
  const reloaded = newStore();
  await reloaded.load();
  assert.equal(reloaded.getCustom(id)?.displayName, 'Default');
  assert.equal(reloaded.getDefaultProviderId(), id);
});
