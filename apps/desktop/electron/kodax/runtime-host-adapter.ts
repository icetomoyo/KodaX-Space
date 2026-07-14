import path from 'node:path';

import type {
  ConnectKodaXRuntimeOptions,
  KodaXRuntime,
  RuntimeIdentity,
  RuntimeAppendNoticeInput,
  RuntimeCompactSessionInput,
  RuntimeCompactSessionResult,
  RuntimeForkSessionInput,
  RuntimeRewindSessionInput,
  RuntimeRunHandle,
  RuntimeRunStatus,
  RuntimeSessionObservation,
  RuntimeSessionFilter,
  RuntimeSessionSettings,
  RuntimeSessionSettingsPatch,
  RuntimeSessionSummary,
  RuntimeStartRunInput,
  RuntimeSubmitInput,
  RuntimeTranscript,
} from '@kodax-ai/kodax/runtime';
import { getKodaxRuntimeDir } from './data-paths.js';
import { invalidatePersistedSessionCache, SPACE_EPHEMERAL_SESSION_TAG } from './session-store.js';
import { RuntimeClientIdentityStore } from './runtime/runtime-client-identity.js';
import {
  CoderSessionProjectionReducer,
  projectRuntimeProfile,
  projectRuntimeSessionSnapshot,
} from './runtime/coder-daemon-projection.js';
import {
  createPendingSdkRuntimeProjection,
  runtimeProjectionController,
  type RuntimeProjectionController,
} from './runtime/runtime-projection-controller.js';
import { pushToRenderer } from '../ipc/push.js';
import { sessionEventChannel } from '@kodax-space/space-ipc-schema';

export type RuntimeHostMode = 'legacy' | 'runtime';
export type RuntimeHostState =
  | 'uninitialized'
  | 'initializing'
  | 'legacy'
  | 'ready'
  | 'failed'
  | 'closed';
export type RuntimeCapabilityOwner = 'runtime' | 'space-bridge' | 'legacy' | 'unavailable';
export type RuntimeCapabilitySupport = 'supported' | 'partial' | 'unavailable';

export interface RuntimeHostCapability {
  readonly id: string;
  readonly support: RuntimeCapabilitySupport;
  readonly owner: RuntimeCapabilityOwner;
  readonly reason?: string;
}

export interface RuntimeHostSnapshot {
  readonly selectedHost: RuntimeHostMode;
  readonly state: RuntimeHostState;
  readonly identity?: RuntimeIdentity;
  readonly error?: string;
  readonly capabilities: readonly RuntimeHostCapability[];
}

export interface RuntimeSessionIdentity {
  readonly sessionId: string;
  readonly projectRoot: string;
  readonly surface: 'code' | 'partner';
  readonly ephemeral: boolean;
}

type RuntimeFactory = (options: ConnectKodaXRuntimeOptions) => Promise<KodaXRuntime>;

interface RuntimeProjectionPush {
  (
    channel: 'runtime.connectionChanged',
    payload: ReturnType<RuntimeProjectionController['profileSnapshot']>['connection'],
  ): void;
  (
    channel: 'runtime.profileChanged',
    payload: ReturnType<RuntimeProjectionController['profileSnapshot']>,
  ): void;
  (
    channel: 'session.liveChanged',
    payload: import('@kodax-space/space-ipc-schema').SpaceSessionLiveChangedT,
  ): void;
  (
    channel: 'session.event',
    payload: import('@kodax-space/space-ipc-schema').SessionEvent,
  ): void;
}

interface RuntimeIdentityStoreLike {
  openInstance(metadata: {
    readonly name: string;
    readonly title?: string;
    readonly version: string;
  }): Promise<{
    readonly clientId: string;
    readonly instanceId: string;
    readonly name: string;
    readonly title?: string;
    readonly version: string;
  }>;
}

export interface RuntimeHostAdapterOptions {
  readonly mode?: RuntimeHostMode;
  readonly profileRoot?: string;
  readonly runtimeFactory?: RuntimeFactory;
  readonly identityStore?: RuntimeIdentityStoreLike;
  readonly projectionController?: RuntimeProjectionController;
  readonly push?: RuntimeProjectionPush;
  readonly credentialResolver?: (provider: string) => Promise<string | undefined>;
}

const MAX_DIAGNOSTIC_ERROR = 512;

export function resolveRuntimeHostMode(value: string | undefined): RuntimeHostMode {
  return value?.trim().toLowerCase() === 'legacy' ? 'legacy' : 'runtime';
}

function sanitizeDiagnosticError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/([A-Za-z]:[\\/][^\s]+|\\\\[^\s]+|\/[A-Za-z][^\s]+)/g, '<path>')
    .slice(0, MAX_DIAGNOSTIC_ERROR);
}

async function createPublishedRuntime(options: ConnectKodaXRuntimeOptions): Promise<KodaXRuntime> {
  const sdk = await import('@kodax-ai/kodax/runtime');
  return sdk.connectKodaXRuntime(options);
}

function capability(
  id: string,
  support: RuntimeCapabilitySupport,
  owner: RuntimeCapabilityOwner,
  reason?: string,
): RuntimeHostCapability {
  return { id, support, owner, ...(reason !== undefined ? { reason } : {}) };
}

