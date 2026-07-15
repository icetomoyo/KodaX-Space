import assert from 'node:assert/strict';
import path from 'node:path';
import test, { afterEach } from 'node:test';

import type {
  ConnectKodaXRuntimeOptions,
  KodaXDaemonRuntime,
  RuntimeConnectionState,
  RuntimeRunHandle,
  RuntimeRunResult,
} from '@kodax-ai/kodax/runtime';
import { RuntimeHostAdapter, resolveRuntimeHostMode } from '../kodax/runtime-host-adapter.js';
import {
  loadPersistedTranscript,
  setSessionStoreImpl,
  type SessionStoreImpl,
} from '../kodax/session-store.js';

afterEach(() => {
  setSessionStoreImpl(null);
});

const testIdentityStore = {
  openInstance: async ({ version }: { version: string }) => ({
    clientId: 'space_test',
    instanceId: 'space_instance_stable',
    instanceSecret: 'space_secret_stable_0123456789abcdef',
    name: 'kodax-space',
    title: 'KodaX Space',
    version,
  }),
};

const testRuntimeEventParser = (event: unknown) => ({
  ok: true as const,
  event: event as import('@kodax-ai/kodax/runtime').RuntimeTypedEvent,
});

function createFakeRuntime() {
  const calls = {
    created: [] as unknown[],
    loaded: [] as string[],
    started: [] as unknown[],
    aborted: [] as string[],
    transcripts: [] as string[],
    compacted: [] as unknown[],
    forked: [] as unknown[],
    rewound: [] as unknown[],
    close: 0,
    observed: [] as string[],
    settingsUpdates: [] as unknown[],
    credentialRegistrations: [] as unknown[],
    credentialBrokers: [] as Array<
      (request: {
        provider: string;
        sessionId: string;
        runId: string;
      }) => Promise<string | undefined>
    >,
    credentialRevokes: [] as string[],
    hostToolRegistrations: [] as unknown[],
    hostToolRevokes: [] as string[],
    submitted: [] as unknown[],
  };
  const sessions = new Set<string>();
  const settings = new Map<string, { revision: number; value: Record<string, unknown> }>();
  const pending = new Map<string, (result: RuntimeRunResult) => void>();
  const connectionListeners = new Set<(state: RuntimeConnectionState) => void>();
  let connectionState: RuntimeConnectionState = {
    state: 'connected',
    connectionId: 'connection_1',
    runtimeEpoch: 'runtime_epoch_1',
    journalEpoch: 'journal_epoch_1',
    reconnectable: true,
  };
  let runSeq = 0;
  const runtime = {
    identity: {
      runtimeId: 'rt_test',
      mode: 'daemon',
      profile: 'coder',
      startedAt: '2026-07-12T00:00:00.000Z',
      version: '0.7.69',
      isolation: 'process',
    },
    capabilities: {
      operationDeduplication: { version: 1, retentionMs: 900_000 },
      sessionObservation: { version: 1, maxBufferedEvents: 256 },
      afterTurnInput: { version: 1 },
      askUserTransport: { version: 1 },
      permissionCas: { version: 1 },
      providerCredentialBroker: { version: 1 },
      runBoundHostTools: { version: 1 },
      coderOwnerFencing: { version: 1 },
      crashOutcomeModel: { version: 1 },
      coderFeatureMatrix: { version: 1, managedRun: true, todoProjection: true },
      sessionAdmission: { version: 1 },
      completeObservationSnapshot: { version: 1 },
      connectionLifecycle: { version: 1 },
      typedRuntimeEvents: { version: 1 },
      daemonSafeRunInput: { version: 1 },
      sharedSessionSettings: { version: 1 },
      durableRecoveryQueries: { version: 1 },
    },
    grantedScopes: [
      'session:observe',
      'session:write',
      'run:control',
      'interaction:respond',
      'permission:respond',
      'credential:register',
      'host-tool:register',
    ],
    sessions: {
      async load(sessionId: string) {
        calls.loaded.push(sessionId);
        if (!sessions.has(sessionId)) throw new Error(`Session not found: ${sessionId}`);
        return { id: sessionId, title: '' };
      },
      async create(input: { sessionId?: string }) {
        calls.created.push(input);
        const id = input.sessionId ?? `s_${sessions.size + 1}`;
        sessions.add(id);
        settings.set(id, { revision: 0, value: {} });
        return { id, title: '' };
      },
      async transcript(sessionId: string) {
        calls.transcripts.push(sessionId);
        return { title: '', messages: [] };
      },
      async observe(sessionId: string) {
        calls.observed.push(sessionId);
        if (!sessions.has(sessionId)) throw new Error(`Session not found: ${sessionId}`);
        return {
          snapshot: {
            runtimeId: 'rt_test',
            cursor: 0,
            transcriptRevision: `transcript_${sessionId}_0`,
            session: { id: sessionId, title: '', surface: 'code' },
            transcript: { title: '', messages: [] },
            settings: settings.get(sessionId) ?? { revision: 0, value: {} },
            runs: [],
            pendingPermissions: [],
            live: {
              assistantTextByRun: {},
              thinkingTextByRun: {},
              activeTools: [],
              pendingUserInputs: [],
              managedTasks: [],
            },
          },
          close() {},
        };
      },
      async getSettings() {
        return {};
      },
      async getSettingsVersioned(sessionId: string) {
        return settings.get(sessionId) ?? { revision: 0, value: {} };
      },
      async updateSettingsVersioned(
        sessionId: string,
        patch: Record<string, unknown>,
        options: { expectedRevision: number },
      ) {
        calls.settingsUpdates.push({ sessionId, patch, options });
        const current = settings.get(sessionId) ?? { revision: 0, value: {} };
        if (current.revision !== options.expectedRevision) throw new Error('revision conflict');
        const value = { ...current.value };
        for (const [key, item] of Object.entries(patch)) {
          if (item === null) delete value[key];
          else value[key] = item;
        }
        const updated = { revision: current.revision + 1, value };
        settings.set(sessionId, updated);
        return updated;
      },
      async compact(input: unknown) {
        calls.compacted.push(input);
        return { compacted: true, tokensBefore: 200, tokensAfter: 80, messages: [] };
      },
      async fork(input: { sessionId: string }) {
        calls.forked.push(input);
        return { id: `${input.sessionId}_fork`, title: 'fork' };
      },
      async rewind(input: { sessionId: string }) {
        calls.rewound.push(input);
        return { id: input.sessionId, title: 'rewound' };
      },
      async delete() {},
    },
    runs: {
      async start(input: { sessionId: string }): Promise<RuntimeRunHandle> {
        calls.started.push(input);
        const runId = `run_${++runSeq}`;
        const result = new Promise<RuntimeRunResult>((resolve) => pending.set(runId, resolve));
        return { runId, sessionId: input.sessionId, result };
      },
      async abort(runId: string) {
        calls.aborted.push(runId);
        const resolve = pending.get(runId);
        resolve?.({ runId, sessionId: 's_1', phase: 'cancelled' });
        pending.delete(runId);
      },
      async list() {
        return [];
      },
      async get(runId: string) {
        return {
          runId,
          sessionId: 's_1',
          phase: 'running',
          startedAt: '2026-07-12T00:00:00.000Z',
          provider: 'anthropic',
        };
      },
      async submitInput(input: unknown) {
        calls.submitted.push(input);
        return {
          accepted: true,
          runId: `run_${++runSeq}`,
          sessionId: 's_1',
          delivery: 'after_turn',
        };
      },
    },
    events: { subscribe: () => ({ close() {} }), replay: async () => [] },
    permissions: { listPending: async () => [] },
    userInputs: { listPending: async () => [] },
    credentials: {
      register: async (
        options: unknown,
        broker: (request: {
          provider: string;
          sessionId: string;
          runId: string;
        }) => Promise<string | undefined>,
      ) => {
        calls.credentialRegistrations.push(options);
        calls.credentialBrokers.push(broker);
        return { id: `credential_${calls.credentialRegistrations.length}`, providers: [] };
      },
      revoke: async (leaseId: string) => {
        calls.credentialRevokes.push(leaseId);
        return true;
      },
      resume: async (leaseId: string) => ({ id: leaseId, providers: [] }),
    },
    hostTools: {
      register: async (descriptors: unknown, handlers: unknown) => {
        calls.hostToolRegistrations.push({ descriptors, handlers });
        return { id: 'tools_1', tools: [] };
      },
      revoke: async (leaseId: string) => {
        calls.hostToolRevokes.push(leaseId);
        return true;
      },
      resume: async (leaseId: string) => ({ id: leaseId, tools: [] }),
      getInvocation: async () => undefined,
    },
    operations: {
      get: async () => {
        throw new Error('operation not found');
      },
    },
    workflows: {},
    config: {},
    catalog: {},
    mcp: {},
    artifacts: {},
    status: {
      snapshot: async () => ({
        runtimeId: 'rt_test',
        mode: 'daemon',
        profile: 'coder',
        startedAt: '2026-07-12T00:00:00.000Z',
        sessions: [...sessions].map((id) => ({ id, title: '', surface: 'code', msgCount: 0 })),
        runs: [],
        pendingPermissions: [],
        workflows: [],
      }),
      preflight: async () => ({
        runtimeId: 'rt_test',
        clientCount: 1,
        activeRuns: [],
        queuedRuns: [],
        pendingPermissions: [],
        pendingUserInputs: [],
        blockers: ['connected_clients'],
        canStop: false,
      }),
    },
    connection: {
      current: () => connectionState,
      subscribe: (listener: (state: RuntimeConnectionState) => void) => {
        connectionListeners.add(listener);
        listener(connectionState);
        return { close: () => connectionListeners.delete(listener) };
      },
    },
    diagnostics: {},
    admin: { agentRegistrations: {} },
    agents: { enabled: false },
    agentTasks: {},
    async close() {
      calls.close += 1;
    },
  } as unknown as KodaXDaemonRuntime;
  return {
    runtime,
    calls,
    sessions,
    pending,
    settings,
    disconnect(reconnectable = true) {
      connectionState = {
        ...connectionState,
        state: 'disconnected',
        reason: 'test transport loss',
        reconnectable,
      };
      for (const listener of connectionListeners) listener(connectionState);
    },
  };
}

