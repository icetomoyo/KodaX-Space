import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import type { SessionMeta, SpaceSessionLiveProjectionT } from '@kodax-space/space-ipc-schema';
import { useAppStore } from '../../renderer/src/store/appStore.js';
import {
  deriveSessionStatus,
  isUnseenTerminalError,
} from '../../renderer/src/features/session/useSessionStatus.js';

const SID = 's_error_seen';

const session: SessionMeta = {
  sessionId: SID,
  projectRoot: '/proj/x',
  provider: 'mock',
  reasoningMode: 'auto',
  permissionMode: 'accept-edits',
  autoModeEngine: 'llm',
  agentMode: 'ama',
  surface: 'code',
  createdAt: 1700000000000,
  lastActivityAt: 1700000000000,
};

function liveWithTerminalRun(
  runId: string,
  phase: 'failed' | 'interrupted' | 'completed',
): SpaceSessionLiveProjectionT {
  return {
    sessionId: SID,
    projectionRevision: 1,
    cursor: { runtimeId: 'rt_1', seq: 1 },
    transcriptRevision: 'tx_1',
    queuedRuns: [],
    activeTools: [],
    todos: [],
    queuedInputs: [],
    interactions: [],
    lastTerminalRun: { runId, sessionId: SID, phase, completedAt: 2 },
  };
}

function liveWithActiveRun(runId: string): SpaceSessionLiveProjectionT {
  return {
    ...liveWithTerminalRun('run_done', 'completed'),
    activeRun: { runId, sessionId: SID, phase: 'running', startedAt: 3 },
  };
}

beforeEach(() => {
  useAppStore.setState({
    sessions: [session],
    currentSessionId: null,
    eventsBySession: {},
    errorSeenAtBySession: {},
    errorSeenRunIdBySession: {},
    errorSeenRunIdsBySession: {},
    liveProjectionBySession: {},
    pendingSendBySession: {},
    pendingSendRuntimeBaselineBySession: {},
    permissionQueue: [],
    askUserQueue: [],
  });
});

test('setCurrentSession records the seen terminal runId', () => {
  useAppStore.setState({
    liveProjectionBySession: { [SID]: liveWithTerminalRun('run_fail_1', 'failed') },
  });
  useAppStore.getState().setCurrentSession(SID);
  assert.equal(useAppStore.getState().errorSeenRunIdBySession[SID], 'run_fail_1');
  assert.deepEqual(useAppStore.getState().errorSeenRunIdsBySession[SID], ['run_fail_1']);
});

test('visiting a Session acknowledges distinct profile and live terminal Runs without ordering IDs', () => {
  const connection = {
    state: 'ready' as const,
    changedAt: 1,
    stale: false,
    runtimeId: 'rt_1',
    capabilities: [],
  };
  useAppStore.setState({
    runtimeConnection: connection,
    runtimeProfile: {
      connection,
      projectionRevision: 1,
      cursor: { runtimeId: 'rt_1', seq: 1 },
      sessions: [
        {
          sessionId: SID,
          surface: 'code',
          createdAt: 1,
          lastActivityAt: 2,
          queuedRuns: [],
          lastTerminalRun: {
            runId: 'run_profile_failed',
            sessionId: SID,
            phase: 'failed',
            completedAt: 2,
          },
        },
      ],
      interactions: [],
      notifications: [],
    },
    liveProjectionBySession: {
      [SID]: liveWithTerminalRun('run_live_completed', 'completed'),
    },
  });

  assert.equal(
    deriveSessionStatus({
      pending: false,
      events: [],
      awaitingPermission: false,
      awaitingAskUser: false,
      errorSeenAt: 0,
      errorSeenRunId: undefined,
      runtimeLive: useAppStore.getState().liveProjectionBySession[SID],
      runtimeProfileActive: false,
      runtimeProfileTerminalRun: {
        runtimeId: 'rt_1',
        runId: 'run_profile_failed',
        phase: 'failed',
      },
    }),
    'error',
  );

  useAppStore.getState().setCurrentSession(SID);
  assert.deepEqual(useAppStore.getState().errorSeenRunIdsBySession[SID], [
    'run_profile_failed',
    'run_live_completed',
  ]);
  assert.equal(
    deriveSessionStatus({
      pending: false,
      events: [],
      awaitingPermission: false,
      awaitingAskUser: false,
      errorSeenAt: 0,
      errorSeenRunId: undefined,
      errorSeenRunIds: useAppStore.getState().errorSeenRunIdsBySession[SID],
      runtimeLive: useAppStore.getState().liveProjectionBySession[SID],
      runtimeProfileActive: false,
      runtimeProfileTerminalRun: {
        runtimeId: 'rt_1',
        runId: 'run_profile_failed',
        phase: 'failed',
      },
    }),
    'idle',
  );
});

