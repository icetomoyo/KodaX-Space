// ArtifactStore (F057, v2) persists Space-owned artifacts as ordinary files and
// uses SQLite only as a lightweight, rebuildable catalog.
//
// Source of truth:
//   ~/.kodax/space/artifacts/v2/sessions/<sessionKey>/<artifactId>/meta.json
//   ~/.kodax/space/artifacts/v2/sessions/<sessionKey>/<artifactId>/versions/0001.md
//
// Catalog:
//   ~/.kodax/space/artifacts/v2/catalog.sqlite
//
// The catalog stores metadata plus a tiny meta.json fingerprint. It is rebuilt
// from meta.json files during initialization, so a corrupt/missing SQLite file
// never means artifact content is lost. list() validates the fingerprint with a
// stat-only check before trusting catalog rows, avoiding full meta.json reads on
// the hot path while still self-healing after out-of-band disk changes.
// The old v1 ~/.kodax/space/artifacts.json is migrated lazily and kept as
// artifacts.v1.backup.json.

import { constants as fsConstants, promises as fs } from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import DatabaseConstructor from 'better-sqlite3';
import type BetterSqlite3 from 'better-sqlite3';
import { z } from 'zod';
import {
  artifactHtmlPermissionsSchema,
  artifactKindSchema,
  MAX_ARTIFACT_CONTENT_BYTES,
  ARTIFACT_MAX_VERSIONS as MAX_VERSIONS,
  type ArtifactHtmlPermissionsT,
  type ArtifactKindT,
  type ArtifactRefT,
} from '@kodax-space/space-ipc-schema';
import { getSpaceDataDir } from '../kodax/data-paths.js';
import { replaceFileWithoutFollowingAliases } from '../kodax/atomic-file.js';

const SPACE_DATA_DIR = getSpaceDataDir();
const LEGACY_ARTIFACTS_FILE = path.join(SPACE_DATA_DIR, 'artifacts.json');
const ARTIFACTS_ROOT = path.join(SPACE_DATA_DIR, 'artifacts');
const V2_DIRNAME = 'v2';
const CATALOG_FILENAME = 'catalog.sqlite';
const DEFAULT_MAX_ARTIFACTS = 1000;
const DEFAULT_TARGET_ARTIFACTS = 900;
const DEFAULT_MAX_ARTIFACT_BYTES = 512 * 1024 * 1024;
const DEFAULT_TARGET_ARTIFACT_BYTES = 384 * 1024 * 1024;
const MAX_GENERATED_ARTIFACT_FILE_BYTES = 64 * 1024 * 1024;
const PATH_ARTIFACT_KINDS = new Set<ArtifactKindT>(['pdf', 'docx', 'xlsx', 'pptx', 'file']);
const SAFE_ARTIFACT_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;
const SHA256_CONTENT_HASH_RE = /^sha256:[0-9a-f]{64}$/;
const artifactIdSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(SAFE_ARTIFACT_ID_RE, 'artifact id contains unsafe path characters');

const storedVersionSchema = z
  .object({
    v: z.number().int().positive(),
    createdAt: z.number().int().nonnegative(),
    contentFile: z.string().min(1).max(256).optional(),
    path: z.string().max(4096).optional(),
    storedFile: z.string().min(1).max(256).optional(),
    filename: z.string().min(1).max(256).optional(),
    contentHash: z
      .string()
      .regex(SHA256_CONTENT_HASH_RE, 'content hash must be canonical SHA-256')
      .optional(),
    summary: z.string().max(512).optional(),
  })
  .superRefine((value, ctx) => {
    const sources = [value.contentFile, value.path, value.storedFile].filter(
      (source) => source !== undefined,
    ).length;
    if (sources !== 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'version must have exactly one of contentFile, path, or storedFile',
        path: ['contentFile'],
      });
    }
    if (value.storedFile !== undefined && value.contentHash === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'artifact-owned generated files require a content hash',
        path: ['contentHash'],
      });
    }
  });

const storedArtifactSchema = z.object({
  id: artifactIdSchema,
  sessionId: z.string().min(1).max(128),
  surface: z.enum(['code', 'partner']),
  kind: artifactKindSchema,
  title: z.string().min(1).max(256),
  permissions: artifactHtmlPermissionsSchema.optional(),
  currentVersion: z.number().int().positive(),
  versions: z.array(storedVersionSchema).min(1).max(MAX_VERSIONS),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
});

const metaFileSchema = z.object({
  version: z.literal(2),
  artifact: storedArtifactSchema,
});

const legacyVersionSchema = z
  .object({
    v: z.number().int().positive(),
    createdAt: z.number().int().nonnegative(),
    content: z.string().max(MAX_ARTIFACT_CONTENT_BYTES).optional(),
    path: z.string().max(4096).optional(),
    summary: z.string().max(512).optional(),
  })
  .superRefine((value, ctx) => {
    const hasContent = value.content !== undefined;
    const hasPath = value.path !== undefined;
    if (hasContent === hasPath) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'legacy version must have exactly one of content or path',
        path: ['content'],
      });
    }
  });

const legacyArtifactSchema = z.object({
  id: artifactIdSchema,
  sessionId: z.string().min(1).max(128),
  surface: z.enum(['code', 'partner']),
  kind: artifactKindSchema,
  title: z.string().min(1).max(256),
  permissions: artifactHtmlPermissionsSchema.optional(),
  currentVersion: z.number().int().positive(),
  versions: z.array(legacyVersionSchema).min(1).max(MAX_VERSIONS),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
});

const legacyFileSchema = z.object({
  version: z.literal(1),
  artifacts: z.array(legacyArtifactSchema),
});

export type StoredArtifact = z.infer<typeof storedArtifactSchema>;
type StoredVersion = z.infer<typeof storedVersionSchema>;
type LegacyArtifact = z.infer<typeof legacyArtifactSchema>;

export interface ArtifactStoreOptions {
  /** High-water mark; creation prunes old artifacts before this is exceeded. */
  maxArtifacts?: number;
  /** Low-water mark after pruning starts. */
  targetArtifacts?: number;
  /** High-water mark for artifact v2 directory bytes. */
  maxBytes?: number;
  /** Low-water mark after byte pruning starts. */
  targetBytes?: number;
}

interface ArtifactStoreLimits {
  maxArtifacts: number;
  targetArtifacts: number;
  maxBytes: number;
  targetBytes: number;
}

export interface UpsertInput {
  sessionId: string;
  surface: 'code' | 'partner';
  kind: ArtifactKindT;
  title: string;
  content?: string;
  path?: string;
  permissions?: ArtifactHtmlPermissionsT;
  summary?: string;
  /** When set + found, append a version (iterate) instead of creating new. */
  id?: string;
  /**
   * C13: when `id` is absent, resolve an existing artifact to version by (sessionId, title, kind)
   * ATOMICALLY inside the write lock, closing the check-then-act race that let two concurrent
   * previews of the same file create duplicates. `htmlFamily` treats html / interactive-html as
   * one bucket (a static preview upgraded to interactive still matches). Ignored when `id` is set.
   */
  dedupeKey?: { title: string; kind: ArtifactKindT; htmlFamily?: boolean };
}

