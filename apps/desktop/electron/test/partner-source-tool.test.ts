import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import JSZip from 'jszip';
import { MAX_FILE_BYTES } from '@kodax-space/space-ipc-schema';
import { createOfficeArtifactBytes } from '../artifact/office-writers.js';
import {
  ensurePartnerSourceToolRegistered,
  makePartnerSourceReadHandler,
  PARTNER_SOURCE_READ_TOOL,
  _resetPartnerSourceToolRegistrationForTesting,
} from '../kodax/partner-source-tool.js';
import {
  runPartnerSourceExtractionWorker,
  runPartnerSourceStructuredExtractionWorker,
} from '../kodax/partner-source-extraction-runner.js';
import { PartnerSourceStore } from '../kodax/partner-source-store.js';
import { withSessionRunContext } from '../kodax/session-run-context.js';
import {
  _clearPartnerSpaceToolPoliciesForTesting,
  getPartnerSpaceToolPolicy,
  isPartnerToolAllowed,
} from '../kodax/partner-tools.js';

function harness() {
  const dir = mkdtempSync(join(tmpdir(), 'partner-source-tool-'));
  const root = join(dir, 'project');
  mkdirSync(root, { recursive: true });
  const store = new PartnerSourceStore(join(dir, 'partner-sources.json'));
  const handler = makePartnerSourceReadHandler({
    store,
    assertAllowedProjectRoot: async (projectRoot) => projectRoot,
  });
  return { dir, root, store, handler };
}

