import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { partnerSourceSchema, type PartnerSourceT } from '@kodax-space/space-ipc-schema';
import { replaceFileWithoutFollowingAliases } from './atomic-file.js';
import { getSpaceDataDir } from './data-paths.js';

const MAX_SOURCES_PER_SESSION = 128;

const fileSchema = z.object({
  version: z.literal(1),
  sources: z.array(partnerSourceSchema).max(10_000),
});

type PartnerSourcesFile = z.infer<typeof fileSchema>;

export interface PartnerSourceAddInput {
  readonly sessionId: string;
  readonly projectRoot: string;
  readonly path: string;
  readonly targetKind: PartnerSourceT['targetKind'];
  readonly label?: string;
}

function defaultLabel(relPath: string): string {
  return path.posix.basename(relPath) || relPath;
}

function sourceKey(
  source: Pick<PartnerSourceT, 'sessionId' | 'kind' | 'projectRoot' | 'path'>,
): string {
  return `${source.sessionId}\0${source.kind}\0${source.projectRoot}\0${source.path}`;
}

async function atomicWriteJson(filePath: string, value: PartnerSourcesFile): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  await replaceFileWithoutFollowingAliases(
    filePath,
    Buffer.from(JSON.stringify(value, null, 2), 'utf8'),
    'Partner source registry changed during atomic replacement',
  );
}

export class PartnerSourceStore {
  private cached: PartnerSourceT[] | null = null;
  private writeLock: Promise<void> = Promise.resolve();

  constructor(
    private readonly filePath: string = path.join(getSpaceDataDir(), 'partner-sources.json'),
  ) {}

  async list(sessionId: string): Promise<PartnerSourceT[]> {
    const all = await this.load();
    return all
      .filter((source) => source.sessionId === sessionId)
      .sort((a, b) => a.addedAt - b.addedAt);
  }

  async get(sessionId: string, sourceId: string): Promise<PartnerSourceT | null> {
    const all = await this.load();
    return all.find((source) => source.sessionId === sessionId && source.id === sourceId) ?? null;
  }

  async addWorkspacePath(input: PartnerSourceAddInput): Promise<PartnerSourceT> {
    return this.mutate((current) => {
      const nextInput = {
        sessionId: input.sessionId,
        kind: 'workspace_path' as const,
        projectRoot: input.projectRoot,
        path: input.path,
      };
      const existing = current.find((source) => sourceKey(source) === sourceKey(nextInput));
      if (existing) return { next: current, result: existing };

      const source: PartnerSourceT = {
        ...nextInput,
        id: `src_${randomUUID()}`,
        targetKind: input.targetKind,
        label: input.label?.trim() || defaultLabel(input.path),
        addedAt: Date.now(),
      };
      const sessionSources = current.filter((item) => item.sessionId === input.sessionId);
      if (sessionSources.length >= MAX_SOURCES_PER_SESSION) {
        throw new Error(
          `Partner source limit reached for this session (${MAX_SOURCES_PER_SESSION})`,
        );
      }
      return { next: [...current, source], result: source };
    });
  }

  async remove(sessionId: string, sourceId: string): Promise<boolean> {
    return this.mutate((current) => {
      const next = current.filter(
        (source) => !(source.sessionId === sessionId && source.id === sourceId),
      );
      return { next, result: next.length !== current.length };
    });
  }

  invalidate(): void {
    this.cached = null;
  }

  private async load(): Promise<PartnerSourceT[]> {
    if (this.cached !== null) return [...this.cached];
    try {
      const raw = await fs.readFile(this.filePath, 'utf-8');
      const parsed = fileSchema.safeParse(JSON.parse(raw));
      if (!parsed.success) {
        throw new Error(
          `schema invalid: ${parsed.error.issues.map((issue) => issue.path.join('.')).join(', ')}`,
        );
      } else {
        this.cached = parsed.data.sources;
      }
    } catch (err) {
      if (err instanceof Error && 'code' in err && (err as { code: string }).code === 'ENOENT') {
        this.cached = [];
      } else {
        throw new Error(
          `Partner source store is corrupt or unreadable; refusing to overwrite it: ${err instanceof Error ? err.message : String(err)}`,
          { cause: err },
        );
      }
    }
    return [...this.cached];
  }

  private async mutate<R>(
    apply: (current: PartnerSourceT[]) => { next: PartnerSourceT[]; result: R },
  ): Promise<R> {
    const previous = this.writeLock;
    let release: () => void = () => {};
    this.writeLock = new Promise((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      const current = await this.load();
      const { next, result } = apply([...current]);
      await atomicWriteJson(this.filePath, { version: 1, sources: next });
      this.cached = next;
      return result;
    } finally {
      release();
    }
  }
}

export const partnerSourceStore = new PartnerSourceStore();
