import { MAX_FILE_BYTES } from '@kodax-space/space-ipc-schema';
import { Buffer } from 'node:buffer';
import { posix } from 'node:path';
import { isMainThread, parentPort, workerData } from 'node:worker_threads';
import JSZip from 'jszip';
import mammoth from 'mammoth';
import * as XLSX from 'xlsx';
import { validateOfficeZip } from '../artifact/office-zip-guard.js';
import {
  isPartnerSourceExtractionFormat,
  MAX_PARTNER_SOURCE_EVIDENCE_UNIT_CHARS,
  MAX_PARTNER_SOURCE_EVIDENCE_UNITS,
  MAX_PARTNER_SOURCE_EXTRACTED_TEXT_CHARS,
  MAX_PARTNER_SOURCE_EXTRACTION_ERROR_CHARS,
  PARTNER_SOURCE_EXTRACTION_PROTOCOL_VERSION,
  type PartnerSourceExtractionFormat,
  type PartnerSourceExtractionResult,
  type PartnerSourceExtractionUnit,
  type PartnerSourceExtractionWorkerRequest,
  type PartnerSourceExtractionWorkerResponse,
} from './partner-source-extraction-protocol.js';

const MAX_PDF_PAGES = 200;
const MAX_XLSX_SHEETS = 128;
const MAX_XLSX_ROWS_PER_SHEET = 10_000;
const MAX_XLSX_CELLS = 100_000;
const MAX_XLSX_SHEET_KEYS = MAX_XLSX_CELLS + 32;
const MAX_XLSX_CELL_TEXT_CHARS = 4_096;

function capExtractedText(text: string): string {
  return text.length <= MAX_PARTNER_SOURCE_EXTRACTED_TEXT_CHARS
    ? text
    : text.slice(0, MAX_PARTNER_SOURCE_EXTRACTED_TEXT_CHARS);
}

function safeError(error: unknown): string {
  const message = error instanceof Error ? error.message : 'unknown extraction error';
  return message.replace(/[\r\n\t]+/g, ' ').slice(0, MAX_PARTNER_SOURCE_EXTRACTION_ERROR_CHARS);
}

async function extractPdfText(bytes: Buffer): Promise<string> {
  if (bytes.subarray(0, 5).toString('ascii') !== '%PDF-') {
    throw new Error('file has no PDF signature');
  }
  // The legacy Node build eagerly loads @napi-rs/canvas even though text extraction never renders
  // a page. Unloading that native module from short-lived Windows Worker isolates can terminate the
  // test or host process with 0xC0000005. The standard build loads Canvas only if rendering asks for
  // it, so this text-only path stays pure JS while retaining the same PDF parser and limits.
  const pdfjs = await import('pdfjs-dist/build/pdf.mjs');
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(bytes),
    disableFontFace: true,
    disableAutoFetch: true,
    disableStream: true,
    isEvalSupported: false,
    maxImageSize: 4 * 1024 * 1024,
    canvasMaxAreaInBytes: 16 * 1024 * 1024,
    stopAtErrors: false,
  });
  const document = await loadingTask.promise;
  try {
    const pageCount = Math.min(document.numPages, MAX_PDF_PAGES);
    const pages: string[] = [];
    let outputLength = 0;
    for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      try {
        const content = await page.getTextContent();
        const parts: string[] = [];
        let pageLength = 0;
        for (const item of content.items) {
          if (!('str' in item)) continue;
          const remaining = MAX_PARTNER_SOURCE_EXTRACTED_TEXT_CHARS - pageLength;
          if (remaining <= 0) break;
          const rendered = `${item.str}${item.hasEOL ? '\n' : ' '}`;
          parts.push(rendered.slice(0, remaining));
          pageLength += Math.min(rendered.length, remaining);
        }
        const text = parts
          .join('')
          .replace(/[ \t]+\n/g, '\n')
          .trim();
        const rendered = `[Page ${pageNumber}]\n${text}`;
        pages.push(rendered);
        outputLength += rendered.length;
      } finally {
        page.cleanup();
      }
      if (outputLength >= MAX_PARTNER_SOURCE_EXTRACTED_TEXT_CHARS) break;
    }
    if (document.numPages > pageCount && outputLength < MAX_PARTNER_SOURCE_EXTRACTED_TEXT_CHARS) {
      pages.push(`[PDF truncated after ${MAX_PDF_PAGES} pages; total pages: ${document.numPages}]`);
    }
    return capExtractedText(pages.join('\n\n'));
  } finally {
    await document.destroy();
  }
}

