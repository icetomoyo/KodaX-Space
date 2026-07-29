import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { SessionEvent, SpaceSessionLiveProjectionT } from '@kodax-space/space-ipc-schema';
import {
  presentRuntimeSandbox,
  selectActivitySnapshot,
  snapshotFromEvents,
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
  assert.deepEqual(
    presentRuntimeSandbox({ version: 1, state: 'not_selected' }),
    {
      label: 'No sandbox',
      title: 'Sandboxing was not selected for this tool.',
      tone: 'muted',
    },
  );
});
