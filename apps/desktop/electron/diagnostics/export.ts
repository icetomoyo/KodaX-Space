import { lstat, open, readdir } from 'node:fs/promises';
import path from 'node:path';
import JSZip from 'jszip';
import type { DiagnosticsExportCategory } from '@kodax-space/space-ipc-schema';
import { redactDiagnosticText, redactDiagnosticValue } from './redaction.js';

const DEFAULT_CATEGORIES: readonly DiagnosticsExportCategory[] = [
  'manifest',
  'logs',
  'capabilities',
  'release',
  'degradations',
];
const LOG_FILE_PATTERN = /^space-main(?:\.\d+)?\.jsonl$/;

export interface DiagnosticBundleOptions {
  readonly logDirectory: string;
  readonly spaceVersion: string;
  readonly sdkVersion: string;
  readonly platform: string;
  readonly categories?: readonly DiagnosticsExportCategory[];
  readonly capabilities?: unknown;
  readonly release?: unknown;
  readonly degradations?: unknown;
  readonly secretValues?: readonly string[];
  readonly privatePathPrefixes?: readonly string[];
  readonly maxLogFileBytes?: number;
  readonly maxTotalLogBytes?: number;
  readonly now?: () => Date;
}

function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function sanitizeLogContent(
  content: string,
  options: Pick<DiagnosticBundleOptions, 'secretValues' | 'privatePathPrefixes'>,
  maxBytes: number,
): { readonly content: string; readonly truncated: boolean } {
  const lines: string[] = [];
  let bytes = 0;
  let truncated = false;
  for (const rawLine of content.split(/\r?\n/)) {
    if (!rawLine.trim()) continue;
    let line: string;
    try {
      line = JSON.stringify(
        redactDiagnosticValue(JSON.parse(rawLine) as unknown, {
          secretValues: options.secretValues,
          privatePathPrefixes: options.privatePathPrefixes,
          maxStringLength: 16 * 1024,
        }),
      );
    } catch {
      line = JSON.stringify({
        level: 'warn',
        component: 'diagnostics',
        event: 'corrupt-log-line',
        message: redactDiagnosticText(rawLine, {
          secretValues: options.secretValues,
          privatePathPrefixes: options.privatePathPrefixes,
          maxStringLength: 2048,
        }),
      });
    }
    const lineBytes = Buffer.byteLength(line) + 1;
    if (bytes + lineBytes > maxBytes) {
      truncated = true;
      break;
    }
    lines.push(line);
    bytes += lineBytes;
  }
  return {
    content: lines.length > 0 ? `${lines.join('\n')}\n` : '',
    truncated,
  };
}

function logRecency(name: string): number {
  if (name === 'space-main.jsonl') return 0;
  const match = /^space-main\.(\d+)\.jsonl$/.exec(name);
  return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
}

async function readTail(filePath: string, fileSize: number, maxBytes: number): Promise<Buffer> {
  const take = Math.min(fileSize, maxBytes);
  if (take <= 0) return Buffer.alloc(0);
  const handle = await open(filePath, 'r');
  try {
    const buffer = Buffer.alloc(take);
    let offset = 0;
    while (offset < take) {
      const result = await handle.read(buffer, offset, take - offset, fileSize - take + offset);
      if (result.bytesRead === 0) break;
      offset += result.bytesRead;
    }
    return buffer.subarray(0, offset);
  } finally {
    await handle.close();
  }
}

export async function buildDiagnosticBundle(options: DiagnosticBundleOptions): Promise<Uint8Array> {
  const categories = [...new Set(options.categories ?? DEFAULT_CATEGORIES)];
  const included = new Set(categories);
  const now = options.now?.() ?? new Date();
  const zip = new JSZip();
  const notices: string[] = [];

  if (included.has('logs')) {
    const maxFileBytes = Math.max(1024, options.maxLogFileBytes ?? 1024 * 1024);
    const maxTotalBytes = Math.max(maxFileBytes, options.maxTotalLogBytes ?? 5 * 1024 * 1024);
    let totalBytes = 0;
    let names: string[] = [];
    try {
      names = (await readdir(options.logDirectory))
        .filter((name) => LOG_FILE_PATTERN.test(name))
        .sort((a, b) => logRecency(a) - logRecency(b));
    } catch {
      notices.push('logs-unavailable');
    }
    for (const name of names) {
      if (totalBytes >= maxTotalBytes) {
        notices.push('logs-total-cap-reached');
        break;
      }
      const filePath = path.join(options.logDirectory, name);
      try {
        const info = await lstat(filePath);
        if (!info.isFile()) continue;
        const remaining = maxTotalBytes - totalBytes;
        const take = Math.min(info.size, maxFileBytes, remaining);
        if (take <= 0) break;
        const bytes = await readTail(filePath, info.size, take);
        const truncated = info.size > bytes.byteLength;
        let content = bytes.toString('utf8');
        if (truncated) {
          const firstNewline = content.indexOf('\n');
          if (firstNewline >= 0) content = content.slice(firstNewline + 1);
          notices.push(`log-truncated:${name}`);
        }
        const sanitized = sanitizeLogContent(content, options, Math.min(maxFileBytes, remaining));
        if (sanitized.truncated) notices.push(`log-sanitized-cap-reached:${name}`);
        zip.file(`logs/${name}`, sanitized.content);
        totalBytes += Buffer.byteLength(sanitized.content);
      } catch {
        notices.push(`log-unreadable:${name}`);
      }
    }
  }

  const redact = (value: unknown): unknown =>
    redactDiagnosticValue(value, {
      secretValues: options.secretValues,
      privatePathPrefixes: options.privatePathPrefixes,
      maxStringLength: 16 * 1024,
    });

  if (included.has('capabilities')) {
    zip.file('capabilities.json', json(redact(options.capabilities ?? { unavailable: true })));
  }
  if (included.has('release')) {
    zip.file('release.json', json(redact(options.release ?? { unavailable: true })));
  }
  if (included.has('degradations')) {
    zip.file(
      'known-degradations.json',
      json(redact(options.degradations ?? { unavailable: true })),
    );
  }
  if (included.has('manifest')) {
    zip.file(
      'manifest.json',
      json({
        formatVersion: 1,
        generatedAt: now.toISOString(),
        spaceVersion: options.spaceVersion,
        sdkVersion: options.sdkVersion,
        platform: options.platform,
        categories,
        notices,
        remoteUpload: false,
      }),
    );
  }

  return zip.generateAsync({
    type: 'uint8array',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
    platform: 'UNIX',
  });
}
