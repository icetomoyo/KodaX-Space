import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { projectEmbeddedMidTurnUserMessages, RealKodaXSession } from '../kodax/real-session.js';
import { runtimeHostAdapter } from '../kodax/runtime-host-adapter.js';

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

test('an explicit Skill is rejected factually while any run is active', async () => {
  const session = new RealKodaXSession({
    sessionId: 'session_busy_skill',
    projectRoot: process.cwd(),
    provider: 'test-provider',
    reasoningMode: 'balanced',
    permissionMode: 'accept-edits',
    surface: 'partner',
    emit: () => undefined,
    requestPermission: async () => 'allow_once',
  });
  const internal = session as unknown as {
    currentAbort: AbortController | null;
    resolveExplicitSkillReference(): Promise<{
      readonly name: string;
      readonly argumentsText: string;
      readonly registered: boolean;
    }>;
  };
  internal.currentAbort = new AbortController();
  internal.resolveExplicitSkillReference = async () => ({
    name: 'code-review',
    argumentsText: '--strict',
    registered: true,
  });

  assert.deepEqual(
    await session.send('/code-review --strict', undefined, {
      queueMode: 'after-turn',
    }),
    {
      accepted: false,
      reason: 'skill_requires_idle',
      queueMode: 'after-turn',
    },
  );
});

test('a fresh explicit Skill is prepared once before the run starts', async () => {
  const session = new RealKodaXSession({
    sessionId: 'session_fresh_skill',
    projectRoot: process.cwd(),
    provider: 'test-provider',
    reasoningMode: 'balanced',
    permissionMode: 'accept-edits',
    surface: 'partner',
    emit: () => undefined,
    requestPermission: async () => 'allow_once',
  });
  const prepared = {
    executionPrompt: 'prepared execution prompt',
    modelOverride: 'skill-model',
    skillInvocation: {
      name: 'code-review',
      path: 'C:\\trusted\\code-review\\SKILL.md',
      expandedContent: 'trusted skill body',
      runtimePolicy: { enforceAtRuntime: true },
    },
    finalize: async () => undefined,
  };
  let prepareCalls = 0;
  let startedWith: unknown;
  const internal = session as unknown as {
    resolveExplicitSkillReference(): Promise<{
      readonly name: string;
      readonly argumentsText: string;
      readonly registered: boolean;
    }>;
    prepareExplicitSkillExecution(
      rawUserInput: string,
      reference: { readonly name: string; readonly argumentsText: string },
      permissionMode: string,
    ): Promise<{ readonly prepared?: unknown; readonly rejectionReason?: string }>;
    startRun(...args: unknown[]): null;
  };
  internal.resolveExplicitSkillReference = async () => ({
    name: 'code-review',
    argumentsText: '--strict',
    registered: true,
  });
  internal.prepareExplicitSkillExecution = async (rawUserInput, reference, permissionMode) => {
    prepareCalls += 1;
    assert.equal(rawUserInput, '/code-review --strict');
    assert.deepEqual(reference, {
      name: 'code-review',
      argumentsText: '--strict',
      registered: true,
    });
    assert.equal(permissionMode, 'accept-edits');
    return { prepared };
  };
  internal.startRun = (...args) => {
    startedWith = args[6];
    return null;
  };

  assert.deepEqual(
    await session.send('/code-review --strict', undefined, {
      operationId: 'operation-skill',
    }),
    { accepted: true, queued: false },
  );
  assert.equal(prepareCalls, 1);
  assert.equal(startedWith, prepared);
});

