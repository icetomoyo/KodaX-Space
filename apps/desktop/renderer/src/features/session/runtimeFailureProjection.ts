import type { SpaceRuntimeFailureDetailT } from '@kodax-space/space-ipc-schema';

import type { ConversationMessage } from './composeMessages.js';

type SystemNotice = Extract<ConversationMessage, { kind: 'system_notice' }>;

function failureDetailsMatch(
  previous: SpaceRuntimeFailureDetailT | undefined,
  next: SpaceRuntimeFailureDetailT | undefined,
): boolean {
  if (previous === next) return true;
  if (previous === undefined || next === undefined) return false;
  return (
    previous.failureKind === next.failureKind &&
    previous.stage === next.stage &&
    previous.providerErrorCode === next.providerErrorCode &&
    previous.safeMessage === next.safeMessage &&
    previous.httpStatus === next.httpStatus &&
    previous.upstreamErrorCode === next.upstreamErrorCode &&
    previous.requestId === next.requestId &&
    previous.retryAfterMs === next.retryAfterMs &&
    previous.contextTokens?.required === next.contextTokens?.required &&
    previous.contextTokens?.available === next.contextTokens?.available
  );
}

export function runtimeFailureProjectionMatches(
  previous: SystemNotice,
  next: SystemNotice,
): boolean {
  return (
    previous.failureKind === next.failureKind &&
    previous.runtimeRunId === next.runtimeRunId &&
    failureDetailsMatch(previous.failureDetail, next.failureDetail)
  );
}
