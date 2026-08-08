import type {
  SessionEvent,
  SpaceRuntimeCursorT,
  SpaceSessionLiveProjectionT,
} from '@kodax-space/space-ipc-schema';

type RuntimeEventOrigin = NonNullable<
  Extract<SessionEvent, { kind: 'text_delta' }>['runtimeEvent']
>;
type DraftEventKind = 'text_delta' | 'thinking_delta';
type StreamDeltaEvent = Extract<SessionEvent, { kind: DraftEventKind }>;
type SnapshotRunEvent = Extract<
  SessionEvent,
  {
    kind:
      | DraftEventKind
      | 'thinking_end'
      | 'tool_start'
      | 'tool_input_delta'
      | 'tool_progress'
      | 'tool_result';
  }
>;
type SnapshotEventBarrierCursor = SpaceRuntimeCursorT & {
  readonly runId?: string;
  readonly assistantDraftSeq?: number;
  readonly thinkingDraftSeq?: number;
};

export function runtimeDeltasShareSnapshotSide(
  previous: StreamDeltaEvent,
  event: StreamDeltaEvent,
  cursor: SnapshotEventBarrierCursor | undefined,
): boolean {
  if (previous.runtimeEvent === undefined || event.runtimeEvent === undefined) {
    return previous.runtimeEvent === undefined && event.runtimeEvent === undefined;
  }
  if (
    previous.runtimeEvent.runtimeId !== event.runtimeEvent.runtimeId ||
    previous.runtimeEvent.runId !== event.runtimeEvent.runId
  ) {
    return false;
  }
  if (
    cursor?.runtimeId !== event.runtimeEvent.runtimeId ||
    (cursor.runId !== undefined && cursor.runId !== event.runtimeEvent.runId)
  ) {
    return true;
  }
  const coveredSeq =
    event.kind === 'text_delta' ? cursor.assistantDraftSeq : cursor.thinkingDraftSeq;
  if (coveredSeq === undefined) return true;
  return previous.runtimeEvent.seq <= coveredSeq === event.runtimeEvent.seq <= coveredSeq;
}

function activeRunSegmentStart(events: readonly SessionEvent[]): number {
  for (let index = events.length - 1; index >= 0; index--) {
    const event = events[index]!;
    if (event.kind === 'session_start') return index;
    if (event.kind === 'session_complete' || event.kind === 'session_error') return index + 1;
  }
  return 0;
}

function terminalRunSegmentStart(events: readonly SessionEvent[]): number {
  let terminalIndex = -1;
  for (let index = events.length - 1; index >= 0; index--) {
    const event = events[index]!;
    if (event.kind === 'session_complete' || event.kind === 'session_error') {
      terminalIndex = index;
      break;
    }
  }
  if (terminalIndex === -1) return activeRunSegmentStart(events);
  for (let index = terminalIndex - 1; index >= 0; index--) {
    const event = events[index]!;
    if (event.kind === 'session_start') return index;
    if (event.kind === 'session_complete' || event.kind === 'session_error') return index + 1;
  }
  return 0;
}

function runtimeEventOrigin(event: SessionEvent): RuntimeEventOrigin | undefined {
  return 'runtimeEvent' in event ? event.runtimeEvent : undefined;
}

/**
 * Return only the part of a later projection that is not already present at the end of an earlier
 * projection. This compatibility helper is also used by legacy durable-history/live-event folding.
 */
export function projectionTextSuffix(durable: string, live: string): string {
  if (live.length === 0 || durable.includes(live)) return '';
  if (live.startsWith(durable)) return live.slice(durable.length);
  let overlap = Math.min(durable.length, live.length);
  while (overlap > 0 && durable.slice(-overlap) !== live.slice(0, overlap)) overlap--;
  return live.slice(overlap);
}

interface ProjectionTextRecovery {
  readonly prefix: string;
  readonly suffix: string;
}

function suffixPrefixOverlap(left: string, right: string): number {
  let overlap = Math.min(left.length, right.length);
  while (overlap > 0 && left.slice(-overlap) !== right.slice(0, overlap)) overlap--;
  return overlap;
}

/**
 * Locate one cumulative Runtime draft around the already-delivered incremental text.
 *
 * During listener-first bootstrap the renderer may receive either a prefix or a suffix before the
 * snapshot response. Unlike projectionTextSuffix(), this helper can recover missing text on both
 * sides. Runtime cursor provenance prevents a later copy of an already-covered delta from being
 * appended after the snapshot.
 */
