// PTY host — FEATURE_011.
//
// Single source of truth for running PTY child processes spawned via node-pty.
// Multiple PTY instances are keyed by uuid-v4 terminalId; main alone mints them
// so renderer never controls the id (prevents id forgery to attach to other PTYs).
//
// Lifecycle invariants:
//   - 1 ptyHost singleton per main process
//   - kill() is idempotent — calling on unknown id returns ok=true silently
//   - SIGTERM first, then SIGKILL after grace (3s) if process hasn't exited
//   - On app quit, ptyHost.disposeAll() must be called by main to avoid
//     orphan PTY processes outliving Electron
//
// Security:
//   - cwd must be absolute + pass projectStore.assertAllowed (caller's responsibility)
//   - shell selection is server-controlled per platform — renderer cannot pick
//   - env passed through a curated allowlist (PATH, HOME, USER, TERM, LANG, plus
//     Windows-specific SYSTEMROOT/APPDATA/LOCALAPPDATA) — secrets in main's env
//     do NOT propagate to the spawned shell
//   - output to renderer is chunked at 64 KB and rate-limited via flush queue

import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type { IPty } from 'node-pty';
import { resolveTerminalShell, type TerminalShellPreference } from './shell.js';

const IS_WIN = process.platform === 'win32';

// Lazy load node-pty via createRequire — top-level ESM import would break the
// tsx test harness (no native binding in CI test env, plus electron rebuilds
// it for Electron's V8 ABI which doesn't match Node's at test time).
let nodePtyCache: typeof import('node-pty') | null = null;
function getNodePty(): typeof import('node-pty') {
  if (nodePtyCache !== null) return nodePtyCache;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const meta = typeof require !== 'undefined' ? null : (import.meta as any);
  const req = meta ? createRequire(meta.url) : require;
  nodePtyCache = req('node-pty') as typeof import('node-pty');
  return nodePtyCache;
}

/**
 * Env allowlist — only these keys propagate from main's env to the spawned shell.
 *
 * SECURITY: Do NOT add `*_KEY` / `*_TOKEN` / `*_SECRET` entries here.
 * POSIX SDK hydration and provider keychain setup may inject API keys like
 * ANTHROPIC_API_KEY / OPENAI_API_KEY / GH_TOKEN into main's `process.env`.
 * Windows shell-profile hydration projects PATH only. THIS allowlist is what
 * keeps secrets out of every PTY shell the user spawns — if it grew, every
 * `echo $XXX_API_KEY` from inside the terminal would leak the secret.
 */
const ENV_ALLOWLIST: readonly string[] = [
  'PATH',
  'HOME',
  'USER',
  'USERNAME',
  'TERM',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'LANGUAGE',
  // Windows essentials — bash/cmd both need these to find user profile / drives
  'SYSTEMROOT',
  'SYSTEMDRIVE',
  'WINDIR',
  'APPDATA',
  'LOCALAPPDATA',
  'PROGRAMFILES',
  'PROGRAMFILES(X86)',
  'PROGRAMDATA',
  'PATHEXT',
  'TEMP',
  'TMP',
  'COMSPEC',
  'USERPROFILE',
  'HOMEDRIVE',
  'HOMEPATH',
];

export function buildPtyEnvironment(
  environment: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): Record<string, string> {
  const out: Record<string, string> = {};
  const isWindows = platform === 'win32';
  for (const key of ENV_ALLOWLIST) {
    // Windows environment keys are case-insensitive, but a plain object lookup
    // is not reliable after PATH has been refreshed from a shell profile
    // (`Path` is the common persisted spelling). Preserve the allowlist while
    // resolving the actual key casing used by the host process.
    const actualKey = isWindows
      ? Object.keys(environment).find((candidate) => candidate.toUpperCase() === key)
      : key;
    const v = actualKey ? environment[actualKey] : undefined;
    if (typeof v === 'string' && v.length > 0) out[key] = v;
  }
  // Always-on:
  out.TERM = out.TERM ?? 'xterm-256color';
  return out;
}

const MAX_OUTPUT_CHUNK = 65_536;

export interface PtyOutputEvent {
  readonly terminalId: string;
  readonly data: string;
}

export interface PtyExitEvent {
  readonly terminalId: string;
  readonly exitCode: number | null;
  readonly signal: string | null;
}

export interface CreateOptions {
  readonly cwd: string;
  readonly cols: number;
  readonly rows: number;
  readonly shellPreference?: TerminalShellPreference;
}

export interface CreatedTerminal {
  readonly terminalId: string;
  readonly shell: string;
  readonly pid: number;
}

interface Entry {
  readonly id: string;
  readonly pty: IPty;
  /** True only after the PTY has actually exited (onExit fired). Output / write are no-ops once set. */
  killed: boolean;
  /** True after kill() requested shutdown but onExit hasn't fired yet — still want to drain output. */
  killing: boolean;
  killTimer: NodeJS.Timeout | null;
}

export interface PtyHostListeners {
  /** Called on every chunk PTY emits — caller pushes to renderer */
  onOutput(ev: PtyOutputEvent): void;
  /** Called once per PTY when it exits */
  onExit(ev: PtyExitEvent): void;
}

export class PtyHost {
  private readonly entries = new Map<string, Entry>();
  private listeners: PtyHostListeners | null = null;

  setListeners(l: PtyHostListeners): void {
    this.listeners = l;
  }

