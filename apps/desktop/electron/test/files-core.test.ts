// Unit tests for files-core (no electron runtime).
//
// 覆盖 path-traversal 防御、tree walk + skip dirs、binary detect、5 MB cap、diff cache。

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import JSZip from 'jszip';
import os from 'node:os';
import {
  resolveInsideProject,
  walkTree,
  looksBinary,
  readFileWithGuards,
  readFileBinaryWithGuards,
  statPath,
  recordDiff,
  getDiff,
  resetDiffCache,
  isPathInside,
  toPosixRelative,
  SKIP_DIRS,
} from '../ipc/files-core.js';

let tmpRoot = '';

beforeEach(async () => {
  tmpRoot = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'kodax-files-test-')));
  resetDiffCache();
});

afterEach(async () => {
  try {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  } catch {
    // ignore
  }
});

// ---- isPathInside ----
test('isPathInside: identical paths are inside', () => {
  assert.equal(isPathInside('/a/b', '/a/b'), true);
});

test('isPathInside: child path', () => {
  assert.equal(isPathInside(path.join('/a/b', 'c'), '/a/b'), true);
});

test('isPathInside: escape via ..', () => {
  assert.equal(isPathInside('/a', '/a/b'), false);
});

// ---- resolveInsideProject ----
test('resolveInsideProject: accepts file in root', async () => {
  await fs.writeFile(path.join(tmpRoot, 'a.txt'), 'hi');
  const out = await resolveInsideProject(tmpRoot, 'a.txt');
  assert.equal(out, path.join(tmpRoot, 'a.txt'));
});

test('resolveInsideProject: rejects ../../etc/passwd', async () => {
  await assert.rejects(
    () => resolveInsideProject(tmpRoot, '../../etc/passwd'),
    /escapes projectRoot/,
  );
});

test('resolveInsideProject: accepts nested subpath', async () => {
  const sub = path.join(tmpRoot, 'src', 'deep');
  await fs.mkdir(sub, { recursive: true });
  await fs.writeFile(path.join(sub, 'x.ts'), 'x');
  const out = await resolveInsideProject(tmpRoot, 'src/deep/x.ts');
  assert.equal(out, path.join(sub, 'x.ts'));
});

test('resolveInsideProject: posix slashes work on all platforms', async () => {
  await fs.mkdir(path.join(tmpRoot, 'a', 'b'), { recursive: true });
  await fs.writeFile(path.join(tmpRoot, 'a', 'b', 'c.txt'), 'hi');
  const out = await resolveInsideProject(tmpRoot, 'a/b/c.txt');
  assert.equal(out, path.join(tmpRoot, 'a', 'b', 'c.txt'));
});

test('resolveInsideProject: non-existent file returns target path (caller handles ENOENT)', async () => {
  const out = await resolveInsideProject(tmpRoot, 'no-such-file.txt');
  assert.equal(out, path.join(tmpRoot, 'no-such-file.txt'));
});

test('resolveInsideProject: rejects symlink escape', async () => {
  // POSIX-only: Windows symlink 需要管理员/开发者模式，CI 不稳。跳过。
  if (process.platform === 'win32') return;
  const outside = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'kodax-outside-')));
  try {
    await fs.writeFile(path.join(outside, 'secret.txt'), 'pwned');
    await fs.symlink(outside, path.join(tmpRoot, 'escape'));
    await assert.rejects(
      () => resolveInsideProject(tmpRoot, 'escape/secret.txt'),
      /escapes projectRoot via symlink/,
    );
  } finally {
    await fs.rm(outside, { recursive: true, force: true });
  }
});

// ---- walkTree ----
test('walkTree: lists files and dirs at depth=1', async () => {
  await fs.mkdir(path.join(tmpRoot, 'src'));
  await fs.writeFile(path.join(tmpRoot, 'README.md'), '# hi');
  await fs.writeFile(path.join(tmpRoot, 'src', 'a.ts'), 'x');
  const counter = { count: 0 };
  const tree = await walkTree(tmpRoot, tmpRoot, 1, counter);
  const names = tree.map((n) => n.name).sort();
  assert.deepEqual(names, ['README.md', 'src']);
  // depth=1: src 不应展开 children
  const srcNode = tree.find((n) => n.name === 'src');
  assert.equal(srcNode?.children, undefined);
});

test('walkTree: depth=2 expands one level of children', async () => {
  await fs.mkdir(path.join(tmpRoot, 'src'));
  await fs.writeFile(path.join(tmpRoot, 'src', 'a.ts'), 'x');
  const counter = { count: 0 };
  const tree = await walkTree(tmpRoot, tmpRoot, 2, counter);
  const srcNode = tree.find((n) => n.name === 'src');
  assert.ok(srcNode?.children);
  assert.equal(srcNode?.children?.[0]?.name, 'a.ts');
});

