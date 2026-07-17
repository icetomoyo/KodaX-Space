import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  deliveryPathMatches,
  extOf,
  isCodePath,
  isPreviewablePath,
  isTextPreviewPath,
  looksLikeFilePath,
  toProjectRelative,
} from '../../renderer/src/lib/pathClassify.js';
import {
  formatPartnerDeliveryUri,
  isPartnerOutputLogicalPath,
  parsePartnerDeliveryUri,
} from '@kodax-space/space-ipc-schema';

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
  for (const p of [
    'app.ts',
    'main.go',
    'styles.css',
    'data.json',
    'server.log',
    'Dockerfile',
    '.gitignore',
  ]) {
    assert.equal(isCodePath(p), true, p);
  }
  for (const p of ['index.html', 'logo.svg', 'README.md', 'photo.png', 'doc.pdf']) {
    assert.equal(isCodePath(p), false, p);
  }
});

test('isTextPreviewPath: Delivery text preview reuses the full source classifier', () => {
  for (const p of [
    'Cargo.toml',
    '.env',
    '.env.local',
    'component.vue',
    'main.c',
    'worker.cpp',
    'README.md',
    'index.html',
    'Makefile',
  ]) {
    assert.equal(isTextPreviewPath(p), true, p);
  }
  for (const p of ['photo.png', 'document.pdf', 'archive.zip']) {
    assert.equal(isTextPreviewPath(p), false, p);
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

test('deliveryPathMatches resolves Partner output aliases and absolute paths', () => {
  const delivery = {
    relativePath: 'partner-output/huashu-design-report.md',
    absolutePath: 'C:\\Space\\runs\\session-1\\partner-output\\huashu-design-report.md',
  };
  assert.equal(deliveryPathMatches(delivery, 'partner-output/huashu-design-report.md'), true);
  assert.equal(deliveryPathMatches(delivery, 'huashu-design-report.md'), true);
  assert.equal(
    deliveryPathMatches(delivery, 'c:/space/runs/session-1/partner-output/huashu-design-report.md'),
    true,
  );
  assert.equal(deliveryPathMatches(delivery, './partner-output/other.md'), false);
});

test('Partner Delivery URI is stable and the logical output namespace is explicit', () => {
  const uri = formatPartnerDeliveryUri('pd_1234');
  assert.equal(uri, 'kodax-space://partner-delivery/pd_1234');
  assert.equal(parsePartnerDeliveryUri(uri), 'pd_1234');
  assert.equal(parsePartnerDeliveryUri(`${uri}/extra`), null);
  assert.equal(parsePartnerDeliveryUri('https://example.com/pd_1234'), null);
  assert.equal(isPartnerOutputLogicalPath('partner-output/report.md'), true);
  assert.equal(isPartnerOutputLogicalPath('.\\PARTNER-OUTPUT\\report.md'), true);
  assert.equal(isPartnerOutputLogicalPath('src/partner-output/report.md'), false);
});
