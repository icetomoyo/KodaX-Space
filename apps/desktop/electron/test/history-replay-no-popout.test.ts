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
        testTerminalBelongsToSameCompatibilitySegment(event, events[end]!)
      ) {
        end++;
      }
      return end;
    }
  }
  return events.length;
}

function testTerminalBelongsToSameCompatibilitySegment(
  first: SessionEvent,
  candidate: SessionEvent,
): boolean {
  if (
    (first.kind !== 'session_complete' && first.kind !== 'session_error') ||
    (candidate.kind !== 'session_complete' && candidate.kind !== 'session_error')
  ) {
    return false;
  }
  if (first.turnId !== undefined || candidate.turnId !== undefined) {
    return first.turnId !== undefined && first.turnId === candidate.turnId;
  }
  return first.kind === 'session_error';
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

test('a newest history page starting mid-turn stays ordered when the omitted query page expands', () => {
  const store = useAppStore.getState();
  store.appendUserMessage(SID, 'older query', 10_000);
  store.appendEvent({
    kind: 'session_start',
    sessionId: SID,
    provider: 'mock',
    turnId: 'turn-older',
  });
  store.appendEvent({
    kind: 'thinking_delta',
    sessionId: SID,
    text: 'older reasoning omitted by the bounded canonical tail',
    sentAt: 10_050,
  });
  store.appendEvent({
    kind: 'text_delta',
    sessionId: SID,
    text: 'older answer',
    sentAt: 10_100,
  });
  store.appendEvent({ kind: 'session_complete', sessionId: SID, turnId: 'turn-older' });
  store.appendUserMessage(SID, 'newer query', 20_000);
  store.appendEvent({
    kind: 'session_start',
    sessionId: SID,
    provider: 'mock',
    turnId: 'turn-newer',
  });
  store.appendEvent({
    kind: 'text_delta',
    sessionId: SID,
    text: 'newer answer',
    sentAt: 20_100,
  });
  store.appendEvent({ kind: 'session_complete', sessionId: SID, turnId: 'turn-newer' });

  // This is the real failure shape from 20260804_114722_2w61e690e24c48: the bounded newest
  // canonical page begins with the assistant tail of the older live turn, then contains the next
  // complete query/answer. The omitted older query must remain the unique live owner of that tail.
  store.prependSessionHistory(
    SID,
    [
      { kind: 'history_truncation', scope: 'history', omittedItems: 50 },
      {
        kind: 'assistant',
        text: 'older answer',
        sentAt: 10_100,
        canonicalIndex: 56,
        turnId: 'turn-older',
      },
      {
        kind: 'user',
        content: 'newer query',
        sentAt: 20_000,
        canonicalIndex: 57,
        turnId: 'turn-newer',
        turnUserOrdinal: 0,
      },
      {
        kind: 'assistant',
        text: 'newer answer',
        sentAt: 20_100,
        canonicalIndex: 58,
        turnId: 'turn-newer',
      },
    ],
    FALLBACK_SENT_AT,
    { replaceLoadedWindow: true },
  );

  const state = useAppStore.getState();
  const visible = composeMessages({
    events: state.eventsBySession[SID] ?? [],
    userMessages: state.userMessagesBySession[SID] ?? [],
  }).flatMap((message) => {
    if (message.kind === 'user') return [`user:${message.content}`];
    if (message.kind === 'assistant_text') return [`assistant:${message.text}`];
    if (message.kind === 'system_notice' && message.lineageKind === 'history_truncation') {
      return ['notice:history_truncation'];
    }
    return [];
  });
  assert.deepEqual(visible, [
    'notice:history_truncation',
    'user:older query',
    'assistant:older answer',
    'user:newer query',
    'assistant:newer answer',
  ]);
  assert.equal(visible.filter((item) => item === 'assistant:older answer').length, 1);
  assert.equal(visible.filter((item) => item === 'user:newer query').length, 1);
  assertClosedTranscriptStructure(SID);

  // A non-overlapping older SDK page can end exactly after the omitted user row. Runtime can prove
  // its turnId and canonical mutation boundary but intentionally omits turnUserOrdinal because an
  // even older part of the same turn may contain another real user prompt.
  store.prependSessionHistory(
    SID,
    [
      {
        kind: 'user',
        content: 'older query',
        sentAt: 10_000,
        canonicalIndex: 55,
        historyTurnIndex: 55,
        historyBoundary: { boundaryId: 'older-answer-boundary', sourceRevision: 'source-1' },
        turnId: 'turn-older',
      },
      {
        kind: 'assistant',
        text: 'older answer',
        sentAt: 10_100,
        canonicalIndex: 56,
        turnId: 'turn-older',
      },
      {
        kind: 'user',
        content: 'newer query',
        sentAt: 20_000,
        canonicalIndex: 57,
        historyTurnIndex: 57,
        turnId: 'turn-newer',
        turnUserOrdinal: 0,
      },
      {
        kind: 'assistant',
        text: 'newer answer',
        sentAt: 20_100,
        canonicalIndex: 58,
        turnId: 'turn-newer',
      },
    ],
    FALLBACK_SENT_AT,
    { replaceLoadedWindow: true },
  );

  const expanded = useAppStore.getState();
  const expandedVisible = composeMessages({
    events: expanded.eventsBySession[SID] ?? [],
    userMessages: expanded.userMessagesBySession[SID] ?? [],
  }).flatMap((message) => {
    if (message.kind === 'user') return [`user:${message.content}`];
    if (message.kind === 'assistant_text') return [`assistant:${message.text}`];
    if (message.kind === 'system_notice' && message.lineageKind === 'history_truncation') {
      return ['notice:history_truncation'];
    }
    return [];
  });
  assert.deepEqual(expandedVisible, [
    'user:older query',
    'assistant:older answer',
    'user:newer query',
    'assistant:newer answer',
  ]);
  const canonicalOlderOwner = (expanded.userMessagesBySession[SID] ?? []).find(
    (message) => message.content === 'older query',
  );
  assert.deepEqual(
    canonicalOlderOwner && {
      canonicalIndex: canonicalOlderOwner.canonicalIndex,
      historyTurnIndex: canonicalOlderOwner.historyTurnIndex,
      historyBoundary: canonicalOlderOwner.historyBoundary,
      turnId: canonicalOlderOwner.turnId,
      turnUserOrdinal: canonicalOlderOwner.turnUserOrdinal,
      restoredFromHistory: canonicalOlderOwner.restoredFromHistory,
    },
    {
      canonicalIndex: 55,
      historyTurnIndex: 55,
      historyBoundary: { boundaryId: 'older-answer-boundary', sourceRevision: 'source-1' },
      turnId: 'turn-older',
      turnUserOrdinal: 0,
      restoredFromHistory: true,
    },
    'the exact canonical fork/rewind boundary remains while the unique live owner supplies ordinal 0',
  );
  assertClosedTranscriptStructure(SID);
});

test('a leading canonical suffix preserves the complete live text and tool prefix in place', () => {
  const store = useAppStore.getState();
  store.appendUserMessage(SID, 'query before a tool-rich answer', 10_000);
  store.appendEvent({
    kind: 'session_start',
    sessionId: SID,
    provider: 'mock',
    turnId: 'turn-tool-rich-prefix',
  });
  store.appendEvent({
    kind: 'text_delta',
    sessionId: SID,
    text: 'early answer',
    sentAt: 10_050,
  });
  store.appendEvent({
    kind: 'tool_start',
    sessionId: SID,
    toolId: 'tool-prefix',
    toolName: 'read',
    input: { path: '/tmp/example' },
  });
  store.appendEvent({
    kind: 'tool_result',
    sessionId: SID,
    toolId: 'tool-prefix',
    toolName: 'read',
    content: 'tool output',
  });
  store.appendEvent({
    kind: 'text_delta',
    sessionId: SID,
    text: 'final answer',
    sentAt: 10_100,
  });
  store.appendEvent({
    kind: 'session_complete',
    sessionId: SID,
    turnId: 'turn-tool-rich-prefix',
  });

  store.prependSessionHistory(
    SID,
    [
      { kind: 'history_truncation', scope: 'history', omittedItems: 50 },
      {
        kind: 'assistant',
        text: 'final answer',
        sentAt: 10_100,
        canonicalIndex: 56,
        turnId: 'turn-tool-rich-prefix',
      },
    ],
    FALLBACK_SENT_AT,
    { replaceLoadedWindow: true },
  );

  const state = useAppStore.getState();
  const visibleEvents = (state.eventsBySession[SID] ?? []).flatMap((event) => {
    if (event.kind === 'text_delta') return [`text:${event.text}`];
    if (event.kind === 'tool_start') return [`tool-start:${event.toolId}`];
    if (event.kind === 'tool_result') return [`tool-result:${event.toolId}:${event.content}`];
    return [];
  });
  assert.deepEqual(visibleEvents, [
    'text:early answer',
    'tool-start:tool-prefix',
    'tool-result:tool-prefix:tool output',
    'text:final answer',
  ]);
  assert.equal(visibleEvents.filter((event) => event === 'text:final answer').length, 1);

  const visibleTranscript = composeMessages({
    events: state.eventsBySession[SID] ?? [],
    userMessages: state.userMessagesBySession[SID] ?? [],
  }).flatMap((message) => {
    if (message.kind === 'user') return [`user:${message.content}`];
    if (message.kind === 'assistant_text') return [`assistant:${message.text}`];
    return [];
  });
  assert.deepEqual(visibleTranscript, [
    'user:query before a tool-rich answer',
    'assistant:early answer',
    'assistant:final answer',
  ]);
  assertClosedTranscriptStructure(SID);
});

test('a leading partial history turn stays ambiguous when several live users share its turnId', () => {
  const store = useAppStore.getState();
  store.appendUserMessage(SID, 'first prompt', 10_000);
  store.appendEvent({
    kind: 'session_start',
    sessionId: SID,
    provider: 'mock',
    turnId: 'turn-multi-prompt',
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
    queueId: 'second-prompt',
    content: 'second prompt',
    turnId: 'turn-multi-prompt',
    turnUserOrdinal: 1,
  });
  store.appendEvent({
    kind: 'text_delta',
    sessionId: SID,
    text: 'second response',
    sentAt: 10_200,
  });
  store.appendEvent({
    kind: 'session_complete',
    sessionId: SID,
    turnId: 'turn-multi-prompt',
  });

  store.prependSessionHistory(
    SID,
    [
      { kind: 'history_truncation', scope: 'history', omittedItems: 50 },
      {
        kind: 'assistant',
        text: 'partial canonical response',
        sentAt: 10_150,
        canonicalIndex: 50,
        turnId: 'turn-multi-prompt',
      },
    ],
    FALLBACK_SENT_AT,
    { replaceLoadedWindow: true },
  );

  const state = useAppStore.getState();
  const users = state.userMessagesBySession[SID] ?? [];
  assert.equal(
    users.filter(
      (message) => message.turnId === 'turn-multi-prompt' && !message.restoredFromHistory,
    ).length,
    2,
    'an omitted ordinal must not be guessed from two possible live owners',
  );
  assert.equal(
    users.filter((message) => message.leadingPartialHistory === true).length,
    1,
    'the unresolved canonical prefix remains an explicit hidden owner',
  );
});

test('a leading partial history turn cannot absorb a sole later mid-turn live prompt', () => {
  const store = useAppStore.getState();
  store.appendUserMessage(SID, 'later mid-turn prompt', 10_000);
  store.appendEvent({
    kind: 'session_start',
    sessionId: SID,
    provider: 'mock',
    turnId: 'turn-shared',
  });
  useAppStore.setState((state) => ({
    userMessagesBySession: {
      ...state.userMessagesBySession,
      [SID]: (state.userMessagesBySession[SID] ?? []).map((message) => ({
        ...message,
        turnId: 'turn-shared',
        turnUserOrdinal: 1,
      })),
    },
  }));
  store.appendEvent({ kind: 'text_delta', sessionId: SID, text: 'later answer', sentAt: 10_100 });
  store.appendEvent({ kind: 'session_complete', sessionId: SID, turnId: 'turn-shared' });

  store.prependSessionHistory(
    SID,
    [
      { kind: 'history_truncation', scope: 'history', omittedItems: 50 },
      {
        kind: 'assistant',
        text: 'earlier omitted prompt answer',
        sentAt: 9_900,
        canonicalIndex: 50,
        turnId: 'turn-shared',
      },
    ],
    FALLBACK_SENT_AT,
    { replaceLoadedWindow: true },
  );

  const state = useAppStore.getState();
  const users = state.userMessagesBySession[SID] ?? [];
  assert.equal(
    users.some(
      (message) =>
        message.content === 'later mid-turn prompt' &&
        message.turnUserOrdinal === 1 &&
        message.restoredFromHistory !== true,
    ),
    true,
  );
  assert.equal(users.filter((message) => message.leadingPartialHistory === true).length, 1);
  const assistantText = composeMessages({
    events: state.eventsBySession[SID] ?? [],
    userMessages: users,
  })
    .filter((message) => message.kind === 'assistant_text')
    .map((message) => message.text);
  assert.deepEqual(assistantText, ['earlier omitted prompt answer', 'later answer']);
});

test('a leading partial history turn cannot absorb an ordinal-zero owner with another response', () => {
  const store = useAppStore.getState();
  store.appendUserMessage(SID, 'root live prompt', 10_000);
  store.appendEvent({
    kind: 'session_start',
    sessionId: SID,
    provider: 'mock',
    turnId: 'turn-shared',
  });
  store.appendEvent({ kind: 'text_delta', sessionId: SID, text: 'live root answer' });
  store.appendEvent({ kind: 'session_complete', sessionId: SID, turnId: 'turn-shared' });

  store.prependSessionHistory(
    SID,
    [
      { kind: 'history_truncation', scope: 'history', omittedItems: 50 },
      {
        kind: 'assistant',
        text: 'different canonical tail',
        canonicalIndex: 50,
        turnId: 'turn-shared',
      },
    ],
    FALLBACK_SENT_AT,
    { replaceLoadedWindow: true },
  );

  const state = useAppStore.getState();
  const users = state.userMessagesBySession[SID] ?? [];
  assert.equal(
    users.some(
      (message) =>
        message.content === 'root live prompt' &&
        message.turnUserOrdinal === 0 &&
        message.restoredFromHistory !== true,
    ),
    true,
  );
  assert.equal(users.filter((message) => message.leadingPartialHistory === true).length, 1);
  assert.deepEqual(
    composeMessages({ events: state.eventsBySession[SID] ?? [], userMessages: users })
      .filter((message) => message.kind === 'assistant_text')
      .map((message) => message.text),
    ['different canonical tail', 'live root answer'],
  );
});

test('an ambiguous leading partial projection never crosses the next canonical user boundary', () => {
  const store = useAppStore.getState();
  store.appendUserMessage(SID, 'older live query', 10_000);
  store.appendEvent({
    kind: 'session_start',
    sessionId: SID,
    provider: 'mock',
    turnId: 'turn-older',
  });
  store.appendEvent({ kind: 'text_delta', sessionId: SID, text: 'shared older answer' });
  store.appendEvent({
    kind: 'session_error',
    sessionId: SID,
    error: 'provider failed after partial output',
    turnId: 'turn-older',
  });
  store.appendUserMessage(SID, 'newer canonical query', 20_000);
  store.appendEvent({
    kind: 'session_start',
    sessionId: SID,
    provider: 'mock',
    turnId: 'turn-newer',
  });
  store.appendEvent({ kind: 'text_delta', sessionId: SID, text: 'newer canonical answer' });
  store.appendEvent({
    kind: 'session_complete',
    sessionId: SID,
    turnId: 'turn-newer',
  });

  store.prependSessionHistory(
    SID,
    [
      { kind: 'history_truncation', scope: 'history', omittedItems: 50 },
      {
        kind: 'assistant',
        text: 'shared older answer',
        canonicalIndex: 50,
        turnId: 'turn-older',
      },
      {
        kind: 'user',
        content: 'newer canonical query',
        canonicalIndex: 51,
        turnId: 'turn-newer',
        turnUserOrdinal: 0,
      },
      {
        kind: 'assistant',
        text: 'newer canonical answer',
        canonicalIndex: 52,
        turnId: 'turn-newer',
      },
    ],
    FALLBACK_SENT_AT,
    { replaceLoadedWindow: true },
  );

  const state = useAppStore.getState();
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
      'user:older live query',
      'assistant:shared older answer',
      'assistant:shared older answer',
      'user:newer canonical query',
      'assistant:newer canonical answer',
    ],
    'ambiguous old projections may both remain, but neither may move behind a newer user boundary',
  );

  store.appendUserMessage(SID, 'fresh query after restore', 30_000);
  store.appendEvent({
    kind: 'session_start',
    sessionId: SID,
    provider: 'mock',
    turnId: 'turn-fresh',
  });
  store.appendEvent({ kind: 'text_delta', sessionId: SID, text: 'fresh answer' });
  store.appendEvent({ kind: 'session_complete', sessionId: SID, turnId: 'turn-fresh' });
  const refreshed = useAppStore.getState();
  assert.deepEqual(
    composeMessages({
      events: refreshed.eventsBySession[SID] ?? [],
      userMessages: refreshed.userMessagesBySession[SID] ?? [],
    }).flatMap((message) => {
      if (message.kind === 'user') return [`user:${message.content}`];
      if (message.kind === 'assistant_text') return [`assistant:${message.text}`];
      return [];
    }),
    [
      'user:older live query',
      'assistant:shared older answer',
      'assistant:shared older answer',
      'user:newer canonical query',
      'assistant:newer canonical answer',
      'user:fresh query after restore',
      'assistant:fresh answer',
    ],
    'a later send must append after the conservatively retained old projections',
  );
});

