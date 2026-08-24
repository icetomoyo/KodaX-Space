import { useSyncExternalStore } from 'react';
import type { SessionEvent, SessionHistoryItem } from '@kodax-space/space-ipc-schema';
import { registerSessionViewLifecycleReset, useAppStore } from '../store/appStore.js';
import { invokeWithTimeout } from '../lib/ipcInvokeWithTimeout.js';
import {
  runtimeConnectionHasFreshLiveAuthority,
  runtimeProfileSessionHasActivity,
  runtimeTerminalEvidenceCandidates,
  sessionLiveProjectionHasActivity,
  type RuntimeTerminalEvidence,
} from '../store/runtimeProjectionState.js';

export interface SessionHistoryPagingState {
  readonly phase: 'idle' | 'waiting' | 'loading' | 'ready' | 'error';
  readonly revision?: string;
  readonly sourceRevision?: string;
  readonly hasMore: boolean;
  readonly nextCursor?: string;
  readonly conversationStatus?: 'resolved' | 'partial' | 'ambiguous';
  readonly surface?: 'code' | 'partner';
  readonly hasNewer?: boolean;
  /** Cause of the current waiting/error cycle: the Coder Runtime is not ready for this
   * surface. Cleared by ready/data_changed/epoch-reset publishes and re-set by each
   * runtime_unavailable response, so it never outlives the cycle it describes. */
  readonly runtimeUnavailable?: boolean;
}
const IDLE_HISTORY_STATE: SessionHistoryPagingState = {
  phase: 'idle',
  hasMore: false,
};

const states = new Map<string, SessionHistoryPagingState>();
const listeners = new Map<string, Set<() => void>>();
const inFlight = new Map<
  string,
  {
    readonly token: symbol;
    readonly continuation: boolean;
    readonly promise: Promise<void>;
  }
>();
const runtimeReadyWakeups = new Map<
  string,
  { readonly token: symbol; readonly promise: Promise<void> }
>();
const loadedItems = new Map<string, readonly SessionHistoryItem[]>();
const retryTimers = new Map<string, ReturnType<typeof setTimeout>>();
const retryAttempts = new Map<string, number>();
const activeTokens = new Map<string, symbol>();
const cacheOrder = new Map<string, true>();
const invalidationEpochs = new Map<string, number>();
const loadedEpochs = new Map<string, number>();
const deferredReadyRevalidations = new Set<string>();
type TerminalHistoryWorkflowStatus = 'pending' | 'in-flight' | 'completed';
interface TerminalHistoryWorkflowGroup {
  readonly runtimeId: string;
  readonly nextGeneration: number;
  readonly runs: readonly {
    readonly runId: string;
    readonly generation: number;
    readonly status: TerminalHistoryWorkflowStatus;
  }[];
}
interface TerminalHistoryRequestScope {
  readonly runtimeId: string;
  readonly runs: readonly { readonly runId: string; readonly generation: number }[];
}
const terminalHistoryEvidenceBySession = new Map<string, TerminalHistoryWorkflowGroup>();
const MAX_TERMINAL_HISTORY_RUN_IDS = 16;
const MAX_RUNTIME_RETRY_ATTEMPTS = 30;
const MAX_CACHED_SESSION_HISTORIES = 32;
const MAX_NEWEST_STITCH_PAGES = 16;
let historyRequestOrdinal = 0;

function updateTerminalHistoryWorkflow(
  sessionId: string,
  runId: string,
  status: TerminalHistoryWorkflowStatus,
): void {
  const group = terminalHistoryEvidenceBySession.get(sessionId);
  if (group === undefined) return;
  terminalHistoryEvidenceBySession.set(sessionId, {
    ...group,
    runs: group.runs.map((run) => (run.runId === runId ? { ...run, status } : run)),
  });
}

function updateAllTerminalHistoryWorkflows(
  sessionId: string,
  from: TerminalHistoryWorkflowStatus,
  to: TerminalHistoryWorkflowStatus,
): void {
  const group = terminalHistoryEvidenceBySession.get(sessionId);
  if (group === undefined) return;
  terminalHistoryEvidenceBySession.set(sessionId, {
    ...group,
    runs: group.runs.map((run) => (run.status === from ? { ...run, status: to } : run)),
  });
}

function terminalHistoryWorkflowPending(sessionId: string): boolean {
  return (
    terminalHistoryEvidenceBySession
      .get(sessionId)
      ?.runs.some((run) => run.status !== 'completed') === true
  );
}

function captureTerminalHistoryRequestScope(
  sessionId: string,
): TerminalHistoryRequestScope | undefined {
  const group = terminalHistoryEvidenceBySession.get(sessionId);
  if (group === undefined) return undefined;
  const runs = group.runs
    .filter((run) => run.status !== 'completed')
    .map(({ runId, generation }) => ({ runId, generation }));
  if (runs.length === 0) return undefined;
  terminalHistoryEvidenceBySession.set(sessionId, {
    ...group,
    runs: group.runs.map((run) =>
      run.status === 'completed' ? run : { ...run, status: 'in-flight' as const },
    ),
  });
  return { runtimeId: group.runtimeId, runs };
}

/** Complete only evidence that existed when this authoritative newest-page read started. */
function completeTerminalHistoryRequestScope(
  sessionId: string,
  scope: TerminalHistoryRequestScope | undefined,
): boolean {
  if (scope === undefined) return false;
  const group = terminalHistoryEvidenceBySession.get(sessionId);
  if (group === undefined || group.runtimeId !== scope.runtimeId) return true;
  const generations = new Map(scope.runs.map((run) => [run.runId, run.generation]));
  const runs = group.runs.map((run) =>
    generations.get(run.runId) === run.generation ? { ...run, status: 'completed' as const } : run,
  );
  terminalHistoryEvidenceBySession.set(sessionId, { ...group, runs });
  return runs.some((run) => run.status !== 'completed');
}

