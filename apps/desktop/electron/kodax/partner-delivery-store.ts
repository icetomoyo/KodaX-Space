import { randomUUID, createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import {
  MAX_PARTNER_DELIVERY_INLINE_BYTES,
  partnerDeliveryRefSchema,
  type PartnerDeliveryRefT,
  type PartnerDeliveryRootKindT,
} from '@kodax-space/space-ipc-schema';
import { getSpaceDataDir } from './data-paths.js';
import { isPathInside, readFileBinaryWithGuards, toPosixRelative } from '../ipc/files-core.js';
import { assertPartnerWritablePathNotSensitive } from './partner-file-guards.js';
import {
  replaceFileWithoutFollowingAliases,
  type ReplaceFileWithoutAliasesTestHooks,
} from './atomic-file.js';

const MAX_DELIVERIES = 20_000;
const PARTNER_RUNS_DIR = path.join(getSpaceDataDir(), 'partner-runs');

const fileSchema = z.object({
  version: z.literal(1),
  deliveries: z.array(partnerDeliveryRefSchema).max(MAX_DELIVERIES),
});

type PartnerDeliveriesFile = z.infer<typeof fileSchema>;

export interface PartnerDeliveryListFilter {
  readonly sessionId?: string;
  readonly projectRoot?: string;
  readonly rootKind?: PartnerDeliveryRootKindT;
}

export interface PartnerDeliveryRegisterInput {
  readonly sessionId: string;
  readonly projectRoot: string;
  readonly rootKind: PartnerDeliveryRootKindT;
  readonly rootPath: string;
  readonly absolutePath: string;
  readonly title?: string;
  readonly mime?: string;
  readonly sourceRefs?: readonly string[];
  readonly producer: string;
  readonly checkpointId?: string;
}

export interface PartnerDeliveryWriteInput {
  readonly sessionId: string;
  readonly projectRoot: string;
  readonly relativePath: string;
  readonly bytes: Buffer;
  readonly title?: string;
  readonly mime?: string;
  readonly sourceRefs?: readonly string[];
  readonly producer: string;
}

/** @internal Explicit fault injection used only by filesystem race regression tests. */
interface PartnerDeliveryStoreTestHooks {
  readonly deliveryWrite?: ReplaceFileWithoutAliasesTestHooks;
}

function safeSessionSegment(sessionId: string): string {
  const safe = sessionId.replace(/[^A-Za-z0-9_.-]/g, '_').slice(0, 128);
  return safe.length > 0 ? safe : 'session';
}

function hasControlChar(value: string): boolean {
  return /[\x00\r\n]/.test(value);
}

function normalizeRelativePath(input: string): string {
  if (hasControlChar(input)) throw new Error('delivery path contains control characters');
  const unified = input.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '');
  const parts = unified.split('/').filter((part) => part.length > 0);
  if (parts.length === 0) throw new Error('delivery path is required');
  for (const part of parts) {
    if (part === '.' || part === '..') throw new Error('delivery path cannot contain dot segments');
  }
  assertPartnerWritablePathNotSensitive(parts, 'delivery path');
  return parts.join('/');
}

function extensionFor(relativePath: string): string | undefined {
  const ext = path.posix.extname(relativePath).toLowerCase();
  return ext.length > 0 ? ext : undefined;
}

function defaultMime(relativePath: string, kind: 'file' | 'folder'): string | undefined {
  if (kind === 'folder') return undefined;
  const ext = extensionFor(relativePath);
  if (ext === '.md' || ext === '.markdown') return 'text/markdown';
  if (ext === '.txt' || ext === '.log') return 'text/plain';
  if (ext === '.json') return 'application/json';
  if (ext === '.html' || ext === '.htm') return 'text/html';
  if (ext === '.csv') return 'text/csv';
  if (ext === '.svg') return 'image/svg+xml';
  if (ext === '.png') return 'image/png';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.pdf') return 'application/pdf';
  if (ext === '.zip') return 'application/zip';
  return 'application/octet-stream';
}

