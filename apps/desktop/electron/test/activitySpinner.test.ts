import { test } from 'node:test';
import assert from 'node:assert/strict';
import type {
  SessionEvent,
  SpaceRuntimeProfileProjectionT,
  SpaceSessionLiveProjectionT,
} from '@kodax-space/space-ipc-schema';
import {
  presentRuntimeSandbox,
  selectEffectiveRuntimeActiveRun,
  selectActivitySnapshot,
  selectActivityGeneration,
  selectRuntimeStopIdentity,
  snapshotFromEvents,
  snapshotFromRuntimeProfileSession,
  snapshotFromRuntimeProjection,
} from '../../renderer/src/shell/ActivitySpinner.js';

const sid = 's_activity_spinner';

function idleProjection(): SpaceSessionLiveProjectionT {
  return {
    sessionId: sid,
    projectionRevision: 2,
    cursor: { runtimeId: 'rt_1', seq: 9 },
    transcriptRevision: 'transcript_9',
    activeRun: undefined,
    queuedRuns: [],
    activeTools: [],
    todos: [],
    queuedInputs: [],
    interactions: [],
  };
}

test('queued_user_prompt_started keeps spinner alive before the next session_start arrives', () => {
  const events: SessionEvent[] = [
    { kind: 'session_start', sessionId: sid, provider: 'mock' },
    { kind: 'text_delta', sessionId: sid, text: 'done' },
    { kind: 'session_complete', sessionId: sid },
    {
      kind: 'queued_user_prompt_started',
      sessionId: sid,
      queueMode: 'after-turn',
      content: 'follow up',
    },
  ];

  const snapshot = snapshotFromEvents(events, false, undefined);

  assert.equal(snapshot.streaming, true);
  assert.equal(snapshot.status.startsWith('Thinking'), true);
});

test('a delivered mid-turn prompt reopens activity after an older terminal boundary', () => {
  const events: SessionEvent[] = [
    { kind: 'session_start', sessionId: sid, provider: 'mock' },
    { kind: 'session_complete', sessionId: sid },
    {
      kind: 'mid_turn_user_prompt',
      sessionId: sid,
      queueId: 'input_1',
      content: 'continue with the queued correction',
    },
  ];

  const snapshot = snapshotFromEvents(events, false, undefined);

  assert.equal(snapshot.streaming, true);
  assert.equal(snapshot.status.startsWith('Thinking'), true);
});

test('manual compaction after a completed run keeps an animated compacting state until compact_end', () => {
  const base: SessionEvent[] = [
    { kind: 'session_start', sessionId: sid, provider: 'mock' },
    { kind: 'session_complete', sessionId: sid },
    { kind: 'compact_start', sessionId: sid },
  ];

  const active = snapshotFromEvents(base, false, undefined);
  assert.equal(active.streaming, true);
  assert.equal(active.status, 'Compacting context…');
  assert.equal(active.compacting, true);

  const finished = snapshotFromEvents(
    [
      ...base,
      { kind: 'compact_stats', sessionId: sid, tokensBefore: 320_000, tokensAfter: 220_000 },
      { kind: 'compact_end', sessionId: sid },
    ],
    false,
    undefined,
  );
  assert.equal(finished.streaming, false);
});

test('managed verification cannot hide an active root compaction lifecycle', () => {
  const snapshot = snapshotFromEvents(
    [
      { kind: 'session_start', sessionId: sid, provider: 'mock' },
      { kind: 'compact_start', sessionId: sid },
    ],
    false,
    'verifying',
  );

  assert.equal(snapshot.streaming, true);
  assert.equal(snapshot.compacting, true);
  assert.equal(snapshot.status, 'Compacting context…');
});

test('automatic compaction completion does not stop the still-running session spinner', () => {
  const snapshot = snapshotFromEvents(
    [
      { kind: 'session_start', sessionId: sid, provider: 'mock' },
      { kind: 'compact_start', sessionId: sid },
      { kind: 'compact_stats', sessionId: sid, tokensBefore: 490_000, tokensAfter: 292_000 },
      { kind: 'compact_end', sessionId: sid },
    ],
    false,
    undefined,
  );

  assert.equal(snapshot.streaming, true);
  assert.equal(snapshot.status.startsWith('Thinking'), true);
});