function nextHistoryRequestId(): string {
  historyRequestOrdinal += 1;
  return `history-${historyRequestOrdinal}`;
}

function clearRetry(sessionId: string): void {
  const timer = retryTimers.get(sessionId);
  if (timer !== undefined) clearTimeout(timer);
  retryTimers.delete(sessionId);
  retryAttempts.delete(sessionId);
}

function touchCache(sessionId: string): void {
  cacheOrder.delete(sessionId);
  cacheOrder.set(sessionId, true);
  while (cacheOrder.size > MAX_CACHED_SESSION_HISTORIES) {
    const cachedSessionIds = Array.from(cacheOrder.keys());
    const inactiveCandidates = cachedSessionIds.filter(
      (cachedSessionId) => !activeTokens.has(cachedSessionId),
    );
    const candidate =
      inactiveCandidates.find(
        (cachedSessionId) => !sessionHasKnownRuntimeActivity(cachedSessionId),
      ) ??
      inactiveCandidates[0] ??
      cachedSessionIds.find((cachedSessionId) => cachedSessionId !== sessionId);
    if (candidate === undefined) break;
    // Runtime activity makes a canonical history window the last eviction choice, not an
    // unbounded exemption. The independent live projection remains available and selection will
    // reload the evicted history. The final fallback also invalidates a pathological surplus of
    // simultaneous paging activations so their late replies cannot repopulate the cache.
    activeTokens.delete(candidate);
    cacheOrder.delete(candidate);
    clearRetry(candidate);
    states.delete(candidate);
    loadedItems.delete(candidate);
    invalidationEpochs.delete(candidate);
    loadedEpochs.delete(candidate);
    deferredReadyRevalidations.delete(candidate);
    terminalHistoryEvidenceBySession.delete(candidate);
    listeners.delete(candidate);
    inFlight.delete(candidate);
    useAppStore.getState().evictRestoredSessionHistory(candidate);
  }
}

function sessionHasKnownRuntimeActivity(sessionId: string): boolean {
  const state = useAppStore.getState();
  if (sessionLiveProjectionHasActivity(state.liveProjectionBySession[sessionId])) return true;
  if (!runtimeConnectionHasFreshLiveAuthority(state.runtimeConnection)) return false;
  const profile = state.runtimeProfile;
  if (profile === null || profile.connection.runtimeId !== state.runtimeConnection.runtimeId) {
    return false;
  }
  return runtimeProfileSessionHasActivity(
    profile.sessions.find((session) => session.sessionId === sessionId),
  );
}

function publish(sessionId: string, state: SessionHistoryPagingState): void {
  states.set(sessionId, state);
  for (const listener of listeners.get(sessionId) ?? []) listener();
}

function subscribe(sessionId: string, listener: () => void): () => void {
  let bucket = listeners.get(sessionId);
  if (!bucket) {
    bucket = new Set();
    listeners.set(sessionId, bucket);
  }
  bucket.add(listener);
  return () => {
    bucket!.delete(listener);
    if (bucket!.size === 0) listeners.delete(sessionId);
  };
}

export function sessionHistoryPagingSnapshot(sessionId: string): SessionHistoryPagingState {
  return states.get(sessionId) ?? IDLE_HISTORY_STATE;
}

/**
 * Runtime observation is substantially more expensive than the bounded canonical history read
 * and shares the same daemon transport. During a Session switch, let the visible history settle
 * first so live/Actor bootstrap cannot head-of-line block the first paint. An error is terminal for
 * this activation attempt and must release the gate rather than leaving Runtime state unavailable.
 */
export function historyPhaseAllowsRuntimeObservation(
  phase: SessionHistoryPagingState['phase'],
): boolean {
  return phase === 'ready' || phase === 'error';
}

export function sessionHistoryAllowsRuntimeObservation(sessionId: string): boolean {
  return historyPhaseAllowsRuntimeObservation(sessionHistoryPagingSnapshot(sessionId).phase);
}

/** Runtime-recovery wakes must also reach the terminal runtime-unavailable error state: the
 * visible transcript notice promises that history returns with the Runtime, and App-level
 * runtime edges are its only automatic trigger. */
function wakableFromRuntimeRecovery(state: SessionHistoryPagingState): boolean {
  return (
    state.phase === 'waiting' || (state.phase === 'error' && state.runtimeUnavailable === true)
  );
}

/** The paging cache is the sole authority for whether Shell may skip a canonical reload. */
export function hasReadySessionHistory(sessionId: string): boolean {
  const state = states.get(sessionId);
  return (
    state?.phase === 'ready' &&
    loadedItems.has(sessionId) &&
    loadedEpochs.get(sessionId) === (invalidationEpochs.get(sessionId) ?? 0) &&
    state.conversationStatus !== 'partial' &&
    state.conversationStatus !== 'ambiguous'
  );
}

/**
 * These live events are emitted only after a Runtime operation can have changed canonical
 * conversation storage. They invalidate a cached page boundary; ordinary streaming fragments do
 * not. The next activation therefore re-reads the authoritative newest page without polling on
 * every token or guessing from timestamps/content.
 */
export function sessionEventInvalidatesHistoryCache(kind: SessionEvent['kind']): boolean {
  return kind === 'session_complete' || kind === 'session_error' || kind === 'lineage_notice';
}

