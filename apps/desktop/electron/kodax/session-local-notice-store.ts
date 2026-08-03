import { promises as fs } from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { z } from 'zod';
import type { SessionLocalNotice } from '@kodax-space/space-ipc-schema';
import { getSpaceDataDir } from './data-paths.js';
import {
  AtomicFileTransactionError,
  type ConditionalFileMutationTestHooks,
  removeFileIfUnchanged,
  replaceFileIfUnchanged,
  retireFileTransactionBackups,
  withFileTransactionLock,
  writeNewFileExclusive,
} from './atomic-file.js';

const MAX_LOCAL_NOTICES_PER_SESSION = 1000;
const MAX_LOCAL_NOTICE_TEXT = 262_144;
export const MAX_LOCAL_NOTICE_FILE_BYTES = 8 * 1024 * 1024;
const MAX_LOCAL_NOTICE_LEGACY_READ_BYTES = 16 * 1024 * 1024;
const MAX_CONCURRENT_APPEND_RETRIES = 16;
const LOCAL_NOTICE_CONFLICT_MESSAGE = 'session local notices changed during atomic mutation';

const persistedNoticeSchema = z
  .object({
    id: z.string().min(1).max(128),
    content: z.string().max(MAX_LOCAL_NOTICE_TEXT),
    sentAt: z.number().int().nonnegative(),
    variant: z.enum(['echo', 'output']).optional(),
  })
  .strict();

const persistedLocalNoticesSchema = z
  .object({
    version: z.literal(1),
    sessionId: z.string().min(1),
    notices: z.array(persistedNoticeSchema).max(MAX_LOCAL_NOTICES_PER_SESSION),
    updatedAt: z.string().min(1),
  })
  .strict();

interface PersistedLocalNoticesFile {
  readonly version: 1;
  readonly sessionId: string;
  readonly notices: readonly SessionLocalNotice[];
  readonly updatedAt: string;
}

interface PersistedLocalNoticesSnapshot {
  readonly notices: readonly SessionLocalNotice[];
  readonly hash: string | null;
}

/** @internal Deterministic race controls used only by the persistence tests. */
export interface SessionLocalNoticeStoreTestHooks {
  readonly beforeAppendCommit?: (sessionId: string, attempt: number) => void | Promise<void>;
  readonly beforeReplaceCommit?: (sessionId: string) => void | Promise<void>;
  readonly beforeTruncateCommit?: (sessionId: string, attempt: number) => void | Promise<void>;
  readonly beforeDeleteCommit?: (sessionId: string, filePath: string) => void | Promise<void>;
  readonly atomicMutation?: ConditionalFileMutationTestHooks;
}

function hashBytes(bytes: Buffer): string {
  return `sha256:${crypto.createHash('sha256').update(bytes).digest('hex')}`;
}

function isConcurrentMutationError(error: unknown): boolean {
  return error instanceof Error && error.message.includes(LOCAL_NOTICE_CONFLICT_MESSAGE);
}

function noticeFileName(sessionId: string): string | null {
  if (sessionId.length === 0 || sessionId.length > 512) return null;
  return `${crypto.createHash('sha256').update(sessionId).digest('hex')}.json`;
}

function normalizeNotice(notice: SessionLocalNotice): SessionLocalNotice {
  return {
    id: notice.id,
    content: notice.content,
    sentAt: notice.sentAt,
    ...(notice.variant !== undefined ? { variant: notice.variant } : {}),
  };
}

function normalizeNotices(
  notices: readonly SessionLocalNotice[],
  requiredNoticeId?: string,
): readonly SessionLocalNotice[] {
  const byId = new Map<string, SessionLocalNotice>();
  for (const notice of notices) {
    byId.set(notice.id, normalizeNotice(notice));
  }
  const sorted = [...byId.values()].sort((a, b) => a.sentAt - b.sentAt || a.id.localeCompare(b.id));
  if (sorted.length <= MAX_LOCAL_NOTICES_PER_SESSION) return sorted;

  const newest = sorted.slice(-MAX_LOCAL_NOTICES_PER_SESSION);
  if (requiredNoticeId === undefined || newest.some((notice) => notice.id === requiredNoticeId)) {
    return newest;
  }
  const required = byId.get(requiredNoticeId);
  if (required === undefined) return newest;
  return [required, ...sorted.slice(sorted.length - (MAX_LOCAL_NOTICES_PER_SESSION - 1))].sort(
    (a, b) => a.sentAt - b.sentAt || a.id.localeCompare(b.id),
  );
}

