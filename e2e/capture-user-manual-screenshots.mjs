// Capture reproducible, mock-data screenshots for the Chinese user manual.
// Run after `npm run build:smoke`:
//   node e2e/capture-user-manual-screenshots.mjs

import { _electron as electron } from 'playwright';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const outputDir = path.join(repoRoot, 'docs', 'assets', 'user-manual');
const testId = `manual-capture-${Date.now()}`;
const profileDir = path.join(os.tmpdir(), `kodax-test-${testId}`);
const projectDir = path.join(profileDir, 'sample-project');

await mkdir(projectDir, { recursive: true });
await mkdir(outputDir, { recursive: true });
await writeFile(
  path.join(projectDir, 'README.md'),
  '# Manual sample project\n\nThis workspace contains only mock data for documentation screenshots.\n',
  'utf8',
);

const childEnv = { ...process.env };
delete childEnv.ELECTRON_RUN_AS_NODE;

let app;
try {
  app = await electron.launch({
    args: [path.join(repoRoot, 'dist-electron', 'main.js')],
    cwd: repoRoot,
    env: {
      ...childEnv,
      KODAX_TEST_ONBOARDING: testId,
      KODAX_FORCE_MOCK: '1',
      SPACE_DISABLE_TRAY: '1',
      NODE_ENV: 'production',
    },
  });

  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => document.getElementById('root') !== null);
  await page.setViewportSize({ width: 1440, height: 900 });

  // A current workspace enables the complete Coder composer without accessing a real project.
  await page.evaluate((projectPath) => {
    localStorage.setItem('kodax-space.currentProjectPath', projectPath);
    localStorage.setItem('kodax-space.currentSurface', 'code');
    localStorage.setItem('kodax-space.leftSidebarOpen', '1');
    localStorage.setItem('kodax-space.rightSidebarOpen', '1');
  }, projectDir);
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  await page.getByTestId('coder-workspace').waitFor({ state: 'visible' });
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(outputDir, 'coder-workspace.png') });
} finally {
  await app?.close().catch(() => undefined);
  await rm(profileDir, { recursive: true, force: true }).catch(() => undefined);
}

console.log(`User manual screenshots written to ${outputDir}`);
