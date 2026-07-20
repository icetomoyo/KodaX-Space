import { createHash, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  MAX_FILE_BYTES,
  canonProjectRoot,
  type PartnerEvidenceUnitT,
  type PartnerProjectSourceT,
  type PartnerSourceVersionT,
} from '@kodax-space/space-ipc-schema';
import { runPartnerSourceStructuredExtractionWorker } from './partner-source-extraction-runner.js';
import type {
  PartnerSourceExtractionFormat,
  PartnerSourceExtractionResult,
} from './partner-source-extraction-protocol.js';
import { MAX_PARTNER_SOURCE_EVIDENCE_UNITS } from './partner-source-extraction-protocol.js';
import {
  partnerEvidenceSnapshotStore,
  type PartnerEvidenceSnapshot,
  type PartnerEvidenceSnapshotStore,
} from './partner-evidence-snapshot-store.js';
import { partnerKnowledgeIndex, type PartnerKnowledgeIndex } from './partner-knowledge-index.js';
import { partnerSourceStore, type PartnerSourceStore } from './partner-source-store.js';

export const PARTNER_PARSER_GENERATION = 'partner-parser-v2';
export const PARTNER_CHUNKER_GENERATION = 'line-chunker-v1';

const MAX_DIRECTORY_FILES = 512;
const MAX_DIRECTORY_BYTES = 64 * 1024 * 1024;
const MAX_DIRECTORY_DEPTH = 32;
const MAX_TEXT_UNIT_CHARS = 12_000;
const MAX_TEXT_UNIT_LINES = 80;

interface ExtractedSource {
  readonly contentHash: string;
  readonly byteSize: number;
  readonly modifiedAt: number;
  readonly units: readonly PartnerEvidenceUnitT[];
  readonly warnings: readonly string[];
}

export interface PartnerIngestionResult {
  readonly changed: boolean;
  readonly source: PartnerProjectSourceT;
  readonly version?: PartnerSourceVersionT;
}

export interface PartnerSourceIngestionDeps {
  readonly sourceStore?: PartnerSourceStore;
  readonly snapshots?: PartnerEvidenceSnapshotStore;
  readonly index?: PartnerKnowledgeIndex;
}

function sha256(bytes: Buffer | string): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function extractionFormat(filePath: string): PartnerSourceExtractionFormat | null {
  switch (path.extname(filePath).toLocaleLowerCase('en-US')) {
    case '.pdf':
      return 'PDF';
    case '.docx':
      return 'DOCX';
    case '.xlsx':
      return 'XLSX';
    case '.pptx':
      return 'PPTX';
    default:
      return null;
  }
}

function assertNotAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw Object.assign(new Error('Partner source ingestion was cancelled'), {
      code: 'INGESTION_CANCELLED',
    });
  }
}

function unitId(ordinal: number): string {
  return `unit_${String(ordinal + 1).padStart(8, '0')}`;
}

function textUnits(text: string, relativePath?: string): PartnerEvidenceUnitT[] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const units: PartnerEvidenceUnitT[] = [];
  let start = 0;
  while (start < lines.length) {
    let end = start;
    let length = 0;
    while (end < lines.length && end - start < MAX_TEXT_UNIT_LINES) {
      const addition = lines[end]!.length + (end > start ? 1 : 0);
      if (end > start && length + addition > MAX_TEXT_UNIT_CHARS) break;
      length += addition;
      end += 1;
    }
    if (end === start) end += 1;
    const value = lines.slice(start, end).join('\n').slice(0, MAX_TEXT_UNIT_CHARS).trim();
    if (value) {
      const ordinal = units.length;
      units.push({
        id: unitId(ordinal),
        ordinal,
        ...(relativePath ? { relativePath } : {}),
        text: value,
        locator: { kind: 'text_line', startLine: start + 1, endLine: end },
      });
    }
    start = end;
  }
  return units;
}

function strictUtf8(bytes: Buffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch (error) {
    throw new Error('unsupported binary source; no truthful text extractor is available', {
      cause: error,
    });
  }
}

function withRelativePath(
  result: PartnerSourceExtractionResult,
  relativePath?: string,
): PartnerEvidenceUnitT[] {
  return result.units.map((unit) => ({
    ...unit,
    ...(relativePath ? { relativePath } : {}),
  }));
}

