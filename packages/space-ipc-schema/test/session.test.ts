// Schema tests for session.* channels + session.event push payload.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  invokeChannels,
  pushChannels,
  INVOKE_CHANNEL_NAMES,
  PUSH_CHANNEL_NAMES,
  sessionCreateChannel,
  sessionSendChannel,
  sessionCancelChannel,
  sessionListChannel,
  sessionDeleteChannel,
  sessionEventChannel,
  sessionHistoryChannel,
  sessionLocalNoticeAppendChannel,
  sessionLocalNoticeReplaceChannel,
  sessionForkChannel,
  sessionRewindChannel,
  sessionAgentsMdChannel,
  sessionSetAgentModeChannel,
} from '../src/index.js';

test('all 5 session invoke channels are registered', () => {
  for (const name of [
    'session.create',
    'session.send',
    'session.cancel',
    'session.list',
    'session.delete',
  ]) {
    assert.ok(
      invokeChannels[name as keyof typeof invokeChannels],
      `${name} should be in invokeChannels`,
    );
    assert.ok(INVOKE_CHANNEL_NAMES.has(name), `${name} should be in INVOKE_CHANNEL_NAMES`);
  }
});

test('session.list output distinguishes persisted runtime identity from legacy fallback', () => {
  const base = {
    sessionId: 's_runtime-source',
    projectRoot: 'C:/repo',
    provider: 'openai',
    reasoningMode: 'auto',
    permissionMode: 'accept-edits',
    autoModeEngine: 'llm',
    agentMode: 'ama',
    surface: 'partner',
    createdAt: 1,
    lastActivityAt: 1,
  };
  assert.equal(
    sessionListChannel.output.safeParse({
      sessions: [
        { ...base, runtimeMetadataSource: 'persisted' },
        { ...base, sessionId: 's_legacy', runtimeMetadataSource: 'current-default-fallback' },
      ],
    }).success,
    true,
  );
});

test('session.history output accepts restored sidecar verifier messages', () => {
  assert.equal(
    sessionHistoryChannel.output.safeParse({
      items: [
        { kind: 'user', content: 'q' },
        {
          kind: 'sidecar_message',
          message: {
            source: 'sidecar-verifier',
            verdict: 'revise',
            recipient: 'main-agent',
            delivery: 'synthetic-user-message',
            content: 'Please inspect the changed file.',
          },
        },
        { kind: 'assistant', text: 'Fixed.' },
      ],
    }).success,
    true,
  );
});

test('session.history reports SDK conversation confidence without exposing raw evidence bodies', () => {
  const parsed = sessionHistoryChannel.output.safeParse({
    items: [{ kind: 'user', content: 'kept candidate' }],
    conversation: {
      status: 'ambiguous',
      sourceRevision: 'sha256:abc',
      issues: [
        {
          code: 'compaction_predecessor_missing',
          occurrenceCount: 1,
          entryCount: 2,
        },
      ],
    },
  });
  assert.equal(parsed.success, true);
  assert.equal(
    sessionHistoryChannel.output.safeParse({
      items: [],
      conversation: {
        status: 'deduplicated',
        sourceRevision: 'sha256:abc',
        issues: [],
      },
    }).success,
    false,
  );
});

test('session image previews are bounded capability URLs in send acknowledgements and history', () => {
  const token = 'a'.repeat(32);
  const attachment = {
    id: 'image-1',
    kind: 'image' as const,
    mediaType: 'image/png' as const,
    bytes: 68,
    status: 'available' as const,
    thumbnailUrl: `app://space/session-attachment/${token}?variant=thumbnail`,
    previewUrl: `app://space/session-attachment/${token}?variant=original`,
  };
  assert.equal(
    sessionSendChannel.output.safeParse({
      accepted: true,
      attachments: [attachment],
    }).success,
    true,
  );
  assert.equal(
    sessionHistoryChannel.output.safeParse({
      items: [{ kind: 'user', content: 'inspect this', attachments: [attachment] }],
    }).success,
    true,
  );
  assert.equal(
    sessionHistoryChannel.output.safeParse({
      items: [
        {
          kind: 'user',
          content: 'unsafe',
          attachments: [
            {
              ...attachment,
              thumbnailUrl: 'file:///C:/Users/example/private.png',
            },
          ],
        },
      ],
    }).success,
    false,
  );
});

test('session history preserves explicit missing image tiles without exposing a path', () => {
  assert.equal(
    sessionHistoryChannel.output.safeParse({
      items: [
        {
          kind: 'user',
          content: '',
          attachments: [
            {
              id: 'image-missing',
              kind: 'image',
              status: 'missing',
            },
          ],
        },
      ],
    }).success,
    true,
  );
});

test('session.history carries bounded canonical user-boundary identity', () => {
  assert.equal(
    sessionHistoryChannel.output.safeParse({
      items: [
        {
          kind: 'user',
          content: 'q',
          turnId: 'turn_1',
          turnUserOrdinal: 1,
          historyTurnIndex: 42,
          historyBoundary: {
            boundaryId: 'entry_42_tail',
            sourceRevision: 'sha256:source',
          },
        },
      ],
    }).success,
    true,
  );
  assert.equal(
    sessionHistoryChannel.output.safeParse({
      items: [
        {
          kind: 'user',
          content: 'q',
          turnId: '',
          turnUserOrdinal: -1,
          historyTurnIndex: -1,
        },
      ],
    }).success,
    false,
  );
});

