import assert from 'node:assert/strict';
import test from 'node:test';

import {
  collectSpaceExitWorkBlockers,
  commitRelaunchBeforeDelayedQuit,
  daemonStopWasConfirmed,
  resolveCompleteExitDisposition,
  runAdmittedCompleteExit,
  runForcedCompleteExit,
  resolveBlockedCompleteExitAction,
  resolveFailedCompleteExitAction,
  shouldRetryDaemonStopAfterFailedCompleteExit,
  shouldCancelSessionWideOnForcedExit,
  shouldCountLocalSessionExitBlocker,
  shouldRecoverRuntimeAfterShutdownTimeout,
  shouldRequestCompleteExitOnBeforeQuit,
} from '../window/complete-exit-policy.js';

test('connected clients alone preserve the shared Runtime without blocking Space exit', () => {
  assert.equal(
    resolveCompleteExitDisposition({
      spaceBlockers: [],
      runtimeBlockers: ['connected_clients'],
    }),
    'exit-preserve-runtime',
  );

  for (const input of [
    { spaceBlockers: ['space_sessions:1'], runtimeBlockers: ['connected_clients'] },
    { spaceBlockers: [], runtimeBlockers: ['connected_clients', 'active_runs'] },
  ]) {
    assert.equal(resolveCompleteExitDisposition(input), 'confirm-blocked-exit');
  }

  assert.equal(
    resolveCompleteExitDisposition({ spaceBlockers: [], runtimeBlockers: [] }),
    'stop-runtime-and-exit',
  );
});

test('all ordinary app quit requests enter complete-exit coordination', () => {
  assert.equal(
    shouldRequestCompleteExitOnBeforeQuit({
      cleanupStarted: false,
      daemonStopCommitted: false,
      forcedExitCommitted: false,
      sharedRuntimeExitCommitted: false,
      runtimeModeRestartScheduled: false,
      secondaryInstanceExit: false,
    }),
    true,
  );
});

test('internal restart, committed cleanup, and secondary processes bypass complete-exit admission', () => {
  for (const state of [
    {
      cleanupStarted: true,
      daemonStopCommitted: false,
      forcedExitCommitted: false,
      sharedRuntimeExitCommitted: false,
      runtimeModeRestartScheduled: false,
      secondaryInstanceExit: false,
    },
    {
      cleanupStarted: false,
      daemonStopCommitted: true,
      forcedExitCommitted: false,
      sharedRuntimeExitCommitted: false,
      runtimeModeRestartScheduled: false,
      secondaryInstanceExit: false,
    },
    {
      cleanupStarted: false,
      daemonStopCommitted: false,
      forcedExitCommitted: false,
      sharedRuntimeExitCommitted: false,
      runtimeModeRestartScheduled: true,
      secondaryInstanceExit: false,
    },
    {
      cleanupStarted: false,
      daemonStopCommitted: false,
      forcedExitCommitted: true,
      sharedRuntimeExitCommitted: false,
      runtimeModeRestartScheduled: false,
      secondaryInstanceExit: false,
    },
    {
      cleanupStarted: false,
      daemonStopCommitted: false,
      forcedExitCommitted: false,
      sharedRuntimeExitCommitted: false,
      runtimeModeRestartScheduled: false,
      secondaryInstanceExit: true,
    },
    {
      cleanupStarted: false,
      daemonStopCommitted: false,
      forcedExitCommitted: false,
      sharedRuntimeExitCommitted: true,
      runtimeModeRestartScheduled: false,
      secondaryInstanceExit: false,
    },
  ]) {
    assert.equal(shouldRequestCompleteExitOnBeforeQuit(state), false);
  }
});

test('only a positively stopped daemon permits Space to disappear', () => {
  assert.equal(daemonStopWasConfirmed({ stopped: true }), true);
  assert.equal(daemonStopWasConfirmed({ stopped: false, reason: 'missing' }), false);
  assert.equal(daemonStopWasConfirmed({ stopped: false, reason: 'blocked' }), false);
  assert.equal(daemonStopWasConfirmed({ stopped: false, reason: 'command_failed' }), false);
});

test('blocked complete exit requires the explicit destructive response', () => {
  assert.equal(resolveBlockedCompleteExitAction(1), 'force-close');
  for (const response of [-1, 0, 2]) {
    assert.equal(resolveBlockedCompleteExitAction(response), 'keep-open');
  }
});

test('failed complete exit restarts only after a committed Runtime stop', () => {
  assert.equal(resolveFailedCompleteExitAction(0, false), 'keep-open');
  assert.equal(resolveFailedCompleteExitAction(0, true), 'restart-recovery');
  assert.equal(resolveFailedCompleteExitAction(1, true), 'force-close');
  assert.equal(shouldRetryDaemonStopAfterFailedCompleteExit(false), true);
  assert.equal(shouldRetryDaemonStopAfterFailedCompleteExit(true), false);
});

test('forced shutdown timeouts never schedule Runtime recovery', () => {
  assert.equal(
    shouldRecoverRuntimeAfterShutdownTimeout({
      forcedExitCommitted: true,
      daemonStopCommitted: true,
    }),
    false,
  );
  assert.equal(
    shouldRecoverRuntimeAfterShutdownTimeout({
      forcedExitCommitted: false,
      daemonStopCommitted: true,
    }),
    true,
  );
  assert.equal(
    shouldRecoverRuntimeAfterShutdownTimeout({
      forcedExitCommitted: false,
      daemonStopCommitted: false,
    }),
    false,
  );
});

