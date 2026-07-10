import JSZip, { type JSZipObject } from 'jszip';
import { base64ToBytes } from './binaryUtils.js';
import {
  PPTX_PREVIEW_MAX_LINES_PER_SLIDE,
  PPTX_PREVIEW_MAX_SLIDES,
  PPTX_PREVIEW_MAX_TEXT_BYTES_PER_SLIDE,
  PPTX_PREVIEW_MAX_TOTAL_LINES,
  PPTX_PREVIEW_MAX_TOTAL_TEXT_BYTES,
  PPTX_PREVIEW_MAX_XML_CHARS_PER_SLIDE,
  PPTX_PREVIEW_MAX_ZIP_ENTRIES,
  type PptxPreviewSlideDto,
  type PptxPreviewWorkerResponse,
} from './pptxPreviewProtocol.js';
import { utf8ByteLength } from './previewTextLimits.js';

export class PptxPreviewLimitError extends Error {
  constructor() {
    super('PPTX preview exceeds a bounded extraction limit');
    this.name = 'PptxPreviewLimitError';
  }
}

interface SlideTextLimits {
  readonly maxLines: number;
  readonly maxTextBytes: number;
}

export interface ExtractedPptxSlideText {
  readonly lines: readonly string[];
  readonly textBytes: number;
}

interface XmlTag {
  readonly end: number;
  readonly localName: string;
  readonly closing: boolean;
  readonly selfClosing: boolean;
}

function readXmlTag(xml: string, start: number): XmlTag | null {
  const end = xml.indexOf('>', start + 1);
  if (end < 0) return null;

  let cursor = start + 1;
  while (cursor < end && /\s/u.test(xml[cursor] ?? '')) cursor += 1;
  const closing = xml[cursor] === '/';
  if (closing) {
    cursor += 1;
    while (cursor < end && /\s/u.test(xml[cursor] ?? '')) cursor += 1;
  }

  const nameStart = cursor;
  while (cursor < end) {
    const character = xml[cursor] ?? '';
    if (/\s/u.test(character) || character === '/') break;
    cursor += 1;
  }
  const qualifiedName = xml.slice(nameStart, cursor);
  const colon = qualifiedName.lastIndexOf(':');
  const localName = (colon >= 0 ? qualifiedName.slice(colon + 1) : qualifiedName).toLowerCase();

  let tail = end - 1;
  while (tail > start && /\s/u.test(xml[tail] ?? '')) tail -= 1;
  return {
    end,
    localName,
    closing,
    selfClosing: xml[tail] === '/',
  };
}

function decodeXmlEntities(value: string): string {
  return value.replace(/&(?:amp|lt|gt|quot|apos|#\d{1,7}|#x[\da-f]{1,6});/giu, (entity): string => {
    switch (entity.toLowerCase()) {
      case '&amp;':
        return '&';
      case '&lt;':
        return '<';
      case '&gt;':
        return '>';
      case '&quot;':
        return '"';
      case '&apos;':
        return "'";
      default: {
        const hexadecimal = entity[2]?.toLowerCase() === 'x';
        const digits = entity.slice(hexadecimal ? 3 : 2, -1);
        const codePoint = Number.parseInt(digits, hexadecimal ? 16 : 10);
        if (
          !Number.isSafeInteger(codePoint) ||
          codePoint <= 0 ||
          codePoint > 0x10ffff ||
          (codePoint >= 0xd800 && codePoint <= 0xdfff)
        ) {
          return '\ufffd';
        }
        return String.fromCodePoint(codePoint);
      }
    }
  });
}

/**
 * Extract `*:t` elements with a forward-only scanner. No DOM tree is built and
 * every input character is visited a bounded number of times.
 */
