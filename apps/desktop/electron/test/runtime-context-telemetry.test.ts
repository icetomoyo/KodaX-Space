import assert from 'node:assert/strict';
import test from 'node:test';

import type { RuntimeTypedEvent } from '@kodax-ai/kodax/runtime';
import { projectRuntimeContextSessionEvent } from '../kodax/runtime-host-adapter.js';

function runtimeEvent(type: string, payload: unknown): RuntimeTypedEvent {
  return {
    id: `evt_${type}`,
    seq: 1,
    time: '2026-07-21T07:04:54.766Z',
    sessionId: 's_1',
    runId: 'run_1',
    type,
    payload,
  } as RuntimeTypedEvent;
}

test('daemon main-worker iteration telemetry reaches the renderer token protocol', () => {
  const projected = projectRuntimeContextSessionEvent(
    runtimeEvent('run.progress', {
      kind: 'iteration_end',
      info: {
        iter: 1,
        maxIter: 500,
        tokenCount: 233_067,
        tokenSource: 'api',
        scope: 'worker',
        usage: { inputTokens: 232_838, outputTokens: 229, totalTokens: 233_067 },
      },
    }),
  );

  assert.deepEqual(projected, {
    kind: 'iteration_end',
    sessionId: 's_1',
    iter: 1,
    maxIter: 500,
    tokenCount: 233_067,
    tokenSource: 'api',
    scope: 'worker',
    usage: { inputTokens: 232_838, outputTokens: 229 },
  });
});

test('daemon canonical compaction facts keep root context ownership', () => {
  assert.deepEqual(
    projectRuntimeContextSessionEvent(runtimeEvent('context.compaction.started', { meta: {} })),
    { kind: 'compact_start', sessionId: 's_1' },
  );
  assert.deepEqual(
    projectRuntimeContextSessionEvent(
      runtimeEvent('context.compaction.finished', {
        contextId: 's_1',
        contextKind: 'root',
        contextRevision: 2,
        beforeRevision: 1,
        afterRevision: 2,
        tokensBefore: 489_491,
        tokensAfter: 291_718,
        committed: true,
        source: 'automatic_threshold',
        elapsedMs: 1_250,
        strategy: 'full_prefix',
        effectiveTriggerTokens: 400_000,
        protectedBudgetTokens: 80_000,
        summaryTokens: 24_000,
      }),
    ),
    {
      kind: 'compact_stats',
      sessionId: 's_1',
      tokensBefore: 489_491,
      tokensAfter: 291_718,
      contextId: 's_1',
      contextKind: 'root',
      contextRevision: 2,
      source: 'automatic_threshold',
      committed: true,
      elapsedMs: 1_250,
      strategy: 'full_prefix',
      effectiveTriggerTokens: 400_000,
      protectedBudgetTokens: 80_000,
      summaryTokens: 24_000,
      beforeRevision: 1,
      afterRevision: 2,
    },
  );
  assert.deepEqual(
    projectRuntimeContextSessionEvent(runtimeEvent('context.compaction.ended', { meta: {} })),
    { kind: 'compact_end', sessionId: 's_1' },
  );
});

test('daemon child context telemetry is preserved for ownership filtering', () => {
  const childMeta = {
    contextId: 's_1/agent/reviewer',
    contextKind: 'child' as const,
    parentContextId: 's_1',
    agentId: 'reviewer',
    contextRevision: 1,
  };
  assert.deepEqual(
    projectRuntimeContextSessionEvent(
      runtimeEvent('context.compaction.started', { meta: childMeta }),
    ),
    { kind: 'compact_start', sessionId: 's_1', ...childMeta },
  );
  assert.deepEqual(
    projectRuntimeContextSessionEvent(
      runtimeEvent('context.compaction.finished', {
        contextId: 's_1/agent/reviewer',
        contextKind: 'child',
        parentContextId: 's_1',
        agentId: 'reviewer',
        contextRevision: 1,
        tokensBefore: 40_000,
        tokensAfter: 8_000,
        committed: true,
      }),
    ),
    {
      kind: 'compact_stats',
      sessionId: 's_1',
      tokensBefore: 40_000,
      tokensAfter: 8_000,
      contextId: 's_1/agent/reviewer',
      contextKind: 'child',
      parentContextId: 's_1',
      agentId: 'reviewer',
      contextRevision: 1,
      committed: true,
    },
  );
  assert.deepEqual(
    projectRuntimeContextSessionEvent(
      runtimeEvent('context.compaction.ended', { meta: childMeta }),
    ),
    { kind: 'compact_end', sessionId: 's_1', ...childMeta },
  );
});

test('daemon unchanged compaction outcomes remain visible instead of being discarded', () => {
  assert.deepEqual(
    projectRuntimeContextSessionEvent(
      runtimeEvent('context.compaction.finished', {
        contextId: 's_1',
        contextKind: 'root',
        contextRevision: 4,
        beforeRevision: 4,
        afterRevision: 4,
        tokensBefore: 205_000,
        tokensAfter: 205_000,
        committed: false,
        source: 'manual',
        elapsedMs: 90,
        reason: 'covered_context_unchanged',
      }),
    ),
    {
      kind: 'compact_stats',
      sessionId: 's_1',
      tokensBefore: 205_000,
      tokensAfter: 205_000,
      contextId: 's_1',
      contextKind: 'root',
      contextRevision: 4,
      source: 'manual',
      committed: false,
      elapsedMs: 90,
      beforeRevision: 4,
      afterRevision: 4,
      reason: 'covered_context_unchanged',
    },
  );
});

test('invalid daemon token telemetry is rejected instead of corrupting the gauge', () => {
  assert.equal(
    projectRuntimeContextSessionEvent(
      runtimeEvent('run.progress', {
        kind: 'iteration_end',
        info: { iter: 1, maxIter: 500, tokenCount: Number.NaN },
      }),
    ),
    undefined,
  );
});