test('session.history carries immutable page cursors and explicit resync outcomes', () => {
  assert.equal(
    sessionHistoryChannel.input.safeParse({
      sessionId: 's_1',
      cursor: 'opaque-cursor',
      revision: 'revision-1',
      sourceRevision: 'source-1',
    }).success,
    true,
  );
  assert.equal(
    sessionHistoryChannel.output.safeParse({
      items: [],
      page: {
        outcome: 'ready',
        revision: 'revision-1',
        sourceRevision: 'source-1',
        hasMore: true,
        nextCursor: 'opaque-cursor',
        windowMode: 'replace',
        hasNewer: false,
      },
    }).success,
    true,
  );
  assert.equal(
    sessionHistoryChannel.output.safeParse({
      items: [],
      page: {
        outcome: 'ready',
        revision: 'revision-1',
        sourceRevision: 'source-1',
        hasMore: false,
        windowMode: 'prepend',
        hasNewer: false,
      },
    }).success,
    true,
  );
  assert.equal(
    sessionHistoryChannel.output.safeParse({
      items: [],
      page: { outcome: 'data_changed' },
    }).success,
    true,
  );
});

test('session.history can ask the renderer to wait for the bounded Runtime reader', () => {
  assert.deepEqual(
    sessionHistoryChannel.output.parse({
      items: [],
      page: { outcome: 'runtime_unavailable' },
    }),
    {
      items: [],
      page: { outcome: 'runtime_unavailable' },
    },
  );
});

test('session.history output accepts restored local slash notices', () => {
  assert.equal(
    sessionHistoryChannel.output.safeParse({
      items: [
        {
          kind: 'local_notice',
          id: 'ln_s_1_1',
          content: '/repointel status',
          sentAt: 1710000000000,
          variant: 'echo',
        },
        {
          kind: 'local_notice',
          id: 'ln_s_1_2',
          content: '[repointel] status: ok',
          sentAt: 1710000000001,
          variant: 'output',
        },
      ],
    }).success,
    true,
  );
});

test('session.history carries persisted compaction token statistics', () => {
  const parsed = sessionHistoryChannel.output.safeParse({
    items: [
      {
        kind: 'lineage_notice',
        noticeKind: 'compaction',
        text: 'summary',
        entryId: 'entry_compaction',
        parentId: null,
        logicalId: 'logical_compaction',
        sourceEntryId: 'entry_source',
        authoritativeEntryId: 'entry_exact',
        canonicalIndex: 146,
        turnId: 'turn_1',
        sentAt: 1710000000000,
        tokensBefore: 322_973,
        tokensAfter: 222_460,
      },
    ],
  });

  assert.equal(parsed.success, true);
});

test('session.history exposes bounded explicit history and turn truncation markers', () => {
  assert.equal(
    sessionHistoryChannel.output.safeParse({
      items: [
        { kind: 'history_truncation', scope: 'history', omittedItems: 123 },
        { kind: 'history_truncation', scope: 'turn', omittedItems: 45 },
      ],
    }).success,
    true,
  );
  assert.equal(
    sessionHistoryChannel.output.safeParse({
      items: [{ kind: 'history_truncation', scope: 'history', omittedItems: 0 }],
    }).success,
    false,
  );
});

test('session.event accepts persisted compaction identity for live/history reconciliation', () => {
  assert.equal(
    sessionEventChannel.payload.safeParse({
      kind: 'lineage_notice',
      sessionId: 's_1',
      noticeKind: 'compaction',
      text: 'summary',
      entryId: 'entry_compaction',
      parentId: null,
      logicalId: 'entry_compaction',
      canonicalIndex: 146,
      provisionalId: 'runtime-compaction:evt_1',
      displayId: 'runtime-compaction:evt_1',
      contextId: 's_1',
      contextRevision: 7,
      afterRevision: 8,
      source: 'automatic_threshold',
      tokensBefore: 489_491,
      tokensAfter: 222_460,
      sentAt: 1710000000000,
    }).success,
    true,
  );
  assert.equal(
    sessionEventChannel.payload.safeParse({
      kind: 'lineage_notice',
      sessionId: 's_1',
      noticeKind: 'compaction',
      text: 'Compaction',
      provisionalId: 'runtime-compaction:evt_1',
      displayId: 'runtime-compaction:evt_1',
      tokensBefore: 489_491,
      tokensAfter: 222_460,
      sentAt: 1710000000001,
    }).success,
    true,
  );
});

test('session local notice persistence channels are registered and bounded', () => {
  for (const name of ['session.localNotice.append', 'session.localNotice.replace'] as const) {
    assert.ok(invokeChannels[name]);
    assert.ok(INVOKE_CHANNEL_NAMES.has(name));
  }

  assert.equal(
    sessionLocalNoticeAppendChannel.input.safeParse({
      sessionId: 's_1',
      notice: { id: 'ln_1', content: '/status', sentAt: 1, variant: 'echo' },
    }).success,
    true,
  );
  assert.equal(
    sessionLocalNoticeReplaceChannel.input.safeParse({
      sessionId: 's_1',
      notices: [{ id: 'ln_2', content: '[status] ok', sentAt: 2, variant: 'output' }],
    }).success,
    true,
  );
  assert.equal(
    sessionLocalNoticeAppendChannel.input.safeParse({
      sessionId: 's_1',
      notice: { id: 'ln_bad', content: '/status', sentAt: 1, variant: 'user' },
    }).success,
    false,
  );
});

