import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';

import type {
  AgentActorTreeSnapshotT,
  SessionMeta,
  SessionEvent,
  SpaceRuntimeProfileProjectionT,
  SpaceSessionLiveProjectionT,
} from '@kodax-space/space-ipc-schema';
import { composeMessages } from '../../renderer/src/features/session/composeMessages.js';
import { useAppStore } from '../../renderer/src/store/appStore.js';
import {
  createRuntimeProjectionState,
  runtimeSessionNeedsObservation,
} from '../../renderer/src/store/runtimeProjectionState.js';
import { runtimeDeltasShareSnapshotSide } from '../../renderer/src/store/runtimeSnapshotHydration.js';

const profile: SpaceRuntimeProfileProjectionT = {
  connection: {
    state: 'ready',
    changedAt: 1,
    stale: false,
    runtimeId: 'rt_1',
    profile: 'default',
    capabilities: [{ id: 'runtime.live.observe', version: 1, available: true }],
  },
  projectionRevision: 1,
  cursor: { runtimeId: 'rt_1', seq: 1 },
  sessions: [],
  interactions: [],
  notifications: [],
};

const live: SpaceSessionLiveProjectionT = {
  sessionId: 's_1',
  projectionRevision: 1,
  cursor: { runtimeId: 'rt_1', seq: 1 },
  transcriptRevision: 'tx_1',
  queuedRuns: [],
  activeTools: [],
  todos: [{ id: 'todo_1', content: 'Wire Space state', status: 'pending' }],
  queuedInputs: [],
  interactions: [],
};

function permissionInteraction(reqId: string): SpaceSessionLiveProjectionT['interactions'][number] {
  return {
    kind: 'permission',
    source: 'coder-runtime',
    runId: 'run_1',
    createdAt: 1,
    state: 'pending',
    request: {
      reqId,
      sessionId: 's_1',
      risk: 'medium',
      reason: `permission ${reqId}`,
      toolCall: {
        toolId: `tool_${reqId}`,
        toolName: 'write_file',
        operation: 'write',
      },
    },
  };
}

const sidebarSession: SessionMeta = {
  sessionId: 's_1',
  projectRoot: '/repo',
  provider: 'mock',
  reasoningMode: 'auto',
  permissionMode: 'accept-edits',
  autoModeEngine: 'llm',
  agentMode: 'ama',
  surface: 'code',
  createdAt: 100,
  lastActivityAt: 100,
};

beforeEach(() => {
  useAppStore.getState().resetSessionMessages('s_1');
  const initial = createRuntimeProjectionState();
  useAppStore.setState({
    sessions: [],
    runtimeConnection: initial.connection,
    runtimeProfile: initial.profile,
    liveProjectionBySession: initial.liveBySession,
    agentActorSnapshotBySession: {},
    runtimeSnapshotRequiredBySession: initial.snapshotRequiredBySession,
    runtimeSnapshotCursorBySession: {},
    permissionQueue: [],
    askUserQueue: [],
    currentSessionId: null,
    eventsBySession: {},
    tokensBySession: {},
    pendingSendBySession: {},
    pendingSendRuntimeBaselineBySession: {},
  });
});

test('historical terminal Sessions do not start the expensive observation plane', () => {
  const terminalProfile: SpaceRuntimeProfileProjectionT = {
    ...profile,
    sessions: [
      {
        sessionId: 's_1',
        surface: 'code',
        createdAt: 1,
        lastActivityAt: 2,
        queuedRuns: [],
        lastTerminalRun: {
          runId: 'run_done',
          sessionId: 's_1',
          phase: 'completed',
          completedAt: 2,
        },
      },
    ],
  };
  assert.equal(
    runtimeSessionNeedsObservation(
      { profile: terminalProfile, snapshotRequiredBySession: {} },
      's_1',
    ),
    false,
  );
  assert.equal(
    runtimeSessionNeedsObservation(
      {
        profile: terminalProfile,
        liveBySession: {
          s_1: {
            ...live,
            activeRun: {
              runId: 'run_stale_local',
              sessionId: 's_1',
              phase: 'running',
              startedAt: 1,
            },
          },
        },
        snapshotRequiredBySession: {},
      },
      's_1',
    ),
    true,
  );
  assert.equal(
    runtimeSessionNeedsObservation(
      {
        profile: {
          ...terminalProfile,
          sessions: [
            {
              ...terminalProfile.sessions[0]!,
              activeRun: {
                runId: 'run_active',
                sessionId: 's_1',
                phase: 'running',
                startedAt: 3,
              },
            },
          ],
        },
        snapshotRequiredBySession: {},
      },
      's_1',
    ),
    true,
  );
  assert.equal(
    runtimeSessionNeedsObservation(
      { profile: terminalProfile, snapshotRequiredBySession: { s_1: true } },
      's_1',
    ),
    true,
  );
  assert.equal(
    runtimeSessionNeedsObservation({ profile: null, snapshotRequiredBySession: {} }, 's_1'),
    false,
  );
  assert.equal(
    runtimeSessionNeedsObservation(
      { profile: { ...terminalProfile, sessions: [] }, snapshotRequiredBySession: {} },
      's_1',
    ),
    false,
  );
  assert.equal(
    runtimeSessionNeedsObservation(
      {
        profile: {
          ...terminalProfile,
          sessions: [
            {
              ...terminalProfile.sessions[0]!,
              queuedRuns: [
                {
                  runId: 'run_queued',
                  sessionId: 's_1',
                  phase: 'queued',
                  queuedAt: 3,
                },
              ],
            },
          ],
        },
        snapshotRequiredBySession: {},
      },
      's_1',
    ),
    true,
  );
  assert.equal(
    runtimeSessionNeedsObservation(
      {
        profile: {
          ...terminalProfile,
          interactions: [
            {
              kind: 'ask-user',
              source: 'coder-runtime',
              state: 'pending',
              createdAt: 3,
              request: {
                kind: 'input',
                reqId: 'req_1',
                sessionId: 's_1',
                question: 'Continue?',
              },
            },
          ],
        },
        snapshotRequiredBySession: {},
      },
      's_1',
    ),
    true,
  );
});

test('loading an older history page preserves live content hydrated from a Runtime snapshot', () => {
  useAppStore.getState().setSessions([sidebarSession]);
  useAppStore.getState().replaceRuntimeProfileProjection(profile);
  useAppStore.getState().prependSessionHistory(
    's_1',
    [
      {
        kind: 'user',
        content: 'new query',
        canonicalIndex: 2,
        entryId: 'user-2',
      },
      { kind: 'history_truncation', scope: 'history', omittedItems: 2 },
    ],
    100,
    { replaceLoadedWindow: true },
  );

  useAppStore.getState().replaceSessionLiveProjection({
    ...live,
    projectionRevision: 2,
    cursor: { runtimeId: 'rt_1', seq: 2 },
    activeRun: {
      runId: 'run_snapshot',
      sessionId: 's_1',
      phase: 'running',
      startedAt: 200,
    },
    thinkingDraft: { text: 'snapshot thinking', startedAt: 201 },
    assistantDraft: { text: 'snapshot answer', startedAt: 202 },
    activeTools: [{ toolCallId: 'tool_snapshot', name: 'read_file', startedAt: 203 }],
  });

  useAppStore.getState().prependSessionHistory(
    's_1',
    [
      {
        kind: 'user',
        content: 'old query',
        canonicalIndex: 0,
        entryId: 'user-1',
      },
      { kind: 'assistant', text: 'old answer', canonicalIndex: 1, entryId: 'answer-1' },
      {
        kind: 'user',
        content: 'new query',
        canonicalIndex: 2,
        entryId: 'user-2',
      },
    ],
    100,
    { replaceLoadedWindow: true },
  );

  const events = useAppStore.getState().eventsBySession.s_1 ?? [];
  assert.ok(
    events.some((event) => event.kind === 'thinking_delta' && event.text === 'snapshot thinking'),
  );
  assert.ok(
    events.some((event) => event.kind === 'text_delta' && event.text === 'snapshot answer'),
  );
  assert.ok(
    events.some((event) => event.kind === 'tool_start' && event.toolId === 'tool_snapshot'),
  );
});

test('app store keeps only monotonic Actor snapshots from the active Runtime', () => {
  const snapshot: AgentActorTreeSnapshotT = {
    runtimeId: 'rt_1',
    sessionId: 's_1',
    rootPath: '/root',
    revision: 2,
    eventCursor: 5,
    activeNonRootTurns: 0,
    maxConcurrentThreads: 4,
    actors: [],
  };

  useAppStore.getState().replaceRuntimeProfileProjection(profile);
  useAppStore.getState().replaceAgentActorSnapshot(snapshot);
  useAppStore.getState().replaceAgentActorSnapshot({
    ...snapshot,
    revision: 1,
    eventCursor: 99,
  });
  useAppStore.getState().replaceAgentActorSnapshot({
    ...snapshot,
    runtimeId: 'rt_stale',
    revision: 9,
  });

  assert.strictEqual(useAppStore.getState().agentActorSnapshotBySession.s_1, snapshot);

  const next = { ...snapshot, revision: 3, eventCursor: 6 };
  useAppStore.getState().replaceAgentActorSnapshot(next);
  assert.strictEqual(useAppStore.getState().agentActorSnapshotBySession.s_1, next);

  useAppStore.getState().setCoderRuntimeConnection({
    state: 'disconnected',
    changedAt: 2,
    stale: true,
    capabilities: [],
  });
  assert.deepEqual(useAppStore.getState().agentActorSnapshotBySession, {});
});

test('Runtime activity repairs sidebar recency across list races and new user messages', () => {
  useAppStore.getState().setSessions([sidebarSession]);
  const activityProfile: SpaceRuntimeProfileProjectionT = {
    ...profile,
    sessions: [
      {
        sessionId: 's_1',
        surface: 'code',
        projectRoot: '/repo',
        createdAt: 100,
        lastActivityAt: 300,
        queuedRuns: [],
      },
    ],
  };

  useAppStore.getState().replaceRuntimeProfileProjection(activityProfile);
  assert.equal(useAppStore.getState().sessions[0]?.lastActivityAt, 300);

  // A slower session.list response must not overwrite the newer Runtime timestamp.
  useAppStore.getState().setSessions([sidebarSession]);
  assert.equal(useAppStore.getState().sessions[0]?.lastActivityAt, 300);

  useAppStore.getState().appendUserMessage('s_1', 'latest interaction', 400);
  assert.equal(useAppStore.getState().sessions[0]?.lastActivityAt, 400);
});

test('app store exposes snapshot replacement and revision-safe live patch actions', () => {
  useAppStore.getState().replaceRuntimeProfileProjection(profile);
  useAppStore.getState().replaceSessionLiveProjection(live);

  const status = useAppStore.getState().applySessionLiveProjectionChange({
    sessionId: 's_1',
    baseProjectionRevision: 1,
    projectionRevision: 2,
    cursor: { runtimeId: 'rt_1', seq: 2 },
    change: {
      domain: 'todos',
      todos: [{ id: 'todo_1', content: 'Wire Space state', status: 'completed' }],
    },
  });

  const state = useAppStore.getState();
  assert.equal(status, 'applied');
  assert.equal(state.runtimeConnection.state, 'ready');
  assert.equal(state.runtimeProfile?.projectionRevision, 1);
  assert.equal(state.liveProjectionBySession.s_1?.projectionRevision, 2);
  assert.equal(state.liveProjectionBySession.s_1?.todos[0]?.status, 'completed');
});

