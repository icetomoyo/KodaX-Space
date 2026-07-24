/**
 * Keep Runtime interaction queues global for durability/status projection, but expose only the
 * requests owned by the Session currently visible in the conversation surface.
 */
export function interactionsForSession<T extends { readonly sessionId: string }>(
  queue: readonly T[],
  sessionId: string | null,
): readonly T[] {
  if (sessionId === null) return [];
  return queue.filter((request) => request.sessionId === sessionId);
}

export interface AttentionItemOptions<T> {
  readonly maxVisible: number;
  readonly currentId: string | null;
  readonly getId: (item: T) => string;
  readonly isAwaiting: (item: T) => boolean;
}

/**
 * Keep the selected Session visible, then surface background Sessions that need human input before
 * filling the remaining capped rows in their original order.
 */
export function prioritizeAttentionItems<T>(
  items: readonly T[],
  { maxVisible, currentId, getId, isAwaiting }: AttentionItemOptions<T>,
): readonly T[] {
  if (maxVisible <= 0) return [];
  if (items.length <= maxVisible) return items;

  const head = items.slice(0, maxVisible);
  const headIds = new Set(head.map(getId));
  const currentIsHidden =
    currentId !== null &&
    !headIds.has(currentId) &&
    items.some((item) => getId(item) === currentId);
  const awaitingIsHidden = items.some((item) => isAwaiting(item) && !headIds.has(getId(item)));
  if (!currentIsHidden && !awaitingIsHidden) return head;

  const prioritized = [
    ...(currentId === null ? [] : items.filter((item) => getId(item) === currentId)),
    ...items.filter((item) => getId(item) !== currentId && isAwaiting(item)),
    ...items,
  ];
  const seen = new Set<string>();
  const visible: T[] = [];

  for (const item of prioritized) {
    const id = getId(item);
    if (seen.has(id)) continue;
    seen.add(id);
    visible.push(item);
    if (visible.length === maxVisible) break;
  }

  return visible;
}
