import assert from 'node:assert/strict';
import test from 'node:test';

import type { RuntimeTypedEvent } from '@kodax-ai/kodax/runtime';
import {
  projectRuntimeContextSessionEvent,
  selectCommittedCompactionEntry,
} from '../kodax/runtime-host-adapter.js';

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
        usage: {
          inputTokens: 232_838,
          outputTokens: 229,
          totalTokens: 233_067,
          cachedReadTokens: 200_000,
          cachedWriteTokens: 4_000,
        },
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
    usage: {
      inputTokens: 232_838,
      outputTokens: 229,
      cacheReadInputTokens: 200_000,
      cacheWriteInputTokens: 4_000,
    },
  });
});

test('daemon child Agent Provider usage keeps its context attribution', () => {
  const projected = projectRuntimeContextSessionEvent(
    runtimeEvent('run.progress', {
      kind: 'iteration_end',
      info: {
        iter: 2,
        maxIter: 30,
        tokenCount: 42_600,
        tokenSource: 'api',
        scope: 'worker',
        contextId: 'child_ctx_1',
        contextKind: 'child',
        parentContextId: 's_1',
        agentId: 'researcher',
        usage: {
          inputTokens: 40_000,
          outputTokens: 2_600,
          totalTokens: 42_600,
          cachedReadTokens: 36_000,
          cachedWriteTokens: 1_000,
        },
      },
    }),
  );

  assert.deepEqual(projected, {
    kind: 'iteration_end',
    sessionId: 's_1',
    iter: 2,
    maxIter: 30,
    tokenCount: 42_600,
    tokenSource: 'api',
    scope: 'worker',
    usage: {
      inputTokens: 40_000,
      outputTokens: 2_600,
      cacheReadInputTokens: 36_000,
      cacheWriteInputTokens: 1_000,
    },
    contextId: 'child_ctx_1',
    contextKind: 'child',
    parentContextId: 's_1',
    agentId: 'researcher',
  });
});

test('daemon context budget diagnostics reach the renderer breakdown protocol', () => {
  const payload = {
    sessionId: 's_1',
    contextId: 's_1',
    contextKind: 'root',
    contextRevision: 4,
    provider: 'zhipu',
    model: 'glm-5.2',
    profile: 'report_only',
    contextWindow: 1_000_000,
    smallWindow: false,
    pressure: 'low',
    tokenBreakdown: {
      systemPrompt: 1_000,
      toolSchemas: 2_000,
      skillCatalog: 500,
      mcpCatalog: 250,
      transcript: 10_000,
      pendingInput: 300,
      recentToolResults: 1_500,
      reservedResponse: 8_000,
      total: 23_550,
    },
    usedTokens: 23_550,
    availableTokens: 976_450,
    usedRatio: 0.02355,
    toolSchemaRatio: 0.002,
    recommendations: [],
    createdAt: '2026-07-25T14:09:23.713Z',
  };
  assert.deepEqual(
    projectRuntimeContextSessionEvent(runtimeEvent('context.budget.snapshot', payload)),
    {
      kind: 'context_budget_snapshot',
      sessionId: 's_1',
      contextId: 's_1',
      contextKind: 'root',
      contextRevision: 4,
      provider: 'zhipu',
      model: 'glm-5.2',
      profile: 'report_only',
      contextWindow: 1_000_000,
      smallWindow: false,
      pressure: 'low',
      tokenBreakdown: payload.tokenBreakdown,
      usedTokens: 23_550,
      availableTokens: 976_450,
      usedRatio: 0.02355,
      toolSchemaRatio: 0.002,
      createdAt: '2026-07-25T14:09:23.713Z',
    },
  );
});

