// F121 pure renderer projection state.
//
// Coder semantic live state is replaced/patched from daemon-derived Space IPC
// projections. This module has no Zustand, Electron or KodaX SDK dependency so
// revision/cursor behavior stays deterministic and unit-testable.

import type {
  SpaceCoderConnectionProjectionT,
  SpaceRuntimeProfileProjectionT,
  SpaceSessionLiveChangedT,
  SpaceSessionLiveProjectionT,
} from '@kodax-space/space-ipc-schema';

export interface RuntimeProjectionState {
  readonly connection: SpaceCoderConnectionProjectionT;
  readonly profile: SpaceRuntimeProfileProjectionT | null;
  readonly liveBySession: Readonly<Record<string, SpaceSessionLiveProjectionT | undefined>>;
  readonly snapshotRequiredBySession: Readonly<Record<string, true | undefined>>;
}

export interface RuntimeTerminalEvidence {
  readonly sessionId: string;
  readonly runtimeId: string;
  readonly runId: string;
  readonly phase: string;
  readonly cursorSeq: number;
  readonly startedAt?: number;
  readonly completedAt?: number;
  readonly transcriptRevision?: string;
}

export type ApplySessionLiveChangeStatus =
  | 'applied'
  | 'ignored'
  | 'snapshot-required'
  | 'snapshot-pending';

export function shouldRequestSessionLiveSnapshot(status: ApplySessionLiveChangeStatus): boolean {
  return status === 'snapshot-required' || status === 'snapshot-pending';
}

export function runtimeBootstrapRetryDelayMs(attempt: number): number | undefined {
  return [250, 1_000, 3_000][attempt - 1];
}

export function shouldRerunRejectedHydrationSnapshot(input: {
  readonly allowEqualHydration: boolean;
  readonly connection: SpaceCoderConnectionProjectionT;
  readonly current: SpaceSessionLiveProjectionT | undefined;
  readonly incoming: SpaceSessionLiveProjectionT;
}): boolean {
  return (
    input.allowEqualHydration &&
    runtimeConnectionHasFreshLiveAuthority(input.connection) &&
    input.connection.runtimeId === input.incoming.cursor.runtimeId &&
    input.current?.cursor.runtimeId === input.incoming.cursor.runtimeId &&
    input.current.projectionRevision > input.incoming.projectionRevision
  );
}

export function runtimeProfileTerminalEvidence(
  profile: SpaceRuntimeProfileProjectionT,
  sessionId: string,
): RuntimeTerminalEvidence | undefined {
  return runtimeProfileSessionTerminalEvidence(
    profile,
    profile.sessions.find((session) => session.sessionId === sessionId),
  );
}

export function runtimeProfileSessionTerminalEvidence(
  profile: SpaceRuntimeProfileProjectionT,
  session: SpaceRuntimeProfileProjectionT['sessions'][number] | undefined,
): RuntimeTerminalEvidence | undefined {
  const terminal = session?.lastTerminalRun;
  const runtimeId = profile.connection.runtimeId ?? profile.cursor?.runtimeId;
  if (session === undefined || terminal === undefined || runtimeId === undefined) return undefined;
  return {
    sessionId: session.sessionId,
    runtimeId,
    runId: terminal.runId,
    phase: terminal.phase,
    cursorSeq: profile.cursor?.seq ?? 0,
    ...(terminal.startedAt !== undefined ? { startedAt: terminal.startedAt } : {}),
    ...(terminal.completedAt !== undefined ? { completedAt: terminal.completedAt } : {}),
  };
}

