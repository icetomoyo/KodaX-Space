// auto-activate tests — KX-I-01
//
// 验收：
//   1. defaultProviderId 已有值 → 不动 (尊重用户先前选择)
//   2. 没 default + 0 env key → 不动
//   3. 没 default + ANTHROPIC_API_KEY 有值 → 自动 setDefault('anthropic')
//   4. 没 default + ZHIPU + DEEPSEEK 都有 → 按 PRIORITY 选 deepseek (DEEPSEEK 在 zhipu 前)
//   5. getAutoActivatedThisBoot 返已激活全部 (不只 picked)

import { test, before, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import {
  autoActivateProvidersFromEnv,
  getAutoActivatedThisBoot,
  _resetAutoActivateForTesting,
} from '../providers/auto-activate.js';
import { providerConfigStore } from '../providers/config.js';
import { BUILTIN_PROVIDERS } from '../providers/catalog.js';
import { _resetMemoryStoreForTesting } from '../providers/keychain.js';

let tmpDir = '';
// 保存所有 builtin provider 的 apiKeyEnv 原值 —— 用户机器可能任何一个都已 set
const ALL_API_KEY_ENVS = Array.from(new Set(BUILTIN_PROVIDERS.map((b) => b.apiKeyEnv)));
const originalEnvValues: Record<string, string | undefined> = {};

before(() => {
  for (const k of ALL_API_KEY_ENVS) originalEnvValues[k] = process.env[k];
});

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'kodax-auto-activate-'));
  // 清掉所有 builtin apiKeyEnv，避免用户 shell 真实环境影响测试
  for (const k of ALL_API_KEY_ENVS) delete process.env[k];
  _resetMemoryStoreForTesting();
  _resetAutoActivateForTesting();
  // 重置 providerConfigStore singleton 的内部缓存：用反射重置 spaceCache
  // (test 模式没法 new ProviderConfigStore 替换 singleton，只能 reset cache)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (providerConfigStore as any).spaceCache = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (providerConfigStore as any).customCache = null;
  // 把 singleton 的 spaceFile/spaceDir 指到 tmpDir —— 反射改 readonly
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (providerConfigStore as any).spaceFile = path.join(tmpDir, 'space.json');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (providerConfigStore as any).spaceDir = tmpDir;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (providerConfigStore as any).customFile = path.join(tmpDir, 'custom.json');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (providerConfigStore as any).customDir = tmpDir;
});

afterEach(async () => {
  // 恢复所有 builtin apiKeyEnv 原始值
  for (const k of ALL_API_KEY_ENVS) {
    const orig = originalEnvValues[k];
    if (orig === undefined) delete process.env[k];
    else process.env[k] = orig;
  }
  try {
    await fs.rm(tmpDir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

test('does not override existing default', async () => {
  await providerConfigStore.load();
  await providerConfigStore.setDefault('openai');
  process.env.ANTHROPIC_API_KEY = 'sk-ant-xxx';
  await autoActivateProvidersFromEnv();
  assert.equal(providerConfigStore.getDefaultProviderId(), 'openai');
  assert.deepEqual(getAutoActivatedThisBoot(), []);
});

test('no default + no env keys → no change', async () => {
  await providerConfigStore.load();
  await autoActivateProvidersFromEnv();
  assert.equal(providerConfigStore.getDefaultProviderId(), null);
  assert.deepEqual(getAutoActivatedThisBoot(), []);
});

test('no default + ANTHROPIC_API_KEY → auto-set anthropic', async () => {
  await providerConfigStore.load();
  process.env.ANTHROPIC_API_KEY = 'sk-ant-xxx';
  await autoActivateProvidersFromEnv();
  assert.equal(providerConfigStore.getDefaultProviderId(), 'anthropic');
  assert.deepEqual(getAutoActivatedThisBoot(), ['anthropic']);
});

test('PRIORITY: when both DEEPSEEK and ZHIPU have keys, picks deepseek (higher priority)', async () => {
  await providerConfigStore.load();
  process.env.DEEPSEEK_API_KEY = 'sk-deepseek-xxx';
  process.env.ZHIPU_API_KEY = 'sk-zhipu-xxx';
  await autoActivateProvidersFromEnv();
  assert.equal(providerConfigStore.getDefaultProviderId(), 'deepseek');
  // 全部被记录 (排序不保证)
  const activated = [...getAutoActivatedThisBoot()].sort();
  assert.deepEqual(activated, ['deepseek', 'zhipu']);
});

test('empty/whitespace env value is treated as absent', async () => {
  await providerConfigStore.load();
  process.env.ANTHROPIC_API_KEY = '   '; // 空白被 trim 后是空
  await autoActivateProvidersFromEnv();
  assert.equal(providerConfigStore.getDefaultProviderId(), null);
  assert.deepEqual(getAutoActivatedThisBoot(), []);
});
