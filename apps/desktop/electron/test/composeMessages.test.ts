// composeMessages selector tests.
//
// 注：selector 文件本身在 renderer 端 (.tsx 旁) 但它是纯函数、零 React 依赖，
// 可以从 electron/test 直接 import 进 node:test 跑（tsx 处理 .ts/.tsx 转译）。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { SessionEvent } from '@kodax-space/space-ipc-schema';
import {
  composeMessages,
  type ConversationMessage,
} from '../../renderer/src/features/session/composeMessages.js';
import type {
  LocalNoticeMessage,
  QueuedUserMessage,
  UserMessage,
  WorkflowNoticeMessage,
} from '../../renderer/src/store/appStore.js';

const sid = 's_1';

function userMsg(id: string, content: string, sentAt = 1000): UserMessage {
  return { id, content, sentAt };
}

// 本地提示条(slash echo / 本地命令输出):渲染成 local_notice,但**不消费** assistant events 段。
function localMsg(id: string, content: string, sentAt = 1000): LocalNoticeMessage {
  return { id, content, sentAt };
}

function workflowNotice(id: string, content: string, sentAt = 1001): WorkflowNoticeMessage {
  return { id, content, sentAt };
}

function queuedMsg(
  id: string,
  content: string,
  queueMode: 'interrupt' | 'after-turn' = 'interrupt',
  sentAt = 1002,
): QueuedUserMessage {
  return {
    id,
    content,
    matchContent: content,
    queueMode,
    status: 'queued',
    sentAt,
  };
}

function kindsOf(msgs: ConversationMessage[]): string[] {
  return msgs.map((m) => m.kind);
}

test('empty in → empty out', () => {
  assert.deepEqual(composeMessages({ events: [], userMessages: [] }), []);
});

test('only user message, no events: returns single user bubble', () => {
  const out = composeMessages({
    events: [],
    userMessages: [userMsg('u1', 'hello')],
  });
  assert.equal(out.length, 1);
  assert.equal(out[0].kind, 'user');
  if (out[0].kind === 'user') assert.equal(out[0].content, 'hello');
});

test('compaction lineage hides its cumulative internal summary while branch lineage stays readable', () => {
  const compactionSummary = 'Conversation compacted: very large cumulative internal summary';
  const out = composeMessages({
    events: [
      {
        kind: 'lineage_notice',
        sessionId: sid,
        noticeKind: 'compaction',
        text: compactionSummary,
      },
      {
        kind: 'lineage_notice',
        sessionId: sid,
        noticeKind: 'branch_summary',
        text: 'Kept the alternate implementation notes.',
      },
    ],
    userMessages: [],
  });

  assert.equal(out.length, 2);
  assert.deepEqual(
    out.map((message) =>
      message.kind === 'system_notice'
        ? {
            variant: message.variant,
            lineageKind: message.lineageKind,
            text: message.text,
          }
        : { kind: message.kind },
    ),
    [
      { variant: 'lineage', lineageKind: 'compaction', text: '' },
      {
        variant: 'lineage',
        lineageKind: 'branch_summary',
        text: 'Kept the alternate implementation notes.',
      },
    ],
  );
  assert.equal(JSON.stringify(out).includes(compactionSummary), false);
});

test('visibly adjacent compactions coalesce without deleting lineage or compact stats upstream', () => {
  const out = composeMessages({
    events: [
      {
        kind: 'lineage_notice',
        sessionId: sid,
        noticeKind: 'compaction',
        text: 'older inactive cumulative summary',
      },
      {
        kind: 'compact_stats',
        sessionId: sid,
        tokensBefore: 203_065,
        tokensAfter: 71_113,
      },
      {
        kind: 'lineage_notice',
        sessionId: sid,
        noticeKind: 'compaction',
        text: 'current active cumulative summary',
      },
      {
        kind: 'compact_stats',
        sessionId: sid,
        tokensBefore: 201_270,
        tokensAfter: 62_551,
      },
    ],
    userMessages: [],
  });

  assert.deepEqual(
    out.map((message) =>
      message.kind === 'system_notice'
        ? {
            variant: message.variant,
            lineageKind: message.lineageKind,
            text: message.text,
          }
        : { kind: message.kind },
    ),
    [{ variant: 'lineage', lineageKind: 'compaction', text: '' }],
  );
});

