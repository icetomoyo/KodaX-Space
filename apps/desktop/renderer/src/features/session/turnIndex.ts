export interface TurnIndexedUserMessage {
  readonly id: string;
  readonly sentAt?: number;
  readonly historyTurnIndex?: number;
  readonly historyBoundary?: {
    readonly boundaryId: string;
    readonly sourceRevision: string;
  };
  readonly hiddenHistoryAnchor?: boolean;
  readonly hiddenProjectionDuplicate?: boolean;
}

/**
 * Local notices are ordered independently from the conversation transcript. A rewind keeps the
 * selected turn and removes the following buffer suffix, so main can truncate its complete notice
 * side-store at the first removed user's timestamp without accepting a bounded renderer snapshot.
 */
export function localNoticeCutoffSentAtForSelectorTurn(
  messages: readonly TurnIndexedUserMessage[],
  selectorTurnIndex: number,
): number | undefined {
  const selectedBufferIndex = bufferIndexForSelectorTurn(messages, selectorTurnIndex);
  if (selectedBufferIndex < 0) return undefined;
  const cutoff = messages[selectedBufferIndex + 1]?.sentAt;
  return cutoff !== undefined && Number.isSafeInteger(cutoff) && cutoff >= 0 ? cutoff : undefined;
}

export function selectorTurnIndexesByMessageId(
  messages: readonly TurnIndexedUserMessage[],
): ReadonlyMap<string, number> {
  const indexes = new Map<string, number>();
  let nextTurnIndex = 0;
  for (const message of messages) {
    if (message.hiddenHistoryAnchor === true || message.hiddenProjectionDuplicate === true) {
      continue;
    }
    const turnIndex = message.historyTurnIndex ?? nextTurnIndex;
    indexes.set(message.id, turnIndex);
    nextTurnIndex = turnIndex + 1;
  }
  return indexes;
}

export function bufferIndexForSelectorTurn(
  messages: readonly TurnIndexedUserMessage[],
  selectorTurnIndex: number,
): number {
  const indexes = selectorTurnIndexesByMessageId(messages);
  return messages.findIndex((message) => indexes.get(message.id) === selectorTurnIndex);
}

export function messageForSelectorTurn<T extends TurnIndexedUserMessage>(
  messages: readonly T[],
  selectorTurnIndex: number,
): T | undefined {
  const bufferIndex = bufferIndexForSelectorTurn(messages, selectorTurnIndex);
  return bufferIndex >= 0 ? messages[bufferIndex] : undefined;
}

export function latestSelectorTurnIndex(
  messages: readonly TurnIndexedUserMessage[],
): number | undefined {
  const values = [...selectorTurnIndexesByMessageId(messages).values()];
  return values.length > 0 ? values[values.length - 1] : undefined;
}

export function previousSelectorTurnIndex(
  messages: readonly TurnIndexedUserMessage[],
): number | undefined {
  const values = [...selectorTurnIndexesByMessageId(messages).values()];
  return values.length > 1 ? values[values.length - 2] : undefined;
}

export function canRewindSelectorTurn(
  messages: readonly TurnIndexedUserMessage[],
  selectorTurnIndex: number,
): boolean {
  const latestTurnIndex = latestSelectorTurnIndex(messages);
  return latestTurnIndex !== undefined && selectorTurnIndex < latestTurnIndex;
}
