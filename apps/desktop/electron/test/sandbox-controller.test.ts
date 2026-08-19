import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  SandboxController,
  type SandboxDoctorResult,
  type SandboxSdkFacade,
} from '../kodax/sandbox-controller.js';

const capability = {
  version: 4 as const,
  asrtVersion: '0.0.65',
  platform: 'win32' as const,
  backend: 'windows-restricted-user' as const,
  genericCommandExecution: true as const,
  controls: ['filesystem', 'network', 'environment', 'timeout', 'output'] as const,
  ordinaryCallsTriggerSetup: false as const,
  setupMayElevate: true,
  unavailableBehavior: 'structured-no-execution' as const,
  permissionFallback: 'normal-permission-policy' as const,
};

function doctor(input: Partial<SandboxDoctorResult> = {}): SandboxDoctorResult {
  return {
    ready: true,
    platform: 'win32',
    version: '0.0.65',
    diagnostics: [],
    setupRequired: false,
    ...input,
  };
}

function fakeSdk(overrides: Partial<SandboxSdkFacade> = {}): SandboxSdkFacade {
  return {
    getKodaXSandboxCapability: () => capability,
    doctorKodaXSandbox: async () => doctor(),
    getKodaXSandboxSetupGuidance: () => ['KodaX sandbox is active.'],
    activateKodaXSandbox: async () => ({
      status: 'ready',
      attempted: false,
      doctor: doctor(),
      guidance: ['KodaX sandbox is active.'],
    }),
    ...overrides,
  };
}

test('status projects doctor-confirmed readiness and caches ordinary reads', async () => {
  const refreshFlags: boolean[] = [];
  const sdk = fakeSdk({
    doctorKodaXSandbox: async ({ refresh } = {}) => {
      refreshFlags.push(refresh === true);
      return doctor();
    },
  });
  const projected: SandboxDoctorResult[] = [];
  const controller = new SandboxController({
    loadSdk: async () => sdk,
    onDoctor: (_capability, result) => projected.push(result),
    now: () => new Date('2026-07-31T08:00:00.000Z'),
  });

  const first = await controller.status();
  const second = await controller.status();

  assert.equal(first.readiness, 'ready');
  assert.equal(first.backend, 'windows-restricted-user');
  assert.equal(first.asrtVersion, '0.0.65');
  assert.deepEqual(first.setup, {
    canSetup: false,
    mayElevate: true,
    requiresElevation: false,
  });
  assert.equal(first.revision, second.revision);
  assert.deepEqual(refreshFlags, [false]);
  assert.equal(projected.length, 1);
});

test('status and refresh never invoke sandbox activation', async () => {
  let activationCount = 0;
  const controller = new SandboxController({
    loadSdk: async () =>
      fakeSdk({
        activateKodaXSandbox: async () => {
          activationCount += 1;
          return {
            status: 'ready',
            attempted: false,
            doctor: doctor(),
            guidance: [],
          };
        },
      }),
    now: () => new Date('2026-07-31T08:00:00.000Z'),
  });

  await controller.status();
  await controller.refresh();
  await controller.status();

  assert.equal(activationCount, 0);
});

