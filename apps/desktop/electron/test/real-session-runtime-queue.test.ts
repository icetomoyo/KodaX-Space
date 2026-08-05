import assert from 'node:assert/strict';
import test from 'node:test';

import { projectEmbeddedMidTurnUserMessages, RealKodaXSession } from '../kodax/real-session.js';
import { runtimeHostAdapter } from '../kodax/runtime-host-adapter.js';
import { setUserConfigImpl } from '../kodax/user-config.js';

async function waitForTest(predicate: () => boolean, timeoutMs = 1_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('condition timed out');
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
}

test('embedded mid-turn delivery preserves the SDK queue and canonical entry identities', () => {
  assert.deepEqual(
    projectEmbeddedMidTurnUserMessages('session_embedded_identity', ['first', 'second'], {
      queuedMessageIds: ['queue-first', 'queue-second'],
      queuedMessageEntryIds: {
        'queue-first': 'entry-first',
        'queue-second': 'entry-second',
      },
    }),
    [
      {
        kind: 'mid_turn_user_prompt',
        sessionId: 'session_embedded_identity',
        queueId: 'queue-first',
        entryId: 'entry-first',
        content: 'first',
      },
      {
        kind: 'mid_turn_user_prompt',
        sessionId: 'session_embedded_identity',
        queueId: 'queue-second',
        entryId: 'entry-second',
        content: 'second',
      },
    ],
  );
});

test('embedded mid-turn delivery treats an invalid canonical entry identity as legacy absence', () => {
  assert.deepEqual(
    projectEmbeddedMidTurnUserMessages('session_embedded_legacy_identity', ['prompt'], {
      queuedMessageIds: ['queue-prompt'],
      queuedMessageEntryIds: { 'queue-prompt': '' },
    }),
    [
      {
        kind: 'mid_turn_user_prompt',
        sessionId: 'session_embedded_legacy_identity',
        queueId: 'queue-prompt',
        content: 'prompt',
      },
    ],
  );
});

test('embedded Coder send rejects before acceptance when the inline owner is unavailable', async (t) => {
  const adapter = runtimeHostAdapter as unknown as Record<string, unknown>;
  const originalIsRuntimeSelected = adapter.isRuntimeSelected;
  const originalEnsureLegacyOwner = adapter.ensureLegacyOwner;
  t.after(() => {
    adapter.isRuntimeSelected = originalIsRuntimeSelected;
    adapter.ensureLegacyOwner = originalEnsureLegacyOwner;
  });

  adapter.isRuntimeSelected = () => false;
  adapter.ensureLegacyOwner = async () => {
    throw new Error('inline owner unavailable');
  };

  const events: unknown[] = [];
  const session = new RealKodaXSession({
    sessionId: 'session_inline_owner_missing',
    projectRoot: process.cwd(),
    provider: 'test-provider',
    reasoningMode: 'balanced',
    permissionMode: 'accept-edits',
    surface: 'code',
    emit: (event) => events.push(event),
    requestPermission: async () => 'allow_once',
  });

  await assert.rejects(session.send('must not be accepted'), /inline owner unavailable/);
  assert.equal(session.isRunning(), false);
  assert.deepEqual(events, []);
});

test('daemon Coder restores the draft when the persisted boundary changes before admission', async (t) => {
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

  let observationAttempted = false;
  let runtimeInputAttempted = false;
  patchMethod('isRuntimeSelected', () => true);
  patchMethod('initialize', async () => undefined);
  patchMethod('ensureSession', async () => {
    throw Object.assign(new Error('Session location topology changed'), { code: 'data_changed' });
  });
  patchMethod('ensureObserved', async () => {
    observationAttempted = true;
  });
  patchMethod('submitInput', async () => {
    runtimeInputAttempted = true;
    throw new Error('submitInput must not run after a pre-admission boundary conflict');
  });

  const events: unknown[] = [];
  const session = new RealKodaXSession({
    sessionId: 'session_data_changed_before_admission',
    projectRoot: process.cwd(),
    provider: 'test-provider',
    reasoningMode: 'balanced',
    permissionMode: 'accept-edits',
    surface: 'code',
    emit: (event) => events.push(event),
    requestPermission: async () => 'allow_once',
  });

  assert.deepEqual(
    await session.send('must remain editable', undefined, { queueMode: 'after-turn' }),
    { accepted: false, reason: 'session_data_changed', queueMode: 'after-turn' },
  );
  assert.equal(observationAttempted, false);
  assert.equal(runtimeInputAttempted, false);
  assert.equal(session.isRunning(), false);
  assert.deepEqual(events, []);
});

