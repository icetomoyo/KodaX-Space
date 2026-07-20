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

async function isAbsoluteRevealAllowed(target: string, deps: ShellHandlerDeps): Promise<boolean> {
  if (isNetworkPath(target)) return false;

  const roots = [deps.getKodaxDir(), deps.getSpaceDataDir()];
  try {
    for (const project of await deps.listProjects()) roots.push(project.path);
  } catch {
    // A stale project allowlist should not widen access.
  }

  let realTarget: string;
  try {
    realTarget = await deps.realpath(target);
  } catch {
    return false;
  }
  if (isNetworkPath(realTarget)) return false;

  for (const root of roots) {
    try {
      if (isWithin(realTarget, await deps.realpath(root), deps.isWin ?? IS_WIN)) return true;
    } catch {
      // Stale roots are ignored.
    }
  }
  return false;
}

async function resolveRevealTarget(
  input: { readonly path: string; readonly projectRoot?: string },
  deps: ShellHandlerDeps,
): Promise<string | null> {
  if (path.isAbsolute(input.path)) {
    return (await isAbsoluteRevealAllowed(input.path, deps)) ? input.path : null;
  }
  if (input.projectRoot === undefined) return null;
  await deps.assertProjectAllowed(input.projectRoot);
  return deps.resolveInsideProject(input.projectRoot, input.path);
}

export function createShellHandlers(deps: ShellHandlerDeps): {
  readonly revealPath: (input: {
    readonly path: string;
    readonly projectRoot?: string;
  }) => Promise<{ revealed: boolean }>;
  readonly openDirectory: (input: {
    readonly path: string;
    readonly projectRoot?: string;
  }) => Promise<{ opened: boolean }>;
  readonly openExternal: (input: { readonly url: string }) => Promise<{ opened: boolean }>;
} {
  return {
    async revealPath(input) {
      let target: string | null;
      try {
        target = await resolveRevealTarget(input, deps);
      } catch {
        return { revealed: false };
      }
      if (target === null) return { revealed: false };
      try {
        await deps.access(target);
      } catch {
        return { revealed: false };
      }
      deps.showItemInFolder(target);
      return { revealed: true };
    },

    async openDirectory(input) {
      let target: string | null;
      try {
        target = await resolveRevealTarget(input, deps);
      } catch {
        return { opened: false };
      }
      if (target === null) return { opened: false };

      try {
        const targetStat = await deps.stat(target);
        if (!targetStat.isDirectory()) return { opened: false };
        const errorMessage = await deps.openPath(target);
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