function capabilitiesFor(mode: RuntimeHostMode, state: RuntimeHostState): RuntimeHostCapability[] {
  if (mode === 'legacy' || state === 'legacy') {
    return [
      capability('runtime.host', 'partial', 'legacy', 'Internal rollback path selected.'),
      capability('runtime.sessions', 'partial', 'legacy'),
      capability('runtime.runs', 'partial', 'legacy'),
      capability('runtime.events', 'partial', 'legacy'),
      capability('runtime.permissions', 'supported', 'space-bridge'),
      capability('runtime.workflows', 'partial', 'space-bridge'),
      capability('runtime.mcp', 'partial', 'space-bridge'),
      capability('runtime.externalAgents', 'partial', 'space-bridge'),
      capability('runtime.worker', 'unavailable', 'unavailable', 'v0.1.31 is inline-first.'),
      capability(
        'runtime.daemon',
        'unavailable',
        'unavailable',
        'v0.1.31 does not attach to a daemon.',
      ),
    ];
  }
  if (state === 'failed') {
    return [
      capability(
        'runtime.host',
        'unavailable',
        'unavailable',
        'Coder daemon initialization failed; inline Coder fallback is intentionally disabled.',
      ),
      capability('runtime.sessions', 'unavailable', 'unavailable'),
      capability('runtime.runs', 'unavailable', 'unavailable'),
      capability('runtime.events', 'unavailable', 'unavailable'),
      capability('runtime.permissions', 'supported', 'space-bridge'),
      capability('runtime.workflows', 'partial', 'space-bridge'),
      capability('runtime.mcp', 'partial', 'space-bridge'),
      capability('runtime.externalAgents', 'partial', 'space-bridge'),
      capability('runtime.worker', 'unavailable', 'unavailable'),
      capability('runtime.daemon', 'unavailable', 'unavailable'),
    ];
  }
  if (state === 'closed') {
    return [
      capability('runtime.host', 'unavailable', 'unavailable', `Runtime host is ${state}.`),
      capability('runtime.sessions', 'unavailable', 'unavailable'),
      capability('runtime.runs', 'unavailable', 'unavailable'),
      capability('runtime.events', 'unavailable', 'unavailable'),
      capability('runtime.permissions', 'supported', 'space-bridge'),
      capability('runtime.workflows', 'partial', 'space-bridge'),
      capability('runtime.mcp', 'partial', 'space-bridge'),
      capability('runtime.externalAgents', 'partial', 'space-bridge'),
      capability('runtime.worker', 'unavailable', 'unavailable'),
      capability('runtime.daemon', 'unavailable', 'unavailable'),
    ];
  }
  const runtimeReady = state === 'ready';
  return [
    capability('runtime.host', runtimeReady ? 'supported' : 'partial', 'runtime'),
    capability(
      'runtime.sessions',
      'partial',
      'space-bridge',
      'Runtime owns transcript, compact, fork, and rewind; Space retains compatible list, resume, title, and delete projections.',
    ),
    capability('runtime.runs', runtimeReady ? 'supported' : 'partial', 'runtime'),
    capability('runtime.events', runtimeReady ? 'supported' : 'partial', 'runtime'),
    capability('runtime.permissions', runtimeReady ? 'supported' : 'partial', 'runtime'),
    capability(
      'runtime.workflows',
      'partial',
      'space-bridge',
      'Space retains durable lifecycle, immediate stop projection, origin, library, and admin semantics.',
    ),
    capability(
      'runtime.catalog',
      'partial',
      'space-bridge',
      'Runtime catalog is available, while existing Space provider and command projections remain authoritative.',
    ),
    capability('runtime.mcp', 'partial', 'space-bridge', 'Space owns server processes and logs.'),
    capability(
      'runtime.artifacts',
      'partial',
      'space-bridge',
      'Space owns product artifact stores and binds its host tools only to Space-started runs.',
    ),
    capability(
      'runtime.externalAgents',
      'partial',
      'space-bridge',
      'Space owns the durable executor plane store.',
    ),
    capability(
      'runtime.worker',
      'unavailable',
      'unavailable',
      'Function-valued Space bindings are inline-only.',
    ),
    capability(
      'runtime.daemon',
      runtimeReady ? 'supported' : 'partial',
      'runtime',
      'Coder only; Partner remains on its independent inline owner.',
    ),
  ];
}

function isSessionNotFound(error: unknown): boolean {
  return /Session not found:/i.test(error instanceof Error ? error.message : String(error));
}

export class RuntimeHostAdapter {
  private readonly mode: RuntimeHostMode;
  private readonly profileRoot: string;
  private readonly runtimeFactory: RuntimeFactory;
  private readonly identityStore: RuntimeIdentityStoreLike;
  private readonly projectionController: RuntimeProjectionController;
  private readonly push: RuntimeProjectionPush;
  private readonly credentialResolver: (provider: string) => Promise<string | undefined>;
  private state: RuntimeHostState = 'uninitialized';
  private runtime: KodaXRuntime | null = null;
  private initializePromise: Promise<void> | null = null;
  private closePromise: Promise<void> | null = null;
  private lastError: string | undefined;
  private readonly activeRuns = new Map<string, string>();
  private readonly observations = new Map<
    string,
    {
      readonly observation: RuntimeSessionObservation;
      readonly reducer: CoderSessionProjectionReducer;
      eventQueue: Promise<void>;
    }
  >();
  private readonly observationPromises = new Map<string, Promise<void>>();
  private readonly runProviders = new Map<string, string>();
  private readonly continuationCredentialLeases = new Map<string, string>();
  private readonly continuationPrompts = new Map<
    string,
    { readonly sessionId: string; readonly content: string }
  >();
  private profileRevision = 0;
  private profileCursor = 0;
  private profileRefreshQueue: Promise<void> = Promise.resolve();
  private hostToolLeaseId: string | undefined;
  private watchdog: ReturnType<typeof setInterval> | undefined;
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  private reconnectAttempt = 0;
  private watchdogPoll: Promise<void> | undefined;

  constructor(options: RuntimeHostAdapterOptions = {}) {
    this.mode = options.mode ?? resolveRuntimeHostMode(process.env.KODAX_SPACE_RUNTIME_HOST);
    this.profileRoot = path.resolve(options.profileRoot ?? getKodaxRuntimeDir());
    this.runtimeFactory = options.runtimeFactory ?? createPublishedRuntime;
    this.identityStore =
      options.identityStore ??
      new RuntimeClientIdentityStore(
        path.join(this.profileRoot, 'space', 'runtime-client-identity.json'),
      );
    this.projectionController =
      options.projectionController ?? createPendingSdkRuntimeProjection();
    this.push = options.push ?? (() => undefined);
    this.credentialResolver =
      options.credentialResolver ??
      (async (provider) =>
        (await import('../ipc/provider.js')).readProviderCredential(provider));
  }

  selectedHost(): RuntimeHostMode {
    return this.mode;
  }

  isRuntimeSelected(): boolean {
    return this.mode === 'runtime';
  }

