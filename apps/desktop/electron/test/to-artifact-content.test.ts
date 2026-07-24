// F059 — toArtifactContent mapping (pure, renderer util tested from the electron
// node:test suite, like chart-spec.test.ts). Type-only ArtifactContent import is
// erased at runtime, so no React/JSX is pulled in.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toArtifactContent } from '../../renderer/src/features/artifact/toArtifactContent.js';

test('content kinds map content through; missing content → null', () => {
  assert.deepEqual(toArtifactContent('markdown', { content: '# x' }, null), {
    kind: 'markdown',
    content: '# x',
  });
  assert.deepEqual(
    toArtifactContent(
      'markdown',
      { content: '# x', path: 'docs/readme.md', fileSource: 'workspace' },
      '/project',
    ),
    {
      kind: 'markdown',
      content: '# x',
      resourceContext: { projectRoot: '/project', path: 'docs/readme.md' },
    },
  );
  assert.deepEqual(toArtifactContent('code', { content: 'a=1' }, null), {
    kind: 'code',
    content: 'a=1',
  });
  assert.deepEqual(toArtifactContent('html', { content: '<b/>' }, null), {
    kind: 'html',
    content: '<b/>',
  });
  assert.deepEqual(toArtifactContent('interactive-html', { content: '<script></script>' }, null), {
    kind: 'interactive-html',
    content: '<script></script>',
  });
  assert.deepEqual(toArtifactContent('svg', { content: '<svg/>' }, null), {
    kind: 'svg',
    content: '<svg/>',
  });
  assert.equal(toArtifactContent('markdown', {}, null), null);
});

test('stored html is promoted from its actual content even when legacy metadata says static', () => {
  const content = `<html><body>${'x'.repeat(70_000)}<script>draw()</script></body></html>`;
  assert.deepEqual(toArtifactContent('html', { content }, null), {
    kind: 'interactive-html',
    content,
  });
});

test('stored html with remote display dependencies uses the isolated compatibility renderer', () => {
  const content = '<link rel="stylesheet" href="https://styles.example.com/presentation.css">';
  assert.deepEqual(toArtifactContent('html', { content }, null), {
    kind: 'interactive-html',
    content,
  });
});

test('html with permissions maps to interactive-html and carries the allow-list', () => {
  const permissions = { connect: ['https://api.example.com'] };
  const content = '<html><body>uses fetch later</body></html>';
  assert.deepEqual(toArtifactContent('html', { content }, null, permissions), {
    kind: 'interactive-html',
    content,
    permissions,
  });
});

test('image maps content → src', () => {
  assert.deepEqual(toArtifactContent('image', { content: 'data:image/png;base64,AAA' }, null), {
    kind: 'image',
    src: 'data:image/png;base64,AAA',
  });
});

test('chart parses JSON content into a spec object', () => {
  const spec = { type: 'line', xKey: 'n', data: [{ n: 'a', v: 1 }], series: [{ key: 'v' }] };
  const out = toArtifactContent('chart', { content: JSON.stringify(spec) }, null);
  assert.equal(out?.kind, 'chart');
  assert.deepEqual((out as { spec: unknown }).spec, spec);
});

test('chart with invalid JSON passes raw string (renderer validates → fallback)', () => {
  const out = toArtifactContent('chart', { content: 'not json' }, null);
  assert.equal(out?.kind, 'chart');
  assert.equal((out as { spec: unknown }).spec, 'not json');
});

test('path-backed kinds need path + projectRoot', () => {
  assert.deepEqual(toArtifactContent('pdf', { path: '/p/a.pdf' }, '/p'), {
    kind: 'pdf',
    projectRoot: '/p',
    path: '/p/a.pdf',
  });
  assert.deepEqual(toArtifactContent('docx', { path: '/p/a.docx' }, '/p'), {
    kind: 'docx',
    projectRoot: '/p',
    path: '/p/a.docx',
  });
  assert.deepEqual(toArtifactContent('xlsx', { path: '/p/a.xlsx' }, '/p'), {
    kind: 'xlsx',
    projectRoot: '/p',
    path: '/p/a.xlsx',
  });
  assert.deepEqual(toArtifactContent('pptx', { path: '/p/a.pptx' }, '/p'), {
    kind: 'pptx',
    projectRoot: '/p',
    path: '/p/a.pptx',
  });
  assert.deepEqual(toArtifactContent('file', { path: '/p/a.mp4' }, '/p'), {
    kind: 'file',
    projectRoot: '/p',
    path: '/p/a.mp4',
  });
  assert.equal(toArtifactContent('pdf', { path: '/p/a.pdf' }, null), null); // no projectRoot
  assert.equal(toArtifactContent('docx', {}, '/p'), null); // no path
  assert.equal(toArtifactContent('file', {}, '/p'), null); // no path
});

test('artifact-store generated files do not need projectRoot', () => {
  assert.deepEqual(
    toArtifactContent(
      'pptx',
      { path: 'Deck.pptx', fileSource: 'artifact-store' },
      null,
      undefined,
      { id: 'a1', version: 2 },
    ),
    {
      kind: 'pptx',
      path: 'Deck.pptx',
      fileSource: 'artifact-store',
      artifactId: 'a1',
      version: 2,
    },
  );
});

test('Partner delivery files can be previewed without resolving them under projectRoot', () => {
  assert.deepEqual(
    toArtifactContent(
      'file',
      {
        path: 'partner-output/report.md',
        fileSource: 'delivery-store',
        deliveryId: 'pd-report',
      },
      null,
    ),
    {
      kind: 'file',
      path: 'partner-output/report.md',
      fileSource: 'delivery-store',
      deliveryId: 'pd-report',
    },
  );
});

test('image with missing content → null', () => {
  assert.equal(toArtifactContent('image', {}, null), null);
});

test('react (gated interactive tier) is not rendered from the static store', () => {
  assert.equal(toArtifactContent('react', { content: 'export default()=>null' }, '/p'), null);
});
