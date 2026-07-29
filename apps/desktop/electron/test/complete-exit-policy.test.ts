import assert from 'node:assert/strict';
import test from 'node:test';

import {
  collectSpaceExitWorkBlockers,
  commitRelaunchBeforeDelayedQuit,
  daemonStopWasConfirmed,
  shouldRequestCompleteExitOnBeforeQuit,
} from '../window/complete-exit-policy.js';

test('all ordinary app quit requests enter complete-exit coordination', () => {
  assert.equal(
    shouldRequestCompleteExitOnBeforeQuit({
      cleanupStarted: false,
      daemonStopCommitted: false,
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
      runtimeModeRestartScheduled: false,
      secondaryInstanceExit: false,
    },
    {
      cleanupStarted: false,
      daemonStopCommitted: true,
      runtimeModeRestartScheduled: false,
      secondaryInstanceExit: false,
    },
    {
      cleanupStarted: false,
      daemonStopCommitted: false,
      runtimeModeRestartScheduled: true,
      secondaryInstanceExit: false,
    },
    {
      cleanupStarted: false,
      daemonStopCommitted: false,
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