async function extractDocxText(bytes: Buffer): Promise<string> {
  await validateOfficeZip(bytes, 'word/document.xml');
  const result = await mammoth.extractRawText({ buffer: Buffer.from(bytes) });
  return capExtractedText(result.value.trim());
}

function decodeXmlText(text: string): string {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_match, hex: string) =>
      String.fromCodePoint(Number.parseInt(hex, 16)),
    )
    .replace(/&#([0-9]+);/g, (_match, decimal: string) =>
      String.fromCodePoint(Number.parseInt(decimal, 10)),
    )
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function attributeValue(tag: string, name: string): string | null {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`(?:^|\\s)${escapedName}=(["'])(.*?)\\1`).exec(tag);
  return match ? decodeXmlText(match[2] ?? '') : null;
}

function relationshipTarget(sourcePart: string, rawTarget: string): string | null {
  const target = rawTarget.replace(/\\/g, '/').trim();
  if (!target || /^[A-Za-z][A-Za-z0-9+.-]*:/.test(target)) return null;
  const resolved = target.startsWith('/')
    ? posix.normalize(target.slice(1))
    : posix.normalize(posix.join(posix.dirname(sourcePart), target));
  if (!resolved || resolved === '..' || resolved.startsWith('../') || resolved.startsWith('/')) {
    return null;
  }
  return resolved;
}

function countStartTags(xml: string, localName: 'c' | 'row', limit: number): number {
  const expression = new RegExp(`<(?:(?:[A-Za-z_][\\w.-]*):)?${localName}(?=[\\s/>])`, 'g');
  let count = 0;
  while (expression.exec(xml)) {
    count += 1;
    if (count > limit) return count;
  }
  return count;
}

function assertWorksheetRowCoordinates(xml: string): void {
  const rowTag = /<(?:(?:[A-Za-z_][\w.-]*):)?row(?=[\s/>])[^>]*>/g;
  for (let match = rowTag.exec(xml); match; match = rowTag.exec(xml)) {
    const rawRow = attributeValue(match[0], 'r');
    if (!rawRow) continue;
    const row = Number(rawRow);
    if (!Number.isSafeInteger(row) || row < 1 || row > MAX_XLSX_ROWS_PER_SHEET) {
      throw new Error(`XLSX worksheet row exceeds the ${MAX_XLSX_ROWS_PER_SHEET} row limit`);
    }
  }
}

async function worksheetPaths(zip: JSZip): Promise<string[]> {
  const paths = new Set<string>();
  for (const name of Object.keys(zip.files)) {
    if (/^xl\/worksheets\/(?!_rels\/)[^/]+\.xml$/i.test(name)) paths.add(name);
  }
  const relationships = zip.file('xl/_rels/workbook.xml.rels');
  if (relationships) {
    const xml = await relationships.async('string');
    for (const match of xml.matchAll(/<Relationship\b[^>]*>/g)) {
      const tag = match[0];
      const type = attributeValue(tag, 'Type');
      const targetMode = attributeValue(tag, 'TargetMode');
      const target = attributeValue(tag, 'Target');
      if (!type?.endsWith('/worksheet') || !target) continue;
      if (targetMode === 'External') throw new Error('external XLSX worksheets are not supported');
      const resolved = relationshipTarget('xl/workbook.xml', target);
      if (!resolved || !zip.file(resolved)) {
        throw new Error('XLSX workbook contains an invalid worksheet relationship');
      }
      paths.add(resolved);
    }
  }
  if (paths.size > MAX_XLSX_SHEETS) {
    throw new Error(`XLSX workbook exceeds the ${MAX_XLSX_SHEETS} sheet limit`);
  }
  return [...paths];
}

async function assertXlsxComplexity(bytes: Buffer): Promise<void> {
  const zip = await JSZip.loadAsync(bytes, { checkCRC32: true, createFolders: false });
  let totalCells = 0;
  for (const path of await worksheetPaths(zip)) {
    const file = zip.file(path);
    if (!file) continue;
    const xml = await file.async('string');
    const rows = countStartTags(xml, 'row', MAX_XLSX_ROWS_PER_SHEET);
    if (rows > MAX_XLSX_ROWS_PER_SHEET) {
      throw new Error(`XLSX worksheet exceeds the ${MAX_XLSX_ROWS_PER_SHEET} row limit`);
    }
    assertWorksheetRowCoordinates(xml);
    totalCells += countStartTags(xml, 'c', MAX_XLSX_CELLS - totalCells);
    if (totalCells > MAX_XLSX_CELLS) {
      throw new Error(`XLSX workbook exceeds the ${MAX_XLSX_CELLS} cell limit`);
    }
  }
}

