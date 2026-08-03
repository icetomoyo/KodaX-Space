import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';

import { getKodaxRuntimeDir } from './data-paths.js';

const MAX_CAPTURED_OUTPUT = 64 * 1024;
const DAEMON_STOP_OUTER_GRACE_MS = 5_000;

export interface SafeDaemonStopResult {
  readonly stopped: boolean;
  readonly reason?:
    | 'missing'
    | 'stale'
    | 'unhealthy'
    | 'unverified_owner'
    | 'cleanup_failed'
    | 'cleanup_unverified'
    | 'replacement_running'
    | 'command_failed'
    | 'invalid_output'
    | 'timeout'
    | string;
  readonly exitCode?: number;
  readonly message?: string;
}

interface DaemonStopJson {
  readonly stopped?: unknown;
  readonly reason?: unknown;
  readonly health?: unknown;
  readonly error?: unknown;
}

export interface DaemonStopCommandResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut: boolean;
}

export interface SafeDaemonStopOptions {
  readonly timeoutMs?: number;
  readonly runtimeDir?: string;
  readonly cliPath?: string;
  readonly runCommand?: (
    executable: string,
    args: readonly string[],
    env: NodeJS.ProcessEnv,
    timeoutMs: number,
  ) => Promise<DaemonStopCommandResult>;
}

function appendBounded(current: string, chunk: Buffer | string): string {
  if (current.length >= MAX_CAPTURED_OUTPUT) return current;
  return `${current}${String(chunk)}`.slice(0, MAX_CAPTURED_OUTPUT);
}

async function runCommand(
  executable: string,
  args: readonly string[],
  env: NodeJS.ProcessEnv,
  timeoutMs: number,
): Promise<DaemonStopCommandResult> {
  return new Promise<DaemonStopCommandResult>((resolve) => {
    const child = spawn(executable, args, {
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    let timedOut = false;

    child.stdout.on('data', (chunk: Buffer) => {
      stdout = appendBounded(stdout, chunk);
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr = appendBounded(stderr, chunk);
    });

    const finish = (exitCode: number): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ exitCode, stdout, stderr, timedOut });
    };
    child.once('error', (error) => {
      stderr = appendBounded(stderr, error.message);
      finish(1);
    });
    child.once('exit', (code) => finish(code ?? 1));

    const timer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill();
      } catch (error) {
        stderr = appendBounded(stderr, error instanceof Error ? error.message : String(error));
      } finally {
        // A failed or delayed process termination must not leave application
        // shutdown waiting forever for an `exit` event that may never arrive.
        finish(1);
      }
    }, timeoutMs);
    timer.unref?.();
  });
}

function resolveKodaxCliPath(): string {
  const requireFromBundle = createRequire(__filename);
  const packageJsonPath = requireFromBundle.resolve('@kodax-ai/kodax/package.json');
  return path.join(path.dirname(packageJsonPath), 'dist', 'kodax_cli.js');
}

export function parseDaemonStopOutput(result: DaemonStopCommandResult): SafeDaemonStopResult {
  if (result.timedOut) {
    return {
      stopped: false,
      reason: 'timeout',
      exitCode: result.exitCode,
      message: 'Timed out waiting for the Coder daemon to stop.',
    };
  }
  if (result.exitCode !== 0) {
    return {
      stopped: false,
      reason: 'command_failed',
      exitCode: result.exitCode,
      message: result.stderr.trim().slice(0, 512) || 'Coder daemon stop command failed.',
    };
  }

  let parsed: DaemonStopJson;
  try {
    parsed = JSON.parse(result.stdout.trim()) as DaemonStopJson;
  } catch {
    return {
      stopped: false,
      reason: 'invalid_output',
      exitCode: result.exitCode,
      message: 'Coder daemon stop command returned invalid output.',
    };
  }
  if (typeof parsed.stopped !== 'boolean') {
    return {
      stopped: false,
      reason: 'invalid_output',
      exitCode: result.exitCode,
      message: 'Coder daemon stop command omitted its stop result.',
    };
  }
  const reason = typeof parsed.reason === 'string' ? parsed.reason : undefined;
  const health = typeof parsed.health === 'string' ? parsed.health : undefined;
  const error = typeof parsed.error === 'string' ? parsed.error.trim().slice(0, 512) : undefined;
  return {
    stopped: parsed.stopped,
    ...(reason !== undefined ? { reason } : {}),
    ...(!parsed.stopped && reason === undefined && health !== undefined ? { reason: health } : {}),
    exitCode: result.exitCode,
    ...(!parsed.stopped && error ? { message: error } : {}),
  };
}

/**
 * Ask the published KodaX CLI to stop the Coder daemon through daemon.stop.
 * The daemon performs its own atomic client/work preflight, waits for the exact
 * daemon process to exit, verifies the durable cleanup outcome, and refuses
 * when another client, run, workflow, agent turn, or interaction still owns
 * work.
 */
export async function stopCoderDaemonWhenSafe(
  options: SafeDaemonStopOptions = {},
): Promise<SafeDaemonStopResult> {
  const timeoutMs = Math.max(500, options.timeoutMs ?? 15_000);
  const cliPath = options.cliPath ?? resolveKodaxCliPath();
  const runtimeDir = path.resolve(options.runtimeDir ?? getKodaxRuntimeDir());
  // The Electron main bundle is CommonJS while KodaX publishes import-only
  // subpath exports. Keep this as a real dynamic import; a top-level import
  // would compile to require("@kodax-ai/kodax/agent") and crash at bootstrap.
  const { prepareInternalNodeLaunch } = await import('@kodax-ai/kodax/agent');
  const launch = prepareInternalNodeLaunch({
    args: [
      cliPath,
      'daemon',
      'stop',
      '--profile',
      'coder',
      '--timeout-ms',
      String(timeoutMs),
      '--json',
    ],
    env: {
      ...process.env,
      KODAX_HOME: runtimeDir,
    },
    isElectron: process.versions.electron !== undefined,
  });
  const result = await (options.runCommand ?? runCommand)(
    process.execPath,
    launch.args,
    launch.env,
    // KodaX may use one timeout window to connect and a fresh one after
    // daemon.stop is accepted. Its initialize/stop RPCs are not charged to the
    // connect deadline, so reserve a third window for that handshake plus grace
    // for Windows exact-tree recovery, the final PID wait, and JSON output.
    // Keep an outer hard bound without killing a valid in-contract cleanup.
    timeoutMs * 3 + DAEMON_STOP_OUTER_GRACE_MS,
  );
  return parseDaemonStopOutput(result);
}
