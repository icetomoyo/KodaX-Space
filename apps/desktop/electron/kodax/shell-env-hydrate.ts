import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import os from 'node:os';

import {
  resolveTerminalShell,
  type ResolvedShell,
  type TerminalShellPreference,
} from '../terminal/shell.js';

const MAX_CAPTURE_BYTES = 1024 * 1024;
const CAPTURE_TIMEOUT_MS = 5_000;

export interface ShellEnvHydrationResult {
  readonly hydrated: boolean;
  readonly shell?: ResolvedShell;
  readonly reason?: 'disabled' | 'unsupported-shell' | 'capture-failed' | 'missing-path';
}

export interface ShellEnvHydrationOptions {
  readonly preference?: TerminalShellPreference;
  readonly cwd?: string;
  readonly platform?: NodeJS.Platform;
  readonly env?: NodeJS.ProcessEnv;
  readonly resolveShell?: (
    preference: TerminalShellPreference,
    options: { platform: NodeJS.Platform; env: NodeJS.ProcessEnv },
  ) => ResolvedShell;
  readonly runCapture?: (
    shell: ResolvedShell,
    cwd: string,
    env: NodeJS.ProcessEnv,
    sentinel: string,
  ) => Promise<Readonly<Record<string, string>>>;
}

let hydrationPromise: Promise<ShellEnvHydrationResult> | null = null;

function pathEntry(environment: Readonly<Record<string, string>>): string | undefined {
  const entry = Object.entries(environment).find(([key]) => key.toLowerCase() === 'path');
  return entry?.[1];
}

function setProcessPath(env: NodeJS.ProcessEnv, value: string): void {
  const matchingKeys = Object.keys(env).filter((key) => key.toLowerCase() === 'path');
  const targetKey = matchingKeys[0] ?? 'PATH';
  env[targetKey] = value;
  for (const duplicate of matchingKeys.slice(1)) delete env[duplicate];
}

export function parseNullDelimitedEnvironment(
  output: Buffer,
  sentinel: string,
): Readonly<Record<string, string>> {
  const marker = Buffer.from(`${sentinel}\0`, 'utf8');
  const markerIndex = output.lastIndexOf(marker);
  if (markerIndex < 0) return {};
  const environment: Record<string, string> = {};
  const payload = output.subarray(markerIndex + marker.length).toString('utf8');
  for (const entry of payload.split('\0')) {
    const separator = entry.indexOf('=');
    if (separator <= 0) continue;
    environment[entry.slice(0, separator)] = entry.slice(separator + 1);
  }
  return environment;
}

export function parsePowerShellEnvironment(
  output: Buffer,
  sentinel: string,
): Readonly<Record<string, string>> {
  const text = output.toString('utf8');
  const markerIndex = text.lastIndexOf(sentinel);
  if (markerIndex < 0) return {};
  const encoded = text
    .slice(markerIndex + sentinel.length)
    .split(/\r?\n/, 1)[0]
    .trim();
  if (!encoded) return {};
  try {
    const decoded = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8')) as unknown;
    if (!decoded || typeof decoded !== 'object' || Array.isArray(decoded)) return {};
    const environment: Record<string, string> = {};
    for (const [key, value] of Object.entries(decoded)) {
      if (typeof value === 'string') environment[key] = value;
    }
    return environment;
  } catch {
    return {};
  }
}

export function powerShellCaptureArgs(shell: ResolvedShell, sentinel: string): readonly string[] {
  const script = [
    "$ErrorActionPreference = 'Stop'",
    '$environment = [ordered]@{}',
    'Get-ChildItem Env: | ForEach-Object { $environment[$_.Name] = $_.Value }',
    '$json = $environment | ConvertTo-Json -Compress',
    '$bytes = [Text.Encoding]::UTF8.GetBytes($json)',
    `$encoded = [Convert]::ToBase64String($bytes)`,
    `[Console]::Out.WriteLine('${sentinel}' + $encoded)`,
  ].join('; ');
  const encodedCommand = Buffer.from(script, 'utf16le').toString('base64');
  // A GUI client may run under the default Restricted execution policy,
  // which would silently skip $PROFILE and lose the profile PATH increment.
  return [
    ...shell.args,
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-EncodedCommand',
    encodedCommand,
  ];
}