test('session.event push channel is registered', () => {
  assert.ok(pushChannels['session.event']);
  assert.ok(PUSH_CHANNEL_NAMES.has('session.event'));
  assert.equal(sessionEventChannel.direction, 'push');
});

// OC-11 + OC-23: session_error event schema 接受所有可选 wrap 字段
test('session_error event: minimal (back-compat) shape OK', () => {
  const r = sessionEventChannel.payload.safeParse({
    kind: 'session_error',
    sessionId: 's_1',
    error: 'Request cancelled.',
  });
  assert.equal(r.success, true);
});

test('session_error event: full OC-11 + OC-23 shape OK', () => {
  const r = sessionEventChannel.payload.safeParse({
    kind: 'session_error',
    sessionId: 's_1',
    error: 'Rate limit reached. Wait a moment and try again.',
    category: 'rate_limit',
    retriable: true,
    action: 'retry',
    retryAvailableAt: Date.now() + 30000,
  });
  assert.equal(r.success, true);
});

test('session_error event: unknown category rejected', () => {
  const r = sessionEventChannel.payload.safeParse({
    kind: 'session_error',
    sessionId: 's_1',
    error: 'x',
    category: 'made_up_category',
  });
  assert.equal(r.success, false);
});

test('session_error event: retryAvailableAt accepts large future epoch', () => {
  // 1h ahead, 1 year ahead — schema 不应当 clip 这些 (avoid the old rejection-on-cap bug)
  for (const ms of [60_000, 3_600_000, 365 * 24 * 3_600_000]) {
    const r = sessionEventChannel.payload.safeParse({
      kind: 'session_error',
      sessionId: 's_1',
      error: 'x',
      category: 'rate_limit',
      retryAvailableAt: Date.now() + ms,
    });
    assert.equal(r.success, true, `should accept retryAvailableAt = now+${ms}ms`);
  }
});

test('session.create input: requires projectRoot and provider', () => {
  assert.equal(
    sessionCreateChannel.input.safeParse({ projectRoot: '/r', provider: 'mock' }).success,
    true,
  );
  assert.equal(sessionCreateChannel.input.safeParse({ provider: 'mock' }).success, false);
  assert.equal(sessionCreateChannel.input.safeParse({ projectRoot: '/r' }).success, false);
  assert.equal(
    sessionCreateChannel.input.safeParse({ projectRoot: '', provider: 'mock' }).success,
    false,
  );
});

test('session.create input: rejects bogus reasoningMode', () => {
  const result = sessionCreateChannel.input.safeParse({
    projectRoot: '/r',
    provider: 'mock',
    reasoningMode: 'bogus',
  });
  assert.equal(result.success, false);
});

test('agentMode enum accepts canonical AMA and SA only', () => {
  for (const agentMode of ['ama', 'sa'] as const) {
    assert.equal(
      sessionCreateChannel.input.safeParse({ projectRoot: '/r', provider: 'mock', agentMode })
        .success,
      true,
      `session.create should accept ${agentMode}`,
    );
    assert.equal(
      sessionSetAgentModeChannel.input.safeParse({ sessionId: 's_1', agentMode }).success,
      true,
      `session.setAgentMode should accept ${agentMode}`,
    );
    assert.equal(
      sessionEventChannel.payload.safeParse({
        kind: 'managed_task_status',
        sessionId: 's_1',
        status: { agentMode, harnessProfile: 'H2_PLAN_EXECUTE_EVAL' },
      }).success,
      true,
      `managed_task_status should accept ${agentMode}`,
    );
  }
  assert.equal(
    sessionSetAgentModeChannel.input.safeParse({ sessionId: 's_1', agentMode: 'amaw' }).success,
    false,
  );
  assert.equal(
    sessionSetAgentModeChannel.input.safeParse({ sessionId: 's_1', agentMode: 'ama-workflow' })
      .success,
    false,
  );
});

test('session.create output includes resolved runtime settings', () => {
  const output = {
    sessionId: 's_1',
    createdAt: 0,
    reasoningMode: 'quick',
    permissionMode: 'auto',
    autoModeEngine: 'rules',
    agentMode: 'sa',
  };
  assert.equal(sessionCreateChannel.output.safeParse(output).success, true);
  assert.equal(
    sessionCreateChannel.output.safeParse({ sessionId: 's_1', createdAt: 0 }).success,
    false,
  );
  assert.equal(sessionCreateChannel.output.safeParse({ sessionId: 's_1' }).success, false);
  assert.equal(sessionCreateChannel.output.safeParse({ ...output, createdAt: -1 }).success, false);
});

