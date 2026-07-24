// OC-29 + KX-I-02 e2e — unified Settings modal Esc/click-out + smart popout toggle persistence.
//
// 验证:
//   1. SettingsModal 可通过 LeftSidebar 底栏 ⚙ 打开
//   2. Esc 关闭 modal
//   3. Preferences tab 的 "Auto-open Plan / Diff / Tasks" 复选框反映 store
//      smartPopoutEnabled 状态,toggle 后 lsKey 'kodax-space.smartPopoutEnabled' 写入正确

import { test, expect } from '@playwright/test';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { launchSpace } from './fixtures.js';

const TEST_ID = `settings-modal-${Date.now()}`;
const TASK_FOCUS_TOGGLE = 'Auto-focus Task Dock and Review paths';

test('Project Files sidebar keeps the Settings footer visible and functional', async () => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'kodax-settings-files-'));
  const space = await launchSpace(`${TEST_ID}-files-sidebar`);
  try {
    const { page } = space;
    await space.seedProject(projectRoot);
    await page.evaluate(() => {
      window.dispatchEvent(new Event('kodax-space.open-files-workspace'));
    });

    await expect(page.getByTestId('files-panel')).toBeVisible({ timeout: 10_000 });
    const settingsButton = page.getByTestId('settings-button');
    await expect(settingsButton).toBeVisible();
    await settingsButton.click();
    await expect(page.locator('#settings-modal-title')).toBeVisible();
  } finally {
    await space.close();
    await fs.rm(projectRoot, { recursive: true, force: true });
  }
});

test('SettingsModal opens via sidebar, Esc closes, Task Dock focus toggle persists', async () => {
  const space = await launchSpace(TEST_ID);
  try {
    const { page } = space;
    await page.waitForTimeout(2000); // 让 hydrate 完成
    // localStorage 跨 test 共享 — 清掉本测专用 keys 避免上次跑的值串进默认状态
    await page.evaluate(() => {
      window.localStorage.removeItem('kodax-space.smartPopoutEnabled');
    });
    await page.reload();
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(1500);

    // 默认状态: smartPopoutEnabled === true (新装无 lsKey → 默认 on)
    const defaultEnabled = await page.evaluate(() =>
      window.localStorage.getItem('kodax-space.smartPopoutEnabled'),
    );
    // 默认没写过 -> null; auto-focus is opt-in and only writes after explicit toggles.
    expect(defaultEnabled).toBeNull();

    // 点 LeftSidebar 底栏设置按钮
    const settingsBtn = page.getByTestId('settings-button');
    await expect(settingsBtn).toBeVisible({ timeout: 5000 });
    await settingsBtn.click();

    // Modal 标题出现
    const modalTitle = page.locator('#settings-modal-title');
    await expect(modalTitle).toBeVisible();
    await expect(modalTitle).toHaveText('Settings');

    // Preferences tab 默认就在 (initialTab='preferences')
    const prefPanel = page.locator('#settings-panel-preferences');
    await expect(prefPanel).toBeVisible();

    // 找到 Task Dock / Review path auto-focus 复选框
    const dirToggle = page.getByLabel(TASK_FOCUS_TOGGLE);
    await expect(dirToggle).not.toBeChecked();
    await dirToggle.check();
    await page.waitForTimeout(100);
    const afterFirstCheck = await page.evaluate(() =>
      window.localStorage.getItem('kodax-space.smartPopoutEnabled'),
    );
    expect(afterFirstCheck).toBe('1');

    // 关掉 director toggle
    await dirToggle.uncheck();
    await page.waitForTimeout(100); // 让 setState + lsSet 完成
    const afterUncheck = await page.evaluate(() =>
      window.localStorage.getItem('kodax-space.smartPopoutEnabled'),
    );
    expect(afterUncheck).toBe('0');

    // 重新勾上
    await dirToggle.check();
    await page.waitForTimeout(100);
    const afterCheck = await page.evaluate(() =>
      window.localStorage.getItem('kodax-space.smartPopoutEnabled'),
    );
    expect(afterCheck).toBe('1');

    // Esc 关 modal
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    await expect(modalTitle).not.toBeVisible();
  } finally {
    await space.close();
  }
});

