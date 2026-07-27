import { test, expect } from '@playwright/test';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import { launchSpace, type SpaceInstance } from './fixtures.js';

type WorkflowStatus = 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';
type WorkflowItemStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled' | 'skipped';

interface WorkflowItemForTest {
  id: string;
  title: string;
  kind: 'phase' | 'agent' | 'step' | 'artifact';
  status: WorkflowItemStatus;
  phaseId?: string;
  summaryStatus?: 'pending' | 'result' | 'notice' | 'unavailable';
  summary?: string;
}

interface WorkflowSnapshotForTest {
  runId: string;
  workflowName: string;
  displayName: string;
  status: WorkflowStatus;
  startedAt: string;
  updatedAt: string;
  elapsedMs?: number;
  patterns?: string[];
  activePhaseIndex?: number;
  phaseCount?: number;
  latestMessage?: string;
  resultSummary?: string;
  items: WorkflowItemForTest[];
  counts: {
    pending: number;
    running: number;
    completed: number;
    failed: number;
    cancelled: number;
    skipped: number;
  };
  progress: {
    spawnedAgents: number;
    finishedAgents: number;
    activeAgents: number;
    failedAgents: number;
    stoppedAgents: number;
    plannedItems?: number;
  };
  tokens?: {
    spent: number;
    total?: number;
  };
}

interface WorkflowEventForTest {
  type: 'workflow_started' | 'workflow_updated' | 'workflow_finished';
  snapshot: WorkflowSnapshotForTest;
  message?: string;
  sessionId: string;
  surface: 'code';
  projectRoot?: string;
}

interface SessionListEnvelope {
  ok: boolean;
  data?: { sessions?: Array<{ sessionId: string; projectRoot?: string }> };
}

async function launchSeededSpace(testId: string) {
  const projectDir = path.join(os.tmpdir(), `kodax-test-${testId}-project`);
  await fs.mkdir(projectDir, { recursive: true });
  const space = await launchSpace(testId);
  await space.seedProject(projectDir);
  return { space, projectDir };
}

function snapshot(over: Partial<WorkflowSnapshotForTest> = {}): WorkflowSnapshotForTest {
  const now = '2026-06-21T00:00:00.000Z';
  return {
    runId: 'wf-e2e',
    workflowName: 'generated',
    displayName: 'E2E Workflow Review',
    status: 'running',
    startedAt: now,
    updatedAt: now,
    patterns: ['fan-out-and-synthesize'],
    phaseCount: 2,
    items: [],
    counts: { pending: 0, running: 0, completed: 0, failed: 0, cancelled: 0, skipped: 0 },
    progress: {
      spawnedAgents: 0,
      finishedAgents: 0,
      activeAgents: 0,
      failedAgents: 0,
      stoppedAgents: 0,
      plannedItems: 2,
    },
    ...over,
  };
}

async function getCurrentSessionId(space: SpaceInstance): Promise<string> {
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

  await expect.poll(readSessionId, { timeout: 8_000 }).not.toBeNull();
  const sessionId = await readSessionId();
  if (!sessionId) throw new Error('Session was not created');
  return sessionId;
}

/**
 * The active session's projectRoot — i.e. the project the app is actually on.
 * Selecting/creating a session syncs `currentProjectPath` to this value, so persisted
 * workflow runs must be seeded under THIS root (not the bare seeded dir) to belong to
 * the current project in the workflow manager filter.
 */
async function getCurrentSessionProjectRoot(space: SpaceInstance): Promise<string> {
  const projectRoot = await space.page.evaluate(async () => {
    const bridge = (
      window as unknown as {
        kodaxSpace: {
          invoke: (name: string, input: unknown) => Promise<SessionListEnvelope>;
        };
      }
    ).kodaxSpace;
    const result = await bridge.invoke('session.list', { surface: 'code' });
    if (!result.ok) return null;
    return result.data?.sessions?.[0]?.projectRoot ?? null;
  });
  if (!projectRoot) throw new Error('Session project root was not available');
  return projectRoot;
}

