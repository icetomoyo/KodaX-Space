import assert from 'node:assert/strict';
import test from 'node:test';
import type {
  SpaceCoderConnectionProjectionT,
  SpaceRuntimeProfileProjectionT,
  SpaceSessionLiveProjectionT,
} from '@kodax-space/space-ipc-schema';

import type { ConversationMessage } from './composeMessages.js';
import {
  appendRuntimeFailureNotices,
  runtimeFailureProfileHasCurrentAuthority,
} from './runtimeFailureNotice.js';

const failureDetail = {
  failureKind: 'runtime_cleanup',
  stage: 'runtime_settlement',
  providerErrorCode: 'runtime_settlement_failed',
  safeMessage: 'The Runtime could not confirm settlement.',
  requestId: 'req_settlement',
} as const;

function activeUnknownLive(): SpaceSessionLiveProjectionT {
  return {
    sessionId: 'session_runtime_failure',
    projectionRevision: 3,
    cursor: { runtimeId: 'runtime_1', sessionId: 'session_runtime_failure', seq: 12 },
    transcriptRevision: 'revision_1',
    activeRun: {
      runId: 'run_settlement',
      sessionId: 'session_runtime_failure',
      phase: 'unknown',
      failureKind: failureDetail.failureKind,
      failureDetail,
      retriable: false,
    },
    queuedRuns: [],
    activeTools: [],
    todos: [],
    queuedInputs: [],
    interactions: [],
  };
}

test('active unknown run exposes structured settlement diagnostics without fabricating a terminal event', () => {
  const notices = appendRuntimeFailureNotices([], activeUnknownLive(), undefined);

  assert.deepEqual(notices, [
    {
      kind: 'system_notice',
      id: 'runtime_failure_run_settlement',
      variant: 'error',
      text: failureDetail.safeMessage,
      failureKind: failureDetail.failureKind,
      failureDetail,
      runtimeRunId: 'run_settlement',
      retriable: false,
    },
  ]);
});

test('cold-start profile terminal failure exposes its structured diagnostics', () => {
  const profileSession: SpaceRuntimeProfileProjectionT['sessions'][number] = {
    sessionId: 'session_runtime_failure',
    surface: 'code',
    createdAt: 1,
    lastActivityAt: 2,
    queuedRuns: [],
    lastTerminalRun: {
      runId: 'run_cold_terminal',
      sessionId: 'session_runtime_failure',
      phase: 'failed',
      failureKind: failureDetail.failureKind,
      failureDetail,
    },
  };

  const notices = appendRuntimeFailureNotices([], undefined, profileSession);

  assert.equal(notices.length, 1);
  assert.equal(notices[0]?.kind, 'system_notice');
  if (notices[0]?.kind === 'system_notice') {
    assert.equal(notices[0].runtimeRunId, 'run_cold_terminal');
    assert.equal(notices[0].failureDetail, failureDetail);
  }
});

test('runtime projections do not duplicate a terminal failure already present in the transcript', () => {
  const existing: ConversationMessage = {
    kind: 'system_notice',
    id: 'event_failure',
    variant: 'error',
    text: failureDetail.safeMessage,
    failureKind: failureDetail.failureKind,
    failureDetail,
    runtimeRunId: 'run_settlement',
  };

  const messages = [existing];
  assert.equal(appendRuntimeFailureNotices(messages, activeUnknownLive(), undefined), messages);
});

test('a current healthy active run does not resurface stale terminal or profile failures', () => {
  const live: SpaceSessionLiveProjectionT = {
    ...activeUnknownLive(),
    activeRun: {
      runId: 'run_current',
      sessionId: 'session_runtime_failure',
      phase: 'running',
    },
    lastTerminalRun: {
      runId: 'run_old_failure',
      sessionId: 'session_runtime_failure',
      phase: 'failed',
      failureKind: failureDetail.failureKind,
      failureDetail,
    },
  };
  const staleProfile: SpaceRuntimeProfileProjectionT['sessions'][number] = {
    sessionId: 'session_runtime_failure',
    surface: 'code',
    createdAt: 1,
    lastActivityAt: 2,
    queuedRuns: [],
    lastTerminalRun: live.lastTerminalRun,
  };
  const messages: readonly ConversationMessage[] = [];

  assert.equal(appendRuntimeFailureNotices(messages, live, staleProfile), messages);
});

test('a queued successor run does not resurface the previous terminal failure', () => {
  const live: SpaceSessionLiveProjectionT = {
    ...activeUnknownLive(),
    activeRun: undefined,
    queuedRuns: [
      {
        runId: 'run_queued_successor',
        sessionId: 'session_runtime_failure',
        phase: 'queued',
      },
    ],
    lastTerminalRun: {
      runId: 'run_old_failure',
      sessionId: 'session_runtime_failure',
      phase: 'failed',
      failureKind: failureDetail.failureKind,
      failureDetail,
    },
  };
  const messages: readonly ConversationMessage[] = [];

  assert.equal(appendRuntimeFailureNotices(messages, live, undefined), messages);
});