test('app store drops a live activity snapshot as soon as Runtime authority becomes stale', () => {
  useAppStore.getState().replaceRuntimeProfileProjection(profile);
  useAppStore.getState().replaceSessionLiveProjection({
    ...live,
    activeRun: {
      runId: 'run_stale',
      sessionId: 's_1',
      phase: 'running',
      startedAt: 10,
    },
    thinkingDraft: { text: 'stale thinking', startedAt: 10 },
  });

  useAppStore.getState().setCoderRuntimeConnection({
    ...profile.connection,
    state: 'reconnecting',
    changedAt: 2,
    stale: true,
    reason: 'transport lost',
  });

  assert.equal(useAppStore.getState().liveProjectionBySession.s_1, undefined);
});

test('a late Actor snapshot cannot repopulate state under stale degraded authority', () => {
  const snapshot: AgentActorTreeSnapshotT = {
    runtimeId: 'rt_1',
    sessionId: 's_1',
    rootPath: '/root',
    revision: 1,
    eventCursor: 1,
    activeNonRootTurns: 1,
    maxConcurrentThreads: 4,
    actors: [],
  };
  useAppStore.getState().replaceRuntimeProfileProjection(profile);
  useAppStore.getState().replaceAgentActorSnapshot(snapshot);

  useAppStore.getState().setCoderRuntimeConnection({
    ...profile.connection,
    state: 'degraded',
    stale: true,
    changedAt: 2,
    reason: 'observation invalidated',
  });
  useAppStore.getState().replaceAgentActorSnapshot({
    ...snapshot,
    revision: 2,
    eventCursor: 2,
  });

  assert.deepEqual(useAppStore.getState().agentActorSnapshotBySession, {});
});

test('an older rejected live snapshot cannot roll back settings or interactions', () => {
  useAppStore.getState().setSessions([sidebarSession]);
  useAppStore.getState().replaceRuntimeProfileProjection(profile);
  const current: SpaceSessionLiveProjectionT = {
    ...live,
    projectionRevision: 2,
    cursor: { runtimeId: 'rt_1', seq: 2 },
    settings: { revision: 2, value: { provider: 'current-provider' } },
    interactions: [permissionInteraction('permission_current')],
  };
  useAppStore.getState().replaceSessionLiveProjection(current);

  useAppStore.getState().replaceSessionLiveProjection({
    ...live,
    settings: { revision: 1, value: { provider: 'stale-provider' } },
    interactions: [permissionInteraction('permission_stale')],
  });

  const state = useAppStore.getState();
  assert.strictEqual(state.liveProjectionBySession.s_1, current);
  assert.equal(state.sessions[0]?.provider, 'current-provider');
  assert.deepEqual(
    state.permissionQueue.map((request) => request.reqId),
    ['permission_current'],
  );
});

test('a late live snapshot cannot rebuild derived state under stale degraded authority', () => {
  useAppStore.getState().setSessions([sidebarSession]);
  useAppStore.getState().replaceRuntimeProfileProjection(profile);
  useAppStore.getState().replaceSessionLiveProjection({
    ...live,
    projectionRevision: 2,
    cursor: { runtimeId: 'rt_1', seq: 2 },
    settings: { revision: 2, value: { provider: 'current-provider' } },
    interactions: [permissionInteraction('permission_current')],
  });
  useAppStore.getState().setCoderRuntimeConnection({
    ...profile.connection,
    state: 'degraded',
    stale: true,
    changedAt: 2,
    reason: 'observation invalidated',
  });
  useAppStore.setState({ permissionQueue: [], askUserQueue: [] });

  useAppStore.getState().replaceSessionLiveProjection({
    ...live,
    projectionRevision: 3,
    cursor: { runtimeId: 'rt_1', seq: 3 },
    settings: { revision: 3, value: { provider: 'stale-provider' } },
    interactions: [permissionInteraction('permission_stale')],
  });

  const state = useAppStore.getState();
  assert.equal(state.liveProjectionBySession.s_1, undefined);
  assert.equal(state.sessions[0]?.provider, 'current-provider');
  assert.deepEqual(state.permissionQueue, []);
  assert.deepEqual(state.askUserQueue, []);
});

test('observation invalidation removes stale live authority before snapshot reload', () => {
  useAppStore.getState().replaceRuntimeProfileProjection(profile);
  useAppStore.getState().replaceSessionLiveProjection(live);
  useAppStore.setState({
    runtimeSnapshotCursorBySession: {
      s_1: { runtimeId: 'rt_1', runId: 'run_1', seq: 1 },
    },
  });

  useAppStore.getState().invalidateSessionLiveProjection({
    sessionId: 's_1',
    runtimeId: 'rt_1',
    reason: 'event_overflow',
    message: 'Rebuild from a fresh observation snapshot.',
  });

  const invalidated = useAppStore.getState();
  assert.equal(invalidated.liveProjectionBySession.s_1, undefined);
  assert.equal(invalidated.runtimeSnapshotCursorBySession.s_1, undefined);
  assert.equal(invalidated.runtimeSnapshotRequiredBySession.s_1, true);

  useAppStore.getState().replaceSessionLiveProjection({
    ...live,
    projectionRevision: 2,
    cursor: { runtimeId: 'rt_1', seq: 2 },
  });
  assert.equal(useAppStore.getState().liveProjectionBySession.s_1?.projectionRevision, 2);
  assert.equal(useAppStore.getState().runtimeSnapshotRequiredBySession.s_1, undefined);
});

test('cumulative live snapshots hydrate missing state once without replaying text, thinking, or tools', () => {
  useAppStore.setState({
    currentSessionId: 's_1',
    eventsBySession: {
      s_1: [
        { kind: 'session_complete', sessionId: 's_1' },
        { kind: 'session_start', sessionId: 's_1', provider: 'custom' },
        { kind: 'thinking_delta', sessionId: 's_1', text: 'plan' },
        { kind: 'text_delta', sessionId: 's_1', text: 'Hello' },
      ],
    },
  });
  useAppStore.getState().replaceRuntimeProfileProjection(profile);

  const streaming: SpaceSessionLiveProjectionT = {
    ...live,
    projectionRevision: 2,
    cursor: { runtimeId: 'rt_1', seq: 2 },
    activeRun: {
      runId: 'run_1',
      sessionId: 's_1',
      phase: 'running',
      startedAt: 10,
    },
    thinkingDraft: { text: 'plan carefully', startedAt: 10 },
    assistantDraft: { text: 'Hello world', startedAt: 10 },
    activeTools: [{ toolCallId: 'tool_1', name: 'read_file', startedAt: 11, progress: 'reading' }],
  };

  useAppStore.getState().replaceSessionLiveProjection(streaming);
  useAppStore.getState().replaceSessionLiveProjection({
    ...streaming,
    projectionRevision: 3,
    cursor: { runtimeId: 'rt_1', seq: 3 },
  });

  const events = useAppStore.getState().eventsBySession.s_1 ?? [];
  assert.equal(
    events
      .filter(
        (event): event is Extract<SessionEvent, { kind: 'thinking_delta' }> =>
          event.kind === 'thinking_delta',
      )
      .map((event) => event.text)
      .join(''),
    'plan carefully',
  );
  assert.equal(
    events
      .filter(
        (event): event is Extract<SessionEvent, { kind: 'text_delta' }> =>
          event.kind === 'text_delta',
      )
      .map((event) => event.text)
      .join(''),
    'Hello world',
  );
  assert.equal(events.filter((event) => event.kind === 'tool_start').length, 1);
  assert.equal(events.filter((event) => event.kind === 'tool_progress').length, 1);
});

test('a late renderer snapshot keeps its restored turn owner across terminal history and reactivation', () => {
  useAppStore.setState({ sessions: [sidebarSession], currentSessionId: 's_1' });
  useAppStore.getState().replaceRuntimeProfileProjection(profile);
  const store = useAppStore.getState();
  const q1 = {
    kind: 'user' as const,
    content: 'P1 query',
    sentAt: 10,
    entryId: 'entry_q1',
    canonicalIndex: 0,
    turnId: 'turn_q1',
    turnUserOrdinal: 0,
  };
  const a1 = {
    kind: 'assistant' as const,
    text: 'P1 answer',
    sentAt: 20,
    canonicalIndex: 1,
    turnId: 'turn_q1',
  };
  const q2 = {
    kind: 'user' as const,
    content: 'latest query',
    sentAt: 30,
    entryId: 'entry_q2',
    canonicalIndex: 2,
    turnId: 'turn_q2',
    turnUserOrdinal: 0,
  };

  store.prependSessionHistory('s_1', [q1], 10, {
    replaceLoadedWindow: true,
    sourceRevision: 'history-q1-open',
  });
  store.replaceSessionLiveProjection({
    ...live,
    projectionRevision: 2,
    cursor: { runtimeId: 'rt_1', seq: 10 },
    activeRun: {
      runId: 'run_q1',
      sessionId: 's_1',
      phase: 'running',
      turnId: 'turn_q1',
      startedAt: 10,
    },
    assistantDraft: { text: 'P1 answer', startedAt: 11 },
  });
  store.appendEvent({
    kind: 'session_complete',
    sessionId: 's_1',
    turnId: 'turn_q1',
    runtimeEvent: { runtimeId: 'rt_1', runId: 'run_q1', seq: 11 },
  });
  store.prependSessionHistory('s_1', [q1, a1], 10, {
    replaceLoadedWindow: true,
    sourceRevision: 'history-q1-terminal',
  });

  const q2MessageId = store.appendUserMessage('s_1', q2.content, q2.sentAt);
  assert.ok(q2MessageId);
  store.bindUserMessageRuntimeRun('s_1', q2MessageId, 'run_q2');
  store.appendEvent({
    kind: 'session_start',
    sessionId: 's_1',
    provider: 'mock',
    runtimeEvent: { runtimeId: 'rt_1', runId: 'run_q2', seq: 12 },
  });
  store.appendEvent({
    kind: 'session_start',
    sessionId: 's_1',
    provider: 'mock',
    turnId: 'turn_q2',
    runtimeEvent: { runtimeId: 'rt_1', runId: 'run_q2', seq: 13 },
  });
  store.appendEvent({
    kind: 'text_delta',
    sessionId: 's_1',
    text: 'latest answer',
    turnId: 'turn_q2',
    runtimeEvent: { runtimeId: 'rt_1', runId: 'run_q2', seq: 14 },
  });
  store.prependSessionHistory('s_1', [q1, a1, q2], 10, {
    replaceLoadedWindow: true,
    sourceRevision: 'history-reactivated',
  });

  const state = useAppStore.getState();
  const transcript = composeMessages({
    events: state.eventsBySession.s_1 ?? [],
    userMessages: state.userMessagesBySession.s_1 ?? [],
  }).flatMap((message) => {
    if (message.kind === 'user') return [`user:${message.content}`];
    if (message.kind === 'assistant_text') return [`assistant:${message.text}`];
    return [];
  });
  assert.deepEqual(transcript, [
    'user:P1 query',
    'assistant:P1 answer',
    'user:latest query',
    'assistant:latest answer',
  ]);
});

