import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';

import type {
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
    runtimeSnapshotRequiredBySession: initial.snapshotRequiredBySession,
  });
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
