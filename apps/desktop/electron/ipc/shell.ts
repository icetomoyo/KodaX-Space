// Shell IPC handlers: reveal a file, open an allowed directory, or open an external URL.
//
// openPath is exposed only behind a directory stat check. Arbitrary local files
// remain blocked because opening .exe/.bat/etc via OS file associations is an RCE surface.
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { createRequire } from 'node:module';
import { registerChannel } from './register.js';
import { resolveInsideProject } from './files-core.js';
import { projectStore } from '../projects/store.js';
import { getKodaxDir, getSpaceDataDir } from '../kodax/data-paths.js';

const IS_WIN = process.platform === 'win32';

export interface ShellHandlerDeps {
  readonly isWin?: boolean;
  readonly realpath: (target: string) => Promise<string>;
  readonly access: (target: string) => Promise<void>;
  readonly stat: (target: string) => Promise<{ readonly isDirectory: () => boolean }>;
  readonly listProjects: () => Promise<readonly { readonly path: string }[]>;
  readonly assertProjectAllowed: (projectRoot: string) => Promise<void>;
  readonly resolveInsideProject: (projectRoot: string, relativePath: string) => Promise<string>;
  readonly getKodaxDir: () => string;
  readonly getSpaceDataDir: () => string;
  readonly showItemInFolder: (target: string) => void;
  readonly openPath: (target: string) => Promise<string>;
  readonly openExternal: (url: string) => Promise<void> | void;
}

function getShell(): typeof import('electron').shell {
  // Lazy require keeps node:test importable without an Electron runtime.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const meta = typeof require !== 'undefined' ? null : (import.meta as any);
  const req = meta ? createRequire(meta.url) : require;
  return (req('electron') as typeof import('electron')).shell;
}

function isNetworkPath(target: string): boolean {
  return target.startsWith('\\\\') || target.startsWith('//');
}

function isWithin(child: string, parent: string, isWin = IS_WIN): boolean {
  const norm = (s: string): string => {
    const resolved = path.resolve(s);
    return isWin ? resolved.toLowerCase() : resolved;
  };
  const c = norm(child);
  const p = norm(parent);
  if (c === p) return true;
  return c.startsWith(p.endsWith(path.sep) ? p : p + path.sep);
}

type RevealFailureReason = 'not-found' | 'not-allowed' | 'failed';

type ResolveRevealTargetResult =
  | { readonly ok: true; readonly target: string }
  | { readonly ok: false; readonly reason: RevealFailureReason };

function fsFailureReason(error: unknown): RevealFailureReason {
  const code =
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof (error as { readonly code?: unknown }).code === 'string'
      ? (error as { readonly code: string }).code
      : null;
  if (code === 'ENOENT' || code === 'ENOTDIR') return 'not-found';
  if (code === 'EACCES' || code === 'EPERM') return 'not-allowed';
  return 'failed';
}

async function resolveAbsoluteRevealTarget(
  target: string,
  deps: ShellHandlerDeps,
): Promise<ResolveRevealTargetResult> {
  if (isNetworkPath(target)) return { ok: false, reason: 'not-allowed' };

  const roots = [deps.getKodaxDir(), deps.getSpaceDataDir()];
  try {
    for (const project of await deps.listProjects()) roots.push(project.path);
  } catch {
    // A stale project allowlist should not widen access.
  }

  const allowedRoots: { readonly lexical: string; readonly real: string }[] = [];
  for (const root of roots) {
    try {
      allowedRoots.push({ lexical: root, real: await deps.realpath(root) });
    } catch {
      // Stale roots are ignored.
    }
  }

  const isLexicallyAllowed = allowedRoots.some(
    (root) =>
      isWithin(target, root.lexical, deps.isWin ?? IS_WIN) ||
      isWithin(target, root.real, deps.isWin ?? IS_WIN),
  );
  if (!isLexicallyAllowed) return { ok: false, reason: 'not-allowed' };

  let realTarget: string;
  try {
    realTarget = await deps.realpath(target);
  } catch (error) {
    return { ok: false, reason: fsFailureReason(error) };
  }
  if (isNetworkPath(realTarget)) return { ok: false, reason: 'not-allowed' };

  if (allowedRoots.some((root) => isWithin(realTarget, root.real, deps.isWin ?? IS_WIN))) {
    return { ok: true, target };
  }
  return { ok: false, reason: 'not-allowed' };
}

async function resolveRevealTarget(
  input: { readonly path: string; readonly projectRoot?: string },
  deps: ShellHandlerDeps,
): Promise<ResolveRevealTargetResult> {
  if (path.isAbsolute(input.path)) {
    return resolveAbsoluteRevealTarget(input.path, deps);
  }
  if (input.projectRoot === undefined) return { ok: false, reason: 'not-allowed' };
  try {
    await deps.assertProjectAllowed(input.projectRoot);
    return {
      ok: true,
      target: await deps.resolveInsideProject(input.projectRoot, input.path),
    };
  } catch (error) {
    const reason = fsFailureReason(error);
    return { ok: false, reason: reason === 'failed' ? 'not-allowed' : reason };
  }
}

export function createShellHandlers(deps: ShellHandlerDeps): {
  readonly revealPath: (input: {
    readonly path: string;
    readonly projectRoot?: string;
  }) => Promise<{ readonly revealed: boolean; readonly reason?: RevealFailureReason }>;
  readonly openDirectory: (input: {
    readonly path: string;
    readonly projectRoot?: string;
  }) => Promise<{ opened: boolean }>;
  readonly openExternal: (input: { readonly url: string }) => Promise<{ opened: boolean }>;
} {
  return {
    async revealPath(input) {
      const resolved = await resolveRevealTarget(input, deps);
      if (!resolved.ok) return { revealed: false, reason: resolved.reason };
      try {
        await deps.access(resolved.target);
      } catch (error) {
        return { revealed: false, reason: fsFailureReason(error) };
      }
      try {
        deps.showItemInFolder(resolved.target);
      } catch {
        return { revealed: false, reason: 'failed' };
      }
      return { revealed: true };
    },

    async openDirectory(input) {
      const resolved = await resolveRevealTarget(input, deps);
      if (!resolved.ok) return { opened: false };

      try {
        const targetStat = await deps.stat(resolved.target);
        if (!targetStat.isDirectory()) return { opened: false };
        const errorMessage = await deps.openPath(resolved.target);
        return { opened: errorMessage.length === 0 };
      } catch {
        return { opened: false };
      }
    },

    async openExternal(input) {
      let parsed: URL;
      try {
        parsed = new URL(input.url);
      } catch {
        return { opened: false };
      }
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return { opened: false };
      await deps.openExternal(input.url);
      return { opened: true };
    },
  };
}

function defaultShellDeps(): ShellHandlerDeps {
  return {
    realpath: fs.realpath,
    access: fs.access,
    stat: fs.stat,
    listProjects: () => projectStore.list(),
    assertProjectAllowed: async (projectRoot) => {
      await projectStore.assertAllowed(projectRoot);
    },
    resolveInsideProject,
    getKodaxDir,
    getSpaceDataDir,
    showItemInFolder: (target) => getShell().showItemInFolder(target),
    openPath: (target) => getShell().openPath(target),
    openExternal: (url) => getShell().openExternal(url),
  };
}

export function registerShellChannels(): void {
  const handlers = createShellHandlers(defaultShellDeps());

  registerChannel('shell.revealPath', (input) => handlers.revealPath(input));
  registerChannel('shell.openDirectory', (input) => handlers.openDirectory(input));
  registerChannel('shell.openExternal', (input) => handlers.openExternal(input));
}
