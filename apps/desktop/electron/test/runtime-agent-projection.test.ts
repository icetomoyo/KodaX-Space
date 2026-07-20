import assert from 'node:assert/strict';
import test from 'node:test';

import type { AgentDetail, AgentEvent, AgentOutput } from '@kodax-ai/kodax/agent';
import {
  decodeRuntimeActorTaskId,
  encodeRuntimeActorTaskId,
  isRuntimeActorTaskId,
  projectRuntimeActorEvent,
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
