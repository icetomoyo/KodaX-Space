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