test('distinct sends cannot cross the same fresh-run preparation boundary', async () => {
  const session = new RealKodaXSession({
    sessionId: 'session_concurrent_skill_preparation',
    projectRoot: process.cwd(),
    provider: 'test-provider',
    reasoningMode: 'balanced',
    permissionMode: 'accept-edits',
    surface: 'partner',
    emit: () => undefined,
    requestPermission: async () => 'allow_once',
  });
  const prepared = {
    executionPrompt: 'prepared execution prompt',
    skillInvocation: {
      name: 'code-review',
      path: 'C:\\trusted\\code-review\\SKILL.md',
      expandedContent: 'trusted skill body',
      runtimePolicy: { enforceAtRuntime: true },
    },
    finalize: async () => undefined,
  };
  let releasePreparation!: () => void;
  const preparationGate = new Promise<void>((resolve) => {
    releasePreparation = resolve;
  });
  let preparationCalls = 0;
  const internal = session as unknown as {
    currentAbort: AbortController | null;
    resolveExplicitSkillReference(): Promise<{
      readonly name: string;
      readonly argumentsText: string;
      readonly registered: boolean;
    }>;
    prepareExplicitSkillExecution(): Promise<{ readonly prepared: unknown }>;
    startRun(...args: unknown[]): null;
  };
  internal.resolveExplicitSkillReference = async () => ({
    name: 'code-review',
    argumentsText: 'first',
    registered: true,
  });
  internal.prepareExplicitSkillExecution = async () => {
    preparationCalls += 1;
    await preparationGate;
    return { prepared };
  };
  internal.startRun = () => {
    internal.currentAbort = new AbortController();
    return null;
  };

  const first = session.send('/code-review first', undefined, {
    operationId: 'operation-skill-first',
  });
  await waitForTest(() => preparationCalls === 1);
  const second = session.send('/code-review second', undefined, {
    operationId: 'operation-skill-second',
  });
  await new Promise<void>((resolve) => setImmediate(resolve));

  assert.equal(preparationCalls, 1, 'the second send must wait outside Skill preparation');
  releasePreparation();
  assert.deepEqual(await first, { accepted: true, queued: false });
  assert.deepEqual(await second, {
    accepted: false,
    reason: 'skill_requires_idle',
    queueMode: 'interrupt',
  });
  assert.equal(preparationCalls, 1);
});

for (const action of ['cancel', 'dispose'] as const) {
  test(`${action} during explicit Skill preparation prevents a ghost Run and finalizes once`, async () => {
    const session = new RealKodaXSession({
      sessionId: `session_skill_${action}_during_preparation`,
      projectRoot: process.cwd(),
      provider: 'test-provider',
      reasoningMode: 'balanced',
      permissionMode: 'accept-edits',
      surface: 'partner',
      emit: () => undefined,
      requestPermission: async () => 'allow_once',
    });
    let releasePreparation!: () => void;
    const preparationGate = new Promise<void>((resolve) => {
      releasePreparation = resolve;
    });
    let preparationStarted = false;
    let finalizations = 0;
    let starts = 0;
    const internal = session as unknown as {
      resolveExplicitSkillReference(): Promise<{
        readonly name: string;
        readonly argumentsText: string;
        readonly registered: boolean;
      }>;
      prepareExplicitSkillExecution(): Promise<{ readonly prepared: unknown }>;
      startRun(...args: unknown[]): null;
    };
    internal.resolveExplicitSkillReference = async () => ({
      name: 'code-review',
      argumentsText: '--strict',
      registered: true,
    });
    internal.prepareExplicitSkillExecution = async () => {
      preparationStarted = true;
      await preparationGate;
      return {
        prepared: {
          executionPrompt: 'prepared prompt',
          skillInvocation: {
            name: 'code-review',
            path: 'C:\\trusted\\code-review\\SKILL.md',
            expandedContent: 'trusted body',
            runtimePolicy: { enforceAtRuntime: true },
          },
          finalize: async () => {
            finalizations += 1;
          },
        },
      };
    };
    internal.startRun = () => {
      starts += 1;
      return null;
    };

    const send = session.send('/code-review --strict');
    await waitForTest(() => preparationStarted);
    const stop = action === 'cancel' ? session.cancel() : session.dispose();
    releasePreparation();

    assert.deepEqual(await send, {
      accepted: false,
      reason: 'cancelled_before_admission',
      queueMode: 'interrupt',
    });
    await stop;
    assert.equal(starts, 0);
    assert.equal(finalizations, 1);
  });
}

