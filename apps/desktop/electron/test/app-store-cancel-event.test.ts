import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import type {
  SessionHistoryItem,
  SessionMeta,
  WorkflowEventPayload,
} from '@kodax-space/space-ipc-schema';
import { useAppStore } from '../../renderer/src/store/appStore.js';
import { snapshotFromEvents } from '../../renderer/src/shell/ActivitySpinner.js';

const SID = 's_cancel_dedupe';

const session: SessionMeta = {
  sessionId: SID,
  projectRoot: '/proj/x',
  provider: 'mock',
  reasoningMode: 'auto',
  permissionMode: 'accept-edits',
  autoModeEngine: 'llm',
  agentMode: 'ama',
  surface: 'code',
  createdAt: 1700000000000,
  lastActivityAt: 1700000000000,
};

beforeEach(() => {
  useAppStore.setState({
    sessions: [session],
    currentSessionId: SID,
    eventsBySession: {},
    pendingSendBySession: { [SID]: true },
    userMessagesBySession: {},
    queuedUserMessagesBySession: {},
    localNoticesBySession: {},
    notifications: [],
    workflowRuns: {},
    workflowNoticesBySession: {},
  });
});

test('appendEvent clears pending send and dedupes repeated cancelled terminal events', () => {
  const store = useAppStore.getState();
  store.appendEvent({
    kind: 'session_error',
    sessionId: SID,
    error: 'cancelled',
    category: 'cancelled',
    retriable: true,
  });
  store.appendEvent({
    kind: 'session_error',
    sessionId: SID,
    error: 'cancelled',
    category: 'cancelled',
    retriable: true,
  });

  const state = useAppStore.getState();
  const events = state.eventsBySession[SID] ?? [];
  assert.equal(events.length, 1);
  assert.equal(events[0]?.kind, 'session_error');
  assert.equal(state.pendingSendBySession[SID], undefined);
});

test('appendEvent keeps pendingSend across a pre-session_start non-lifecycle event (spinner stays up)', () => {
  // Regression: repo-intelligence (repointel_trace) / managed_task_status can arrive BEFORE
  // session_start on a session's first query. pendingSend must NOT be cleared by such events, or the
  // activity spinner vanishes (bubble shown, no "doing something" indicator) until session_start.
  const store = useAppStore.getState();
  store.appendEvent({ kind: 'repointel_trace', sessionId: SID, event: { kind: 'started' } });

  let state = useAppStore.getState();
  assert.equal(
    state.pendingSendBySession[SID],
    true,
    'a pre-session_start non-lifecycle event must not clear pendingSend',
  );
  // Spinner recognizer still reports streaming ("Sending…") via the pending fallback.
  const snap = snapshotFromEvents(
    state.eventsBySession[SID] ?? [],
    Boolean(state.pendingSendBySession[SID]),
    undefined,
  );
  assert.equal(
    snap.streaming,
    true,
    'spinner must stay visible while pending, even with events present',
  );

  // session_start finally arrives → hands off to event-driven streaming AND clears pendingSend.
  store.appendEvent({ kind: 'session_start', sessionId: SID, provider: 'mock' });
  state = useAppStore.getState();
  assert.equal(state.pendingSendBySession[SID], undefined, 'session_start clears pendingSend');
  const snap2 = snapshotFromEvents(state.eventsBySession[SID] ?? [], false, undefined);
  assert.equal(snap2.streaming, true, 'still streaming after session_start (no gap)');
});

test('appendEvent still clears pendingSend on a terminal event even if only non-lifecycle events preceded it (no stuck spinner)', () => {
  // Guards the flip-side of the fix above: if a run fails/ends right after a non-lifecycle event
  // (no session_start ever arrived), the terminal event must still clear pendingSend so the spinner
  // doesn't get stuck on "Sending…".
  const store = useAppStore.getState();
  store.appendEvent({ kind: 'repointel_trace', sessionId: SID, event: { kind: 'started' } });
  assert.equal(useAppStore.getState().pendingSendBySession[SID], true);
  store.appendEvent({ kind: 'session_error', sessionId: SID, error: 'boom' });
  assert.equal(
    useAppStore.getState().pendingSendBySession[SID],
    undefined,
    'terminal clears pendingSend',
  );
});

