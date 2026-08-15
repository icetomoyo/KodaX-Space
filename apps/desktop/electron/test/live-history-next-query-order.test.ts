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
  const interruptedMessageId = store.appendUserMessage(
    SID,
    'review the changes',
    CREATED_AT + 5,
  );
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
