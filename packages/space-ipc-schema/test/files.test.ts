// FEATURE_009: files.tree / files.read / files.diff schema tests.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  invokeChannels,
  INVOKE_CHANNEL_NAMES,
  filesTreeChannel,
  filesReadChannel,
  filesReadBinaryChannel,
  filesDiffChannel,
  filesStatChannel,
  fileNodeSchema,
  MAX_FILE_BYTES,
} from '../src/index.js';

test('all files invoke channels are registered', () => {
  for (const name of ['files.tree', 'files.read', 'files.readBinary', 'files.stat', 'files.diff']) {
    assert.ok(invokeChannels[name as keyof typeof invokeChannels], `${name} should be in invokeChannels`);
    assert.ok(INVOKE_CHANNEL_NAMES.has(name), `${name} should be in INVOKE_CHANNEL_NAMES`);
  }
});

test('fileNodeSchema accepts file and dir', () => {
  assert.equal(fileNodeSchema.safeParse({ name: 'a.ts', path: 'src/a.ts', kind: 'file', size: 100 }).success, true);
  assert.equal(fileNodeSchema.safeParse({ name: 'src', path: 'src', kind: 'dir' }).success, true);
});

test('fileNodeSchema rejects unknown kind', () => {
  assert.equal(fileNodeSchema.safeParse({ name: 'x', path: 'x', kind: 'symlink' }).success, false);
});

test('fileNodeSchema supports nested children', () => {
  const tree = {
    name: 'src',
    path: 'src',
    kind: 'dir' as const,
    children: [
      { name: 'a.ts', path: 'src/a.ts', kind: 'file' as const, size: 12 },
      {
        name: 'sub',
        path: 'src/sub',
        kind: 'dir' as const,
        children: [{ name: 'b.ts', path: 'src/sub/b.ts', kind: 'file' as const, size: 5 }],
      },
    ],
  };
  assert.equal(fileNodeSchema.safeParse(tree).success, true);
});

test('files.tree input requires projectRoot', () => {
  assert.equal(filesTreeChannel.input.safeParse({ projectRoot: '/r' }).success, true);
  assert.equal(filesTreeChannel.input.safeParse({}).success, false);
  assert.equal(filesTreeChannel.input.safeParse({ projectRoot: '' }).success, false);
});

test('files.tree input rejects path with control chars', () => {
  assert.equal(filesTreeChannel.input.safeParse({ projectRoot: '/r\0evil' }).success, false);
  assert.equal(filesTreeChannel.input.safeParse({ projectRoot: '/r\nevil' }).success, false);
});

test('files.tree depth must be positive', () => {
  assert.equal(filesTreeChannel.input.safeParse({ projectRoot: '/r', depth: 0 }).success, false);
  assert.equal(filesTreeChannel.input.safeParse({ projectRoot: '/r', depth: 6 }).success, false);
  assert.equal(filesTreeChannel.input.safeParse({ projectRoot: '/r', depth: 3 }).success, true);
});

test('files.tree output requires tree array + truncated flag', () => {
  assert.equal(filesTreeChannel.output.safeParse({ tree: [], truncated: false }).success, true);
  assert.equal(filesTreeChannel.output.safeParse({ tree: [] }).success, false);
});

test('files.read input requires projectRoot + path', () => {
  assert.equal(filesReadChannel.input.safeParse({ projectRoot: '/r', path: 'a.ts' }).success, true);
  assert.equal(filesReadChannel.input.safeParse({ projectRoot: '/r' }).success, false);
  assert.equal(filesReadChannel.input.safeParse({ path: 'a.ts' }).success, false);
});

test('files.read output shape', () => {
  const ok = filesReadChannel.output.safeParse({
    content: 'hello',
    encoding: 'utf-8',
    size: 5,
    isBinary: false,
    truncated: false,
  });
  assert.equal(ok.success, true);
});

test('files.read output rejects wrong encoding literal', () => {
  const bad = filesReadChannel.output.safeParse({
    content: '',
    encoding: 'base64', // not allowed in v0.1.0
    size: 0,
    isBinary: false,
    truncated: false,
  });
  assert.equal(bad.success, false);
});

test('files.readBinary keeps base64 preview caps bounded to 50 MB', () => {
  assert.equal(
    filesReadBinaryChannel.input.safeParse({
      projectRoot: '/r',
      path: 'clip.mp4',
      maxBytes: 50 * 1024 * 1024,
    }).success,
    true,
  );
  assert.equal(
    filesReadBinaryChannel.input.safeParse({
      projectRoot: '/r',
      path: 'huge.mp4',
      maxBytes: 50 * 1024 * 1024 + 1,
    }).success,
    false,
  );
});

test('files.diff input + output shape', () => {
  assert.equal(filesDiffChannel.input.safeParse({ projectRoot: '/r', path: 'a.ts' }).success, true);
  assert.equal(
    filesDiffChannel.output.safeParse({ before: 'a', after: 'b', available: true }).success,
    true,
  );
  assert.equal(
    filesDiffChannel.output.safeParse({ before: '', after: '', available: false }).success,
    true,
  );
});

test('files.stat input + output shape', () => {
  assert.equal(filesStatChannel.input.safeParse({ projectRoot: '/r', path: 'a.ts' }).success, true);
  assert.equal(filesStatChannel.input.safeParse({ projectRoot: '/r' }).success, false);
  assert.equal(
    filesStatChannel.output.safeParse({ exists: true, kind: 'file', size: 12 }).success,
    true,
  );
  assert.equal(filesStatChannel.output.safeParse({ exists: true, kind: 'dir' }).success, true);
  assert.equal(filesStatChannel.output.safeParse({ exists: false, kind: null }).success, true);
});

test('MAX_FILE_BYTES is 5 MB', () => {
  assert.equal(MAX_FILE_BYTES, 5 * 1024 * 1024);
});