test('resolveRuntimeHostMode defaults to runtime and accepts explicit legacy rollback', () => {
  assert.equal(resolveRuntimeHostMode(undefined), 'runtime');
  assert.equal(resolveRuntimeHostMode('runtime'), 'runtime');
  assert.equal(resolveRuntimeHostMode('legacy'), 'legacy');
  assert.equal(resolveRuntimeHostMode('unexpected'), 'runtime');
});

test('legacy selection never constructs a KodaX Runtime', async () => {
  let factoryCalls = 0;
  const adapter = new RuntimeHostAdapter({
    mode: 'legacy',
    profileRoot: 'C:\\isolated-profile',
    runtimeFactory: async () => {
      factoryCalls += 1;
      return createFakeRuntime().runtime;
    },
  });

  await adapter.initialize();
  assert.equal(factoryCalls, 0);
  assert.equal(adapter.snapshot().selectedHost, 'legacy');
  assert.equal(adapter.snapshot().state, 'legacy');
  assert.equal(
    adapter.snapshot().capabilities.find((item) => item.id === 'runtime.runs')?.owner,
    'legacy',
  );
});

test('runtime selection attaches one Coder daemon with stable identity and required contracts', async () => {
  const fake = createFakeRuntime();
  const options: ConnectKodaXRuntimeOptions[] = [];
  const profileRoot = path.resolve('C:\\isolated-profile');
  const adapter = new RuntimeHostAdapter({
    mode: 'runtime',
    profileRoot,
    runtimeFactory: async (input) => {
      options.push(input);
      return fake.runtime;
    },
    identityStore: {
      openInstance: async () => ({
        clientId: 'space_test',
        instanceId: 'space_instance_stable',
        instanceSecret: 'space_secret_stable_0123456789abcdef',
        name: 'kodax-space',
        title: 'KodaX Space',
        version: '0.1.30',
      }),
    },
  });

  await Promise.all([adapter.initialize('0.1.30'), adapter.initialize('ignored-after-start')]);
  assert.equal(options.length, 1);
  assert.equal(options[0]?.profile, 'coder');
  assert.equal(options[0]?.autoStart, true);
  assert.equal(options[0]?.homeDir, profileRoot);
  assert.equal(options[0]?.sessionsDir, path.join(profileRoot, 'sessions'));
  assert.equal(options[0]?.clientInfo?.version, '0.1.30');
  assert.equal(options[0]?.clientInfo?.instanceId, 'space_instance_stable');
  assert.equal(options[0]?.clientInfo?.instanceSecret, 'space_secret_stable_0123456789abcdef');
  assert.equal(options[0]?.requirements?.sessionObservation, 1);
  assert.equal(options[0]?.requirements?.coderFeatureMatrix, 1);
  assert.equal(options[0]?.requirements?.sessionAdmission, 1);
  assert.equal(options[0]?.requirements?.completeObservationSnapshot, 1);
  assert.equal(options[0]?.requirements?.connectionLifecycle, 1);
  assert.equal(options[0]?.requirements?.typedRuntimeEvents, 1);
  assert.equal(options[0]?.requirements?.daemonSafeRunInput, 1);
  assert.equal(options[0]?.requirements?.sharedSessionSettings, 1);
  assert.equal(options[0]?.requirements?.durableRecoveryQueries, 1);
  assert.equal(adapter.snapshot().state, 'ready');
  assert.equal(adapter.snapshot().identity?.runtimeId, 'rt_test');
  assert.equal(
    adapter.snapshot().capabilities.find((item) => item.id === 'runtime.runs')?.owner,
    'runtime',
  );
  assert.deepEqual(
    adapter.snapshot().capabilities.find((item) => item.id === 'runtime.sessions'),
    {
      id: 'runtime.sessions',
      support: 'partial',
      owner: 'space-bridge',
      reason:
        'Runtime owns transcript, compact, fork, and rewind; Space retains compatible list, resume, title, and delete projections.',
    },
  );
  assert.equal(
    adapter.snapshot().capabilities.find((item) => item.id === 'runtime.externalAgents')?.owner,
    'space-bridge',
  );
  assert.equal((await adapter.preflightDaemonStop()).canStop, false);
});

