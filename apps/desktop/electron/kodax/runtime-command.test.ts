import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveRuntimeToolInvocation } from './runtime-command.js';

test('extension aliases invoke the canonical managed tool with literal arguments', async () => {
  const result = await resolveRuntimeToolInvocation(
    '/inspect-alias src/a.ts --check',
    async (name) => {
      assert.equal(name, 'inspect-alias');
      return { name: 'inspect-source', source: 'extension', description: 'Inspect' };
    },
  );
  assert.deepEqual(result, {
    name: 'extension_command__inspect-source',
    input: {
      args: ['src/a.ts', '--check'],
    },
  });
});

test('explicit shell commands preserve the command and Skills retain their existing route', async () => {
  assert.deepEqual(await resolveRuntimeToolInvocation('!git status --short', async () => null), {
    name: 'bash',
    input: { command: 'git status --short' },
  });
  assert.equal(
    await resolveRuntimeToolInvocation('/review src', async () => ({
      name: 'review',
      source: 'skill',
      description: 'Review',
    })),
    undefined,
  );
  assert.equal(
    await resolveRuntimeToolInvocation('ordinary task', async () => {
      throw new Error('plain messages must not query the command catalog');
    }),
    undefined,
  );
});
