// Session IPC handlers — F003
//
// 5 个 invoke channel 全部委托给 kodaxHost 单例处理。
// 所有 handler 在 registerChannel 内被 zod 包装（入参/出参/异常三路 envelope）。

import { registerChannel } from './register.js';
import { validateProjectRoot } from './validate.js';
import {
  kodaxHost,
  modelBelongsToProvider,
  providerDescriptor,
  providerIsConfigured,
} from '../kodax/host.js';
import { projectStore } from '../projects/store.js';

// v0.1.5: canonProjectRoot 抽到 schema 包共享 util（renderer + main 同一实现），
// 修 F040/F041 review MED-3 的 normalize 不一致。
// IS_WIN 在 main 侧用 process.platform；renderer 同名函数用 navigator.userAgent。
import { canonProjectRoot as canonProjectRootShared } from '@kodax-space/space-ipc-schema';
const IS_WIN_MAIN = process.platform === 'win32';
function canonProjectRoot(p: string): string {
  return canonProjectRootShared(p, IS_WIN_MAIN);
}

export function assertSessionSendScope(
  session: {
    readonly sessionId: string;
    readonly projectRoot: string;
    readonly surface?: SessionMeta['surface'];
  },
  expected: {
    readonly expectedProjectRoot?: string;
    readonly expectedSurface?: SessionMeta['surface'];
  },
): void {
  if (
    expected.expectedProjectRoot !== undefined &&
    canonProjectRoot(session.projectRoot) !== canonProjectRoot(expected.expectedProjectRoot)
  ) {
    throw new Error(
      `session/project mismatch: session ${session.sessionId} is scoped to ${session.projectRoot}, not ${expected.expectedProjectRoot}`,
    );
  }

  const actualSurface = session.surface ?? 'code';
  if (expected.expectedSurface !== undefined && actualSurface !== expected.expectedSurface) {
    throw new Error(
      `session/surface mismatch: session ${session.sessionId} is scoped to ${actualSurface}, not ${expected.expectedSurface}`,
    );
  }
}
import { loadAgentsMd, type AgentsFile } from '../kodax/agents-md-loader.js';
import path from 'node:path';
import { getKodaxDir, getSpaceDataDir } from '../kodax/data-paths.js';
import {
  loadKodaxCustomProviders,
  loadKodaxUserDefaults,
  registerKodaxCustomProviders,
  type KodaxConfigCustomProvider,
} from '../kodax/user-config.js';
import { isBuiltinId } from '../providers/catalog.js';
import { providerConfigStore } from '../providers/config.js';
import {
  appendPersistedClientNotice,
  loadPersistedConversationHistory,
  loadPersistedSession,
  loadPersistedTranscript,
  sdkTagToSurface,
  type PersistedConversationHistoryData,
} from '../kodax/session-store.js';
import {
  runtimeHostAdapter,
  type RuntimeConversationHistoryPage,
} from '../kodax/runtime-host-adapter.js';
import type { RuntimeConversationHistory } from '@kodax-ai/kodax/runtime';
import { generateKodaxSessionId } from '../kodax/session-id.js';
import { runtimeProjectionController } from '../kodax/runtime/runtime-projection-controller.js';
import { runWithCoderAdmission } from '../kodax/coder-runtime-mode-switch.js';
import { partnerSourceStore } from '../kodax/partner-source-store.js';
import { parseTaskCompletedBlocks, selectWorkflowBlocks } from './workflow-result-notice.js';
import { dedupeTranscriptEntries } from './transcript-dedup.js';
import { limitSessionHistoryWithLocalNotices, pageSessionHistoryItems } from './history-window.js';
import { resolveRuntimeDefaults } from '../kodax/runtime-defaults.js';
import { getSessionRuntimeStore } from '../kodax/session-runtime-store.js';
import {
  appendSpaceOwnedLocalNotice,
  getSessionLocalNoticeStore,
} from '../kodax/session-local-notice-store.js';
import {
  assertArtifactPathInClipboardSandbox,
  finalizePendingClipboardArtifacts,
  prepareClipboardArtifactsForSend,
} from './clipboard.js';
import { clearSlashGoalForSession } from '../slash/builtin.js';
import { ensureProviderKeyInjected } from './provider.js';
import { buildAttachmentPathOverlay } from '../kodax/attachment-path-overlay.js';
import { issueSessionImageAttachment } from '../window/session-attachment-protocol.js';
import type {
  AgentsFileMeta,
  InputArtifact,
  SessionHistoryItem,
  SessionMeta,
} from '@kodax-space/space-ipc-schema';

type ConversationHistoryData = RuntimeConversationHistory | PersistedConversationHistoryData;

interface IndexedConversationEntry {
  readonly index: number;
  readonly entry: ConversationHistoryData['entries'][number];
}

type ConversationTurnBoundary = {
  readonly boundaryId: string;
  readonly sourceRevision: string;
};

interface RuntimeConversationWindow {
  readonly revision: string;
  readonly sourceRevision: string;
  readonly status: RuntimeConversationHistory['status'];
  readonly issues: RuntimeConversationHistory['issues'];
  readonly entriesByIndex: Map<number, RuntimeConversationHistory['entries'][number]>;
  /** Tool results from the immediately newer SDK page that close tool uses in this page. */
  seamToolResults: Map<string, { readonly content: string; readonly isError: boolean }>;
  /** Exact turn ends that cross from this SDK page into one or more already-loaded newer pages. */
  seamTurnBoundaries: Map<number, ConversationTurnBoundary>;
  /**
   * Exact final boundary before the first visible user in this page and every already-loaded
   * newer page. A single visible turn can have a tail spanning more than two SDK pages, while
   * the resident browsing window intentionally retains only one page at a time.
   */
  newerPrefixTurnBoundary?: ConversationTurnBoundary;
  entryBytes: number;
  /** True only after advancing to an older SDK page, never for a slice of this same page. */
  newerSdkPageOmitted: boolean;
  prefixOmitted: boolean;
  hasMore: boolean;
  nextCursor?: string;
  projectionContinuation?: {
    readonly cursor: string;
    readonly endExclusive: number;
    readonly itemCount: number;
  };
}

const RUNTIME_HISTORY_PAGE_LIMIT = 64;
const MAX_RUNTIME_HISTORY_WINDOWS = 16;
const MAX_RUNTIME_HISTORY_WINDOW_ENTRIES = 2_000;
const MAX_RUNTIME_HISTORY_PAGE_BYTES = 32 * 1024 * 1024;
const MAX_RUNTIME_HISTORY_WINDOW_BYTES = 64 * 1024 * 1024;
const runtimeConversationWindows = new Map<string, RuntimeConversationWindow>();
let runtimeProjectionCursorCounter = 0;

function nextRuntimeProjectionCursor(sessionId: string): string {
  runtimeProjectionCursorCounter += 1;
  return `space-projection:${runtimeProjectionCursorCounter}:${sessionId}`;
}

function rememberRuntimeConversationWindow(
  sessionId: string,
  window: RuntimeConversationWindow,
): void {
  runtimeConversationWindows.delete(sessionId);
  runtimeConversationWindows.set(sessionId, window);
  while (runtimeConversationWindows.size > MAX_RUNTIME_HISTORY_WINDOWS) {
    const oldest = runtimeConversationWindows.keys().next().value;
    if (oldest === undefined) break;
    runtimeConversationWindows.delete(oldest);
  }
}

function assertSafePagedHistoryMutation(
  sessionId: string,
  historyBoundary: { readonly boundaryId: string; readonly sourceRevision: string } | undefined,
): void {
  const session = kodaxHost.get(sessionId);
  if (session?.surface === 'code' && historyBoundary === undefined) {
    throw new Error(
      'An exact persisted history boundary is required for a Runtime-backed Session mutation.',
    );
  }
}

export async function truncateLocalNoticesAfterSuccessfulRewind(
  input: { readonly sessionId: string; readonly localNoticeCutoffSentAt?: number },
  result: { readonly ok: boolean; readonly diskRewound?: boolean },
  store: Pick<
    ReturnType<typeof getSessionLocalNoticeStore>,
    'truncateBefore'
  > = getSessionLocalNoticeStore(),
): Promise<void> {
  if (result.ok && result.diskRewound === true && input.localNoticeCutoffSentAt !== undefined) {
    await store.truncateBefore(input.sessionId, input.localNoticeCutoffSentAt);
  }
}

function isVisibleConversationUserMessage(message: unknown): boolean {
  if (!isRecord(message) || message.role !== 'user') return false;
  const source = message.source ?? message._source;
  if (source === 'sidecar-verifier') return false;
  if (message.synthetic === true || message._synthetic === true) return false;
  return (
    extractUserText(message.content).length > 0 || extractUserImages(message.content).length > 0
  );
}

function conversationTurnBoundaries(
  entries: readonly IndexedConversationEntry[],
  sourceRevision: string,
  includeFinalBoundary = true,
): ReadonlyMap<number, { readonly boundaryId: string; readonly sourceRevision: string }> {
  const boundaries = new Map<
    number,
    { readonly boundaryId: string; readonly sourceRevision: string }
  >();
  let currentUserIndex: number | undefined;
  let currentBoundaryId: string | undefined;
  const commit = (): void => {
    if (currentUserIndex !== undefined && currentBoundaryId !== undefined) {
      boundaries.set(currentUserIndex, { boundaryId: currentBoundaryId, sourceRevision });
    }
  };
  for (const indexed of entries) {
    if (isVisibleConversationUserMessage(indexed.entry.message)) {
      commit();
      currentUserIndex = indexed.index;
      currentBoundaryId = indexed.entry.boundaryId;
      continue;
    }
    if (currentUserIndex !== undefined) currentBoundaryId = indexed.entry.boundaryId;
  }
  if (includeFinalBoundary) commit();
  return boundaries;
}

export function conversationHistoryAsTranscript(
  history: ConversationHistoryData,
  indexedEntries: readonly IndexedConversationEntry[] = history.entries.map((entry, index) => ({
    index,
    entry,
  })),
  boundaryEntries: readonly IndexedConversationEntry[] = indexedEntries,
  includeFinalBoundary = true,
  additionalTurnBoundaries: ReadonlyMap<
    number,
    { readonly boundaryId: string; readonly sourceRevision: string }
  > = new Map(),
) {
  const turnBoundaries = new Map(
    conversationTurnBoundaries(boundaryEntries, history.sourceRevision, includeFinalBoundary),
  );
  for (const [canonicalIndex, boundary] of additionalTurnBoundaries) {
    turnBoundaries.set(canonicalIndex, boundary);
  }
  const transcriptEntries = indexedEntries.map(({ entry, index: canonicalIndex }) => {
    const messageRecord = isRecord(entry.message) ? entry.message : undefined;
    const entryId = entry.boundaryId ?? entry.auditEntryIds[0];
    return {
      ...(entryId !== undefined ? { entryId } : {}),
      ...(entry.boundaryId !== undefined ? { logicalId: entry.boundaryId } : {}),
      canonicalIndex,
      type: 'message' as const,
      message: entry.message,
      ...(messageRecord?.timestamp !== undefined ? { timestamp: messageRecord.timestamp } : {}),
      ...(messageRecord?.turnId !== undefined ? { turnId: messageRecord.turnId } : {}),
      ...(turnBoundaries.has(canonicalIndex)
        ? { historyBoundary: turnBoundaries.get(canonicalIndex)! }
        : {}),
      active: true,
    };
  });
  return {
    messages: transcriptEntries.map((entry) => entry.message),
    activeMessages: transcriptEntries.map((entry) => entry.message),
    transcriptEntries,
  };
}