test('daemon connection lifecycle invalidates Runtime authority without waiting for polling', async () => {
  const fake = createFakeRuntime();
  const adapter = new RuntimeHostAdapter({
    mode: 'runtime',
    profileRoot: path.resolve('C:\\isolated-profile'),
    runtimeFactory: async () => fake.runtime,
    identityStore: testIdentityStore,
    runtimeEventParser: testRuntimeEventParser,
  });

  await adapter.initialize();
  fake.disconnect(false);
  await new Promise<void>((resolve) => setImmediate(resolve));

  assert.equal(adapter.hasReadyRuntime(), false);
  assert.equal(adapter.snapshot().state, 'failed');
  assert.match(adapter.snapshot().error ?? '', /transport loss/);
  await adapter.close();
});

test('supported session operations use the Runtime facade', async () => {
  const fake = createFakeRuntime();
  fake.sessions.add('s_1');
  const adapter = new RuntimeHostAdapter({
    mode: 'runtime',
    profileRoot: path.resolve('C:\\isolated-profile'),
    runtimeFactory: async () => fake.runtime,
    identityStore: testIdentityStore,
    runtimeEventParser: testRuntimeEventParser,
  });

  await adapter.transcript('s_1');
  await adapter.compactSession({ sessionId: 's_1', provider: 'mock' });
  await adapter.forkSession({ sessionId: 's_1', selector: 'entry_1' });
  await adapter.rewindSession({ sessionId: 's_1', selector: 'entry_0' });

  assert.deepEqual(fake.calls.transcripts, ['s_1']);
  assert.deepEqual(fake.calls.compacted, [{ sessionId: 's_1', provider: 'mock' }]);
  assert.deepEqual(fake.calls.forked, [{ sessionId: 's_1', selector: 'entry_1' }]);
  assert.deepEqual(fake.calls.rewound, [{ sessionId: 's_1', selector: 'entry_0' }]);
});

