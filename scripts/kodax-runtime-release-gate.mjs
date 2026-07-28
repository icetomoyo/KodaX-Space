import { readFileSync } from 'node:fs';
import path from 'node:path';

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
  const version = String(value ?? '').trim();
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error(
      `[pack] ${label} must pin ${KODAX_PACKAGE} to an exact SemVer; found ${version || '(missing)'}.`,
    );
  }
  return version;
}

export function assertKodaxReleaseDependencyState(spaceRoot, sdkDir) {
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
        'Update both manifests and package-lock.json to one exact Registry version, run npm ci, ' +
        'and package again.',
    );
  }

  const lockedPackage = lock.packages?.['node_modules/@kodax-ai/kodax'];
  const resolved = String(lockedPackage?.resolved ?? '').trim();
  const integrity = String(lockedPackage?.integrity ?? '').trim();
  if (
    !/^https:\/\/registry\.npmjs\.org\/@kodax-ai\/kodax\/-\/kodax-[^/]+\.tgz$/i.test(resolved) ||
    !/^sha512-[A-Za-z0-9+/=]+$/.test(integrity)
  ) {
    throw new Error(
      `[pack] package-lock.json must resolve ${KODAX_PACKAGE}@${expected} from the npm Registry ` +
        'with sha512 integrity before packaging.',
    );
  }

  return { version: expected, resolved, integrity };
}
