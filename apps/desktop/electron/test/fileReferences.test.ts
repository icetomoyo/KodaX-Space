import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  collectAbsoluteAttachmentPaths,
  compactPathForDisplay,
  fileUrlToPath,
  parseFileReferences,
} from '../../renderer/src/lib/fileReferences.js';

test('fileUrlToPath decodes darwin file URLs', () => {
  const path = fileUrlToPath(
    'file:///Volumes/TING/Work/1.%20%E6%B5%8B%E8%AF%95/3.2%20call.m4a',
    'darwin',
  );
  assert.equal(path, '/Volumes/TING/Work/1. \u6d4b\u8bd5/3.2 call.m4a');
});

test('fileUrlToPath decodes Windows drive file URLs', () => {
  const path = fileUrlToPath('file:///C:/Users/iceto/Desktop/demo%20file.txt', 'win32');
  assert.equal(path, 'C:\\Users\\iceto\\Desktop\\demo file.txt');
});

test('parseFileReferences turns markdown file links into compact file parts', () => {
  const content =
    'please inspect [demo file.txt]\n(<file:///C:/Users/iceto/Desktop/demo%20file.txt>) today';
  const parts = parseFileReferences(content, 'win32');
  assert.equal(parts.length, 3);
  assert.deepEqual(parts[0], { kind: 'text', text: 'please inspect ' });
  assert.equal(parts[1]?.kind, 'file');
  if (parts[1]?.kind === 'file') {
    assert.equal(parts[1].label, 'demo file.txt');
    assert.equal(parts[1].path, 'C:\\Users\\iceto\\Desktop\\demo file.txt');
    assert.match(parts[1].detail, /demo file\.txt$/);
  }
  assert.deepEqual(parts[2], { kind: 'text', text: ' today' });
});

test('compactPathForDisplay keeps the filename visible', () => {
  const compact = compactPathForDisplay(
    '/Volumes/TING/Work/1. very long folder name/51. another long folder/3.2 call.m4a',
    42,
  );
  assert.match(compact, /3\.2 call\.m4a$/);
  assert.ok(compact.length <= 42);
});

test('attachment context receives the native Windows path instead of the renderer file URL', () => {
  const reference =
    '[KodaX Fabric \u4ea7\u54c1\u8bbe\u8ba1.md](<file:///D:/BaiduNetdiskSync/MyNote/KodaX%20Fabric/KodaX%20Fabric%20%E4%BA%A7%E5%93%81%E8%AE%BE%E8%AE%A1.md>)';
  const nativePath =
    'D:\\BaiduNetdiskSync\\MyNote\\KodaX Fabric\\KodaX Fabric \u4ea7\u54c1\u8bbe\u8ba1.md';
  const paths = collectAbsoluteAttachmentPaths(
    `Please inspect this document.\n\n${reference}`,
    [{ kind: 'file', path: nativePath }],
    'win32',
  );

  assert.deepEqual(paths, [{ kind: 'file', path: nativePath }]);
});

test('model prompt preserves Windows UNC, macOS, and Linux absolute path conventions', () => {
  const cases = [
    { platform: 'win32', path: '\\\\server\\share\\folder name\\report.md' },
    { platform: 'darwin', path: '/Users/alice/Library/Mobile Documents/report.md' },
    { platform: 'linux', path: '/home/alice/project notes/report.md' },
  ] as const;

  for (const item of cases) {
    const paths = collectAbsoluteAttachmentPaths(
      `attachment:${item.platform}`,
      [{ kind: 'file', path: item.path }],
      item.platform,
    );
    assert.deepEqual(paths, [{ kind: 'file', path: item.path }]);
  }
});

test('restored file-link prompts recover native paths after pending attachment state is gone', () => {
  const paths = collectAbsoluteAttachmentPaths(
    'Retry [demo file.txt](<file:///C:/Users/iceto/Desktop/demo%20file.txt>)',
    [],
    'win32',
  );

  assert.deepEqual(paths, [{ kind: 'file', path: 'C:\\Users\\iceto\\Desktop\\demo file.txt' }]);
});