test('SettingsModal tab switch keeps both panels mounted (preserves in-progress edits)', async () => {
  // OC-29 review HIGH-1 anti-regression: 切 tab 时 panel 用 hidden 而非 unmount,
  // 验证 Preferences tab 隐藏后再切回,DOM 还在(不丢编辑中的输入)。
  const space = await launchSpace(`${TEST_ID}-tabs`);
  try {
    const { page } = space;
    await page.waitForTimeout(2000);

    await page.getByTestId('settings-button').click();
    await expect(page.locator('#settings-modal-title')).toBeVisible();

    // Preferences panel 在,Providers panel 也在 (hidden 模式),只是 hidden 属性切换
    const prefPanel = page.locator('#settings-panel-preferences');
    const provPanel = page.locator('#settings-panel-providers');
    await expect(prefPanel).toBeVisible();
    // Providers panel 在 DOM 里但 hidden
    await expect(provPanel).toBeAttached();
    await expect(provPanel).not.toBeVisible();

    // 点 Providers tab
    await page.locator('#settings-tab-preferences').focus();
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(100);
    await expect(provPanel).toBeVisible();
    // Preferences 还在 DOM,只是 hidden — 不 unmount
    await expect(prefPanel).toBeAttached();
    await expect(prefPanel).not.toBeVisible();

    // 切回 Preferences
    await page.locator('button[role="tab"]', { hasText: 'Preferences' }).click();
    await expect(prefPanel).toBeVisible();
  } finally {
    await space.close();
  }
});

test('SettingsModal providers tab adds a custom provider and saves its API key', async () => {
  const space = await launchSpace(`${TEST_ID}-custom-provider`);
  try {
    const { page } = space;
    await page.waitForTimeout(2000);

    await page.getByTestId('settings-button').click();
    await expect(page.locator('#settings-modal-title')).toBeVisible();

    await page.locator('button[role="tab"]', { hasText: 'Providers' }).click();
    await expect(page.locator('#settings-panel-providers')).toBeVisible();

    await page.getByRole('button', { name: 'Add custom' }).click();
    await page.getByLabel('Display name').fill('E2E Gateway');
    await page.getByLabel('Base URL').fill('https://api.example.com/v1');
    await page.getByLabel('Default model').fill('e2e-model');
    await page.getByPlaceholder('Paste API key').fill('sk-e2e-provider-key');
    await page.getByRole('button', { name: 'Add provider' }).click();

    const card = page.locator('article', { hasText: 'E2E Gateway' });
    await expect(card).toBeVisible({ timeout: 5000 });
    await expect(card.getByText('Ready')).toBeVisible();
    await expect(card.getByText('Default')).toBeVisible();
    await expect(card.getByText('E2E_GATEWAY_API_KEY')).toBeVisible();
    await expect(card.getByText('e2e-model')).toBeVisible();
  } finally {
    await space.close();
  }
});

test('SettingsModal keeps a partially-created custom provider visible when key save fails', async () => {
  const space = await launchSpace(`${TEST_ID}-partial-provider`);
  try {
    const { page } = space;
    await page.waitForTimeout(2000);

    await page.getByTestId('settings-button').click();
    await page.locator('button[role="tab"]', { hasText: 'Providers' }).click();

    await page.getByRole('button', { name: 'Add custom' }).click();
    await page.getByLabel('Display name').fill('Partial Gateway');
    await page.getByLabel('Base URL').fill('https://partial.example.com/v1');
    await page.getByLabel('Default model').fill('partial-model');
    await page.getByPlaceholder('Paste API key').fill(`sk-${'x'.repeat(4100)}`);
    await page.getByRole('button', { name: 'Add provider' }).click();

    await expect(page.getByText('Provider was created and refreshed into the list')).toBeVisible({
      timeout: 5000,
    });
    await expect(page.getByRole('button', { name: 'Provider added' })).toBeDisabled();

    const card = page.locator('article', { hasText: 'Partial Gateway' });
    await expect(card).toBeVisible();
    await expect(card.getByText('No key', { exact: true })).toBeVisible();
    await expect(card.getByText('Default')).toHaveCount(0);
  } finally {
    await space.close();
  }
});

