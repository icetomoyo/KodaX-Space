import type { SessionEvent } from '@kodax-space/space-ipc-schema';
import type { UserMessage } from './transcriptTypes.js';

export interface TranscriptUnit {
  readonly user: UserMessage;
  readonly events: readonly SessionEvent[];
}

export interface TranscriptPlane {
  readonly userMessages: readonly UserMessage[];
  readonly events: readonly SessionEvent[];
}

export function transcriptUserIdentity(
  left: UserMessage,
  right: UserMessage,
): 'match' | 'conflict' | 'unknown' {
  if (left.entryId !== undefined && right.entryId !== undefined) {
    const ids = new Set([left.entryId, ...(left.auditEntryIds ?? [])]);
    return [right.entryId, ...(right.auditEntryIds ?? [])].some((id) => ids.has(id))
      ? 'match'
      : 'conflict';
  }
  if (left.id === right.id) return 'match';
  if ((left.deliveredInterrupt || right.deliveredInterrupt) && (left.entryId || right.entryId)) {
    return 'unknown';
  }
  return left.turnId !== undefined &&
    left.turnId === right.turnId &&
    left.turnUserOrdinal !== undefined &&
    left.turnUserOrdinal === right.turnUserOrdinal
    ? 'match'
    : 'unknown';
}

function boundaryOwner(event: SessionEvent, users: readonly UserMessage[]): number {
  if (event.kind !== 'mid_turn_user_prompt' && event.kind !== 'queued_user_prompt_started')
    return -1;
  if ('entryId' in event && event.entryId !== undefined) {
    const exact = users.findIndex(
      (user) => user.entryId === event.entryId || user.auditEntryIds?.includes(event.entryId!),
    );
    if (exact !== -1) return exact;
  }
  return users.findIndex(
    (user) =>
      !('entryId' in event && event.entryId !== undefined && user.entryId !== undefined) &&
      ((event.queueId !== undefined && user.deliveryQueueId === event.queueId) ||
        (event.turnId !== undefined &&
          event.turnId === user.turnId &&
          event.turnUserOrdinal !== undefined &&
          event.turnUserOrdinal === user.turnUserOrdinal)),
  );
}

function eventOwner(event: SessionEvent, users: readonly UserMessage[], current: number): number {
  const boundary = boundaryOwner(event, users);
  if (boundary !== -1) return boundary;
  const turnId = 'turnId' in event ? event.turnId : undefined;
  const runId = 'runtimeEvent' in event ? event.runtimeEvent?.runId : undefined;
  if (turnId === undefined && runId === undefined) return current;
  const candidates = users.flatMap((user, index) =>
    (turnId === undefined || user.turnId === turnId) &&
    (runId === undefined || user.runtimeRunId === undefined || user.runtimeRunId === runId)
      ? [index]
      : [],
  );
  if (candidates.includes(current)) return current;
  return candidates.length === 1 ? candidates[0]! : current;
}

/** Assign events once, within their own source plane, before any display ordering. */
export function transcriptUnits(plane: TranscriptPlane): TranscriptUnit[] {
  const users = plane.userMessages;
  const buckets = users.map(() => [] as SessionEvent[]);
  let cursor = 0;
  let closed = false;
  for (const event of plane.events) {
    if (closed && event.kind !== 'session_complete' && event.kind !== 'session_error') {
      cursor += 1;
      closed = false;
    }
    while (users[cursor]?.historyNoAssistantSegment === true) cursor += 1;
    const next = eventOwner(event, users, cursor);
    cursor = Math.min(next, Math.max(users.length - 1, 0));
    buckets[cursor]?.push(event);
    closed = event.kind === 'session_complete' || event.kind === 'session_error';
  }
  return users.map((user, index) => ({ user, events: buckets[index]! }));
}

/** Compatibility arrays are a read projection; ownership travels with every event. */
export function renderTranscriptUnits(units: readonly TranscriptUnit[]): TranscriptPlane {
  return {
    userMessages: units.map((unit, projectionOrder) => ({ ...unit.user, projectionOrder })),
    events: units.flatMap((unit) =>
      unit.events.map((event) => ({
        ...event,
        transcriptOwnerId: unit.user.id,
      })),
    ),
  };
}
