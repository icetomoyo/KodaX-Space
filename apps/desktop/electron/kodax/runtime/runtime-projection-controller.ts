// F121 main-owned sanitized Runtime projection cache.
//
// The current SDK-neutral bootstrap stays explicitly incompatible. Part 2 will
// feed authoritative daemon snapshots into this controller after capability
// negotiation; the controller itself never imports the KodaX SDK.

import {
  spaceRuntimeProfileProjectionSchema,
  spaceSessionLiveProjectionSchema,
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
      parsed.cursor.seq <= this.#profile.cursor.seq
    ) {
      return false;
    }
    if (currentRuntimeId !== nextRuntimeId) {
      this.#liveBySession.clear();
    }
    this.#profile = parsed;
    return true;
  }

  replaceSessionLive(projection: SpaceSessionLiveProjectionT): boolean {
    const parsed = spaceSessionLiveProjectionSchema.parse(projection);
    const profileRuntimeId = runtimeId(this.#profile);
    if (
      (this.#profile.connection.state !== 'ready' &&
        this.#profile.connection.state !== 'degraded') ||
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
      state: 'incompatible',
      changedAt,
      stale: true,
      reason: 'Waiting for a published KodaX daemon SDK capability contract.',
      capabilities: [
        {
          id: 'runtime.daemon',
          version: 1,
          available: false,
          reason: 'Published daemon SDK integration is pending.',
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
