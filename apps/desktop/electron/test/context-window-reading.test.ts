import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveContextWindowReading } from '../../renderer/src/shell/contextWindowReading.js';

test('provider policy uses the provider window and final KodaX threshold', () => {
  assert.deepEqual(
    resolveContextWindowReading(
      {
        contextWindow: 1_000_000,
        source: 'provider',
        compactionTriggerPercent: 40,
        compactionEffectiveTriggerTokens: 400_000,
      },
      200_000,
    ),
    {
      contextWindow: 1_000_000,
      triggerPercent: 40,
      effectiveTriggerTokens: 400_000,
    },
  );
});

test('SDK fallback keeps its window together with its final threshold', () => {
  assert.deepEqual(
    resolveContextWindowReading(
      {
        contextWindow: 200_000,
        source: 'fallback',
        compactionTriggerPercent: 40,
        compactionEffectiveTriggerTokens: 80_000,
      },
      1_000_000,
    ),
    {
      contextWindow: 200_000,
      triggerPercent: 40,
      effectiveTriggerTokens: 80_000,
    },
  );
});

test('legacy fallback without a final threshold keeps the model-name window', () => {
  assert.deepEqual(
    resolveContextWindowReading(
      {
        contextWindow: 200_000,
        source: 'fallback',
        compactionTriggerPercent: 40,
        compactionTriggerTokens: 350_000,
      },
      1_000_000,
    ),
    {
      contextWindow: 1_000_000,
      triggerPercent: 40,
      triggerTokens: 350_000,
    },
  );
});