test('all live users in one ambiguous turn stay together before a later canonical turn', () => {
  const store = useAppStore.getState();
  store.appendUserMessage(SID, 'older root query', 10_000);
  store.appendEvent({
    kind: 'session_start',
    sessionId: SID,
    provider: 'mock',
    turnId: 'turn-older-group',
  });
  store.appendEvent({ kind: 'text_delta', sessionId: SID, text: 'older root answer' });
  store.appendEvent({
    kind: 'mid_turn_user_prompt',
    sessionId: SID,
    queueId: 'older-followup',
    content: 'older follow-up query',
    turnId: 'turn-older-group',
    turnUserOrdinal: 1,
  });
  store.appendEvent({ kind: 'text_delta', sessionId: SID, text: 'older follow-up answer' });
  store.appendEvent({
    kind: 'session_complete',
    sessionId: SID,
    turnId: 'turn-older-group',
  });
  store.appendUserMessage(SID, 'newer query', 20_000);
  store.appendEvent({
    kind: 'session_start',
    sessionId: SID,
    provider: 'mock',
    turnId: 'turn-newer',
  });
  store.appendEvent({ kind: 'text_delta', sessionId: SID, text: 'newer answer' });
  store.appendEvent({ kind: 'session_complete', sessionId: SID, turnId: 'turn-newer' });

  store.prependSessionHistory(
    SID,
    [
      { kind: 'history_truncation', scope: 'history', omittedItems: 50 },
      {
        kind: 'assistant',
        text: 'partial older canonical answer',
        canonicalIndex: 50,
        turnId: 'turn-older-group',
      },
      {
        kind: 'user',
        content: 'newer query',
        canonicalIndex: 51,
        turnId: 'turn-newer',
        turnUserOrdinal: 0,
      },
      {
        kind: 'assistant',
        text: 'newer answer',
        canonicalIndex: 52,
        turnId: 'turn-newer',
      },
    ],
    FALLBACK_SENT_AT,
    { replaceLoadedWindow: true },
  );

  const visible = composeMessages({
    events: useAppStore.getState().eventsBySession[SID] ?? [],
    userMessages: useAppStore.getState().userMessagesBySession[SID] ?? [],
  }).flatMap((message) => {
    if (message.kind === 'user') return [`user:${message.content}`];
    if (message.kind === 'assistant_text') return [`assistant:${message.text}`];
    return [];
  });
  assert.deepEqual(visible, [
    'user:older root query',
    'assistant:older root answer',
    'user:older follow-up query',
    'assistant:older follow-up answer',
    'assistant:partial older canonical answer',
    'user:newer query',
    'assistant:newer answer',
  ]);

  store.appendUserMessage(SID, 'fresh query', 30_000);
  store.appendEvent({
    kind: 'session_start',
    sessionId: SID,
    provider: 'mock',
    turnId: 'turn-fresh',
  });
  store.appendEvent({ kind: 'text_delta', sessionId: SID, text: 'fresh answer' });
  store.appendEvent({ kind: 'session_complete', sessionId: SID, turnId: 'turn-fresh' });
  const refreshed = composeMessages({
    events: useAppStore.getState().eventsBySession[SID] ?? [],
    userMessages: useAppStore.getState().userMessagesBySession[SID] ?? [],
  }).flatMap((message) => {
    if (message.kind === 'user') return [`user:${message.content}`];
    if (message.kind === 'assistant_text') return [`assistant:${message.text}`];
    return [];
  });
  assert.deepEqual(refreshed.slice(-2), ['user:fresh query', 'assistant:fresh answer']);
});

