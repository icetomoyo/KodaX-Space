import { expect, test, type Page } from '@playwright/test';
import { execFile } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { promisify } from 'node:util';
import { launchSpace, type SpaceInstance } from './fixtures.js';
import type { SessionEvent } from '@kodax-space/space-ipc-schema';

const execFileAsync = promisify(execFile);

interface SessionListEnvelope {
  ok: boolean;
  data?: { sessions?: Array<{ sessionId: string; projectRoot?: string }> };
}

async function createGitProject(testId: string): Promise<string> {
  const projectDir = path.join(os.tmpdir(), `kodax-test-${testId}-project`);
  await fs.rm(projectDir, { recursive: true, force: true }).catch(() => {});
  await fs.mkdir(projectDir, { recursive: true });
  await execFileAsync('git', ['init'], { cwd: projectDir });
  await fs.writeFile(path.join(projectDir, 'changed.txt'), 'environment hub e2e\n', 'utf-8');
  return projectDir;
}

async function createPlainProject(testId: string): Promise<string> {
  const projectDir = path.join(os.tmpdir(), `kodax-test-${testId}-project`);
  await fs.rm(projectDir, { recursive: true, force: true }).catch(() => {});
  await fs.mkdir(projectDir, { recursive: true });
  await fs.writeFile(path.join(projectDir, 'notes.txt'), 'plain project\n', 'utf-8');
  return projectDir;
}

async function launchSeeded(testId: string): Promise<{ space: SpaceInstance; projectDir: string }> {
  const projectDir = await createGitProject(testId);
  const space = await launchSpace(testId);
  await space.page.setViewportSize({ width: 1280, height: 760 });
  await space.seedProject(projectDir);
  await space.page.evaluate(() => {
    localStorage.setItem('kodax-space.rightSidebarOpen', '0');
    localStorage.setItem('kodax-space.smartPopoutEnabled', '1');
  });
  await space.page.reload();
  await space.page.waitForLoadState('domcontentloaded');
  return { space, projectDir };
}

async function launchPlainSeeded(
  testId: string,
): Promise<{ space: SpaceInstance; projectDir: string }> {
  const projectDir = await createPlainProject(testId);
  const space = await launchSpace(testId);
  await space.page.setViewportSize({ width: 1280, height: 760 });
  await space.seedProject(projectDir);
  await space.page.evaluate(() => {
    localStorage.setItem('kodax-space.rightSidebarOpen', '0');
    localStorage.setItem('kodax-space.smartPopoutEnabled', '1');
  });
  await space.page.reload();
  await space.page.waitForLoadState('domcontentloaded');
  return { space, projectDir };
}

async function openHub(page: Page): Promise<void> {
  await page.getByTestId('environment-hub-button').click();
  await expect(page.getByTestId('environment-hub-popover')).toBeVisible({ timeout: 5_000 });
}

