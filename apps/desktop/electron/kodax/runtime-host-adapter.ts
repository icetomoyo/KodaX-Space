import path from 'node:path';

import type {
  ConnectKodaXRuntimeOptions,
  KodaXDaemonRuntime,
  RuntimeIdentity,
  RuntimeAppendNoticeInput,
  RuntimeCompactSessionInput,
  RuntimeCompactSessionResult,
  RuntimeCredentialBroker,
  RuntimeDaemonManagementState,
  RuntimeDaemonPreflight,
  RuntimeDaemonRollbackResult,
  RuntimeForkSessionInput,
  RuntimeInlineOwnerHandle,
  RuntimeOwnerPolicyState,
  RuntimeOwnerState,
  RuntimeRewindSessionInput,
  RuntimeRunHandle,
  RuntimeRunStatus,
  RuntimeSessionObservation,
  RuntimeSessionObservationSnapshot,
  RuntimeSessionFilter,
  RuntimeSessionSettings,
  RuntimeSessionSettingsPatch,
  RuntimeSessionSummary,
  RuntimeDaemonStartRunInput,
  RuntimeSubmitInput,
  RuntimeSubmitInputResult,
  RuntimeSubscription,
  RuntimeTranscript,
  RuntimeTranscriptSliceEntry,
  RuntimeTypedEvent,
} from '@kodax-ai/kodax/runtime';
import { effortToReasoningMode } from './reasoning-effort.js';
import { getKodaxRuntimeDir } from './data-paths.js';
import { stopCoderDaemonWhenSafe, type SafeDaemonStopResult } from './runtime-daemon-control.js';
import {
  KODAX_AUTO_MODE_DEFAULT_TIMEOUT_MS,
  loadKodaxAutoModeDefaults,
  type KodaxAutoModeDefaults,
} from './user-config.js';
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
import {
  sessionEventChannel,
  workflowProcessSnapshotSchema,
  workflowRunSchema,
  type WorkflowActivityPayload,
  type WorkflowEventPayload,
  type WorkflowRunT,
  type DispatchableAgentListingT,
  type ExternalAgentRegistrationSummaryT,
  type ExternalAgentTaskEventT,
  type ExternalAgentTaskT,
  type SessionEvent,
} from '@kodax-space/space-ipc-schema';
import {
  decodeRuntimeActorTaskId,
  isRuntimeActorTaskId,
  projectRuntimeActorEvent,
  projectRuntimeActorTask,
  projectRuntimeDispatchable,
  projectRuntimeDispatchability,
  projectRuntimeRegistration,
} from './runtime/runtime-agent-projection.js';
import { buildChildActivity, isTransientChildEvent, type ChildMeta } from './workflow-activity.js';

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

type QueuedUserPromptFailureReason = Extract<
  SessionEvent,
  { kind: 'queued_user_prompt_failed' }
>['reason'];

function runtimeEventRecord(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : undefined;
}

function runtimeInputText(value: unknown): string | undefined {
  const items = Array.isArray(value) ? value : [value];
  const text = items
    .map((item) => runtimeEventRecord(item))
    .filter(
      (item): item is Readonly<Record<string, unknown>> =>
        item?.type === 'text' && typeof item.text === 'string',
    )
    .map((item) => item.text as string)
    .join('\n');
  return text.trim() === '' ? undefined : text;
}

const MAX_RUNTIME_PROMPT_EVENT_TEXT = 262_144;

function clampRuntimePromptEventText(value: string): string {
  if (value.length <= MAX_RUNTIME_PROMPT_EVENT_TEXT) return value;
  return `${value.slice(0, MAX_RUNTIME_PROMPT_EVENT_TEXT - 24)}\n\n[truncated]`;
}

function projectContextIdentity(value: unknown): {
  readonly contextId?: string;
  readonly contextKind?: 'root' | 'child';
  readonly parentContextId?: string;
  readonly agentId?: string;
  readonly contextRevision?: number;
} {
  const record = runtimeEventRecord(value);
  if (!record) return {};
  return {
    ...(typeof record.contextId === 'string' ? { contextId: record.contextId } : {}),
    ...(record.contextKind === 'root' || record.contextKind === 'child'
      ? { contextKind: record.contextKind }
      : {}),
    ...(typeof record.parentContextId === 'string'
      ? { parentContextId: record.parentContextId }
      : {}),
    ...(typeof record.agentId === 'string' ? { agentId: record.agentId } : {}),
    ...(typeof record.contextRevision === 'number'
      ? { contextRevision: record.contextRevision }
      : {}),
  };
}

type RuntimeTranscriptEntry = RuntimeTranscript['transcriptEntries'][number];

async function readPagedTranscriptEntry(
  runtime: KodaXDaemonRuntime,
  sessionId: string,
  revision: string,
  descriptor: RuntimeTranscriptSliceEntry,
): Promise<RuntimeTranscriptEntry> {
  if (descriptor.entry) return descriptor.entry;
  const chunks: Buffer[] = [];
  let cursor: string | undefined;
  do {
    const chunk = await runtime.sessions.transcriptEntryChunk({
      sessionId,
      revision,
      entryIndex: descriptor.index,
      ...(cursor ? { cursor } : {}),
    });
    if (!chunk) throw new Error(`Transcript entry ${descriptor.index} is unavailable.`);
    chunks.push(Buffer.from(chunk.data, 'base64'));
    cursor = chunk.hasMore ? chunk.nextCursor : undefined;
    if (chunk.hasMore && !cursor) {
      throw new Error(`Transcript entry ${descriptor.index} omitted its continuation cursor.`);
    }
  } while (cursor);
  const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error(`Transcript entry ${descriptor.index} is malformed.`);
  }
  return parsed as RuntimeTranscriptEntry;
}

async function readPagedRuntimeTranscript(
  runtime: KodaXDaemonRuntime,
  sessionId: string,
): Promise<RuntimeTranscript | null> {
  const session = await runtime.sessions.load(sessionId);
  if (!session) return null;
  const transcriptEntries: RuntimeTranscriptEntry[] = [];
  let cursor: string | undefined;
  do {
    const page = await runtime.sessions.transcriptPage({
      sessionId,
      ...(cursor ? { cursor } : {}),
    });
    if (!page) return null;
    const pageEntries = await Promise.all(
      page.entries.map((descriptor) =>
        readPagedTranscriptEntry(runtime, sessionId, page.revision, descriptor),
      ),
    );
    transcriptEntries.unshift(...pageEntries);
    cursor = page.hasMore ? page.nextCursor : undefined;
    if (page.hasMore && !cursor) {
      throw new Error('Transcript page omitted its continuation cursor.');
    }
  } while (cursor);

  const visibleEntries = transcriptEntries.filter((entry) => entry.type !== 'rewind_marker');
  return {
    title: session.title,
    gitRoot: session.gitRoot ?? session.workspaceRoot ?? '',
    messages: visibleEntries.map((entry) => entry.message),
    activeMessages: visibleEntries.filter((entry) => entry.active).map((entry) => entry.message),
    transcriptEntries,
  };
}

/**
 * Project Runtime-owned context telemetry into the narrow renderer protocol. The daemon emits
 * these events as generic records, so every value is validated by the shared session-event schema
 * before it can affect the context gauge or activity state.
 */
export function projectRuntimeContextSessionEvent(
  event: RuntimeTypedEvent,
): SessionEvent | undefined {
  const payload = runtimeEventRecord(event.payload);
  let candidate: unknown;

  if (event.type === 'run.progress' && payload?.kind === 'iteration_start') {
    candidate = {
      kind: 'iteration_start',
      sessionId: event.sessionId,
      iter: payload.iter,
      maxIter: payload.maxIter,
    };
  } else if (event.type === 'run.progress' && payload?.kind === 'iteration_end') {
    const info = runtimeEventRecord(payload.info);
    if (!info) return undefined;
    candidate = {
      kind: 'iteration_end',
      sessionId: event.sessionId,
      iter: info.iter,
      maxIter: info.maxIter,
      tokenCount: info.tokenCount,
      ...(info.tokenSource === 'api' || info.tokenSource === 'estimate'
        ? { tokenSource: info.tokenSource }
        : {}),
      ...(info.scope === 'parent' || info.scope === 'worker' ? { scope: info.scope } : {}),
      ...(runtimeEventRecord(info.usage) ? { usage: info.usage } : {}),
      ...(typeof info.contextId === 'string' ? { contextId: info.contextId } : {}),
      ...(info.contextKind === 'root' || info.contextKind === 'child'
        ? { contextKind: info.contextKind }
        : {}),
      ...(typeof info.parentContextId === 'string'
        ? { parentContextId: info.parentContextId }
        : {}),
      ...(typeof info.agentId === 'string' ? { agentId: info.agentId } : {}),
      ...(typeof info.contextRevision === 'number'
        ? { contextRevision: info.contextRevision }
        : {}),
    };
  } else if (event.type === 'context.compaction.started') {
    candidate = {
      kind: 'compact_start',
      sessionId: event.sessionId,
      ...projectContextIdentity(payload?.meta),
    };
  } else if (event.type === 'context.compaction.finished') {
    candidate = {
      kind: 'compact_stats',
      sessionId: event.sessionId,
      tokensBefore: payload?.tokensBefore,
      tokensAfter: payload?.tokensAfter,
      contextId: payload?.contextId,
      contextKind: payload?.contextKind,
      contextRevision: payload?.contextRevision,
      ...(typeof payload?.parentContextId === 'string'
        ? { parentContextId: payload.parentContextId }
        : {}),
      ...(typeof payload?.agentId === 'string' ? { agentId: payload.agentId } : {}),
      ...(payload?.source === 'manual' ||
      payload?.source === 'automatic_threshold' ||
      payload?.source === 'physical_capacity'
        ? { source: payload.source }
        : {}),
      ...(typeof payload?.committed === 'boolean' ? { committed: payload.committed } : {}),
      ...(typeof payload?.elapsedMs === 'number' ? { elapsedMs: payload.elapsedMs } : {}),
      ...(payload?.strategy === 'full_prefix' || payload?.strategy === 'map_reduce'
        ? { strategy: payload.strategy }
        : {}),
      ...(typeof payload?.effectiveTriggerTokens === 'number'
        ? { effectiveTriggerTokens: payload.effectiveTriggerTokens }
        : {}),
      ...(typeof payload?.protectedBudgetTokens === 'number'
        ? { protectedBudgetTokens: payload.protectedBudgetTokens }
        : {}),
      ...(typeof payload?.fixedInputTokens === 'number'
        ? { fixedInputTokens: payload.fixedInputTokens }
        : {}),
      ...(typeof payload?.eligibleTokens === 'number'
        ? { eligibleTokens: payload.eligibleTokens }
        : {}),
      ...(typeof payload?.rawTailTokens === 'number'
        ? { rawTailTokens: payload.rawTailTokens }
        : {}),
      ...(typeof payload?.summaryTokens === 'number'
        ? { summaryTokens: payload.summaryTokens }
        : {}),
      ...(typeof payload?.queryLedgerTokens === 'number'
        ? { queryLedgerTokens: payload.queryLedgerTokens }
        : {}),
      ...(typeof payload?.beforeRevision === 'number'
        ? { beforeRevision: payload.beforeRevision }
        : {}),
      ...(typeof payload?.afterRevision === 'number'
        ? { afterRevision: payload.afterRevision }
        : {}),
      ...(typeof payload?.reason === 'string' ? { reason: payload.reason } : {}),
    };
  } else if (event.type === 'context.compaction.ended') {
    candidate = {
      kind: 'compact_end',
      sessionId: event.sessionId,
      ...projectContextIdentity(payload?.meta),
    };
  } else {
    return undefined;
  }

  const parsed = sessionEventChannel.payload.safeParse(candidate);
  return parsed.success ? parsed.data : undefined;
}

