import { promises as fs } from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { z } from 'zod';
import type {
  AgentMode,
  AutoModeEngine,
  PermissionMode,
  ReasoningMode,
} from '@kodax-space/space-ipc-schema';
import { getSpaceDataDir } from './data-paths.js';
import { replaceFileIfUnchanged, writeNewFileExclusive } from './atomic-file.js';

const MAX_RUNTIME_FILE_BYTES = 64 * 1024;

const sessionRuntimeSchema = z
  .object({
    version: z.literal(1),
    sessionId: z.string().min(1).max(128),
    provider: z.string().min(1).max(128).optional(),
    model: z.string().min(1).max(512).optional(),
    thinking: z.boolean().optional(),
    permissionMode: z.enum(['plan', 'accept-edits', 'auto']).optional(),
    autoModeEngine: z.enum(['llm', 'rules']).optional(),
    reasoningMode: z.enum(['off', 'auto', 'quick', 'balanced', 'deep']).optional(),
    agentMode: z.enum(['ama', 'amaw', 'sa']).optional(),
    updatedAt: z.string().min(1),
  })
  .strict();

export interface SessionRuntimeSettings {
  readonly provider?: string;
  readonly model?: string;
  readonly thinking?: boolean;
  readonly permissionMode?: PermissionMode;
  readonly autoModeEngine?: AutoModeEngine;
  readonly reasoningMode?: ReasoningMode;
  readonly agentMode?: AgentMode;
}

interface SessionRuntimeFile extends SessionRuntimeSettings {
  readonly version: 1;
  readonly sessionId: string;
  readonly updatedAt: string;
}

function isSafeSessionId(sessionId: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(sessionId);
}

type RuntimeFileState =
  | { readonly kind: 'missing' }
  | {
      readonly kind: 'valid';
      readonly settings: SessionRuntimeSettings;
      readonly hash: string;
    }
  | { readonly kind: 'invalid'; readonly reason: string };

function sha256(bytes: Buffer): string {
  return `sha256:${crypto.createHash('sha256').update(bytes).digest('hex')}`;
}

function settingsFromParsed(parsed: z.infer<typeof sessionRuntimeSchema>): SessionRuntimeSettings {
  return {
    ...(parsed.provider !== undefined ? { provider: parsed.provider } : {}),
    ...(parsed.model !== undefined ? { model: parsed.model } : {}),
    ...(parsed.thinking !== undefined ? { thinking: parsed.thinking } : {}),
    ...(parsed.permissionMode !== undefined ? { permissionMode: parsed.permissionMode } : {}),
    ...(parsed.autoModeEngine !== undefined ? { autoModeEngine: parsed.autoModeEngine } : {}),
    ...(parsed.reasoningMode !== undefined ? { reasoningMode: parsed.reasoningMode } : {}),
    ...(parsed.agentMode !== undefined ? { agentMode: parsed.agentMode } : {}),
  };
}

export class SessionRuntimeStore {
  private readonly writeLocks = new Map<string, Promise<void>>();

  constructor(private readonly dir = path.join(getSpaceDataDir(), 'session-runtime')) {}

  private filePath(sessionId: string): string | null {
    if (!isSafeSessionId(sessionId)) return null;
    return path.join(this.dir, `${sessionId}.json`);
  }

  private async inspect(sessionId: string, filePath: string): Promise<RuntimeFileState> {
    try {
      const stat = await fs.lstat(filePath);
      if (stat.isSymbolicLink() || !stat.isFile() || stat.size > MAX_RUNTIME_FILE_BYTES) {
        return { kind: 'invalid', reason: 'not a bounded regular file' };
      }
      const bytes = await fs.readFile(filePath);
      if (bytes.length > MAX_RUNTIME_FILE_BYTES) {
        return { kind: 'invalid', reason: 'file exceeds size limit' };
      }
      let json: unknown;
      try {
        json = JSON.parse(bytes.toString('utf-8'));
      } catch {
        return { kind: 'invalid', reason: 'malformed JSON' };
      }
      const parsed = sessionRuntimeSchema.safeParse(json);
      if (!parsed.success || parsed.data.sessionId !== sessionId) {
        return { kind: 'invalid', reason: 'schema or session id mismatch' };
      }
      return {
        kind: 'valid',
        settings: settingsFromParsed(parsed.data),
        hash: sha256(bytes),
      };
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') return { kind: 'missing' };
      return {
        kind: 'invalid',
        reason: err instanceof Error ? err.message : String(err),
      };
    }
  }

