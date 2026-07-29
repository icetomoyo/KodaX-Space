import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { assertKodaxReleaseDependencyState } from '../kodax-runtime-release-gate.mjs';

async function writeReleaseDependencyFixture(root, versions = {}) {
  const rootVersion = versions.root ?? '0.7.78';
  const desktopVersion = versions.desktop ?? rootVersion;
  const lockRootVersion = versions.lockRoot ?? rootVersion;
  const lockDesktopVersion = versions.lockDesktop ?? desktopVersion;
  const lockPackageVersion = versions.lockPackage ?? rootVersion;
  const installedVersion = versions.installed ?? rootVersion;
  await mkdir(path.join(root, 'apps', 'desktop'), { recursive: true });
  await mkdir(path.join(root, 'node_modules', '@kodax-ai', 'kodax'), { recursive: true });
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
          resolved: `https://registry.npmjs.org/@kodax-ai/kodax/-/kodax-${lockPackageVersion}.tgz`,
          integrity: 'sha512-YWJjZA==',
        },
      },
    }),
    'utf8',
  );
  await writeFile(
    path.join(root, 'node_modules', '@kodax-ai', 'kodax', 'package.json'),
    JSON.stringify({ name: '@kodax-ai/kodax', version: installedVersion }),
    'utf8',
  );
}

test('release dependency gate accepts one exact Registry version everywhere', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'space-kodax-dependency-gate-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeReleaseDependencyFixture(root);

  const result = assertKodaxReleaseDependencyState(
    root,
    path.join(root, 'node_modules', '@kodax-ai', 'kodax'),
  );
  assert.equal(result.version, '0.7.78');
  assert.match(result.resolved, /registry\.npmjs\.org/);
  assert.match(result.integrity, /^sha512-/);
});

test('release dependency gate rejects an unmarked installed-version mismatch', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'space-kodax-dependency-gate-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeReleaseDependencyFixture(root, { installed: '0.7.76' });

  assert.throws(
    () =>
      assertKodaxReleaseDependencyState(
        root,
        path.join(root, 'node_modules', '@kodax-ai', 'kodax'),
      ),
    /installed=0\.7\.76/i,
  );
});

test('release dependency gate rejects manifest and lock drift', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'space-kodax-dependency-gate-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeReleaseDependencyFixture(root, { desktop: '0.7.76', lockDesktop: '0.7.76' });

  assert.throws(
    () =>
      assertKodaxReleaseDependencyState(
        root,
        path.join(root, 'node_modules', '@kodax-ai', 'kodax'),
      ),
    /desktop=0\.7\.76/i,
  );
});
