import { test, expect } from '@playwright/test';
import path from 'node:path';
import os from 'node:os';
import { promises as fs } from 'node:fs';
import { launchSpace } from './fixtures.js';

const TEST_ID = `composer-after-session-delete-${Date.now()}`;

test('composer remains focusable after deleting the current session', async () => {
  test.setTimeout(60_000);
  const projectDir = path.join(os.tmpdir(), `kodax-test-proj-${TEST_ID}`);
  await fs.mkdir(projectDir, { recursive: true });

  const space = await launchSpace(TEST_ID);
  try {
    const { page } = space;
    await space.seedProject(projectDir);
    await page.waitForTimeout(1500);

    const composer = page.locator('textarea[placeholder^="Describe a task"]').first();
    await expect(composer).toBeVisible({ timeout: 5000 });
    await composer.fill('create a disposable session');
    await composer.press('Enter');

    // Wait for the canonical terminal UI, not merely for a writable frame.
    // Immediately after Enter the textarea can still be writable before the
    // asynchronous running projection arrives, which made the test attempt to
    // delete an in-flight session and exercise the busy-session path instead.
    await expect(page.getByText('Run complete', { exact: true })).toBeVisible({
      timeout: 15_000,
    });
    await expect(composer).not.toHaveAttribute('readonly', '');

    await page.getByRole('button', { name: 'Session options' }).click();
    // Delete now uses an in-app confirm dialog (no native window.confirm — native
    // dialogs steal the renderer's keyboard focus and the textarea can't recover it).
    // Note: a native confirm would be auto-dismissed by Playwright and would NOT
    // reproduce the focus loss, which is why the old test gave false confidence.
    await page.getByRole('button', { name: /^Delete\b/ }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click();

    await expect(
      page.getByTestId('sidebar-session-row').filter({ hasText: 'create a disposable session' }),
    ).toHaveCount(0, { timeout: 10_000 });
    await expect
      .poll(
        () =>
          page.evaluate(async (root) => {
            const result = await window.kodaxSpace.invoke('session.list', {
              projectRoot: root,
              surface: 'code',
            });
            if (!result.ok) throw new Error(result.error.message);
            return result.data.sessions.length;
          }, projectDir),
        { timeout: 10_000 },
      )
      .toBe(0);
    await expect(composer).toHaveAttribute(
      'placeholder',
      'Describe a task or ask a question - session will be created on send',
    );
    await expect(composer).toHaveValue('');

    await expect
      .poll(async () =>
        page.evaluate(() => {
          const composerTextarea = document.querySelector(
            'textarea[placeholder^="Describe a task"]',
          );
          return document.activeElement === composerTextarea;
        }),
      )
      .toBe(true);

    await page.keyboard.type('typing after delete still works');
    await expect(composer).toHaveValue('typing after delete still works');
  } finally {
    await space.close();
    await fs.rm(projectDir, { recursive: true, force: true }).catch(() => {});
  }
});
