import type { SessionEvent } from '@kodax-space/space-ipc-schema';

export function isCancelledSessionError(event: SessionEvent): boolean {
  const failureKind =
    event.kind === 'session_error'
      ? (event.failureDetail?.failureKind ?? event.failureKind)
      : undefined;
  if (failureKind === 'provider_aborted') return false;
  return (
    event.kind === 'session_error' &&
    (event.category === 'cancelled' || event.error === 'cancelled')
  );
}
