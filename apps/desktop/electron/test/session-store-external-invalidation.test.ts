import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';

import {
  listPersistedSessions,
  loadPersistedConversationHistory,
  loadPersistedSession,
  loadPersistedSessionFresh,
  loadPersistedTranscript,
  setSessionStoreImpl,
  type SessionStoreImpl,
} from '../kodax/session-store.js';

afterEach(() => setSessionStoreImpl(null));

test('watchSessions invalidates every cached projection for the changed Session', async () => {
  const sessionId = 's_external_cache_change';
  let revision = 1;
  let watcher:
    | ((event: { kind: 'add' | 'remove' | 'change'; sessionId: string }) => void)
    | undefined;

  const impl: SessionStoreImpl = {
    listSessions: async () => [
      {
        id: sessionId,
        title: `list-v${revision}`,
        msgCount: revision,
        runtimeInfo: { workspaceRoot: 'C:\\repo' },
      },
    ],
    loadSession: async () =>
      ({ title: `load-v${revision}`, messages: [], gitRoot: 'C:\\repo' }) as never,
    loadFullTranscript: async () =>
      ({ title: `transcript-v${revision}`, messages: [], gitRoot: 'C:\\repo' }) as never,
    readConversationHistory: async () =>
      ({
        sourceRevision: `sha256:revision-${revision}`,
        status: 'complete',
        issues: [],
        entries: [
          {
            boundaryId: `u-${revision}`,
            auditEntryIds: [`u-${revision}`],
            message: { role: 'user', content: `prompt-v${revision}` },
          },
        ],
      }) as never,
    forkSession: async () => null,
    rewindSession: async () => null,
    deleteSession: async () => ({ ok: true }),
    watchSessions: (callback) => {
      watcher = callback;
      return { close: () => undefined };
    },
  };
  setSessionStoreImpl(impl);

  // Listing installs the shared SDK watcher used by the real application startup path.
  await listPersistedSessions({ projectRoot: 'C:\\repo' });
  assert.equal((await loadPersistedSession(sessionId))?.title, 'load-v1');
  assert.equal((await loadPersistedTranscript(sessionId))?.title, 'transcript-v1');
  assert.equal(
    (await loadPersistedConversationHistory(sessionId)).data?.sourceRevision,
    'sha256:revision-1',
  );

  revision = 2;
  watcher?.({ kind: 'change', sessionId });

  assert.equal((await loadPersistedSession(sessionId))?.title, 'load-v2');
  assert.equal((await loadPersistedTranscript(sessionId))?.title, 'transcript-v2');
  assert.equal(
    (await loadPersistedConversationHistory(sessionId)).data?.sourceRevision,
    'sha256:revision-2',
  );
});

test('Space content watcher invalidates projections when SDK emits no existing-file event', async () => {
  const sessionId = 's_external_content_change';
  let revision = 1;
  let contentWatcher:
    | ((event: { kind: 'add' | 'remove' | 'change'; sessionId: string }) => void)
    | undefined;
  const impl: SessionStoreImpl = {
    listSessions: async () => [],
    loadSession: async () =>
      ({ title: `load-v${revision}`, messages: [], gitRoot: 'C:\\repo' }) as never,
    loadFullTranscript: async () =>
      ({ title: `transcript-v${revision}`, messages: [], gitRoot: 'C:\\repo' }) as never,
    readConversationHistory: async () =>
      ({
        sourceRevision: `revision-${revision}`,
        status: 'complete',
        issues: [],
        entries: [],
      }) as never,
    forkSession: async () => null,
    rewindSession: async () => null,
    deleteSession: async () => ({ ok: true }),
    // Mirrors the installed 0.7.79 Windows behavior: no callback for content-only changes.
    watchSessions: () => ({ close: () => undefined }),
    watchSessionContents: (callback) => {
      contentWatcher = callback;
      return { close: () => undefined };
    },
  };
  setSessionStoreImpl(impl);

  await listPersistedSessions({ projectRoot: 'C:\\repo' });
  assert.equal((await loadPersistedSession(sessionId))?.title, 'load-v1');
  assert.equal((await loadPersistedTranscript(sessionId))?.title, 'transcript-v1');
  assert.equal(
    (await loadPersistedConversationHistory(sessionId)).data?.sourceRevision,
    'revision-1',
  );

  revision = 2;
  contentWatcher?.({ kind: 'change', sessionId });

  assert.equal((await loadPersistedSession(sessionId))?.title, 'load-v2');
  assert.equal((await loadPersistedTranscript(sessionId))?.title, 'transcript-v2');
  assert.equal(
    (await loadPersistedConversationHistory(sessionId)).data?.sourceRevision,
    'revision-2',
  );
});