export interface GeneratedFileUpsertInput {
  sessionId: string;
  surface: 'code' | 'partner';
  kind: ArtifactKindT;
  title: string;
  bytes: Buffer;
  filename?: string;
  summary?: string;
  id?: string;
}

export interface ReadResult {
  ref: ArtifactRefT;
  version: number;
  content?: string;
  path?: string;
  fileSource?: 'workspace' | 'artifact-store';
  contentHash?: string;
}

export interface GeneratedFileReadResult {
  ref: ArtifactRefT;
  version: number;
  bytes: Buffer;
  size: number;
  truncated: boolean;
  path: string;
  contentHash?: string;
}

interface CatalogRow {
  id: string;
  sessionId: string;
  surface: 'code' | 'partner';
  kind: ArtifactKindT;
  title: string;
  currentVersion: number;
  createdAt: number;
  updatedAt: number;
  versionsJson: string;
  permissionsJson: string | null;
  metaPath: string;
  bytes: number;
  metaMtimeMs: number;
  metaSize: number;
}

interface MetaFingerprint {
  metaMtimeMs: number;
  metaSize: number;
}

function toMeta(a: StoredArtifact): ArtifactRefT {
  return {
    id: a.id,
    sessionId: a.sessionId,
    surface: a.surface,
    kind: a.kind,
    title: a.title,
    ...(a.permissions !== undefined ? { permissions: a.permissions } : {}),
    currentVersion: a.currentVersion,
    versions: a.versions.map((v) => ({
      v: v.v,
      createdAt: v.createdAt,
      hasContent: typeof v.contentFile === 'string',
      ...(v.path !== undefined
        ? { path: v.path, fileSource: 'workspace' as const }
        : v.storedFile !== undefined
          ? {
              path: v.filename ?? path.posix.basename(v.storedFile),
              fileSource: 'artifact-store' as const,
            }
          : {}),
      ...(v.contentHash !== undefined ? { contentHash: v.contentHash } : {}),
      ...(v.summary !== undefined ? { summary: v.summary } : {}),
    })),
    createdAt: a.createdAt,
    updatedAt: a.updatedAt,
  };
}

function sessionKey(sessionId: string): string {
  return Buffer.from(sessionId, 'utf8').toString('base64url');
}

function assertSafeArtifactId(id: string): string {
  if (!SAFE_ARTIFACT_ID_RE.test(id)) {
    throw new Error('artifact id contains unsafe path characters');
  }
  return id;
}

function versionExt(kind: ArtifactKindT): string {
  switch (kind) {
    case 'markdown':
      return 'md';
    case 'html':
    case 'interactive-html':
      return 'html';
    case 'svg':
      return 'svg';
    case 'chart':
      return 'chart.json';
    case 'react':
      return 'jsx';
    case 'image':
      return 'data-uri.txt';
    case 'pdf':
      return 'pdf';
    case 'docx':
      return 'docx';
    case 'xlsx':
      return 'xlsx';
    case 'pptx':
      return 'pptx';
    case 'file':
      return 'file-ref';
    case 'code':
    default:
      return 'txt';
  }
}

function versionFileName(kind: ArtifactKindT, version: number): string {
  return `${String(version).padStart(4, '0')}.${versionExt(kind)}`;
}

function sha256ContentHash(bytes: Buffer): string {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function safeDisplayFilename(title: string, kind: ArtifactKindT): string {
  let out = '';
  for (const ch of title) {
    const c = ch.charCodeAt(0);
    if ('/\\?%*:|"<>'.includes(ch) || c < 0x20) continue;
    out += ch;
  }
  out = out.replace(/^\.+/, '').replace(/\.+$/, '').trim();
  const base = out.slice(0, 120) || 'artifact';
  const ext = versionExt(kind);
  return base.toLowerCase().endsWith(`.${ext}`) ? base : `${base}.${ext}`;
}

function validateUpsertPayload(input: UpsertInput): void {
  if (
    input.permissions !== undefined &&
    input.kind !== 'html' &&
    input.kind !== 'interactive-html'
  ) {
    throw new Error('artifact permissions are only supported for html artifacts');
  }
  const isPathBacked = PATH_ARTIFACT_KINDS.has(input.kind);
  const hasContent = input.content !== undefined;
  const hasPath = input.path !== undefined;
  if (isPathBacked) {
    if (!hasPath) throw new Error('path-backed artifact kinds require a path');
    if (hasContent) throw new Error('path-backed artifact kinds do not accept inline content');
    return;
  }
  if (!hasContent) throw new Error('content artifact kinds require content');
  if (hasPath) throw new Error('content artifact kinds do not accept a path');
}

function validateGeneratedFilePayload(input: GeneratedFileUpsertInput): void {
  if (!PATH_ARTIFACT_KINDS.has(input.kind) || input.kind === 'file') {
    throw new Error('generated file artifacts support pdf/docx/xlsx/pptx only');
  }
  if (input.bytes.length === 0) throw new Error('generated artifact file is empty');
  if (input.bytes.length > MAX_GENERATED_ARTIFACT_FILE_BYTES) {
    throw new Error('generated artifact file exceeds size limit');
  }
}

function isNotFound(err: unknown): boolean {
  return err instanceof Error && 'code' in err && (err as { code: string }).code === 'ENOENT';
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function sqliteErrorCode(err: unknown): string {
  if (!(err instanceof Error) || !('code' in err)) return '';
  const code = (err as { code?: unknown }).code;
  return typeof code === 'string' ? code : '';
}

export function isRecoverableCatalogOpenError(err: unknown): boolean {
  const code = sqliteErrorCode(err);
  if (code === 'SQLITE_CORRUPT' || code === 'SQLITE_NOTADB') return true;

  const message = errorMessage(err).toLowerCase();
  return (
    message.includes('database disk image is malformed') ||
    message.includes('file is not a database')
  );
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

function relativePortable(from: string, to: string): string {
  return path.relative(from, to).split(path.sep).join('/');
}

function resolveInside(base: string, rel: string): string {
  const resolved = path.resolve(base, rel);
  const baseAbs = path.resolve(base);
  const withSep = baseAbs.endsWith(path.sep) ? baseAbs : baseAbs + path.sep;
  if (resolved !== baseAbs && !resolved.startsWith(withSep)) {
    throw new Error('artifact metadata path escapes artifact directory');
  }
  return resolved;
}

async function lstatOwnedArtifactFile(
  root: string,
  filePath: string,
): Promise<Awaited<ReturnType<typeof fs.lstat>>> {
  const rootAbs = path.resolve(root);
  const targetAbs = path.resolve(filePath);
  const relative = path.relative(rootAbs, targetAbs);
  if (relative === '' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error('generated artifact path escapes the artifact store');
  }

  let current = rootAbs;
  const parts = relative.split(path.sep);
  for (const part of parts.slice(0, -1)) {
    current = path.join(current, part);
    const stat = await fs.lstat(current);
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      throw new Error('generated artifact path traverses an unsafe directory entry');
    }
  }

  const stat = await fs.lstat(targetAbs);
  if (stat.isSymbolicLink() || !stat.isFile() || stat.nlink !== 1) {
    throw new Error('generated artifact must be an owned, non-linked regular file');
  }
  return stat;
}

function sameArtifactFileSnapshot(
  left: Awaited<ReturnType<typeof fs.stat>>,
  right: Awaited<ReturnType<typeof fs.stat>>,
): boolean {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.size === right.size &&
    left.mtimeMs === right.mtimeMs &&
    left.ctimeMs === right.ctimeMs &&
    left.nlink === right.nlink
  );
}

async function atomicWriteText(filePath: string, payload: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  await replaceFileWithoutFollowingAliases(
    filePath,
    Buffer.from(payload, 'utf8'),
    'artifact metadata changed during atomic replacement',
  );
}

async function atomicWriteBuffer(filePath: string, payload: Buffer): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  await replaceFileWithoutFollowingAliases(
    filePath,
    payload,
    'generated artifact changed during atomic replacement',
  );
}

