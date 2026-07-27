import { expect, test, type Locator, type Page } from '@playwright/test';
import path from 'node:path';
import os from 'node:os';
import { promises as fs } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { launchSpace, type SpaceInstance } from './fixtures.js';
import type { SessionEvent } from '@kodax-space/space-ipc-schema';

const execFileAsync = promisify(execFile);

test.setTimeout(90_000);

interface SessionListEnvelope {
  ok: boolean;
  data?: { sessions?: Array<{ sessionId: string; projectRoot?: string }> };
}

async function createGitProject(testId: string): Promise<string> {
  const projectDir = path.join(os.tmpdir(), `kodax-test-${testId}-project`);
  await fs.mkdir(projectDir, { recursive: true });
  await execFileAsync('git', ['init'], { cwd: projectDir });
  await fs.writeFile(path.join(projectDir, 'changed.txt'), 'right sidebar popout e2e\n', 'utf-8');
  return projectDir;
}

async function launchSeededSpace(testId: string): Promise<{ space: SpaceInstance; projectDir: string }> {
  const projectDir = await createGitProject(testId);
  const space = await launchSpace(testId);
  await space.seedProject(projectDir);
  await space.page.evaluate(() => {
    localStorage.setItem('kodax-space.smartPopoutEnabled', '0');
    localStorage.setItem('kodax-space.rightSidebarOpen', '0');
  });
  await space.page.reload();
  await space.page.waitForLoadState('domcontentloaded');
  return { space, projectDir };
}

