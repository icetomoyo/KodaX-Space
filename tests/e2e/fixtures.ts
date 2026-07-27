// Shared Playwright fixtures — OC-12 / OC-44 e2e infra
//
// 每个 spec 直接 import `launchSpace(testId)` 起一个 Space 进程 +
// 隔离 data dir。spec 退出时 cleanup 关进程并删 tmp 目录。

import { _electron, type ElectronApplication, type Page } from '@playwright/test';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { stopOwnedTestDaemon } from './fixture-daemon-cleanup.js';
import { cleanupRuntimeClientCredentialForTestProfile } from '../../scripts/runtime-test-credential-cleanup.mjs';

// ESM-compatible __dirname derivation (Playwright transpiles to ESM)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '../..');
const ELECTRON_MAIN = path.join(REPO_ROOT, 'dist-electron', 'main.js');
const ELECTRON_CLOSE_TIMEOUT_MS = 10_000;
const DAEMON_POST_CLOSE_RETRY_DELAYS_MS = [0, 100, 300] as const;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function stopOwnedTestDaemonQuietly(testDataDir: string): Promise<boolean> {
  return stopOwnedTestDaemon(testDataDir).catch(() => false);
}

async function closeElectronBounded(app: ElectronApplication): Promise<void> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<'timeout'>((resolve) => {
    timeout = setTimeout(() => resolve('timeout'), ELECTRON_CLOSE_TIMEOUT_MS);
    timeout.unref?.();
  });
  const closed = app.close().then(
    () => 'closed' as const,
    () => 'failed' as const,
  );
  const outcome = await Promise.race([closed, timedOut]);
  if (timeout !== undefined) clearTimeout(timeout);
  if (outcome === 'closed') return;
  try {
    app.process().kill();
  } catch {
    // The process may already have exited while Playwright was closing its transport.
  }
}

async function cleanupIsolatedSpace(
  app: ElectronApplication | undefined,
  testDataDir: string,
): Promise<void> {
  // Production keeps its shared daemon alive across Space restarts. This fixture owns an
  // isolated daemon, so stop only the PID whose descriptor is rooted in this testDataDir.
  // Sweep both sides of Electron shutdown: under a loaded serial suite the daemon spawn can
  // still be finishing when the first sweep runs, and deleting the profile immediately after
  // app.close would otherwise orphan that late child together with its inherited launch pipes.
  await stopOwnedTestDaemonQuietly(testDataDir);
  if (app !== undefined) await closeElectronBounded(app);
  for (const retryDelayMs of DAEMON_POST_CLOSE_RETRY_DELAYS_MS) {
    if (retryDelayMs > 0) await delay(retryDelayMs);
    if (await stopOwnedTestDaemonQuietly(testDataDir)) break;
  }
  // Runtime client identities use the OS keychain even though the rest of the
  // profile is isolated. Delete the exact account while its owner evidence is
  // still present, then remove the temporary filesystem profile.
  await cleanupRuntimeClientCredentialForTestProfile(testDataDir).catch(() => undefined);
  await fs.rm(testDataDir, { recursive: true, force: true }).catch(() => {});
}

export interface SpaceInstance {
  readonly app: ElectronApplication;
  readonly page: Page;
  readonly testDataDir: string;
  /**
   * Inject a project path into the store (localStorage hydrate + project.recent.add),
   * reload renderer, return when DOM ready. Without this textarea stays disabled
   * because currentProjectPath is null on first launch in isolated mode.
   */
  seedProject(projectDir: string): Promise<void>;
  close(): Promise<void>;
}

export interface LaunchSpaceOptions {
  /**
   * Subscribe to renderer console events BEFORE the fixture waits for
   * domcontentloaded. Required for catching synchronous first-render errors
   * (e.g. React reconciliation errors fire before any post-launch listener).
   */
  readonly onConsole?: (msg: { type: string; text: string }) => void;
  /** Subscribe to renderer pageerror events; same early-attach guarantee. */
  readonly onPageError?: (err: Error) => void;
  /** Additional deterministic environment values for the isolated Electron process. */
  readonly env?: Readonly<Record<string, string>>;
}

/**
 * Launch a Space process with KODAX_TEST_ONBOARDING set to `testId`.
 * data-paths.ts redirects ~/.kodax to $TMPDIR/kodax-test-<testId>.
 *
 * Pass `onConsole` / `onPageError` to capture errors that fire synchronously
 * during the first render pass — listeners attached after this function
 * returns would miss them.
 */