async function emitWorkflowEvent(
  space: SpaceInstance,
  payload: WorkflowEventForTest,
): Promise<void> {
  await space.app.evaluate(({ BrowserWindow }, eventPayload) => {
    const win = BrowserWindow.getAllWindows()[0];
    if (!win) throw new Error('No BrowserWindow available');
    win.webContents.send('workflow.event', eventPayload);
  }, payload);
}

async function writePersistedWorkflowRun(
  space: SpaceInstance,
  projectDir: string,
  sessionId = 'persisted-session',
): Promise<string> {
  const runId = 'wf_persisted_e2e';
  const runDir = path.join(space.testDataDir, 'space', 'workflow-runs', runId);
  const artifactsDir = path.join(runDir, 'artifacts');
  await fs.mkdir(artifactsDir, { recursive: true });
  await fs.writeFile(
    path.join(runDir, 'manifest.json'),
    JSON.stringify({ patterns: ['fan-out-and-synthesize'] }),
  );
  await fs.writeFile(
    path.join(runDir, 'events.jsonl'),
    [
      { seq: 1, type: 'workflow_started', data: { runId }, ts: 1782039116701 },
      { seq: 2, type: 'phase_started', data: { name: 'Collect changes' }, ts: 1782039116703 },
      {
        seq: 3,
        type: 'agent_spawned',
        data: { taskId: 'wf-child-1', name: 'Change collector' },
        ts: 1782039116706,
      },
      {
        seq: 4,
        type: 'agent_completed',
        data: {
          taskId: 'wf-child-1',
          name: 'Change collector',
          status: 'completed',
          provider: 'mock-provider',
          summaryKind: 'pending',
          summary: 'Long raw child result should stay folded until a digest is available.',
        },
        ts: 1782039208729,
      },
      {
        seq: 5,
        type: 'agent_summary_updated',
        data: {
          taskId: 'wf-child-1',
          name: 'Change collector',
          summaryKind: 'digest',
          summary: 'Recovered persisted child digest.',
        },
        ts: 1782039226149,
      },
      { seq: 6, type: 'phase_finished', data: { name: 'Collect changes' }, ts: 1782039355793 },
      { seq: 7, type: 'phase_started', data: { name: 'Synthesize report' }, ts: 1782039355794 },
      { seq: 8, type: 'artifact_written', data: { name: 'final-report' }, ts: 1782039852802 },
      {
        seq: 9,
        type: 'workflow_completed',
        data: { resultSummary: '# Persisted final report\n\nRecovered from disk.' },
        ts: 1782039852803,
      },
    ]
      .map((event) => JSON.stringify(event))
      .join('\n'),
  );
  await fs.writeFile(
    path.join(artifactsDir, 'final-report.json'),
    JSON.stringify({ report: '# Durable artifact report\n\nRecovered artifact body.' }),
  );
  await fs.writeFile(
    path.join(runDir, 'run.json'),
    JSON.stringify({
      runId,
      workflow: 'Persisted Workflow Review',
      displayName: 'Persisted Workflow Review',
      status: 'completed',
      startedAt: '2026-06-21T01:00:00.000Z',
      endedAt: '2026-06-21T01:01:00.000Z',
      totalSpawned: 1,
      args: { request: 'Restore completed workflow history' },
      artifacts: ['final-report'],
      resultSummary: '# Persisted final report\n\nRecovered from disk.',
      hostMetadata: {
        sessionId,
        surface: 'code',
        projectRoot: projectDir,
      },
    }),
  );
  return runId;
}

