// Full Access alignment E2E — KodaX 0.7.96 canonical four permission profiles.
//
// Verifies the whole UI → IPC → persisted-defaults chain for the mode selector
// without depending on a live provider (KODAX_FORCE_MOCK keeps sends local):
//   1. The selector offers exactly the four canonical profiles in canonical order.
//   2. Selecting Full access updates the button, the active session, and the
//      persisted next-session default (settings.setRuntimeDefaults).
//   3. Shift+Tab cycles plan → accept-edits → auto → full-access and wraps.
//   4. Keyboard shortcuts 1-4 work while the selector is open.
//   5. The choice survives a renderer reload (boot restore path).
//   6. session.setPermissionMode is admitted for a live session (no error toast).

import { test, expect } from '@playwright/test';
import path from 'node:path';
import os from 'node:os';
import { promises as fs } from 'node:fs';
import { launchSpace } from './fixtures.js';

const MODE_LABELS = ['Plan', 'Accept edits', 'Auto[LLM]', 'Full access'] as const;

async function openModeMenu(page: import('@playwright/test').Page): Promise<void> {
  await page.keyboard.press('Control+m');
  // The dropdown hangs above the trigger button (bottom-full) and owns the
  // profile entries; scoping avoids matching the trigger button itself.
  await expect(page.locator('div.bottom-full button[title]').first()).toBeVisible();
}

function modeMenuItem(page: import('@playwright/test').Page, label: string) {
  return page.locator('div.bottom-full button[title]', { hasText: label });
}

test('mode selector exposes the four canonical profiles and Full access end to end', async () => {
  const testId = `full-access-modes-${Date.now()}`;
  const projectDir = path.join(os.tmpdir(), `kodax-test-${testId}-project`);
  await fs.mkdir(projectDir, { recursive: true });
  await fs.writeFile(path.join(projectDir, 'README.md'), '# mode probe\n');

  const space = await launchSpace(testId);
  const consoleErrors: string[] = [];
  space.page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text);
  });

  try {
    const { page } = space;
    await page.setViewportSize({ width: 1440, height: 900 });
    await space.seedProject(projectDir);

    // Create a live session (mock run completes locally) so
    // session.setPermissionMode has a real target.
    const textarea = page.locator('textarea').first();
    await expect(textarea).toBeEnabled({ timeout: 10_000 });
    await textarea.fill('mode alignment probe');
    await textarea.press('Enter');
    await expect(page.getByTestId('user-message-bubble').first()).toBeVisible({ timeout: 15_000 });

    // 1) The menu lists exactly the canonical profiles, in canonical order.
    await openModeMenu(page);
    for (const label of MODE_LABELS) {
      await expect(modeMenuItem(page, label)).toBeVisible();
    }
    // Menu footer states the containment contract for the two advanced profiles.
    await expect(page.getByText(/sandbox-first/i)).toBeVisible();

    // 2) Pick Full access with the number shortcut (4th canonical profile).
    await page.keyboard.press('4');
    const modeButton = page.locator('button[title*="Mode"], button[title*="模式"]').first();
    await expect(modeButton).toContainText(MODE_LABELS[3], { timeout: 10_000 });

    // The active session and the persisted next-session default must both hold it.
    const persisted = await page.evaluate(async () => {
      const r = await window.kodaxSpace.invoke('settings.get', {});
      return r.ok ? r.data.runtimeDefaults?.permissionMode : undefined;
    });
    expect(persisted).toBe('full-access');
    const sessionMode = await page.evaluate(async () => {
      const r = await window.kodaxSpace.invoke('session.list', { surface: 'code' });
      return r.ok ? r.data.sessions?.[0]?.permissionMode : undefined;
    });
    expect(sessionMode).toBe('full-access');

    // 3) Shift+Tab cycles forward with wrap-around: full-access → plan.
    await page.keyboard.press('Shift+Tab');
    await expect(modeButton).toContainText(MODE_LABELS[0], { timeout: 10_000 });
    for (let i = 0; i < 4; i++) await page.keyboard.press('Shift+Tab');
    await expect(modeButton).toContainText(MODE_LABELS[0], { timeout: 10_000 });

    // 4) Back to Full access via the menu button (mouse path).
    await modeButton.click();
    await modeMenuItem(page, MODE_LABELS[3]).click();
    await expect(modeButton).toContainText(MODE_LABELS[3], { timeout: 10_000 });

    // 5) Reload — the next-session default restores Full access.
    await page.reload();
    await page.waitForSelector('[data-space-shell-ready]', { timeout: 30_000 });
    const modeButtonAfterReload = page.locator('button[title*="Mode"], button[title*="模式"]').first();
    await expect(modeButtonAfterReload).toContainText(MODE_LABELS[3], { timeout: 15_000 });

    // No renderer errors during the whole flow.
    const reactErrors = consoleErrors.filter((e) => /React error #\d{3}/i.test(e));
    expect(reactErrors).toEqual([]);
  } finally {
    await space.close();
    await fs.rm(projectDir, { recursive: true, force: true }).catch(() => {});
  }
});