function renderCellText(cell: XLSX.CellObject): string {
  const rawDisplay = cell.w ?? (cell.v == null ? '' : String(cell.v));
  const display = String(rawDisplay).slice(0, MAX_XLSX_CELL_TEXT_CHARS);
  const formula = cell.f ? ` (=${String(cell.f).slice(0, MAX_XLSX_CELL_TEXT_CHARS)})` : '';
  return `${display}${formula}`;
}

function renderWorksheet(sheet: XLSX.WorkSheet): string {
  const cellAddresses: string[] = [];
  let keyCount = 0;
  for (const address in sheet) {
    if (!Object.prototype.hasOwnProperty.call(sheet, address)) continue;
    keyCount += 1;
    if (keyCount > MAX_XLSX_SHEET_KEYS) {
      throw new Error(`XLSX worksheet exceeds the ${MAX_XLSX_SHEET_KEYS} key limit`);
    }
    if (!address.startsWith('!') && /^[A-Z]+[1-9][0-9]*$/.test(address)) {
      if (address.length > 16) throw new Error('XLSX cell address is too long');
      cellAddresses.push(address);
      if (cellAddresses.length > MAX_XLSX_CELLS) {
        throw new Error(`XLSX worksheet exceeds the ${MAX_XLSX_CELLS} cell limit`);
      }
    }
  }
  cellAddresses.sort((left, right) => {
    const a = XLSX.utils.decode_cell(left);
    const b = XLSX.utils.decode_cell(right);
    return a.r - b.r || a.c - b.c;
  });
  const rows = new Map<number, string[]>();
  let length = 0;
  for (const address of cellAddresses) {
    const cell = sheet[address];
    if (!cell) continue;
    const coordinate = XLSX.utils.decode_cell(address);
    if (coordinate.r >= MAX_XLSX_ROWS_PER_SHEET || coordinate.c >= 16_384) {
      throw new Error('XLSX cell address exceeds extraction limits');
    }
    const rendered = `${address}=${renderCellText(cell)}`;
    const row = rows.get(coordinate.r) ?? [];
    row.push(rendered);
    rows.set(coordinate.r, row);
    length += rendered.length;
    if (length >= MAX_PARTNER_SOURCE_EXTRACTED_TEXT_CHARS) break;
  }
  return capExtractedText(
    [...rows.entries()].map(([row, cells]) => `Row ${row + 1}: ${cells.join(' | ')}`).join('\n'),
  );
}

async function extractXlsxText(bytes: Buffer): Promise<string> {
  await validateOfficeZip(bytes, 'xl/workbook.xml');
  await assertXlsxComplexity(bytes);
  const workbook = XLSX.read(bytes, {
    type: 'buffer',
    cellFormula: true,
    cellText: true,
    cellDates: true,
    cellHTML: false,
    sheetRows: MAX_XLSX_ROWS_PER_SHEET,
  });
  if (workbook.SheetNames.length > MAX_XLSX_SHEETS) {
    throw new Error(`XLSX workbook exceeds the ${MAX_XLSX_SHEETS} sheet limit`);
  }
  const sections: string[] = [];
  let length = 0;
  for (const name of workbook.SheetNames) {
    const sheet = workbook.Sheets[name];
    if (!sheet) continue;
    const section = `[Sheet: ${name.slice(0, 1_024)}]\n${renderWorksheet(sheet)}`;
    sections.push(section);
    length += section.length;
    if (length >= MAX_PARTNER_SOURCE_EXTRACTED_TEXT_CHARS) break;
  }
  return capExtractedText(sections.join('\n\n'));
}

function drawingText(xmlText: string): string {
  const text: string[] = [];
  let length = 0;
  let cursor = 0;
  while (cursor < xmlText.length && length < MAX_PARTNER_SOURCE_EXTRACTED_TEXT_CHARS) {
    const start = xmlText.indexOf('<a:t', cursor);
    if (start < 0) break;
    const boundary = xmlText[start + 4];
    if (boundary !== '>' && boundary !== '/' && !boundary?.match(/\s/)) {
      cursor = start + 4;
      continue;
    }
    const tagEnd = xmlText.indexOf('>', start + 4);
    if (tagEnd < 0) break;
    const close = xmlText.indexOf('</a:t>', tagEnd + 1);
    if (close < 0) break;
    const decoded = decodeXmlText(xmlText.slice(tagEnd + 1, close));
    if (decoded.length > 0) {
      const remaining = MAX_PARTNER_SOURCE_EXTRACTED_TEXT_CHARS - length;
      const bounded = decoded.slice(0, remaining);
      text.push(bounded);
      length += bounded.length + 1;
    }
    cursor = close + 6;
  }
  return capExtractedText(text.join('\n'));
}

