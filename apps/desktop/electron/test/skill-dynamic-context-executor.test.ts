import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AutoModeToolGuardrail } from '@kodax-ai/kodax/coding';
import {
  createAutoSkillDynamicContextAuthorizer,
  createSkillDynamicContextExecutor,
} from '../skill/dynamic-context-executor.js';

test('Auto Skill authorization preserves run intent and transcript constraints', async () => {
  const permissionIntent = {
    rootUserIntent: 'Review only. Do not execute shell and do not read secrets.',
    bindingConstraints: ['do not execute shell', 'do not read secrets'],
    readOnly: true,
  } as const;
  const messages = [
    { role: 'user' as const, content: permissionIntent.rootUserIntent },
    { role: 'assistant' as const, content: 'I will inspect the change.' },
  ];
  const capturedContexts: Array<Parameters<NonNullable<AutoModeToolGuardrail['beforeTool']>>[1]> =
    [];
  const guardrail = {
    kind: 'tool',
    beforeTool: async (_call, context) => {
      capturedContexts.push(context);
      return { action: 'allow' as const };
    },
  } as AutoModeToolGuardrail;
  const authorize = createAutoSkillDynamicContextAuthorizer({
    guardrail,
    context: {
      agent: { name: 'test-skill', instructions: '' } as never,
      messages,
      permissionIntent,
    },
  });

  assert.equal(await authorize('echo hidden-skill-command', process.cwd(), 'skill-tool-id'), true);
  assert.equal(capturedContexts.length, 1);
  const capturedContext = capturedContexts[0];
  assert.ok(capturedContext);
  assert.strictEqual(capturedContext.permissionIntent, permissionIntent);
  assert.strictEqual(capturedContext.messages, messages);
});

test('Partner dynamic context is disabled before authorization or process spawn', async () => {
  let authorizeCalls = 0;
  const execute = createSkillDynamicContextExecutor({
    sessionId: 'partner-skill',
    permissionMode: 'auto',
    surface: 'partner',
    authorize: async () => {
      authorizeCalls += 1;
      return true;
    },
  });

  await assert.rejects(execute('command-that-must-never-run', process.cwd()), /disabled.*Partner/i);
  assert.equal(authorizeCalls, 0);
});

test('Coder dynamic context uses the run-owned authorizer before process spawn', async () => {
  const calls: Array<{ command: string; cwd: string; toolId: string }> = [];
  const execute = createSkillDynamicContextExecutor({
    sessionId: 'coder-skill',
    permissionMode: 'auto',
    surface: 'code',
    authorize: async (command, cwd, toolId) => {
      calls.push({ command, cwd, toolId });
      return false;
    },
  });
  const cwd = process.cwd();

  await assert.rejects(execute('command-that-must-never-run', cwd), /denied by Auto guardrail/i);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.command, 'command-that-must-never-run');
  assert.equal(calls[0]?.cwd, cwd);
  assert.match(calls[0]?.toolId ?? '', /^[0-9a-f-]{36}$/i);
});
