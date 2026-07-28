import { test, expect } from '@playwright/test';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { launchSpace } from './fixtures.js';

test('conversation file paths reuse the complete file action menu', async () => {
  test.setTimeout(60_000);
  const testId = `markdown-file-actions-${Date.now()}`;
  const projectDir = path.join(os.tmpdir(), `kodax-test-${testId}-project`);
  const relativePath = 'notes/right-click.md';
  const absolutePath = path.join(projectDir, ...relativePath.split('/'));
  const outsidePath = '/tmp/outside.md';
  await fs.mkdir(path.dirname(absolutePath), { recursive: true });
  await fs.writeFile(absolutePath, '# Right-click file actions\n', 'utf-8');

  const space = await launchSpace(testId);
  try {
    await space.seedProject(projectDir);

    const textarea = space.page.locator('textarea').first();
    await expect(textarea).toBeEnabled({ timeout: 10_000 });

    const stream = space.page.getByTestId('conversation-stream');
    const filePath = stream.getByRole('button', { name: relativePath }).last();
    const linkedFile = stream.getByRole('link', { name: 'old.md' }).last();
    const webLink = stream.getByRole('link', { name: 'web' }).last();
    const deliveryLink = stream.getByRole('link', { name: 'delivery' }).last();
    const evidenceLink = stream.getByRole('link', { name: 'evidence' }).last();
    const outsideFile = stream.getByRole('button', { name: outsidePath }).last();

    async function send(markdown: string): Promise<void> {
      await expect(textarea).toBeEnabled({ timeout: 10_000 });
      await textarea.fill(markdown);
      await textarea.press('Enter');
    }

    await send(`\`${relativePath}\``);
    await expect(filePath).toBeVisible({ timeout: 10_000 });
    await send(`[old.md](${relativePath})`);
    await expect(linkedFile).toBeVisible({ timeout: 10_000 });
    await send('[web](https://example.test/report.md)');
    await expect(webLink).toBeVisible({ timeout: 10_000 });
    await send('[delivery](<kodax-space://partner-delivery/pd_e2e>)');
    await expect(deliveryLink).toBeVisible({ timeout: 10_000 });
    await send('[evidence](#kodax-cite-cite_12345678)');
    await expect(evidenceLink).toBeVisible({ timeout: 10_000 });
    await send(`\`${outsidePath}\``);
    await expect(outsideFile).toBeVisible({ timeout: 10_000 });

    await linkedFile.click();
    const viewer = space.page.getByTestId('file-viewer');
    await expect(viewer).toBeVisible();
    await expect(viewer).toContainText('right-click.md');

    for (const excluded of [webLink, deliveryLink, evidenceLink, outsideFile]) {
      await excluded.click({ button: 'right' });
      await expect(space.page.getByRole('menu')).toHaveCount(0);
    }

    await linkedFile.click({ button: 'right' });
    await expect(
      space.page.getByRole('menu').getByRole('menuitem', { name: 'Open in File Viewer' }),
    ).toBeVisible();
    await space.page.keyboard.press('Escape');

    await filePath.click({ button: 'right' });

    const menu = space.page.getByRole('menu');
    await expect(menu.getByRole('menuitem', { name: 'Open in File Viewer' })).toBeVisible();
    await expect(menu.getByRole('menuitem', { name: 'Open diff' })).toBeVisible();
    await expect(menu.getByRole('menuitem', { name: 'Insert @path' })).toBeVisible();
    await expect(menu.getByRole('menuitem', { name: 'Copy relative path' })).toBeVisible();
    await expect(menu.getByRole('menuitem', { name: 'Reveal in file manager' })).toBeVisible();

    await space.page.keyboard.press('Escape');
    await filePath.focus();
    await space.page.keyboard.press('Shift+F10');
    await expect(menu.getByRole('menuitem', { name: 'Open in File Viewer' })).toBeFocused();
    await space.page.keyboard.press('ArrowDown');
    await expect(menu.getByRole('menuitem', { name: 'Open diff' })).toBeFocused();
    await space.page.keyboard.press('Escape');
    await expect(filePath).toBeFocused();
    await expect(filePath).toHaveAttribute('aria-expanded', 'false');

    await filePath.click({ button: 'right' });
    await menu.getByRole('menuitem', { name: 'Open in File Viewer' }).click();
    await expect(viewer).toBeVisible();
    await expect(viewer).toContainText('right-click.md');

    await space.page.evaluate(() => {
      window.dispatchEvent(new Event('kodax-space.open-files-workspace'));
    });
    const filesPanel = space.page.getByTestId('files-panel');
    await expect(filesPanel).toBeVisible({ timeout: 10_000 });
    await filesPanel.getByTestId('files-search-input').fill('right-click.md');
    const searchResult = filesPanel.getByTestId('files-search-result').first();
    await expect(searchResult).toBeVisible({ timeout: 20_000 });
    await searchResult.focus();
    await searchResult.click({ button: 'right' });
    await expect(menu.getByRole('menuitem', { name: 'Open in File Viewer' })).toBeFocused();
    await space.page.keyboard.press('Escape');
    await expect(searchResult).toBeFocused();
  } finally {
    await space.close();
    await fs.rm(projectDir, { recursive: true, force: true }).catch(() => {});
  }
});
