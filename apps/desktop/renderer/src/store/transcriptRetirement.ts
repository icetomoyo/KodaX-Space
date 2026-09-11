import type { SessionEvent } from '@kodax-space/space-ipc-schema';
import type { TranscriptUnit } from './transcriptPlanes.js';

interface JournalReceipt {
  readonly runId: string;
  readonly runtimeId: string;
  readonly journalEpoch: string;
  readonly seq: number;
}

interface DeliveryReceipt extends JournalReceipt {
  readonly turnId?: string;
  readonly turnUserOrdinal?: number;
  readonly firstSeq: number;
  readonly queueId?: string;
  readonly entryIds: readonly string[];
  readonly eventKeys: readonly string[];
}

export interface TranscriptRetirement {
  /** Sized to the loaded history window; expiry loses evidence, never grants broader authority. */
  capacity: number;
  receipts: DeliveryReceipt[];
}

function receiptForUnit(unit: TranscriptUnit): DeliveryReceipt | undefined {
  const origins = unit.events.flatMap((event) =>
    'runtimeEvent' in event && event.runtimeEvent?.journalEpoch ? [event.runtimeEvent] : [],
  );
  const first = origins[0];
  if (
    !first?.journalEpoch ||
    origins.some(
      (origin) =>
        origin.runtimeId !== first.runtimeId ||
        origin.journalEpoch !== first.journalEpoch ||
        origin.runId !== first.runId,
    )
  )
    return undefined;
  return {
    runtimeId: first.runtimeId,
    journalEpoch: first.journalEpoch,
    runId: first.runId,
    turnId: unit.user.turnId,
    turnUserOrdinal: unit.user.turnUserOrdinal,
    firstSeq: Math.min(...origins.map((origin) => origin.seq)),
    seq: Math.max(...origins.map((origin) => origin.seq)),
    queueId: unit.user.deliveryQueueId,
    entryIds: [unit.user.entryId, ...(unit.user.auditEntryIds ?? [])].filter(
      (id): id is string => id !== undefined,
    ),
    eventKeys: unit.events.flatMap((event) =>
      'runtimeEvent' in event && event.runtimeEvent
        ? [`${event.runtimeEvent.seq}:${event.kind}`]
        : [],
    ),
  };
}

export function retireTranscriptUnits(
  state: TranscriptRetirement,
  retired: readonly TranscriptUnit[],
): void {
  for (const unit of retired) {
    const receipt = receiptForUnit(unit);
    if (!receipt) continue;
    state.receipts = state.receipts.filter(
      (previous) =>
        previous.runtimeId !== receipt.runtimeId ||
        previous.journalEpoch !== receipt.journalEpoch ||
        previous.runId !== receipt.runId ||
        previous.firstSeq !== receipt.firstSeq ||
        previous.turnId !== receipt.turnId ||
        previous.turnUserOrdinal !== receipt.turnUserOrdinal,
    );
    state.receipts.push(receipt);
  }
  state.receipts = state.receipts.slice(-state.capacity);
}

export function isRetiredTranscriptEvent(
  state: TranscriptRetirement | undefined,
  event: SessionEvent,
): boolean {
  const origin = 'runtimeEvent' in event ? event.runtimeEvent : undefined;
  if (!state || !origin?.journalEpoch) return false;
  const sameJournal = (receipt: JournalReceipt): boolean =>
    receipt.runtimeId === origin.runtimeId && receipt.journalEpoch === origin.journalEpoch;
  return state.receipts.some((receipt) => {
    if (
      !sameJournal(receipt) ||
      receipt.runId !== origin.runId ||
      ('turnId' in event &&
        event.turnId !== undefined &&
        receipt.turnId !== undefined &&
        event.turnId !== receipt.turnId) ||
      origin.seq < receipt.firstSeq ||
      origin.seq > receipt.seq
    )
      return false;
    if (event.kind === 'mid_turn_user_prompt' || event.kind === 'queued_user_prompt_started') {
      if ('entryId' in event && event.entryId !== undefined)
        return receipt.entryIds.includes(event.entryId);
      return event.queueId !== undefined && event.queueId === receipt.queueId;
    }
    // A batch can emit multiple inputs at the same sequence. Keep the boundary's shared
    // sequence open unless this exact delivery identity was checked above.
    return (
      origin.seq > receipt.firstSeq && receipt.eventKeys.includes(`${origin.seq}:${event.kind}`)
    );
  });
}
