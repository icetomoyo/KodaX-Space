import { test, expect } from '@playwright/test';
import path from 'node:path';
import os from 'node:os';
import { promises as fs } from 'node:fs';
import { launchSpace } from './fixtures.js';

test('provider/model picker applies selections before and after session creation', async () => {
  const testId = `model-picker-${Date.now()}`;
  const projectDir = path.join(os.tmpdir(), `kodax-test-${testId}-project`);
  await fs.mkdir(projectDir, { recursive: true });

  const rendererWarnings: string[] = [];
  let space: Awaited<ReturnType<typeof launchSpace>> | undefined;
  try {
    space = await launchSpace(testId, {
      env: {
        ANTHROPIC_API_KEY: 'e2e-placeholder',
        OPENAI_API_KEY: 'e2e-placeholder',
        SPACE_DISABLE_HARDWARE_ACCELERATION: '1',
      },
      onConsole: (message) => {
        if (message.type === 'warning' || message.type === 'error') {
          rendererWarnings.push(message.text);
        }
      },
    });
    await space.seedProject(projectDir);
    const selector = space.page.getByTestId('model-effort-selector');
    await expect(selector).toBeVisible({ timeout: 10_000 });

    await selector.click();
    await space.page.locator('button[title="OpenAI"]').click();
    await space.page.getByRole('button', { name: 'gpt-5.4', exact: true }).click();
    await expect(selector).toContainText('gpt-5.4');

    const textarea = space.page.locator('textarea').first();
    await expect(textarea).toBeEnabled({ timeout: 10_000 });
    await textarea.fill('model picker active-session check');
    await textarea.press('Enter');
    await expect(selector).toHaveAttribute('aria-label', 'Change provider, model, and effort', {
      timeout: 15_000,
    });

    await selector.click();
    await space.page.locator('button[title="Anthropic"]').click();
    await space.page.getByRole('button', { name: 'claude-opus-4-8', exact: true }).click();
    await expect(selector).toContainText('claude-opus-4-8');
    expect(rendererWarnings.filter((message) => message.includes('[picker]'))).toEqual([]);
  } finally {
    await space?.close();
    await fs.rm(projectDir, { recursive: true, force: true }).catch(() => {});
  }
});
