// Playwright Electron — 真实跑通 GLM-5.1 session
//
// 步骤：
//   1. 启动 Electron (dev mode, 连 Vite http://127.0.0.1:5173)
//   2. 在 main 端 stub electron.dialog.showOpenDialog → 返回 repoRoot
//   3. renderer: 点 + → Add folder → 自动切到 repoRoot 作 project
//   4. 切 provider picker → zhipu-coding；effort = Medium
//   5. 输入 "你好" 回车 → 自动建 session + send
//   6. 等流式响应 (≤ 90s 超时)
//   7. 截图：dashboard / picker / typing / streaming / response / context menu / attach menu

import { _electron as electron } from 'playwright';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const SHOT_DIR = 'c:/tmp/glm-session';
fs.mkdirSync(SHOT_DIR, { recursive: true });

async function main() {
  console.log('[e2e] launching Electron…');
  console.log('[e2e] repoRoot =', repoRoot);

  // ELECTRON_RUN_AS_NODE=1 在用户 shell 里 export 着，会让 electron 以 Node 模式
  // 启动 (不弹窗)。从子进程 env 显式删除 — memory: env_electron_run_as_node.md
  const childEnv = { ...process.env };
  delete childEnv.ELECTRON_RUN_AS_NODE;

  const app = await electron.launch({
    args: [path.join(repoRoot, 'dist-electron')], // 同 dev.mjs：传目录而非 main.js
    cwd: repoRoot,
    env: {
      ...childEnv,
      VITE_DEV_SERVER_URL: 'http://127.0.0.1:5173',
      NODE_ENV: 'development',
    },
    timeout: 30_000,
  });

  // 在 main 端 stub dialog — 让 project.openDialog 不弹真窗口直接返回 repoRoot
  await app.evaluate(async ({ dialog }, root) => {
    dialog.showOpenDialog = async () => {
      console.log('[main-stub] dialog.showOpenDialog → returning', root);
      return { canceled: false, filePaths: [root] };
    };
  }, repoRoot);
  console.log('[e2e] dialog stub installed');

  // dev 模式会 openDevTools({mode:'detach'}) — firstWindow() 可能拿到 DevTools。
  // 通过 URL 区分：app 是 http://127.0.0.1:5173；DevTools 是 devtools:// 协议
  let win = null;
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const windows = app.windows();
    for (const w of windows) {
      const url = w.url();
      if (
        url.startsWith('http://127.0.0.1:5173') ||
        url.startsWith('app://space/') ||
        url.startsWith('file://')
      ) {
        win = w;
        break;
      }
    }
    if (win) break;
    await app.firstWindow().catch(() => {});
    await new Promise((r) => setTimeout(r, 500));
  }
  if (!win) throw new Error('app window not found (only DevTools?)');
  await win.waitForLoadState('domcontentloaded');
  console.log('[e2e] app window loaded:', win.url());

  // collect console errors
  const consoleErrors = [];
  win.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });

  await win.waitForTimeout(2000);
  await win.screenshot({ path: `${SHOT_DIR}/00-welcome-dashboard.png`, fullPage: false });
  console.log('[e2e] 00 — welcome dashboard captured');

  // 1) 通过 + 加号菜单 → Add folder 触发 dialog (已 stub) → 设当前 project
  console.log('[e2e] opening Attach menu');
  await win.locator('button[aria-label="Open attach menu"]').click();
  await win.waitForTimeout(400);
  await win.screenshot({ path: `${SHOT_DIR}/01-attach-menu.png`, fullPage: false });

  console.log('[e2e] clicking "Add folder"');
  await win.locator('button:has-text("Add folder")').click();
  await win.waitForTimeout(2000);
  await win.screenshot({ path: `${SHOT_DIR}/02-project-set.png`, fullPage: false });

  // 2) 切 provider → zhipu-coding，effort = Medium
  console.log('[e2e] opening provider picker');
  // 右下角按钮：文字 "pick provider · ..." 或 "(next)" — 用更宽松的 selector
  const providerBtn = win
    .locator('button[title*="provider"], button[title*="Pick provider"]')
    .first();
  await providerBtn.click({ timeout: 5000 }).catch(async () => {
    // fallback: 找 footer-bottom bar 里的 font-mono 按钮
    await win.locator('div.relative > button.font-mono').last().click({ timeout: 3000 });
  });
  await win.waitForTimeout(500);
  await win.screenshot({ path: `${SHOT_DIR}/03-picker-open.png`, fullPage: false });

  // 新 2-col picker：左列点 provider → 右列出 models → 点 model 才一次性 commit
  // provider+model。Medium effort 在底部行单独点。
  console.log('[e2e] picking Zhipu Coding Plan provider (left col)');
  const zhipuBtn = win.locator('div.border-r button:has-text("Zhipu Coding Plan")').first();
  const zhipuVisible = await zhipuBtn.isVisible().catch(() => false);
  if (zhipuVisible) {
    await zhipuBtn.click();
    console.log('[e2e] ✓ provider previewed');
  } else {
    console.error('[e2e] Zhipu Coding Plan NOT in picker — listing visible providers:');
    const allBtns = await win.locator('div.border-r button[title]').allTextContents();
    console.error(allBtns);
    throw new Error('zhipu-coding not configured (no ZHIPU_API_KEY or not in catalog?)');
  }
  await win.waitForTimeout(400);

  // 点右列第一个 model → 一次性 commit provider+model
  console.log('[e2e] picking first model from right column');
  const firstModelBtn = win.locator('button > span.font-mono').first();
  if (await firstModelBtn.isVisible().catch(() => false)) {
    await firstModelBtn.click();
    console.log('[e2e] ✓ model committed (provider+model done)');
  }
  await win.waitForTimeout(400);

  // 重开 picker 选 Medium effort（底部行）
  await win.keyboard.press('Control+i');
  await win.waitForTimeout(400);
  console.log('[e2e] picking Medium effort');
  const mediumBtn = win.locator('button:has-text("Medium")').first();
  if (await mediumBtn.isVisible().catch(() => false)) {
    await mediumBtn.click();
  }
  await win.waitForTimeout(300);

  // close picker
  await win.keyboard.press('Control+i');
  await win.waitForTimeout(300);
  await win.screenshot({ path: `${SHOT_DIR}/04-provider-picked.png`, fullPage: false });

  // 3) 输入 "你好" 回车
  console.log('[e2e] typing 你好');
  const textarea = win.locator('textarea').first();
  await textarea.click();
  await textarea.fill('你好');
  await win.screenshot({ path: `${SHOT_DIR}/05-typed.png`, fullPage: false });
  await textarea.press('Enter');
  console.log('[e2e] sent; waiting for response stream…');

  // 4) 等响应 — 检测 ConversationStream 出现有内容的 assistant text
  const startedAt = Date.now();
  const TIMEOUT_MS = 90_000;
  let gotResponse = false;
  let lastShotAt = 0;
  while (Date.now() - startedAt < TIMEOUT_MS) {
    // 探测：有 "你好" user message + 有任何 assistant content > 10 字符
    const userVisible = (await win.locator('text=你好').count()) > 0;
    if (userVisible) {
      // 等 assistant 文本流回 — 用 ConversationStreamV2 的内部容器
      const streamLen = await win.evaluate(() => {
        const root = document.querySelector('.h-full.overflow-auto');
        return root ? (root.textContent?.length ?? 0) : 0;
      });
      if (streamLen > 100) {
        // 至少 100 字符说明 assistant 在流
        if (Date.now() - lastShotAt > 5000) {
          await win
            .screenshot({
              path: `${SHOT_DIR}/06-streaming-${Math.floor((Date.now() - startedAt) / 1000)}s.png`,
              fullPage: false,
            })
            .catch(() => {});
          lastShotAt = Date.now();
        }
        // 如果稳定 4s 没增长，认为完成
        await win.waitForTimeout(4000);
        const streamLen2 = await win.evaluate(() => {
          const root = document.querySelector('.h-full.overflow-auto');
          return root ? (root.textContent?.length ?? 0) : 0;
        });
        if (streamLen2 === streamLen) {
          gotResponse = true;
          console.log(`[e2e] ✓ response stable at ${streamLen} chars`);
          break;
        }
        console.log(`[e2e] still streaming: ${streamLen} → ${streamLen2}`);
      }
    }
    await win.waitForTimeout(1000);
  }
  await win.screenshot({ path: `${SHOT_DIR}/07-response-complete.png`, fullPage: false });
  console.log('[e2e] response:', gotResponse ? 'OK' : 'TIMEOUT/EMPTY');

  // 提取 conversation 文本作 sanity check
  const finalText = await win.evaluate(() => {
    const root = document.querySelector('.h-full.overflow-auto');
    return root ? (root.textContent?.slice(0, 1000) ?? '') : '';
  });
  console.log('[e2e] conversation text (first 1000 chars):');
  console.log('---');
  console.log(finalText);
  console.log('---');

  // 5) 右键 session 测 context menu — 在 Recents 区精确找 SessionRow
  console.log('[e2e] right-clicking session in sidebar');
  // SessionRow 的 truncate flex-1 child 内含 "Untitled session"；用 :has 选 button 父
  const sessionRow = win.locator('aside button:has(span:text-is("Untitled session"))').first();
  if (await sessionRow.isVisible().catch(() => false)) {
    await sessionRow.click({ button: 'right' });
    await win.waitForTimeout(800);
    await win.screenshot({ path: `${SHOT_DIR}/08-context-menu.png`, fullPage: false });
    const hasDelete = await win
      .locator('[role="menu"] >> text=Delete')
      .isVisible()
      .catch(() => false);
    const hasFork = await win
      .locator('[role="menu"] >> text=Fork')
      .isVisible()
      .catch(() => false);
    console.log('[e2e] context menu — Delete:', hasDelete, '· Fork:', hasFork);
    await win.keyboard.press('Escape');
  } else {
    console.warn('[e2e] no session row visible in sidebar');
    await win.screenshot({ path: `${SHOT_DIR}/08-no-sessionrow.png`, fullPage: false });
  }

  // 6) 测 + 加号菜单含 project
  console.log('[e2e] re-opening attach menu (with project loaded)');
  await win.locator('button[aria-label="Open attach menu"]').click();
  await win.waitForTimeout(400);
  await win.screenshot({ path: `${SHOT_DIR}/09-attach-with-project.png`, fullPage: false });
  await win.keyboard.press('Escape');
  await win.waitForTimeout(300);

  // ===== 扩展验证：auto-title / Mode / Transcript view / Activity / Context window =====
  const results = {};

  // 7) auto-title — sidebar 当前 session 标题应是 "你好"（首条 user msg slice）
  console.log('[e2e] checking auto-title');
  await win.waitForTimeout(1500); // 等 setTitle round-trip
  const sidebarHasNihao = (await win.locator('aside button:has-text("你好")').count()) > 0;
  // breadcrumb 顶部 (KodaX-Space / 你好) 也应改
  const breadcrumbText = await win
    .locator('header, .border-b')
    .first()
    .textContent()
    .catch(() => '');
  results.autoTitle = sidebarHasNihao;
  console.log(
    `[e2e] auto-title — sidebar has '你好': ${sidebarHasNihao} · breadcrumb: ${breadcrumbText.slice(0, 80)}`,
  );
  await win.screenshot({ path: `${SHOT_DIR}/11-auto-title.png`, fullPage: false });

  // 8) Mode picker — 点 mode chip 弹 popup, 切到 Plan, 再切回 Accept edits
  console.log('[e2e] testing Mode picker');
  const modeChip = win.locator('button[title*="Mode:"]').first();
  if (await modeChip.isVisible().catch(() => false)) {
    await modeChip.click();
    await win.waitForTimeout(400);
    await win.screenshot({ path: `${SHOT_DIR}/12-mode-popup.png`, fullPage: false });
    const planBtn = win.locator('button:has-text("Plan")').first();
    if (await planBtn.isVisible().catch(() => false)) {
      await planBtn.click();
      await win.waitForTimeout(400);
      const newLabel = await modeChip.textContent();
      results.modeSwitch = (newLabel ?? '').toLowerCase().includes('plan');
      console.log(`[e2e] mode after click Plan: ${newLabel}`);
    }
    // 切回 Accept edits
    await modeChip.click();
    await win.waitForTimeout(300);
    const acceptBtn = win.locator('button:has-text("Accept edits")').first();
    if (await acceptBtn.isVisible().catch(() => false)) {
      await acceptBtn.click();
      await win.waitForTimeout(300);
    }
  } else {
    console.warn('[e2e] mode chip not found');
  }
  await win.screenshot({ path: `${SHOT_DIR}/13-mode-restored.png`, fullPage: false });

  // 9) Transcript view popup — 点 ▤ 按钮
  console.log('[e2e] testing Transcript view');
  const transBtn = win.locator('button[aria-label="Transcript view"]').first();
  await transBtn.click();
  await win.waitForTimeout(400);
  await win.screenshot({ path: `${SHOT_DIR}/14-transcript-popup.png`, fullPage: false });
  results.transcriptOpen = await win
    .locator('text=Transcript view')
    .isVisible()
    .catch(() => false);
  // 切 font size
  const fontLgBtn = win.locator('button[title*="Large"]').first();
  if (await fontLgBtn.isVisible().catch(() => false)) {
    await fontLgBtn.click();
    await win.waitForTimeout(300);
    console.log('[e2e] font size switched to Large');
  }
  await win.keyboard.press('Escape');
  await win.waitForTimeout(300);

  // 10) Activity dropdown — 点 ▥ 按钮
  console.log('[e2e] testing Activity dropdown');
  const actBtn = win.locator('button[aria-label="Activity views"]').first();
  await actBtn.click();
  await win.waitForTimeout(400);
  await win.screenshot({ path: `${SHOT_DIR}/15-activity-dropdown.png`, fullPage: false });
  results.activityItems = await win
    .locator('text=/Preview|Diff|Terminal|Tasks|Plan|Agents|MCP/')
    .count();
  console.log(`[e2e] activity dropdown items: ${results.activityItems}`);
  await win.keyboard.press('Escape');
  await win.waitForTimeout(300);

  // 11) Context window popup — compact ring button
  console.log('[e2e] testing Context window popup');
  const ctxBtn = win.getByTestId('context-window-indicator').first();
  if (await ctxBtn.isVisible().catch(() => false)) {
    await ctxBtn.click();
    await win.waitForTimeout(400);
    await win.screenshot({ path: `${SHOT_DIR}/16-context-popup.png`, fullPage: false });
    results.contextExpanded = await win
      .locator('text=/remaining|to auto-compact|自动压缩|还剩/')
      .isVisible()
      .catch(() => false);
    console.log(`[e2e] context window expanded: ${results.contextExpanded}`);
    await win.keyboard.press('Escape');
  }

  // 12) Recents 过滤按钮
  console.log('[e2e] testing Recents filter');
  const recentsFilterBtn = win.locator('button[aria-label="Filter recents"]').first();
  if (await recentsFilterBtn.isVisible().catch(() => false)) {
    await recentsFilterBtn.click();
    await win.waitForTimeout(400);
    await win.screenshot({ path: `${SHOT_DIR}/17-recents-filter.png`, fullPage: false });
    results.recentsFilter = await win
      .locator('text=Status')
      .isVisible()
      .catch(() => false);
    console.log(`[e2e] recents filter open: ${results.recentsFilter}`);
    await win.keyboard.press('Escape');
  }

  // 13) Pin session via context menu — 验证 sidebar 出现 pinned indicator
  console.log('[e2e] pin session via context menu');
  const row = win
    .locator(
      'aside button:has(span:text-is("你好")), aside button:has(span:text-is("Untitled session"))',
    )
    .first();
  if (await row.isVisible().catch(() => false)) {
    await row.click({ button: 'right' });
    await win.waitForTimeout(400);
    await win
      .locator('[role="menu"] >> text=Pin')
      .click({ timeout: 3000 })
      .catch(() => {});
    await win.waitForTimeout(500);
    // 重新右键看看菜单文字是否变 "Unpin"（注意 SessionContextMenu 不会反转 label，
    // 但 Sidebar SessionRow 会出现 📌 emoji；先 screenshot）
    await win.screenshot({ path: `${SHOT_DIR}/18-after-pin.png`, fullPage: false });
    results.pinIndicator = (await win.locator('aside [title="Pinned"]').count()) > 0;
    console.log(`[e2e] pin indicator visible: ${results.pinIndicator}`);
  }

  await win.waitForTimeout(500);
  await win.screenshot({ path: `${SHOT_DIR}/19-final.png`, fullPage: false });

  console.log('\n[e2e] === RESULTS ===');
  console.log('  response gotten     :', gotResponse);
  console.log('  auto-title          :', results.autoTitle);
  console.log('  mode switch         :', results.modeSwitch);
  console.log('  transcript open     :', results.transcriptOpen);
  console.log('  activity items count:', results.activityItems);
  console.log('  context expanded    :', results.contextExpanded);
  console.log('  recents filter open :', results.recentsFilter);
  console.log('  pin indicator       :', results.pinIndicator);
  console.log('  console errors      :', consoleErrors.length);
  for (const e of consoleErrors) console.log('    -', e);

  await app.close();
  const allPass =
    gotResponse &&
    results.autoTitle &&
    results.modeSwitch &&
    results.transcriptOpen &&
    results.activityItems >= 7 &&
    results.contextExpanded &&
    results.recentsFilter &&
    results.pinIndicator;
  process.exit(allPass ? 0 : 1);
}

main().catch((err) => {
  console.error('[e2e] FAILED:', err);
  process.exit(1);
});
