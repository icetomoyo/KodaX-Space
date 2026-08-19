import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildExternalAgentTasksView } from './externalAgentTasksView.js';

test('external Agent task list projects loading, empty, tasks, and error as distinct states', () => {
  assert.deepEqual(buildExternalAgentTasksView('loading', 0), {
    kind: 'loading',
    showCount: false,
    showTasks: false,
  });
  assert.deepEqual(buildExternalAgentTasksView('ready', 0), {
    kind: 'empty',
    showCount: true,
    showTasks: false,
  });
  assert.deepEqual(buildExternalAgentTasksView('ready', 2), {
    kind: 'tasks',
    showCount: true,
    showTasks: true,
  });
  assert.deepEqual(buildExternalAgentTasksView('loading', 2), {
    kind: 'tasks',
    showCount: true,
    showTasks: true,
  });
  assert.deepEqual(buildExternalAgentTasksView('error', 0), {
    kind: 'error',
    showCount: false,
    showTasks: false,
  });
  assert.deepEqual(buildExternalAgentTasksView('error', 2), {
    kind: 'error',
    showCount: false,
    showTasks: true,
  });
});
