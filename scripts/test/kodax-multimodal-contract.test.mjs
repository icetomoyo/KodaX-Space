import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  CodingActorSession,
  applyToolResultGuardrail,
  executeTool,
  runKodaX,
  runManagedTask,
} from '@kodax-ai/kodax/coding';
import { KodaXBaseProvider, registerModelProvider } from '@kodax-ai/kodax/llm';

const providerName = 'space-image-contract-fixture';
const keyName = 'SPACE_IMAGE_CONTRACT_KEY';
const pixel = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aRZkAAAAASUVORK5CYII=',
  'base64',
);

function registerImageProvider(imagePath, route, expected, onDelivery) {
  class Provider extends KodaXBaseProvider {
    name = providerName;
    supportsThinking = false;
    config = { apiKeyEnv: keyName, model: 'fixture', supportsThinking: false };
    async stream(messages) {
      const result = messages
        .flatMap((message) => (Array.isArray(message.content) ? message.content : []))
        .find((block) => block.type === 'tool_result' && block.tool_use_id === 'fixture-image');
      if (result) {
        assert.deepEqual(
          result.content,
          expected,
          'The next model request must retain native image blocks',
        );
        onDelivery();
        return {
          textBlocks: [{ type: 'text', text: 'Image inspected.' }],
          thinkingBlocks: [],
          toolBlocks: [],
        };
      }
      return {
        textBlocks: [{ type: 'text', text: 'Reading the image now.' }],
        thinkingBlocks: [],
        toolBlocks: [
          {
            type: 'tool_use',
            id: 'fixture-image',
            name: route,
            input:
              route === 'read' ? { path: imagePath } : { name: 'read', input: { path: imagePath } },
          },
        ],
      };
    }
  }
  return registerModelProvider(providerName, () => new Provider());
}

function imageOptions(root, expected, fail, onGuard) {
  return {
    provider: providerName,
    model: 'fixture',
    agentMode: 'sa',
    maxIter: 3,
    lsp: false,
    guardrails: [
      {
        kind: 'tool',
        name: 'image-contract',
        afterTool: async (_call, result) => {
          assert.deepEqual(result.content, expected);
          onGuard();
          if (fail)
            throw Object.assign(new TypeError('image fixture local failure'), {
              code: 'ERR_INVALID_ARG_TYPE',
            });
          return { action: 'allow' };
        },
      },
    ],
    context: {
      gitRoot: root,
      executionCwd: root,
      repoIntelligenceMode: 'off',
      resolveShellPermissionMode: () => 'full-access',
    },
  };
}

async function fixture(t, route = 'read', fail = false) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'space-sdk-image-'));
  const imagePath = path.join(root, 'pixel.png');
  await fs.writeFile(imagePath, pixel);
  const previous = new Map(['KODAX_HOME', keyName].map((key) => [key, process.env[key]]));
  process.env.KODAX_HOME = path.join(root, 'home');
  process.env[keyName] = 'offline-fixture';
  const expected = await executeTool('read', { path: imagePath }, { executionCwd: root });
  assert.ok(Array.isArray(expected));
  assert.deepEqual(
    expected.find((block) => block.type === 'image'),
    {
      type: 'image',
      path: imagePath,
      mediaType: 'image/png',
    },
  );
  let delivered = 0;
  let guarded = 0;
  const unregister = registerImageProvider(imagePath, route, expected, () => {
    delivered += 1;
  });
  t.after(async () => {
    unregister();
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('space-sdk-image-'));
    await fs.rm(root, { recursive: true, force: true, maxRetries: 3 });
  });
  const options = imageOptions(root, expected, fail, () => {
    guarded += 1;
  });
  return { root, options, counts: () => ({ delivered, guarded }) };
}

for (const [mode, run] of [
  ['direct', runKodaX],
  ['managed', runManagedTask],
]) {
  for (const route of ['read', 'tool_call']) {
    test(`published SDK ${mode} ${route} retains PNG through allowing guardrail and next request`, async (t) => {
      const { options, counts } = await fixture(t, route);
      const result = await run(options, 'Read the fixture image.');
      assert.equal(result.success, true, JSON.stringify(result.failure));
      assert.deepEqual(counts(), { delivered: 1, guarded: 1 });
    });
  }
}

async function childFixture(t, fail) {
  const fixtureResult = await fixture(t, 'read', fail);
  const { root, options } = fixtureResult;
  const session = new CodingActorSession({ sessionId: 'space-image-actor' });
  const control = session.attach(
    {
      backups: new Map(),
      sessionId: 'space-image-actor',
      executionCwd: root,
      parentAgentConfig: { provider: providerName, model: 'fixture', repoIntelligenceMode: 'off' },
      guardrails: options.guardrails,
    },
    options,
  );
  t.after(() => session.close());
  const turn = await control.spawn({
    taskName: 'image-worker',
    objective: 'Read the fixture image.',
    forkTurns: 'none',
  });
  const deadline = Date.now() + 20_000;
  let output;
  do {
    output = control.output(turn.actorPath, turn.turnId);
    if (!['accepted', 'running'].includes(output.state)) break;
    await new Promise((resolve) => setTimeout(resolve, 20));
  } while (Date.now() < deadline);
  return { ...fixtureResult, output, detail: control.get(turn.actorPath) };
}

test('published SDK native child completes PNG read instead of failing with startsWith', async (t) => {
  const { output, counts } = await childFixture(t, false);
  assert.equal(output.state, 'completed', JSON.stringify(output));
  assert.deepEqual(counts(), { delivered: 1, guarded: 1 });
});

test('published SDK native child retains local error identity ahead of stale assistant text', async (t) => {
  const { output, detail, counts } = await childFixture(t, true);
  assert.deepEqual(counts(), { delivered: 0, guarded: 1 });
  assert.equal(output.state, 'failed');
  assert.match(output.error, /Local SDK execution failed/);
  assert.notEqual(output.error, 'Reading the image now.');
  const failure = detail.turns[0].metadata.executionFailure;
  assert.equal(failure.source, 'local');
  assert.equal(failure.errorClass, 'local_execution_error');
  assert.equal(failure.errorName, 'TypeError');
  assert.equal(failure.code, 'ERR_INVALID_ARG_TYPE');
});

test('published SDK capacity guard preserves image blocks when spilling accompanying text', async (t) => {
  const { root } = await fixture(t);
  const image = { type: 'image', path: path.join(root, 'pixel.png'), mediaType: 'image/png' };
  const result = await applyToolResultGuardrail(
    'read',
    [{ type: 'text', text: 'long image evidence '.repeat(12_000) }, image],
    { executionCwd: root },
    {
      forceSpill: true,
      maxInlineTokens: 1_000,
      persistOutput: async (_name, content) => {
        const target = path.join(root, 'evidence.txt');
        await fs.writeFile(target, content);
        return target;
      },
    },
  );
  assert.equal(result.truncated, true);
  assert.ok(Array.isArray(result.content));
  assert.deepEqual(
    result.content.find((block) => block.type === 'image'),
    image,
  );
  assert.match(await fs.readFile(result.outputPath, 'utf8'), /long image evidence/);
});
