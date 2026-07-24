export type RunningPeerAction = 'open' | 'explain' | 'none';

/**
 * A discovered peer can be opened only when its session already exists in the
 * renderer's authoritative session list. Writing an unknown peer id directly
 * into currentSessionId creates an orphan selection and an empty conversation.
 */
export function runningPeerAction(
  peerSessionId: string | undefined,
  currentSessionId: string | null,
  knownSessionIds: ReadonlySet<string>,
): RunningPeerAction {
  if (peerSessionId === undefined) return 'explain';
  if (peerSessionId === currentSessionId) return 'none';
  return knownSessionIds.has(peerSessionId) ? 'open' : 'explain';
}
