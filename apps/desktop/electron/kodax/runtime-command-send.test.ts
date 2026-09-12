import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { resolveRuntimeToolInvocation } from './runtime-command.js';
import type { RuntimeDaemonStartRunInput } from '@kodax-ai/kodax/runtime';

process.env.KODAX_TEST_ONBOARDING = '1';
const { RealKodaXSession } = await import('./real-session.js');
const { runtimeHostAdapter } = await import('./runtime-host-adapter.js');
const { getKodaxRuntimeDir } = await import('./data-paths.js');
const profile = getKodaxRuntimeDir();
assert.equal(path.dirname(profile), path.resolve(os.tmpdir()));
assert.ok(path.basename(profile).startsWith('kodax-test-'));
after(() => rm(profile, { recursive: true, force: true, maxRetries: 3 }));

for (const prompt of ['/inspect "src/a b.ts"', '!git status --short']) {
  test(`session.send admits ${prompt} as a tool Run, without Skill expansion`, async (t) => {
    let admitted: RuntimeDaemonStartRunInput | undefined;
    t.mock.method(runtimeHostAdapter, 'isRuntimeSelected', () => true);
    t.mock.method(runtimeHostAdapter, 'initialize', async () => undefined);
    t.mock.method(runtimeHostAdapter, 'ensureSession', async () => false);
    t.mock.method(runtimeHostAdapter, 'ensureObserved', async () => undefined);
    t.mock.method(runtimeHostAdapter, 'activeRunId', () => undefined);
    t.mock.method(runtimeHostAdapter, 'findActiveRunId', async () => undefined);
    t.mock.method(runtimeHostAdapter, 'updateSessionSettings', async () => undefined);
    t.mock.method(runtimeHostAdapter, 'resolveToolInvocation', (raw: string) =>
      resolveRuntimeToolInvocation(raw, async () => ({
        name: 'inspect',
        source: 'extension',
        description: 'Inspect',
      })),
    );
    t.mock.method(
      runtimeHostAdapter,
      'startManagedRun',
      async (input: RuntimeDaemonStartRunInput) => {
        admitted = input;
        return {
          runId: 'command-run',
          result: Promise.resolve({
            runId: 'command-run',
            sessionId: 'command-session',
            phase: 'completed',
          }),
        };
      },
    );
    const session = new RealKodaXSession({
      sessionId: 'command-session',
      projectRoot: process.cwd(),
      provider: 'mock',
      reasoningMode: 'auto',
      permissionMode: 'accept-edits',
      surface: 'code',
      emit: () => undefined,
      requestPermission: async () => 'allow_once',
    });
    const result = await session.send(prompt, undefined, { operationId: 'command-operation' });
    assert.equal(result.accepted, true);
    assert.deepEqual(
      admitted?.options?.toolInvocation,
      prompt.startsWith('!')
        ? { name: 'bash', input: { command: 'git status --short' } }
        : { name: 'extension_command__inspect', input: { args: ['src/a b.ts'] } },
    );
    assert.equal(admitted?.operation?.operationId, 'command-operation');
    assert.equal(admitted?.options?.context?.skillInvocation, undefined);
    await session.dispose({ abortRuntimeRun: false });
  });
}