test('forced exit never applies a Session-wide Stop to daemon-backed Coder work', () => {
  assert.equal(
    shouldCancelSessionWideOnForcedExit({ surface: 'code', runtimeSelected: true }),
    false,
  );
  assert.equal(
    shouldCancelSessionWideOnForcedExit({ surface: 'code', runtimeSelected: false }),
    true,
  );
  assert.equal(
    shouldCancelSessionWideOnForcedExit({ surface: 'partner', runtimeSelected: true }),
    true,
  );
});

test('authoritative daemon idle ignores only stale local daemon Coder activity', () => {
  assert.equal(
    shouldCountLocalSessionExitBlocker({
      surface: 'code',
      runtimeSelected: true,
      runtimeAuthorityReady: true,
    }),
    false,
  );
  for (const input of [
    { surface: 'partner' as const, runtimeSelected: true, runtimeAuthorityReady: true },
    { surface: 'code' as const, runtimeSelected: false, runtimeAuthorityReady: true },
    { surface: 'code' as const, runtimeSelected: true, runtimeAuthorityReady: false },
  ]) {
    assert.equal(shouldCountLocalSessionExitBlocker(input), true);
  }
});

test('complete exit reports every Space-owned executable-work blocker', () => {
  assert.deepEqual(
    collectSpaceExitWorkBlockers({
      runningSessions: 2,
      runningWorkflows: 1,
      pendingPermissions: 1,
      pendingUserInputs: 1,
      queuedPrompts: 3,
      activeExternalTasks: 1,
    }),
    [
      'space_sessions:2',
      'space_workflows:1',
      'space_permissions:1',
      'space_user_inputs:1',
      'space_queued_prompts:3',
      'space_external_tasks:1',
    ],
  );
  assert.deepEqual(
    collectSpaceExitWorkBlockers({
      runningSessions: 0,
      runningWorkflows: 0,
      pendingPermissions: 0,
      pendingUserInputs: 0,
      queuedPrompts: 0,
      activeExternalTasks: 0,
    }),
    [],
  );
});

test('admitted complete exit keeps its surface visible until daemon shutdown is verified', async () => {
  const events: string[] = [];
  let finishDaemonStop: (() => void) | undefined;
  const daemonStopped = new Promise<void>((resolve) => {
    finishDaemonStop = resolve;
  });

  const exit = runAdmittedCompleteExit({
    hideControlSurface: () => events.push('surface:hidden'),
    stopDaemon: async () => {
      events.push('daemon:stopping');
      await daemonStopped;
      events.push('daemon:stopped');
    },
    commitExit: () => events.push('exit:committed'),
  });

  assert.deepEqual(events, ['daemon:stopping']);
  finishDaemonStop?.();
  await exit;
  assert.deepEqual(events, [
    'daemon:stopping',
    'daemon:stopped',
    'surface:hidden',
    'exit:committed',
  ]);
});

test('failed admitted shutdown stays visible and uncommitted', async () => {
  const events: string[] = [];
  const failure = new Error('daemon stop failed');

  await assert.rejects(
    runAdmittedCompleteExit({
      hideControlSurface: () => events.push('surface:hidden'),
      stopDaemon: async () => {
        events.push('daemon:stopping');
        throw failure;
      },
      commitExit: () => events.push('exit:committed'),
    }),
    failure,
  );
  assert.deepEqual(events, ['daemon:stopping']);
});

test('forced complete exit stops Space-owned work before attempting daemon shutdown', async () => {
  const events: string[] = [];
  const result = await runForcedCompleteExit({
    hideControlSurface: () => events.push('surface:hidden'),
    stopOwnedWork: async () => {
      events.push('work:stopped');
    },
    tryStopDaemon: async () => {
      events.push('daemon:stopped');
      return true;
    },
    commitExit: (outcome) => {
      events.push(`exit:committed:${outcome.daemonStopConfirmed}`);
    },
  });

  assert.deepEqual(events, [
    'surface:hidden',
    'work:stopped',
    'daemon:stopped',
    'exit:committed:true',
  ]);
  assert.equal(result.ownedWorkStopCompleted, true);
  assert.equal(result.daemonStopConfirmed, true);
  assert.deepEqual(result.failures, []);
});

test('forced complete exit stays user-committed when task or daemon stopping fails', async () => {
  const events: string[] = [];
  const result = await runForcedCompleteExit({
    hideControlSurface: () => events.push('surface:hidden'),
    stopOwnedWork: async () => {
      events.push('work:failed');
      throw new Error('task cancellation timed out');
    },
    tryStopDaemon: async () => {
      events.push('daemon:failed');
      throw new Error('daemon still busy');
    },
    commitExit: (outcome) => {
      events.push(`exit:committed:${outcome.daemonStopConfirmed}`);
    },
  });

  assert.deepEqual(events, [
    'surface:hidden',
    'work:failed',
    'daemon:failed',
    'exit:committed:false',
  ]);
  assert.equal(result.ownedWorkStopCompleted, false);
  assert.equal(result.daemonStopConfirmed, false);
  assert.equal(result.failures.length, 2);
});

test('internal restart commits relaunch before it becomes eligible to bypass complete exit', () => {
  const events: string[] = [];
  let delayedQuit: (() => void) | undefined;

  commitRelaunchBeforeDelayedQuit({
    commitRelaunch: () => events.push('relaunch-committed'),
    markCommitted: () => events.push('bypass-enabled'),
    scheduleQuit: (callback, delayMs) => {
      events.push(`quit-scheduled:${delayMs}`);
      delayedQuit = callback;
    },
    requestQuit: () => events.push('quit-requested'),
    delayMs: 250,
  });

  assert.deepEqual(events, ['relaunch-committed', 'bypass-enabled', 'quit-scheduled:250']);
  delayedQuit?.();
  assert.deepEqual(events, [
    'relaunch-committed',
    'bypass-enabled',
    'quit-scheduled:250',
    'quit-requested',
  ]);
});