async function atomicWriteJson(filePath: string, value: PartnerDeliveriesFile): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  await replaceFileWithoutFollowingAliases(
    filePath,
    Buffer.from(JSON.stringify(value, null, 2), 'utf8'),
    'Partner delivery registry changed during atomic replacement',
  );
}

async function assertTargetNotSymlink(filePath: string, label: string): Promise<void> {
  try {
    const stat = await fs.lstat(filePath);
    if (stat.isSymbolicLink()) throw new Error(label + ' cannot be a symbolic link');
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'ENOTDIR') return;
    throw err;
  }
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

async function atomicWriteFile(
  filePath: string,
  bytes: Buffer,
  testHooks?: ReplaceFileWithoutAliasesTestHooks,
): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  await assertTargetNotSymlink(filePath, 'delivery target');
  await replaceFileWithoutFollowingAliases(
    filePath,
    bytes,
    'delivery target changed during atomic replacement',
    testHooks,
  );
}

function cloneDeliveries(items: readonly PartnerDeliveryRefT[]): PartnerDeliveryRefT[] {
  return items.map((item) => ({ ...item, sourceRefs: [...item.sourceRefs] }));
}

async function hashRegularFile(absolutePath: string, expectedSize: number): Promise<string> {
  if (expectedSize > MAX_PARTNER_DELIVERY_INLINE_BYTES) {
    throw new Error(`delivery target exceeds ${MAX_PARTNER_DELIVERY_INLINE_BYTES} bytes`);
  }
  const handle = await fs.open(absolutePath, 'r');
  try {
    const before = await handle.stat();
    if (!before.isFile()) throw new Error('delivery target must be a regular file');
    if (before.size !== expectedSize) {
      throw new Error('delivery target changed while it was being registered');
    }
    if (before.size > MAX_PARTNER_DELIVERY_INLINE_BYTES) {
      throw new Error(`delivery target exceeds ${MAX_PARTNER_DELIVERY_INLINE_BYTES} bytes`);
    }
    const hash = createHash('sha256');
    let total = 0;
    const stream = handle.createReadStream({ autoClose: false });
    for await (const chunk of stream) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      total += bytes.length;
      if (total > MAX_PARTNER_DELIVERY_INLINE_BYTES) {
        stream.destroy();
        throw new Error(`delivery target exceeds ${MAX_PARTNER_DELIVERY_INLINE_BYTES} bytes`);
      }
      hash.update(bytes);
    }
    const after = await handle.stat();
    if (total !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs) {
      throw new Error('delivery target changed while it was being registered');
    }
    return `sha256:${hash.digest('hex')}`;
  } finally {
    await handle.close();
  }
}

export class PartnerDeliveryStore {
  private cached: PartnerDeliveryRefT[] | null = null;
  private writeLock: Promise<void> = Promise.resolve();

  constructor(
    private readonly filePath: string = path.join(getSpaceDataDir(), 'partner-deliveries.json'),
    private readonly runsDir: string = PARTNER_RUNS_DIR,
    private readonly testHooks: PartnerDeliveryStoreTestHooks = {},
  ) {}

  outputRootForSession(sessionId: string): string {
    return path.join(this.runsDir, safeSessionSegment(sessionId));
  }

  async ensureOutputRoot(sessionId: string): Promise<string> {
    const root = this.outputRootForSession(sessionId);
    await fs.mkdir(root, { recursive: true, mode: 0o700 });
    return root;
  }

  async list(filter: PartnerDeliveryListFilter = {}): Promise<PartnerDeliveryRefT[]> {
    const all = await this.load();
    return all
      .filter((delivery) => {
        if (filter.sessionId !== undefined && delivery.sessionId !== filter.sessionId) return false;
        if (filter.projectRoot !== undefined && delivery.projectRoot !== filter.projectRoot)
          return false;
        if (filter.rootKind !== undefined && delivery.rootKind !== filter.rootKind) return false;
        return true;
      })
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map((item) => ({ ...item, sourceRefs: [...item.sourceRefs] }));
  }

  async get(id: string): Promise<PartnerDeliveryRefT | null> {
    const all = await this.load();
    const found = all.find((delivery) => delivery.id === id);
    return found ? { ...found, sourceRefs: [...found.sourceRefs] } : null;
  }