test('daemon provider cache diagnostics expose the latest physical request without prompt text', () => {
  const hash = 'b'.repeat(64);
  assert.deepEqual(
    projectRuntimeContextSessionEvent(
      runtimeEvent('provider.cache.diagnostics', {
        phase: 'response',
        requestId: 'request-1',
        requestedAt: '2026-07-26T03:12:00.000Z',
        completedAt: '2026-07-26T03:12:01.000Z',
        transport: 'stream',
        provider: 'zai-coding',
        model: 'glm-5.2',
        wireModel: 'glm-5',
        maxOutputTokens: 8_000,
        kodaxPromptCacheEnabled: true,
        endpoint: 'https://api.example.test',
        attempt: 1,
        systemPromptHash: hash,
        toolSchemaHash: hash,
        messagePrefixHash: hash,
        messagePrefixCount: 42,
        requestMessagesHash: hash,
        requestEnvelopeHash: hash,
        ephemeralSuffixHash: hash,
        promptCacheAffinityHash: hash,
        messageCount: 44,
        toolCount: 12,
        inputTokens: 145_226,
        outputTokens: 779,
        cachedReadTokens: 144_512,
        secretPrompt: 'must not cross IPC',
      }),
    ),
    {
      kind: 'provider_cache_diagnostic',
      sessionId: 's_1',
      requestId: 'request-1',
      requestedAt: '2026-07-26T03:12:00.000Z',
      completedAt: '2026-07-26T03:12:01.000Z',
      transport: 'stream',
      provider: 'zai-coding',
      model: 'glm-5.2',
      wireModel: 'glm-5',
      maxOutputTokens: 8_000,
      kodaxPromptCacheEnabled: true,
      endpoint: 'https://api.example.test',
      attempt: 1,
      systemPromptHash: hash,
      toolSchemaHash: hash,
      messagePrefixHash: hash,
      messagePrefixCount: 42,
      requestMessagesHash: hash,
      requestEnvelopeHash: hash,
      ephemeralSuffixHash: hash,
      promptCacheAffinityHash: hash,
      messageCount: 44,
      toolCount: 12,
      inputTokens: 145_226,
      outputTokens: 779,
      cacheReadInputTokens: 144_512,
    },
  );
});

