// user-config tests — v0.1.6 cleanup
//
// loader 是 SDK loadConfig 的薄包装；测试用 setUserConfigImpl 注入 mock 验证：
//   - 默认值字段映射 (provider/model/thinking/reasoningMode/permissionMode/customProvidersCount)
//   - permissionMode 只接 'plan' / 'accept-edits'，KodaX 的 'default'/'bypass-permissions' → undefined
//   - reasoningCeiling > reasoningMode 优先 (v0.7.29 兼容)
//   - registerKodaxCustomProviders 把数组传给 SDK；空 / undefined skip
//   - SDK loadConfig 抛异常 fallback 全 undefined + count=0
//
// 不测 SDK 端 loadConfig 真行为—— DI mock 隔离。

import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  loadKodaxCompactionConfig,
  loadKodaxConfigOverview,
  loadKodaxCustomProviders,
  loadKodaxAutoModeDefaults,
  loadKodaxUserDefaults,
  registerKodaxCustomProviders,
  removeKodaxConfigCustomProvider,
  setUserConfigImpl,
  updateKodaxCompactionConfig,
  updateKodaxConfigCustomProvider,
  type KodaxUserConfigImpl,
} from '../kodax/user-config.js';

afterEach(() => {
  setUserConfigImpl(null); // 恢复 default
});

function mockUserConfig(
  config: Record<string, unknown>,
  hooks: Partial<{
    registerCalls: Array<{ customProviders?: unknown[] }>;
    throwOnLoad: Error;
    throwOnRegister: Error;
    saveCalls: unknown[];
  }> = {},
): void {
  const impl: KodaxUserConfigImpl = {
    loadConfig: (() => {
      if (hooks.throwOnLoad) throw hooks.throwOnLoad;
      return config;
    }) as never,
    saveConfig: ((next: Record<string, unknown>) => {
      hooks.saveCalls?.push(next);
      for (const key of Object.keys(config)) delete config[key];
      Object.assign(config, next);
    }) as never,
    registerCustomProviders: ((cfg: { customProviders?: unknown[] }) => {
      if (hooks.throwOnRegister) throw hooks.throwOnRegister;
      hooks.registerCalls?.push(cfg);
    }) as never,
  };
  setUserConfigImpl(impl);
}

test('empty config → optional user fields undefined with explicit Auto LLM 0.7.77 defaults', async () => {
  mockUserConfig({});
  const d = await loadKodaxUserDefaults();
  assert.equal(d.provider, undefined);
  assert.equal(d.model, undefined);
  assert.equal(d.thinking, undefined);
  assert.equal(d.reasoningMode, undefined);
  assert.equal(d.permissionMode, undefined);
  assert.equal(d.autoModeEngine, 'llm');
  assert.equal(d.autoModeClassifierModel, undefined);
  assert.equal(d.autoModeTimeoutMs, 20_000);
  assert.equal(d.customProvidersCount, 0);
});

test('full config maps all scalars', async () => {
  mockUserConfig({
    provider: 'ark-coding',
    model: 'glm-5.1',
    thinking: true,
    reasoningMode: 'auto',
    permissionMode: 'accept-edits',
    customProviders: [{ name: 'a' }, { name: 'b' }],
  });
  const d = await loadKodaxUserDefaults();
  assert.equal(d.provider, 'ark-coding');
  assert.equal(d.model, 'glm-5.1');
  assert.equal(d.thinking, true);
  assert.equal(d.reasoningMode, 'auto');
  assert.equal(d.permissionMode, 'accept-edits');
  assert.equal(d.customProvidersCount, 2);
});

test('reasoningCeiling preferred over reasoningMode when both set (v0.7.29+ compat)', async () => {
  mockUserConfig({
    reasoningMode: 'quick',
    reasoningCeiling: 'deep',
  });
  const d = await loadKodaxUserDefaults();
  assert.equal(d.reasoningMode, 'deep');
});

