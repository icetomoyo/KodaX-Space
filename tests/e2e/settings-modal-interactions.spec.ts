import { test, expect, type Page } from '@playwright/test';
import { launchSpace } from './fixtures.js';

const TEST_ID = `settings-interactions-${Date.now()}`;
const TASK_FOCUS_TOGGLE = 'Auto-focus Task Dock and Review paths';
const CONFIRM_DIALOG = '[role="dialog"][aria-label="Confirm action"]';
const PROVIDER_CARD_TIMEOUT_MS = 20_000;

async function openSettings(page: Page): Promise<void> {
  await page.waitForTimeout(2000);
  await page.getByTestId('settings-button').click();
  await expect(settingsDialog(page)).toBeVisible();
}

function settingsDialog(page: Page) {
  return page.locator('[role="dialog"]').filter({ has: page.locator('#settings-modal-title') });
}

async function openProviders(page: Page): Promise<void> {
  const dialog = settingsDialog(page);
  await dialog.locator('#settings-tab-providers').click();
  await expect(page.locator('#settings-panel-providers')).toBeVisible();
}

async function addCustomProvider(
  page: Page,
  {
    name,
    env,
    model,
    models,
    key,
    setDefault = true,
    protocol = 'openai',
  }: {
    name: string;
    env: string;
    model: string;
    models?: string;
    key?: string;
    setDefault?: boolean;
    protocol?: 'openai' | 'anthropic';
  },
): Promise<void> {
  await page.getByRole('button', { name: 'Add custom' }).click();
  if (protocol === 'anthropic') {
    await page.getByRole('button', { name: 'Anthropic compatible' }).click();
  }
  await page.getByLabel('Display name').fill(name);
  await page
    .getByLabel('Base URL')
    .fill(`https://${env.toLowerCase().replaceAll('_', '-')}.example.com/v1`);
  if (!key) {
    await page.getByRole('button', { name: 'Use environment variable' }).click();
    await page.getByLabel('Environment variable name').fill(env);
  }
  await page.getByLabel('Default model').fill(model);
  if (models) {
    await page.getByLabel('Model list').fill(models);
  }
  if (key) {
    await page.getByPlaceholder('Paste API key').fill(key);
    if (!setDefault) {
      await page.getByLabel('Set as default after saving key').uncheck();
    }
  }
  await page.getByRole('button', { name: 'Add provider' }).click();
  await expect(page.locator('article', { hasText: name })).toBeVisible({
    timeout: PROVIDER_CARD_TIMEOUT_MS,
  });
}

interface InteractiveSnapshot {
  readonly tag: string;
  readonly role: string | null;
  readonly type: string | null;
  readonly name: string;
  readonly id: string;
  readonly disabled: boolean;
}