test('fork Skill is rejected before dynamic context or permission can execute', async (t) => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'space-fork-skill-'));
  t.after(() => fs.rmSync(projectRoot, { recursive: true, force: true }));
  const skillName = `fork-skill-${Date.now()}`;
  const skillDir = path.join(projectRoot, '.kodax', 'skills', skillName);
  fs.mkdirSync(skillDir, { recursive: true });
  fs.writeFileSync(
    path.join(skillDir, 'SKILL.md'),
    `---\nname: ${skillName}\ndescription: fork safety\ncontext: fork\n---\n!\`echo must-not-run\`\n`,
  );
  let permissionRequests = 0;
  const session = new RealKodaXSession({
    sessionId: 'session_fork_skill_preflight',
    projectRoot,
    provider: 'test-provider',
    reasoningMode: 'balanced',
    permissionMode: 'accept-edits',
    surface: 'code',
    emit: () => undefined,
    requestPermission: async () => {
      permissionRequests += 1;
      return 'allow_once';
    },
  });
  const internal = session as unknown as {
    resolveExplicitSkillReference(rawUserInput: string): Promise<
      | {
          readonly name: string;
          readonly argumentsText: string;
          readonly registered: boolean;
        }
      | undefined
    >;
    prepareExplicitSkillExecution(
      rawUserInput: string,
      reference: { readonly name: string; readonly argumentsText: string },
      permissionMode: string,
    ): Promise<{ readonly rejectionReason?: string }>;
  };
  const rawUserInput = `/${skillName}`;
  const reference = await internal.resolveExplicitSkillReference(rawUserInput);
  assert.ok(reference);

  assert.deepEqual(
    await internal.prepareExplicitSkillExecution(rawUserInput, reference, 'accept-edits'),
    { rejectionReason: 'skill_fork_unsupported' },
  );
  assert.equal(permissionRequests, 0);
});

for (const prompt of ['/skill:definitely-missing --strict', '/definitely-missing --strict']) {
  test(`unregistered explicit Skill is rejected without a model Run: ${prompt}`, async () => {
    const session = new RealKodaXSession({
      sessionId: `session_missing_skill_${prompt.startsWith('/skill:') ? 'qualified' : 'bare'}`,
      projectRoot: process.cwd(),
      provider: 'test-provider',
      reasoningMode: 'balanced',
      permissionMode: 'accept-edits',
      surface: 'partner',
      emit: () => undefined,
      requestPermission: async () => 'allow_once',
    });
    let starts = 0;
    (session as unknown as { startRun(...args: unknown[]): null }).startRun = () => {
      starts += 1;
      return null;
    };

    assert.deepEqual(await session.send(prompt), {
      accepted: false,
      reason: 'skill_not_found',
      queueMode: 'interrupt',
    });
    assert.equal(starts, 0);
  });
}

test('multiple registered explicit Skill references are rejected before preparation', async (t) => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'space-multiple-skills-'));
  t.after(() => fs.rmSync(projectRoot, { recursive: true, force: true }));
  const skillName = `single-skill-${Date.now()}`;
  const skillDir = path.join(projectRoot, '.kodax', 'skills', skillName);
  fs.mkdirSync(skillDir, { recursive: true });
  fs.writeFileSync(
    path.join(skillDir, 'SKILL.md'),
    `---\nname: ${skillName}\ndescription: single Skill contract\n---\nReview $ARGUMENTS.\n`,
  );
  const session = new RealKodaXSession({
    sessionId: 'session_multiple_explicit_skills',
    projectRoot,
    provider: 'test-provider',
    reasoningMode: 'balanced',
    permissionMode: 'accept-edits',
    surface: 'partner',
    emit: () => undefined,
    requestPermission: async () => 'allow_once',
  });
  let preparationCalls = 0;
  let starts = 0;
  const internal = session as unknown as {
    prepareExplicitSkillExecution(): Promise<{ readonly rejectionReason: string }>;
    startRun(...args: unknown[]): null;
  };
  internal.prepareExplicitSkillExecution = async () => {
    preparationCalls += 1;
    return { rejectionReason: 'skill_preparation_failed' };
  };
  internal.startRun = () => {
    starts += 1;
    return null;
  };

  assert.deepEqual(await session.send(`/${skillName} one /${skillName} two`), {
    accepted: false,
    reason: 'skill_multiple_references',
    queueMode: 'interrupt',
  });
  assert.equal(preparationCalls, 0);
  assert.equal(starts, 0);
});