async function writeEventsOnlyWorkflowRun(
  space: SpaceInstance,
  projectDir: string,
): Promise<string> {
  const runId = 'wf_events_only_e2e';
  const spaceDir = path.join(space.testDataDir, 'space');
  const runDir = path.join(spaceDir, 'workflow-runs', runId);
  const artifactsDir = path.join(runDir, 'artifacts');
  await fs.mkdir(artifactsDir, { recursive: true });
  await fs.writeFile(
    path.join(spaceDir, 'workflow-origins.json'),
    JSON.stringify({
      version: 1,
      origins: {
        [runId]: {
          sessionId: 'events-only-session',
          surface: 'code',
          projectRoot: projectDir,
        },
      },
    }),
  );
  await fs.writeFile(
    path.join(runDir, 'manifest.json'),
    JSON.stringify({
      name: 'Events Only Workflow Review',
      phases: ['Collect changes', 'Synthesize report'],
      patterns: ['fan-out-and-synthesize'],
    }),
  );
  const longDigest = `${'Recovered long child digest. '.repeat(
    35,
  )}DIGEST_TAIL_VISIBLE_ONLY_WHEN_EXPANDED`;
  await fs.writeFile(
    path.join(runDir, 'events.jsonl'),
    [
      { seq: 1, type: 'workflow_started', data: { runId }, ts: 1782039916701 },
      { seq: 2, type: 'phase_started', data: { name: 'Collect changes' }, ts: 1782039916703 },
      {
        seq: 3,
        type: 'agent_spawned',
        data: { taskId: 'wf-events-child-1', name: 'Events collector' },
        ts: 1782039916706,
      },
      {
        seq: 4,
        type: 'agent_completed',
        data: {
          taskId: 'wf-events-child-1',
          name: 'Events collector',
          status: 'completed',
          provider: 'mock-provider',
          summaryKind: 'digest',
          summary: longDigest,
        },
        ts: 1782039928729,
      },
      {
        seq: 5,
        type: 'agent_spawned',
        data: { taskId: 'wf-events-child-2', name: 'Synthesize report' },
        ts: 1782039930000,
      },
      {
        seq: 6,
        type: 'agent_completed',
        data: {
          taskId: 'wf-events-child-2',
          name: 'Synthesize report',
          status: 'completed',
          summaryKind: 'digest',
          summary: 'Synthesized the final events-only report.',
        },
        ts: 1782039935000,
      },
      { seq: 7, type: 'synthesis_completed', ts: 1782039936000 },
      { seq: 8, type: 'artifact_written', data: { name: 'final-report' }, ts: 1782039937000 },
    ]
      .map((event) => JSON.stringify(event))
      .join('\n'),
  );
  await fs.writeFile(
    path.join(artifactsDir, 'final-report.json'),
    JSON.stringify({ report: '# Events-only artifact report\n\nRecovered without run.json.' }),
  );
  return runId;
}