export function extractPptxSlideText(
  xml: string,
  limits: SlideTextLimits = {
    maxLines: PPTX_PREVIEW_MAX_LINES_PER_SLIDE,
    maxTextBytes: PPTX_PREVIEW_MAX_TEXT_BYTES_PER_SLIDE,
  },
): ExtractedPptxSlideText {
  if (xml.length > PPTX_PREVIEW_MAX_XML_CHARS_PER_SLIDE) throw new PptxPreviewLimitError();

  const maxLines = Math.max(0, Math.floor(limits.maxLines));
  const maxTextBytes = Math.max(0, Math.floor(limits.maxTextBytes));
  const maxRawTextCharacters = Math.min(PPTX_PREVIEW_MAX_XML_CHARS_PER_SLIDE, maxTextBytes * 8);
  const lines: string[] = [];
  let textBytes = 0;
  let cursor = 0;
  let insideText = false;
  let rawTextCharacters = 0;
  let fragments: string[] = [];

  const appendFragment = (fragment: string): void => {
    rawTextCharacters += fragment.length;
    if (rawTextCharacters > maxRawTextCharacters) throw new PptxPreviewLimitError();
    fragments.push(fragment);
    // Malformed nested markup must not turn an 8 MiB XML string into millions
    // of tiny array allocations.
    if (fragments.length > 4_096) throw new PptxPreviewLimitError();
  };

  const finishText = (): void => {
    const line = decodeXmlEntities(fragments.join('')).replace(/\s+/gu, ' ').trim();
    fragments = [];
    rawTextCharacters = 0;
    if (line.length === 0) return;
    if (lines.length >= maxLines) throw new PptxPreviewLimitError();
    const lineBytes = utf8ByteLength(line, maxTextBytes - textBytes);
    if (lineBytes > maxTextBytes - textBytes) throw new PptxPreviewLimitError();
    lines.push(line);
    textBytes += lineBytes;
  };

  while (cursor < xml.length) {
    const tagStart = xml.indexOf('<', cursor);
    if (tagStart < 0) {
      if (insideText) appendFragment(xml.slice(cursor));
      break;
    }
    if (insideText && tagStart > cursor) appendFragment(xml.slice(cursor, tagStart));

    const tag = readXmlTag(xml, tagStart);
    if (tag === null) {
      if (insideText) appendFragment(xml.slice(tagStart));
      break;
    }

    if (tag.localName === 't') {
      if (tag.closing) {
        if (insideText) finishText();
        insideText = false;
      } else {
        // A second start tag closes malformed prior text deterministically.
        if (insideText) finishText();
        insideText = !tag.selfClosing;
        if (tag.selfClosing) finishText();
      }
    }
    cursor = tag.end + 1;
  }

  if (insideText) finishText();
  return { lines, textBytes };
}

function sourceSlideIndex(fileName: string): number {
  const match = /^ppt\/slides\/slide([1-9]\d*)\.xml$/i.exec(fileName);
  if (match === null) return 0;
  const value = Number(match[1]);
  return Number.isSafeInteger(value) ? value : 0;
}

function collectSlideFiles(zip: JSZip): readonly JSZipObject[] {
  const slides: JSZipObject[] = [];
  let entryCount = 0;

  for (const fileName in zip.files) {
    if (!Object.prototype.hasOwnProperty.call(zip.files, fileName)) continue;
    entryCount += 1;
    if (entryCount > PPTX_PREVIEW_MAX_ZIP_ENTRIES) throw new PptxPreviewLimitError();
    const file = zip.files[fileName];
    if (file !== undefined && !file.dir && sourceSlideIndex(file.name) > 0) {
      slides.push(file);
      if (slides.length > PPTX_PREVIEW_MAX_SLIDES) throw new PptxPreviewLimitError();
    }
  }

  return slides.sort((left, right) => sourceSlideIndex(left.name) - sourceSlideIndex(right.name));
}

/** Parse slides sequentially so decompressed XML strings are never retained as a batch. */
export async function parsePptxPreview(bytes: Uint8Array): Promise<readonly PptxPreviewSlideDto[]> {
  const zip = await JSZip.loadAsync(bytes);
  const slideFiles = collectSlideFiles(zip);
  const slides: PptxPreviewSlideDto[] = [];
  let totalLines = 0;
  let totalTextBytes = 0;

  for (const [position, file] of slideFiles.entries()) {
    const xml = await file.async('string');
    const extracted = extractPptxSlideText(xml, {
      maxLines: Math.min(
        PPTX_PREVIEW_MAX_LINES_PER_SLIDE,
        PPTX_PREVIEW_MAX_TOTAL_LINES - totalLines,
      ),
      maxTextBytes: Math.min(
        PPTX_PREVIEW_MAX_TEXT_BYTES_PER_SLIDE,
        PPTX_PREVIEW_MAX_TOTAL_TEXT_BYTES - totalTextBytes,
      ),
    });
    totalLines += extracted.lines.length;
    totalTextBytes += extracted.textBytes;
    slides.push({ index: position + 1, lines: extracted.lines });
  }

  return slides;
}

export async function parsePptxPreviewBase64(base64: string): Promise<PptxPreviewWorkerResponse> {
  let bytes: Uint8Array<ArrayBuffer>;
  try {
    bytes = base64ToBytes(base64);
  } catch {
    return { type: 'error', code: 'decode' };
  }

  try {
    return { type: 'success', slides: await parsePptxPreview(bytes) };
  } catch (error) {
    return {
      type: 'error',
      code: error instanceof PptxPreviewLimitError ? 'too-large' : 'parse',
    };
  }
}