  async writeRunOutput(input: PartnerDeliveryWriteInput): Promise<PartnerDeliveryRefT> {
    if (input.bytes.length > MAX_PARTNER_DELIVERY_INLINE_BYTES) {
      throw new Error(`delivery content exceeds ${MAX_PARTNER_DELIVERY_INLINE_BYTES} bytes`);
    }
    // Fail before touching output files when persisted registry state is unreadable.
    await this.load();
    const rootPath = await this.ensureOutputRoot(input.sessionId);
    const relativePath = normalizeRelativePath(input.relativePath);
    const absolutePath = path.resolve(rootPath, ...relativePath.split('/'));
    if (!isPathInside(absolutePath, rootPath)) {
      throw new Error('delivery path escapes output root');
    }
    await assertNoSymlinkAncestors(rootPath, relativePath, 'delivery path');
    const parent = path.dirname(absolutePath);
    await fs.mkdir(parent, { recursive: true, mode: 0o700 });
    const realRoot = await fs.realpath(rootPath);
    const realParent = await fs.realpath(parent);
    if (!isPathInside(realParent, realRoot)) {
      throw new Error('delivery path escapes output root via symlink parent');
    }
    await atomicWriteFile(absolutePath, input.bytes, this.testHooks.deliveryWrite);
    return this.register({
      sessionId: input.sessionId,
      projectRoot: path.resolve(input.projectRoot),
      rootKind: 'run-output',
      rootPath,
      absolutePath,
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.mime !== undefined ? { mime: input.mime } : {}),
      sourceRefs: input.sourceRefs,
      producer: input.producer,
    });
  }

  async register(input: PartnerDeliveryRegisterInput): Promise<PartnerDeliveryRefT> {
    const rootPath = path.resolve(input.rootPath);
    const absolutePath = path.resolve(input.absolutePath);
    if (!isPathInside(absolutePath, rootPath)) {
      throw new Error('delivery path escapes delivery root');
    }
    await assertTargetNotSymlink(absolutePath, 'delivery target');
    const stat = await fs.stat(absolutePath);
    const kind = stat.isDirectory() ? 'folder' : stat.isFile() ? 'file' : null;
    if (kind === null) throw new Error('delivery target must be a file or folder');
    const relativePath = toPosixRelative(absolutePath, rootPath);
    normalizeRelativePath(relativePath);
    const realRoot = await fs.realpath(rootPath);
    const realTarget = await fs.realpath(absolutePath);
    if (!isPathInside(realTarget, realRoot)) {
      throw new Error('delivery path escapes delivery root via symlink');
    }
    const now = Date.now();
    const contentHash =
      kind === 'file' ? await hashRegularFile(absolutePath, stat.size) : undefined;
    const parsed = partnerDeliveryRefSchema.parse({
      id: `pd_${randomUUID()}`,
      sessionId: input.sessionId,
      projectRoot: path.resolve(input.projectRoot),
      rootKind: input.rootKind,
      rootPath,
      absolutePath,
      relativePath,
      kind,
      title: (input.title ?? path.basename(absolutePath) ?? relativePath).slice(0, 256),
      mime: input.mime ?? defaultMime(relativePath, kind),
      extension: extensionFor(relativePath),
      ...(kind === 'file' ? { sizeBytes: stat.size, contentHash } : {}),
      sourceRefs: [...(input.sourceRefs ?? [])].slice(0, 64).map((ref) => ref.slice(0, 256)),
      producer: input.producer.slice(0, 128),
      ...(input.checkpointId !== undefined ? { checkpointId: input.checkpointId } : {}),
      createdAt: now,
      updatedAt: now,
    });
    return this.mutate((current) => {
      const existingIdx = current.findIndex(
        (item) =>
          item.sessionId === parsed.sessionId &&
          item.rootKind === parsed.rootKind &&
          item.absolutePath === parsed.absolutePath,
      );
      const next = [...current];
      if (existingIdx >= 0) {
        next[existingIdx] = {
          ...parsed,
          id: next[existingIdx]!.id,
          createdAt: next[existingIdx]!.createdAt,
        };
        return { next, result: next[existingIdx]! };
      }
      if (next.length >= MAX_DELIVERIES) {
        throw new Error(`Partner delivery registry limit reached (${MAX_DELIVERIES})`);
      }
      next.push(parsed);
      return { next, result: parsed };
    });
  }

  async readBinary(
    id: string,
    maxBytes: number,
  ): Promise<{
    base64: string;
    size: number;
    truncated: boolean;
    path: string;
    contentHash?: string;
  }> {
    const delivery = await this.get(id);
    if (!delivery) throw new Error('delivery not found');
    if (delivery.kind !== 'file') throw new Error('delivery is not a file');
    if (!isPathInside(path.resolve(delivery.absolutePath), path.resolve(delivery.rootPath))) {
      throw new Error('delivery path escapes delivery root');
    }
    await assertTargetNotSymlink(delivery.absolutePath, 'delivery target');
    const realRoot = await fs.realpath(delivery.rootPath);
    const realTarget = await fs.realpath(delivery.absolutePath);
    if (!isPathInside(realTarget, realRoot)) {
      throw new Error('delivery path escapes delivery root via symlink');
    }
    const read = await readFileBinaryWithGuards(delivery.absolutePath, maxBytes);
    return {
      ...read,
      path: delivery.absolutePath,
      ...(delivery.contentHash !== undefined ? { contentHash: delivery.contentHash } : {}),
    };
  }

  async remove(id: string): Promise<boolean> {
    return this.mutate((current) => {
      const next = current.filter((delivery) => delivery.id !== id);
      return { next, result: next.length !== current.length };
    });
  }

  async refresh(id: string): Promise<PartnerDeliveryRefT | null> {
    const delivery = await this.get(id);
    if (!delivery) return null;
    try {
      await fs.stat(delivery.absolutePath);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ENOENT' || code === 'ENOTDIR') {
        await this.remove(id);
        return null;
      }
      throw err;
    }
    return this.register({
      sessionId: delivery.sessionId,
      projectRoot: delivery.projectRoot,
      rootKind: delivery.rootKind,
      rootPath: delivery.rootPath,
      absolutePath: delivery.absolutePath,
      title: delivery.title,
      ...(delivery.mime !== undefined ? { mime: delivery.mime } : {}),
      sourceRefs: delivery.sourceRefs,
      producer: delivery.producer,
      ...(delivery.checkpointId !== undefined ? { checkpointId: delivery.checkpointId } : {}),
    });
  }

  invalidate(): void {
    this.cached = null;
  }

  private async load(): Promise<PartnerDeliveryRefT[]> {
    if (this.cached) return cloneDeliveries(this.cached);
    try {
      const raw = await fs.readFile(this.filePath, 'utf-8');
      const parsed = fileSchema.safeParse(JSON.parse(raw));
      if (!parsed.success) {
        throw new Error(
          `schema invalid: ${parsed.error.issues.map((issue) => issue.path.join('.')).join(', ')}`,
        );
      }
      this.cached = parsed.data.deliveries;
    } catch (err) {
      if (err instanceof Error && 'code' in err && (err as { code: string }).code === 'ENOENT') {
        this.cached = [];
      } else {
        throw new Error(
          `Partner delivery store is corrupt or unreadable; refusing to overwrite it: ${err instanceof Error ? err.message : String(err)}`,
          { cause: err },
        );
      }
    }
    return cloneDeliveries(this.cached);
  }

  private async mutate<R>(
    apply: (current: PartnerDeliveryRefT[]) => { next: PartnerDeliveryRefT[]; result: R },
  ): Promise<R> {
    const previous = this.writeLock;
    let release: () => void = () => {};
    this.writeLock = new Promise((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      const current = await this.load();
      const { next, result } = apply(cloneDeliveries(current));
      const persisted = cloneDeliveries(next);
      await atomicWriteJson(this.filePath, { version: 1, deliveries: persisted });
      this.cached = persisted;
      return result;
    } finally {
      release();
    }
  }
}

export const partnerDeliveryStore = new PartnerDeliveryStore();
