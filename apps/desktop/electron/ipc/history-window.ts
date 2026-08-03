import type { SessionHistoryItem, SessionLocalNotice } from '@kodax-space/space-ipc-schema';

export const MAX_SESSION_HISTORY_ITEMS = 2_000;
export const MAX_RETAINED_LOCAL_NOTICES = 32;
export const MAX_RUNTIME_HISTORY_PAGE_ITEMS =
  MAX_SESSION_HISTORY_ITEMS - MAX_RETAINED_LOCAL_NOTICES;

export interface SessionHistoryItemPage {
  readonly items: readonly SessionHistoryItem[];
  /** Exclusive end offset for the next older slice of this same immutable projection. */
  readonly nextEndExclusive?: number;
}

function historyItemSentAt(item: SessionHistoryItem): number | undefined {
  return 'sentAt' in item && typeof item.sentAt === 'number' ? item.sentAt : undefined;
}

type LocalNoticeHistoryItem = Extract<SessionHistoryItem, { readonly kind: 'local_notice' }>;

function toLocalNoticeHistoryItem(notice: SessionLocalNotice): LocalNoticeHistoryItem {
  return {
    kind: 'local_notice',
    id: notice.id,
    content: notice.content,
    sentAt: notice.sentAt,
    ...(notice.variant !== undefined ? { variant: notice.variant } : {}),
  };
}

/**
 * Local notices are a timestamped UI overlay, not append-order transcript entries. Insert side-store
 * notices at their monotonic display boundary before applying the bounded history window. Appending
 * every old notice to the physical tail would let stale slash output evict newer assistant/tool
 * transcript items even though the renderer later displays that notice near its old timestamp.
 *
 * Base transcript order is never changed; timestamps are used only to choose an insertion boundary
 * for the overlay item, and the effective base timestamp is clamped monotonically.
 */
export function mergeLocalNoticeHistoryItems(
  baseItems: readonly SessionHistoryItem[],
  localNotices: readonly SessionLocalNotice[],
): SessionHistoryItem[] {
  const existingLocalIds = new Set(
    baseItems.flatMap((item) => (item.kind === 'local_notice' ? [item.id] : [])),
  );
  const localItems = localNotices
    .filter((notice) => !existingLocalIds.has(notice.id))
    .map(toLocalNoticeHistoryItem)
    .sort((left, right) => left.sentAt - right.sentAt);
  if (localItems.length === 0) return [...baseItems];

  const merged: SessionHistoryItem[] = [];
  let localIndex = 0;
  let effectiveBaseSentAt = Number.NEGATIVE_INFINITY;
  for (const item of baseItems) {
    const itemSentAt = historyItemSentAt(item);
    if (itemSentAt !== undefined && Number.isFinite(itemSentAt)) {
      effectiveBaseSentAt = Math.max(effectiveBaseSentAt, itemSentAt);
    }
    while (localIndex < localItems.length && localItems[localIndex]!.sentAt < effectiveBaseSentAt) {
      merged.push(localItems[localIndex]!);
      localIndex += 1;
    }
    merged.push(item);
  }
  merged.push(...localItems.slice(localIndex));
  return merged;
}

/**
 * Reserve a small, explicit quota for the newest Space-owned notices before selecting the
 * coherent conversation window. This prevents a full 2,000-item conversation from making every
 * durable local notice disappear, while bounding their impact to at most 32 items.
 */
export function limitSessionHistoryWithLocalNotices(
  baseItems: readonly SessionHistoryItem[],
  localNotices: readonly SessionLocalNotice[],
): SessionHistoryItem[] {
  if (localNotices.length === 0) return limitSessionHistoryItems(baseItems);
  const retainedNotices = [...localNotices]
    .sort((left, right) => left.sentAt - right.sentAt || left.id.localeCompare(right.id))
    .slice(-MAX_RETAINED_LOCAL_NOTICES);
  const boundedBase = limitSessionHistoryItems(
    baseItems,
    MAX_SESSION_HISTORY_ITEMS - retainedNotices.length,
  );
  return mergeLocalNoticeHistoryItems(boundedBase, retainedNotices);
}