/** Profile and per-Session observation cursors share only a causal lower bound, not an atomic read. */
export function runtimeTerminalEvidenceCandidates(
  state: Pick<RuntimeProjectionState, 'connection' | 'profile' | 'liveBySession'>,
  sessionId: string,
): readonly RuntimeTerminalEvidence[] {
  if (
    !runtimeConnectionHasFreshLiveAuthority(state.connection) ||
    state.connection.runtimeId === undefined
  ) {
    return [];
  }
  const runtimeId = state.connection.runtimeId;
  const live = state.liveBySession[sessionId];
  const currentLive = live?.cursor.runtimeId === runtimeId ? live : undefined;
  const liveTerminal = currentLive?.lastTerminalRun;
  const liveEvidence =
    currentLive === undefined || liveTerminal === undefined
      ? undefined
      : {
          sessionId,
          runtimeId,
          runId: liveTerminal.runId,
          phase: liveTerminal.phase,
          cursorSeq: currentLive.cursor.seq,
          ...(liveTerminal.startedAt !== undefined ? { startedAt: liveTerminal.startedAt } : {}),
          ...(liveTerminal.completedAt !== undefined
            ? { completedAt: liveTerminal.completedAt }
            : {}),
          transcriptRevision: currentLive.transcriptRevision,
        };
  const profile = state.profile?.connection.runtimeId === runtimeId ? state.profile : undefined;
  const profileEvidence =
    profile === undefined ? undefined : runtimeProfileTerminalEvidence(profile, sessionId);
  if (profileEvidence === undefined) return liveEvidence === undefined ? [] : [liveEvidence];
  if (liveEvidence === undefined) return [profileEvidence];
  if (profileEvidence.runId === liveEvidence.runId) {
    // The profile cursor is aggregate while the live cursor is Session-bound. Their numeric
    // sequences are incomparable; the exact per-Session observation is the stronger duplicate.
    return [liveEvidence];
  }
  return [profileEvidence, liveEvidence];
}

export interface ApplySessionLiveChangeResult {
  readonly state: RuntimeProjectionState;
  readonly status: ApplySessionLiveChangeStatus;
}

export function createRuntimeProjectionState(changedAt = 0): RuntimeProjectionState {
  return {
    connection: {
      state: 'disconnected',
      changedAt,
      stale: true,
      capabilities: [],
    },
    profile: null,
    liveBySession: {},
    snapshotRequiredBySession: {},
  };
}

function runtimeIdOfProfile(profile: SpaceRuntimeProfileProjectionT | null): string | undefined {
  return profile?.connection.runtimeId ?? profile?.cursor?.runtimeId;
}

function cursorBelongsToSession(
  cursor: SpaceSessionLiveProjectionT['cursor'],
  sessionId: string,
): boolean {
  return cursor.sessionId === undefined || cursor.sessionId === sessionId;
}

function sameSessionCursorLineage(
  left: SpaceSessionLiveProjectionT['cursor'],
  right: SpaceSessionLiveProjectionT['cursor'],
): boolean {
  if (left.runtimeId !== right.runtimeId) return false;
  if (
    left.sessionId === undefined ||
    left.journalEpoch === undefined ||
    right.sessionId === undefined ||
    right.journalEpoch === undefined
  ) {
    // Legacy Space cursors had only runtimeId+seq. Preserve compatibility until every producer is
    // upgraded, but use the complete lineage identity whenever both sides provide it.
    return true;
  }
  return left.sessionId === right.sessionId && left.journalEpoch === right.journalEpoch;
}

export function runtimeConnectionHasFreshLiveAuthority(
  connection: SpaceCoderConnectionProjectionT,
): boolean {
  return (connection.state === 'ready' || connection.state === 'degraded') && !connection.stale;
}

export function runtimeProfileSessionHasActivity(
  session: SpaceRuntimeProfileProjectionT['sessions'][number] | undefined,
): boolean {
  return session?.activeRun !== undefined || (session?.queuedRuns.length ?? 0) > 0;
}

export function sessionLiveProjectionHasActivity(
  projection: SpaceSessionLiveProjectionT | undefined,
): boolean {
  return projection?.activeRun !== undefined || (projection?.queuedRuns.length ?? 0) > 0;
}

export function runtimeProfileActivityOutranksLive(
  profile: SpaceRuntimeProfileProjectionT,
  sessionId: string,
  live: SpaceSessionLiveProjectionT | undefined,
): boolean {
  return runtimeProfileSessionActivityOutranksLive(
    profile.sessions.find((session) => session.sessionId === sessionId),
    live,
  );
}

export function runtimeProfileSessionActivityOutranksLive(
  profileSession: SpaceRuntimeProfileProjectionT['sessions'][number] | undefined,
  live: SpaceSessionLiveProjectionT | undefined,
): boolean {
  if (!runtimeProfileSessionHasActivity(profileSession)) return false;
  if (live === undefined) return true;
  const profileRunIds = [
    ...(profileSession?.activeRun ? [profileSession.activeRun.runId] : []),
    ...(profileSession?.queuedRuns.map((run) => run.runId) ?? []),
  ];
  const terminalRunId = live.lastTerminalRun?.runId;
  const exactLiveTerminalClosesEveryProfileRun =
    terminalRunId !== undefined && profileRunIds.every((runId) => runId === terminalRunId);
  // A terminal fact for the exact Run is stronger than stale profile activity.
  // Profile refreshes aggregate multiple Sessions, while Runtime event cursors
  // are Session-bound and their seq values must never be compared cross-Session.
  return !exactLiveTerminalClosesEveryProfileRun;
}