test('refresh re-runs doctor and exposes setup-required without leaking raw paths', async () => {
  let calls = 0;
  const sdk = fakeSdk({
    doctorKodaXSandbox: async () => {
      calls += 1;
      return calls === 1
        ? doctor()
        : doctor({
            ready: false,
            setupRequired: true,
            diagnostics: [
              'ENOENT helper C:\\Users\\alice\\AppData\\secret-helper.exe',
              'Windows sandbox account is not fully provisioned.',
            ],
          });
    },
    getKodaXSandboxSetupGuidance: () => [
      'Run "kodax sandbox setup". Windows will show a UAC prompt.',
      'Inspect \\\\corp\\private\\secret.txt, ~/.ssh/id_ed25519, and %USERPROFILE%\\token.txt.',
      'Inspect file:///Users/alice/private.txt and $HOME/.config/secret.',
    ],
  });
  const controller = new SandboxController({
    loadSdk: async () => sdk,
    now: () => new Date('2026-07-31T08:00:00.000Z'),
  });

  await controller.status();
  const refreshed = await controller.refresh();

  assert.equal(refreshed.readiness, 'setup-required');
  assert.equal(refreshed.setup.canSetup, true);
  assert.equal(refreshed.setup.requiresElevation, true);
  assert.equal(refreshed.diagnosticCount, 2);
  assert.ok(refreshed.diagnostics.includes('A required sandbox dependency is unavailable.'));
  assert.ok(refreshed.diagnostics.includes('Windows sandbox account is not fully provisioned.'));
  assert.equal(JSON.stringify(refreshed).includes('alice'), false);
  assert.equal(JSON.stringify(refreshed).includes('secret-helper'), false);
  assert.equal(JSON.stringify(refreshed).includes('corp'), false);
  assert.equal(JSON.stringify(refreshed).includes('id_ed25519'), false);
  assert.equal(JSON.stringify(refreshed).includes('USERPROFILE'), false);
  assert.equal(JSON.stringify(refreshed).includes('private.txt'), false);
  assert.equal(JSON.stringify(refreshed).includes('$HOME'), false);
  assert.equal(refreshed.lastOperation?.outcome, 'setup-required');
});

test('Windows ACL recovery blocks expose v4 recovery guidance instead of Setup', async () => {
  const recoveryDiagnostic =
    '[acl_cleanup_unconfirmed] An unconfirmed Windows sandbox process tree from the same Windows boot may still have live descendants; restart Windows before retrying. ' +
    'After stopping every KodaX and KodaX Space process, run "C:\\Users\\alice\\AppData\\Local\\Temp\\kodax-srt\\srt-win.exe" acl recover --force --json, then delete "C:\\ProgramData\\KodaX\\sandbox-runtime\\acl-poison".';
  const blocked = doctor({
    ready: false,
    setupRequired: false,
    diagnostics: [recoveryDiagnostic],
  });
  const controller = new SandboxController({
    loadSdk: async () =>
      fakeSdk({
        doctorKodaXSandbox: async () => blocked,
        getKodaXSandboxSetupGuidance: () => [
          recoveryDiagnostic.slice('[acl_cleanup_unconfirmed]'.length).trim(),
        ],
      }),
    now: () => new Date('2026-08-14T08:00:00.000Z'),
  });

  const status = await controller.status();

  assert.equal(status.readiness, 'unavailable');
  assert.equal(status.setup.canSetup, false);
  assert.deepEqual(status.diagnostics, ['Windows sandbox ACL cleanup is unconfirmed.']);
  assert.ok(status.guidance.some((line) => /restart Windows/i.test(line)));
  assert.ok(status.guidance.some((line) => /kodax sandbox doctor/i.test(line)));
  assert.equal(
    status.guidance.some((line) => /explicit Setup/i.test(line)),
    false,
  );
  assert.equal(JSON.stringify(status).includes('alice'), false);
  assert.equal(JSON.stringify(status).includes('AppData'), false);
  assert.equal(JSON.stringify(status).includes('ProgramData'), false);
});

test('foreign Windows ACL owner diagnostics use recovery guidance instead of Setup', async () => {
  const recoveryDiagnostic =
    'Windows sandbox ACL recovery found a foreign or unverifiable owner marker.';
  const blocked = doctor({
    ready: false,
    setupRequired: false,
    diagnostics: [recoveryDiagnostic],
  });
  const controller = new SandboxController({
    loadSdk: async () =>
      fakeSdk({
        doctorKodaXSandbox: async () => blocked,
        getKodaXSandboxSetupGuidance: () => [recoveryDiagnostic],
      }),
    now: () => new Date('2026-08-19T08:00:00.000Z'),
  });

  const status = await controller.status();

  assert.equal(status.readiness, 'unavailable');
  assert.equal(status.setup.canSetup, false);
  assert.deepEqual(status.diagnostics, ['Windows sandbox ACL cleanup is unconfirmed.']);
  assert.ok(status.guidance.some((line) => /restart Windows/i.test(line)));
  assert.equal(JSON.stringify(status).includes('foreign or unverifiable'), false);
});

