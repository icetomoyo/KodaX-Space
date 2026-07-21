import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WEB_PREVIEW_DIAGNOSTIC_MESSAGE_TYPE } from '@kodax-space/space-ipc-schema';
import {
  parseWebPreviewDiagnostic,
  webPreviewDiagnosticKey,
} from '../../renderer/src/features/preview/webPreviewDiagnostics.js';

test('web preview diagnostics accept only the bounded structured message contract', () => {
  assert.deepEqual(
    parseWebPreviewDiagnostic({
      type: WEB_PREVIEW_DIAGNOSTIC_MESSAGE_TYPE,
      kind: 'runtime',
      message: 'boom',
      directive: '',
    }),
    { kind: 'runtime', message: 'boom', directive: '' },
  );
  assert.equal(parseWebPreviewDiagnostic({ type: 'spoof', kind: 'runtime' }), null);
  assert.equal(
    parseWebPreviewDiagnostic({
      type: WEB_PREVIEW_DIAGNOSTIC_MESSAGE_TYPE,
      kind: 'unknown',
    }),
    null,
  );
  assert.equal(parseWebPreviewDiagnostic('runtime'), null);
});

test('web preview diagnostics remove line breaks, bound text, and dedupe stably', () => {
  const diagnostic = parseWebPreviewDiagnostic({
    type: WEB_PREVIEW_DIAGNOSTIC_MESSAGE_TYPE,
    kind: 'policy',
    message: `blocked\r\n${'x'.repeat(500)}`,
    directive: 'connect-src\nhttps:',
  });
  assert.ok(diagnostic);
  assert.equal(diagnostic.message.includes('\n'), false);
  assert.equal(diagnostic.directive.includes('\n'), false);
  assert.ok(diagnostic.message.length <= 240);
  assert.equal(webPreviewDiagnosticKey(diagnostic), webPreviewDiagnosticKey({ ...diagnostic }));
});
