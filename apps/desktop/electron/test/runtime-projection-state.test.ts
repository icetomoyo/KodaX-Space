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
  runtimeBootstrapRetryDelayMs,
  runtimeProfileActivityOutranksLive,
  runtimeTerminalEvidenceCandidates,
  runtimeProfileConflictsWithLive,
  runtimeProfileSessionHasActivity,
  runtimeSessionNeedsPeriodicReconciliation,
  runtimeSessionRequiresImmediateObservation,
  runtimeSessionNeedsObservation,
  sessionLiveProjectionHasActivity,
  shouldBootstrapSelectedSessionLive,
  shouldReconcileRuntimeConnection,
  shouldRequestSessionLiveSnapshot,
  shouldRerunRejectedHydrationSnapshot,
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

test('snapshot-required and snapshot-pending both request authoritative reconciliation', () => {
  assert.equal(shouldRequestSessionLiveSnapshot('snapshot-required'), true);
  assert.equal(shouldRequestSessionLiveSnapshot('snapshot-pending'), true);
  assert.equal(shouldRequestSessionLiveSnapshot('applied'), false);
  assert.equal(shouldRequestSessionLiveSnapshot('ignored'), false);
});

test('a rejected hydration snapshot reruns only when a newer same-Runtime projection overtook it', () => {
  const connection = profile('rt_1', 3).connection;
  assert.equal(
    shouldRerunRejectedHydrationSnapshot({
      allowEqualHydration: true,
      connection,
      current: live('rt_1', 3),
      incoming: live('rt_1', 2),
    }),
    true,
  );
  assert.equal(
    shouldRerunRejectedHydrationSnapshot({
      allowEqualHydration: true,
      connection,
      current: undefined,
      incoming: live('rt_1', 2),
    }),
    false,
  );
  assert.equal(
    shouldRerunRejectedHydrationSnapshot({
      allowEqualHydration: true,
      connection: { ...connection, stale: true },
      current: live('rt_1', 3),
      incoming: live('rt_1', 2),
    }),
    false,
  );
});

test('terminal evidence is exact, Runtime-scoped, and keeps distinct profile/live Runs independent', () => {
  const terminalProfile: SpaceRuntimeProfileProjectionT = {
    ...profile('rt_1', 4),
    sessions: [
      {
        sessionId: 's_1',
        surface: 'code',
        createdAt: 1,
        lastActivityAt: 4,
        queuedRuns: [],
        lastTerminalRun: {
          runId: 'run_old',
          sessionId: 's_1',
          phase: 'completed',
          completedAt: 4,
        },
      },
    ],
  };
  const staleAgainstNewRun = {
    ...live('rt_1', 5),
    activeRun: {
      runId: 'run_new',
      sessionId: 's_1',
      phase: 'running' as const,
      startedAt: 5,
    },
  };
  assert.deepEqual(
    runtimeTerminalEvidenceCandidates(
      {
        connection: terminalProfile.connection,
        profile: terminalProfile,
        liveBySession: { s_1: staleAgainstNewRun },
      },
      's_1',
    ).map((terminal) => terminal.runId),
    ['run_old'],
  );

  const liveTerminal = {
    ...live('rt_1', 6),
    lastTerminalRun: {
      runId: 'run_new',
      sessionId: 's_1',
      phase: 'completed' as const,
      completedAt: 6,
    },
  };
  assert.deepEqual(
    runtimeTerminalEvidenceCandidates(
      {
        connection: terminalProfile.connection,
        profile: {
          ...terminalProfile,
          projectionRevision: 6,
          cursor: { runtimeId: 'rt_1', seq: 6 },
        },
        liveBySession: { s_1: liveTerminal },
      },
      's_1',
    ).map((terminal) => terminal.runId),
    ['run_old', 'run_new'],
  );
});

