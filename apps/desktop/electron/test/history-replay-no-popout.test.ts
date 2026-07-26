// v0.1.9 fix: 历史 session 回放时,KX-I-02 director 不应再"自动展开"对应 popout。
// 用户报: 点已有 session,弹出 worker / diff popout — 干扰当前对话焦点。
// 修法: prependSessionHistory 扫历史 events 提前 mark 已触发过的 SmartPopoutKind,
// director 视为 already promoted 不再 fire。

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { useAppStore } from '../../renderer/src/store/appStore.js';
import {
  decideAutoPromote,
  type SmartPopoutKind,
} from '../../renderer/src/features/popout-director/rules.js';
import { composeMessages } from '../../renderer/src/features/session/composeMessages.js';
import type { SessionHistoryItem } from '@kodax-space/space-ipc-schema';

const SID = 'hist-test';
const FALLBACK_SENT_AT = 1700000000000;

beforeEach(() => {
  // 重置 store 关键 fields
  useAppStore.setState({
    sessions: [
      {
        sessionId: SID,
        projectRoot: '/proj/x',
        provider: 'mock',
        reasoningMode: 'auto',
        permissionMode: 'accept-edits',
        autoModeEngine: 'llm',
        agentMode: 'ama',
        surface: 'code',
        createdAt: FALLBACK_SENT_AT,
        lastActivityAt: FALLBACK_SENT_AT,
      },
    ],
    eventsBySession: {},
    userMessagesBySession: {},
    promotedPopoutsBySession: {},
    currentSessionId: SID,
  });
});

test('history replay marks diff as promoted when file-mutation tool used (write/edit/multi_edit)', () => {
  const items: SessionHistoryItem[] = [
    { kind: 'user', content: 'edit file' },
    {
      kind: 'tool_call',
      toolId: 't1',
      toolName: 'write',
      input: { path: '/x', content: 'hi' },
      result: 'ok',
    },
  ];
  useAppStore.getState().prependSessionHistory(SID, items, FALLBACK_SENT_AT);

  const promoted = useAppStore.getState().promotedPopoutsBySession[SID];
  assert.ok(promoted, 'promoted set created for session');
  assert.equal(promoted.has('diff'), true, 'diff marked promoted from write tool');

  // 验证 director decideAutoPromote 不会再 promote diff
  const events = useAppStore.getState().eventsBySession[SID] ?? [];
  const decision = decideAutoPromote({
    events,
    activePopout: null,
    promoted: promoted as ReadonlySet<SmartPopoutKind>,
  });
  assert.equal(decision, null, 'director sees promoted=true, no auto-open');
});

test('history replay marks all 3 popout kinds when historical session had tasks + plan + diff', () => {
  const items: SessionHistoryItem[] = [
    { kind: 'user', content: 'do stuff' },
    {
      kind: 'tool_call',
      toolId: 't1',
      toolName: 'edit',
      input: { path: '/y', old_string: 'a', new_string: 'b' },
      result: 'ok',
    },
  ];
  // 直接灌一些 todo_update / managed_task_status 进 events 模拟历史 session
  useAppStore.setState({
    eventsBySession: {
      [SID]: [
        {
          kind: 'todo_update',
          sessionId: SID,
          items: [{ id: 't1', content: 'a', status: 'pending' }],
        },
        {
          kind: 'managed_task_status',
          sessionId: SID,
          status: {
            agentMode: 'ama',
            harnessProfile: 'H2_PLAN_EXECUTE_EVAL',
            activeWorkerId: 'w-1',
          },
        },
      ],
    },
  });
  useAppStore.getState().prependSessionHistory(SID, items, FALLBACK_SENT_AT);

  const promoted = useAppStore.getState().promotedPopoutsBySession[SID];
  assert.equal(promoted?.has('diff'), true, 'diff from edit');
  // todo_update / managed_task_status 之前已经在 store 里 (不是 history 回放产生),所以
  // 不会被 markPromoted。本 test 主要锁住 "history 回放的 tool_start(write/edit/...) →
  // diff promoted" 这条主路径,其他 plan/tasks 在 history items 协议中没直接对应字段
  // (history 只回放 user/assistant/tool_call)。
});

test('history replay with read-only tools (bash/grep/read) does NOT promote diff', () => {
  const items: SessionHistoryItem[] = [
    { kind: 'user', content: 'check' },
    { kind: 'tool_call', toolId: 't1', toolName: 'bash', input: { cmd: 'ls' }, result: 'a b c' },
    { kind: 'tool_call', toolId: 't2', toolName: 'grep', input: { pattern: 'foo' }, result: '' },
    { kind: 'tool_call', toolId: 't3', toolName: 'read', input: { path: '/y' }, result: 'content' },
  ];
  useAppStore.getState().prependSessionHistory(SID, items, FALLBACK_SENT_AT);

  const promoted = useAppStore.getState().promotedPopoutsBySession[SID] ?? new Set<string>();
  assert.equal(promoted.has('diff'), false);
  assert.equal(promoted.has('plan'), false);
  assert.equal(promoted.has('tasks'), false);
});

