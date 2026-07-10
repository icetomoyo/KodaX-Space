import { extname } from 'node:path';
import type { Readable } from 'node:stream';
import yauzl from 'yauzl';

export interface OfficeZipLimits {
  readonly maxEntries: number;
  readonly maxEntryBytes: number;
  readonly maxTotalBytes: number;
  readonly maxCompressionRatio: number;
  readonly minRatioCheckBytes: number;
}

export const SOURCE_OFFICE_ZIP_LIMITS: OfficeZipLimits = {
  maxEntries: 2_000,
  maxEntryBytes: 16 * 1024 * 1024,
  maxTotalBytes: 40 * 1024 * 1024,
  maxCompressionRatio: 200,
  minRatioCheckBytes: 8 * 1024 * 1024,
};

export const PREVIEW_OFFICE_ZIP_LIMITS: OfficeZipLimits = {
  maxEntries: 4_000,
  maxEntryBytes: 32 * 1024 * 1024,
  maxTotalBytes: 100 * 1024 * 1024,
  maxCompressionRatio: 200,
  minRatioCheckBytes: 8 * 1024 * 1024,
};

export function requiredOpenXmlEntry(path: string): string | null {
  switch (extname(path).toLowerCase()) {
    case '.docx':
    case '.docm':
    case '.dotx':
    case '.dotm':
      return 'word/document.xml';
    case '.xlsx':
    case '.xlsm':
    case '.xltx':
    case '.xltm':
      return 'xl/workbook.xml';
    case '.pptx':
    case '.pptm':
    case '.potx':
    case '.potm':
    case '.ppsx':
    case '.ppsm':
      return 'ppt/presentation.xml';
    default:
      return null;
  }
}

export function validateOfficeZip(
  bytes: Buffer,
  requiredEntry: string,
  limits: OfficeZipLimits = SOURCE_OFFICE_ZIP_LIMITS,
): Promise<void> {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(
      bytes,
      { lazyEntries: true, decodeStrings: true, strictFileNames: true, validateEntrySizes: true },
      (openError, zip) => {
        if (openError || !zip) {
          reject(new Error('invalid Open XML ZIP container'));
          return;
        }
        let settled = false;
        let entries = 0;
        let claimedTotalBytes = 0;
        let claimedCompressedBytes = 0;
        let actualTotalBytes = 0;
        let foundRequiredEntry = false;
        let activeStream: Readable | null = null;
        const names = new Set<string>();
        const fail = (message: string): void => {
          if (settled) return;
          settled = true;
          activeStream?.destroy();
          zip.close();
          reject(new Error(message));
        };
        zip.on('entry', (entry: yauzl.Entry) => {
          if (settled) return;
          entries += 1;
          if (entries > limits.maxEntries) {
            fail(`archive exceeds ${limits.maxEntries} entries`);
            return;
          }
          const name = entry.fileName;
          if (
            !name ||
            name.includes('\\') ||
            name.length > 1_024 ||
            /[\u0000-\u001f\u007f]/.test(name) ||
            name.startsWith('/') ||
            /^[A-Za-z]:/.test(name) ||
            name.split('/').some((segment) => segment === '..')
          ) {
            fail('archive contains an unsafe entry path');
            return;
          }
          const canonicalName = name.normalize('NFC');
          if (names.has(canonicalName)) {
            fail('archive contains duplicate entries');
            return;
          }
          names.add(canonicalName);
          if (entry.generalPurposeBitFlag & 0x1) {
            fail('encrypted Office files are not supported');
            return;
          }
          if (entry.compressionMethod !== 0 && entry.compressionMethod !== 8) {
            fail('archive uses an unsupported compression method');
            return;
          }
          if (entry.uncompressedSize > limits.maxEntryBytes) {
            fail(`archive entry exceeds ${limits.maxEntryBytes} bytes`);
            return;
          }
          claimedTotalBytes += entry.uncompressedSize;
          claimedCompressedBytes += entry.compressedSize;
          if (claimedTotalBytes > limits.maxTotalBytes) {
            fail(`archive expands beyond ${limits.maxTotalBytes} bytes`);
            return;
          }
          if (
            entry.uncompressedSize >= limits.minRatioCheckBytes &&
            (entry.compressedSize === 0 ||
              entry.uncompressedSize / entry.compressedSize > limits.maxCompressionRatio)
          ) {
            fail(
              `archive entry exceeds the ${limits.maxCompressionRatio}:1 compression-ratio limit`,
            );
            return;
          }
          if (
            claimedTotalBytes >= limits.minRatioCheckBytes &&
            (claimedCompressedBytes === 0 ||
              claimedTotalBytes / claimedCompressedBytes > limits.maxCompressionRatio)
          ) {
            fail(
              `archive exceeds the aggregate ${limits.maxCompressionRatio}:1 compression-ratio limit`,
            );
            return;
          }
          if (name === requiredEntry) foundRequiredEntry = true;
          if (name.endsWith('/')) {
            zip.readEntry();
            return;
          }
          zip.openReadStream(entry, (streamError, stream) => {
            if (streamError || !stream) {
              fail('invalid Open XML ZIP container');
              return;
            }
            activeStream = stream;
            let actualEntryBytes = 0;
            stream.on('data', (chunk: Buffer) => {
              actualEntryBytes += chunk.length;
              actualTotalBytes += chunk.length;
              if (
                actualEntryBytes > limits.maxEntryBytes ||
                actualTotalBytes > limits.maxTotalBytes
              ) {
                fail('archive expanded data exceeds configured limits');
              }
            });
            stream.on('error', () => fail('invalid Open XML ZIP container'));
            stream.on('end', () => {
              activeStream = null;
              if (!settled) zip.readEntry();
            });
          });
        });
        zip.on('end', () => {
          if (settled) return;
          settled = true;
          if (!foundRequiredEntry) {
            reject(new Error(`archive is missing ${requiredEntry}`));
            return;
          }
          resolve();
        });
        zip.on('error', () => fail('invalid Open XML ZIP container'));
        zip.readEntry();
      },
    );
  });
}

export async function validateOfficePreviewBytes(path: string, bytes: Buffer): Promise<void> {
  const requiredEntry = requiredOpenXmlEntry(path);
  if (requiredEntry) {
    await validateOfficeZip(bytes, requiredEntry, PREVIEW_OFFICE_ZIP_LIMITS);
  }
}