export function invalidateSessionHistoryPaging(sessionId: string): void {
  if (!states.has(sessionId) && !loadedItems.has(sessionId) && !inFlight.has(sessionId)) return;
  invalidationEpochs.set(sessionId, (invalidationEpochs.get(sessionId) ?? 0) + 1);
  const state = states.get(sessionId);
  if (
    activeTokens.has(sessionId) &&
    state?.phase === 'ready' &&
    state.hasNewer !== true &&
    (state.conversationStatus === 'partial' || state.conversationStatus === 'ambiguous')
  ) {
    // A warning already visible in the active Session must not wait for a switch-away/back cycle
    // to discover that terminal persistence repaired it. Normal resolved pages remain lazy so a
    // terminal event cannot yank an actively scrolled transcript back to its newest window.
    void requestHistory(sessionId, false, state.surface, true).catch((error: unknown) => {
      console.error('[session.history] active reconciliation failed', { sessionId, error });
    });
  }
}

/**
 * A terminal Runtime boundary means the newest canonical page may now contain rows that were not
 * durable during the preceding live read. Reconcile the newest page for the exact Runtime Run;
 * the read that satisfies evidence must start after that evidence exists. Duplicate profile/live
 * facts are idempotent, a request cannot settle evidence that arrived while it was in flight, and
 * an explicitly older browsing window is never replaced underneath the user.
 */
export function reconcileTerminalSessionHistory(evidence: RuntimeTerminalEvidence): Promise<void> {
  const previousGroup = terminalHistoryEvidenceBySession.get(evidence.sessionId);
  const currentGroup =
    previousGroup?.runtimeId === evidence.runtimeId
      ? previousGroup
      : { runtimeId: evidence.runtimeId, nextGeneration: 1, runs: [] };
  const previousRun = currentGroup.runs.find((run) => run.runId === evidence.runId);
  if (previousRun !== undefined) {
    return inFlight.get(evidence.sessionId)?.promise ?? Promise.resolve();
  }
  terminalHistoryEvidenceBySession.set(evidence.sessionId, {
    ...currentGroup,
    nextGeneration: currentGroup.nextGeneration + 1,
    runs: [
      ...currentGroup.runs,
      {
        runId: evidence.runId,
        generation: currentGroup.nextGeneration,
        status: 'pending' as const,
      },
    ].slice(-MAX_TERMINAL_HISTORY_RUN_IDS),
  });

  const state = sessionHistoryPagingSnapshot(evidence.sessionId);
  if (state.hasNewer === true) {
    updateTerminalHistoryWorkflow(evidence.sessionId, evidence.runId, 'completed');
    return Promise.resolve();
  }
  if (
    !states.has(evidence.sessionId) &&
    !loadedItems.has(evidence.sessionId) &&
    !inFlight.has(evidence.sessionId)
  ) {
    return Promise.resolve();
  }

  deferredReadyRevalidations.delete(evidence.sessionId);
  invalidateSessionHistoryPaging(evidence.sessionId);
  if (!activeTokens.has(evidence.sessionId)) return Promise.resolve();
  updateTerminalHistoryWorkflow(evidence.sessionId, evidence.runId, 'in-flight');
  return requestHistory(evidence.sessionId, false, state.surface, state.phase === 'ready');
}

/**
 * An older bounded window can have no DOM row in common with the newer window it replaces.
 * Its semantic seam is therefore the older window's newest (bottom) edge.
 */
export function olderHistoryWindowSeamScrollTop(
  scrollHeight: number,
  clientHeight: number,
): number {
  return Math.max(0, scrollHeight - clientHeight);
}

/**
 * `content-visibility: auto` can replace several intrinsic row estimates after the first restored
 * paint. Recheck the canonical anchor sparsely for a bounded half-second window: this covers the
 * delayed materialization without forcing layout on every animation frame.
 */
export const PREPEND_ANCHOR_CORRECTION_FRAME_OFFSETS = [0, 1, 2, 4, 6, 9, 13, 18, 24, 32] as const;

/**
 * A repeated upward gesture at the physical top cannot move the transcript. During the short
 * prepend restoration window it must not cancel the only operation that makes the newly inserted
 * page continuous. Once restoration has moved away from the boundary, the next real gesture wins.
 */
export function preservesPrependAnchorForBoundaryInput(
  phase: 'loading' | 'restoring' | undefined,
  towardOlderHistory: boolean,
  scrollTop: number,
): boolean {
  return phase === 'restoring' && towardOlderHistory && scrollTop <= 1;
}

export function useSessionHistoryPaging(sessionId: string | null): SessionHistoryPagingState {
  return useSyncExternalStore(
    (listener) => (sessionId === null ? () => undefined : subscribe(sessionId, listener)),
    () => (sessionId === null ? IDLE_HISTORY_STATE : sessionHistoryPagingSnapshot(sessionId)),
    () => IDLE_HISTORY_STATE,
  );
}

function mergeLoadedHistoryItems(
  previous: readonly SessionHistoryItem[],
  incoming: readonly SessionHistoryItem[],
): readonly SessionHistoryItem[] {
  const previousConversation = previous.filter(
    (item) => item.kind !== 'history_truncation' && item.kind !== 'local_notice',
  );
  const incomingConversation = incoming.filter(
    (item) => item.kind !== 'history_truncation' && item.kind !== 'local_notice',
  );
  const truncation = incoming.find((item) => item.kind === 'history_truncation');
  const notices = new Map<string, Extract<SessionHistoryItem, { readonly kind: 'local_notice' }>>();
  for (const item of [...previous, ...incoming]) {
    if (item.kind === 'local_notice') notices.set(item.id, item);
  }
  return [
    ...(truncation !== undefined ? [truncation] : []),
    ...incomingConversation,
    ...previousConversation,
    ...[...notices.values()].sort((left, right) => left.sentAt - right.sentAt),
  ];
}

