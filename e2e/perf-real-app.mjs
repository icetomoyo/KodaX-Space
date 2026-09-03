// E2E: v0.1.46-alpha real-app startup / session-load / long-session scroll probe.
//
// What it does (read-only against the real ~/.kodax profile — it clicks around
// like a user, but sends no LLM queries and mutates no session content):
//   Phase A — startup timing, N sequential launches (1st = cold daemon, later = warm):
//       hrtime around electron.launch → app://space page → domcontentloaded →
//       [data-space-shell-ready], with timestamped main-process stdout markers.
//   Phase B — session load: session.list IPC timing, click a target session row in
//       the sidebar, measure until transcript rows paint (paging spinner settled).
//   Phase C — long-session scroll: rAF frame sampling while wheel-scrolling down/up,
//       long-frame histogram, scroll-to-top older-page prepend (anchor-stability +
//       duplicate-row check), jump back to bottom, session switch-away/back, and a
//       renderer reload (cold renderer, warm main) restore measurement.
//   Writes artifacts/e2e-perf/report.json + screenshots.
//
// Usage: node e2e/perf-real-app.mjs [--runs 2] [--session <sessionIdPrefix>]...

import { _electron as electron } from 'playwright';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const REPORT_DIR = path.join(repoRoot, 'artifacts', 'e2e-perf');
fs.mkdirSync(REPORT_DIR, { recursive: true });

const args = process.argv.slice(2);
function argValue(flag, fallback) {
  const index = args.indexOf(flag);
  return index >= 0 && args[index + 1] !== undefined ? args[index + 1] : fallback;
}
const RUNS = Number(argValue('--runs', '2'));
// Default probe targets: this repo's own two largest real sessions. On any
// other checkout pass --session (repeatable) or set KODAX_PERF_SESSIONS.
const SESSION_PREFIXES = args
  .flatMap((a, i) => (a === '--session' ? [args[i + 1]] : []))
  .filter(Boolean);
const TARGETS =
  SESSION_PREFIXES.length > 0
    ? SESSION_PREFIXES
    : (process.env.KODAX_PERF_SESSIONS ?? '20260820_101354,20260816_190853').split(',');

const PROJECT_HINT = 'KodaX-Space';
const PROJECT_ROOT = process.env.KODAX_PERF_PROJECT_ROOT ?? repoRoot;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function rel(t0) {
  return Math.round(performance.now() - t0);
}

function makeMainLogCollector(child) {
  const lines = [];
  const stamp = (chunk) =>
    chunk
      .toString('utf8')
      .split(/\r?\n/)
      .filter(Boolean)
      .forEach((line) => lines.push({ t: rel(t0Global), line }));
  let t0Global = performance.now();
  const attach = () => {
    child.stdout?.on('data', stamp);
    child.stderr?.on('data', stamp);
  };
  return { lines, attach, ret0: () => (t0Global = performance.now()) };
}

async function launchRealApp() {
  const childEnv = { ...process.env };
  delete childEnv.ELECTRON_RUN_AS_NODE;
  const t0 = performance.now();
  const app = await electron.launch({
    args: [path.join(repoRoot, 'dist-electron')],
    cwd: repoRoot,
    env: { ...childEnv, NODE_ENV: 'production' },
    timeout: 60_000,
  });
  const tLaunched = rel(t0);
  const mainLog = makeMainLogCollector(app.process());
  mainLog.ret0();

  // Find the real app://space page (firstWindow() may be the boot overlay).
  let page = null;
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    page = app
      .windows()
      .find((w) => !w.isClosed() && w.url().startsWith('app://space/'));
    if (page) break;
    await sleep(50);
  }
  if (!page) throw new Error('app://space renderer never opened');
  await page.waitForLoadState('domcontentloaded');
  const tDom = rel(t0);
  await page.waitForFunction(() => document.getElementById('root') !== null, null, {
    timeout: 30_000,
  });
  await page.waitForSelector('[data-space-shell-ready]', { timeout: 60_000 });
  const tShellReady = rel(t0);
  return { app, page, timings: { tLaunched, tDom, tShellReady }, mainLog };
}

async function closeApp(app) {
  try {
    await Promise.race([app.close(), sleep(20_000).then(() => 'timeout')]);
  } catch {
    /* fall through to kill */
  }
  try {
    app.process().kill();
  } catch {
    /* already gone */
  }
  await sleep(1_000);
}

async function expandProject(page) {
  // Clicking a project row TOGGLES its expansion — make it idempotent by reading
  // aria-expanded first. Actual project switching happens implicitly when a
  // session of that project is clicked.
  const projectButton = page
    .locator('aside button')
    .filter({ hasText: new RegExp(`^${PROJECT_HINT}$`) })
    .first();
  const expanded = await projectButton.getAttribute('aria-expanded', { timeout: 10_000 });
  if (expanded !== 'true') {
    await projectButton.click();
    // Project sessions load asynchronously after expansion.
    await sleep(1_500);
  }
  return 'expanded';
}