function runtimeWindowMatchesPage(
  window: RuntimeConversationWindow,
  page: RuntimeConversationHistoryPage,
): boolean {
  return (
    window.revision === page.revision &&
    window.sourceRevision === page.sourceRevision &&
    window.status === page.status &&
    window.issues.length === page.issues.length &&
    window.issues.every((issue, index) => {
      const candidate = page.issues[index];
      return (
        candidate !== undefined &&
        issue.code === candidate.code &&
        issue.message === candidate.message &&
        issue.occurrenceCount === candidate.occurrenceCount &&
        issue.entryCount === candidate.entryCount &&
        issue.entryIds.length === candidate.entryIds.length &&
        issue.entryIds.every((entryId, entryIndex) => entryId === candidate.entryIds[entryIndex])
      );
    })
  );
}

function conversationHistoryDiagnostic(history: ConversationHistoryData) {
  return {
    status: history.status,
    sourceRevision: history.sourceRevision,
    issues: history.issues.map((issue) => ({
      code: issue.code,
      occurrenceCount: issue.occurrenceCount,
      entryCount: issue.entryCount,
    })),
  };
}

type RuntimeConversationWindowResult =
  | {
      readonly outcome: 'ready';
      readonly window: RuntimeConversationWindow | null;
      readonly projectionEndExclusive?: number;
      readonly projectionItemCount?: number;
    }
  | { readonly outcome: 'data_changed' };

interface RuntimePresentationContinuationState {
  projectionContinuation?: {
    readonly cursor: string;
    readonly endExclusive: number;
    readonly itemCount: number;
  };
}

/** Consume an older presentation slice without changing which SDK pages the window represents. */
export function consumeRuntimePresentationContinuation(
  state: RuntimePresentationContinuationState,
  cursor: string,
): { readonly endExclusive: number; readonly itemCount: number } | null {
  if (state.projectionContinuation?.cursor !== cursor) return null;
  const continuation = state.projectionContinuation;
  state.projectionContinuation = undefined;
  return {
    endExclusive: continuation.endExclusive,
    itemCount: continuation.itemCount,
  };
}

export function collectCrossPageToolResults(
  olderMessages: readonly unknown[],
  newerMessages: readonly unknown[],
): Map<string, { readonly content: string; readonly isError: boolean }> {
  const toolUseIds = new Set<string>();
  for (const message of olderMessages) {
    if (!isRecord(message) || !Array.isArray(message.content)) continue;
    for (const block of message.content) {
      if (!isRecord(block) || block.type !== 'tool_use') continue;
      const id = stringField(block.id);
      if (id !== undefined) toolUseIds.add(id);
    }
  }
  const results = new Map<string, { readonly content: string; readonly isError: boolean }>();
  if (toolUseIds.size === 0) return results;
  for (const message of newerMessages) {
    if (!isRecord(message) || !Array.isArray(message.content)) continue;
    for (const block of message.content) {
      if (!isRecord(block) || block.type !== 'tool_result') continue;
      const id = stringField(block.tool_use_id);
      if (id === undefined || !toolUseIds.has(id)) continue;
      results.set(id, {
        content: flattenToolResultContent(block.content),
        isError: block.is_error === true,
      });
    }
  }
  return results;
}

/**
 * Preserve the exact end of the last visible turn in an older SDK page when that turn's
 * assistant/tool tail continues into one or more newer pages. Every page has already passed the
 * immutable revision/sourceRevision check before this helper is used. The first visible user in
 * the newer history starts another turn and is therefore never consumed as part of this boundary.
 */
export function collectCrossPageTurnBoundaries(
  olderEntries: readonly IndexedConversationEntry[],
  newerEntries: readonly IndexedConversationEntry[],
  sourceRevision: string,
  continuedNewerPrefixBoundary?: ConversationTurnBoundary,
): Map<number, ConversationTurnBoundary> {
  let finalUserIndex: number | undefined;
  let finalBoundaryId: string | undefined;
  for (const indexed of olderEntries) {
    if (isVisibleConversationUserMessage(indexed.entry.message)) {
      finalUserIndex = indexed.index;
      finalBoundaryId = indexed.entry.boundaryId;
    } else if (finalUserIndex !== undefined) {
      finalBoundaryId = indexed.entry.boundaryId;
    }
  }
  if (finalUserIndex === undefined) return new Map();

  let reachedNewerVisibleUser = false;
  for (const indexed of newerEntries) {
    if (isVisibleConversationUserMessage(indexed.entry.message)) {
      reachedNewerVisibleUser = true;
      break;
    }
    finalBoundaryId = indexed.entry.boundaryId;
  }
  if (!reachedNewerVisibleUser && continuedNewerPrefixBoundary !== undefined) {
    if (continuedNewerPrefixBoundary.sourceRevision !== sourceRevision) {
      throw new Error('Conversation history turn boundary crossed its immutable source revision.');
    }
    finalBoundaryId = continuedNewerPrefixBoundary.boundaryId;
  }
  return finalBoundaryId === undefined
    ? new Map()
    : new Map([[finalUserIndex, { boundaryId: finalBoundaryId, sourceRevision }]]);
}

/**
 * Carry the exact tail of a turn through any number of one-page resident history windows.
 * Entries are ordered oldest-to-newest. Once a visible user is reached, the preceding boundary
 * is final; when no user is present, a farther-newer page owns the final boundary if supplied.
 */
export function collectLeadingTurnTailBoundary(
  entries: readonly IndexedConversationEntry[],
  sourceRevision: string,
  continuedNewerPrefixBoundary?: ConversationTurnBoundary,
): ConversationTurnBoundary | undefined {
  let boundaryId: string | undefined;
  for (const indexed of entries) {
    if (isVisibleConversationUserMessage(indexed.entry.message)) {
      return boundaryId === undefined ? undefined : { boundaryId, sourceRevision };
    }
    boundaryId = indexed.entry.boundaryId;
  }
  if (continuedNewerPrefixBoundary !== undefined) {
    if (continuedNewerPrefixBoundary.sourceRevision !== sourceRevision) {
      throw new Error('Conversation history turn boundary crossed its immutable source revision.');
    }
    return continuedNewerPrefixBoundary;
  }
  return boundaryId === undefined ? undefined : { boundaryId, sourceRevision };
}

function conversationTurnBoundaryBytes(boundary: ConversationTurnBoundary | undefined): number {
  return boundary === undefined
    ? 0
    : Buffer.byteLength(boundary.boundaryId, 'utf8') +
        Buffer.byteLength(boundary.sourceRevision, 'utf8');
}

function appendRuntimeConversationPage(
  window: RuntimeConversationWindow,
  page: RuntimeConversationHistoryPage,
): void {
  if (!runtimeWindowMatchesPage(window, page)) {
    throw new Error('Conversation history continuation crossed its immutable boundary.');
  }
  const currentIndexes = [...window.entriesByIndex.keys()].sort((a, b) => a - b);
  if (currentIndexes.length > 0 && page.entries.length > 0) {
    const expectedNewestOlderIndex = currentIndexes[0]! - 1;
    const actualNewestOlderIndex = page.entries[page.entries.length - 1]!.index;
    if (actualNewestOlderIndex !== expectedNewestOlderIndex) {
      throw new Error('Conversation history continuation is not contiguous with the loaded tail.');
    }
  }
  const pageBytes = page.entries.reduce(
    (total, indexed) => total + Buffer.byteLength(JSON.stringify(indexed.entry), 'utf8'),
    0,
  );
  if (
    page.entries.length > MAX_RUNTIME_HISTORY_WINDOW_ENTRIES ||
    pageBytes > MAX_RUNTIME_HISTORY_PAGE_BYTES
  ) {
    throw new Error('Conversation history page exceeds the bounded resident window.');
  }
  const seamToolResults = collectCrossPageToolResults(
    page.entries.map(({ entry }) => entry.message),
    [...window.entriesByIndex.values()].map((entry) => entry.message),
  );
  const newerEntries = [...window.entriesByIndex.entries()]
    .sort(([left], [right]) => left - right)
    .map(([index, entry]) => ({ index, entry }));
  const continuedNewerPrefixBoundary = window.newerPrefixTurnBoundary;
  const seamTurnBoundaries = collectCrossPageTurnBoundaries(
    page.entries,
    newerEntries,
    window.sourceRevision,
    continuedNewerPrefixBoundary,
  );
  const newerPrefixTurnBoundary = collectLeadingTurnTailBoundary(
    page.entries,
    window.sourceRevision,
    continuedNewerPrefixBoundary,
  );
  const seamToolResultBytes = [...seamToolResults.entries()].reduce(
    (total, [id, result]) =>
      total + Buffer.byteLength(id, 'utf8') + Buffer.byteLength(result.content, 'utf8') + 1,
    0,
  );
  const seamTurnBoundaryBytes = [...seamTurnBoundaries.values()].reduce(
    (total, boundary) => total + conversationTurnBoundaryBytes(boundary),
    0,
  );
  const seamBytes =
    seamToolResultBytes +
    seamTurnBoundaryBytes +
    conversationTurnBoundaryBytes(newerPrefixTurnBoundary);
  if (pageBytes + seamBytes > MAX_RUNTIME_HISTORY_WINDOW_BYTES) {
    throw new Error('Conversation history page seam exceeds the bounded resident window.');
  }
  if (window.entriesByIndex.size > 0) {
    // Each SDK continuation becomes its own bounded browsing window. Keeping page generations
    // separate avoids retaining an ever-growing prefix and gives renderer navigation an explicit
    // no-overlap boundary instead of silently evicting arbitrary accumulated rows.
    window.entriesByIndex.clear();
    window.entryBytes = 0;
    window.newerSdkPageOmitted = true;
  }
  window.projectionContinuation = undefined;
  window.seamToolResults = seamToolResults;
  window.seamTurnBoundaries = seamTurnBoundaries;
  if (newerPrefixTurnBoundary === undefined) delete window.newerPrefixTurnBoundary;
  else window.newerPrefixTurnBoundary = newerPrefixTurnBoundary;
  for (const indexed of page.entries) {
    if (window.entriesByIndex.has(indexed.index)) {
      throw new Error(`Conversation history continuation repeated index ${indexed.index}.`);
    }
    window.entriesByIndex.set(indexed.index, indexed.entry);
  }
  window.entryBytes += pageBytes + seamBytes;
  window.prefixOmitted = page.hasMore;
  window.hasMore = page.hasMore;
  window.nextCursor = window.hasMore ? page.nextCursor : undefined;
}

