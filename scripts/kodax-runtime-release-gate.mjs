import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, readdirSync, readlinkSync } from 'node:fs';
import path from 'node:path';
import { Parser } from 'tar';

const KODAX_PACKAGE = '@kodax-ai/kodax';

function readJson(packageFile, label) {
  try {
    return JSON.parse(readFileSync(packageFile, 'utf8'));
  } catch (error) {
    throw new Error(`[pack] Cannot read ${label} at ${packageFile}.`, {
      cause: error,
    });
  }
}

function exactVersion(value, label) {
  const reference = String(value ?? '').trim();
  const exactSemVer = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
  if (exactSemVer.test(reference)) return reference;

  const normalizedReference = reference.replaceAll('\\', '/');
  const localTarball = normalizedReference.match(
    /(?:^|\/)kodax-ai-kodax-(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)\.tgz$/,
  );
  if (reference.startsWith('file:') && localTarball) return localTarball[1];

  {
    throw new Error(
      `[pack] ${label} must pin ${KODAX_PACKAGE} to an exact SemVer or its versioned local ` +
        `candidate tarball; found ${reference || '(missing)'}.`,
    );
  }
}

function lockedTarballEntries(tarball) {
  const entries = new Map();
  let parseError;
  const parser = new Parser({
    strict: true,
    onReadEntry(entry) {
      const normalized = entry.path.replaceAll('\\', '/');
      if (!normalized.startsWith('package/')) {
        parseError = new Error(`[pack] Locked KodaX tarball contains an invalid entry: ${entry.path}.`);
        entry.resume();
        return;
      }
      const relative = normalized.slice('package/'.length).replace(/\/$/, '');
      if (!relative || relative.split('/').includes('..') || path.posix.isAbsolute(relative)) {
        entry.resume();
        return;
      }
      if (entries.has(relative)) {
        parseError = new Error(`[pack] Locked KodaX tarball contains duplicate entry ${relative}.`);
        entry.resume();
        return;
      }
      if (entry.type === 'File' || entry.type === 'OldFile') {
        const chunks = [];
        entry.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
        entry.on('end', () => entries.set(relative, {
          type: 'file',
          bytes: Buffer.concat(chunks),
        }));
        return;
      }
      if (entry.type === 'SymbolicLink') {
        entries.set(relative, { type: 'symlink', target: entry.linkpath });
        entry.resume();
        return;
      }
      if (entry.type !== 'Directory') {
        parseError = new Error(
          `[pack] Locked KodaX tarball uses unsupported ${entry.type} entry ${relative}.`,
        );
      }
      entry.resume();
    },
  });
  parser.on('error', (error) => {
    parseError = error;
  });
  parser.end(tarball);
  if (parseError) {
    throw new Error('[pack] Cannot inspect the locked KodaX tarball entries.', {
      cause: parseError,
    });
  }
  return entries;
}

function installedPackageEntries(root) {
  const entries = new Set();
  const visit = (directory, prefix = '') => {
    for (const item of readdirSync(directory, { withFileTypes: true })) {
      const relative = prefix ? `${prefix}/${item.name}` : item.name;
      const absolute = path.join(directory, item.name);
      if (item.isDirectory()) visit(absolute, relative);
      else entries.add(relative);
    }
  };
  visit(root);
  return entries;
}

function assertInstalledPackageMatchesTarball(sdkDir, tarball) {
  const lockedEntries = lockedTarballEntries(tarball);
  const installedEntries = installedPackageEntries(sdkDir);
  for (const [relative, expected] of lockedEntries) {
    const absolute = path.resolve(sdkDir, ...relative.split('/'));
    const withinPackage = path.relative(path.resolve(sdkDir), absolute);
    if (withinPackage.startsWith('..') || path.isAbsolute(withinPackage)) {
      throw new Error(`[pack] Locked KodaX entry escapes the installed package: ${relative}.`);
    }
    let stat;
    try {
      stat = lstatSync(absolute);
    } catch (error) {
      throw new Error(`[pack] Installed KodaX content mismatch at ${relative}: entry is missing.`, {
        cause: error,
      });
    }
    if (expected.type === 'file') {
      if (!stat.isFile() || !readFileSync(absolute).equals(expected.bytes)) {
        throw new Error(`[pack] Installed KodaX content mismatch at ${relative}.`);
      }
    } else if (!stat.isSymbolicLink() || readlinkSync(absolute) !== expected.target) {
      throw new Error(`[pack] Installed KodaX content mismatch at ${relative}.`);
    }
    installedEntries.delete(relative);
  }
  // Package managers may materialize declared transitive dependencies inside
  // this directory. They are governed by their own lock entries, not by the
  // KodaX package tarball.
  const unexpected = [...installedEntries]
    .filter((relative) => relative !== 'node_modules' && !relative.startsWith('node_modules/'))
    .sort()[0];
  if (unexpected !== undefined) {
    throw new Error(`[pack] Installed KodaX content mismatch: unexpected entry ${unexpected}.`);
  }
}