test('explicit Skill resolution supports a middle token and preserves its exact suffix', async (t) => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'space-explicit-skill-'));
  t.after(() => fs.rmSync(projectRoot, { recursive: true, force: true }));
  const skillName = `release-skill-${Date.now()}`;
  const skillDir = path.join(projectRoot, '.kodax', 'skills', skillName);
  fs.mkdirSync(skillDir, { recursive: true });
  fs.writeFileSync(
    path.join(skillDir, 'SKILL.md'),
    `---\nname: ${skillName}\ndescription: release contract\nallowed-tools: read\n---\nReview $ARGUMENTS carefully.\n`,
  );
  const session = new RealKodaXSession({
    sessionId: 'session_real_skill_prepare',
    projectRoot,
    provider: 'test-provider',
    reasoningMode: 'balanced',
    permissionMode: 'accept-edits',
    surface: 'code',
    emit: () => undefined,
    requestPermission: async () => 'allow_once',
  });
  const result = await (session as unknown as {
    resolveExplicitSkillReference(rawUserInput: string): Promise<
      | {
          readonly name: string;
          readonly argumentsText: string;
          readonly registered: boolean;
        }
      | undefined
    >;
    prepareExplicitSkillExecution(
      rawUserInput: string,
      reference: { readonly name: string; readonly argumentsText: string },
      permissionMode: string,
    ): Promise<{
      readonly prepared?: {
        readonly executionPrompt: string;
        readonly skillInvocation: Record<string, unknown>;
        readonly finalize: () => Promise<void>;
      };
      readonly rejectionReason?: string;
    }>;
  });
  const rawUserInput = `Please run /skill:${skillName} "src/a b.ts"  --strict`;
  const reference = await result.resolveExplicitSkillReference(rawUserInput);
  assert.deepEqual(reference, {
    name: skillName,
    argumentsText: '"src/a b.ts"  --strict',
    registered: true,
  });
  assert.ok(reference);
  const preparation = await result.prepareExplicitSkillExecution(
    rawUserInput,
    reference,
    'accept-edits',
  );

  assert.equal(preparation.rejectionReason, undefined);
  assert.match(preparation.prepared?.executionPrompt ?? '', /User request:/);
  assert.equal(preparation.prepared?.skillInvocation.name, skillName);
  assert.match(
    String(preparation.prepared?.skillInvocation.expandedContent),
    /Review "src\/a b\.ts" {2}--strict carefully/,
  );
  assert.deepEqual(preparation.prepared?.skillInvocation.runtimePolicy, {
    enforceAtRuntime: true,
  });
  await preparation.prepared?.finalize();
});

test('an admitted explicit Skill finalizes once even when stream preflight fails', async () => {
  const session = new RealKodaXSession({
    sessionId: 'session_skill_finalize',
    projectRoot: process.cwd(),
    provider: 'test-provider',
    reasoningMode: 'balanced',
    permissionMode: 'accept-edits',
    surface: 'partner',
    emit: () => undefined,
    requestPermission: async () => 'allow_once',
  });
  let finalizations = 0;
  let finalizationError: string | undefined;
  const internal = session as unknown as {
    runRealStream(...args: unknown[]): Promise<void>;
    startRun(...args: unknown[]): unknown;
  };
  internal.runRealStream = async () => {
    throw new Error('preflight exploded');
  };
  internal.startRun(
    '/code-review',
    undefined,
    undefined,
    'accept-edits',
    'operation-finalize',
    false,
    {
      executionPrompt: 'prepared prompt',
      skillInvocation: {
        name: 'code-review',
        path: 'C:\\trusted\\code-review\\SKILL.md',
        expandedContent: 'body',
        runtimePolicy: { enforceAtRuntime: true },
      },
      finalize: async (error?: Error) => {
        finalizations += 1;
        finalizationError = error?.message;
      },
    },
  );

  await waitForTest(() => !session.isRunning());
  assert.equal(finalizations, 1);
  assert.equal(finalizationError, 'preflight exploded');
});

