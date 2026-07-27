import type { KodaXShellExecutionContract } from '@kodax-ai/kodax/coding';

import {
  resolveTerminalShell,
  type ResolvedShell,
  type ShellResolutionOptions,
  type TerminalShellPreference,
} from '../terminal/shell.js';
import { probeShellProfileEnvironment } from './shell-env-hydrate.js';

const SHELL_ENV_CACHE_TTL_MS = 30_000;
const SHELL_ENV_PROBE_TIMEOUT_MS = 10_000;
const PROFILE_CANARY_FAILURE_RETRY_MS = 60_000;

export interface ShellExecutionContractOptions extends ShellResolutionOptions {
  /** Effective command working directory used by the daemon. */
  readonly cwd?: string;
  /** Test hook: replace the profile canary probe. */
  readonly probeProfile?: (shell: ResolvedShell) => Promise<boolean>;
}

interface ShellExecutionContractBase {
  readonly shell: ResolvedShell;
  readonly contract: KodaXShellExecutionContract;
}

function buildContractBase(
  preference: TerminalShellPreference,
  options: ShellResolutionOptions,
): ShellExecutionContractBase | undefined {
  const platform = options.platform ?? process.platform;
  const shell = resolveTerminalShell(preference, options);
  if (
    shell.kind !== 'pwsh' &&
    shell.kind !== 'powershell' &&
    shell.kind !== 'cmd' &&
    shell.kind !== 'bash' &&
    shell.kind !== 'zsh'
  ) {
    return undefined;
  }

  // Keep the daemon's PowerShell environment probe aligned with Space's
  // canary. A Restricted policy can otherwise let the Bypass canary pass and
  // then make every Runtime profile probe fail closed.
  const fixedArgs =
    shell.kind === 'pwsh' || shell.kind === 'powershell'
      ? [...shell.args, '-ExecutionPolicy', 'Bypass']
      : undefined;
  const profile = shell.kind === 'bash' || shell.kind === 'zsh' ? 'login-interactive' : 'default';

  return {
    shell,
    contract: {
      version: 1,
      shell: {
        kind: shell.kind,
        executable: shell.program,
        ...(fixedArgs && fixedArgs.length > 0 ? { args: fixedArgs } : {}),
        profile,
      },
      environment: {
        inherit: 'filtered',
        ...(platform === 'win32' ? { windowsPath: 'registry' } : {}),
      },
      cache: {
        ttlMs: SHELL_ENV_CACHE_TTL_MS,
        refreshToken: preference,
      },
      probeTimeoutMs: SHELL_ENV_PROBE_TIMEOUT_MS,
    },
  };
}

interface ProfileCanaryEntry {
  expiresAt: number;
  readonly promise: Promise<boolean>;
}

const profileCanaryCache = new Map<string, ProfileCanaryEntry>();

/**
 * Cache a passing profile canary for the same interval as Runtime's resolved
 * shell environment. A failure is retried after a longer grace period so one
 * transient profile hiccup cannot trigger a probe on every later run.
 */
async function probeShellProfileOnce(
  shell: ResolvedShell,
  options: ShellExecutionContractOptions,
): Promise<boolean> {
  const key = [
    options.platform ?? process.platform,
    shell.kind,
    shell.program,
    options.cwd ?? '',
  ].join('|');
  const cached = profileCanaryCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.promise;

  const probe =
    options.probeProfile ??
    ((candidate: ResolvedShell) =>
      probeShellProfileEnvironment(candidate, options.cwd ? { cwd: options.cwd } : {}));
  const entry: ProfileCanaryEntry = {
    expiresAt: Date.now() + PROFILE_CANARY_FAILURE_RETRY_MS,
    promise: Promise.resolve()
      .then(() => probe(shell))
      .then(
        (usable) => {
          if (usable) {
            entry.expiresAt = Date.now() + SHELL_ENV_CACHE_TTL_MS;
          } else {
            console.warn(
              `[shell-execution] ${shell.kind} profile probe returned no framed PATH; ` +
                'degrading the shell-execution contract until the probe recovers.',
            );
          }
          return usable;
        },
        (error: unknown) => {
          console.warn(
            `[shell-execution] ${shell.kind} profile probe failed:`,
            error instanceof Error ? error.message : error,
          );
          return false;
        },
      ),
  };
  profileCanaryCache.set(key, entry);
  return entry.promise;
}

export function resetShellExecutionCanaryForTesting(): void {
  profileCanaryCache.clear();
}

/**
 * Translate Space's server-controlled shell preference into KodaX's
 * JSON-serializable command-execution contract.
 *
 * The contract is deliberately version-manager agnostic. KodaX resolves the
 * selected shell's profile in each effective cwd, so fnm, Volta, nvm, asdf,
 * pyenv and similar tools work through their normal PATH/shim setup.
 *
 * Returns undefined when the resolved shell cannot carry the contract
 * (sh/other) so callers degrade to the daemon's inherited environment
 * instead of failing the run.
 */
export function buildKodaXShellExecutionContract(
  preference: TerminalShellPreference,
  options: ShellResolutionOptions = {},
): KodaXShellExecutionContract | undefined {
  return buildContractBase(preference, options)?.contract;
}

/**
 * Build the contract and validate its profile-loading path with a canary
 * probe before handing it to the daemon. KodaX command tools fail closed
 * when their environment probe cannot frame the selected profile's output,
 * so a broken or slow profile (interactive prompts, heavy prompt-render init,
 * stdout noise) must degrade here instead of breaking every command call:
 *
 * - pwsh/powershell fall back to profile 'none' — the registry PATH
 *   composition still applies, only profile increments are lost;
 * - bash/zsh drop the contract entirely and keep the daemon's inherited
 *   environment (the pre-contract legacy behavior).
 *
 * cmd loads no profile, so its probe cannot be broken by profile behavior
 * and skips the canary.
 */
export async function resolveKodaXShellExecutionContract(
  preference: TerminalShellPreference,
  options: ShellExecutionContractOptions = {},
): Promise<KodaXShellExecutionContract | undefined> {
  const base = buildContractBase(preference, options);
  if (!base) {
    console.warn(
      `[shell-execution] shell for preference '${preference}' cannot carry the KodaX ` +
        'shell-execution contract; the daemon keeps its inherited environment.',
    );
    return undefined;
  }
  const { shell, contract } = base;
  const profileLoading =
    ((shell.kind === 'pwsh' || shell.kind === 'powershell') &&
      contract.shell.profile === 'default') ||
    ((shell.kind === 'bash' || shell.kind === 'zsh') &&
      contract.shell.profile === 'login-interactive');
  if (!profileLoading) return contract;
  if (await probeShellProfileOnce(shell, options)) return contract;
  if (shell.kind === 'pwsh' || shell.kind === 'powershell') {
    return { ...contract, shell: { ...contract.shell, profile: 'none' } };
  }
  return undefined;
}