test('repo-intelligence trace accepts KodaX 0.7.57 built-in modes', () => {
  for (const mode of ['off', 'light', 'full'] as const) {
    assert.equal(
      sessionEventChannel.payload.safeParse({
        kind: 'repointel_trace',
        sessionId: 's_1',
        event: {
          kind: 'preturn',
          mode,
          engine: mode === 'off' ? 'light' : mode,
          status: mode === 'off' ? 'disabled' : 'ok',
          cacheHit: true,
        },
      }).success,
      true,
      `repointel_trace should accept ${mode}`,
    );
  }
});

test('session.send output is { accepted: true } literal', () => {
  assert.equal(sessionSendChannel.output.safeParse({ accepted: true }).success, true);
  // accepted: false 不被允许——失败走 envelope error，不走业务 ack
  assert.equal(sessionSendChannel.output.safeParse({ accepted: false }).success, false);
});
test('session.send queueMode defaults to interrupt and accepts after-turn', () => {
  const defaultResult = sessionSendChannel.input.safeParse({ sessionId: 's_1', prompt: 'hello' });
  assert.equal(defaultResult.success, true);
  if (defaultResult.success) {
    assert.equal(defaultResult.data.queueMode, 'interrupt');
  }

  const afterTurnResult = sessionSendChannel.input.safeParse({
    sessionId: 's_1',
    prompt: 'hello',
    queueMode: 'after-turn',
  });
  assert.equal(afterTurnResult.success, true);

  assert.equal(
    sessionSendChannel.input.safeParse({ sessionId: 's_1', prompt: 'hello', queueMode: 'later' })
      .success,
    false,
  );
});

test('session.send accepts expected project and surface guard fields', () => {
  const result = sessionSendChannel.input.safeParse({
    sessionId: 's_1',
    prompt: 'hello',
    expectedProjectRoot: '/workspace/project-a',
    expectedSurface: 'code',
  });
  assert.equal(result.success, true);
  if (result.success) {
    assert.equal(result.data.expectedProjectRoot, '/workspace/project-a');
    assert.equal(result.data.expectedSurface, 'code');
  }

  assert.equal(
    sessionSendChannel.input.safeParse({
      sessionId: 's_1',
      prompt: 'hello',
      expectedProjectRoot: '',
    }).success,
    false,
  );
  assert.equal(
    sessionSendChannel.input.safeParse({
      sessionId: 's_1',
      prompt: 'hello',
      expectedSurface: 'docs',
    }).success,
    false,
  );
});

test('session.send accepts bounded Partner prompt overlay without changing prompt shape', () => {
  const result = sessionSendChannel.input.safeParse({
    sessionId: 's_1',
    prompt: 'write a report',
    expectedSurface: 'partner',
    partnerPromptOverlay: 'Partner workbench mode: document-processing',
  });

  assert.equal(result.success, true);
  if (result.success) {
    assert.equal(result.data.prompt, 'write a report');
    assert.match(result.data.partnerPromptOverlay ?? '', /document-processing/);
  }

  assert.equal(
    sessionSendChannel.input.safeParse({
      sessionId: 's_1',
      prompt: 'write a report',
      partnerPromptOverlay: 'x'.repeat(131_073),
    }).success,
    false,
  );
});

test('session.send queued output may include queueMode', () => {
  assert.equal(
    sessionSendChannel.output.safeParse({
      accepted: true,
      queued: true,
      queueId: 'space-after-turn-1',
      queueMode: 'after-turn',
    }).success,
    true,
  );
  assert.equal(
    sessionSendChannel.output.safeParse({
      accepted: true,
      queued: true,
      queueId: 'q1',
      queueMode: 'later',
    }).success,
    false,
  );
});

test('session.send image artifacts accept KodaX 0.7.56 source values', () => {
  for (const source of ['user-inline', 'clipboard', 'drag-drop', 'file-picker'] as const) {
    const result = sessionSendChannel.input.safeParse({
      sessionId: 's_1',
      prompt: 'describe this',
      artifacts: [
        {
          kind: 'image',
          path: '/tmp/kodax-space/clipboard/s_1/a.png',
          mediaType: 'image/png',
          source,
        },
      ],
    });
    assert.equal(result.success, true, `source=${source}`);
  }
});

test('session.send image artifact source defaults to user-inline for legacy callers', () => {
  const result = sessionSendChannel.input.safeParse({
    sessionId: 's_1',
    prompt: 'describe this',
    artifacts: [
      { kind: 'image', path: '/tmp/kodax-space/clipboard/s_1/a.png', mediaType: 'image/png' },
    ],
  });
  assert.equal(result.success, true);
  if (result.success) {
    assert.equal(result.data.artifacts?.[0]?.source, 'user-inline');
  }
});

test('session.send image artifacts reject unknown source values', () => {
  const result = sessionSendChannel.input.safeParse({
    sessionId: 's_1',
    prompt: 'describe this',
    artifacts: [
      {
        kind: 'image',
        path: '/tmp/kodax-space/clipboard/s_1/a.png',
        mediaType: 'image/png',
        source: 'url',
      },
    ],
  });
  assert.equal(result.success, false);
});