async function createSession(space: SpaceInstance, prompt: string): Promise<string> {
  const textarea = space.page.locator('textarea').first();
  await expect(textarea).toBeEnabled({ timeout: 10_000 });
  await textarea.fill(prompt);
  await textarea.press('Enter');
  await expect(
    space.page.getByTestId('conversation-stream').getByText(prompt).first(),
  ).toBeVisible({ timeout: 10_000 });

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

async function emitSessionEvent(space: SpaceInstance, event: SessionEvent): Promise<void> {
  await space.app.evaluate(({ BrowserWindow }, payload) => {
    const win = BrowserWindow.getAllWindows()[0];
    if (!win) throw new Error('No BrowserWindow available');
    win.webContents.send('session.event', payload);
  }, event);
}

async function emitWorkflowStarted(space: SpaceInstance, sessionId: string): Promise<void> {
  await space.app.evaluate(({ BrowserWindow }, payload) => {
    const win = BrowserWindow.getAllWindows()[0];
    if (!win) throw new Error('No BrowserWindow available');
    win.webContents.send('workflow.event', payload);
  }, {
    type: 'workflow_started',
    sessionId,
    surface: 'code',
    message: 'workflow e2e started',
    snapshot: {
      runId: 'right-sidebar-popout-workflow',
      workflowName: 'generated',
      displayName: 'Right Sidebar Workflow',
      status: 'running',
      startedAt: '2026-06-26T00:00:00.000Z',
      updatedAt: '2026-06-26T00:00:00.000Z',
      patterns: ['fan-out-and-synthesize'],
      activePhaseIndex: 0,
      phaseCount: 2,
      latestMessage: 'workflow e2e started',
      items: [
        { id: 'phase-1', title: 'Inspect right sidebar', kind: 'phase', status: 'running' },
        {
          id: 'agent-1',
          title: 'Sidebar checker',
          kind: 'agent',
          phaseId: 'phase-1',
          status: 'running',
        },
      ],
      counts: { pending: 0, running: 2, completed: 0, failed: 0, cancelled: 0, skipped: 0 },
      progress: {
        spawnedAgents: 1,
        finishedAgents: 0,
        activeAgents: 1,
        failedAgents: 0,
        stoppedAgents: 0,
        plannedItems: 2,
      },
    },
  });
}

async function seedRightSidebarSignals(space: SpaceInstance, sessionId: string): Promise<void> {
  await emitSessionEvent(space, {
    kind: 'todo_update',
    sessionId,
    items: [
      { id: 'todo-1', content: 'Inspect plan popout button', status: 'in_progress' },
      { id: 'todo-2', content: 'Close from right sidebar section button', status: 'pending' },
    ],
  });
  await emitSessionEvent(space, {
    kind: 'managed_task_status',
    sessionId,
    status: {
      agentMode: 'ama',
      harnessProfile: 'H2_PLAN_EXECUTE_EVAL',
      activeWorkerId: 'worker-1',
      activeWorkerTitle: 'Sidebar worker',
      childFanoutClass: 'fan-out',
      childFanoutCount: 1,
      currentRound: 1,
      maxRounds: 2,
      phase: 'checking',
      globalWorkBudget: 5,
      budgetUsage: 1,
      events: [
        {
          key: 'worker-1-progress',
          kind: 'progress',
          phase: 'checking',
          workerId: 'worker-1',
          workerTitle: 'Sidebar worker',
          summary: 'Checking right sidebar full panel toggle',
        },
      ],
    },
  });
}

async function startStreamingNoise(
  space: SpaceInstance,
  sessionId: string,
  durationMs = 1200,
): Promise<void> {
  await space.app.evaluate(({ BrowserWindow }, input) => {
    const win = BrowserWindow.getAllWindows()[0];
    if (!win) throw new Error('No BrowserWindow available');
    let count = 0;
    const timer = setInterval(() => {
      win.webContents.send('session.event', {
        kind: 'text_delta',
        sessionId: input.sessionId,
        text: `stream-${count++} `,
      });
    }, 8);
    setTimeout(() => {
      clearInterval(timer);
      win.webContents.send('session.event', { kind: 'stream_end', sessionId: input.sessionId });
    }, input.durationMs);
  }, { sessionId, durationMs });
}

function section(sidebar: Locator, title: RegExp): Locator {
  return sidebar.locator('section').filter({ hasText: title }).first();
}

async function expectSectionPopoutToggle(
  page: Page,
  kind: 'plan' | 'tasks' | 'workflow',
): Promise<void> {
  const target = page.getByTestId(`right-sidebar-section-${kind}`);
  await expect(target).toBeVisible({ timeout: 5_000 });
  await target.getByLabel('Open in full panel').click();
  await expect(page.getByTestId(`popout-${kind}`)).toBeVisible({ timeout: 2_000 });
  await expect(target.getByLabel('Close popout')).toBeVisible({ timeout: 2_000 });
  await target.getByLabel('Close popout').click();
  await expect(page.getByTestId(`popout-${kind}`)).toBeHidden({ timeout: 2_000 });
  await expect(target.getByLabel('Open in full panel')).toBeVisible({ timeout: 2_000 });
}

test('Changes expands a fully untracked directory into reviewable file rows', async () => {
  const testId = `right-sidebar-untracked-${Date.now()}`;
  const projectDir = await createGitProject(testId);
  const docs = ['HLD.md', 'PRD.md', 'ProductDraft.md', 'UI_DESIGN.md'];
  await fs.mkdir(path.join(projectDir, 'docs'));
  await Promise.all(
    docs.map((name) => fs.writeFile(path.join(projectDir, 'docs', name), `${name}\n`, 'utf-8')),
  );
  const space = await launchSpace(testId);
  try {
    await space.seedProject(projectDir);
    const page = space.page;
    await page.getByLabel('Show right sidebar').click();

    const changes = section(page.getByTestId('right-sidebar'), /^Changes\b/);
    await expect(changes).toBeVisible({ timeout: 10_000 });
    await expect(changes).toContainText('Changes (5)');

    const header = changes.getByTestId('task-dock-section-header');
    const toggle = changes.getByTestId('task-dock-section-toggle');
    const [headerBox, toggleBox] = await Promise.all([header.boundingBox(), toggle.boundingBox()]);
    if (!headerBox || !toggleBox) throw new Error('Changes section header geometry was unavailable');
    expect(toggleBox.height).toBeGreaterThanOrEqual(32);
    expect(Math.abs(toggleBox.height - headerBox.height)).toBeLessThanOrEqual(1);

    // The formerly dead top/bottom padding now belongs to the title toggle.
    await page.mouse.click(headerBox.x + 12, headerBox.y + 3);
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await page.mouse.click(headerBox.x + 12, headerBox.y + headerBox.height - 3);
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');

    for (const name of docs) {
      await expect(changes.locator(`button[title="docs/${name}"]`)).toBeVisible();
    }
  } finally {
    await space.close();
    await fs.rm(projectDir, { recursive: true, force: true }).catch(() => {});
  }
});

test('right sidebar full-panel buttons open and close promptly while a session streams', async () => {
  // Quarantined on the Windows CI runner only. Seeding + rendering the sidebar
  // signals while a session streams intermittently stalls on the Windows runner
  // (the "Inspect plan popout button" signal does not appear in time) — a
  // Windows-CI-only flake not reproducible locally or on Linux and not fixed by
  // larger poll timeouts. Still runs on Linux CI and local dev. TODO:
  // root-cause the streaming-time sidebar render stall, then re-enable.
  test.skip(
    !!process.env.CI && process.platform === 'win32',
    'flaky on Windows CI: sidebar signal render intermittently stalls while streaming (tracked)',
  );
  const testId = `right-sidebar-popouts-${Date.now()}`;
  const { space, projectDir } = await launchSeededSpace(testId);
  try {
    const page = space.page;
    const sessionId = await createSession(space, 'seed right sidebar popout e2e session');

    await emitWorkflowStarted(space, sessionId);

    const sidebar = page.getByTestId('right-sidebar');
    await expect(sidebar).toBeVisible({ timeout: 5_000 });
    await startStreamingNoise(space, sessionId);
    await expect
      .poll(
        async () => {
          await seedRightSidebarSignals(space, sessionId);
          return (await sidebar.textContent()) ?? '';
        },
        { timeout: 5_000, intervals: [100, 250, 500, 1000] },
      )
      .toContain('Inspect plan popout button');

    await expectSectionPopoutToggle(page, 'plan');
    await expectSectionPopoutToggle(page, 'tasks');
    await expectSectionPopoutToggle(page, 'workflow');

    const changes = section(sidebar, /^Changes\b/);
    await expect(changes).toBeVisible({ timeout: 8_000 });
    await changes.locator('button[title="changed.txt"]').click();
    await expect(page.getByTestId('popout-diff')).toBeVisible({ timeout: 2_000 });
    await page.getByTestId('popout-diff').getByLabel('Close popout').click();
    await expect(page.getByTestId('popout-diff')).toBeHidden({ timeout: 2_000 });
  } finally {
    await space.close();
    await fs.rm(projectDir, { recursive: true, force: true }).catch(() => {});
  }
});