async function moveAsideIfExists(filePath: string, targetPath: string): Promise<string | null> {
  if (!(await exists(filePath))) return null;
  for (let attempt = 0; attempt < 32; attempt += 1) {
    const target = attempt === 0 ? targetPath : `${targetPath}.${Date.now()}.${randomUUID()}`;
    try {
      // link() installs the backup directory entry exclusively, so a target
      // raced into place is never replaced or followed.
      await fs.link(filePath, target);
      await fs.unlink(filePath).catch(() => {});
      return target;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'EEXIST') continue;
      if (code !== 'EXDEV' && code !== 'EPERM' && code !== 'EACCES' && code !== 'ENOTSUP') {
        throw err;
      }
    }

    try {
      await fs.copyFile(filePath, target, fsConstants.COPYFILE_EXCL);
      await fs.unlink(filePath).catch(() => {});
      return target;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'EEXIST') continue;
      throw err;
    }
  }
  throw new Error(`could not reserve a unique backup path for ${path.basename(filePath)}`);
}

function positiveInt(value: number | undefined, fallback: number): number {
  return Number.isInteger(value) && value !== undefined && value > 0 ? value : fallback;
}

function normalizeLimits(options: ArtifactStoreOptions): ArtifactStoreLimits {
  const maxArtifacts = positiveInt(options.maxArtifacts, DEFAULT_MAX_ARTIFACTS);
  const maxBytes = positiveInt(options.maxBytes, DEFAULT_MAX_ARTIFACT_BYTES);
  const targetArtifacts = Math.max(
    0,
    Math.min(
      positiveInt(options.targetArtifacts, DEFAULT_TARGET_ARTIFACTS),
      Math.max(0, maxArtifacts - 1),
    ),
  );
  const targetBytes = Math.max(
    0,
    Math.min(
      positiveInt(options.targetBytes, DEFAULT_TARGET_ARTIFACT_BYTES),
      Math.max(0, maxBytes - 1),
    ),
  );
  return { maxArtifacts, targetArtifacts, maxBytes, targetBytes };
}

async function directoryBytes(dir: string): Promise<number> {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (err) {
    if (isNotFound(err)) return 0;
    throw err;
  }

  let total = 0;
  for (const entry of entries) {
    const child = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      total += await directoryBytes(child);
      continue;
    }
    try {
      total += (await fs.lstat(child)).size;
    } catch (err) {
      if (!isNotFound(err)) throw err;
    }
  }
  return total;
}

export class ArtifactStore {
  private db: BetterSqlite3.Database | null = null;
  private ready: Promise<void> | null = null;
  private writeLock: Promise<void> = Promise.resolve();
  private readonly root: string;
  private readonly v2Root: string;
  private readonly catalogPath: string;
  private readonly limits: ArtifactStoreLimits;
  private catalogValidated = false;

  constructor(
    private readonly legacyFilePath: string = LEGACY_ARTIFACTS_FILE,
    dir: string = SPACE_DATA_DIR,
    options: ArtifactStoreOptions = {},
  ) {
    this.root = dir === SPACE_DATA_DIR ? ARTIFACTS_ROOT : path.join(dir, 'artifacts');
    this.v2Root = path.join(this.root, V2_DIRNAME);
    this.catalogPath = path.join(this.v2Root, CATALOG_FILENAME);
    this.limits = normalizeLimits(options);
  }

  /**
   * Create a new artifact, or append a version when `input.id` matches an
   * existing one. Returns `created` so callers can classify the change:
   *   - id matches existing -> append version, created=false
   *   - no id, OR id provided but NOT found -> new artifact with a FRESH id,
   *     created=true. A stale/deleted id is never resurrected.
   */
  async upsert(input: UpsertInput): Promise<{ id: string; version: number; created: boolean }> {
    validateUpsertPayload(input);
    if (
      input.content !== undefined &&
      Buffer.byteLength(input.content, 'utf8') > MAX_ARTIFACT_CONTENT_BYTES
    ) {
      throw new Error('artifact content exceeds size limit');
    }
    await this.ensureReady();
    return this.mutate(async () => {
      const now = Date.now();
      // Resolve the target id inside the write lock so dedup is atomic (C13): no other upsert can
      // slip a duplicate in between "does one exist?" and "create it".
      const resolvedId =
        input.id ??
        (input.dedupeKey ? this.findDedupeMatchId(input.sessionId, input.dedupeKey) : undefined);
      const existing = resolvedId !== undefined ? await this.loadArtifactById(resolvedId) : null;

      if (existing) {
        if (existing.sessionId !== input.sessionId) {
          throw new Error('artifact id belongs to a different session');
        }
        if (existing.versions.length >= MAX_VERSIONS) {
          throw new Error(`artifact ${existing.id} reached max ${MAX_VERSIONS} versions`);
        }
        const v = existing.currentVersion + 1;
        const version = await this.materializeVersion(existing, input, v, now);
        const next: StoredArtifact = {
          ...existing,
          title: input.title || existing.title,
          ...((input.permissions ?? existing.permissions) !== undefined
            ? { permissions: input.permissions ?? existing.permissions }
            : {}),
          currentVersion: v,
          versions: [...existing.versions, version],
          updatedAt: now,
        };
        const metaFingerprint = await this.writeArtifactMeta(next);
        await this.upsertCatalogWithRecovery(
          next,
          await this.artifactDiskBytes(next),
          metaFingerprint,
        );
        await this.enforceLimits({ exemptId: next.id });
        return { id: next.id, version: v, created: false };
      }

      await this.enforceLimits({
        reserveArtifacts: 1,
        reserveBytes:
          (input.content !== undefined ? Buffer.byteLength(input.content, 'utf8') : 0) + 8192,
      });
      const count = this.catalogCount();
      if (count >= this.limits.maxArtifacts) {
        throw new Error(`artifact store reached max ${this.limits.maxArtifacts} entries`);
      }
      const id = randomUUID();
      const createdBase: StoredArtifact = {
        id,
        sessionId: input.sessionId,
        surface: input.surface,
        kind: input.kind,
        title: input.title,
        ...(input.permissions !== undefined ? { permissions: input.permissions } : {}),
        currentVersion: 1,
        versions: [],
        createdAt: now,
        updatedAt: now,
      };
      const firstVersion = await this.materializeVersion(createdBase, input, 1, now);
      const created: StoredArtifact = { ...createdBase, versions: [firstVersion] };
      const metaFingerprint = await this.writeArtifactMeta(created);
      await this.upsertCatalogWithRecovery(
        created,
        await this.artifactDiskBytes(created),
        metaFingerprint,
      );
      await this.enforceLimits({ exemptId: id });
      return { id, version: 1, created: true };
    });
  }