test('daemon Coder restores the draft when Runtime preparation crosses a changed boundary', async (t) => {
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

  let startAttempts = 0;
  patchMethod('isRuntimeSelected', () => true);
  patchMethod('initialize', async () => undefined);
  patchMethod('ensureSession', async () => false);
  patchMethod('ensureObserved', async () => undefined);
  patchMethod('activeRunId', () => undefined);
  patchMethod('findActiveRunId', async () => undefined);
  patchMethod('updateSessionSettings', async () => {
    throw Object.assign(new Error('Session settings boundary changed'), {
      code: 'data_changed',
    });
  });
  patchMethod('startManagedRun', async () => {
    startAttempts += 1;
    throw new Error('preparation failures must not reach Runtime admission');
  });

  const events: Array<{ readonly kind?: string }> = [];
  const session = new RealKodaXSession({
    sessionId: 'session_preparation_boundary_changed',
    projectRoot: process.cwd(),
    provider: 'test-provider',
    reasoningMode: 'balanced',
    permissionMode: 'accept-edits',
    surface: 'code',
    emit: (event) => events.push(event),
    requestPermission: async () => 'allow_once',
  });

  assert.deepEqual(await session.send('restore after preparation conflict'), {
    accepted: false,
    reason: 'session_data_changed',
    queueMode: 'interrupt',
  });
  assert.equal(startAttempts, 0);
  assert.equal(
    events.some((event) => event.kind === 'session_error'),
    false,
  );
  await waitForTest(() => !session.isRunning());
});

test('daemon Coder retries a transient read-boundary change only before Run admission', async (t) => {
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

  let startAttempts = 0;
  patchMethod('initialize', async () => undefined);
  patchMethod('updateSessionSettings', async () => undefined);
  patchMethod('ensureObserved', async () => undefined);
  patchMethod('startManagedRun', async () => {
    startAttempts += 1;
    if (startAttempts < 3) {
      throw Object.assign(new Error('Session data changed during the read boundary'), {
        code: 'data_changed',
      });
    }
    return {
      runId: 'run_after_boundary_retry',
      result: Promise.resolve({
        runId: 'run_after_boundary_retry',
        sessionId: 'session_boundary_retry',
        phase: 'completed',
      }),
    };
  });

  const events: Array<{ readonly kind?: string }> = [];
  const session = new RealKodaXSession({
    sessionId: 'session_boundary_retry',
    projectRoot: process.cwd(),
    provider: 'test-provider',
    reasoningMode: 'balanced',
    permissionMode: 'accept-edits',
    surface: 'code',
    emit: (event) => events.push(event),
    requestPermission: async () => 'allow_once',
  });

  await (
    session as unknown as {
      runCoderDaemon(prompt: string, signal: AbortSignal): Promise<void>;
    }
  ).runCoderDaemon('retry one unadmitted prompt', new AbortController().signal);

  assert.equal(startAttempts, 3);
  assert.equal(
    events.some((event) => event.kind === 'session_error'),
    false,
  );
});

test('daemon Coder returns a factual draft rejection when Run admission exhausts boundary retries', async (t) => {
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

  let startAttempts = 0;
  patchMethod('isRuntimeSelected', () => true);
  patchMethod('initialize', async () => undefined);
  patchMethod('ensureSession', async () => false);
  patchMethod('ensureObserved', async () => undefined);
  patchMethod('activeRunId', () => undefined);
  patchMethod('findActiveRunId', async () => undefined);
  patchMethod('updateSessionSettings', async () => undefined);
  patchMethod('startManagedRun', async () => {
    startAttempts += 1;
    throw Object.assign(new Error('Session data changed during the read boundary'), {
      code: 'resync_required',
    });
  });

  const events: Array<{ readonly kind?: string }> = [];
  const session = new RealKodaXSession({
    sessionId: 'session_boundary_retry_exhausted',
    projectRoot: process.cwd(),
    provider: 'test-provider',
    reasoningMode: 'balanced',
    permissionMode: 'accept-edits',
    surface: 'code',
    emit: (event) => events.push(event),
    requestPermission: async () => 'allow_once',
  });

  assert.deepEqual(await session.send('restore this draft after retry exhaustion'), {
    accepted: false,
    reason: 'session_data_changed',
    queueMode: 'interrupt',
  });
  assert.equal(startAttempts, 3);
  assert.equal(
    events.some((event) => event.kind === 'session_error'),
    false,
  );
  await waitForTest(() => !session.isRunning());
});

