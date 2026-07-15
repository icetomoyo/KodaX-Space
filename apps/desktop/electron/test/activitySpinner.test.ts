import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { SessionEvent, SpaceSessionLiveProjectionT } from '@kodax-space/space-ipc-schema';
import {
  snapshotFromEvents,
  snapshotFromRuntimeProjection,
} from '../../renderer/src/shell/ActivitySpinner.js';

const sid = 's_activity_spinner';

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
