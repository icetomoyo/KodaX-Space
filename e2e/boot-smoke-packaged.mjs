// Boot smoke: 启动打包后的 win-unpacked app，确认主进程不崩、窗口正常创建。
import { _electron as electron } from 'playwright';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const exe = path.join(__dirname, '..', 'out', 'win-unpacked', 'KodaX Space.exe');
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
try {
  const app = await electron.launch({ executablePath: exe, env, timeout: 45000 });
  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  await win.waitForTimeout(3000);
  const url = win.url();
  if (!url.startsWith('app://space/')) {
    throw new Error(`unexpected packaged renderer origin: ${url}`);
  }
  const title = await win.title();
  const hasInput = await win.locator('textarea').count();
  console.log(
    '[boot-smoke] PASS — packaged app 起窗口成功 | origin=',
    'app://space',
    '| title=',
    JSON.stringify(title),
    '| textarea=',
    hasInput,
  );
  await app.close();
  process.exit(0);
} catch (e) {
  console.log('[boot-smoke] FAIL — packaged app 启动失败:', e.message.split('\n')[0]);
  process.exit(1);
}
