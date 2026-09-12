import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createKodaXRuntime } from '@kodax-ai/kodax/runtime';
import {
  registerTool,
  createExtensionRuntime,
  getActiveExtensionRuntime,
  setActiveExtensionRuntime,
} from '@kodax-ai/kodax/coding';

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'space-sdk-control-'));
  const workspace = path.join(root, 'workspace');
  await mkdir(workspace);
  const runtime = await createKodaXRuntime({
    homeDir: path.join(root, 'home'),
    sessionsDir: path.join(root, 'sessions'),
    defaultProvider: 'anthropic',
  });
  t.after(async () => {
    await runtime.close();
    assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('space-sdk-control-'));
    await rm(root, { recursive: true, force: true, maxRetries: 3 });
  });
  const session = await runtime.sessions.create({ projectPath: workspace });
  await runtime.sessions.updateSettings(session.id, { permissionMode: 'full-access' });
  return { runtime, sessionId: session.id, workspace };
}

test(
  'published owner cancels its queue frontier; replay does not cancel a later Run',
  { timeout: 20_000 },
  async (t) => {
    const { runtime, sessionId, workspace } = await fixture(t);
    assert.equal(runtime.capabilities.sessionCancellation.version, 1);
    assert.equal(runtime.capabilities.toolInvocation.version, 1);
    let entered;
    const started = new Promise((resolve) => {
      entered = resolve;
    });
    let release;
    const dispose = registerTool({
      name: 'space_control_gate',
      description: 'Offline cancellation gate',
      sideEffect: 'readonly',
      toClassifierInput: () => '',
      input_schema: { type: 'object', properties: {} },
      handler: async (_input, context) =>
        new Promise((resolve) => {
          release = () => resolve('[Cancelled] Operation cancelled by user');
          const signal = context.abortSignal;
          assert.ok(signal, 'managed tools must receive an owner AbortSignal');
          if (signal.aborted) release();
          else signal.addEventListener('abort', release, { once: true });
          entered();
        }),
    });
    t.after(() => {
      release?.();
      dispose();
    });
    const start = (toolInvocation) =>
      runtime.runs.start({
        sessionId,
        prompt: 'Offline tool operation',
        options: { lsp: false, toolInvocation },
      });
    const active = await start({ name: 'space_control_gate', input: {} });
    await started;
    const forbidden = path.join(workspace, 'queued-must-not-run.txt');
    const queued = await start({
      name: 'write',
      input: { path: forbidden, content: 'must not exist' },
    });
    const request = { sessionId, expectedRunId: active.runId, requestId: 'stop-fixture' };
    const stopped = await runtime.sessions.cancel(request);
    assert.deepEqual(
      new Set(stopped.receipts.map((item) => item.runId)),
      new Set([active.runId, queued.runId]),
    );
    await Promise.all([active.result, queued.result]);
    await assert.rejects(readFile(forbidden), { code: 'ENOENT' });
    const later = path.join(workspace, 'later.txt');
    const next = await start({ name: 'write', input: { path: later, content: 'survives' } });
    const replay = await runtime.sessions.cancel(request);
    assert.equal(replay.frontier, stopped.frontier);
    assert.equal(
      replay.receipts.some((item) => item.runId === next.runId),
      false,
    );
    assert.equal((await next.result).phase, 'completed');
    assert.equal(await readFile(later, 'utf8'), 'survives');
  },
);

test('published managed extension command receives its Run scope and joins nested tool effects', async (t) => {
  const { runtime, sessionId, workspace } = await fixture(t);
  const extension = path.join(workspace, 'command.mjs');
  const target = path.join(workspace, 'effect.txt');
  await writeFile(
    extension,
    `export default function activate(api) {
    api.registerCommand({ name: 'space-inspect', description: 'Offline command',
      handler: async (args) => {
        const scope = api.getExecutionScope();
        if (!scope) throw new Error('missing execution scope');
        await scope.invokeTool('write', { path: args[0], content: scope.sessionId + ':' + scope.runId });
        return { success: true, message: 'effect completed' };
      }
    });
  }`,
  );
  const previous = getActiveExtensionRuntime();
  const extensions = createExtensionRuntime();
  try {
    await extensions.loadExtensions([extension]);
    extensions.activate();
    setActiveExtensionRuntime(extensions);
    const run = await runtime.runs.start({
      sessionId,
      prompt: '/space-inspect effect.txt',
      options: {
        lsp: false,
        toolInvocation: { name: 'extension_command__space-inspect', input: { args: [target] } },
      },
    });
    const result = await run.result;
    assert.equal(result.phase, 'completed', result.result?.lastText);
    assert.equal(await readFile(target, 'utf8'), `${sessionId}:${run.runId}`);
  } finally {
    setActiveExtensionRuntime(previous);
    await extensions.dispose();
  }
});