  async upsertGeneratedFile(
    input: GeneratedFileUpsertInput,
  ): Promise<{ id: string; version: number; created: boolean }> {
    validateGeneratedFilePayload(input);
    await this.ensureReady();
    return this.mutate(async () => {
      const now = Date.now();
      const existing = input.id !== undefined ? await this.loadArtifactById(input.id) : null;

      if (existing) {
        if (existing.sessionId !== input.sessionId) {
          throw new Error('artifact id belongs to a different session');
        }
        if (existing.kind !== input.kind) {
          throw new Error('artifact id belongs to a different kind');
        }
        if (existing.versions.length >= MAX_VERSIONS) {
          throw new Error(`artifact ${existing.id} reached max ${MAX_VERSIONS} versions`);
        }
        const v = existing.currentVersion + 1;
        const version = await this.materializeGeneratedFileVersion(existing, input, v, now);
        const next: StoredArtifact = {
          ...existing,
          title: input.title || existing.title,
          currentVersion: v,
          versions: [...existing.versions, version],
          updatedAt: now,
        };
        const metaFingerprint = await this.writeArtifactMeta(next);
        await this.upsertCatalogWithRecovery(
          next,
          await this.artifactDiskBytes(next),
          metaFingerprint,
        );
        await this.enforceLimits({ exemptId: next.id });
        return { id: next.id, version: v, created: false };
      }

      await this.enforceLimits({
        reserveArtifacts: 1,
        reserveBytes: input.bytes.length + 8192,
      });
      const count = this.catalogCount();
      if (count >= this.limits.maxArtifacts) {
        throw new Error(`artifact store reached max ${this.limits.maxArtifacts} entries`);
      }
      const id = randomUUID();
      const createdBase: StoredArtifact = {
        id,
        sessionId: input.sessionId,
        surface: input.surface,
        kind: input.kind,
        title: input.title,
        currentVersion: 1,
        versions: [],
        createdAt: now,
        updatedAt: now,
      };
      const firstVersion = await this.materializeGeneratedFileVersion(createdBase, input, 1, now);
      const created: StoredArtifact = { ...createdBase, versions: [firstVersion] };
      const metaFingerprint = await this.writeArtifactMeta(created);
      await this.upsertCatalogWithRecovery(
        created,
        await this.artifactDiskBytes(created),
        metaFingerprint,
      );
      await this.enforceLimits({ exemptId: id });
      return { id, version: 1, created: true };
    });
  }

  async list(filter?: {
    sessionId?: string;
    surface?: 'code' | 'partner';
  }): Promise<ArtifactRefT[]> {
    await this.ensureReady();
    await this.writeLock;
    let rows = this.queryCatalogRows(filter);
    if (!this.catalogValidated || (await this.catalogRowsNeedRebuild(rows))) {
      rows = await this.mutate(async () => {
        let lockedRows = this.queryCatalogRows(filter);
        if (!this.catalogValidated || (await this.catalogRowsNeedRebuild(lockedRows))) {
          await this.rebuildCatalogFromDisk();
          lockedRows = this.queryCatalogRows(filter);
        }
        return lockedRows;
      });
    }
    return rows
      .map((row) => this.artifactFromCatalogRow(row))
      .filter((a): a is StoredArtifact => a !== null)
      .map(toMeta);
  }

  async read(id: string, version?: number): Promise<ReadResult | null> {
    await this.ensureReady();
    await this.writeLock;
    let artifact = await this.loadArtifactById(id);
    if (!artifact) {
      artifact = await this.mutate(async () => {
        const lockedArtifact = await this.loadArtifactById(id);
        if (lockedArtifact) return lockedArtifact;
        await this.rebuildCatalogFromDisk();
        return this.loadArtifactById(id);
      });
      if (!artifact) return null;
    }

    const v = version ?? artifact.currentVersion;
    const ver = artifact.versions.find((x) => x.v === v);
    if (!ver) return null;

    const artifactDir = this.artifactDir(artifact);
    if (ver.contentFile !== undefined) {
      try {
        const contentPath = resolveInside(artifactDir, ver.contentFile);
        const content = await fs.readFile(contentPath, 'utf-8');
        return { ref: toMeta(artifact), version: v, content };
      } catch (err) {
        if (isNotFound(err)) return null;
        throw err;
      }
    }
    return {
      ref: toMeta(artifact),
      version: v,
      ...(ver.path !== undefined
        ? { path: ver.path, fileSource: 'workspace' as const }
        : ver.storedFile !== undefined
          ? {
              path: ver.filename ?? path.posix.basename(ver.storedFile),
              fileSource: 'artifact-store' as const,
            }
          : {}),
      ...(ver.contentHash !== undefined ? { contentHash: ver.contentHash } : {}),
    };
  }