test('reasoningCeiling alone is used', async () => {
  mockUserConfig({ reasoningCeiling: 'balanced' });
  const d = await loadKodaxUserDefaults();
  assert.equal(d.reasoningMode, 'balanced');
});

test('effort preferred over legacy reasoning fields (v0.7.57 compat)', async () => {
  mockUserConfig({
    effort: 'medium',
    reasoningCeiling: 'deep',
    reasoningMode: 'quick',
  });
  const d = await loadKodaxUserDefaults();
  assert.equal(d.reasoningMode, 'balanced');
});

test('effort aliases map to Space reasoning defaults', async () => {
  mockUserConfig({ effort: 'off' });
  assert.equal((await loadKodaxUserDefaults()).reasoningMode, 'off');

  mockUserConfig({ effort: 'max' });
  assert.equal((await loadKodaxUserDefaults()).reasoningMode, 'deep');

  mockUserConfig({ effort: 'vendor-custom' });
  assert.equal((await loadKodaxUserDefaults()).reasoningMode, undefined);
});

test('reasoning invalid value → undefined', async () => {
  mockUserConfig({ reasoningMode: 'nonsense' });
  const d = await loadKodaxUserDefaults();
  assert.equal(d.reasoningMode, undefined);
});

test('KodaX permissionMode "default" → undefined (Space schema has no "default")', async () => {
  mockUserConfig({ permissionMode: 'default' });
  const d = await loadKodaxUserDefaults();
  assert.equal(d.permissionMode, undefined);
});

test('KodaX permissionMode "bypass-permissions" → undefined (Space uses auto+rules instead)', async () => {
  mockUserConfig({ permissionMode: 'bypass-permissions' });
  const d = await loadKodaxUserDefaults();
  assert.equal(d.permissionMode, undefined);
});

test('KodaX permissionMode "plan" / "accept-edits" → 1:1 map', async () => {
  mockUserConfig({ permissionMode: 'plan' });
  assert.equal((await loadKodaxUserDefaults()).permissionMode, 'plan');
  mockUserConfig({ permissionMode: 'accept-edits' });
  assert.equal((await loadKodaxUserDefaults()).permissionMode, 'accept-edits');
});

test('SDK loadConfig throws → safe fallback', async () => {
  mockUserConfig({}, { throwOnLoad: new Error('SDK boom') });
  const d = await loadKodaxUserDefaults();
  assert.equal(d.provider, undefined);
  assert.equal(d.customProvidersCount, 0);
});

test('empty / non-string provider → undefined', async () => {
  mockUserConfig({ provider: '' });
  assert.equal((await loadKodaxUserDefaults()).provider, undefined);
  mockUserConfig({ provider: 123 });
  assert.equal((await loadKodaxUserDefaults()).provider, undefined);
});

test('loadKodaxCustomProviders exposes SDK config custom providers as Space summaries', async () => {
  mockUserConfig({
    customProviders: [
      {
        name: 'newapi-anthropic',
        protocol: 'anthropic',
        baseUrl: 'https://llm.example.com/v1',
        apiKeyEnv: 'NEWAPI_API_KEY',
        model: 'claude-sonnet-4-6',
        models: ['claude-sonnet-4-6', { id: 'claude-opus-4-7' }],
        promptCacheAffinity: true,
      },
      {
        name: 'unsafe/provider',
        protocol: 'openai',
        baseUrl: 'https://llm.example.com/v1',
        apiKeyEnv: 'UNSAFE_API_KEY',
        model: 'gpt-5',
      },
      {
        name: 'node-options-injection',
        protocol: 'openai',
        baseUrl: 'https://llm.example.com/v1',
        apiKeyEnv: 'NODE_OPTIONS',
        model: 'gpt-5',
      },
      {
        name: 'metadata-ssrf',
        protocol: 'openai',
        baseUrl: 'https://169.254.169.254/latest/meta-data',
        apiKeyEnv: 'METADATA_API_KEY',
        model: 'gpt-5',
      },
    ],
  });

  const providers = await loadKodaxCustomProviders();
  assert.deepEqual(providers, [
    {
      id: 'newapi-anthropic',
      displayName: 'newapi-anthropic',
      protocol: 'anthropic',
      baseUrl: 'https://llm.example.com/v1',
      skipBaseUrlValidation: true,
      apiKeyEnv: 'NEWAPI_API_KEY',
      defaultModel: 'claude-sonnet-4-6',
      models: ['claude-sonnet-4-6', 'claude-opus-4-7'],
      promptCacheAffinity: true,
    },
    {
      id: 'metadata-ssrf',
      displayName: 'metadata-ssrf',
      protocol: 'openai',
      baseUrl: 'https://169.254.169.254/latest/meta-data',
      skipBaseUrlValidation: true,
      apiKeyEnv: 'METADATA_API_KEY',
      defaultModel: 'gpt-5',
    },
  ]);
});