async function listSessions(page) {
  const t0 = performance.now();
  const result = await page.evaluate(async (projectRoot) => {
    const r = await window.kodaxSpace.invoke('session.list', { projectRoot });
    if (!r.ok) return { ok: false, error: r.error?.message };
    return { ok: true, sessions: r.data.sessions };
  }, PROJECT_ROOT);
  return { ms: Math.round(performance.now() - t0), result };
}

async function ensureSessionRowVisible(page, sessionId) {
  const selector = `aside [data-testid="sidebar-session-row"][data-session-id="${sessionId}"]`;
  let row = page.locator(selector);
  if (await row.count()) return row.first();
  // Target is beyond a project's collapsed window — expand every overflow list
  // ("展开显示"/"Show more"); the buttons are per-project, so click them all.
  const expandLabels = ['展开显示', 'Show more', '展示全部', 'Show all'];
  for (const label of expandLabels) {
    const buttons = page.locator('aside button', { hasText: label });
    const count = await buttons.count();
    for (let i = 0; i < count; i++) {
      await buttons.nth(i).click().catch(() => {});
      await sleep(150);
    }
    if (await row.count()) break;
  }
  await page.waitForSelector(selector, { timeout: 10_000, state: 'attached' });
  return page.locator(selector).first();
}

async function measureSessionOpen(page, sessionId) {
  const row = await ensureSessionRowVisible(page, sessionId);
  const t0 = performance.now();
  await row.click();
  await page.waitForSelector(
    '[data-testid="conversation-stream"] [data-testid="conversation-render-row"]',
    { timeout: 30_000, state: 'attached' },
  );
  const tFirstRow = Math.round(performance.now() - t0);
  // Settled: paging indicator gone (either never appeared or completed).
  await page
    .waitForFunction(() => !document.querySelector('[data-testid="history-paging-status"]'), null, {
      timeout: 30_000,
    })
    .catch(() => {});
  await sleep(400);
  const tSettled = Math.round(performance.now() - t0);
  const stats = await page.evaluate(() => {
    const scroller = document.querySelector('[data-testid="conversation-scroll-container"]');
    return {
      rows: document.querySelectorAll('[data-testid="conversation-render-row"]').length,
      userBubbles: document.querySelectorAll('[data-testid="user-message-bubble"]').length,
      scrollHeight: scroller?.scrollHeight ?? 0,
      scrollTop: scroller?.scrollTop ?? 0,
      pagingStatus: Boolean(document.querySelector('[data-testid="history-paging-status"]')),
      pagingError: document.querySelector('[data-testid="history-paging-error"]')?.textContent ?? null,
      runtimeUnavailable: Boolean(document.querySelector('[data-testid="history-runtime-unavailable"]')),
    };
  });
  return { tFirstRow, tSettled, stats };
}

async function sampleFramesDuring(page, action) {
  // An occluded Electron window throttles rAF, which would fake huge frame gaps —
  // raise the window and count long main-thread tasks alongside frame deltas.
  await page.bringToFront().catch(() => {});
  await page.evaluate(() => {
    const win = window;
    win.__frameTimes = [];
    win.__longTasks = [];
    win.__sampling = true;
    if (!win.__longtaskObserver) {
      const Observer = win.PerformanceObserver;
      win.__longtaskObserver = new Observer((list) => {
        for (const entry of list.getEntries()) {
          win.__longTasks.push(Math.round(entry.duration));
        }
      });
      win.__longtaskObserver.observe({ entryTypes: ['longtask'] });
    }
    win.__longTasks.length = 0;
    const tick = (t) => {
      if (!win.__sampling) return;
      const last = win.__frameTimes[win.__frameTimes.length - 1];
      if (last !== undefined) win.__frameTimes.push(t - last);
      else win.__frameTimes.push(0);
      win.requestAnimationFrame(tick);
    };
    win.requestAnimationFrame(tick);
  });
  await action();
  await sleep(300);
  return page.evaluate(() => {
    window.__sampling = false;
    const frames = window.__frameTimes?.slice(2) ?? [];
    const tasks = [...(window.__longTasks ?? [])];
    const sorted = [...frames].sort((a, b) => a - b);
    const pick = (p) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? null;
    return {
      frames: frames.length,
      p50: pick(0.5),
      p95: pick(0.95),
      max: sorted[sorted.length - 1] ?? null,
      over32ms: frames.filter((d) => d > 32).length,
      over50ms: frames.filter((d) => d > 50).length,
      over100ms: frames.filter((d) => d > 100).length,
      longTasks: { count: tasks.length, max: tasks.length ? Math.max(...tasks) : 0, over200ms: tasks.filter((d) => d > 200).length },
      visibility: document.visibilityState,
    };
  });
}

