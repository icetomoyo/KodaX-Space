import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse, stringify } from 'yaml';

const RELEASE_FILE_PATTERN =
  /^(?:latest(?:-[a-z0-9-]+)?\.yml|.+\.(?:exe|dmg|AppImage|deb|zip|blockmap))$/i;
const VERSION_PATTERN = /^v?(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)$/;

async function listFiles(root) {
  const files = [];
  const pending = [root];
  while (pending.length > 0) {
    const current = pending.pop();
    for (const entry of await fs.readdir(current, { withFileTypes: true })) {
      const absolutePath = path.join(current, entry.name);
      if (entry.isDirectory()) pending.push(absolutePath);
      else if (entry.isFile()) files.push(absolutePath);
    }
  }
  return files;
}

function readManifest(raw, source, expectedVersion) {
  const manifest = parse(raw);
  if (!manifest || typeof manifest !== 'object') {
    throw new Error(`${source} is not a YAML object`);
  }
  if (manifest.version !== expectedVersion) {
    throw new Error(
      `${source} has version ${String(manifest.version)}, expected ${expectedVersion}`,
    );
  }
  if (!Array.isArray(manifest.files) || manifest.files.length === 0) {
    throw new Error(`${source} does not contain release files`);
  }
  for (const file of manifest.files) {
    if (!file || typeof file.url !== 'string' || typeof file.sha512 !== 'string') {
      throw new Error(`${source} contains an invalid file entry`);
    }
  }
  return manifest;
}

function fileRank(file) {
  const url = file.url.toLowerCase();
  const arch = url.includes('arm64') ? 1 : url.includes('x64') ? 0 : 2;
  const format = url.endsWith('.zip') ? 0 : url.endsWith('.dmg') ? 1 : 2;
  return arch * 10 + format;
}

async function mergeMacManifests(manifestPaths, expectedVersion) {
  if (manifestPaths.length < 2) {
    throw new Error(
      `expected separate x64 and arm64 latest-mac.yml files, found ${manifestPaths.length}`,
    );
  }
  const manifests = await Promise.all(
    manifestPaths.map(async (manifestPath) =>
      readManifest(await fs.readFile(manifestPath, 'utf8'), manifestPath, expectedVersion),
    ),
  );
  const filesByUrl = new Map();
  for (const manifest of manifests) {
    for (const file of manifest.files) {
      const previous = filesByUrl.get(file.url);
      if (previous && previous.sha512 !== file.sha512) {
        throw new Error(`conflicting checksums for ${file.url}`);
      }
      filesByUrl.set(file.url, file);
    }
  }
  const files = [...filesByUrl.values()].sort((a, b) => fileRank(a) - fileRank(b));
  for (const required of [/-x64\.zip$/i, /-arm64\.zip$/i]) {
    if (!files.some((file) => required.test(file.url))) {
      throw new Error(`latest-mac.yml is missing required updater file ${required}`);
    }
  }

  const primary = files.find((file) => /-x64\.zip$/i.test(file.url)) ?? files[0];
  const releaseDates = manifests
    .map((manifest) => manifest.releaseDate)
    .filter((value) => typeof value === 'string' && !Number.isNaN(Date.parse(value)))
    .sort();
  return {
    ...manifests[0],
    version: expectedVersion,
    files,
    path: primary.url,
    sha512: primary.sha512,
    releaseDate: releaseDates.at(-1) ?? manifests[0].releaseDate,
  };
}

