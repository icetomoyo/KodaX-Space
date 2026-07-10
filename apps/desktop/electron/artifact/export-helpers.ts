// Pure helpers for artifact export (F059b). Kept separate from the IPC handler
// (which needs electron dialog) so they're unit-testable.

import type { ArtifactKindT } from '@kodax-space/space-ipc-schema';

/** Default file extension for a content-backed artifact kind (sans the image case). */
export function extForKind(kind: ArtifactKindT): string {
  switch (kind) {
    case 'markdown':
      return 'md';
    case 'code':
      return 'txt';
    case 'html':
    case 'interactive-html':
      return 'html';
    case 'svg':
      return 'svg';
    case 'chart':
      return 'json';
    case 'pdf':
      return 'pdf';
    case 'docx':
      return 'docx';
    case 'xlsx':
      return 'xlsx';
    case 'pptx':
      return 'pptx';
    default:
      return 'txt';
  }
}

/** Sanitize an artifact title into a safe default filename (no path/extension). */
export function sanitizeFilename(title: string): string {
  let out = '';
  for (const ch of title) {
    const c = ch.charCodeAt(0);
    // strip path separators, Windows-reserved chars, and control chars
    if ('/\\?%*:|"<>'.includes(ch) || c < 0x20) continue;
    out += ch;
  }
  out = out.replace(/^\.+/, '').replace(/\.+$/, '').trim(); // no leading (hidden) / trailing dots
  return out.slice(0, 120);
}

export interface ParsedDataUri {
  mime: string;
  data: Buffer;
}

/**
 * Parse a data: URI into {mime, bytes}. Returns null if not a valid data URI.
 * Handles arbitrary media-type params before the comma (e.g. `;utf8`, `;charset=…`)
 * and the `;base64` flag. mime = the type/subtype before the first param.
 */
export function parseDataUri(uri: string): ParsedDataUri | null {
  if (!uri.startsWith('data:')) return null;
  const comma = uri.indexOf(',');
  if (comma < 0) return null;
  const header = uri.slice(5, comma); // between 'data:' and ','
  const payload = uri.slice(comma + 1);
  const isBase64 = /(^|;)base64$/i.test(header);
  const mime = header.split(';')[0] || 'text/plain';
  try {
    const data = isBase64
      ? Buffer.from(payload, 'base64')
      : Buffer.from(decodeURIComponent(payload), 'utf8');
    return { mime, data };
  } catch {
    return null;
  }
}

/** File extension for an image MIME. */
export function extForImageMime(mime: string | undefined): string {
  switch (mime) {
    case 'image/png':
      return 'png';
    case 'image/jpeg':
      return 'jpg';
    case 'image/svg+xml':
      return 'svg';
    case 'image/webp':
      return 'webp';
    case 'image/gif':
      return 'gif';
    default:
      return 'png';
  }
}

/** File extension for an image data URI by its MIME. */
export function extForImageDataUri(uri: string): string {
  return extForImageMime(parseDataUri(uri)?.mime);
}