export class SessionLocalNoticeStore {
  private readonly writeLocks = new Map<string, Promise<void>>();

  constructor(
    private readonly dir = path.join(getSpaceDataDir(), 'session-local-notices'),
    private readonly testHooks: SessionLocalNoticeStoreTestHooks = {},
  ) {}

  private filePath(sessionId: string): string | null {
    const name = noticeFileName(sessionId);
    return name === null ? null : path.join(this.dir, name);
  }

  async list(sessionId: string): Promise<readonly SessionLocalNotice[]> {
    const filePath = this.filePath(sessionId);
    if (filePath === null) return [];
    try {
      return await withFileTransactionLock(filePath, LOCAL_NOTICE_CONFLICT_MESSAGE, () =>
        this.readPersisted(sessionId, filePath),
      );
    } catch (err) {
      if (err instanceof AtomicFileTransactionError) throw err;
      const e = err as NodeJS.ErrnoException;
      if (e.code !== 'ENOENT') {
        console.warn(`[SessionLocalNoticeStore] read failed for ${sessionId}:`, e.message);
      }
      return [];
    }
  }

  async append(sessionId: string, notice: SessionLocalNotice): Promise<void> {
    const filePath = this.filePath(sessionId);
    if (filePath === null) return;
    await this.enqueueSessionWrite(sessionId, () =>
      withFileTransactionLock(filePath, LOCAL_NOTICE_CONFLICT_MESSAGE, () =>
        this.appendUnlocked(sessionId, filePath, notice),
      ),
    );
  }

  private async appendUnlocked(
    sessionId: string,
    filePath: string,
    notice: SessionLocalNotice,
  ): Promise<void> {
    // The in-memory queue only serializes this process. Cross-process writers use an exact-byte
    // compare-and-swap so a losing append can re-read, merge, and retry instead of overwriting the
    // winner. Mutation reads remain strict: corrupt state is never treated as an empty store.
    for (let attempt = 0; attempt < MAX_CONCURRENT_APPEND_RETRIES; attempt += 1) {
      const current = await this.readPersistedSnapshot(sessionId, filePath);
      const bytes = this.serialize(sessionId, [...current.notices, notice], notice.id);
      await this.testHooks.beforeAppendCommit?.(sessionId, attempt);
      try {
        await this.commitSnapshot(filePath, bytes, current.hash);
        return;
      } catch (error) {
        if (!isConcurrentMutationError(error) || attempt === MAX_CONCURRENT_APPEND_RETRIES - 1) {
          throw error;
        }
      }
    }
    throw new Error(`${LOCAL_NOTICE_CONFLICT_MESSAGE}; retry budget exhausted`);
  }

  private async readPersisted(
    sessionId: string,
    filePath: string,
  ): Promise<readonly SessionLocalNotice[]> {
    return (await this.readPersistedSnapshot(sessionId, filePath)).notices;
  }

  private async readPersistedSnapshot(
    sessionId: string,
    filePath: string,
  ): Promise<PersistedLocalNoticesSnapshot> {
    try {
      const stat = await fs.lstat(filePath);
      if (!stat.isFile()) throw new Error('Session local notice store is not a regular file.');
      if (stat.size > MAX_LOCAL_NOTICE_LEGACY_READ_BYTES) {
        throw new Error('Session local notice store exceeds the bounded legacy read budget.');
      }
      const bytes = await fs.readFile(filePath);
      if (bytes.byteLength > MAX_LOCAL_NOTICE_LEGACY_READ_BYTES) {
        throw new Error('Session local notice store changed beyond the bounded read budget.');
      }
      const raw = bytes.toString('utf8');
      const parsed = persistedLocalNoticesSchema.safeParse(JSON.parse(raw));
      if (!parsed.success || parsed.data.sessionId !== sessionId) {
        throw new Error('Session local notice store is invalid or belongs to another Session.');
      }
      return {
        notices: normalizeNotices(parsed.data.notices),
        hash: hashBytes(bytes),
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return { notices: [], hash: null };
      }
      throw error;
    }
  }