export function posixCaptureArgs(
  sentinel: string,
  shellKind: 'bash' | 'zsh' | 'sh' = 'bash',
): readonly string[] {
  // Only PATH is ever projected into the host, so capture nothing else: a
  // PATH-only payload needs no GNU-only `env -0` (absent on macOS/BSD) and
  // keeps profile-defined secrets out of the Electron process entirely.
  const command = `printf '%s\\0' '${sentinel}'; printf 'PATH=%s\\0' "$PATH"`;
  // dash and other /bin/sh implementations commonly reject interactive
  // `-i`; a login command is sufficient for their profile/PATH discovery.
  return [shellKind === 'sh' ? '-lc' : '-lic', command];
}

async function defaultRunCapture(
  shell: ResolvedShell,
  cwd: string,
  env: NodeJS.ProcessEnv,
  sentinel: string,
): Promise<Readonly<Record<string, string>>> {
  const isPowerShell = shell.kind === 'pwsh' || shell.kind === 'powershell';
  const isPosixShell = shell.kind === 'bash' || shell.kind === 'zsh' || shell.kind === 'sh';
  if (!isPowerShell && !isPosixShell) return {};
  const args = isPowerShell
    ? powerShellCaptureArgs(shell, sentinel)
    : posixCaptureArgs(sentinel, shell.kind as 'bash' | 'zsh' | 'sh');

  const output = await new Promise<Buffer>((resolve, reject) => {
    execFile(
      shell.program,
      [...args],
      {
        cwd,
        env: { ...env, TERM: 'dumb' },
        encoding: 'buffer',
        maxBuffer: MAX_CAPTURE_BYTES,
        timeout: CAPTURE_TIMEOUT_MS,
        windowsHide: true,
      },
      (error, stdout) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout));
      },
    );
  });
  return isPowerShell
    ? parsePowerShellEnvironment(output, sentinel)
    : parseNullDelimitedEnvironment(output, sentinel);
}

async function hydrateShellEnv(
  options: ShellEnvHydrationOptions,
): Promise<ShellEnvHydrationResult> {
  const env = options.env ?? process.env;
  if (env.KODAX_DISABLE_SHELL_ENV_HYDRATION === '1') {
    return { hydrated: false, reason: 'disabled' };
  }

  const platform = options.platform ?? process.platform;
  const preference = options.preference ?? 'auto';
  // macOS skips the SDK hydrator: its capture command relies on the GNU-only
  // `env -0` (no darwin branch in @kodax-ai/kodax 0.7.77), so the probe exits
  // non-zero and the SDK silently reports "not hydrated" forever. Space's own
  // PATH-only capture below is portable and covers the #112 goal (login-shell
  // PATH in PTY/daemon bootstrap). Linux keeps the SDK's full-env hydration.
  if (
    platform !== 'win32' &&
    platform !== 'darwin' &&
    preference === 'auto' &&
    options.env === undefined &&
    options.resolveShell === undefined &&
    options.runCapture === undefined
  ) {
    try {
      const sdk = await import('@kodax-ai/kodax');
      return { hydrated: sdk.hydrateProcessEnvFromShell() };
    } catch (error) {
      console.warn(
        '[shell-env-hydrate] SDK shell profile capture failed (non-fatal):',
        error instanceof Error ? error.message : error,
      );
      return { hydrated: false, reason: 'capture-failed' };
    }
  }
  const shell = (options.resolveShell ?? resolveTerminalShell)(preference, { platform, env });
  const windowsHostCompatible = shell.kind === 'pwsh' || shell.kind === 'powershell';
  if (
    shell.kind === 'cmd' ||
    shell.kind === 'other' ||
    (platform === 'win32' && !windowsHostCompatible)
  ) {
    return { hydrated: false, shell, reason: 'unsupported-shell' };
  }

  const requestedCwd = options.cwd;
  const cwd = requestedCwd && existsSync(requestedCwd) ? requestedCwd : os.homedir();
  let captured: Readonly<Record<string, string>>;
  try {
    captured = await (options.runCapture ?? defaultRunCapture)(
      shell,
      cwd,
      env,
      `__KODAX_SPACE_SHELL_ENV_${randomUUID().replace(/-/g, '')}__`,
    );
  } catch (error) {
    console.warn(
      '[shell-env-hydrate] shell profile capture failed (non-fatal):',
      error instanceof Error ? error.message : error,
    );
    return { hydrated: false, shell, reason: 'capture-failed' };
  }

  const capturedPath = pathEntry(captured);
  if (!capturedPath) return { hydrated: false, shell, reason: 'missing-path' };
  const previousPath = env.PATH ?? env.Path ?? env.path;
  setProcessPath(env, capturedPath);
  return { hydrated: capturedPath !== previousPath, shell };
}

