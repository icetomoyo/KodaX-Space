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
import type { SessionEvent, SessionHistoryItem } from '@kodax-space/space-ipc-schema';

const SID = 'hist-test';
const FALLBACK_SENT_AT = 1700000000000;

function testSegmentEnd(events: readonly SessionEvent[], cursor: number): number {
  for (let index = cursor; index < events.length; index++) {
    const event = events[index]!;
    if (
      index > cursor &&
      (event.kind === 'mid_turn_user_prompt' || event.kind === 'queued_user_prompt_started')
    ) {
      return index;
    }
    if (event.kind === 'session_complete' || event.kind === 'session_error') {
      let end = index + 1;
      while (
        end < events.length &&
        (events[end]!.kind === 'session_complete' || events[end]!.kind === 'session_error')
      ) {
        end++;
      }
      return end;
    }
  }
  return events.length;
}

function assertClosedTranscriptStructure(sessionId: string): void {
  const state = useAppStore.getState();
  const events = state.eventsBySession[sessionId] ?? [];
  const owners = (state.userMessagesBySession[sessionId] ?? []).filter(
    (message) => message.historyNoAssistantSegment !== true,
  );
  const segments: SessionEvent[][] = [];
  for (let cursor = 0; cursor < events.length; ) {
    const end = testSegmentEnd(events, cursor);
    assert.ok(end > cursor, 'every event segment must advance the cursor');
    segments.push(events.slice(cursor, end));
    cursor = end;
  }
  for (const segment of segments) {
    const boundaryIndexes = segment.flatMap((event, index) =>
      event.kind === 'mid_turn_user_prompt' || event.kind === 'queued_user_prompt_started'
        ? [index]
        : [],
    );
    assert.ok(boundaryIndexes.length <= 1, 'an owned segment has at most one prompt boundary');
    if (boundaryIndexes.length === 1) {
      assert.equal(
        boundaryIndexes[0],
        0,
        'a prompt boundary must be the first event in its segment',
      );
    }
  }
  assert.equal(
    segments.length,
    owners.length,
    'a closed transcript must have exactly one event segment per effective owner',
  );
}

