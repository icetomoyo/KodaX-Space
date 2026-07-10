import { promises as fs } from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { z } from 'zod';
import { getSpaceDataDir } from './data-paths.js';
import { replaceFileWithoutFollowingAliases } from './atomic-file.js';

const sessionTitleOverrideSchema = z
  .object({
    version: z.literal(1),
    sessionId: z.string().min(1).max(512),
    title: z.string().min(1).max(256),
    updatedAt: z.string().min(1),
  })
  .strict();

interface SessionTitleOverrideFile {
  readonly version: 1;
  readonly sessionId: string;
  readonly title: string;
  readonly updatedAt: string;
}

export interface SessionTitleStoreImpl {
  read(sessionId: string): Promise<string | null>;
  set(sessionId: string, title: string): Promise<void>;
  delete(sessionId: string): Promise<void>;
}

function titleFileName(sessionId: string): string | null {
  if (sessionId.length === 0 || sessionId.length > 512) return null;
  return `${crypto.createHash('sha256').update(sessionId).digest('hex')}.json`;
}

export class SessionTitleStore implements SessionTitleStoreImpl {
  private readonly writeLocks = new Map<string, Promise<void>>();

  constructor(private readonly dir = path.join(getSpaceDataDir(), 'session-title-overrides')) {}

  private filePath(sessionId: string): string | null {
    const name = titleFileName(sessionId);
    return name === null ? null : path.join(this.dir, name);
  }

  async read(sessionId: string): Promise<string | null> {
    const filePath = this.filePath(sessionId);
    if (filePath === null) return null;
    try {
      const raw = await fs.readFile(filePath, 'utf-8');
      const parsed = sessionTitleOverrideSchema.safeParse(JSON.parse(raw));
      if (!parsed.success || parsed.data.sessionId !== sessionId) return null;
      return parsed.data.title;
    } catch (err) {
      const e = err as NodeJS.ErrnoException;
      if (e.code !== 'ENOENT') {
        console.warn(`[SessionTitleStore] read failed for ${sessionId}:`, e.message);
      }
      return null;
    }
  }

  async set(sessionId: string, title: string): Promise<void> {
    const filePath = this.filePath(sessionId);
    if (filePath === null) return;
    await this.enqueueSessionWrite(sessionId, () => this.setUnlocked(sessionId, filePath, title));
  }

  private async setUnlocked(sessionId: string, filePath: string, title: string): Promise<void> {
    try {
      await fs.mkdir(this.dir, { recursive: true, mode: 0o700 });
      const persisted: SessionTitleOverrideFile = {
        version: 1,
        sessionId,
        title,
        updatedAt: new Date().toISOString(),
      };
      await replaceFileWithoutFollowingAliases(
        filePath,
        Buffer.from(JSON.stringify(persisted, null, 2), 'utf8'),
        'session title changed during atomic replacement',
      );
    } catch (err) {
      console.warn(
        `[SessionTitleStore] persist failed for ${sessionId}:`,
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
          `[SessionTitleStore] delete failed for ${sessionId}:`,
          err instanceof Error ? err.message : err,
        );
      });
    });
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

const defaultSessionTitleStore = new SessionTitleStore();
let activeSessionTitleStore: SessionTitleStoreImpl = defaultSessionTitleStore;

export function getSessionTitleStore(): SessionTitleStoreImpl {
  return activeSessionTitleStore;
}

export function setSessionTitleStoreForTesting(store: SessionTitleStoreImpl | null): void {
  activeSessionTitleStore = store ?? defaultSessionTitleStore;
}
