import { expect, test } from '@playwright/test';
import { promises as fs } from 'node:fs';
import path from 'node:path';

import { launchSpace } from './fixtures.js';

test('Windows close behavior preference is visible, typed, and persisted', async () => {
  test.skip(process.platform !== 'win32', 'The close-to-tray preference is Windows-only.');

  const space = await launchSpace(`window-close-behavior-${Date.now()}`);
  try {
    await space.page.getByTestId('settings-button').click();
    const select = space.page.locator('#settings-window-close-behavior');
    await expect(select).toBeVisible();
    await expect(select).toHaveValue('ask');

    await select.selectOption('quit-completely');
    await expect(select).toHaveValue('quit-completely');
    await expect
      .poll(() =>
        space.page.evaluate(async () => {
          const result = await window.kodaxSpace?.invoke('settings.get', {});
          return result?.ok ? result.data.windowCloseBehavior : 'error';
        }),
      )
      .toBe('quit-completely');
    await expect
      .poll(async () => {
        const persisted = JSON.parse(
          await fs.readFile(path.join(space.testDataDir, 'space', 'settings.json'), 'utf-8'),
        ) as { windowCloseBehavior?: string };
        return persisted.windowCloseBehavior;
      })
      .toBe('quit-completely');

    await space.page.getByRole('button', { name: 'Close settings' }).click();
    await space.page.getByTestId('settings-button').click();
    await expect(space.page.locator('#settings-window-close-behavior')).toHaveValue(
      'quit-completely',
    );
  } finally {
    await space.close();
  }
});
