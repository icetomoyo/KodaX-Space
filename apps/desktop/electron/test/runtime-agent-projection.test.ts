import assert from 'node:assert/strict';
import test from 'node:test';

import type {
  AgentDetail,
  AgentEvent,
  AgentOutput,
  AgentTreeSnapshot,
} from '@kodax-ai/kodax/agent';
import {
  decodeRuntimeActorTaskId,
  encodeRuntimeActorTaskId,
  isRuntimeActorTaskId,
  projectRuntimeActorEvent,
  projectRuntimeActorTreeSnapshot,
  projectRuntimeActorTask,
} from '../kodax/runtime/runtime-agent-projection.js';

const detail = {
  actor: {
    path: '/root/reference',
    taskName: 'reference',
    parentPath: '/root',
    kind: 'external',
    state: 'idle',
    capabilities: {
      tools: [],
      filesystem: 'none',
      network: false,
      providers: [],
      canAskUser: false,
    },
    turnIds: ['turn_1'],
    mailboxCursor: 0,
    createdAt: '2026-07-19T00:00:00.000Z',
    updatedAt: '2026-07-19T00:00:02.000Z',
    revision: 2,
  },
  turns: [
    {
      turnId: 'turn_1',
      actorPath: '/root/reference',
      sequence: 1,
      state: 'completed',
      objective: 'verify Runtime Actor projection',
      forkTurns: 'none',
      metadata: {
        agentId: 'external:reference',
        configurationRevision: 'revision-1',
        protocol: 'http',
      },
      createdAt: '2026-07-19T00:00:00.000Z',
      completedAt: '2026-07-19T00:00:02.000Z',
      revision: 2,
    },
  ],
  mailbox: [],
} as const satisfies AgentDetail;

test('Runtime Actor identities round-trip through the legacy task id boundary', () => {
  const taskId = encodeRuntimeActorTaskId({ actorPath: '/root/reference', turnId: 'turn_1' });
  assert.equal(isRuntimeActorTaskId(taskId), true);
  assert.deepEqual(decodeRuntimeActorTaskId(taskId), {
    actorPath: '/root/reference',
    turnId: 'turn_1',
  });
  assert.throws(() => decodeRuntimeActorTaskId('legacy-task'));
});

test('Runtime external Actor turns project without reintroducing the retired task service', () => {
  const output = {
    actorPath: '/root/reference',
    turnId: 'turn_1',
    state: 'completed',
    output: 'done',
    artifacts: [],
    progress: [{ sequence: 1, kind: 'status', summary: 'complete', createdAt: 'now' }],
  } as const satisfies AgentOutput;
  const task = projectRuntimeActorTask('s_code', detail, detail.turns[0], output);
  assert.equal(task.agentId, 'external:reference');
  assert.equal(task.state, 'completed');
  assert.equal(task.route, 'external');
  assert.equal(task.parentTaskId, 's_code');
  assert.equal(task.output, 'done');
  assert.equal(task.progress?.message, 'complete');
});

test('Runtime Actor events retain the daemon sequence cursor and terminal state', () => {
  const event = {
    sequence: 7,
    kind: 'turn_interrupted',
    actorPath: '/root/reference',
    turnId: 'turn_1',
    createdAt: '2026-07-19T00:00:03.000Z',
  } as const satisfies AgentEvent;
  assert.deepEqual(projectRuntimeActorEvent(event), {
    taskId: encodeRuntimeActorTaskId({ actorPath: '/root/reference', turnId: 'turn_1' }),
    seq: 7,
    timestamp: '2026-07-19T00:00:03.000Z',
    type: 'cancellation',
    state: 'canceled',
    cancellation: 'confirmed',
  });
});

