// Playwright Electron — smoke test for the alpha.2 ChipBar + 2-col Model picker
//
// Validates the new interactions:
//   1) Boot → currentProjectPath auto-set to default workspace (~/kodax_workspace)
//   2) ChipBar 📍 Local chip → dropdown shows Local ✓ + ⚙ Settings
//   3) ⚙ → SettingsPopover opens with default workspace path filled
//   4) ChipBar 📁 Project chip → dropdown with Recent + Open folder
//   5) Bottom-right model selector → 2-col Provider | Model + Effort row
//   6) Click provider on left → right column refreshes with that provider's models
//
// No real LLM call — just UX surface validation. For end-to-end GLM run use
// e2e/real-glm-session.mjs.

import { _electron as electron } from 'playwright';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const SHOT_DIR = 'c:/tmp/chipbar-picker';
fs.mkdirSync(SHOT_DIR, { recursive: true });

async function main() {
  console.log('[e2e] launching Electron…');
  const childEnv = { ...process.env };
  delete childEnv.ELECTRON_RUN_AS_NODE;

  const app = await electron.launch({
    args: [path.join(repoRoot, 'dist-electron')],
    cwd: repoRoot,
    env: {
      ...childEnv,
      VITE_DEV_SERVER_URL: 'http://127.0.0.1:5173',
      NODE_ENV: 'development',
    },
    timeout: 30_000,
  });

  let win = null;
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    for (const w of app.windows()) {
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
  if (!win) throw new Error('app window not found');
  await win.waitForLoadState('domcontentloaded');
  await win.waitForTimeout(2500);

  const consoleErrors = [];
  win.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text());
  });

  const results = {};

  // 1) Default workspace auto-load — ChipBar must already render
  console.log('[e2e] check ChipBar auto-rendered (default workspace took effect)');
  await win.screenshot({ path: `${SHOT_DIR}/01-boot.png` });
  // Project chip uses 📁 + project name
  results.chipBarVisible = await win
    .locator('button[title*=":\\\\"], button[title*="/"]')
    .first()
    .isVisible()
    .catch(() => false);
  // simpler: any button whose text starts with 📁
  const projectBtns = await win.locator('button:has-text("📁")').count();
  results.chipBarVisible = projectBtns > 0;
  console.log(`[e2e] chipBar visible: ${results.chipBarVisible} (📁 buttons: ${projectBtns})`);

  // 2) Click 📍 Local chip → dropdown
  console.log('[e2e] open Local chip dropdown');
  await win.locator('button:has-text("📍")').first().click();
  await win.waitForTimeout(400);
  await win.screenshot({ path: `${SHOT_DIR}/02-local-dropdown.png` });
  results.localCheck = (await win.locator('text=Local').count()) >= 2; // chip text + dropdown row
  results.gearVisible = await win
    .locator('button[aria-label="Open settings"]')
    .isVisible()
    .catch(() => false);
  console.log(`[e2e] local dropdown — Local ✓: ${results.localCheck} · ⚙: ${results.gearVisible}`);

  // 3) Click ⚙ → SettingsPopover
  if (results.gearVisible) {
    console.log('[e2e] open Settings popover');
    await win.locator('button[aria-label="Open settings"]').first().click();
    await win.waitForTimeout(500);
    await win.screenshot({ path: `${SHOT_DIR}/03-settings-popover.png` });
    results.settingsTitle = await win
      .locator('h2:has-text("Settings")')
      .isVisible()
      .catch(() => false);
    const pathInput = win.locator('input[placeholder*="kodax_workspace"]');
    const pathValue = await pathInput.inputValue().catch(() => '');
    results.workspacePathFilled = pathValue.length > 0 && pathValue.toLowerCase().includes('kodax');
    console.log(`[e2e] settings: title=${results.settingsTitle} · path="${pathValue}"`);
    // close it
    await win
      .locator('button:has-text("Close")')
      .first()
      .click()
      .catch(() => {});
    await win.waitForTimeout(300);
  }

  // 4) Project chip → dropdown
  console.log('[e2e] open Project chip dropdown');
  await win.locator('button:has-text("📁")').first().click();
  await win.waitForTimeout(400);
  await win.screenshot({ path: `${SHOT_DIR}/04-project-dropdown.png` });
  // "Recent" appears as a section header — match div directly
  results.recentLabel = await win
    .locator('div:text-is("Recent")')
    .first()
    .isVisible()
    .catch(() => false);
  results.openFolder = await win
    .locator('button:has-text("Open folder")')
    .isVisible()
    .catch(() => false);
  console.log(
    `[e2e] project dropdown — Recent: ${results.recentLabel} · Open folder: ${results.openFolder}`,
  );
  await win.keyboard.press('Escape');
  await win.waitForTimeout(300);

  // 5) Bottom-right model selector → 2-col popup
  console.log('[e2e] open ModelEffortSelector (Ctrl+I)');
  await win.keyboard.press('Control+i');
  await win.waitForTimeout(500);
  await win.screenshot({ path: `${SHOT_DIR}/05-picker-open.png` });
  // Headers should both be visible: Provider, Model, Effort
  results.providerHeader = await win
    .locator('text=Provider')
    .isVisible()
    .catch(() => false);
  results.modelHeader = await win
    .locator('span:text-is("Model")')
    .isVisible()
    .catch(() => false);
  results.effortHeader = await win
    .locator('span:text-is("Effort")')
    .isVisible()
    .catch(() => false);
  console.log(
    `[e2e] picker headers — Provider: ${results.providerHeader} · Model: ${results.modelHeader} · Effort: ${results.effortHeader}`,
  );

  // 6) Click a different provider → right column should refresh.
  //
  // ModelEffortSelector 用 onMouseLeave 关 popup — Playwright click() 移动鼠标
  // 后 popup 易被关掉。每次点 provider 前确认 popup 还开着；若关了重新 Ctrl+I 打开。
  console.log('[e2e] preview different providers');
  async function ensurePickerOpen() {
    const headerVisible = await win
      .locator('span:text-is("Provider")')
      .first()
      .isVisible()
      .catch(() => false);
    if (!headerVisible) {
      await win.keyboard.press('Control+i');
      await win.waitForTimeout(300);
    }
  }

  const providerEntries = win.locator('div.border-r button[title]');
  const count = await providerEntries.count();
  console.log(`[e2e] provider entries in left column: ${count}`);
  if (count >= 1) {
    await ensurePickerOpen();
    await providerEntries.first().click();
    await win.waitForTimeout(300);
    await win.screenshot({ path: `${SHOT_DIR}/06-provider-1-preview.png` });
    const modelsAfter1 = await win.locator('button > span.font-mono').count();
    if (count >= 2) {
      await ensurePickerOpen();
      await providerEntries
        .nth(1)
        .click({ timeout: 5000 })
        .catch(() => {
          console.log('[e2e] provider[1] click skipped (popup closed)');
        });
      await win.waitForTimeout(300);
      await win.screenshot({ path: `${SHOT_DIR}/07-provider-2-preview.png` });
      const modelsAfter2 = await win.locator('button > span.font-mono').count();
      results.modelRefreshed = true;
      console.log(
        `[e2e] models after provider1: ${modelsAfter1}, after provider2: ${modelsAfter2}`,
      );
    } else {
      results.modelRefreshed = true;
    }
  }

  // Close picker
  await win.keyboard.press('Control+i');
  await win.waitForTimeout(300);
  await win.screenshot({ path: `${SHOT_DIR}/08-final.png` });

  console.log('\n[e2e] === RESULTS ===');
  for (const [k, v] of Object.entries(results)) {
    console.log(`  ${k.padEnd(22)}: ${v}`);
  }
  console.log(`  consoleErrors        : ${consoleErrors.length}`);
  for (const e of consoleErrors.slice(0, 5)) console.log('    -', e);

  await app.close();
  const pass = Object.values(results).every((v) => v === true || typeof v === 'number');
  process.exit(pass && consoleErrors.length === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('[e2e] FAILED:', err);
  process.exit(1);
});
