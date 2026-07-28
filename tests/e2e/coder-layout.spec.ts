// Coder responsive layout e2e coverage.
//
// These checks keep the shared shell honest: user sidebar preferences may stay
// persisted, but the current viewport must still preserve a readable Coder
// workspace and composer.
import { test, expect, type Page } from '@playwright/test';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import { launchSpace } from './fixtures.js';

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
  right: number;
  bottom: number;
}

const AUDIT_DIR = path.join(process.cwd(), 'artifacts', 'responsive-layout-audit');

async function createProject(testId: string): Promise<string> {
  const projectDir = path.join(os.tmpdir(), `kodax-test-${testId}-project`);
  await fs.mkdir(projectDir, { recursive: true });
  await fs.writeFile(
    path.join(projectDir, 'main.ts'),
    'export const layoutAudit = true;\n',
    'utf-8',
  );
  return projectDir;
}

async function saveScreenshot(page: Page, name: string): Promise<void> {
  await fs.mkdir(AUDIT_DIR, { recursive: true });
  await page.screenshot({ path: path.join(AUDIT_DIR, `${name}.png`), fullPage: false });
}

async function waitForCoderWorkspace(page: Page): Promise<void> {
  await expect(page.getByTestId('coder-workspace')).toBeVisible({ timeout: 10_000 });
}

async function sendPrompt(page: Page, prompt: string): Promise<void> {
  const textarea = page.locator('textarea').first();
  await expect(textarea).toBeEnabled({ timeout: 10_000 });
  await textarea.fill(prompt);
  await textarea.press('Enter');
  const stream = page.getByTestId('conversation-stream');
  await expect(stream.getByTestId('user-message-bubble').filter({ hasText: prompt })).toBeVisible({
    timeout: 10_000,
  });
  await expect(stream.getByText(/Ran 1 command/).first()).toBeVisible({ timeout: 20_000 });
}

async function snapshot(page: Page): Promise<{
  viewport: { width: number; height: number };
  rects: Record<string, Rect | null>;
}> {
  return page.evaluate(() => {
    const selectors: Record<string, string> = {
      left: '[data-testid="left-sidebar"]',
      center: '[data-testid="coder-workspace"]',
      right: '[data-testid="right-sidebar"]',
      stream: '[data-testid="conversation-stream"]',
      textarea: 'textarea',
      footer: '[data-testid="composer-footer-toolbar"]',
      context: '[data-testid="context-window-indicator"]',
      model: '[data-testid="model-effort-selector"]',
      send: '[aria-label="Send message"]',
    };
    const rectFor = (selector: string): Rect | null => {
      const element = document.querySelector(selector);
      if (!element) return null;
      const rect = element.getBoundingClientRect();
      return {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
        right: rect.right,
        bottom: rect.bottom,
      };
    };
    return {
      viewport: { width: window.innerWidth, height: window.innerHeight },
      rects: Object.fromEntries(
        Object.entries(selectors).map(([key, selector]) => [key, rectFor(selector)]),
      ),
    };
  });
}

function insideViewport(rect: Rect, viewport: { width: number; height: number }): boolean {
  return (
    rect.x >= -0.5 &&
    rect.y >= -0.5 &&
    rect.right <= viewport.width + 0.5 &&
    rect.bottom <= viewport.height + 0.5
  );
}

function horizontallySeparated(left: Rect, right: Rect): boolean {
  return left.right <= right.x + 0.5;
}