  /** Validate cwd absolute + exists is caller's job. We just spawn. */
  create(opts: CreateOptions): CreatedTerminal {
    const cwd = opts.cwd;
    if (!path.isAbsolute(cwd)) {
      throw new Error('cwd must be absolute');
    }
    const shell = resolveTerminalShell(opts.shellPreference);
    const terminalId = randomUUID();
    const pty = getNodePty().spawn(shell.program, [...shell.args], {
      name: 'xterm-256color',
      cwd,
      cols: clampDim(opts.cols),
      rows: clampDim(opts.rows),
      env: buildPtyEnvironment(),
      // useConpty:  default (true on Win10+ if available); falls back to winpty if not.
    });

    const entry: Entry = { id: terminalId, pty, killed: false, killing: false, killTimer: null };
    this.entries.set(terminalId, entry);

    pty.onData((data) => {
      // Forward output until the PTY truly exits — during graceful SIGTERM grace
      // (entry.killing=true, entry.killed=false) the shell may still echo a
      // farewell prompt; dropping it would surprise the user.
      if (entry.killed) return;
      const listeners = this.listeners;
      if (!listeners) return;
      // Chunk oversized writes — xterm.js handles fine but our IPC schema caps at 64 KB
      let remaining = data;
      while (remaining.length > MAX_OUTPUT_CHUNK) {
        listeners.onOutput({ terminalId, data: remaining.slice(0, MAX_OUTPUT_CHUNK) });
        remaining = remaining.slice(MAX_OUTPUT_CHUNK);
      }
      if (remaining.length > 0) {
        listeners.onOutput({ terminalId, data: remaining });
      }
    });

    pty.onExit(({ exitCode, signal }) => {
      // Clear pending grace kill if any (process exited before SIGKILL grace)
      if (entry.killTimer !== null) {
        clearTimeout(entry.killTimer);
        entry.killTimer = null;
      }
      entry.killed = true;
      this.entries.delete(terminalId);
      this.listeners?.onExit({
        terminalId,
        exitCode: typeof exitCode === 'number' ? exitCode : null,
        signal: typeof signal === 'string' ? signal : signal != null ? String(signal) : null,
      });
    });

    return { terminalId, shell: shell.program, pid: pty.pid };
  }

  write(terminalId: string, data: string): boolean {
    const entry = this.entries.get(terminalId);
    // Reject writes once kill requested — even if the PTY is still draining output,
    // we don't want fresh input mid-shutdown.
    if (!entry || entry.killed || entry.killing) return false;
    try {
      entry.pty.write(data);
      return true;
    } catch {
      // node-pty may throw if the underlying handle closed between guard + write
      return false;
    }
  }

  resize(terminalId: string, cols: number, rows: number): boolean {
    const entry = this.entries.get(terminalId);
    if (!entry || entry.killed || entry.killing) return false;
    try {
      entry.pty.resize(clampDim(cols), clampDim(rows));
      return true;
    } catch {
      return false;
    }
  }

  /** Idempotent kill — returns true even if id unknown / already exited.
   *  Sets `killing=true` (blocks new write/resize) but keeps `killed=false`
   *  so output from the shell's graceful-shutdown still reaches xterm. */
  kill(terminalId: string): boolean {
    const entry = this.entries.get(terminalId);
    if (!entry || entry.killed) return true;
    if (entry.killing) return true; // already in shutdown grace
    entry.killing = true;
    // SIGTERM first (graceful)
    try {
      entry.pty.kill();
    } catch {
      // Pty handle already gone — onExit will fire eventually
    }
    // SIGKILL escalation if process hasn't exited in 3s (POSIX only —
    // node-pty on Windows throws "Signals not supported on windows" if a signal arg
    // is passed; conpty's kill() already terminates via Close so escalation is moot).
    if (!IS_WIN) {
      entry.killTimer = setTimeout(() => {
        try {
          entry.pty.kill('SIGKILL');
        } catch {
          /* gone */
        }
      }, 3000);
    }
    // Don't await onExit here; the caller wants a sync ack
    return true;
  }

  /** Called on app quit to make sure no PTY survives this process.
   *  At quit time we DO suppress further output (renderer is gone) — set killed=true.
   *  Escalate to SIGKILL immediately rather than waiting 3s grace. */
  disposeAll(): void {
    for (const entry of this.entries.values()) {
      if (entry.killed) continue;
      entry.killed = true;
      entry.killing = true;
      if (entry.killTimer !== null) clearTimeout(entry.killTimer);
      try {
        entry.pty.kill();
      } catch {
        /* ignore */
      }
      // No grace at app-quit — POSIX gets an immediate SIGKILL to drop SIGTERM-trapping
      // foreground processes; Windows kill() above already terminates conpty session.
      if (!IS_WIN) {
        try {
          entry.pty.kill('SIGKILL');
        } catch {
          /* ignore */
        }
      }
    }
    this.entries.clear();
  }

  /** Test / introspection only. */
  count(): number {
    return this.entries.size;
  }

  has(terminalId: string): boolean {
    return this.entries.has(terminalId);
  }
}

function clampDim(n: number): number {
  if (!Number.isFinite(n)) return 24;
  return Math.max(1, Math.min(500, Math.round(n)));
}

/** Process singleton. */
let _instance: PtyHost | null = null;
export function getPtyHost(): PtyHost {
  if (_instance === null) _instance = new PtyHost();
  return _instance;
}
