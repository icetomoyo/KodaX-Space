import { test, expect, type Page } from '@playwright/test';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import type { SessionEvent } from '@kodax-space/space-ipc-schema';
import { launchSpace, type SpaceInstance } from './fixtures.js';

interface SessionListEnvelope {
  ok: boolean;
  data?: { sessions?: Array<{ sessionId: string }> };
  error?: { message?: string };
}

interface RectSnapshot {
  x: number;
  y: number;
  width: number;
  height: number;
  right: number;
  bottom: number;
}

interface ScrollSnapshot {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
  distanceFromBottom: number;
  receiptTop: number;
}

interface ExpandedReceiptLayout {
  rowClientWidth: number;
  rowScrollWidth: number;
  tool: RectSnapshot;
  toolHeader: RectSnapshot;
  thinking: RectSnapshot;
  toolCardCount: number;
}

function receiptPairRow(page: Page) {
  return page
    .locator('[data-testid="process-receipt-row"]')
    .filter({ has: page.locator('[data-testid="process-receipt-tool_cluster"]') })
    .filter({ has: page.locator('[data-testid="process-receipt-thinking"]') })
    .last();
}

async function createProject(testId: string): Promise<string> {
  const projectDir = path.join(os.tmpdir(), `kodax-test-${testId}-project`);
  await fs.mkdir(projectDir, { recursive: true });
  await fs.writeFile(path.join(projectDir, 'main.ts'), 'export const receiptAudit = true;\n');
  return projectDir;
}

async function createSession(space: SpaceInstance, prompt: string): Promise<string> {
  const textarea = space.page.locator('textarea').first();
  await expect(textarea).toBeEnabled({ timeout: 10_000 });
  await textarea.fill(prompt);
  await textarea.press('Enter');

  const stream = space.page.getByTestId('conversation-stream');
  await expect(stream.getByTestId('user-message-bubble').filter({ hasText: prompt })).toBeVisible({
    timeout: 10_000,
  });
  await expect(stream.getByText(/Ran 1 command/).first()).toBeVisible({ timeout: 20_000 });
  await space.page.waitForTimeout(300);

  const readSessionId = () =>
    space.page.evaluate(async () => {
      const bridge = (
        window as unknown as {
          kodaxSpace: {
            invoke: (name: string, input: unknown) => Promise<SessionListEnvelope>;
          };
        }
      ).kodaxSpace;
      const result = await bridge.invoke('session.list', { surface: 'code' });
      if (!result.ok) return null;
      return result.data?.sessions?.[0]?.sessionId ?? null;
    });

  await expect.poll(readSessionId, { timeout: 20_000 }).not.toBeNull();
  const sessionId = await readSessionId();
  if (!sessionId) throw new Error('Session was not created');
  return sessionId;
}

async function emitSessionEvents(
  space: SpaceInstance,
  events: readonly SessionEvent[],
): Promise<void> {
  await space.app.evaluate(({ BrowserWindow }, payloads) => {
    const win = BrowserWindow.getAllWindows()[0];
    if (!win) throw new Error('No BrowserWindow available');
    for (const payload of payloads) win.webContents.send('session.event', payload);
  }, events);
}

function fillerParagraphs(label: string, count: number): string {
  return Array.from({ length: count }, (_, index) => {
    const n = index + 1;
    return `${label} ${n}. This paragraph is intentionally long enough to create vertical scroll room while keeping the transcript content deterministic for layout regression testing.`;
  }).join('\n\n');
}

function seededTranscriptEvents(sessionId: string): SessionEvent[] {
  const before = fillerParagraphs('Receipt layout filler before', 28);
  const after = fillerParagraphs('Receipt layout filler after', 24);
  const thinking =
    'Preserve the compact receipt row while keeping thinking token count readable. '.repeat(8);

  const toolEvents: SessionEvent[] = [];
  for (let index = 1; index <= 3; index++) {
    const toolId = `receipt-tool-${index}`;
    toolEvents.push(
      {
        kind: 'tool_start',
        sessionId,
        toolId,
        toolName: 'bash',
        input: { command: `inspect receipt layout ${index}` },
      },
      {
        kind: 'tool_result',
        sessionId,
        toolId,
        toolName: 'bash',
        content: `completed receipt layout inspection ${index}`,
      },
    );
  }

  return [
    { kind: 'text_delta', sessionId, text: before },
    ...toolEvents,
    { kind: 'thinking_delta', sessionId, text: thinking },
    { kind: 'text_delta', sessionId, text: `\n\n${after}` },
    { kind: 'session_complete', sessionId },
  ];
}

