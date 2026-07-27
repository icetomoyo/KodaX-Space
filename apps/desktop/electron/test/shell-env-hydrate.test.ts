import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';

import {
  hydrateShellEnvOnce,
  parseNullDelimitedEnvironment,
  parsePowerShellEnvironment,
  posixCaptureArgs,
  powerShellCaptureArgs,
  probeShellProfileEnvironment,
  resetShellEnvHydrationForTesting,
} from '../kodax/shell-env-hydrate.js';
import type { ResolvedShell } from '../terminal/shell.js';

const POWERSHELL: ResolvedShell = {
  kind: 'powershell',
  program: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
  args: ['-NoLogo'],
};

afterEach(() => {
  resetShellEnvHydrationForTesting();
});

test('Windows hydration projects shell PATH without copying profile secrets', async () => {
  const env: NodeJS.ProcessEnv = {
    PATH: 'C:\\Windows\\System32',
    OPENAI_API_KEY: undefined,
  };
  const result = await hydrateShellEnvOnce({
    platform: 'win32',
    env,
    cwd: process.cwd(),
    resolveShell: () => POWERSHELL,
    runCapture: async () => ({
      Path: 'C:\\Toolchain\\bin;C:\\Windows\\System32',
      OPENAI_API_KEY: 'must-not-propagate',
      FNM_DIR: 'C:\\Users\\test\\fnm',
    }),
  });

  assert.equal(result.hydrated, true);
  assert.equal(env.PATH, 'C:\\Toolchain\\bin;C:\\Windows\\System32');
  assert.equal(env.OPENAI_API_KEY, undefined);
  assert.equal(env.FNM_DIR, undefined);
});

test('Windows hydration is idempotent and captures a profile only once', async () => {
  const env: NodeJS.ProcessEnv = { PATH: 'old' };
  let captures = 0;
  const options = {
    platform: 'win32' as const,
    env,
    cwd: process.cwd(),
    resolveShell: () => POWERSHELL,
    runCapture: async () => {
      captures += 1;
      return { PATH: `resolved-${captures}` };
    },
  };

  await hydrateShellEnvOnce(options);
  await hydrateShellEnvOnce(options);

  assert.equal(captures, 1);
  assert.equal(env.PATH, 'resolved-1');
});

test('cmd preference skips profile capture and leaves PATH unchanged', async () => {
  const env: NodeJS.ProcessEnv = { PATH: 'original' };
  let captured = false;
  const result = await hydrateShellEnvOnce({
    platform: 'win32',
    env,
    resolveShell: () => ({ kind: 'cmd', program: 'cmd.exe', args: [] }),
    runCapture: async () => {
      captured = true;
      return { PATH: 'unexpected' };
    },
  });

  assert.equal(result.hydrated, false);
  assert.equal(result.reason, 'unsupported-shell');
  assert.equal(captured, false);
  assert.equal(env.PATH, 'original');
});

test('Windows bash profile is not projected into the native host PATH', async () => {
  const env: NodeJS.ProcessEnv = { PATH: 'C:\\Windows\\System32' };
  let captured = false;
  const result = await hydrateShellEnvOnce({
    platform: 'win32',
    env,
    resolveShell: () => ({
      kind: 'bash',
      program: 'C:\\Program Files\\Git\\bin\\bash.exe',
      args: ['-l'],
    }),
    runCapture: async () => {
      captured = true;
      return { PATH: '/mingw64/bin:/usr/bin' };
    },
  });

  assert.equal(result.hydrated, false);
  assert.equal(result.reason, 'unsupported-shell');
  assert.equal(captured, false);
  assert.equal(env.PATH, 'C:\\Windows\\System32');
});

test('profile capture without PATH fails closed', async () => {
  const env: NodeJS.ProcessEnv = { PATH: 'original' };
  const result = await hydrateShellEnvOnce({
    platform: 'win32',
    env,
    resolveShell: () => POWERSHELL,
    runCapture: async () => ({ FNM_DIR: 'C:\\fnm' }),
  });

  assert.equal(result.hydrated, false);
  assert.equal(result.reason, 'missing-path');
  assert.equal(env.PATH, 'original');
});

test('transient capture failure is retried instead of cached forever', async () => {
  const env: NodeJS.ProcessEnv = { PATH: 'original' };
  let captures = 0;
  const options = {
    platform: 'win32' as const,
    env,
    cwd: process.cwd(),
    resolveShell: () => POWERSHELL,
    runCapture: async () => {
      captures += 1;
      if (captures === 1) throw new Error('profile exploded');
      return { PATH: 'resolved' };
    },
  };

  const first = await hydrateShellEnvOnce(options);
  assert.equal(first.hydrated, false);
  assert.equal(first.reason, 'capture-failed');

  const second = await hydrateShellEnvOnce(options);
  assert.equal(second.hydrated, true);
  assert.equal(captures, 2);
  assert.equal(env.PATH, 'resolved');
});

test('posix capture projects only PATH without GNU env extensions', () => {
  const args = posixCaptureArgs('__SENTINEL__');
  const command = args[args.length - 1];
  assert.ok(command);
  assert.equal(command.includes('env -0'), false);
  assert.ok(command.includes('$PATH'));
  assert.ok(command.includes('__SENTINEL__'));
});

test('plain sh capture avoids unsupported interactive-shell flags', () => {
  const args = posixCaptureArgs('__SENTINEL__', 'sh');
  assert.deepEqual(args.slice(0, 1), ['-lc']);
});

test('powershell capture bypasses the execution policy and embeds the sentinel', () => {
  const args = powerShellCaptureArgs(POWERSHELL, '__SENTINEL__');
  assert.deepEqual(args.slice(0, 5), [
    '-NoLogo',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-EncodedCommand',
  ]);
  const script = Buffer.from(args[5] ?? '', 'base64').toString('utf16le');
  assert.ok(script.includes('__SENTINEL__'));
});

test('powershell frame parsing tolerates profile noise and rejects garbage', () => {
  const environment = { Path: 'C:\\Tools;C:\\Windows', FNM_DIR: 'C:\\fnm' };
  const encoded = Buffer.from(JSON.stringify(environment), 'utf8').toString('base64');
  const framed = Buffer.from(`oh-my-posh banner\r\n__S__${encoded}\r\n`, 'utf8');
  assert.deepEqual(parsePowerShellEnvironment(framed, '__S__'), environment);
  assert.deepEqual(parsePowerShellEnvironment(Buffer.from('no frame'), '__S__'), {});
  assert.deepEqual(
    parsePowerShellEnvironment(Buffer.from('__S__not-valid-base64!!!'), '__S__'),
    {},
  );
});

test('null-delimited frame parsing reads entries after the last sentinel', () => {
  const framed = Buffer.from('profile noise\0__S__\0PATH=/a:/b\0FOO=bar\0', 'utf8');
  assert.deepEqual(parseNullDelimitedEnvironment(framed, '__S__'), {
    PATH: '/a:/b',
    FOO: 'bar',
  });
  assert.deepEqual(parseNullDelimitedEnvironment(Buffer.from('PATH=/a'), '__S__'), {});
});

test('profile probe requires a captured PATH and never throws', async () => {
  assert.equal(
    await probeShellProfileEnvironment(POWERSHELL, {
      runCapture: async () => ({ Path: 'C:\\Tools' }),
    }),
    true,
  );
  assert.equal(
    await probeShellProfileEnvironment(POWERSHELL, { runCapture: async () => ({}) }),
    false,
  );
  assert.equal(
    await probeShellProfileEnvironment(POWERSHELL, {
      runCapture: async () => {
        throw new Error('boom');
      },
    }),
    false,
  );
});
