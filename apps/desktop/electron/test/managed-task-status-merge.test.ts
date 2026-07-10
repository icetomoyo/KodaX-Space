import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeManagedTaskStatus } from '../../renderer/src/lib/managedTaskStatusMerge.js';
import { buildAgentStatuses } from '../../renderer/src/shell/agentStatusProjection.js';

type Status = Parameters<typeof mergeManagedTaskStatus>[1];

function makeStatus(overrides: Partial<Status> = {}): Status {
  return {
    agentMode: 'ama',
    harnessProfile: 'H2_PLAN_EXECUTE_EVAL',
    ...overrides,
  };
}

test('mergeManagedTaskStatus keeps completed workers from earlier snapshots', () => {
  const first = makeStatus({
    activeWorkerId: 'agent',
    activeWorkerTitle: 'agent',
    events: [
      {
        key: 'agent-done',
        kind: 'completed',
        workerId: 'agent',
        workerTitle: 'agent',
        summary: 'packages/agent review complete',
      },
      {
        key: 'repl-done',
        kind: 'completed',
        workerId: 'repl',
        workerTitle: 'repl',
        summary: 'packages/repl review complete',
      },
    ],
  });
  const latest = makeStatus({
    activeWorkerId: 'coding',
    activeWorkerTitle: 'coding',
    events: [
      {
        key: 'coding-progress',
        kind: 'progress',
        workerId: 'coding',
        workerTitle: 'coding',
        phase: 'source_review',
        summary: 'Reviewing agent-runtime and extensions',
      },
    ],
  });

  const merged = mergeManagedTaskStatus(first, latest);
  const statuses = buildAgentStatuses(merged);

  assert.equal(statuses.length, 3);
  assert.equal(statuses.filter((agent) => agent.state === 'completed').length, 2);
  assert.equal(statuses.filter((agent) => agent.state === 'active').length, 1);
  assert.equal(statuses[0].title, 'coding');
});
