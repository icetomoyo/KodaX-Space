import { useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import type { SessionEvent, SpaceSessionLiveProjectionT } from '@kodax-space/space-ipc-schema';
import { useAppStore } from '../../store/appStore.js';
import {
  runtimeConnectionHasFreshLiveAuthority,
  runtimeProfileActivityOutranksLive,
  runtimeProfileSessionActivityOutranksLive,
  runtimeProfileSessionTerminalEvidence,
  runtimeProfileTerminalEvidence,
} from '../../store/runtimeProjectionState.js';

export type SessionStatus = 'idle' | 'running' | 'awaiting' | 'error';

interface RuntimeTerminalEvidence {
  readonly runId: string;
  readonly phase: string;
  readonly runtimeId?: string;
  readonly startedAt?: number;
  readonly completedAt?: number;
}

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
  readonly errorSeenRunIds?: readonly string[];
  readonly runtimeLive: SpaceSessionLiveProjectionT | undefined;
  readonly runtimeProfileActive: boolean;
  readonly runtimeProfileTerminalRun?: RuntimeTerminalEvidence;
}): SessionStatus {
  const { runtimeLive } = input;
  const terminalRunIds = new Set<string>();
  if (runtimeLive?.lastTerminalRun) terminalRunIds.add(runtimeLive.lastTerminalRun.runId);
  const profileTerminalAppliesToLive =
    input.runtimeProfileTerminalRun !== undefined &&
    (input.runtimeProfileTerminalRun.runtimeId === undefined ||
      runtimeLive === undefined ||
      input.runtimeProfileTerminalRun.runtimeId === runtimeLive.cursor.runtimeId);
  if (profileTerminalAppliesToLive && input.runtimeProfileTerminalRun) {
    terminalRunIds.add(input.runtimeProfileTerminalRun.runId);
  }
  const activeRun =
    runtimeLive?.activeRun && !terminalRunIds.has(runtimeLive.activeRun.runId)
      ? runtimeLive.activeRun
      : undefined;
  const terminalClosesActiveRun =
    runtimeLive?.activeRun !== undefined && terminalRunIds.has(runtimeLive.activeRun.runId);
  const terminalClosesQueuedRun =
    runtimeLive?.queuedRuns.some((run) => terminalRunIds.has(run.runId)) ?? false;
  const queuedRuns = runtimeLive?.queuedRuns.filter((run) => !terminalRunIds.has(run.runId)) ?? [];
  const terminalClosesUnboundActivity =
    terminalClosesActiveRun ||
    (runtimeLive?.activeRun === undefined &&
      terminalClosesQueuedRun &&
      queuedRuns.length === 0 &&
      !input.runtimeProfileActive);
  if (
    activeRun?.phase === 'waiting_permission' ||
    activeRun?.phase === 'waiting_user_input' ||
    runtimeLive?.interactions.some(
      (interaction) =>
        interaction.state === 'pending' &&
        (interaction.runId === undefined
          ? !terminalClosesUnboundActivity
          : !terminalRunIds.has(interaction.runId)),
    ) ||
    (!terminalClosesUnboundActivity && (input.awaitingPermission || input.awaitingAskUser))
  ) {
    return 'awaiting';
  }
  if (activeRun !== undefined || queuedRuns.length > 0 || input.runtimeProfileActive) {
    return 'running';
  }
  const seenTerminalRunIds = new Set(
    input.errorSeenRunIds ?? (input.errorSeenRunId ? [input.errorSeenRunId] : []),
  );
  const terminalCandidates = [
    runtimeLive?.lastTerminalRun,
    profileTerminalAppliesToLive ? input.runtimeProfileTerminalRun : undefined,
  ];
  if (
    terminalCandidates.some(
      (terminal) =>
        terminal !== undefined &&
        (terminal.phase === 'failed' || terminal.phase === 'interrupted') &&
        !seenTerminalRunIds.has(terminal.runId),
    )
  ) {
    return 'error';
  }
  if (input.events) {
    for (let index = input.events.length - 1; index >= 0; index--) {
      const event = input.events[index]!;
      if (event.kind === 'session_error') {
        if (
          event.runtimeEvent?.runId !== undefined &&
          seenTerminalRunIds.has(event.runtimeEvent.runId)
        ) {
          break;
        }
        if (index >= input.errorSeenAt) return 'error';
        break;
      }
      if (event.kind === 'session_complete') break;
      if (event.kind === 'session_start') {
        const origin = event.runtimeEvent;
        const terminal = runtimeLive?.lastTerminalRun;
        const profileTerminalMatchesOrigin =
          origin !== undefined &&
          input.runtimeProfileTerminalRun?.runId === origin.runId &&
          (input.runtimeProfileTerminalRun.runtimeId === undefined
            ? runtimeLive?.cursor.runtimeId === origin.runtimeId
            : input.runtimeProfileTerminalRun.runtimeId === origin.runtimeId);
        if (
          origin !== undefined &&
          ((runtimeLive !== undefined &&
            terminal?.runId === origin.runId &&
            runtimeLive.cursor.runtimeId === origin.runtimeId &&
            origin.seq <= runtimeLive.cursor.seq) ||
            profileTerminalMatchesOrigin)
        ) {
          break;
        }
        return 'running';
      }
    }
  }
  return input.pending ? 'running' : 'idle';
}

