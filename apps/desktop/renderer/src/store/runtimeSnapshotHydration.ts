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
      | 'output_segment_started'
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

function isUserDeliveryBoundary(event: SessionEvent): boolean {
  return event.kind === 'mid_turn_user_prompt' || event.kind === 'queued_user_prompt_started';
}

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
    previous.runtimeEvent.runId !== event.runtimeEvent.runId ||
    previous.runtimeEvent.journalEpoch !== event.runtimeEvent.journalEpoch
  ) {
    return false;
  }
  if (
    cursor?.runtimeId !== event.runtimeEvent.runtimeId ||
    (cursor.runId !== undefined && cursor.runId !== event.runtimeEvent.runId) ||
    cursor?.journalEpoch !== event.runtimeEvent.journalEpoch
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
    if (event.kind === 'session_start' || isUserDeliveryBoundary(event)) return index;
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
    if (event.kind === 'session_start' || isUserDeliveryBoundary(event)) return index;
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
  return (
    origin?.runtimeId === projection.cursor.runtimeId &&
    origin.runId === runId &&
    origin.journalEpoch === projection.cursor.journalEpoch
  );
}

interface OutputSegmentFilterState {
  activeResponseId?: string;
  activeProviderRequestId?: string;
  readonly responseProviderRequestIds: Set<string>;
  readonly segmentByIndex: Map<number, string>;
  readonly discardedSegments: Set<string>;
  readonly staleDeltaIndexes: Set<number>;
  readonly effectiveProviderRequestIds?: ReadonlySet<string>;
}

function projectedProviderRequestIds(
  projection: SpaceSessionLiveProjectionT | undefined,
): ReadonlySet<string> | undefined {
  const output = projection?.outputSegment;
  if (!output) return undefined;
  return new Set([
    ...output.retained.map((segment) => segment.providerRequestId),
    ...(output.active ? [output.active.providerRequestId] : []),
  ]);
}

function discardExcludedProjectedSegment(
  event: SessionEvent,
  providerRequestId: string,
  state: OutputSegmentFilterState,
  projection: SpaceSessionLiveProjectionT | undefined,
): void {
  if (state.effectiveProviderRequestIds === undefined || projection?.activeRun === undefined)
    return;
  const origin = runtimeEventOrigin(event);
  if (
    belongsToRun(origin, projection, projection.activeRun.runId) &&
    origin!.seq <= projection.cursor.seq &&
    !state.effectiveProviderRequestIds.has(providerRequestId)
  ) {
    state.discardedSegments.add(providerRequestId);
  }
}

function scanOutputSegmentStart(
  event: Extract<SessionEvent, { kind: 'output_segment_started' }>,
  index: number,
  state: OutputSegmentFilterState,
  projection: SpaceSessionLiveProjectionT | undefined,
): void {
  const isDuplicate =
    event.responseId === state.activeResponseId &&
    event.providerRequestId === state.activeProviderRequestId;
  if (!isDuplicate) {
    if (state.activeResponseId !== undefined && event.responseId !== state.activeResponseId) {
      for (const requestId of state.responseProviderRequestIds) {
        state.discardedSegments.add(requestId);
      }
      state.responseProviderRequestIds.clear();
    } else if (event.mode === 'replace' && state.activeProviderRequestId !== undefined) {
      state.discardedSegments.add(state.activeProviderRequestId);
    }
    state.activeResponseId = event.responseId;
    state.activeProviderRequestId = event.providerRequestId;
    state.responseProviderRequestIds.add(event.providerRequestId);
  }
  state.segmentByIndex.set(index, event.providerRequestId);
  discardExcludedProjectedSegment(event, event.providerRequestId, state, projection);
}

function scanOutputSegmentDelta(
  event: Extract<SessionEvent, { kind: DraftEventKind }>,
  index: number,
  state: OutputSegmentFilterState,
  projection: SpaceSessionLiveProjectionT | undefined,
): void {
  const requestId = event.providerRequestId;
  if (requestId === undefined) return;
  if (requestId === state.activeProviderRequestId) state.segmentByIndex.set(index, requestId);
  else state.staleDeltaIndexes.add(index);
  discardExcludedProjectedSegment(event, requestId, state, projection);
}

function scanOutputSegmentEvents(
  events: readonly SessionEvent[],
  projection: SpaceSessionLiveProjectionT | undefined,
): OutputSegmentFilterState {
  const state: OutputSegmentFilterState = {
    responseProviderRequestIds: new Set(),
    segmentByIndex: new Map(),
    discardedSegments: new Set(),
    staleDeltaIndexes: new Set(),
    effectiveProviderRequestIds: projectedProviderRequestIds(projection),
  };
  events.forEach((event, index) => {
    if (isUserDeliveryBoundary(event)) {
      state.activeResponseId = undefined;
      state.activeProviderRequestId = undefined;
      state.responseProviderRequestIds.clear();
    } else if (event.kind === 'output_segment_started') {
      scanOutputSegmentStart(event, index, state, projection);
    } else if (event.kind === 'text_delta' || event.kind === 'thinking_delta') {
      scanOutputSegmentDelta(event, index, state, projection);
    }
  });
  return state;
}

