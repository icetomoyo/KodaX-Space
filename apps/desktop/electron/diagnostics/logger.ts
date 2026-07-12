import { appendFile, mkdir, readFile, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import {
  redactDiagnosticText,
  redactDiagnosticValue,
  type DiagnosticRedactionOptions,
} from './redaction.js';

export type DiagnosticLogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface StructuredLoggerOptions extends DiagnosticRedactionOptions {
  readonly directory: string;
  readonly version: string;
  readonly sdkVersion: string;
  readonly platform?: string;
  readonly maxFileBytes?: number;
  readonly retentionFiles?: number;
  readonly maxRecordBytes?: number;
  readonly maxPendingRecords?: number;
  readonly now?: () => Date;
  readonly fallback?: (level: DiagnosticLogLevel, message: string) => void;
}

interface DiagnosticRecord {
  readonly timestamp: string;
  readonly level: DiagnosticLogLevel;
  readonly component: string;
  readonly event: string;
  readonly version: string;
  readonly sdkVersion: string;
  readonly platform: string;
  readonly message?: string;
  readonly data?: unknown;
  readonly droppedRecords?: number;
}

const ACTIVE_LOG = 'space-main.jsonl';

function rotatedLog(index: number): string {
  return `space-main.${index}.jsonl`;
}

function safeIdentifier(value: string, fallback: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .slice(0, 80);
  return normalized || fallback;
}

export class StructuredLogger {
  private readonly directory: string;
  private readonly activePath: string;
  private readonly version: string;
  private readonly sdkVersion: string;
  private readonly platform: string;
  private readonly maxFileBytes: number;
  private readonly retentionFiles: number;
  private readonly maxRecordBytes: number;
  private readonly maxPendingRecords: number;
  private readonly now: () => Date;
  private readonly fallback?: (level: DiagnosticLogLevel, message: string) => void;
  private redaction: DiagnosticRedactionOptions;
  private queue: Promise<void> = Promise.resolve();
  private initialized = false;
  private activeBytes = 0;
  private pendingRecords = 0;
  private droppedRecords = 0;

  constructor(options: StructuredLoggerOptions) {
    this.directory = path.resolve(options.directory);
    this.activePath = path.join(this.directory, ACTIVE_LOG);
    this.version = options.version;
    this.sdkVersion = options.sdkVersion;
    this.platform = options.platform ?? process.platform;
    this.maxFileBytes = Math.max(256, options.maxFileBytes ?? 5 * 1024 * 1024);
    this.retentionFiles = Math.max(0, options.retentionFiles ?? 5);
    this.maxRecordBytes = Math.max(512, options.maxRecordBytes ?? 16 * 1024);
    this.maxPendingRecords = Math.max(8, options.maxPendingRecords ?? 1024);
    this.now = options.now ?? (() => new Date());
    this.fallback = options.fallback;
    this.redaction = {
      secretValues: options.secretValues,
      privatePathPrefixes: options.privatePathPrefixes,
      maxDepth: options.maxDepth,
      maxArrayItems: options.maxArrayItems,
      maxStringLength: options.maxStringLength,
      maxObjectKeys: options.maxObjectKeys,
    };
  }

  debug(component: string, event: string, message?: string, data?: unknown): void {
    this.log('debug', component, event, message, data);
  }

  info(component: string, event: string, message?: string, data?: unknown): void {
    this.log('info', component, event, message, data);
  }

  warn(component: string, event: string, message?: string, data?: unknown): void {
    this.log('warn', component, event, message, data);
  }

  error(component: string, event: string, message?: string, data?: unknown): void {
    this.log('error', component, event, message, data);
  }

  log(
    level: DiagnosticLogLevel,
    component: string,
    event: string,
    message?: string,
    data?: unknown,
  ): void {
    if (this.pendingRecords >= this.maxPendingRecords) {
      this.droppedRecords += 1;
      return;
    }
    const droppedRecords = this.droppedRecords;
    this.droppedRecords = 0;
    const record: DiagnosticRecord = {
      timestamp: this.now().toISOString(),
      level,
      component: safeIdentifier(component, 'unknown'),
      event: safeIdentifier(event, 'event'),
      version: this.version,
      sdkVersion: this.sdkVersion,
      platform: this.platform,
      ...(message !== undefined ? { message: redactDiagnosticText(message, this.redaction) } : {}),
      ...(data !== undefined ? { data: redactDiagnosticValue(data, this.redaction) } : {}),
      ...(droppedRecords > 0 ? { droppedRecords } : {}),
    };
    this.pendingRecords += 1;
    this.queue = this.queue
      .then(() => this.writeRecord(record))
      .catch((error: unknown) => {
        this.fallback?.(
          level,
          `structured log write failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      })
      .finally(() => {
        this.pendingRecords -= 1;
      });
  }

  async flush(): Promise<void> {
    await this.queue;
  }

  updateRedactionOptions(options: DiagnosticRedactionOptions): void {
    this.redaction = { ...this.redaction, ...options };
  }

  async readActiveLog(): Promise<string> {
    await this.flush();
    return readFile(this.activePath, 'utf8');
  }

  private async initialize(): Promise<void> {
    if (this.initialized) return;
    await mkdir(this.directory, { recursive: true });
    try {
      this.activeBytes = (await stat(this.activePath)).size;
    } catch {
      this.activeBytes = 0;
    }
    this.initialized = true;
  }

  private serialize(record: DiagnosticRecord): string {
    let line = `${JSON.stringify(record)}\n`;
    if (Buffer.byteLength(line) <= this.maxRecordBytes) return line;
    const bounded: DiagnosticRecord = {
      ...record,
      message: redactDiagnosticText(record.message ?? '[RECORD_TRUNCATED]', {
        ...this.redaction,
        maxStringLength: 256,
      }),
      data: '[RECORD_TRUNCATED]',
    };
    line = `${JSON.stringify(bounded)}\n`;
    if (Buffer.byteLength(line) <= this.maxRecordBytes) return line;
    return `${JSON.stringify({
      timestamp: record.timestamp,
      level: record.level,
      component: record.component,
      event: record.event,
      message: '[RECORD_TRUNCATED]',
    })}\n`;
  }

  private async writeRecord(record: DiagnosticRecord): Promise<void> {
    await this.initialize();
    const line = this.serialize(record);
    const bytes = Buffer.byteLength(line);
    if (this.activeBytes > 0 && this.activeBytes + bytes > this.maxFileBytes) {
      await this.rotate();
    }
    await appendFile(this.activePath, line, { encoding: 'utf8', mode: 0o600 });
    this.activeBytes += bytes;
  }

  private async rotate(): Promise<void> {
    if (this.retentionFiles === 0) {
      await rm(this.activePath, { force: true });
      this.activeBytes = 0;
      return;
    }
    await rm(path.join(this.directory, rotatedLog(this.retentionFiles)), { force: true });
    for (let index = this.retentionFiles - 1; index >= 1; index -= 1) {
      try {
        await rename(
          path.join(this.directory, rotatedLog(index)),
          path.join(this.directory, rotatedLog(index + 1)),
        );
      } catch (error) {
        const code =
          error && typeof error === 'object' && 'code' in error
            ? String((error as { code?: unknown }).code)
            : '';
        if (code !== 'ENOENT') throw error;
      }
    }
    try {
      await rename(this.activePath, path.join(this.directory, rotatedLog(1)));
    } catch (error) {
      const code =
        error && typeof error === 'object' && 'code' in error
          ? String((error as { code?: unknown }).code)
          : '';
      if (code !== 'ENOENT') throw error;
    }
    this.activeBytes = 0;
  }
}
