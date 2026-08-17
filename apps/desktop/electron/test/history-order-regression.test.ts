// Regression: two transcript-order defect faces that survived many partial fixes.
//
// Face A (live misorder, Ctrl+R repairs): with a runtime terminal event that omits turnId
// (observed on real KodaX terminal paths), the strong-identity fold refuses to fold the live
// turn into its canonical copy. The stale live segment then survives in the live baseline and
// composeMessages appends ownerless residue at the very bottom, while canonical timestamps
// (main-process wall clock, skewed vs renderer optimistic sentAt) reorder owners vs segments.
// Symptom: [A(N-1), Q(N)] at the bottom, newest answer NOT at the bottom.
//
// Face B (ambiguous page duplicates, Ctrl+R does NOT repair): KodaX compaction double-books a
// retained suffix (same logicalId both re-created in main and archived in an island — verified
// on disk for session 20260816_132905_g1806cde81c389: 82 shared logicalIds). The daemon's
// conversation projection reports status:'ambiguous' and Space "conservatively retains all
// candidates", rendering the same logical entry twice. logicalId is the documented stable
// identity for proven clones (space-ipc-schema session.ts "Stable identity shared by proven
// compaction/fork clones"), so Space must dedupe candidates by it instead of duplicating.

import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import type { SessionHistoryItem } from '@kodax-space/space-ipc-schema';
import { composeMessages } from '../../renderer/src/features/session/composeMessages.js';
import { useAppStore } from '../../renderer/src/store/appStore.js';

const SID = 'order-regression';
const CREATED_AT = 1_700_000_000_000;

function resetStore(): void {
  useAppStore.getState().resetSessionMessages(SID);
  useAppStore.setState({
    sessions: [
      {
        sessionId: SID,
        projectRoot: '/project',
        provider: 'mock',
        reasoningMode: 'auto',
        permissionMode: 'accept-edits',
        autoModeEngine: 'llm',
        agentMode: 'ama',
        surface: 'code',
        createdAt: CREATED_AT,
        lastActivityAt: CREATED_AT,
      },
    ],
    currentSessionId: SID,
    eventsBySession: {},
    userMessagesBySession: {},
    promotedPopoutsBySession: {},
  });
}

function runtimeEvent(runId: string, seq: number) {
  return { runtimeId: 'runtime-order-regression', runId, journalEpoch: 'epoch-order', seq };
}

function visibleTranscript(): readonly string[] {
  const state = useAppStore.getState();
  return composeMessages({
    events: state.eventsBySession[SID] ?? [],
    userMessages: state.userMessagesBySession[SID] ?? [],
  }).flatMap((message) => {
    if (message.kind === 'user') return [`user:${message.content}`];
    if (message.kind === 'assistant_text') return [`assistant:${message.text}`];
    return [];
  });
}

beforeEach(() => {
  resetStore();
});