test('a manual right-sidebar toggle opens on the first click at a narrow viewport', async () => {
  const testId = `coder-narrow-sidebar-toggle-${Date.now()}`;
  const projectDir = await createProject(testId);
  const space = await launchSpace(testId);

  try {
    const { page } = space;
    await space.seedProject(projectDir);
    await page.evaluate(() => {
      window.localStorage.setItem('kodax-space.currentSurface', 'code');
      window.localStorage.setItem('kodax-space.leftSidebarOpen', '1');
      window.localStorage.setItem('kodax-space.leftSidebarWidth', '260');
      window.localStorage.setItem('kodax-space.rightSidebarOpen', '0');
      window.localStorage.setItem('kodax-space.rightSidebarWidth', '320');
    });
    await page.reload();
    await page.waitForLoadState('domcontentloaded');
    await page.setViewportSize({ width: 1024, height: 728 });

    await waitForCoderWorkspace(page);
    await expect(page.getByTestId('left-sidebar')).toBeVisible();
    await expect(page.getByTestId('right-sidebar')).toHaveCount(0);

    await page.getByRole('button', { name: 'Show right sidebar' }).click();

    await expect(page.getByTestId('right-sidebar')).toBeVisible({ timeout: 5_000 });
    await expect(
      page.getByTestId('coder-workspace').getByRole('button', { name: 'Hide right sidebar' }),
    ).toBeVisible();
    const { viewport, rects } = await snapshot(page);
    expect(rects.center, 'Coder workspace remains available').not.toBeNull();
    expect(rects.right, 'right sidebar opens after one click').not.toBeNull();
    expect(insideViewport(rects.center!, viewport), 'center pane is clipped').toBe(true);
    expect(insideViewport(rects.right!, viewport), 'right sidebar is clipped').toBe(true);
    expect(horizontallySeparated(rects.center!, rects.right!), 'sidebars overlap').toBe(true);
  } finally {
    await space.close();
    await fs.rm(projectDir, { recursive: true, force: true }).catch(() => {});
  }
});

async function expectUsableCoderLayout(
  page: Page,
  options: { requireStream?: boolean } = {},
): Promise<void> {
  const { viewport, rects } = await snapshot(page);
  expect(rects.center, 'Coder workspace exists').not.toBeNull();
  expect(rects.textarea, 'composer exists').not.toBeNull();
  if (options.requireStream) {
    expect(rects.stream, 'conversation stream exists').not.toBeNull();
  }

  const center = rects.center!;
  const textarea = rects.textarea!;
  expect(insideViewport(center, viewport), 'center pane is clipped').toBe(true);
  if (rects.stream) {
    expect(insideViewport(rects.stream, viewport), 'conversation stream is clipped').toBe(true);
  }
  expect(insideViewport(textarea, viewport), 'composer is clipped').toBe(true);
  expect(center.width, 'Coder workspace needs a readable lane').toBeGreaterThanOrEqual(520);

  expect(rects.footer, 'composer footer toolbar exists').not.toBeNull();
  expect(rects.context, 'context ring exists').not.toBeNull();
  expect(rects.model, 'model selector exists').not.toBeNull();
  expect(rects.send, 'send button exists').not.toBeNull();

  const footer = rects.footer!;
  const context = rects.context!;
  const model = rects.model!;
  const send = rects.send!;
  expect(insideViewport(footer, viewport), 'composer footer toolbar is clipped').toBe(true);
  expect(insideViewport(context, viewport), 'context ring is clipped').toBe(true);
  expect(insideViewport(model, viewport), 'model selector is clipped').toBe(true);
  expect(insideViewport(send, viewport), 'send button is clipped').toBe(true);
  expect(horizontallySeparated(context, model), 'context ring overlaps model selector').toBe(true);
  expect(horizontallySeparated(model, send), 'model selector overlaps send button').toBe(true);

  const footerOverflow = await page.getByTestId('composer-footer-toolbar').evaluate((el) => {
    const node = el as HTMLElement;
    return node.scrollWidth - node.clientWidth;
  });
  expect(footerOverflow, 'composer footer toolbar overflows horizontally').toBeLessThanOrEqual(1);

  if (rects.left) {
    expect(horizontallySeparated(rects.left, center), 'left sidebar overlaps center').toBe(true);
  }
  if (rects.right) {
    expect(horizontallySeparated(center, rects.right), 'center overlaps right sidebar').toBe(true);
  }
}

