// F121 main-owned sanitized Runtime projection cache.
//
// The SDK-neutral bootstrap starts explicitly connecting. Authoritative daemon
// snapshots replace it after capability negotiation; the controller itself
// never imports the KodaX SDK.

import {
  spaceCoderConnectionProjectionSchema,
  spaceRuntimeProfileProjectionSchema,
  spaceSessionLiveProjectionSchema,
  type SpaceCoderConnectionProjectionT,
  type SpaceRuntimeProfileProjectionT,
  type SpaceSessionLiveProjectionT,
} from '@kodax-space/space-ipc-schema';

export type RuntimeProjectionUnavailableErrorCode = 'LIVE_SNAPSHOT_UNAVAILABLE';

export class RuntimeProjectionUnavailableError extends Error {
  readonly code: RuntimeProjectionUnavailableErrorCode;
  readonly sessionId: string;

  constructor(sessionId: string) {
    super(`No authoritative Runtime live projection is available for session ${sessionId}.`);
    this.name = 'RuntimeProjectionUnavailableError';
    this.code = 'LIVE_SNAPSHOT_UNAVAILABLE';
    this.sessionId = sessionId;
  }
}

function runtimeId(profile: SpaceRuntimeProfileProjectionT): string | undefined {
  return profile.connection.runtimeId ?? profile.cursor?.runtimeId;
}

function connectionHasFreshLiveAuthority(connection: SpaceCoderConnectionProjectionT): boolean {
  return (connection.state === 'ready' || connection.state === 'degraded') && !connection.stale;
}

export class RuntimeProjectionController {
  #profile: SpaceRuntimeProfileProjectionT;
  #liveBySession = new Map<string, SpaceSessionLiveProjectionT>();

  constructor(initialProfile: SpaceRuntimeProfileProjectionT) {
    this.#profile = spaceRuntimeProfileProjectionSchema.parse(initialProfile);
  }

  profileSnapshot(): SpaceRuntimeProfileProjectionT {
    return structuredClone(this.#profile);
  }

  sessionLiveSnapshot(sessionId: string): SpaceSessionLiveProjectionT {
    const projection = this.#liveBySession.get(sessionId);
    if (!projection) throw new RuntimeProjectionUnavailableError(sessionId);
    return structuredClone(projection);
  }

  hasPendingInteraction(kind: 'permission' | 'ask-user', requestId: string): boolean {
    const matches = (interaction: SpaceRuntimeProfileProjectionT['interactions'][number]) =>
      interaction.kind === kind &&
      interaction.state === 'pending' &&
      interaction.request.reqId === requestId;
    if (this.#profile.interactions.some(matches)) return true;
    for (const projection of this.#liveBySession.values()) {
      if (projection.interactions.some(matches)) return true;
    }
    return false;
  }

  removeSessionLive(sessionId: string): boolean {
    return this.#liveBySession.delete(sessionId);
  }

  replaceProfile(profile: SpaceRuntimeProfileProjectionT): boolean {
    const parsed = spaceRuntimeProfileProjectionSchema.parse(profile);
    const currentRuntimeId = runtimeId(this.#profile);
    const nextRuntimeId = runtimeId(parsed);
    if (parsed.connection.changedAt < this.#profile.connection.changedAt) return false;
    if (
      currentRuntimeId === nextRuntimeId &&
      parsed.projectionRevision <= this.#profile.projectionRevision
    ) {
      return false;
    }
    if (
      currentRuntimeId === nextRuntimeId &&
      parsed.cursor !== undefined &&
      this.#profile.cursor !== undefined &&
      parsed.cursor.seq < this.#profile.cursor.seq
    ) {
      return false;
    }
    if (currentRuntimeId !== nextRuntimeId || !connectionHasFreshLiveAuthority(parsed.connection)) {
      this.#liveBySession.clear();
    }
    this.#profile = parsed;
    return true;
  }

  replaceConnection(connection: SpaceCoderConnectionProjectionT): boolean {
    const parsed = spaceCoderConnectionProjectionSchema.parse(connection);
    if (parsed.changedAt < this.#profile.connection.changedAt) return false;
    if (
      parsed.changedAt === this.#profile.connection.changedAt &&
      JSON.stringify(parsed) === JSON.stringify(this.#profile.connection)
    ) {
      return false;
    }
    const previousRuntimeId = runtimeId(this.#profile);
    const nextRuntimeId = parsed.runtimeId ?? this.#profile.cursor?.runtimeId;
    if (previousRuntimeId !== nextRuntimeId || !connectionHasFreshLiveAuthority(parsed)) {
      this.#liveBySession.clear();
    }
    this.#profile = spaceRuntimeProfileProjectionSchema.parse({
      ...this.#profile,
      connection: parsed,
      projectionRevision: this.#profile.projectionRevision + 1,
    });
    return true;
  }

  replaceSessionLive(projection: SpaceSessionLiveProjectionT): boolean {
    const parsed = spaceSessionLiveProjectionSchema.parse(projection);
    const profileRuntimeId = runtimeId(this.#profile);
    if (
      !connectionHasFreshLiveAuthority(this.#profile.connection) ||
      profileRuntimeId === undefined ||
      profileRuntimeId !== parsed.cursor.runtimeId
    ) {
      return false;
    }
    const current = this.#liveBySession.get(parsed.sessionId);
    if (
      current !== undefined &&
      current.cursor.runtimeId === parsed.cursor.runtimeId &&
      (parsed.projectionRevision <= current.projectionRevision ||
        parsed.cursor.seq <= current.cursor.seq)
    ) {
      return false;
    }
    this.#liveBySession.set(parsed.sessionId, parsed);
    return true;
  }
}

export function createPendingSdkRuntimeProjection(
  changedAt = Date.now(),
): RuntimeProjectionController {
  return new RuntimeProjectionController({
    connection: {
      state: 'connecting',
      changedAt,
      stale: true,
      reason: 'Connecting to the published KodaX shared daemon contract.',
      capabilities: [
        {
          id: 'runtime.daemon',
          version: 1,
          available: false,
          reason: 'Published daemon connection has not completed.',
        },
      ],
    },
    projectionRevision: 0,
    sessions: [],
    interactions: [],
    notifications: [],
  });
}

export const runtimeProjectionController = createPendingSdkRuntimeProjection();