test('history replay preserves existing promoted marks (user already toggled before re-load)', () => {
  // 用户之前手动开过 plan popout → mark 进 promoted。re-load 历史不应该把它清掉。
  useAppStore.setState({
    promotedPopoutsBySession: { [SID]: new Set(['plan']) },
  });
  const items: SessionHistoryItem[] = [
    { kind: 'user', content: 'edit' },
    {
      kind: 'tool_call',
      toolId: 't1',
      toolName: 'write',
      input: { path: '/x', content: 'a' },
      result: 'ok',
    },
  ];
  useAppStore.getState().prependSessionHistory(SID, items, FALLBACK_SENT_AT);

  const promoted = useAppStore.getState().promotedPopoutsBySession[SID];
  assert.equal(promoted?.has('plan'), true, 'old plan mark preserved');
  assert.equal(promoted?.has('diff'), true, 'new diff mark added from history tool_call');
});

test('history replay with no relevant events leaves promoted untouched', () => {
  const items: SessionHistoryItem[] = [
    { kind: 'user', content: 'hello' },
    { kind: 'assistant', text: 'hi', thinking: '' },
  ];
  useAppStore.getState().prependSessionHistory(SID, items, FALLBACK_SENT_AT);

  const promoted = useAppStore.getState().promotedPopoutsBySession[SID];
  // promotedPopoutsBySession[SID] 被设成空 Set (即便没新增 kind, 也会创 entry)
  assert.ok(promoted !== undefined);
  assert.equal(promoted.size, 0);
});

test('history replay folds a completed turn already present from the live stream', () => {
  useAppStore.getState().appendUserMessage(SID, 'one query only', 10_000);
  useAppStore.getState().appendEvent({
    kind: 'session_start',
    sessionId: SID,
    provider: 'mock',
  });
  useAppStore.getState().appendEvent({
    kind: 'thinking_delta',
    sessionId: SID,
    text: 'reasoning ',
    sentAt: 10_100,
  });
  useAppStore.getState().appendEvent({
    kind: 'thinking_delta',
    sessionId: SID,
    text: 'once',
    sentAt: 10_101,
  });
  useAppStore.getState().appendEvent({
    kind: 'text_delta',
    sessionId: SID,
    text: 'one ',
    sentAt: 10_200,
  });
  useAppStore.getState().appendEvent({
    kind: 'text_delta',
    sessionId: SID,
    text: 'answer',
    sentAt: 10_201,
  });
  useAppStore.getState().appendEvent({ kind: 'session_complete', sessionId: SID });

  const restoredItems: SessionHistoryItem[] = [
    { kind: 'user', content: 'one query only', sentAt: 10_050 },
    { kind: 'assistant', thinking: 'reasoning once', text: 'one answer', sentAt: 10_200 },
  ];
  useAppStore.getState().prependSessionHistory(SID, restoredItems, FALLBACK_SENT_AT);
  useAppStore.getState().prependSessionHistory(SID, restoredItems, FALLBACK_SENT_AT);

  const state = useAppStore.getState();
  const out = composeMessages({
    events: state.eventsBySession[SID] ?? [],
    userMessages: state.userMessagesBySession[SID] ?? [],
  });
  assert.equal(
    out.filter((message) => message.kind === 'user' && message.content === 'one query only').length,
    1,
  );
  assert.equal(
    out.filter((message) => message.kind === 'assistant_text' && message.text === 'one answer')
      .length,
    1,
  );
});

test('history replay keeps a deliberately repeated identical turn with a distinct send time', () => {
  useAppStore.getState().appendUserMessage(SID, 'repeat me', 20_000);
  useAppStore
    .getState()
    .appendEvent({ kind: 'text_delta', sessionId: SID, text: 'same answer', sentAt: 20_100 });
  useAppStore.getState().appendEvent({ kind: 'session_complete', sessionId: SID });

  useAppStore.getState().prependSessionHistory(
    SID,
    [
      { kind: 'user', content: 'repeat me', sentAt: 10_000 },
      { kind: 'assistant', text: 'same answer', sentAt: 10_100 },
    ],
    FALLBACK_SENT_AT,
  );

  const state = useAppStore.getState();
  const out = composeMessages({
    events: state.eventsBySession[SID] ?? [],
    userMessages: state.userMessagesBySession[SID] ?? [],
  });
  assert.equal(
    out.filter((message) => message.kind === 'user' && message.content === 'repeat me').length,
    2,
  );
  assert.equal(
    out.filter((message) => message.kind === 'assistant_text' && message.text === 'same answer')
      .length,
    2,
  );
});

