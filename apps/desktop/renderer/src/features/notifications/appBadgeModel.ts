interface AttentionSessionFlags {
  readonly pinned?: boolean;
  readonly archived?: boolean;
  readonly unread?: boolean;
}

interface AttentionRequest {
  readonly sessionId: string;
}

export interface AttentionBadgeInput {
  readonly sessionFlags: Readonly<Record<string, AttentionSessionFlags | undefined>>;
  readonly permissionRequests: readonly AttentionRequest[];
  readonly askUserRequests: readonly AttentionRequest[];
}

export function countAttentionSessions(input: AttentionBadgeInput): number {
  const sessionIds = new Set<string>();
  for (const [sessionId, flags] of Object.entries(input.sessionFlags)) {
    if (flags?.unread === true) sessionIds.add(sessionId);
  }
  for (const request of input.permissionRequests) sessionIds.add(request.sessionId);
  for (const request of input.askUserRequests) sessionIds.add(request.sessionId);
  return sessionIds.size;
}