async function loadRuntimeConversationWindow(input: {
  readonly sessionId: string;
  readonly cursor?: string;
  readonly revision?: string;
  readonly sourceRevision?: string;
}): Promise<RuntimeConversationWindowResult> {
  const isContinuation = input.cursor !== undefined;
  let window = runtimeConversationWindows.get(input.sessionId);
  if (isContinuation) {
    if (
      window === undefined ||
      input.revision !== window.revision ||
      input.sourceRevision !== window.sourceRevision
    ) {
      runtimeConversationWindows.delete(input.sessionId);
      return { outcome: 'data_changed' };
    }
    const presentationContinuation = consumeRuntimePresentationContinuation(window, input.cursor);
    if (presentationContinuation !== null) {
      rememberRuntimeConversationWindow(input.sessionId, window);
      return {
        outcome: 'ready',
        window,
        projectionEndExclusive: presentationContinuation.endExclusive,
        projectionItemCount: presentationContinuation.itemCount,
      };
    }
    if (window.nextCursor !== input.cursor) {
      runtimeConversationWindows.delete(input.sessionId);
      return { outcome: 'data_changed' };
    }
  } else {
    runtimeConversationWindows.delete(input.sessionId);
    window = undefined;
  }

  const result = await runtimeHostAdapter.conversationHistoryPage({
    sessionId: input.sessionId,
    ...(input.cursor !== undefined ? { cursor: input.cursor } : {}),
    ...(window !== undefined
      ? { revision: window.revision, sourceRevision: window.sourceRevision }
      : {}),
    limit: RUNTIME_HISTORY_PAGE_LIMIT,
  });
  if (result.outcome === 'data_changed') {
    runtimeConversationWindows.delete(input.sessionId);
    return result;
  }
  const page = result.page;
  if (page === null) {
    runtimeConversationWindows.delete(input.sessionId);
    return { outcome: 'ready', window: null };
  }
  if (window === undefined) {
    const pageBytes = page.entries.reduce(
      (total, indexed) => total + Buffer.byteLength(JSON.stringify(indexed.entry), 'utf8'),
      0,
    );
    if (
      page.entries.length > MAX_RUNTIME_HISTORY_WINDOW_ENTRIES ||
      pageBytes > MAX_RUNTIME_HISTORY_PAGE_BYTES
    ) {
      throw new Error('Conversation history page exceeds the bounded resident window.');
    }
    const newerPrefixTurnBoundary = collectLeadingTurnTailBoundary(
      page.entries,
      page.sourceRevision,
    );
    window = {
      revision: page.revision,
      sourceRevision: page.sourceRevision,
      status: page.status,
      issues: page.issues,
      entriesByIndex: new Map(),
      seamToolResults: new Map(),
      seamTurnBoundaries: new Map(),
      ...(newerPrefixTurnBoundary !== undefined ? { newerPrefixTurnBoundary } : {}),
      entryBytes: pageBytes + conversationTurnBoundaryBytes(newerPrefixTurnBoundary),
      newerSdkPageOmitted: false,
      prefixOmitted: page.hasMore,
      hasMore: page.hasMore,
      ...(page.nextCursor !== undefined ? { nextCursor: page.nextCursor } : {}),
    };
    for (const indexed of page.entries) window.entriesByIndex.set(indexed.index, indexed.entry);
  } else {
    appendRuntimeConversationPage(window, page);
  }
  rememberRuntimeConversationWindow(input.sessionId, window);
  return { outcome: 'ready', window };
}

export function resolveHistoricalRuntimeIdentity(input: {
  readonly persisted?: { readonly provider?: string; readonly model?: string };
  readonly fallbackProvider: string;
  readonly fallbackModel?: string;
  readonly kodaxCustomProviders?: readonly KodaxConfigCustomProvider[];
}): {
  readonly provider: string;
  readonly model?: string;
  readonly runtimeMetadataSource: 'persisted' | 'current-default-fallback';
} {
  const customProviders = input.kodaxCustomProviders ?? [];
  const persistedProvider = input.persisted?.provider;
  const providerIsValid =
    persistedProvider !== undefined && providerIsConfigured(persistedProvider, customProviders);
  const provider = providerIsValid ? persistedProvider : input.fallbackProvider;
  const requestedModel = providerIsValid
    ? (input.persisted?.model ?? providerDescriptor(provider, customProviders)?.defaultModel)
    : input.fallbackModel;
  const model =
    requestedModel && modelBelongsToProvider(provider, requestedModel, customProviders)
      ? requestedModel
      : undefined;
  const exact =
    providerIsValid &&
    (provider === 'mock' ||
      (input.persisted?.model !== undefined && model === input.persisted.model));
  return {
    provider,
    ...(model !== undefined ? { model } : {}),
    runtimeMetadataSource: exact ? 'persisted' : 'current-default-fallback',
  };
}

export interface SessionDeleteOperations {
  readonly deleteSession: (sessionId: string) => Promise<boolean>;
  readonly clearGoal: (sessionId: string) => void;
  readonly deleteRuntime: (sessionId: string) => Promise<void>;
  readonly deleteLocalNotices: (sessionId: string) => Promise<void>;
}

export async function deleteSessionForIpc(
  sessionId: string,
  operations: SessionDeleteOperations = {
    deleteSession: (id) => kodaxHost.delete(id),
    clearGoal: clearSlashGoalForSession,
    deleteRuntime: (id) => getSessionRuntimeStore().delete(id),
    deleteLocalNotices: (id) => getSessionLocalNoticeStore().delete(id),
  },
): Promise<{ deleted: boolean; reason?: 'session_running' }> {
  const deleted = await operations.deleteSession(sessionId);
  if (!deleted) return { deleted: false, reason: 'session_running' };
  operations.clearGoal(sessionId);
  await operations.deleteRuntime(sessionId);
  await operations.deleteLocalNotices(sessionId);
  return { deleted: true };
}

async function commitRuntimeMutationForIpc(
  sessionId: string,
  mutate: () => boolean,
): Promise<boolean> {
  const result = await kodaxHost.commitRuntimeMutation(sessionId, mutate);
  if (result === 'persist-failed') {
    throw new Error(
      `session runtime metadata could not be persisted; change was rolled back: ${sessionId}`,
    );
  }
  return result === 'ok';
}

// SDK lazy + cached import — 跟其他 SDK 接入点 (agent.ts, queue.ts, catalog.ts) 同模式。
// listRunningSessions handler 用; main 是 CJS,SDK subpath 是 ESM-only,必须动态 import 一次,
// 之后 module cache 直接返回 (审查 Batch 4 M1 consistency)。
type SdkSessionModule = typeof import('@kodax-ai/kodax/session');
let sdkSessionCache: SdkSessionModule | null = null;
async function loadSdkSessionCached(): Promise<SdkSessionModule> {
  if (sdkSessionCache === null) {
    sdkSessionCache = await import('@kodax-ai/kodax/session');
  }
  return sdkSessionCache;
}

type SdkMediaModule = Pick<
  typeof import('@kodax-ai/kodax/media'),
  'validateInputArtifactsForModel'
>;
let sdkMediaCache: SdkMediaModule | null = null;
async function loadSdkMediaCached(): Promise<SdkMediaModule> {
  if (sdkMediaCache === null) {
    sdkMediaCache = await import('@kodax-ai/kodax/media');
  }
  return sdkMediaCache;
}