test("local notice (slash echo/output) does NOT consume a real query's events (ordering regression)", () => {
  // 复现用户报的错位:先跑一条纯本地 slash(/repointel status,无 SDK 回合),再问一个真 query。
  // 真 query 的回答必须挂在真 query 气泡下,而不是被前面没有 events 的本地 slash 抢走。
  const events: SessionEvent[] = [
    { kind: 'text_delta', sessionId: sid, text: '这是对第二个问题的回答' },
    { kind: 'session_complete', sessionId: sid },
  ];
  const out = composeMessages({
    events,
    userMessages: [
      userMsg('u1', '为什么你的 repointel 是 idle', 1002), // 真 query
    ],
    localNotices: [
      localMsg('l1', '/repointel status', 1000), // slash echo(本地)
      localMsg('l2', '[repointel] status: ...', 1001), // slash 输出(本地)
    ],
  });
  // 顺序:两条本地条目原位 → 真 query → 它的回答(没有被本地 slash 吃走)
  assert.deepEqual(kindsOf(out), ['local_notice', 'local_notice', 'user', 'assistant_text']);
  assert.equal(out[0].kind === 'local_notice' && out[0].content, '/repointel status');
  assert.equal(out[0].kind === 'local_notice' && out[0].variant, 'echo');
  assert.equal(out[1].kind === 'local_notice' && out[1].variant, 'output');
  assert.equal(out[2].kind === 'user' && out[2].content, '为什么你的 repointel 是 idle');
  const answer = out[3];
  assert.equal(answer.kind, 'assistant_text');
  if (answer.kind === 'assistant_text') {
    assert.equal(answer.text, '这是对第二个问题的回答');
    assert.equal(answer.sentAt, 1002, '回答继承真 query(u1)的时间,而非本地 slash');
  }
});

test('local notice with no following real query renders alone, leaves later events unconsumed', () => {
  // 纯本地 slash 单独存在时不吞事件;真实事件段留给之后的真消息(此处无,故落到段尾兜底渲染)。
  const events: SessionEvent[] = [{ kind: 'text_delta', sessionId: sid, text: 'orphan' }];
  const out = composeMessages({
    events,
    userMessages: [],
    localNotices: [localMsg('l1', '/tree', 1000)],
  });
  // 本地条目 + 段尾未消费事件兜底成 assistant 气泡(不会被 /tree "吃"进它自己那段之前)
  assert.deepEqual(kindsOf(out), ['local_notice', 'assistant_text']);
  assert.equal(out[0].kind === 'local_notice' && out[0].content, '/tree');
  assert.equal(out[0].kind === 'local_notice' && out[0].variant, 'echo');
});

test('pending queued user messages render as queued_user, not normal user bubbles', () => {
  const out = composeMessages({
    events: [{ kind: 'text_delta', sessionId: sid, text: 'working' }],
    userMessages: [userMsg('u1', 'q1')],
    queuedUserMessages: [queuedMsg('qu1', 'q2', 'after-turn')],
  });

  assert.deepEqual(kindsOf(out), ['user', 'assistant_text', 'queued_user']);
  const queued = out[2];
  assert.equal(queued.kind, 'queued_user');
  if (queued.kind === 'queued_user') {
    assert.equal(queued.content, 'q2');
    assert.equal(queued.queueMode, 'after-turn');
  }
});

test('failed queued user message keeps its terminal reason for the actionable bubble', () => {
  const failed: QueuedUserMessage = {
    ...queuedMsg('qu-failed', 'copy me and retry'),
    status: 'failed',
    failureReason: 'run_completed',
  };
  const out = composeMessages({ events: [], userMessages: [], queuedUserMessages: [failed] });

  assert.equal(out.length, 1);
  assert.deepEqual(out[0], {
    kind: 'queued_user',
    id: 'qu-failed',
    content: 'copy me and retry',
    queueMode: 'interrupt',
    status: 'failed',
    failureReason: 'run_completed',
    sentAt: 1002,
  });
});

test('failed queued user message stays at its failure-time position before later turns', () => {
  const failed: QueuedUserMessage = {
    ...queuedMsg('qu-failed', 'copy me and retry', 'interrupt', 2000),
    status: 'failed',
    failureReason: 'run_completed',
  };
  const out = composeMessages({
    events: [
      { kind: 'text_delta', sessionId: sid, text: 'first reply' },
      { kind: 'session_complete', sessionId: sid },
      { kind: 'text_delta', sessionId: sid, text: 'later reply' },
      { kind: 'session_complete', sessionId: sid },
    ],
    userMessages: [userMsg('u1', 'first query', 1000), userMsg('u2', 'later query', 3000)],
    queuedUserMessages: [failed],
  });

  assert.deepEqual(kindsOf(out), [
    'user',
    'assistant_text',
    'queued_user',
    'user',
    'assistant_text',
  ]);
  assert.equal(out[2]?.kind === 'queued_user' && out[2].id, 'qu-failed');
  assert.equal(out[3]?.kind === 'user' && out[3].id, 'u2');
});

test('user + consecutive text_deltas → user bubble + single merged assistant bubble', () => {
  const events: SessionEvent[] = [
    { kind: 'text_delta', sessionId: sid, text: 'Hello ' },
    { kind: 'text_delta', sessionId: sid, text: 'world' },
    { kind: 'text_delta', sessionId: sid, text: '!' },
    { kind: 'session_complete', sessionId: sid },
  ];
  const out = composeMessages({ events, userMessages: [userMsg('u1', 'hi')] });
  // v0.1.x: 'complete' system_notice 退役，bubble footer 取代"✓ complete"标记
  assert.deepEqual(kindsOf(out), ['user', 'assistant_text']);
  const text = out[1];
  if (text.kind === 'assistant_text') assert.equal(text.text, 'Hello world!');
});

