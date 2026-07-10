import { utf8ByteLength } from './previewTextLimits.js';

export const PPTX_PREVIEW_MAX_SLIDES = 500;
export const PPTX_PREVIEW_MAX_ZIP_ENTRIES = 4_000;
export const PPTX_PREVIEW_MAX_XML_CHARS_PER_SLIDE = 8 * 1024 * 1024;
export const PPTX_PREVIEW_MAX_LINES_PER_SLIDE = 512;
export const PPTX_PREVIEW_MAX_TOTAL_LINES = 10_000;
export const PPTX_PREVIEW_MAX_TEXT_BYTES_PER_SLIDE = 256 * 1024;
export const PPTX_PREVIEW_MAX_TOTAL_TEXT_BYTES = 4 * 1024 * 1024;

export type PptxPreviewErrorCode = 'decode' | 'parse' | 'too-large';

export interface PptxPreviewSlideDto {
  readonly index: number;
  readonly lines: readonly string[];
}

export interface PptxPreviewParseRequest {
  readonly type: 'parse';
  readonly base64: string;
}

export type PptxPreviewWorkerResponse =
  | {
      readonly type: 'success';
      readonly slides: readonly PptxPreviewSlideDto[];
    }
  | {
      readonly type: 'error';
      readonly code: PptxPreviewErrorCode;
    };

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}

/** Validate DTO shape and renderer-amplification caps after structured clone. */
export function normalizePptxPreviewWorkerResponse(value: unknown): PptxPreviewWorkerResponse {
  if (!isRecord(value)) return { type: 'error', code: 'parse' };
  if (value.type === 'error') {
    return value.code === 'decode' || value.code === 'parse' || value.code === 'too-large'
      ? { type: 'error', code: value.code }
      : { type: 'error', code: 'parse' };
  }
  if (value.type !== 'success' || !Array.isArray(value.slides)) {
    return { type: 'error', code: 'parse' };
  }
  if (value.slides.length > PPTX_PREVIEW_MAX_SLIDES) {
    return { type: 'error', code: 'too-large' };
  }

  const slides: PptxPreviewSlideDto[] = [];
  let totalLines = 0;
  let totalTextBytes = 0;
  for (const [position, candidate] of value.slides.entries()) {
    if (
      !isRecord(candidate) ||
      candidate.index !== position + 1 ||
      !Array.isArray(candidate.lines)
    ) {
      return { type: 'error', code: 'parse' };
    }
    if (candidate.lines.length > PPTX_PREVIEW_MAX_LINES_PER_SLIDE) {
      return { type: 'error', code: 'too-large' };
    }
    totalLines += candidate.lines.length;
    if (totalLines > PPTX_PREVIEW_MAX_TOTAL_LINES) {
      return { type: 'error', code: 'too-large' };
    }

    let slideTextBytes = 0;
    const lines: string[] = [];
    for (const line of candidate.lines) {
      if (typeof line !== 'string') return { type: 'error', code: 'parse' };
      const remainingBytes = Math.min(
        PPTX_PREVIEW_MAX_TEXT_BYTES_PER_SLIDE - slideTextBytes,
        PPTX_PREVIEW_MAX_TOTAL_TEXT_BYTES - totalTextBytes,
      );
      const lineBytes = utf8ByteLength(line, remainingBytes);
      slideTextBytes += lineBytes;
      totalTextBytes += lineBytes;
      if (
        slideTextBytes > PPTX_PREVIEW_MAX_TEXT_BYTES_PER_SLIDE ||
        totalTextBytes > PPTX_PREVIEW_MAX_TOTAL_TEXT_BYTES
      ) {
        return { type: 'error', code: 'too-large' };
      }
      lines.push(line);
    }
    slides.push({ index: position + 1, lines });
  }

  return { type: 'success', slides };
}
