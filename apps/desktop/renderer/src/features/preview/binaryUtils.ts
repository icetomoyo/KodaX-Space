// Binary helpers for F024 rich preview viewers (PDF / docx / xlsx).
// Each viewer receives base64-encoded bytes via IPC and decodes locally.

/** Decode base64 → Uint8Array. Pure browser API (atob); no Buffer/Node deps. */
export function base64ToBytes(base64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(base64);
  const len = binary.length;
  const bytes = new Uint8Array(new ArrayBuffer(len));
  for (let i = 0; i < len; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/** Per-file-type size caps (bytes) — passed to files.readBinary IPC. */
export const PREVIEW_SIZE_CAPS = {
  pdf: 50 * 1024 * 1024, // 50 MB - base64 IPC keeps large documents bounded
  docx: 10 * 1024 * 1024, // 10 MB
  xlsx: 10 * 1024 * 1024, // 10 MB
  image: 50 * 1024 * 1024, // 50 MB
  video: 50 * 1024 * 1024, // 50 MB
  audio: 50 * 1024 * 1024, // 50 MB
  pptx: 25 * 1024 * 1024, // 25 MB - parsed on the renderer thread
  text: 5 * 1024 * 1024, // 5 MB - matches the text read guard class of workload
} as const;

export type RichPreviewKind = keyof typeof PREVIEW_SIZE_CAPS;

function extOf(path: string): string {
  const slash = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  const base = slash >= 0 ? path.slice(slash + 1) : path;
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : '';
}

/** Detect rich preview kind from filename. Returns null for plain text / unknown. */
export function detectKind(path: string): RichPreviewKind | null {
  switch (extOf(path)) {
    case 'pdf':
      return 'pdf';
    case 'docx':
      return 'docx';
    case 'xlsx':
    case 'xls':
      return 'xlsx';
    case 'png':
    case 'jpg':
    case 'jpeg':
    case 'gif':
    case 'webp':
    case 'bmp':
    case 'ico':
    case 'avif':
    case 'svg':
      return 'image';
    case 'mp4':
    case 'm4v':
    case 'mov':
    case 'webm':
    case 'ogv':
    case 'mkv':
    case 'avi':
      return 'video';
    case 'mp3':
    case 'wav':
    case 'm4a':
    case 'aac':
    case 'flac':
    case 'opus':
    case 'ogg':
    case 'oga':
      return 'audio';
    case 'ppt':
    case 'pptx':
    case 'pptm':
    case 'potx':
    case 'potm':
    case 'ppsx':
    case 'ppsm':
      return 'pptx';
    case 'log':
    case 'txt':
    case 'ini':
    case 'cfg':
    case 'conf':
    case 'properties':
    case 'csv':
    case 'tsv':
      return 'text';
    default:
      return null;
  }
}

export function mimeForPath(path: string, kind: RichPreviewKind): string {
  switch (extOf(path)) {
    case 'png':
      return 'image/png';
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'gif':
      return 'image/gif';
    case 'webp':
      return 'image/webp';
    case 'bmp':
      return 'image/bmp';
    case 'ico':
      return 'image/x-icon';
    case 'avif':
      return 'image/avif';
    case 'svg':
      return 'image/svg+xml';
    case 'mp4':
      return 'video/mp4';
    case 'm4v':
      return 'video/x-m4v';
    case 'mov':
      return 'video/quicktime';
    case 'webm':
      return 'video/webm';
    case 'ogv':
      return 'video/ogg';
    case 'ogg':
      return kind === 'audio' ? 'audio/ogg' : 'video/ogg';
    case 'mkv':
      return 'video/x-matroska';
    case 'avi':
      return 'video/x-msvideo';
    case 'mp3':
      return 'audio/mpeg';
    case 'wav':
      return 'audio/wav';
    case 'm4a':
      return 'audio/mp4';
    case 'aac':
      return 'audio/aac';
    case 'flac':
      return 'audio/flac';
    case 'opus':
      return 'audio/opus';
    default:
      return 'application/octet-stream';
  }
}

/** Format bytes for human-readable error messages. */
export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
