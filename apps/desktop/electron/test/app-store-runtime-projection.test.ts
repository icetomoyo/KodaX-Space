import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';

import type {
  AgentActorTreeSnapshotT,
  SpaceRuntimeProfileProjectionT,
  SpaceSessionLiveProjectionT,
} from '@kodax-space/space-ipc-schema';
import { useAppStore } from '../../renderer/src/store/appStore.js';
import { createRuntimeProjectionState } from '../../renderer/src/store/runtimeProjectionState.js';

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

beforeEach(() => {
  const initial = createRuntimeProjectionState();
  useAppStore.setState({
    runtimeConnection: initial.connection,
    runtimeProfile: initial.profile,
    liveProjectionBySession: initial.liveBySession,
    agentActorSnapshotBySession: {},
    runtimeSnapshotRequiredBySession: initial.snapshotRequiredBySession,
    permissionQueue: [],
    askUserQueue: [],
    currentSessionId: null,
    eventsBySession: {},
    tokensBySession: {},
    pendingSendBySession: {},
  });
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

test('authoritative run and terminal projections clear stale pending-send state', () => {
  useAppStore.getState().replaceRuntimeProfileProjection(profile);
  useAppStore.getState().replaceSessionLiveProjection(live);
  useAppStore.getState().setPendingSend('s_1', true);

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