async function getReceiptLayout(page: Page): Promise<{
  row: RectSnapshot;
  tool: RectSnapshot;
  thinking: RectSnapshot;
}> {
  return receiptPairRow(page).evaluate((row) => {
    const rectFor = (element: Element): RectSnapshot => {
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
    const tool = row.querySelector('[data-testid="process-receipt-tool_cluster"]');
    const thinking = row.querySelector('[data-testid="process-receipt-thinking"]');
    if (!tool || !thinking) throw new Error('Expected tool and thinking receipts in one row');
    return {
      row: rectFor(row),
      tool: rectFor(tool),
      thinking: rectFor(thinking),
    };
  });
}

async function getExpandedReceiptLayout(page: Page): Promise<ExpandedReceiptLayout> {
  return receiptPairRow(page).evaluate((row) => {
    const rectFor = (element: Element): RectSnapshot => {
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
    const tool = row.querySelector('[data-testid="process-receipt-tool_cluster"]');
    const toolHeader = tool?.querySelector('button[aria-expanded="true"]');
    const thinking = row.querySelector('[data-testid="process-receipt-thinking"]');
    if (
      !(row instanceof HTMLElement) ||
      !(tool instanceof HTMLElement) ||
      !(toolHeader instanceof HTMLElement) ||
      !(thinking instanceof HTMLElement)
    ) {
      throw new Error('Expected an expanded tool receipt followed by a thinking receipt');
    }
    return {
      rowClientWidth: row.clientWidth,
      rowScrollWidth: row.scrollWidth,
      tool: rectFor(tool),
      toolHeader: rectFor(toolHeader),
      thinking: rectFor(thinking),
      toolCardCount: tool.querySelectorAll('[data-testid="tool-call-card"]').length,
    };
  });
}

async function getHoveredThinkingClipEvidence(page: Page): Promise<{
  rowOverflowY: string;
  hoverTranslateY: number;
  topEdgeHitTestsToButton: boolean;
}> {
  await receiptPairRow(page).locator('[data-testid="process-receipt-thinking"] button').hover();
  await page.waitForTimeout(180);

  return page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('[data-testid="process-receipt-row"]'));
    const row = rows
      .reverse()
      .find(
        (candidate) =>
          candidate.querySelector('[data-testid="process-receipt-tool_cluster"]') &&
          candidate.querySelector('[data-testid="process-receipt-thinking"]'),
      );
    const button = row?.querySelector('[data-testid="process-receipt-thinking"] button');
    if (!(row instanceof HTMLElement) || !(button instanceof HTMLElement)) {
      throw new Error('Missing hovered receipt row or thinking button');
    }

    const buttonRect = button.getBoundingClientRect();
    const transform = getComputedStyle(button).transform;
    const matrix = transform === 'none' ? null : new DOMMatrixReadOnly(transform);
    const hitTarget = document.elementFromPoint(
      buttonRect.left + Math.min(12, buttonRect.width / 2),
      buttonRect.top + 1,
    );

    return {
      rowOverflowY: getComputedStyle(row).overflowY,
      hoverTranslateY: matrix?.m42 ?? 0,
      topEdgeHitTestsToButton: hitTarget === button || button.contains(hitTarget),
    };
  });
}

async function getScrollSnapshot(page: Page): Promise<ScrollSnapshot> {
  return page.evaluate(() => {
    const scroller = document.querySelector('[data-testid="conversation-scroll-container"]');
    const receipts = Array.from(document.querySelectorAll('[data-testid="process-receipt-row"]'));
    const row = receipts
      .reverse()
      .find(
        (candidate) =>
          candidate.querySelector('[data-testid="process-receipt-tool_cluster"]') &&
          candidate.querySelector('[data-testid="process-receipt-thinking"]'),
      );
    if (!(scroller instanceof HTMLElement) || !(row instanceof HTMLElement)) {
      throw new Error('Missing conversation scroller or receipt row');
    }
    const scrollerRect = scroller.getBoundingClientRect();
    const rowRect = row.getBoundingClientRect();
    return {
      scrollTop: scroller.scrollTop,
      scrollHeight: scroller.scrollHeight,
      clientHeight: scroller.clientHeight,
      distanceFromBottom: scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight,
      receiptTop: rowRect.top - scrollerRect.top,
    };
  });
}