async function makeMinimalXlsx(sheetXml: string): Promise<Buffer> {
  const zip = new JSZip();
  zip.file(
    '[Content_Types].xml',
    [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">',
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
      '<Default Extension="xml" ContentType="application/xml"/>',
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>',
      '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>',
      '</Types>',
    ].join(''),
  );
  zip.file(
    '_rels/.rels',
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
  );
  zip.file(
    'xl/workbook.xml',
    '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Data" sheetId="1" r:id="rId1"/></sheets></workbook>',
  );
  zip.file(
    'xl/_rels/workbook.xml.rels',
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
  );
  zip.file('xl/worksheets/sheet1.xml', sheetXml);
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

test('partner_source_read reads an attached file in a Partner run context', async () => {
  const { dir, root, store, handler } = harness();
  try {
    writeFileSync(join(root, 'notes.md'), '# Notes\nsource truth');
    const source = await store.addWorkspacePath({
      sessionId: 's1',
      projectRoot: root,
      path: 'notes.md',
      targetKind: 'file',
    });
    const out = await withSessionRunContext(
      { sessionId: 's1', surface: 'partner', projectRoot: root },
      () => handler({ sourceId: source.id }),
    );
    assert.match(out, /Source: src_/);
    assert.match(out, /# Notes/);
    assert.match(out, /source truth/);
  } finally {
    store.invalidate();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('partner_source_read can use SDK tool execution context without ALS', async () => {
  const { dir, root, store, handler } = harness();
  try {
    writeFileSync(join(root, 'notes.md'), '# Notes\nsource truth');
    const source = await store.addWorkspacePath({
      sessionId: 's_sdk',
      projectRoot: root,
      path: 'notes.md',
      targetKind: 'file',
    });
    const out = await handler(
      { sourceId: source.id },
      {
        sessionId: 's_sdk',
        executionCwd: root,
        agentProfile: { surface: 'partner', id: 'kodax-space.partner' },
      },
    );
    assert.match(out, /# Notes/);
    assert.match(out, /source truth/);
  } finally {
    store.invalidate();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('partner_source_read extracts useful text from PDF, DOCX, XLSX, and PPTX sources', async () => {
  const { dir, root, store, handler } = harness();
  const fixtures = [
    await createOfficeArtifactBytes({
      kind: 'pdf',
      title: '\u4e2d\u6587\u7814\u7a76\u62a5\u544a',
      content: '\u7ade\u4e89\u5bf9\u624b\u5206\u6790\u4e0e\u7ed3\u8bba',
    }),
    await createOfficeArtifactBytes({
      kind: 'docx',
      title: '\u9879\u76ee\u5907\u5fd8\u5f55',
      content: '\u6587\u6863\u4e2d\u7684\u5173\u952e\u4e8b\u5b9e',
    }),
    await createOfficeArtifactBytes({
      kind: 'xlsx',
      title: '\u9884\u7b97\u6a21\u578b',
      workbook: {
        sheets: [
          {
            name: '\u9884\u7b97',
            rows: [
              ['\u9879\u76ee', '\u91d1\u989d'],
              ['\u7814\u53d1', 42],
            ],
          },
        ],
      },
    }),
    await createOfficeArtifactBytes({
      kind: 'pptx',
      title: '\u6218\u7565\u6c47\u62a5',
      presentation: {
        slides: [
          {
            title: '\u6267\u884c\u6458\u8981',
            bullets: ['\u589e\u957f\u76ee\u6807'],
            notes: '\u8bb2\u8005\u5907\u6ce8',
          },
        ],
      },
    }),
  ];

  try {
    for (const fixture of fixtures) {
      writeFileSync(join(root, fixture.filename), fixture.bytes);
      const source = await store.addWorkspacePath({
        sessionId: 's1',
        projectRoot: root,
        path: fixture.filename,
        targetKind: 'file',
      });
      const out = await withSessionRunContext(
        { sessionId: 's1', surface: 'partner', projectRoot: root },
        () => handler({ sourceId: source.id }),
      );
      assert.match(out, /Kind: file/);
      assert.match(out, /Extracted format: (PDF|DOCX|XLSX|PPTX)/);
      if (fixture.filename.endsWith('.pdf'))
        assert.match(out, /\u7ade\u4e89\u5bf9\u624b\u5206\u6790/);
      if (fixture.filename.endsWith('.docx'))
        assert.match(out, /\u6587\u6863\u4e2d\u7684\u5173\u952e\u4e8b\u5b9e/);
      if (fixture.filename.endsWith('.xlsx'))
        assert.match(out, /\u9884\u7b97[\s\S]*\u7814\u53d1[\s\S]*42/);
      if (fixture.filename.endsWith('.pptx'))
        assert.match(
          out,
          /\u6267\u884c\u6458\u8981[\s\S]*\u589e\u957f\u76ee\u6807[\s\S]*\u8bb2\u8005\u5907\u6ce8/,
        );
    }
  } finally {
    store.invalidate();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('partner source extraction bounds the worker response at 180k characters', async () => {
  const fixture = await createOfficeArtifactBytes({
    kind: 'docx',
    title: 'Output cap',
    content: 'A'.repeat(200_000),
  });
  const text = await runPartnerSourceExtractionWorker('DOCX', fixture.bytes);
  assert.equal(text.length, 180_000);
});

test('partner source extraction returns truthful structured locators for supported formats', async () => {
  const fixtures = [
    {
      format: 'PDF' as const,
      expectedKind: 'pdf_page',
      fixture: await createOfficeArtifactBytes({
        kind: 'pdf',
        title: 'PDF locator',
        content: 'page evidence',
      }),
    },
    {
      format: 'DOCX' as const,
      expectedKind: 'docx_paragraph',
      fixture: await createOfficeArtifactBytes({
        kind: 'docx',
        title: 'DOCX locator',
        content: 'paragraph evidence',
      }),
    },
    {
      format: 'XLSX' as const,
      expectedKind: 'xlsx_range',
      fixture: await createOfficeArtifactBytes({
        kind: 'xlsx',
        title: 'XLSX locator',
        workbook: {
          sheets: [
            {
              name: 'Facts',
              rows: [
                ['key', 'value'],
                ['answer', 42],
              ],
            },
          ],
        },
      }),
    },
    {
      format: 'PPTX' as const,
      expectedKind: 'pptx_slide',
      fixture: await createOfficeArtifactBytes({
        kind: 'pptx',
        title: 'PPTX locator',
        presentation: { slides: [{ title: 'Evidence slide', bullets: ['grounded fact'] }] },
      }),
    },
  ];

  for (const { format, expectedKind, fixture } of fixtures) {
    const result = await runPartnerSourceStructuredExtractionWorker(format, fixture.bytes);
    assert.ok(result.text.length > 0);
    assert.ok(result.units.length > 0);
    assert.equal(result.units[0]?.locator.kind, expectedKind);
    assert.equal(result.units[0]?.ordinal, 0);
  }
});

test('partner_source_read handles a sparse XLSX with a full-grid !ref without expanding it', async () => {
  const { dir, root, store, handler } = harness();
  try {
    const bytes = await makeMinimalXlsx(
      [
        '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">',
        '<dimension ref="A1:XFD1048576"/>',
        '<sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>bounded value</t></is></c></row></sheetData>',
        '</worksheet>',
      ].join(''),
    );
    writeFileSync(join(root, 'huge-ref.xlsx'), bytes);
    const source = await store.addWorkspacePath({
      sessionId: 's1',
      projectRoot: root,
      path: 'huge-ref.xlsx',
      targetKind: 'file',
    });

    const out = await withSessionRunContext(
      { sessionId: 's1', surface: 'partner', projectRoot: root },
      () => handler({ sourceId: source.id }),
    );
    assert.match(out, /Extracted format: XLSX/);
    assert.match(out, /A1=bounded value/);
  } finally {
    store.invalidate();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('partner_source_read rejects a high-density XLSX before XLSX.read object expansion', async () => {
  const { dir, root, store, handler } = harness();
  try {
    const cells = '<c r="A1"><v>1</v></c>'.repeat(100_001);
    const bytes = await makeMinimalXlsx(
      `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1">${cells}</row></sheetData></worksheet>`,
    );
    writeFileSync(join(root, 'dense.xlsx'), bytes);
    const source = await store.addWorkspacePath({
      sessionId: 's1',
      projectRoot: root,
      path: 'dense.xlsx',
      targetKind: 'file',
    });

    const out = await withSessionRunContext(
      { sessionId: 's1', surface: 'partner', projectRoot: root },
      () => handler({ sourceId: source.id }),
    );
    assert.match(out, /Unable to extract document text/);
    assert.match(out, /100000 cell limit/);
  } finally {
    store.invalidate();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('partner source extraction hard deadline terminates a CPU-bound worker', async () => {
  const hangingWorker = new URL(`data:text/javascript,${encodeURIComponent('while (true) {}')}`);
  const startedAt = Date.now();
  await assert.rejects(
    runPartnerSourceExtractionWorker('PDF', Buffer.from('%PDF-1.4'), {
      workerEntrypoint: hangingWorker,
      timeoutMs: 50,
    }),
    /exceeded its 50 ms hard deadline/,
  );
  assert.ok(Date.now() - startedAt < 2_000, 'deadline must not leave the worker running');
});

test('partner source extraction abort terminates a running worker', async () => {
  const hangingWorker = new URL(`data:text/javascript,${encodeURIComponent('while (true) {}')}`);
  const controller = new AbortController();
  const startedAt = Date.now();
  const extraction = runPartnerSourceExtractionWorker('PDF', Buffer.from('%PDF-1.7'), {
    workerEntrypoint: hangingWorker,
    timeoutMs: 10_000,
    signal: controller.signal,
  });
  controller.abort();
  await assert.rejects(extraction, /cancelled/i);
  assert.ok(Date.now() - startedAt < 2_000, 'abort must not leave the worker running');
});

test('partner source extraction reaps a crashed worker before rejecting', async () => {
  const crashingWorker = new URL(
    `data:text/javascript,${encodeURIComponent("throw new Error('synthetic worker crash')")}`,
  );
  await assert.rejects(
    runPartnerSourceExtractionWorker('PDF', Buffer.from('%PDF-1.4'), {
      workerEntrypoint: crashingWorker,
      timeoutMs: 1_000,
    }),
    /synthetic worker crash/,
  );
});

test('partner_source_read follows PPTX notes relationships instead of guessing file numbers', async () => {
  const { dir, root, store, handler } = harness();
  try {
    const zip = new JSZip();
    zip.file('[Content_Types].xml', '<Types/>');
    zip.file(
      'ppt/presentation.xml',
      '<p:presentation xmlns:p="p" xmlns:r="r"><p:sldIdLst><p:sldId r:id="rId1"/></p:sldIdLst></p:presentation>',
    );
    zip.file(
      'ppt/_rels/presentation.xml.rels',
      '<Relationships><Relationship Id="rId1" Type="x/slide" Target="slides/slide2.xml"/></Relationships>',
    );
    zip.file('ppt/slides/slide2.xml', '<p:sld><a:t>Relationship slide</a:t></p:sld>');
    zip.file(
      'ppt/slides/_rels/slide2.xml.rels',
      "<Relationships><Relationship Id='rId7' Type='x/notesSlide' Target='../notesSlides/notesSlide7.xml'/></Relationships>",
    );
    zip.file('ppt/notesSlides/notesSlide7.xml', '<p:notes><a:t>Relationship notes</a:t></p:notes>');
    zip.file(
      'ppt/notesSlides/notesSlide2.xml',
      '<p:notes><a:t>Wrong numbered notes</a:t></p:notes>',
    );
    const bytes = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
    writeFileSync(join(root, 'related-notes.pptx'), bytes);
    const source = await store.addWorkspacePath({
      sessionId: 's1',
      projectRoot: root,
      path: 'related-notes.pptx',
      targetKind: 'file',
    });

    const out = await withSessionRunContext(
      { sessionId: 's1', surface: 'partner', projectRoot: root },
      () => handler({ sourceId: source.id }),
    );
    assert.match(out, /Relationship slide/);
    assert.match(out, /Relationship notes/);
    assert.doesNotMatch(out, /Wrong numbered notes/);
  } finally {
    store.invalidate();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('partner_source_read scans many unclosed PPTX text tags without quadratic main-thread work', async () => {
  const { dir, root, store, handler } = harness();
  try {
    const zip = new JSZip();
    zip.file('[Content_Types].xml', '<Types/>');
    zip.file('ppt/presentation.xml', '<p:presentation/>');
    zip.file('ppt/slides/slide1.xml', `<p:sld>${'<a:t'.repeat(100_000)}</p:sld>`);
    const bytes = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
    writeFileSync(join(root, 'unclosed-tags.pptx'), bytes);
    const source = await store.addWorkspacePath({
      sessionId: 's1',
      projectRoot: root,
      path: 'unclosed-tags.pptx',
      targetKind: 'file',
    });

    const startedAt = Date.now();
    const out = await withSessionRunContext(
      { sessionId: 's1', surface: 'partner', projectRoot: root },
      () => handler({ sourceId: source.id }),
    );
    assert.match(out, /Extracted format: PPTX/);
    assert.ok(Date.now() - startedAt < 5_000, 'malformed tag scan must remain bounded');
  } finally {
    store.invalidate();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('partner_source_read keeps unknown binary files unavailable', async () => {
  const { dir, root, store, handler } = harness();
  try {
    // Deliberately contains no NUL byte: the generic NUL-only detector must not
    // mistake invalid UTF-8 binary data for readable source text.
    writeFileSync(join(root, 'blob.bin'), Buffer.from([0xff, 0xd8, 0xff, 0xe1, 0xfe, 0xfd]));
    const source = await store.addWorkspacePath({
      sessionId: 's1',
      projectRoot: root,
      path: 'blob.bin',
      targetKind: 'file',
    });
    const out = await withSessionRunContext(
      { sessionId: 's1', surface: 'partner', projectRoot: root },
      () => handler({ sourceId: source.id }),
    );
    assert.match(out, /Binary file; text content unavailable/);
  } finally {
    store.invalidate();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('partner_source_read rejects highly compressed Office ZIP payloads before extraction', async () => {
  const { dir, root, store, handler } = harness();
  try {
    const zip = new JSZip();
    zip.file('word/document.xml', 'A'.repeat(10 * 1024 * 1024));
    zip.file('[Content_Types].xml', '<Types/>');
    const bytes = await zip.generateAsync({
      type: 'nodebuffer',
      compression: 'DEFLATE',
      compressionOptions: { level: 9 },
    });
    writeFileSync(join(root, 'compressed.docx'), bytes);
    const source = await store.addWorkspacePath({
      sessionId: 's1',
      projectRoot: root,
      path: 'compressed.docx',
      targetKind: 'file',
    });
    const out = await withSessionRunContext(
      { sessionId: 's1', surface: 'partner', projectRoot: root },
      () => handler({ sourceId: source.id }),
    );
    assert.match(out, /Unable to extract document text/);
    assert.match(out, /compression-ratio limit/);
    assert.doesNotMatch(out, /A{100}/);
  } finally {
    store.invalidate();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('partner_source_read enforces the file-size guard before document parsing', async () => {
  const { dir, root, store, handler } = harness();
  try {
    writeFileSync(join(root, 'oversized.pdf'), Buffer.alloc(MAX_FILE_BYTES + 1, 0x20));
    const source = await store.addWorkspacePath({
      sessionId: 's1',
      projectRoot: root,
      path: 'oversized.pdf',
      targetKind: 'file',
    });
    const out = await withSessionRunContext(
      { sessionId: 's1', surface: 'partner', projectRoot: root },
      () => handler({ sourceId: source.id }),
    );
    assert.match(out, /File is too large to read inline/);
    assert.doesNotMatch(out, /Unable to extract document text/);
  } finally {
    store.invalidate();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('partner_source_read returns a bounded tree for directory sources', async () => {
  const { dir, root, store, handler } = harness();
  try {
    mkdirSync(join(root, 'docs'), { recursive: true });
    writeFileSync(join(root, 'docs', 'spec.md'), 'spec');
    const source = await store.addWorkspacePath({
      sessionId: 's1',
      projectRoot: root,
      path: 'docs',
      targetKind: 'dir',
    });
    const out = await withSessionRunContext(
      { sessionId: 's1', surface: 'partner', projectRoot: root },
      () => handler({ sourceId: source.id }),
    );
    assert.match(out, /Kind: directory/);
    assert.match(out, /docs\/spec.md/);
  } finally {
    store.invalidate();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('partner_source_read refuses calls outside Partner run context', async () => {
  const { dir, store, handler } = harness();
  try {
    assert.match(await handler({ sourceId: 'src_missing' }), /outside an active session run/);
    const out = await withSessionRunContext(
      { sessionId: 's1', surface: 'code', projectRoot: dir },
      () => handler({ sourceId: 'src_missing' }),
    );
    assert.match(out, /only available in Partner/);
  } finally {
    store.invalidate();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('ensurePartnerSourceToolRegistered registers once and publishes Partner policy', () => {
  _resetPartnerSourceToolRegistrationForTesting();
  _clearPartnerSpaceToolPoliciesForTesting();
  let calls = 0;
  const sdk = {
    registerTool: () => {
      calls++;
      return () => {};
    },
  };
  ensurePartnerSourceToolRegistered(sdk);
  ensurePartnerSourceToolRegistered(sdk);
  assert.equal(calls, 1);
  assert.equal(getPartnerSpaceToolPolicy('partner_source_read')?.scope, 'source');
  assert.equal(
    isPartnerToolAllowed('partner_source_read', 'subagent', { sideEffect: 'readonly' }),
    true,
  );
  _clearPartnerSpaceToolPoliciesForTesting();
});

test('PARTNER_SOURCE_READ_TOOL shape is readonly and sourceId-based', () => {
  assert.equal(PARTNER_SOURCE_READ_TOOL.name, 'partner_source_read');
  assert.equal(PARTNER_SOURCE_READ_TOOL.sideEffect, 'readonly');
  assert.deepEqual(PARTNER_SOURCE_READ_TOOL.input_schema.required, ['sourceId']);
});