test('registerKodaxCustomProviders forwards customProviders array to SDK', async () => {
  const calls: Array<{ customProviders?: unknown[] }> = [];
  mockUserConfig(
    {
      customProviders: [
        {
          name: 'p1',
          protocol: 'anthropic',
          baseUrl: 'https://p1.example.com/v1/',
          apiKeyEnv: 'P1_API_KEY',
          model: 'claude-sonnet-4-6',
          promptCacheAffinity: true,
        },
        {
          name: 'bad-env',
          protocol: 'anthropic',
          baseUrl: 'https://p2.example.com/v1',
          apiKeyEnv: 'NODE_OPTIONS',
          model: 'claude-sonnet-4-6',
        },
        {
          name: 'bad-url',
          protocol: 'anthropic',
          baseUrl: 'http://169.254.169.254/latest/meta-data',
          apiKeyEnv: 'P3_API_KEY',
          model: 'claude-sonnet-4-6',
        },
      ],
    },
    { registerCalls: calls },
  );
  await registerKodaxCustomProviders();
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].customProviders, [
    {
      name: 'p1',
      protocol: 'anthropic',
      baseUrl: 'https://p1.example.com/v1',
      apiKeyEnv: 'P1_API_KEY',
      model: 'claude-sonnet-4-6',
      promptCacheAffinity: true,
    },
    {
      name: 'bad-url',
      protocol: 'anthropic',
      baseUrl: 'http://169.254.169.254/latest/meta-data',
      apiKeyEnv: 'P3_API_KEY',
      model: 'claude-sonnet-4-6',
    },
  ]);
});

test('registerKodaxCustomProviders merges Space custom providers into SDK registry config', async () => {
  const calls: Array<{ customProviders?: unknown[] }> = [];
  mockUserConfig(
    {
      customProviders: [
        {
          name: 'sdk-custom',
          protocol: 'openai',
          baseUrl: 'https://sdk.example.com/v1',
          apiKeyEnv: 'SDK_API_KEY',
          model: 'sdk-model',
        },
      ],
    },
    { registerCalls: calls },
  );

  await registerKodaxCustomProviders([
    {
      id: 'custom_0123456789abcdef',
      protocol: 'anthropic',
      baseUrl: 'https://space.example.com/v1/',
      apiKeyEnv: 'SPACE_API_KEY',
      defaultModel: 'space-model',
      models: ['space-model', 'space-alt'],
      promptCacheAffinity: true,
    },
    {
      id: 'custom_1111111111111111',
      protocol: 'anthropic',
      baseUrl: 'https://space.example.com/v1',
      apiKeyEnv: 'NODE_OPTIONS',
      defaultModel: 'space-model',
    },
    {
      id: 'custom_2222222222222222',
      protocol: 'anthropic',
      baseUrl: 'https://127.0.0.1/v1',
      apiKeyEnv: 'SPACE_LOCAL_API_KEY',
      defaultModel: 'space-model',
    },
  ]);

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].customProviders, [
    {
      name: 'sdk-custom',
      protocol: 'openai',
      baseUrl: 'https://sdk.example.com/v1',
      apiKeyEnv: 'SDK_API_KEY',
      model: 'sdk-model',
    },
    {
      name: 'custom_0123456789abcdef',
      protocol: 'anthropic',
      baseUrl: 'https://space.example.com/v1',
      apiKeyEnv: 'SPACE_API_KEY',
      model: 'space-model',
      models: ['space-model', 'space-alt'],
      promptCacheAffinity: true,
    },
  ]);
});

