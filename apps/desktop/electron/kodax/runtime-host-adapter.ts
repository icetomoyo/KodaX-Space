import path from 'node:path';

import type {
  ConnectKodaXRuntimeOptions,
  KodaXDaemonRuntime,
  RuntimeIdentity,
  RuntimeAppendNoticeInput,
  RuntimeCompactSessionInput,
  RuntimeCompactSessionResult,
  RuntimeConversationHistory,
  RuntimeConversationHistoryBoundary,
  RuntimeConversationHistorySliceEntry,
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
  RuntimeRunStopReceipt,
  RuntimeRunStatus,
  RuntimeObservationInvalidation,
  RuntimeReadOptions,
  RuntimeSessionDiagnostics,
  RuntimeSessionDiagnosticsInput,
  RuntimeSessionObservation,
  RuntimeSessionObservationSnapshot,
  RuntimeSessionFilter,
  RuntimeSession,
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
  loadKodaxAutoModeDefaults,
  type KodaxAutoModeDefaults,
  type SdkCustomProviderConfig,
} from './user-config.js';
import {
  invalidatePersistedSessionCache,
  loadPersistedSessionFresh,
  persistedSessionFreshnessToken,
  preparePersistedSessionFreshnessTracking,
  SPACE_EPHEMERAL_SESSION_TAG,
} from './session-store.js';
import { RuntimeClientIdentityStore } from './runtime/runtime-client-identity.js';
import {
  CoderSessionProjectionReducer,
  isPartnerRuntimeSessionIdentity,
  projectRuntimeProfile,
  projectRuntimeSessionSnapshot,
} from './runtime/coder-daemon-projection.js';
import {
  createPendingSdkRuntimeProjection,
  RuntimeProjectionUnavailableError,
  runtimeProjectionController,
  type RuntimeProjectionController,
} from './runtime/runtime-projection-controller.js';
import { pushToRenderer } from '../ipc/push.js';
import { areLearningMutationsEnabled } from './learning-policy.js';
import {
  canonProjectRoot,
  sessionEventChannel,
  workflowProcessSnapshotSchema,
  workflowRunSchema,
  type AgentActorTreeSnapshotT,
  type WorkflowActivityPayload,
  type WorkflowEventPayload,
  type WorkflowRunT,
  type DispatchableAgentListingT,
  type ExternalAgentRegistrationSummaryT,
  type ExternalAgentTaskEventT,
  type ExternalAgentTaskT,
  type SessionEvent,
  type SpaceCoderConnectionProjectionT,
  type SpaceRuntimeProfileProjectionT,
  type SpaceSessionLiveProjectionT,
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
import { RuntimeAgentTreeObserver } from './runtime/runtime-agent-tree-observer.js';
import { buildChildActivity, isTransientChildEvent, type ChildMeta } from './workflow-activity.js';
import {
  createCoderOwnerRecoveryRestartError,
  isCoderOwnerRecoveryRestartRequired,
} from './coder-owner-recovery-error.js';
import {
  createRuntimeStartupTiming,
  type RuntimeStartupTimingFactory,
} from './runtime-startup-timing.js';

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

const PROFILE_CHANGING_RUNTIME_EVENTS: ReadonlySet<RuntimeTypedEvent['type']> = new Set([
  'session.created',
  'run.queued',
  'run.started',
  'run.updated',
  'run.input.queued',
  'run.input.delivered',
  'user_input.requested',
  'user_input.resolved',
  'permission.requested',
  'permission.resolved',
  'run.completed',
  'run.failed',
  'run.cancelled',
  'run.interrupted',
]);

/**
 * Profile snapshots contain Session/Run/interaction summaries, not transcript deltas.
 * Refreshing them for every streamed token is both expensive and semantically misleading.
 */
export function runtimeEventChangesProfile(type: RuntimeTypedEvent['type']): boolean {
  return PROFILE_CHANGING_RUNTIME_EVENTS.has(type);
}

export function runtimeConnectionSemanticallyEqual(
  left: SpaceCoderConnectionProjectionT,
  right: SpaceCoderConnectionProjectionT,
): boolean {
  return (
    left.state === right.state &&
    left.stale === right.stale &&
    left.runtimeId === right.runtimeId &&
    left.profile === right.profile &&
    left.reason === right.reason &&
    JSON.stringify(left.integrations) === JSON.stringify(right.integrations) &&
    left.capabilities.length === right.capabilities.length &&
    left.capabilities.every((capability, index) => {
      const other = right.capabilities[index];
      return (
        other !== undefined &&
        capability.id === other.id &&
        capability.version === other.version &&
        capability.available === other.available &&
        capability.reason === other.reason
      );
    })
  );
}

function runtimeEventRecord(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : undefined;
}

export function runtimeSessionEventOrigin(runtimeId: string | undefined, event: RuntimeTypedEvent) {
  return runtimeId
    ? {
        runtimeEvent: {
          runtimeId,
          runId: event.runId,
          seq: event.seq,
        },
      }
    : {};
}

function runtimeTranscriptTurnIdentity(event: RuntimeTypedEvent) {
  return event.turnId ? { turnId: event.turnId } : {};
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

function projectRuntimeContextBudgetSnapshot(
  sessionId: string,
  value: unknown,
): SessionEvent | undefined {
  const snapshot = runtimeEventRecord(value);
  if (!snapshot) return undefined;
  const parsed = sessionEventChannel.payload.safeParse({
    ...snapshot,
    kind: 'context_budget_snapshot',
    sessionId,
  });
  return parsed.success ? parsed.data : undefined;
}

function projectRuntimeProviderCacheDiagnostic(
  sessionId: string,
  value: unknown,
): SessionEvent | undefined {
  const diagnostic = runtimeEventRecord(value);
  if (!diagnostic || diagnostic.phase !== 'response') return undefined;
  const parsed = sessionEventChannel.payload.safeParse({
    ...diagnostic,
    kind: 'provider_cache_diagnostic',
    sessionId,
    ...(typeof diagnostic.cachedReadTokens === 'number'
      ? { cacheReadInputTokens: diagnostic.cachedReadTokens }
      : {}),
    ...(typeof diagnostic.cachedWriteTokens === 'number'
      ? { cacheWriteInputTokens: diagnostic.cachedWriteTokens }
      : {}),
  });
  return parsed.success ? parsed.data : undefined;
}

type RuntimeTranscriptEntry = RuntimeTranscript['transcriptEntries'][number];
type RuntimeConversationHistoryEntry = RuntimeConversationHistory['entries'][number];

export interface RuntimeConversationHistoryPage {
  readonly revision: string;
  readonly sourceRevision: string;
  readonly status: RuntimeConversationHistory['status'];
  readonly issues: RuntimeConversationHistory['issues'];
  readonly entries: readonly {
    readonly index: number;
    readonly entry: RuntimeConversationHistoryEntry;
  }[];
  readonly hasMore: boolean;
  readonly nextCursor?: string;
}

export type RuntimeConversationHistoryPageResult =
  | { readonly outcome: 'ready'; readonly page: RuntimeConversationHistoryPage | null }
  | { readonly outcome: 'data_changed' };

const RUNTIME_READ_TIMEOUT_MS = 15_000;
const RUNTIME_TRANSCRIPT_TOTAL_TIMEOUT_MS = 60_000;
const MAX_RUNTIME_TRANSCRIPT_RESYNCS = 2;
const MAX_PROFILE_REFRESH_CONFLICT_RETRIES = 2;
const PROFILE_REFRESH_CONFLICT_RETRY_MS = 25;
const MAX_RUNTIME_CONVERSATION_ENTRY_BYTES = 32 * 1024 * 1024;
const MAX_RUNTIME_CONVERSATION_TOTAL_BYTES = 32 * 1024 * 1024;
const MAX_RUNTIME_CONVERSATION_ENTRIES = 100_000;
const MAX_SESSION_IDENTITY_READ_ATTEMPTS = 3;
const SESSION_IDENTITY_RETRY_BASE_MS = 25;

function runtimeErrorCode(error: unknown): string | undefined {
  return error && typeof error === 'object' && 'code' in error
    ? String((error as { readonly code?: unknown }).code)
    : undefined;
}

function isRuntimeResyncRequired(error: unknown): boolean {
  const code = runtimeErrorCode(error);
  return code === 'resync_required' || code === 'data_changed';
}

function isSessionIdentityReadConflict(error: unknown): boolean {
  const code = runtimeErrorCode(error);
  return code === 'data_changed' || code === 'resync_required';
}

function isRuntimeSnapshotConflict(error: unknown): boolean {
  return runtimeErrorCode(error) === 'conflict';
}

async function waitForProfileRefreshRetry(attempt: number): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, PROFILE_REFRESH_CONFLICT_RETRY_MS * attempt);
  });
}

async function readPagedTranscriptEntry(
  runtime: KodaXDaemonRuntime,
  sessionId: string,
  revision: string,
  descriptor: RuntimeTranscriptSliceEntry,
  options: RuntimeReadOptions,
): Promise<RuntimeTranscriptEntry> {
  if (descriptor.entry) return descriptor.entry;
  const chunks: Buffer[] = [];
  let cursor: string | undefined;
  do {
    const chunk = await runtime.sessions.transcriptEntryChunk(
      {
        sessionId,
        revision,
        entryIndex: descriptor.index,
        ...(cursor ? { cursor } : {}),
      },
      options,
    );
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

async function readPagedConversationEntry(
  runtime: KodaXDaemonRuntime,
  sessionId: string,
  revision: string,
  descriptor: RuntimeConversationHistorySliceEntry,
  options: RuntimeReadOptions,
): Promise<RuntimeConversationHistoryEntry> {
  if (!Number.isSafeInteger(descriptor.index) || descriptor.index < 0) {
    throw new Error('Conversation history contains an invalid entry index.');
  }
  if (
    !Number.isSafeInteger(descriptor.byteLength) ||
    descriptor.byteLength <= 0 ||
    descriptor.byteLength > MAX_RUNTIME_CONVERSATION_ENTRY_BYTES
  ) {
    throw new Error(`Conversation entry ${descriptor.index} has an invalid byte length.`);
  }
  if (descriptor.entry) {
    if (descriptor.oversized) {
      throw new Error(`Conversation entry ${descriptor.index} has conflicting inline metadata.`);
    }
    if (descriptor.entry.boundaryId !== descriptor.boundaryId) {
      throw new Error(`Conversation entry ${descriptor.index} changed its boundary identity.`);
    }
    const encoded = JSON.stringify(descriptor.entry);
    if (Buffer.byteLength(encoded, 'utf8') !== descriptor.byteLength) {
      throw new Error(`Conversation entry ${descriptor.index} changed its encoded byte length.`);
    }
    return descriptor.entry;
  }
  if (!descriptor.oversized) {
    throw new Error(`Conversation entry ${descriptor.index} omitted its inline body.`);
  }
  const chunks: Buffer[] = [];
  const seenCursors = new Set<string>();
  let decodedBytes = 0;
  let cursor: string | undefined;
  do {
    const chunk = await runtime.sessions.conversationEntryChunk(
      {
        sessionId,
        revision,
        entryIndex: descriptor.index,
        ...(cursor ? { cursor } : {}),
      },
      options,
    );
    if (!chunk) throw new Error(`Conversation entry ${descriptor.index} is unavailable.`);
    if (chunk.revision !== revision || chunk.entryIndex !== descriptor.index) {
      throw new Error(`Conversation entry ${descriptor.index} crossed its immutable boundary.`);
    }
    if (chunk.boundaryId !== descriptor.boundaryId) {
      throw new Error(`Conversation entry ${descriptor.index} changed its boundary identity.`);
    }
    if (chunk.encoding !== 'base64-json') {
      throw new Error(`Conversation entry ${descriptor.index} used an unsupported chunk encoding.`);
    }
    if (
      chunk.data.length === 0 ||
      chunk.data.length % 4 !== 0 ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(chunk.data)
    ) {
      throw new Error(`Conversation entry ${descriptor.index} contains malformed base64 data.`);
    }
    const decoded = Buffer.from(chunk.data, 'base64');
    if (decoded.toString('base64') !== chunk.data) {
      throw new Error(`Conversation entry ${descriptor.index} contains malformed base64 data.`);
    }
    decodedBytes += decoded.byteLength;
    if (
      decodedBytes > descriptor.byteLength ||
      decodedBytes > MAX_RUNTIME_CONVERSATION_ENTRY_BYTES
    ) {
      throw new Error(`Conversation entry ${descriptor.index} exceeded its declared byte length.`);
    }
    chunks.push(decoded);
    cursor = chunk.hasMore ? chunk.nextCursor : undefined;
    if (chunk.hasMore && !cursor) {
      throw new Error(`Conversation entry ${descriptor.index} omitted its continuation cursor.`);
    }
    if (cursor) {
      if (seenCursors.has(cursor)) {
        throw new Error(`Conversation entry ${descriptor.index} repeated a continuation cursor.`);
      }
      seenCursors.add(cursor);
    }
  } while (cursor);
  if (decodedBytes !== descriptor.byteLength) {
    throw new Error(`Conversation entry ${descriptor.index} changed its encoded byte length.`);
  }
  const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error(`Conversation entry ${descriptor.index} is malformed.`);
  }
  const entry = parsed as RuntimeConversationHistoryEntry;
  if (entry.boundaryId !== descriptor.boundaryId) {
    throw new Error(`Conversation entry ${descriptor.index} changed its boundary identity.`);
  }
  return entry;
}

function conversationIssuesMatch(
  left: RuntimeConversationHistory['issues'],
  right: RuntimeConversationHistory['issues'],
): boolean {
  if (left.length !== right.length) return false;
  return left.every((issue, index) => {
    const candidate = right[index];
    return (
      candidate !== undefined &&
      issue.code === candidate.code &&
      issue.message === candidate.message &&
      issue.occurrenceCount === candidate.occurrenceCount &&
      issue.entryCount === candidate.entryCount &&
      issue.entryIds.length === candidate.entryIds.length &&
      issue.entryIds.every((entryId, entryIndex) => entryId === candidate.entryIds[entryIndex])
    );
  });
}

/**
 * Materialize exactly one immutable Runtime conversation page. Unlike the audit/full-history
 * reader below, this function never follows nextCursor, so first paint remains bounded by the
 * SDK page contract rather than total Session size.
 */
async function readRuntimeConversationHistoryPage(
  runtime: KodaXDaemonRuntime,
  input: { readonly sessionId: string; readonly cursor?: string; readonly limit?: number },
): Promise<RuntimeConversationHistoryPage | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), RUNTIME_READ_TIMEOUT_MS);
  timer.unref?.();
  const readOptions: RuntimeReadOptions = {
    timeoutMs: RUNTIME_READ_TIMEOUT_MS,
    signal: controller.signal,
  };
  try {
    let requestedLimit = input.limit;
    let page = await runtime.sessions.conversationPage(input, readOptions);
    if (!page) return null;
    for (;;) {
      let declaredBytes = 0;
      for (const descriptor of page.entries) {
        if (
          !Number.isSafeInteger(descriptor.byteLength) ||
          descriptor.byteLength <= 0 ||
          descriptor.byteLength > MAX_RUNTIME_CONVERSATION_ENTRY_BYTES
        ) {
          throw new Error(`Conversation entry ${descriptor.index} has an invalid byte length.`);
        }
        declaredBytes += descriptor.byteLength;
      }
      if (declaredBytes <= MAX_RUNTIME_CONVERSATION_TOTAL_BYTES) break;
      if (page.entries.length <= 1) {
        throw new Error('Conversation history page exceeds the Space materialization limit.');
      }
      const nextLimit = Math.max(1, Math.floor(page.entries.length / 2));
      if (requestedLimit !== undefined && nextLimit >= requestedLimit) {
        throw new Error('Conversation history paging did not honor the bounded page limit.');
      }
      requestedLimit = nextLimit;
      page = await runtime.sessions.conversationPage({ ...input, limit: nextLimit }, readOptions);
      if (!page) return null;
    }
    if (page.hasMore && (!page.nextCursor || page.entries.length === 0)) {
      throw new Error('Conversation history page omitted a valid continuation.');
    }
    if (!page.hasMore && page.nextCursor !== undefined) {
      throw new Error('Conversation history page exposed a cursor without a continuation.');
    }
    if (page.entries.length > MAX_RUNTIME_CONVERSATION_ENTRIES) {
      throw new Error('Conversation history page exceeds the Space entry limit.');
    }
    const seenIndexes = new Set<number>();
    let totalBytes = 0;
    const entries: Array<{ index: number; entry: RuntimeConversationHistoryEntry }> = [];
    for (const descriptor of page.entries) {
      if (!Number.isSafeInteger(descriptor.index) || descriptor.index < 0) {
        throw new Error('Conversation history contains an invalid entry index.');
      }
      if (seenIndexes.has(descriptor.index)) {
        throw new Error(`Conversation history repeated entry index ${descriptor.index}.`);
      }
      seenIndexes.add(descriptor.index);
      totalBytes += descriptor.byteLength;
      if (totalBytes > MAX_RUNTIME_CONVERSATION_TOTAL_BYTES) {
        throw new Error('Conversation history page exceeds the Space materialization limit.');
      }
      entries.push({
        index: descriptor.index,
        entry: await readPagedConversationEntry(
          runtime,
          input.sessionId,
          page.revision,
          descriptor,
          readOptions,
        ),
      });
    }
    for (let index = 1; index < entries.length; index += 1) {
      if (entries[index - 1]!.index >= entries[index]!.index) {
        throw new Error('Conversation history page is not in canonical ascending order.');
      }
    }
    return {
      revision: page.revision,
      sourceRevision: page.sourceRevision,
      status: page.status,
      issues: page.issues,
      entries,
      hasMore: page.hasMore,
      ...(page.nextCursor !== undefined ? { nextCursor: page.nextCursor } : {}),
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Rebuild the SDK-owned ordinary-conversation projection from immutable newest-first pages.
 * Space deliberately does not infer ordering or collapse raw transcript entries here.
 */
async function readPagedRuntimeConversationHistory(
  runtime: KodaXDaemonRuntime,
  sessionId: string,
): Promise<RuntimeConversationHistory | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), RUNTIME_TRANSCRIPT_TOTAL_TIMEOUT_MS);
  timer.unref?.();
  const readOptions: RuntimeReadOptions = {
    timeoutMs: RUNTIME_READ_TIMEOUT_MS,
    signal: controller.signal,
  };
  try {
    for (let attempt = 0; ; attempt += 1) {
      try {
        let page = await runtime.sessions.conversationPage({ sessionId }, readOptions);
        if (!page) return null;
        const revision = page.revision;
        const sourceRevision = page.sourceRevision;
        const status = page.status;
        const issues = page.issues;
        const entriesByIndex = new Map<number, RuntimeConversationHistoryEntry>();
        const seenPageCursors = new Set<string>();
        let totalBytes = 0;
        do {
          if (
            page.revision !== revision ||
            page.sourceRevision !== sourceRevision ||
            page.status !== status ||
            !conversationIssuesMatch(page.issues, issues)
          ) {
            throw new Error('Conversation history page crossed its immutable boundary.');
          }
          if (page.hasMore && page.entries.length === 0) {
            throw new Error('Conversation history returned an empty continuation page.');
          }
          for (const descriptor of page.entries) {
            if (!Number.isSafeInteger(descriptor.index) || descriptor.index < 0) {
              throw new Error('Conversation history contains an invalid entry index.');
            }
            if (entriesByIndex.has(descriptor.index)) {
              throw new Error(`Conversation history repeated entry index ${descriptor.index}.`);
            }
            if (
              !Number.isSafeInteger(descriptor.byteLength) ||
              descriptor.byteLength <= 0 ||
              descriptor.byteLength > MAX_RUNTIME_CONVERSATION_ENTRY_BYTES
            ) {
              throw new Error(`Conversation entry ${descriptor.index} has an invalid byte length.`);
            }
            totalBytes += descriptor.byteLength;
            if (
              totalBytes > MAX_RUNTIME_CONVERSATION_TOTAL_BYTES ||
              entriesByIndex.size >= MAX_RUNTIME_CONVERSATION_ENTRIES
            ) {
              throw new Error('Conversation history exceeds the Space materialization limit.');
            }
            entriesByIndex.set(
              descriptor.index,
              await readPagedConversationEntry(
                runtime,
                sessionId,
                revision,
                descriptor,
                readOptions,
              ),
            );
          }
          const cursor: string | undefined = page.hasMore ? page.nextCursor : undefined;
          if (page.hasMore && !cursor) {
            throw new Error('Conversation history page omitted its continuation cursor.');
          }
          if (cursor) {
            if (seenPageCursors.has(cursor)) {
              throw new Error('Conversation history repeated a continuation cursor.');
            }
            seenPageCursors.add(cursor);
          }
          page = cursor
            ? await runtime.sessions.conversationPage({ sessionId, cursor }, readOptions)
            : null;
          if (cursor && !page) {
            throw new Error('Conversation history continuation page is unavailable.');
          }
        } while (page);
        const entries: RuntimeConversationHistoryEntry[] = [];
        for (let index = 0; index < entriesByIndex.size; index += 1) {
          const entry = entriesByIndex.get(index);
          if (!entry)
            throw new Error('Conversation history contains a non-contiguous entry index.');
          entries.push(entry);
        }
        return { revision, sourceRevision, status, issues, entries };
      } catch (error) {
        if (!isRuntimeResyncRequired(error) || attempt >= MAX_RUNTIME_TRANSCRIPT_RESYNCS) {
          throw error;
        }
      }
    }
  } finally {
    clearTimeout(timer);
  }
}

