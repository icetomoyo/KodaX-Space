// E2E: real-runtime regression probe for v0.1.46-alpha (uses the real ~/.kodax
// profile and a real provider — sends a handful of tiny LLM queries).
//
// Every probe session is tracked by its explicit sessionId (resolved as the new
// entry in session.list after the first send) — never by sidebar position.
// Canonical ground truth comes from the session.history IPC, compared against
// what the stream paints.
//
// Scenarios map to historical issue classes:
//   r1  ordering baseline  — one short turn; switch away/back; reload; transcript
//                            stays single-copy, stable order (Issues 182/183/193).
//   r2  parallel tools     — one query → concurrent tool cards → settlement
//                            reconciliation keeps each card once, order stable
//                            across switch + reload (Issue 202).
//   r3  interrupt + follow-up — Stop mid-run (spinner must clear, Issue 165),
//                            follow-up send must not fail stale_run and must
//                            land BELOW the interrupted answer (Issues 193/174).
//   r4  sandbox probe      — bash tool echo; record sandbox containment label the
//                            UI shows and whether the command output round-trips
//                            (Issue 128 family).
//   r5  idempotent send    — double submit of the same draft produces exactly one
//                            bubble (Issue 194).
//
// Usage: node e2e/real-session-regression.mjs --scenarios r1,r2 [--project KodaX-Space]
// Writes artifacts/e2e-perf/real-session-report.json + screenshots.

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
const SCENARIOS = (argValue('--scenarios', 'r1,r2,r3,r4,r5') ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const PROJECT_HINT = argValue('--project', 'KodaX-Space');
const PROVIDER_HINT = argValue('--provider', '');
const MODEL_HINT = argValue('--model', '');
// A local proxy exported in the launching shell (e.g. HTTP(S)_PROXY=127.0.0.1:7897)
// is inherited by the app and can refuse/fail provider transports. Strip it so the
// probe exercises the provider path the way a normal desktop launch does.
const STRIP_PROXY = args.includes('--strip-proxy');
const TURN_TIMEOUT_MS = Number((argValue('--turn-timeout-ms', '180000') ?? '').replace(/_/g, ''));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const STOP_SELECTOR = 'button[aria-label="Stop generation"], button[aria-label="停止生成"]';

async function launchRealApp() {
  const childEnv = { ...process.env };
  delete childEnv.ELECTRON_RUN_AS_NODE;
  if (STRIP_PROXY) {
    for (const key of Object.keys(childEnv)) {
      if (/_(proxy|PROXY)$/.test(key) || /^(HTTP_PROXY|HTTPS_PROXY|ALL_PROXY|NO_PROXY)$/.test(key)) {
        delete childEnv[key];
      }
    }
  }
  const app = await electron.launch({
    args: [path.join(repoRoot, 'dist-electron')],
    cwd: repoRoot,
    env: { ...childEnv, NODE_ENV: 'production' },
    timeout: 60_000,
  });
  const mainLines = [];
  const onChunk = (chunk) => {
    for (const line of chunk.toString('utf8').split(/\r?\n/)) {
      if (line) mainLines.push({ t: Date.now(), line });
    }
  };
  app.process().stdout?.on('data', onChunk);
  app.process().stderr?.on('data', onChunk);
  let page = null;
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    page = app.windows().find((w) => !w.isClosed() && w.url().startsWith('app://space/'));
    if (page) break;
    await sleep(50);
  }
  if (!page) throw new Error('app://space renderer never opened');
  await page.waitForLoadState('domcontentloaded');
  await page.waitForSelector('[data-space-shell-ready]', { timeout: 60_000 });
  await sleep(1_500);
  return { app, page, mainLines };
}

async function scopeProject(page) {
  // Exact title match: the Ellipsis (project actions) button's aria-label also
  // contains the project name, so a substring match can open the wrong menu.
  const newInProject = page
    .locator('aside button[title="New session in this project"], aside button[title="在此项目中新建会话"]')
    .first();
  if (!(await newInProject.count())) {
    throw new Error(`project new-session button for ${PROJECT_HINT} not found`);
  }
  await newInProject.click();
  await sleep(500);
  return page.evaluate(() => localStorage.getItem('kodax-space.currentProjectPath'));
}

async function listSessionIds(page, projectRoot) {
  return page.evaluate(async (root) => {
    const r = await window.kodaxSpace.invoke('session.list', { projectRoot: root });
    if (!r.ok) return [];
    return (r.data.sessions ?? []).map((s) => s.sessionId);
  }, projectRoot);
}

async function newSession(page) {
  const newInProject = page
    .locator('aside button[title="New session in this project"], aside button[title="在此项目中新建会话"]')
    .first();
  if (await newInProject.count()) {
    await newInProject.click();
  } else {
    await page.locator('aside button[title*="New session"]').first().click();
  }
  await sleep(600);
}

async function send(page, text) {
  const textarea = page.locator('textarea').first();
  // fill() focuses and sets the value without a pointer event, so lingering
  // picker overlays cannot intercept the interaction.
  await textarea.fill(text);
  await textarea.press('Enter');
}