function profileTerminalForSession(
  sessionId: string | null,
  state: ReturnType<typeof useAppStore.getState>,
): RuntimeTerminalEvidence | undefined {
  if (!sessionId || !runtimeConnectionHasFreshLiveAuthority(state.runtimeConnection)) {
    return undefined;
  }
  const profile = state.runtimeProfile;
  if (profile === null || profile.connection.runtimeId !== state.runtimeConnection.runtimeId) {
    return undefined;
  }
  return runtimeProfileTerminalEvidence(profile, sessionId);
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
  const errorSeenRunIds = useAppStore((state) =>
    sessionId ? state.errorSeenRunIdsBySession[sessionId] : undefined,
  );
  const runtimeLive = useAppStore((state) =>
    sessionId ? state.liveProjectionBySession[sessionId] : undefined,
  );
  const runtimeProfileActive = useAppStore((state) => profileActivityForSession(sessionId, state));
  const runtimeProfileTerminalRun = useAppStore((state) =>
    profileTerminalForSession(sessionId, state),
  );

  return useMemo(() => {
    if (!sessionId) return 'idle';
    return deriveSessionStatus({
      pending,
      events,
      awaitingPermission,
      awaitingAskUser,
      errorSeenAt,
      errorSeenRunId,
      errorSeenRunIds,
      runtimeLive,
      runtimeProfileActive,
      runtimeProfileTerminalRun,
    });
  }, [
    sessionId,
    pending,
    events,
    awaitingPermission,
    awaitingAskUser,
    errorSeenAt,
    errorSeenRunId,
    errorSeenRunIds,
    runtimeLive,
    runtimeProfileActive,
    runtimeProfileTerminalRun,
  ]);
}

export function useSessionStatusMap(
  sessionIds: readonly string[],
): Readonly<Record<string, SessionStatus>> {
  return useAppStore(
    useShallow((state) => {
      const pendingMap = state.pendingSendBySession;
      const eventsMap = state.eventsBySession;
      const permissionQueue = state.permissionQueue;
      const askUserQueue = state.askUserQueue;
      const errorSeenMap = state.errorSeenAtBySession;
      const errorSeenRunIdMap = state.errorSeenRunIdBySession;
      const errorSeenRunIdsMap = state.errorSeenRunIdsBySession;
      const liveProjectionBySession = state.liveProjectionBySession;
      const runtimeConnection = state.runtimeConnection;
      const runtimeProfile = state.runtimeProfile;
      const permissionSessionIds = new Set(permissionQueue.map((request) => request.sessionId));
      const askUserSessionIds = new Set(askUserQueue.map((request) => request.sessionId));
      const profileActiveSessionIds = new Set<string>();
      const profileTerminalRunBySession = new Map<string, RuntimeTerminalEvidence>();
      const freshProfile = runtimeProfile;
      if (
        freshProfile !== null &&
        runtimeConnectionHasFreshLiveAuthority(runtimeConnection) &&
        freshProfile.connection.runtimeId === runtimeConnection.runtimeId
      ) {
        for (const session of freshProfile.sessions) {
          const terminal = runtimeProfileSessionTerminalEvidence(freshProfile, session);
          if (terminal !== undefined) {
            profileTerminalRunBySession.set(session.sessionId, terminal);
          }
          if (
            runtimeProfileSessionActivityOutranksLive(
              freshProfile,
              session,
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
          errorSeenRunIds: errorSeenRunIdsMap[sessionId],
          runtimeLive: liveProjectionBySession[sessionId],
          runtimeProfileActive: profileActiveSessionIds.has(sessionId),
          runtimeProfileTerminalRun: profileTerminalRunBySession.get(sessionId),
        });
      }
      return statuses;
    }),
  );
}