function numericPartOrder(left: string, right: string): number {
  const leftNumber = Number(/(\d+)\.xml$/.exec(left)?.[1] ?? 0);
  const rightNumber = Number(/(\d+)\.xml$/.exec(right)?.[1] ?? 0);
  return leftNumber - rightNumber || left.localeCompare(right);
}

async function relatedNotesPath(zip: JSZip, slidePath: string): Promise<string | null> {
  const relsPath = posix.join(
    posix.dirname(slidePath),
    '_rels',
    `${posix.basename(slidePath)}.rels`,
  );
  const relationships = zip.file(relsPath);
  if (!relationships) return null;
  const relationshipsXml = await relationships.async('string');
  for (const match of relationshipsXml.matchAll(/<Relationship\b[^>]*>/g)) {
    const tag = match[0];
    const type = attributeValue(tag, 'Type');
    const targetMode = attributeValue(tag, 'TargetMode');
    const target = attributeValue(tag, 'Target');
    if (!type?.endsWith('/notesSlide') || targetMode === 'External' || !target) continue;
    const resolvedTarget = relationshipTarget(slidePath, target);
    if (resolvedTarget && zip.file(resolvedTarget)) return resolvedTarget;
  }
  return null;
}

async function orderedSlidePaths(zip: JSZip, fallback: readonly string[]): Promise<string[]> {
  const presentation = zip.file('ppt/presentation.xml');
  const relationships = zip.file('ppt/_rels/presentation.xml.rels');
  if (!presentation || !relationships) return [...fallback];
  const [presentationXml, relationshipsXml] = await Promise.all([
    presentation.async('string'),
    relationships.async('string'),
  ]);
  const targets = new Map<string, string>();
  for (const match of relationshipsXml.matchAll(/<Relationship\b[^>]*>/g)) {
    const tag = match[0];
    const id = attributeValue(tag, 'Id');
    const type = attributeValue(tag, 'Type');
    const target = attributeValue(tag, 'Target');
    if (!id || !type?.endsWith('/slide') || !target) continue;
    const resolvedTarget = relationshipTarget('ppt/presentation.xml', target);
    if (resolvedTarget) targets.set(id, resolvedTarget);
  }
  const ordered: string[] = [];
  for (const match of presentationXml.matchAll(/<p:sldId\b[^>]*>/g)) {
    const relationshipId = attributeValue(match[0], 'r:id');
    const target = relationshipId ? targets.get(relationshipId) : undefined;
    if (target && zip.file(target) && !ordered.includes(target)) ordered.push(target);
  }
  for (const path of fallback) if (!ordered.includes(path)) ordered.push(path);
  return ordered;
}

async function extractPptxText(bytes: Buffer): Promise<string> {
  await validateOfficeZip(bytes, 'ppt/presentation.xml');
  const zip = await JSZip.loadAsync(bytes, { checkCRC32: true, createFolders: false });
  const fallbackSlidePaths = Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort(numericPartOrder);
  const slidePaths = await orderedSlidePaths(zip, fallbackSlidePaths);
  const sections: string[] = [];
  let length = 0;
  for (const slidePath of slidePaths) {
    const slideNumber = sections.length + 1;
    const slideFile = zip.file(slidePath);
    if (!slideFile) continue;
    const slideXml = await slideFile.async('string');
    const notesPath = await relatedNotesPath(zip, slidePath);
    const notesFile = notesPath ? zip.file(notesPath) : null;
    const notes = notesFile ? drawingText(await notesFile.async('string')) : '';
    const section = [
      `[Slide ${slideNumber}]`,
      drawingText(slideXml),
      notes ? `[Notes]\n${notes}` : '',
    ]
      .filter(Boolean)
      .join('\n');
    sections.push(section);
    length += section.length;
    if (length >= MAX_PARTNER_SOURCE_EXTRACTED_TEXT_CHARS) break;
  }
  return capExtractedText(sections.join('\n\n'));
}

async function extract(format: PartnerSourceExtractionFormat, bytes: Buffer): Promise<string> {
  switch (format) {
    case 'PDF':
      return extractPdfText(bytes);
    case 'DOCX':
      return extractDocxText(bytes);
    case 'XLSX':
      return extractXlsxText(bytes);
    case 'PPTX':
      return extractPptxText(bytes);
  }
}

function unitId(ordinal: number): string {
  return `unit_${String(ordinal + 1).padStart(8, '0')}`;
}