test('walkTree: skips node_modules and .git', async () => {
  await fs.mkdir(path.join(tmpRoot, 'node_modules'));
  await fs.mkdir(path.join(tmpRoot, '.git'));
  await fs.mkdir(path.join(tmpRoot, 'src'));
  const counter = { count: 0 };
  const tree = await walkTree(tmpRoot, tmpRoot, 1, counter);
  const names = tree.map((n) => n.name);
  assert.ok(!names.includes('node_modules'));
  assert.ok(!names.includes('.git'));
  assert.ok(names.includes('src'));
});

test('walkTree: SKIP_DIRS contains the expected entries', () => {
  assert.ok(SKIP_DIRS.has('node_modules'));
  assert.ok(SKIP_DIRS.has('.git'));
  assert.ok(SKIP_DIRS.has('dist'));
  assert.ok(SKIP_DIRS.has('coverage'));
});

test('walkTree: dirs sort before files at same level', async () => {
  await fs.writeFile(path.join(tmpRoot, 'a.txt'), 'a');
  await fs.mkdir(path.join(tmpRoot, 'b'));
  const counter = { count: 0 };
  const tree = await walkTree(tmpRoot, tmpRoot, 1, counter);
  assert.equal(tree[0]?.name, 'b'); // dir first
  assert.equal(tree[1]?.name, 'a.txt');
});

test('walkTree: provides size for files', async () => {
  await fs.writeFile(path.join(tmpRoot, 'a.txt'), 'hello');
  const counter = { count: 0 };
  const tree = await walkTree(tmpRoot, tmpRoot, 1, counter);
  const file = tree.find((n) => n.name === 'a.txt');
  assert.equal(file?.size, 5);
});

test('walkTree: omits size field for directories', async () => {
  await fs.mkdir(path.join(tmpRoot, 'sub'));
  const counter = { count: 0 };
  const tree = await walkTree(tmpRoot, tmpRoot, 1, counter);
  const dir = tree.find((n) => n.name === 'sub');
  assert.equal(dir?.size, undefined);
});

// ---- looksBinary ----
test('looksBinary: rejects pure text', () => {
  assert.equal(looksBinary(Buffer.from('hello world')), false);
});

test('looksBinary: detects NUL byte', () => {
  assert.equal(looksBinary(Buffer.from([0x68, 0x00, 0x69])), true);
});

test('looksBinary: only inspects first 1 KB', () => {
  // 第一个 1 KB 全文本，1 KB 之后有 NUL —— 应判 text
  const head = Buffer.alloc(1024, 'a');
  const tail = Buffer.from([0x00]);
  assert.equal(looksBinary(Buffer.concat([head, tail])), false);
});

// ---- readFileWithGuards ----
test('readFileWithGuards: reads small utf-8 file', async () => {
  const p = path.join(tmpRoot, 'a.txt');
  await fs.writeFile(p, 'hello');
  const result = await readFileWithGuards(p);
  assert.equal(result.content, 'hello');
  assert.equal(result.size, 5);
  assert.equal(result.isBinary, false);
  assert.equal(result.truncated, false);
  assert.equal(result.encoding, 'utf-8');
});

test('readFileWithGuards: marks binary file with empty content', async () => {
  const p = path.join(tmpRoot, 'bin.dat');
  await fs.writeFile(p, Buffer.from([0x00, 0x01, 0x02, 0x03]));
  const result = await readFileWithGuards(p);
  assert.equal(result.isBinary, true);
  assert.equal(result.content, '');
});

test('readFileWithGuards: rejects file > MAX_FILE_BYTES with truncated=true', async () => {
  const p = path.join(tmpRoot, 'huge.txt');
  // 写 5 MB + 1 byte 触发上限
  const huge = Buffer.alloc(5 * 1024 * 1024 + 1, 0x61);
  await fs.writeFile(p, huge);
  const result = await readFileWithGuards(p);
  assert.equal(result.truncated, true);
  assert.equal(result.content, '');
  assert.equal(result.size, 5 * 1024 * 1024 + 1);
});

test('readFileWithGuards: throws when target is a directory', async () => {
  const p = path.join(tmpRoot, 'd');
  await fs.mkdir(p);
  await assert.rejects(() => readFileWithGuards(p), /not a regular file/);
});

// ---- statPath ----
test('statPath: returns file metadata for existing files', async () => {
  const p = path.join(tmpRoot, 'a.txt');
  await fs.writeFile(p, 'hello');
  assert.deepEqual(await statPath(p), { exists: true, kind: 'file', size: 5 });
});

