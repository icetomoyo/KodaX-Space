import { test } from 'node:test';
import assert from 'node:assert/strict';
import { redactDiagnosticText, redactDiagnosticValue } from '../diagnostics/redaction.js';

test('diagnostic redaction removes credentials, auth headers, URL secrets, and profile paths', () => {
  const text = redactDiagnosticText(
    'Authorization: Bearer abcdefghijklmnop https://alice:password@example.com/api?api_key=secret-123&ok=yes c:\\USERS\\ALICE\\project',
    {
      secretValues: ['secret-123'],
      privatePathPrefixes: ['C:\\Users\\alice'],
    },
  );

  assert.doesNotMatch(text, /abcdefghijklmnop|alice:password|secret-123|C:\\Users\\alice/i);
  assert.match(text, /Bearer \[REDACTED\]/);
  assert.match(text, /api_key=%5BREDACTED%5D/);
  assert.match(text, /\[PRIVATE_PATH\]/);
});

test('diagnostic structured redaction removes content fields and sensitive keys recursively', () => {
  const value = redactDiagnosticValue({
    component: 'runtime',
    prompt: 'private task prompt',
    prompt_text: 'another private prompt',
    messages: ['private message'],
    nested: {
      apiKey: 'sk-super-secret',
      toolInput: { path: '/workspace/private', body: 'document body' },
      fileContent: 'private file',
      inputArtifacts: [{ content: 'private artifact' }],
      safeCount: 3,
    },
  });

  assert.deepEqual(value, {
    component: 'runtime',
    prompt: '[CONTENT_REDACTED]',
    prompt_text: '[CONTENT_REDACTED]',
    messages: '[CONTENT_REDACTED]',
    nested: {
      apiKey: '[REDACTED]',
      toolInput: '[CONTENT_REDACTED]',
      fileContent: '[CONTENT_REDACTED]',
      inputArtifacts: '[CONTENT_REDACTED]',
      safeCount: 3,
    },
  });
});

test('diagnostic redaction bounds depth, keys, arrays, strings, errors, and circular values', () => {
  const circular: Record<string, unknown> = { value: 'ok' };
  circular.self = circular;
  const result = redactDiagnosticValue(
    {
      long: 'x'.repeat(100),
      many: Array.from({ length: 10 }, (_, index) => index),
      error: new Error('Bearer top-secret-token'),
      circular,
      deep: { a: { b: { c: { d: true } } } },
    },
    { maxDepth: 3, maxArrayItems: 3, maxStringLength: 16, maxObjectKeys: 8 },
  ) as Record<string, unknown>;

  assert.equal(result.long, `${'x'.repeat(16)}...[truncated]`);
  assert.deepEqual(result.many, [0, 1, 2, '[TRUNCATED 7 ITEMS]']);
  assert.deepEqual(result.error, { name: 'Error', message: 'Bearer [REDACTED]' });
  assert.deepEqual(result.circular, { value: 'ok', self: '[CIRCULAR]' });
  assert.deepEqual(result.deep, { a: { b: '[MAX_DEPTH]' } });
});