test('daemon child Provider cache diagnostics retain child attribution and envelope identity', () => {
  const hash = 'd'.repeat(64);
  assert.deepEqual(
    projectRuntimeContextSessionEvent(
      runtimeEvent('provider.cache.diagnostics', {
        phase: 'response',
        contextKind: 'child',
        agentId: 'agent_1',
        requestId: 'request-child',
        requestedAt: '2026-07-26T03:12:00.000Z',
        completedAt: '2026-07-26T03:12:01.000Z',
        transport: 'complete',
        provider: 'anthropic',
        model: 'claude-sonnet',
        attempt: 2,
        systemPromptHash: hash,
        toolSchemaHash: hash,
        messagePrefixHash: hash,
        messagePrefixCount: 4,
        requestMessagesHash: hash,
        requestEnvelopeHash: hash,
        messageCount: 5,
        toolCount: 3,
        inputTokens: 10_000,
        outputTokens: 500,
        cachedReadTokens: 8_000,
        cachedWriteTokens: 1_000,
      }),
    ),
    {
      kind: 'provider_cache_diagnostic',
      sessionId: 's_1',
      contextKind: 'child',
      agentId: 'agent_1',
      requestId: 'request-child',
      requestedAt: '2026-07-26T03:12:00.000Z',
      completedAt: '2026-07-26T03:12:01.000Z',
      transport: 'complete',
      provider: 'anthropic',
      model: 'claude-sonnet',
      attempt: 2,
      systemPromptHash: hash,
      toolSchemaHash: hash,
      messagePrefixHash: hash,
      messagePrefixCount: 4,
      requestMessagesHash: hash,
      requestEnvelopeHash: hash,
      messageCount: 5,
      toolCount: 3,
      inputTokens: 10_000,
      outputTokens: 500,
      cacheReadInputTokens: 8_000,
      cacheWriteInputTokens: 1_000,
    },
  );
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

test('all Runtime compaction sources survive the Space telemetry contract', () => {
  for (const source of ['manual', 'automatic_threshold', 'physical_capacity'] as const) {
    const projected = projectRuntimeContextSessionEvent(
      runtimeEvent('context.compaction.finished', {
        contextId: 's_1',
        contextKind: 'root',
        tokensBefore: 120_000,
        tokensAfter: 40_000,
        committed: true,
        source,
      }),
    );
    assert.equal(projected?.kind, 'compact_stats');
    assert.equal(projected?.kind === 'compact_stats' ? projected.source : undefined, source);
  }
});

test('committed root finish resolves only its exact persisted compaction identity', () => {
  const event = {
    ...runtimeEvent('context.compaction.finished', {
      contextId: 's_1',
      contextKind: 'root',
      committed: true,
      compactionEntryId: 'current_compaction',
      tokensBefore: 120_000,
      tokensAfter: 40_000,
    }),
    time: '2026-07-29T07:06:50.321Z',
  } as RuntimeTypedEvent;
  const transcript = {
    title: 'test',
    gitRoot: 'C:\\repo',
    messages: [],
    activeMessages: [],
    transcriptEntries: [
      {
        entryId: 'old_compaction',
        parentId: null,
        logicalId: 'old_compaction',
        timestamp: '2026-07-29T07:02:00.000Z',
        type: 'compaction',
        active: false,
        summary: 'old',
        payload: { tokensBefore: 90_000, tokensAfter: 30_000 },
        message: { role: 'system', content: 'old' },
      },
      {
        entryId: 'current_compaction',
        parentId: null,
        logicalId: 'current_compaction',
        timestamp: '2026-07-29T07:06:50.278Z',
        type: 'compaction',
        active: true,
        summary: 'current',
        payload: { tokensBefore: 120_000, tokensAfter: 40_000 },
        message: { role: 'system', content: 'current' },
      },
    ],
  } as Parameters<typeof selectCommittedCompactionEntry>[0];

  assert.deepEqual(selectCommittedCompactionEntry(transcript, event), {
    entry: transcript!.transcriptEntries[1],
    canonicalIndex: 1,
  });
  assert.equal(
    selectCommittedCompactionEntry(transcript, event, new Set(['current_compaction'])),
    undefined,
    'replayed finish must not bind to an older unseen boundary',
  );
  assert.equal(
    selectCommittedCompactionEntry(
      { ...transcript!, transcriptEntries: [transcript!.transcriptEntries[0]!] },
      event,
    ),
    undefined,
    'a nearby historical compaction with different token facts must not be selected',
  );
  const staleSameFacts = {
    ...transcript!.transcriptEntries[1]!,
    entryId: 'stale_same_facts',
    logicalId: 'stale_same_facts',
    timestamp: '2026-07-29T07:06:50.301Z',
  };
  assert.equal(
    selectCommittedCompactionEntry({ ...transcript!, transcriptEntries: [staleSameFacts] }, event),
    undefined,
    'same tokens and a 20 ms timestamp gap cannot impersonate the exact durable entry ID',
  );
  const eventWithoutEntryId = {
    ...event,
    payload: {
      contextId: 's_1',
      contextKind: 'root',
      committed: true,
      tokensBefore: 120_000,
      tokensAfter: 40_000,
    },
  } as RuntimeTypedEvent;
  assert.equal(
    selectCommittedCompactionEntry(transcript, eventWithoutEntryId),
    undefined,
    'a finish without authoritative physical identity must keep its provisional unresolved',
  );
  const legacyCurrent = {
    ...transcript!.transcriptEntries[1]!,
    payload: undefined,
  };
  assert.equal(
    selectCommittedCompactionEntry({ ...transcript!, transcriptEntries: [legacyCurrent] }, event),
    undefined,
    'a modern finish must not borrow identity from a nearby tokenless legacy entry',
  );
  assert.equal(
    selectCommittedCompactionEntry(
      {
        ...transcript!,
        transcriptEntries: [
          {
            ...legacyCurrent,
            payload: { tokensBefore: 120_000 },
          },
        ],
      },
      event,
    ),
    undefined,
    'a partially populated token payload is not an exact modern compaction identity',
  );
  const rewindEntry = {
    ...transcript!.transcriptEntries[1]!,
    entryId: 'legacy_rewind',
    logicalId: 'legacy_rewind',
    summary: '[Rewind] prior branch',
    payload: { tokensBefore: 120_000, tokensAfter: 40_000, reason: 'rewind' },
  };
  assert.equal(
    selectCommittedCompactionEntry({ ...transcript!, transcriptEntries: [rewindEntry] }, {
      ...event,
      payload: {
        ...(event.payload as Record<string, unknown>),
        compactionEntryId: 'legacy_rewind',
      },
    } as RuntimeTypedEvent),
    undefined,
    'legacy rewind compactions are storage markers, not visible compression boundaries',
  );
});

test('no-op and child compactions never resolve a root transcript boundary', () => {
  const transcript = {
    title: 'test',
    gitRoot: 'C:\\repo',
    messages: [],
    activeMessages: [],
    transcriptEntries: [
      {
        entryId: 'compaction',
        parentId: null,
        logicalId: 'compaction',
        timestamp: '2026-07-21T07:04:54.700Z',
        type: 'compaction',
        active: true,
        summary: 'summary',
        payload: { tokensBefore: 10, tokensAfter: 5 },
        message: { role: 'system', content: 'summary' },
      },
    ],
  } as Parameters<typeof selectCommittedCompactionEntry>[0];
  assert.equal(
    selectCommittedCompactionEntry(
      transcript,
      runtimeEvent('context.compaction.finished', {
        contextKind: 'root',
        committed: false,
        compactionEntryId: 'compaction',
        tokensBefore: 10,
        tokensAfter: 5,
      }),
    ),
    undefined,
  );
  assert.equal(
    selectCommittedCompactionEntry(
      transcript,
      runtimeEvent('context.compaction.finished', {
        contextKind: 'child',
        parentContextId: 's_1',
        committed: true,
        compactionEntryId: 'compaction',
        tokensBefore: 10,
        tokensAfter: 5,
      }),
    ),
    undefined,
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