function truncationItem(scope: 'history' | 'turn', omittedItems: number): SessionHistoryItem {
  return {
    kind: 'history_truncation',
    scope,
    omittedItems,
  };
}

/**
 * Page an already canonical projection without discarding an unreachable middle. Unlike the
 * legacy display limiter below, every payload row belongs to exactly one slice and the caller can
 * continue with `nextEndExclusive` until offset zero. A separate newer/older navigation state owns
 * direction; the marker only describes the still-omitted older prefix of this immutable page.
 *
 * Runtime pages reserve the maximum local-notice quota up front, so merging the overlay afterward
 * can never force a second lossy truncation.
 */
export function pageSessionHistoryItems(
  items: readonly SessionHistoryItem[],
  endExclusive = items.length,
  maxItems = MAX_RUNTIME_HISTORY_PAGE_ITEMS,
): SessionHistoryItemPage {
  if (!Number.isSafeInteger(maxItems) || maxItems < 2) {
    throw new Error('Runtime history page must reserve at least two items.');
  }
  if (!Number.isSafeInteger(endExclusive) || endExclusive < 0 || endExclusive > items.length) {
    throw new Error('Runtime history page offset is outside the immutable projection.');
  }
  if (endExclusive === 0) return { items: [] };

  const needsOlderContinuation = endExclusive > maxItems;
  const payloadLimit = needsOlderContinuation ? maxItems - 1 : maxItems;
  const start = Math.max(0, endExclusive - payloadLimit);
  return {
    items: [
      ...(start > 0 ? [truncationItem('history', start)] : []),
      ...items.slice(start, endExclusive),
    ],
    ...(start > 0 ? { nextEndExclusive: start } : {}),
  };
}

/**
 * Keep the newest coherent history window without silently presenting an old prefix as complete.
 *
 * Normal case: start at the first user boundary that fits and prepend one explicit history
 * truncation marker. If one turn alone exceeds the window, retain its owning query, mark the
 * omitted middle explicitly, and retain the newest assistant/tool tail. Tool results are already
 * paired inside one tool_call history item, so the tail cannot orphan a result from its call.
 */
export function limitSessionHistoryItems(
  items: readonly SessionHistoryItem[],
  maxItems = MAX_SESSION_HISTORY_ITEMS,
): SessionHistoryItem[] {
  if (!Number.isSafeInteger(maxItems) || maxItems < 3) {
    throw new Error('Session history window must reserve at least three items.');
  }
  if (items.length <= maxItems) return [...items];

  const payloadLimit = maxItems - 1;
  const nominalStart = items.length - payloadLimit;
  const firstCompleteTurn = items.findIndex(
    (item, index) => index >= nominalStart && item.kind === 'user',
  );

  if (firstCompleteTurn >= 0) {
    const tail = items.slice(firstCompleteTurn);
    return [truncationItem('history', items.length - tail.length), ...tail];
  }

  let owningUser = -1;
  for (let index = nominalStart - 1; index >= 0; index -= 1) {
    if (items[index]?.kind === 'user') {
      owningUser = index;
      break;
    }
  }

  if (owningUser < 0) {
    return [truncationItem('history', items.length - payloadLimit), ...items.slice(-payloadLimit)];
  }

  const prefixOmitted = owningUser;
  const prefixMarkerSlots = prefixOmitted > 0 ? 1 : 0;
  const tailLimit = maxItems - prefixMarkerSlots - 2;
  const tailStart = items.length - tailLimit;
  const turnOmitted = tailStart - owningUser - 1;

  const window: SessionHistoryItem[] = [];
  if (prefixOmitted > 0) {
    window.push(truncationItem('history', prefixOmitted));
  }
  window.push(items[owningUser]!);
  if (turnOmitted > 0) {
    window.push(truncationItem('turn', turnOmitted));
  }
  window.push(...items.slice(tailStart));
  return window;
}