test('session.send accepts bounded native attachment paths for model-only context', () => {
  const result = sessionSendChannel.input.safeParse({
    sessionId: 's_1',
    prompt: 'inspect the attached files',
    attachmentPaths: [
      { kind: 'file', path: 'D:\\notes\\KodaX Fabric\\design.md' },
      { kind: 'directory', path: '/Users/alice/Project Notes' },
    ],
  });
  assert.equal(result.success, true);

  assert.equal(
    sessionSendChannel.input.safeParse({
      sessionId: 's_1',
      prompt: 'too many attachments',
      attachmentPaths: Array.from({ length: 33 }, (_, index) => ({
        kind: 'file',
        path: `/tmp/file-${index}`,
      })),
    }).success,
    false,
  );
});

test('session.cancel preserves authoritative Runtime Stop receipts without claiming unknown outcomes', () => {
  assert.equal(sessionCancelChannel.output.safeParse({ cancelled: true }).success, true);
  assert.equal(sessionCancelChannel.output.safeParse({ cancelled: false }).success, true);
  assert.equal(
    sessionCancelChannel.output.safeParse({
      cancelled: false,
      stop: {
        runId: 'run_1',
        sessionId: 's_1',
        accepted: true,
        state: 'unknown',
        outcome: 'unknown',
        phase: 'unknown',
        revision: 3,
      },
    }).success,
    true,
  );
  assert.equal(
    sessionCancelChannel.output.safeParse({
      cancelled: true,
      stop: {
        runId: 'run_1',
        sessionId: 's_1',
        accepted: false,
        state: 'confirmed',
        outcome: 'cancelled',
        phase: 'cancelled',
        revision: 4,
      },
    }).success,
    true,
  );
  assert.equal(
    sessionCancelChannel.output.safeParse({
      cancelled: true,
      stop: {
        runId: 'run_1',
        sessionId: 's_1',
        accepted: true,
        state: 'unknown',
        outcome: 'cancelled',
        phase: 'cancelling',
        revision: -1,
      },
    }).success,
    false,
  );
});

test('session.delete has an ok-style boolean', () => {
  assert.equal(sessionDeleteChannel.output.safeParse({ deleted: true }).success, true);
  assert.equal(
    sessionDeleteChannel.output.safeParse({ deleted: false, reason: 'session_running' }).success,
    true,
  );
  assert.equal(
    sessionDeleteChannel.output.safeParse({ deleted: false, reason: 'unknown' }).success,
    false,
  );
});

test('session.list input is void; output requires sessions array', () => {
  assert.equal(sessionListChannel.input.safeParse(undefined).success, true);
  assert.equal(sessionListChannel.output.safeParse({ sessions: [] }).success, true);
});

test('session.event payload: text_delta variant', () => {
  const evt = { kind: 'text_delta' as const, sessionId: 's_1', text: 'hello' };
  assert.equal(sessionEventChannel.payload.safeParse(evt).success, true);
  assert.equal(
    sessionEventChannel.payload.safeParse({
      ...evt,
      runtimeEvent: { runtimeId: 'rt_1', runId: 'run_1', seq: 42 },
    }).success,
    true,
  );
  assert.equal(
    sessionEventChannel.payload.safeParse({
      ...evt,
      runtimeEvent: { runtimeId: 'rt_1', runId: 'run_1', seq: -1 },
    }).success,
    false,
  );
});

test('session.event payload: mid_turn_user_prompt variant', () => {
  const evt = {
    kind: 'mid_turn_user_prompt' as const,
    sessionId: 's_1',
    queueId: 'input_1',
    content: 'follow up',
    turnId: 'turn_1',
    turnUserOrdinal: 1,
  };
  assert.equal(sessionEventChannel.payload.safeParse(evt).success, true);
  assert.equal(
    sessionEventChannel.payload.safeParse({ ...evt, turnUserOrdinal: -1 }).success,
    false,
  );
});

test('session.event payload: queued_user_prompt_started variant', () => {
  const evt = {
    kind: 'queued_user_prompt_started' as const,
    sessionId: 's_1',
    queueId: 'run_queued_1',
    queueMode: 'after-turn' as const,
    content: 'follow up',
    turnId: 'turn_2',
    turnUserOrdinal: 0,
  };
  assert.equal(sessionEventChannel.payload.safeParse(evt).success, true);
  assert.equal(
    sessionEventChannel.payload.safeParse({ ...evt, turnUserOrdinal: 1_000_001 }).success,
    false,
  );
});

test('session.event payload: queued_user_prompt_failed variant is bounded and interrupt-only', () => {
  const evt = {
    kind: 'queued_user_prompt_failed' as const,
    sessionId: 's_1',
    queueId: 'input_1',
    queueMode: 'interrupt' as const,
    content: 'follow up',
    reason: 'run_completed' as const,
  };
  assert.equal(sessionEventChannel.payload.safeParse(evt).success, true);
  assert.equal(
    sessionEventChannel.payload.safeParse({ ...evt, queueMode: 'after-turn' }).success,
    false,
  );
  assert.equal(sessionEventChannel.payload.safeParse({ ...evt, reason: 'unknown' }).success, false);
});

test('session.event payload: tool_start with input', () => {
  const evt = {
    kind: 'tool_start' as const,
    sessionId: 's_1',
    toolId: 't_1',
    toolName: 'read',
    input: { path: 'package.json' },
  };
  assert.equal(sessionEventChannel.payload.safeParse(evt).success, true);
});