test('workflow push events update the sidebar and transcript through completion', async () => {
  test.skip(
    !!process.env.CI && process.platform === 'win32',
    'seeds a session via a mock assistant turn that can stall on Windows CI; keep local and Linux coverage',
  );
  const testId = `workflow-events-${Date.now()}`;
  const { space, projectDir } = await launchSeededSpace(testId);
  try {
    const textarea = space.page.locator('textarea').first();
    const stream = space.page.getByTestId('conversation-stream');
    await expect(textarea).toBeEnabled({ timeout: 10_000 });

    const prompt = 'seed workflow e2e session';
    await textarea.fill(prompt);
    await textarea.press('Enter');
    await expect(stream.getByTestId('user-message-bubble').filter({ hasText: prompt })).toBeVisible(
      {
        timeout: 5_000,
      },
    );

    const sessionId = await getCurrentSessionId(space);

    await emitWorkflowEvent(space, {
      type: 'workflow_started',
      sessionId,
      surface: 'code',
      message: 'agent spawned: Collector',
      snapshot: snapshot({
        activePhaseIndex: 0,
        latestMessage: 'agent spawned: Collector',
        items: [
          { id: 'p1', title: 'Collect changes', kind: 'phase', status: 'running' },
          { id: 'a1', title: 'Collector', kind: 'agent', phaseId: 'p1', status: 'running' },
          { id: 'p2', title: 'Review', kind: 'phase', status: 'pending' },
        ],
        counts: { pending: 1, running: 2, completed: 0, failed: 0, cancelled: 0, skipped: 0 },
        progress: {
          spawnedAgents: 1,
          finishedAgents: 0,
          activeAgents: 1,
          failedAgents: 0,
          stoppedAgents: 0,
          plannedItems: 2,
        },
      }),
    });

    const sidebar = space.page.getByTestId('right-sidebar');
    // First render after the workflow event round-trips main -> renderer -> store;
    // on the loaded Windows CI runner this can take longer than the default 5s.
    await expect(sidebar).toContainText('E2E Workflow Review', { timeout: 15_000 });
    await expect(sidebar.getByLabel('Workflow runtime status')).toContainText('Collect changes', {
      timeout: 15_000,
    });
    const pinnedSummary = space.page.getByTestId('pinned-task-summary');
    await expect(pinnedSummary).toContainText('E2E Workflow Review', { timeout: 15_000 });
    await expect(space.page.getByTestId('workflow-live-strip')).toHaveCount(0);

    await emitWorkflowEvent(space, {
      type: 'workflow_updated',
      sessionId,
      surface: 'code',
      message: 'agent spawned: Reviewer',
      snapshot: snapshot({
        activePhaseIndex: 1,
        latestMessage: 'agent spawned: Reviewer',
        items: [
          { id: 'p1', title: 'Collect changes', kind: 'phase', status: 'completed' },
          {
            id: 'a1',
            title: 'Collector',
            kind: 'agent',
            phaseId: 'p1',
            status: 'completed',
            summaryStatus: 'result',
            summary: 'Collected changed files and commit history.',
          },
          { id: 'p2', title: 'Review', kind: 'phase', status: 'running' },
          { id: 'a2', title: 'Reviewer', kind: 'agent', phaseId: 'p2', status: 'running' },
        ],
        counts: { pending: 0, running: 2, completed: 2, failed: 0, cancelled: 0, skipped: 0 },
        progress: {
          spawnedAgents: 2,
          finishedAgents: 1,
          activeAgents: 1,
          failedAgents: 0,
          stoppedAgents: 0,
          plannedItems: 2,
        },
        tokens: { spent: 1200, total: 5000 },
      }),
    });

    // Live run progress (agent spawned / phase started) is NOT pushed to the
    // transcript — it surfaces only in the right-sidebar runtime status. History
    // keeps just per-agent summaries and the final result.
    await expect(sidebar.getByLabel('Workflow runtime status')).toContainText('Reviewer', {
      timeout: 15_000,
    });
    await expect(pinnedSummary).toContainText('agent spawned: Reviewer', { timeout: 15_000 });
    await expect(
      stream.locator('[data-testid="system-notice"][data-notice-variant="workflow"]', {
        hasText: '[workflow] agent summary: Collector',
      }),
    ).toBeVisible({ timeout: 5_000 });
    // Spawn/live-progress must never leak into the transcript as a notice.
    await expect(
      stream.locator('[data-testid="system-notice"][data-notice-variant="workflow"]', {
        hasText: '[workflow] agent spawned',
      }),
    ).toHaveCount(0);

    await emitWorkflowEvent(space, {
      type: 'workflow_finished',
      sessionId,
      surface: 'code',
      message: 'workflow completed',
      snapshot: snapshot({
        status: 'completed',
        activePhaseIndex: 1,
        latestMessage: 'workflow completed',
        resultSummary: `# Final workflow report\n\n${'All checks passed with a detailed paragraph. '.repeat(
          30,
        )}\nTAIL_MARKER_VISIBLE_IN_FULL_REPORT`,
        items: [
          { id: 'p1', title: 'Collect changes', kind: 'phase', status: 'completed' },
          {
            id: 'a1',
            title: 'Collector',
            kind: 'agent',
            phaseId: 'p1',
            status: 'completed',
            summaryStatus: 'result',
            summary: 'Collected changed files and commit history.',
          },
          { id: 'p2', title: 'Review', kind: 'phase', status: 'running' },
          { id: 'a2', title: 'Reviewer', kind: 'agent', phaseId: 'p2', status: 'running' },
        ],
        counts: { pending: 0, running: 2, completed: 2, failed: 0, cancelled: 0, skipped: 0 },
        progress: {
          spawnedAgents: 2,
          finishedAgents: 2,
          activeAgents: 0,
          failedAgents: 0,
          stoppedAgents: 0,
          plannedItems: 2,
        },
        tokens: { spent: 2400, total: 5000 },
      }),
    });

    await expect(space.page.getByTestId('workflow-live-strip')).toHaveCount(0);
    await expect(sidebar).toContainText('E2E Workflow Review');
    await expect(
      sidebar.getByLabel('Workflow runtime status').getByLabel('phase status: running'),
    ).toHaveCount(0);
    const finalWorkflowNotice = stream.locator(
      '[data-testid="system-notice"][data-notice-variant="workflow"]',
      {
        hasText: '[workflow] completed: E2E Workflow Review',
      },
    );
    await expect(finalWorkflowNotice).toBeVisible({ timeout: 5_000 });
    await expect(finalWorkflowNotice).toHaveCount(1);
    await expect(finalWorkflowNotice.getByLabel('Copy message')).toBeVisible();
    await expect(finalWorkflowNotice).toContainText(/just now|\d+(?:s|m|h|d|w|mo|y) ago/);
    await expect(stream).toContainText('# Final workflow report');
    await expect(stream).toContainText('TAIL_MARKER_VISIBLE_IN_FULL_REPORT');
    await expect(sidebar).not.toContainText('TAIL_MARKER_VISIBLE_IN_FULL_REPORT');
    await sidebar.getByTestId('workflow-result-toggle').click();
    await expect(sidebar).toContainText('TAIL_MARKER_VISIBLE_IN_FULL_REPORT');
  } finally {
    await space.close();
    await fs.rm(projectDir, { recursive: true, force: true }).catch(() => {});
  }
});