type HistoryUserItem = Extract<SessionHistoryItem, { readonly kind: 'user' }>;
type CanonicalHistoryItem = Exclude<
  SessionHistoryItem,
  { readonly kind: 'history_truncation' | 'local_notice' }
> & { readonly entryId: string; readonly canonicalIndex: number };

function sameHistoryUserSemantic(left: HistoryUserItem, right: HistoryUserItem): boolean {
  if (left.content !== right.content) return false;
  const attachmentSemantic = (item: HistoryUserItem): string =>
    JSON.stringify(
      (item.attachments ?? []).map(({ id, kind, mediaType, bytes, status }) => ({
        id,
        kind,
        mediaType,
        bytes,
        status,
      })),
    );
  return attachmentSemantic(left) === attachmentSemantic(right);
}

/** Physical Runtime identity plus canonical position is the proof that two bounded pages overlap. */
function sameCanonicalHistoryItem(
  left: CanonicalHistoryItem,
  right: CanonicalHistoryItem,
): boolean {
  if (
    left.kind !== right.kind ||
    left.entryId === undefined ||
    right.entryId === undefined ||
    left.entryId !== right.entryId ||
    left.canonicalIndex === undefined ||
    left.canonicalIndex !== right.canonicalIndex
  ) {
    return false;
  }
  if (left.turnId !== undefined && right.turnId !== undefined && left.turnId !== right.turnId) {
    return false;
  }
  if (left.kind !== 'user' || right.kind !== 'user') return true;
  if (!sameHistoryUserSemantic(left, right)) return false;
  return !(
    left.turnUserOrdinal !== undefined &&
    right.turnUserOrdinal !== undefined &&
    left.turnUserOrdinal !== right.turnUserOrdinal
  );
}

function hasCanonicalHistoryIdentity(item: SessionHistoryItem): item is CanonicalHistoryItem {
  return (
    item.kind !== 'history_truncation' &&
    item.kind !== 'local_notice' &&
    item.entryId !== undefined &&
    item.canonicalIndex !== undefined
  );
}

function canonicalHistoryItemsOverlap(
  loaded: readonly SessionHistoryItem[],
  incoming: readonly SessionHistoryItem[],
): boolean {
  const loadedItemsByIndex = new Map<number, CanonicalHistoryItem[]>();
  for (const item of loaded) {
    if (hasCanonicalHistoryIdentity(item)) {
      const candidates = loadedItemsByIndex.get(item.canonicalIndex) ?? [];
      candidates.push(item);
      loadedItemsByIndex.set(item.canonicalIndex, candidates);
    }
  }
  return incoming.some((item) => {
    if (!hasCanonicalHistoryIdentity(item)) return false;
    return (
      loadedItemsByIndex
        .get(item.canonicalIndex)
        ?.some((candidate) => sameCanonicalHistoryItem(candidate, item)) === true
    );
  });
}

interface HistoryResultData {
  readonly sessionId: string;
  readonly requestId: string;
  readonly items: readonly SessionHistoryItem[];
  readonly conversation?: { readonly status: 'resolved' | 'partial' | 'ambiguous' };
  readonly page?:
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
    | { readonly outcome: 'runtime_unavailable' };
}

function applyHistoryResult(sessionId: string, data: unknown, continuation: boolean): void {
  // Kept as a narrow runtime helper below; this signature prevents exporting generated IPC types
  // through a renderer-only module.
  const result = data as {
    readonly items: readonly SessionHistoryItem[];
    readonly conversation?: { readonly status: 'resolved' | 'partial' | 'ambiguous' };
    readonly page?: {
      readonly windowMode?: 'replace' | 'prepend';
      readonly hasNewer?: boolean;
      readonly outcome?: 'ready' | 'data_changed' | 'runtime_unavailable';
      readonly sourceRevision?: string;
    };
  };
  const nextItems =
    continuation && result.page?.windowMode === 'prepend'
      ? mergeLoadedHistoryItems(loadedItems.get(sessionId) ?? [], result.items)
      : [...result.items];
  loadedItems.set(sessionId, nextItems);
  const store = useAppStore.getState();
  const session = store.sessions.find((candidate) => candidate.sessionId === sessionId);
  store.prependSessionHistory(sessionId, nextItems, session?.createdAt ?? Date.now(), {
    replaceLoadedWindow: true,
    // A prepend retains the newest canonical page already resident in nextItems, so the live
    // projection still belongs at its bottom. Only a true replacement browsing window excludes it.
    includeLiveProjection: result.page?.windowMode === 'prepend' || result.page?.hasNewer !== true,
    ...(result.page?.sourceRevision !== undefined
      ? { sourceRevision: result.page.sourceRevision }
      : {}),
    ...(!continuation &&
    result.page?.outcome === 'ready' &&
    result.page.hasNewer !== true &&
    result.conversation?.status === 'resolved'
      ? { authoritativeNewest: true }
      : {}),
    ...(result.conversation?.status !== undefined
      ? { conversationStatus: result.conversation.status }
      : {}),
  });
}

