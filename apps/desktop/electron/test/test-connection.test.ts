// test-connection — 走 SDK Provider.verifyCredential（FEATURE_216 / SDK 0.7.45）后的单测。
//
// 用依赖注入（testProvider 的第 3 参数 `deps`）替换 SDK，不碰真实网络 / 真实 SDK runtime：
//   - deps = 对象  → 用注入的 getProvider / createCustomProvider
//   - deps = null  → 模拟 SDK 动态 import 失败（降级路径）
//   - deps = undefined（生产）→ 真实 lazy-import @kodax-ai/kodax/llm

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { testProvider, type TestProviderModule } from '../providers/test-connection.js';
import type { BuiltinProvider } from '../providers/catalog.js';
import type { CustomProvider } from '../providers/config.js';

type VerifyResult = Awaited<
  ReturnType<ReturnType<TestProviderModule['getProvider']>['verifyCredential']>
>;

const BUILTIN: BuiltinProvider = {
  id: 'anthropic',
  displayName: 'Anthropic',
  apiKeyEnv: 'ANTHROPIC_API_KEY',
  protocol: 'anthropic',
  defaultModel: 'claude-sonnet-4-6',
  models: ['claude-sonnet-4-6'],
};

const CUSTOM: CustomProvider = {
  id: 'custom_0123456789abcdef',
  displayName: 'My Gateway',
  protocol: 'openai',
  baseUrl: 'https://api.example.com/v1',
  apiKeyEnv: 'MY_GATEWAY_KEY',
  defaultModel: 'gpt-x',
  createdAt: 0,
};

/** 造一个 KodaXVerifyCredentialResult。*/
function vr(over: Partial<VerifyResult>): VerifyResult {
  return {
    ok: false,
    durationMs: 50,
    approxTokensSpent: 0,
    strategy: 'count-tokens',
    ...over,
  } as VerifyResult;
}

/** deps：注入 getProvider（builtin 路径）+ createCustomProvider（custom 路径）。*/
function deps(opts: {
  verify?: VerifyResult;
  custom?: VerifyResult;
  createThrows?: boolean;
}): TestProviderModule {
  return {
    getProvider: (() => ({
      verifyCredential: async () => opts.verify ?? vr({ ok: true }),
    })) as TestProviderModule['getProvider'],
    createCustomProvider: (() => {
      if (opts.createThrows) throw new Error('bad config: protocol invalid');
      // 只需 verifyCredential，其余 KodaXBaseProvider 方法测试用不到
      return {
        verifyCredential: async () => opts.custom ?? vr({ ok: true }),
      } as unknown as ReturnType<TestProviderModule['createCustomProvider']>;
    }) as TestProviderModule['createCustomProvider'],
  };
}

// ---- builtin provider ----

test('builtin ok → { ok:true, latencyMs }', async () => {
  const r = await testProvider(BUILTIN, {}, deps({ verify: vr({ ok: true, durationMs: 42 }) }));
  assert.equal(r.ok, true);
  assert.equal(r.latencyMs, 42);
});

test('builtin verification uses the Provider instance instead of the env-prefiltered helper', async () => {
  const sdk = Object.assign(deps({ verify: vr({ ok: false, error: 'unconfigured' }) }), {
    getProvider: () => ({
      verifyCredential: async () => vr({ ok: true, durationMs: 17 }),
    }),
  }) as TestProviderModule;

  const r = await testProvider(BUILTIN, {}, sdk);

  assert.deepEqual(r, { ok: true, latencyMs: 17 });
});

const ERROR_CASES: ReadonlyArray<readonly [VerifyResult['error'], string]> = [
  ['unauthorized', 'unauthorized (check API key)'],
  ['network', 'network error'],
  ['timeout', 'timeout'],
  ['unsupported', 'provider does not support connection test'],
  ['unconfigured', 'no API key configured'],
  ['server_error', 'server error'],
  ['rate_limited', 'rate limited (try again later)'],
  ['unknown', 'unknown error'],
];

for (const [errEnum, expectedMsg] of ERROR_CASES) {
  test(`builtin error '${errEnum}' → '${expectedMsg}'`, async () => {
    const r = await testProvider(BUILTIN, {}, deps({ verify: vr({ ok: false, error: errEnum }) }));
    assert.equal(r.ok, false);
    assert.equal(r.error, expectedMsg);
  });
}

// ---- custom provider（走 createCustomProvider().verifyCredential()）----

test('custom provider ok → { ok:true }', async () => {
  const r = await testProvider(CUSTOM, {}, deps({ custom: vr({ ok: true, durationMs: 33 }) }));
  assert.equal(r.ok, true);
  assert.equal(r.latencyMs, 33);
});

test('custom provider unauthorized → mapped message', async () => {
  const r = await testProvider(
    CUSTOM,
    {},
    deps({ custom: vr({ ok: false, error: 'unauthorized' }) }),
  );
  assert.equal(r.ok, false);
  assert.equal(r.error, 'unauthorized (check API key)');
});

test('production connection test reports a missing exact credential without starting a request', async () => {
  const r = await testProvider(CUSTOM);

  assert.deepEqual(r, { ok: false, error: 'no API key configured' });
});

test('custom provider createCustomProvider throws → invalid config error', async () => {
  const r = await testProvider(CUSTOM, {}, deps({ createThrows: true }));
  assert.equal(r.ok, false);
  assert.match(r.error ?? '', /invalid custom provider config/);
});

test('custom provider SSRF baseUrl rejected before SDK call (defense-in-depth)', async () => {
  const evil: CustomProvider = { ...CUSTOM, baseUrl: 'http://169.254.169.254/v1' };
  const r = await testProvider(evil, {}, deps({ custom: vr({ ok: true }) }));
  assert.equal(r.ok, false);
  assert.match(r.error ?? '', /invalid baseUrl/);
});

test('custom provider can skip Space baseUrl guard for trusted internal gateway', async () => {
  const trusted: CustomProvider = {
    ...CUSTOM,
    baseUrl: 'http://10.8.0.12:8080/v1',
    skipBaseUrlValidation: true,
  };
  const r = await testProvider(trusted, {}, deps({ custom: vr({ ok: true, durationMs: 21 }) }));
  assert.equal(r.ok, true);
  assert.equal(r.latencyMs, 21);
});

// ---- SDK 不可用降级 ----

test('SDK import unavailable (deps=null) → degraded error', async () => {
  const r = await testProvider(BUILTIN, {}, null);
  assert.equal(r.ok, false);
  assert.match(r.error ?? '', /SDK unavailable/);
});
