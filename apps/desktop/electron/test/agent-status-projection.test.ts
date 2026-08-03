import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildAgentStatuses,
  scopeAgentActorSnapshotToCurrentTurn,
} from '../../renderer/src/shell/agentStatusProjection.js';
import { messages, type MessageKey } from '../../renderer/src/i18n/messages.js';
import type { AgentActorTreeSnapshotT, SessionEvent } from '@kodax-space/space-ipc-schema';

type Status = Parameters<typeof buildAgentStatuses>[0];

function makeStatus(overrides: Partial<NonNullable<Status>> = {}): NonNullable<Status> {
  return {
    agentMode: 'ama',
    harnessProfile: 'H2_PLAN_EXECUTE_EVAL',
    ...overrides,
  };
}

test('agent status projection shows semantic active worker status', () => {
  const statuses = buildAgentStatuses(
    makeStatus({
      activeWorkerId: 'research-1',
      activeWorkerTitle: 'Research worker',
      events: [
        {
          key: 'e1',
          kind: 'progress',
          workerId: 'research-1',
          workerTitle: 'Research worker',
          phase: 'source_review',
          summary: 'Confirmed changes should route to review workspace',
        },
      ],
    }),
  );

  assert.equal(statuses.length, 1);
  assert.equal(statuses[0].title, 'Research worker');
  assert.equal(statuses[0].state, 'active');
  assert.equal(statuses[0].role, 'research');
  assert.equal(statuses[0].responsibility, 'Source review');
  assert.equal(statuses[0].latest, 'Confirmed changes should route to review workspace');
  assert.equal(statuses[0].traceCount, 1);
});

test('agent status projection avoids surfacing uuid-like titles', () => {
  const statuses = buildAgentStatuses(
    makeStatus({
      activeWorkerId: 'worker-1234567890',
      activeWorkerTitle: 'abc123def456',
      events: [],
    }),
  );

  assert.equal(statuses.length, 1);
  assert.equal(statuses[0].title, 'Worker');
});

test('agent status projection localizes generated fallback labels', () => {
  const t = (key: MessageKey): string => messages['zh-CN'][key];
  const statuses = buildAgentStatuses(
    makeStatus({
      activeWorkerId: 'worker-1234567890',
      activeWorkerTitle: 'abc123def456',
      events: [],
    }),
    t,
  );

  assert.equal(statuses[0].title, '执行代理');
  assert.equal(statuses[0].role, '执行代理');
  assert.equal(statuses[0].responsibility, '执行中');
});

test('agent status projection reuses cached view for the same status snapshot', () => {
  const status = makeStatus({
    activeWorkerId: 'worker-1',
    activeWorkerTitle: 'Research worker',
    events: [
      {
        key: 'e1',
        kind: 'progress',
        workerId: 'worker-1',
        workerTitle: 'Research worker',
        summary: 'Checking cache reuse',
      },
    ],
  });

  assert.strictEqual(buildAgentStatuses(status), buildAgentStatuses(status));
});

test('Actor tree projection is canonical and includes recursive Agent lifecycle', () => {
  const snapshot: AgentActorTreeSnapshotT = {
    runtimeId: 'rt_1',
    sessionId: 's_1',
    rootPath: '/root',
    revision: 5,
    eventCursor: 8,
    activeNonRootTurns: 1,
    maxConcurrentThreads: 4,
    actors: [
      {
        path: '/root',
        taskName: 'root',
        kind: 'native',
        state: 'running',
        createdAt: '2026-07-27T00:00:00.000Z',
        updatedAt: '2026-07-27T00:00:03.000Z',
        revision: 2,
      },
      {
        path: '/root/review/final',
        taskName: 'final-review',
        parentPath: '/root/review',
        kind: 'constructed',
        state: 'idle',
        createdAt: '2026-07-27T00:00:01.000Z',
        updatedAt: '2026-07-27T00:00:03.000Z',
        revision: 4,
        latestTurn: {
          turnId: 'turn_review',
          state: 'interrupted',
          summary: 'Stopped after parent cancellation',
          summaryTruncated: false,
          recentActivity: [
            {
              sequence: 8,
              kind: 'status',
              summary: 'Review interrupted',
              createdAt: '2026-07-27T00:00:03.000Z',
            },
          ],
        },
      },
    ],
  };
  const legacy = makeStatus({
    activeWorkerId: 'worker',
    activeWorkerTitle: 'Worker',
    events: [
      {
        key: 'root-progress',
        kind: 'progress',
        workerId: 'worker',
        workerTitle: 'Worker',
        phase: 'implementation',
        summary: 'Delegating review',
      },
    ],
  });

  const statuses = buildAgentStatuses(legacy, undefined, snapshot);

  assert.deepEqual(
    statuses.map((status) => [status.id, status.title, status.state]),
    [
      ['/root', 'Root Agent', 'active'],
      ['/root/review/final', 'final-review', 'interrupted'],
    ],
  );
  assert.equal(statuses[0]?.responsibility, 'Implementation');
  assert.equal(statuses[0]?.latest, 'Delegating review');
  assert.equal(statuses[0]?.traceCount, 1);
  assert.equal(statuses[1]?.latest, 'Review interrupted');
  assert.equal(statuses[1]?.trace?.[0]?.kind, 'status');
  assert.strictEqual(
    buildAgentStatuses(legacy, undefined, snapshot),
    buildAgentStatuses(legacy, undefined, snapshot),
  );
  assert.equal(buildAgentStatuses(undefined, undefined, snapshot)[0]?.state, 'idle');
});