test('a retained canonical follow-up cannot split its relocated live turn from the next turn', () => {
  const store = useAppStore.getState();
  store.appendUserMessage(SID, 'live root query', 10_000);
  store.appendEvent({
    kind: 'session_start',
    sessionId: SID,
    provider: 'mock',
    turnId: 'turn-multi-input',
  });
  store.appendEvent({ kind: 'text_delta', sessionId: SID, text: 'live root answer' });
  store.appendEvent({
    kind: 'mid_turn_user_prompt',
    sessionId: SID,
    queueId: 'follow-up-input',
    content: 'live follow-up query',
    turnId: 'turn-multi-input',
    turnUserOrdinal: 1,
  });
  store.appendEvent({ kind: 'text_delta', sessionId: SID, text: 'live follow-up answer' });
  store.appendEvent({
    kind: 'session_complete',
    sessionId: SID,
    turnId: 'turn-multi-input',
  });
  store.appendUserMessage(SID, 'live next query', 20_000);
  store.appendEvent({
    kind: 'session_start',
    sessionId: SID,
    provider: 'mock',
    turnId: 'turn-next',
  });
  store.appendEvent({ kind: 'text_delta', sessionId: SID, text: 'live next answer' });
  store.appendEvent({ kind: 'session_complete', sessionId: SID, turnId: 'turn-next' });

  store.prependSessionHistory(
    SID,
    [
      { kind: 'history_truncation', scope: 'history', omittedItems: 50 },
      {
        kind: 'assistant',
        text: 'canonical partial root tail',
        canonicalIndex: 50,
        turnId: 'turn-multi-input',
      },
      {
        kind: 'user',
        content: 'live follow-up query',
        canonicalIndex: 51,
        turnId: 'turn-multi-input',
        turnUserOrdinal: 1,
      },
      {
        kind: 'assistant',
        text: 'canonical follow-up answer',
        canonicalIndex: 52,
        turnId: 'turn-multi-input',
      },
      {
        kind: 'user',
        content: 'live next query',
        canonicalIndex: 53,
        turnId: 'turn-next',
        turnUserOrdinal: 0,
      },
      {
        kind: 'assistant',
        text: 'live next answer',
        canonicalIndex: 54,
        turnId: 'turn-next',
      },
    ],
    FALLBACK_SENT_AT,
    { replaceLoadedWindow: true },
  );

  const state = useAppStore.getState();
  const visible = composeMessages({
    events: state.eventsBySession[SID] ?? [],
    userMessages: state.userMessagesBySession[SID] ?? [],
  }).flatMap((message) => {
    if (message.kind === 'user') return [`user:${message.content}`];
    if (message.kind === 'assistant_text') return [`assistant:${message.text}`];
    return [];
  });
  const rootQuery = visible.indexOf('user:live root query');
  const rootAnswer = visible.indexOf('assistant:live root answer');
  const followUpQuery = visible.indexOf('user:live follow-up query');
  const followUpAnswer = visible.findIndex((row) => row.includes('live follow-up answer'));
  const nextQuery = visible.indexOf('user:live next query');
  const nextAnswer = visible.indexOf('assistant:live next answer', nextQuery + 1);
  assert.ok(rootQuery >= 0 && rootQuery < rootAnswer, JSON.stringify(visible));
  assert.ok(rootAnswer < followUpQuery);
  assert.ok(followUpQuery < followUpAnswer, JSON.stringify(visible));
  assert.ok(followUpAnswer < nextQuery);
  assert.ok(nextQuery < nextAnswer);
  assertClosedTranscriptStructure(SID);
});

test('a retained strong same-turn follow-up cannot split a relocated live turn at the page end', () => {
  const store = useAppStore.getState();
  store.appendUserMessage(SID, 'live root query', 10_000);
  store.appendEvent({
    kind: 'session_start',
    sessionId: SID,
    provider: 'mock',
    turnId: 'turn-page-end',
  });
  store.appendEvent({ kind: 'text_delta', sessionId: SID, text: 'live root answer' });
  store.appendEvent({
    kind: 'mid_turn_user_prompt',
    sessionId: SID,
    queueId: 'page-end-follow-up',
    content: 'live follow-up query',
    turnId: 'turn-page-end',
    turnUserOrdinal: 1,
  });
  store.appendEvent({ kind: 'text_delta', sessionId: SID, text: 'live follow-up answer' });
  store.appendEvent({ kind: 'session_complete', sessionId: SID, turnId: 'turn-page-end' });

  store.prependSessionHistory(
    SID,
    [
      { kind: 'history_truncation', scope: 'history', omittedItems: 50 },
      {
        kind: 'assistant',
        text: 'live root answer',
        canonicalIndex: 50,
        turnId: 'turn-page-end',
      },
      {
        kind: 'user',
        content: 'live follow-up query',
        canonicalIndex: 51,
        turnId: 'turn-page-end',
        turnUserOrdinal: 1,
      },
      {
        kind: 'assistant',
        text: 'canonical follow-up answer',
        canonicalIndex: 52,
        turnId: 'turn-page-end',
      },
    ],
    FALLBACK_SENT_AT,
    { replaceLoadedWindow: true },
  );

  const state = useAppStore.getState();
  const visible = composeMessages({
    events: state.eventsBySession[SID] ?? [],
    userMessages: state.userMessagesBySession[SID] ?? [],
  }).flatMap((message) => {
    if (message.kind === 'user') return [`user:${message.content}`];
    if (message.kind === 'assistant_text') return [`assistant:${message.text}`];
    return [];
  });
  const rootQuery = visible.indexOf('user:live root query');
  const rootAnswer = visible.indexOf('assistant:live root answer');
  const followUpQuery = visible.indexOf('user:live follow-up query');
  const followUpAnswer = visible.findIndex((row) => row.includes('live follow-up answer'));
  assert.ok(rootQuery >= 0 && rootQuery < rootAnswer);
  assert.ok(rootAnswer < followUpQuery);
  assert.ok(followUpQuery < followUpAnswer);
  assert.equal(
    visible.filter((row) => row === 'assistant:live root answer').length,
    1,
    JSON.stringify(visible),
  );
  assertClosedTranscriptStructure(SID);
});

