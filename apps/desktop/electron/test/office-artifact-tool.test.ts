import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import JSZip from 'jszip';
import * as XLSX from 'xlsx';
import { ArtifactStore } from '../artifact/store.js';
import { withArtifactContext } from '../artifact/run-context.js';
import {
  createOfficeArtifactBytes,
  normalizeSafeWorksheetFormula,
} from '../artifact/office-writers.js';
import {
  CREATE_OFFICE_ARTIFACT_TOOL,
  _resetOfficeArtifactRegistrationForTesting,
  ensureOfficeArtifactToolRegistered,
  makeCreateOfficeArtifactHandler,
} from '../artifact/office-artifact-tool.js';
import {
  _clearPartnerSpaceToolPoliciesForTesting,
  getPartnerSpaceToolPolicy,
  isPartnerToolAllowed,
} from '../kodax/partner-tools.js';
import { guardArtifactBinaryPreview } from '../ipc/artifact.js';

function freshStore(): { store: ArtifactStore; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), 'office-artifact-tool-'));
  return { store: new ArtifactStore(join(dir, 'artifacts.json'), dir), dir };
}

const CTX = { sessionId: 's1', surface: 'partner' as const, projectRoot: '/proj' };

test('office writers create docx, xlsx, pptx, and pdf bytes', async () => {
  const docx = await createOfficeArtifactBytes({
    kind: 'docx',
    title: 'Research Memo',
    sourceRefs: [{ label: 'Primary brief', uri: 'workspace://brief.md', note: 'User supplied' }],
    document: {
      blocks: [
        { type: 'heading', level: 1, text: 'Findings' },
        { type: 'paragraph', text: 'The document writer preserves headings.' },
        { type: 'bullets', items: ['Evidence one', 'Evidence two'] },
      ],
    },
  });
  const docxZip = await JSZip.loadAsync(docx.bytes);
  const documentXml = await docxZip.file('word/document.xml')!.async('string');
  assert.match(documentXml, /Heading1/);
  assert.match(documentXml, /Research Memo/);
  assert.match(documentXml, /Primary brief/);
  assert.match(documentXml, /workspace:\/\/brief.md/);
  assert.match(documentXml, /w:numPr/);
  assert.ok(docxZip.file('word/numbering.xml'));
  const documentRelationships = await docxZip.file('word/_rels/document.xml.rels')!.async('string');
  assert.match(documentRelationships, /relationships\/styles/);
  assert.match(documentRelationships, /Target="styles\.xml"/);
  assert.match(
    await docxZip.file('word/styles.xml')!.async('string'),
    /w:style w:type="paragraph" w:default="1" w:styleId="Normal"/,
  );

  const xlsx = await createOfficeArtifactBytes({
    kind: 'xlsx',
    title: 'Budget',
    workbook: {
      sheets: [
        {
          name: 'Budget',
          rows: [
            ['A', 'B', 'Total'],
            [2, 3, null],
          ],
          formulas: [{ cell: 'C2', formula: '=SUM(A2:B2)' }],
        },
      ],
    },
    citations: [{ label: 'Budget policy', uri: 'https://example.test/budget' }],
  });
  const workbook = XLSX.read(xlsx.bytes, { type: 'buffer' });
  assert.deepEqual(workbook.SheetNames, ['Budget', 'Sources']);
  assert.equal(workbook.Sheets.Budget?.C2?.f, 'SUM(A2:B2)');
  assert.equal(workbook.Sheets.Sources?.A2?.v, 'Budget policy');
  assert.equal(workbook.Sheets.Sources?.B2?.v, 'https://example.test/budget');
  const budgetXml = await (await JSZip.loadAsync(xlsx.bytes))
    .file('xl/worksheets/sheet1.xml')!
    .async('string');
  assert.match(budgetXml, /<autoFilter /);
  assert.match(budgetXml, /<cols>/);

  const pptx = await createOfficeArtifactBytes({
    kind: 'pptx',
    title: 'Briefing',
    presentation: {
      slides: [{ title: 'Executive Summary', bullets: ['One', 'Two'], notes: 'Speaker note' }],
    },
    sourceRefs: [{ label: 'Interview notes', uri: 'workspace://interview.md' }],
  });
  const pptxZip = await JSZip.loadAsync(pptx.bytes);
  const firstSlideXml = await pptxZip.file('ppt/slides/slide1.xml')!.async('string');
  assert.match(firstSlideXml, /Executive Summary/);
  assert.match(firstSlideXml, /accent bar/i);
  assert.match(firstSlideXml, /<a:buChar char="•"/);
  assert.match(
    await pptxZip.file('ppt/notesSlides/notesSlide1.xml')!.async('string'),
    /Speaker note/,
  );
  assert.match(
    await pptxZip.file('ppt/notesSlides/notesSlide1.xml')!.async('string'),
    /<p:ph type="body"/,
  );
  assert.match(await pptxZip.file('ppt/slides/slide2.xml')!.async('string'), /Interview notes/);

  const pdf = await createOfficeArtifactBytes({
    kind: 'pdf',
    title: '\u4e2d\u6587 PDF \u62a5\u544a',
    content:
      '# \u6458\u8981\n\n\u8fd9\u662f\u4e2d\u6587\u6b63\u6587\uff0cUnicode \u4e0d\u5e94\u88ab\u66ff\u6362\u3002',
  });
  assert.equal(pdf.bytes.subarray(0, 5).toString('ascii'), '%PDF-');
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const pdfDocument = await pdfjs.getDocument({
    data: new Uint8Array(pdf.bytes),
    disableFontFace: true,
    isEvalSupported: false,
  }).promise;
  const firstPage = await pdfDocument.getPage(1);
  const textContent = await firstPage.getTextContent();
  const extractedText = textContent.items.map((item) => ('str' in item ? item.str : '')).join(' ');
  assert.match(extractedText, /\u4e2d\u6587 PDF \u62a5\u544a/);
  assert.match(extractedText, /\u8fd9\u662f\u4e2d\u6587\u6b63\u6587/);
  assert.doesNotMatch(extractedText, /\?{2,}/);
  await pdfDocument.destroy();
});