test('confirmed Windows setup activates once and verifies a fresh ready doctor result', async () => {
  let ready = false;
  let activationCount = 0;
  const sdk = fakeSdk({
    doctorKodaXSandbox: async () =>
      ready
        ? doctor()
        : doctor({
            ready: false,
            setupRequired: true,
            diagnostics: ['Windows sandbox account is not fully provisioned.'],
          }),
    getKodaXSandboxSetupGuidance: (result) =>
      result.ready ? ['KodaX sandbox is active.'] : ['Approve the one-time UAC prompt.'],
    activateKodaXSandbox: async (options) => {
      activationCount += 1;
      assert.deepEqual(options, { allowElevation: true });
      ready = true;
      return {
        status: 'ready',
        attempted: true,
        doctor: doctor(),
        guidance: ['KodaX sandbox is active.'],
      };
    },
  });
  const controller = new SandboxController({
    loadSdk: async () => sdk,
    now: () => new Date('2026-07-31T08:00:00.000Z'),
  });

  const initial = await controller.status();
  const result = await controller.setup({
    expectedRevision: initial.revision,
    confirmation: 'allow-sandbox-setup',
  });

  assert.equal(activationCount, 1);
  assert.equal(result.readiness, 'ready');
  assert.equal(result.setup.canSetup, false);
  assert.deepEqual(result.lastOperation, {
    kind: 'setup',
    outcome: 'ready',
    attempted: true,
  });
});

test('setup cancellation remains visible and retryable', async () => {
  const setupRequired = doctor({
    ready: false,
    setupRequired: true,
    diagnostics: ['Windows sandbox account is not fully provisioned.'],
  });
  const sdk = fakeSdk({
    doctorKodaXSandbox: async () => setupRequired,
    getKodaXSandboxSetupGuidance: () => ['Approve the one-time UAC prompt.'],
    activateKodaXSandbox: async () => ({
      status: 'cancelled',
      attempted: true,
      doctor: setupRequired,
      guidance: ['Approve the one-time UAC prompt.'],
      error: 'Sandbox setup was cancelled.',
    }),
  });
  const controller = new SandboxController({
    loadSdk: async () => sdk,
    now: () => new Date('2026-07-31T08:00:00.000Z'),
  });

  const initial = await controller.status();
  const result = await controller.setup({
    expectedRevision: initial.revision,
    confirmation: 'allow-sandbox-setup',
  });

  assert.equal(result.readiness, 'setup-required');
  assert.equal(result.setup.canSetup, true);
  assert.deepEqual(result.lastOperation, {
    kind: 'setup',
    outcome: 'cancelled',
    attempted: true,
    message: 'Sandbox setup was cancelled.',
  });
});

test('fresh doctor readiness is authoritative when activation reports unavailable or cancelled', async () => {
  for (const activationStatus of ['unavailable', 'cancelled'] as const) {
    let doctorCalls = 0;
    const setupRequired = doctor({
      ready: false,
      setupRequired: true,
      diagnostics: ['Windows sandbox account is not fully provisioned.'],
    });
    const controller = new SandboxController({
      loadSdk: async () =>
        fakeSdk({
          doctorKodaXSandbox: async () => {
            doctorCalls += 1;
            return doctorCalls < 3 ? setupRequired : doctor();
          },
          getKodaXSandboxSetupGuidance: () => ['Approve the one-time UAC prompt.'],
          activateKodaXSandbox: async () => ({
            status: activationStatus,
            attempted: true,
            doctor: setupRequired,
            guidance: [],
          }),
        }),
      now: () => new Date('2026-07-31T08:00:00.000Z'),
    });

    const initial = await controller.status();
    const result = await controller.setup({
      expectedRevision: initial.revision,
      confirmation: 'allow-sandbox-setup',
    });

    assert.equal(result.readiness, 'ready');
    assert.equal(result.lastOperation?.outcome, 'ready');
    assert.equal(result.lastOperation?.attempted, true);
  }
});