test('Runtime activity evidence is positive-only for active and queued work', () => {
  const activeSession: SpaceRuntimeProfileProjectionT['sessions'][number] = {
    sessionId: 's_1',
    surface: 'code',
    createdAt: 1,
    lastActivityAt: 2,
    activeRun: {
      runId: 'run_1',
      sessionId: 's_1',
      phase: 'running',
      startedAt: 1,
    },
    queuedRuns: [],
  };
  const queuedSession: SpaceRuntimeProfileProjectionT['sessions'][number] = {
    ...activeSession,
    activeRun: undefined,
    queuedRuns: [
      {
        runId: 'run_queued',
        sessionId: 's_1',
        phase: 'queued',
        startedAt: 2,
      },
    ],
  };

  assert.equal(runtimeProfileSessionHasActivity(activeSession), true);
  assert.equal(runtimeProfileSessionHasActivity(queuedSession), true);
  assert.equal(
    runtimeProfileSessionHasActivity({ ...activeSession, activeRun: undefined, queuedRuns: [] }),
    false,
  );
  assert.equal(
    sessionLiveProjectionHasActivity({ ...live('rt_1', 1), activeRun: activeSession.activeRun }),
    true,
  );
  assert.equal(sessionLiveProjectionHasActivity(live('rt_1', 1)), false);

  const activeProfile = { ...profile('rt_1', 5), sessions: [activeSession] };
  assert.equal(runtimeProfileActivityOutranksLive(activeProfile, 's_1', undefined), true);
  assert.equal(runtimeProfileActivityOutranksLive(activeProfile, 's_1', live('rt_1', 4)), true);
  assert.equal(runtimeProfileActivityOutranksLive(activeProfile, 's_1', live('rt_1', 5)), true);
  assert.equal(
    runtimeProfileActivityOutranksLive(activeProfile, 's_1', {
      ...live('rt_1', 5),
      lastTerminalRun: {
        runId: 'run_1',
        sessionId: 's_1',
        phase: 'completed',
        completedAt: 5,
      },
    }),
    false,
  );
  assert.equal(
    runtimeProfileActivityOutranksLive(
      { ...activeProfile, cursor: { runtimeId: 'rt_1', seq: 100 } },
      's_1',
      {
        ...live('rt_1', 5),
        cursor: {
          runtimeId: 'rt_1',
          sessionId: 's_1',
          journalEpoch: 'journal_s_1',
          seq: 5,
        },
        lastTerminalRun: {
          runId: 'run_1',
          sessionId: 's_1',
          phase: 'completed',
          completedAt: 5,
        },
      },
    ),
    false,
  );
});

test('active selected Sessions bootstrap live state before history and despite a stale projection', () => {
  assert.equal(
    shouldBootstrapSelectedSessionLive({
      runtimeReady: true,
      needsObservation: true,
      hasImmediateActivity: true,
      historyAllowsObservation: false,
      hasLiveProjection: true,
    }),
    true,
  );
  assert.equal(
    shouldBootstrapSelectedSessionLive({
      runtimeReady: true,
      needsObservation: true,
      hasImmediateActivity: false,
      historyAllowsObservation: false,
      hasLiveProjection: false,
    }),
    false,
  );
  assert.equal(
    shouldBootstrapSelectedSessionLive({
      runtimeReady: true,
      needsObservation: true,
      hasImmediateActivity: false,
      historyAllowsObservation: true,
      hasLiveProjection: false,
    }),
    true,
  );
});