/** Apply Runtime's explicit append/replace segment protocol without text heuristics. */
export function filterEffectiveOutputSegmentEvents(
  events: readonly SessionEvent[],
  projection?: SpaceSessionLiveProjectionT,
): readonly SessionEvent[] {
  const state = scanOutputSegmentEvents(events, projection);
  if (state.discardedSegments.size === 0 && state.staleDeltaIndexes.size === 0) return events;
  return events.filter((_, index) => {
    if (state.staleDeltaIndexes.has(index)) return false;
    const requestId = state.segmentByIndex.get(index);
    return requestId === undefined || !state.discardedSegments.has(requestId);
  });
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
  seq = projection.cursor.seq,
  providerRequestId?: string,
  textStartOffset?: number,
): SessionEvent {
  const base = {
    kind,
    sessionId: projection.sessionId,
    text,
    runtimeEvent: {
      runtimeId: projection.cursor.runtimeId,
      runId,
      ...(projection.cursor.journalEpoch !== undefined
        ? { journalEpoch: projection.cursor.journalEpoch }
        : {}),
      seq,
    },
    ...(turnId !== undefined ? { turnId } : {}),
    ...(sentAt !== undefined ? { sentAt } : {}),
    ...(providerRequestId !== undefined ? { providerRequestId } : {}),
    ...(textStartOffset !== undefined ? { textStartOffset } : {}),
  };
  return base as SessionEvent;
}