test('fresh doctor readiness is authoritative when activation throws or is malformed', async () => {
  for (const activationResult of ['throw', 'malformed'] as const) {
    let doctorCalls = 0;
    const setupRequired = doctor({
      ready: false,
      setupRequired: true,
      diagnostics: ['Windows sandbox account is not fully provisioned.'],
    });
    const controller = new SandboxController({
      loadSdk: async () =>
        fakeSdk({
          doctorKodaXSandbox: async () => {
            doctorCalls += 1;
            return doctorCalls < 3 ? setupRequired : doctor();
          },
          getKodaXSandboxSetupGuidance: () => ['Approve the one-time UAC prompt.'],
          activateKodaXSandbox: async () => {
            if (activationResult === 'throw') {
              throw new Error('C:\\Users\\alice\\private\\activation.log');
            }
            return {
              status: 'unexpected',
              attempted: true,
            };
          },
        }),
      now: () => new Date('2026-07-31T08:00:00.000Z'),
    });

    const initial = await controller.status();
    const result = await controller.setup({
      expectedRevision: initial.revision,
      confirmation: 'allow-sandbox-setup',
    });

    assert.equal(result.readiness, 'ready');
    assert.equal(result.lastOperation?.outcome, 'ready');
    assert.equal(result.lastOperation?.attempted, true);
    assert.equal(JSON.stringify(result).includes('alice'), false);
  }
});

test('non-Windows setup stays guidance-only and never invokes activation', async () => {
  let activationCount = 0;
  const linuxCapability = {
    ...capability,
    platform: 'linux' as const,
    backend: 'linux-bubblewrap' as const,
    setupMayElevate: false,
  };
  const sdk = fakeSdk({
    getKodaXSandboxCapability: () => linuxCapability,
    doctorKodaXSandbox: async () =>
      doctor({
        ready: false,
        platform: 'linux',
        setupRequired: true,
        diagnostics: ['bubblewrap is missing at /usr/bin/bwrap'],
      }),
    getKodaXSandboxSetupGuidance: () => [
      'Debian/Ubuntu: sudo apt install bubblewrap socat ripgrep',
    ],
    activateKodaXSandbox: async () => {
      activationCount += 1;
      throw new Error('must not run');
    },
  });
  const controller = new SandboxController({
    loadSdk: async () => sdk,
    now: () => new Date('2026-07-31T08:00:00.000Z'),
  });

  const initial = await controller.status();
  assert.equal(initial.setup.canSetup, false);
  await assert.rejects(
    controller.setup({
      expectedRevision: initial.revision,
      confirmation: 'allow-sandbox-setup',
    }),
    /not available/i,
  );
  assert.equal(activationCount, 0);
});

test('serialized setup rejects duplicate stale clicks before a second activation', async () => {
  let ready = false;
  let activationCount = 0;
  const sdk = fakeSdk({
    doctorKodaXSandbox: async () =>
      ready
        ? doctor()
        : doctor({
            ready: false,
            setupRequired: true,
            diagnostics: ['Windows sandbox account is not fully provisioned.'],
          }),
    getKodaXSandboxSetupGuidance: () => ['Approve the one-time UAC prompt.'],
    activateKodaXSandbox: async () => {
      activationCount += 1;
      ready = true;
      return {
        status: 'ready',
        attempted: true,
        doctor: doctor(),
        guidance: ['KodaX sandbox is active.'],
      };
    },
  });
  const controller = new SandboxController({
    loadSdk: async () => sdk,
    now: () => new Date('2026-07-31T08:00:00.000Z'),
  });
  const initial = await controller.status();
  const input = {
    expectedRevision: initial.revision,
    confirmation: 'allow-sandbox-setup' as const,
  };

  const results = await Promise.allSettled([controller.setup(input), controller.setup(input)]);

  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(results.filter((result) => result.status === 'rejected').length, 1);
  assert.equal(activationCount, 1);
});

