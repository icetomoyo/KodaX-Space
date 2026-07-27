import assert from 'node:assert/strict';
import test from 'node:test';

import type { SessionEvent } from '@kodax-space/space-ipc-schema';
import {
  createSessionEventBatcher,
  type SessionEventBatchScheduler,
} from '../../renderer/src/store/sessionEventBatcher.js';

const inertScheduler: SessionEventBatchScheduler = {
  isBackground: () => false,
  requestFrame: () => 1,
  cancelFrame: () => {},
  setTimer: () => 2,
  clearTimer: () => {},
};

function delta(sessionId: string, text: string, seq: number): SessionEvent {
  return {
    kind: 'text_delta',
    sessionId,
    text,
    runtimeEvent: { runtimeId: 'rt_1', runId: 'run_1', seq },
  };
}

test('snapshot barrier holds one Session while other Sessions continue flushing', () => {
  const appended: SessionEvent[] = [];
  let cursor:
    | {
        readonly runtimeId: string;
        readonly runId: string;
        readonly seq: number;
        readonly assistantDraftSeq: number;
      }
    | undefined;
  const batcher = createSessionEventBatcher((event) => appended.push(event), {
    scheduler: inertScheduler,
    snapshotCursor: () => cursor,
  });

  batcher.pause('s_1');
  batcher.push(delta('s_1', 'c', 3));
  batcher.push(delta('s_1', 'd', 4));
  batcher.push({ kind: 'text_delta', sessionId: 's_2', text: 'other' });
  batcher.flush();

  assert.deepEqual(
    appended.map((event) => event.sessionId),
    ['s_2'],
  );

  cursor = { runtimeId: 'rt_1', runId: 'run_1', seq: 3, assistantDraftSeq: 3 };
  batcher.resume('s_1');
  batcher.flush();

  const released = appended.filter(
    (event): event is Extract<SessionEvent, { kind: 'text_delta' }> =>
      event.sessionId === 's_1' && event.kind === 'text_delta',
  );
  assert.deepEqual(
    released.map((event) => event.text),
    ['c', 'd'],
    'covered and post-cursor deltas must remain separate for store filtering',
  );

  batcher.push(delta('s_1', 'e', 5));
  batcher.push(delta('s_1', 'f', 6));
  batcher.flush();
  const last = appended.at(-1);
  assert.equal(
    last?.kind === 'text_delta' ? last.text : undefined,
    'ef',
    'post-cursor deltas may still batch for renderer performance',
  );
  batcher.dispose();
});

test('snapshot drain preserves raw lifecycle, tool, and delta ordering for one paused Session', () => {
  const appended: SessionEvent[] = [];
  const batcher = createSessionEventBatcher((event) => appended.push(event), {
    scheduler: inertScheduler,
  });

  batcher.pause('s_1');
  batcher.push({
    kind: 'session_start',
    sessionId: 's_1',
    provider: 'custom',
    runtimeEvent: { runtimeId: 'rt_1', runId: 'run_1', seq: 1 },
  });
  batcher.push(delta('s_1', 'a', 2));
  batcher.push(delta('s_1', 'b', 3));
  batcher.push({
    kind: 'tool_start',
    sessionId: 's_1',
    toolId: 'tool_1',
    toolName: 'read_file',
    runtimeEvent: { runtimeId: 'rt_1', runId: 'run_1', seq: 4 },
  });
  batcher.push({
    kind: 'tool_progress',
    sessionId: 's_1',
    toolId: 'tool_1',
    message: 'reading',
    runtimeEvent: { runtimeId: 'rt_1', runId: 'run_1', seq: 5 },
  });

  batcher.drain('s_1');

  assert.deepEqual(
    appended.map((event) =>
      event.kind === 'text_delta' ? `${event.kind}:${event.text}` : event.kind,
    ),
    ['session_start', 'text_delta:a', 'text_delta:b', 'tool_start', 'tool_progress'],
  );
  batcher.resume('s_1');
  batcher.dispose();
});
