import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { inspectKodaxDevLink, KODAX_DEV_LINK_MARKER } from '../kodax-dev-link-state.mjs';

async function createFixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'space-kodax-link-state-'));
  const spaceRoot = path.join(root, 'space');
  const sdkDir = path.join(spaceRoot, 'node_modules', '@kodax-ai', 'kodax');
  const sourceRoot = path.join(root, 'kodax-source');
  await mkdir(sdkDir, { recursive: true });
  await mkdir(sourceRoot, { recursive: true });
  t.after(() => rm(root, { recursive: true, force: true }));
  return { spaceRoot, sdkDir, sourceRoot };
}

test('published SDK directory is not classified as a development link', async (t) => {
  const { spaceRoot, sdkDir } = await createFixture(t);
  await writeFile(path.join(sdkDir, 'package.json'), '{}', 'utf8');

  assert.deepEqual(inspectKodaxDevLink(spaceRoot, sdkDir), { linked: false });
});

test('canonicalized ancestor path is not classified as a package-root link', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'space-kodax-ancestor-alias-'));
  const realSpaceRoot = path.join(root, 'real-space');
  const aliasSpaceRoot = path.join(root, 'alias-space');
  const realSdkDir = path.join(realSpaceRoot, 'node_modules', '@kodax-ai', 'kodax');
  await mkdir(realSdkDir, { recursive: true });
  await writeFile(path.join(realSdkDir, 'package.json'), '{}', 'utf8');
  await symlink(realSpaceRoot, aliasSpaceRoot, process.platform === 'win32' ? 'junction' : 'dir');
  t.after(() => rm(root, { recursive: true, force: true }));

  const sdkViaAncestorAlias = path.join(aliasSpaceRoot, 'node_modules', '@kodax-ai', 'kodax');
  assert.deepEqual(inspectKodaxDevLink(aliasSpaceRoot, sdkViaAncestorAlias), {
    linked: false,
  });
});

test('link-kodax staging marker is always classified as a development link', async (t) => {
  const { spaceRoot, sdkDir } = await createFixture(t);
  await writeFile(path.join(sdkDir, KODAX_DEV_LINK_MARKER), '', 'utf8');

  assert.deepEqual(inspectKodaxDevLink(spaceRoot, sdkDir), {
    linked: true,
    layout: 'staging',
  });
});

test('legacy staging with an external nested junction is detected without a marker', async (t) => {
  const { spaceRoot, sdkDir, sourceRoot } = await createFixture(t);
  const sourceDist = path.join(sourceRoot, 'dist');
  await mkdir(sourceDist, { recursive: true });
  await symlink(
    sourceDist,
    path.join(sdkDir, 'dist'),
    process.platform === 'win32' ? 'junction' : 'dir',
  );

  assert.deepEqual(inspectKodaxDevLink(spaceRoot, sdkDir), {
    linked: true,
    layout: 'staging',
  });
});

test('package-root junction is detected even when its target stays inside Space', async (t) => {
  const { spaceRoot, sdkDir } = await createFixture(t);
  const localCopy = path.join(spaceRoot, 'local-kodax-copy');
  await mkdir(localCopy, { recursive: true });
  await rm(sdkDir, { recursive: true, force: true });
  await symlink(localCopy, sdkDir, process.platform === 'win32' ? 'junction' : 'dir');

  assert.deepEqual(inspectKodaxDevLink(spaceRoot, sdkDir), {
    linked: true,
    layout: 'direct',
    target: await import('node:fs/promises').then((fs) => fs.readlink(sdkDir)),
    type: process.platform === 'win32' ? 'junction' : 'dir',
  });
});

test('nested staging junction is detected even when its target stays inside Space', async (t) => {
  const { spaceRoot, sdkDir } = await createFixture(t);
  const localDist = path.join(spaceRoot, 'local-kodax-dist');
  await mkdir(localDist, { recursive: true });
  await symlink(
    localDist,
    path.join(sdkDir, 'dist'),
    process.platform === 'win32' ? 'junction' : 'dir',
  );

  assert.deepEqual(inspectKodaxDevLink(spaceRoot, sdkDir), {
    linked: true,
    layout: 'staging',
  });
});
