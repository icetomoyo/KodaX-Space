import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';

import { parseDaemonStopOutput, stopCoderDaemonWhenSafe } from '../kodax/runtime-daemon-control.js';

test('daemon stop output preserves safe stopped and missing outcomes', () => {
  assert.deepEqual(
    parseDaemonStopOutput({
      exitCode: 0,
      stdout: JSON.stringify({ stopped: true, health: 'missing', state: null }),
      stderr: '',
      timedOut: false,
    }),
    { stopped: true, exitCode: 0 },
  );
  assert.deepEqual(
    parseDaemonStopOutput({
      exitCode: 0,
      stdout: JSON.stringify({ stopped: false, reason: 'missing', state: null }),
      stderr: '',
      timedOut: false,
    }),
    { stopped: false, reason: 'missing', exitCode: 0 },
  );
});

test('daemon stop output fails closed on command errors, timeouts, and malformed JSON', () => {
  assert.equal(
    parseDaemonStopOutput({
      exitCode: 1,
      stdout: '',
      stderr: 'daemon refused: active_runs',
      timedOut: false,
    }).reason,
    'command_failed',
  );
  assert.equal(
    parseDaemonStopOutput({
      exitCode: 1,
      stdout: '',
      stderr: '',
      timedOut: true,
    }).reason,
    'timeout',
  );
  assert.equal(
    parseDaemonStopOutput({
      exitCode: 0,
      stdout: 'not-json',
      stderr: '',
      timedOut: false,
    }).reason,
    'invalid_output',
  );
  assert.deepEqual(
    parseDaemonStopOutput({
      exitCode: 0,
      stdout: JSON.stringify({
        stopped: false,
        reason: 'cleanup_failed',
        error: 'Runtime daemon process cleanup failed.',
      }),
      stderr: '',
      timedOut: false,
    }),
    {
      stopped: false,
      reason: 'cleanup_failed',
      exitCode: 0,
      message: 'Runtime daemon process cleanup failed.',
    },
  );
  assert.deepEqual(
    parseDaemonStopOutput({
      exitCode: 0,
      stdout: JSON.stringify({
        stopped: false,
        reason: 'cleanup_unverified',
        error: 'Runtime daemon exited without a verifiable successful cleanup outcome.',
      }),
      stderr: '',
      timedOut: false,
    }),
    {
      stopped: false,
      reason: 'cleanup_unverified',
      exitCode: 0,
      message: 'Runtime daemon exited without a verifiable successful cleanup outcome.',
    },
  );
  assert.deepEqual(
    parseDaemonStopOutput({
      exitCode: 0,
      stdout: JSON.stringify({ stopped: false, reason: 'replacement_running' }),
      stderr: '',
      timedOut: false,
    }),
    { stopped: false, reason: 'replacement_running', exitCode: 0 },
  );
});

test('safe daemon stop launches the published CLI against the active KODAX_HOME', async () => {
  const calls: Array<{
    executable: string;
    args: readonly string[];
    env: NodeJS.ProcessEnv;
    timeoutMs: number;
  }> = [];
  const runtimeDir = path.resolve('C:\\isolated-profile');
  const result = await stopCoderDaemonWhenSafe({
    runtimeDir,
    cliPath: path.resolve('fake-kodax-cli.js'),
    runCommand: async (executable, args, env, timeoutMs) => {
      calls.push({ executable, args, env, timeoutMs });
      return {
        exitCode: 0,
        stdout: JSON.stringify({ stopped: true, state: null }),
        stderr: '',
        timedOut: false,
      };
    },
  });

  assert.equal(result.stopped, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.executable, process.execPath);
  assert.deepEqual(calls[0]?.args.slice(-8), [
    path.resolve('fake-kodax-cli.js'),
    'daemon',
    'stop',
    '--profile',
    'coder',
    '--timeout-ms',
    '15000',
    '--json',
  ]);
  assert.equal(calls[0]?.env.KODAX_HOME, runtimeDir);
  assert.equal(calls[0]?.timeoutMs, 50_000);
});
