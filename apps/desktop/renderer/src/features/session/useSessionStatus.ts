import { useMemo } from 'react';
import type { SessionEvent, SpaceSessionLiveProjectionT } from '@kodax-space/space-ipc-schema';
import { useAppStore } from '../../store/appStore.js';
import {
  runtimeConnectionHasFreshLiveAuthority,
  runtimeProfileActivityOutranksLive,
} from '../../store/runtimeProjectionState.js';

export type SessionStatus = 'idle' | 'running' | 'awaiting' | 'error';

export function isUnseenTerminalError(
  runtimeLive: { lastTerminalRun?: { runId: string; phase: string } | undefined } | undefined,
  seenRunId: string | undefined,
): boolean {
  const terminal = runtimeLive?.lastTerminalRun;
  if (!terminal) return false;
  if (terminal.phase !== 'failed' && terminal.phase !== 'interrupted') return false;
  return terminal.runId !== seenRunId;
}

export function deriveSessionStatus(input: {
  readonly pending: boolean;
  readonly events: readonly SessionEvent[] | undefined;
  readonly awaitingPermission: boolean;
  readonly awaitingAskUser: boolean;
  readonly errorSeenAt: number;
  readonly errorSeenRunId: string | undefined;
  readonly runtimeLive: SpaceSessionLiveProjectionT | undefined;
  readonly runtimeProfileActive: boolean;
}): SessionStatus {
  const { runtimeLive } = input;
  if (
    runtimeLive?.activeRun?.phase === 'waiting_permission' ||
    runtimeLive?.activeRun?.phase === 'waiting_user_input' ||
    runtimeLive?.interactions.some((interaction) => interaction.state === 'pending') ||
    input.awaitingPermission ||
    input.awaitingAskUser
  ) {
    return 'awaiting';
  }
  if (
    runtimeLive?.activeRun !== undefined ||
    (runtimeLive?.queuedRuns.length ?? 0) > 0 ||
    input.runtimeProfileActive
  ) {
    return 'running';
  }
  if (isUnseenTerminalError(runtimeLive, input.errorSeenRunId)) return 'error';
  if (input.events) {
    for (let index = input.events.length - 1; index >= 0; index--) {
      const event = input.events[index]!;
      if (event.kind === 'session_error') {
        if (index >= input.errorSeenAt) return 'error';
        break;
      }
      if (event.kind === 'session_complete') break;
      if (event.kind === 'session_start') {
        const origin = event.runtimeEvent;
        const terminal = runtimeLive?.lastTerminalRun;
        if (
          origin !== undefined &&
          runtimeLive !== undefined &&
          terminal?.runId === origin.runId &&
          runtimeLive.cursor.runtimeId === origin.runtimeId &&
          origin.seq <= runtimeLive.cursor.seq
        ) {
          break;
        }
        return 'running';
      }
    }
  }
  return input.pending ? 'running' : 'idle';
}

function profileActivityForSession(
  sessionId: string | null,
  state: ReturnType<typeof useAppStore.getState>,
): boolean {
  if (!sessionId || !runtimeConnectionHasFreshLiveAuthority(state.runtimeConnection)) return false;
  const profile = state.runtimeProfile;
  if (profile === null || profile.connection.runtimeId !== state.runtimeConnection.runtimeId) {
    return false;
  }
  return runtimeProfileActivityOutranksLive(
    profile,
    sessionId,
    state.liveProjectionBySession[sessionId],
  );
}

export function useSessionStatus(sessionId: string | null): SessionStatus {
  const pending = useAppStore((state) =>
    sessionId ? Boolean(state.pendingSendBySession[sessionId]) : false,
  );
  const events = useAppStore((state) => (sessionId ? state.eventsBySession[sessionId] : undefined));
  const awaitingPermission = useAppStore((state) =>
    sessionId ? state.permissionQueue.some((request) => request.sessionId === sessionId) : false,
  );
  const awaitingAskUser = useAppStore((state) =>
    sessionId ? state.askUserQueue.some((request) => request.sessionId === sessionId) : false,
  );
  const errorSeenAt = useAppStore((state) =>
    sessionId ? (state.errorSeenAtBySession[sessionId] ?? 0) : 0,
  );
  const errorSeenRunId = useAppStore((state) =>
    sessionId ? state.errorSeenRunIdBySession[sessionId] : undefined,
  );
  const runtimeLive = useAppStore((state) =>
    sessionId ? state.liveProjectionBySession[sessionId] : undefined,
  );
  const runtimeProfileActive = useAppStore((state) => profileActivityForSession(sessionId, state));

  return useMemo(() => {
    if (!sessionId) return 'idle';
    return deriveSessionStatus({
      pending,
      events,
      awaitingPermission,
      awaitingAskUser,
      errorSeenAt,
      errorSeenRunId,
      runtimeLive,
      runtimeProfileActive,
    });
  }, [
    sessionId,
    pending,
    events,
    awaitingPermission,
    awaitingAskUser,
    errorSeenAt,
    errorSeenRunId,
    runtimeLive,
    runtimeProfileActive,
  ]);
}

export function useSessionStatusMap(
  sessionIds: readonly string[],
): Readonly<Record<string, SessionStatus>> {
  const pendingMap = useAppStore((state) => state.pendingSendBySession);
  const eventsMap = useAppStore((state) => state.eventsBySession);
  const permissionQueue = useAppStore((state) => state.permissionQueue);
  const askUserQueue = useAppStore((state) => state.askUserQueue);
  const errorSeenMap = useAppStore((state) => state.errorSeenAtBySession);
  const errorSeenRunIdMap = useAppStore((state) => state.errorSeenRunIdBySession);
  const liveProjectionBySession = useAppStore((state) => state.liveProjectionBySession);
  const runtimeConnection = useAppStore((state) => state.runtimeConnection);
  const runtimeProfile = useAppStore((state) => state.runtimeProfile);

  return useMemo(() => {
    const permissionSessionIds = new Set(permissionQueue.map((request) => request.sessionId));
    const askUserSessionIds = new Set(askUserQueue.map((request) => request.sessionId));
    const profileActiveSessionIds = new Set<string>();
    const freshProfile = runtimeProfile;
    if (
      freshProfile !== null &&
      runtimeConnectionHasFreshLiveAuthority(runtimeConnection) &&
      freshProfile.connection.runtimeId === runtimeConnection.runtimeId
    ) {
      for (const session of freshProfile.sessions) {
        if (
          runtimeProfileActivityOutranksLive(
            freshProfile,
            session.sessionId,
            liveProjectionBySession[session.sessionId],
          )
        ) {
          profileActiveSessionIds.add(session.sessionId);
        }
      }
    }
    const statuses: Record<string, SessionStatus> = {};
    for (const sessionId of sessionIds) {
      statuses[sessionId] = deriveSessionStatus({
        pending: Boolean(pendingMap[sessionId]),
        events: eventsMap[sessionId],
        awaitingPermission: permissionSessionIds.has(sessionId),
        awaitingAskUser: askUserSessionIds.has(sessionId),
        errorSeenAt: errorSeenMap[sessionId] ?? 0,
        errorSeenRunId: errorSeenRunIdMap[sessionId],
        runtimeLive: liveProjectionBySession[sessionId],
        runtimeProfileActive: profileActiveSessionIds.has(sessionId),
      });
    }
    return statuses;
  }, [
    sessionIds,
    pendingMap,
    eventsMap,
    permissionQueue,
    askUserQueue,
    errorSeenMap,
    errorSeenRunIdMap,
    liveProjectionBySession,
    runtimeConnection,
    runtimeProfile,
  ]);
}