test('assistant blocks use their first stream timestamp instead of reusing the query timestamp', () => {
  const events: SessionEvent[] = [
    { kind: 'text_delta', sessionId: sid, text: 'Starting', sentAt: 10_000 },
    {
      kind: 'tool_start',
      sessionId: sid,
      toolId: 't-time',
      toolName: 'read',
      input: { path: 'README.md' },
    },
    {
      kind: 'tool_result',
      sessionId: sid,
      toolId: 't-time',
      toolName: 'read',
      content: 'done',
    },
    { kind: 'text_delta', sessionId: sid, text: 'Fresh result', sentAt: 250_000 },
    { kind: 'session_complete', sessionId: sid },
  ];
  const out = composeMessages({ events, userMessages: [userMsg('u1', 'long task', 1_000)] });
  const answers = out.filter(
    (message): message is Extract<ConversationMessage, { kind: 'assistant_text' }> =>
      message.kind === 'assistant_text',
  );

  assert.deepEqual(
    answers.map((answer) => [answer.text, answer.sentAt]),
    [
      ['Starting', 10_000],
      ['Fresh result', 250_000],
    ],
  );
});

test('workflow notices render as workflow system notices, not user bubbles', () => {
  const out = composeMessages({
    events: [],
    userMessages: [userMsg('u1', '/workflow create review')],
    workflowNotices: [workflowNotice('wf1', '[workflow] generating workflow...')],
  });
  assert.deepEqual(kindsOf(out), ['user', 'system_notice']);
  const notice = out[1];
  assert.equal(notice.kind, 'system_notice');
  if (notice.kind === 'system_notice') {
    assert.equal(notice.variant, 'workflow');
    assert.equal(notice.text, '[workflow] generating workflow...');
    assert.equal(notice.sentAt, 1001);
  }
});
test('thinking_delta attaches to current assistant bubble', () => {
  const events: SessionEvent[] = [
    { kind: 'thinking_delta', sessionId: sid, text: 'pondering...' },
    { kind: 'text_delta', sessionId: sid, text: 'Answer: 42' },
    { kind: 'session_complete', sessionId: sid },
  ];
  const out = composeMessages({ events, userMessages: [userMsg('u1', 'q')] });
  const bubble = out.find((m) => m.kind === 'assistant_text');
  assert.ok(bubble);
  if (bubble?.kind === 'assistant_text') {
    assert.equal(bubble.thinking, 'pondering...');
    assert.equal(bubble.text, 'Answer: 42');
  }
});

test('tool_start opens a card; tool_result fills it with status done', () => {
  const events: SessionEvent[] = [
    { kind: 'text_delta', sessionId: sid, text: 'Let me check' },
    {
      kind: 'tool_start',
      sessionId: sid,
      toolId: 't1',
      toolName: 'read',
      input: { path: 'package.json' },
    },
    {
      kind: 'tool_result',
      sessionId: sid,
      toolId: 't1',
      toolName: 'read',
      content: '{"name":"x"}',
    },
    { kind: 'text_delta', sessionId: sid, text: 'It says x.' },
    { kind: 'session_complete', sessionId: sid },
  ];
  const out = composeMessages({ events, userMessages: [userMsg('u1', 'what')] });
  // v0.1.x: 'complete' system_notice 退役；期望 user → assistant → tool_call(done) → assistant
  assert.deepEqual(kindsOf(out), ['user', 'assistant_text', 'tool_call', 'assistant_text']);
  const tool = out[2];
  if (tool.kind === 'tool_call') {
    assert.equal(tool.toolName, 'read');
    assert.equal(tool.status, 'done');
    assert.equal(tool.result, '{"name":"x"}');
    assert.deepEqual(tool.input, { path: 'package.json' });
  }
});

test('completed flag is attached only to the final assistant text for a turn', () => {
  const events: SessionEvent[] = [
    { kind: 'text_delta', sessionId: sid, text: 'Let me check' },
    {
      kind: 'tool_start',
      sessionId: sid,
      toolId: 't1',
      toolName: 'read',
      input: { path: 'package.json' },
    },
    {
      kind: 'tool_result',
      sessionId: sid,
      toolId: 't1',
      toolName: 'read',
      content: '{"name":"x"}',
    },
    { kind: 'text_delta', sessionId: sid, text: 'Final answer' },
    { kind: 'session_complete', sessionId: sid },
  ];
  const out = composeMessages({ events, userMessages: [userMsg('u1', 'what')] });
  const replies = out.filter(
    (m): m is Extract<ConversationMessage, { kind: 'assistant_text' }> =>
      m.kind === 'assistant_text',
  );
  assert.equal(replies.length, 2);
  assert.equal(replies[0].completed, undefined);
  assert.equal(replies[1].completed, true);
  assert.equal(replies[1].turnIndex, 0);
});

test('tool_start without tool_result → status remains "running"', () => {
  const events: SessionEvent[] = [
    {
      kind: 'tool_start',
      sessionId: sid,
      toolId: 't1',
      toolName: 'bash',
      input: { command: 'sleep 99' },
    },
  ];
  const out = composeMessages({ events, userMessages: [userMsg('u1', 'q')] });
  const tool = out.find((m) => m.kind === 'tool_call');
  if (tool?.kind === 'tool_call') {
    assert.equal(tool.status, 'running');
    assert.equal(tool.result, undefined);
  }
});