test('history overlap keeps earlier restored turns in order before the matching live suffix', () => {
  useAppStore.getState().appendUserMessage(SID, 'second query', 20_050);
  useAppStore
    .getState()
    .appendEvent({ kind: 'text_delta', sessionId: SID, text: 'second answer', sentAt: 20_100 });
  useAppStore.getState().appendEvent({ kind: 'session_complete', sessionId: SID });

  useAppStore.getState().prependSessionHistory(
    SID,
    [
      { kind: 'user', content: 'first query', sentAt: 10_000 },
      { kind: 'assistant', text: 'first answer', sentAt: 10_100 },
      { kind: 'user', content: 'second query', sentAt: 20_000 },
      { kind: 'assistant', text: 'second answer', sentAt: 20_100 },
    ],
    FALLBACK_SENT_AT,
  );

  const state = useAppStore.getState();
  const out = composeMessages({
    events: state.eventsBySession[SID] ?? [],
    userMessages: state.userMessagesBySession[SID] ?? [],
  });
  assert.deepEqual(
    out.flatMap((message) => {
      if (message.kind === 'user') return [`user:${message.content}`];
      if (message.kind === 'assistant_text') return [`assistant:${message.text}`];
      return [];
    }),
    ['user:first query', 'assistant:first answer', 'user:second query', 'assistant:second answer'],
  );
});

test('history overlap preserves an empty consecutive-user segment before the matching live turn', () => {
  useAppStore.getState().appendUserMessage(SID, 'effective prompt', 20_050);
  useAppStore
    .getState()
    .appendEvent({ kind: 'text_delta', sessionId: SID, text: 'shared answer', sentAt: 20_100 });
  useAppStore.getState().appendEvent({ kind: 'session_complete', sessionId: SID });

  useAppStore.getState().prependSessionHistory(
    SID,
    [
      { kind: 'user', content: 'earlier clarification', sentAt: 19_000 },
      { kind: 'user', content: 'effective prompt', sentAt: 20_000 },
      { kind: 'assistant', text: 'shared answer', sentAt: 20_100 },
    ],
    FALLBACK_SENT_AT,
  );

  const state = useAppStore.getState();
  const out = composeMessages({
    events: state.eventsBySession[SID] ?? [],
    userMessages: state.userMessagesBySession[SID] ?? [],
  });
  assert.deepEqual(
    out.flatMap((message) => {
      if (message.kind === 'user') return [`user:${message.content}`];
      if (message.kind === 'assistant_text') return [`assistant:${message.text}`];
      return [];
    }),
    ['user:earlier clarification', 'user:effective prompt', 'assistant:shared answer'],
  );
});

test('history overlap never removes a complete restored turn based on an incomplete live turn', () => {
  useAppStore.getState().appendUserMessage(SID, 'same canonical query', 10_000);
  useAppStore
    .getState()
    .appendEvent({ kind: 'text_delta', sessionId: SID, text: 'partial', sentAt: 10_100 });

  useAppStore.getState().prependSessionHistory(
    SID,
    [
      { kind: 'user', content: 'same canonical query', sentAt: 10_050 },
      { kind: 'assistant', text: 'complete restored answer', sentAt: 10_200 },
    ],
    FALLBACK_SENT_AT,
  );

  const state = useAppStore.getState();
  const out = composeMessages({
    events: state.eventsBySession[SID] ?? [],
    userMessages: state.userMessagesBySession[SID] ?? [],
  });
  assert.equal(
    out.some(
      (message) => message.kind === 'assistant_text' && message.text === 'complete restored answer',
    ),
    true,
    'the complete durable answer must not be discarded by a partial live prefix',
  );
});

