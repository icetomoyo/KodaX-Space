import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CoderRuntimeModeSwitchCoordinator,
  runWithCoderAdmission,
  switchCoderRuntimeModeAndRestart,
} from '../kodax/coder-runtime-mode-switch.js';
import { createCoderOwnerRecoveryRestartError } from '../kodax/coder-owner-recovery-error.js';

test('Coder admission helper always releases successful and failed operations', async () => {
  let active = 0;
  const options = {
    beginCoderAdmission: () => {
      active += 1;
      return () => {
        active -= 1;
      };
    },
  };

  assert.equal(await runWithCoderAdmission(options, async () => 'ok'), 'ok');
  assert.equal(active, 0);
  await assert.rejects(
    runWithCoderAdmission(options, async () => {
      throw new Error('operation failed');
    }),
    /operation failed/,
  );
  assert.equal(active, 0);
});

test('daemon to embedded prepares the inline owner before persisting and restarting', async () => {
  const calls: string[] = [];
  const result = await switchCoderRuntimeModeAndRestart({
    target: 'embedded',
    currentHost: 'runtime',
    hasActiveSpaceRun: () => false,
    prepareEmbeddedRestart: async () => {
      calls.push('prepare-embedded');
    },
    prepareDaemonRestart: async () => {
      calls.push('prepare-daemon');
    },
    restoreDaemonOwner: async () => {
      calls.push('restore-daemon');
    },
    persist: async (mode) => {
      calls.push(`persist-${mode}`);
      return { coderRuntimeMode: mode };
    },
    scheduleRestart: () => {
      calls.push('restart');
    },
  });

  assert.deepEqual(calls, ['prepare-embedded', 'persist-embedded', 'restart']);
  assert.deepEqual(result, {
    settings: { coderRuntimeMode: 'embedded' },
    restarting: true,
  });
});

test('embedded to daemon persists first, enables daemon policy, then restarts', async () => {
  const calls: string[] = [];
  const result = await switchCoderRuntimeModeAndRestart({
    target: 'daemon',
    currentHost: 'legacy',
    hasActiveSpaceRun: () => false,
    prepareEmbeddedRestart: async () => {
      calls.push('prepare-embedded');
    },
    prepareDaemonRestart: async () => {
      calls.push('prepare-daemon');
    },
    restoreDaemonOwner: async () => {
      calls.push('restore-daemon');
    },
    persist: async (mode) => {
      calls.push(`persist-${mode}`);
      return { coderRuntimeMode: mode };
    },
    scheduleRestart: () => {
      calls.push('restart');
    },
  });

  assert.deepEqual(calls, ['persist-daemon', 'prepare-daemon', 'restart']);
  assert.equal(result.restarting, true);
});

test('active Space work blocks a mode switch before owner or settings mutations', async () => {
  const calls: string[] = [];
  await assert.rejects(
    switchCoderRuntimeModeAndRestart({
      target: 'embedded',
      currentHost: 'runtime',
      hasActiveSpaceRun: () => true,
      prepareEmbeddedRestart: async () => {
        calls.push('prepare-embedded');
      },
      prepareDaemonRestart: async () => {
        calls.push('prepare-daemon');
      },
      restoreDaemonOwner: async () => {
        calls.push('restore-daemon');
      },
      persist: async (mode) => {
        calls.push(`persist-${mode}`);
        return { coderRuntimeMode: mode };
      },
      scheduleRestart: () => {
        calls.push('restart');
      },
    }),
    /no Space task is running/,
  );
  assert.equal(calls.length, 0);
});

test('daemon owner is restored when embedded preference persistence fails', async () => {
  const calls: string[] = [];
  await assert.rejects(
    switchCoderRuntimeModeAndRestart({
      target: 'embedded',
      currentHost: 'runtime',
      hasActiveSpaceRun: () => false,
      prepareEmbeddedRestart: async () => {
        calls.push('prepare-embedded');
      },
      prepareDaemonRestart: async () => undefined,
      restoreDaemonOwner: async () => {
        calls.push('restore-daemon');
      },
      persist: async () => {
        calls.push('persist-embedded');
        throw new Error('settings write failed');
      },
      scheduleRestart: () => {
        calls.push('restart');
      },
    }),
    /Daemon mode was restored and Space is restarting/,
  );
  assert.deepEqual(calls, ['prepare-embedded', 'persist-embedded', 'restore-daemon', 'restart']);
});