test('child compaction and iteration telemetry never replace root activity state', () => {
  const snapshot = snapshotFromEvents(
    [
      { kind: 'session_start', sessionId: sid, provider: 'mock' },
      {
        kind: 'iteration_end',
        sessionId: sid,
        iter: 2,
        maxIter: 20,
        tokenCount: 88_000,
        contextKind: 'root',
      },
      {
        kind: 'compact_start',
        sessionId: sid,
        contextId: `${sid}/agent/reviewer`,
        contextKind: 'child',
        parentContextId: sid,
        agentId: 'reviewer',
      },
      {
        kind: 'iteration_end',
        sessionId: sid,
        iter: 1,
        maxIter: 5,
        tokenCount: 4_000,
        contextKind: 'child',
        contextId: `${sid}/agent/reviewer`,
      },
    ],
    false,
    undefined,
  );

  assert.equal(snapshot.status.startsWith('Thinking'), true);
  assert.deepEqual(snapshot.iter, { current: 2, max: 20 });
  assert.equal(snapshot.tokens, 88_000);
});

test('active compaction status overrides an ordinary daemon running projection', () => {
  const projection: SpaceSessionLiveProjectionT = {
    sessionId: sid,
    projectionRevision: 1,
    cursor: { runtimeId: 'rt_1', seq: 3 },
    transcriptRevision: 'transcript_3',
    activeRun: {
      runId: 'run_1',
      sessionId: sid,
      phase: 'running',
      startedAt: 10,
    },
    queuedRuns: [],
    activeTools: [],
    todos: [],
    queuedInputs: [],
    interactions: [],
  };

  const snapshot = selectActivitySnapshot(
    projection,
    [
      { kind: 'session_start', sessionId: sid, provider: 'mock' },
      { kind: 'compact_start', sessionId: sid },
    ],
    false,
    undefined,
  );

  assert.equal(snapshot.streaming, true);
  assert.equal(snapshot.status, 'Compacting context…');
});

test('an authoritative idle Runtime projection clears stale legacy activity telemetry', () => {
  const staleEvents: SessionEvent[] = [
    { kind: 'session_start', sessionId: sid, provider: 'mock' },
    {
      kind: 'tool_result',
      sessionId: sid,
      toolId: 'tool_1',
      toolName: 'wait_agent',
      content: 'finished',
    },
    {
      kind: 'iteration_end',
      sessionId: sid,
      iter: 5,
      maxIter: 500,
      tokenCount: 52_600,
    },
  ];

  const snapshot = selectActivitySnapshot(idleProjection(), staleEvents, false, undefined);

  assert.deepEqual(snapshot, { streaming: false, status: '', startedAt: null });
});

test('a causal terminal event fences an older active snapshot for the same Runtime Run', () => {
  const active: SpaceSessionLiveProjectionT = {
    ...idleProjection(),
    projectionRevision: 3,
    cursor: { runtimeId: 'rt_1', seq: 10 },
    activeRun: {
      runId: 'run_done',
      sessionId: sid,
      phase: 'running',
      startedAt: 10,
    },
    thinkingDraft: { text: 'already finished', startedAt: 10 },
  };

  const snapshot = selectActivitySnapshot(
    active,
    [
      { kind: 'session_start', sessionId: sid, provider: 'mock' },
      {
        kind: 'session_complete',
        sessionId: sid,
        runtimeEvent: { runtimeId: 'rt_1', runId: 'run_done', seq: 11 },
      },
    ],
    false,
    undefined,
  );

  assert.deepEqual(snapshot, { streaming: false, status: '', startedAt: null });
});