test('appendEvent accepts a later cancelled event after a new session_start', () => {
  const store = useAppStore.getState();
  store.appendEvent({ kind: 'session_error', sessionId: SID, error: 'cancelled' });
  store.appendEvent({ kind: 'session_start', sessionId: SID, provider: 'mock' });
  store.appendEvent({ kind: 'session_error', sessionId: SID, error: 'cancelled' });

  const events = useAppStore.getState().eventsBySession[SID] ?? [];
  assert.deepEqual(
    events.map((event) => event.kind),
    ['session_error', 'session_start', 'session_error'],
  );
});

test('appendEvent coalesces adjacent stream deltas without crossing event boundaries', () => {
  const store = useAppStore.getState();
  const beforeFirstDelta = Date.now();
  store.appendEvent({ kind: 'text_delta', sessionId: SID, text: 'Hel' });
  const firstTextEvent = useAppStore.getState().eventsBySession[SID]?.[0];
  const firstTextSentAt = firstTextEvent?.kind === 'text_delta' ? firstTextEvent.sentAt : undefined;
  assert.ok(
    firstTextSentAt !== undefined && firstTextSentAt >= beforeFirstDelta,
    'the first live delta is stamped once when it enters the renderer store',
  );
  store.appendEvent({
    kind: 'text_delta',
    sessionId: SID,
    text: 'lo',
    sentAt: firstTextSentAt + 60_000,
  });
  store.appendEvent({ kind: 'thinking_delta', sessionId: SID, text: 'Plan ' });
  store.appendEvent({ kind: 'thinking_delta', sessionId: SID, text: 'A' });
  store.appendEvent({
    kind: 'tool_start',
    sessionId: SID,
    toolId: 'tool_1',
    toolName: 'read',
    input: { path: 'README.md' },
  });
  store.appendEvent({ kind: 'text_delta', sessionId: SID, text: 'Done' });

  const events = useAppStore.getState().eventsBySession[SID] ?? [];
  assert.deepEqual(
    events.map((event) => event.kind),
    ['text_delta', 'thinking_delta', 'tool_start', 'text_delta'],
  );
  assert.equal(events[0]?.kind === 'text_delta' ? events[0].text : undefined, 'Hello');
  assert.equal(
    events[0]?.kind === 'text_delta' ? events[0].sentAt : undefined,
    firstTextSentAt,
    'coalescing preserves the first delta timestamp instead of moving it per chunk',
  );
  assert.equal(events[1]?.kind === 'thinking_delta' ? events[1].text : undefined, 'Plan A');
  assert.equal(
    events[1]?.kind === 'thinking_delta' && Number.isFinite(events[1].sentAt),
    true,
    'thinking blocks receive the same renderer arrival-time contract',
  );
  assert.equal(events[3]?.kind === 'text_delta' ? events[3].text : undefined, 'Done');
});

test('mid_turn_user_prompt promotes a pending interrupt queued message', () => {
  const store = useAppStore.getState();
  const localId = store.appendQueuedUserMessage(SID, {
    content: 'q2',
    queueMode: 'interrupt',
  });
  assert.ok(localId);

  store.appendEvent({ kind: 'mid_turn_user_prompt', sessionId: SID, content: 'q2' });

  const state = useAppStore.getState();
  assert.equal(state.queuedUserMessagesBySession[SID]?.length ?? 0, 0);
  assert.equal(state.userMessagesBySession[SID]?.at(-1)?.content, 'q2');
});

test('queued_user_prompt_started promotes a pending after-turn queued message', () => {
  const store = useAppStore.getState();
  const localId = store.appendQueuedUserMessage(SID, {
    content: 'q2',
    queueMode: 'after-turn',
  });
  assert.ok(localId);

  store.appendEvent({
    kind: 'queued_user_prompt_started',
    sessionId: SID,
    queueMode: 'after-turn',
    content: 'q2',
  });

  const state = useAppStore.getState();
  assert.equal(state.queuedUserMessagesBySession[SID]?.length ?? 0, 0);
  assert.equal(state.userMessagesBySession[SID]?.at(-1)?.content, 'q2');
});