async function scrollTest(page) {
  const scrollerBox = await page.locator('[data-testid="conversation-stream"]').boundingBox();
  if (!scrollerBox) throw new Error('conversation stream not visible');
  const x = scrollerBox.x + scrollerBox.width / 2;
  const y = scrollerBox.y + scrollerBox.height / 2;
  // Wheel events land at the current pointer position — move it into the stream first.
  await page.mouse.move(x, y);

  const before = await page.evaluate(() => ({
    rows: document.querySelectorAll('[data-testid="conversation-render-row"]').length,
    scrollHeight: document.querySelector('[data-testid="conversation-scroll-container"]')?.scrollHeight ?? 0,
    scrollTop: document.querySelector('[data-testid="conversation-scroll-container"]')?.scrollTop ?? 0,
  }));

  // Down 12 wheel ticks.
  const downFrames = await sampleFramesDuring(page, async () => {
    for (let i = 0; i < 12; i++) {
      await page.mouse.wheel(0, 240);
      await sleep(90);
    }
  });

  // Up until top (triggers older-page prepend).
  const upFrames = await sampleFramesDuring(page, async () => {
    for (let i = 0; i < 60; i++) {
      const atTop = await page.evaluate(
        () => document.querySelector('[data-testid="conversation-scroll-container"]')?.scrollTop ?? 0,
      );
      if (atTop <= 1) break;
      await page.mouse.wheel(0, -480);
      await sleep(60);
    }
  });

  // Wait for prepend (paging status appears then disappears) and capture anchor state.
  const prependStart = Date.now();
  let prependSeen = false;
  while (Date.now() - prependStart < 15_000) {
    const seen = await page.evaluate(
      () => Boolean(document.querySelector('[data-testid="history-paging-status"]')),
    );
    if (seen) {
      prependSeen = true;
      break;
    }
    await sleep(100);
  }
  let prependWaitMs = Math.round(Date.now() - prependStart);
  await page
    .waitForFunction(
      () => !document.querySelector('[data-testid="history-paging-status"]'),
      null,
      { timeout: 30_000 },
    )
    .catch(() => {});
  prependWaitMs = Math.round(Date.now() - prependStart);
  await sleep(600);

  const afterPrepend = await page.evaluate(() => {
    const scroller = document.querySelector('[data-testid="conversation-scroll-container"]');
    // Semantic anchor: first fully visible row's text content.
    const rows = [...document.querySelectorAll('[data-testid="conversation-render-row"]')];
    const visible = rows.find((r) => {
      const rect = r.getBoundingClientRect();
      const box = scroller.getBoundingClientRect();
      return rect.top >= box.top - 4 && rect.top < box.bottom;
    });
    return {
      rows: rows.length,
      scrollHeight: scroller.scrollHeight,
      scrollTop: scroller.scrollTop,
      anchorText: (visible?.textContent ?? '').slice(0, 120),
    };
  });

  // Jump back to bottom.
  const bottomFrames = await sampleFramesDuring(page, async () => {
    await page.evaluate(() => {
      const scroller = document.querySelector('[data-testid="conversation-scroll-container"]');
      scroller.scrollTop = scroller.scrollHeight;
    });
    await sleep(500);
  });

  return {
    before,
    downWheel: downFrames,
    upWheel: upFrames,
    prepend: {
      pagingStatusAppeared: prependSeen,
      waitMs: prependWaitMs,
      ...afterPrepend,
      rowsAdded: afterPrepend.rows - before.rows,
    },
    jumpToBottom: bottomFrames,
  };
}

async function switchAwayAndBack(page, sessionId) {
  // Click another session (or New session), then back; measure reactivation.
  const rows = page.locator('aside [data-testid="sidebar-session-row"]');
  const count = await rows.count();
  let otherId = null;
  for (let i = 0; i < Math.min(count, 12); i++) {
    const id = await rows.nth(i).getAttribute('data-session-id');
    if (id && id !== sessionId) {
      otherId = id;
      break;
    }
  }
  const t0 = performance.now();
  if (otherId) {
    await page.locator(`aside [data-testid="sidebar-session-row"][data-session-id="${otherId}"]`).first().click();
  } else {
    await page.locator('aside button[title*="New session"]').first().click();
  }
  await sleep(700);
  const row = page.locator(`aside [data-testid="sidebar-session-row"][data-session-id="${sessionId}"]`).first();
  await row.click();
  await page.waitForSelector(
    '[data-testid="conversation-stream"] [data-testid="conversation-render-row"]',
    { timeout: 30_000, state: 'attached' },
  );
  const tBack = Math.round(performance.now() - t0);
  await page.waitForFunction(
    () => !document.querySelector('[data-testid="history-paging-status"]'),
    null,
    { timeout: 30_000 },
  ).catch(() => {});
  const tBackSettled = Math.round(performance.now() - t0);
  const stats = await page.evaluate(() => ({
    rows: document.querySelectorAll('[data-testid="conversation-render-row"]').length,
    userBubbles: document.querySelectorAll('[data-testid="user-message-bubble"]').length,
    pagingError: document.querySelector('[data-testid="history-paging-error"]')?.textContent ?? null,
  }));
  return { otherId, tBack, tBackSettled, stats };
}

