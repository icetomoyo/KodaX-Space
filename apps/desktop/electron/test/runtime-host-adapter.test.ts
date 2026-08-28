import assert from 'node:assert/strict';
import path from 'node:path';
import test, { afterEach, beforeEach } from 'node:test';

import type {
  ConnectKodaXRuntimeOptions,
  KodaXDaemonRuntime,
  RuntimeConnectionState,
  RuntimeDaemonManagementState,
  RuntimeInlineOwnerHandle,
  RuntimeRunHandle,
  RuntimeRunResult,
  RuntimeRunStatus,
  RuntimeSession,
  RuntimeSessionCursor,
  RuntimeSessionObservationSnapshot,
  RuntimeSessionSettings,
  RuntimeSessionStatus,
  RuntimeEventType,
  RuntimeTypedEvent,
} from '@kodax-ai/kodax/runtime';
import type { AgentEvent, AgentTreeSnapshot } from '@kodax-ai/kodax/agent';
import { isCoderOwnerRecoveryRestartRequired } from '../kodax/coder-owner-recovery-error.js';
import {
  initializeCoderDaemonProjectionSdk,
  projectRuntimeRun,
  projectRuntimeSessionSnapshot,
} from '../kodax/runtime/coder-daemon-projection.js';
import {
  RuntimeHostAdapter,
  assertSpaceRuntimeSdkRequiredCapabilities,
  conversationTurnEndBoundaryId,
  resolveRuntimeHostMode,
  withDarwinRuntimeDaemonTmpdir,
} from '../kodax/runtime-host-adapter.js';
import { kodaxHost } from '../kodax/host.js';
import {
  SessionRuntimeStore,
  setSessionRuntimeStoreForTesting,
} from '../kodax/session-runtime-store.js';
import {
  invalidatePersistedSessionCache,
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

await initializeCoderDaemonProjectionSdk();

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

type TestRuntimeEvent = {
  [Type in RuntimeEventType]: Omit<RuntimeTypedEvent<Type>, 'cursor'> & {
    readonly cursor?: RuntimeSessionCursor;
  };
}[RuntimeEventType];

function testRuntimeCursor(sessionId: string, seq: number): RuntimeSessionCursor {
  return { sessionId, journalEpoch: 'journal_epoch_1', seq };
}

function withTestRuntimeCursor(event: TestRuntimeEvent): RuntimeTypedEvent {
  return {
    ...event,
    cursor: event.cursor ?? testRuntimeCursor(event.sessionId, event.seq),
  } as RuntimeTypedEvent;
}

function bindTestRuntimeEventBridge(
  adapter: RuntimeHostAdapter,
): (event: TestRuntimeEvent, runtimeId?: string) => void {
  const bridge = (
    adapter as unknown as {
      bridgeRuntimeEvent(event: RuntimeTypedEvent, runtimeId?: string): void;
    }
  ).bridgeRuntimeEvent.bind(adapter);
  return (event, runtimeId) => bridge(withTestRuntimeCursor(event), runtimeId);
}

function installPersistedSessionLookup(
  records: ReadonlyMap<string, Readonly<Record<string, unknown>>> = new Map(),
): void {
  setSessionStoreImpl({
    listSessions: async () => [],
    forkSession: async () => null,
    rewindSession: async () => null,
    deleteSession: async () => ({ ok: true }),
    loadSession: async (sessionId) => (records.get(sessionId) as never) ?? null,
    watchSessions: () => ({ close() {} }),
  } as SessionStoreImpl);
}

beforeEach(() => {
  installPersistedSessionLookup();
});

test('required SDK capabilities are checked before daemon auto-start', () => {
  assert.doesNotThrow(() =>
    assertSpaceRuntimeSdkRequiredCapabilities({
      KODAX_RUNTIME_SDK_CAPABILITIES: {
        actorSettlementConvergence: 2,
        conversationHistory: 2,
        crashOutcomeModel: 2,
        daemonOrphanExit: 1,
        daemonShutdownVerification: 1,
        liveOutputSegments: 1,
        managedRunDurability: 1,
        runtimeExitSettlement: 2,
        runtimeEventCoalescing: 1,
        sandboxRuntime: 6,
        sessionEventJournal: 1,
      },
    }),
  );
  assert.throws(
    () =>
      assertSpaceRuntimeSdkRequiredCapabilities({
        KODAX_RUNTIME_SDK_CAPABILITIES: {
          actorSettlementConvergence: 1,
          conversationHistory: 2,
          crashOutcomeModel: 2,
          daemonOrphanExit: 1,
          daemonShutdownVerification: 1,
          liveOutputSegments: 1,
          managedRunDurability: 1,
          runtimeExitSettlement: 2,
          runtimeEventCoalescing: 1,
          sandboxRuntime: 6,
          sessionEventJournal: 1,
        },
      }),
    /installed KodaX SDK.*actorSettlementConvergence v2/i,
  );
  assert.throws(
    () =>
      assertSpaceRuntimeSdkRequiredCapabilities({
        KODAX_RUNTIME_SDK_CAPABILITIES: {
          actorSettlementConvergence: 2,
          conversationHistory: 1,
          crashOutcomeModel: 2,
          daemonOrphanExit: 1,
          daemonShutdownVerification: 1,
          liveOutputSegments: 1,
          managedRunDurability: 1,
          runtimeExitSettlement: 2,
          runtimeEventCoalescing: 1,
          sandboxRuntime: 6,
          sessionEventJournal: 1,
        },
      }),
    /installed KodaX SDK.*conversationHistory v2/i,
  );
  assert.throws(
    () =>
      assertSpaceRuntimeSdkRequiredCapabilities({
        KODAX_RUNTIME_SDK_CAPABILITIES: {
          actorSettlementConvergence: 2,
          conversationHistory: 2,
          crashOutcomeModel: 2,
          daemonOrphanExit: 1,
          daemonShutdownVerification: 1,
          liveOutputSegments: 1,
          managedRunDurability: 1,
          runtimeExitSettlement: 2,
          sandboxRuntime: 6,
          sessionEventJournal: 1,
        },
      }),
    /installed KodaX SDK.*runtimeEventCoalescing v1/i,
  );
  assert.throws(
    () => assertSpaceRuntimeSdkRequiredCapabilities({}),
    /installed KodaX SDK.*actorSettlementConvergence v2.*conversationHistory v2.*crashOutcomeModel v2.*daemonOrphanExit v1.*daemonShutdownVerification v1.*liveOutputSegments v1.*managedRunDurability v1.*runtimeExitSettlement v2.*runtimeEventCoalescing v1.*sandboxRuntime v6.*sessionEventJournal v1/i,
  );
});

test('conversation turn boundaries preserve repeated prompts and include the complete tool chain', () => {
  type Entry = Parameters<typeof conversationTurnEndBoundaryId>[0][number];
  const entries = [
    { boundaryId: 'u0', auditEntryIds: ['u0'], message: { role: 'user', content: 'same' } },
    {
      boundaryId: 'a0',
      auditEntryIds: ['a0'],
      message: { role: 'assistant', content: [{ type: 'tool_use', id: 'tool0', name: 'read' }] },
    },
    {
      boundaryId: 'r0',
      auditEntryIds: ['r0'],
      message: {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'tool0', content: 'ok' }],
      },
    },
    {
      boundaryId: 'synthetic',
      auditEntryIds: ['synthetic'],
      message: { role: 'user', content: 'internal', _synthetic: true },
    },
    { boundaryId: 'u1', auditEntryIds: ['u1'], message: { role: 'user', content: 'same' } },
    { boundaryId: 'a1', auditEntryIds: ['a1'], message: { role: 'assistant', content: 'done' } },
  ] as unknown as readonly Entry[];

  assert.equal(conversationTurnEndBoundaryId(entries, 0), 'synthetic');
  assert.equal(conversationTurnEndBoundaryId(entries, 1), 'a1');
  assert.equal(conversationTurnEndBoundaryId(entries, 2), null);
});

test('conversation turn boundaries fail closed when the visible turn tail has no boundary', () => {
  type Entry = Parameters<typeof conversationTurnEndBoundaryId>[0][number];
  const entries = [
    { boundaryId: 'u0', auditEntryIds: ['u0'], message: { role: 'user', content: 'query' } },
    {
      auditEntryIds: ['a0'],
      message: { role: 'assistant', content: 'answer without an exact mutation boundary' },
    },
  ] as unknown as readonly Entry[];

  assert.equal(conversationTurnEndBoundaryId(entries, 0), null);
});

async function waitForTest(predicate: () => boolean, timeoutMs = 1_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('condition timed out');
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
}

function createFakeRuntime(runtimeId = 'rt_test') {
  const calls = {
    created: [] as unknown[],
    loaded: [] as string[],
    sessionStatuses: [] as string[],
    sessionDiagnostics: [] as Array<{ sessionId: string; runId?: string }>,
    started: [] as unknown[],
    runGets: [] as string[],
    runAwaits: [] as string[],
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
    learningAcknowledgements: [] as string[],
    agentTrees: [] as string[],
    agentEvents: [] as Array<{ sessionId: string; afterSequence: number }>,
    agentWaits: [] as Array<{ sessionId: string; afterSequence: number }>,
    customProviderUpserts: [] as Array<Record<string, unknown>>,
    customProviderDeletes: [] as string[],
  };
  const sessions = new Set<string>();
  const sessionRecords = new Map<string, RuntimeSession>();
  const sessionStatuses = new Map<string, RuntimeSessionStatus>();
  const settings = new Map<string, { revision: number; value: Record<string, unknown> }>();
  const permissionRequests: import('@kodax-ai/kodax/runtime').RuntimePermissionRequest[] = [];
  const observationListeners = new Map<
    string,
    (event: import('@kodax-ai/kodax/runtime').RuntimeTypedEvent) => void
  >();
  const observationInvalidators = new Map<
    string,
    (invalidation: import('@kodax-ai/kodax/runtime').RuntimeObservationInvalidation) => void
  >();
  const pending = new Map<
    string,
    {
      readonly resolve: (result: RuntimeRunResult) => void;
      readonly reject: (error: Error) => void;
    }
  >();
  const connectionListeners = new Set<(state: RuntimeConnectionState) => void>();
  const actorEvents = new Map<string, AgentEvent[]>();
  const actorTrees = new Map<string, AgentTreeSnapshot>();
  const customProviders = new Map<string, Record<string, unknown>>();
  let integrationHealth: RuntimeDaemonManagementState['integrations'] = {
    state: 'healthy',
    domains: [
      {
        domain: 'mcp',
        path: 'C:\\Users\\test\\.kodax\\integrations\\mcp.json',
        source: 'default',
        watching: true,
      },
      {
        domain: 'a2a',
        path: 'C:\\Users\\test\\.kodax\\integrations\\a2a.json',
        source: 'default',
        watching: true,
      },
      {
        domain: 'extensions',
        path: 'C:\\Users\\test\\.kodax\\integrations\\extensions.json',
        source: 'default',
        watching: true,
      },
    ],
  };
  const actorWaiters = new Set<{
    readonly sessionId: string;
    readonly afterSequence: number;
    readonly resolve: (event: AgentEvent | undefined) => void;
  }>();
  const makeRootActorTree = (revision = 0): AgentTreeSnapshot => ({
    rootPath: '/root',
    actors: [
      {
        path: '/root',
        taskName: 'root',
        kind: 'native',
        state: 'idle',
        capabilities: {
          tools: [],
          filesystem: 'write',
          network: true,
          providers: [],
          canAskUser: true,
        },
        turnIds: [],
        mailboxCursor: 0,
        createdAt: '2026-07-12T00:00:00.000Z',
        updatedAt: '2026-07-12T00:00:00.000Z',
        revision,
      },
    ],
    activeNonRootTurns: 0,
    maxConcurrentThreads: 4,
    revision,
  });
  const ensureActorState = (sessionId: string): void => {
    if (!sessions.has(sessionId)) throw new Error(`Session not found: ${sessionId}`);
    if (!actorTrees.has(sessionId)) actorTrees.set(sessionId, makeRootActorTree());
    if (!actorEvents.has(sessionId)) actorEvents.set(sessionId, []);
  };
  const resolveActorWaiters = (sessionId?: string): void => {
    for (const waiter of actorWaiters) {
      if (sessionId && waiter.sessionId !== sessionId) continue;
      actorWaiters.delete(waiter);
      const event = actorEvents
        .get(waiter.sessionId)
        ?.find((item) => item.sequence > waiter.afterSequence);
      waiter.resolve(event);
    }
  };
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
      runtimeId,
      mode: 'daemon',
      profile: 'coder',
      startedAt: '2026-07-12T00:00:00.000Z',
      version: '0.7.80',
      isolation: 'process',
    },
    capabilities: {
      externalAgentAdmin: { version: 1 },
      actorControlPlane: { version: 1, methodNamespace: 'agents' },
      learningCenter: { version: 1 },
      skillLearningLoop: { version: 1 },
      a2aConfigReconciler: { version: 1 },
      integrationConfigResilience: { version: 1 },
      operationDeduplication: { version: 1, retentionMs: 900_000 },
      sessionObservation: { version: 1, maxBufferedEvents: 256 },
      afterTurnInput: { version: 1 },
      askUserTransport: { version: 1 },
      permissionCas: { version: 1 },
      providerCredentialBroker: { version: 1 },
      runBoundHostTools: { version: 1 },
      coderOwnerFencing: { version: 1 },
      crashOutcomeModel: { version: 2 },
      coderFeatureMatrix: { version: 1, managedRun: true, todoProjection: true },
      sessionAdmission: { version: 1 },
      completeObservationSnapshot: { version: 1 },
      contextCompaction: { version: 3 },
      conversationHistory: {
        version: 2,
        immutablePaging: true,
        revisionedBoundaries: true,
        ambiguityReporting: true,
        topologyTransparentManagedContext: true,
        directCloneProvenance: true,
      },
      transcriptPaging: { version: 1 },
      transcriptSearch: { version: 1 },
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
      daemonOrphanExit: {
        version: 1,
        idleOnly: true,
        bootstrapGrace: true,
      },
      managedRunDurability: { version: 1 },
      actorSettlementConvergence: { version: 2 },
      liveOutputSegments: { version: 1 },
      runtimeEventCoalescing: { version: 1 },
      sessionEventJournal: { version: 1 },
      sandboxRuntime: {
        version: 6,
        asrtVersion: '0.0.65',
        backend: 'unsupported',
      },
      runtimeAutoModeGuardrail: { version: 4, owner: 'session-runtime' },
    },
    grantedScopes: [
      'session:observe',
      'session:write',
      'run:control',
      'agent:control',
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
        return (
          sessionRecords.get(sessionId) ?? {
            id: sessionId,
            title: '',
            workspaceRoot: 'C:\\repo',
            gitRoot: 'C:\\repo',
            surface: 'space-desktop',
          }
        );
      },
      async status(sessionId: string) {
        calls.sessionStatuses.push(sessionId);
        if (!sessions.has(sessionId)) throw new Error(`Session not found: ${sessionId}`);
        return (
          sessionStatuses.get(sessionId) ?? {
            sessionId,
            runtimeId,
            phase: 'idle',
            observedAt: '2026-07-12T00:00:00.000Z',
          }
        );
      },
      async diagnostics(input: { sessionId: string; runId?: string }) {
        calls.sessionDiagnostics.push(input);
        if (!sessions.has(input.sessionId)) {
          throw new Error(`Session not found: ${input.sessionId}`);
        }
        const status =
          sessionStatuses.get(input.sessionId) ??
          ({
            sessionId: input.sessionId,
            runtimeId,
            phase: 'idle',
            observedAt: '2026-07-12T00:00:00.000Z',
          } satisfies RuntimeSessionStatus);
        const runId = input.runId ?? status.runId;
        const hasRun = runId !== undefined;
        const terminal =
          status.phase === 'completed' ||
          status.phase === 'failed' ||
          status.phase === 'cancelled' ||
          status.phase === 'interrupted';
        return {
          schemaVersion: 1 as const,
          captureStartedAt: '2026-07-12T00:00:00.000Z',
          capturedAt: '2026-07-12T00:00:00.001Z',
          sdkVersion: '0.7.80',
          runtimeVersion: '0.7.80',
          daemonVersion: '0.7.80',
          runtimeId,
          runtimeMode: 'daemon' as const,
          sessionId: input.sessionId,
          observation: { cursor: 0, transcriptRevision: `transcript_${input.sessionId}_0` },
          run: hasRun
            ? {
                controlRecord: 'present' as const,
                runId,
                state: terminal ? ('terminal' as const) : ('active' as const),
                ...(status.phase !== 'idle' ? { phase: status.phase } : {}),
                stage: terminal ? ('terminal' as const) : ('executing' as const),
                terminalTimeKnown: terminal,
                activeSubtaskCount: 0,
                activeSubtaskCountSource: 'run_status' as const,
                errors: [],
              }
            : {
                controlRecord: 'unknown' as const,
                state: 'unknown' as const,
                stage: 'unknown' as const,
                terminalTimeKnown: false,
                activeSubtaskCount: null,
                activeSubtaskCountSource: 'unknown' as const,
                errors: [
                  {
                    code: 'run_control_unknown' as const,
                    message: 'No Run control record is available at this Session boundary.',
                  },
                ],
              },
        };
      },
      async create(input: {
        sessionId?: string;
        projectPath?: string;
        gitRoot?: string;
        surface?: string;
      }) {
        calls.created.push(input);
        const id = input.sessionId ?? `s_${sessions.size + 1}`;
        if (sessions.has(id)) {
          throw Object.assign(new Error(`Session already exists: ${id}`), { code: 'conflict' });
        }
        sessions.add(id);
        const session = {
          id,
          title: '',
          ...(input.projectPath !== undefined ? { workspaceRoot: input.projectPath } : {}),
          ...(input.gitRoot !== undefined ? { gitRoot: input.gitRoot } : {}),
          ...(input.surface !== undefined ? { surface: input.surface } : {}),
        } satisfies RuntimeSession;
        sessionRecords.set(id, session);
        settings.set(id, { revision: 0, value: {} });
        actorTrees.set(id, makeRootActorTree());
        actorEvents.set(id, []);
        return session;
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
      async conversation(sessionId: string) {
        if (!sessions.has(sessionId)) return null;
        return {
          revision: `conversation_${sessionId}_0`,
          sourceRevision: `source_${sessionId}_0`,
          status: 'resolved' as const,
          issues: [],
          entries: [],
        };
      },
      async conversationPage(input: { sessionId: string }) {
        if (!sessions.has(input.sessionId)) return null;
        return {
          revision: `conversation_${input.sessionId}_0`,
          sourceRevision: `source_${input.sessionId}_0`,
          status: 'resolved' as const,
          issues: [],
          entries: [],
          hasMore: false,
        };
      },
      async conversationEntryChunk() {
        return null;
      },
      async observe(
        sessionId: string,
        listener?: (event: import('@kodax-ai/kodax/runtime').RuntimeTypedEvent) => void,
      ) {
        calls.observed.push(sessionId);
        if (!sessions.has(sessionId)) throw new Error(`Session not found: ${sessionId}`);
        if (listener) observationListeners.set(sessionId, listener);
        let resolveInvalidated!: (
          invalidation: import('@kodax-ai/kodax/runtime').RuntimeObservationInvalidation,
        ) => void;
        const invalidated = new Promise<
          import('@kodax-ai/kodax/runtime').RuntimeObservationInvalidation
        >((resolve) => {
          resolveInvalidated = resolve;
        });
        observationInvalidators.set(sessionId, resolveInvalidated);
        return {
          snapshot: {
            runtimeId,
            cursor: testRuntimeCursor(sessionId, 0),
            transcriptRevision: `transcript_${sessionId}_0`,
            session: { id: sessionId, title: '', surface: 'code' },
            transcript: {
              revision: `transcript_${sessionId}_0`,
              entries: [],
              hasMore: false,
            },
            settings: settings.get(sessionId) ?? { revision: 0, value: {} },
            runs: [],
            pendingPermissions: [],
            live: {
              assistantTextByRun: {},
              thinkingTextByRun: {},
              outputSegmentsByRun: {},
              activeTools: [],
              pendingUserInputs: [],
              managedTasks: [],
            },
          },
          invalidated,
          close() {
            if (listener && observationListeners.get(sessionId) === listener) {
              observationListeners.delete(sessionId);
            }
            if (observationInvalidators.get(sessionId) === resolveInvalidated) {
              observationInvalidators.delete(sessionId);
            }
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
        sessionRecords.delete(sessionId);
        actorTrees.delete(sessionId);
        actorEvents.delete(sessionId);
        resolveActorWaiters(sessionId);
      },
    },
    runs: {
      async start(input: { sessionId: string }): Promise<RuntimeRunHandle> {
        calls.started.push(input);
        const runId = `run_${++runSeq}`;
        const result = new Promise<RuntimeRunResult>((resolve, reject) => {
          pending.set(runId, { resolve, reject });
        });
        return { runId, sessionId: input.sessionId, result };
      },
      async abort(runId: string) {
        calls.aborted.push(runId);
        pending.get(runId)?.resolve({ runId, sessionId: 's_1', phase: 'cancelled' });
        pending.delete(runId);
        return {
          runId,
          sessionId: 's_1',
          accepted: true,
          state: 'confirmed',
          outcome: 'cancelled',
          phase: 'cancelled',
          revision: 1,
        } as const;
      },
      async list() {
        return [];
      },
      async get(runId: string) {
        calls.runGets.push(runId);
        return {
          runId,
          sessionId: 's_1',
          phase: 'running',
          startedAt: '2026-07-12T00:00:00.000Z',
          provider: 'anthropic',
        };
      },
      async await(runId: string) {
        calls.runAwaits.push(runId);
        return new Promise<RuntimeRunResult>((resolve, reject) => {
          pending.set(runId, { resolve, reject });
        });
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
      events: async () => [],
      subscribe: () => ({
        [Symbol.asyncIterator]() {
          return {
            next: async () => ({ done: true as const, value: undefined }),
          };
        },
      }),
      acknowledge: async (nameOrSlug: string) => {
        calls.learningAcknowledgements.push(nameOrSlug);
      },
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
    catalog: {
      customProviders: async () =>
        [...customProviders.values()].map((config) => structuredClone(config)),
      upsertCustomProvider: async (config: Record<string, unknown>) => {
        const cloned = structuredClone(config);
        calls.customProviderUpserts.push(cloned);
        customProviders.set(String(config.name), cloned);
        return structuredClone(cloned);
      },
      deleteCustomProvider: async (name: string) => {
        calls.customProviderDeletes.push(name);
        return customProviders.delete(name);
      },
    },
    mcp: {},
    artifacts: {},
    status: {
      snapshot: async () => ({
        runtimeId,
        mode: 'daemon',
        profile: 'coder',
        startedAt: '2026-07-12T00:00:00.000Z',
        sessions: [...sessions].map((id) => {
          const session = sessionRecords.get(id);
          return {
            id,
            title: session?.title ?? '',
            surface: session?.surface ?? 'code',
            msgCount: 0,
            ...(session !== undefined
              ? {
                  ...(session.workspaceRoot !== undefined
                    ? { workspaceRoot: session.workspaceRoot }
                    : {}),
                  ...(session.gitRoot !== undefined ? { gitRoot: session.gitRoot } : {}),
                }
              : { workspaceRoot: 'C:\\repo', gitRoot: 'C:\\repo' }),
          };
        }),
        runs: [],
        pendingPermissions: [],
        workflows: [],
      }),
      preflight: async () => ({
        runtimeId,
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
          runtimeId,
          revision: 7,
          ownerPolicy: {
            mode: 'daemon',
            revision: 2,
            updatedAt: '2026-07-12T00:00:00.000Z',
          },
          owner: {
            runtimeId,
            pid: 123,
            createdAt: '2026-07-12T00:00:00.000Z',
            kind: 'daemon',
          },
          preflight: {
            runtimeId,
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
          ...(integrationHealth ? { integrations: structuredClone(integrationHealth) } : {}),
        } as RuntimeDaemonManagementState;
      },
      stopForInline: async (input: unknown) => {
        calls.daemonStops.push(input);
        return {
          accepted: true as const,
          runtimeId,
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
    agents: {
      enabled: true,
      async tree(sessionId: string) {
        calls.agentTrees.push(sessionId);
        ensureActorState(sessionId);
        const tree = actorTrees.get(sessionId);
        if (!tree) throw new Error(`Agent tree unavailable: ${sessionId}`);
        return tree;
      },
      async events(sessionId: string, afterSequence = 0) {
        calls.agentEvents.push({ sessionId, afterSequence });
        ensureActorState(sessionId);
        return (actorEvents.get(sessionId) ?? []).filter((event) => event.sequence > afterSequence);
      },
      async wait(sessionId: string, afterSequence = 0) {
        calls.agentWaits.push({ sessionId, afterSequence });
        ensureActorState(sessionId);
        const available = actorEvents
          .get(sessionId)
          ?.find((event) => event.sequence > afterSequence);
        if (available) return available;
        return new Promise<AgentEvent | undefined>((resolve) => {
          actorWaiters.add({ sessionId, afterSequence, resolve });
        });
      },
    },
    async close() {
      calls.close += 1;
      resolveActorWaiters();
    },
  } as unknown as KodaXDaemonRuntime;
  return {
    runtime,
    calls,
    sessions,
    sessionRecords,
    sessionStatuses,
    pending,
    settings,
    permissionRequests,
    setIntegrationHealth(value: RuntimeDaemonManagementState['integrations']) {
      integrationHealth = value;
    },
    emit(event: TestRuntimeEvent) {
      const typed = withTestRuntimeCursor(event);
      observationListeners.get(typed.sessionId)?.(typed);
    },
    invalidateObservation(
      sessionId: string,
      reason: import('@kodax-ai/kodax/runtime').RuntimeObservationInvalidation['reason'] = 'event_overflow',
    ) {
      observationInvalidators.get(sessionId)?.({
        code: 'observation_invalidated',
        reason,
        runtimeId: 'rt_test',
        message: `test ${reason}`,
      });
    },
    emitActor(sessionId: string, event: AgentEvent, tree: AgentTreeSnapshot) {
      ensureActorState(sessionId);
      actorEvents.get(sessionId)?.push(event);
      actorTrees.set(sessionId, tree);
      resolveActorWaiters(sessionId);
    },
    disconnect(reconnectable = true) {
      connectionState = {
        ...connectionState,
        state: 'disconnected',
        reason: 'test transport loss',
        reconnectable,
      };
      for (const listener of connectionListeners) listener(connectionState);
      resolveActorWaiters();
    },
  };
}

test('Runtime config patch reports the committed result even when profile refresh fails', async () => {
  const fake = createFakeRuntime();
  const patches: Record<string, unknown>[] = [];
  (
    fake.runtime.config as unknown as {
      patch(patch: Record<string, unknown>): Promise<unknown>;
    }
  ).patch = async (patch) => {
    patches.push(patch);
    return { fallbackProviders: ['ark-coding'] };
  };
  const adapter = new RuntimeHostAdapter({
    mode: 'runtime',
    profileRoot: path.resolve('C:\\isolated-profile'),
    runtimeFactory: async () => fake.runtime,
    identityStore: testIdentityStore,
    runtimeEventParser: testRuntimeEventParser,
  });
  await adapter.initialize();
  const privateAdapter = adapter as unknown as {
    refreshProfile(cursor: number): Promise<void>;
  };
  privateAdapter.refreshProfile = async () => {
    throw new Error('profile refresh unavailable');
  };

  const result = await adapter.patchRuntimeConfig({ fallbackProviders: ['ark-coding'] });

  assert.deepEqual(result, { fallbackProviders: ['ark-coding'] });
  assert.deepEqual(patches, [{ fallbackProviders: ['ark-coding'] }]);
  await adapter.close();
});

test('resolveRuntimeHostMode defaults to runtime and accepts explicit legacy rollback', () => {
  assert.equal(resolveRuntimeHostMode(undefined), 'runtime');
  assert.equal(resolveRuntimeHostMode('runtime'), 'runtime');
  assert.equal(resolveRuntimeHostMode('legacy'), 'legacy');
  assert.equal(resolveRuntimeHostMode('unexpected'), 'runtime');
});

test('Darwin daemon startup uses a short TMPDIR and restores the host environment', async () => {
  const darwinEnv: NodeJS.ProcessEnv = {
    TMPDIR: '/var/folders/very/long/per-user/path/that-overflows-darwin-sockaddr-un',
  };
  const observed = await withDarwinRuntimeDaemonTmpdir(
    'darwin',
    async () => darwinEnv.TMPDIR,
    darwinEnv,
  );
  assert.equal(observed, '/tmp');
  assert.equal(
    darwinEnv.TMPDIR,
    '/var/folders/very/long/per-user/path/that-overflows-darwin-sockaddr-un',
  );

  const emptyEnv: NodeJS.ProcessEnv = {};
  await assert.rejects(
    withDarwinRuntimeDaemonTmpdir(
      'darwin',
      async () => {
        assert.equal(emptyEnv.TMPDIR, '/tmp');
        throw new Error('startup failed');
      },
      emptyEnv,
    ),
    /startup failed/,
  );
  assert.equal(emptyEnv.TMPDIR, undefined);

  const linuxEnv: NodeJS.ProcessEnv = { TMPDIR: '/var/tmp' };
  assert.equal(
    await withDarwinRuntimeDaemonTmpdir('linux', async () => linuxEnv.TMPDIR, linuxEnv),
    '/var/tmp',
  );
  assert.equal(linuxEnv.TMPDIR, '/var/tmp');
});

test('startup mode can be configured from persisted settings only before initialization', async () => {
  const adapter = new RuntimeHostAdapter({
    mode: 'runtime',
    profileRoot: 'C:\\isolated-profile',
    ownerControl: {
      acquireInline: async () => ({
        profile: 'coder',
        ownerId: 'inline_from_settings',
        ownerPolicy: {
          mode: 'inline',
          revision: 1,
          updatedAt: '2026-07-28T00:00:00.000Z',
        },
        close: () => undefined,
      }),
      getState: async () => ({
        profile: 'coder',
        policy: {
          mode: 'inline',
          revision: 1,
          updatedAt: '2026-07-28T00:00:00.000Z',
        },
        ownerStatus: 'unowned',
        owner: null,
      }),
      enableDaemon: async () => ({
        mode: 'daemon',
        revision: 2,
        updatedAt: '2026-07-28T00:00:01.000Z',
      }),
    },
  });

  adapter.configureStartupMode('legacy');
  assert.equal(adapter.selectedHost(), 'legacy');
  await adapter.initialize();
  await assert.rejects(
    async () => adapter.configureStartupMode('runtime'),
    /before initialization/,
  );
  await adapter.close();
});

test('daemon startup reconciles an unowned inline policy before Runtime initialization', async () => {
  const calls: string[] = [];
  const timingEvents: Array<{
    scope: string;
    stage: string;
    phase: string;
    data?: Readonly<Record<string, unknown>>;
  }> = [];
  const fake = createFakeRuntime();
  const adapter = new RuntimeHostAdapter({
    mode: 'runtime',
    profileRoot: 'C:\\isolated-profile',
    runtimeFactory: async () => {
      calls.push('runtime');
      return fake.runtime;
    },
    identityStore: testIdentityStore,
    ownerControl: {
      acquireInline: async () => {
        throw new Error('not used');
      },
      getState: async () => ({
        profile: 'coder',
        policy: {
          mode: 'inline',
          revision: 3,
          updatedAt: '2026-07-28T00:00:00.000Z',
        },
        ownerStatus: 'unowned',
        owner: null,
      }),
      enableDaemon: async () => {
        calls.push('enable-daemon');
        return {
          mode: 'daemon',
          revision: 4,
          updatedAt: '2026-07-28T00:00:01.000Z',
        };
      },
    },
    startupTimingFactory: (scope) => ({
      enabled: true,
      mark: (stage, phase = 'complete', data) => {
        timingEvents.push({ scope, stage, phase, ...(data === undefined ? {} : { data }) });
      },
    }),
  });

  await adapter.reconcileStartupOwnerPolicy();
  await adapter.initialize('0.1.33');
  assert.deepEqual(calls, ['enable-daemon', 'runtime']);
  assert.deepEqual(
    timingEvents.map(({ scope, stage, phase }) => `${scope}:${stage}:${phase}`),
    [
      'runtime-owner-policy:reconcile:start',
      'runtime-owner-policy:owner_state_read:complete',
      'runtime-owner-policy:daemon_policy_enable:complete',
      'runtime-owner-policy:reconcile:complete',
      'runtime-host-initialize:initialize:start',
      'runtime-host-initialize:identity_open:complete',
      'runtime-host-initialize:runtime_factory_connect:complete',
      'runtime-host-initialize:output_segment_projection_import:complete',
      'runtime-host-initialize:capability_validation:complete',
      'runtime-host-initialize:host_tools_module_import:complete',
      'runtime-host-initialize:host_tools_register:complete',
      'runtime-host-initialize:connection_validate:complete',
      'runtime-host-initialize:connection_subscription_ready:complete',
      'runtime-host-initialize:workflow_subscription_ready:complete',
      'runtime-host-initialize:credential_leases_resume:complete',
      'runtime-host-initialize:profile_refresh:complete',
      'runtime-host-initialize:desired_observations_restore:complete',
      'runtime-host-initialize:initialize:complete',
    ],
  );
  assert.equal(timingEvents[1]?.data?.ownerStatus, 'unowned');
  const runtimeConnectTiming = timingEvents.find(
    ({ scope, stage }) =>
      scope === 'runtime-host-initialize' && stage === 'runtime_factory_connect',
  );
  assert.equal(runtimeConnectTiming?.data?.runtimeId, 'rt_test');
  assert.equal(typeof runtimeConnectTiming?.data?.runtimeAgeMs, 'number');
  await adapter.close();
});

test('daemon startup delegates stale owned inline recovery to the SDK before initialization', async () => {
  const calls: string[] = [];
  const fake = createFakeRuntime();
  const adapter = new RuntimeHostAdapter({
    mode: 'runtime',
    profileRoot: 'C:\\isolated-profile',
    runtimeFactory: async () => {
      calls.push('runtime');
      return fake.runtime;
    },
    identityStore: testIdentityStore,
    ownerControl: {
      acquireInline: async () => {
        throw new Error('not used');
      },
      getState: async () => ({
        profile: 'coder',
        policy: {
          mode: 'inline',
          revision: 3,
          updatedAt: '2026-08-11T00:00:00.000Z',
        },
        ownerStatus: 'owned',
        owner: {
          runtimeId: 'inline-stale',
          pid: 999_999_999,
          createdAt: '2026-08-11T00:00:00.000Z',
          kind: 'inline',
        },
      }),
      enableDaemon: async () => {
        calls.push('enable-daemon');
        return {
          mode: 'daemon',
          revision: 4,
          updatedAt: '2026-08-11T00:00:01.000Z',
        };
      },
    },
  });

  await adapter.reconcileStartupOwnerPolicy();
  await adapter.initialize('0.1.42');

  assert.deepEqual(calls, ['enable-daemon', 'runtime']);
  await adapter.close();
});

test('daemon startup stays fail-closed when the SDK rejects an active inline owner', async () => {
  let daemonEnables = 0;
  let runtimeFactories = 0;
  const controller = createPendingSdkRuntimeProjection(100);
  const adapter = new RuntimeHostAdapter({
    mode: 'runtime',
    profileRoot: 'C:\\isolated-profile',
    projectionController: controller,
    runtimeFactory: async () => {
      runtimeFactories += 1;
      return createFakeRuntime().runtime;
    },
    ownerControl: {
      acquireInline: async () => {
        throw new Error('not used');
      },
      getState: async () => ({
        profile: 'coder',
        policy: {
          mode: 'inline',
          revision: 3,
          updatedAt: '2026-07-28T00:00:00.000Z',
        },
        ownerStatus: 'owned',
        owner: null,
      }),
      enableDaemon: async () => {
        daemonEnables += 1;
        throw new Error('Cannot enable Runtime daemon ownership while inline owner is active.');
      },
    },
  });

  await assert.rejects(adapter.reconcileStartupOwnerPolicy(), /inline owner is active/);
  assert.equal(daemonEnables, 1);
  assert.equal(adapter.snapshot().state, 'failed');
  assert.equal(controller.profileSnapshot().connection.state, 'incompatible');
  await assert.rejects(adapter.initialize(), /owner policy reconciliation failed/i);
  assert.equal(runtimeFactories, 0);
  await adapter.close();
});

test('Runtime reconnect keeps the first real Space client version', async () => {
  const versions: string[] = [];
  let factoryCalls = 0;
  const fake = createFakeRuntime();
  const adapter = new RuntimeHostAdapter({
    mode: 'runtime',
    profileRoot: 'C:\\isolated-profile',
    identityStore: {
      openInstance: async ({ version }: { version: string }) => {
        versions.push(version);
        return testIdentityStore.openInstance({ version });
      },
    },
    runtimeFactory: async () => {
      factoryCalls += 1;
      if (factoryCalls === 1) throw new Error('first connection failed');
      return fake.runtime;
    },
  });

  await assert.rejects(adapter.initialize('0.1.33'), /first connection failed/);
  await adapter.initialize();
  assert.deepEqual(versions, ['0.1.33', '0.1.33']);
  await adapter.close();
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

test('adapter close retries a transient inline owner release failure', async () => {
  let closeAttempts = 0;
  const adapter = new RuntimeHostAdapter({
    mode: 'legacy',
    profileRoot: 'C:\\isolated-profile',
    ownerControl: {
      acquireInline: async () => ({
        profile: 'coder',
        ownerId: 'inline_retryable_close',
        ownerPolicy: {
          mode: 'inline',
          revision: 1,
          updatedAt: '2026-08-11T00:00:00.000Z',
        },
        close: () => {
          closeAttempts += 1;
          if (closeAttempts === 1) throw new Error('inline close failed');
        },
      }),
      getState: async () => ({
        profile: 'coder',
        policy: {
          mode: 'inline',
          revision: 1,
          updatedAt: '2026-08-11T00:00:00.000Z',
        },
        ownerStatus: 'owned',
        owner: null,
      }),
      enableDaemon: async () => ({
        mode: 'daemon',
        revision: 2,
        updatedAt: '2026-08-11T00:00:01.000Z',
      }),
    },
  });

  await adapter.initialize();
  await adapter.close();
  assert.equal(closeAttempts, 2);
  assert.equal(adapter.hasLegacyOwner(), false);
  assert.equal(adapter.snapshot().state, 'closed');
});

test('adapter close finishes local cleanup and retains the owner after release retries are exhausted', async () => {
  let closeAttempts = 0;
  const adapter = new RuntimeHostAdapter({
    mode: 'legacy',
    profileRoot: 'C:\\isolated-profile',
    ownerControl: {
      acquireInline: async () => ({
        profile: 'coder',
        ownerId: 'inline_failed_close',
        ownerPolicy: {
          mode: 'inline',
          revision: 1,
          updatedAt: '2026-08-11T00:00:00.000Z',
        },
        close: () => {
          closeAttempts += 1;
          if (closeAttempts <= 5) throw new Error('inline close failed');
        },
      }),
      getState: async () => ({
        profile: 'coder',
        policy: {
          mode: 'inline',
          revision: 1,
          updatedAt: '2026-08-11T00:00:00.000Z',
        },
        ownerStatus: 'owned',
        owner: null,
      }),
      enableDaemon: async () => ({
        mode: 'daemon',
        revision: 2,
        updatedAt: '2026-08-11T00:00:01.000Z',
      }),
    },
  });

  await adapter.initialize();
  await assert.rejects(adapter.close(), /inline close failed/);
  assert.equal(closeAttempts, 5);
  assert.equal(adapter.hasLegacyOwner(), false);
  assert.equal(adapter.snapshot().state, 'closed');
  await adapter.close();
  assert.equal(closeAttempts, 6);
});

test('adapter close retries a Runtime whose first close attempt fails', async () => {
  const fake = createFakeRuntime();
  let closeAttempts = 0;
  fake.runtime.close = async () => {
    closeAttempts += 1;
    if (closeAttempts === 1) throw new Error('runtime close failed');
  };
  const adapter = new RuntimeHostAdapter({
    mode: 'runtime',
    profileRoot: 'C:\\isolated-profile',
    runtimeFactory: async () => fake.runtime,
    identityStore: testIdentityStore,
  });

  await adapter.initialize();
  await assert.rejects(adapter.close(), /runtime close failed/);
  await adapter.close();
  assert.equal(closeAttempts, 2);
});

test('adapter close retries both Runtime and inline owner after simultaneous failures', async () => {
  const fake = createFakeRuntime();
  let runtimeCloseAttempts = 0;
  let ownerCloseAttempts = 0;
  fake.runtime.close = async () => {
    runtimeCloseAttempts += 1;
    if (runtimeCloseAttempts === 1) throw new Error('runtime close failed');
  };
  const adapter = new RuntimeHostAdapter({
    mode: 'runtime',
    profileRoot: 'C:\\isolated-profile',
    runtimeFactory: async () => fake.runtime,
    identityStore: testIdentityStore,
  });

  await adapter.initialize();
  const inlineOwner: RuntimeInlineOwnerHandle = {
    profile: 'coder',
    ownerId: 'inline_combined_close',
    ownerPolicy: {
      mode: 'inline',
      revision: 1,
      updatedAt: '2026-08-11T00:00:00.000Z',
    },
    close: () => {
      ownerCloseAttempts += 1;
      if (ownerCloseAttempts <= 5) throw new Error('inline close failed');
    },
  };
  (adapter as unknown as { inlineOwner: RuntimeInlineOwnerHandle }).inlineOwner = inlineOwner;

  await assert.rejects(
    adapter.close(),
    (error: unknown) => error instanceof AggregateError && error.errors.length === 2,
  );
  await adapter.close();
  assert.equal(runtimeCloseAttempts, 2);
  assert.equal(ownerCloseAttempts, 6);
});

test('embedded complete-exit close failure requires process recovery', async () => {
  const adapter = new RuntimeHostAdapter({
    mode: 'legacy',
    profileRoot: 'C:\\isolated-profile',
    ownerControl: {
      acquireInline: async () => ({
        profile: 'coder',
        ownerId: 'inline_close_failure',
        ownerPolicy: {
          mode: 'inline',
          revision: 1,
          updatedAt: '2026-08-06T00:00:00.000Z',
        },
        close: () => {
          throw new Error('inline close failed');
        },
      }),
      getState: async () => ({
        profile: 'coder',
        policy: {
          mode: 'inline',
          revision: 1,
          updatedAt: '2026-08-06T00:00:00.000Z',
        },
        ownerStatus: 'unowned',
        owner: null,
      }),
      enableDaemon: async () => ({
        mode: 'daemon',
        revision: 2,
        updatedAt: '2026-08-06T00:00:01.000Z',
      }),
    },
  });

  await adapter.initialize();
  await assert.rejects(adapter.stopDaemonForCompleteExit(), (error: unknown) =>
    isCoderOwnerRecoveryRestartRequired(error),
  );
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

test('failed daemon initialization can prepare an embedded restart through the safe owner gate', async () => {
  let acquiredInput: { enableRollback?: boolean } | undefined;
  const adapter = new RuntimeHostAdapter({
    mode: 'runtime',
    profileRoot: 'C:\\isolated-profile',
    runtimeFactory: async () => {
      throw new Error('daemon connection unavailable');
    },
    identityStore: testIdentityStore,
    idleDaemonStop: async () => ({ stopped: false, reason: 'missing' }),
    ownerControl: {
      acquireInline: async (input) => {
        acquiredInput = input;
        return {
          profile: 'coder',
          ownerId: 'inline_after_failed_daemon',
          ownerPolicy: {
            mode: 'inline',
            revision: 2,
            updatedAt: '2026-07-28T00:00:00.000Z',
          },
          close: () => undefined,
        };
      },
      getState: async () => ({
        profile: 'coder',
        policy: {
          mode: 'daemon',
          revision: 1,
          updatedAt: '2026-07-28T00:00:00.000Z',
        },
        ownerStatus: 'unowned',
        owner: null,
      }),
      enableDaemon: async () => ({
        mode: 'daemon',
        revision: 3,
        updatedAt: '2026-07-28T00:00:01.000Z',
      }),
    },
  });

  await assert.rejects(adapter.initialize(), /daemon connection unavailable/);
  await adapter.prepareEmbeddedRestart();

  assert.equal(acquiredInput?.enableRollback, true);
  assert.equal(adapter.snapshot().state, 'closed');
  await adapter.restoreDaemonOwner();
});

test('failed daemon path restores daemon policy when inline acquisition fails', async () => {
  let daemonRestores = 0;
  const adapter = new RuntimeHostAdapter({
    mode: 'runtime',
    profileRoot: 'C:\\isolated-profile',
    runtimeFactory: async () => {
      throw new Error('daemon connection unavailable');
    },
    identityStore: testIdentityStore,
    idleDaemonStop: async () => ({ stopped: false, reason: 'missing' }),
    ownerControl: {
      acquireInline: async () => {
        throw new Error('inline acquisition failed after policy write');
      },
      getState: async () => ({
        profile: 'coder',
        policy: {
          mode: 'inline',
          revision: 2,
          updatedAt: '2026-07-28T00:00:00.000Z',
        },
        ownerStatus: 'unowned',
        owner: null,
      }),
      enableDaemon: async () => {
        daemonRestores += 1;
        return {
          mode: 'daemon',
          revision: 3,
          updatedAt: '2026-07-28T00:00:01.000Z',
        };
      },
    },
  });

  await assert.rejects(adapter.initialize(), /daemon connection unavailable/);
  await assert.rejects(
    adapter.prepareEmbeddedRestart(),
    /inline acquisition failed after policy write/,
  );
  assert.equal(daemonRestores, 1);
  assert.equal(adapter.snapshot().state, 'failed');
  await adapter.close();
});

test('legacy owner can release its fence and enable daemon policy before restart', async () => {
  let inlineOwnerCloses = 0;
  let daemonEnables = 0;
  const adapter = new RuntimeHostAdapter({
    mode: 'legacy',
    profileRoot: 'C:\\isolated-profile',
    ownerControl: {
      acquireInline: async () => ({
        profile: 'coder',
        ownerId: 'inline_before_daemon',
        ownerPolicy: {
          mode: 'inline',
          revision: 1,
          updatedAt: '2026-07-28T00:00:00.000Z',
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
          updatedAt: '2026-07-28T00:00:00.000Z',
        },
        ownerStatus: 'unowned',
        owner: null,
      }),
      enableDaemon: async () => {
        daemonEnables += 1;
        return {
          mode: 'daemon',
          revision: 2,
          updatedAt: '2026-07-28T00:00:01.000Z',
        };
      },
    },
  });

  await adapter.initialize();
  const policy = await adapter.prepareDaemonRestart();

  assert.equal(policy.mode, 'daemon');
  assert.equal(inlineOwnerCloses, 1);
  assert.equal(daemonEnables, 1);
  assert.equal(adapter.snapshot().state, 'closed');
});

test('daemon enable and inline owner reacquire failure requires a recovery restart', async () => {
  let inlineOwnerAcquisitions = 0;
  const adapter = new RuntimeHostAdapter({
    mode: 'legacy',
    profileRoot: 'C:\\isolated-profile',
    ownerControl: {
      acquireInline: async () => {
        inlineOwnerAcquisitions += 1;
        if (inlineOwnerAcquisitions > 1) throw new Error('inline reacquire failed');
        return {
          profile: 'coder',
          ownerId: 'inline_before_failed_daemon',
          ownerPolicy: {
            mode: 'inline',
            revision: 1,
            updatedAt: '2026-07-28T00:00:00.000Z',
          },
          close: () => undefined,
        };
      },
      getState: async () => ({
        profile: 'coder',
        policy: {
          mode: 'inline',
          revision: 1,
          updatedAt: '2026-07-28T00:00:00.000Z',
        },
        ownerStatus: 'unowned',
        owner: null,
      }),
      enableDaemon: async () => {
        throw new Error('daemon enable failed');
      },
    },
  });

  await adapter.initialize();
  await assert.rejects(
    adapter.prepareDaemonRestart(),
    (error: unknown) =>
      isCoderOwnerRecoveryRestartRequired(error) &&
      error.message.includes('restore the embedded Coder owner'),
  );
  assert.equal(inlineOwnerAcquisitions, 2);
  assert.equal(adapter.snapshot().state, 'failed');
  assert.match(adapter.snapshot().error ?? '', /daemon enable failed.*inline reacquire failed/);
});

test('failed embedded initialization can recover to verified daemon policy before restart', async () => {
  let daemonEnables = 0;
  const adapter = new RuntimeHostAdapter({
    mode: 'legacy',
    profileRoot: 'C:\\isolated-profile',
    ownerControl: {
      acquireInline: async () => {
        throw new Error('inline owner unavailable');
      },
      getState: async () => ({
        profile: 'coder',
        policy: {
          mode: 'inline',
          revision: 1,
          updatedAt: '2026-07-28T00:00:00.000Z',
        },
        ownerStatus: 'unowned',
        owner: null,
      }),
      enableDaemon: async () => {
        daemonEnables += 1;
        return {
          mode: 'daemon',
          revision: 2,
          updatedAt: '2026-07-28T00:00:01.000Z',
        };
      },
    },
  });

  await assert.rejects(adapter.initialize(), /inline owner unavailable/);
  const policy = await adapter.prepareDaemonRestart();

  assert.equal(policy.mode, 'daemon');
  assert.equal(daemonEnables, 1);
  assert.equal(adapter.snapshot().state, 'closed');
  assert.equal(adapter.snapshot().error, undefined);
});

test('failed embedded initialization refuses daemon recovery while another owner is active', async () => {
  let daemonEnables = 0;
  const adapter = new RuntimeHostAdapter({
    mode: 'legacy',
    profileRoot: 'C:\\isolated-profile',
    ownerControl: {
      acquireInline: async () => {
        throw new Error('inline owner unavailable');
      },
      getState: async () => ({
        profile: 'coder',
        policy: {
          mode: 'inline',
          revision: 1,
          updatedAt: '2026-07-28T00:00:00.000Z',
        },
        ownerStatus: 'owned',
        owner: {
          runtimeId: 'other_owner',
          pid: 99,
          createdAt: '2026-07-28T00:00:00.000Z',
          kind: 'daemon',
        },
      }),
      enableDaemon: async () => {
        daemonEnables += 1;
        return {
          mode: 'daemon',
          revision: 2,
          updatedAt: '2026-07-28T00:00:01.000Z',
        };
      },
    },
  });

  await assert.rejects(adapter.initialize(), /inline owner unavailable/);
  await assert.rejects(adapter.prepareDaemonRestart(), /Another Coder owner is still active/);
  assert.equal(daemonEnables, 0);
  assert.equal(adapter.snapshot().state, 'failed');
});

test('runtime selection attaches one Coder daemon with stable identity and required contracts', async () => {
  const fake = createFakeRuntime();
  const options: Array<
    Omit<ConnectKodaXRuntimeOptions, 'requirements'> & {
      readonly daemonOrphanExitMs?: number;
      readonly requirements?: NonNullable<ConnectKodaXRuntimeOptions['requirements']> & {
        readonly daemonOrphanExit?: 1;
        readonly runtimeEventCoalescing?: 1;
        readonly sessionEventJournal?: 1;
      };
    }
  > = [];
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
  assert.equal(options[0]?.daemonOrphanExitMs, 30_000);
  assert.equal(options[0]?.clientInfo?.version, '0.1.30');
  assert.equal(options[0]?.clientInfo?.instanceId, 'space_instance_stable');
  assert.equal(options[0]?.clientInfo?.instanceSecret, 'space_secret_stable_0123456789abcdef');
  assert.equal(options[0]?.requirements?.sessionObservation, 1);
  assert.equal(options[0]?.requirements?.interruptInput, 1);
  assert.equal(options[0]?.requirements?.externalAgents, true);
  assert.equal(options[0]?.requirements?.externalAgentAdmin, 1);
  assert.equal(options[0]?.requirements?.actorControlPlane, 1);
  assert.equal(options[0]?.requirements?.learningCenter, 1);
  assert.equal(options[0]?.requirements?.skillLearningLoop, 1);
  assert.equal(options[0]?.requirements?.a2aConfigReconciler, 1);
  assert.equal(options[0]?.requirements?.coderFeatureMatrix, 1);
  assert.equal(options[0]?.requirements?.sessionAdmission, 1);
  assert.equal(options[0]?.requirements?.completeObservationSnapshot, 1);
  assert.equal(options[0]?.requirements?.contextCompaction, 3);
  assert.equal(options[0]?.requirements?.transcriptPaging, 1);
  assert.equal(options[0]?.requirements?.transcriptSearch, 1);
  assert.equal(options[0]?.requirements?.connectionLifecycle, 1);
  assert.equal(options[0]?.requirements?.typedRuntimeEvents, 1);
  assert.equal(options[0]?.requirements?.daemonSafeRunInput, 1);
  assert.equal(options[0]?.requirements?.sharedSessionSettings, 1);
  assert.equal(options[0]?.requirements?.durableRecoveryQueries, 1);
  assert.equal(options[0]?.requirements?.daemonManagement, 1);
  assert.equal(options[0]?.requirements?.daemonOrphanExit, 1);
  assert.equal(options[0]?.requirements?.actorSettlementConvergence, 2);
  assert.equal(options[0]?.requirements?.daemonShutdownVerification, undefined);
  assert.equal(options[0]?.requirements?.runtimeEventCoalescing, 1);
  assert.equal(options[0]?.requirements?.crashOutcomeModel, 2);
  assert.equal(options[0]?.requirements?.sandboxRuntime, 6);
  assert.equal(options[0]?.requirements?.sessionEventJournal, 1);
  assert.equal(options[0]?.requirements?.integrationConfigResilience, 1);
  assert.equal(options[0]?.requirements?.runtimeAutoModeGuardrail, 4);
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
  assert.equal(
    fake.calls.daemonInspections,
    1,
    'profile refresh must not inspect management state',
  );
});

test('integration health polling projects daemon watcher changes without reconnecting Coder', async () => {
  const fake = createFakeRuntime();
  const controller = new RuntimeProjectionController(
    createPendingSdkRuntimeProjection(100).profileSnapshot(),
  );
  const connectionStates: string[] = [];
  const adapter = new RuntimeHostAdapter({
    mode: 'runtime',
    profileRoot: path.resolve('C:\\isolated-profile'),
    runtimeFactory: async () => fake.runtime,
    identityStore: testIdentityStore,
    runtimeEventParser: testRuntimeEventParser,
    projectionController: controller,
    integrationHealthPollMs: 5,
    push: (channel, payload) => {
      if (channel === 'runtime.connectionChanged') {
        connectionStates.push(
          (payload as { integrations?: { state?: string } }).integrations?.state ?? 'missing',
        );
      }
    },
  });

  await adapter.initialize();
  await waitForTest(
    () => controller.profileSnapshot().connection.integrations?.state === 'healthy',
  );
  fake.setIntegrationHealth({
    state: 'degraded',
    domains: [
      {
        domain: 'mcp',
        path: 'C:\\Users\\test\\.kodax\\integrations\\mcp.json',
        source: 'user',
        watching: true,
        diagnostic: {
          code: 'invalid-config',
          message: 'Expected a JSON object.',
          time: '2026-07-29T01:02:03.000Z',
        },
      },
      {
        domain: 'a2a',
        path: 'C:\\Users\\test\\.kodax\\integrations\\a2a.json',
        source: 'default',
        watching: true,
      },
      {
        domain: 'extensions',
        path: 'C:\\Users\\test\\.kodax\\integrations\\extensions.json',
        source: 'default',
        watching: true,
      },
    ],
  });

  await waitForTest(
    () => controller.profileSnapshot().connection.integrations?.state === 'degraded',
  );
  assert.equal(adapter.snapshot().state, 'ready');
  assert.equal(
    controller.profileSnapshot().connection.integrations?.domains[0]?.diagnostic?.message,
    'Expected a JSON object.',
  );

  fake.setIntegrationHealth({
    state: 'healthy',
    domains: [
      {
        domain: 'mcp',
        path: 'C:\\Users\\test\\.kodax\\integrations\\mcp.json',
        source: 'user',
        watching: true,
        lastReloadAt: '2026-07-29T01:02:04.000Z',
      },
      {
        domain: 'a2a',
        path: 'C:\\Users\\test\\.kodax\\integrations\\a2a.json',
        source: 'default',
        watching: true,
      },
      {
        domain: 'extensions',
        path: 'C:\\Users\\test\\.kodax\\integrations\\extensions.json',
        source: 'default',
        watching: true,
      },
    ],
  });
  await waitForTest(
    () => controller.profileSnapshot().connection.integrations?.state === 'healthy',
  );

  assert.deepEqual(connectionStates.slice(-2), ['degraded', 'healthy']);
  assert.equal(adapter.snapshot().state, 'ready');
  await adapter.close();
});

test('a stuck integration inspection from a retired Runtime does not block the replacement', async () => {
  const retired = createFakeRuntime();
  const replacement = createFakeRuntime();
  retired.runtime.daemon.inspect = () => {
    retired.calls.daemonInspections += 1;
    return new Promise<RuntimeDaemonManagementState>(() => undefined);
  };
  replacement.setIntegrationHealth({
    state: 'degraded',
    domains: [
      {
        domain: 'mcp',
        path: 'C:\\Users\\test\\.kodax\\integrations\\mcp.json',
        source: 'user',
        watching: true,
        diagnostic: {
          code: 'watcher-degraded',
          message: 'replacement Runtime health',
          time: '2026-08-05T01:02:03.000Z',
        },
      },
    ],
  });
  const controller = new RuntimeProjectionController(
    createPendingSdkRuntimeProjection(100).profileSnapshot(),
  );
  let runtimeFactoryCalls = 0;
  const adapter = new RuntimeHostAdapter({
    mode: 'runtime',
    profileRoot: path.resolve('C:\\isolated-profile'),
    runtimeFactory: async () =>
      runtimeFactoryCalls++ === 0 ? retired.runtime : replacement.runtime,
    identityStore: testIdentityStore,
    runtimeEventParser: testRuntimeEventParser,
    projectionController: controller,
    integrationHealthPollMs: 5,
  });

  await adapter.initialize();
  await waitForTest(() => retired.calls.daemonInspections === 1);
  retired.disconnect(true);
  await waitForTest(() => adapter.snapshot().state === 'uninitialized');
  await adapter.initialize();

  await waitForTest(
    () =>
      replacement.calls.daemonInspections > 0 &&
      controller.profileSnapshot().connection.integrations?.state === 'degraded',
  );
  assert.equal(
    controller.profileSnapshot().connection.integrations?.domains[0]?.diagnostic?.message,
    'replacement Runtime health',
  );
  await adapter.close();
});

test('runtime custom provider catalog methods proxy through the connected daemon', async () => {
  const fake = createFakeRuntime();
  const adapter = new RuntimeHostAdapter({
    mode: 'runtime',
    profileRoot: path.resolve('C:\\isolated-profile'),
    runtimeFactory: async () => fake.runtime,
    identityStore: testIdentityStore,
    runtimeEventParser: testRuntimeEventParser,
  });
  await adapter.initialize();

  await adapter.upsertRuntimeCustomProvider({
    name: 'custom_0123456789abcdef',
    protocol: 'openai',
    baseUrl: 'http://127.0.0.1:11434/v1',
    apiKeyEnv: 'OLLAMA_API_KEY',
    model: 'ornith:35b',
    contextWindow: 131_072,
  });

  assert.equal(fake.calls.customProviderUpserts.length, 1);
  assert.equal(fake.calls.customProviderUpserts[0]?.contextWindow, 131_072);
  assert.equal((await adapter.listRuntimeCustomProviders())[0]?.name, 'custom_0123456789abcdef');
  assert.equal(await adapter.deleteRuntimeCustomProvider('custom_0123456789abcdef'), true);
  assert.deepEqual(fake.calls.customProviderDeletes, ['custom_0123456789abcdef']);
  assert.deepEqual(await adapter.listRuntimeCustomProviders(), []);
  await adapter.close();
});

test('a late Runtime-ready observer receives the current authoritative generation once', async () => {
  const fake = createFakeRuntime();
  const adapter = new RuntimeHostAdapter({
    mode: 'runtime',
    profileRoot: path.resolve('C:\\isolated-profile'),
    runtimeFactory: async () => fake.runtime,
    identityStore: testIdentityStore,
    runtimeEventParser: testRuntimeEventParser,
  });
  await adapter.initialize();

  const revisions: number[] = [];
  adapter.subscribeRuntimeReady((revision) => {
    revisions.push(revision);
  });
  await Promise.resolve();

  assert.deepEqual(revisions, [1]);
  await adapter.close();
});

test('Runtime disconnect during startup warm-up cannot publish a false ready generation', async () => {
  const fake = createFakeRuntime();
  const status = fake.runtime.status;
  const snapshot = status.snapshot.bind(status);
  let signalSnapshotStarted!: () => void;
  const snapshotStarted = new Promise<void>((resolve) => {
    signalSnapshotStarted = resolve;
  });
  let releaseSnapshot!: () => void;
  const snapshotRelease = new Promise<void>((resolve) => {
    releaseSnapshot = resolve;
  });
  status.snapshot = async () => {
    const result = await snapshot();
    signalSnapshotStarted();
    await snapshotRelease;
    return result;
  };
  const adapter = new RuntimeHostAdapter({
    mode: 'runtime',
    profileRoot: path.resolve('C:\\isolated-profile'),
    runtimeFactory: async () => fake.runtime,
    identityStore: testIdentityStore,
    runtimeEventParser: testRuntimeEventParser,
  });
  const revisions: number[] = [];
  adapter.subscribeRuntimeReady((revision) => {
    revisions.push(revision);
  });

  const initialization = adapter.initialize();
  await snapshotStarted;
  assert.equal(adapter.snapshot().state, 'ready');
  fake.disconnect(false);
  releaseSnapshot();

  await assert.rejects(initialization, /authority changed/i);
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.deepEqual(revisions, []);
  assert.equal(adapter.hasReadyRuntime(), false);
  assert.equal(adapter.snapshot().state, 'failed');
  await adapter.close();
});

test('Runtime reconnect warm-up cannot self-await while restoring desired observations', async () => {
  const first = createFakeRuntime();
  const second = createFakeRuntime();
  const third = createFakeRuntime();
  const sessionId = 's_reconnect_observation';
  for (const fake of [first, second, third]) {
    fake.sessions.add(sessionId);
    fake.settings.set(sessionId, { revision: 0, value: {} });
  }

  const secondStatus = second.runtime.status;
  const snapshot = secondStatus.snapshot.bind(secondStatus);
  let signalSnapshotStarted!: () => void;
  const snapshotStarted = new Promise<void>((resolve) => {
    signalSnapshotStarted = resolve;
  });
  let releaseSnapshot!: () => void;
  const snapshotRelease = new Promise<void>((resolve) => {
    releaseSnapshot = resolve;
  });
  secondStatus.snapshot = async () => {
    const result = await snapshot();
    signalSnapshotStarted();
    await snapshotRelease;
    return result;
  };

  let factoryCalls = 0;
  const runtimes = [first.runtime, second.runtime, third.runtime];
  const adapter = new RuntimeHostAdapter({
    mode: 'runtime',
    profileRoot: path.resolve('C:\\isolated-profile'),
    runtimeFactory: async () => {
      const runtime = runtimes[factoryCalls];
      factoryCalls += 1;
      if (!runtime) throw new Error('unexpected Runtime reconnect attempt');
      return runtime;
    },
    identityStore: testIdentityStore,
    runtimeEventParser: testRuntimeEventParser,
  });

  await adapter.initialize();
  await adapter.ensureObserved(sessionId);
  first.disconnect();
  await waitForTest(() => adapter.snapshot().state === 'uninitialized');

  const reconnect = adapter.initialize();
  await snapshotStarted;
  assert.equal(adapter.snapshot().state, 'ready');
  second.disconnect();
  releaseSnapshot();

  let reconnectTimeout: NodeJS.Timeout | undefined;
  const reconnectOutcome = await Promise.race([
    reconnect.then(
      () => ({ kind: 'resolved' as const }),
      (error: unknown) => ({ kind: 'rejected' as const, error }),
    ),
    new Promise<{ kind: 'timed-out' }>((resolve) => {
      reconnectTimeout = setTimeout(() => resolve({ kind: 'timed-out' }), 1_000);
    }),
  ]).finally(() => {
    if (reconnectTimeout) clearTimeout(reconnectTimeout);
  });
  assert.notEqual(reconnectOutcome.kind, 'timed-out');
  assert.equal(reconnectOutcome.kind, 'rejected');
  if (reconnectOutcome.kind === 'rejected') {
    assert.match(String(reconnectOutcome.error), /authority changed/i);
  }

  await adapter.initialize();
  assert.equal(adapter.hasReadyRuntime(), true);
  assert.equal(factoryCalls, 3);
  await waitForTest(() => third.calls.observationCloses >= 1);
  await adapter.close();
});

test('reconnect publishes core readiness before restoring a gated desired observation', async () => {
  const first = createFakeRuntime();
  const second = createFakeRuntime();
  const observedSessionId = 's_reconnect_background_observation';
  const historySessionId = 's_reconnect_history';
  for (const fake of [first, second]) {
    fake.sessions.add(observedSessionId);
    fake.sessions.add(historySessionId);
  }
  const originalObserve = second.runtime.sessions.observe.bind(second.runtime.sessions);
  let signalObserveStarted!: () => void;
  const observeStarted = new Promise<void>((resolve) => {
    signalObserveStarted = resolve;
  });
  let releaseObserve!: () => void;
  const observeRelease = new Promise<void>((resolve) => {
    releaseObserve = resolve;
  });
  second.runtime.sessions.observe = async (...args) => {
    if (args[0] === observedSessionId) {
      signalObserveStarted();
      await observeRelease;
    }
    return originalObserve(...args);
  };
  let factoryCalls = 0;
  const adapter = new RuntimeHostAdapter({
    mode: 'runtime',
    profileRoot: path.resolve('C:\\isolated-profile'),
    runtimeFactory: async () => (factoryCalls++ === 0 ? first.runtime : second.runtime),
    identityStore: testIdentityStore,
    runtimeEventParser: testRuntimeEventParser,
  });

  await adapter.initialize();
  await adapter.ensureObserved(observedSessionId);
  first.disconnect();
  await waitForTest(() => adapter.snapshot().state === 'uninitialized');
  await adapter.initialize();
  await observeStarted;
  try {
    const history = await Promise.race([
      adapter.conversationHistoryPage({ sessionId: historySessionId }),
      new Promise<never>((_resolve, reject) => {
        setTimeout(() => reject(new Error('history waited for desired observation restore')), 250);
      }),
    ]);
    assert.equal(history.outcome, 'ready');
  } finally {
    releaseObserve();
    await waitForTest(() => second.calls.observationCloses >= 1);
    await adapter.close();
  }
});

test('foreground live snapshot overtakes desired observations not yet restoring after reconnect', async () => {
  const first = createFakeRuntime();
  const second = createFakeRuntime();
  const backgroundSessionIds = [
    's_reconnect_background_one',
    's_reconnect_background_two',
    's_reconnect_background_three',
  ];
  const foregroundSessionId = 's_reconnect_foreground';
  for (const fake of [first, second]) {
    for (const sessionId of [...backgroundSessionIds, foregroundSessionId]) {
      fake.sessions.add(sessionId);
    }
  }

  const originalObserve = second.runtime.sessions.observe.bind(second.runtime.sessions);
  const started: string[] = [];
  let activeObservations = 0;
  let maxActiveObservations = 0;
  let signalHeadStarted!: () => void;
  const headStarted = new Promise<void>((resolve) => {
    signalHeadStarted = resolve;
  });
  let releaseHead!: () => void;
  const headGate = new Promise<void>((resolve) => {
    releaseHead = resolve;
  });
  let releaseTail!: () => void;
  const tailGate = new Promise<void>((resolve) => {
    releaseTail = resolve;
  });
  second.runtime.sessions.observe = async (...args: Parameters<typeof originalObserve>) => {
    const sessionId = args[0];
    started.push(sessionId);
    activeObservations += 1;
    maxActiveObservations = Math.max(maxActiveObservations, activeObservations);
    try {
      if (sessionId === backgroundSessionIds[0]) {
        signalHeadStarted();
        await headGate;
      } else if (backgroundSessionIds.slice(1).includes(sessionId)) {
        await tailGate;
      }
      return await originalObserve(...args);
    } finally {
      activeObservations -= 1;
    }
  };

  let factoryCalls = 0;
  const adapter = new RuntimeHostAdapter({
    mode: 'runtime',
    profileRoot: path.resolve('C:\\isolated-profile'),
    runtimeFactory: async () => (factoryCalls++ === 0 ? first.runtime : second.runtime),
    identityStore: testIdentityStore,
    runtimeEventParser: testRuntimeEventParser,
  });

  await adapter.initialize();
  for (const sessionId of [...backgroundSessionIds, foregroundSessionId]) {
    await adapter.ensureObserved(sessionId);
  }
  first.disconnect();
  await waitForTest(() => adapter.snapshot().state === 'uninitialized');
  await adapter.initialize();
  await headStarted;

  const foreground = adapter.readSessionLiveSnapshot(foregroundSessionId);
  await new Promise<void>((resolve) => setTimeout(resolve, 25));
  releaseHead();
  try {
    const snapshot = await Promise.race([
      foreground,
      new Promise<never>((_resolve, reject) => {
        setTimeout(() => reject(new Error('foreground live snapshot waited behind recovery')), 250);
      }),
    ]);
    assert.equal(snapshot.sessionId, foregroundSessionId);
    assert.deepEqual(started.slice(0, 2), [backgroundSessionIds[0], foregroundSessionId]);
    assert.equal(maxActiveObservations, 1);
  } finally {
    releaseTail();
    await waitForTest(() => started.length >= backgroundSessionIds.length + 1);
    assert.equal(
      started.filter((sessionId) => sessionId === foregroundSessionId).length,
      1,
      'the background pump must skip a desired Session already restored in the foreground',
    );
    await adapter.close();
  }
});

test('background profile refresh bursts coalesce to one in-flight and one trailing read', async () => {
  const fake = createFakeRuntime();
  const adapter = new RuntimeHostAdapter({
    mode: 'runtime',
    profileRoot: path.resolve('C:\\isolated-profile'),
    runtimeFactory: async () => fake.runtime,
    identityStore: testIdentityStore,
    runtimeEventParser: testRuntimeEventParser,
  });
  await adapter.initialize();

  const originalSnapshot = fake.runtime.status.snapshot.bind(fake.runtime.status);
  let reads = 0;
  let signalFirstStarted!: () => void;
  const firstStarted = new Promise<void>((resolve) => {
    signalFirstStarted = resolve;
  });
  let releaseFirst!: () => void;
  const firstGate = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  fake.runtime.status.snapshot = async () => {
    reads += 1;
    if (reads === 1) {
      signalFirstStarted();
      await firstGate;
    }
    return originalSnapshot();
  };
  const schedule = (
    adapter as unknown as { scheduleProfileRefresh(cursor: number): void }
  ).scheduleProfileRefresh.bind(adapter);

  schedule(1);
  await firstStarted;
  for (let cursor = 2; cursor <= 20; cursor += 1) schedule(cursor);
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(reads, 1);

  releaseFirst();
  await waitForTest(() => reads >= 2);
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(reads, 2);
  await adapter.close();
});

test('background profile refresh retains a trailing request when the in-flight read fails', async () => {
  const fake = createFakeRuntime();
  const adapter = new RuntimeHostAdapter({
    mode: 'runtime',
    profileRoot: path.resolve('C:\\isolated-profile'),
    runtimeFactory: async () => fake.runtime,
    identityStore: testIdentityStore,
    runtimeEventParser: testRuntimeEventParser,
  });
  await adapter.initialize();

  const originalSnapshot = fake.runtime.status.snapshot.bind(fake.runtime.status);
  let reads = 0;
  let signalFirstStarted!: () => void;
  const firstStarted = new Promise<void>((resolve) => {
    signalFirstStarted = resolve;
  });
  let releaseFirst!: () => void;
  const firstGate = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  fake.runtime.status.snapshot = async () => {
    reads += 1;
    if (reads === 1) {
      signalFirstStarted();
      await firstGate;
      throw new Error('first background profile read failed');
    }
    return originalSnapshot();
  };
  const schedule = (
    adapter as unknown as { scheduleProfileRefresh(cursor: number): void }
  ).scheduleProfileRefresh.bind(adapter);

  schedule(1);
  await firstStarted;
  schedule(2);
  releaseFirst();
  await waitForTest(() => reads >= 2);
  assert.equal(reads, 2);
  await adapter.close();
});

test('known credential recovery cannot hold Runtime readiness or history', async () => {
  const fake = createFakeRuntime('rt_known_credential_background');
  fake.sessions.add('s_known_credential_history');
  let signalResumeStarted!: () => void;
  const resumeStarted = new Promise<void>((resolve) => {
    signalResumeStarted = resolve;
  });
  let releaseResume!: () => void;
  const resumeRelease = new Promise<void>((resolve) => {
    releaseResume = resolve;
  });
  fake.runtime.credentials.resume = async (leaseId) => {
    signalResumeStarted();
    await resumeRelease;
    return { id: leaseId, providers: [] };
  };
  const adapter = new RuntimeHostAdapter({
    mode: 'runtime',
    profileRoot: path.resolve('C:\\isolated-profile'),
    runtimeFactory: async () => fake.runtime,
    identityStore: testIdentityStore,
    runtimeEventParser: testRuntimeEventParser,
  });
  (
    adapter as unknown as {
      credentialLeases: Map<string, unknown>;
    }
  ).credentialLeases.set('credential_known_background', {
    leaseId: 'credential_known_background',
    provider: 'mock',
    sessionId: 's_known_credential_history',
    runBinding: {},
    broker: async () => undefined,
  });

  const initializing = adapter.initialize();
  try {
    await resumeStarted;
    await Promise.race([
      initializing,
      new Promise<never>((_resolve, reject) => {
        setTimeout(
          () => reject(new Error('Runtime readiness waited for credential recovery')),
          250,
        );
      }),
    ]);
    const history = await Promise.race([
      adapter.conversationHistoryPage({ sessionId: 's_known_credential_history' }),
      new Promise<never>((_resolve, reject) => {
        setTimeout(() => reject(new Error('history waited for credential recovery')), 250);
      }),
    ]);
    assert.equal(history.outcome, 'ready');
  } finally {
    releaseResume();
    await initializing.catch(() => undefined);
    await adapter.close();
  }
});

test('one post-attach binding stall cannot serialize other desired Session restores', async () => {
  const first = createFakeRuntime('rt_restore_first');
  const second = createFakeRuntime('rt_restore_second');
  const blockerId = 's_restore_binding_blocker';
  const followerId = 's_restore_binding_follower';
  for (const fake of [first, second]) {
    fake.sessions.add(blockerId);
    fake.sessions.add(followerId);
  }
  const originalObserve = second.runtime.sessions.observe.bind(second.runtime.sessions);
  second.runtime.sessions.observe = async (...args) => {
    const observation = await originalObserve(...args);
    if (args[0] !== blockerId) return observation;
    return {
      ...observation,
      snapshot: {
        ...observation.snapshot,
        runs: [
          {
            runId: 'run_restore_binding_blocker',
            sessionId: blockerId,
            phase: 'running' as const,
            provider: 'mock',
            mode: 'managed_task' as const,
            startedAt: '2026-08-05T12:00:00.000Z',
            requirements: {
              credential: {
                leaseId: 'credential_restore_blocker',
                provider: 'mock',
                state: 'ready' as const,
              },
            },
          },
        ],
      },
    };
  };
  const originalResume = second.runtime.credentials.resume.bind(second.runtime.credentials);
  let signalResumeStarted!: () => void;
  const resumeStarted = new Promise<void>((resolve) => {
    signalResumeStarted = resolve;
  });
  let releaseResume!: () => void;
  const resumeRelease = new Promise<void>((resolve) => {
    releaseResume = resolve;
  });
  second.runtime.credentials.resume = async (...args) => {
    if (args[0] === 'credential_restore_blocker') {
      signalResumeStarted();
      await resumeRelease;
    }
    return originalResume(...args);
  };
  let factoryCalls = 0;
  const adapter = new RuntimeHostAdapter({
    mode: 'runtime',
    profileRoot: path.resolve('C:\\isolated-profile'),
    runtimeFactory: async () => (factoryCalls++ === 0 ? first.runtime : second.runtime),
    identityStore: testIdentityStore,
    runtimeEventParser: testRuntimeEventParser,
  });

  await adapter.initialize();
  await adapter.ensureObserved(blockerId);
  await adapter.ensureObserved(followerId);
  first.disconnect();
  await waitForTest(() => adapter.snapshot().state === 'uninitialized');
  await adapter.initialize();
  await resumeStarted;
  try {
    const follower = await Promise.race([
      adapter.readSessionLiveSnapshot(followerId),
      new Promise<never>((_resolve, reject) => {
        setTimeout(
          () => reject(new Error('follower live snapshot waited for blocker binding')),
          250,
        );
      }),
    ]);
    assert.equal(follower.sessionId, followerId);
  } finally {
    releaseResume();
    await adapter.close();
  }
});

test('snapshot binding recovery cannot hold its own core live projection', async () => {
  const fake = createFakeRuntime('rt_snapshot_binding_background');
  const sessionId = 's_snapshot_binding_background';
  fake.sessions.add(sessionId);
  const originalObserve = fake.runtime.sessions.observe.bind(fake.runtime.sessions);
  fake.runtime.sessions.observe = async (...args) => {
    const observation = await originalObserve(...args);
    return {
      ...observation,
      snapshot: {
        ...observation.snapshot,
        runs: [
          {
            runId: 'run_snapshot_binding_background',
            sessionId,
            phase: 'running' as const,
            provider: 'mock',
            mode: 'managed_task' as const,
            startedAt: '2026-08-05T12:00:00.000Z',
            requirements: {
              credential: {
                leaseId: 'credential_snapshot_binding_background',
                provider: 'mock',
                state: 'ready' as const,
              },
            },
          },
        ],
      },
    };
  };
  let signalResumeStarted!: () => void;
  const resumeStarted = new Promise<void>((resolve) => {
    signalResumeStarted = resolve;
  });
  let releaseResume!: () => void;
  const resumeRelease = new Promise<void>((resolve) => {
    releaseResume = resolve;
  });
  fake.runtime.credentials.resume = async (leaseId) => {
    signalResumeStarted();
    await resumeRelease;
    return { id: leaseId, providers: [] };
  };
  const adapter = new RuntimeHostAdapter({
    mode: 'runtime',
    profileRoot: path.resolve('C:\\isolated-profile'),
    runtimeFactory: async () => fake.runtime,
    identityStore: testIdentityStore,
    runtimeEventParser: testRuntimeEventParser,
  });

  await adapter.initialize();
  const opening = adapter.readSessionLiveSnapshot(sessionId);
  try {
    await resumeStarted;
    const snapshot = await Promise.race([
      opening,
      new Promise<never>((_resolve, reject) => {
        setTimeout(() => reject(new Error('live projection waited for snapshot binding')), 250);
      }),
    ]);
    assert.equal(snapshot.activeRun?.runId, 'run_snapshot_binding_background');
  } finally {
    releaseResume();
    await opening.catch(() => undefined);
    await adapter.close();
  }
});

test('terminal evidence fences a late same-Runtime snapshot binding', async () => {
  const fake = createFakeRuntime('rt_terminal_binding_fence');
  const sessionId = 's_terminal_binding_fence';
  const runId = 'run_terminal_binding_fence';
  const leaseId = 'credential_terminal_binding_fence';
  fake.sessions.add(sessionId);
  const originalObserve = fake.runtime.sessions.observe.bind(fake.runtime.sessions);
  fake.runtime.sessions.observe = async (...args) => {
    const observation = await originalObserve(...args);
    return {
      ...observation,
      snapshot: {
        ...observation.snapshot,
        runs: [
          {
            runId,
            sessionId,
            phase: 'running' as const,
            provider: 'mock',
            mode: 'managed_task' as const,
            startedAt: '2026-08-05T12:00:00.000Z',
            requirements: {
              credential: {
                leaseId,
                provider: 'mock',
                state: 'ready' as const,
              },
            },
          },
        ],
      },
    };
  };
  const originalResume = fake.runtime.credentials.resume.bind(fake.runtime.credentials);
  let signalResumeStarted!: () => void;
  const resumeStarted = new Promise<void>((resolve) => {
    signalResumeStarted = resolve;
  });
  let releaseResume!: () => void;
  const resumeRelease = new Promise<void>((resolve) => {
    releaseResume = resolve;
  });
  fake.runtime.credentials.resume = async (...args) => {
    signalResumeStarted();
    await resumeRelease;
    return originalResume(...args);
  };
  const adapter = new RuntimeHostAdapter({
    mode: 'runtime',
    profileRoot: path.resolve('C:\\isolated-profile'),
    runtimeFactory: async () => fake.runtime,
    identityStore: testIdentityStore,
    runtimeEventParser: testRuntimeEventParser,
  });

  await adapter.initialize();
  assert.equal((await adapter.readSessionLiveSnapshot(sessionId)).activeRun?.runId, runId);
  await resumeStarted;
  fake.emit({
    id: 'event_terminal_binding_fence',
    seq: 1,
    time: '2026-08-05T12:00:01.000Z',
    type: 'run.completed',
    sessionId,
    runId,
    payload: {
      runId,
      sessionId,
      phase: 'completed',
      provider: 'mock',
      mode: 'managed_task',
      startedAt: '2026-08-05T12:00:00.000Z',
      endedAt: '2026-08-05T12:00:01.000Z',
    },
  });
  releaseResume();
  await new Promise<void>((resolve) => setImmediate(resolve));

  const credentialLeases = (
    adapter as unknown as {
      credentialLeases: Map<string, unknown>;
    }
  ).credentialLeases;
  assert.equal(credentialLeases.has(leaseId), false);
  await adapter.close();
});

test('queued terminal evidence fences a late same-Runtime snapshot binding', async () => {
  const fake = createFakeRuntime('rt_queued_terminal_binding_fence');
  const sessionId = 's_queued_terminal_binding_fence';
  const runId = 'run_queued_terminal_binding_fence';
  const leaseId = 'credential_queued_terminal_binding_fence';
  fake.sessions.add(sessionId);
  const originalObserve = fake.runtime.sessions.observe.bind(fake.runtime.sessions);
  fake.runtime.sessions.observe = async (...args) => {
    const observation = await originalObserve(...args);
    return {
      ...observation,
      snapshot: {
        ...observation.snapshot,
        runs: [
          {
            runId,
            sessionId,
            phase: 'queued' as const,
            provider: 'mock',
            mode: 'managed_task' as const,
            startedAt: '2026-08-05T12:00:00.000Z',
            requirements: {
              credential: {
                leaseId,
                provider: 'mock',
                state: 'ready' as const,
              },
            },
          },
        ],
      },
    };
  };
  let signalResumeStarted!: () => void;
  const resumeStarted = new Promise<void>((resolve) => {
    signalResumeStarted = resolve;
  });
  let releaseResume!: () => void;
  const resumeRelease = new Promise<void>((resolve) => {
    releaseResume = resolve;
  });
  fake.runtime.credentials.resume = async (leaseIdToResume) => {
    signalResumeStarted();
    await resumeRelease;
    return { id: leaseIdToResume, providers: [] };
  };
  const adapter = new RuntimeHostAdapter({
    mode: 'runtime',
    profileRoot: path.resolve('C:\\isolated-profile'),
    runtimeFactory: async () => fake.runtime,
    identityStore: testIdentityStore,
    runtimeEventParser: testRuntimeEventParser,
  });

  await adapter.initialize();
  assert.deepEqual(
    (await adapter.readSessionLiveSnapshot(sessionId)).queuedRuns.map((run) => run.runId),
    [runId],
  );
  await resumeStarted;
  fake.emit({
    id: 'event_queued_terminal_binding_fence',
    seq: 1,
    time: '2026-08-05T12:00:01.000Z',
    type: 'run.cancelled',
    sessionId,
    runId,
    payload: {
      runId,
      sessionId,
      phase: 'cancelled',
      provider: 'mock',
      mode: 'managed_task',
      startedAt: '2026-08-05T12:00:00.000Z',
      endedAt: '2026-08-05T12:00:01.000Z',
    },
  });
  releaseResume();
  await new Promise<void>((resolve) => setImmediate(resolve));

  const credentialLeases = (
    adapter as unknown as {
      credentialLeases: Map<string, unknown>;
    }
  ).credentialLeases;
  assert.equal(credentialLeases.has(leaseId), false);
  await adapter.close();
});

test('same-runtime-id reconnect restores an active live projection', async () => {
  const first = createFakeRuntime('rt_stable_reconnect');
  const second = createFakeRuntime('rt_stable_reconnect');
  const sessionId = 's_stable_reconnect';
  first.sessions.add(sessionId);
  second.sessions.add(sessionId);
  const secondObserve = second.runtime.sessions.observe.bind(second.runtime.sessions);
  second.runtime.sessions.observe = async (...args) => {
    const observation = await secondObserve(...args);
    return {
      ...observation,
      snapshot: {
        ...observation.snapshot,
        runs: [
          {
            runId: 'run_stable_reconnect',
            sessionId,
            phase: 'running' as const,
            provider: 'mock',
            mode: 'managed_task' as const,
            startedAt: '2026-08-05T12:00:00.000Z',
          },
        ],
      },
    };
  };
  const controller = new RuntimeProjectionController(
    createPendingSdkRuntimeProjection(100).profileSnapshot(),
  );
  let factoryCalls = 0;
  const adapter = new RuntimeHostAdapter({
    mode: 'runtime',
    profileRoot: path.resolve('C:\\isolated-profile'),
    runtimeFactory: async () => (factoryCalls++ === 0 ? first.runtime : second.runtime),
    identityStore: testIdentityStore,
    runtimeEventParser: testRuntimeEventParser,
    projectionController: controller,
  });

  await adapter.initialize();
  await adapter.ensureObserved(sessionId);
  first.disconnect();
  await waitForTest(() => adapter.snapshot().state === 'uninitialized');
  await adapter.initialize();
  await waitForTest(() => {
    try {
      return controller.sessionLiveSnapshot(sessionId).activeRun?.runId === 'run_stable_reconnect';
    } catch {
      return false;
    }
  });
  assert.equal(controller.sessionLiveSnapshot(sessionId).cursor.runtimeId, 'rt_stable_reconnect');
  await adapter.close();
});

test('active observation trusts the SDK output segment snapshot without replay fallback', async () => {
  const fake = createFakeRuntime('rt_recovered_observation');
  const sessionId = 's_recovered_observation';
  const runId = 'run_recovered_observation';
  fake.sessions.add(sessionId);
  const originalObserve = fake.runtime.sessions.observe.bind(fake.runtime.sessions);
  fake.runtime.sessions.observe = async (...args) => {
    const observation = await originalObserve(...args);
    return {
      ...observation,
      snapshot: {
        ...observation.snapshot,
        cursor: testRuntimeCursor(sessionId, 7),
        runs: [
          {
            runId,
            sessionId,
            turnId: 'turn_recovered_observation',
            phase: 'running' as const,
            provider: 'mock',
            mode: 'managed_task' as const,
            startedAt: '2026-08-14T00:00:00.000Z',
          },
        ],
        live: {
          ...observation.snapshot.live,
          assistantTextByRun: { [runId]: 'replacement' },
          thinkingTextByRun: { [runId]: 'replacement thinking' },
          outputSegmentsByRun: {
            [runId]: {
              retained: [],
              active: {
                responseId: 'response_recovered',
                providerRequestId: 'request_replacement',
                mode: 'replace',
                startedAtSeq: 6,
                assistantText: 'replacement',
                thinkingText: 'replacement thinking',
              },
            },
          },
        },
      },
    };
  };
  let replayCalls = 0;
  fake.runtime.events.replay = async (filter) => {
    replayCalls += 1;
    assert.equal(filter.runId, runId);
    assert.deepEqual(filter.type, [
      'turn.started',
      'run.progress',
      'assistant.delta',
      'thinking.delta',
      'thinking.finished',
      'tool.finished',
      'provider.recovery',
    ]);
    assert.equal(filter.limit, undefined);
    return [
      withTestRuntimeCursor({
        id: 'event_recovered_root_start',
        seq: 1,
        time: '2026-08-14T00:00:00.050Z',
        type: 'turn.started',
        sessionId,
        runId,
        payload: {
          sessionId,
          seq: 1,
          turnId: 'turn_recovered_observation',
          deliveryKind: 'initial',
          contextKind: 'root',
        },
      }),
      withTestRuntimeCursor({
        id: 'event_recovered_iteration',
        seq: 2,
        time: '2026-08-14T00:00:00.100Z',
        type: 'run.progress',
        sessionId,
        runId,
        turnId: 'turn_recovered_observation',
        payload: { kind: 'iteration_start', iter: 1, maxIter: 200 },
      }),
      withTestRuntimeCursor({
        id: 'event_abandoned_text',
        seq: 3,
        time: '2026-08-14T00:00:00.200Z',
        type: 'assistant.delta',
        sessionId,
        runId,
        turnId: 'turn_recovered_observation',
        payload: { text: 'abandoned' },
      }),
      withTestRuntimeCursor({
        id: 'event_abandoned_thinking',
        seq: 4,
        time: '2026-08-14T00:00:00.300Z',
        type: 'thinking.delta',
        sessionId,
        runId,
        turnId: 'turn_recovered_observation',
        payload: { text: 'abandoned thinking' },
      }),
      withTestRuntimeCursor({
        id: 'event_recovered_boundary',
        seq: 5,
        time: '2026-08-14T00:00:00.400Z',
        type: 'provider.recovery',
        sessionId,
        runId,
        turnId: 'turn_recovered_observation',
        payload: {
          event: {
            stage: 'mid_stream_text',
            errorClass: 'connection_failure',
            attempt: 1,
            maxAttempts: 4,
            delayMs: 0,
            recoveryAction: 'stable_boundary_retry',
            ladderStep: 2,
            fallbackUsed: false,
          },
        },
      }),
      withTestRuntimeCursor({
        id: 'event_replacement_text',
        seq: 6,
        time: '2026-08-14T00:00:00.500Z',
        type: 'assistant.delta',
        sessionId,
        runId,
        turnId: 'turn_recovered_observation',
        payload: { text: 'replacement' },
      }),
      withTestRuntimeCursor({
        id: 'event_replacement_thinking',
        seq: 7,
        time: '2026-08-14T00:00:00.600Z',
        type: 'thinking.delta',
        sessionId,
        runId,
        turnId: 'turn_recovered_observation',
        payload: { text: 'replacement thinking' },
      }),
      withTestRuntimeCursor({
        id: 'event_after_snapshot_cursor',
        seq: 8,
        time: '2026-08-14T00:00:00.700Z',
        type: 'assistant.delta',
        sessionId,
        runId,
        turnId: 'turn_recovered_observation',
        payload: { text: 'future event' },
      }),
    ];
  };
  const adapter = new RuntimeHostAdapter({
    mode: 'runtime',
    profileRoot: path.resolve('C:\\isolated-profile'),
    runtimeFactory: async () => fake.runtime,
    identityStore: testIdentityStore,
    runtimeEventParser: testRuntimeEventParser,
  });

  await adapter.initialize();
  await adapter.ensureObserved(sessionId);

  const live = await adapter.readSessionLiveSnapshot(sessionId);
  assert.equal(replayCalls, 0);
  assert.equal(live.assistantDraft?.text, 'replacement');
  assert.equal(live.thinkingDraft?.text, 'replacement thinking');
  assert.equal(live.outputSegment?.active?.providerRequestId, 'request_replacement');
  assert.equal(live.cursor.seq, 7);
  await adapter.close();
});

test('streamed replacement converges with a fresh unbounded output segment snapshot', async () => {
  const fake = createFakeRuntime('rt_bounded_output_replacement');
  const sessionId = 's_bounded_output_replacement';
  const runId = 'run_bounded_output_replacement';
  const stableText = 's'.repeat(200_000);
  const abandonedText = 'a'.repeat(100_000);
  const stableSegment = {
    responseId: 'response_bounded_output',
    providerRequestId: 'request_stable',
    mode: 'append' as const,
    startedAtSeq: 1,
    assistantText: stableText,
    thinkingText: '',
  };
  const replacementSegment = {
    responseId: 'response_bounded_output',
    providerRequestId: 'request_final_replacement',
    mode: 'replace' as const,
    startedAtSeq: 10,
    assistantText: '',
    thinkingText: '',
  };
  fake.sessions.add(sessionId);
  const originalObserve = fake.runtime.sessions.observe.bind(fake.runtime.sessions);
  let initialObservationSnapshot: RuntimeSessionObservationSnapshot | undefined;
  fake.runtime.sessions.observe = async (...args) => {
    const observation = await originalObserve(...args);
    initialObservationSnapshot = {
      ...observation.snapshot,
      cursor: testRuntimeCursor(sessionId, 7),
      runs: [
        {
          runId,
          sessionId,
          turnId: 'turn_bounded_output',
          phase: 'running' as const,
          provider: 'mock',
          startedAt: '2026-08-17T00:00:00.000Z',
        },
      ],
      live: {
        ...observation.snapshot.live,
        assistantTextByRun: { [runId]: stableText + abandonedText },
        outputSegmentsByRun: {
          [runId]: {
            retained: [stableSegment],
            active: {
              responseId: 'response_bounded_output',
              providerRequestId: 'request_abandoned',
              mode: 'append' as const,
              startedAtSeq: 6,
              assistantText: abandonedText,
              thinkingText: '',
            },
          },
        },
      },
    };
    return {
      ...observation,
      snapshot: initialObservationSnapshot,
    };
  };
  const adapter = new RuntimeHostAdapter({
    mode: 'runtime',
    profileRoot: path.resolve('C:\\isolated-profile'),
    runtimeFactory: async () => fake.runtime,
    identityStore: testIdentityStore,
    runtimeEventParser: testRuntimeEventParser,
  });

  await adapter.initialize();
  await adapter.ensureObserved(sessionId);
  fake.emit({
    id: 'event_first_replacement_segment_8',
    seq: 8,
    time: '2026-08-17T00:00:01.000Z',
    type: 'output.segment.started',
    sessionId,
    runId,
    turnId: 'turn_bounded_output',
    payload: {
      responseId: replacementSegment.responseId,
      providerRequestId: 'request_first_replacement',
      mode: replacementSegment.mode,
    },
  });
  fake.emit({
    id: 'event_first_replacement_delta_9',
    seq: 9,
    time: '2026-08-17T00:00:02.000Z',
    type: 'assistant.delta',
    sessionId,
    runId,
    turnId: 'turn_bounded_output',
    payload: {
      providerRequestId: 'request_first_replacement',
      text: 'r'.repeat(100_000),
    },
  });
  fake.emit({
    id: 'event_final_replacement_segment_10',
    seq: 10,
    time: '2026-08-17T00:00:03.000Z',
    type: 'output.segment.started',
    sessionId,
    runId,
    turnId: 'turn_bounded_output',
    payload: {
      responseId: replacementSegment.responseId,
      providerRequestId: replacementSegment.providerRequestId,
      mode: replacementSegment.mode,
    },
  });
  const observationState = (
    adapter as unknown as {
      observations: Map<string, { eventQueue: Promise<void> }>;
    }
  ).observations.get(sessionId);
  assert.ok(observationState);
  await observationState.eventQueue;

  const streamed = await adapter.readSessionLiveSnapshot(sessionId);
  assert.ok(initialObservationSnapshot);
  const fresh = projectRuntimeSessionSnapshot({
    ...initialObservationSnapshot,
    cursor: testRuntimeCursor(sessionId, 10),
    runs: [
      {
        runId,
        sessionId,
        turnId: 'turn_bounded_output',
        phase: 'running' as const,
        provider: 'mock',
        startedAt: '2026-08-17T00:00:00.000Z',
      },
    ],
    live: {
      assistantTextByRun: { [runId]: stableText },
      thinkingTextByRun: {},
      outputSegmentsByRun: {
        [runId]: { retained: [stableSegment], active: replacementSegment },
      },
      activeTools: [],
      pendingUserInputs: [],
      managedTasks: [],
    },
  });
  assert.equal(streamed.assistantDraft?.text, stableText);
  assert.deepEqual(streamed.outputSegment, fresh.outputSegment);
  await adapter.close();
});

test('a stale missing Session result cannot cancel the replacement Runtime restore', async () => {
  const first = createFakeRuntime('rt_stale_missing_first');
  const retired = createFakeRuntime('rt_stale_missing_retired');
  const replacement = createFakeRuntime('rt_stale_missing_replacement');
  const sessionId = 's_stale_missing_restore';
  first.sessions.add(sessionId);
  replacement.sessions.add(sessionId);

  const retiredObserve = retired.runtime.sessions.observe.bind(retired.runtime.sessions);
  let signalRetiredStarted!: () => void;
  const retiredStarted = new Promise<void>((resolve) => {
    signalRetiredStarted = resolve;
  });
  let releaseRetired!: () => void;
  const retiredRelease = new Promise<void>((resolve) => {
    releaseRetired = resolve;
  });
  retired.runtime.sessions.observe = async (...args) => {
    if (args[0] === sessionId) {
      signalRetiredStarted();
      await retiredRelease;
    }
    return retiredObserve(...args);
  };

  const replacementObserve = replacement.runtime.sessions.observe.bind(
    replacement.runtime.sessions,
  );
  let signalReplacementStarted!: () => void;
  const replacementStarted = new Promise<void>((resolve) => {
    signalReplacementStarted = resolve;
  });
  let releaseReplacement!: () => void;
  const replacementRelease = new Promise<void>((resolve) => {
    releaseReplacement = resolve;
  });
  replacement.runtime.sessions.observe = async (...args) => {
    const observation = await replacementObserve(...args);
    if (args[0] !== sessionId) return observation;
    signalReplacementStarted();
    await replacementRelease;
    return {
      ...observation,
      snapshot: {
        ...observation.snapshot,
        runs: [
          {
            runId: 'run_stale_missing_replacement',
            sessionId,
            phase: 'running' as const,
            provider: 'mock',
            mode: 'managed_task' as const,
            startedAt: '2026-08-05T12:00:00.000Z',
          },
        ],
      },
    };
  };

  let factoryCalls = 0;
  const adapter = new RuntimeHostAdapter({
    mode: 'runtime',
    profileRoot: path.resolve('C:\\isolated-profile'),
    runtimeFactory: async () => {
      factoryCalls += 1;
      if (factoryCalls === 1) return first.runtime;
      if (factoryCalls === 2) return retired.runtime;
      return replacement.runtime;
    },
    identityStore: testIdentityStore,
    runtimeEventParser: testRuntimeEventParser,
  });

  await adapter.initialize();
  await adapter.ensureObserved(sessionId);
  first.disconnect();
  await waitForTest(() => adapter.snapshot().state === 'uninitialized');
  await adapter.initialize();
  await retiredStarted;

  retired.disconnect();
  await waitForTest(() => adapter.snapshot().state === 'uninitialized');
  await adapter.initialize();
  await replacementStarted;
  releaseRetired();
  await new Promise<void>((resolve) => setImmediate(resolve));
  releaseReplacement();

  const observations = (
    adapter as unknown as {
      observations: Map<string, unknown>;
    }
  ).observations;
  await waitForTest(() => observations.has(sessionId));
  await adapter.close();
});

test('a retired Runtime cannot install credential bindings after observation attach', async () => {
  const first = createFakeRuntime('rt_retired_binding_first');
  const second = createFakeRuntime('rt_retired_binding_second');
  const sessionId = 's_retired_binding';
  first.sessions.add(sessionId);
  second.sessions.add(sessionId);

  const originalObserve = first.runtime.sessions.observe.bind(first.runtime.sessions);
  first.runtime.sessions.observe = async (...args) => {
    const observation = await originalObserve(...args);
    return {
      ...observation,
      snapshot: {
        ...observation.snapshot,
        runs: [
          {
            runId: 'run_retired_binding',
            sessionId,
            phase: 'running' as const,
            provider: 'mock',
            mode: 'managed_task' as const,
            startedAt: '2026-08-05T12:00:00.000Z',
            requirements: {
              credential: {
                leaseId: 'credential_retired_binding',
                provider: 'mock',
                state: 'ready' as const,
              },
            },
          },
        ],
      },
    };
  };
  const originalResume = first.runtime.credentials.resume.bind(first.runtime.credentials);
  let signalResumeStarted!: () => void;
  const resumeStarted = new Promise<void>((resolve) => {
    signalResumeStarted = resolve;
  });
  let releaseResume!: () => void;
  const resumeRelease = new Promise<void>((resolve) => {
    releaseResume = resolve;
  });
  first.runtime.credentials.resume = async (...args) => {
    signalResumeStarted();
    await resumeRelease;
    return originalResume(...args);
  };

  let factoryCalls = 0;
  const adapter = new RuntimeHostAdapter({
    mode: 'runtime',
    profileRoot: path.resolve('C:\\isolated-profile'),
    runtimeFactory: async () => (factoryCalls++ === 0 ? first.runtime : second.runtime),
    identityStore: testIdentityStore,
    runtimeEventParser: testRuntimeEventParser,
  });

  await adapter.initialize();
  const opening = adapter.readSessionLiveSnapshot(sessionId);
  assert.equal((await opening).activeRun?.runId, 'run_retired_binding');
  await resumeStarted;
  first.disconnect();
  await waitForTest(() => adapter.snapshot().state === 'uninitialized');
  await adapter.initialize();
  releaseResume();

  await new Promise<void>((resolve) => setImmediate(resolve));
  const credentialLeases = (
    adapter as unknown as {
      credentialLeases: Map<string, unknown>;
    }
  ).credentialLeases;
  assert.equal(credentialLeases.has('credential_retired_binding'), false);
  await adapter.close();
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
  const readyRevisions: number[] = [];
  adapter.subscribeRuntimeReady((revision) => {
    readyRevisions.push(revision);
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
  await waitForTest(() => readyRevisions.length === 1);
  assert.deepEqual(readyRevisions, [1]);
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

test('Space leaves daemon capability replacement to the SDK and fails closed on rejection', async () => {
  let factoryCalls = 0;
  let safeStopCalls = 0;
  const upgradeError = Object.assign(new Error('runtimeEventCoalescing requires a newer daemon'), {
    code: 'daemon_capability_upgrade_required',
  });
  const adapter = new RuntimeHostAdapter({
    mode: 'runtime',
    profileRoot: path.resolve('C:\\isolated-profile'),
    runtimeFactory: async (input) => {
      factoryCalls += 1;
      assert.equal(input.requirements?.runtimeEventCoalescing, 1);
      assert.equal(input.requirements?.liveOutputSegments, 1);
      throw upgradeError;
    },
    identityStore: testIdentityStore,
    runtimeEventParser: testRuntimeEventParser,
    idleDaemonStop: async () => {
      safeStopCalls += 1;
      return { stopped: true };
    },
  });
  (adapter as unknown as { reconnectAttempt: number }).reconnectAttempt = -10;

  await assert.rejects(adapter.initialize(), /runtimeEventCoalescing/);
  await new Promise<void>((resolve) => setTimeout(resolve, 50));

  assert.equal(safeStopCalls, 0);
  assert.equal(factoryCalls, 1);
  assert.equal(adapter.hasReadyRuntime(), false);
  assert.match(adapter.snapshot().error ?? '', /safe automatic restart status is unavailable/i);
  assert.doesNotMatch(adapter.snapshot().error ?? '', /reconnect automatically/i);
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

test('complete exit atomically stops the inspected daemon and leaves an unowned daemon policy', async () => {
  const fake = createFakeRuntime();
  const inspectDaemon = fake.runtime.daemon.inspect.bind(fake.runtime.daemon);
  fake.runtime.daemon.inspect = async () => {
    const management = await inspectDaemon();
    return {
      ...management,
      owner: {
        ...management.owner,
        processContainment: 'windows-job',
        supervisorPid: 456,
      },
    };
  };
  let inlineOwnerCloses = 0;
  let daemonRestores = 0;
  let ownerReleased = false;
  const shutdownVerifications: Array<{
    readonly configHome: string;
    readonly profile: string;
    readonly owner: RuntimeDaemonManagementState['owner'];
    readonly timeoutMs: number;
  }> = [];
  const transitionOrder: string[] = [];
  const adapter = new RuntimeHostAdapter({
    mode: 'runtime',
    profileRoot: path.resolve('C:\\isolated-profile'),
    runtimeHomeDir: path.resolve('C:\\runtime-base'),
    runtimeFactory: async () => fake.runtime,
    identityStore: testIdentityStore,
    runtimeEventParser: testRuntimeEventParser,
    runtimeExitSettler: null,
    idleDaemonStop: async () => {
      throw new Error('ready Runtime complete-exit must not use the racy CLI stop path');
    },
    daemonShutdownVerifier: async (input) => {
      shutdownVerifications.push(input);
      transitionOrder.push('daemon-shutdown-verified');
      return { status: 'succeeded' };
    },
    ownerControl: {
      acquireInline: async () => ({
        profile: 'coder',
        ownerId: 'inline_complete_exit',
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
          mode: ownerReleased ? 'daemon' : 'inline',
          revision: ownerReleased ? 4 : 3,
          updatedAt: '2026-07-12T00:00:02.000Z',
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
        transitionOrder.push('daemon-policy-restored');
        ownerReleased = true;
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
  await adapter.stopDaemonForCompleteExit('space-complete-exit-1');

  assert.deepEqual(fake.calls.daemonStops, [
    {
      expectedRuntimeId: 'rt_test',
      expectedRevision: 7,
      expectedOwnerPolicyRevision: 2,
      operation: { operationId: 'space-complete-exit-1' },
    },
  ]);
  assert.equal(fake.calls.close, 1);
  assert.equal(daemonRestores, 1);
  assert.equal(inlineOwnerCloses, 1);
  assert.deepEqual(shutdownVerifications, [
    {
      configHome: path.join(path.resolve('C:\\runtime-base'), '.kodax'),
      profile: 'coder',
      owner: {
        runtimeId: 'rt_test',
        pid: 123,
        createdAt: '2026-07-12T00:00:00.000Z',
        kind: 'daemon',
        processContainment: 'windows-job',
        supervisorPid: 456,
      },
      timeoutMs: 15_000,
    },
  ]);
  assert.deepEqual(transitionOrder, ['daemon-shutdown-verified', 'daemon-policy-restored']);
  assert.equal(adapter.snapshot().state, 'closed');
});

test('production complete exit delegates the exact lifecycle settlement to the SDK', async () => {
  const fake = createFakeRuntime();
  const calls: import('../kodax/runtime-host-adapter.js').RuntimeExitSettlementInput[] = [];
  const adapter = new RuntimeHostAdapter({
    mode: 'runtime',
    profileRoot: path.resolve('C:\\isolated-profile'),
    runtimeHomeDir: path.resolve('C:\\runtime-base'),
    runtimeFactory: async () => fake.runtime,
    identityStore: testIdentityStore,
    runtimeEventParser: testRuntimeEventParser,
    runtimeExitSettler: async (input) => {
      calls.push(input);
      await input.runtime?.close();
      return {
        status: 'recovered',
        repairs: ['windows_process_tree', 'windows_sandbox_acl'],
      };
    },
  });

  await adapter.initialize();
  await adapter.stopDaemonForCompleteExit('space-sdk-settlement-1');

  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.configHome, path.join(path.resolve('C:\\runtime-base'), '.kodax'));
  assert.equal(calls[0]?.profile, 'coder');
  assert.equal(calls[0]?.runtime, fake.runtime);
  assert.equal(fake.calls.daemonStops.length, 0);
  assert.equal(fake.calls.close, 1);
  assert.equal(adapter.snapshot().state, 'closed');
});

test('a settled exit does not re-await the SDK transport close singleflight', async () => {
  const fake = createFakeRuntime();
  const hungRuntime = {
    ...fake.runtime,
    async close() {
      fake.calls.close += 1;
      return new Promise<void>(() => undefined);
    },
  } as KodaXDaemonRuntime;
  const adapter = new RuntimeHostAdapter({
    mode: 'runtime',
    profileRoot: path.resolve('C:\\isolated-profile'),
    runtimeFactory: async () => hungRuntime,
    identityStore: testIdentityStore,
    runtimeEventParser: testRuntimeEventParser,
    runtimeExitSettler: async (input) => {
      void input.runtime?.close();
      return { status: 'clean', repairs: [] };
    },
  });

  await adapter.initialize();
  const completed = await Promise.race([
    adapter.stopDaemonForCompleteExit().then(() => true),
    new Promise<false>((resolve) => setTimeout(() => resolve(false), 100)),
  ]);

  assert.equal(completed, true);
  assert.equal(fake.calls.close, 1);
  assert.equal(adapter.snapshot().state, 'closed');
});

test('exit settlement fences reconnect after a committed stop loses transport', async () => {
  const fake = createFakeRuntime();
  let factoryCalls = 0;
  const adapter = new RuntimeHostAdapter({
    mode: 'runtime',
    profileRoot: path.resolve('C:\\isolated-profile'),
    runtimeFactory: async () => {
      factoryCalls += 1;
      return fake.runtime;
    },
    identityStore: testIdentityStore,
    runtimeEventParser: testRuntimeEventParser,
    runtimeExitSettler: async () => {
      fake.disconnect(true);
      await new Promise<void>((resolve) => setTimeout(resolve, 1_100));
      return { status: 'clean', repairs: [] };
    },
  });

  await adapter.initialize();
  await adapter.stopDaemonForCompleteExit();

  assert.equal(factoryCalls, 1);
  assert.equal(adapter.snapshot().state, 'closed');
});

test('an SDK settlement rejection after possible mutation requires recovery relaunch', async () => {
  const fake = createFakeRuntime();
  const adapter = new RuntimeHostAdapter({
    mode: 'runtime',
    profileRoot: path.resolve('C:\\isolated-profile'),
    runtimeFactory: async () => fake.runtime,
    identityStore: testIdentityStore,
    runtimeEventParser: testRuntimeEventParser,
    runtimeExitSettler: async () => {
      throw new Error('stop accepted but ticket phase write failed');
    },
  });

  await adapter.initialize();
  await assert.rejects(adapter.stopDaemonForCompleteExit(), (error: unknown) =>
    isCoderOwnerRecoveryRestartRequired(error),
  );

  assert.equal(adapter.snapshot().state, 'ready');
});

test('SDK exit settlement keeps an unmutated active Runtime open when preflight blocks', async () => {
  const fake = createFakeRuntime();
  const adapter = new RuntimeHostAdapter({
    mode: 'runtime',
    profileRoot: path.resolve('C:\\isolated-profile'),
    runtimeFactory: async () => fake.runtime,
    identityStore: testIdentityStore,
    runtimeEventParser: testRuntimeEventParser,
    runtimeExitSettler: async () => ({
      status: 'blocked',
      reason: 'active_work',
      nextAction: 'keep-open',
      message: 'active run remains',
    }),
  });

  await adapter.initialize();
  await assert.rejects(adapter.stopDaemonForCompleteExit(), /active run remains/i);

  assert.equal(fake.calls.close, 0);
  assert.equal(adapter.snapshot().state, 'ready');
});

test('SDK owns prepared-ticket management reconnect when initialization failed', async () => {
  const connectAutoStart: Array<boolean | undefined> = [];
  const settlementCalls: import('../kodax/runtime-host-adapter.js').RuntimeExitSettlementInput[] =
    [];
  const adapter = new RuntimeHostAdapter({
    mode: 'runtime',
    profileRoot: path.resolve('C:\\isolated-profile'),
    identityStore: testIdentityStore,
    runtimeEventParser: testRuntimeEventParser,
    runtimeFactory: async (options) => {
      connectAutoStart.push(options.autoStart);
      throw new Error('session projection startup failed');
    },
    runtimeExitSettler: async (input) => {
      settlementCalls.push(input);
      return { status: 'clean', repairs: [] };
    },
  });

  await assert.rejects(adapter.initialize(), /session projection startup failed/i);
  assert.equal(adapter.snapshot().state, 'failed');
  await adapter.stopDaemonForCompleteExit();

  assert.deepEqual(connectAutoStart, [true]);
  assert.equal(settlementCalls.length, 1);
  assert.equal(settlementCalls[0]?.runtime, undefined);
  assert.equal(adapter.snapshot().state, 'closed');
});

test('startup recovery leaves exact prepared-ticket management reconnect to the SDK', async () => {
  let factoryCalls = 0;
  const settlementCalls: import('../kodax/runtime-host-adapter.js').RuntimeExitSettlementInput[] =
    [];
  const adapter = new RuntimeHostAdapter({
    mode: 'runtime',
    profileRoot: path.resolve('C:\\isolated-profile'),
    identityStore: testIdentityStore,
    runtimeEventParser: testRuntimeEventParser,
    runtimeFactory: async () => {
      factoryCalls += 1;
      throw new Error('Space must not attach its stable identity for SDK exit recovery.');
    },
    runtimeExitSettler: async (input) => {
      settlementCalls.push(input);
      return {
        status: 'blocked',
        reason: 'stop_not_accepted',
        nextAction: 'relaunch-space',
        message: 'prepared stop acceptance is ambiguous',
      };
    },
  });

  const settlement = await adapter.resumePendingRuntimeExitSettlement();

  assert.deepEqual(settlement, {
    status: 'blocked',
    reason: 'stop_not_accepted',
    nextAction: 'relaunch-space',
    message: 'prepared stop acceptance is ambiguous',
  });
  assert.equal(factoryCalls, 0);
  assert.equal(settlementCalls.length, 1);
  assert.equal(settlementCalls[0]?.runtime, undefined);
});

test('startup recovery returns the SDK-owned recovered settlement without a Space close', async () => {
  const adapter = new RuntimeHostAdapter({
    mode: 'runtime',
    profileRoot: path.resolve('C:\\isolated-profile'),
    identityStore: testIdentityStore,
    runtimeEventParser: testRuntimeEventParser,
    runtimeFactory: async () => Promise.reject(new Error('unexpected Space Runtime attach')),
    runtimeExitSettler: async () => ({ status: 'recovered', repairs: [] }),
  });

  const result = await Promise.race([
    adapter.resumePendingRuntimeExitSettlement(),
    new Promise<'timed-out'>((resolve) => setTimeout(() => resolve('timed-out'), 1_000)),
  ]);

  assert.deepEqual(result, { status: 'recovered', repairs: [] });
});

test('startup recovery preserves an SDK-owned nonterminal cleanup result', async () => {
  const adapter = new RuntimeHostAdapter({
    mode: 'runtime',
    profileRoot: path.resolve('C:\\isolated-profile'),
    identityStore: testIdentityStore,
    runtimeEventParser: testRuntimeEventParser,
    runtimeFactory: async () => Promise.reject(new Error('unexpected Space Runtime attach')),
    runtimeExitSettler: async () => ({
      status: 'blocked',
      reason: 'cleanup_unverified',
      nextAction: 'relaunch-space',
      message: 'SDK could not close its temporary management client.',
    }),
  });

  const result = await adapter.resumePendingRuntimeExitSettlement();

  assert.deepEqual(result, {
    status: 'blocked',
    reason: 'cleanup_unverified',
    nextAction: 'relaunch-space',
    message: 'SDK could not close its temporary management client.',
  });
});

test('startup recovery does not rescan an SDK-owned prepared ticket', async () => {
  let settlementCalls = 0;
  let factoryCalls = 0;
  const adapter = new RuntimeHostAdapter({
    mode: 'runtime',
    profileRoot: path.resolve('C:\\isolated-profile'),
    identityStore: testIdentityStore,
    runtimeEventParser: testRuntimeEventParser,
    runtimeFactory: async () => {
      factoryCalls += 1;
      throw new Error('Space must not attach during SDK ticket recovery');
    },
    runtimeExitSettler: async () => {
      settlementCalls += 1;
      return {
        status: 'blocked',
        reason: 'stop_not_accepted',
        nextAction: 'relaunch-space',
        message: 'management reconnect remains SDK-owned',
      };
    },
  });

  const settlement = await adapter.resumePendingRuntimeExitSettlement();

  assert.deepEqual(settlement, {
    status: 'blocked',
    reason: 'stop_not_accepted',
    nextAction: 'relaunch-space',
    message: 'management reconnect remains SDK-owned',
  });
  assert.equal(settlementCalls, 1);
  assert.equal(factoryCalls, 0);
});

test('post-mutation SDK settlement blockage preserves the live projection and requires restart', async () => {
  const fake = createFakeRuntime();
  const adapter = new RuntimeHostAdapter({
    mode: 'runtime',
    profileRoot: path.resolve('C:\\isolated-profile'),
    runtimeFactory: async () => fake.runtime,
    identityStore: testIdentityStore,
    runtimeEventParser: testRuntimeEventParser,
    runtimeExitSettler: async () => ({
      status: 'blocked',
      reason: 'cleanup_failed',
      nextAction: 'restart-system',
      message: 'durable cleanup failed after stop acceptance',
    }),
  });

  await adapter.initialize();
  await assert.rejects(adapter.stopDaemonForCompleteExit(), (error: unknown) =>
    isCoderOwnerRecoveryRestartRequired(error),
  );

  assert.equal(fake.calls.close, 0);
  assert.equal(adapter.snapshot().state, 'ready');
});

test('complete exit fails closed and requires recovery when durable daemon cleanup fails', async () => {
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
    runtimeExitSettler: null,
    daemonShutdownVerifier: async (input) => {
      assert.equal(input.configHome, path.resolve('C:\\isolated-profile'));
      assert.equal(input.profile, 'coder');
      assert.equal(input.owner.pid, 123);
      assert.equal(input.timeoutMs, 15_000);
      return {
        status: 'failed',
        outcome: { error: 'managed child cleanup failed' },
      };
    },
    ownerControl: {
      acquireInline: async () => ({
        profile: 'coder',
        ownerId: 'inline_complete_exit_pid_timeout',
        ownerPolicy: {
          mode: 'inline',
          revision: 3,
          updatedAt: '2026-08-03T00:00:01.000Z',
        },
        close: () => {
          inlineOwnerCloses += 1;
        },
      }),
      getState: async () => ({
        profile: 'coder',
        policy: {
          mode: ownerReleased ? 'daemon' : 'inline',
          revision: ownerReleased ? 4 : 3,
          updatedAt: '2026-08-03T00:00:02.000Z',
        },
        ownerStatus: ownerReleased ? 'unowned' : 'owned',
        owner: ownerReleased
          ? null
          : {
              runtimeId: 'rt_test',
              pid: 123,
              createdAt: '2026-08-03T00:00:00.000Z',
              kind: 'daemon',
            },
      }),
      enableDaemon: async () => {
        daemonRestores += 1;
        ownerReleased = true;
        return {
          mode: 'daemon',
          revision: 4,
          updatedAt: '2026-08-03T00:00:02.000Z',
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
  await assert.rejects(
    adapter.stopDaemonForCompleteExit('space-complete-exit-cleanup-failed'),
    (error: unknown) => {
      assert.equal(isCoderOwnerRecoveryRestartRequired(error), true);
      assert.match(
        error instanceof Error ? error.message : String(error),
        /shutdown was not authoritatively verified.*restart required/i,
      );
      return true;
    },
  );

  assert.equal(fake.calls.close, 1);
  assert.equal(daemonRestores, 1);
  assert.equal(inlineOwnerCloses, 1);
  assert.equal(adapter.snapshot().state, 'closed');
});

test('complete exit reacquires a fence after transient replacement-fence contention', async () => {
  const fake = createFakeRuntime();
  let ownerReleased = false;
  let daemonPolicyRestored = false;
  let inlineAcquisitions = 0;
  let inlineOwnerCloses = 0;
  let daemonRestores = 0;
  let ownerStateReads = 0;
  const adapter = new RuntimeHostAdapter({
    mode: 'runtime',
    profileRoot: path.resolve('C:\\isolated-profile'),
    runtimeFactory: async () => fake.runtime,
    identityStore: testIdentityStore,
    runtimeEventParser: testRuntimeEventParser,
    runtimeExitSettler: null,
    idleDaemonStop: async () => {
      throw new Error('ready Runtime complete-exit must not use the racy CLI stop path');
    },
    daemonProcessExitWaiter: async () => true,
    ownerControl: {
      acquireInline: async () => {
        inlineAcquisitions += 1;
        if (inlineAcquisitions === 1) {
          throw new Error('Runtime owner transition is already in progress.');
        }
        return {
          profile: 'coder',
          ownerId: 'inline_complete_exit_retry',
          ownerPolicy: {
            mode: 'inline',
            revision: 5,
            updatedAt: '2026-08-03T00:00:03.000Z',
          },
          close: () => {
            inlineOwnerCloses += 1;
          },
        };
      },
      getState: async () => {
        ownerStateReads += 1;
        return {
          profile: 'coder',
          policy: {
            mode: daemonPolicyRestored ? 'daemon' : 'inline',
            revision: daemonPolicyRestored ? 4 : 3,
            updatedAt: '2026-08-03T00:00:02.000Z',
          },
          ownerStatus: ownerReleased ? ('unowned' as const) : ('owned' as const),
          owner: ownerReleased
            ? null
            : {
                runtimeId: 'rt_test',
                pid: 123,
                createdAt: '2026-08-03T00:00:00.000Z',
                kind: 'daemon' as const,
              },
        };
      },
      enableDaemon: async () => {
        daemonRestores += 1;
        daemonPolicyRestored = true;
        return {
          mode: 'daemon',
          revision: 4,
          updatedAt: '2026-08-03T00:00:02.000Z',
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
  await assert.doesNotReject(
    adapter.stopDaemonForCompleteExit('space-complete-exit-fence-contention'),
  );

  assert.equal(inlineAcquisitions, 2);
  assert.equal(daemonRestores, 2);
  assert.equal(inlineOwnerCloses, 1);
  assert.equal(
    ownerStateReads,
    3,
    'the compensated path must verify state before reacquiring its fence and after restore',
  );
  assert.equal(adapter.snapshot().state, 'closed');
  assert.deepEqual(fake.calls.daemonStops, [
    {
      expectedRuntimeId: 'rt_test',
      expectedRevision: 7,
      expectedOwnerPolicyRevision: 2,
      operation: { operationId: 'space-complete-exit-fence-contention' },
    },
  ]);
});

test('complete exit fails closed when replacement-fence contention persists', async () => {
  const fake = createFakeRuntime();
  let ownerReleased = false;
  let daemonPolicyRestored = false;
  let inlineAcquisitions = 0;
  let daemonRestores = 0;
  let daemonExitWaited = false;
  const adapter = new RuntimeHostAdapter({
    mode: 'runtime',
    profileRoot: path.resolve('C:\\isolated-profile'),
    runtimeFactory: async () => fake.runtime,
    identityStore: testIdentityStore,
    runtimeEventParser: testRuntimeEventParser,
    runtimeExitSettler: null,
    daemonProcessExitWaiter: async () => {
      daemonExitWaited = true;
      return true;
    },
    ownerControl: {
      acquireInline: async () => {
        inlineAcquisitions += 1;
        throw new Error('Runtime owner transition is already in progress.');
      },
      getState: async () => ({
        profile: 'coder',
        policy: {
          mode: daemonPolicyRestored ? 'daemon' : 'inline',
          revision: daemonPolicyRestored ? 4 : 3,
          updatedAt: '2026-08-03T00:00:02.000Z',
        },
        ownerStatus: ownerReleased ? 'unowned' : 'owned',
        owner: ownerReleased
          ? null
          : {
              runtimeId: 'rt_test',
              pid: 123,
              createdAt: '2026-08-03T00:00:00.000Z',
              kind: 'daemon',
            },
      }),
      enableDaemon: async () => {
        daemonRestores += 1;
        daemonPolicyRestored = true;
        return {
          mode: 'daemon',
          revision: 4,
          updatedAt: '2026-08-03T00:00:02.000Z',
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
  await assert.rejects(
    adapter.stopDaemonForCompleteExit('space-complete-exit-persistent-fence-contention'),
    (error: unknown) => {
      assert.equal(isCoderOwnerRecoveryRestartRequired(error), true);
      assert.match(
        error instanceof Error ? error.message : String(error),
        /recovered owner state could not be verified/i,
      );
      return true;
    },
  );

  assert.equal(inlineAcquisitions, 2);
  assert.equal(daemonRestores, 2);
  assert.equal(daemonExitWaited, false);
  assert.equal(adapter.snapshot().state, 'closed');
});

test('complete exit preserves restart-required recovery when compensated fence retry cannot restore authority', async () => {
  const fake = createFakeRuntime();
  let ownerReleased = false;
  let daemonPolicyRestored = false;
  let inlineAcquisitions = 0;
  let daemonEnableAttempts = 0;
  let daemonExitWaited = false;
  const adapter = new RuntimeHostAdapter({
    mode: 'runtime',
    profileRoot: path.resolve('C:\\isolated-profile'),
    runtimeFactory: async () => fake.runtime,
    identityStore: testIdentityStore,
    runtimeEventParser: testRuntimeEventParser,
    runtimeExitSettler: null,
    daemonProcessExitWaiter: async () => {
      daemonExitWaited = true;
      return true;
    },
    ownerControl: {
      acquireInline: async () => {
        inlineAcquisitions += 1;
        throw new Error('inline owner fence unavailable');
      },
      getState: async () => ({
        profile: 'coder',
        policy: {
          mode: daemonPolicyRestored ? 'daemon' : 'inline',
          revision: daemonPolicyRestored ? 4 : 3,
          updatedAt: '2026-08-03T00:00:02.000Z',
        },
        ownerStatus: ownerReleased ? 'unowned' : 'owned',
        owner: ownerReleased
          ? null
          : {
              runtimeId: 'rt_test',
              pid: 123,
              createdAt: '2026-08-03T00:00:00.000Z',
              kind: 'daemon',
            },
      }),
      enableDaemon: async () => {
        daemonEnableAttempts += 1;
        if (daemonEnableAttempts > 1) throw new Error('daemon policy restore failed');
        daemonPolicyRestored = true;
        return {
          mode: 'daemon',
          revision: 4,
          updatedAt: '2026-08-03T00:00:02.000Z',
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
  await assert.rejects(
    adapter.stopDaemonForCompleteExit('space-complete-exit-retry-recovery'),
    (error: unknown) => {
      assert.equal(isCoderOwnerRecoveryRestartRequired(error), true);
      assert.match(
        error instanceof Error ? error.message : String(error),
        /recovered owner state could not be verified/i,
      );
      return true;
    },
  );

  assert.equal(inlineAcquisitions, 3);
  assert.equal(daemonEnableAttempts, 2);
  assert.equal(daemonExitWaited, false);
  assert.equal(adapter.snapshot().state, 'failed');
});

test('forced exit preserves other-client Runtime work in the same Session', async () => {
  const fake = createFakeRuntime();
  const interrupted: Array<{ sessionId: string; actorPath: string; reason?: string }> = [];
  fake.runtime.status.preflight = async () =>
    ({
      runtimeId: 'rt_test',
      clientCount: 2,
      activeRuns: [
        {
          runId: 'run_owned',
          sessionId: 's_shared',
          phase: 'running',
          origin: { principalId: 'space_instance_stable' },
        },
        {
          runId: 'run_other',
          sessionId: 's_shared',
          phase: 'running',
          origin: { principalId: 'cli_instance' },
        },
      ],
      queuedRuns: [
        {
          runId: 'run_owned_queued',
          sessionId: 's_shared',
          phase: 'queued',
          origin: { principalId: 'space_instance_stable' },
        },
      ],
      activeWorkflows: [
        { runId: 'workflow_owned', workflow: 'review', status: 'running' },
        { runId: 'workflow_other', workflow: 'review', status: 'running' },
      ],
      activeAgentTurns: [
        {
          sessionId: 's_shared',
          actorPath: '/root/reviewer',
          turnId: 'turn_owned',
          kind: 'native',
        },
        {
          sessionId: 's_shared',
          actorPath: '/root/cli-reviewer',
          turnId: 'turn_other',
          kind: 'native',
        },
      ],
      activeAgentTasks: [],
      pendingPermissions: [],
      pendingUserInputs: [],
      blockers: ['connected_clients', 'active_runs', 'active_workflows', 'active_agent_turns'],
      canStop: false,
    }) as never;
  fake.runtime.workflows.get = async (runId: string) =>
    ({
      runId,
      workflowName: 'review',
      status: 'running',
      startedAt: '2026-07-12T00:00:00.000Z',
      updatedAt: '2026-07-12T00:00:01.000Z',
      sourceRunId: runId === 'workflow_owned' ? 'run_owned' : 'run_other',
      hostMetadata: {
        sessionId: 's_shared',
        surface: 'code',
      },
      items: [],
      counts: {
        pending: 0,
        running: 0,
        completed: 0,
        failed: 0,
        cancelled: 0,
        skipped: 0,
      },
      progress: {
        spawnedAgents: 0,
        finishedAgents: 0,
        activeAgents: 0,
        failedAgents: 0,
        stoppedAgents: 0,
      },
    }) as never;
  Object.assign(fake.runtime.agents as unknown as Record<string, unknown>, {
    interrupt: async (sessionId: string, actorPath: string, reason?: string) => {
      interrupted.push({ sessionId, actorPath, ...(reason ? { reason } : {}) });
    },
  });
  const adapter = new RuntimeHostAdapter({
    mode: 'runtime',
    profileRoot: path.resolve('C:\\isolated-profile'),
    runtimeFactory: async () => fake.runtime,
    identityStore: testIdentityStore,
  });

  await adapter.initialize();
  (
    adapter as unknown as {
      spaceOwnedAgentTurns: Set<string>;
    }
  ).spaceOwnedAgentTurns.add('s_shared\u0000/root/reviewer\u0000turn_owned');
  const result = await adapter.stopSpaceOwnedRuntimeWorkForForcedExit();

  assert.equal(result.attempted, 4);
  assert.equal(result.failed, 0);
  assert.deepEqual(fake.calls.aborted, ['run_owned', 'run_owned_queued']);
  assert.deepEqual(fake.calls.workflowControls, [{ action: 'stop', runId: 'workflow_owned' }]);
  assert.deepEqual(interrupted, [
    {
      sessionId: 's_shared',
      actorPath: '/root/reviewer',
      reason: 'KodaX Space force close',
    },
  ]);
  await adapter.close();
});

test('Space-started Runtime Agent turns are registered for forced-exit cancellation', async () => {
  const fake = createFakeRuntime();
  fake.sessions.add('s_1');
  const interrupted: string[] = [];
  fake.runtime.status.preflight = async () =>
    ({
      runtimeId: 'rt_test',
      clientCount: 2,
      activeRuns: [],
      queuedRuns: [],
      activeWorkflows: [],
      activeAgentTurns: [
        {
          sessionId: 's_1',
          actorPath: '/external/reviewer',
          turnId: 'turn_1',
          kind: 'external',
        },
      ],
      activeAgentTasks: [],
      pendingPermissions: [],
      pendingUserInputs: [],
      blockers: ['connected_clients', 'active_agent_turns'],
      canStop: false,
    }) as never;
  Object.assign(fake.runtime.agents as unknown as Record<string, unknown>, {
    preflight: async () =>
      ({
        ok: true,
        descriptor: {
          agentId: 'reviewer',
          configurationRevision: 'agent_rev_1',
          protocol: 'a2a',
        },
        reasons: [],
      }) as never,
    spawn: async () => ({ actorPath: '/external/reviewer', turnId: 'turn_1' }),
    detail: async () => ({
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
    }),
    interrupt: async (_sessionId: string, actorPath: string) => {
      interrupted.push(actorPath);
    },
  });
  const adapter = new RuntimeHostAdapter({
    mode: 'runtime',
    profileRoot: path.resolve('C:\\isolated-profile'),
    runtimeFactory: async () => fake.runtime,
    identityStore: testIdentityStore,
  });

  await adapter.initialize();
  await adapter.startRuntimeActorTask({
    sessionId: 's_1',
    agentId: 'reviewer',
    objective: 'Review the patch',
    readOnly: true,
  });
  const result = await adapter.stopSpaceOwnedRuntimeWorkForForcedExit();

  assert.deepEqual(result, { attempted: 1, failed: 0 });
  assert.deepEqual(interrupted, ['/external/reviewer']);
  await adapter.close();
});

test('complete exit verifies owner release when daemon transport closes before the rollback reply', async () => {
  const fake = createFakeRuntime();
  let inlineOwnerCloses = 0;
  let daemonRestores = 0;
  let ownerReleased = false;
  let daemonPolicyRestored = false;
  const adapter = new RuntimeHostAdapter({
    mode: 'runtime',
    profileRoot: path.resolve('C:\\isolated-profile'),
    runtimeFactory: async () => fake.runtime,
    identityStore: testIdentityStore,
    runtimeEventParser: testRuntimeEventParser,
    runtimeExitSettler: null,
    idleDaemonStop: async () => {
      throw new Error('ready Runtime complete-exit must not use the racy CLI stop path');
    },
    daemonProcessExitWaiter: async () => true,
    ownerControl: {
      acquireInline: async () => ({
        profile: 'coder',
        ownerId: 'inline_after_lost_reply',
        ownerPolicy: {
          mode: 'inline',
          revision: 3,
          updatedAt: '2026-07-31T00:00:01.000Z',
        },
        close: () => {
          inlineOwnerCloses += 1;
        },
      }),
      getState: async () => ({
        profile: 'coder',
        policy: {
          mode: daemonPolicyRestored ? 'daemon' : ownerReleased ? 'inline' : 'daemon',
          revision: daemonPolicyRestored ? 4 : ownerReleased ? 3 : 2,
          updatedAt: '2026-07-31T00:00:02.000Z',
        },
        ownerStatus: ownerReleased ? 'unowned' : 'owned',
        owner: ownerReleased
          ? null
          : {
              runtimeId: 'rt_test',
              pid: 123,
              createdAt: '2026-07-31T00:00:00.000Z',
              kind: 'daemon',
            },
      }),
      enableDaemon: async () => {
        daemonRestores += 1;
        daemonPolicyRestored = true;
        return {
          mode: 'daemon',
          revision: 4,
          updatedAt: '2026-07-31T00:00:02.000Z',
        };
      },
    },
  });
  fake.runtime.daemon.stopForInline = async (input) => {
    fake.calls.daemonStops.push(input);
    ownerReleased = true;
    throw new Error('Runtime daemon transport closed.');
  };

  await adapter.initialize();
  await adapter.stopDaemonForCompleteExit('space-complete-exit-lost-reply');

  assert.deepEqual(fake.calls.daemonStops, [
    {
      expectedRuntimeId: 'rt_test',
      expectedRevision: 7,
      expectedOwnerPolicyRevision: 2,
      operation: { operationId: 'space-complete-exit-lost-reply' },
    },
  ]);
  assert.equal(fake.calls.close, 1);
  assert.equal(daemonRestores, 1);
  assert.equal(inlineOwnerCloses, 1);
  assert.equal(adapter.snapshot().state, 'closed');
});

test('complete exit stays fail-closed when a lost rollback reply cannot prove owner release', async () => {
  const fake = createFakeRuntime();
  let inlineAcquisitions = 0;
  let daemonRestores = 0;
  const adapter = new RuntimeHostAdapter({
    mode: 'runtime',
    profileRoot: path.resolve('C:\\isolated-profile'),
    runtimeFactory: async () => fake.runtime,
    identityStore: testIdentityStore,
    runtimeEventParser: testRuntimeEventParser,
    runtimeExitSettler: null,
    ownerControl: {
      acquireInline: async () => {
        inlineAcquisitions += 1;
        throw new Error('a different owner must not be replaced');
      },
      getState: async () => ({
        profile: 'coder',
        policy: {
          mode: 'inline',
          revision: 3,
          updatedAt: '2026-07-31T00:00:01.000Z',
        },
        ownerStatus: 'owned',
        owner: {
          runtimeId: 'rt_different_owner',
          pid: 456,
          createdAt: '2026-07-31T00:00:01.000Z',
          kind: 'daemon',
        },
      }),
      enableDaemon: async () => {
        daemonRestores += 1;
        return {
          mode: 'daemon',
          revision: 4,
          updatedAt: '2026-07-31T00:00:02.000Z',
        };
      },
    },
  });
  fake.runtime.daemon.stopForInline = async (input) => {
    fake.calls.daemonStops.push(input);
    throw new Error('Runtime daemon transport closed.');
  };

  await adapter.initialize();
  await assert.rejects(
    adapter.stopDaemonForCompleteExit('space-complete-exit-unverified-owner'),
    /owner release could not be verified/i,
  );

  assert.equal(fake.calls.close, 1);
  assert.equal(inlineAcquisitions, 0);
  assert.equal(daemonRestores, 1);
});

test('complete exit preserves restart-required recovery after a lost rollback reply', async () => {
  const fake = createFakeRuntime();
  let inlineAcquisitions = 0;
  const adapter = new RuntimeHostAdapter({
    mode: 'runtime',
    profileRoot: path.resolve('C:\\isolated-profile'),
    runtimeFactory: async () => fake.runtime,
    identityStore: testIdentityStore,
    runtimeEventParser: testRuntimeEventParser,
    runtimeExitSettler: null,
    ownerControl: {
      acquireInline: async () => {
        inlineAcquisitions += 1;
        throw new Error('inline owner fence unavailable');
      },
      getState: async () => ({
        profile: 'coder',
        policy: {
          mode: 'inline',
          revision: 3,
          updatedAt: '2026-07-31T00:00:01.000Z',
        },
        ownerStatus: 'unowned',
        owner: null,
      }),
      enableDaemon: async () => {
        throw new Error('daemon policy restore failed');
      },
    },
  });
  fake.runtime.daemon.stopForInline = async (input) => {
    fake.calls.daemonStops.push(input);
    throw new Error('Runtime daemon transport closed.');
  };

  await adapter.initialize();
  await assert.rejects(
    adapter.stopDaemonForCompleteExit('space-complete-exit-restart-required'),
    (error: unknown) => {
      assert.equal(isCoderOwnerRecoveryRestartRequired(error), true);
      assert.match(
        error instanceof Error ? error.message : String(error),
        /owner release could not be verified/i,
      );
      return true;
    },
  );

  assert.equal(fake.calls.close, 1);
  assert.equal(inlineAcquisitions, 2);
  assert.equal(adapter.snapshot().state, 'failed');
});

test('complete exit treats CLI missing as confirmation only when owner state is unowned', async () => {
  for (const ownerStatus of ['unowned', 'owned'] as const) {
    const adapter = new RuntimeHostAdapter({
      mode: 'runtime',
      profileRoot: path.resolve('C:\\isolated-profile'),
      runtimeExitSettler: null,
      idleDaemonStop: async () => ({ stopped: false, reason: 'missing' }),
      ownerControl: {
        acquireInline: async () => {
          throw new Error('not used');
        },
        getState: async () => ({
          profile: 'coder',
          policy: {
            mode: 'daemon',
            revision: 4,
            updatedAt: '2026-07-12T00:00:02.000Z',
          },
          ownerStatus,
          owner:
            ownerStatus === 'unowned'
              ? null
              : {
                  runtimeId: 'rt_still_owned',
                  pid: 123,
                  createdAt: '2026-07-12T00:00:00.000Z',
                  kind: 'daemon' as const,
                },
        }),
        enableDaemon: async () => ({
          mode: 'daemon',
          revision: 4,
          updatedAt: '2026-07-12T00:00:02.000Z',
        }),
      },
    });

    if (ownerStatus === 'unowned') {
      await assert.doesNotReject(adapter.stopDaemonForCompleteExit());
    } else {
      await assert.rejects(adapter.stopDaemonForCompleteExit(), (error: unknown) =>
        isCoderOwnerRecoveryRestartRequired(error),
      );
    }
  }
});

test('complete exit verifies the exact idle daemon owner before accepting CLI shutdown', async () => {
  const observedOwner = {
    runtimeId: 'rt_idle_contained',
    pid: 321,
    createdAt: '2026-08-06T00:00:00.000Z',
    kind: 'daemon' as const,
    processContainment: 'windows-job' as const,
    supervisorPid: 654,
  };
  let ownerReads = 0;
  let verificationOwner: typeof observedOwner | undefined;
  const adapter = new RuntimeHostAdapter({
    mode: 'runtime',
    profileRoot: path.resolve('C:\\isolated-profile'),
    runtimeExitSettler: null,
    idleDaemonStop: async () => ({ stopped: true }),
    daemonShutdownVerifier: async (input) => {
      verificationOwner = input.owner as typeof observedOwner;
      return { status: 'succeeded' };
    },
    ownerControl: {
      acquireInline: async () => {
        throw new Error('not used');
      },
      getState: async () => {
        ownerReads += 1;
        return ownerReads === 1
          ? {
              profile: 'coder',
              policy: {
                mode: 'daemon' as const,
                revision: 4,
                updatedAt: '2026-08-06T00:00:00.000Z',
              },
              ownerStatus: 'owned' as const,
              owner: observedOwner,
            }
          : {
              profile: 'coder',
              policy: {
                mode: 'daemon' as const,
                revision: 5,
                updatedAt: '2026-08-06T00:00:01.000Z',
              },
              ownerStatus: 'unowned' as const,
              owner: null,
            };
      },
      enableDaemon: async () => ({
        mode: 'daemon',
        revision: 5,
        updatedAt: '2026-08-06T00:00:01.000Z',
      }),
    },
  });

  await adapter.stopDaemonForCompleteExit();

  assert.deepEqual(verificationOwner, observedOwner);
  assert.ok(ownerReads >= 3);
});

test('complete exit rejects an idle CLI success without a captured daemon owner', async () => {
  const adapter = new RuntimeHostAdapter({
    mode: 'runtime',
    profileRoot: path.resolve('C:\\isolated-profile'),
    runtimeExitSettler: null,
    idleDaemonStop: async () => ({ stopped: true }),
    ownerControl: {
      acquireInline: async () => {
        throw new Error('not used');
      },
      getState: async () => ({
        profile: 'coder',
        policy: {
          mode: 'daemon',
          revision: 4,
          updatedAt: '2026-08-06T00:00:00.000Z',
        },
        ownerStatus: 'unowned',
        owner: null,
      }),
      enableDaemon: async () => ({
        mode: 'daemon',
        revision: 4,
        updatedAt: '2026-08-06T00:00:00.000Z',
      }),
    },
  });

  await assert.rejects(adapter.stopDaemonForCompleteExit(), (error: unknown) =>
    isCoderOwnerRecoveryRestartRequired(error),
  );
});

test('complete exit rejects an idle legacy daemon without verified containment', async () => {
  const legacyOwner = {
    runtimeId: 'rt_idle_legacy',
    pid: 987,
    createdAt: '2026-08-06T00:00:00.000Z',
    kind: 'daemon' as const,
  };
  let ownerReads = 0;
  const adapter = new RuntimeHostAdapter({
    mode: 'runtime',
    profileRoot: path.resolve('C:\\isolated-profile'),
    runtimeExitSettler: null,
    idleDaemonStop: async () => ({ stopped: true }),
    daemonShutdownVerifier: async () => ({
      status: 'unverified',
      reason: 'containment_unavailable',
    }),
    ownerControl: {
      acquireInline: async () => {
        throw new Error('not used');
      },
      getState: async () => {
        ownerReads += 1;
        return ownerReads === 1
          ? {
              profile: 'coder',
              policy: {
                mode: 'daemon' as const,
                revision: 4,
                updatedAt: '2026-08-06T00:00:00.000Z',
              },
              ownerStatus: 'owned' as const,
              owner: legacyOwner,
            }
          : {
              profile: 'coder',
              policy: {
                mode: 'daemon' as const,
                revision: 5,
                updatedAt: '2026-08-06T00:00:01.000Z',
              },
              ownerStatus: 'unowned' as const,
              owner: null,
            };
      },
      enableDaemon: async () => ({
        mode: 'daemon',
        revision: 5,
        updatedAt: '2026-08-06T00:00:01.000Z',
      }),
    },
  });

  await assert.rejects(adapter.stopDaemonForCompleteExit(), (error: unknown) =>
    isCoderOwnerRecoveryRestartRequired(error),
  );
});

test('ambiguous idle daemon stop requires process recovery', async () => {
  const adapter = new RuntimeHostAdapter({
    mode: 'runtime',
    profileRoot: path.resolve('C:\\isolated-profile'),
    runtimeExitSettler: null,
    idleDaemonStop: async () => ({
      stopped: false,
      reason: 'command_failed',
      message: 'daemon stop outcome is ambiguous',
    }),
  });

  await assert.rejects(adapter.stopDaemonForCompleteExit(), (error: unknown) =>
    isCoderOwnerRecoveryRestartRequired(error),
  );
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

test('daemon rollback preserves restart-required recovery when inline acquisition and daemon restore fail', async () => {
  const fake = createFakeRuntime();
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
        throw new Error('daemon restore failed');
      },
    },
  });

  await adapter.initialize();
  await assert.rejects(
    adapter.prepareInlineRollback(),
    (error: unknown) =>
      isCoderOwnerRecoveryRestartRequired(error) &&
      error.message.includes('could not complete or recover inline rollback'),
  );
  assert.equal(fake.calls.close, 1);
  assert.equal(adapter.snapshot().state, 'failed');
  assert.match(adapter.snapshot().error ?? '', /daemon restore failed.*inline acquisition failed/);
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
  await assert.rejects(
    adapter.restoreDaemonOwner(),
    (error: unknown) =>
      isCoderOwnerRecoveryRestartRequired(error) &&
      error.message.includes('daemon enable failed') &&
      error.message.includes('restart required'),
  );

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

test('Coder session listing excludes every Partner ownership marker', async () => {
  const fake = createFakeRuntime();
  const filters: unknown[] = [];
  Object.assign(fake.runtime.sessions, {
    list: async (filter: unknown) => {
      filters.push(filter);
      return [
        { id: 's_code', title: 'Coder', surface: 'code' },
        { id: 's_surface_partner', title: 'Partner', surface: 'partner' },
        { id: 's_tag_partner', title: 'Legacy Partner', tag: 'partner' },
        { id: 's_profile_partner', title: 'Profile Partner', profileId: 'kodax-space.partner' },
        { id: 's_runtime_info_partner', runtimeInfo: { surface: 'partner' } },
      ];
    },
  });
  const adapter = new RuntimeHostAdapter({
    mode: 'runtime',
    profileRoot: path.resolve('C:\\isolated-profile'),
    runtimeFactory: async () => fake.runtime,
    identityStore: testIdentityStore,
  });

  const sessions = await adapter.listSessions({ surface: 'code' });
  assert.deepEqual(
    sessions.map((session) => session.id),
    ['s_code'],
  );
  assert.deepEqual(filters, [{}]);
  await assert.rejects(adapter.listSessions({ surface: 'partner' }), /Partner sessions.*Coder/i);
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

test('ordinary conversation history preserves SDK order, ambiguity, and oversized entries', async () => {
  const fake = createFakeRuntime();
  fake.sessions.add('s_conversation');
  const older = {
    boundaryId: 'entry_user',
    auditEntryIds: ['entry_user'],
    message: { role: 'user' as const, content: 'same' },
  };
  const newer = {
    boundaryId: 'entry_assistant',
    auditEntryIds: ['entry_assistant'],
    message: { role: 'assistant' as const, content: 'answer' },
  };
  const olderByteLength = Buffer.byteLength(JSON.stringify(older), 'utf8');
  const newerByteLength = Buffer.byteLength(JSON.stringify(newer), 'utf8');
  let directCalled = false;
  Object.assign(fake.runtime.sessions, {
    conversation: async () => {
      directCalled = true;
      throw new Error('Space must use immutable conversation pages');
    },
    conversationPage: async (input: { cursor?: string }) =>
      input.cursor
        ? {
            revision: 'conversation_rev_1',
            sourceRevision: 'source_rev_1',
            status: 'ambiguous' as const,
            issues: [
              {
                code: 'legacy_overlap_ambiguous' as const,
                message: 'legacy overlap',
                occurrenceCount: 1,
                entryCount: 2,
                entryIds: ['entry_user', 'entry_assistant'],
              },
            ],
            entries: [
              {
                index: 0,
                boundaryId: older.boundaryId,
                byteLength: olderByteLength,
                oversized: false,
                entry: older,
              },
            ],
            hasMore: false,
          }
        : {
            revision: 'conversation_rev_1',
            sourceRevision: 'source_rev_1',
            status: 'ambiguous' as const,
            issues: [
              {
                code: 'legacy_overlap_ambiguous' as const,
                message: 'legacy overlap',
                occurrenceCount: 1,
                entryCount: 2,
                entryIds: ['entry_user', 'entry_assistant'],
              },
            ],
            entries: [
              {
                index: 1,
                boundaryId: newer.boundaryId,
                byteLength: newerByteLength,
                oversized: true,
              },
            ],
            hasMore: true,
            nextCursor: 'older-page',
          },
    conversationEntryChunk: async () => ({
      revision: 'conversation_rev_1',
      entryIndex: 1,
      boundaryId: newer.boundaryId,
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

  const conversation = await adapter.conversationHistory('s_conversation');

  assert.equal(conversation?.status, 'ambiguous');
  assert.equal(conversation?.sourceRevision, 'source_rev_1');
  assert.deepEqual(
    conversation?.entries.map((entry) => entry.boundaryId),
    ['entry_user', 'entry_assistant'],
  );
  assert.deepEqual(await adapter.conversationTurnEndBoundary('s_conversation', 0), {
    entryId: 'entry_assistant',
    sourceRevision: 'source_rev_1',
  });
  assert.equal(directCalled, false);
  await adapter.close();
});

test('bounded conversation page does not traverse older history and fences continuations', async () => {
  const fake = createFakeRuntime();
  fake.sessions.add('s_bounded_conversation');
  const older = {
    boundaryId: 'entry_older',
    auditEntryIds: ['entry_older'],
    message: { role: 'user' as const, content: 'older query' },
  };
  const newer = {
    boundaryId: 'entry_newer',
    auditEntryIds: ['entry_newer'],
    message: { role: 'assistant' as const, content: 'newer answer' },
  };
  const calls: Array<{ cursor?: string; limit?: number }> = [];
  Object.assign(fake.runtime.sessions, {
    load: async () => {
      throw new Error('bounded conversation pages must not materialize the full Session');
    },
    conversationPage: async (input: { cursor?: string; limit?: number }) => {
      calls.push(input);
      const entry = input.cursor ? older : newer;
      return {
        revision: 'conversation_rev_bounded',
        sourceRevision: 'source_rev_bounded',
        status: 'resolved' as const,
        issues: [],
        entries: [
          {
            index: input.cursor ? 0 : 1,
            boundaryId: entry.boundaryId,
            byteLength: Buffer.byteLength(JSON.stringify(entry), 'utf8'),
            oversized: false,
            entry,
          },
        ],
        hasMore: input.cursor === undefined,
        ...(input.cursor === undefined ? { nextCursor: 'older-page' } : {}),
      };
    },
  });
  const adapter = new RuntimeHostAdapter({
    mode: 'runtime',
    profileRoot: path.resolve('C:\\isolated-profile'),
    runtimeFactory: async () => fake.runtime,
    identityStore: testIdentityStore,
    runtimeEventParser: testRuntimeEventParser,
  });

  const latest = await adapter.conversationHistoryPage({
    sessionId: 's_bounded_conversation',
    limit: 64,
  });
  assert.equal(latest.outcome, 'ready');
  assert.deepEqual(
    calls.map((call) => call.cursor),
    [undefined],
  );
  if (latest.outcome !== 'ready' || latest.page === null) throw new Error('expected page');
  assert.deepEqual(
    latest.page.entries.map(({ index }) => index),
    [1],
  );
  assert.equal(latest.page.nextCursor, 'older-page');

  const olderPage = await adapter.conversationHistoryPage({
    sessionId: 's_bounded_conversation',
    cursor: 'older-page',
    revision: latest.page.revision,
    sourceRevision: latest.page.sourceRevision,
    limit: 64,
  });
  assert.equal(olderPage.outcome, 'ready');
  assert.deepEqual(
    calls.map((call) => call.cursor),
    [undefined, 'older-page'],
  );

  const stale = await adapter.conversationHistoryPage({
    sessionId: 's_bounded_conversation',
    cursor: 'older-page',
    revision: 'stale-revision',
    sourceRevision: latest.page.sourceRevision,
  });
  assert.deepEqual(stale, { outcome: 'data_changed' });
  await adapter.close();
});

test('bounded conversation paging rejects an idle Partner retag without a profile refresh', async () => {
  const sessionId = 's_history_retag';
  const records = new Map<string, Readonly<Record<string, unknown>>>([
    [sessionId, { title: '', messages: [], gitRoot: 'C:\\repo', tag: 'code' }],
  ]);
  installPersistedSessionLookup(records);
  const fake = createFakeRuntime();
  fake.sessions.add(sessionId);
  let pageReads = 0;
  Object.assign(fake.runtime.sessions, {
    conversationPage: async () => {
      pageReads += 1;
      return null;
    },
  });
  const adapter = new RuntimeHostAdapter({
    mode: 'runtime',
    profileRoot: path.resolve('C:\\isolated-profile'),
    runtimeFactory: async () => fake.runtime,
    identityStore: testIdentityStore,
    runtimeEventParser: testRuntimeEventParser,
  });

  assert.deepEqual(await adapter.conversationHistoryPage({ sessionId }), {
    outcome: 'ready',
    page: null,
  });
  records.set(sessionId, { title: '', messages: [], gitRoot: 'C:\\repo', tag: 'partner' });
  invalidatePersistedSessionCache(sessionId);

  await assert.rejects(
    adapter.conversationHistoryPage({ sessionId }),
    (error: unknown) =>
      error instanceof Error &&
      (error as Error & { code?: string }).code === 'session_identity_conflict',
  );
  assert.equal(pageReads, 1, 'Partner history must be rejected before the SDK page read');
  await adapter.close();
});

test('ordinary conversation paging fails closed on cross-page evidence and transport corruption', async (t) => {
  const issue = {
    code: 'legacy_overlap_ambiguous' as const,
    message: 'legacy overlap',
    occurrenceCount: 1,
    entryCount: 1,
    entryIds: ['entry_0'],
  };
  const entry0 = {
    boundaryId: 'entry_0',
    auditEntryIds: ['entry_0'],
    message: { role: 'user' as const, content: 'query' },
  };
  const entry1 = {
    boundaryId: 'entry_1',
    auditEntryIds: ['entry_1'],
    message: { role: 'assistant' as const, content: 'answer' },
  };
  const descriptor = (index: number, entry: typeof entry0 | typeof entry1) => ({
    index,
    boundaryId: entry.boundaryId,
    byteLength: Buffer.byteLength(JSON.stringify(entry), 'utf8'),
    oversized: false,
    entry,
  });

  await t.test('rejects changed issue entryIds even when summary counts match', async () => {
    const fake = createFakeRuntime();
    fake.sessions.add('s_issue_evidence');
    Object.assign(fake.runtime.sessions, {
      conversationPage: async (input: { cursor?: string }) =>
        input.cursor
          ? {
              revision: 'rev_issue',
              sourceRevision: 'source_issue',
              status: 'ambiguous' as const,
              issues: [{ ...issue, entryIds: ['different-entry'] }],
              entries: [descriptor(0, entry0)],
              hasMore: false,
            }
          : {
              revision: 'rev_issue',
              sourceRevision: 'source_issue',
              status: 'ambiguous' as const,
              issues: [issue],
              entries: [descriptor(1, entry1)],
              hasMore: true,
              nextCursor: 'older',
            },
    });
    const adapter = new RuntimeHostAdapter({
      mode: 'runtime',
      profileRoot: path.resolve('C:\\isolated-profile'),
      runtimeFactory: async () => fake.runtime,
      identityStore: testIdentityStore,
      runtimeEventParser: testRuntimeEventParser,
    });
    await assert.rejects(
      adapter.conversationHistory('s_issue_evidence'),
      /crossed its immutable boundary/i,
    );
    await adapter.close();
  });

  await t.test('rejects duplicate entry indexes', async () => {
    const fake = createFakeRuntime();
    fake.sessions.add('s_duplicate_page');
    Object.assign(fake.runtime.sessions, {
      conversationPage: async (input: { cursor?: string }) =>
        input.cursor
          ? {
              revision: 'rev_duplicate',
              sourceRevision: 'source_duplicate',
              status: 'resolved' as const,
              issues: [],
              entries: [descriptor(1, entry1)],
              hasMore: true,
              nextCursor: 'older',
            }
          : {
              revision: 'rev_duplicate',
              sourceRevision: 'source_duplicate',
              status: 'resolved' as const,
              issues: [],
              entries: [descriptor(1, entry1)],
              hasMore: true,
              nextCursor: 'older',
            },
    });
    const adapter = new RuntimeHostAdapter({
      mode: 'runtime',
      profileRoot: path.resolve('C:\\isolated-profile'),
      runtimeFactory: async () => fake.runtime,
      identityStore: testIdentityStore,
      runtimeEventParser: testRuntimeEventParser,
    });
    await assert.rejects(adapter.conversationHistory('s_duplicate_page'), /repeated entry index/i);
    await adapter.close();
  });

  await t.test('rejects repeated page continuation cursors', async () => {
    const fake = createFakeRuntime();
    fake.sessions.add('s_repeated_cursor');
    Object.assign(fake.runtime.sessions, {
      conversationPage: async (input: { cursor?: string }) =>
        input.cursor
          ? {
              revision: 'rev_cursor',
              sourceRevision: 'source_cursor',
              status: 'resolved' as const,
              issues: [],
              entries: [descriptor(0, entry0)],
              hasMore: true,
              nextCursor: 'older',
            }
          : {
              revision: 'rev_cursor',
              sourceRevision: 'source_cursor',
              status: 'resolved' as const,
              issues: [],
              entries: [descriptor(1, entry1)],
              hasMore: true,
              nextCursor: 'older',
            },
    });
    const adapter = new RuntimeHostAdapter({
      mode: 'runtime',
      profileRoot: path.resolve('C:\\isolated-profile'),
      runtimeFactory: async () => fake.runtime,
      identityStore: testIdentityStore,
      runtimeEventParser: testRuntimeEventParser,
    });
    await assert.rejects(adapter.conversationHistory('s_repeated_cursor'), /repeated.*cursor/i);
    await adapter.close();
  });

  await t.test('rejects malformed oversized chunk encoding and byte length', async () => {
    const fake = createFakeRuntime();
    fake.sessions.add('s_bad_chunk');
    const encoded = Buffer.from(JSON.stringify(entry0), 'utf8').toString('base64');
    Object.assign(fake.runtime.sessions, {
      conversationPage: async () => ({
        revision: 'rev_chunk',
        sourceRevision: 'source_chunk',
        status: 'resolved' as const,
        issues: [],
        entries: [
          {
            index: 0,
            boundaryId: entry0.boundaryId,
            byteLength: Buffer.byteLength(JSON.stringify(entry0), 'utf8'),
            oversized: true,
          },
        ],
        hasMore: false,
      }),
      conversationEntryChunk: async () => ({
        revision: 'rev_chunk',
        entryIndex: 0,
        boundaryId: entry0.boundaryId,
        encoding: 'utf8-json' as never,
        data: encoded,
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
    await assert.rejects(adapter.conversationHistory('s_bad_chunk'), /unsupported chunk encoding/i);
    await adapter.close();
  });

  await t.test('rejects an oversized entry whose reconstructed byte length differs', async () => {
    const fake = createFakeRuntime();
    fake.sessions.add('s_bad_chunk_length');
    const raw = Buffer.from(JSON.stringify(entry0), 'utf8');
    Object.assign(fake.runtime.sessions, {
      conversationPage: async () => ({
        revision: 'rev_chunk_length',
        sourceRevision: 'source_chunk_length',
        status: 'resolved' as const,
        issues: [],
        entries: [
          {
            index: 0,
            boundaryId: entry0.boundaryId,
            byteLength: raw.byteLength + 1,
            oversized: true,
          },
        ],
        hasMore: false,
      }),
      conversationEntryChunk: async () => ({
        revision: 'rev_chunk_length',
        entryIndex: 0,
        boundaryId: entry0.boundaryId,
        encoding: 'base64-json' as const,
        data: raw.toString('base64'),
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
    await assert.rejects(adapter.conversationHistory('s_bad_chunk_length'), /encoded byte length/i);
    await adapter.close();
  });

  await t.test('rejects repeated oversized-entry chunk cursors', async () => {
    const fake = createFakeRuntime();
    fake.sessions.add('s_repeated_chunk_cursor');
    const raw = Buffer.from(JSON.stringify(entry0), 'utf8');
    const splitAt = Math.max(1, Math.floor(raw.byteLength / 2));
    Object.assign(fake.runtime.sessions, {
      conversationPage: async () => ({
        revision: 'rev_chunk_cursor',
        sourceRevision: 'source_chunk_cursor',
        status: 'resolved' as const,
        issues: [],
        entries: [
          {
            index: 0,
            boundaryId: entry0.boundaryId,
            byteLength: raw.byteLength,
            oversized: true,
          },
        ],
        hasMore: false,
      }),
      conversationEntryChunk: async (input: { cursor?: string }) => ({
        revision: 'rev_chunk_cursor',
        entryIndex: 0,
        boundaryId: entry0.boundaryId,
        encoding: 'base64-json' as const,
        data: (input.cursor ? raw.subarray(splitAt) : raw.subarray(0, splitAt)).toString('base64'),
        hasMore: true,
        nextCursor: 'same-cursor',
      }),
    });
    const adapter = new RuntimeHostAdapter({
      mode: 'runtime',
      profileRoot: path.resolve('C:\\isolated-profile'),
      runtimeFactory: async () => fake.runtime,
      identityStore: testIdentityStore,
      runtimeEventParser: testRuntimeEventParser,
    });
    await assert.rejects(
      adapter.conversationHistory('s_repeated_chunk_cursor'),
      /repeated a continuation cursor/i,
    );
    await adapter.close();
  });
});

test('successful rewind invalidates an in-flight ordinary conversation generation', async () => {
  const fake = createFakeRuntime();
  fake.sessions.add('s_rewind_generation');
  let generation: 'stale' | 'fresh' = 'stale';
  let releaseStale!: () => void;
  const staleGate = new Promise<void>((resolve) => {
    releaseStale = resolve;
  });
  let staleStarted!: () => void;
  const staleStartedPromise = new Promise<void>((resolve) => {
    staleStarted = resolve;
  });
  let pageReads = 0;
  Object.assign(fake.runtime.sessions, {
    conversationPage: async () => {
      pageReads += 1;
      const captured = generation;
      if (captured === 'stale') {
        staleStarted();
        await staleGate;
      }
      const entry = {
        boundaryId: `entry_${captured}`,
        auditEntryIds: [`entry_${captured}`],
        message: { role: 'assistant' as const, content: captured },
      };
      return {
        revision: `revision_${captured}`,
        sourceRevision: `source_${captured}`,
        status: 'resolved' as const,
        issues: [],
        entries: [
          {
            index: 0,
            boundaryId: entry.boundaryId,
            byteLength: Buffer.byteLength(JSON.stringify(entry), 'utf8'),
            oversized: false,
            entry,
          },
        ],
        hasMore: false,
      };
    },
    rewind: async (input: { sessionId: string }) => {
      generation = 'fresh';
      return { id: input.sessionId, title: 'rewound' };
    },
  });
  const adapter = new RuntimeHostAdapter({
    mode: 'runtime',
    profileRoot: path.resolve('C:\\isolated-profile'),
    runtimeFactory: async () => fake.runtime,
    identityStore: testIdentityStore,
    runtimeEventParser: testRuntimeEventParser,
  });

  const staleRead = adapter.conversationHistory('s_rewind_generation');
  await staleStartedPromise;
  await adapter.rewindSession({ sessionId: 's_rewind_generation', selector: 'entry_0' });
  const freshRead = adapter.conversationHistory('s_rewind_generation');
  releaseStale();
  const [staleResult, freshResult] = await Promise.all([staleRead, freshRead]);

  assert.equal(pageReads, 2);
  assert.equal(staleResult?.entries[0]?.message.content, 'fresh');
  assert.equal(freshResult?.entries[0]?.message.content, 'fresh');
  await adapter.close();
});

test('concurrent transcript callers share one load and one immutable page traversal', async () => {
  const fake = createFakeRuntime();
  fake.sessions.add('s_coalesced');
  const entry = {
    entryId: 'entry_coalesced',
    parentId: null,
    logicalId: 'logical_coalesced',
    timestamp: '2026-08-01T00:00:00.000Z',
    type: 'message' as const,
    source: 'assistant' as const,
    message: { role: 'assistant' as const, content: 'one materialization' },
    active: true,
  };
  let releasePage!: () => void;
  const pageGate = new Promise<void>((resolve) => {
    releasePage = resolve;
  });
  let pageReads = 0;
  fake.runtime.sessions.transcriptPage = async () => {
    pageReads += 1;
    await pageGate;
    return {
      revision: 'rev_coalesced',
      entries: [{ index: 0, entryId: entry.entryId, byteLength: 100, oversized: false, entry }],
      hasMore: false,
    };
  };
  const adapter = new RuntimeHostAdapter({
    mode: 'runtime',
    profileRoot: path.resolve('C:\\isolated-profile'),
    runtimeFactory: async () => fake.runtime,
    identityStore: testIdentityStore,
    runtimeEventParser: testRuntimeEventParser,
  });

  const first = adapter.transcript('s_coalesced');
  const second = adapter.transcript('s_coalesced');
  await new Promise((resolve) => setImmediate(resolve));
  releasePage();
  const [firstResult, secondResult] = await Promise.all([first, second]);

  assert.deepEqual(firstResult, secondResult);
  assert.equal(fake.calls.loaded.length, 1);
  assert.equal(pageReads, 1);
  await adapter.close();
});

test('a Runtime event replaces an older in-flight transcript boundary for later callers', async () => {
  const fake = createFakeRuntime();
  fake.sessions.add('s_crossed_boundary');
  const staleEntry = {
    entryId: 'entry_stale',
    parentId: null,
    logicalId: 'logical_stale',
    timestamp: '2026-08-01T00:00:00.000Z',
    type: 'message' as const,
    source: 'assistant' as const,
    message: { role: 'assistant' as const, content: 'stale boundary' },
    active: true,
  };
  const freshEntry = {
    ...staleEntry,
    entryId: 'entry_fresh',
    logicalId: 'logical_fresh',
    timestamp: '2026-08-01T00:01:00.000Z',
    message: { role: 'assistant' as const, content: 'fresh boundary' },
  };
  const originalObserve = fake.runtime.sessions.observe.bind(fake.runtime.sessions);
  fake.runtime.sessions.observe = async (...args) => {
    const observation = await originalObserve(...args);
    return {
      ...observation,
      snapshot: {
        ...observation.snapshot,
        cursor: testRuntimeCursor('s_crossed_boundary', 10),
        transcriptRevision: 'rev_stale',
        session: { id: 's_crossed_boundary', title: 'Crossed boundary', surface: 'code' },
        transcript: {
          revision: 'rev_stale',
          entries: [],
          hasMore: true,
          nextCursor: 'stale-page',
        },
      },
    };
  };
  let releaseStale!: () => void;
  const staleGate = new Promise<void>((resolve) => {
    releaseStale = resolve;
  });
  let staleStarted!: () => void;
  const staleStartedGate = new Promise<void>((resolve) => {
    staleStarted = resolve;
  });
  let releaseFresh!: () => void;
  const freshGate = new Promise<void>((resolve) => {
    releaseFresh = resolve;
  });
  let freshStarted!: () => void;
  const freshStartedGate = new Promise<void>((resolve) => {
    freshStarted = resolve;
  });
  let freshPageReads = 0;
  fake.runtime.sessions.transcriptPage = async (input: { cursor?: string }) => {
    if (input.cursor === 'stale-page') {
      staleStarted();
      await staleGate;
      return {
        revision: 'rev_stale',
        entries: [
          {
            index: 0,
            entryId: staleEntry.entryId,
            byteLength: 100,
            oversized: false,
            entry: staleEntry,
          },
        ],
        hasMore: false,
      };
    }
    freshPageReads += 1;
    freshStarted();
    await freshGate;
    return {
      revision: 'rev_fresh',
      entries: [
        {
          index: 0,
          entryId: freshEntry.entryId,
          byteLength: 100,
          oversized: false,
          entry: freshEntry,
        },
      ],
      hasMore: false,
    };
  };
  const adapter = new RuntimeHostAdapter({
    mode: 'runtime',
    profileRoot: path.resolve('C:\\isolated-profile'),
    runtimeFactory: async () => fake.runtime,
    identityStore: testIdentityStore,
    runtimeEventParser: testRuntimeEventParser,
  });

  await adapter.ensureObserved('s_crossed_boundary');
  const crossedRead = adapter.transcript('s_crossed_boundary');
  await staleStartedGate;
  fake.emit({
    id: 'event_crossing_history',
    seq: 11,
    time: '2026-08-01T00:01:00.000Z',
    sessionId: 's_crossed_boundary',
    runId: 'run_crossed_boundary',
    type: 'runtime.warning',
    payload: { message: 'invalidate the transcript seed' },
  });
  const laterRead = adapter.transcript('s_crossed_boundary');
  await freshStartedGate;
  releaseStale();
  await new Promise((resolve) => setImmediate(resolve));
  releaseFresh();
  const [crossedResult, laterResult] = await Promise.all([crossedRead, laterRead]);

  assert.deepEqual(
    crossedResult?.transcriptEntries.map((entry) => entry.entryId),
    [freshEntry.entryId],
  );
  assert.deepEqual(crossedResult, laterResult);
  assert.equal(freshPageReads, 1);
  await adapter.close();
});

test('fresh observation transcript seeds history paging without duplicate Session loads', async () => {
  const fake = createFakeRuntime();
  fake.sessions.add('s_snapshot');
  const older = {
    entryId: 'entry_snapshot_older',
    parentId: null,
    logicalId: 'logical_snapshot_older',
    timestamp: '2026-07-31T00:00:00.000Z',
    type: 'message' as const,
    source: 'user' as const,
    message: { role: 'user' as const, content: 'older snapshot row' },
    active: true,
  };
  const latest = {
    entryId: 'entry_snapshot_latest',
    parentId: older.entryId,
    logicalId: 'logical_snapshot_latest',
    timestamp: '2026-07-31T00:01:00.000Z',
    type: 'message' as const,
    source: 'assistant' as const,
    message: { role: 'assistant' as const, content: 'latest snapshot row' },
    active: true,
  };
  const fresh = {
    entryId: 'entry_after_event',
    parentId: latest.entryId,
    logicalId: 'logical_after_event',
    timestamp: '2026-07-31T00:02:00.000Z',
    type: 'message' as const,
    source: 'assistant' as const,
    message: { role: 'assistant' as const, content: 'fresh after event' },
    active: true,
  };
  const originalObserve = fake.runtime.sessions.observe.bind(fake.runtime.sessions);
  fake.runtime.sessions.observe = async (...args) => {
    const observation = await originalObserve(...args);
    return {
      ...observation,
      snapshot: {
        ...observation.snapshot,
        cursor: testRuntimeCursor('s_snapshot', 10),
        transcriptRevision: 'rev_snapshot',
        session: { id: 's_snapshot', title: 'Snapshot title', surface: 'code' },
        transcript: {
          revision: 'rev_snapshot',
          entries: [
            {
              index: 1,
              entryId: latest.entryId,
              byteLength: 100,
              oversized: false,
              entry: latest,
            },
          ],
          hasMore: true,
          nextCursor: 'snapshot-older',
        },
      },
    };
  };
  const pageInputs: Array<{ cursor?: string }> = [];
  fake.runtime.sessions.transcriptPage = async (input: { cursor?: string }) => {
    pageInputs.push(input);
    if (input.cursor === 'snapshot-older') {
      return {
        revision: 'rev_snapshot',
        entries: [
          {
            index: 0,
            entryId: older.entryId,
            byteLength: 100,
            oversized: false,
            entry: older,
          },
        ],
        hasMore: false,
      };
    }
    return {
      revision: 'rev_after_event',
      entries: [
        {
          index: 2,
          entryId: fresh.entryId,
          byteLength: 100,
          oversized: false,
          entry: fresh,
        },
      ],
      hasMore: false,
    };
  };
  const adapter = new RuntimeHostAdapter({
    mode: 'runtime',
    profileRoot: path.resolve('C:\\isolated-profile'),
    runtimeFactory: async () => fake.runtime,
    identityStore: testIdentityStore,
    runtimeEventParser: testRuntimeEventParser,
  });

  await adapter.ensureObserved('s_snapshot');
  const snapshotTranscript = await adapter.transcript('s_snapshot');

  assert.deepEqual(fake.calls.loaded, []);
  assert.deepEqual(pageInputs, [{ sessionId: 's_snapshot', cursor: 'snapshot-older' }]);
  assert.deepEqual(
    snapshotTranscript?.transcriptEntries.map((entry) => entry.entryId),
    [older.entryId, latest.entryId],
  );

  fake.emit({
    id: 'event_after_snapshot',
    seq: 11,
    time: '2026-07-31T00:02:00.000Z',
    sessionId: 's_snapshot',
    runId: 'run_snapshot',
    type: 'runtime.warning',
    payload: { message: 'transcript may have changed' },
  });
  fake.calls.loaded.length = 0;
  pageInputs.length = 0;

  const refreshedTranscript = await adapter.transcript('s_snapshot');

  assert.deepEqual(pageInputs, [{ sessionId: 's_snapshot' }]);
  assert.deepEqual(
    refreshedTranscript?.transcriptEntries.map((entry) => entry.entryId),
    [fresh.entryId],
  );
  assert.equal(fake.calls.loaded.length, 1);
  await adapter.close();
});

test('transcript paging restarts from a fresh boundary on resync_required and passes read budgets', async () => {
  const fake = createFakeRuntime();
  fake.sessions.add('s_resync');
  const entry = {
    entryId: 'entry_1',
    parentId: null,
    logicalId: 'logical_1',
    timestamp: '2026-07-21T00:00:00.000Z',
    type: 'message' as const,
    source: 'assistant' as const,
    message: { role: 'assistant' as const, content: 'restored' },
    active: true,
  };
  let pageReads = 0;
  const readOptions: Array<{ timeoutMs?: number; signal?: AbortSignal }> = [];
  Object.assign(fake.runtime.sessions, {
    transcriptPage: async (
      _input: { cursor?: string },
      options?: { timeoutMs?: number; signal?: AbortSignal },
    ) => {
      pageReads += 1;
      readOptions.push(options ?? {});
      if (pageReads === 1) {
        throw Object.assign(new Error('snapshot expired'), { code: 'resync_required' });
      }
      return {
        revision: 'rev_2',
        entries: [{ index: 0, entryId: entry.entryId, byteLength: 100, oversized: false, entry }],
        hasMore: false,
      };
    },
  });
  const adapter = new RuntimeHostAdapter({
    mode: 'runtime',
    profileRoot: path.resolve('C:\\isolated-profile'),
    runtimeFactory: async () => fake.runtime,
    identityStore: testIdentityStore,
    runtimeEventParser: testRuntimeEventParser,
  });

  const transcript = await adapter.transcript('s_resync');

  assert.equal(pageReads, 2);
  assert.equal(transcript?.messages[0]?.content, 'restored');
  assert.ok(readOptions.every((options) => options.timeoutMs === 15_000));
  assert.ok(readOptions.every((options) => options.signal instanceof AbortSignal));
  await adapter.close();
});

test('committed root compaction projects its persisted boundary once and filters no-op/child outcomes', async () => {
  const fake = createFakeRuntime();
  fake.sessions.add('s_1');
  const compactionEntry = {
    entryId: 'entry_compaction',
    parentId: null,
    logicalId: 'entry_compaction',
    timestamp: '2026-07-29T07:06:50.278Z',
    type: 'compaction' as const,
    source: 'system' as const,
    active: true,
    summary: 'internal summary',
    payload: { tokensBefore: 120_000, tokensAfter: 40_000 },
    message: { role: 'system' as const, content: 'internal summary' },
  };
  Object.assign(fake.runtime.sessions, {
    transcriptPage: async (input: { cursor?: string }) =>
      input.cursor
        ? {
            revision: 'rev_compaction',
            entries: [
              {
                index: 1,
                entryId: compactionEntry.entryId,
                byteLength: 256,
                oversized: false,
                entry: compactionEntry,
              },
            ],
            hasMore: false,
          }
        : {
            revision: 'rev_compaction',
            entries: [
              {
                index: 0,
                entryId: 'old_compaction',
                byteLength: 256,
                oversized: false,
                entry: {
                  ...compactionEntry,
                  entryId: 'old_compaction',
                  logicalId: 'old_compaction',
                  timestamp: '2026-07-29T07:05:50.278Z',
                  payload: { tokensBefore: 90_000, tokensAfter: 30_000 },
                },
              },
            ],
            hasMore: true,
            nextCursor: 'current-page',
          },
    transcriptEntryChunk: async () => null,
  });
  const pushed: Array<{ channel: string; payload: unknown }> = [];
  const adapter = new RuntimeHostAdapter({
    mode: 'runtime',
    profileRoot: path.resolve('C:\\isolated-profile'),
    runtimeFactory: async () => fake.runtime,
    identityStore: testIdentityStore,
    runtimeEventParser: testRuntimeEventParser,
    push: (channel, payload) => pushed.push({ channel, payload }),
  });
  await adapter.initialize();
  await adapter.compactSession({ sessionId: 's_1', provider: 'mock' });

  const committedPayload = {
    contextId: 's_1',
    contextKind: 'root',
    committed: true,
    compactionEntryId: 'entry_compaction',
    tokensBefore: 120_000,
    tokensAfter: 40_000,
    source: 'automatic_threshold',
  } as const;
  const committed = {
    id: 'evt_compaction',
    seq: 1,
    time: '2026-07-29T07:06:50.321Z',
    sessionId: 's_1',
    runId: 'run_1',
    type: 'context.compaction.finished',
    payload: committedPayload,
  } as import('@kodax-ai/kodax/runtime').RuntimeTypedEvent;
  fake.emit(committed);
  await waitForTest(() =>
    pushed.some(
      ({ payload }) =>
        (payload as { kind?: unknown; provisionalId?: unknown }).kind === 'lineage_notice' &&
        (payload as { provisionalId?: unknown }).provisionalId ===
          'runtime-compaction:evt_compaction',
    ),
  );
  await waitForTest(() =>
    pushed.some(
      ({ payload }) =>
        (payload as { kind?: unknown; entryId?: unknown }).kind === 'lineage_notice' &&
        (payload as { entryId?: unknown }).entryId === 'entry_compaction',
    ),
  );
  const boundaries = pushed
    .filter(({ payload }) => (payload as { kind?: unknown }).kind === 'lineage_notice')
    .map(({ payload }) => payload);
  assert.deepEqual(boundaries[0], {
    kind: 'lineage_notice',
    sessionId: 's_1',
    noticeKind: 'compaction',
    text: 'Compaction',
    provisionalId: 'runtime-compaction:evt_compaction',
    displayId: 'runtime-compaction:evt_compaction',
    contextId: 's_1',
    source: 'automatic_threshold',
    tokensBefore: 120_000,
    tokensAfter: 40_000,
    sentAt: Date.parse('2026-07-29T07:06:50.321Z'),
  });
  assert.deepEqual(boundaries[1], {
    kind: 'lineage_notice',
    sessionId: 's_1',
    noticeKind: 'compaction',
    text: 'internal summary',
    provisionalId: 'runtime-compaction:evt_compaction',
    displayId: 'runtime-compaction:evt_compaction',
    entryId: 'entry_compaction',
    parentId: null,
    logicalId: 'entry_compaction',
    canonicalIndex: 1,
    contextId: 's_1',
    source: 'automatic_threshold',
    tokensBefore: 120_000,
    tokensAfter: 40_000,
    sentAt: Date.parse('2026-07-29T07:06:50.278Z'),
  });

  fake.emit({ ...committed, seq: 2 });
  fake.emit({
    ...committed,
    id: 'evt_compaction_noop',
    seq: 3,
    payload: { ...committedPayload, committed: false },
  } as import('@kodax-ai/kodax/runtime').RuntimeTypedEvent);
  fake.emit({
    ...committed,
    id: 'evt_compaction_child',
    seq: 4,
    payload: {
      ...committedPayload,
      contextKind: 'child',
      parentContextId: 's_1',
    },
  } as import('@kodax-ai/kodax/runtime').RuntimeTypedEvent);
  await waitForTest(
    () =>
      pushed.filter(({ payload }) => (payload as { kind?: unknown }).kind === 'compact_stats')
        .length >= 4,
  );
  assert.equal(
    pushed.filter(({ payload }) => (payload as { kind?: unknown }).kind === 'lineage_notice')
      .length,
    2,
  );
  await adapter.close();
});

test('committed compaction without a physical entry ID stays provisional and performs no transcript scan', async () => {
  const fake = createFakeRuntime();
  fake.sessions.add('s_1');
  let pageReads = 0;
  Object.assign(fake.runtime.sessions, {
    transcriptPage: async () => {
      pageReads += 1;
      throw new Error('transcript paging must not run without an exact entry ID');
    },
  });
  const pushed: Array<{ channel: string; payload: unknown }> = [];
  const adapter = new RuntimeHostAdapter({
    mode: 'runtime',
    profileRoot: path.resolve('C:\\isolated-profile'),
    runtimeFactory: async () => fake.runtime,
    identityStore: testIdentityStore,
    runtimeEventParser: testRuntimeEventParser,
    push: (channel, payload) => pushed.push({ channel, payload }),
  });
  await adapter.initialize();
  await adapter.compactSession({ sessionId: 's_1', provider: 'mock' });
  const eventBase = {
    sessionId: 's_1',
    runId: 'run_1',
    time: '2026-07-29T07:06:50.321Z',
  } as const;
  fake.emit({
    ...eventBase,
    id: 'evt_compaction_without_entry_id',
    seq: 1,
    type: 'context.compaction.finished',
    payload: {
      contextId: 's_1',
      contextKind: 'root',
      committed: true,
      tokensBefore: 120_000,
      tokensAfter: 40_000,
    },
  } as import('@kodax-ai/kodax/runtime').RuntimeTypedEvent);
  fake.emit({
    ...eventBase,
    id: 'evt_segment_after_unbound_compaction',
    seq: 2,
    type: 'output.segment.started',
    payload: {
      responseId: 'response_compaction',
      providerRequestId: 'request_compaction',
      mode: 'append',
      meta: { contextKind: 'root' },
    },
  } as import('@kodax-ai/kodax/runtime').RuntimeTypedEvent);
  fake.emit({
    ...eventBase,
    id: 'evt_text_after_unbound_compaction',
    seq: 3,
    type: 'assistant.delta',
    payload: {
      text: 'still streaming',
      providerRequestId: 'request_compaction',
      meta: { contextKind: 'root' },
    },
  } as import('@kodax-ai/kodax/runtime').RuntimeTypedEvent);

  await waitForTest(() =>
    pushed.some(
      ({ payload }) =>
        (payload as { kind?: unknown; text?: unknown }).kind === 'text_delta' &&
        (payload as { text?: unknown }).text === 'still streaming',
    ),
  );
  const transcriptEvents = pushed
    .map(
      ({ payload }) =>
        payload as {
          kind?: unknown;
          entryId?: unknown;
          provisionalId?: unknown;
          displayId?: unknown;
        },
    )
    .filter(({ kind }) => kind === 'lineage_notice' || kind === 'text_delta');
  assert.deepEqual(
    transcriptEvents.map(({ kind }) => kind),
    ['lineage_notice', 'text_delta'],
  );
  assert.equal(transcriptEvents[0]?.entryId, undefined);
  assert.deepEqual(transcriptEvents[0], {
    kind: 'lineage_notice',
    sessionId: 's_1',
    noticeKind: 'compaction',
    text: 'Compaction',
    provisionalId: 'runtime-compaction:evt_compaction_without_entry_id',
    displayId: 'runtime-compaction:evt_compaction_without_entry_id',
    contextId: 's_1',
    tokensBefore: 120_000,
    tokensAfter: 40_000,
    sentAt: Date.parse('2026-07-29T07:06:50.321Z'),
  });
  assert.equal(pageReads, 0);
  await adapter.close();
});

test('committed compaction stays visible and does not block later output when paging fails', async () => {
  const fake = createFakeRuntime();
  fake.sessions.add('s_1');
  let pageReads = 0;
  Object.assign(fake.runtime.sessions, {
    transcriptPage: async () => {
      pageReads += 1;
      throw new Error('transient paging failure');
    },
  });
  const pushed: Array<{ channel: string; payload: unknown }> = [];
  const adapter = new RuntimeHostAdapter({
    mode: 'runtime',
    profileRoot: path.resolve('C:\\isolated-profile'),
    runtimeFactory: async () => fake.runtime,
    identityStore: testIdentityStore,
    runtimeEventParser: testRuntimeEventParser,
    push: (channel, payload) => pushed.push({ channel, payload }),
  });
  await adapter.initialize();
  await adapter.compactSession({ sessionId: 's_1', provider: 'mock' });
  const eventBase = {
    sessionId: 's_1',
    runId: 'run_1',
    time: '2026-07-29T07:06:50.321Z',
  } as const;
  fake.emit({
    ...eventBase,
    id: 'evt_compaction_failed_page',
    seq: 1,
    type: 'context.compaction.finished',
    payload: {
      contextId: 's_1',
      contextKind: 'root',
      committed: true,
      compactionEntryId: 'entry_missing',
      tokensBefore: 120_000,
      tokensAfter: 40_000,
    },
  } as import('@kodax-ai/kodax/runtime').RuntimeTypedEvent);
  fake.emit({
    ...eventBase,
    id: 'evt_segment_after_compaction',
    seq: 2,
    type: 'output.segment.started',
    payload: {
      responseId: 'response_compaction',
      providerRequestId: 'request_compaction',
      mode: 'append',
      meta: { contextKind: 'root' },
    },
  } as import('@kodax-ai/kodax/runtime').RuntimeTypedEvent);
  fake.emit({
    ...eventBase,
    id: 'evt_text_after_compaction',
    seq: 3,
    type: 'assistant.delta',
    payload: {
      text: 'still streaming',
      providerRequestId: 'request_compaction',
      meta: { contextKind: 'root' },
    },
  } as import('@kodax-ai/kodax/runtime').RuntimeTypedEvent);

  await waitForTest(() =>
    pushed.some(
      ({ payload }) =>
        (payload as { kind?: unknown; text?: unknown }).kind === 'text_delta' &&
        (payload as { text?: unknown }).text === 'still streaming',
    ),
  );
  await waitForTest(() => pageReads >= 3);
  const transcriptEvents = pushed
    .map(({ payload }) => payload as { kind?: unknown; entryId?: unknown })
    .filter(({ kind }) => kind === 'lineage_notice' || kind === 'text_delta');
  assert.deepEqual(
    transcriptEvents.map(({ kind }) => kind),
    ['lineage_notice', 'text_delta'],
  );
  assert.equal(transcriptEvents[0]?.entryId, undefined);
  assert.equal(pageReads, 3);
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
  installPersistedSessionLookup();
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

  assert.deepEqual(fake.calls.loaded, ['s_new']);
  assert.equal(fake.calls.created.length, 1);
  assert.deepEqual(fake.calls.created[0], {
    sessionId: 's_new',
    projectPath: 'C:\\repo',
    gitRoot: 'C:\\repo',
    surface: 'space-desktop',
    tag: 'code',
  });
});

test('ensureSession singleflights one identity and retries transient topology changes', async () => {
  const fake = createFakeRuntime();
  const projectRoot = process.platform === 'win32' ? 'C:\\repo' : '/repo';
  const equivalentProjectRoot = process.platform === 'win32' ? 'c:/REPO/' : '/repo/';
  const sessions = fake.runtime.sessions as unknown as {
    load(sessionId: string): Promise<RuntimeSession>;
  };
  const originalLoad = sessions.load.bind(sessions);
  let attempts = 0;
  sessions.load = async (sessionId) => {
    attempts += 1;
    if (attempts < 3) {
      throw Object.assign(new Error('Session location topology changed'), { code: 'data_changed' });
    }
    return originalLoad(sessionId);
  };
  const adapter = new RuntimeHostAdapter({
    mode: 'runtime',
    profileRoot: path.resolve('C:\\isolated-profile'),
    runtimeFactory: async () => fake.runtime,
    identityStore: testIdentityStore,
  });
  // Establish a current profile that does not yet contain this externally-created Session. That
  // makes the identity inconclusive and exercises the strict fallback/retry path.
  await adapter.initialize();
  fake.sessions.add('s_topology_retry');
  fake.sessionRecords.set('s_topology_retry', {
    id: 's_topology_retry',
    title: '',
    workspaceRoot: projectRoot,
    gitRoot: projectRoot,
    surface: 'space-desktop',
  });
  const identity = {
    sessionId: 's_topology_retry',
    projectRoot,
    surface: 'code' as const,
    ephemeral: false,
  };

  assert.deepEqual(
    await Promise.all([
      adapter.ensureSession(identity),
      adapter.ensureSession({ ...identity, projectRoot: equivalentProjectRoot }),
    ]),
    [false, false],
  );
  assert.equal(attempts, 3);
  assert.deepEqual(fake.calls.loaded, ['s_topology_retry']);
});

test('ensureSession rejects an existing Session bound to another project', async () => {
  installPersistedSessionLookup();
  const fake = createFakeRuntime();
  fake.sessions.add('s_existing');
  fake.sessionRecords.set('s_existing', {
    id: 's_existing',
    title: '',
    workspaceRoot: 'C:\\other-repo',
    gitRoot: 'C:\\other-repo',
    surface: 'space-desktop',
  });
  const adapter = new RuntimeHostAdapter({
    mode: 'runtime',
    profileRoot: path.resolve('C:\\isolated-profile'),
    runtimeFactory: async () => fake.runtime,
    identityStore: testIdentityStore,
  });

  await assert.rejects(
    adapter.ensureSession({
      sessionId: 's_existing',
      projectRoot: 'C:\\repo',
      surface: 'code',
      ephemeral: false,
    }),
    (error: unknown) =>
      error instanceof Error &&
      (error as Error & { code?: string }).code === 'session_identity_conflict' &&
      /does not match projectRoot/i.test(error.message),
  );
});

test('ensureSession rejects a persisted tag-only Partner before daemon reuse', async () => {
  installPersistedSessionLookup(
    new Map([
      [
        's_tag_only_partner',
        {
          title: '',
          messages: [],
          gitRoot: 'C:\\repo',
          tag: 'partner',
        },
      ],
    ]),
  );
  const fake = createFakeRuntime();
  fake.sessions.add('s_tag_only_partner');
  fake.sessionRecords.set('s_tag_only_partner', {
    id: 's_tag_only_partner',
    title: '',
    workspaceRoot: 'C:\\repo',
    gitRoot: 'C:\\repo',
  });
  const adapter = new RuntimeHostAdapter({
    mode: 'runtime',
    profileRoot: path.resolve('C:\\isolated-profile'),
    runtimeFactory: async () => fake.runtime,
    identityStore: testIdentityStore,
  });

  await assert.rejects(
    adapter.ensureSession({
      sessionId: 's_tag_only_partner',
      projectRoot: 'C:\\repo',
      surface: 'code',
      ephemeral: false,
    }),
    (error: unknown) =>
      error instanceof Error &&
      (error as Error & { code?: string }).code === 'session_identity_conflict' &&
      /inline Partner surface/i.test(error.message),
  );
  assert.deepEqual(fake.calls.loaded, []);
});

test('Coder operations reject a persisted tag-only Partner without an expected project', async () => {
  installPersistedSessionLookup(
    new Map([
      [
        's_tag_only_partner_operation',
        {
          title: '',
          messages: [],
          gitRoot: 'C:\\repo',
          tag: 'partner',
        },
      ],
    ]),
  );
  const fake = createFakeRuntime();
  fake.sessions.add('s_tag_only_partner_operation');
  const adapter = new RuntimeHostAdapter({
    mode: 'runtime',
    profileRoot: path.resolve('C:\\isolated-profile'),
    runtimeFactory: async () => fake.runtime,
    identityStore: testIdentityStore,
  });

  await assert.rejects(
    adapter.compactSession({
      sessionId: 's_tag_only_partner_operation',
      provider: 'mock',
    }),
    (error: unknown) =>
      error instanceof Error &&
      (error as Error & { code?: string }).code === 'session_identity_conflict' &&
      /inline Partner surface/i.test(error.message),
  );
  assert.deepEqual(fake.calls.loaded, []);
  assert.deepEqual(fake.calls.compacted, []);
});

test('Coder ownership checks observe a cross-process Partner retag without an LRU delay', async () => {
  const records = new Map<string, Readonly<Record<string, unknown>>>([
    [
      's_retagged_partner',
      {
        title: '',
        messages: [],
        gitRoot: 'C:\\repo',
        tag: 'code',
      },
    ],
  ]);
  installPersistedSessionLookup(records);
  const fake = createFakeRuntime();
  fake.sessions.add('s_retagged_partner');
  const adapter = new RuntimeHostAdapter({
    mode: 'runtime',
    profileRoot: path.resolve('C:\\isolated-profile'),
    runtimeFactory: async () => fake.runtime,
    identityStore: testIdentityStore,
  });

  await adapter.compactSession({ sessionId: 's_retagged_partner', provider: 'mock' });
  records.set('s_retagged_partner', {
    title: '',
    messages: [],
    gitRoot: 'C:\\repo',
    tag: 'partner',
  });
  await assert.rejects(
    adapter.compactSession({ sessionId: 's_retagged_partner', provider: 'mock' }),
    (error: unknown) =>
      error instanceof Error &&
      (error as Error & { code?: string }).code === 'session_identity_conflict',
  );
  assert.deepEqual(fake.calls.loaded, ['s_retagged_partner']);
  assert.equal(fake.calls.compacted.length, 1);
});

test('observation and transcript reads reject a Session retagged to Partner', async () => {
  const records = new Map<string, Readonly<Record<string, unknown>>>([
    [
      's_observed_retag',
      {
        title: '',
        messages: [],
        gitRoot: 'C:\\repo',
        tag: 'code',
      },
    ],
  ]);
  installPersistedSessionLookup(records);
  const fake = createFakeRuntime();
  fake.sessions.add('s_observed_retag');
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

  await adapter.initialize();
  await adapter.ensureObserved('s_observed_retag');
  assert.equal(controller.sessionLiveSnapshot('s_observed_retag').sessionId, 's_observed_retag');

  records.set('s_observed_retag', {
    title: '',
    messages: [],
    gitRoot: 'C:\\repo',
    tag: 'partner',
  });
  const rejectsIdentityConflict = (error: unknown) =>
    error instanceof Error &&
    (error as Error & { code?: string }).code === 'session_identity_conflict';

  await assert.rejects(adapter.transcript('s_observed_retag'), rejectsIdentityConflict);
  assert.throws(
    () => controller.sessionLiveSnapshot('s_observed_retag'),
    RuntimeProjectionUnavailableError,
  );
  assert.equal(fake.calls.observationCloses, 1);
  await assert.rejects(adapter.ensureObserved('s_observed_retag'), rejectsIdentityConflict);
  await assert.rejects(
    adapter.diagnoseSession({ sessionId: 's_observed_retag' }),
    rejectsIdentityConflict,
  );
  assert.deepEqual(fake.calls.sessionDiagnostics, []);
  assert.deepEqual(fake.calls.transcripts, []);

  await adapter.close();
});

test('live snapshot reconciliation uses fresh Runtime ownership without crossing active history', async () => {
  let persistedReads = 0;
  setSessionStoreImpl({
    listSessions: async () => [],
    forkSession: async () => null,
    rewindSession: async () => null,
    deleteSession: async () => ({ ok: true }),
    loadSession: async (sessionId) => {
      persistedReads += 1;
      return {
        sessionId,
        title: '',
        messages: [],
        gitRoot: 'C:\\repo',
        tag: 'code',
      } as never;
    },
    watchSessions: () => ({ close() {} }),
  } as SessionStoreImpl);
  const fake = createFakeRuntime();
  fake.sessions.add('s_cached_snapshot');
  const originalObserve = fake.runtime.sessions.observe.bind(fake.runtime.sessions);
  fake.runtime.sessions.observe = async (...args) => {
    const observation = await originalObserve(...args);
    return {
      ...observation,
      snapshot: {
        ...observation.snapshot,
        runs: [
          {
            runId: 'run_cached_snapshot',
            sessionId: 's_cached_snapshot',
            phase: 'running' as const,
            provider: 'mock',
            mode: 'managed_task' as const,
            startedAt: '2026-08-05T01:00:00.000Z',
          },
        ],
      },
    };
  };
  const adapter = new RuntimeHostAdapter({
    mode: 'runtime',
    profileRoot: path.resolve('C:\\isolated-profile'),
    runtimeFactory: async () => fake.runtime,
    identityStore: testIdentityStore,
    runtimeEventParser: testRuntimeEventParser,
  });

  await adapter.initialize();
  assert.equal(
    (await adapter.readSessionLiveSnapshot('s_cached_snapshot')).sessionId,
    's_cached_snapshot',
  );
  persistedReads = 0;
  invalidatePersistedSessionCache('s_cached_snapshot');
  for (let index = 0; index < 100; index += 1) {
    assert.equal(
      (await adapter.readSessionLiveSnapshot('s_cached_snapshot')).sessionId,
      's_cached_snapshot',
    );
  }

  assert.equal(persistedReads, 0, 'Runtime profile ownership avoids mutable persisted history');
  assert.deepEqual(fake.calls.observed, ['s_cached_snapshot']);
  await adapter.close();
});

test('live ownership reconciliation stays on cached Runtime membership while history changes', async () => {
  setSessionStoreImpl({
    listSessions: async () => [],
    forkSession: async () => null,
    rewindSession: async () => null,
    deleteSession: async () => ({ ok: true }),
    loadSession: async (sessionId) =>
      ({
        sessionId,
        title: '',
        messages: [],
        gitRoot: 'C:\\repo',
        tag: 'code',
      }) as never,
    watchSessions: () => ({ close() {} }),
  } as SessionStoreImpl);
  const fake = createFakeRuntime();
  fake.sessions.add('s_streaming_ownership');
  const originalStatusSnapshot = fake.runtime.status.snapshot.bind(fake.runtime.status);
  let mutateDuringStatus = false;
  let statusReads = 0;
  fake.runtime.status.snapshot = async () => {
    statusReads += 1;
    const snapshot = await originalStatusSnapshot();
    if (mutateDuringStatus) invalidatePersistedSessionCache('s_streaming_ownership');
    return snapshot;
  };
  const adapter = new RuntimeHostAdapter({
    mode: 'runtime',
    profileRoot: path.resolve('C:\\isolated-profile'),
    runtimeFactory: async () => fake.runtime,
    identityStore: testIdentityStore,
    runtimeEventParser: testRuntimeEventParser,
  });

  await adapter.initialize();
  statusReads = 0;
  mutateDuringStatus = true;
  invalidatePersistedSessionCache('s_streaming_ownership');
  assert.equal(
    (await adapter.readSessionLiveSnapshot('s_streaming_ownership')).sessionId,
    's_streaming_ownership',
  );
  assert.equal(
    statusReads,
    0,
    'live recovery must reuse cached Runtime membership instead of refreshing the global profile',
  );
  await adapter.close();
});

test('active Runtime ownership bypass does not certify an external Partner retag after terminal', async () => {
  const sessionId = 's_active_retag_terminal';
  const runId = 'run_active_retag_terminal';
  const records = new Map<string, Readonly<Record<string, unknown>>>([
    [
      sessionId,
      {
        sessionId,
        title: '',
        messages: [],
        gitRoot: 'C:\\repo',
        tag: 'code',
      },
    ],
  ]);
  installPersistedSessionLookup(records);
  const fake = createFakeRuntime();
  fake.sessions.add(sessionId);
  const originalObserve = fake.runtime.sessions.observe.bind(fake.runtime.sessions);
  fake.runtime.sessions.observe = async (...args) => {
    const observation = await originalObserve(...args);
    return {
      ...observation,
      snapshot: {
        ...observation.snapshot,
        runs: [
          {
            runId,
            sessionId,
            phase: 'running' as const,
            provider: 'mock',
            mode: 'managed_task' as const,
            startedAt: '2026-08-05T12:00:00.000Z',
          },
        ],
      },
    };
  };
  const adapter = new RuntimeHostAdapter({
    mode: 'runtime',
    profileRoot: path.resolve('C:\\isolated-profile'),
    runtimeFactory: async () => fake.runtime,
    identityStore: testIdentityStore,
    runtimeEventParser: testRuntimeEventParser,
  });

  await adapter.initialize();
  assert.equal((await adapter.readSessionLiveSnapshot(sessionId)).activeRun?.runId, runId);
  records.set(sessionId, {
    sessionId,
    title: '',
    messages: [],
    gitRoot: 'C:\\repo',
    tag: 'partner',
  });
  invalidatePersistedSessionCache(sessionId);
  assert.equal(
    (await adapter.readSessionLiveSnapshot(sessionId)).activeRun?.runId,
    runId,
    'positive active Runtime evidence remains authoritative while the Run is active',
  );

  fake.emit({
    id: 'event_active_retag_terminal',
    seq: 1,
    time: '2026-08-05T12:00:01.000Z',
    type: 'run.completed',
    sessionId,
    runId,
    payload: {
      runId,
      sessionId,
      phase: 'completed',
      provider: 'mock',
      mode: 'managed_task',
      startedAt: '2026-08-05T12:00:00.000Z',
      endedAt: '2026-08-05T12:00:01.000Z',
    },
  });
  await new Promise<void>((resolve) => setImmediate(resolve));

  await assert.rejects(
    adapter.readSessionLiveSnapshot(sessionId),
    (error: unknown) =>
      error instanceof Error &&
      (error as Error & { code?: string }).code === 'session_identity_conflict',
  );
  await adapter.close();
});

test('history and live recovery do not wait for daemon management inspection', async () => {
  const sessionIds = Array.from({ length: 20 }, (_, index) => `s_parallel_recovery_${index}`);
  const fake = createFakeRuntime();
  for (const sessionId of sessionIds) fake.sessions.add(sessionId);
  const adapter = new RuntimeHostAdapter({
    mode: 'runtime',
    profileRoot: path.resolve('C:\\isolated-profile'),
    runtimeFactory: async () => fake.runtime,
    identityStore: testIdentityStore,
    runtimeEventParser: testRuntimeEventParser,
  });

  await adapter.initialize();
  fake.runtime.daemon.inspect = () => {
    fake.calls.daemonInspections += 1;
    return new Promise<RuntimeDaemonManagementState>(() => undefined);
  };
  const privateAdapter = adapter as unknown as {
    pollIntegrationHealth(runtime: KodaXDaemonRuntime): Promise<void>;
  };
  void privateAdapter.pollIntegrationHealth(fake.runtime);
  await new Promise<void>((resolve) => setImmediate(resolve));
  for (const sessionId of sessionIds) invalidatePersistedSessionCache(sessionId);

  const recovery = Promise.all([
    ...sessionIds.map((sessionId) => adapter.conversationHistoryPage({ sessionId })),
    ...sessionIds.map((sessionId) => adapter.readSessionLiveSnapshot(sessionId)),
  ]);
  const recovered = await Promise.race([
    recovery,
    new Promise<never>((_resolve, reject) => {
      setTimeout(() => reject(new Error('session recovery waited for daemon management')), 1_000);
    }),
  ]);

  assert.equal(recovered.length, sessionIds.length * 2);
  assert.equal(
    fake.calls.daemonInspections,
    1,
    'the blocked management lane remains single-flight',
  );
  await adapter.close();
});

test('cold live observation bursts are serialized without blocking history reads', async () => {
  const fake = createFakeRuntime();
  fake.sessions.add('s_observation_one');
  fake.sessions.add('s_observation_two');
  const adapter = new RuntimeHostAdapter({
    mode: 'runtime',
    profileRoot: path.resolve('C:\\isolated-profile'),
    runtimeFactory: async () => fake.runtime,
    identityStore: testIdentityStore,
    runtimeEventParser: testRuntimeEventParser,
  });

  await adapter.initialize();
  const originalObserve = fake.runtime.sessions.observe.bind(fake.runtime.sessions);
  let releaseFirstObservation!: () => void;
  const firstObservationGate = new Promise<void>((resolve) => {
    releaseFirstObservation = resolve;
  });
  let startedObservations = 0;
  let activeObservations = 0;
  let maxActiveObservations = 0;
  fake.runtime.sessions.observe = async (...args: Parameters<typeof originalObserve>) => {
    startedObservations += 1;
    activeObservations += 1;
    maxActiveObservations = Math.max(maxActiveObservations, activeObservations);
    try {
      if (args[0] === 's_observation_one') await firstObservationGate;
      return await originalObserve(...args);
    } finally {
      activeObservations -= 1;
    }
  };

  const firstSnapshot = adapter.readSessionLiveSnapshot('s_observation_one');
  await waitForTest(() => startedObservations === 1);
  const secondSnapshot = adapter.readSessionLiveSnapshot('s_observation_two');
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(startedObservations, 1, 'only one cold observation may enter the Runtime at a time');

  const history = await Promise.race([
    adapter.conversationHistoryPage({ sessionId: 's_observation_two' }),
    new Promise<never>((_resolve, reject) => {
      setTimeout(() => reject(new Error('history waited behind a cold observation burst')), 250);
    }),
  ]);
  assert.equal(history.outcome, 'ready');

  releaseFirstObservation();
  await Promise.all([firstSnapshot, secondSnapshot]);
  assert.equal(maxActiveObservations, 1);
  assert.deepEqual(fake.calls.observed, ['s_observation_one', 's_observation_two']);
  await adapter.close();
});

test('a failed cold observation releases the next Session in the Runtime queue', async () => {
  const fake = createFakeRuntime();
  fake.sessions.add('s_observation_fails');
  fake.sessions.add('s_observation_recovers');
  const originalObserve = fake.runtime.sessions.observe.bind(fake.runtime.sessions);
  fake.runtime.sessions.observe = async (...args) => {
    if (args[0] === 's_observation_fails') throw new Error('test observation failure');
    return originalObserve(...args);
  };
  const adapter = new RuntimeHostAdapter({
    mode: 'runtime',
    profileRoot: path.resolve('C:\\isolated-profile'),
    runtimeFactory: async () => fake.runtime,
    identityStore: testIdentityStore,
    runtimeEventParser: testRuntimeEventParser,
  });

  await adapter.initialize();
  await assert.rejects(
    adapter.readSessionLiveSnapshot('s_observation_fails'),
    /test observation failure/,
  );
  const recovered = await adapter.readSessionLiveSnapshot('s_observation_recovers');
  assert.equal(recovered.sessionId, 's_observation_recovers');
  assert.deepEqual(fake.calls.observed, ['s_observation_recovers']);
  await adapter.close();
});

test('concurrent cold reads for one Session share a single observation open', async () => {
  const fake = createFakeRuntime();
  const sessionId = 's_observation_singleflight';
  fake.sessions.add(sessionId);
  const originalObserve = fake.runtime.sessions.observe.bind(fake.runtime.sessions);
  let signalObserveStarted!: () => void;
  const observeStarted = new Promise<void>((resolve) => {
    signalObserveStarted = resolve;
  });
  let releaseObserve!: () => void;
  const observeRelease = new Promise<void>((resolve) => {
    releaseObserve = resolve;
  });
  let starts = 0;
  fake.runtime.sessions.observe = async (...args) => {
    starts += 1;
    signalObserveStarted();
    await observeRelease;
    return originalObserve(...args);
  };
  const adapter = new RuntimeHostAdapter({
    mode: 'runtime',
    profileRoot: path.resolve('C:\\isolated-profile'),
    runtimeFactory: async () => fake.runtime,
    identityStore: testIdentityStore,
    runtimeEventParser: testRuntimeEventParser,
  });

  await adapter.initialize();
  const first = adapter.readSessionLiveSnapshot(sessionId);
  await observeStarted;
  const second = adapter.readSessionLiveSnapshot(sessionId);
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(starts, 1);
  releaseObserve();
  await Promise.all([first, second]);
  assert.deepEqual(fake.calls.observed, [sessionId]);
  await adapter.close();
});

test('a replacement Runtime does not wait for or install a retired observation result', async () => {
  const first = createFakeRuntime('rt_observation_old');
  const second = createFakeRuntime('rt_observation_new');
  const sessionId = 's_observation_replacement';
  first.sessions.add(sessionId);
  second.sessions.add(sessionId);
  const originalObserve = first.runtime.sessions.observe.bind(first.runtime.sessions);
  let signalOldObserveReady!: () => void;
  const oldObserveReady = new Promise<void>((resolve) => {
    signalOldObserveReady = resolve;
  });
  let releaseOldObserve!: () => void;
  const oldObserveRelease = new Promise<void>((resolve) => {
    releaseOldObserve = resolve;
  });
  first.runtime.sessions.observe = async (...args) => {
    const observation = await originalObserve(...args);
    signalOldObserveReady();
    await oldObserveRelease;
    return observation;
  };
  let factoryCalls = 0;
  const adapter = new RuntimeHostAdapter({
    mode: 'runtime',
    profileRoot: path.resolve('C:\\isolated-profile'),
    runtimeFactory: async () => (factoryCalls++ === 0 ? first.runtime : second.runtime),
    identityStore: testIdentityStore,
    runtimeEventParser: testRuntimeEventParser,
  });

  await adapter.initialize();
  const staleRead = adapter.readSessionLiveSnapshot(sessionId);
  await oldObserveReady;
  first.disconnect();
  await waitForTest(() => adapter.snapshot().state === 'uninitialized');
  await adapter.initialize();
  const fresh = await adapter.readSessionLiveSnapshot(sessionId);
  assert.equal(fresh.cursor.runtimeId, 'rt_observation_new');

  releaseOldObserve();
  await assert.rejects(staleRead, /connection changed/i);
  assert.equal(adapter.snapshot().identity?.runtimeId, 'rt_observation_new');
  await adapter.close();
});

test('a quiescent live snapshot read retires observation and reuses its terminal cache', async () => {
  let persistedReads = 0;
  setSessionStoreImpl({
    listSessions: async () => [],
    forkSession: async () => null,
    rewindSession: async () => null,
    deleteSession: async () => ({ ok: true }),
    loadSession: async (sessionId) => {
      persistedReads += 1;
      return { sessionId, title: '', messages: [], gitRoot: 'C:\\repo', tag: 'code' } as never;
    },
    watchSessions: () => ({ close() {} }),
  } as SessionStoreImpl);
  const fake = createFakeRuntime();
  fake.sessions.add('s_terminal_cache');
  const adapter = new RuntimeHostAdapter({
    mode: 'runtime',
    profileRoot: path.resolve('C:\\isolated-profile'),
    runtimeFactory: async () => fake.runtime,
    identityStore: testIdentityStore,
    runtimeEventParser: testRuntimeEventParser,
  });

  await adapter.initialize();
  assert.equal((await adapter.readSessionLiveSnapshot('s_terminal_cache')).activeRun, undefined);
  assert.equal(fake.calls.observationCloses, 1);
  persistedReads = 0;
  assert.equal((await adapter.readSessionLiveSnapshot('s_terminal_cache')).activeRun, undefined);
  assert.equal(persistedReads, 0, 'fresh Runtime profile ownership avoids persisted history');
  assert.deepEqual(fake.calls.observed, ['s_terminal_cache']);
  await adapter.close();
});

test('cached idle snapshot ownership rejects an external retag without a profile refresh', async () => {
  const records = new Map<string, Readonly<Record<string, unknown>>>([
    ['s_cached_retag', { title: '', messages: [], gitRoot: 'C:\\repo', tag: 'code' }],
  ]);
  let notifySessionChange:
    | ((event: { kind: 'change' | 'add' | 'remove'; sessionId: string }) => void)
    | undefined;
  setSessionStoreImpl({
    listSessions: async () => [],
    forkSession: async () => null,
    rewindSession: async () => null,
    deleteSession: async () => ({ ok: true }),
    loadSession: async (sessionId) => (records.get(sessionId) ?? null) as never,
    watchSessions: (callback) => {
      notifySessionChange = callback;
      return { close() {} };
    },
  } as SessionStoreImpl);
  const fake = createFakeRuntime();
  fake.sessions.add('s_cached_retag');
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

  await adapter.initialize();
  await adapter.readSessionLiveSnapshot('s_cached_retag');
  records.set('s_cached_retag', {
    title: '',
    messages: [],
    gitRoot: 'C:\\repo',
    tag: 'partner',
  });
  notifySessionChange?.({ kind: 'change', sessionId: 's_cached_retag' });

  await assert.rejects(
    adapter.readSessionLiveSnapshot('s_cached_retag'),
    (error: unknown) =>
      error instanceof Error &&
      (error as Error & { code?: string }).code === 'session_identity_conflict',
  );
  assert.equal(fake.calls.observationCloses, 1);
  assert.throws(
    () => controller.sessionLiveSnapshot('s_cached_retag'),
    RuntimeProjectionUnavailableError,
  );
  await adapter.close();
});

test('a Runtime profile read refreshes status instead of returning a stale main cache', async () => {
  const fake = createFakeRuntime();
  fake.sessions.add('s_profile_refresh');
  const originalSnapshot = fake.runtime.status.snapshot.bind(fake.runtime.status);
  let active = true;
  let snapshotReads = 0;
  fake.runtime.status.snapshot = async () => {
    snapshotReads += 1;
    return {
      ...(await originalSnapshot()),
      runs: active
        ? [
            {
              runId: 'run_profile_refresh',
              sessionId: 's_profile_refresh',
              phase: 'running' as const,
              provider: 'mock',
              mode: 'managed_task' as const,
              startedAt: '2026-08-05T01:00:00.000Z',
            },
          ]
        : [],
    };
  };
  const adapter = new RuntimeHostAdapter({
    mode: 'runtime',
    profileRoot: path.resolve('C:\\isolated-profile'),
    runtimeFactory: async () => fake.runtime,
    identityStore: testIdentityStore,
    runtimeEventParser: testRuntimeEventParser,
  });

  await adapter.initialize();
  assert.equal(
    (await adapter.readRuntimeProfileSnapshot()).sessions[0]?.activeRun?.runId,
    'run_profile_refresh',
  );
  active = false;
  assert.equal((await adapter.readRuntimeProfileSnapshot()).sessions[0]?.activeRun, undefined);
  assert.ok(snapshotReads >= 3);
  await adapter.close();
});

test('out-of-page active profile rows require persisted Coder identity proof', async () => {
  const records = new Map<string, Readonly<Record<string, unknown>>>([
    ['s_out_of_page_coder', { title: '', messages: [], gitRoot: 'C:\\repo', tag: 'code' }],
    ['s_out_of_page_partner', { title: '', messages: [], gitRoot: 'C:\\repo', tag: 'partner' }],
  ]);
  let persistedReads = 0;
  setSessionStoreImpl({
    listSessions: async () => [],
    forkSession: async () => null,
    rewindSession: async () => null,
    deleteSession: async () => ({ ok: true }),
    loadSession: async (sessionId) => {
      persistedReads += 1;
      return (records.get(sessionId) as never) ?? null;
    },
    watchSessions: () => ({ close() {} }),
  } as SessionStoreImpl);
  const fake = createFakeRuntime();
  fake.runtime.status.snapshot = async () => ({
    runtimeId: 'rt_test',
    mode: 'daemon',
    profile: 'coder',
    startedAt: '2026-08-05T01:00:00.000Z',
    sessions: [],
    runs: [
      {
        runId: 'run_out_of_page_coder',
        sessionId: 's_out_of_page_coder',
        phase: 'running',
        provider: 'mock',
        startedAt: '2026-08-05T01:00:01.000Z',
      },
      {
        runId: 'run_out_of_page_partner',
        sessionId: 's_out_of_page_partner',
        phase: 'running',
        provider: 'mock',
        startedAt: '2026-08-05T01:00:02.000Z',
      },
    ],
    pendingPermissions: [],
    workflows: [],
  });
  const adapter = new RuntimeHostAdapter({
    mode: 'runtime',
    profileRoot: path.resolve('C:\\isolated-profile'),
    runtimeFactory: async () => fake.runtime,
    identityStore: testIdentityStore,
    runtimeEventParser: testRuntimeEventParser,
  });

  await adapter.initialize();
  assert.deepEqual(
    (await adapter.readRuntimeProfileSnapshot()).sessions.map((session) => session.sessionId),
    ['s_out_of_page_coder'],
  );
  assert.equal(
    persistedReads,
    2,
    'the exact active Run proof is reused instead of rereading an actively written Session',
  );
  await adapter.close();
});

test('a newer profile terminal invalidates an older retired live cache', async () => {
  const fake = createFakeRuntime();
  fake.sessions.add('s_terminal_advanced');
  const originalSnapshot = fake.runtime.status.snapshot.bind(fake.runtime.status);
  let terminalAdvanced = false;
  fake.runtime.status.snapshot = async () => ({
    ...(await originalSnapshot()),
    runs: terminalAdvanced
      ? [
          {
            runId: 'run_new_terminal',
            sessionId: 's_terminal_advanced',
            phase: 'completed' as const,
            provider: 'mock',
            mode: 'managed_task' as const,
            startedAt: '2026-08-05T01:00:00.000Z',
            endedAt: '2026-08-05T01:00:01.000Z',
          },
        ]
      : [],
  });
  const adapter = new RuntimeHostAdapter({
    mode: 'runtime',
    profileRoot: path.resolve('C:\\isolated-profile'),
    runtimeFactory: async () => fake.runtime,
    identityStore: testIdentityStore,
    runtimeEventParser: testRuntimeEventParser,
  });

  await adapter.initialize();
  await adapter.readSessionLiveSnapshot('s_terminal_advanced');
  assert.equal(fake.calls.observationCloses, 1);
  terminalAdvanced = true;
  assert.equal(
    (await adapter.readRuntimeProfileSnapshot()).sessions[0]?.lastTerminalRun?.runId,
    'run_new_terminal',
  );
  await adapter.readSessionLiveSnapshot('s_terminal_advanced');
  assert.deepEqual(fake.calls.observed, ['s_terminal_advanced', 's_terminal_advanced']);
  await adapter.close();
});

test('run status and Stop bypass a history boundary that is busy with active Session writes', async () => {
  setSessionStoreImpl({
    listSessions: async () => [],
    forkSession: async () => null,
    rewindSession: async () => null,
    deleteSession: async () => ({ ok: true }),
    loadSession: async () => {
      throw Object.assign(new Error('Session data changed during the read boundary: active.lock'), {
        code: 'data_changed',
      });
    },
    watchSessions: () => ({ close() {} }),
  } as SessionStoreImpl);
  const fake = createFakeRuntime();
  fake.sessions.add('s_1');
  fake.sessionStatuses.set('s_1', {
    sessionId: 's_1',
    runtimeId: 'rt_test',
    phase: 'running',
    observedAt: '2026-08-01T04:00:00.000Z',
    runId: 'run_active_writer',
  });
  fake.runtime.runs.list = async () => [
    {
      runId: 'run_active_writer',
      sessionId: 's_1',
      phase: 'running',
      provider: 'mock',
      mode: 'managed_task',
      startedAt: '2026-08-01T04:00:00.000Z',
    },
  ];
  const adapter = new RuntimeHostAdapter({
    mode: 'runtime',
    profileRoot: path.resolve('C:\\isolated-profile'),
    runtimeFactory: async () => fake.runtime,
    identityStore: testIdentityStore,
  });

  await adapter.initialize();
  assert.equal(await adapter.findActiveRunId('s_1'), 'run_active_writer');
  const receipt = await adapter.abortSessionRun('s_1');

  assert.equal(receipt?.runId, 'run_active_writer');
  assert.deepEqual(fake.calls.aborted, ['run_active_writer']);
  assert.deepEqual(fake.calls.loaded, []);
  await adapter.close();
});

test('an exact Run Stop never retargets through the Session run list', async () => {
  const fake = createFakeRuntime();
  fake.sessions.add('s_1');
  fake.runtime.runs.list = async () => {
    throw new Error('exact Stop must not resolve a replacement Run');
  };
  const adapter = new RuntimeHostAdapter({
    mode: 'runtime',
    profileRoot: path.resolve('C:\\isolated-profile'),
    runtimeFactory: async () => fake.runtime,
    identityStore: testIdentityStore,
  });

  const receipt = await adapter.abortSessionRun('s_1', 'run_visible');

  assert.equal(receipt?.runId, 'run_visible');
  assert.deepEqual(fake.calls.aborted, ['run_visible']);
  await adapter.close();
});

test('an exact queued Run Stop does not abort or retarget the active Run', async () => {
  const fake = createFakeRuntime();
  fake.sessions.add('s_1');
  fake.runtime.runs.get = async (runId: string) => ({
    runId,
    sessionId: 's_1',
    phase: 'queued' as const,
    provider: 'mock',
    startedAt: '2026-08-09T00:00:00.000Z',
  });
  fake.runtime.runs.list = async () => {
    throw new Error('exact queued Stop must not retarget the active Run');
  };
  const adapter = new RuntimeHostAdapter({
    mode: 'runtime',
    profileRoot: path.resolve('C:\\isolated-profile'),
    runtimeFactory: async () => fake.runtime,
    identityStore: testIdentityStore,
  });

  const receipt = await adapter.abortSessionRun('s_1', 'run_queued');

  assert.equal(receipt, undefined);
  assert.deepEqual(fake.calls.aborted, []);
  await adapter.close();
});

test('an exact unknown active Run Stop remains deliverable', async () => {
  const fake = createFakeRuntime();
  fake.sessions.add('s_1');
  fake.runtime.runs.get = async (runId: string) => ({
    runId,
    sessionId: 's_1',
    phase: 'unknown' as const,
    provider: 'mock',
    startedAt: '2026-08-09T00:00:00.000Z',
  });
  const adapter = new RuntimeHostAdapter({
    mode: 'runtime',
    profileRoot: path.resolve('C:\\isolated-profile'),
    runtimeFactory: async () => fake.runtime,
    identityStore: testIdentityStore,
  });

  const receipt = await adapter.abortSessionRun('s_1', 'run_unknown');

  assert.equal(receipt?.accepted, true);
  assert.deepEqual(fake.calls.aborted, ['run_unknown']);
  await adapter.close();
});

test('an exact Run Stop rejects a foreign Session before aborting it', async () => {
  const fake = createFakeRuntime();
  fake.sessions.add('s_1');
  fake.runtime.runs.get = async (runId: string) => ({
    runId,
    sessionId: 's_other',
    phase: 'running' as const,
    provider: 'mock',
    startedAt: '2026-08-09T00:00:00.000Z',
  });
  const adapter = new RuntimeHostAdapter({
    mode: 'runtime',
    profileRoot: path.resolve('C:\\isolated-profile'),
    runtimeFactory: async () => fake.runtime,
    identityStore: testIdentityStore,
  });

  await assert.rejects(
    adapter.abortSessionRun('s_1', 'run_foreign'),
    /different Session identity/i,
  );

  assert.deepEqual(fake.calls.aborted, []);
  await adapter.close();
});

test('an active observation is positive Stop evidence without waiting for its event queue', async () => {
  const fake = createFakeRuntime();
  fake.sessions.add('s_active_observed');
  const originalObserve = fake.runtime.sessions.observe.bind(fake.runtime.sessions);
  fake.runtime.sessions.observe = async (...args) => {
    const observation = await originalObserve(...args);
    return {
      ...observation,
      snapshot: {
        ...observation.snapshot,
        runs: [
          {
            runId: 'run_active_observed',
            sessionId: 's_active_observed',
            phase: 'running' as const,
            provider: 'mock',
            mode: 'managed_task' as const,
            startedAt: '2026-08-05T01:00:00.000Z',
          },
        ],
      },
    };
  };
  fake.runtime.sessions.status = async () => {
    throw new Error('active observation should avoid a redundant status read');
  };
  const adapter = new RuntimeHostAdapter({
    mode: 'runtime',
    profileRoot: path.resolve('C:\\isolated-profile'),
    runtimeFactory: async () => fake.runtime,
    identityStore: testIdentityStore,
    runtimeEventParser: testRuntimeEventParser,
  });

  await adapter.initialize();
  await adapter.ensureObserved('s_active_observed');
  const state = (
    adapter as unknown as {
      observations: Map<string, { eventQueue: Promise<void> }>;
    }
  ).observations.get('s_active_observed');
  assert.ok(state);
  state.eventQueue = new Promise<void>(() => undefined);

  assert.equal(await adapter.findActiveRunId('s_active_observed'), 'run_active_observed');
  assert.deepEqual(fake.calls.sessionStatuses, []);
  await adapter.close();
});

test('an idle observation confirms negative active-Run evidence through the run index', async () => {
  const fake = createFakeRuntime();
  fake.sessions.add('s_observed_idle');
  fake.runtime.sessions.status = async () => {
    throw Object.assign(new Error('idle observation should avoid canonical Session status'), {
      code: 'data_changed',
    });
  };
  let lateActiveRun = false;
  let runIndexReads = 0;
  fake.runtime.runs.list = async () => {
    runIndexReads += 1;
    return lateActiveRun
      ? [
          {
            runId: 'run_admitted_after_idle_cursor',
            sessionId: 's_observed_idle',
            phase: 'running' as const,
            provider: 'mock',
            mode: 'managed_task' as const,
            startedAt: '2026-08-05T12:00:00.000Z',
          },
        ]
      : [];
  };
  const adapter = new RuntimeHostAdapter({
    mode: 'runtime',
    profileRoot: path.resolve('C:\\isolated-profile'),
    runtimeFactory: async () => fake.runtime,
    identityStore: testIdentityStore,
    runtimeEventParser: testRuntimeEventParser,
  });

  await adapter.initialize();
  await adapter.ensureObserved('s_observed_idle');

  assert.equal(await adapter.findActiveRunId('s_observed_idle'), undefined);
  lateActiveRun = true;
  assert.equal(await adapter.findActiveRunId('s_observed_idle'), 'run_admitted_after_idle_cursor');
  assert.equal(runIndexReads, 2);
  assert.deepEqual(fake.calls.sessionStatuses, []);
  await adapter.close();
});

test('a queued run.started event is positive evidence before its event handler settles', async () => {
  const fake = createFakeRuntime();
  fake.sessions.add('s_queued_run_event');
  fake.runtime.sessions.status = async () => {
    throw Object.assign(new Error('queued run event should avoid canonical Session status'), {
      code: 'data_changed',
    });
  };
  const adapter = new RuntimeHostAdapter({
    mode: 'runtime',
    profileRoot: path.resolve('C:\\isolated-profile'),
    runtimeFactory: async () => fake.runtime,
    identityStore: testIdentityStore,
    runtimeEventParser: testRuntimeEventParser,
  });

  await adapter.initialize();
  await adapter.ensureObserved('s_queued_run_event');
  const observed = (
    adapter as unknown as {
      observations: Map<string, { eventQueue: Promise<void> }>;
    }
  ).observations.get('s_queued_run_event');
  assert.ok(observed);
  observed.eventQueue = new Promise<void>(() => undefined);
  fake.emit({
    id: 'event_queued_run_started',
    seq: 1,
    time: '2026-08-05T10:00:00.000Z',
    type: 'run.started',
    sessionId: 's_queued_run_event',
    runId: 'run_queued_event',
    payload: {
      runId: 'run_queued_event',
      sessionId: 's_queued_run_event',
      phase: 'running',
      provider: 'anthropic',
      mode: 'managed_task',
      startedAt: '2026-08-05T10:00:00.000Z',
    },
  });

  assert.equal(await adapter.findActiveRunId('s_queued_run_event'), 'run_queued_event');
  assert.deepEqual(fake.calls.sessionStatuses, []);
  await adapter.close();
});

test('Stop reports Runtime unavailability instead of claiming that no active Run exists', async () => {
  const adapter = new RuntimeHostAdapter({
    mode: 'runtime',
    profileRoot: path.resolve('C:\\isolated-profile'),
    runtimeFactory: async () => {
      throw new Error('daemon unavailable');
    },
    identityStore: testIdentityStore,
  });

  await assert.rejects(adapter.abortSessionRun('s_unavailable'), /daemon unavailable/i);
  await adapter.close();
});

test('run status and Stop reject cross-Session daemon identities before any side effect', async () => {
  const fake = createFakeRuntime();
  fake.sessions.add('s_1');
  fake.sessionStatuses.set('s_1', {
    sessionId: 's_other',
    runtimeId: 'rt_test',
    phase: 'running',
    observedAt: '2026-08-01T04:00:00.000Z',
    runId: 'run_other',
  });
  const adapter = new RuntimeHostAdapter({
    mode: 'runtime',
    profileRoot: path.resolve('C:\\isolated-profile'),
    runtimeFactory: async () => fake.runtime,
    identityStore: testIdentityStore,
  });

  await adapter.initialize();
  await assert.rejects(adapter.findActiveRunId('s_1'), /different Session identity/i);

  fake.runtime.runs.list = async () => [
    {
      runId: 'run_other',
      sessionId: 's_other',
      phase: 'running',
      provider: 'mock',
      mode: 'managed_task',
      startedAt: '2026-08-01T04:00:00.000Z',
    },
  ];
  await assert.rejects(adapter.abortSessionRun('s_1'), /different Session identity/i);
  assert.deepEqual(fake.calls.aborted, []);

  await adapter.close();
});

test('ensureSession prefers workspaceRoot and falls back to gitRoot for project identity', async () => {
  installPersistedSessionLookup();
  const fake = createFakeRuntime();
  const workspaceRoot = path.resolve('fixtures', 'repo', 'app');
  const gitRoot = path.dirname(workspaceRoot);
  fake.sessions.add('s_workspace');
  fake.sessionRecords.set('s_workspace', {
    id: 's_workspace',
    title: '',
    workspaceRoot: `${workspaceRoot}${path.sep}`,
    gitRoot,
    surface: 'space-desktop',
  });
  fake.sessions.add('s_git_only');
  fake.sessionRecords.set('s_git_only', {
    id: 's_git_only',
    title: '',
    gitRoot,
    surface: 'space-desktop',
  });
  const adapter = new RuntimeHostAdapter({
    mode: 'runtime',
    profileRoot: path.resolve('C:\\isolated-profile'),
    runtimeFactory: async () => fake.runtime,
    identityStore: testIdentityStore,
  });

  assert.equal(
    await adapter.ensureSession({
      sessionId: 's_workspace',
      projectRoot: workspaceRoot,
      surface: 'code',
      ephemeral: false,
    }),
    false,
  );
  assert.equal(
    await adapter.ensureSession({
      sessionId: 's_git_only',
      projectRoot: gitRoot,
      surface: 'code',
      ephemeral: false,
    }),
    false,
  );
});

test('ensureSession admits an active verified profile without crossing its persisted writer', async () => {
  let persistedReads = 0;
  setSessionStoreImpl({
    listSessions: async () => [],
    forkSession: async () => null,
    rewindSession: async () => null,
    deleteSession: async () => ({ ok: true }),
    loadSession: async () => {
      persistedReads += 1;
      throw Object.assign(new Error('active Session writer'), { code: 'data_changed' });
    },
    watchSessions: () => ({ close() {} }),
  } as SessionStoreImpl);
  const fake = createFakeRuntime();
  fake.sessions.add('s_active_profile');
  fake.sessionRecords.set('s_active_profile', {
    id: 's_active_profile',
    title: '',
    workspaceRoot: 'C:\\repo',
    gitRoot: 'C:\\repo',
    surface: 'code',
  });
  const originalSnapshot = fake.runtime.status.snapshot.bind(fake.runtime.status);
  fake.runtime.status.snapshot = async () => ({
    ...(await originalSnapshot()),
    runs: [
      {
        runId: 'run_active_profile',
        sessionId: 's_active_profile',
        phase: 'running' as const,
        provider: 'mock',
        mode: 'managed_task' as const,
        startedAt: '2026-08-05T01:00:00.000Z',
      },
    ],
  });
  const adapter = new RuntimeHostAdapter({
    mode: 'runtime',
    profileRoot: path.resolve('C:\\isolated-profile'),
    runtimeFactory: async () => fake.runtime,
    identityStore: testIdentityStore,
  });

  await adapter.initialize();
  assert.equal(
    await adapter.ensureSession({
      sessionId: 's_active_profile',
      projectRoot: 'C:\\repo',
      surface: 'code',
      ephemeral: false,
    }),
    false,
  );
  assert.equal(persistedReads, 0);
  await adapter.close();
});

test('ensureSession fails closed when an existing Session has no project identity', async () => {
  installPersistedSessionLookup();
  const fake = createFakeRuntime();
  fake.sessions.add('s_legacy_missing_root');
  fake.sessionRecords.set('s_legacy_missing_root', {
    id: 's_legacy_missing_root',
    title: '',
    surface: 'space-desktop',
  });
  const adapter = new RuntimeHostAdapter({
    mode: 'runtime',
    profileRoot: path.resolve('C:\\isolated-profile'),
    runtimeFactory: async () => fake.runtime,
    identityStore: testIdentityStore,
  });

  await assert.rejects(
    adapter.ensureSession({
      sessionId: 's_legacy_missing_root',
      projectRoot: 'C:\\repo',
      surface: 'code',
      ephemeral: false,
    }),
    (error: unknown) =>
      error instanceof Error &&
      (error as Error & { code?: string }).code === 'session_identity_conflict' &&
      /no workspaceRoot or gitRoot/i.test(error.message),
  );
});

test('ensureSession reloads and validates a matching concurrent create conflict', async () => {
  installPersistedSessionLookup();
  const fake = createFakeRuntime();
  const sessions = fake.runtime.sessions as unknown as {
    create(input: { sessionId?: string }): Promise<RuntimeSession>;
  };
  sessions.create = async (input) => {
    const sessionId = input.sessionId ?? 's_race';
    fake.sessions.add(sessionId);
    fake.sessionRecords.set(sessionId, {
      id: sessionId,
      title: '',
      workspaceRoot: 'C:\\repo',
      gitRoot: 'C:\\repo',
      surface: 'space-desktop',
    });
    throw Object.assign(new Error(`Session already exists: ${sessionId}`), { code: 'conflict' });
  };
  const adapter = new RuntimeHostAdapter({
    mode: 'runtime',
    profileRoot: path.resolve('C:\\isolated-profile'),
    runtimeFactory: async () => fake.runtime,
    identityStore: testIdentityStore,
  });

  assert.equal(
    await adapter.ensureSession({
      sessionId: 's_race',
      projectRoot: 'C:\\repo',
      surface: 'code',
      ephemeral: false,
    }),
    false,
  );
  assert.deepEqual(fake.calls.loaded, ['s_race', 's_race']);
});

test('ensureSession rejects a mismatching concurrent create conflict', async () => {
  installPersistedSessionLookup();
  const fake = createFakeRuntime();
  const sessions = fake.runtime.sessions as unknown as {
    create(input: { sessionId?: string }): Promise<RuntimeSession>;
  };
  sessions.create = async (input) => {
    const sessionId = input.sessionId ?? 's_race_mismatch';
    fake.sessions.add(sessionId);
    fake.sessionRecords.set(sessionId, {
      id: sessionId,
      title: '',
      workspaceRoot: 'C:\\other-repo',
      gitRoot: 'C:\\other-repo',
      surface: 'space-desktop',
    });
    throw Object.assign(new Error(`Session already exists: ${sessionId}`), { code: 'conflict' });
  };
  const adapter = new RuntimeHostAdapter({
    mode: 'runtime',
    profileRoot: path.resolve('C:\\isolated-profile'),
    runtimeFactory: async () => fake.runtime,
    identityStore: testIdentityStore,
  });

  await assert.rejects(
    adapter.ensureSession({
      sessionId: 's_race_mismatch',
      projectRoot: 'C:\\repo',
      surface: 'code',
      ephemeral: false,
    }),
    (error: unknown) =>
      error instanceof Error &&
      (error as Error & { code?: string }).code === 'session_identity_conflict',
  );
});

test('session recovery uses authoritative status and support diagnostics without a durable load', async () => {
  const fake = createFakeRuntime();
  fake.sessions.add('s_recovery');
  fake.sessionStatuses.set('s_recovery', {
    sessionId: 's_recovery',
    runtimeId: 'rt_test',
    phase: 'running',
    observedAt: '2026-07-12T00:00:00.000Z',
    runId: 'run_recovery',
  });
  const adapter = new RuntimeHostAdapter({
    mode: 'runtime',
    profileRoot: path.resolve('C:\\isolated-profile'),
    runtimeFactory: async () => fake.runtime,
    identityStore: testIdentityStore,
  });

  assert.equal(await adapter.findActiveRunId('s_recovery'), 'run_recovery');
  const diagnostic = await adapter.diagnoseSession({
    sessionId: 's_recovery',
    runId: 'run_recovery',
    timeoutMs: 1_000,
  });
  assert.equal(diagnostic.run.phase, 'running');
  assert.equal(diagnostic.run.stage, 'executing');
  assert.deepEqual(fake.calls.loaded, []);
  assert.deepEqual(fake.calls.sessionStatuses, ['s_recovery']);
  assert.deepEqual(fake.calls.sessionDiagnostics, [
    { sessionId: 's_recovery', runId: 'run_recovery', timeoutMs: 1_000 },
  ]);

  fake.sessionStatuses.set('s_recovery', {
    sessionId: 's_recovery',
    runtimeId: 'rt_test',
    phase: 'completed',
    observedAt: '2026-07-12T00:00:01.000Z',
    runId: 'run_recovery',
  });
  assert.equal(await adapter.findActiveRunId('s_recovery'), undefined);

  fake.sessionStatuses.set('s_recovery', {
    sessionId: 's_recovery',
    runtimeId: 'rt_test',
    phase: 'unknown',
    observedAt: '2026-07-12T00:00:02.000Z',
  });
  await assert.rejects(
    adapter.findActiveRunId('s_recovery'),
    /reported unknown.*without a Run identity/i,
  );
});

test('managed run tracking aborts the active Runtime run and close is idempotent', async () => {
  installPersistedSessionLookup();
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
  const receipt = await adapter.abortSessionRun('s_1');
  assert.deepEqual(fake.calls.aborted, ['run_1']);
  assert.deepEqual(receipt, {
    runId: 'run_1',
    sessionId: 's_1',
    accepted: true,
    state: 'confirmed',
    outcome: 'cancelled',
    phase: 'cancelled',
    revision: 1,
  });
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
  let signalFactoryStarted: (() => void) | undefined;
  const factoryStarted = new Promise<void>((resolve) => {
    signalFactoryStarted = resolve;
  });
  const adapter = new RuntimeHostAdapter({
    mode: 'runtime',
    profileRoot: path.resolve('C:\\isolated-profile'),
    runtimeFactory: () =>
      new Promise<KodaXDaemonRuntime>((resolve) => {
        releaseFactory = resolve;
        signalFactoryStarted?.();
      }),
    identityStore: testIdentityStore,
  });

  const initialization = adapter.initialize();
  await factoryStarted;
  const closing = adapter.close();
  assert.ok(releaseFactory);
  releaseFactory(fake.runtime);
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

test('initialization accepts any Runtime identity version that negotiates required capabilities', async () => {
  const fake = createFakeRuntime();
  (fake.runtime.identity as { version: string }).version = '0.7.77';
  const adapter = new RuntimeHostAdapter({
    mode: 'runtime',
    profileRoot: path.resolve('C:\\isolated-profile'),
    runtimeFactory: async () => fake.runtime,
    identityStore: testIdentityStore,
  });

  await adapter.initialize();
  assert.equal(adapter.snapshot().state, 'ready');
  assert.equal(adapter.snapshot().identity?.version, '0.7.77');
  await adapter.close();
});

test('initialization requires the dedicated orphan-exit capability instead of a version proxy', async () => {
  const fake = createFakeRuntime();
  delete (fake.runtime.capabilities as Record<string, unknown>).daemonOrphanExit;
  const adapter = new RuntimeHostAdapter({
    mode: 'runtime',
    profileRoot: path.resolve('C:\\isolated-profile'),
    runtimeFactory: async () => fake.runtime,
    identityStore: testIdentityStore,
  });

  await assert.rejects(adapter.initialize(), /daemonOrphanExit v1/i);
  assert.equal(adapter.snapshot().state, 'failed');
  assert.equal(fake.calls.close, 1);
});

test('buffered Runtime events become visible before Actor bootstrap can block observation', async () => {
  const fake = createFakeRuntime();
  fake.sessions.add('s_buffered_before_actor');
  const originalObserve = fake.runtime.sessions.observe.bind(fake.runtime.sessions);
  fake.runtime.sessions.observe = async (...args) => {
    const observation = await originalObserve(...args);
    args[1]?.(
      withTestRuntimeCursor({
        id: 'evt_buffered_before_actor',
        seq: 1,
        time: '2026-08-05T12:00:00.000Z',
        sessionId: 's_buffered_before_actor',
        runId: 'run_buffered_before_actor',
        type: 'run.started',
        payload: {
          runId: 'run_buffered_before_actor',
          sessionId: 's_buffered_before_actor',
          phase: 'running',
          startedAt: '2026-08-05T12:00:00.000Z',
          provider: 'mock',
        },
      }),
    );
    return observation;
  };
  const agents = fake.runtime.agents as unknown as {
    tree(sessionId: string): Promise<AgentTreeSnapshot>;
  };
  const originalTree = agents.tree.bind(agents);
  let signalTreeStarted!: () => void;
  const treeStarted = new Promise<void>((resolve) => {
    signalTreeStarted = resolve;
  });
  let releaseTree!: () => void;
  const treeRelease = new Promise<void>((resolve) => {
    releaseTree = resolve;
  });
  agents.tree = async (sessionId) => {
    signalTreeStarted();
    await treeRelease;
    return originalTree(sessionId);
  };
  const adapter = new RuntimeHostAdapter({
    mode: 'runtime',
    profileRoot: path.resolve('C:\\isolated-profile'),
    runtimeFactory: async () => fake.runtime,
    identityStore: testIdentityStore,
    runtimeEventParser: testRuntimeEventParser,
  });

  const opening = adapter.ensureObserved('s_buffered_before_actor');
  await treeStarted;
  try {
    const snapshot = await adapter.readSessionLiveSnapshot('s_buffered_before_actor');
    assert.equal(snapshot.activeRun?.runId, 'run_buffered_before_actor');
  } finally {
    releaseTree();
    await opening;
    await adapter.close();
  }
});

test('initialization requires source-side Runtime event coalescing', async () => {
  const fake = createFakeRuntime();
  delete (fake.runtime.capabilities as Record<string, unknown>).runtimeEventCoalescing;
  const adapter = new RuntimeHostAdapter({
    mode: 'runtime',
    profileRoot: path.resolve('C:\\isolated-profile'),
    runtimeFactory: async () => fake.runtime,
    identityStore: testIdentityStore,
  });

  await assert.rejects(adapter.initialize(), /runtimeEventCoalescing v1/i);
  assert.equal(adapter.snapshot().state, 'failed');
  assert.equal(fake.calls.close, 1);
});

test('initialization requires Session-scoped Runtime event journals', async () => {
  const fake = createFakeRuntime();
  delete (fake.runtime.capabilities as Record<string, unknown>).sessionEventJournal;
  const adapter = new RuntimeHostAdapter({
    mode: 'runtime',
    profileRoot: path.resolve('C:\\isolated-profile'),
    runtimeFactory: async () => fake.runtime,
    identityStore: testIdentityStore,
  });

  await assert.rejects(adapter.initialize(), /sessionEventJournal v1/i);
  assert.equal(adapter.snapshot().state, 'failed');
  assert.equal(fake.calls.close, 1);
});

test('initialization requires SDK-owned live output segment semantics', async () => {
  const fake = createFakeRuntime();
  delete (fake.runtime.capabilities as Record<string, unknown>).liveOutputSegments;
  const adapter = new RuntimeHostAdapter({
    mode: 'runtime',
    profileRoot: path.resolve('C:\\isolated-profile'),
    runtimeFactory: async () => fake.runtime,
    identityStore: testIdentityStore,
  });

  await assert.rejects(adapter.initialize(), /liveOutputSegments v1/i);
  assert.equal(adapter.snapshot().state, 'failed');
  assert.equal(fake.calls.close, 1);
});

test('initialization requires crash outcome convergence v2', async () => {
  const fake = createFakeRuntime();
  (fake.runtime.capabilities as Record<string, unknown>).crashOutcomeModel = { version: 1 };
  const adapter = new RuntimeHostAdapter({
    mode: 'runtime',
    profileRoot: path.resolve('C:\\isolated-profile'),
    runtimeFactory: async () => fake.runtime,
    identityStore: testIdentityStore,
  });

  await assert.rejects(adapter.initialize(), /crashOutcomeModel v2/i);
  assert.equal(adapter.snapshot().state, 'failed');
  assert.equal(fake.calls.close, 1);
});

test('initialization requires the sandbox v6 native-token lifecycle', async () => {
  const fake = createFakeRuntime();
  (fake.runtime.capabilities as Record<string, unknown>).sandboxRuntime = {
    version: 5,
    asrtVersion: '0.0.65',
    backend: 'windows-restricted-user',
  };
  const adapter = new RuntimeHostAdapter({
    mode: 'runtime',
    profileRoot: path.resolve('C:\\isolated-profile'),
    runtimeFactory: async () => fake.runtime,
    identityStore: testIdentityStore,
  });

  await assert.rejects(adapter.initialize(), /sandboxRuntime v6/i);
  assert.equal(adapter.snapshot().state, 'failed');
  assert.equal(fake.calls.close, 1);
});

test('initialization requires topology-safe SDK-owned ordinary conversation history', async () => {
  const fake = createFakeRuntime();
  delete (fake.runtime.capabilities as Record<string, unknown>).conversationHistory;
  const adapter = new RuntimeHostAdapter({
    mode: 'runtime',
    profileRoot: path.resolve('C:\\isolated-profile'),
    runtimeFactory: async () => fake.runtime,
    identityStore: testIdentityStore,
  });

  await assert.rejects(adapter.initialize(), /conversationHistory v2/i);
  assert.equal(adapter.snapshot().state, 'failed');
  assert.equal(fake.calls.close, 1);
});

test('initialization rejects the legacy conversation history contract', async () => {
  const fake = createFakeRuntime();
  (fake.runtime.capabilities as Record<string, unknown>).conversationHistory = {
    version: 1,
    immutablePaging: true,
    revisionedBoundaries: true,
    ambiguityReporting: true,
  };
  const adapter = new RuntimeHostAdapter({
    mode: 'runtime',
    profileRoot: path.resolve('C:\\isolated-profile'),
    runtimeFactory: async () => fake.runtime,
    identityStore: testIdentityStore,
  });

  await assert.rejects(adapter.initialize(), /conversationHistory v2/i);
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

test('session settings reuse the observed version instead of rereading mutable Session history', async () => {
  let rejectPersistedRead = false;
  let persistedReads = 0;
  setSessionStoreImpl({
    listSessions: async () => [],
    forkSession: async () => null,
    rewindSession: async () => null,
    deleteSession: async () => ({ ok: true }),
    loadSession: async (sessionId) => {
      persistedReads += 1;
      if (rejectPersistedRead) {
        throw Object.assign(new Error('active Session writer'), { code: 'data_changed' });
      }
      return { sessionId, title: '', messages: [], gitRoot: 'C:\\repo', tag: 'code' } as never;
    },
    watchSessions: () => ({ close() {} }),
  } as SessionStoreImpl);
  const fake = createFakeRuntime();
  fake.sessions.add('s_observed_settings');
  const shellExecution = {
    version: 1 as const,
    shell: { kind: 'pwsh' as const, executable: 'C:\\Program Files\\PowerShell\\pwsh.exe' },
    environment: { inherit: 'filtered' as const },
  };
  fake.settings.set('s_observed_settings', {
    revision: 7,
    value: {
      provider: 'anthropic',
      shellExecution,
      autoModeClassifierModel: 'anthropic:classifier',
      autoModeTimeoutMs: 20_000,
      autoModeSpeculativeWindowMs: 640,
    },
  });
  let settingsReads = 0;
  fake.runtime.sessions.getSettingsVersioned = async () => {
    settingsReads += 1;
    throw Object.assign(new Error('active Session changed during settings read'), {
      code: 'data_changed',
    });
  };
  const adapter = new RuntimeHostAdapter({
    mode: 'runtime',
    profileRoot: path.resolve('C:\\isolated-profile'),
    runtimeFactory: async () => fake.runtime,
    identityStore: testIdentityStore,
    runtimeEventParser: testRuntimeEventParser,
  });

  await adapter.initialize();
  await adapter.ensureObserved('s_observed_settings');
  const readsAfterObservation = persistedReads;
  rejectPersistedRead = true;
  const observed = (
    adapter as unknown as {
      observations: Map<string, { eventQueue: Promise<void> }>;
    }
  ).observations.get('s_observed_settings');
  assert.ok(observed);
  observed.eventQueue = new Promise<void>(() => undefined);
  await adapter.updateSessionSettings('s_observed_settings', {
    provider: 'anthropic',
    shellExecution: structuredClone(shellExecution),
  });

  assert.equal(settingsReads, 0);
  assert.equal(persistedReads, readsAfterObservation);
  assert.deepEqual(fake.calls.settingsUpdates, []);
  await adapter.close();
});

test('a queued settings event advances the no-op boundary before its handler settles', async () => {
  const fake = createFakeRuntime();
  fake.sessions.add('s_queued_settings');
  const autoModeSettings = {
    autoModeClassifierModel: 'anthropic:classifier',
    autoModeTimeoutMs: 20_000,
    autoModeSpeculativeWindowMs: 640,
  };
  fake.settings.set('s_queued_settings', {
    revision: 7,
    value: { provider: 'anthropic', ...autoModeSettings },
  });
  const adapter = new RuntimeHostAdapter({
    mode: 'runtime',
    profileRoot: path.resolve('C:\\isolated-profile'),
    runtimeFactory: async () => fake.runtime,
    identityStore: testIdentityStore,
    runtimeEventParser: testRuntimeEventParser,
  });

  await adapter.initialize();
  await adapter.ensureObserved('s_queued_settings');
  const observed = (
    adapter as unknown as {
      observations: Map<string, { eventQueue: Promise<void> }>;
    }
  ).observations.get('s_queued_settings');
  assert.ok(observed);
  observed.eventQueue = new Promise<void>(() => undefined);
  fake.settings.set('s_queued_settings', {
    revision: 8,
    value: { provider: 'openai', ...autoModeSettings },
  });
  fake.emit({
    id: 'event_queued_settings_updated',
    seq: 1,
    time: '2026-08-05T10:00:00.000Z',
    type: 'session.settings.updated',
    sessionId: 's_queued_settings',
    runId: 's_queued_settings',
    payload: {
      sessionId: 's_queued_settings',
      revision: 8,
      settings: { provider: 'openai', ...autoModeSettings },
      patch: { provider: 'openai' },
    },
  });

  await adapter.updateSessionSettings('s_queued_settings', { provider: 'anthropic' });

  assert.deepEqual(fake.calls.settingsUpdates, [
    {
      sessionId: 's_queued_settings',
      patch: { provider: 'anthropic' },
      options: { expectedRevision: 8 },
    },
  ]);
  assert.equal(fake.settings.get('s_queued_settings')?.value.provider, 'anthropic');
  await adapter.close();
});

test('a stale snapshot settings task cannot overwrite a newer Runtime revision', async (t) => {
  class NoopRuntimeStore extends SessionRuntimeStore {
    override async set(): Promise<boolean> {
      return true;
    }
  }

  const sessionId = 's_stale_snapshot_settings';
  await kodaxHost.disposeAll();
  setSessionRuntimeStoreForTesting(new NoopRuntimeStore(path.resolve('C:\\unused')));
  t.after(async () => {
    setSessionRuntimeStoreForTesting(null);
    await kodaxHost.disposeAll();
  });
  kodaxHost.createSession({
    existingSessionId: sessionId,
    projectRoot: path.resolve('C:\\project'),
    provider: 'anthropic',
    permissionMode: 'auto',
    autoModeEngine: 'llm',
  });

  const fake = createFakeRuntime('rt_stale_snapshot_settings');
  fake.sessions.add(sessionId);
  fake.settings.set(sessionId, {
    revision: 1,
    value: { provider: 'anthropic', reasoningMode: 'balanced' },
  });
  const adapter = new RuntimeHostAdapter({
    mode: 'runtime',
    profileRoot: path.resolve('C:\\isolated-profile'),
    runtimeFactory: async () => fake.runtime,
    identityStore: testIdentityStore,
    runtimeEventParser: testRuntimeEventParser,
  });

  await adapter.ensureObserved(sessionId);
  const settingsSync = adapter as unknown as {
    recordObservedSettings(
      targetSessionId: string,
      runtime: typeof fake.runtime,
      settings: { revision: number; value: RuntimeSessionSettings },
    ): void;
    syncSpaceSessionSettings(
      runtime: typeof fake.runtime,
      targetSessionId: string,
      revision: number,
      settings: RuntimeSessionSettings,
    ): Promise<void>;
  };
  settingsSync.recordObservedSettings(sessionId, fake.runtime, {
    revision: 2,
    value: { provider: 'openai', reasoningMode: 'deep' },
  });
  await settingsSync.syncSpaceSessionSettings(fake.runtime, sessionId, 2, {
    provider: 'openai',
    reasoningMode: 'deep',
  });
  assert.equal(kodaxHost.get(sessionId)?.provider, 'openai');

  await settingsSync.syncSpaceSessionSettings(fake.runtime, sessionId, 1, {
    provider: 'anthropic',
    reasoningMode: 'balanced',
  });

  assert.equal(kodaxHost.get(sessionId)?.provider, 'openai');
  assert.equal(kodaxHost.get(sessionId)?.reasoningMode, 'max');
  await adapter.close();
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
  assert.deepEqual(fake.calls.loaded, []);
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
  fake.pending.get(handle.runId)?.resolve({
    runId: handle.runId,
    sessionId: 's_1',
    phase: 'completed',
  });
  await handle.result;
  assert.deepEqual(fake.calls.credentialRevokes, ['credential_1']);
});

function testRuntimeDaemonDisconnectError(reconnectable = true): Error & {
  readonly code: 'protocol_closed';
  readonly connectionId: string;
  readonly reconnectable: boolean;
} {
  return Object.assign(new Error('Runtime daemon transport closed.'), {
    name: 'RuntimeDaemonDisconnectError',
    code: 'protocol_closed' as const,
    connectionId: 'connection_test',
    reconnectable,
  });
}

test('an admitted Run resumes by the same runId after reconnect without replaying start', async () => {
  const first = createFakeRuntime('rt_run_recovery_first');
  const replacement = createFakeRuntime('rt_run_recovery_second');
  const sessionId = 's_run_recovery';
  first.sessions.add(sessionId);
  replacement.sessions.add(sessionId);
  let factoryCalls = 0;
  const adapter = new RuntimeHostAdapter({
    mode: 'runtime',
    profileRoot: path.resolve('C:\\isolated-profile'),
    runtimeFactory: async () => (factoryCalls++ === 0 ? first.runtime : replacement.runtime),
    identityStore: testIdentityStore,
    runtimeEventParser: testRuntimeEventParser,
    credentialResolver: async () => 'test-credential',
  });
  const handle = await adapter.startManagedRun({
    sessionId,
    prompt: 'recover this exact run',
    options: { provider: 'anthropic' },
  });
  replacement.runtime.runs.get = async (runId) => {
    replacement.calls.runGets.push(runId);
    return {
      runId,
      sessionId,
      phase: 'interrupted',
      startedAt: '2026-08-21T00:00:00.000Z',
      endedAt: '2026-08-21T00:00:01.000Z',
      provider: 'anthropic',
      terminal: {
        revision: 1,
        kind: 'interrupted',
        code: 'daemon_crashed',
        effectOutcome: 'unknown',
      },
    };
  };
  replacement.runtime.runs.await = async (runId) => {
    replacement.calls.runAwaits.push(runId);
    return {
      runId,
      sessionId,
      phase: 'interrupted',
      terminal: {
        revision: 1,
        kind: 'interrupted',
        code: 'daemon_crashed',
        effectOutcome: 'unknown',
      },
    };
  };

  first.disconnect(true);
  first.pending.get(handle.runId)?.reject(testRuntimeDaemonDisconnectError());

  await assert.doesNotReject(handle.result);
  assert.deepEqual(await handle.result, {
    runId: handle.runId,
    sessionId,
    phase: 'interrupted',
    terminal: {
      revision: 1,
      kind: 'interrupted',
      code: 'daemon_crashed',
      effectOutcome: 'unknown',
    },
  });
  assert.equal(first.calls.started.length, 1);
  assert.deepEqual(replacement.calls.started, []);
  assert.deepEqual(replacement.calls.runGets, [handle.runId]);
  assert.deepEqual(replacement.calls.runAwaits, [handle.runId]);
  await adapter.close();
});

test('non-mock Runtime runs fail closed when Space cannot resolve the exact credential', async () => {
  const fake = createFakeRuntime();
  fake.sessions.add('s_missing_credential');
  const adapter = new RuntimeHostAdapter({
    mode: 'runtime',
    profileRoot: path.resolve('C:\\isolated-profile'),
    runtimeFactory: async () => fake.runtime,
    identityStore: testIdentityStore,
    runtimeEventParser: testRuntimeEventParser,
    credentialResolver: async () => undefined,
  });

  await assert.rejects(
    adapter.startManagedRun({
      sessionId: 's_missing_credential',
      prompt: 'hello',
      options: { provider: 'anthropic' },
    }),
    /no exact Space credential/i,
  );
  assert.equal(fake.calls.credentialRegistrations.length, 0);
  assert.equal(fake.calls.started.length, 0);
  await adapter.close();
});

test('true external env credentials are still bound exactly for a shared Runtime daemon', async () => {
  const fake = createFakeRuntime();
  fake.sessions.add('s_external_credential');
  const adapter = new RuntimeHostAdapter({
    mode: 'runtime',
    profileRoot: path.resolve('C:\\isolated-profile'),
    runtimeFactory: async () => fake.runtime,
    identityStore: testIdentityStore,
    runtimeEventParser: testRuntimeEventParser,
    credentialResolver: async () => 'external-credential',
  });

  await adapter.startManagedRun({
    sessionId: 's_external_credential',
    prompt: 'hello',
    options: { provider: 'anthropic' },
  });

  assert.equal(fake.calls.credentialRegistrations.length, 1);
  const started = fake.calls.started[0] as {
    credential?: { leaseId: string; provider: string };
  };
  assert.deepEqual(started.credential, {
    leaseId: 'credential_1',
    provider: 'anthropic',
  });
  const broker = fake.calls.credentialBrokers[0];
  assert.ok(broker);
  assert.equal(
    await broker({
      provider: 'anthropic',
      sessionId: 's_external_credential',
      runId: 'run_1',
    }),
    'external-credential',
  );
  await adapter.close();
});

test('Run recovery ignores unrelated retryable business failures while transport stays connected', async () => {
  const fake = createFakeRuntime('rt_run_business_failure');
  const sessionId = 's_1';
  fake.sessions.add(sessionId);
  const adapter = new RuntimeHostAdapter({
    mode: 'runtime',
    profileRoot: path.resolve('C:\\isolated-profile'),
    runtimeFactory: async () => fake.runtime,
    identityStore: testIdentityStore,
    runtimeEventParser: testRuntimeEventParser,
    credentialResolver: async () => 'test-credential',
  });
  const handle = await adapter.startManagedRun({
    sessionId,
    prompt: 'surface the provider failure',
    options: { provider: 'anthropic' },
  });
  fake.runtime.runs.await = async (runId) => {
    fake.calls.runAwaits.push(runId);
    return { runId, sessionId, phase: 'completed' };
  };

  fake.pending
    .get(handle.runId)
    ?.reject(
      Object.assign(new Error('Provider retry remains a Run failure.'), { reconnectable: true }),
    );

  await assert.rejects(handle.result, /Provider retry remains a Run failure/);
  assert.deepEqual(fake.calls.runGets, []);
  assert.deepEqual(fake.calls.runAwaits, []);
  await adapter.close();
});

test('Run recovery preserves a typed non-reconnectable disconnect failure', async () => {
  const fake = createFakeRuntime('rt_run_non_reconnectable_disconnect');
  const sessionId = 's_1';
  fake.sessions.add(sessionId);
  const adapter = new RuntimeHostAdapter({
    mode: 'runtime',
    profileRoot: path.resolve('C:\\isolated-profile'),
    runtimeFactory: async () => fake.runtime,
    identityStore: testIdentityStore,
    runtimeEventParser: testRuntimeEventParser,
    credentialResolver: async () => 'test-credential',
  });
  const handle = await adapter.startManagedRun({
    sessionId,
    prompt: 'do not reconnect this run',
    options: { provider: 'anthropic' },
  });

  fake.disconnect(false);
  fake.pending.get(handle.runId)?.reject(testRuntimeDaemonDisconnectError(false));

  await assert.rejects(handle.result, /Runtime daemon transport closed/);
  assert.deepEqual(fake.calls.runGets, []);
  assert.deepEqual(fake.calls.runAwaits, []);
  await adapter.close();
});

test('Run recovery ignores a business failure that races with a disconnected Runtime', async () => {
  const fake = createFakeRuntime('rt_run_business_failure_disconnected');
  const sessionId = 's_1';
  fake.sessions.add(sessionId);
  const adapter = new RuntimeHostAdapter({
    mode: 'runtime',
    profileRoot: path.resolve('C:\\isolated-profile'),
    runtimeFactory: async () => fake.runtime,
    identityStore: testIdentityStore,
    runtimeEventParser: testRuntimeEventParser,
    credentialResolver: async () => 'test-credential',
  });
  const handle = await adapter.startManagedRun({
    sessionId,
    prompt: 'preserve the business failure',
    options: { provider: 'anthropic' },
  });
  fake.runtime.runs.await = async (runId) => {
    fake.calls.runAwaits.push(runId);
    return { runId, sessionId, phase: 'completed' };
  };

  fake.disconnect(true);
  fake.pending.get(handle.runId)?.reject(new Error('Provider rejected this request.'));

  await assert.rejects(handle.result, /Provider rejected this request/);
  assert.deepEqual(fake.calls.runGets, []);
  assert.deepEqual(fake.calls.runAwaits, []);
  await adapter.close();
});

test('Run recovery survives another reconnect while querying the admitted runId', async () => {
  const first = createFakeRuntime('rt_run_recovery_first');
  const second = createFakeRuntime('rt_run_recovery_second');
  const third = createFakeRuntime('rt_run_recovery_third');
  const sessionId = 's_run_recovery';
  first.sessions.add(sessionId);
  second.sessions.add(sessionId);
  third.sessions.add(sessionId);
  const runtimes = [first.runtime, second.runtime, third.runtime];
  const adapter = new RuntimeHostAdapter({
    mode: 'runtime',
    profileRoot: path.resolve('C:\\isolated-profile'),
    runtimeFactory: async () => runtimes.shift() ?? third.runtime,
    identityStore: testIdentityStore,
    runtimeEventParser: testRuntimeEventParser,
    credentialResolver: async () => 'test-credential',
  });
  const handle = await adapter.startManagedRun({
    sessionId,
    prompt: 'recover this run across two disconnects',
    options: { provider: 'anthropic' },
  });
  second.runtime.runs.get = async (runId) => {
    second.calls.runGets.push(runId);
    second.disconnect(true);
    throw testRuntimeDaemonDisconnectError();
  };
  third.runtime.runs.get = async (runId) => {
    third.calls.runGets.push(runId);
    return {
      runId,
      sessionId,
      phase: 'interrupted',
      startedAt: '2026-08-21T00:00:00.000Z',
      endedAt: '2026-08-21T00:00:01.000Z',
      provider: 'anthropic',
      terminal: {
        revision: 1,
        kind: 'interrupted',
        code: 'daemon_crashed',
        effectOutcome: 'unknown',
      },
    };
  };
  third.runtime.runs.await = async (runId) => {
    third.calls.runAwaits.push(runId);
    return {
      runId,
      sessionId,
      phase: 'interrupted',
      terminal: {
        revision: 1,
        kind: 'interrupted',
        code: 'daemon_crashed',
        effectOutcome: 'unknown',
      },
    };
  };

  first.disconnect(true);
  first.pending.get(handle.runId)?.reject(testRuntimeDaemonDisconnectError());

  await assert.doesNotReject(handle.result);
  assert.equal(first.calls.started.length, 1);
  assert.deepEqual(second.calls.started, []);
  assert.deepEqual(third.calls.started, []);
  assert.deepEqual(second.calls.runGets, [handle.runId]);
  assert.deepEqual(third.calls.runGets, [handle.runId]);
  assert.deepEqual(third.calls.runAwaits, [handle.runId]);
  await adapter.close();
});

test('Run recovery retries when attachment changes after runs.get returns', async () => {
  const first = createFakeRuntime('rt_run_recovery_guard_first');
  const second = createFakeRuntime('rt_run_recovery_guard_second');
  const third = createFakeRuntime('rt_run_recovery_guard_third');
  const sessionId = 's_run_recovery_guard';
  first.sessions.add(sessionId);
  second.sessions.add(sessionId);
  third.sessions.add(sessionId);
  const runtimes = [first.runtime, second.runtime, third.runtime];
  const adapter = new RuntimeHostAdapter({
    mode: 'runtime',
    profileRoot: path.resolve('C:\\isolated-profile'),
    runtimeFactory: async () => runtimes.shift() ?? third.runtime,
    identityStore: testIdentityStore,
    runtimeEventParser: testRuntimeEventParser,
    credentialResolver: async () => 'test-credential',
  });
  const handle = await adapter.startManagedRun({
    sessionId,
    prompt: 'recover the exact run after a post-read attachment swap',
    options: { provider: 'anthropic' },
  });
  second.runtime.runs.get = async (runId) => {
    second.calls.runGets.push(runId);
    second.disconnect(true);
    return {
      runId,
      sessionId,
      phase: 'running',
      startedAt: '2026-08-21T00:00:00.000Z',
      provider: 'anthropic',
    };
  };
  third.runtime.runs.get = async (runId) => {
    third.calls.runGets.push(runId);
    return {
      runId,
      sessionId,
      phase: 'interrupted',
      startedAt: '2026-08-21T00:00:00.000Z',
      endedAt: '2026-08-21T00:00:01.000Z',
      provider: 'anthropic',
      terminal: {
        revision: 1,
        kind: 'interrupted',
        code: 'daemon_crashed',
        effectOutcome: 'unknown',
      },
    };
  };
  third.runtime.runs.await = async (runId) => {
    third.calls.runAwaits.push(runId);
    return {
      runId,
      sessionId,
      phase: 'interrupted',
      terminal: {
        revision: 1,
        kind: 'interrupted',
        code: 'daemon_crashed',
        effectOutcome: 'unknown',
      },
    };
  };

  first.disconnect(true);
  first.pending.get(handle.runId)?.reject(testRuntimeDaemonDisconnectError());

  await assert.doesNotReject(handle.result);
  assert.equal(first.calls.started.length, 1);
  assert.deepEqual(second.calls.started, []);
  assert.deepEqual(third.calls.started, []);
  assert.deepEqual(second.calls.runGets, [handle.runId]);
  assert.deepEqual(second.calls.runAwaits, []);
  assert.deepEqual(third.calls.runGets, [handle.runId]);
  assert.deepEqual(third.calls.runAwaits, [handle.runId]);
  await adapter.close();
});

test('Run recovery waits through a reconnectable Runtime initialization failure', async () => {
  const first = createFakeRuntime('rt_run_recovery_first');
  const recovered = createFakeRuntime('rt_run_recovery_recovered');
  const sessionId = 's_run_recovery';
  first.sessions.add(sessionId);
  recovered.sessions.add(sessionId);
  let factoryCalls = 0;
  const adapter = new RuntimeHostAdapter({
    mode: 'runtime',
    profileRoot: path.resolve('C:\\isolated-profile'),
    runtimeFactory: async () => {
      factoryCalls += 1;
      if (factoryCalls === 1) return first.runtime;
      if (factoryCalls === 2) {
        throw testRuntimeDaemonDisconnectError();
      }
      return recovered.runtime;
    },
    identityStore: testIdentityStore,
    runtimeEventParser: testRuntimeEventParser,
    credentialResolver: async () => 'test-credential',
  });
  const handle = await adapter.startManagedRun({
    sessionId,
    prompt: 'recover after a failed replacement attachment',
    options: { provider: 'anthropic' },
  });
  recovered.runtime.runs.get = async (runId) => {
    recovered.calls.runGets.push(runId);
    return {
      runId,
      sessionId,
      phase: 'interrupted',
      startedAt: '2026-08-21T00:00:00.000Z',
      endedAt: '2026-08-21T00:00:01.000Z',
      provider: 'anthropic',
      terminal: {
        revision: 1,
        kind: 'interrupted',
        code: 'daemon_crashed',
        effectOutcome: 'unknown',
      },
    };
  };
  recovered.runtime.runs.await = async (runId) => {
    recovered.calls.runAwaits.push(runId);
    return {
      runId,
      sessionId,
      phase: 'interrupted',
      terminal: {
        revision: 1,
        kind: 'interrupted',
        code: 'daemon_crashed',
        effectOutcome: 'unknown',
      },
    };
  };

  first.disconnect(true);
  first.pending.get(handle.runId)?.reject(testRuntimeDaemonDisconnectError());

  await assert.doesNotReject(handle.result);
  assert.equal(factoryCalls, 3);
  assert.equal(first.calls.started.length, 1);
  assert.deepEqual(recovered.calls.started, []);
  assert.deepEqual(recovered.calls.runGets, [handle.runId]);
  assert.deepEqual(recovered.calls.runAwaits, [handle.runId]);
  await adapter.close();
});

test('Run recovery waits through a transient daemon health failure', async () => {
  const first = createFakeRuntime('rt_run_recovery_first');
  const recovered = createFakeRuntime('rt_run_recovery_recovered');
  const sessionId = 's_1';
  first.sessions.add(sessionId);
  recovered.sessions.add(sessionId);
  let factoryCalls = 0;
  const adapter = new RuntimeHostAdapter({
    mode: 'runtime',
    profileRoot: path.resolve('C:\\isolated-profile'),
    runtimeFactory: async () => {
      factoryCalls += 1;
      if (factoryCalls === 1) return first.runtime;
      if (factoryCalls === 2) {
        throw new Error('Runtime daemon is unhealthy; refusing to start a competing owner.');
      }
      return recovered.runtime;
    },
    identityStore: testIdentityStore,
    runtimeEventParser: testRuntimeEventParser,
    credentialResolver: async () => 'test-credential',
  });
  recovered.runtime.runs.await = async (runId) => {
    recovered.calls.runAwaits.push(runId);
    return { runId, sessionId, phase: 'interrupted' };
  };
  const handle = await adapter.startManagedRun({
    sessionId,
    prompt: 'recover after a transient health failure',
    options: { provider: 'anthropic' },
  });

  first.disconnect(true);
  first.pending.get(handle.runId)?.reject(testRuntimeDaemonDisconnectError());

  assert.equal((await handle.result).runId, handle.runId);
  assert.equal(factoryCalls, 3);
  assert.deepEqual(recovered.calls.started, []);
  assert.deepEqual(recovered.calls.runGets, [handle.runId]);
  assert.deepEqual(recovered.calls.runAwaits, [handle.runId]);
  await adapter.close();
});

test('Run recovery surfaces a permanent error from a scheduled replacement', async () => {
  const first = createFakeRuntime('rt_run_recovery_first');
  const sessionId = 's_run_recovery';
  first.sessions.add(sessionId);
  let factoryCalls = 0;
  const adapter = new RuntimeHostAdapter({
    mode: 'runtime',
    profileRoot: path.resolve('C:\\isolated-profile'),
    runtimeFactory: async () => {
      factoryCalls += 1;
      if (factoryCalls === 1) return first.runtime;
      if (factoryCalls === 2) {
        throw testRuntimeDaemonDisconnectError();
      }
      throw new Error('replacement Runtime is incompatible');
    },
    identityStore: testIdentityStore,
    runtimeEventParser: testRuntimeEventParser,
    credentialResolver: async () => 'test-credential',
  });
  const handle = await adapter.startManagedRun({
    sessionId,
    prompt: 'surface a permanent replacement failure',
    options: { provider: 'anthropic' },
  });
  const settled = assert.rejects(handle.result, /replacement Runtime is incompatible/);

  first.disconnect(true);
  first.pending.get(handle.runId)?.reject(testRuntimeDaemonDisconnectError());

  await settled;
  assert.equal(factoryCalls, 3);
  await adapter.close();
});

test('closing the adapter immediately settles a Run waiting for reconnect', async () => {
  const first = createFakeRuntime('rt_run_recovery_first');
  const sessionId = 's_run_recovery';
  first.sessions.add(sessionId);
  let factoryCalls = 0;
  const adapter = new RuntimeHostAdapter({
    mode: 'runtime',
    profileRoot: path.resolve('C:\\isolated-profile'),
    runtimeFactory: async () => {
      factoryCalls += 1;
      if (factoryCalls === 1) return first.runtime;
      throw testRuntimeDaemonDisconnectError();
    },
    identityStore: testIdentityStore,
    runtimeEventParser: testRuntimeEventParser,
    credentialResolver: async () => 'test-credential',
  });
  const handle = await adapter.startManagedRun({
    sessionId,
    prompt: 'close while recovering this run',
    options: { provider: 'anthropic' },
  });
  const settled = assert.rejects(handle.result, /closed during Run recovery/i);

  first.disconnect(true);
  first.pending.get(handle.runId)?.reject(testRuntimeDaemonDisconnectError());
  await waitForTest(() => factoryCalls === 2);

  await adapter.close();
  await settled;
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(factoryCalls, 2);
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

test('after-turn submission uses the provider from the SDK active Run record', async () => {
  const fake = createFakeRuntime();
  fake.sessions.add('s_observed_provider');
  let runReads = 0;
  fake.runtime.runs.get = async (runId) => {
    runReads += 1;
    return {
      runId,
      sessionId: 's_observed_provider',
      phase: 'running',
      startedAt: '2026-08-05T10:00:00.000Z',
      provider: 'openai',
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

  await adapter.initialize();
  await adapter.ensureObserved('s_observed_provider');
  fake.emit({
    id: 'event_observed_provider',
    seq: 1,
    time: '2026-08-05T10:00:00.000Z',
    type: 'run.started',
    sessionId: 's_observed_provider',
    runId: 'run_observed_provider',
    payload: {
      runId: 'run_observed_provider',
      sessionId: 's_observed_provider',
      phase: 'running',
      provider: 'anthropic',
      mode: 'managed_task',
      startedAt: '2026-08-05T10:00:00.000Z',
    },
  });
  await new Promise<void>((resolve) => setImmediate(resolve));

  await adapter.submitInput({
    sessionId: 's_observed_provider',
    afterRunId: 'run_observed_provider',
    delivery: 'after_turn',
    input: [{ type: 'text', text: 'continue after the turn' }],
  });

  assert.equal(runReads, 1);
  assert.deepEqual(fake.calls.credentialRegistrations, [{ providers: ['openai'] }]);
  await adapter.close();
});

test('interrupt submission reuses the active run bindings and returns the factual Runtime result', async () => {
  let rejectPersistedRead = false;
  let persistedReads = 0;
  setSessionStoreImpl({
    listSessions: async () => [],
    forkSession: async () => null,
    rewindSession: async () => null,
    deleteSession: async () => ({ ok: true }),
    loadSession: async (sessionId) => {
      persistedReads += 1;
      if (rejectPersistedRead) {
        throw Object.assign(new Error('active Session writer'), { code: 'data_changed' });
      }
      return { sessionId, title: '', messages: [], gitRoot: 'C:\\repo', tag: 'code' } as never;
    },
    watchSessions: () => ({ close() {} }),
  } as SessionStoreImpl);
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

  await adapter.initialize();
  await adapter.ensureObserved('s_1');
  const readsAfterObservation = persistedReads;
  rejectPersistedRead = true;

  const result = await adapter.submitInput({
    sessionId: 's_1',
    afterRunId: 'run_previous',
    delivery: 'interrupt',
    input: [{ type: 'text', text: 'steer now' }],
  });
  assert.deepEqual(fake.calls.loaded, []);
  assert.equal(persistedReads, readsAfterObservation);

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

test('cold active interrupt uses Runtime ownership without crossing persisted history', async () => {
  let persistedReads = 0;
  setSessionStoreImpl({
    listSessions: async () => [],
    forkSession: async () => null,
    rewindSession: async () => null,
    deleteSession: async () => ({ ok: true }),
    loadSession: async () => {
      persistedReads += 1;
      throw Object.assign(new Error('active Session writer'), { code: 'data_changed' });
    },
    watchSessions: () => ({ close() {} }),
  } as SessionStoreImpl);
  const fake = createFakeRuntime('rt_cold_active_interrupt');
  const sessionId = 's_cold_active_interrupt';
  const runId = 'run_cold_active_interrupt';
  fake.sessions.add(sessionId);
  const originalStatus = fake.runtime.status.snapshot.bind(fake.runtime.status);
  fake.runtime.status.snapshot = async () => ({
    ...(await originalStatus()),
    runs: [
      {
        runId,
        sessionId,
        phase: 'running' as const,
        provider: 'mock',
        mode: 'managed_task' as const,
        startedAt: '2026-08-05T12:00:00.000Z',
      },
    ],
  });
  const originalObserve = fake.runtime.sessions.observe.bind(fake.runtime.sessions);
  fake.runtime.sessions.observe = async (...args) => {
    const observation = await originalObserve(...args);
    return {
      ...observation,
      snapshot: {
        ...observation.snapshot,
        runs: [
          {
            runId,
            sessionId,
            phase: 'running' as const,
            provider: 'mock',
            mode: 'managed_task' as const,
            startedAt: '2026-08-05T12:00:00.000Z',
          },
        ],
      },
    };
  };
  fake.runtime.runs.submitInput = async (input) => {
    fake.calls.submitted.push(input);
    return {
      accepted: true,
      delivery: 'interrupt' as const,
      inputId: 'input_cold_active_interrupt',
      runId,
      sessionId,
      afterRunId: runId,
      sessionOrder: 1,
    };
  };
  const adapter = new RuntimeHostAdapter({
    mode: 'runtime',
    profileRoot: path.resolve('C:\\isolated-profile'),
    runtimeFactory: async () => fake.runtime,
    identityStore: testIdentityStore,
    runtimeEventParser: testRuntimeEventParser,
  });

  await adapter.initialize();
  const result = await adapter.submitInput({
    sessionId,
    afterRunId: runId,
    delivery: 'interrupt',
    input: [{ type: 'text', text: 'cold steer' }],
  });

  assert.equal(result.accepted, true);
  assert.equal(persistedReads, 0);
  assert.equal(fake.calls.submitted.length, 1);
  await adapter.close();
});

test('managed-task verification delegates interrupt admission to KodaX Runtime', async () => {
  const fake = createFakeRuntime();
  fake.sessions.add('s_1');
  fake.runtime.runs.submitInput = async (input) => {
    fake.calls.submitted.push(input);
    return {
      accepted: false,
      delivery: 'interrupt',
      sessionId: 's_1',
      afterRunId: 'run_previous',
      reason: 'interrupt_window_closed',
    };
  };
  const adapter = new RuntimeHostAdapter({
    mode: 'runtime',
    profileRoot: path.resolve('C:\\isolated-profile'),
    runtimeFactory: async () => fake.runtime,
    identityStore: testIdentityStore,
    runtimeEventParser: testRuntimeEventParser,
  });

  await adapter.initialize();
  await adapter.ensureObserved('s_1');
  fake.emit({
    id: 'event_verifying',
    seq: 1,
    time: '2026-07-24T08:44:30.324Z',
    type: 'run.progress',
    sessionId: 's_1',
    runId: 'run_previous',
    payload: {
      kind: 'managed_task_status',
      status: {
        agentMode: 'ama',
        harnessProfile: 'H2_PLAN_EXECUTE_EVAL',
        currentRound: 1,
        maxRounds: 1,
        upgradeCeiling: 'H2_PLAN_EXECUTE_EVAL',
        phase: 'verifying',
      },
    },
  });
  await new Promise<void>((resolve) => setImmediate(resolve));

  const result = await adapter.submitInput({
    sessionId: 's_1',
    afterRunId: 'run_previous',
    delivery: 'interrupt',
    input: [{ type: 'text', text: 'too late for this root turn' }],
  });

  assert.deepEqual(result, {
    accepted: false,
    delivery: 'interrupt',
    sessionId: 's_1',
    afterRunId: 'run_previous',
    reason: 'interrupt_window_closed',
  });
  assert.deepEqual(fake.calls.submitted, [
    {
      sessionId: 's_1',
      afterRunId: 'run_previous',
      delivery: 'interrupt',
      input: [{ type: 'text', text: 'too late for this root turn' }],
    },
  ]);
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

test('daemon delivered interrupt batch becomes ordered queue-addressable session events', async () => {
  const pushed: unknown[] = [];
  const adapter = new RuntimeHostAdapter({
    mode: 'runtime',
    push: (channel, payload) => {
      if (channel === 'session.event') pushed.push(payload);
    },
  });
  const bridgeRuntimeEvent = bindTestRuntimeEventBridge(adapter);

  bridgeRuntimeEvent(
    {
      id: 'event_interrupt_turn_started',
      seq: 1,
      time: '2026-07-21T00:00:00.000Z',
      type: 'turn.started',
      sessionId: 's_1',
      runId: 'run_active',
      turnId: 'turn_active',
      payload: {
        sessionId: 's_1',
        seq: 1,
        turnId: 'turn_active',
        deliveryKind: 'initial',
        contextKind: 'root',
      },
    },
    'rt_test',
  );
  bridgeRuntimeEvent(
    {
      id: 'event_interrupt_batch',
      seq: 2,
      time: '2026-07-21T00:00:00.000Z',
      type: 'run.input.delivered',
      sessionId: 's_1',
      runId: 'run_active',
      turnId: 'turn_active',
      payload: {
        inputs: [
          {
            inputId: 'input-1',
            entryId: 'entry-interrupt-1',
            afterRunId: 'run_active',
            input: [{ type: 'text', text: 'first interrupt\n\nattachment overlay' }],
            queuedAt: '2026-07-21T00:00:00.000Z',
            deliveredAt: '2026-07-21T00:00:01.000Z',
          },
          {
            inputId: 'input-2',
            entryId: 'entry-interrupt-2',
            afterRunId: 'run_active',
            input: [{ type: 'text', text: 'second interrupt' }],
            queuedAt: '2026-07-21T00:00:00.000Z',
            deliveredAt: '2026-07-21T00:00:01.000Z',
          },
        ],
      },
    },
    'rt_test',
  );
  bridgeRuntimeEvent(
    {
      id: 'event_interrupt_progress_mirror',
      seq: 3,
      time: '2026-07-21T00:00:01.000Z',
      type: 'run.progress',
      sessionId: 's_1',
      runId: 'run_active',
      payload: {
        kind: 'mid_turn_user_messages',
        contents: ['first interrupt\n\nattachment overlay', 'second interrupt'],
        meta: { queuedMessageIds: ['msg-1', 'msg-2'] },
      },
    },
    'rt_test',
  );

  assert.deepEqual(pushed, [
    {
      runtimeEvent: {
        runtimeId: 'rt_test',
        runId: 'run_active',
        journalEpoch: 'journal_epoch_1',
        seq: 1,
      },
      kind: 'session_start',
      sessionId: 's_1',
      provider: 'unknown',
      turnId: 'turn_active',
    },
    {
      runtimeEvent: {
        runtimeId: 'rt_test',
        runId: 'run_active',
        journalEpoch: 'journal_epoch_1',
        seq: 2,
      },
      kind: 'mid_turn_user_prompt',
      sessionId: 's_1',
      queueId: 'input-1',
      entryId: 'entry-interrupt-1',
      content: 'first interrupt\n\nattachment overlay',
      turnId: 'turn_active',
      turnUserOrdinal: 1,
      sentAt: Date.parse('2026-07-21T00:00:00.000Z'),
    },
    {
      runtimeEvent: {
        runtimeId: 'rt_test',
        runId: 'run_active',
        journalEpoch: 'journal_epoch_1',
        seq: 2,
      },
      kind: 'mid_turn_user_prompt',
      sessionId: 's_1',
      queueId: 'input-2',
      entryId: 'entry-interrupt-2',
      content: 'second interrupt',
      turnId: 'turn_active',
      turnUserOrdinal: 2,
      sentAt: Date.parse('2026-07-21T00:00:00.000Z'),
    },
  ]);
  await adapter.close();
});

test('a queued Runtime turn defers its user boundary until the delivered input arrives', async () => {
  const pushed: unknown[] = [];
  const adapter = new RuntimeHostAdapter({
    mode: 'runtime',
    push: (channel, payload) => {
      if (channel === 'session.event') pushed.push(payload);
    },
  });
  const bridgeRuntimeEvent = bindTestRuntimeEventBridge(adapter);

  bridgeRuntimeEvent({
    id: 'event_queued_turn_started',
    seq: 1,
    time: '2026-07-29T06:46:27.447Z',
    type: 'turn.started',
    sessionId: 's_1',
    runId: 'run_active',
    turnId: 'turn_queued',
    payload: {
      sessionId: 's_1',
      seq: 10,
      turnId: 'turn_queued',
      deliveryKind: 'queued',
      contextKind: 'root',
    },
  });
  bridgeRuntimeEvent({
    id: 'event_queued_turn_input',
    seq: 2,
    time: '2026-07-29T06:46:27.453Z',
    type: 'run.input.delivered',
    sessionId: 's_1',
    runId: 'run_active',
    turnId: 'turn_queued',
    payload: {
      inputs: [
        {
          inputId: 'input-queued-first',
          afterRunId: 'run_active',
          input: [{ type: 'text', text: 'queued turn prompt' }],
          queuedAt: '2026-07-29T06:45:00.917Z',
          deliveredAt: '2026-07-29T06:46:27.453Z',
        },
      ],
    },
  });

  assert.deepEqual(pushed, [
    {
      kind: 'mid_turn_user_prompt',
      sessionId: 's_1',
      queueId: 'input-queued-first',
      content: 'queued turn prompt',
      turnId: 'turn_queued',
      turnUserOrdinal: 0,
      sentAt: Date.parse('2026-07-29T06:46:27.453Z'),
    },
  ]);
  await adapter.close();
});

test('unproven Runtime delivery kinds do not manufacture a user ordinal', async () => {
  const pushed: unknown[] = [];
  const adapter = new RuntimeHostAdapter({
    mode: 'runtime',
    push: (channel, payload) => {
      if (channel === 'session.event') pushed.push(payload);
    },
  });
  const bridgeRuntimeEvent = bindTestRuntimeEventBridge(adapter);
  const observeRootTurnStart = (
    adapter as unknown as {
      observeRootTurnStart(turnId: string, deliveryKind: unknown): void;
    }
  ).observeRootTurnStart.bind(adapter);

  for (const [index, deliveryKind] of ['interrupt', 'resume', 'future-kind'].entries()) {
    const turnId = `turn_unproven_${index}`;
    observeRootTurnStart(turnId, deliveryKind);
    bridgeRuntimeEvent({
      id: `event_unproven_input_${index}`,
      seq: 31 + index * 2,
      time: '2026-07-21T00:02:01.000Z',
      type: 'run.input.delivered',
      sessionId: 's_1',
      runId: 'run_active',
      turnId,
      payload: {
        inputs: [
          {
            inputId: `input-unproven-${index}`,
            afterRunId: 'run_active',
            input: [{ type: 'text', text: `unproven ${deliveryKind}` }],
            queuedAt: '2026-07-21T00:02:00.000Z',
            deliveredAt: '2026-07-21T00:02:01.000Z',
          },
        ],
      },
    });
  }

  const delivered = pushed.filter(
    (event): event is { kind: string; turnUserOrdinal?: number } =>
      typeof event === 'object' &&
      event !== null &&
      (event as { kind?: unknown }).kind === 'mid_turn_user_prompt',
  );
  assert.equal(delivered.length, 3);
  assert.deepEqual(
    delivered.map((event) => event.turnUserOrdinal),
    [undefined, undefined, undefined],
  );
  await adapter.close();
});

test('same-adapter reconnect drops stale user ordinals when turn.started is not replayed', async () => {
  const pushed: unknown[] = [];
  const first = createFakeRuntime();
  const second = createFakeRuntime();
  let connectionAttempt = 0;
  const adapter = new RuntimeHostAdapter({
    mode: 'runtime',
    profileRoot: path.resolve('C:\\isolated-profile'),
    runtimeFactory: async () => (connectionAttempt++ === 0 ? first.runtime : second.runtime),
    identityStore: testIdentityStore,
    runtimeEventParser: testRuntimeEventParser,
    push: (channel, payload) => {
      if (channel === 'session.event') pushed.push(payload);
    },
  });
  const bridgeRuntimeEvent = bindTestRuntimeEventBridge(adapter);

  await adapter.initialize();
  bridgeRuntimeEvent({
    id: 'event_before_disconnect_turn_started',
    seq: 19,
    time: '2026-07-21T00:00:58.000Z',
    type: 'turn.started',
    sessionId: 's_1',
    runId: 'run_active',
    turnId: 'turn_active',
    payload: {
      sessionId: 's_1',
      seq: 19,
      turnId: 'turn_active',
      contextKind: 'root',
      deliveryKind: 'initial',
    },
  });
  first.disconnect(false);
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(adapter.snapshot().state, 'failed');
  await adapter.initialize();

  pushed.length = 0;
  bridgeRuntimeEvent({
    id: 'event_reconnected_interrupt',
    seq: 20,
    time: '2026-07-21T00:01:00.000Z',
    type: 'run.input.delivered',
    sessionId: 's_1',
    runId: 'run_active',
    turnId: 'turn_active',
    payload: {
      inputs: [
        {
          inputId: 'input-after-reconnect',
          afterRunId: 'run_active',
          input: [{ type: 'text', text: 'same text may be new' }],
          queuedAt: '2026-07-21T00:00:59.000Z',
          deliveredAt: '2026-07-21T00:01:00.000Z',
        },
      ],
    },
  });

  assert.deepEqual(pushed, [
    {
      kind: 'mid_turn_user_prompt',
      sessionId: 's_1',
      queueId: 'input-after-reconnect',
      content: 'same text may be new',
      turnId: 'turn_active',
      sentAt: Date.parse('2026-07-21T00:01:00.000Z'),
    },
  ]);
  await adapter.close();
});

test('daemon run lifecycle preserves canonical turn identity in renderer events', async () => {
  const pushed: unknown[] = [];
  const adapter = new RuntimeHostAdapter({
    mode: 'runtime',
    push: (channel, payload) => {
      if (channel === 'session.event') pushed.push(payload);
    },
  });
  const bridgeRuntimeEvent = bindTestRuntimeEventBridge(adapter);

  bridgeRuntimeEvent({
    id: 'event_run_started_identity',
    seq: 1,
    time: '2026-07-26T00:00:00.000Z',
    type: 'run.started',
    sessionId: 's_1',
    runId: 'run_identity',
    payload: {
      runId: 'run_identity',
      sessionId: 's_1',
      phase: 'running',
      startedAt: '2026-07-26T00:00:00.000Z',
      provider: 'mock',
    },
  });
  bridgeRuntimeEvent({
    id: 'event_turn_started_identity',
    seq: 2,
    time: '2026-07-26T00:00:00.100Z',
    type: 'turn.started',
    sessionId: 's_1',
    runId: 'run_identity',
    payload: {
      sessionId: 's_1',
      seq: 1,
      turnId: 'turn_identity',
      deliveryKind: 'initial',
      contextKind: 'root',
    },
  });
  bridgeRuntimeEvent({
    id: 'event_run_completed_identity',
    seq: 3,
    time: '2026-07-26T00:00:01.000Z',
    type: 'run.completed',
    sessionId: 's_1',
    runId: 'run_identity',
    turnId: 'turn_identity',
    payload: {
      runId: 'run_identity',
      sessionId: 's_1',
      phase: 'completed',
      startedAt: '2026-07-26T00:00:00.000Z',
      provider: 'mock',
    },
  });

  assert.deepEqual(pushed, [
    {
      kind: 'session_start',
      sessionId: 's_1',
      provider: 'mock',
    },
    {
      kind: 'session_start',
      sessionId: 's_1',
      provider: 'mock',
      turnId: 'turn_identity',
    },
    {
      kind: 'session_complete',
      sessionId: 's_1',
      turnId: 'turn_identity',
    },
  ]);
  await adapter.close();
});

test('an observation snapshot restores an after-turn marker with its exact admitted Run id', async () => {
  const fake = createFakeRuntime();
  fake.sessions.add('s_snapshot_continuation');
  const originalObserve = fake.runtime.sessions.observe.bind(fake.runtime.sessions);
  fake.runtime.sessions.observe = async (...args) => {
    const observation = await originalObserve(...args);
    return {
      ...observation,
      snapshot: {
        ...observation.snapshot,
        runs: [
          {
            runId: 'run_snapshot_continuation',
            sessionId: 's_snapshot_continuation',
            phase: 'running' as const,
            startedAt: '2026-08-04T00:00:00.000Z',
            provider: 'mock',
            turnId: 'turn_snapshot_continuation',
          },
        ],
      },
    };
  };
  const pushed: unknown[] = [];
  const adapter = new RuntimeHostAdapter({
    mode: 'runtime',
    profileRoot: path.resolve('C:\\isolated-profile'),
    runtimeFactory: async () => fake.runtime,
    identityStore: testIdentityStore,
    runtimeEventParser: testRuntimeEventParser,
    push: (channel, payload) => {
      if (channel === 'session.event') pushed.push(payload);
    },
  });
  (
    adapter as unknown as {
      continuationPrompts: Map<string, { sessionId: string; content: string }>;
    }
  ).continuationPrompts.set('run_snapshot_continuation', {
    sessionId: 's_snapshot_continuation',
    content: 'snapshot continuation',
  });

  await adapter.ensureObserved('s_snapshot_continuation');

  assert.deepEqual(pushed, [
    {
      kind: 'queued_user_prompt_started',
      sessionId: 's_snapshot_continuation',
      queueId: 'run_snapshot_continuation',
      queueMode: 'after-turn',
      content: 'snapshot continuation',
      turnId: 'turn_snapshot_continuation',
      turnUserOrdinal: 0,
    },
  ]);
  await adapter.close();
});

test('a terminal fallback restores an after-turn marker with its exact admitted Run id', async () => {
  const fake = createFakeRuntime();
  fake.sessions.add('s_terminal_continuation');
  const pushed: unknown[] = [];
  const adapter = new RuntimeHostAdapter({
    mode: 'runtime',
    profileRoot: path.resolve('C:\\isolated-profile'),
    runtimeFactory: async () => fake.runtime,
    identityStore: testIdentityStore,
    runtimeEventParser: testRuntimeEventParser,
    push: (channel, payload) => {
      if (channel === 'session.event') pushed.push(payload);
    },
  });
  await adapter.ensureObserved('s_terminal_continuation');
  (
    adapter as unknown as {
      continuationPrompts: Map<string, { sessionId: string; content: string }>;
    }
  ).continuationPrompts.set('run_terminal_continuation', {
    sessionId: 's_terminal_continuation',
    content: 'terminal continuation',
  });

  fake.emit({
    id: 'event_terminal_continuation',
    seq: 1,
    time: '2026-08-04T00:00:01.000Z',
    type: 'run.completed',
    sessionId: 's_terminal_continuation',
    runId: 'run_terminal_continuation',
    turnId: 'turn_terminal_continuation',
    payload: {
      runId: 'run_terminal_continuation',
      sessionId: 's_terminal_continuation',
      phase: 'completed',
      startedAt: '2026-08-04T00:00:00.000Z',
      provider: 'mock',
    },
  });
  await waitForTest(() =>
    pushed.some(
      (payload) =>
        (payload as { kind?: string; queueId?: string }).kind === 'queued_user_prompt_started' &&
        (payload as { queueId?: string }).queueId === 'run_terminal_continuation',
    ),
  );

  assert.deepEqual(pushed[0], {
    runtimeEvent: {
      runtimeId: 'rt_test',
      runId: 'run_terminal_continuation',
      journalEpoch: 'journal_epoch_1',
      seq: 1,
    },
    kind: 'queued_user_prompt_started',
    sessionId: 's_terminal_continuation',
    queueId: 'run_terminal_continuation',
    queueMode: 'after-turn',
    content: 'terminal continuation',
    turnId: 'turn_terminal_continuation',
    turnUserOrdinal: 0,
  });
  await adapter.close();
});

test('daemon child turn lifecycle cannot bind the root renderer turn identity', async () => {
  const pushed: unknown[] = [];
  const adapter = new RuntimeHostAdapter({
    mode: 'runtime',
    push: (channel, payload) => {
      if (channel === 'session.event') pushed.push(payload);
    },
  });
  const bridgeRuntimeEvent = bindTestRuntimeEventBridge(adapter);

  bridgeRuntimeEvent({
    id: 'event_child_turn_started',
    seq: 1,
    time: '2026-07-26T00:00:00.100Z',
    type: 'turn.started',
    sessionId: 's_1',
    runId: 'run_identity',
    payload: {
      sessionId: 's_1',
      seq: 1,
      turnId: 'turn_child',
      deliveryKind: 'initial',
      contextKind: 'child',
      contextId: 's_1/agent/reviewer',
      agentId: 'reviewer',
    },
  });

  assert.deepEqual(pushed, []);
  await adapter.close();
});

test('daemon run failure prefers the credential-safe failure detail', async () => {
  const pushed: unknown[] = [];
  const adapter = new RuntimeHostAdapter({
    mode: 'runtime',
    push: (channel, payload) => {
      if (channel === 'session.event') pushed.push(payload);
    },
  });
  const bridgeRuntimeEvent = bindTestRuntimeEventBridge(adapter);

  bridgeRuntimeEvent({
    id: 'event_run_failed_with_terminal_reason',
    seq: 1,
    time: '2026-07-24T02:30:16.281Z',
    type: 'run.failed',
    sessionId: 's_1',
    runId: 'run_blocked_without_sidecar',
    payload: {
      runId: 'run_blocked_without_sidecar',
      sessionId: 's_1',
      phase: 'failed',
      startedAt: '2026-07-24T02:26:35.310Z',
      provider: 'mock',
      failureDetail: {
        failureKind: 'auth',
        stage: 'credential',
        providerErrorCode: 'authentication_failed',
        safeMessage: 'Provider authentication failed.',
        httpStatus: 401,
        upstreamErrorCode: 'gateway.invalid_api_key-v2',
        requestId: 'req:custom-shard_2',
      },
      terminal: {
        revision: 1,
        kind: 'failed',
        code: 'run_failed',
        effectOutcome: 'known',
        failureKind: 'auth',
        message: 'Choose the target API version.',
      },
    },
  });

  assert.deepEqual(pushed, [
    {
      kind: 'session_error',
      sessionId: 's_1',
      error: 'Provider authentication failed.',
      category: 'auth',
      failureKind: 'auth',
      failureDetail: {
        failureKind: 'auth',
        stage: 'credential',
        providerErrorCode: 'authentication_failed',
        safeMessage: 'Provider authentication failed.',
        httpStatus: 401,
        upstreamErrorCode: 'gateway.invalid_api_key-v2',
        requestId: 'req:custom-shard_2',
      },
      retriable: false,
      action: 'open_provider_settings',
    },
  ]);
  await adapter.close();
});

test('daemon failureDetail omits malformed optional fields and logs only safe issue paths', async () => {
  const pushed: unknown[] = [];
  const warnings: unknown[][] = [];
  const originalWarn = console.warn;
  console.warn = (...args: unknown[]) => warnings.push(args);
  const adapter = new RuntimeHostAdapter({
    mode: 'runtime',
    push: (channel, payload) => {
      if (channel === 'session.event') pushed.push(payload);
    },
  });
  try {
    const bridgeRuntimeEvent = bindTestRuntimeEventBridge(adapter);
    bridgeRuntimeEvent({
      id: 'event_malformed_optional_identifiers',
      seq: 1,
      time: '2026-08-28T00:00:00.000Z',
      type: 'run.failed',
      sessionId: 's_safe_diagnostic',
      runId: 'run_safe_diagnostic',
      payload: {
        failureDetail: {
          failureKind: 'provider',
          stage: 'transport',
          providerErrorCode: 'provider_error',
          safeMessage: 'The provider request failed.',
          httpStatus: 900,
          upstreamErrorCode: 'secret/upstream value',
          requestId: 'secret=request value',
          retryAfterMs: -1,
          contextTokens: { required: -1, available: 10 },
        },
      },
    } as unknown as TestRuntimeEvent);
  } finally {
    console.warn = originalWarn;
    await adapter.close();
  }

  const event = pushed[0] as Record<string, unknown>;
  assert.deepEqual(event.failureDetail, {
    failureKind: 'provider',
    stage: 'transport',
    providerErrorCode: 'provider_error',
    safeMessage: 'The provider request failed.',
  });
  assert.equal(warnings.length, 1);
  assert.deepEqual(warnings[0], [
    '[runtime] sanitized malformed failureDetail',
    {
      eventType: 'run.failed',
      runId: 'run_safe_diagnostic',
      issuePaths: [
        'httpStatus',
        'upstreamErrorCode',
        'requestId',
        'retryAfterMs',
        'contextTokens.required',
      ],
    },
  ]);
  assert.doesNotMatch(JSON.stringify(warnings), /secret\/upstream|secret=request/);
});

test('daemon failureDetail parse failure keeps the generic fallback and logs no raw values', async () => {
  const pushed: unknown[] = [];
  const warnings: unknown[][] = [];
  const originalWarn = console.warn;
  console.warn = (...args: unknown[]) => warnings.push(args);
  const adapter = new RuntimeHostAdapter({
    mode: 'runtime',
    push: (channel, payload) => {
      if (channel === 'session.event') pushed.push(payload);
    },
  });
  try {
    const bridgeRuntimeEvent = bindTestRuntimeEventBridge(adapter);
    bridgeRuntimeEvent({
      id: 'event_malformed_failure_detail',
      seq: 1,
      time: '2026-08-28T00:00:00.000Z',
      type: 'run.failed',
      sessionId: 's_safe_diagnostic',
      runId: 'run_malformed_failure_detail',
      payload: {
        failureDetail: {
          failureKind: 'provider',
          stage: 'secret invalid stage',
          providerErrorCode: 'provider_error',
          safeMessage: 'must-not-cross-diagnostic-boundary',
        },
        terminal: { failureKind: 'provider' },
      },
    } as unknown as TestRuntimeEvent);
  } finally {
    console.warn = originalWarn;
    await adapter.close();
  }

  const event = pushed[0] as Record<string, unknown>;
  assert.equal(event.error, 'Runtime run failed');
  assert.equal(event.failureDetail, undefined);
  assert.deepEqual(warnings[0], [
    '[runtime] sanitized malformed failureDetail',
    {
      eventType: 'run.failed',
      runId: 'run_malformed_failure_detail',
      issuePaths: ['stage'],
    },
  ]);
  assert.doesNotMatch(JSON.stringify(warnings), /secret invalid stage|must-not-cross/);
});

test('legacy daemon failure text cannot cross the credential-safe IPC boundary', async () => {
  const pushed: unknown[] = [];
  const adapter = new RuntimeHostAdapter({
    mode: 'runtime',
    push: (channel, payload) => {
      if (channel === 'session.event') pushed.push(payload);
    },
  });
  const bridgeRuntimeEvent = bindTestRuntimeEventBridge(adapter);

  bridgeRuntimeEvent({
    id: 'event_legacy_provider_failure',
    seq: 1,
    time: '2026-08-28T00:00:00.000Z',
    type: 'run.failed',
    sessionId: 's_1',
    runId: 'run_legacy_provider_failure',
    payload: {
      runId: 'run_legacy_provider_failure',
      sessionId: 's_1',
      phase: 'failed',
      startedAt: '2026-08-28T00:00:00.000Z',
      provider: 'custom',
      error: 'upstream body echoed sk-secret and the user prompt',
      terminal: {
        revision: 1,
        kind: 'failed',
        code: 'run_failed',
        effectOutcome: 'known',
        failureKind: 'provider',
        message: 'Authorization: Bearer sk-secret',
      },
    },
  });

  assert.equal(pushed.length, 1);
  const projected = pushed[0] as Record<string, unknown>;
  assert.equal(projected.error, 'Runtime run failed');
  assert.equal(projected.failureKind, 'provider');
  assert.doesNotMatch(JSON.stringify(projected), /sk-secret|user prompt|Authorization/);
  await adapter.close();
});

test('daemon cancelled and interrupted terminals preserve structured Runtime diagnostics', async () => {
  const pushed: unknown[] = [];
  const adapter = new RuntimeHostAdapter({
    mode: 'runtime',
    push: (channel, payload) => {
      if (channel === 'session.event') pushed.push(payload);
    },
  });
  const bridgeRuntimeEvent = bindTestRuntimeEventBridge(adapter);

  const cases = [
    {
      type: 'run.cancelled',
      failureDetail: {
        failureKind: 'cancelled',
        stage: 'runtime_control',
        providerErrorCode: 'cancelled',
        safeMessage: 'Safe run.cancelled diagnostic.',
        requestId: 'request_0',
      },
      expected: { category: 'cancelled', retriable: false, action: undefined },
    },
    {
      type: 'run.interrupted',
      failureDetail: {
        failureKind: 'network',
        stage: 'transport',
        providerErrorCode: 'tls_error',
        safeMessage: 'Safe run.interrupted diagnostic.',
        requestId: 'request_1',
      },
      expected: { category: 'network', retriable: true, action: 'check_network' },
    },
  ] as const;
  cases.forEach(({ type, failureDetail }, index) => {
    bridgeRuntimeEvent({
      id: `event_structured_${type}`,
      seq: index + 1,
      time: '2026-08-28T00:00:00.000Z',
      type,
      sessionId: 's_1',
      runId: `run_${type}`,
      payload: {
        runId: `run_${type}`,
        sessionId: 's_1',
        phase: type === 'run.cancelled' ? 'cancelled' : 'interrupted',
        startedAt: '2026-08-28T00:00:00.000Z',
        provider: 'mock',
        failureDetail,
      },
    });
  });

  assert.deepEqual(
    pushed.map((value) => {
      const event = value as Record<string, unknown>;
      const detail = event.failureDetail as Record<string, unknown>;
      return {
        error: event.error,
        code: detail.providerErrorCode,
        requestId: detail.requestId,
        category: event.category,
        retriable: event.retriable,
        action: event.action,
      };
    }),
    cases.map(({ failureDetail, expected }) => ({
      error: failureDetail.safeMessage,
      code: failureDetail.providerErrorCode,
      requestId: failureDetail.requestId,
      ...expected,
    })),
  );
  await adapter.close();
});

test('daemon failureKind drives credential-safe recovery actions', async () => {
  const pushed: unknown[] = [];
  const adapter = new RuntimeHostAdapter({
    mode: 'runtime',
    push: (channel, payload) => {
      if (channel === 'session.event') pushed.push(payload);
    },
  });
  const bridgeRuntimeEvent = bindTestRuntimeEventBridge(adapter);
  const cases = [
    ['rate_limit', 'rate_limit', true, 'retry'],
    ['network', 'network', true, 'check_network'],
    ['unknown_provider', 'bad_request', false, 'open_provider_settings'],
    ['not_found', 'bad_request', false, undefined],
    ['request', 'bad_request', false, undefined],
    ['upstream', 'unknown', false, undefined],
    ['cancelled', 'cancelled', false, undefined],
    ['provider_aborted', 'unknown', false, undefined],
    ['invalid_response', 'bad_request', false, 'open_provider_settings'],
    ['context_capacity', 'bad_request', false, 'change_model'],
  ] as const;

  cases.forEach(([failureKind], index) => {
    bridgeRuntimeEvent({
      id: `event_failure_kind_${failureKind}`,
      seq: index + 1,
      time: '2026-08-22T00:00:00.000Z',
      type: 'run.failed',
      sessionId: 's_1',
      runId: `run_${failureKind}`,
      payload: {
        runId: `run_${failureKind}`,
        sessionId: 's_1',
        phase: 'failed',
        startedAt: '2026-08-22T00:00:00.000Z',
        provider: 'mock',
        terminal: {
          revision: 1,
          kind: 'failed',
          code: 'run_failed',
          effectOutcome: 'known',
          failureKind,
        },
      },
    });
  });

  assert.deepEqual(
    pushed.map((event) => {
      const record = event as Record<string, unknown>;
      return {
        failureKind: record.failureKind,
        category: record.category,
        retriable: record.retriable,
        action: record.action,
      };
    }),
    cases.map(([failureKind, category, retriable, action]) => ({
      failureKind,
      category,
      retriable,
      action,
    })),
  );
  await adapter.close();
});

test('daemon failureDetail uses stable provider codes for recovery actions', async () => {
  const pushed: unknown[] = [];
  const adapter = new RuntimeHostAdapter({
    mode: 'runtime',
    push: (channel, payload) => {
      if (channel === 'session.event') pushed.push(payload);
    },
  });
  const bridgeRuntimeEvent = bindTestRuntimeEventBridge(adapter);
  const cases = [
    ['credential_unavailable', 'credential', 'auth', false, 'open_provider_settings'],
    ['authentication_failed', 'credential', 'auth', false, 'open_provider_settings'],
    ['rate_limited', 'transport', 'rate_limit', false, undefined],
    ['network_error', 'transport', 'network', true, 'check_network'],
    ['tls_error', 'transport', 'network', true, 'check_network'],
    ['request_timeout', 'transport', 'network', true, 'check_network'],
    ['provider_not_registered', 'catalog', 'bad_request', false, 'open_provider_settings'],
    ['catalog_error', 'catalog', 'bad_request', false, 'open_provider_settings'],
    ['model_not_found', 'transport', 'model_unavailable', false, 'change_model'],
    ['endpoint_not_found', 'transport', 'bad_request', false, 'open_provider_settings'],
    ['resource_not_found', 'transport', 'bad_request', false, undefined],
    ['request_build_failed', 'request_build', 'bad_request', false, undefined],
    ['upstream_client_error', 'transport', 'bad_request', false, undefined],
    ['upstream_server_error', 'transport', 'server_error', true, 'retry'],
    ['protocol_mismatch', 'response_stream', 'bad_request', false, 'open_provider_settings'],
    ['response_stream_error', 'response_stream', 'bad_request', false, undefined],
    ['cancelled', 'runtime_control', 'unknown', false, undefined],
    ['runtime_settlement_failed', 'runtime_settlement', 'unknown', false, undefined],
    ['context_capacity_exceeded', 'runtime_control', 'bad_request', false, 'change_model'],
    ['provider_error', 'transport', 'unknown', false, undefined],
  ] as const;

  cases.forEach(([providerErrorCode, stage], index) => {
    bridgeRuntimeEvent({
      id: `event_failure_code_${providerErrorCode}`,
      seq: index + 1,
      time: '2026-08-28T00:00:00.000Z',
      type: 'run.failed',
      sessionId: 's_1',
      runId: `run_${providerErrorCode}`,
      payload: {
        runId: `run_${providerErrorCode}`,
        sessionId: 's_1',
        phase: 'failed',
        startedAt: '2026-08-28T00:00:00.000Z',
        provider: 'mock',
        failureDetail: {
          failureKind: 'provider',
          stage,
          providerErrorCode,
          safeMessage: `Safe ${providerErrorCode}.`,
        },
        terminal: {
          revision: 1,
          kind: 'failed',
          code: 'run_failed',
          effectOutcome: 'known',
        },
      },
    });
  });

  assert.deepEqual(
    pushed.map((event) => {
      const record = event as Record<string, unknown>;
      return {
        category: record.category,
        retriable: record.retriable,
        action: record.action,
      };
    }),
    cases.map(([, , category, retriable, action]) => ({ category, retriable, action })),
  );
  await adapter.close();
});

test('daemon rate-limit failureDetail projects the authoritative retry delay', async () => {
  const pushed: unknown[] = [];
  const adapter = new RuntimeHostAdapter({
    mode: 'runtime',
    push: (channel, payload) => {
      if (channel === 'session.event') pushed.push(payload);
    },
  });
  const bridgeRuntimeEvent = bindTestRuntimeEventBridge(adapter);
  const endedAt = '1970-01-01T00:50:00.000Z';
  const failureDetail = {
    failureKind: 'rate_limit',
    stage: 'transport',
    providerErrorCode: 'rate_limited',
    safeMessage: 'The provider rate limit was reached.',
    retryAfterMs: 2_500,
  } as const;
  const originalNow = Date.now;
  Date.now = () => 9_000_000;
  try {
    bridgeRuntimeEvent({
      id: 'event_rate_limit_detail',
      seq: 1,
      time: '1970-01-01T00:33:20.000Z',
      type: 'run.failed',
      sessionId: 's_1',
      runId: 'run_rate_limit_detail',
      payload: {
        runId: 'run_rate_limit_detail',
        sessionId: 's_1',
        phase: 'failed',
        startedAt: '2026-08-28T00:00:00.000Z',
        endedAt,
        provider: 'mock',
        failureDetail,
        terminal: {
          revision: 1,
          kind: 'failed',
          code: 'run_failed',
          effectOutcome: 'known',
        },
      },
    });
  } finally {
    Date.now = originalNow;
  }

  const event = pushed[0] as Record<string, unknown>;
  const projected = projectRuntimeRun({
    runId: 'run_rate_limit_detail',
    sessionId: 's_1',
    phase: 'failed',
    startedAt: '2026-08-28T00:00:00.000Z',
    endedAt,
    provider: 'mock',
    sessionOrder: 1,
    failureDetail,
  } as RuntimeRunStatus);
  assert.equal(event.retryAvailableAt, 3_002_500);
  assert.equal(event.retryAvailableAt, projected.retryAvailableAt);
  assert.equal(event.retriable, true);
  assert.equal(event.action, 'retry');
  await adapter.close();
});

test('daemon rate-limit failureDetail without a retry delay does not offer immediate retry', async () => {
  const pushed: unknown[] = [];
  const adapter = new RuntimeHostAdapter({
    mode: 'runtime',
    push: (channel, payload) => {
      if (channel === 'session.event') pushed.push(payload);
    },
  });
  const bridgeRuntimeEvent = bindTestRuntimeEventBridge(adapter);

  bridgeRuntimeEvent({
    id: 'event_rate_limit_without_delay',
    seq: 1,
    time: '2026-08-28T00:00:00.000Z',
    type: 'run.failed',
    sessionId: 's_1',
    runId: 'run_rate_limit_without_delay',
    payload: {
      runId: 'run_rate_limit_without_delay',
      sessionId: 's_1',
      phase: 'failed',
      startedAt: '2026-08-28T00:00:00.000Z',
      provider: 'mock',
      failureDetail: {
        failureKind: 'rate_limit',
        stage: 'transport',
        providerErrorCode: 'rate_limited',
        safeMessage: 'The provider rate limit was reached.',
      },
      terminal: {
        revision: 1,
        kind: 'failed',
        code: 'run_failed',
        effectOutcome: 'known',
      },
    },
  });

  const event = pushed[0] as Record<string, unknown>;
  assert.equal(event.retriable, false);
  assert.equal(event.action, undefined);
  assert.equal(event.retryAvailableAt, undefined);
  await adapter.close();
});

test('daemon unknown provider code keeps the default UI path instead of broad-kind actions', async () => {
  const pushed: unknown[] = [];
  const adapter = new RuntimeHostAdapter({
    mode: 'runtime',
    push: (channel, payload) => {
      if (channel === 'session.event') pushed.push(payload);
    },
  });
  const bridgeRuntimeEvent = bindTestRuntimeEventBridge(adapter);

  const futureEvent = {
    id: 'event_future_provider_code',
    seq: 1,
    time: '2026-08-28T00:00:00.000Z',
    type: 'run.failed',
    sessionId: 's_1',
    runId: 'run_future_provider_code',
    payload: {
      runId: 'run_future_provider_code',
      sessionId: 's_1',
      phase: 'failed',
      startedAt: '2026-08-28T00:00:00.000Z',
      provider: 'mock',
      failureDetail: {
        failureKind: 'rate_limit',
        stage: 'transport',
        providerErrorCode: 'future_rate_limit_policy',
        safeMessage: 'The provider rejected the request.',
      },
      terminal: {
        revision: 1,
        kind: 'failed',
        code: 'run_failed',
        effectOutcome: 'known',
      },
    },
  } as unknown as TestRuntimeEvent;
  bridgeRuntimeEvent(futureEvent);

  const event = pushed[0] as Record<string, unknown>;
  assert.equal(event.category, 'unknown');
  assert.equal(event.retriable, false);
  assert.equal(event.action, undefined);
  await adapter.close();
});

test('daemon context-capacity failure preserves token facts and never offers blind retry', async () => {
  const pushed: unknown[] = [];
  const adapter = new RuntimeHostAdapter({
    mode: 'runtime',
    push: (channel, payload) => {
      if (channel === 'session.event') pushed.push(payload);
    },
  });
  const bridgeRuntimeEvent = bindTestRuntimeEventBridge(adapter);

  bridgeRuntimeEvent({
    id: 'event_context_capacity_detail',
    seq: 1,
    time: '2026-08-28T00:00:00.000Z',
    type: 'run.failed',
    sessionId: 's_1',
    runId: 'run_context_capacity_detail',
    payload: {
      runId: 'run_context_capacity_detail',
      sessionId: 's_1',
      phase: 'failed',
      startedAt: '2026-08-28T00:00:00.000Z',
      provider: 'mock',
      failureDetail: {
        failureKind: 'context_capacity',
        stage: 'runtime_control',
        providerErrorCode: 'context_capacity_exceeded',
        safeMessage: 'The request still exceeds the model context capacity after recovery.',
        contextTokens: { required: 143_400, available: 131_072 },
      },
      terminal: {
        revision: 1,
        kind: 'failed',
        code: 'run_failed',
        effectOutcome: 'known',
      },
    },
  });

  const event = pushed[0] as Record<string, unknown>;
  assert.equal(event.error, 'The request still exceeds the model context capacity after recovery.');
  assert.equal(event.failureKind, 'context_capacity');
  assert.equal(event.retriable, false);
  assert.equal(event.retryAvailableAt, undefined);
  assert.deepEqual((event.failureDetail as { contextTokens?: unknown }).contextTokens, {
    required: 143_400,
    available: 131_072,
  });
  await adapter.close();
});

test('daemon bridge preserves Runtime turn identity on live transcript events', async () => {
  const sessionEvents: unknown[] = [];
  const adapter = new RuntimeHostAdapter({
    mode: 'runtime',
    push: (channel, payload) => {
      if (channel === 'session.event') sessionEvents.push(payload);
    },
  });
  const bridgeRuntimeEvent = bindTestRuntimeEventBridge(adapter);
  const emit = (
    seq: number,
    type: import('@kodax-ai/kodax/runtime').RuntimeTypedEvent['type'],
    payload: unknown,
  ): void => {
    bridgeRuntimeEvent({
      id: `event_${seq}`,
      seq,
      time: '2026-08-04T00:00:00.000Z',
      type,
      sessionId: 's_turn_identity',
      runId: 'run_turn_identity',
      turnId: 'turn_authoritative',
      payload,
    } as import('@kodax-ai/kodax/runtime').RuntimeTypedEvent);
  };

  emit(1, 'output.segment.started', {
    responseId: 'response_turn_identity',
    providerRequestId: 'request_turn_identity',
    mode: 'append',
    meta: { contextKind: 'root' },
  });
  emit(2, 'thinking.delta', {
    text: 'reasoning',
    providerRequestId: 'request_turn_identity',
    meta: { contextKind: 'root' },
  });
  emit(3, 'assistant.delta', {
    text: 'answer',
    providerRequestId: 'request_turn_identity',
    meta: { contextKind: 'root' },
  });
  emit(4, 'thinking.finished', {
    thinking: 'reasoning done',
    meta: { contextKind: 'root' },
  });
  emit(5, 'tool.started', {
    tool: { id: 'tool_1', name: 'read', input: { path: 'notes.md' } },
    meta: { contextKind: 'root', toolCallId: 'tool_1' },
  });
  emit(6, 'tool.progress', {
    update: { id: 'tool_1', message: 'reading' },
    meta: { contextKind: 'root', toolCallId: 'tool_1' },
  });
  emit(7, 'tool.progress', {
    partialJson: '{"path":"notes.md"}',
    toolName: 'read',
    meta: { contextKind: 'root', toolCallId: 'tool_1' },
  });
  emit(8, 'tool.finished', {
    result: { id: 'tool_1', name: 'read', content: 'done' },
    meta: { contextKind: 'root', toolCallId: 'tool_1' },
  });

  assert.deepEqual(
    sessionEvents.map((event) => {
      const row = event as { readonly kind: string; readonly turnId?: string };
      return [row.kind, row.turnId];
    }),
    [
      ['output_segment_started', 'turn_authoritative'],
      ['thinking_delta', 'turn_authoritative'],
      ['text_delta', 'turn_authoritative'],
      ['thinking_end', 'turn_authoritative'],
      ['tool_start', 'turn_authoritative'],
      ['tool_progress', 'turn_authoritative'],
      ['tool_input_delta', 'turn_authoritative'],
      ['tool_result', 'turn_authoritative'],
    ],
  );
  await adapter.close();
});

test('daemon bridge projects root Provider recovery with Runtime provenance', async () => {
  const sessionEvents: unknown[] = [];
  const adapter = new RuntimeHostAdapter({
    mode: 'runtime',
    push: (channel, payload) => {
      if (channel === 'session.event') sessionEvents.push(payload);
    },
  });
  const bridgeRuntimeEvent = bindTestRuntimeEventBridge(adapter);

  bridgeRuntimeEvent(
    {
      id: 'event_provider_recovery',
      seq: 41,
      time: '2026-08-14T00:00:00.000Z',
      type: 'provider.recovery',
      sessionId: 's_recovery',
      runId: 'run_recovery',
      turnId: 'turn_recovery',
      payload: {
        event: {
          stage: 'mid_stream_text',
          errorClass: 'connection_failure',
          attempt: 1,
          maxAttempts: 4,
          delayMs: 250,
          recoveryAction: 'stable_boundary_retry',
          ladderStep: 2,
          fallbackUsed: false,
        },
        meta: { contextKind: 'root' },
      },
    },
    'runtime_recovery',
  );

  assert.deepEqual(sessionEvents, [
    {
      runtimeEvent: {
        runtimeId: 'runtime_recovery',
        runId: 'run_recovery',
        journalEpoch: 'journal_epoch_1',
        seq: 41,
      },
      turnId: 'turn_recovery',
      kind: 'provider_recovery',
      sessionId: 's_recovery',
      stage: 'mid_stream_text',
      errorClass: 'connection_failure',
      attempt: 1,
      maxAttempts: 4,
      delayMs: 250,
      recoveryAction: 'stable_boundary_retry',
      ladderStep: 2,
      fallbackUsed: false,
    },
  ]);
  await adapter.close();
});

test('daemon bridge rejects malformed and transient child Provider recovery events', async () => {
  const sessionEvents: unknown[] = [];
  const adapter = new RuntimeHostAdapter({
    mode: 'runtime',
    push: (channel, payload) => {
      if (channel === 'session.event') sessionEvents.push(payload);
    },
  });
  const bridgeRuntimeEvent = bindTestRuntimeEventBridge(adapter);
  const recovery = {
    stage: 'mid_stream_text',
    errorClass: 'connection_failure',
    attempt: 1,
    maxAttempts: 4,
    delayMs: 250,
    recoveryAction: 'stable_boundary_retry',
    ladderStep: 2,
    fallbackUsed: false,
  } as const;

  bridgeRuntimeEvent({
    id: 'event_malformed_provider_recovery',
    seq: 42,
    time: '2026-08-14T00:00:01.000Z',
    type: 'provider.recovery',
    sessionId: 's_recovery',
    runId: 'run_recovery',
    turnId: 'turn_recovery',
    payload: {
      event: { ...recovery, recoveryAction: undefined },
      meta: { contextKind: 'root' },
    },
  } as import('@kodax-ai/kodax/runtime').RuntimeTypedEvent);
  bridgeRuntimeEvent({
    id: 'event_child_provider_recovery',
    seq: 43,
    time: '2026-08-14T00:00:02.000Z',
    type: 'provider.recovery',
    sessionId: 's_recovery',
    runId: 'run_recovery',
    turnId: 'turn_recovery',
    payload: {
      event: recovery,
      meta: {
        contextKind: 'child',
        contextId: 'child_context_1',
        parentContextId: 's_recovery',
        childAgentId: 'child_1',
        childAgentName: 'Researcher',
        liveOnly: true,
        workflowCorrelation: {
          workflowRunId: 'workflow_1',
          childAgentId: 'child_1',
        },
      },
    },
  } as import('@kodax-ai/kodax/runtime').RuntimeTypedEvent);

  assert.deepEqual(sessionEvents, []);
  await adapter.close();
});

test('daemon bridge projects root repo-intelligence traces onto the Repointel chip event', async () => {
  const sessionEvents: unknown[] = [];
  const adapter = new RuntimeHostAdapter({
    mode: 'runtime',
    push: (channel, payload) => {
      if (channel === 'session.event') sessionEvents.push(payload);
    },
  });
  const bridgeRuntimeEvent = bindTestRuntimeEventBridge(adapter);

  bridgeRuntimeEvent({
    id: 'event_repo_intel_trace',
    seq: 44,
    time: '2026-08-19T00:00:00.000Z',
    type: 'repo_intelligence.trace',
    sessionId: 's_repointel',
    runId: 'run_repointel',
    turnId: 'turn_repointel',
    payload: {
      stage: 'preturn',
      summary: 'stage=preturn | mode=full/full/ok | cache_hit=yes',
      capability: {
        mode: 'full',
        engine: 'full',
        level: 'enhanced',
        status: 'ok',
        warnings: [],
      },
      trace: {
        mode: 'full',
        engine: 'full',
        triggeredAt: '2026-08-19T00:00:00.000Z',
        source: 'full',
        cacheHit: true,
      },
    },
  });

  assert.deepEqual(sessionEvents, [
    {
      kind: 'repointel_trace',
      sessionId: 's_repointel',
      event: {
        kind: 'preturn',
        mode: 'full',
        engine: 'full',
        status: 'ok',
        cacheHit: true,
      },
    },
  ]);
  await adapter.close();
});

test('daemon bridge drops transient child repo-intelligence traces', async () => {
  const sessionEvents: unknown[] = [];
  const adapter = new RuntimeHostAdapter({
    mode: 'runtime',
    push: (channel, payload) => {
      if (channel === 'session.event') sessionEvents.push(payload);
    },
  });
  const bridgeRuntimeEvent = bindTestRuntimeEventBridge(adapter);

  bridgeRuntimeEvent({
    id: 'event_child_repo_intel_trace',
    seq: 45,
    time: '2026-08-19T00:00:01.000Z',
    type: 'repo_intelligence.trace',
    sessionId: 's_repointel',
    runId: 'run_repointel',
    turnId: 'turn_repointel',
    payload: {
      stage: 'module',
      summary: 'stage=module',
      capability: {
        mode: 'full',
        engine: 'full',
        level: 'enhanced',
        status: 'ok',
        warnings: [],
      },
      meta: {
        contextKind: 'child',
        contextId: 'child_context_1',
        parentContextId: 's_repointel',
        childAgentId: 'child_1',
        childAgentName: 'Researcher',
        liveOnly: true,
        workflowCorrelation: {
          workflowRunId: 'workflow_1',
          childAgentId: 'child_1',
        },
      },
    },
  } as import('@kodax-ai/kodax/runtime').RuntimeTypedEvent);

  assert.deepEqual(sessionEvents, []);
  await adapter.close();
});

test('daemon bridge routes child activity without inserting it into the primary transcript', async () => {
  const sessionEvents: unknown[] = [];
  const workflowActivities: unknown[] = [];
  const adapter = new RuntimeHostAdapter({
    mode: 'runtime',
    push: (channel, payload) => {
      if (channel === 'session.event') sessionEvents.push(payload);
      if (channel === 'workflow.activity') workflowActivities.push(payload);
    },
  });
  const bridgeRuntimeEvent = bindTestRuntimeEventBridge(adapter);
  const childMeta = {
    contextKind: 'child',
    contextId: 'child_context_1',
    parentContextId: 's_1',
    childAgentId: 'child_1',
    childAgentName: 'Researcher',
    liveOnly: true,
    workflowCorrelation: { workflowRunId: 'workflow_1', childAgentId: 'child_1' },
  } as const;

  const emit = (
    seq: number,
    type: import('@kodax-ai/kodax/runtime').RuntimeTypedEvent['type'],
    payload: unknown,
  ) => {
    bridgeRuntimeEvent({
      id: `event_${seq}`,
      seq,
      time: '2026-07-22T00:00:00.000Z',
      type,
      sessionId: 's_1',
      runId: 'run_1',
      payload,
    } as import('@kodax-ai/kodax/runtime').RuntimeTypedEvent);
  };

  emit(1, 'assistant.delta', { text: 'child answer must stay out', meta: childMeta });
  emit(2, 'thinking.delta', { text: 'child reasoning must stay out', meta: childMeta });
  emit(3, 'thinking.finished', { thinking: 'child reasoning done', meta: childMeta });
  emit(4, 'tool.started', {
    tool: { id: 'child_tool', name: 'read', input: { path: 'notes.md' } },
    meta: { ...childMeta, toolCallId: 'child_tool' },
  });
  emit(5, 'tool.progress', {
    update: { id: 'child_tool', message: 'reading' },
    meta: { ...childMeta, toolCallId: 'child_tool' },
  });
  emit(6, 'tool.finished', {
    result: { id: 'child_tool', name: 'read', content: 'done' },
    meta: { ...childMeta, toolCallId: 'child_tool' },
  });
  emit(7, 'todo.updated', {
    items: [{ id: 'child_todo', subject: 'Child work', status: 'completed' }],
    meta: childMeta,
  });
  emit(8, 'child_activity.finished', { meta: childMeta });

  emit(9, 'assistant.delta', { text: 'root answer', meta: { contextKind: 'root' } });
  emit(10, 'thinking.delta', { text: 'root reasoning', meta: { contextKind: 'root' } });
  emit(11, 'thinking.finished', {
    thinking: 'root reasoning done',
    meta: { contextKind: 'root' },
  });
  emit(12, 'tool.started', {
    tool: { id: 'root_tool', name: 'bash', input: { command: 'npm test' } },
    meta: { contextKind: 'root', toolCallId: 'root_tool' },
  });
  emit(13, 'tool.progress', {
    update: { id: 'root_tool', message: 'running' },
    meta: { contextKind: 'root', toolCallId: 'root_tool' },
  });
  emit(14, 'tool.finished', {
    result: { id: 'root_tool', name: 'bash', content: 'passed' },
    meta: { contextKind: 'root', toolCallId: 'root_tool' },
  });

  assert.deepEqual(sessionEvents, [
    { kind: 'text_delta', sessionId: 's_1', text: 'root answer' },
    { kind: 'thinking_delta', sessionId: 's_1', text: 'root reasoning' },
    { kind: 'thinking_end', sessionId: 's_1', thinking: 'root reasoning done' },
    {
      kind: 'tool_start',
      sessionId: 's_1',
      toolId: 'root_tool',
      toolName: 'bash',
      input: { command: 'npm test' },
    },
    {
      kind: 'tool_progress',
      sessionId: 's_1',
      toolId: 'root_tool',
      message: 'running',
    },
    {
      kind: 'tool_result',
      sessionId: 's_1',
      toolId: 'root_tool',
      toolName: 'bash',
      content: 'passed',
    },
  ]);
  assert.deepEqual(workflowActivities, [
    {
      runId: 'workflow_1',
      childAgentId: 'child_1',
      childAgentName: 'Researcher',
      kind: 'tool_use',
      toolName: 'read',
    },
    {
      runId: 'workflow_1',
      childAgentId: 'child_1',
      childAgentName: 'Researcher',
      kind: 'tool_result',
      toolName: 'read',
    },
    {
      runId: 'workflow_1',
      childAgentId: 'child_1',
      childAgentName: 'Researcher',
      kind: 'end',
    },
  ]);
  await adapter.close();
});

test('terminal Runtime events fail only undelivered interrupt inputs before closing the session', async () => {
  const terminalTypes = [
    ['run.completed', 'completed', 'run_completed', 'session_complete'],
    ['run.failed', 'failed', 'run_failed', 'session_error'],
    ['run.cancelled', 'cancelled', 'run_cancelled', 'session_error'],
    ['run.interrupted', 'interrupted', 'run_interrupted', 'session_error'],
  ] as const;

  for (const [type, phase, reason, sessionTerminalKind] of terminalTypes) {
    const pushed: unknown[] = [];
    const adapter = new RuntimeHostAdapter({
      mode: 'runtime',
      push: (channel, payload) => {
        if (channel === 'session.event') pushed.push(payload);
      },
    });
    const bridgeRuntimeEvent = bindTestRuntimeEventBridge(adapter);

    bridgeRuntimeEvent({
      id: `event_${type}`,
      seq: 1,
      time: '2026-07-21T00:00:02.000Z',
      type,
      sessionId: 's_1',
      runId: 'run_active',
      payload: {
        runId: 'run_active',
        sessionId: 's_1',
        phase,
        startedAt: '2026-07-21T00:00:00.000Z',
        provider: 'mock',
        interruptInputs: [
          {
            inputId: 'input-delivered',
            afterRunId: 'run_active',
            delivery: 'interrupt',
            state: 'delivered',
            contentPreview: 'already delivered',
            queuedAt: '2026-07-21T00:00:00.000Z',
            deliveredAt: '2026-07-21T00:00:01.000Z',
          },
          {
            inputId: 'input-terminal',
            afterRunId: 'run_active',
            delivery: 'interrupt',
            state: 'terminal',
            contentPreview: 'never delivered',
            queuedAt: '2026-07-21T00:00:01.500Z',
          },
        ],
      },
    });

    assert.deepEqual(pushed[0], {
      kind: 'queued_user_prompt_failed',
      sessionId: 's_1',
      queueId: 'input-terminal',
      queueMode: 'interrupt',
      content: 'never delivered',
      reason,
    });
    assert.equal(
      (pushed[1] as { kind?: string } | undefined)?.kind,
      sessionTerminalKind,
      `${type} must project the queue failure before the session terminal boundary`,
    );
    assert.equal(pushed.length, 2, `${type} must ignore already-delivered interrupts`);
    await adapter.close();
  }
});

test('daemon terminal sidecar block is surfaced as a notice and closes without a generic failure', async () => {
  const pushed: unknown[] = [];
  const adapter = new RuntimeHostAdapter({
    mode: 'runtime',
    push: (channel, payload) => {
      if (channel === 'session.event') pushed.push(payload);
    },
  });
  const bridgeRuntimeEvent = bindTestRuntimeEventBridge(adapter);

  bridgeRuntimeEvent(
    {
      id: 'event_sidecar_blocked',
      seq: 1,
      time: '2026-07-24T02:30:13.157Z',
      type: 'sidecar.message',
      sessionId: 's_1',
      runId: 'run_blocked',
      payload: {
        source: 'sidecar-verifier',
        verdict: 'blocked',
        recipient: 'user',
        delivery: 'terminal-block',
        content: 'Please confirm the next step.',
        suggestedFix: 'Reply with approval to continue.',
        trace: 'verifier_ok',
        sessionId: 's_1',
        seq: 91083,
      },
    },
    'rt_1',
  );
  bridgeRuntimeEvent({
    id: 'event_run_failed_after_block',
    seq: 2,
    time: '2026-07-24T02:30:16.281Z',
    type: 'run.failed',
    sessionId: 's_1',
    runId: 'run_blocked',
    payload: {
      runId: 'run_blocked',
      sessionId: 's_1',
      phase: 'failed',
      startedAt: '2026-07-24T02:26:35.310Z',
      endedAt: '2026-07-24T02:30:16.279Z',
      provider: 'mock',
      terminal: {
        revision: 1,
        kind: 'failed',
        code: 'run_failed',
        effectOutcome: 'known',
      },
    },
  });

  assert.deepEqual(pushed, [
    {
      kind: 'sidecar_message',
      sessionId: 's_1',
      sentAt: Date.parse('2026-07-24T02:30:13.157Z'),
      runtimeEvent: {
        runtimeId: 'rt_1',
        runId: 'run_blocked',
        journalEpoch: 'journal_epoch_1',
        seq: 1,
      },
      message: {
        source: 'sidecar-verifier',
        verdict: 'blocked',
        recipient: 'user',
        delivery: 'terminal-block',
        content: 'Please confirm the next step.',
        suggestedFix: 'Reply with approval to continue.',
        trace: 'verifier_ok',
      },
    },
    {
      kind: 'session_complete',
      sessionId: 's_1',
    },
  ]);
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

test('Runtime event coalescing capability is projected from the connected host', () => {
  const fake = createFakeRuntime();
  const adapter = new RuntimeHostAdapter({
    mode: 'runtime',
    profileRoot: path.resolve('C:\\isolated-profile'),
    runtimeFactory: async () => fake.runtime,
    identityStore: testIdentityStore,
  });
  const capabilities = (
    adapter as unknown as {
      spaceCapabilities(runtime: KodaXDaemonRuntime): readonly {
        id: string;
        version: number;
        available: boolean;
      }[];
    }
  ).spaceCapabilities(fake.runtime);

  assert.deepEqual(
    capabilities.find((item) => item.id === 'runtime.events.coalescing'),
    {
      id: 'runtime.events.coalescing',
      version: 1,
      available: true,
    },
  );
  assert.deepEqual(
    capabilities.find((item) => item.id === 'runtime.managedRuns.durability'),
    {
      id: 'runtime.managedRuns.durability',
      version: 1,
      available: true,
    },
  );
  assert.deepEqual(
    capabilities.find((item) => item.id === 'runtime.events.sessionJournal'),
    {
      id: 'runtime.events.sessionJournal',
      version: 1,
      available: true,
    },
  );
});

test('Runtime exact-history capabilities expose conversation, compaction, paging, and search separately', () => {
  const fake = createFakeRuntime();
  const adapter = new RuntimeHostAdapter({
    mode: 'runtime',
    profileRoot: path.resolve('C:\\isolated-profile'),
    runtimeFactory: async () => fake.runtime,
    identityStore: testIdentityStore,
    runtimeEventParser: testRuntimeEventParser,
  });
  const capabilities = (
    adapter as unknown as {
      spaceCapabilities(runtime: KodaXDaemonRuntime): readonly {
        id: string;
        version: number;
        available: boolean;
      }[];
    }
  ).spaceCapabilities(fake.runtime);

  assert.deepEqual(
    capabilities
      .filter((item) =>
        [
          'runtime.context.compaction',
          'runtime.conversation.history',
          'runtime.transcript.paging',
          'runtime.transcript.search',
        ].includes(item.id),
      )
      .map(({ id, version, available }) => ({ id, version, available })),
    [
      { id: 'runtime.context.compaction', version: 3, available: true },
      { id: 'runtime.conversation.history', version: 2, available: true },
      { id: 'runtime.transcript.paging', version: 1, available: true },
      { id: 'runtime.transcript.search', version: 1, available: true },
    ],
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

test('profile management conflicts cannot split terminal events from the live Run projection', async () => {
  const fake = createFakeRuntime();
  fake.sessions.add('s_1');
  const controller = new RuntimeProjectionController(
    createPendingSdkRuntimeProjection(100).profileSnapshot(),
  );
  const pushed: Array<{ channel: string; payload: unknown }> = [];
  const adapter = new RuntimeHostAdapter({
    mode: 'runtime',
    profileRoot: path.resolve('C:\\isolated-profile'),
    runtimeFactory: async () => fake.runtime,
    identityStore: testIdentityStore,
    runtimeEventParser: testRuntimeEventParser,
    projectionController: controller,
    integrationHealthPollMs: 5,
    push: (channel, payload) => pushed.push({ channel, payload }),
  });

  await adapter.initialize();
  await adapter.ensureObserved('s_1');
  await waitForTest(() => controller.profileSnapshot().connection.integrations !== undefined);
  const initialIntegrations = controller.profileSnapshot().connection.integrations;
  fake.runtime.daemon.inspect = async () => {
    fake.calls.daemonInspections += 1;
    throw Object.assign(new Error('Runtime state changed while daemon management was inspected.'), {
      code: 'conflict',
    });
  };

  fake.emit({
    id: 'evt_run_started_profile_conflict',
    seq: 1,
    time: '2026-08-01T15:25:24.204Z',
    sessionId: 's_1',
    runId: 'run_profile_conflict',
    turnId: 'turn_profile_conflict',
    type: 'run.started',
    payload: {
      runId: 'run_profile_conflict',
      sessionId: 's_1',
      turnId: 'turn_profile_conflict',
      phase: 'running',
      startedAt: '2026-08-01T15:25:24.204Z',
      provider: 'mock',
      mode: 'managed_task',
    },
  });
  await waitForTest(
    () => controller.sessionLiveSnapshot('s_1').activeRun?.runId === 'run_profile_conflict',
  );
  await waitForTest(() => fake.calls.daemonInspections >= 2);

  assert.equal(controller.profileSnapshot().connection.state, 'ready');
  assert.equal(controller.profileSnapshot().connection.stale, false);
  assert.deepEqual(controller.profileSnapshot().connection.integrations, initialIntegrations);

  fake.emit({
    id: 'evt_run_completed_profile_conflict',
    seq: 2,
    time: '2026-08-01T15:26:39.714Z',
    sessionId: 's_1',
    runId: 'run_profile_conflict',
    turnId: 'turn_profile_conflict',
    type: 'run.completed',
    payload: {
      runId: 'run_profile_conflict',
      sessionId: 's_1',
      turnId: 'turn_profile_conflict',
      phase: 'completed',
      startedAt: '2026-08-01T15:25:24.204Z',
      endedAt: '2026-08-01T15:26:39.705Z',
      provider: 'mock',
      mode: 'managed_task',
    },
  });

  await waitForTest(() => controller.sessionLiveSnapshot('s_1').activeRun === undefined);
  assert.equal(controller.profileSnapshot().connection.state, 'ready');
  assert.equal(
    pushed.some(
      ({ channel, payload }) =>
        channel === 'runtime.connectionChanged' &&
        (payload as { state?: string }).state === 'reconnecting',
    ),
    false,
  );
  assert.equal(
    pushed.some(
      ({ channel, payload }) =>
        channel === 'session.event' && (payload as { kind?: string }).kind === 'session_complete',
    ),
    true,
  );

  await adapter.close();
});

test('observation invalidation notifies renderer immediately before a blocked resync completes', async () => {
  const fake = createFakeRuntime();
  fake.sessions.add('s_1');
  const originalObserve = fake.runtime.sessions.observe.bind(fake.runtime.sessions);
  let observeAttempts = 0;
  let releaseSecondObserve!: () => void;
  const secondObserveGate = new Promise<void>((resolve) => {
    releaseSecondObserve = resolve;
  });
  let markSecondObserveStarted!: () => void;
  const secondObserveStarted = new Promise<void>((resolve) => {
    markSecondObserveStarted = resolve;
  });
  fake.runtime.sessions.observe = async (...args) => {
    observeAttempts += 1;
    if (observeAttempts === 2) {
      markSecondObserveStarted();
      await secondObserveGate;
    }
    return originalObserve(...args);
  };
  const controller = new RuntimeProjectionController(
    createPendingSdkRuntimeProjection(100).profileSnapshot(),
  );
  const pushed: Array<{ channel: string; payload: unknown }> = [];
  const adapter = new RuntimeHostAdapter({
    mode: 'runtime',
    profileRoot: path.resolve('C:\\isolated-profile'),
    runtimeFactory: async () => fake.runtime,
    identityStore: testIdentityStore,
    runtimeEventParser: testRuntimeEventParser,
    projectionController: controller,
    push: (channel, payload) => pushed.push({ channel, payload }),
  });

  await adapter.initialize();
  await adapter.ensureObserved('s_1');
  fake.invalidateObservation('s_1', 'event_overflow');
  await secondObserveStarted;

  assert.throws(() => controller.sessionLiveSnapshot('s_1'), RuntimeProjectionUnavailableError);
  assert.deepEqual(pushed.find(({ channel }) => channel === 'session.liveInvalidated')?.payload, {
    sessionId: 's_1',
    runtimeId: 'rt_test',
    reason: 'event_overflow',
    message: 'test event_overflow',
  });
  assert.equal(fake.calls.observationCloses, 1);

  releaseSecondObserve();
  await waitForTest(() => {
    try {
      return controller.sessionLiveSnapshot('s_1').sessionId === 's_1';
    } catch (error) {
      if (error instanceof RuntimeProjectionUnavailableError) return false;
      throw error;
    }
  });
  assert.equal(controller.sessionLiveSnapshot('s_1').sessionId, 's_1');

  await adapter.close();
  assert.equal(fake.calls.observationCloses, 2);
});

test('failed observation resync reconciles a terminal profile without staling a fresh Runtime snapshot', async () => {
  const fake = createFakeRuntime();
  fake.sessions.add('s_1');
  let active = true;
  const originalStatusSnapshot = fake.runtime.status.snapshot.bind(fake.runtime.status);
  fake.runtime.status.snapshot = async () => {
    const snapshot = await originalStatusSnapshot();
    return {
      ...snapshot,
      runs: active
        ? [
            {
              runId: 'run_1',
              sessionId: 's_1',
              phase: 'running' as const,
              provider: 'mock',
              mode: 'managed_task' as const,
              startedAt: '2026-08-01T04:00:00.000Z',
            },
          ]
        : [],
    };
  };
  const originalObserve = fake.runtime.sessions.observe.bind(fake.runtime.sessions);
  let observeAttempts = 0;
  fake.runtime.sessions.observe = async (...args) => {
    observeAttempts += 1;
    if (observeAttempts === 2) throw new Error('test observation recovery failed');
    return originalObserve(...args);
  };
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

  await adapter.initialize();
  assert.equal(controller.profileSnapshot().sessions[0]?.activeRun?.runId, 'run_1');
  await adapter.ensureObserved('s_1');
  active = false;
  fake.invalidateObservation('s_1', 'event_overflow');

  await waitForTest(
    () =>
      observeAttempts === 2 && controller.profileSnapshot().sessions[0]?.activeRun === undefined,
  );
  const profile = controller.profileSnapshot();
  assert.equal(profile.connection.state, 'ready');
  assert.equal(profile.connection.stale, false);
  assert.equal(profile.sessions[0]?.activeRun, undefined);
  assert.throws(() => controller.sessionLiveSnapshot('s_1'), RuntimeProjectionUnavailableError);

  await adapter.close();
});

test('failed observation resync retains Stop through a freshly reconciled active profile', async () => {
  const fake = createFakeRuntime();
  fake.sessions.add('s_1');
  const originalStatusSnapshot = fake.runtime.status.snapshot.bind(fake.runtime.status);
  fake.runtime.status.snapshot = async () => ({
    ...(await originalStatusSnapshot()),
    runs: [
      {
        runId: 'run_1',
        sessionId: 's_1',
        phase: 'running' as const,
        provider: 'mock',
        mode: 'managed_task' as const,
        startedAt: '2026-08-01T04:00:00.000Z',
      },
    ],
  });
  const originalObserve = fake.runtime.sessions.observe.bind(fake.runtime.sessions);
  let observeAttempts = 0;
  fake.runtime.sessions.observe = async (...args) => {
    observeAttempts += 1;
    if (observeAttempts === 2) throw new Error('test observation recovery failed');
    return originalObserve(...args);
  };
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

  await adapter.initialize();
  await adapter.ensureObserved('s_1');
  fake.invalidateObservation('s_1', 'event_overflow');

  await waitForTest(() => observeAttempts === 2);
  const profile = controller.profileSnapshot();
  assert.equal(profile.connection.state, 'ready');
  assert.equal(profile.connection.stale, false);
  assert.equal(profile.sessions[0]?.activeRun?.runId, 'run_1');
  assert.throws(() => controller.sessionLiveSnapshot('s_1'), RuntimeProjectionUnavailableError);

  await adapter.close();
});

test('failed observation and profile reconciliation mark the old fallback stale', async () => {
  const fake = createFakeRuntime();
  fake.sessions.add('s_1');
  const originalObserve = fake.runtime.sessions.observe.bind(fake.runtime.sessions);
  let observeAttempts = 0;
  fake.runtime.sessions.observe = async (...args) => {
    observeAttempts += 1;
    if (observeAttempts === 2) throw new Error('test observation recovery failed');
    return originalObserve(...args);
  };
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

  await adapter.initialize();
  await adapter.ensureObserved('s_1');
  fake.runtime.status.snapshot = async () => {
    throw new Error('test profile recovery failed');
  };
  fake.invalidateObservation('s_1', 'event_overflow');

  await waitForTest(() => controller.profileSnapshot().connection.state === 'degraded');
  const profile = controller.profileSnapshot();
  assert.equal(observeAttempts, 2);
  assert.equal(profile.connection.stale, true);
  assert.match(profile.connection.reason ?? '', /observation recovery failed/i);
  assert.throws(() => controller.sessionLiveSnapshot('s_1'), RuntimeProjectionUnavailableError);

  await adapter.close();
});

test('a late profile read from a replaced Runtime cannot overwrite the new attachment', async () => {
  const oldFake = createFakeRuntime();
  oldFake.sessions.add('s_old');
  const controller = new RuntimeProjectionController(
    createPendingSdkRuntimeProjection(100).profileSnapshot(),
  );
  const adapter = new RuntimeHostAdapter({
    mode: 'runtime',
    profileRoot: path.resolve('C:\\isolated-profile'),
    runtimeFactory: async () => oldFake.runtime,
    identityStore: testIdentityStore,
    runtimeEventParser: testRuntimeEventParser,
    projectionController: controller,
  });
  await adapter.initialize();

  const originalOldSnapshot = oldFake.runtime.status.snapshot.bind(oldFake.runtime.status);
  let releaseOldSnapshot!: () => void;
  const oldSnapshotGate = new Promise<void>((resolve) => {
    releaseOldSnapshot = resolve;
  });
  let markOldSnapshotStarted!: () => void;
  const oldSnapshotStarted = new Promise<void>((resolve) => {
    markOldSnapshotStarted = resolve;
  });
  oldFake.runtime.status.snapshot = async () => {
    markOldSnapshotStarted();
    await oldSnapshotGate;
    return originalOldSnapshot();
  };

  const privateAdapter = adapter as unknown as {
    runtime: KodaXDaemonRuntime;
    refreshProfile(cursor: number): Promise<void>;
  };
  const lateRefresh = privateAdapter.refreshProfile(1);
  await oldSnapshotStarted;

  const newFake = createFakeRuntime();
  newFake.sessions.add('s_new');
  privateAdapter.runtime = newFake.runtime;
  await privateAdapter.refreshProfile(2);
  assert.equal(controller.profileSnapshot().sessions[0]?.sessionId, 's_new');

  releaseOldSnapshot();
  await lateRefresh;
  assert.equal(controller.profileSnapshot().sessions[0]?.sessionId, 's_new');

  await adapter.close();
  await oldFake.runtime.close();
});

test('a replacement Runtime does not inherit the retired attachment profile cursor', async () => {
  const oldFake = createFakeRuntime();
  oldFake.sessions.add('s_old');
  const controller = new RuntimeProjectionController(
    createPendingSdkRuntimeProjection(100).profileSnapshot(),
  );
  const adapter = new RuntimeHostAdapter({
    mode: 'runtime',
    profileRoot: path.resolve('C:\\isolated-profile'),
    runtimeFactory: async () => oldFake.runtime,
    identityStore: testIdentityStore,
    runtimeEventParser: testRuntimeEventParser,
    projectionController: controller,
  });
  await adapter.initialize();

  const privateAdapter = adapter as unknown as {
    runtime: KodaXDaemonRuntime;
    currentProfileCursor(): number;
    advanceProfileCursor(runtime: KodaXDaemonRuntime, cursor: number): number;
    refreshProfile(cursor: number): Promise<void>;
  };
  await privateAdapter.refreshProfile(1_000);
  assert.equal(controller.profileSnapshot().cursor?.seq, 1_000);

  const replacement = createFakeRuntime('rt_replacement');
  replacement.sessions.add('s_new');
  privateAdapter.runtime = replacement.runtime;
  privateAdapter.advanceProfileCursor(replacement.runtime, 1);
  await privateAdapter.refreshProfile(privateAdapter.currentProfileCursor());

  assert.equal(controller.profileSnapshot().sessions[0]?.sessionId, 's_new');
  assert.equal(
    controller.profileSnapshot().cursor?.seq,
    1,
    'a new Runtime authority owns an independent cursor sequence',
  );

  await adapter.close();
  await oldFake.runtime.close();
});

test('same-Runtime profile reads are serialized and retain their requested causal cursor', async () => {
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
  await adapter.initialize();

  const originalSnapshot = fake.runtime.status.snapshot.bind(fake.runtime.status);
  let firstSnapshotStarted!: () => void;
  const firstStarted = new Promise<void>((resolve) => {
    firstSnapshotStarted = resolve;
  });
  let secondSnapshotStarted!: () => void;
  const secondStarted = new Promise<void>((resolve) => {
    secondSnapshotStarted = resolve;
  });
  let releaseFirst!: () => void;
  const firstGate = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  let releaseSecond!: () => void;
  const secondGate = new Promise<void>((resolve) => {
    releaseSecond = resolve;
  });
  let snapshotCalls = 0;
  fake.runtime.status.snapshot = async () => {
    snapshotCalls += 1;
    if (snapshotCalls === 1) {
      firstSnapshotStarted();
      await firstGate;
    } else if (snapshotCalls === 2) {
      secondSnapshotStarted();
      await secondGate;
    }
    return originalSnapshot();
  };

  const privateAdapter = adapter as unknown as {
    advanceProfileCursor(runtime: KodaXDaemonRuntime, cursor: number): number;
    refreshProfile(cursor: number): Promise<void>;
  };
  const firstRefresh = privateAdapter.refreshProfile(10);
  await firstStarted;
  privateAdapter.advanceProfileCursor(fake.runtime, 30);
  const secondRefresh = privateAdapter.refreshProfile(20);
  await new Promise<void>((resolve) => setImmediate(resolve));

  assert.equal(snapshotCalls, 1, 'a second read on the same Runtime must wait for the first');
  releaseFirst();
  await firstRefresh;
  assert.equal(
    controller.profileSnapshot().cursor?.seq,
    10,
    'an in-flight snapshot must not borrow a later Runtime cursor',
  );

  await secondStarted;
  releaseSecond();
  await secondRefresh;
  assert.equal(controller.profileSnapshot().cursor?.seq, 30);

  await adapter.close();
});

test('trusted observation recovery does not cross the active Session writer boundary', async () => {
  const records = new Map<string, Readonly<Record<string, unknown>>>([
    [
      's_active_writer_recovery',
      {
        title: '',
        messages: [],
        gitRoot: 'C:\\repo',
        tag: 'code',
      },
    ],
  ]);
  installPersistedSessionLookup(records);
  const fake = createFakeRuntime();
  fake.sessions.add('s_active_writer_recovery');
  const originalObserve = fake.runtime.sessions.observe.bind(fake.runtime.sessions);
  fake.runtime.sessions.observe = async (...args) => {
    const observation = await originalObserve(...args);
    return {
      ...observation,
      snapshot: {
        ...observation.snapshot,
        runs: [
          {
            runId: 'run_active_writer_recovery',
            sessionId: 's_active_writer_recovery',
            phase: 'running' as const,
            provider: 'mock',
            mode: 'managed_task' as const,
            startedAt: '2026-08-02T12:00:00.000Z',
          },
        ],
      },
    };
  };
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

  await adapter.initialize();
  await adapter.ensureObserved('s_active_writer_recovery');
  setSessionStoreImpl({
    listSessions: async () => [],
    forkSession: async () => null,
    rewindSession: async () => null,
    deleteSession: async () => ({ ok: true }),
    loadSession: async () => {
      throw Object.assign(new Error('Session data changed during the read boundary: active.lock'), {
        code: 'data_changed',
      });
    },
    watchSessions: () => ({ close() {} }),
  } as SessionStoreImpl);

  fake.invalidateObservation('s_active_writer_recovery', 'event_overflow');
  await waitForTest(() => fake.calls.observationCloses === 1);
  await waitForTest(() => {
    try {
      return (
        controller.sessionLiveSnapshot('s_active_writer_recovery').sessionId ===
        's_active_writer_recovery'
      );
    } catch (error) {
      if (error instanceof RuntimeProjectionUnavailableError) return false;
      throw error;
    }
  });

  assert.equal(fake.calls.observationCloses, 1);
  await adapter.close();
});

test('terminal Session observations retire and are not restored after reconnect', async () => {
  const first = createFakeRuntime();
  const second = createFakeRuntime();
  for (const fake of [first, second]) {
    fake.sessions.add('s_retire');
    fake.settings.set('s_retire', { revision: 0, value: {} });
  }
  let factoryCalls = 0;
  const runtimes = [first.runtime, second.runtime];
  const adapter = new RuntimeHostAdapter({
    mode: 'runtime',
    profileRoot: path.resolve('C:\\isolated-profile'),
    runtimeFactory: async () => {
      const runtime = runtimes[factoryCalls++];
      if (!runtime) throw new Error('unexpected Runtime reconnect attempt');
      return runtime;
    },
    identityStore: testIdentityStore,
    runtimeEventParser: testRuntimeEventParser,
  });

  await adapter.ensureObserved('s_retire');
  assert.deepEqual(first.calls.observed, ['s_retire']);
  assert.equal(first.calls.observationCloses, 0);

  first.emit({
    id: 'evt_retire_started',
    seq: 1,
    time: '2026-08-02T12:00:00.000Z',
    sessionId: 's_retire',
    runId: 'run_retire',
    turnId: 'turn_retire',
    type: 'run.started',
    payload: {
      runId: 'run_retire',
      sessionId: 's_retire',
      turnId: 'turn_retire',
      phase: 'running',
      startedAt: '2026-08-02T12:00:00.000Z',
      provider: 'mock',
    },
  });
  await waitForTest(() => adapter.activeRunId('s_retire') === 'run_retire');
  assert.equal(first.calls.observationCloses, 0);

  first.emit({
    id: 'evt_retire_completed',
    seq: 2,
    time: '2026-08-02T12:00:01.000Z',
    sessionId: 's_retire',
    runId: 'run_retire',
    turnId: 'turn_retire',
    type: 'run.completed',
    payload: {
      runId: 'run_retire',
      sessionId: 's_retire',
      turnId: 'turn_retire',
      phase: 'completed',
      startedAt: '2026-08-02T12:00:00.000Z',
      endedAt: '2026-08-02T12:00:01.000Z',
      provider: 'mock',
    },
  });
  await waitForTest(() => first.calls.observationCloses === 1);
  const actorTreeReadsAfterRetirement = first.calls.agentTrees.length;
  first.emitActor(
    's_retire',
    {
      sequence: 1,
      kind: 'turn_completed',
      actorPath: '/root',
      turnId: 'turn_retire',
      createdAt: '2026-08-02T12:00:01.000Z',
    },
    {
      rootPath: '/root',
      actors: [],
      activeNonRootTurns: 0,
      maxConcurrentThreads: 4,
      revision: 1,
    },
  );
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(first.calls.agentTrees.length, actorTreeReadsAfterRetirement);

  first.disconnect();
  await waitForTest(() => adapter.snapshot().state === 'uninitialized');
  await adapter.initialize();
  assert.deepEqual(second.calls.observed, []);
  await adapter.close();
});

test('observation reopen keeps the same terminal sidecar once and rejects retired owner events', async () => {
  const fake = createFakeRuntime();
  const pushed: unknown[] = [];
  const liveChanges: unknown[] = [];
  fake.sessions.add('s_reobserve');
  const originalObserve = fake.runtime.sessions.observe.bind(fake.runtime.sessions);
  let observationGeneration = 0;
  fake.runtime.sessions.observe = async (...args) => {
    const observation = await originalObserve(...args);
    observationGeneration += 1;
    if (observationGeneration === 1) return observation;
    const reopensTerminalOwner = observationGeneration === 2;
    return {
      ...observation,
      snapshot: {
        ...observation.snapshot,
        cursor: testRuntimeCursor('s_reobserve', reopensTerminalOwner ? 4 : 5),
        runs: [
          reopensTerminalOwner
            ? {
                runId: 'run_first',
                sessionId: 's_reobserve',
                turnId: 'turn_first',
                phase: 'completed' as const,
                provider: 'mock',
                mode: 'managed_task' as const,
                startedAt: '2026-08-05T01:00:00.000Z',
                endedAt: '2026-08-05T01:00:01.000Z',
              }
            : {
                runId: 'run_second',
                sessionId: 's_reobserve',
                turnId: 'turn_second',
                phase: 'running' as const,
                provider: 'mock',
                mode: 'managed_task' as const,
                startedAt: '2026-08-05T01:01:00.000Z',
                interruptInputs: [
                  {
                    inputId: 'input-shared',
                    afterRunId: 'run_second',
                    delivery: 'interrupt' as const,
                    state: 'queued' as const,
                    contentPreview: 'Current turn queued query.',
                    queuedAt: '2026-08-05T01:01:00.000Z',
                  },
                ],
              },
        ],
      },
    };
  };
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
    push: (channel, payload) => {
      if (channel === 'session.event') pushed.push(payload);
      if (channel === 'session.liveChanged') liveChanges.push(payload);
    },
  });

  await adapter.initialize();
  await adapter.ensureObserved('s_reobserve');
  fake.emit({
    id: 'evt_first_started',
    seq: 1,
    time: '2026-08-05T01:00:00.000Z',
    sessionId: 's_reobserve',
    runId: 'run_first',
    turnId: 'turn_first',
    type: 'run.started',
    payload: {
      runId: 'run_first',
      sessionId: 's_reobserve',
      turnId: 'turn_first',
      phase: 'running',
      provider: 'mock',
      startedAt: '2026-08-05T01:00:00.000Z',
    },
  });
  fake.emit({
    id: 'evt_first_sidecar',
    seq: 2,
    time: '2026-08-05T01:00:00.500Z',
    sessionId: 's_reobserve',
    runId: 'run_first',
    turnId: 'turn_first',
    type: 'sidecar.message',
    payload: {
      source: 'sidecar-verifier',
      verdict: 'revise',
      recipient: 'main-agent',
      delivery: 'synthetic-user-message',
      content: 'Retain this verifier message.',
    },
  });
  fake.emit({
    id: 'evt_first_completed',
    seq: 3,
    time: '2026-08-05T01:00:01.000Z',
    sessionId: 's_reobserve',
    runId: 'run_first',
    turnId: 'turn_first',
    type: 'run.completed',
    payload: {
      runId: 'run_first',
      sessionId: 's_reobserve',
      turnId: 'turn_first',
      phase: 'completed',
      provider: 'mock',
      startedAt: '2026-08-05T01:00:00.000Z',
      endedAt: '2026-08-05T01:00:01.000Z',
    },
  });
  await waitForTest(() => fake.calls.observationCloses === 1);
  const firstTerminalRevision = controller.sessionLiveSnapshot('s_reobserve').projectionRevision;

  await adapter.ensureObserved('s_reobserve');
  const reopenedTerminal = await adapter.readSessionLiveSnapshot('s_reobserve');
  assert.equal(reopenedTerminal.lastTerminalRun?.runId, 'run_first');
  assert.equal(reopenedTerminal.sidecarMessages?.length, 1);
  assert.equal(reopenedTerminal.sidecarMessages?.[0]?.eventId, 'evt_first_sidecar');
  await waitForTest(() => fake.calls.observationCloses === 2);

  await adapter.ensureObserved('s_reobserve');
  const second = controller.sessionLiveSnapshot('s_reobserve');
  assert.equal(second.activeRun?.runId, 'run_second');
  assert.deepEqual(second.sidecarMessages, []);
  assert.ok(second.projectionRevision > firstTerminalRevision);
  pushed.length = 0;
  liveChanges.length = 0;
  fake.emit({
    id: 'evt_late_retired_sidecar',
    seq: 6,
    time: '2026-08-05T01:01:00.500Z',
    sessionId: 's_reobserve',
    runId: 'run_first',
    turnId: 'turn_first',
    type: 'sidecar.message',
    payload: {
      source: 'sidecar-verifier',
      verdict: 'revise',
      recipient: 'main-agent',
      delivery: 'synthetic-user-message',
      content: 'This retired verifier result arrived too late.',
    },
  });
  fake.emit({
    id: 'evt_late_retired_delivery',
    seq: 7,
    time: '2026-08-05T01:01:01.000Z',
    sessionId: 's_reobserve',
    runId: 'run_first',
    turnId: 'turn_first',
    type: 'run.input.delivered',
    payload: {
      inputs: [
        {
          inputId: 'input-shared',
          entryId: 'entry-retired',
          afterRunId: 'run_first',
          input: [{ type: 'text', text: 'retired queued query' }],
          queuedAt: '2026-08-05T01:00:00.000Z',
          deliveredAt: '2026-08-05T01:01:01.000Z',
        },
      ],
    },
  });
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.deepEqual(pushed, []);
  assert.deepEqual(liveChanges, []);
  assert.deepEqual(controller.sessionLiveSnapshot('s_reobserve').sidecarMessages, []);
  await adapter.close();
});

test('observation invalidation preserves a monotonic live revision for a missed renderer signal', async () => {
  const fake = createFakeRuntime();
  fake.sessions.add('s_invalidated_revision');
  const originalObserve = fake.runtime.sessions.observe.bind(fake.runtime.sessions);
  let generation = 0;
  fake.runtime.sessions.observe = async (...args) => {
    const observation = await originalObserve(...args);
    generation += 1;
    return {
      ...observation,
      snapshot: {
        ...observation.snapshot,
        cursor: testRuntimeCursor('s_invalidated_revision', generation === 1 ? 0 : 4),
        runs: [
          {
            runId: generation === 1 ? 'run_before_invalidation' : 'run_after_invalidation',
            sessionId: 's_invalidated_revision',
            phase: 'running' as const,
            provider: 'mock',
            mode: 'managed_task' as const,
            startedAt: '2026-08-05T01:00:00.000Z',
          },
        ],
      },
    };
  };
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

  await adapter.initialize();
  await adapter.ensureObserved('s_invalidated_revision');
  fake.emit({
    id: 'evt_revision_progress_1',
    seq: 1,
    time: '2026-08-05T01:00:01.000Z',
    sessionId: 's_invalidated_revision',
    runId: 'run_before_invalidation',
    type: 'run.progress',
    payload: {
      kind: 'managed_task_status',
      status: {
        agentMode: 'ama',
        harnessProfile: 'H2_PLAN_EXECUTE_EVAL',
        currentRound: 1,
        maxRounds: 2,
        upgradeCeiling: 'H2_PLAN_EXECUTE_EVAL',
        phase: 'verifying',
      },
    },
  });
  fake.emit({
    id: 'evt_revision_progress_2',
    seq: 2,
    time: '2026-08-05T01:00:02.000Z',
    sessionId: 's_invalidated_revision',
    runId: 'run_before_invalidation',
    type: 'run.progress',
    payload: {
      kind: 'managed_task_status',
      status: {
        agentMode: 'ama',
        harnessProfile: 'H2_PLAN_EXECUTE_EVAL',
        currentRound: 2,
        maxRounds: 2,
        upgradeCeiling: 'H2_PLAN_EXECUTE_EVAL',
        phase: 'verifying',
      },
    },
  });
  await waitForTest(
    () => controller.sessionLiveSnapshot('s_invalidated_revision').projectionRevision >= 3,
  );
  const revisionBeforeInvalidation =
    controller.sessionLiveSnapshot('s_invalidated_revision').projectionRevision;

  fake.invalidateObservation('s_invalidated_revision', 'event_overflow');
  await waitForTest(() => {
    try {
      return (
        controller.sessionLiveSnapshot('s_invalidated_revision').activeRun?.runId ===
        'run_after_invalidation'
      );
    } catch (error: unknown) {
      if (error instanceof RuntimeProjectionUnavailableError) return false;
      throw error;
    }
  });
  assert.ok(
    controller.sessionLiveSnapshot('s_invalidated_revision').projectionRevision >
      revisionBeforeInvalidation,
  );
  await adapter.close();
});

test('a one-shot terminal Actor snapshot does not leave Session or Actor polling alive', async () => {
  const fake = createFakeRuntime();
  fake.sessions.add('s_actor_snapshot');
  const adapter = new RuntimeHostAdapter({
    mode: 'runtime',
    profileRoot: path.resolve('C:\\isolated-profile'),
    runtimeFactory: async () => fake.runtime,
    identityStore: testIdentityStore,
    runtimeEventParser: testRuntimeEventParser,
  });

  const snapshot = await adapter.actorTreeSnapshot('s_actor_snapshot');

  assert.equal(snapshot.sessionId, 's_actor_snapshot');
  assert.deepEqual(fake.calls.observed, ['s_actor_snapshot']);
  assert.equal(fake.calls.observationCloses, 1);
  const actorReadsAfterSnapshot = fake.calls.agentTrees.length;
  fake.emitActor(
    's_actor_snapshot',
    {
      sequence: 1,
      kind: 'turn_completed',
      actorPath: '/root',
      turnId: 'turn_terminal',
      createdAt: '2026-08-02T12:00:01.000Z',
    },
    {
      rootPath: '/root',
      actors: [],
      activeNonRootTurns: 0,
      maxConcurrentThreads: 4,
      revision: 1,
    },
  );
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(fake.calls.agentTrees.length, actorReadsAfterSnapshot);
  await adapter.close();
});

test('Actor snapshot rejects an old attachment after a same-runtime-id replacement', async () => {
  const first = createFakeRuntime('rt_actor_same_id');
  const second = createFakeRuntime('rt_actor_same_id');
  const sessionId = 's_actor_same_id_replacement';
  first.sessions.add(sessionId);
  second.sessions.add(sessionId);
  const adapter = new RuntimeHostAdapter({
    mode: 'runtime',
    profileRoot: path.resolve('C:\\isolated-profile'),
    runtimeFactory: async () => first.runtime,
    identityStore: testIdentityStore,
    runtimeEventParser: testRuntimeEventParser,
  });
  await adapter.initialize();

  const privateAdapter = adapter as unknown as {
    runtime: KodaXDaemonRuntime | null;
    state: string;
    ensureActorObserved(runtime: KodaXDaemonRuntime, sessionId: string): Promise<unknown>;
  };
  const ensureActorObserved = privateAdapter.ensureActorObserved.bind(privateAdapter);
  privateAdapter.ensureActorObserved = async (runtime, requestedSessionId) => {
    const observed = await ensureActorObserved(runtime, requestedSessionId);
    // Model the exact race: the old Actor observer is ready, then a replacement attachment with
    // the same public runtimeId becomes authoritative before the IPC continuation returns it.
    privateAdapter.runtime = second.runtime;
    privateAdapter.state = 'ready';
    return observed;
  };

  await assert.rejects(
    adapter.actorTreeSnapshot(sessionId),
    /connection changed while reading Agent Actor snapshot/i,
  );
  await adapter.close();
  await first.runtime.close();
});

test('concurrent Actor snapshots for one Session share the whole bootstrap operation', async () => {
  const fake = createFakeRuntime();
  const sessionId = 's_actor_snapshot_singleflight';
  fake.sessions.add(sessionId);
  const originalEvents = fake.runtime.agents.events.bind(fake.runtime.agents);
  let signalEventsStarted!: () => void;
  const eventsStarted = new Promise<void>((resolve) => {
    signalEventsStarted = resolve;
  });
  let releaseEvents!: () => void;
  const eventsGate = new Promise<void>((resolve) => {
    releaseEvents = resolve;
  });
  let eventCalls = 0;
  fake.runtime.agents.events = async (...args) => {
    eventCalls += 1;
    signalEventsStarted();
    await eventsGate;
    return originalEvents(...args);
  };
  const adapter = new RuntimeHostAdapter({
    mode: 'runtime',
    profileRoot: path.resolve('C:\\isolated-profile'),
    runtimeFactory: async () => fake.runtime,
    identityStore: testIdentityStore,
    runtimeEventParser: testRuntimeEventParser,
  });

  const first = adapter.actorTreeSnapshot(sessionId);
  await eventsStarted;
  const second = adapter.actorTreeSnapshot(sessionId);
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(eventCalls, 1);

  releaseEvents();
  const [firstSnapshot, secondSnapshot] = await Promise.all([first, second]);
  assert.deepEqual(secondSnapshot, firstSnapshot);
  assert.equal(eventCalls, 1);
  assert.equal(fake.calls.agentTrees.length, 1);
  await adapter.close();
});

test('Actor snapshot retirement waits for buffered observation demand', async () => {
  const fake = createFakeRuntime();
  fake.sessions.add('s_actor_buffered_run');
  const originalObserve = fake.runtime.sessions.observe.bind(fake.runtime.sessions);
  fake.runtime.sessions.observe = async (...args) => {
    const observation = await originalObserve(...args);
    args[1]?.(
      withTestRuntimeCursor({
        id: 'evt_buffered_run_started',
        seq: 1,
        time: '2026-08-02T12:00:00.000Z',
        sessionId: 's_actor_buffered_run',
        runId: 'run_buffered',
        turnId: 'turn_buffered',
        type: 'run.started',
        payload: {
          runId: 'run_buffered',
          sessionId: 's_actor_buffered_run',
          turnId: 'turn_buffered',
          phase: 'running',
          startedAt: '2026-08-02T12:00:00.000Z',
          provider: 'mock',
        },
      }),
    );
    return observation;
  };
  const adapter = new RuntimeHostAdapter({
    mode: 'runtime',
    profileRoot: path.resolve('C:\\isolated-profile'),
    runtimeFactory: async () => fake.runtime,
    identityStore: testIdentityStore,
    runtimeEventParser: testRuntimeEventParser,
  });

  await adapter.actorTreeSnapshot('s_actor_buffered_run');

  assert.equal(adapter.activeRunId('s_actor_buffered_run'), 'run_buffered');
  assert.equal(fake.calls.observationCloses, 0);
  await adapter.close();
  assert.equal(fake.calls.observationCloses, 1);
});

test('blocked Actor telemetry cannot hold the next cold Session observation', async () => {
  const fake = createFakeRuntime();
  fake.sessions.add('s_actor_blocker');
  fake.sessions.add('s_actor_follower');
  const agents = fake.runtime.agents as unknown as {
    tree(sessionId: string): Promise<AgentTreeSnapshot>;
  };
  const originalTree = agents.tree.bind(agents);
  let signalTreeStarted!: () => void;
  const treeStarted = new Promise<void>((resolve) => {
    signalTreeStarted = resolve;
  });
  let releaseTree!: () => void;
  const treeRelease = new Promise<void>((resolve) => {
    releaseTree = resolve;
  });
  agents.tree = async (sessionId) => {
    if (sessionId === 's_actor_blocker') {
      signalTreeStarted();
      await treeRelease;
    }
    return originalTree(sessionId);
  };
  const adapter = new RuntimeHostAdapter({
    mode: 'runtime',
    profileRoot: path.resolve('C:\\isolated-profile'),
    runtimeFactory: async () => fake.runtime,
    identityStore: testIdentityStore,
    runtimeEventParser: testRuntimeEventParser,
  });

  const firstOpening = adapter.ensureObserved('s_actor_blocker');
  await treeStarted;
  try {
    const history = await Promise.race([
      adapter.conversationHistoryPage({ sessionId: 's_actor_follower' }),
      new Promise<never>((_resolve, reject) => {
        setTimeout(() => reject(new Error('history waited for Actor telemetry')), 250);
      }),
    ]);
    assert.equal(history.outcome, 'ready');

    const follower = await Promise.race([
      adapter.readSessionLiveSnapshot('s_actor_follower'),
      new Promise<never>((_resolve, reject) => {
        setTimeout(() => reject(new Error('cold observation waited for Actor telemetry')), 250);
      }),
    ]);
    assert.equal(follower.sessionId, 's_actor_follower');
  } finally {
    releaseTree();
    await firstOpening;
    await adapter.close();
  }
});

test('a successfully resynced terminal invalidation retires its replacement observation', async () => {
  const fake = createFakeRuntime();
  fake.sessions.add('s_terminal_resync');
  const adapter = new RuntimeHostAdapter({
    mode: 'runtime',
    profileRoot: path.resolve('C:\\isolated-profile'),
    runtimeFactory: async () => fake.runtime,
    identityStore: testIdentityStore,
    runtimeEventParser: testRuntimeEventParser,
  });

  await adapter.ensureObserved('s_terminal_resync');
  fake.emit({
    id: 'evt_compaction_before_invalidation',
    seq: 1,
    time: '2026-08-02T12:00:00.000Z',
    sessionId: 's_terminal_resync',
    runId: 'run_compaction_before_invalidation',
    type: 'context.compaction.started',
    payload: { meta: { contextId: 'ctx_root', contextKind: 'root' } },
  });
  await new Promise<void>((resolve) => setImmediate(resolve));
  fake.invalidateObservation('s_terminal_resync', 'event_overflow');

  await waitForTest(() => fake.calls.observed.length === 2);
  await waitForTest(() => fake.calls.observationCloses === 2);
  await adapter.close();
  assert.equal(fake.calls.observationCloses, 2);
});

test('invalidation preserves only a factually in-flight local compaction call', async () => {
  const fake = createFakeRuntime();
  fake.sessions.add('s_local_compaction_resync');
  let markCompactStarted!: () => void;
  const compactStarted = new Promise<void>((resolve) => {
    markCompactStarted = resolve;
  });
  let releaseCompact!: () => void;
  const compactGate = new Promise<void>((resolve) => {
    releaseCompact = resolve;
  });
  fake.runtime.sessions.compact = async () => {
    markCompactStarted();
    await compactGate;
    return { compacted: true, tokensBefore: 200, tokensAfter: 80, messages: [] };
  };
  const adapter = new RuntimeHostAdapter({
    mode: 'runtime',
    profileRoot: path.resolve('C:\\isolated-profile'),
    runtimeFactory: async () => fake.runtime,
    identityStore: testIdentityStore,
    runtimeEventParser: testRuntimeEventParser,
  });

  const compacting = adapter.compactSession({
    sessionId: 's_local_compaction_resync',
    provider: 'mock',
  });
  await compactStarted;
  fake.invalidateObservation('s_local_compaction_resync', 'event_overflow');
  await waitForTest(() => fake.calls.observed.length === 2);
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(fake.calls.observationCloses, 1);

  releaseCompact();
  await compacting;
  await waitForTest(() => fake.calls.observationCloses === 2);
  await adapter.close();
  assert.equal(fake.calls.observationCloses, 2);
});

test('a disconnected compaction marker cannot keep a fresh terminal observation alive', async () => {
  const first = createFakeRuntime();
  const second = createFakeRuntime();
  for (const fake of [first, second]) {
    fake.sessions.add('s_compaction_reconnect');
    fake.settings.set('s_compaction_reconnect', { revision: 0, value: {} });
  }
  let factoryCalls = 0;
  const runtimes = [first.runtime, second.runtime];
  const adapter = new RuntimeHostAdapter({
    mode: 'runtime',
    profileRoot: path.resolve('C:\\isolated-profile'),
    runtimeFactory: async () => {
      const runtime = runtimes[factoryCalls++];
      if (!runtime) throw new Error('unexpected Runtime reconnect attempt');
      return runtime;
    },
    identityStore: testIdentityStore,
    runtimeEventParser: testRuntimeEventParser,
  });

  await adapter.ensureObserved('s_compaction_reconnect');
  first.emit({
    id: 'evt_compaction_before_disconnect',
    seq: 1,
    time: '2026-08-02T12:00:00.000Z',
    sessionId: 's_compaction_reconnect',
    runId: 'run_compaction_reconnect',
    type: 'context.compaction.started',
    payload: { meta: { contextId: 'ctx_root', contextKind: 'root' } },
  });
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(first.calls.observationCloses, 0);

  first.disconnect();
  await waitForTest(() => adapter.snapshot().state === 'uninitialized');
  await adapter.initialize();

  await waitForTest(() => second.calls.observationCloses === 1);
  assert.deepEqual(second.calls.observed, ['s_compaction_reconnect']);
  assert.equal(second.calls.observationCloses, 1);
  await adapter.close();
});

test('an active context compaction retains observation until its canonical end', async () => {
  const fake = createFakeRuntime();
  fake.sessions.add('s_compacting');
  const adapter = new RuntimeHostAdapter({
    mode: 'runtime',
    profileRoot: path.resolve('C:\\isolated-profile'),
    runtimeFactory: async () => fake.runtime,
    identityStore: testIdentityStore,
    runtimeEventParser: testRuntimeEventParser,
  });
  await adapter.ensureObserved('s_compacting');
  fake.emit({
    id: 'evt_compaction_started',
    seq: 1,
    time: '2026-08-02T12:00:00.000Z',
    sessionId: 's_compacting',
    runId: 'run_compacting',
    type: 'context.compaction.started',
    payload: { meta: { contextId: 'ctx_root', contextKind: 'root' } },
  });
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(fake.calls.observationCloses, 0);

  fake.emit({
    id: 'evt_compaction_ended',
    seq: 2,
    time: '2026-08-02T12:00:01.000Z',
    sessionId: 's_compacting',
    runId: 'run_compacting',
    type: 'context.compaction.ended',
    payload: { meta: { contextId: 'ctx_root', contextKind: 'root' } },
  });
  await waitForTest(() => fake.calls.observationCloses === 1);
  await adapter.close();
});

test('Coder observation pushes canonical Actor tree changes with an independent cursor', async () => {
  const fake = createFakeRuntime();
  fake.sessions.add('s_1');
  const pushed: unknown[] = [];
  const adapter = new RuntimeHostAdapter({
    mode: 'runtime',
    profileRoot: path.resolve('C:\\isolated-profile'),
    runtimeFactory: async () => fake.runtime,
    identityStore: testIdentityStore,
    runtimeEventParser: testRuntimeEventParser,
    push: (channel, payload) => {
      if (channel === 'agent.actor.changed') pushed.push(payload);
    },
  });

  await adapter.ensureObserved('s_1');
  assert.equal(pushed.length, 1);
  assert.equal((pushed[0] as { eventCursor: number }).eventCursor, 0);

  const changedTree: AgentTreeSnapshot = {
    rootPath: '/root',
    actors: [
      {
        path: '/root',
        taskName: 'root',
        kind: 'native',
        state: 'running',
        capabilities: {
          tools: [],
          filesystem: 'write',
          network: true,
          providers: [],
          canAskUser: true,
        },
        turnIds: ['turn_root'],
        currentTurnId: 'turn_root',
        mailboxCursor: 0,
        createdAt: '2026-07-27T00:00:00.000Z',
        updatedAt: '2026-07-27T00:00:02.000Z',
        revision: 2,
      },
      {
        path: '/root/reviewer',
        taskName: 'reviewer',
        parentPath: '/root',
        kind: 'native',
        state: 'running',
        capabilities: {
          tools: [],
          filesystem: 'read',
          network: false,
          providers: [],
          canAskUser: false,
        },
        turnIds: ['turn_review'],
        currentTurnId: 'turn_review',
        mailboxCursor: 0,
        createdAt: '2026-07-27T00:00:01.000Z',
        updatedAt: '2026-07-27T00:00:02.000Z',
        revision: 2,
        latestTurn: {
          turnId: 'turn_review',
          state: 'running',
          summary: 'Reviewing the patch',
          summaryTruncated: false,
          recentActivity: [],
        },
      },
    ],
    activeNonRootTurns: 1,
    maxConcurrentThreads: 4,
    revision: 2,
  };
  fake.emitActor(
    's_1',
    {
      sequence: 1,
      kind: 'turn_started',
      actorPath: '/root/reviewer',
      turnId: 'turn_review',
      createdAt: '2026-07-27T00:00:02.000Z',
    },
    changedTree,
  );
  await waitForTest(() => pushed.length === 2);

  const snapshot = pushed[1] as {
    eventCursor: number;
    activeNonRootTurns: number;
    actors: Array<{ path: string; currentTurnId?: string }>;
  };
  assert.equal(snapshot.eventCursor, 1);
  assert.equal(snapshot.activeNonRootTurns, 1);
  assert.equal(snapshot.actors[1]?.path, '/root/reviewer');
  assert.equal(snapshot.actors[1]?.currentTurnId, 'turn_review');
  assert.deepEqual(fake.calls.agentEvents.slice(0, 2), [
    { sessionId: 's_1', afterSequence: 0 },
    { sessionId: 's_1', afterSequence: 0 },
  ]);
  await adapter.close();
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

test('deleting a Runtime-missing session is idempotent and allows legacy cleanup', async () => {
  const fake = createFakeRuntime();
  const adapter = new RuntimeHostAdapter({
    mode: 'runtime',
    profileRoot: path.resolve('C:\\isolated-profile'),
    runtimeFactory: async () => fake.runtime,
    identityStore: testIdentityStore,
    runtimeEventParser: testRuntimeEventParser,
  });

  assert.equal(await adapter.deleteSession('s_missing'), 'not_found');
  await adapter.close();
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
  await waitForTest(() => kodaxHost.get('s_auto_default_model')?.reasoningMode === 'high');

  assert.equal(kodaxHost.get('s_auto_default_model')?.model, 'glm-5.3');
  assert.equal(kodaxHost.get('s_auto_default_model')?.reasoningMode, 'high');
  await adapter.close();
});

test('observation with an omitted model preserves an explicit create-time model', async (t) => {
  // Mirror of the Auto-LLM default-materialization test above: the daemon
  // admission snapshot omits `model` because Space has not pushed its settings
  // yet. An explicit create-time model must survive that install-time recovery;
  // "absent snapshot model" means "no daemon override", not "use provider default".
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
    existingSessionId: 's_explicit_model',
    projectRoot: path.resolve('C:\\project'),
    provider: 'zai-coding',
    model: 'glm-5.3',
    permissionMode: 'auto',
    autoModeEngine: 'llm',
  });

  const fake = createFakeRuntime();
  fake.sessions.add('s_explicit_model');
  fake.settings.set('s_explicit_model', {
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

  await adapter.ensureObserved('s_explicit_model');
  await waitForTest(() => kodaxHost.get('s_explicit_model')?.reasoningMode === 'high');

  assert.equal(kodaxHost.get('s_explicit_model')?.model, 'glm-5.3');
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
  assert.deepEqual(await adapter.learningContext(), { runtimeId: 'rt_test' });
  assert.deepEqual(await adapter.learningEvents(1), []);
  await adapter.acknowledgeLearnedCapability('learned-capability');
  await adapter.controlLearnedCapability('trust', 'learned-capability');
  assert.deepEqual(fake.calls.learningAcknowledgements, ['learned-capability']);
  assert.deepEqual(fake.calls.learningControls, [
    { action: 'trust', nameOrSlug: 'learned-capability' },
  ]);
  await adapter.close();
});

test('Runtime external Agent mutations validate session Actor/Turn ownership before control', async () => {
  const fake = createFakeRuntime();
  fake.sessions.add('s_1');
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
    idleDaemonStop: async () => {
      throw new Error('must not attempt to stop a daemon with known blockers');
    },
  });

  await assert.rejects(adapter.initialize(), /runtimeAutoModeGuardrail/);
  assert.match(adapter.snapshot().error ?? '', /capability upgrade required/i);
  assert.match(adapter.snapshot().error ?? '', /automatic restart is blocked/i);
  assert.match(adapter.snapshot().error ?? '', /active_runs, pending_interactions/);
  await adapter.close();

  const attemptedError = Object.assign(new Error('durable settlement needs recovery'), {
    code: 'daemon_capability_upgrade_required',
    recoverable: true,
    restartRequired: true,
    preflight: { blockers: [] },
  });
  const attemptedAdapter = new RuntimeHostAdapter({
    mode: 'runtime',
    profileRoot: path.resolve('C:\\isolated-profile'),
    runtimeFactory: async () => Promise.reject(attemptedError),
    identityStore: testIdentityStore,
  });
  await assert.rejects(attemptedAdapter.initialize(), /durable settlement/);
  assert.match(
    attemptedAdapter.snapshot().error ?? '',
    /replacement was attempted but did not complete/i,
  );
  assert.doesNotMatch(attemptedAdapter.snapshot().error ?? '', /reconnect automatically/i);
  await attemptedAdapter.close();
});
