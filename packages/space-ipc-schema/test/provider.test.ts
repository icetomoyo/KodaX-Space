import { test } from 'node:test';
import assert from 'node:assert/strict';

import { providerAddCustomChannel, providerUpdateCustomChannel } from '../src/index.js';

const BASE_INPUT = {
  displayName: 'Internal Gateway',
  protocol: 'openai' as const,
  apiKeyEnv: 'INTERNAL_GATEWAY_API_KEY',
  defaultModel: 'gateway-model',
};

test('provider.addCustom accepts internal http IP:port when URL safety checks are skipped', () => {
  const result = providerAddCustomChannel.input.safeParse({
    ...BASE_INPUT,
    baseUrl: 'http://10.8.0.12:8080/v1',
    skipBaseUrlValidation: true,
  });

  assert.equal(result.success, true);
});

test('provider.addCustom still rejects http URL when URL safety checks are not skipped', () => {
  const result = providerAddCustomChannel.input.safeParse({
    ...BASE_INPUT,
    baseUrl: 'http://10.8.0.12:8080/v1',
  });

  assert.equal(result.success, false);
});
test('provider.updateCustom accepts internal http IP:port when URL safety checks are skipped', () => {
  const result = providerUpdateCustomChannel.input.safeParse({
    ...BASE_INPUT,
    providerId: 'custom_0123456789abcdef',
    baseUrl: 'http://10.8.0.12:8080/v1',
    skipBaseUrlValidation: true,
  });

  assert.equal(result.success, true);
});

test('provider.updateCustom still rejects http URL when URL safety checks are not skipped', () => {
  const result = providerUpdateCustomChannel.input.safeParse({
    ...BASE_INPUT,
    providerId: 'custom_0123456789abcdef',
    baseUrl: 'http://10.8.0.12:8080/v1',
  });

  assert.equal(result.success, false);
});

test('provider custom inputs accept a provider context window', () => {
  const addResult = providerAddCustomChannel.input.safeParse({
    ...BASE_INPUT,
    baseUrl: 'https://gw.example.com/v1',
    contextWindow: 131_072,
  });
  const updateResult = providerUpdateCustomChannel.input.safeParse({
    ...BASE_INPUT,
    providerId: 'custom_0123456789abcdef',
    baseUrl: 'https://gw.example.com/v1',
    contextWindow: 262_144,
  });

  assert.equal(addResult.success, true);
  assert.equal(addResult.success ? addResult.data.contextWindow : undefined, 131_072);
  assert.equal(updateResult.success, true);
  assert.equal(updateResult.success ? updateResult.data.contextWindow : undefined, 262_144);
});

test('provider custom inputs reject invalid context windows', () => {
  for (const contextWindow of [1_023, 131_072.5, 10_000_001]) {
    const result = providerAddCustomChannel.input.safeParse({
      ...BASE_INPUT,
      baseUrl: 'https://gw.example.com/v1',
      contextWindow,
    });
    assert.equal(result.success, false, `expected ${contextWindow} to be rejected`);
  }
});

test('provider.addCustom accepts a friendly reasoning declaration', () => {
  const result = providerAddCustomChannel.input.safeParse({
    ...BASE_INPUT,
    baseUrl: 'https://gw.example.com/v1',
    reasoning: { efforts: ['off', 'low', 'high'], default: 'high' },
  });
  assert.equal(result.success, true);
});

test("provider.addCustom accepts reasoning 'none'", () => {
  const result = providerAddCustomChannel.input.safeParse({
    ...BASE_INPUT,
    baseUrl: 'https://gw.example.com/v1',
    reasoning: 'none',
  });
  assert.equal(result.success, true);
});

test('provider.addCustom rejects a reasoning declaration with an empty efforts list', () => {
  const result = providerAddCustomChannel.input.safeParse({
    ...BASE_INPUT,
    baseUrl: 'https://gw.example.com/v1',
    reasoning: { efforts: [] },
  });
  assert.equal(result.success, false);
});

test('provider.updateCustom carries the reasoning declaration', () => {
  const result = providerUpdateCustomChannel.input.safeParse({
    ...BASE_INPUT,
    providerId: 'custom_00000000000000ff',
    baseUrl: 'https://gw.example.com/v1',
    reasoning: { efforts: ['low', 'high'] },
  });
  assert.equal(result.success, true);
});

test('provider custom inputs accept an explicit prompt-cache affinity opt-in', () => {
  const result = providerAddCustomChannel.input.safeParse({
    ...BASE_INPUT,
    baseUrl: 'https://gw.example.com/v1',
    promptCacheAffinity: true,
  });
  assert.equal(result.success, true);
  assert.equal(result.success ? result.data.promptCacheAffinity : undefined, true);
});

test('provider custom inputs reject non-boolean prompt-cache affinity values', () => {
  const result = providerAddCustomChannel.input.safeParse({
    ...BASE_INPUT,
    baseUrl: 'https://gw.example.com/v1',
    promptCacheAffinity: 'yes',
  });
  assert.equal(result.success, false);
});