test('tool_progress updates an existing card progress field', () => {
  const events: SessionEvent[] = [
    {
      kind: 'tool_start',
      sessionId: sid,
      toolId: 't1',
      toolName: 'bash',
      input: { command: 'npm install' },
    },
    { kind: 'tool_progress', sessionId: sid, toolId: 't1', message: 'resolving 50 packages' },
  ];
  const out = composeMessages({ events, userMessages: [userMsg('u1', 'q')] });
  const tool = out.find((m) => m.kind === 'tool_call');
  if (tool?.kind === 'tool_call') {
    assert.equal(tool.progress, 'resolving 50 packages');
    assert.equal(tool.status, 'running');
  }
});

test('iteration_end no longer pushes system_notice (data goes to BottomBar spinner/status)', () => {
  // 用户反馈：每轮中间的 "iter N/M · X tokens" 分隔线打断阅读节奏。改为只在状态栏 +
  // 流式 spinner 旁显示实时 iter / tokens；对话流里不再插这条 system_notice.
  const events: SessionEvent[] = [
    { kind: 'text_delta', sessionId: sid, text: 'work' },
    {
      kind: 'iteration_end',
      sessionId: sid,
      iter: 2,
      maxIter: 30,
      tokenCount: 1500,
    },
    { kind: 'session_complete', sessionId: sid },
  ];
  const out = composeMessages({ events, userMessages: [userMsg('u1', 'q')] });
  const iterNotice = out.find((m) => m.kind === 'system_notice' && m.variant === 'iteration');
  assert.equal(iterNotice, undefined, 'iteration variant must not appear in conversation');
  // v0.1.x: 'complete' variant 退役（assistant bubble footer 显示 "Xd ago" 替代）
  const anySystemNotice = out.find((m) => m.kind === 'system_notice');
  assert.equal(
    anySystemNotice,
    undefined,
    'no system_notice should be emitted on session_complete',
  );
});

test("worker-scope iteration_end does NOT split the main agent's streaming reply", () => {
  // Regression: a workflow's parallel sub-agents each fire iteration_end forwarded to the
  // parent handler tagged only `scope: 'worker'`. If those flush the in-flight assistant
  // bubble, one streaming reply gets chopped into several mid-sentence bubbles (each with its
  // own copy footer). Only main-loop `parent`/undefined scope may end a bubble.
  const events: SessionEvent[] = [
    { kind: 'text_delta', sessionId: sid, text: '我已完成 3 项独立核查（渲染层 confirm' },
    {
      kind: 'iteration_end',
      sessionId: sid,
      iter: 4,
      maxIter: 200,
      tokenCount: 12,
      scope: 'worker',
    },
    { kind: 'text_delta', sessionId: sid, text: '清理、pptx 缺失、Partner 禁用门完整性），这些会' },
    {
      kind: 'iteration_end',
      sessionId: sid,
      iter: 5,
      maxIter: 200,
      tokenCount: 20,
      scope: 'worker',
    },
    { kind: 'text_delta', sessionId: sid, text: '并入最终报告。请稍候。' },
    { kind: 'session_complete', sessionId: sid },
  ];
  const out = composeMessages({ events, userMessages: [userMsg('u1', 'go')] });
  const bubbles = out.filter((m) => m.kind === 'assistant_text');
  assert.equal(
    bubbles.length,
    1,
    'worker iterations must not split the reply into multiple bubbles',
  );
  if (bubbles[0].kind === 'assistant_text') {
    assert.equal(
      bubbles[0].text,
      '我已完成 3 项独立核查（渲染层 confirm清理、pptx 缺失、Partner 禁用门完整性），这些会并入最终报告。请稍候。',
    );
  }
});

test('parent-scope iteration_end still ends the current assistant bubble', () => {
  // Guard-rail: the fix must not merge across genuine main-loop iteration boundaries.
  const events: SessionEvent[] = [
    { kind: 'text_delta', sessionId: sid, text: 'first' },
    {
      kind: 'iteration_end',
      sessionId: sid,
      iter: 1,
      maxIter: 30,
      tokenCount: 10,
      scope: 'parent',
    },
    { kind: 'text_delta', sessionId: sid, text: 'second' },
    { kind: 'session_complete', sessionId: sid },
  ];
  const out = composeMessages({ events, userMessages: [userMsg('u1', 'go')] });
  const bubbles = out.filter((m) => m.kind === 'assistant_text');
  assert.equal(bubbles.length, 2, 'parent iteration_end should still break the bubble');
});

test('session_error emits system_notice variant=error with the error text', () => {
  const events: SessionEvent[] = [
    { kind: 'text_delta', sessionId: sid, text: 'starting' },
    { kind: 'session_error', sessionId: sid, error: 'cancelled' },
  ];
  const out = composeMessages({ events, userMessages: [userMsg('u1', 'q')] });
  const err = out[out.length - 1];
  assert.equal(err.kind, 'system_notice');
  if (err.kind === 'system_notice') {
    assert.equal(err.variant, 'error');
    assert.equal(err.text, 'cancelled');
  }
});