function isVisibleConversationUserBoundary(message: unknown): boolean {
  const record = runtimeEventRecord(message);
  if (!record || record.role !== 'user') return false;
  const source = record.source ?? record._source;
  if (source === 'sidecar-verifier') return false;
  if (record.synthetic === true || record._synthetic === true) return false;
  if (typeof record.content === 'string') return record.content.trim().length > 0;
  if (!Array.isArray(record.content)) return false;
  return record.content.some((block) => {
    const value = runtimeEventRecord(block);
    if (!value) return false;
    if (value.type === 'text')
      return typeof value.text === 'string' && value.text.trim().length > 0;
    return value.type === 'image' || value.type === 'image_url';
  });
}

export function conversationTurnEndBoundaryId(
  entries: readonly RuntimeConversationHistoryEntry[],
  turnIndex: number,
): string | null {
  if (!Number.isInteger(turnIndex) || turnIndex < 0) return null;
  let currentTurn = -1;
  let candidate: string | null = null;
  for (const entry of entries) {
    if (isVisibleConversationUserBoundary(entry.message)) {
      if (currentTurn === turnIndex) return candidate;
      currentTurn += 1;
      candidate = entry.boundaryId ?? null;
      continue;
    }
    if (currentTurn === turnIndex) {
      // The selected turn ends at its last visible entry. If that tail has no exact physical
      // boundary, reusing an earlier boundary would silently truncate part of the answer.
      candidate = entry.boundaryId ?? null;
    }
  }
  return currentTurn === turnIndex ? candidate : null;
}

async function readPagedRuntimeTranscript(
  runtime: KodaXDaemonRuntime,
  sessionId: string,
  observationSnapshot?: RuntimeSessionObservationSnapshot,
  loadedSession?: RuntimeSession,
): Promise<RuntimeTranscript | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), RUNTIME_TRANSCRIPT_TOTAL_TIMEOUT_MS);
  timer.unref?.();
  const readOptions: RuntimeReadOptions = {
    timeoutMs: RUNTIME_READ_TIMEOUT_MS,
    signal: controller.signal,
  };
  try {
    for (let attempt = 0; ; attempt++) {
      try {
        const snapshot =
          attempt === 0 &&
          observationSnapshot !== undefined &&
          (observationSnapshot.transcript === null ||
            observationSnapshot.transcript.revision === observationSnapshot.transcriptRevision)
            ? observationSnapshot
            : undefined;
        const session =
          snapshot?.session ??
          (attempt === 0 && loadedSession !== undefined
            ? loadedSession
            : await runtime.sessions.load(sessionId, readOptions));
        if (!session) return null;
        const transcriptEntries: RuntimeTranscriptEntry[] = [];
        let page = snapshot
          ? snapshot.transcript
          : await runtime.sessions.transcriptPage({ sessionId }, readOptions);
        if (!page) {
          return snapshot
            ? {
                title: session.title,
                gitRoot: session.gitRoot ?? session.workspaceRoot ?? '',
                messages: [],
                activeMessages: [],
                transcriptEntries: [],
              }
            : null;
        }
        do {
          const pageEntries: RuntimeTranscriptEntry[] = [];
          for (const descriptor of page.entries) {
            pageEntries.push(
              await readPagedTranscriptEntry(
                runtime,
                sessionId,
                page.revision,
                descriptor,
                readOptions,
              ),
            );
          }
          transcriptEntries.unshift(...pageEntries);
          const cursor: string | undefined = page.hasMore ? page.nextCursor : undefined;
          if (page.hasMore && !cursor) {
            throw new Error('Transcript page omitted its continuation cursor.');
          }
          page = cursor
            ? await runtime.sessions.transcriptPage({ sessionId, cursor }, readOptions)
            : null;
          if (cursor && !page) {
            throw new Error('Transcript continuation page is unavailable.');
          }
        } while (page);

        const visibleEntries = transcriptEntries.filter((entry) => entry.type !== 'rewind_marker');
        return {
          title: session.title,
          gitRoot: session.gitRoot ?? session.workspaceRoot ?? '',
          messages: visibleEntries.map((entry) => entry.message),
          activeMessages: visibleEntries
            .filter((entry) => entry.active)
            .map((entry) => entry.message),
          transcriptEntries,
        };
      } catch (error) {
        if (!isRuntimeResyncRequired(error) || attempt >= MAX_RUNTIME_TRANSCRIPT_RESYNCS) {
          throw error;
        }
      }
    }
  } finally {
    clearTimeout(timer);
  }
}

export function selectCommittedCompactionEntry(
  transcript: RuntimeTranscript | null,
  event: RuntimeTypedEvent,
  alreadyProjected: ReadonlySet<string> = new Set(),
): { readonly entry: RuntimeTranscriptEntry; readonly canonicalIndex: number } | undefined {
  if (!transcript || event.type !== 'context.compaction.finished') return undefined;
  return selectCommittedCompactionCandidate(
    transcript.transcriptEntries.map((entry, canonicalIndex) => ({ entry, canonicalIndex })),
    event,
    alreadyProjected,
  );
}

type RuntimeCompactionCandidate = {
  readonly entry: RuntimeTranscriptEntry;
  readonly canonicalIndex: number;
};

function selectCommittedCompactionCandidate(
  transcriptCandidates: readonly RuntimeCompactionCandidate[],
  event: RuntimeTypedEvent,
  alreadyProjected: ReadonlySet<string> = new Set(),
): RuntimeCompactionCandidate | undefined {
  if (event.type !== 'context.compaction.finished') return undefined;
  const eventPayload = runtimeEventRecord(event.payload);
  if (eventPayload?.committed !== true) return undefined;
  const isRootContext =
    eventPayload.contextKind === 'root' ||
    (eventPayload.contextKind === undefined && eventPayload.parentContextId === undefined);
  if (!isRootContext) return undefined;
  const compactionEntryId =
    typeof eventPayload.compactionEntryId === 'string' &&
    eventPayload.compactionEntryId.trim().length > 0
      ? eventPayload.compactionEntryId
      : undefined;
  // Token counts, timestamps, active state and canonical proximity are not unique identities.
  // Without the exact durable entry ID, stale paging can make an older same-facts compaction look
  // like the just-committed row. Keep the provisional visible and fail open in that case.
  if (compactionEntryId === undefined) return undefined;
  const tokensBefore =
    typeof eventPayload.tokensBefore === 'number' ? eventPayload.tokensBefore : undefined;
  const tokensAfter =
    typeof eventPayload.tokensAfter === 'number' ? eventPayload.tokensAfter : undefined;
  // The modern Runtime contract persists the same complete token pair on the durable compaction
  // and its committed finish. Without both values there is no safe bridge identity: timestamp
  // proximity alone can bind a new finish to an older tokenless entry.
  if (tokensBefore === undefined || tokensAfter === undefined) return undefined;
  const candidates: RuntimeCompactionCandidate[] = [];

  for (const { entry, canonicalIndex } of transcriptCandidates) {
    if (entry.entryId !== compactionEntryId) continue;
    if (entry.type !== 'compaction') continue;
    const payload = runtimeEventRecord(entry.payload);
    if (
      payload?.reason === 'rewind' ||
      (typeof entry.summary === 'string' && entry.summary.startsWith('[Rewind]'))
    ) {
      continue;
    }
    if (alreadyProjected.has(entry.entryId)) continue;
    const exactTokens =
      payload?.tokensBefore === tokensBefore && payload?.tokensAfter === tokensAfter;
    // Tokenless and partially populated historical entries are not candidates for a modern
    // finished event. They remain visible through history replay, but cannot lend their physical
    // identity to a different live boundary.
    if (!exactTokens) continue;
    candidates.push({ entry, canonicalIndex });
  }
  // Duplicate physical IDs are corrupt/ambiguous. Do not choose one by position.
  return candidates.length === 1 ? candidates[0] : undefined;
}

const RECENT_COMPACTION_PAGE_LIMIT = 64;
const MAX_RECENT_COMPACTION_PAGES = 2;
const MAX_RECENT_COMPACTION_DESCRIPTORS = 128;
const MAX_RECENT_COMPACTION_OVERSIZED_READS = 2;

/**
 * Read only the newest bounded transcript window used to bind a live Runtime compaction event to
 * its durable entry. This must never rebuild a long transcript on the serialized event queue.
 */
async function readRecentRuntimeCompactionCandidates(
  runtime: KodaXDaemonRuntime,
  sessionId: string,
): Promise<RuntimeCompactionCandidate[]> {
  const candidates: RuntimeCompactionCandidate[] = [];
  let cursor: string | undefined;
  let descriptorCount = 0;
  let oversizedReads = 0;

  for (let pageNumber = 0; pageNumber < MAX_RECENT_COMPACTION_PAGES; pageNumber++) {
    const readOptions: RuntimeReadOptions = { timeoutMs: RUNTIME_READ_TIMEOUT_MS };
    const page = await runtime.sessions.transcriptPage(
      {
        sessionId,
        limit: RECENT_COMPACTION_PAGE_LIMIT,
        ...(cursor ? { cursor } : {}),
      },
      readOptions,
    );
    if (!page) return candidates;
    const descriptors = [...page.entries].sort((left, right) => right.index - left.index);
    for (const descriptor of descriptors) {
      if (descriptorCount++ >= MAX_RECENT_COMPACTION_DESCRIPTORS) return candidates;
      let entry = descriptor.entry;
      if (
        !entry &&
        descriptor.oversized &&
        oversizedReads < MAX_RECENT_COMPACTION_OVERSIZED_READS
      ) {
        oversizedReads += 1;
        try {
          entry = await readPagedTranscriptEntry(
            runtime,
            sessionId,
            page.revision,
            descriptor,
            readOptions,
          );
        } catch (error) {
          if (isRuntimeResyncRequired(error)) throw error;
          continue;
        }
      }
      if (entry?.type === 'compaction') {
        candidates.push({ entry, canonicalIndex: descriptor.index });
      }
    }
    cursor = page.hasMore ? page.nextCursor : undefined;
    if (!page.hasMore || !cursor) break;
  }
  return candidates;
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

  if (event.type === 'context.budget.snapshot') {
    return projectRuntimeContextBudgetSnapshot(event.sessionId, payload);
  }
  if (event.type === 'provider.cache.diagnostics') {
    return projectRuntimeProviderCacheDiagnostic(event.sessionId, payload);
  }
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
      ...(runtimeEventRecord(info.usage)
        ? {
            usage: {
              inputTokens: runtimeEventRecord(info.usage)?.inputTokens,
              outputTokens: runtimeEventRecord(info.usage)?.outputTokens,
              cacheReadInputTokens: runtimeEventRecord(info.usage)?.cachedReadTokens,
              cacheWriteInputTokens: runtimeEventRecord(info.usage)?.cachedWriteTokens,
            },
          }
        : {}),
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

type SpaceRuntimeConnectOptions = Omit<ConnectKodaXRuntimeOptions, 'requirements'> & {
  /** Opt-in lifecycle policy for Space-managed daemons. */
  readonly daemonOrphanExitMs?: number;
  readonly requirements?: NonNullable<ConnectKodaXRuntimeOptions['requirements']> & {
    /** The current daemon host actually has Space's orphan idle-exit policy enabled. */
    readonly daemonOrphanExit?: 1;
    /** Managed Run lifecycle events have canonical persistence boundaries. */
    readonly managedRunDurability?: 1;
    /** Provider/tool fragments are bounded before Runtime sequence allocation and persistence. */
    readonly runtimeEventCoalescing?: 1;
  };
};

type RuntimeFactory = (options: SpaceRuntimeConnectOptions) => Promise<KodaXDaemonRuntime>;
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
  (
    channel: 'session.liveInvalidated',
    payload: import('@kodax-space/space-ipc-schema').SpaceSessionLiveInvalidatedT,
  ): void;
  (channel: 'session.event', payload: import('@kodax-space/space-ipc-schema').SessionEvent): void;
  (
    channel: 'agent.actor.changed',
    payload: import('@kodax-space/space-ipc-schema').AgentActorTreeSnapshotT,
  ): void;
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
    readonly enableRollback?: boolean;
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

interface RuntimeActorObservationState {
  readonly runtime: KodaXDaemonRuntime;
  readonly observer: RuntimeAgentTreeObserver;
}

interface RuntimeSessionObservationState {
  readonly sessionId: string;
  readonly runtime: KodaXDaemonRuntime;
  readonly observation: RuntimeSessionObservation;
  readonly reducer: CoderSessionProjectionReducer;
  /** False after the first post-snapshot Runtime event is accepted for delivery. */
  transcriptSnapshotFresh: boolean;
  eventQueue: Promise<void>;
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
  /** Test seam for confirming that the exact inspected daemon PID has exited. */
  readonly daemonProcessExitWaiter?: (pid: number, timeoutMs: number) => Promise<boolean>;
  /**
   * Fallback cadence for integration-health projection. KodaX watches the
   * files inside the daemon but does not publish a management-change event.
   * Test/custom runtimes default to disabled unless they opt in explicitly.
   */
  readonly integrationHealthPollMs?: number;
  /** Test seam for the opt-in Runtime startup timing recorder. */
  readonly startupTimingFactory?: RuntimeStartupTimingFactory;
}

const MAX_DIAGNOSTIC_ERROR = 512;
const DAEMON_PROCESS_EXIT_TIMEOUT_MS = 15_000;

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return !(
      error !== null &&
      typeof error === 'object' &&
      'code' in error &&
      (error as { readonly code?: unknown }).code === 'ESRCH'
    );
  }
}

async function waitForDaemonProcessExit(pid: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (isProcessAlive(pid)) {
    if (Date.now() >= deadline) return false;
    await new Promise<void>((resolve) => setTimeout(resolve, 25));
  }
  return true;
}

export function resolveRuntimeHostMode(value: string | undefined): RuntimeHostMode {
  return value?.trim().toLowerCase() === 'legacy' ? 'legacy' : 'runtime';
}

export async function withDarwinRuntimeDaemonTmpdir<T>(
  platform: NodeJS.Platform,
  operation: () => Promise<T>,
  env: NodeJS.ProcessEnv = process.env,
): Promise<T> {
  if (platform !== 'darwin') return operation();
  const previousTmpdir = env.TMPDIR;
  // Darwin's sockaddr_un.sun_path is only 104 bytes. Its normal /var/folders/...
  // TMPDIR can overflow once KodaX appends the scoped daemon endpoint filename.
  // Keep the SDK default endpoint (required for auto-start), but compute and
  // spawn it under the canonical short /tmp alias.
  env.TMPDIR = '/tmp';
  try {
    return await operation();
  } finally {
    if (previousTmpdir === undefined) {
      delete env.TMPDIR;
    } else {
      env.TMPDIR = previousTmpdir;
    }
  }
}

function runtimeCapabilityVersion(runtime: KodaXDaemonRuntime, name: string): number {
  const capability = runtime.capabilities?.[name];
  if (capability === true) return 1;
  if (typeof capability !== 'object' || capability === null) return 0;
  const version = (capability as { version?: unknown }).version;
  return Number.isSafeInteger(version) && Number(version) > 0 ? Number(version) : 0;
}