test('session.event payload: iteration_end with usage', () => {
  const evt = {
    kind: 'iteration_end' as const,
    sessionId: 's_1',
    iter: 1,
    maxIter: 30,
    tokenCount: 1280,
    usage: {
      inputTokens: 980,
      outputTokens: 300,
      cacheReadInputTokens: 640,
      cacheWriteInputTokens: 96,
    },
  };
  assert.equal(sessionEventChannel.payload.safeParse(evt).success, true);
});

test('session.event payload: context budget snapshot is bounded and content-free', () => {
  const evt = {
    kind: 'context_budget_snapshot' as const,
    sessionId: 's_1',
    contextId: 's_1',
    contextKind: 'root' as const,
    contextRevision: 3,
    provider: 'anthropic',
    model: 'claude-sonnet',
    profile: 'report_only' as const,
    contextWindow: 200_000,
    smallWindow: false,
    pressure: 'low' as const,
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
    availableTokens: 176_450,
    usedRatio: 0.11775,
    toolSchemaRatio: 0.01,
    createdAt: '2026-07-25T14:09:23.713Z',
  };
  assert.equal(sessionEventChannel.payload.safeParse(evt).success, true);
  assert.equal(
    sessionEventChannel.payload.safeParse({
      ...evt,
      tokenBreakdown: { ...evt.tokenBreakdown, transcript: -1 },
    }).success,
    false,
  );
});

test('session.event payload: provider cache diagnostic is hash-only and provider-reported', () => {
  const hash = 'a'.repeat(64);
  const parsed = sessionEventChannel.payload.safeParse({
    kind: 'provider_cache_diagnostic',
    sessionId: 's_1',
    requestId: 'request-1',
    requestedAt: '2026-07-26T03:12:00.000Z',
    completedAt: '2026-07-26T03:12:01.000Z',
    transport: 'stream',
    provider: 'zai-coding',
    model: 'glm-5.2',
    wireModel: 'glm-5',
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
    rawPrompt: 'must be stripped at the IPC boundary',
  });
  assert.equal(parsed.success, true);
  assert.equal(
    JSON.stringify(parsed.success ? parsed.data : null).includes('must be stripped'),
    false,
  );
  assert.equal(
    parsed.success && parsed.data.kind === 'provider_cache_diagnostic'
      ? parsed.data.requestEnvelopeHash
      : undefined,
    hash,
  );
  assert.equal(
    parsed.success && parsed.data.kind === 'provider_cache_diagnostic'
      ? parsed.data.ephemeralSuffixHash
      : undefined,
    hash,
  );
  assert.equal(
    parsed.success && parsed.data.kind === 'provider_cache_diagnostic'
      ? parsed.data.promptCacheAffinityHash
      : undefined,
    hash,
  );
});

test('session.event payload: rejects unknown kind (discriminated union locked)', () => {
  const evt = { kind: 'bogus', sessionId: 's_1' };
  assert.equal(sessionEventChannel.payload.safeParse(evt).success, false);
});

test('session.event payload: rejects mismatched fields for kind', () => {
  // tool_result 必须有 toolId / toolName / content；缺一个就失败
  const bad = { kind: 'tool_result' as const, sessionId: 's_1', toolId: 't', toolName: 'r' };
  assert.equal(sessionEventChannel.payload.safeParse(bad).success, false);
});

// --- FEATURE_008 new event variants ---

test('session.event payload: work_budget accepts valid', () => {
  const evt = { kind: 'work_budget' as const, sessionId: 's_1', used: 42, cap: 200 };
  assert.equal(sessionEventChannel.payload.safeParse(evt).success, true);
});

test('session.event payload: work_budget rejects negative used', () => {
  const evt = { kind: 'work_budget' as const, sessionId: 's_1', used: -1, cap: 200 };
  assert.equal(sessionEventChannel.payload.safeParse(evt).success, false);
});

test('session.event payload: work_budget rejects cap=0 (must be positive)', () => {
  const evt = { kind: 'work_budget' as const, sessionId: 's_1', used: 0, cap: 0 };
  assert.equal(sessionEventChannel.payload.safeParse(evt).success, false);
});

test('session.event payload: harness_profile H0 without round', () => {
  const evt = { kind: 'harness_profile' as const, sessionId: 's_1', profile: 'H0_DIRECT' as const };
  assert.equal(sessionEventChannel.payload.safeParse(evt).success, true);
});

test('session.event payload: harness_profile H2 with round', () => {
  const evt = {
    kind: 'harness_profile' as const,
    sessionId: 's_1',
    profile: 'H2_PLAN_EXECUTE_EVAL' as const,
    round: 3,
  };
  assert.equal(sessionEventChannel.payload.safeParse(evt).success, true);
});

test('session.event payload: harness_profile rejects unknown profile', () => {
  const evt = { kind: 'harness_profile' as const, sessionId: 's_1', profile: 'H99_FAKE' };
  assert.equal(sessionEventChannel.payload.safeParse(evt).success, false);
});

// --- review F008 C2-sec: providerId format guard ---