test('immediate observation accepts local activity, fresh profile activity, or an explicit requirement', () => {
  const initial = createRuntimeProjectionState();
  assert.equal(runtimeSessionRequiresImmediateObservation(initial, 's_1'), false);
  assert.equal(
    runtimeSessionRequiresImmediateObservation(
      {
        ...initial,
        liveBySession: {
          s_1: {
            ...live('rt_1', 1),
            activeRun: {
              runId: 'run_local',
              sessionId: 's_1',
              phase: 'running',
              startedAt: 1,
            },
          },
        },
      },
      's_1',
    ),
    true,
  );
  const ready = replaceRuntimeProfile(initial, {
    ...profile('rt_1', 2),
    sessions: [
      {
        sessionId: 's_1',
        surface: 'code',
        createdAt: 1,
        lastActivityAt: 2,
        activeRun: {
          runId: 'run_profile',
          sessionId: 's_1',
          phase: 'running',
          startedAt: 1,
        },
        queuedRuns: [],
      },
    ],
  });
  assert.equal(runtimeSessionRequiresImmediateObservation(ready, 's_1'), true);
  const boundedReady = replaceRuntimeProfile(initial, profile('rt_1', 3));
  const missingSessionNeedsObservation = runtimeSessionNeedsObservation(boundedReady, 's_1');
  const missingSessionIsImmediate = runtimeSessionRequiresImmediateObservation(boundedReady, 's_1');
  assert.equal(missingSessionNeedsObservation, false);
  assert.equal(missingSessionIsImmediate, false);
  assert.equal(
    shouldBootstrapSelectedSessionLive({
      runtimeReady: true,
      needsObservation: missingSessionNeedsObservation,
      hasImmediateActivity: missingSessionIsImmediate,
      historyAllowsObservation: false,
      hasLiveProjection: false,
    }),
    false,
  );
  assert.equal(
    shouldBootstrapSelectedSessionLive({
      runtimeReady: true,
      needsObservation: missingSessionNeedsObservation,
      hasImmediateActivity: missingSessionIsImmediate,
      historyAllowsObservation: true,
      hasLiveProjection: false,
    }),
    false,
  );
  assert.equal(
    runtimeSessionRequiresImmediateObservation(
      { ...initial, snapshotRequiredBySession: { s_1: true } },
      's_1',
    ),
    true,
  );
});

test('a bounded profile omission is not terminal evidence against an observed active Session', () => {
  const activeLive: SpaceSessionLiveProjectionT = {
    ...live('rt_1', 5),
    activeRun: {
      runId: 'run_active',
      sessionId: 's_1',
      phase: 'running',
      startedAt: 1,
    },
  };

  assert.equal(runtimeProfileConflictsWithLive(profile('rt_1', 5), 's_1', activeLive), false);
  assert.equal(
    runtimeProfileConflictsWithLive(
      {
        ...profile('rt_1', 6),
        sessions: [
          {
            sessionId: 's_1',
            surface: 'code',
            createdAt: 1,
            lastActivityAt: 2,
            queuedRuns: [],
            lastTerminalRun: {
              runId: 'run_active',
              sessionId: 's_1',
              phase: 'completed',
              completedAt: 2,
            },
          },
        ],
      },
      's_1',
      activeLive,
    ),
    true,
  );
});

test('Runtime bootstrap reconciliation uses three bounded retries', () => {
  assert.deepEqual([1, 2, 3, 4].map(runtimeBootstrapRetryDelayMs), [250, 1_000, 3_000, undefined]);
});

test('periodic reconciliation retries only current Sessions with exact recovery evidence', () => {
  const initial = createRuntimeProjectionState();
  const ready = replaceRuntimeProfile(initial, profile('rt_1', 1));
  assert.equal(
    runtimeSessionNeedsPeriodicReconciliation(
      { ...ready, snapshotRequiredBySession: { s_1: true } },
      's_1',
    ),
    true,
  );

  const activeProfile = replaceRuntimeProfile(initial, {
    ...profile('rt_1', 2),
    sessions: [
      {
        sessionId: 's_1',
        surface: 'code',
        createdAt: 1,
        lastActivityAt: 2,
        activeRun: {
          runId: 'run_profile',
          sessionId: 's_1',
          phase: 'running',
          startedAt: 1,
        },
        queuedRuns: [],
      },
    ],
  });
  assert.equal(runtimeSessionNeedsPeriodicReconciliation(activeProfile, 's_1'), true);
  assert.equal(
    runtimeSessionNeedsPeriodicReconciliation(
      replaceRuntimeProfile(initial, {
        ...profile('rt_1', 3),
        sessions: [
          {
            sessionId: 's_1',
            surface: 'code',
            createdAt: 1,
            lastActivityAt: 3,
            queuedRuns: [],
          },
        ],
      }),
      's_1',
    ),
    false,
  );
  assert.equal(
    runtimeSessionNeedsPeriodicReconciliation(ready, 's_missing_from_bounded_profile'),
    false,
  );
  assert.equal(
    runtimeSessionNeedsPeriodicReconciliation(
      { ...ready, connection: { ...ready.connection, stale: true } },
      's_1',
    ),
    false,
  );
});

