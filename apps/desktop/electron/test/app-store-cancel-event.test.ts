import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import type {
  SessionHistoryItem,
  SessionMeta,
  WorkflowEventPayload,
} from '@kodax-space/space-ipc-schema';
import { useAppStore } from '../../renderer/src/store/appStore.js';
import { useToastStore } from '../../renderer/src/store/toastStore.js';
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
  useToastStore.getState().clear();
  useAppStore.setState({
    sessions: [session],
    currentSessionId: SID,
    eventsBySession: {},
    pendingSendBySession: { [SID]: true },
    pendingSendRuntimeBaselineBySession: {},
    userMessagesBySession: {},
    queuedUserMessagesBySession: {},
    localNoticesBySession: {},
    tokensBySession: {},
    sessionTokenUsageBySession: {},
    contextBudgetBySession: {},
    providerCacheDiagnosticBySession: {},
    notifications: [],
    workflowRuns: {},
    workflowNoticesBySession: {},
  });
});

test('user image attachments update after send acknowledgement and restore from history', () => {
  const optimisticId = useAppStore.getState().appendUserMessage(SID, 'inspect', 1000, [
    {
      id: 'optimistic-image',
      kind: 'image',
      mediaType: 'image/png',
      label: 'pasted.png',
      status: 'available',
      thumbnailUrl: 'data:image/png;base64,AA==',
      previewUrl: 'data:image/png;base64,AA==',
    },
  ]);
  assert.ok(optimisticId);
  const token = 'a'.repeat(32);
  useAppStore.getState().updateUserMessageAttachments(SID, optimisticId, [
    {
      id: 'durable-image',
      kind: 'image',
      mediaType: 'image/png',
      status: 'available',
      thumbnailUrl: `app://space/session-attachment/${token}?variant=thumbnail`,
      previewUrl: `app://space/session-attachment/${token}?variant=original`,
    },
  ]);
  const liveAttachment = useAppStore.getState().userMessagesBySession[SID]?.[0]?.attachments?.[0];
  assert.equal(liveAttachment?.id, 'durable-image');
  assert.equal(liveAttachment?.label, 'pasted.png', 'optimistic label survives capability swap');

  useAppStore.setState({ userMessagesBySession: {} });
  useAppStore.getState().prependSessionHistory(
    SID,
    [
      {
        kind: 'user',
        content: 'restored',
        attachments: [
          {
            id: 'restored-image',
            kind: 'image',
            mediaType: 'image/jpeg',
            status: 'missing',
          },
        ],
      },
    ],
    2000,
  );
  assert.equal(
    useAppStore.getState().userMessagesBySession[SID]?.[0]?.attachments?.[0]?.status,
    'missing',
  );
});