test('list cache fill waits for the content baseline and is invalidated by the next change', async () => {
  let revision = 1;
  let resolveBaseline!: () => void;
  const baseline = new Promise<void>((resolve) => {
    resolveBaseline = resolve;
  });
  let contentWatcher:
    | ((event: { kind: 'add' | 'remove' | 'change'; sessionId: string }) => void)
    | undefined;
  const impl: SessionStoreImpl = {
    listSessions: async () => [
      {
        id: 's_list_baseline',
        title: `list-v${revision}`,
        msgCount: revision,
        runtimeInfo: { workspaceRoot: 'C:\\repo' },
      },
    ],
    loadSession: async () => null,
    forkSession: async () => null,
    rewindSession: async () => null,
    deleteSession: async () => ({ ok: true }),
    watchSessions: () => ({ close: () => undefined }),
    watchSessionContents: (callback) => {
      contentWatcher = callback;
      return { close: () => undefined, ready: baseline };
    },
  };
  setSessionStoreImpl(impl);

  const firstList = listPersistedSessions({ projectRoot: 'C:\\repo' });
  revision = 2;
  resolveBaseline();
  assert.equal((await firstList)[0]?.title, 'list-v2');

  revision = 3;
  contentWatcher?.({ kind: 'change', sessionId: 's_list_baseline' });
  assert.equal((await listPersistedSessions({ projectRoot: 'C:\\repo' }))[0]?.title, 'list-v3');
});

test('an unrelated active Session cannot restart another Session read boundary', async () => {
  let watcher:
    | ((event: { kind: 'add' | 'remove' | 'change'; sessionId: string }) => void)
    | undefined;
  let started = 0;
  let releaseReads!: () => void;
  const readGate = new Promise<void>((resolve) => {
    releaseReads = resolve;
  });
  let releaseStarted!: () => void;
  const allStarted = new Promise<void>((resolve) => {
    releaseStarted = resolve;
  });
  const reads = { session: 0, transcript: 0, conversation: 0 };
  const waitAtBoundary = async (): Promise<void> => {
    started += 1;
    if (started === 3) releaseStarted();
    await readGate;
  };
  setSessionStoreImpl({
    listSessions: async () => [],
    loadSession: async () => {
      reads.session += 1;
      await waitAtBoundary();
      return { title: 'target', messages: [], gitRoot: 'C:\\repo' } as never;
    },
    loadFullTranscript: async () => {
      reads.transcript += 1;
      await waitAtBoundary();
      return { title: 'target', messages: [], gitRoot: 'C:\\repo' } as never;
    },
    readConversationHistory: async () => {
      reads.conversation += 1;
      await waitAtBoundary();
      return {
        sourceRevision: 'target-revision',
        status: 'complete',
        issues: [],
        entries: [],
      } as never;
    },
    forkSession: async () => null,
    rewindSession: async () => null,
    deleteSession: async () => ({ ok: true }),
    watchSessions: (callback) => {
      watcher = callback;
      return { close: () => undefined };
    },
  });

  await listPersistedSessions({ projectRoot: 'C:\\repo' });
  const targetReads = Promise.all([
    loadPersistedSessionFresh('s_target'),
    loadPersistedTranscript('s_target'),
    loadPersistedConversationHistory('s_target'),
  ]);
  await allStarted;
  watcher?.({ kind: 'change', sessionId: 's_noisy_writer' });
  releaseReads();
  await targetReads;

  assert.deepEqual(reads, { session: 1, transcript: 1, conversation: 1 });
});

test('same-Session writes cannot restart persisted recovery without a bound', async () => {
  let watcher:
    | ((event: { kind: 'add' | 'remove' | 'change'; sessionId: string }) => void)
    | undefined;
  const reads = { session: 0, fresh: 0, transcript: 0, conversation: 0 };
  const invalidate = (sessionId: string): void => {
    watcher?.({ kind: 'change', sessionId });
  };
  setSessionStoreImpl({
    listSessions: async () => [],
    loadSession: async (sessionId) => {
      if (sessionId === 's_bounded_session') reads.session += 1;
      else reads.fresh += 1;
      invalidate(sessionId);
      return { title: sessionId, messages: [], gitRoot: 'C:\\repo' } as never;
    },
    loadFullTranscript: async (sessionId) => {
      reads.transcript += 1;
      invalidate(sessionId);
      return { title: sessionId, messages: [], gitRoot: 'C:\\repo' } as never;
    },
    readConversationHistory: async (sessionId) => {
      reads.conversation += 1;
      invalidate(sessionId);
      return {
        sourceRevision: `revision-${reads.conversation}`,
        status: 'complete',
        issues: [],
        entries: [],
      } as never;
    },
    forkSession: async () => null,
    rewindSession: async () => null,
    deleteSession: async () => ({ ok: true }),
    watchSessions: (callback) => {
      watcher = callback;
      return { close: () => undefined };
    },
  });

  await listPersistedSessions({ projectRoot: 'C:\\repo' });
  assert.equal((await loadPersistedSession('s_bounded_session'))?.title, 's_bounded_session');
  await assert.rejects(loadPersistedSessionFresh('s_bounded_fresh'), (error: unknown) => {
    return error instanceof Error && (error as Error & { code?: string }).code === 'data_changed';
  });
  assert.equal(
    (await loadPersistedTranscript('s_bounded_transcript'))?.title,
    's_bounded_transcript',
  );
  assert.equal(
    (await loadPersistedConversationHistory('s_bounded_conversation')).data?.sourceRevision,
    'revision-2',
  );

  assert.deepEqual(reads, { session: 2, fresh: 2, transcript: 2, conversation: 2 });
});
