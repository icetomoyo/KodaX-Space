import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { create as createTar } from 'tar';

import {
  assertKodaxReleaseDependencyState,
  fetchRegistryTarball,
  KODAX_NATIVE_PACKAGE_FILES,
} from '../kodax-runtime-release-gate.mjs';

test('Registry tarball fetch fails with a bounded timeout', async () => {
  let aborted = false;
  const fetchImpl = (_resolved, { signal }) =>
    new Promise((_resolve, reject) => {
      signal.addEventListener(
        'abort',
        () => {
          aborted = true;
          reject(new Error('fetch aborted'));
        },
        { once: true },
      );
    });

  await assert.rejects(
    fetchRegistryTarball('https://registry.npmjs.org/example.tgz', {
      fetchImpl,
      timeoutMs: 10,
    }),
    /timed out after 10 ms/i,
  );
  assert.equal(aborted, true);
});

test('Registry tarball fetch honors the configured environment proxy', async () => {
  let dispatcher;
  const fetchImpl = async (_resolved, options) => {
    dispatcher = options.dispatcher;
    return new Response(Buffer.from('registry tarball'));
  };

  const tarball = await fetchRegistryTarball('https://registry.npmjs.org/example.tgz', {
    env: {
      HTTPS_PROXY: 'http://127.0.0.1:7897',
      NO_PROXY: '',
    },
    fetchImpl,
  });

  assert.equal(tarball.toString('utf8'), 'registry tarball');
  assert.equal(dispatcher?.constructor.name, 'EnvHttpProxyAgent');
});

test('a timed-out Registry proxy is destroyed instead of waiting forever for graceful close', async () => {
  let destroyedWith;
  const dispatcher = {
    close: () => new Promise(() => undefined),
    destroy: async (error) => {
      destroyedWith = error;
    },
  };
  const fetchImpl = (_resolved, { signal }) =>
    new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(new Error('fetch aborted')), { once: true });
    });

  await assert.rejects(
    fetchRegistryTarball('https://registry.npmjs.org/example.tgz', {
      env: { HTTPS_PROXY: 'http://127.0.0.1:7897' },
      fetchImpl,
      timeoutMs: 10,
      createProxyDispatcher: () => dispatcher,
    }),
    /timed out after 10 ms/i,
  );
  assert.match(destroyedWith?.message ?? '', /timed out after 10 ms/i);
});

test('invalid proxy configuration fails with safe pack context', async () => {
  await assert.rejects(
    fetchRegistryTarball('https://registry.npmjs.org/example.tgz', {
      env: { HTTPS_PROXY: 'not a url with credentials secret@example.test' },
    }),
    (error) => {
      assert.match(error.message, /^\[pack\] Cannot configure Registry proxy/);
      assert.doesNotMatch(error.message, /secret@example/);
      return true;
    },
  );
});

async function writeReleaseDependencyFixture(root, versions = {}) {
  const rootVersion = versions.root ?? '0.7.80';
  const desktopVersion = versions.desktop ?? rootVersion;
  const lockRootVersion = versions.lockRoot ?? rootVersion;
  const lockDesktopVersion = versions.lockDesktop ?? desktopVersion;
  const lockPackageVersion = versions.lockPackage ?? rootVersion;
  const installedVersion = versions.installed ?? rootVersion;
  let resolved =
    versions.resolved ??
    `https://registry.npmjs.org/@kodax-ai/kodax/-/kodax-${lockPackageVersion}.tgz`;
  let integrity = versions.integrity;
  await mkdir(path.join(root, 'apps', 'desktop'), { recursive: true });
  await mkdir(path.join(root, 'node_modules', '@kodax-ai', 'kodax'), { recursive: true });
  const packageJson = JSON.stringify({ name: '@kodax-ai/kodax', version: installedVersion });
  const runtimeBytes = 'export const runtimeContract = 1;\n';
  const tarballName = `kodax-ai-kodax-${lockPackageVersion}.tgz`;
  const tarballPath = path.join(root, 'fixtures', tarballName);
  const tarRoot = path.join(root, 'tar-root');
  await mkdir(path.join(tarRoot, 'package'), { recursive: true });
  await writeFile(path.join(tarRoot, 'package', 'package.json'), packageJson, 'utf8');
  await writeFile(path.join(tarRoot, 'package', 'runtime.js'), runtimeBytes, 'utf8');
  for (const relative of KODAX_NATIVE_PACKAGE_FILES) {
    if (relative === versions.omitNativeFile) continue;
    const target = path.join(tarRoot, 'package', ...relative.split('/'));
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, `fixture:${relative}\n`, 'utf8');
  }
  await mkdir(path.dirname(tarballPath), { recursive: true });
  await createTar({ gzip: true, file: tarballPath, cwd: tarRoot }, ['package']);
  const tarball = await readFile(tarballPath);
  if (versions.localTarball) {
    resolved = `file:fixtures/${tarballName}`;
    integrity ??= `sha512-${createHash('sha512').update(tarball).digest('base64')}`;
  } else {
    integrity ??= `sha512-${createHash('sha512').update(tarball).digest('base64')}`;
  }
  await writeFile(
    path.join(root, 'package.json'),
    JSON.stringify({ dependencies: { '@kodax-ai/kodax': rootVersion } }),
    'utf8',
  );
  await writeFile(
    path.join(root, 'apps', 'desktop', 'package.json'),
    JSON.stringify({ dependencies: { '@kodax-ai/kodax': desktopVersion } }),
    'utf8',
  );
  await writeFile(
    path.join(root, 'package-lock.json'),
    JSON.stringify({
      lockfileVersion: 3,
      packages: {
        '': { dependencies: { '@kodax-ai/kodax': lockRootVersion } },
        'apps/desktop': { dependencies: { '@kodax-ai/kodax': lockDesktopVersion } },
        'node_modules/@kodax-ai/kodax': {
          version: lockPackageVersion,
          resolved,
          integrity,
        },
      },
    }),
    'utf8',
  );
  await writeFile(
    path.join(root, 'node_modules', '@kodax-ai', 'kodax', 'package.json'),
    packageJson,
    'utf8',
  );
  await writeFile(
    path.join(root, 'node_modules', '@kodax-ai', 'kodax', 'runtime.js'),
    runtimeBytes,
    'utf8',
  );
  for (const relative of KODAX_NATIVE_PACKAGE_FILES) {
    if (relative === versions.omitNativeFile) continue;
    const target = path.join(
      root,
      'node_modules',
      '@kodax-ai',
      'kodax',
      ...relative.split('/'),
    );
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, `fixture:${relative}\n`, 'utf8');
  }
  return { tarballPath };
}