async function createSession(space: SpaceInstance, prompt: string): Promise<string> {
  const textarea = space.page.locator('textarea').first();
  await expect(textarea).toBeEnabled({ timeout: 10_000 });
  await textarea.fill(prompt);
  await textarea.press('Enter');
  await expect(space.page.getByTestId('conversation-stream').getByText(prompt).first()).toBeVisible(
    {
      timeout: 10_000,
    },
  );

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

test('Task Dock stays closed on startup even with a stale open preference', async () => {
  const testId = `task-dock-start-closed-${Date.now()}`;
  const projectDir = await createGitProject(testId);
  const space = await launchSpace(testId);

  try {
    const { page } = space;
    await page.setViewportSize({ width: 1280, height: 760 });
    await space.seedProject(projectDir);
    await page.evaluate(() => {
      localStorage.setItem('kodax-space.rightSidebarOpen', '1');
      localStorage.setItem('kodax-space.smartPopoutEnabled', '1');
    });
    await page.reload();
    await page.waitForLoadState('domcontentloaded');

    await expect(page.getByTestId('pinned-task-summary')).toBeVisible({ timeout: 5_000 });
    await expect(page.getByTestId('right-sidebar')).toHaveCount(0);

    await openHub(page);
    await page.getByTestId('environment-hub-changes-row').click();
    await expect(page.getByTestId('right-sidebar')).toBeVisible({ timeout: 5_000 });
  } finally {
    await space.close();
    await fs.rm(projectDir, { recursive: true, force: true }).catch(() => {});
  }
});

test('Environment Hub routes anchored menus and changes into Task Dock and Review workspace', async () => {
  const testId = `environment-hub-${Date.now()}`;
  const { space, projectDir } = await launchSeeded(testId);

  try {
    const { page } = space;

    await openHub(page);
    await expect(page.getByTestId('environment-hub-sources-row')).toContainText('workspace');
    await expect(page.getByTestId('environment-hub-sources-row')).not.toContainText('attached');
    await expect(page.getByTestId('environment-hub-popover')).toHaveAttribute(
      'data-surface-kind',
      'anchored_menu',
    );
    await page.getByTestId('environment-hub-location-row').click();
    await expect(page.getByTestId('environment-hub-location-menu')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('environment-hub-popover')).toBeHidden();

    await openHub(page);
    await page.getByLabel('Add source').click();
    await expect(page.getByTestId('environment-hub-sources-menu')).toBeVisible();
    await page.getByText('Open sources in Task Dock').click();
    const sources = page.locator('[data-task-dock-section="sources"]');
    await expect(sources).toBeVisible({ timeout: 5_000 });
    await expect(sources).toContainText(path.basename(projectDir), { timeout: 5_000 });

    await openHub(page);
    await page.getByTestId('environment-hub-branch-row').click();
    await expect(page.getByTestId('environment-hub-branch-menu')).toBeVisible();
    await page.getByTestId('environment-hub-sources-row').click();
    await expect(page.getByTestId('environment-hub-sources-menu')).toBeVisible();
    await page.getByTestId('environment-hub-commit-row').click();
    await expect(page.getByTestId('environment-hub-commit-menu')).toBeVisible();
    await expect(page.getByTestId('environment-hub-commit-menu')).toContainText(
      'Commit and push actions are not wired yet',
    );
    await page.getByText('Review changes in Task Dock').click();
    await expect(page.locator('[data-task-dock-section="changes"]')).toBeVisible({
      timeout: 5_000,
    });

    await openHub(page);
    await page.getByTestId('environment-hub-changes-row').click();
    const sidebar = page.getByTestId('right-sidebar');
    await expect(sidebar).toBeVisible({ timeout: 5_000 });

    const changes = page.locator('[data-task-dock-section="changes"]');
    await expect(changes).toBeVisible({ timeout: 5_000 });
    await expect(changes).toContainText('changed.txt', { timeout: 10_000 });

    await changes.getByTestId('task-dock-change-file').filter({ hasText: 'changed.txt' }).click();
    const review = page.getByTestId('popout-diff');
    await expect(review).toBeVisible({ timeout: 5_000 });
    await expect(review).toHaveAttribute('data-surface-kind', 'review_workspace');
  } finally {
    await space.close();
    await fs.rm(projectDir, { recursive: true, force: true }).catch(() => {});
  }
});

test('Environment Hub explains Changes when the project is not a git repository', async () => {
  const testId = `environment-hub-no-git-${Date.now()}`;
  const { space, projectDir } = await launchPlainSeeded(testId);

  try {
    const { page } = space;

    await openHub(page);
    await page.getByTestId('environment-hub-changes-row').click();

    await expect(page.getByTestId('right-sidebar')).toBeVisible({ timeout: 5_000 });
    const changes = page.locator('[data-task-dock-section="changes"]');
    await expect(changes).toBeVisible({ timeout: 5_000 });
    await expect(changes).toContainText('This project is not a git repository.', {
      timeout: 5_000,
    });
  } finally {
    await space.close();
    await fs.rm(projectDir, { recursive: true, force: true }).catch(() => {});
  }
});

test('Smart Popout signals focus Task Dock instead of opening a plan popout', async () => {
  const testId = `task-dock-smart-focus-${Date.now()}`;
  const { space, projectDir } = await launchSeeded(testId);

  try {
    const { page } = space;
    const sessionId = await createSession(space, 'seed task dock smart focus');

    await emitSessionEvent(space, {
      kind: 'todo_update',
      sessionId,
      items: [
        {
          id: 'todo-smart-focus',
          content: 'Plan should focus the Task Dock',
          status: 'in_progress',
        },
      ],
    });

    const summary = page.getByTestId('pinned-task-summary');
    await expect(summary).toBeVisible({ timeout: 5_000 });
    await expect(summary).toContainText('Plan in progress');
    const planChip = page.getByTestId('pinned-summary-plan');
    await expect(planChip).toHaveText(/Plan\s*0\/1/);

    await expect(page.getByTestId('right-sidebar')).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('[data-task-dock-section="plan"]')).toContainText(
      'Plan should focus the Task Dock',
      { timeout: 5_000 },
    );
    await page
      .getByTestId('right-sidebar')
      .getByRole('button', { name: 'Hide right sidebar' })
      .click();
    await expect(page.getByTestId('right-sidebar')).toHaveCount(0);
    await planChip.click();
    await expect(page.getByTestId('right-sidebar')).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('[data-task-dock-section="plan"]')).toContainText(
      'Plan should focus the Task Dock',
      { timeout: 5_000 },
    );
    await expect(page.getByTestId('popout-plan')).toHaveCount(0);
  } finally {
    await space.close();
    await fs.rm(projectDir, { recursive: true, force: true }).catch(() => {});
  }
});

