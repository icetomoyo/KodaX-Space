import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveTerminalShell } from '../terminal/shell.js';

function existing(...paths: string[]): (candidate: string) => boolean {
  const normalized = new Set(paths.map((entry) => entry.toLowerCase()));
  return (candidate) => normalized.has(candidate.toLowerCase());
}

test('Windows auto shell prefers pwsh from PATH', () => {
  const shell = resolveTerminalShell('auto', {
    platform: 'win32',
    env: {
      PATH: 'C:\\Tools;C:\\Windows\\System32',
      PATHEXT: '.EXE;.CMD',
      SystemRoot: 'C:\\Windows',
    },
    exists: existing(
      'C:\\Tools\\pwsh.EXE',
      'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
      'C:\\Windows\\System32\\cmd.exe',
    ),
  });

  assert.equal(shell.kind, 'pwsh');
  assert.equal(shell.program.toLowerCase(), 'c:\\tools\\pwsh.exe');
  assert.deepEqual(shell.args, ['-NoLogo']);
});

test('Windows auto shell falls back to Windows PowerShell before cmd', () => {
  const shell = resolveTerminalShell('auto', {
    platform: 'win32',
    env: {
      PATH: 'C:\\Windows\\System32',
      PATHEXT: '.EXE;.CMD',
      SystemRoot: 'C:\\Windows',
      COMSPEC: 'C:\\Windows\\System32\\cmd.exe',
    },
    exists: existing(
      'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
      'C:\\Windows\\System32\\cmd.exe',
    ),
  });

  assert.equal(shell.kind, 'powershell');
  assert.match(shell.program, /WindowsPowerShell[\\/]v1\.0[\\/]powershell\.exe$/i);
});

test('configured absolute SHELL wins in POSIX auto mode', () => {
  const shell = resolveTerminalShell('auto', {
    platform: 'darwin',
    env: {
      SHELL: '/opt/homebrew/bin/zsh',
      PATH: '',
    },
    exists: existing('/opt/homebrew/bin/zsh'),
  });

  assert.equal(shell.kind, 'zsh');
  assert.deepEqual(shell.args, ['-l']);
});

test('Windows auto shell does not let Git Bash preempt native PowerShell', () => {
  const shell = resolveTerminalShell('auto', {
    platform: 'win32',
    env: {
      SHELL: 'C:\\Program Files\\Git\\bin\\bash.exe',
      PATH: 'C:\\Windows\\System32',
      SystemRoot: 'C:\\Windows',
    },
    exists: existing(
      'C:\\Program Files\\Git\\bin\\bash.exe',
      'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
    ),
  });

  assert.equal(shell.kind, 'powershell');
});

test('unavailable explicit shell falls back without executing an arbitrary path', () => {
  const shell = resolveTerminalShell('pwsh', {
    platform: 'win32',
    env: {
      PATH: 'C:\\Windows\\System32',
      PATHEXT: '.EXE;.CMD',
      SystemRoot: 'C:\\Windows',
    },
    exists: existing('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'),
  });

  assert.equal(shell.kind, 'powershell');
  assert.notEqual(shell.program.toLowerCase(), 'pwsh.exe');
});