  hasReadyRuntime(): boolean {
    return this.mode === 'runtime' && this.state === 'ready' && this.runtime !== null;
  }

  snapshot(): RuntimeHostSnapshot {
    return {
      selectedHost: this.mode,
      state: this.state,
      ...(this.runtime !== null ? { identity: this.runtime.identity } : {}),
      ...(this.lastError !== undefined ? { error: this.lastError } : {}),
      capabilities: capabilitiesFor(this.mode, this.state),
    };
  }

  initialize(clientVersion?: string): Promise<void> {
    if (this.mode === 'legacy') {
      this.state = 'legacy';
      return Promise.resolve();
    }
    if (this.state === 'ready') return Promise.resolve();
    if (this.state === 'closed') return Promise.reject(new Error('Runtime host is closed'));
    if (this.initializePromise !== null) return this.initializePromise;
    this.state = 'initializing';
    const version = clientVersion?.trim() || '0.1.32';
    let pendingRuntime: KodaXRuntime | null = null;
    this.initializePromise = this.identityStore
      .openInstance({ name: 'kodax-space', title: 'KodaX Space', version })
      .then(async (identity) => {
        const runtime = await this.runtimeFactory({
          profile: 'coder',
          autoStart: true,
          homeDir: this.profileRoot,
          sessionsDir: path.join(this.profileRoot, 'sessions'),
          clientInfo: {
            name: identity.name,
            ...(identity.title !== undefined ? { title: identity.title } : {}),
            version: identity.version,
            instanceId: identity.instanceId,
          },
          capabilities: {
            richEvents: true,
            permissionPrompts: true,
            operationDeduplication: true,
          },
          requirements: {
            operationDeduplication: 1,
            sessionObservation: 1,
            afterTurnInput: 1,
            askUserTransport: 1,
            permissionCas: 1,
            providerCredentialBroker: 1,
            runBoundHostTools: 1,
            coderOwnerFencing: 1,
            crashOutcomeModel: 1,
            coderFeatureMatrix: 1,
          },
        });
        pendingRuntime = runtime;
        return runtime;
      })
      .then(async (runtime) => {
        // App shutdown can race the startup warm-up. Do not publish a ready
        // Runtime after close(), and make the just-created instance release itself.
        if ((this.state as RuntimeHostState) === 'closed') {
          await runtime.close();
          pendingRuntime = null;
          return;
        }
        this.assertRequiredScopes(runtime);
        const { registerSpaceHostTools } = await import('./runtime/space-host-tools.js');
        const hostToolLease = await registerSpaceHostTools(runtime);
        if (this.state === 'closed') {
          await runtime.hostTools.revoke(hostToolLease.id).catch(() => false);
          await runtime.close();
          pendingRuntime = null;
          return;
        }
        this.hostToolLeaseId = hostToolLease.id;
        this.runtime = runtime;
        this.state = 'ready';
        this.lastError = undefined;
        await this.refreshProfile(0);
        this.startWatchdog();
        pendingRuntime = null;
      })
      .catch(async (error: unknown) => {
        const runtime = pendingRuntime;
        pendingRuntime = null;
        if (runtime) {
          if (this.hostToolLeaseId) {
            await runtime.hostTools.revoke(this.hostToolLeaseId).catch(() => false);
          }
          await runtime.close().catch(() => undefined);
          if (this.runtime === runtime) this.runtime = null;
          this.hostToolLeaseId = undefined;
        }
        this.initializePromise = null;
        if (this.state === 'closed') throw error;
        this.state = 'failed';
        this.lastError = sanitizeDiagnosticError(error);
        this.publishUnavailable('incompatible', this.lastError);
        throw error;
      });
    return this.initializePromise;
  }

  private startWatchdog(): void {
    if (this.watchdog || this.state !== 'ready') return;
    this.watchdog = setInterval(() => {
      if (this.watchdogPoll || !this.runtime || this.state !== 'ready') return;
      const attached = this.runtime;
      this.watchdogPoll = attached.status
        .snapshot()
        .then((status) => {
          if (status.runtimeId !== attached.identity.runtimeId) {
            throw new Error('Coder daemon Runtime identity changed unexpectedly.');
          }
        })
        .catch((error: unknown) => this.handleConnectionLoss(attached, error))
        .finally(() => {
          this.watchdogPoll = undefined;
        });
    }, 5_000);
    this.watchdog.unref?.();
  }

  private stopWatchdog(): void {
    if (this.watchdog) clearInterval(this.watchdog);
    this.watchdog = undefined;
  }

