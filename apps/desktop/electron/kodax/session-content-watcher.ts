import { promises as fs } from 'node:fs';
import path from 'node:path';

export type SessionContentChange = {
  readonly kind: 'add' | 'remove' | 'change';
  readonly sessionId: string;
};

export interface SessionContentWatcherOptions {
  /** Production uses a low-frequency safety reconciliation; tests may shorten it. */
  readonly pollIntervalMs?: number;
  /** Bound startup readiness so an unreadable Session root cannot hang cache reads forever. */
  readonly readyTimeoutMs?: number;
  /** A late first baseline must invalidate data cached while startup scanning was unavailable. */
  readonly onBaselineRecovered?: () => void;
}

/** Full stat reconciliation is deliberately slower than the SDK's lightweight ID poll. */
export const SESSION_CONTENT_POLL_INTERVAL_MS = 10_000;

function sessionIdFromPersistedFile(name: string): string | null {
  if (name.startsWith('.') || !name.endsWith('.jsonl')) return null;
  if (name.endsWith('.islands.jsonl')) return name.slice(0, -'.islands.jsonl'.length);
  if (name.endsWith('.archive.jsonl')) return name.slice(0, -'.archive.jsonl'.length);
  return name.slice(0, -'.jsonl'.length);
}

/**
 * Build a content-sensitive snapshot of the SDK Session tree.
 *
 * KodaX 0.7.79's Windows watcher compares only the set of Session IDs, so an append to an
 * existing JSONL file is invisible. Space keeps this small compatibility watcher until the SDK
 * exposes content-aware events. Size + nanosecond mtime/ctime + relative location cover appends,
 * rewrites, sidecar changes, archive moves, and same-ID project relocation without reading large
 * transcripts into memory.
 */
async function buildSnapshot(sessionsDir: string): Promise<Map<string, string> | null> {
  const partsBySession = new Map<string, string[]>();
  const pending = [sessionsDir];
  try {
    while (pending.length > 0) {
      const dir = pending.pop()!;
      let entries;
      try {
        entries = await fs.readdir(dir, { withFileTypes: true });
      } catch (error) {
        if (dir === sessionsDir && (error as NodeJS.ErrnoException).code === 'ENOENT') {
          return new Map();
        }
        throw error;
      }
      const files: Array<{ readonly name: string; readonly absolutePath: string }> = [];
      for (const entry of entries) {
        if (entry.name.startsWith('.')) continue;
        const absolutePath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          pending.push(absolutePath);
          continue;
        }
        if (entry.isFile()) files.push({ name: entry.name, absolutePath });
      }
      // Bound filesystem concurrency for large/slow Session roots. The async scan yields the
      // Electron main loop between batches and self-scheduling below prevents overlapping polls.
      for (let offset = 0; offset < files.length; offset += 64) {
        const batch = files.slice(offset, offset + 64);
        await Promise.all(
          batch.map(async ({ name, absolutePath }) => {
            const sessionId = sessionIdFromPersistedFile(name);
            if (sessionId === null || sessionId.length === 0) return;
            const stat = await fs.stat(absolutePath, { bigint: true });
            if (!stat.isFile()) return;
            const relativePath = path.relative(sessionsDir, absolutePath);
            const fingerprint = `${relativePath}\0${stat.size}\0${stat.mtimeNs}\0${stat.ctimeNs}`;
            const parts = partsBySession.get(sessionId) ?? [];
            parts.push(fingerprint);
            partsBySession.set(sessionId, parts);
          }),
        );
      }
    }
  } catch {
    // Do not publish a partial snapshot as removals. A later complete poll will reconcile it.
    return null;
  }

  const snapshot = new Map<string, string>();
  for (const [sessionId, parts] of partsBySession) {
    snapshot.set(sessionId, parts.sort().join('\n'));
  }
  return snapshot;
}

/**
 * Poll persisted Session content and emit per-ID changes. The returned timer is unref'ed so this
 * compatibility layer can never keep Electron's main process alive during a full exit.
 */
export function watchPersistedSessionContents(
  sessionsDir: string,
  callback: (event: SessionContentChange) => void,
  options: SessionContentWatcherOptions = {},
): { close: () => void; ready: Promise<void> } {
  const intervalMs = Math.max(10, options.pollIntervalMs ?? SESSION_CONTENT_POLL_INTERVAL_MS);
  const readyTimeoutMs = Math.max(10, options.readyTimeoutMs ?? 2000);
  let closed = false;
  let previous: Map<string, string> | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let resolveReady!: () => void;
  const ready = new Promise<void>((resolve) => {
    resolveReady = resolve;
  });
  let readyResolved = false;
  let baselineMissed = false;
  const readyTimeout = setTimeout(() => {
    if (readyResolved || closed) return;
    baselineMissed = true;
    readyResolved = true;
    resolveReady();
  }, readyTimeoutMs);
  readyTimeout.unref();

  const resolveBaselineReady = (): void => {
    if (readyResolved) return;
    readyResolved = true;
    clearTimeout(readyTimeout);
    resolveReady();
  };

  const schedule = (): void => {
    if (closed) return;
    timer = setTimeout(() => void poll(), intervalMs);
    timer.unref();
  };

  const poll = async (): Promise<void> => {
    if (closed) return;
    const current = await buildSnapshot(sessionsDir);
    if (closed) return;
    if (current !== null) {
      if (previous !== null) {
        for (const [sessionId, fingerprint] of current) {
          const prior = previous.get(sessionId);
          if (prior === undefined) callback({ kind: 'add', sessionId });
          else if (prior !== fingerprint) callback({ kind: 'change', sessionId });
        }
        for (const sessionId of previous.keys()) {
          if (!current.has(sessionId)) callback({ kind: 'remove', sessionId });
        }
      }
      if (previous === null && baselineMissed) options.onBaselineRecovered?.();
      previous = current;
      resolveBaselineReady();
    }
    schedule();
  };

  void poll();
  return {
    ready,
    close() {
      closed = true;
      if (timer !== null) clearTimeout(timer);
      // A close during the initial scan must not strand a cache read awaiting readiness.
      if (!readyResolved) {
        clearTimeout(readyTimeout);
        resolveBaselineReady();
      }
    },
  };
}