test('Task Dock presents semantic agent status and opens the full Agents panel', async () => {
  const testId = `task-dock-agents-${Date.now()}`;
  const { space, projectDir } = await launchSeeded(testId);

  try {
    const { page } = space;
    const sessionId = await createSession(space, 'seed task dock agent status');

    await emitSessionEvent(space, {
      kind: 'managed_task_status',
      sessionId,
      status: {
        agentMode: 'ama',
        harnessProfile: 'H2_PLAN_EXECUTE_EVAL',
        activeWorkerId: 'research-1',
        activeWorkerTitle: 'Research agent',
        childFanoutClass: 'source review',
        childFanoutCount: 1,
        currentRound: 1,
        maxRounds: 2,
        phase: 'source_review',
        globalWorkBudget: 6,
        budgetUsage: 2,
        events: [
          {
            key: 'research-1-progress',
            kind: 'progress',
            phase: 'source_review',
            workerId: 'research-1',
            workerTitle: 'Research agent',
            summary: 'Confirmed changes should route to Review workspace',
          },
        ],
      },
    });

    const summary = page.getByTestId('pinned-task-summary');
    await expect(summary).toBeVisible({ timeout: 5_000 });
    await expect(summary).toContainText('Research agent is working');
    const agentsChip = page.getByTestId('pinned-summary-agents');
    await expect(agentsChip).toHaveText(/Agents\s*1/);
    await agentsChip.click();

    await expect(page.getByTestId('right-sidebar')).toBeVisible({ timeout: 5_000 });
    const agentsSection = page.locator('[data-task-dock-section="agents"]');
    await expect(agentsSection).toBeVisible({ timeout: 5_000 });

    const card = agentsSection.getByTestId('task-dock-agent-card').first();
    await expect(card).toContainText('Research agent', { timeout: 5_000 });
    await expect(card).toContainText('Running');
    await expect(card).toContainText('Source review');
    await expect(card).toContainText('Confirmed changes should route to Review workspace');
    await expect(card).toContainText('1 trace events');

    await agentsSection.getByLabel('Open in full panel').click();
    const fullPanel = page.getByTestId('popout-tasks');
    await expect(fullPanel).toBeVisible({ timeout: 5_000 });
    await expect(fullPanel).toHaveAttribute('data-surface-kind', 'dock_sheet');
    await expect(fullPanel.getByTestId('task-panel-agent-card')).toContainText('Research agent');
    await expect(fullPanel.getByTestId('task-panel-agent-card')).toContainText(
      'Confirmed changes should route to Review workspace',
    );
  } finally {
    await space.close();
    await fs.rm(projectDir, { recursive: true, force: true }).catch(() => {});
  }
});