  async readGeneratedFile(
    id: string,
    version: number | undefined,
    maxBytes?: number,
  ): Promise<GeneratedFileReadResult | null> {
    await this.ensureReady();
    await this.writeLock;
    let artifact = await this.loadArtifactById(id);
    if (!artifact) {
      artifact = await this.mutate(async () => {
        const lockedArtifact = await this.loadArtifactById(id);
        if (lockedArtifact) return lockedArtifact;
        await this.rebuildCatalogFromDisk();
        return this.loadArtifactById(id);
      });
      if (!artifact) return null;
    }

    const v = version ?? artifact.currentVersion;
    const ver = artifact.versions.find((x) => x.v === v);
    if (!ver?.storedFile) return null;
    if (!ver.contentHash || !SHA256_CONTENT_HASH_RE.test(ver.contentHash)) {
      throw new Error('generated artifact integrity metadata is missing or invalid');
    }

    const artifactDir = this.artifactDir(artifact);
    const filePath = resolveInside(artifactDir, ver.storedFile);
    let entryStat;
    try {
      entryStat = await lstatOwnedArtifactFile(this.v2Root, filePath);
    } catch (err) {
      if (isNotFound(err)) return null;
      throw err;
    }
    const handle = await fs.open(filePath, 'r');
    try {
      const before = await handle.stat();
      if (!before.isFile() || before.nlink !== 1 || !sameArtifactFileSnapshot(entryStat, before)) {
        throw new Error('generated artifact changed before it could be read safely');
      }

      const size = before.size;
      if (size > MAX_GENERATED_ARTIFACT_FILE_BYTES) {
        throw new Error('generated artifact file exceeds size limit');
      }
      const requestedCap =
        maxBytes === undefined || !Number.isFinite(maxBytes)
          ? size
          : Math.max(0, Math.trunc(maxBytes));
      const cap = Math.min(size, requestedCap);
      const truncated = size > cap;
      let bytes = Buffer.alloc(0);

      // A partial Office/PDF prefix is not useful to a renderer and cannot be
      // checked against the stored full-file hash. Return metadata only.
      if (!truncated) {
        bytes = Buffer.alloc(size);
        let offset = 0;
        while (offset < size) {
          const { bytesRead } = await handle.read(bytes, offset, size - offset, offset);
          if (bytesRead === 0) {
            throw new Error('generated artifact changed while it was being read');
          }
          offset += bytesRead;
        }
      }

      const after = await handle.stat();
      if (!after.isFile() || after.nlink !== 1 || !sameArtifactFileSnapshot(before, after)) {
        throw new Error('generated artifact changed while it was being read');
      }
      if (!truncated && sha256ContentHash(bytes) !== ver.contentHash) {
        throw new Error('generated artifact content hash does not match its metadata');
      }

      return {
        ref: toMeta(artifact),
        version: v,
        bytes,
        size,
        truncated,
        path: ver.filename ?? path.posix.basename(ver.storedFile),
        contentHash: ver.contentHash,
      };
    } finally {
      await handle.close();
    }
  }

  async delete(id: string): Promise<boolean> {
    await this.ensureReady();
    return this.mutate(async () => {
      const artifact = await this.loadArtifactById(id);
      if (!artifact) return false;
      await this.deleteArtifactLocked(artifact);
      return true;
    });
  }

  /** Test hook: drop catalog state so the next call re-opens and re-indexes. */
  invalidate(): void {
    this.db?.close();
    this.db = null;
    this.ready = null;
    this.catalogValidated = false;
  }

  private async ensureReady(): Promise<void> {
    if (!this.ready) {
      // Don't cache a REJECTED init promise: a transient failure (native-module ABI mismatch on a
      // cold call, a briefly-locked catalog file, etc.) would otherwise disable the entire artifact
      // feature for the process's whole lifetime, since `!this.ready` treats any settled promise as
      // truthy. Reset on failure so the next operation retries a fresh initialize().
      this.ready = this.initialize().catch((err: unknown) => {
        this.ready = null;
        throw err;
      });
    }
    await this.ready;
  }

  private async initialize(): Promise<void> {
    await fs.mkdir(this.v2Root, { recursive: true, mode: 0o700 });
    await this.migrateLegacyIfNeeded();
    await this.openCatalogWithRecovery();
    try {
      await this.rebuildCatalogFromDisk();
    } catch (err) {
      console.warn(
        '[ArtifactStore] catalog rebuild failed, recreating:',
        err instanceof Error ? err.message : String(err),
      );
      await this.moveCatalogAside('corrupt');
      await this.openCatalogWithRecovery();
      await this.rebuildCatalogFromDisk();
    }
    await this.enforceLimits();
  }

  private async openCatalogWithRecovery(): Promise<void> {
    if (this.db) return;
    try {
      this.db = new DatabaseConstructor(this.catalogPath);
      this.ensureCatalogSchema(this.db);
    } catch (err) {
      this.db?.close();
      this.db = null;
      if (!isRecoverableCatalogOpenError(err)) {
        console.error('[ArtifactStore] catalog open failed:', errorMessage(err));
        throw err;
      }
      console.warn('[ArtifactStore] catalog open failed, rebuilding:', errorMessage(err));
      await this.moveCatalogAside('corrupt');
      this.db = new DatabaseConstructor(this.catalogPath);
      this.ensureCatalogSchema(this.db);
    }
  }

  private async moveCatalogAside(suffix: string): Promise<void> {
    this.db?.close();
    this.db = null;
    await moveAsideIfExists(this.catalogPath, `${this.catalogPath}.${suffix}`);
    await moveAsideIfExists(`${this.catalogPath}-wal`, `${this.catalogPath}-wal.${suffix}`);
    await moveAsideIfExists(`${this.catalogPath}-shm`, `${this.catalogPath}-shm.${suffix}`);
  }

  private ensureCatalogSchema(db: BetterSqlite3.Database): void {
    db.exec(`
      CREATE TABLE IF NOT EXISTS artifacts (
        id TEXT PRIMARY KEY,
        sessionId TEXT NOT NULL,
        surface TEXT NOT NULL,
        kind TEXT NOT NULL,
        title TEXT NOT NULL,
        currentVersion INTEGER NOT NULL,
        createdAt INTEGER NOT NULL,
        updatedAt INTEGER NOT NULL,
        versionsJson TEXT NOT NULL,
        permissionsJson TEXT,
        metaPath TEXT NOT NULL,
        bytes INTEGER NOT NULL DEFAULT 0,
        metaMtimeMs INTEGER NOT NULL DEFAULT -1,
        metaSize INTEGER NOT NULL DEFAULT -1
      );
      CREATE INDEX IF NOT EXISTS idx_artifacts_session_updated ON artifacts(sessionId, updatedAt DESC);
      CREATE INDEX IF NOT EXISTS idx_artifacts_surface_updated ON artifacts(surface, updatedAt DESC);
      CREATE INDEX IF NOT EXISTS idx_artifacts_updated ON artifacts(updatedAt DESC);
    `);
    const columns = db.prepare('PRAGMA table_info(artifacts)').all() as Array<{ name: string }>;
    if (!columns.some((column) => column.name === 'bytes')) {
      db.exec('ALTER TABLE artifacts ADD COLUMN bytes INTEGER NOT NULL DEFAULT 0');
    }
    if (!columns.some((column) => column.name === 'permissionsJson')) {
      db.exec('ALTER TABLE artifacts ADD COLUMN permissionsJson TEXT');
    }
    if (!columns.some((column) => column.name === 'metaMtimeMs')) {
      db.exec('ALTER TABLE artifacts ADD COLUMN metaMtimeMs INTEGER NOT NULL DEFAULT -1');
    }
    if (!columns.some((column) => column.name === 'metaSize')) {
      db.exec('ALTER TABLE artifacts ADD COLUMN metaSize INTEGER NOT NULL DEFAULT -1');
    }
  }

