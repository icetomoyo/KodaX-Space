import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { ExternalAgentGateway } from '../kodax/external-agent-gateway.js';

test('external-agent gateway persists the reference catalog and task ledger', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'kodax-space-external-agent-'));
  const gateway = new ExternalAgentGateway(root);
  try {
    const registration = await gateway.upsertReference({
      displayName: 'Reference Reviewer',
      description: 'Published KodaX 0.7.85 conformance target',
      enabled: true,
      skills: ['code-review'],
      inputRequired: false,
    });
    assert.equal(registration.adapterKind, 'reference');
    assert.equal(registration.credentialConfigured, false);
    assert.deepEqual(registration.skills, ['code-review']);

    const dispatchable = await gateway.listDispatchable({
      projectRoot: root,
      readOnly: true,
    });
    assert.equal(dispatchable.length, 1);
    assert.equal(dispatchable[0]?.descriptor.agentId, registration.agentId);
    assert.equal(dispatchable[0]?.dispatchability.status, 'dispatchable');

    const preflight = await gateway.preflight({
      agentId: registration.agentId,
      projectRoot: root,
      readOnly: true,
      expectedConfigurationRevision: registration.configurationRevision,
    });
    assert.equal(preflight.ok, true);

    const started = await gateway.startTask({
      agentId: registration.agentId,
      objective: 'return this objective',
      projectRoot: root,
      parentTaskId: 'session-test',
      readOnly: true,
      expectedConfigurationRevision: registration.configurationRevision,
    });
    assert.equal(started.parentTaskId, 'session-test');
    await gateway.assertTaskParent(started.taskId, 'session-test');
    await assert.rejects(
      gateway.assertTaskParent(started.taskId, 'session-other'),
      /does not belong to the selected session/,
    );
    const binding = await gateway.getBinding({ actorId: 'space:test' });
    assert.ok(binding);
    const terminal = await binding.plane.tasks.wait(started.taskId, 2_000);
    assert.equal(terminal.state, 'completed');
    assert.equal(terminal.output, 'return this objective');
    assert.equal(
      (await gateway.listTasks({ parentTaskId: 'session-test' }))[0]?.taskId,
      started.taskId,
    );
    const events = await gateway.taskEvents(started.taskId, 0);
    assert.ok(events.events.length >= 2);
    assert.ok(events.nextCursor >= events.events.length);
    assert.equal(events.events.at(-1)?.type, 'state');
    assert.equal(events.events.at(-1)?.state, 'completed');
  } finally {
    await gateway.dispose();
  }

  const reloaded = new ExternalAgentGateway(root);
  try {
    const status = await reloaded.status();
    assert.equal(status.sdkVersion, '0.7.85');
    assert.equal(status.enabled, true);
    assert.equal(status.referenceExecutor, true);
    assert.deepEqual(status.adapters, { a2a: false, mcpTasks: false, governedHttp: false });
    assert.equal(status.registrationCount, 1);
    assert.equal(status.taskCount, 1);
  } finally {
    await reloaded.dispose();
    await rm(root, { recursive: true, force: true });
  }
});

test('external-agent gateway preserves an admitted route after registration removal', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'kodax-space-external-route-'));
  const gateway = new ExternalAgentGateway(root);
  try {
    const registration = await gateway.upsertReference({
      displayName: 'Durable Reference',
      enabled: true,
      skills: ['durable-route'],
      inputRequired: true,
    });
    const started = await gateway.startTask({
      agentId: registration.agentId,
      objective: 'resume after registration removal',
      readOnly: true,
      expectedConfigurationRevision: registration.configurationRevision,
    });
    assert.equal(started.state, 'input-required');
    assert.equal(await gateway.remove(registration.agentId), true);
    const resumed = await gateway.sendTaskInput(started.taskId, 'durable response');
    assert.equal(resumed.taskId, started.taskId);
    const binding = await gateway.getBinding({ actorId: 'space:test' });
    assert.ok(binding);
    const terminal = await binding.plane.tasks.wait(started.taskId, 2_000);
    assert.equal(terminal.state, 'completed');
    assert.equal(terminal.output, 'durable response');
  } finally {
    await gateway.dispose();
    await rm(root, { recursive: true, force: true });
  }
});