test('Runtime session mutations invalidate the Space transcript compatibility cache', async () => {
  let transcriptReads = 0;
  setSessionStoreImpl({
    listSessions: async () => [],
    forkSession: async () => null,
    rewindSession: async () => null,
    deleteSession: async () => ({ ok: true }),
    loadSession: async () => null,
    loadFullTranscript: async () => {
      transcriptReads += 1;
      return { title: '', messages: [] } as never;
    },
    watchSessions: () => ({ close() {} }),
  } as SessionStoreImpl);
  const fake = createFakeRuntime();
  fake.sessions.add('s_1');
  const adapter = new RuntimeHostAdapter({
    mode: 'runtime',
    profileRoot: path.resolve('C:\\isolated-profile'),
    runtimeFactory: async () => fake.runtime,
    identityStore: testIdentityStore,
  });

  await loadPersistedTranscript('s_1');
  await loadPersistedTranscript('s_1');
  assert.equal(transcriptReads, 1);

  await adapter.compactSession({ sessionId: 's_1', provider: 'mock' });
  await loadPersistedTranscript('s_1');
  assert.equal(transcriptReads, 2);

  await adapter.rewindSession({ sessionId: 's_1', selector: 'entry_0' });
  await loadPersistedTranscript('s_1');
  assert.equal(transcriptReads, 3);
});