test('history-first race waits for the matching live terminal, then folds the restored copy', () => {
  useAppStore.getState().appendUserMessage(SID, 'history won the race', 10_000);
  useAppStore.getState().prependSessionHistory(
    SID,
    [
      { kind: 'user', content: 'earlier durable query', sentAt: 5_000 },
      { kind: 'assistant', text: 'earlier durable answer', sentAt: 5_100 },
      { kind: 'user', content: 'history won the race', sentAt: 10_050 },
      {
        kind: 'assistant',
        thinking: 'same reasoning',
        text: 'same complete answer',
        sentAt: 10_200,
      },
    ],
    FALLBACK_SENT_AT,
  );

  let state = useAppStore.getState();
  let out = composeMessages({
    events: state.eventsBySession[SID] ?? [],
    userMessages: state.userMessagesBySession[SID] ?? [],
  });
  assert.equal(
    out.filter((message) => message.kind === 'user' && message.content === 'history won the race')
      .length,
    2,
    'the durable turn is retained while the live copy is incomplete',
  );
  assert.equal(
    out.some(
      (message) => message.kind === 'assistant_text' && message.text === 'same complete answer',
    ),
    true,
  );

  useAppStore.getState().appendEvent({
    kind: 'session_start',
    sessionId: SID,
    provider: 'mock',
  });
  useAppStore.getState().appendEvent({
    kind: 'thinking_delta',
    sessionId: SID,
    text: 'same reasoning',
    sentAt: 10_200,
  });
  useAppStore.getState().appendEvent({
    kind: 'text_delta',
    sessionId: SID,
    text: 'same complete answer',
    sentAt: 10_300,
  });
  useAppStore.getState().appendEvent({ kind: 'session_complete', sessionId: SID });

  state = useAppStore.getState();
  out = composeMessages({
    events: state.eventsBySession[SID] ?? [],
    userMessages: state.userMessagesBySession[SID] ?? [],
  });
  assert.equal(
    out.filter((message) => message.kind === 'user' && message.content === 'history won the race')
      .length,
    1,
  );
  assert.equal(
    out.filter(
      (message) => message.kind === 'assistant_text' && message.text === 'same complete answer',
    ).length,
    1,
  );
  assert.deepEqual(
    out.flatMap((message) => {
      if (message.kind === 'user') return [`user:${message.content}`];
      if (message.kind === 'assistant_text') return [`assistant:${message.text}`];
      return [];
    }),
    [
      'user:earlier durable query',
      'assistant:earlier durable answer',
      'user:history won the race',
      'assistant:same complete answer',
    ],
    'folding the boundary must not reorder or remove the earlier durable prefix',
  );
});

test('history-first race keeps both turns when the eventual live semantics diverge', () => {
  useAppStore.getState().appendUserMessage(SID, 'same query, divergent result', 10_000);
  useAppStore.getState().prependSessionHistory(
    SID,
    [
      { kind: 'user', content: 'same query, divergent result', sentAt: 10_050 },
      { kind: 'assistant', text: 'durable complete answer', sentAt: 10_200 },
    ],
    FALLBACK_SENT_AT,
  );

  useAppStore.getState().appendEvent({
    kind: 'text_delta',
    sessionId: SID,
    text: 'different live answer',
    sentAt: 10_200,
  });
  useAppStore.getState().appendEvent({ kind: 'session_complete', sessionId: SID });

  const state = useAppStore.getState();
  const out = composeMessages({
    events: state.eventsBySession[SID] ?? [],
    userMessages: state.userMessagesBySession[SID] ?? [],
  });
  assert.equal(
    out.filter(
      (message) => message.kind === 'user' && message.content === 'same query, divergent result',
    ).length,
    2,
  );
  assert.equal(
    out.some(
      (message) => message.kind === 'assistant_text' && message.text === 'durable complete answer',
    ),
    true,
  );
  assert.equal(
    out.some(
      (message) => message.kind === 'assistant_text' && message.text === 'different live answer',
    ),
    true,
  );
});

test('an identical legal repeat sent after history was applied is never folded', () => {
  useAppStore.getState().prependSessionHistory(
    SID,
    [
      { kind: 'user', content: 'repeat after restore', sentAt: 10_000 },
      { kind: 'assistant', text: 'same answer', sentAt: 10_050 },
    ],
    FALLBACK_SENT_AT,
  );

  // Deliberately inside the narrow timestamp skew window. Causality, not text similarity,
  // protects this turn: it did not exist at the history/live merge boundary.
  useAppStore.getState().appendUserMessage(SID, 'repeat after restore', 10_100);
  useAppStore.getState().appendEvent({
    kind: 'text_delta',
    sessionId: SID,
    text: 'same answer',
    sentAt: 10_150,
  });
  useAppStore.getState().appendEvent({ kind: 'session_complete', sessionId: SID });

  const state = useAppStore.getState();
  const out = composeMessages({
    events: state.eventsBySession[SID] ?? [],
    userMessages: state.userMessagesBySession[SID] ?? [],
  });
  assert.equal(
    out.filter((message) => message.kind === 'user' && message.content === 'repeat after restore')
      .length,
    2,
  );
  assert.equal(
    out.filter((message) => message.kind === 'assistant_text' && message.text === 'same answer')
      .length,
    2,
  );
});

