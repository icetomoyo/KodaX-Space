import { test, expect, type Page } from '@playwright/test';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import type { SessionEvent } from '@kodax-space/space-ipc-schema';
import { launchSpace, type SpaceInstance } from './fixtures.js';

interface SessionListEnvelope {
  ok: boolean;
  data?: { sessions?: Array<{ sessionId: string }> };
}

async function createProject(testId: string): Promise<string> {
  const projectDir = path.join(os.tmpdir(), `kodax-test-${testId}-project`);
  await fs.mkdir(projectDir, { recursive: true });
  await fs.writeFile(path.join(projectDir, 'main.ts'), 'export const expandLazy = true;\n');
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
  await space.page.waitForTimeout(400);

  const readSessionId = () =>
    space.page.evaluate(async () => {
      const result = await (
        window as unknown as {
          kodaxSpace: {
            invoke: (name: string, input: unknown) => Promise<SessionListEnvelope>;
          };
        }
      ).kodaxSpace.invoke('session.list', { surface: 'code' });
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

function seededExpandEvents(sessionId: string): SessionEvent[] {
  const before = Array.from({ length: 18 }, (_, index) => {
    return `Expand lazy filler ${index + 1}. This creates enough scroll room for deterministic layout.`;
  }).join('\n\n');
  const oldSource = Array.from({ length: 140 }, (_, index) => {
    return `export const oldValue${index} = ${index};`;
  }).join('\n');
  const newSource = Array.from({ length: 140 }, (_, index) => {
    return `export const newValue${index} = ${index + 1};`;
  }).join('\n');
  const events: SessionEvent[] = [
    { kind: 'text_delta', sessionId, text: before },
    { kind: 'thinking_delta', sessionId, text: 'Plan before tools. '.repeat(180) },
  ];

  for (let index = 0; index < 6; index++) {
    const toolName = index % 2 === 0 ? 'bash' : 'read';
    const toolId = `lazy-tool-${index}`;
    events.push({
      kind: 'tool_start',
      sessionId,
      toolId,
      toolName,
      input: { path: `src/lazy-${index}.ts`, command: `inspect ${index}` },
    });
    events.push({
      kind: 'tool_result',
      sessionId,
      toolId,
      toolName,
      content: Array.from({ length: 36 }, (_, line) => {
        return `${toolName} output ${index}.${line}: ${'x'.repeat(80)}`;
      }).join('\n'),
    });
  }

  events.push(
    {
      kind: 'tool_start',
      sessionId,
      toolId: 'lazy-edit-tool',
      toolName: 'edit',
      input: { file_path: 'src/heavy.ts', old_string: oldSource, new_string: newSource },
    },
    {
      kind: 'tool_result',
      sessionId,
      toolId: 'lazy-edit-tool',
      toolName: 'edit',
      content: 'edited src/heavy.ts',
    },
    { kind: 'session_complete', sessionId },
  );
  return events;
}

function lastToolCluster(page: Page) {
  return page.getByTestId('process-receipt-tool_cluster').last();
}

test('conversation expansion lazy-mounts hidden tool details and defers Monaco diff mount', async () => {
  test.skip(
    !!process.env.CI && process.platform === 'win32',
    'mock assistant turn can stall on Windows CI; keep local and Linux coverage',
  );

  const testId = `conversation-expand-lazy-${Date.now()}`;
  const projectDir = await createProject(testId);
  const space = await launchSpace(testId);

  try {
    const { page } = space;
    await page.setViewportSize({ width: 1600, height: 900 });
    await space.seedProject(projectDir);

    const sessionId = await createSession(space, 'seed lazy expansion audit');
    await emitSessionEvents(space, seededExpandEvents(sessionId));
    await expect(lastToolCluster(page)).toBeVisible({ timeout: 8_000 });

    await lastToolCluster(page).getByRole('button').first().click();
    await expect(page.getByTestId('tool-call-card')).toHaveCount(7, { timeout: 8_000 });
    await expect(page.getByTestId('tool-call-card-details')).toHaveCount(1);

    await page.getByTestId('tool-call-card').first().getByRole('button').first().click();
    await expect(page.getByTestId('tool-call-card-details')).toHaveCount(2);

    const diffView = page.getByTestId('tool-diff-view').first();
    const diffToggle = diffView.getByRole('button').first();
    const immediate = await diffToggle.evaluate(async (button) => {
      if (!(button instanceof HTMLButtonElement)) {
        throw new Error('Expected diff toggle button');
      }

      const win = window as Window & {
        __kodaxQueuedRafs?: Array<{ id: number; callback: FrameRequestCallback }>;
        __kodaxOriginalRaf?: typeof window.requestAnimationFrame;
        __kodaxOriginalCancelRaf?: typeof window.cancelAnimationFrame;
      };
      let nextRafId = 1;
      const queuedRafs: Array<{ id: number; callback: FrameRequestCallback }> = [];
      win.__kodaxQueuedRafs = queuedRafs;
      win.__kodaxOriginalRaf = window.requestAnimationFrame.bind(window);
      win.__kodaxOriginalCancelRaf = window.cancelAnimationFrame.bind(window);
      window.requestAnimationFrame = (callback: FrameRequestCallback) => {
        const id = nextRafId++;
        queuedRafs.push({ id, callback });
        return id;
      };
      window.cancelAnimationFrame = (id: number) => {
        const index = queuedRafs.findIndex((item) => item.id === id);
        if (index >= 0) queuedRafs.splice(index, 1);
      };

      button.click();
      await new Promise((resolve) => window.setTimeout(resolve, 0));
      const root = button.closest('[data-testid="tool-diff-view"]');
      const region = root?.querySelector('[data-testid="tool-diff-editor-region"]');
      return {
        expanded: button.getAttribute('aria-expanded'),
        busy: region?.getAttribute('aria-busy') ?? null,
        loadingVisible: Boolean(region?.querySelector('[data-testid="tool-diff-loading"]')),
        monacoMounted: Boolean(region?.querySelector('.monaco-editor')),
      };
    });

    expect(immediate.expanded).toBe('true');
    expect(immediate.busy).toBe('true');
    expect(immediate.loadingVisible).toBe(true);
    expect(immediate.monacoMounted).toBe(false);
    await page.evaluate(() => {
      const win = window as Window & {
        __kodaxQueuedRafs?: Array<{ id: number; callback: FrameRequestCallback }>;
        __kodaxOriginalRaf?: typeof window.requestAnimationFrame;
        __kodaxOriginalCancelRaf?: typeof window.cancelAnimationFrame;
      };
      const queuedRafs = win.__kodaxQueuedRafs ?? [];
      const originalRaf = win.__kodaxOriginalRaf;
      const originalCancelRaf = win.__kodaxOriginalCancelRaf;
      if (originalRaf) window.requestAnimationFrame = originalRaf;
      if (originalCancelRaf) window.cancelAnimationFrame = originalCancelRaf;
      delete win.__kodaxQueuedRafs;
      delete win.__kodaxOriginalRaf;
      delete win.__kodaxOriginalCancelRaf;
      for (const { callback } of queuedRafs.splice(0)) callback(performance.now());
    });
    await expect(diffView.getByTestId('tool-diff-editor-region')).toHaveAttribute(
      'aria-busy',
      'false',
      { timeout: 3_000 },
    );
  } finally {
    await space.close();
    await fs.rm(projectDir, { recursive: true, force: true }).catch(() => {});
  }
});