test('a terminal-fenced old live snapshot falls through to a newer profile Run', () => {
  const staleActive: SpaceSessionLiveProjectionT = {
    ...idleProjection(),
    projectionRevision: 3,
    cursor: { runtimeId: 'rt_1', seq: 10 },
    activeRun: {
      runId: 'run_done',
      sessionId: sid,
      phase: 'running',
      startedAt: 10,
    },
  };
  const newerProfileRun: SpaceRuntimeProfileProjectionT['sessions'][number] = {
    sessionId: sid,
    surface: 'code',
    createdAt: 10,
    lastActivityAt: 20,
    activeRun: {
      runId: 'run_new',
      sessionId: sid,
      phase: 'running',
      startedAt: 20,
    },
    queuedRuns: [],
  };

  const snapshot = selectActivitySnapshot(
    staleActive,
    [
      {
        kind: 'session_complete',
        sessionId: sid,
        runtimeEvent: { runtimeId: 'rt_1', runId: 'run_done', seq: 11 },
      },
    ],
    false,
    undefined,
    newerProfileRun,
  );

  assert.equal(snapshot.streaming, true);
  assert.equal(snapshot.status, 'Working…');
  assert.equal(snapshot.startedAt, 20);
});

test('a previous Run terminal cannot hide a newer active Runtime Run', () => {
  const active: SpaceSessionLiveProjectionT = {
    ...idleProjection(),
    projectionRevision: 4,
    cursor: { runtimeId: 'rt_1', seq: 20 },
    activeRun: {
      runId: 'run_new',
      sessionId: sid,
      phase: 'running',
      startedAt: 20,
    },
    thinkingDraft: { text: 'new work', startedAt: 20 },
  };

  const snapshot = selectActivitySnapshot(
    active,
    [
      {
        kind: 'session_complete',
        sessionId: sid,
        runtimeEvent: { runtimeId: 'rt_1', runId: 'run_old', seq: 11 },
      },
    ],
    false,
    undefined,
  );

  assert.equal(snapshot.streaming, true);
  assert.equal(snapshot.status, 'Thinking…');
});

test('a stale connection cannot keep a detailed live projection spinning', () => {
  const active: SpaceSessionLiveProjectionT = {
    ...idleProjection(),
    activeRun: {
      runId: 'run_stale',
      sessionId: sid,
      phase: 'running',
      startedAt: 10,
    },
    thinkingDraft: { text: 'stale work', startedAt: 10 },
  };

  const snapshot = selectActivitySnapshot(
    active,
    [{ kind: 'session_complete', sessionId: sid }],
    false,
    undefined,
    undefined,
    false,
  );

  assert.deepEqual(snapshot, { streaming: false, status: '', startedAt: null });
});

test('pending admission still renders while the last Runtime projection is idle', () => {
  const snapshot = selectActivitySnapshot(idleProjection(), [], true, undefined);

  assert.equal(snapshot.streaming, true);
  assert.notEqual(snapshot.status, '');
});

test('an admitted Runtime run outranks a stale pending-send marker', () => {
  const projection: SpaceSessionLiveProjectionT = {
    ...idleProjection(),
    projectionRevision: 3,
    cursor: { runtimeId: 'rt_1', seq: 10 },
    activeRun: {
      runId: 'run_admitted',
      sessionId: sid,
      phase: 'running',
      startedAt: 10,
    },
  };

  const snapshot = selectActivitySnapshot(projection, [], true, undefined);

  assert.equal(snapshot.streaming, true);
  assert.notEqual(snapshot.status, 'Sending…');
});

test('legacy activity remains the fallback until a Runtime projection has been hydrated', () => {
  const snapshot = selectActivitySnapshot(
    undefined,
    [{ kind: 'session_start', sessionId: sid, provider: 'mock' }],
    false,
    undefined,
  );

  assert.equal(snapshot.streaming, true);
});

test('Runtime profile keeps spinner and Stop active while the session observation is rebuilding', () => {
  const profileSession: SpaceRuntimeProfileProjectionT['sessions'][number] = {
    sessionId: sid,
    surface: 'code',
    createdAt: 10,
    lastActivityAt: 20,
    activeRun: {
      runId: 'run_recovering',
      sessionId: sid,
      phase: 'recovering',
      startedAt: 10,
    },
    queuedRuns: [],
  };

  const direct = snapshotFromRuntimeProfileSession(profileSession);
  const selected = selectActivitySnapshot(undefined, [], false, undefined, profileSession);

  assert.equal(direct?.streaming, true);
  assert.equal(direct?.status, 'Recovering…');
  assert.deepEqual(selected, direct);
});

