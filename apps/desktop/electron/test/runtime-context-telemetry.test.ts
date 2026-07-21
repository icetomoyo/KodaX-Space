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

test('daemon compaction lifecycle and before/after statistics are projected', () => {
  assert.deepEqual(
    projectRuntimeContextSessionEvent(runtimeEvent('context.compaction.started', { meta: {} })),
    { kind: 'compact_start', sessionId: 's_1' },
  );
  assert.deepEqual(
    projectRuntimeContextSessionEvent(
      runtimeEvent('context.compaction.stats', {
        tokensBefore: 489_491,
        tokensAfter: 291_718,
      }),
    ),
    {
      kind: 'compact_stats',
      sessionId: 's_1',
      tokensBefore: 489_491,
      tokensAfter: 291_718,
    },
  );
  assert.deepEqual(
    projectRuntimeContextSessionEvent(runtimeEvent('context.compaction.ended', { meta: {} })),
    { kind: 'compact_end', sessionId: 's_1' },
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