async function openSessionById(page, sessionId) {
  const selector = `aside [data-testid="sidebar-session-row"][data-session-id="${sessionId}"]`;
  await page.waitForSelector(selector, { timeout: 15_000, state: 'attached' });
  await page.locator(selector).first().click();
  await page
    .waitForFunction(
      () =>
        !document.querySelector('[aria-label="Loading conversation history"]') &&
        !document.querySelector('[aria-label="正在加载历史对话"]'),
      null,
      { timeout: 30_000 },
    )
    .catch(() => {});
  await sleep(500);
  await page
    .waitForFunction(() => !document.querySelector('[data-testid="history-paging-status"]'), null, {
      timeout: 30_000,
    })
    .catch(() => {});
}

async function transcriptState(page) {
  return page.evaluate(
    ({ stopSelector }) => {
      const rows = [...document.querySelectorAll('[data-testid="conversation-render-row"]')];
      const userBubbles = [...document.querySelectorAll('[data-testid="user-message-bubble"]')].map(
        (b) => (b.textContent ?? '').trim().slice(0, 60),
      );
      const toolCards = [...document.querySelectorAll('[data-testid="tool-call-card"]')].map(
        (card) => card.getAttribute('data-tool-name') ?? (card.textContent ?? '').slice(0, 40),
      );
      const streamText =
        document.querySelector('[data-testid="conversation-stream"]')?.textContent ?? '';
      const scroller = document.querySelector('[data-testid="conversation-scroll-container"]');
      const stop = document.querySelector(stopSelector);
      const stopActive = Boolean(stop && !stop.disabled);
      const spinnerRunning = Boolean(
        document.querySelector('[data-testid="conversation-stream"] .animate-spin'),
      );
      const sendingPending = /发送中|Sending\.\.\./.test(streamText.slice(-200));
      return {
        rows: rows.length,
        userBubbles,
        toolCards,
        runActive: stopActive || spinnerRunning || sendingPending,
        stopButtonVisible: stopActive,
        spinnerRunning,
        pagingStatus: Boolean(document.querySelector('[data-testid="history-paging-status"]')),
        pagingError:
          document.querySelector('[data-testid="history-paging-error"]')?.textContent ?? null,
        streamTail: streamText.slice(-400),
        scrollTop: scroller?.scrollTop ?? 0,
        scrollHeight: scroller?.scrollHeight ?? 0,
      };
    },
    { stopSelector: STOP_SELECTOR },
  );
}

async function readHistoryViaIpc(page, sessionId) {
  return page.evaluate(async (sid) => {
    const r = await window.kodaxSpace.invoke('session.history', {
      sessionId: sid,
      requestId: `probe-${Math.random().toString(36).slice(2, 10)}`,
    });
    if (!r.ok) return { ok: false, error: r.error?.message };
    const items = r.data.items ?? [];
    const kinds = {};
    for (const item of items) kinds[item.kind] = (kinds[item.kind] ?? 0) + 1;
    return { ok: true, count: items.length, kinds };
  }, sessionId);
}

/** Select a provider+model whose name matches PROVIDER_HINT via the composer picker. */
async function pickProviderByName(page) {
  if (!PROVIDER_HINT) return 'composer-default';
  const providerButton = page
    .locator('[data-testid="composer-footer-toolbar"] button')
    .filter({ hasText: /·|provider/i })
    .first();
  await providerButton.click();
  await sleep(700);
  const providerEntry = page
    .locator('button')
    .filter({ hasText: new RegExp(PROVIDER_HINT, 'i') })
    .first();
  if (!(await providerEntry.count())) {
    await page.keyboard.press('Escape');
    return `provider ${PROVIDER_HINT} not in picker`;
  }
  await providerEntry.click();
  await sleep(500);
  if (MODEL_HINT) {
    // Open the model selector and pick the entry matching the hint (e.g.
    // glm-5.3-flash); without a hint the provider default stays selected.
    const modelEntry = page.locator('button > span.font-mono').first();
    if (await modelEntry.isVisible().catch(() => false)) {
      await modelEntry.click();
      await sleep(500);
      const modelChoice = page
        .locator('button')
        .filter({ hasText: new RegExp(MODEL_HINT, 'i') })
        .first();
      if (await modelChoice.count()) {
        await modelChoice.click();
        await sleep(400);
      }
    }
  } else {
    const modelEntry = page.locator('button > span.font-mono').first();
    if (await modelEntry.isVisible().catch(() => false)) {
      await modelEntry.click();
    }
  }
  await sleep(300);
  // Close any lingering picker overlay so the composer is interactive again.
  await page.keyboard.press('Escape').catch(() => {});
  await sleep(400);
  return `picked ${PROVIDER_HINT}${MODEL_HINT ? ` / ${MODEL_HINT}` : ''} (composer readback: ${(await page
    .locator('[data-testid="composer-footer-toolbar"]')
    .textContent()
    .catch(() => ''))?.slice(0, 120)})`;
}

/**
 * Wait until a run is actively streaming; if a provider transport error kills
 * the turn, resend the prompt (same session) up to `attempts` times.
 */
async function waitForActiveRunWithRetry(page, prompt, attempts = 2, timeoutMs = 45_000) {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const state = await transcriptState(page);
      if (state.runActive && state.streamTail.length > 80) return true;
      if (!state.runActive && state.rows >= 2 && (await detectProviderError(page))) break;
      await sleep(400);
    }
    if (attempt < attempts) {
      await send(page, prompt);
      await sleep(800);
    }
  }
  return false;
}