export function runtimeProfileConflictsWithLive(
  profile: SpaceRuntimeProfileProjectionT,
  sessionId: string,
  live: SpaceSessionLiveProjectionT | undefined,
): boolean {
  if (live === undefined || !sessionLiveProjectionHasActivity(live)) return false;
  const profileSession = profile.sessions.find((session) => session.sessionId === sessionId);
  // The profile is deliberately bounded, so omission cannot serve as terminal evidence.
  if (profileSession === undefined) return false;
  if (profileSession.activeRun?.runId !== live?.activeRun?.runId) return true;
  if (profileSession.queuedRuns.length !== live.queuedRuns.length) return true;
  return profileSession.queuedRuns.some(
    (run, index) => run.runId !== live.queuedRuns[index]?.runId,
  );
}

export function runtimeSessionRequiresImmediateObservation(
  state: Pick<
    RuntimeProjectionState,
    'connection' | 'profile' | 'liveBySession' | 'snapshotRequiredBySession'
  >,
  sessionId: string,
): boolean {
  if (state.snapshotRequiredBySession[sessionId] === true) return true;
  if (sessionLiveProjectionHasActivity(state.liveBySession[sessionId])) return true;
  if (!runtimeConnectionHasFreshLiveAuthority(state.connection)) return false;
  const profile = state.profile;
  if (profile === null || profile.connection.runtimeId !== state.connection.runtimeId) return false;
  if (
    profile.interactions.some(
      (interaction) =>
        interaction.state === 'pending' && interaction.request.sessionId === sessionId,
    )
  ) {
    return true;
  }
  const session = profile.sessions.find((candidate) => candidate.sessionId === sessionId);
  // Main supplements the bounded recent summaries with every active/queued Run from the complete
  // Run index. Omission is therefore not positive activity evidence and must not let a cold
  // observation block canonical history first paint for an old/cross-project Session.
  return runtimeProfileSessionHasActivity(session);
}

/**
 * Periodic recovery uses only exact current-Runtime evidence. Main supplements bounded recent
 * summaries with active/queued Run identities, so an omitted idle Session must not reopen an
 * observation every 30 seconds.
 */
export function runtimeSessionNeedsPeriodicReconciliation(
  state: RuntimeProjectionState,
  sessionId: string,
): boolean {
  if (
    !runtimeConnectionHasFreshLiveAuthority(state.connection) ||
    state.connection.runtimeId === undefined
  ) {
    return false;
  }
  if (state.snapshotRequiredBySession[sessionId] === true) return true;
  const runtimeId = state.connection.runtimeId;
  const live = state.liveBySession[sessionId];
  if (live?.cursor.runtimeId === runtimeId && sessionLiveProjectionHasActivity(live)) return true;
  const profile = state.profile;
  if (profile === null || profile.connection.runtimeId !== runtimeId) return false;
  if (
    profile.interactions.some(
      (interaction) =>
        interaction.state === 'pending' && interaction.request.sessionId === sessionId,
    )
  ) {
    return true;
  }
  return runtimeProfileSessionHasActivity(
    profile.sessions.find((candidate) => candidate.sessionId === sessionId),
  );
}

export function shouldBootstrapSelectedSessionLive(input: {
  readonly runtimeReady: boolean;
  readonly needsObservation: boolean;
  readonly hasImmediateActivity: boolean;
  readonly historyAllowsObservation: boolean;
  readonly hasLiveProjection: boolean;
}): boolean {
  if (!input.runtimeReady || !input.needsObservation) return false;
  if (input.hasImmediateActivity) return true;
  return input.historyAllowsObservation && !input.hasLiveProjection;
}

/**
 * Decide whether a Session needs the expensive observation plane at all. Ordinary historical
 * Sessions are fully served by canonical conversation history plus the lightweight Runtime
 * profile; observing every terminal Session needlessly rebuilds its live reducer and can block a
 * subsequent history click on the shared daemon transport. Active/queued work, pending Runtime
 * interactions, and an explicit cursor-gap requirement still fail open to a full snapshot.
 */
