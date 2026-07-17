import assert from 'node:assert/strict';
import test from 'node:test';

import { RealKodaXSession } from '../kodax/real-session.js';
import { runtimeHostAdapter } from '../kodax/runtime-host-adapter.js';

test('restored daemon run downgrades an unsupported interrupt prompt to after-turn', async (t) => {
  const adapter = runtimeHostAdapter as unknown as Record<string, unknown>;
  const patchedMethods = new Map<string, { readonly existed: boolean; readonly value: unknown }>();
  const patchMethod = (name: string, value: unknown): void => {
    patchedMethods.set(name, {
      existed: Object.prototype.hasOwnProperty.call(adapter, name),
      value: adapter[name],
    });
    adapter[name] = value;
  };
  t.after(() => {
    for (const [name, original] of patchedMethods) {
      if (original.existed) adapter[name] = original.value;
      else delete adapter[name];
    }
  });

  let submittedInput: Record<string, unknown> | undefined;
  patchMethod('isRuntimeSelected', () => true);
  patchMethod('initialize', async () => undefined);
  patchMethod('ensureSession', async () => false);
  patchMethod('ensureObserved', async () => undefined);
  patchMethod('activeRunId', () => undefined);
  patchMethod('findActiveRunId', async () => 'run_restored');
  patchMethod('submitInput', async (input: Record<string, unknown>) => {
    submittedInput = input;
    return { accepted: true, delivery: 'after_turn', runId: 'run_follow_up' };
  });

  const session = new RealKodaXSession({
    sessionId: 'session_restored',
    projectRoot: process.cwd(),
    provider: 'test-provider',
    reasoningMode: 'balanced',
    permissionMode: 'accept-edits',
    surface: 'code',
    emit: () => undefined,
    requestPermission: async () => 'allow_once',
  });

  const result = await session.send('follow-up after restart', undefined, {
    queueMode: 'interrupt',
  });

  assert.deepEqual(result, {
    queued: true,
    queueId: 'run_follow_up',
    queueMode: 'after-turn',
  });
  assert.deepEqual(submittedInput, {
    sessionId: 'session_restored',
    afterRunId: 'run_restored',
    delivery: 'after_turn',
    input: [{ type: 'text', text: 'follow-up after restart' }],
  });
});