function scheduleRuntimeRetry(
  sessionId: string,
  surface: 'code' | 'partner' | undefined,
  retainReadyProjection = false,
): void {
  if (retryTimers.has(sessionId) || !activeTokens.has(sessionId)) return;
  const attempt = (retryAttempts.get(sessionId) ?? 0) + 1;
  if (attempt > MAX_RUNTIME_RETRY_ATTEMPTS) {
    const current = sessionHistoryPagingSnapshot(sessionId);
    publish(sessionId, { ...current, phase: 'error' });
    retryAttempts.delete(sessionId);
    updateAllTerminalHistoryWorkflows(sessionId, 'in-flight', 'pending');
    return;
  }
  retryAttempts.set(sessionId, attempt);
  const delayMs = Math.min(1_000, 100 * 2 ** Math.min(4, attempt - 1));
  const timer = setTimeout(() => {
    retryTimers.delete(sessionId);
    if (!activeTokens.has(sessionId)) return;
    void requestHistory(sessionId, false, surface, retainReadyProjection).catch(
      (error: unknown) => {
        console.error('[session.history] retry failed', { sessionId, error });
        if (activeTokens.has(sessionId)) {
          scheduleRuntimeRetry(sessionId, surface, retainReadyProjection);
        }
      },
    );
  }, delayMs);
  retryTimers.set(sessionId, timer);
}

function sessionHasOpenLiveTurn(sessionId: string): boolean {
  const state = useAppStore.getState();
  if (state.pendingSendBySession[sessionId] === true) return true;
  const snapshotRequired = state.runtimeSnapshotRequiredBySession[sessionId] === true;
  let activeRunId: string | undefined;
  if (!snapshotRequired && runtimeConnectionHasFreshLiveAuthority(state.runtimeConnection)) {
    const runtimeId = state.runtimeConnection.runtimeId;
    const terminalRunIds = new Set(
      runtimeTerminalEvidenceCandidates(
        {
          connection: state.runtimeConnection,
          profile: state.runtimeProfile,
          liveBySession: state.liveProjectionBySession,
        },
        sessionId,
      ).map((terminal) => terminal.runId),
    );
    const live = state.liveProjectionBySession[sessionId];
    const liveActiveRunId =
      live !== undefined &&
      live.cursor.runtimeId === runtimeId &&
      live.activeRun !== undefined &&
      !terminalRunIds.has(live.activeRun.runId)
        ? live.activeRun?.runId
        : undefined;
    const runtimeProfile = state.runtimeProfile;
    const profileSession =
      runtimeProfile !== null && runtimeProfile.connection.runtimeId === runtimeId
        ? runtimeProfile.sessions.find((session) => session.sessionId === sessionId)
        : undefined;
    const profileActiveRunId =
      profileSession?.activeRun !== undefined && !terminalRunIds.has(profileSession.activeRun.runId)
        ? profileSession.activeRun.runId
        : undefined;
    activeRunId = liveActiveRunId ?? profileActiveRunId;
  }
  const events = state.eventsBySession[sessionId] ?? [];
  for (let index = events.length - 1; index >= 0; index--) {
    const event = events[index]!;
    const runtimeRunId = 'runtimeEvent' in event ? event.runtimeEvent?.runId : undefined;
    if (snapshotRequired && event.kind === 'session_start' && runtimeRunId === undefined) continue;
    if (runtimeRunId !== undefined && runtimeRunId !== activeRunId) continue;
    if (event.kind === 'session_complete' || event.kind === 'session_error') {
      if (runtimeRunId === undefined && activeRunId !== undefined) continue;
      return false;
    }
    if (event.kind === 'session_start') return true;
  }
  // Runtime event buffers are replayable paint data, not current lifecycle authority. A stale
  // scoped start with no matching active projection therefore cannot block canonical history.
  return activeRunId !== undefined;
}

