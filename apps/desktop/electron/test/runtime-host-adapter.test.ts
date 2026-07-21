import assert from 'node:assert/strict';
import path from 'node:path';
import test, { afterEach } from 'node:test';

import type {
  ConnectKodaXRuntimeOptions,
  KodaXDaemonRuntime,
  RuntimeConnectionState,
  RuntimeDaemonManagementState,
  RuntimeRunHandle,
  RuntimeRunResult,
} from '@kodax-ai/kodax/runtime';
import { RuntimeHostAdapter, resolveRuntimeHostMode } from '../kodax/runtime-host-adapter.js';
import { kodaxHost } from '../kodax/host.js';
import {
  SessionRuntimeStore,
  setSessionRuntimeStoreForTesting,
} from '../kodax/session-runtime-store.js';
import {
  loadPersistedTranscript,
  setSessionStoreImpl,
  type SessionStoreImpl,
} from '../kodax/session-store.js';
import {
  RuntimeProjectionController,
  RuntimeProjectionUnavailableError,
  createPendingSdkRuntimeProjection,
} from '../kodax/runtime/runtime-projection-controller.js';
import { encodeRuntimeActorTaskId } from '../kodax/runtime/runtime-agent-projection.js';

afterEach(() => {
  setSessionStoreImpl(null);
  setSessionRuntimeStoreForTesting(null);
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
    observationCloses: 0,
    observed: [] as string[],
    settingsUpdates: [] as Array<{
      sessionId: string;
      patch: Record<string, unknown>;
      options: { expectedRevision: number };
    }>,
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
    daemonInspections: 0,
    daemonStops: [] as unknown[],
    permissionGrantRevokes: [] as Array<{ grantId: string; expectedRevision: number }>,
    permissionResponses: [] as Array<{
      requestId: string;
      decision: unknown;
      options: unknown;
    }>,
    workflowControls: [] as Array<{ action: string; runId: string }>,
    learningControls: [] as Array<{ action: string; nameOrSlug: string }>,
  };
  const sessions = new Set<string>();
  const settings = new Map<string, { revision: number; value: Record<string, unknown> }>();
  const permissionRequests: import('@kodax-ai/kodax/runtime').RuntimePermissionRequest[] = [];
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
      version: '0.7.74',
      isolation: 'process',
    },
    capabilities: {
      externalAgentAdmin: { version: 1 },
      actorControlPlane: { version: 1, methodNamespace: 'agents' },
      learningCenter: { version: 1 },
      a2aConfigReconciler: { version: 1 },
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
      contextCompaction: { version: 2 },
      transcriptPaging: { version: 1 },
      connectionLifecycle: { version: 1 },
      typedRuntimeEvents: { version: 1 },
      daemonSafeRunInput: { version: 1 },
      sharedSessionSettings: { version: 1 },
      durableRecoveryQueries: { version: 1 },
      daemonManagement: {
        version: 1,
        reverseBridgeDrainingFence: true,
        backgroundWorkPreflight: true,
      },
      runtimeAutoModeGuardrail: { version: 3, owner: 'session-runtime' },
    },
    grantedScopes: [
      'session:observe',
      'session:write',
      'run:control',
      'interaction:respond',
      'permission:respond',
      'permission:grant-admin',
      'learning:read',
      'learning:control',
      'credential:register',
      'host-tool:register',
      'owner:admin',
      'daemon:admin',
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
      async transcriptPage() {
        return null;
      },
      async transcriptEntryChunk() {
        return null;
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
          close() {
            calls.observationCloses += 1;
          },
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
      async delete(sessionId: string) {
        sessions.delete(sessionId);
      },
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
    permissions: {
      listPending: async () => permissionRequests,
      respond: async (requestId: string, decision: unknown, options: unknown) => {
        calls.permissionResponses.push({ requestId, decision, options });
        return true;
      },
      listGrants: async () => ({
        revision: 3,
        value: [
          {
            id: 'grant_1',
            scope: { toolName: 'bash', sessionId: 's_1' },
            createdAt: '2026-07-12T00:00:00.000Z',
          },
        ],
      }),
      revokeGrant: async (grantId: string, expectedRevision: number) => {
        calls.permissionGrantRevokes.push({ grantId, expectedRevision });
        return true;
      },
    },
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
    workflows: {
      list: async () => [],
      get: async () => undefined,
      subscribe: () => ({ ready: Promise.resolve(), close() {} }),
      pause: async (runId: string) => {
        calls.workflowControls.push({ action: 'pause', runId });
        return true;
      },
      resume: async (runId: string) => {
        calls.workflowControls.push({ action: 'resume', runId });
        return true;
      },
      stop: async (runId: string) => {
        calls.workflowControls.push({ action: 'stop', runId });
        return true;
      },
    },
    learning: {
      list: async () => ({ items: [], revision: 1 }),
      get: async (nameOrSlug: string) => ({ slug: nameOrSlug }),
      getSnapshot: async () => ({ ready: 0, newlyActive: 0, attention: 0, active: 0, revision: 1 }),
      review: async (nameOrSlug: string) => {
        calls.learningControls.push({ action: 'review', nameOrSlug });
      },
      trust: async (nameOrSlug: string) => {
        calls.learningControls.push({ action: 'trust', nameOrSlug });
      },
      reject: async (nameOrSlug: string) => {
        calls.learningControls.push({ action: 'reject', nameOrSlug });
      },
      disable: async (nameOrSlug: string) => {
        calls.learningControls.push({ action: 'disable', nameOrSlug });
      },
      rollback: async (nameOrSlug: string) => {
        calls.learningControls.push({ action: 'rollback', nameOrSlug });
      },
    },
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
        activeWorkflows: [],
        activeAgentTurns: [],
        pendingPermissions: [],
        pendingUserInputs: [],
        blockers: [],
        canStop: true,
      }),
    },
    daemon: {
      inspect: async (): Promise<RuntimeDaemonManagementState> => {
        calls.daemonInspections += 1;
        return {
          runtimeId: 'rt_test',
          revision: 7,
          ownerPolicy: {
            mode: 'daemon',
            revision: 2,
            updatedAt: '2026-07-12T00:00:00.000Z',
          },
          owner: {
            runtimeId: 'rt_test',
            pid: 123,
            createdAt: '2026-07-12T00:00:00.000Z',
            kind: 'daemon',
          },
          preflight: {
            runtimeId: 'rt_test',
            clientCount: 1,
            activeRuns: [],
            queuedRuns: [],
            activeWorkflows: [],
            activeAgentTurns: [],
            activeAgentTasks: [],
            pendingPermissions: [],
            pendingUserInputs: [],
            blockers: [],
            canStop: true,
          },
        };
      },
      stopForInline: async (input: unknown) => {
        calls.daemonStops.push(input);
        return {
          accepted: true as const,
          runtimeId: 'rt_test',
          revision: 8,
          ownerPolicy: {
            mode: 'inline' as const,
            revision: 3,
            updatedAt: '2026-07-12T00:00:01.000Z',
          },
        };
      },
    },
    connection: {
      current: () => connectionState,
      subscribe: (listener: (state: RuntimeConnectionState) => void) => {
        connectionListeners.add(listener);
        listener(connectionState);
        return { ready: Promise.resolve(), close: () => connectionListeners.delete(listener) };
      },
    },
    diagnostics: {},
    admin: { agentRegistrations: {} },
    agents: { enabled: false },
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
    permissionRequests,
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
  let inlineOwnerCloses = 0;
  const adapter = new RuntimeHostAdapter({
    mode: 'legacy',
    profileRoot: 'C:\\isolated-profile',
    runtimeFactory: async () => {
      factoryCalls += 1;
      return createFakeRuntime().runtime;
    },
    ownerControl: {
      acquireInline: async () => ({
        profile: 'coder',
        ownerId: 'inline_test',
        ownerPolicy: {
          mode: 'inline',
          revision: 1,
          updatedAt: '2026-07-12T00:00:00.000Z',
        },
        close: () => {
          inlineOwnerCloses += 1;
        },
      }),
      getState: async () => ({
        profile: 'coder',
        policy: {
          mode: 'inline',
          revision: 1,
          updatedAt: '2026-07-12T00:00:00.000Z',
        },
        ownerStatus: 'unowned',
        owner: null,
      }),
      enableDaemon: async () => ({
        mode: 'daemon',
        revision: 2,
        updatedAt: '2026-07-12T00:00:01.000Z',
      }),
    },
  });

  await adapter.initialize();
  assert.equal(factoryCalls, 0);
  assert.equal(adapter.hasLegacyOwner(), true);
  await adapter.ensureLegacyOwner();
  assert.equal(adapter.snapshot().selectedHost, 'legacy');
  assert.equal(adapter.snapshot().state, 'legacy');
  assert.equal(
    adapter.snapshot().capabilities.find((item) => item.id === 'runtime.runs')?.owner,
    'legacy',
  );
  await adapter.close();
  assert.equal(inlineOwnerCloses, 1);
  assert.equal(adapter.hasLegacyOwner(), false);
  await assert.rejects(adapter.ensureLegacyOwner(), /closed/);
});