export async function launchSpace(
  testId: string,
  opts?: LaunchSpaceOptions,
): Promise<SpaceInstance> {
  const testDataDir = path.join(os.tmpdir(), `kodax-test-${testId}`);
  // 清掉可能上一次跑的同名残留 (testId 来自 spec 名 + timestamp，正常情况不冲突)
  await cleanupRuntimeClientCredentialForTestProfile(testDataDir).catch(() => undefined);
  await fs.rm(testDataDir, { recursive: true, force: true }).catch(() => {});
  const testWorkspaceDir = path.join(testDataDir, 'workspace');
  const testSpaceDir = path.join(testDataDir, 'space');
  await fs.mkdir(testSpaceDir, { recursive: true });
  await fs.writeFile(
    path.join(testSpaceDir, 'settings.json'),
    JSON.stringify(
      {
        version: 1,
        defaultWorkspace: testWorkspaceDir,
        languageMode: 'en-US',
      },
      null,
      2,
    ),
    'utf-8',
  );

  // memory note: 用户 shell 有时 export ELECTRON_RUN_AS_NODE=1 让 electron.exe 退化成 Node
  // 跑。Node 不识别 Playwright 注入的 --remote-debugging-port=0 等 Chromium flag，
  // 启动期立刻报 "bad option" 失败。这里显式剥掉。
  const baseEnv = { ...process.env } as Record<string, string | undefined>;
  delete baseEnv.ELECTRON_RUN_AS_NODE;

  let app: ElectronApplication;
  try {
    app = await _electron.launch({
      args: [ELECTRON_MAIN],
      env: {
        ...baseEnv,
        KODAX_TEST_ONBOARDING: testId,
        // Existing renderer E2E owns the whole Electron lifecycle. Keep the
        // Windows-only background tray out of these fixtures; dedicated main-
        // process coverage verifies the tray model and package wiring.
        SPACE_DISABLE_TRAY: '1',
        // 关掉 Sentry / 真实 LLM 网络调，让首启不依赖外部
        KODAX_FORCE_MOCK: '1',
        NODE_ENV: 'production',
        ...opts?.env,
      } as Record<string, string>,
    });
  } catch (error) {
    await cleanupIsolatedSpace(undefined, testDataDir);
    throw error;
  }

  try {
    // 调试 hook：把 main process console + renderer console 都打到 test stdout，
    // 方便 30s 超时时定位卡在哪一步。CI 上可以静默掉。
    if (process.env.E2E_DEBUG === '1') {
      app.process().stdout?.on('data', (d: Buffer) => process.stdout.write(`[main] ${d}`));
      app.process().stderr?.on('data', (d: Buffer) => process.stderr.write(`[main:err] ${d}`));
    }

    const page = await app.firstWindow();
    // 关键顺序：先挂 spec 传入的 listeners，再等 domcontentloaded。
    // React #310 等同步 reconcile 错误在首屏 render pass 里就 fire，
    // domcontentloaded 之后才挂等于错过 v0.1.7 那一类回归的现场。
    if (opts?.onConsole) {
      const { onConsole } = opts;
      page.on('console', (msg) => onConsole({ type: msg.type(), text: msg.text() }));
    }
    if (opts?.onPageError) {
      const { onPageError } = opts;
      page.on('pageerror', (err) => onPageError(err));
    }
    if (process.env.E2E_DEBUG === '1') {
      page.on('console', (msg) => console.log(`[renderer:${msg.type()}]`, msg.text()));
      page.on('pageerror', (err) => console.error('[renderer:pageerror]', err.message));
    }
    // The main process may show a boot splash first; wait for the real renderer
    // document before tests touch app localStorage or query app controls.
    await page.waitForLoadState('domcontentloaded');
    await page.waitForFunction(() => document.getElementById('root') !== null);

    // hook：把 project dir 注入 store + recent list + reload，让 textarea / ModeSelector 都活
    // 抽到这里避免 3 个 spec 都拷一份相同 4 行代码 (review LOW: dedup)
    const seedProject = async (projectDir: string): Promise<void> => {
      await page.evaluate((p) => {
        return (
          window as unknown as {
            kodaxSpace: { invoke: (n: string, i: unknown) => Promise<unknown> };
          }
        ).kodaxSpace.invoke('project.recent.add', { path: p });
      }, projectDir);
      // project.recent.add can push the still-hydrated default workspace back
      // through renderer state. Persist the selected test project only after
      // that main-process mutation has completed so reload cannot race it.
      await page.evaluate((p) => {
        localStorage.setItem('kodax-space.currentProjectPath', p);
      }, projectDir);
      await page.reload();
      await page.waitForLoadState('domcontentloaded');
      await page.waitForFunction(
        (p) => localStorage.getItem('kodax-space.currentProjectPath') === p,
        projectDir,
      );
    };

    return {
      app,
      page,
      testDataDir,
      seedProject,
      close: () => cleanupIsolatedSpace(app, testDataDir),
    };
  } catch (error) {
    await cleanupIsolatedSpace(app, testDataDir);
    throw error;
  }
}