test('a turnId-less terminal event still folds its live turn under a canonical page', () => {
  const store = useAppStore.getState();
  const T0 = CREATED_AT + 1_000;
  const T1 = CREATED_AT + 11_000;

  // Turn N-1, healthy live lifecycle.
  const firstMessageId = store.appendUserMessage(SID, 'first question', T0);
  assert.ok(firstMessageId);
  store.bindUserMessageRuntimeRun(SID, firstMessageId, 'run-1');
  store.appendEvent({
    kind: 'session_start',
    sessionId: SID,
    provider: 'mock',
    turnId: 'turn-1',
    runtimeEvent: runtimeEvent('run-1', 1),
  });
  store.appendEvent({
    kind: 'text_delta',
    sessionId: SID,
    text: 'first answer',
    turnId: 'turn-1',
    sentAt: T0 + 10,
    runtimeEvent: runtimeEvent('run-1', 5),
  });
  store.appendEvent({
    kind: 'session_complete',
    sessionId: SID,
    turnId: 'turn-1',
    runtimeEvent: runtimeEvent('run-1', 100),
  });

  // Turn N: terminal arrives WITHOUT turnId (real KodaX terminal path shape).
  const secondMessageId = store.appendUserMessage(SID, 'second question', T1);
  assert.ok(secondMessageId);
  store.bindUserMessageRuntimeRun(SID, secondMessageId, 'run-2');
  store.appendEvent({
    kind: 'session_start',
    sessionId: SID,
    provider: 'mock',
    turnId: 'turn-2',
    runtimeEvent: runtimeEvent('run-2', 1),
  });
  store.appendEvent({
    kind: 'text_delta',
    sessionId: SID,
    text: 'second answer',
    turnId: 'turn-2',
    sentAt: T1 + 10,
    runtimeEvent: runtimeEvent('run-2', 5),
  });
  store.appendEvent({
    kind: 'session_complete',
    sessionId: SID,
    runtimeEvent: runtimeEvent('run-2', 100),
  });

  // Terminal reconcile installs the authoritative newest page. Main-process timestamps carry
  // the real-world renderer/main clock skew (each restored row lands ~1s after the optimistic
  // renderer sentAt that actually happened later).
  store.prependSessionHistory(
    SID,
    [
      {
        kind: 'user',
        content: 'first question',
        sentAt: T0 + 1_000,
        entryId: 'entry-u1',
        logicalId: 'logical-u1',
        canonicalIndex: 0,
        turnId: 'turn-1',
        turnUserOrdinal: 0,
      },
      {
        kind: 'assistant',
        text: 'first answer',
        sentAt: T0 + 1_001,
        entryId: 'entry-a1',
        logicalId: 'logical-a1',
        canonicalIndex: 1,
        turnId: 'turn-1',
      },
      {
        kind: 'user',
        content: 'second question',
        sentAt: T1 + 1_000,
        entryId: 'entry-u2',
        logicalId: 'logical-u2',
        canonicalIndex: 2,
        turnId: 'turn-2',
        turnUserOrdinal: 0,
      },
      {
        kind: 'assistant',
        text: 'second answer',
        sentAt: T1 + 1_001,
        entryId: 'entry-a2',
        logicalId: 'logical-a2',
        canonicalIndex: 3,
        turnId: 'turn-2',
      },
    ],
    CREATED_AT,
    { replaceLoadedWindow: true, authoritativeNewest: true, sourceRevision: 'source-rev-1' },
  );

  const transcript = visibleTranscript();
  assert.deepEqual(
    transcript,
    [
      'user:first question',
      'assistant:first answer',
      'user:second question',
      'assistant:second answer',
    ],
    `transcript must stay in causal order: ${JSON.stringify(transcript)}`,
  );
});

test('an ambiguous canonical page renders each logicalId exactly once', () => {
  const store = useAppStore.getState();
  const T0 = CREATED_AT + 5_000;
  // Shape reproduced from session 20260816_132905_g1806cde81c389: the compaction-retained
  // suffix and its archived original both appear as candidates (distinct entryIds, same
  // logicalId), and the daemon projection reports status 'ambiguous'.
  const candidates: SessionHistoryItem[] = [
    {
      kind: 'user',
      content: 'do the task',
      sentAt: T0,
      entryId: 'entry-a-u1',
      logicalId: 'logical-user-1',
      canonicalIndex: 0,
      turnId: 'turn-shared',
      turnUserOrdinal: 0,
    },
    {
      kind: 'assistant',
      text: 'task result',
      sentAt: T0 + 1,
      entryId: 'entry-a-a1',
      logicalId: 'logical-assistant-1',
      canonicalIndex: 1,
      turnId: 'turn-shared',
    },
    {
      kind: 'user',
      content: 'do the task',
      sentAt: T0 + 2,
      entryId: 'entry-b-u1',
      logicalId: 'logical-user-1',
      canonicalIndex: 50,
      turnId: 'turn-shared',
      turnUserOrdinal: 0,
    },
    {
      kind: 'assistant',
      text: 'task result',
      sentAt: T0 + 3,
      entryId: 'entry-b-a1',
      logicalId: 'logical-assistant-1',
      canonicalIndex: 51,
      turnId: 'turn-shared',
    },
  ];
  store.prependSessionHistory(SID, candidates, CREATED_AT, {
    replaceLoadedWindow: true,
    conversationStatus: 'ambiguous',
  });

  const transcript = visibleTranscript();
  assert.deepEqual(
    transcript,
    ['user:do the task', 'assistant:task result'],
    `ambiguous candidates sharing logicalId must render once, not be kept twice: ${JSON.stringify(transcript)}`,
  );
  const userRows = useAppStore.getState().userMessagesBySession[SID] ?? [];
  assert.equal(userRows.length, 1);
  assert.equal(
    userRows[0]?.canonicalIndex,
    0,
    'ambiguous dedupe must keep the first candidate (canonicalIndex 0), not the archived duplicate',
  );
});

