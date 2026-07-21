import assert from 'node:assert/strict';
import test from 'node:test';

import { buildAttachmentPathOverlay } from '../kodax/attachment-path-overlay.js';

test('attachment path overlay preserves native path values without changing the user prompt', () => {
  const paths = [
    { kind: 'file' as const, path: 'D:\\notes\\KodaX Fabric\\\u4ea7\u54c1\u8bbe\u8ba1.md' },
    { kind: 'directory' as const, path: '/Users/alice/Project Notes' },
  ];
  const overlay = buildAttachmentPathOverlay(paths);

  assert.ok(overlay);
  const match = overlay.match(/<attached_paths>\n([\s\S]+?)\n<\/attached_paths>/);
  assert.ok(match?.[1]);
  assert.deepEqual(JSON.parse(match[1]), paths);
});

test('attachment path overlay is absent when no local paths were attached', () => {
  assert.equal(buildAttachmentPathOverlay(undefined), undefined);
  assert.equal(buildAttachmentPathOverlay([]), undefined);
});
