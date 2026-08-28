import type {
  SpaceCoderConnectionProjectionT,
  SpaceRuntimeProfileProjectionT,
  SpaceRuntimeRunProjectionT,
  SpaceSessionLiveProjectionT,
} from '@kodax-space/space-ipc-schema';

import type { ConversationMessage } from './composeMessages.js';
import {
  runtimeConnectionHasFreshLiveAuthority,
  runtimeProfileSessionActivityOutranksLive,
} from '../../store/runtimeProjectionState.js';

type RuntimeProfileSession = SpaceRuntimeProfileProjectionT['sessions'][number];

function currentDiagnosticRun(
  live: SpaceSessionLiveProjectionT | undefined,
  profileSession: RuntimeProfileSession | undefined,
): SpaceRuntimeRunProjectionT | undefined {
  if (runtimeProfileSessionActivityOutranksLive(profileSession, live)) {
    const profileActiveRun = profileSession?.activeRun;
    return profileActiveRun?.runId === live?.lastTerminalRun?.runId ? undefined : profileActiveRun;
  }
  if (live !== undefined) {
    if (live.activeRun !== undefined) return live.activeRun;
    return live.queuedRuns.length > 0 ? undefined : live.lastTerminalRun;
  }
  if (profileSession?.activeRun !== undefined) return profileSession.activeRun;
  return (profileSession?.queuedRuns.length ?? 0) > 0 ? undefined : profileSession?.lastTerminalRun;
}

export function runtimeFailureProfileHasCurrentAuthority(
  connection: SpaceCoderConnectionProjectionT,
  profileCursor: SpaceRuntimeProfileProjectionT['cursor'] | undefined,
): boolean {
  return (
    runtimeConnectionHasFreshLiveAuthority(connection) &&
    connection.runtimeId !== undefined &&
    profileCursor?.runtimeId === connection.runtimeId
  );
}

export function appendRuntimeFailureNotices(
  messages: readonly ConversationMessage[],
  live: SpaceSessionLiveProjectionT | undefined,
  profileSession: RuntimeProfileSession | undefined,
): readonly ConversationMessage[] {
  const run = currentDiagnosticRun(live, profileSession);
  if (run?.failureDetail === undefined) return messages;
  const failureDetail = run.failureDetail;
  const existingIndex = messages.findIndex(
    (message) => message.kind === 'system_notice' && message.runtimeRunId === run.runId,
  );
  if (existingIndex >= 0) {
    const existing = messages[existingIndex];
    if (existing?.kind !== 'system_notice' || existing.failureDetail !== undefined) return messages;
    const {
      action: _action,
      retriable: _retriable,
      retryAvailableAt: _retryAvailableAt,
      ...safeExisting
    } = existing;
    return messages.map((message, index) =>
      index === existingIndex
        ? {
            ...safeExisting,
            text: failureDetail.safeMessage,
            failureKind: failureDetail.failureKind,
            failureDetail,
          }
        : message,
    );
  }
  return [
    ...messages,
    {
      kind: 'system_notice',
      id: `runtime_failure_${run.runId}`,
      variant: 'error',
      text: failureDetail.safeMessage,
      failureKind: failureDetail.failureKind,
      failureDetail,
      runtimeRunId: run.runId,
    },
  ];
}