test('an ambiguous page with the archived copy first still keeps the canonical candidate', () => {
  const store = useAppStore.getState();
  const T0 = CREATED_AT + 6_000;
  // Same double-booked shape, but the daemon served the archived copy (canonicalIndex 50/51)
  // BEFORE the re-created main copy (canonicalIndex 0/1). Positional keep-first would render
  // the archived duplicate; the canonicalIndex pre-scan must prefer the smaller index.
  const candidates: SessionHistoryItem[] = [
    {
      kind: 'user',
      content: 'do the task',
      sentAt: T0,
      entryId: 'entry-arch-u1',
      logicalId: 'logical-user-2',
      canonicalIndex: 50,
      turnId: 'turn-shared-2',
      turnUserOrdinal: 0,
    },
    {
      kind: 'assistant',
      text: 'task result',
      sentAt: T0 + 1,
      entryId: 'entry-arch-a1',
      logicalId: 'logical-assistant-2',
      canonicalIndex: 51,
      turnId: 'turn-shared-2',
    },
    {
      kind: 'user',
      content: 'do the task',
      sentAt: T0 + 2,
      entryId: 'entry-main-u1',
      logicalId: 'logical-user-2',
      canonicalIndex: 0,
      turnId: 'turn-shared-2',
      turnUserOrdinal: 0,
    },
    {
      kind: 'assistant',
      text: 'task result',
      sentAt: T0 + 3,
      entryId: 'entry-main-a1',
      logicalId: 'logical-assistant-2',
      canonicalIndex: 1,
      turnId: 'turn-shared-2',
    },
  ];
  store.prependSessionHistory(SID, candidates, CREATED_AT, {
    replaceLoadedWindow: true,
    conversationStatus: 'ambiguous',
  });

  const transcript = visibleTranscript();
  assert.deepEqual(
    transcript,
    ['user:do the task', 'assistant:task result'],
    `reversed ambiguous candidates must render once: ${JSON.stringify(transcript)}`,
  );
  const userRows = useAppStore.getState().userMessagesBySession[SID] ?? [];
  assert.equal(userRows.length, 1);
  assert.equal(
    userRows[0]?.canonicalIndex,
    0,
    'canonicalIndex pre-scan must keep the canonical (smaller index) copy even when the archived copy arrives first',
  );
});

test('a resolved page never dedupes rows that share a logicalId', () => {
  const store = useAppStore.getState();
  const T0 = CREATED_AT + 7_000;
  // Safety valve: distinct legitimate rows can share a logicalId family on resolved pages
  // (appStore.ts "Resolved pages never dedupe"). Deduping them would silently drop real history.
  const candidates: SessionHistoryItem[] = [
    {
      kind: 'user',
      content: 'first send',
      sentAt: T0,
      entryId: 'entry-res-u1',
      logicalId: 'logical-user-3',
      canonicalIndex: 0,
      turnId: 'turn-res-1',
      turnUserOrdinal: 0,
    },
    {
      kind: 'user',
      content: 'second send',
      sentAt: T0 + 1,
      entryId: 'entry-res-u2',
      logicalId: 'logical-user-3',
      canonicalIndex: 1,
      turnId: 'turn-res-2',
      turnUserOrdinal: 0,
    },
  ];
  store.prependSessionHistory(SID, candidates, CREATED_AT, {
    replaceLoadedWindow: true,
  });

  const transcript = visibleTranscript();
  assert.deepEqual(
    transcript,
    ['user:first send', 'user:second send'],
    `resolved rows sharing a logicalId must both render: ${JSON.stringify(transcript)}`,
  );
  const userRows = useAppStore.getState().userMessagesBySession[SID] ?? [];
  assert.equal(userRows.length, 2, 'resolved pages must never dedupe by logicalId');
});

test('an ambiguous page with three candidates keeps only the smallest canonicalIndex', () => {
  const store = useAppStore.getState();
  const T0 = CREATED_AT + 8_000;
  // Pins the best-slot displacement: ci=50 wins first, then ci=0 displaces it, then ci=20 loses.
  const mk = (n: number, canonicalIndex: number, content: string): SessionHistoryItem => ({
    kind: 'user',
    content,
    sentAt: T0 + n,
    entryId: `entry-three-u${n}`,
    logicalId: 'logical-user-4',
    canonicalIndex,
    turnId: 'turn-three-1',
    turnUserOrdinal: 0,
  });
  const candidates = [
    mk(0, 50, 'archived copy'),
    mk(1, 0, 'canonical copy'),
    mk(2, 20, 'stale copy'),
  ];
  store.prependSessionHistory(SID, candidates, CREATED_AT, {
    replaceLoadedWindow: true,
    conversationStatus: 'ambiguous',
  });

  const transcript = visibleTranscript();
  assert.deepEqual(
    transcript,
    ['user:canonical copy'],
    `three ambiguous candidates must collapse to the smallest canonicalIndex row: ${JSON.stringify(transcript)}`,
  );
  const userRows = useAppStore.getState().userMessagesBySession[SID] ?? [];
  assert.equal(userRows.length, 1);
  assert.equal(userRows[0]?.canonicalIndex, 0);
});