  async replace(sessionId: string, notices: readonly SessionLocalNotice[]): Promise<void> {
    const filePath = this.filePath(sessionId);
    if (filePath === null) return;
    await this.enqueueSessionWrite(sessionId, () =>
      withFileTransactionLock(filePath, LOCAL_NOTICE_CONFLICT_MESSAGE, () =>
        this.replaceUnlocked(sessionId, filePath, notices),
      ),
    );
  }

  async truncateBefore(sessionId: string, cutoffSentAt: number): Promise<void> {
    const filePath = this.filePath(sessionId);
    if (filePath === null || !Number.isSafeInteger(cutoffSentAt) || cutoffSentAt < 0) return;
    await this.enqueueSessionWrite(sessionId, () =>
      withFileTransactionLock(filePath, LOCAL_NOTICE_CONFLICT_MESSAGE, () =>
        this.truncateBeforeUnlocked(sessionId, filePath, cutoffSentAt),
      ),
    );
  }

  private async truncateBeforeUnlocked(
    sessionId: string,
    filePath: string,
    cutoffSentAt: number,
  ): Promise<void> {
    for (let attempt = 0; attempt < MAX_CONCURRENT_APPEND_RETRIES; attempt += 1) {
      const current = await this.readPersistedSnapshot(sessionId, filePath);
      if (current.hash === null) return;
      const retained = current.notices.filter((notice) => notice.sentAt < cutoffSentAt);
      if (retained.length === current.notices.length) return;
      await this.testHooks.beforeTruncateCommit?.(sessionId, attempt);
      try {
        if (retained.length === 0) {
          await retireFileTransactionBackups(filePath);
          await removeFileIfUnchanged(
            filePath,
            current.hash,
            LOCAL_NOTICE_CONFLICT_MESSAGE,
            MAX_LOCAL_NOTICE_LEGACY_READ_BYTES,
            this.testHooks.atomicMutation,
          );
        } else {
          await this.commitSnapshot(filePath, this.serialize(sessionId, retained), current.hash);
        }
        return;
      } catch (error) {
        if (!isConcurrentMutationError(error) || attempt === MAX_CONCURRENT_APPEND_RETRIES - 1) {
          throw error;
        }
      }
    }
    throw new Error(`${LOCAL_NOTICE_CONFLICT_MESSAGE}; retry budget exhausted`);
  }

  private async replaceUnlocked(
    sessionId: string,
    filePath: string,
    notices: readonly SessionLocalNotice[],
  ): Promise<void> {
    // replace() is also a mutation boundary (rewind/fork reconciliation calls it). Validate an
    // existing file before either overwriting or removing it, otherwise list()'s fail-soft empty
    // result could turn corruption into silent history loss on the next reconciliation.
    const current = await this.readPersistedSnapshot(sessionId, filePath);
    const normalized = normalizeNotices(notices);
    await this.testHooks.beforeReplaceCommit?.(sessionId);
    if (normalized.length === 0) {
      if (current.hash !== null) {
        await retireFileTransactionBackups(filePath);
        await removeFileIfUnchanged(
          filePath,
          current.hash,
          LOCAL_NOTICE_CONFLICT_MESSAGE,
          MAX_LOCAL_NOTICE_LEGACY_READ_BYTES,
          this.testHooks.atomicMutation,
        );
      }
      return;
    }
    const bytes = this.serialize(sessionId, normalized);
    await this.commitSnapshot(filePath, bytes, current.hash);
  }

  async delete(sessionId: string): Promise<void> {
    const filePath = this.filePath(sessionId);
    if (filePath === null) return;
    await this.enqueueSessionWrite(sessionId, async () => {
      await withFileTransactionLock(filePath, LOCAL_NOTICE_CONFLICT_MESSAGE, async () => {
        await retireFileTransactionBackups(filePath);
        await this.testHooks.beforeDeleteCommit?.(sessionId, filePath);
        await fs.rm(filePath, { force: true });
      });
    });
  }

