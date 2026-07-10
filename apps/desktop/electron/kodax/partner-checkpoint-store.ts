import { createHash, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import {
  MAX_PARTNER_CHECKPOINT_DIFF_BYTES,
  MAX_PARTNER_DELIVERY_INLINE_BYTES,
  partnerCheckpointSchema,
  type PartnerCheckpointStatusT,
  type PartnerCheckpointT,
} from '@kodax-space/space-ipc-schema';
import {
  isPathInside,
  looksBinary,
  recordDiff,
  toPosixRelative,
  truncate,
} from '../ipc/files-core.js';
import { getSpaceDataDir } from './data-paths.js';
import {
  removeFileIfUnchanged,
  replaceFileIfUnchanged,
  replaceFileWithoutFollowingAliases,
  writeNewFileExclusive,
} from './atomic-file.js';
import { assertPartnerWritablePathNotSensitive } from './partner-file-guards.js';

const MAX_CHECKPOINTS = 20_000;
const PARTNER_CHECKPOINTS_DIR = path.join(getSpaceDataDir(), 'partner-checkpoints');

const fileSchema = z.object({
  version: z.literal(1),
  checkpoints: z.array(partnerCheckpointSchema).max(MAX_CHECKPOINTS),
});

type PartnerCheckpointsFile = z.infer<typeof fileSchema>;

export interface PartnerCheckpointListFilter {
  readonly sessionId?: string;
  readonly projectRoot?: string;
  readonly status?: PartnerCheckpointStatusT;
}

export interface PartnerWorkspaceWriteInput {
  readonly sessionId: string;
  readonly projectRoot: string;
  readonly relativePath: string;
  readonly bytes: Buffer;
  readonly producer: string;
}

export interface PartnerWorkspaceWriteResult {
  readonly checkpoint: PartnerCheckpointT;
  readonly absolutePath: string;
}

export interface PartnerCheckpointRollbackResult {
  readonly ok: boolean;
  readonly checkpoint?: PartnerCheckpointT;
  readonly error?: string;
}

export interface PartnerCheckpointStoreHooks {
  readonly beforeWorkspaceCommit?: (absolutePath: string) => Promise<void> | void;
}

function sha256Bytes(bytes: Buffer): string {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function hasControlChar(value: string): boolean {
  return /[\x00\r\n]/.test(value);
}

function normalizeWorkspaceRelativePath(input: string): string {
  if (hasControlChar(input)) throw new Error('workspace path contains control characters');
  const unified = input.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '');
  const parts = unified.split('/').filter((part) => part.length > 0);
  if (parts.length === 0) throw new Error('workspace path is required');
  for (const part of parts) {
    if (part === '.' || part === '..')
      throw new Error('workspace path cannot contain dot segments');
  }
  assertPartnerWritablePathNotSensitive(parts, 'workspace path');
  return parts.join('/');
}

async function atomicWriteJson(filePath: string, value: PartnerCheckpointsFile): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  await replaceFileWithoutFollowingAliases(
    filePath,
    Buffer.from(JSON.stringify(value, null, 2), 'utf8'),
    'Partner checkpoint registry changed during atomic replacement',
  );
}

async function assertNoSymlinkAncestors(
  rootPath: string,
  relativePath: string,
  label: string,
): Promise<void> {
  let current = path.resolve(rootPath);
  for (const part of relativePath.split('/').slice(0, -1)) {
    current = path.join(current, part);
    try {
      const stat = await fs.lstat(current);
      if (stat.isSymbolicLink()) throw new Error(label + ' cannot traverse a symbolic link parent');
      if (!stat.isDirectory()) throw new Error(label + ' parent is not a directory');
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') return;
      throw err;
    }
  }
}

async function atomicWriteFile(filePath: string, bytes: Buffer): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  await writeNewFileExclusive(
    filePath,
    bytes,
    'Partner checkpoint snapshot changed before exclusive creation',
  );
}

function cloneCheckpoints(items: readonly PartnerCheckpointT[]): PartnerCheckpointT[] {
  return items.map((item) => ({
    ...item,
    ...(item.diff ? { diff: { ...item.diff } } : {}),
  }));
}