/** Detect a terminal provider/transport failure painted in the stream. */
async function detectProviderError(page) {
  return page.evaluate(() => {
    const text = document.querySelector('[data-testid="conversation-stream"]')?.textContent ?? '';
    return /network_error|ECONNREFUSED|Provider network request failed|ETIMEDOUT|ENOTFOUND|429|rate limit/i.test(
      text,
    );
  });
}

async function waitForTurnEnd(page, timeoutMs = TURN_TIMEOUT_MS) {
  const start = Date.now();
  let started = false;
  while (Date.now() - start < timeoutMs) {
    const state = await transcriptState(page);
    if (state.runActive || state.rows >= 2) {
      started = true;
      break;
    }
    await sleep(400);
  }
  if (!started) {
    return { state: await transcriptState(page), ms: Date.now() - start, timedOut: true };
  }
  let lastLen = -1;
  let stableSince = null;
  while (Date.now() - start < timeoutMs) {
    const state = await transcriptState(page);
    const len = state.streamTail.length;
    if (state.runActive) {
      stableSince = null;
    } else if (len === lastLen) {
      stableSince ??= Date.now();
      if (Date.now() - stableSince >= 2_500) return { state, ms: Date.now() - start };
    } else {
      stableSince = null;
    }
    lastLen = len;
    await sleep(500);
  }
  return { state: await transcriptState(page), ms: Date.now() - start, timedOut: true };
}

/**
 * Resolve the probe session id: the session that appeared in the list after the
 * send. Takes a per-scenario baseline so earlier probe sessions are not mistaken
 * for this scenario's session.
 */
async function resolveProbeSessionId(page, projectRoot, beforeIds) {
  const before = new Set(beforeIds);
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const ids = await listSessionIds(page, projectRoot);
    const fresh = ids.find((id) => !before.has(id));
    if (fresh) return fresh;
    await sleep(500);
  }
  throw new Error('probe session never appeared in session.list');
}

async function cleanupProbeSessions(page, projectRoot, beforeIds) {
  const before = new Set(beforeIds);
  const now = await listSessionIds(page, projectRoot);
  const probeIds = now.filter((id) => !before.has(id));
  let deleted = 0;
  for (const id of probeIds) {
    const outcome = await page.evaluate(async (sessionId) => {
      const r = await window.kodaxSpace.invoke('session.delete', { sessionId });
      return r.ok;
    }, id);
    if (outcome) deleted += 1;
  }
  return { deleted, probeCount: probeIds.length };
}

