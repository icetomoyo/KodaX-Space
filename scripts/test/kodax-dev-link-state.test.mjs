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
