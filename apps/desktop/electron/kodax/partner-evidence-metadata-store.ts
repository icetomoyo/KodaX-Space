import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import {
  canonProjectRoot,
  partnerKnowledgeTraceSchema,
  type PartnerKnowledgeTraceT,
} from '@kodax-space/space-ipc-schema';
import { replaceFileWithoutFollowingAliases } from './atomic-file.js';
import { getSpaceDataDir } from './data-paths.js';

const MAX_METADATA_RECORD_BYTES = 2 * 1024 * 1024;
const MAX_TRACE_RECORDS_PER_PROJECT = 2_000;
const IS_WINDOWS = process.platform === 'win32';

const citationRecordSchema = z.object({
  citationId: z.string().regex(/^cite_[A-Za-z0-9_-]{8,128}$/),
  sourceId: z.string().regex(/^src_[A-Za-z0-9_-]{8,128}$/),
  sourceVersionId: z.string().regex(/^sv_[A-Za-z0-9_-]{8,128}$/),
  unitId: z.string().regex(/^unit_[A-Za-z0-9_-]{8,128}$/),
  excerptStart: z.number().int().nonnegative(),
  excerptEnd: z.number().int().nonnegative(),
  excerptDigest: z.string().regex(/^[a-f0-9]{64}$/),
  schemaGeneration: z.string().min(1).max(64),
});

const citationPayloadSchema = z.object({
  kind: z.literal('citation'),
  projectKey: z.string().min(1).max(4096),
  record: citationRecordSchema,
});

const tracePayloadSchema = z.object({
  kind: z.literal('trace'),
  projectKey: z.string().min(1).max(4096),
  queryDigest: z.string().regex(/^[a-f0-9]{64}$/),
  trace: partnerKnowledgeTraceSchema,
});

const latestTracePointerSchema = z.object({
  kind: z.literal('latest-trace'),
  projectKey: z.string().min(1).max(4096),
  sessionId: z.string().min(1).max(128),
  traceId: z.string().regex(/^trace_[A-Za-z0-9_-]{8,128}$/),
});

const payloadSchema = z.union([
  citationPayloadSchema,
  tracePayloadSchema,
  latestTracePointerSchema,
]);

const envelopeSchema = z.object({
  checksum: z.string().regex(/^[a-f0-9]{64}$/),
  payload: payloadSchema,
});

export type PartnerCitationMetadataRecord = z.infer<typeof citationRecordSchema>;

export interface PartnerTraceMetadataRecord {
  readonly queryDigest: string;
  readonly trace: PartnerKnowledgeTraceT;
}

function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

function canonicalProjectKey(projectRoot: string): string {
  return canonProjectRoot(projectRoot, IS_WINDOWS);
}

function projectBucket(projectRoot: string): string {
  return sha256(canonicalProjectKey(projectRoot)).slice(0, 32);
}

function safeOpaqueId(value: string, pattern: RegExp, label: string): string {
  if (!pattern.test(value)) throw new Error(`invalid Partner evidence ${label}`);
  return value;
}

export class PartnerEvidenceMetadataStore {
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(
    private readonly rootDir: string = path.join(getSpaceDataDir(), 'partner-evidence-metadata'),
  ) {}

  async writeCitation(projectRoot: string, input: PartnerCitationMetadataRecord): Promise<void> {
    await this.enqueueWrite(async () => {
      const projectKey = canonicalProjectKey(projectRoot);
      const record = citationRecordSchema.parse(input);
      const existing = await this.readCitation(projectRoot, record.citationId);
      if (existing) {
        if (JSON.stringify(existing) !== JSON.stringify(record)) {
          throw new Error('Partner citation metadata identity collision');
        }
        return;
      }
      await this.writeImmutable(
        this.citationPath(projectRoot, record.citationId),
        citationPayloadSchema.parse({ kind: 'citation', projectKey, record }),
      );
    });
  }

  async readCitation(
    projectRoot: string,
    citationId: string,
  ): Promise<PartnerCitationMetadataRecord | null> {
    const payload = await this.read(this.citationPath(projectRoot, citationId));
    if (!payload) return null;
    if (
      payload.kind !== 'citation' ||
      payload.projectKey !== canonicalProjectKey(projectRoot) ||
      payload.record.citationId !== citationId
    ) {
      throw new Error('Partner citation metadata identity mismatch');
    }
    return payload.record;
  }

  async writeTrace(projectRoot: string, record: PartnerTraceMetadataRecord): Promise<void> {
    await this.enqueueWrite(async () => {
      const projectKey = canonicalProjectKey(projectRoot);
      const payload = tracePayloadSchema.parse({
        kind: 'trace',
        projectKey,
        queryDigest: record.queryDigest,
        trace: record.trace,
      });
      await this.writeImmutable(this.tracePath(projectRoot, record.trace.traceId), payload);
      await this.writeMutable(
        this.latestTracePath(projectRoot, record.trace.sessionId),
        latestTracePointerSchema.parse({
          kind: 'latest-trace',
          projectKey,
          sessionId: record.trace.sessionId,
          traceId: record.trace.traceId,
        }),
      );
      await this.pruneOldTraces(projectRoot);
    });
  }

  async readTrace(
    projectRoot: string,
    traceId: string,
  ): Promise<PartnerTraceMetadataRecord | null> {
    const payload = await this.read(this.tracePath(projectRoot, traceId));
    if (!payload) return null;
    if (
      payload.kind !== 'trace' ||
      payload.projectKey !== canonicalProjectKey(projectRoot) ||
      payload.trace.traceId !== traceId
    ) {
      throw new Error('Partner trace metadata identity mismatch');
    }
    return { queryDigest: payload.queryDigest, trace: payload.trace };
  }