test('appendEvent dedupes cancelled terminals without clearing an unscoped pending admission', () => {
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
  assert.equal(state.pendingSendBySession[SID], true);
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

test('a delivered mid-turn prompt clears pendingSend and hands activity to Runtime state', () => {
  const store = useAppStore.getState();

  store.appendEvent({
    kind: 'mid_turn_user_prompt',
    sessionId: SID,
    queueId: 'input_delivered',
    content: 'correct the queued instruction',
  });

  const state = useAppStore.getState();
  assert.equal(
    state.pendingSendBySession[SID],
    undefined,
    'canonical interrupt delivery must clear the optimistic pending marker',
  );
  assert.equal(
    snapshotFromEvents(state.eventsBySession[SID] ?? [], false, undefined).streaming,
    true,
    'the delivered prompt lifecycle keeps activity visible while Runtime remains active',
  );
});

test('an unscoped terminal after telemetry cannot clear a pending admission before its ACK', () => {
  // An accepted no-Run IPC result clears this compatibility pending state in BottomBar. Until that
  // ACK arrives, an identity-less terminal can belong to the previous Run and must fail closed.
  const store = useAppStore.getState();
  store.appendEvent({ kind: 'repointel_trace', sessionId: SID, event: { kind: 'started' } });
  assert.equal(useAppStore.getState().pendingSendBySession[SID], true);
  store.appendEvent({ kind: 'session_error', sessionId: SID, error: 'boom' });
  assert.equal(
    useAppStore.getState().pendingSendBySession[SID],
    true,
    'an unscoped terminal cannot clear pendingSend before admission is acknowledged',
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

  store.appendEvent({
    kind: 'mid_turn_user_prompt',
    sessionId: SID,
    content: 'q2',
    entryId: 'entry-q2',
  });

  const state = useAppStore.getState();
  assert.equal(state.queuedUserMessagesBySession[SID]?.length ?? 0, 0);
  assert.equal(state.userMessagesBySession[SID]?.at(-1)?.content, 'q2');
  assert.equal(state.userMessagesBySession[SID]?.at(-1)?.entryId, 'entry-q2');
});

test('mid_turn_user_prompt consumes the matching queue id without rendering its host overlay', () => {
  const store = useAppStore.getState();
  const firstId = store.appendQueuedUserMessage(SID, {
    content: 'review the document',
    queueMode: 'interrupt',
  });
  const secondId = store.appendQueuedUserMessage(SID, {
    content: 'review the document',
    queueMode: 'interrupt',
  });
  assert.ok(firstId);
  assert.ok(secondId);
  store.markQueuedUserMessageAccepted(SID, firstId, 'input-1', 'interrupt');
  store.markQueuedUserMessageAccepted(SID, secondId, 'input-2', 'interrupt');

  store.appendEvent({
    kind: 'mid_turn_user_prompt',
    sessionId: SID,
    queueId: 'input-2',
    content: 'review the document\n\n<attachment-paths>internal</attachment-paths>',
  });

  const state = useAppStore.getState();
  assert.deepEqual(
    (state.queuedUserMessagesBySession[SID] ?? []).map((entry) => entry.queueId),
    ['input-1'],
  );
  assert.equal(state.userMessagesBySession[SID]?.at(-1)?.content, 'review the document');
});

test('distinct delivered inputs sharing one Runtime sequence remain distinct boundaries', () => {
  const store = useAppStore.getState();
  store.appendEvent({
    kind: 'mid_turn_user_prompt',
    sessionId: SID,
    queueId: 'input-1',
    content: 'first correction',
    turnId: 'turn-1',
    turnUserOrdinal: 1,
    runtimeEvent: { runtimeId: 'rt-1', runId: 'run-1', seq: 9 },
  });
  store.appendEvent({
    kind: 'mid_turn_user_prompt',
    sessionId: SID,
    queueId: 'input-2',
    content: 'second correction',
    turnId: 'turn-1',
    turnUserOrdinal: 2,
    runtimeEvent: { runtimeId: 'rt-1', runId: 'run-1', seq: 9 },
  });

  const delivered = (useAppStore.getState().eventsBySession[SID] ?? []).filter(
    (event) => event.kind === 'mid_turn_user_prompt',
  );
  assert.deepEqual(
    delivered.map((event) => ({ queueId: event.queueId, ordinal: event.turnUserOrdinal })),
    [
      { queueId: 'input-1', ordinal: 1 },
      { queueId: 'input-2', ordinal: 2 },
    ],
  );
});

test('mid_turn_user_prompt matches a host-overlay suffix when delivery wins the ack race', () => {
  const store = useAppStore.getState();
  const localId = store.appendQueuedUserMessage(SID, {
    content: 'review the document',
    queueMode: 'interrupt',
  });
  assert.ok(localId);

  store.appendEvent({
    kind: 'mid_turn_user_prompt',
    sessionId: SID,
    queueId: 'input-before-ack',
    content: 'review the document\n\n<attachment-paths>internal</attachment-paths>',
  });

  let state = useAppStore.getState();
  assert.equal(state.queuedUserMessagesBySession[SID]?.length ?? 0, 0);
  assert.equal(state.userMessagesBySession[SID]?.at(-1)?.content, 'review the document');

  store.appendEvent({ kind: 'session_complete', sessionId: SID });
  state = useAppStore.getState();
  assert.equal(
    state.queuedUserMessagesBySession[SID]?.length ?? 0,
    0,
    'the consumed overlay stays gone after the run completes',
  );
});

test('queued interrupt terminal event fails only its public queue id and survives session completion', () => {
  const store = useAppStore.getState();
  const firstId = store.appendQueuedUserMessage(SID, {
    content: 'same prompt',
    queueMode: 'interrupt',
  });
  const secondId = store.appendQueuedUserMessage(SID, {
    content: 'same prompt',
    queueMode: 'interrupt',
  });
  assert.ok(firstId);
  assert.ok(secondId);
  store.markQueuedUserMessageAccepted(SID, firstId, 'input-1', 'interrupt');
  store.markQueuedUserMessageAccepted(SID, secondId, 'input-2', 'interrupt');

  store.appendEvent({
    kind: 'queued_user_prompt_failed',
    sessionId: SID,
    queueId: 'input-2',
    queueMode: 'interrupt',
    content: 'same prompt',
    reason: 'run_completed',
  });
  store.appendEvent({ kind: 'session_complete', sessionId: SID });

  const queued = useAppStore.getState().queuedUserMessagesBySession[SID] ?? [];
  assert.deepEqual(
    queued.map((entry) => ({ queueId: entry.queueId, status: entry.status })),
    [
      { queueId: 'input-1', status: 'queued' },
      { queueId: 'input-2', status: 'failed' },
    ],
  );
  assert.equal(queued[1]?.failureReason, 'run_completed');
});

test('queued interrupt terminal event wins an event-before-ack race by preview content', () => {
  const store = useAppStore.getState();
  const longPrompt = `${'review this carefully '.repeat(80)}private tail`;
  const localId = store.appendQueuedUserMessage(SID, {
    content: longPrompt,
    matchContent: `${longPrompt}\n\n<attachment-paths>internal</attachment-paths>`,
    queueMode: 'interrupt',
  });
  assert.ok(localId);

  store.appendEvent({
    kind: 'queued_user_prompt_failed',
    sessionId: SID,
    queueId: 'input-before-ack',
    queueMode: 'interrupt',
    content: `${longPrompt.slice(0, 1023)}…`,
    reason: 'run_cancelled',
  });
  store.markQueuedUserMessageAccepted(SID, localId, 'input-before-ack', 'interrupt');

  const queued = useAppStore.getState().queuedUserMessagesBySession[SID] ?? [];
  assert.equal(queued.length, 1);
  assert.equal(queued[0]?.queueId, 'input-before-ack');
  assert.equal(queued[0]?.status, 'failed', 'a late acknowledgement must not revive the bubble');
  assert.equal(queued[0]?.failureReason, 'run_cancelled');
  assert.equal(queued[0]?.content, longPrompt, 'the full local prompt remains available to copy');

  store.appendEvent({
    kind: 'session_error',
    sessionId: SID,
    error: 'cancelled',
    category: 'cancelled',
    retriable: true,
  });
  assert.equal(
    useAppStore.getState().queuedUserMessagesBySession[SID]?.[0]?.status,
    'failed',
    'the following cancellation boundary must retain the actionable failure bubble',
  );
});

test('queued_user_prompt_started preserves an image when delivery beats the send ACK', () => {
  const store = useAppStore.getState();
  const localId = store.appendQueuedUserMessage(SID, {
    content: 'q2',
    queueMode: 'after-turn',
    attachments: [
      {
        id: 'optimistic-queued-image',
        kind: 'image',
        mediaType: 'image/png',
        status: 'available',
        thumbnailUrl: 'data:image/png;base64,AA==',
        previewUrl: 'data:image/png;base64,AA==',
      },
    ],
  });
  assert.ok(localId);

  store.appendEvent({
    kind: 'queued_user_prompt_started',
    sessionId: SID,
    queueMode: 'after-turn',
    content: 'q2',
  });
  const token = 'b'.repeat(32);
  store.updateQueuedUserMessageAttachments(SID, localId, [
    {
      id: 'durable-queued-image',
      kind: 'image',
      mediaType: 'image/png',
      status: 'available',
      thumbnailUrl: `app://space/session-attachment/${token}?variant=thumbnail`,
      previewUrl: `app://space/session-attachment/${token}?variant=original`,
    },
  ]);

  const state = useAppStore.getState();
  assert.equal(state.queuedUserMessagesBySession[SID]?.length ?? 0, 0);
  assert.equal(state.userMessagesBySession[SID]?.at(-1)?.content, 'q2');
  assert.equal(
    state.userMessagesBySession[SID]?.at(-1)?.attachments?.[0]?.id,
    'durable-queued-image',
  );
});

test('convertUserMessageToQueued replaces the addressed optimistic bubble after queued ack', () => {
  const store = useAppStore.getState();
  const messageId = store.appendUserMessage(SID, 'q2', 1234);
  assert.ok(messageId);

  const localId = store.convertUserMessageToQueued(SID, messageId, {
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

test('rollbackUserMessage removes only the addressed optimistic bubble after a newer send', () => {
  const store = useAppStore.getState();
  const staleMessageId = store.appendUserMessage(SID, 'same prompt', 1234);
  const currentMessageId = store.appendUserMessage(SID, 'same prompt', 1235);
  assert.ok(staleMessageId);
  assert.ok(currentMessageId);

  store.rollbackUserMessage(SID, staleMessageId);

  assert.deepEqual(
    (useAppStore.getState().userMessagesBySession[SID] ?? []).map((message) => message.id),
    [currentMessageId],
  );
});

test('late queued acknowledgement converts only its addressed optimistic bubble', () => {
  const store = useAppStore.getState();
  const staleMessageId = store.appendUserMessage(SID, 'same prompt', 1234);
  const currentMessageId = store.appendUserMessage(SID, 'same prompt', 1235);
  assert.ok(staleMessageId);
  assert.ok(currentMessageId);

  const localId = store.convertUserMessageToQueued(SID, staleMessageId, {
    content: 'same prompt',
    queueMode: 'after-turn',
  });

  assert.ok(localId);
  assert.deepEqual(
    (useAppStore.getState().userMessagesBySession[SID] ?? []).map((message) => message.id),
    [currentMessageId],
  );
  assert.equal(useAppStore.getState().queuedUserMessagesBySession[SID]?.[0]?.sentAt, 1234);
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

test('appendLocalNotice surfaces durable IPC failure while keeping bounded optimistic state', async () => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const originalError = console.error;
  const errors: unknown[][] = [];
  console.error = (...args: unknown[]) => errors.push(args);
  let persistenceOk = false;
  const persistedNoticeIds = new Set<string>();
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      kodaxSpace: {
        invoke: async (_channel: string, payload: { readonly notice: { readonly id: string } }) => {
          if (persistenceOk) persistedNoticeIds.add(payload.notice.id);
          return { ok: persistenceOk };
        },
      },
    },
  });
  try {
    useAppStore.getState().appendLocalNotice(SID, '/will-remain-optimistic', 1003);
    useAppStore.getState().appendLocalNotice(SID, '/second-failure', 1004);
    await new Promise<void>((resolve) => setImmediate(resolve));

    assert.equal(useAppStore.getState().localNoticesBySession[SID]?.length, 2);
    assert.equal(useToastStore.getState().toasts.length, 1);
    assert.equal(useToastStore.getState().toasts[0]?.tone, 'error');
    assert.equal(useToastStore.getState().toasts[0]?.ttl, 0);
    assert.equal(errors.length, 2);

    persistenceOk = true;
    useAppStore.getState().appendLocalNotice(SID, '/persistence-recovered', 1005);
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(useToastStore.getState().toasts.length, 0);
    const noticeIds = (useAppStore.getState().localNoticesBySession[SID] ?? []).map(
      (notice) => notice.id,
    );
    assert.deepEqual([...persistedNoticeIds].sort(), [...noticeIds].sort());
  } finally {
    console.error = originalError;
    useToastStore.getState().clear();
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow);
    else Reflect.deleteProperty(globalThis, 'window');
  }
});

test('local notice persistence warning stays coalesced until every affected Session recovers', async () => {
  const secondSessionId = 's_cancel_dedupe_second';
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const originalError = console.error;
  console.error = () => {};
  const recovered = new Set<string>();
  useAppStore.setState({
    sessions: [session, { ...session, sessionId: secondSessionId }],
  });
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      kodaxSpace: {
        invoke: async (_channel: string, payload: { readonly sessionId: string }) => ({
          ok: recovered.has(payload.sessionId),
        }),
      },
    },
  });
  try {
    useAppStore.getState().appendLocalNotice(SID, '/first-session-failure', 1_010);
    useAppStore.getState().appendLocalNotice(secondSessionId, '/second-session-failure', 1_011);
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(useToastStore.getState().toasts.length, 1);

    recovered.add(SID);
    useAppStore.getState().appendLocalNotice(SID, '/first-session-recovered', 1_012);
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(useToastStore.getState().toasts.length, 1);

    recovered.add(secondSessionId);
    useAppStore.getState().appendLocalNotice(secondSessionId, '/second-session-recovered', 1_013);
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(useToastStore.getState().toasts.length, 0);
  } finally {
    console.error = originalError;
    useToastStore.getState().clear();
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow);
    else Reflect.deleteProperty(globalThis, 'window');
  }
});