test('profile-only unknown state exposes the exact effective active Run to composer controls', () => {
  const profileSession: SpaceRuntimeProfileProjectionT['sessions'][number] = {
    sessionId: sid,
    surface: 'code',
    createdAt: 10,
    lastActivityAt: 20,
    activeRun: {
      runId: 'run_unknown_profile',
      sessionId: sid,
      phase: 'unknown',
      startedAt: 10,
    },
    queuedRuns: [],
  };

  const selected = selectEffectiveRuntimeActiveRun(undefined, [], profileSession, true, {
    runtimeId: 'rt_1',
    seq: 11,
  });

  assert.equal(selected?.runId, 'run_unknown_profile');
  assert.equal(selected?.phase, 'unknown');
});

test('stale Runtime activity retains its exact Stop identity while connection authority rebuilds', () => {
  const identity = selectRuntimeStopIdentity(
    undefined,
    [
      {
        kind: 'session_start',
        sessionId: sid,
        provider: 'mock',
        runtimeEvent: { runtimeId: 'rt_1', runId: 'run_visible_old', seq: 12 },
      },
    ],
    undefined,
    false,
    { runtimeId: 'rt_1', seq: 12 },
  );

  assert.deepEqual(identity, { requiresExactRunId: true, runId: 'run_visible_old' });
});

test('legacy activity generation changes at the next root turn boundary', () => {
  const first: SessionEvent[] = [
    { kind: 'session_start', sessionId: sid, provider: 'mock', turnId: 'turn_old' },
  ];
  const successor: SessionEvent[] = [
    ...first,
    { kind: 'session_complete', sessionId: sid },
    { kind: 'session_start', sessionId: sid, provider: 'mock', turnId: 'turn_successor' },
  ];

  assert.equal(selectActivityGeneration(first, undefined), 'turn:turn_old');
  assert.equal(selectActivityGeneration(successor, undefined), 'turn:turn_successor');
});

test('a stale Runtime connection cannot keep an orphaned profile Stop active', () => {
  const profileSession: SpaceRuntimeProfileProjectionT['sessions'][number] = {
    sessionId: sid,
    surface: 'code',
    createdAt: 10,
    lastActivityAt: 20,
    activeRun: {
      runId: 'run_stale',
      sessionId: sid,
      phase: 'recovering',
      startedAt: 10,
    },
    queuedRuns: [],
  };

  const selected = selectActivitySnapshot(undefined, [], false, undefined, profileSession, false);

  assert.deepEqual(selected, { streaming: false, status: '', startedAt: null });
});

test('an explicit terminal session projection fences the same stale active profile Run', () => {
  const profileSession: SpaceRuntimeProfileProjectionT['sessions'][number] = {
    sessionId: sid,
    surface: 'code',
    createdAt: 10,
    lastActivityAt: 20,
    activeRun: {
      runId: 'run_stale',
      sessionId: sid,
      phase: 'running',
      startedAt: 10,
    },
    queuedRuns: [],
  };

  const selected = selectActivitySnapshot(
    {
      ...idleProjection(),
      lastTerminalRun: {
        runId: 'run_stale',
        sessionId: sid,
        phase: 'completed',
        completedAt: 30,
      },
    },
    [{ kind: 'session_start', sessionId: sid, provider: 'mock' }],
    false,
    undefined,
    profileSession,
  );

  assert.deepEqual(selected, { streaming: false, status: '', startedAt: null });
});

test('a causally newer active profile boundary outranks an older idle live projection', () => {
  const profileSession: SpaceRuntimeProfileProjectionT['sessions'][number] = {
    sessionId: sid,
    surface: 'code',
    createdAt: 10,
    lastActivityAt: 20,
    activeRun: {
      runId: 'run_resumed',
      sessionId: sid,
      phase: 'running',
      startedAt: 20,
    },
    queuedRuns: [],
  };

  const selected = selectActivitySnapshot(
    idleProjection(),
    [{ kind: 'mid_turn_user_prompt', sessionId: sid, content: 'resume' }],
    false,
    undefined,
    profileSession,
    true,
    { runtimeId: 'rt_1', seq: 10 },
  );

  assert.equal(selected.streaming, true);
  assert.equal(selected.status, 'Working…');
  assert.equal(selected.startedAt, 20);
});