export function runtimeSessionNeedsObservation(
  state: Pick<RuntimeProjectionState, 'profile' | 'snapshotRequiredBySession'> &
    Partial<Pick<RuntimeProjectionState, 'liveBySession'>>,
  sessionId: string,
): boolean {
  if (state.snapshotRequiredBySession[sessionId] === true) return true;
  if (sessionLiveProjectionHasActivity(state.liveBySession?.[sessionId])) return true;
  // Wait for the lightweight profile before deciding. Its recent Session summaries are bounded,
  // but main supplements them from the complete active/queued Run index. An omitted row therefore
  // has no positive reason to open an expensive live observation; existing live activity above
  // remains fail-open until exact terminal evidence arrives.
  if (state.profile === null) return false;
  const session = state.profile?.sessions.find((candidate) => candidate.sessionId === sessionId);
  if (session === undefined) return false;
  if (runtimeProfileSessionHasActivity(session)) return true;
  return (
    state.profile?.interactions.some(
      (interaction) =>
        interaction.state === 'pending' && interaction.request.sessionId === sessionId,
    ) ?? false
  );
}

/**
 * A Runtime connection push is an edge notification. Repeated profile refreshes with a newer
 * timestamp but the same authority must not trigger another selected-Session snapshot read.
 */
export function shouldReconcileRuntimeConnection(
  previous: SpaceCoderConnectionProjectionT,
  next: SpaceCoderConnectionProjectionT,
): boolean {
  if (!runtimeConnectionHasFreshLiveAuthority(next) || next.runtimeId === undefined) return false;
  return (
    !runtimeConnectionHasFreshLiveAuthority(previous) ||
    previous.runtimeId !== next.runtimeId ||
    previous.state !== next.state ||
    previous.stale !== next.stale
  );
}

export function replaceRuntimeConnection(
  state: RuntimeProjectionState,
  connection: SpaceCoderConnectionProjectionT,
): RuntimeProjectionState {
  if (connection.changedAt < state.connection.changedAt) return state;
  const authorityChanged = state.connection.runtimeId !== connection.runtimeId;
  const authorityLost = !runtimeConnectionHasFreshLiveAuthority(connection);
  return {
    ...state,
    connection,
    ...(authorityChanged || authorityLost
      ? { liveBySession: {}, snapshotRequiredBySession: {} }
      : {}),
  };
}

function withoutSnapshotRequirement(
  requirements: RuntimeProjectionState['snapshotRequiredBySession'],
  sessionId: string,
): RuntimeProjectionState['snapshotRequiredBySession'] {
  if (requirements[sessionId] === undefined) return requirements;
  const { [sessionId]: _removed, ...rest } = requirements;
  return rest;
}

function requireSnapshot(
  state: RuntimeProjectionState,
  sessionId: string,
): ApplySessionLiveChangeResult {
  if (state.snapshotRequiredBySession[sessionId]) {
    return { state, status: 'snapshot-pending' };
  }
  return {
    state: {
      ...state,
      snapshotRequiredBySession: {
        ...state.snapshotRequiredBySession,
        [sessionId]: true,
      },
    },
    status: 'snapshot-required',
  };
}

export function replaceRuntimeProfile(
  state: RuntimeProjectionState,
  profile: SpaceRuntimeProfileProjectionT,
): RuntimeProjectionState {
  if (profile.connection.changedAt < state.connection.changedAt) return state;
  if (
    state.connection.runtimeId !== undefined &&
    profile.connection.runtimeId !== state.connection.runtimeId &&
    profile.connection.changedAt <= state.connection.changedAt
  ) {
    return state;
  }
  const currentRuntimeId = runtimeIdOfProfile(state.profile);
  const nextRuntimeId = runtimeIdOfProfile(profile);
  if (
    currentRuntimeId !== undefined &&
    currentRuntimeId === nextRuntimeId &&
    state.profile !== null &&
    profile.projectionRevision <= state.profile.projectionRevision
  ) {
    return state;
  }

  const runtimeChanged = currentRuntimeId !== nextRuntimeId;
  const authorityLost = !runtimeConnectionHasFreshLiveAuthority(profile.connection);
  return {
    ...state,
    connection: profile.connection,
    profile,
    liveBySession: runtimeChanged || authorityLost ? {} : state.liveBySession,
    snapshotRequiredBySession:
      runtimeChanged || authorityLost ? {} : state.snapshotRequiredBySession,
  };
}