async function requestHistory(
  sessionId: string,
  continuation: boolean,
  expectedSurface?: 'code' | 'partner',
  retainReadyProjection = false,
): Promise<void> {
  const activeToken = activeTokens.get(sessionId);
  if (activeToken === undefined) return;
  const existing = inFlight.get(sessionId);
  if (existing?.token === activeToken) return existing.promise;
  const previous = sessionHistoryPagingSnapshot(sessionId);
  const requestedEpoch = invalidationEpochs.get(sessionId) ?? 0;
  const continueFromCurrentBoundary =
    continuation && loadedEpochs.get(sessionId) === requestedEpoch;
  if (continueFromCurrentBoundary && (!previous.hasMore || previous.nextCursor === undefined)) {
    return;
  }
  const terminalHistoryRequestScope = continuation
    ? undefined
    : captureTerminalHistoryRequestScope(sessionId);

  const pending = (async () => {
    const bridge = window.kodaxSpace;
    if (!bridge) throw new Error('KodaX Space bridge is unavailable.');
    const boundary = sessionHistoryPagingSnapshot(sessionId);
    const surface = expectedSurface ?? boundary.surface;
    if (!(retainReadyProjection && boundary.phase === 'ready')) {
      publish(sessionId, { ...boundary, phase: 'loading', ...(surface ? { surface } : {}) });
    }
    const invokeHistoryPage = async (pageBoundary?: {
      readonly cursor: string;
      readonly revision?: string;
      readonly sourceRevision?: string;
    }): Promise<HistoryResultData> => {
      const requestId = nextHistoryRequestId();
      const response = await invokeWithTimeout(bridge, 'session.history', {
        sessionId,
        requestId,
        ...(surface !== undefined ? { expectedSurface: surface } : {}),
        ...(pageBoundary !== undefined
          ? {
              cursor: pageBoundary.cursor,
              revision: pageBoundary.revision,
              sourceRevision: pageBoundary.sourceRevision,
            }
          : {}),
      });
      if (!response.ok) throw new Error(response.error?.message ?? 'Session history load failed.');
      if (response.data.sessionId !== sessionId || response.data.requestId !== requestId) {
        console.error('[session.history] rejected a response with foreign ownership', {
          requestedSessionId: sessionId,
          responseSessionId: response.data.sessionId,
          requestId,
          responseRequestId: response.data.requestId,
        });
        throw new Error('Session history response ownership mismatch.');
      }
      return response.data;
    };
    let result = await invokeHistoryPage(
      continueFromCurrentBoundary && boundary.nextCursor !== undefined
        ? {
            cursor: boundary.nextCursor,
            revision: boundary.revision,
            sourceRevision: boundary.sourceRevision,
          }
        : undefined,
    );
    if (activeTokens.get(sessionId) !== activeToken) return;
    if ((invalidationEpochs.get(sessionId) ?? 0) !== requestedEpoch) {
      // A terminal/lineage persistence boundary overtook this read. Do not install a page or a
      // diagnostic from the older source generation; restart from the newest canonical boundary.
      loadedEpochs.delete(sessionId);
      publish(sessionId, {
        ...(retainReadyProjection && previous.phase === 'ready'
          ? previous
          : { ...IDLE_HISTORY_STATE, phase: 'waiting' as const }),
        ...(surface ? { surface } : {}),
        ...(previous.conversationStatus !== undefined
          ? { conversationStatus: previous.conversationStatus }
          : {}),
      });
      scheduleRuntimeRetry(sessionId, surface, retainReadyProjection);
      return;
    }
    let page = result.page;
    if (page?.outcome === 'data_changed') {
      loadedEpochs.delete(sessionId);
      publish(sessionId, {
        ...(retainReadyProjection && previous.phase === 'ready' ? previous : IDLE_HISTORY_STATE),
        ...(surface ? { surface } : {}),
        ...(boundary.conversationStatus !== undefined
          ? { conversationStatus: boundary.conversationStatus }
          : {}),
      });
      scheduleRuntimeRetry(sessionId, surface, retainReadyProjection);
      return;
    }
    if (page?.outcome === 'runtime_unavailable') {
      publish(sessionId, {
        ...(retainReadyProjection && previous.phase === 'ready'
          ? previous
          : { ...IDLE_HISTORY_STATE, phase: 'waiting' as const, runtimeUnavailable: true }),
        ...(surface ? { surface } : {}),
        ...(boundary.conversationStatus !== undefined
          ? { conversationStatus: boundary.conversationStatus }
          : {}),
      });
      scheduleRuntimeRetry(sessionId, surface, retainReadyProjection);
      return;
    }
    const installsPrepend = continueFromCurrentBoundary && page?.windowMode === 'prepend';
    if (!installsPrepend && previous.phase === 'ready' && sessionHasOpenLiveTurn(sessionId)) {
      // A background revalidation can overtake the next run and return a canonical copy of its
      // still-open turn. Replacing an already-painted ready window here would overlap that copy
      // with the live projection and temporarily reorder or suppress streaming content. Keep the
      // prior canonical window until the run reaches its persistence boundary; that terminal
      // event invalidates and revalidates the newest generation. Only a response that will
      // actually install as an immutable prepend window may proceed while a Run is open: an
      // invalidated continuation restarts at newest and therefore needs this same deferral.
      if (sessionHistoryPagingSnapshot(sessionId).phase !== 'ready') {
        publish(sessionId, previous);
      }
      deferredReadyRevalidations.add(sessionId);
      return;
    }
    const previouslyLoaded = loadedItems.get(sessionId) ?? [];
    if (
      !continueFromCurrentBoundary &&
      loadedItems.has(sessionId) &&
      page?.outcome === 'ready' &&
      page.windowMode === 'replace' &&
      page.hasMore &&
      page.nextCursor !== undefined &&
      previouslyLoaded.some(hasCanonicalHistoryIdentity) &&
      !canonicalHistoryItemsOverlap(previouslyLoaded, result.items)
    ) {
      const newestPage = page;
      let stagedItems = [...result.items];
      let foundOverlap = false;
      let reachedResolvedRoot = false;
      for (let pageCount = 1; pageCount < MAX_NEWEST_STITCH_PAGES; pageCount += 1) {
        const stagedPage = result.page;
        if (
          stagedPage?.outcome !== 'ready' ||
          !stagedPage.hasMore ||
          stagedPage.nextCursor === undefined
        ) {
          break;
        }
        const older = await invokeHistoryPage({
          cursor: stagedPage.nextCursor,
          revision: stagedPage.revision,
          sourceRevision: stagedPage.sourceRevision,
        });
        if (activeTokens.get(sessionId) !== activeToken) return;
        if ((invalidationEpochs.get(sessionId) ?? 0) !== requestedEpoch) {
          if (previous.phase === 'ready') publish(sessionId, previous);
          scheduleRuntimeRetry(
            sessionId,
            surface,
            previous.phase === 'ready' || retainReadyProjection,
          );
          return;
        }
        const olderPage = older.page;
        if (
          olderPage?.outcome !== 'ready' ||
          olderPage.revision !== newestPage.revision ||
          olderPage.sourceRevision !== newestPage.sourceRevision
        ) {
          if (previous.phase === 'ready') publish(sessionId, previous);
          scheduleRuntimeRetry(sessionId, surface, true);
          return;
        }
        stagedItems = [...mergeLoadedHistoryItems(stagedItems, older.items)];
        result = older;
        if (canonicalHistoryItemsOverlap(previouslyLoaded, older.items)) {
          foundOverlap = true;
          result = {
            ...older,
            items: stagedItems,
            conversation: result.conversation,
            page: {
              ...olderPage,
              windowMode: 'replace',
              hasNewer: newestPage.hasNewer,
            },
          };
          page = result.page;
          break;
        }
        if (!olderPage.hasMore && older.conversation?.status === 'resolved') {
          reachedResolvedRoot = true;
          break;
        }
      }
      if (!foundOverlap) {
        if (reachedResolvedRoot) {
          const resetNewest = await invokeHistoryPage();
          if (activeTokens.get(sessionId) !== activeToken) return;
          if ((invalidationEpochs.get(sessionId) ?? 0) !== requestedEpoch) {
            if (previous.phase === 'ready') publish(sessionId, previous);
            scheduleRuntimeRetry(
              sessionId,
              surface,
              previous.phase === 'ready' || retainReadyProjection,
            );
            return;
          }
          const resetPage = resetNewest.page;
          if (
            resetPage?.outcome === 'ready' &&
            resetPage.windowMode === 'replace' &&
            resetPage.revision === newestPage.revision &&
            resetPage.sourceRevision === newestPage.sourceRevision
          ) {
            result = resetNewest;
            page = resetPage;
          } else {
            if (previous.phase === 'ready') publish(sessionId, previous);
            scheduleRuntimeRetry(sessionId, surface, true);
            return;
          }
        } else {
          if (result.page?.outcome === 'ready' && result.page.hasMore) {
            // Retrying from the cursorless newest boundary would scan these same pages forever.
            // Keep the proven prior transcript painted, release observation, and make a later
            // activation/user retry start a fresh bounded attempt instead of hiding an active loop.
            clearRetry(sessionId);
            updateAllTerminalHistoryWorkflows(sessionId, 'in-flight', 'pending');
            publish(sessionId, { ...previous, phase: 'error' });
          } else if (previous.phase === 'ready') {
            publish(sessionId, previous);
          }
          return;
        }
      }
    }
    // Stitching can span several IPC round trips. Re-check the live owner immediately before the
    // single install so a Run that started after the first response gets the same deferral fence.
    if (
      !continueFromCurrentBoundary &&
      previous.phase === 'ready' &&
      sessionHasOpenLiveTurn(sessionId)
    ) {
      if (sessionHistoryPagingSnapshot(sessionId).phase !== 'ready') publish(sessionId, previous);
      deferredReadyRevalidations.add(sessionId);
      return;
    }
    const terminalHistoryNeedsRetry = completeTerminalHistoryRequestScope(
      sessionId,
      terminalHistoryRequestScope,
    );
    if (terminalHistoryNeedsRetry) {
      publish(sessionId, {
        ...(retainReadyProjection && previous.phase === 'ready'
          ? previous
          : { ...IDLE_HISTORY_STATE, phase: 'waiting' as const }),
        ...(surface ? { surface } : {}),
      });
      scheduleRuntimeRetry(sessionId, surface, retainReadyProjection);
      return;
    }
    // A user can request an older page just after a terminal event invalidates the loaded
    // boundary. A KodaX cursor may still validly serve that immutable old snapshot, so epoch
    // mismatch must restart at newest instead of accidentally certifying an old continuation as
    // the current generation.
    applyHistoryResult(sessionId, result, continueFromCurrentBoundary);
    deferredReadyRevalidations.delete(sessionId);
    loadedEpochs.set(sessionId, requestedEpoch);
    clearRetry(sessionId);
    publish(sessionId, {
      phase: 'ready',
      ...(surface !== undefined ? { surface } : {}),
      ...(page?.outcome === 'ready'
        ? {
            revision: page.revision,
            sourceRevision: page.sourceRevision,
            hasMore: page.hasMore,
            hasNewer: page.hasNewer,
            ...(page.nextCursor !== undefined ? { nextCursor: page.nextCursor } : {}),
          }
        : { hasMore: false }),
      ...(result.conversation?.status !== undefined
        ? { conversationStatus: result.conversation.status }
        : {}),
    });
  })()
    .catch((error: unknown) => {
      if (activeTokens.get(sessionId) === activeToken) {
        publish(sessionId, {
          ...previous,
          phase: retainReadyProjection && previous.phase === 'ready' ? 'ready' : 'error',
        });
      }
      updateAllTerminalHistoryWorkflows(sessionId, 'in-flight', 'pending');
      if (activeTokens.has(sessionId) && terminalHistoryWorkflowPending(sessionId)) {
        scheduleRuntimeRetry(sessionId, expectedSurface ?? previous.surface, retainReadyProjection);
      }
      throw error;
    })
    .finally(() => {
      if (inFlight.get(sessionId)?.promise === pending) inFlight.delete(sessionId);
    });
  inFlight.set(sessionId, { token: activeToken, continuation, promise: pending });
  return pending;
}

