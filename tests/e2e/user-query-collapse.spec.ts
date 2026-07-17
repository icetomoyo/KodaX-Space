import { test, expect } from '@playwright/test';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { launchSpace } from './fixtures.js';

const QUERY_HEAD = 'QUERY_HEAD: compare the current architecture with the proposed direction.';
const QUERY_TAIL = 'QUERY_TAIL: finish with a concrete recommendation and acceptance criteria.';
const LONG_QUERY = [
  QUERY_HEAD,
  ...Array.from(
    { length: 12 },
    (_, index) =>
      `Context paragraph ${index + 1}: preserve enough deterministic text to wrap across several visual lines in the conversation transcript at supported desktop widths.`,
  ),
  QUERY_TAIL,
].join('\n\n');

test('long user queries keep a four-line preview and can expand or collapse in place', async () => {
  const testId = `user-query-collapse-${Date.now()}`;
  const projectDir = path.join(os.tmpdir(), `kodax-test-${testId}-project`);
  await fs.mkdir(projectDir, { recursive: true });

  const space = await launchSpace(testId);
  try {
    await space.seedProject(projectDir);

    const textarea = space.page.locator('textarea').first();
    await expect(textarea).toBeEnabled({ timeout: 10_000 });
    await textarea.fill(LONG_QUERY);
    await textarea.press('Enter');

    const bubble = space.page
      .getByTestId('conversation-stream')
      .getByTestId('user-message-bubble')
      .filter({ hasText: QUERY_HEAD })
      .last();
    await expect(bubble).toBeVisible({ timeout: 10_000 });

    const content = bubble.getByTestId('user-query-content');
    const toggle = bubble.getByTestId('user-query-toggle');
    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveAccessibleName('Expand query');
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(content).toContainText(QUERY_HEAD);

    const collapsed = await content.evaluate((element) => ({
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight,
      overflowY: getComputedStyle(element).overflowY,
    }));
    expect(collapsed.overflowY).toBe('hidden');
    expect(collapsed.scrollHeight).toBeGreaterThan(collapsed.clientHeight + 8);

    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(toggle).toHaveAccessibleName('Collapse query');
    await expect(content).toContainText(QUERY_TAIL);
    await expect
      .poll(async () => {
        const [toggleBox, contentBox] = await Promise.all([
          toggle.boundingBox(),
          content.boundingBox(),
        ]);
        return toggleBox && contentBox ? toggleBox.y < contentBox.y : false;
      })
      .toBe(true);
    await expect
      .poll(() =>
        content.evaluate((element) => Math.abs(element.scrollHeight - element.clientHeight)),
      )
      .toBeLessThanOrEqual(1);

    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(toggle).toHaveAccessibleName('Expand query');
    await expect
      .poll(() => content.evaluate((element) => element.clientHeight))
      .toBeLessThanOrEqual(collapsed.clientHeight + 1);
  } finally {
    await space.close();
    await fs.rm(projectDir, { recursive: true, force: true }).catch(() => {});
  }
});
