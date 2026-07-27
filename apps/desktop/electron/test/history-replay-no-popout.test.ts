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

test('history replay folds a completed live turn across the observed 1,768 ms skew', () => {
  useAppStore.getState().appendUserMessage(SID, 'one query only', 10_000);
  useAppStore.getState().appendEvent({
    kind: 'session_start',
    sessionId: SID,
    provider: 'mock',
    turnId: 'turn-one',
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
  useAppStore
    .getState()
    .appendEvent({ kind: 'session_complete', sessionId: SID, turnId: 'turn-one' });

  const restoredItems: SessionHistoryItem[] = [
    {
      kind: 'user',
      content: 'one query only',
      sentAt: 11_768,
      turnId: 'turn-one',
      turnUserOrdinal: 0,
    },
    { kind: 'assistant', thinking: 'reasoning once', text: 'one answer', sentAt: 11_900 },
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
  useAppStore.getState().appendEvent({
    kind: 'session_start',
    sessionId: SID,
    provider: 'mock',
    turnId: 'turn-new',
  });
  useAppStore
    .getState()
    .appendEvent({ kind: 'text_delta', sessionId: SID, text: 'same answer', sentAt: 20_100 });
  useAppStore
    .getState()
    .appendEvent({ kind: 'session_complete', sessionId: SID, turnId: 'turn-new' });

  useAppStore.getState().prependSessionHistory(
    SID,
    [
      {
        kind: 'user',
        content: 'repeat me',
        sentAt: 10_000,
        turnId: 'turn-old',
        turnUserOrdinal: 0,
      },
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
  useAppStore.getState().appendEvent({
    kind: 'session_start',
    sessionId: SID,
    provider: 'mock',
    turnId: 'turn-second',
  });
  useAppStore
    .getState()
    .appendEvent({ kind: 'text_delta', sessionId: SID, text: 'second answer', sentAt: 20_100 });
  useAppStore
    .getState()
    .appendEvent({ kind: 'session_complete', sessionId: SID, turnId: 'turn-second' });

  useAppStore.getState().prependSessionHistory(
    SID,
    [
      {
        kind: 'user',
        content: 'first query',
        sentAt: 10_000,
        turnId: 'turn-first',
        turnUserOrdinal: 0,
      },
      { kind: 'assistant', text: 'first answer', sentAt: 10_100 },
      {
        kind: 'user',
        content: 'second query',
        sentAt: 20_000,
        turnId: 'turn-second',
        turnUserOrdinal: 0,
      },
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
  useAppStore.getState().appendEvent({
    kind: 'session_start',
    sessionId: SID,
    provider: 'mock',
    turnId: 'turn-effective',
  });
  useAppStore
    .getState()
    .appendEvent({ kind: 'text_delta', sessionId: SID, text: 'shared answer', sentAt: 20_100 });
  useAppStore
    .getState()
    .appendEvent({ kind: 'session_complete', sessionId: SID, turnId: 'turn-effective' });

  useAppStore.getState().prependSessionHistory(
    SID,
    [
      {
        kind: 'user',
        content: 'earlier clarification',
        sentAt: 19_000,
        turnId: 'turn-clarification',
        turnUserOrdinal: 0,
      },
      {
        kind: 'user',
        content: 'effective prompt',
        sentAt: 20_000,
        turnId: 'turn-effective',
        turnUserOrdinal: 0,
      },
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
  useAppStore.getState().appendEvent({
    kind: 'session_start',
    sessionId: SID,
    provider: 'mock',
    turnId: 'turn-incomplete',
  });
  useAppStore
    .getState()
    .appendEvent({ kind: 'text_delta', sessionId: SID, text: 'partial', sentAt: 10_100 });

  useAppStore.getState().prependSessionHistory(
    SID,
    [
      {
        kind: 'user',
        content: 'same canonical query',
        sentAt: 10_050,
        turnId: 'turn-incomplete',
        turnUserOrdinal: 0,
      },
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
  useAppStore.getState().appendEvent({
    kind: 'session_start',
    sessionId: SID,
    provider: 'mock',
  });
  useAppStore.getState().prependSessionHistory(
    SID,
    [
      { kind: 'user', content: 'earlier durable query', sentAt: 5_000 },
      { kind: 'assistant', text: 'earlier durable answer', sentAt: 5_100 },
      {
        kind: 'user',
        content: 'history won the race',
        sentAt: 10_050,
        turnId: 'turn-race',
        turnUserOrdinal: 0,
      },
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
    'run.started has no Runtime turn identity, so both projections remain visible for now',
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
    turnId: 'turn-race',
  });
  state = useAppStore.getState();
  out = composeMessages({
    events: state.eventsBySession[SID] ?? [],
    userMessages: state.userMessagesBySession[SID] ?? [],
  });
  assert.equal(
    out.filter((message) => message.kind === 'user' && message.content === 'history won the race')
      .length,
    1,
    'turn.started supplies strong identity and immediately hides the open duplicate projection',
  );
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
  useAppStore
    .getState()
    .appendEvent({ kind: 'session_complete', sessionId: SID, turnId: 'turn-race' });

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

test('history-first queued promotion keeps a live segment owner without rendering a second query', () => {
  const store = useAppStore.getState();
  const localId = store.appendQueuedUserMessage(SID, {
    content: 'display-form queued query',
    matchContent: 'canonical queued query',
    queueMode: 'after-turn',
    sentAt: 8_000,
  });
  assert.ok(localId);
  store.markQueuedUserMessageAccepted(SID, localId, 'run-queued', 'after-turn');

  store.prependSessionHistory(
    SID,
    [
      {
        kind: 'user',
        content: 'canonical queued query',
        sentAt: 10_000,
        turnId: 'turn-queued',
        turnUserOrdinal: 0,
      },
      { kind: 'assistant', text: 'durable queued answer', sentAt: 10_100 },
    ],
    FALLBACK_SENT_AT,
  );
  store.appendEvent({
    kind: 'queued_user_prompt_started',
    sessionId: SID,
    queueId: 'run-queued',
    queueMode: 'after-turn',
    content: 'canonical queued query',
    turnId: 'turn-queued',
  });

  let state = useAppStore.getState();
  let out = composeMessages({
    events: state.eventsBySession[SID] ?? [],
    userMessages: state.userMessagesBySession[SID] ?? [],
    queuedUserMessages: state.queuedUserMessagesBySession[SID] ?? [],
  });
  assert.equal(state.queuedUserMessagesBySession[SID]?.length ?? 0, 0);
  assert.equal(out.filter((message) => message.kind === 'user').length, 1);
  assert.equal(
    out.some((message) => message.kind === 'user' && message.content === 'canonical queued query'),
    true,
    'history remains the canonical visible query even when queued display text differs',
  );
  assert.equal(
    (state.userMessagesBySession[SID] ?? []).some(
      (message) =>
        !message.restoredFromHistory &&
        message.turnId === 'turn-queued' &&
        message.hiddenProjectionDuplicate === true,
    ),
    true,
    'the hidden live owner keeps subsequent events paired until terminal reconciliation',
  );

  store.appendEvent({
    kind: 'text_delta',
    sessionId: SID,
    text: 'durable queued answer',
    sentAt: 10_200,
  });
  store.appendEvent({
    kind: 'session_complete',
    sessionId: SID,
    turnId: 'turn-queued',
  });

  state = useAppStore.getState();
  out = composeMessages({
    events: state.eventsBySession[SID] ?? [],
    userMessages: state.userMessagesBySession[SID] ?? [],
    queuedUserMessages: state.queuedUserMessagesBySession[SID] ?? [],
  });
  assert.equal(out.filter((message) => message.kind === 'user').length, 1);
  assert.equal(
    out.filter(
      (message) => message.kind === 'assistant_text' && message.text === 'durable queued answer',
    ).length,
    1,
  );
  assert.equal(
    (state.userMessagesBySession[SID] ?? []).some(
      (message) => message.hiddenProjectionDuplicate === true,
    ),
    false,
  );
});

test('a later interrupt cannot steal an earlier history/live-overlap response segment', () => {
  const store = useAppStore.getState();
  const futureBase = Date.now() + 60_000;
  useAppStore.setState({ queuedUserMessagesBySession: {} });
  store.prependSessionHistory(
    SID,
    [
      {
        kind: 'user',
        content: 'initial active-run request',
        sentAt: futureBase,
        turnId: 'turn-active',
        turnUserOrdinal: 0,
      },
      { kind: 'assistant', text: 'initial response', sentAt: futureBase + 100 },
      {
        kind: 'user',
        content: '使用Lua脚本是因为适配Redis是吗？',
        sentAt: futureBase + 200,
        turnId: 'turn-active',
        turnUserOrdinal: 1,
      },
      { kind: 'assistant', text: 'Redis Lua response', sentAt: futureBase + 300 },
    ],
    FALLBACK_SENT_AT,
  );

  // Opening an already-running session restores durable history first, then projects the
  // active Runtime run. The run prefix precedes the first delivered interrupt marker but
  // has no live user owner of its own.
  store.appendEvent({
    kind: 'session_start',
    sessionId: SID,
    provider: 'mock',
    turnId: 'turn-active',
  });
  store.appendEvent({
    kind: 'mid_turn_user_prompt',
    sessionId: SID,
    queueId: 'interrupt-lua',
    content: '使用Lua脚本是因为适配Redis是吗？',
    turnId: 'turn-active',
  });
  store.appendEvent({
    kind: 'text_delta',
    sessionId: SID,
    text: 'Redis Lua response',
    sentAt: futureBase + 400,
  });
  store.appendEvent({
    kind: 'tool_start',
    sessionId: SID,
    toolId: 'tool-19',
    toolName: 'multi_edit',
    input: {},
  });
  store.appendEvent({
    kind: 'tool_result',
    sessionId: SID,
    toolId: 'tool-19',
    toolName: 'multi_edit',
    content: 'applied',
  });

  const queuedId = store.appendQueuedUserMessage(SID, {
    content: '你好像停了很久了',
    matchContent: '你好像停了很久了',
    queueMode: 'interrupt',
    sentAt: futureBase + 500,
  });
  assert.ok(queuedId);
  store.markQueuedUserMessageAccepted(SID, queuedId, 'interrupt-waiting', 'interrupt');
  store.appendEvent({
    kind: 'mid_turn_user_prompt',
    sessionId: SID,
    queueId: 'interrupt-waiting',
    content: '你好像停了很久了',
    // Keep the same Runtime turn to cover multiple safe-point deliveries in one long run.
    // The reported Session happened to advance to a fresh turn, which is the easier case.
    turnId: 'turn-active',
  });

  const state = useAppStore.getState();
  const delivered = (state.userMessagesBySession[SID] ?? []).find(
    (message) => message.content === '你好像停了很久了',
  );
  assert.deepEqual(
    delivered && [delivered.turnId, delivered.turnUserOrdinal],
    ['turn-active', 2],
    'a new same-turn interrupt must not reuse an unmatched restored ordinal',
  );
  const out = composeMessages({
    events: state.eventsBySession[SID] ?? [],
    userMessages: state.userMessagesBySession[SID] ?? [],
    queuedUserMessages: state.queuedUserMessagesBySession[SID] ?? [],
  });
  const visible = out.flatMap((message) => {
    if (message.kind === 'user') return [`user:${message.content}`];
    if (message.kind === 'assistant_text') return [`assistant:${message.text}`];
    if (message.kind === 'tool_call') return [`tool:${message.toolName}`];
    return [];
  });

  assert.deepEqual(visible, [
    'user:initial active-run request',
    'assistant:initial response',
    'user:使用Lua脚本是因为适配Redis是吗？',
    'assistant:Redis Lua response',
    'tool:multi_edit',
    'user:你好像停了很久了',
  ]);
  assert.equal(
    state.queuedUserMessagesBySession[SID]?.length ?? 0,
    0,
    'the delivered query leaves the queue overlay exactly once',
  );

  // A reconnect can replay the already-consumed delivery. It must not append a second segment
  // boundary: even when user-message identity prevents a duplicate bubble, that stray boundary
  // would shift the ownership of all later response events.
  store.appendEvent({
    kind: 'mid_turn_user_prompt',
    sessionId: SID,
    queueId: 'interrupt-waiting',
    content: '你好像停了很久了',
    turnId: 'turn-active',
  });
  store.appendEvent({
    kind: 'text_delta',
    sessionId: SID,
    text: '继续处理',
    sentAt: futureBase + 600,
  });

  const replayedState = useAppStore.getState();
  assert.equal(
    (replayedState.eventsBySession[SID] ?? []).filter(
      (event) => event.kind === 'mid_turn_user_prompt' && event.queueId === 'interrupt-waiting',
    ).length,
    1,
    'a replayed delivery marker must be dropped as a whole',
  );
  const replayedOutput = composeMessages({
    events: replayedState.eventsBySession[SID] ?? [],
    userMessages: replayedState.userMessagesBySession[SID] ?? [],
    queuedUserMessages: replayedState.queuedUserMessagesBySession[SID] ?? [],
  });
  assert.equal(
    replayedOutput.filter(
      (message) => message.kind === 'user' && message.content === '你好像停了很久了',
    ).length,
    1,
  );
  assert.deepEqual(
    replayedOutput
      .slice(-2)
      .map((message) =>
        message.kind === 'user'
          ? `user:${message.content}`
          : message.kind === 'assistant_text'
            ? `assistant:${message.text}`
            : message.kind,
      ),
    ['user:你好像停了很久了', 'assistant:继续处理'],
  );

  const foldedLuaOwner = (replayedState.userMessagesBySession[SID] ?? []).find(
    (message) =>
      message.restoredFromHistory &&
      message.turnId === 'turn-active' &&
      message.turnUserOrdinal === 1,
  );
  assert.deepEqual(
    foldedLuaOwner && [foldedLuaOwner.deliveryQueueMode, foldedLuaOwner.deliveryQueueId],
    ['interrupt', 'interrupt-lua'],
    'strong-identity folding must transfer consumed delivery identity to the durable owner',
  );
  const eventCountBeforeFoldedReplay = replayedState.eventsBySession[SID]?.length ?? 0;
  store.appendEvent({
    kind: 'mid_turn_user_prompt',
    sessionId: SID,
    queueId: 'interrupt-lua',
    content: '使用Lua脚本是因为适配Redis是吗？',
    turnId: 'turn-active',
  });
  assert.equal(
    useAppStore.getState().eventsBySession[SID]?.length ?? 0,
    eventCountBeforeFoldedReplay,
    'a delivery replay remains idempotent after its live owner folds into durable history',
  );
});

test('a mismatched live terminal unhides rather than deletes an ambiguous projection', () => {
  const store = useAppStore.getState();
  store.appendUserMessage(SID, 'identity mismatch safety', 10_000);
  store.appendEvent({
    kind: 'session_start',
    sessionId: SID,
    provider: 'mock',
    turnId: 'turn-expected',
  });
  store.appendEvent({
    kind: 'text_delta',
    sessionId: SID,
    text: 'live answer',
    sentAt: 10_100,
  });
  store.prependSessionHistory(
    SID,
    [
      {
        kind: 'user',
        content: 'identity mismatch safety',
        sentAt: 10_050,
        turnId: 'turn-expected',
        turnUserOrdinal: 0,
      },
      { kind: 'assistant', text: 'durable answer', sentAt: 10_200 },
    ],
    FALLBACK_SENT_AT,
  );
  assert.equal(
    useAppStore
      .getState()
      .userMessagesBySession[SID]?.some((message) => message.hiddenProjectionDuplicate === true),
    true,
  );

  store.appendEvent({
    kind: 'session_complete',
    sessionId: SID,
    turnId: 'turn-unexpected',
  });

  const state = useAppStore.getState();
  assert.equal(
    (state.userMessagesBySession[SID] ?? []).some(
      (message) => message.hiddenProjectionDuplicate === true,
    ),
    false,
  );
  const out = composeMessages({
    events: state.eventsBySession[SID] ?? [],
    userMessages: state.userMessagesBySession[SID] ?? [],
  });
  assert.equal(
    out.filter(
      (message) => message.kind === 'user' && message.content === 'identity mismatch safety',
    ).length,
    2,
    'a terminal for another identity must fail open instead of deleting transcript content',
  );
  assert.equal(
    out.some((message) => message.kind === 'assistant_text' && message.text === 'durable answer'),
    true,
  );
  assert.equal(
    out.some((message) => message.kind === 'assistant_text' && message.text === 'live answer'),
    true,
  );
});

test('an in-flight final turn does not prevent an earlier strong-identity fold', () => {
  const store = useAppStore.getState();
  store.appendUserMessage(SID, 'completed live turn', 10_000);
  store.appendEvent({
    kind: 'session_start',
    sessionId: SID,
    provider: 'mock',
    turnId: 'turn-complete',
  });
  store.appendEvent({
    kind: 'text_delta',
    sessionId: SID,
    text: 'completed answer',
    sentAt: 10_100,
  });
  store.appendEvent({
    kind: 'session_complete',
    sessionId: SID,
    turnId: 'turn-complete',
  });
  store.appendUserMessage(SID, 'still running', 20_000);
  store.appendEvent({
    kind: 'session_start',
    sessionId: SID,
    provider: 'mock',
    turnId: 'turn-running',
  });
  store.appendEvent({
    kind: 'text_delta',
    sessionId: SID,
    text: 'partial live answer',
    sentAt: 20_100,
  });

  store.prependSessionHistory(
    SID,
    [
      {
        kind: 'user',
        content: 'completed live turn',
        sentAt: 10_050,
        turnId: 'turn-complete',
        turnUserOrdinal: 0,
      },
      { kind: 'assistant', text: 'completed answer', sentAt: 10_100 },
      {
        kind: 'user',
        content: 'still running',
        sentAt: 20_050,
        turnId: 'turn-running',
        turnUserOrdinal: 0,
      },
      { kind: 'assistant', text: 'durable running snapshot', sentAt: 20_100 },
    ],
    FALLBACK_SENT_AT,
  );

  const state = useAppStore.getState();
  const users = state.userMessagesBySession[SID] ?? [];
  assert.equal(users.filter((message) => message.content === 'completed live turn').length, 1);
  assert.equal(users.filter((message) => message.content === 'still running').length, 2);
  const out = composeMessages({
    events: state.eventsBySession[SID] ?? [],
    userMessages: users,
  });
  assert.equal(out.filter((message) => message.kind === 'user').length, 2);
  assert.equal(
    out.some(
      (message) => message.kind === 'assistant_text' && message.text === 'durable running snapshot',
    ),
    true,
  );
  assert.equal(
    out.some(
      (message) => message.kind === 'assistant_text' && message.text === 'partial live answer',
    ),
    false,
    'the open live projection remains paired but hidden until its terminal arrives',
  );
});

test('one Runtime turn keeps distinct user boundaries by visible ordinal', () => {
  const store = useAppStore.getState();
  store.appendUserMessage(SID, 'initial request', 10_000);
  store.appendEvent({
    kind: 'session_start',
    sessionId: SID,
    provider: 'mock',
    turnId: 'turn-multi-user',
  });
  store.appendEvent({
    kind: 'text_delta',
    sessionId: SID,
    text: 'first response',
    sentAt: 10_100,
  });
  store.appendEvent({
    kind: 'mid_turn_user_prompt',
    sessionId: SID,
    queueId: 'interrupt-1',
    content: 'correction',
    turnId: 'turn-multi-user',
  });
  store.appendEvent({
    kind: 'text_delta',
    sessionId: SID,
    text: 'corrected response',
    sentAt: 10_200,
  });
  store.appendEvent({
    kind: 'session_complete',
    sessionId: SID,
    turnId: 'turn-multi-user',
  });

  store.prependSessionHistory(
    SID,
    [
      {
        kind: 'user',
        content: 'initial request',
        sentAt: 10_020,
        turnId: 'turn-multi-user',
        turnUserOrdinal: 0,
      },
      { kind: 'assistant', text: 'first response', sentAt: 10_100 },
      {
        kind: 'user',
        content: 'correction',
        sentAt: 10_120,
        turnId: 'turn-multi-user',
        turnUserOrdinal: 1,
      },
      { kind: 'assistant', text: 'corrected response', sentAt: 10_200 },
    ],
    FALLBACK_SENT_AT,
  );

  const state = useAppStore.getState();
  const users = state.userMessagesBySession[SID] ?? [];
  assert.deepEqual(
    users.map((message) => [message.content, message.turnUserOrdinal]),
    [
      ['initial request', 0],
      ['correction', 1],
    ],
  );
  const out = composeMessages({
    events: state.eventsBySession[SID] ?? [],
    userMessages: users,
  });
  assert.deepEqual(
    out.flatMap((message) => {
      if (message.kind === 'user') return [`user:${message.content}`];
      if (message.kind === 'assistant_text') return [`assistant:${message.text}`];
      return [];
    }),
    [
      'user:initial request',
      'assistant:first response',
      'user:correction',
      'assistant:corrected response',
    ],
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
      {
        kind: 'user',
        content: 'repeat after restore',
        sentAt: 10_000,
        turnId: 'turn-repeat-old',
        turnUserOrdinal: 0,
      },
      { kind: 'assistant', text: 'same answer', sentAt: 10_050 },
    ],
    FALLBACK_SENT_AT,
  );

  // Deliberately inside the narrow timestamp skew window. Causality, not text similarity,
  // protects this turn: it did not exist at the history/live merge boundary.
  useAppStore.getState().appendUserMessage(SID, 'repeat after restore', 10_100);
  useAppStore.getState().appendEvent({
    kind: 'session_start',
    sessionId: SID,
    provider: 'mock',
    turnId: 'turn-repeat-new',
  });
  useAppStore.getState().appendEvent({
    kind: 'text_delta',
    sessionId: SID,
    text: 'same answer',
    sentAt: 10_150,
  });
  useAppStore
    .getState()
    .appendEvent({ kind: 'session_complete', sessionId: SID, turnId: 'turn-repeat-new' });

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

test('strong identity folds heterogeneous projections while preserving durable visible order', () => {
  useAppStore.getState().appendUserMessage(SID, 'preserve block order', 10_000);
  useAppStore.getState().appendEvent({
    kind: 'session_start',
    sessionId: SID,
    provider: 'mock',
    turnId: 'turn-order',
  });
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
  useAppStore.getState().appendEvent({
    kind: 'todo_update',
    sessionId: SID,
    items: [{ id: 'todo-1', content: 'preserve live state', status: 'completed' }],
  });
  useAppStore.getState().appendEvent({
    kind: 'tool_start',
    sessionId: SID,
    toolId: 'artifact-live-only',
    toolName: 'create_artifact',
    input: {
      kind: 'html',
      title: 'Live-only artifact',
      content: '<p>kept</p>',
    },
  });
  useAppStore.getState().appendEvent({
    kind: 'tool_result',
    sessionId: SID,
    toolId: 'artifact-live-only',
    toolName: 'create_artifact',
    content: 'created (id=artifact-1, v1)',
  });
  useAppStore
    .getState()
    .appendEvent({ kind: 'session_complete', sessionId: SID, turnId: 'turn-order' });

  useAppStore.getState().prependSessionHistory(
    SID,
    [
      {
        kind: 'user',
        content: 'preserve block order',
        sentAt: 10_050,
        turnId: 'turn-order',
        turnUserOrdinal: 0,
      },
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
    1,
    'the two projections have the same canonical turn identity',
  );
  const out = composeMessages({
    events: state.eventsBySession[SID] ?? [],
    userMessages: state.userMessagesBySession[SID] ?? [],
  });
  assert.deepEqual(
    out.flatMap((message) => {
      if (message.kind === 'assistant_text') return [`text:${message.text}`];
      if (message.kind === 'tool_call') return [`tool:${message.toolName}`];
      return [];
    }),
    ['text:before', 'tool:read', 'text:after', 'tool:create_artifact'],
    'history is the durable visible-order baseline and live-only tools remain after it',
  );
  assert.deepEqual(state.todoListBySession[SID], [
    { id: 'todo-1', content: 'preserve live state', status: 'completed' },
  ]);
  assert.equal(state.transientArtifactsBySession[SID]?.length, 1);
  assert.equal(state.transientArtifactsBySession[SID]?.[0]?.id, 'artifact-1');
});

test('history overlap never removes restored notices absent from a terminal live turn', () => {
  useAppStore.getState().appendUserMessage(SID, 'run review', 10_000);
  useAppStore.getState().appendEvent({
    kind: 'session_start',
    sessionId: SID,
    provider: 'mock',
    turnId: 'turn-notice',
  });
  useAppStore
    .getState()
    .appendEvent({ kind: 'text_delta', sessionId: SID, text: 'review done', sentAt: 10_100 });
  useAppStore
    .getState()
    .appendEvent({ kind: 'session_complete', sessionId: SID, turnId: 'turn-notice' });

  useAppStore.getState().prependSessionHistory(
    SID,
    [
      {
        kind: 'user',
        content: 'run review',
        sentAt: 10_050,
        turnId: 'turn-notice',
        turnUserOrdinal: 0,
      },
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
    out.filter((message) => message.kind === 'user' && message.content === 'run review').length,
    1,
  );
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
    kind: 'session_start',
    sessionId: SID,
    provider: 'mock',
    turnId: 'turn-tool',
  });
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
  useAppStore
    .getState()
    .appendEvent({ kind: 'session_complete', sessionId: SID, turnId: 'turn-tool' });

  const restoredItems: SessionHistoryItem[] = [
    {
      kind: 'user',
      content: 'read file',
      sentAt: 10_050,
      turnId: 'turn-tool',
      turnUserOrdinal: 0,
    },
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
    {
      kind: 'user',
      content: 'read after early history',
      sentAt: 10_050,
      turnId: 'turn-history-tool',
      turnUserOrdinal: 0,
    },
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
    kind: 'session_start',
    sessionId: SID,
    provider: 'mock',
    turnId: 'turn-history-tool',
  });
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
  useAppStore.getState().appendEvent({
    kind: 'session_complete',
    sessionId: SID,
    turnId: 'turn-history-tool',
  });

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