const scenarios = {
  async r1(ctx) {
    const { page, shot, projectRoot } = ctx;
    await newSession(page);
    const baseline = await listSessionIds(page, projectRoot);
    await send(page, '只回复两个字：好的');
    const probeId = await resolveProbeSessionId(page, projectRoot, baseline);
    const end = await waitForTurnEnd(page);
    await sleep(2_000); // allow terminal reconciliation
    const beforeSwitch = await transcriptState(page);
    const ipcBefore = await readHistoryViaIpc(page, probeId);
    const problems = [];
    if (beforeSwitch.userBubbles.length !== 1) {
      problems.push(`userBubbles=${beforeSwitch.userBubbles.length} (expected 1)`);
    }
    if (beforeSwitch.runActive) problems.push('run still active after turn end');
    if (beforeSwitch.pagingError) problems.push(`pagingError=${beforeSwitch.pagingError}`);

    // Switch away and back.
    const rows = page.locator('aside [data-testid="sidebar-session-row"]');
    if ((await rows.count()) >= 2) {
      await rows.nth(1).click();
    } else {
      await newSession(page);
    }
    await sleep(800);
    await openSessionById(page, probeId);
    const afterSwitch = await transcriptState(page);
    const ipcAfterSwitch = await readHistoryViaIpc(page, probeId);
    if (afterSwitch.userBubbles.length !== 1) {
      problems.push(`switch changed userBubbles to ${afterSwitch.userBubbles.length}`);
    }
    if (afterSwitch.pagingError) problems.push(`switch pagingError=${afterSwitch.pagingError}`);
    if (afterSwitch.rows < beforeSwitch.rows) {
      problems.push(`switch SHRANK rows ${beforeSwitch.rows}→${afterSwitch.rows}`);
    }

    // Reload (cold renderer) and re-open by id.
    await page.reload();
    await page.waitForSelector('[data-space-shell-ready]', { timeout: 60_000 });
    await openSessionById(page, probeId);
    const afterReload = await transcriptState(page);
    const ipcAfterReload = await readHistoryViaIpc(page, probeId);
    if (afterReload.userBubbles.length !== 1) {
      problems.push(`reload changed userBubbles to ${afterReload.userBubbles.length}`);
    }
    if (afterReload.pagingError) problems.push(`reload pagingError=${afterReload.pagingError}`);
    if (afterReload.rows < beforeSwitch.rows) {
      problems.push(`reload SHRANK rows ${beforeSwitch.rows}→${afterReload.rows}`);
    }
    // Canonical history must contain the user query and the answer, once.
    for (const [label, ipc] of [
      ['before', ipcBefore],
      ['switch', ipcAfterSwitch],
      ['reload', ipcAfterReload],
    ]) {
      if (!ipc.ok) {
        problems.push(`history IPC (${label}) failed: ${ipc.error}`);
      } else if ((ipc.kinds.user ?? 0) !== 1) {
        problems.push(`history IPC (${label}) user items=${ipc.kinds.user ?? 0} (expected 1)`);
      }
    }
    await shot('r1-final');
    return {
      probeId,
      turnMs: end.ms,
      timedOut: end.timedOut ?? false,
      beforeSwitch,
      afterSwitch,
      afterReload,
      ipc: { before: ipcBefore, switch: ipcAfterSwitch, reload: ipcAfterReload },
      problems,
    };
  },

  async r2(ctx) {
    const { page, shot, projectRoot } = ctx;
    await newSession(page);
    let baseline = await listSessionIds(page, projectRoot);
    await send(
      page,
      '请同时(并行)读取 package.json 和 README.md 两个文件，然后各用一句话总结。必须使用工具读取。',
    );
    let probeId = await resolveProbeSessionId(page, projectRoot, baseline);
    await sleep(3_000);
    const mid = await transcriptState(page);
    await waitForTurnEnd(page, Math.max(TURN_TIMEOUT_MS, 150_000));
    // A provider outage (e.g. transient ECONNREFUSED) invalidates tool/order
    // assertions — retry the turn once before giving up.
    let providerRetried = false;
    if (await detectProviderError(page)) {
      await send(
        page,
        '再试一次：请同时(并行)读取 package.json 和 README.md 两个文件，然后各用一句话总结。必须使用工具读取。',
      );
      await waitForTurnEnd(page, Math.max(TURN_TIMEOUT_MS, 150_000));
      providerRetried = true;
      await sleep(2_000);
    }
    if (await detectProviderError(page)) {
      await shot('r2-final');
      return {
        probeId,
        providerRetried,
        providerError: true,
        problems: ['provider transport error persisted (E2E environment) — scenario inconclusive'],
      };
    }
    await sleep(2_000); // allow settlement reconciliation
    const settled = await transcriptState(page);
    const problems = [];
    if (mid.userBubbles.length !== 1) problems.push(`mid-run userBubbles=${mid.userBubbles.length}`);
    if (settled.userBubbles.length !== 1) problems.push(`settled userBubbles=${settled.userBubbles.length}`);
    if (settled.pagingError) problems.push(`settled pagingError=${settled.pagingError}`);
    const toolOrder = settled.toolCards;

    const rows = page.locator('aside [data-testid="sidebar-session-row"]');
    if ((await rows.count()) >= 2) {
      await rows.nth(1).click();
    } else {
      await newSession(page);
    }
    await sleep(800);
    await openSessionById(page, probeId);
    const afterSwitch = await transcriptState(page);

    await page.reload();
    await page.waitForSelector('[data-space-shell-ready]', { timeout: 60_000 });
    await openSessionById(page, probeId);
    const afterReload = await transcriptState(page);
    const ipcAfterReload = await readHistoryViaIpc(page, probeId);

    // Order must be stable; counts must not duplicate across stages.
    if (JSON.stringify(afterSwitch.toolCards) !== JSON.stringify(toolOrder)) {
      problems.push(`switch changed tool order: ${JSON.stringify(toolOrder)}→${JSON.stringify(afterSwitch.toolCards)}`);
    }
    if (JSON.stringify(afterReload.toolCards) !== JSON.stringify(toolOrder)) {
      problems.push(`reload changed tool order: ${JSON.stringify(toolOrder)}→${JSON.stringify(afterReload.toolCards)}`);
    }
    if (afterReload.userBubbles.length !== 1) problems.push(`reload userBubbles=${afterReload.userBubbles.length}`);
    if (afterSwitch.userBubbles.length !== 1) problems.push(`switch userBubbles=${afterSwitch.userBubbles.length}`);
    if (!ipcAfterReload.ok) problems.push(`history IPC failed: ${ipcAfterReload.error}`);
    else if ((ipcAfterReload.kinds.user ?? 0) !== 1) {
      problems.push(`history IPC user items=${ipcAfterReload.kinds.user ?? 0} (expected 1)`);
    }
    await shot('r2-final');
    return {
      probeId,
      providerRetried,
      midRun: mid,
      settled,
      afterSwitch,
      afterReload,
      ipcAfterReload,
      toolCardCounts: {
        settled: settled.toolCards.length,
        switched: afterSwitch.toolCards.length,
        reloaded: afterReload.toolCards.length,
      },
      problems,
    };
  },

  async r3(ctx) {
    const { page, shot, projectRoot } = ctx;
    await newSession(page);
    const baseline = await listSessionIds(page, projectRoot);
    await send(page, '请从1数到60，每行输出一个数字，不要省略。');
    const probeId = await resolveProbeSessionId(page, projectRoot, baseline);
    const stopPrompt = '请从1数到60，每行输出一个数字，不要省略。';
    const streaming = await waitForActiveRunWithRetry(page, stopPrompt, 2, 45_000);
    if (!streaming) {
      await shot('r3-no-stream');
      return { probeId, pass: false, problems: ['provider could not start a streamable turn (E2E environment) — scenario inconclusive'] };
    }
    await sleep(1_500);
    const stopButton = page.locator(STOP_SELECTOR).first();
    if (!(await stopButton.count())) throw new Error('Stop button not found while run active');
    await stopButton.click();
    await sleep(1_000);
    await shot('r3-after-stop');
    // Watch for the Issue 165 stuck-indicator window.
    let clearedMs = null;
    const start = Date.now();
    while (Date.now() - start < 45_000) {
      const state = await transcriptState(page);
      if (!state.runActive) {
        clearedMs = Date.now() - start;
        break;
      }
      await sleep(400);
    }
    const interruptState = await transcriptState(page);
    // Follow-up send must be admitted (not stale_run) and land after the partial answer.
    await send(page, '好的，现在只回复两个字：完成');
    const followUp = await waitForTurnEnd(page);
    const final = followUp.state;
    const problems = [];
    if (clearedMs === null) {
      problems.push('Issue165 symptom: spinner/stop indicator did not clear within 45s after Stop');
    }
    if (final.userBubbles.length !== 2) {
      problems.push(`userBubbles=${final.userBubbles.length} (expected 2: original + follow-up)`);
    }
    if (followUp.timedOut) problems.push('follow-up turn did not settle in time');
    if (/stale_run|session_data_changed/i.test(final.streamTail)) {
      problems.push('follow-up surfaced stale_run/session_data_changed');
    }
    if (!/完成/.test(final.streamTail)) problems.push('follow-up answer missing from tail');
    await sleep(2_000);
    const ipc = await readHistoryViaIpc(page, probeId);
    if (!ipc.ok) problems.push(`history IPC failed: ${ipc.error}`);
    else if ((ipc.kinds.user ?? 0) !== 2) {
      problems.push(`history IPC user items=${ipc.kinds.user ?? 0} (expected 2)`);
    }
    await shot('r3-final');
    return { probeId, clearedMs, interruptState, final, ipc, problems };
  },

  async r4(ctx) {
    const { page, shot, projectRoot } = ctx;
    await newSession(page);
    const baseline = await listSessionIds(page, projectRoot);
    await send(page, '请用 bash 工具执行命令 `echo kodax-sandbox-e2e-probe`，然后把输出原样告诉我。');
    const probeId = await resolveProbeSessionId(page, projectRoot, baseline);
    let end = await waitForTurnEnd(page, Math.max(TURN_TIMEOUT_MS, 150_000));
    if (await detectProviderError(page)) {
      await send(page, '再试一次：请用 bash 工具执行命令 `echo kodax-sandbox-e2e-probe`，然后把输出原样告诉我。');
      end = await waitForTurnEnd(page, Math.max(TURN_TIMEOUT_MS, 150_000));
    }
    const state = end.state;
    const problems = [];
    if (await detectProviderError(page)) {
      await shot('r4-final');
      return { probeId, providerError: true, problems: ['provider transport error persisted (E2E environment) — scenario inconclusive'] };
    }
    if (!state.streamTail.includes('kodax-sandbox-e2e-probe')) {
      problems.push('bash echo output did not round-trip into the transcript');
    }
    const sandboxLabels = await page.evaluate(() => {
      const text = document.querySelector('[data-testid="conversation-stream"]')?.textContent ?? '';
      const matches = text.match(/sandbox[^.]{0,80}/gi);
      return matches?.slice(0, 5) ?? [];
    });
    const ipc = await readHistoryViaIpc(page, probeId);
    await shot('r4-final');
    return {
      probeId,
      turnMs: end.ms,
      timedOut: end.timedOut ?? false,
      sandboxLabels,
      ipc,
      streamTail: state.streamTail,
      problems,
    };
  },

  async r5(ctx) {
    const { page, shot, projectRoot } = ctx;
    await newSession(page);
    const text = '幂等发送探针：只回复两个字：收到';
    const textarea = page.locator('textarea').first();
    await textarea.fill(text);
    await textarea.press('Enter');
    await textarea.press('Enter').catch(() => {});
    await sleep(400);
    const baseline = await listSessionIds(page, projectRoot);
    const probeId = await resolveProbeSessionId(page, projectRoot, baseline);
    const end = await waitForTurnEnd(page);
    const state = end.state;
    const problems = [];
    if (state.userBubbles.length !== 1) {
      problems.push(`userBubbles=${state.userBubbles.length} after double submit (expected 1)`);
    }
    const ipc = await readHistoryViaIpc(page, probeId);
    if (ipc.ok && (ipc.kinds.user ?? 0) !== 1) {
      problems.push(`history IPC user items=${ipc.kinds.user ?? 0} (expected 1)`);
    }
    await shot('r5-final');
    return { probeId, turnMs: end.ms, state, ipc, problems };
  },
  async r6(ctx) {
    // User-reported reproducible bug: in one session, after turn 1 completes,
    // the turn-2 answer never paints in the live transcript (Ctrl+R shows it).
    const { page, shot, projectRoot } = ctx;
    await newSession(page);
    const baseline = await listSessionIds(page, projectRoot);
    await send(page, '用不超过60字解释：React 19 的 use() Hook 是什么。');
    const probeId = await resolveProbeSessionId(page, projectRoot, baseline);
    const turn1 = await waitForTurnEnd(page, Math.max(TURN_TIMEOUT_MS, 150_000));
    await sleep(3_000); // allow terminal reconciliation like a normal user pause
    const afterTurn1 = await transcriptState(page);

    await send(page, '它和 useEffect 有什么区别？不超过60字。');
    const turn2 = await waitForTurnEnd(page, Math.max(TURN_TIMEOUT_MS, 150_000));
    if (await detectProviderError(page)) {
      await send(page, '再试一次：它和 useEffect 有什么区别？不超过60字。');
      await waitForTurnEnd(page, Math.max(TURN_TIMEOUT_MS, 150_000));
      await sleep(3_000);
    }
    if (await detectProviderError(page)) {
      await shot('r6-final');
      return {
        probeId,
        providerError: true,
        problems: ['provider transport error persisted (E2E environment) — scenario inconclusive'],
      };
    }
    // Sample for late self-heal (revalidation) up to 15s after settle. The turn-2 query itself
    // contains the answer keywords, so paint detection is structural: a rendered row AFTER the
    // second user bubble (turn 1 + query 2 alone are 4 rows).
    let answer2PaintedAt = null;
    const sampleStart = Date.now();
    while (Date.now() - sampleStart < 15_000) {
      const state = await transcriptState(page);
      if (state.userBubbles.length >= 2 && state.rows >= 5) {
        answer2PaintedAt = Date.now() - sampleStart;
        break;
      }
      await sleep(500);
    }
    const afterTurn2 = await transcriptState(page);
    const problems = [];
    if (afterTurn1.userBubbles.length !== 1) {
      problems.push(`turn1 userBubbles=${afterTurn1.userBubbles.length}`);
    }
    if (afterTurn2.userBubbles.length !== 2) {
      problems.push(`turn2 userBubbles=${afterTurn2.userBubbles.length} (expected 2)`);
    }
    if (afterTurn2.pagingError) problems.push(`turn2 pagingError=${afterTurn2.pagingError}`);
    const tailHasAnswer2 = afterTurn2.rows >= 5;
    if (!tailHasAnswer2) {
      problems.push(
        `REPRODUCED: turn-2 answer missing from live transcript after settle+15s (rows=${afterTurn2.rows})`,
      );
    }
    // Reload must recover the answer from canonical history.
    await page.reload();
    await page.waitForSelector('[data-space-shell-ready]', { timeout: 60_000 });
    await openSessionById(page, probeId);
    const afterReload = await transcriptState(page);
    const ipc = await readHistoryViaIpc(page, probeId);
    const reloadHasAnswer2 = /(Suspense|useEffect|区别)/i.test(afterReload.streamTail);
    if (!reloadHasAnswer2) problems.push('reload also missing turn-2 answer (canonical lost?)');
    await shot('r6-final');
    return {
      probeId,
      turn1Ms: turn1.ms,
      turn2Ms: turn2.ms,
      answer2PaintedLateMs: answer2PaintedAt,
      afterTurn1: { rows: afterTurn1.rows, tail: afterTurn1.streamTail.slice(-160) },
      afterTurn2: { rows: afterTurn2.rows, tail: afterTurn2.streamTail.slice(-200) },
      afterReload: { rows: afterReload.rows, tail: afterReload.streamTail.slice(-200) },
      ipc,
      problems,
    };
  },
  async r7(ctx) {
    // Customer-shaped repro on the released alpha: turn 2 is sent after a long pause with the
    // window MINIMIZED (occluded/throttled) while the agent runs. Canonical serving is probed
    // through session.history the whole time so a renderer-only hold becomes provable: if the
    // IPC page contains the answer but the restored window still does not paint it without a
    // reload, the live render pipeline (not persistence) is losing the turn.
    const { app, page, shot, projectRoot } = ctx;
    await newSession(page);
    const baseline = await listSessionIds(page, projectRoot);
    await send(page, '用不超过60字解释：React 19 的 use() Hook 是什么。');
    const probeId = await resolveProbeSessionId(page, projectRoot, baseline);
    await waitForTurnEnd(page, Math.max(TURN_TIMEOUT_MS, 150_000));
    await sleep(5_000);
    // Customer pause between turns: ~78s.
    await sleep(75_000);

    const minimize = () =>
      app.evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows().forEach((w) => w.minimize());
      });
    const restore = () =>
      app.evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows().forEach((w) => w.restore());
      });
    const statusSnapshot = () =>
      page.evaluate(async (sid) => {
        const r = await window.kodaxSpace.invoke('session.liveSnapshot', { sessionId: sid });
        if (!r.ok) return { ok: false };
        return {
          ok: true,
          activeRun: r.data.activeRun
            ? { phase: r.data.activeRun.phase, turnId: r.data.activeRun.turnId }
            : null,
          lastTerminalRun: r.data.lastTerminalRun
            ? { phase: r.data.lastTerminalRun.phase, turnId: r.data.lastTerminalRun.turnId }
            : null,
        };
      }, probeId);

    await minimize();
    await send(page, '它和 useEffect 有什么区别？不超过60字。');
    const timeline = [];
    const start = Date.now();
    let historyHasAnswerAt = null;
    let domPaintedWhileMinimizedAtMs = null;
    let firstFailSample = null;
    // The turn-2 query itself contains the answer keywords, so text matching is vacuous.
    // Structural signal instead: a rendered row AFTER the second user bubble (thinking chip
    // or answer block) — turn 1 + query 2 alone are 4 rows.
    const turn2ContentPainted = (state) => state.rows >= 5 || state.spinnerRunning || state.stopButtonVisible;
    while (Date.now() - start < 240_000) {
      const state = await transcriptState(page);
      const status = await statusSnapshot();
      const ipc = await readHistoryViaIpc(page, probeId);
      const painted = turn2ContentPainted(state);
      const histHas = ipc.ok && (ipc.kinds.assistant ?? 0) >= 2;
      if (histHas && historyHasAnswerAt === null) historyHasAnswerAt = Date.now() - start;
      if (painted && domPaintedWhileMinimizedAtMs === null) domPaintedWhileMinimizedAtMs = Date.now() - start;
      timeline.push({
        t: Date.now() - start,
        rows: state.rows,
        bubbles: state.userBubbles.length,
        painted,
        histAssistant: ipc.ok ? (ipc.kinds.assistant ?? 0) : null,
        runPhase: status.ok ? (status.activeRun?.phase ?? status.lastTerminalRun?.phase ?? null) : 'ipc-fail',
        terminalTurnId: status.ok ? (status.lastTerminalRun?.turnId ?? null) : null,
        minimized: true,
      });
      if (painted && historyHasAnswerAt !== null) break;
      await sleep(3_000);
    }
    // Restore WITHOUT reload. A healthy pipeline must paint the already-persisted answer now.
    await restore();
    await sleep(4_000);
    let restoredPainted = null;
    const restoreStart = Date.now();
    while (Date.now() - restoreStart < 45_000) {
      const state = await transcriptState(page);
      restoredPainted = turn2ContentPainted(state);
      timeline.push({
        t: Date.now() - start,
        rows: state.rows,
        bubbles: state.userBubbles.length,
        painted: restoredPainted,
        restored: true,
      });
      if (restoredPainted) break;
      await sleep(3_000);
    }
    if (restoredPainted !== true) {
      firstFailSample = await transcriptState(page);
    }
    await shot('r7-restored');
    // Reload proves canonical was always complete.
    await page.reload();
    await page.waitForSelector('[data-space-shell-ready]', { timeout: 60_000 });
    await openSessionById(page, probeId);
    const afterReload = await transcriptState(page);
    const reloadHasAnswer = afterReload.rows >= 5;
    const problems = [];
    if (historyHasAnswerAt === null) problems.push('history IPC never showed the answer');
    if (restoredPainted !== true) {
      problems.push(
        `REPRODUCED: answer in canonical but restored window did not paint it without reload (paintedAfterRestore=${restoredPainted}, reloadRows=${afterReload.rows}, tail=${JSON.stringify((firstFailSample ?? afterReload).streamTail.slice(-160))})`,
      );
    }
    return {
      probeId,
      historyHasAnswerAtMs: historyHasAnswerAt,
      domPaintedWhileMinimizedAtMs,
      domPaintedAfterRestoreMs: restoredPainted === true ? Date.now() - restoreStart : null,
      reloadHasAnswer,
      timeline: timeline.filter((_, i) => i % 3 === 0 || timeline[i].painted || timeline[i].restored),
      problems,
    };
  },
  async r8(ctx) {
    // Deterministic repro of the "answer only visible after refresh" class: the main process
    // drops EVERY renderer push for this Session (deltas, terminal, live projection) during
    // turn 2, simulating any missed-notification trigger. Canonical keeps persisting, so the
    // transcript must converge through a renderer-driven revalidation — a focus edge (user
    // switches away and back) is the minimum such moment. RED on a build where a ready page
    // has no canonical revalidation path; GREEN once the focus edge converges it.
    const { app, page, shot, projectRoot } = ctx;
    await newSession(page);
    const baseline = await listSessionIds(page, projectRoot);
    await send(page, '用不超过60字解释：React 19 的 use() Hook 是什么。');
    const probeId = await resolveProbeSessionId(page, projectRoot, baseline);
    await waitForTurnEnd(page, Math.max(TURN_TIMEOUT_MS, 150_000));
    await sleep(5_000);

    const suppressed = await app.evaluate(({ BrowserWindow }, sid) => {
      const win = BrowserWindow.getAllWindows()[0];
      if (!win) return false;
      const wc = win.webContents;
      const original = wc.send.bind(wc);
      wc.send = (channel, ...args) => {
        if (
          (channel === 'session.event' ||
            channel === 'session.liveChanged' ||
            channel === 'session.liveInvalidated') &&
          args[0] &&
          typeof args[0] === 'object' &&
          args[0].sessionId === sid
        ) {
          return true;
        }
        return original(channel, ...args);
      };
      return true;
    }, probeId);
    if (!suppressed) throw new Error('could not install the push suppressor');

    await send(page, '它和 useEffect 有什么区别？不超过60字。');
    const start = Date.now();
    let historySettledAt = null;
    let bubblesAfterSend = 0;
    while (Date.now() - start < 180_000) {
      const state = await transcriptState(page);
      const ipc = await readHistoryViaIpc(page, probeId);
      bubblesAfterSend = state.userBubbles.length;
      if (ipc.ok && (ipc.kinds.assistant ?? 0) >= 2 && historySettledAt === null) {
        historySettledAt = Date.now() - start;
        break;
      }
      await sleep(3_000);
    }
    if (historySettledAt === null) {
      return { probeId, problems: ['canonical never settled under suppression — scenario inconclusive'] };
    }
    await sleep(3_000);
    const staleState = await transcriptState(page);
    const staleRows = staleState.rows;

    // Switch away and back (blur + focus): the natural user moment that must converge the
    // transcript to canonical without a manual reload.
    await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      win.blur();
      setTimeout(() => win.focus(), 800);
    });
    let selfHealed = false;
    const focusStart = Date.now();
    while (Date.now() - focusStart < 30_000) {
      await sleep(2_500);
      const state = await transcriptState(page);
      if (state.rows >= 5) {
        selfHealed = true;
        break;
      }
    }
    await shot('r8-focus');
    await page.reload();
    await page.waitForSelector('[data-space-shell-ready]', { timeout: 60_000 });
    await openSessionById(page, probeId);
    const afterReload = await transcriptState(page);
    const reloadRows = afterReload.rows;
    const problems = [];
    if (bubblesAfterSend < 2) {
      problems.push(`optimistic turn-2 bubble missing under suppression (${bubblesAfterSend})`);
    }
    if (!selfHealed) {
      problems.push(
        `REPRODUCED: canonical settled at +${historySettledAt}ms but the painted transcript stayed at ${staleRows} rows and a blur+focus edge did NOT converge it (rows after focus=${selfHealed ? '>=5' : '<5'}; reload rows=${reloadRows})`,
      );
    }
    return {
      probeId,
      suppressed: true,
      historySettledAtMs: historySettledAt,
      staleRowsBeforeFocus: staleRows,
      selfHealedOnFocus: selfHealed,
      reloadRows,
      problems,
    };
  },
};

