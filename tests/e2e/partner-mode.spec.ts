// Partner mode e2e coverage.
//
// These tests intentionally mirror Coder's core "normal use" path while staying
// on the Partner surface: create by first send, receive a mock assistant turn,
// use slash/mode controls, switch surfaces, resume after reload, manage sources,
// and recover the composer after deleting the current Partner session.
import { test, expect, type Page } from '@playwright/test';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { launchSpace } from './fixtures.js';

type Surface = 'code' | 'partner';

interface SessionListEnvelope {
  ok: boolean;
  data?: { sessions?: Array<{ sessionId: string; title?: string; surface?: Surface }> };
  error?: { message?: string };
}

interface SourceListEnvelope {
  ok: boolean;
  data?: { sources?: Array<{ id: string; label?: string; path: string }> };
  error?: { message?: string };
}

interface PartnerWorkbenchContextSnapshot {
  readonly scenarioId?: string;
  readonly outputPreferenceId?: string;
  readonly sources?: Array<{ id: string; label?: string | null; path: string }>;
  readonly pendingSources?: Array<{ label?: string | null; path: string }>;
}

function sha256(content: string | Buffer): string {
  return `sha256:${createHash('sha256').update(content).digest('hex')}`;
}

function shortHash(hash: string): string {
  return hash.replace(/^sha256:/, '').slice(0, 12);
}

async function createProject(testId: string): Promise<string> {
  const projectDir = path.join(os.tmpdir(), `kodax-test-${testId}-project`);
  await fs.mkdir(projectDir, { recursive: true });
  await fs.writeFile(
    path.join(projectDir, 'brief.md'),
    '# Partner brief\n\nUse this file as evidence for the Partner e2e flow.\n',
    'utf-8',
  );
  return projectDir;
}

async function switchSurface(page: Page, surface: 'Coder' | 'Partner'): Promise<void> {
  await page.getByRole('button', { name: surface, exact: true }).click();
}

async function readSessions(
  page: Page,
  projectRoot: string,
  surface: Surface,
): Promise<Array<{ sessionId: string; title?: string; surface?: Surface }>> {
  return page.evaluate(
    async ({ projectRoot: root, surface: targetSurface }) => {
      const bridge = (
        window as unknown as {
          kodaxSpace: { invoke: (name: string, input: unknown) => Promise<SessionListEnvelope> };
        }
      ).kodaxSpace;
      const result = await bridge.invoke('session.list', {
        projectRoot: root,
        surface: targetSurface,
      });
      if (!result.ok) throw new Error(result.error?.message ?? 'session.list failed');
      return result.data?.sessions ?? [];
    },
    { projectRoot, surface },
  );
}

async function onlySessionId(page: Page, projectRoot: string, surface: Surface): Promise<string> {
  const sessions = await readSessions(page, projectRoot, surface);
  expect(sessions, `${surface} session count`).toHaveLength(1);
  expect(sessions[0].surface ?? 'code').toBe(surface);
  return sessions[0].sessionId;
}

async function readPartnerSources(
  page: Page,
  sessionId: string,
  projectRoot: string,
): Promise<SourceListEnvelope['data']['sources']> {
  return page.evaluate(
    async ({ sid, root }) => {
      const bridge = (
        window as unknown as {
          kodaxSpace: { invoke: (name: string, input: unknown) => Promise<SourceListEnvelope> };
        }
      ).kodaxSpace;
      const result = await bridge.invoke('partner.sources.list', {
        sessionId: sid,
        projectRoot: root,
      });
      if (!result.ok) throw new Error(result.error?.message ?? 'partner.sources.list failed');
      return result.data?.sources ?? [];
    },
    { sid: sessionId, root: projectRoot },
  );
}

async function readPartnerWorkbenchContext(
  page: Page,
): Promise<PartnerWorkbenchContextSnapshot | null> {
  return page.evaluate(() => {
    const context = (
      window as unknown as {
        __kodaxPartnerWorkbenchContext?: PartnerWorkbenchContextSnapshot;
      }
    ).__kodaxPartnerWorkbenchContext;
    return context ?? null;
  });
}

