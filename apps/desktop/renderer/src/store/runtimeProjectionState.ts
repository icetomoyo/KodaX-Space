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

export type ApplySessionLiveChangeStatus =
  | 'applied'
  | 'ignored'
  | 'snapshot-required'
  | 'snapshot-pending';

export function shouldRequestSessionLiveSnapshot(
  status: ApplySessionLiveChangeStatus,
): boolean {
  return status === 'snapshot-required' || status === 'snapshot-pending';
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

function connectionAcceptsLive(connection: SpaceCoderConnectionProjectionT): boolean {
  return connection.state === 'ready' || connection.state === 'degraded';
}

export function replaceRuntimeConnection(
  state: RuntimeProjectionState,
  connection: SpaceCoderConnectionProjectionT,
): RuntimeProjectionState {
  if (connection.changedAt < state.connection.changedAt) return state;
  return { ...state, connection };
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
  return {
    ...state,
    connection: profile.connection,
    profile,
    liveBySession: runtimeChanged ? {} : state.liveBySession,
    snapshotRequiredBySession: runtimeChanged ? {} : state.snapshotRequiredBySession,
  };
}

export function replaceSessionLiveProjection(
  state: RuntimeProjectionState,
  projection: SpaceSessionLiveProjectionT,
): RuntimeProjectionState {
  const profileRuntimeId = runtimeIdOfProfile(state.profile);
  if (!connectionAcceptsLive(state.connection)) return state;
  if (
    state.connection.runtimeId === undefined ||
    state.connection.runtimeId !== projection.cursor.runtimeId ||
    profileRuntimeId === undefined ||
    profileRuntimeId !== projection.cursor.runtimeId
  )
    return requireSnapshot(state, projection.sessionId).state;

  const current = state.liveBySession[projection.sessionId];
  if (
    current !== undefined &&
    current.cursor.runtimeId === projection.cursor.runtimeId &&
    projection.projectionRevision <= current.projectionRevision
  ) {
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
    !connectionAcceptsLive(state.connection) ||
    state.connection.runtimeId === undefined ||
    state.connection.runtimeId !== update.cursor.runtimeId
  ) {
    return requireSnapshot(state, update.sessionId);
  }
  const current = state.liveBySession[update.sessionId];
  if (current === undefined) return requireSnapshot(state, update.sessionId);

  if (
    update.cursor.runtimeId === current.cursor.runtimeId &&
    update.projectionRevision <= current.projectionRevision
  ) {
    return { state, status: 'ignored' };
  }

  if (
    update.cursor.runtimeId !== current.cursor.runtimeId ||
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