test('a retained same-turn ordinal relocates only the proven live prefix before a fresh tail', () => {
  const store = useAppStore.getState();
  store.appendUserMessage(SID, 'live root query', 10_000);
  store.appendEvent({
    kind: 'session_start',
    sessionId: SID,
    provider: 'mock',
    turnId: 'turn-fresh-tail',
  });
  store.appendEvent({ kind: 'text_delta', sessionId: SID, text: 'live root answer' });
  for (const [ordinal, label] of [
    [1, 'follow-up'],
    [2, 'fresh tail'],
  ] as const) {
    store.appendEvent({
      kind: 'mid_turn_user_prompt',
      sessionId: SID,
      queueId: `input-${ordinal}`,
      content: `${label} query`,
      turnId: 'turn-fresh-tail',
      turnUserOrdinal: ordinal,
    });
    store.appendEvent({ kind: 'text_delta', sessionId: SID, text: `${label} answer` });
  }
  store.appendEvent({ kind: 'session_complete', sessionId: SID, turnId: 'turn-fresh-tail' });

  store.prependSessionHistory(
    SID,
    [
      { kind: 'history_truncation', scope: 'history', omittedItems: 50 },
      {
        kind: 'assistant',
        text: 'canonical partial root tail',
        canonicalIndex: 50,
        turnId: 'turn-fresh-tail',
      },
      {
        kind: 'user',
        content: 'follow-up query',
        canonicalIndex: 51,
        turnId: 'turn-fresh-tail',
        turnUserOrdinal: 1,
      },
      {
        kind: 'assistant',
        text: 'follow-up answer',
        canonicalIndex: 52,
        turnId: 'turn-fresh-tail',
      },
    ],
    FALLBACK_SENT_AT,
    { replaceLoadedWindow: true },
  );

  const state = useAppStore.getState();
  const visible = composeMessages({
    events: state.eventsBySession[SID] ?? [],
    userMessages: state.userMessagesBySession[SID] ?? [],
  }).flatMap((message) => {
    if (message.kind === 'user') return [`user:${message.content}`];
    if (message.kind === 'assistant_text') return [`assistant:${message.text}`];
    return [];
  });
  const rootQuery = visible.indexOf('user:live root query');
  const rootAnswer = visible.indexOf('assistant:live root answer');
  const followUpQuery = visible.indexOf('user:follow-up query');
  const followUpAnswer = visible.indexOf('assistant:follow-up answer', followUpQuery + 1);
  assert.ok(rootQuery >= 0 && rootQuery < rootAnswer);
  assert.ok(rootAnswer < followUpQuery);
  assert.ok(followUpQuery < followUpAnswer);
  assert.deepEqual(visible.slice(-2), ['user:fresh tail query', 'assistant:fresh tail answer']);
  assertClosedTranscriptStructure(SID);
});

test('a mixed unidentified and identified leading prefix cannot claim the later live turn', () => {
  const store = useAppStore.getState();
  store.appendUserMessage(SID, 'identified live query', 10_000);
  store.appendEvent({
    kind: 'session_start',
    sessionId: SID,
    provider: 'mock',
    turnId: 'turn-identified',
  });
  store.appendEvent({
    kind: 'text_delta',
    sessionId: SID,
    text: 'identified live answer',
    sentAt: 10_200,
  });
  store.appendEvent({
    kind: 'session_complete',
    sessionId: SID,
    turnId: 'turn-identified',
  });

  store.prependSessionHistory(
    SID,
    [
      { kind: 'history_truncation', scope: 'history', omittedItems: 50 },
      {
        kind: 'assistant',
        text: 'unidentified legacy prefix',
        sentAt: 9_900,
        canonicalIndex: 50,
      },
      {
        kind: 'assistant',
        text: 'identified canonical answer',
        sentAt: 10_100,
        canonicalIndex: 51,
        turnId: 'turn-identified',
      },
    ],
    FALLBACK_SENT_AT,
    { replaceLoadedWindow: true },
  );

  const state = useAppStore.getState();
  const users = state.userMessagesBySession[SID] ?? [];
  assert.equal(
    users.some((message) => message.leadingPartialHistory === true),
    false,
    'missing turn ownership anywhere in the leading body must force the legacy anchor path',
  );
  assert.equal(
    users.some(
      (message) =>
        message.content === 'identified live query' && message.restoredFromHistory !== true,
    ),
    true,
    'the live query remains independent because the mixed canonical prefix is ambiguous',
  );
});

test('a retained same-turn weak user stays fail-open while the canonical prefix is omitted', () => {
  const store = useAppStore.getState();
  store.appendUserMessage(SID, 'later query', 10_000);
  store.appendEvent({
    kind: 'session_start',
    sessionId: SID,
    provider: 'mock',
    turnId: 'turn-shared',
  });
  store.appendEvent({ kind: 'text_delta', sessionId: SID, text: 'later answer', sentAt: 10_200 });
  store.appendEvent({ kind: 'session_complete', sessionId: SID, turnId: 'turn-shared' });

  store.prependSessionHistory(
    SID,
    [
      { kind: 'history_truncation', scope: 'history', omittedItems: 50 },
      {
        kind: 'assistant',
        text: 'prior prompt tail',
        sentAt: 9_900,
        canonicalIndex: 50,
        turnId: 'turn-shared',
      },
      {
        kind: 'user',
        content: 'later query',
        sentAt: 10_000,
        canonicalIndex: 51,
        turnId: 'turn-shared',
      },
      {
        kind: 'assistant',
        text: 'later answer',
        sentAt: 10_200,
        canonicalIndex: 52,
        turnId: 'turn-shared',
      },
    ],
    FALLBACK_SENT_AT,
    { replaceLoadedWindow: true },
  );

  const state = useAppStore.getState();
  const visible = composeMessages({
    events: state.eventsBySession[SID] ?? [],
    userMessages: state.userMessagesBySession[SID] ?? [],
  }).flatMap((message) => {
    if (message.kind === 'user') return [`user:${message.content}`];
    if (message.kind === 'assistant_text') return [`assistant:${message.text}`];
    if (message.kind === 'system_notice' && message.lineageKind === 'history_truncation') {
      return ['notice:history_truncation'];
    }
    return [];
  });
  assert.deepEqual(visible, [
    'notice:history_truncation',
    'assistant:prior prompt tail',
    'user:later query',
    'assistant:later answer',
    'user:later query',
    'assistant:later answer',
  ]);
  const laterOwners = (state.userMessagesBySession[SID] ?? []).filter(
    (message) => message.content === 'later query',
  );
  assert.equal(laterOwners.length, 2);
  assert.equal(
    laterOwners.some(
      (message) => message.canonicalIndex === 51 && message.restoredFromHistory === true,
    ),
    true,
  );
  assert.equal(
    laterOwners.some(
      (message) => message.turnUserOrdinal === 0 && message.restoredFromHistory !== true,
    ),
    true,
    'the live owner remains independent until pagination proves the complete canonical prefix',
  );
  assert.equal(
    (state.userMessagesBySession[SID] ?? []).filter(
      (message) => message.leadingPartialHistory === true,
    ).length,
    1,
    'the assistant tail keeps its own hidden partial owner',
  );
  assertClosedTranscriptStructure(SID);
});

test('a weak same-turn owner cannot let a live prefix cross the next canonical turn', () => {
  const store = useAppStore.getState();
  store.appendUserMessage(SID, 'live root query', 15_000);
  store.appendEvent({
    kind: 'session_start',
    sessionId: SID,
    provider: 'mock',
    turnId: 'turn-weak-crossing',
  });
  store.appendEvent({
    kind: 'text_delta',
    sessionId: SID,
    text: 'live root answer',
    sentAt: 15_100,
  });
  store.appendEvent({
    kind: 'session_complete',
    sessionId: SID,
    turnId: 'turn-weak-crossing',
  });

  store.prependSessionHistory(
    SID,
    [
      { kind: 'history_truncation', scope: 'history', omittedItems: 50 },
      {
        kind: 'assistant',
        text: 'live root answer',
        sentAt: 9_000,
        canonicalIndex: 50,
        turnId: 'turn-weak-crossing',
      },
      {
        kind: 'user',
        content: 'weak same-turn query',
        sentAt: 10_000,
        canonicalIndex: 51,
        turnId: 'turn-weak-crossing',
      },
      {
        kind: 'assistant',
        text: 'weak same-turn answer',
        sentAt: 10_100,
        canonicalIndex: 52,
        turnId: 'turn-weak-crossing',
      },
      {
        kind: 'user',
        content: 'later query',
        sentAt: 20_000,
        canonicalIndex: 53,
        turnId: 'turn-later',
        turnUserOrdinal: 0,
      },
      {
        kind: 'assistant',
        text: 'later answer',
        sentAt: 20_100,
        canonicalIndex: 54,
        turnId: 'turn-later',
      },
    ],
    FALLBACK_SENT_AT,
    { replaceLoadedWindow: true },
  );

  const state = useAppStore.getState();
  const visible = composeMessages({
    events: state.eventsBySession[SID] ?? [],
    userMessages: state.userMessagesBySession[SID] ?? [],
  }).flatMap((message) => {
    if (message.kind === 'user') return [`user:${message.content}`];
    if (message.kind === 'assistant_text') return [`assistant:${message.text}`];
    return [];
  });
  const liveRoot = visible.indexOf('user:live root query');
  const weakOwner = visible.indexOf('user:weak same-turn query');
  const laterQuery = visible.indexOf('user:later query');
  const laterAnswer = visible.indexOf('assistant:later answer', laterQuery + 1);
  assert.ok(liveRoot >= 0 && liveRoot < weakOwner, JSON.stringify(visible));
  assert.ok(weakOwner < laterQuery, JSON.stringify(visible));
  assert.ok(laterQuery < laterAnswer, JSON.stringify(visible));
  assertClosedTranscriptStructure(SID);
});

