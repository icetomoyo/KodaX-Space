import assert from 'node:assert/strict';
import test from 'node:test';

import type {
  SpaceRuntimeProfileProjectionT,
  SpaceSessionLiveChangedT,
  SpaceSessionLiveProjectionT,
} from '@kodax-space/space-ipc-schema';
import {
  applySessionLiveChange,
  createRuntimeProjectionState,
  replaceRuntimeConnection,
  replaceRuntimeProfile,
  replaceSessionLiveProjection,
} from '../../renderer/src/store/runtimeProjectionState.js';

function profile(runtimeId: string, projectionRevision: number): SpaceRuntimeProfileProjectionT {
  return {
    connection: {
      state: 'ready',
      changedAt: projectionRevision,
      stale: false,
      runtimeId,
      profile: 'default',
      capabilities: [{ id: 'runtime.live.observe', version: 1, available: true }],
    },
    projectionRevision,
    cursor: { runtimeId, seq: projectionRevision },
    sessions: [],
    interactions: [],
    notifications: [],
  };
}

function live(runtimeId: string, projectionRevision: number): SpaceSessionLiveProjectionT {
  return {
    sessionId: 's_1',
    projectionRevision,
    cursor: { runtimeId, seq: projectionRevision },
    transcriptRevision: `tx_${projectionRevision}`,
    queuedRuns: [],
    activeTools: [],
    todos: [{ id: 'todo_1', content: 'Inspect runtime', status: 'pending' }],
    queuedInputs: [],
    interactions: [],
  };
}

test('profile replacement ignores stale revisions and clears live state on Runtime restart', () => {
  const initial = createRuntimeProjectionState();
  const first = replaceRuntimeProfile(initial, profile('rt_1', 2));
  const withLive = replaceSessionLiveProjection(first, live('rt_1', 2));

  assert.equal(withLive.profile?.projectionRevision, 2);
  assert.equal(withLive.liveBySession.s_1?.cursor.runtimeId, 'rt_1');

  const stale = replaceRuntimeProfile(withLive, profile('rt_1', 1));
  assert.equal(stale, withLive);

  const restartProfile = profile('rt_2', 1);
  const restarted = replaceRuntimeProfile(withLive, {
    ...restartProfile,
    connection: { ...restartProfile.connection, changedAt: 3 },
  });
  assert.equal(restarted.profile?.connection.runtimeId, 'rt_2');
  assert.deepEqual(restarted.liveBySession, {});
  assert.deepEqual(restarted.snapshotRequiredBySession, {});
});

test('matching live change advances one domain without rebuilding from events', () => {
  const base = replaceSessionLiveProjection(
    replaceRuntimeProfile(createRuntimeProjectionState(), profile('rt_1', 4)),
    live('rt_1', 4),
  );
  const change: SpaceSessionLiveChangedT = {
    sessionId: 's_1',
    baseProjectionRevision: 4,
    projectionRevision: 5,
    cursor: { runtimeId: 'rt_1', seq: 5 },
    change: {
      domain: 'todos',
      todos: [{ id: 'todo_1', content: 'Inspect runtime', status: 'completed' }],
    },
  };

  const result = applySessionLiveChange(base, change);
  assert.equal(result.status, 'applied');
  assert.equal(result.state.liveBySession.s_1?.projectionRevision, 5);
  assert.equal(result.state.liveBySession.s_1?.todos[0]?.status, 'completed');
  assert.equal(result.state.snapshotRequiredBySession.s_1, undefined);
});

test('revision gaps and Runtime mismatches request a fresh snapshot without partial mutation', () => {
  const base = replaceSessionLiveProjection(
    replaceRuntimeProfile(createRuntimeProjectionState(), profile('rt_1', 4)),
    live('rt_1', 4),
  );
  const gap: SpaceSessionLiveChangedT = {
    sessionId: 's_1',
    baseProjectionRevision: 6,
    projectionRevision: 7,
    cursor: { runtimeId: 'rt_1', seq: 7 },
    change: { domain: 'tools', activeTools: [] },
  };

  const gapResult = applySessionLiveChange(base, gap);
  assert.equal(gapResult.status, 'snapshot-required');
  assert.equal(gapResult.state.liveBySession.s_1?.projectionRevision, 4);
  assert.equal(gapResult.state.snapshotRequiredBySession.s_1, true);

  const wrongRuntime = applySessionLiveChange(base, {
    ...gap,
    baseProjectionRevision: 4,
    projectionRevision: 5,
    cursor: { runtimeId: 'rt_2', seq: 5 },
  });
  assert.equal(wrongRuntime.status, 'snapshot-required');
  assert.equal(wrongRuntime.state.liveBySession.s_1?.cursor.runtimeId, 'rt_1');

  const repeatedGap = applySessionLiveChange(gapResult.state, gap);
  assert.equal(repeatedGap.status, 'snapshot-pending');
  assert.equal(repeatedGap.state, gapResult.state);
});

test('duplicate or older live changes are ignored without scheduling a snapshot', () => {
  const base = replaceSessionLiveProjection(
    replaceRuntimeProfile(createRuntimeProjectionState(), profile('rt_1', 4)),
    live('rt_1', 4),
  );
  const duplicate: SpaceSessionLiveChangedT = {
    sessionId: 's_1',
    baseProjectionRevision: 3,
    projectionRevision: 4,
    cursor: { runtimeId: 'rt_1', seq: 4 },
    change: { domain: 'tools', activeTools: [] },
  };

  const result = applySessionLiveChange(base, duplicate);
  assert.equal(result.status, 'ignored');
  assert.equal(result.state, base);
});

test('stale bootstrap snapshots cannot overwrite a newer pushed connection/profile', () => {
  const initial = createRuntimeProjectionState();
  const pushed = replaceRuntimeProfile(initial, profile('rt_1', 1));
  const stalePending: SpaceRuntimeProfileProjectionT = {
    connection: {
      state: 'incompatible',
      changedAt: 0,
      stale: true,
      capabilities: [],
    },
    projectionRevision: 0,
    sessions: [],
    interactions: [],
    notifications: [],
  };

  assert.equal(replaceRuntimeProfile(pushed, stalePending), pushed);
});

test('connection loss blocks late live snapshots and changes until a ready profile is restored', () => {
  const ready = replaceRuntimeProfile(createRuntimeProjectionState(), profile('rt_1', 1));
  const withLive = replaceSessionLiveProjection(ready, live('rt_1', 1));
  const disconnected = replaceRuntimeConnection(withLive, {
    state: 'disconnected',
    changedAt: 2,
    stale: true,
    capabilities: [],
  });

  assert.equal(replaceSessionLiveProjection(disconnected, live('rt_1', 2)), disconnected);
  const patchResult = applySessionLiveChange(disconnected, {
    sessionId: 's_1',
    baseProjectionRevision: 1,
    projectionRevision: 2,
    cursor: { runtimeId: 'rt_1', seq: 2 },
    change: { domain: 'tools', activeTools: [] },
  });
  assert.equal(patchResult.status, 'snapshot-required');
  assert.equal(patchResult.state.liveBySession.s_1?.projectionRevision, 1);
});