test('embedded preference is restored when daemon policy enable fails', async () => {
  const calls: string[] = [];
  await assert.rejects(
    switchCoderRuntimeModeAndRestart({
      target: 'daemon',
      currentHost: 'legacy',
      hasActiveSpaceRun: () => false,
      prepareEmbeddedRestart: async () => undefined,
      prepareDaemonRestart: async () => {
        calls.push('prepare-daemon');
        throw new Error('daemon enable failed');
      },
      restoreDaemonOwner: async () => undefined,
      persist: async (mode) => {
        calls.push(`persist-${mode}`);
        return { coderRuntimeMode: mode };
      },
      scheduleRestart: () => {
        calls.push('restart');
      },
    }),
    /daemon enable failed/,
  );
  assert.deepEqual(calls, ['persist-daemon', 'prepare-daemon', 'persist-embedded']);
});

test('double owner recovery failure schedules a restart and keeps Coder admissions closed', async () => {
  const calls: string[] = [];
  const coordinator = new CoderRuntimeModeSwitchCoordinator({
    currentHost: () => 'legacy',
    hasActiveSpaceRun: () => false,
    prepareEmbeddedRestart: async () => undefined,
    prepareDaemonRestart: async () => {
      calls.push('prepare-daemon');
      throw createCoderOwnerRecoveryRestartError(
        [new Error('daemon enable failed'), new Error('inline reacquire failed')],
        'owner recovery failed',
      );
    },
    restoreDaemonOwner: async () => undefined,
    persist: async (mode) => {
      calls.push(`persist-${mode}`);
      return { coderRuntimeMode: mode };
    },
    scheduleRestart: () => {
      calls.push('restart');
    },
  });

  await assert.rejects(coordinator.switchMode('daemon'), /owner recovery failed/);
  await assert.rejects(
    coordinator.runCoderAdmission(async () => undefined),
    /Space is restarting/,
  );
  assert.deepEqual(calls, ['persist-daemon', 'prepare-daemon', 'persist-embedded', 'restart']);
});

test('double owner recovery failure still schedules a restart when preference compensation fails', async () => {
  const calls: string[] = [];
  const coordinator = new CoderRuntimeModeSwitchCoordinator({
    currentHost: () => 'legacy',
    hasActiveSpaceRun: () => false,
    prepareEmbeddedRestart: async () => undefined,
    prepareDaemonRestart: async () => {
      calls.push('prepare-daemon');
      throw createCoderOwnerRecoveryRestartError(
        [new Error('daemon enable failed'), new Error('inline reacquire failed')],
        'owner recovery failed',
      );
    },
    restoreDaemonOwner: async () => undefined,
    persist: async (mode) => {
      calls.push(`persist-${mode}`);
      if (mode === 'embedded') throw new Error('embedded compensation failed');
      return { coderRuntimeMode: mode };
    },
    scheduleRestart: () => {
      calls.push('restart');
    },
  });

  await assert.rejects(
    coordinator.switchMode('daemon'),
    /could not enable daemon mode or restore the embedded preference.*recovery restart/i,
  );
  await assert.rejects(
    coordinator.runCoderAdmission(async () => undefined),
    /Space is restarting/,
  );
  assert.deepEqual(calls, ['persist-daemon', 'prepare-daemon', 'persist-embedded', 'restart']);
});

test('ordinary daemon preparation plus preference compensation failure also closes admission', async () => {
  const calls: string[] = [];
  const coordinator = new CoderRuntimeModeSwitchCoordinator({
    currentHost: () => 'legacy',
    hasActiveSpaceRun: async () => false,
    prepareEmbeddedRestart: async () => undefined,
    prepareDaemonRestart: async () => {
      calls.push('prepare-daemon');
      throw new Error('daemon enable failed');
    },
    restoreDaemonOwner: async () => undefined,
    persist: async (mode) => {
      calls.push(`persist-${mode}`);
      if (mode === 'embedded') throw new Error('embedded compensation failed');
      return { coderRuntimeMode: mode };
    },
    scheduleRestart: () => {
      calls.push('restart');
    },
  });

  await assert.rejects(coordinator.switchMode('daemon'), /recovery restart is in progress/i);
  await assert.rejects(
    coordinator.runCoderAdmission(async () => undefined),
    /Space is restarting/,
  );
  assert.deepEqual(calls, ['persist-daemon', 'prepare-daemon', 'persist-embedded', 'restart']);
});

