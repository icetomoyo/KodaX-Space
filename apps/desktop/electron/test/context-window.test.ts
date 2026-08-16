import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeModelContextWindow,
  SDK_HARD_FALLBACK_CONTEXT_WINDOW,
} from '../providers/context-window.js';

// ---- Pure logic (no SDK) --------------------------------------------------

test('computeModelContextWindow: provider-advertised value passes through as "provider"', () => {
  const provider = { getEffectiveContextWindow: () => 1_000_000 };
  const r = computeModelContextWindow(provider, 'glm-5.2', () => 1_000_000);
  assert.deepEqual(r, { contextWindow: 1_000_000, source: 'provider' });
});

test('computeModelContextWindow: real 200k on a provider WITH resolver methods stays "provider"', () => {
  // e.g. claude — genuinely 200k, not a fallback.
  const provider = { getEffectiveContextWindow: () => 200_000 };
  const r = computeModelContextWindow(provider, 'claude-sonnet-4-6', () => 200_000);
  assert.deepEqual(r, { contextWindow: 200_000, source: 'provider' });
});

test('computeModelContextWindow: 200k with NO resolver methods is flagged "fallback"', () => {
  // custom_* / unresolved provider — renderer should prefer its hardcoded table.
  const provider = {};
  const r = computeModelContextWindow(provider, 'whatever', () => SDK_HARD_FALLBACK_CONTEXT_WINDOW);
  assert.deepEqual(r, { contextWindow: 200_000, source: 'fallback' });
});

test('computeModelContextWindow: effective compaction context override reaches the SDK resolver', () => {
  let received: unknown;
  const r = computeModelContextWindow(
    { getEffectiveContextWindow: () => 1_000_000 },
    'k3',
    (config) => {
      received = config;
      return config.contextWindow ?? 1_000_000;
    },
    { enabled: true, triggerPercent: 40, triggerTokens: 120_000, contextWindow: 400_000 },
  );

  assert.deepEqual(received, {
    enabled: true,
    triggerPercent: 40,
    triggerTokens: 120_000,
    contextWindow: 400_000,
  });
  assert.equal(r.contextWindow, 400_000);
});

// ---- Real SDK regression guard -------------------------------------------
//
// Guards the exact "反复出问题" regression: GLM-5.2 on the coding-plan providers
// must report its real 1M window, and Space must resolve it via the runtime
// cascade (resolveContextWindow), NOT resolveModelCapabilities().contextWindow
// which SDK 0.7.58 returns as the provider default (200k) when the queried model
// equals the provider's default model.

test('real SDK: GLM-5.2 on coding-plan providers resolves to 1M via Space helper', async () => {
  const coding = await import('@kodax-ai/kodax/coding');
  const agent = await import('@kodax-ai/kodax/agent');

  for (const providerId of ['zhipu-coding', 'zai-coding']) {
    const provider = coding.resolveProvider(providerId) as {
      getEffectiveContextWindow?: unknown;
      getContextWindow?: unknown;
    };
    const r = computeModelContextWindow(provider, 'glm-5.2', agent.resolveContextWindow);
    assert.equal(
      r.contextWindow,
      1_000_000,
      `${providerId}/glm-5.2 must report 1M (got ${r.contextWindow}); ` +
        'if this fails, Space likely regressed to resolveModelCapabilities().contextWindow',
    );
    assert.equal(r.source, 'provider', `${providerId}/glm-5.2 source should be 'provider'`);
  }
});

test('real SDK 0.7.77: public Kimi K3 resolves to 1,048,576 tokens', async () => {
  const coding = await import('@kodax-ai/kodax/coding');
  const agent = await import('@kodax-ai/kodax/agent');
  const provider = coding.resolveProvider('kimi') as {
    getEffectiveContextWindow?: unknown;
    getContextWindow?: unknown;
  };

  assert.deepEqual(computeModelContextWindow(provider, 'kimi-k3', agent.resolveContextWindow), {
    contextWindow: 1_048_576,
    source: 'provider',
  });
});

test('real SDK: resolveModelCapabilities default-model context bug is FIXED in 0.7.59', async () => {
  // Historically (SDK 0.7.58) resolveModelCapabilities('zhipu-coding', 'glm-5.2')
  // returned the provider-level default (200k) whenever the queried model equaled
  // the provider's default model — the bug Space works around via the runtime
  // cascade (resolveContextWindow). SDK 0.7.59 fixed it: both the default-model and
  // non-default paths now read the model-level 1M window. Space still uses the
  // cascade helper (provider-agnostic and correct either way); this now guards that
  // the SDK fix holds rather than that the bug persists.
  const llm = await import('@kodax-ai/kodax/llm');
  const wasBuggy = llm.resolveModelCapabilities('zhipu-coding', 'glm-5.2');
  const healthy = llm.resolveModelCapabilities('zhipu', 'glm-5.2');
  assert.equal(
    healthy?.contextWindow,
    1_000_000,
    'zhipu (default=glm-5) reads model-level correctly',
  );
  assert.equal(
    wasBuggy?.contextWindow,
    1_000_000,
    'zhipu-coding with explicit glm-5.2 reads model-level 1M — the 0.7.58 default-model bug is fixed',
  );
});