export function projectionTextRecovery(
  delivered: string,
  cumulative: string,
): ProjectionTextRecovery {
  if (cumulative.length === 0 || delivered.endsWith(cumulative)) {
    return { prefix: '', suffix: '' };
  }
  if (delivered.length === 0) return { prefix: '', suffix: cumulative };

  const containedAt = cumulative.lastIndexOf(delivered);
  if (containedAt !== -1) {
    return {
      prefix: cumulative.slice(0, containedAt),
      suffix: cumulative.slice(containedAt + delivered.length),
    };
  }

  const appendOverlap = suffixPrefixOverlap(delivered, cumulative);
  const prependOverlap = suffixPrefixOverlap(cumulative, delivered);
  if (prependOverlap > appendOverlap) {
    return {
      prefix: cumulative.slice(0, cumulative.length - prependOverlap),
      suffix: '',
    };
  }
  return {
    prefix: '',
    suffix: cumulative.slice(appendOverlap),
  };
}

function belongsToRun(
  origin: RuntimeEventOrigin | undefined,
  projection: SpaceSessionLiveProjectionT,
  runId: string,
): boolean {
  return origin?.runtimeId === projection.cursor.runtimeId && origin.runId === runId;
}

function firstPostSnapshotIndex(
  events: readonly SessionEvent[],
  projection: SpaceSessionLiveProjectionT,
  runId: string,
): number {
  const index = events.findIndex((event) => {
    const origin = runtimeEventOrigin(event);
    return belongsToRun(origin, projection, runId) && origin!.seq > projection.cursor.seq;
  });
  return index === -1 ? events.length : index;
}

function draftEvent(
  kind: DraftEventKind,
  projection: SpaceSessionLiveProjectionT,
  runId: string,
  turnId: string | undefined,
  text: string,
  sentAt: number | undefined,
): SessionEvent {
  const base = {
    kind,
    sessionId: projection.sessionId,
    text,
    runtimeEvent: {
      runtimeId: projection.cursor.runtimeId,
      runId,
      seq: projection.cursor.seq,
    },
    ...(turnId !== undefined ? { turnId } : {}),
    ...(sentAt !== undefined ? { sentAt } : {}),
  };
  return base as SessionEvent;
}

function isSnapshotRunEvent(event: SessionEvent): event is SnapshotRunEvent {
  return (
    event.kind === 'text_delta' ||
    event.kind === 'thinking_delta' ||
    event.kind === 'thinking_end' ||
    event.kind === 'tool_start' ||
    event.kind === 'tool_input_delta' ||
    event.kind === 'tool_progress' ||
    event.kind === 'tool_result'
  );
}

function enrichCoveredRunTurnIdentity(
  events: readonly SessionEvent[],
  projection: SpaceSessionLiveProjectionT,
  runId: string,
  turnId: string | undefined,
): readonly SessionEvent[] {
  if (turnId === undefined) return events;
  let changed = false;
  const next = events.map((event) => {
    const origin = runtimeEventOrigin(event);
    if (
      !isSnapshotRunEvent(event) ||
      event.turnId !== undefined ||
      !belongsToRun(origin, projection, runId) ||
      origin!.seq > projection.cursor.seq
    ) {
      return event;
    }
    changed = true;
    return { ...event, turnId };
  });
  return changed ? next : events;
}