async function sendPartnerPrompt(page: Page, prompt: string): Promise<void> {
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

async function seedPartnerDeliveries(options: {
  readonly testDataDir: string;
  readonly projectDir: string;
  readonly sessionId: string;
}): Promise<void> {
  const spaceDir = path.join(options.testDataDir, 'space');
  const now = Date.now();

  const beforeContent = 'before checkpoint content\n';
  const afterContent = 'after checkpoint content\n';
  const targetRelativePath = 'src/partner-note.txt';
  const targetPath = path.join(options.projectDir, ...targetRelativePath.split('/'));
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, afterContent, 'utf-8');

  const checkpointDir = path.join(spaceDir, 'partner-checkpoints', 'pc-e2e');
  const beforeSnapshotPath = path.join(checkpointDir, 'before.bin');
  await fs.mkdir(checkpointDir, { recursive: true });
  await fs.writeFile(beforeSnapshotPath, beforeContent, 'utf-8');

  const runRelativePath = 'reports/custom.weird';
  const runContent = Buffer.from([0x4b, 0x44, 0x58, 0x2d, 0x77, 0x65, 0x69, 0x72, 0x64]);
  const runRootPath = path.join(spaceDir, 'partner-runs', options.sessionId);
  const runPath = path.join(runRootPath, ...runRelativePath.split('/'));
  await fs.mkdir(path.dirname(runPath), { recursive: true });
  await fs.writeFile(runPath, runContent);

  const markdownRelativePath = 'reports/partner-preview.md';
  const markdownContent = [
    '# Partner preview',
    '',
    'This delivery should read like a rendered document, not editable source.',
    '',
    '| State | Surface |',
    '| --- | --- |',
    '| Read only | Artifact preview |',
    '',
  ].join('\n');
  const markdownPath = path.join(runRootPath, ...markdownRelativePath.split('/'));
  await fs.writeFile(markdownPath, markdownContent, 'utf-8');

  const workspaceDelivery = {
    id: 'pd-workspace-e2e',
    sessionId: options.sessionId,
    projectRoot: options.projectDir,
    rootKind: 'workspace-session',
    rootPath: options.projectDir,
    absolutePath: targetPath,
    relativePath: targetRelativePath,
    kind: 'file',
    title: 'partner-note.txt',
    mime: 'text/plain',
    extension: '.txt',
    sizeBytes: Buffer.byteLength(afterContent),
    contentHash: sha256(afterContent),
    sourceRefs: ['brief.md'],
    producer: 'write_partner_workspace_file',
    checkpointId: 'pc-e2e',
    createdAt: now,
    updatedAt: now,
  };
  const arbitraryDelivery = {
    id: 'pd-run-e2e',
    sessionId: options.sessionId,
    projectRoot: options.projectDir,
    rootKind: 'run-output',
    rootPath: runRootPath,
    absolutePath: runPath,
    relativePath: runRelativePath,
    kind: 'file',
    title: 'custom.weird',
    mime: 'application/octet-stream',
    extension: '.weird',
    sizeBytes: runContent.byteLength,
    contentHash: sha256(runContent),
    sourceRefs: [],
    producer: 'write_partner_deliverable',
    createdAt: now + 1,
    updatedAt: now + 1,
  };
  const markdownDelivery = {
    id: 'pd-markdown-e2e',
    sessionId: options.sessionId,
    projectRoot: options.projectDir,
    rootKind: 'run-output',
    rootPath: runRootPath,
    absolutePath: markdownPath,
    relativePath: markdownRelativePath,
    kind: 'file',
    title: 'partner-preview.md',
    mime: 'text/markdown',
    extension: '.md',
    sizeBytes: Buffer.byteLength(markdownContent),
    contentHash: sha256(markdownContent),
    sourceRefs: ['brief.md'],
    producer: 'write_partner_deliverable',
    createdAt: now + 2,
    updatedAt: now + 2,
  };
  const checkpoint = {
    id: 'pc-e2e',
    sessionId: options.sessionId,
    projectRoot: options.projectDir,
    rootPath: options.projectDir,
    absolutePath: targetPath,
    relativePath: targetRelativePath,
    operation: 'update',
    status: 'active',
    beforeHash: sha256(beforeContent),
    beforeSizeBytes: Buffer.byteLength(beforeContent),
    beforeSnapshotPath,
    afterHash: sha256(afterContent),
    afterSizeBytes: Buffer.byteLength(afterContent),
    deliveryId: workspaceDelivery.id,
    producer: 'write_partner_workspace_file',
    diff: {
      before: beforeContent,
      after: afterContent,
      unified: [
        '--- a/src/partner-note.txt',
        '+++ b/src/partner-note.txt',
        '@@ partner checkpoint @@',
        '-before checkpoint content',
        '+after checkpoint content',
      ].join('\n'),
      truncated: false,
    },
    createdAt: now,
    updatedAt: now,
  };

  await fs.writeFile(
    path.join(spaceDir, 'partner-deliveries.json'),
    JSON.stringify(
      { version: 1, deliveries: [workspaceDelivery, arbitraryDelivery, markdownDelivery] },
      null,
      2,
    ),
    'utf-8',
  );
  await fs.writeFile(
    path.join(spaceDir, 'partner-checkpoints.json'),
    JSON.stringify({ version: 1, checkpoints: [checkpoint] }, null, 2),
    'utf-8',
  );
}

