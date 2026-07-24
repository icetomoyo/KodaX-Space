import { test, expect } from '@playwright/test';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { launchSpace } from './fixtures.js';

const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
);

test('file picker accepts images, documents, and unknown file types', async () => {
  const testId = `file-attachments-${Date.now()}`;
  const projectDir = path.join(os.tmpdir(), `kodax-test-${testId}-project`);
  const selectedDir = path.join(os.tmpdir(), `kodax-test-${testId}-selected`);
  const pngPath = path.join(selectedDir, 'selected-photo.png');
  const svgPath = path.join(selectedDir, 'selected-diagram.svg');
  const pdfPath = path.join(selectedDir, 'selected-report.pdf');
  const unknownPath = path.join(selectedDir, 'selected-data.custom-format');
  const folderPath = path.join(selectedDir, 'selected-folder');

  await fs.mkdir(projectDir, { recursive: true });
  await fs.mkdir(selectedDir, { recursive: true });
  await fs.mkdir(folderPath, { recursive: true });
  await Promise.all([
    fs.writeFile(pngPath, TINY_PNG),
    fs.writeFile(
      svgPath,
      '<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1"/></svg>',
    ),
    fs.writeFile(pdfPath, '%PDF-1.4\n% attachment picker fixture\n'),
    fs.writeFile(unknownPath, 'arbitrary attachment content\n'),
  ]);

  const space = await launchSpace(testId);
  try {
    const { page } = space;
    await space.seedProject(projectDir);

    const input = page.getByTestId('file-attachment-input');
    await expect(input).toHaveAttribute('multiple', '');
    expect(await input.getAttribute('accept')).toBeNull();

    await page.getByRole('button', { name: 'Open attach menu' }).evaluate((button) => {
      (button as HTMLButtonElement).click();
    });
    const addFiles = page.getByRole('button', { name: 'Add files or photos' });
    await expect(addFiles).toBeVisible();
    await input.evaluate((element) => {
      element.click = () => element.setAttribute('data-picker-opened', 'true');
    });
    await addFiles.evaluate((button) => {
      (button as HTMLButtonElement).click();
    });
    await expect(input).toHaveAttribute('data-picker-opened', 'true');

    await input.setInputFiles([pngPath, svgPath, pdfPath, unknownPath]);

    const selectedImage = page.getByRole('img', { name: 'selected-photo.png' });
    await expect(selectedImage).toBeVisible({ timeout: 10_000 });
    await expect(selectedImage).toHaveAttribute('src', /^data:image\/png;base64,/);
    await expect(page.getByText('selected-diagram.svg', { exact: true })).toBeVisible();
    await expect(page.getByText('selected-report.pdf', { exact: true })).toBeVisible();
    await expect(page.getByText('selected-data.custom-format', { exact: true })).toBeVisible();

    await space.app.evaluate(async ({ dialog }, selectedPath) => {
      const patchedDialog = dialog as unknown as {
        showOpenDialog: () => Promise<{ canceled: boolean; filePaths: string[] }>;
      };
      patchedDialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [selectedPath as string],
      });
    }, folderPath);
    await page.getByRole('button', { name: 'Open attach menu' }).click();
    await page.getByRole('button', { name: 'Add folder' }).click();
    await expect(
      page.locator('span[aria-hidden="true"]', { hasText: /^selected-folder$/ }),
    ).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem('kodax-space.currentProjectPath'))).toBe(
      projectDir,
    );
  } finally {
    await space.close();
    await Promise.all([
      fs.rm(projectDir, { recursive: true, force: true }),
      fs.rm(selectedDir, { recursive: true, force: true }),
    ]);
  }
});