function capText(text: string): { value: string; truncated: boolean } {
  const bytes = Buffer.byteLength(text, 'utf8');
  if (bytes <= MAX_PARTNER_CHECKPOINT_DIFF_BYTES) {
    return { value: text, truncated: false };
  }
  return {
    value: `${Buffer.from(text, 'utf8')
      .subarray(0, MAX_PARTNER_CHECKPOINT_DIFF_BYTES)
      .toString('utf8')}\n[truncated]`,
    truncated: true,
  };
}

function buildTextDiff(
  relativePath: string,
  before: Buffer | null,
  after: Buffer,
): PartnerCheckpointT['diff'] | undefined {
  if ((before && looksBinary(before)) || looksBinary(after)) return undefined;
  const beforeText = before ? before.toString('utf8') : '';
  const afterText = after.toString('utf8');
  const beforeCap = capText(beforeText);
  const afterCap = capText(afterText);
  const unifiedRaw = [
    `--- a/${relativePath}`,
    `+++ b/${relativePath}`,
    '@@ partner checkpoint @@',
    beforeText.length > 0 ? beforeText : '[new file]',
    '--- after ---',
    afterText,
  ].join('\n');
  const unifiedCap = capText(unifiedRaw);
  return {
    before: beforeCap.value,
    after: afterCap.value,
    unified: unifiedCap.value,
    truncated: beforeCap.truncated || afterCap.truncated || unifiedCap.truncated,
  };
}

async function readExistingBytes(absPath: string): Promise<Buffer | null> {
  try {
    const stat = await fs.lstat(absPath);
    if (stat.isSymbolicLink()) throw new Error('workspace target cannot be a symbolic link');
    if (!stat.isFile()) throw new Error('workspace target is not a regular file');
    if (stat.size > MAX_PARTNER_DELIVERY_INLINE_BYTES) {
      throw new Error(`workspace target exceeds ${MAX_PARTNER_DELIVERY_INLINE_BYTES} bytes`);
    }
    return fs.readFile(absPath);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'ENOTDIR') return null;
    throw err;
  }
}

async function resolveWorkspaceTarget(
  projectRoot: string,
  relativePath: string,
): Promise<{
  realRoot: string;
  relativePath: string;
  absolutePath: string;
}> {
  const realRoot = await fs.realpath(path.resolve(projectRoot));
  const normalized = normalizeWorkspaceRelativePath(relativePath);
  const absolutePath = path.resolve(realRoot, ...normalized.split('/'));
  if (!isPathInside(absolutePath, realRoot)) {
    throw new Error(`workspace path escapes project root: ${truncate(relativePath)}`);
  }
  return { realRoot, relativePath: toPosixRelative(absolutePath, realRoot), absolutePath };
}

export class PartnerCheckpointStore {
  private cached: PartnerCheckpointT[] | null = null;
  private writeLock: Promise<void> = Promise.resolve();

  constructor(
    private readonly filePath: string = path.join(getSpaceDataDir(), 'partner-checkpoints.json'),
    private readonly checkpointsDir: string = PARTNER_CHECKPOINTS_DIR,
    private readonly hooks: PartnerCheckpointStoreHooks = {},
  ) {}

  async list(filter: PartnerCheckpointListFilter = {}): Promise<PartnerCheckpointT[]> {
    const all = await this.load();
    return all
      .filter((checkpoint) => {
        if (filter.sessionId !== undefined && checkpoint.sessionId !== filter.sessionId)
          return false;
        if (filter.projectRoot !== undefined && checkpoint.projectRoot !== filter.projectRoot)
          return false;
        if (filter.status !== undefined && checkpoint.status !== filter.status) return false;
        return true;
      })
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map((item) => ({ ...item, ...(item.diff ? { diff: { ...item.diff } } : {}) }));
  }

  async get(id: string): Promise<PartnerCheckpointT | null> {
    const all = await this.load();
    const found = all.find((checkpoint) => checkpoint.id === id);
    return found ? { ...found, ...(found.diff ? { diff: { ...found.diff } } : {}) } : null;
  }