function alignCoveredDraftChunks(
  covered: readonly SessionEvent[],
  projection: SpaceSessionLiveProjectionT,
  runId: string,
  kind: DraftEventKind,
  cumulative: string,
): { readonly delivered: string; readonly insertions?: ReadonlyMap<number, string> } {
  const candidates = covered
    .map((event, index) => ({ event, index, origin: runtimeEventOrigin(event) }))
    .filter(
      (
        entry,
      ): entry is {
        readonly event: Extract<SessionEvent, { kind: typeof kind }>;
        readonly index: number;
        readonly origin: RuntimeEventOrigin | undefined;
      } => entry.event.kind === kind,
    );
  const matching = candidates.filter((entry) => belongsToRun(entry.origin, projection, runId));
  const legacy = candidates.filter((entry) => entry.origin === undefined);
  const relevant =
    matching.length > 0
      ? candidates.filter(
          (entry) => entry.origin === undefined || belongsToRun(entry.origin, projection, runId),
        )
      : legacy;
  const delivered = relevant.map((entry) => entry.event.text).join('');
  if (cumulative.length === 0 || delivered.includes(cumulative)) {
    return { delivered, insertions: new Map() };
  }

  const insertBefore = new Map<number, string>();
  let cumulativeCursor = 0;
  let lastDraftIndex = -1;
  for (const { event, index } of relevant) {
    if (event.text.length === 0) continue;
    const matchIndex = cumulative.indexOf(event.text, cumulativeCursor);
    if (matchIndex === -1) return { delivered };
    if (matchIndex > cumulativeCursor) {
      insertBefore.set(index, cumulative.slice(cumulativeCursor, matchIndex));
    }
    cumulativeCursor = matchIndex + event.text.length;
    lastDraftIndex = index;
  }

  if (lastDraftIndex === -1) {
    insertBefore.set(covered.length, cumulative);
  } else if (cumulativeCursor < cumulative.length) {
    insertBefore.set(lastDraftIndex + 1, cumulative.slice(cumulativeCursor));
  }
  return { delivered, insertions: insertBefore };
}

function hydrateDraft(
  events: readonly SessionEvent[],
  projection: SpaceSessionLiveProjectionT,
  runId: string,
  turnId: string | undefined,
  kind: DraftEventKind,
  cumulative: string,
  sentAt: number | undefined,
  coveredLimit = events.length,
): readonly SessionEvent[] {
  const barrier = Math.min(firstPostSnapshotIndex(events, projection, runId), coveredLimit);
  const covered = events.slice(0, barrier);
  const alignment = alignCoveredDraftChunks(covered, projection, runId, kind, cumulative);
  const alignedInsertions = alignment.insertions;
  if (alignedInsertions !== undefined) {
    if (alignedInsertions.size === 0) return events;
    const next: SessionEvent[] = [];
    for (let index = 0; index <= events.length; index++) {
      const insertion = alignedInsertions.get(index);
      if (insertion !== undefined && insertion.length > 0) {
        next.push(draftEvent(kind, projection, runId, turnId, insertion, sentAt));
      }
      if (index < events.length) next.push(events[index]!);
    }
    return next;
  }

  // Compatibility fallback for pre-provenance buffers or a bounded Runtime suffix whose older
  // delivered chunks are no longer present in the cumulative draft window.
  const recovery = projectionTextRecovery(alignment.delivered, cumulative);
  if (recovery.prefix.length === 0 && recovery.suffix.length === 0) return events;

  const next = [...events];
  let adjustedBarrier = barrier;
  if (recovery.prefix.length > 0) {
    const first = covered.findIndex((event) => event.kind === kind);
    const insertion = first === -1 ? adjustedBarrier : first;
    next.splice(insertion, 0, draftEvent(kind, projection, runId, turnId, recovery.prefix, sentAt));
    adjustedBarrier++;
  }
  if (recovery.suffix.length > 0) {
    let last = -1;
    for (let index = adjustedBarrier - 1; index >= 0; index--) {
      if (next[index]?.kind === kind) {
        last = index;
        break;
      }
    }
    const insertion = last === -1 ? adjustedBarrier : last + 1;
    next.splice(insertion, 0, draftEvent(kind, projection, runId, turnId, recovery.suffix, sentAt));
  }
  return next;
}

function toolIdOf(event: SessionEvent): string | undefined {
  if (
    event.kind === 'tool_start' ||
    event.kind === 'tool_input_delta' ||
    event.kind === 'tool_progress' ||
    event.kind === 'tool_result'
  ) {
    return event.toolId;
  }
  return undefined;
}

