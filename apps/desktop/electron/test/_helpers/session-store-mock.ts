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
  /** Inject a summary owned by another SDK surface, such as ACP. */
  seedSurface(id: string, gitRoot: string, surface: string, title?: string): void;
  seedTranscript(id: string, entries: readonly unknown[]): void;
  lastForkSelector(): string | undefined;
  lastRewindSelector(): string | undefined;
  /** Make SDK delete report that another KodaX process still owns the session. */
  setDeleteBusy(busy: boolean): void;
  /** Emulate the cursor-bearing listSessions contract introduced after SDK 0.7.66. */
  setCursorPaginationEnabled(enabled: boolean): void;
  listCallCount(): number;
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
      runtimeSurface?: string;
      transcriptEntries?: readonly unknown[];
    }
  >();
  let lastForkSelectorValue: string | undefined;
  let lastRewindSelectorValue: string | undefined;
  let deleteBusy = false;
  let cursorPaginationEnabled = false;
  let listCalls = 0;
  const titleOverrides = new Map<string, string>();

  const impl: SessionStoreImpl = {
    listSessions: async (opts) => {
      listCalls += 1;
      const root = opts?.projectRoot;
      const all = [...storage.values()];
      const filtered = root === undefined ? all : all.filter((s) => s.gitRoot === root);
      const cursor = (opts as { readonly cursor?: string } | undefined)?.cursor;
      const cursorIndex = cursor === undefined ? -1 : filtered.findIndex((s) => s.id === cursor);
      if (cursor !== undefined && cursorIndex < 0) return [];
      const page = filtered.slice(
        cursorIndex + 1,
        cursorIndex + 1 + (opts?.limit ?? filtered.length),
      );
      return page.map((s) => ({
        id: s.id,
        ...(cursorPaginationEnabled ? { cursor: s.id } : {}),
        title: s.title,
        msgCount: 0,
        ...(s.tag !== undefined ? { tag: s.tag } : {}),
        runtimeInfo: {
          workspaceRoot: s.gitRoot,
          ...(s.runtimeSurface !== undefined ? { surface: s.runtimeSurface } : {}),
        },
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
        ...(data.runtimeInfo?.surface !== undefined
          ? { runtimeSurface: data.runtimeInfo.surface }
          : {}),
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
    seedSurface(id, gitRoot, surface, title = 'Untitled'): void {
      storage.set(id, { id, title, gitRoot, runtimeSurface: surface });
    },
    seedTranscript(id, entries): void {
      const existing = storage.get(id);
      storage.set(id, {
        id,
        title: existing?.title ?? 'Untitled',
        gitRoot: existing?.gitRoot ?? '',
        ...(existing?.tag !== undefined ? { tag: existing.tag } : {}),
        ...(existing?.runtimeSurface !== undefined
          ? { runtimeSurface: existing.runtimeSurface }
          : {}),
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
    setCursorPaginationEnabled(enabled): void {
      cursorPaginationEnabled = enabled;
    },
    listCallCount(): number {
      return listCalls;
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
      cursorPaginationEnabled = false;
      listCalls = 0;
      setSessionStoreImpl(null);
      setSessionTitleStoreForTesting(null);
    },
  };
}
