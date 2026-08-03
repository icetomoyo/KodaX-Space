import { useSyncExternalStore } from 'react';
import type { SessionEvent, SessionHistoryItem } from '@kodax-space/space-ipc-schema';
import { registerSessionViewLifecycleReset, useAppStore } from '../store/appStore.js';

export interface SessionHistoryPagingState {
  readonly phase: 'idle' | 'waiting' | 'loading' | 'ready' | 'error';
  readonly revision?: string;
  readonly sourceRevision?: string;
  readonly hasMore: boolean;
  readonly nextCursor?: string;
  readonly conversationStatus?: 'resolved' | 'partial' | 'ambiguous';
  readonly surface?: 'code' | 'partner';
  readonly hasNewer?: boolean;
}

const IDLE_HISTORY_STATE: SessionHistoryPagingState = {
  phase: 'idle',
  hasMore: false,
};

const states = new Map<string, SessionHistoryPagingState>();
const listeners = new Map<string, Set<() => void>>();
const inFlight = new Map<string, { readonly token: symbol; readonly promise: Promise<void> }>();
const loadedItems = new Map<string, readonly SessionHistoryItem[]>();
const retryTimers = new Map<string, ReturnType<typeof setTimeout>>();
const retryAttempts = new Map<string, number>();
const activeTokens = new Map<string, symbol>();
const cacheOrder = new Map<string, true>();
const invalidationEpochs = new Map<string, number>();
const loadedEpochs = new Map<string, number>();
const MAX_RUNTIME_RETRY_ATTEMPTS = 30;
const MAX_CACHED_SESSION_HISTORIES = 32;

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
    const candidate = Array.from(cacheOrder.keys()).find(
      (cachedSessionId) => !activeTokens.has(cachedSessionId),
    );
    if (candidate === undefined) break;
    cacheOrder.delete(candidate);
    clearRetry(candidate);
    states.delete(candidate);
    loadedItems.delete(candidate);
    invalidationEpochs.delete(candidate);
    loadedEpochs.delete(candidate);
    listeners.delete(candidate);
    inFlight.delete(candidate);
    useAppStore.getState().evictRestoredSessionHistory(candidate);
  }
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
    (state.conversationStatus === 'partial' || state.conversationStatus === 'ambiguous')
  ) {
    // A warning already visible in the active Session must not wait for a switch-away/back cycle
    // to discover that terminal persistence repaired it. Normal resolved pages remain lazy so a
    // terminal event cannot yank an actively scrolled transcript back to its newest window.
    void requestHistory(sessionId, false, state.surface).catch(() => {});
  }
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

function applyHistoryResult(sessionId: string, data: unknown, continuation: boolean): void {
  // Kept as a narrow runtime helper below; this signature prevents exporting generated IPC types
  // through a renderer-only module.
  const result = data as {
    readonly items: readonly SessionHistoryItem[];
    readonly conversation?: { readonly status: 'resolved' | 'partial' | 'ambiguous' };
    readonly page?: {
      readonly windowMode?: 'replace' | 'prepend';
      readonly hasNewer?: boolean;
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
    return;
  }
  retryAttempts.set(sessionId, attempt);
  const delayMs = Math.min(1_000, 100 * 2 ** Math.min(4, attempt - 1));
  const timer = setTimeout(() => {
    retryTimers.delete(sessionId);
    if (!activeTokens.has(sessionId)) return;
    void requestHistory(sessionId, false, surface, retainReadyProjection).catch(() => {});
  }, delayMs);
  retryTimers.set(sessionId, timer);
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

  const pending = (async () => {
    const bridge = window.kodaxSpace;
    if (!bridge) throw new Error('KodaX Space bridge is unavailable.');
    const boundary = sessionHistoryPagingSnapshot(sessionId);
    const surface = expectedSurface ?? boundary.surface;
    if (!(retainReadyProjection && boundary.phase === 'ready')) {
      publish(sessionId, { ...boundary, phase: 'loading', ...(surface ? { surface } : {}) });
    }
    const response = await bridge.invoke('session.history', {
      sessionId,
      ...(surface !== undefined ? { expectedSurface: surface } : {}),
      ...(continueFromCurrentBoundary && boundary.nextCursor !== undefined
        ? {
            cursor: boundary.nextCursor,
            revision: boundary.revision,
            sourceRevision: boundary.sourceRevision,
          }
        : {}),
    });
    if (activeTokens.get(sessionId) !== activeToken) return;
    if (!response.ok) throw new Error(response.error?.message ?? 'Session history load failed.');
    if ((invalidationEpochs.get(sessionId) ?? 0) !== requestedEpoch) {
      // A terminal/lineage persistence boundary overtook this read. Do not install a page or a
      // diagnostic from the older source generation; restart from the newest canonical boundary.
      loadedItems.delete(sessionId);
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
    const page = response.data.page;
    if (page?.outcome === 'data_changed') {
      loadedItems.delete(sessionId);
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
          : { ...IDLE_HISTORY_STATE, phase: 'waiting' as const }),
        ...(surface ? { surface } : {}),
        ...(boundary.conversationStatus !== undefined
          ? { conversationStatus: boundary.conversationStatus }
          : {}),
      });
      scheduleRuntimeRetry(sessionId, surface, retainReadyProjection);
      return;
    }
    // A user can request an older page just after a terminal event invalidates the loaded
    // boundary. A KodaX cursor may still validly serve that immutable old snapshot, so epoch
    // mismatch must restart at newest instead of accidentally certifying an old continuation as
    // the current generation.
    applyHistoryResult(sessionId, response.data, continueFromCurrentBoundary);
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
      ...(response.data.conversation?.status !== undefined
        ? { conversationStatus: response.data.conversation.status }
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
      throw error;
    })
    .finally(() => {
      if (inFlight.get(sessionId)?.promise === pending) inFlight.delete(sessionId);
    });
  inFlight.set(sessionId, { token: activeToken, promise: pending });
  return pending;
}

export function restoreNewestSessionHistory(
  sessionId: string,
  expectedSurface: 'code' | 'partner',
): Promise<void> {
  clearRetry(sessionId);
  activateSessionHistoryPaging(sessionId);
  return requestHistory(sessionId, false, expectedSurface);
}

export function loadOlderSessionHistory(sessionId: string): Promise<void> {
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

export function activateSessionHistoryPaging(sessionId: string): void {
  activeTokens.set(sessionId, Symbol(sessionId));
  touchCache(sessionId);
}

/** Stop retries and make every in-flight response stale when a Session leaves the active view. */
export function deactivateSessionHistoryPaging(sessionId: string): void {
  activeTokens.delete(sessionId);
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
  states.clear();
  loadedItems.clear();
  cacheOrder.clear();
  invalidationEpochs.clear();
  loadedEpochs.clear();
  for (const listener of new Set(subscribers)) listener();
}

registerSessionViewLifecycleReset(resetSessionHistoryPagingLifecycle);
