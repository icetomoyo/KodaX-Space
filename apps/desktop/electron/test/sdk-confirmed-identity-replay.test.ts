import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createSessionManager } from '@kodax-ai/kodax/repl';
import {
  getSessionMessagesFromLineage,
  type KodaXSessionLineage,
  type KodaXSessionMessageEntry,
} from '@kodax-ai/kodax/agent';
import type { SessionHistoryItem } from '@kodax-space/space-ipc-schema';
import { conversationHistoryAsTranscript } from '../ipc/session.js';
import { composeMessages } from '../../renderer/src/features/session/composeMessages.js';
import { useAppStore } from '../../renderer/src/store/appStore.js';

const sid = 'sdk-confirmed-identity';
const turnId = 'legacy-turn';
const timestamp = '2026-09-11T02:24:03.231Z';
const sourceId = 'entry-delivered';
const targetId = 'entry-canonical';

function entry(
  id: string,
  parentId: string | null,
  role: 'user' | 'assistant',
  content: string,
): KodaXSessionMessageEntry {
  return {
    type: 'message',
    id,
    parentId,
    logicalId: id,
    timestamp,
    message: { role, content, turnId, timestamp },
  };
}

function legacyLineage(): KodaXSessionLineage {
  const context = (id: string): KodaXSessionMessageEntry => ({
    ...entry(id, null, 'user', 'context'),
    message: { role: 'user', content: 'context', _synthetic: true, _source: 'managed-run-context' },
  });
  return {
    version: 2,
    activeEntryId: 'answer',
    entries: [
      context('old-context'),
      entry(sourceId, 'old-context', 'user', 'query'),
      context('new-context'),
      entry(targetId, 'new-context', 'user', 'query'),
      entry('answer', targetId, 'assistant', 'answer'),
    ],
  };
}

function resetProjection(): void {
  useAppStore.setState({
    sessions: [
      {
        sessionId: sid,
        projectRoot: '/fixture',
        provider: 'mock',
        reasoningMode: 'auto',
        permissionMode: 'accept-edits',
        agentMode: 'ama',
        surface: 'code',
        createdAt: 1,
        lastActivityAt: 1,
      },
    ],
    currentSessionId: sid,
  });
  useAppStore.getState().resetSessionMessages(sid);
}

const origin = (seq: number) => ({
  runtimeId: 'rt-fixture',
  runId: 'run-fixture',
  journalEpoch: 'epoch-fixture',
  seq,
});

function deliver(entryId = sourceId, queueId = 'original-input', seq = 20): void {
  useAppStore.getState().appendEvent({
    kind: 'mid_turn_user_prompt',
    sessionId: sid,
    content: 'query',
    entryId,
    queueId,
    turnId,
    turnUserOrdinal: entryId === sourceId ? 0 : 1,
    sentAt: Date.parse(timestamp),
    runtimeEvent: origin(seq),
  });
}

function answer(): void {
  const store = useAppStore.getState();
  store.appendEvent({
    kind: 'text_delta',
    sessionId: sid,
    turnId,
    text: 'answer',
    runtimeEvent: origin(21),
  });
  store.appendEvent({ kind: 'session_complete', sessionId: sid, turnId, runtimeEvent: origin(22) });
}

function rendered(): string[] {
  const state = useAppStore.getState();
  return composeMessages({
    events: state.eventsBySession[sid] ?? [],
    userMessages: state.userMessagesBySession[sid] ?? [],
  }).flatMap((message) =>
    message.kind === 'user'
      ? [message.content]
      : message.kind === 'assistant_text'
        ? [message.text]
        : [],
  );
}

type History = Parameters<typeof conversationHistoryAsTranscript>[0];

function install(history: History): void {
  const transcript = conversationHistoryAsTranscript(history);
  const items = transcript.transcriptEntries.flatMap<SessionHistoryItem>((record) => {
    const message = record.message as { role: string; content: string };
    const identity = {
      entryId: record.entryId,
      auditEntryIds: record.auditEntryIds,
      canonicalIndex: record.canonicalIndex,
      turnId,
      sentAt: Date.parse(timestamp),
    };
    if (message.role === 'user' && message.content === 'query') {
      return [{ ...identity, kind: 'user' as const, content: 'query', turnUserOrdinal: 0 }];
    }
    if (message.role === 'assistant')
      return [{ ...identity, kind: 'assistant' as const, text: message.content }];
    return [];
  });
  useAppStore.getState().prependSessionHistory(sid, items, 1, {
    replaceLoadedWindow: true,
    authoritativeNewest: true,
    conversationStatus: history.status,
    sourceRevision: history.sourceRevision,
    settledRuntimeRuns: [{ runtimeId: 'rt-fixture', runId: 'run-fixture', generation: 1 }],
  });
}

test('SDK-confirmed legacy aliases converge in Space across repair, reload and old delivery replay', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'space-sdk-identity-'));
  const sessionsDir = path.join(root, 'sessions');
  const manager = createSessionManager({ sessionsDir });
  try {
    const lineage = legacyLineage();
    await manager.storage.save(sid, {
      title: 'identity fixture',
      gitRoot: root,
      lineage,
      messages: getSessionMessagesFromLineage(lineage),
    });
    const before = await manager.readConversationHistory(sid);
    assert(before);
    resetProjection();
    deliver();
    answer();
    install(before);
    assert.deepEqual(
      rendered(),
      ['query', 'answer', 'query', 'answer'],
      'unconfirmed identities must remain separate',
    );

    assert.equal(
      typeof manager.storage.confirmIdentityAlias,
      'function',
      'SDK must support confirmed legacy identity repairs',
    );
    const confirmation = {
      sourceEntryId: sourceId,
      targetEntryId: targetId,
      expectedSourceRevision: before.sourceRevision,
      confirmationReference: 'test-fixture:explicit-mapping',
    };
    const receipt = await manager.storage.confirmIdentityAlias(sid, confirmation);
    assert.deepEqual(await manager.storage.confirmIdentityAlias(sid, confirmation), receipt);
    const restarted = createSessionManager({ sessionsDir });
    const repaired = await restarted.readConversationHistory(sid);
    assert(repaired);
    assert.notEqual(repaired.sourceRevision, before.sourceRevision);
    assert.equal(
      repaired.entries.filter((item) => item.auditEntryIds.includes(sourceId)).length,
      1,
    );
    install(repaired);
    assert.deepEqual(
      rendered(),
      ['query', 'answer'],
      'already-visible duplicate disappears after repaired history arrives',
    );

    for (const mode of ['cold', 'live-history', 'late-delivery', 'repeat-delivery']) {
      resetProjection();
      if (mode === 'live-history' || mode === 'repeat-delivery') {
        deliver();
        answer();
      }
      install(repaired);
      if (mode === 'late-delivery' || mode === 'repeat-delivery') deliver();
      assert.deepEqual(rendered(), ['query', 'answer'], mode);
    }
    deliver('entry-independent-repeat', 'independent-input', 23);
    assert.deepEqual(
      rendered(),
      ['query', 'answer', 'query'],
      'a genuinely repeated query is not an alias',
    );
  } finally {
    useAppStore.getState().resetSessionMessages(sid);
    await rm(root, { recursive: true, force: true, maxRetries: 3 });
  }
});
