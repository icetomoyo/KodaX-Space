import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createShellHandlers, type ShellHandlerDeps } from '../ipc/shell.js';

function makeDeps(overrides: Partial<ShellHandlerDeps> = {}): {
  readonly deps: ShellHandlerDeps;
  readonly shown: string[];
  readonly openedPaths: string[];
  readonly opened: string[];
  readonly projectRoot: string;
  readonly outsideRoot: string;
} {
  const projectRoot = path.join(process.cwd(), 'tmp-shell-project');
  const outsideRoot = path.join(process.cwd(), 'tmp-shell-outside');
  const kodaxDir = path.join(process.cwd(), 'tmp-kodax');
  const spaceDir = path.join(kodaxDir, 'space');
  const shown: string[] = [];
  const openedPaths: string[] = [];
  const opened: string[] = [];
  const realpaths = new Map<string, string>([
    [projectRoot, projectRoot],
    [outsideRoot, outsideRoot],
    [kodaxDir, kodaxDir],
    [spaceDir, spaceDir],
  ]);

  const deps: ShellHandlerDeps = {
    realpath: async (target) => realpaths.get(target) ?? target,
    access: async () => {},
    stat: async () => ({ isDirectory: () => true }),
    listProjects: async () => [{ path: projectRoot }],
    assertProjectAllowed: async (root) => {
      if (root !== projectRoot) throw new Error('project not allowed');
    },
    resolveInsideProject: async (root, relativePath) => path.join(root, relativePath),
    getKodaxDir: () => kodaxDir,
    getSpaceDataDir: () => spaceDir,
    showItemInFolder: (target) => {
      shown.push(target);
    },
    openPath: async (target) => {
      openedPaths.push(target);
      return '';
    },
    openExternal: (url) => {
      opened.push(url);
    },
    ...overrides,
  };
  return { deps, shown, openedPaths, opened, projectRoot, outsideRoot };
}

test('shell.openExternal opens only http and https URLs', async () => {
  const { deps, opened } = makeDeps();
  const handlers = createShellHandlers(deps);

  assert.deepEqual(await handlers.openExternal({ url: 'https://example.com/docs' }), {
    opened: true,
  });
  assert.deepEqual(await handlers.openExternal({ url: 'http://example.com/docs' }), {
    opened: true,
  });
  assert.deepEqual(await handlers.openExternal({ url: 'file:///C:/Windows/System32/calc.exe' }), {
    opened: false,
  });
  assert.deepEqual(await handlers.openExternal({ url: 'javascript:alert(1)' }), { opened: false });
  assert.deepEqual(opened, ['https://example.com/docs', 'http://example.com/docs']);
});

test('shell.revealPath resolves relative paths through the project allowlist', async () => {
  const { deps, shown, projectRoot } = makeDeps();
  const handlers = createShellHandlers(deps);
  const target = path.join(projectRoot, 'src', 'index.ts');

  assert.deepEqual(await handlers.revealPath({ path: 'src/index.ts', projectRoot }), {
    revealed: true,
  });
  assert.deepEqual(shown, [target]);
});

test('shell.openDirectory enters an allowed project directory instead of selecting it in the parent', async () => {
  const { deps, openedPaths, shown, projectRoot } = makeDeps();
  const handlers = createShellHandlers(deps);

  assert.deepEqual(await handlers.openDirectory({ path: projectRoot }), { opened: true });
  assert.deepEqual(openedPaths, [projectRoot]);
  assert.deepEqual(shown, []);
});

test('shell.openDirectory rejects files and shell open failures', async () => {
  const { deps, openedPaths, projectRoot } = makeDeps({
    stat: async () => ({ isDirectory: () => false }),
  });
  const handlers = createShellHandlers(deps);

  assert.deepEqual(await handlers.openDirectory({ path: projectRoot }), { opened: false });
  assert.deepEqual(openedPaths, []);

  const failed = createShellHandlers({
    ...deps,
    stat: async () => ({ isDirectory: () => true }),
    openPath: async () => 'Explorer rejected the path',
  });
  assert.deepEqual(await failed.openDirectory({ path: projectRoot }), { opened: false });
});

test('shell.revealPath rejects allowlist-external absolute paths', async () => {
  const { deps, shown, outsideRoot } = makeDeps();
  const handlers = createShellHandlers(deps);
  const target = path.join(outsideRoot, 'secret.txt');

  assert.deepEqual(await handlers.revealPath({ path: target }), {
    revealed: false,
    reason: 'not-allowed',
  });
  assert.deepEqual(shown, []);
});

test('shell.revealPath rejects symlink-style realpath escapes', async () => {
  const { deps, shown, projectRoot, outsideRoot } = makeDeps({
    realpath: async (target) => {
      const link = path.join(process.cwd(), 'tmp-shell-project', 'link.txt');
      if (target === link) return path.join(process.cwd(), 'tmp-shell-outside', 'secret.txt');
      return target;
    },
  });
  const handlers = createShellHandlers(deps);
  const target = path.join(projectRoot, 'link.txt');

  assert.deepEqual(await handlers.revealPath({ path: target }), {
    revealed: false,
    reason: 'not-allowed',
  });
  assert.deepEqual(shown, []);
  assert.ok(outsideRoot.length > 0);
});

test('shell.revealPath rejects network paths and missing files', async () => {
  const missing = path.join(process.cwd(), 'tmp-shell-project', 'missing.txt');
  const { deps, shown } = makeDeps({
    access: async (target) => {
      if (target === missing) {
        throw Object.assign(new Error('missing'), { code: 'ENOENT' });
      }
    },
  });
  const handlers = createShellHandlers(deps);

  assert.deepEqual(await handlers.revealPath({ path: '\\\\server\\share\\secret.txt' }), {
    revealed: false,
    reason: 'not-allowed',
  });
  assert.deepEqual(await handlers.revealPath({ path: missing }), {
    revealed: false,
    reason: 'not-found',
  });
  assert.deepEqual(shown, []);
});

test('shell.revealPath distinguishes permission and shell failures from missing files', async () => {
  const permissionError = Object.assign(new Error('access denied'), { code: 'EACCES' });
  const { deps, projectRoot } = makeDeps({
    access: async () => {
      throw permissionError;
    },
  });
  const target = path.join(projectRoot, 'report.docx');

  assert.deepEqual(await createShellHandlers(deps).revealPath({ path: target }), {
    revealed: false,
    reason: 'not-allowed',
  });

  const shellFailure = createShellHandlers({
    ...deps,
    access: async () => {},
    showItemInFolder: () => {
      throw new Error('shell unavailable');
    },
  });
  assert.deepEqual(await shellFailure.revealPath({ path: target }), {
    revealed: false,
    reason: 'failed',
  });
});