test('ensureSession accepts Coder only and rejects Partner before daemon access', async () => {
  const fake = createFakeRuntime();
  fake.sessions.add('s_existing');
  const adapter = new RuntimeHostAdapter({
    mode: 'runtime',
    profileRoot: path.resolve('C:\\isolated-profile'),
    runtimeFactory: async () => fake.runtime,
    identityStore: testIdentityStore,
  });

  await adapter.ensureSession({
    sessionId: 's_existing',
    projectRoot: 'C:\\repo',
    surface: 'code',
    ephemeral: false,
  });
  await assert.rejects(
    adapter.ensureSession({
      sessionId: 's_partner',
      projectRoot: 'C:\\repo',
      surface: 'partner',
      ephemeral: false,
    }),
    /Partner.*inline/i,
  );
  await adapter.ensureSession({
    sessionId: 's_new',
    projectRoot: 'C:\\repo',
    surface: 'code',
    ephemeral: false,
  });

  assert.deepEqual(fake.calls.loaded, ['s_existing', 's_new']);
  assert.equal(fake.calls.created.length, 1);
  assert.deepEqual(fake.calls.created[0], {
    sessionId: 's_new',
    projectPath: 'C:\\repo',
    gitRoot: 'C:\\repo',
    surface: 'space-desktop',
    tag: 'code',
  });
});

test('managed run tracking aborts the active Runtime run and close is idempotent', async () => {
  const fake = createFakeRuntime();
  const adapter = new RuntimeHostAdapter({
    mode: 'runtime',
    profileRoot: path.resolve('C:\\isolated-profile'),
    runtimeFactory: async () => fake.runtime,
    identityStore: testIdentityStore,
    runtimeEventParser: testRuntimeEventParser,
  });
  await adapter.ensureSession({
    sessionId: 's_1',
    projectRoot: 'C:\\repo',
    surface: 'code',
    ephemeral: false,
  });

  const handle = await adapter.startManagedRun({
    sessionId: 's_1',
    prompt: 'hello',
    mode: 'managed_task',
    options: { provider: 'mock' },
  });
  assert.equal(handle.runId, 'run_1');
  assert.equal(adapter.activeRunId('s_1'), 'run_1');
  await adapter.abortSessionRun('s_1');
  assert.deepEqual(fake.calls.aborted, ['run_1']);
  await handle.result;
  assert.equal(adapter.activeRunId('s_1'), undefined);

  await adapter.close();
  await adapter.close();
  assert.equal(fake.calls.close, 1);
  assert.deepEqual(fake.calls.hostToolRevokes, []);
});

test('same-session starts are delegated to daemon ordering instead of rejected locally', async () => {
  const fake = createFakeRuntime();
  fake.sessions.add('s_1');
  const adapter = new RuntimeHostAdapter({
    mode: 'runtime',
    profileRoot: path.resolve('C:\\isolated-profile'),
    runtimeFactory: async () => fake.runtime,
    identityStore: testIdentityStore,
    runtimeEventParser: testRuntimeEventParser,
  });
  await adapter.initialize();

  const firstStart = adapter.startManagedRun({
    sessionId: 's_1',
    prompt: 'first',
    options: { provider: 'mock' },
  });
  const secondStart = adapter.startManagedRun({
    sessionId: 's_1',
    prompt: 'second',
    options: { provider: 'mock' },
  });
  const [first, second] = await Promise.all([firstStart, secondStart]);
  assert.equal(fake.calls.started.length, 2);
  assert.notEqual(first.runId, second.runId);
});