async function extractFile(
  filePath: string,
  relativePath: string | undefined,
  signal?: AbortSignal,
): Promise<{
  bytes: Buffer;
  units: PartnerEvidenceUnitT[];
  warnings: string[];
  modifiedAt: number;
}> {
  assertNotAborted(signal);
  const stat = await fs.lstat(filePath);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error('Partner sources must resolve to a regular file without symlinks');
  }
  if (stat.size > MAX_FILE_BYTES) {
    throw new Error(`Partner source exceeds the ${MAX_FILE_BYTES} byte file limit`);
  }
  const bytes = await fs.readFile(filePath);
  assertNotAborted(signal);
  const format = extractionFormat(filePath);
  if (format) {
    const extracted = await runPartnerSourceStructuredExtractionWorker(format, bytes, { signal });
    return {
      bytes,
      units: withRelativePath(extracted, relativePath),
      warnings: [...extracted.warnings],
      modifiedAt: Math.trunc(stat.mtimeMs),
    };
  }
  return {
    bytes,
    units: textUnits(strictUtf8(bytes), relativePath),
    warnings: [],
    modifiedAt: Math.trunc(stat.mtimeMs),
  };
}

async function listDirectoryFiles(root: string, signal?: AbortSignal): Promise<string[]> {
  const files: string[] = [];
  const visit = async (directory: string, depth: number): Promise<void> => {
    assertNotAborted(signal);
    if (depth > MAX_DIRECTORY_DEPTH) {
      throw new Error(`Partner directory source exceeds ${MAX_DIRECTORY_DEPTH} levels`);
    }
    const entries = await fs.readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      if (entry.isSymbolicLink())
        throw new Error('Partner directory sources cannot contain symlinks');
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(target, depth + 1);
      else if (entry.isFile()) {
        files.push(target);
        if (files.length > MAX_DIRECTORY_FILES) {
          throw new Error(`Partner directory source exceeds ${MAX_DIRECTORY_FILES} files`);
        }
      }
    }
  };
  await visit(root, 0);
  return files;
}

async function extractSource(
  projectRoot: string,
  source: PartnerProjectSourceT,
  signal?: AbortSignal,
): Promise<ExtractedSource> {
  const root = path.resolve(projectRoot);
  const absolute = path.resolve(root, ...source.path.split('/'));
  const relative = path.relative(root, absolute);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    if (relative !== '') throw new Error('Partner source path escapes the project');
  }
  const sourceStat = await fs.lstat(absolute);
  if (sourceStat.isSymbolicLink()) throw new Error('Partner sources cannot be symlinks');
  if (source.targetKind === 'file') {
    const extracted = await extractFile(absolute, undefined, signal);
    return {
      contentHash: sha256(extracted.bytes),
      byteSize: extracted.bytes.byteLength,
      modifiedAt: extracted.modifiedAt,
      units: extracted.units,
      warnings: extracted.warnings,
    };
  }
  if (!sourceStat.isDirectory())
    throw new Error('Partner directory source is missing or changed type');

  const filePaths = await listDirectoryFiles(absolute, signal);
  const digest = createHash('sha256');
  const units: PartnerEvidenceUnitT[] = [];
  const warnings: string[] = [];
  let byteSize = 0;
  let modifiedAt = Math.trunc(sourceStat.mtimeMs);
  for (const filePath of filePaths) {
    assertNotAborted(signal);
    const boundedRelativePath = path.relative(absolute, filePath).split(path.sep).join('/');
    const extracted = await extractFile(filePath, boundedRelativePath, signal);
    byteSize += extracted.bytes.byteLength;
    if (byteSize > MAX_DIRECTORY_BYTES) {
      throw new Error(`Partner directory source exceeds ${MAX_DIRECTORY_BYTES} bytes`);
    }
    digest.update(boundedRelativePath).update('\0').update(sha256(extracted.bytes)).update('\0');
    modifiedAt = Math.max(modifiedAt, extracted.modifiedAt);
    warnings.push(...extracted.warnings.map((warning) => `${boundedRelativePath}:${warning}`));
    for (const unit of extracted.units) {
      if (units.length >= MAX_PARTNER_SOURCE_EVIDENCE_UNITS) {
        throw new Error(
          `Partner directory source exceeds ${MAX_PARTNER_SOURCE_EVIDENCE_UNITS} evidence units`,
        );
      }
      const ordinal = units.length;
      units.push({ ...unit, id: unitId(ordinal), ordinal });
    }
  }
  return {
    contentHash: digest.digest('hex'),
    byteSize,
    modifiedAt,
    units,
    warnings: warnings.slice(0, 32),
  };
}