test('history arriving after a live snapshot opens only the exact restored initial turn', () => {
  useAppStore.setState({ sessions: [sidebarSession], currentSessionId: 's_1' });
  useAppStore.getState().replaceRuntimeProfileProjection(profile);
  const store = useAppStore.getState();
  const snapshotBeforeIdentity: SpaceSessionLiveProjectionT = {
    ...live,
    projectionRevision: 2,
    cursor: { runtimeId: 'rt_1', seq: 5 },
    activeRun: {
      runId: 'run_snapshot_first',
      sessionId: 's_1',
      phase: 'running',
    },
    assistantDraft: { text: 'snapshot-first answer', startedAt: 2 },
  };
  store.replaceSessionLiveProjection(snapshotBeforeIdentity);
  assert.equal(
    store.replaceSessionLiveProjection(
      {
        ...snapshotBeforeIdentity,
        activeRun: { ...snapshotBeforeIdentity.activeRun!, turnId: 'turn_snapshot_first' },
      },
      { allowEqualHydration: true },
    ),
    true,
  );
  store.prependSessionHistory(
    's_1',
    [
      {
        kind: 'user',
        content: 'snapshot-first query',
        entryId: 'entry_snapshot_first',
        canonicalIndex: 0,
        turnId: 'turn_snapshot_first',
        turnUserOrdinal: 0,
      },
    ],
    10,
    { replaceLoadedWindow: true, sourceRevision: 'snapshot-first-history' },
  );

  const state = useAppStore.getState();
  assert.equal(state.userMessagesBySession.s_1?.length, 1);
  assert.equal(state.userMessagesBySession.s_1?.[0]?.runtimeRunId, 'run_snapshot_first');
  assert.equal(state.userMessagesBySession.s_1?.[0]?.historyNoAssistantSegment, undefined);
  assert.equal(
    composeMessages({
      events: state.eventsBySession.s_1 ?? [],
      userMessages: state.userMessagesBySession.s_1 ?? [],
    }).filter(
      (message) => message.kind === 'assistant_text' && message.text === 'snapshot-first answer',
    ).length,
    1,
  );
});

test('an active snapshot turn cannot guess a later user ordinal inside the same turn', () => {
  useAppStore.setState({ sessions: [sidebarSession], currentSessionId: 's_1' });
  useAppStore.getState().replaceRuntimeProfileProjection(profile);
  const store = useAppStore.getState();
  store.prependSessionHistory(
    's_1',
    [
      {
        kind: 'user',
        content: 'initial prompt',
        canonicalIndex: 0,
        turnId: 'turn_shared',
        turnUserOrdinal: 0,
      },
      {
        kind: 'assistant',
        text: 'initial answer',
        canonicalIndex: 1,
        turnId: 'turn_shared',
      },
      {
        kind: 'user',
        content: 'mid-turn prompt',
        canonicalIndex: 2,
        turnId: 'turn_shared',
        turnUserOrdinal: 1,
      },
    ],
    10,
    { replaceLoadedWindow: true, sourceRevision: 'mid-turn-open' },
  );
  store.replaceSessionLiveProjection({
    ...live,
    projectionRevision: 2,
    cursor: { runtimeId: 'rt_1', seq: 5 },
    activeRun: {
      runId: 'run_shared',
      sessionId: 's_1',
      turnId: 'turn_shared',
      phase: 'running',
    },
    assistantDraft: { text: 'mid-turn draft', startedAt: 2 },
  });

  const users = useAppStore.getState().userMessagesBySession.s_1 ?? [];
  assert.deepEqual(
    users.map((message) => ({
      content: message.content,
      ordinal: message.turnUserOrdinal,
      runId: message.runtimeRunId,
      empty: message.historyNoAssistantSegment,
    })),
    [
      { content: 'initial prompt', ordinal: 0, runId: undefined, empty: undefined },
      { content: 'mid-turn prompt', ordinal: 1, runId: undefined, empty: true },
    ],
  );
});

test('history replacement that excludes live projection does not open a snapshot owner', () => {
  useAppStore.setState({ sessions: [sidebarSession], currentSessionId: 's_1' });
  useAppStore.getState().replaceRuntimeProfileProjection(profile);
  const store = useAppStore.getState();
  store.replaceSessionLiveProjection({
    ...live,
    projectionRevision: 2,
    cursor: { runtimeId: 'rt_1', seq: 5 },
    activeRun: {
      runId: 'run_excluded',
      sessionId: 's_1',
      turnId: 'turn_excluded',
      phase: 'running',
    },
    assistantDraft: { text: 'excluded draft', startedAt: 2 },
  });
  store.prependSessionHistory(
    's_1',
    [
      {
        kind: 'user',
        content: 'excluded query',
        canonicalIndex: 0,
        turnId: 'turn_excluded',
        turnUserOrdinal: 0,
      },
    ],
    10,
    { replaceLoadedWindow: true, includeLiveProjection: false },
  );

  const state = useAppStore.getState();
  assert.equal(state.userMessagesBySession.s_1?.[0]?.runtimeRunId, undefined);
  assert.equal(state.userMessagesBySession.s_1?.[0]?.historyNoAssistantSegment, true);
  assert.deepEqual(state.eventsBySession.s_1, []);
});

test('an equal snapshot enriches covered draft and tool events without replay or conflict overwrite', () => {
  useAppStore.setState({ sessions: [sidebarSession], currentSessionId: 's_1' });
  useAppStore.getState().replaceRuntimeProfileProjection(profile);
  const withoutTurn: SpaceSessionLiveProjectionT = {
    ...live,
    projectionRevision: 2,
    cursor: { runtimeId: 'rt_1', seq: 5 },
    activeRun: {
      runId: 'run_identity',
      sessionId: 's_1',
      phase: 'running',
    },
    assistantDraft: { text: 'draft locked', startedAt: 2 },
    activeTools: [
      { toolCallId: 'tool_identity', name: 'read_file', startedAt: 2, progress: 'reading' },
    ],
  };
  useAppStore.getState().replaceSessionLiveProjection(withoutTurn);
  const stateBeforeIdentity = useAppStore.getState();
  const splitEvents: SessionEvent[] = [];
  for (const event of stateBeforeIdentity.eventsBySession.s_1 ?? []) {
    if (event.kind !== 'text_delta') {
      splitEvents.push(event);
      continue;
    }
    const { turnId: _turnId, ...eventWithoutTurnId } = event;
    splitEvents.push(
      { ...eventWithoutTurnId, text: 'draft ' },
      { ...event, text: 'locked', turnId: 'turn_conflict' },
    );
  }
  useAppStore.setState({
    eventsBySession: {
      ...stateBeforeIdentity.eventsBySession,
      s_1: splitEvents,
    },
  });

  assert.equal(
    useAppStore.getState().replaceSessionLiveProjection(
      {
        ...withoutTurn,
        activeRun: { ...withoutTurn.activeRun!, turnId: 'turn_identity' },
      },
      { allowEqualHydration: true },
    ),
    true,
  );
  assert.equal(
    useAppStore.getState().replaceSessionLiveProjection(
      {
        ...withoutTurn,
        activeRun: { ...withoutTurn.activeRun!, turnId: 'turn_other' },
      },
      { allowEqualHydration: true },
    ),
    true,
  );

  const events = useAppStore.getState().eventsBySession.s_1 ?? [];
  assert.equal(
    useAppStore.getState().liveProjectionBySession.s_1?.activeRun?.turnId,
    'turn_identity',
  );
  assert.deepEqual(
    events
      .filter(
        (event): event is Extract<SessionEvent, { kind: 'text_delta' }> =>
          event.kind === 'text_delta',
      )
      .map((event) => ({ text: event.text, turnId: event.turnId })),
    [
      { text: 'draft ', turnId: 'turn_identity' },
      { text: 'locked', turnId: 'turn_conflict' },
    ],
  );
  assert.equal(events.filter((event) => event.kind === 'tool_start').length, 1);
  assert.equal(events.filter((event) => event.kind === 'tool_progress').length, 1);
  assert.equal(
    events
      .filter((event) => event.kind === 'tool_start' || event.kind === 'tool_progress')
      .every((event) => event.turnId === 'turn_identity'),
    true,
  );
});

test('an equal snapshot persists missing queued and terminal turn identities without replacing state', () => {
  useAppStore.setState({ sessions: [sidebarSession], currentSessionId: 's_1' });
  useAppStore.getState().replaceRuntimeProfileProjection(profile);
  const store = useAppStore.getState();
  const withoutIdentity: SpaceSessionLiveProjectionT = {
    ...live,
    projectionRevision: 2,
    cursor: { runtimeId: 'rt_1', seq: 5 },
    queuedRuns: [
      {
        runId: 'run_equal_queued',
        sessionId: 's_1',
        phase: 'queued',
        queuedAt: 2,
      },
    ],
    lastTerminalRun: {
      runId: 'run_equal_terminal',
      sessionId: 's_1',
      phase: 'completed',
      completedAt: 2,
    },
  };
  store.replaceSessionLiveProjection(withoutIdentity);
  assert.equal(
    store.replaceSessionLiveProjection(
      {
        ...withoutIdentity,
        queuedRuns: [{ ...withoutIdentity.queuedRuns[0]!, turnId: 'turn_equal_queued' }],
        lastTerminalRun: {
          ...withoutIdentity.lastTerminalRun!,
          turnId: 'turn_equal_terminal',
        },
      },
      { allowEqualHydration: true },
    ),
    true,
  );

  const projection = useAppStore.getState().liveProjectionBySession.s_1;
  assert.equal(projection?.queuedRuns[0]?.turnId, 'turn_equal_queued');
  assert.equal(projection?.lastTerminalRun?.turnId, 'turn_equal_terminal');
  assert.equal(projection?.projectionRevision, 2);
  assert.equal(projection?.cursor.seq, 5);
});

