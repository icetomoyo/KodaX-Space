import assert from 'node:assert/strict';
import test from 'node:test';

import { RealKodaXSession } from '../kodax/real-session.js';
import { runtimeHostAdapter } from '../kodax/runtime-host-adapter.js';

test('active daemon run preserves interrupt intent and requires explicit after-turn fallback', async (t) => {
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
  let settingsUpdate:
    { readonly sessionId: string; readonly patch: Record<string, unknown> } | undefined;
  patchMethod('isRuntimeSelected', () => true);
  patchMethod('initialize', async () => undefined);
  patchMethod('ensureSession', async () => false);
  patchMethod(
    'updateSessionSettings',
    async (sessionId: string, patch: Record<string, unknown>) => {
      settingsUpdate = { sessionId, patch };
    },
  );
  patchMethod('ensureObserved', async () => undefined);
  patchMethod('activeRunId', () => 'run_active');
  patchMethod('findActiveRunId', async () => {
    throw new Error('active run lookup should use the live projection');
  });
  patchMethod('submitInput', async (input: Record<string, unknown>) => {
    submittedInput = input;
    return {
      accepted: false,
      delivery: 'interrupt',
      sessionId: 'session_restored',
      afterRunId: 'run_active',
      reason: 'unsupported_capability',
    };
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

  await assert.rejects(
    session.send('follow-up while active', undefined, {
      queueMode: 'interrupt',
      promptOverlay: 'attachment path overlay',
    }),
    /does not support mid-turn interrupt input.*Ctrl\/Cmd\+Enter/,
  );
  assert.deepEqual(submittedInput, {
    sessionId: 'session_restored',
    afterRunId: 'run_active',
    delivery: 'interrupt',
    input: [{ type: 'text', text: 'follow-up while active\n\nattachment path overlay' }],
  });

  adapter.submitInput = async () => ({
    accepted: false,
    delivery: 'interrupt',
    sessionId: 'session_restored',
    afterRunId: 'run_active',
    reason: 'interrupt_window_closed',
  });
  await assert.rejects(
    session.send('too late for this run', undefined, { queueMode: 'interrupt' }),
    /passed its final safe insertion point.*was not sent.*retry/i,
  );

  let acceptedInterruptCount = 0;
  adapter.submitInput = async (input: Record<string, unknown>) => {
    submittedInput = input;
    acceptedInterruptCount += 1;
    return {
      accepted: true,
      delivery: 'interrupt',
      inputId: `input_interrupt_${acceptedInterruptCount}`,
      runId: 'run_active',
      sessionId: 'session_restored',
      afterRunId: 'run_active',
      sessionOrder: acceptedInterruptCount,
    };
  };
  const interruptResult = await session.send('accepted interrupt follow-up', undefined, {
    queueMode: 'interrupt',
  });
  assert.deepEqual(interruptResult, {
    queued: true,
    queueId: 'input_interrupt_1',
    queueMode: 'interrupt',
  });
  assert.deepEqual(submittedInput, {
    sessionId: 'session_restored',
    afterRunId: 'run_active',
    delivery: 'interrupt',
    input: [{ type: 'text', text: 'accepted interrupt follow-up' }],
  });
  const secondInterruptResult = await session.send('second accepted interrupt', undefined, {
    queueMode: 'interrupt',
  });
  assert.deepEqual(secondInterruptResult, {
    queued: true,
    queueId: 'input_interrupt_2',
    queueMode: 'interrupt',
  });
  assert.deepEqual(submittedInput, {
    sessionId: 'session_restored',
    afterRunId: 'run_active',
    delivery: 'interrupt',
    input: [{ type: 'text', text: 'second accepted interrupt' }],
  });

  adapter.submitInput = async (input: Record<string, unknown>) => {
    submittedInput = input;
    return { accepted: true, delivery: 'after_turn', runId: 'run_follow_up' };
  };
  const result = await session.send('explicit after-turn follow-up', undefined, {
    queueMode: 'after-turn',
  });
  assert.deepEqual(result, {
    queued: true,
    queueId: 'run_follow_up',
    queueMode: 'after-turn',
  });
  assert.deepEqual(submittedInput, {
    sessionId: 'session_restored',
    afterRunId: 'run_active',
    delivery: 'after_turn',
    input: [{ type: 'text', text: 'explicit after-turn follow-up' }],
  });
  assert.deepEqual(settingsUpdate, {
    sessionId: 'session_restored',
    patch: {
      provider: 'test-provider',
      model: null,
      thinking: null,
      reasoningMode: 'balanced',
      permissionMode: 'accept-edits',
      executionCwd: process.cwd(),
      agentMode: 'ama',
      autoModeEngine: 'llm',
    },
  });
});

test('daemon run refreshes settings and hides exit_plan_mode without an approval bridge', async (t) => {
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

  let settingsUpdate:
    { readonly sessionId: string; readonly patch: Record<string, unknown> } | undefined;
  let managedRunInput: Record<string, unknown> | undefined;
  patchMethod('initialize', async () => undefined);
  patchMethod('ensureSession', async () => false);
  patchMethod(
    'updateSessionSettings',
    async (sessionId: string, patch: Record<string, unknown>) => {
      settingsUpdate = { sessionId, patch };
    },
  );
  patchMethod('ensureObserved', async () => undefined);
  patchMethod('startManagedRun', async (input: Record<string, unknown>) => {
    managedRunInput = input;
    return {
      runId: 'run_daemon',
      result: Promise.resolve({
        runId: 'run_daemon',
        sessionId: 'session_daemon',
        phase: 'completed',
      }),
    };
  });

  const session = new RealKodaXSession({
    sessionId: 'session_daemon',
    projectRoot: process.cwd(),
    provider: 'test-provider',
    reasoningMode: 'deep',
    permissionMode: 'auto',
    autoModeEngine: 'llm',
    surface: 'code',
    emit: () => undefined,
    requestPermission: async () => 'allow_once',
  });
  await (
    session as unknown as {
      runCoderDaemon(
        prompt: string,
        signal: AbortSignal,
        artifacts?: readonly unknown[],
        promptOverlay?: string,
      ): Promise<void>;
    }
  ).runCoderDaemon('inspect', new AbortController().signal);

  assert.deepEqual(settingsUpdate, {
    sessionId: 'session_daemon',
    patch: {
      provider: 'test-provider',
      model: null,
      thinking: null,
      reasoningMode: 'deep',
      permissionMode: 'auto',
      executionCwd: process.cwd(),
      agentMode: 'ama',
      autoModeEngine: 'llm',
    },
  });
  const options = managedRunInput?.options as
    { readonly context?: { readonly excludeTools?: readonly string[] } } | undefined;
  assert.ok(options?.context?.excludeTools?.includes('exit_plan_mode'));
});

test('disposing Space during daemon run admission detaches without aborting the accepted run', async (t) => {
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

  let releaseStart!: () => void;
  const startGate = new Promise<void>((resolve) => {
    releaseStart = resolve;
  });
  let markStartEntered!: () => void;
  const startEntered = new Promise<void>((resolve) => {
    markStartEntered = resolve;
  });
  let abortCalls = 0;

  patchMethod('isRuntimeSelected', () => true);
  patchMethod('initialize', async () => undefined);
  patchMethod('ensureSession', async () => false);
  patchMethod('ensureObserved', async () => undefined);
  patchMethod('activeRunId', () => undefined);
  patchMethod('findActiveRunId', async () => undefined);
  patchMethod('updateSessionSettings', async () => undefined);
  patchMethod('startManagedRun', async () => {
    markStartEntered();
    await startGate;
    return {
      runId: 'run_detached',
      result: Promise.resolve({
        runId: 'run_detached',
        sessionId: 'session_detached',
        phase: 'completed',
      }),
    };
  });
  patchMethod('abortSessionRun', async () => {
    abortCalls += 1;
    return true;
  });

  const session = new RealKodaXSession({
    sessionId: 'session_detached',
    projectRoot: process.cwd(),
    provider: 'zai-coding',
    model: 'glm-5.2',
    reasoningMode: 'deep',
    permissionMode: 'auto',
    autoModeEngine: 'llm',
    surface: 'code',
    emit: () => undefined,
    requestPermission: async () => 'allow_once',
  });

  await session.send('keep running after Space restarts');
  await startEntered;
  await session.dispose({ abortRuntimeRun: false });
  releaseStart();
  await new Promise<void>((resolve) => setImmediate(resolve));
  await new Promise<void>((resolve) => setImmediate(resolve));

  assert.equal(abortCalls, 0);

  const explicitlyCancelled = new RealKodaXSession({
    sessionId: 'session_cancelled',
    projectRoot: process.cwd(),
    provider: 'zai-coding',
    model: 'glm-5.2',
    reasoningMode: 'deep',
    permissionMode: 'auto',
    autoModeEngine: 'llm',
    surface: 'code',
    emit: () => undefined,
    requestPermission: async () => 'allow_once',
  });
  const explicitAbort = new AbortController();
  const cancelledRun = (
    explicitlyCancelled as unknown as {
      runCoderDaemon(prompt: string, signal: AbortSignal): Promise<void>;
    }
  ).runCoderDaemon('stop this run', explicitAbort.signal);
  explicitAbort.abort();
  await cancelledRun;

  assert.equal(abortCalls, 1, 'an explicit cancellation must still abort the daemon run');
});
