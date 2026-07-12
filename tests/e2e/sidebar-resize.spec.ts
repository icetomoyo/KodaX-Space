import { expect, test, type Page } from '@playwright/test';
import { launchSpace } from './fixtures.js';

const TEST_ID = `sidebar-resize-${Date.now()}`;

async function inlineWidth(page: Page, testId: string): Promise<string> {
  const locator = page.getByTestId(testId);
  await expect(locator).toBeVisible();
  return locator.evaluate((el) => (el as HTMLElement).style.width);
}

async function reload(page: Page): Promise<void> {
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
}

async function openRightSidebar(page: Page): Promise<void> {
  const sidebar = page.getByTestId('right-sidebar');
  if ((await sidebar.count()) === 0) {
    await page.getByLabel('Show right sidebar').click();
  }
  await expect(sidebar).toBeVisible();
}

test('sidebar width writes to localStorage and survives reload after manual open', async () => {
  const space = await launchSpace(TEST_ID);
  try {
    const { page } = space;
    await page.setViewportSize({ width: 1440, height: 760 });
    await page.waitForTimeout(2000);

    await page.evaluate(() => {
      window.localStorage.removeItem('kodax-space.leftSidebarWidth');
      window.localStorage.removeItem('kodax-space.rightSidebarWidth');
      window.localStorage.removeItem('kodax-space.rightSidebarOpen');
    });
    await reload(page);

    await page.evaluate(() => {
      window.localStorage.setItem('kodax-space.leftSidebarWidth', '300');
      window.localStorage.setItem('kodax-space.rightSidebarWidth', '380');
    });
    await reload(page);

    await expect(inlineWidth(page, 'left-sidebar')).resolves.toBe('300px');

    // The right sidebar additionally clamps to a responsive "expanded" ceiling
    // (~half the available paired width) that depends on the viewport, so a
    // persisted 380 renders narrower on small windows (e.g. the Windows CI
    // window). Measure that ceiling, then assert the persisted 380 round-trips
    // as min(380, ceiling) and survives another reload — stable across window
    // sizes/platforms instead of hard-coding 380px.
    await page.evaluate(() => {
      window.localStorage.setItem('kodax-space.rightSidebarWidth', '9999');
    });
    await reload(page);
    await openRightSidebar(page);
    const ceilingPx = Number.parseInt(await inlineWidth(page, 'right-sidebar'), 10);
    expect(ceilingPx).toBeGreaterThan(0);

    await page.evaluate(() => {
      window.localStorage.setItem('kodax-space.rightSidebarWidth', '380');
    });
    await reload(page);
    await openRightSidebar(page);
    const expectedRight = `${Math.min(380, ceilingPx)}px`;
    await expect(inlineWidth(page, 'right-sidebar')).resolves.toBe(expectedRight);
    await reload(page);
    await openRightSidebar(page);
    await expect(inlineWidth(page, 'right-sidebar')).resolves.toBe(expectedRight);
  } finally {
    await space.close();
  }
});

test('sidebar width clamps localStorage values to current bounds', async () => {
  const space = await launchSpace(`${TEST_ID}-clamp`);
  try {
    const { page } = space;
    await page.setViewportSize({ width: 1440, height: 760 });
    await page.waitForTimeout(2000);

    await page.evaluate(() => {
      window.localStorage.removeItem('kodax-space.leftSidebarWidth');
      window.localStorage.removeItem('kodax-space.rightSidebarWidth');
      window.localStorage.removeItem('kodax-space.rightSidebarOpen');
    });
    await reload(page);

    await page.evaluate(() => {
      window.localStorage.setItem('kodax-space.leftSidebarWidth', '50');
    });
    await reload(page);
    await expect(inlineWidth(page, 'left-sidebar')).resolves.toBe('180px');

    await page.evaluate(() => {
      window.localStorage.setItem('kodax-space.leftSidebarWidth', '9999');
    });
    await reload(page);
    const expectedMaxWidth = await page.evaluate(() => {
      return `${Math.max(300, Math.round(window.innerWidth * 0.5))}px`;
    });
    await expect(inlineWidth(page, 'left-sidebar')).resolves.toBe(expectedMaxWidth);

    await page.evaluate(() => {
      window.localStorage.setItem('kodax-space.leftSidebarWidth', 'banana');
    });
    await reload(page);
    await expect(inlineWidth(page, 'left-sidebar')).resolves.toBe('260px');
  } finally {
    await space.close();
  }
});