async function centerLastReceipt(page: Page): Promise<void> {
  await page.evaluate(() => {
    const scroller = document.querySelector('[data-testid="conversation-scroll-container"]');
    const rows = Array.from(document.querySelectorAll('[data-testid="process-receipt-row"]'));
    const row = rows
      .reverse()
      .find(
        (candidate) =>
          candidate.querySelector('[data-testid="process-receipt-tool_cluster"]') &&
          candidate.querySelector('[data-testid="process-receipt-thinking"]'),
      );
    if (!(scroller instanceof HTMLElement) || !(row instanceof HTMLElement)) {
      throw new Error('Missing conversation scroller or receipt pair row');
    }

    const scrollerRect = scroller.getBoundingClientRect();
    const rowRect = row.getBoundingClientRect();
    const rowTop = rowRect.top - scrollerRect.top + scroller.scrollTop;
    const targetTop = Math.max(0, rowTop - scroller.clientHeight * 0.42);
    scroller.scrollTop = targetTop;
    scroller.dispatchEvent(
      new WheelEvent('wheel', { deltaY: -24, bubbles: true, cancelable: true }),
    );
    scroller.dispatchEvent(new Event('scroll', { bubbles: true }));
  });
  await page.waitForTimeout(240);
}

test('conversation receipt strip stays top-anchored on expand and preserves scroll through sidebar resizing', async () => {
  test.skip(
    !!process.env.CI && process.platform === 'win32',
    'mock assistant turn can stall on Windows CI; keep local and Linux coverage',
  );

  const testId = `conversation-receipts-scroll-${Date.now()}`;
  const projectDir = await createProject(testId);
  const space = await launchSpace(testId);

  try {
    const { page } = space;
    await page.setViewportSize({ width: 1600, height: 900 });
    await space.seedProject(projectDir);

    const sessionId = await createSession(space, 'seed conversation receipt layout audit');
    await emitSessionEvents(space, [
      {
        kind: 'todo_update',
        sessionId,
        items: [
          {
            id: 'receipt-plan-1',
            content: 'Keep right sidebar open for resize checks',
            status: 'pending',
          },
        ],
      },
      ...seededTranscriptEvents(sessionId),
    ]);

    if ((await page.getByTestId('right-sidebar').count()) === 0) {
      await page.getByLabel('Show right sidebar').click();
    }
    await expect(page.getByTestId('right-sidebar')).toBeVisible({ timeout: 8_000 });
    await expect(receiptPairRow(page)).toBeVisible({ timeout: 8_000 });

    await centerLastReceipt(page);
    const layout = await getReceiptLayout(page);
    const chipGap = layout.thinking.x - layout.tool.right;
    expect(
      Math.abs(layout.thinking.y - layout.tool.y),
      'receipt chips should share a line',
    ).toBeLessThan(6);
    expect(
      Math.abs(layout.thinking.height - layout.tool.height),
      'collapsed command and thinking receipt chips should share one height',
    ).toBeLessThanOrEqual(1);
    expect(chipGap, 'receipt chips should be visually adjacent').toBeGreaterThanOrEqual(0);
    expect(chipGap, 'receipt chips should not be pushed across the row').toBeLessThanOrEqual(12);
    expect(layout.tool.width, 'tool chip should size to content, not fill the row').toBeLessThan(
      layout.row.width * 0.65,
    );

    const toolReceipt = receiptPairRow(page).getByTestId('process-receipt-tool_cluster');
    await toolReceipt.getByRole('button').first().click();
    await expect(toolReceipt.getByTestId('tool-call-card')).toHaveCount(3);

    const expandedLayout = await getExpandedReceiptLayout(page);
    expect(expandedLayout.toolCardCount).toBe(3);
    expect(
      expandedLayout.tool.height,
      'expanded tool group should be tall enough to exercise sibling alignment',
    ).toBeGreaterThan(expandedLayout.toolHeader.height * 3);
    expect(
      Math.abs(expandedLayout.thinking.y - expandedLayout.toolHeader.y),
      'thinking receipt should stay anchored to the tool summary line',
    ).toBeLessThan(6);

    await page.setViewportSize({ width: 900, height: 900 });
    await page.waitForTimeout(320);
    await centerLastReceipt(page);
    const narrowLayout = await getExpandedReceiptLayout(page);
    const isTopAligned = Math.abs(narrowLayout.thinking.y - narrowLayout.toolHeader.y) < 6;
    const followsExpandedTools = narrowLayout.thinking.y >= narrowLayout.tool.bottom - 2;
    const horizontalOverlap =
      Math.min(narrowLayout.tool.right, narrowLayout.thinking.right) -
      Math.max(narrowLayout.tool.x, narrowLayout.thinking.x);
    const verticalOverlap =
      Math.min(narrowLayout.tool.bottom, narrowLayout.thinking.bottom) -
      Math.max(narrowLayout.tool.y, narrowLayout.thinking.y);
    expect(
      isTopAligned || followsExpandedTools,
      'narrow layout should keep thinking at the summary line or wrap it after the expanded tools',
    ).toBe(true);
    expect(
      horizontalOverlap > 1 && verticalOverlap > 1,
      'responsive receipt items should not overlap',
    ).toBe(false);
    expect(
      narrowLayout.rowScrollWidth,
      'responsive receipt row should not create horizontal overflow',
    ).toBeLessThanOrEqual(narrowLayout.rowClientWidth + 1);

    await toolReceipt.getByRole('button').first().click();
    await expect(toolReceipt.getByTestId('tool-call-card')).toHaveCount(0);
    await page.setViewportSize({ width: 1600, height: 900 });
    await page.waitForTimeout(320);
    await centerLastReceipt(page);

    const hoverEvidence = await getHoveredThinkingClipEvidence(page);
    expect(hoverEvidence.rowOverflowY, 'hovered receipt edge should not be clipped by row').toBe(
      'visible',
    );
    expect(hoverEvidence.hoverTranslateY, 'receipt hover should keep the subtle lift').toBeLessThan(
      -0.2,
    );
    expect(
      hoverEvidence.topEdgeHitTestsToButton,
      'hovered top edge should remain visible and hittable',
    ).toBe(true);

    const before = await getScrollSnapshot(page);
    expect(before.distanceFromBottom, 'test setup should be away from bottom').toBeGreaterThan(180);

    await page.getByLabel('Max width').click();
    await page.waitForTimeout(420);
    // Max mode intentionally removes the conversation pane from layout so Task Dock
    // becomes the focused workspace. The pane stays mounted; verify its scroll state
    // after restoring a visible preset instead of reading zero-sized hidden geometry.
    await expect(page.getByTestId('coder-workspace')).toBeHidden();

    await page.getByLabel('Default width').click();
    await page.waitForTimeout(420);
    const afterDefault = await getScrollSnapshot(page);
    expect(
      afterDefault.distanceFromBottom,
      'default width should not jump to bottom',
    ).toBeGreaterThan(120);
    expect(
      Math.abs(afterDefault.receiptTop - before.receiptTop),
      'receipt anchor after restoring from max width',
    ).toBeLessThan(90);

    await page.getByLabel('Jump to bottom').click();
    await expect
      .poll(async () => (await getScrollSnapshot(page)).distanceFromBottom, { timeout: 3_000 })
      .toBeLessThan(8);
  } finally {
    await space.close();
    await fs.rm(projectDir, { recursive: true, force: true }).catch(() => {});
  }
});