async function fetchRegistryTarball(resolved) {
  const response = await fetch(resolved, { redirect: 'follow' });
  if (!response.ok) {
    throw new Error(`[pack] Cannot fetch locked KodaX tarball: HTTP ${response.status}.`);
  }
  return Buffer.from(await response.arrayBuffer());
}

export async function assertKodaxReleaseDependencyState(
  spaceRoot,
  sdkDir,
  { allowLocalTarball = false, readRegistryTarball = fetchRegistryTarball } = {},
) {
  const rootManifest = readJson(path.join(spaceRoot, 'package.json'), 'the root manifest');
  const desktopManifest = readJson(
    path.join(spaceRoot, 'apps', 'desktop', 'package.json'),
    'the desktop manifest',
  );
  const lock = readJson(path.join(spaceRoot, 'package-lock.json'), 'the npm lockfile');
  const installed = readJson(path.join(sdkDir, 'package.json'), 'the installed KodaX metadata');

  const versions = {
    root: exactVersion(rootManifest.dependencies?.[KODAX_PACKAGE], 'the root manifest'),
    desktop: exactVersion(desktopManifest.dependencies?.[KODAX_PACKAGE], 'the desktop manifest'),
    lockRoot: exactVersion(
      lock.packages?.['']?.dependencies?.[KODAX_PACKAGE],
      'the root lock entry',
    ),
    lockDesktop: exactVersion(
      lock.packages?.['apps/desktop']?.dependencies?.[KODAX_PACKAGE],
      'the desktop lock entry',
    ),
    lockPackage: exactVersion(
      lock.packages?.['node_modules/@kodax-ai/kodax']?.version,
      'the installed-package lock entry',
    ),
    installed: exactVersion(installed.version, 'the installed package'),
  };
  const expected = versions.root;
  const mismatches = Object.entries(versions)
    .filter(([, version]) => version !== expected)
    .map(([label, version]) => `${label}=${version}`);
  if (mismatches.length > 0) {
    throw new Error(
      `[pack] KodaX release dependency mismatch: expected ${expected}; ${mismatches.join(', ')}. ` +
        'Update both manifests and package-lock.json to one exact version, restore the locked ' +
        'package, and package again.',
    );
  }

  const lockedPackage = lock.packages?.['node_modules/@kodax-ai/kodax'];
  const resolved = String(lockedPackage?.resolved ?? '').trim();
  const integrity = String(lockedPackage?.integrity ?? '').trim();
  if (!/^sha512-[A-Za-z0-9+/=]+$/.test(integrity)) {
    throw new Error(
      `[pack] package-lock.json must pin ${KODAX_PACKAGE}@${expected} with sha512 integrity ` +
        'before packaging.',
    );
  }

  const registryPattern = new RegExp(
    `^https://registry\\.npmjs\\.org/@kodax-ai/kodax/-/kodax-${expected.replaceAll('.', '\\.')}\\.tgz$`,
    'i',
  );
  let tarball;
  let source;
  if (registryPattern.test(resolved)) {
    try {
      tarball = Buffer.from(await readRegistryTarball(resolved));
    } catch (error) {
      throw new Error(`[pack] Cannot read the locked Registry KodaX tarball at ${resolved}.`, {
        cause: error,
      });
    }
    source = 'registry';
  } else if (resolved.startsWith('file:')) {
    if (!allowLocalTarball) {
      throw new Error(
        `[pack] Refusing local ${KODAX_PACKAGE}@${expected} tarball in release mode. ` +
          'Use the explicit local-test packaging entry point for pre-release validation.',
      );
    }
    const fileReference = decodeURIComponent(resolved.slice('file:'.length));
    const tarballPath = path.resolve(spaceRoot, fileReference);
    const expectedBasename = `kodax-ai-kodax-${expected}.tgz`;
    if (path.basename(tarballPath) !== expectedBasename) {
      throw new Error(
        `[pack] Local ${KODAX_PACKAGE}@${expected} must use ${expectedBasename}; found ${resolved}.`,
      );
    }

    try {
      tarball = readFileSync(tarballPath);
    } catch (error) {
      throw new Error(`[pack] Cannot read the locked local KodaX tarball at ${tarballPath}.`, {
        cause: error,
      });
    }
    source = 'local-tarball';
  } else {
    throw new Error(
      `[pack] package-lock.json must resolve ${KODAX_PACKAGE}@${expected} from the npm Registry ` +
        'or a versioned local test tarball before packaging.',
    );
  }

  const actualIntegrity = `sha512-${createHash('sha512').update(tarball).digest('base64')}`;
  if (actualIntegrity !== integrity) {
    throw new Error(
      `[pack] Locked ${source === 'registry' ? 'Registry' : 'local'} KodaX tarball integrity mismatch. ` +
        'Restore the intended lockfile and package before packaging.',
    );
  }
  assertInstalledPackageMatchesTarball(sdkDir, tarball);
  return { version: expected, resolved, integrity, source };
}
