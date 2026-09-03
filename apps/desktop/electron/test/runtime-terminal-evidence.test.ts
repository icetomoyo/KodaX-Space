// FEATURE_274 T1 — terminal evidence carries the settled Run's turnId.
//
// 结算认证身份化的证据管道：三处证据构造点（live 投影候选、runtime profile 候选、
// 直连 terminal 事件）都必须携带 lastTerminalRun.turnId，让完成判定能按 turn
// 身份确认页内 assistant 行。turnId 缺失是合法状态（fail-open，presence 检查跳过）。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  runtimeTerminalEvidenceCandidates,
  terminalEventEvidence,
  type RuntimeTerminalEvidence,
} from '../../renderer/src/store/runtimeProjectionState.js';

const RUNTIME_ID = 'rt_evidence';
const SESSION_ID = 'session-evidence-turn';
const RUN_ID = 'run_evidence';
const TURN_ID = 'turn_evidence';

function freshConnection(): {
  state: 'ready';
  changedAt: number;
  stale: false;
  runtimeId: string;
  capabilities: [];
} {
  return {
    state: 'ready',
    changedAt: 1,
    stale: false,
    runtimeId: RUNTIME_ID,
    capabilities: [],
  };
}

function liveProjection(input: {
  readonly runtimeId?: string;
  readonly seq?: number;
  readonly terminalRunId?: string;
  readonly terminalTurnId?: string;
}) {
  return {
    sessionId: SESSION_ID,
    projectionRevision: 1,
    cursor: {
      runtimeId: input.runtimeId ?? RUNTIME_ID,
      seq: input.seq ?? 5,
      sessionId: SESSION_ID,
      journalEpoch: 'epoch-1',
    },
    activeRun: undefined,
    queuedRuns: [],
    interactions: [],
    transcriptRevision: 'transcript-revision-1',
    activeTools: [],
    todos: [],
    queuedInputs: [],
    ...(input.terminalRunId === undefined
      ? {}
      : {
          lastTerminalRun: {
            runId: input.terminalRunId,
            sessionId: SESSION_ID,
            phase: 'completed' as const,
            ...(input.terminalTurnId === undefined ? {} : { turnId: input.terminalTurnId }),
          },
        }),
  };
}

test('live projection evidence carries the terminal run turnId', () => {
  const [evidence] = runtimeTerminalEvidenceCandidates(
    {
      connection: freshConnection(),
      profile: null,
      liveBySession: {
        [SESSION_ID]: liveProjection({ terminalRunId: RUN_ID, terminalTurnId: TURN_ID }),
      },
    },
    SESSION_ID,
  );
  assert.notEqual(evidence, undefined);
  assert.equal(evidence!.runId, RUN_ID);
  assert.equal(evidence!.turnId, TURN_ID);
});

test('profile evidence carries the terminal run turnId', () => {
  const connection = freshConnection();
  const [evidence] = runtimeTerminalEvidenceCandidates(
    {
      connection,
      profile: {
        connection,
        projectionRevision: 1,
        cursor: { runtimeId: RUNTIME_ID, seq: 5 },
        sessions: [
          {
            sessionId: SESSION_ID,
            surface: 'code' as const,
            createdAt: 1,
            lastActivityAt: 2,
            queuedRuns: [],
            lastTerminalRun: {
              runId: RUN_ID,
              sessionId: SESSION_ID,
              phase: 'completed' as const,
              turnId: TURN_ID,
            },
          },
        ],
        interactions: [],
        notifications: [],
      },
      liveBySession: {},
    },
    SESSION_ID,
  );
  assert.notEqual(evidence, undefined);
  assert.equal(evidence!.turnId, TURN_ID);
});

test('terminal event evidence fills turnId from the matching live lastTerminalRun', () => {
  const evidence = terminalEventEvidence({
    kind: 'session_complete',
    sessionId: SESSION_ID,
    runtimeEvent: { runtimeId: RUNTIME_ID, runId: RUN_ID, seq: 7 },
    connection: freshConnection(),
    liveBySession: {
      [SESSION_ID]: liveProjection({ terminalRunId: RUN_ID, terminalTurnId: TURN_ID }),
    },
  });
  assert.notEqual(evidence, undefined);
  assert.equal(evidence!.phase, 'completed');
  assert.equal(evidence!.cursorSeq, 7);
  assert.equal(evidence!.turnId, TURN_ID);
});

test('terminal event evidence marks session_error as failed and still carries turnId', () => {
  const evidence = terminalEventEvidence({
    kind: 'session_error',
    sessionId: SESSION_ID,
    runtimeEvent: { runtimeId: RUNTIME_ID, runId: RUN_ID, seq: 9 },
    connection: freshConnection(),
    liveBySession: {
      [SESSION_ID]: liveProjection({ terminalRunId: RUN_ID, terminalTurnId: TURN_ID }),
    },
  });
  assert.notEqual(evidence, undefined);
  assert.equal(evidence!.phase, 'failed');
  assert.equal(evidence!.turnId, TURN_ID);
});

test('terminal event evidence without a runtime event origin returns undefined', () => {
  const evidence = terminalEventEvidence({
    kind: 'session_complete',
    sessionId: SESSION_ID,
    runtimeEvent: undefined,
    connection: freshConnection(),
    liveBySession: {},
  });
  assert.equal(evidence, undefined);
});

test('terminal event evidence refuses a stale or foreign-runtime connection', () => {
  const stale = { ...freshConnection(), stale: true as const };
  assert.equal(
    terminalEventEvidence({
      kind: 'session_complete',
      sessionId: SESSION_ID,
      runtimeEvent: { runtimeId: RUNTIME_ID, runId: RUN_ID, seq: 7 },
      connection: stale,
      liveBySession: {},
    }),
    undefined,
  );
  assert.equal(
    terminalEventEvidence({
      kind: 'session_complete',
      sessionId: SESSION_ID,
      runtimeEvent: { runtimeId: 'rt_other', runId: RUN_ID, seq: 7 },
      connection: freshConnection(),
      liveBySession: {},
    }),
    undefined,
  );
});

test('terminal event evidence without a matching live terminal run stays turnId-less', () => {
  const evidence = terminalEventEvidence({
    kind: 'session_complete',
    sessionId: SESSION_ID,
    runtimeEvent: { runtimeId: RUNTIME_ID, runId: RUN_ID, seq: 7 },
    connection: freshConnection(),
    liveBySession: {
      [SESSION_ID]: liveProjection({ terminalRunId: 'run_other', terminalTurnId: TURN_ID }),
    },
  }) as RuntimeTerminalEvidence;
  assert.notEqual(evidence, undefined);
  assert.equal(evidence.turnId, undefined);
});

test('terminal event evidence with no live projection at all stays turnId-less', () => {
  const evidence = terminalEventEvidence({
    kind: 'session_complete',
    sessionId: SESSION_ID,
    runtimeEvent: { runtimeId: RUNTIME_ID, runId: RUN_ID, seq: 7 },
    connection: freshConnection(),
    liveBySession: {},
  });
  assert.notEqual(evidence, undefined);
  assert.equal(evidence!.turnId, undefined);
});
