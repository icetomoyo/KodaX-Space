import { test } from 'node:test';
import assert from 'node:assert/strict';

import { artifactPreviewFileChannel } from '../src/index.js';

test('artifact.previewFile output is a read-only preview payload', () => {
  assert.equal(
    artifactPreviewFileChannel.output.safeParse({
      title: 'README.md',
      kind: 'markdown',
      content: '# Notes',
      path: 'README.md',
    }).success,
    true,
  );
  assert.equal(
    artifactPreviewFileChannel.output.safeParse({
      title: 'report.pdf',
      kind: 'pdf',
      path: 'docs/report.pdf',
    }).success,
    true,
  );
});

test('artifact.previewFile output rejects old persisted artifact shape', () => {
  assert.equal(
    artifactPreviewFileChannel.output.safeParse({
      id: 'a1',
      version: 1,
      kind: 'markdown',
    }).success,
    false,
  );
});
