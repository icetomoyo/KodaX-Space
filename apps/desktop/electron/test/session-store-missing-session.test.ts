import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';

import {
  loadPersistedConversationHistory,
  loadPersistedSession,
  loadPersistedSessionFresh,
  loadPersistedTranscript,
  setSessionStoreImpl,
  type SessionStoreImpl,
} from '../kodax/session-store.js';

afterEach(() => setSessionStoreImpl(null));

test('a missing persisted session reads as an empty transcript, not a thrown error', async () => {
  const impl: SessionStoreImpl = {
    listSessions: async () => [],
    watchSessions: () => ({ close: () => undefined }),
    loadSession: async () => {
      throw new Error('Session not found: s_missing');
    },
    loadFullTranscript: async () => null,
    readConversationHistory: async () => null,
  } as unknown as SessionStoreImpl;
  setSessionStoreImpl(impl);

  const transcript = await loadPersistedTranscript('s_missing');
  assert.equal(transcript, null);
});

test('a missing persisted session reads as an empty conversation projection', async () => {
  const impl: SessionStoreImpl = {
    listSessions: async () => [],
    watchSessions: () => ({ close: () => undefined }),
    loadSession: async () => {
      throw new Error('Session not found: s_missing');
    },
    readConversationHistory: async () => {
      throw new Error('Session not found: s_missing');
    },
  } as unknown as SessionStoreImpl;
  setSessionStoreImpl(impl);

  const conversation = await loadPersistedConversationHistory('s_missing');
  assert.deepEqual(conversation, { supported: true, data: null });
});

test('unrelated storage failures still propagate', async () => {
  const impl: SessionStoreImpl = {
    listSessions: async () => [],
    watchSessions: () => ({ close: () => undefined }),
    loadSession: async () => {
      throw Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' });
    },
    loadFullTranscript: async () => null,
    readConversationHistory: async () => null,
  } as unknown as SessionStoreImpl;
  setSessionStoreImpl(impl);

  await assert.rejects(loadPersistedTranscript('s_denied'), /EACCES/);
});

test('loadPersistedSession and the fresh fence read a missing session as null', async () => {
  const impl: SessionStoreImpl = {
    listSessions: async () => [],
    watchSessions: () => ({ close: () => undefined }),
    loadSession: async () => {
      throw new Error('Session not found: s_missing');
    },
  } as unknown as SessionStoreImpl;
  setSessionStoreImpl(impl);

  assert.equal(await loadPersistedSession('s_missing'), null);
  assert.equal(await loadPersistedSessionFresh('s_missing'), null);
});
