import { promises as fs } from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { z } from 'zod';
import type { SessionLocalNotice } from '@kodax-space/space-ipc-schema';
import { getSpaceDataDir } from './data-paths.js';
import { replaceFileWithoutFollowingAliases } from './atomic-file.js';

const MAX_LOCAL_NOTICES_PER_SESSION = 1000;
const MAX_LOCAL_NOTICE_TEXT = 262_144;

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

function normalizeNotices(notices: readonly SessionLocalNotice[]): readonly SessionLocalNotice[] {
  const byId = new Map<string, SessionLocalNotice>();
  for (const notice of notices) {
    byId.set(notice.id, normalizeNotice(notice));
  }
  return [...byId.values()]
    .sort((a, b) => a.sentAt - b.sentAt || a.id.localeCompare(b.id))
    .slice(-MAX_LOCAL_NOTICES_PER_SESSION);
}

export class SessionLocalNoticeStore {
  private readonly writeLocks = new Map<string, Promise<void>>();

  constructor(private readonly dir = path.join(getSpaceDataDir(), 'session-local-notices')) {}

  private filePath(sessionId: string): string | null {
    const name = noticeFileName(sessionId);
    return name === null ? null : path.join(this.dir, name);
  }

  async list(sessionId: string): Promise<readonly SessionLocalNotice[]> {
    const filePath = this.filePath(sessionId);
    if (filePath === null) return [];
    try {
      const raw = await fs.readFile(filePath, 'utf-8');
      const parsed = persistedLocalNoticesSchema.safeParse(JSON.parse(raw));
      if (!parsed.success || parsed.data.sessionId !== sessionId) return [];
      return normalizeNotices(parsed.data.notices);
    } catch (err) {
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
      this.appendUnlocked(sessionId, filePath, notice),
    );
  }

  private async appendUnlocked(
    sessionId: string,
    filePath: string,
    notice: SessionLocalNotice,
  ): Promise<void> {
    try {
      const current = await this.list(sessionId);
      await this.writeUnlocked(sessionId, filePath, [...current, notice]);
    } catch (err) {
      console.warn(
        `[SessionLocalNoticeStore] append failed for ${sessionId}:`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  async replace(sessionId: string, notices: readonly SessionLocalNotice[]): Promise<void> {
    const filePath = this.filePath(sessionId);
    if (filePath === null) return;
    await this.enqueueSessionWrite(sessionId, () =>
      this.replaceUnlocked(sessionId, filePath, notices),
    );
  }

  private async replaceUnlocked(
    sessionId: string,
    filePath: string,
    notices: readonly SessionLocalNotice[],
  ): Promise<void> {
    try {
      const normalized = normalizeNotices(notices);
      if (normalized.length === 0) {
        await fs.rm(filePath, { force: true });
        return;
      }
      await this.writeUnlocked(sessionId, filePath, normalized);
    } catch (err) {
      console.warn(
        `[SessionLocalNoticeStore] replace failed for ${sessionId}:`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  async delete(sessionId: string): Promise<void> {
    const filePath = this.filePath(sessionId);
    if (filePath === null) return;
    await this.enqueueSessionWrite(sessionId, async () => {
      await fs.rm(filePath, { force: true }).catch((err: unknown) => {
        console.warn(
          `[SessionLocalNoticeStore] delete failed for ${sessionId}:`,
          err instanceof Error ? err.message : err,
        );
      });
    });
  }

  private async writeUnlocked(
    sessionId: string,
    filePath: string,
    notices: readonly SessionLocalNotice[],
  ): Promise<void> {
    await fs.mkdir(this.dir, { recursive: true, mode: 0o700 });
    const persisted: PersistedLocalNoticesFile = {
      version: 1,
      sessionId,
      notices: normalizeNotices(notices),
      updatedAt: new Date().toISOString(),
    };
    await replaceFileWithoutFollowingAliases(
      filePath,
      Buffer.from(JSON.stringify(persisted, null, 2), 'utf8'),
      'session local notices changed during atomic replacement',
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

export function setSessionLocalNoticeStoreForTesting(store: SessionLocalNoticeStore | null): void {
  activeSessionLocalNoticeStore = store ?? defaultSessionLocalNoticeStore;
}