/**
 * A ready Runtime edge should not wait for the exponential retry timer left by startup. Join an
 * older in-flight read first, then issue exactly one current-generation retry if it still reports
 * waiting. The normal request token, epoch, and ownership fences remain the only install path.
 */
export function wakeWaitingSessionHistory(sessionId: string): Promise<void> {
  const activeToken = activeTokens.get(sessionId);
  if (activeToken === undefined) return Promise.resolve();
  const existingWake = runtimeReadyWakeups.get(sessionId);
  if (existingWake?.token === activeToken) return existingWake.promise;
  const existingRead = inFlight.get(sessionId);
  if (
    !wakableFromRuntimeRecovery(sessionHistoryPagingSnapshot(sessionId)) &&
    existingRead?.token !== activeToken
  ) {
    return Promise.resolve();
  }

  const pending = (async () => {
    clearRetry(sessionId);
    if (existingRead?.token === activeToken) {
      await existingRead.promise.catch(() => undefined);
    }
    if (activeTokens.get(sessionId) !== activeToken) return;
    const state = sessionHistoryPagingSnapshot(sessionId);
    if (!wakableFromRuntimeRecovery(state)) return;
    clearRetry(sessionId);
    await requestHistory(sessionId, false, state.surface);
  })().finally(() => {
    if (runtimeReadyWakeups.get(sessionId)?.promise === pending) {
      runtimeReadyWakeups.delete(sessionId);
    }
  });
  runtimeReadyWakeups.set(sessionId, { token: activeToken, promise: pending });
  return pending;
}

