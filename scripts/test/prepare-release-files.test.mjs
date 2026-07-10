import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, test } from 'node:test';
import { parse, stringify } from 'yaml';
import { prepareReleaseFiles } from '../prepare-release-files.mjs';

const tempDirs = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

async function fixture() {
  const root = await fs.mkdtemp(path.join(tmpdir(), 'kodax-release-files-'));
  tempDirs.push(root);
  const artifactsDir = path.join(root, 'artifacts');
  const releaseDir = path.join(root, 'release');
  for (const platform of ['win', 'linux', 'mac-x64', 'mac-arm64']) {
    await fs.mkdir(path.join(artifactsDir, platform), { recursive: true });
  }
  return { artifactsDir, releaseDir };
}

async function writeArtifact(artifactsDir, platform, name, content = name) {
  await fs.writeFile(path.join(artifactsDir, platform, name), content, 'utf8');
}

function manifest(files) {
  return stringify({
    version: '0.1.30',
    files: files.map((url) => ({ url, sha512: `sha-${url}`, size: 123 })),
    path: files[0],
    sha512: `sha-${files[0]}`,
    releaseDate: '2026-07-10T00:00:00.000Z',
  });
}

async function writeCompleteFixture(artifactsDir) {
  const windows = ['KodaX-Space-Setup-0.1.30.exe', 'KodaX-Space-Portable-0.1.30.exe'];
  const linux = ['KodaX-Space-0.1.30-x86_64.AppImage', 'KodaX-Space-0.1.30-amd64.deb'];
  const macX64 = ['KodaX-Space-0.1.30-x64.zip', 'KodaX-Space-0.1.30-x64.dmg'];
  const macArm64 = ['KodaX-Space-0.1.30-arm64.zip', 'KodaX-Space-0.1.30-arm64.dmg'];
  for (const name of windows) await writeArtifact(artifactsDir, 'win', name);
  for (const name of linux) await writeArtifact(artifactsDir, 'linux', name);
  for (const name of macX64) await writeArtifact(artifactsDir, 'mac-x64', name);
  for (const name of macArm64) await writeArtifact(artifactsDir, 'mac-arm64', name);
  await writeArtifact(artifactsDir, 'win', 'latest.yml', manifest([windows[0]]));
  await writeArtifact(artifactsDir, 'linux', 'latest-linux.yml', manifest(linux));
  await writeArtifact(artifactsDir, 'mac-x64', 'latest-mac.yml', manifest(macX64));
  await writeArtifact(artifactsDir, 'mac-arm64', 'latest-mac.yml', manifest(macArm64));
}

test('stages updater-compatible assets and merges both macOS architectures', async () => {
  const { artifactsDir, releaseDir } = await fixture();
  await writeCompleteFixture(artifactsDir);

  const staged = await prepareReleaseFiles({ artifactsDir, releaseDir, expectedTag: 'v0.1.30' });
  const macManifest = parse(await fs.readFile(path.join(releaseDir, 'latest-mac.yml'), 'utf8'));

  assert.equal(staged.length, 11);
  assert.deepEqual(
    macManifest.files.map((file) => file.url),
    [
      'KodaX-Space-0.1.30-x64.zip',
      'KodaX-Space-0.1.30-x64.dmg',
      'KodaX-Space-0.1.30-arm64.zip',
      'KodaX-Space-0.1.30-arm64.dmg',
    ],
  );
  assert.equal(macManifest.path, 'KodaX-Space-0.1.30-x64.zip');
});

test('rejects an updater manifest whose URL has no identically named asset', async () => {
  const { artifactsDir, releaseDir } = await fixture();
  await writeCompleteFixture(artifactsDir);
  await fs.rename(
    path.join(artifactsDir, 'win', 'KodaX-Space-Setup-0.1.30.exe'),
    path.join(artifactsDir, 'win', 'KodaX.Space-Setup-0.1.30.exe'),
  );

  await assert.rejects(
    prepareReleaseFiles({ artifactsDir, releaseDir, expectedTag: 'v0.1.30' }),
    /latest\.yml references missing release asset KodaX-Space-Setup-0\.1\.30\.exe/,
  );
});

test('rejects a macOS release without an updater ZIP for each architecture', async () => {
  const { artifactsDir, releaseDir } = await fixture();
  await writeCompleteFixture(artifactsDir);
  await fs.rm(path.join(artifactsDir, 'mac-arm64', 'KodaX-Space-0.1.30-arm64.zip'));
  await writeArtifact(
    artifactsDir,
    'mac-arm64',
    'latest-mac.yml',
    manifest(['KodaX-Space-0.1.30-arm64.dmg']),
  );

  await assert.rejects(
    prepareReleaseFiles({ artifactsDir, releaseDir, expectedTag: 'v0.1.30' }),
    /missing required updater file/,
  );
});

test('rejects unexpected updater manifests instead of publishing them', async () => {
  const { artifactsDir, releaseDir } = await fixture();
  await writeCompleteFixture(artifactsDir);
  await writeArtifact(
    artifactsDir,
    'linux',
    'latest-experimental.yml',
    manifest(['KodaX-Space-0.1.30-x86_64.AppImage']),
  );

  await assert.rejects(
    prepareReleaseFiles({ artifactsDir, releaseDir, expectedTag: 'v0.1.30' }),
    /unexpected updater manifest: latest-experimental\.yml/,
  );
});