test('Partner shares Coder sidebar chrome, width controls, max-mode close, and Files access', async () => {
  test.setTimeout(60_000); // Electron boot + window resize settle is slow on Windows CI
  const testId = `partner-artifact-rail-${Date.now()}`;
  const projectDir = await createProject(testId);
  const space = await launchSpace(testId);

  try {
    const { page } = space;
    await space.seedProject(projectDir);
    await switchSurface(page, 'Partner');
    await expect(page.getByTestId('partner-workspace')).toBeVisible({ timeout: 10_000 });
    // The Partner artifact panel auto-hides when the workspace is narrower than
    // ~900px. Linux CI runs under a 1280-wide xvfb screen, but the headless
    // Windows runner can clamp the launch window narrower, hiding the panel and
    // stalling this assertion. Force a wide window so the rail shows
    // deterministically on every runner, then allow the ResizeObserver to settle.
    await space.app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.setSize(1440, 880);
    });
    await expect(page.getByTestId('partner-artifact-panel')).toBeVisible({ timeout: 15_000 });

    const sidebar = page.getByTestId('right-sidebar');
    const workspace = page.getByTestId('partner-workspace');
    await expect(sidebar).toBeVisible();

    await page.getByLabel('Half width').click();
    await expect
      .poll(async () => {
        const sidebarBox = await sidebar.boundingBox();
        const workspaceBox = await workspace.boundingBox();
        return Math.abs((sidebarBox?.width ?? 0) - (workspaceBox?.width ?? 0));
      })
      .toBeLessThanOrEqual(2);

    await page.getByLabel('Max width').click();
    await expect(workspace).toBeHidden();
    await expect(page.getByTestId('partner-artifact-panel-close')).toBeVisible();
    await page.getByTestId('partner-artifact-panel-close').click();
    await expect(sidebar).toHaveCount(0);
    await expect(workspace).toBeVisible();

    const artifactToggle = page.getByTestId('partner-artifact-toggle');
    await expect(artifactToggle).toHaveAttribute('aria-pressed', 'false');

    await expect(page.getByTestId('partner-artifact-edge-toggle')).toHaveCount(0);
    await artifactToggle.click();
    await expect(page.getByTestId('partner-artifact-panel')).toBeVisible();
    await expect(artifactToggle).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByLabel('Default width')).toHaveAttribute('aria-pressed', 'true');

    await page
      .getByTestId('left-sidebar')
      .getByRole('button', { name: 'Files', exact: true })
      .click();
    await expect(page.getByTestId('files-panel')).toBeVisible();
    await expect(page.getByTestId('files-panel').getByText('brief.md').first()).toBeVisible();
  } finally {
    await space.close();
    await fs.rm(projectDir, { recursive: true, force: true }).catch(() => {});
  }
});