async function reloadRestore(page, sessionId) {
  const t0 = performance.now();
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  await page.waitForSelector('[data-space-shell-ready]', { timeout: 60_000 });
  const tShell = Math.round(performance.now() - t0);
  // currentSessionId is not persisted — the user re-opens the session from the
  // sidebar after a reload. Expand the project, click the row, measure restore.
  await expandProject(page);
  const row = await ensureSessionRowVisible(page, sessionId);
  await row.click({ timeout: 15_000 });
  await page.waitForSelector(
    '[data-testid="conversation-stream"] [data-testid="conversation-render-row"]',
    { timeout: 30_000, state: 'attached' },
  ).catch(() => null);
  const tFirstRow = Math.round(performance.now() - t0);
  await page.waitForFunction(
    () => !document.querySelector('[data-testid="history-paging-status"]'),
    null,
    { timeout: 30_000 },
  ).catch(() => {});
  const tSettled = Math.round(performance.now() - t0);
  const stats = await page.evaluate(() => ({
    restoredSession: localStorage.getItem('kodax-space.currentProjectPath'),
    rows: document.querySelectorAll('[data-testid="conversation-render-row"]').length,
    userBubbles: document.querySelectorAll('[data-testid="user-message-bubble"]').length,
    pagingError: document.querySelector('[data-testid="history-paging-error"]')?.textContent ?? null,
  }));
  return { tShell, tFirstRow, tSettled, stats };
}

async function main() {
  const report = { startedAt: new Date().toISOString(), runs: [] };

  for (let run = 1; run <= RUNS; run++) {
    process.stdout.write(`[perf] launch ${run}/${RUNS}…\n`);
    const { app, page, timings, mainLog } = await launchRealApp();
    const runReport = { run, startup: timings, sessionLoads: [] };
    // Give sidebar/session-list a moment to hydrate before measuring IPC.
    await sleep(1_500);
    try {
      await expandProject(page);
      const list = await listSessions(page);
      runReport.sessionList = { ms: list.ms, count: list.result.ok ? list.result.sessions.length : null, error: list.result.ok ? null : list.result.error };

      const wanted = list.result.ok
        ? list.result.sessions.filter((s) => TARGETS.some((p) => s.sessionId.includes(p)))
        : [];
      if (wanted.length === 0) {
        runReport.sessionLoads.push({ error: `none of ${JSON.stringify(TARGETS)} found in session.list` });
      }
      for (const session of wanted) {
        process.stdout.write(`[perf] open session ${session.sessionId.slice(0, 24)}…\n`);
        const open = await measureSessionOpen(page, session.sessionId);
        const scroll = await scrollTest(page);
        const switchBack = await switchAwayAndBack(page, session.sessionId);
        const reload = await reloadRestore(page, session.sessionId);
        await page.locator('[data-testid="conversation-stream"]').screenshot({ path: path.join(REPORT_DIR, `session-${session.sessionId.slice(0, 24)}.png`) }).catch(() => {});
        runReport.sessionLoads.push({ sessionId: session.sessionId, title: session.title ?? null, open, scroll, switchBack, reload });
      }
    } catch (error) {
      runReport.error = String(error?.stack ?? error);
      await page.screenshot({ path: path.join(REPORT_DIR, `error-run${run}.png`) }).catch(() => {});
    } finally {
      runReport.mainLogTail = mainLog.lines.slice(-40);
      await closeApp(app);
    }
    report.runs.push(runReport);
    fs.writeFileSync(path.join(REPORT_DIR, 'report.json'), JSON.stringify(report, null, 2));
    await sleep(2_000);
  }

  fs.writeFileSync(path.join(REPORT_DIR, 'report.json'), JSON.stringify(report, null, 2));
  console.log(`[perf] report written to ${path.join(REPORT_DIR, 'report.json')}`);
}

main().catch((error) => {
  console.error('[perf] fatal:', error);
  process.exit(1);
});