test('close racing initialization closes the late Runtime exactly once', async () => {
  const fake = createFakeRuntime();
  let releaseFactory: ((runtime: KodaXDaemonRuntime) => void) | undefined;
  const adapter = new RuntimeHostAdapter({
    mode: 'runtime',
    profileRoot: path.resolve('C:\\isolated-profile'),
    runtimeFactory: () =>
      new Promise<KodaXDaemonRuntime>((resolve) => {
        releaseFactory = resolve;
      }),
    identityStore: testIdentityStore,
  });

  const initialization = adapter.initialize();
  await Promise.resolve();
  const closing = adapter.close();
  releaseFactory?.(fake.runtime);
  await Promise.all([initialization, closing]);

  assert.equal(adapter.snapshot().state, 'closed');
  assert.equal(adapter.hasReadyRuntime(), false);
  assert.equal(fake.calls.close, 1);
});

test('initialization closes a constructed Runtime when host-tool registration fails', async () => {
  const fake = createFakeRuntime();
  fake.runtime.hostTools.register = async () => {
    throw new Error('host tool registration failed');
  };
  const adapter = new RuntimeHostAdapter({
    mode: 'runtime',
    profileRoot: path.resolve('C:\\isolated-profile'),
    runtimeFactory: async () => fake.runtime,
    identityStore: testIdentityStore,
  });

  await assert.rejects(adapter.initialize(), /host tool registration failed/);
  assert.equal(adapter.snapshot().state, 'failed');
  assert.equal(fake.calls.close, 1);
});

test('session settings use revisioned CAS and skip unchanged values', async () => {
  const fake = createFakeRuntime();
  fake.sessions.add('s_1');
  fake.settings.set('s_1', { revision: 2, value: { provider: 'anthropic' } });
  const adapter = new RuntimeHostAdapter({
    mode: 'runtime',
    profileRoot: path.resolve('C:\\isolated-profile'),
    runtimeFactory: async () => fake.runtime,
    identityStore: testIdentityStore,
  });

  await adapter.updateSessionSettings('s_1', { provider: 'anthropic' });
  assert.equal(fake.calls.settingsUpdates.length, 0);
  await adapter.updateSessionSettings('s_1', {
    model: 'claude-next',
    agentMode: 'amaw',
    autoModeEngine: 'rules',
  });
  assert.deepEqual(fake.calls.settingsUpdates, [
    {
      sessionId: 's_1',
      patch: { model: 'claude-next', agentMode: 'amaw', autoModeEngine: 'rules' },
      options: { expectedRevision: 2 },
    },
  ]);
});

test('Space-started runs receive scoped credential and host-tool leases', async () => {
  const fake = createFakeRuntime();
  fake.sessions.add('s_1');
  const adapter = new RuntimeHostAdapter({
    mode: 'runtime',
    profileRoot: path.resolve('C:\\isolated-profile'),
    runtimeFactory: async () => fake.runtime,
    identityStore: testIdentityStore,
    runtimeEventParser: testRuntimeEventParser,
    credentialResolver: async (provider) =>
      provider === 'anthropic' ? 'secret-from-keychain' : undefined,
  });

  const handle = await adapter.startManagedRun({
    sessionId: 's_1',
    prompt: 'hello',
    options: { provider: 'anthropic' },
  });
  const started = fake.calls.started[0] as {
    credential?: { leaseId: string; provider: string };
    hostTools?: { leaseId: string };
  };
  assert.deepEqual(started.credential, {
    leaseId: 'credential_1',
    provider: 'anthropic',
  });
  assert.deepEqual(started.hostTools, { leaseId: 'tools_1' });
  const registration = fake.calls.hostToolRegistrations[0] as {
    descriptors: readonly { name: string }[];
  };
  assert.ok(registration.descriptors.some((item) => item.name === 'create_artifact'));
  assert.ok(registration.descriptors.some((item) => item.name === 'create_office_artifact'));
  const broker = fake.calls.credentialBrokers[0];
  assert.ok(broker);
  assert.equal(
    await broker({ provider: 'anthropic', sessionId: 'wrong', runId: handle.runId }),
    undefined,
  );
  assert.equal(
    await broker({ provider: 'anthropic', sessionId: 's_1', runId: handle.runId }),
    'secret-from-keychain',
  );
  assert.equal(
    await broker({ provider: 'anthropic', sessionId: 's_1', runId: 'other_run' }),
    undefined,
  );
  fake.pending.get(handle.runId)?.({
    runId: handle.runId,
    sessionId: 's_1',
    phase: 'completed',
  });
  await handle.result;
  assert.deepEqual(fake.calls.credentialRevokes, ['credential_1']);
});
