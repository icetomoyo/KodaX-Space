// Packaged complete-exit E2E: exercise the real Electron product path twice,
// prove the daemon/Job owner is gone, then verify persisted Session history.
import { spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright';
import { cleanupRuntimeClientCredentialForTestProfile } from '../scripts/runtime-test-credential-cleanup.mjs';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.resolve(rootDir, process.env.SPACE_PACK_OUT_DIR || 'out');
const executable = path.join(outDir, 'win-unpacked', 'KodaX Space.exe');
const testId = `complete-exit-${process.pid}-${Date.now()}`;
const profileDir = path.join(tmpdir(), `kodax-test-${testId}`);
const projectDir = path.join(profileDir, 'project');
const daemonDir = path.join(profileDir, 'runtime', 'daemon', 'coder');
const daemonStatePath = path.join(daemonDir, 'daemon.json');
const daemonLockPath = path.join(daemonDir, 'daemon.lock');
const exitTicketPath = path.join(daemonDir, 'exit-settlement.json');
const ownerPolicyPath = path.join(daemonDir, 'owner-policy.json');
const triggerPath = path.join(profileDir, 'space', 'complete-exit.trigger');
const packageLock = JSON.parse(await readFile(path.join(rootDir, 'package-lock.json'), 'utf8'));
const expectedKodaxVersion = packageLock.packages?.['node_modules/@kodax-ai/kodax']?.version;
const spaceVersion = packageLock.packages?.['']?.version;
const activeProcesses = new Set();

if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(expectedKodaxVersion ?? '')) {
  throw new Error(`package-lock has no exact installed KodaX version: ${expectedKodaxVersion}`);
}
if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(spaceVersion ?? '')) {
  throw new Error(`package-lock has no exact Space version: ${spaceVersion}`);
}
if (!existsSync(executable)) throw new Error(`packaged executable is missing: ${executable}`);

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function readJson(file) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch {
    return undefined;
  }
}

function isPidAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitFor(predicate, timeoutMs, description) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await predicate();
    if (value) return value;
    await sleep(100);
  }
  throw new Error(`timed out waiting for ${description}`);
}

async function launchPackagedApp(previousRuntimeId) {
  const childEnv = {
    ...process.env,
    KODAX_TEST_ONBOARDING: testId,
    SPACE_TEST_COMPLETE_EXIT_TRIGGER: '1',
    SPACE_TEST_BYPASS_COMPLETE_EXIT: '1',
    SPACE_TEST_COMPLETE_EXIT_BACKGROUND_HOLD_MS: '1500',
  };
  delete childEnv.ELECTRON_RUN_AS_NODE;
  delete childEnv.KODAX_HOME;
  delete childEnv.KODAX_PROFILE_DIR;
  const app = await electron.launch({
    executablePath: executable,
    args: [],
    cwd: path.dirname(executable),
    env: childEnv,
    timeout: 90_000,
  });
  const appProcess = app.process();
  activeProcesses.add(appProcess);
  const window = await waitFor(
    () => app.windows().find((candidate) => candidate.url().startsWith('app://space/')),
    90_000,
    'packaged application renderer',
  );
  await window.waitForLoadState('domcontentloaded');
  await window.waitForFunction(() => Boolean(window.kodaxSpace), undefined, { timeout: 90_000 });
  const daemon = await waitFor(
    async () => {
      const state = await readJson(daemonStatePath);
      return state?.status === 'ready' && state.runtimeId !== previousRuntimeId ? state : undefined;
    },
    90_000,
    'packaged Runtime readiness',
  );
  const owner = await waitFor(
    async () => {
      const candidate = await readJson(daemonLockPath);
      return candidate?.runtimeId === daemon.runtimeId ? candidate : undefined;
    },
    10_000,
    'exact daemon owner lock',
  );
  if (daemon.version !== expectedKodaxVersion) {
    throw new Error(`unexpected packaged KodaX version: ${daemon.version}`);
  }
  return { app, appProcess, window, daemon, owner };
}

async function requestProductCompleteExit(instance) {
  const processExit = once(instance.appProcess, 'exit');
  const wasVisible = await instance.app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows().some((window) => window.isVisible()),
  );
  if (!wasVisible) throw new Error('packaged complete-exit window was not visible before exit');
  await mkdir(path.dirname(triggerPath), { recursive: true });
  await writeFile(triggerPath, 'complete-exit\n', 'utf8');
  await waitFor(
    async () => {
      if (instance.appProcess.exitCode !== null) return false;
      return instance.app
        .evaluate(({ BrowserWindow }) => {
          const windows = BrowserWindow.getAllWindows();
          return windows.length > 0 && windows.every((window) => !window.isVisible());
        })
        .catch(() => false);
    },
    10_000,
    'visible complete-exit window to transfer into background settlement',
  );
  const [code, signal] = await Promise.race([
    processExit,
    sleep(600_000).then(() => {
      throw new Error('packaged complete exit exceeded the 480-second SDK contract');
    }),
  ]);
  activeProcesses.delete(instance.appProcess);
  await instance.app.close().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    if (!/closed|disconnected/i.test(message)) {
      console.warn(`[complete-exit-packaged] Playwright cleanup warning: ${message}`);
    }
  });
  if (code !== 0 || signal !== null) {
    throw new Error(`packaged Space exited abnormally (code=${code}, signal=${signal})`);
  }
  await waitFor(
    () => !isPidAlive(instance.daemon.pid) && !isPidAlive(instance.owner.supervisorPid),
    20_000,
    'daemon and Windows Job supervisor exit',
  );
  const outcomePath = path.join(
    daemonDir,
    `shutdown-outcome.${instance.daemon.runtimeId}.${instance.daemon.pid}.json`,
  );
  const outcome = await readJson(outcomePath);
  if (outcome?.status !== 'succeeded') {
    throw new Error(
      `durable daemon shutdown outcome was not successful: ${JSON.stringify(outcome)}`,
    );
  }
  for (const residue of [daemonStatePath, daemonLockPath, exitTicketPath]) {
    if (existsSync(residue)) throw new Error(`complete exit left lifecycle residue: ${residue}`);
  }
  const policy = await readJson(ownerPolicyPath);
  if (policy?.mode !== 'daemon') {
    throw new Error(`complete exit did not restore daemon owner policy: ${JSON.stringify(policy)}`);
  }
  await rm(triggerPath, { force: true });
}