test('external-agent event pagination advances only through the returned page', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'kodax-space-external-events-'));
  const gateway = new ExternalAgentGateway(root);
  try {
    const binding = await gateway.getBinding({ actorId: 'space:test' });
    assert.ok(binding);
    const taskId = 'local-event-storm';
    await binding.plane.tasks.recordLocal({
      taskId,
      agentId: 'native:test',
      objective: 'event pagination',
      configurationRevision: 'test-v1',
      parentTaskId: 'session-events',
    });
    for (let index = 0; index < 520; index += 1) {
      await binding.plane.tasks.updateLocal(taskId, {
        progress: { message: `event-${index}` },
      });
    }

    const first = await gateway.taskEvents(taskId, 0);
    assert.equal(first.events.length, 512);
    assert.equal(first.nextCursor, first.events.at(-1)?.seq);
    const second = await gateway.taskEvents(taskId, first.nextCursor);
    assert.ok(second.events.length > 0);
    assert.equal(second.events[0]?.seq, first.nextCursor + 1);
  } finally {
    await gateway.dispose();
    await rm(root, { recursive: true, force: true });
  }
});

test('Reference Agent edits require a host-issued existing registration identity', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'kodax-space-external-identity-'));
  const gateway = new ExternalAgentGateway(root);
  try {
    await assert.rejects(
      gateway.upsertReference({
        agentId: 'external:renderer-invented',
        displayName: 'Invented identity',
        enabled: true,
        skills: ['general'],
        inputRequired: false,
      }),
      /host-issued registration/,
    );
  } finally {
    await gateway.dispose();
    await rm(root, { recursive: true, force: true });
  }
});

test('external-agent gateway keeps input-required on the same durable task identity', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'kodax-space-external-input-'));
  const gateway = new ExternalAgentGateway(root);
  try {
    const registration = await gateway.upsertReference({
      displayName: 'Interactive Reference',
      enabled: true,
      skills: ['interactive'],
      inputRequired: true,
    });
    const started = await gateway.startTask({
      agentId: registration.agentId,
      objective: 'ask first',
      readOnly: true,
      expectedConfigurationRevision: registration.configurationRevision,
    });
    assert.equal(started.state, 'input-required');
    const resumed = await gateway.sendTaskInput(started.taskId, 'approved');
    assert.equal(resumed.taskId, started.taskId);
    const binding = await gateway.getBinding({ actorId: 'space:test' });
    assert.ok(binding);
    const terminal = await binding.plane.tasks.wait(started.taskId, 2_000);
    assert.equal(terminal.state, 'completed');
    assert.equal(terminal.output, 'approved');
    const events = await gateway.taskEvents(started.taskId, 0);
    assert.equal(events.events.at(-1)?.state, 'completed');
  } finally {
    await gateway.dispose();
    await rm(root, { recursive: true, force: true });
  }
});

test('external-agent gateway exposes cancel and reconcile without changing task identity', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'kodax-space-external-control-'));
  const gateway = new ExternalAgentGateway(root);
  try {
    const registration = await gateway.upsertReference({
      displayName: 'Controllable Reference',
      enabled: true,
      skills: ['control'],
      inputRequired: true,
    });
    const started = await gateway.startTask({
      agentId: registration.agentId,
      objective: 'wait for control',
      readOnly: true,
      expectedConfigurationRevision: registration.configurationRevision,
    });
    const reconciled = await gateway.reconcileTask(started.taskId);
    assert.equal(reconciled.taskId, started.taskId);
    const canceled = await gateway.cancelTask(started.taskId, 'test complete');
    assert.equal(canceled.taskId, started.taskId);
    assert.equal(canceled.state, 'canceled');
    assert.equal(canceled.cancellation, 'confirmed');
  } finally {
    await gateway.dispose();
    await rm(root, { recursive: true, force: true });
  }
});
