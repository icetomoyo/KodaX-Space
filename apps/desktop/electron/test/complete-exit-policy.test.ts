import assert from 'node:assert/strict';
import test from 'node:test';

import {
  collectSpaceExitWorkBlockers,
  commitRelaunchBeforeDelayedQuit,
  daemonStopWasConfirmed,
  runAdmittedCompleteExit,
  runForcedCompleteExit,
  resolveBlockedCompleteExitAction,
  shouldCancelSessionWideOnForcedExit,
  shouldRecoverRuntimeAfterShutdownTimeout,
  shouldRequestCompleteExitOnBeforeQuit,
} from '../window/complete-exit-policy.js';

test('all ordinary app quit requests enter complete-exit coordination', () => {
  assert.equal(
    shouldRequestCompleteExitOnBeforeQuit({
      cleanupStarted: false,
      daemonStopCommitted: false,
      forcedExitCommitted: false,
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
      runtimeModeRestartScheduled: false,
      secondaryInstanceExit: false,
    },
    {
      cleanupStarted: false,
      daemonStopCommitted: true,
      forcedExitCommitted: false,
      runtimeModeRestartScheduled: false,
      secondaryInstanceExit: false,
    },
    {
      cleanupStarted: false,
      daemonStopCommitted: false,
      forcedExitCommitted: false,
      runtimeModeRestartScheduled: true,
      secondaryInstanceExit: false,
    },
    {
      cleanupStarted: false,
      daemonStopCommitted: false,
      forcedExitCommitted: true,
      runtimeModeRestartScheduled: false,
      secondaryInstanceExit: false,
    },
    {
      cleanupStarted: false,
      daemonStopCommitted: false,
      forcedExitCommitted: false,
      runtimeModeRestartScheduled: false,
      secondaryInstanceExit: true,
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

test('admitted complete exit hides its surface before daemon shutdown finishes', async () => {
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

  assert.deepEqual(events, ['surface:hidden', 'daemon:stopping']);
  finishDaemonStop?.();
  await exit;
  assert.deepEqual(events, [
    'surface:hidden',
    'daemon:stopping',
    'daemon:stopped',
    'exit:committed',
  ]);
});

test('failed admitted shutdown stays uncommitted after its surface was hidden', async () => {
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
  assert.deepEqual(events, ['surface:hidden', 'daemon:stopping']);
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