test('a leading partial turn remains separate when its retained same-turn user has another payload', () => {
  const store = useAppStore.getState();
  store.appendUserMessage(SID, 'live later query', 10_000);
  store.appendEvent({
    kind: 'session_start',
    sessionId: SID,
    provider: 'mock',
    turnId: 'turn-shared',
  });
  store.appendEvent({ kind: 'text_delta', sessionId: SID, text: 'live answer', sentAt: 10_300 });
  store.appendEvent({ kind: 'session_complete', sessionId: SID, turnId: 'turn-shared' });

  store.prependSessionHistory(
    SID,
    [
      { kind: 'history_truncation', scope: 'history', omittedItems: 50 },
      {
        kind: 'assistant',
        text: 'prior prompt tail',
        sentAt: 9_900,
        canonicalIndex: 50,
        turnId: 'turn-shared',
      },
      {
        kind: 'user',
        content: 'canonical later query',
        sentAt: 10_100,
        canonicalIndex: 51,
        turnId: 'turn-shared',
      },
      {
        kind: 'assistant',
        text: 'canonical answer',
        sentAt: 10_200,
        canonicalIndex: 52,
        turnId: 'turn-shared',
      },
    ],
    FALLBACK_SENT_AT,
    { replaceLoadedWindow: true },
  );

  const users = useAppStore.getState().userMessagesBySession[SID] ?? [];
  assert.equal(
    users.some(
      (message) =>
        message.content === 'canonical later query' && message.restoredFromHistory === true,
    ),
    true,
  );
  assert.equal(
    users.some(
      (message) => message.content === 'live later query' && message.restoredFromHistory !== true,
    ),
    true,
  );
  assert.equal(
    users.filter((message) => message.leadingPartialHistory === true).length,
    1,
    'the live query must not be promoted into the omitted earlier prompt boundary',
  );
});