function reconcileActiveTools(
  events: readonly SessionEvent[],
  projection: SpaceSessionLiveProjectionT,
  runId: string,
  turnId: string | undefined,
): readonly SessionEvent[] {
  const activeToolIds = new Set(projection.activeTools.map((tool) => tool.toolCallId));
  const completedToolIds = new Set(
    events.filter((event) => event.kind === 'tool_result').map((event) => event.toolId),
  );
  const staleToolIds = new Set<string>();
  for (const event of events) {
    const toolId = toolIdOf(event);
    const origin = runtimeEventOrigin(event);
    if (
      toolId !== undefined &&
      belongsToRun(origin, projection, runId) &&
      origin!.seq <= projection.cursor.seq &&
      !activeToolIds.has(toolId) &&
      !completedToolIds.has(toolId)
    ) {
      staleToolIds.add(toolId);
    }
  }

  let next =
    staleToolIds.size === 0
      ? [...events]
      : events.filter((event) => {
          const toolId = toolIdOf(event);
          if (toolId === undefined || !staleToolIds.has(toolId)) return true;
          const origin = runtimeEventOrigin(event);
          return !(
            belongsToRun(origin, projection, runId) &&
            origin!.seq <= projection.cursor.seq &&
            event.kind !== 'tool_result'
          );
        });

  for (const tool of projection.activeTools) {
    let barrier = firstPostSnapshotIndex(next, projection, runId);
    const toolIndexes = next
      .slice(0, barrier)
      .map((event, index) => ({ event, index }))
      .filter(({ event }) => toolIdOf(event) === tool.toolCallId);
    const firstToolIndex = toolIndexes[0]?.index ?? barrier;
    const startEntry = toolIndexes.find(({ event }) => event.kind === 'tool_start');

    if (startEntry === undefined) {
      next.splice(firstToolIndex, 0, {
        kind: 'tool_start',
        sessionId: projection.sessionId,
        toolId: tool.toolCallId,
        toolName: tool.name,
        input: {},
        runtimeEvent: {
          runtimeId: projection.cursor.runtimeId,
          runId,
          seq: projection.cursor.seq,
        },
        ...(turnId !== undefined ? { turnId } : {}),
      });
    } else if (startEntry.index > firstToolIndex) {
      const [start] = next.splice(startEntry.index, 1);
      next.splice(firstToolIndex, 0, start!);
    }

    if (tool.progress === undefined) continue;
    barrier = firstPostSnapshotIndex(next, projection, runId);
    let latestProgress: string | undefined;
    let lastToolIndex = -1;
    for (let index = 0; index < barrier; index++) {
      const event = next[index]!;
      if (toolIdOf(event) !== tool.toolCallId) continue;
      lastToolIndex = index;
      if (event.kind === 'tool_progress') latestProgress = event.message;
    }
    if (latestProgress === tool.progress) continue;
    next.splice(lastToolIndex === -1 ? barrier : lastToolIndex + 1, 0, {
      kind: 'tool_progress',
      sessionId: projection.sessionId,
      toolId: tool.toolCallId,
      message: tool.progress,
      runtimeEvent: {
        runtimeId: projection.cursor.runtimeId,
        runId,
        seq: projection.cursor.seq,
      },
      ...(turnId !== undefined ? { turnId } : {}),
    });
  }

  return next;
}

/**
 * Reconcile the legacy transcript event projection with one authoritative live snapshot.
 *
 * Snapshot drafts are cumulative while Runtime events are incremental. Runtime provenance and the
 * snapshot cursor form the causal barrier; string recovery is used only to position already
 * delivered covered text around the cumulative draft. Active tools are normalized causally, and
 * covered tool state absent from the authoritative set is removed instead of remaining "running".
 */
export function hydrateSessionEventsFromLiveSnapshot(
  events: readonly SessionEvent[],
  projection: SpaceSessionLiveProjectionT,
): readonly SessionEvent[] {
  const run = projection.activeRun ?? projection.lastTerminalRun;
  if (!run) return events;

  const segmentStart = projection.activeRun
    ? activeRunSegmentStart(events)
    : terminalRunSegmentStart(events);
  const prefix = events.slice(0, segmentStart);
  let active: readonly SessionEvent[] = enrichCoveredRunTurnIdentity(
    events.slice(segmentStart),
    projection,
    run.runId,
    run.turnId,
  );
  if (projection.activeRun !== undefined) {
    active = hydrateDraft(
      active,
      projection,
      run.runId,
      run.turnId,
      'thinking_delta',
      projection.thinkingDraft?.text ?? '',
      projection.thinkingDraft?.startedAt,
      active.length,
    );
    active = hydrateDraft(
      active,
      projection,
      run.runId,
      run.turnId,
      'text_delta',
      projection.assistantDraft?.text ?? '',
      projection.assistantDraft?.startedAt,
      active.length,
    );
  }
  active = reconcileActiveTools(active, projection, run.runId, run.turnId);

  if (
    active.length === events.length - segmentStart &&
    active.every((event, index) => event === events[segmentStart + index])
  ) {
    return events;
  }
  return [...prefix, ...active];
}