async function collectSettingsInteractives(page: Page): Promise<readonly InteractiveSnapshot[]> {
  return page.locator('[role="dialog"]').evaluate((dialog) => {
    const selectors = [
      'button',
      'input',
      'select',
      'textarea',
      'a[href]',
      '[role="button"]',
      '[role="tab"]',
      '[role="checkbox"]',
      '[tabindex]:not([tabindex="-1"])',
    ].join(',');

    function textOf(value: string | null | undefined): string {
      return (value ?? '').replace(/\s+/g, ' ').trim();
    }

    function cssEscape(value: string): string {
      if ('CSS' in window && typeof window.CSS.escape === 'function') {
        return window.CSS.escape(value);
      }
      return value.replace(/["\\]/g, '\\$&');
    }

    function htmlLabel(el: Element): string {
      const id = el.getAttribute('id');
      if (id) {
        const explicit = dialog.querySelector(`label[for="${cssEscape(id)}"]`);
        const explicitText = textOf(explicit?.textContent);
        if (explicitText) return explicitText;
      }
      return textOf(el.closest('label')?.textContent);
    }

    function isVisible(el: Element): boolean {
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      return (
        rect.width > 0 &&
        rect.height > 0 &&
        style.display !== 'none' &&
        style.visibility !== 'hidden' &&
        !el.closest('[hidden]')
      );
    }

    const seen = new Set<Element>();
    const items: InteractiveSnapshot[] = [];
    for (const el of Array.from(dialog.querySelectorAll(selectors))) {
      if (seen.has(el) || !isVisible(el)) continue;
      seen.add(el);
      const input = el as HTMLInputElement;
      const rawName =
        textOf(el.getAttribute('aria-label')) ||
        htmlLabel(el) ||
        textOf(el.textContent) ||
        textOf(input.placeholder) ||
        textOf(el.getAttribute('title'));
      items.push({
        tag: el.tagName.toLowerCase(),
        role: el.getAttribute('role'),
        type: input.type ?? null,
        name: rawName,
        id: el.getAttribute('id') ?? '',
        disabled: input.disabled === true || el.getAttribute('aria-disabled') === 'true',
      });
    }
    return items;
  });
}

async function expectNamedInteractionSurface(
  page: Page,
  context: string,
  expectedNames: readonly (string | RegExp)[],
): Promise<void> {
  const items = await collectSettingsInteractives(page);
  const unnamed = items.filter((item) => item.name.length === 0);
  expect(unnamed, `${context} has unnamed interactive controls`).toEqual([]);

  for (const expected of expectedNames) {
    const found = items.some((item) =>
      typeof expected === 'string' ? item.name.includes(expected) : expected.test(item.name),
    );
    expect(found, `${context} is missing interactive control ${String(expected)}`).toBe(true);
  }
}

test('Settings preferences controls are keyboardable, minimal, and persist edits', async () => {
  const space = await launchSpace(`${TEST_ID}-preferences`);
  try {
    const { page } = space;
    await openSettings(page);
    const dialog = settingsDialog(page);

    const workspaceInput = dialog.getByLabel('Default workspace');
    const saveWorkspace = dialog.getByRole('button', { name: 'Save workspace' });
    await expect(workspaceInput).toBeVisible();
    await expect(saveWorkspace).toBeDisabled();

    await workspaceInput.fill('');
    await expect(saveWorkspace).toBeEnabled();
    await saveWorkspace.click();
    await expect(page.getByText('Path cannot be empty.')).toBeVisible();

    const pickedWorkspace = `${space.testDataDir}\\picked-workspace`;
    await space.app.evaluate(async ({ dialog }, selectedPath) => {
      const patchedDialog = dialog as unknown as {
        showOpenDialog: () => Promise<{ canceled: boolean; filePaths: string[] }>;
      };
      patchedDialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [selectedPath as string],
      });
    }, pickedWorkspace);
    await dialog.getByRole('button', { name: 'Browse' }).click();
    await expect(workspaceInput).toHaveValue(pickedWorkspace);
    await saveWorkspace.click();
    await expect(dialog.getByText('Saved', { exact: true })).toBeVisible();

    const smartToggle = dialog.getByLabel(TASK_FOCUS_TOGGLE);
    await smartToggle.uncheck();
    await expect(smartToggle).not.toBeChecked();
    await smartToggle.check();
    await expect(smartToggle).toBeChecked();

    // KodaX 0.7.58 removed host-side natural-language workflow auto-start, so the
    // invocation-mode buttons (Off/Confirm/Auto) no longer exist — only the runtime
    // caps under "Advanced limits" remain (expanded by default).
    const advanced = dialog.getByRole('button', { name: 'Advanced limits' });
    await expect(advanced).toHaveAttribute('aria-expanded', 'true');
    await advanced.click();
    await expect(advanced).toHaveAttribute('aria-expanded', 'false');
    await advanced.click();
    await expect(advanced).toHaveAttribute('aria-expanded', 'true');

    await dialog.getByLabel('Max agents').fill('999');
    await page.keyboard.press('Enter');
    await expect(dialog.getByLabel('Max agents')).toHaveValue('64');

    await dialog.getByLabel('Max concurrency').fill('999');
    await page.keyboard.press('Enter');
    await expect(dialog.getByLabel('Max concurrency')).toHaveValue('16');

    // Token-budget HARD ceiling is 100,000,000 (0 = unlimited default); a value
    // above it clamps down to the ceiling.
    await dialog.getByLabel('Token budget').fill('999999999');
    await page.keyboard.press('Enter');
    await expect(dialog.getByLabel('Token budget')).toHaveValue('100000000');
  } finally {
    await space.close();
  }
});

