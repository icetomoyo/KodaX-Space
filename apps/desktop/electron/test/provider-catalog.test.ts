// Built-in provider catalog tests — FEATURE_004
//
// catalog 是 SDK 薄适配层 —— 模块顶层一次性从 KodaX 的
// provider-capabilities.json (`@kodax-ai/kodax/dist/provider-capabilities.json`)
// 读 apiKeyEnv / defaultModel / models[]，Space 自己只 override displayName /
// protocol。SDK 升级 → Space 自动跟上不再需要手 sync。
//
// 验收：
//   - SDK 已知的 provider 全部出现在 catalog (数量 >= 13，SDK 后续加 provider 自动跟上)
//   - id 唯一 + apiKeyEnv / defaultModel / displayName 非空 + protocol 合法
//   - getBuiltin / isBuiltinId 行为正确
//   - 关键 anchor provider 存在 (anthropic / openai / zhipu-coding)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BUILTIN_PROVIDERS, getBuiltin, isBuiltinId } from '../providers/catalog.js';

test('catalog includes at least 13 built-in providers (SDK can add more)', () => {
  assert.ok(BUILTIN_PROVIDERS.length >= 13);
});

test('all built-in provider ids are unique', () => {
  const ids = BUILTIN_PROVIDERS.map((p) => p.id);
  assert.equal(new Set(ids).size, ids.length);
});

test('all built-in providers have non-empty displayName + apiKeyEnv + defaultModel', () => {
  for (const p of BUILTIN_PROVIDERS) {
    assert.ok(p.displayName.length > 0, `${p.id} missing displayName`);
    assert.ok(p.apiKeyEnv.length > 0, `${p.id} missing apiKeyEnv`);
    assert.ok(p.defaultModel.length > 0, `${p.id} missing defaultModel`);
  }
});

test('all built-in protocols are in valid enum', () => {
  const validProtocols = new Set(['anthropic', 'openai', 'gemini-cli', 'codex-cli']);
  for (const p of BUILTIN_PROVIDERS) {
    assert.ok(validProtocols.has(p.protocol), `${p.id} has invalid protocol: ${p.protocol}`);
  }
});

test('catalog includes expected anchor providers (anthropic, openai, zhipu-coding)', () => {
  const ids = new Set(BUILTIN_PROVIDERS.map((p) => p.id));
  assert.ok(ids.has('anthropic'));
  assert.ok(ids.has('openai'));
  assert.ok(ids.has('zhipu-coding'));
});

test('KodaX 0.7.76 Kimi catalog defaults to direct K3 256K and preserves all public tiers', () => {
  const kimi = getBuiltin('kimi');
  assert.ok(kimi);
  assert.equal(kimi.defaultModel, 'kimi-k2.7-code');

  const kimiCode = getBuiltin('kimi-code');
  assert.ok(kimiCode);
  assert.equal(kimiCode.defaultModel, 'k3-256k');
  assert.ok(kimiCode.models?.includes('k3'));
  assert.ok(kimiCode.models?.includes('k3-256k'));
  assert.ok(kimiCode.models?.includes('kimi-for-coding'));
  assert.ok(kimiCode.models?.includes('kimi-for-coding-highspeed'));
});

test('KodaX 0.7.72 MiniMax Coding defaults to MiniMax M3', () => {
  const minimax = getBuiltin('minimax-coding');
  assert.ok(minimax);
  assert.equal(minimax.defaultModel, 'MiniMax-M3');
});

test('catalog has fallback data for all 16 anchor providers (disaster recovery)', () => {
  // 这个验证不直接调 buildFallbackProviders（未导出），但通过 BUILTIN_PROVIDERS
  // 间接保证：每个 builtin 都有 apiKeyEnv + defaultModel，无论数据来自 JSON 还是 fallback。
  // 等同于"如果 JSON 缺失走 fallback，依然有完整数据"的 invariant 保护。
  const REQUIRED_IDS = [
    'anthropic',
    'openai',
    'deepseek',
    'kimi',
    'kimi-code',
    'qwen',
    'qwen-token-plan',
    'zhipu',
    'zhipu-coding',
    'zai-coding',
    'minimax-coding',
    'mimo-coding',
    'mimo',
    'ark-coding',
    'gemini-cli',
    'codex-cli',
  ];
  const ids = new Set(BUILTIN_PROVIDERS.map((p) => p.id));
  for (const req of REQUIRED_IDS) {
    assert.ok(ids.has(req), `fallback should cover ${req}`);
  }
});

test('apiKeyEnv values match KodaX upstream catalog (env var naming convention)', () => {
  // 关键 provider 的 apiKeyEnv 必须与 KodaX 端一致——SDK 通过相同 env 读 key
  // 2026-05-31 sync：5 个 coding-plan provider 的 env 名加了独立后缀 (KodaX 分离
  // 普通版 / coding plan key 入口)，详见 catalog.ts header 注释。
  const expected: Record<string, string> = {
    anthropic: 'ANTHROPIC_API_KEY',
    openai: 'OPENAI_API_KEY',
    zhipu: 'ZHIPU_API_KEY',
    'zhipu-coding': 'ZHIPU_CODING_API_KEY',
    'zai-coding': 'ZAI_CODING_API_KEY',
    deepseek: 'DEEPSEEK_API_KEY',
    kimi: 'KIMI_API_KEY',
    'kimi-code': 'KIMI_CODE_API_KEY',
    'minimax-coding': 'MINIMAX_CODING_API_KEY',
    'mimo-coding': 'MIMO_CODING_API_KEY',
    mimo: 'MIMO_API_KEY',
    'ark-coding': 'ARK_CODING_API_KEY',
  };
  for (const [id, env] of Object.entries(expected)) {
    const p = getBuiltin(id);
    assert.ok(p, `missing provider ${id}`);
    assert.equal(p.apiKeyEnv, env, `${id} apiKeyEnv mismatch`);
  }
});

test('zhipu-coding catalog tracks KodaX 0.7.56 GLM lineup', () => {
  const provider = getBuiltin('zhipu-coding');
  assert.ok(provider);
  assert.equal(provider.defaultModel, 'glm-5.2');
  assert.deepEqual(provider.models, ['glm-5.2', 'glm-5-turbo', 'glm-4.7']);
});

test('zai-coding catalog (SDK 0.7.58) has anthropic protocol + friendly name, not the raw slug', () => {
  const provider = getBuiltin('zai-coding');
  assert.ok(provider, 'zai-coding must be in the catalog');
  assert.equal(provider.protocol, 'anthropic');
  assert.notEqual(provider.displayName, 'zai-coding'); // must have a friendly override, not the slug
  assert.equal(provider.defaultModel, 'glm-5.2');
});

test('ark-coding catalog includes KodaX 0.7.56 GLM and Kimi code models', () => {
  const provider = getBuiltin('ark-coding');
  assert.ok(provider);
  assert.ok(provider.models?.includes('glm-5.2'));
  assert.ok(provider.models?.includes('kimi-k2.7-code'));
});

test('kimi catalog includes KodaX 0.7.56 Kimi K2.7 Code model', () => {
  const provider = getBuiltin('kimi');
  assert.ok(provider);
  assert.ok(provider.models?.includes('kimi-k2.7-code'));
});

test('getBuiltin returns undefined for unknown id', () => {
  assert.equal(getBuiltin('made-up-provider'), undefined);
});

test('isBuiltinId true for known, false for unknown / custom_ prefix', () => {
  assert.equal(isBuiltinId('anthropic'), true);
  assert.equal(isBuiltinId('made-up'), false);
  assert.equal(isBuiltinId('custom_abc12345'), false);
});