function safeFailure(
  error: unknown,
  projectRoot: string,
): { code: string; message: string; occurredAt: number } {
  const rawCode =
    error instanceof Error &&
    'code' in error &&
    typeof (error as { code?: unknown }).code === 'string'
      ? String((error as { code: string }).code)
      : 'INGESTION_FAILED';
  return {
    code: rawCode.replace(/[^A-Z0-9_]/gi, '_').slice(0, 96) || 'INGESTION_FAILED',
    message: (error instanceof Error ? error.message : String(error))
      .split(projectRoot)
      .join('<project>')
      .replace(/[\r\n\t]+/g, ' ')
      .slice(0, 512),
    occurredAt: Date.now(),
  };
}

export class PartnerSourceIngestionCoordinator {
  private readonly jobs = new Map<string, Promise<PartnerIngestionResult>>();
  private readonly sourceStore: PartnerSourceStore;
  private readonly snapshots: PartnerEvidenceSnapshotStore;
  private readonly index: PartnerKnowledgeIndex;

  constructor(deps: PartnerSourceIngestionDeps = {}) {
    this.sourceStore = deps.sourceStore ?? partnerSourceStore;
    this.snapshots = deps.snapshots ?? partnerEvidenceSnapshotStore;
    this.index = deps.index ?? partnerKnowledgeIndex;
  }

  async inspectFreshness(projectRoot: string, sourceId: string): Promise<PartnerProjectSourceT> {
    const source = await this.sourceStore.getProjectSource(projectRoot, sourceId);
    if (!source) throw new Error(`Unknown Partner source: ${sourceId}`);
    if (source.ingestionStatus === 'indexing') return source;
    const root = path.resolve(projectRoot);
    const absolute = path.resolve(root, ...source.path.split('/'));
    const current = source.currentVersionId
      ? await this.sourceStore.getVersion(source.currentVersionId)
      : null;
    try {
      const stat = await fs.lstat(absolute);
      if (stat.isSymbolicLink()) throw new Error('Partner sources cannot be symlinks');
      if (
        (source.targetKind === 'file' && !stat.isFile()) ||
        (source.targetKind === 'dir' && !stat.isDirectory())
      ) {
        throw Object.assign(new Error('Partner source changed type'), { code: 'ENOTDIR' });
      }
      let modifiedAt = Math.trunc(stat.mtimeMs);
      let byteSize = source.targetKind === 'file' ? stat.size : 0;
      if (source.targetKind === 'dir') {
        const filePaths = await listDirectoryFiles(absolute);
        for (const filePath of filePaths) {
          const fileStat = await fs.lstat(filePath);
          modifiedAt = Math.max(modifiedAt, Math.trunc(fileStat.mtimeMs));
          byteSize += fileStat.size;
        }
      }
      const recovered = source.ingestionStatus === 'unavailable';
      const changed =
        current !== null &&
        (current.byteSize !== byteSize ||
          (current.modifiedAt !== undefined && current.modifiedAt !== modifiedAt));
      if (recovered || changed) {
        return (
          (await this.sourceStore.setIngestionStatus(projectRoot, sourceId, 'stale')) ?? source
        );
      }
      return source;
    } catch (error) {
      const code =
        error instanceof Error && 'code' in error
          ? String((error as NodeJS.ErrnoException).code ?? '')
          : '';
      if (source.targetKind === 'file' && current && ['ENOENT', 'ENOTDIR'].includes(code)) {
        const renamed = await this.findRenamedSibling(projectRoot, source, current.contentHash);
        if (renamed) {
          return (
            (await this.sourceStore.relinkProjectSource(projectRoot, sourceId, renamed)) ?? source
          );
        }
      }
      return (
        (await this.sourceStore.setIngestionStatus(
          projectRoot,
          sourceId,
          'unavailable',
          safeFailure(error, projectRoot),
        )) ?? source
      );
    }
  }

  refresh(
    projectRoot: string,
    sourceId: string,
    options: { readonly signal?: AbortSignal } = {},
  ): Promise<PartnerIngestionResult> {
    const key = `${canonProjectRoot(projectRoot, process.platform === 'win32')}\0${sourceId}`;
    const existing = this.jobs.get(key);
    if (existing) return existing;
    const job = this.runRefresh(projectRoot, sourceId, options.signal).finally(() => {
      if (this.jobs.get(key) === job) this.jobs.delete(key);
    });
    this.jobs.set(key, job);
    return job;
  }