test('Settings interactive inventory has no unnamed controls across dynamic states', async () => {
  const space = await launchSpace(`${TEST_ID}-inventory`);
  try {
    const { page } = space;
    await openSettings(page);

    await expectNamedInteractionSurface(page, 'preferences panel', [
      'Preferences',
      'Providers',
      'Close settings',
      'Default workspace',
      'Browse',
      'Save workspace',
      TASK_FOCUS_TOGGLE,
      'Advanced limits',
    ]);

    // Advanced limits is expanded by default in the 0.7.58 layout (no invocation modes).
    await expectNamedInteractionSurface(page, 'preferences advanced limits', [
      'Max agents',
      'Max concurrency',
      'Token budget',
    ]);

    await openProviders(page);
    await expectNamedInteractionSurface(page, 'providers list', [
      'Refresh',
      'Add custom',
      'Search providers',
    ]);

    await page.getByRole('button', { name: 'Add custom' }).click();
    await expectNamedInteractionSurface(page, 'custom provider form', [
      'Close form',
      'Display name',
      'OpenAI compatible',
      'Anthropic compatible',
      'Base URL',
      'Skip URL safety checks',
      'Paste API key',
      'Use environment variable',
      'Default model',
      'Model list',
      'This model has no thinking capability',
      'Effort rungs (comma-separated)',
      'Default effort',
      'API key',
      'Show API key',
      'Set as default after saving key',
      'Add provider',
      'Cancel',
    ]);

    await page.getByLabel('Display name').fill('Inventory Gateway');
    await page.getByLabel('Base URL').fill('https://inventory-gateway-api-key.example.com/v1');
    await page.getByRole('button', { name: 'Use environment variable' }).click();
    await page.getByLabel('Environment variable name').fill('INVENTORY_GATEWAY_API_KEY');
    await page.getByLabel('Default model').fill('inventory-model');
    await page.getByRole('button', { name: 'Add provider' }).click();
    const card = page.locator('article', { hasText: 'Inventory Gateway' });
    await expect(card).toBeVisible({ timeout: PROVIDER_CARD_TIMEOUT_MS });
    await card.getByRole('button', { name: 'Add key' }).click();
    await expectNamedInteractionSurface(page, 'provider card editor', [
      'INVENTORY_GATEWAY_API_KEY API key',
      'Show key',
      'Save key',
      'Cancel',
      'Delete',
    ]);
  } finally {
    await space.close();
  }
});

test('Settings language switch localizes provider settings and custom form', async () => {
  const space = await launchSpace(`${TEST_ID}-language-switch`);
  try {
    const { page } = space;
    await openSettings(page);

    await page.getByRole('button', { name: '简体中文' }).click();
    await expect(page.getByRole('tab', { name: '偏好' })).toBeVisible();

    await page.getByRole('tab', { name: '服务商' }).click();
    await expect(page.locator('#settings-panel-providers')).toBeVisible();
    await expect(page.getByText('已配置', { exact: true })).toBeVisible();
    await expect(page.getByText('密钥存储', { exact: true })).toBeVisible();

    await page.getByRole('button', { name: '添加自定义' }).click();
    await expect(page.getByRole('heading', { name: '添加自定义服务商' })).toBeVisible();
    await expect(page.getByText('凭证来源', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '粘贴 API Key' })).toBeVisible();
    await expect(page.getByRole('button', { name: '使用环境变量' })).toBeVisible();
    await expect(page.getByText('默认模型', { exact: true })).toBeVisible();
    await expect(page.getByText('模型列表', { exact: true })).toBeVisible();
    await expect(page.getByText('Model aliases')).toHaveCount(0);
  } finally {
    await space.close();
  }
});