test('two user messages with separate event segments: events route to correct user turn', () => {
  // 用户问 1 -> assistant 答 1 + complete -> 用户问 2 -> assistant 答 2 + complete
  const events: SessionEvent[] = [
    // 第一轮
    { kind: 'text_delta', sessionId: sid, text: 'reply1' },
    { kind: 'session_complete', sessionId: sid },
    // 第二轮
    { kind: 'text_delta', sessionId: sid, text: 'reply2' },
    { kind: 'session_complete', sessionId: sid },
  ];
  const out = composeMessages({
    events,
    userMessages: [userMsg('u1', 'q1', 1000), userMsg('u2', 'q2', 2000)],
  });
  // v0.1.x: 'complete' system_notice 退役
  assert.deepEqual(kindsOf(out), ['user', 'assistant_text', 'user', 'assistant_text']);
  // 内容对位
  if (out[1].kind === 'assistant_text') assert.equal(out[1].text, 'reply1');
  if (out[3].kind === 'assistant_text') assert.equal(out[3].text, 'reply2');
});
test('session_start is absorbed, not a user-turn boundary (#5 fix)', () => {
  // Regression for #5. session_start is NOT a turn boundary: the SDK emits exactly
  // one per run (CAP-003) and every genuine new turn is already bounded by a
  // terminal or a delivery marker. A stray/extra session_start mid-turn must be
  // absorbed into the current segment — never split a user turn on its own, or a
  // later follow-up gets slotted above content that already streamed.
  const events: SessionEvent[] = [
    { kind: 'session_start', sessionId: sid, provider: 'mock' },
    { kind: 'text_delta', sessionId: sid, text: 'phase1' },
    { kind: 'session_start', sessionId: sid, provider: 'mock' },
    { kind: 'text_delta', sessionId: sid, text: 'phase2-preB' },
    { kind: 'mid_turn_user_prompt', sessionId: sid, content: 'q2' },
    { kind: 'text_delta', sessionId: sid, text: 'phase2-postB' },
    { kind: 'session_complete', sessionId: sid },
  ];
  const out = composeMessages({
    events,
    userMessages: [userMsg('u1', 'q1', 1000), userMsg('u2', 'q2', 3000)],
  });

  // q2 is delivered at its marker — it must appear AFTER all content that streamed
  // before the marker (phase1 + phase2-preB), never above it.
  assert.deepEqual(kindsOf(out), ['user', 'assistant_text', 'user', 'assistant_text']);
  if (out[0].kind === 'user') assert.equal(out[0].content, 'q1');
  if (out[1].kind === 'assistant_text') assert.equal(out[1].text, 'phase1phase2-preB');
  if (out[2].kind === 'user') assert.equal(out[2].content, 'q2');
  if (out[3].kind === 'assistant_text') assert.equal(out[3].text, 'phase2-postB');
});

test('after-turn queued prompt + later interrupt keeps delivery order (#5 regression)', () => {
  // The exact producible bug: turn A completes; an after-turn queued prompt B starts
  // a NEW run, which emits `queued_user_prompt_started` immediately followed by that
  // run's `session_start` (Space startQueuedPromptIfIdle → startRun) — two boundary
  // events for ONE delivery. Then an interrupt C arrives mid-run (mid_turn_user_prompt).
  // When session_start was a boundary, the extra boundary stole C's segment slot: C's
  // bubble rendered ABOVE B's reply ("cB") and B lost its reply. Delivery order must be
  // A, cA, B, cB, C, cC.
  const events: SessionEvent[] = [
    { kind: 'session_start', sessionId: sid, provider: 'mock' },
    { kind: 'text_delta', sessionId: sid, text: 'cA' },
    { kind: 'session_complete', sessionId: sid },
    { kind: 'queued_user_prompt_started', sessionId: sid, queueMode: 'after-turn', content: 'B' },
    { kind: 'session_start', sessionId: sid, provider: 'mock' },
    { kind: 'text_delta', sessionId: sid, text: 'cB' },
    { kind: 'mid_turn_user_prompt', sessionId: sid, content: 'C' },
    { kind: 'text_delta', sessionId: sid, text: 'cC' },
    { kind: 'session_complete', sessionId: sid },
  ];
  const out = composeMessages({
    events,
    userMessages: [userMsg('u1', 'A', 1000), userMsg('u2', 'B', 2000), userMsg('u3', 'C', 3000)],
  });

  assert.deepEqual(kindsOf(out), [
    'user',
    'assistant_text',
    'user',
    'assistant_text',
    'user',
    'assistant_text',
  ]);
  if (out[0].kind === 'user') assert.equal(out[0].content, 'A');
  if (out[1].kind === 'assistant_text') assert.equal(out[1].text, 'cA');
  if (out[2].kind === 'user') assert.equal(out[2].content, 'B');
  if (out[3].kind === 'assistant_text') assert.equal(out[3].text, 'cB');
  if (out[4].kind === 'user') assert.equal(out[4].content, 'C');
  if (out[5].kind === 'assistant_text') assert.equal(out[5].text, 'cC');
});