test('create_office_artifact handler writes generated file artifacts', async () => {
  const { store, dir } = freshStore();
  const changes: Array<{ id: string; sessionId: string; reason: string }> = [];
  const handler = makeCreateOfficeArtifactHandler({ store, notifyChanged: (p) => changes.push(p) });
  try {
    const out = await withArtifactContext(CTX, () =>
      handler({
        kind: 'xlsx',
        title: 'Budget',
        workbook: {
          sheets: [
            {
              name: 'Budget',
              rows: [
                ['A', 'B'],
                [1, 2],
              ],
            },
          ],
        },
      }),
    );
    assert.match(out, /Office artifact created/);
    const artifact = (await store.list())[0]!;
    assert.equal(artifact.kind, 'xlsx');
    assert.equal(artifact.versions[0]?.fileSource, 'artifact-store');
    assert.equal(changes[0]?.reason, 'created');
    const binary = await store.readGeneratedFile(artifact.id, undefined, 1024 * 1024);
    assert.ok(binary?.bytes.length);
  } finally {
    store.invalidate();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('PDF writer refuses unsupported glyphs instead of emitting visually corrupt text', async () => {
  await assert.rejects(
    () =>
      createOfficeArtifactBytes({
        kind: 'pdf',
        title: 'Unsupported glyph',
        content: `No installed text font should map this noncharacter: ${String.fromCodePoint(0x10ffff)}`,
      }),
    /without missing glyphs|covers every requested character/,
  );
});
test('PDF writer wraps long unspaced CJK text instead of overflowing one line', async () => {
  const pdf = await createOfficeArtifactBytes({
    kind: 'pdf',
    title: '\u4e2d\u6587\u957f\u6587',
    content: '\u4e2d\u6587'.repeat(1_200),
  });
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const document = await pdfjs.getDocument({
    data: new Uint8Array(pdf.bytes),
    disableFontFace: true,
    isEvalSupported: false,
  }).promise;
  try {
    assert.ok(document.numPages >= 2);
  } finally {
    await document.destroy();
  }
});

test('maximum inline DOCX content remains self-compatible with Office preview guards', async () => {
  const result = await createOfficeArtifactBytes({
    kind: 'docx',
    title: 'Highly repetitive but bounded',
    content: 'A'.repeat(262_144),
  });
  await assert.doesNotReject(() =>
    guardArtifactBinaryPreview('docx', result.filename, result.bytes, false),
  );
});

test('Office writers reject XML 1.0-invalid controls and isolated surrogates', async () => {
  await assert.rejects(
    () =>
      createOfficeArtifactBytes({
        kind: 'docx',
        title: 'Invalid control',
        content: 'before\u0000after',
      }),
    /XML 1\.0-invalid character U\+0000/,
  );
  await assert.rejects(
    () =>
      createOfficeArtifactBytes({
        kind: 'pptx',
        title: 'Invalid surrogate',
        presentation: { slides: [{ title: 'Slide', notes: `bad${String.fromCharCode(0xd800)}` }] },
      }),
    /XML 1\.0-invalid character U\+D800/,
  );
  await assert.rejects(
    () =>
      createOfficeArtifactBytes({
        kind: 'xlsx',
        title: 'Invalid cell',
        workbook: { sheets: [{ name: 'Sheet', rows: [['bad\u0001']] }] },
      }),
    /XML 1\.0-invalid character U\+0001/,
  );
});

test('XLSX writer de-duplicates sanitized sheet names and preserves out-of-range formulas', async () => {
  const result = await createOfficeArtifactBytes({
    kind: 'xlsx',
    title: 'Collision workbook',
    workbook: {
      sheets: [
        { name: 'A:B', rows: [['Header']], formulas: [{ cell: 'Z10', formula: '=1+1' }] },
        { name: 'A/B', rows: [['Other']] },
      ],
    },
  });
  const workbook = XLSX.read(result.bytes, { type: 'buffer', cellFormula: true });
  assert.deepEqual(workbook.SheetNames, ['A B', 'A B (2)']);
  assert.equal(workbook.Sheets['A B']?.Z10?.f, '1+1');

  await assert.rejects(
    () =>
      createOfficeArtifactBytes({
        kind: 'xlsx',
        title: 'Invalid cell',
        workbook: {
          sheets: [
            {
              name: 'Sheet',
              rows: [['Header']],
              formulas: [{ cell: 'XFE1', formula: '=1' }],
            },
          ],
        },
      }),
    /outside the worksheet grid/,
  );
});

test('XLSX writer permits local formulas and rejects external, DDE, and network formulas', async () => {
  assert.equal(
    normalizeSafeWorksheetFormula("=SUM('Budget (2026)'!A1:B2)"),
    "SUM('Budget (2026)'!A1:B2)",
  );

  const unsafe = [
    '=WEBSERVICE("https://example.test/collect")',
    '=HYPERLINK("https://example.test/collect","open")',
    "=cmd|' /C calc'!A0",
    "='[external.xlsx]Sheet1'!A1",
    '=RTD("server",,"topic")',
    '=INDIRECT("A1")',
  ];
  for (const formula of unsafe) {
    await assert.rejects(
      () =>
        createOfficeArtifactBytes({
          kind: 'xlsx',
          title: 'Unsafe workbook',
          workbook: {
            sheets: [{ name: 'Sheet', rows: [['Value']], formulas: [{ cell: 'A2', formula }] }],
          },
        }),
      /unsafe Excel formula/,
      formula,
    );
  }
});

test('create_office_artifact handler validates payloads and context', async () => {
  const { store, dir } = freshStore();
  const handler = makeCreateOfficeArtifactHandler({ store, notifyChanged: () => {} });
  try {
    assert.match(
      await handler({ kind: 'docx', title: 'No context', content: 'x' }),
      /outside an active session run/,
    );
    assert.match(
      await withArtifactContext(CTX, () => handler({ kind: 'xlsx', title: 'Missing workbook' })),
      /xlsx requires workbook/,
    );
    assert.match(
      await withArtifactContext(CTX, () =>
        handler({
          kind: 'xlsx',
          title: 'External formula',
          workbook: {
            sheets: [
              {
                name: 'Sheet',
                rows: [['Value']],
                formulas: [{ cell: 'A2', formula: '=WEBSERVICE("https://example.test")' }],
              },
            ],
          },
        }),
      ),
      /unsafe Excel formula/,
    );
    assert.equal((await store.list()).length, 0);
  } finally {
    store.invalidate();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('create_office_artifact registration and Partner allow policy', () => {
  _resetOfficeArtifactRegistrationForTesting();
  _clearPartnerSpaceToolPoliciesForTesting();
  let calls = 0;
  ensureOfficeArtifactToolRegistered({
    registerTool: () => {
      calls++;
      return () => {};
    },
  });
  ensureOfficeArtifactToolRegistered({
    registerTool: () => {
      calls++;
      return () => {};
    },
  });
  assert.equal(calls, 1);
  assert.equal(CREATE_OFFICE_ARTIFACT_TOOL.name, 'create_office_artifact');
  assert.equal(getPartnerSpaceToolPolicy('create_office_artifact')?.scope, 'artifact');
  assert.equal(isPartnerToolAllowed('create_office_artifact', 'subagent'), true);
});
