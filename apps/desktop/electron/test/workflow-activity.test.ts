// F065 — 子 agent 活动路由纯逻辑：correlation 检测 + payload 构造。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  childRunId,
  buildChildActivity,
  buildWorkflowDigestActivity,
  isTransientChildEvent,
} from '../kodax/workflow-activity.js';

test('childRunId: 带 workflowRunId 的 meta 识别为子事件；否则 undefined', () => {
  assert.equal(childRunId({ workflowCorrelation: { workflowRunId: 'wf_1' } }), 'wf_1');
  assert.equal(childRunId({ workflowCorrelation: {} }), undefined);
  assert.equal(childRunId({}), undefined);
  assert.equal(childRunId(undefined), undefined);
  assert.equal(childRunId({ workflowCorrelation: { workflowRunId: '' } }), undefined); // 空串不算
});

test('isTransientChildEvent: recognizes every child ownership signal without hiding root events', () => {
  assert.equal(isTransientChildEvent(undefined), false);
  assert.equal(isTransientChildEvent({}), false);
  assert.equal(isTransientChildEvent({ contextKind: 'root' }), false);

  assert.equal(isTransientChildEvent({ contextKind: 'child' }), true);
  assert.equal(isTransientChildEvent({ liveOnly: true }), false);
  assert.equal(isTransientChildEvent({ childAgentId: 'child_1' }), true);
  assert.equal(
    isTransientChildEvent({ workflowCorrelation: { workflowRunId: 'workflow_1' } }),
    true,
  );
  assert.equal(isTransientChildEvent({ workflowCorrelation: { childAgentId: 'child_2' } }), true);
});

test('buildChildActivity: 子事件构造完整 payload（含 childAgentId/Name/toolName）', () => {
  const p = buildChildActivity(
    {
      workflowCorrelation: { workflowRunId: 'wf_1', childAgentId: 'c1' },
      childAgentName: 'finder:bugs',
    },
    'tool_use',
    { toolName: 'grep' },
  );
  assert.deepEqual(p, {
    runId: 'wf_1',
    childAgentId: 'c1',
    childAgentName: 'finder:bugs',
    kind: 'tool_use',
    toolName: 'grep',
  });
});

test('buildChildActivity: 非子事件返回 null（main agent 事件不路由）', () => {
  assert.equal(buildChildActivity({}, 'tool_use', { toolName: 'grep' }), null);
  assert.equal(buildChildActivity(undefined, 'end', {}), null);
});

test('buildChildActivity: childAgentId 回退到 correlation.childAgentId；end 无 toolName', () => {
  const p = buildChildActivity({ workflowCorrelation: { workflowRunId: 'wf_2', childAgentId: 'c9' } }, 'end', {});
  assert.equal(p?.runId, 'wf_2');
  assert.equal(p?.childAgentId, 'c9');
  assert.equal(p?.kind, 'end');
  assert.equal(p?.toolName, undefined);
});

test('buildWorkflowDigestActivity: agent_completed summary becomes digest activity', () => {
  const p = buildWorkflowDigestActivity({
    runId: 'wf_3',
    event: {
      seq: 1,
      type: 'agent_completed',
      data: {
        taskId: 'task_1',
        name: 'Reviewer',
        status: 'completed',
        summary: 'Found two risks.',
        summaryKind: 'digest',
      },
    },
  });
  assert.deepEqual(p, {
    runId: 'wf_3',
    childAgentId: 'task_1',
    childAgentName: 'Reviewer',
    kind: 'digest',
    summary: 'Found two risks.',
    summaryKind: 'digest',
  });
});

test('buildWorkflowDigestActivity: filters pending, empty, and non-completed completion events', () => {
  assert.equal(
    buildWorkflowDigestActivity({
      runId: 'wf_4',
      event: {
        seq: 1,
        type: 'agent_summary_updated',
        data: { taskId: 'task_1', summary: 'still running', summaryKind: 'pending' },
      },
    }),
    null,
  );
  assert.equal(
    buildWorkflowDigestActivity({
      runId: 'wf_4',
      event: { seq: 2, type: 'agent_failed', data: { taskId: 'task_1' } },
    }),
    null,
  );
  assert.equal(
    buildWorkflowDigestActivity({
      runId: 'wf_4',
      event: {
        seq: 3,
        type: 'agent_completed',
        data: { taskId: 'task_1', status: 'completed_unverified', summary: 'maybe' },
      },
    }),
    null,
  );
});

test('buildWorkflowDigestActivity: preserves verification even when digest is pending', () => {
  const p = buildWorkflowDigestActivity({
    runId: 'wf_5',
    event: {
      seq: 1,
      type: 'agent_completed',
      data: {
        taskId: 'task_verify',
        name: 'Writer',
        status: 'completed',
        summaryKind: 'pending',
        verification: {
          ok: false,
          enforcement: 'warn',
          reasons: ['expected file mutations'],
          changedPaths: ['src/app.ts'],
          mutationToolCalls: ['write'],
          mutationEvidence: true,
        },
      },
    },
  });
  assert.deepEqual(p, {
    runId: 'wf_5',
    childAgentId: 'task_verify',
    childAgentName: 'Writer',
    kind: 'digest',
    verification: {
      ok: false,
      enforcement: 'warn',
      reasons: ['expected file mutations'],
      changedPaths: ['src/app.ts'],
      mutationToolCalls: ['write'],
      mutationEvidence: true,
    },
  });
});