test('current-turn Actor scope excludes completed Agents from earlier turns', () => {
  const snapshot: AgentActorTreeSnapshotT = {
    runtimeId: 'rt_1',
    sessionId: 's_1',
    rootPath: '/root',
    revision: 12,
    eventCursor: 30,
    activeNonRootTurns: 2,
    maxConcurrentThreads: 4,
    actors: [
      makeActor('/root', 'root'),
      makeActor('/root/md-to-html', 'md-to-html', 'turn_md', 'completed'),
      makeActor('/root/html-to-pdf', 'html-to-pdf', 'turn_pdf', 'completed'),
      makeActor('/root/shanghai-json', 'shanghai-json', 'turn_shanghai', 'completed'),
      makeActor('/root/beijing-json', 'beijing-json', 'turn_beijing', 'running'),
    ],
  };
  const events = [
    { kind: 'session_start', sessionId: 's_1', provider: 'mock', turnId: 'turn_old' },
    {
      kind: 'tool_result',
      sessionId: 's_1',
      toolId: 'spawn_old',
      toolName: 'spawn_agent',
      content: JSON.stringify({
        actorPath: '/root/html-to-pdf',
        turnId: 'turn_pdf',
      }),
    },
    { kind: 'session_start', sessionId: 's_1', provider: 'mock', turnId: 'turn_current' },
    {
      kind: 'tool_result',
      sessionId: 's_1',
      toolId: 'spawn_shanghai',
      toolName: 'spawn_agent',
      content: JSON.stringify({
        actorPath: '/root/shanghai-json',
        turnId: 'turn_shanghai',
      }),
    },
    {
      kind: 'tool_result',
      sessionId: 's_1',
      toolId: 'spawn_beijing',
      toolName: 'spawn_agent',
      content: JSON.stringify({
        actorPath: '/root/beijing-json',
        turnId: 'turn_beijing',
      }),
    },
  ] satisfies readonly SessionEvent[];

  const scoped = scopeAgentActorSnapshotToCurrentTurn(snapshot, events);

  assert.deepEqual(
    scoped?.actors.map((actor) => actor.path),
    ['/root', '/root/shanghai-json', '/root/beijing-json'],
  );
  assert.equal(scoped?.activeNonRootTurns, 1);
  assert.deepEqual(
    buildAgentStatuses(undefined, undefined, scoped).map((status) => [status.id, status.state]),
    [
      ['/root', 'idle'],
      ['/root/shanghai-json', 'completed'],
      ['/root/beijing-json', 'active'],
    ],
  );
});

function makeActor(
  actorPath: string,
  taskName: string,
  turnId?: string,
  turnState?: 'running' | 'completed',
): AgentActorTreeSnapshotT['actors'][number] {
  const isRoot = actorPath === '/root';
  return {
    path: actorPath,
    taskName,
    ...(isRoot ? {} : { parentPath: '/root' }),
    kind: 'native',
    state: turnState === 'running' ? 'running' : 'idle',
    ...(turnState === 'running' && turnId ? { currentTurnId: turnId } : {}),
    createdAt: '2026-07-30T00:00:00.000Z',
    updatedAt: '2026-07-30T00:00:01.000Z',
    revision: 1,
    ...(turnId && turnState
      ? {
          latestTurn: {
            turnId,
            state: turnState,
            summary: turnState,
            summaryTruncated: false,
            recentActivity: [],
          },
        }
      : {}),
  };
}