test('convertLastUserMessageToQueued replaces a normal optimistic bubble after queued ack', () => {
  const store = useAppStore.getState();
  store.appendUserMessage(SID, 'q2', 1234);

  const localId = store.convertLastUserMessageToQueued(SID, 'q2', {
    content: 'q2',
    matchContent: 'resolved q2',
    queueMode: 'interrupt',
  });

  const state = useAppStore.getState();
  assert.ok(localId);
  assert.equal(state.userMessagesBySession[SID]?.length ?? 0, 0);
  const queued = state.queuedUserMessagesBySession[SID]?.[0];
  assert.equal(queued?.id, localId);
  assert.equal(queued?.content, 'q2');
  assert.equal(queued?.matchContent, 'resolved q2');
  assert.equal(queued?.queueMode, 'interrupt');
  assert.equal(queued?.status, 'queued');
  assert.equal(queued?.sentAt, 1234);
});

test('queued acknowledgement replaces an optimistic interrupt mode with after-turn', () => {
  const store = useAppStore.getState();
  const localId = store.appendQueuedUserMessage(SID, {
    content: 'follow-up after restart',
    queueMode: 'interrupt',
  });
  assert.ok(localId);

  store.markQueuedUserMessageAccepted(SID, localId, 'run_follow_up', 'after-turn');

  const queued = useAppStore.getState().queuedUserMessagesBySession[SID]?.[0];
  assert.equal(queued?.queueId, 'run_follow_up');
  assert.equal(queued?.queueMode, 'after-turn');
  assert.equal(queued?.status, 'queued');
});

test('appendLocalNotice stores slash/info output outside real user turns', () => {
  const store = useAppStore.getState();
  store.appendUserMessage(SID, 'real question', 1000);
  store.appendLocalNotice(SID, '/info runtime', 1001);
  store.appendLocalNotice(SID, '[info] runtime ok', 1002);

  const state = useAppStore.getState();
  assert.equal(state.userMessagesBySession[SID]?.length ?? 0, 1);
  assert.equal(state.userMessagesBySession[SID]?.[0]?.content, 'real question');
  assert.deepEqual(
    (state.localNoticesBySession[SID] ?? []).map((notice) => notice.content),
    ['/info runtime', '[info] runtime ok'],
  );
  assert.deepEqual(
    (state.localNoticesBySession[SID] ?? []).map((notice) => notice.variant),
    ['echo', 'output'],
  );
});

test('prependSessionHistory restores local notices outside real user turns', () => {
  useAppStore.setState({
    userMessagesBySession: {},
    localNoticesBySession: {},
    eventsBySession: {},
  });
  const items: SessionHistoryItem[] = [
    {
      kind: 'local_notice',
      id: 'ln_hist_echo',
      content: '/repointel status',
      sentAt: 1001,
      variant: 'echo',
    },
    {
      kind: 'local_notice',
      id: 'ln_hist_out',
      content: '[repointel] status: ok',
      sentAt: 1002,
      variant: 'output',
    },
  ];

  useAppStore.getState().prependSessionHistory(SID, items, 999);

  const state = useAppStore.getState();
  assert.equal(state.userMessagesBySession[SID]?.length ?? 0, 0);
  assert.equal(state.eventsBySession[SID]?.length ?? 0, 0);
  assert.deepEqual(
    (state.localNoticesBySession[SID] ?? []).map((notice) => ({
      content: notice.content,
      variant: notice.variant,
    })),
    [
      { content: '/repointel status', variant: 'echo' },
      { content: '[repointel] status: ok', variant: 'output' },
    ],
  );
});

test('appendLocalNotice keeps generated ids within the IPC schema bound', () => {
  const longSid = `s_${'x'.repeat(126)}`;
  useAppStore.setState({
    sessions: [{ ...session, sessionId: longSid }],
    currentSessionId: longSid,
    userMessagesBySession: {},
    localNoticesBySession: {},
    eventsBySession: {},
  });

  useAppStore.getState().appendLocalNotice(longSid, '/status', 1234);

  const notice = useAppStore.getState().localNoticesBySession[longSid]?.[0];
  assert.ok(notice);
  assert.ok(notice.id.length <= 128);
});

