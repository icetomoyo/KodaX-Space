import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { AutoModeToolGuardrail } from '@kodax-ai/kodax/coding';
import {
  createAutoSkillDynamicContextAuthorizer,
  createSkillDynamicContextExecutor,
  terminateDynamicContextProcessTree,
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

test('admission abort terminates a running dynamic-context process promptly', async () => {
  const abort = new AbortController();
  const execute = createSkillDynamicContextExecutor({
    sessionId: 'coder-skill-abort',
    permissionMode: 'auto',
    surface: 'code',
    signal: abort.signal,
    authorize: async () => true,
  });
  const command = `${JSON.stringify(process.execPath)} -e "setTimeout(() => {}, 30000)"`;
  const startedAt = Date.now();
  const execution = execute(command, process.cwd());
  setTimeout(() => abort.abort(), 50);

  await assert.rejects(execution, /cancelled before admission/i);
  assert.ok(Date.now() - startedAt < 2_000, 'abort must not wait for the 30 second timeout');
});

test(
  'admission abort waits for Windows dynamic-context descendants to terminate',
  { skip: process.platform !== 'win32' },
  async (t) => {
    const fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'space-skill-abort-win-tree-'));
    t.after(() => fs.rm(fixtureRoot, { recursive: true, force: true }));
    const parentFactPath = path.join(fixtureRoot, 'parent.json');
    const grandchildFactPath = path.join(fixtureRoot, 'grandchild.json');
    const grandchild = path.join(fixtureRoot, 'grandchild.cjs');
    const parent = path.join(fixtureRoot, 'parent.cjs');
    await fs.writeFile(
      grandchild,
      `require('node:fs').writeFileSync(${JSON.stringify(grandchildFactPath)}, JSON.stringify({ pid: process.pid, ppid: process.ppid }));\nsetInterval(() => {}, 1000);\n`,
    );
    await fs.writeFile(
      parent,
      `require('node:fs').writeFileSync(${JSON.stringify(parentFactPath)}, JSON.stringify({ pid: process.pid, ppid: process.ppid }));\nrequire('node:child_process').spawn(process.execPath, [${JSON.stringify(grandchild)}], { stdio: 'ignore' });\nsetInterval(() => {}, 1000);\n`,
    );
    const abort = new AbortController();
    const execute = createSkillDynamicContextExecutor({
      sessionId: 'coder-skill-abort-win-tree',
      permissionMode: 'auto',
      surface: 'code',
      signal: abort.signal,
      authorize: async () => true,
    });
    const execution = execute(
      `${JSON.stringify(process.execPath)} ${JSON.stringify(parent)}`,
      fixtureRoot,
    );
    const readyDeadline = Date.now() + 2_000;
    while (true) {
      try {
        await fs.access(grandchildFactPath);
        break;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        assert.ok(Date.now() < readyDeadline, 'grandchild must start before cancellation');
        await new Promise<void>((resolve) => setTimeout(resolve, 10));
      }
    }
    abort.abort();

    await assert.rejects(execution, /cancelled before admission/i);
    const parentFact = JSON.parse(await fs.readFile(parentFactPath, 'utf8')) as {
      pid: number;
      ppid: number;
    };
    const grandchildFact = JSON.parse(await fs.readFile(grandchildFactPath, 'utf8')) as {
      pid: number;
      ppid: number;
    };
    const isAlive = (pid: number): boolean => {
      try {
        process.kill(pid, 0);
        return true;
      } catch {
        return false;
      }
    };
    assert.equal(grandchildFact.ppid, parentFact.pid, 'fixture must create a real descendant');
    assert.equal(isAlive(parentFact.pid), false, 'parent must exit before cancellation settles');
    assert.equal(
      isAlive(grandchildFact.pid),
      false,
      'grandchild must exit before cancellation settles',
    );
  },
);

test(
  'Windows process-tree termination fails explicitly when taskkill cannot prove success',
  { skip: process.platform !== 'win32' },
  async () => {
    await assert.rejects(
      terminateDynamicContextProcessTree({
        pid: 2_147_483_647,
        kill: () => false,
      }),
      /taskkill exit/i,
    );
  },
);

test(
  'admission abort terminates POSIX dynamic-context descendants',
  { skip: process.platform === 'win32' },
  async (t) => {
    const fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'space-skill-abort-tree-'));
    t.after(() => fs.rm(fixtureRoot, { recursive: true, force: true }));
    const marker = path.join(fixtureRoot, 'grandchild-survived.txt');
    const grandchild = path.join(fixtureRoot, 'grandchild.cjs');
    const parent = path.join(fixtureRoot, 'parent.cjs');
    await fs.writeFile(
      grandchild,
      `setTimeout(() => require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'alive'), 350);\nsetInterval(() => {}, 1000);\n`,
    );
    await fs.writeFile(
      parent,
      `require('node:child_process').spawn(process.execPath, [${JSON.stringify(grandchild)}], { stdio: 'ignore' });\nsetInterval(() => {}, 1000);\n`,
    );
    const abort = new AbortController();
    const execute = createSkillDynamicContextExecutor({
      sessionId: 'coder-skill-abort-tree',
      permissionMode: 'auto',
      surface: 'code',
      signal: abort.signal,
      authorize: async () => true,
    });
    const execution = execute(
      `${JSON.stringify(process.execPath)} ${JSON.stringify(parent)}`,
      fixtureRoot,
    );
    setTimeout(() => abort.abort(), 75);

    await assert.rejects(execution, /cancelled before admission/i);
    await new Promise<void>((resolve) => setTimeout(resolve, 500));
    await assert.rejects(fs.access(marker), /ENOENT/);
  },
);