test('session.create input accepts mock / builtin / custom provider tokens', () => {
  const valid = [
    'mock',
    'anthropic',
    'zhipu-coding',
    'custom_0123456789abcdef',
    'MyProvider',
    'my_provider',
    'provider.1',
    'provider:1',
  ];
  for (const p of valid) {
    const r = sessionCreateChannel.input.safeParse({
      projectRoot: '/root',
      provider: p,
    });
    assert.equal(r.success, true, `should accept ${p}`);
  }
});

test('session.create input rejects malformed providerId', () => {
  const invalid = [
    '../../etc/passwd',
    '<script>alert(1)</script>',
    'has space',
    '-leading-dash',
    'provider/name',
  ];
  for (const p of invalid) {
    const r = sessionCreateChannel.input.safeParse({
      projectRoot: '/root',
      provider: p,
    });
    assert.equal(r.success, false, `should reject ${p}`);
  }
});

// ---- Size caps (review fix) ----

test('session.send rejects prompt over 1 MB (DoS guard)', () => {
  const tooBig = 'x'.repeat(1_048_577);
  const result = sessionSendChannel.input.safeParse({ sessionId: 's_1', prompt: tooBig });
  assert.equal(result.success, false);
  // 1 MB 整 exactly 边界仍接受
  const atLimit = 'x'.repeat(1_048_576);
  assert.equal(
    sessionSendChannel.input.safeParse({ sessionId: 's_1', prompt: atLimit }).success,
    true,
  );
});

test('session.event text_delta rejects text over 256 KB', () => {
  const tooBig = 'x'.repeat(262_145);
  const evt = { kind: 'text_delta' as const, sessionId: 's_1', text: tooBig };
  assert.equal(sessionEventChannel.payload.safeParse(evt).success, false);
});

test('session.event tool_result rejects content over 512 KB', () => {
  const tooBig = 'x'.repeat(524_289);
  const evt = {
    kind: 'tool_result' as const,
    sessionId: 's_1',
    toolId: 't_1',
    toolName: 'read',
    content: tooBig,
  };
  assert.equal(sessionEventChannel.payload.safeParse(evt).success, false);
});

// ---- FEATURE_029: canonical 3 mode + auto engine ----

test('permissionMode enum accepts canonical 3: plan / accept-edits / auto', () => {
  for (const mode of ['plan', 'accept-edits', 'auto'] as const) {
    const result = sessionCreateChannel.input.safeParse({
      projectRoot: '/tmp/proj',
      provider: 'mock',
      permissionMode: mode,
    });
    assert.equal(result.success, true, `should accept ${mode}`);
  }
});

test('permissionMode enum rejects legacy values: ask-permissions / bypass-permissions / plan-mode', () => {
  for (const mode of ['ask-permissions', 'bypass-permissions', 'plan-mode']) {
    const result = sessionCreateChannel.input.safeParse({
      projectRoot: '/tmp/proj',
      provider: 'mock',
      permissionMode: mode,
    });
    assert.equal(result.success, false, `should reject legacy ${mode}`);
  }
});

test('session.event auto_engine_change variant accepted with reason enum', () => {
  for (const reason of ['manual', 'denial_threshold', 'circuit_breaker'] as const) {
    const evt = {
      kind: 'auto_engine_change' as const,
      sessionId: 's_1',
      engine: 'rules' as const,
      reason,
    };
    assert.equal(sessionEventChannel.payload.safeParse(evt).success, true, `reason=${reason}`);
  }
});

test('session.event auto_engine_change accepts engine without reason (optional)', () => {
  const evt = {
    kind: 'auto_engine_change' as const,
    sessionId: 's_1',
    engine: 'llm' as const,
  };
  assert.equal(sessionEventChannel.payload.safeParse(evt).success, true);
});

test('session.event auto_engine_change rejects invalid engine value', () => {
  const evt = {
    kind: 'auto_engine_change' as const,
    sessionId: 's_1',
    engine: 'something-else',
  };
  assert.equal(sessionEventChannel.payload.safeParse(evt).success, false);
});

test('session.event workflow_notice accepts live dedup key and sentAt', () => {
  const evt = {
    kind: 'workflow_notice' as const,
    sessionId: 's_1',
    text: '[workflow] completed: review',
    key: 'finished:run-mr72zyw7:completed',
    sentAt: 1234,
  };
  assert.equal(sessionEventChannel.payload.safeParse(evt).success, true);
});

// ---- FEATURE_033 fork + rewind channels ----

test('session.fork + session.rewind channels are registered', () => {
  assert.ok(invokeChannels['session.fork']);
  assert.ok(invokeChannels['session.rewind']);
  assert.ok(INVOKE_CHANNEL_NAMES.has('session.fork'));
  assert.ok(INVOKE_CHANNEL_NAMES.has('session.rewind'));
});