test('failed daemon restoration after embedded persistence failure schedules recovery restart', async () => {
  const calls: string[] = [];
  const coordinator = new CoderRuntimeModeSwitchCoordinator({
    currentHost: () => 'runtime',
    hasActiveSpaceRun: () => false,
    prepareEmbeddedRestart: async () => {
      calls.push('prepare-embedded');
    },
    prepareDaemonRestart: async () => undefined,
    restoreDaemonOwner: async () => {
      calls.push('restore-daemon');
      throw createCoderOwnerRecoveryRestartError(
        [new Error('daemon restore failed'), new Error('inline reacquire failed')],
        'daemon owner recovery failed',
      );
    },
    persist: async () => {
      calls.push('persist-embedded');
      throw new Error('settings write failed');
    },
    scheduleRestart: () => {
      calls.push('restart');
    },
  });

  await assert.rejects(
    coordinator.switchMode('embedded'),
    /could not save embedded mode or restore daemon ownership.*recovery restart/i,
  );
  await assert.rejects(
    coordinator.runCoderAdmission(async () => undefined),
    /Space is restarting/,
  );
  assert.deepEqual(calls, ['prepare-embedded', 'persist-embedded', 'restore-daemon', 'restart']);
});

test('embedded preparation recovery failure schedules restart before preference persistence', async () => {
  const calls: string[] = [];
  const coordinator = new CoderRuntimeModeSwitchCoordinator({
    currentHost: () => 'runtime',
    hasActiveSpaceRun: () => false,
    prepareEmbeddedRestart: async () => {
      calls.push('prepare-embedded');
      throw createCoderOwnerRecoveryRestartError(
        [new Error('inline acquisition failed'), new Error('daemon restore failed')],
        'inline rollback recovery failed',
      );
    },
    prepareDaemonRestart: async () => undefined,
    restoreDaemonOwner: async () => undefined,
    persist: async (mode) => {
      calls.push(`persist-${mode}`);
      return { coderRuntimeMode: mode };
    },
    scheduleRestart: () => {
      calls.push('restart');
    },
  });

  await assert.rejects(coordinator.switchMode('embedded'), /inline rollback recovery failed/);
  await assert.rejects(
    coordinator.runCoderAdmission(async () => undefined),
    /Space is restarting/,
  );
  assert.deepEqual(calls, ['prepare-embedded', 'restart']);
});

test('mode switching drains admitted Coder work and rechecks active runs under the closed gate', async () => {
  const calls: string[] = [];
  let activeRun = false;
  let releaseAdmission!: () => void;
  const admissionBlock = new Promise<void>((resolve) => {
    releaseAdmission = resolve;
  });
  let admissionEntered!: () => void;
  const entered = new Promise<void>((resolve) => {
    admissionEntered = resolve;
  });
  const coordinator = new CoderRuntimeModeSwitchCoordinator({
    currentHost: () => 'runtime',
    hasActiveSpaceRun: () => activeRun,
    prepareEmbeddedRestart: async () => {
      calls.push('prepare-embedded');
    },
    prepareDaemonRestart: async () => {
      calls.push('prepare-daemon');
    },
    restoreDaemonOwner: async () => {
      calls.push('restore-daemon');
    },
    persist: async (mode) => {
      calls.push(`persist-${mode}`);
      return { coderRuntimeMode: mode };
    },
    scheduleRestart: () => {
      calls.push('restart');
    },
  });

  const admitted = coordinator.runCoderAdmission(async () => {
    admissionEntered();
    await admissionBlock;
    activeRun = true;
  });
  await entered;

  const switching = coordinator.switchMode('embedded');
  await assert.rejects(
    coordinator.runCoderAdmission(async () => undefined),
    /mode is switching/,
  );
  assert.equal(calls.length, 0);

  releaseAdmission();
  await admitted;
  await assert.rejects(switching, /no Space task is running/);
  assert.equal(calls.length, 0);

  activeRun = false;
  await coordinator.runCoderAdmission(async () => {
    calls.push('admitted-after-failed-switch');
  });
  assert.deepEqual(calls, ['admitted-after-failed-switch']);
});

