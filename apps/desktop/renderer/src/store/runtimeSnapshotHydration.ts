import type {
  SessionEvent,
  SpaceSessionLiveProjectionT,
} from '@kodax-space/space-ipc-schema';

function activeRunSegmentStart(events: readonly SessionEvent[]): number {
  for (let index = events.length - 1; index >= 0; index--) {
    const event = events[index]!;
    if (event.kind === 'session_start') return index;
    if (event.kind === 'session_complete' || event.kind === 'session_error') return index + 1;
  }
  return 0;
}

function projectedEventText(
  events: readonly SessionEvent[],
  kind: 'text_delta' | 'thinking_delta',
): string {
  return events
    .filter((event): event is Extract<SessionEvent, { kind: typeof kind }> => event.kind === kind)
    .map((event) => event.text)
    .join('');
}

/**
 * Return only the part of an authoritative cumulative Runtime draft that is not already present
 * in the renderer's incremental event projection.
 *
 * Runtime drafts are bounded suffixes. `durable.includes(live)` therefore also covers a renderer
 * buffer that is longer than the Runtime's retained draft window.
 */
export function projectionTextSuffix(durable: string, live: string): string {
  if (live.length === 0 || durable.includes(live)) return '';
  if (live.startsWith(durable)) return live.slice(durable.length);
  let overlap = Math.min(durable.length, live.length);
  while (overlap > 0 && durable.slice(-overlap) !== live.slice(0, overlap)) overlap--;
  return live.slice(overlap);
}

/**
 * Reconcile the legacy transcript event projection with one authoritative live snapshot.
 *
 * Normal Runtime events remain incremental. A snapshot is cumulative and may be read repeatedly
 * on focus, terminal reconciliation, a revision gap, or reconnect, so it must never be replayed
 * as fresh deltas. This function adds only a missing draft suffix and missing active-tool state.
 * It is deliberately idempotent.
 */
export function hydrateSessionEventsFromLiveSnapshot(
  events: readonly SessionEvent[],
  projection: SpaceSessionLiveProjectionT,
): readonly SessionEvent[] {
  if (!projection.activeRun) return events;

  const segmentStart = activeRunSegmentStart(events);
  const activeEvents = events.slice(segmentStart);
  const additions: SessionEvent[] = [];
  const thinkingSuffix = projectionTextSuffix(
    projectedEventText(activeEvents, 'thinking_delta'),
    projection.thinkingDraft?.text ?? '',
  );
  const textSuffix = projectionTextSuffix(
    projectedEventText(activeEvents, 'text_delta'),
    projection.assistantDraft?.text ?? '',
  );

  if (thinkingSuffix.length > 0) {
    additions.push({
      kind: 'thinking_delta',
      sessionId: projection.sessionId,
      text: thinkingSuffix,
      sentAt: projection.thinkingDraft?.startedAt,
    });
  }
  if (textSuffix.length > 0) {
    additions.push({
      kind: 'text_delta',
      sessionId: projection.sessionId,
      text: textSuffix,
      sentAt: projection.assistantDraft?.startedAt,
    });
  }

  const startedToolIds = new Set<string>();
  const progressByToolId = new Map<string, string>();
  for (const event of activeEvents) {
    if (event.kind === 'tool_start') startedToolIds.add(event.toolId);
    if (event.kind === 'tool_progress') progressByToolId.set(event.toolId, event.message);
  }
  for (const tool of projection.activeTools) {
    if (!startedToolIds.has(tool.toolCallId)) {
      startedToolIds.add(tool.toolCallId);
      additions.push({
        kind: 'tool_start',
        sessionId: projection.sessionId,
        toolId: tool.toolCallId,
        toolName: tool.name,
        input: {},
      });
    }
    if (
      tool.progress !== undefined &&
      tool.progress !== progressByToolId.get(tool.toolCallId)
    ) {
      progressByToolId.set(tool.toolCallId, tool.progress);
      additions.push({
        kind: 'tool_progress',
        sessionId: projection.sessionId,
        toolId: tool.toolCallId,
        message: tool.progress,
      });
    }
  }

  return additions.length > 0 ? [...events, ...additions] : events;
}