  async writeWorkspaceFile(
    input: PartnerWorkspaceWriteInput,
  ): Promise<PartnerWorkspaceWriteResult> {
    if (input.bytes.length > MAX_PARTNER_DELIVERY_INLINE_BYTES) {
      throw new Error(`workspace content exceeds ${MAX_PARTNER_DELIVERY_INLINE_BYTES} bytes`);
    }
    // Refuse side effects when durable checkpoint metadata cannot be trusted.
    await this.load();
    const target = await resolveWorkspaceTarget(input.projectRoot, input.relativePath);
    await assertNoSymlinkAncestors(target.realRoot, target.relativePath, 'workspace path');
    const parent = path.dirname(target.absolutePath);
    await fs.mkdir(parent, { recursive: true, mode: 0o700 });
    const realParent = await fs.realpath(parent);
    if (!isPathInside(realParent, target.realRoot)) {
      throw new Error('workspace path escapes project root via symlink parent');
    }

    const beforeBytes = await readExistingBytes(target.absolutePath);
    const operation = beforeBytes === null ? 'create' : 'update';
    const checkpointId = `pc_${randomUUID()}`;
    const checkpointDir = path.join(this.checkpointsDir, checkpointId);
    const beforeSnapshotPath =
      beforeBytes === null ? undefined : path.join(checkpointDir, 'before.bin');
    if (beforeBytes !== null && beforeSnapshotPath !== undefined) {
      await atomicWriteFile(beforeSnapshotPath, beforeBytes);
    }

    const diff = buildTextDiff(target.relativePath, beforeBytes, input.bytes);
    const now = Date.now();
    const checkpoint = partnerCheckpointSchema.parse({
      id: checkpointId,
      sessionId: input.sessionId,
      projectRoot: path.resolve(input.projectRoot),
      rootPath: target.realRoot,
      absolutePath: target.absolutePath,
      relativePath: target.relativePath,
      operation,
      status: 'active',
      beforeHash: beforeBytes ? sha256Bytes(beforeBytes) : null,
      beforeSizeBytes: beforeBytes ? beforeBytes.length : null,
      ...(beforeSnapshotPath !== undefined ? { beforeSnapshotPath } : {}),
      afterHash: sha256Bytes(input.bytes),
      afterSizeBytes: input.bytes.length,
      producer: input.producer.slice(0, 128),
      ...(diff !== undefined ? { diff } : {}),
      createdAt: now,
      updatedAt: now,
    });
    await this.mutate((current) => {
      if (current.length >= MAX_CHECKPOINTS) {
        throw new Error(`Partner checkpoint limit reached (${MAX_CHECKPOINTS})`);
      }
      return { next: [...current, checkpoint], result: checkpoint };
    });

    try {
      await this.hooks.beforeWorkspaceCommit?.(target.absolutePath);
      if (beforeBytes === null) {
        await writeNewFileExclusive(
          target.absolutePath,
          input.bytes,
          'workspace target changed before Partner write',
        );
      } else {
        await replaceFileIfUnchanged(
          target.absolutePath,
          input.bytes,
          sha256Bytes(beforeBytes),
          'workspace target changed before Partner write',
          MAX_PARTNER_DELIVERY_INLINE_BYTES,
        );
      }
    } catch (err) {
      await this.remove(checkpointId).catch(() => {});
      await fs.rm(checkpointDir, { recursive: true, force: true }).catch(() => {});
      throw err;
    }

    if (diff !== undefined) {
      recordDiff(
        target.realRoot,
        target.relativePath,
        beforeBytes?.toString('utf8') ?? '',
        input.bytes.toString('utf8'),
      );
    }
    return { checkpoint, absolutePath: target.absolutePath };
  }

  async attachDelivery(
    checkpointId: string,
    deliveryId: string,
  ): Promise<PartnerCheckpointT | null> {
    return this.mutate((current) => {
      const idx = current.findIndex((checkpoint) => checkpoint.id === checkpointId);
      if (idx < 0) return { next: current, result: null };
      const now = Date.now();
      const next = [...current];
      next[idx] = { ...next[idx]!, deliveryId, updatedAt: now };
      return { next, result: next[idx]! };
    });
  }

  async remove(id: string): Promise<boolean> {
    return this.mutate((current) => {
      const next = current.filter((checkpoint) => checkpoint.id !== id);
      return { next, result: next.length !== current.length };
    });
  }

