import { expect, test, type Page } from '@playwright/test';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { launchSpace, type SpaceInstance } from './fixtures.js';

const TEST_ID = `external-agent-reference-${Date.now()}`;

interface InvokeEnvelope<T> {
  readonly ok: boolean;
  readonly data: T;
  readonly error?: { readonly message: string };
}

interface RegistrationResult {
  readonly agentId: string;
  readonly configurationRevision: string;
}

interface TaskResult {
  readonly taskId: string;
  readonly state: string;
}

interface SessionCreateResult {
  readonly sessionId: string;
}

async function invoke<T>(page: Page, name: string, input: unknown): Promise<InvokeEnvelope<T>> {
  return page.evaluate(
    async ({ channel, payload }) =>
      (
        window as unknown as {
          kodaxSpace: { invoke: (channel: string, input: unknown) => Promise<unknown> };
        }
      ).kodaxSpace.invoke(channel, payload),
    { channel: name, payload: input },
  ) as Promise<InvokeEnvelope<T>>;
}

async function createProject(testId: string): Promise<string> {
  const projectDir = path.join(os.tmpdir(), `kodax-test-${testId}-project`);
  await fs.rm(projectDir, { recursive: true, force: true }).catch(() => {});
  await fs.mkdir(projectDir, { recursive: true });
  await fs.writeFile(path.join(projectDir, 'README.md'), '# External Agent e2e\n', 'utf8');
  return projectDir;
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
  const readSessionId = async () => {
    const result = await invoke<{ sessions: Array<{ sessionId: string }> }>(
      space.page,
      'session.list',
      { surface: 'code' },
    );
    return result.ok ? (result.data.sessions[0]?.sessionId ?? null) : null;
  };
  await expect.poll(readSessionId, { timeout: 20_000 }).not.toBeNull();
  const sessionId = await readSessionId();
  if (!sessionId) throw new Error('Session was not created');
  return sessionId;
}

