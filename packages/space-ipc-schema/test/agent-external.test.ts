import assert from 'node:assert/strict';
import test from 'node:test';

import { invokeChannels } from '../src/channels/index.js';

test('KodaX 0.7.67 external-agent channels are registered', () => {
  for (const name of [
    'agent.external.status',
    'agent.external.registration.list',
    'agent.external.reference.upsert',
    'agent.external.registration.remove',
    'agent.external.dispatchable.list',
    'agent.external.preflight',
    'agent.external.task.list',
    'agent.external.task.start',
    'agent.external.task.events',
    'agent.external.task.sendInput',
    'agent.external.task.cancel',
    'agent.external.task.reconcile',
  ] as const) {
    assert.ok(invokeChannels[name]);
  }
});

test('external-agent registration summary is redacted and bounded', () => {
  const parsed = invokeChannels['agent.external.registration.list'].output.parse({
    registrations: [
      {
        agentId: 'external:opaque-id',
        displayName: 'Reference Reviewer',
        enabled: true,
        adapterKind: 'reference',
        configurationRevision: 'rev-1',
        credentialConfigured: false,
        skills: ['code-review'],
        inputRequired: false,
        capabilities: {
          streaming: 'supported',
          durableTasks: 'supported',
          inputRequired: 'conditional',
          cancellation: 'supported',
          artifacts: 'unsupported',
        },
        effects: { remote: 'none', workspace: 'none' },
        diagnostics: [],
      },
    ],
  });
  assert.equal(parsed.registrations[0]?.agentId, 'external:opaque-id');
  assert.equal('credentialRef' in parsed.registrations[0]!, false);
  assert.equal('executorConfig' in parsed.registrations[0]!, false);
});

test('external-agent task projection keeps lifecycle and audit metadata bounded', () => {
  invokeChannels['agent.external.task.list'].input.parse({ sessionId: 'session-1' });
  assert.throws(() => invokeChannels['agent.external.task.list'].input.parse({}));
  const parsed = invokeChannels['agent.external.task.list'].output.parse({
    tasks: [
      {
        taskId: 'task-1',
        agentId: 'external:opaque-id',
        objective: 'Review the change',
        state: 'input-required',
        cancellation: 'none',
        route: 'external',
        protocol: 'http',
        configurationRevision: 'rev-1',
        parentTaskId: 'session-1',
        createdAt: new Date(0).toISOString(),
        updatedAt: new Date(0).toISOString(),
        progress: { message: 'Waiting for approval', percent: 50 },
        artifacts: [{ name: 'report.md', mimeType: 'text/markdown', hash: 'sha256:x' }],
        usage: { totalTokens: 42 },
      },
    ],
  });
  assert.equal(parsed.tasks[0]?.state, 'input-required');
  assert.equal(parsed.tasks[0]?.artifacts?.[0]?.name, 'report.md');
  assert.equal('credentialRef' in parsed.tasks[0]!, false);
  assert.equal('executorReference' in parsed.tasks[0]!, false);
});

test('external-agent preflight and task event channels validate lifecycle payloads', () => {
  invokeChannels['agent.external.task.events'].input.parse({
    sessionId: 'session-1',
    taskId: 'task-1',
    cursor: 0,
  });
  const preflight = invokeChannels['agent.external.preflight'].output.parse({
    ok: false,
    dispatchability: {
      status: 'unavailable',
      checkedAt: new Date(0).toISOString(),
      reasons: ['disabled'],
    },
    reasons: ['disabled'],
  });
  assert.equal(preflight.ok, false);

  const events = invokeChannels['agent.external.task.events'].output.parse({
    events: [
      {
        taskId: 'task-1',
        seq: 1,
        timestamp: new Date(0).toISOString(),
        type: 'state',
        state: 'working',
      },
    ],
    nextCursor: 1,
  });
  assert.equal(events.nextCursor, 1);
});

test('external-agent status does not inflate unshipped protocol adapters', () => {
  const parsed = invokeChannels['agent.external.status'].output.parse({
    sdkVersion: '0.7.67',
    enabled: true,
    referenceExecutor: true,
    adapters: { a2a: false, mcpTasks: false, governedHttp: false },
    registrationCount: 1,
    taskCount: 2,
  });
  assert.deepEqual(parsed.adapters, { a2a: false, mcpTasks: false, governedHttp: false });
});