test('statPath: returns dir metadata for existing directories', async () => {
  const p = path.join(tmpRoot, 'd');
  await fs.mkdir(p);
  assert.deepEqual(await statPath(p), { exists: true, kind: 'dir' });
});

test('statPath: returns exists=false for missing paths', async () => {
  assert.deepEqual(await statPath(path.join(tmpRoot, 'missing.txt')), {
    exists: false,
    kind: null,
  });
});

// ---- diff cache ----
test('recordDiff / getDiff: stores and retrieves', () => {
  recordDiff('/p', 'a.ts', 'old', 'new');
  const got = getDiff('/p', 'a.ts');
  assert.deepEqual(got, { before: 'old', after: 'new' });
});

test('getDiff: returns null for unknown key', () => {
  assert.equal(getDiff('/p', 'never-set'), null);
});

test('recordDiff: overwrites previous entry for same key', () => {
  recordDiff('/p', 'a.ts', 'v1', 'v2');
  recordDiff('/p', 'a.ts', 'v3', 'v4');
  assert.deepEqual(getDiff('/p', 'a.ts'), { before: 'v3', after: 'v4' });
});

test('recordDiff: evicts oldest beyond LRU cap of 100', () => {
  for (let i = 0; i < 105; i++) {
    recordDiff('/p', `f${i}.ts`, '', `v${i}`);
  }
  // 头 5 个应该被挤出来
  assert.equal(getDiff('/p', 'f0.ts'), null);
  assert.equal(getDiff('/p', 'f4.ts'), null);
  // 之后的还在
  assert.deepEqual(getDiff('/p', 'f104.ts'), { before: '', after: 'v104' });
});

test('recordDiff: different projectRoot keys are isolated', () => {
  recordDiff('/p1', 'a.ts', 'r1', 'r1');
  recordDiff('/p2', 'a.ts', 'r2', 'r2');
  assert.equal(getDiff('/p1', 'a.ts')?.before, 'r1');
  assert.equal(getDiff('/p2', 'a.ts')?.before, 'r2');
});

test(
  'diff cache normalizes Windows namespace, separators, and path casing',
  { skip: process.platform !== 'win32' },
  () => {
    recordDiff('C:\\Project', 'Docs\\Spec.md', 'before', 'after');
    assert.deepEqual(getDiff('\\\\?\\c:\\project', 'docs/spec.md'), {
      before: 'before',
      after: 'after',
    });
  },
);

// ---- toPosixRelative ----
test('toPosixRelative: converts native separators to posix', () => {
  const native = path.join('/root', 'a', 'b', 'c.txt');
  const out = toPosixRelative(native, '/root');
  assert.equal(out, 'a/b/c.txt');
});

// ---- readFileBinaryWithGuards (F024 富预览) ----
test('readFileBinaryWithGuards: returns base64 + size for under-cap file', async () => {
  const p = path.join(tmpRoot, 'sample.bin');
  const raw = Buffer.from([0x01, 0x02, 0x03, 0xff, 0xfe]);
  await fs.writeFile(p, raw);
  const out = await readFileBinaryWithGuards(p, 1024);
  assert.equal(out.size, 5);
  assert.equal(out.truncated, false);
  assert.equal(Buffer.from(out.base64, 'base64').toString('hex'), '010203fffe');
});

test('readFileBinaryWithGuards rejects compressed Open XML bombs before renderer preview', async () => {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<Types/>');
  zip.file('word/document.xml', 'A'.repeat(10 * 1024 * 1024));
  const bytes = await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 9 },
  });
  const p = path.join(tmpRoot, 'compressed.docx');
  await fs.writeFile(p, bytes);

  await assert.rejects(
    () => readFileBinaryWithGuards(p, 10 * 1024 * 1024),
    /compression-ratio limit/,
  );
});

test('readFileBinaryWithGuards: truncated when over maxBytes', async () => {
  const p = path.join(tmpRoot, 'big.bin');
  await fs.writeFile(p, Buffer.alloc(2048, 0xab));
  const out = await readFileBinaryWithGuards(p, 1024);
  assert.equal(out.truncated, true);
  assert.equal(out.size, 2048);
  assert.equal(out.base64, '', 'truncated → empty base64 (no partial data exposure)');
});

test('readFileBinaryWithGuards: rejects directory', async () => {
  await assert.rejects(() => readFileBinaryWithGuards(tmpRoot, 1024), /not a regular file/);
});

test('readFileBinaryWithGuards: rejects missing file with ENOENT', async () => {
  await assert.rejects(() => readFileBinaryWithGuards(path.join(tmpRoot, 'nope.bin'), 1024));
});