test('legacy owner acquisition failure reports inline Coder as unavailable', async () => {
  const adapter = new RuntimeHostAdapter({
    mode: 'legacy',
    profileRoot: 'C:\\isolated-profile',
    ownerControl: {
      acquireInline: async () => {
        throw new Error('daemon still owns Coder');
      },
      getState: async () => ({
        profile: 'coder',
        policy: {
          mode: 'daemon',
          revision: 1,
          updatedAt: '2026-07-12T00:00:00.000Z',
        },
        ownerStatus: 'owned',
        owner: null,
      }),
      enableDaemon: async () => ({
        mode: 'daemon',
        revision: 1,
        updatedAt: '2026-07-12T00:00:00.000Z',
      }),
    },
  });

  await assert.rejects(adapter.initialize(), /daemon still owns Coder/);
  const snapshot = adapter.snapshot();
  assert.equal(snapshot.state, 'failed');
  assert.equal(
    snapshot.capabilities.find((item) => item.id === 'runtime.host')?.support,
    'unavailable',
  );
  assert.equal(
    snapshot.capabilities.find((item) => item.id === 'runtime.runs')?.support,
    'unavailable',
  );
  await adapter.close();
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
  assert.equal(
    options[0]?.homeDir,
    undefined,
    'default daemon selection must follow KODAX_HOME instead of treating the .kodax root as CLI homeDir',
  );
  assert.equal(options[0]?.sessionsDir, path.join(profileRoot, 'sessions'));
  assert.equal(options[0]?.clientInfo?.version, '0.1.30');
  assert.equal(options[0]?.clientInfo?.instanceId, 'space_instance_stable');
  assert.equal(options[0]?.clientInfo?.instanceSecret, 'space_secret_stable_0123456789abcdef');
  assert.equal(options[0]?.requirements?.sessionObservation, 1);
  assert.equal(options[0]?.requirements?.externalAgents, true);
  assert.equal(options[0]?.requirements?.externalAgentAdmin, 1);
  assert.equal(options[0]?.requirements?.actorControlPlane, 1);
  assert.equal(options[0]?.requirements?.learningCenter, 1);
  assert.equal(options[0]?.requirements?.a2aConfigReconciler, 1);
  assert.equal(options[0]?.requirements?.coderFeatureMatrix, 1);
  assert.equal(options[0]?.requirements?.sessionAdmission, 1);
  assert.equal(options[0]?.requirements?.completeObservationSnapshot, 1);
  assert.equal(options[0]?.requirements?.contextCompaction, 2);
  assert.equal(options[0]?.requirements?.transcriptPaging, 1);
  assert.equal(options[0]?.requirements?.connectionLifecycle, 1);
  assert.equal(options[0]?.requirements?.typedRuntimeEvents, 1);
  assert.equal(options[0]?.requirements?.daemonSafeRunInput, 1);
  assert.equal(options[0]?.requirements?.sharedSessionSettings, 1);
  assert.equal(options[0]?.requirements?.durableRecoveryQueries, 1);
  assert.equal(options[0]?.requirements?.daemonManagement, 1);
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
    'runtime',
  );
  assert.equal((await adapter.preflightDaemonStop()).canStop, true);
  assert.equal(fake.calls.daemonInspections, 1);
});

