import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createKodaXRuntime } from '@kodax-ai/kodax/runtime';
import { runKodaX, runManagedTask } from '@kodax-ai/kodax/coding';
import { KodaXBaseProvider, registerModelProvider } from '@kodax-ai/kodax/llm';

const repository = fileURLToPath(new URL('../../', import.meta.url));
const providerName = 'space-permission-fixture';
const keyName = 'SPACE_PERMISSION_FIXTURE_KEY';
const response = (text) => ({
  textBlocks: [{ type: 'text', text }],
  toolBlocks: [],
  thinkingBlocks: [],
});

async function fixture(t, stream) {
  const scratch = path.join(repository, 'scratch');
  await fs.mkdir(scratch, { recursive: true });
  const root = await fs.mkdtemp(path.join(scratch, 'sdk-permissions-'));
  const workspace = path.join(root, 'workspace');
  const target = path.join(root, 'outside', 'file.txt');
  await fs.mkdir(workspace);
  await fs.mkdir(path.dirname(target));
  // An OS-temp fixture would accidentally satisfy the SDK's ordinary write roots.
  const relativeToTemp = path.relative(os.tmpdir(), target);
  assert.ok(relativeToTemp.startsWith('..') || path.isAbsolute(relativeToTemp));
  class Provider extends KodaXBaseProvider {
    name = providerName;
    supportsThinking = false;
    config = { apiKeyEnv: keyName, model: 'fixture', supportsThinking: false };
    stream = stream;
  }
  const previousKey = process.env[keyName];
  process.env[keyName] = 'offline-fixture';
  const unregister = registerModelProvider(providerName, () => new Provider());
  t.after(async () => {
    unregister();
    if (previousKey === undefined) delete process.env[keyName];
    else process.env[keyName] = previousKey;
    assert.equal(path.dirname(root), scratch);
    assert.ok(path.basename(root).startsWith('sdk-permissions-'));
    await fs.rm(root, { recursive: true, force: true, maxRetries: 3 });
  });
  return { root, workspace, target };
}

async function runtimeFixture(paths, permissionMode) {
  const runtime = await createKodaXRuntime({
    homeDir: path.join(paths.root, 'home'),
    sessionsDir: path.join(paths.root, 'sessions'),
    defaultProvider: providerName,
    defaultModel: 'fixture',
    sharedDaemonHost: true,
  });
  const session = await runtime.sessions.create({ projectPath: paths.workspace });
  await runtime.sessions.updateSettings(session.id, { permissionMode });
  return { runtime, session, close: () => runtime.close() };
}

test('Runtime Full Access and reviewed Auto write outside workspace; a later denial still blocks', async (t) => {
  let decision = 'allow';
  const paths = await fixture(t, async () =>
    response(
      `<decision>${decision}</decision><hazard>none</hazard><reason>Fixture decision</reason>`,
    ),
  );
  for (const mode of ['full-access', 'auto']) {
    const { runtime, session, close } = await runtimeFixture(paths, mode);
    try {
      for (const allowed of mode === 'auto' ? [true, false] : [true]) {
        decision = allowed ? 'allow' : 'ask';
        const target = `${paths.target}-${mode}-${allowed}`;
        const run = await runtime.runs.start({
          sessionId: session.id,
          prompt: 'Write this fixture.',
          options: {
            lsp: false,
            toolInvocation: { name: 'write', input: { path: target, content: 'fixture' } },
          },
        });
        const result = await run.result;
        if (allowed)
          assert.equal(await fs.readFile(target, 'utf8'), 'fixture', result.result?.lastText);
        else await assert.rejects(fs.access(target), { code: 'ENOENT' });
      }
    } finally {
      await close();
    }
  }
});

test('direct SDK Full Access writes external targets and reports its actual mode', async (t) => {
  let target;
  let calls;
  const paths = await fixture(t, async (_messages, _tools, system) => {
    assert.match(system, /Current permission mode: full-access/);
    if (++calls > 1) return response('done');
    return {
      textBlocks: [],
      thinkingBlocks: [],
      toolBlocks: [
        {
          type: 'tool_use',
          id: 'fixture-write',
          name: 'write',
          input: { path: target, content: 'fixture' },
        },
      ],
    };
  });
  for (const [name, run] of [
    ['direct', runKodaX],
    ['managed', runManagedTask],
  ]) {
    target = `${paths.target}-${name}`;
    calls = 0;
    await run(
      {
        provider: providerName,
        model: 'fixture',
        agentMode: 'sa',
        lsp: false,
        context: {
          gitRoot: paths.workspace,
          executionCwd: paths.workspace,
          resolveShellPermissionMode: () => 'full-access',
          repoIntelligenceMode: 'off',
        },
      },
      'Write this fixture.',
    );
    assert.equal(await fs.readFile(target, 'utf8'), 'fixture');
  }
});

test('Runtime refreshes permission facts after a live mode change despite prompt overrides', async (t) => {
  let owner;
  const modes = [];
  const paths = await fixture(t, async (_messages, _tools, system) => {
    modes.push(system.match(/Current permission mode: ([^\r\n]+)/)?.[1]);
    assert.match(system, /config.json contains defaults, not the current Session mode/);
    if (modes.length > 1) return response('done');
    await owner.runtime.sessions.updateSettings(owner.session.id, { permissionMode: 'plan' });
    return {
      textBlocks: [],
      thinkingBlocks: [],
      toolBlocks: [
        { type: 'tool_use', id: 'fixture-read', name: 'read', input: { path: paths.target } },
      ],
    };
  });
  await fs.writeFile(paths.target, 'fixture');
  owner = await runtimeFixture(paths, 'full-access');
  try {
    const run = await owner.runtime.runs.start({
      sessionId: owner.session.id,
      prompt: 'Read the fixture.',
      mode: 'managed_task',
      options: {
        agentMode: 'sa',
        lsp: false,
        context: { repoIntelligenceMode: 'off', systemPromptOverride: 'Isolated fixture agent.' },
      },
    });
    await run.result;
    assert.deepEqual(modes, ['full-access', 'plan']);
  } finally {
    await owner.close();
  }
});
