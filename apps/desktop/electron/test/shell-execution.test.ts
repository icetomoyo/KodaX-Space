import assert from 'node:assert/strict';
import test, { afterEach, mock } from 'node:test';

import { normalizeShellExecutionContract } from '@kodax-ai/kodax/coding';

import {
  buildKodaXShellExecutionContract,
  resetShellExecutionCanaryForTesting,
  resolveKodaXShellExecutionContract,
} from '../kodax/shell-execution.js';

afterEach(() => {
  resetShellExecutionCanaryForTesting();
});

function existing(...paths: string[]): (candidate: string) => boolean {
  const normalized = new Set(paths.map((entry) => entry.toLowerCase()));
  return (candidate) => normalized.has(candidate.toLowerCase());
}

test('Windows auto builds a validated PowerShell profile contract', () => {
  const powershell = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';
  const contract = buildKodaXShellExecutionContract('auto', {
    platform: 'win32',
    env: {
      PATH: 'C:\\Windows\\System32',
      SystemRoot: 'C:\\Windows',
    },
    exists: existing(powershell),
  });

  assert.ok(contract);
  assert.deepEqual(normalizeShellExecutionContract(contract), contract);
  assert.equal(contract.shell.kind, 'powershell');
  assert.equal(contract.shell.executable, powershell);
  assert.deepEqual(contract.shell.args, ['-NoLogo', '-ExecutionPolicy', 'Bypass']);
  assert.equal(contract.shell.profile, 'default');
  assert.equal(contract.environment?.inherit, 'filtered');
  assert.equal(contract.environment?.windowsPath, 'registry');
});

test('POSIX login shells use the contract profile mode instead of control arguments', () => {
  const contract = buildKodaXShellExecutionContract('bash', {
    platform: 'linux',
    env: { PATH: '/usr/bin:/bin', SHELL: '/bin/bash' },
    exists: existing('/usr/bin/bash', '/bin/bash'),
  });

  assert.ok(contract);
  assert.deepEqual(normalizeShellExecutionContract(contract), contract);
  assert.equal(contract.shell.kind, 'bash');
  assert.equal(contract.shell.profile, 'login-interactive');
  assert.equal(contract.shell.args, undefined);
  assert.equal(contract.environment?.windowsPath, undefined);
});

test('explicit cmd remains native and does not inject version-manager-specific setup', () => {
  const cmd = 'C:\\Windows\\System32\\cmd.exe';
  const contract = buildKodaXShellExecutionContract('cmd', {
    platform: 'win32',
    env: {
      PATH: 'C:\\Windows\\System32',
      COMSPEC: cmd,
      SystemRoot: 'C:\\Windows',
    },
    exists: existing(cmd),
  });

  assert.ok(contract);
  assert.equal(contract.shell.kind, 'cmd');
  assert.equal(contract.shell.profile, 'default');
  assert.equal(contract.environment?.setup, undefined);
});

test('unsupported shells degrade to no contract instead of throwing', () => {
  const contract = buildKodaXShellExecutionContract('auto', {
    platform: 'linux',
    env: { PATH: '/usr/bin' },
    exists: () => false,
  });

  assert.equal(contract, undefined);
});

test('a failed profile canary degrades PowerShell to a profile-free contract', async () => {
  const powershell = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';
  const contract = await resolveKodaXShellExecutionContract('powershell', {
    platform: 'win32',
    env: { PATH: 'C:\\Windows\\System32', SystemRoot: 'C:\\Windows' },
    exists: existing(powershell),
    probeProfile: async () => false,
  });

  assert.ok(contract);
  assert.equal(contract.shell.profile, 'none');
  assert.equal(contract.environment?.windowsPath, 'registry');
  assert.deepEqual(normalizeShellExecutionContract(contract), contract);
});

