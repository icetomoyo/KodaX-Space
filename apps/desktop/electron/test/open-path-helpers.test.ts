import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  extOf,
  isCodePath,
  isPreviewablePath,
  looksLikeFilePath,
  toProjectRelative,
} from '../../renderer/src/lib/pathClassify.js';

test('extOf: returns lowercase extension, or empty string when absent', () => {
  assert.equal(extOf('src/index.html'), 'html');
  assert.equal(extOf('C:\\proj\\App.TSX'), 'tsx');
  assert.equal(extOf('Makefile'), '');
  assert.equal(extOf('.gitignore'), '');
  assert.equal(extOf('a/b/c'), '');
  assert.equal(extOf('archive.tar.gz'), 'gz');
});

test('isPreviewablePath: known renderable files can open in Artifact', () => {
  for (const p of [
    'x.html',
    'x.htm',
    'logo.svg',
    'README.md',
    'notes.markdown',
    'app.ts',
    'config.ini',
    'server.log',
    'data.json',
    'photo.png',
    'doc.pdf',
    'deck.pptx',
    'clip.mp4',
  ]) {
    assert.equal(isPreviewablePath(p), true, p);
  }
  for (const p of ['archive.zip', 'noext']) {
    assert.equal(isPreviewablePath(p), false, p);
  }
});

test('isCodePath: text/code files are still explicit Diff candidates', () => {
  for (const p of ['app.ts', 'main.go', 'styles.css', 'data.json', 'server.log', 'Dockerfile', '.gitignore']) {
    assert.equal(isCodePath(p), true, p);
  }
  for (const p of ['index.html', 'logo.svg', 'README.md', 'photo.png', 'doc.pdf']) {
    assert.equal(isCodePath(p), false, p);
  }
});

test('looksLikeFilePath: conservative path auto-linking', () => {
  for (const s of ['src/index.html', 'app.tsx', 'C:\\x\\y.html', './a/b.css', 'package.json']) {
    assert.equal(looksLikeFilePath(s), true, s);
  }
  for (const s of [
    'e.g',
    'a.b',
    'npm run dev',
    'https://x.com/a.html',
    '',
    'just text',
    'arr[0].length',
  ]) {
    assert.equal(looksLikeFilePath(s), false, s);
  }
});

test('looksLikeFilePath: rejects traversal and dotenv secrets for auto-linking', () => {
  for (const s of ['../secrets/config.json', 'src/../package.json', '.env', 'config/.env.local']) {
    assert.equal(looksLikeFilePath(s), false, s);
  }
  assert.equal(looksLikeFilePath('.env.example'), false);
});

test('toProjectRelative: strips projectRoot prefix and normalizes separators', () => {
  assert.equal(toProjectRelative('C:\\proj\\src\\index.html', 'C:\\proj'), 'src/index.html');
  assert.equal(toProjectRelative('C:/Proj/src/a.ts', 'c:/proj'), 'src/a.ts');
  assert.equal(toProjectRelative('/home/u/proj/src/a.ts', '/home/u/proj'), 'src/a.ts');
  assert.equal(toProjectRelative('src/a.ts', '/home/u/proj'), 'src/a.ts');
  assert.equal(toProjectRelative('/src/a.ts', null), 'src/a.ts');
  assert.equal(toProjectRelative('/etc/passwd', '/home/u/proj'), 'etc/passwd');
  assert.equal(toProjectRelative('/p/x.md', '/p/'), 'x.md');
});