  private async handleConnectionLoss(
    attached: KodaXRuntime,
    error: unknown,
  ): Promise<void> {
    if (this.state === 'closed' || this.runtime !== attached) return;
    this.stopWatchdog();
    this.lastError = sanitizeDiagnosticError(error);
    this.publishUnavailable('reconnecting', this.lastError);
    for (const state of this.observations.values()) state.observation.close();
    this.observations.clear();
    this.observationPromises.clear();
    this.runtime = null;
    this.hostToolLeaseId = undefined;
    this.activeRuns.clear();
    this.continuationCredentialLeases.clear();
    this.continuationPrompts.clear();
    this.initializePromise = null;
    this.state = 'uninitialized';
    await attached.close().catch(() => undefined);
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.state === 'closed' || this.reconnectTimer) return;
    const delay = Math.min(30_000, 1_000 * 2 ** Math.min(this.reconnectAttempt, 5));
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      if (this.state === 'closed') return;
      void this.initialize()
        .then(() => {
          this.reconnectAttempt = 0;
        })
        .catch((error: unknown) => {
          this.reconnectAttempt += 1;
          this.publishUnavailable('disconnected', sanitizeDiagnosticError(error));
          this.scheduleReconnect();
        });
    }, delay);
    this.reconnectTimer.unref?.();
  }

  private async requireRuntime(): Promise<KodaXRuntime> {
    if (this.mode !== 'runtime') throw new Error('Runtime host is disabled by the legacy selector');
    await this.initialize();
    if (this.runtime === null) throw new Error('Runtime host failed to initialize');
    return this.runtime;
  }

  private assertRequiredScopes(runtime: KodaXRuntime): void {
    const required = [
      'session:observe',
      'session:write',
      'run:control',
      'interaction:respond',
      'permission:respond',
      'credential:register',
      'host-tool:register',
    ] as const;
    const granted = new Set(runtime.grantedScopes ?? []);
    const missing = required.filter((scope) => !granted.has(scope));
    if (missing.length > 0) {
      throw new Error(`Coder daemon is missing required scopes: ${missing.join(', ')}`);
    }
  }

  private spaceCapabilities(runtime: KodaXRuntime) {
    const caps = runtime.capabilities ?? {};
    const version = (name: string): number => {
      const value = caps[name];
      if (value === true) return 1;
      if (value && typeof value === 'object' && 'version' in value) {
        const raw = (value as { version?: unknown }).version;
        if (typeof raw === 'number' && Number.isInteger(raw) && raw > 0) return raw;
      }
      return 1;
    };
    return [
      { id: 'runtime.daemon', version: 1, available: runtime.identity.mode === 'daemon' },
      { id: 'runtime.live.observe', version: version('sessionObservation'), available: true },
      { id: 'runtime.input.after-turn', version: version('afterTurnInput'), available: true },
      {
        id: 'runtime.input.interrupt',
        version: 1,
        available: false,
        reason: 'KodaX 0.7.69 does not advertise interruptInput.',
      },
      { id: 'runtime.userInput', version: version('askUserTransport'), available: true },
      { id: 'runtime.permissions', version: version('permissionCas'), available: true },
      { id: 'runtime.credentials', version: version('providerCredentialBroker'), available: true },
      { id: 'runtime.hostTools', version: version('runBoundHostTools'), available: true },
      {
        id: 'runtime.managedTask.snapshot',
        version: 1,
        available: false,
        reason: 'The public observation snapshot has no managed-task live field.',
      },
    ] as const;
  }

  private async refreshProfile(cursor: number): Promise<void> {
    const runtime = this.runtime;
    if (!runtime || this.state !== 'ready') return;
    const [status, userInputs] = await Promise.all([
      runtime.status.snapshot(),
      runtime.userInputs.listPending(),
    ]);
    if (status.runtimeId !== runtime.identity.runtimeId) {
      throw new Error('Coder daemon status runtimeId does not match the attached Runtime identity.');
    }
    this.profileCursor = Math.max(this.profileCursor, cursor);
    const profile = projectRuntimeProfile({
      status,
      userInputs,
      cursor: this.profileCursor,
      projectionRevision: ++this.profileRevision,
      changedAt: Date.now(),
      capabilities: [...this.spaceCapabilities(runtime)],
    });
    if (!this.projectionController.replaceProfile(profile)) return;
    this.push('runtime.connectionChanged', profile.connection);
    this.push('runtime.profileChanged', profile);
  }

  private scheduleProfileRefresh(cursor: number): void {
    this.profileRefreshQueue = this.profileRefreshQueue
      .then(() => this.refreshProfile(cursor))
      .catch((error: unknown) => {
        this.lastError = sanitizeDiagnosticError(error);
        this.publishUnavailable('reconnecting', this.lastError);
      });
  }

  private publishUnavailable(
    state: 'degraded' | 'incompatible' | 'reconnecting' | 'disconnected',
    reason: string,
  ): void {
    const current = this.projectionController.profileSnapshot();
    const connection = {
      ...current.connection,
      state,
      changedAt: Date.now(),
      stale: true,
      reason,
    } as const;
    if (this.projectionController.replaceConnection(connection)) {
      this.push('runtime.connectionChanged', connection);
    }
  }

  private async assertCoderSession(runtime: KodaXRuntime, sessionId: string): Promise<void> {
    const session = await runtime.sessions.load(sessionId);
    if (session.surface === 'partner' || session.profileId === 'kodax-space.partner') {
      throw new Error(`Partner session ${sessionId} must remain on the inline Partner owner.`);
    }
  }

  async ensureSession(input: RuntimeSessionIdentity): Promise<boolean> {
    if (input.surface !== 'code') {
      throw new Error(`Partner session ${input.sessionId} must remain on the inline Partner owner.`);
    }
    const runtime = await this.requireRuntime();
    try {
      await this.assertCoderSession(runtime, input.sessionId);
      return false;
    } catch (error: unknown) {
      if (!isSessionNotFound(error)) throw error;
    }
    try {
      await runtime.sessions.create({
        sessionId: input.sessionId,
        projectPath: input.projectRoot,
        gitRoot: input.projectRoot,
        surface: 'code',
        tag: input.ephemeral ? SPACE_EPHEMERAL_SESSION_TAG : 'code',
      });
    } catch (createError: unknown) {
      try {
        await this.assertCoderSession(runtime, input.sessionId);
        return false;
      } catch {
        throw createError;
      }
    }
    this.scheduleProfileRefresh(this.profileCursor);
    return true;
  }

  async listSessions(filter?: RuntimeSessionFilter): Promise<readonly RuntimeSessionSummary[]> {
    if (filter?.surface === 'partner') {
      throw new Error('Partner sessions are not listed through the Coder daemon.');
    }
    return (await this.requireRuntime()).sessions.list({ ...filter, surface: 'code' });
  }

  async transcript(sessionId: string): Promise<RuntimeTranscript | null> {
    const runtime = await this.requireRuntime();
    await this.assertCoderSession(runtime, sessionId);
    return runtime.sessions.transcript(sessionId);
  }

  async appendNotice(input: RuntimeAppendNoticeInput) {
    const runtime = await this.requireRuntime();
    await this.assertCoderSession(runtime, input.sessionId);
    const result = await runtime.sessions.appendNotice(input);
    if (result !== null) invalidatePersistedSessionCache(input.sessionId);
    return result;
  }

  async compactSession(input: RuntimeCompactSessionInput): Promise<RuntimeCompactSessionResult> {
    const runtime = await this.requireRuntime();
    await this.assertCoderSession(runtime, input.sessionId);
    const result = await runtime.sessions.compact(input);
    if (result.compacted) invalidatePersistedSessionCache(input.sessionId);
    return result;
  }

  async forkSession(input: RuntimeForkSessionInput) {
    const runtime = await this.requireRuntime();
    await this.assertCoderSession(runtime, input.sessionId);
    const result = await runtime.sessions.fork(input);
    if (result !== null) invalidatePersistedSessionCache(result.id);
    return result;
  }

  async rewindSession(input: RuntimeRewindSessionInput) {
    const runtime = await this.requireRuntime();
    await this.assertCoderSession(runtime, input.sessionId);
    const result = await runtime.sessions.rewind(input);
    if (result !== null) invalidatePersistedSessionCache(input.sessionId);
    return result;
  }

  async deleteSession(sessionId: string): Promise<void> {
    const runtime = await this.requireRuntime();
    await this.assertCoderSession(runtime, sessionId);
    await runtime.sessions.delete(sessionId);
    invalidatePersistedSessionCache(sessionId);
  }

  async updateSessionSettings(
    sessionId: string,
    patch: RuntimeSessionSettingsPatch,
  ): Promise<void> {
    const runtime = await this.requireRuntime();
    await this.assertCoderSession(runtime, sessionId);
    const current = await runtime.sessions.getSettingsVersioned(sessionId);
    const changed = Object.entries(patch).some(
      ([key, value]) => current.value[key as keyof typeof current.value] !== value,
    );
    if (!changed) return;
    await runtime.sessions.updateSettingsVersioned(sessionId, patch, {
      expectedRevision: current.revision,
    });
  }

  ensureObserved(sessionId: string): Promise<void> {
    if (this.observations.has(sessionId)) return Promise.resolve();
    const existing = this.observationPromises.get(sessionId);
    if (existing) return existing;
    const pending = this.openObservation(sessionId).finally(() => {
      if (this.observationPromises.get(sessionId) === pending) {
        this.observationPromises.delete(sessionId);
      }
    });
    this.observationPromises.set(sessionId, pending);
    return pending;
  }

  private async openObservation(sessionId: string): Promise<void> {
    const runtime = await this.requireRuntime();
    const session = await runtime.sessions.load(sessionId);
    if (session.surface === 'partner' || session.profileId === 'kodax-space.partner') {
      throw new Error(`Partner session ${sessionId} must remain on the inline Partner owner.`);
    }
    const buffered: import('@kodax-ai/kodax/runtime').RuntimeEvent[] = [];
    let state:
      | {
          readonly observation: RuntimeSessionObservation;
          readonly reducer: CoderSessionProjectionReducer;
          eventQueue: Promise<void>;
        }
      | undefined;
    const observation = await runtime.sessions.observe(sessionId, (event) => {
      if (!state) {
        buffered.push(event);
        return;
      }
      this.enqueueRuntimeEvent(state, event);
    });
    const userInputs = await runtime.userInputs.listPending({ sessionId });
    const initial = projectRuntimeSessionSnapshot(observation.snapshot, userInputs);
    await this.syncSpaceSessionSettings(sessionId, observation.snapshot.settings.value);
    const reducer = new CoderSessionProjectionReducer(initial, observation.snapshot.runs);
    for (const run of observation.snapshot.runs) this.runProviders.set(run.runId, run.provider);
    state = { observation, reducer, eventQueue: Promise.resolve() };
    if (this.runtime !== runtime || this.state !== 'ready') {
      observation.close();
      throw new Error('Coder daemon connection changed while opening a session observation.');
    }
    this.observations.set(sessionId, state);
    this.profileCursor = Math.max(this.profileCursor, observation.snapshot.cursor);
    this.projectionController.replaceSessionLive(initial);
    for (const run of observation.snapshot.runs) {
      const continuation = this.continuationPrompts.get(run.runId);
      if (continuation && run.phase !== 'queued') {
        this.continuationPrompts.delete(run.runId);
        this.push('session.event', {
          kind: 'queued_user_prompt_started',
          sessionId: continuation.sessionId,
          queueMode: 'after-turn',
          content: continuation.content,
        });
      }
    }
    for (const event of buffered) {
      this.enqueueRuntimeEvent(state, event);
    }
  }

  private enqueueRuntimeEvent(
    state: {
      readonly observation: RuntimeSessionObservation;
      readonly reducer: CoderSessionProjectionReducer;
      eventQueue: Promise<void>;
    },
    event: import('@kodax-ai/kodax/runtime').RuntimeEvent,
  ): void {
    state.eventQueue = state.eventQueue
      .then(() => this.applyRuntimeEvent(state, event))
      .catch((error: unknown) => {
        this.lastError = sanitizeDiagnosticError(error);
        this.publishUnavailable('degraded', this.lastError);
        console.warn(
          `[runtime] ignored malformed event ${event.type} (${event.id}): ${this.lastError}`,
        );
      });
  }

  private async applyRuntimeEvent(
    state: {
      readonly observation: RuntimeSessionObservation;
      readonly reducer: CoderSessionProjectionReducer;
      eventQueue: Promise<void>;
    },
    event: import('@kodax-ai/kodax/runtime').RuntimeEvent,
  ): Promise<void> {
    const runtime = this.runtime;
    if (!runtime || this.state !== 'ready') return;
    const eventPayload =
      event.payload !== null && typeof event.payload === 'object'
        ? (event.payload as Readonly<Record<string, unknown>>)
        : undefined;
    if (typeof eventPayload?.provider === 'string') {
      this.runProviders.set(event.runId, eventPayload.provider);
    }
    let change;
    if (
      event.type === 'permission.requested' ||
      event.type === 'permission.resolved' ||
      event.type === 'user_input.requested' ||
      event.type === 'user_input.resolved'
    ) {
      const [permissions, userInputs] = await Promise.all([
        runtime.permissions.listPending({ sessionId: event.sessionId }),
        runtime.userInputs.listPending({ sessionId: event.sessionId }),
      ]);
      change = state.reducer.replaceInteractions(event.seq, permissions, userInputs);
    } else {
      change = state.reducer.apply(event);
    }
    if (change) {
      const projection = state.reducer.snapshot();
      if (event.type === 'session.settings.updated' && projection.settings) {
        await this.syncSpaceSessionSettings(event.sessionId, projection.settings.value);
      }
      if (this.projectionController.replaceSessionLive(projection)) {
        this.push('session.liveChanged', change);
      }
    }
    if (
      event.type === 'run.completed' ||
      event.type === 'run.failed' ||
      event.type === 'run.cancelled' ||
      event.type === 'run.interrupted'
    ) {
      const continuation = this.continuationPrompts.get(event.runId);
      if (continuation) {
        this.continuationPrompts.delete(event.runId);
        this.push('session.event', {
          kind: 'queued_user_prompt_started',
          sessionId: continuation.sessionId,
          queueMode: 'after-turn',
          content: continuation.content,
        });
      }
      const leaseId = this.continuationCredentialLeases.get(event.runId);
      if (leaseId) {
        this.continuationCredentialLeases.delete(event.runId);
        await runtime.credentials.revoke(leaseId).catch(() => false);
      }
    }
    this.bridgeRuntimeEvent(event);
    this.scheduleProfileRefresh(event.seq);
  }

  private async syncSpaceSessionSettings(
    sessionId: string,
    settings: RuntimeSessionSettings,
  ): Promise<void> {
    const { kodaxHost } = await import('./host.js');
    const session = kodaxHost.get(sessionId);
    if (!session || session.surface !== 'code') return;
    if (typeof settings.provider === 'string' && settings.provider.length > 0) {
      session.provider = settings.provider;
    }
    session.model = settings.model;
    session.thinking = settings.thinking;
    if (
      settings.reasoningMode === 'off' ||
      settings.reasoningMode === 'auto' ||
      settings.reasoningMode === 'quick' ||
      settings.reasoningMode === 'balanced' ||
      settings.reasoningMode === 'deep'
    ) {
      session.reasoningMode = settings.reasoningMode;
    }
    if (
      settings.permissionMode === 'plan' ||
      settings.permissionMode === 'accept-edits' ||
      settings.permissionMode === 'auto'
    ) {
      session.permissionMode = settings.permissionMode;
    }
  }

  publishLegacySnapshot(sessionId: string): void {
    const projection = this.observations.get(sessionId)?.reducer.snapshot();
    if (!projection?.activeRun) return;
    this.push('session.event', {
      kind: 'session_start',
      sessionId,
      provider: this.runProviders.get(projection.activeRun.runId) ?? 'unknown',
    });
    if (projection.thinkingDraft?.text) {
      this.push('session.event', {
        kind: 'thinking_delta',
        sessionId,
        text: projection.thinkingDraft.text,
      });
    }
    if (projection.assistantDraft?.text) {
      this.push('session.event', {
        kind: 'text_delta',
        sessionId,
        text: projection.assistantDraft.text,
      });
    }
    for (const tool of projection.activeTools) {
      this.push('session.event', {
        kind: 'tool_start',
        sessionId,
        toolId: tool.toolCallId,
        toolName: tool.name,
        input: {},
      });
    }
    this.push('session.event', {
      kind: 'todo_update',
      sessionId,
      items: projection.todos,
    });
  }

  private bridgeRuntimeEvent(event: import('@kodax-ai/kodax/runtime').RuntimeEvent): void {
    const payload =
      event.payload !== null && typeof event.payload === 'object'
        ? (event.payload as Readonly<Record<string, unknown>>)
        : undefined;
    if (event.type === 'assistant.delta' && typeof payload?.text === 'string') {
      this.push('session.event', {
        kind: 'text_delta',
        sessionId: event.sessionId,
        text: payload.text,
      });
      return;
    }
    if (event.type === 'thinking.delta' && typeof payload?.text === 'string') {
      this.push('session.event', {
        kind: 'thinking_delta',
        sessionId: event.sessionId,
        text: payload.text,
      });
      return;
    }
    if (event.type === 'thinking.finished' && typeof payload?.thinking === 'string') {
      this.push('session.event', {
        kind: 'thinking_end',
        sessionId: event.sessionId,
        thinking: payload.thinking,
      });
      return;
    }
    if (event.type === 'tool.started') {
      const tool =
        payload?.tool !== null && typeof payload?.tool === 'object'
          ? (payload.tool as Readonly<Record<string, unknown>>)
          : undefined;
      const meta =
        payload?.meta !== null && typeof payload?.meta === 'object'
          ? (payload.meta as Readonly<Record<string, unknown>>)
          : undefined;
      const toolId =
        typeof meta?.toolCallId === 'string'
          ? meta.toolCallId
          : typeof tool?.id === 'string'
            ? tool.id
            : event.id;
      const toolName = typeof tool?.name === 'string' ? tool.name : 'tool';
      const input =
        tool?.input !== null && typeof tool?.input === 'object' && !Array.isArray(tool.input)
          ? (tool.input as Record<string, unknown>)
          : {};
      this.push('session.event', {
        kind: 'tool_start',
        sessionId: event.sessionId,
        toolId,
        toolName,
        input,
      });
      return;
    }
    if (event.type === 'tool.progress') {
      const meta =
        payload?.meta !== null && typeof payload?.meta === 'object'
          ? (payload.meta as Readonly<Record<string, unknown>>)
          : undefined;
      const update =
        payload?.update !== null && typeof payload?.update === 'object'
          ? (payload.update as Readonly<Record<string, unknown>>)
          : undefined;
      const toolId =
        (typeof meta?.toolCallId === 'string' ? meta.toolCallId : undefined) ??
        (typeof update?.id === 'string' ? update.id : undefined) ??
        event.id;
      if (typeof update?.message === 'string') {
        this.push('session.event', {
          kind: 'tool_progress',
          sessionId: event.sessionId,
          toolId,
          message: update.message,
        });
      } else if (typeof payload?.partialJson === 'string') {
        this.push('session.event', {
          kind: 'tool_input_delta',
          sessionId: event.sessionId,
          toolId,
          toolName: typeof payload.toolName === 'string' ? payload.toolName : 'tool',
          partialJson: payload.partialJson,
        });
      }
      return;
    }
    if (event.type === 'tool.finished') {
      const result =
        payload?.result !== null && typeof payload?.result === 'object'
          ? (payload.result as Readonly<Record<string, unknown>>)
          : undefined;
      const meta =
        payload?.meta !== null && typeof payload?.meta === 'object'
          ? (payload.meta as Readonly<Record<string, unknown>>)
          : undefined;
      const toolId =
        typeof meta?.toolCallId === 'string'
          ? meta.toolCallId
          : typeof result?.id === 'string'
            ? result.id
            : event.id;
      const toolName = typeof result?.name === 'string' ? result.name : 'tool';
      const content =
        typeof result?.content === 'string'
          ? result.content
          : typeof payload?.result === 'string'
            ? payload.result
            : '';
      this.push('session.event', {
        kind: 'tool_result',
        sessionId: event.sessionId,
        toolId,
        toolName,
        content,
      });
      return;
    }
    if (event.type === 'todo.updated') {
      const projection = this.observations.get(event.sessionId)?.reducer.snapshot();
      if (projection) {
        this.push('session.event', {
          kind: 'todo_update',
          sessionId: event.sessionId,
          items: projection.todos,
        });
      }
      return;
    }
    if (event.type === 'run.progress' && payload?.kind === 'managed_task_status') {
      const parsed = sessionEventChannel.payload.safeParse({
        kind: 'managed_task_status',
        sessionId: event.sessionId,
        status: payload.status,
      });
      if (parsed.success) this.push('session.event', parsed.data);
      return;
    }
    if (event.type === 'run.started') {
      const continuation = this.continuationPrompts.get(event.runId);
      if (continuation) {
        this.continuationPrompts.delete(event.runId);
        this.push('session.event', {
          kind: 'queued_user_prompt_started',
          sessionId: continuation.sessionId,
          queueMode: 'after-turn',
          content: continuation.content,
        });
      }
      this.push('session.event', {
        kind: 'session_start',
        sessionId: event.sessionId,
        provider:
          (typeof payload?.provider === 'string' ? payload.provider : undefined) ??
          this.runProviders.get(event.runId) ??
          'unknown',
      });
      return;
    }
    if (event.type === 'run.completed') {
      this.push('session.event', { kind: 'session_complete', sessionId: event.sessionId });
      return;
    }
    if (
      event.type === 'run.failed' ||
      event.type === 'run.cancelled' ||
      event.type === 'run.interrupted'
    ) {
      const error =
        typeof payload?.error === 'string'
          ? payload.error
          : event.type === 'run.cancelled'
            ? 'cancelled'
            : event.type === 'run.interrupted'
              ? 'Runtime run interrupted'
              : 'Runtime run failed';
      this.push('session.event', {
        kind: 'session_error',
        sessionId: event.sessionId,
        error,
        category: event.type === 'run.cancelled' ? 'cancelled' : 'unknown',
        retriable: event.type !== 'run.failed',
      });
    }
  }

  async startManagedRun(input: RuntimeStartRunInput): Promise<RuntimeRunHandle> {
    this.assertTransportSafeRunInput(input);
    const runtime = await this.requireRuntime();
    await this.assertCoderSession(runtime, input.sessionId);
    await this.ensureObserved(input.sessionId);
    const provider = input.options?.provider;
    const registeredCredential =
      !input.credential && provider
        ? await this.registerCredentialLease(runtime, provider, input.sessionId)
        : undefined;
    const credentialBinding = input.credential ?? registeredCredential?.binding;
    let handle: RuntimeRunHandle;
    try {
      handle = await runtime.runs.start({
        ...input,
        ...(credentialBinding ? { credential: credentialBinding } : {}),
        ...(!input.hostTools && this.hostToolLeaseId
          ? { hostTools: { leaseId: this.hostToolLeaseId } }
          : {}),
      });
    } catch (error) {
      if (registeredCredential) {
        await runtime.credentials.revoke(registeredCredential.leaseId).catch(() => false);
      }
      throw error;
    }
    this.activeRuns.set(input.sessionId, handle.runId);
    const result = handle.result.finally(async () => {
      if (this.activeRuns.get(input.sessionId) === handle.runId) {
        this.activeRuns.delete(input.sessionId);
      }
      if (registeredCredential) {
        await runtime.credentials.revoke(registeredCredential.leaseId).catch(() => false);
      }
    });
    return { ...handle, result };
  }

  private async registerCredentialLease(
    runtime: KodaXRuntime,
    provider: string,
    sessionId: string,
  ): Promise<
    | {
        readonly binding: { readonly leaseId: string; readonly provider: string };
        readonly leaseId: string;
      }
    | undefined
  > {
    if (!(await this.credentialResolver(provider))) return undefined;
    let boundRunId: string | undefined;
    const lease = await runtime.credentials.register({ providers: [provider] }, async (request) => {
      if (request.provider !== provider || request.sessionId !== sessionId) return undefined;
      if (boundRunId !== undefined && request.runId !== boundRunId) return undefined;
      boundRunId = request.runId;
      return this.credentialResolver(provider);
    });
    return {
      binding: { leaseId: lease.id, provider },
      leaseId: lease.id,
    };
  }

  activeRunId(sessionId: string): string | undefined {
    const observed = this.observations.get(sessionId)?.reducer.snapshot().activeRun?.runId;
    return observed ?? this.activeRuns.get(sessionId);
  }

  async findActiveRunId(sessionId: string): Promise<string | undefined> {
    const runtime = await this.requireRuntime();
    await this.assertCoderSession(runtime, sessionId);
    const statuses = await runtime.runs.list({
      sessionId,
      phase: ['running', 'waiting_permission', 'waiting_user_input'],
    });
    return statuses
      .slice()
      .sort((a, b) => (b.sessionOrder ?? 0) - (a.sessionOrder ?? 0))[0]?.runId;
  }

  async abortSessionRun(sessionId: string): Promise<boolean> {
    const runtime = this.runtime;
    if (!runtime) return false;
    const statuses = await runtime.runs.list({
      sessionId,
      phase: ['running', 'waiting_permission', 'waiting_user_input', 'queued'],
    });
    const status = statuses
      .slice()
      .sort((a, b) => {
        const rank = (run: RuntimeRunStatus): number => (run.phase === 'queued' ? 1 : 0);
        return rank(a) - rank(b) || (a.sessionOrder ?? 0) - (b.sessionOrder ?? 0);
      })[0];
    const runId = status?.runId ?? this.activeRunId(sessionId);
    if (!runId) return false;
    await runtime.runs.abort(runId);
    return true;
  }

  async submitInput(input: RuntimeSubmitInput) {
    const runtime = await this.requireRuntime();
    await this.assertCoderSession(runtime, input.sessionId);
    await this.ensureObserved(input.sessionId);
    if (input.delivery === 'interrupt') {
      throw new Error('KodaX Runtime 0.7.69 does not support interrupt delivery.');
    }
    const previous = await runtime.runs.get(input.afterRunId);
    const registeredCredential = !input.credential
      ? await this.registerCredentialLease(runtime, previous.provider, input.sessionId)
      : undefined;
    const credentialBinding = input.credential ?? registeredCredential?.binding;
    const result = await runtime.runs.submitInput({
      ...input,
      ...(credentialBinding ? { credential: credentialBinding } : {}),
      ...(!input.hostTools && this.hostToolLeaseId
        ? { hostTools: { leaseId: this.hostToolLeaseId } }
        : {}),
    });
    if ((!result.accepted || result.delivery !== 'after_turn') && registeredCredential) {
      await runtime.credentials.revoke(registeredCredential.leaseId).catch(() => false);
    } else if (result.accepted && registeredCredential) {
      this.continuationCredentialLeases.set(result.runId, registeredCredential.leaseId);
    }
    if (result.accepted && result.delivery === 'after_turn') {
      const items = Array.isArray(input.input) ? input.input : [input.input];
      const content = items
        .filter(
          (item): item is Extract<(typeof items)[number], { type: 'text' }> =>
            item.type === 'text',
        )
        .map((item) => item.text)
        .join('\n');
      if (content) {
        this.continuationPrompts.set(result.runId, {
          sessionId: input.sessionId,
          content: content.slice(0, 1_048_576),
        });
      }
    }
    return result;
  }

  hasPendingPermission(requestId: string): boolean {
    const profile = this.projectionController.profileSnapshot();
    return profile.interactions.some(
      (interaction) =>
        interaction.kind === 'permission' &&
        interaction.state === 'pending' &&
        interaction.request.reqId === requestId,
    );
  }

  hasPendingUserInput(requestId: string): boolean {
    const profile = this.projectionController.profileSnapshot();
    return profile.interactions.some(
      (interaction) =>
        interaction.kind === 'ask-user' &&
        interaction.state === 'pending' &&
        interaction.request.reqId === requestId,
    );
  }

  async respondPermission(
    requestId: string,
    decision: 'allow_once' | 'allow_always' | 'deny',
  ): Promise<boolean> {
    const runtime = await this.requireRuntime();
    const request = (await runtime.permissions.listPending()).find((item) => item.id === requestId);
    if (!request) return false;
    return runtime.permissions.respond(
      requestId,
      decision === 'allow_always'
        ? {
            type: 'allow_always',
            scope: { toolName: request.toolName, sessionId: request.sessionId },
          }
        : decision === 'allow_once'
          ? { type: 'allow_once' }
          : { type: 'reject' },
      { runId: request.runId },
    );
  }

  async respondUserInput(
    requestId: string,
    reply: { readonly cancelled?: true; readonly value?: unknown },
  ): Promise<boolean> {
    const runtime = await this.requireRuntime();
    const request = (await runtime.userInputs.listPending()).find((item) => item.id === requestId);
    if (!request) return false;
    const resolution = reply.cancelled
      ? await runtime.userInputs.dismiss(requestId, {
          expectedRevision: request.revision,
          runId: request.runId,
        })
      : await runtime.userInputs.respond(requestId, reply.value, {
          expectedRevision: request.revision,
          runId: request.runId,
        });
    return resolution.accepted;
  }

  private assertTransportSafeRunInput(input: RuntimeStartRunInput): void {
    const forbidden = ['events', 'abortSignal', 'extensionRuntime', 'guardrails'] as const;
    const options = input.options as Readonly<Record<string, unknown>> | undefined;
    for (const key of forbidden) {
      if (options?.[key] !== undefined) {
        throw new Error(`Coder daemon run options cannot contain inline-only ${key}.`);
      }
    }
    const visit = (value: unknown, pathLabel: string, seen: Set<object>): void => {
      if (typeof value === 'function' || typeof value === 'symbol' || typeof value === 'bigint') {
        throw new Error(`Coder daemon run input is not transport-safe at ${pathLabel}.`);
      }
      if (value === null || typeof value !== 'object') return;
      if (seen.has(value)) throw new Error(`Coder daemon run input is cyclic at ${pathLabel}.`);
      seen.add(value);
      if (Array.isArray(value)) {
        value.forEach((item, index) => visit(item, `${pathLabel}[${index}]`, seen));
      } else {
        for (const [key, item] of Object.entries(value)) visit(item, `${pathLabel}.${key}`, seen);
      }
      seen.delete(value);
    };
    visit(input, 'run', new Set());
  }

  async close(): Promise<void> {
    if (this.closePromise !== null) return this.closePromise;
    const runtime = this.runtime;
    const hostToolLeaseId = this.hostToolLeaseId;
    const initializing = this.initializePromise;
    this.stopWatchdog();
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = undefined;
    this.runtime = null;
    this.hostToolLeaseId = undefined;
    this.activeRuns.clear();
    this.runProviders.clear();
    this.continuationCredentialLeases.clear();
    this.continuationPrompts.clear();
    for (const state of this.observations.values()) state.observation.close();
    this.observations.clear();
    this.observationPromises.clear();
    this.state = 'closed';
    this.closePromise = runtime
      ? (async () => {
          if (hostToolLeaseId) {
            await runtime.hostTools.revoke(hostToolLeaseId).catch(() => false);
          }
          await runtime.close();
        })()
      : (initializing?.catch(() => undefined) ?? Promise.resolve());
    return this.closePromise;
  }
}

export const runtimeHostAdapter = new RuntimeHostAdapter({
  projectionController: runtimeProjectionController,
  push: pushToRenderer,
});