async function seedRuntimeSession(sessionId) {
  const previousKodaxHome = process.env.KODAX_HOME;
  process.env.KODAX_HOME = profileDir;
  let runtime;
  try {
    const { connectKodaXRuntime } = await import('@kodax-ai/kodax/runtime');
    runtime = await connectKodaXRuntime({
      profile: 'coder',
      autoStart: false,
      sessionsDir: path.join(profileDir, 'sessions'),
      clientInfo: {
        name: 'space-complete-exit-e2e',
        version: spaceVersion,
      },
    });
    await runtime.sessions.create({
      sessionId,
      projectPath: projectDir,
      gitRoot: projectDir,
      surface: 'space-desktop',
      tag: 'code',
    });
  } finally {
    await runtime?.close();
    if (previousKodaxHome === undefined) delete process.env.KODAX_HOME;
    else process.env.KODAX_HOME = previousKodaxHome;
  }
}

async function forceCleanup() {
  for (const child of activeProcesses) {
    if (child.exitCode !== null || child.signalCode !== null) continue;
    if (process.platform === 'win32' && child.pid !== undefined) {
      spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
        stdio: 'ignore',
        windowsHide: true,
      });
    } else {
      child.kill('SIGKILL');
    }
  }
  const cliPath = path.join(rootDir, 'node_modules', '@kodax-ai', 'kodax', 'dist', 'kodax_cli.js');
  spawnSync(
    process.execPath,
    [cliPath, 'daemon', 'stop', '--profile', 'coder', '--timeout-ms', '170000', '--json'],
    {
      stdio: 'ignore',
      windowsHide: true,
      timeout: 180_000,
      env: { ...process.env, KODAX_HOME: profileDir },
    },
  );
}

await mkdir(projectDir, { recursive: true });
let sessionId;
try {
  const first = await launchPackagedApp(undefined);
  const created = await first.window.evaluate(
    async (projectRoot) =>
      window.kodaxSpace.invoke('session.create', {
        projectRoot,
        provider: 'anthropic',
        surface: 'code',
      }),
    projectDir,
  );
  if (!created.ok) throw new Error(`session.create failed: ${created.error?.message}`);
  sessionId = created.data.sessionId;
  // Materialize the product-created Coder identity in Runtime without sending
  // an LLM request; the rest of the test stays on the real Space IPC path.
  await seedRuntimeSession(sessionId);
  const noticeText = 'complete-exit persistence sentinel';
  const appended = await first.window.evaluate(
    async ({ id, text }) =>
      window.kodaxSpace.invoke('session.localNotice.append', {
        sessionId: id,
        notice: {
          id: 'complete-exit-sentinel',
          content: text,
          sentAt: Date.now(),
        },
      }),
    { id: sessionId, text: noticeText },
  );
  if (!appended.ok)
    throw new Error(`session.localNotice.append failed: ${appended.error?.message}`);
  const beforeExit = await first.window.evaluate(
    async (id) =>
      window.kodaxSpace.invoke('session.history', {
        sessionId: id,
        requestId: 'before-complete-exit',
        expectedSurface: 'code',
      }),
    sessionId,
  );
  if (!beforeExit.ok || !beforeExit.data.items.some((item) => item.kind === 'local_notice')) {
    throw new Error(`Session sentinel was not readable before exit: ${JSON.stringify(beforeExit)}`);
  }
  await requestProductCompleteExit(first);

  const second = await launchPackagedApp(first.daemon.runtimeId);
  const restored = await waitFor(
    async () => {
      const response = await second.window.evaluate(
        async (id) =>
          window.kodaxSpace.invoke('session.history', {
            sessionId: id,
            requestId: 'after-complete-exit',
            expectedSurface: 'code',
          }),
        sessionId,
      );
      if (!response.ok || response.data.page?.outcome === 'runtime_unavailable') return undefined;
      return response.data.items.some(
        (item) => item.kind === 'local_notice' && item.content === noticeText,
      )
        ? response
        : undefined;
    },
    30_000,
    'persisted Session history after restart',
  );
  if (restored.data.page?.outcome === 'runtime_unavailable') {
    throw new Error('Session history remained runtime_unavailable after restart');
  }
  await requestProductCompleteExit(second);

  console.log(
    `[complete-exit-packaged] PASS | KodaX ${expectedKodaxVersion} | ` +
      'two product exits clean | Session history restored',
  );
} catch (error) {
  console.error(
    '[complete-exit-packaged] FAIL:',
    error instanceof Error ? (error.stack ?? error.message) : String(error),
  );
  process.exitCode = 1;
} finally {
  await forceCleanup();
  await cleanupRuntimeClientCredentialForTestProfile(profileDir).catch((error) => {
    console.warn(
      '[complete-exit-packaged] Runtime test credential cleanup failed:',
      error instanceof Error ? error.message : String(error),
    );
  });
  await rm(profileDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}

// Playwright can retain an inspector transport after Electron has already
// emitted its verified process exit. All product children and profile files
// are settled above, so terminate only the test harness itself.
process.exit(process.exitCode ?? 0);