test('SettingsModal does not allow an unconfigured provider to become default', async () => {
  const space = await launchSpace(`${TEST_ID}-no-key-default`);
  try {
    const { page } = space;
    await page.waitForTimeout(2000);

    await page.getByTestId('settings-button').click();
    await page.locator('button[role="tab"]', { hasText: 'Providers' }).click();

    await page.getByRole('button', { name: 'Add custom' }).click();
    await page.getByLabel('Display name').fill('No Key Gateway');
    await page.getByLabel('Base URL').fill('https://nokey.example.com/v1');
    await page.getByRole('button', { name: 'Use environment variable' }).click();
    await page.getByLabel('Environment variable name').fill('NO_KEY_GATEWAY_API_KEY');
    await page.getByLabel('Default model').fill('nokey-model');
    await expect(page.getByLabel('Set as default after saving key')).toHaveCount(0);
    await page.getByRole('button', { name: 'Add provider' }).click();

    const card = page.locator('article', { hasText: 'No Key Gateway' });
    await expect(card).toBeVisible({ timeout: 5000 });
    await expect(card.getByText('No key', { exact: true })).toBeVisible();
    await expect(card.getByRole('button', { name: 'Set default' })).toHaveCount(0);

    const defaultAttempt = await page.evaluate(async (displayName) => {
      type ProviderListResult = {
        ok: boolean;
        data?: { providers: Array<{ id: string; displayName: string }> };
        error?: { message: string };
      };
      type InvokeResult = { ok: boolean; error?: { message: string } };
      const bridge = (
        window as unknown as {
          kodaxSpace: { invoke: (name: string, input: unknown) => Promise<unknown> };
        }
      ).kodaxSpace;
      const list = (await bridge.invoke('provider.list', undefined)) as ProviderListResult;
      const provider = list.data?.providers.find((p) => p.displayName === displayName);
      if (!provider) return { ok: false, message: 'provider missing' };
      const result = (await bridge.invoke('provider.setDefault', {
        providerId: provider.id,
      })) as InvokeResult;
      return { ok: result.ok, message: result.error?.message ?? null };
    }, 'No Key Gateway');

    expect(defaultAttempt.ok).toBe(false);
    expect(defaultAttempt.message).toContain('not configured');
  } finally {
    await space.close();
  }
});

test('SettingsModal API key editor Escape cancels edit without closing the modal', async () => {
  const space = await launchSpace(`${TEST_ID}-key-escape`);
  try {
    const { page } = space;
    await page.waitForTimeout(2000);

    await page.getByTestId('settings-button').click();
    await page.locator('button[role="tab"]', { hasText: 'Providers' }).click();

    await page.getByRole('button', { name: 'Add custom' }).click();
    await page.getByLabel('Display name').fill('Escape Gateway');
    await page.getByLabel('Base URL').fill('https://escape.example.com/v1');
    await page.getByRole('button', { name: 'Use environment variable' }).click();
    await page.getByLabel('Environment variable name').fill('ESCAPE_GATEWAY_API_KEY');
    await page.getByLabel('Default model').fill('escape-model');
    await page.getByRole('button', { name: 'Add provider' }).click();

    const card = page.locator('article', { hasText: 'Escape Gateway' });
    await expect(card).toBeVisible({ timeout: 5000 });
    await card.getByRole('button', { name: 'Add key' }).click();
    const keyInput = card.getByPlaceholder('Paste API key');
    await expect(keyInput).toBeVisible();
    await keyInput.fill('sk-escape');
    await page.keyboard.press('Escape');

    await expect(page.locator('#settings-modal-title')).toBeVisible();
    await expect(keyInput).toHaveCount(0);
    await expect(card.getByRole('button', { name: 'Add key' })).toBeVisible();
  } finally {
    await space.close();
  }
});