test('isUnseenTerminalError gates the runtime error dot by runId', () => {
  const failed = liveWithTerminalRun('run_fail_1', 'failed');
  assert.equal(isUnseenTerminalError(failed, undefined), true);
  assert.equal(isUnseenTerminalError(failed, 'run_fail_1'), false);
  // 新一轮失败 runId 不同 → 红点重新亮起
  assert.equal(
    isUnseenTerminalError(liveWithTerminalRun('run_fail_2', 'failed'), 'run_fail_1'),
    true,
  );
  assert.equal(isUnseenTerminalError(liveWithTerminalRun('run_1', 'interrupted'), undefined), true);
  assert.equal(isUnseenTerminalError(liveWithTerminalRun('run_1', 'completed'), undefined), false);
  assert.equal(isUnseenTerminalError(undefined, undefined), false);
});

test('fresh profile activity can only add running evidence and never clears live running evidence', () => {
  assert.equal(
    deriveSessionStatus({
      pending: false,
      events: [],
      awaitingPermission: false,
      awaitingAskUser: false,
      errorSeenAt: 0,
      errorSeenRunId: undefined,
      runtimeLive: undefined,
      runtimeProfileActive: true,
    }),
    'running',
  );

  assert.equal(
    deriveSessionStatus({
      pending: false,
      events: [],
      awaitingPermission: false,
      awaitingAskUser: false,
      errorSeenAt: 0,
      errorSeenRunId: undefined,
      runtimeLive: liveWithActiveRun('run_still_live'),
      runtimeProfileActive: false,
    }),
    'running',
  );
});

test('an exact profile terminal closes stale live activity only for the same Run', () => {
  assert.equal(
    deriveSessionStatus({
      pending: false,
      events: [],
      awaitingPermission: false,
      awaitingAskUser: false,
      errorSeenAt: 0,
      errorSeenRunId: undefined,
      runtimeLive: liveWithActiveRun('run_done'),
      runtimeProfileActive: false,
      runtimeProfileTerminalRun: { runId: 'run_done', phase: 'completed' },
    }),
    'idle',
  );

  assert.equal(
    deriveSessionStatus({
      pending: false,
      events: [],
      awaitingPermission: false,
      awaitingAskUser: false,
      errorSeenAt: 0,
      errorSeenRunId: undefined,
      runtimeLive: liveWithActiveRun('run_current'),
      runtimeProfileActive: false,
      runtimeProfileTerminalRun: { runId: 'run_previous', phase: 'completed' },
    }),
    'running',
  );
});

test('an exact queued-Run terminal also clears stale pending and unbound interaction state', () => {
  const queued = liveWithTerminalRun('run_previous', 'completed');
  assert.equal(
    deriveSessionStatus({
      pending: false,
      events: [],
      awaitingPermission: true,
      awaitingAskUser: false,
      errorSeenAt: 0,
      errorSeenRunId: undefined,
      runtimeLive: {
        ...queued,
        queuedRuns: [
          {
            runId: 'run_queued',
            sessionId: SID,
            phase: 'queued',
            queuedAt: 3,
          },
        ],
        interactions: [
          {
            kind: 'ask-user',
            source: 'coder-runtime',
            createdAt: 3,
            state: 'pending',
            request: {
              kind: 'input',
              reqId: 'ask-stale',
              sessionId: SID,
              question: 'stale?',
            },
          },
        ],
      },
      runtimeProfileActive: false,
      runtimeProfileTerminalRun: { runId: 'run_queued', phase: 'completed' },
    }),
    'idle',
  );
});

test('a queued-Run terminal cannot clear another active Run waiting interaction', () => {
  const queued = liveWithTerminalRun('run_previous', 'completed');
  assert.equal(
    deriveSessionStatus({
      pending: false,
      events: [],
      awaitingPermission: true,
      awaitingAskUser: false,
      errorSeenAt: 0,
      errorSeenRunId: undefined,
      runtimeLive: {
        ...queued,
        activeRun: {
          runId: 'run_active',
          sessionId: SID,
          phase: 'waiting_permission',
          startedAt: 3,
        },
        queuedRuns: [
          {
            runId: 'run_queued',
            sessionId: SID,
            phase: 'queued',
            queuedAt: 3,
          },
        ],
        interactions: [
          {
            kind: 'ask-user',
            source: 'coder-runtime',
            createdAt: 3,
            state: 'pending',
            request: {
              kind: 'input',
              reqId: 'ask-active',
              sessionId: SID,
              question: 'active?',
            },
          },
        ],
      },
      runtimeProfileActive: false,
      runtimeProfileTerminalRun: { runId: 'run_queued', phase: 'completed' },
    }),
    'awaiting',
  );
});

