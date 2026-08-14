// Packaged boot smoke: start the real unpacked executable with an isolated
// profile, then verify the app's own Runtime and renderer readiness records.
import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cleanupRuntimeClientCredentialForTestProfile } from '../scripts/runtime-test-credential-cleanup.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, '..');
const outDir = path.resolve(rootDir, process.env.SPACE_PACK_OUT_DIR || 'out');
const exe = path.join(outDir, 'win-unpacked', 'KodaX Space.exe');
const profileDir = await mkdtemp(path.join(tmpdir(), 'kodax-space-boot-smoke-'));
const diagnosticsPath = path.join(
  profileDir,
  'space',
  'electron-user-data',
  'diagnostics',
  'space-main.jsonl',
);
const daemonPath = path.join(profileDir, 'runtime', 'daemon', 'coder', 'daemon.json');
const rootPackage = JSON.parse(await readFile(path.join(rootDir, 'package.json'), 'utf8'));
const expectedKodaxVersion = String(rootPackage.dependencies?.['@kodax-ai/kodax'] ?? '').trim();
if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(expectedKodaxVersion)) {
  throw new Error(
    `root manifest has no exact KodaX version: ${expectedKodaxVersion || '(missing)'}`,
  );
}
// The renderer is intentionally independent from a cold daemon. Keep its
// budget below the previously observed 20-50 second Runtime delay, while the
// overall deadline still gives a cold packaged daemon enough time to settle on
// slower Windows hosts.
const RENDERER_READY_BUDGET_MS = 15_000;
const RUNTIME_READY_BUDGET_MS = 90_000;
const DAEMON_READY_TEST_DELAY_MS = 20_000;
const env = {
  ...process.env,
  KODAX_PROFILE_DIR: profileDir,
  // Published KodaX deliberately supports this internal smoke-test hold. It
  // makes a renderer-before-Runtime assertion deterministic instead of relying
  // on incidental cold-start speed.
  KODAX_INTERNAL_DAEMON_TEST_READY_DELAY_MS: String(DAEMON_READY_TEST_DELAY_MS),
};
delete env.ELECTRON_RUN_AS_NODE;
delete env.KODAX_HOME;

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function readJson(pathname) {
  try {
    return JSON.parse(await readFile(pathname, 'utf8'));
  } catch {
    return undefined;
  }
}

async function readDiagnostics() {
  try {
    return (await readFile(diagnosticsPath, 'utf8'))
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch {
    return [];
  }
}

const launchedAt = Date.now();
const child = spawn(exe, [], {
  cwd: path.dirname(exe),
  env,
  stdio: 'ignore',
  windowsHide: true,
});

try {
  const deadline = launchedAt + RUNTIME_READY_BUDGET_MS;
  let daemon;
  let diagnostics = [];
  let rendererReadyAt;
  let runtimeReadyAt;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`packaged app exited before readiness (code ${child.exitCode})`);
    }
    daemon = await readJson(daemonPath);
    diagnostics = await readDiagnostics();
    const runtimeReady = diagnostics.some(
      (event) => event.component === 'runtime' && event.event === 'host_initialized',
    );
    const rendererReady = diagnostics.some(
      (event) =>
        event.component === 'legacy-console' &&
        event.message?.includes('renderer visual-ready') &&
        event.message?.includes('app://space/index.html'),
    );
    const observedAt = Date.now();
    if (rendererReady && rendererReadyAt === undefined) {
      rendererReadyAt = observedAt;
      if (rendererReadyAt - launchedAt > RENDERER_READY_BUDGET_MS) {
        throw new Error(
          `packaged renderer exceeded its independent ${RENDERER_READY_BUDGET_MS}ms readiness budget`,
        );
      }
    }
    if (runtimeReady && runtimeReadyAt === undefined) {
      runtimeReadyAt = observedAt;
      if (runtimeReadyAt - launchedAt > RUNTIME_READY_BUDGET_MS) {
        throw new Error(
          `packaged Runtime exceeded its ${RUNTIME_READY_BUDGET_MS}ms readiness budget`,
        );
      }
    }
    if (rendererReadyAt === undefined && observedAt - launchedAt > RENDERER_READY_BUDGET_MS) {
      throw new Error(
        `packaged renderer exceeded its independent ${RENDERER_READY_BUDGET_MS}ms readiness budget`,
      );
    }
    if (runtimeReady && rendererReady && daemon?.status === 'ready') break;
    await sleep(100);
  }

  if (daemon?.status !== 'ready') throw new Error('packaged Coder daemon did not become ready');
  if (rendererReadyAt === undefined) throw new Error('packaged renderer did not become ready');
  if (runtimeReadyAt === undefined) throw new Error('packaged Runtime host did not become ready');
  const rendererReadyMs = rendererReadyAt - launchedAt;
  const runtimeReadyMs = runtimeReadyAt - launchedAt;
  if (rendererReadyMs > RENDERER_READY_BUDGET_MS) {
    throw new Error(`packaged renderer became ready too late (${rendererReadyMs}ms)`);
  }
  if (runtimeReadyMs > RUNTIME_READY_BUDGET_MS) {
    throw new Error(`packaged Runtime became ready too late (${runtimeReadyMs}ms)`);
  }
  if (runtimeReadyMs < DAEMON_READY_TEST_DELAY_MS) {
    throw new Error('packaged Runtime became ready before the deterministic daemon hold elapsed');
  }
  if (daemon.version !== expectedKodaxVersion) {
    throw new Error(`unexpected packaged KodaX version: ${daemon.version}`);
  }
  if (path.resolve(daemon.configHome) !== path.resolve(profileDir)) {
    throw new Error(`packaged daemon used the wrong config home: ${daemon.configHome}`);
  }
  const finalDiagnostics = await readDiagnostics();
  if (
    !finalDiagnostics.some(
      (event) => event.component === 'runtime' && event.event === 'host_initialized',
    )
  ) {
    throw new Error('packaged Runtime host did not initialize');
  }
  if (
    !finalDiagnostics.some(
      (event) =>
        event.component === 'legacy-console' &&
        event.message?.includes('renderer visual-ready') &&
        event.message?.includes('app://space/index.html'),
    )
  ) {
    throw new Error('packaged renderer did not reach app://space visual readiness');
  }
  console.log(
    `[boot-smoke] PASS | renderer ready in ${rendererReadyMs}ms | ` +
      `KodaX ${expectedKodaxVersion} Runtime ready in ${runtimeReadyMs}ms after deterministic hold`,
  );
} catch (error) {
  console.error('[boot-smoke] FAIL:', error instanceof Error ? error.message : String(error));
  const diagnostics = await readDiagnostics();
  const runtimeFailure = diagnostics.find(
    (event) => event.component === 'runtime' && event.event === 'host_initialization_failed',
  );
  if (runtimeFailure?.data?.message) {
    console.error(`[boot-smoke] Runtime initialization: ${runtimeFailure.data.message}`);
  }
  process.exitCode = 1;
} finally {
  if (process.platform === 'win32' && child.pid !== undefined) {
    spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
      stdio: 'ignore',
      windowsHide: true,
    });
  } else {
    child.kill('SIGKILL');
  }
  await cleanupRuntimeClientCredentialForTestProfile(profileDir).catch((error) => {
    console.warn(
      '[boot-smoke] Runtime test credential cleanup failed:',
      error instanceof Error ? error.message : String(error),
    );
  });
  await rm(profileDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