async function streamScrollbackFixture(space: SpaceInstance, sessionId: string): Promise<void> {
  const events: SessionEvent[] = [{ kind: 'session_start', sessionId, provider: 'mock' }];
  for (let index = 0; index < 30; index++) {
    if (index % 5 === 0) {
      events.push({
        kind: 'mid_turn_user_prompt',
        sessionId,
        content: `Question ${index}`,
        entryId: `scrollback-user-${index}`,
      });
    }
    events.push(
      {
        kind: 'text_delta',
        sessionId,
        text:
          `Scrollback block ${index}\n\n` +
          '这是一段用于验证窗口宽度改变后历史内容滚动位置的确定性文本。'.repeat(3 + (index % 4)),
      },
      {
        kind: 'tool_start',
        sessionId,
        toolId: `scrollback-${index}`,
        toolName: 'bash',
        input: { command: 'fixture' },
      },
      {
        kind: 'tool_result',
        sessionId,
        toolId: `scrollback-${index}`,
        toolName: 'bash',
        content: 'fixture complete',
      },
    );
  }
  events.push({ kind: 'text_delta', sessionId, text: fillerParagraphs('Scrollback live tail', 8) });
  // Incremental creation exercises remembered row sizes; bulk restoration conceals this bug.
  for (const event of events) {
    await emitSessionEvents(space, [event]);
    await space.page.evaluate(
      () =>
        new Promise<void>((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
        }),
    );
  }
}

