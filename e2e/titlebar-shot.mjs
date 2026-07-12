// Quick titlebar verification — 启 Electron + 截图顶部 100px 看新 titlebar
import { _electron as electron } from 'playwright';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const SHOT_DIR = 'c:/tmp/titlebar';
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

// 找 app window (非 DevTools)
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

await win.waitForLoadState('domcontentloaded');
await win.waitForTimeout(2500);

// 完整截图
await win.screenshot({ path: `${SHOT_DIR}/full.png`, fullPage: false });
console.log('[titlebar] full screenshot saved');

// 关闭 DevTools (如果有) 让窗口干净
await app.evaluate(({ BrowserWindow }) => {
  const wins = BrowserWindow.getAllWindows();
  for (const w of wins) {
    if (w.webContents.isDevToolsOpened()) w.webContents.closeDevTools();
  }
});
await win.waitForTimeout(500);
await win.screenshot({ path: `${SHOT_DIR}/no-devtools.png`, fullPage: false });
console.log('[titlebar] no-devtools screenshot saved');

await app.close();
process.exit(0);