  async readLatestTrace(
    projectRoot: string,
    sessionId: string,
  ): Promise<PartnerTraceMetadataRecord | null> {
    const pointer = await this.read(this.latestTracePath(projectRoot, sessionId));
    if (!pointer) return null;
    if (
      pointer.kind !== 'latest-trace' ||
      pointer.projectKey !== canonicalProjectKey(projectRoot) ||
      pointer.sessionId !== sessionId
    ) {
      throw new Error('Partner latest-trace pointer identity mismatch');
    }
    return this.readTrace(projectRoot, pointer.traceId);
  }

  private citationPath(projectRoot: string, citationId: string): string {
    const id = safeOpaqueId(citationId, /^cite_[A-Za-z0-9_-]{8,128}$/, 'citation id');
    return path.join(this.rootDir, projectBucket(projectRoot), 'citations', `${id}.json`);
  }

  private tracePath(projectRoot: string, traceId: string): string {
    const id = safeOpaqueId(traceId, /^trace_[A-Za-z0-9_-]{8,128}$/, 'trace id');
    return path.join(this.rootDir, projectBucket(projectRoot), 'traces', `${id}.json`);
  }

  private latestTracePath(projectRoot: string, sessionId: string): string {
    if (!sessionId || sessionId.length > 128)
      throw new Error('invalid Partner evidence session id');
    return path.join(
      this.rootDir,
      projectBucket(projectRoot),
      'latest-traces',
      `${sha256(sessionId)}.json`,
    );
  }

  private enqueueWrite<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.writeQueue.then(operation, operation);
    this.writeQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private async writeImmutable(
    filePath: string,
    payload: z.infer<typeof payloadSchema>,
  ): Promise<void> {
    const serialized = JSON.stringify(payload);
    const existing = await this.read(filePath);
    if (existing) {
      if (JSON.stringify(existing) !== serialized) {
        throw new Error('immutable Partner evidence metadata conflict');
      }
      return;
    }
    await this.replaceAndVerify(filePath, payload);
  }

  private async writeMutable(
    filePath: string,
    payload: z.infer<typeof payloadSchema>,
  ): Promise<void> {
    await this.replaceAndVerify(filePath, payload);
  }

  private async replaceAndVerify(
    filePath: string,
    payload: z.infer<typeof payloadSchema>,
  ): Promise<void> {
    const payloadJson = JSON.stringify(payload);
    const bytes = Buffer.from(JSON.stringify({ checksum: sha256(payloadJson), payload }), 'utf8');
    if (bytes.byteLength > MAX_METADATA_RECORD_BYTES) {
      throw new Error('Partner evidence metadata record exceeds its size limit');
    }
    await fs.mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
    await replaceFileWithoutFollowingAliases(
      filePath,
      bytes,
      'Partner evidence metadata changed during atomic replacement',
    );
    const readback = await this.read(filePath);
    if (!readback || JSON.stringify(readback) !== payloadJson) {
      throw new Error('Partner evidence metadata readback verification failed');
    }
  }

  private async read(filePath: string): Promise<z.infer<typeof payloadSchema> | null> {
    let bytes: Buffer;
    try {
      bytes = await fs.readFile(filePath);
    } catch (error) {
      if (
        error instanceof Error &&
        'code' in error &&
        (error as NodeJS.ErrnoException).code === 'ENOENT'
      ) {
        return null;
      }
      throw error;
    }
    if (bytes.byteLength > MAX_METADATA_RECORD_BYTES) {
      throw new Error('Partner evidence metadata is corrupt: size limit exceeded');
    }
    let json: unknown;
    try {
      json = JSON.parse(bytes.toString('utf8'));
    } catch (error) {
      throw new Error('Partner evidence metadata is corrupt: invalid JSON', { cause: error });
    }
    const parsed = envelopeSchema.safeParse(json);
    if (!parsed.success) throw new Error('Partner evidence metadata is corrupt: invalid schema');
    if (sha256(JSON.stringify(parsed.data.payload)) !== parsed.data.checksum) {
      throw new Error('Partner evidence metadata is corrupt: checksum mismatch');
    }
    return parsed.data.payload;
  }

  private async pruneOldTraces(projectRoot: string): Promise<void> {
    const directory = path.join(this.rootDir, projectBucket(projectRoot), 'traces');
    let names: string[];
    try {
      names = (await fs.readdir(directory)).filter((name) =>
        /^trace_[A-Za-z0-9_-]{8,128}\.json$/.test(name),
      );
    } catch (error) {
      if (
        error instanceof Error &&
        'code' in error &&
        (error as NodeJS.ErrnoException).code === 'ENOENT'
      ) {
        return;
      }
      throw error;
    }
    if (names.length <= MAX_TRACE_RECORDS_PER_PROJECT) return;
    const records = await Promise.all(
      names.map(async (name) => ({ name, stat: await fs.stat(path.join(directory, name)) })),
    );
    records.sort(
      (left, right) =>
        left.stat.mtimeMs - right.stat.mtimeMs || left.name.localeCompare(right.name),
    );
    await Promise.all(
      records
        .slice(0, records.length - MAX_TRACE_RECORDS_PER_PROJECT)
        .map(({ name }) => fs.unlink(path.join(directory, name)).catch(() => undefined)),
    );
  }
}

export const partnerEvidenceMetadataStore = new PartnerEvidenceMetadataStore();