test('a run change that supplies turn identity opens the restored owner and enriches snapshot events', () => {
  useAppStore.setState({ sessions: [sidebarSession], currentSessionId: 's_1' });
  useAppStore.getState().replaceRuntimeProfileProjection(profile);
  const store = useAppStore.getState();
  store.prependSessionHistory(
    's_1',
    [
      {
        kind: 'user',
        content: 'incremental identity query',
        canonicalIndex: 0,
        turnId: 'turn_incremental',
        turnUserOrdinal: 0,
      },
    ],
    10,
    { replaceLoadedWindow: true, sourceRevision: 'incremental-identity-open' },
  );
  store.replaceSessionLiveProjection({
    ...live,
    projectionRevision: 2,
    cursor: { runtimeId: 'rt_1', seq: 5 },
    activeRun: {
      runId: 'run_incremental',
      sessionId: 's_1',
      phase: 'running',
    },
    assistantDraft: { text: 'incremental answer', startedAt: 2 },
  });

  assert.equal(
    store.applySessionLiveProjectionChange({
      sessionId: 's_1',
      baseProjectionRevision: 2,
      projectionRevision: 3,
      cursor: { runtimeId: 'rt_1', seq: 6 },
      change: {
        domain: 'run',
        activeRun: {
          runId: 'run_incremental',
          sessionId: 's_1',
          phase: 'running',
          turnId: 'turn_incremental',
        },
        queuedRuns: [],
      },
    }),
    'applied',
  );

  let state = useAppStore.getState();
  assert.equal(state.userMessagesBySession.s_1?.[0]?.runtimeRunId, 'run_incremental');
  assert.equal(state.userMessagesBySession.s_1?.[0]?.historyNoAssistantSegment, undefined);
  assert.equal(
    state.eventsBySession.s_1
      ?.filter((event) => event.kind === 'text_delta')
      .every((event) => event.turnId === 'turn_incremental'),
    true,
  );
  assert.equal(
    store.applySessionLiveProjectionChange({
      sessionId: 's_1',
      baseProjectionRevision: 3,
      projectionRevision: 4,
      cursor: { runtimeId: 'rt_1', seq: 7 },
      change: {
        domain: 'run',
        activeRun: {
          runId: 'run_incremental',
          sessionId: 's_1',
          phase: 'running',
          turnId: 'turn_incremental_conflict',
        },
        queuedRuns: [],
      },
    }),
    'applied',
  );
  assert.equal(
    useAppStore.getState().liveProjectionBySession.s_1?.activeRun?.turnId,
    'turn_incremental',
  );

  store.prependSessionHistory(
    's_1',
    [
      {
        kind: 'user',
        content: 'incremental identity query',
        canonicalIndex: 0,
        turnId: 'turn_incremental',
        turnUserOrdinal: 0,
      },
    ],
    10,
    { replaceLoadedWindow: true, sourceRevision: 'incremental-identity-rebuild' },
  );
  state = useAppStore.getState();
  assert.equal(state.userMessagesBySession.s_1?.[0]?.runtimeRunId, 'run_incremental');
  assert.equal(state.userMessagesBySession.s_1?.[0]?.historyNoAssistantSegment, undefined);
  assert.equal(
    composeMessages({
      events: state.eventsBySession.s_1 ?? [],
      userMessages: state.userMessagesBySession.s_1 ?? [],
    }).filter(
      (message) => message.kind === 'assistant_text' && message.text === 'incremental answer',
    ).length,
    1,
  );
});

test('a newer snapshot cannot split one run across conflicting active and terminal turn identities', () => {
  useAppStore.setState({ sessions: [sidebarSession], currentSessionId: 's_1' });
  useAppStore.getState().replaceRuntimeProfileProjection(profile);
  const store = useAppStore.getState();
  const activeRun = {
    runId: 'run_immutable_identity',
    sessionId: 's_1',
    phase: 'running' as const,
    turnId: 'turn_original',
  };
  const queuedRun = {
    runId: 'run_queued_identity',
    sessionId: 's_1',
    phase: 'queued' as const,
    turnId: 'turn_queued_original',
    queuedAt: 2,
  };
  store.replaceSessionLiveProjection({
    ...live,
    projectionRevision: 2,
    cursor: { runtimeId: 'rt_1', seq: 5 },
    activeRun,
    queuedRuns: [queuedRun],
    assistantDraft: { text: 'a', startedAt: 2 },
  });
  store.replaceSessionLiveProjection({
    ...live,
    projectionRevision: 3,
    cursor: { runtimeId: 'rt_1', seq: 6 },
    activeRun: { ...activeRun, turnId: 'turn_conflict' },
    queuedRuns: [{ ...queuedRun, turnId: 'turn_queued_conflict' }],
    assistantDraft: { text: 'ab', startedAt: 2 },
  });

  let state = useAppStore.getState();
  assert.equal(state.liveProjectionBySession.s_1?.activeRun?.turnId, 'turn_original');
  assert.equal(state.liveProjectionBySession.s_1?.queuedRuns[0]?.turnId, 'turn_queued_original');
  assert.deepEqual(
    state.eventsBySession.s_1
      ?.filter((event) => event.kind === 'text_delta')
      .map((event) => ({ text: event.text, turnId: event.turnId })),
    [
      { text: 'a', turnId: 'turn_original' },
      { text: 'b', turnId: 'turn_original' },
    ],
  );

  store.replaceSessionLiveProjection({
    ...live,
    projectionRevision: 4,
    cursor: { runtimeId: 'rt_1', seq: 7 },
    lastTerminalRun: {
      ...activeRun,
      phase: 'completed',
      turnId: 'turn_terminal_conflict',
      completedAt: 3,
    },
  });
  state = useAppStore.getState();
  assert.equal(state.liveProjectionBySession.s_1?.lastTerminalRun?.turnId, 'turn_original');
  assert.equal(
    state.eventsBySession.s_1
      ?.filter((event) => event.kind === 'text_delta')
      .every((event) => event.turnId === 'turn_original'),
    true,
  );
});

test('an equal authoritative snapshot rehydrates a transcript buffer rebuilt without its draft', () => {
  useAppStore.getState().replaceRuntimeProfileProjection(profile);
  const snapshot: SpaceSessionLiveProjectionT = {
    ...live,
    projectionRevision: 2,
    cursor: { runtimeId: 'rt_1', seq: 2 },
    activeRun: {
      runId: 'run_1',
      sessionId: 's_1',
      phase: 'running',
      startedAt: 10,
    },
    assistantDraft: { text: 'restored in-flight answer', startedAt: 10 },
  };
  assert.equal(useAppStore.getState().replaceSessionLiveProjection(snapshot), true);

  // Simulate history/LRU/window reconstruction retaining the live projection revision while the
  // renderer-only transcript buffer has been rebuilt without the cumulative Runtime draft.
  useAppStore.setState({ eventsBySession: { s_1: [] } });
  assert.equal(
    useAppStore
      .getState()
      .replaceSessionLiveProjection({ ...snapshot }, { allowEqualHydration: true }),
    true,
  );

  const restoredText = (useAppStore.getState().eventsBySession.s_1 ?? [])
    .filter(
      (event): event is Extract<SessionEvent, { kind: 'text_delta' }> =>
        event.kind === 'text_delta',
    )
    .map((event) => event.text)
    .join('');
  assert.equal(restoredText, 'restored in-flight answer');
});

test('an ordinary equal-revision snapshot does not replay cumulative live content', () => {
  useAppStore.getState().replaceRuntimeProfileProjection(profile);
  const snapshot: SpaceSessionLiveProjectionT = {
    ...live,
    projectionRevision: 2,
    cursor: { runtimeId: 'rt_1', seq: 2 },
    activeRun: {
      runId: 'run_1',
      sessionId: 's_1',
      phase: 'running',
      startedAt: 10,
    },
    assistantDraft: { text: 'do not replay me', startedAt: 10 },
  };
  useAppStore.getState().replaceSessionLiveProjection(snapshot);
  useAppStore.setState({ eventsBySession: { s_1: [] } });

  assert.equal(useAppStore.getState().replaceSessionLiveProjection({ ...snapshot }), false);

  assert.deepEqual(useAppStore.getState().eventsBySession.s_1, []);
});

test('a terminal profile clears old pending admission once without suppressing a later send', () => {
  useAppStore.setState({ sessions: [sidebarSession] });
  const queuedProfile: SpaceRuntimeProfileProjectionT = {
    ...profile,
    projectionRevision: 2,
    cursor: { runtimeId: 'rt_1', seq: 2 },
    sessions: [
      {
        sessionId: 's_1',
        surface: 'code',
        createdAt: 1,
        lastActivityAt: 2,
        queuedRuns: [
          {
            runId: 'run_queued',
            sessionId: 's_1',
            phase: 'queued',
            queuedAt: 2,
          },
        ],
      },
    ],
  };
  useAppStore.getState().replaceRuntimeProfileProjection(queuedProfile);
  const messageId = useAppStore.getState().appendUserMessage('s_1', 'queued request');
  assert.notEqual(messageId, null);
  useAppStore.getState().setPendingSend('s_1', true);
  useAppStore.getState().acknowledgePendingSendRun('s_1', 'run_queued');
  useAppStore.getState().bindUserMessageRuntimeRun('s_1', messageId!, 'run_queued');

  const terminalProfile: SpaceRuntimeProfileProjectionT = {
    ...queuedProfile,
    projectionRevision: 3,
    cursor: { runtimeId: 'rt_1', seq: 3 },
    sessions: [
      {
        ...queuedProfile.sessions[0]!,
        queuedRuns: [],
        lastTerminalRun: {
          runId: 'run_queued',
          sessionId: 's_1',
          phase: 'completed',
          completedAt: 3,
        },
      },
    ],
  };
  useAppStore.getState().replaceRuntimeProfileProjection(terminalProfile);
  assert.equal(useAppStore.getState().pendingSendBySession.s_1, undefined);

  useAppStore.getState().setPendingSend('s_1', true);
  useAppStore.getState().replaceRuntimeProfileProjection({
    ...terminalProfile,
    projectionRevision: 4,
    cursor: { runtimeId: 'rt_1', seq: 4 },
  });
  assert.equal(useAppStore.getState().pendingSendBySession.s_1, true);
});

test('a delayed profile terminal cannot clear a new pending admission after the same live terminal', () => {
  useAppStore.getState().replaceRuntimeProfileProjection(profile);
  useAppStore.getState().replaceSessionLiveProjection({
    ...live,
    projectionRevision: 4,
    cursor: { runtimeId: 'rt_1', seq: 4 },
    lastTerminalRun: {
      runId: 'run_previous',
      sessionId: 's_1',
      phase: 'completed',
      completedAt: 4,
    },
  });
  useAppStore.getState().setPendingSend('s_1', true);

  useAppStore.getState().replaceRuntimeProfileProjection({
    ...profile,
    projectionRevision: 5,
    cursor: { runtimeId: 'rt_1', seq: 5 },
    sessions: [
      {
        sessionId: 's_1',
        surface: 'code',
        createdAt: 1,
        lastActivityAt: 5,
        queuedRuns: [],
        lastTerminalRun: {
          runId: 'run_previous',
          sessionId: 's_1',
          phase: 'completed',
          completedAt: 4,
        },
      },
    ],
  });

  assert.equal(useAppStore.getState().pendingSendBySession.s_1, true);
});

test('an unscoped pending admission ignores stale lifecycle events before its Runtime ACK', () => {
  useAppStore.getState().setPendingSend('s_1', true);

  useAppStore.getState().appendEvent({
    kind: 'session_complete',
    sessionId: 's_1',
  });

  assert.equal(useAppStore.getState().pendingSendBySession.s_1, true);
});