test('history overlap preserves turns whose text and tools match but visible order differs', () => {
  useAppStore.getState().appendUserMessage(SID, 'preserve block order', 10_000);
  useAppStore.getState().appendEvent({
    kind: 'tool_start',
    sessionId: SID,
    toolId: 'tool-order',
    toolName: 'read',
    input: { path: '/tmp/order.txt' },
  });
  useAppStore.getState().appendEvent({
    kind: 'tool_result',
    sessionId: SID,
    toolId: 'tool-order',
    toolName: 'read',
    content: 'body',
  });
  useAppStore.getState().appendEvent({
    kind: 'text_delta',
    sessionId: SID,
    text: 'beforeafter',
    sentAt: 10_100,
  });
  useAppStore.getState().appendEvent({ kind: 'session_complete', sessionId: SID });

  useAppStore.getState().prependSessionHistory(
    SID,
    [
      { kind: 'user', content: 'preserve block order', sentAt: 10_050 },
      { kind: 'assistant', text: 'before', sentAt: 10_100 },
      {
        kind: 'tool_call',
        toolId: 'tool-order',
        toolName: 'read',
        input: { path: '/tmp/order.txt' },
        result: 'body',
      },
      { kind: 'assistant', text: 'after', sentAt: 10_200 },
    ],
    FALLBACK_SENT_AT,
  );

  const state = useAppStore.getState();
  assert.equal(
    (state.userMessagesBySession[SID] ?? []).filter(
      (message) => message.content === 'preserve block order',
    ).length,
    2,
    'structurally different turns must not be collapsed into one reordered turn',
  );
});

test('history overlap never removes restored notices absent from a terminal live turn', () => {
  useAppStore.getState().appendUserMessage(SID, 'run review', 10_000);
  useAppStore
    .getState()
    .appendEvent({ kind: 'text_delta', sessionId: SID, text: 'review done', sentAt: 10_100 });
  useAppStore.getState().appendEvent({ kind: 'session_complete', sessionId: SID });

  useAppStore.getState().prependSessionHistory(
    SID,
    [
      { kind: 'user', content: 'run review', sentAt: 10_050 },
      { kind: 'assistant', text: 'review done', sentAt: 10_100 },
      { kind: 'workflow_notice', text: 'durable workflow result' },
    ],
    FALLBACK_SENT_AT,
  );

  const state = useAppStore.getState();
  const out = composeMessages({
    events: state.eventsBySession[SID] ?? [],
    userMessages: state.userMessagesBySession[SID] ?? [],
  });
  assert.equal(
    out.some(
      (message) =>
        message.kind === 'system_notice' &&
        message.variant === 'workflow' &&
        message.text === 'durable workflow result',
    ),
    true,
  );
});

test('history overlap folds identical terminal tool turns without losing the receipt', () => {
  useAppStore.getState().appendUserMessage(SID, 'read file', 10_000);
  useAppStore.getState().appendEvent({
    kind: 'tool_start',
    sessionId: SID,
    toolId: 'tool-1',
    toolName: 'read',
    input: { path: '/tmp/a.txt' },
  });
  useAppStore.getState().appendEvent({
    kind: 'tool_result',
    sessionId: SID,
    toolId: 'tool-1',
    toolName: 'read',
    content: 'file body',
  });
  useAppStore.getState().appendEvent({ kind: 'session_complete', sessionId: SID });

  const restoredItems: SessionHistoryItem[] = [
    { kind: 'user', content: 'read file', sentAt: 10_050 },
    {
      kind: 'tool_call',
      toolId: 'tool-1',
      toolName: 'read',
      input: { path: '/tmp/a.txt' },
      result: 'file body',
    },
  ];
  useAppStore.getState().prependSessionHistory(SID, restoredItems, FALLBACK_SENT_AT);

  const state = useAppStore.getState();
  const out = composeMessages({
    events: state.eventsBySession[SID] ?? [],
    userMessages: state.userMessagesBySession[SID] ?? [],
  });
  const tools = out.filter((message) => message.kind === 'tool_call');
  assert.equal(tools.length, 1);
  assert.equal(tools[0]?.kind === 'tool_call' ? tools[0].result : undefined, 'file body');
});