function assertSpaceDaemonRequiredCapabilities(runtime: KodaXDaemonRuntime): void {
  if (runtimeCapabilityVersion(runtime, 'daemonOrphanExit') < 1) {
    throw new Error(
      'KodaX Runtime does not support the required daemonOrphanExit v1 capability. ' +
        'Install a compatible KodaX package and restart the Coder daemon.',
    );
  }
  if (runtimeCapabilityVersion(runtime, 'runtimeEventCoalescing') < 1) {
    throw new Error(
      'KodaX Runtime does not support the required runtimeEventCoalescing v1 capability. ' +
        'Install a compatible KodaX package and restart the Coder daemon.',
    );
  }
  if (runtimeCapabilityVersion(runtime, 'managedRunDurability') < 1) {
    throw new Error(
      'KodaX Runtime does not support the required managedRunDurability v1 capability. ' +
        'Install a compatible KodaX package and restart the Coder daemon.',
    );
  }
  if (runtimeCapabilityVersion(runtime, 'conversationHistory') < 1) {
    throw new Error(
      'KodaX Runtime does not support the required conversationHistory v1 capability. ' +
        'Install a compatible KodaX package and restart the Coder daemon.',
    );
  }
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

function runtimeStartupFailureData(error: unknown): Readonly<Record<string, unknown>> {
  const code =
    error !== null && typeof error === 'object' && 'code' in error
      ? (error as { readonly code?: unknown }).code
      : undefined;
  return {
    errorType: error instanceof Error ? error.name : typeof error,
    ...(typeof code === 'string' || typeof code === 'number' ? { errorCode: code } : {}),
  };
}

function runtimeIdentityTimingData(
  identity: RuntimeIdentity,
  now = Date.now(),
): Readonly<Record<string, unknown>> {
  const startedAt = Date.parse(identity.startedAt);
  return {
    runtimeId: identity.runtimeId,
    mode: identity.mode,
    profile: identity.profile,
    version: identity.version,
    ...(identity.isolation === undefined ? {} : { isolation: identity.isolation }),
    ...(Number.isFinite(startedAt) ? { runtimeAgeMs: Math.max(0, now - startedAt) } : {}),
  };
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
  options: SpaceRuntimeConnectOptions,
): Promise<KodaXDaemonRuntime> {
  const sdk = await import('@kodax-ai/kodax/runtime');
  assertSpaceRuntimeSdkRequiredCapabilities(
    sdk as typeof sdk & {
      readonly KODAX_RUNTIME_SDK_CAPABILITIES?: {
        readonly daemonOrphanExit?: number;
        readonly managedRunDurability?: number;
        readonly runtimeEventCoalescing?: number;
      };
    },
  );
  return withDarwinRuntimeDaemonTmpdir(process.platform, () => sdk.connectKodaXRuntime(options));
}

export function assertSpaceRuntimeSdkRequiredCapabilities(sdk: {
  readonly KODAX_RUNTIME_SDK_CAPABILITIES?: {
    readonly daemonOrphanExit?: number;
    readonly managedRunDurability?: number;
    readonly runtimeEventCoalescing?: number;
  };
}): void {
  const capabilities = sdk.KODAX_RUNTIME_SDK_CAPABILITIES;
  const missing = [
    ...(capabilities?.daemonOrphanExit === 1 ? [] : ['daemonOrphanExit v1']),
    ...(capabilities?.managedRunDurability === 1 ? [] : ['managedRunDurability v1']),
    ...(capabilities?.runtimeEventCoalescing === 1 ? [] : ['runtimeEventCoalescing v1']),
  ];
  if (missing.length > 0) {
    throw new Error(
      `The installed KodaX SDK does not support ${missing.join(' and ')}. ` +
        'Install a compatible Registry package before starting Coder.',
    );
  }
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

export class RuntimeSessionIdentityConflictError extends Error {
  readonly code = 'session_identity_conflict' as const;

  constructor(sessionId: string, reason: string) {
    super(`Runtime Session identity conflict for ${sessionId}: ${reason}`);
    this.name = 'RuntimeSessionIdentityConflictError';
  }
}

function canonicalRuntimeProjectRoot(projectRoot: string): string {
  return canonProjectRoot(path.resolve(projectRoot), process.platform === 'win32');
}

function assertRuntimeSessionIdentity(
  session: RuntimeSession,
  expected: { readonly sessionId: string; readonly projectRoot?: string },
): void {
  if (session.id !== expected.sessionId) {
    throw new RuntimeSessionIdentityConflictError(
      expected.sessionId,
      `Runtime returned Session ${session.id}.`,
    );
  }
  if (session.surface === 'partner' || session.profileId === 'kodax-space.partner') {
    throw new RuntimeSessionIdentityConflictError(
      expected.sessionId,
      'Partner Sessions must remain on the inline Partner owner.',
    );
  }
  if (expected.projectRoot === undefined) return;

  const workspaceRoot =
    typeof session.workspaceRoot === 'string' && session.workspaceRoot.trim().length > 0
      ? session.workspaceRoot
      : undefined;
  const gitRoot =
    typeof session.gitRoot === 'string' && session.gitRoot.trim().length > 0
      ? session.gitRoot
      : undefined;
  const observedRoot = workspaceRoot ?? gitRoot;
  if (observedRoot === undefined) {
    throw new RuntimeSessionIdentityConflictError(
      expected.sessionId,
      'the persisted Runtime Session has no workspaceRoot or gitRoot.',
    );
  }

  const canonicalExpected = canonicalRuntimeProjectRoot(expected.projectRoot);
  if (canonicalRuntimeProjectRoot(observedRoot) !== canonicalExpected) {
    const field = workspaceRoot !== undefined ? 'workspaceRoot' : 'gitRoot';
    throw new RuntimeSessionIdentityConflictError(
      expected.sessionId,
      `${field} ${observedRoot} does not match projectRoot ${expected.projectRoot}.`,
    );
  }
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

function isDaemonStopTransportClosure(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /^Runtime daemon transport (?:closed|disconnected)\.?$/i.test(message.trim());
}

class RuntimeInitializationAuthorityLostError extends Error {
  constructor() {
    super('Coder daemon authority changed before Runtime initialization completed.');
    this.name = 'RuntimeInitializationAuthorityLostError';
  }
}

export class RuntimeHostAdapter {
  private mode: RuntimeHostMode;
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
  private readonly daemonProcessExitWaiter: (pid: number, timeoutMs: number) => Promise<boolean>;
  private readonly integrationHealthPollMs: number;
  private readonly startupTimingFactory: RuntimeStartupTimingFactory;
  private state: RuntimeHostState = 'uninitialized';
  private runtime: KodaXDaemonRuntime | null = null;
  private initializePromise: Promise<void> | null = null;
  private closePromise: Promise<void> | null = null;
  private lastError: string | undefined;
  private startupOwnerPolicyFailure: string | undefined;
  private runtimeReadyRevision = 0;
  private readonly runtimeReadyObservers = new Set<(revision: number) => void>();
  /** Stable daemon principal derived from Space's authenticated instanceId. */
  private runtimePrincipalId: string | undefined;
  /** Exact Run identities accepted through this Space process, retained for child-workflow provenance. */
  private readonly spaceOwnedRunIds = new Set<string>();
  /** Exact Runtime Agent turn identities started through this Space process. */
  private readonly spaceOwnedAgentTurns = new Set<string>();
  private readonly activeRuns = new Map<string, string>();
  private readonly observations = new Map<string, RuntimeSessionObservationState>();
  private readonly observationPromises = new Map<string, Promise<void>>();
  private readonly persistedOwnershipTokens = new Map<string, string>();
  /** Full unbounded coder Session membership from the latest authoritative Runtime status read. */
  private runtimeCoderSessionIds = new Set<string>();
  private readonly liveProjectionRevisions = new Map<
    string,
    { readonly runtimeId: string; readonly revision: number }
  >();
  private runtimeProfileSnapshotPromise: Promise<SpaceRuntimeProfileProjectionT> | null = null;
  private readonly ensureSessionPromises = new Map<
    string,
    { readonly identityKey: string; readonly promise: Promise<boolean> }
  >();
  /** One immutable full-history materialization per Session at a time; never a stale result cache. */
  private readonly transcriptPromises = new Map<
    string,
    { readonly token: symbol; readonly promise: Promise<RuntimeTranscript | null> }
  >();
  /** One SDK-owned ordinary-conversation materialization per Session at a time. */
  private readonly conversationPromises = new Map<
    string,
    { readonly token: symbol; readonly promise: Promise<RuntimeConversationHistory | null> }
  >();
  private readonly transcriptGenerations = new Map<string, number>();
  private readonly desiredObservations = new Set<string>();
  /** Context compactions can outlive an individual Run terminal event. */
  private readonly activeCompactionsBySession = new Map<string, Set<string>>();
  /** Space-issued compact() calls whose command promise has not settled on this connection. */
  private readonly localCompactionCallsBySession = new Map<string, number>();
  private readonly actorObservations = new Map<string, RuntimeActorObservationState>();
  private readonly actorSnapshots = new Map<string, AgentActorTreeSnapshotT>();
  private readonly settingsUpdateLocks = new Map<string, Promise<void>>();
  private readonly runProviders = new Map<string, string>();
  /** Persisted compaction entries already projected into the live transcript in this process. */
  private readonly projectedCompactionEntries = new Map<string, Set<string>>();
  /** Stable Runtime finish-event identities already represented by a live provisional boundary. */
  private readonly projectedCompactionEvents = new Map<string, Set<string>>();
  /** Finish events whose provisional row has already been bound to a durable transcript entry. */
  private readonly resolvedCompactionEvents = new Map<string, Set<string>>();
  /** Background durable-entry binding, deliberately outside each observation's event queue. */
  private readonly compactionProjectionTasks = new Map<string, Promise<void>>();
  /** Next canonical user ordinal, but only for root turns observed from turn.started. */
  private readonly nextUserOrdinalByTurnId = new Map<string, number>();
  private readonly terminalSidecarBlockRuns = new Map<string, string>();
  private readonly continuationCredentialLeases = new Map<string, string>();
  private readonly credentialLeases = new Map<string, SpaceCredentialLeaseBinding>();
  private readonly continuationPrompts = new Map<
    string,
    { readonly sessionId: string; readonly content: string }
  >();
  private profileRevision = 0;
  private readonly profileCursors = new Map<string, number>();
  private readonly profileRefreshQueues = new WeakMap<KodaXDaemonRuntime, Promise<void>>();
  private hostToolLeaseId: string | undefined;
  private readonly hostToolLeaseIds = new Set<string>();
  private connectionSubscription: RuntimeSubscription | undefined;
  private workflowSubscription: RuntimeSubscription | undefined;
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  private integrationHealthPollTimer: ReturnType<typeof setTimeout> | undefined;
  private integrationHealthPollInFlight = false;
  private integrationHealthRefreshPending = false;
  private integrationHealthFingerprint = '';
  private integrationHealthPollWarningShown = false;
  private profileManagementConflictWarningShown = false;
  private profileRefreshFailureWarningShown = false;
  private reconnectAttempt = 0;
  private readonly runtimeEventParser?: RuntimeEventParser;
  private inlineOwner: RuntimeInlineOwnerHandle | undefined;
  /**
   * True after an owner transition starts and until it is either compensated
   * back to a usable host or the process restarts. Runtime initialization,
   * reconnect, and health polling must never create fresh daemon activity in
   * this window.
   */
  private rollbackInProgress = false;
  private clientVersion = '0.0.0-dev';

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
    this.daemonProcessExitWaiter = options.daemonProcessExitWaiter ?? waitForDaemonProcessExit;
    this.integrationHealthPollMs =
      options.integrationHealthPollMs ?? (options.runtimeFactory === undefined ? 2_000 : 0);
    this.startupTimingFactory =
      options.startupTimingFactory ?? ((scope) => createRuntimeStartupTiming(scope));
    this.credentialResolver =
      options.credentialResolver ??
      (async (provider) => (await import('../ipc/provider.js')).readProviderCredential(provider));
  }

  selectedHost(): RuntimeHostMode {
    return this.mode;
  }

  configureStartupMode(mode: RuntimeHostMode): void {
    if (this.state !== 'uninitialized' || this.initializePromise !== null) {
      throw new Error('Coder startup mode can only be configured before initialization.');
    }
    this.mode = mode;
  }

  /**
   * Reconcile the persisted Space preference with the SDK owner policy before
   * any Runtime connection is created. Mode switches intentionally order their
   * two durable writes so the Space setting is authoritative after a crash:
   * daemon preference + unowned inline policy is safely completed here.
   */
  async reconcileStartupOwnerPolicy(): Promise<void> {
    if (this.state !== 'uninitialized' || this.initializePromise !== null) {
      throw new Error('Coder owner policy can only be reconciled before initialization.');
    }
    const timing = this.startupTimingFactory('runtime-owner-policy');
    timing.mark('reconcile', 'start', { selectedHost: this.mode });
    if (this.mode !== 'runtime') {
      timing.mark('reconcile', 'skipped', { reason: 'legacy-host-selected' });
      this.startupOwnerPolicyFailure = undefined;
      return;
    }
    let activeStage = 'owner_state_read';
    try {
      const ownerState = await this.ownerControl.getState({
        ...this.runtimeOwnerTarget(),
      });
      const ownerCreatedAt = ownerState.owner ? Date.parse(ownerState.owner.createdAt) : Number.NaN;
      timing.mark(activeStage, 'complete', {
        ownerStatus: ownerState.ownerStatus,
        policyMode: ownerState.policy.mode,
        policyRevision: ownerState.policy.revision,
        ...(ownerState.owner?.kind === undefined ? {} : { ownerKind: ownerState.owner.kind }),
        ...(ownerState.owner === null ? {} : { ownerPid: ownerState.owner.pid }),
        ...(Number.isFinite(ownerCreatedAt)
          ? { ownerAgeMs: Math.max(0, Date.now() - ownerCreatedAt) }
          : {}),
      });
      activeStage = 'owner_policy_validate';
      if (ownerState.ownerStatus === 'unreadable') {
        throw new Error('Coder owner state is unreadable; refusing startup policy recovery.');
      }
      if (ownerState.policy.mode !== 'inline') {
        this.startupOwnerPolicyFailure = undefined;
        timing.mark('reconcile', 'complete', { policyChanged: false });
        return;
      }
      if (ownerState.ownerStatus !== 'unowned') {
        throw new Error(
          'Coder is configured for daemon mode, but an inline owner is still active; ' +
            'refusing to start a competing owner.',
        );
      }
      activeStage = 'daemon_policy_enable';
      const policy = await this.ownerControl.enableDaemon({
        ...this.runtimeOwnerTarget(),
      });
      timing.mark(activeStage, 'complete', {
        policyMode: policy.mode,
        policyRevision: policy.revision,
      });
      this.startupOwnerPolicyFailure = undefined;
      timing.mark('reconcile', 'complete', { policyChanged: true });
    } catch (error: unknown) {
      timing.mark(activeStage, 'failed', runtimeStartupFailureData(error));
      const diagnostic = sanitizeDiagnosticError(error);
      this.startupOwnerPolicyFailure = diagnostic;
      this.lastError = diagnostic;
      this.state = 'failed';
      this.publishUnavailable('incompatible', diagnostic);
      throw error;
    }
  }

  isRuntimeSelected(): boolean {
    return this.mode === 'runtime';
  }

  hasReadyRuntime(): boolean {
    return this.mode === 'runtime' && this.state === 'ready' && this.runtime !== null;
  }

  subscribeRuntimeReady(observer: (revision: number) => void): () => void {
    this.runtimeReadyObservers.add(observer);
    const observedRevision = this.runtimeReadyRevision;
    if (observedRevision > 0 && this.hasReadyRuntime()) {
      queueMicrotask(() => {
        if (!this.runtimeReadyObservers.has(observer) || !this.hasReadyRuntime()) return;
        try {
          observer(observedRevision);
        } catch {
          // Readiness observers are best-effort host integrations. Runtime
          // authority must not be invalidated by a listener failure.
        }
      });
    }
    return () => {
      this.runtimeReadyObservers.delete(observer);
    };
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
    const requestedClientVersion = clientVersion?.trim();
    if (requestedClientVersion) this.clientVersion = requestedClientVersion;
    if (this.rollbackInProgress) {
      return Promise.reject(
        new Error('Coder owner transition is in progress; Runtime initialization is blocked.'),
      );
    }
    if (this.startupOwnerPolicyFailure !== undefined) {
      return Promise.reject(
        new Error(
          `Coder owner policy reconciliation failed; Runtime initialization remains blocked: ${this.startupOwnerPolicyFailure}`,
        ),
      );
    }
    if (this.mode === 'legacy') {
      return this.initializeLegacyOwner();
    }
    if (this.state === 'ready') return Promise.resolve();
    if (this.state === 'closed') return Promise.reject(new Error('Runtime host is closed'));
    if (this.initializePromise !== null) return this.initializePromise;
    this.state = 'initializing';
    const version = this.clientVersion;
    let pendingRuntime: KodaXDaemonRuntime | null = null;
    let attachedHostToolLeaseId: string | undefined;
    const timing = this.startupTimingFactory('runtime-host-initialize');
    let activeStage = 'identity_open';
    timing.mark('initialize', 'start', { selectedHost: this.mode });
    this.initializePromise = this.identityStore
      .openInstance({ name: 'kodax-space', title: 'KodaX Space', version })
      .then(async (identity) => {
        timing.mark(activeStage, 'complete');
        // The daemon authenticates valid instanceId values as principalId and
        // copies that principal onto every Run origin.
        this.runtimePrincipalId = identity.instanceId;
        activeStage = 'runtime_factory_connect';
        const runtime = await this.runtimeFactory({
          profile: 'coder',
          autoStart: true,
          daemonOrphanExitMs: 30_000,
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
            contextDiagnostics: true,
            operationDeduplication: true,
          },
          requirements: {
            externalAgents: true,
            externalAgentAdmin: 1,
            actorControlPlane: 1,
            learningCenter: 1,
            skillLearningLoop: 1,
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
            conversationHistory: 1,
            transcriptPaging: 1,
            transcriptSearch: 1,
            connectionLifecycle: 1,
            typedRuntimeEvents: 1,
            daemonSafeRunInput: 1,
            sharedSessionSettings: 1,
            durableRecoveryQueries: 1,
            daemonManagement: 1,
            daemonOrphanExit: 1,
            managedRunDurability: 1,
            runtimeEventCoalescing: 1,
            integrationConfigResilience: 1,
            runtimeAutoModeGuardrail: 4,
          },
        });
        timing.mark(activeStage, 'complete', runtimeIdentityTimingData(runtime.identity));
        pendingRuntime = runtime;
        return runtime;
      })
      .then(async (runtime) => {
        // App shutdown can race the startup warm-up. Do not publish a ready
        // Runtime after close(), and make the just-created instance release itself.
        if ((this.state as RuntimeHostState) === 'closed') {
          await runtime.close();
          pendingRuntime = null;
          timing.mark('initialize', 'skipped', { reason: 'host-closed' });
          return;
        }
        activeStage = 'capability_validation';
        assertSpaceDaemonRequiredCapabilities(runtime);
        this.assertRequiredScopes(runtime);
        timing.mark(activeStage, 'complete');
        activeStage = 'host_tools_module_import';
        const { registerSpaceHostTools } = await import('./runtime/space-host-tools.js');
        timing.mark(activeStage, 'complete');
        activeStage = 'host_tools_register';
        let hostToolLease;
        if (this.hostToolLeaseId) {
          hostToolLease = await registerSpaceHostTools(runtime, this.hostToolLeaseId).catch(() =>
            registerSpaceHostTools(runtime),
          );
        } else {
          hostToolLease = await registerSpaceHostTools(runtime);
        }
        timing.mark(activeStage, 'complete', {
          resumedLease: this.hostToolLeaseId !== undefined,
        });
        attachedHostToolLeaseId = hostToolLease.id;
        if (this.state === 'closed') {
          await runtime.hostTools.revoke(hostToolLease.id).catch(() => false);
          await runtime.close();
          pendingRuntime = null;
          timing.mark('initialize', 'skipped', { reason: 'host-closed' });
          return;
        }
        this.hostToolLeaseId = hostToolLease.id;
        this.hostToolLeaseIds.add(hostToolLease.id);
        this.runtime = runtime;
        activeStage = 'connection_validate';
        if (!runtime.connection) {
          throw new Error('Coder daemon did not expose the required connection lifecycle.');
        }
        const connection = runtime.connection.current();
        if (connection.state !== 'connected') {
          throw new Error(connection.reason ?? 'Coder daemon disconnected during initialization.');
        }
        timing.mark(activeStage, 'complete', { connectionState: connection.state });
        this.connectionSubscription?.close();
        activeStage = 'connection_subscription_ready';
        this.connectionSubscription = runtime.connection.subscribe((next) => {
          if (next.state !== 'disconnected') return;
          void this.handleConnectionLoss(
            runtime,
            new Error(next.reason ?? 'Coder daemon transport disconnected.'),
            next.reconnectable,
          );
        });
        await this.connectionSubscription.ready;
        timing.mark(activeStage, 'complete');
        this.workflowSubscription?.close();
        activeStage = 'workflow_subscription_ready';
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
        timing.mark(activeStage, 'complete');
        this.state = 'ready';
        this.lastError = undefined;
        if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
        this.reconnectTimer = undefined;
        this.reconnectAttempt = 0;
        activeStage = 'credential_leases_resume';
        const credentialLeaseCount = this.credentialLeases.size;
        await this.resumeKnownCredentialLeases(runtime);
        timing.mark(activeStage, 'complete', {
          requestedCount: credentialLeaseCount,
          activeCount: this.credentialLeases.size,
        });
        activeStage = 'profile_refresh';
        await this.refreshProfile(0);
        timing.mark(activeStage, 'complete');
        this.startIntegrationHealthPolling(runtime);
        activeStage = 'desired_observations_restore';
        const desiredObservationCount = this.desiredObservations.size;
        let restoredObservationCount = 0;
        let missingObservationCount = 0;
        let failedObservationCount = 0;
        for (const sessionId of this.desiredObservations) {
          if (this.observations.has(sessionId) || this.observationPromises.has(sessionId)) continue;
          try {
            // Restore against the Runtime owned by this initialization attempt.
            // Calling requireRuntime() from here can join initializePromise itself
            // after a concurrent disconnect and form an unresolvable Promise cycle.
            await this.openObservation(sessionId, { attachedRuntime: runtime });
            // A terminal event can race the old transport loss. The restored snapshot is the
            // authority for whether this observation is still needed; do not make a stale desired
            // bit permanent merely because the terminal event was missed while disconnected.
            await this.retireObservationWhenSettled(sessionId);
            restoredObservationCount += 1;
          } catch (error: unknown) {
            if (isSessionNotFound(error)) {
              this.desiredObservations.delete(sessionId);
              missingObservationCount += 1;
              continue;
            }
            failedObservationCount += 1;
            console.warn(
              `[runtime] could not restore observation for ${sessionId}: ${sanitizeDiagnosticError(error)}`,
            );
          }
        }
        timing.mark(activeStage, 'complete', {
          requestedCount: desiredObservationCount,
          restoredCount: restoredObservationCount,
          missingCount: missingObservationCount,
          failedCount: failedObservationCount,
        });
        // Connection lifecycle callbacks can run while the post-attach warm-up
        // awaits credentials, profile reads, or desired observations. Never
        // publish readiness for an attachment that lost authority in that gap.
        if (this.runtime !== runtime || this.state !== 'ready') {
          pendingRuntime = null;
          throw new RuntimeInitializationAuthorityLostError();
        }
        pendingRuntime = null;
        timing.mark('initialize', 'complete', runtimeIdentityTimingData(runtime.identity));
        this.initializePromise = null;
        this.runtimeReadyRevision += 1;
        const readyRevision = this.runtimeReadyRevision;
        for (const observer of [...this.runtimeReadyObservers]) {
          try {
            observer(readyRevision);
          } catch {
            // A host integration cannot revoke an otherwise authoritative
            // Runtime attachment by throwing from its observer.
          }
        }
      })
      .catch(async (error: unknown) => {
        timing.mark(activeStage, 'failed', runtimeStartupFailureData(error));
        if (error instanceof RuntimeInitializationAuthorityLostError) {
          pendingRuntime = null;
          this.initializePromise = null;
          throw error;
        }
        const runtime = pendingRuntime;
        pendingRuntime = null;
        if (runtime) {
          this.stopIntegrationHealthPolling();
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
      .acquireInline({
        ...this.runtimeOwnerTarget(),
        enableRollback: true,
      })
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
    const initializationInProgress = this.initializePromise !== null;
    this.stopIntegrationHealthPolling();
    this.connectionSubscription?.close();
    this.connectionSubscription = undefined;
    this.workflowSubscription?.close();
    this.workflowSubscription = undefined;
    this.lastError = sanitizeDiagnosticError(error);
    this.publishUnavailable('reconnecting', this.lastError);
    for (const state of this.observations.values()) state.observation.close();
    this.observations.clear();
    this.observationPromises.clear();
    this.transcriptPromises.clear();
    this.conversationPromises.clear();
    this.transcriptGenerations.clear();
    this.runtimeProfileSnapshotPromise = null;
    this.runtimeCoderSessionIds.clear();
    this.stopAllActorObservations();
    // Lease attachment is connection-scoped even though the stable lease IDs
    // survive in the daemon. Rebuild this set only from successful resume calls
    // on the replacement connection.
    this.hostToolLeaseIds.clear();
    this.runtime = null;
    this.activeRuns.clear();
    // Compaction demand is derived from one connection's ordered event stream.
    // A disconnect can lose the matching `ended` event; retaining that bit would
    // prevent a fresh terminal snapshot from ever retiring the observation.
    // In-flight local compaction calls fail/reconcile through their own promise,
    // while a replacement observation rebuilds demand from its authoritative
    // snapshot and newly delivered events.
    this.activeCompactionsBySession.clear();
    this.localCompactionCallsBySession.clear();
    // User ordinals are inferred only within one observed daemon connection.
    // A reconnect may miss delivery events from the disconnected interval, so
    // retaining these counters would turn an unprovable ordinal into a false
    // strong identity and could fold two distinct user boundaries together.
    this.nextUserOrdinalByTurnId.clear();
    // Keep an in-flight initialization promise as the single-flight fence until
    // its final authority check rejects. A fully initialized attachment clears
    // this promise before publishing readiness, so ordinary reconnects remain
    // free to start a new attempt immediately.
    if (!initializationInProgress) this.initializePromise = null;
    this.state = reconnectable ? 'uninitialized' : 'failed';
    await attached.close().catch(() => undefined);
    if (this.rollbackInProgress) {
      this.state = 'closed';
      return;
    }
    if (reconnectable) this.scheduleReconnect();
    else {
      this.publishUnavailable('disconnected', this.lastError);
    }
  }

  private scheduleReconnect(retryOnlyTransientHealthFailure = false): void {
    if (this.state === 'closed' || this.rollbackInProgress || this.reconnectTimer) return;
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
    if (this.rollbackInProgress) {
      throw new Error('Coder owner transition is in progress; Runtime operations are blocked.');
    }
    await this.initialize();
    if (this.rollbackInProgress) {
      throw new Error('Coder owner transition is in progress; Runtime operations are blocked.');
    }
    if (this.runtime === null) throw new Error('Runtime host failed to initialize');
    return this.runtime;
  }

  private assertRequiredScopes(runtime: KodaXDaemonRuntime): void {
    const required = [
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
        id: 'runtime.daemon.orphanExit',
        version: version('daemonOrphanExit'),
        available: available('daemonOrphanExit'),
      },
      {
        id: 'runtime.managedRuns.durability',
        version: version('managedRunDurability'),
        available: available('managedRunDurability'),
      },
      {
        id: 'runtime.events.coalescing',
        version: version('runtimeEventCoalescing'),
        available: available('runtimeEventCoalescing'),
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
        id: 'runtime.learning.skillLoop',
        version: version('skillLearningLoop'),
        available: available('skillLearningLoop'),
      },
      {
        id: 'runtime.integrations.resilience',
        version: version('integrationConfigResilience'),
        available: available('integrationConfigResilience'),
      },
      {
        id: 'runtime.autoMode.guardrail',
        version: version('runtimeAutoModeGuardrail'),
        available: version('runtimeAutoModeGuardrail') >= 4,
      },
      {
        id: 'runtime.tools.sandboxObservation',
        version: 1,
        available:
          version('sandboxRuntime') >= 1 &&
          version('runtimeAutoModeGuardrail') >= 4 &&
          available('typedRuntimeEvents'),
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
        id: 'runtime.conversation.history',
        version: version('conversationHistory'),
        available: available('conversationHistory'),
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

  private refreshProfile(cursor: number): Promise<void> {
    const runtime = this.runtime;
    if (!runtime || this.state !== 'ready') return Promise.resolve();
    const causalCursor = this.advanceProfileCursor(runtime, cursor);
    const previous = this.profileRefreshQueues.get(runtime) ?? Promise.resolve();
    const refresh = previous.then(() => this.refreshProfileSnapshot(runtime, causalCursor));
    // Keep each Runtime attachment serial without poisoning its queue after one failed read. A
    // replaced Runtime has a different queue and must not wait behind a retired transport.
    this.profileRefreshQueues.set(
      runtime,
      refresh.catch(() => undefined),
    );
    return refresh;
  }

  private currentProfileCursor(): number {
    const runtime = this.runtime;
    return runtime ? (this.profileCursors.get(runtime.identity.runtimeId) ?? 0) : 0;
  }

  private advanceProfileCursor(runtime: KodaXDaemonRuntime, cursor: number): number {
    const runtimeId = runtime.identity.runtimeId;
    const next = Math.max(this.profileCursors.get(runtimeId) ?? 0, cursor);
    this.profileCursors.set(runtimeId, next);
    return next;
  }

  private async refreshProfileSnapshot(runtime: KodaXDaemonRuntime, cursor: number): Promise<void> {
    if (this.runtime !== runtime || this.state !== 'ready') return;
    // `status.snapshot()` does not return an atomic Runtime cursor. The requested cursor is the
    // causal lower bound captured before this read; never borrow a later Runtime cursor that may be
    // advanced by an observation while the asynchronous snapshot is in flight.
    const previousConnection = this.projectionController.profileSnapshot().connection;
    const managementRead = runtime.daemon.inspect().catch((error: unknown) => {
      if (!isRuntimeSnapshotConflict(error)) throw error;
      if (!this.profileManagementConflictWarningShown) {
        console.warn(
          '[runtime] daemon management changed during profile refresh; retaining the last known integration health:',
          sanitizeDiagnosticError(error),
        );
        this.profileManagementConflictWarningShown = true;
      }
      return undefined;
    });
    const [status, userInputs, management] = await Promise.all([
      runtime.status.snapshot(),
      runtime.userInputs.listPending(),
      managementRead,
    ]);
    // A reconnect can retain the same public runtimeId while replacing the attached Runtime
    // object. Never let a slow snapshot from the retired attachment overwrite the new profile.
    if (this.runtime !== runtime || this.state !== 'ready') return;
    if (status.runtimeId !== runtime.identity.runtimeId) {
      throw new Error(
        'Coder daemon status runtimeId does not match the attached Runtime identity.',
      );
    }
    if (management !== undefined && management.runtimeId !== runtime.identity.runtimeId) {
      throw new Error(
        'Coder daemon management runtimeId does not match the attached Runtime identity.',
      );
    }
    this.runtimeCoderSessionIds = new Set(
      status.sessions
        .filter((session) => !isPartnerRuntimeSessionIdentity(session))
        .map((session) => session.id),
    );
    if (management !== undefined) {
      this.profileManagementConflictWarningShown = false;
      this.integrationHealthFingerprint = this.fingerprintIntegrationHealth(
        management.integrations,
      );
    }
    const projected = projectRuntimeProfile({
      status,
      userInputs,
      cursor,
      projectionRevision: ++this.profileRevision,
      changedAt: Date.now(),
      capabilities: [...this.spaceCapabilities(runtime)],
      ...(management?.integrations ? { integrations: management.integrations } : {}),
    });
    // Daemon management is auxiliary to the Session/Run profile. A consistency conflict in that
    // read must not discard the independently successful status snapshot or erase previously
    // known integration health.
    const projectedProfile =
      management === undefined && previousConnection.integrations !== undefined
        ? {
            ...projected,
            connection: {
              ...projected.connection,
              integrations: previousConnection.integrations,
            },
          }
        : projected;
    const connectionChanged = !runtimeConnectionSemanticallyEqual(
      previousConnection,
      projectedProfile.connection,
    );
    const profile = connectionChanged
      ? projectedProfile
      : { ...projectedProfile, connection: previousConnection };
    if (!this.projectionController.replaceProfile(profile)) return;
    if (connectionChanged) {
      this.push('runtime.connectionChanged', profile.connection);
    }
    this.push('runtime.profileChanged', profile);
  }

  private async refreshProfileAfterConflict(cursor: number): Promise<void> {
    for (let attempt = 0; ; attempt += 1) {
      try {
        await this.refreshProfile(cursor);
        return;
      } catch (error: unknown) {
        if (
          !isRuntimeSnapshotConflict(error) ||
          attempt >= MAX_PROFILE_REFRESH_CONFLICT_RETRIES ||
          this.state !== 'ready' ||
          this.runtime === null
        ) {
          throw error;
        }
        await waitForProfileRefreshRetry(attempt + 1);
      }
    }
  }

  private scheduleProfileRefresh(cursor: number): void {
    void this.refreshProfileAfterConflict(cursor)
      .then(() => {
        this.profileRefreshFailureWarningShown = false;
      })
      .catch((error: unknown) => {
        this.lastError = sanitizeDiagnosticError(error);
        // This is a background read, not a connection-lifecycle signal. The SDK connection
        // subscription is the sole authority for reconnecting/disconnected transitions. Keep the
        // last valid profile and live observation so a terminal event can still converge the UI.
        if (!this.profileRefreshFailureWarningShown) {
          console.warn(
            '[runtime] profile refresh failed; retaining the last known Runtime projection:',
            this.lastError,
          );
          this.profileRefreshFailureWarningShown = true;
        }
      });
  }

  private fingerprintIntegrationHealth(
    health: RuntimeDaemonManagementState['integrations'],
  ): string {
    return JSON.stringify(health ?? null);
  }

  private startIntegrationHealthPolling(runtime: KodaXDaemonRuntime): void {
    this.stopIntegrationHealthPolling();
    if (this.integrationHealthPollMs <= 0) return;
    const scheduleNext = (): void => {
      if (this.state !== 'ready' || this.runtime !== runtime || this.rollbackInProgress) return;
      this.integrationHealthPollTimer = setTimeout(() => {
        this.integrationHealthPollTimer = undefined;
        void this.pollIntegrationHealth(runtime).finally(scheduleNext);
      }, this.integrationHealthPollMs);
      this.integrationHealthPollTimer.unref?.();
    };
    scheduleNext();
  }

  private stopIntegrationHealthPolling(): void {
    if (this.integrationHealthPollTimer) clearTimeout(this.integrationHealthPollTimer);
    this.integrationHealthPollTimer = undefined;
    this.integrationHealthRefreshPending = false;
  }

  private async pollIntegrationHealth(runtime: KodaXDaemonRuntime): Promise<void> {
    if (
      this.integrationHealthPollInFlight ||
      this.integrationHealthRefreshPending ||
      this.state !== 'ready' ||
      this.runtime !== runtime ||
      this.rollbackInProgress
    ) {
      return;
    }
    this.integrationHealthPollInFlight = true;
    try {
      const management = await runtime.daemon.inspect();
      if (this.state !== 'ready' || this.runtime !== runtime || this.rollbackInProgress) return;
      if (management.runtimeId !== runtime.identity.runtimeId) {
        throw new Error(
          'Coder daemon management runtimeId does not match the attached Runtime identity.',
        );
      }
      if (
        this.fingerprintIntegrationHealth(management.integrations) ===
        this.integrationHealthFingerprint
      ) {
        this.integrationHealthPollWarningShown = false;
        return;
      }
      this.integrationHealthRefreshPending = true;
      void this.refreshProfile(this.currentProfileCursor())
        .then(() => {
          this.integrationHealthPollWarningShown = false;
        })
        .catch((error: unknown) => {
          if (!this.integrationHealthPollWarningShown) {
            console.warn(
              '[runtime] integration health refresh failed; retaining the last known state:',
              sanitizeDiagnosticError(error),
            );
            this.integrationHealthPollWarningShown = true;
          }
        })
        .finally(() => {
          this.integrationHealthRefreshPending = false;
        });
    } catch (error: unknown) {
      if (!this.integrationHealthPollWarningShown) {
        console.warn(
          '[runtime] integration health poll failed; retaining the last known state:',
          sanitizeDiagnosticError(error),
        );
        this.integrationHealthPollWarningShown = true;
      }
    } finally {
      this.integrationHealthPollInFlight = false;
    }
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

  private async assertPersistedCoderOwnership(sessionId: string): Promise<void> {
    await preparePersistedSessionFreshnessTracking();
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const before = persistedSessionFreshnessToken(sessionId);
      const persisted = await loadPersistedSessionFresh(sessionId);
      const after = persistedSessionFreshnessToken(sessionId);
      if (before !== after && attempt === 0) continue;
      if (isPartnerRuntimeSessionIdentity(persisted)) {
        this.persistedOwnershipTokens.delete(sessionId);
        this.desiredObservations.delete(sessionId);
        this.activeCompactionsBySession.delete(sessionId);
        this.localCompactionCallsBySession.delete(sessionId);
        this.stopActorObservation(sessionId);
        const observed = this.observations.get(sessionId);
        if (observed) {
          observed.observation.close();
          this.observations.delete(sessionId);
        }
        this.invalidateTranscriptBoundary(sessionId);
        this.projectionController.removeSessionLive(sessionId);
        throw new RuntimeSessionIdentityConflictError(
          sessionId,
          'the persisted Session is owned by the inline Partner surface.',
        );
      }
      // A second concurrent mutation must not make one read spin forever. Retain the older token
      // so the next independent request verifies ownership again instead of certifying an
      // identity read that raced the writer.
      this.persistedOwnershipTokens.set(sessionId, before === after ? after : before);
      return;
    }
  }

  private async assertPersistedCoderOwnershipIfChanged(sessionId: string): Promise<void> {
    await preparePersistedSessionFreshnessTracking();
    const before = persistedSessionFreshnessToken(sessionId);
    if (this.persistedOwnershipTokens.get(sessionId) === before) return;
    // Active Runs normally mutate the same JSONL file. One fresh Runtime status read proves
    // ownership without waiting for that file to become quiescent. The projected profile is
    // intentionally bounded, so membership is checked against the full status set captured by
    // refreshProfileSnapshot instead of profile.sessions.
    await this.readRuntimeProfileSnapshot();
    const after = persistedSessionFreshnessToken(sessionId);
    if (this.runtimeCoderSessionIds.has(sessionId)) {
      // If the file changed during the status read, retain the older token so the next independent
      // reconciliation rechecks identity. Never spin inside one request while a Run is streaming.
      this.persistedOwnershipTokens.set(sessionId, before === after ? after : before);
      return;
    }
    await this.assertPersistedCoderOwnership(sessionId);
  }

  private async assertCoderSession(
    runtime: KodaXDaemonRuntime,
    sessionId: string,
    options?: RuntimeReadOptions,
    expectedProjectRoot?: string,
    persistedOwnershipVerified = false,
  ): Promise<RuntimeSession> {
    for (let attempt = 1; ; attempt += 1) {
      try {
        if (!persistedOwnershipVerified) await this.assertPersistedCoderOwnership(sessionId);
        const session = await runtime.sessions.load(sessionId, options);
        assertRuntimeSessionIdentity(session, {
          sessionId,
          ...(expectedProjectRoot !== undefined ? { projectRoot: expectedProjectRoot } : {}),
        });
        return session;
      } catch (error: unknown) {
        if (
          attempt >= MAX_SESSION_IDENTITY_READ_ATTEMPTS ||
          !isSessionIdentityReadConflict(error)
        ) {
          throw error;
        }
        if (options?.signal?.aborted) throw error;
        await new Promise<void>((resolve) => {
          setTimeout(resolve, SESSION_IDENTITY_RETRY_BASE_MS * attempt);
        });
      }
    }
  }

  /**
   * Runtime initialization installs one current, identity-fenced profile before the host becomes
   * ready. Reuse that exact Session identity for control admission instead of rereading the full
   * persisted Session while its actor/history writer is active. An absent profile row is
   * inconclusive because the bounded profile may omit older Sessions, so callers still fall back
   * to the strict load/create path.
   */
  private hasVerifiedProfileSession(
    runtime: KodaXDaemonRuntime,
    input: RuntimeSessionIdentity,
  ): boolean {
    const profile = this.projectionController.profileSnapshot();
    if (
      profile.connection.state !== 'ready' ||
      profile.connection.stale ||
      profile.connection.runtimeId !== runtime.identity.runtimeId ||
      profile.cursor?.runtimeId !== runtime.identity.runtimeId
    ) {
      return false;
    }
    const session = profile.sessions.find((candidate) => candidate.sessionId === input.sessionId);
    if (session === undefined) return false;
    if (session.surface !== 'code') {
      throw new RuntimeSessionIdentityConflictError(
        input.sessionId,
        'the Runtime profile is not owned by the Coder surface.',
      );
    }
    // Older/bounded profile rows may omit project identity. That is not proof of a mismatch; keep
    // the strict fallback so a legacy Session without durable project identity still fails closed.
    if (session.projectRoot === undefined) return false;
    if (
      canonicalRuntimeProjectRoot(session.projectRoot) !==
      canonicalRuntimeProjectRoot(input.projectRoot)
    ) {
      throw new RuntimeSessionIdentityConflictError(
        input.sessionId,
        `profile projectRoot ${session.projectRoot} does not match projectRoot ${input.projectRoot}.`,
      );
    }
    return true;
  }

  async ensureSession(input: RuntimeSessionIdentity): Promise<boolean> {
    if (input.surface !== 'code') {
      throw new Error(
        `Partner session ${input.sessionId} must remain on the inline Partner owner.`,
      );
    }
    const identityKey = `${canonicalRuntimeProjectRoot(input.projectRoot)}\0${input.surface}\0${input.ephemeral ? '1' : '0'}`;
    const existing = this.ensureSessionPromises.get(input.sessionId);
    if (existing !== undefined) {
      if (existing.identityKey !== identityKey) {
        throw new RuntimeSessionIdentityConflictError(
          input.sessionId,
          'concurrent admission requested a different Session identity.',
        );
      }
      return existing.promise;
    }
    const pending = this.ensureSessionUnlocked(input).finally(() => {
      if (this.ensureSessionPromises.get(input.sessionId)?.promise === pending) {
        this.ensureSessionPromises.delete(input.sessionId);
      }
    });
    this.ensureSessionPromises.set(input.sessionId, { identityKey, promise: pending });
    return pending;
  }

  private async ensureSessionUnlocked(input: RuntimeSessionIdentity): Promise<boolean> {
    const runtime = await this.requireRuntime();
    await this.assertPersistedCoderOwnership(input.sessionId);
    if (this.hasVerifiedProfileSession(runtime, input)) return false;
    try {
      await this.assertCoderSession(runtime, input.sessionId, undefined, input.projectRoot, true);
      return false;
    } catch (error: unknown) {
      if (!isSessionNotFound(error)) throw error;
    }
    try {
      const created = await runtime.sessions.create({
        sessionId: input.sessionId,
        projectPath: input.projectRoot,
        gitRoot: input.projectRoot,
        surface: 'space-desktop',
        tag: input.ephemeral ? SPACE_EPHEMERAL_SESSION_TAG : 'code',
      });
      assertRuntimeSessionIdentity(created, {
        sessionId: input.sessionId,
        projectRoot: input.projectRoot,
      });
    } catch (createError: unknown) {
      try {
        await this.assertCoderSession(runtime, input.sessionId, undefined, input.projectRoot, true);
        return false;
      } catch (reloadError: unknown) {
        if (!isSessionNotFound(reloadError)) throw reloadError;
        throw createError;
      }
    }
    this.scheduleProfileRefresh(this.currentProfileCursor());
    return true;
  }

  async listSessions(filter?: RuntimeSessionFilter): Promise<readonly RuntimeSessionSummary[]> {
    if (filter?.surface === 'partner') {
      throw new Error('Partner sessions are not listed through the Coder daemon.');
    }
    const { surface: _spaceSurface, ...runtimeFilter } = filter ?? {};
    const sessions = await (await this.requireRuntime()).sessions.list(runtimeFilter);
    return sessions.filter((session) => !isPartnerRuntimeSessionIdentity(session));
  }

  async transcript(sessionId: string): Promise<RuntimeTranscript | null> {
    const existing = this.transcriptPromises.get(sessionId);
    if (existing) return existing.promise;
    const token = Symbol(sessionId);
    const pending = this.readTranscript(sessionId, token).finally(() => {
      if (this.transcriptPromises.get(sessionId)?.token === token) {
        this.transcriptPromises.delete(sessionId);
      }
    });
    this.transcriptPromises.set(sessionId, { token, promise: pending });
    return pending;
  }

  async conversationHistory(sessionId: string): Promise<RuntimeConversationHistory | null> {
    const existing = this.conversationPromises.get(sessionId);
    if (existing) return existing.promise;
    const token = Symbol(sessionId);
    const pending = this.readConversationHistory(sessionId, token).finally(() => {
      if (this.conversationPromises.get(sessionId)?.token === token) {
        this.conversationPromises.delete(sessionId);
      }
    });
    this.conversationPromises.set(sessionId, { token, promise: pending });
    return pending;
  }

  async conversationHistoryPage(input: {
    readonly sessionId: string;
    readonly cursor?: string;
    readonly revision?: string;
    readonly sourceRevision?: string;
    readonly limit?: number;
  }): Promise<RuntimeConversationHistoryPageResult> {
    const runtime = await this.requireRuntime();
    await this.assertPersistedCoderOwnershipIfChanged(input.sessionId);
    const generation = this.transcriptGenerations.get(input.sessionId) ?? 0;
    // Ownership reconciliation uses Runtime status in the normal case and does not materialize the
    // Session body, preserving the bounded first-page guarantee. Runtime then resolves the exact
    // sessionId while the generation fence rejects an ownership or transcript change in flight.
    let page: RuntimeConversationHistoryPage | null;
    try {
      page = await readRuntimeConversationHistoryPage(runtime, {
        sessionId: input.sessionId,
        ...(input.cursor !== undefined ? { cursor: input.cursor } : {}),
        ...(input.limit !== undefined ? { limit: input.limit } : {}),
      });
    } catch (error) {
      if (isRuntimeResyncRequired(error)) return { outcome: 'data_changed' };
      throw error;
    }
    if (
      this.runtime !== runtime ||
      this.state !== 'ready' ||
      (this.transcriptGenerations.get(input.sessionId) ?? 0) !== generation
    ) {
      return { outcome: 'data_changed' };
    }
    if (
      page !== null &&
      ((input.revision !== undefined && page.revision !== input.revision) ||
        (input.sourceRevision !== undefined && page.sourceRevision !== input.sourceRevision))
    ) {
      return { outcome: 'data_changed' };
    }
    return { outcome: 'ready', page };
  }

  private async readConversationHistory(
    sessionId: string,
    requestToken: symbol,
  ): Promise<RuntimeConversationHistory | null> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const generation = this.transcriptGenerations.get(sessionId) ?? 0;
      const runtime = await this.requireRuntime();
      await this.assertCoderSession(runtime, sessionId, { timeoutMs: RUNTIME_READ_TIMEOUT_MS });
      const conversation = await readPagedRuntimeConversationHistory(runtime, sessionId);
      if (this.runtime !== runtime || this.state !== 'ready') {
        throw new Error('Coder daemon connection changed while reading conversation history.');
      }
      if ((this.transcriptGenerations.get(sessionId) ?? 0) === generation) return conversation;
      const replacement = this.conversationPromises.get(sessionId);
      if (replacement && replacement.token !== requestToken) return replacement.promise;
    }
    throw new Error('Conversation history could not establish a stable Runtime boundary.');
  }

  async conversationTurnEndBoundary(
    sessionId: string,
    turnIndex: number,
  ): Promise<RuntimeConversationHistoryBoundary | null> {
    if (!Number.isInteger(turnIndex) || turnIndex < 0) return null;
    const history = await this.conversationHistory(sessionId);
    if (!history) return null;
    // `ambiguous` means the SDK retained more than one legacy interpretation; it does not make a
    // returned physical boundary speculative. Bind the exact candidate the user selected and
    // fence the mutation by sourceRevision. Never substitute another entry or infer by content.
    const boundaryId = conversationTurnEndBoundaryId(history.entries, turnIndex);
    return boundaryId ? { entryId: boundaryId, sourceRevision: history.sourceRevision } : null;
  }

  private invalidateTranscriptBoundary(sessionId: string): void {
    this.transcriptGenerations.set(sessionId, (this.transcriptGenerations.get(sessionId) ?? 0) + 1);
    this.transcriptPromises.delete(sessionId);
    this.conversationPromises.delete(sessionId);
  }

  private async readTranscript(
    sessionId: string,
    requestToken: symbol,
  ): Promise<RuntimeTranscript | null> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const generation = this.transcriptGenerations.get(sessionId) ?? 0;
      const runtime = await this.requireRuntime();
      const observed = this.observations.get(sessionId);
      const observationSnapshot =
        observed?.runtime === runtime && observed.transcriptSnapshotFresh
          ? observed.observation.snapshot
          : undefined;
      let transcript: RuntimeTranscript | null;
      if (observationSnapshot) {
        await this.assertPersistedCoderOwnership(sessionId);
        transcript = await readPagedRuntimeTranscript(runtime, sessionId, observationSnapshot);
      } else {
        const loadedSession = await this.assertCoderSession(runtime, sessionId, {
          timeoutMs: RUNTIME_READ_TIMEOUT_MS,
        });
        transcript = await readPagedRuntimeTranscript(runtime, sessionId, undefined, loadedSession);
      }
      if (this.runtime !== runtime || this.state !== 'ready') {
        throw new Error('Coder daemon connection changed while reading Session history.');
      }
      if ((this.transcriptGenerations.get(sessionId) ?? 0) === generation) return transcript;

      // A Runtime event crossed the immutable paging boundary. A caller that arrived after the
      // event owns the newer in-flight read; share it instead of launching a third materialization.
      const replacement = this.transcriptPromises.get(sessionId);
      if (replacement && replacement.token !== requestToken) return replacement.promise;
      // Retry once from the current Runtime revision. If another live event crosses that second
      // boundary, its renderer event remains the authoritative tail after this consistent page.
    }
    throw new Error('Session history could not establish a stable Runtime boundary.');
  }

  /**
   * Capture the SDK's read-only, boundary-labelled support record. Deliberately
   * do not call sessions.load() first: diagnostics must not emit a durable
   * session.loaded event or take part in recovery/ownership mutation.
   */
  async diagnoseSession(input: RuntimeSessionDiagnosticsInput): Promise<RuntimeSessionDiagnostics> {
    const runtime = await this.requireRuntime();
    await this.assertPersistedCoderOwnership(input.sessionId);
    const diagnostic = await runtime.sessions.diagnostics(input);
    if (
      this.runtime !== runtime ||
      diagnostic.runtimeId !== runtime.identity.runtimeId ||
      diagnostic.sessionId !== input.sessionId
    ) {
      throw new Error('Coder daemon Session diagnostics crossed a Runtime or Session boundary.');
    }
    return diagnostic;
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
    const commandObservation = this.observations.get(input.sessionId);
    this.localCompactionCallsBySession.set(
      input.sessionId,
      (this.localCompactionCallsBySession.get(input.sessionId) ?? 0) + 1,
    );
    let completedCompaction = false;
    try {
      const result = await runtime.sessions.compact(input);
      completedCompaction = result.compacted;
      if (result.compacted) invalidatePersistedSessionCache(input.sessionId);
      return result;
    } finally {
      const remaining = (this.localCompactionCallsBySession.get(input.sessionId) ?? 1) - 1;
      if (remaining > 0) this.localCompactionCallsBySession.set(input.sessionId, remaining);
      else this.localCompactionCallsBySession.delete(input.sessionId);
      // A successful compaction on the same observation remains subscribed for its canonical
      // ended/skipped event, which may be delivered just after compact() resolves. A no-op, failed
      // call, or an operation whose observation was invalidated can retire from the current fresh
      // snapshot once its already-buffered events settle.
      if (!completedCompaction || this.observations.get(input.sessionId) !== commandObservation) {
        await this.retireObservationWhenSettled(input.sessionId);
      }
    }
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
    if (result !== null) {
      invalidatePersistedSessionCache(input.sessionId);
      // Mutation success is the authoritative invalidation boundary. A caller arriving
      // immediately after rewind must never join an in-flight pre-rewind history traversal.
      this.invalidateTranscriptBoundary(input.sessionId);
      // Rewind can replace Actor state without producing a new Actor event.
      // Drop the cached cursor so renderer reload/rewind cannot resurrect the
      // pre-rewind child tree.
      this.stopActorObservation(input.sessionId);
      if (
        this.runtime === runtime &&
        this.state === 'ready' &&
        this.desiredObservations.has(input.sessionId)
      ) {
        // Actor telemetry is best-effort here: a daemon without the agents
        // plane must not fail the completed rewind.
        try {
          await this.ensureActorObserved(runtime, input.sessionId);
        } catch (error) {
          console.warn(
            '[runtime] Agent Actor observation after rewind failed:',
            sanitizeDiagnosticError(error),
          );
        }
      }
    }
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
    this.activeCompactionsBySession.delete(sessionId);
    this.localCompactionCallsBySession.delete(sessionId);
    this.stopActorObservation(sessionId);
    const observed = this.observations.get(sessionId);
    if (observed) {
      observed.observation.close();
      this.observations.delete(sessionId);
    }
    this.invalidateTranscriptBoundary(sessionId);
    this.activeRuns.delete(sessionId);
    this.projectedCompactionEntries.delete(sessionId);
    this.projectedCompactionEvents.delete(sessionId);
    this.resolvedCompactionEvents.delete(sessionId);
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
    this.persistedOwnershipTokens.delete(sessionId);
    this.runtimeCoderSessionIds.delete(sessionId);
    this.liveProjectionRevisions.delete(sessionId);
    invalidatePersistedSessionCache(sessionId);
    this.scheduleProfileRefresh(this.currentProfileCursor());
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
      // IPC/RealSession already owns the project/surface scope. Settings APIs and Runtime apply
      // their own Session identity/revision checks, so a mutable full-history read here is both
      // redundant and capable of rejecting a healthy active Session with data_changed.
      await this.assertPersistedCoderOwnership(sessionId);
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
        '[runtime] Auto LLM defaults load failed; falling back to engine=llm with SDK defaults:',
        sanitizeDiagnosticError(error),
      );
      defaults = {
        engine: 'llm',
      };
    }
    return {
      ...patch,
      ...(current.autoModeClassifierModel === undefined &&
      patch.autoModeClassifierModel === undefined &&
      defaults.classifierModel !== undefined
        ? { autoModeClassifierModel: defaults.classifierModel }
        : {}),
      ...(current.autoModeTimeoutMs === undefined &&
      patch.autoModeTimeoutMs === undefined &&
      defaults.timeoutMs !== undefined
        ? { autoModeTimeoutMs: defaults.timeoutMs }
        : {}),
      ...(current.autoModeSpeculativeWindowMs === undefined &&
      patch.autoModeSpeculativeWindowMs === undefined &&
      defaults.speculativeWindowMs !== undefined
        ? { autoModeSpeculativeWindowMs: defaults.speculativeWindowMs }
        : {}),
    };
  }

  async ensureObserved(sessionId: string): Promise<void> {
    await this.assertPersistedCoderOwnership(sessionId);
    this.desiredObservations.add(sessionId);
    if (this.observations.has(sessionId)) return;
    const existing = this.observationPromises.get(sessionId);
    if (existing) return existing;
    const pending = this.openObservation(sessionId, { trustPersistedOwnership: true }).finally(
      () => {
        if (this.observationPromises.get(sessionId) === pending) {
          this.observationPromises.delete(sessionId);
        }
      },
    );
    this.observationPromises.set(sessionId, pending);
    return pending;
  }

  async readSessionLiveSnapshot(sessionId: string): Promise<SpaceSessionLiveProjectionT> {
    await this.assertPersistedCoderOwnershipIfChanged(sessionId);
    const currentObservation = this.observations.get(sessionId);
    if (
      currentObservation !== undefined &&
      currentObservation.runtime === this.runtime &&
      this.state === 'ready'
    ) {
      const pending = currentObservation.eventQueue;
      await pending;
      if (
        this.observations.get(sessionId) === currentObservation &&
        currentObservation.runtime === this.runtime &&
        this.state === 'ready'
      ) {
        const snapshot = this.projectionController.sessionLiveSnapshot(sessionId);
        if (currentObservation.eventQueue === pending) {
          this.retireObservationIfQuiescent(sessionId);
        }
        return snapshot;
      }
    }

    const opening = this.observationPromises.get(sessionId);
    if (opening !== undefined) {
      await opening;
    } else {
      const cached = this.cachedSessionLiveSnapshot(sessionId);
      if (cached !== undefined) return cached;
      this.desiredObservations.add(sessionId);
      const pending = this.openObservation(sessionId, { trustPersistedOwnership: true }).finally(
        () => {
          if (this.observationPromises.get(sessionId) === pending) {
            this.observationPromises.delete(sessionId);
          }
        },
      );
      this.observationPromises.set(sessionId, pending);
      await pending;
    }
    const installed = this.observations.get(sessionId);
    const installedQueue = installed?.eventQueue;
    if (installedQueue !== undefined) await installedQueue;
    const snapshot = this.projectionController.sessionLiveSnapshot(sessionId);
    if (installed !== undefined && installed.eventQueue === installedQueue) {
      this.retireObservationIfQuiescent(sessionId);
    }
    return snapshot;
  }

  async readRuntimeProfileSnapshot(): Promise<SpaceRuntimeProfileProjectionT> {
    if (this.runtimeProfileSnapshotPromise !== null) return this.runtimeProfileSnapshotPromise;
    const pending = (async () => {
      await this.refreshProfileAfterConflict(this.currentProfileCursor());
      return this.projectionController.profileSnapshot();
    })().finally(() => {
      if (this.runtimeProfileSnapshotPromise === pending) {
        this.runtimeProfileSnapshotPromise = null;
      }
    });
    this.runtimeProfileSnapshotPromise = pending;
    return pending;
  }

  private cachedSessionLiveSnapshot(sessionId: string): SpaceSessionLiveProjectionT | undefined {
    let cached: SpaceSessionLiveProjectionT;
    try {
      cached = this.projectionController.sessionLiveSnapshot(sessionId);
    } catch (error: unknown) {
      if (error instanceof RuntimeProjectionUnavailableError) return undefined;
      throw error;
    }
    if (this.state !== 'ready' || this.runtime?.identity.runtimeId !== cached.cursor.runtimeId) {
      return undefined;
    }
    const profile = this.projectionController.profileSnapshot();
    const session = profile.sessions.find((candidate) => candidate.sessionId === sessionId);
    if (session === undefined) return undefined;
    if (session.activeRun?.runId !== cached.activeRun?.runId) return undefined;
    if (session.activeRun?.phase !== cached.activeRun?.phase) return undefined;
    if (session.queuedRuns.length !== cached.queuedRuns.length) return undefined;
    if (
      session.queuedRuns.some(
        (run, index) =>
          run.runId !== cached.queuedRuns[index]?.runId ||
          run.phase !== cached.queuedRuns[index]?.phase,
      )
    ) {
      return undefined;
    }
    if (session.lastTerminalRun?.runId !== cached.lastTerminalRun?.runId) return undefined;
    if (session.lastTerminalRun?.phase !== cached.lastTerminalRun?.phase) return undefined;
    const profilePendingInteractions = profile.interactions
      .filter(
        (interaction) =>
          interaction.state === 'pending' && interaction.request.sessionId === sessionId,
      )
      .map((interaction) => `${interaction.kind}:${interaction.request.reqId}`)
      .sort();
    const cachedPendingInteractions = cached.interactions
      .filter((interaction) => interaction.state === 'pending')
      .map((interaction) => `${interaction.kind}:${interaction.request.reqId}`)
      .sort();
    if (
      profilePendingInteractions.length !== cachedPendingInteractions.length ||
      profilePendingInteractions.some(
        (identity, index) => identity !== cachedPendingInteractions[index],
      )
    ) {
      return undefined;
    }
    return cached;
  }

  private previousLiveProjectionRevision(sessionId: string, runtimeId: string): number {
    const watermark = this.liveProjectionRevisions.get(sessionId);
    let revision = watermark?.runtimeId === runtimeId ? watermark.revision : 0;
    try {
      const previous = this.projectionController.sessionLiveSnapshot(sessionId);
      if (previous.cursor.runtimeId === runtimeId) {
        revision = Math.max(revision, previous.projectionRevision);
      }
    } catch (error: unknown) {
      if (!(error instanceof RuntimeProjectionUnavailableError)) throw error;
    }
    return revision;
  }

  private recordLiveProjectionRevision(projection: SpaceSessionLiveProjectionT): void {
    this.liveProjectionRevisions.set(projection.sessionId, {
      runtimeId: projection.cursor.runtimeId,
      revision: projection.projectionRevision,
    });
  }

  private compactionObservationKey(event: RuntimeTypedEvent): string {
    const payload = runtimeEventRecord(event.payload);
    const meta = runtimeEventRecord(payload?.meta);
    const contextId =
      (typeof payload?.contextId === 'string' ? payload.contextId : undefined) ??
      (typeof meta?.contextId === 'string' ? meta.contextId : undefined) ??
      (typeof payload?.agentId === 'string' ? payload.agentId : undefined) ??
      (typeof meta?.agentId === 'string' ? meta.agentId : undefined) ??
      'unknown';
    return `${event.runId}\0${contextId}`;
  }

  private updateObservationDemandFromEvent(event: RuntimeTypedEvent): void {
    if (
      event.type === 'run.queued' ||
      event.type === 'run.started' ||
      event.type === 'permission.requested' ||
      event.type === 'user_input.requested'
    ) {
      this.desiredObservations.add(event.sessionId);
    }
    if (
      event.type === 'context.compaction.started' ||
      event.type === 'context.compaction.finished'
    ) {
      // `finished` means the compaction result has been produced, not that the
      // context lifecycle is over. In particular, committed boundaries may be
      // reconciled asynchronously before the canonical `ended` event arrives.
      // Replayed/restored streams may also begin at `finished`, so it must be
      // sufficient on its own to retain the observation.
      this.desiredObservations.add(event.sessionId);
      const active = this.activeCompactionsBySession.get(event.sessionId) ?? new Set<string>();
      active.add(this.compactionObservationKey(event));
      this.activeCompactionsBySession.set(event.sessionId, active);
    } else if (
      event.type === 'context.compaction.ended' ||
      event.type === 'context.compaction.skipped'
    ) {
      const active = this.activeCompactionsBySession.get(event.sessionId);
      if (active) {
        active.delete(this.compactionObservationKey(event));
        if (active.size === 0) this.activeCompactionsBySession.delete(event.sessionId);
      }
    }
  }

  /**
   * Retire long-lived Session and Actor observers once the authoritative projection is quiescent.
   * Keeping terminal Sessions in desiredObservations makes every reconnect rebuild their reducers
   * serially and leaves one Actor long-poll per historical Session running forever.
   */
  private retireObservationIfQuiescent(sessionId: string): boolean {
    const state = this.observations.get(sessionId);
    if (!state || this.activeRuns.has(sessionId)) return false;
    const projection = state.reducer.snapshot();
    const queuedInputActive = projection.queuedInputs.some(
      (input) => input.state === 'queued' || input.state === 'delivering',
    );
    const interactionPending = projection.interactions.some(
      (interaction) => interaction.state === 'pending',
    );
    if (
      projection.activeRun !== undefined ||
      projection.queuedRuns.length > 0 ||
      queuedInputActive ||
      interactionPending ||
      (this.activeCompactionsBySession.get(sessionId)?.size ?? 0) > 0 ||
      (this.localCompactionCallsBySession.get(sessionId) ?? 0) > 0
    ) {
      return false;
    }
    this.desiredObservations.delete(sessionId);
    state.observation.close();
    this.observations.delete(sessionId);
    this.stopActorObservation(sessionId);
    return true;
  }

  /**
   * Observation bootstrap can buffer events until its immutable snapshot is installed. Wait for
   * that ordered queue before deciding that the snapshot is terminal; otherwise a synchronously
   * delivered run/interaction/compaction event could be discarded by premature retirement.
   */
  private async retireObservationWhenSettled(sessionId: string): Promise<boolean> {
    while (true) {
      const state = this.observations.get(sessionId);
      if (!state) return false;
      const pending = state.eventQueue;
      await pending;
      if (this.observations.get(sessionId) !== state) return false;
      if (state.eventQueue !== pending) continue;
      return this.retireObservationIfQuiescent(sessionId);
    }
  }

  async actorTreeSnapshot(sessionId: string): Promise<AgentActorTreeSnapshotT> {
    let runtime = await this.requireRuntime();
    await this.assertCoderSession(runtime, sessionId);
    await this.ensureObserved(sessionId);
    // ensureObserved may reconnect the daemon. Never attach the Actor cursor to
    // the pre-reconnect client captured above.
    runtime = await this.requireRuntime();
    await this.assertCoderSession(runtime, sessionId);
    try {
      const state = await this.ensureActorObserved(runtime, sessionId);
      const snapshot = state.observer.current() ?? (await state.observer.refreshNow());
      if (!snapshot) {
        throw new Error(`Coder daemon did not return an Agent Actor snapshot for ${sessionId}.`);
      }
      return snapshot;
    } finally {
      // A one-shot Actor snapshot for an already-terminal Session must not turn
      // into a permanent Session observation plus 30-second Actor long-poll.
      // Active/queued/pending work keeps the observers alive through the same
      // authoritative quiescence predicate.
      await this.retireObservationWhenSettled(sessionId);
    }
  }

  private async openObservation(
    sessionId: string,
    options: {
      readonly attachedRuntime?: KodaXDaemonRuntime;
      readonly trustPersistedOwnership?: boolean;
    } = {},
  ): Promise<void> {
    if (!options.trustPersistedOwnership) {
      await this.assertPersistedCoderOwnership(sessionId);
    }
    const runtime = options.attachedRuntime ?? (await this.requireRuntime());
    if (
      options.attachedRuntime !== undefined &&
      (this.runtime !== options.attachedRuntime || this.state !== 'ready')
    ) {
      throw new Error('Coder daemon connection changed before observation recovery.');
    }
    const parseRuntimeEvent =
      this.runtimeEventParser ?? (await import('@kodax-ai/kodax/runtime')).parseRuntimeEvent;
    const buffered: RuntimeTypedEvent[] = [];
    let state: RuntimeSessionObservationState | undefined;
    const observation = await runtime.sessions.observe(
      sessionId,
      (event) => {
        const parsed = parseRuntimeEvent(event);
        if (!parsed.ok) {
          throw new Error(`Malformed Runtime observation event: ${parsed.error}`);
        }
        if (!state) {
          buffered.push(parsed.event);
          return;
        }
        this.enqueueRuntimeEvent(state, parsed.event);
      },
      { timeoutMs: RUNTIME_READ_TIMEOUT_MS },
    );
    let installed = false;
    try {
      const session = observation.snapshot.session;
      if (!options.trustPersistedOwnership) {
        await this.assertPersistedCoderOwnership(sessionId);
      }
      assertRuntimeSessionIdentity(session, { sessionId });
      await this.resumeSnapshotBindings(runtime, observation.snapshot);
      const projected = projectRuntimeSessionSnapshot(observation.snapshot);
      const initial = {
        ...projected,
        projectionRevision: Math.max(
          projected.projectionRevision,
          this.previousLiveProjectionRevision(sessionId, projected.cursor.runtimeId) + 1,
        ),
      };
      await this.syncSpaceSessionSettings(sessionId, observation.snapshot.settings.value);
      const reducer = new CoderSessionProjectionReducer(initial, observation.snapshot.runs);
      for (const run of observation.snapshot.runs) this.runProviders.set(run.runId, run.provider);
      state = {
        sessionId,
        runtime,
        observation,
        reducer,
        transcriptSnapshotFresh: true,
        eventQueue: Promise.resolve(),
      };
      if (this.runtime !== runtime || this.state !== 'ready') {
        throw new Error('Coder daemon connection changed while opening a session observation.');
      }
      if (!this.desiredObservations.has(sessionId)) return;
      this.observations.set(sessionId, state);
      installed = true;
      void observation.invalidated
        .then((invalidation) => this.handleObservationInvalidation(state!, invalidation))
        .catch((error: unknown) => {
          console.warn(
            `[runtime] observation invalidation signal failed for ${sessionId}:`,
            sanitizeDiagnosticError(error),
          );
        });
      this.advanceProfileCursor(runtime, observation.snapshot.cursor);
      // A retired observation deliberately leaves its final projection cached for cheap reads.
      // Once a new daemon observation has been installed, that snapshot supersedes the cache even
      // when its daemon cursor is unchanged. Remove the old cache atomically before applying the
      // fresh snapshot; the independent revision watermark still prevents renderer rollback.
      this.projectionController.removeSessionLive(sessionId);
      if (!this.projectionController.replaceSessionLive(initial)) {
        throw new Error(`Runtime rejected the authoritative live snapshot for ${sessionId}.`);
      }
      this.recordLiveProjectionRevision(initial);
      // Actor telemetry is best-effort: a daemon without the agents plane (or a
      // telemetry attach failure) must not fail session observation — the same
      // policy as the post-rewind re-attach below. actorTreeSnapshot still
      // surfaces the factual error to the renderer on demand.
      try {
        await this.ensureActorObserved(runtime, sessionId);
      } catch (error) {
        console.warn(
          '[runtime] Agent Actor observation attach failed:',
          sanitizeDiagnosticError(error),
        );
      }
      for (const run of observation.snapshot.runs) {
        const continuation = this.continuationPrompts.get(run.runId);
        if (continuation && run.phase !== 'queued') {
          this.continuationPrompts.delete(run.runId);
          this.push('session.event', {
            kind: 'queued_user_prompt_started',
            sessionId: continuation.sessionId,
            queueId: run.runId,
            queueMode: 'after-turn',
            content: continuation.content,
            ...(run.turnId ? { turnId: run.turnId, turnUserOrdinal: 0 } : {}),
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

  private async handleObservationInvalidation(
    state: RuntimeSessionObservationState,
    invalidation: RuntimeObservationInvalidation,
  ): Promise<void> {
    if (this.observations.get(state.sessionId) !== state) return;
    const invalidationMessage =
      sanitizeDiagnosticError(invalidation.message) ||
      'The Runtime observation must be rebuilt from a fresh snapshot.';
    console.warn(
      `[runtime] observation invalidated for ${state.sessionId} (${invalidation.reason}): ${invalidationMessage}`,
    );
    this.observations.delete(state.sessionId);
    state.observation.close();
    this.stopActorObservation(state.sessionId);
    // The replacement snapshot is authoritative for runs/queues/interactions but exposes no
    // active-compaction state. Markers derived from the invalid event stream are therefore no
    // longer provable. A Space-issued compact() still awaiting its command promise remains
    // protected independently by localCompactionCallsBySession.
    this.activeCompactionsBySession.delete(state.sessionId);
    this.projectionController.removeSessionLive(state.sessionId);

    // Tell the renderer to discard its stale projection immediately. Reopening
    // the daemon observation may involve transport recovery and must not keep
    // the invalid snapshot visible for that entire wait.
    this.push('session.liveInvalidated', {
      sessionId: state.sessionId,
      runtimeId: invalidation.runtimeId,
      reason: invalidation.reason,
      message: invalidationMessage,
    });

    let resyncError: unknown;
    if (
      this.desiredObservations.has(state.sessionId) &&
      this.runtime === state.runtime &&
      this.state === 'ready'
    ) {
      try {
        // This is recovery of an observation whose persisted Coder ownership and daemon Session
        // identity were already validated. Re-reading the full persisted Session here races the
        // active Run's normal writer lock and can keep live controls absent for minutes. The same
        // Runtime identity plus the fresh daemon snapshot are the recovery fence; a new explicit
        // ensureObserved() still performs the full persisted ownership check.
        const existing = this.observationPromises.get(state.sessionId);
        if (existing) {
          await existing;
        }
        // An invalidation may arrive after the initial observation installed its state but before
        // that opening promise's finally handler ran. Re-check after awaiting it; otherwise the
        // invalidation would consume the only recovery attempt.
        if (!this.observations.has(state.sessionId)) {
          const pending = this.openObservation(state.sessionId, {
            attachedRuntime: state.runtime,
            trustPersistedOwnership: true,
          }).finally(() => {
            if (this.observationPromises.get(state.sessionId) === pending) {
              this.observationPromises.delete(state.sessionId);
            }
          });
          this.observationPromises.set(state.sessionId, pending);
          await pending;
        }
        await this.retireObservationWhenSettled(state.sessionId);
      } catch (error) {
        resyncError = error;
      }
    }

    if (resyncError !== undefined) {
      this.lastError = sanitizeDiagnosticError(resyncError);
      // The profile is the bounded fallback for controls while session.live is absent. Reconcile
      // it from the same Runtime so a terminal Run that raced the failed observation cannot leave
      // Stop visible forever. A successful snapshot is fresh even though this one Session's
      // detailed observation failed, and must remain usable if the Run is still active. Only when
      // the profile read itself fails do we mark the connection stale and reject the old fallback.
      try {
        await this.refreshProfile(this.currentProfileCursor());
      } catch (profileError) {
        console.warn(
          `[runtime] profile reconciliation after observation failure also failed for ${state.sessionId}:`,
          sanitizeDiagnosticError(profileError),
        );
        this.publishUnavailable('degraded', this.lastError);
      }
      console.warn(`[runtime] observation resync failed for ${state.sessionId}:`, this.lastError);
    }
  }

  private async ensureActorObserved(
    runtime: KodaXDaemonRuntime,
    sessionId: string,
  ): Promise<RuntimeActorObservationState> {
    const existing = this.actorObservations.get(sessionId);
    if (existing?.runtime === runtime) return existing;
    if (!runtime.agents.enabled) {
      // Without this guard a daemon with the agents plane disabled would attach
      // an observer whose every refresh fails and retries forever.
      throw new Error(
        'This Coder daemon does not enable the agents plane; Agent Actor telemetry is unavailable.',
      );
    }
    this.stopActorObservation(sessionId);

    let state: RuntimeActorObservationState;
    const observer = new RuntimeAgentTreeObserver({
      runtimeId: runtime.identity.runtimeId,
      sessionId,
      source: runtime.agents,
      onSnapshot: (snapshot) => {
        if (
          this.actorObservations.get(sessionId) !== state ||
          this.runtime !== runtime ||
          this.state !== 'ready'
        ) {
          return;
        }
        const previous = this.actorSnapshots.get(sessionId);
        if (
          previous?.runtimeId === snapshot.runtimeId &&
          previous.revision === snapshot.revision &&
          previous.eventCursor >= snapshot.eventCursor
        ) {
          return;
        }
        this.actorSnapshots.set(sessionId, snapshot);
        this.push('agent.actor.changed', snapshot);
      },
      shouldRetry: (error) => !isSessionNotFound(error) && this.state !== 'closed',
      onError: (error, consecutiveFailures, retryDelayMs) => {
        if (consecutiveFailures !== 1 && consecutiveFailures % 10 !== 0) return;
        console.warn(
          `[runtime] Agent Actor observation for ${sessionId} failed ` +
            `(attempt ${consecutiveFailures}, retry ${retryDelayMs}ms): ` +
            sanitizeDiagnosticError(error),
        );
      },
    });
    state = { runtime, observer };
    this.actorObservations.set(sessionId, state);
    try {
      await observer.start();
    } catch (error) {
      if (this.actorObservations.get(sessionId) === state) {
        this.stopActorObservation(sessionId);
      }
      throw error;
    }
    return state;
  }

  private stopActorObservation(sessionId: string): void {
    this.actorObservations.get(sessionId)?.observer.stop();
    this.actorObservations.delete(sessionId);
    this.actorSnapshots.delete(sessionId);
  }

  private stopAllActorObservations(): void {
    for (const state of this.actorObservations.values()) state.observer.stop();
    this.actorObservations.clear();
    this.actorSnapshots.clear();
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
    state: RuntimeSessionObservationState,
    event: RuntimeTypedEvent,
  ): void {
    // The observation snapshot is immutable. Once any later event is accepted, a future history
    // request must start a fresh transcript revision instead of silently replaying the old tail.
    state.transcriptSnapshotFresh = false;
    // Do not let a caller arriving after this event join an older immutable paging boundary.
    // Existing callers either share a newer replacement or retry once in readTranscript().
    this.invalidateTranscriptBoundary(event.sessionId);
    state.eventQueue = state.eventQueue
      .then(() => this.applyRuntimeEvent(state, event))
      .catch((error: unknown) => {
        this.lastError = sanitizeDiagnosticError(error);
        console.warn(
          `[runtime] observation delivery failed for ${event.type} (${event.id}): ${this.lastError}`,
        );
        void this.handleObservationInvalidation(state, {
          code: 'observation_invalidated',
          reason: 'delivery_failed',
          runtimeId: state.runtime.identity.runtimeId,
          message: this.lastError,
        });
      });
  }

  private async applyRuntimeEvent(
    state: RuntimeSessionObservationState,
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
    this.updateObservationDemandFromEvent(event);
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
        this.recordLiveProjectionRevision(projection);
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
          ...runtimeSessionEventOrigin(runtime.identity.runtimeId, event),
          kind: 'queued_user_prompt_started',
          sessionId: continuation.sessionId,
          queueId: event.runId,
          queueMode: 'after-turn',
          content: continuation.content,
          ...(event.turnId ? { turnId: event.turnId, turnUserOrdinal: 0 } : {}),
        });
      }
      const leaseId = this.continuationCredentialLeases.get(event.runId);
      if (leaseId) {
        await this.revokeCredentialLease(runtime, leaseId);
      }
    }
    await this.bridgeRuntimeEvent(event, runtime.identity.runtimeId);
    if (runtimeEventChangesProfile(event.type)) {
      this.scheduleProfileRefresh(event.seq);
    }
    this.retireObservationIfQuiescent(event.sessionId);
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

  private observeRootTurnStart(turnId: string, deliveryKind: unknown): void {
    if (this.nextUserOrdinalByTurnId.has(turnId)) return;
    // An initial turn has already consumed its prompt at ordinal zero. A queued turn is created
    // immediately before run.input.delivered, so that delivered input itself owns ordinal zero.
    // Other or future delivery kinds do not prove either shape and must remain fail-open.
    if (deliveryKind === 'initial') this.nextUserOrdinalByTurnId.set(turnId, 1);
    else if (deliveryKind === 'queued') this.nextUserOrdinalByTurnId.set(turnId, 0);
  }

  private takeObservedUserOrdinal(turnId: string | undefined): number | undefined {
    if (turnId === undefined) return undefined;
    const ordinal = this.nextUserOrdinalByTurnId.get(turnId);
    if (ordinal === undefined) return undefined;
    this.nextUserOrdinalByTurnId.set(turnId, ordinal + 1);
    return ordinal;
  }

  private async bridgeRuntimeEvent(event: RuntimeTypedEvent, runtimeId?: string): Promise<void> {
    const payload =
      event.payload !== null && typeof event.payload === 'object'
        ? (event.payload as Readonly<Record<string, unknown>>)
        : undefined;
    const contextEvent = projectRuntimeContextSessionEvent(event);
    if (contextEvent) {
      this.push('session.event', contextEvent);
      if (event.type === 'context.compaction.finished') {
        this.projectCommittedCompactionBoundary(event);
      }
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
        event.type === 'tool.sandbox' ||
        event.type === 'todo.updated'
      ) {
        return;
      }
    }
    if (event.type === 'assistant.delta' && typeof payload?.text === 'string') {
      this.push('session.event', {
        ...runtimeSessionEventOrigin(runtimeId, event),
        ...runtimeTranscriptTurnIdentity(event),
        kind: 'text_delta',
        sessionId: event.sessionId,
        text: payload.text,
      });
      return;
    }
    if (event.type === 'thinking.delta' && typeof payload?.text === 'string') {
      this.push('session.event', {
        ...runtimeSessionEventOrigin(runtimeId, event),
        ...runtimeTranscriptTurnIdentity(event),
        kind: 'thinking_delta',
        sessionId: event.sessionId,
        text: payload.text,
      });
      return;
    }
    if (event.type === 'thinking.finished' && typeof payload?.thinking === 'string') {
      this.push('session.event', {
        ...runtimeSessionEventOrigin(runtimeId, event),
        ...runtimeTranscriptTurnIdentity(event),
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
        ...runtimeSessionEventOrigin(runtimeId, event),
        ...runtimeTranscriptTurnIdentity(event),
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
          ...runtimeSessionEventOrigin(runtimeId, event),
          ...runtimeTranscriptTurnIdentity(event),
          kind: 'tool_progress',
          sessionId: event.sessionId,
          toolId,
          message: update.message,
        });
      } else if (typeof payload?.partialJson === 'string') {
        this.push('session.event', {
          ...runtimeSessionEventOrigin(runtimeId, event),
          ...runtimeTranscriptTurnIdentity(event),
          kind: 'tool_input_delta',
          sessionId: event.sessionId,
          toolId,
          toolName: typeof payload.toolName === 'string' ? payload.toolName : 'tool',
          partialJson: payload.partialJson,
        });
      }
      return;
    }
    if (event.type === 'tool.sandbox') {
      // Structured sandbox state is projected through session.liveChanged only.
      // It must never become model-visible or ordinary conversation history.
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
        ...runtimeSessionEventOrigin(runtimeId, event),
        ...runtimeTranscriptTurnIdentity(event),
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
        const entryId =
          typeof delivered?.entryId === 'string' &&
          delivered.entryId.length > 0 &&
          delivered.entryId.length <= 256
            ? delivered.entryId
            : undefined;
        const turnUserOrdinal = this.takeObservedUserOrdinal(event.turnId);
        const parsed = sessionEventChannel.payload.safeParse({
          ...runtimeSessionEventOrigin(runtimeId, event),
          kind: 'mid_turn_user_prompt',
          sessionId: event.sessionId,
          ...(queueId ? { queueId } : {}),
          ...(entryId ? { entryId } : {}),
          content: clampRuntimePromptEventText(content),
          ...(event.turnId ? { turnId: event.turnId } : {}),
          ...(turnUserOrdinal !== undefined ? { turnUserOrdinal } : {}),
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
    if (event.type === 'turn.completed' || event.type === 'turn.failed') {
      if (event.turnId) this.nextUserOrdinalByTurnId.delete(event.turnId);
      return;
    }
    // Runtime allocates canonical turn identity after run admission. Real daemon
    // run.started events therefore have no turnId; turn.started is the first
    // lifecycle event that can bind the optimistic renderer turn to durable history.
    if (event.type === 'turn.started') {
      if (payload?.contextKind === 'child') return;
      const turnId =
        event.turnId ?? (typeof payload?.turnId === 'string' ? payload.turnId : undefined);
      if (!turnId) return;
      this.observeRootTurnStart(turnId, payload?.deliveryKind);
      this.push('session.event', {
        ...runtimeSessionEventOrigin(runtimeId, event),
        kind: 'session_start',
        sessionId: event.sessionId,
        provider: this.runProviders.get(event.runId) ?? 'unknown',
        turnId,
      });
      return;
    }
    if (event.type === 'run.started') {
      const continuation = this.continuationPrompts.get(event.runId);
      if (continuation) {
        this.continuationPrompts.delete(event.runId);
        this.push('session.event', {
          ...runtimeSessionEventOrigin(runtimeId, event),
          kind: 'queued_user_prompt_started',
          sessionId: continuation.sessionId,
          queueId: event.runId,
          queueMode: 'after-turn',
          content: continuation.content,
          ...(event.turnId ? { turnId: event.turnId, turnUserOrdinal: 0 } : {}),
        });
      }
      const provider =
        (typeof payload?.provider === 'string' ? payload.provider : undefined) ??
        this.runProviders.get(event.runId) ??
        'unknown';
      if (provider !== 'unknown') this.runProviders.set(event.runId, provider);
      this.push('session.event', {
        ...runtimeSessionEventOrigin(runtimeId, event),
        kind: 'session_start',
        sessionId: event.sessionId,
        provider,
        ...(event.turnId ? { turnId: event.turnId } : {}),
      });
      return;
    }
    if (event.type === 'run.completed') {
      this.terminalSidecarBlockRuns.delete(event.runId);
      this.pushTerminalInterruptFailures(event.sessionId, payload, 'run_completed');
      this.push('session.event', {
        ...runtimeSessionEventOrigin(runtimeId, event),
        kind: 'session_complete',
        sessionId: event.sessionId,
        ...(event.turnId ? { turnId: event.turnId } : {}),
      });
      if (event.turnId) this.nextUserOrdinalByTurnId.delete(event.turnId);
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
      if (event.turnId) this.nextUserOrdinalByTurnId.delete(event.turnId);
      if (terminalSidecarBlock) {
        this.push('session.event', {
          ...runtimeSessionEventOrigin(runtimeId, event),
          kind: 'session_complete',
          sessionId: event.sessionId,
          ...(event.turnId ? { turnId: event.turnId } : {}),
        });
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
        ...runtimeSessionEventOrigin(runtimeId, event),
        kind: 'session_error',
        sessionId: event.sessionId,
        ...(event.turnId ? { turnId: event.turnId } : {}),
        error,
        category: event.type === 'run.cancelled' ? 'cancelled' : 'unknown',
        retriable: event.type !== 'run.failed',
      });
    }
  }

  private projectCommittedCompactionBoundary(event: RuntimeTypedEvent): void {
    const payload = runtimeEventRecord(event.payload);
    if (event.type !== 'context.compaction.finished' || payload?.committed !== true) return;
    const isRootContext =
      payload.contextKind === 'root' ||
      (payload.contextKind === undefined && payload.parentContextId === undefined);
    if (!isRootContext) return;

    const provisionalId = `runtime-compaction:${event.id}`;
    const projectedEvents =
      this.projectedCompactionEvents.get(event.sessionId) ??
      (() => {
        const ids = new Set<string>();
        this.projectedCompactionEvents.set(event.sessionId, ids);
        return ids;
      })();
    if (!projectedEvents.has(provisionalId)) {
      projectedEvents.add(provisionalId);
      const sentAt = Date.parse(event.time);
      this.push('session.event', {
        kind: 'lineage_notice',
        sessionId: event.sessionId,
        noticeKind: 'compaction',
        text: 'Compaction',
        provisionalId,
        displayId: provisionalId,
        ...(typeof payload.contextId === 'string' ? { contextId: payload.contextId } : {}),
        ...(typeof payload.contextRevision === 'number'
          ? { contextRevision: payload.contextRevision }
          : {}),
        ...(typeof payload.afterRevision === 'number'
          ? { afterRevision: payload.afterRevision }
          : {}),
        ...(payload.source === 'manual' ||
        payload.source === 'automatic_threshold' ||
        payload.source === 'physical_capacity'
          ? { source: payload.source }
          : {}),
        ...(typeof payload.tokensBefore === 'number' ? { tokensBefore: payload.tokensBefore } : {}),
        ...(typeof payload.tokensAfter === 'number' ? { tokensAfter: payload.tokensAfter } : {}),
        ...(Number.isFinite(sentAt) ? { sentAt } : {}),
      });
    }

    const runtime = this.runtime;
    if (!runtime || this.state !== 'ready') return;
    invalidatePersistedSessionCache(event.sessionId);
    // Current Runtime releases do not expose the persisted compaction ID on the finish event.
    // The provisional boundary is already complete for display; exact enrichment is attempted
    // only when a future/compatible Runtime supplies authoritative physical identity.
    if (
      typeof payload.compactionEntryId !== 'string' ||
      payload.compactionEntryId.trim().length === 0
    ) {
      return;
    }
    const taskKey = `${event.sessionId}\0${provisionalId}`;
    if (this.resolvedCompactionEvents.get(event.sessionId)?.has(provisionalId)) return;
    if (this.compactionProjectionTasks.has(taskKey)) return;
    const task = this.reconcileCommittedCompactionBoundary(runtime, event, provisionalId)
      .catch(() => undefined)
      .finally(() => {
        if (this.compactionProjectionTasks.get(taskKey) === task) {
          this.compactionProjectionTasks.delete(taskKey);
        }
      });
    this.compactionProjectionTasks.set(taskKey, task);
  }

  private async reconcileCommittedCompactionBoundary(
    runtime: KodaXDaemonRuntime,
    event: RuntimeTypedEvent,
    provisionalId: string,
  ): Promise<void> {
    const payload = runtimeEventRecord(event.payload);
    if (!payload) return;
    const seen =
      this.projectedCompactionEntries.get(event.sessionId) ??
      (() => {
        const ids = new Set<string>();
        this.projectedCompactionEntries.set(event.sessionId, ids);
        return ids;
      })();

    // Persistence precedes the finished event, but daemon paging can lag by a few milliseconds.
    // The provisional row is already visible at the exact event slot, so these bounded retries
    // only enrich its provenance and can fail without deleting or moving the boundary.
    for (const delayMs of [0, 25, 100]) {
      if (delayMs > 0) await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
      if (
        this.runtime !== runtime ||
        this.state !== 'ready' ||
        !this.projectedCompactionEvents.get(event.sessionId)?.has(provisionalId)
      ) {
        return;
      }
      let candidates: RuntimeCompactionCandidate[];
      try {
        candidates = await readRecentRuntimeCompactionCandidates(runtime, event.sessionId);
      } catch {
        continue;
      }
      if (
        this.runtime !== runtime ||
        this.state !== 'ready' ||
        !this.projectedCompactionEvents.get(event.sessionId)?.has(provisionalId)
      ) {
        return;
      }
      const resolved = selectCommittedCompactionCandidate(candidates, event, seen);
      if (!resolved) continue;
      const { entry, canonicalIndex } = resolved;
      const resolvedEvents =
        this.resolvedCompactionEvents.get(event.sessionId) ??
        (() => {
          const ids = new Set<string>();
          this.resolvedCompactionEvents.set(event.sessionId, ids);
          return ids;
        })();
      const sentAt = Date.parse(entry.timestamp);
      const text =
        typeof entry.summary === 'string' && entry.summary.trim().length > 0
          ? entry.summary.slice(0, 262_144)
          : 'Compaction';
      this.push('session.event', {
        kind: 'lineage_notice',
        sessionId: event.sessionId,
        noticeKind: 'compaction',
        text,
        provisionalId,
        displayId: provisionalId,
        entryId: entry.entryId,
        parentId: entry.parentId,
        logicalId: entry.logicalId,
        ...(entry.sourceEntryId !== undefined ? { sourceEntryId: entry.sourceEntryId } : {}),
        canonicalIndex,
        ...(entry.turnId !== undefined ? { turnId: entry.turnId } : {}),
        ...(typeof payload.contextId === 'string' ? { contextId: payload.contextId } : {}),
        ...(typeof payload.contextRevision === 'number'
          ? { contextRevision: payload.contextRevision }
          : {}),
        ...(typeof payload.afterRevision === 'number'
          ? { afterRevision: payload.afterRevision }
          : {}),
        ...(payload.source === 'manual' ||
        payload.source === 'automatic_threshold' ||
        payload.source === 'physical_capacity'
          ? { source: payload.source }
          : {}),
        ...(typeof payload.tokensBefore === 'number' ? { tokensBefore: payload.tokensBefore } : {}),
        ...(typeof payload.tokensAfter === 'number' ? { tokensAfter: payload.tokensAfter } : {}),
        ...(Number.isFinite(sentAt) ? { sentAt } : {}),
      });
      seen.add(entry.entryId);
      resolvedEvents.add(provisionalId);
      return;
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
    // Every Space start path calls ensureSession() before reaching this method. Do not put a
    // second history-grade persisted read between factual admission and runs.start(): normal
    // Session writers may make that read report data_changed even though Runtime can safely
    // validate and admit the exact Session operation itself.
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
      this.retireObservationIfQuiescent(input.sessionId);
      throw error;
    }
    if (registeredCredential) {
      const lease = this.credentialLeases.get(registeredCredential.leaseId);
      if (lease) lease.runBinding.boundRunId = handle.runId;
    }
    this.spaceOwnedRunIds.add(handle.runId);
    this.activeRuns.set(input.sessionId, handle.runId);
    const result = handle.result.finally(async () => {
      if (this.activeRuns.get(input.sessionId) === handle.runId) {
        this.activeRuns.delete(input.sessionId);
      }
      if (registeredCredential && this.runtime === runtime && this.state === 'ready') {
        await this.revokeCredentialLease(runtime, registeredCredential.leaseId);
      }
      this.retireObservationIfQuiescent(input.sessionId);
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
    // Run control/status is already fenced by the daemon's Session admission and Runtime
    // identity. Do not put a full persisted-Session read in front of it: an executing Run owns
    // the Session write lock, so that history-grade boundary can legitimately report
    // `data_changed` at the exact moment the user needs Stop to remain available.
    const status = await runtime.sessions.status(sessionId);
    if (status.sessionId !== sessionId) {
      throw new Error('Coder daemon Session status belongs to a different Session identity.');
    }
    if (status.runtimeId !== runtime.identity.runtimeId) {
      throw new Error('Coder daemon Session status belongs to a different Runtime identity.');
    }
    if (this.runtime !== runtime || this.state !== 'ready') {
      throw new Error('Coder Runtime changed while resolving the active Run.');
    }
    switch (status.phase) {
      case 'running':
      case 'waiting_agent':
      case 'recovering':
      case 'waiting_permission':
      case 'waiting_user_input':
      case 'unknown':
        if (!status.runId) {
          throw new Error(
            `Coder daemon reported ${status.phase} for ${sessionId} without a Run identity.`,
          );
        }
        return status.runId;
      default:
        return undefined;
    }
  }

  async abortSessionRun(sessionId: string): Promise<RuntimeRunStopReceipt | undefined> {
    // Runtime-selected-but-disconnected is an availability failure, not evidence that the
    // Session has no active Run. Requiring the authoritative Runtime here either reconnects or
    // fails the IPC explicitly; returning undefined would make the UI claim "no active run".
    const runtime = await this.requireRuntime();
    // `runtime.runs.abort()` performs the authoritative run/session ownership check. A durable
    // transcript ownership read is intentionally absent here because active Session writes are
    // normal, not an identity conflict, and must never prevent delivery of a Stop request.
    const statuses = await runtime.runs.list({
      sessionId,
      phase: [
        'running',
        'waiting_agent',
        'recovering',
        'waiting_permission',
        'waiting_user_input',
        'unknown',
        'queued',
      ],
    });
    if (statuses.some((candidate) => candidate.sessionId !== sessionId)) {
      throw new Error('Coder daemon returned a Run status for a different Session identity.');
    }
    if (this.runtime !== runtime || this.state !== 'ready') {
      throw new Error('Coder Runtime changed before the Stop request could be delivered.');
    }
    const status = statuses.slice().sort((a, b) => {
      const rank = (run: RuntimeRunStatus): number => (run.phase === 'queued' ? 1 : 0);
      return rank(a) - rank(b) || (a.sessionOrder ?? 0) - (b.sessionOrder ?? 0);
    })[0];
    const runId = status?.runId ?? this.activeRunId(sessionId);
    if (!runId) return undefined;
    const receipt = await runtime.runs.abort(runId);
    if (receipt.runId !== runId || receipt.sessionId !== sessionId) {
      throw new Error('Coder daemon returned a Stop receipt for a different Run or Session.');
    }
    // Terminal events normally refresh both projections. A Stop can instead race observation
    // invalidation or transport recovery, so schedule an authoritative profile reconciliation as
    // a second, bounded path rather than leaving the renderer on a stale active-Run summary.
    this.scheduleProfileRefresh(this.currentProfileCursor());
    return receipt;
  }

  /**
   * Best-effort cancellation used only after the user explicitly confirms a
   * forced Space exit. Session identity is deliberately not used as client
   * ownership: several Runtime clients may attach to one Session concurrently.
   */
  async stopSpaceOwnedRuntimeWorkForForcedExit(): Promise<{
    readonly attempted: number;
    readonly failed: number;
  }> {
    if (!this.hasReadyRuntime()) {
      return { attempted: 0, failed: 0 };
    }
    const runtime = await this.requireRuntime();
    const preflight = await runtime.status.preflight();
    if (this.runtime !== runtime || this.state !== 'ready') {
      throw new Error('Coder Runtime changed before forced-exit cancellation could start.');
    }

    const operations: Promise<unknown>[] = [];
    const principalId = this.runtimePrincipalId;
    const runIds = new Set(
      [...preflight.activeRuns, ...preflight.queuedRuns]
        .filter(
          (run) =>
            this.spaceOwnedRunIds.has(run.runId) ||
            (principalId !== undefined && run.origin?.principalId === principalId),
        )
        .map((run) => run.runId),
    );
    for (const runId of runIds) operations.push(runtime.runs.abort(runId));

    if (runtime.agents.enabled) {
      const actors = new Set<string>();
      for (const turn of preflight.activeAgentTurns) {
        const actorKey = `${turn.sessionId}\u0000${turn.actorPath}`;
        const turnKey = `${actorKey}\u0000${turn.turnId}`;
        if (!this.spaceOwnedAgentTurns.has(turnKey) || actors.has(actorKey)) continue;
        actors.add(actorKey);
        operations.push(
          runtime.agents.interrupt(turn.sessionId, turn.actorPath, 'KodaX Space force close'),
        );
      }
    }

    let workflowLookupFailures = 0;
    const workflowSnapshots = await Promise.allSettled(
      preflight.activeWorkflows.map((workflow) => runtime.workflows.get(workflow.runId)),
    );
    for (let index = 0; index < workflowSnapshots.length; index += 1) {
      const result = workflowSnapshots[index];
      const summary = preflight.activeWorkflows[index];
      if (!result || !summary) continue;
      if (result.status === 'rejected') {
        workflowLookupFailures += 1;
        continue;
      }
      const sourceRunId = (result.value as { readonly sourceRunId?: unknown } | undefined)
        ?.sourceRunId;
      if (
        typeof sourceRunId === 'string' &&
        (runIds.has(sourceRunId) || this.spaceOwnedRunIds.has(sourceRunId))
      ) {
        operations.push(runtime.workflows.stop(summary.runId));
      }
    }

    const results = await Promise.allSettled(operations);
    return {
      attempted: operations.length,
      failed:
        workflowLookupFailures + results.filter((result) => result.status === 'rejected').length,
    };
  }

  async submitInput(input: RuntimeSubmitInput) {
    const runtime = await this.requireRuntime();
    // submitInput is a control-plane operation against an already identified active Run. The
    // daemon validates the session/run boundary authoritatively. A full persisted-history read
    // here races the active Run's own writer lock and can make a healthy Session impossible to
    // address, exactly like the former Stop preflight bug.
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
      this.retireObservationIfQuiescent(input.sessionId);
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
    if (result.accepted) this.spaceOwnedRunIds.add(result.runId);
    if (!result.accepted) {
      // `stale_run` is an expected admission result, but it also means the local Run boundary
      // used for this send is no longer safe for another mutation. Refresh the independent
      // Runtime profile so the renderer can converge without retrying or changing delivery mode.
      // This does not pretend to repair a daemon whose status and event stream disagree.
      if (result.reason === 'stale_run') {
        this.scheduleProfileRefresh(this.currentProfileCursor());
      }
      this.retireObservationIfQuiescent(input.sessionId);
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

  async learningContext(): Promise<{ readonly runtimeId: string }> {
    const runtime = await this.requireRuntime();
    const capabilities = this.spaceCapabilities(runtime);
    const learning = capabilities.find((item) => item.id === 'runtime.learning');
    const skillLoop = capabilities.find((item) => item.id === 'runtime.learning.skillLoop');
    if (
      learning?.available !== true ||
      learning.version < 1 ||
      skillLoop?.available !== true ||
      skillLoop.version < 1
    ) {
      throw new Error(
        'Learned Skill safety requires Runtime learningCenter:1 and skillLearningLoop:1.',
      );
    }
    return { runtimeId: runtime.identity.runtimeId };
  }

  async learningEvents(afterRevision?: number) {
    const runtime = await this.requireRuntime();
    return runtime.learning.events(afterRevision);
  }

  subscribeToLearning(options?: Parameters<KodaXDaemonRuntime['learning']['subscribe']>[0]) {
    if (!this.hasReadyRuntime() || this.runtime === null) {
      throw new Error('Runtime learning subscription requires a ready shared daemon.');
    }
    return this.runtime.learning.subscribe(options);
  }

  async acknowledgeLearnedCapability(capabilityId: string): Promise<void> {
    const runtime = await this.requireRuntime();
    await runtime.learning.acknowledge(capabilityId);
  }

  async controlLearnedCapability(
    action: 'review' | 'trust' | 'reject' | 'disable' | 'rollback',
    nameOrSlug: string,
  ): Promise<void> {
    if (!areLearningMutationsEnabled()) {
      throw new Error('Space learned Skill mutation controls are disabled by rollout policy.');
    }
    const runtime = await this.requireRuntime();
    await runtime.learning[action](nameOrSlug);
  }

  async reloadRuntimeConfig(): Promise<void> {
    const runtime = await this.requireRuntime();
    await runtime.config.reload();
    await this.refreshProfile(this.currentProfileCursor());
  }

  async listRuntimeCustomProviders(): Promise<readonly SdkCustomProviderConfig[]> {
    const runtime = await this.requireRuntime();
    return runtime.catalog.customProviders();
  }

  async upsertRuntimeCustomProvider(
    config: SdkCustomProviderConfig,
  ): Promise<SdkCustomProviderConfig> {
    const runtime = await this.requireRuntime();
    return runtime.catalog.upsertCustomProvider(config);
  }

  async deleteRuntimeCustomProvider(name: string): Promise<boolean> {
    const runtime = await this.requireRuntime();
    return runtime.catalog.deleteCustomProvider(name);
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
    await this.assertCoderSession(runtime, sessionId);
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
    await this.assertCoderSession(runtime, input.sessionId);
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
    this.spaceOwnedAgentTurns.add(
      `${input.sessionId}\u0000${started.actorPath}\u0000${started.turnId}`,
    );
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
    await this.assertCoderSession(runtime, sessionId);
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
    if (
      state.owner.runtimeId !== state.runtimeId ||
      state.owner.kind !== 'daemon' ||
      !Number.isSafeInteger(state.owner.pid) ||
      state.owner.pid <= 0
    ) {
      throw new Error('Coder daemon management returned an invalid owner identity.');
    }
    return state;
  }

  async prepareInlineRollback(operationId?: string): Promise<RuntimeDaemonRollbackResult> {
    const management = await this.inspectDaemonStop();
    return this.prepareInlineRollbackFromManagement(management, operationId);
  }

  private async prepareInlineRollbackFromManagement(
    management: RuntimeDaemonManagementState,
    operationId?: string,
  ): Promise<RuntimeDaemonRollbackResult> {
    const runtime = await this.requireRuntime();
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
    await this.completeInlineRollbackOwnerTransition(rollback.runtimeId);
    return rollback;
  }

  /**
   * Stop the Space-selected Coder daemon while this process still owns a live
   * Runtime control plane. A ready daemon uses the revisioned stopForInline
   * transaction, not the inspect-then-CLI path. The temporary inline fence
   * closes the owner hand-off race and is held until the inspected daemon PID
   * has exited. It is released only after daemon policy is restored, leaving
   * the profile both unowned and ready for the next launch.
   */
  async stopDaemonForCompleteExit(operationId?: string): Promise<void> {
    if (this.mode !== 'runtime') {
      // Embedded Coder has no detached daemon. Closing the inline owner is the
      // complete shutdown operation and preserves the persisted inline policy.
      await this.close();
      return;
    }
    if (this.hasReadyRuntime()) {
      const management = await this.inspectDaemonStop();
      const runtimeId = management.runtimeId;
      const daemonPid = management.owner.pid;
      try {
        await this.prepareInlineRollbackFromManagement(management, operationId);
      } catch (error) {
        // The daemon can finish stopping while the short-lived owner-policy
        // coordination lock prevents Space from acquiring the replacement
        // inline fence. completeInlineRollbackOwnerTransition() compensates by
        // restoring an unowned daemon policy, then rethrows the original fence
        // error because embedded-mode switching still requires inline
        // ownership. Complete exit has a different terminal condition: once
        // that compensated state is authoritatively verified, no second quit
        // request is necessary.
        if (!this.rollbackInProgress && this.state === 'closed') {
          try {
            // Compensation restores daemon policy without retaining a fence.
            // Reacquire inline ownership before waiting for the old PID; owner
            // snapshots alone cannot exclude a replacement daemon.
            await this.acquireCompensatedCompleteExitFence();
          } catch (verificationError) {
            const errors = [error, verificationError];
            const message =
              'Coder daemon stopped, but the recovered owner state could not be verified for complete exit.';
            if (isCoderOwnerRecoveryRestartRequired(verificationError)) {
              throw createCoderOwnerRecoveryRestartError(errors, message);
            }
            throw new AggregateError(errors, message);
          }
        } else {
          if (!isDaemonStopTransportClosure(error)) throw error;

          // A successful rollback stops the daemon that carries its own RPC
          // response. On some transports the close can win that final response,
          // leaving the client with only an ambiguous transport error. Never infer
          // success from the error: re-establish the transition guard and prove the
          // exact daemon owner was released before continuing.
          this.rollbackInProgress = true;
          try {
            await this.completeInlineRollbackOwnerTransition(runtimeId);
          } catch (reconciliationError) {
            const errors = [error, reconciliationError];
            const message =
              'Coder daemon transport closed before rollback confirmation, and owner release could not be verified.';
            if (isCoderOwnerRecoveryRestartRequired(reconciliationError)) {
              throw createCoderOwnerRecoveryRestartError(errors, message);
            }
            throw new AggregateError(errors, message);
          }
        }
      }
      try {
        await this.assertDaemonProcessExited(daemonPid);
      } catch (error) {
        try {
          await this.restoreDaemonOwner();
        } catch (restoreError) {
          const errors = [error, restoreError];
          const message =
            'Coder daemon process exit was not confirmed, and daemon owner policy recovery failed.';
          if (isCoderOwnerRecoveryRestartRequired(restoreError)) {
            throw createCoderOwnerRecoveryRestartError(errors, message);
          }
          throw new AggregateError(errors, message);
        }
        throw error;
      }
      await this.restoreDaemonOwner();
      await this.assertUnownedDaemonPolicy();
      return;
    }
    if (this.state === 'initializing' || this.initializePromise !== null) {
      throw new Error('Wait for Coder initialization to settle before complete exit.');
    }

    const stopped = await this.idleDaemonStop();
    if (!stopped.stopped && stopped.reason !== 'missing') {
      throw new Error(
        stopped.message ??
          `Coder daemon shutdown could not be confirmed (${stopped.reason ?? 'unknown reason'}).`,
      );
    }

    let ownerState = await this.ownerControl.getState({
      ...this.runtimeOwnerTarget(),
    });
    if (ownerState.ownerStatus === 'owned') {
      if (!stopped.stopped) {
        throw new Error(
          'Coder daemon CLI state is missing, but the Coder owner is still active; shutdown could not be confirmed.',
        );
      }
      ownerState = await this.waitForAnyDaemonOwnerRelease();
    }
    if (ownerState.ownerStatus !== 'unowned') {
      throw new Error('Coder owner state is unreadable; shutdown could not be confirmed.');
    }
    if (ownerState.policy.mode !== 'daemon') {
      await this.ownerControl.enableDaemon({
        ...this.runtimeOwnerTarget(),
      });
    }
    await this.assertUnownedDaemonPolicy();
    await this.close();
  }

  async prepareEmbeddedRestart(operationId?: string): Promise<void> {
    if (this.mode !== 'runtime') {
      throw new Error('Embedded restart preparation requires the daemon Coder host.');
    }
    if (this.hasReadyRuntime()) {
      await this.prepareInlineRollback(operationId);
      return;
    }
    if (this.state === 'initializing' || this.initializePromise !== null) {
      throw new Error('Wait for Coder initialization to settle before changing its runtime mode.');
    }

    const shouldResumeReconnect = this.reconnectTimer !== undefined;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = undefined;
    const previousState = this.state;
    this.rollbackInProgress = true;
    try {
      const stopped = await this.idleDaemonStop();
      if (!stopped.stopped && stopped.reason !== 'missing') {
        throw new Error(
          stopped.message ??
            `Coder daemon cannot stop safely (${stopped.reason ?? 'unknown reason'}).`,
        );
      }
      const ownerState = await this.ownerControl.getState({
        ...this.runtimeOwnerTarget(),
      });
      if (ownerState.ownerStatus !== 'unowned') {
        throw new Error(
          ownerState.ownerStatus === 'unreadable'
            ? 'Coder owner state is unreadable; refusing to enable embedded mode.'
            : 'Another Coder owner is still active; refusing to enable embedded mode.',
        );
      }
      this.inlineOwner = await this.ownerControl.acquireInline({
        ...this.runtimeOwnerTarget(),
        enableRollback: true,
      });
      this.state = 'closed';
      this.lastError = undefined;
    } catch (error) {
      let restoreError: unknown;
      try {
        // acquireInline() writes inline policy before acquiring the owner fence.
        // A failed acquisition therefore still requires an explicit daemon
        // policy compensation before Space can reopen admission.
        await this.restoreDaemonOwner();
      } catch (caught) {
        restoreError = caught;
      }
      if (restoreError === undefined) {
        this.state = previousState;
        this.lastError = sanitizeDiagnosticError(error);
        if (shouldResumeReconnect && previousState === 'uninitialized') this.scheduleReconnect();
        throw error;
      }
      this.state = 'failed';
      this.lastError =
        `${sanitizeDiagnosticError(error)}; daemon policy recovery failed: ` +
        sanitizeDiagnosticError(restoreError);
      throw createCoderOwnerRecoveryRestartError(
        [error, restoreError],
        'Space could not enter embedded mode or restore daemon owner policy.',
      );
    }
  }

  async prepareDaemonRestart(): Promise<RuntimeOwnerPolicyState> {
    if (this.mode !== 'legacy') {
      throw new Error('Daemon restart preparation requires the embedded Coder owner.');
    }
    if (this.state === 'initializing') {
      throw new Error('Wait for Coder initialization to settle before changing its runtime mode.');
    }
    const recoveringFailedUnownedOwner = this.state === 'failed' && this.inlineOwner === undefined;
    if (!this.hasLegacyOwner() && !recoveringFailedUnownedOwner) {
      throw new Error('Daemon restart preparation requires the embedded Coder owner.');
    }
    if (recoveringFailedUnownedOwner) {
      const ownerState = await this.ownerControl.getState({
        ...this.runtimeOwnerTarget(),
      });
      if (ownerState.ownerStatus !== 'unowned') {
        throw new Error(
          ownerState.ownerStatus === 'unreadable'
            ? 'Coder owner state is unreadable; refusing to enable daemon mode.'
            : 'Another Coder owner is still active; refusing to enable daemon mode.',
        );
      }
    }
    this.rollbackInProgress = true;
    const inlineOwner = this.inlineOwner;
    this.inlineOwner = undefined;
    try {
      inlineOwner?.close();
      const policy = await this.ownerControl.enableDaemon({
        ...this.runtimeOwnerTarget(),
      });
      this.state = 'closed';
      this.lastError = undefined;
      return policy;
    } catch (error) {
      this.lastError = sanitizeDiagnosticError(error);
      try {
        this.inlineOwner = await this.ownerControl.acquireInline({
          ...this.runtimeOwnerTarget(),
          enableRollback: true,
        });
        this.state = 'legacy';
        this.rollbackInProgress = false;
      } catch (fenceError) {
        this.state = 'failed';
        this.lastError = `${this.lastError}; failed to reacquire inline owner fence: ${sanitizeDiagnosticError(fenceError)}`;
        throw createCoderOwnerRecoveryRestartError(
          [error, fenceError],
          'Space could not enable daemon mode or restore the embedded Coder owner.',
        );
      }
      throw error;
    }
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
          enableRollback: true,
        });
        this.state = 'closed';
      } catch (fenceError) {
        this.state = 'failed';
        this.lastError = `${this.lastError}; failed to reacquire inline owner fence: ${sanitizeDiagnosticError(fenceError)}`;
        throw createCoderOwnerRecoveryRestartError(
          [error, fenceError],
          'Space could not restore daemon mode or retain the embedded Coder owner; restart required.',
        );
      }
      throw createCoderOwnerRecoveryRestartError(
        [error],
        `Space could not restore daemon mode (${sanitizeDiagnosticError(error)}); restart required.`,
      );
    }
  }

  private async completeInlineRollbackOwnerTransition(runtimeId: string): Promise<void> {
    try {
      await this.waitForDaemonOwnerRelease(runtimeId);
      await this.close();
      this.inlineOwner = await this.ownerControl.acquireInline({
        ...this.runtimeOwnerTarget(),
        enableRollback: true,
      });
    } catch (error) {
      // The daemon may already have committed the stop at this point. Do not
      // leave the profile stranded in inline policy just because Space failed
      // to finish closing its Runtime connection or acquire the replacement
      // owner fence.
      await this.close().catch(() => undefined);
      try {
        await this.restoreDaemonOwner();
      } catch (restoreError) {
        const errors = [error, restoreError];
        const message =
          'Coder daemon stopped, but Space could not complete or recover inline rollback.';
        if (isCoderOwnerRecoveryRestartRequired(restoreError)) {
          throw createCoderOwnerRecoveryRestartError(errors, message);
        }
        throw new AggregateError(errors, message);
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

  private async waitForAnyDaemonOwnerRelease(): Promise<RuntimeOwnerState> {
    const deadline = Date.now() + 10_000;
    while (true) {
      const state = await this.ownerControl.getState({
        ...this.runtimeOwnerTarget(),
      });
      if (state.ownerStatus === 'unowned') return state;
      if (state.ownerStatus === 'unreadable') {
        throw new Error('Coder owner state became unreadable during complete exit.');
      }
      if (Date.now() >= deadline) {
        throw new Error('Timed out waiting for the Coder daemon owner to release.');
      }
      await new Promise<void>((resolve) => setTimeout(resolve, 25));
    }
  }

  private async acquireCompensatedCompleteExitFence(): Promise<void> {
    await this.assertUnownedDaemonPolicy();
    this.rollbackInProgress = true;
    try {
      this.inlineOwner = await this.ownerControl.acquireInline({
        ...this.runtimeOwnerTarget(),
        enableRollback: true,
      });
    } catch (error) {
      try {
        // acquireInline() can commit inline policy before fence acquisition.
        // Always compensate a failed retry before returning to the UI.
        await this.restoreDaemonOwner();
      } catch (restoreError) {
        const errors = [error, restoreError];
        const message =
          'Space could not reacquire the complete-exit owner fence or restore daemon policy.';
        if (isCoderOwnerRecoveryRestartRequired(restoreError)) {
          throw createCoderOwnerRecoveryRestartError(errors, message);
        }
        throw new AggregateError(errors, message);
      }
      throw error;
    }
  }

  private async assertDaemonProcessExited(pid: number): Promise<void> {
    if (await this.daemonProcessExitWaiter(pid, DAEMON_PROCESS_EXIT_TIMEOUT_MS)) return;
    throw new Error(
      `Coder daemon process ${pid} did not exit after its owner was released; shutdown could not be confirmed.`,
    );
  }

  private async assertUnownedDaemonPolicy(): Promise<void> {
    const state = await this.ownerControl.getState({
      ...this.runtimeOwnerTarget(),
    });
    if (state.ownerStatus !== 'unowned' || state.policy.mode !== 'daemon') {
      throw new Error(
        state.ownerStatus === 'unreadable'
          ? 'Coder owner state is unreadable after shutdown.'
          : 'Coder daemon shutdown did not leave a verified unowned daemon policy.',
      );
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
    this.stopIntegrationHealthPolling();
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = undefined;
    this.runtime = null;
    this.runtimePrincipalId = undefined;
    this.hostToolLeaseId = undefined;
    this.hostToolLeaseIds.clear();
    this.spaceOwnedRunIds.clear();
    this.spaceOwnedAgentTurns.clear();
    this.activeRuns.clear();
    this.runProviders.clear();
    this.projectedCompactionEntries.clear();
    this.projectedCompactionEvents.clear();
    this.resolvedCompactionEvents.clear();
    this.compactionProjectionTasks.clear();
    this.activeCompactionsBySession.clear();
    this.localCompactionCallsBySession.clear();
    this.nextUserOrdinalByTurnId.clear();
    this.terminalSidecarBlockRuns.clear();
    this.continuationCredentialLeases.clear();
    this.credentialLeases.clear();
    this.continuationPrompts.clear();
    this.profileCursors.clear();
    this.persistedOwnershipTokens.clear();
    this.runtimeCoderSessionIds.clear();
    this.liveProjectionRevisions.clear();
    this.runtimeProfileSnapshotPromise = null;
    this.stopAllActorObservations();
    for (const state of this.observations.values()) state.observation.close();
    this.observations.clear();
    this.observationPromises.clear();
    this.transcriptPromises.clear();
    this.conversationPromises.clear();
    this.transcriptGenerations.clear();
    this.desiredObservations.clear();
    this.runtimeReadyObservers.clear();
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