test('idle-yield follow-up delivered mid-run lands after already-streamed content (#5)', () => {
  // Handoff repro: one run (single session_start, no mid-turn session_complete). A
  // follow-up B is drained on an idle-yield wake and surfaced via mid_turn_user_prompt.
  // B must appear after the content that had already streamed for A, before the reply
  // produced after B's delivery.
  const events: SessionEvent[] = [
    { kind: 'session_start', sessionId: sid, provider: 'mock' },
    { kind: 'text_delta', sessionId: sid, text: 'A-stream-1' },
    { kind: 'tool_start', sessionId: sid, toolId: 't1', toolName: 'read', input: {} },
    { kind: 'tool_result', sessionId: sid, toolId: 't1', toolName: 'read', content: 'ok' },
    { kind: 'text_delta', sessionId: sid, text: 'A-stream-2' },
    { kind: 'mid_turn_user_prompt', sessionId: sid, content: 'B' },
    { kind: 'text_delta', sessionId: sid, text: 'B-reply' },
    { kind: 'session_complete', sessionId: sid },
  ];
  const out = composeMessages({
    events,
    userMessages: [userMsg('u1', 'A', 1000), userMsg('u2', 'B', 5000)],
  });

  assert.deepEqual(kindsOf(out), [
    'user',
    'assistant_text',
    'tool_call',
    'assistant_text',
    'user',
    'assistant_text',
  ]);
  if (out[4].kind === 'user') assert.equal(out[4].content, 'B');
  if (out[5].kind === 'assistant_text') assert.equal(out[5].text, 'B-reply');
});

test('mid_turn_user_prompt splits SDK-consumed interrupt prompt within the same run', () => {
  const events: SessionEvent[] = [
    { kind: 'session_start', sessionId: sid, provider: 'mock' },
    { kind: 'text_delta', sessionId: sid, text: 'reply1' },
    { kind: 'mid_turn_user_prompt', sessionId: sid, content: 'q2' },
    { kind: 'text_delta', sessionId: sid, text: 'reply2' },
    { kind: 'session_complete', sessionId: sid },
  ];
  const out = composeMessages({
    events,
    userMessages: [userMsg('u1', 'q1', 1000), userMsg('u2', 'q2', 1001)],
  });

  assert.deepEqual(kindsOf(out), ['user', 'assistant_text', 'user', 'assistant_text']);
  if (out[1].kind === 'assistant_text') assert.equal(out[1].text, 'reply1');
  if (out[2].kind === 'user') assert.equal(out[2].content, 'q2');
  if (out[3].kind === 'assistant_text') assert.equal(out[3].text, 'reply2');
});

test('queued_user_prompt_started splits a queued follow-up turn at its effective point', () => {
  const events: SessionEvent[] = [
    { kind: 'text_delta', sessionId: sid, text: 'reply1' },
    {
      kind: 'queued_user_prompt_started',
      sessionId: sid,
      queueMode: 'after-turn',
      content: 'q2',
    },
    { kind: 'session_start', sessionId: sid, provider: 'mock' },
    { kind: 'text_delta', sessionId: sid, text: 'reply2' },
    { kind: 'session_complete', sessionId: sid },
  ];
  const out = composeMessages({
    events,
    userMessages: [userMsg('u1', 'q1', 1000), userMsg('u2', 'q2', 1001)],
  });

  assert.deepEqual(kindsOf(out), ['user', 'assistant_text', 'user', 'assistant_text']);
  if (out[1].kind === 'assistant_text') assert.equal(out[1].text, 'reply1');
  if (out[2].kind === 'user') assert.equal(out[2].content, 'q2');
  if (out[3].kind === 'assistant_text') assert.equal(out[3].text, 'reply2');
});

test('multi-terminal error sequence stays in its own turn (500-error history scramble regression)', () => {
  // 回归：SDK AMA 路径一次 500 错误会冒出 [session_error, session_complete, session_error]
  // 三个终止事件（onError + finally onComplete + 外层 catch）。findSegmentEnd 早先只吃
  // 一个终止事件，多出来的两个被算进下一轮 user message，导致后续 user ↔ event 配对整体
  // 错位——错误挂错气泡、回复被甩到列表底部。主修复在 main 端收口为单个终止事件；
  // 这里验证 selector 侧防御：即便多个连续终止事件，也全部留在**本轮**段内，不溢出到下一轮。
  const events: SessionEvent[] = [
    // 第一轮：用户问 q1，回复后 500 错误，main 端 naive 实现的三连终止事件
    { kind: 'text_delta', sessionId: sid, text: 'partial reply' },
    { kind: 'session_error', sessionId: sid, error: 'raw 500' },
    { kind: 'session_complete', sessionId: sid },
    { kind: 'session_error', sessionId: sid, error: 'Server error (500). Retrying may help.' },
    // 第二轮：用户重试 q2，正常回复
    { kind: 'text_delta', sessionId: sid, text: 'reply2' },
    { kind: 'session_complete', sessionId: sid },
  ];
  const out = composeMessages({
    events,
    userMessages: [userMsg('u1', 'q1', 1000), userMsg('u2', 'q2', 2000)],
  });
  // 期望：q1 段吃掉全部 3 个终止事件——其中 session_complete 被 composeAssistantSegment
  // 静默消费(零输出 item)，两个 session_error 各产 1 个 error notice → 输出 2 个 notice。
  // q2 段拿到自己的 reply2。绝不能出现 reply2 漂到 q1、或 q2 下挂着 500 错误。
  assert.deepEqual(kindsOf(out), [
    'user', // q1
    'assistant_text', // partial reply
    'system_notice', // raw 500
    'system_notice', // wrapped 500
    'user', // q2
    'assistant_text', // reply2 —— 正确挂在 q2 下
  ]);
  if (out[1].kind === 'assistant_text') assert.equal(out[1].text, 'partial reply');
  if (out[5].kind === 'assistant_text') assert.equal(out[5].text, 'reply2');
  // q2 (out[4]) 之后第一条是 reply2，不是错误 notice
  assert.equal(out[4].kind, 'user');
  if (out[4].kind === 'user') assert.equal(out[4].content, 'q2');
});

