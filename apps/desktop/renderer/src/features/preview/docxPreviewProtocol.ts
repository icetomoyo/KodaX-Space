import { isUtf8WithinLimit } from './previewTextLimits.js';

export const DOCX_PREVIEW_MAX_HTML_BYTES = 4 * 1024 * 1024;
export const DOCX_PREVIEW_MAX_MARKUP_TOKENS = 20_000;

export function isDocxPreviewHtmlWithinLimit(html: string): boolean {
  if (!isUtf8WithinLimit(html, DOCX_PREVIEW_MAX_HTML_BYTES)) return false;

  // Mammoth emits escaped document text, so every literal '<' is markup.
  // Count it linearly before DOMParser can amplify a small string into nodes.
  let markupTokens = 0;
  let cursor = 0;
  while (cursor < html.length) {
    const next = html.indexOf('<', cursor);
    if (next < 0) return true;
    markupTokens += 1;
    if (markupTokens > DOCX_PREVIEW_MAX_MARKUP_TOKENS) return false;
    cursor = next + 1;
  }
  return true;
}

export type DocxPreviewErrorCode = 'decode' | 'convert' | 'too-large';

export interface DocxPreviewParseRequest {
  readonly type: 'parse';
  readonly base64: string;
}

export type DocxPreviewWorkerResponse =
  | {
      readonly type: 'success';
      readonly html: string;
    }
  | {
      readonly type: 'error';
      readonly code: DocxPreviewErrorCode;
    };

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}

/** Validate the structured-cloned Worker message before renderer parsing. */
export function normalizeDocxPreviewWorkerResponse(value: unknown): DocxPreviewWorkerResponse {
  if (!isRecord(value)) return { type: 'error', code: 'convert' };
  if (value.type === 'error') {
    return value.code === 'decode' || value.code === 'convert' || value.code === 'too-large'
      ? { type: 'error', code: value.code }
      : { type: 'error', code: 'convert' };
  }
  if (value.type !== 'success' || typeof value.html !== 'string') {
    return { type: 'error', code: 'convert' };
  }
  if (!isDocxPreviewHtmlWithinLimit(value.html)) {
    return { type: 'error', code: 'too-large' };
  }
  return { type: 'success', html: value.html };
}