test('registerKodaxCustomProviders skips when customProviders empty', async () => {
  const calls: Array<{ customProviders?: unknown[] }> = [];
  mockUserConfig({ customProviders: [] }, { registerCalls: calls });
  await registerKodaxCustomProviders();
  assert.equal(calls.length, 0);
});

test('registerKodaxCustomProviders skips when customProviders absent', async () => {
  const calls: Array<{ customProviders?: unknown[] }> = [];
  mockUserConfig({}, { registerCalls: calls });
  await registerKodaxCustomProviders();
  assert.equal(calls.length, 0);
});

test('registerKodaxCustomProviders silent on SDK loadConfig throw', async () => {
  const calls: Array<{ customProviders?: unknown[] }> = [];
  mockUserConfig(
    { customProviders: [{ name: 'p1' }] },
    { throwOnLoad: new Error('config corrupt'), registerCalls: calls },
  );
  // 不应抛
  await registerKodaxCustomProviders();
  assert.equal(calls.length, 0);
});

test('registerKodaxCustomProviders silent when registerCustomProviders throws after successful loadConfig (reviewer LOW-B)', async () => {
  const calls: Array<{ customProviders?: unknown[] }> = [];
  mockUserConfig(
    { customProviders: [{ name: 'p1', protocol: 'anthropic' }] },
    { throwOnRegister: new Error('LLM registry rejected'), registerCalls: calls },
  );
  // SDK loadConfig 成功，registerCustomProviders 抛 — Space 应当吞掉异常不阻塞启动
  await registerKodaxCustomProviders();
  // calls 数组没 push (因为 throw 在 push 前)，但更重要是 await 完成不向上抛
  assert.equal(calls.length, 0);
});
test('updateKodaxConfigCustomProvider writes back custom provider and renames selected default', async () => {
  const config: Record<string, unknown> = {
    provider: 'sdk-custom',
    model: 'keep-model',
    customProviders: [
      {
        name: 'sdk-custom',
        protocol: 'openai',
        baseUrl: 'https://old.example.com/v1',
        apiKeyEnv: 'OLD_API_KEY',
        model: 'old-model',
      },
    ],
  };
  const saveCalls: unknown[] = [];
  mockUserConfig(config, { saveCalls });

  const result = await updateKodaxConfigCustomProvider('sdk-custom', {
    displayName: 'sdk-renamed',
    protocol: 'anthropic',
    baseUrl: 'https://new.example.com/v1',
    apiKeyEnv: 'NEW_API_KEY',
    defaultModel: 'new-model',
    models: ['new-model', 'new-alt'],
  });

  assert.deepEqual(result, { updated: true, providerId: 'sdk-renamed' });
  assert.equal(saveCalls.length, 1);
  assert.equal(config.provider, 'sdk-renamed');
  assert.equal(config.model, 'keep-model');
  assert.deepEqual(config.customProviders, [
    {
      name: 'sdk-renamed',
      protocol: 'anthropic',
      baseUrl: 'https://new.example.com/v1',
      apiKeyEnv: 'NEW_API_KEY',
      model: 'new-model',
      models: ['new-model', 'new-alt'],
    },
  ]);
});
test('updateKodaxConfigCustomProvider clears modeled opt-ins but preserves unmodeled CLI fields', async () => {
  // Space-form-modeled fields must disappear when omitted by an update (the user cleared
  // them); unmodeled fields the KodaX CLI set (reasoningProfile, custom headers,
  // supportsThinking) must survive the merge.
  const config: Record<string, unknown> = {
    customProviders: [
      {
        name: 'sdk-custom',
        protocol: 'openai',
        baseUrl: 'https://old.example.com/v1',
        apiKeyEnv: 'OLD_API_KEY',
        model: 'old-model',
        promptCacheAffinity: true,
        reasoning: { efforts: ['low', 'high'], default: 'high' },
        reasoningProfile: { effortStrategy: 'openai-chat-effort' },
        supportsThinking: true,
        headers: { 'x-cli-only': '1' },
      },
    ],
  };
  const saveCalls: unknown[] = [];
  mockUserConfig(config, { saveCalls });

  // update omits both modeled opt-ins → user cleared them in the form
  const result = await updateKodaxConfigCustomProvider('sdk-custom', {
    displayName: 'sdk-custom',
    protocol: 'openai',
    baseUrl: 'https://old.example.com/v1',
    apiKeyEnv: 'OLD_API_KEY',
    defaultModel: 'old-model',
    models: ['old-model'],
  });

  assert.deepEqual(result, { updated: true, providerId: 'sdk-custom' });
  const providers = config.customProviders as Array<Record<string, unknown>>;
  assert.equal(providers.length, 1);
  const p = providers[0];
  assert.equal('reasoning' in p, false, 'reasoning must be cleared, not preserved');
  assert.equal(
    'promptCacheAffinity' in p,
    false,
    'promptCacheAffinity must be cleared, not preserved',
  );
  // unmodeled CLI fields survive:
  assert.deepEqual(p.reasoningProfile, { effortStrategy: 'openai-chat-effort' });
  assert.equal(p.supportsThinking, true);
  assert.deepEqual(p.headers, { 'x-cli-only': '1' });
});

