import { z } from 'zod';

const key = 'kodax-space.pending-session-stops.v1';
const id = z.string().min(1).max(128);
const pendingSchema = z.record(
  z.object({ sessionId: id, runId: id, requestId: id, accepted: z.boolean().optional() }).strict(),
);
export type PendingSessionStops = z.infer<typeof pendingSchema>;
type StopStorage = Pick<Storage, 'getItem' | 'setItem'>;

export function readPendingSessionStops(storage: StopStorage): PendingSessionStops {
  const value = storage.getItem(key);
  if (!value) return {};
  const records = pendingSchema.parse(JSON.parse(value));
  if (Object.entries(records).some(([requestId, request]) => requestId !== request.requestId)) {
    throw new Error('Pending Stop request identity does not match its record.');
  }
  return records;
}

export function writePendingSessionStops(storage: StopStorage, records: PendingSessionStops): void {
  storage.setItem(key, JSON.stringify(pendingSchema.parse(records)));
}