function structuredExtraction(
  format: PartnerSourceExtractionFormat,
  extractedText: string,
): PartnerSourceExtractionResult {
  const text = capExtractedText(extractedText);
  const units: PartnerSourceExtractionUnit[] = [];
  const warnings: string[] = [];

  const append = (value: string, locator: PartnerSourceExtractionUnit['locator']): void => {
    const normalized = value.trim();
    if (!normalized) return;
    for (
      let offset = 0;
      offset < normalized.length;
      offset += MAX_PARTNER_SOURCE_EVIDENCE_UNIT_CHARS
    ) {
      if (units.length >= MAX_PARTNER_SOURCE_EVIDENCE_UNITS) {
        if (!warnings.includes('evidence_unit_limit_reached')) {
          warnings.push('evidence_unit_limit_reached');
        }
        return;
      }
      const ordinal = units.length;
      units.push({
        id: unitId(ordinal),
        ordinal,
        text: normalized.slice(offset, offset + MAX_PARTNER_SOURCE_EVIDENCE_UNIT_CHARS),
        locator,
      });
    }
  };

  switch (format) {
    case 'PDF': {
      for (const match of text.matchAll(
        /(?:^|\n\n)\[Page (\d+)\]\n([\s\S]*?)(?=\n\n\[Page \d+\]\n|\n\n\[PDF truncated|$)/g,
      )) {
        append(match[2] ?? '', { kind: 'pdf_page', page: Number(match[1]) });
      }
      break;
    }
    case 'DOCX': {
      const paragraphs = text
        .split(/\n+/)
        .map((value) => value.trim())
        .filter(Boolean);
      paragraphs.forEach((paragraph, index) => {
        append(paragraph, { kind: 'docx_paragraph', paragraph: index + 1 });
      });
      break;
    }
    case 'PPTX': {
      for (const match of text.matchAll(
        /(?:^|\n\n)\[Slide (\d+)\]\n([\s\S]*?)(?=\n\n\[Slide \d+\]\n|$)/g,
      )) {
        append(match[2] ?? '', { kind: 'pptx_slide', slide: Number(match[1]) });
      }
      break;
    }
    case 'XLSX': {
      for (const match of text.matchAll(
        /(?:^|\n\n)\[Sheet: ([^\]]+)\]\n([\s\S]*?)(?=\n\n\[Sheet: |$)/g,
      )) {
        const sheet = (match[1] ?? '').slice(0, 256);
        for (const row of (match[2] ?? '').split('\n')) {
          const addresses = [...row.matchAll(/\b([A-Z]+[1-9][0-9]*)=/g)].map((cell) => cell[1]!);
          if (addresses.length === 0) continue;
          const range =
            addresses.length === 1
              ? addresses[0]!
              : `${addresses[0]!}:${addresses[addresses.length - 1]!}`;
          append(row, { kind: 'xlsx_range', sheet, range });
        }
      }
      break;
    }
  }

  if (text.length >= MAX_PARTNER_SOURCE_EXTRACTED_TEXT_CHARS) {
    warnings.push('extracted_text_truncated');
  }
  if (text && units.length === 0) {
    append(text, { kind: 'file', reason: 'unsupported_exact_locator' });
  }
  return { text, units, warnings };
}

function parseRequest(value: unknown): PartnerSourceExtractionWorkerRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('extraction worker received an invalid request');
  }
  const request = value as Partial<PartnerSourceExtractionWorkerRequest>;
  if (
    request.version !== PARTNER_SOURCE_EXTRACTION_PROTOCOL_VERSION ||
    !isPartnerSourceExtractionFormat(request.format) ||
    !(request.bytes instanceof ArrayBuffer) ||
    request.bytes.byteLength > MAX_FILE_BYTES
  ) {
    throw new Error('extraction worker received an invalid request');
  }
  return request as PartnerSourceExtractionWorkerRequest;
}

function postResponse(response: PartnerSourceExtractionWorkerResponse): void {
  if (!parentPort) return;
  parentPort.postMessage(response);
  parentPort.close();
}

async function runWorker(): Promise<void> {
  try {
    const request = parseRequest(workerData);
    const result = structuredExtraction(
      request.format,
      await extract(request.format, Buffer.from(request.bytes)),
    );
    postResponse({
      version: PARTNER_SOURCE_EXTRACTION_PROTOCOL_VERSION,
      ok: true,
      format: request.format,
      text: result.text,
      units: result.units,
      warnings: result.warnings,
    });
  } catch (error) {
    postResponse({
      version: PARTNER_SOURCE_EXTRACTION_PROTOCOL_VERSION,
      ok: false,
      error: safeError(error),
    });
  }
}

if (!isMainThread) void runWorker();