test('an admitted explicit Skill finalizes with a fulfilled embedded terminal failure', async () => {
  const session = new RealKodaXSession({
    sessionId: 'session_skill_embedded_terminal_failure',
    projectRoot: process.cwd(),
    provider: 'test-provider',
    reasoningMode: 'balanced',
    permissionMode: 'accept-edits',
    surface: 'partner',
    emit: () => undefined,
    requestPermission: async () => 'allow_once',
  });
  let finalizations = 0;
  let finalizationError: string | undefined;
  const internal = session as unknown as {
    runRealStream(...args: unknown[]): Promise<Error | undefined>;
    startRun(...args: unknown[]): unknown;
  };
  internal.runRealStream = async () => new Error('embedded terminal failed');
  internal.startRun(
    '/code-review',
    undefined,
    undefined,
    'accept-edits',
    'operation-embedded-terminal-failure',
    false,
    {
      executionPrompt: 'prepared prompt',
      skillInvocation: {
        name: 'code-review',
        path: 'C:\\trusted\\code-review\\SKILL.md',
        expandedContent: 'body',
        runtimePolicy: { enforceAtRuntime: true },
      },
      finalize: async (error?: Error) => {
        finalizations += 1;
        finalizationError = error?.message;
      },
    },
  );

  await waitForTest(() => !session.isRunning());
  assert.equal(finalizations, 1);
  assert.equal(finalizationError, 'embedded terminal failed');
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
    { readonly sessionId: string; readonly patch: Record<string, unknown> } | undefined;
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
    reasoningMode: 'auto',
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
    operationId: 'space-send-after-turn-1',
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
    operation: { operationId: 'space-send-after-turn-1' },
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
        effort: null,
        reasoningMode: null,
        permissionMode: 'accept-edits',
        executionCwd: process.cwd(),
        agentMode: 'ama',
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

test('daemon run refreshes settings and transports trusted Skill context without hook commands', async (t) => {
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
  let managedRunCalls = 0;
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
    managedRunCalls += 1;
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
        admission?: unknown,
        operationId?: string,
        explicitSkill?: unknown,
      ): Promise<void>;
    }
  ).runCoderDaemon(
    '/code-review --strict',
    new AbortController().signal,
    undefined,
    undefined,
    undefined,
    'space-send-start-1',
    {
      executionPrompt: 'prepared daemon Skill prompt',
      modelOverride: 'skill-model',
      skillInvocation: {
        name: 'code-review',
        path: 'C:\\trusted\\code-review\\SKILL.md',
        allowedTools: 'read',
        hookEvents: ['PreToolUse'],
        expandedContent: 'trusted Skill body',
        runtimePolicy: { enforceAtRuntime: true },
      },
      finalize: async () => undefined,
    },
  );

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
        effort: null,
        reasoningMode: null,
        permissionMode: 'auto',
        executionCwd: process.cwd(),
        agentMode: 'ama',
      },
    },
  );
  assert.equal((shellExecution as { version?: unknown } | undefined)?.version, 1);
  const options = managedRunInput?.options as
    | {
        readonly context?: {
          readonly excludeTools?: readonly string[];
          readonly shellExecution?: unknown;
          readonly rawUserInput?: string;
          readonly skillInvocation?: Record<string, unknown>;
        };
        readonly modelOverride?: string;
      }
    | undefined;
  assert.ok(options?.context?.excludeTools?.includes('exit_plan_mode'));
  assert.deepEqual(options?.context?.shellExecution, shellExecution);
  assert.equal(managedRunCalls, 1);
  assert.equal(options?.context?.rawUserInput, '/code-review --strict');
  assert.equal(options?.context?.skillInvocation?.name, 'code-review');
  assert.deepEqual(options?.context?.skillInvocation?.runtimePolicy, {
    enforceAtRuntime: true,
  });
  assert.equal(options?.modelOverride, 'skill-model');
  assert.deepEqual(managedRunInput?.operation, { operationId: 'space-send-start-1' });
  assert.deepEqual(managedRunInput?.input, [
    { type: 'text', text: 'prepared daemon Skill prompt' },
  ]);
  const serializedSkill = JSON.stringify(options?.context?.skillInvocation);
  assert.equal(serializedSkill.includes('"hooks"'), false);
  assert.equal(serializedSkill.includes('"command"'), false);
});

