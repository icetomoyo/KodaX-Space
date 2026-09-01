import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import type { SessionEvent, SessionHistoryItem } from '@kodax-space/space-ipc-schema';
import { composeMessages } from '../../renderer/src/features/session/composeMessages.js';
import { useAppStore } from '../../renderer/src/store/appStore.js';

const SID = 'live-history-next-query-order';
const CREATED_AT = 1_700_000_000_000;

beforeEach(() => {
  useAppStore.getState().resetSessionMessages(SID);
  useAppStore.setState({
    sessions: [
      {
        sessionId: SID,
        projectRoot: '/project',
        provider: 'mock',
        reasoningMode: 'auto',
        permissionMode: 'accept-edits',
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
});

function runtimeEvent(runId: string, seq: number) {
  return {
    runtimeId: 'runtime-live-order',
    runId,
    journalEpoch: 'epoch-live-order',
    seq,
  };
}

function appendCompletedLiveTurn(input: {
  readonly prompt: string;
  readonly sentAt: number;
  readonly runId: string;
  readonly turnId: string;
  readonly events: readonly SessionEvent[];
}): void {
  const store = useAppStore.getState();
  const messageId = store.appendUserMessage(SID, input.prompt, input.sentAt);
  assert.ok(messageId);
  store.bindUserMessageRuntimeRun(SID, messageId, input.runId);
  store.appendEvent({
    kind: 'session_start',
    sessionId: SID,
    provider: 'mock',
    turnId: input.turnId,
    runtimeEvent: runtimeEvent(input.runId, 1),
  });
  for (const event of input.events) store.appendEvent(event);
  store.appendEvent({
    kind: 'session_complete',
    sessionId: SID,
    turnId: input.turnId,
    runtimeEvent: runtimeEvent(input.runId, 100),
  });
}

function visibleTranscript(): readonly string[] {
  const state = useAppStore.getState();
  return composeMessages({
    events: state.eventsBySession[SID] ?? [],
    userMessages: state.userMessagesBySession[SID] ?? [],
  }).flatMap((message) => {
    if (message.kind === 'user') return [`user:${message.content}`];
    if (message.kind === 'assistant_text') return [`assistant:${message.text}`];
    if (message.kind === 'tool_call') return [`tool:${message.toolName}:${message.result ?? ''}`];
    return [];
  });
}

test('a next query stays after the prior answer when the newest page begins in that prior turn', () => {
  const store = useAppStore.getState();
  store.prependSessionHistory(
    SID,
    [
      {
        kind: 'user',
        content: 'older request',
        sentAt: CREATED_AT,
        entryId: 'entry-older-user',
        canonicalIndex: 0,
        turnId: 'turn-older',
        turnUserOrdinal: 0,
      },
      {
        kind: 'assistant',
        text: 'older answer',
        sentAt: CREATED_AT + 1,
        entryId: 'entry-older-answer',
        canonicalIndex: 1,
        turnId: 'turn-older',
      },
    ],
    CREATED_AT,
    { replaceLoadedWindow: true, authoritativeNewest: true, sourceRevision: 'source-initial' },
  );

  const interruptedRunId = 'run-review-interrupted';
  const interruptedTurnId = 'turn-review-interrupted';
  const interruptedMessageId = store.appendUserMessage(SID, 'review the changes', CREATED_AT + 5);
  assert.ok(interruptedMessageId);
  store.bindUserMessageRuntimeRun(SID, interruptedMessageId, interruptedRunId);
  store.appendEvent({
    kind: 'session_start',
    sessionId: SID,
    provider: 'mock',
    turnId: interruptedTurnId,
    runtimeEvent: runtimeEvent(interruptedRunId, 1),
  });
  store.appendEvent({
    kind: 'text_delta',
    sessionId: SID,
    text: 'the interrupted attempt',
    turnId: interruptedTurnId,
    runtimeEvent: runtimeEvent(interruptedRunId, 2),
  });
  store.appendEvent({
    kind: 'session_error',
    sessionId: SID,
    error: 'interrupted',
    turnId: interruptedTurnId,
    runtimeEvent: runtimeEvent(interruptedRunId, 3),
  });

  appendCompletedLiveTurn({
    prompt: 'review the changes',
    sentAt: CREATED_AT + 10,
    runId: 'run-review',
    turnId: 'turn-review',
    events: [
      {
        kind: 'thinking_delta',
        sessionId: SID,
        text: 'inspect the whole diff',
        turnId: 'turn-review',
        runtimeEvent: runtimeEvent('run-review', 2),
      },
      {
        kind: 'tool_start',
        sessionId: SID,
        toolId: 'tool-review',
        toolName: 'read',
        input: { path: 'SessionList.tsx' },
        turnId: 'turn-review',
        runtimeEvent: runtimeEvent('run-review', 3),
      },
      {
        kind: 'tool_result',
        sessionId: SID,
        toolId: 'tool-review',
        toolName: 'read',
        content: 'complete source body',
        turnId: 'turn-review',
        runtimeEvent: runtimeEvent('run-review', 4),
      },
      {
        kind: 'text_delta',
        sessionId: SID,
        text: 'review complete',
        turnId: 'turn-review',
        runtimeEvent: runtimeEvent('run-review', 5),
      },
    ],
  });

  appendCompletedLiveTurn({
    prompt: 'commit and push',
    sentAt: CREATED_AT + 30,
    runId: 'run-commit',
    turnId: 'turn-commit',
    events: [
      {
        kind: 'text_delta',
        sessionId: SID,
        text: 'commit complete',
        turnId: 'turn-commit',
        runtimeEvent: runtimeEvent('run-commit', 2),
      },
    ],
  });

  const newestPage: SessionHistoryItem[] = [
    { kind: 'history_truncation', scope: 'history', omittedItems: 154 },
    {
      kind: 'tool_call',
      toolId: 'tool-review',
      toolName: 'read',
      input: { path: 'SessionList.tsx' },
      result: 'complete source body',
      entryId: 'entry-review-tool',
      canonicalIndex: 154,
      turnId: 'turn-review',
    },
    {
      kind: 'assistant',
      text: 'review complete',
      sentAt: CREATED_AT + 20,
      entryId: 'entry-review-final',
      canonicalIndex: 196,
      turnId: 'turn-review',
    },
    {
      kind: 'user',
      content: 'commit and push',
      sentAt: CREATED_AT + 30,
      entryId: 'entry-commit-user',
      canonicalIndex: 197,
      turnId: 'turn-commit',
      turnUserOrdinal: 0,
    },
    {
      kind: 'assistant',
      text: 'commit complete',
      sentAt: CREATED_AT + 31,
      entryId: 'entry-commit-answer',
      canonicalIndex: 198,
      turnId: 'turn-commit',
    },
  ];
  store.prependSessionHistory(SID, newestPage, CREATED_AT, {
    replaceLoadedWindow: true,
    authoritativeNewest: true,
    sourceRevision: 'source-after-review',
  });

  const transcript = visibleTranscript();
  assert.deepEqual(transcript, [
    'user:review the changes',
    'assistant:the interrupted attempt',
    'user:review the changes',
    'assistant:',
    'tool:read:complete source body',
    'assistant:review complete',
    'user:commit and push',
    'assistant:commit complete',
  ]);
  const priorAnswerIndex = transcript.indexOf('assistant:review complete');
  const nextQueryIndex = transcript.indexOf('user:commit and push');
  assert.ok(priorAnswerIndex >= 0, 'the completed prior answer remains visible');
  assert.ok(nextQueryIndex >= 0, 'the next optimistic query remains visible');
  assert.ok(
    priorAnswerIndex < nextQueryIndex,
    `the prior answer must remain before the next query: ${JSON.stringify(transcript)}`,
  );
});

test('every earlier live turn moves with its answer before an exact leading suffix', () => {
  appendCompletedLiveTurn({
    prompt: 'first earlier query',
    sentAt: CREATED_AT + 1,
    runId: 'run-first-earlier',
    turnId: 'turn-first-earlier',
    events: [
      {
        kind: 'text_delta',
        sessionId: SID,
        text: 'first earlier answer',
        turnId: 'turn-first-earlier',
        runtimeEvent: runtimeEvent('run-first-earlier', 2),
      },
    ],
  });
  appendCompletedLiveTurn({
    prompt: 'second earlier query',
    sentAt: CREATED_AT + 10,
    runId: 'run-second-earlier',
    turnId: 'turn-second-earlier',
    events: [
      {
        kind: 'text_delta',
        sessionId: SID,
        text: 'second earlier answer',
        turnId: 'turn-second-earlier',
        runtimeEvent: runtimeEvent('run-second-earlier', 2),
      },
    ],
  });
  appendCompletedLiveTurn({
    prompt: 'bounded owner query',
    sentAt: CREATED_AT + 20,
    runId: 'run-bounded-owner',
    turnId: 'turn-bounded-owner',
    events: [
      {
        kind: 'text_delta',
        sessionId: SID,
        text: 'bounded owner answer',
        turnId: 'turn-bounded-owner',
        runtimeEvent: runtimeEvent('run-bounded-owner', 2),
      },
    ],
  });
  appendCompletedLiveTurn({
    prompt: 'later query',
    sentAt: CREATED_AT + 30,
    runId: 'run-later',
    turnId: 'turn-later',
    events: [
      {
        kind: 'text_delta',
        sessionId: SID,
        text: 'later answer',
        turnId: 'turn-later',
        runtimeEvent: runtimeEvent('run-later', 2),
      },
    ],
  });

  useAppStore.getState().prependSessionHistory(
    SID,
    [
      { kind: 'history_truncation', scope: 'history', omittedItems: 100 },
      {
        kind: 'assistant',
        text: 'bounded owner answer',
        entryId: 'entry-bounded-owner-answer',
        canonicalIndex: 100,
        turnId: 'turn-bounded-owner',
      },
      {
        kind: 'user',
        content: 'later query',
        sentAt: CREATED_AT + 30,
        entryId: 'entry-later-user',
        canonicalIndex: 101,
        turnId: 'turn-later',
        turnUserOrdinal: 0,
      },
      {
        kind: 'assistant',
        text: 'later answer',
        entryId: 'entry-later-answer',
        canonicalIndex: 102,
        turnId: 'turn-later',
      },
    ],
    CREATED_AT,
    { replaceLoadedWindow: true, authoritativeNewest: true, sourceRevision: 'source-multi-prefix' },
  );

  assert.deepEqual(visibleTranscript(), [
    'user:first earlier query',
    'assistant:first earlier answer',
    'user:second earlier query',
    'assistant:second earlier answer',
    'user:bounded owner query',
    'assistant:bounded owner answer',
    'user:later query',
    'assistant:later answer',
  ]);
});

test('an unmatched earlier live turn relocates before a page-head canonical turn (latest query must not sink)', () => {
  const store = useAppStore.getState();
  appendCompletedLiveTurn({
    prompt: 'first query',
    sentAt: CREATED_AT + 1,
    runId: 'run-first',
    turnId: 'turn-first',
    events: [
      {
        kind: 'text_delta',
        sessionId: SID,
        text: 'first answer',
        turnId: 'turn-first',
        runtimeEvent: runtimeEvent('run-first', 2),
      },
    ],
  });
  appendCompletedLiveTurn({
    prompt: 'latest query',
    sentAt: CREATED_AT + 10,
    runId: 'run-latest',
    turnId: 'turn-latest',
    events: [
      {
        kind: 'text_delta',
        sessionId: SID,
        text: 'latest answer',
        turnId: 'turn-latest',
        runtimeEvent: runtimeEvent('run-latest', 2),
      },
    ],
  });

  // The canonical page starts WITH the latest turn's user row (not a leadingPartial anchor)
  // and leaves the earlier live-only turn outside its window.
  store.prependSessionHistory(
    SID,
    [
      { kind: 'history_truncation', scope: 'history', omittedItems: 100 },
      {
        kind: 'user',
        content: 'latest query',
        sentAt: CREATED_AT + 10,
        entryId: 'entry-latest-user',
        canonicalIndex: 101,
        turnId: 'turn-latest',
        turnUserOrdinal: 0,
      },
      {
        kind: 'assistant',
        text: 'latest answer',
        sentAt: CREATED_AT + 11,
        entryId: 'entry-latest-answer',
        canonicalIndex: 102,
        turnId: 'turn-latest',
      },
    ],
    CREATED_AT,
    { replaceLoadedWindow: true, authoritativeNewest: true, sourceRevision: 'source-page-head' },
  );

  assert.deepEqual(visibleTranscript(), [
    'user:first query',
    'assistant:first answer',
    'user:latest query',
    'assistant:latest answer',
  ]);
});

test('a tool-shaped latest turn keeps its canonical answer paired with its own query', () => {
  const store = useAppStore.getState();
  appendCompletedLiveTurn({
    prompt: 'first query',
    sentAt: CREATED_AT + 1,
    runId: 'run-first',
    turnId: 'turn-first',
    events: [
      {
        kind: 'text_delta',
        sessionId: SID,
        text: 'first answer',
        turnId: 'turn-first',
        runtimeEvent: runtimeEvent('run-first', 2),
      },
    ],
  });

  // Latest turn streams thinking + a tool call; its final answer text lives only in canonical.
  const toolRunId = 'run-latest';
  const toolTurnId = 'turn-latest';
  const toolMessageId = store.appendUserMessage(SID, 'latest query', CREATED_AT + 10);
  assert.ok(toolMessageId);
  store.bindUserMessageRuntimeRun(SID, toolMessageId, toolRunId);
  store.appendEvent({
    kind: 'session_start',
    sessionId: SID,
    provider: 'mock',
    turnId: toolTurnId,
    runtimeEvent: runtimeEvent(toolRunId, 1),
  });
  store.appendEvent({
    kind: 'thinking_delta',
    sessionId: SID,
    text: 'plan the diagrams',
    turnId: toolTurnId,
    runtimeEvent: runtimeEvent(toolRunId, 2),
  });
  store.appendEvent({
    kind: 'tool_start',
    sessionId: SID,
    toolId: 'tool-latest',
    toolName: 'multi_edit',
    input: { path: 'doc.md' },
    turnId: toolTurnId,
    runtimeEvent: runtimeEvent(toolRunId, 3),
  });
  store.appendEvent({
    kind: 'tool_result',
    sessionId: SID,
    toolId: 'tool-latest',
    toolName: 'multi_edit',
    content: 'edited',
    turnId: toolTurnId,
    runtimeEvent: runtimeEvent(toolRunId, 4),
  });
  store.appendEvent({
    kind: 'session_complete',
    sessionId: SID,
    turnId: toolTurnId,
    runtimeEvent: runtimeEvent(toolRunId, 100),
  });

  store.prependSessionHistory(
    SID,
    [
      { kind: 'history_truncation', scope: 'history', omittedItems: 100 },
      {
        kind: 'user',
        content: 'latest query',
        sentAt: CREATED_AT + 10,
        entryId: 'entry-latest-user',
        canonicalIndex: 101,
        turnId: toolTurnId,
        turnUserOrdinal: 0,
      },
      {
        kind: 'assistant',
        text: 'six diagrams inserted',
        sentAt: CREATED_AT + 11,
        entryId: 'entry-latest-answer',
        canonicalIndex: 102,
        turnId: toolTurnId,
      },
    ],
    CREATED_AT,
    { replaceLoadedWindow: true, authoritativeNewest: true, sourceRevision: 'source-tool-head' },
  );

  const transcript = visibleTranscript();
  const latestQueryCount = transcript.filter((line) => line === 'user:latest query').length;
  assert.equal(latestQueryCount, 1, `the latest query must render exactly once: ${JSON.stringify(transcript)}`);
  const canonicalAnswerIndex = transcript.indexOf('assistant:six diagrams inserted');
  const latestQueryIndex = transcript.indexOf('user:latest query');
  const firstAnswerIndex = transcript.indexOf('assistant:first answer');
  assert.ok(
    canonicalAnswerIndex > latestQueryIndex,
    `the canonical answer must stay after its own query: ${JSON.stringify(transcript)}`,
  );
  assert.ok(
    firstAnswerIndex < latestQueryIndex,
    `the earlier answer must stay before the latest query: ${JSON.stringify(transcript)}`,
  );
});

test('a live turn matched by a later canonical row folds once while an older live turn relocates', () => {
  const store = useAppStore.getState();
  appendCompletedLiveTurn({
    prompt: 'B query',
    sentAt: CREATED_AT + 5,
    runId: 'run-b',
    turnId: 'turn-b',
    events: [
      {
        kind: 'text_delta',
        sessionId: SID,
        text: 'B live answer',
        turnId: 'turn-b',
        runtimeEvent: runtimeEvent('run-b', 2),
      },
    ],
  });
  appendCompletedLiveTurn({
    prompt: 'old query',
    sentAt: CREATED_AT + 8,
    runId: 'run-old',
    turnId: 'turn-old',
    events: [
      {
        kind: 'text_delta',
        sessionId: SID,
        text: 'old answer',
        turnId: 'turn-old',
        runtimeEvent: runtimeEvent('run-old', 2),
      },
    ],
  });

  store.prependSessionHistory(
    SID,
    [
      { kind: 'history_truncation', scope: 'history', omittedItems: 100 },
      {
        kind: 'user',
        content: 'A query',
        sentAt: CREATED_AT + 10,
        entryId: 'entry-a-user',
        canonicalIndex: 101,
        turnId: 'turn-a',
        turnUserOrdinal: 0,
      },
      {
        kind: 'assistant',
        text: 'A canonical answer',
        sentAt: CREATED_AT + 11,
        entryId: 'entry-a-answer',
        canonicalIndex: 102,
        turnId: 'turn-a',
      },
      {
        kind: 'user',
        content: 'B query',
        sentAt: CREATED_AT + 20,
        entryId: 'entry-b-user',
        canonicalIndex: 103,
        turnId: 'turn-b',
        turnUserOrdinal: 0,
      },
      {
        kind: 'assistant',
        text: 'B canonical answer',
        sentAt: CREATED_AT + 21,
        entryId: 'entry-b-answer',
        canonicalIndex: 104,
        turnId: 'turn-b',
      },
    ],
    CREATED_AT,
    { replaceLoadedWindow: true, authoritativeNewest: true, sourceRevision: 'source-mixed-block' },
  );

  const transcript = visibleTranscript();
  const bQueryCount = transcript.filter((line) => line === 'user:B query').length;
  assert.equal(bQueryCount, 1, `the matched live turn must fold, not duplicate: ${JSON.stringify(transcript)}`);
  const order = transcript.filter((line) => line.startsWith('user:'));
  assert.deepEqual(order, [
    'user:old query',
    'user:A query',
    'user:B query',
  ]);
  assert.ok(
    transcript.some((line) => line.startsWith('assistant:B canonical answer')),
    `the canonical B answer must remain visible: ${JSON.stringify(transcript)}`,
  );
});

test('a second older page keeps the relocated live order', () => {
  const store = useAppStore.getState();
  appendCompletedLiveTurn({
    prompt: 'old query',
    sentAt: CREATED_AT + 5,
    runId: 'run-old',
    turnId: 'turn-old',
    events: [
      {
        kind: 'text_delta',
        sessionId: SID,
        text: 'old answer',
        turnId: 'turn-old',
        runtimeEvent: runtimeEvent('run-old', 2),
      },
    ],
  });
  appendCompletedLiveTurn({
    prompt: 'new query',
    sentAt: CREATED_AT + 15,
    runId: 'run-new',
    turnId: 'turn-new',
    events: [
      {
        kind: 'text_delta',
        sessionId: SID,
        text: 'new answer',
        turnId: 'turn-new',
        runtimeEvent: runtimeEvent('run-new', 2),
      },
    ],
  });

  store.prependSessionHistory(
    SID,
    [
      { kind: 'history_truncation', scope: 'history', omittedItems: 90 },
      {
        kind: 'user',
        content: 'A query',
        sentAt: CREATED_AT + 10,
        entryId: 'entry-a-user',
        canonicalIndex: 101,
        turnId: 'turn-a',
        turnUserOrdinal: 0,
      },
      {
        kind: 'assistant',
        text: 'A canonical answer',
        sentAt: CREATED_AT + 11,
        entryId: 'entry-a-answer',
        canonicalIndex: 102,
        turnId: 'turn-a',
      },
    ],
    CREATED_AT,
    { replaceLoadedWindow: true, authoritativeNewest: true, sourceRevision: 'source-page-1' },
  );

  store.prependSessionHistory(
    SID,
    [
      { kind: 'history_truncation', scope: 'history', omittedItems: 50 },
      {
        kind: 'user',
        content: 'Z query',
        sentAt: CREATED_AT + 1,
        entryId: 'entry-z-user',
        canonicalIndex: 10,
        turnId: 'turn-z',
        turnUserOrdinal: 0,
      },
      {
        kind: 'assistant',
        text: 'Z canonical answer',
        sentAt: CREATED_AT + 2,
        entryId: 'entry-z-answer',
        canonicalIndex: 11,
        turnId: 'turn-z',
      },
      {
        kind: 'user',
        content: 'A query',
        sentAt: CREATED_AT + 10,
        entryId: 'entry-a-user',
        canonicalIndex: 101,
        turnId: 'turn-a',
        turnUserOrdinal: 0,
      },
      {
        kind: 'assistant',
        text: 'A canonical answer',
        sentAt: CREATED_AT + 11,
        entryId: 'entry-a-answer',
        canonicalIndex: 102,
        turnId: 'turn-a',
      },
    ],
    CREATED_AT,
    { replaceLoadedWindow: true, includeLiveProjection: true, sourceRevision: 'source-page-2' },
  );

  assert.deepEqual(visibleTranscript(), [
    'user:Z query',
    'assistant:Z canonical answer',
    'user:old query',
    'assistant:old answer',
    'user:A query',
    'assistant:A canonical answer',
    'user:new query',
    'assistant:new answer',
  ]);
});
