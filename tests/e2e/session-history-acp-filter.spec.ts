import { test, expect } from '@playwright/test';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { createSessionManager } from '@kodax-ai/kodax/session';
import { launchSpace } from './fixtures.js';

const TEST_ID = `session-history-acp-filter-${Date.now()}`;

test('ACP fixtures cannot hide real history and show-all searches beyond the recent limit', async () => {
  test.setTimeout(120_000);
  const space = await launchSpace(TEST_ID);
  try {
    const projectDir = path.join(space.testDataDir, 'workspace');
    const secondaryProjectDir = path.join(space.testDataDir, 'secondary-workspace');
    await fs.mkdir(projectDir, { recursive: true });
    await fs.mkdir(secondaryProjectDir, { recursive: true });
    const manager = createSessionManager({ sessionsDir: path.join(space.testDataDir, 'sessions') });

    for (let index = 0; index < 3; index += 1) {
      await manager.storage.save(`secondary-${index}`, {
        messages: [{ role: 'user', content: `secondary prompt ${index}` }],
        title: `Secondary retained session ${index}`,
        gitRoot: secondaryProjectDir,
        scope: 'user',
        tag: 'code',
        runtimeInfo: {
          workspaceRoot: secondaryProjectDir,
          executionCwd: secondaryProjectDir,
          surface: 'code',
        },
      });
    }

    for (let index = 0; index < 205; index += 1) {
      await manager.storage.save(`code-${index}`, {
        messages: [{ role: 'user', content: `real prompt ${index}` }],
        title: index === 0 ? 'Oldest hidden session' : `Real session ${index}`,
        gitRoot: projectDir,
        scope: 'user',
        tag: 'code',
        runtimeInfo: {
          workspaceRoot: projectDir,
          executionCwd: projectDir,
          surface: 'code',
        },
      });
    }
    for (let index = 0; index < 540; index += 1) {
      await manager.storage.save(`acp-${index}`, {
        messages: [],
        title: 'ACP Session',
        gitRoot: projectDir,
        scope: 'user',
        runtimeInfo: {
          workspaceRoot: projectDir,
          executionCwd: projectDir,
          surface: 'acp',
        },
      });
    }

    await space.page.evaluate((projectPath) => {
      return window.kodaxSpace.invoke('project.recent.add', { path: projectPath });
    }, secondaryProjectDir);
    await space.seedProject(projectDir);
    const recent = await space.page.evaluate(async (projectRoot) => {
      return window.kodaxSpace.invoke('session.list', {
        projectRoot,
        surface: 'code',
      });
    }, projectDir);
    expect(recent.ok).toBe(true);
    if (!recent.ok) throw new Error(recent.error?.message ?? 'recent session.list failed');
    expect(recent.data.sessions).toHaveLength(200);
    expect(recent.data.sessions.some((session) => session.title === 'ACP Session')).toBe(false);
    expect(recent.data.sessions.some((session) => session.title === 'Oldest hidden session')).toBe(
      false,
    );

    const secondary = await space.page.evaluate(async (projectRoot) => {
      return window.kodaxSpace.invoke('session.list', {
        projectRoot,
        surface: 'code',
      });
    }, secondaryProjectDir);
    expect(secondary.ok).toBe(true);
    if (!secondary.ok) {
      throw new Error(secondary.error?.message ?? 'secondary session.list failed');
    }
    expect(secondary.data.sessions).toHaveLength(3);
    expect(
      secondary.data.sessions.every((session) => session.projectRoot === secondaryProjectDir),
    ).toBe(true);

    const secondaryProjectButton = space.page
      .getByTestId('left-sidebar')
      .getByRole('button', { name: 'secondary-workspace', exact: true });
    if ((await secondaryProjectButton.getAttribute('aria-expanded')) !== 'true') {
      await secondaryProjectButton.click();
    }
    await expect(
      space.page.getByText('Secondary retained session 2', { exact: true }),
    ).toBeVisible();

    for (let index = 0; index < 3; index += 1) {
      await space.page.getByRole('button', { name: 'Show more' }).click();
    }
    await space.page
      .getByRole('button', { name: /Browse all \d+ sessions in this project/i })
      .click();

    const dialog = space.page.getByRole('dialog', { name: /Sessions in/ });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText('205', { exact: true })).toBeVisible();
    await dialog
      .getByRole('textbox', { name: 'Session filter query' })
      .fill('Oldest hidden session');
    await expect(dialog.getByRole('button', { name: /Oldest hidden session/ })).toBeVisible();
    await expect(dialog.getByText('ACP Session', { exact: true })).toHaveCount(0);
  } finally {
    await space.close();
  }
});