test('transient unhealthy daemon startup retries until the existing safety window clears', async () => {
  const fake = createFakeRuntime();
  let factoryCalls = 0;
  const adapter = new RuntimeHostAdapter({
    mode: 'runtime',
    profileRoot: path.resolve('C:\\isolated-profile'),
    runtimeFactory: async () => {
      factoryCalls += 1;
      if (factoryCalls === 1) {
        throw new Error('Runtime daemon is unhealthy; refusing to start a competing owner.');
      }
      return fake.runtime;
    },
    identityStore: testIdentityStore,
    runtimeEventParser: testRuntimeEventParser,
  });
  (adapter as unknown as { reconnectAttempt: number }).reconnectAttempt = -10;

  await assert.rejects(adapter.initialize(), /daemon is unhealthy/);
  assert.equal(adapter.snapshot().state, 'failed');

  const deadline = Date.now() + 2_000;
  while (!adapter.hasReadyRuntime() && Date.now() < deadline) {
    await new Promise<void>((resolve) => setTimeout(resolve, 20));
  }

  assert.equal(factoryCalls, 2);
  assert.equal(adapter.hasReadyRuntime(), true);
  await adapter.close();
});

test('transient startup retry stops if the daemon then reports a permanent incompatibility', async () => {
  let factoryCalls = 0;
  const adapter = new RuntimeHostAdapter({
    mode: 'runtime',
    profileRoot: path.resolve('C:\\isolated-profile'),
    runtimeFactory: async () => {
      factoryCalls += 1;
      if (factoryCalls === 1) {
        throw new Error('Runtime daemon is unhealthy; refusing to start a competing owner.');
      }
      throw new Error('Coder daemon capability upgrade required.');
    },
    identityStore: testIdentityStore,
    runtimeEventParser: testRuntimeEventParser,
  });
  (adapter as unknown as { reconnectAttempt: number }).reconnectAttempt = -10;

  await assert.rejects(adapter.initialize(), /daemon is unhealthy/);
  const deadline = Date.now() + 500;
  while (factoryCalls < 2 && Date.now() < deadline) {
    await new Promise<void>((resolve) => setTimeout(resolve, 5));
  }
  await new Promise<void>((resolve) => setTimeout(resolve, 50));

  assert.equal(factoryCalls, 2);
  assert.match(adapter.snapshot().error ?? '', /capability upgrade required/i);
  await adapter.close();
});

test('daemon rollback commits one inspected revision, waits for release, and restores owner explicitly', async () => {
  const fake = createFakeRuntime();
  let inlineOwnerCloses = 0;
  let daemonRestores = 0;
  let ownerReleased = false;
  const adapter = new RuntimeHostAdapter({
    mode: 'runtime',
    profileRoot: path.resolve('C:\\isolated-profile'),
    runtimeFactory: async () => fake.runtime,
    identityStore: testIdentityStore,
    runtimeEventParser: testRuntimeEventParser,
    ownerControl: {
      acquireInline: async () => ({
        profile: 'coder',
        ownerId: 'inline_after_daemon',
        ownerPolicy: {
          mode: 'inline',
          revision: 3,
          updatedAt: '2026-07-12T00:00:01.000Z',
        },
        close: () => {
          inlineOwnerCloses += 1;
        },
      }),
      getState: async () => ({
        profile: 'coder',
        policy: {
          mode: 'inline',
          revision: 3,
          updatedAt: '2026-07-12T00:00:01.000Z',
        },
        ownerStatus: ownerReleased ? 'unowned' : 'owned',
        owner: ownerReleased
          ? null
          : {
              runtimeId: 'rt_test',
              pid: 123,
              createdAt: '2026-07-12T00:00:00.000Z',
              kind: 'daemon',
            },
      }),
      enableDaemon: async () => {
        daemonRestores += 1;
        return {
          mode: 'daemon',
          revision: 4,
          updatedAt: '2026-07-12T00:00:02.000Z',
        };
      },
    },
  });
  const originalStop = fake.runtime.daemon.stopForInline.bind(fake.runtime.daemon);
  fake.runtime.daemon.stopForInline = async (input) => {
    const result = await originalStop(input);
    ownerReleased = true;
    return result;
  };

  await adapter.initialize();
  const inspection = await adapter.inspectDaemonStop();
  const rollback = await adapter.prepareInlineRollback('space-operation-1');

  assert.equal(inspection.revision, 7);
  assert.equal(rollback.accepted, true);
  assert.deepEqual(fake.calls.daemonStops, [
    {
      expectedRuntimeId: 'rt_test',
      expectedRevision: 7,
      expectedOwnerPolicyRevision: 2,
      operation: { operationId: 'space-operation-1' },
    },
  ]);
  assert.equal(adapter.snapshot().state, 'closed');
  assert.equal(fake.calls.close, 1);
  assert.equal(inlineOwnerCloses, 0);

  const restored = await adapter.restoreDaemonOwner();
  assert.equal(restored.mode, 'daemon');
  assert.equal(daemonRestores, 1);
  assert.equal(inlineOwnerCloses, 1);
});

test('daemon rollback restores daemon policy when inline owner acquisition fails after stop', async () => {
  const fake = createFakeRuntime();
  let daemonRestores = 0;
  const adapter = new RuntimeHostAdapter({
    mode: 'runtime',
    profileRoot: path.resolve('C:\\isolated-profile'),
    runtimeFactory: async () => fake.runtime,
    identityStore: testIdentityStore,
    runtimeEventParser: testRuntimeEventParser,
    ownerControl: {
      acquireInline: async () => {
        throw new Error('inline acquisition failed');
      },
      getState: async () => ({
        profile: 'coder',
        policy: {
          mode: 'inline',
          revision: 3,
          updatedAt: '2026-07-12T00:00:01.000Z',
        },
        ownerStatus: 'unowned',
        owner: null,
      }),
      enableDaemon: async () => {
        daemonRestores += 1;
        return {
          mode: 'daemon',
          revision: 4,
          updatedAt: '2026-07-12T00:00:02.000Z',
        };
      },
    },
  });

  await adapter.initialize();
  await assert.rejects(adapter.prepareInlineRollback(), /inline acquisition failed/);

  assert.equal(fake.calls.close, 1);
  assert.equal(daemonRestores, 1);
  assert.equal(adapter.snapshot().state, 'closed');
  assert.equal(adapter.snapshot().error, undefined);
});

