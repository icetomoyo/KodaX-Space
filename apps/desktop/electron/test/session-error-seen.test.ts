import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import type { SessionMeta, SpaceSessionLiveProjectionT } from '@kodax-space/space-ipc-schema';
import { useAppStore } from '../../renderer/src/store/appStore.js';
import { isUnseenTerminalError } from '../../renderer/src/features/session/useSessionStatus.js';

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

beforeEach(() => {
  useAppStore.setState({
    sessions: [session],
    currentSessionId: null,
    eventsBySession: {},
    errorSeenAtBySession: {},
    errorSeenRunIdBySession: {},
    liveProjectionBySession: {},
    pendingSendBySession: {},
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
});

test('isUnseenTerminalError gates the runtime error dot by runId', () => {
  const failed = liveWithTerminalRun('run_fail_1', 'failed');
  assert.equal(isUnseenTerminalError(failed, undefined), true);
  assert.equal(isUnseenTerminalError(failed, 'run_fail_1'), false);
  // 新一轮失败 runId 不同 → 红点重新亮起
  assert.equal(isUnseenTerminalError(liveWithTerminalRun('run_fail_2', 'failed'), 'run_fail_1'), true);
  assert.equal(isUnseenTerminalError(liveWithTerminalRun('run_1', 'interrupted'), undefined), true);
  assert.equal(isUnseenTerminalError(liveWithTerminalRun('run_1', 'completed'), undefined), false);
  assert.equal(isUnseenTerminalError(undefined, undefined), false);
});

test('removeSession cleans errorSeenRunIdBySession', () => {
  useAppStore.setState({ errorSeenRunIdBySession: { [SID]: 'run_fail_1' } });
  useAppStore.getState().removeSession(SID);
  assert.equal(useAppStore.getState().errorSeenRunIdBySession[SID], undefined);
});
