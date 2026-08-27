import assert from 'node:assert/strict';
import test from 'node:test';

import {
  registerCustomProviders,
  resolveWireEffort as resolveSdkWireEffort,
} from '@kodax-ai/kodax/coding';

import {
  effortToReasoningMode,
  reasoningModeToEffort,
  resolveSdkSpaceWireEffort,
  resolveSpaceWireEffort,
  runtimeSettingEffort,
} from '../kodax/reasoning-effort.js';

test('canonical efforts are preserved while legacy Space modes remain readable', () => {
  assert.equal(reasoningModeToEffort('off'), 'none');
  assert.equal(reasoningModeToEffort('minimal'), 'minimal');
  assert.equal(reasoningModeToEffort('low'), 'low');
  assert.equal(reasoningModeToEffort('medium'), 'medium');
  assert.equal(reasoningModeToEffort('high'), 'high');
  assert.equal(reasoningModeToEffort('xhigh'), 'xhigh');
  assert.equal(reasoningModeToEffort('max'), 'max');
  assert.equal(reasoningModeToEffort('quick'), 'low');
  assert.equal(reasoningModeToEffort('balanced'), 'medium');
  assert.equal(reasoningModeToEffort('deep'), 'max');
});

test('SDK effort projection keeps xhigh/max distinct and normalizes legacy aliases', () => {
  assert.equal(effortToReasoningMode('none'), 'off');
  assert.equal(effortToReasoningMode('minimal'), 'minimal');
  assert.equal(effortToReasoningMode('low'), 'low');
  assert.equal(effortToReasoningMode('medium'), 'medium');
  assert.equal(effortToReasoningMode('high'), 'high');
  assert.equal(effortToReasoningMode('xhigh'), 'xhigh');
  assert.equal(effortToReasoningMode('max'), 'max');
  assert.equal(effortToReasoningMode('quick'), 'low');
  assert.equal(effortToReasoningMode('balanced'), 'medium');
  assert.equal(effortToReasoningMode('deep'), 'max');
});

test('custom provider without a reasoning declaration omits reasoning_effort', () => {
  registerCustomProviders([
    {
      name: 'space-unprofiled-qwen',
      protocol: 'openai',
      baseUrl: 'http://127.0.0.1:8000/v1',
      apiKeyEnv: 'SPACE_TEST_QWEN_KEY',
      model: 'qwen3.8-27b',
    },
  ]);

  assert.equal(
    resolveSpaceWireEffort({
      provider: 'space-unprofiled-qwen',
      model: 'qwen3.8-27b',
      reasoningMode: 'deep',
      resolveWireEffort: resolveSdkWireEffort,
    }),
    undefined,
  );
});

test('SDK registry resolver also omits auto for an unprofiled custom provider', async () => {
  registerCustomProviders([
    {
      name: 'space-unprofiled-auto-qwen',
      protocol: 'openai',
      baseUrl: 'http://127.0.0.1:8000/v1',
      apiKeyEnv: 'SPACE_TEST_QWEN_KEY',
      model: 'qwen3.8-27b',
    },
  ]);

  assert.equal(
    await resolveSdkSpaceWireEffort({
      provider: 'space-unprofiled-auto-qwen',
      model: 'qwen3.8-27b',
      reasoningMode: 'auto',
    }),
    undefined,
  );
});

test('Runtime settings preserve supported auto intent but omit unsupported auto', () => {
  assert.equal(runtimeSettingEffort('auto', 'high'), 'auto');
  assert.equal(runtimeSettingEffort('auto', undefined), null);
  assert.equal(runtimeSettingEffort('high', 'xhigh'), 'xhigh');
});

test('SDK fallback matrix resolves unsupported high/max to declared xhigh', () => {
  registerCustomProviders([
    {
      name: 'space-profiled-qwen',
      protocol: 'openai',
      baseUrl: 'http://127.0.0.1:8000/v1',
      apiKeyEnv: 'SPACE_TEST_QWEN_KEY',
      model: 'qwen3.8-27b',
      reasoning: {
        efforts: ['off', 'low', 'medium', 'xhigh'],
        default: 'xhigh',
      },
    },
  ]);

  const resolve = (reasoningMode: 'high' | 'xhigh' | 'max' | 'off'): string | undefined =>
    resolveSpaceWireEffort({
      provider: 'space-profiled-qwen',
      model: 'qwen3.8-27b',
      reasoningMode,
      resolveWireEffort: resolveSdkWireEffort,
    });

  assert.equal(resolve('high'), 'xhigh');
  assert.equal(resolve('xhigh'), 'xhigh');
  assert.equal(resolve('max'), 'xhigh');
  assert.equal(resolve('off'), 'none');
});

test('learned wire rejections are delegated to the SDK resolver', () => {
  registerCustomProviders([
    {
      name: 'space-rejected-max',
      protocol: 'openai',
      baseUrl: 'http://127.0.0.1:8000/v1',
      apiKeyEnv: 'SPACE_TEST_QWEN_KEY',
      model: 'reasoner',
      reasoning: { efforts: ['low', 'medium', 'high', 'xhigh', 'max'], default: 'max' },
    },
  ]);

  const resolved = resolveSpaceWireEffort({
    provider: 'space-rejected-max',
    model: 'reasoner',
    reasoningMode: 'max',
    rejectedEfforts: ['max'],
    resolveWireEffort: resolveSdkWireEffort,
  });
  const sdkResolved = resolveSdkWireEffort({
    provider: 'space-rejected-max',
    model: 'reasoner',
    desiredEffort: 'max',
    rejectedEfforts: ['max'],
  }).effort;

  assert.equal(resolved, sdkResolved);
  assert.notEqual(resolved, 'max');
});