test('an internally started prompt reports a boundary failure instead of failing silently', async (t) => {
  const adapter = runtimeHostAdapter as unknown as Record<string, unknown>;
  const patchedMethods = new Map<string, { readonly existed: boolean; readonly value: unknown }>();
  const patchMethod = (name: string, value: unknown): void => {
    patchedMethods.set(name, {
      existed: Object.prototype.hasOwnProperty.call(adapter, name),
      value: adapter[name],
    });
    adapter[name] = value;
  };
  const sessionId = 'session_internal_boundary_failure';
  t.after(() => {
    for (const [name, original] of patchedMethods) {
      if (original.existed) adapter[name] = original.value;
      else delete adapter[name];
    }
  });

  patchMethod('isRuntimeSelected', () => true);
  patchMethod('initialize', async () => undefined);
  patchMethod('ensureSession', async () => false);
  patchMethod('ensureObserved', async () => undefined);
  patchMethod('updateSessionSettings', async () => undefined);
  patchMethod('startManagedRun', async () => {
    throw Object.assign(new Error('Session changed before queued Run admission'), {
      code: 'data_changed',
    });
  });

  const events: Array<{ readonly kind?: string }> = [];
  const session = new RealKodaXSession({
    sessionId,
    projectRoot: process.cwd(),
    provider: 'test-provider',
    reasoningMode: 'balanced',
    permissionMode: 'accept-edits',
    surface: 'code',
    emit: (event) => events.push(event),
    requestPermission: async () => 'allow_once',
  });
  (
    session as unknown as {
      startRun(prompt: string): unknown;
    }
  ).startRun('do not lose this internally started prompt');

  await waitForTest(() => !session.isRunning());
  assert.equal(
    events.some((event) => event.kind === 'session_error'),
    true,
  );
});

test('daemon Coder never retries an unclassified start failure', async (t) => {
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

  let startAttempts = 0;
  patchMethod('initialize', async () => undefined);
  patchMethod('updateSessionSettings', async () => undefined);
  patchMethod('ensureObserved', async () => undefined);
  patchMethod('startManagedRun', async () => {
    startAttempts += 1;
    throw new Error('transport outcome unknown');
  });

  const events: Array<{ readonly kind?: string }> = [];
  const session = new RealKodaXSession({
    sessionId: 'session_no_unsafe_retry',
    projectRoot: process.cwd(),
    provider: 'test-provider',
    reasoningMode: 'balanced',
    permissionMode: 'accept-edits',
    surface: 'code',
    emit: (event) => events.push(event),
    requestPermission: async () => 'allow_once',
  });

  await (
    session as unknown as {
      runCoderDaemon(prompt: string, signal: AbortSignal): Promise<void>;
    }
  ).runCoderDaemon('do not duplicate uncertain admission', new AbortController().signal);

  assert.equal(startAttempts, 1);
  assert.equal(events.filter((event) => event.kind === 'session_error').length, 1);
});

test('daemon Coder cancellation during a boundary retry delay prevents another admission attempt', async (t) => {
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

  let startAttempts = 0;
  patchMethod('initialize', async () => undefined);
  patchMethod('updateSessionSettings', async () => undefined);
  patchMethod('ensureObserved', async () => undefined);
  patchMethod('startManagedRun', async () => {
    startAttempts += 1;
    throw Object.assign(new Error('Session data changed during the read boundary'), {
      code: 'data_changed',
    });
  });

  const events: Array<{ readonly kind?: string }> = [];
  const session = new RealKodaXSession({
    sessionId: 'session_cancel_boundary_retry',
    projectRoot: process.cwd(),
    provider: 'test-provider',
    reasoningMode: 'balanced',
    permissionMode: 'accept-edits',
    surface: 'code',
    emit: (event) => events.push(event),
    requestPermission: async () => 'allow_once',
  });
  const abort = new AbortController();
  const run = (
    session as unknown as {
      runCoderDaemon(prompt: string, signal: AbortSignal): Promise<void>;
    }
  ).runCoderDaemon('cancel before retry admission', abort.signal);

  await waitForTest(() => startAttempts === 1);
  abort.abort();
  await run;

  assert.equal(startAttempts, 1);
  assert.equal(
    events.some((event) => event.kind === 'session_error'),
    false,
  );
});