export function replaceSessionLiveProjection(
  state: RuntimeProjectionState,
  projection: SpaceSessionLiveProjectionT,
): RuntimeProjectionState {
  const profileRuntimeId = runtimeIdOfProfile(state.profile);
  if (!runtimeConnectionHasFreshLiveAuthority(state.connection)) return state;
  if (
    state.connection.runtimeId === undefined ||
    state.connection.runtimeId !== projection.cursor.runtimeId ||
    profileRuntimeId === undefined ||
    profileRuntimeId !== projection.cursor.runtimeId ||
    !cursorBelongsToSession(projection.cursor, projection.sessionId)
  )
    return requireSnapshot(state, projection.sessionId).state;

  const current = state.liveBySession[projection.sessionId];
  const sameLineage =
    current !== undefined && sameSessionCursorLineage(current.cursor, projection.cursor);
  if (
    current !== undefined &&
    sameLineage &&
    projection.projectionRevision <= current.projectionRevision
  ) {
    if (
      projection.projectionRevision === current.projectionRevision &&
      projection.cursor.seq >= current.cursor.seq &&
      state.snapshotRequiredBySession[projection.sessionId] === true
    ) {
      return {
        ...state,
        snapshotRequiredBySession: withoutSnapshotRequirement(
          state.snapshotRequiredBySession,
          projection.sessionId,
        ),
      };
    }
    return state;
  }

  return {
    ...state,
    liveBySession: {
      ...state.liveBySession,
      [projection.sessionId]: projection,
    },
    snapshotRequiredBySession: withoutSnapshotRequirement(
      state.snapshotRequiredBySession,
      projection.sessionId,
    ),
  };
}

function applyDomainChange(
  current: SpaceSessionLiveProjectionT,
  update: SpaceSessionLiveChangedT,
): SpaceSessionLiveProjectionT {
  const base = {
    ...current,
    projectionRevision: update.projectionRevision,
    cursor: update.cursor,
  };
  switch (update.change.domain) {
    case 'run':
      return {
        ...base,
        activeRun: update.change.activeRun ?? undefined,
        queuedRuns: update.change.queuedRuns,
        ...(update.change.queuedInputs !== undefined
          ? { queuedInputs: update.change.queuedInputs }
          : {}),
        ...(update.change.resetRunScopedState
          ? {
              assistantDraft: undefined,
              thinkingDraft: undefined,
              outputSegment: undefined,
              activeTools: [],
              managedTask: undefined,
              interactions: [],
            }
          : {}),
      };
    case 'draft':
      return {
        ...base,
        assistantDraft: update.change.assistantDraft ?? undefined,
        thinkingDraft: update.change.thinkingDraft ?? undefined,
        outputSegment: update.change.outputSegment,
      };
    case 'tools':
      return { ...base, activeTools: update.change.activeTools };
    case 'todos':
      return { ...base, todos: update.change.todos };
    case 'managedTask':
      return { ...base, managedTask: update.change.managedTask ?? undefined };
    case 'settings':
      return { ...base, settings: update.change.settings };
    case 'queue':
      return { ...base, queuedInputs: update.change.queuedInputs };
    case 'sidecar':
      return { ...base, sidecarMessages: update.change.sidecarMessages };
    case 'terminal':
      return { ...base, lastTerminalRun: update.change.lastTerminalRun };
    case 'interaction':
      return { ...base, interactions: update.change.interactions };
  }
}

export function applySessionLiveChange(
  state: RuntimeProjectionState,
  update: SpaceSessionLiveChangedT,
): ApplySessionLiveChangeResult {
  if (
    !runtimeConnectionHasFreshLiveAuthority(state.connection) ||
    state.connection.runtimeId === undefined ||
    state.connection.runtimeId !== update.cursor.runtimeId ||
    !cursorBelongsToSession(update.cursor, update.sessionId)
  ) {
    return requireSnapshot(state, update.sessionId);
  }
  const current = state.liveBySession[update.sessionId];
  if (current === undefined) return requireSnapshot(state, update.sessionId);

  if (!sameSessionCursorLineage(current.cursor, update.cursor)) {
    return requireSnapshot(state, update.sessionId);
  }

  if (update.projectionRevision <= current.projectionRevision) {
    return { state, status: 'ignored' };
  }

  if (
    update.baseProjectionRevision !== current.projectionRevision ||
    update.cursor.seq <= current.cursor.seq
  ) {
    return requireSnapshot(state, update.sessionId);
  }
  const nextProjection = applyDomainChange(current, update);
  return {
    state: {
      ...state,
      liveBySession: {
        ...state.liveBySession,
        [update.sessionId]: nextProjection,
      },
      snapshotRequiredBySession: withoutSnapshotRequirement(
        state.snapshotRequiredBySession,
        update.sessionId,
      ),
    },
    status: 'applied',
  };
}