test('failed local notice replay remains bounded during a prolonged persistence outage', async () => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const originalError = console.error;
  console.error = () => {};
  let persistenceOk = false;
  let invokeCount = 0;
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      kodaxSpace: {
        invoke: async () => {
          invokeCount += 1;
          return { ok: persistenceOk };
        },
      },
    },
  });
  try {
    for (let index = 0; index < 2_000; index += 1) {
      useAppStore.getState().appendLocalNotice(SID, `/outage-${index}`, 20_000 + index);
    }
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(useAppStore.getState().localNoticesBySession[SID]?.length, 32);
    assert.equal(useToastStore.getState().toasts.length, 1);
    assert.equal(invokeCount, 2_000);

    persistenceOk = true;
    useAppStore.getState().appendLocalNotice(SID, '/outage-recovered', 30_000);
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.ok(invokeCount <= 2_033, `unexpected replay count: ${invokeCount}`);
    assert.equal(useToastStore.getState().toasts.length, 0);
  } finally {
    console.error = originalError;
    useToastStore.getState().clear();
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow);
    else Reflect.deleteProperty(globalThis, 'window');
  }
});

test('an in-flight replay cannot erase a newer persistence failure for the same Session', async () => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const originalError = console.error;
  console.error = () => {};
  let phase: 'initial' | 'blocked' | 'recovered' = 'initial';
  let releaseRetry: (() => void) | undefined;
  let markRetryStarted: (() => void) | undefined;
  const retryStarted = new Promise<void>((resolve) => {
    markRetryStarted = resolve;
  });
  const persistedContents = new Set<string>();
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      kodaxSpace: {
        invoke: async (
          _channel: string,
          payload: { readonly notice: { readonly content: string } },
        ) => {
          const content = payload.notice.content;
          if (content === '/retry-a' && phase === 'initial') return { ok: false };
          if (content === '/retry-a' && phase === 'blocked') {
            markRetryStarted?.();
            await new Promise<void>((resolve) => {
              releaseRetry = resolve;
            });
            persistedContents.add(content);
            return { ok: true };
          }
          if (content === '/concurrent-c' && phase === 'blocked') return { ok: false };
          persistedContents.add(content);
          return { ok: true };
        },
      },
    },
  });
  try {
    useAppStore.getState().appendLocalNotice(SID, '/retry-a', 40_000);
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(useToastStore.getState().toasts.length, 1);

    phase = 'blocked';
    useAppStore.getState().appendLocalNotice(SID, '/trigger-retry-b', 40_001);
    await retryStarted;
    useAppStore.getState().appendLocalNotice(SID, '/concurrent-c', 40_002);
    await new Promise<void>((resolve) => setImmediate(resolve));
    releaseRetry?.();
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(useToastStore.getState().toasts.length, 1);

    phase = 'recovered';
    useAppStore.getState().appendLocalNotice(SID, '/trigger-final-retry-d', 40_003);
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(persistedContents.has('/concurrent-c'), true);
    assert.equal(useToastStore.getState().toasts.length, 0);
  } finally {
    console.error = originalError;
    useToastStore.getState().clear();
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow);
    else Reflect.deleteProperty(globalThis, 'window');
  }
});