test('Coder preserves a usable workspace as persisted sidebars meet narrower screens', async () => {
  test.skip(
    !!process.env.CI && process.platform === 'win32',
    'mock assistant turn can stall on Windows CI; keep local and Linux coverage',
  );

  const testId = `coder-responsive-${Date.now()}`;
  const projectDir = await createProject(testId);
  const space = await launchSpace(testId);

  try {
    const { page } = space;
    await space.seedProject(projectDir);
    await page.evaluate(() => {
      window.localStorage.setItem('kodax-space.currentSurface', 'code');
      window.localStorage.setItem('kodax-space.leftSidebarOpen', '1');
      window.localStorage.setItem('kodax-space.leftSidebarWidth', '260');
      window.localStorage.setItem('kodax-space.rightSidebarOpen', '1');
      window.localStorage.setItem('kodax-space.rightSidebarWidth', '320');
    });
    await page.reload();
    await page.waitForLoadState('domcontentloaded');

    await page.setViewportSize({ width: 1280, height: 760 });
    await waitForCoderWorkspace(page);
    await expect(page.getByTestId('left-sidebar')).toBeVisible();
    await saveScreenshot(page, '01-coder-desktop-sidebars');
    await expectUsableCoderLayout(page);

    await page.setViewportSize({ width: 980, height: 680 });
    await waitForCoderWorkspace(page);
    await expect(page.getByTestId('left-sidebar')).toBeVisible();
    await expect(page.getByTestId('right-sidebar')).toHaveCount(0);
    await saveScreenshot(page, '02-coder-medium-right-hidden');
    await expectUsableCoderLayout(page);

    await sendPrompt(page, 'coder responsive layout audit prompt');
    await saveScreenshot(page, '03-coder-medium-after-send');
    await expectUsableCoderLayout(page, { requireStream: true });
    await expect(page.getByTestId('session-token-total')).toContainText('1.3k');
    await page.getByTestId('context-window-indicator').click();
    await expect(page.getByTestId('context-window-breakdown')).toBeVisible();
    await expect(page.getByTestId('context-window-breakdown')).toContainText(
      /Estimated request input|预计请求输入/,
    );
    await expect(page.getByTestId('context-primary-input')).toContainText('≈1.1k');
    await expect(page.getByTestId('context-provider-reported')).toContainText('1.3k');
    await expect(page.getByTestId('context-composition')).toBeVisible();
    const effectiveThreshold = Number(
      await page.getByTestId('context-effective-window-bar').getAttribute('aria-valuemax'),
    );
    expect(Number.isSafeInteger(effectiveThreshold)).toBe(true);
    expect(effectiveThreshold).toBeGreaterThan(1_280);
    await expect(page.getByTestId('context-window-facts')).toBeVisible();
    await expect(page.getByTestId('context-composition')).toContainText(
      /Request input|本次请求输入/,
    );
    await expect(page.getByTestId('context-composition')).toContainText(/Messages|对话消息/);
    await expect(page.getByTestId('context-composition')).toContainText(
      /Recent tool results|近期工具结果/,
    );
    await expect(page.locator('[data-testid^="context-composition-row-"]')).toHaveCount(6);
    await expect(page.getByTestId('context-window-breakdown')).not.toContainText(
      /Reserved response|预留输出|Auto-compact reserve|自动压缩保护区/,
    );
    await expect(page.getByTestId('context-window-breakdown')).toHaveCSS('opacity', '1');
    await expect(page.getByTestId('session-token-breakdown')).toHaveCount(0);
    await saveScreenshot(page, '03b-coder-context-breakdown');
    await page
      .getByTestId('context-window-breakdown')
      .screenshot({ path: path.join(AUDIT_DIR, '03b-coder-context-breakdown-panel.png') });
    await page.getByTestId('context-window-indicator').click();
    await page.getByTestId('session-token-indicator').click();
    await expect(page.getByTestId('session-token-breakdown')).toBeVisible();
    await expect(page.getByTestId('session-token-input-total')).toBeVisible();
    await expect(page.getByTestId('session-token-breakdown')).toContainText('640');
    await expect(page.getByTestId('session-token-breakdown')).toContainText('244');
    await expect(page.getByTestId('context-window-breakdown')).toHaveCount(0);
    await saveScreenshot(page, '03c-coder-session-token-breakdown');
    await page.getByTestId('session-token-indicator').click();

    await page.setViewportSize({ width: 760, height: 620 });
    await waitForCoderWorkspace(page);
    await expect(page.getByTestId('left-sidebar')).toHaveCount(0);
    await expect(page.getByTestId('right-sidebar')).toHaveCount(0);
    await saveScreenshot(page, '04-coder-compact-main-only');
    await expectUsableCoderLayout(page, { requireStream: true });
  } finally {
    await space.close();
    await fs.rm(projectDir, { recursive: true, force: true }).catch(() => {});
  }
});
