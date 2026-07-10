// FEATURE_038 testing helper.
//
// Provide an in-memory SessionStoreImpl that test files inject via
// setSessionStoreImpl(). Avoids touching real ~/.kodax/sessions/ + sidesteps
// the cli-boxes JSON-as-JS tsx/esm bug that fires the moment SDK
// `@kodax-ai/kodax/session` is dynamically imported.
//
// Usage in a test file:
//   import { installSessionStoreMock } from './_helpers/session-store-mock.js';
//   const mockState = installSessionStoreMock();
//   // (optionally) mockState.seed(id, gitRoot, title)
//   afterEach(() => mockState.reset());

import { randomUUID } from 'node:crypto';
import { setSessionStoreImpl, type SessionStoreImpl } from '../../kodax/session-store.js';
import {
  setSessionTitleStoreForTesting,
  type SessionTitleStoreImpl,
} from '../../kodax/session-title-store.js';

export interface MockSessionState {
  /** Inject a 'persisted' session so SDK forkSession finds it. */
  seed(id: string, gitRoot: string, title?: string): void;
  /** F045: Inject a persisted session carrying a SDK session tag (surface 反推). */
  seedTagged(id: string, gitRoot: string, tag: string | undefined, title?: string): void;
  seedTranscript(id: string, entries: readonly unknown[]): void;
  lastForkSelector(): string | undefined;
  lastRewindSelector(): string | undefined;
  /** Make SDK delete report that another KodaX process still owns the session. */
  setDeleteBusy(busy: boolean): void;
  has(id: string): boolean;
  /** Wipe storage + restore default SDK impl. Call from afterEach. */
  reset(): void;
}

export function installSessionStoreMock(): MockSessionState {
  const storage = new Map<
    string,
    {
      id: string;
      title: string;
      gitRoot: string;
      tag?: string;
      transcriptEntries?: readonly unknown[];
    }
  >();
  let lastForkSelectorValue: string | undefined;
  let lastRewindSelectorValue: string | undefined;
  let deleteBusy = false;
  const titleOverrides = new Map<string, string>();

  const impl: SessionStoreImpl = {
    listSessions: async (opts) => {
      const root = opts?.projectRoot;
      const all = [...storage.values()];
      const filtered = root === undefined ? all : all.filter((s) => s.gitRoot === root);
      return filtered.map((s) => ({
        id: s.id,
        title: s.title,
        msgCount: 0,
        ...(s.tag !== undefined ? { tag: s.tag } : {}),
        runtimeInfo: { workspaceRoot: s.gitRoot },
      }));
    },
    forkSession: async (srcId, opts) => {
      lastForkSelectorValue = opts?.selector;
      const src = storage.get(srcId);
      if (!src) return null;
      const newId = `s_${randomUUID()}`;
      const newData = { id: newId, title: opts?.title ?? src.title, gitRoot: src.gitRoot };
      storage.set(newId, newData);
      return {
        sessionId: newId,
        data: { title: newData.title, messages: [], gitRoot: newData.gitRoot } as never,
      };
    },
    rewindSession: async (id, opts) => {
      lastRewindSelectorValue = opts?.selector;
      const s = storage.get(id);
      if (!s) return null;
      return { title: s.title, messages: [], gitRoot: s.gitRoot } as never;
    },
    deleteSession: async (id) => {
      if (deleteBusy) {
        return {
          error: {
            code: 'session_running' as const,
            runningProcess: { pid: 42, startedAt: 1 },
          },
        };
      }
      storage.delete(id);
      return { ok: true };
    },
    loadSession: async (id) => {
      const s = storage.get(id);
      if (!s) return null;
      // F045: 回带 tag，让 host.tryResume 能从持久化数据反推 surface。
      return {
        title: s.title,
        messages: [],
        gitRoot: s.gitRoot,
        ...(s.tag !== undefined ? { tag: s.tag } : {}),
      } as never;
    },
    saveSession: async (id, data) => {
      storage.set(id, {
        id,
        title: data.title,
        gitRoot: data.runtimeInfo?.workspaceRoot ?? data.gitRoot,
        ...(data.tag !== undefined ? { tag: data.tag } : {}),
      });
      return true;
    },
    loadFullTranscript: async (id) => {
      const s = storage.get(id);
      if (!s) return null;
      return {
        title: s.title,
        messages: [],
        gitRoot: s.gitRoot,
        transcriptEntries: s.transcriptEntries ?? [],
      } as never;
    },
    watchSessions: () => ({ close: () => undefined }),
  };

  setSessionStoreImpl(impl);
  const titleImpl: SessionTitleStoreImpl = {
    read: async (sessionId) => titleOverrides.get(sessionId) ?? null,
    set: async (sessionId, title) => {
      titleOverrides.set(sessionId, title);
    },
    delete: async (sessionId) => {
      titleOverrides.delete(sessionId);
    },
  };
  setSessionTitleStoreForTesting(titleImpl);
  return {
    seed(id, gitRoot, title = 'Untitled'): void {
      storage.set(id, { id, title, gitRoot });
    },
    seedTagged(id, gitRoot, tag, title = 'Untitled'): void {
      storage.set(id, { id, title, gitRoot, ...(tag !== undefined ? { tag } : {}) });
    },
    seedTranscript(id, entries): void {
      const existing = storage.get(id);
      storage.set(id, {
        id,
        title: existing?.title ?? 'Untitled',
        gitRoot: existing?.gitRoot ?? '',
        ...(existing?.tag !== undefined ? { tag: existing.tag } : {}),
        transcriptEntries: entries,
      });
    },
    lastForkSelector(): string | undefined {
      return lastForkSelectorValue;
    },
    lastRewindSelector(): string | undefined {
      return lastRewindSelectorValue;
    },
    setDeleteBusy(busy): void {
      deleteBusy = busy;
    },
    has(id): boolean {
      return storage.has(id);
    },
    reset(): void {
      storage.clear();
      titleOverrides.clear();
      lastForkSelectorValue = undefined;
      lastRewindSelectorValue = undefined;
      deleteBusy = false;
      setSessionStoreImpl(null);
      setSessionTitleStoreForTesting(null);
    },
  };
}
