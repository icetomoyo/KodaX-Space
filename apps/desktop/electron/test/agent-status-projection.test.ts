import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildAgentStatuses } from '../../renderer/src/shell/agentStatusProjection.js';
import { messages, type MessageKey } from '../../renderer/src/i18n/messages.js';

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