  async read(sessionId: string): Promise<SessionRuntimeSettings | null> {
    const filePath = this.filePath(sessionId);
    if (!filePath) return null;
    const state = await this.inspect(sessionId, filePath);
    if (state.kind === 'valid') return state.settings;
    if (state.kind === 'invalid') {
      console.warn(`[SessionRuntimeStore] read failed for ${sessionId}:`, state.reason);
    }
    return null;
  }

  async set(sessionId: string, patch: SessionRuntimeSettings): Promise<boolean> {
    const filePath = this.filePath(sessionId);
    if (!filePath) return false;
    let persisted = false;
    await this.enqueueSessionWrite(sessionId, async () => {
      persisted = await this.setUnlocked(sessionId, filePath, patch);
    });
    return persisted;
  }

  private async setUnlocked(
    sessionId: string,
    filePath: string,
    patch: SessionRuntimeSettings,
  ): Promise<boolean> {
    try {
      const previous = await this.inspect(sessionId, filePath);
      if (previous.kind === 'invalid') {
        throw new Error(`refusing to overwrite invalid state: ${previous.reason}`);
      }
      const merged = { ...(previous.kind === 'valid' ? previous.settings : {}), ...patch };
      const next: SessionRuntimeFile = {
        version: 1,
        sessionId,
        ...(merged.provider !== undefined ? { provider: merged.provider } : {}),
        ...(merged.model !== undefined ? { model: merged.model } : {}),
        ...(merged.thinking !== undefined ? { thinking: merged.thinking } : {}),
        ...(merged.permissionMode !== undefined ? { permissionMode: merged.permissionMode } : {}),
        ...(merged.autoModeEngine !== undefined ? { autoModeEngine: merged.autoModeEngine } : {}),
        ...(merged.reasoningMode !== undefined ? { reasoningMode: merged.reasoningMode } : {}),
        ...(merged.agentMode !== undefined ? { agentMode: merged.agentMode } : {}),
        updatedAt: new Date().toISOString(),
      };
      await fs.mkdir(this.dir, { recursive: true, mode: 0o700 });
      const bytes = Buffer.from(JSON.stringify(next, null, 2), 'utf-8');
      if (previous.kind === 'missing') {
        await writeNewFileExclusive(filePath, bytes, 'session runtime state changed concurrently');
      } else {
        await replaceFileIfUnchanged(
          filePath,
          bytes,
          previous.hash,
          'session runtime state changed concurrently',
          MAX_RUNTIME_FILE_BYTES,
        );
      }
      return true;
    } catch (err) {
      console.warn(
        `[SessionRuntimeStore] persist failed for ${sessionId}:`,
        err instanceof Error ? err.message : err,
      );
      return false;
    }
  }

  async delete(sessionId: string): Promise<void> {
    const filePath = this.filePath(sessionId);
    if (!filePath) return;
    await this.enqueueSessionWrite(sessionId, async () => {
      await fs.rm(filePath, { force: true }).catch((err: unknown) => {
        console.warn(
          `[SessionRuntimeStore] delete failed for ${sessionId}:`,
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

const defaultSessionRuntimeStore = new SessionRuntimeStore();
let activeSessionRuntimeStore: SessionRuntimeStore = defaultSessionRuntimeStore;

export function getSessionRuntimeStore(): SessionRuntimeStore {
  return activeSessionRuntimeStore;
}

export function setSessionRuntimeStoreForTesting(store: SessionRuntimeStore | null): void {
  activeSessionRuntimeStore = store ?? defaultSessionRuntimeStore;
}