export interface ShellProfileProbeOptions {
  readonly cwd?: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly runCapture?: ShellEnvHydrationOptions['runCapture'];
}

/**
 * Canary for the KodaX shell-execution contract: run the same profile-loading
 * capture the daemon probe will perform and require a framed PATH payload.
 * Space degrades the contract when this returns false so a broken or slow
 * user profile cannot fail every command tool call. Never throws.
 */
export async function probeShellProfileEnvironment(
  shell: ResolvedShell,
  options: ShellProfileProbeOptions = {},
): Promise<boolean> {
  try {
    const env = options.env ?? process.env;
    const requestedCwd = options.cwd;
    const cwd = requestedCwd && existsSync(requestedCwd) ? requestedCwd : os.homedir();
    const captured = await (options.runCapture ?? defaultRunCapture)(
      shell,
      cwd,
      env,
      `__KODAX_SPACE_SHELL_ENV_${randomUUID().replace(/-/g, '')}__`,
    );
    return pathEntry(captured) !== undefined;
  } catch {
    return false;
  }
}

/**
 * Load the selected user shell profile once before the Runtime daemon or PTY is
 * created. On Windows, only PATH is projected into the Electron main process;
 * the complete captured environment stays out of process.env so profile-defined
 * credentials cannot leak into daemon command tools. Linux auto mode retains
 * the SDK hydrator's process-level behavior for PTY and daemon bootstrap;
 * macOS uses Space's own PATH-only capture because the SDK capture relies on
 * the GNU-only `env -0`. Each Coder run additionally receives the scoped
 * shell-execution contract.
 */
export function hydrateShellEnvOnce(
  options: ShellEnvHydrationOptions = {},
): Promise<ShellEnvHydrationResult> {
  hydrationPromise ??= hydrateShellEnv(options).then((result) => {
    if (result.hydrated) {
      console.info(
        `[shell-env-hydrate] PATH loaded from ${result.shell?.kind ?? 'user shell'} profile`,
      );
    } else {
      console.info(`[shell-env-hydrate] skipped (${result.reason ?? 'PATH unchanged'})`);
    }
    // Deterministic outcomes (disabled, unsupported shell, unchanged PATH)
    // stay cached for the process lifetime. A transient capture failure must
    // not poison every later daemon/PTY bootstrap, so the next call retries.
    if (
      !result.hydrated &&
      (result.reason === 'capture-failed' || result.reason === 'missing-path')
    ) {
      hydrationPromise = null;
    }
    return result;
  });
  return hydrationPromise;
}

export function resetShellEnvHydrationForTesting(): void {
  hydrationPromise = null;
}