test('daemon fulfilled terminal failure remains a Skill finalization failure', async (t) => {
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
  patchMethod('initialize', async () => undefined);
  patchMethod('ensureSession', async () => false);
  patchMethod('updateSessionSettings', async () => undefined);
  patchMethod('ensureObserved', async () => undefined);
  patchMethod('startManagedRun', async () => ({
    runId: 'run_daemon_terminal_failure',
    result: Promise.resolve({
      runId: 'run_daemon_terminal_failure',
      sessionId: 'session_daemon_terminal_failure',
      phase: 'failed',
      terminal: {
        revision: 1,
        kind: 'failed',
        code: 'provider_error',
        effectOutcome: 'none',
        message: 'daemon terminal failed',
      },
    }),
  }));

  const session = new RealKodaXSession({
    sessionId: 'session_daemon_terminal_failure',
    projectRoot: process.cwd(),
    provider: 'test-provider',
    reasoningMode: 'balanced',
    permissionMode: 'accept-edits',
    surface: 'code',
    emit: () => undefined,
    requestPermission: async () => 'allow_once',
  });
  const failure = await (
    session as unknown as {
      runCoderDaemon(prompt: string, signal: AbortSignal): Promise<Error | undefined>;
    }
  ).runCoderDaemon('fail factually', new AbortController().signal);

  assert.equal(failure?.message, 'daemon terminal failed');
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

test('Runtime cancel without a visible Run ID waits for in-flight admission', async (t) => {
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
  let abortedRunId: string | undefined;

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
  patchMethod('abortSessionRun', async (_sessionId: string, runId?: string) => {
    abortCalls += 1;
    abortedRunId = runId;
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
  assert.equal(abortedRunId, undefined);
  assert.equal(
    events.some((event) => event.kind === 'session_error'),
    false,
  );
});

test('a stale exact Stop does not cancel a preparing successor admission', async (t) => {
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
  let resolveSuccessor!: (value: { runId: string; sessionId: string; phase: 'completed' }) => void;
  const successorResult = new Promise<{
    runId: string;
    sessionId: string;
    phase: 'completed';
  }>((resolve) => {
    resolveSuccessor = resolve;
  });
  const stoppedRunIds: string[] = [];

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
    return { runId: 'run_successor', result: successorResult };
  });
  patchMethod('abortSessionRun', async (sessionId: string, runId?: string) => {
    stoppedRunIds.push(runId ?? 'session-fallback');
    return {
      runId: runId ?? 'session-fallback',
      sessionId,
      accepted: false,
      state: 'confirmed',
      outcome: 'completed',
      phase: 'completed',
      revision: 2,
    };
  });

  const sessionId = 'session_stale_exact_stop';
  const session = new RealKodaXSession({
    sessionId,
    projectRoot: process.cwd(),
    provider: 'zai-coding',
    model: 'glm-5.2',
    reasoningMode: 'deep',
    permissionMode: 'auto',
    surface: 'code',
    emit: () => undefined,
    requestPermission: async () => 'allow_once',
  });

  const accepted = session.send('successor admission');
  await admissionEntered;
  const staleStop = session.cancel('run_previous');
  await new Promise<void>((resolve) => setImmediate(resolve));

  assert.deepEqual(stoppedRunIds, ['run_previous']);
  assert.equal(session.isRunning(), true);

  releaseAdmission();
  assert.deepEqual(await accepted, {
    accepted: true,
    queued: false,
    runId: 'run_successor',
  });
  assert.deepEqual(await staleStop, {
    runId: 'run_previous',
    sessionId,
    accepted: false,
    state: 'confirmed',
    outcome: 'completed',
    phase: 'completed',
    revision: 2,
  });

  resolveSuccessor({ runId: 'run_successor', sessionId, phase: 'completed' });
  await waitForTest(() => !session.isRunning());
});