export function restoreNewestSessionHistory(
  sessionId: string,
  expectedSurface: 'code' | 'partner',
): Promise<void> {
  clearRetry(sessionId);
  activateSessionHistoryPaging(sessionId);
  // An invalidation makes the cached page ineligible as durable authority, but it does not make
  // the already-painted projection unsafe to retain. Reactivation can overlap the next open Run;
  // use the same open-turn deferral as ordinary revalidation so an in-flight canonical copy never
  // enters the renderer beside its live owner. A truly cold activation still installs directly.
  const cached = sessionHistoryPagingSnapshot(sessionId);
  const retainReadyProjection =
    cached.phase === 'ready' &&
    cached.conversationStatus !== 'partial' &&
    cached.conversationStatus !== 'ambiguous';
  return requestHistory(sessionId, false, expectedSurface, retainReadyProjection);
}

export async function loadOlderSessionHistory(sessionId: string): Promise<void> {
  const activeToken = activeTokens.get(sessionId);
  if (activeToken === undefined) return;
  const existing = inFlight.get(sessionId);
  if (existing?.token === activeToken) {
    if (existing.continuation) return existing.promise;
    // A retained newest revalidation leaves the older-page affordance usable. Preserve the
    // user's explicit prepend intent: wait for that replacement to establish its current cursor,
    // then continue from the same lifecycle token instead of treating the newest read as success.
    await existing.promise.catch(() => undefined);
    if (activeTokens.get(sessionId) !== activeToken) return;
  }
  return requestHistory(sessionId, true);
}

/**
 * A ready renderer page is only a paint cache, not durable authority: another KodaX process may
 * mutate the same Session without a renderer event. Revalidate on every reactivation while
 * retaining the prior projection until the generation-fenced newest page arrives.
 */
export function revalidateNewestSessionHistory(
  sessionId: string,
  expectedSurface: 'code' | 'partner',
): Promise<void> {
  clearRetry(sessionId);
  return requestHistory(sessionId, false, expectedSurface, true);
}

/** Resume a ready-page refresh only after its deferred Run has reached a terminal boundary. */
export async function refreshDeferredSessionHistory(sessionId: string): Promise<void> {
  const activeToken = activeTokens.get(sessionId);
  if (!deferredReadyRevalidations.has(sessionId) || activeToken === undefined) return;
  const pending = inFlight.get(sessionId);
  if (pending?.token === activeToken) {
    try {
      await pending.promise;
    } catch (error) {
      if (activeTokens.get(sessionId) === activeToken) {
        deferredReadyRevalidations.add(sessionId);
        const state = sessionHistoryPagingSnapshot(sessionId);
        scheduleRuntimeRetry(sessionId, state.surface, state.phase === 'ready');
      }
      throw error;
    }
  }
  if (activeTokens.get(sessionId) !== activeToken) return;
  const state = sessionHistoryPagingSnapshot(sessionId);
  if (state.phase !== 'ready') return;
  if (state.hasNewer === true) {
    deferredReadyRevalidations.delete(sessionId);
    return;
  }
  try {
    await requestHistory(sessionId, false, state.surface, true);
  } catch (error) {
    if (activeTokens.get(sessionId) === activeToken) {
      deferredReadyRevalidations.add(sessionId);
      scheduleRuntimeRetry(sessionId, state.surface, true);
    }
    throw error;
  }
}

export function activateSessionHistoryPaging(sessionId: string): void {
  activeTokens.set(sessionId, Symbol(sessionId));
  touchCache(sessionId);
}

/** Stop retries and make every in-flight response stale when a Session leaves the active view. */
export function deactivateSessionHistoryPaging(sessionId: string): void {
  activeTokens.delete(sessionId);
  deferredReadyRevalidations.delete(sessionId);
  clearRetry(sessionId);
}

/**
 * Clear every paging generation and make all outstanding replies stale. Project changes can
 * legitimately reselect an identical Session id, so retaining a ready state or loaded window
 * across resetSessionView would either suppress the canonical reload or replay the old project.
 */
export function resetSessionHistoryPagingLifecycle(): void {
  const subscribers = [...listeners.values()].flatMap((bucket) => [...bucket]);
  for (const sessionId of retryTimers.keys()) clearRetry(sessionId);
  activeTokens.clear();
  inFlight.clear();
  runtimeReadyWakeups.clear();
  states.clear();
  loadedItems.clear();
  cacheOrder.clear();
  invalidationEpochs.clear();
  loadedEpochs.clear();
  deferredReadyRevalidations.clear();
  terminalHistoryEvidenceBySession.clear();
  for (const listener of new Set(subscribers)) listener();
}

registerSessionViewLifecycleReset(resetSessionHistoryPagingLifecycle);
