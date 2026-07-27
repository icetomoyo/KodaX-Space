import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AgentActorTreeSnapshotT, WorkflowRunT } from '@kodax-space/space-ipc-schema';
import type { MessageKey } from '../../renderer/src/i18n/messages.js';
import { buildTaskDockRunView } from '../../renderer/src/shell/taskDockProjection.js';
import { getCachedTaskDockRunView } from '../../renderer/src/shell/useTaskDockRunView.js';

test('task dock run projection prioritizes blocking permission attention', () => {
  const view = buildTaskDockRunView({
    hasProject: true,
    hasSession: true,
    pendingSend: true,
    hasPermissionRequest: true,
  });

  assert.equal(view.mode, 'attention');
  assert.equal(view.attentionKind, 'permission');
  assert.equal(view.primaryTarget, 'run');
});

test('task dock run projection routes active worker to agents', () => {
  const view = buildTaskDockRunView({
    hasProject: true,
    hasSession: true,
    pendingSend: false,
    managedStatus: {
      agentMode: 'ama',
      harnessProfile: 'H2_PLAN_EXECUTE_EVAL',
      activeWorkerId: 'worker-1',
      activeWorkerTitle: 'Review worker',
      events: [
        {
          key: 'e1',
          kind: 'progress',
          workerId: 'worker-1',
          workerTitle: 'Review worker',
          summary: 'Reviewing changed files',
        },
      ],
    },
  });

  assert.equal(view.mode, 'running');
  assert.equal(view.primaryTarget, 'agents');
  assert.match(view.headline, /Review worker/);
});

test('task dock run projection summarizes active and completed agents', () => {
  const view = buildTaskDockRunView({
    hasProject: true,
    hasSession: true,
    pendingSend: false,
    managedStatus: {
      agentMode: 'ama',
      harnessProfile: 'H2_PLAN_EXECUTE_EVAL',
      activeWorkerId: 'coding',
      activeWorkerTitle: 'coding',
      events: [
        {
          key: 'agent-done',
          kind: 'completed',
          workerId: 'agent',
          workerTitle: 'agent',
          summary: 'agent review complete',
        },
        {
          key: 'repl-done',
          kind: 'completed',
          workerId: 'repl',
          workerTitle: 'repl',
          summary: 'repl review complete',
        },
        {
          key: 'coding-progress',
          kind: 'progress',
          workerId: 'coding',
          workerTitle: 'coding',
          summary: 'coding review in progress',
        },
      ],
    },
  });

  assert.deepEqual(
    view.metrics.find((metric) => metric.key === 'agents'),
    { key: 'agents', label: 'Agents', value: '3 / 1 running / 2 done' },
  );
});

test('task dock run projection uses the Runtime Actor tree for root and child status', () => {
  const actorSnapshot: AgentActorTreeSnapshotT = {
    runtimeId: 'rt_1',
    sessionId: 's_1',
    rootPath: '/root',
    revision: 3,
    eventCursor: 4,
    activeNonRootTurns: 1,
    maxConcurrentThreads: 4,
    actors: [
      {
        path: '/root',
        taskName: 'root',
        kind: 'native',
        state: 'running',
        createdAt: '2026-07-27T00:00:00.000Z',
        updatedAt: '2026-07-27T00:00:02.000Z',
        revision: 2,
      },
      {
        path: '/root/reviewer',
        taskName: 'Review Agent',
        parentPath: '/root',
        kind: 'native',
        state: 'running',
        currentTurnId: 'turn_review',
        createdAt: '2026-07-27T00:00:01.000Z',
        updatedAt: '2026-07-27T00:00:02.000Z',
        revision: 2,
        latestTurn: {
          turnId: 'turn_review',
          state: 'running',
          summary: 'Reviewing the patch',
          summaryTruncated: false,
          recentActivity: [],
        },
      },
    ],
  };
  const view = buildTaskDockRunView({
    hasProject: true,
    hasSession: true,
    pendingSend: false,
    actorSnapshot,
    managedStatus: {
      agentMode: 'ama',
      harnessProfile: 'H2_PLAN_EXECUTE_EVAL',
      activeWorkerId: 'worker',
      activeWorkerTitle: 'Worker',
      childFanoutCount: 99,
      events: [
        {
          key: 'root-progress',
          kind: 'progress',
          workerId: 'worker',
          workerTitle: 'Worker',
          summary: 'Coordinating delegated work',
        },
      ],
    },
  });

  assert.equal(view.mode, 'running');
  assert.equal(view.primaryTarget, 'agents');
  assert.match(view.headline, /Review Agent/);
  assert.deepEqual(
    view.metrics.find((metric) => metric.key === 'agents'),
    { key: 'agents', label: 'Agents', value: '2 / 2 running' },
  );
});

test('task dock plan metric counts completed items only', () => {
  const view = buildTaskDockRunView({
    hasProject: true,
    hasSession: true,
    pendingSend: false,
    todos: [
      { id: 'a', content: 'A', status: 'completed' },
      { id: 'b', content: 'B', status: 'in_progress' },
      { id: 'c', content: 'C', status: 'pending' },
    ],
  });

  assert.deepEqual(
    view.metrics.find((metric) => metric.label === 'Plan'),
    { key: 'plan', label: 'Plan', value: '1/3' },
  );
});

test('task dock run projection gives no-project actionable state', () => {
  const view = buildTaskDockRunView({
    hasProject: false,
    hasSession: false,
    pendingSend: false,
  });

  assert.equal(view.mode, 'no_project');
  assert.equal(view.severity, 'neutral');
});

test('task dock run projection gives neutral idle state before a session exists', () => {
  const view = buildTaskDockRunView({
    hasProject: true,
    hasSession: false,
    pendingSend: false,
  });

  assert.equal(view.mode, 'idle');
  assert.equal(view.severity, 'neutral');
  assert.equal(view.headline, 'Ready');
});

test('task dock run view cache reuses the same raw input snapshot', () => {
  const events = [] as const;
  const workflowRun = workflowRunFixture();
  const workflowRuns = [workflowRun];
  const t = (key: MessageKey): string => key;
  const input = {
    hasProject: true,
    hasSession: true,
    pendingSend: false,
    workflowRuns,
    events,
    t,
  };

  const first = getCachedTaskDockRunView(input);
  const second = getCachedTaskDockRunView({ ...input, workflowRuns: [workflowRun] });
  const third = getCachedTaskDockRunView({ ...input, events: [] });

  assert.equal(second, first);
  assert.notEqual(third, first);
});

function workflowRunFixture(): WorkflowRunT {
  return {
    runId: 'wf-test',
    workflowName: 'review',
    status: 'completed',
    startedAt: '2026-07-07T00:00:00.000Z',
    updatedAt: '2026-07-07T00:00:01.000Z',
    items: [],
    counts: { pending: 0, running: 0, completed: 0, failed: 0, cancelled: 0, skipped: 0 },
    progress: {
      spawnedAgents: 0,
      finishedAgents: 0,
      activeAgents: 0,
      failedAgents: 0,
      stoppedAgents: 0,
    },
  };
}
