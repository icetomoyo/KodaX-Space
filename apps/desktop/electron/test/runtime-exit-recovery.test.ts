import assert from 'node:assert/strict';
import test from 'node:test';

import {
  handleRuntimeExitRecoveryDialogResponse,
  resolveRuntimeExitRecoveryStartup,
  runtimeExitRecoveryBlockedNotice,
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

test('unverified containment blocks the full startup boundary before starting a competitor', async () => {
  const order: string[] = [];
  const settlement = {
    status: 'blocked' as const,
    reason: 'containment_active' as const,
    nextAction: 'restart-system' as const,
    message: 'Job is still active',
  };
  const decision = await runRuntimeStartupBoundary({
    recoveryRequested: true,
    scanPendingExit: true,
    settle: async () => {
      order.push('settle');
      return settlement;
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

  assert.deepEqual(decision, { action: 'block', settlement });
  assert.deepEqual(order, ['settle']);
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

test('foreign Windows ACL recovery blocks show actionable localized guidance', () => {
  const notice = runtimeExitRecoveryBlockedNotice(
    {
      status: 'blocked',
      reason: 'cleanup_failed',
      nextAction: 'restart-system',
      message: 'Windows sandbox ACL recovery found a foreign or unverifiable owner marker.',
    },
    'zh-CN',
  );

  assert.equal(notice.message, 'Space 未启动新的 Coder Runtime');
  assert.match(notice.detail, /重启 Windows/);
  assert.match(notice.detail, /打开诊断目录/);
  assert.doesNotMatch(notice.detail, /foreign or unverifiable owner marker/i);
});

test('English ACL blocks provide the reachable boot-dialog recovery action', () => {
  const notice = runtimeExitRecoveryBlockedNotice(
    {
      status: 'blocked',
      reason: 'cleanup_failed',
      nextAction: 'restart-system',
      message: 'Windows sandbox ACL recovery found a foreign or unverifiable owner marker.',
    },
    'en',
  );

  assert.match(notice.detail, /Restart Windows/);
  assert.match(notice.detail, /Open diagnostics folder/);
  assert.doesNotMatch(notice.detail, /foreign or unverifiable owner marker/i);
});

test('unverifiable ACL markers request support instead of another ineffective reboot', () => {
  const notice = runtimeExitRecoveryBlockedNotice(
    {
      status: 'blocked',
      reason: 'cleanup_failed',
      nextAction: 'manual-recovery',
      message: 'Windows sandbox ACL cleanup was not confirmed because its marker is unreadable.',
    },
    'zh-CN',
  );

  assert.match(notice.detail, /打开诊断目录/);
  assert.match(notice.detail, /联系支持/);
  assert.doesNotMatch(notice.detail, /重启 Windows/);
});

test('generic blocked notices project bounded actions without raw SDK paths', () => {
  for (const [nextAction, expected] of [
    ['restart-system', /重启 Windows/],
    ['relaunch-space', /重新打开 Space/],
    ['manual-recovery', /联系支持/],
  ] as const) {
    const notice = runtimeExitRecoveryBlockedNotice(
      {
        status: 'blocked',
        reason: 'cleanup_unverified',
        nextAction,
        message: 'Owner state unreadable at C:\\Users\\alice\\.kodax\\runtime\\state.json\u0000',
      },
      'zh-CN',
    );

    assert.match(notice.detail, expected);
    assert.match(notice.detail, /打开诊断目录/);
    assert.doesNotMatch(notice.detail, /alice|state\.json|\u0000/i);
  }
});

test('the boot-dialog diagnostics action opens only on the explicit first button', async () => {
  const calls: string[] = [];
  const action = {
    diagnosticsDirectory: () => 'C:\\safe\\diagnostics',
    ensureDirectory: (directory: string) => calls.push(`ensure:${directory}`),
    openDirectory: async (directory: string) => {
      calls.push(`open:${directory}`);
      return '';
    },
    onOpenError: (error: string) => calls.push(`error:${error}`),
  };

  await assert.doesNotReject(async () => {
    assert.equal(await handleRuntimeExitRecoveryDialogResponse(1, action), 'closed');
    assert.deepEqual(calls, []);
    assert.equal(await handleRuntimeExitRecoveryDialogResponse(0, action), 'opened');
  });
  assert.deepEqual(calls, ['ensure:C:\\safe\\diagnostics', 'open:C:\\safe\\diagnostics']);
});

test('the boot-dialog diagnostics action reports shell open failures', async () => {
  const calls: string[] = [];
  const outcome = await handleRuntimeExitRecoveryDialogResponse(0, {
    diagnosticsDirectory: () => 'C:\\safe\\diagnostics',
    ensureDirectory: () => calls.push('ensure'),
    openDirectory: async () => 'access denied',
    onOpenError: (error) => calls.push(`error:${error}`),
  });

  assert.equal(outcome, 'failed');
  assert.deepEqual(calls, ['ensure', 'error:access denied']);
});

test('the boot-dialog diagnostics action contains directory preparation failures', async () => {
  const calls: string[] = [];
  const outcome = await handleRuntimeExitRecoveryDialogResponse(0, {
    diagnosticsDirectory: () => 'C:\\safe\\diagnostics',
    ensureDirectory: () => {
      throw new Error('directory unavailable');
    },
    openDirectory: async () => {
      calls.push('open');
      return '';
    },
    onOpenError: (error) => calls.push(`error:${error}`),
  });

  assert.equal(outcome, 'failed');
  assert.deepEqual(calls, ['error:directory unavailable']);
});
