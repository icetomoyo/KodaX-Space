// artifact.previewFile support logic:
//   - extension/content sniffing maps files to renderable artifact kinds
//   - markdown-local image inlining stays inside the project realpath boundary
// The IPC handler itself is registered through Electron, so these tests cover
// the pure helpers that protect its behavior.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import JSZip from 'jszip';
import {
  guardArtifactBinaryPreview,
  inlineMarkdownImageAssets,
  previewKindForContent,
  previewKindForPath,
} from '../ipc/artifact.js';

test('generated Office artifact preview rejects ZIP bombs before renderer parsing', async () => {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<Types/>');
  zip.file('word/document.xml', 'A'.repeat(10 * 1024 * 1024));
  const bytes = await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 9 },
  });

  await assert.rejects(
    () => guardArtifactBinaryPreview('docx', 'misleading.txt', bytes, false),
    /compression-ratio limit/,
  );
  await assert.doesNotReject(() =>
    guardArtifactBinaryPreview('docx', 'misleading.txt', bytes.subarray(0, 16), true),
  );
});

test('generated Office artifact preview rejects aggregate ZIP-ratio bypasses', async () => {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<Types/>');
  zip.file('ppt/presentation.xml', '<p:presentation/>');
  for (let index = 1; index <= 9; index += 1) {
    zip.file(`ppt/slides/slide${index}.xml`, 'A'.repeat(1024 * 1024));
  }
  const bytes = await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 9 },
  });

  await assert.rejects(
    () => guardArtifactBinaryPreview('pptx', 'deck.pptx', bytes, false),
    /aggregate .*compression-ratio limit/,
  );
});

test('previewKindForPath: known preview extensions → corresponding artifact kind', () => {
  assert.equal(previewKindForPath('a/index.html'), 'html');
  assert.equal(previewKindForPath('a/page.htm'), 'html');
  assert.equal(previewKindForPath('logo.svg'), 'svg');
  assert.equal(previewKindForPath('README.md'), 'markdown');
  assert.equal(previewKindForPath('notes.markdown'), 'markdown');
  assert.equal(previewKindForPath('photo.png'), 'file');
  assert.equal(previewKindForPath('photo.JPG'), 'file');
  assert.equal(previewKindForPath('clip.gif'), 'file');
  assert.equal(previewKindForPath('movie.mp4'), 'file');
  assert.equal(previewKindForPath('deck.pptx'), 'pptx');
  assert.equal(previewKindForPath('server.log'), 'file');
  assert.equal(previewKindForPath('config.ini'), 'file');
  assert.equal(previewKindForPath('report.pdf'), 'pdf');
  assert.equal(previewKindForPath('brief.docx'), 'docx');
  assert.equal(previewKindForPath('sheet.xlsx'), 'xlsx');
  assert.equal(previewKindForPath('legacy.xls'), 'xlsx');
  assert.equal(previewKindForPath('app.ts'), 'code');
  assert.equal(previewKindForPath('data.json'), 'code');
  assert.equal(previewKindForPath('Makefile'), 'code');
  assert.equal(previewKindForPath('STYLE.CSS'), 'code'); // 大小写不敏感
});

test('previewKindForContent promotes script-driven html to interactive-html', () => {
  assert.equal(previewKindForContent('a/index.html', '<h1>static</h1>'), 'html');
  assert.equal(
    previewKindForContent(
      'a/index.html',
      '<canvas></canvas><script>requestAnimationFrame(() => {})</script>',
    ),
    'interactive-html',
  );
  assert.equal(previewKindForContent('app.ts', '<script>not html path</script>'), 'code');
});

test('inlineMarkdownImageAssets inlines local images but blocks symlink escapes', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'markdown-inline-'));
  try {
    const project = join(dir, 'project');
    const assets = join(project, 'assets');
    const outside = join(dir, 'outside');
    mkdirSync(assets, { recursive: true });
    mkdirSync(outside, { recursive: true });
    const markdownPath = join(project, 'README.md');
    const insideImage = join(assets, 'logo.png');
    const outsideImage = join(outside, 'leak.png');
    writeFileSync(markdownPath, '![logo](assets/logo.png)');
    writeFileSync(insideImage, Buffer.from('inside'));
    writeFileSync(outsideImage, Buffer.from('outside'));

    const local = await inlineMarkdownImageAssets(
      '![logo](assets/logo.png)',
      await fs.realpath(markdownPath),
      project,
    );
    assert.match(local, /^!\[logo\]\(data:image\/png;base64,/);

    try {
      symlinkSync(
        outside,
        join(project, 'linked-outside'),
        process.platform === 'win32' ? 'junction' : 'dir',
      );
    } catch (err) {
      t.skip(`symlink unavailable: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }

    const escaped = '![leak](linked-outside/leak.png)';
    assert.equal(
      await inlineMarkdownImageAssets(escaped, await fs.realpath(markdownPath), project),
      escaped,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