  async rollback(id: string): Promise<PartnerCheckpointRollbackResult> {
    return this.mutate<PartnerCheckpointRollbackResult>(async (current) => {
      const idx = current.findIndex((checkpoint) => checkpoint.id === id);
      if (idx < 0) return { next: current, result: { ok: false, error: 'checkpoint not found' } };
      const checkpoint = current[idx]!;
      if (checkpoint.status !== 'active') {
        return {
          next: current,
          result: {
            ok: false,
            checkpoint,
            error: `checkpoint is already ${checkpoint.status}`,
          },
        };
      }
      try {
        if (
          !isPathInside(path.resolve(checkpoint.absolutePath), path.resolve(checkpoint.rootPath))
        ) {
          throw new Error('checkpoint path escapes project root');
        }
        const realRoot = await fs.realpath(checkpoint.rootPath);
        const realTarget = await fs.realpath(checkpoint.absolutePath);
        if (!isPathInside(realTarget, realRoot)) {
          throw new Error('checkpoint path escapes project root via symlink');
        }
        const currentBytes = await readExistingBytes(checkpoint.absolutePath);
        if (currentBytes === null) {
          throw new Error('checkpoint target no longer exists');
        }
        if (sha256Bytes(currentBytes) !== checkpoint.afterHash) {
          throw new Error(
            'checkpoint target changed after Partner write; rollback requires review',
          );
        }
        let restoredBytes: Buffer | null = null;
        if (checkpoint.operation === 'create') {
          await removeFileIfUnchanged(
            checkpoint.absolutePath,
            checkpoint.afterHash,
            'checkpoint target changed after Partner write; rollback requires review',
            MAX_PARTNER_DELIVERY_INLINE_BYTES,
          );
        } else {
          if (!checkpoint.beforeSnapshotPath) {
            throw new Error('checkpoint is missing before snapshot');
          }
          restoredBytes = await fs.readFile(checkpoint.beforeSnapshotPath);
          await replaceFileIfUnchanged(
            checkpoint.absolutePath,
            restoredBytes,
            checkpoint.afterHash,
            'checkpoint target changed after Partner write; rollback requires review',
            MAX_PARTNER_DELIVERY_INLINE_BYTES,
          );
        }
        if (restoredBytes !== null && !looksBinary(currentBytes) && !looksBinary(restoredBytes)) {
          recordDiff(
            checkpoint.rootPath,
            checkpoint.relativePath,
            currentBytes.toString('utf8'),
            restoredBytes.toString('utf8'),
          );
        }
        const now = Date.now();
        const rolledBack: PartnerCheckpointT = {
          ...checkpoint,
          status: 'rolled-back',
          updatedAt: now,
          rolledBackAt: now,
        };
        const next = [...current];
        next[idx] = rolledBack;
        return { next, result: { ok: true, checkpoint: rolledBack } };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          next: current,
          result: { ok: false, checkpoint, error: message.slice(0, 512) },
        };
      }
    });
  }

  invalidate(): void {
    this.cached = null;
  }

  private async load(): Promise<PartnerCheckpointT[]> {
    if (this.cached) return cloneCheckpoints(this.cached);
    try {
      const raw = await fs.readFile(this.filePath, 'utf-8');
      const parsed = fileSchema.safeParse(JSON.parse(raw));
      if (!parsed.success) {
        throw new Error(
          `schema invalid: ${parsed.error.issues.map((issue) => issue.path.join('.')).join(', ')}`,
        );
      }
      this.cached = parsed.data.checkpoints;
    } catch (err) {
      if (err instanceof Error && 'code' in err && (err as { code: string }).code === 'ENOENT') {
        this.cached = [];
      } else {
        throw new Error(
          `Partner checkpoint store is corrupt or unreadable; refusing to overwrite it: ${err instanceof Error ? err.message : String(err)}`,
          { cause: err },
        );
      }
    }
    return cloneCheckpoints(this.cached);
  }

  private async mutate<R>(
    apply: (
      current: PartnerCheckpointT[],
    ) =>
      | Promise<{ next: PartnerCheckpointT[]; result: R }>
      | { next: PartnerCheckpointT[]; result: R },
  ): Promise<R> {
    const previous = this.writeLock;
    let release: () => void = () => {};
    this.writeLock = new Promise((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      const current = await this.load();
      const { next, result } = await apply(cloneCheckpoints(current));
      const persisted = cloneCheckpoints(next);
      await atomicWriteJson(this.filePath, { version: 1, checkpoints: persisted });
      this.cached = persisted;
      return result;
    } finally {
      release();
    }
  }
}

export const partnerCheckpointStore = new PartnerCheckpointStore();