test('rewindSessionBuffers truncates local notices by true user turn timestamp', () => {
  useAppStore.setState({
    userMessagesBySession: {
      [SID]: [
        { id: 'u1', content: 'first turn', sentAt: 1000 },
        { id: 'u2', content: 'second turn', sentAt: 2000 },
      ],
    },
    localNoticesBySession: {
      [SID]: [
        { id: 'ln1', content: '/info', sentAt: 1500 },
        { id: 'ln2', content: '[info] late', sentAt: 2500 },
      ],
    },
    eventsBySession: {
      [SID]: [
        { kind: 'text_delta', sessionId: SID, text: 'first answer' },
        { kind: 'session_complete', sessionId: SID },
        { kind: 'text_delta', sessionId: SID, text: 'second answer' },
        { kind: 'session_complete', sessionId: SID },
      ],
    },
  });

  useAppStore.getState().rewindSessionBuffers(SID, 0);

  const state = useAppStore.getState();
  assert.deepEqual(
    (state.userMessagesBySession[SID] ?? []).map((msg) => msg.content),
    ['first turn'],
  );
  assert.deepEqual(
    (state.localNoticesBySession[SID] ?? []).map((notice) => notice.content),
    ['/info'],
  );
  assert.deepEqual(
    (state.eventsBySession[SID] ?? []).map((event) => event.kind),
    ['text_delta', 'session_complete'],
  );
});

test('forkSessionBuffers copies local notices without adding user turns', () => {
  useAppStore.setState({
    userMessagesBySession: {
      [SID]: [{ id: 'u1', content: 'real turn', sentAt: 1000 }],
    },
    localNoticesBySession: {
      [SID]: [
        { id: 'ln1', content: '/history', sentAt: 1001 },
        { id: 'ln2', content: '[history] 1 user message(s)', sentAt: 1002 },
      ],
    },
    eventsBySession: {
      [SID]: [
        { kind: 'text_delta', sessionId: SID, text: 'answer' },
        { kind: 'session_complete', sessionId: SID },
      ],
    },
  });

  useAppStore.getState().forkSessionBuffers(SID, 'child-session', 0);

  const state = useAppStore.getState();
  assert.equal(state.userMessagesBySession['child-session']?.length ?? 0, 1);
  assert.deepEqual(
    (state.localNoticesBySession['child-session'] ?? []).map((notice) => notice.content),
    ['/history', '[history] 1 user message(s)'],
  );
  assert.deepEqual(
    (state.eventsBySession['child-session'] ?? []).map((event) => event.sessionId),
    ['child-session', 'child-session'],
  );
});

test('appendEvent turns todo drift warnings into session notifications', () => {
  const store = useAppStore.getState();
  store.appendEvent({
    kind: 'todo_drift_warning',
    sessionId: SID,
    warning: {
      kind: 'work_started_without_claimed_todo',
      toolName: 'write',
      toolCallId: 'tool_1',
      count: 1,
      pendingCount: 2,
      openCount: 2,
      firstPendingTodoId: 'todo_1',
      firstPendingTodoSubject: 'Update tests',
    },
  });

  const state = useAppStore.getState();
  const events = state.eventsBySession[SID] ?? [];
  assert.equal(events.length, 1);
  assert.equal(events[0]?.kind, 'todo_drift_warning');
  assert.equal(state.notifications.length, 1);
  assert.equal(state.notifications[0]?.severity, 'info');
  assert.equal(state.notifications[0]?.sessionId, SID);
  assert.equal(state.notifications[0]?.dismissOnOutsideInteraction, true);
  assert.match(state.notifications[0]?.text ?? '', /Todo list drift detected/);
  assert.match(state.notifications[0]?.text ?? '', /Update tests/);
});

test('appendEvent coalesces repeated todo drift warnings for a session', () => {
  useAppStore.setState({
    notifications: [
      {
        id: `todo-drift:${SID}:1:tool_old`,
        severity: 'info',
        text: 'legacy drift notice',
        sessionId: SID,
        createdAt: 1,
      },
    ],
  });
  const store = useAppStore.getState();
  store.appendEvent({
    kind: 'todo_drift_warning',
    sessionId: SID,
    warning: {
      kind: 'work_started_without_claimed_todo',
      toolName: 'read',
      toolCallId: 'tool_1',
      count: 1,
      pendingCount: 6,
      openCount: 6,
      firstPendingTodoId: 'todo_1',
      firstPendingTodoSubject: 'Review runtime changes',
    },
  });
  store.appendEvent({
    kind: 'todo_drift_warning',
    sessionId: SID,
    warning: {
      kind: 'work_started_without_claimed_todo',
      toolName: 'grep',
      toolCallId: 'tool_2',
      count: 2,
      pendingCount: 6,
      openCount: 6,
      firstPendingTodoId: 'todo_1',
      firstPendingTodoSubject: 'Review runtime changes',
    },
  });

  const state = useAppStore.getState();
  assert.equal((state.eventsBySession[SID] ?? []).length, 2);
  assert.equal(state.notifications.length, 1);
  assert.equal(state.notifications[0]?.id, `todo-drift:${SID}`);
  assert.match(state.notifications[0]?.text ?? '', /grep/);
});