test('a scheduled restart rejects reverse switches and new Coder admissions', async () => {
  const calls: string[] = [];
  const coordinator = new CoderRuntimeModeSwitchCoordinator({
    currentHost: () => 'runtime',
    hasActiveSpaceRun: () => false,
    prepareEmbeddedRestart: async () => {
      calls.push('prepare-embedded');
    },
    prepareDaemonRestart: async () => {
      calls.push('prepare-daemon');
    },
    restoreDaemonOwner: async () => {
      calls.push('restore-daemon');
    },
    persist: async (mode) => {
      calls.push(`persist-${mode}`);
      return { coderRuntimeMode: mode };
    },
    scheduleRestart: () => {
      calls.push('restart');
    },
  });

  const result = await coordinator.switchMode('embedded');
  assert.equal(result.restarting, true);
  await assert.rejects(coordinator.switchMode('daemon'), /already in progress/);
  await assert.rejects(
    coordinator.runCoderAdmission(async () => undefined),
    /Space is restarting/,
  );
  assert.deepEqual(calls, ['prepare-embedded', 'persist-embedded', 'restart']);
});

test('recovery restart keeps the admission gate closed after embedded persistence fails', async () => {
  const calls: string[] = [];
  const coordinator = new CoderRuntimeModeSwitchCoordinator({
    currentHost: () => 'runtime',
    hasActiveSpaceRun: () => false,
    prepareEmbeddedRestart: async () => {
      calls.push('prepare-embedded');
    },
    prepareDaemonRestart: async () => undefined,
    restoreDaemonOwner: async () => {
      calls.push('restore-daemon');
    },
    persist: async () => {
      calls.push('persist-embedded');
      throw new Error('settings write failed');
    },
    scheduleRestart: () => {
      calls.push('restart');
    },
  });

  await assert.rejects(
    coordinator.switchMode('embedded'),
    /Daemon mode was restored and Space is restarting/,
  );
  await assert.rejects(
    coordinator.runCoderAdmission(async () => undefined),
    /Space is restarting/,
  );
  assert.deepEqual(calls, ['prepare-embedded', 'persist-embedded', 'restore-daemon', 'restart']);
});

test('application shutdown closes admission, drains admitted work, and can reopen after cancellation', async () => {
  let releaseAdmission!: () => void;
  const admissionBlock = new Promise<void>((resolve) => {
    releaseAdmission = resolve;
  });
  let admissionEntered!: () => void;
  const entered = new Promise<void>((resolve) => {
    admissionEntered = resolve;
  });
  const coordinator = new CoderRuntimeModeSwitchCoordinator({
    currentHost: () => 'runtime',
    hasActiveSpaceRun: () => false,
    prepareEmbeddedRestart: async () => undefined,
    prepareDaemonRestart: async () => undefined,
    restoreDaemonOwner: async () => undefined,
    persist: async (mode) => ({ coderRuntimeMode: mode }),
    scheduleRestart: () => undefined,
  });

  const admitted = coordinator.runCoderAdmission(async () => {
    admissionEntered();
    await admissionBlock;
  });
  await entered;

  const shuttingDown = coordinator.beginShutdown();
  await assert.rejects(
    coordinator.runCoderAdmission(async () => undefined),
    /shutting down|restarting/i,
  );

  releaseAdmission();
  await admitted;
  const reopen = await shuttingDown;
  await assert.rejects(
    coordinator.runCoderAdmission(async () => undefined),
    /shutting down|restarting/i,
  );

  reopen();
  reopen();
  await coordinator.runCoderAdmission(async () => undefined);
});

test('application shutdown times out a stuck admission and atomically reopens the gate', async () => {
  const coordinator = new CoderRuntimeModeSwitchCoordinator({
    currentHost: () => 'runtime',
    hasActiveSpaceRun: () => false,
    prepareEmbeddedRestart: async () => undefined,
    prepareDaemonRestart: async () => undefined,
    restoreDaemonOwner: async () => undefined,
    persist: async (mode) => ({ coderRuntimeMode: mode }),
    scheduleRestart: () => undefined,
  });
  const releaseStuckAdmission = coordinator.beginCoderAdmission();

  await assert.rejects(
    coordinator.beginShutdown({ drainTimeoutMs: 10 }),
    /did not finish within 10 ms.*remain open/i,
  );
  const releaseAfterTimeout = coordinator.beginCoderAdmission();
  releaseAfterTimeout();
  releaseStuckAdmission();
});