test('daemon owner restoration retains an inline fence and can be retried', async () => {
  const fake = createFakeRuntime();
  let inlineOwnerAcquisitions = 0;
  let inlineOwnerCloses = 0;
  let daemonRestores = 0;
  const adapter = new RuntimeHostAdapter({
    mode: 'runtime',
    profileRoot: path.resolve('C:\\isolated-profile'),
    runtimeFactory: async () => fake.runtime,
    identityStore: testIdentityStore,
    runtimeEventParser: testRuntimeEventParser,
    ownerControl: {
      acquireInline: async () => {
        inlineOwnerAcquisitions += 1;
        return {
          profile: 'coder',
          ownerId: `inline_after_daemon_${inlineOwnerAcquisitions}`,
          ownerPolicy: {
            mode: 'inline',
            revision: 3,
            updatedAt: '2026-07-12T00:00:01.000Z',
          },
          close: () => {
            inlineOwnerCloses += 1;
          },
        };
      },
      getState: async () => ({
        profile: 'coder',
        policy: {
          mode: 'inline',
          revision: 3,
          updatedAt: '2026-07-12T00:00:01.000Z',
        },
        ownerStatus: 'unowned',
        owner: null,
      }),
      enableDaemon: async () => {
        daemonRestores += 1;
        if (daemonRestores === 1) throw new Error('daemon enable failed');
        return {
          mode: 'daemon',
          revision: 4,
          updatedAt: '2026-07-12T00:00:02.000Z',
        };
      },
    },
  });

  await adapter.initialize();
  await adapter.prepareInlineRollback();
  await assert.rejects(adapter.restoreDaemonOwner(), /daemon enable failed/);

  assert.equal(inlineOwnerAcquisitions, 2);
  assert.equal(inlineOwnerCloses, 1);
  assert.equal(adapter.snapshot().state, 'closed');
  assert.match(adapter.snapshot().error ?? '', /daemon enable failed/);

  const restored = await adapter.restoreDaemonOwner();
  assert.equal(restored.mode, 'daemon');
  assert.equal(daemonRestores, 2);
  assert.equal(inlineOwnerCloses, 2);
  assert.equal(adapter.snapshot().error, undefined);
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

test('runtime selection accepts an explicit CLI-style base home without moving Space data', async () => {
  const fake = createFakeRuntime();
  const options: ConnectKodaXRuntimeOptions[] = [];
  const profileRoot = path.resolve('C:\\isolated-profile', '.kodax');
  const runtimeHomeDir = path.resolve('C:\\isolated-profile');
  const adapter = new RuntimeHostAdapter({
    mode: 'runtime',
    profileRoot,
    runtimeHomeDir,
    runtimeFactory: async (input) => {
      options.push(input);
      return fake.runtime;
    },
    identityStore: testIdentityStore,
  });

  await adapter.initialize();

  assert.equal(options[0]?.homeDir, runtimeHomeDir);
  assert.equal(options[0]?.sessionsDir, path.join(profileRoot, 'sessions'));
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

  assert.deepEqual(fake.calls.transcripts, []);
  assert.deepEqual(fake.calls.compacted, [{ sessionId: 's_1', provider: 'mock' }]);
  assert.deepEqual(fake.calls.observed, ['s_1']);
  assert.deepEqual(fake.calls.forked, [{ sessionId: 's_1', selector: 'entry_1' }]);
  assert.deepEqual(fake.calls.rewound, [{ sessionId: 's_1', selector: 'entry_0' }]);
});

test('oversized daemon transcripts are rebuilt from bounded pages and entry chunks', async () => {
  const fake = createFakeRuntime();
  fake.sessions.add('s_paged');
  const older = {
    entryId: 'entry_older',
    parentId: null,
    logicalId: 'logical_older',
    timestamp: '2026-07-21T00:00:00.000Z',
    type: 'message' as const,
    source: 'user' as const,
    message: { role: 'user' as const, content: 'older' },
    active: true,
  };
  const newer = {
    entryId: 'entry_newer',
    parentId: 'entry_older',
    logicalId: 'logical_newer',
    timestamp: '2026-07-21T00:01:00.000Z',
    type: 'message' as const,
    source: 'assistant' as const,
    message: { role: 'assistant' as const, content: 'newer' },
    active: true,
  };
  let legacyTranscriptCalled = false;
  Object.assign(fake.runtime.sessions, {
    transcript: async () => {
      legacyTranscriptCalled = true;
      throw new Error('use session.transcript.page and session.transcript.entryChunk');
    },
    transcriptPage: async (input: { cursor?: string }) =>
      input.cursor
        ? {
            revision: 'rev_1',
            entries: [
              { index: 0, entryId: older.entryId, byteLength: 100, oversized: false, entry: older },
            ],
            hasMore: false,
          }
        : {
            revision: 'rev_1',
            entries: [{ index: 1, entryId: newer.entryId, byteLength: 200_000, oversized: true }],
            hasMore: true,
            nextCursor: 'older-page',
          },
    transcriptEntryChunk: async () => ({
      revision: 'rev_1',
      entryIndex: 1,
      entryId: newer.entryId,
      encoding: 'base64-json' as const,
      data: Buffer.from(JSON.stringify(newer), 'utf8').toString('base64'),
      hasMore: false,
    }),
  });
  const adapter = new RuntimeHostAdapter({
    mode: 'runtime',
    profileRoot: path.resolve('C:\\isolated-profile'),
    runtimeFactory: async () => fake.runtime,
    identityStore: testIdentityStore,
    runtimeEventParser: testRuntimeEventParser,
  });

  const transcript = await adapter.transcript('s_paged');

  assert.deepEqual(
    transcript?.transcriptEntries.map((entry) => entry.entryId),
    ['entry_older', 'entry_newer'],
  );
  assert.deepEqual(
    transcript?.messages.map((message) => message.content),
    ['older', 'newer'],
  );
  assert.equal(legacyTranscriptCalled, false);
  await adapter.close();
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

test('initialization rejects a daemon older than the KodaX 0.7.74 release baseline', async () => {
  const fake = createFakeRuntime();
  (fake.runtime.identity as { version: string }).version = '0.7.69';
  const adapter = new RuntimeHostAdapter({
    mode: 'runtime',
    profileRoot: path.resolve('C:\\isolated-profile'),
    runtimeFactory: async () => fake.runtime,
    identityStore: testIdentityStore,
  });

  await assert.rejects(
    adapter.initialize(),
    /0\.7\.69.*required 0\.7\.74.*Restart the Coder daemon/i,
  );
  assert.equal(adapter.snapshot().state, 'failed');
  assert.equal(fake.calls.close, 1);
});

test('session settings use revisioned CAS and skip unchanged values', async () => {
  const fake = createFakeRuntime();
  fake.sessions.add('s_1');
  fake.settings.set('s_1', {
    revision: 2,
    value: { provider: 'anthropic', autoModeTimeoutMs: 20_000 },
  });
  const adapter = new RuntimeHostAdapter({
    mode: 'runtime',
    profileRoot: path.resolve('C:\\isolated-profile'),
    runtimeFactory: async () => fake.runtime,
    identityStore: testIdentityStore,
  });

  await adapter.updateSessionSettings('s_1', { provider: 'anthropic' });
  assert.equal(fake.calls.settingsUpdates.length, 0);
  await adapter.updateSessionSettings('s_1', { model: null, thinking: null });
  assert.equal(
    fake.calls.settingsUpdates.length,
    0,
    'clearing already-absent values must not consume a settings revision',
  );
  await adapter.updateSessionSettings('s_1', {
    model: 'claude-next',
    agentMode: 'ama',
    autoModeEngine: 'rules',
  });
  assert.deepEqual(fake.calls.settingsUpdates, [
    {
      sessionId: 's_1',
      patch: { model: 'claude-next', agentMode: 'ama', autoModeEngine: 'rules' },
      options: { expectedRevision: 2 },
    },
  ]);

  await adapter.updateSessionSettings('s_1', { model: null, thinking: null });
  assert.deepEqual(fake.calls.settingsUpdates.at(-1), {
    sessionId: 's_1',
    patch: { model: null, thinking: null },
    options: { expectedRevision: 3 },
  });
  assert.equal(fake.settings.get('s_1')?.value.model, undefined);
});

test('concurrent session settings updates serialize their revisioned CAS writes', async () => {
  const fake = createFakeRuntime();
  fake.sessions.add('s_1');
  fake.settings.set('s_1', { revision: 2, value: { autoModeTimeoutMs: 20_000 } });
  const adapter = new RuntimeHostAdapter({
    mode: 'runtime',
    profileRoot: path.resolve('C:\\isolated-profile'),
    runtimeFactory: async () => fake.runtime,
    identityStore: testIdentityStore,
  });

  await Promise.all([
    adapter.updateSessionSettings('s_1', { permissionMode: 'auto' }),
    adapter.updateSessionSettings('s_1', { autoModeEngine: 'llm' }),
  ]);

  assert.deepEqual(
    fake.calls.settingsUpdates.map(({ options }) => options.expectedRevision),
    [2, 3],
  );
  assert.deepEqual(fake.settings.get('s_1'), {
    revision: 4,
    value: { autoModeTimeoutMs: 20_000, permissionMode: 'auto', autoModeEngine: 'llm' },
  });
});

test('session settings admit a missing Coder session before its first send', async () => {
  const fake = createFakeRuntime();
  const adapter = new RuntimeHostAdapter({
    mode: 'runtime',
    profileRoot: path.resolve('C:\\isolated-profile'),
    runtimeFactory: async () => fake.runtime,
    identityStore: testIdentityStore,
    autoModeDefaultsResolver: async () => ({
      engine: 'llm',
      classifierModel: 'fast-provider:classifier',
      timeoutMs: 27_000,
      speculativeWindowMs: 640,
    }),
  });
  const patch = {
    provider: 'openai',
    model: 'gpt-5.4',
    thinking: null,
    reasoningMode: 'auto' as const,
    permissionMode: 'accept-edits' as const,
    executionCwd: path.resolve('C:\\project'),
    agentMode: 'ama' as const,
    autoModeEngine: 'llm' as const,
  };

  await adapter.updateSessionSettings('s_new', patch, {
    sessionId: 's_new',
    projectRoot: path.resolve('C:\\project'),
    surface: 'code',
    ephemeral: false,
  });

  assert.deepEqual(fake.calls.created, [
    {
      sessionId: 's_new',
      projectPath: path.resolve('C:\\project'),
      gitRoot: path.resolve('C:\\project'),
      surface: 'space-desktop',
      tag: 'code',
    },
  ]);
  assert.deepEqual(fake.calls.settingsUpdates, [
    {
      sessionId: 's_new',
      patch: {
        ...patch,
        autoModeClassifierModel: 'fast-provider:classifier',
        autoModeTimeoutMs: 27_000,
        autoModeSpeculativeWindowMs: 640,
      },
      options: { expectedRevision: 0 },
    },
  ]);
});

test('Auto LLM defaults fill missing settings without overwriting daemon session values', async () => {
  const fake = createFakeRuntime();
  fake.sessions.add('s_1');
  fake.settings.set('s_1', {
    revision: 4,
    value: {
      provider: 'anthropic',
      autoModeClassifierModel: 'other-client:classifier',
      autoModeTimeoutMs: 45_000,
      autoModeSpeculativeWindowMs: 750,
    },
  });
  const adapter = new RuntimeHostAdapter({
    mode: 'runtime',
    profileRoot: path.resolve('C:\\isolated-profile'),
    runtimeFactory: async () => fake.runtime,
    identityStore: testIdentityStore,
    autoModeDefaultsResolver: async () => ({
      engine: 'llm',
      classifierModel: 'space-default:classifier',
      timeoutMs: 20_000,
      speculativeWindowMs: 640,
    }),
  });

  await adapter.updateSessionSettings('s_1', { permissionMode: 'auto' });

  assert.deepEqual(fake.calls.settingsUpdates, [
    {
      sessionId: 's_1',
      patch: { permissionMode: 'auto' },
      options: { expectedRevision: 4 },
    },
  ]);
  assert.equal(fake.settings.get('s_1')?.value.autoModeClassifierModel, 'other-client:classifier');
  assert.equal(fake.settings.get('s_1')?.value.autoModeTimeoutMs, 45_000);
  assert.equal(fake.settings.get('s_1')?.value.autoModeSpeculativeWindowMs, 750);
});

test('Auto LLM default reconciliation retries CAS and preserves a concurrent client update', async () => {
  const fake = createFakeRuntime();
  fake.sessions.add('s_1');
  fake.settings.set('s_1', { revision: 0, value: {} });
  const update = fake.runtime.sessions.updateSettingsVersioned.bind(fake.runtime.sessions);
  let raced = false;
  fake.runtime.sessions.updateSettingsVersioned = async (sessionId, patch, options) => {
    if (!raced) {
      raced = true;
      fake.settings.set(sessionId, {
        revision: 1,
        value: {
          autoModeClassifierModel: 'other-client:classifier',
          autoModeTimeoutMs: 45_000,
          autoModeSpeculativeWindowMs: 750,
        },
      });
      const error = new Error(
        `Session settings revision ${options.expectedRevision} is stale; current revision is 1`,
      ) as Error & { code: string };
      error.code = 'revision_conflict';
      throw error;
    }
    return update(sessionId, patch, options);
  };
  const adapter = new RuntimeHostAdapter({
    mode: 'runtime',
    profileRoot: path.resolve('C:\\isolated-profile'),
    runtimeFactory: async () => fake.runtime,
    identityStore: testIdentityStore,
    autoModeDefaultsResolver: async () => ({
      engine: 'llm',
      classifierModel: 'space-default:classifier',
      timeoutMs: 20_000,
      speculativeWindowMs: 640,
    }),
  });

  await adapter.updateSessionSettings('s_1', { permissionMode: 'auto' });

  assert.deepEqual(fake.settings.get('s_1'), {
    revision: 2,
    value: {
      autoModeClassifierModel: 'other-client:classifier',
      autoModeTimeoutMs: 45_000,
      autoModeSpeculativeWindowMs: 750,
      permissionMode: 'auto',
    },
  });
  assert.deepEqual(fake.calls.settingsUpdates.at(-1), {
    sessionId: 's_1',
    patch: { permissionMode: 'auto' },
    options: { expectedRevision: 1 },
  });
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
    await broker({ provider: 'anthropic', sessionId: 's_1', runId: 'other_run' }),
    undefined,
  );
  assert.equal(
    await broker({ provider: 'anthropic', sessionId: 's_1', runId: handle.runId }),
    'secret-from-keychain',
  );
  fake.pending.get(handle.runId)?.({
    runId: handle.runId,
    sessionId: 's_1',
    phase: 'completed',
  });
  await handle.result;
  assert.deepEqual(fake.calls.credentialRevokes, ['credential_1']);
});

test('failed after-turn submission revokes its newly registered credential lease', async () => {
  const fake = createFakeRuntime();
  fake.sessions.add('s_1');
  fake.runtime.runs.submitInput = async () => {
    throw new Error('transport failed');
  };
  const adapter = new RuntimeHostAdapter({
    mode: 'runtime',
    profileRoot: path.resolve('C:\\isolated-profile'),
    runtimeFactory: async () => fake.runtime,
    identityStore: testIdentityStore,
    runtimeEventParser: testRuntimeEventParser,
    credentialResolver: async () => 'secret-from-keychain',
  });

  await assert.rejects(
    adapter.submitInput({
      sessionId: 's_1',
      afterRunId: 'run_previous',
      delivery: 'after_turn',
      input: [{ type: 'text', text: 'next' }],
    }),
    /transport failed/,
  );
  assert.deepEqual(fake.calls.credentialRevokes, ['credential_1']);
  await adapter.close();
});

test('interrupt submission reuses the active run bindings and returns the factual Runtime result', async () => {
  const fake = createFakeRuntime();
  fake.sessions.add('s_1');
  fake.runtime.runs.submitInput = async (input) => {
    fake.calls.submitted.push(input);
    return {
      accepted: true,
      delivery: 'interrupt',
      inputId: 'input_1',
      runId: 'run_previous',
      sessionId: 's_1',
      afterRunId: 'run_previous',
      sessionOrder: 1,
    };
  };
  const adapter = new RuntimeHostAdapter({
    mode: 'runtime',
    profileRoot: path.resolve('C:\\isolated-profile'),
    runtimeFactory: async () => fake.runtime,
    identityStore: testIdentityStore,
    runtimeEventParser: testRuntimeEventParser,
    credentialResolver: async () => 'secret-from-keychain',
  });

  const result = await adapter.submitInput({
    sessionId: 's_1',
    afterRunId: 'run_previous',
    delivery: 'interrupt',
    input: [{ type: 'text', text: 'steer now' }],
  });

  assert.deepEqual(result, {
    accepted: true,
    delivery: 'interrupt',
    inputId: 'input_1',
    runId: 'run_previous',
    sessionId: 's_1',
    afterRunId: 'run_previous',
    sessionOrder: 1,
  });
  assert.deepEqual(fake.calls.submitted, [
    {
      sessionId: 's_1',
      afterRunId: 'run_previous',
      delivery: 'interrupt',
      input: [{ type: 'text', text: 'steer now' }],
    },
  ]);
  assert.deepEqual(fake.calls.credentialRegistrations, []);
  assert.deepEqual(fake.calls.credentialRevokes, []);
  await adapter.close();
});

test('interrupt submission rejects replacement bindings before reaching Runtime', async () => {
  const fake = createFakeRuntime();
  fake.sessions.add('s_1');
  const adapter = new RuntimeHostAdapter({
    mode: 'runtime',
    profileRoot: path.resolve('C:\\isolated-profile'),
    runtimeFactory: async () => fake.runtime,
    identityStore: testIdentityStore,
    runtimeEventParser: testRuntimeEventParser,
  });

  await assert.rejects(
    adapter.submitInput({
      sessionId: 's_1',
      afterRunId: 'run_previous',
      delivery: 'interrupt',
      input: [{ type: 'text', text: 'steer now' }],
      hostTools: { leaseId: 'replacement_tools' },
    }),
    /must reuse the active run credential and host-tool bindings/,
  );
  assert.deepEqual(fake.calls.submitted, []);
  assert.deepEqual(fake.calls.credentialRegistrations, []);
  await adapter.close();
});

test('Runtime input capability projection follows interruptInput advertisement', () => {
  const fake = createFakeRuntime();
  const adapter = new RuntimeHostAdapter({
    mode: 'runtime',
    profileRoot: path.resolve('C:\\isolated-profile'),
    runtimeFactory: async () => fake.runtime,
    identityStore: testIdentityStore,
    runtimeEventParser: testRuntimeEventParser,
  });
  const projectCapabilities = (
    adapter as unknown as {
      spaceCapabilities(runtime: KodaXDaemonRuntime): readonly {
        id: string;
        version: number;
        available: boolean;
        reason?: string;
      }[];
    }
  ).spaceCapabilities.bind(adapter);

  assert.deepEqual(
    projectCapabilities(fake.runtime).find((item) => item.id === 'runtime.input.interrupt'),
    {
      id: 'runtime.input.interrupt',
      version: 1,
      available: false,
      reason: 'The connected KodaX Runtime does not advertise interruptInput.',
    },
  );

  (fake.runtime.capabilities as Record<string, unknown>).interruptInput = { version: 2 };
  assert.deepEqual(
    projectCapabilities(fake.runtime).find((item) => item.id === 'runtime.input.interrupt'),
    {
      id: 'runtime.input.interrupt',
      version: 2,
      available: true,
    },
  );
});

test('observation bootstrap failure closes the daemon subscription', async () => {
  const fake = createFakeRuntime();
  fake.sessions.add('s_1');
  const originalObserve = fake.runtime.sessions.observe.bind(fake.runtime.sessions);
  fake.runtime.sessions.observe = async (...args) => {
    const observation = await originalObserve(...args);
    return {
      ...observation,
      snapshot: { ...observation.snapshot, transcriptRevision: '' },
    };
  };
  const adapter = new RuntimeHostAdapter({
    mode: 'runtime',
    profileRoot: path.resolve('C:\\isolated-profile'),
    runtimeFactory: async () => fake.runtime,
    identityStore: testIdentityStore,
    runtimeEventParser: testRuntimeEventParser,
  });

  await assert.rejects(adapter.ensureObserved('s_1'));
  assert.deepEqual(fake.calls.observed, ['s_1']);
  assert.equal(fake.calls.observationCloses, 1);
  await adapter.close();
  assert.equal(fake.calls.observationCloses, 1);
});

test('deleting a session closes and removes its authoritative live observation', async () => {
  const fake = createFakeRuntime();
  fake.sessions.add('s_1');
  const controller = new RuntimeProjectionController(
    createPendingSdkRuntimeProjection(100).profileSnapshot(),
  );
  const adapter = new RuntimeHostAdapter({
    mode: 'runtime',
    profileRoot: path.resolve('C:\\isolated-profile'),
    runtimeFactory: async () => fake.runtime,
    identityStore: testIdentityStore,
    runtimeEventParser: testRuntimeEventParser,
    projectionController: controller,
  });

  await adapter.ensureObserved('s_1');
  assert.deepEqual(fake.calls.observed, ['s_1']);
  assert.equal(controller.sessionLiveSnapshot('s_1').sessionId, 's_1');
  await adapter.deleteSession('s_1');

  assert.equal(fake.calls.observationCloses, 1);
  assert.throws(() => controller.sessionLiveSnapshot('s_1'), RuntimeProjectionUnavailableError);
  await adapter.close();
  assert.equal(fake.calls.observationCloses, 1);
});

test('observation with an omitted model keeps a concrete provider default for Auto LLM', async (t) => {
  class NoopRuntimeStore extends SessionRuntimeStore {
    override async set(): Promise<boolean> {
      return true;
    }
  }

  await kodaxHost.disposeAll();
  setSessionRuntimeStoreForTesting(new NoopRuntimeStore(path.resolve('C:\\unused')));
  t.after(async () => {
    setSessionRuntimeStoreForTesting(null);
    await kodaxHost.disposeAll();
  });
  kodaxHost.createSession({
    existingSessionId: 's_auto_default_model',
    projectRoot: path.resolve('C:\\project'),
    provider: 'zai-coding',
    permissionMode: 'auto',
    autoModeEngine: 'llm',
  });

  const fake = createFakeRuntime();
  fake.sessions.add('s_auto_default_model');
  fake.settings.set('s_auto_default_model', {
    revision: 0,
    value: {
      provider: 'zai-coding',
      effort: 'high',
      permissionMode: 'auto',
      autoModeEngine: 'llm',
    },
  });
  const adapter = new RuntimeHostAdapter({
    mode: 'runtime',
    profileRoot: path.resolve('C:\\isolated-profile'),
    runtimeFactory: async () => fake.runtime,
    identityStore: testIdentityStore,
    runtimeEventParser: testRuntimeEventParser,
  });

  await adapter.ensureObserved('s_auto_default_model');

  assert.equal(kodaxHost.get('s_auto_default_model')?.model, 'glm-5.2');
  assert.equal(kodaxHost.get('s_auto_default_model')?.reasoningMode, 'deep');
  await adapter.close();
});

test('Runtime permission grants keep their CAS revision for listing and revocation', async () => {
  const fake = createFakeRuntime();
  const adapter = new RuntimeHostAdapter({
    mode: 'runtime',
    profileRoot: path.resolve('C:\\isolated-profile'),
    runtimeFactory: async () => fake.runtime,
    identityStore: testIdentityStore,
  });

  assert.deepEqual(await adapter.listPermissionGrants(), {
    revision: 3,
    value: [
      {
        id: 'grant_1',
        scope: { toolName: 'bash', sessionId: 's_1' },
        createdAt: '2026-07-12T00:00:00.000Z',
      },
    ],
  });
  assert.equal(await adapter.revokePermissionGrant('grant_1', 3), true);
  assert.deepEqual(fake.calls.permissionGrantRevokes, [
    { grantId: 'grant_1', expectedRevision: 3 },
  ]);
  await adapter.close();
});

test('Runtime persistent permission responses return only the Runtime-issued suggestion ID', async () => {
  const fake = createFakeRuntime();
  fake.permissionRequests.push({
    id: 'permission_1',
    sessionId: 's_1',
    runId: 'run_1',
    toolCallId: 'tool_1',
    toolName: 'bash',
    inputPreview: JSON.stringify({ command: 'npm test' }),
    executionCwd: path.resolve('C:\\project'),
    grantSuggestions: [
      { id: 'session_scope', kind: 'session', label: 'Allow this exact command for this task' },
      {
        id: 'persistent_scope',
        kind: 'persistent',
        label: 'Always allow this exact command: npm test',
      },
    ],
    createdAt: '2026-07-20T00:00:00.000Z',
  });
  const adapter = new RuntimeHostAdapter({
    mode: 'runtime',
    profileRoot: path.resolve('C:\\isolated-profile'),
    runtimeFactory: async () => fake.runtime,
    identityStore: testIdentityStore,
  });

  assert.equal(await adapter.respondPermission('permission_1', 'allow_always'), true);
  assert.deepEqual(fake.calls.permissionResponses, [
    {
      requestId: 'permission_1',
      decision: { type: 'allow_always', suggestionId: 'persistent_scope' },
      options: { runId: 'run_1' },
    },
  ]);
  await adapter.close();
});

test('Runtime persistent permission responses fail closed without a persistent suggestion', async () => {
  const fake = createFakeRuntime();
  fake.permissionRequests.push({
    id: 'permission_session_only',
    sessionId: 's_1',
    runId: 'run_1',
    toolName: 'bash',
    grantSuggestions: [
      { id: 'session_scope', kind: 'session', label: 'Allow this exact command for this task' },
    ],
    createdAt: '2026-07-20T00:00:00.000Z',
  });
  const adapter = new RuntimeHostAdapter({
    mode: 'runtime',
    profileRoot: path.resolve('C:\\isolated-profile'),
    runtimeFactory: async () => fake.runtime,
    identityStore: testIdentityStore,
  });

  assert.equal(await adapter.respondPermission('permission_session_only', 'allow_always'), false);
  assert.deepEqual(fake.calls.permissionResponses, []);
  await adapter.close();
});

test('Runtime workflow reads and lifecycle controls use the daemon service', async () => {
  const fake = createFakeRuntime();
  const snapshot = {
    runId: 'workflow_1',
    workflowName: 'review',
    status: 'running',
    startedAt: '2026-07-12T00:00:00.000Z',
    updatedAt: '2026-07-12T00:00:01.000Z',
    hostMetadata: { sessionId: 's_1', surface: 'code', projectRoot: 'C:\\repo' },
    items: [],
    counts: { pending: 0, running: 0, completed: 0, failed: 0, cancelled: 0, skipped: 0 },
    progress: {
      spawnedAgents: 0,
      finishedAgents: 0,
      activeAgents: 0,
      failedAgents: 0,
      stoppedAgents: 0,
    },
  };
  fake.runtime.workflows.list = async () => [snapshot] as never;
  fake.runtime.workflows.get = async (runId: string) =>
    (runId === snapshot.runId ? snapshot : undefined) as never;
  const adapter = new RuntimeHostAdapter({
    mode: 'runtime',
    profileRoot: path.resolve('C:\\isolated-profile'),
    runtimeFactory: async () => fake.runtime,
    identityStore: testIdentityStore,
  });

  assert.equal((await adapter.listWorkflows({ sessionId: 's_1' }))[0]?.runId, 'workflow_1');
  assert.equal((await adapter.getWorkflow('workflow_1'))?.projectRoot, 'C:\\repo');
  assert.equal(await adapter.controlWorkflow('pause', 'workflow_1'), true);
  assert.deepEqual(fake.calls.workflowControls, [{ action: 'pause', runId: 'workflow_1' }]);
  await adapter.close();
});

test('Runtime learning controls are routed through the shared daemon', async () => {
  const fake = createFakeRuntime();
  const adapter = new RuntimeHostAdapter({
    mode: 'runtime',
    profileRoot: path.resolve('C:\\isolated-profile'),
    runtimeFactory: async () => fake.runtime,
    identityStore: testIdentityStore,
  });

  assert.deepEqual(await adapter.listLearnedCapabilities(), { items: [], revision: 1 });
  await adapter.controlLearnedCapability('trust', 'learned-capability');
  assert.deepEqual(fake.calls.learningControls, [
    { action: 'trust', nameOrSlug: 'learned-capability' },
  ]);
  await adapter.close();
});

test('Runtime external Agent mutations validate session Actor/Turn ownership before control', async () => {
  const fake = createFakeRuntime();
  const operations: string[] = [];
  const detail = {
    actor: {
      path: '/external/reviewer',
      taskName: 'external-reviewer',
      objective: 'Review the patch',
      kind: 'external',
      state: 'running',
      createdAt: '2026-07-12T00:00:00.000Z',
      updatedAt: '2026-07-12T00:00:01.000Z',
    },
    turns: [
      {
        turnId: 'turn_1',
        objective: 'Review the patch',
        state: 'running',
        createdAt: '2026-07-12T00:00:00.000Z',
        metadata: { agentId: 'reviewer', protocol: 'a2a' },
      },
    ],
  };
  Object.assign(fake.runtime.agents as unknown as Record<string, unknown>, {
    detail: async () => {
      operations.push('detail');
      return detail;
    },
    output: async () => {
      operations.push('output');
      return { state: 'running', progress: [] };
    },
    send: async () => {
      operations.push('send');
    },
    interrupt: async () => {
      operations.push('interrupt');
    },
  });
  const adapter = new RuntimeHostAdapter({
    mode: 'runtime',
    profileRoot: path.resolve('C:\\isolated-profile'),
    runtimeFactory: async () => fake.runtime,
    identityStore: testIdentityStore,
  });
  const taskId = encodeRuntimeActorTaskId({
    actorPath: '/external/reviewer',
    turnId: 'turn_1',
  });

  await adapter.sendRuntimeActorTaskInput('s_1', taskId, 'Continue');
  assert.deepEqual(operations, ['detail', 'send', 'detail', 'output']);
  operations.length = 0;

  await adapter.cancelRuntimeActorTask('s_1', taskId, 'User requested');
  assert.deepEqual(operations, ['detail', 'interrupt', 'detail', 'output']);
  operations.length = 0;

  const unknownTaskId = encodeRuntimeActorTaskId({
    actorPath: '/external/reviewer',
    turnId: 'turn_missing',
  });
  await assert.rejects(
    adapter.sendRuntimeActorTaskInput('s_1', unknownTaskId, 'Do not send'),
    /does not belong to the selected session/,
  );
  assert.deepEqual(operations, ['detail']);
  await adapter.close();
});

test('daemon capability upgrade failures explain restart and active blockers', async () => {
  const error = Object.assign(new Error('runtimeAutoModeGuardrail requires a newer daemon'), {
    code: 'daemon_capability_upgrade_required',
    recoverable: true,
    restartRequired: true,
    preflight: { blockers: ['active_runs', 'pending_interactions'] },
  });
  const adapter = new RuntimeHostAdapter({
    mode: 'runtime',
    profileRoot: path.resolve('C:\\isolated-profile'),
    runtimeFactory: async () => Promise.reject(error),
    identityStore: testIdentityStore,
  });

  await assert.rejects(adapter.initialize(), /runtimeAutoModeGuardrail/);
  assert.match(adapter.snapshot().error ?? '', /capability upgrade required/i);
  assert.match(adapter.snapshot().error ?? '', /Restart the Coder daemon/i);
  assert.match(adapter.snapshot().error ?? '', /active_runs, pending_interactions/);
  await adapter.close();
});