test('current streaming events stay active until an explicit terminal snapshot arrives', () => {
  const events: SessionEvent[] = [
    {
      kind: 'session_start',
      sessionId: sid,
      provider: 'mock',
      runtimeEvent: { runtimeId: 'rt_1', runId: 'run_streaming', seq: 10 },
    },
    {
      kind: 'thinking_delta',
      sessionId: sid,
      text: 'still reasoning',
      runtimeEvent: { runtimeId: 'rt_1', runId: 'run_streaming', seq: 11 },
    },
  ];
  const idleProfile: SpaceRuntimeProfileProjectionT['sessions'][number] = {
    sessionId: sid,
    surface: 'code',
    createdAt: 1,
    lastActivityAt: 2,
    activeRun: undefined,
    queuedRuns: [],
  };

  const active = selectActivitySnapshot(
    idleProjection(),
    events,
    false,
    undefined,
    idleProfile,
    true,
    { runtimeId: 'rt_1', seq: 9 },
  );
  assert.equal(active.streaming, true);
  assert.equal(active.status, 'Thinking…');

  const caughtUpIdle = selectActivitySnapshot(
    {
      ...idleProjection(),
      cursor: { runtimeId: 'rt_1', seq: 12 },
      lastTerminalRun: {
        runId: 'run_streaming',
        sessionId: sid,
        phase: 'completed',
        completedAt: 12,
      },
    },
    events,
    false,
    undefined,
    idleProfile,
    true,
    { runtimeId: 'rt_1', seq: 12 },
  );
  assert.deepEqual(caughtUpIdle, { streaming: false, status: '', startedAt: null });
});

test('streaming events from a previous Runtime cannot resurrect current idle state', () => {
  const selected = selectActivitySnapshot(
    { ...idleProjection(), cursor: { runtimeId: 'rt_current', seq: 2 } },
    [
      {
        kind: 'session_start',
        sessionId: sid,
        provider: 'mock',
        runtimeEvent: { runtimeId: 'rt_previous', runId: 'run_old', seq: 100 },
      },
      {
        kind: 'text_delta',
        sessionId: sid,
        text: 'old output',
        runtimeEvent: { runtimeId: 'rt_previous', runId: 'run_old', seq: 101 },
      },
    ],
    false,
    undefined,
    undefined,
    true,
    { runtimeId: 'rt_current', seq: 2 },
  );

  assert.deepEqual(selected, { streaming: false, status: '', startedAt: null });
});

test('current Runtime events outrank an idle projection retained from before reconnect', () => {
  const selected = selectActivitySnapshot(
    { ...idleProjection(), cursor: { runtimeId: 'rt_previous', seq: 100 } },
    [
      {
        kind: 'session_start',
        sessionId: sid,
        provider: 'mock',
        runtimeEvent: { runtimeId: 'rt_current', runId: 'run_current', seq: 3 },
      },
      {
        kind: 'thinking_delta',
        sessionId: sid,
        text: 'new runtime output',
        runtimeEvent: { runtimeId: 'rt_current', runId: 'run_current', seq: 4 },
      },
    ],
    false,
    undefined,
    undefined,
    true,
    { runtimeId: 'rt_current', seq: 2 },
  );

  assert.equal(selected.streaming, true);
  assert.equal(selected.status, 'Thinking…');
});

test('positive profile activity survives a newer idle live snapshot without terminal proof', () => {
  const profileSession: SpaceRuntimeProfileProjectionT['sessions'][number] = {
    sessionId: sid,
    surface: 'code',
    createdAt: 10,
    lastActivityAt: 20,
    activeRun: {
      runId: 'run_stale',
      sessionId: sid,
      phase: 'running',
      startedAt: 10,
    },
    queuedRuns: [],
  };

  const selected = selectActivitySnapshot(
    idleProjection(),
    [],
    false,
    undefined,
    profileSession,
    true,
    { runtimeId: 'rt_1', seq: 8 },
  );

  assert.equal(selected.streaming, true);
  assert.equal(selected.status, 'Working…');
});