test('session.fork input requires sessionId + non-negative forkPointTurnIdx', () => {
  assert.equal(
    sessionForkChannel.input.safeParse({ sessionId: 's_1', forkPointTurnIdx: 0 }).success,
    true,
  );
  assert.equal(
    sessionForkChannel.input.safeParse({ sessionId: 's_1', forkPointTurnIdx: 5 }).success,
    true,
  );
  assert.equal(
    sessionForkChannel.input.safeParse({ sessionId: 's_1', forkPointTurnIdx: -1 }).success,
    false,
  );
  assert.equal(
    sessionForkChannel.input.safeParse({ sessionId: '', forkPointTurnIdx: 0 }).success,
    false,
  );
  assert.equal(sessionForkChannel.input.safeParse({ sessionId: 's_1' }).success, false);
  assert.equal(
    sessionForkChannel.input.safeParse({
      sessionId: 's_1',
      forkPointTurnIdx: 0,
      historyBoundary: { boundaryId: 'entry_tail', sourceRevision: 'source-revision' },
    }).success,
    true,
  );
  // Absolute selectors share the same bound as historyTurnIndex.
  assert.equal(
    sessionForkChannel.input.safeParse({ sessionId: 's_1', forkPointTurnIdx: 10_001 }).success,
    true,
  );
  assert.equal(
    sessionForkChannel.input.safeParse({ sessionId: 's_1', forkPointTurnIdx: 10_000_001 }).success,
    false,
  );
});

test('session.fork output is { newSessionId, createdAt }', () => {
  assert.equal(
    sessionForkChannel.output.safeParse({ newSessionId: 's_2', createdAt: 0 }).success,
    true,
  );
  assert.equal(sessionForkChannel.output.safeParse({ newSessionId: 's_2' }).success, false);
  assert.equal(
    sessionForkChannel.output.safeParse({ newSessionId: '', createdAt: 0 }).success,
    false,
  );
});

test('session.rewind input requires sessionId + non-negative rewindPastTurnIdx', () => {
  assert.equal(
    sessionRewindChannel.input.safeParse({ sessionId: 's_1', rewindPastTurnIdx: 0 }).success,
    true,
  );
  assert.equal(
    sessionRewindChannel.input.safeParse({ sessionId: 's_1', rewindPastTurnIdx: -1 }).success,
    false,
  );
  assert.equal(
    sessionRewindChannel.input.safeParse({
      sessionId: 's_1',
      rewindPastTurnIdx: 0,
      historyBoundary: { boundaryId: 'entry_tail', sourceRevision: 'source-revision' },
      localNoticeCutoffSentAt: 1_234,
    }).success,
    true,
  );
  assert.equal(
    sessionRewindChannel.input.safeParse({
      sessionId: 's_1',
      rewindPastTurnIdx: 0,
      localNoticeCutoffSentAt: -1,
    }).success,
    false,
  );
  assert.equal(
    sessionRewindChannel.input.safeParse({
      sessionId: 's_1',
      rewindPastTurnIdx: 0,
      localNoticeCutoffSentAt: 1.5,
    }).success,
    false,
  );
  assert.equal(
    sessionRewindChannel.input.safeParse({ sessionId: 's_1', rewindPastTurnIdx: 10_001 }).success,
    true,
  );
  assert.equal(
    sessionRewindChannel.input.safeParse({
      sessionId: 's_1',
      rewindPastTurnIdx: 10_000_001,
    }).success,
    false,
  );
});

test('session.rewind output reason enum is exhaustive', () => {
  assert.equal(sessionRewindChannel.output.safeParse({ ok: true }).success, true);
  assert.equal(
    sessionRewindChannel.output.safeParse({ ok: false, reason: 'session_not_found' }).success,
    true,
  );
  assert.equal(
    sessionRewindChannel.output.safeParse({ ok: false, reason: 'invalid_index' }).success,
    true,
  );
  assert.equal(
    sessionRewindChannel.output.safeParse({ ok: false, reason: 'session_busy' }).success,
    true,
  );
  assert.equal(
    sessionRewindChannel.output.safeParse({ ok: false, reason: 'rate_limited' }).success,
    false,
  );
});

// ---- FEATURE_034 agents-md channel ----

test('session.agentsMd channel is registered', () => {
  assert.ok(invokeChannels['session.agentsMd']);
  assert.ok(INVOKE_CHANNEL_NAMES.has('session.agentsMd'));
});

test('session.agentsMd input requires sessionId', () => {
  assert.equal(sessionAgentsMdChannel.input.safeParse({ sessionId: 's_1' }).success, true);
  assert.equal(sessionAgentsMdChannel.input.safeParse({ sessionId: '' }).success, false);
  assert.equal(sessionAgentsMdChannel.input.safeParse({}).success, false);
});

test('session.agentsMd output accepts global + project scopes', () => {
  const out = {
    files: [
      { path: '/home/u/.kodax/AGENTS.md', content: '# global', scope: 'global' as const },
      { path: '/proj/AGENTS.md', content: '# project', scope: 'project' as const },
    ],
  };
  assert.equal(sessionAgentsMdChannel.output.safeParse(out).success, true);
});

test('session.agentsMd output rejects unknown scope', () => {
  const out = {
    files: [{ path: '/x/AGENTS.md', content: '', scope: 'workspace' }],
  };
  assert.equal(sessionAgentsMdChannel.output.safeParse(out).success, false);
});

test('session.agentsMd output enforces array cap (DoS guard)', () => {
  const files = Array.from({ length: 17 }, (_, i) => ({
    path: `/p${i}/AGENTS.md`,
    content: '',
    scope: 'project' as const,
  }));
  assert.equal(sessionAgentsMdChannel.output.safeParse({ files }).success, false);
});