test('updateKodaxConfigCustomProvider rejects duplicate KodaX config provider names', async () => {
  const config: Record<string, unknown> = {
    customProviders: [
      {
        name: 'sdk-custom',
        protocol: 'openai',
        baseUrl: 'https://old.example.com/v1',
        apiKeyEnv: 'OLD_API_KEY',
        model: 'old-model',
      },
      {
        name: 'existing-custom',
        protocol: 'openai',
        baseUrl: 'https://existing.example.com/v1',
        apiKeyEnv: 'EXISTING_API_KEY',
        model: 'existing-model',
      },
    ],
  };
  const saveCalls: unknown[] = [];
  mockUserConfig(config, { saveCalls });

  await assert.rejects(
    () =>
      updateKodaxConfigCustomProvider('sdk-custom', {
        displayName: 'existing-custom',
        protocol: 'openai',
        baseUrl: 'https://new.example.com/v1',
        apiKeyEnv: 'NEW_API_KEY',
        defaultModel: 'new-model',
      }),
    /already exists/,
  );
  assert.equal(saveCalls.length, 0);
});

test('removeKodaxConfigCustomProvider writes back customProviders and clears selected default', async () => {
  const config: Record<string, unknown> = {
    provider: 'sdk-custom',
    customProviders: [
      {
        name: 'sdk-custom',
        protocol: 'openai',
        baseUrl: 'https://old.example.com/v1',
        apiKeyEnv: 'OLD_API_KEY',
        model: 'old-model',
      },
      {
        name: 'keep-custom',
        protocol: 'openai',
        baseUrl: 'https://keep.example.com/v1',
        apiKeyEnv: 'KEEP_API_KEY',
        model: 'keep-model',
      },
    ],
  };
  mockUserConfig(config);

  assert.equal(await removeKodaxConfigCustomProvider('sdk-custom'), true);
  assert.equal(config.provider, undefined);
  assert.deepEqual(config.customProviders, [
    {
      name: 'keep-custom',
      protocol: 'openai',
      baseUrl: 'https://keep.example.com/v1',
      apiKeyEnv: 'KEEP_API_KEY',
      model: 'keep-model',
    },
  ]);
});