test('new profile activity outranks a stale live terminal failure', () => {
  const live: SpaceSessionLiveProjectionT = {
    ...activeUnknownLive(),
    activeRun: undefined,
    lastTerminalRun: {
      runId: 'run_old_failure',
      sessionId: 'session_runtime_failure',
      phase: 'failed',
      failureKind: failureDetail.failureKind,
      failureDetail,
    },
  };
  const queuedProfile: SpaceRuntimeProfileProjectionT['sessions'][number] = {
    sessionId: 'session_runtime_failure',
    surface: 'code',
    createdAt: 1,
    lastActivityAt: 3,
    queuedRuns: [
      {
        runId: 'run_queued_successor',
        sessionId: 'session_runtime_failure',
        phase: 'queued',
      },
    ],
  };
  const activeProfile: SpaceRuntimeProfileProjectionT['sessions'][number] = {
    ...queuedProfile,
    activeRun: {
      runId: 'run_active_successor',
      sessionId: 'session_runtime_failure',
      phase: 'running',
    },
    queuedRuns: [],
  };
  const staleActiveWithQueuedSuccessor: SpaceRuntimeProfileProjectionT['sessions'][number] = {
    ...queuedProfile,
    activeRun: live.lastTerminalRun,
  };
  const messages: readonly ConversationMessage[] = [];

  assert.equal(appendRuntimeFailureNotices(messages, live, queuedProfile), messages);
  assert.equal(appendRuntimeFailureNotices(messages, live, activeProfile), messages);
  assert.equal(
    appendRuntimeFailureNotices(messages, live, staleActiveWithQueuedSuccessor),
    messages,
  );
});

test('structured projection details enrich a generic notice for the same run', () => {
  const generic: ConversationMessage = {
    kind: 'system_notice',
    id: 'generic_runtime_error',
    variant: 'error',
    text: 'Runtime run failed',
    runtimeRunId: 'run_settlement',
    action: 'retry',
    retriable: true,
    retryAvailableAt: 123,
  };

  const notices = appendRuntimeFailureNotices([generic], activeUnknownLive(), undefined);

  assert.equal(notices.length, 1);
  assert.equal(notices[0]?.kind, 'system_notice');
  if (notices[0]?.kind === 'system_notice') {
    assert.equal(notices[0].id, generic.id);
    assert.equal(notices[0].text, failureDetail.safeMessage);
    assert.equal(notices[0].failureDetail, failureDetail);
    assert.equal(notices[0].action, undefined);
    assert.equal(notices[0].retriable, false);
    assert.equal(notices[0].retryAvailableAt, undefined);
  }
});

test('cold-start rate-limit diagnostics preserve the projected delayed retry action', () => {
  const delayedRetryDetail = {
    failureKind: 'rate_limit',
    stage: 'transport',
    providerErrorCode: 'rate_limited',
    safeMessage: 'The provider rate limit was reached.',
    retryAfterMs: 2_500,
  } as const;
  const profileSession: SpaceRuntimeProfileProjectionT['sessions'][number] = {
    sessionId: 'session_runtime_failure',
    surface: 'code',
    createdAt: 1,
    lastActivityAt: 2_002_500,
    queuedRuns: [],
    lastTerminalRun: {
      runId: 'run_rate_limit',
      sessionId: 'session_runtime_failure',
      phase: 'failed',
      completedAt: 2_000_000,
      failureKind: delayedRetryDetail.failureKind,
      failureDetail: delayedRetryDetail,
      retriable: true,
      action: 'retry',
      retryAvailableAt: 2_002_500,
    },
  };

  const notices = appendRuntimeFailureNotices([], undefined, profileSession);

  assert.equal(notices[0]?.kind, 'system_notice');
  if (notices[0]?.kind === 'system_notice') {
    assert.equal(notices[0].retriable, true);
    assert.equal(notices[0].action, 'retry');
    assert.equal(notices[0].retryAvailableAt, 2_002_500);
  }
});

test('profile failure fallback requires fresh authority from the same Runtime lineage', () => {
  const ready: SpaceCoderConnectionProjectionT = {
    state: 'ready',
    changedAt: 1,
    stale: false,
    runtimeId: 'runtime_current',
    capabilities: [],
  };
  const cursor = { runtimeId: 'runtime_current', seq: 1 } as const;

  assert.equal(runtimeFailureProfileHasCurrentAuthority(ready, cursor), true);
  assert.equal(
    runtimeFailureProfileHasCurrentAuthority(
      { ...ready, state: 'reconnecting', stale: true },
      cursor,
    ),
    false,
  );
  assert.equal(
    runtimeFailureProfileHasCurrentAuthority(ready, { runtimeId: 'runtime_old', seq: 9 }),
    false,
  );
});