test('upsertWorkflowRun exposes workflow event message as latest live message', () => {
  const store = useAppStore.getState();
  const payload: WorkflowEventPayload = {
    type: 'workflow_updated',
    sessionId: SID,
    surface: 'code',
    message: 'agent spawned: impact reviewer',
    snapshot: {
      runId: 'wf_live',
      workflowName: 'review',
      status: 'running',
      startedAt: '2026-06-21T00:00:00.000Z',
      updatedAt: '2026-06-21T00:00:05.000Z',
      items: [],
      counts: { pending: 0, running: 0, completed: 0, failed: 0, cancelled: 0, skipped: 0 },
      progress: {
        spawnedAgents: 1,
        finishedAgents: 0,
        activeAgents: 1,
        failedAgents: 0,
        stoppedAgents: 0,
      },
      latestMessage: 'stale snapshot message',
    },
  };

  store.upsertWorkflowRun(payload);

  const run = useAppStore.getState().workflowRuns.wf_live;
  assert.equal(run?.sessionId, SID);
  assert.equal(run?.surface, 'code');
  assert.equal(run?.latestMessage, 'agent spawned: impact reviewer');
});

test('removeWorkflowRun drops the run and its activity so a deleted run leaves the sidebar', () => {
  // Regression: workflow.delete succeeded on the main side but the renderer never removed the run —
  // seedWorkflowRuns is an additive covering merge and delete emits no push event, so the deleted
  // run stayed visible in the left sidebar / panels until app restart ("点删除删不掉").
  useAppStore.setState({
    workflowRuns: {
      wf_gone: {
        runId: 'wf_gone',
        workflowName: 'review',
        status: 'completed',
        startedAt: '2026-06-21T00:00:00.000Z',
        updatedAt: '2026-06-21T00:01:00.000Z',
        sessionId: SID,
        surface: 'code',
        items: [],
        counts: { pending: 0, running: 0, completed: 0, failed: 0, cancelled: 0, skipped: 0 },
        progress: {
          spawnedAgents: 0,
          finishedAgents: 0,
          activeAgents: 0,
          failedAgents: 0,
          stoppedAgents: 0,
        },
      },
      wf_keep: {
        runId: 'wf_keep',
        workflowName: 'audit',
        status: 'running',
        startedAt: '2026-06-21T00:00:00.000Z',
        updatedAt: '2026-06-21T00:02:00.000Z',
        sessionId: SID,
        surface: 'code',
        items: [],
        counts: { pending: 0, running: 1, completed: 0, failed: 0, cancelled: 0, skipped: 0 },
        progress: {
          spawnedAgents: 1,
          finishedAgents: 0,
          activeAgents: 1,
          failedAgents: 0,
          stoppedAgents: 0,
        },
      },
    },
    workflowActivityByRun: { wf_gone: [], wf_keep: [] },
  });

  useAppStore.getState().removeWorkflowRun('wf_gone');

  const state = useAppStore.getState();
  assert.equal(state.workflowRuns.wf_gone, undefined, 'deleted run is gone from store');
  assert.ok(state.workflowRuns.wf_keep, 'other runs are untouched');
  assert.equal(state.workflowActivityByRun.wf_gone, undefined, 'deleted run activity is purged');
  assert.ok('wf_keep' in state.workflowActivityByRun, 'other activity is untouched');

  // Removing an unknown run is a no-op that keeps referential identity (no needless re-render).
  const before = useAppStore.getState().workflowRuns;
  useAppStore.getState().removeWorkflowRun('wf_missing');
  assert.equal(useAppStore.getState().workflowRuns, before, 'unknown runId is a no-op');
});

test('appendWorkflowNotice keeps notices for current session before session list catches up', () => {
  useAppStore.setState({
    sessions: [],
    currentSessionId: SID,
    workflowNoticesBySession: {},
  });

  useAppStore.getState().appendWorkflowNotice(SID, '[workflow] agent spawned: reviewer');

  const notices = useAppStore.getState().workflowNoticesBySession[SID] ?? [];
  assert.equal(notices.length, 1);
  assert.equal(notices[0]?.content, '[workflow] agent spawned: reviewer');
});

