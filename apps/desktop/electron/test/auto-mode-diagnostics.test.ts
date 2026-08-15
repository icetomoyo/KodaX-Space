import assert from 'node:assert/strict';
import test from 'node:test';

import { projectAutoModeDiagnostics } from '../permission/auto-mode-diagnostics.js';

test('Auto[LLM] diagnostic projection retains supported decision metadata only', () => {
  const projected = projectAutoModeDiagnostics({
    source: 'classifier_failure',
    classifierFailureKind: 'contract_error',
    classifierAttempts: [
      {
        attempt: 1,
        outcome: 'contract_error',
        observedProtocol: 'legacy_v1',
        parseFailureCode: 'missing_decision',
        outputWarnings: ['missing_reason', 'future_warning', 'missing_reason'],
        rawResponse: '<decision>ask</decision>',
        diagnostics: {
          provider: 'api_key=TOP_SECRET',
          model: 'classifier\u202emodel',
          timeoutMs: 10_000,
          elapsedMs: 42,
          promptBytes: 400,
          retryCount: 1,
          retryWaitMs: 25,
          terminalPhase: 'contract_error',
          systemBytes: 100,
          messageBytes: 300,
          rawResponse: 'secret',
        },
      },
    ],
    rawResponse: 'secret',
  });

  assert.deepEqual(projected, {
    source: 'classifier_failure',
    classifierFailureKind: 'contract_error',
    classifierAttempts: [
      {
        attempt: 1,
        outcome: 'contract_error',
        observedProtocol: 'legacy_v1',
        parseFailureCode: 'missing_decision',
        outputWarnings: ['missing_reason'],
        diagnostics: {
          provider: 'api_key=[REDACTED]',
          model: 'classifiermodel',
          timeoutMs: 10_000,
          elapsedMs: 42,
          promptBytes: 400,
          retryCount: 1,
          retryWaitMs: 25,
          terminalPhase: 'contract_error',
        },
      },
    ],
  });
  assert.equal(JSON.stringify(projected).includes('<decision>'), false);
});

test('Auto[LLM] diagnostic projection drops malformed optional details without dropping source', () => {
  assert.deepEqual(
    projectAutoModeDiagnostics({
      source: 'configuration',
      classifierFailureKind: 'future_failure',
      classifierAttempts: [
        { attempt: 0, outcome: 'confirm' },
        { attempt: 1, outcome: 'future_outcome' },
      ],
    }),
    { source: 'configuration' },
  );
  assert.equal(projectAutoModeDiagnostics({ source: 'future_source' }), undefined);
  assert.equal(projectAutoModeDiagnostics('classifier_confirm'), undefined);
});

test('Auto[LLM] diagnostic projection bounds warning work before inspecting candidates', () => {
  const warnings: unknown[] = [
    'x'.repeat(1_000_000),
    ...Array.from({ length: 63 }, () => 'future_warning'),
  ];
  Object.defineProperty(warnings, 64, {
    configurable: true,
    get: () => {
      throw new Error('warning candidate beyond the scan bound was accessed');
    },
  });
  warnings.length = 1_000_000;

  assert.deepEqual(
    projectAutoModeDiagnostics({
      source: 'classifier_confirm',
      classifierAttempts: [{ attempt: 1, outcome: 'confirm', outputWarnings: warnings }],
    }),
    {
      source: 'classifier_confirm',
      classifierAttempts: [{ attempt: 1, outcome: 'confirm' }],
    },
  );
});

test('Auto[LLM] diagnostic projection clamps reason by UTF-16 code units for the strict schema', () => {
  // sanitizeForDisplay trims by Unicode scalars: 511 emoji + ellipsis are ~1023
  // UTF-16 code units, which zod's .max(512) rejects — without a code-unit
  // clamp the whole diagnostics object would be dropped (safe but silent).
  const projected = projectAutoModeDiagnostics({
    source: 'classifier_confirm',
    reason: '\u{1F600}'.repeat(600),
  });

  assert.notEqual(projected, undefined);
  assert.equal((projected?.reason ?? '').length <= 512, true);
});

test('Auto[LLM] diagnostic projection bounds, redacts, and strips a long reason', () => {
  const projected = projectAutoModeDiagnostics({
    source: 'classifier_confirm',
    reason: `api_key=sk-secret \u202edlrow ${'x'.repeat(10_000)}`,
  });

  assert.notEqual(projected, undefined);
  const reason = projected?.reason ?? '';
  assert.equal(reason.length <= 512, true);
  assert.equal(reason.includes('[REDACTED]'), true);
  assert.equal(reason.includes('\u202e'), false);

  assert.deepEqual(projectAutoModeDiagnostics({ source: 'classifier_confirm', reason: '' }), {
    source: 'classifier_confirm',
  });
});