for (const abortRuntimeRun of [false, true] as const) {
  test(`daemon Coder dispose(${abortRuntimeRun ? 'abort' : 'detach'}) during a boundary retry delay prevents another admission attempt`, async (t) => {
    const adapter = runtimeHostAdapter as unknown as Record<string, unknown>;
    const patchedMethods = new Map<
      string,
      { readonly existed: boolean; readonly value: unknown }
    >();
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

    let startAttempts = 0;
    let abortCalls = 0;
    patchMethod('isRuntimeSelected', () => true);
    patchMethod('initialize', async () => undefined);
    patchMethod('ensureSession', async () => false);
    patchMethod('ensureObserved', async () => undefined);
    patchMethod('activeRunId', () => undefined);
    patchMethod('findActiveRunId', async () => undefined);
    patchMethod('updateSessionSettings', async () => undefined);
    patchMethod('startManagedRun', async () => {
      startAttempts += 1;
      throw Object.assign(new Error('Session data changed during the read boundary'), {
        code: 'data_changed',
      });
    });
    patchMethod('abortSessionRun', async () => {
      abortCalls += 1;
      return true;
    });

    const session = new RealKodaXSession({
      sessionId: `session_dispose_boundary_retry_${abortRuntimeRun ? 'abort' : 'detach'}`,
      projectRoot: process.cwd(),
      provider: 'test-provider',
      reasoningMode: 'balanced',
      permissionMode: 'accept-edits',
      surface: 'code',
      emit: () => undefined,
      requestPermission: async () => 'allow_once',
    });

    const accepted = session.send('dispose before retry admission');
    await waitForTest(() => startAttempts === 1);
    await session.dispose({ abortRuntimeRun });
    assert.deepEqual(await accepted, { accepted: true, queued: false });
    await waitForTest(() => !session.isRunning());

    assert.equal(startAttempts, 1);
    assert.equal(abortCalls, abortRuntimeRun ? 1 : 0);
  });
}

test('embedded Coder snapshots permission mode before waiting for the inline owner', async (t) => {
  const adapter = runtimeHostAdapter as unknown as Record<string, unknown>;
  const originalIsRuntimeSelected = adapter.isRuntimeSelected;
  const originalEnsureLegacyOwner = adapter.ensureLegacyOwner;
  t.after(() => {
    adapter.isRuntimeSelected = originalIsRuntimeSelected;
    adapter.ensureLegacyOwner = originalEnsureLegacyOwner;
  });

  let ownerWaitStarted = false;
  let releaseOwner!: () => void;
  const ownerReady = new Promise<void>((resolve) => {
    releaseOwner = resolve;
  });
  adapter.isRuntimeSelected = () => false;
  adapter.ensureLegacyOwner = async () => {
    ownerWaitStarted = true;
    await ownerReady;
  };

  const session = new RealKodaXSession({
    sessionId: 'session_permission_admission_snapshot',
    projectRoot: process.cwd(),
    provider: 'test-provider',
    reasoningMode: 'balanced',
    permissionMode: 'auto',
    surface: 'code',
    emit: () => undefined,
    requestPermission: async () => 'allow_once',
  });
  let observedRunMode: string | undefined;
  const internal = session as unknown as {
    runRealStream(
      prompt: string,
      signal: AbortSignal,
      artifacts?: readonly unknown[],
      promptOverlay?: string,
      runtimeAdmission?: unknown,
      runPermissionMode?: string,
    ): Promise<void>;
  };
  internal.runRealStream = async (
    _prompt,
    _signal,
    _artifacts,
    _promptOverlay,
    _runtimeAdmission,
    runPermissionMode,
  ) => {
    observedRunMode = runPermissionMode;
  };

  const accepted = session.send('keep the accepted authority');
  await waitForTest(() => ownerWaitStarted);
  session.permissionMode = 'plan';
  releaseOwner();

  assert.deepEqual(await accepted, { accepted: true, queued: false });
  await waitForTest(() => observedRunMode !== undefined);
  assert.equal(observedRunMode, 'auto');
});