test('right sidebar presets stay responsive and explicit half/max modes remain visible', async () => {
  const space = await launchSpace(`${TEST_ID}-presets`);
  try {
    const { page } = space;
    await page.setViewportSize({ width: 1600, height: 760 });
    await page.evaluate(() => {
      window.localStorage.setItem('kodax-space.currentSurface', 'code');
      window.localStorage.setItem('kodax-space.leftSidebarOpen', '1');
      window.localStorage.setItem('kodax-space.leftSidebarWidth', '260');
      window.localStorage.setItem('kodax-space.rightSidebarOpen', '1');
      window.localStorage.setItem('kodax-space.rightSidebarWidth', '320');
    });
    await reload(page);
    await openRightSidebar(page);

    const right = page.getByTestId('right-sidebar');
    const center = page.getByTestId('coder-workspace');
    const left = page.getByTestId('left-sidebar');

    let halfWidth = 0;
    for (const viewportWidth of [1440, 2048]) {
      await page.setViewportSize({ width: viewportWidth, height: 760 });

      await page.getByLabel('Half width').click();
      await expect
        .poll(async () => {
          const rightBox = await right.boundingBox();
          const centerBox = await center.boundingBox();
          return Math.abs((rightBox?.width ?? 0) - (centerBox?.width ?? 0));
        })
        .toBeLessThanOrEqual(2);
      halfWidth = (await right.boundingBox())?.width ?? 0;

      await page.getByLabel('Default width').click();
      const expectedDefaultWidth = Math.min(
        halfWidth,
        520,
        Math.max(320, Math.round(halfWidth * 2 * 0.3)),
      );
      await expect
        .poll(async () => (await right.boundingBox())?.width ?? 0)
        .toBeCloseTo(expectedDefaultWidth, 0);
    }

    // Explicit half mode must not be auto-hidden just because each half is below
    // the ordinary 520px center readability threshold in a restored window.
    await page.setViewportSize({ width: 1180, height: 760 });
    await page.getByLabel('Default width').click();
    await page.getByLabel('Half width').click();
    await expect(right).toBeVisible();
    await expect(left).toHaveCount(0);
    await expect
      .poll(async () => {
        const rightBox = await right.boundingBox();
        const centerBox = await center.boundingBox();
        return Math.abs((rightBox?.width ?? 0) - (centerBox?.width ?? 0));
      })
      .toBeLessThanOrEqual(2);

    // The center-pane left toggle remains actionable while the left sidebar is
    // responsively hidden. Reopening it downgrades half → default when needed.
    await center.getByLabel('Show left sidebar').click();
    await expect(left).toBeVisible();
    await expect(right).toBeVisible();
    await expect(page.getByLabel('Default width')).toHaveAttribute('aria-pressed', 'true');
    await expect
      .poll(async () => (await center.boundingBox())?.width ?? 0)
      .toBeGreaterThanOrEqual(520);

    // Max mode is a focused Task Dock workspace: center and its resize handle leave
    // flex layout, so the dock fills from the left-sidebar gutter to the right edge.
    for (const viewportWidth of [1600, 2048]) {
      await page.setViewportSize({ width: viewportWidth, height: 760 });
      await page.getByLabel('Max width').click();
      await expect(right).toBeVisible();
      await expect(center).toBeHidden();
      await expect
        .poll(async () => {
          const rightBox = await right.boundingBox();
          return Math.abs((rightBox?.x ?? 0) + (rightBox?.width ?? 0) - (viewportWidth - 10));
        })
        .toBeLessThanOrEqual(1);
      const leftBox = await left.boundingBox();
      const rightBox = await right.boundingBox();
      expect((rightBox?.x ?? 0) - ((leftBox?.x ?? 0) + (leftBox?.width ?? 0))).toBeLessThanOrEqual(
        25,
      );
    }
  } finally {
    await space.close();
  }
});
