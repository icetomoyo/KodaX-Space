export type ConversationHistoryStatus = 'resolved' | 'partial' | 'ambiguous';
export type ConversationHistoryWarningStatus = Exclude<ConversationHistoryStatus, 'resolved'>;

/**
 * Return an immutable per-Session warning snapshot. A successful resolved read clears only the
 * selected Session; partial/ambiguous reads remain visible across Session switches and remounts.
 */
export function updateConversationHistoryWarnings(
  current: ReadonlyMap<string, ConversationHistoryWarningStatus>,
  sessionId: string,
  status: ConversationHistoryStatus | undefined,
): ReadonlyMap<string, ConversationHistoryWarningStatus> {
  const next = new Map(current);
  if (status === 'partial' || status === 'ambiguous') next.set(sessionId, status);
  else next.delete(sessionId);
  return next;
}