test('load/update KodaX compaction config preserves unrelated config fields', async () => {
  const config: Record<string, unknown> = {
    provider: 'zhipu-coding',
    model: 'glm-5.2',
    compaction: {
      enabled: true,
      triggerPercent: 75,
      contextWindow: 1_000_000,
      pruningGapRatio: 0.8,
      customFutureField: 'keep-me',
    },
    mcpServers: {
      filesystem: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem'] },
    },
  };
  const saveCalls: unknown[] = [];
  mockUserConfig(config, { saveCalls });

  assert.deepEqual(await loadKodaxCompactionConfig(), {
    enabled: true,
    triggerPercent: 75,
    contextWindow: 1_000_000,
  });

  const overview = await updateKodaxCompactionConfig({
    enabled: false,
    triggerPercent: 60,
  } as unknown as Parameters<typeof updateKodaxCompactionConfig>[0]);

  assert.equal(saveCalls.length, 1);
  assert.equal(config.provider, 'zhipu-coding');
  assert.equal(config.model, 'glm-5.2');
  assert.deepEqual(config.compaction, {
    pruningGapRatio: 0.8,
    customFutureField: 'keep-me',
    enabled: true,
    triggerPercent: 60,
  });
  assert.equal(overview.compaction.enabled, true);
  assert.equal(overview.compaction.triggerPercent, 60);
  assert.equal(overview.mcp.globalServers, 1);
});

test('KodaX compaction stays enabled and clamps thresholds to 15-90', async () => {
  mockUserConfig({
    compaction: {
      enabled: false,
      triggerPercent: 95,
    },
  });

  assert.deepEqual(await loadKodaxCompactionConfig(), { enabled: true, triggerPercent: 90 });
  const overview = await loadKodaxConfigOverview();
  assert.deepEqual(overview.compaction, { enabled: true, triggerPercent: 90 });
});

test('Auto LLM defaults explicitly pin the KodaX 0.7.77 timeout', async () => {
  mockUserConfig({});

  assert.deepEqual(await loadKodaxAutoModeDefaults(), {
    engine: 'llm',
    timeoutMs: 20_000,
  });
});

test('Auto LLM config maps engine, classifier model and timeout', async () => {
  mockUserConfig({
    autoMode: {
      engine: 'rules',
      classifierModel: ' fast-provider:classifier ',
      timeoutMs: 35_500.9,
      speculativeWindowMs: 750,
    },
  });

  assert.deepEqual(await loadKodaxAutoModeDefaults(), {
    engine: 'rules',
    classifierModel: 'fast-provider:classifier',
    timeoutMs: 35_500,
    speculativeWindowMs: 750,
  });
});

test('valid Auto LLM env overrides config while invalid values fall through', async () => {
  const previous = {
    engine: process.env.KODAX_AUTO_MODE_ENGINE,
    classifierModel: process.env.KODAX_AUTO_MODE_CLASSIFIER_MODEL,
    timeoutMs: process.env.KODAX_AUTO_MODE_TIMEOUT_MS,
    speculativeWindowMs: process.env.KODAX_AUTO_SPECULATIVE_WINDOW_MS,
  };
  try {
    process.env.KODAX_AUTO_MODE_ENGINE = 'llm';
    process.env.KODAX_AUTO_MODE_CLASSIFIER_MODEL = 'env-provider:classifier';
    process.env.KODAX_AUTO_MODE_TIMEOUT_MS = '42000.8';
    process.env.KODAX_AUTO_SPECULATIVE_WINDOW_MS = '0';
    mockUserConfig({
      autoMode: {
        engine: 'rules',
        classifierModel: 'file-provider:classifier',
        timeoutMs: 31_000,
        speculativeWindowMs: 640,
      },
    });
    assert.deepEqual(await loadKodaxAutoModeDefaults(), {
      engine: 'llm',
      classifierModel: 'env-provider:classifier',
      timeoutMs: 42_000,
      speculativeWindowMs: 0,
    });

    process.env.KODAX_AUTO_MODE_ENGINE = 'invalid';
    process.env.KODAX_AUTO_MODE_CLASSIFIER_MODEL = '   ';
    process.env.KODAX_AUTO_MODE_TIMEOUT_MS = '-1';
    process.env.KODAX_AUTO_SPECULATIVE_WINDOW_MS = 'invalid';
    mockUserConfig({
      autoMode: {
        engine: 'rules',
        classifierModel: 'file-provider:classifier',
        timeoutMs: 31_000,
        speculativeWindowMs: 640,
      },
    });
    assert.deepEqual(await loadKodaxAutoModeDefaults(), {
      engine: 'rules',
      classifierModel: 'file-provider:classifier',
      timeoutMs: 31_000,
      speculativeWindowMs: 640,
    });
  } finally {
    restoreEnv('KODAX_AUTO_MODE_ENGINE', previous.engine);
    restoreEnv('KODAX_AUTO_MODE_CLASSIFIER_MODEL', previous.classifierModel);
    restoreEnv('KODAX_AUTO_MODE_TIMEOUT_MS', previous.timeoutMs);
    restoreEnv('KODAX_AUTO_SPECULATIVE_WINDOW_MS', previous.speculativeWindowMs);
    setUserConfigImpl(null);
  }
});

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

