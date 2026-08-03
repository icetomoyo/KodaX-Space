import type {
  SessionMeta,
  SpaceRuntimeProfileProjectionT,
  SpaceSessionLiveProjectionT,
} from '@kodax-space/space-ipc-schema';

import { sdkEffortToReasoningMode } from '../shell/effortLadder.js';

/**
 * Apply daemon-owned settings to the renderer's session projection.
 *
 * The daemon may update `effort` without also sending Space's legacy
 * `reasoningMode`. In that case, translate the published KodaX effort rung so
 * another client's change is visible in the existing effort selector.
 */
export function mergeRuntimeSettingsIntoSessions(
  sessions: readonly SessionMeta[],
  projection: SpaceSessionLiveProjectionT,
): readonly SessionMeta[] {
  const settings = projection.settings?.value;
  if (!settings) return sessions;
  return sessions.map((session) => {
    if (session.sessionId !== projection.sessionId || session.surface !== 'code') return session;
    const effortMode = settings.effort ? sdkEffortToReasoningMode(settings.effort) : null;
    const next: SessionMeta = {
      ...session,
      ...(settings.provider ? { provider: settings.provider } : {}),
      ...(settings.reasoningMode
        ? { reasoningMode: settings.reasoningMode }
        : effortMode
          ? { reasoningMode: effortMode }
          : {}),
      ...(settings.permissionMode ? { permissionMode: settings.permissionMode } : {}),
      ...(settings.agentMode ? { agentMode: settings.agentMode } : {}),
      ...(settings.autoModeEngine ? { autoModeEngine: settings.autoModeEngine } : {}),
    };
    if (settings.model) {
      next.model = settings.model;
    } else if (settings.provider && settings.provider !== session.provider) {
      // An omitted model is not a request to erase the effective model on an
      // unrelated partial settings update. Only discard the previous model
      // when the provider itself changed, so the new provider default can win.
      delete next.model;
    }
    return next;
  });
}

/**
 * Overlay daemon-owned session timestamps onto the sidebar projection.
 *
 * `session.list` may race Runtime startup and older SDK summaries only expose
 * `createdAt`. Keeping this merge in the renderer means a later profile
 * snapshot still repairs both the displayed timestamp and recency ordering.
 */
export function mergeRuntimeActivityIntoSessions(
  sessions: readonly SessionMeta[],
  profile: SpaceRuntimeProfileProjectionT | null,
): readonly SessionMeta[] {
  if (!profile || profile.sessions.length === 0 || sessions.length === 0) return sessions;

  const runtimeBySessionId = new Map(
    profile.sessions.map((session) => [session.sessionId, session] as const),
  );
  let changed = false;
  const merged = sessions.map((session) => {
    if ((session.surface ?? 'code') !== 'code') return session;
    const runtimeSession = runtimeBySessionId.get(session.sessionId);
    if (!runtimeSession) return session;

    const createdAt = session.createdAt > 0 ? session.createdAt : runtimeSession.createdAt;
    const lastActivityAt = Math.max(
      createdAt,
      session.lastActivityAt,
      runtimeSession.lastActivityAt,
    );
    if (createdAt === session.createdAt && lastActivityAt === session.lastActivityAt) {
      return session;
    }
    changed = true;
    return { ...session, createdAt, lastActivityAt };
  });
  return changed ? merged : sessions;
}