  private async migrateLegacyIfNeeded(): Promise<void> {
    if (!(await exists(this.legacyFilePath))) return;
    try {
      const raw = await fs.readFile(this.legacyFilePath, 'utf-8');
      const parsed = legacyFileSchema.safeParse(JSON.parse(raw));
      if (!parsed.success) {
        console.warn(
          `[ArtifactStore] legacy ${this.legacyFilePath} schema invalid, leaving it in place:`,
          parsed.error.issues.map((i) => i.path.join('.')).join(', '),
        );
        return;
      }
      for (const legacy of parsed.data.artifacts) {
        await this.writeMigratedArtifact(legacy);
      }
      const backup = path.join(path.dirname(this.legacyFilePath), 'artifacts.v1.backup.json');
      await moveAsideIfExists(this.legacyFilePath, backup);
    } catch (err) {
      console.warn(
        '[ArtifactStore] legacy migration failed:',
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  private async writeMigratedArtifact(legacy: LegacyArtifact): Promise<void> {
    const artifactDir = this.artifactDir(legacy);
    if (await exists(path.join(artifactDir, 'meta.json'))) return;

    const versions: StoredVersion[] = [];
    for (const legacyVersion of legacy.versions) {
      if (legacyVersion.content !== undefined) {
        const contentFile = path.posix.join(
          'versions',
          versionFileName(legacy.kind, legacyVersion.v),
        );
        await atomicWriteText(resolveInside(artifactDir, contentFile), legacyVersion.content);
        versions.push({
          v: legacyVersion.v,
          createdAt: legacyVersion.createdAt,
          contentFile,
          ...(legacyVersion.summary !== undefined ? { summary: legacyVersion.summary } : {}),
        });
      } else {
        versions.push({
          v: legacyVersion.v,
          createdAt: legacyVersion.createdAt,
          ...(legacyVersion.path !== undefined ? { path: legacyVersion.path } : {}),
          ...(legacyVersion.summary !== undefined ? { summary: legacyVersion.summary } : {}),
        });
      }
    }

    const migrated: StoredArtifact = {
      id: legacy.id,
      sessionId: legacy.sessionId,
      surface: legacy.surface,
      kind: legacy.kind,
      title: legacy.title,
      ...(legacy.permissions !== undefined ? { permissions: legacy.permissions } : {}),
      currentVersion: legacy.currentVersion,
      versions,
      createdAt: legacy.createdAt,
      updatedAt: legacy.updatedAt,
    };
    await this.writeArtifactMeta(migrated);
  }

  private async rebuildCatalogFromDisk(): Promise<void> {
    const db = this.requireDb();
    const artifacts: Array<{
      artifact: StoredArtifact;
      bytes: number;
      metaFingerprint: MetaFingerprint;
    }> = [];
    const orphanDirs: string[] = [];
    const sessionsDir = path.join(this.v2Root, 'sessions');
    await fs.mkdir(sessionsDir, { recursive: true, mode: 0o700 });

    for (const sessionEntry of await fs
      .readdir(sessionsDir, { withFileTypes: true })
      .catch(() => [])) {
      if (!sessionEntry.isDirectory()) continue;
      const sessionDir = path.join(sessionsDir, sessionEntry.name);
      for (const artifactEntry of await fs
        .readdir(sessionDir, { withFileTypes: true })
        .catch(() => [])) {
        if (!artifactEntry.isDirectory()) continue;
        const metaPath = path.join(sessionDir, artifactEntry.name, 'meta.json');
        const artifact = await this.readMetaFile(metaPath);
        if (artifact) {
          const metaFingerprint = await this.metaFingerprintForPath(metaPath);
          if (!metaFingerprint) continue;
          await this.cleanupUnreferencedVersionFiles(artifact);
          artifacts.push({
            artifact,
            bytes: await this.artifactDiskBytes(artifact),
            metaFingerprint,
          });
        } else if (!(await exists(metaPath)))
          orphanDirs.push(path.join(sessionDir, artifactEntry.name));
      }
    }

    const insert = db.prepare(`
      INSERT INTO artifacts
        (id, sessionId, surface, kind, title, currentVersion, createdAt, updatedAt, versionsJson, permissionsJson, metaPath, bytes, metaMtimeMs, metaSize)
      VALUES
        (@id, @sessionId, @surface, @kind, @title, @currentVersion, @createdAt, @updatedAt, @versionsJson, @permissionsJson, @metaPath, @bytes, @metaMtimeMs, @metaSize)
    `);
    const tx = db.transaction(
      (
        items: Array<{
          artifact: StoredArtifact;
          bytes: number;
          metaFingerprint: MetaFingerprint;
        }>,
      ) => {
        db.prepare('DELETE FROM artifacts').run();
        for (const item of items) {
          insert.run(this.catalogParams(item.artifact, item.bytes, item.metaFingerprint));
        }
      },
    );
    tx(artifacts);

    this.catalogValidated = true;
    for (const orphanDir of orphanDirs) {
      await fs.rm(orphanDir, { recursive: true, force: true }).catch((err) => {
        console.warn(
          '[ArtifactStore] orphan artifact cleanup failed:',
          err instanceof Error ? err.message : String(err),
        );
      });
    }
  }

  private async readMetaFile(metaPath: string): Promise<StoredArtifact | null> {
    try {
      const raw = await fs.readFile(metaPath, 'utf-8');
      const parsed = metaFileSchema.safeParse(JSON.parse(raw));
      if (!parsed.success) {
        console.warn(
          `[ArtifactStore] ${metaPath} schema invalid, skipping:`,
          parsed.error.issues.map((i) => i.path.join('.')).join(', '),
        );
        return null;
      }
      return parsed.data.artifact;
    } catch (err) {
      if (!isNotFound(err)) {
        console.warn(
          '[ArtifactStore] meta read failed:',
          err instanceof Error ? err.message : String(err),
        );
      }
      return null;
    }
  }

  /** C13: find an existing artifact id to version by (sessionId, title, kind) — most-recent first. */
  private findDedupeMatchId(
    sessionId: string,
    dedupeKey: { title: string; kind: ArtifactKindT; htmlFamily?: boolean },
  ): string | undefined {
    const isHtml = (k: ArtifactKindT): boolean => k === 'html' || k === 'interactive-html';
    // queryCatalogRows returns rows ORDER BY updatedAt DESC → prefer the most recently touched match.
    const match = this.queryCatalogRows({ sessionId }).find(
      (r) =>
        r.title === dedupeKey.title &&
        (r.kind === dedupeKey.kind ||
          (dedupeKey.htmlFamily === true && isHtml(r.kind) && isHtml(dedupeKey.kind))),
    );
    return match?.id;
  }

  private queryCatalogRows(filter?: {
    sessionId?: string;
    surface?: 'code' | 'partner';
  }): CatalogRow[] {
    const clauses: string[] = [];
    const params: Record<string, string> = {};
    if (filter?.sessionId) {
      clauses.push('sessionId = @sessionId');
      params.sessionId = filter.sessionId;
    }
    if (filter?.surface) {
      clauses.push('surface = @surface');
      params.surface = filter.surface;
    }
    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    return this.requireDb()
      .prepare(
        `SELECT id, sessionId, surface, kind, title, currentVersion, createdAt, updatedAt, versionsJson, permissionsJson, metaPath, bytes, metaMtimeMs, metaSize
         FROM artifacts ${where} ORDER BY updatedAt DESC`,
      )
      .all(params) as CatalogRow[];
  }

  private catalogRowsHaveInvalidMetadata(rows: readonly CatalogRow[]): boolean {
    return rows.some((row) => this.artifactFromCatalogRow(row) === null);
  }

  private async catalogRowsNeedRebuild(rows: readonly CatalogRow[]): Promise<boolean> {
    if (this.catalogRowsHaveInvalidMetadata(rows)) return true;
    for (const row of rows) {
      const metaPath = resolveInside(this.v2Root, row.metaPath);
      const fingerprint = await this.metaFingerprintForPath(metaPath);
      if (!fingerprint) return true;
      if (fingerprint.metaMtimeMs !== row.metaMtimeMs || fingerprint.metaSize !== row.metaSize) {
        return true;
      }
    }
    return false;
  }

  private async loadArtifactById(id: string): Promise<StoredArtifact | null> {
    const row = this.requireDb()
      .prepare(
        'SELECT id, sessionId, surface, kind, title, currentVersion, createdAt, updatedAt, versionsJson, permissionsJson, metaPath, bytes, metaMtimeMs, metaSize FROM artifacts WHERE id = ?',
      )
      .get(id) as CatalogRow | undefined;
    if (!row) return null;
    const metaPath = resolveInside(this.v2Root, row.metaPath);
    return this.readMetaFile(metaPath);
  }

  private artifactFromCatalogRow(row: CatalogRow): StoredArtifact | null {
    try {
      const versions = JSON.parse(row.versionsJson);
      const permissions = row.permissionsJson ? JSON.parse(row.permissionsJson) : undefined;
      const parsed = storedArtifactSchema.safeParse({
        id: row.id,
        sessionId: row.sessionId,
        surface: row.surface,
        kind: row.kind,
        title: row.title,
        ...(permissions !== undefined ? { permissions } : {}),
        currentVersion: row.currentVersion,
        versions,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      });
      return parsed.success ? parsed.data : null;
    } catch {
      return null;
    }
  }

  private async materializeVersion(
    artifact: Pick<StoredArtifact, 'id' | 'sessionId' | 'kind'>,
    input: UpsertInput,
    version: number,
    createdAt: number,
  ): Promise<StoredVersion> {
    if (input.content !== undefined) {
      const artifactDir = this.artifactDir(artifact);
      const contentFile = path.posix.join('versions', versionFileName(artifact.kind, version));
      await atomicWriteText(resolveInside(artifactDir, contentFile), input.content);
      return {
        v: version,
        createdAt,
        contentFile,
        ...(input.summary !== undefined ? { summary: input.summary } : {}),
      };
    }
    return {
      v: version,
      createdAt,
      ...(input.path !== undefined ? { path: input.path } : {}),
      ...(input.summary !== undefined ? { summary: input.summary } : {}),
    };
  }

  private async materializeGeneratedFileVersion(
    artifact: Pick<StoredArtifact, 'id' | 'sessionId' | 'kind' | 'title'>,
    input: GeneratedFileUpsertInput,
    version: number,
    createdAt: number,
  ): Promise<StoredVersion> {
    const artifactDir = this.artifactDir(artifact);
    const storedFile = path.posix.join('versions', versionFileName(artifact.kind, version));
    await atomicWriteBuffer(resolveInside(artifactDir, storedFile), input.bytes);
    return {
      v: version,
      createdAt,
      storedFile,
      filename: input.filename ?? safeDisplayFilename(input.title || artifact.title, artifact.kind),
      contentHash: sha256ContentHash(input.bytes),
      ...(input.summary !== undefined ? { summary: input.summary } : {}),
    };
  }

  private async writeArtifactMeta(artifact: StoredArtifact): Promise<MetaFingerprint> {
    const payload = JSON.stringify({ version: 2, artifact });
    const metaPath = path.join(this.artifactDir(artifact), 'meta.json');
    await atomicWriteText(metaPath, payload);
    const fingerprint = await this.metaFingerprintForPath(metaPath);
    if (!fingerprint) throw new Error('artifact metadata disappeared after write');
    return fingerprint;
  }

  private async metaFingerprintForPath(metaPath: string): Promise<MetaFingerprint | null> {
    try {
      const stat = await fs.stat(metaPath);
      if (!stat.isFile()) return null;
      return {
        metaMtimeMs: Math.round(stat.mtimeMs),
        metaSize: stat.size,
      };
    } catch (err) {
      if (isNotFound(err)) return null;
      throw err;
    }
  }

  private async cleanupUnreferencedVersionFiles(artifact: StoredArtifact): Promise<void> {
    const versionsDir = path.join(this.artifactDir(artifact), 'versions');
    const allowed = new Set(
      artifact.versions
        .flatMap((version) => [version.contentFile, version.storedFile])
        .filter((contentFile): contentFile is string => contentFile !== undefined),
    );

    let entries;
    try {
      entries = await fs.readdir(versionsDir, { withFileTypes: true });
    } catch (err) {
      if (isNotFound(err)) return;
      throw err;
    }

    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const rel = path.posix.join('versions', entry.name);
      if (allowed.has(rel)) continue;
      await fs.unlink(path.join(versionsDir, entry.name)).catch((err) => {
        console.warn(
          '[ArtifactStore] unreferenced version cleanup failed:',
          err instanceof Error ? err.message : String(err),
        );
      });
    }
  }

  private async upsertCatalogWithRecovery(
    artifact: StoredArtifact,
    bytes: number,
    metaFingerprint: MetaFingerprint,
  ): Promise<void> {
    try {
      this.upsertCatalog(artifact, bytes, metaFingerprint);
    } catch (err) {
      try {
        await this.rebuildCatalogFromDisk();
        return;
      } catch (rebuildErr) {
        console.warn(
          '[ArtifactStore] catalog recovery after upsert failed:',
          rebuildErr instanceof Error ? rebuildErr.message : String(rebuildErr),
        );
      }
      throw err;
    }
  }

  private upsertCatalog(
    artifact: StoredArtifact,
    bytes: number,
    metaFingerprint: MetaFingerprint,
  ): void {
    this.requireDb()
      .prepare(
        `
        INSERT INTO artifacts
          (id, sessionId, surface, kind, title, currentVersion, createdAt, updatedAt, versionsJson, permissionsJson, metaPath, bytes, metaMtimeMs, metaSize)
        VALUES
          (@id, @sessionId, @surface, @kind, @title, @currentVersion, @createdAt, @updatedAt, @versionsJson, @permissionsJson, @metaPath, @bytes, @metaMtimeMs, @metaSize)
        ON CONFLICT(id) DO UPDATE SET
          sessionId = excluded.sessionId,
          surface = excluded.surface,
          kind = excluded.kind,
          title = excluded.title,
          currentVersion = excluded.currentVersion,
          createdAt = excluded.createdAt,
          updatedAt = excluded.updatedAt,
          versionsJson = excluded.versionsJson,
          permissionsJson = excluded.permissionsJson,
          metaPath = excluded.metaPath,
          bytes = excluded.bytes,
          metaMtimeMs = excluded.metaMtimeMs,
          metaSize = excluded.metaSize
      `,
      )
      .run(this.catalogParams(artifact, bytes, metaFingerprint));
  }

  private catalogParams(
    artifact: StoredArtifact,
    bytes: number,
    metaFingerprint: MetaFingerprint,
  ): CatalogRow {
    return {
      id: artifact.id,
      sessionId: artifact.sessionId,
      surface: artifact.surface,
      kind: artifact.kind,
      title: artifact.title,
      currentVersion: artifact.currentVersion,
      createdAt: artifact.createdAt,
      updatedAt: artifact.updatedAt,
      versionsJson: JSON.stringify(artifact.versions),
      permissionsJson:
        artifact.permissions !== undefined ? JSON.stringify(artifact.permissions) : null,
      metaPath: relativePortable(this.v2Root, path.join(this.artifactDir(artifact), 'meta.json')),
      bytes,
      metaMtimeMs: metaFingerprint.metaMtimeMs,
      metaSize: metaFingerprint.metaSize,
    };
  }

  private updateCatalogBytes(id: string, bytes: number): void {
    this.requireDb().prepare('UPDATE artifacts SET bytes = ? WHERE id = ?').run(bytes, id);
  }

  private catalogCount(): number {
    const row = this.requireDb().prepare('SELECT COUNT(*) AS n FROM artifacts').get() as
      | { n: number }
      | undefined;
    return row?.n ?? 0;
  }

  private async artifactDiskBytes(artifact: StoredArtifact): Promise<number> {
    return directoryBytes(this.artifactDir(artifact));
  }

  private async deleteArtifactLocked(artifact: StoredArtifact): Promise<void> {
    this.requireDb().prepare('DELETE FROM artifacts WHERE id = ?').run(artifact.id);
    try {
      await fs.rm(this.artifactDir(artifact), { recursive: true, force: true });
    } catch (err) {
      await this.rebuildCatalogFromDisk().catch((rebuildErr) => {
        console.warn(
          '[ArtifactStore] catalog recovery after delete failed:',
          rebuildErr instanceof Error ? rebuildErr.message : String(rebuildErr),
        );
      });
      throw err;
    }
  }

  private async enforceLimits(
    options: { exemptId?: string; reserveArtifacts?: number; reserveBytes?: number } = {},
  ): Promise<void> {
    const reserveArtifacts = options.reserveArtifacts ?? 0;
    const reserveBytes = options.reserveBytes ?? 0;
    const rows = this.queryCatalogRows();
    let sized = rows
      .map((row) => {
        const artifact = this.artifactFromCatalogRow(row);
        if (!artifact) return null;
        return { artifact, bytes: Math.max(0, Number(row.bytes) || 0) };
      })
      .filter((item): item is { artifact: StoredArtifact; bytes: number } => item !== null);

    let count = sized.length;
    let totalBytes = sized.reduce((sum, item) => sum + item.bytes, 0);
    let overHighWater =
      count + reserveArtifacts > this.limits.maxArtifacts ||
      totalBytes + reserveBytes > this.limits.maxBytes;
    if (!overHighWater) return;

    if (totalBytes + reserveBytes > this.limits.maxBytes) {
      const refreshed: Array<{ artifact: StoredArtifact; bytes: number }> = [];
      for (const item of sized) {
        const bytes = await this.artifactDiskBytes(item.artifact);
        if (bytes !== item.bytes) this.updateCatalogBytes(item.artifact.id, bytes);
        refreshed.push({ artifact: item.artifact, bytes });
      }
      sized = refreshed;
      count = sized.length;
      totalBytes = sized.reduce((sum, item) => sum + item.bytes, 0);
      overHighWater =
        count + reserveArtifacts > this.limits.maxArtifacts ||
        totalBytes + reserveBytes > this.limits.maxBytes;
      if (!overHighWater) return;
    }

    const candidates = sized
      .filter((item) => item.artifact.id !== options.exemptId)
      .sort((a, b) => a.artifact.updatedAt - b.artifact.updatedAt);

    let removed = 0;
    for (const candidate of candidates) {
      const countAtTarget = count + reserveArtifacts <= this.limits.targetArtifacts;
      const bytesAtTarget = totalBytes + reserveBytes <= this.limits.targetBytes;
      if (countAtTarget && bytesAtTarget) break;
      try {
        await this.deleteArtifactLocked(candidate.artifact);
        count -= 1;
        totalBytes -= candidate.bytes;
        removed += 1;
      } catch (err) {
        console.warn(
          '[ArtifactStore] artifact quota cleanup failed:',
          err instanceof Error ? err.message : String(err),
        );
      }
    }

    if (removed > 0) {
      console.info(
        `[ArtifactStore] pruned ${removed} old artifact(s); count=${count}, bytes=${totalBytes}`,
      );
    }
    if (
      count + reserveArtifacts > this.limits.maxArtifacts ||
      totalBytes + reserveBytes > this.limits.maxBytes
    ) {
      console.warn('[ArtifactStore] artifact store remains above quota after best-effort cleanup');
    }
  }

  private artifactDir(a: Pick<StoredArtifact, 'sessionId' | 'id'>): string {
    return path.join(this.v2Root, 'sessions', sessionKey(a.sessionId), assertSafeArtifactId(a.id));
  }

  private requireDb(): BetterSqlite3.Database {
    if (!this.db) throw new Error('artifact catalog is not initialized');
    return this.db;
  }

  /** Serialize read-modify-write so concurrent callers don't clobber each other. */
  private async mutate<R>(apply: () => Promise<R>): Promise<R> {
    const prev = this.writeLock;
    let release: () => void = () => {};
    this.writeLock = new Promise((resolve) => {
      release = resolve;
    });
    await prev;
    try {
      return await apply();
    } finally {
      release();
    }
  }
}

export const artifactStore = new ArtifactStore();
