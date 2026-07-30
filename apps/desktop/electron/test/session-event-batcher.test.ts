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

test('snapshot drain preserves structural order while coalescing only within the incoming barrier', () => {
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

  batcher.drain('s_1', {
    runtimeId: 'rt_1',
    runId: 'run_1',
    seq: 2,
    assistantDraftSeq: 2,
  });

  assert.deepEqual(
    appended.map((event) =>
      event.kind === 'text_delta' ? `${event.kind}:${event.text}` : event.kind,
    ),
    ['session_start', 'text_delta:a', 'text_delta:b', 'tool_start', 'tool_progress'],
  );
  batcher.resume('s_1');
  batcher.dispose();
});

test('snapshot drain collapses a large same-side fragment burst without losing exact text', () => {
  const appended: SessionEvent[] = [];
  const batcher = createSessionEventBatcher((event) => appended.push(event), {
    scheduler: inertScheduler,
  });

  batcher.pause('s_1');
  for (let seq = 1; seq <= 10_000; seq += 1) {
    batcher.push(delta('s_1', String(seq % 10), seq));
  }
  batcher.drain('s_1', {
    runtimeId: 'rt_1',
    runId: 'run_1',
    seq: 10_000,
    assistantDraftSeq: 10_000,
  });

  assert.equal(appended.length, 1);
  assert.equal(
    appended[0]?.kind === 'text_delta' ? appended[0].text : undefined,
    Array.from({ length: 10_000 }, (_, index) => String((index + 1) % 10)).join(''),
  );
  assert.equal(
    appended[0]?.kind === 'text_delta' ? appended[0].runtimeEvent?.seq : undefined,
    10_000,
  );
  batcher.dispose();
});

test('adjacent tool input is concatenated and tool progress keeps only the newest value', () => {
  const appended: SessionEvent[] = [];
  const batcher = createSessionEventBatcher((event) => appended.push(event), {
    scheduler: inertScheduler,
  });
  const runtimeEvent = { runtimeId: 'rt_1', runId: 'run_1', seq: 1 };

  batcher.push({
    kind: 'tool_input_delta',
    sessionId: 's_1',
    toolId: 'tool_1',
    toolName: 'write',
    partialJson: '{"path":',
    runtimeEvent,
  });
  batcher.push({
    kind: 'tool_input_delta',
    sessionId: 's_1',
    toolId: 'tool_1',
    toolName: 'write',
    partialJson: '"README.md"}',
    runtimeEvent: { ...runtimeEvent, seq: 2 },
  });
  batcher.push({
    kind: 'tool_progress',
    sessionId: 's_1',
    toolId: 'tool_1',
    message: 'writing 10%',
    runtimeEvent: { ...runtimeEvent, seq: 3 },
  });
  batcher.push({
    kind: 'tool_progress',
    sessionId: 's_1',
    toolId: 'tool_1',
    message: 'writing 90%',
    runtimeEvent: { ...runtimeEvent, seq: 4 },
  });
  batcher.flush();

  assert.deepEqual(
    appended.map((event) =>
      event.kind === 'tool_input_delta'
        ? `${event.kind}:${event.partialJson}`
        : event.kind === 'tool_progress'
          ? `${event.kind}:${event.message}`
          : event.kind,
    ),
    ['tool_input_delta:{"path":"README.md"}', 'tool_progress:writing 90%'],
  );
  batcher.dispose();
});

test('tool input without a call id is never concatenated across ambiguous calls', () => {
  const appended: SessionEvent[] = [];
  const batcher = createSessionEventBatcher((event) => appended.push(event), {
    scheduler: inertScheduler,
  });

  batcher.push({
    kind: 'tool_input_delta',
    sessionId: 's_1',
    toolName: 'write',
    partialJson: '{"first":true}',
  });
  batcher.push({
    kind: 'tool_input_delta',
    sessionId: 's_1',
    toolName: 'write',
    partialJson: '{"second":true}',
  });
  batcher.flush();

  assert.deepEqual(
    appended.map((event) => (event.kind === 'tool_input_delta' ? event.partialJson : undefined)),
    ['{"first":true}', '{"second":true}'],
  );
  batcher.dispose();
});