test('an explicit terminal profile boundary clears an older active live projection', () => {
  const staleActive: SpaceSessionLiveProjectionT = {
    ...idleProjection(),
    activeRun: {
      runId: 'run_done',
      sessionId: sid,
      phase: 'running',
      startedAt: 10,
    },
  };
  const idleProfileSession: SpaceRuntimeProfileProjectionT['sessions'][number] = {
    sessionId: sid,
    surface: 'code',
    createdAt: 10,
    lastActivityAt: 30,
    activeRun: undefined,
    queuedRuns: [],
    lastTerminalRun: {
      runId: 'run_done',
      sessionId: sid,
      phase: 'completed',
      completedAt: 30,
    },
  };

  const selected = selectActivitySnapshot(
    staleActive,
    [{ kind: 'mid_turn_user_prompt', sessionId: sid, content: 'delivered correction' }],
    false,
    undefined,
    idleProfileSession,
    true,
    { runtimeId: 'rt_1', seq: 10 },
  );

  assert.deepEqual(selected, { streaming: false, status: '', startedAt: null });
});

test('alternating newer idle cursors cannot flicker a current streaming Run', () => {
  const events: SessionEvent[] = [
    {
      kind: 'session_start',
      sessionId: sid,
      provider: 'mock',
      runtimeEvent: { runtimeId: 'rt_1', runId: 'run_flicker', seq: 20 },
    },
    {
      kind: 'thinking_delta',
      sessionId: sid,
      text: 'stream keeps growing',
      runtimeEvent: { runtimeId: 'rt_1', runId: 'run_flicker', seq: 21 },
    },
  ];
  const idleProfile: SpaceRuntimeProfileProjectionT['sessions'][number] = {
    sessionId: sid,
    surface: 'code',
    createdAt: 1,
    lastActivityAt: 2,
    activeRun: undefined,
    queuedRuns: [],
  };

  for (const idleSeq of [22, 24, 26]) {
    const selected = selectActivitySnapshot(
      { ...idleProjection(), cursor: { runtimeId: 'rt_1', seq: idleSeq } },
      events,
      false,
      undefined,
      idleProfile,
      true,
      { runtimeId: 'rt_1', seq: idleSeq + 1 },
    );
    assert.equal(selected.streaming, true, `idle cursor ${idleSeq} must not hide Stop`);
    assert.equal(selected.status, 'Thinking…');
  }

  const terminal = selectActivitySnapshot(
    {
      ...idleProjection(),
      cursor: { runtimeId: 'rt_1', seq: 28 },
      lastTerminalRun: {
        runId: 'run_flicker',
        sessionId: sid,
        phase: 'completed',
        completedAt: 28,
      },
    },
    events,
    false,
    undefined,
    idleProfile,
    true,
    { runtimeId: 'rt_1', seq: 29 },
  );
  assert.deepEqual(terminal, { streaming: false, status: '', startedAt: null });
});

test('a terminal event still fences its Run when a newer profile snapshot is stale-active', () => {
  const staleActive: SpaceSessionLiveProjectionT = {
    ...idleProjection(),
    activeRun: {
      runId: 'run_done',
      sessionId: sid,
      phase: 'running',
      startedAt: 10,
    },
  };
  const staleProfileSession: SpaceRuntimeProfileProjectionT['sessions'][number] = {
    sessionId: sid,
    surface: 'code',
    createdAt: 10,
    lastActivityAt: 30,
    activeRun: staleActive.activeRun,
    queuedRuns: [],
  };

  const selected = selectActivitySnapshot(
    staleActive,
    [
      {
        kind: 'session_complete',
        sessionId: sid,
        runtimeEvent: { runtimeId: 'rt_1', runId: 'run_done', seq: 10 },
      },
    ],
    false,
    undefined,
    staleProfileSession,
    true,
    { runtimeId: 'rt_1', seq: 11 },
  );

  assert.deepEqual(selected, { streaming: false, status: '', startedAt: null });
});

