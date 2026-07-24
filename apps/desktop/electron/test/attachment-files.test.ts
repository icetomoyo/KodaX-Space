import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clipboardImageFiles,
  createPendingAttachmentGate,
  inlineImageMediaType,
  isSupportedInlineImage,
} from '../../renderer/src/shell/attachmentFiles.js';

function clipboardData(
  files: readonly File[],
  itemFiles: readonly File[],
): Pick<DataTransfer, 'files' | 'items'> {
  const fileList = Object.assign([...files], {
    item: (index: number): File | null => files[index] ?? null,
  }) as unknown as FileList;
  const itemList = itemFiles.map((file) => ({
    kind: 'file' as const,
    type: file.type,
    getAsFile: (): File => file,
  })) as unknown as DataTransferItemList;
  return { files: fileList, items: itemList };
}

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

test('clipboard image extraction does not merge duplicate files and items representations', () => {
  const bytes = new Uint8Array([1, 2, 3, 4]);
  const fileRepresentation = new File([bytes], 'clipboard.png', {
    type: 'image/png',
    lastModified: 10,
  });
  const itemRepresentation = new File([bytes], 'image.png', {
    type: 'image/png',
    lastModified: 20,
  });

  assert.deepEqual(clipboardImageFiles(clipboardData([fileRepresentation], [itemRepresentation])), [
    fileRepresentation,
  ]);
});

test('clipboard image extraction falls back to items when files is empty', () => {
  const itemImage = new File([new Uint8Array([1, 2, 3])], 'image.png', {
    type: 'image/png',
  });

  assert.deepEqual(clipboardImageFiles(clipboardData([], [itemImage])), [itemImage]);
});

test('clipboard image extraction preserves multiple images from its canonical file list', () => {
  const first = new File([new Uint8Array([1])], 'first.png', { type: 'image/png' });
  const second = new File([new Uint8Array([2])], 'second.jpg', { type: 'image/jpeg' });

  assert.deepEqual(clipboardImageFiles(clipboardData([first, second], [])), [first, second]);
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
