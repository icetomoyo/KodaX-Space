// F024 — pure utility tests for rich preview helpers.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  detectKind,
  formatBytes,
  PREVIEW_SIZE_CAPS,
} from '../../renderer/src/features/preview/binaryUtils.js';
import { textFilePresentation } from '../../renderer/src/features/preview/previewPresentation.js';
import { resolveMarkdownWorkspacePath } from '../../renderer/src/features/artifact/renderers/markdownResources.js';

test('detectKind: pdf extension (lowercase)', () => {
  assert.equal(detectKind('docs/spec.pdf'), 'pdf');
});

test('detectKind: pdf extension (uppercase)', () => {
  assert.equal(detectKind('Reports/Q3.PDF'), 'pdf');
});

test('detectKind: docx extension', () => {
  assert.equal(detectKind('notes/draft.docx'), 'docx');
});

test('detectKind: xlsx and xls both map to xlsx', () => {
  assert.equal(detectKind('finance/budget.xlsx'), 'xlsx');
  assert.equal(detectKind('finance/old.xls'), 'xlsx');
});

test('detectKind: legacy ppt does not claim the Open XML pptx viewer', () => {
  assert.equal(detectKind('slides/legacy.ppt'), null);
  assert.equal(detectKind('slides/current.pptx'), 'pptx');
});

test('detectKind: plain text falls through to null', () => {
  assert.equal(detectKind('src/main.ts'), null);
  assert.equal(detectKind('README.md'), null);
  assert.equal(detectKind('data.json'), null);
});

test('detectKind: log and config text files map to text preview', () => {
  assert.equal(detectKind('logs/server.LOG'), 'text');
  assert.equal(detectKind('config/app.ini'), 'text');
  assert.equal(detectKind('exports/table.tsv'), 'text');
});

test('textFilePresentation: Markdown uses document preview while other text remains source', () => {
  assert.equal(textFilePresentation('partner-output/report.md'), 'markdown');
  assert.equal(textFilePresentation('docs/RELEASE.NOTES.MARKDOWN'), 'markdown');
  assert.equal(textFilePresentation(' README.md '), 'markdown');
  assert.equal(textFilePresentation('docs/component.mdx'), 'source');
  assert.equal(textFilePresentation('src/main.ts'), 'source');
  assert.equal(textFilePresentation('notes.txt'), 'source');
});

test('resolveMarkdownWorkspacePath: resolves document-relative and project-root resources', () => {
  assert.equal(
    resolveMarkdownWorkspacePath('docs/guides/start.md', '../assets/flow%20chart.png'),
    'docs/assets/flow chart.png',
  );
  assert.equal(
    resolveMarkdownWorkspacePath('docs/guides/start.md', '/assets/logo.svg#dark'),
    'assets/logo.svg',
  );
  assert.equal(
    resolveMarkdownWorkspacePath('docs/guides/start.md', './next.md?view=preview#section'),
    'docs/guides/next.md',
  );
  assert.equal(
    resolveMarkdownWorkspacePath('docs/guides/start.md', '.\\assets\\preview.png'),
    'docs/guides/assets/preview.png',
  );
});

test('resolveMarkdownWorkspacePath: rejects remote, active, anchor, and escaping URLs', () => {
  assert.equal(resolveMarkdownWorkspacePath('README.md', 'https://example.test/image.png'), null);
  assert.equal(resolveMarkdownWorkspacePath('README.md', 'javascript:alert(1)'), null);
  assert.equal(resolveMarkdownWorkspacePath('README.md', '#section'), null);
  assert.equal(resolveMarkdownWorkspacePath('README.md', '../outside.png'), null);
  assert.equal(resolveMarkdownWorkspacePath('README.md', '\\\\server\\share\\image.png'), null);
  assert.equal(resolveMarkdownWorkspacePath('../README.md', './image.png'), null);
  assert.equal(resolveMarkdownWorkspacePath('C:\\project\\README.md', './image.png'), null);
  assert.equal(resolveMarkdownWorkspacePath('README.md', '%E0%A4%A'), null);
});

test('detectKind: extensions only matched at end', () => {
  // 'pdf' anywhere else in the name should NOT match
  assert.equal(detectKind('pdfgen/template.html'), null);
  assert.equal(detectKind('docx-tools/cli.js'), null);
});

test('formatBytes: under 1 KB', () => {
  assert.equal(formatBytes(500), '500 B');
  assert.equal(formatBytes(0), '0 B');
});

test('formatBytes: KB range', () => {
  assert.equal(formatBytes(1024), '1.0 KB');
  assert.equal(formatBytes(2560), '2.5 KB');
});

test('formatBytes: MB range', () => {
  assert.equal(formatBytes(1024 * 1024), '1.0 MB');
  assert.equal(formatBytes(5 * 1024 * 1024 + 512 * 1024), '5.5 MB');
});

test('PREVIEW_SIZE_CAPS: PDF cap is 50 MB', () => {
  assert.equal(PREVIEW_SIZE_CAPS.pdf, 50 * 1024 * 1024);
});

test('PREVIEW_SIZE_CAPS: docx + xlsx capped at 10 MB', () => {
  assert.equal(PREVIEW_SIZE_CAPS.docx, 10 * 1024 * 1024);
  assert.equal(PREVIEW_SIZE_CAPS.xlsx, 10 * 1024 * 1024);
});