test('release dependency gate accepts one exact Registry version everywhere', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'space-kodax-dependency-gate-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const fixture = await writeReleaseDependencyFixture(root);

  const result = await assertKodaxReleaseDependencyState(
    root,
    path.join(root, 'node_modules', '@kodax-ai', 'kodax'),
    { readRegistryTarball: () => readFile(fixture.tarballPath) },
  );
  assert.equal(result.version, '0.7.80');
  assert.match(result.resolved, /registry\.npmjs\.org/);
  assert.match(result.integrity, /^sha512-/);
  assert.equal(result.source, 'registry');
});

test('release dependency gate rejects a KodaX package without the universal native bundle', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'space-kodax-dependency-gate-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const missing = 'dist/native/win32-x64/kodax-windows-sandbox.exe';
  const fixture = await writeReleaseDependencyFixture(root, { omitNativeFile: missing });

  await assert.rejects(
    assertKodaxReleaseDependencyState(
      root,
      path.join(root, 'node_modules', '@kodax-ai', 'kodax'),
      { readRegistryTarball: () => readFile(fixture.tarballPath) },
    ),
    /missing native artifact.*kodax-windows-sandbox\.exe/i,
  );
});

test('release dependency gate rejects a local test tarball by default', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'space-kodax-dependency-gate-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeReleaseDependencyFixture(root, { root: '0.7.80', localTarball: true });

  await assert.rejects(
    async () =>
      assertKodaxReleaseDependencyState(
        root,
        path.join(root, 'node_modules', '@kodax-ai', 'kodax'),
      ),
    /refusing local .* release mode/i,
  );
});

test('release dependency gate accepts an explicitly allowed integrity-pinned local test tarball', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'space-kodax-dependency-gate-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeReleaseDependencyFixture(root, { root: '0.7.80', localTarball: true });

  const result = await assertKodaxReleaseDependencyState(
    root,
    path.join(root, 'node_modules', '@kodax-ai', 'kodax'),
    { allowLocalTarball: true },
  );
  assert.equal(result.version, '0.7.80');
  assert.equal(result.source, 'local-tarball');
  assert.match(result.resolved, /^file:/);
});

test('release dependency gate rejects a local test tarball integrity mismatch', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'space-kodax-dependency-gate-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeReleaseDependencyFixture(root, {
    root: '0.7.80',
    localTarball: true,
    integrity: 'sha512-YWJjZA==',
  });

  await assert.rejects(
    async () =>
      assertKodaxReleaseDependencyState(
        root,
        path.join(root, 'node_modules', '@kodax-ai', 'kodax'),
        { allowLocalTarball: true },
      ),
    /integrity mismatch/i,
  );
});

test('release dependency gate rejects an unmarked installed-version mismatch', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'space-kodax-dependency-gate-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const fixture = await writeReleaseDependencyFixture(root, { installed: '0.7.76' });

  await assert.rejects(
    async () =>
      assertKodaxReleaseDependencyState(
        root,
        path.join(root, 'node_modules', '@kodax-ai', 'kodax'),
        { readRegistryTarball: () => readFile(fixture.tarballPath) },
      ),
    /installed=0\.7\.76/i,
  );
});

test('release dependency gate rejects manifest and lock drift', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'space-kodax-dependency-gate-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const fixture = await writeReleaseDependencyFixture(root, {
    desktop: '0.7.76',
    lockDesktop: '0.7.76',
  });

  await assert.rejects(
    async () =>
      assertKodaxReleaseDependencyState(
        root,
        path.join(root, 'node_modules', '@kodax-ai', 'kodax'),
        { readRegistryTarball: () => readFile(fixture.tarballPath) },
      ),
    /desktop=0\.7\.76/i,
  );
});

test('release dependency gate rejects same-version installed content drift', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'space-kodax-dependency-gate-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeReleaseDependencyFixture(root, { root: '0.7.80', localTarball: true });
  await writeFile(
    path.join(root, 'node_modules', '@kodax-ai', 'kodax', 'runtime.js'),
    'tampered but still version 0.7.80\n',
    'utf8',
  );

  await assert.rejects(
    async () =>
      assertKodaxReleaseDependencyState(
        root,
        path.join(root, 'node_modules', '@kodax-ai', 'kodax'),
        { allowLocalTarball: true },
      ),
    /installed KodaX content mismatch.*runtime\.js/i,
  );
});