test('Reference Agent management, localization, and Workflow picker are product-complete', async () => {
  test.setTimeout(75_000);
  const space = await launchSpace(`${TEST_ID}-settings`);
  try {
    const { page } = space;
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.getByTestId('settings-button').click();
    await page.locator('#settings-tab-runtime').click();

    await expect(page.getByRole('heading', { name: 'External agents' })).toBeVisible();
    const gates = page.getByTestId('external-agent-adapter-gates');
    await expect(gates).toContainText('Reference · available');
    await expect(gates).toContainText('A2A · hidden');
    await expect(gates).toContainText('MCP Tasks · hidden');
    await expect(gates).toContainText('Governed HTTP · hidden');

    await page.getByTestId('external-agent-add-button').click();
    await page.getByTestId('external-agent-name-input').fill('E2E Reference Reviewer');
    await page.getByTestId('external-agent-save-button').click();

    const card = page
      .getByTestId('external-agent-registration-card')
      .filter({ hasText: 'E2E Reference Reviewer' });
    await expect(card).toBeVisible();
    await expect(card).toContainText('no network');
    await expect(card).toContainText('no workspace writes');
    await card.getByRole('button', { name: 'Run preflight' }).click();
    await expect(card).toContainText('Preflight passed');

    await page.locator('#settings-tab-preferences').click();
    await page.getByRole('button', { name: '简体中文' }).click();
    await page.locator('#settings-tab-runtime').click();
    await expect(page.getByRole('heading', { name: '外部 Agent' })).toBeVisible();
    await expect(page.getByRole('button', { name: '运行合规任务' })).toBeVisible();

    await page.locator('#settings-tab-preferences').click();
    await page.getByRole('button', { name: 'English' }).click();
    await page.getByRole('button', { name: 'Close settings' }).click();

    await page.getByRole('button', { name: 'Open workflow panel' }).click();
    await page.getByText('Start workflow', { exact: true }).click();
    const picker = page.getByTestId('workflow-agent-target-picker');
    await expect(picker).toBeVisible();
    await expect(picker).toContainText('KodaX native child');
    await expect(picker).toContainText('E2E Reference Reviewer');
    await picker.getByTestId('workflow-external-agent-option').click();
    await expect(picker.getByTestId('workflow-external-agent-option')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  } finally {
    await space.close();
  }
});

test('Task Dock continues input-required tasks and preserves independent cancellation audit', async () => {
  test.setTimeout(90_000);
  const testId = `${TEST_ID}-task-dock`;
  const projectDir = await createProject(testId);
  const space = await launchSpace(testId);
  try {
    const { page } = space;
    await page.setViewportSize({ width: 1280, height: 800 });
    await space.seedProject(projectDir);
    const sessionId = await createSession(space, 'seed external task dock session');

    const registrationResult = await invoke<RegistrationResult>(
      page,
      'agent.external.reference.upsert',
      {
        displayName: 'Interactive Reference',
        description: 'E2E input-required executor',
        enabled: true,
        skills: ['interactive', 'conformance'],
        inputRequired: true,
      },
    );
    expect(registrationResult.ok).toBe(true);
    const registration = registrationResult.data;

    const started = await invoke<TaskResult>(page, 'agent.external.task.start', {
      sessionId,
      agentId: registration.agentId,
      objective: 'Approve this conformance result',
      readOnly: true,
      expectedConfigurationRevision: registration.configurationRevision,
    });
    expect(started.ok).toBe(true);
    expect(started.data.state).toBe('input-required');

    const secondSession = await invoke<SessionCreateResult>(page, 'session.create', {
      projectRoot: projectDir,
      provider: 'mock',
      surface: 'code',
    });
    expect(secondSession.ok).toBe(true);
    const crossSessionList = await invoke<{ tasks: TaskResult[] }>(
      page,
      'agent.external.task.list',
      { sessionId: secondSession.data.sessionId },
    );
    expect(crossSessionList.ok).toBe(true);
    expect(crossSessionList.data.tasks).toHaveLength(0);
    const crossSessionEvents = await invoke(page, 'agent.external.task.events', {
      sessionId: secondSession.data.sessionId,
      taskId: started.data.taskId,
      cursor: 0,
    });
    expect(crossSessionEvents.ok).toBe(false);

    await page.getByLabel('Show right sidebar').click();
    const taskCard = page
      .getByTestId('external-agent-task-card')
      .filter({ hasText: 'Approve this conformance result' });
    await expect(taskCard).toBeVisible({ timeout: 10_000 });
    await expect(taskCard).toContainText('Input required');
    await taskCard.getByPlaceholder('Reply to the external Agent…').fill('approved by e2e');
    await taskCard.getByRole('button', { name: 'Send input' }).click();
    await expect(taskCard).toContainText('Completed', { timeout: 10_000 });
    await taskCard.getByText('Show audit').click();
    await expect(taskCard.getByTestId('external-agent-task-details')).toContainText(
      'approved by e2e',
    );
    await expect(taskCard.getByLabel('External Agent task event log')).toContainText(
      'Input required',
    );
    await expect(taskCard.getByLabel('External Agent task event log')).toContainText('Completed');

    const cancelStarted = await invoke<TaskResult>(page, 'agent.external.task.start', {
      sessionId,
      agentId: registration.agentId,
      objective: 'Cancel this conformance result',
      readOnly: true,
      expectedConfigurationRevision: registration.configurationRevision,
    });
    expect(cancelStarted.ok).toBe(true);
    const cancelCard = page
      .getByTestId('external-agent-task-card')
      .filter({ hasText: 'Cancel this conformance result' });
    await expect(cancelCard).toBeVisible({ timeout: 10_000 });
    await cancelCard.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(cancelCard).toContainText('Canceled', { timeout: 10_000 });
    await expect(cancelCard).toContainText('Cancellation: confirmed');
  } finally {
    await space.close();
    await fs.rm(projectDir, { recursive: true, force: true }).catch(() => {});
  }
});