test('history-first overlap keeps the complete live tool receipt after folding', () => {
  useAppStore.getState().appendUserMessage(SID, 'read after early history', 10_000);
  const restoredItems: SessionHistoryItem[] = [
    { kind: 'user', content: 'read after early history', sentAt: 10_050 },
    {
      kind: 'tool_call',
      toolId: 'tool-history-first',
      toolName: 'read',
      input: { path: '/tmp/history-first.txt' },
      result: 'durable body',
    },
  ];
  useAppStore.getState().prependSessionHistory(SID, restoredItems, FALLBACK_SENT_AT);

  useAppStore.getState().appendEvent({
    kind: 'tool_start',
    sessionId: SID,
    toolId: 'tool-history-first',
    toolName: 'read',
    input: { path: '/tmp/history-first.txt' },
  });
  useAppStore.getState().appendEvent({
    kind: 'tool_result',
    sessionId: SID,
    toolId: 'tool-history-first',
    toolName: 'read',
    content: 'durable body',
  });
  useAppStore.getState().appendEvent({ kind: 'session_complete', sessionId: SID });

  const state = useAppStore.getState();
  const events = state.eventsBySession[SID] ?? [];
  const out = composeMessages({
    events,
    userMessages: state.userMessagesBySession[SID] ?? [],
  });
  const tools = out.filter((message) => message.kind === 'tool_call');
  assert.equal(
    events.filter((event) => event.kind === 'tool_start' && event.toolId === 'tool-history-first')
      .length,
    1,
  );
  assert.equal(
    events.filter((event) => event.kind === 'tool_result' && event.toolId === 'tool-history-first')
      .length,
    1,
  );
  assert.equal(tools.length, 1);
  assert.equal(tools[0]?.kind === 'tool_call' ? tools[0].result : undefined, 'durable body');
});

test('history replay preserves an assistant timestamp distinct from its query timestamp', () => {
  useAppStore.getState().prependSessionHistory(
    SID,
    [
      { kind: 'user', content: 'long task', sentAt: 1_000 },
      { kind: 'assistant', text: 'fresh result', sentAt: 241_000 },
    ],
    FALLBACK_SENT_AT,
  );

  const state = useAppStore.getState();
  const messages = composeMessages({
    events: state.eventsBySession[SID] ?? [],
    userMessages: state.userMessagesBySession[SID] ?? [],
  });
  const answer = messages.find(
    (message): message is Extract<(typeof messages)[number], { kind: 'assistant_text' }> =>
      message.kind === 'assistant_text',
  );

  assert.equal(answer?.text, 'fresh result');
  assert.equal(answer?.sentAt, 241_000);
});

test('history replay hides its alignment anchor when the transcript starts with assistant output', () => {
  useAppStore.setState({
    eventsBySession: {},
    userMessagesBySession: {},
    localNoticesBySession: {},
    workflowNoticesBySession: {},
  });

  useAppStore
    .getState()
    .prependSessionHistory(
      SID,
      [{ kind: 'assistant', text: 'restored assistant output', sentAt: 2_000 }],
      FALLBACK_SENT_AT,
    );

  const state = useAppStore.getState();
  const userMessages = state.userMessagesBySession[SID] ?? [];
  assert.equal(userMessages.length, 1, 'the internal anchor still preserves segment alignment');
  assert.equal(userMessages[0]?.hiddenHistoryAnchor, true);

  const out = composeMessages({
    events: state.eventsBySession[SID] ?? [],
    userMessages,
  });
  assert.equal(
    out.some((message) => message.kind === 'user'),
    false,
  );
  assert.equal(
    out.some(
      (message) =>
        message.kind === 'assistant_text' && message.text === 'restored assistant output',
    ),
    true,
  );
});