  private serialize(
    sessionId: string,
    notices: readonly SessionLocalNotice[],
    requiredNoticeId?: string,
  ): Buffer {
    const persisted: PersistedLocalNoticesFile = {
      version: 1,
      sessionId,
      notices: normalizeNotices(notices, requiredNoticeId),
      updatedAt: new Date().toISOString(),
    };
    const prefix = `{"version":1,"sessionId":${JSON.stringify(sessionId)},"notices":[`;
    const suffix = `],"updatedAt":${JSON.stringify(persisted.updatedAt)}}`;
    const fixedBytes = Buffer.byteLength(prefix, 'utf8') + Buffer.byteLength(suffix, 'utf8');
    const encodedNotices = persisted.notices.map((notice) => JSON.stringify(notice));
    const retainedIndexes = new Set<number>();
    let retainedBytes = fixedBytes;
    if (requiredNoticeId !== undefined) {
      const requiredIndex = persisted.notices.findIndex((notice) => notice.id === requiredNoticeId);
      if (requiredIndex < 0)
        throw new Error('Required local notice was lost during normalization.');
      const requiredBytes = Buffer.byteLength(encodedNotices[requiredIndex]!, 'utf8');
      if (retainedBytes + requiredBytes > MAX_LOCAL_NOTICE_FILE_BYTES) {
        throw new Error('Required local notice exceeds the persistence budget.');
      }
      retainedIndexes.add(requiredIndex);
      retainedBytes += requiredBytes;
    }
    for (let index = persisted.notices.length - 1; index >= 0; index -= 1) {
      if (retainedIndexes.has(index)) continue;
      const encoded = encodedNotices[index]!;
      const nextBytes = Buffer.byteLength(encoded, 'utf8') + (retainedIndexes.size > 0 ? 1 : 0);
      if (retainedBytes + nextBytes > MAX_LOCAL_NOTICE_FILE_BYTES) break;
      retainedIndexes.add(index);
      retainedBytes += nextBytes;
    }
    const retained = [...retainedIndexes]
      .sort((left, right) => left - right)
      .map((index) => encodedNotices[index]!);
    const serialized = `${prefix}${retained.join(',')}${suffix}`;
    return Buffer.from(serialized, 'utf8');
  }

  private async commitSnapshot(
    filePath: string,
    bytes: Buffer,
    expectedHash: string | null,
  ): Promise<void> {
    await fs.mkdir(this.dir, { recursive: true, mode: 0o700 });
    if (expectedHash === null) {
      await writeNewFileExclusive(filePath, bytes, LOCAL_NOTICE_CONFLICT_MESSAGE);
      return;
    }
    await replaceFileIfUnchanged(
      filePath,
      bytes,
      expectedHash,
      LOCAL_NOTICE_CONFLICT_MESSAGE,
      MAX_LOCAL_NOTICE_LEGACY_READ_BYTES,
      this.testHooks.atomicMutation,
    );
  }

  private async enqueueSessionWrite(sessionId: string, op: () => Promise<void>): Promise<void> {
    const previous = this.writeLocks.get(sessionId) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(op);
    this.writeLocks.set(sessionId, next);
    try {
      await next;
    } finally {
      if (this.writeLocks.get(sessionId) === next) {
        this.writeLocks.delete(sessionId);
      }
    }
  }
}

const defaultSessionLocalNoticeStore = new SessionLocalNoticeStore();
let activeSessionLocalNoticeStore: SessionLocalNoticeStore = defaultSessionLocalNoticeStore;

export function getSessionLocalNoticeStore(): SessionLocalNoticeStore {
  return activeSessionLocalNoticeStore;
}

/**
 * Make Space's visible side-store the first write boundary, then append the optional SDK audit
 * record. Ordinary conversation deliberately excludes client_notice entries, so reversing these
 * responsibilities would make an audit-success path disappear after restart.
 */
export async function appendSpaceOwnedLocalNotice(
  sessionId: string,
  notice: SessionLocalNotice,
  appendAudit: () => Promise<unknown>,
  store: Pick<SessionLocalNoticeStore, 'append'> = getSessionLocalNoticeStore(),
): Promise<void> {
  await store.append(sessionId, notice);
  try {
    await appendAudit();
  } catch (error) {
    console.warn(
      `[SessionLocalNoticeStore] optional SDK audit append failed for ${sessionId}:`,
      error instanceof Error ? error.message : 'unknown error',
    );
  }
}

export function setSessionLocalNoticeStoreForTesting(store: SessionLocalNoticeStore | null): void {
  activeSessionLocalNoticeStore = store ?? defaultSessionLocalNoticeStore;
}