test('doctor failures degrade to bounded unavailable state without leaking thrown details', async () => {
  const projected: SandboxDoctorResult[] = [];
  const controller = new SandboxController({
    loadSdk: async () =>
      fakeSdk({
        doctorKodaXSandbox: async () => {
          throw new Error('C:\\Users\\alice\\private\\helper.exe token=secret');
        },
      }),
    onDoctor: (_capability, result) => projected.push(result),
    now: () => new Date('2026-07-31T08:00:00.000Z'),
  });

  const status = await controller.refresh();

  assert.equal(status.readiness, 'unavailable');
  assert.equal(status.lastOperation?.outcome, 'unavailable');
  assert.equal(JSON.stringify(status).includes('alice'), false);
  assert.equal(JSON.stringify(status).includes('secret'), false);
  assert.equal(projected.at(-1)?.ready, false);
});

test('SDK load and capability failures expose only fixed controller errors and remain retryable', async () => {
  let loadCalls = 0;
  const loadFailure = new SandboxController({
    loadSdk: async () => {
      loadCalls += 1;
      throw new Error('C:\\Users\\alice\\private\\sdk.js token=secret');
    },
  });

  await assert.rejects(loadFailure.status(), (error: unknown) => {
    assert.equal(error instanceof Error ? error.message : '', 'Sandbox SDK is unavailable.');
    return true;
  });
  await assert.rejects(loadFailure.refresh(), /Sandbox SDK is unavailable/);
  assert.equal(loadCalls, 2);

  const capabilityFailure = new SandboxController({
    loadSdk: async () =>
      fakeSdk({
        getKodaXSandboxCapability: () => {
          throw new Error('\\\\corp\\private\\capability.json');
        },
      }),
  });
  await assert.rejects(capabilityFailure.status(), (error: unknown) => {
    assert.equal(error instanceof Error ? error.message : '', 'Sandbox capability is unavailable.');
    return true;
  });
});

test('malformed doctor arrays degrade without processing or exposing their values', async () => {
  const controller = new SandboxController({
    loadSdk: async () =>
      fakeSdk({
        doctorKodaXSandbox: async () => ({
          ready: false,
          platform: 'win32',
          version: '0.0.65',
          diagnostics: ['safe', { path: '\\\\corp\\private\\secret.txt' }],
          setupRequired: true,
        }),
      }),
    now: () => new Date('2026-07-31T08:00:00.000Z'),
  });

  const status = await controller.refresh();

  assert.equal(status.readiness, 'unavailable');
  assert.equal(JSON.stringify(status).includes('corp'), false);
  assert.equal(JSON.stringify(status).includes('secret'), false);
});

test('oversized SDK strings are bounded before normalization', async () => {
  const oversizedSecret = `C:\\Users\\alice\\private\\${'x'.repeat(2_000_000)}`;
  const controller = new SandboxController({
    loadSdk: async () =>
      fakeSdk({
        doctorKodaXSandbox: async () =>
          doctor({
            ready: false,
            setupRequired: false,
            diagnostics: [oversizedSecret],
          }),
        getKodaXSandboxSetupGuidance: () => [oversizedSecret],
      }),
    now: () => new Date('2026-07-31T08:00:00.000Z'),
  });

  const status = await controller.refresh();

  assert.ok(status.diagnostics.every((line) => line.length <= 320));
  assert.ok(status.guidance.every((line) => line.length <= 320));
  assert.equal(JSON.stringify(status).includes('alice'), false);
  assert.equal(JSON.stringify(status).length < 4_000, true);
});

test('incompatible doctor metadata is unavailable in both detailed and capability projections', async () => {
  const projected: SandboxDoctorResult[] = [];
  const controller = new SandboxController({
    loadSdk: async () =>
      fakeSdk({
        doctorKodaXSandbox: async () =>
          doctor({
            ready: true,
            platform: 'linux',
            version: '9.9.9',
          }),
      }),
    onDoctor: (_capability, result) => projected.push(result),
    now: () => new Date('2026-07-31T08:00:00.000Z'),
  });

  const status = await controller.status();

  assert.equal(status.readiness, 'unavailable');
  assert.equal(projected.at(-1)?.ready, false);
  assert.equal(projected.at(-1)?.setupRequired, false);
});
