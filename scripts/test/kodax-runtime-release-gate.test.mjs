import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { create as createTar } from 'tar';

import { assertKodaxReleaseDependencyState } from '../kodax-runtime-release-gate.mjs';

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