test('a cold Runtime authority edge preserves pending and an already-observed exact Run clears on ACK', () => {
  useAppStore.getState().setPendingSend('s_1', true);
  useAppStore.getState().setCoderRuntimeConnection(profile.connection);
  useAppStore.getState().replaceRuntimeProfileProjection({
    ...profile,
    projectionRevision: 2,
    cursor: { runtimeId: 'rt_1', seq: 2 },
    sessions: [
      {
        sessionId: 's_1',
        surface: 'code',
        createdAt: 1,
        lastActivityAt: 2,
        activeRun: {
          runId: 'run_cold_start',
          sessionId: 's_1',
          phase: 'running',
          startedAt: 2,
        },
        queuedRuns: [],
      },
    ],
  });
  assert.equal(
    useAppStore.getState().pendingSendBySession.s_1,
    true,
    'Runtime bootstrap must not erase an in-flight local admission',
  );

  useAppStore.getState().acknowledgePendingSendRun('s_1', 'run_cold_start');

  assert.equal(useAppStore.getState().pendingSendBySession.s_1, undefined);
});

test('a pending admission clears only for its acknowledged Run once the ACK is known', () => {
  useAppStore.setState({ sessions: [sidebarSession] });
  useAppStore.getState().replaceRuntimeProfileProjection(profile);
  const messageId = useAppStore.getState().appendUserMessage('s_1', 'new request');
  assert.notEqual(messageId, null);
  useAppStore.getState().setPendingSend('s_1', true);

  const delayedPreviousTerminal: SpaceRuntimeProfileProjectionT = {
    ...profile,
    projectionRevision: 2,
    cursor: { runtimeId: 'rt_1', seq: 2 },
    sessions: [
      {
        sessionId: 's_1',
        surface: 'code',
        createdAt: 1,
        lastActivityAt: 2,
        queuedRuns: [],
        lastTerminalRun: {
          runId: 'run_previous',
          sessionId: 's_1',
          phase: 'completed',
          completedAt: 2,
        },
      },
    ],
  };
  useAppStore.getState().replaceRuntimeProfileProjection(delayedPreviousTerminal);
  assert.equal(
    useAppStore.getState().pendingSendBySession.s_1,
    true,
    'a terminal that arrives before the send ACK is not admission evidence',
  );

  useAppStore.getState().acknowledgePendingSendRun('s_1', 'run_new');
  useAppStore.getState().bindUserMessageRuntimeRun('s_1', messageId!, 'run_new');
  useAppStore.getState().replaceRuntimeProfileProjection({
    ...delayedPreviousTerminal,
    projectionRevision: 3,
    cursor: { runtimeId: 'rt_1', seq: 3 },
  });
  assert.equal(
    useAppStore.getState().pendingSendBySession.s_1,
    true,
    'a newer delivery of the previous terminal cannot satisfy the acknowledged Run',
  );

  useAppStore.getState().replaceRuntimeProfileProjection({
    ...delayedPreviousTerminal,
    projectionRevision: 4,
    cursor: { runtimeId: 'rt_1', seq: 4 },
    sessions: [
      {
        ...delayedPreviousTerminal.sessions[0]!,
        activeRun: {
          runId: 'run_new',
          sessionId: 's_1',
          phase: 'running',
          startedAt: 4,
        },
        lastTerminalRun: undefined,
      },
    ],
  });
  assert.equal(useAppStore.getState().pendingSendBySession.s_1, undefined);
});

test('a same-Run terminal observed before the send ACK clears immediately when the ACK binds', () => {
  useAppStore.setState({ sessions: [sidebarSession] });
  useAppStore.getState().replaceRuntimeProfileProjection(profile);
  useAppStore.getState().setPendingSend('s_1', true);
  useAppStore.getState().replaceRuntimeProfileProjection({
    ...profile,
    projectionRevision: 2,
    cursor: { runtimeId: 'rt_1', seq: 2 },
    sessions: [
      {
        sessionId: 's_1',
        surface: 'code',
        createdAt: 1,
        lastActivityAt: 2,
        queuedRuns: [],
        lastTerminalRun: {
          runId: 'run_fast',
          sessionId: 's_1',
          phase: 'completed',
          completedAt: 2,
        },
      },
    ],
  });
  assert.equal(useAppStore.getState().pendingSendBySession.s_1, true);

  useAppStore.getState().acknowledgePendingSendRun('s_1', 'run_fast');

  assert.equal(useAppStore.getState().pendingSendBySession.s_1, undefined);
});

test('a Runtime ACK clears pending independently of an optimistic user row', () => {
  useAppStore.getState().replaceRuntimeProfileProjection(profile);
  useAppStore.getState().setPendingSend('s_1', true);

  useAppStore.getState().acknowledgePendingSendRun('s_1', 'run_without_local_row');
  useAppStore.getState().replaceSessionLiveProjection({
    ...live,
    projectionRevision: 2,
    cursor: { runtimeId: 'rt_1', seq: 2 },
    activeRun: {
      runId: 'run_without_local_row',
      sessionId: 's_1',
      phase: 'running',
      startedAt: 2,
    },
  });

  assert.equal(useAppStore.getState().pendingSendBySession.s_1, undefined);
});

test('an aggregate profile cursor from another Session cannot pin a local pending send', () => {
  useAppStore.getState().replaceRuntimeProfileProjection({
    ...profile,
    projectionRevision: 1_000,
    cursor: { runtimeId: 'rt_1', seq: 1_000 },
  });
  useAppStore.getState().replaceSessionLiveProjection({
    ...live,
    projectionRevision: 2,
    cursor: {
      runtimeId: 'rt_1',
      sessionId: 's_1',
      journalEpoch: 'epoch_s1',
      seq: 2,
    },
  });
  useAppStore.getState().setPendingSend('s_1', true);
  useAppStore.getState().acknowledgePendingSendRun('s_1', 'run_local');

  useAppStore.getState().replaceSessionLiveProjection({
    ...live,
    projectionRevision: 3,
    cursor: {
      runtimeId: 'rt_1',
      sessionId: 's_1',
      journalEpoch: 'epoch_s1',
      seq: 3,
    },
    activeRun: {
      runId: 'run_local',
      sessionId: 's_1',
      phase: 'running',
      startedAt: 3,
    },
  });

  assert.equal(useAppStore.getState().pendingSendBySession.s_1, undefined);
});

test('a new Session journal epoch can confirm an exact send after its sequence resets', () => {
  useAppStore.getState().replaceRuntimeProfileProjection(profile);
  useAppStore.getState().replaceSessionLiveProjection({
    ...live,
    projectionRevision: 1_000,
    cursor: {
      runtimeId: 'rt_1',
      sessionId: 's_1',
      journalEpoch: 'epoch_old',
      seq: 1_000,
    },
  });
  useAppStore.getState().setPendingSend('s_1', true);
  useAppStore.getState().acknowledgePendingSendRun('s_1', 'run_new_epoch');

  useAppStore.getState().replaceSessionLiveProjection({
    ...live,
    projectionRevision: 1,
    cursor: {
      runtimeId: 'rt_1',
      sessionId: 's_1',
      journalEpoch: 'epoch_new',
      seq: 1,
    },
    activeRun: {
      runId: 'run_new_epoch',
      sessionId: 's_1',
      phase: 'running',
      startedAt: 1,
    },
  });

  assert.equal(useAppStore.getState().pendingSendBySession.s_1, undefined);
});

test('an old Run start before the send ACK cannot clear the new pending admission', () => {
  useAppStore.setState({ sessions: [sidebarSession] });
  useAppStore.getState().replaceRuntimeProfileProjection(profile);
  const messageId = useAppStore.getState().appendUserMessage('s_1', 'next request');
  assert.notEqual(messageId, null);
  useAppStore.getState().setPendingSend('s_1', true);
  useAppStore.getState().replaceSessionLiveProjection({
    ...live,
    projectionRevision: 2,
    cursor: { runtimeId: 'rt_1', seq: 2 },
    activeRun: {
      runId: 'run_previous',
      sessionId: 's_1',
      phase: 'running',
      startedAt: 2,
    },
  });
  assert.equal(useAppStore.getState().pendingSendBySession.s_1, true);

  useAppStore.getState().acknowledgePendingSendRun('s_1', 'run_new');
  useAppStore.getState().bindUserMessageRuntimeRun('s_1', messageId!, 'run_new');
  assert.equal(useAppStore.getState().pendingSendBySession.s_1, true);
  useAppStore.getState().replaceSessionLiveProjection({
    ...live,
    projectionRevision: 3,
    cursor: { runtimeId: 'rt_1', seq: 3 },
    activeRun: {
      runId: 'run_new',
      sessionId: 's_1',
      phase: 'running',
      startedAt: 3,
    },
  });
  assert.equal(useAppStore.getState().pendingSendBySession.s_1, undefined);
});

test('a late ACK from a timed-out send cannot bind or clear the next local admission generation', () => {
  useAppStore.getState().replaceRuntimeProfileProjection(profile);
  const firstGeneration = useAppStore.getState().setPendingSend('s_1', true);
  useAppStore.getState().setPendingSend('s_1', false, firstGeneration);
  const secondGeneration = useAppStore.getState().setPendingSend('s_1', true);
  assert.notEqual(firstGeneration, secondGeneration);

  useAppStore.getState().acknowledgePendingSendRun('s_1', 'run_timed_out', firstGeneration);
  useAppStore.getState().replaceSessionLiveProjection({
    ...live,
    projectionRevision: 2,
    cursor: { runtimeId: 'rt_1', seq: 2 },
    activeRun: {
      runId: 'run_timed_out',
      sessionId: 's_1',
      phase: 'running',
      startedAt: 2,
    },
  });
  assert.equal(useAppStore.getState().pendingSendBySession.s_1, true);

  useAppStore.getState().acknowledgePendingSendRun('s_1', 'run_retry', secondGeneration);
  useAppStore.getState().replaceSessionLiveProjection({
    ...live,
    projectionRevision: 3,
    cursor: { runtimeId: 'rt_1', seq: 3 },
    activeRun: {
      runId: 'run_retry',
      sessionId: 's_1',
      phase: 'running',
      startedAt: 3,
    },
  });
  assert.equal(useAppStore.getState().pendingSendBySession.s_1, undefined);
});

test('each overlapping send attempt owns a fresh pending admission generation', () => {
  useAppStore.getState().replaceRuntimeProfileProjection(profile);
  const firstGeneration = useAppStore.getState().setPendingSend('s_1', true);
  const secondGeneration = useAppStore.getState().setPendingSend('s_1', true);

  assert.notEqual(firstGeneration, secondGeneration);
  useAppStore.getState().setPendingSend('s_1', false, firstGeneration);
  assert.equal(useAppStore.getState().pendingSendBySession.s_1, true);

  useAppStore.getState().acknowledgePendingSendRun('s_1', 'run_second', secondGeneration);
  useAppStore.getState().replaceSessionLiveProjection({
    ...live,
    projectionRevision: 2,
    cursor: { runtimeId: 'rt_1', seq: 2 },
    activeRun: {
      runId: 'run_second',
      sessionId: 's_1',
      phase: 'running',
      startedAt: 2,
    },
  });
  assert.equal(useAppStore.getState().pendingSendBySession.s_1, undefined);
});

