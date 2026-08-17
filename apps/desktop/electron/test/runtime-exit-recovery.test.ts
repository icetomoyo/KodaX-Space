import assert from 'node:assert/strict';
import test from 'node:test';

import {
  resolveRuntimeExitRecoveryStartup,
  runRuntimeStartupBoundary,
} from '../window/runtime-exit-recovery.js';

test('the actual startup boundary orders settlement, owner reconciliation, and initialization', async () => {
  const order: string[] = [];
  const decision = await runRuntimeStartupBoundary({
    recoveryRequested: true,
    scanPendingExit: true,
    settle: async () => {
      order.push('settle');
      return {
        status: 'blocked',
        reason: 'stop_not_accepted',
        nextAction: 'keep-open',
        message: 'no exit intent is pending',
      };
    },
    reconcileOwnerPolicy: async () => {
      order.push('owner-reconcile');
      return true;
    },
    prepareStartup: async () => {
      order.push('prepare');
    },
    initializeRuntime: () => {
      order.push('initialize');
    },
  });

  assert.equal(decision.action, 'continue');
  assert.deepEqual(order, ['settle', 'owner-reconcile', 'prepare', 'initialize']);
});

test('successful recovery exits before owner reconciliation or initialization', async () => {
  const order: string[] = [];
  const decision = await runRuntimeStartupBoundary({
    recoveryRequested: true,
    scanPendingExit: true,
    settle: async () => {
      order.push('settle');
      return { status: 'recovered', repairs: ['windows_sandbox_acl'] };
    },
    reconcileOwnerPolicy: async () => {
      order.push('owner-reconcile');
      return true;
    },
    prepareStartup: async () => {
      order.push('prepare');
    },
    initializeRuntime: () => {
      order.push('initialize');
    },
  });

  assert.equal(decision.action, 'exit');
  assert.deepEqual(order, ['settle']);
});

test('a prepared but unaccepted exit can continue normal startup without forced recovery', async () => {
  const decision = await resolveRuntimeExitRecoveryStartup({
    requested: true,
    settle: async () => ({
      status: 'blocked',
      reason: 'stop_not_accepted',
      nextAction: 'keep-open',
      message: 'stop was not accepted',
    }),
  });

  assert.equal(decision.action, 'continue');
});

test('an ambiguous prepared exit blocks startup until management convergence', async () => {
  const settlement = {
    status: 'blocked' as const,
    reason: 'stop_not_accepted' as const,
    nextAction: 'relaunch-space' as const,
    message: 'management reconnect is required',
  };
  const decision = await resolveRuntimeExitRecoveryStartup({
    requested: false,
    scanPending: true,
    settle: async () => settlement,
  });

  assert.deepEqual(decision, { action: 'block', settlement });
});

test('unverified containment blocks owner reconciliation instead of starting a competitor', async () => {
  const settlement = {
    status: 'blocked' as const,
    reason: 'containment_active' as const,
    nextAction: 'restart-system' as const,
    message: 'Job is still active',
  };
  const decision = await resolveRuntimeExitRecoveryStartup({
    requested: true,
    settle: async () => settlement,
  });

  assert.deepEqual(decision, { action: 'block', settlement });
});

test('ordinary startup performs no exit settlement work', async () => {
  let calls = 0;
  const decision = await resolveRuntimeExitRecoveryStartup({
    requested: false,
    settle: async () => {
      calls += 1;
      return { status: 'clean', repairs: [] };
    },
  });

  assert.deepEqual(decision, { action: 'continue' });
  assert.equal(calls, 0);
});

test('ordinary daemon startup resumes a crash ticket but continues after recovery', async () => {
  let calls = 0;
  const decision = await resolveRuntimeExitRecoveryStartup({
    requested: false,
    scanPending: true,
    settle: async () => {
      calls += 1;
      return { status: 'recovered', repairs: ['windows_process_tree'] };
    },
  });

  assert.deepEqual(decision, {
    action: 'continue',
    settlement: { status: 'recovered', repairs: ['windows_process_tree'] },
  });
  assert.equal(calls, 1);
});
