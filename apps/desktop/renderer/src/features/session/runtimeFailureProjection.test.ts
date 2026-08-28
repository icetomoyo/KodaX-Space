import assert from 'node:assert/strict';
import test from 'node:test';

import type { ConversationMessage } from './composeMessages.js';
import { runtimeFailureProjectionMatches } from './runtimeFailureProjection.js';

type SystemNotice = Extract<ConversationMessage, { kind: 'system_notice' }>;

const previous: SystemNotice = {
  kind: 'system_notice',
  id: 'error_same_id',
  variant: 'error',
  text: 'Runtime failure.',
  failureKind: 'provider',
  runtimeRunId: 'run_1',
  failureDetail: {
    failureKind: 'provider',
    stage: 'transport',
    providerErrorCode: 'provider_error',
    safeMessage: 'Runtime failure.',
    requestId: 'request_old',
  },
};

test('same-id notice projection changes when structured Runtime diagnostics are enriched', () => {
  assert.equal(
    runtimeFailureProjectionMatches(previous, {
      ...previous,
      failureDetail: { ...previous.failureDetail!, requestId: 'request_new' },
    }),
    false,
  );
  assert.equal(
    runtimeFailureProjectionMatches(previous, { ...previous, runtimeRunId: 'run_2' }),
    false,
  );
  assert.equal(
    runtimeFailureProjectionMatches(previous, { ...previous, failureKind: 'runtime_cleanup' }),
    false,
  );
});

test('equivalent cloned Runtime diagnostics retain a stable notice projection', () => {
  assert.equal(
    runtimeFailureProjectionMatches(previous, {
      ...previous,
      failureDetail: {
        ...previous.failureDetail!,
        contextTokens: { required: 143_400, available: 131_072 },
      },
    }),
    false,
  );
  const withTokens: SystemNotice = {
    ...previous,
    failureDetail: {
      ...previous.failureDetail!,
      contextTokens: { required: 143_400, available: 131_072 },
    },
  };
  assert.equal(
    runtimeFailureProjectionMatches(withTokens, {
      ...withTokens,
      failureDetail: {
        ...withTokens.failureDetail!,
        contextTokens: { required: 143_400, available: 131_072 },
      },
    }),
    true,
  );
});
