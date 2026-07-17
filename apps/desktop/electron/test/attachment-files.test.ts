import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createPendingAttachmentGate,
  inlineImageMediaType,
  isSupportedInlineImage,
} from '../../renderer/src/shell/attachmentFiles.js';

test('inline image detection accepts the SDK image formats by MIME type', () => {
  assert.equal(inlineImageMediaType({ name: 'scan.bin', type: 'image/png' }), 'image/png');
  assert.equal(inlineImageMediaType({ name: 'photo', type: 'image/jpg' }), 'image/jpeg');
  assert.equal(inlineImageMediaType({ name: 'photo', type: 'image/webp' }), 'image/webp');
});

test('inline image detection falls back to common extensions when MIME is missing or generic', () => {
  assert.equal(inlineImageMediaType({ name: 'PHOTO.JPEG', type: '' }), 'image/jpeg');
  assert.equal(
    inlineImageMediaType({ name: 'capture.PNG', type: 'application/octet-stream' }),
    'image/png',
  );
  assert.equal(inlineImageMediaType({ name: 'photo.jfif', type: '' }), 'image/jpeg');
});

test('other image and document formats remain file references instead of inline images', () => {
  for (const file of [
    { name: 'animation.gif', type: 'image/gif' },
    { name: 'diagram.svg', type: 'image/svg+xml' },
    { name: 'report.pdf', type: 'application/pdf' },
    { name: 'archive.unknown', type: '' },
  ]) {
    assert.equal(isSupportedInlineImage(file), false, file.name);
  }
});

test('an explicit unsupported MIME type is not overridden by a misleading extension', () => {
  assert.equal(inlineImageMediaType({ name: 'renamed.png', type: 'image/gif' }), null);
  assert.equal(inlineImageMediaType({ name: 'renamed.jpg', type: 'application/pdf' }), null);
});

test('attachment gate becomes pending synchronously and waits for every operation', () => {
  const changes: boolean[] = [];
  const gate = createPendingAttachmentGate((pending) => changes.push(pending));

  const releaseFirst = gate.begin();
  assert.equal(gate.isPending(), true);
  assert.deepEqual(changes, [true]);

  const releaseSecond = gate.begin();
  releaseFirst();
  assert.equal(gate.isPending(), true);
  assert.deepEqual(changes, [true]);

  releaseSecond();
  assert.equal(gate.isPending(), false);
  assert.deepEqual(changes, [true, false]);
});

test('attachment gate release is idempotent', () => {
  const changes: boolean[] = [];
  const gate = createPendingAttachmentGate((pending) => changes.push(pending));
  const release = gate.begin();

  release();
  release();

  assert.equal(gate.isPending(), false);
  assert.deepEqual(changes, [true, false]);
});
