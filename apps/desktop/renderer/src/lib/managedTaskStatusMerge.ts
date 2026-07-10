import type { SessionEvent } from '@kodax-space/space-ipc-schema';

type ManagedTaskStatus = Extract<SessionEvent, { kind: 'managed_task_status' }>['status'];
type ManagedLiveEvent = NonNullable<ManagedTaskStatus['events']>[number];

const MAX_MANAGED_STATUS_EVENTS = 50;

export function mergeManagedTaskStatus(
  previous: ManagedTaskStatus | undefined,
  current: ManagedTaskStatus,
): ManagedTaskStatus {
  const events = mergeManagedLiveEvents(previous?.events, current.events);
  if (events === current.events) return current;
  return {
    ...current,
    ...(events && events.length > 0 ? { events } : {}),
  };
}

function mergeManagedLiveEvents(
  previous: readonly ManagedLiveEvent[] | undefined,
  current: readonly ManagedLiveEvent[] | undefined,
): ManagedLiveEvent[] | undefined {
  if (!previous || previous.length === 0) return current ? current.slice() : undefined;
  if (!current || current.length === 0) return previous.slice(-MAX_MANAGED_STATUS_EVENTS);

  const byKey = new Map<string, ManagedLiveEvent>();
  for (const event of previous) byKey.set(event.key, event);
  for (const event of current) {
    byKey.delete(event.key);
    byKey.set(event.key, event);
  }
  return Array.from(byKey.values()).slice(-MAX_MANAGED_STATUS_EVENTS);
}