async function expectStableReadingWhileScrollingBack(page: Page): Promise<void> {
  const scroller = page.getByTestId('conversation-scroll-container');
  const bounds = await scroller.boundingBox();
  if (!bounds) throw new Error('Missing conversation viewport');
  // Keep the pointer over the transcript, clear of the query navigation rail.
  await page.mouse.move(bounds.x + bounds.width * 0.6, bounds.y + bounds.height / 2);
  let checkedAnchors = 0;
  for (let step = 0; step < 18; step++) {
    const anchor = await scroller.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const paragraph = [0.25, 0.35, 0.45, 0.55, 0.65]
        .map((fraction) =>
          document
            .elementFromPoint(rect.left + rect.width * 0.6, rect.top + rect.height * fraction)
            ?.closest('p'),
        )
        .find((node) => node instanceof HTMLElement);
      if (!(paragraph instanceof HTMLElement)) return null;
      paragraph.dataset.scrollbackAnchor = 'true';
      return { top: paragraph.getBoundingClientRect().top, scrollTop: element.scrollTop };
    });
    await page.mouse.wheel(0, -180);
    // Measure the entire gesture, including delayed offscreen layout corrections.
    await page.waitForTimeout(450);
    if (!anchor) continue;
    checkedAnchors++;
    const paragraph = page.locator('[data-scrollback-anchor="true"]');
    const top = await paragraph.evaluate((node) => node.getBoundingClientRect().top);
    await paragraph.evaluate((node) => node.removeAttribute('data-scrollback-anchor'));
    const expectedTop = anchor.top + Math.min(180, anchor.scrollTop);
    expect(
      Math.abs(top - expectedTop),
      `extra text displacement on wheel ${step}`,
    ).toBeLessThanOrEqual(3);
  }
  expect(
    checkedAnchors,
    'must sample enough actual text, not empty row gaps',
  ).toBeGreaterThanOrEqual(12);
}

for (const scenario of [
  { label: 'completed', completed: true, quality: 'full' },
  { label: 'active', completed: false, quality: 'balanced' },
] as const) {
  test(`scrollback stays stable after resizing a ${scenario.label} streamed conversation`, async () => {
    test.setTimeout(90_000);
    const testId = `conversation-scrollback-${scenario.label}-${Date.now()}`;
    const projectDir = await createProject(testId);
    const space = await launchSpace(testId);
    try {
      const { page } = space;
      await page.setViewportSize({ width: 1080, height: 900 });
      await page.evaluate(
        (quality) => localStorage.setItem('kodax-space.visualQuality', quality),
        scenario.quality,
      );
      await space.seedProject(projectDir);
      const sessionId = await createSession(space, 'seed long scrollback audit');
      await streamScrollbackFixture(space, sessionId);
      if (scenario.completed)
        await emitSessionEvents(space, [{ kind: 'session_complete', sessionId }]);
      await page.waitForTimeout(600);
      await page.setViewportSize({ width: 1600, height: 900 });
      await page.waitForTimeout(600);
      const jump = page.getByLabel('Jump to bottom');
      if (await jump.isVisible()) await jump.click();
      await page.waitForTimeout(800);
      await expectStableReadingWhileScrollingBack(page);
    } finally {
      await space.close();
      await fs.rm(projectDir, { recursive: true, force: true });
    }
  });
}