test('equal terminal hydration only closes residual live tools and does not invent answer text', () => {
  useAppStore.getState().replaceRuntimeProfileProjection(profile);
  const terminal: SpaceSessionLiveProjectionT = {
    ...live,
    projectionRevision: 2,
    cursor: { runtimeId: 'rt_1', seq: 2 },
    lastTerminalRun: {
      runId: 'run_terminal',
      sessionId: 's_1',
      phase: 'completed',
      completedAt: 2,
    },
    thinkingDraft: { text: 'must not hydrate terminal thinking', startedAt: 1 },
    assistantDraft: { text: 'must not hydrate terminal answer', startedAt: 1 },
    activeTools: [],
  };
  useAppStore.getState().replaceSessionLiveProjection(terminal);
  useAppStore.setState({
    eventsBySession: {
      s_1: [
        { kind: 'session_start', sessionId: 's_1', provider: 'mock' },
        {
          kind: 'text_delta',
          sessionId: 's_1',
          text: 'already rendered prefix',
        },
        {
          kind: 'tool_start',
          sessionId: 's_1',
          toolId: 'tool_residual',
          toolName: 'read',
          input: {},
          runtimeEvent: { runtimeId: 'rt_1', runId: 'run_terminal', seq: 1 },
        },
      ],
    },
  });

  assert.equal(
    useAppStore
      .getState()
      .replaceSessionLiveProjection({ ...terminal }, { allowEqualHydration: true }),
    true,
  );
  const events = useAppStore.getState().eventsBySession.s_1 ?? [];
  assert.equal(
    events
      .filter((event) => event.kind === 'text_delta')
      .map((event) => event.text)
      .join(''),
    'already rendered prefix',
  );
  assert.equal(
    events.some((event) => event.kind === 'tool_start' && event.toolId === 'tool_residual'),
    false,
  );
});

test('snapshot cursor reconciles a delivered suffix and rejects a covered late delta', () => {
  useAppStore.setState({ currentSessionId: 's_1', eventsBySession: { s_1: [] } });
  useAppStore.getState().replaceRuntimeProfileProjection(profile);
  useAppStore.getState().appendEvent({
    kind: 'text_delta',
    sessionId: 's_1',
    text: 'c',
    runtimeEvent: { runtimeId: 'rt_1', runId: 'run_1', seq: 3 },
  });

  const snapshot: SpaceSessionLiveProjectionT = {
    ...live,
    projectionRevision: 2,
    cursor: { runtimeId: 'rt_1', seq: 3 },
    activeRun: {
      runId: 'run_1',
      sessionId: 's_1',
      phase: 'running',
      startedAt: 10,
    },
    assistantDraft: { text: 'abc', startedAt: 10 },
  };
  useAppStore.getState().replaceSessionLiveProjection(snapshot);
  useAppStore.getState().appendEvent({
    kind: 'text_delta',
    sessionId: 's_1',
    text: 'c',
    runtimeEvent: { runtimeId: 'rt_1', runId: 'run_1', seq: 3 },
  });
  useAppStore.getState().appendEvent({
    kind: 'text_delta',
    sessionId: 's_1',
    text: 'd',
    runtimeEvent: { runtimeId: 'rt_1', runId: 'run_1', seq: 4 },
  });

  const events = useAppStore.getState().eventsBySession.s_1 ?? [];
  assert.equal(
    events
      .filter(
        (event): event is Extract<SessionEvent, { kind: 'text_delta' }> =>
          event.kind === 'text_delta',
      )
      .map((event) => event.text)
      .join(''),
    'abcd',
  );
  assert.deepEqual(useAppStore.getState().runtimeSnapshotCursorBySession.s_1, {
    runtimeId: 'rt_1',
    seq: 3,
    runId: 'run_1',
    assistantDraftSeq: 3,
  });
});

test('snapshot-first delivery drops an included delta but admits the next cursor', () => {
  useAppStore.setState({ currentSessionId: 's_1', eventsBySession: { s_1: [] } });
  useAppStore.getState().replaceRuntimeProfileProjection(profile);
  useAppStore.getState().replaceSessionLiveProjection({
    ...live,
    projectionRevision: 2,
    cursor: { runtimeId: 'rt_1', seq: 3 },
    activeRun: {
      runId: 'run_1',
      sessionId: 's_1',
      phase: 'running',
      startedAt: 10,
    },
    assistantDraft: { text: 'abc', startedAt: 10 },
  });
  useAppStore.getState().appendEvent({
    kind: 'text_delta',
    sessionId: 's_1',
    text: 'c',
    runtimeEvent: { runtimeId: 'rt_1', runId: 'run_1', seq: 3 },
  });
  useAppStore.getState().appendEvent({
    kind: 'text_delta',
    sessionId: 's_1',
    text: 'd',
    runtimeEvent: { runtimeId: 'rt_1', runId: 'run_1', seq: 4 },
  });

  const text = (useAppStore.getState().eventsBySession.s_1 ?? [])
    .filter(
      (event): event is Extract<SessionEvent, { kind: 'text_delta' }> =>
        event.kind === 'text_delta',
    )
    .map((event) => event.text)
    .join('');
  assert.equal(text, 'abcd');
});

test('snapshot recovery fills a missing middle delta without replaying delivered chunks', () => {
  useAppStore.setState({ currentSessionId: 's_1', eventsBySession: { s_1: [] } });
  useAppStore.getState().replaceRuntimeProfileProjection(profile);
  useAppStore.getState().appendEvent({
    kind: 'text_delta',
    sessionId: 's_1',
    text: 'a',
    runtimeEvent: { runtimeId: 'rt_1', runId: 'run_1', seq: 2 },
  });
  useAppStore.getState().appendEvent({
    kind: 'text_delta',
    sessionId: 's_1',
    text: 'c',
    runtimeEvent: { runtimeId: 'rt_1', runId: 'run_1', seq: 4 },
  });

  const snapshot: SpaceSessionLiveProjectionT = {
    ...live,
    projectionRevision: 2,
    cursor: { runtimeId: 'rt_1', seq: 4 },
    activeRun: {
      runId: 'run_1',
      sessionId: 's_1',
      phase: 'running',
      startedAt: 10,
    },
    assistantDraft: { text: 'abc', startedAt: 10 },
  };
  useAppStore.getState().replaceSessionLiveProjection(snapshot);
  useAppStore.getState().replaceSessionLiveProjection({
    ...snapshot,
    projectionRevision: 3,
    cursor: { runtimeId: 'rt_1', seq: 5 },
  });

  assert.equal(
    (useAppStore.getState().eventsBySession.s_1 ?? [])
      .filter(
        (event): event is Extract<SessionEvent, { kind: 'text_delta' }> =>
          event.kind === 'text_delta',
      )
      .map((event) => event.text)
      .join(''),
    'abc',
  );
});

test('snapshot recovery never treats another run text as current-run cumulative coverage', () => {
  useAppStore.setState({ currentSessionId: 's_1', eventsBySession: { s_1: [] } });
  useAppStore.getState().replaceRuntimeProfileProjection(profile);
  useAppStore.getState().appendEvent({
    kind: 'text_delta',
    sessionId: 's_1',
    text: 'sa',
    runtimeEvent: { runtimeId: 'rt_1', runId: 'run_old', seq: 2 },
  });
  useAppStore.getState().appendEvent({
    kind: 'text_delta',
    sessionId: 's_1',
    text: 'me',
    runtimeEvent: { runtimeId: 'rt_1', runId: 'run_2', seq: 4 },
  });

  useAppStore.getState().replaceSessionLiveProjection({
    ...live,
    projectionRevision: 2,
    cursor: { runtimeId: 'rt_1', seq: 4 },
    activeRun: {
      runId: 'run_2',
      sessionId: 's_1',
      phase: 'running',
      startedAt: 10,
    },
    assistantDraft: { text: 'same', startedAt: 10 },
  });

  const currentRunText = (useAppStore.getState().eventsBySession.s_1 ?? [])
    .filter(
      (event): event is Extract<SessionEvent, { kind: 'text_delta' }> =>
        event.kind === 'text_delta' && event.runtimeEvent?.runId === 'run_2',
    )
    .map((event) => event.text)
    .join('');
  assert.equal(currentRunText, 'same');
});

test('snapshot barrier remains scoped to its run when the next run starts', () => {
  useAppStore.setState({ currentSessionId: 's_1', eventsBySession: { s_1: [] } });
  useAppStore.getState().replaceRuntimeProfileProjection(profile);
  useAppStore.getState().replaceSessionLiveProjection({
    ...live,
    projectionRevision: 2,
    cursor: { runtimeId: 'rt_1', seq: 3 },
    activeRun: {
      runId: 'run_1',
      sessionId: 's_1',
      phase: 'running',
      startedAt: 10,
    },
    assistantDraft: { text: 'first', startedAt: 10 },
  });
  useAppStore.getState().appendEvent({
    kind: 'text_delta',
    sessionId: 's_1',
    text: '-late-old',
    runtimeEvent: { runtimeId: 'rt_1', runId: 'run_1', seq: 3 },
  });
  useAppStore.getState().appendEvent({
    kind: 'text_delta',
    sessionId: 's_1',
    text: '-new-run',
    runtimeEvent: { runtimeId: 'rt_1', runId: 'run_2', seq: 2 },
  });

  const text = (useAppStore.getState().eventsBySession.s_1 ?? [])
    .filter(
      (event): event is Extract<SessionEvent, { kind: 'text_delta' }> =>
        event.kind === 'text_delta',
    )
    .map((event) => event.text)
    .join('');
  assert.equal(text, 'first-new-run');
});

test('stream batching never merges covered and post-snapshot Runtime deltas', () => {
  const covered = {
    kind: 'text_delta' as const,
    sessionId: 's_1',
    text: 'c',
    runtimeEvent: { runtimeId: 'rt_1', runId: 'run_1', seq: 3 },
  };
  const after = {
    ...covered,
    text: 'd',
    runtimeEvent: { ...covered.runtimeEvent, seq: 4 },
  };
  const later = {
    ...after,
    text: 'e',
    runtimeEvent: { ...after.runtimeEvent, seq: 5 },
  };
  const cursor = { runtimeId: 'rt_1', runId: 'run_1', seq: 3, assistantDraftSeq: 3 };

  assert.equal(runtimeDeltasShareSnapshotSide(covered, after, cursor), false);
  assert.equal(runtimeDeltasShareSnapshotSide(after, later, cursor), true);
});