test('Partner supports normal composer use, slash clear, mode shortcut, and resume', async () => {
  test.setTimeout(90_000);
  const testId = `partner-parity-${Date.now()}`;
  const projectDir = await createProject(testId);
  const space = await launchSpace(testId);

  try {
    const { page } = space;
    await space.seedProject(projectDir);

    await switchSurface(page, 'Partner');
    await space.app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.setSize(1440, 880);
    });
    await expect(page.getByTestId('partner-workspace')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('partner-sources-panel')).toBeVisible();
    await expect(page.getByTestId('partner-artifact-panel')).toBeVisible();

    const sourcesToggle = page.getByTestId('partner-sources-toggle');
    await expect(sourcesToggle).toHaveAttribute('aria-pressed', 'true');
    await sourcesToggle.click();
    await expect(page.getByTestId('partner-sources-panel')).toHaveCount(0);
    await expect(page.getByTestId('partner-conversation')).toBeVisible();
    await expect(page.getByTestId('partner-artifact-panel')).toBeVisible();

    await page.reload();
    await page.waitForLoadState('domcontentloaded');
    await expect(page.getByTestId('partner-workspace')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('partner-sources-toggle')).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    await page.getByTestId('partner-sources-toggle').click();
    await expect(page.getByTestId('partner-sources-panel')).toBeVisible();

    const artifactToggle = page.getByTestId('partner-artifact-toggle');
    await expect(artifactToggle).toHaveAttribute('aria-pressed', 'true');
    await page.getByTestId('partner-artifact-panel-close').click();
    await expect(page.getByTestId('partner-artifact-panel')).toHaveCount(0);
    await expect(artifactToggle).toHaveAttribute('aria-pressed', 'false');
    await expect(page.getByTestId('partner-artifact-edge-toggle')).toHaveCount(0);
    await artifactToggle.click();
    await expect(page.getByTestId('partner-artifact-panel')).toBeVisible();

    const modeLabel = /^(Plan|Accept edits|Auto)/;
    await expect(page.getByText(modeLabel).first()).toBeVisible({ timeout: 10_000 });
    const initialMode = await page.getByText(modeLabel).first().textContent();
    await page.keyboard.press('Shift+Tab');
    await expect
      .poll(async () => (await page.getByText(modeLabel).first().textContent()) ?? '', {
        timeout: 5_000,
      })
      .not.toBe(initialMode);

    const prompt = 'partner e2e normal use check';
    await sendPartnerPrompt(page, prompt);
    await expect
      .poll(() => readSessions(page, projectDir, 'partner'), { timeout: 10_000 })
      .toHaveLength(1);
    await expect(await readSessions(page, projectDir, 'code')).toHaveLength(0);

    const partnerRow = page.getByTestId('sidebar-session-row').filter({ hasText: prompt }).first();
    await expect(partnerRow).toBeVisible({ timeout: 10_000 });

    await switchSurface(page, 'Coder');
    await expect(page.getByTestId('partner-workspace')).toHaveCount(0);
    await expect(page.getByTestId('sidebar-session-row').filter({ hasText: prompt })).toHaveCount(
      0,
    );

    await switchSurface(page, 'Partner');
    await expect(page.getByTestId('partner-workspace')).toBeVisible();
    await expect(
      page.getByTestId('sidebar-session-row').filter({ hasText: prompt }).first(),
    ).toBeVisible();

    await page.reload();
    await page.waitForLoadState('domcontentloaded');
    await expect(page.getByTestId('partner-workspace')).toBeVisible({ timeout: 10_000 });
    const reloadedRow = page.getByTestId('sidebar-session-row').filter({ hasText: prompt }).first();
    await expect(reloadedRow).toBeVisible({ timeout: 10_000 });
    await reloadedRow.click();
    const followUp = 'partner e2e resume follow up';
    await sendPartnerPrompt(page, followUp);
    await expect(await readSessions(page, projectDir, 'partner')).toHaveLength(1);

    const textarea = page.locator('textarea').first();
    await textarea.fill('/clear');
    await page.getByLabel('Send message').click();
    await expect(
      page.getByTestId('conversation-stream').getByText(followUp).first(),
    ).not.toBeVisible({
      timeout: 5_000,
    });
    await expect(textarea).toBeEnabled();
  } finally {
    await space.close();
    await fs.rm(projectDir, { recursive: true, force: true }).catch(() => {});
  }
});