async function main() {
  const report = { startedAt: new Date().toISOString(), project: PROJECT_HINT, scenarios: {} };
  const state = { beforeIds: [] };
  const { app, page, mainLines } = await launchRealApp();
  const shot = async (name) =>
    page.screenshot({ path: path.join(REPORT_DIR, `real-${name}.png`), fullPage: false }).catch(() => {});
  try {
    const projectRoot = await scopeProject(page);
    if (!projectRoot) throw new Error('currentProjectPath not persisted after project scoping');
    if (process.argv.includes('--list-providers')) {
      const shotDir = path.join('artifacts', 'e2e-perf');
      const toolbar = page.locator('[data-testid="composer-footer-toolbar"]');
      process.stdout.write(`[real-e2e] toolbar text: ${(await toolbar.textContent().catch(() => ''))?.slice(0, 200)}\n`);
      await page.screenshot({ path: path.join(shotDir, 'picker-before.png') });
      const providerButton = page
        .locator('[data-testid="composer-footer-toolbar"] button')
        .filter({ hasText: /·|provider/i })
        .first();
      process.stdout.write(`[real-e2e] provider button count: ${await providerButton.count()}\n`);
      await providerButton.click();
      await sleep(800);
      await page.screenshot({ path: path.join(shotDir, 'picker-open.png') });
      const entries = await page.locator('button').allTextContents();
      process.stdout.write(`[real-e2e] picker entries:\n${entries.filter(Boolean).map((t) => `  - ${t}`).join('\n')}\n`);
      await page.keyboard.press('Escape').catch(() => {});
      await app.close();
      return;
    }
    if (PROVIDER_HINT) {
      report.providerPick = await pickProviderByName(page);
      process.stdout.write(`[real-e2e] provider: ${report.providerPick}
`);
    }
    state.beforeIds = await listSessionIds(page, projectRoot);
    for (const name of SCENARIOS) {
      const fn = scenarios[name];
      if (!fn) {
        report.scenarios[name] = { error: `unknown scenario ${name}` };
        continue;
      }
      process.stdout.write(`[real-e2e] scenario ${name}…\n`);
      const started = Date.now();
      try {
        const result = await fn({ app, page, shot, projectRoot, beforeIds: state.beforeIds });
        result.ms = Date.now() - started;
        result.pass = (result.problems ?? []).length === 0;
        report.scenarios[name] = result;
        process.stdout.write(`[real-e2e] ${name} ${result.pass ? 'PASS' : 'FAIL'}\n`);
      } catch (error) {
        report.scenarios[name] = { pass: false, error: String(error?.stack ?? error) };
        await shot(`${name}-error`);
        process.stdout.write(`[real-e2e] ${name} ERROR: ${error}\n`);
      }
      fs.writeFileSync(path.join(REPORT_DIR, 'real-session-report.json'), JSON.stringify(report, null, 2));
    }
  } finally {
    fs.writeFileSync(
      path.join(REPORT_DIR, 'real-session-main.log'),
      mainLines.map((l) => `[${new Date(l.t).toISOString()}] ${l.line}`).join('\n'),
    );
    report.mainLogLineCount = mainLines.length;
    try {
      const projectRoot = await page.evaluate(() =>
        localStorage.getItem('kodax-space.currentProjectPath'),
      );
      if (projectRoot) {
        report.cleanup = await cleanupProbeSessions(page, projectRoot, state.beforeIds);
      }
    } catch (cleanupError) {
      report.cleanupError = String(cleanupError);
    }
    fs.writeFileSync(path.join(REPORT_DIR, 'real-session-report.json'), JSON.stringify(report, null, 2));
    try {
      await Promise.race([app.close(), sleep(20_000).then(() => 'timeout')]);
    } catch {
      /* ignore */
    }
    try {
      app.process().kill();
    } catch {
      /* already gone */
    }
  }
  const failed = Object.entries(report.scenarios).filter(([, r]) => r.pass === false);
  console.log(
    `[real-e2e] done. ${Object.keys(report.scenarios).length - failed.length} pass, ${failed.length} fail. Report: artifacts/e2e-perf/real-session-report.json`,
  );
  if (failed.length > 0) process.exitCode = 2;
}

main().catch((error) => {
  console.error('[real-e2e] fatal:', error);
  process.exit(1);
});