  private async runRefresh(
    projectRoot: string,
    sourceId: string,
    signal?: AbortSignal,
  ): Promise<PartnerIngestionResult> {
    const source = await this.sourceStore.getProjectSource(projectRoot, sourceId);
    if (!source) throw new Error(`Unknown Partner source: ${sourceId}`);
    await this.sourceStore.setIngestionStatus(projectRoot, sourceId, 'indexing');
    try {
      assertNotAborted(signal);
      const extracted = await extractSource(projectRoot, source, signal);
      const current = source.currentVersionId
        ? await this.sourceStore.getVersion(source.currentVersionId)
        : null;
      if (
        current &&
        current.contentHash === extracted.contentHash &&
        current.parserGeneration === PARTNER_PARSER_GENERATION &&
        current.chunkerGeneration === PARTNER_CHUNKER_GENERATION
      ) {
        await this.snapshots.read(current.snapshotRef);
        if (!this.index.hasVersion(projectRoot, current.id)) {
          const snapshot = await this.snapshots.read(current.snapshotRef);
          this.index.commitVersion(
            projectRoot,
            {
              sourceVersionId: current.id,
              sourceId: current.sourceId,
              contentHash: current.contentHash,
              parserGeneration: current.parserGeneration,
            },
            snapshot.units,
          );
        }
        const ready = await this.sourceStore.updateProjectSource(projectRoot, sourceId, {
          ingestionStatus: 'ready',
        });
        if (!ready) throw new Error(`Partner source disappeared during refresh: ${sourceId}`);
        return { changed: false, source: ready, version: current };
      }

      assertNotAborted(signal);
      const versionId = `sv_${randomUUID()}`;
      const snapshot: PartnerEvidenceSnapshot = {
        schemaVersion: 1,
        projectKey: projectRoot,
        sourceId: source.id,
        sourceVersionId: versionId,
        contentHash: extracted.contentHash,
        parserGeneration: PARTNER_PARSER_GENERATION,
        units: [...extracted.units],
        warnings: [...extracted.warnings],
      };
      const snapshotRef = await this.snapshots.write(snapshot);
      assertNotAborted(signal);
      const indexedAt = Date.now();
      this.index.commitVersion(
        projectRoot,
        {
          sourceVersionId: versionId,
          sourceId: source.id,
          contentHash: extracted.contentHash,
          parserGeneration: PARTNER_PARSER_GENERATION,
        },
        snapshot.units,
      );
      assertNotAborted(signal);
      const version = await this.sourceStore.commitVersion({
        id: versionId,
        sourceId: source.id,
        contentHash: extracted.contentHash,
        parserGeneration: PARTNER_PARSER_GENERATION,
        chunkerGeneration: PARTNER_CHUNKER_GENERATION,
        snapshotRef,
        byteSize: extracted.byteSize,
        modifiedAt: extracted.modifiedAt,
        indexedAt,
      });
      const ready = await this.sourceStore.getProjectSource(projectRoot, sourceId);
      if (!ready) throw new Error(`Partner source disappeared during commit: ${sourceId}`);
      return { changed: true, source: ready, version };
    } catch (error) {
      const code =
        error instanceof Error && 'code' in error
          ? String((error as NodeJS.ErrnoException).code ?? '')
          : '';
      const failed = await this.sourceStore.setIngestionStatus(
        projectRoot,
        sourceId,
        ['ENOENT', 'ENOTDIR', 'EACCES', 'EPERM'].includes(code) ? 'unavailable' : 'failed',
        safeFailure(error, projectRoot),
      );
      if (!failed) throw error;
      return { changed: false, source: failed };
    }
  }

  private async findRenamedSibling(
    projectRoot: string,
    source: PartnerProjectSourceT,
    expectedHash: string,
  ): Promise<string | null> {
    const root = path.resolve(projectRoot);
    const previousAbsolute = path.resolve(root, ...source.path.split('/'));
    const parent = path.dirname(previousAbsolute);
    let entries;
    try {
      entries = await fs.readdir(parent, { withFileTypes: true });
    } catch {
      return null;
    }
    const matches: string[] = [];
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      if (!entry.isFile() || entry.isSymbolicLink()) continue;
      const candidate = path.join(parent, entry.name);
      const stat = await fs.lstat(candidate);
      if (stat.size > MAX_FILE_BYTES) continue;
      if (sha256(await fs.readFile(candidate)) !== expectedHash) continue;
      const relative = path.relative(root, candidate);
      if (relative.startsWith('..') || path.isAbsolute(relative)) continue;
      matches.push(relative.split(path.sep).join('/'));
      if (matches.length > 1) return null;
    }
    return matches[0] ?? null;
  }
}

export const partnerSourceIngestion = new PartnerSourceIngestionCoordinator();
