import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diagnosticsExportChannel, diagnosticsReportChannel } from '../src/channels/diagnostics.js';

test('diagnostics.report accepts only bounded allowlisted renderer metadata', () => {
  assert.equal(
    diagnosticsReportChannel.input.safeParse({
      level: 'error',
      component: 'react',
      event: 'error-boundary.render',
      message: 'render failed',
      context: { retryCount: 1, recoverable: true },
    }).success,
    true,
  );
  assert.equal(
    diagnosticsReportChannel.input.safeParse({
      level: 'info',
      component: 'arbitrary',
      event: 'x',
    }).success,
    false,
  );
  assert.equal(
    diagnosticsReportChannel.input.safeParse({
      level: 'info',
      component: 'renderer',
      event: 'x',
      message: 'x'.repeat(2049),
    }).success,
    false,
  );
  assert.equal(
    diagnosticsReportChannel.input.safeParse({
      level: 'info',
      component: 'renderer',
      event: 'x',
      context: Object.fromEntries(Array.from({ length: 17 }, (_, index) => [`k${index}`, index])),
    }).success,
    false,
  );
});

test('diagnostics.export accepts reviewed categories and rejects unknown keys', () => {
  assert.equal(diagnosticsExportChannel.input.safeParse({}).success, true);
  assert.equal(
    diagnosticsExportChannel.input.safeParse({
      categories: ['manifest', 'logs'],
      sessionId: 's_current',
    }).success,
    true,
  );
  assert.equal(
    diagnosticsExportChannel.input.safeParse({ categories: ['secrets'] }).success,
    false,
  );
  assert.equal(
    diagnosticsExportChannel.input.safeParse({ sessionId: 'x'.repeat(129) }).success,
    false,
  );
  assert.equal(diagnosticsExportChannel.input.safeParse({ path: 'C:\\secret.zip' }).success, false);
});