async function validateReleaseFiles(releaseDir, expectedVersion) {
  const names = new Set(await fs.readdir(releaseDir));
  for (const manifestName of ['latest.yml', 'latest-linux.yml', 'latest-mac.yml']) {
    if (!names.has(manifestName)) throw new Error(`missing ${manifestName}`);
    const manifest = readManifest(
      await fs.readFile(path.join(releaseDir, manifestName), 'utf8'),
      manifestName,
      expectedVersion,
    );
    for (const file of manifest.files) {
      if (path.basename(file.url) !== file.url || !names.has(file.url)) {
        throw new Error(`${manifestName} references missing release asset ${file.url}`);
      }
    }
  }

  const escapedVersion = expectedVersion.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const requiredAssets = [
    new RegExp(`^KodaX-Space-Setup-${escapedVersion}\\.exe$`),
    new RegExp(`^KodaX-Space-Portable-${escapedVersion}\\.exe$`),
    new RegExp(`^KodaX-Space-${escapedVersion}-x86_64\\.AppImage$`),
    new RegExp(`^KodaX-Space-${escapedVersion}-amd64\\.deb$`),
    new RegExp(`^KodaX-Space-${escapedVersion}-x64\\.dmg$`),
    new RegExp(`^KodaX-Space-${escapedVersion}-arm64\\.dmg$`),
    new RegExp(`^KodaX-Space-${escapedVersion}-x64\\.zip$`),
    new RegExp(`^KodaX-Space-${escapedVersion}-arm64\\.zip$`),
  ];
  for (const required of requiredAssets) {
    if (![...names].some((name) => required.test(name))) {
      throw new Error(`missing required release asset ${required}`);
    }
  }
  for (const name of names) {
    if (
      name.startsWith('latest') &&
      !['latest.yml', 'latest-linux.yml', 'latest-mac.yml'].includes(name)
    ) {
      throw new Error(`unexpected updater manifest: ${name}`);
    }
    if (!name.startsWith('latest') && (!name.startsWith('KodaX-Space-') || /\s/.test(name))) {
      throw new Error(`release asset has updater-incompatible name: ${name}`);
    }
  }
}

export async function prepareReleaseFiles({ artifactsDir, releaseDir, expectedTag }) {
  const versionMatch = VERSION_PATTERN.exec(expectedTag);
  if (!versionMatch) throw new Error(`invalid release tag: ${expectedTag}`);
  const expectedVersion = versionMatch[1];
  const artifactFiles = (await listFiles(artifactsDir)).filter((file) =>
    RELEASE_FILE_PATTERN.test(path.basename(file)),
  );
  if (artifactFiles.length === 0) throw new Error(`no release files found under ${artifactsDir}`);

  await fs.mkdir(releaseDir, { recursive: true });
  const existing = await fs.readdir(releaseDir);
  if (existing.length > 0) throw new Error(`release directory is not empty: ${releaseDir}`);

  const filesByName = new Map();
  for (const artifactFile of artifactFiles) {
    const name = path.basename(artifactFile);
    const paths = filesByName.get(name) ?? [];
    paths.push(artifactFile);
    filesByName.set(name, paths);
  }

  for (const [name, paths] of filesByName) {
    if (name === 'latest-mac.yml') continue;
    if (paths.length !== 1) throw new Error(`duplicate release asset ${name}`);
    await fs.copyFile(paths[0], path.join(releaseDir, name));
  }
  const macManifest = await mergeMacManifests(
    filesByName.get('latest-mac.yml') ?? [],
    expectedVersion,
  );
  await fs.writeFile(path.join(releaseDir, 'latest-mac.yml'), stringify(macManifest), 'utf8');
  await validateReleaseFiles(releaseDir, expectedVersion);

  const staged = (await fs.readdir(releaseDir)).sort();
  console.log(`[release] staged ${staged.length} validated files for ${expectedTag}`);
  for (const name of staged) console.log(`[release]   ${name}`);
  return staged;
}

const entryPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (entryPath === fileURLToPath(import.meta.url)) {
  const [artifactsDir, releaseDir, expectedTag] = process.argv.slice(2);
  if (!artifactsDir || !releaseDir || !expectedTag) {
    console.error('Usage: node scripts/prepare-release-files.mjs <artifacts> <release> <tag>');
    process.exit(2);
  }
  prepareReleaseFiles({
    artifactsDir: path.resolve(artifactsDir),
    releaseDir: path.resolve(releaseDir),
    expectedTag,
  }).catch((error) => {
    console.error(`[release] ${error instanceof Error ? error.stack : String(error)}`);
    process.exit(1);
  });
}
