import mammoth from 'mammoth';
import { base64ToBytes } from './binaryUtils.js';
import {
  isDocxPreviewHtmlWithinLimit,
  type DocxPreviewWorkerResponse,
} from './docxPreviewProtocol.js';

/** Decode and convert a DOCX entirely inside the disposable preview Worker. */
export async function parseDocxPreviewBase64(base64: string): Promise<DocxPreviewWorkerResponse> {
  let bytes: Uint8Array<ArrayBuffer>;
  try {
    bytes = base64ToBytes(base64);
  } catch {
    return { type: 'error', code: 'decode' };
  }

  try {
    const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    // Vite resolves mammoth's browser unzip implementation (arrayBuffer). The
    // Uint8Array alias also keeps this pure parser executable under Node tests,
    // where mammoth's Node unzip implementation reads the `buffer` field.
    const input = { arrayBuffer, buffer: bytes } as unknown as Parameters<
      typeof mammoth.convertToHtml
    >[0];
    const result = await mammoth.convertToHtml(input);
    if (!isDocxPreviewHtmlWithinLimit(result.value)) {
      return { type: 'error', code: 'too-large' };
    }
    return { type: 'success', html: result.value };
  } catch {
    return { type: 'error', code: 'convert' };
  }
}