test('Runtime Actor tree projection preserves recursive lifecycle and bounded activity', () => {
  const longSummary = 'x'.repeat(5_000);
  const tree = {
    rootPath: '/root',
    revision: 9,
    activeNonRootTurns: 1,
    maxConcurrentThreads: 4,
    actors: [
      {
        path: '/root/reviewer',
        taskName: 'reviewer',
        parentPath: '/root',
        kind: 'native',
        state: 'running',
        capabilities: {
          tools: [],
          filesystem: 'read',
          network: false,
          providers: [],
          canAskUser: false,
        },
        turnIds: ['turn_review'],
        currentTurnId: 'turn_review',
        mailboxCursor: 0,
        createdAt: '2026-07-27T00:00:00.000Z',
        updatedAt: '2026-07-27T00:00:02.000Z',
        revision: 3,
        latestTurn: {
          turnId: 'turn_review',
          state: 'running',
          summary: longSummary,
          summaryTruncated: false,
          recentActivity: Array.from({ length: 40 }, (_, index) => ({
            sequence: index + 1,
            kind: 'status' as const,
            summary: `activity ${index + 1}`,
            createdAt: '2026-07-27T00:00:02.000Z',
          })),
        },
      },
      {
        path: '/root',
        taskName: 'root',
        kind: 'native',
        state: 'running',
        capabilities: {
          tools: [],
          filesystem: 'write',
          network: true,
          providers: [],
          canAskUser: true,
        },
        turnIds: [],
        mailboxCursor: 0,
        createdAt: '2026-07-27T00:00:00.000Z',
        updatedAt: '2026-07-27T00:00:02.000Z',
        revision: 2,
      },
    ],
  } satisfies AgentTreeSnapshot;

  const snapshot = projectRuntimeActorTreeSnapshot('rt_1', 's_1', tree, 41);

  assert.equal(snapshot.actors[0]?.path, '/root');
  assert.equal(snapshot.actors[1]?.path, '/root/reviewer');
  assert.equal(snapshot.actors[1]?.latestTurn?.recentActivity.length, 32);
  assert.equal(snapshot.actors[1]?.latestTurn?.recentActivity[0]?.sequence, 9);
  assert.equal(snapshot.actors[1]?.latestTurn?.summary.length, 4_096);
  assert.equal(snapshot.actors[1]?.latestTurn?.summaryTruncated, true);
  assert.equal(snapshot.eventCursor, 41);
});

test('Runtime Actor tree projection retains newest active Agents after the IPC cap', () => {
  const historicalActors: AgentTreeSnapshot['actors'] = Array.from({ length: 300 }, (_, index) => {
    const isNewestActive = index === 299;
    const turnId = `turn_${index}`;
    const updatedAt = new Date(Date.UTC(2026, 6, 27, 0, 0, index)).toISOString();
    return {
      path: `/root/agent-${index}`,
      taskName: `agent-${index}`,
      parentPath: '/root',
      kind: 'native',
      state: isNewestActive ? 'running' : 'idle',
      capabilities: {
        tools: [],
        filesystem: 'read',
        network: false,
        providers: [],
        canAskUser: false,
      },
      turnIds: [turnId],
      ...(isNewestActive ? { currentTurnId: turnId } : {}),
      mailboxCursor: 0,
      createdAt: '2026-07-27T00:00:00.000Z',
      updatedAt,
      revision: index + 1,
      latestTurn: {
        turnId,
        state: isNewestActive ? 'running' : 'completed',
        summary: isNewestActive ? 'Still reviewing' : 'Done',
        summaryTruncated: false,
        recentActivity: [],
      },
    };
  });
  const tree: AgentTreeSnapshot = {
    rootPath: '/root',
    revision: 301,
    activeNonRootTurns: 1,
    maxConcurrentThreads: 4,
    actors: [
      {
        path: '/root',
        taskName: 'root',
        kind: 'native',
        state: 'running',
        capabilities: {
          tools: [],
          filesystem: 'write',
          network: true,
          providers: [],
          canAskUser: true,
        },
        turnIds: [],
        mailboxCursor: 0,
        createdAt: '2026-07-27T00:00:00.000Z',
        updatedAt: '2026-07-27T00:05:00.000Z',
        revision: 1,
      },
      ...historicalActors,
    ],
  };

  const snapshot = projectRuntimeActorTreeSnapshot('rt_1', 's_1', tree, 301);

  assert.equal(snapshot.actors.length, 256);
  assert.equal(snapshot.actors[0]?.path, '/root');
  assert.equal(snapshot.actors[1]?.path, '/root/agent-299');
  assert.equal(snapshot.actors[1]?.currentTurnId, 'turn_299');
  assert.equal(
    snapshot.actors.some((actor) => actor.path === '/root/agent-0'),
    false,
  );
});
