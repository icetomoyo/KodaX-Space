// Both-theme verification — 启 Electron + 截 dark / light / system 三档
import { _electron as electron } from 'playwright';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const SHOT_DIR = 'c:/tmp/theme';
fs.mkdirSync(SHOT_DIR, { recursive: true });

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
    if (
      w.url().startsWith('http://127.0.0.1:5173') ||
      w.url().startsWith('app://space/') ||
      w.url().startsWith('file://')
    ) {
      win = w;
      break;
    }
  }
  if (win) break;
  await new Promise((r) => setTimeout(r, 500));
}
if (!win) throw new Error('app window not found');

await win.waitForLoadState('domcontentloaded');
await win.waitForTimeout(2500);

// 关 DevTools
await app.evaluate(({ BrowserWindow }) => {
  for (const w of BrowserWindow.getAllWindows()) {
    if (w.webContents.isDevToolsOpened()) w.webContents.closeDevTools();
  }
});
await win.waitForTimeout(800);

// 1) Dark (默认) — 抓
await win.screenshot({ path: `${SHOT_DIR}/01-dark.png`, fullPage: false });
console.log('[theme] 01-dark.png');

// 找 ThemeToggle 按钮，点击切到 light
const toggleBtn = win.locator('button[aria-label*="Theme"]').first();
await toggleBtn.click();
await win.waitForTimeout(800);

// 2) Light — 抓
await win.screenshot({ path: `${SHOT_DIR}/02-light.png`, fullPage: false });
console.log('[theme] 02-light.png');

// 再点切到 system
await toggleBtn.click();
await win.waitForTimeout(800);
await win.screenshot({ path: `${SHOT_DIR}/03-system.png`, fullPage: false });
console.log('[theme] 03-system.png');

// 验证 <html> class 切换
const htmlClassDark = await win.evaluate(() => document.documentElement.className);
console.log(`[theme] after 3 toggles (now system), html class: "${htmlClassDark}"`);

// 切回 dark
await toggleBtn.click();
await win.waitForTimeout(500);
const htmlClassFinal = await win.evaluate(() => document.documentElement.className);
console.log(`[theme] back to dark, html class: "${htmlClassFinal}"`);
await win.screenshot({ path: `${SHOT_DIR}/04-back-to-dark.png`, fullPage: false });

await app.close();
process.exit(0);