test('KodaX config overview clamps out-of-range compaction percentages', async () => {
  mockUserConfig({
    compaction: {
      enabled: true,
      triggerPercent: 101,
      contextWindow: 500,
    },
  });

  const overview = await loadKodaxConfigOverview();
  assert.deepEqual(overview.compaction, { enabled: true, triggerPercent: 90 });
});

// NOTE: reasoning is a Space-form-MODELED field (the form pre-fills it from the record and
// re-sends it on every save), so an omitted reasoning in an update means the user deliberately
// cleared it — see the "clears the reasoning declaration..." test above. Unmodeled fields the
// form never touches (customHeaders/reasoningProfile) are still preserved through the merge.
test('updateKodaxConfigCustomProvider keeps unmodeled CLI fields while updating modeled ones', async () => {
  const config: Record<string, unknown> = {
    customProviders: [
      {
        name: 'my-gw',
        protocol: 'openai',
        baseUrl: 'https://gw.example.com/v1',
        apiKeyEnv: 'MY_GW_API_KEY',
        model: 'm1',
        // unmodeled field set outside Space (e.g. hand-edited config.json / CLI)
        customHeaders: { 'x-team': 'a' },
      },
    ],
  };
  mockUserConfig(config);

  const res = await updateKodaxConfigCustomProvider('my-gw', {
    displayName: 'my-gw',
    protocol: 'openai',
    baseUrl: 'https://gw.example.com/v2',
    apiKeyEnv: 'MY_GW_API_KEY',
    defaultModel: 'm2',
  });
  assert.equal(res.updated, true);

  const saved = (config.customProviders as Array<Record<string, unknown>>)[0];
  assert.equal(saved.baseUrl, 'https://gw.example.com/v2');
  assert.equal(saved.model, 'm2');
  // Unmodeled field preserved (not clobbered by the rebuild):
  assert.deepEqual(saved.customHeaders, { 'x-team': 'a' });
});

test('updateKodaxConfigCustomProvider applies a form-supplied reasoning declaration', async () => {
  const config: Record<string, unknown> = {
    customProviders: [
      {
        name: 'gw',
        protocol: 'openai',
        baseUrl: 'https://x.example.com/v1',
        apiKeyEnv: 'GW_KEY',
        model: 'm',
        reasoning: 'none',
      },
    ],
  };
  mockUserConfig(config);

  await updateKodaxConfigCustomProvider('gw', {
    displayName: 'gw',
    protocol: 'openai',
    baseUrl: 'https://x.example.com/v1',
    apiKeyEnv: 'GW_KEY',
    defaultModel: 'm',
    reasoning: { efforts: ['low', 'high'], default: 'low' },
  });

  const saved = (config.customProviders as Array<Record<string, unknown>>)[0];
  assert.deepEqual(saved.reasoning, { efforts: ['low', 'high'], default: 'low' });
});
