import assert from 'node:assert/strict';
import { test } from 'node:test';
import { listExternalAgentTasksForIpc } from '../ipc/agent.js';
import { externalAgentGateway } from '../kodax/external-agent-gateway.js';
import { kodaxHost } from '../kodax/host.js';
import { runtimeHostAdapter } from '../kodax/runtime-host-adapter.js';

test('agent.external.task.list returns an empty list for a persisted-only Session with no tasks', async (t) => {
  t.mock.method(kodaxHost, 'get', () => undefined);
  const hasSession = t.mock.method(kodaxHost, 'hasSession', async () => true);
  const listTasks = t.mock.method(externalAgentGateway, 'listTasks', async () => []);
  t.mock.method(runtimeHostAdapter, 'isRuntimeSelected', () => false);

  const result = await listExternalAgentTasksForIpc({
    sessionId: 's_persisted_without_external_tasks',
  });

  assert.deepEqual(result, { tasks: [] });
  assert.equal(hasSession.mock.callCount(), 1);
  assert.deepEqual(listTasks.mock.calls[0]?.arguments, [
    { parentTaskId: 's_persisted_without_external_tasks' },
  ]);
});

test('agent.external.task.list returns an empty list without reading tasks for an unknown Session', async (t) => {
  t.mock.method(kodaxHost, 'get', () => undefined);
  t.mock.method(kodaxHost, 'hasSession', async () => false);
  const listTasks = t.mock.method(externalAgentGateway, 'listTasks', async () => []);

  const result = await listExternalAgentTasksForIpc({ sessionId: 's_unknown' });

  assert.deepEqual(result, { tasks: [] });
  assert.equal(listTasks.mock.callCount(), 0);
});

test('agent.external.task.list preserves real task-store failures', async (t) => {
  t.mock.method(kodaxHost, 'get', () => undefined);
  t.mock.method(kodaxHost, 'hasSession', async () => true);
  t.mock.method(externalAgentGateway, 'listTasks', async () => {
    throw new Error('task store unavailable');
  });
  t.mock.method(runtimeHostAdapter, 'isRuntimeSelected', () => false);

  await assert.rejects(
    listExternalAgentTasksForIpc({ sessionId: 's_persisted_with_store_failure' }),
    /task store unavailable/,
  );
});
