import path from 'node:path';

import type {
  CreateKodaXRuntimeOptions,
  KodaXRuntime,
  RuntimeIdentity,
  RuntimeAppendNoticeInput,
  RuntimeCompactSessionInput,
  RuntimeCompactSessionResult,
  RuntimeForkSessionInput,
  RuntimeRewindSessionInput,
  RuntimeRunHandle,
  RuntimeSessionFilter,
  RuntimeSessionSummary,
  RuntimeStartRunInput,
  RuntimeTranscript,
} from '@kodax-ai/kodax/runtime';
import { getKodaxRuntimeDir } from './data-paths.js';
import { invalidatePersistedSessionCache, SPACE_EPHEMERAL_SESSION_TAG } from './session-store.js';

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

type RuntimeFactory = (options: CreateKodaXRuntimeOptions) => Promise<KodaXRuntime>;

export interface RuntimeHostAdapterOptions {
  readonly mode?: RuntimeHostMode;
  readonly profileRoot?: string;
  readonly runtimeFactory?: RuntimeFactory;
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

async function createPublishedRuntime(options: CreateKodaXRuntimeOptions): Promise<KodaXRuntime> {
  const sdk = await import('@kodax-ai/kodax/runtime');
  return sdk.createKodaXRuntime(options);
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
        'partial',
        'legacy',
        'Runtime initialization failed before run start; the bounded legacy rollback is active.',
      ),
      capability('runtime.sessions', 'partial', 'space-bridge'),
      capability('runtime.runs', 'partial', 'legacy'),
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
    capability(
      'runtime.permissions',
      'supported',
      'space-bridge',
      'Space brokers remain authoritative.',
    ),
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
      'Space owns product artifact stores.',
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
      'unavailable',
      'unavailable',
      'No transport-safe Partner/permission contract yet.',
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
  private state: RuntimeHostState = 'uninitialized';
  private runtime: KodaXRuntime | null = null;
  private initializePromise: Promise<void> | null = null;
  private closePromise: Promise<void> | null = null;
  private lastError: string | undefined;
  private readonly startingSessions = new Set<string>();
  private readonly activeRuns = new Map<string, string>();

  constructor(options: RuntimeHostAdapterOptions = {}) {
    this.mode = options.mode ?? resolveRuntimeHostMode(process.env.KODAX_SPACE_RUNTIME_HOST);
    this.profileRoot = path.resolve(options.profileRoot ?? getKodaxRuntimeDir());
    this.runtimeFactory = options.runtimeFactory ?? createPublishedRuntime;
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
    this.initializePromise = this.runtimeFactory({
      mode: 'embedded',
      isolation: 'inline',
      sessionsDir: path.join(this.profileRoot, 'sessions'),
      clientInfo: {
        name: 'kodax-space',
        title: 'KodaX Space',
        version: clientVersion?.trim() || '0.1.31',
      },
      capabilities: {
        richEvents: true,
        permissionPrompts: true,
        commandCatalog: true,
        skillCatalog: true,
        artifactUpload: true,
        contextDiagnostics: true,
      },
    })
      .then(async (runtime) => {
        // App shutdown can race the startup warm-up. Do not publish a ready
        // Runtime after close(), and make the just-created instance release itself.
        if (this.state === 'closed') {
          await runtime.close();
          return;
        }
        this.runtime = runtime;
        this.state = 'ready';
        this.lastError = undefined;
      })
      .catch((error: unknown) => {
        this.state = 'failed';
        this.lastError = sanitizeDiagnosticError(error);
        throw error;
      });
    return this.initializePromise;
  }

  private async requireRuntime(): Promise<KodaXRuntime> {
    if (this.mode !== 'runtime') throw new Error('Runtime host is disabled by the legacy selector');
    await this.initialize();
    if (this.runtime === null) throw new Error('Runtime host failed to initialize');
    return this.runtime;
  }

  async ensureSession(input: RuntimeSessionIdentity): Promise<void> {
    const runtime = await this.requireRuntime();
    try {
      await runtime.sessions.load(input.sessionId);
      return;
    } catch (error: unknown) {
      if (!isSessionNotFound(error)) throw error;
    }
    await runtime.sessions.create({
      sessionId: input.sessionId,
      projectPath: input.projectRoot,
      gitRoot: input.projectRoot,
      surface: input.surface,
      ...(input.surface === 'partner' ? { profileId: 'kodax-space.partner' } : {}),
      tag: input.ephemeral ? SPACE_EPHEMERAL_SESSION_TAG : input.surface,
    });
  }

  async listSessions(filter?: RuntimeSessionFilter): Promise<readonly RuntimeSessionSummary[]> {
    return (await this.requireRuntime()).sessions.list(filter);
  }

  async transcript(sessionId: string): Promise<RuntimeTranscript | null> {
    return (await this.requireRuntime()).sessions.transcript(sessionId);
  }

  async appendNotice(input: RuntimeAppendNoticeInput) {
    const result = await (await this.requireRuntime()).sessions.appendNotice(input);
    if (result !== null) invalidatePersistedSessionCache(input.sessionId);
    return result;
  }

  async compactSession(input: RuntimeCompactSessionInput): Promise<RuntimeCompactSessionResult> {
    const result = await (await this.requireRuntime()).sessions.compact(input);
    if (result.compacted) invalidatePersistedSessionCache(input.sessionId);
    return result;
  }

  async forkSession(input: RuntimeForkSessionInput) {
    const result = await (await this.requireRuntime()).sessions.fork(input);
    if (result !== null) invalidatePersistedSessionCache(result.id);
    return result;
  }

  async rewindSession(input: RuntimeRewindSessionInput) {
    const result = await (await this.requireRuntime()).sessions.rewind(input);
    if (result !== null) invalidatePersistedSessionCache(input.sessionId);
    return result;
  }

  async deleteSession(sessionId: string): Promise<void> {
    await (await this.requireRuntime()).sessions.delete(sessionId);
    invalidatePersistedSessionCache(sessionId);
  }

  async startManagedRun(input: RuntimeStartRunInput): Promise<RuntimeRunHandle> {
    if (this.startingSessions.has(input.sessionId) || this.activeRuns.has(input.sessionId)) {
      throw new Error(`Runtime session already has an active Space run: ${input.sessionId}`);
    }
    this.startingSessions.add(input.sessionId);
    let handle: RuntimeRunHandle;
    try {
      const runtime = await this.requireRuntime();
      handle = await runtime.runs.start(input);
    } finally {
      this.startingSessions.delete(input.sessionId);
    }
    this.activeRuns.set(input.sessionId, handle.runId);
    const result = handle.result.finally(() => {
      if (this.activeRuns.get(input.sessionId) === handle.runId) {
        this.activeRuns.delete(input.sessionId);
      }
    });
    return { ...handle, result };
  }

  activeRunId(sessionId: string): string | undefined {
    return this.activeRuns.get(sessionId);
  }

  async abortSessionRun(sessionId: string): Promise<boolean> {
    const runId = this.activeRuns.get(sessionId);
    if (runId === undefined || this.runtime === null) return false;
    await this.runtime.runs.abort(runId);
    return true;
  }

  async close(): Promise<void> {
    if (this.closePromise !== null) return this.closePromise;
    const runtime = this.runtime;
    const initializing = this.initializePromise;
    this.runtime = null;
    this.startingSessions.clear();
    this.activeRuns.clear();
    this.state = 'closed';
    this.closePromise =
      runtime?.close() ?? initializing?.catch(() => undefined) ?? Promise.resolve();
    return this.closePromise;
  }
}

export const runtimeHostAdapter = new RuntimeHostAdapter();
