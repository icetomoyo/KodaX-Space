import { test, expect } from '@playwright/test';
import { launchSpace } from './fixtures.js';

const TEST_ID = `i18n-language-switch-${Date.now()}`;

test('language switch updates settings, sidebar, and command palette copy', async () => {
  test.setTimeout(60_000);
  const space = await launchSpace(TEST_ID);
  try {
    const { page } = space;
    await page.waitForTimeout(2000);
    await expect(page.getByLabel('Runtime diagnostics')).toContainText('Community');
    await expect(page.getByText('Total tokens', { exact: true })).toBeVisible();

    await page.getByTestId('settings-button').click();
    await expect(page.locator('#settings-modal-title')).toHaveText('Settings');
    await expect(page.getByRole('tab', { name: 'License' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Workflow host' })).toBeVisible();

    await page.getByRole('button', { name: '简体中文' }).click();
    await expect(page.locator('#settings-modal-title')).toHaveText('设置');
    await expect(page.getByRole('tab', { name: '许可证' })).toBeVisible();
    await expect(page.getByRole('heading', { name: '工作流宿主' })).toBeVisible();
    await expect(page.getByTestId('settings-button')).toContainText('设置');
    await expect(page.getByText('项目', { exact: true }).first()).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(page.locator('#settings-modal-title')).toHaveCount(0);
    await expect(page.getByLabel('运行时诊断')).toContainText('社区版');
    await expect(page.getByText('Token 总数', { exact: true })).toBeVisible();
    await expect(page.locator('button[aria-label^="主题"]').first()).toBeVisible();
    await page.keyboard.press('Control+Shift+P');
    const palette = page.getByRole('dialog', { name: '命令面板' });
    await expect(palette).toBeVisible();
    await expect(palette.getByLabel('命令查询')).toHaveAttribute(
      'placeholder',
      '输入命令、文件、会话或 /slash...',
    );
    await expect(palette.getByRole('button', { name: /操作 新对话/ })).toBeVisible();

    await page.keyboard.press('Escape');
    await page.getByTestId('settings-button').click();
    await page.getByRole('button', { name: 'English' }).click();
    await expect(page.locator('#settings-modal-title')).toHaveText('Settings');
    await expect(page.getByRole('tab', { name: 'License' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Workflow host' })).toBeVisible();
    await expect(page.getByTestId('settings-button')).toContainText('Settings');
    await expect(page.getByLabel('Runtime diagnostics')).toContainText('Community');
    await expect(page.locator('button[aria-label^="Theme"]').first()).toBeVisible();
  } finally {
    await space.close();
  }
});
