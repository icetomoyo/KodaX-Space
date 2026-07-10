import JSZip from 'jszip';
import * as XLSX from 'xlsx';
import { closeSync, fstatSync, openSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { validateOfficePreviewBytes } from './office-zip-guard.js';

export type OfficeArtifactKind = 'docx' | 'pdf' | 'xlsx' | 'pptx';

export interface OfficeSourceRef {
  readonly label: string;
  readonly uri?: string;
  readonly note?: string;
}

export interface DocumentBlock {
  readonly type: 'heading' | 'paragraph' | 'bullets' | 'table';
  readonly text?: string;
  readonly level?: number;
  readonly items?: readonly string[];
  readonly rows?: readonly (readonly string[])[];
}

export interface DocumentPayload {
  readonly subtitle?: string;
  readonly blocks?: readonly DocumentBlock[];
}

export interface WorkbookSheetPayload {
  readonly name: string;
  readonly rows: readonly (readonly (string | number | boolean | null)[])[];
  readonly formulas?: readonly { readonly cell: string; readonly formula: string }[];
}

export interface WorkbookPayload {
  readonly sheets: readonly WorkbookSheetPayload[];
}

export interface SlidePayload {
  readonly title: string;
  readonly subtitle?: string;
  readonly bullets?: readonly string[];
  readonly notes?: string;
}

export interface PresentationPayload {
  readonly slides: readonly SlidePayload[];
}

export interface OfficeWriterInput {
  readonly kind: OfficeArtifactKind;
  readonly title: string;
  readonly content?: string;
  readonly document?: DocumentPayload;
  readonly workbook?: WorkbookPayload;
  readonly presentation?: PresentationPayload;
  readonly sourceRefs?: readonly OfficeSourceRef[];
  readonly citations?: readonly OfficeSourceRef[];
}

export interface OfficeWriterResult {
  readonly bytes: Buffer;
  readonly filename: string;
}

function assertXml10Text(value: string): void {
  for (const character of value) {
    const codePoint = character.codePointAt(0)!;
    const valid =
      codePoint === 0x09 ||
      codePoint === 0x0a ||
      codePoint === 0x0d ||
      (codePoint >= 0x20 && codePoint <= 0xd7ff) ||
      (codePoint >= 0xe000 && codePoint <= 0xfffd) ||
      (codePoint >= 0x10000 && codePoint <= 0x10ffff);
    if (!valid) {
      throw new Error(
        `Office text contains an XML 1.0-invalid character U+${codePoint.toString(16).toUpperCase().padStart(4, '0')}`,
      );
    }
  }
}

function validateOfficeInputStrings(value: unknown, seen = new WeakSet<object>()): void {
  if (typeof value === 'string') {
    assertXml10Text(value);
    return;
  }
  if (typeof value !== 'object' || value === null) return;
  if (seen.has(value)) throw new Error('Office writer input must not contain cycles');
  seen.add(value);
  if (Array.isArray(value)) {
    for (const item of value) validateOfficeInputStrings(item, seen);
  } else {
    for (const item of Object.values(value)) validateOfficeInputStrings(item, seen);
  }
  seen.delete(value);
}

function xml(s: string): string {
  assertXml10Text(s);
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function safeName(raw: string, fallback: string): string {
  let out = '';
  for (const ch of raw) {
    const code = ch.charCodeAt(0);
    if ('/\\?%*:|"<>'.includes(ch) || code < 0x20) continue;
    out += ch;
  }
  return out.replace(/^\.+/, '').replace(/\.+$/, '').trim().slice(0, 120) || fallback;
}

function filenameFor(title: string, ext: OfficeArtifactKind): string {
  const base = safeName(title, 'artifact');
  return base.toLowerCase().endsWith(`.${ext}`) ? base : `${base}.${ext}`;
}

function officeSourceRefs(input: OfficeWriterInput): OfficeSourceRef[] {
  return [...(input.sourceRefs ?? []), ...(input.citations ?? [])].filter(
    (ref) => ref.label.trim().length > 0,
  );
}

function sourceRefText(ref: OfficeSourceRef): string {
  return [ref.label, ref.uri, ref.note]
    .filter((part) => part && part.trim().length > 0)
    .join(' - ');
}

function sourceBlocks(input: OfficeWriterInput): DocumentBlock[] {
  const refs = officeSourceRefs(input);
  if (refs.length === 0) return [];
  return [
    { type: 'heading', level: 1, text: 'Sources' },
    {
      type: 'bullets',
      items: refs.map(sourceRefText),
    },
  ];
}

function contentBlocks(content: string | undefined): DocumentBlock[] {
  if (!content || content.trim().length === 0) return [];
  const blocks: DocumentBlock[] = [];
  for (const raw of content.split(/\n{2,}/)) {
    const text = raw.trim();
    if (!text) continue;
    const heading = /^(#{1,6})\s+(.+)$/.exec(text);
    if (heading) {
      blocks.push({ type: 'heading', level: Math.min(3, heading[1]!.length), text: heading[2] });
      continue;
    }
    const bulletLines = text
      .split(/\r?\n/)
      .map((line) => /^[-*]\s+(.+)$/.exec(line.trim())?.[1])
      .filter((line): line is string => Boolean(line));
    if (bulletLines.length > 0 && bulletLines.length === text.split(/\r?\n/).length) {
      blocks.push({ type: 'bullets', items: bulletLines });
      continue;
    }
    blocks.push({ type: 'paragraph', text });
  }
  return blocks;
}

function documentBlocks(input: OfficeWriterInput): DocumentBlock[] {
  const blocks: DocumentBlock[] = [];
  blocks.push({ type: 'heading', level: 0, text: input.title });
  if (input.document?.subtitle) blocks.push({ type: 'paragraph', text: input.document.subtitle });
  const explicit = input.document?.blocks ?? [];
  blocks.push(...(explicit.length > 0 ? explicit : contentBlocks(input.content)));
  blocks.push(...sourceBlocks(input));
  if (blocks.length === 1) blocks.push({ type: 'paragraph', text: 'No body content provided.' });
  return blocks;
}

function docxText(text: string): string {
  return `<w:r><w:t xml:space="preserve">${xml(text)}</w:t></w:r>`;
}

function docxParagraph(text: string, style?: string, bullet = false): string {
  const properties = [
    style ? `<w:pStyle w:val="${style}"/>` : '',
    bullet ? '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>' : '',
  ].join('');
  const pPr = properties ? `<w:pPr>${properties}</w:pPr>` : '';
  return `<w:p>${pPr}${docxText(text)}</w:p>`;
}

function docxTable(rows: readonly (readonly string[])[]): string {
  const body = rows
    .map(
      (row) =>
        `<w:tr>${row
          .map(
            (cell) =>
              `<w:tc><w:tcPr><w:tcW w:w="2400" w:type="dxa"/></w:tcPr>${docxParagraph(
                cell,
              )}</w:tc>`,
          )
          .join('')}</w:tr>`,
    )
    .join('');
  return `<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/></w:tblPr>${body}</w:tbl>`;
}

function docxBlock(block: DocumentBlock): string {
  if (block.type === 'heading') {
    const level = Math.max(0, Math.min(3, block.level ?? 1));
    const style = level === 0 ? 'Title' : `Heading${level}`;
    return docxParagraph(block.text ?? '', style);
  }
  if (block.type === 'bullets') {
    return (block.items ?? []).map((item) => docxParagraph(item, undefined, true)).join('');
  }
  if (block.type === 'table') return docxTable(block.rows ?? []);
  return docxParagraph(block.text ?? '');
}

function docxStyles(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>
  <w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="240"/></w:pPr><w:rPr><w:b/><w:sz w:val="36"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:before="240" w:after="120"/></w:pPr><w:rPr><w:b/><w:sz w:val="28"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:before="180" w:after="100"/></w:pPr><w:rPr><w:b/><w:sz w:val="24"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="heading 3"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:before="140" w:after="80"/></w:pPr><w:rPr><w:b/><w:sz w:val="22"/></w:rPr></w:style>
</w:styles>`;
}

function docxNumbering(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:abstractNum w:abstractNumId="0">
    <w:multiLevelType w:val="singleLevel"/>
    <w:lvl w:ilvl="0">
      <w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/>
      <w:lvlJc w:val="left"/><w:pPr><w:tabs><w:tab w:val="num" w:pos="720"/></w:tabs><w:ind w:left="720" w:hanging="360"/></w:pPr>
      <w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/></w:rPr>
    </w:lvl>
  </w:abstractNum>
  <w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>
</w:numbering>`;
}

async function writeDocx(input: OfficeWriterInput): Promise<Buffer> {
  const zip = new JSZip();
  zip.file(
    '[Content_Types].xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
  <Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>`,
  );
  zip.file(
    '_rels/.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>`,
  );
  zip.file(
    'word/_rels/document.xml.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`,
  );
  zip.file('word/styles.xml', docxStyles());
  zip.file('word/numbering.xml', docxNumbering());
  zip.file(
    'word/document.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    ${documentBlocks(input).map(docxBlock).join('')}
    <w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr>
  </w:body>
</w:document>`,
  );
  zip.file(
    'docProps/core.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${xml(
      input.title,
    )}</dc:title></cp:coreProperties>`,
  );
  zip.file(
    'docProps/app.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>KodaX Space</Application></Properties>`,
  );
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

function pdfAsciiLiteral(text: string): string {
  if (/[^\x09\x0a\x0d\x20-\x7e]/.test(text)) {
    throw new Error('internal PDF error: non-ASCII text requires an embedded Unicode font');
  }
  return text.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

function approximateTextWidth(text: string): number {
  let width = 0;
  for (const character of text) {
    const codePoint = character.codePointAt(0)!;
    const wide =
      codePoint >= 0x1100 &&
      (codePoint <= 0x115f ||
        codePoint === 0x2329 ||
        codePoint === 0x232a ||
        (codePoint >= 0x2e80 && codePoint <= 0xa4cf) ||
        (codePoint >= 0xac00 && codePoint <= 0xd7a3) ||
        (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
        (codePoint >= 0xfe10 && codePoint <= 0xfe6f) ||
        (codePoint >= 0xff00 && codePoint <= 0xff60) ||
        (codePoint >= 0xffe0 && codePoint <= 0xffe6) ||
        (codePoint >= 0x1f300 && codePoint <= 0x1faff) ||
        (codePoint >= 0x20000 && codePoint <= 0x3fffd));
    width += wide ? 2 : 1;
  }
  return width;
}

function splitLongToken(token: string, width: number): string[] {
  const chunks: string[] = [];
  let chunk = '';
  for (const character of token) {
    if (chunk && approximateTextWidth(chunk + character) > width) {
      chunks.push(chunk);
      chunk = character;
    } else {
      chunk += character;
    }
  }
  if (chunk) chunks.push(chunk);
  return chunks.length > 0 ? chunks : [''];
}

function wrapText(text: string, width: number): string[] {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!normalized) return [''];
  const lines: string[] = [];
  let line = '';
  for (const word of normalized.split(' ')) {
    const next = line ? `${line} ${word}` : word;
    if (approximateTextWidth(next) <= width) {
      line = next;
      continue;
    }
    if (line) {
      lines.push(line);
      line = '';
    }
    const chunks = splitLongToken(word, width);
    lines.push(...chunks.slice(0, -1));
    line = chunks.at(-1) ?? '';
    if (approximateTextWidth(line) >= width) {
      lines.push(line);
      line = '';
    }
  }
  if (line) lines.push(line);
  return lines.length > 0 ? lines : [''];
}

function pdfLines(input: OfficeWriterInput): string[] {
  const lines: string[] = [];
  for (const block of documentBlocks(input)) {
    if (block.type === 'heading') {
      lines.push('', ...wrapText(block.text ?? '', 90));
      continue;
    }
    if (block.type === 'bullets') {
      for (const item of block.items ?? []) lines.push(...wrapText(`- ${item}`, 86));
      lines.push('');
      continue;
    }
    if (block.type === 'table') {
      for (const row of block.rows ?? []) lines.push(...wrapText(row.join(' | '), 90));
      lines.push('');
      continue;
    }
    for (const line of wrapText(block.text ?? '', 90)) lines.push(line);
    lines.push('');
  }
  return lines.filter((line, index, all) => line !== '' || all[index - 1] !== '');
}

interface SfntTable {
  readonly offset: number;
  readonly length: number;
}

interface FontFace {
  readonly bytes: Buffer;
  readonly faceOffset: number;
  readonly tables: ReadonlyMap<string, SfntTable>;
  readonly glyphForCodePoint: (codePoint: number) => number;
}

interface PdfEmbeddedFont {
  readonly bytes: Buffer;
  readonly codePointToCid: ReadonlyMap<number, number>;
  readonly cidToGid: Buffer;
  readonly widths: readonly number[];
  readonly bbox: readonly [number, number, number, number];
  readonly ascent: number;
  readonly descent: number;
}

const MAX_PDF_FONT_BYTES = 64 * 1024 * 1024;

function fontFaceOffsets(bytes: Buffer): number[] {
  if (bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'ttcf') {
    const count = bytes.readUInt32BE(8);
    if (count < 1 || count > 64 || 12 + count * 4 > bytes.length) return [];
    return Array.from({ length: count }, (_, index) => bytes.readUInt32BE(12 + index * 4));
  }
  return [0];
}

function parseSfntTables(bytes: Buffer, faceOffset: number): Map<string, SfntTable> | null {
  if (faceOffset < 0 || faceOffset + 12 > bytes.length) return null;
  const tableCount = bytes.readUInt16BE(faceOffset + 4);
  if (tableCount < 1 || tableCount > 256 || faceOffset + 12 + tableCount * 16 > bytes.length) {
    return null;
  }
  const tables = new Map<string, SfntTable>();
  for (let index = 0; index < tableCount; index += 1) {
    const entryOffset = faceOffset + 12 + index * 16;
    const tag = bytes.toString('ascii', entryOffset, entryOffset + 4);
    const offset = bytes.readUInt32BE(entryOffset + 8);
    const length = bytes.readUInt32BE(entryOffset + 12);
    if (offset > bytes.length || length > bytes.length - offset) return null;
    tables.set(tag, { offset, length });
  }
  return tables;
}

function makeCmapLookup(bytes: Buffer, table: SfntTable): ((codePoint: number) => number) | null {
  if (table.length < 4) return null;
  const recordCount = bytes.readUInt16BE(table.offset + 2);
  if (recordCount > 128 || 4 + recordCount * 8 > table.length) return null;
  let chosenOffset = -1;
  let chosenFormat = -1;
  let chosenLimit = -1;
  const tableLimit = table.offset + table.length;
  for (let index = 0; index < recordCount; index += 1) {
    const recordOffset = table.offset + 4 + index * 8;
    const platform = bytes.readUInt16BE(recordOffset);
    const encoding = bytes.readUInt16BE(recordOffset + 2);
    const relative = bytes.readUInt32BE(recordOffset + 4);
    const subtableOffset = table.offset + relative;
    if (subtableOffset + 2 > table.offset + table.length) continue;
    const format = bytes.readUInt16BE(subtableOffset);
    const unicodeRecord = platform === 0 || (platform === 3 && (encoding === 1 || encoding === 10));
    if (!unicodeRecord || (format !== 4 && format !== 12)) continue;
    const subtableLength =
      format === 12
        ? subtableOffset + 8 <= tableLimit
          ? bytes.readUInt32BE(subtableOffset + 4)
          : 0
        : subtableOffset + 4 <= tableLimit
          ? bytes.readUInt16BE(subtableOffset + 2)
          : 0;
    if (
      subtableLength < 16 ||
      subtableOffset > tableLimit ||
      subtableLength > tableLimit - subtableOffset
    ) {
      continue;
    }
    if (format > chosenFormat) {
      chosenFormat = format;
      chosenOffset = subtableOffset;
      chosenLimit = subtableOffset + subtableLength;
    }
  }
  if (chosenOffset < 0) return null;

  if (chosenFormat === 12) {
    if (chosenOffset + 16 > chosenLimit) return null;
    const groupCount = bytes.readUInt32BE(chosenOffset + 12);
    if (groupCount > 2_000_000 || chosenOffset + 16 + groupCount * 12 > chosenLimit) return null;
    return (codePoint: number): number => {
      let low = 0;
      let high = groupCount - 1;
      while (low <= high) {
        const middle = Math.floor((low + high) / 2);
        const groupOffset = chosenOffset + 16 + middle * 12;
        const start = bytes.readUInt32BE(groupOffset);
        const end = bytes.readUInt32BE(groupOffset + 4);
        if (codePoint < start) high = middle - 1;
        else if (codePoint > end) low = middle + 1;
        else return bytes.readUInt32BE(groupOffset + 8) + codePoint - start;
      }
      return 0;
    };
  }

  if (chosenOffset + 16 > chosenLimit) return null;
  const segmentCount = bytes.readUInt16BE(chosenOffset + 6) / 2;
  const endCodes = chosenOffset + 14;
  const startCodes = endCodes + segmentCount * 2 + 2;
  const deltas = startCodes + segmentCount * 2;
  const rangeOffsets = deltas + segmentCount * 2;
  if (rangeOffsets + segmentCount * 2 > chosenLimit) return null;
  return (codePoint: number): number => {
    if (codePoint > 0xffff) return 0;
    for (let index = 0; index < segmentCount; index += 1) {
      const end = bytes.readUInt16BE(endCodes + index * 2);
      if (codePoint > end) continue;
      const start = bytes.readUInt16BE(startCodes + index * 2);
      if (codePoint < start) return 0;
      const delta = bytes.readInt16BE(deltas + index * 2);
      const rangeOffset = bytes.readUInt16BE(rangeOffsets + index * 2);
      if (rangeOffset === 0) return (codePoint + delta) & 0xffff;
      const glyphOffset = rangeOffsets + index * 2 + rangeOffset + (codePoint - start) * 2;
      if (glyphOffset + 2 > chosenLimit) return 0;
      const glyph = bytes.readUInt16BE(glyphOffset);
      return glyph === 0 ? 0 : (glyph + delta) & 0xffff;
    }
    return 0;
  };
}

function unicodeFontCandidates(): string[] {
  const candidates: string[] = [];
  if (process.env.KODAX_PDF_FONT_PATH) candidates.push(process.env.KODAX_PDF_FONT_PATH);
  const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
  if (resourcesPath) {
    candidates.push(
      join(resourcesPath, 'fonts', 'NotoSansCJK-Regular.ttc'),
      join(resourcesPath, 'fonts', 'wqy-zenhei.ttc'),
    );
  }
  const windowsFonts = join(process.env.SystemRoot ?? 'C:\\Windows', 'Fonts');
  candidates.push(
    join(windowsFonts, 'simhei.ttf'),
    join(windowsFonts, 'Deng.ttf'),
    join(windowsFonts, 'msyh.ttc'),
    join(windowsFonts, 'NotoSansSC-VF.ttf'),
    '/System/Library/Fonts/Supplemental/Arial Unicode.ttf',
    '/System/Library/Fonts/AppleSDGothicNeo.ttc',
    '/System/Library/Fonts/PingFang.ttc',
    '/Library/Fonts/Arial Unicode.ttf',
    '/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc',
    '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc',
    '/usr/share/fonts/truetype/noto/NotoSansSC-Regular.ttf',
    '/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc',
    '/usr/share/fonts/truetype/wenquanyi/wqy-zenhei.ttc',
    '/usr/share/fonts/wqy-zenhei/wqy-zenhei.ttc',
    '/usr/share/fonts/wenquanyi/wqy-zenhei.ttc',
    '/usr/share/fonts/noto-cjk/NotoSansCJK-Regular.ttc',
    '/usr/share/fonts/google-noto-cjk/NotoSansCJK-Regular.ttc',
    '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
  );
  return [...new Set(candidates)];
}

function loadBestUnicodeFont(codePoints: readonly number[]): FontFace {
  let best: { face: FontFace; score: number } | null = null;
  for (const filename of unicodeFontCandidates()) {
    let bytes: Buffer;
    let fd: number | null = null;
    try {
      fd = openSync(filename, 'r');
      const before = fstatSync(fd);
      if (!before.isFile() || before.size <= 0 || before.size > MAX_PDF_FONT_BYTES) continue;
      bytes = readFileSync(fd);
      const after = fstatSync(fd);
      if (
        bytes.length !== before.size ||
        after.size !== before.size ||
        after.mtimeMs !== before.mtimeMs ||
        after.ctimeMs !== before.ctimeMs
      ) {
        continue;
      }
    } catch {
      continue;
    } finally {
      if (fd !== null) closeSync(fd);
    }
    for (const faceOffset of fontFaceOffsets(bytes)) {
      const tables = parseSfntTables(bytes, faceOffset);
      const cmap = tables?.get('cmap');
      if (!tables?.has('glyf') || !tables.has('loca') || !cmap) continue;
      const os2 = tables.get('OS/2');
      if (os2 && os2.length >= 10) {
        const embeddingFlags = bytes.readUInt16BE(os2.offset + 8);
        // This writer always embeds a TrueType glyph subset.
        if (embeddingFlags & (0x0002 | 0x0100 | 0x0200)) continue;
      }
      const glyphForCodePoint = makeCmapLookup(bytes, cmap);
      if (!glyphForCodePoint) continue;
      const score = codePoints.reduce(
        (covered, codePoint) => covered + (glyphForCodePoint(codePoint) > 0 ? 1 : 0),
        0,
      );
      const face: FontFace = { bytes, faceOffset, tables, glyphForCodePoint };
      if (!best || score > best.score) best = { face, score };
      if (score === codePoints.length) return face;
    }
  }
  if (!best || best.score !== codePoints.length) {
    throw new Error(
      'Unable to create a Unicode PDF without missing glyphs: no compatible, subset-embeddable TrueType font covers every requested character. Install a CJK/Unicode font or set KODAX_PDF_FONT_PATH to a subset-embeddable .ttf or .ttc font no larger than 64 MB.',
    );
  }
  return best.face;
}

function tableBytes(face: FontFace, tag: string): Buffer | null {
  const table = face.tables.get(tag);
  return table ? Buffer.from(face.bytes.subarray(table.offset, table.offset + table.length)) : null;
}

function glyphLocations(face: FontFace): readonly number[] {
  const head = face.tables.get('head');
  const maxp = face.tables.get('maxp');
  const loca = face.tables.get('loca');
  if (!head || !maxp || !loca || head.length < 54 || maxp.length < 6) {
    throw new Error('Unicode font is missing required TrueType tables.');
  }
  const glyphCount = face.bytes.readUInt16BE(maxp.offset + 4);
  const longLocations = face.bytes.readInt16BE(head.offset + 50) === 1;
  const requiredLength = (glyphCount + 1) * (longLocations ? 4 : 2);
  if (requiredLength > loca.length) throw new Error('Unicode font has an invalid loca table.');
  return Array.from({ length: glyphCount + 1 }, (_, index) =>
    longLocations
      ? face.bytes.readUInt32BE(loca.offset + index * 4)
      : face.bytes.readUInt16BE(loca.offset + index * 2) * 2,
  );
}

function includeCompositeGlyphs(
  face: FontFace,
  locations: readonly number[],
  initial: Set<number>,
): Set<number> {
  const glyf = face.tables.get('glyf');
  if (!glyf) throw new Error('Unicode font has no glyf table.');
  const pending = [...initial];
  while (pending.length > 0) {
    const glyphId = pending.pop()!;
    if (glyphId < 0 || glyphId + 1 >= locations.length) continue;
    const start = glyf.offset + locations[glyphId]!;
    const end = glyf.offset + locations[glyphId + 1]!;
    if (end <= start || start + 10 > face.bytes.length) continue;
    if (face.bytes.readInt16BE(start) >= 0) continue;
    let cursor = start + 10;
    let more = true;
    while (more && cursor + 4 <= end) {
      const flags = face.bytes.readUInt16BE(cursor);
      const componentGlyph = face.bytes.readUInt16BE(cursor + 2);
      if (!initial.has(componentGlyph)) {
        initial.add(componentGlyph);
        pending.push(componentGlyph);
      }
      cursor += 4;
      cursor += flags & 0x0001 ? 4 : 2;
      if (flags & 0x0008) cursor += 2;
      else if (flags & 0x0040) cursor += 4;
      else if (flags & 0x0080) cursor += 8;
      more = Boolean(flags & 0x0020);
    }
  }
  return initial;
}

function sfntChecksum(bytes: Buffer): number {
  let checksum = 0;
  for (let offset = 0; offset < bytes.length; offset += 4) {
    let word = 0;
    for (let index = 0; index < 4; index += 1) word = (word << 8) | (bytes[offset + index] ?? 0);
    checksum = (checksum + (word >>> 0)) >>> 0;
  }
  return checksum;
}

function buildSfnt(face: FontFace, replacements: ReadonlyMap<string, Buffer>): Buffer {
  const retainedTags = [
    'OS/2',
    'cmap',
    'cvt ',
    'fpgm',
    'gasp',
    'glyf',
    'head',
    'hhea',
    'hmtx',
    'loca',
    'maxp',
    'name',
    'post',
    'prep',
  ].filter((tag) => replacements.has(tag) || face.tables.has(tag));
  const tableCount = retainedTags.length;
  const highestPowerOfTwo = 2 ** Math.floor(Math.log2(tableCount));
  const headerLength = 12 + tableCount * 16;
  const chunks: Array<{ tag: string; bytes: Buffer; offset: number }> = [];
  let cursor = headerLength;
  for (const tag of retainedTags) {
    const bytes = Buffer.from(replacements.get(tag) ?? tableBytes(face, tag)!);
    if (tag === 'head' && bytes.length >= 12) bytes.writeUInt32BE(0, 8);
    chunks.push({ tag, bytes, offset: cursor });
    cursor += (bytes.length + 3) & ~3;
  }
  const output = Buffer.alloc(cursor);
  face.bytes.copy(output, 0, face.faceOffset, face.faceOffset + 4);
  output.writeUInt16BE(tableCount, 4);
  output.writeUInt16BE(highestPowerOfTwo * 16, 6);
  output.writeUInt16BE(Math.log2(highestPowerOfTwo), 8);
  output.writeUInt16BE(tableCount * 16 - highestPowerOfTwo * 16, 10);
  chunks.forEach((chunk, index) => {
    const directoryOffset = 12 + index * 16;
    output.write(chunk.tag, directoryOffset, 4, 'ascii');
    output.writeUInt32BE(sfntChecksum(chunk.bytes), directoryOffset + 4);
    output.writeUInt32BE(chunk.offset, directoryOffset + 8);
    output.writeUInt32BE(chunk.bytes.length, directoryOffset + 12);
    chunk.bytes.copy(output, chunk.offset);
  });
  const headChunk = chunks.find((chunk) => chunk.tag === 'head');
  if (headChunk) {
    output.writeUInt32BE((0xb1b0afba - sfntChecksum(output)) >>> 0, headChunk.offset + 8);
  }
  return output;
}

function subsetTrueTypeFont(face: FontFace, requestedGlyphs: ReadonlySet<number>): Buffer {
  const locations = glyphLocations(face);
  const glyf = face.tables.get('glyf')!;
  const included = includeCompositeGlyphs(face, locations, new Set([0, ...requestedGlyphs]));
  const newLocations = Buffer.alloc(locations.length * 4);
  const glyphChunks: Buffer[] = [];
  let glyphOffset = 0;
  for (let glyphId = 0; glyphId + 1 < locations.length; glyphId += 1) {
    newLocations.writeUInt32BE(glyphOffset, glyphId * 4);
    if (!included.has(glyphId)) continue;
    const start = locations[glyphId]!;
    const end = locations[glyphId + 1]!;
    if (end <= start || end > glyf.length) continue;
    const raw = Buffer.from(face.bytes.subarray(glyf.offset + start, glyf.offset + end));
    glyphChunks.push(raw);
    glyphOffset += raw.length;
    const padding = (4 - (glyphOffset % 4)) % 4;
    if (padding > 0) {
      glyphChunks.push(Buffer.alloc(padding));
      glyphOffset += padding;
    }
  }
  newLocations.writeUInt32BE(glyphOffset, (locations.length - 1) * 4);
  const head = tableBytes(face, 'head');
  if (!head || head.length < 54) throw new Error('Unicode font has an invalid head table.');
  head.writeInt16BE(1, 50);
  return buildSfnt(
    face,
    new Map([
      ['glyf', Buffer.concat(glyphChunks)],
      ['loca', newLocations],
      ['head', head],
    ]),
  );
}

function scaledMetric(value: number, unitsPerEm: number): number {
  return Math.round((value * 1000) / unitsPerEm);
}

function glyphAdvanceWidth(face: FontFace, glyphId: number, unitsPerEm: number): number {
  const hhea = face.tables.get('hhea');
  const hmtx = face.tables.get('hmtx');
  if (!hhea || !hmtx || hhea.length < 36) return 1000;
  const metricCount = face.bytes.readUInt16BE(hhea.offset + 34);
  if (metricCount === 0) return 1000;
  const metricIndex = Math.min(glyphId, metricCount - 1);
  const metricOffset = hmtx.offset + metricIndex * 4;
  if (metricOffset + 2 > hmtx.offset + hmtx.length) return 1000;
  return Math.max(1, scaledMetric(face.bytes.readUInt16BE(metricOffset), unitsPerEm));
}

function prepareEmbeddedFont(codePoints: readonly number[]): PdfEmbeddedFont {
  const face = loadBestUnicodeFont(codePoints);
  const head = face.tables.get('head');
  const hhea = face.tables.get('hhea');
  if (!head || head.length < 54 || !hhea || hhea.length < 10) {
    throw new Error('Unicode font has incomplete metrics.');
  }
  const unitsPerEm = face.bytes.readUInt16BE(head.offset + 18) || 1000;
  const uniqueCodePoints = [...new Set(codePoints)].slice(0, 65_534);
  const codePointToCid = new Map<number, number>();
  const glyphs = new Set<number>();
  const widths: number[] = [];
  const cidToGid = Buffer.alloc((uniqueCodePoints.length + 1) * 2);
  uniqueCodePoints.forEach((codePoint, index) => {
    const cid = index + 1;
    const glyphId = face.glyphForCodePoint(codePoint);
    codePointToCid.set(codePoint, cid);
    glyphs.add(glyphId);
    cidToGid.writeUInt16BE(Math.min(glyphId, 0xffff), cid * 2);
    widths.push(glyphAdvanceWidth(face, glyphId, unitsPerEm));
  });
  return {
    bytes: subsetTrueTypeFont(face, glyphs),
    codePointToCid,
    cidToGid,
    widths,
    bbox: [
      scaledMetric(face.bytes.readInt16BE(head.offset + 36), unitsPerEm),
      scaledMetric(face.bytes.readInt16BE(head.offset + 38), unitsPerEm),
      scaledMetric(face.bytes.readInt16BE(head.offset + 40), unitsPerEm),
      scaledMetric(face.bytes.readInt16BE(head.offset + 42), unitsPerEm),
    ],
    ascent: scaledMetric(face.bytes.readInt16BE(hhea.offset + 4), unitsPerEm),
    descent: scaledMetric(face.bytes.readInt16BE(hhea.offset + 6), unitsPerEm),
  };
}

function unicodeHex(codePoint: number): string {
  const utf16 = Buffer.from(String.fromCodePoint(codePoint), 'utf16le');
  utf16.swap16();
  return utf16.toString('hex').toUpperCase();
}

function toUnicodeCmap(codePointToCid: ReadonlyMap<number, number>): Buffer {
  const entries = [...codePointToCid.entries()];
  const chunks: string[] = [];
  for (let start = 0; start < entries.length; start += 100) {
    const group = entries.slice(start, start + 100);
    chunks.push(
      `${group.length} beginbfchar\n${group
        .map(
          ([codePoint, cid]) =>
            `<${cid.toString(16).padStart(4, '0').toUpperCase()}> <${unicodeHex(codePoint)}>`,
        )
        .join('\n')}\nendbfchar`,
    );
  }
  return Buffer.from(
    `/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n/CMapName /KodaXUnicode-UCS def\n/CMapType 2 def\n1 begincodespacerange\n<0000> <FFFF>\nendcodespacerange\n${chunks.join(
      '\n',
    )}\nendcmap\nCMapName currentdict /CMap defineresource pop\nend\nend`,
    'ascii',
  );
}

function pdfStream(bytes: Buffer, compress = false, extraDictionary = ''): Buffer {
  const body = compress ? deflateSync(bytes, { level: 9 }) : bytes;
  const filter = compress ? ' /Filter /FlateDecode' : '';
  return Buffer.concat([
    Buffer.from(`<< /Length ${body.length}${filter}${extraDictionary} >>\nstream\n`, 'ascii'),
    body,
    Buffer.from('\nendstream', 'ascii'),
  ]);
}

function buildPdf(objects: readonly (string | Buffer)[]): Buffer {
  const chunks: Buffer[] = [Buffer.from('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n', 'binary')];
  const offsets = [0];
  let byteLength = chunks[0]!.length;
  objects.forEach((object, index) => {
    offsets.push(byteLength);
    const objectBytes = Buffer.isBuffer(object) ? object : Buffer.from(object, 'ascii');
    const chunk = Buffer.concat([
      Buffer.from(`${index + 1} 0 obj\n`, 'ascii'),
      objectBytes,
      Buffer.from('\nendobj\n', 'ascii'),
    ]);
    chunks.push(chunk);
    byteLength += chunk.length;
  });
  const xrefOffset = byteLength;
  let trailer = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let index = 1; index <= objects.length; index += 1) {
    trailer += `${String(offsets[index]).padStart(10, '0')} 00000 n \n`;
  }
  trailer += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  chunks.push(Buffer.from(trailer, 'ascii'));
  return Buffer.concat(chunks);
}

function writePdf(input: OfficeWriterInput): Buffer {
  const lineHeight = 15;
  const pageLines = 48;
  const chunks: string[][] = [];
  const lines = pdfLines(input);
  for (let i = 0; i < lines.length; i += pageLines) chunks.push(lines.slice(i, i + pageLines));
  if (chunks.length === 0) chunks.push(['']);

  const objects: Array<string | Buffer> = [];
  const add = (body: string | Buffer): number => {
    objects.push(body);
    return objects.length;
  };
  const catalogId = add('<< /Type /Catalog /Pages 2 0 R >>');
  const pagesId = add('');
  const needsUnicodeFont = lines.some((line) => /[^\x09\x0a\x0d\x20-\x7e]/.test(line));
  let fontId: number;
  let encodeLine: (line: string) => string;
  if (needsUnicodeFont) {
    const codePoints = [...lines.join('')].map((character) => character.codePointAt(0)!);
    const font = prepareEmbeddedFont(codePoints);
    const fontFileId = add(pdfStream(font.bytes, true, ` /Length1 ${font.bytes.length}`));
    const descriptorId = add(
      `<< /Type /FontDescriptor /FontName /KodaXUnicode /Flags 4 /FontBBox [${font.bbox.join(
        ' ',
      )}] /ItalicAngle 0 /Ascent ${font.ascent} /Descent ${font.descent} /CapHeight ${font.ascent} /StemV 80 /FontFile2 ${fontFileId} 0 R >>`,
    );
    const cidToGidId = add(pdfStream(font.cidToGid, true));
    const descendantId = add(
      `<< /Type /Font /Subtype /CIDFontType2 /BaseFont /KodaXUnicode /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor ${descriptorId} 0 R /DW 1000 /W [1 [${font.widths.join(
        ' ',
      )}]] /CIDToGIDMap ${cidToGidId} 0 R >>`,
    );
    const toUnicodeId = add(pdfStream(toUnicodeCmap(font.codePointToCid), true));
    fontId = add(
      `<< /Type /Font /Subtype /Type0 /BaseFont /KodaXUnicode /Encoding /Identity-H /DescendantFonts [${descendantId} 0 R] /ToUnicode ${toUnicodeId} 0 R >>`,
    );
    encodeLine = (line: string): string => {
      const encoded = [...line]
        .map((character) => font.codePointToCid.get(character.codePointAt(0)!) ?? 0)
        .map((cid) => cid.toString(16).padStart(4, '0'))
        .join('');
      return `<${encoded.toUpperCase()}> Tj T*`;
    };
  } else {
    fontId = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
    encodeLine = (line: string): string => `(${pdfAsciiLiteral(line)}) Tj T*`;
  }
  const pageIds: number[] = [];

  for (const chunk of chunks) {
    const ops = [
      'BT',
      '/F1 11 Tf',
      `${lineHeight} TL`,
      '72 760 Td',
      ...chunk.map(encodeLine),
      'ET',
    ].join('\n');
    const contentId = add(pdfStream(Buffer.from(ops, 'ascii')));
    const pageId = add(
      `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${contentId} 0 R >>`,
    );
    pageIds.push(pageId);
  }

  objects[pagesId - 1] =
    `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`;
  objects[catalogId - 1] = '<< /Type /Catalog /Pages 2 0 R >>';

  return buildPdf(objects);
}

function sanitizeSheetName(raw: string, fallback: string): string {
  const cleaned = raw
    .replace(/[:\\/?*[\]]/g, ' ')
    .trim()
    .replace(/^'+|'+$/g, '')
    .slice(0, 31);
  return cleaned || fallback;
}

function uniqueSheetName(existing: readonly string[], raw: string, fallback: string): string {
  const base = sanitizeSheetName(raw, fallback);
  const used = new Set(existing.map((name) => name.toLocaleLowerCase('en-US')));
  if (!used.has(base.toLocaleLowerCase('en-US'))) return base;
  for (let index = 2; index <= 10_000; index += 1) {
    const suffix = ` (${index})`;
    const candidate = `${base.slice(0, 31 - suffix.length)}${suffix}`;
    if (!used.has(candidate.toLocaleLowerCase('en-US'))) return candidate;
  }
  throw new Error('unable to allocate a unique worksheet name');
}

const SAFE_WORKSHEET_FUNCTIONS = new Set([
  'ABS',
  'AGGREGATE',
  'AND',
  'AVERAGE',
  'AVERAGEIF',
  'AVERAGEIFS',
  'CEILING',
  'CHOOSE',
  'CLEAN',
  'COLUMN',
  'COLUMNS',
  'CONCAT',
  'CONCATENATE',
  'COUNT',
  'COUNTA',
  'COUNTBLANK',
  'COUNTIF',
  'COUNTIFS',
  'DATE',
  'DAY',
  'EDATE',
  'EOMONTH',
  'EXACT',
  'FILTER',
  'FIND',
  'FLOOR',
  'HLOOKUP',
  'HOUR',
  'IF',
  'IFERROR',
  'IFNA',
  'IFS',
  'INDEX',
  'INT',
  'ISBLANK',
  'ISERROR',
  'ISNUMBER',
  'ISTEXT',
  'LARGE',
  'LEFT',
  'LEN',
  'LOWER',
  'MATCH',
  'MAX',
  'MEDIAN',
  'MID',
  'MIN',
  'MINUTE',
  'MOD',
  'MONTH',
  'MROUND',
  'NA',
  'NETWORKDAYS',
  'NOT',
  'NOW',
  'OR',
  'PERCENTILE.EXC',
  'PERCENTILE.INC',
  'POWER',
  'PRODUCT',
  'PROPER',
  'QUARTILE.EXC',
  'QUARTILE.INC',
  'RANK.AVG',
  'RANK.EQ',
  'REPLACE',
  'RIGHT',
  'ROUND',
  'ROUNDDOWN',
  'ROUNDUP',
  'ROW',
  'ROWS',
  'SEARCH',
  'SECOND',
  'SEQUENCE',
  'SIGN',
  'SMALL',
  'SORT',
  'SQRT',
  'STDEV.P',
  'STDEV.S',
  'SUBSTITUTE',
  'SUBTOTAL',
  'SUM',
  'SUMIF',
  'SUMIFS',
  'SUMPRODUCT',
  'TEXT',
  'TEXTJOIN',
  'TIME',
  'TODAY',
  'TRANSPOSE',
  'TRIM',
  'TRUNC',
  'UNIQUE',
  'UPPER',
  'VALUE',
  'VAR.P',
  'VAR.S',
  'VLOOKUP',
  'WEEKDAY',
  'WORKDAY',
  'XLOOKUP',
  'XMATCH',
  'XOR',
  'YEAR',
]);

function stripFormulaQuotedSegments(formula: string): string {
  let result = '';
  let quote: '"' | "'" | null = null;
  for (let index = 0; index < formula.length; index += 1) {
    const character = formula[index]!;
    if (quote !== null) {
      result += ' ';
      if (character === quote) {
        if (formula[index + 1] === quote) {
          result += ' ';
          index += 1;
        } else {
          quote = null;
        }
      }
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      result += ' ';
      continue;
    }
    result += character;
  }
  if (quote !== null) throw new Error('unsafe Excel formula: unterminated quoted value');
  return result;
}

/**
 * Keep generated workbooks local-only. Excel formulas can otherwise encode DDE,
 * external-workbook links, URL fetches, add-in calls, or future dynamic functions
 * that execute only after the user opens the exported file.
 */
export function normalizeSafeWorksheetFormula(raw: string): string {
  const formula = raw.trim().replace(/^=/, '').trim();
  if (!formula || formula.length > 2_048) {
    throw new Error('unsafe Excel formula: formula must contain 1-2048 characters');
  }
  if (/[\u0000-\u001f\u007f]/.test(formula)) {
    throw new Error('unsafe Excel formula: control characters are not permitted');
  }
  if (
    /[[\]{}|\\]/.test(formula) ||
    /(?:https?|ftp|file):/i.test(formula) ||
    /(?:^|[^A-Z0-9_])(?:DDE|WEBSERVICE|HYPERLINK|RTD|CALL|REGISTER(?:\.ID)?|EXEC|RUN|IMAGE|STOCKHISTORY|FILTERXML|SQL\.REQUEST)\s*\(/i.test(
      formula,
    )
  ) {
    throw new Error(
      'unsafe Excel formula: external links, paths, DDE, and network-capable functions are not permitted',
    );
  }

  const formulaCode = stripFormulaQuotedSegments(formula);
  const functionPattern = /(?:^|[^A-Z0-9_.])((?:_XLFN\.|_XLWS\.)?[A-Z_][A-Z0-9_.]*)\s*\(/gi;
  for (const match of formulaCode.matchAll(functionPattern)) {
    const name = match[1]!
      .toUpperCase()
      .replace(/^_XLFN\./, '')
      .replace(/^_XLWS\./, '');
    if (!SAFE_WORKSHEET_FUNCTIONS.has(name)) {
      throw new Error(`unsafe Excel formula: function ${name} is not in the local-only allowlist`);
    }
  }
  return formula;
}

function setWorksheetFormula(ws: XLSX.WorkSheet, address: string, formula: string): void {
  if (!/^[A-Z]{1,3}[1-9][0-9]{0,6}$/.test(address)) {
    throw new Error(`invalid Excel formula cell: ${address}`);
  }
  const coordinate = XLSX.utils.decode_cell(address);
  if (coordinate.c > 16_383 || coordinate.r > 1_048_575) {
    throw new Error(`Excel formula cell is outside the worksheet grid: ${address}`);
  }
  ws[address] = { t: 'n', f: normalizeSafeWorksheetFormula(formula) };
  const range = ws['!ref']
    ? XLSX.utils.decode_range(ws['!ref'])
    : { s: { ...coordinate }, e: { ...coordinate } };
  range.s.c = Math.min(range.s.c, coordinate.c);
  range.s.r = Math.min(range.s.r, coordinate.r);
  range.e.c = Math.max(range.e.c, coordinate.c);
  range.e.r = Math.max(range.e.r, coordinate.r);
  ws['!ref'] = XLSX.utils.encode_range(range);
}

function applyWorksheetLayout(
  ws: XLSX.WorkSheet,
  rows: readonly (readonly (string | number | boolean | null)[])[],
): void {
  const widthCount = Math.max(1, ...rows.map((row) => row.length));
  ws['!cols'] = Array.from({ length: widthCount }, (_, column) => {
    const widest = rows.reduce((max, row) => {
      const value = row[column];
      return Math.max(
        max,
        value === null || value === undefined ? 0 : approximateTextWidth(String(value)),
      );
    }, 0);
    return { wch: Math.max(10, Math.min(48, widest + 2)) };
  });
  if (rows.length > 1 && ws['!ref']) {
    ws['!autofilter'] = {
      ref: XLSX.utils.encode_range({
        s: { r: 0, c: 0 },
        e: { r: rows.length - 1, c: widthCount - 1 },
      }),
    };
  }
}

function writeXlsx(input: OfficeWriterInput): Buffer {
  const sheets = input.workbook?.sheets;
  const wb = XLSX.utils.book_new();
  const usable =
    sheets && sheets.length > 0
      ? sheets
      : [{ name: 'Sheet1', rows: [[input.title], [input.content ?? '']] }];
  usable.forEach((sheet, index) => {
    const rows = sheet.rows.map((row) => [...row]);
    const ws = XLSX.utils.aoa_to_sheet(rows);
    for (const formula of sheet.formulas ?? []) {
      setWorksheetFormula(ws, formula.cell, formula.formula);
    }
    applyWorksheetLayout(ws, rows);
    XLSX.utils.book_append_sheet(
      wb,
      ws,
      uniqueSheetName(wb.SheetNames, sheet.name, `Sheet${index + 1}`),
    );
  });
  const refs = officeSourceRefs(input);
  if (refs.length > 0) {
    const sourceSheetName = uniqueSheetName(wb.SheetNames, 'Sources', 'Sources');
    const sourceSheet = XLSX.utils.aoa_to_sheet([
      ['Label', 'URI', 'Note'],
      ...refs.map((ref) => [ref.label, ref.uri ?? '', ref.note ?? '']),
    ]);
    applyWorksheetLayout(sourceSheet, [
      ['Label', 'URI', 'Note'],
      ...refs.map((ref) => [ref.label, ref.uri ?? '', ref.note ?? '']),
    ]);
    XLSX.utils.book_append_sheet(wb, sourceSheet, sourceSheetName);
  }
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

interface SlideTextStyle {
  readonly size?: number;
  readonly color?: string;
  readonly bold?: boolean;
  readonly bulletFrom?: number;
}

function slideTextShape(
  id: number,
  x: number,
  y: number,
  w: number,
  h: number,
  lines: readonly string[],
  style: SlideTextStyle = {},
): string {
  const size = style.size ?? 1800;
  const color = style.color ?? '334155';
  const paragraphs = lines
    .map((line, index) => {
      const bullet = style.bulletFrom !== undefined && index >= style.bulletFrom;
      return `<a:p>${bullet ? '<a:pPr marL="342900" indent="-228600"><a:buChar char="•"/></a:pPr>' : ''}<a:r><a:rPr lang="en-US" sz="${size}"${style.bold ? ' b="1"' : ''}><a:solidFill><a:srgbClr val="${color}"/></a:solidFill></a:rPr><a:t>${xml(line)}</a:t></a:r><a:endParaRPr lang="en-US" sz="${size}"/></a:p>`;
    })
    .join('');
  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="Text ${id}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${w}" cy="${h}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr><p:txBody><a:bodyPr wrap="square"/><a:lstStyle/>${paragraphs}</p:txBody></p:sp>`;
}

function slideAccentBar(): string {
  return '<p:sp><p:nvSpPr><p:cNvPr id="4" name="Accent bar"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="457200" y="365760"/><a:ext cx="91440" cy="4114800"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="2563EB"/></a:solidFill><a:ln><a:noFill/></a:ln></p:spPr></p:sp>';
}

function slideXml(slide: SlidePayload): string {
  const lines = [slide.subtitle, ...(slide.bullets ?? [])].filter((line): line is string =>
    Boolean(line),
  );
  const bulletFrom = slide.subtitle ? 1 : 0;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld><p:spTree>
    <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>
    ${slideAccentBar()}
    ${slideTextShape(2, 685800, 457200, 7772400, 900000, [slide.title], { size: 2800, color: '0F172A', bold: true })}
    ${slideTextShape(3, 914400, 1500000, 7315200, 3000000, lines, { size: 1800, color: '334155', bulletFrom })}
  </p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>
</p:sld>`;
}

function notesXml(notes: string | undefined): string {
  const paragraphs = (notes?.split(/\r?\n/) ?? [''])
    .map(
      (line) =>
        `<a:p><a:r><a:rPr lang="en-US" sz="1200"/><a:t>${xml(line)}</a:t></a:r><a:endParaRPr lang="en-US" sz="1200"/></a:p>`,
    )
    .join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:notes xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>
    <p:sp><p:nvSpPr><p:cNvPr id="2" name="Notes Placeholder 2"/><p:cNvSpPr txBox="1"/><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr>
      <p:spPr><a:xfrm><a:off x="457200" y="457200"/><a:ext cx="8229600" cy="4000000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr>
      <p:txBody><a:bodyPr wrap="square"/><a:lstStyle/>${paragraphs}</p:txBody>
    </p:sp>
  </p:spTree></p:cSld>
</p:notes>`;
}

async function writePptx(input: OfficeWriterInput): Promise<Buffer> {
  const zip = new JSZip();
  const contentSlides =
    input.presentation?.slides && input.presentation.slides.length > 0
      ? input.presentation.slides
      : [{ title: input.title, bullets: input.content ? [input.content] : [] }];
  const refs = officeSourceRefs(input);
  const slides: readonly SlidePayload[] = [
    ...contentSlides,
    ...(refs.length > 0 ? [{ title: 'Sources', bullets: refs.map(sourceRefText) }] : []),
  ];
  const slideOverrides = slides
    .map(
      (_, index) =>
        `<Override PartName="/ppt/slides/slide${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`,
    )
    .join('');
  const notesOverrides = slides
    .map(
      (_, index) =>
        `<Override PartName="/ppt/notesSlides/notesSlide${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.notesSlide+xml"/>`,
    )
    .join('');
  zip.file(
    '[Content_Types].xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
  ${slideOverrides}${notesOverrides}
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>`,
  );
  zip.file(
    '_rels/.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`,
  );
  zip.file(
    'ppt/presentation.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:sldIdLst>${slides
      .map((_, index) => `<p:sldId id="${256 + index}" r:id="rId${index + 1}"/>`)
      .join(
        '',
      )}</p:sldIdLst><p:sldSz cx="9144000" cy="5143500" type="screen16x9"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>`,
  );
  zip.file(
    'ppt/_rels/presentation.xml.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${slides
      .map(
        (_, index) =>
          `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${index + 1}.xml"/>`,
      )
      .join('')}</Relationships>`,
  );
  slides.forEach((slide, index) => {
    const n = index + 1;
    zip.file(`ppt/slides/slide${n}.xml`, slideXml(slide));
    zip.file(
      `ppt/slides/_rels/slide${n}.xml.rels`,
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide" Target="../notesSlides/notesSlide${n}.xml"/></Relationships>`,
    );
    zip.file(`ppt/notesSlides/notesSlide${n}.xml`, notesXml(slide.notes));
  });
  zip.file(
    'docProps/core.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${xml(
      input.title,
    )}</dc:title></cp:coreProperties>`,
  );
  zip.file(
    'docProps/app.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>KodaX Space</Application><Slides>${slides.length}</Slides></Properties>`,
  );
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

export async function createOfficeArtifactBytes(
  input: OfficeWriterInput,
): Promise<OfficeWriterResult> {
  validateOfficeInputStrings(input);
  const filename = filenameFor(input.title, input.kind);
  let bytes: Buffer;
  switch (input.kind) {
    case 'docx':
      bytes = await writeDocx(input);
      break;
    case 'pdf':
      bytes = writePdf(input);
      break;
    case 'xlsx':
      bytes = writeXlsx(input);
      break;
    case 'pptx':
      bytes = await writePptx(input);
      break;
    default: {
      const _exhaustive: never = input.kind;
      throw new Error(`unsupported office artifact kind: ${String(_exhaustive)}`);
    }
  }
  await validateOfficePreviewBytes(filename, bytes);
  return { filename, bytes };
}
