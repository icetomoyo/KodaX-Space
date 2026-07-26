// Ensure better-sqlite3 is compiled for the runtime about to load it.
//
// Local development uses two Node runtimes:
//   - plain Node for unit tests (ABI from process.versions.modules)
//   - Electron's embedded Node for the desktop app
//
// better-sqlite3 has a single native binding slot under node_modules, so running
// pack/dev/tests can leave it compiled for the other ABI. This script is cheap
// when the current binding already loads, and rebuilds only on mismatch.

import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const require = createRequire(import.meta.url);

const mode = process.argv[2];
if (mode !== 'node' && mode !== 'electron') {
  console.error('Usage: node scripts/ensure-sqlite-native.mjs <node|electron>');
  process.exit(2);
}

const NODE = process.execPath;
const ELECTRON_BIN = require('electron');
const electronVersion = require('electron/package.json').version;
const betterSqlite3Dir = path.dirname(require.resolve('better-sqlite3/package.json'));
const prebuildInstallBin = require.resolve('prebuild-install/bin.js');
const nodeGypBin = require.resolve('node-gyp/bin/node-gyp.js');
const allowUnverifiedPrebuild = process.env.KODAX_ALLOW_UNVERIFIED_SQLITE_PREBUILD === '1';

function run(cmd, args, label, options = {}) {
  console.log(`[native] $ ${cmd} ${args.join(' ')}`);
  const result = spawnSync(cmd, args, {
    cwd: options.cwd ?? root,
    stdio: 'inherit',
    shell: options.shell ?? false,
    timeout: options.timeout,
    windowsHide: true,
    env: { ...process.env, ...options.env },
  });
  if (result.error) {
    throw new Error(`${label} failed: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(`${label} exited with code ${result.status ?? 'unknown'}`);
  }
}

function tryRun(cmd, args, label, options = {}) {
  try {
    run(cmd, args, label, options);
    return true;
  } catch (err) {
    console.warn(`[native] ${label} failed; trying fallback.`);
    console.warn(err instanceof Error ? err.message : String(err));
    return false;
  }
}

function checkRuntime(runtime) {
  const checkScript =
    "try { const Database = require('better-sqlite3'); const db = new Database(':memory:'); db.close(); process.exit(0); } catch (error) { console.error(error instanceof Error ? error.stack : String(error)); process.exit(1); }";
  if (runtime === 'node') {
    return spawnSync(NODE, ['-e', checkScript], {
      cwd: root,
      encoding: 'utf-8',
      stdio: 'pipe',
      windowsHide: true,
    });
  }
  return spawnSync(ELECTRON_BIN, ['-e', checkScript], {
    cwd: root,
    encoding: 'utf-8',
    stdio: 'pipe',
    windowsHide: true,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  });
}

function summarizeFailure(result) {
  return [result.stderr, result.stdout]
    .filter((part) => typeof part === 'string' && part.trim().length > 0)
    .join('\n')
    .trim();
}

const check = checkRuntime(mode);
if (check.status === 0) {
  console.log(`[native] better-sqlite3 already matches ${mode} runtime.`);
  process.exit(0);
}

const failure = summarizeFailure(check);
if (failure.length > 0) {
  console.warn(`[native] better-sqlite3 does not match ${mode} runtime:`);
  console.warn(failure);
}

function logPrebuildSkip() {
  console.log(
    '[native] skipping unverified better-sqlite3 prebuild; set KODAX_ALLOW_UNVERIFIED_SQLITE_PREBUILD=1 to opt in.',
  );
}

function rebuildFromSource(runtime) {
  const args =
    runtime === 'electron'
      ? [
          nodeGypBin,
          'rebuild',
          '--release',
          '--runtime=electron',
          `--target=${electronVersion}`,
          '--dist-url=https://electronjs.org/headers',
        ]
      : [nodeGypBin, 'rebuild', '--release'];

  run(NODE, args, `node-gyp rebuild better-sqlite3 for ${runtime}`, {
    cwd: betterSqlite3Dir,
    timeout: 300_000,
  });
}

if (mode === 'node') {
  const usedPrebuild =
    allowUnverifiedPrebuild &&
    tryRun('npm', ['rebuild', 'better-sqlite3'], 'npm rebuild better-sqlite3', {
      shell: process.platform === 'win32',
      timeout: 180_000,
    });

  if (!allowUnverifiedPrebuild) logPrebuildSkip();
  if (!usedPrebuild) rebuildFromSource('node');
} else {
  const usedPrebuild =
    allowUnverifiedPrebuild &&
    tryRun(
      NODE,
      [prebuildInstallBin, '--runtime', 'electron', '--target', electronVersion, '--force'],
      'prebuild-install better-sqlite3 electron binary',
      { cwd: betterSqlite3Dir, timeout: 120_000 },
    );

  if (!allowUnverifiedPrebuild) logPrebuildSkip();

  if (!usedPrebuild) rebuildFromSource('electron');
}

const recheck = checkRuntime(mode);
if (recheck.status !== 0) {
  const message = summarizeFailure(recheck);
  console.error(`[native] better-sqlite3 still fails for ${mode} runtime after rebuild.`);
  if (message.length > 0) console.error(message);
  process.exit(recheck.status ?? 1);
}

console.log(`[native] better-sqlite3 rebuilt for ${mode} runtime.`);