test('a queued-Run terminal cannot clear another queued Run interaction', () => {
  const queued = liveWithTerminalRun('run_previous', 'completed');
  assert.equal(
    deriveSessionStatus({
      pending: false,
      events: [],
      awaitingPermission: true,
      awaitingAskUser: false,
      errorSeenAt: 0,
      errorSeenRunId: undefined,
      runtimeLive: {
        ...queued,
        queuedRuns: [
          {
            runId: 'run_terminal',
            sessionId: SID,
            phase: 'queued',
            queuedAt: 3,
          },
          {
            runId: 'run_waiting',
            sessionId: SID,
            phase: 'queued',
            queuedAt: 4,
          },
        ],
        interactions: [
          {
            kind: 'ask-user',
            source: 'coder-runtime',
            createdAt: 4,
            state: 'pending',
            request: {
              kind: 'input',
              reqId: 'ask-queued',
              sessionId: SID,
              question: 'queued?',
            },
          },
        ],
      },
      runtimeProfileActive: false,
      runtimeProfileTerminalRun: { runId: 'run_terminal', phase: 'completed' },
    }),
    'awaiting',
  );
});

test('a profile-only active Run keeps session-level waiting evidence after an old queued terminal', () => {
  const queued = liveWithTerminalRun('run_previous', 'completed');
  assert.equal(
    deriveSessionStatus({
      pending: false,
      events: [],
      awaitingPermission: true,
      awaitingAskUser: false,
      errorSeenAt: 0,
      errorSeenRunId: undefined,
      runtimeLive: {
        ...queued,
        queuedRuns: [
          {
            runId: 'run_old_queued',
            sessionId: SID,
            phase: 'queued',
            queuedAt: 3,
          },
        ],
      },
      runtimeProfileActive: true,
      runtimeProfileTerminalRun: { runId: 'run_old_queued', phase: 'completed' },
    }),
    'awaiting',
  );
});

test('a profile terminal from another Runtime cannot close a local lifecycle event', () => {
  assert.equal(
    deriveSessionStatus({
      pending: false,
      events: [
        {
          kind: 'session_start',
          sessionId: SID,
          provider: 'mock',
          runtimeEvent: { runtimeId: 'rt_old', runId: 'run_reused', seq: 1 },
        },
      ],
      awaitingPermission: false,
      awaitingAskUser: false,
      errorSeenAt: 0,
      errorSeenRunId: undefined,
      runtimeLive: undefined,
      runtimeProfileActive: false,
      runtimeProfileTerminalRun: {
        runId: 'run_reused',
        phase: 'completed',
        runtimeId: 'rt_new',
      },
    }),
    'running',
  );
});

test('a terminal snapshot clears a stale same-Run start when the terminal push was missed', () => {
  assert.equal(
    deriveSessionStatus({
      pending: false,
      events: [
        {
          kind: 'session_start',
          sessionId: SID,
          provider: 'mock',
          runtimeEvent: { runtimeId: 'rt_1', runId: 'run_done', seq: 1 },
        },
      ],
      awaitingPermission: false,
      awaitingAskUser: false,
      errorSeenAt: 0,
      errorSeenRunId: undefined,
      runtimeLive: {
        ...liveWithTerminalRun('run_done', 'completed'),
        cursor: { runtimeId: 'rt_1', seq: 2 },
      },
      runtimeProfileActive: false,
    }),
    'idle',
  );
});

test('removeSession cleans terminal error acknowledgement state', () => {
  useAppStore.setState({
    errorSeenRunIdBySession: { [SID]: 'run_fail_1' },
    errorSeenRunIdsBySession: { [SID]: ['run_fail_1'] },
  });
  useAppStore.getState().removeSession(SID);
  assert.equal(useAppStore.getState().errorSeenRunIdBySession[SID], undefined);
  assert.equal(useAppStore.getState().errorSeenRunIdsBySession[SID], undefined);
});