function isSnapshotRunEvent(event: SessionEvent): event is SnapshotRunEvent {
  return (
    event.kind === 'output_segment_started' ||
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

type OutputSegmentState = NonNullable<
  SpaceSessionLiveProjectionT['outputSegment']
>['retained'][number];

function outputSegmentMarker(
  projection: SpaceSessionLiveProjectionT,
  runId: string,
  turnId: string | undefined,
  segment: OutputSegmentState,
): Extract<SessionEvent, { kind: 'output_segment_started' }> {
  return {
    kind: 'output_segment_started',
    sessionId: projection.sessionId,
    responseId: segment.responseId,
    providerRequestId: segment.providerRequestId,
    mode: segment.mode,
    runtimeEvent: {
      runtimeId: projection.cursor.runtimeId,
      runId,
      ...(projection.cursor.journalEpoch !== undefined
        ? { journalEpoch: projection.cursor.journalEpoch }
        : {}),
      seq: segment.startedAtSeq ?? projection.cursor.seq,
    },
    ...(turnId !== undefined ? { turnId } : {}),
  };
}

function segmentInsertionIndex(
  events: readonly SessionEvent[],
  projection: SpaceSessionLiveProjectionT,
  runId: string,
  segment: OutputSegmentState,
): number {
  const startSeq = segment.startedAtSeq ?? projection.cursor.seq;
  const postSnapshot = firstPostSnapshotIndex(events, projection, runId);
  const laterCoveredEvent = events.slice(0, postSnapshot).findIndex((event) => {
    const origin = runtimeEventOrigin(event);
    return belongsToRun(origin, projection, runId) && origin!.seq > startSeq;
  });
  return laterCoveredEvent === -1 ? postSnapshot : laterCoveredEvent;
}

interface DeliveredOutputSegmentText {
  readonly text: string;
  readonly startOffset: number;
}

function coveredOutputSegmentText(
  events: readonly SessionEvent[],
  projection: SpaceSessionLiveProjectionT,
  runId: string,
  providerRequestId: string,
  kind: DraftEventKind,
): DeliveredOutputSegmentText {
  const chunks = events.filter((event): event is StreamDeltaEvent => {
    if (event.kind !== kind || event.providerRequestId !== providerRequestId) return false;
    const origin = runtimeEventOrigin(event);
    return belongsToRun(origin, projection, runId) && origin!.seq <= projection.cursor.seq;
  });
  return {
    text: chunks.map((event) => event.text).join(''),
    startOffset: chunks[0]?.textStartOffset ?? 0,
  };
}

function reconcileOutputSegmentText(
  delivered: DeliveredOutputSegmentText,
  projected: string,
  projectedStartOffset: number,
): DeliveredOutputSegmentText {
  if (delivered.startOffset !== 0 || delivered.text.length < projectedStartOffset) {
    return { text: projected, startOffset: projectedStartOffset };
  }
  return {
    text: `${delivered.text.slice(0, projectedStartOffset)}${projected}`,
    startOffset: 0,
  };
}

function reconciledOutputSegmentDraft(
  events: readonly SessionEvent[],
  projection: SpaceSessionLiveProjectionT,
  runId: string,
  turnId: string | undefined,
  segment: OutputSegmentState,
  kind: DraftEventKind,
): SessionEvent | undefined {
  const delivered = coveredOutputSegmentText(
    events,
    projection,
    runId,
    segment.providerRequestId,
    kind,
  );
  const projected = kind === 'thinking_delta' ? segment.thinkingText : segment.assistantText;
  const projectedStartOffset =
    kind === 'thinking_delta' ? segment.thinkingTextStartOffset : segment.assistantTextStartOffset;
  const reconciled = reconcileOutputSegmentText(delivered, projected, projectedStartOffset);
  if (!reconciled.text) return undefined;
  const sentAt =
    kind === 'thinking_delta'
      ? projection.thinkingDraft?.startedAt
      : projection.assistantDraft?.startedAt;
  return draftEvent(
    kind,
    projection,
    runId,
    turnId,
    reconciled.text,
    sentAt,
    segment.startedAtSeq,
    segment.providerRequestId,
    reconciled.startOffset,
  );
}

function removeCoveredOutputSegmentDeltas(
  events: readonly SessionEvent[],
  projection: SpaceSessionLiveProjectionT,
  runId: string,
  providerRequestId: string,
): SessionEvent[] {
  return events.filter((event) => {
    if (
      (event.kind !== 'text_delta' && event.kind !== 'thinking_delta') ||
      event.providerRequestId !== providerRequestId
    ) {
      return true;
    }
    const origin = runtimeEventOrigin(event);
    return !(belongsToRun(origin, projection, runId) && origin!.seq <= projection.cursor.seq);
  });
}

function coveredOutputSegmentMarkerIndex(
  events: readonly SessionEvent[],
  projection: SpaceSessionLiveProjectionT,
  runId: string,
  providerRequestId: string,
): number {
  return events.findIndex((event) => {
    if (event.kind !== 'output_segment_started' || event.providerRequestId !== providerRequestId) {
      return false;
    }
    const origin = runtimeEventOrigin(event);
    return belongsToRun(origin, projection, runId) && origin!.seq <= projection.cursor.seq;
  });
}

function hydrateOutputSegment(
  events: readonly SessionEvent[],
  projection: SpaceSessionLiveProjectionT,
  runId: string,
  turnId: string | undefined,
  segment: OutputSegmentState,
): SessionEvent[] {
  const synthetic = (['thinking_delta', 'text_delta'] as const).flatMap((kind) => {
    const event = reconciledOutputSegmentDraft(events, projection, runId, turnId, segment, kind);
    return event ? [event] : [];
  });
  const next = removeCoveredOutputSegmentDeltas(
    events,
    projection,
    runId,
    segment.providerRequestId,
  );
  let markerIndex = coveredOutputSegmentMarkerIndex(
    next,
    projection,
    runId,
    segment.providerRequestId,
  );
  if (markerIndex === -1) {
    markerIndex = segmentInsertionIndex(next, projection, runId, segment);
    next.splice(markerIndex, 0, outputSegmentMarker(projection, runId, turnId, segment));
  }
  next.splice(markerIndex + 1, 0, ...synthetic);
  return next;
}

function filterPostSnapshotOutputSegmentEvents(
  events: readonly SessionEvent[],
  projection: SpaceSessionLiveProjectionT,
  runId: string,
  initialProviderRequestId: string | undefined,
): readonly SessionEvent[] {
  let activeProviderRequestId = initialProviderRequestId;
  return events.filter((event) => {
    const origin = runtimeEventOrigin(event);
    const isPostSnapshot =
      belongsToRun(origin, projection, runId) && origin!.seq > projection.cursor.seq;
    if (!isPostSnapshot) return true;
    if (event.kind === 'output_segment_started') {
      activeProviderRequestId = event.providerRequestId;
      return true;
    }
    if (
      (event.kind === 'text_delta' || event.kind === 'thinking_delta') &&
      event.providerRequestId !== undefined
    ) {
      return event.providerRequestId === activeProviderRequestId;
    }
    return true;
  });
}

/** Replace covered chunks with SDK segment snapshots while preserving their causal anchors. */
function hydrateOutputSegments(
  events: readonly SessionEvent[],
  projection: SpaceSessionLiveProjectionT,
  runId: string,
  turnId: string | undefined,
): readonly SessionEvent[] {
  const output = projection.outputSegment;
  if (!output) return events;
  const segments = [...output.retained, ...(output.active ? [output.active] : [])];
  const hydrated = segments.reduce<SessionEvent[]>(
    (next, segment) => hydrateOutputSegment(next, projection, runId, turnId, segment),
    [...events],
  );
  return filterPostSnapshotOutputSegmentEvents(
    hydrated,
    projection,
    runId,
    output.active?.providerRequestId,
  );
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
          ...(projection.cursor.journalEpoch !== undefined
            ? { journalEpoch: projection.cursor.journalEpoch }
            : {}),
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
        ...(projection.cursor.journalEpoch !== undefined
          ? { journalEpoch: projection.cursor.journalEpoch }
          : {}),
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
  const prefix = filterEffectiveOutputSegmentEvents(events.slice(0, segmentStart));
  let active: readonly SessionEvent[] = enrichCoveredRunTurnIdentity(
    filterEffectiveOutputSegmentEvents(events.slice(segmentStart), projection),
    projection,
    run.runId,
    run.turnId,
  );
  if (projection.activeRun !== undefined && projection.outputSegment !== undefined) {
    active = hydrateOutputSegments(active, projection, run.runId, run.turnId);
  } else if (projection.activeRun !== undefined) {
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