test('appendLocalNotice keeps at most the 32 notices that can be restored into the UI window', () => {
  const store = useAppStore.getState();
  for (let index = 0; index < 40; index += 1) {
    store.appendLocalNotice(SID, `/notice-${index}`, 2_000 + index);
  }

  const notices = useAppStore.getState().localNoticesBySession[SID] ?? [];
  assert.equal(notices.length, 32);
  assert.equal(notices[0]?.content, '/notice-8');
  assert.equal(notices.at(-1)?.content, '/notice-39');
});

test('appendLocalNotice protects the current row at the 32-row limit after clock rollback', () => {
  useAppStore.setState({
    localNoticesBySession: {
      [SID]: Array.from({ length: 32 }, (_, index) => ({
        id: `future_${index}`,
        content: `/future-${index}`,
        sentAt: 100_000 + index,
        variant: 'echo' as const,
      })),
    },
  });

  useAppStore.getState().appendLocalNotice(SID, '/current-after-rollback', 1);

  const notices = useAppStore.getState().localNoticesBySession[SID] ?? [];
  assert.equal(notices.length, 32);
  assert.equal(
    notices.some((notice) => notice.content === '/current-after-rollback'),
    true,
  );
  assert.equal(
    notices.some((notice) => notice.id === 'future_0'),
    false,
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

test('prependSessionHistory restores the persisted post-compaction context instead of summing old scrollback', () => {
  const items: SessionHistoryItem[] = [
    { kind: 'user', content: 'large old context' },
    { kind: 'assistant', text: 'large old answer' },
    {
      kind: 'lineage_notice',
      noticeKind: 'compaction',
      text: 'summary',
      tokensBefore: 322_973,
      tokensAfter: 222_460,
    },
  ];

  useAppStore.getState().prependSessionHistory(SID, items, 999);

  const state = useAppStore.getState();
  assert.deepEqual(state.tokensBySession[SID], {
    tokens: 222_460,
    source: 'compact_stats',
    compactedFrom: 322_973,
    lastCompaction: {
      committed: true,
      tokensBefore: 322_973,
      tokensAfter: 222_460,
    },
  });
  assert.equal(
    state.eventsBySession[SID]?.some((event) => event.kind === 'compact_stats'),
    true,
  );
});

test('appendEvent accumulates root and child Agent Provider usage without changing root context', () => {
  const store = useAppStore.getState();
  store.appendEvent({
    kind: 'iteration_end',
    sessionId: SID,
    iter: 1,
    maxIter: 30,
    tokenCount: 1_280,
    usage: {
      inputTokens: 980,
      outputTokens: 300,
      cacheReadInputTokens: 640,
      cacheWriteInputTokens: 96,
    },
  });
  store.appendEvent({
    kind: 'iteration_end',
    sessionId: SID,
    iter: 2,
    maxIter: 30,
    tokenCount: 1_600,
    usage: {
      inputTokens: 1_200,
      outputTokens: 400,
      cacheReadInputTokens: 800,
    },
  });
  store.appendEvent({
    kind: 'iteration_end',
    sessionId: SID,
    iter: 1,
    maxIter: 10,
    tokenCount: 500,
    contextKind: 'child',
    usage: {
      inputTokens: 450,
      outputTokens: 50,
      cacheReadInputTokens: 400,
    },
  });

  assert.deepEqual(useAppStore.getState().sessionTokenUsageBySession[SID], {
    inputTokens: 2_630,
    outputTokens: 750,
    cacheReadInputTokens: 1_840,
    cacheWriteInputTokens: 96,
    sampleCount: 3,
    childSampleCount: 1,
    accountingSource: 'iteration',
  });
  assert.deepEqual(useAppStore.getState().tokensBySession[SID], {
    tokens: 1_600,
    source: 'iteration_end',
  });
});

test('appendEvent totals deduped root and child physical Provider diagnostics', () => {
  const store = useAppStore.getState();
  const hash = 'c'.repeat(64);
  const diagnostic = {
    kind: 'provider_cache_diagnostic' as const,
    sessionId: SID,
    requestId: 'request-root',
    requestedAt: '2026-07-26T03:12:00.000Z',
    completedAt: '2026-07-26T03:12:01.000Z',
    transport: 'stream' as const,
    provider: 'zai-coding',
    model: 'glm-5.2',
    attempt: 1,
    systemPromptHash: hash,
    toolSchemaHash: hash,
    messagePrefixHash: hash,
    messagePrefixCount: 42,
    requestMessagesHash: hash,
    requestEnvelopeHash: hash,
    messageCount: 44,
    toolCount: 12,
    inputTokens: 145_226,
    outputTokens: 779,
    cacheReadInputTokens: 144_512,
  };
  store.appendEvent(diagnostic);
  store.appendEvent(diagnostic);
  store.appendEvent({
    ...diagnostic,
    requestId: 'request-child',
    contextKind: 'child',
    inputTokens: 450,
    outputTokens: 50,
    cacheReadInputTokens: 400,
  });
  store.appendEvent({
    kind: 'iteration_end',
    sessionId: SID,
    iter: 2,
    maxIter: 30,
    tokenCount: 145_226,
    usage: {
      inputTokens: 145_226,
      outputTokens: 779,
      cacheReadInputTokens: 144_512,
    },
  });

  assert.deepEqual(useAppStore.getState().providerCacheDiagnosticBySession[SID], diagnostic);
  assert.deepEqual(useAppStore.getState().sessionTokenUsageBySession[SID], {
    inputTokens: 145_676,
    outputTokens: 829,
    cacheReadInputTokens: 144_912,
    sampleCount: 2,
    childSampleCount: 1,
    accountingSource: 'provider_diagnostic',
    recentRequestIds: ['request-root', 'request-child'],
  });
});

test('appendEvent keeps only the latest root context composition snapshot', () => {
  const snapshot = {
    kind: 'context_budget_snapshot' as const,
    sessionId: SID,
    provider: 'mock',
    model: 'mock-model',
    profile: 'report_only' as const,
    contextWindow: 200_000,
    smallWindow: false,
    pressure: 'low' as const,
    tokenBreakdown: {
      systemPrompt: 100,
      toolSchemas: 200,
      skillCatalog: 30,
      mcpCatalog: 20,
      transcript: 500,
      pendingInput: 50,
      recentToolResults: 100,
      reservedResponse: 280,
      total: 1_280,
    },
    usedTokens: 1_280,
    availableTokens: 198_720,
    usedRatio: 0.0064,
    toolSchemaRatio: 0.001,
    createdAt: '2026-07-25T14:09:23.713Z',
  };
  const store = useAppStore.getState();
  store.appendEvent(snapshot);
  store.appendEvent({
    ...snapshot,
    contextKind: 'child',
    contextId: `${SID}/agent/reviewer`,
    usedTokens: 999,
  });

  assert.deepEqual(useAppStore.getState().contextBudgetBySession[SID], snapshot);
});

test('committed compaction invalidates a revision-less pre-compaction budget', () => {
  const snapshot = {
    kind: 'context_budget_snapshot' as const,
    sessionId: SID,
    provider: 'mock',
    model: 'mock-model',
    profile: 'report_only' as const,
    contextWindow: 1_000_000,
    smallWindow: false,
    pressure: 'high' as const,
    tokenBreakdown: {
      systemPrompt: 5_827,
      toolSchemas: 15_458,
      skillCatalog: 653,
      mcpCatalog: 245,
      transcript: 184_158,
      pendingInput: 773,
      recentToolResults: 122_178,
      reservedResponse: 131_072,
      total: 460_364,
    },
    usedTokens: 460_364,
    availableTokens: 539_636,
    usedRatio: 0.460364,
    toolSchemaRatio: 0.015458,
    createdAt: '2026-07-28T04:02:10.830Z',
  };
  const store = useAppStore.getState();
  store.appendEvent(snapshot);
  store.appendEvent({
    kind: 'compact_stats',
    sessionId: SID,
    tokensBefore: 330_015,
    tokensAfter: 91_005,
    committed: true,
    source: 'automatic_threshold',
  });

  assert.equal(useAppStore.getState().contextBudgetBySession[SID], undefined);
  assert.equal(useAppStore.getState().tokensBySession[SID]?.tokens, 91_005);

  const postCompactionSnapshot = {
    ...snapshot,
    pressure: 'low' as const,
    tokenBreakdown: {
      ...snapshot.tokenBreakdown,
      transcript: 63_219,
      pendingInput: 833,
      recentToolResults: 6_485,
      total: 223_792,
    },
    usedTokens: 223_792,
    availableTokens: 776_208,
    usedRatio: 0.223792,
    createdAt: '2026-07-28T04:04:25.125Z',
  };
  store.appendEvent(postCompactionSnapshot);
  assert.deepEqual(useAppStore.getState().contextBudgetBySession[SID], postCompactionSnapshot);

  store.appendEvent({
    kind: 'compact_stats',
    sessionId: SID,
    tokensBefore: 92_720,
    tokensAfter: 92_720,
    committed: false,
    source: 'manual',
  });
  assert.deepEqual(useAppStore.getState().contextBudgetBySession[SID], postCompactionSnapshot);

  store.appendEvent({
    kind: 'iteration_end',
    sessionId: SID,
    iter: 2,
    maxIter: 30,
    tokenCount: 95_000,
    tokenSource: 'api',
    contextId: SID,
    contextKind: 'root',
    contextRevision: 3,
  });
  const revisionedSnapshot = {
    ...postCompactionSnapshot,
    contextId: SID,
    contextKind: 'root' as const,
    contextRevision: 3,
  };
  store.appendEvent(revisionedSnapshot);
  const revisionedTokenInfo = useAppStore.getState().tokensBySession[SID];
  const storedRevisionedBudget = useAppStore.getState().contextBudgetBySession[SID];
  assert.ok(revisionedTokenInfo?.observedOrder !== undefined);
  assert.ok(storedRevisionedBudget?.observedOrder !== undefined);
  assert.ok(storedRevisionedBudget.observedOrder > revisionedTokenInfo.observedOrder);

  store.appendEvent({
    kind: 'compact_stats',
    sessionId: SID,
    tokensBefore: 95_000,
    tokensAfter: 45_000,
    contextId: SID,
    contextKind: 'root',
    committed: true,
    source: 'automatic_threshold',
  });
  assert.deepEqual(useAppStore.getState().tokensBySession[SID], {
    tokens: 45_000,
    source: 'compact_stats',
    compactedFrom: 95_000,
    contextId: SID,
    contextRevision: 3,
    lastCompaction: {
      committed: true,
      tokensBefore: 95_000,
      tokensAfter: 45_000,
      source: 'automatic_threshold',
    },
  });
  assert.equal(useAppStore.getState().contextBudgetBySession[SID], undefined);
});

test('iteration tokenSource survives in the derived root context reading', () => {
  useAppStore.getState().appendEvent({
    kind: 'iteration_end',
    sessionId: SID,
    iter: 1,
    maxIter: 30,
    tokenCount: 42_000,
    tokenSource: 'estimate',
  });

  assert.deepEqual(useAppStore.getState().tokensBySession[SID], {
    tokens: 42_000,
    source: 'iteration_end',
    tokenSource: 'estimate',
  });
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