type RuntimeFactory = (options: ConnectKodaXRuntimeOptions) => Promise<KodaXDaemonRuntime>;
type RuntimeEventParser = (
  event: unknown,
) =>
  | { readonly ok: true; readonly event: RuntimeTypedEvent }
  | { readonly ok: false; readonly error: string };

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
  (channel: 'session.event', payload: import('@kodax-space/space-ipc-schema').SessionEvent): void;
  (channel: 'workflow.activity', payload: WorkflowActivityPayload): void;
  (channel: 'workflow.event', payload: WorkflowEventPayload): void;
}

interface RuntimeIdentityStoreLike {
  openInstance(metadata: {
    readonly name: string;
    readonly title?: string;
    readonly version: string;
  }): Promise<{
    readonly clientId: string;
    readonly instanceId: string;
    readonly instanceSecret: string;
    readonly name: string;
    readonly title?: string;
    readonly version: string;
  }>;
}

interface RuntimeOwnerControl {
  acquireInline(input: {
    readonly homeDir?: string;
    readonly profile: string;
  }): Promise<RuntimeInlineOwnerHandle>;
  getState(input: {
    readonly homeDir?: string;
    readonly profile: string;
  }): Promise<RuntimeOwnerState>;
  enableDaemon(input: {
    readonly homeDir?: string;
    readonly profile: string;
  }): Promise<RuntimeOwnerPolicyState>;
}

interface SpaceCredentialLeaseBinding {
  readonly leaseId: string;
  readonly provider: string;
  readonly sessionId: string;
  readonly runBinding: { boundRunId?: string };
  readonly broker: RuntimeCredentialBroker;
}

export interface RuntimeHostAdapterOptions {
  readonly mode?: RuntimeHostMode;
  /** Direct KodaX data/config root (normally KODAX_HOME), including sessions. */
  readonly profileRoot?: string;
  /** Optional CLI-style base directory that owns `.kodax`; omit to follow KODAX_HOME. */
  readonly runtimeHomeDir?: string;
  readonly runtimeFactory?: RuntimeFactory;
  readonly identityStore?: RuntimeIdentityStoreLike;
  readonly projectionController?: RuntimeProjectionController;
  readonly push?: RuntimeProjectionPush;
  readonly credentialResolver?: (provider: string) => Promise<string | undefined>;
  readonly runtimeEventParser?: RuntimeEventParser;
  readonly ownerControl?: RuntimeOwnerControl;
  readonly autoModeDefaultsResolver?: () => Promise<KodaxAutoModeDefaults>;
  readonly idleDaemonStop?: () => Promise<SafeDaemonStopResult>;
}

const MAX_DIAGNOSTIC_ERROR = 512;
const MINIMUM_KODAX_RUNTIME_VERSION = [0, 7, 74] as const;

export function resolveRuntimeHostMode(value: string | undefined): RuntimeHostMode {
  return value?.trim().toLowerCase() === 'legacy' ? 'legacy' : 'runtime';
}

function assertMinimumRuntimeVersion(version: string): void {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(version.trim());
  if (match) {
    const actual = match.slice(1, 4).map(Number);
    for (let index = 0; index < MINIMUM_KODAX_RUNTIME_VERSION.length; index += 1) {
      if (actual[index]! > MINIMUM_KODAX_RUNTIME_VERSION[index]!) return;
      if (actual[index]! < MINIMUM_KODAX_RUNTIME_VERSION[index]!) break;
      if (index === MINIMUM_KODAX_RUNTIME_VERSION.length - 1) return;
    }
  }
  throw new Error(
    `KodaX Runtime ${version || '(unknown)'} is older than the required 0.7.74 baseline. ` +
      'Restart the Coder daemon after updating KodaX; Space will not reuse an older daemon.',
  );
}

function sanitizeDiagnosticError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/([A-Za-z]:[\\/][^\s]+|\\\\[^\s]+|\/[A-Za-z][^\s]+)/g, '<path>')
    .slice(0, MAX_DIAGNOSTIC_ERROR);
}

function runtimeInitializationDiagnostic(error: unknown): string {
  const diagnostic = sanitizeDiagnosticError(error);
  if (
    !error ||
    typeof error !== 'object' ||
    (error as { code?: unknown }).code !== 'daemon_capability_upgrade_required'
  ) {
    return diagnostic;
  }
  const preflight = (error as { preflight?: { blockers?: readonly string[] } }).preflight;
  const blockers = preflight?.blockers?.length
    ? ` Safe automatic restart is blocked by: ${preflight.blockers.join(', ')}.`
    : ' Space will safely retire the idle stale daemon and reconnect automatically.';
  return `Coder daemon capability upgrade required.${blockers} ${diagnostic}`.slice(
    0,
    MAX_DIAGNOSTIC_ERROR,
  );
}

function isDaemonCapabilityUpgradeFailure(error: unknown): boolean {
  return (
    error !== null &&
    typeof error === 'object' &&
    (error as { code?: unknown }).code === 'daemon_capability_upgrade_required'
  );
}

function capabilityUpgradeBlockers(error: unknown): readonly string[] {
  if (!isDaemonCapabilityUpgradeFailure(error)) return [];
  const blockers = (error as { preflight?: { blockers?: unknown } }).preflight?.blockers;
  return Array.isArray(blockers)
    ? blockers.filter((blocker): blocker is string => typeof blocker === 'string')
    : [];
}

function isTransientDaemonHealthFailure(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /^Runtime daemon is unhealthy; refusing to start a competing owner\.?$/i.test(
    message.trim(),
  );
}

function projectRuntimeWorkflow(snapshot: unknown): WorkflowRunT | undefined {
  const base = workflowProcessSnapshotSchema.safeParse(snapshot);
  if (!base.success) return undefined;
  const metadata = base.data.hostMetadata;
  const candidate = {
    ...base.data,
    ...(metadata?.sessionId ? { sessionId: metadata.sessionId } : {}),
    ...(metadata?.surface === 'code' || metadata?.surface === 'partner'
      ? { surface: metadata.surface }
      : {}),
    ...(metadata?.projectRoot ? { projectRoot: metadata.projectRoot } : {}),
  };
  const parsed = workflowRunSchema.safeParse(candidate);
  return parsed.success ? parsed.data : undefined;
}

async function createPublishedRuntime(
  options: ConnectKodaXRuntimeOptions,
): Promise<KodaXDaemonRuntime> {
  const sdk = await import('@kodax-ai/kodax/runtime');
  return sdk.connectKodaXRuntime(options);
}

const publishedRuntimeOwnerControl: RuntimeOwnerControl = {
  async acquireInline(input) {
    const sdk = await import('@kodax-ai/kodax/runtime');
    return sdk.acquireKodaXInlineOwner(input);
  },
  async getState(input) {
    const sdk = await import('@kodax-ai/kodax/runtime');
    return sdk.getKodaXRuntimeOwnerState(input);
  },
  async enableDaemon(input) {
    const sdk = await import('@kodax-ai/kodax/runtime');
    return sdk.enableKodaXDaemonOwner(input);
  },
};

function capability(
  id: string,
  support: RuntimeCapabilitySupport,
  owner: RuntimeCapabilityOwner,
  reason?: string,
): RuntimeHostCapability {
  return { id, support, owner, ...(reason !== undefined ? { reason } : {}) };
}

