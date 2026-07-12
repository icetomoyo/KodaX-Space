import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  currentSessionRunContext,
  resolveSessionRunContext,
  withSessionRunContext,
} from '../kodax/session-run-context.js';

test('resolveSessionRunContext preserves SDK toolCallId and taskSurface', () => {
  const resolved = resolveSessionRunContext({
    sessionId: 's-context',
    toolCallId: 'tool-123',
    taskSurface: 'repl',
    executionCwd: 'C:\\workspace',
    agentProfile: { surface: 'partner' },
  });

  assert.deepEqual(resolved, {
    sessionId: 's-context',
    surface: 'partner',
    projectRoot: 'C:\\workspace',
    toolCallId: 'tool-123',
    taskSurface: 'repl',
  });
});

test('ALS identity remains authoritative while SDK call metadata is merged', async () => {
  const resolved = await withSessionRunContext(
    { sessionId: 's-als', surface: 'code', projectRoot: '/workspace' },
    async () => {
      assert.deepEqual(currentSessionRunContext(), {
        sessionId: 's-als',
        surface: 'code',
        projectRoot: '/workspace',
      });
      return resolveSessionRunContext({
        sessionId: 's-als',
        toolCallId: 'tool-als',
        taskSurface: 'plan',
        executionCwd: '/workspace/subdir',
        agentProfile: { surface: 'code' },
      });
    },
  );

  assert.deepEqual(resolved, {
    sessionId: 's-als',
    surface: 'code',
    projectRoot: '/workspace',
    toolCallId: 'tool-als',
    taskSurface: 'plan',
  });
});

test('resolveSessionRunContext fails closed on SDK/ALS session or surface mismatch', async () => {
  await withSessionRunContext(
    { sessionId: 's-als', surface: 'partner', projectRoot: '/workspace' },
    async () => {
      assert.equal(
        resolveSessionRunContext({
          sessionId: 's-other',
          toolCallId: 'tool-wrong-session',
          taskSurface: 'repl',
          executionCwd: '/workspace',
          agentProfile: { surface: 'partner' },
        }),
        undefined,
      );
      assert.equal(
        resolveSessionRunContext({
          sessionId: 's-als',
          toolCallId: 'tool-wrong-surface',
          taskSurface: 'repl',
          executionCwd: '/workspace',
          agentProfile: { surface: 'code' },
        }),
        undefined,
      );
    },
  );
});

test('runtime taskSurface is preserved independently from the Space product surface', () => {
  assert.deepEqual(
    resolveSessionRunContext({
      sessionId: 's-context',
      toolCallId: 'tool-plan',
      taskSurface: 'plan',
      executionCwd: '/workspace',
      agentProfile: { surface: 'partner' },
    }),
    {
      sessionId: 's-context',
      surface: 'partner',
      projectRoot: '/workspace',
      toolCallId: 'tool-plan',
      taskSurface: 'plan',
    },
  );
});

test('Space permission mode remains authoritative alongside SDK taskSurface', async () => {
  await withSessionRunContext(
    {
      sessionId: 's-plan',
      surface: 'code',
      projectRoot: 'C:\\repo',
      permissionMode: 'plan',
    },
    async () => {
      const resolved = resolveSessionRunContext({
        sessionId: 's-plan',
        taskSurface: 'repl',
        executionCwd: 'C:\\repo',
        agentProfile: { surface: 'code' },
      });
      assert.equal(resolved?.permissionMode, 'plan');
      assert.equal(resolved?.taskSurface, 'repl');
    },
  );
});

test('resolveSessionRunContext rejects unsupported task surfaces', () => {
  assert.equal(
    resolveSessionRunContext({
      sessionId: 's-context',
      toolCallId: 'tool-unsupported',
      taskSurface: 'review' as unknown as 'repl',
      executionCwd: '/workspace',
    }),
    undefined,
  );
});
