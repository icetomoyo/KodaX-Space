import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';

import {
  findPersistedTurnEndBoundary,
  forkPersistedSession,
  loadPersistedConversationHistory,
  setSessionStoreImpl,
  type SessionStoreImpl,
} from '../kodax/session-store.js';

afterEach(() => setSessionStoreImpl(null));

test('persisted conversation history preserves ambiguous candidates and fences mutations', async () => {
  let forkOptions: Parameters<SessionStoreImpl['forkSession']>[1];
  const conversation = {
    sourceRevision: 'sha256:source',
    status: 'ambiguous' as const,
    issues: [
      {
        code: 'legacy_overlap_ambiguous' as const,
        message: 'multiple interpretations remain',
        occurrenceCount: 1,
        entryCount: 2,
        entryIds: ['u0', 'u1'],
      },
    ],
    entries: [
      { boundaryId: 'u0', auditEntryIds: ['u0'], message: { role: 'user', content: 'same' } },
      { boundaryId: 'a0', auditEntryIds: ['a0'], message: { role: 'assistant', content: 'one' } },
      { boundaryId: 'u1', auditEntryIds: ['u1'], message: { role: 'user', content: 'same' } },
      { boundaryId: 'a1', auditEntryIds: ['a1'], message: { role: 'assistant', content: 'two' } },
    ],
  };
  setSessionStoreImpl({
    listSessions: async () => [],
    loadSession: async () => ({ title: 'source', messages: [], gitRoot: 'C:\\repo' }) as never,
    loadFullTranscript: async () => {
      throw new Error('raw transcript must not be used when conversation history is supported');
    },
    readConversationHistory: async () => conversation as never,
    forkSession: async (_id, options) => {
      forkOptions = options;
      return {
        sessionId: 's_child',
        data: { title: 'child', messages: [], gitRoot: 'C:\\repo' },
      } as never;
    },
    rewindSession: async () => null,
    deleteSession: async () => ({ ok: true }),
    watchSessions: () => ({ close() {} }),
  });

  const read = await loadPersistedConversationHistory('s_source');
  assert.equal(read.supported, true);
  assert.equal(read.data?.status, 'ambiguous');
  assert.equal(read.data?.entries.length, 4, 'same-content candidates must remain separate');

  const first = await findPersistedTurnEndBoundary('s_source', 0);
  const second = await findPersistedTurnEndBoundary('s_source', 1);
  assert.deepEqual(first, {
    kind: 'conversation',
    historyBoundary: { boundaryId: 'a0', sourceRevision: 'sha256:source' },
  });
  assert.deepEqual(second, {
    kind: 'conversation',
    historyBoundary: { boundaryId: 'a1', sourceRevision: 'sha256:source' },
  });

  assert.equal(second?.kind, 'conversation');
  if (second?.kind !== 'conversation') throw new Error('expected conversation boundary');
  await forkPersistedSession({
    sourceSessionId: 's_source',
    historyBoundary: second.historyBoundary,
  });
  assert.deepEqual(forkOptions?.historyBoundary, {
    boundaryId: 'a1',
    sourceRevision: 'sha256:source',
  });
  assert.equal(forkOptions?.selector, undefined);
});

test('persisted conversation mutations fail closed when the selected turn tail lacks a boundary', async () => {
  setSessionStoreImpl({
    listSessions: async () => [],
    loadSession: async () => ({ title: 'source', messages: [], gitRoot: 'C:\\repo' }) as never,
    loadFullTranscript: async () => {
      throw new Error('raw selector fallback must not bypass a supported conversation boundary');
    },
    readConversationHistory: async () =>
      ({
        sourceRevision: 'sha256:missing-tail-boundary',
        status: 'partial',
        issues: [
          {
            code: 'lineage_path_incomplete',
            message: 'assistant boundary missing',
            occurrenceCount: 1,
            entryCount: 1,
            entryIds: ['a0'],
          },
        ],
        entries: [
          { boundaryId: 'u0', auditEntryIds: ['u0'], message: { role: 'user', content: 'query' } },
          { auditEntryIds: ['a0'], message: { role: 'assistant', content: 'answer' } },
        ],
      }) as never,
    forkSession: async () => null,
    rewindSession: async () => null,
    deleteSession: async () => ({ ok: true }),
    watchSessions: () => ({ close() {} }),
  });

  assert.equal(await findPersistedTurnEndBoundary('s_missing_tail_boundary', 0), null);
});