test('text_delta after tool_result starts a NEW assistant bubble (flushed by tool_start)', () => {
  // 验证 tool_start 切断了文本气泡，后续 text_delta 不会接续到前一个气泡
  const events: SessionEvent[] = [
    { kind: 'text_delta', sessionId: sid, text: 'before' },
    {
      kind: 'tool_start',
      sessionId: sid,
      toolId: 't1',
      toolName: 'read',
      input: { path: 'a' },
    },
    {
      kind: 'tool_result',
      sessionId: sid,
      toolId: 't1',
      toolName: 'read',
      content: 'A',
    },
    { kind: 'text_delta', sessionId: sid, text: 'after' },
    { kind: 'session_complete', sessionId: sid },
  ];
  const out = composeMessages({ events, userMessages: [userMsg('u1', 'q')] });
  const bubbles = out.filter((m) => m.kind === 'assistant_text');
  assert.equal(bubbles.length, 2);
  if (bubbles[0].kind === 'assistant_text' && bubbles[1].kind === 'assistant_text') {
    assert.equal(bubbles[0].text, 'before');
    assert.equal(bubbles[1].text, 'after');
  }
});

test('events arrived before any user message are still grouped at end', () => {
  // 启动期收到的事件（理论上不会，但兜底处理）
  // v0.1.x: 'complete' system_notice 退役
  const events: SessionEvent[] = [
    { kind: 'text_delta', sessionId: sid, text: 'orphan' },
    { kind: 'session_complete', sessionId: sid },
  ];
  const out = composeMessages({ events, userMessages: [] });
  assert.equal(out.length, 1);
  assert.equal(out[0].kind, 'assistant_text');
});

test('all messages have unique ids (no React key collisions)', () => {
  const events: SessionEvent[] = [
    { kind: 'text_delta', sessionId: sid, text: 'a' },
    {
      kind: 'tool_start',
      sessionId: sid,
      toolId: 't1',
      toolName: 'read',
      input: {},
    },
    {
      kind: 'tool_result',
      sessionId: sid,
      toolId: 't1',
      toolName: 'read',
      content: '',
    },
    { kind: 'text_delta', sessionId: sid, text: 'b' },
    { kind: 'iteration_end', sessionId: sid, iter: 1, maxIter: 30, tokenCount: 100 },
    { kind: 'session_complete', sessionId: sid },
  ];
  const out = composeMessages({
    events,
    userMessages: [userMsg('u1', 'q1', 1), userMsg('u2', 'q2', 2)],
  });
  const ids = out.map((m) => m.id);
  const uniqueIds = new Set(ids);
  assert.equal(uniqueIds.size, ids.length, `duplicate ids: ${JSON.stringify(ids)}`);
});
test('sidecar_message renders as a sidecar system notice without ending the turn', () => {
  const events: SessionEvent[] = [
    {
      kind: 'sidecar_message',
      sessionId: sid,
      message: {
        source: 'sidecar-verifier',
        verdict: 'revise',
        recipient: 'main-agent',
        delivery: 'synthetic-user-message',
        content: 'Please inspect the changed file.',
        suggestedFix: 'Run npm test.',
      },
    },
    { kind: 'text_delta', sessionId: sid, text: 'I checked it.' },
    { kind: 'session_complete', sessionId: sid },
  ];
  const out = composeMessages({ events, userMessages: [userMsg('u1', 'q')] });
  assert.deepEqual(kindsOf(out), ['user', 'system_notice', 'assistant_text']);
  const notice = out[1];
  assert.equal(notice.kind, 'system_notice');
  if (notice.kind === 'system_notice') {
    assert.equal(notice.variant, 'sidecar');
    assert.match(notice.text, /Sidecar verifier requested revision/);
    assert.match(notice.text, /Run npm test/);
  }
});

test('sidecar_message arriving after session_complete still renders as sidecar notice', () => {
  const events: SessionEvent[] = [
    { kind: 'text_delta', sessionId: sid, text: 'Initial answer.' },
    { kind: 'session_complete', sessionId: sid },
    {
      kind: 'sidecar_message',
      sessionId: sid,
      message: {
        source: 'sidecar-verifier',
        verdict: 'blocked',
        recipient: 'user',
        delivery: 'terminal-block',
        content: 'The answer claimed tests passed without evidence.',
      },
    },
  ];
  const out = composeMessages({ events, userMessages: [userMsg('u1', 'q')] });
  assert.deepEqual(kindsOf(out), ['user', 'assistant_text', 'system_notice']);
  const notice = out[2];
  assert.equal(notice.kind, 'system_notice');
  if (notice.kind === 'system_notice') {
    assert.equal(notice.variant, 'sidecar');
    assert.match(notice.text, /Sidecar verifier blocked completion/);
    assert.match(notice.text, /without evidence/);
  }
});