test('workflow manager restores completed runs persisted on disk', async () => {
  const testId = `workflow-history-${Date.now()}`;
  const { space, projectDir } = await launchSeededSpace(testId);
  try {
    const textarea = space.page.locator('textarea').first();
    const stream = space.page.getByTestId('conversation-stream');
    await expect(textarea).toBeEnabled({ timeout: 10_000 });

    const prompt = 'seed workflow history session';
    await textarea.fill(prompt);
    await textarea.press('Enter');
    await expect(stream.getByTestId('user-message-bubble').filter({ hasText: prompt })).toBeVisible(
      { timeout: 5_000 },
    );

    const sessionId = await getCurrentSessionId(space);
    // Seed runs under the project the app actually adopts (the active session's
    // projectRoot). Selecting a session syncs currentProjectPath to it, so the bare
    // seeded dir is no longer the current project; runs there would be filtered out.
    const activeProjectRoot = await getCurrentSessionProjectRoot(space);
    await writePersistedWorkflowRun(space, activeProjectRoot, sessionId);
    await writeEventsOnlyWorkflowRun(space, activeProjectRoot);

    await space.page.getByRole('button', { name: 'Open workflow panel' }).click();
    const panel = space.page.getByTestId('workflow-management-panel');
    await expect(panel).toBeVisible({ timeout: 5_000 });
    await expect(panel).toContainText('Persisted Workflow Review', { timeout: 5_000 });
    await expect(panel).toContainText('Events Only Workflow Review', { timeout: 5_000 });

    await panel
      .getByTestId('workflow-run-list-item')
      .filter({ hasText: 'Persisted Workflow Review' })
      .click();
    await expect(panel).toContainText('completed');
    await expect(panel.getByLabel('Workflow runtime status')).toContainText('Collect changes');
    await expect(panel.getByLabel('Workflow runtime status')).toContainText('Synthesize report');
    await expect(panel.getByTestId('workflow-management-result-summary')).toHaveCount(0);
    await expect(panel.getByTestId('workflow-result-toggle')).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    // The WORKFLOW DIAGRAM (pattern-topology chips + full topology graph) was removed as
    // redundant with the runtime-status list. Top-level phase nodes are asserted above;
    // child-agent names ("Change collector") are asserted below via the expandable
    // workflow-management-detail tree.
    await panel.getByTestId('workflow-details-toggle').click();
    await expect(panel.getByTestId('workflow-management-detail')).toContainText('Change collector');
    // Child digests render inline in the flat detail tree (short ones always visible; long
    // ones expose a workflow-digest-toggle — see the Events Only run below). This short
    // digest is shown without folding. The workflow resultSummary is no longer shown as a
    // separate 'workflow-management-result-summary' (asserted count 0 above); the canonical
    // result is the artifact body verified via workflow-result-body below.
    await expect(panel.getByTestId('workflow-management-detail')).toContainText(
      'Recovered persisted child digest.',
    );
    await panel
      .getByTestId('workflow-management-detail')
      .getByRole('button', { name: 'Run again' })
      .click();
    await space.page.waitForTimeout(500);
    await expect(space.page.getByText('session not found')).toHaveCount(0);
    await expect(panel.getByTestId('workflow-result-body')).toContainText(
      'Durable artifact report',
    );
    await expect(panel.getByTestId('workflow-management-detail')).not.toContainText('加载中');

    await panel
      .getByTestId('workflow-run-list-item')
      .filter({ hasText: 'Events Only Workflow Review' })
      .click();
    await expect(panel.getByTestId('workflow-management-detail')).toContainText('completed');
    await expect(panel.getByLabel('Workflow runtime status')).toContainText('Collect changes');
    await expect(panel.getByLabel('Workflow runtime status')).toContainText('Synthesize report');
    // 'Events collector' (child agent) is asserted below via workflow-management-detail.
    await panel.getByTestId('workflow-details-toggle').click();
    await expect(panel.getByTestId('workflow-management-detail')).toContainText('Events collector');
    await expect(panel.getByTestId('workflow-management-detail')).not.toContainText(
      'DIGEST_TAIL_VISIBLE_ONLY_WHEN_EXPANDED',
    );
    await panel.getByTestId('workflow-digest-toggle').first().click();
    await expect(panel.getByTestId('workflow-management-detail')).toContainText(
      'DIGEST_TAIL_VISIBLE_ONLY_WHEN_EXPANDED',
    );
    await expect(panel.getByTestId('workflow-result-body')).toContainText(
      'Events-only artifact report',
    );
    await expect(panel.getByTestId('workflow-management-detail')).not.toContainText('加载中');
  } finally {
    await space.close();
    await fs.rm(projectDir, { recursive: true, force: true }).catch(() => {});
  }
});

// NOTE: the former 'restored workflow runs hydrate transcript summaries after renderer
// reload' test was removed. Workflow result/failure notices no longer restore into the
// transcript from the run-dir side-store (App.tsx stopped calling
// formatWorkflowRunRestoreNotices — that wall-clock re-merge mis-ordered/pinned-to-top
// after SDK compaction flattens transcript timestamps). Restore now happens IN-PLACE from
// the SDK transcript's `<task-completed>` synthetic message via session.history →
// workflow_notice, covered by unit tests: workflow-result-notice.test.ts (parse),
// composeMessages.test.ts ('workflow_notice event renders … at its transcript position'),
// and history-replay-no-popout.test.ts ('workflow_notice history item restores …').
// Run-dir → sidebar manager restore stays covered by the 'workflow manager restores
// completed runs persisted on disk' test above.