test('Partner outputs show arbitrary deliveries and rollback checkpointed workspace writes', async () => {
  test.setTimeout(90_000);

  const testId = `partner-deliveries-${Date.now()}`;
  const projectDir = await createProject(testId);
  const space = await launchSpace(testId);

  try {
    const { page } = space;
    await space.seedProject(projectDir);
    await switchSurface(page, 'Partner');
    await space.app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.setSize(1440, 880);
    });
    await expect(page.getByTestId('partner-workspace')).toBeVisible({ timeout: 10_000 });

    const prompt = 'partner e2e deliveries and rollback check';
    await sendPartnerPrompt(page, prompt);
    const sessionId = await onlySessionId(page, projectDir, 'partner');
    await seedPartnerDeliveries({ testDataDir: space.testDataDir, projectDir, sessionId });

    await page.getByTestId('partner-deliveries-tab').click();
    const panel = page.getByTestId('partner-deliveries-panel');
    await expect(panel).toBeVisible({ timeout: 10_000 });
    await expect(panel.getByText('src/partner-note.txt').first()).toBeVisible();
    await expect(panel.getByText('reports/custom.weird').first()).toBeVisible();
    await expect(panel.getByText('reports/partner-preview.md').first()).toBeVisible();
    await expect(panel.getByText('application/octet-stream').first()).toBeVisible();

    await panel.getByRole('button', { name: 'Checkpoints' }).click();
    await expect(panel.getByText('pc-e2e').first()).toBeVisible();
    await expect(panel.getByText('src/partner-note.txt').first()).toBeVisible();
    await expect(panel.getByText('after checkpoint content').first()).toBeVisible();

    await panel.getByRole('button', { name: 'Rollback' }).click();
    await expect(panel.getByText('Rolled back').first()).toBeVisible({ timeout: 10_000 });
    await expect
      .poll(() => fs.readFile(path.join(projectDir, 'src', 'partner-note.txt'), 'utf-8'), {
        timeout: 10_000,
      })
      .toBe('before checkpoint content\n');

    await panel.getByRole('button', { name: 'Outputs', exact: true }).click();
    await panel.locator('button', { hasText: 'src/partner-note.txt' }).first().click();
    await expect(
      panel.getByText(shortHash(sha256('before checkpoint content\n'))).first(),
    ).toBeVisible();
    await expect(panel.getByTestId('rich-preview')).toBeVisible();
    await expect(panel.getByTestId('text-file-viewer')).toBeVisible();
    await expect(panel.getByLabel('Copy path')).toBeVisible();
    await expect(panel.getByLabel('Reveal in file manager')).toBeVisible();

    await panel.locator('button', { hasText: 'reports/partner-preview.md' }).first().click();
    await expect(panel.getByTestId('markdown-file-preview')).toBeVisible();
    await expect(panel.getByTestId('markdown-artifact-preview')).toBeVisible();
    await expect(panel.getByTestId('text-file-viewer')).not.toBeVisible();
    await panel.getByLabel('Open as Artifact').click();
    await expect(page.getByTestId('artifacts-view')).toBeVisible();
    await expect(page.getByTestId('artifact-preview-title')).toContainText('partner-preview.md');
    await expect(page.getByTestId('markdown-file-preview')).toBeVisible();
    await expect(page.getByTestId('markdown-artifact-preview')).toBeVisible();
  } finally {
    await space.close();
    await fs.rm(projectDir, { recursive: true, force: true }).catch(() => {});
  }
});