test('appendWorkflowNotice keeps restored workflow notices before session list catches up', () => {
  useAppStore.setState({
    sessions: [],
    currentSessionId: null,
    workflowRuns: {
      wf_restored: {
        runId: 'wf_restored',
        workflowName: 'review',
        status: 'completed',
        startedAt: '2026-06-21T00:00:00.000Z',
        updatedAt: '2026-06-21T00:01:00.000Z',
        sessionId: SID,
        surface: 'code',
        items: [],
        counts: { pending: 0, running: 0, completed: 0, failed: 0, cancelled: 0, skipped: 0 },
        progress: {
          spawnedAgents: 0,
          finishedAgents: 0,
          activeAgents: 0,
          failedAgents: 0,
          stoppedAgents: 0,
        },
      },
    },
    workflowNoticesBySession: {},
  });

  useAppStore
    .getState()
    .appendWorkflowNotice(
      SID,
      '[workflow] completed: review',
      Date.parse('2026-06-21T00:01:00.000Z'),
    );

  const notices = useAppStore.getState().workflowNoticesBySession[SID] ?? [];
  assert.equal(notices.length, 1);
  assert.equal(notices[0]?.content, '[workflow] completed: review');
  assert.equal(notices[0]?.sentAt, Date.parse('2026-06-21T00:01:00.000Z'));
});

test('appendWorkflowNotice keeps one notice per key and replaces its content in place', () => {
  // Regression: an agent's summary evolves (excerpt → result), and workflow events replay
  // on restore/hot-reload. With a per-(status,body) key each evolution became a NEW notice,
  // so the same agent's summary showed up 2×+ (user report). Dedup now lives in the store
  // keyed on a stable per-agent key, and re-emission REPLACES the content in place.
  useAppStore.setState({ sessions: [], currentSessionId: SID, workflowNoticesBySession: {} });
  const store = useAppStore.getState();
  const KEY = 'item:run1:a1'; // stable per (run, item), independent of status/body

  store.appendWorkflowNotice(SID, '[workflow] agent summary excerpt: R\npartial', 1000, KEY);
  // Same content re-emitted → no-op.
  store.appendWorkflowNotice(SID, '[workflow] agent summary excerpt: R\npartial', 1000, KEY);
  // Evolved content, same key → replaced in place (still one notice, latest content, same id).
  store.appendWorkflowNotice(SID, '[workflow] agent summary: R\nfinal body', 9999, KEY);
  // Different agent → distinct notice:
  store.appendWorkflowNotice(SID, '[workflow] agent summary: R2', 1001, 'item:run1:a2');
  // Keyless callers keep append-always semantics:
  store.appendWorkflowNotice(SID, '[workflow] agent spawned: reviewer');

  const notices = useAppStore.getState().workflowNoticesBySession[SID] ?? [];
  assert.equal(notices.length, 3);
  const keyed = notices.filter((n) => n.key === KEY);
  assert.equal(keyed.length, 1);
  assert.equal(keyed[0]?.content, '[workflow] agent summary: R\nfinal body');
  // Position/timestamp preserved from first insert (replace is in place, not re-appended).
  assert.equal(keyed[0]?.sentAt, 1000);
  assert.equal(notices[0]?.key, KEY);
});

test('appendEvent keeps keyed workflow_notice in event stream and replaces it in place', () => {
  useAppStore.setState({ sessions: [], currentSessionId: SID, eventsBySession: {} });
  const store = useAppStore.getState();
  const key = 'finished:run-mr72zyw7:completed';

  store.appendEvent({
    kind: 'workflow_notice',
    sessionId: SID,
    text: '[workflow] completed: draft',
    key,
    sentAt: 1000,
  });
  store.appendEvent({
    kind: 'workflow_notice',
    sessionId: SID,
    text: '[workflow] completed: final',
    key,
    sentAt: 2000,
  });
  store.appendEvent({
    kind: 'workflow_notice',
    sessionId: SID,
    text: '[workflow] completed: other run',
    key: 'finished:other:completed',
    sentAt: 3000,
  });

  const events = useAppStore.getState().eventsBySession[SID] ?? [];
  assert.equal(events.length, 2);
  assert.equal(events[0]?.kind, 'workflow_notice');
  if (events[0]?.kind === 'workflow_notice') {
    assert.equal(events[0].text, '[workflow] completed: final');
    assert.equal(events[0].sentAt, 1000);
  }
  assert.equal(events[1]?.kind, 'workflow_notice');
});