test('fire-and-forget stream preflight failures emit one terminal error instead of rejecting unhandled', async () => {
  const events: Array<{ readonly kind?: string }> = [];
  const session = new RealKodaXSession({
    sessionId: 'session_stream_preflight_failure',
    projectRoot: process.cwd(),
    provider: 'test-provider',
    reasoningMode: 'balanced',
    permissionMode: 'accept-edits',
    surface: 'partner',
    emit: (event) => events.push(event),
    requestPermission: async () => 'allow_once',
  });
  const internal = session as unknown as {
    runRealStream(
      prompt: string,
      signal: AbortSignal,
      artifacts?: readonly unknown[],
      promptOverlay?: string,
    ): Promise<void>;
    startRun(prompt: string): void;
  };
  internal.runRealStream = async () => {
    throw new Error('stream preflight failed');
  };

  internal.startRun('preflight');
  await new Promise<void>((resolve) => setImmediate(resolve));

  assert.equal(session.isRunning(), false);
  assert.deepEqual(
    events.map((event) => event.kind),
    ['session_error'],
  );
});

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
    | { readonly sessionId: string; readonly patch: Record<string, unknown> }
    | undefined;
  const settingsUpdates: Array<{
    readonly sessionId: string;
    readonly patch: Record<string, unknown>;
  }> = [];
  patchMethod('isRuntimeSelected', () => true);
  patchMethod('initialize', async () => undefined);
  patchMethod('ensureSession', async () => false);
  patchMethod(
    'updateSessionSettings',
    async (sessionId: string, patch: Record<string, unknown>) => {
      settingsUpdate = { sessionId, patch };
      settingsUpdates.push({ sessionId, patch });
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

  assert.deepEqual(
    await session.send('follow-up while active', undefined, {
      queueMode: 'interrupt',
      promptOverlay: 'attachment path overlay',
    }),
    { accepted: false, reason: 'unsupported_capability', queueMode: 'interrupt' },
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
  assert.deepEqual(
    await session.send('too late for this run', undefined, { queueMode: 'interrupt' }),
    { accepted: false, reason: 'interrupt_window_closed', queueMode: 'interrupt' },
  );

  adapter.submitInput = async () => ({
    accepted: false,
    delivery: 'interrupt',
    sessionId: 'session_restored',
    afterRunId: 'run_active',
    reason: 'stale_run',
  });
  assert.deepEqual(
    await session.send('preserve this stale-boundary draft', undefined, {
      queueMode: 'interrupt',
    }),
    { accepted: false, reason: 'stale_run', queueMode: 'interrupt' },
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
    accepted: true,
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
    accepted: true,
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
    accepted: true,
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
  assert.ok(settingsUpdate);
  const { shellExecution: latestShellExecution, ...latestSettingsPatch } = settingsUpdate.patch;
  assert.deepEqual(
    {
      sessionId: settingsUpdate.sessionId,
      patch: latestSettingsPatch,
    },
    {
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
    },
  );
  assert.equal((latestShellExecution as { version?: unknown } | undefined)?.version, 1);
  assert.equal(
    settingsUpdates.filter(({ patch }) => patch.shellExecution !== undefined).length,
    settingsUpdates.length,
  );
  assert.equal(
    (settingsUpdates[0]?.patch.shellExecution as { version?: unknown } | undefined)?.version,
    1,
  );
});

test('daemon run refreshes settings and hides exit_plan_mode without an approval bridge', async (t) => {
  setUserConfigImpl({
    loadConfig: (() => ({ sandbox: { envPass: ['GH_TOKEN', 'GITHUB_TOKEN'] } })) as never,
    registerCustomProviders: () => undefined,
  });
  t.after(() => setUserConfigImpl(null));
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
    | { readonly sessionId: string; readonly patch: Record<string, unknown> }
    | undefined;
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

  assert.ok(settingsUpdate);
  const { shellExecution, ...settingsPatch } = settingsUpdate.patch;
  assert.deepEqual(
    {
      sessionId: settingsUpdate.sessionId,
      patch: settingsPatch,
    },
    {
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
    },
  );
  assert.equal((shellExecution as { version?: unknown } | undefined)?.version, 1);
  const options = managedRunInput?.options as
    | {
        readonly context?: {
          readonly excludeTools?: readonly string[];
          readonly shellExecution?: unknown;
        };
        readonly sandbox?: { readonly envPass?: readonly string[] };
      }
    | undefined;
  assert.ok(options?.context?.excludeTools?.includes('exit_plan_mode'));
  assert.deepEqual(options?.context?.shellExecution, shellExecution);
  assert.deepEqual(options?.sandbox?.envPass, ['GH_TOKEN', 'GITHUB_TOKEN']);
});

test('daemon permission sync keeps mode changes made during initialize and an in-flight settings write', async (t) => {
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

  let releaseInitialize!: () => void;
  const initializeGate = new Promise<void>((resolve) => {
    releaseInitialize = resolve;
  });
  let markInitializeEntered!: () => void;
  const initializeEntered = new Promise<void>((resolve) => {
    markInitializeEntered = resolve;
  });
  let releaseFirstSettingsWrite!: () => void;
  const firstSettingsWriteGate = new Promise<void>((resolve) => {
    releaseFirstSettingsWrite = resolve;
  });
  let markFirstSettingsWriteEntered!: () => void;
  const firstSettingsWriteEntered = new Promise<void>((resolve) => {
    markFirstSettingsWriteEntered = resolve;
  });
  const permissionModeWrites: unknown[] = [];

  patchMethod('initialize', async () => {
    markInitializeEntered();
    await initializeGate;
  });
  patchMethod('ensureSession', async () => false);
  patchMethod('ensureObserved', async () => undefined);
  patchMethod(
    'updateSessionSettings',
    async (_sessionId: string, patch: Record<string, unknown>) => {
      permissionModeWrites.push(patch.permissionMode);
      if (permissionModeWrites.length === 1) {
        markFirstSettingsWriteEntered();
        await firstSettingsWriteGate;
      }
    },
  );
  patchMethod('startManagedRun', async () => ({
    runId: 'run_permission_live_settings',
    result: Promise.resolve({
      runId: 'run_permission_live_settings',
      sessionId: 'session_permission_live_settings',
      phase: 'completed',
    }),
  }));

  const session = new RealKodaXSession({
    sessionId: 'session_permission_live_settings',
    projectRoot: process.cwd(),
    provider: 'test-provider',
    reasoningMode: 'balanced',
    permissionMode: 'auto',
    surface: 'code',
    emit: () => undefined,
    requestPermission: async () => 'allow_once',
  });
  const run = (
    session as unknown as {
      runCoderDaemon(prompt: string, signal: AbortSignal): Promise<void>;
    }
  ).runCoderDaemon('keep daemon permissions live', new AbortController().signal);

  await initializeEntered;
  session.permissionMode = 'plan';
  releaseInitialize();
  await firstSettingsWriteEntered;
  assert.deepEqual(permissionModeWrites, ['plan']);

  session.permissionMode = 'accept-edits';
  releaseFirstSettingsWrite();
  await run;
  assert.deepEqual(permissionModeWrites, ['plan', 'accept-edits']);
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

  const accepted = session.send('keep running after Space restarts');
  await startEntered;
  let acknowledgementSettled = false;
  void accepted.then(() => {
    acknowledgementSettled = true;
  });
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(acknowledgementSettled, false, 'ACK must wait for authoritative Runtime admission');
  releaseStart();
  assert.deepEqual(await accepted, {
    accepted: true,
    queued: false,
    runId: 'run_detached',
  });
  await session.dispose({ abortRuntimeRun: false });
  await new Promise<void>((resolve) => setImmediate(resolve));
  await new Promise<void>((resolve) => setImmediate(resolve));

  assert.equal(abortCalls, 0);
});

test('Runtime cancel before admission emits a local terminal and never starts a Run', async (t) => {
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

  let releaseRuntimePreparation!: () => void;
  const runtimePreparationGate = new Promise<void>((resolve) => {
    releaseRuntimePreparation = resolve;
  });
  let markRuntimePreparationEntered!: () => void;
  const runtimePreparationEntered = new Promise<void>((resolve) => {
    markRuntimePreparationEntered = resolve;
  });
  let initializeCalls = 0;
  let startCalls = 0;

  patchMethod('isRuntimeSelected', () => true);
  patchMethod('initialize', async () => {
    initializeCalls += 1;
    if (initializeCalls === 2) {
      markRuntimePreparationEntered();
      await runtimePreparationGate;
    }
  });
  patchMethod('ensureSession', async () => false);
  patchMethod('ensureObserved', async () => undefined);
  patchMethod('activeRunId', () => undefined);
  patchMethod('findActiveRunId', async () => undefined);
  patchMethod('updateSessionSettings', async () => undefined);
  patchMethod('startManagedRun', async () => {
    startCalls += 1;
    throw new Error('cancelled requests must not reach Runtime admission');
  });
  patchMethod('abortSessionRun', async () => {
    throw new Error('no Runtime Run exists to stop before admission');
  });

  const events: Array<{ readonly kind?: string; readonly error?: string }> = [];
  const session = new RealKodaXSession({
    sessionId: 'session_cancelled_before_admission',
    projectRoot: process.cwd(),
    provider: 'zai-coding',
    model: 'glm-5.2',
    reasoningMode: 'deep',
    permissionMode: 'auto',
    autoModeEngine: 'llm',
    surface: 'code',
    emit: (event) => events.push(event),
    requestPermission: async () => 'allow_once',
  });

  const accepted = session.send('cancel before Runtime admission');
  await runtimePreparationEntered;
  assert.deepEqual(await session.cancel(), {
    kind: 'local_cancelled_before_admission',
  });
  assert.equal(session.isRunning(), false);
  assert.deepEqual(
    events.filter((event) => event.kind === 'session_error'),
    [
      {
        kind: 'session_error',
        sessionId: 'session_cancelled_before_admission',
        error: 'cancelled',
        category: 'cancelled',
        retriable: true,
      },
    ],
  );
  assert.deepEqual(await accepted, { accepted: true, queued: false });

  releaseRuntimePreparation();
  await new Promise<void>((resolve) => setTimeout(resolve, 25));
  assert.equal(startCalls, 0);
});

test('Runtime cancel waits for in-flight admission and returns its authoritative Stop receipt', async (t) => {
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

  let releaseAdmission!: () => void;
  const admissionGate = new Promise<void>((resolve) => {
    releaseAdmission = resolve;
  });
  let markAdmissionEntered!: () => void;
  const admissionEntered = new Promise<void>((resolve) => {
    markAdmissionEntered = resolve;
  });
  let resolveRun!: (value: { runId: string; sessionId: string; phase: 'cancelled' }) => void;
  const runResult = new Promise<{
    runId: string;
    sessionId: string;
    phase: 'cancelled';
  }>((resolve) => {
    resolveRun = resolve;
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
    markAdmissionEntered();
    await admissionGate;
    return {
      runId: 'run_admitted',
      result: runResult,
    };
  });
  patchMethod('abortSessionRun', async () => {
    abortCalls += 1;
    resolveRun({
      runId: 'run_admitted',
      sessionId: 'session_cancelled_during_admission',
      phase: 'cancelled',
    });
    return {
      runId: 'run_admitted',
      sessionId: 'session_cancelled_during_admission',
      accepted: true,
      state: 'confirmed',
      outcome: 'cancelled',
      phase: 'cancelled',
      revision: 1,
    };
  });

  const events: Array<{ readonly kind?: string }> = [];
  const session = new RealKodaXSession({
    sessionId: 'session_cancelled_during_admission',
    projectRoot: process.cwd(),
    provider: 'zai-coding',
    model: 'glm-5.2',
    reasoningMode: 'deep',
    permissionMode: 'auto',
    autoModeEngine: 'llm',
    surface: 'code',
    emit: (event) => events.push(event),
    requestPermission: async () => 'allow_once',
  });

  const accepted = session.send('cancel while Runtime acknowledges admission');
  await admissionEntered;
  let cancelSettled = false;
  const cancelResult = session.cancel().then((result) => {
    cancelSettled = true;
    return result;
  });
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(cancelSettled, false);

  releaseAdmission();
  assert.deepEqual(await accepted, {
    accepted: true,
    queued: false,
    runId: 'run_admitted',
  });
  assert.deepEqual(await cancelResult, {
    runId: 'run_admitted',
    sessionId: 'session_cancelled_during_admission',
    accepted: true,
    state: 'confirmed',
    outcome: 'cancelled',
    phase: 'cancelled',
    revision: 1,
  });
  await waitForTest(() => !session.isRunning());
  assert.equal(abortCalls, 1);
  assert.equal(
    events.some((event) => event.kind === 'session_error'),
    false,
  );
});