function capabilitiesFor(mode: RuntimeHostMode, state: RuntimeHostState): RuntimeHostCapability[] {
  if ((mode === 'legacy' || state === 'legacy') && state !== 'failed' && state !== 'closed') {
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
      'runtime',
      'The Coder daemon owns configured A2A agents; Space retains its Reference executor plane as a reviewed host provider for Partner and compatibility actions.',
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

function isSessionSettingsRevisionConflict(error: unknown): boolean {
  const code =
    error && typeof error === 'object' && 'code' in error
      ? (error as { code?: unknown }).code
      : undefined;
  if (code === 'revision_conflict') return true;
  return /(?:session settings revision .* stale|revision[_ ]conflict)/i.test(
    error instanceof Error ? error.message : String(error),
  );
}

export class RuntimeHostAdapter {
  private readonly mode: RuntimeHostMode;
  private readonly profileRoot: string;
  private readonly runtimeHomeDir: string | undefined;
  private readonly autoModeDefaultsResolver: () => Promise<KodaxAutoModeDefaults>;
  private readonly runtimeFactory: RuntimeFactory;
  private readonly identityStore: RuntimeIdentityStoreLike;
  private readonly projectionController: RuntimeProjectionController;
  private readonly push: RuntimeProjectionPush;
  private readonly credentialResolver: (provider: string) => Promise<string | undefined>;
  private readonly ownerControl: RuntimeOwnerControl;
  private readonly idleDaemonStop: () => Promise<SafeDaemonStopResult>;
  private state: RuntimeHostState = 'uninitialized';
  private runtime: KodaXDaemonRuntime | null = null;
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
  private readonly desiredObservations = new Set<string>();
  private readonly settingsUpdateLocks = new Map<string, Promise<void>>();
  private readonly runProviders = new Map<string, string>();
  private readonly terminalSidecarBlockRuns = new Map<string, string>();
  private readonly continuationCredentialLeases = new Map<string, string>();
  private readonly credentialLeases = new Map<string, SpaceCredentialLeaseBinding>();
  private readonly continuationPrompts = new Map<
    string,
    { readonly sessionId: string; readonly content: string }
  >();
  private profileRevision = 0;
  private profileCursor = 0;
  private profileRefreshQueue: Promise<void> = Promise.resolve();
  private hostToolLeaseId: string | undefined;
  private readonly hostToolLeaseIds = new Set<string>();
  private connectionSubscription: RuntimeSubscription | undefined;
  private workflowSubscription: RuntimeSubscription | undefined;
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  private reconnectAttempt = 0;
  private readonly runtimeEventParser?: RuntimeEventParser;
  private inlineOwner: RuntimeInlineOwnerHandle | undefined;
  private rollbackInProgress = false;

  constructor(options: RuntimeHostAdapterOptions = {}) {
    this.mode = options.mode ?? resolveRuntimeHostMode(process.env.KODAX_SPACE_RUNTIME_HOST);
    this.profileRoot = path.resolve(options.profileRoot ?? getKodaxRuntimeDir());
    this.runtimeHomeDir =
      options.runtimeHomeDir === undefined ? undefined : path.resolve(options.runtimeHomeDir);
    this.autoModeDefaultsResolver = options.autoModeDefaultsResolver ?? loadKodaxAutoModeDefaults;
    this.runtimeFactory = options.runtimeFactory ?? createPublishedRuntime;
    this.identityStore =
      options.identityStore ??
      new RuntimeClientIdentityStore(
        path.join(this.profileRoot, 'space', 'runtime-client-identity.json'),
      );
    this.projectionController = options.projectionController ?? createPendingSdkRuntimeProjection();
    this.push = options.push ?? (() => undefined);
    this.runtimeEventParser = options.runtimeEventParser;
    this.ownerControl = options.ownerControl ?? publishedRuntimeOwnerControl;
    this.idleDaemonStop = options.idleDaemonStop ?? (() => stopCoderDaemonWhenSafe());
    this.credentialResolver =
      options.credentialResolver ??
      (async (provider) => (await import('../ipc/provider.js')).readProviderCredential(provider));
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

  hasLegacyOwner(): boolean {
    return this.mode === 'legacy' && this.state === 'legacy' && this.inlineOwner !== undefined;
  }

  async ensureLegacyOwner(): Promise<void> {
    if (this.mode !== 'legacy') {
      throw new Error('The inline Coder owner is available only in explicit legacy rollback mode.');
    }
    await this.initialize();
    if (!this.hasLegacyOwner()) {
      throw new Error('Space does not hold the required inline Coder owner fence.');
    }
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
      return this.initializeLegacyOwner();
    }
    if (this.state === 'ready') return Promise.resolve();
    if (this.state === 'closed') return Promise.reject(new Error('Runtime host is closed'));
    if (this.initializePromise !== null) return this.initializePromise;
    this.state = 'initializing';
    const version = clientVersion?.trim() || '0.1.32';
    let pendingRuntime: KodaXDaemonRuntime | null = null;
    let attachedHostToolLeaseId: string | undefined;
    this.initializePromise = this.identityStore
      .openInstance({ name: 'kodax-space', title: 'KodaX Space', version })
      .then(async (identity) => {
        const runtime = await this.runtimeFactory({
          profile: 'coder',
          autoStart: true,
          ...(this.runtimeHomeDir !== undefined ? { homeDir: this.runtimeHomeDir } : {}),
          sessionsDir: path.join(this.profileRoot, 'sessions'),
          clientInfo: {
            name: identity.name,
            ...(identity.title !== undefined ? { title: identity.title } : {}),
            version: identity.version,
            instanceId: identity.instanceId,
            instanceSecret: identity.instanceSecret,
          },
          capabilities: {
            richEvents: true,
            permissionPrompts: true,
            operationDeduplication: true,
          },
          requirements: {
            externalAgents: true,
            externalAgentAdmin: 1,
            actorControlPlane: 1,
            learningCenter: 1,
            a2aConfigReconciler: 1,
            operationDeduplication: 1,
            sessionObservation: 1,
            afterTurnInput: 1,
            interruptInput: 1,
            askUserTransport: 1,
            permissionCas: 1,
            providerCredentialBroker: 1,
            runBoundHostTools: 1,
            coderOwnerFencing: 1,
            crashOutcomeModel: 1,
            coderFeatureMatrix: 1,
            sessionAdmission: 1,
            completeObservationSnapshot: 1,
            contextCompaction: 3,
            transcriptPaging: 1,
            transcriptSearch: 1,
            connectionLifecycle: 1,
            typedRuntimeEvents: 1,
            daemonSafeRunInput: 1,
            sharedSessionSettings: 1,
            durableRecoveryQueries: 1,
            daemonManagement: 1,
            runtimeAutoModeGuardrail: 3,
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
        assertMinimumRuntimeVersion(runtime.identity.version);
        this.assertRequiredScopes(runtime);
        const { registerSpaceHostTools } = await import('./runtime/space-host-tools.js');
        let hostToolLease;
        if (this.hostToolLeaseId) {
          hostToolLease = await registerSpaceHostTools(runtime, this.hostToolLeaseId).catch(() =>
            registerSpaceHostTools(runtime),
          );
        } else {
          hostToolLease = await registerSpaceHostTools(runtime);
        }
        attachedHostToolLeaseId = hostToolLease.id;
        if (this.state === 'closed') {
          await runtime.hostTools.revoke(hostToolLease.id).catch(() => false);
          await runtime.close();
          pendingRuntime = null;
          return;
        }
        this.hostToolLeaseId = hostToolLease.id;
        this.hostToolLeaseIds.add(hostToolLease.id);
        this.runtime = runtime;
        if (!runtime.connection) {
          throw new Error('Coder daemon did not expose the required connection lifecycle.');
        }
        const connection = runtime.connection.current();
        if (connection.state !== 'connected') {
          throw new Error(connection.reason ?? 'Coder daemon disconnected during initialization.');
        }
        this.connectionSubscription?.close();
        this.connectionSubscription = runtime.connection.subscribe((next) => {
          if (next.state !== 'disconnected') return;
          void this.handleConnectionLoss(
            runtime,
            new Error(next.reason ?? 'Coder daemon transport disconnected.'),
            next.reconnectable,
          );
        });
        await this.connectionSubscription.ready;
        this.workflowSubscription?.close();
        this.workflowSubscription = runtime.workflows.subscribe({}, (event) => {
          const snapshot = projectRuntimeWorkflow(event.snapshot);
          if (!snapshot) {
            console.warn('[runtime] ignored malformed workflow snapshot from Coder daemon');
            return;
          }
          const { sessionId, surface, projectRoot, ...processSnapshot } = snapshot;
          const message = 'message' in event ? event.message : undefined;
          this.push('workflow.event', {
            type: event.type,
            snapshot: processSnapshot,
            ...(message !== undefined ? { message: message.slice(0, 8_192) } : {}),
            ...(sessionId !== undefined ? { sessionId } : {}),
            ...(surface !== undefined ? { surface } : {}),
            ...(projectRoot !== undefined ? { projectRoot } : {}),
          });
        });
        await this.workflowSubscription.ready;
        this.state = 'ready';
        this.lastError = undefined;
        if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
        this.reconnectTimer = undefined;
        this.reconnectAttempt = 0;
        await this.resumeKnownCredentialLeases(runtime);
        await this.refreshProfile(0);
        for (const sessionId of this.desiredObservations) {
          if (this.observations.has(sessionId) || this.observationPromises.has(sessionId)) continue;
          try {
            await this.openObservation(sessionId);
          } catch (error: unknown) {
            if (isSessionNotFound(error)) {
              this.desiredObservations.delete(sessionId);
              continue;
            }
            console.warn(
              `[runtime] could not restore observation for ${sessionId}: ${sanitizeDiagnosticError(error)}`,
            );
          }
        }
        pendingRuntime = null;
      })
      .catch(async (error: unknown) => {
        const runtime = pendingRuntime;
        pendingRuntime = null;
        if (runtime) {
          this.connectionSubscription?.close();
          this.connectionSubscription = undefined;
          this.workflowSubscription?.close();
          this.workflowSubscription = undefined;
          if (attachedHostToolLeaseId) {
            await runtime.hostTools.revoke(attachedHostToolLeaseId).catch(() => false);
            this.hostToolLeaseIds.delete(attachedHostToolLeaseId);
          }
          await runtime.close().catch(() => undefined);
          if (this.runtime === runtime) this.runtime = null;
          if (this.hostToolLeaseId === attachedHostToolLeaseId) this.hostToolLeaseId = undefined;
        }
        const capabilityUpgrade = isDaemonCapabilityUpgradeFailure(error);
        const upgradeBlockers = capabilityUpgradeBlockers(error);
        let capabilityRecoveryReady = false;
        if (
          capabilityUpgrade &&
          upgradeBlockers.length === 0 &&
          (this.state as RuntimeHostState) !== 'closed'
        ) {
          try {
            const stopped = await this.idleDaemonStop();
            capabilityRecoveryReady = stopped.stopped || stopped.reason === 'missing';
            if (!capabilityRecoveryReady) {
              console.warn(
                `[runtime] stale Coder daemon could not be retired safely (${stopped.reason ?? 'unknown'}).`,
              );
            }
          } catch (stopError) {
            console.warn(
              `[runtime] stale Coder daemon retirement failed: ${sanitizeDiagnosticError(stopError)}`,
            );
          }
        }

        this.initializePromise = null;
        if (this.state === 'closed') throw error;
        this.lastError = runtimeInitializationDiagnostic(error);
        const retryableHealthFailure = isTransientDaemonHealthFailure(error);
        this.state = capabilityRecoveryReady ? 'uninitialized' : 'failed';
        this.publishUnavailable(
          retryableHealthFailure || capabilityRecoveryReady ? 'reconnecting' : 'incompatible',
          this.lastError,
        );
        // The SDK deliberately refuses to start a competing daemon while a
        // previous owner's health record is still within its safety window.
        // That condition can clear without user action, so keep probing through
        // the existing bounded backoff instead of leaving Coder permanently in
        // a failed state until the first send happens to retry initialize().
        if (capabilityRecoveryReady) this.scheduleReconnect();
        else if (retryableHealthFailure) this.scheduleReconnect(true);
        throw error;
      });
    return this.initializePromise;
  }

  private initializeLegacyOwner(): Promise<void> {
    if (this.state === 'legacy') return Promise.resolve();
    if (this.state === 'closed') return Promise.reject(new Error('Runtime host is closed'));
    if (this.initializePromise !== null) return this.initializePromise;
    this.state = 'initializing';
    this.initializePromise = this.ownerControl
      .acquireInline(this.runtimeOwnerTarget())
      .then((owner) => {
        if (this.state === 'closed') {
          owner.close();
          return;
        }
        this.inlineOwner = owner;
        this.state = 'legacy';
        this.lastError = undefined;
      })
      .catch((error: unknown) => {
        this.initializePromise = null;
        if (this.state === 'closed') throw error;
        this.state = 'failed';
        this.lastError = sanitizeDiagnosticError(error);
        throw error;
      });
    return this.initializePromise;
  }

  private async handleConnectionLoss(
    attached: KodaXDaemonRuntime,
    error: unknown,
    reconnectable = true,
  ): Promise<void> {
    if (this.state === 'closed' || this.runtime !== attached) return;
    this.connectionSubscription?.close();
    this.connectionSubscription = undefined;
    this.workflowSubscription?.close();
    this.workflowSubscription = undefined;
    this.lastError = sanitizeDiagnosticError(error);
    this.publishUnavailable('reconnecting', this.lastError);
    for (const state of this.observations.values()) state.observation.close();
    this.observations.clear();
    this.observationPromises.clear();
    // Lease attachment is connection-scoped even though the stable lease IDs
    // survive in the daemon. Rebuild this set only from successful resume calls
    // on the replacement connection.
    this.hostToolLeaseIds.clear();
    this.runtime = null;
    this.activeRuns.clear();
    this.initializePromise = null;
    this.state = 'uninitialized';
    await attached.close().catch(() => undefined);
    if (this.rollbackInProgress) {
      this.state = 'closed';
      return;
    }
    if (reconnectable) this.scheduleReconnect();
    else {
      this.state = 'failed';
      this.publishUnavailable('disconnected', this.lastError);
    }
  }

  private scheduleReconnect(retryOnlyTransientHealthFailure = false): void {
    if (this.state === 'closed' || this.reconnectTimer) return;
    const delay = Math.min(30_000, 1_000 * 2 ** Math.min(this.reconnectAttempt, 5));
    this.reconnectTimer = setTimeout(() => {
      if (this.state === 'closed') {
        this.reconnectTimer = undefined;
        return;
      }
      void this.initialize()
        .then(() => {
          this.reconnectTimer = undefined;
          this.reconnectAttempt = 0;
        })
        .catch((error: unknown) => {
          // Keep the timer registered until initialize() settles. Its own error
          // path may observe the same transient health failure and request a
          // retry; retaining this handle prevents two retry chains from racing.
          this.reconnectTimer = undefined;
          this.reconnectAttempt += 1;
          if (retryOnlyTransientHealthFailure) {
            if (!isTransientDaemonHealthFailure(error)) return;
            this.scheduleReconnect(true);
            return;
          }
          this.publishUnavailable('disconnected', sanitizeDiagnosticError(error));
          this.scheduleReconnect();
        });
    }, delay);
    this.reconnectTimer.unref?.();
  }

  private async requireRuntime(): Promise<KodaXDaemonRuntime> {
    if (this.mode !== 'runtime') throw new Error('Runtime host is disabled by the legacy selector');
    await this.initialize();
    if (this.runtime === null) throw new Error('Runtime host failed to initialize');
    return this.runtime;
  }

  private assertRequiredScopes(runtime: KodaXDaemonRuntime): void {
    const required = [
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
    ] as const;
    const granted = new Set(runtime.grantedScopes ?? []);
    const missing = required.filter((scope) => !granted.has(scope));
    if (missing.length > 0) {
      throw new Error(`Coder daemon is missing required scopes: ${missing.join(', ')}`);
    }
  }

  private spaceCapabilities(runtime: KodaXDaemonRuntime) {
    const caps = runtime.capabilities ?? {};
    const available = (name: string): boolean => {
      const value = caps[name];
      return value === true || (value !== null && typeof value === 'object');
    };
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
      {
        id: 'runtime.daemon.management',
        version: version('daemonManagement'),
        available: true,
      },
      {
        id: 'runtime.externalAgents',
        version: version('externalAgentAdmin'),
        available: runtime.agents.enabled && available('externalAgentAdmin'),
      },
      {
        id: 'runtime.externalAgents.admin',
        version: version('externalAgentAdmin'),
        available: available('externalAgentAdmin'),
      },
      {
        id: 'runtime.externalAgents.actors',
        version: version('actorControlPlane'),
        available: available('actorControlPlane'),
      },
      {
        id: 'runtime.learning',
        version: version('learningCenter'),
        available: available('learningCenter'),
      },
      {
        id: 'runtime.externalAgents.a2aConfig',
        version: version('a2aConfigReconciler'),
        available: available('a2aConfigReconciler'),
      },
      { id: 'runtime.live.observe', version: version('sessionObservation'), available: true },
      {
        id: 'runtime.live.completeSnapshot',
        version: version('completeObservationSnapshot'),
        available: true,
      },
      {
        id: 'runtime.context.compaction',
        version: version('contextCompaction'),
        available: available('contextCompaction'),
      },
      {
        id: 'runtime.transcript.paging',
        version: version('transcriptPaging'),
        available: available('transcriptPaging'),
      },
      {
        id: 'runtime.transcript.search',
        version: version('transcriptSearch'),
        available: available('transcriptSearch'),
      },
      {
        id: 'runtime.connection.lifecycle',
        version: version('connectionLifecycle'),
        available: true,
      },
      { id: 'runtime.session.admission', version: version('sessionAdmission'), available: true },
      { id: 'runtime.events.typed', version: version('typedRuntimeEvents'), available: true },
      { id: 'runtime.run.daemonSafe', version: version('daemonSafeRunInput'), available: true },
      {
        id: 'runtime.settings.shared',
        version: version('sharedSessionSettings'),
        available: true,
      },
      {
        id: 'runtime.recovery.queries',
        version: version('durableRecoveryQueries'),
        available: true,
      },
      { id: 'runtime.input.after-turn', version: version('afterTurnInput'), available: true },
      {
        id: 'runtime.input.interrupt',
        version: version('interruptInput'),
        available: available('interruptInput'),
        ...(!available('interruptInput')
          ? { reason: 'The connected KodaX Runtime does not advertise interruptInput.' }
          : {}),
      },
      { id: 'runtime.userInput', version: version('askUserTransport'), available: true },
      { id: 'runtime.permissions', version: version('permissionCas'), available: true },
      { id: 'runtime.credentials', version: version('providerCredentialBroker'), available: true },
      { id: 'runtime.hostTools', version: version('runBoundHostTools'), available: true },
      {
        id: 'runtime.managedTask.snapshot',
        version: version('completeObservationSnapshot'),
        available: true,
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
      throw new Error(
        'Coder daemon status runtimeId does not match the attached Runtime identity.',
      );
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

  private async assertCoderSession(runtime: KodaXDaemonRuntime, sessionId: string): Promise<void> {
    const session = await runtime.sessions.load(sessionId);
    if (session.surface === 'partner' || session.profileId === 'kodax-space.partner') {
      throw new Error(`Partner session ${sessionId} must remain on the inline Partner owner.`);
    }
  }

  async ensureSession(input: RuntimeSessionIdentity): Promise<boolean> {
    if (input.surface !== 'code') {
      throw new Error(
        `Partner session ${input.sessionId} must remain on the inline Partner owner.`,
      );
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
        surface: 'space-desktop',
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
    const { surface: _spaceSurface, ...runtimeFilter } = filter ?? {};
    return (await this.requireRuntime()).sessions.list(runtimeFilter);
  }

  async transcript(sessionId: string): Promise<RuntimeTranscript | null> {
    const runtime = await this.requireRuntime();
    await this.assertCoderSession(runtime, sessionId);
    return readPagedRuntimeTranscript(runtime, sessionId);
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
    // Compaction lifecycle is Runtime-owned. Subscribe before issuing the command so the
    // renderer cannot miss the canonical start/finished/end sequence and the host does not need
    // to synthesize a second, revision-less compatibility sequence.
    await this.ensureObserved(input.sessionId);
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

  async deleteSession(sessionId: string): Promise<'deleted' | 'not_found'> {
    const runtime = await this.requireRuntime();
    let outcome: 'deleted' | 'not_found' = 'deleted';
    try {
      await this.assertCoderSession(runtime, sessionId);
      await runtime.sessions.delete(sessionId);
    } catch (error) {
      if (!isSessionNotFound(error)) throw error;
      outcome = 'not_found';
    }
    this.desiredObservations.delete(sessionId);
    const observed = this.observations.get(sessionId);
    if (observed) {
      observed.observation.close();
      this.observations.delete(sessionId);
    }
    this.activeRuns.delete(sessionId);
    for (const [runId, continuation] of this.continuationPrompts) {
      if (continuation.sessionId === sessionId) this.continuationPrompts.delete(runId);
    }
    for (const [runId, blockedSessionId] of this.terminalSidecarBlockRuns) {
      if (blockedSessionId === sessionId) this.terminalSidecarBlockRuns.delete(runId);
    }
    const sessionCredentialLeases = [...this.credentialLeases.values()]
      .filter((binding) => binding.sessionId === sessionId)
      .map((binding) => this.revokeCredentialLease(runtime, binding.leaseId));
    await Promise.all(sessionCredentialLeases);
    this.projectionController.removeSessionLive(sessionId);
    invalidatePersistedSessionCache(sessionId);
    this.scheduleProfileRefresh(this.profileCursor);
    return outcome;
  }

  async updateSessionSettings(
    sessionId: string,
    patch: RuntimeSessionSettingsPatch,
    identity?: RuntimeSessionIdentity,
  ): Promise<void> {
    const previous = this.settingsUpdateLocks.get(sessionId) ?? Promise.resolve();
    const current = previous
      .catch(() => undefined)
      .then(() => this.updateSessionSettingsUnlocked(sessionId, patch, identity));
    this.settingsUpdateLocks.set(sessionId, current);
    try {
      await current;
    } finally {
      if (this.settingsUpdateLocks.get(sessionId) === current) {
        this.settingsUpdateLocks.delete(sessionId);
      }
    }
  }

  async getSessionSettingsVersioned(sessionId: string) {
    const runtime = await this.requireRuntime();
    await this.assertCoderSession(runtime, sessionId);
    return runtime.sessions.getSettingsVersioned(sessionId);
  }

  private async updateSessionSettingsUnlocked(
    sessionId: string,
    patch: RuntimeSessionSettingsPatch,
    identity?: RuntimeSessionIdentity,
  ): Promise<void> {
    const runtime = await this.requireRuntime();
    if (identity) {
      if (identity.sessionId !== sessionId) {
        throw new Error('Runtime session identity does not match the settings target.');
      }
      await this.ensureSession(identity);
    } else {
      await this.assertCoderSession(runtime, sessionId);
    }
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const current = await runtime.sessions.getSettingsVersioned(sessionId);
      const effectivePatch = await this.withMissingAutoModeDefaults(current.value, patch);
      const changed = Object.entries(effectivePatch).some(([key, value]) => {
        const currentValue = current.value[key as keyof typeof current.value];
        // Runtime patch `null` means delete, whereas a settings snapshot represents
        // an absent value as `undefined`. Treating null and undefined as different
        // caused every send/run boundary to issue a redundant revisioned write.
        return value === null ? currentValue !== undefined : currentValue !== value;
      });
      if (!changed) return;
      try {
        await runtime.sessions.updateSettingsVersioned(sessionId, effectivePatch, {
          expectedRevision: current.revision,
        });
        return;
      } catch (error) {
        if (attempt === 2 || !isSessionSettingsRevisionConflict(error)) throw error;
      }
    }
  }

  private async withMissingAutoModeDefaults(
    current: RuntimeSessionSettings,
    patch: RuntimeSessionSettingsPatch,
  ): Promise<RuntimeSessionSettingsPatch> {
    if (
      current.autoModeTimeoutMs !== undefined &&
      (current.autoModeClassifierModel !== undefined ||
        patch.autoModeClassifierModel !== undefined) &&
      (current.autoModeSpeculativeWindowMs !== undefined ||
        patch.autoModeSpeculativeWindowMs !== undefined)
    ) {
      return patch;
    }
    let defaults: KodaxAutoModeDefaults;
    try {
      defaults = await this.autoModeDefaultsResolver();
    } catch (error) {
      console.warn(
        '[runtime] Auto LLM defaults load failed; using the KodaX 0.7.74 defaults:',
        sanitizeDiagnosticError(error),
      );
      defaults = {
        engine: 'llm',
        timeoutMs: KODAX_AUTO_MODE_DEFAULT_TIMEOUT_MS,
      };
    }
    return {
      ...patch,
      ...(current.autoModeClassifierModel === undefined &&
      patch.autoModeClassifierModel === undefined &&
      defaults.classifierModel !== undefined
        ? { autoModeClassifierModel: defaults.classifierModel }
        : {}),
      ...(current.autoModeTimeoutMs === undefined && patch.autoModeTimeoutMs === undefined
        ? { autoModeTimeoutMs: defaults.timeoutMs }
        : {}),
      ...(current.autoModeSpeculativeWindowMs === undefined &&
      patch.autoModeSpeculativeWindowMs === undefined &&
      defaults.speculativeWindowMs !== undefined
        ? { autoModeSpeculativeWindowMs: defaults.speculativeWindowMs }
        : {}),
    };
  }

  ensureObserved(sessionId: string): Promise<void> {
    this.desiredObservations.add(sessionId);
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
    const parseRuntimeEvent =
      this.runtimeEventParser ?? (await import('@kodax-ai/kodax/runtime')).parseRuntimeEvent;
    const session = await runtime.sessions.load(sessionId);
    if (session.surface === 'partner' || session.profileId === 'kodax-space.partner') {
      throw new Error(`Partner session ${sessionId} must remain on the inline Partner owner.`);
    }
    const buffered: RuntimeTypedEvent[] = [];
    let state:
      | {
          readonly observation: RuntimeSessionObservation;
          readonly reducer: CoderSessionProjectionReducer;
          eventQueue: Promise<void>;
        }
      | undefined;
    const observation = await runtime.sessions.observe(sessionId, (event) => {
      const parsed = parseRuntimeEvent(event);
      if (!parsed.ok) {
        console.warn(`[runtime] dropped malformed event: ${parsed.error}`);
        return;
      }
      if (!state) {
        buffered.push(parsed.event);
        return;
      }
      this.enqueueRuntimeEvent(state, parsed.event);
    });
    let installed = false;
    try {
      await this.resumeSnapshotBindings(runtime, observation.snapshot);
      const initial = projectRuntimeSessionSnapshot(observation.snapshot);
      await this.syncSpaceSessionSettings(sessionId, observation.snapshot.settings.value);
      const reducer = new CoderSessionProjectionReducer(initial, observation.snapshot.runs);
      for (const run of observation.snapshot.runs) this.runProviders.set(run.runId, run.provider);
      state = { observation, reducer, eventQueue: Promise.resolve() };
      if (this.runtime !== runtime || this.state !== 'ready') {
        throw new Error('Coder daemon connection changed while opening a session observation.');
      }
      if (!this.desiredObservations.has(sessionId)) return;
      this.observations.set(sessionId, state);
      installed = true;
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
    } catch (error) {
      if (installed && this.observations.get(sessionId) === state) {
        this.observations.delete(sessionId);
      }
      installed = false;
      throw error;
    } finally {
      if (!installed) observation.close();
    }
  }

  private async resumeSnapshotBindings(
    runtime: KodaXDaemonRuntime,
    snapshot: RuntimeSessionObservationSnapshot,
  ): Promise<void> {
    const { registerSpaceHostTools } = await import('./runtime/space-host-tools.js');
    for (const run of snapshot.runs) {
      const credential = run.requirements?.credential;
      if (
        credential &&
        credential.state === 'ready' &&
        !this.credentialLeases.has(credential.leaseId)
      ) {
        const binding: SpaceCredentialLeaseBinding = {
          leaseId: credential.leaseId,
          provider: credential.provider,
          sessionId: run.sessionId,
          runBinding: { boundRunId: run.runId },
          broker: async (request) => {
            if (
              request.provider !== credential.provider ||
              request.sessionId !== run.sessionId ||
              request.runId !== run.runId
            ) {
              return undefined;
            }
            return this.credentialResolver(credential.provider);
          },
        };
        try {
          await runtime.credentials.resume(credential.leaseId, binding.broker);
          this.credentialLeases.set(credential.leaseId, binding);
        } catch {
          // A CLI/IDE-owned lease is expected to fail stable-client ownership.
        }
      }

      const hostTools = run.requirements?.hostTools;
      if (
        hostTools &&
        hostTools.state !== 'expired' &&
        hostTools.state !== 'terminal' &&
        !this.hostToolLeaseIds.has(hostTools.leaseId)
      ) {
        try {
          const lease = await registerSpaceHostTools(runtime, hostTools.leaseId);
          this.hostToolLeaseIds.add(lease.id);
        } catch {
          // Stable-client ownership rejects leases registered by other clients.
        }
      }
    }
  }

  private enqueueRuntimeEvent(
    state: {
      readonly observation: RuntimeSessionObservation;
      readonly reducer: CoderSessionProjectionReducer;
      eventQueue: Promise<void>;
    },
    event: RuntimeTypedEvent,
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
    event: RuntimeTypedEvent,
  ): Promise<void> {
    const runtime = this.runtime;
    if (!runtime || this.state !== 'ready' || this.observations.get(event.sessionId) !== state)
      return;
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
        await this.revokeCredentialLease(runtime, leaseId);
      }
    }
    this.bridgeRuntimeEvent(event);
    this.scheduleProfileRefresh(event.seq);
  }

  private async syncSpaceSessionSettings(
    sessionId: string,
    settings: RuntimeSessionSettings,
  ): Promise<void> {
    const { kodaxHost, resolveEffectiveProviderModel } = await import('./host.js');
    const session = kodaxHost.get(sessionId);
    if (!session || session.surface !== 'code') return;
    const previousProvider = session.provider;
    if (typeof settings.provider === 'string' && settings.provider.length > 0) {
      session.provider = settings.provider;
    }
    // Runtime settings are an override snapshot: an absent model means "use
    // the provider default", not "send an empty model to provider sidecars".
    // Preserve the current model only as a final fallback for a custom provider
    // whose descriptor is temporarily unavailable during observation startup.
    session.model =
      resolveEffectiveProviderModel(session.provider, settings.model) ??
      (session.provider === previousProvider ? session.model : undefined);
    session.thinking = settings.thinking;
    if (
      settings.reasoningMode === 'off' ||
      settings.reasoningMode === 'auto' ||
      settings.reasoningMode === 'quick' ||
      settings.reasoningMode === 'balanced' ||
      settings.reasoningMode === 'deep'
    ) {
      session.reasoningMode = settings.reasoningMode;
    } else {
      const effortMode = effortToReasoningMode(settings.effort);
      if (effortMode !== undefined) session.reasoningMode = effortMode;
    }
    if (
      settings.permissionMode === 'plan' ||
      settings.permissionMode === 'accept-edits' ||
      settings.permissionMode === 'auto'
    ) {
      session.permissionMode = settings.permissionMode;
    }
    if (settings.agentMode === 'ama' || settings.agentMode === 'sa') {
      session.agentMode = settings.agentMode;
    }
    if (settings.autoModeEngine === 'llm' || settings.autoModeEngine === 'rules') {
      session.autoModeEngine = settings.autoModeEngine;
    }
    await kodaxHost.persistRuntime(sessionId);
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

  private bridgeRuntimeEvent(event: RuntimeTypedEvent): void {
    const payload =
      event.payload !== null && typeof event.payload === 'object'
        ? (event.payload as Readonly<Record<string, unknown>>)
        : undefined;
    const contextEvent = projectRuntimeContextSessionEvent(event);
    if (contextEvent) {
      this.push('session.event', contextEvent);
      return;
    }
    const activityMeta = runtimeEventRecord(payload?.meta) as ChildMeta;
    if (isTransientChildEvent(activityMeta)) {
      if (event.type === 'tool.started') {
        const tool = runtimeEventRecord(payload?.tool);
        this.pushRuntimeChildActivity(activityMeta, 'tool_use', {
          ...(typeof tool?.name === 'string' ? { toolName: tool.name } : {}),
        });
        return;
      }
      if (event.type === 'tool.finished') {
        const result = runtimeEventRecord(payload?.result);
        this.pushRuntimeChildActivity(activityMeta, 'tool_result', {
          ...(typeof result?.name === 'string' ? { toolName: result.name } : {}),
        });
        return;
      }
      if (event.type === 'child_activity.finished') {
        this.pushRuntimeChildActivity(activityMeta, 'end', {});
        return;
      }
      if (
        event.type === 'assistant.delta' ||
        event.type === 'thinking.delta' ||
        event.type === 'thinking.finished' ||
        event.type === 'tool.progress' ||
        event.type === 'todo.updated'
      ) {
        return;
      }
    }
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
    if (event.type === 'sidecar.message') {
      const parsed = sessionEventChannel.payload.safeParse({
        kind: 'sidecar_message',
        sessionId: event.sessionId,
        message: payload,
      });
      if (!parsed.success || parsed.data.kind !== 'sidecar_message') return;
      this.push('session.event', parsed.data);
      if (
        parsed.data.message.verdict === 'blocked' &&
        parsed.data.message.recipient === 'user' &&
        parsed.data.message.delivery === 'terminal-block'
      ) {
        this.terminalSidecarBlockRuns.set(event.runId, event.sessionId);
      }
      return;
    }
    if (event.type === 'run.input.delivered') {
      const inputs = Array.isArray(payload?.inputs) ? payload.inputs : [];
      for (const value of inputs) {
        const delivered = runtimeEventRecord(value);
        const content = runtimeInputText(delivered?.input);
        if (!content) continue;
        const queueId =
          typeof delivered?.inputId === 'string' && delivered.inputId.length <= 128
            ? delivered.inputId
            : undefined;
        const parsed = sessionEventChannel.payload.safeParse({
          kind: 'mid_turn_user_prompt',
          sessionId: event.sessionId,
          ...(queueId ? { queueId } : {}),
          content: clampRuntimePromptEventText(content),
        });
        if (parsed.success) this.push('session.event', parsed.data);
      }
      return;
    }
    // `run.input.delivered` is the canonical daemon interrupt-consumption event. Runtime emits a
    // legacy progress mirror immediately afterward, but that mirror has MessageQueue ids rather
    // than the public per-input ids returned by submitInput. Do not project both into the
    // transcript or one Runtime delivery would create two user boundaries.
    if (event.type === 'run.progress' && payload?.kind === 'mid_turn_user_messages') return;
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
          queueId: event.runId,
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
      this.terminalSidecarBlockRuns.delete(event.runId);
      this.pushTerminalInterruptFailures(event.sessionId, payload, 'run_completed');
      this.push('session.event', { kind: 'session_complete', sessionId: event.sessionId });
      return;
    }
    if (
      event.type === 'run.failed' ||
      event.type === 'run.cancelled' ||
      event.type === 'run.interrupted'
    ) {
      this.pushTerminalInterruptFailures(
        event.sessionId,
        payload,
        event.type === 'run.failed'
          ? 'run_failed'
          : event.type === 'run.cancelled'
            ? 'run_cancelled'
            : 'run_interrupted',
      );
      const terminalSidecarBlock =
        event.type === 'run.failed' &&
        this.terminalSidecarBlockRuns.get(event.runId) === event.sessionId;
      this.terminalSidecarBlockRuns.delete(event.runId);
      if (terminalSidecarBlock) {
        this.push('session.event', { kind: 'session_complete', sessionId: event.sessionId });
        return;
      }
      const terminal = runtimeEventRecord(payload?.terminal);
      const terminalMessage =
        event.type === 'run.failed' && typeof terminal?.message === 'string'
          ? terminal.message.trim() || undefined
          : undefined;
      const error =
        typeof payload?.error === 'string'
          ? payload.error
          : terminalMessage !== undefined
            ? terminalMessage
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

  private pushRuntimeChildActivity(
    meta: ChildMeta,
    kind: 'tool_use' | 'tool_result' | 'end',
    extra: { toolName?: string },
  ): void {
    const activity = buildChildActivity(meta, kind, extra);
    if (activity) this.push('workflow.activity', activity);
  }

  private pushTerminalInterruptFailures(
    sessionId: string,
    payload: Readonly<Record<string, unknown>> | undefined,
    reason: QueuedUserPromptFailureReason,
  ): void {
    const interruptInputs = Array.isArray(payload?.interruptInputs) ? payload.interruptInputs : [];
    for (const value of interruptInputs) {
      const input = runtimeEventRecord(value);
      if (input?.state !== 'terminal') continue;
      const parsed = sessionEventChannel.payload.safeParse({
        kind: 'queued_user_prompt_failed',
        sessionId,
        queueId: input.inputId,
        queueMode: 'interrupt',
        content: input.contentPreview,
        reason,
      });
      if (parsed.success) this.push('session.event', parsed.data);
    }
  }

  async startManagedRun(input: RuntimeDaemonStartRunInput): Promise<RuntimeRunHandle> {
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
        await this.revokeCredentialLease(runtime, registeredCredential.leaseId);
      }
      throw error;
    }
    if (registeredCredential) {
      const lease = this.credentialLeases.get(registeredCredential.leaseId);
      if (lease) lease.runBinding.boundRunId = handle.runId;
    }
    this.activeRuns.set(input.sessionId, handle.runId);
    const result = handle.result.finally(async () => {
      if (this.activeRuns.get(input.sessionId) === handle.runId) {
        this.activeRuns.delete(input.sessionId);
      }
      if (registeredCredential && this.runtime === runtime && this.state === 'ready') {
        await this.revokeCredentialLease(runtime, registeredCredential.leaseId);
      }
    });
    return { ...handle, result };
  }

  private async registerCredentialLease(
    runtime: KodaXDaemonRuntime,
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
    const runBinding: SpaceCredentialLeaseBinding['runBinding'] = {};
    const broker: RuntimeCredentialBroker = async (request) => {
      if (request.provider !== provider || request.sessionId !== sessionId) return undefined;
      if (runBinding.boundRunId !== undefined && request.runId !== runBinding.boundRunId) {
        return undefined;
      }
      runBinding.boundRunId = request.runId;
      return this.credentialResolver(provider);
    };
    const lease = await runtime.credentials.register({ providers: [provider] }, broker);
    const tracked: SpaceCredentialLeaseBinding = {
      leaseId: lease.id,
      provider,
      sessionId,
      runBinding,
      broker,
    };
    this.credentialLeases.set(lease.id, tracked);
    return {
      binding: { leaseId: lease.id, provider },
      leaseId: lease.id,
    };
  }

  private async resumeKnownCredentialLeases(runtime: KodaXDaemonRuntime): Promise<void> {
    for (const [leaseId, binding] of [...this.credentialLeases]) {
      try {
        await runtime.credentials.resume(leaseId, binding.broker);
      } catch {
        this.credentialLeases.delete(leaseId);
        for (const [runId, candidate] of this.continuationCredentialLeases) {
          if (candidate === leaseId) this.continuationCredentialLeases.delete(runId);
        }
      }
    }
  }

  private async revokeCredentialLease(runtime: KodaXDaemonRuntime, leaseId: string): Promise<void> {
    this.credentialLeases.delete(leaseId);
    for (const [runId, candidate] of this.continuationCredentialLeases) {
      if (candidate === leaseId) this.continuationCredentialLeases.delete(runId);
    }
    await runtime.credentials.revoke(leaseId).catch(() => false);
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
    return statuses.slice().sort((a, b) => (b.sessionOrder ?? 0) - (a.sessionOrder ?? 0))[0]?.runId;
  }

  async abortSessionRun(sessionId: string): Promise<boolean> {
    const runtime = this.runtime;
    if (!runtime) return false;
    const statuses = await runtime.runs.list({
      sessionId,
      phase: ['running', 'waiting_permission', 'waiting_user_input', 'queued'],
    });
    const status = statuses.slice().sort((a, b) => {
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
    const isInterrupt = input.delivery === 'interrupt';
    if (isInterrupt && (input.credential !== undefined || input.hostTools !== undefined)) {
      throw new Error(
        'Interrupt input must reuse the active run credential and host-tool bindings.',
      );
    }
    const registeredCredential =
      !isInterrupt && !input.credential
        ? await this.registerCredentialLease(
            runtime,
            (await runtime.runs.get(input.afterRunId)).provider,
            input.sessionId,
          )
        : undefined;
    const credentialBinding = input.credential ?? registeredCredential?.binding;
    let result: RuntimeSubmitInputResult;
    try {
      result = await runtime.runs.submitInput({
        ...input,
        ...(!isInterrupt && credentialBinding ? { credential: credentialBinding } : {}),
        ...(!isInterrupt && !input.hostTools && this.hostToolLeaseId
          ? { hostTools: { leaseId: this.hostToolLeaseId } }
          : {}),
      });
    } catch (error) {
      if (registeredCredential) {
        await this.revokeCredentialLease(runtime, registeredCredential.leaseId);
      }
      throw error;
    }
    if ((!result.accepted || result.delivery !== 'after_turn') && registeredCredential) {
      await this.revokeCredentialLease(runtime, registeredCredential.leaseId);
    } else if (result.accepted && registeredCredential) {
      const lease = this.credentialLeases.get(registeredCredential.leaseId);
      if (lease) lease.runBinding.boundRunId = result.runId;
      this.continuationCredentialLeases.set(result.runId, registeredCredential.leaseId);
    }
    if (result.accepted && result.delivery === 'after_turn') {
      const items = Array.isArray(input.input) ? input.input : [input.input];
      const content = items
        .filter(
          (item): item is Extract<(typeof items)[number], { type: 'text' }> => item.type === 'text',
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
    return this.projectionController.hasPendingInteraction('permission', requestId);
  }

  hasPendingUserInput(requestId: string): boolean {
    return this.projectionController.hasPendingInteraction('ask-user', requestId);
  }

  async respondPermission(
    requestId: string,
    decision: 'allow_once' | 'allow_always' | 'deny',
  ): Promise<boolean> {
    const runtime = await this.requireRuntime();
    const request = (await runtime.permissions.listPending()).find((item) => item.id === requestId);
    if (!request) return false;
    const persistentSuggestion = request.grantSuggestions?.find(
      (suggestion) => suggestion.kind === 'persistent',
    );
    if (decision === 'allow_always' && !persistentSuggestion) return false;
    return runtime.permissions.respond(
      requestId,
      decision === 'allow_always'
        ? {
            type: 'allow_always',
            suggestionId: persistentSuggestion!.id,
          }
        : decision === 'allow_once'
          ? { type: 'allow_once' }
          : { type: 'reject' },
      { runId: request.runId },
    );
  }

  async listPermissionGrants() {
    const runtime = await this.requireRuntime();
    return runtime.permissions.listGrants();
  }

  async revokePermissionGrant(grantId: string, expectedRevision: number): Promise<boolean> {
    const runtime = await this.requireRuntime();
    return runtime.permissions.revokeGrant(grantId, expectedRevision);
  }

  async listWorkflows(input?: { readonly sessionId?: string }): Promise<WorkflowRunT[]> {
    const runtime = await this.requireRuntime();
    const snapshots = await runtime.workflows.list({ limit: 500 });
    return snapshots
      .map(projectRuntimeWorkflow)
      .filter((item): item is WorkflowRunT => item !== undefined)
      .filter((item) => input?.sessionId === undefined || item.sessionId === input.sessionId)
      .slice(0, 500);
  }

  async getWorkflow(runId: string): Promise<WorkflowRunT | undefined> {
    const runtime = await this.requireRuntime();
    return projectRuntimeWorkflow(await runtime.workflows.get(runId));
  }

  async controlWorkflow(action: 'pause' | 'resume' | 'stop', runId: string): Promise<boolean> {
    const runtime = await this.requireRuntime();
    return runtime.workflows[action](runId);
  }

  async listLearnedCapabilities(query?: Parameters<KodaXDaemonRuntime['learning']['list']>[0]) {
    const runtime = await this.requireRuntime();
    return runtime.learning.list(query);
  }

  async getLearnedCapability(nameOrSlug: string) {
    const runtime = await this.requireRuntime();
    return runtime.learning.get(nameOrSlug);
  }

  async learningSnapshot() {
    const runtime = await this.requireRuntime();
    return runtime.learning.getSnapshot();
  }

  async controlLearnedCapability(
    action: 'review' | 'trust' | 'reject' | 'disable' | 'rollback',
    nameOrSlug: string,
  ): Promise<void> {
    const runtime = await this.requireRuntime();
    await runtime.learning[action](nameOrSlug);
  }

  async reloadRuntimeConfig(): Promise<void> {
    const runtime = await this.requireRuntime();
    await runtime.config.reload();
  }

  async reloadRuntimeMcp() {
    const runtime = await this.requireRuntime();
    return runtime.mcp.reloadServers();
  }

  async listRuntimeMcpTools(server: string, forceRefresh?: boolean) {
    const runtime = await this.requireRuntime();
    const lists = await runtime.mcp.listTools({
      server,
      ...(forceRefresh ? { forceRefresh } : {}),
    });
    return lists.find((item) => item.serverId === server) ?? { serverId: server, tools: [] };
  }

  async listRuntimeSkills(projectRoot: string) {
    const runtime = await this.requireRuntime();
    return runtime.catalog.skills({ projectRoot, userInvocableOnly: true });
  }

  async listRuntimeCommands(projectRoot?: string) {
    const runtime = await this.requireRuntime();
    return runtime.catalog.commands(projectRoot);
  }

  async listRuntimeAgentRegistrations(input?: {
    readonly projectRoot?: string;
  }): Promise<ExternalAgentRegistrationSummaryT[]> {
    const runtime = await this.requireRuntime();
    const query = {
      actorId: 'space:renderer',
      ...(input?.projectRoot ? { projectId: input.projectRoot } : {}),
      readOnly: true,
    };
    const [registrations, dispatchable] = await Promise.all([
      runtime.admin.agentRegistrations.list(),
      runtime.agents.listDispatchable(query),
    ]);
    const listings = new Map(dispatchable.map((item) => [item.descriptor.agentId, item]));
    return registrations.map((registration) =>
      projectRuntimeRegistration(registration, listings.get(registration.agentId)),
    );
  }

  async listRuntimeDispatchableAgents(input: {
    readonly projectRoot?: string;
    readonly readOnly: boolean;
  }): Promise<DispatchableAgentListingT[]> {
    const runtime = await this.requireRuntime();
    const listings = await runtime.agents.listDispatchable({
      actorId: 'space:renderer',
      ...(input.projectRoot ? { projectId: input.projectRoot } : {}),
      readOnly: input.readOnly,
    });
    return listings.map(projectRuntimeDispatchable).slice(0, 256);
  }

  async preflightRuntimeAgent(input: {
    readonly agentId: string;
    readonly projectRoot?: string;
    readonly readOnly: boolean;
    readonly expectedConfigurationRevision?: string;
  }) {
    const runtime = await this.requireRuntime();
    const result = await runtime.agents.preflight({
      agentId: input.agentId,
      query: {
        actorId: 'space:renderer',
        ...(input.projectRoot ? { projectId: input.projectRoot } : {}),
        readOnly: input.readOnly,
      },
      ...(input.expectedConfigurationRevision
        ? { expectedConfigurationRevision: input.expectedConfigurationRevision }
        : {}),
    });
    return {
      ok: result.ok,
      ...(result.descriptor
        ? {
            descriptor: projectRuntimeDispatchable({
              descriptor: result.descriptor,
              dispatchability: result.dispatchability,
            }).descriptor,
          }
        : {}),
      dispatchability: projectRuntimeDispatchability(result.dispatchability),
      reasons: [...result.reasons].slice(0, 32),
    };
  }

  async listRuntimeActorTasks(sessionId: string, agentId?: string): Promise<ExternalAgentTaskT[]> {
    const runtime = await this.requireRuntime();
    const tree = await runtime.agents.tree(sessionId);
    const details = await Promise.all(
      tree.actors
        .filter((actor) => actor.kind === 'external')
        .map((actor) => runtime.agents.detail(sessionId, actor.path)),
    );
    const tasks = details.flatMap((detail) =>
      detail.turns
        .filter((turn) => {
          const candidate = turn.metadata?.agentId;
          return agentId === undefined || candidate === agentId;
        })
        .map((turn) => projectRuntimeActorTask(sessionId, detail, turn)),
    );
    return tasks.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)).slice(0, 256);
  }

  async startRuntimeActorTask(input: {
    readonly sessionId: string;
    readonly agentId: string;
    readonly objective: string;
    readonly projectRoot?: string;
    readonly readOnly: boolean;
    readonly expectedConfigurationRevision?: string;
  }): Promise<ExternalAgentTaskT> {
    const runtime = await this.requireRuntime();
    const preflight = await runtime.agents.preflight({
      agentId: input.agentId,
      query: {
        actorId: 'space:renderer',
        ...(input.projectRoot ? { projectId: input.projectRoot } : {}),
        parentTaskId: input.sessionId,
        readOnly: input.readOnly,
      },
      ...(input.expectedConfigurationRevision
        ? { expectedConfigurationRevision: input.expectedConfigurationRevision }
        : {}),
    });
    if (!preflight.ok || !preflight.descriptor) {
      throw new Error(preflight.reasons.join('; ') || 'external agent is not dispatchable');
    }
    const taskName = `external-${input.agentId.replace(/[^a-zA-Z0-9_-]+/g, '-').slice(0, 48)}`;
    const started = await runtime.agents.spawn(input.sessionId, {
      taskName,
      objective: input.objective,
      kind: 'external',
      metadata: {
        agentId: input.agentId,
        configurationRevision: preflight.descriptor.configurationRevision,
        protocol: preflight.descriptor.protocol,
        readOnly: input.readOnly,
      },
    });
    const detail = await runtime.agents.detail(input.sessionId, started.actorPath);
    const turn = detail.turns.find((item) => item.turnId === started.turnId);
    if (!turn) throw new Error('Coder daemon did not retain the accepted external Agent turn.');
    return projectRuntimeActorTask(input.sessionId, detail, turn);
  }

  async runtimeActorTaskEvents(
    sessionId: string,
    taskId: string,
    cursor: number,
  ): Promise<{ events: ExternalAgentTaskEventT[]; nextCursor: number }> {
    const { runtime, identity } = await this.runtimeActorTaskContext(sessionId, taskId);
    const events = await runtime.agents.events(sessionId, cursor);
    return {
      events: events
        .filter(
          (event) =>
            event.actorPath === identity.actorPath &&
            (event.turnId === undefined || event.turnId === identity.turnId),
        )
        .map(projectRuntimeActorEvent)
        .filter((event): event is ExternalAgentTaskEventT => event !== undefined)
        .slice(0, 512),
      nextCursor: events.reduce((next, event) => Math.max(next, event.sequence), cursor),
    };
  }

  private async runtimeActorTask(sessionId: string, taskId: string): Promise<ExternalAgentTaskT> {
    const { runtime, identity, detail, turn } = await this.runtimeActorTaskContext(
      sessionId,
      taskId,
    );
    const output = await runtime.agents.output(sessionId, identity.actorPath, identity.turnId);
    return projectRuntimeActorTask(sessionId, detail, turn, output);
  }

  private async runtimeActorTaskContext(sessionId: string, taskId: string) {
    const runtime = await this.requireRuntime();
    const identity = decodeRuntimeActorTaskId(taskId);
    const detail = await runtime.agents.detail(sessionId, identity.actorPath);
    const turn = detail.turns.find((item) => item.turnId === identity.turnId);
    if (!turn || detail.actor.kind !== 'external') {
      throw new Error('external Agent turn does not belong to the selected session');
    }
    return { runtime, identity, detail, turn };
  }

  async sendRuntimeActorTaskInput(
    sessionId: string,
    taskId: string,
    content: string,
  ): Promise<ExternalAgentTaskT> {
    const { runtime, identity } = await this.runtimeActorTaskContext(sessionId, taskId);
    await runtime.agents.send(sessionId, identity.actorPath, content, 'internal');
    return this.runtimeActorTask(sessionId, taskId);
  }

  async cancelRuntimeActorTask(
    sessionId: string,
    taskId: string,
    reason?: string,
  ): Promise<ExternalAgentTaskT> {
    const { runtime, identity } = await this.runtimeActorTaskContext(sessionId, taskId);
    await runtime.agents.interrupt(sessionId, identity.actorPath, reason);
    return this.runtimeActorTask(sessionId, taskId);
  }

  async reconcileRuntimeActorTask(sessionId: string, taskId: string): Promise<ExternalAgentTaskT> {
    return this.runtimeActorTask(sessionId, taskId);
  }

  ownsRuntimeActorTask(taskId: string): boolean {
    return isRuntimeActorTaskId(taskId);
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

  async preflightDaemonStop(): Promise<RuntimeDaemonPreflight> {
    return (await this.inspectDaemonStop()).preflight;
  }

  async inspectDaemonStop(): Promise<RuntimeDaemonManagementState> {
    const runtime = await this.requireRuntime();
    const state = await runtime.daemon.inspect();
    if (state.runtimeId !== runtime.identity.runtimeId) {
      throw new Error('Coder daemon management Runtime identity changed during inspection.');
    }
    return state;
  }

  async prepareInlineRollback(operationId?: string): Promise<RuntimeDaemonRollbackResult> {
    const runtime = await this.requireRuntime();
    const management = await this.inspectDaemonStop();
    if (!management.preflight.canStop) {
      const error = new Error(
        `Coder daemon cannot stop safely: ${management.preflight.blockers.join(', ') || 'unknown blocker'}.`,
      ) as Error & { code: 'conflict'; data: RuntimeDaemonPreflight };
      error.code = 'conflict';
      error.data = management.preflight;
      throw error;
    }
    this.rollbackInProgress = true;
    let rollback: RuntimeDaemonRollbackResult;
    try {
      rollback = await runtime.daemon.stopForInline({
        expectedRuntimeId: management.runtimeId,
        expectedRevision: management.revision,
        expectedOwnerPolicyRevision: management.ownerPolicy.revision,
        ...(operationId !== undefined ? { operation: { operationId } } : {}),
      });
    } catch (error) {
      this.rollbackInProgress = false;
      throw error;
    }
    try {
      await this.waitForDaemonOwnerRelease(rollback.runtimeId);
      await this.close();
      this.inlineOwner = await this.ownerControl.acquireInline({
        ...this.runtimeOwnerTarget(),
      });
    } catch (error) {
      // The daemon has already committed the stop at this point. Do not leave the
      // profile stranded in inline policy just because Space failed to finish
      // closing its Runtime connection or acquire the replacement owner fence.
      await this.close().catch(() => undefined);
      try {
        await this.restoreDaemonOwner();
      } catch (restoreError) {
        throw new AggregateError(
          [error, restoreError],
          'Coder daemon stopped, but Space could not complete or recover inline rollback.',
        );
      }
      throw error;
    }
    return rollback;
  }

  async restoreDaemonOwner(): Promise<RuntimeOwnerPolicyState> {
    if (!this.rollbackInProgress) {
      throw new Error('Space does not have an inline rollback to restore.');
    }
    const inlineOwner = this.inlineOwner;
    this.inlineOwner = undefined;
    inlineOwner?.close();
    try {
      const policy = await this.ownerControl.enableDaemon({
        ...this.runtimeOwnerTarget(),
      });
      this.rollbackInProgress = false;
      this.state = 'closed';
      this.lastError = undefined;
      return policy;
    } catch (error) {
      this.lastError = sanitizeDiagnosticError(error);
      try {
        // Enabling daemon policy can fail transiently. Reacquire the inline fence
        // so the caller can retry without exposing an unowned inline profile.
        this.inlineOwner = await this.ownerControl.acquireInline({
          ...this.runtimeOwnerTarget(),
        });
        this.state = 'closed';
      } catch (fenceError) {
        this.state = 'failed';
        this.lastError = `${this.lastError}; failed to reacquire inline owner fence: ${sanitizeDiagnosticError(fenceError)}`;
      }
      throw error;
    }
  }

  private async waitForDaemonOwnerRelease(runtimeId: string): Promise<void> {
    const deadline = Date.now() + 30_000;
    while (true) {
      const state = await this.ownerControl.getState({
        ...this.runtimeOwnerTarget(),
      });
      if (state.ownerStatus === 'unowned') return;
      if (state.ownerStatus === 'unreadable') {
        throw new Error('Coder owner state became unreadable during inline rollback.');
      }
      if (state.owner?.runtimeId !== runtimeId) {
        throw new Error('A different Coder owner acquired the profile during inline rollback.');
      }
      if (Date.now() >= deadline) {
        throw new Error('Timed out waiting for the Coder daemon owner to release.');
      }
      await new Promise<void>((resolve) => setTimeout(resolve, 25));
    }
  }

  async close(): Promise<void> {
    const inlineOwner = this.inlineOwner;
    this.inlineOwner = undefined;
    inlineOwner?.close();
    if (this.closePromise !== null) return this.closePromise;
    const runtime = this.runtime;
    const initializing = this.initializePromise;
    this.connectionSubscription?.close();
    this.connectionSubscription = undefined;
    this.workflowSubscription?.close();
    this.workflowSubscription = undefined;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = undefined;
    this.runtime = null;
    this.hostToolLeaseId = undefined;
    this.hostToolLeaseIds.clear();
    this.activeRuns.clear();
    this.runProviders.clear();
    this.terminalSidecarBlockRuns.clear();
    this.continuationCredentialLeases.clear();
    this.credentialLeases.clear();
    this.continuationPrompts.clear();
    for (const state of this.observations.values()) state.observation.close();
    this.observations.clear();
    this.observationPromises.clear();
    this.desiredObservations.clear();
    this.state = 'closed';
    this.closePromise = runtime
      ? runtime.close()
      : (initializing?.catch(() => undefined) ?? Promise.resolve());
    return this.closePromise;
  }

  private runtimeOwnerTarget(): { readonly homeDir?: string; readonly profile: string } {
    return {
      profile: 'coder',
      ...(this.runtimeHomeDir !== undefined ? { homeDir: this.runtimeHomeDir } : {}),
    };
  }
}

export const runtimeHostAdapter = new RuntimeHostAdapter({
  projectionController: runtimeProjectionController,
  push: pushToRenderer,
});