test('Settings providers toolbar and custom form stay compact but complete', async () => {
  const space = await launchSpace(`${TEST_ID}-provider-form`);
  try {
    const { page } = space;
    await openSettings(page);
    await openProviders(page);
    const providersPanel = page.locator('#settings-panel-providers');

    await providersPanel.getByRole('button', { name: 'Refresh', exact: true }).click();
    await expect(
      providersPanel.getByRole('button', { name: 'Refresh', exact: true }),
    ).toBeEnabled();

    await page.getByRole('button', { name: 'Add custom' }).click();
    await expect(page.getByRole('heading', { name: 'Add custom provider' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Add provider' })).toBeDisabled();
    await page.getByRole('button', { name: 'Close form' }).click();
    await expect(page.getByRole('heading', { name: 'Add custom provider' })).toHaveCount(0);

    await page.getByRole('button', { name: 'Add custom' }).click();
    await page.getByLabel('Display name').fill('Escape Draft Gateway');
    await page.keyboard.press('Escape');
    await expect(page.locator('#settings-modal-title')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Add custom provider' })).toHaveCount(0);

    await page.getByRole('button', { name: 'Add custom' }).click();
    await expect(page.getByRole('button', { name: 'OpenAI compatible' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await page.getByRole('button', { name: 'Anthropic compatible' }).click();
    await expect(page.getByRole('button', { name: 'Anthropic compatible' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    const defaultCheckbox = page.getByLabel('Set as default after saving key');
    await expect(defaultCheckbox).toBeDisabled();
    const keyInput = page.getByPlaceholder('Paste API key');
    await keyInput.fill('sk-toolbar-test');
    await expect(defaultCheckbox).toBeEnabled();
    await expect(keyInput).toHaveAttribute('type', 'password');
    await page.getByRole('button', { name: 'Show API key' }).click();
    await expect(keyInput).toHaveAttribute('type', 'text');
    await page.getByRole('button', { name: 'Hide API key' }).click();
    await expect(keyInput).toHaveAttribute('type', 'password');
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByRole('heading', { name: 'Add custom provider' })).toHaveCount(0);

    await addCustomProvider(page, {
      name: 'Searchable Gateway',
      env: 'SEARCHABLE_GATEWAY_API_KEY',
      model: 'search-model',
      models: 'search-model, search-model-fast',
      key: 'sk-searchable',
      setDefault: false,
    });
    const addedModels = await page.evaluate(async () => {
      type ProviderListResult = {
        ok: boolean;
        data?: { providers: Array<{ displayName: string; models?: string[] }> };
      };
      const bridge = (
        window as unknown as {
          kodaxSpace: { invoke: (name: string, input: unknown) => Promise<unknown> };
        }
      ).kodaxSpace;
      const list = (await bridge.invoke('provider.list', undefined)) as ProviderListResult;
      return list.data?.providers.find((p) => p.displayName === 'Searchable Gateway')?.models ?? [];
    });
    expect(addedModels).toEqual(['search-model', 'search-model-fast']);

    const search = page.getByLabel('Search providers');
    await search.fill('Searchable Gateway');
    await expect(page.locator('article', { hasText: 'Searchable Gateway' })).toBeVisible();
    await search.fill('definitely-no-provider');
    await expect(page.getByText('No custom providers match the search.')).toBeVisible();
    await search.fill('');
    await expect(page.locator('article', { hasText: 'Searchable Gateway' })).toBeVisible();
  } finally {
    await space.close();
  }
});

test('Custom provider form failures remain clear and non-destructive', async () => {
  const space = await launchSpace(`${TEST_ID}-form-errors`);
  try {
    const { page } = space;
    await openSettings(page);
    await openProviders(page);

    await page.getByRole('button', { name: 'Add custom' }).click();
    await page.getByLabel('Display name').fill('Invalid Gateway');
    await page.getByLabel('Base URL').fill('http://invalid.example.com/v1');
    await page.getByRole('button', { name: 'Use environment variable' }).click();
    await page.getByLabel('Environment variable name').fill('INVALID_GATEWAY_API_KEY');
    await page.getByLabel('Default model').fill('invalid-model');
    await expect(page.getByRole('button', { name: 'Add provider' })).toBeEnabled();
    await page.getByRole('button', { name: 'Add provider' }).click();
    await expect(page.getByText('SCHEMA_INVALID')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Add custom provider' })).toBeVisible();
    await expect(page.getByLabel('Display name')).toHaveValue('Invalid Gateway');

    await page.getByLabel('Base URL').fill('https://invalid.example.com/v1');
    await page.getByLabel('Environment variable name').fill('PATH');
    await page.getByRole('button', { name: 'Add provider' }).click();
    await expect(page.getByText('apiKeyEnv "PATH" is reserved')).toBeVisible();
    await expect(page.locator('article', { hasText: 'Invalid Gateway' })).toHaveCount(0);
  } finally {
    await space.close();
  }
});

test('Provider cards support default switching, key editing, removal, and deletion', async () => {
  const space = await launchSpace(`${TEST_ID}-provider-cards`);
  try {
    const { page } = space;
    await openSettings(page);
    await openProviders(page);

    await addCustomProvider(page, {
      name: 'Alpha Gateway',
      env: 'ALPHA_GATEWAY_API_KEY',
      model: 'alpha-model',
      key: 'sk-alpha',
    });
    await addCustomProvider(page, {
      name: 'Beta Gateway',
      env: 'BETA_GATEWAY_API_KEY',
      model: 'beta-model',
      key: 'sk-beta',
      setDefault: false,
    });

    const alpha = page.locator('article', { hasText: 'Alpha Gateway' });
    const beta = page.locator('article', { hasText: 'Beta Gateway' });
    await expect(alpha.getByText('Default', { exact: true })).toBeVisible();
    await expect(beta.getByRole('button', { name: 'Set default' })).toBeVisible();

    await beta.getByRole('button', { name: 'Set default' }).click();
    await expect(beta.getByText('Default', { exact: true })).toBeVisible();
    await expect(alpha.getByText('Default', { exact: true })).toHaveCount(0);

    await space.app.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler('provider.test');
      ipcMain.handle('provider.test', async () => {
        await new Promise((resolve) => setTimeout(resolve, 350));
        return { ok: true, data: { ok: true, latencyMs: 24 } };
      });
    });
    await beta.getByRole('button', { name: 'Test' }).click();
    await expect(beta.getByRole('button', { name: 'Test' })).toBeDisabled();
    await expect(beta.getByText('Connection OK in 24ms')).toBeVisible();

    await beta.getByRole('button', { name: 'Update key' }).click();
    const betaKey = beta.getByLabel('BETA_GATEWAY_API_KEY API key');
    await expect(betaKey).toBeVisible();
    await expect(beta.getByRole('button', { name: 'Save key' })).toBeDisabled();
    await betaKey.fill('sk-beta-new');
    await beta.getByRole('button', { name: 'Show key' }).click();
    await expect(betaKey).toHaveAttribute('type', 'text');
    await beta.getByRole('button', { name: 'Cancel' }).click();
    await expect(betaKey).toHaveCount(0);

    await beta.getByRole('button', { name: 'Update key' }).click();
    await beta.getByLabel('BETA_GATEWAY_API_KEY API key').fill('sk-beta-new');
    await beta.getByRole('button', { name: 'Save key' }).click();
    await expect(beta.getByText('Ready')).toBeVisible();

    await beta.getByRole('button', { name: 'Remove key' }).click();
    await expect(beta.getByText('No key', { exact: true })).toBeVisible();
    await expect(beta.getByRole('button', { name: 'Remove key' })).toHaveCount(0);
    await expect(beta.getByRole('button', { name: 'Set default' })).toHaveCount(0);

    // Delete now uses the in-app ConfirmDialog (window.confirm stole webContents
    // focus under Electron sandbox). Cancel path: dialog shows, Cancel keeps card.
    await beta.getByRole('button', { name: 'Delete' }).click();
    const betaConfirm = page.locator(CONFIRM_DIALOG);
    await expect(betaConfirm).toContainText('Delete custom provider "Beta Gateway"');
    await betaConfirm.getByRole('button', { name: 'Cancel' }).click();
    await expect(beta).toBeVisible();

    // Confirm path: dialog Delete button actually removes the card.
    await beta.getByRole('button', { name: 'Delete' }).click();
    await page
      .locator(CONFIRM_DIALOG)
      .getByRole('button', { name: 'Delete' })
      .click();
    await expect(beta).toHaveCount(0);
  } finally {
    await space.close();
  }
});

test('Provider cards cover add-key Enter, test failure, and default cleanup states', async () => {
  const space = await launchSpace(`${TEST_ID}-provider-card-edges`);
  try {
    const { page } = space;
    await openSettings(page);
    await openProviders(page);

    await addCustomProvider(page, {
      name: 'Gamma Gateway',
      env: 'GAMMA_GATEWAY_API_KEY',
      model: 'gamma-model',
      key: undefined,
      setDefault: false,
    });

    const gamma = page.locator('article', { hasText: 'Gamma Gateway' });
    await expect(gamma.getByText('No key', { exact: true })).toBeVisible();
    await expect(gamma.getByRole('button', { name: 'Add key' })).toBeVisible();
    await expect(gamma.getByRole('button', { name: 'Test' })).toHaveCount(0);
    await expect(gamma.getByRole('button', { name: 'Set default' })).toHaveCount(0);

    await gamma.getByRole('button', { name: 'Add key' }).click();
    const gammaKey = gamma.getByLabel('GAMMA_GATEWAY_API_KEY API key');
    await gammaKey.fill('sk-gamma');
    await page.keyboard.press('Enter');
    await expect(gamma.getByText('Ready')).toBeVisible();
    await expect(gamma.getByRole('button', { name: 'Set default' })).toBeVisible();

    await gamma.getByRole('button', { name: 'Set default' }).click();
    await expect(gamma.getByText('Default', { exact: true })).toBeVisible();

    await space.app.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler('provider.test');
      ipcMain.handle('provider.test', async () => {
        await new Promise((resolve) => setTimeout(resolve, 300));
        return { ok: true, data: { ok: false, error: 'network error' } };
      });
    });
    await gamma.getByRole('button', { name: 'Test' }).click();
    await expect(gamma.getByRole('button', { name: 'Test' })).toBeDisabled();
    await expect(gamma.getByText('network error')).toBeVisible();

    await gamma.getByRole('button', { name: 'Remove key' }).click();
    await expect(gamma.getByText('No key', { exact: true })).toBeVisible();
    await expect(gamma.getByText('Default', { exact: true })).toHaveCount(0);
    const effectiveDefault = await page.evaluate(async () => {
      type ProviderListResult = {
        ok: boolean;
        data?: { defaultProviderId: string | null };
      };
      const bridge = (
        window as unknown as {
          kodaxSpace: { invoke: (name: string, input: unknown) => Promise<unknown> };
        }
      ).kodaxSpace;
      const list = (await bridge.invoke('provider.list', undefined)) as ProviderListResult;
      return list.data ? list.data.defaultProviderId : 'missing';
    });
    expect(effectiveDefault).toBeNull();
    await expect(page.getByRole('group', { name: /Default: None\./ })).toBeVisible();
    await expect(gamma.getByRole('button', { name: 'Set default' })).toHaveCount(0);

    // Delete now uses the in-app ConfirmDialog; click its confirm button.
    await gamma.getByRole('button', { name: 'Delete' }).click();
    await page
      .locator(CONFIRM_DIALOG)
      .getByRole('button', { name: 'Delete' })
      .click();
    await expect(gamma).toHaveCount(0);
  } finally {
    await space.close();
  }
});

test('Settings modal close controls are predictable and non-destructive', async () => {
  const space = await launchSpace(`${TEST_ID}-close-controls`);
  try {
    const { page } = space;
    await openSettings(page);
    await page.locator('#settings-modal-title').click();
    await expect(page.locator('#settings-modal-title')).toBeVisible();

    await page.getByRole('button', { name: 'Close settings' }).click();
    await expect(page.locator('#settings-modal-title')).toHaveCount(0);

    await page.getByTestId('settings-button').click();
    await expect(page.locator('#settings-modal-title')).toBeVisible();
    await page.mouse.click(8, 8);
    await expect(page.locator('#settings-modal-title')).toHaveCount(0);
  } finally {
    await space.close();
  }
});