test('Partner sources can be attached and removed, and deleting the session recovers composer', async () => {
  const testId = `partner-sources-delete-${Date.now()}`;
  const projectDir = await createProject(testId);
  const space = await launchSpace(testId);

  try {
    const { page } = space;
    await space.seedProject(projectDir);
    await switchSurface(page, 'Partner');

    const prompt = 'partner e2e source management check';
    await sendPartnerPrompt(page, prompt);
    const sessionId = await onlySessionId(page, projectDir, 'partner');

    const sourcesPanel = page.getByTestId('partner-sources-panel');
    await sourcesPanel.getByRole('button', { name: 'brief.md' }).click();
    await sourcesPanel.getByRole('button', { name: 'Attach selected file' }).click();
    await expect
      .poll(() => readPartnerSources(page, sessionId, projectDir), { timeout: 10_000 })
      .toHaveLength(1);
    await expect(sourcesPanel.getByText('brief.md').first()).toBeVisible();
    await expect
      .poll(async () => (await readPartnerWorkbenchContext(page))?.sources?.length ?? -1, {
        timeout: 10_000,
      })
      .toBe(1);
    const contextAfterAttach = await readPartnerWorkbenchContext(page);
    expect(contextAfterAttach?.sources?.[0]?.path.replace(/\\/g, '/')).toMatch(/(^|\/)brief\.md$/);

    await sourcesPanel.locator('button[title="Remove source"]').click();
    await expect
      .poll(() => readPartnerSources(page, sessionId, projectDir), { timeout: 10_000 })
      .toHaveLength(0);
    await expect(sourcesPanel.getByText('No sources attached')).toBeVisible();
    await expect
      .poll(async () => (await readPartnerWorkbenchContext(page))?.sources?.length ?? -1, {
        timeout: 10_000,
      })
      .toBe(0);

    const row = page.getByTestId('sidebar-session-row').filter({ hasText: prompt }).first();
    await expect(row).toBeVisible();
    await row.click({ button: 'right' });
    await page.getByRole('menuitem', { name: /^Delete\b/ }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click();

    await expect(page.getByTestId('sidebar-session-row').filter({ hasText: prompt })).toHaveCount(
      0,
      {
        timeout: 10_000,
      },
    );
    const composer = page.locator('textarea').first();
    await expect(composer).toHaveAttribute(
      'placeholder',
      /Document processing task - sending will create a Partner session/,
    );
    await expect(composer).toBeEnabled();
    await composer.fill('typing after partner delete still works');
    await expect(composer).toHaveValue('typing after partner delete still works');
  } finally {
    await space.close();
    await fs.rm(projectDir, { recursive: true, force: true }).catch(() => {});
  }
});

test('Partner can stage sources before the first composer send creates the session', async () => {
  const testId = `partner-staged-sources-${Date.now()}`;
  const projectDir = await createProject(testId);
  const space = await launchSpace(testId);

  try {
    const { page } = space;
    await space.seedProject(projectDir);
    await switchSurface(page, 'Partner');

    await expect.poll(() => readSessions(page, projectDir, 'partner')).toHaveLength(0);
    const sourcesPanel = page.getByTestId('partner-sources-panel');
    await expect(sourcesPanel.getByText(/No staged sources/)).toBeVisible();
    await sourcesPanel.getByRole('button', { name: 'brief.md' }).click();
    await sourcesPanel.getByRole('button', { name: 'Stage for first message' }).click();
    await expect(sourcesPanel.getByText('brief.md').first()).toBeVisible();
    await expect
      .poll(async () => (await readPartnerWorkbenchContext(page))?.pendingSources?.length ?? -1, {
        timeout: 10_000,
      })
      .toBe(1);

    const prompt = 'use the staged brief to write a source-backed summary';
    await sendPartnerPrompt(page, prompt);
    const sessionId = await onlySessionId(page, projectDir, 'partner');

    await expect
      .poll(() => readPartnerSources(page, sessionId, projectDir), { timeout: 10_000 })
      .toHaveLength(1);
    await expect
      .poll(async () => (await readPartnerWorkbenchContext(page))?.sources?.length ?? -1, {
        timeout: 10_000,
      })
      .toBe(1);
    await expect
      .poll(async () => (await readPartnerWorkbenchContext(page))?.pendingSources?.length ?? -1, {
        timeout: 10_000,
      })
      .toBe(0);
  } finally {
    await space.close();
    await fs.rm(projectDir, { recursive: true, force: true }).catch(() => {});
  }
});
