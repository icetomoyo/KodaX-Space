import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_CONTEXT_CAP,
  getModelContextCap,
} from '../../renderer/src/shell/modelContextCaps.js';

test('GLM fallback caps track KodaX 0.7.56 provider capabilities', () => {
  assert.equal(getModelContextCap('glm-5.2'), 1_000_000);
  assert.equal(getModelContextCap('glm-5'), 200_000);
  assert.equal(getModelContextCap('glm-5.1'), 200_000);
  assert.equal(getModelContextCap('glm-5-turbo'), 200_000);
  assert.equal(getModelContextCap('glm-4.7'), 200_000);
});

test('Kimi K2 fallback caps track KodaX 0.7.58 provider capabilities (256k)', () => {
  assert.equal(getModelContextCap('kimi-k2.7-code'), 256_000);
  assert.equal(getModelContextCap('kimi-k2.6'), 256_000);
});

test('Kimi Code K3 fallback caps track KodaX 0.7.71 local context tiers', () => {
  assert.equal(getModelContextCap('k3'), 1_048_576);
  assert.equal(getModelContextCap('k3-256k'), 262_144);
});

test('unknown and empty models use conservative default cap', () => {
  assert.equal(getModelContextCap('unknown-model'), DEFAULT_CONTEXT_CAP);
  assert.equal(getModelContextCap(undefined), DEFAULT_CONTEXT_CAP);
});

// Regression: the fallback table must NEVER over-claim vs the SDK 0.7.58 truth
// (over-claiming tells the user they have room they don't have -> surprise compaction).
test('fallback caps do not over-claim vs SDK 0.7.58 per-model context windows', () => {
  // over-claim cases the old table got wrong:
  assert.equal(getModelContextCap('gpt-5.4'), 400_000); // was 1M (over)
  assert.equal(getModelContextCap('gpt-5.3-codex-spark'), 400_000); // was 1M (over)
  assert.equal(getModelContextCap('deepseek-v3.2'), 128_000); // was 1M (over)
  assert.equal(getModelContextCap('MiniMax-M2.7'), 204_800); // was 1M (over)
  assert.equal(getModelContextCap('MiniMax-M2.7-highspeed'), 204_800); // was 1M (over)
  // neighbors that ARE 1M must stay 1M (rule ordering sanity):
  assert.equal(getModelContextCap('deepseek-v4-pro'), 1_000_000);
  assert.equal(getModelContextCap('MiniMax-M3'), 1_000_000);
});

test('fallback caps track SDK 0.7.58 for flagship / previously-stale models', () => {
  assert.equal(getModelContextCap('claude-opus-4-8'), 1_000_000);
  assert.equal(getModelContextCap('claude-opus-4-7'), 1_000_000);
  assert.equal(getModelContextCap('claude-haiku-4-5'), 200_000);
  assert.equal(getModelContextCap('mimo-v2.5-pro'), 1_000_000); // was 128k (under)
});