test('identical weak canonical users in one Runtime turn cannot guess one live ordinal', () => {
  const store = useAppStore.getState();
  store.appendUserMessage(SID, 'repeat', 10_000);
  store.appendEvent({
    kind: 'session_start',
    sessionId: SID,
    provider: 'mock',
    turnId: 'turn-repeated',
  });
  store.appendEvent({ kind: 'text_delta', sessionId: SID, text: 'live second answer' });
  store.appendEvent({ kind: 'session_complete', sessionId: SID, turnId: 'turn-repeated' });

  store.prependSessionHistory(
    SID,
    [
      { kind: 'history_truncation', scope: 'history', omittedItems: 10 },
      {
        kind: 'user',
        content: 'repeat',
        canonicalIndex: 10,
        turnId: 'turn-repeated',
      },
      {
        kind: 'assistant',
        text: 'canonical first answer',
        canonicalIndex: 11,
        turnId: 'turn-repeated',
      },
      {
        kind: 'user',
        content: 'repeat',
        canonicalIndex: 12,
        turnId: 'turn-repeated',
      },
      {
        kind: 'assistant',
        text: 'canonical second answer',
        canonicalIndex: 13,
        turnId: 'turn-repeated',
      },
    ],
    FALLBACK_SENT_AT,
    { replaceLoadedWindow: true },
  );

  const users = useAppStore.getState().userMessagesBySession[SID] ?? [];
  assert.equal(users.filter((message) => message.content === 'repeat').length, 3);
  assert.equal(
    users.filter((message) => message.content === 'repeat' && message.restoredFromHistory === true)
      .length,
    2,
  );
  assert.equal(
    users.some((message) => message.content === 'repeat' && message.restoredFromHistory !== true),
    true,
    'the sole live ordinal stays independent because either canonical prompt could own it',
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

test('authoritative terminal repairs a missed identity-bearing start before folding history', () => {
  const store = useAppStore.getState();
  store.appendUserMessage(SID, 'terminal repairs the owner', 10_000);
  store.appendEvent({
    kind: 'session_start',
    sessionId: SID,
    provider: 'mock',
  });
  store.appendEvent({
    kind: 'text_delta',
    sessionId: SID,
    text: 'live answer',
    sentAt: 10_100,
  });

  // The observation can be invalidated after run.started and miss turn.started. A canonical
  // refresh then exposes the durable copy with its Runtime turn identity while the local live
  // owner is still anonymous.
  store.prependSessionHistory(
    SID,
    [
      { kind: 'user', content: 'earlier query', sentAt: 5_000 },
      { kind: 'assistant', text: 'earlier answer', sentAt: 5_100 },
      {
        kind: 'user',
        content: 'terminal repairs the owner',
        sentAt: 10_050,
        turnId: 'turn-terminal-repair',
        turnUserOrdinal: 0,
      },
      {
        kind: 'assistant',
        text: 'live answer',
        sentAt: 10_100,
        turnId: 'turn-terminal-repair',
      },
    ],
    FALLBACK_SENT_AT,
  );

  store.appendEvent({
    kind: 'session_complete',
    sessionId: SID,
    turnId: 'turn-terminal-repair',
  });

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
      'user:earlier query',
      'assistant:earlier answer',
      'user:terminal repairs the owner',
      'assistant:live answer',
    ],
  );
  assertClosedTranscriptStructure(SID);
});

test('authoritative live transcript identity repairs a missed start while the run is active', () => {
  const store = useAppStore.getState();
  const messageId = store.appendUserMessage(SID, 'live identity repairs the owner', 10_000);
  assert.notEqual(messageId, null);
  store.bindUserMessageRuntimeRun(SID, messageId!, 'run-live-repair');
  store.appendEvent({
    kind: 'session_start',
    sessionId: SID,
    provider: 'mock',
    runtimeEvent: { runtimeId: 'runtime-live-repair', runId: 'run-live-repair', seq: 1 },
  });
  store.prependSessionHistory(
    SID,
    [
      { kind: 'user', content: 'earlier query', sentAt: 5_000 },
      { kind: 'assistant', text: 'earlier answer', sentAt: 5_100 },
      {
        kind: 'user',
        content: 'live identity repairs the owner',
        sentAt: 10_050,
        turnId: 'turn-live-repair',
        turnUserOrdinal: 0,
      },
      {
        kind: 'assistant',
        text: 'durable prefix',
        sentAt: 10_100,
        turnId: 'turn-live-repair',
      },
    ],
    FALLBACK_SENT_AT,
  );

  store.appendEvent({
    kind: 'text_delta',
    sessionId: SID,
    text: 'new live tail',
    sentAt: 10_200,
    turnId: 'turn-live-repair',
    runtimeEvent: { runtimeId: 'runtime-live-repair', runId: 'run-live-repair', seq: 2 },
  });

  const state = useAppStore.getState();
  const out = composeMessages({
    events: state.eventsBySession[SID] ?? [],
    userMessages: state.userMessagesBySession[SID] ?? [],
  });
  assert.equal(
    out.filter(
      (message) => message.kind === 'user' && message.content === 'live identity repairs the owner',
    ).length,
    1,
    'the first surviving identity-bearing transcript event must close the handoff gap immediately',
  );
  assert.deepEqual(
    out.flatMap((message) =>
      message.kind === 'assistant_text' ? [`assistant:${message.text}`] : [],
    ),
    ['assistant:earlier answer', 'assistant:durable prefix'],
    'the hidden live duplicate stays positional until the authoritative terminal merges it',
  );
});

test('every surviving root transcript event can repair a missed identity-bearing start', () => {
  const store = useAppStore.getState();
  const transcriptEvents = [
    (sessionId: string, runId: string, turnId: string): SessionEvent => ({
      kind: 'thinking_end',
      sessionId,
      thinking: 'reasoning done',
      turnId,
      runtimeEvent: { runtimeId: 'runtime-repair', runId, seq: 2 },
    }),
    (sessionId: string, runId: string, turnId: string): SessionEvent => ({
      kind: 'tool_progress',
      sessionId,
      toolId: `tool-${runId}`,
      message: 'working',
      turnId,
      runtimeEvent: { runtimeId: 'runtime-repair', runId, seq: 2 },
    }),
    (sessionId: string, runId: string, turnId: string): SessionEvent => ({
      kind: 'tool_input_delta',
      sessionId,
      toolId: `tool-${runId}`,
      toolName: 'read',
      partialJson: '{"path":"notes.md"}',
      turnId,
      runtimeEvent: { runtimeId: 'runtime-repair', runId, seq: 2 },
    }),
  ] as const;

  transcriptEvents.forEach((createEvent, index) => {
    const runId = `run-repair-${index}`;
    const turnId = `turn-repair-${index}`;
    const content = `query repaired by event ${index}`;
    const messageId = store.appendUserMessage(SID, content, 30_000 + index);
    assert.notEqual(messageId, null);
    store.bindUserMessageRuntimeRun(SID, messageId!, runId);
    store.appendEvent({
      kind: 'session_start',
      sessionId: SID,
      provider: 'mock',
      runtimeEvent: { runtimeId: 'runtime-repair', runId, seq: 1 },
    });
    store.appendEvent(createEvent(SID, runId, turnId));
    store.appendEvent({
      kind: 'session_complete',
      sessionId: SID,
      turnId,
      runtimeEvent: { runtimeId: 'runtime-repair', runId, seq: 3 },
    });
  });

  assert.deepEqual(
    (useAppStore.getState().userMessagesBySession[SID] ?? []).map((message) => [
      message.content,
      message.turnId,
    ]),
    [
      ['query repaired by event 0', 'turn-repair-0'],
      ['query repaired by event 1', 'turn-repair-1'],
      ['query repaired by event 2', 'turn-repair-2'],
    ],
  );
});

test('a delayed prior-run transcript event cannot claim the next optimistic query', () => {
  const store = useAppStore.getState();
  const oldMessageId = store.appendUserMessage(SID, 'old query', 10_000);
  assert.notEqual(oldMessageId, null);
  store.bindUserMessageRuntimeRun(SID, oldMessageId!, 'run-old');
  store.appendEvent({
    kind: 'session_start',
    sessionId: SID,
    provider: 'mock',
    runtimeEvent: { runtimeId: 'runtime-1', runId: 'run-old', seq: 1 },
  });
  store.appendEvent({
    kind: 'text_delta',
    sessionId: SID,
    text: 'old prefix',
    runtimeEvent: { runtimeId: 'runtime-1', runId: 'run-old', seq: 2 },
  });

  // The Runtime profile can settle before a delayed observation batch drains, allowing the next
  // optimistic query to exist before the old turn's first identity-bearing transcript event.
  const newMessageId = store.appendUserMessage(SID, 'new query', 20_000);
  assert.notEqual(newMessageId, null);
  store.bindUserMessageRuntimeRun(SID, newMessageId!, 'run-new');
  store.appendEvent({
    kind: 'text_delta',
    sessionId: SID,
    text: 'old suffix',
    turnId: 'turn-old',
    runtimeEvent: { runtimeId: 'runtime-1', runId: 'run-old', seq: 3 },
  });
  store.appendEvent({
    kind: 'session_complete',
    sessionId: SID,
    turnId: 'turn-old',
    runtimeEvent: { runtimeId: 'runtime-1', runId: 'run-old', seq: 4 },
  });
  store.appendEvent({
    kind: 'session_start',
    sessionId: SID,
    provider: 'mock',
    runtimeEvent: { runtimeId: 'runtime-1', runId: 'run-new', seq: 5 },
  });
  store.appendEvent({
    kind: 'thinking_delta',
    sessionId: SID,
    text: 'new thinking',
    turnId: 'turn-new',
    runtimeEvent: { runtimeId: 'runtime-1', runId: 'run-new', seq: 6 },
  });

  const users = useAppStore.getState().userMessagesBySession[SID] ?? [];
  assert.deepEqual(
    users.map((message) => [message.content, message.turnId]),
    [
      ['old query', 'turn-old'],
      ['new query', 'turn-new'],
    ],
  );
});

test('a Runtime admission acknowledgement binds the exact query after starts were missed', () => {
  const store = useAppStore.getState();
  const messageId = store.appendUserMessage(SID, 'query whose start was missed', 10_000);
  assert.notEqual(messageId, null);

  store.appendEvent({
    kind: 'text_delta',
    sessionId: SID,
    text: 'first surviving answer fragment',
    turnId: 'turn-admitted',
    runtimeEvent: { runtimeId: 'runtime-admitted', runId: 'run-admitted', seq: 2 },
  });
  store.bindUserMessageRuntimeRun(SID, messageId!, 'run-admitted');

  assert.deepEqual(
    (useAppStore.getState().userMessagesBySession[SID] ?? []).map((message) => [
      message.content,
      message.runtimeRunId,
      message.turnId,
    ]),
    [['query whose start was missed', 'run-admitted', 'turn-admitted']],
  );
});

test('a delayed old session start cannot steal a newly acknowledged Runtime query', () => {
  const store = useAppStore.getState();
  const oldMessageId = store.appendUserMessage(SID, 'old query', 10_000);
  assert.notEqual(oldMessageId, null);
  store.bindUserMessageRuntimeRun(SID, oldMessageId!, 'run-old');

  const newMessageId = store.appendUserMessage(SID, 'new query', 20_000);
  assert.notEqual(newMessageId, null);
  store.appendEvent({
    kind: 'session_start',
    sessionId: SID,
    provider: 'mock',
    runtimeEvent: { runtimeId: 'runtime-delayed', runId: 'run-old', seq: 1 },
  });
  store.bindUserMessageRuntimeRun(SID, newMessageId!, 'run-new');
  store.appendEvent({
    kind: 'text_delta',
    sessionId: SID,
    text: 'old answer',
    turnId: 'turn-old',
    runtimeEvent: { runtimeId: 'runtime-delayed', runId: 'run-old', seq: 2 },
  });
  store.appendEvent({
    kind: 'text_delta',
    sessionId: SID,
    text: 'new answer',
    turnId: 'turn-new',
    runtimeEvent: { runtimeId: 'runtime-delayed', runId: 'run-new', seq: 3 },
  });

  assert.deepEqual(
    (useAppStore.getState().userMessagesBySession[SID] ?? []).map((message) => [
      message.content,
      message.runtimeRunId,
      message.turnId,
    ]),
    [
      ['old query', 'run-old', 'turn-old'],
      ['new query', 'run-new', 'turn-new'],
    ],
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

test('an after-turn queue promotion carries its exact admitted Runtime run identity', () => {
  const store = useAppStore.getState();
  const localId = store.appendQueuedUserMessage(SID, {
    content: 'queued query',
    matchContent: 'queued query',
    queueMode: 'after-turn',
    sentAt: 8_000,
  });
  assert.ok(localId);
  store.markQueuedUserMessageAccepted(SID, localId, 'run-after-turn', 'after-turn');

  store.appendEvent({
    kind: 'queued_user_prompt_started',
    sessionId: SID,
    queueId: 'run-after-turn',
    queueMode: 'after-turn',
    content: 'queued query',
  });
  store.appendEvent({
    kind: 'thinking_delta',
    sessionId: SID,
    text: 'thinking',
    turnId: 'turn-after-turn',
    runtimeEvent: { runtimeId: 'runtime-queue', runId: 'run-after-turn', seq: 2 },
  });

  const promoted = (useAppStore.getState().userMessagesBySession[SID] ?? []).find(
    (message) => message.sourceQueuedLocalId === localId,
  );
  assert.equal(promoted?.runtimeRunId, 'run-after-turn');
  assert.equal(promoted?.turnId, 'turn-after-turn');
});

test('manual queued promotion returns the admitted message id for exact ACK binding', () => {
  const store = useAppStore.getState();
  const localId = store.appendQueuedUserMessage(SID, {
    content: 'queued display query',
    matchContent: 'queued provider query',
    queueMode: 'interrupt',
  });
  assert.ok(localId);

  const promotedId = store.promoteQueuedUserMessage(SID, localId);

  assert.ok(promotedId);
  assert.equal(
    (useAppStore.getState().userMessagesBySession[SID] ?? []).find(
      (message) => message.id === promotedId,
    )?.sourceQueuedLocalId,
    localId,
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

test('a batched interrupt handoff cannot move the next root query into the prior run', () => {
  const store = useAppStore.getState();
  const at = (offset: number): number => FALLBACK_SENT_AT + offset;
  useAppStore.setState({ queuedUserMessagesBySession: {} });

  store.prependSessionHistory(
    SID,
    [{ kind: 'assistant', text: 'older page tail', sentAt: at(9_000) }],
    // A resumed in-flight Session may expose the attachment time as its fallback. It is newer
    // than both this bounded page and the optimistic query submitted while history settles.
    at(30_000),
    { replaceLoadedWindow: true },
  );

  store.appendUserMessage(SID, 'root query', at(10_000));
  store.appendEvent({
    kind: 'session_start',
    sessionId: SID,
    provider: 'mock',
    turnId: 'turn-root',
  });
  store.appendEvent({
    kind: 'text_delta',
    sessionId: SID,
    text: 'root progress',
    sentAt: at(10_100),
  });
  store.appendEvent({
    kind: 'mid_turn_user_prompt',
    sessionId: SID,
    queueId: 'interrupt-stop',
    content: 'stop',
    turnId: 'turn-batched-interrupts',
    turnUserOrdinal: 0,
  });
  store.appendEvent({
    kind: 'mid_turn_user_prompt',
    sessionId: SID,
    queueId: 'interrupt-continue',
    content: 'continue',
    turnId: 'turn-batched-interrupts',
    turnUserOrdinal: 1,
  });
  store.appendEvent({
    kind: 'text_delta',
    sessionId: SID,
    text: 'continued result',
    sentAt: at(10_300),
  });
  store.appendEvent({
    kind: 'session_complete',
    sessionId: SID,
    turnId: 'turn-batched-interrupts',
  });

  store.prependSessionHistory(
    SID,
    [
      { kind: 'assistant', text: 'older page tail', sentAt: at(9_000) },
      {
        kind: 'user',
        content: 'root query',
        sentAt: at(10_000),
        turnId: 'turn-root',
        turnUserOrdinal: 0,
      },
      { kind: 'assistant', text: 'root progress', sentAt: at(10_100) },
      {
        kind: 'user',
        content: 'stop',
        sentAt: at(10_150),
        turnId: 'turn-batched-interrupts',
        turnUserOrdinal: 0,
      },
      {
        kind: 'user',
        content: 'continue',
        sentAt: at(10_200),
        turnId: 'turn-batched-interrupts',
        turnUserOrdinal: 1,
      },
      { kind: 'assistant', text: 'continued result', sentAt: at(10_300) },
    ],
    at(30_000),
    { replaceLoadedWindow: true },
  );

  store.appendUserMessage(SID, 'next root query', at(20_000));
  store.appendEvent({
    kind: 'session_start',
    sessionId: SID,
    provider: 'mock',
    turnId: 'turn-next-root',
  });
  store.appendEvent({
    kind: 'text_delta',
    sessionId: SID,
    text: 'next root answer',
    sentAt: at(20_100),
  });
  store.appendEvent({
    kind: 'session_complete',
    sessionId: SID,
    turnId: 'turn-next-root',
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
    'assistant:older page tail',
    'user:root query',
    'assistant:root progress',
    'user:stop',
    'user:continue',
    'assistant:continued result',
    'user:next root query',
    'assistant:next root answer',
  ]);
  assertClosedTranscriptStructure(SID);
});

test('pre-admission and stopped-run failures cannot leave later root output one user behind', () => {
  const store = useAppStore.getState();

  store.prependSessionHistory(
    SID,
    [
      { kind: 'user', content: 'older query', sentAt: 1_000 },
      { kind: 'assistant', text: 'older answer', sentAt: 1_100 },
    ],
    900,
    { replaceLoadedWindow: true },
  );

  store.appendUserMessage(SID, 'first report', 2_000);
  store.appendEvent({
    kind: 'session_error',
    sessionId: SID,
    error: 'Session data changed during the read boundary: session.lock',
  });

  store.appendUserMessage(SID, 'continue', 3_000);
  store.appendEvent({
    kind: 'session_start',
    sessionId: SID,
    provider: 'mock',
    turnId: 'turn-stopped',
  });
  store.appendEvent({
    kind: 'session_error',
    sessionId: SID,
    error: 'Provider run failed while using a run-scoped credential.',
    turnId: 'turn-stopped',
  });

  store.appendUserMessage(SID, 'second report', 4_000);
  store.appendEvent({
    kind: 'session_start',
    sessionId: SID,
    provider: 'mock',
    turnId: 'turn-running',
  });
  store.appendEvent({
    kind: 'thinking_delta',
    sessionId: SID,
    text: 'current thinking',
    turnId: 'turn-running',
  });
  store.appendEvent({
    kind: 'text_delta',
    sessionId: SID,
    text: 'current answer',
    turnId: 'turn-running',
  });

  const state = useAppStore.getState();
  const visible = composeMessages({
    events: state.eventsBySession[SID] ?? [],
    userMessages: state.userMessagesBySession[SID] ?? [],
  }).flatMap((message) => {
    if (message.kind === 'user') return [`user:${message.content}`];
    if (message.kind === 'assistant_text') return [`assistant:${message.text}`];
    if (message.kind === 'system_notice' && message.variant === 'error') {
      return [`error:${message.text}`];
    }
    return [];
  });

  assert.deepEqual(visible, [
    'user:older query',
    'assistant:older answer',
    'user:first report',
    'error:Session data changed during the read boundary: session.lock',
    'user:continue',
    'error:Provider run failed while using a run-scoped credential.',
    'user:second report',
    'assistant:current answer',
  ]);
});

test('consecutive pre-admission cancellations keep distinct query owners without session_start', () => {
  const store = useAppStore.getState();

  store.appendUserMessage(SID, 'cancelled query one', 1_000);
  store.appendEvent({ kind: 'session_error', sessionId: SID, error: 'cancelled' });
  store.appendUserMessage(SID, 'cancelled query two', 2_000);
  store.appendEvent({ kind: 'session_error', sessionId: SID, error: 'cancelled' });
  store.appendUserMessage(SID, 'successful query three', 3_000);
  store.appendEvent({
    kind: 'session_start',
    sessionId: SID,
    provider: 'mock',
    turnId: 'turn-success-three',
  });
  store.appendEvent({
    kind: 'text_delta',
    sessionId: SID,
    text: 'answer three',
    turnId: 'turn-success-three',
  });
  store.appendEvent({
    kind: 'session_complete',
    sessionId: SID,
    turnId: 'turn-success-three',
  });

  const state = useAppStore.getState();
  const visible = composeMessages({
    events: state.eventsBySession[SID] ?? [],
    userMessages: state.userMessagesBySession[SID] ?? [],
  }).flatMap((message) => {
    if (message.kind === 'user') return [`user:${message.content}`];
    if (message.kind === 'assistant_text') return [`assistant:${message.text}`];
    if (message.kind === 'system_notice' && message.variant === 'error') {
      return [`error:${message.text}`];
    }
    return [];
  });

  assert.deepEqual(visible, [
    'user:cancelled query one',
    'error:cancelled',
    'user:cancelled query two',
    'error:cancelled',
    'user:successful query three',
    'assistant:answer three',
  ]);
});

test('a deduped cancellation receipt cannot re-enter through the history-live baseline', () => {
  const store = useAppStore.getState();
  const restored = [
    { kind: 'user' as const, content: 'restored query', sentAt: 100 },
    { kind: 'assistant' as const, text: 'restored answer', sentAt: 200 },
  ];
  store.prependSessionHistory(SID, restored, 50, { replaceLoadedWindow: true });
  store.appendUserMessage(SID, 'cancel once', 1_000);
  store.appendEvent({ kind: 'session_error', sessionId: SID, error: 'cancelled' });
  store.appendEvent({ kind: 'session_error', sessionId: SID, error: 'cancelled' });

  // Re-applying the canonical window rebuilds from the remembered live baseline. A receipt that
  // state-level dedupe rejected must not have been retained in that baseline.
  store.prependSessionHistory(SID, restored, 50, { replaceLoadedWindow: true });
  const state = useAppStore.getState();
  const visible = composeMessages({
    events: state.eventsBySession[SID] ?? [],
    userMessages: state.userMessagesBySession[SID] ?? [],
  });

  assert.equal(
    visible.filter(
      (message) =>
        message.kind === 'system_notice' &&
        message.variant === 'error' &&
        message.text === 'cancelled',
    ).length,
    1,
  );
});

test('renderer-local ownership preserves a legacy error-complete-wrapped-error chain', () => {
  const store = useAppStore.getState();

  store.appendUserMessage(SID, 'legacy failing query', 1_000);
  store.appendEvent({
    kind: 'text_delta',
    sessionId: SID,
    text: 'partial legacy answer',
  });
  store.appendEvent({ kind: 'session_error', sessionId: SID, error: 'raw 500' });
  store.appendEvent({ kind: 'session_complete', sessionId: SID });
  store.appendEvent({
    kind: 'session_error',
    sessionId: SID,
    error: 'Server error (500). Retrying may help.',
  });
  store.appendUserMessage(SID, 'next successful query', 2_000);
  store.appendEvent({
    kind: 'session_start',
    sessionId: SID,
    provider: 'mock',
    turnId: 'turn-after-legacy-error',
  });
  store.appendEvent({
    kind: 'text_delta',
    sessionId: SID,
    text: 'next successful answer',
    turnId: 'turn-after-legacy-error',
  });
  store.appendEvent({
    kind: 'session_complete',
    sessionId: SID,
    turnId: 'turn-after-legacy-error',
  });

  const state = useAppStore.getState();
  const visible = composeMessages({
    events: state.eventsBySession[SID] ?? [],
    userMessages: state.userMessagesBySession[SID] ?? [],
  }).flatMap((message) => {
    if (message.kind === 'user') return [`user:${message.content}`];
    if (message.kind === 'assistant_text') return [`assistant:${message.text}`];
    if (message.kind === 'system_notice' && message.variant === 'error') {
      return [`error:${message.text}`];
    }
    return [];
  });

  assert.deepEqual(visible, [
    'user:legacy failing query',
    'assistant:partial legacy answer',
    'error:raw 500',
    'error:Server error (500). Retrying may help.',
    'user:next successful query',
    'assistant:next successful answer',
  ]);
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

test('forked restored history cannot re-enter as live events after canonical hydration', () => {
  const childSessionId = 'child-restored-history';
  const inherited: SessionHistoryItem[] = [
    {
      kind: 'user',
      content: 'original opening query',
      sentAt: FALLBACK_SENT_AT,
      entryId: 'source-user-0',
      canonicalIndex: 0,
      historyTurnIndex: 0,
      turnId: 'source-turn-0',
      turnUserOrdinal: 0,
    },
    {
      kind: 'assistant',
      text: 'original early answer',
      sentAt: FALLBACK_SENT_AT + 100,
      entryId: 'source-assistant-1',
      canonicalIndex: 1,
    },
    {
      kind: 'user',
      content: 'original decision query',
      sentAt: FALLBACK_SENT_AT + 200,
      entryId: 'source-user-2',
      canonicalIndex: 2,
      historyTurnIndex: 2,
      turnId: 'source-turn-2',
      turnUserOrdinal: 0,
    },
    {
      kind: 'assistant',
      text: 'original final recommendation',
      sentAt: FALLBACK_SENT_AT + 300,
      entryId: 'source-assistant-3',
      canonicalIndex: 3,
    },
  ];
  const store = useAppStore.getState();
  store.prependSessionHistory(SID, inherited, FALLBACK_SENT_AT, {
    replaceLoadedWindow: true,
  });
  store.upsertSession({
    sessionId: childSessionId,
    projectRoot: '/proj/x',
    provider: 'mock',
    reasoningMode: 'auto',
    permissionMode: 'accept-edits',
    autoModeEngine: 'llm',
    agentMode: 'ama',
    surface: 'code',
    createdAt: FALLBACK_SENT_AT + 400,
    lastActivityAt: FALLBACK_SENT_AT + 400,
    parentSessionId: SID,
    forkPointTurnIdx: 2,
  });
  store.forkSessionBuffers(SID, childSessionId, 2);

  // The child first paints an optimistic clone of the source renderer buffer. Its canonical
  // transcript then hydrates the same inherited prefix before the first child-only query.
  store.prependSessionHistory(childSessionId, inherited, FALLBACK_SENT_AT + 400, {
    replaceLoadedWindow: true,
  });
  store.appendUserMessage(childSessionId, 'child-only query', FALLBACK_SENT_AT + 500);
  store.appendEvent({
    kind: 'text_delta',
    sessionId: childSessionId,
    text: 'child-only answer',
    sentAt: FALLBACK_SENT_AT + 600,
  });
  store.appendEvent({ kind: 'session_complete', sessionId: childSessionId });

  const state = useAppStore.getState();
  const visible = composeMessages({
    events: state.eventsBySession[childSessionId] ?? [],
    userMessages: state.userMessagesBySession[childSessionId] ?? [],
  }).flatMap((message) => {
    if (message.kind === 'user') return [`user:${message.content}`];
    if (message.kind === 'assistant_text') return [`assistant:${message.text}`];
    return [];
  });
  assert.deepEqual(visible, [
    'user:original opening query',
    'assistant:original early answer',
    'user:original decision query',
    'assistant:original final recommendation',
    'user:child-only query',
    'assistant:child-only answer',
  ]);
  assertClosedTranscriptStructure(childSessionId);
  assert.equal(
    (useAppStore.getState().userMessagesBySession[SID] ?? []).some(
      (message) => message.content === 'child-only query',
    ),
    false,
    'the child-only query must never enter the source renderer buffer',
  );
});

test('an immediate fork query stays after inherited history when hydration resolves later', () => {
  const childSessionId = 'child-query-before-history';
  const inherited: SessionHistoryItem[] = [
    {
      kind: 'user',
      content: 'inherited query',
      sentAt: FALLBACK_SENT_AT,
      entryId: 'inherited-user',
      canonicalIndex: 0,
      historyTurnIndex: 0,
      turnId: 'inherited-turn',
      turnUserOrdinal: 0,
    },
    {
      kind: 'assistant',
      text: 'inherited answer',
      sentAt: FALLBACK_SENT_AT + 100,
      entryId: 'inherited-assistant',
      canonicalIndex: 1,
    },
  ];
  const store = useAppStore.getState();
  store.prependSessionHistory(SID, inherited, FALLBACK_SENT_AT, {
    replaceLoadedWindow: true,
  });
  store.upsertSession({
    sessionId: childSessionId,
    projectRoot: '/proj/x',
    provider: 'mock',
    reasoningMode: 'auto',
    permissionMode: 'accept-edits',
    autoModeEngine: 'llm',
    agentMode: 'ama',
    surface: 'code',
    createdAt: FALLBACK_SENT_AT + 200,
    lastActivityAt: FALLBACK_SENT_AT + 200,
    parentSessionId: SID,
    forkPointTurnIdx: 0,
  });
  store.forkSessionBuffers(SID, childSessionId, 0);
  store.appendUserMessage(childSessionId, 'immediate child query', FALLBACK_SENT_AT + 300);
  store.appendEvent({
    kind: 'text_delta',
    sessionId: childSessionId,
    text: 'immediate child answer',
    sentAt: FALLBACK_SENT_AT + 400,
  });
  store.appendEvent({ kind: 'session_complete', sessionId: childSessionId });

  store.prependSessionHistory(childSessionId, inherited, FALLBACK_SENT_AT + 200, {
    replaceLoadedWindow: true,
  });

  const state = useAppStore.getState();
  const visible = composeMessages({
    events: state.eventsBySession[childSessionId] ?? [],
    userMessages: state.userMessagesBySession[childSessionId] ?? [],
  }).flatMap((message) => {
    if (message.kind === 'user') return [`user:${message.content}`];
    if (message.kind === 'assistant_text') return [`assistant:${message.text}`];
    return [];
  });
  assert.deepEqual(visible, [
    'user:inherited query',
    'assistant:inherited answer',
    'user:immediate child query',
    'assistant:immediate child answer',
  ]);
  assertClosedTranscriptStructure(childSessionId);
});

test('fork classifies a source-live optimistic prefix as inherited child history', () => {
  const childSessionId = 'child-source-live-prefix';
  const store = useAppStore.getState();
  store.appendUserMessage(SID, 'source live query', FALLBACK_SENT_AT);
  store.appendEvent({
    kind: 'text_delta',
    sessionId: SID,
    text: 'source live answer',
    sentAt: FALLBACK_SENT_AT + 100,
  });
  store.appendEvent({ kind: 'session_complete', sessionId: SID });
  store.upsertSession({
    sessionId: childSessionId,
    projectRoot: '/proj/x',
    provider: 'mock',
    reasoningMode: 'auto',
    permissionMode: 'accept-edits',
    autoModeEngine: 'llm',
    agentMode: 'ama',
    surface: 'code',
    createdAt: FALLBACK_SENT_AT + 200,
    lastActivityAt: FALLBACK_SENT_AT + 200,
    parentSessionId: SID,
    forkPointTurnIdx: 0,
  });
  store.forkSessionBuffers(SID, childSessionId, 0);

  // The persisted child prefix may have no strong turn identity on compatibility paths. It must
  // replace the optimistic source-live clone instead of depending on identity folding to dedupe it.
  store.prependSessionHistory(
    childSessionId,
    [
      {
        kind: 'user',
        content: 'source live query',
        sentAt: FALLBACK_SENT_AT,
        entryId: 'child-source-live-user',
        canonicalIndex: 0,
        historyTurnIndex: 0,
        turnUserOrdinal: 0,
      },
      {
        kind: 'assistant',
        text: 'source live answer',
        sentAt: FALLBACK_SENT_AT + 100,
        entryId: 'child-source-live-assistant',
        canonicalIndex: 1,
      },
    ],
    FALLBACK_SENT_AT + 200,
    { replaceLoadedWindow: true },
  );

  const state = useAppStore.getState();
  const visible = composeMessages({
    events: state.eventsBySession[childSessionId] ?? [],
    userMessages: state.userMessagesBySession[childSessionId] ?? [],
  }).flatMap((message) => {
    if (message.kind === 'user') return [`user:${message.content}`];
    if (message.kind === 'assistant_text') return [`assistant:${message.text}`];
    return [];
  });
  assert.deepEqual(visible, ['user:source live query', 'assistant:source live answer']);
  assertClosedTranscriptStructure(childSessionId);
});

test('fork keeps a mixed restored and source-live prefix single after child hydration', () => {
  const childSessionId = 'child-mixed-prefix';
  const restoredPrefix: SessionHistoryItem[] = [
    {
      kind: 'user',
      content: 'restored source query',
      sentAt: FALLBACK_SENT_AT,
      entryId: 'restored-source-user',
      canonicalIndex: 0,
      historyTurnIndex: 0,
      turnId: 'restored-source-turn',
      turnUserOrdinal: 0,
    },
    {
      kind: 'assistant',
      text: 'restored source answer',
      sentAt: FALLBACK_SENT_AT + 100,
      entryId: 'restored-source-assistant',
      canonicalIndex: 1,
    },
  ];
  const store = useAppStore.getState();
  store.prependSessionHistory(SID, restoredPrefix, FALLBACK_SENT_AT, {
    replaceLoadedWindow: true,
  });
  store.appendUserMessage(SID, 'new source query', FALLBACK_SENT_AT + 200);
  store.appendEvent({
    kind: 'text_delta',
    sessionId: SID,
    text: 'new source answer',
    sentAt: FALLBACK_SENT_AT + 300,
  });
  store.appendEvent({ kind: 'session_complete', sessionId: SID });
  store.upsertSession({
    sessionId: childSessionId,
    projectRoot: '/proj/x',
    provider: 'mock',
    reasoningMode: 'auto',
    permissionMode: 'accept-edits',
    autoModeEngine: 'llm',
    agentMode: 'ama',
    surface: 'code',
    createdAt: FALLBACK_SENT_AT + 400,
    lastActivityAt: FALLBACK_SENT_AT + 400,
    parentSessionId: SID,
    forkPointTurnIdx: 1,
  });
  store.forkSessionBuffers(SID, childSessionId, 1);
  store.prependSessionHistory(
    childSessionId,
    [
      ...restoredPrefix,
      {
        kind: 'user',
        content: 'new source query',
        sentAt: FALLBACK_SENT_AT + 200,
        entryId: 'child-new-source-user',
        canonicalIndex: 2,
        historyTurnIndex: 1,
        turnUserOrdinal: 0,
      },
      {
        kind: 'assistant',
        text: 'new source answer',
        sentAt: FALLBACK_SENT_AT + 300,
        entryId: 'child-new-source-assistant',
        canonicalIndex: 3,
      },
    ],
    FALLBACK_SENT_AT + 400,
    { replaceLoadedWindow: true },
  );

  const state = useAppStore.getState();
  const visible = composeMessages({
    events: state.eventsBySession[childSessionId] ?? [],
    userMessages: state.userMessagesBySession[childSessionId] ?? [],
  }).flatMap((message) => {
    if (message.kind === 'user') return [`user:${message.content}`];
    if (message.kind === 'assistant_text') return [`assistant:${message.text}`];
    return [];
  });
  assert.deepEqual(visible, [
    'user:restored source query',
    'assistant:restored source answer',
    'user:new source query',
    'assistant:new source answer',
  ]);
  assertClosedTranscriptStructure(childSessionId);
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
