import { createHash } from 'node:crypto';
import type { Dirent } from 'node:fs';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { partnerEvidenceUnitSchema } from '@kodax-space/space-ipc-schema';
import { replaceFileWithoutFollowingAliases } from './atomic-file.js';
import { getSpaceDataDir } from './data-paths.js';

const MAX_SNAPSHOT_BYTES = 32 * 1024 * 1024;
const DEFAULT_MAX_PROJECT_SNAPSHOT_BYTES = 1024 * 1024 * 1024;
const MAX_PROJECT_SNAPSHOT_FILES = 100_000;

const snapshotSchema = z.object({
  schemaVersion: z.literal(1),
  projectKey: z.string().min(1).max(4096),
  sourceId: z.string().min(1).max(128),
  sourceVersionId: z.string().min(1).max(128),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  parserGeneration: z.string().min(1).max(64),
  units: z.array(partnerEvidenceUnitSchema).max(10_000),
  warnings: z.array(z.string().min(1).max(300)).max(32),
});

const envelopeSchema = z.object({
  checksum: z.string().regex(/^[a-f0-9]{64}$/),
  snapshot: snapshotSchema,
});

export type PartnerEvidenceSnapshot = z.infer<typeof snapshotSchema>;

function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

function serializedSnapshot(snapshot: PartnerEvidenceSnapshot): string {
  return JSON.stringify(snapshot);
}

function safeRef(snapshot: PartnerEvidenceSnapshot): string {
  const projectBucket = sha256(snapshot.projectKey).slice(0, 24);
  return path.posix.join(projectBucket, `${snapshot.sourceVersionId}.json`);
}

export class PartnerEvidenceSnapshotStore {
  constructor(
    private readonly rootDir: string = path.join(getSpaceDataDir(), 'partner-evidence-snapshots'),
    private readonly maxProjectBytes: number = DEFAULT_MAX_PROJECT_SNAPSHOT_BYTES,
  ) {}

  resolveRef(snapshotRef: string): string {
    if (
      !snapshotRef ||
      snapshotRef.includes('\\') ||
      path.posix.isAbsolute(snapshotRef) ||
      snapshotRef.split('/').some((part) => part === '..' || part === '' || part === '.')
    ) {
      throw new Error('invalid Partner evidence snapshot reference');
    }
    const resolved = path.resolve(this.rootDir, ...snapshotRef.split('/'));
    const relative = path.relative(path.resolve(this.rootDir), resolved);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new Error('Partner evidence snapshot reference escapes its store');
    }
    return resolved;
  }

  async write(input: PartnerEvidenceSnapshot): Promise<string> {
    const snapshot = snapshotSchema.parse(input);
    const snapshotJson = serializedSnapshot(snapshot);
    const envelope = {
      checksum: sha256(snapshotJson),
      snapshot,
    };
    const bytes = Buffer.from(JSON.stringify(envelope), 'utf8');
    if (bytes.byteLength > MAX_SNAPSHOT_BYTES) {
      throw new Error(`Partner evidence snapshot exceeds ${MAX_SNAPSHOT_BYTES} bytes`);
    }
    const ref = safeRef(snapshot);
    const filePath = this.resolveRef(ref);
    await fs.mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });

    try {
      const existing = await this.read(ref);
      if (serializedSnapshot(existing) !== snapshotJson) {
        throw new Error(`immutable Partner evidence snapshot conflict: ${ref}`);
      }
      return ref;
    } catch (error) {
      if (
        !(
          error instanceof Error &&
          'code' in error &&
          (error as { code: string }).code === 'ENOENT'
        )
      ) {
        if (
          error instanceof Error &&
          /immutable Partner evidence snapshot conflict/.test(error.message)
        ) {
          throw error;
        }
        try {
          await fs.access(filePath);
          throw error;
        } catch (accessError) {
          if (
            !(
              accessError instanceof Error &&
              'code' in accessError &&
              (accessError as { code: string }).code === 'ENOENT'
            )
          ) {
            throw error;
          }
        }
      }
    }

    await this.assertProjectBudget(path.dirname(filePath), bytes.byteLength);
    await replaceFileWithoutFollowingAliases(
      filePath,
      bytes,
      'Partner evidence snapshot changed during atomic replacement',
    );
    const readback = await this.read(ref);
    if (serializedSnapshot(readback) !== snapshotJson) {
      throw new Error('Partner evidence snapshot readback verification failed');
    }
    return ref;
  }

  async read(snapshotRef: string): Promise<PartnerEvidenceSnapshot> {
    const bytes = await fs.readFile(this.resolveRef(snapshotRef));
    if (bytes.byteLength > MAX_SNAPSHOT_BYTES) {
      throw new Error('Partner evidence snapshot is corrupt: size limit exceeded');
    }
    let json: unknown;
    try {
      json = JSON.parse(bytes.toString('utf8'));
    } catch (error) {
      throw new Error('Partner evidence snapshot is corrupt: invalid JSON', { cause: error });
    }
    const parsed = envelopeSchema.safeParse(json);
    if (!parsed.success) {
      throw new Error('Partner evidence snapshot is corrupt: invalid schema');
    }
    if (sha256(serializedSnapshot(parsed.data.snapshot)) !== parsed.data.checksum) {
      throw new Error('Partner evidence snapshot is corrupt: checksum mismatch');
    }
    return parsed.data.snapshot;
  }

  close(): void {
    // Reserved for stores that acquire file handles; currently stateless.
  }

  private async assertProjectBudget(
    projectDirectory: string,
    incomingBytes: number,
  ): Promise<void> {
    if (!Number.isSafeInteger(this.maxProjectBytes) || this.maxProjectBytes <= 0) {
      throw new Error('Partner evidence snapshot budget is invalid');
    }
    let entries: Dirent[];
    try {
      entries = await fs.readdir(projectDirectory, { withFileTypes: true });
    } catch (error) {
      if (
        error instanceof Error &&
        'code' in error &&
        (error as NodeJS.ErrnoException).code === 'ENOENT'
      ) {
        entries = [];
      } else {
        throw error;
      }
    }
    if (entries.length >= MAX_PROJECT_SNAPSHOT_FILES) {
      throw new Error('Partner evidence snapshot file budget is exhausted');
    }
    let totalBytes = 0;
    for (const entry of entries) {
      if (!entry.isFile() || entry.isSymbolicLink()) {
        throw new Error('Partner evidence snapshot store contains an unsafe entry');
      }
      totalBytes += (await fs.stat(path.join(projectDirectory, entry.name))).size;
      if (totalBytes + incomingBytes > this.maxProjectBytes) {
        throw new Error('Partner evidence snapshot storage budget is exhausted');
      }
    }
    if (totalBytes + incomingBytes > this.maxProjectBytes) {
      throw new Error('Partner evidence snapshot storage budget is exhausted');
    }
  }
}

export const partnerEvidenceSnapshotStore = new PartnerEvidenceSnapshotStore();