test('app store keeps live Runtime drafts bounded across frames without crossing a snapshot', () => {
  useAppStore.setState({ currentSessionId: 's_1', eventsBySession: { s_1: [] } });
  useAppStore.getState().replaceRuntimeProfileProjection(profile);
  useAppStore.getState().replaceSessionLiveProjection({
    ...live,
    projectionRevision: 2,
    cursor: { runtimeId: 'rt_1', seq: 3 },
    activeRun: {
      runId: 'run_1',
      sessionId: 's_1',
      phase: 'running',
      startedAt: 10,
    },
    assistantDraft: { text: 'abc', startedAt: 10 },
  });

  for (let seq = 4; seq <= 1_003; seq += 1) {
    useAppStore.getState().appendEvent({
      kind: 'text_delta',
      sessionId: 's_1',
      text: String(seq % 10),
      runtimeEvent: { runtimeId: 'rt_1', runId: 'run_1', seq },
    });
  }

  const textEvents = (useAppStore.getState().eventsBySession.s_1 ?? []).filter(
    (event): event is Extract<SessionEvent, { kind: 'text_delta' }> => event.kind === 'text_delta',
  );
  assert.equal(textEvents.length, 2, 'snapshot-covered and post-snapshot text stay separate');
  assert.equal(textEvents[0]?.text, 'abc');
  assert.equal(
    textEvents[1]?.text,
    Array.from({ length: 1_000 }, (_, index) => String((index + 4) % 10)).join(''),
  );
  assert.equal(textEvents[1]?.runtimeEvent?.seq, 1_003);
});

test('app store coalesces adjacent tool input and replaces adjacent progress across frames', () => {
  useAppStore.setState({ currentSessionId: 's_1', eventsBySession: { s_1: [] } });
  useAppStore.getState().replaceRuntimeProfileProjection(profile);
  const runtimeEvent = { runtimeId: 'rt_1', runId: 'run_1', seq: 1 };

  useAppStore.getState().appendEvent({
    kind: 'tool_input_delta',
    sessionId: 's_1',
    toolId: 'tool_1',
    toolName: 'write',
    partialJson: '{"path":',
    runtimeEvent,
  });
  useAppStore.getState().appendEvent({
    kind: 'tool_input_delta',
    sessionId: 's_1',
    toolId: 'tool_1',
    toolName: 'write',
    partialJson: '"README.md"}',
    runtimeEvent: { ...runtimeEvent, seq: 2 },
  });
  useAppStore.getState().appendEvent({
    kind: 'tool_progress',
    sessionId: 's_1',
    toolId: 'tool_1',
    message: 'writing 10%',
    runtimeEvent: { ...runtimeEvent, seq: 3 },
  });
  useAppStore.getState().appendEvent({
    kind: 'tool_progress',
    sessionId: 's_1',
    toolId: 'tool_1',
    message: 'writing 90%',
    runtimeEvent: { ...runtimeEvent, seq: 4 },
  });

  const events = useAppStore.getState().eventsBySession.s_1 ?? [];
  assert.equal(events.length, 2);
  assert.equal(
    events[0]?.kind === 'tool_input_delta' ? events[0].partialJson : undefined,
    '{"path":"README.md"}',
  );
  assert.equal(events[1]?.kind === 'tool_progress' ? events[1].message : undefined, 'writing 90%');
});

test('app store keeps ambiguous tool input without a call id as separate events', () => {
  useAppStore.setState({ currentSessionId: 's_1', eventsBySession: { s_1: [] } });

  useAppStore.getState().appendEvent({
    kind: 'tool_input_delta',
    sessionId: 's_1',
    toolName: 'write',
    partialJson: '{"first":true}',
  });
  useAppStore.getState().appendEvent({
    kind: 'tool_input_delta',
    sessionId: 's_1',
    toolName: 'write',
    partialJson: '{"second":true}',
  });

  const events = useAppStore.getState().eventsBySession.s_1 ?? [];
  assert.deepEqual(
    events.map((event) => (event.kind === 'tool_input_delta' ? event.partialJson : undefined)),
    ['{"first":true}', '{"second":true}'],
  );
});

test('app store exposes a stable root-compaction render-busy projection', () => {
  useAppStore.setState({
    currentSessionId: 's_1',
    eventsBySession: { s_1: [] },
    compactingBySession: {},
  });

  useAppStore.getState().appendEvent({
    kind: 'compact_start',
    sessionId: 's_1',
    contextKind: 'child',
  });
  assert.equal(useAppStore.getState().compactingBySession.s_1, undefined);

  useAppStore.getState().appendEvent({
    kind: 'compact_start',
    sessionId: 's_1',
    contextKind: 'root',
  });
  assert.equal(useAppStore.getState().compactingBySession.s_1, true);

  useAppStore.getState().appendEvent({
    kind: 'compact_end',
    sessionId: 's_1',
    contextKind: 'root',
  });
  assert.equal(useAppStore.getState().compactingBySession.s_1, undefined);
});

test('removing a session clears only its compaction render-busy projection', () => {
  useAppStore.setState({
    currentSessionId: 's_1',
    eventsBySession: { s_1: [], s_2: [] },
    compactingBySession: { s_1: true, s_2: true },
  });

  useAppStore.getState().removeSession('s_1');

  assert.equal(useAppStore.getState().compactingBySession.s_1, undefined);
  assert.equal(useAppStore.getState().compactingBySession.s_2, true);
});

test('snapshot inserts a missing tool start before orphan progress and remains idempotent', () => {
  useAppStore.setState({ currentSessionId: 's_1', eventsBySession: { s_1: [] } });
  useAppStore.getState().replaceRuntimeProfileProjection(profile);
  useAppStore.getState().appendEvent({
    kind: 'tool_progress',
    sessionId: 's_1',
    toolId: 'tool_1',
    message: 'reading',
    runtimeEvent: { runtimeId: 'rt_1', runId: 'run_1', seq: 3 },
  });

  const snapshot: SpaceSessionLiveProjectionT = {
    ...live,
    projectionRevision: 2,
    cursor: { runtimeId: 'rt_1', seq: 3 },
    activeRun: {
      runId: 'run_1',
      sessionId: 's_1',
      phase: 'running',
      startedAt: 10,
    },
    activeTools: [{ toolCallId: 'tool_1', name: 'read_file', startedAt: 11, progress: 'reading' }],
  };
  useAppStore.getState().replaceSessionLiveProjection(snapshot);
  useAppStore.getState().replaceSessionLiveProjection({
    ...snapshot,
    projectionRevision: 3,
  });

  const toolEvents = (useAppStore.getState().eventsBySession.s_1 ?? []).filter(
    (event) =>
      (event.kind === 'tool_start' || event.kind === 'tool_progress') && event.toolId === 'tool_1',
  );
  assert.deepEqual(
    toolEvents.map((event) => event.kind),
    ['tool_start', 'tool_progress'],
  );
  assert.equal(toolEvents.filter((event) => event.kind === 'tool_start').length, 1);
  assert.equal(toolEvents.filter((event) => event.kind === 'tool_progress').length, 1);
});

test('authoritative active-tool set removes covered orphan running cards', () => {
  useAppStore.setState({ currentSessionId: 's_1', eventsBySession: { s_1: [] } });
  useAppStore.getState().replaceRuntimeProfileProjection(profile);
  useAppStore.getState().appendEvent({
    kind: 'tool_start',
    sessionId: 's_1',
    toolId: 'tool_stale',
    toolName: 'read_file',
    input: {},
    runtimeEvent: { runtimeId: 'rt_1', runId: 'run_1', seq: 2 },
  });
  useAppStore.getState().appendEvent({
    kind: 'tool_progress',
    sessionId: 's_1',
    toolId: 'tool_stale',
    message: 'reading',
    runtimeEvent: { runtimeId: 'rt_1', runId: 'run_1', seq: 3 },
  });
  useAppStore.getState().replaceSessionLiveProjection({
    ...live,
    projectionRevision: 2,
    cursor: { runtimeId: 'rt_1', seq: 4 },
    activeRun: {
      runId: 'run_1',
      sessionId: 's_1',
      phase: 'running',
      startedAt: 10,
    },
    activeTools: [],
  });

  assert.equal(
    (useAppStore.getState().eventsBySession.s_1 ?? []).some(
      (event) =>
        (event.kind === 'tool_start' || event.kind === 'tool_progress') &&
        event.toolId === 'tool_stale',
    ),
    false,
  );
});

test('terminal snapshot closes stale tools without moving or replaying completed text', () => {
  useAppStore.setState({
    currentSessionId: 's_1',
    eventsBySession: {
      s_1: [
        {
          kind: 'session_start',
          sessionId: 's_1',
          provider: 'custom',
          runtimeEvent: { runtimeId: 'rt_1', runId: 'run_1', seq: 1 },
        },
        {
          kind: 'text_delta',
          sessionId: 's_1',
          text: 'abc',
          runtimeEvent: { runtimeId: 'rt_1', runId: 'run_1', seq: 2 },
        },
        {
          kind: 'tool_start',
          sessionId: 's_1',
          toolId: 'tool_stale',
          toolName: 'read_file',
          input: {},
          runtimeEvent: { runtimeId: 'rt_1', runId: 'run_1', seq: 3 },
        },
        {
          kind: 'session_complete',
          sessionId: 's_1',
          runtimeEvent: { runtimeId: 'rt_1', runId: 'run_1', seq: 4 },
        },
      ],
    },
  });
  useAppStore.getState().replaceRuntimeProfileProjection(profile);
  useAppStore.getState().replaceSessionLiveProjection({
    ...live,
    projectionRevision: 2,
    cursor: { runtimeId: 'rt_1', seq: 4 },
    assistantDraft: { text: 'abc', startedAt: 10 },
    lastTerminalRun: {
      runId: 'run_1',
      sessionId: 's_1',
      phase: 'completed',
      startedAt: 10,
      completedAt: 20,
    },
    activeTools: [],
  });

  const events = useAppStore.getState().eventsBySession.s_1 ?? [];
  assert.equal(
    events
      .filter(
        (event): event is Extract<SessionEvent, { kind: 'text_delta' }> =>
          event.kind === 'text_delta',
      )
      .map((event) => event.text)
      .join(''),
    'abc',
  );
  assert.equal(
    events.some((event) => event.kind === 'tool_start'),
    false,
  );
  assert.equal(events.at(-1)?.kind, 'session_complete');
});

test('terminal snapshot without drafts does not discard covered deltas still queued in the renderer', () => {
  useAppStore.setState({ currentSessionId: 's_1', eventsBySession: { s_1: [] } });
  useAppStore.getState().replaceRuntimeProfileProjection(profile);
  const state = useAppStore.getState();
  state.replaceSessionLiveProjection({
    ...live,
    projectionRevision: 2,
    cursor: { runtimeId: 'rt_1', seq: 42 },
    lastTerminalRun: {
      runId: 'run_terminal_queue',
      sessionId: 's_1',
      phase: 'completed',
      startedAt: 10,
      completedAt: 20,
    },
    activeTools: [],
  });

  state.appendEvent({
    kind: 'thinking_delta',
    sessionId: 's_1',
    text: 'queued thought',
    runtimeEvent: {
      runtimeId: 'rt_1',
      runId: 'run_terminal_queue',
      seq: 40,
    },
  });
  state.appendEvent({
    kind: 'text_delta',
    sessionId: 's_1',
    text: 'queued answer',
    runtimeEvent: {
      runtimeId: 'rt_1',
      runId: 'run_terminal_queue',
      seq: 41,
    },
  });

  assert.equal(
    useAppStore
      .getState()
      .eventsBySession.s_1?.filter((event) => event.kind === 'thinking_delta')
      .map((event) => event.text)
      .join(''),
    'queued thought',
  );
  assert.equal(
    useAppStore
      .getState()
      .eventsBySession.s_1?.filter((event) => event.kind === 'text_delta')
      .map((event) => event.text)
      .join(''),
    'queued answer',
  );
});