test('restored conversation keeps real per-message sentAt so workflow notices are not hoisted to the top', () => {
  // Root-cause regression for "workflow content jumps above the whole conversation after restart".
  // The SDK persists per-message timestamps (SessionTranscriptEntry.timestamp); the session.history
  // handler now forwards them as SessionHistoryItem.sentAt, so prependSessionHistory stamps each
  // restored turn with its real time instead of collapsing every turn onto session.createdAt.
  // createdAt here is LATER than the run — simulating a compaction-re-rooted session, where the
  // re-root resets createdAt to a time AFTER the workflow ran.
  const T1 = 1000;
  const T_RUN = 1500;
  const T2 = 2000;
  const LATE_CREATED = 9999;
  const reset = (): void =>
    useAppStore.setState({
      sessions: [
        {
          sessionId: SID,
          projectRoot: '/proj/x',
          provider: 'mock',
          reasoningMode: 'auto',
          permissionMode: 'accept-edits',
          autoModeEngine: 'llm',
          agentMode: 'ama',
          surface: 'code',
          createdAt: LATE_CREATED,
          lastActivityAt: LATE_CREATED,
        },
      ],
      eventsBySession: {},
      userMessagesBySession: {},
      promotedPopoutsBySession: {},
      workflowNoticesBySession: {
        [SID]: [{ id: 'wf1', content: '[workflow] completed: review', sentAt: T_RUN }],
      },
      currentSessionId: SID,
    });
  const render = () => {
    const s = useAppStore.getState();
    return composeMessages({
      events: s.eventsBySession[SID] ?? [],
      userMessages: s.userMessagesBySession[SID] ?? [],
      workflowNotices: s.workflowNoticesBySession[SID] ?? [],
    });
  };

  // Fixed handler: user items carry real per-message sentAt → the notice interleaves between turns.
  reset();
  useAppStore.getState().prependSessionHistory(
    SID,
    [
      { kind: 'user', content: 'turn one', sentAt: T1 },
      { kind: 'assistant', text: 'reply one' },
      { kind: 'user', content: 'turn two', sentAt: T2 },
      { kind: 'assistant', text: 'reply two' },
    ],
    LATE_CREATED,
  );
  const out = render();
  assert.notEqual(out[0]?.kind, 'system_notice', 'workflow notice must not be hoisted to the top');
  const noticeIdx = out.findIndex((m) => m.kind === 'system_notice');
  const u1 = out.findIndex((m) => m.kind === 'user' && m.content === 'turn one');
  const u2 = out.findIndex((m) => m.kind === 'user' && m.content === 'turn two');
  assert.ok(
    u1 === 0 && noticeIdx > u1 && noticeIdx < u2,
    `notice must interleave between turns (kinds: ${out.map((m) => m.kind).join(',')})`,
  );

  // Safety net (composeMessages clamp): even WITHOUT per-message sentAt — every turn collapses
  // onto the late createdAt because a compaction re-root re-stamped restored messages LATER than
  // the run (real case: session s_01213312, run ended 10:33 < every re-rooted message at 10:34) —
  // the workflow notice must NOT float to the very top. composeMessages clamps a notice's sort
  // position to the earliest restored message, so it interleaves within the conversation instead
  // of pinning above it. (The per-message-sentAt path above still gives the *correct*
  // mid-conversation position when timestamps are real; this clamp is the fallback.)
  reset();
  useAppStore.getState().prependSessionHistory(
    SID,
    [
      { kind: 'user', content: 'turn one' },
      { kind: 'assistant', text: 'reply one' },
      { kind: 'user', content: 'turn two' },
    ],
    LATE_CREATED,
  );
  const controlOut = render();
  assert.notEqual(
    controlOut[0]?.kind,
    'system_notice',
    'clamp: a run-time-earlier notice must NOT pin to the top even when restored messages collapse onto a late createdAt',
  );
  assert.equal(
    controlOut[0]?.kind,
    'user',
    'the first restored user turn stays at the top, not the workflow notice',
  );
});

test('history replay preserves transcript pairing when restored user timestamps move backwards', () => {
  // Real KodaX JSONL history can contain transcript-ordered user turns whose wall-clock
  // timestamps were collapsed or backdated by restore/compaction metadata. Replies are
  // replayed as an ordered event stream, so the restored user sort order must stay the
  // transcript order or each assistant segment can attach to the wrong prompt.
  useAppStore.setState({
    eventsBySession: {},
    userMessagesBySession: {},
    localNoticesBySession: {},
    workflowNoticesBySession: {},
  });

  useAppStore.getState().prependSessionHistory(
    SID,
    [
      { kind: 'user', content: 'first query', sentAt: 3000 },
      { kind: 'assistant', text: 'first answer' },
      { kind: 'user', content: 'second query', sentAt: 1000 },
      { kind: 'assistant', text: 'second answer' },
      { kind: 'user', content: 'third query', sentAt: 2000 },
      { kind: 'assistant', text: 'third answer' },
    ],
    FALLBACK_SENT_AT,
  );

  const state = useAppStore.getState();
  const userMessages = state.userMessagesBySession[SID] ?? [];
  assert.deepEqual(
    userMessages.map((message) => message.content),
    ['first query', 'second query', 'third query'],
  );
  assert.ok(
    userMessages[0].sentAt < userMessages[1].sentAt &&
      userMessages[1].sentAt < userMessages[2].sentAt,
    `restored user sentAt values must be monotonic (${userMessages
      .map((message) => message.sentAt)
      .join(',')})`,
  );

  const out = composeMessages({
    events: state.eventsBySession[SID] ?? [],
    userMessages,
  });
  const visibleTurns = out.flatMap((message) => {
    if (message.kind === 'user') return [`user:${message.content}`];
    if (message.kind === 'assistant_text') return [`assistant:${message.text}`];
    return [];
  });
  assert.deepEqual(visibleTurns, [
    'user:first query',
    'assistant:first answer',
    'user:second query',
    'assistant:second answer',
    'user:third query',
    'assistant:third answer',
  ]);
});