async function validateInputArtifactsForSession(
  artifacts: readonly InputArtifact[] | undefined,
  session: { readonly provider: string; readonly model?: string },
): Promise<void> {
  if (!artifacts || artifacts.length === 0) return;
  // KODAX_FORCE_MOCK never dispatches to the selected provider/model. Let the
  // offline adapter consume attachments so E2E and local mock workflows can
  // exercise promotion, durable preview capabilities, and history restoration.
  // Real sessions still require the SDK capability preflight below.
  if (process.env.KODAX_FORCE_MOCK === '1') return;
  const sdk = await loadSdkMediaCached();
  try {
    sdk.validateInputArtifactsForModel(artifacts, {
      provider: session.provider,
      ...(session.model ? { model: session.model } : {}),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`input artifact preflight failed: ${message}`);
  }
}

// FEATURE_034 reviewer MEDIUM-2: 编译期保证 loader 的 AgentsFile 与 schema 的 AgentsFileMeta
// 结构一致——加字段、改 scope enum 等都会立即编译报错，不让 schema/loader 漂移。
// (双向 assignability：a→b 和 b→a 都必须成立，等同于结构等价。)
// 用 export 让 tsc noUnusedLocals 不报错（type-only export 不影响 runtime）
export type _AssertAgentsFileShapeEqual = AgentsFile extends AgentsFileMeta
  ? AgentsFileMeta extends AgentsFile
    ? true
    : never
  : never;

export interface SessionChannelsOptions {
  readonly beginCoderAdmission?: () => () => void;
}

/**
 * 校验 providerId 实际存在于 catalog / custom-providers / 是 'mock'。
 * review F008 C1-sec：schema 只验格式，不验存在性——必须 main 端再过一层。
 */
async function assertProviderExists(providerId: string): Promise<void> {
  if (providerId === 'mock') return;
  if (isBuiltinId(providerId)) return;
  await providerConfigStore.load();
  if (providerConfigStore.getCustom(providerId)) return;
  if ((await loadKodaxCustomProviders()).some((p) => p.id === providerId)) return;
  throw new Error('unknown providerId');
}

async function ensureCustomProviderRegistered(providerId: string): Promise<void> {
  if (providerId === 'mock' || isBuiltinId(providerId)) return;
  await providerConfigStore.load();
  await registerKodaxCustomProviders(providerConfigStore.listCustom());
}

export function registerSessionChannels(options: SessionChannelsOptions = {}): void {
  // session.create
  registerChannel('session.create', async (input) => {
    const releaseModeSwitchAdmission = options.beginCoderAdmission?.() ?? (() => undefined);
    try {
      const projectRoot = validateProjectRoot(input.projectRoot);
      await assertProviderExists(input.provider);
      await ensureCustomProviderRegistered(input.provider);
      await ensureProviderKeyInjected(input.provider);
      const kodaxCustomProviders =
        input.provider !== 'mock' && !isBuiltinId(input.provider)
          ? await loadKodaxCustomProviders()
          : [];
      const effectiveModel =
        input.model ?? providerDescriptor(input.provider, kodaxCustomProviders)?.defaultModel;
      const runtimeDefaults = await resolveRuntimeDefaults({
        explicit: {
          reasoningMode: input.reasoningMode,
          permissionMode: input.permissionMode,
          autoModeEngine: input.autoModeEngine,
          agentMode: input.agentMode,
        },
      });
      const allocatedSessionId = await generateKodaxSessionId();
      const { sessionId, createdAt } = kodaxHost.createSession({
        sessionId: allocatedSessionId,
        projectRoot,
        provider: input.provider,
        // Renderer usually supplies resolveActiveModel(), but main must still
        // materialize the provider default when callers omit an explicit override.
        ...(effectiveModel !== undefined ? { model: effectiveModel } : {}),
        reasoningMode: runtimeDefaults.reasoningMode,
        permissionMode: runtimeDefaults.permissionMode,
        autoModeEngine: runtimeDefaults.autoModeEngine,
        agentMode: runtimeDefaults.agentMode,
        // F045: 工作面（Coder / Partner）。缺省 'code'。host 落盘成 SDK session tag。
        surface: input.surface,
        ephemeral: input.ephemeral,
      });
      // v0.1.6 cleanup: 用 ~/.kodax/config.json 的 thinking 默认值初始化新 session。
      // 不传 schema 改动——renderer 没必要知道 thinking 默认值，main 直接 fill 即可。
      // model 不在这里 fill：跨 provider 切换时 KodaX config 里的 model 名通常对不上
      // 用户在 Space 选的 provider；要正确填要做 provider×model 映射，留 v0.1.7+。
      try {
        const kodaxDefaults = await loadKodaxUserDefaults();
        if (kodaxDefaults.thinking !== undefined) {
          kodaxHost.setThinking(sessionId, kodaxDefaults.thinking);
        }
      } catch (err) {
        console.warn(
          '[session.create] kodax defaults fill failed:',
          err instanceof Error ? err.message : err,
        );
      }
      if (input.ephemeral !== true && !(await kodaxHost.persistRuntime(sessionId))) {
        await kodaxHost.delete(sessionId);
        throw new Error('session runtime metadata could not be persisted');
      }
      return {
        sessionId,
        createdAt,
        reasoningMode: runtimeDefaults.reasoningMode,
        permissionMode: runtimeDefaults.permissionMode,
        autoModeEngine: runtimeDefaults.autoModeEngine,
        agentMode: runtimeDefaults.agentMode,
      };
    } finally {
      releaseModeSwitchAdmission();
    }
  });

  registerChannel('session.promoteEphemeral', (input) =>
    runWithCoderAdmission(options, async () => {
      const promoted = await kodaxHost.promoteEphemeral(input.sessionId);
      return { promoted };
    }),
  );

  // session.send
  registerChannel('session.send', async (input) => {
    const existingSession = kodaxHost.get(input.sessionId);
    const releaseModeSwitchAdmission = options.beginCoderAdmission?.() ?? (() => undefined);
    try {
      let session = existingSession;
      if (!session) {
        // Lazy resume：sessionId 不在 in-flight，但磁盘上可能 persisted —— 重启 Space
        // 后从 Recents 点击的 session 走这条路。tryResume 内部走 createSession 接管
        // 原 sessionId，SDK 按 id 自动 resume lineage。
        const resumed = await kodaxHost.tryResume(input.sessionId);
        if (!resumed) {
          throw new Error(`session not found: ${input.sessionId}`);
        }
        session = kodaxHost.get(input.sessionId);
        if (!session) {
          throw new Error(`session resume failed: ${input.sessionId}`);
        }
      }
      // 第一次 send 时自动给 session 起个临时标题（基于 prompt 头部）。
      // ensureTitle 已经在 host 里做"title === undefined 才填"的判断，重复调用安全。
      assertSessionSendScope(session, {
        expectedProjectRoot: input.expectedProjectRoot,
        expectedSurface: input.expectedSurface,
      });
      if (input.partnerPromptOverlay !== undefined && session.surface !== 'partner') {
        throw new Error('partnerPromptOverlay is only accepted for Partner sessions');
      }
      if (input.partnerRetrievalScope !== undefined) {
        if (session.surface !== 'partner') {
          throw new Error('partnerRetrievalScope is only accepted for Partner sessions');
        }
        await partnerSourceStore.setScope(
          input.sessionId,
          session.projectRoot,
          input.partnerRetrievalScope,
        );
      }
      kodaxHost.ensureTitle(input.sessionId, input.prompt);
      // send 是 fire-and-forget——立刻 ACK，事件流通过 push 推
      // send() returns { queued, queueId?, queueMode? }. If the turn is running,
      // Real adapter accepts the prompt into the requested queue mode so the UI
      // can show a queued acknowledgement instead of a HANDLER_ERROR.
      // OC-31 v0.1.9: input.artifacts (image paste / drag-drop) 透传给 session.send，
      // real-session 把它塞进 KodaXOptions.context.inputArtifacts → SDK 拼 multimodal content。
      //
      // review HIGH-2 fix: renderer 可能传任意 path 进 artifacts (eg /etc/passwd) 让 SDK
      // 把任意文件读进 multimodal content 发给 LLM。这里在调 session.send 前对每个 artifact
      // path 做沙箱校验——必须落在持久 Session attachment 目录或兼容的旧版临时
      // clipboard 目录之内，且 sid 等于本次 send 的 sessionId (不许跨 session 引用图)。
      if (input.artifacts && input.artifacts.length > 0) {
        for (const a of input.artifacts) {
          await assertArtifactPathInClipboardSandbox(input.sessionId, a.path);
        }
      }
      if (input.attachmentPaths) {
        for (const attachment of input.attachmentPaths) {
          if (!path.isAbsolute(attachment.path)) {
            throw new Error(`attachment path must be absolute: ${attachment.path}`);
          }
        }
      }
      await ensureProviderKeyInjected(session.provider);
      await validateInputArtifactsForSession(input.artifacts, session);
      const preparedArtifacts =
        input.artifacts && input.artifacts.length > 0
          ? await prepareClipboardArtifactsForSend(input.sessionId, input.artifacts)
          : undefined;
      const attachmentPathOverlay = buildAttachmentPathOverlay(input.attachmentPaths);
      const promptOverlay = [input.partnerPromptOverlay, attachmentPathOverlay]
        .filter((part): part is string => part !== undefined)
        .join('\n\n');
      const result = await session.send(input.prompt, preparedArtifacts, {
        queueMode: input.queueMode,
        ...(promptOverlay ? { promptOverlay } : {}),
      });
      if (input.artifacts && input.artifacts.length > 0) {
        await finalizePendingClipboardArtifacts(input.sessionId, input.artifacts).catch(
          (error: unknown) => {
            console.warn(
              `[session.send] accepted prompt but failed to remove draft attachments: ${
                error instanceof Error ? error.message : String(error)
              }`,
            );
          },
        );
      }
      const attachments =
        preparedArtifacts && preparedArtifacts.length > 0
          ? await Promise.all(
              preparedArtifacts.map((artifact, ordinal) =>
                issueSessionImageAttachment({
                  sessionId: input.sessionId,
                  artifactPath: artifact.path,
                  declaredMediaType: artifact.mediaType,
                  ordinal,
                }),
              ),
            )
          : undefined;
      return {
        accepted: true as const,
        ...(result.queued
          ? { queued: true, queueId: result.queueId, queueMode: result.queueMode }
          : {}),
        ...(attachments !== undefined ? { attachments } : {}),
      };
    } finally {
      releaseModeSwitchAdmission();
    }
  });

  // session.cancel
  registerChannel('session.cancel', async (input) => {
    return kodaxHost.cancel(input.sessionId);
  });

  // session.list
  // 可选 projectRoot 过滤——左抽屉切项目时只拉本项目下的 session。
  // 按 lastActivityAt 倒序，最近活动的在最前。
  //
  // 安全：
  //   - filter 同样过 validateProjectRoot——schema 只检字符串长度，
  //     不验证 abs path / no NUL / no ..
  //   - 用 path.normalize 后比较——避免 trailing slash / 大小写差异导致 filter miss
  //     （比如 session 存了 /Users/foo/proj，renderer 传 /Users/foo/proj/ 应该匹配）
  registerChannel('session.list', (input) =>
    runWithCoderAdmission(options, async () => {
      // reviewer MEDIUM-3: projectFilter 必须在传给 listMerged 前 normalize，
      // 让 SDK 层和 IPC 层比较同一形态（避免 Windows 路径 / 大小写 / trailing
      // slash 不一致让 persisted session 静默丢失）。
      // F005 v0.1.5：filter 必须是 allowlist 项目；保留 unfiltered（全部 session）路径。
      let projectFilter: string | undefined;
      if (input?.projectRoot !== undefined) {
        projectFilter = canonProjectRoot(await projectStore.assertAllowed(input.projectRoot));
      }
      // FEATURE_038: 合并视图 — in-flight (in-memory) ∪ SDK persisted
      // 传给 host.listMerged 的 projectRoot 是 canonical 形态（SDK listSessions 内部
      // 自己 normalize；当前 SDK 版本 projectRoot filter 不严格——本层再过一道 canon
      // 比较兜底）。
      // F045: surface 过滤透传给 host.listMerged（在合并 in-flight ∪ persisted 后统一 filter）。
      // 不传 = 全部（含历史无 tag 的，向后兼容）。Coder = surface!=='partner'，Partner = 'partner'。
      const merged = await kodaxHost.listMerged({
        projectRoot: projectFilter,
        surface: input?.surface,
        limit: input?.limit,
      });

      // Persisted session 没有真运行时设置——磁盘上只 SDK lineage + gitRoot。先准备一份
      // user-defaults 兜底，给 sidebar UI 占位用（避免显示 "mock" 让用户以为整个 SDK 是 mock）。
      // loadKodaxUserDefaults 模块级缓存命中后零成本; providerConfigStore.load 自己缓存。
      // 并行 await 两个 promise——它们彼此无依赖，并行版省一个 turn 调度 ms。
      // tryResume 路径走相同 resolution，两边对齐，避免 UI 一闪即变。
      let persistedProviderFallback = 'mock';
      let persistedModelFallback: string | undefined;
      const [[udResult, providerLoadResult], baseRuntimeDefaults, kodaxCustomProviders] =
        await Promise.all([
          Promise.allSettled([loadKodaxUserDefaults(), providerConfigStore.load()]),
          resolveRuntimeDefaults(),
          loadKodaxCustomProviders().catch(() => []),
        ]);
      if (udResult.status === 'fulfilled') {
        const ud = udResult.value;
        if (ud.provider) persistedProviderFallback = ud.provider;
        if (ud.model) persistedModelFallback = ud.model;
      }
      // Space defaultProviderId 优先级高于 KodaX user defaults——用户在 Space 设过默认 provider
      // 应该胜出；providerConfigStore.load 失败时保留 user-defaults / 'mock'。
      if (providerLoadResult.status === 'fulfilled') {
        const defaultId = providerConfigStore.getDefaultProviderId();
        if (defaultId) persistedProviderFallback = defaultId;
      }
      // Runtime profile owns the latest known run boundary. Older SDK SessionSummary only
      // exposes createdAt, so use the profile to recover persisted Coder session activity.
      // The renderer repeats this overlay because session.list can race Runtime startup.
      const runtimeSessions = new Map(
        runtimeProjectionController
          .profileSnapshot()
          .sessions.map((session) => [session.sessionId, session] as const),
      );
      const withTs = merged
        .filter((m) => {
          if (projectFilter === undefined) return true;
          if (m.kind === 'in-flight') {
            return canonProjectRoot(m.projectRoot) === projectFilter;
          }
          // persisted 的 projectRoot 来自 SDK runtimeInfo.workspaceRoot ?? gitRoot。
          // 当 SDK summary 缺这俩字段（fast path / 早期版本），projectRoot=undefined——
          // 此时无法本地 filter；保守地保留它，让用户看得到（宁可串项目，也比"以前的
          // session 全消失"体验好）。新版 SDK slow path 一旦填满 runtimeInfo 就走精确匹配。
          if (m.projectRoot === undefined) return true;
          return canonProjectRoot(m.projectRoot) === projectFilter;
        })
        .map((m) => {
          if (m.kind === 'in-flight') {
            return {
              item: m,
              createdAt: m.createdAt,
              lastActivityAt: m.lastActivityAt,
              sortKey: m.lastActivityAt,
            };
          }
          const runtimeSession =
            m.surface === 'code' ? runtimeSessions.get(m.sessionId) : undefined;
          const parsedCreatedAt = m.createdAt !== undefined ? Date.parse(m.createdAt) : 0;
          const sdkCreatedAt = Number.isFinite(parsedCreatedAt) ? parsedCreatedAt : 0;
          const createdAt = sdkCreatedAt > 0 ? sdkCreatedAt : (runtimeSession?.createdAt ?? 0);
          const lastActivityAt = Math.max(createdAt, runtimeSession?.lastActivityAt ?? 0);
          return { item: m, createdAt, lastActivityAt, sortKey: lastActivityAt };
        })
        .sort((a, b) => b.sortKey - a.sortKey);
      const sessions: SessionMeta[] = await Promise.all(
        withTs.map(async ({ item, createdAt, lastActivityAt }) => {
          if (item.kind === 'in-flight') {
            // in-flight 没有 msgCount 字段（ManagedSession 不跟用户消息计数），dashboard
            // 用 sessions[].msgCount ?? userMessagesBuffer.length 双源 fallback。
            // model 是用户 /model 设的值（undefined = provider 默认），透出去让 dashboard
            // 能按真 model 维度做 Favorite model 统计。
            return {
              sessionId: item.sessionId,
              projectRoot: item.projectRoot,
              provider: item.provider,
              reasoningMode: item.reasoningMode,
              permissionMode: item.permissionMode,
              autoModeEngine: item.autoModeEngine,
              agentMode: item.agentMode,
              surface: item.surface,
              title: item.title,
              createdAt: item.createdAt,
              lastActivityAt: item.lastActivityAt,
              parentSessionId: item.parentSessionId,
              forkPointTurnIdx: item.forkPointTurnIdx,
              model: item.model,
            };
          }
          // persisted: 运行时设置用 user-default 占位（Space defaultProviderId →
          // ~/.kodax/config.json → 'mock' 兜底）。tryResume 用同样链路 resolve，
          // 保证 sidebar 显示和真激活后的运行时设置一致——不会出现"点开 historical
          // session 看着是 mock，点了发消息后 BottomBar 突然跳到 deepseek-v4-pro"
          // 的视觉跳变。
          //
          // msgCount 直接透传 SDK summary 给的值——这是 dashboard 重启后 Messages 数
          // 正确的关键（无需扫 jsonl 内容，SDK 已经 fast-path 缓存了 summary）。
          // Read the per-session sidecar once. Previously resolveRuntimeDefaults()
          // read it internally while this mapper read the same file again for the
          // provider/model identity. The global defaults are identical for every
          // row in this response, so resolve them once above and overlay the one
          // session-specific layer here.
          const persistedRuntime = await getSessionRuntimeStore().read(item.sessionId);
          const identity = resolveHistoricalRuntimeIdentity({
            ...(persistedRuntime !== null ? { persisted: persistedRuntime } : {}),
            fallbackProvider: persistedProviderFallback,
            ...(persistedModelFallback !== undefined
              ? { fallbackModel: persistedModelFallback }
              : {}),
            kodaxCustomProviders,
          });
          return {
            sessionId: item.sessionId,
            // A project-scoped query is authoritative even when an SDK summary omits
            // runtimeInfo.workspaceRoot/gitRoot (observed on the Linux slow path).
            // Falling back directly to '/' makes the renderer group valid sessions
            // outside their project and display that project as empty.
            projectRoot: item.projectRoot ?? projectFilter ?? '/',
            provider: identity.provider,
            reasoningMode: persistedRuntime?.reasoningMode ?? baseRuntimeDefaults.reasoningMode,
            permissionMode: persistedRuntime?.permissionMode ?? baseRuntimeDefaults.permissionMode,
            autoModeEngine: persistedRuntime?.autoModeEngine ?? baseRuntimeDefaults.autoModeEngine,
            agentMode: persistedRuntime?.agentMode ?? baseRuntimeDefaults.agentMode,
            // F045: 真值——来自 SDK summary.tag 反推（host.listMerged 已派生），非占位。
            surface: item.surface,
            title: item.title,
            createdAt,
            lastActivityAt,
            msgCount: item.msgCount,
            model: identity.model,
            runtimeMetadataSource: identity.runtimeMetadataSource,
          };
        }),
      );
      return { sessions };
    }),
  );

  // session.delete
  registerChannel('session.delete', (input) =>
    runWithCoderAdmission(options, () => deleteSessionForIpc(input.sessionId)),
  );

  // session.setTitle
  registerChannel('session.setTitle', (input) =>
    runWithCoderAdmission(options, async () => {
      const ok = await kodaxHost.setTitle(input.sessionId, input.title);
      return { ok };
    }),
  );

  // session.setReasoningMode — F008
  registerChannel('session.setReasoningMode', (input) =>
    runWithCoderAdmission(options, async () => {
      const ok = await commitRuntimeMutationForIpc(input.sessionId, () =>
        kodaxHost.setReasoningMode(input.sessionId, input.mode),
      );
      return { ok };
    }),
  );

  // session.setProvider — F008
  // 必须先验 providerId 真实存在——schema 只验格式，不验 catalog（review C1-sec）
  registerChannel('session.setProvider', (input) =>
    runWithCoderAdmission(options, async () => {
      await assertProviderExists(input.providerId);
      await ensureCustomProviderRegistered(input.providerId);
      await ensureProviderKeyInjected(input.providerId);
      const kodaxCustomProviders =
        input.providerId !== 'mock' && !isBuiltinId(input.providerId)
          ? await loadKodaxCustomProviders()
          : [];
      const defaultModel = providerDescriptor(input.providerId, kodaxCustomProviders)?.defaultModel;
      const ok = await commitRuntimeMutationForIpc(input.sessionId, () => {
        const providerOk = kodaxHost.setProvider(input.sessionId, input.providerId);
        return providerOk && kodaxHost.setModel(input.sessionId, defaultModel);
      });
      return { ok };
    }),
  );

  // session.setPermissionMode — FEATURE_029 canonical 3 mode
  // Daemon Coder 会把设置提交给 Runtime，下一次具体 tool call 即按新 mode 决策；
  // embedded / Partner / legacy 的 run-scoped guardrail 从下一轮 send 生效。
  registerChannel('session.setPermissionMode', (input) =>
    runWithCoderAdmission(options, async () => {
      const ok = await commitRuntimeMutationForIpc(input.sessionId, () =>
        kodaxHost.setPermissionMode(input.sessionId, input.mode),
      );
      return { ok };
    }),
  );

  // session.setAutoModeEngine — FEATURE_029
  // 切 auto mode 子档 engine ('llm' | 'rules')。即便当前 mode 不是 'auto' 也接受
  // (用户先选 engine 再切 auto 是合法路径)。Daemon Coder 的下一次具体 tool call 即读取
  // 新 engine；embedded / Partner / legacy 从下一轮 send 重新 bootstrap guardrail。
  registerChannel('session.setAutoModeEngine', (input) =>
    runWithCoderAdmission(options, async () => {
      const ok = await commitRuntimeMutationForIpc(input.sessionId, () =>
        kodaxHost.setAutoModeEngine(input.sessionId, input.engine),
      );
      return { ok };
    }),
  );

  // session.setAgentMode — 切 KodaX agent 形态 (AMA / SA)。
  // AMA = 多 agent 协作（KodaX 默认）；SA = 单 agent 降级路径，接口并发受限时使用。
  // 切换不重启 in-flight session，下一条 prompt 走新形态。
  registerChannel('session.setAgentMode', (input) =>
    runWithCoderAdmission(options, async () => {
      const ok = await commitRuntimeMutationForIpc(input.sessionId, () =>
        kodaxHost.setAgentMode(input.sessionId, input.agentMode),
      );
      return { ok };
    }),
  );

  // session.fork — FEATURE_038 (持久化)
  // v0.1.6: SDK forkSession 写盘出新 sessionId；host 用 source 运行时设置实例化
  // 新 ManagedSession 入 in-memory map。events 复制仍由 renderer 完成（重启后从
  // SDK loadSession 重放是 v0.1.7+ 优化）。
  registerChannel('session.fork', (input) =>
    runWithCoderAdmission(options, async () => {
      assertSafePagedHistoryMutation(input.sessionId, input.historyBoundary);
      const result = await kodaxHost.fork(
        input.sessionId,
        input.forkPointTurnIdx,
        input.historyBoundary,
      );
      if (!result) {
        throw new Error(`session not found: ${input.sessionId}`);
      }
      return result;
    }),
  );

  // session.rewind — FEATURE_038 (持久化)
  // v0.1.6: main 端 cancel in-flight (await)，然后 SDK rewindSession 写盘截断；
  // renderer 截断 events 数组。
  registerChannel('session.rewind', (input) =>
    runWithCoderAdmission(options, async () => {
      assertSafePagedHistoryMutation(input.sessionId, input.historyBoundary);
      const result = await kodaxHost.rewind(
        input.sessionId,
        input.rewindPastTurnIdx,
        input.historyBoundary,
      );
      await truncateLocalNoticesAfterSuccessfulRewind(input, result);
      return result;
    }),
  );

  // session.agentsMd — FEATURE_034
  // 拉取 session.projectRoot 下当前的 AGENTS.md 列表 (global + project)。
  // 每次都重 load（disk stat + read）—— 不缓存，让 AGENTS.md 修改后下次 popout 打开即生效。
  // 安全：projectRoot 在 session.create 已经 validateProjectRoot 过，这里复用 session 持有的值，
  // 不让 renderer 直接传任意路径。
  // **async**：v0.1.6 后 loadAgentsMd 走 SDK loadAgentsFiles (同步 I/O)，保留 async
  // 包装兼容 handler 签名；SDK 抛任何异常都被 loader try/catch 转空数组 (reviewer HIGH-2)。
  registerChannel('session.agentsMd', async (input) => {
    const session = kodaxHost.get(input.sessionId);
    if (!session) {
      throw new Error(`session not found: ${input.sessionId}`);
    }
    const files = await loadAgentsMd({ projectRoot: session.projectRoot });
    return { files };
  });

  // session.agentsMd.save — REPL /memory inline edit 等价
  //
  // 安全设计:
  //   - scope 闭集 ['global', 'project'] -- renderer 不能传任意 path
  //   - target path 在 main 端计算 (~/.kodax/AGENTS.md / <session.projectRoot>/AGENTS.md),
  //     从 host.get(sessionId).projectRoot 拿,renderer 永远拿不到任意路径写权
  //   - 原子写: tmp 文件 → fs.rename,避免半写状态被 SDK loadAgentsFiles 读到
  //   - 文件权限 0o600 (与 ~/.kodax/auto-rules.jsonc 等 sensitive config 一致)
  //   - content 256KB schema 上限已经在 envelope 校验
  registerChannel('session.agentsMd.save', async (input) => {
    const session = kodaxHost.get(input.sessionId);
    if (!session) {
      throw new Error(`session not found: ${input.sessionId}`);
    }
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const crypto = await import('node:crypto');

    let targetPath: string;
    if (input.scope === 'global') {
      // OC-12 测试模式下走 tmpdir/kodax-test-<id>
      const globalDir = getKodaxDir();
      await fs.mkdir(globalDir, { mode: 0o700, recursive: true }).catch(() => {
        /* mkdir 失败 (磁盘满 / 权限) 走下面写入时再失败,统一错误处理 */
      });
      targetPath = path.join(globalDir, 'AGENTS.md');
    } else {
      // 'project'
      targetPath = path.join(session.projectRoot, 'AGENTS.md');
    }

    // 原子写: 同目录 tmp 文件 → rename。tmp 名带随机后缀防并发覆盖。
    const tmpSuffix = crypto.randomBytes(4).toString('hex');
    const tmpPath = `${targetPath}.tmp-${tmpSuffix}`;
    try {
      await fs.writeFile(tmpPath, input.content, { mode: 0o600 });
      await fs.rename(tmpPath, targetPath);
    } catch (err) {
      // 清理 tmp (best-effort, 不影响 error 抛出)
      await fs.unlink(tmpPath).catch(() => {});
      throw new Error(
        `failed to write AGENTS.md: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    return { ok: true, path: targetPath };
  });

  // session.listRunning — FEATURE_125 Team Mode peer 列表
  //
  // 调 SDK listRunningSessions(): 全系统活的 KodaX peer 实例 (含别的 Space 窗口 / CLI),
  // 排除自己。Renderer 用来:
  //   - /status slash command 输出
  //   - LeftSidebar 顶部 badge "N other peers" (让用户知道多窗口在跑)
  // SDK 走 file-based discovery (~/.kodax/instances 目录),NEVER throws,no instances dir →
  // [],不阻塞 UI。
  registerChannel('session.listRunning', async () => {
    const sdkSession = await loadSdkSessionCached();
    const list = await sdkSession.listRunningSessions();
    // SDK 返回包括自己 — 用 pid 过滤掉自己; 其他 peer 也限到 64 防 schema 上限
    const myPid = process.pid;
    const peers = list
      .filter((p) => p.pid !== myPid)
      .slice(0, 64)
      .map((p) => ({
        pid: p.pid,
        startedAt: p.startedAt,
        cwd: p.cwd,
        ...(p.sessionId !== undefined ? { sessionId: p.sessionId } : {}),
      }));
    return { peers };
  });

  // session.history — 历史 session 切换时恢复对话内容（events / userMessages buffer in-memory，
  // 重启后空；renderer 调本 channel 拉 KodaX SDK 持久化的 messages 数组，flatten 成
  // user / assistant_text / tool_call 序列,回填 store）。
  //
  // **v0.1.x 全量回放**: tool_use / tool_result block 不再丢弃 —— 按原 message 顺序拍平
  // 成 'tool_call' item (toolId / toolName / input / result)。assistant 一轮内文本和工具
  // 调用交替时,items 数组顺序就是回放顺序,renderer composeMessages 自动重建气泡 + tool card。
  //
  // 工具结果匹配: tool_result block 在后续 user message 里,通过 toolId 与之前的 tool_use 配对。
  // 失配 (tool_use 没等到 tool_result, 或 tool_result 没找到对应 tool_use) 仍 emit
  // tool_call item,result 字段缺失 → renderer 会渲染为 "running" 状态卡片。
  registerChannel('session.localNotice.append', (input) =>
    runWithCoderAdmission(options, async () => {
      const payload: Record<string, string> = { id: input.notice.id };
      if (input.notice.variant !== undefined) payload.variant = input.notice.variant;
      const liveSession = kodaxHost.get(input.sessionId);
      const surface =
        liveSession?.surface ??
        sdkTagToSurface((await loadPersistedSession(input.sessionId))?.tag) ??
        'code';
      const usesRuntimeConversation = surface === 'code' && runtimeHostAdapter.hasReadyRuntime();
      await appendSpaceOwnedLocalNotice(input.sessionId, input.notice, async () => {
        if (usesRuntimeConversation) {
          await runtimeHostAdapter.appendNotice({
            sessionId: input.sessionId,
            source: 'space-local-notice',
            content: input.notice.content,
          });
        } else {
          await appendPersistedClientNotice(input.sessionId, {
            source: 'space-local-notice',
            content: input.notice.content,
            timestamp: isoTimestampFromSentAt(input.notice.sentAt),
            payload,
          });
        }
      });
      return { ok: true };
    }),
  );

  registerChannel('session.localNotice.replace', async (input) => {
    await getSessionLocalNoticeStore().replace(input.sessionId, input.notices);
    return { ok: true };
  });

  registerChannel('session.history', (input) =>
    runWithCoderAdmission(options, async () => {
      const withLocalNotices = async (
        baseItems: readonly SessionHistoryItem[],
        conversation?: ReturnType<typeof conversationHistoryDiagnostic>,
        page?:
          | {
              readonly outcome: 'ready';
              readonly revision: string;
              readonly sourceRevision: string;
              readonly hasMore: boolean;
              readonly nextCursor?: string;
              readonly windowMode: 'replace' | 'prepend';
              readonly hasNewer: boolean;
            }
          | { readonly outcome: 'data_changed' }
          | { readonly outcome: 'runtime_unavailable' },
      ) => {
        const localNotices = await getSessionLocalNoticeStore().list(input.sessionId);
        return {
          items: limitSessionHistoryWithLocalNotices(baseItems, localNotices),
          ...(conversation !== undefined ? { conversation } : {}),
          ...(page !== undefined ? { page } : {}),
        };
      };
      // Ordinary chat uses the SDK-owned conversation projection. Raw append-order transcript is
      // retained only as a compatibility fallback for injected/legacy readers and for audit APIs.
      const liveSession = kodaxHost.get(input.sessionId);
      const runtimeProfileOwnsSession = runtimeProjectionController
        .profileSnapshot()
        .sessions.some((session) => session.sessionId === input.sessionId);
      const surface =
        liveSession?.surface ??
        input.expectedSurface ??
        (runtimeHostAdapter.hasReadyRuntime() && runtimeProfileOwnsSession ? 'code' : undefined) ??
        sdkTagToSurface((await loadPersistedSession(input.sessionId))?.tag) ??
        'code';
      let data;
      let usesConversationProjection = false;
      let runtimeWindowForResponse: RuntimeConversationWindow | undefined;
      let runtimeProjectionEndExclusive: number | undefined;
      let runtimeProjectionItemCount: number | undefined;
      let conversationDiagnosticValue: ReturnType<typeof conversationHistoryDiagnostic> | undefined;
      let conversationPageValue:
        | {
            readonly outcome: 'ready';
            readonly revision: string;
            readonly sourceRevision: string;
            readonly hasMore: boolean;
            readonly nextCursor?: string;
            readonly windowMode: 'replace' | 'prepend';
            readonly hasNewer: boolean;
          }
        | { readonly outcome: 'data_changed' }
        | { readonly outcome: 'runtime_unavailable' }
        | undefined;
      let omittedConversationEntries = 0;
      if (surface === 'code') {
        // A Coder Session must never fall back to the persisted full-body reader merely because
        // the daemon is still starting. That fallback defeats bounded newest-page loading and can
        // leave a direct-read `partial` projection permanently installed. Tell the renderer to
        // retry this same bounded route once Runtime is ready.
        if (!runtimeHostAdapter.hasReadyRuntime()) {
          return withLocalNotices([], undefined, { outcome: 'runtime_unavailable' });
        }
        const result = await loadRuntimeConversationWindow(input);
        if (result.outcome === 'data_changed') {
          return withLocalNotices([], undefined, { outcome: 'data_changed' });
        }
        if (result.window === null) return withLocalNotices([]);
        const window = result.window;
        runtimeWindowForResponse = window;
        runtimeProjectionEndExclusive = result.projectionEndExclusive;
        runtimeProjectionItemCount = result.projectionItemCount;
        const boundaryEntries: IndexedConversationEntry[] = [...window.entriesByIndex.entries()]
          .sort(([left], [right]) => left - right)
          .map(([index, entry]) => ({ index, entry }));
        const conversation: RuntimeConversationHistory = {
          revision: window.revision,
          sourceRevision: window.sourceRevision,
          status: window.status,
          issues: window.issues,
          entries: boundaryEntries.map(({ entry }) => entry),
        };
        data = conversationHistoryAsTranscript(
          conversation,
          boundaryEntries,
          boundaryEntries,
          !window.newerSdkPageOmitted,
          window.seamTurnBoundaries,
        );
        // The response is one complete bounded browsing window, not an incremental fragment.
        // SDK pages and Space's bounded projection slices both replace the renderer window so
        // older navigation never accumulates the complete transcript in renderer memory.
        conversationDiagnosticValue = conversationHistoryDiagnostic(conversation);
        omittedConversationEntries = window.prefixOmitted ? (boundaryEntries[0]?.index ?? 0) : 0;
        usesConversationProjection = true;
      } else {
        if (input.cursor !== undefined) {
          return withLocalNotices([], undefined, { outcome: 'data_changed' });
        }
        const conversation = await loadPersistedConversationHistory(input.sessionId);
        if (conversation.supported) {
          if (conversation.data === null) return withLocalNotices([]);
          data = conversationHistoryAsTranscript(conversation.data);
          conversationDiagnosticValue = conversationHistoryDiagnostic(conversation.data);
          usesConversationProjection = true;
        } else {
          data = await loadPersistedTranscript(input.sessionId);
        }
      }
      if (!data || !Array.isArray(data.messages)) {
        return withLocalNotices([]);
      }
      const items: SessionHistoryItem[] = [];

      // 第一步: 走一遍消息收集 toolId → result 映射 (tool_result 永远在 tool_use 之后,
      // 但同一 message 里也可能有多个 tool_use,先扫一遍简化处理)
      const toolResults = new Map<string, { content: string; isError: boolean }>();
      for (const [toolId, result] of runtimeWindowForResponse?.seamToolResults ?? []) {
        toolResults.set(toolId, result);
      }
      for (const msg of data.messages) {
        if (!Array.isArray(msg.content)) continue;
        for (const block of msg.content) {
          if (!block || typeof block !== 'object') continue;
          if ((block as { type?: unknown }).type !== 'tool_result') continue;
          const id = (block as { tool_use_id?: unknown }).tool_use_id;
          if (typeof id !== 'string') continue;
          const content = flattenToolResultContent((block as { content?: unknown }).content);
          const isError = Boolean((block as { is_error?: unknown }).is_error);
          toolResults.set(id, { content, isError });
        }
      }

      // 第二步: 按顺序拍平 messages 成 items
      //
      // v0.1.x 修复 "fork/rewind branch_summary 回放成假用户气泡": fork 回到某个分支点时,
      // SDK 会在 lineage 里合成一条 role==='user' 的 context message,把"你之前探索过的另一条
      // 分支"的摘要塞给 LLM 当上下文——但这段文字从来不是用户真的打的字。旧逻辑直接按
      // msg.role 拍平,于是这段摘要在滚动区里显示成一条用户消息(压缩产生的 compaction 摘要
      // 同理,role==='system')。
      //
      // loadFullTranscript (SDK 0.7.51+) 额外提供 transcriptEntries——每条 message 对应一个
      // entry,entry.type 精确标出 'message' / 'compaction' / 'branch_summary',不需要靠猜 role。
      // 有了它就按 entry.type 路由:branch_summary/compaction → 非 user 的 lineage_notice 历史
      // 提示条(entry.summary 是没被模板包裹的干净文本,优先用它);其余(type==='message')走
      // 原有逻辑不变。旧 SDK / 测试 mock 没有 transcriptEntries 时,整段回退成"每条 message
      // 都当作 type:'message'"——即完全不变的旧行为。
      const rawTranscriptEntries = (data as { transcriptEntries?: unknown }).transcriptEntries;
      type TranscriptEntryLike = {
        readonly entryId?: unknown;
        readonly parentId?: unknown;
        readonly logicalId?: unknown;
        readonly sourceEntryId?: unknown;
        readonly authoritativeEntryId?: unknown;
        readonly canonicalIndex?: unknown;
        readonly historyBoundary?: unknown;
        readonly type?: unknown;
        readonly source?: unknown;
        readonly message: (typeof data.messages)[number];
        readonly summary?: unknown;
        readonly payload?: unknown;
        readonly taskResults?: unknown;
        readonly turnId?: unknown;
        readonly content?: unknown;
        // SDK 0.7.51+ SessionTranscriptEntry.timestamp (ISO string) — the real per-message
        // wall-clock. We forward it as the history item's sentAt so restored turns keep their
        // true time instead of all collapsing onto session.createdAt (the renderer fallback).
        // Without it, workflow notices — which DO carry real run times — sort above the whole
        // restored conversation after a compaction re-root (createdAt is reset later than the run).
        readonly timestamp?: unknown;
        // SDK marks each transcript entry active (on the live branch) or not. Activity can select
        // the authoritative payload inside an identity-proven clone group, but never proves a
        // clone and never changes the group's first canonical display position.
        readonly active?: unknown;
      };
      const allEntries: readonly TranscriptEntryLike[] = Array.isArray(rawTranscriptEntries)
        ? (rawTranscriptEntries as TranscriptEntryLike[])
        : data.messages.map((message) => ({ type: 'message', message }));
      const turnUserOrdinalByCanonicalIndex = new Map<number, number>();
      const globalVisibleUserCountByTurnId = new Map<string, number>();
      let leadingOmittedTurnId: string | undefined;
      let crossedLeadingOmittedTurn =
        !usesConversationProjection || omittedConversationEntries === 0;
      for (const entry of allEntries) {
        if (!isRecord(entry.message)) continue;
        const messageTurnId = stringField(entry.message.turnId);
        const turnId = stringField(entry.turnId) ?? messageTurnId;
        if (!crossedLeadingOmittedTurn && turnId !== undefined) {
          if (leadingOmittedTurnId === undefined) leadingOmittedTurnId = turnId;
          else if (turnId !== leadingOmittedTurnId) crossedLeadingOmittedTurn = true;
        }
        if (entry.message.role !== 'user') continue;
        if (turnId === undefined || typeof entry.canonicalIndex !== 'number') continue;
        if (!crossedLeadingOmittedTurn) continue;
        const ordinal = globalVisibleUserCountByTurnId.get(turnId) ?? 0;
        turnUserOrdinalByCanonicalIndex.set(entry.canonicalIndex, ordinal);
        globalVisibleUserCountByTurnId.set(turnId, ordinal + 1);
      }
      const entries = allEntries;

      // Workflow 结果原位还原用:一条 `<task-completed>` 块只有当它的 task_id 命名了一个 Space 落盘的
      // workflow run(<space>/workflow-runs/<runId>/)才算 workflow —— 借此把用同样 wrapper 的普通
      // dispatch_child_task 排除掉(review HIGH)。
      const workflowRunBaseDir = path.join(getSpaceDataDir(), 'workflow-runs');
      // 同一个 workflow run 的结果只渲染一次:被压缩/re-root 过的 session,loadFullTranscript 的全谱系里
      // 同一条 `<task-completed>` 会重复出现(旧的侧存储按 finished:runId:status 去重、只显一份;approach A
      // 改按 transcript 位置渲染后丢了去重 → 同一份报告显示多次)。按 runId 去重、保留**首次**出现的位置。
      const seenWorkflowRunIds = new Set<string>();
      const visibleUserCountByTurnId = new Map<string, number>();
      let historyTurnIndex = 0;
      // 完整历史投影:loadFullTranscript 返回全谱系。先修复旧 sidecar 的 child-before-parent
      // 次序，再跳过精确 `[compacted]` 占位和已证明的 rewind-abandoned path；克隆只按 SDK
      // 提供的 entryId/logicalId/sourceEntryId 关系折叠，并始终保留首次 canonical 位置。
      // 旧 SDK 写下但没有 provenance 的相同内容必须 fail open，不能再次把真实 query 删除或搬家。
      // 见 transcript-dedup.ts 的机制说明。
      const dedupedEntries = usesConversationProjection
        ? entries
        : dedupeTranscriptEntries(entries);

      for (const entry of dedupedEntries) {
        const entrySentAt = parseEntrySentAt(entry.timestamp);
        const historyIdentity = historyIdentityFromEntry(entry);
        if (entry.type === 'client_notice') {
          const notice = clientNoticeHistoryItemFromEntry(entry, entrySentAt);
          if (notice !== null) {
            items.push(notice);
          }
          continue;
        }
        if (entry.type === 'branch_summary' || entry.type === 'compaction') {
          const rawSummary =
            typeof entry.summary === 'string' && entry.summary.trim().length > 0
              ? entry.summary
              : extractUserText((entry.message as { content?: unknown }).content);
          const text = rawSummary.trim();
          if (text.length > 0) {
            const compactionPayload = isRecord(entry.payload) ? entry.payload : undefined;
            const tokensBefore = compactionPayload?.tokensBefore;
            const tokensAfter = compactionPayload?.tokensAfter;
            const hasCompactStats =
              entry.type === 'compaction' &&
              typeof tokensBefore === 'number' &&
              Number.isInteger(tokensBefore) &&
              tokensBefore >= 0 &&
              tokensBefore <= 10_000_000 &&
              typeof tokensAfter === 'number' &&
              Number.isInteger(tokensAfter) &&
              tokensAfter >= 0 &&
              tokensAfter <= 10_000_000;
            items.push({
              ...historyIdentity,
              kind: 'lineage_notice',
              noticeKind: entry.type,
              text,
              ...(entrySentAt !== undefined ? { sentAt: entrySentAt } : {}),
              ...(hasCompactStats ? { tokensBefore, tokensAfter } : {}),
            });
          }
          continue;
        }
        const taskResults = extractTaskResults(entry);
        if (entry.type === 'task_result' || taskResults.length > 0) {
          appendWorkflowTaskResultNotices(taskResults, seenWorkflowRunIds, items, historyIdentity);
          // Consume the entry only if a real workflow run was recognized. Legacy transcripts
          // (recorded before structured task-result metadata) have the SDK reconstruct
          // `_taskResults` stamped source:'child_task' even for real run_workflow results, so
          // the block above renders nothing. Fall through to the `<task-completed>` text parse
          // below — which cross-checks isWorkflowRunDir() against disk instead of trusting
          // `source` — so those notices still restore (App.tsx's old run-dir side-store restore
          // that used to cover this was removed this release). Guard on a parseable message so a
          // messageless task_result entry still short-circuits instead of hitting `msg.role`.
          if (taskResults.some((r) => r.source === 'workflow') || !isRecord(entry.message))
            continue;
        }
        const msg = entry.message;
        const meta = msg as {
          _source?: unknown;
          source?: unknown;
          _synthetic?: unknown;
          synthetic?: unknown;
        };
        const source = meta.source ?? meta._source;
        const synthetic = meta.synthetic === true || meta._synthetic === true;
        if (msg.role === 'user' && source === 'sidecar-verifier') {
          const sidecarText = extractUserText(msg.content);
          if (sidecarText.length > 0) {
            items.push({
              ...historyIdentity,
              kind: 'sidecar_message',
              message: {
                source: 'sidecar-verifier',
                verdict: 'revise',
                recipient: 'main-agent',
                delivery: 'synthetic-user-message',
                content: sidecarText,
                // #12 fix: SDK 不持久化真实 verdict/delivery/suggestedFix——上面几个字段都是
                // 占位值,不是这条消息当时真实的判定结果。标 historical=true 让 renderer 用中性
                // 的"历史记录"标签展示,不再断言 verdict==='revise'。
                historical: true,
              },
              ...(entrySentAt !== undefined ? { sentAt: entrySentAt } : {}),
            });
          }
          continue;
        }
        // Workflow 结果/失败:SDK 把 run 的最终结果作为一条 _synthetic 的 `<task-completed …>`
        // user 消息存进 transcript(位置正确)。识别它、原位渲染成 workflow 历史提示条——否则会被
        // 下面的 `if (synthetic) continue` 丢掉,只能靠侧存储按 wall-clock 重排(SDK 压缩把时间戳
        // 压平后 → resume 乱序/置顶)。见 historyWorkflowNoticeSchema。
        if (synthetic && msg.role === 'user') {
          // 一条合成消息可能批了多个 `<task-completed>` 块;逐块解析、只对**真 workflow run** 出 notice
          // (dispatch_child_task 用同样的 wrapper、但没落盘目录 → isWorkflowRunDir 排除,避免误标)。
          const blocks = parseTaskCompletedBlocks(extractUserText(msg.content));
          if (blocks.length > 0) {
            const { render, handled } = selectWorkflowBlocks(
              blocks,
              seenWorkflowRunIds,
              workflowRunBaseDir,
            );
            for (const b of render) {
              items.push({ ...historyIdentity, kind: 'workflow_notice', text: b.text });
            }
            if (handled) continue; // 已处理(渲染或去重跳过)workflow 结果
            // 否则(全是普通子任务 / 未落盘的 run)→ 落到下面的 synthetic-skip,和以前一样隐藏。
          }
        }
        if (synthetic) continue; // 其余 SDK 合成消息隐藏
        if (msg.role === 'system') continue; // system prompts 内部

        if (msg.role === 'user') {
          // user message 通常 = pure text;若是工具结果回灌 (content 是 tool_result block 数组),
          // 则 text === '',不 emit user item (但 tool_results map 已经在第一步抽走了)
          const userText = extractUserText(msg.content);
          const imageBlocks = extractUserImages(msg.content);
          const attachments =
            imageBlocks.length > 0
              ? await Promise.all(
                  imageBlocks.map((image, ordinal) =>
                    issueSessionImageAttachment({
                      sessionId: input.sessionId,
                      artifactPath: image.path,
                      ...(image.declaredMediaType !== undefined
                        ? { declaredMediaType: image.declaredMediaType }
                        : {}),
                      ordinal,
                    }),
                  ),
                )
              : [];
          if (userText.length > 0 || attachments.length > 0) {
            const messageTurnId = isRecord(msg) ? stringField(msg.turnId) : undefined;
            const turnId = stringField(entry.turnId) ?? messageTurnId;
            const globalTurnUserOrdinal =
              typeof entry.canonicalIndex === 'number'
                ? turnUserOrdinalByCanonicalIndex.get(entry.canonicalIndex)
                : undefined;
            // Only the leading Runtime turn is ambiguous when its older prefix is omitted. Once
            // the canonical turn id changes inside the loaded window, that later turn starts at
            // ordinal zero and can safely reconcile with its live projection.
            const turnUserOrdinal =
              turnId === undefined
                ? undefined
                : usesConversationProjection
                  ? globalTurnUserOrdinal
                  : (visibleUserCountByTurnId.get(turnId) ?? 0);
            const selectorTurnIndex =
              typeof entry.canonicalIndex === 'number' &&
              Number.isSafeInteger(entry.canonicalIndex) &&
              entry.canonicalIndex >= 0
                ? entry.canonicalIndex
                : historyTurnIndex;
            items.push({
              ...historyIdentity,
              kind: 'user',
              content: userText,
              ...(attachments.length > 0 ? { attachments } : {}),
              // Real per-message time (see TranscriptEntryLike.timestamp). Only the user item
              // needs it: it becomes a UserMessage whose sentAt drives composeMessages' merge
              // with workflow notices; assistant/tool items become events that inherit the turn.
              ...(entrySentAt !== undefined ? { sentAt: entrySentAt } : {}),
              ...(turnId !== undefined ? { turnId } : {}),
              ...(turnUserOrdinal !== undefined ? { turnUserOrdinal } : {}),
              historyTurnIndex: selectorTurnIndex,
              ...(isRecord(entry.historyBoundary) &&
              typeof entry.historyBoundary.boundaryId === 'string' &&
              typeof entry.historyBoundary.sourceRevision === 'string'
                ? {
                    historyBoundary: {
                      boundaryId: entry.historyBoundary.boundaryId,
                      sourceRevision: entry.historyBoundary.sourceRevision,
                    },
                  }
                : {}),
            });
            historyTurnIndex += 1;
            if (turnId !== undefined && turnUserOrdinal !== undefined) {
              visibleUserCountByTurnId.set(turnId, turnUserOrdinal + 1);
            }
          }
        } else if (msg.role === 'assistant') {
          // assistant: 按 content blocks 顺序逐个发 — text/thinking 累积到下次 tool_use 边界
          // flush 出 'assistant' item;tool_use 直接 emit 'tool_call' item
          let textBuf = '';
          let thinkingBuf = '';
          const flushText = (): void => {
            if (textBuf.length > 0 || thinkingBuf.length > 0) {
              const contentItem: SessionHistoryItem =
                thinkingBuf.length > 0
                  ? {
                      ...historyIdentity,
                      kind: 'assistant',
                      text: textBuf,
                      thinking: thinkingBuf,
                    }
                  : { ...historyIdentity, kind: 'assistant', text: textBuf };
              items.push(
                entrySentAt !== undefined ? { ...contentItem, sentAt: entrySentAt } : contentItem,
              );
              textBuf = '';
              thinkingBuf = '';
            }
          };
          const blocks = Array.isArray(msg.content)
            ? msg.content
            : typeof msg.content === 'string'
              ? [{ type: 'text', text: msg.content }]
              : [];
          for (const block of blocks) {
            if (!block || typeof block !== 'object') continue;
            const t = (block as { type?: unknown }).type;
            if (t === 'text') {
              const s = (block as { text?: unknown }).text;
              if (typeof s === 'string') textBuf += s;
            } else if (t === 'thinking') {
              const s = (block as { thinking?: unknown }).thinking;
              if (typeof s === 'string') thinkingBuf += s;
            } else if (t === 'tool_use') {
              // 工具调用 → 先 flush 累积的 text/thinking,然后 emit tool_call item
              flushText();
              const id = (block as { id?: unknown }).id;
              const name = (block as { name?: unknown }).name;
              const rawInput = (block as { input?: unknown }).input;
              if (typeof id === 'string' && typeof name === 'string') {
                const matched = toolResults.get(id);
                const tcItem: SessionHistoryItem = {
                  ...historyIdentity,
                  kind: 'tool_call',
                  toolId: id,
                  toolName: name,
                  ...(rawInput && typeof rawInput === 'object' && !Array.isArray(rawInput)
                    ? { input: rawInput as Record<string, unknown> }
                    : {}),
                  ...(matched !== undefined
                    ? { result: matched.content, ...(matched.isError ? { isError: true } : {}) }
                    : {}),
                };
                items.push(tcItem);
              }
            }
          }
          flushText();
        }
      }
      if (omittedConversationEntries > 0) {
        items.unshift({
          kind: 'history_truncation',
          scope: 'history',
          omittedItems: Math.max(1, omittedConversationEntries),
        });
      }
      if (runtimeWindowForResponse !== undefined) {
        const window = runtimeWindowForResponse;
        if (
          runtimeProjectionItemCount !== undefined &&
          runtimeProjectionItemCount !== items.length
        ) {
          runtimeConversationWindows.delete(input.sessionId);
          return withLocalNotices([], undefined, { outcome: 'data_changed' });
        }
        const projectionPage = pageSessionHistoryItems(
          items,
          runtimeProjectionEndExclusive ?? items.length,
        );
        let nextCursor = window.nextCursor;
        if (projectionPage.nextEndExclusive !== undefined) {
          nextCursor = nextRuntimeProjectionCursor(input.sessionId);
          window.projectionContinuation = {
            cursor: nextCursor,
            endExclusive: projectionPage.nextEndExclusive,
            itemCount: items.length,
          };
        } else {
          window.projectionContinuation = undefined;
        }
        rememberRuntimeConversationWindow(input.sessionId, window);
        conversationPageValue = {
          outcome: 'ready',
          revision: window.revision,
          sourceRevision: window.sourceRevision,
          hasMore: nextCursor !== undefined,
          // The newest request installs one bounded tail. Every cursor continuation is an older,
          // non-overlapping slice and therefore extends the already loaded transcript upward.
          // This is a presentation contract only; Runtime canonical order and cursors remain the
          // authority for which records belong to each page.
          windowMode: input.cursor === undefined ? 'replace' : 'prepend',
          // A prepended response is older in isolation, but the renderer still owns the newest
          // page it is extending. It therefore does not need replacement-window navigation.
          hasNewer: input.cursor === undefined ? window.newerSdkPageOmitted : false,
          ...(nextCursor !== undefined ? { nextCursor } : {}),
        };
        return withLocalNotices(
          projectionPage.items,
          conversationDiagnosticValue,
          conversationPageValue,
        );
      }
      return withLocalNotices(items, conversationDiagnosticValue, conversationPageValue);
    }),
  );
}

/** SessionTranscriptEntry.timestamp → epoch ms. SDK gives an ISO string; tolerate a raw
 *  number too. Returns undefined for missing/invalid so the renderer keeps its createdAt
 *  fallback rather than stamping NaN. */
const MAX_HISTORY_TEXT = 262_144;
const MAX_HISTORY_TOOL_RESULT = 524_288;

function isoTimestampFromSentAt(sentAt: number): string {
  const date = new Date(sentAt);
  return Number.isFinite(date.getTime()) ? date.toISOString() : new Date().toISOString();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function clampTextWithMarker(
  text: string,
  maxLength: number,
  marker = '\n[truncated]',
): string {
  if (maxLength <= 0) return '';
  if (text.length <= maxLength) return text;
  const boundedMarker = marker.slice(0, maxLength);
  return `${text.slice(0, maxLength - boundedMarker.length).trimEnd()}${boundedMarker}`;
}

function clampHistoryText(text: string): string {
  return clampTextWithMarker(text, MAX_HISTORY_TEXT);
}

function clientNoticeHistoryItemFromEntry(
  entry: {
    readonly entryId?: unknown;
    readonly logicalId?: unknown;
    readonly sourceEntryId?: unknown;
    readonly timestamp?: unknown;
    readonly content?: unknown;
    readonly payload?: unknown;
    readonly message?: { readonly content?: unknown; readonly timestamp?: unknown } | null;
  },
  entrySentAt: number | undefined,
): SessionHistoryItem | null {
  const directPayload = isRecord(entry.payload) ? entry.payload : undefined;
  const nestedPayload =
    directPayload && isRecord(directPayload.payload) ? directPayload.payload : undefined;
  const content =
    stringField(entry.content) ??
    stringField(directPayload?.content) ??
    stringField(nestedPayload?.content) ??
    extractUserText(entry.message?.content);
  if (content.length === 0) return null;
  const sentAt = entrySentAt ?? parseEntrySentAt(entry.message?.timestamp) ?? 0;
  const variantValue = stringField(nestedPayload?.variant) ?? stringField(directPayload?.variant);
  const variant =
    variantValue === 'echo' || variantValue === 'output'
      ? variantValue
      : content.trimStart().startsWith('/')
        ? 'echo'
        : 'output';
  const id =
    stringField(nestedPayload?.id) ??
    stringField(directPayload?.id) ??
    stringField(entry.entryId) ??
    stringField(entry.logicalId) ??
    stringField(entry.sourceEntryId) ??
    `client_notice_${sentAt}`;
  return {
    kind: 'local_notice',
    id: id.slice(0, 128),
    content: clampHistoryText(content),
    sentAt,
    variant,
  };
}

function stringField(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

type HistoryTranscriptIdentity = {
  readonly entryId?: string;
  readonly parentId?: string | null;
  readonly logicalId?: string;
  readonly sourceEntryId?: string;
  readonly authoritativeEntryId?: string;
  readonly canonicalIndex?: number;
  readonly turnId?: string;
};

function historyIdentityFromEntry(entry: {
  readonly entryId?: unknown;
  readonly parentId?: unknown;
  readonly logicalId?: unknown;
  readonly sourceEntryId?: unknown;
  readonly authoritativeEntryId?: unknown;
  readonly canonicalIndex?: unknown;
  readonly turnId?: unknown;
}): HistoryTranscriptIdentity {
  const entryId = stringField(entry.entryId);
  const parentId = entry.parentId === null ? null : stringField(entry.parentId);
  const logicalId = stringField(entry.logicalId);
  const sourceEntryId = stringField(entry.sourceEntryId);
  const authoritativeEntryId = stringField(entry.authoritativeEntryId);
  const canonicalIndex =
    typeof entry.canonicalIndex === 'number' &&
    Number.isInteger(entry.canonicalIndex) &&
    entry.canonicalIndex >= 0
      ? entry.canonicalIndex
      : undefined;
  const turnId = stringField(entry.turnId);
  return {
    ...(entryId !== undefined ? { entryId } : {}),
    ...(parentId !== undefined || entry.parentId === null ? { parentId } : {}),
    ...(logicalId !== undefined ? { logicalId } : {}),
    ...(sourceEntryId !== undefined ? { sourceEntryId } : {}),
    ...(authoritativeEntryId !== undefined ? { authoritativeEntryId } : {}),
    ...(canonicalIndex !== undefined ? { canonicalIndex } : {}),
    ...(turnId !== undefined ? { turnId } : {}),
  };
}

interface TaskResultMetadataLike {
  readonly type: 'task_result';
  readonly source: 'workflow' | 'child_task';
  readonly taskId: string;
  readonly runId?: string;
  readonly status: 'completed' | 'failed' | 'cancelled';
  readonly title?: string;
  readonly summary?: string;
}

function isTaskResultMetadataLike(value: unknown): value is TaskResultMetadataLike {
  if (!isRecord(value)) return false;
  return (
    value.type === 'task_result' &&
    (value.source === 'workflow' || value.source === 'child_task') &&
    typeof value.taskId === 'string' &&
    (value.status === 'completed' || value.status === 'failed' || value.status === 'cancelled') &&
    (value.runId === undefined || typeof value.runId === 'string') &&
    (value.title === undefined || typeof value.title === 'string') &&
    (value.summary === undefined || typeof value.summary === 'string')
  );
}

function extractTaskResults(entry: {
  readonly taskResults?: unknown;
  readonly payload?: unknown;
  readonly message?: unknown;
}): TaskResultMetadataLike[] {
  const out: TaskResultMetadataLike[] = [];
  collectTaskResults(entry.taskResults, out);
  collectTaskResults(entry.payload, out);
  if (isRecord(entry.message)) {
    collectTaskResults(entry.message._taskResult, out);
    collectTaskResults(entry.message._taskResults, out);
  }
  return out;
}

function collectTaskResults(value: unknown, out: TaskResultMetadataLike[]): void {
  if (Array.isArray(value)) {
    for (const item of value) collectTaskResults(item, out);
    return;
  }
  if (isRecord(value) && Array.isArray(value.results)) {
    collectTaskResults(value.results, out);
    return;
  }
  if (isTaskResultMetadataLike(value)) {
    out.push(value);
  }
}

function appendWorkflowTaskResultNotices(
  taskResults: readonly TaskResultMetadataLike[],
  seenWorkflowRunIds: Set<string>,
  items: SessionHistoryItem[],
  historyIdentity: HistoryTranscriptIdentity = {},
): void {
  for (const result of taskResults) {
    if (result.source !== 'workflow') continue;
    const key = result.runId ?? result.taskId;
    if (seenWorkflowRunIds.has(key)) continue;
    seenWorkflowRunIds.add(key);
    items.push({
      ...historyIdentity,
      kind: 'workflow_notice',
      text: formatWorkflowTaskResultNotice(result),
    });
  }
}

function formatWorkflowTaskResultNotice(result: TaskResultMetadataLike): string {
  const id = result.runId ?? result.taskId;
  const title = result.title?.trim();
  const header = `[workflow] ${result.status}${title ? ` · ${title}` : ''}${id ? ` · ${id}` : ''}`;
  const summary = result.summary?.trim();
  return clampHistoryText(summary ? `${header}\n${summary}` : header);
}

function parseEntrySentAt(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const ms = Date.parse(value);
    return Number.isFinite(ms) ? ms : undefined;
  }
  return undefined;
}

/** user message content 提取纯文本部分;若 content 是 string 直接返回;若是 blocks 数组取 type=='text'.
 *  tool_result blocks 不在这里出 — 它们在 history handler 第一步单独收集映射到 toolId。 */
function extractUserText(content: unknown): string {
  if (typeof content === 'string') return clampHistoryText(content);
  if (!Array.isArray(content)) return '';
  let text = '';
  for (const block of content) {
    if (!block || typeof block !== 'object') continue;
    const t = (block as { type?: unknown }).type;
    if (t === 'text') {
      const s = (block as { text?: unknown }).text;
      if (typeof s === 'string') text += s;
    }
    // tool_result / image / 其他 — 跳过
  }
  return clampHistoryText(text);
}

function extractUserImages(content: unknown): Array<{
  readonly path: string;
  readonly declaredMediaType?: 'image/png' | 'image/jpeg' | 'image/webp';
}> {
  if (!Array.isArray(content)) return [];
  const images: Array<{
    readonly path: string;
    readonly declaredMediaType?: 'image/png' | 'image/jpeg' | 'image/webp';
  }> = [];
  for (const block of content) {
    if (!isRecord(block) || block.type !== 'image') continue;
    const artifactPath = stringField(block.path);
    const mediaType = stringField(block.mediaType);
    if (artifactPath === undefined) continue;
    const declaredMediaType =
      mediaType === 'image/png' || mediaType === 'image/jpeg' || mediaType === 'image/webp'
        ? mediaType
        : undefined;
    images.push({
      path: artifactPath,
      ...(declaredMediaType !== undefined ? { declaredMediaType } : {}),
    });
  }
  return images;
}

/** tool_result.content 拍平: 可能是 string,可能是 content blocks 数组 (含 text/image)。
 *  只保留 text;过长截断兜底防 schema 上限报错。 */
function flattenToolResultContent(content: unknown): string {
  if (typeof content === 'string') {
    return clampTextWithMarker(content, MAX_HISTORY_TOOL_RESULT);
  }
  if (!Array.isArray(content)) return '';
  let text = '';
  for (const block of content) {
    if (!block || typeof block !== 'object') continue;
    if ((block as { type?: unknown }).type === 'text') {
      const s = (block as { text?: unknown }).text;
      if (typeof s === 'string') text += s;
    }
    // image blocks 等丢弃
  }
  return clampTextWithMarker(text, MAX_HISTORY_TOOL_RESULT);
}