test('workflow_notice event renders as a workflow system_notice at its transcript position (not by timestamp)', () => {
  // Approach A: on restore, the workflow result comes from the SDK transcript's `<task-completed>`
  // block as a position-anchored `workflow_notice` EVENT (not a wall-clock-merged notice), so it
  // lands exactly where the run executed — surviving the SDK's compaction timestamp-collapse.
  const events: SessionEvent[] = [
    { kind: 'text_delta', sessionId: sid, text: 'assistant reply before the workflow' },
    { kind: 'workflow_notice', sessionId: sid, text: '[workflow] completed · run-x\nreport body' },
    { kind: 'text_delta', sessionId: sid, text: 'assistant reply after the workflow' },
    { kind: 'session_complete', sessionId: sid },
  ];
  const out = composeMessages({ events, userMessages: [userMsg('u1', 'run the workflow', 1000)] });
  const kinds = out.map((m) => m.kind);
  assert.deepEqual(kinds, ['user', 'assistant_text', 'system_notice', 'assistant_text']);
  const notice = out[2];
  assert.equal(notice.kind, 'system_notice');
  if (notice.kind === 'system_notice') {
    assert.equal(notice.variant, 'workflow');
    assert.match(notice.text, /\[workflow\] completed · run-x/);
    assert.match(notice.text, /report body/);
  }
});

test('live workflow completion appears before the main-agent final report in the same turn', () => {
  const events: SessionEvent[] = [
    { kind: 'text_delta', sessionId: sid, text: 'workflow started.' },
    {
      kind: 'workflow_notice',
      sessionId: sid,
      text: '[workflow] completed: v0.1.27-review - run-mr72zyw7\nworkflow summary',
      key: 'finished:run-mr72zyw7:completed',
      sentAt: 1234,
    },
    { kind: 'text_delta', sessionId: sid, text: 'final main-agent report.' },
    { kind: 'session_complete', sessionId: sid },
  ];
  const out = composeMessages({
    events,
    userMessages: [userMsg('u1', 'run workflow review', 1000)],
  });

  assert.deepEqual(kindsOf(out), ['user', 'assistant_text', 'system_notice', 'assistant_text']);
  assert.match(out[1]?.kind === 'assistant_text' ? out[1].text : '', /started/);
  const notice = out[2];
  assert.equal(notice?.kind, 'system_notice');
  if (notice?.kind === 'system_notice') {
    assert.match(notice.text, /run-mr72zyw7/);
    assert.equal(notice.sentAt, 1234);
  }
  assert.match(out[3]?.kind === 'assistant_text' ? out[3].text : '', /final main-agent report/);
});

test('re-rooted session: a workflow notice whose run predates all restored messages is clamped, not pinned to the top', () => {
  // Real case: session s_01213312 was compaction-re-rooted, so every restored message carries
  // the re-root wall-clock (T_ROOT), while the workflow finished just BEFORE the re-root
  // (T_RUN < T_ROOT). By raw sentAt the notice sorts above the entire conversation → top.
  // composeMessages clamps the notice's sort key to the earliest restored message so it lands
  // WITHIN the conversation instead of pinning to the top.
  const T_ROOT = 1_000_000;
  const T_RUN = T_ROOT - 60_000; // run ended a minute before the re-root
  const out = composeMessages({
    events: [],
    userMessages: [
      userMsg('u1', 'first restored turn', T_ROOT),
      userMsg('u2', 'second restored turn', T_ROOT + 1000),
      userMsg('u3', 'third restored turn', T_ROOT + 2000),
    ],
    workflowNotices: [workflowNotice('wf1', '[workflow] completed: review · run-x', T_RUN)],
  });
  assert.notEqual(
    out[0]?.kind,
    'system_notice',
    'notice must NOT be pinned above the conversation',
  );
  assert.equal(out[0]?.kind, 'user', 'earliest restored user turn stays first');
  const noticeIdx = out.findIndex((m) => m.kind === 'system_notice');
  assert.ok(noticeIdx > 0, `notice interleaves within the conversation (idx ${noticeIdx})`);
  // Display still carries the real run time (footer "Xd ago"), only the sort key is clamped.
  const notice = out[noticeIdx];
  if (notice?.kind === 'system_notice') {
    assert.equal(notice.sentAt, T_RUN, 'displayed notice sentAt stays the real run time');
  }

  // Guard the in-range case (e.g. session 20260617_014905, run within the message span):
  // the notice is NOT clamped and interleaves at its true position between turns.
  const inRange = composeMessages({
    events: [],
    userMessages: [userMsg('a', 'early', 1000), userMsg('b', 'late', 3000)],
    workflowNotices: [workflowNotice('wf2', '[workflow] completed', 2000)],
  });
  assert.deepEqual(
    inRange.map((m) => m.kind),
    ['user', 'system_notice', 'user'],
    'in-range notice interleaves at its true position (no clamp)',
  );
});