beforeEach(() => {
  useAppStore.getState().resetSessionMessages(SID);
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

test('expanding a paged history window preserves a folded live turn exactly once', () => {
  const store = useAppStore.getState();
  store.appendUserMessage(SID, 'newest query', 20_000);
  store.appendEvent({
    kind: 'session_start',
    sessionId: SID,
    provider: 'mock',
    turnId: 'turn-newest',
  });
  store.appendEvent({
    kind: 'text_delta',
    sessionId: SID,
    text: 'newest answer complete',
    sentAt: 20_100,
  });
  store.appendEvent({
    kind: 'session_complete',
    sessionId: SID,
    turnId: 'turn-newest',
  });

  const newestWindow: SessionHistoryItem[] = [
    { kind: 'history_truncation', scope: 'history', omittedItems: 2 },
    {
      kind: 'user',
      content: 'newest query',
      sentAt: 20_000,
      turnId: 'turn-newest',
      turnUserOrdinal: 0,
    },
    { kind: 'assistant', text: 'newest answer', sentAt: 20_100 },
  ];
  store.prependSessionHistory(SID, newestWindow, FALLBACK_SENT_AT, {
    replaceLoadedWindow: true,
  });
  store.prependSessionHistory(
    SID,
    [
      {
        kind: 'user',
        content: 'older query',
        sentAt: 10_000,
        turnId: 'turn-older',
        turnUserOrdinal: 0,
      },
      { kind: 'assistant', text: 'older answer', sentAt: 10_100 },
      newestWindow[1]!,
      { kind: 'assistant', text: 'newest answer complete', sentAt: 20_100 },
    ],
    FALLBACK_SENT_AT,
    { replaceLoadedWindow: true },
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
    [
      'user:older query',
      'assistant:older answer',
      'user:newest query',
      'assistant:newest answer complete',
    ],
  );
});

test('expanded history pages replace the prior truncation row and keep exact mutation boundaries', () => {
  useAppStore.getState().prependSessionHistory(
    SID,
    [
      { kind: 'history_truncation', scope: 'history', omittedItems: 2 },
      {
        kind: 'user',
        content: 'newer query',
        entryId: 'u2',
        canonicalIndex: 2,
        historyTurnIndex: 0,
        historyBoundary: { boundaryId: 'a2', sourceRevision: 'source-1' },
      },
      { kind: 'assistant', text: 'newer answer', entryId: 'a2', canonicalIndex: 3 },
    ],
    FALLBACK_SENT_AT,
    { replaceLoadedWindow: true },
  );
  const newestIdBeforeExpansion = useAppStore
    .getState()
    .userMessagesBySession[SID]?.find((message) => message.content === 'newer query')?.id;
  useAppStore.getState().prependSessionHistory(
    SID,
    [
      {
        kind: 'user',
        content: 'older query',
        entryId: 'u1',
        canonicalIndex: 0,
        historyTurnIndex: 0,
        historyBoundary: { boundaryId: 'a1', sourceRevision: 'source-1' },
      },
      { kind: 'assistant', text: 'older answer', entryId: 'a1', canonicalIndex: 1 },
      {
        kind: 'user',
        content: 'newer query',
        entryId: 'u2',
        canonicalIndex: 2,
        historyTurnIndex: 1,
        historyBoundary: { boundaryId: 'a2', sourceRevision: 'source-1' },
      },
      { kind: 'assistant', text: 'newer answer', entryId: 'a2', canonicalIndex: 3 },
    ],
    FALLBACK_SENT_AT,
    { replaceLoadedWindow: true },
  );

  const state = useAppStore.getState();
  const visibleUsers = (state.userMessagesBySession[SID] ?? []).filter(
    (message) => !message.hiddenHistoryAnchor && !message.hiddenProjectionDuplicate,
  );
  assert.deepEqual(
    visibleUsers.map((message) => message.content),
    ['older query', 'newer query'],
  );
  assert.deepEqual(visibleUsers[1]?.historyBoundary, {
    boundaryId: 'a2',
    sourceRevision: 'source-1',
  });
  assert.equal(visibleUsers[1]?.id, newestIdBeforeExpansion);
  assert.equal(
    (state.eventsBySession[SID] ?? []).filter((event) => event.kind === 'history_truncation')
      .length,
    0,
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
    turnUserOrdinal: 0,
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
  assert.equal(
    (state.eventsBySession[SID] ?? []).filter(
      (event) => event.kind === 'queued_user_prompt_started',
    ).length,
    1,
    'terminal folding retains one effective delivery boundary',
  );
  assert.equal(
    state.eventsBySession[SID]?.[0]?.kind,
    'queued_user_prompt_started',
    'the retained delivery marker remains the first event in its owned segment',
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
    turnUserOrdinal: 1,
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

test('strong folding preserves consecutive empty interrupt turns before the first answer', () => {
  const store = useAppStore.getState();
  useAppStore.setState({ queuedUserMessagesBySession: {} });

  store.appendUserMessage(SID, 'empty query 1', 10_000);
  store.appendEvent({
    kind: 'session_start',
    sessionId: SID,
    provider: 'mock',
    turnId: 'turn-empty-prefix',
  });
  store.appendEvent({
    kind: 'mid_turn_user_prompt',
    sessionId: SID,
    queueId: 'interrupt-empty-2',
    content: 'empty query 2',
    turnId: 'turn-empty-prefix',
    turnUserOrdinal: 1,
  });
  store.appendEvent({
    kind: 'mid_turn_user_prompt',
    sessionId: SID,
    queueId: 'interrupt-answer-3',
    content: 'answered query 3',
    turnId: 'turn-empty-prefix',
    turnUserOrdinal: 2,
  });
  store.appendEvent({
    kind: 'text_delta',
    sessionId: SID,
    text: 'only answer 3',
    sentAt: 10_300,
  });
  store.appendEvent({
    kind: 'session_complete',
    sessionId: SID,
    turnId: 'turn-empty-prefix',
  });

  store.prependSessionHistory(
    SID,
    [
      {
        kind: 'user',
        content: 'empty query 1',
        sentAt: 10_000,
        turnId: 'turn-empty-prefix',
        turnUserOrdinal: 0,
      },
      {
        kind: 'user',
        content: 'empty query 2',
        sentAt: 10_100,
        turnId: 'turn-empty-prefix',
        turnUserOrdinal: 1,
      },
      {
        kind: 'user',
        content: 'answered query 3',
        sentAt: 10_200,
        turnId: 'turn-empty-prefix',
        turnUserOrdinal: 2,
      },
      { kind: 'assistant', text: 'only answer 3', sentAt: 10_300 },
    ],
    FALLBACK_SENT_AT,
  );

  const state = useAppStore.getState();
  const out = composeMessages({
    events: state.eventsBySession[SID] ?? [],
    userMessages: state.userMessagesBySession[SID] ?? [],
    queuedUserMessages: state.queuedUserMessagesBySession[SID] ?? [],
  });
  assert.deepEqual(
    out.flatMap((message) => {
      if (message.kind === 'user') return [`user:${message.content}`];
      if (message.kind === 'assistant_text') return [`assistant:${message.text}`];
      return [];
    }),
    [
      'user:empty query 1',
      'user:empty query 2',
      'user:answered query 3',
      'assistant:only answer 3',
    ],
  );
  assert.deepEqual(
    (state.userMessagesBySession[SID] ?? []).map((message) => message.content),
    ['empty query 1', 'empty query 2', 'answered query 3'],
    'all three live duplicates fold without moving the third answer into an empty turn',
  );

  store.appendUserMessage(SID, 'next query 4', 20_000);
  store.appendEvent({
    kind: 'session_start',
    sessionId: SID,
    provider: 'mock',
    turnId: 'turn-after-empty-prefix',
  });
  store.appendEvent({
    kind: 'text_delta',
    sessionId: SID,
    text: 'next answer 4',
    sentAt: 20_100,
  });
  store.appendEvent({
    kind: 'session_complete',
    sessionId: SID,
    turnId: 'turn-after-empty-prefix',
  });
  const afterNextSend = useAppStore.getState();
  assert.deepEqual(
    composeMessages({
      events: afterNextSend.eventsBySession[SID] ?? [],
      userMessages: afterNextSend.userMessagesBySession[SID] ?? [],
    }).flatMap((message) => {
      if (message.kind === 'user') return [`user:${message.content}`];
      if (message.kind === 'assistant_text') return [`assistant:${message.text}`];
      return [];
    }),
    [
      'user:empty query 1',
      'user:empty query 2',
      'user:answered query 3',
      'assistant:only answer 3',
      'user:next query 4',
      'assistant:next answer 4',
    ],
    'a later completed send must not reveal a latent owner shift after empty-turn folding',
  );
  assertClosedTranscriptStructure(SID);
});

test('queued-after-turn folding preserves an empty canonical owner and the next completed send', () => {
  const store = useAppStore.getState();
  useAppStore.setState({ queuedUserMessagesBySession: {} });

  store.appendUserMessage(SID, 'queued empty query', 10_000);
  store.appendEvent({
    kind: 'session_start',
    sessionId: SID,
    provider: 'mock',
    turnId: 'turn-queued-empty',
  });
  store.appendEvent({
    kind: 'queued_user_prompt_started',
    sessionId: SID,
    queueId: 'after-empty',
    queueMode: 'after-turn',
    content: 'queued answered query',
    turnId: 'turn-queued-empty',
  });
  store.appendEvent({
    kind: 'text_delta',
    sessionId: SID,
    text: 'queued answer',
    sentAt: 10_200,
  });
  store.appendEvent({
    kind: 'session_complete',
    sessionId: SID,
    turnId: 'turn-queued-empty',
  });

  store.prependSessionHistory(
    SID,
    [
      {
        kind: 'user',
        content: 'queued empty query',
        sentAt: 10_000,
        turnId: 'turn-queued-empty',
        turnUserOrdinal: 0,
      },
      {
        kind: 'user',
        content: 'queued answered query',
        sentAt: 10_100,
        turnId: 'turn-queued-empty',
        turnUserOrdinal: 1,
      },
      { kind: 'assistant', text: 'queued answer', sentAt: 10_200 },
    ],
    FALLBACK_SENT_AT,
  );

  store.appendUserMessage(SID, 'queued next query', 20_000);
  store.appendEvent({
    kind: 'session_start',
    sessionId: SID,
    provider: 'mock',
    turnId: 'turn-queued-next',
  });
  store.appendEvent({
    kind: 'text_delta',
    sessionId: SID,
    text: 'queued next answer',
    sentAt: 20_100,
  });
  store.appendEvent({
    kind: 'session_complete',
    sessionId: SID,
    turnId: 'turn-queued-next',
  });

  const state = useAppStore.getState();
  const visible = composeMessages({
    events: state.eventsBySession[SID] ?? [],
    userMessages: state.userMessagesBySession[SID] ?? [],
  }).flatMap((message) => {
    if (message.kind === 'user') return [`user:${message.content}`];
    if (message.kind === 'assistant_text') return [`assistant:${message.text}`];
    return [];
  });
  assert.deepEqual(visible, [
    'user:queued empty query',
    'user:queued answered query',
    'assistant:queued answer',
    'user:queued next query',
    'assistant:queued next answer',
  ]);
  assert.equal(
    (state.eventsBySession[SID] ?? []).filter(
      (event) => event.kind === 'queued_user_prompt_started' && event.queueId === 'after-empty',
    ).length,
    1,
  );
  assert.equal(
    (state.userMessagesBySession[SID] ?? []).some(
      (message) => message.hiddenProjectionDuplicate === true,
    ),
    false,
  );
  assertClosedTranscriptStructure(SID);
});

test('a legal same-text interrupt in one Runtime turn receives a fresh ordinal after folding', () => {
  const store = useAppStore.getState();
  useAppStore.setState({ queuedUserMessagesBySession: {} });

  store.appendUserMessage(SID, 'repeat prompt', 10_000);
  store.appendEvent({
    kind: 'session_start',
    sessionId: SID,
    provider: 'mock',
    turnId: 'turn-same-text',
  });
  store.appendEvent({
    kind: 'text_delta',
    sessionId: SID,
    text: 'answer one',
    sentAt: 10_100,
  });
  store.prependSessionHistory(
    SID,
    [
      {
        kind: 'user',
        content: 'repeat prompt',
        sentAt: 10_000,
        turnId: 'turn-same-text',
        turnUserOrdinal: 0,
      },
      { kind: 'assistant', text: 'answer one', sentAt: 10_100 },
    ],
    FALLBACK_SENT_AT,
  );

  store.appendEvent({
    kind: 'mid_turn_user_prompt',
    sessionId: SID,
    queueId: 'different-second',
    content: 'different prompt',
    turnId: 'turn-same-text',
    turnUserOrdinal: 1,
  });
  store.appendEvent({
    kind: 'text_delta',
    sessionId: SID,
    text: 'answer two',
    sentAt: 10_200,
  });
  store.appendEvent({
    kind: 'mid_turn_user_prompt',
    sessionId: SID,
    queueId: 'repeat-third',
    content: 'repeat prompt',
    turnId: 'turn-same-text',
    turnUserOrdinal: 2,
  });
  store.appendEvent({
    kind: 'text_delta',
    sessionId: SID,
    text: 'answer three',
    sentAt: 10_300,
  });
  store.appendEvent({
    kind: 'session_complete',
    sessionId: SID,
    turnId: 'turn-same-text',
  });

  const state = useAppStore.getState();
  assert.deepEqual(
    (state.userMessagesBySession[SID] ?? []).map((message) => [
      message.content,
      message.turnUserOrdinal,
    ]),
    [
      ['repeat prompt', 0],
      ['different prompt', 1],
      ['repeat prompt', 2],
    ],
    'a folded ordinal remains observed and cannot be reused by equal text later in the turn',
  );
  assert.deepEqual(
    composeMessages({
      events: state.eventsBySession[SID] ?? [],
      userMessages: state.userMessagesBySession[SID] ?? [],
    }).flatMap((message) => {
      if (message.kind === 'user') return [`user:${message.content}`];
      if (message.kind === 'assistant_text') return [`assistant:${message.text}`];
      return [];
    }),
    [
      'user:repeat prompt',
      'assistant:answer one',
      'user:different prompt',
      'assistant:answer two',
      'user:repeat prompt',
      'assistant:answer three',
    ],
  );
  assertClosedTranscriptStructure(SID);
});

test('an ambiguous same-text delivery after history fails open with a fresh ordinal', () => {
  const store = useAppStore.getState();
  useAppStore.setState({ queuedUserMessagesBySession: {} });
  store.prependSessionHistory(
    SID,
    [
      {
        kind: 'user',
        content: 'same text',
        sentAt: 10_000,
        turnId: 'turn-ambiguous',
        turnUserOrdinal: 0,
      },
      { kind: 'assistant', text: 'old answer', sentAt: 10_100 },
    ],
    FALLBACK_SENT_AT,
  );
  store.appendEvent({
    kind: 'session_start',
    sessionId: SID,
    provider: 'mock',
    turnId: 'turn-ambiguous',
  });
  const queuedLocalId = store.appendQueuedUserMessage(SID, {
    content: 'same text',
    matchContent: 'same text',
    queueMode: 'interrupt',
    sentAt: 20_000,
  });
  assert.ok(queuedLocalId);
  store.markQueuedUserMessageAccepted(SID, queuedLocalId, 'unproven-new-delivery', 'interrupt');
  store.appendEvent({
    kind: 'mid_turn_user_prompt',
    sessionId: SID,
    queueId: 'unproven-new-delivery',
    content: 'same text',
    turnId: 'turn-ambiguous',
  });
  store.appendEvent({
    kind: 'text_delta',
    sessionId: SID,
    text: 'new answer',
    sentAt: 20_100,
  });
  store.appendEvent({
    kind: 'session_complete',
    sessionId: SID,
    turnId: 'turn-ambiguous',
  });

  const state = useAppStore.getState();
  assert.deepEqual(
    (state.userMessagesBySession[SID] ?? [])
      .filter((message) => message.hiddenHistoryAnchor !== true)
      .map((message) => message.turnUserOrdinal),
    [0, 1],
    'queue/alignment evidence cannot authorize text-only reuse of restored identity',
  );
  assert.deepEqual(
    composeMessages({
      events: state.eventsBySession[SID] ?? [],
      userMessages: state.userMessagesBySession[SID] ?? [],
    }).flatMap((message) => {
      if (message.kind === 'user') return [`user:${message.content}`];
      if (message.kind === 'assistant_text') return [`assistant:${message.text}`];
      return [];
    }),
    ['user:same text', 'assistant:old answer', 'user:same text', 'assistant:new answer'],
  );
  assertClosedTranscriptStructure(SID);
});

test('strong folding preserves a consecutive multi-terminal error sequence', () => {
  const store = useAppStore.getState();
  store.appendUserMessage(SID, 'terminal compatibility', 10_000);
  store.appendEvent({
    kind: 'session_start',
    sessionId: SID,
    provider: 'mock',
    turnId: 'turn-multi-terminal',
  });
  store.appendEvent({
    kind: 'text_delta',
    sessionId: SID,
    text: 'partial answer',
    sentAt: 10_100,
  });
  store.appendEvent({
    kind: 'session_error',
    sessionId: SID,
    turnId: 'turn-multi-terminal',
    error: 'raw 500',
  });
  store.appendEvent({
    kind: 'session_complete',
    sessionId: SID,
    turnId: 'turn-multi-terminal',
  });
  store.appendEvent({
    kind: 'session_error',
    sessionId: SID,
    turnId: 'turn-multi-terminal',
    error: 'Server error (500). Retrying may help.',
  });
  store.prependSessionHistory(
    SID,
    [
      {
        kind: 'user',
        content: 'terminal compatibility',
        sentAt: 10_000,
        turnId: 'turn-multi-terminal',
        turnUserOrdinal: 0,
      },
      { kind: 'assistant', text: 'partial answer', sentAt: 10_100 },
    ],
    FALLBACK_SENT_AT,
  );

  const state = useAppStore.getState();
  assert.deepEqual(
    (state.eventsBySession[SID] ?? []).flatMap((event) => {
      if (event.kind === 'session_error') return [`error:${event.error}`];
      if (event.kind === 'session_complete') return ['complete'];
      return [];
    }),
    ['error:raw 500', 'complete', 'error:Server error (500). Retrying may help.'],
    'folding must preserve every consecutive terminal from the authoritative live projection',
  );
  const output = composeMessages({
    events: state.eventsBySession[SID] ?? [],
    userMessages: state.userMessagesBySession[SID] ?? [],
  });
  assert.deepEqual(
    output.flatMap((message) =>
      message.kind === 'system_notice' && message.variant === 'error' ? [message.text] : [],
    ),
    ['raw 500', 'Server error (500). Retrying may help.'],
  );
  assertClosedTranscriptStructure(SID);
});

test('completed interrupt run plus later runs stays paired after full history restore and next send', () => {
  const store = useAppStore.getState();
  useAppStore.setState({ queuedUserMessagesBySession: {} });

  // Factual shape from s_ca10d118-fb1c-495c-b00b-5d26d3ac80e5: run.started has no
  // identity, then an interrupt starts a second canonical turn inside the same Runtime run.
  // Only that second turn owns run.completed.
  store.appendUserMessage(SID, 'query 1', 10_000);
  store.appendEvent({ kind: 'session_start', sessionId: SID, provider: 'mock' });
  store.appendEvent({
    kind: 'session_start',
    sessionId: SID,
    provider: 'mock',
    turnId: 'turn-1',
  });
  store.appendEvent({
    kind: 'text_delta',
    sessionId: SID,
    text: 'answer 1',
    sentAt: 10_100,
  });
  store.appendEvent({
    kind: 'session_start',
    sessionId: SID,
    provider: 'mock',
    turnId: 'turn-2',
  });
  store.appendEvent({
    kind: 'mid_turn_user_prompt',
    sessionId: SID,
    queueId: 'interrupt-2',
    content: 'query 2',
    turnId: 'turn-2',
    turnUserOrdinal: 0,
  });
  store.appendEvent({
    kind: 'text_delta',
    sessionId: SID,
    text: 'answer 2',
    sentAt: 10_200,
  });
  store.appendEvent({
    kind: 'session_complete',
    sessionId: SID,
    turnId: 'turn-2',
  });

  for (const turn of [
    { ordinal: 3, query: 'query 3', answer: 'answer 3', turnId: 'turn-3' },
    { ordinal: 4, query: 'query 4', answer: 'answer 4', turnId: 'turn-4' },
    { ordinal: 5, query: 'query 5', answer: 'answer 5', turnId: 'turn-5' },
  ] as const) {
    const sentAt = turn.ordinal * 10_000;
    store.appendUserMessage(SID, turn.query, sentAt);
    store.appendEvent({ kind: 'session_start', sessionId: SID, provider: 'mock' });
    store.appendEvent({
      kind: 'session_start',
      sessionId: SID,
      provider: 'mock',
      turnId: turn.turnId,
    });
    store.appendEvent({
      kind: 'text_delta',
      sessionId: SID,
      text: turn.answer,
      sentAt: sentAt + 100,
    });
    store.appendEvent({
      kind: 'session_complete',
      sessionId: SID,
      turnId: turn.turnId,
    });
  }

  store.prependSessionHistory(
    SID,
    [
      {
        kind: 'user',
        content: 'query 1',
        sentAt: 10_000,
        turnId: 'turn-1',
        turnUserOrdinal: 0,
      },
      { kind: 'assistant', text: 'answer 1', sentAt: 10_100 },
      {
        kind: 'user',
        content: 'query 2',
        sentAt: 10_150,
        turnId: 'turn-2',
        turnUserOrdinal: 0,
      },
      { kind: 'assistant', text: 'answer 2', sentAt: 10_200 },
      {
        kind: 'user',
        content: 'query 3',
        sentAt: 30_000,
        turnId: 'turn-3',
        turnUserOrdinal: 0,
      },
      { kind: 'assistant', text: 'answer 3', sentAt: 30_100 },
      {
        kind: 'user',
        content: 'query 4',
        sentAt: 40_000,
        turnId: 'turn-4',
        turnUserOrdinal: 0,
      },
      { kind: 'assistant', text: 'answer 4', sentAt: 40_100 },
      {
        kind: 'user',
        content: 'query 5',
        sentAt: 50_000,
        turnId: 'turn-5',
        turnUserOrdinal: 0,
      },
      { kind: 'assistant', text: 'answer 5', sentAt: 50_100 },
    ],
    FALLBACK_SENT_AT,
  );

  const visibleTranscript = (): string[] => {
    const state = useAppStore.getState();
    return composeMessages({
      events: state.eventsBySession[SID] ?? [],
      userMessages: state.userMessagesBySession[SID] ?? [],
      queuedUserMessages: state.queuedUserMessagesBySession[SID] ?? [],
    }).flatMap((message) => {
      if (message.kind === 'user') return [`user:${message.content}`];
      if (message.kind === 'assistant_text') return [`assistant:${message.text}`];
      return [];
    });
  };
  const restoredTranscript = [
    'user:query 1',
    'assistant:answer 1',
    'user:query 2',
    'assistant:answer 2',
    'user:query 3',
    'assistant:answer 3',
    'user:query 4',
    'assistant:answer 4',
    'user:query 5',
    'assistant:answer 5',
  ];

  assert.deepEqual(
    visibleTranscript(),
    restoredTranscript,
    'full history reconciliation must preserve every canonical prompt/response pair exactly once',
  );
  assert.deepEqual(
    (useAppStore.getState().userMessagesBySession[SID] ?? []).map((message) => message.content),
    ['query 1', 'query 2', 'query 3', 'query 4', 'query 5'],
    'all five completed live duplicates must fold into their durable users',
  );
  const reconciledEvents = useAppStore.getState().eventsBySession[SID] ?? [];
  const interruptBoundaryIndexes = reconciledEvents.flatMap((event, index) =>
    event.kind === 'mid_turn_user_prompt' ? [index] : [],
  );
  const secondAnswerIndex = reconciledEvents.findIndex(
    (event) => event.kind === 'text_delta' && event.text === 'answer 2',
  );
  assert.equal(interruptBoundaryIndexes.length, 1);
  assert.ok(
    interruptBoundaryIndexes[0]! < secondAnswerIndex,
    'the retained interrupt marker must remain at the start of query 2, before its answer',
  );

  store.appendUserMessage(SID, 'query 6', 60_000);
  assert.deepEqual(
    visibleTranscript(),
    [...restoredTranscript, 'user:query 6'],
    'a new send must never consume the previous restored assistant segment',
  );

  store.appendEvent({ kind: 'session_start', sessionId: SID, provider: 'mock' });
  store.appendEvent({
    kind: 'session_start',
    sessionId: SID,
    provider: 'mock',
    turnId: 'turn-6',
  });
  store.appendEvent({
    kind: 'text_delta',
    sessionId: SID,
    text: 'answer 6',
    sentAt: 60_100,
  });
  store.appendEvent({
    kind: 'session_complete',
    sessionId: SID,
    turnId: 'turn-6',
  });
  assert.deepEqual(
    visibleTranscript(),
    [...restoredTranscript, 'user:query 6', 'assistant:answer 6'],
    'the next Runtime lifecycle must bind its answer to the newly sent query',
  );
  assertClosedTranscriptStructure(SID);
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

test('history replay preserves canonical transcript provenance through user and event projections', () => {
  const items: SessionHistoryItem[] = [
    {
      kind: 'user',
      content: 'query',
      entryId: 'entry_user',
      parentId: 'entry_parent',
      logicalId: 'logical_user',
      sourceEntryId: 'entry_source',
      authoritativeEntryId: 'entry_active_clone',
      canonicalIndex: 34,
      turnId: 'turn_1',
      turnUserOrdinal: 0,
    },
    {
      kind: 'assistant',
      text: 'answer',
      entryId: 'entry_assistant',
      parentId: 'entry_user',
      logicalId: 'logical_assistant',
      canonicalIndex: 35,
      turnId: 'turn_1',
    },
    {
      kind: 'tool_call',
      toolId: 'tool_1',
      toolName: 'read',
      result: 'ok',
      entryId: 'entry_assistant',
      parentId: 'entry_user',
      logicalId: 'logical_assistant',
      canonicalIndex: 35,
      turnId: 'turn_1',
    },
  ];

  useAppStore.getState().prependSessionHistory(SID, items, FALLBACK_SENT_AT);
  const state = useAppStore.getState();
  const user = state.userMessagesBySession[SID]?.[0];
  assert.equal(user?.entryId, 'entry_user');
  assert.equal(user?.parentId, 'entry_parent');
  assert.equal(user?.logicalId, 'logical_user');
  assert.equal(user?.sourceEntryId, 'entry_source');
  assert.equal(user?.authoritativeEntryId, 'entry_active_clone');
  assert.equal(user?.canonicalIndex, 34);
  const events = state.eventsBySession[SID] ?? [];
  const text = events.find((event) => event.kind === 'text_delta');
  const tool = events.find((event) => event.kind === 'tool_start');
  assert.equal(text?.entryId, 'entry_assistant');
  assert.equal(text?.canonicalIndex, 35);
  assert.equal(text?.turnId, 'turn_1');
  assert.equal(tool?.entryId, 'entry_assistant');
  assert.equal(tool?.parentId, 'entry_user');
});

test('persisted compaction entry identity reconciles live-first and history-first delivery exactly once', () => {
  const liveBoundary: SessionEvent = {
    kind: 'lineage_notice',
    sessionId: SID,
    noticeKind: 'compaction',
    text: 'internal summary',
    entryId: 'entry_compaction',
    parentId: null,
    logicalId: 'entry_compaction',
    canonicalIndex: 2,
    sentAt: FALLBACK_SENT_AT + 2,
  };
  useAppStore.setState({
    eventsBySession: { [SID]: [liveBoundary] },
    userMessagesBySession: {},
  });
  useAppStore.getState().prependSessionHistory(
    SID,
    [
      {
        kind: 'user',
        content: 'query',
        entryId: 'entry_user',
        logicalId: 'entry_user',
        canonicalIndex: 0,
      },
      {
        kind: 'assistant',
        text: 'answer',
        entryId: 'entry_answer',
        logicalId: 'entry_answer',
        canonicalIndex: 1,
      },
      {
        kind: 'lineage_notice',
        noticeKind: 'compaction',
        text: 'internal summary',
        entryId: 'entry_compaction',
        parentId: null,
        logicalId: 'entry_compaction',
        canonicalIndex: 2,
        sentAt: FALLBACK_SENT_AT + 2,
      },
    ],
    FALLBACK_SENT_AT,
  );
  let boundaries = (useAppStore.getState().eventsBySession[SID] ?? []).filter(
    (event) =>
      event.kind === 'lineage_notice' &&
      event.noticeKind === 'compaction' &&
      event.entryId === 'entry_compaction',
  );
  assert.equal(boundaries.length, 1, 'live-first reconciliation keeps the history slot only once');

  useAppStore.getState().appendEvent(liveBoundary);
  boundaries = (useAppStore.getState().eventsBySession[SID] ?? []).filter(
    (event) =>
      event.kind === 'lineage_notice' &&
      event.noticeKind === 'compaction' &&
      event.entryId === 'entry_compaction',
  );
  assert.equal(boundaries.length, 1, 'history-first replay drops the duplicate live boundary');

  const composed = composeMessages({
    events: useAppStore.getState().eventsBySession[SID] ?? [],
    userMessages: useAppStore.getState().userMessagesBySession[SID] ?? [],
  });
  assert.equal(
    composed.filter(
      (message) =>
        message.kind === 'system_notice' &&
        message.variant === 'lineage' &&
        message.lineageKind === 'compaction',
    ).length,
    1,
  );
});

test('live compaction placeholder upgrades in place without overtaking later output', () => {
  const provisional: SessionEvent = {
    kind: 'lineage_notice',
    sessionId: SID,
    noticeKind: 'compaction',
    text: 'Compaction',
    provisionalId: 'runtime-compaction:evt_1',
    displayId: 'runtime-compaction:evt_1',
    contextId: SID,
    afterRevision: 8,
    tokensBefore: 120_000,
    tokensAfter: 40_000,
    sentAt: FALLBACK_SENT_AT + 1,
  };
  const exact: SessionEvent = {
    ...provisional,
    text: 'durable summary',
    entryId: 'entry_compaction',
    logicalId: 'entry_compaction',
    canonicalIndex: 42,
    sentAt: FALLBACK_SENT_AT,
  };
  useAppStore.setState({ eventsBySession: { [SID]: [] }, userMessagesBySession: {} });

  useAppStore.getState().appendEvent(provisional);
  const provisionalMessageId = composeMessages({
    events: useAppStore.getState().eventsBySession[SID] ?? [],
    userMessages: [],
  }).find(
    (message) =>
      message.kind === 'system_notice' &&
      message.variant === 'lineage' &&
      message.lineageKind === 'compaction',
  )?.id;
  useAppStore.getState().appendEvent({
    kind: 'text_delta',
    sessionId: SID,
    text: 'output after compaction',
  });
  useAppStore.getState().appendEvent(exact);
  useAppStore.getState().appendEvent(provisional);

  const events = useAppStore.getState().eventsBySession[SID] ?? [];
  assert.equal(events.length, 2);
  assert.equal(events[0]?.kind, 'lineage_notice');
  assert.equal(
    events[0]?.kind === 'lineage_notice' ? events[0].entryId : undefined,
    'entry_compaction',
  );
  assert.equal(events[1]?.kind, 'text_delta');
  const exactMessageId = composeMessages({ events, userMessages: [] }).find(
    (message) =>
      message.kind === 'system_notice' &&
      message.variant === 'lineage' &&
      message.lineageKind === 'compaction',
  )?.id;
  assert.equal(exactMessageId, provisionalMessageId);
});

test('history compaction keeps same-facts live boundaries until exact identity resolves', () => {
  useAppStore.getState().prependSessionHistory(
    SID,
    [
      {
        kind: 'lineage_notice',
        noticeKind: 'compaction',
        text: 'durable summary',
        entryId: 'entry_compaction',
        logicalId: 'entry_compaction',
        canonicalIndex: 42,
        tokensBefore: 120_000,
        tokensAfter: 40_000,
        sentAt: FALLBACK_SENT_AT,
      },
    ],
    FALLBACK_SENT_AT,
  );
  const historyMessageId = composeMessages({
    events: useAppStore.getState().eventsBySession[SID] ?? [],
    userMessages: [],
  }).find(
    (message) =>
      message.kind === 'system_notice' &&
      message.variant === 'lineage' &&
      message.lineageKind === 'compaction',
  )?.id;
  const matchingProvisional: SessionEvent = {
    kind: 'lineage_notice',
    sessionId: SID,
    noticeKind: 'compaction',
    text: 'Compaction',
    provisionalId: 'runtime-compaction:evt_matching',
    displayId: 'runtime-compaction:evt_matching',
    tokensBefore: 120_000,
    tokensAfter: 40_000,
    sentAt: FALLBACK_SENT_AT + 10,
  };
  useAppStore.getState().appendEvent(matchingProvisional);
  useAppStore.getState().appendEvent({
    kind: 'lineage_notice',
    sessionId: SID,
    noticeKind: 'compaction',
    text: 'Compaction',
    provisionalId: 'runtime-compaction:evt_distinct',
    displayId: 'runtime-compaction:evt_distinct',
    tokensBefore: 120_000,
    tokensAfter: 40_000,
    sentAt: FALLBACK_SENT_AT + 20,
  });

  let boundaries = (useAppStore.getState().eventsBySession[SID] ?? []).filter(
    (event): event is Extract<SessionEvent, { kind: 'lineage_notice' }> =>
      event.kind === 'lineage_notice' && event.noticeKind === 'compaction',
  );
  assert.deepEqual(
    boundaries.map((event) => event.entryId ?? event.provisionalId),
    ['entry_compaction', 'runtime-compaction:evt_matching', 'runtime-compaction:evt_distinct'],
    'tokens and nearby timestamps are facts, not identity; distinct boundaries fail open',
  );

  useAppStore.getState().appendEvent({
    ...matchingProvisional,
    text: 'durable summary',
    entryId: 'entry_compaction',
    logicalId: 'entry_compaction',
    canonicalIndex: 42,
    sentAt: FALLBACK_SENT_AT,
  });
  boundaries = (useAppStore.getState().eventsBySession[SID] ?? []).filter(
    (event): event is Extract<SessionEvent, { kind: 'lineage_notice' }> =>
      event.kind === 'lineage_notice' && event.noticeKind === 'compaction',
  );
  assert.deepEqual(
    boundaries.map((event) => event.entryId ?? event.provisionalId),
    ['entry_compaction', 'runtime-compaction:evt_distinct'],
    'entryId proof retires only its matching provisional and keeps the canonical history slot',
  );
  const reconciledMessageId = composeMessages({
    events: useAppStore.getState().eventsBySession[SID] ?? [],
    userMessages: [],
  }).find(
    (message) =>
      message.kind === 'system_notice' &&
      message.variant === 'lineage' &&
      message.lineageKind === 'compaction',
  )?.id;
  assert.equal(
    reconciledMessageId,
    historyMessageId,
    'history-first exact reconciliation preserves the already-rendered message identity',
  );
});

test('legacy history compaction never suppresses live boundaries by timestamp proximity', () => {
  useAppStore.getState().prependSessionHistory(
    SID,
    [
      {
        kind: 'lineage_notice',
        noticeKind: 'compaction',
        text: 'legacy summary',
        entryId: 'legacy_compaction',
        logicalId: 'legacy_compaction',
        canonicalIndex: 7,
        sentAt: FALLBACK_SENT_AT,
      },
    ],
    FALLBACK_SENT_AT,
  );
  const liveBase = {
    kind: 'lineage_notice',
    sessionId: SID,
    noticeKind: 'compaction',
    text: 'Compaction',
    tokensBefore: 120_000,
    tokensAfter: 40_000,
  } as const;
  useAppStore.getState().appendEvent({
    ...liveBase,
    provisionalId: 'runtime-compaction:legacy_matching',
    sentAt: FALLBACK_SENT_AT + 50,
  });
  useAppStore.getState().appendEvent({
    ...liveBase,
    provisionalId: 'runtime-compaction:legacy_distant',
    sentAt: FALLBACK_SENT_AT + 3_000,
  });

  const boundaries = (useAppStore.getState().eventsBySession[SID] ?? []).filter(
    (event): event is Extract<SessionEvent, { kind: 'lineage_notice' }> =>
      event.kind === 'lineage_notice' && event.noticeKind === 'compaction',
  );
  assert.deepEqual(
    boundaries.map((event) => event.entryId ?? event.provisionalId),
    [
      'legacy_compaction',
      'runtime-compaction:legacy_matching',
      'runtime-compaction:legacy_distant',
    ],
  );
});

test('history truncation markers preserve their explicit positions around the retained query', () => {
  useAppStore.getState().prependSessionHistory(
    SID,
    [
      { kind: 'history_truncation', scope: 'history', omittedItems: 101 },
      {
        kind: 'user',
        content: 'retained oversized query',
        sentAt: FALLBACK_SENT_AT,
        historyTurnIndex: 42,
      },
      { kind: 'history_truncation', scope: 'turn', omittedItems: 55 },
      { kind: 'assistant', text: 'newest retained answer', sentAt: FALLBACK_SENT_AT + 1 },
    ],
    FALLBACK_SENT_AT,
  );

  const state = useAppStore.getState();
  const composed = composeMessages({
    events: state.eventsBySession[SID] ?? [],
    userMessages: state.userMessagesBySession[SID] ?? [],
  });
  assert.deepEqual(
    composed.map((message) =>
      message.kind === 'system_notice'
        ? [message.kind, message.lineageKind, message.historyTruncationScope, message.omittedItems]
        : message.kind === 'user'
          ? [message.kind, message.content]
          : message.kind === 'assistant_text'
            ? [message.kind, message.text, message.turnIndex]
            : [message.kind],
    ),
    [
      ['system_notice', 'history_truncation', 'history', 101],
      ['user', 'retained oversized query'],
      ['system_notice', 'history_truncation', 'turn', 55],
      ['assistant_text', 'newest retained answer', 42],
    ],
  );
});

test('rewind uses absolute selector indexes while truncating the bounded renderer buffer', () => {
  useAppStore.getState().prependSessionHistory(
    SID,
    [
      { kind: 'history_truncation', scope: 'history', omittedItems: 200 },
      {
        kind: 'user',
        content: 'visible turn 42',
        sentAt: FALLBACK_SENT_AT,
        historyTurnIndex: 42,
      },
      { kind: 'assistant', text: 'answer 42' },
      {
        kind: 'user',
        content: 'visible turn 43',
        sentAt: FALLBACK_SENT_AT + 2,
        historyTurnIndex: 43,
      },
      { kind: 'assistant', text: 'answer 43' },
    ],
    FALLBACK_SENT_AT,
  );

  useAppStore.getState().rewindSessionBuffers(SID, 42);

  const state = useAppStore.getState();
  const visibleUsers = (state.userMessagesBySession[SID] ?? []).filter(
    (message) => message.hiddenHistoryAnchor !== true,
  );
  assert.deepEqual(
    visibleUsers.map((message) => [message.content, message.historyTurnIndex]),
    [['visible turn 42', 42]],
  );
  const composed = composeMessages({
    events: state.eventsBySession[SID] ?? [],
    userMessages: state.userMessagesBySession[SID] ?? [],
  });
  assert.equal(
    composed.some((message) => message.kind === 'user' && message.content === 'visible turn 43'),
    false,
  );
});

test('fork copies the bounded renderer buffer only through the selected absolute turn', () => {
  useAppStore.setState({
    userMessagesBySession: {
      [SID]: [
        {
          id: 'prefix-anchor',
          content: '',
          sentAt: FALLBACK_SENT_AT - 1,
          hiddenHistoryAnchor: true,
          historyNoAssistantSegment: true,
        },
        {
          id: 'visible-42',
          content: 'visible turn 42',
          sentAt: FALLBACK_SENT_AT,
          historyTurnIndex: 42,
        },
        {
          id: 'visible-43',
          content: 'visible turn 43',
          sentAt: FALLBACK_SENT_AT + 2,
          historyTurnIndex: 43,
        },
        {
          id: 'visible-44',
          content: 'visible turn 44',
          sentAt: FALLBACK_SENT_AT + 4,
          historyTurnIndex: 44,
        },
      ],
    },
    eventsBySession: {
      [SID]: [
        { kind: 'text_delta', sessionId: SID, text: 'answer 42' },
        { kind: 'session_complete', sessionId: SID },
        { kind: 'text_delta', sessionId: SID, text: 'answer 43' },
        { kind: 'session_complete', sessionId: SID },
        { kind: 'text_delta', sessionId: SID, text: 'answer 44' },
        { kind: 'session_complete', sessionId: SID },
      ],
    },
  });

  useAppStore.getState().forkSessionBuffers(SID, 'child-absolute-43', 43);

  const state = useAppStore.getState();
  assert.deepEqual(
    (state.userMessagesBySession['child-absolute-43'] ?? []).map((message) => message.content),
    ['', 'visible turn 42', 'visible turn 43'],
  );
  assert.deepEqual(
    (state.eventsBySession['child-absolute-43'] ?? []).map((event) => [
      event.kind,
      event.sessionId,
    ]),
    [
      ['text_delta', 'child-absolute-43'],
      ['session_complete', 'child-absolute-43'],
      ['text_delta', 'child-absolute-43'],
      ['session_complete', 'child-absolute-43'],
    ],
  );
});

test('rewind cuts events by real segment ownership when a visible turn has no assistant segment', () => {
  const messages = [
    {
      id: 'prefix-anchor',
      content: '',
      sentAt: FALLBACK_SENT_AT - 1,
      hiddenHistoryAnchor: true,
      historyNoAssistantSegment: true,
    },
    {
      id: 'visible-42',
      content: 'empty turn 42',
      sentAt: FALLBACK_SENT_AT,
      historyTurnIndex: 42,
      historyNoAssistantSegment: true,
    },
    {
      id: 'visible-43',
      content: 'visible turn 43',
      sentAt: FALLBACK_SENT_AT + 2,
      historyTurnIndex: 43,
    },
    {
      id: 'visible-44',
      content: 'visible turn 44',
      sentAt: FALLBACK_SENT_AT + 4,
      historyTurnIndex: 44,
    },
  ];
  const events = [
    { kind: 'text_delta' as const, sessionId: SID, text: 'answer 43' },
    { kind: 'session_complete' as const, sessionId: SID },
    { kind: 'text_delta' as const, sessionId: SID, text: 'answer 44' },
    { kind: 'session_complete' as const, sessionId: SID },
  ];
  useAppStore.setState({
    userMessagesBySession: { [SID]: messages },
    eventsBySession: { [SID]: events },
  });

  useAppStore.getState().rewindSessionBuffers(SID, 43);

  let state = useAppStore.getState();
  assert.deepEqual(
    (state.userMessagesBySession[SID] ?? []).map((message) => message.content),
    ['', 'empty turn 42', 'visible turn 43'],
  );
  assert.deepEqual(
    (state.eventsBySession[SID] ?? []).map((event) => event.kind),
    ['text_delta', 'session_complete'],
  );

  useAppStore.setState({
    userMessagesBySession: { [SID]: messages },
    eventsBySession: { [SID]: events },
  });
  useAppStore.getState().rewindSessionBuffers(SID, 42);
  state = useAppStore.getState();
  assert.deepEqual(state.eventsBySession[SID] ?? [], []);
});

test('repeating the same truncated history projection is idempotent and preserves ownership', () => {
  const items: SessionHistoryItem[] = [
    { kind: 'history_truncation', scope: 'history', omittedItems: 200 },
    {
      kind: 'user',
      content: 'visible query',
      sentAt: FALLBACK_SENT_AT,
      historyTurnIndex: 42,
      turnId: 'turn-visible-42',
      turnUserOrdinal: 0,
    },
    { kind: 'history_truncation', scope: 'turn', omittedItems: 55 },
    { kind: 'assistant', text: 'visible answer', sentAt: FALLBACK_SENT_AT + 1 },
  ];

  useAppStore.getState().prependSessionHistory(SID, items, FALLBACK_SENT_AT);
  useAppStore.getState().prependSessionHistory(SID, items, FALLBACK_SENT_AT);

  const state = useAppStore.getState();
  assert.equal(
    (state.userMessagesBySession[SID] ?? []).filter(
      (message) => message.hiddenHistoryAnchor === true,
    ).length,
    1,
  );
  const composed = composeMessages({
    events: state.eventsBySession[SID] ?? [],
    userMessages: state.userMessagesBySession[SID] ?? [],
  });
  assert.deepEqual(
    composed.map((message) => {
      if (message.kind === 'system_notice') {
        return [message.kind, message.historyTruncationScope, message.omittedItems];
      }
      if (message.kind === 'user') return [message.kind, message.content];
      if (message.kind === 'assistant_text') return [message.kind, message.text];
      return [message.kind];
    }),
    [
      ['system_notice', 'history', 200],
      ['user', 'visible query'],
      ['system_notice', 'turn', 55],
      ['assistant_text', 'visible answer'],
    ],
  );
});

test('repeating a truncated history whose final strong user has no response is idempotent', () => {
  const items: SessionHistoryItem[] = [
    { kind: 'history_truncation', scope: 'history', omittedItems: 200 },
    {
      kind: 'user',
      content: 'cancelled query without a response',
      sentAt: FALLBACK_SENT_AT,
      historyTurnIndex: 42,
      turnId: 'turn-empty-42',
      turnUserOrdinal: 0,
    },
  ];

  useAppStore.getState().prependSessionHistory(SID, items, FALLBACK_SENT_AT);
  useAppStore.getState().prependSessionHistory(SID, items, FALLBACK_SENT_AT);

  const state = useAppStore.getState();
  const composed = composeMessages({
    events: state.eventsBySession[SID] ?? [],
    userMessages: state.userMessagesBySession[SID] ?? [],
  });
  assert.equal(
    composed.filter(
      (message) =>
        message.kind === 'user' && message.content === 'cancelled query without a response',
    ).length,
    1,
  );
  assert.equal(
    composed.filter(
      (message) =>
        message.kind === 'system_notice' &&
        message.lineageKind === 'history_truncation' &&
        message.historyTruncationScope === 'history',
    ).length,
    1,
  );
});

test('s_607 projection keeps query, thinking, multi-tool receipts, workflow, and compaction in one order', () => {
  const items: SessionHistoryItem[] = [
    {
      kind: 'user',
      content: 'opening query',
      entryId: 'opening_query',
      logicalId: 'opening_query',
      canonicalIndex: 0,
      sentAt: FALLBACK_SENT_AT,
    },
    {
      kind: 'assistant',
      text: 'retained predecessor',
      entryId: 'retained_parent',
      parentId: 'opening_query',
      logicalId: 'retained_parent',
      canonicalIndex: 1,
      sentAt: FALLBACK_SENT_AT + 1,
    },
    {
      kind: 'user',
      content: 'P0 query',
      entryId: 'p0_query',
      parentId: 'retained_parent',
      logicalId: 'logical_p0',
      canonicalIndex: 2,
      turnId: 'turn_p0',
      turnUserOrdinal: 0,
      sentAt: FALLBACK_SENT_AT + 2,
    },
    {
      kind: 'assistant',
      text: 'I will verify both paths.',
      thinking: 'inspect all relevant code',
      entryId: 'p0_assistant',
      parentId: 'p0_query',
      logicalId: 'logical_assistant',
      authoritativeEntryId: 'p0_assistant_clone',
      canonicalIndex: 3,
      turnId: 'turn_p0',
      sentAt: FALLBACK_SENT_AT + 3,
    },
    {
      kind: 'tool_call',
      toolId: 'tool_read',
      toolName: 'read',
      input: { path: 'PRD.md' },
      result: 'prd',
      entryId: 'p0_assistant',
      parentId: 'p0_query',
      logicalId: 'logical_assistant',
      authoritativeEntryId: 'p0_assistant_clone',
      canonicalIndex: 3,
      turnId: 'turn_p0',
    },
    {
      kind: 'tool_call',
      toolId: 'tool_grep',
      toolName: 'grep',
      input: { pattern: 'OLAP' },
      result: 'matches',
      entryId: 'p0_assistant',
      parentId: 'p0_query',
      logicalId: 'logical_assistant',
      authoritativeEntryId: 'p0_assistant_clone',
      canonicalIndex: 3,
      turnId: 'turn_p0',
    },
    {
      kind: 'workflow_notice',
      text: '[workflow] completed · review',
      entryId: 'workflow_result',
      parentId: 'p0_results',
      logicalId: 'workflow_result',
      canonicalIndex: 5,
      turnId: 'turn_p0',
    },
    {
      kind: 'lineage_notice',
      noticeKind: 'compaction',
      text: 'internal summary',
      entryId: 'compaction',
      parentId: null,
      logicalId: 'compaction',
      canonicalIndex: 6,
      tokensBefore: 120_000,
      tokensAfter: 40_000,
      sentAt: FALLBACK_SENT_AT + 6,
    },
  ];
  useAppStore.getState().prependSessionHistory(SID, items, FALLBACK_SENT_AT);

  const state = useAppStore.getState();
  const composed = composeMessages({
    events: state.eventsBySession[SID] ?? [],
    userMessages: state.userMessagesBySession[SID] ?? [],
  });
  assert.deepEqual(
    composed.map((message) =>
      message.kind === 'system_notice' ? `${message.kind}:${message.variant}` : message.kind,
    ),
    [
      'user',
      'assistant_text',
      'user',
      'assistant_text',
      'tool_call',
      'tool_call',
      'system_notice:workflow',
      'system_notice:lineage',
    ],
  );
  const p0Assistant = composed.find(
    (message) => message.kind === 'assistant_text' && message.text === 'I will verify both paths.',
  );
  assert.equal(
    p0Assistant?.kind === 'assistant_text' ? p0Assistant.thinking : undefined,
    'inspect all relevant code',
  );
  assert.deepEqual(
    composed.flatMap((message) =>
      message.kind === 'tool_call' ? [[message.toolId, message.status, message.result]] : [],
    ),
    [
      ['tool_read', 'done', 'prd'],
      ['tool_grep', 'done', 'matches'],
    ],
  );
  assert.equal(new Set(composed.map((message) => message.id)).size, composed.length);
  assert.equal(state.userMessagesBySession[SID]?.[1]?.turnId, 'turn_p0');
});