test('connection reconciliation is edge-triggered instead of timestamp-triggered', () => {
  const ready = profile('rt_1', 1).connection;

  assert.equal(
    shouldReconcileRuntimeConnection(createRuntimeProjectionState().connection, ready),
    true,
  );
  assert.equal(
    shouldReconcileRuntimeConnection(ready, { ...ready, changedAt: ready.changedAt + 1 }),
    false,
  );
  assert.equal(
    shouldReconcileRuntimeConnection(ready, {
      ...ready,
      runtimeId: 'rt_2',
      changedAt: ready.changedAt + 1,
    }),
    true,
  );
  assert.equal(
    shouldReconcileRuntimeConnection(ready, {
      ...ready,
      state: 'degraded',
      stale: true,
      reason: 'transport recovering',
      changedAt: ready.changedAt + 1,
    }),
    false,
  );
  assert.equal(
    shouldReconcileRuntimeConnection(ready, {
      state: 'reconnecting',
      changedAt: ready.changedAt + 1,
      stale: true,
      capabilities: [],
    }),
    false,
  );
});

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

test('a new Session journal epoch resets live revision and sequence watermarks', () => {
  const ready = replaceRuntimeProfile(createRuntimeProjectionState(), profile('rt_1', 100));
  const oldEpoch = replaceSessionLiveProjection(ready, {
    ...live('rt_1', 100),
    cursor: {
      runtimeId: 'rt_1',
      sessionId: 's_1',
      journalEpoch: 'epoch_old',
      seq: 100,
    },
  });
  const newEpoch = replaceSessionLiveProjection(oldEpoch, {
    ...live('rt_1', 1),
    cursor: {
      runtimeId: 'rt_1',
      sessionId: 's_1',
      journalEpoch: 'epoch_new',
      seq: 1,
    },
  });

  assert.equal(newEpoch.liveBySession.s_1?.projectionRevision, 1);
  assert.equal(newEpoch.liveBySession.s_1?.cursor.journalEpoch, 'epoch_new');

  const staleChange = applySessionLiveChange(newEpoch, {
    sessionId: 's_1',
    baseProjectionRevision: 1,
    projectionRevision: 101,
    cursor: {
      runtimeId: 'rt_1',
      sessionId: 's_1',
      journalEpoch: 'epoch_old',
      seq: 101,
    },
    change: { domain: 'todos', todos: [] },
  });
  assert.equal(staleChange.status, 'snapshot-required');
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

test('run changes project queued inputs and reset run-scoped live state atomically', () => {
  const initialLive: SpaceSessionLiveProjectionT = {
    ...live('rt_1', 4),
    assistantDraft: { text: 'old answer', startedAt: 1 },
    thinkingDraft: { text: 'old thinking', startedAt: 1 },
    activeTools: [{ toolCallId: 'tool_1', name: 'bash', startedAt: 1 }],
    managedTask: { phase: 'executing', updatedAt: 1 },
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
  };
  const base = replaceSessionLiveProjection(
    replaceRuntimeProfile(createRuntimeProjectionState(), profile('rt_1', 4)),
    initialLive,
  );
  const result = applySessionLiveChange(base, {
    sessionId: 's_1',
    baseProjectionRevision: 4,
    projectionRevision: 5,
    cursor: { runtimeId: 'rt_1', seq: 5 },
    change: {
      domain: 'run',
      activeRun: null,
      queuedRuns: [],
      lastTerminalRun: {
        runId: 'run_1',
        sessionId: 's_1',
        phase: 'completed',
        completedAt: 2,
      },
      queuedInputs: [
        {
          inputId: 'input_1',
          sessionId: 's_1',
          delivery: 'after-turn',
          state: 'queued',
          createdAt: 2,
          position: 1,
          contentPreview: 'next',
        },
      ],
      resetRunScopedState: true,
    },
  });

  const projection = result.state.liveBySession.s_1;
  assert.equal(result.status, 'applied');
  assert.equal(projection?.lastTerminalRun?.runId, 'run_1');
  assert.equal(projection?.queuedInputs[0]?.inputId, 'input_1');
  assert.equal(projection?.assistantDraft, undefined);
  assert.equal(projection?.thinkingDraft, undefined);
  assert.deepEqual(projection?.activeTools, []);
  assert.equal(projection?.managedTask, undefined);
  assert.deepEqual(projection?.interactions, []);
  assert.equal(projection?.todos[0]?.id, 'todo_1');
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

test('an equal authoritative snapshot clears a retained reconciliation requirement', () => {
  const base = replaceSessionLiveProjection(
    replaceRuntimeProfile(createRuntimeProjectionState(), profile('rt_1', 4)),
    live('rt_1', 4),
  );
  const gapResult = applySessionLiveChange(base, {
    sessionId: 's_1',
    baseProjectionRevision: 6,
    projectionRevision: 7,
    cursor: { runtimeId: 'rt_1', seq: 7 },
    change: { domain: 'tools', activeTools: [] },
  });

  const staleEqual = replaceSessionLiveProjection(gapResult.state, {
    ...live('rt_1', 4),
    cursor: { runtimeId: 'rt_1', seq: 3 },
  });
  assert.equal(staleEqual.snapshotRequiredBySession.s_1, true);

  const reconciled = replaceSessionLiveProjection(gapResult.state, live('rt_1', 4));
  assert.equal(reconciled.liveBySession.s_1?.projectionRevision, 4);
  assert.equal(reconciled.snapshotRequiredBySession.s_1, undefined);
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

  assert.deepEqual(disconnected.liveBySession, {});
  assert.equal(replaceSessionLiveProjection(disconnected, live('rt_1', 2)), disconnected);
  const patchResult = applySessionLiveChange(disconnected, {
    sessionId: 's_1',
    baseProjectionRevision: 1,
    projectionRevision: 2,
    cursor: { runtimeId: 'rt_1', seq: 2 },
    change: { domain: 'tools', activeTools: [] },
  });
  assert.equal(patchResult.status, 'snapshot-required');
  assert.equal(patchResult.state.liveBySession.s_1, undefined);
});

test('a stale degraded connection also discards live authority until a fresh profile arrives', () => {
  const ready = replaceRuntimeProfile(createRuntimeProjectionState(), profile('rt_1', 1));
  const withLive = replaceSessionLiveProjection(ready, live('rt_1', 1));
  const degraded = replaceRuntimeConnection(withLive, {
    ...profile('rt_1', 2).connection,
    state: 'degraded',
    stale: true,
    reason: 'profile reconciliation failed',
  });

  assert.deepEqual(degraded.liveBySession, {});
  assert.equal(replaceSessionLiveProjection(degraded, live('rt_1', 2)), degraded);

  const restored = replaceRuntimeProfile(degraded, profile('rt_1', 3));
  assert.equal(restored.connection.state, 'ready');
  assert.equal(
    replaceSessionLiveProjection(restored, live('rt_1', 3)).liveBySession.s_1?.projectionRevision,
    3,
  );
});