test('a failed profile canary drops bash contracts to the inherited environment', async () => {
  const contract = await resolveKodaXShellExecutionContract('bash', {
    platform: 'linux',
    env: { PATH: '/usr/bin:/bin', SHELL: '/bin/bash' },
    exists: existing('/usr/bin/bash', '/bin/bash'),
    probeProfile: async () => false,
  });

  assert.equal(contract, undefined);
});

test('a successful profile canary keeps the profile contract and is cached', async () => {
  let probes = 0;
  const options = {
    platform: 'linux' as const,
    env: { PATH: '/usr/bin:/bin', SHELL: '/bin/bash' },
    exists: existing('/usr/bin/bash', '/bin/bash'),
    probeProfile: async () => {
      probes += 1;
      return true;
    },
  };

  const first = await resolveKodaXShellExecutionContract('bash', options);
  const second = await resolveKodaXShellExecutionContract('bash', options);

  assert.equal(first?.shell.profile, 'login-interactive');
  assert.deepEqual(second, first);
  assert.equal(probes, 1);
});

test('profile canary results are scoped to the effective command cwd', async () => {
  let probes = 0;
  const options = {
    platform: 'linux' as const,
    env: { PATH: '/usr/bin:/bin', SHELL: '/bin/bash' },
    exists: existing('/usr/bin/bash', '/bin/bash'),
    probeProfile: async () => {
      probes += 1;
      return true;
    },
  };

  await resolveKodaXShellExecutionContract('bash', { ...options, cwd: '/repo/one' });
  await resolveKodaXShellExecutionContract('bash', { ...options, cwd: '/repo/one' });
  await resolveKodaXShellExecutionContract('bash', { ...options, cwd: '/repo/two' });

  assert.equal(probes, 2);
});

test('a successful profile canary is refreshed with the Runtime environment cache', async () => {
  mock.timers.enable({ apis: ['Date'], now: 0 });
  try {
    let probes = 0;
    const options = {
      platform: 'linux' as const,
      env: { PATH: '/usr/bin:/bin', SHELL: '/bin/bash' },
      exists: existing('/usr/bin/bash', '/bin/bash'),
      probeProfile: async () => {
        probes += 1;
        return true;
      },
    };

    await resolveKodaXShellExecutionContract('bash', options);
    await resolveKodaXShellExecutionContract('bash', options);
    assert.equal(probes, 1);

    mock.timers.tick(30_001);
    await resolveKodaXShellExecutionContract('bash', options);
    assert.equal(probes, 2);
  } finally {
    mock.timers.reset();
  }
});

test('a failed profile canary is cached briefly and retried after its TTL', async () => {
  mock.timers.enable({ apis: ['Date'], now: 0 });
  try {
    let probes = 0;
    const options = {
      platform: 'linux' as const,
      env: { PATH: '/usr/bin:/bin', SHELL: '/bin/bash' },
      exists: existing('/usr/bin/bash', '/bin/bash'),
      probeProfile: async () => {
        probes += 1;
        return false;
      },
    };

    await resolveKodaXShellExecutionContract('bash', options);
    await resolveKodaXShellExecutionContract('bash', options);
    assert.equal(probes, 1);

    mock.timers.tick(60_001);
    await resolveKodaXShellExecutionContract('bash', options);
    assert.equal(probes, 2);
  } finally {
    mock.timers.reset();
  }
});

test('cmd contracts skip the profile canary because cmd loads no profile', async () => {
  const cmd = 'C:\\Windows\\System32\\cmd.exe';
  let probes = 0;
  const contract = await resolveKodaXShellExecutionContract('cmd', {
    platform: 'win32',
    env: { PATH: 'C:\\Windows\\System32', COMSPEC: cmd, SystemRoot: 'C:\\Windows' },
    exists: existing(cmd),
    probeProfile: async () => {
      probes += 1;
      return false;
    },
  });

  assert.ok(contract);
  assert.equal(contract.shell.kind, 'cmd');
  assert.equal(probes, 0);
});