test('Runtime host-tool wait is rendered from daemon requirements', () => {
  const snapshot = snapshotFromRuntimeProjection({
    sessionId: sid,
    projectionRevision: 1,
    cursor: { runtimeId: 'rt_1', seq: 3 },
    transcriptRevision: 'transcript_3',
    activeRun: {
      runId: 'run_1',
      sessionId: sid,
      phase: 'running',
      startedAt: 10,
      requirements: { hostTools: 'waiting_host' },
    },
    queuedRuns: [],
    activeTools: [],
    todos: [],
    queuedInputs: [],
    interactions: [],
  } satisfies SpaceSessionLiveProjectionT);

  assert.equal(snapshot?.status, 'Waiting for Space…');
});

test('Runtime finalization and recovery phases never fall back to Thinking', () => {
  const statusFor = (
    phase: 'running' | 'waiting_agent' | 'recovering' | 'unknown',
    stage?: 'finalizing',
    settlementNotPersisted = false,
  ) =>
    snapshotFromRuntimeProjection({
      sessionId: sid,
      projectionRevision: 1,
      cursor: { runtimeId: 'rt_1', seq: 3 },
      transcriptRevision: 'transcript_3',
      activeRun: {
        runId: `run_${phase}`,
        sessionId: sid,
        phase,
        ...(stage ? { stage } : {}),
        ...(phase === 'waiting_agent' ? { activeSubtaskCount: 2 } : {}),
        ...(phase === 'unknown'
          ? {
              ...(settlementNotPersisted
                ? {
                    lifecycleError: {
                      code: 'actor_settlement_not_persisted' as const,
                      message: 'Actor state could not be persisted.',
                      retryable: false,
                    },
                  }
                : {}),
              stop: {
                requestedAt: 12,
                state: 'unknown',
                outcome: 'unknown',
                reason: 'Host outcome could not be confirmed.',
              },
            }
          : {}),
        startedAt: 10,
      },
      queuedRuns: [],
      activeTools: [],
      todos: [],
      queuedInputs: [],
      interactions: [],
    } satisfies SpaceSessionLiveProjectionT)?.status;

  assert.equal(statusFor('waiting_agent'), 'Waiting for 2 agents…');
  assert.equal(statusFor('recovering'), 'Recovering…');
  assert.equal(statusFor('unknown'), 'Stop status unknown…');
  assert.equal(statusFor('unknown', undefined, true), 'Stopping and repairing run state…');
  assert.equal(statusFor('running', 'finalizing'), 'Finalizing…');
});

test('Runtime sandbox observation is visible without changing tool execution state', () => {
  const snapshot = snapshotFromRuntimeProjection({
    sessionId: sid,
    projectionRevision: 2,
    cursor: { runtimeId: 'rt_1', seq: 4 },
    transcriptRevision: 'transcript_4',
    activeRun: {
      runId: 'run_1',
      sessionId: sid,
      phase: 'running',
      startedAt: 10,
    },
    queuedRuns: [],
    activeTools: [
      {
        toolCallId: 'tool_1',
        name: 'bash',
        startedAt: 11,
        sandbox: {
          version: 1,
          state: 'fallback',
          reason: 'backend_failed',
          execution: 'normal_permission_policy',
        },
      },
    ],
    todos: [],
    queuedInputs: [],
    interactions: [],
  } satisfies SpaceSessionLiveProjectionT);

  assert.equal(snapshot?.status, 'Running bash…');
  assert.deepEqual(snapshot?.sandbox, {
    label: 'Sandbox fallback',
    title: 'sandbox backend failed; this tool continues under the normal permission policy.',
    tone: 'warning',
  });
});

test('Runtime sandbox presentation distinguishes applied and unselected decisions', () => {
  assert.deepEqual(
    presentRuntimeSandbox({
      version: 1,
      state: 'applied',
      backend: 'windows-restricted-user',
      policyId: 'kodax-workspace-shell-v1',
    }),
    {
      label: 'Sandboxed',
      title: 'Sandbox active (windows-restricted-user).',
      tone: 'safe',
    },
  );
  assert.deepEqual(presentRuntimeSandbox({ version: 1, state: 'not_selected' }), {
    label: 'No sandbox',
    title: 'Sandboxing was not selected for this tool.',
    tone: 'muted',
  });
});
