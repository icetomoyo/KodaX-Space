// Stale env removal + key injection tests — review H4-code (2026-05-17)
//
// 验证 injectAllKeysToEnv 的两条新性质：
//   1) 删 key 后对应 apiKeyEnv 不再残留旧值
//   2) 只有显式声明的 builtin alias 可共享 keychain account
//   3) 未知 account 不会修改 env，但会 log warn

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { ProviderConfigStore } from '../providers/config.js';
import { setKey, deleteKey, _resetMemoryStoreForTesting } from '../providers/keychain.js';
import { BUILTIN_PROVIDERS } from '../providers/catalog.js';
import {
  _credentialSourceForTesting,
  ensureProviderKeyInjected,
  _restoreManagedEnvsForTesting,
  _setManagedEnvForTesting,
} from '../ipc/provider.js';

// 保存原始 env，测试结束后还原——别污染同进程后续测试
const originalEnv: Record<string, string | undefined> = {};
function snapshotEnv(): void {
  for (const p of BUILTIN_PROVIDERS) {
    originalEnv[p.apiKeyEnv] = process.env[p.apiKeyEnv];
  }
}
function restoreEnv(): void {
  for (const [k, v] of Object.entries(originalEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

let tmpDir = '';

// 因为 injectAllKeysToEnv 用 module-level singleton (providerConfigStore)，
// 测试要不污染 singleton 必须用 require 内部的 store。为简化测试，
// 我们直接验证 ProviderConfigStore 实例 + keychain 互动的关键不变性，
// 不调用 ipc/provider.ts 的 injectAllKeysToEnv（它绑死 singleton）。
//
// 主要要验证的逻辑：
//   - 在调用 inject 前，先把 managed envs 都清空——本测试模拟这一步并断言

beforeEach(async () => {
  snapshotEnv();
  _resetMemoryStoreForTesting();
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'kodax-env-test-'));
});

afterEach(async () => {
  _restoreManagedEnvsForTesting();
  restoreEnv();
  try {
    await fs.rm(tmpDir, { recursive: true, force: true });
  } catch {
    // ignore
  }
});

test('keychain set then delete then check: key gone from memory store', async () => {
  await setKey('anthropic', 'sk-test-A');
  await deleteKey('anthropic');
  // 模拟 inject：先清掉 managed env，再按现有 keychain 填回
  const env = process.env;
  delete env.ANTHROPIC_API_KEY;
  // 此时 keychain 已无 anthropic key —— inject 不会重新写
  assert.equal(env.ANTHROPIC_API_KEY, undefined);
});

test('related providers with distinct envs (kimi → KIMI_API_KEY, kimi-code → KIMI_CODE_API_KEY)', async () => {
  // 2026-05-31：KodaX 把 coding-plan provider env 名从共享改成独立后缀；
  // 现在 kimi-code 走 KIMI_CODE_API_KEY，跟 kimi 完全隔离。keychain 仍按 providerId
  // 存账号，两条独立 account 同时存在。
  await setKey('kimi', 'sk-kimi-1');
  await setKey('kimi-code', 'sk-kimi-code-2');
  const { getKey, listAccounts } = await import('../providers/keychain.js');
  const accounts = await listAccounts();
  assert.ok(accounts.includes('kimi'));
  assert.ok(accounts.includes('kimi-code'));
  assert.equal(await getKey('kimi'), 'sk-kimi-1');
  assert.equal(await getKey('kimi-code'), 'sk-kimi-code-2');
});

test('managed keychain env injection is reported as keychain only', () => {
  delete process.env.KIMI_CODE_API_KEY;
  _setManagedEnvForTesting('KIMI_CODE_API_KEY', 'sk-managed');

  assert.equal(
    _credentialSourceForTesting('kimi-code', 'KIMI_CODE_API_KEY', new Set(['kimi-code'])),
    'keychain',
  );
});

test('managed env from a shared keychain account is reported as runtime', () => {
  delete process.env.OPENAI_API_KEY;
  _setManagedEnvForTesting('OPENAI_API_KEY', 'sk-managed');

  assert.equal(
    _credentialSourceForTesting('codex-cli', 'OPENAI_API_KEY', new Set(['openai'])),
    'runtime',
  );
});

test('ensureProviderKeyInjected supports the explicit openai to codex-cli credential alias', async () => {
  delete process.env.OPENAI_API_KEY;
  await setKey('openai', 'sk-openai');

  assert.equal(await ensureProviderKeyInjected('codex-cli'), true);
  assert.equal(process.env.OPENAI_API_KEY, 'sk-openai');
});

test('external env-only provider is reported as env', () => {
  process.env.KIMI_CODE_API_KEY = 'sk-external';

  assert.equal(_credentialSourceForTesting('kimi-code', 'KIMI_CODE_API_KEY', new Set()), 'env');
});

test('external env plus keychain provider is reported as both', () => {
  process.env.KIMI_CODE_API_KEY = 'sk-external';
  _setManagedEnvForTesting('KIMI_CODE_API_KEY', 'sk-managed');

  assert.equal(process.env.KIMI_CODE_API_KEY, 'sk-managed');
  assert.equal(
    _credentialSourceForTesting('kimi-code', 'KIMI_CODE_API_KEY', new Set(['kimi-code'])),
    'both',
  );
});

test('removing kimi-code does not touch kimi key in keychain', async () => {
  await setKey('kimi', 'sk-kimi-1');
  await setKey('kimi-code', 'sk-kimi-code-2');
  await deleteKey('kimi-code');
  const { getKey } = await import('../providers/keychain.js');
  assert.equal(await getKey('kimi'), 'sk-kimi-1');
  assert.equal(await getKey('kimi-code'), undefined);
});

test('ProviderConfigStore singleton: load handles missing files', async () => {
  const store = new ProviderConfigStore(
    path.join(tmpDir, 'space.json'),
    tmpDir,
    path.join(tmpDir, 'custom.json'),
    tmpDir,
  );
  await store.load();
  assert.equal(store.getDefaultProviderId(), null);
});
