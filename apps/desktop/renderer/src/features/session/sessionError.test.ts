import assert from 'node:assert/strict';
import test from 'node:test';

import { isCancelledSessionError } from './sessionError.js';

test('structured and legacy cancellation events share one classification', () => {
  assert.equal(
    isCancelledSessionError({
      kind: 'session_error',
      sessionId: 'structured',
      error: 'Runtime run was cancelled by the user.',
      category: 'cancelled',
    }),
    true,
  );
  assert.equal(
    isCancelledSessionError({ kind: 'session_error', sessionId: 'legacy', error: 'cancelled' }),
    true,
  );
  assert.equal(
    isCancelledSessionError({
      kind: 'session_error',
      sessionId: 'failure',
      error: 'Provider failed.',
      category: 'unknown',
    }),
    false,
  );
  assert.equal(
    isCancelledSessionError({
      kind: 'session_error',
      sessionId: 'provider-abort',
      error: 'Provider request was aborted.',
      failureKind: 'provider_aborted',
      category: 'cancelled',
    }),
    false,
  );
});