test('history replay preserves pairing after consecutive restored user prompts', () => {
  // KodaX CLI sessions can contain back-to-back real user prompts before the next
  // assistant response. Each visible user still consumes one composeMessages segment,
  // so the first prompt needs an explicit empty boundary; otherwise every later
  // assistant segment shifts up and appears before its real query.
  useAppStore.setState({
    eventsBySession: {},
    userMessagesBySession: {},
    localNoticesBySession: {},
    workflowNoticesBySession: {},
  });

  useAppStore.getState().prependSessionHistory(
    SID,
    [
      { kind: 'user', content: 'first prompt', sentAt: 1000 },
      { kind: 'assistant', text: 'first answer' },
      { kind: 'user', content: 'clarification one', sentAt: 2000 },
      { kind: 'user', content: 'clarification two', sentAt: 2000 },
      { kind: 'assistant', text: 'clarification answer' },
      { kind: 'user', content: 'next prompt', sentAt: 3000 },
      { kind: 'assistant', text: 'next answer' },
    ],
    FALLBACK_SENT_AT,
  );

  const state = useAppStore.getState();
  const out = composeMessages({
    events: state.eventsBySession[SID] ?? [],
    userMessages: state.userMessagesBySession[SID] ?? [],
  });
  const visibleTurns = out.flatMap((message) => {
    if (message.kind === 'user') return [`user:${message.content}`];
    if (message.kind === 'assistant_text') return [`assistant:${message.text}`];
    return [];
  });
  assert.deepEqual(visibleTurns, [
    'user:first prompt',
    'assistant:first answer',
    'user:clarification one',
    'user:clarification two',
    'assistant:clarification answer',
    'user:next prompt',
    'assistant:next answer',
  ]);
});

test('history replay restores sidecar verifier messages as sidecar notices', () => {
  const items: SessionHistoryItem[] = [
    { kind: 'user', content: 'q' },
    {
      kind: 'sidecar_message',
      message: {
        source: 'sidecar-verifier',
        verdict: 'revise',
        recipient: 'main-agent',
        delivery: 'synthetic-user-message',
        content: 'Please rerun the focused test.',
      },
    },
    { kind: 'assistant', text: 'Reran it and fixed the issue.' },
  ];

  useAppStore.getState().prependSessionHistory(SID, items, FALLBACK_SENT_AT);
  const state = useAppStore.getState();
  const events = state.eventsBySession[SID] ?? [];
  assert.equal(
    events.some((event) => event.kind === 'sidecar_message'),
    true,
  );

  const out = composeMessages({
    events,
    userMessages: state.userMessagesBySession[SID] ?? [],
  });
  const notice = out.find((message) => message.kind === 'system_notice');
  assert.equal(notice?.kind, 'system_notice');
  if (notice?.kind === 'system_notice') {
    assert.equal(notice.variant, 'sidecar');
    assert.match(notice.text, /Please rerun the focused test/);
  }
});

test('workflow_notice history item restores as a workflow system_notice at its transcript position (approach A)', () => {
  // The SDK stores a workflow run's result as a `_synthetic` `<task-completed>` transcript message
  // at the correct position. session.history maps it to a `workflow_notice` item; prependSessionHistory
  // routes it to a position-anchored event so composeMessages renders it exactly where the run ran —
  // NOT hoisted to the top, and independent of the (compaction-collapsed) wall-clock timestamps.
  useAppStore.setState({
    eventsBySession: {},
    userMessagesBySession: {},
    workflowNoticesBySession: {},
  });
  const items: SessionHistoryItem[] = [
    { kind: 'user', content: 'run the workflow', sentAt: 1000 },
    { kind: 'assistant', text: 'kicking it off' },
    { kind: 'workflow_notice', text: '[workflow] completed · run-x\nthe report body' },
    { kind: 'user', content: 'thanks', sentAt: 2000 },
    { kind: 'assistant', text: 'you are welcome' },
  ];
  useAppStore.getState().prependSessionHistory(SID, items, FALLBACK_SENT_AT);
  const s = useAppStore.getState();
  const out = composeMessages({
    events: s.eventsBySession[SID] ?? [],
    userMessages: s.userMessagesBySession[SID] ?? [],
    workflowNotices: s.workflowNoticesBySession[SID] ?? [],
  });
  assert.notEqual(out[0]?.kind, 'system_notice', 'workflow notice must NOT be pinned to the top');
  const nIdx = out.findIndex((m) => m.kind === 'system_notice' && m.variant === 'workflow');
  const u1 = out.findIndex((m) => m.kind === 'user' && m.content === 'run the workflow');
  const u2 = out.findIndex((m) => m.kind === 'user' && m.content === 'thanks');
  assert.ok(nIdx > -1, 'workflow notice present');
  assert.ok(
    u1 === 0 && nIdx > u1 && nIdx < u2,
    `workflow notice interleaves at its run position (kinds: ${out.map((m) => m.kind).join(',')})`,
  );
  const notice = out[nIdx];
  if (notice?.kind === 'system_notice') assert.match(notice.text, /\[workflow\] completed · run-x/);
});
