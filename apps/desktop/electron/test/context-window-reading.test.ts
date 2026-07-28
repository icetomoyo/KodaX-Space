import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isEstimatedContextInput,
  resolveActiveInputReading,
  resolveActiveInputTokens,
  resolveContextWindowReading,
  resolveProviderReportedTokens,
} from '../../renderer/src/shell/contextWindowReading.js';

test('Runtime-derived readings retain their approximate marker', () => {
  assert.equal(isEstimatedContextInput('budget', 'iteration_end', 'api'), true);
  assert.equal(isEstimatedContextInput('provider', 'compact_stats', undefined), true);
  assert.equal(isEstimatedContextInput('provider', 'iteration_end', 'estimate'), true);
  assert.equal(isEstimatedContextInput('provider', 'iteration_end', 'api'), false);
});

test('only API-backed iteration telemetry is labeled as Provider-reported', () => {
  const reading = {
    tokens: 329_292,
    source: 'budget' as const,
    providerTokens: 276_964,
    budgetTokens: 329_292,
  };
  assert.equal(resolveProviderReportedTokens(reading, 'iteration_end', 'api'), 276_964);
  assert.equal(resolveProviderReportedTokens(reading, 'iteration_end', 'estimate'), undefined);
  assert.equal(resolveProviderReportedTokens(reading, 'compact_stats', undefined), undefined);
});

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

test('context budget fallback excludes reserved response capacity from active input', () => {
  assert.equal(
    resolveActiveInputTokens(undefined, {
      total: 200_100,
      reservedResponse: 131_100,
    }),
    69_000,
  );
});

test('a current Runtime budget remains authoritative when the last Provider count is larger', () => {
  assert.equal(
    resolveActiveInputTokens(70_000, {
      total: 200_100,
      reservedResponse: 131_100,
    }),
    69_000,
  );
});

test('the complete Runtime request estimate wins when it has already crossed the threshold', () => {
  assert.deepEqual(
    resolveActiveInputReading(
      { tokens: 276_964, contextRevision: 0 },
      {
        total: 460_364,
        reservedResponse: 131_072,
        contextRevision: 0,
      },
    ),
    {
      tokens: 329_292,
      source: 'budget',
      providerTokens: 276_964,
      budgetTokens: 329_292,
    },
  );
});

test('a pre-compaction budget cannot replace the newer compacted Provider reading', () => {
  assert.deepEqual(
    resolveActiveInputReading(
      { tokens: 91_005, contextRevision: 1 },
      {
        total: 460_364,
        reservedResponse: 131_072,
        contextRevision: 0,
      },
    ),
    {
      tokens: 91_005,
      source: 'provider',
      providerTokens: 91_005,
    },
  );
});

test('a fresh post-compaction budget can refine the Provider reading again', () => {
  assert.deepEqual(
    resolveActiveInputReading(
      { tokens: 91_005, contextRevision: 1 },
      {
        total: 223_792,
        reservedResponse: 131_072,
        contextRevision: 1,
      },
    ),
    {
      tokens: 92_720,
      source: 'budget',
      providerTokens: 91_005,
      budgetTokens: 92_720,
    },
  );
});

test('a newer Runtime budget outranks an older larger Provider reading', () => {
  assert.deepEqual(
    resolveActiveInputReading(
      { tokens: 276_964, contextId: 's_1', contextRevision: 0 },
      {
        total: 223_792,
        reservedResponse: 131_072,
        contextId: 's_1',
        contextRevision: 1,
      },
    ),
    {
      tokens: 92_720,
      source: 'budget',
      providerTokens: 276_964,
      budgetTokens: 92_720,
    },
  );
});

test('a budget from another root context cannot replace the current Provider reading', () => {
  assert.deepEqual(
    resolveActiveInputReading(
      {
        tokens: 20_000,
        contextId: 'root-new',
        contextRevision: 0,
        observedOrder: 2,
      },
      {
        total: 460_364,
        reservedResponse: 131_072,
        contextId: 'root-old',
        contextRevision: 0,
        observedOrder: 1,
      },
    ),
    {
      tokens: 20_000,
      source: 'provider',
      providerTokens: 20_000,
    },
  );
});

test('a newly arrived budget can establish a new root context before Provider completion', () => {
  assert.deepEqual(
    resolveActiveInputReading(
      {
        tokens: 276_964,
        contextId: 'root-old',
        contextRevision: 4,
        observedOrder: 1,
      },
      {
        total: 223_792,
        reservedResponse: 131_072,
        contextId: 'root-new',
        contextRevision: 0,
        observedOrder: 2,
      },
    ),
    {
      tokens: 92_720,
      source: 'budget',
      budgetTokens: 92_720,
    },
  );
});