test('terminal snapshot preserves only the earlier draft coverage watermark for the same run', () => {
  useAppStore.setState({ currentSessionId: 's_1', eventsBySession: { s_1: [] } });
  useAppStore.getState().replaceRuntimeProfileProjection(profile);
  const state = useAppStore.getState();
  const activeRun = {
    runId: 'run_terminal_rerun',
    sessionId: 's_1',
    phase: 'running' as const,
    startedAt: 10,
  };
  state.replaceSessionLiveProjection({
    ...live,
    projectionRevision: 2,
    cursor: { runtimeId: 'rt_1', seq: 10 },
    activeRun,
    assistantDraft: { text: 'covered', startedAt: 10 },
  });
  state.replaceSessionLiveProjection({
    ...live,
    projectionRevision: 3,
    cursor: { runtimeId: 'rt_1', seq: 20 },
    lastTerminalRun: {
      ...activeRun,
      phase: 'completed',
      completedAt: 20,
    },
  });

  assert.deepEqual(useAppStore.getState().runtimeSnapshotCursorBySession.s_1, {
    runtimeId: 'rt_1',
    seq: 20,
    runId: 'run_terminal_rerun',
    assistantDraftSeq: 10,
  });

  state.appendEvent({
    kind: 'text_delta',
    sessionId: 's_1',
    text: 'covered',
    runtimeEvent: {
      runtimeId: 'rt_1',
      runId: 'run_terminal_rerun',
      seq: 9,
    },
  });
  state.appendEvent({
    kind: 'text_delta',
    sessionId: 's_1',
    text: ' post',
    runtimeEvent: {
      runtimeId: 'rt_1',
      runId: 'run_terminal_rerun',
      seq: 15,
    },
  });

  assert.equal(
    useAppStore
      .getState()
      .eventsBySession.s_1?.filter((event) => event.kind === 'text_delta')
      .map((event) => event.text)
      .join(''),
    'covered post',
  );
});

test('acknowledged activity clears pending but the previous Run terminal cannot clear the next send', () => {
  useAppStore.setState({ sessions: [sidebarSession] });
  useAppStore.getState().replaceRuntimeProfileProjection(profile);
  useAppStore.getState().replaceSessionLiveProjection(live);
  const firstMessageId = useAppStore.getState().appendUserMessage('s_1', 'first request');
  assert.notEqual(firstMessageId, null);
  useAppStore.getState().setPendingSend('s_1', true);
  useAppStore.getState().acknowledgePendingSendRun('s_1', 'run_1');
  useAppStore.getState().bindUserMessageRuntimeRun('s_1', firstMessageId!, 'run_1');

  const admitted = useAppStore.getState().applySessionLiveProjectionChange({
    sessionId: 's_1',
    baseProjectionRevision: 1,
    projectionRevision: 2,
    cursor: { runtimeId: 'rt_1', seq: 2 },
    change: {
      domain: 'run',
      activeRun: {
        runId: 'run_1',
        sessionId: 's_1',
        phase: 'running',
        startedAt: 10,
      },
      queuedRuns: [],
    },
  });

  assert.equal(admitted, 'applied');
  assert.equal(useAppStore.getState().pendingSendBySession.s_1, undefined);

  const secondMessageId = useAppStore.getState().appendUserMessage('s_1', 'second request');
  assert.notEqual(secondMessageId, null);
  useAppStore.getState().setPendingSend('s_1', true);
  useAppStore.getState().replaceSessionLiveProjection({
    ...live,
    projectionRevision: 3,
    cursor: { runtimeId: 'rt_1', seq: 3 },
    lastTerminalRun: {
      runId: 'run_1',
      sessionId: 's_1',
      phase: 'completed',
      startedAt: 10,
      completedAt: 20,
    },
  });

  assert.equal(useAppStore.getState().pendingSendBySession.s_1, true);

  useAppStore.getState().replaceSessionLiveProjection({
    ...live,
    projectionRevision: 4,
    cursor: { runtimeId: 'rt_1', seq: 4 },
    activeRun: {
      runId: 'run_2',
      sessionId: 's_1',
      phase: 'running',
      startedAt: 30,
    },
  });

  assert.equal(useAppStore.getState().pendingSendBySession.s_1, true);
  useAppStore.getState().acknowledgePendingSendRun('s_1', 'run_2');
  useAppStore.getState().bindUserMessageRuntimeRun('s_1', secondMessageId!, 'run_2');
  assert.equal(useAppStore.getState().pendingSendBySession.s_1, undefined);
});

test('app store marks revision gaps for snapshot reload without mutating live data', () => {
  useAppStore.getState().replaceRuntimeProfileProjection(profile);
  useAppStore.getState().replaceSessionLiveProjection(live);

  const status = useAppStore.getState().applySessionLiveProjectionChange({
    sessionId: 's_1',
    baseProjectionRevision: 3,
    projectionRevision: 4,
    cursor: { runtimeId: 'rt_1', seq: 4 },
    change: { domain: 'tools', activeTools: [] },
  });

  const state = useAppStore.getState();
  assert.equal(status, 'snapshot-required');
  assert.equal(state.liveProjectionBySession.s_1?.projectionRevision, 1);
  assert.equal(state.runtimeSnapshotRequiredBySession.s_1, true);
});

test('app store ignores connection events older than its latest Runtime transition', () => {
  useAppStore.getState().replaceRuntimeProfileProjection(profile);
  useAppStore.getState().setCoderRuntimeConnection({
    state: 'disconnected',
    changedAt: 2,
    stale: true,
    capabilities: [],
  });
  useAppStore.getState().setCoderRuntimeConnection(profile.connection);

  assert.equal(useAppStore.getState().runtimeConnection.state, 'disconnected');
  assert.equal(useAppStore.getState().runtimeConnection.changedAt, 2);
});

test('compact_stats replaces transcript estimates with the active post-compaction context', () => {
  useAppStore.setState({
    currentSessionId: 's_1',
    eventsBySession: { s_1: [] },
    tokensBySession: { s_1: { tokens: 483_200, source: 'estimate' } },
  });

  useAppStore.getState().appendEvent({
    kind: 'compact_stats',
    sessionId: 's_1',
    tokensBefore: 322_973,
    tokensAfter: 222_460,
    committed: true,
    source: 'manual',
  });

  assert.deepEqual(useAppStore.getState().tokensBySession.s_1, {
    tokens: 222_460,
    source: 'compact_stats',
    compactedFrom: 322_973,
    lastCompaction: {
      committed: true,
      tokensBefore: 322_973,
      tokensAfter: 222_460,
      source: 'manual',
    },
  });

  useAppStore.getState().appendEvent({
    kind: 'compact_stats',
    sessionId: 's_1',
    tokensBefore: 40_000,
    tokensAfter: 8_000,
    contextId: 's_1/agent/reviewer',
    contextKind: 'child',
    parentContextId: 's_1',
    agentId: 'reviewer',
    contextRevision: 1,
  });
  assert.deepEqual(useAppStore.getState().tokensBySession.s_1, {
    tokens: 222_460,
    source: 'compact_stats',
    compactedFrom: 322_973,
    lastCompaction: {
      committed: true,
      tokensBefore: 322_973,
      tokensAfter: 222_460,
      source: 'manual',
    },
  });
});

test('root context revisions reject stale iteration and revision-less compatibility updates', () => {
  useAppStore.setState({ currentSessionId: 's_1', eventsBySession: { s_1: [] } });

  useAppStore.getState().appendEvent({
    kind: 'compact_stats',
    sessionId: 's_1',
    tokensBefore: 489_491,
    tokensAfter: 291_718,
    contextId: 's_1',
    contextKind: 'root',
    contextRevision: 3,
    beforeRevision: 2,
    afterRevision: 3,
    source: 'automatic_threshold',
    committed: true,
  });
  useAppStore.getState().appendEvent({
    kind: 'iteration_end',
    sessionId: 's_1',
    iter: 10,
    maxIter: 500,
    tokenCount: 483_200,
    contextId: 's_1',
    contextKind: 'root',
    contextRevision: 2,
  });
  useAppStore.getState().appendEvent({
    kind: 'compact_stats',
    sessionId: 's_1',
    tokensBefore: 489_491,
    tokensAfter: 483_200,
  });

  assert.equal(useAppStore.getState().tokensBySession.s_1?.tokens, 291_718);
  assert.equal(useAppStore.getState().tokensBySession.s_1?.contextRevision, 3);

  useAppStore.getState().appendEvent({
    kind: 'iteration_end',
    sessionId: 's_1',
    iter: 11,
    maxIter: 500,
    tokenCount: 300_000,
    contextId: 's_1',
    contextKind: 'root',
    contextRevision: 3,
  });
  assert.equal(useAppStore.getState().tokensBySession.s_1?.tokens, 300_000);
});

test('unchanged canonical compaction updates the gauge without claiming a reduction', () => {
  useAppStore.setState({ currentSessionId: 's_1', eventsBySession: { s_1: [] } });
  useAppStore.getState().appendEvent({
    kind: 'compact_stats',
    sessionId: 's_1',
    tokensBefore: 205_000,
    tokensAfter: 205_000,
    contextId: 's_1',
    contextKind: 'root',
    contextRevision: 4,
    committed: false,
    source: 'manual',
    elapsedMs: 90,
  });

  assert.deepEqual(useAppStore.getState().tokensBySession.s_1, {
    tokens: 205_000,
    source: 'compact_stats',
    contextId: 's_1',
    contextRevision: 4,
    lastCompaction: {
      committed: false,
      tokensBefore: 205_000,
      tokensAfter: 205_000,
      source: 'manual',
      elapsedMs: 90,
    },
  });
});

test('run reset removes terminal Runtime interactions from modal queues', () => {
  useAppStore.getState().replaceRuntimeProfileProjection(profile);
  useAppStore.getState().replaceSessionLiveProjection({
    ...live,
    interactions: [
      {
        kind: 'ask-user',
        source: 'coder-runtime',
        runId: 'run_1',
        createdAt: 1,
        state: 'pending',
        request: {
          kind: 'input',
          reqId: 'ask_1',
          sessionId: 's_1',
          question: 'Continue?',
        },
      },
    ],
  });
  assert.equal(useAppStore.getState().askUserQueue.length, 1);

  const status = useAppStore.getState().applySessionLiveProjectionChange({
    sessionId: 's_1',
    baseProjectionRevision: 1,
    projectionRevision: 2,
    cursor: { runtimeId: 'rt_1', seq: 2 },
    change: {
      domain: 'run',
      activeRun: null,
      queuedRuns: [],
      queuedInputs: [],
      resetRunScopedState: true,
    },
  });

  assert.equal(status, 'applied');
  assert.deepEqual(useAppStore.getState().askUserQueue, []);
});
