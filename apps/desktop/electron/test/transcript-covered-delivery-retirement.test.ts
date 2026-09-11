import { test } from 'node:test';
import assert from 'node:assert/strict';
import { composeMessages } from '../../renderer/src/features/session/composeMessages.js';
import { useAppStore, sessionCanonicalTranscriptPage } from '../../renderer/src/store/appStore.js';
import type { SessionHistoryItem } from '@kodax-space/space-ipc-schema';

function registerSession(sessionId: string): void {
  useAppStore.setState((state) => ({
    sessions: [
      ...state.sessions.filter((session) => session.sessionId !== sessionId),
      {
        sessionId,
        projectRoot: '/repro',
        provider: 'mock',
        reasoningMode: 'auto',
        permissionMode: 'accept-edits',
        agentMode: 'ama',
        surface: 'code',
        createdAt: 1,
        lastActivityAt: 1,
      },
    ],
  }));
  useAppStore.getState().resetSessionMessages(sessionId);
}

function renderedTranscript(sessionId: string): string[] {
  const state = useAppStore.getState();
  return composeMessages({
    events: state.eventsBySession[sessionId] ?? [],
    userMessages: state.userMessagesBySession[sessionId] ?? [],
  }).flatMap((message) =>
    message.kind === 'user'
      ? [message.content]
      : message.kind === 'assistant_text'
        ? [message.text]
        : [],
  );
}

function canonicalTurn(ordinal: number): SessionHistoryItem[] {
  return [
    {
      kind: 'user',
      content: `Q${ordinal}`,
      entryId: `q-${ordinal}`,
      canonicalIndex: ordinal * 2,
      historyTurnIndex: ordinal,
      turnId: `turn-${ordinal}`,
      turnUserOrdinal: 0,
    },
    {
      kind: 'assistant',
      text: `A${ordinal}`,
      entryId: `a-${ordinal}`,
      canonicalIndex: ordinal * 2 + 1,
      turnId: `turn-${ordinal}`,
    },
  ];
}

test('rewind and fork retain source planes when canonical history reloads', () => {
  const source = 'rewind-source-planes';
  const child = 'fork-source-planes';
  const store = useAppStore.getState();
  registerSession(source);
  registerSession(child);
  const options = {
    replaceLoadedWindow: true,
    authoritativeNewest: true,
    conversationStatus: 'resolved' as const,
    sourceRevision: 'rewind-source',
  };
  store.prependSessionHistory(source, [...canonicalTurn(0), ...canonicalTurn(1)], 1, options);
  assert.deepEqual(renderedTranscript(source), ['Q0', 'A0', 'Q1', 'A1']);
  store.forkSessionBuffers(source, child, 0);
  store.prependSessionHistory(child, canonicalTurn(0), 1, options);
  assert.deepEqual(renderedTranscript(child), ['Q0', 'A0']);
  store.rewindSessionBuffers(source, 0);
  store.prependSessionHistory(source, canonicalTurn(0), 1, options);
  assert.deepEqual(renderedTranscript(source), ['Q0', 'A0']);
});

test('attachment completion updates a canonical owner without reintroducing a live copy', () => {
  const sid = 'canonical-attachment-completion';
  const store = useAppStore.getState();
  registerSession(sid);
  store.prependSessionHistory(sid, canonicalTurn(0), 1, { replaceLoadedWindow: true });
  const owner = useAppStore.getState().userMessagesBySession[sid]![0]!;
  store.updateUserMessageAttachments(sid, owner.id, [
    { id: 'image-completed', kind: 'image', status: 'missing' },
  ]);
  assert.equal(
    useAppStore.getState().userMessagesBySession[sid]![0]!.attachments?.[0]?.id,
    'image-completed',
  );
  assert.equal(
    sessionCanonicalTranscriptPage(sid)!.userMessages[0]!.attachments?.[0]?.id,
    'image-completed',
  );
  assert.deepEqual(renderedTranscript(sid), ['Q0', 'A0']);
});

test('visiting more than 32 sessions never discards an uncovered live query', () => {
  const store = useAppStore.getState();
  for (let index = 0; index < 34; index++) {
    const sid = `uncovered-session-${index}`;
    registerSession(sid);
    store.prependSessionHistory(sid, canonicalTurn(0), 1, { replaceLoadedWindow: true });
    store.appendUserMessage(sid, `uncovered-${index}`, 100);
    store.evictRestoredSessionHistory(sid);
  }
  store.prependSessionHistory('uncovered-session-0', canonicalTurn(0), 1, {
    replaceLoadedWindow: true,
  });
  assert.deepEqual(renderedTranscript('uncovered-session-0'), ['Q0', 'A0', 'uncovered-0']);
});

test('late send-operation completion updates the settled canonical owner', () => {
  const sid = 'canonical-send-operation';
  registerSession(sid);
  const store = useAppStore.getState();
  const id = store.appendUserMessage(sid, 'Q0', 1, undefined, 'operation-0')!;
  store.bindUserMessageRuntimeRun(sid, id, 'run-0');
  const runtimeEvent = (seq: number) => ({
    runtimeId: 'runtime-0',
    runId: 'run-0',
    journalEpoch: 'epoch-0',
    seq,
  });
  store.appendEvent({
    kind: 'session_start',
    sessionId: sid,
    turnId: 'turn-0',
    provider: 'mock',
    runtimeEvent: runtimeEvent(1),
  });
  store.appendEvent({
    kind: 'text_delta',
    sessionId: sid,
    turnId: 'turn-0',
    text: 'A0',
    runtimeEvent: runtimeEvent(2),
  });
  store.appendEvent({
    kind: 'session_complete',
    sessionId: sid,
    turnId: 'turn-0',
    runtimeEvent: runtimeEvent(3),
  });
  store.prependSessionHistory(sid, canonicalTurn(0), 1, {
    replaceLoadedWindow: true,
    authoritativeNewest: true,
    conversationStatus: 'resolved',
    sourceRevision: 'source-0',
    settledRuntimeRuns: [{ runtimeId: 'runtime-0', runId: 'run-0', generation: 1 }],
  });
  assert.equal(useAppStore.getState().userMessagesBySession[sid]![0]!.operationId, 'operation-0');
  store.settleSendOperationMessage(sid, 'operation-0');
  store.updateSendOperationAttachments(sid, 'operation-0', [
    { id: 'operation-image', kind: 'image', status: 'missing' },
  ]);
  const owner = useAppStore.getState().userMessagesBySession[sid]![0]!;
  assert.equal(owner.sendAdmissionSettled, true);
  assert.equal(owner.attachments?.[0]?.id, 'operation-image');
  assert.deepEqual(renderedTranscript(sid), ['Q0', 'A0']);
});

test('retiring a covered delivery preserves other inputs in the same Run and turn', () => {
  const sid = 'same-run-two-turns';
  const runId = 'run-shared';
  const runtimeId = 'runtime-shared';
  const time = 1789093440000;
  useAppStore.setState({
    sessions: [
      {
        sessionId: sid,
        projectRoot: '/repro',
        provider: 'mock',
        reasoningMode: 'auto',
        permissionMode: 'accept-edits',
        agentMode: 'ama',
        surface: 'code',
        createdAt: time,
        lastActivityAt: time,
      },
    ],
    currentSessionId: sid,
  });
  const store = useAppStore.getState();
  const origin = (seq: number) => ({ runtimeId, runId, journalEpoch: 'epoch', seq });
  const id = store.appendUserMessage(sid, 'Q1', time)!;
  store.bindUserMessageRuntimeRun(sid, id, runId);
  store.appendEvent({
    kind: 'session_start',
    sessionId: sid,
    provider: 'mock',
    turnId: 'turn-1',
    runtimeEvent: origin(1),
  });
  store.appendEvent({
    kind: 'text_delta',
    sessionId: sid,
    text: 'A1',
    turnId: 'turn-1',
    runtimeEvent: origin(2),
  });
  const now = Date.now;
  Date.now = () => time + 1000;
  try {
    store.appendEvent({
      kind: 'mid_turn_user_prompt',
      sessionId: sid,
      content: 'Q2',
      turnId: 'turn-1',
      turnUserOrdinal: 1,
      entryId: 'entry-q2',
      queueId: 'input-q2',
      sentAt: time + 1000,
      runtimeEvent: origin(3),
    });
  } finally {
    Date.now = now;
  }
  const secondOwner = useAppStore
    .getState()
    .userMessagesBySession[sid]?.find((m) => m.content === 'Q2');
  assert.ok(secondOwner);
  store.bindUserMessageRuntimeRun(sid, secondOwner.id, runId);
  store.appendEvent({
    kind: 'text_delta',
    sessionId: sid,
    text: 'A2',
    turnId: 'turn-1',
    runtimeEvent: origin(4),
  });
  store.appendEvent({
    kind: 'session_complete',
    sessionId: sid,
    turnId: 'turn-1',
    runtimeEvent: origin(5),
  });
  const rendered = () => {
    const state = useAppStore.getState();
    return composeMessages({
      events: state.eventsBySession[sid] ?? [],
      userMessages: state.userMessagesBySession[sid] ?? [],
    }).flatMap((m) =>
      m.kind === 'user' ? [m.content] : m.kind === 'assistant_text' ? [m.text] : [],
    );
  };
  // A bounded newest page covers only the later turn of this completed Run.
  store.prependSessionHistory(
    sid,
    [
      { kind: 'history_truncation', scope: 'history', omittedItems: 2 },
      {
        kind: 'user',
        content: 'Q2',
        turnId: 'turn-1',
        turnUserOrdinal: 1,
        entryId: 'entry-q2',
        canonicalIndex: 10,
        sentAt: time + 1000,
      },
      {
        kind: 'assistant',
        text: 'A2',
        turnId: 'turn-1',
        entryId: 'entry-a2',
        canonicalIndex: 11,
        sentAt: time + 2000,
      },
    ],
    time,
    {
      replaceLoadedWindow: true,
      authoritativeNewest: true,
      conversationStatus: 'resolved',
      sourceRevision: 'newest-revision',
      settledRuntimeRuns: [{ runtimeId, runId, generation: 1 }],
    },
  );
  const after = rendered();
  assert.equal(
    after.filter((text) => text === 'A1').length,
    1,
    'an uncovered earlier turn in the same Run must retain its only answer',
  );
  assert.deepEqual(after, ['Q1', 'A1', 'Q2', 'A2']);
  store.evictRestoredSessionHistory(sid);
  store.appendEvent({
    kind: 'mid_turn_user_prompt',
    sessionId: sid,
    content: 'Q2',
    turnId: 'turn-1',
    turnUserOrdinal: 1,
    entryId: 'entry-q2',
    queueId: 'input-q2',
    runtimeEvent: origin(3),
  });
  store.appendEvent({
    kind: 'text_delta',
    sessionId: sid,
    text: 'A2',
    turnId: 'turn-1',
    runtimeEvent: origin(4),
  });
  assert.deepEqual(
    rendered(),
    ['Q1', 'A1'],
    'replay of the covered delivery must not resurrect beside the uncovered earlier input',
  );
  store.appendEvent({
    kind: 'mid_turn_user_prompt',
    sessionId: sid,
    content: 'Q3',
    turnId: 'turn-1',
    turnUserOrdinal: 2,
    entryId: 'entry-q3',
    queueId: 'input-q3',
    runtimeEvent: origin(3),
  });
  store.appendEvent({
    kind: 'text_delta',
    sessionId: sid,
    text: 'A3',
    turnId: 'turn-1',
    runtimeEvent: origin(6),
  });
  assert.deepEqual(
    rendered(),
    ['Q1', 'A1', 'Q3', 'A3'],
    'a distinct input at the same batch sequence remains visible',
  );
});

test('a retired delivery cannot return through journal replay after its canonical window is evicted', () => {
  const sid = 'retired-delivery-replay';
  const store = useAppStore.getState();
  useAppStore.setState({
    sessions: [
      {
        sessionId: sid,
        projectRoot: '/repro',
        provider: 'mock',
        reasoningMode: 'auto',
        permissionMode: 'accept-edits',
        agentMode: 'ama',
        surface: 'code',
        createdAt: 1000,
        lastActivityAt: 1000,
      },
    ],
  });
  store.resetSessionMessages(sid);
  const runtimeEvent = (seq: number) => ({
    runtimeId: 'runtime-replay',
    runId: 'run-replay',
    journalEpoch: 'epoch-replay',
    seq,
  });
  const boundary = {
    kind: 'mid_turn_user_prompt' as const,
    sessionId: sid,
    content: 'settled query',
    turnId: 'turn-replay',
    turnUserOrdinal: 0,
    entryId: 'entry-replay',
    queueId: 'input-replay',
    runtimeEvent: runtimeEvent(2),
  };
  store.appendEvent(boundary);
  store.bindUserMessageRuntimeRun(
    sid,
    useAppStore.getState().userMessagesBySession[sid]![0]!.id,
    'run-replay',
  );
  store.appendEvent({
    kind: 'text_delta',
    sessionId: sid,
    text: 'settled answer',
    turnId: 'turn-replay',
    runtimeEvent: runtimeEvent(3),
  });
  const sidecarMessage = {
    source: 'sidecar-verifier' as const,
    verdict: 'revise' as const,
    recipient: 'main-agent' as const,
    delivery: 'synthetic-user-message' as const,
    content: 'settled feedback',
  };
  store.appendEvent({
    kind: 'sidecar_message',
    sessionId: sid,
    turnId: 'turn-replay',
    message: sidecarMessage,
    runtimeEvent: runtimeEvent(4),
  });
  store.appendEvent({
    kind: 'session_complete',
    sessionId: sid,
    turnId: 'turn-replay',
    runtimeEvent: runtimeEvent(5),
  });
  assert.equal(useAppStore.getState().userMessagesBySession[sid]?.length, 1);
  store.prependSessionHistory(
    sid,
    [
      {
        kind: 'user',
        content: 'settled query',
        entryId: 'entry-replay',
        canonicalIndex: 0,
        turnId: 'turn-replay',
        turnUserOrdinal: 0,
      },
      {
        kind: 'assistant',
        text: 'settled answer',
        entryId: 'entry-answer',
        canonicalIndex: 1,
        turnId: 'turn-replay',
      },
      {
        kind: 'sidecar_message',
        message: sidecarMessage,
        turnId: 'turn-replay',
        entryId: 'entry-sidecar',
        canonicalIndex: 2,
      },
    ],
    1000,
    {
      replaceLoadedWindow: true,
      authoritativeNewest: true,
      conversationStatus: 'resolved',
      sourceRevision: 'source-replay',
      settledRuntimeRuns: [{ runtimeId: 'runtime-replay', runId: 'run-replay', generation: 1 }],
    },
  );
  store.evictRestoredSessionHistory(sid);
  store.appendEvent(boundary);
  const state = useAppStore.getState();
  assert.deepEqual(
    composeMessages({
      userMessages: state.userMessagesBySession[sid] ?? [],
      events: state.eventsBySession[sid] ?? [],
    }),
    [],
    'replay must not mint a query below an already settled answer',
  );
  store.replaceRuntimeProfileProjection({
    connection: {
      state: 'ready',
      changedAt: 1,
      stale: false,
      runtimeId: 'runtime-replay',
      profile: 'default',
      capabilities: [],
    },
    projectionRevision: 1,
    cursor: { runtimeId: 'runtime-replay', seq: 1 },
    sessions: [],
    interactions: [],
    notifications: [],
  });
  assert.equal(
    store.replaceSessionLiveProjection({
      sessionId: sid,
      projectionRevision: 1,
      cursor: {
        runtimeId: 'runtime-replay',
        sessionId: sid,
        journalEpoch: 'epoch-replay',
        seq: 10,
      },
      transcriptRevision: 'tx-replay',
      queuedRuns: [],
      queuedInputs: [],
      activeTools: [],
      todos: [],
      interactions: [],
      lastTerminalRun: {
        runId: 'run-replay',
        sessionId: sid,
        phase: 'completed',
        turnId: 'turn-replay',
      },
      assistantDraft: { text: 'settled answer', startedAt: 1 },
      sidecarMessages: [
        {
          eventId: 'sidecar-replay',
          runId: 'run-replay',
          turnId: 'turn-replay',
          seq: 4,
          createdAt: 1000,
          message: sidecarMessage,
        },
      ],
    }),
    true,
  );
  assert.equal(
    useAppStore.getState().eventsBySession[sid]?.length ?? 0,
    0,
    'a newer terminal snapshot cannot rehydrate a retired Run',
  );
  const accepted = useAppStore.getState().liveProjectionBySession[sid]!;
  store.replaceSessionLiveProjection({
    ...accepted,
    projectionRevision: 2,
    cursor: { ...accepted.cursor, seq: 12 },
    sidecarMessages: [
      {
        eventId: 'sidecar-new',
        runId: 'run-replay',
        turnId: 'turn-replay',
        seq: 11,
        createdAt: 2000,
        message: { ...sidecarMessage, content: 'new feedback' },
      },
    ],
  });
  assert.deepEqual(
    useAppStore
      .getState()
      .eventsBySession[sid]?.filter((event) => event.kind === 'sidecar_message')
      .map((event) => event.message.content),
    ['new feedback'],
    'retirement must retain sidecar content beyond the certified journal coverage',
  );
  store.replaceSessionLiveProjection({
    ...useAppStore.getState().liveProjectionBySession[sid]!,
    projectionRevision: 3,
    cursor: { ...accepted.cursor, seq: 14 },
    outputSegment: {
      retained: [
        {
          responseId: 'unseen-response',
          providerRequestId: 'unseen-request',
          mode: 'append',
          startedAtSeq: 6,
          thinkingText: '',
          thinkingTextStartOffset: 0,
          assistantText: 'previously unseen output',
          assistantTextStartOffset: 0,
        },
      ],
    },
  });
  assert.ok(
    useAppStore
      .getState()
      .eventsBySession[
        sid
      ]?.some((event) => event.kind === 'text_delta' && event.text === 'previously unseen output'),
    'retiring the initial input must not discard an unseen output segment from the same Run',
  );
  store.appendEvent({
    ...boundary,
    content: 'new epoch query',
    runtimeEvent: { ...runtimeEvent(2), journalEpoch: 'epoch-new' },
  });
  assert.equal(renderedTranscript(sid).filter((text) => text === 'new epoch query').length, 1);
});

test('retiring all observed units never proves coverage of a first-seen earlier input', () => {
  const sid = 'unknown-earlier-delivery';
  registerSession(sid);
  const store = useAppStore.getState();
  const origin = (seq: number) => ({
    runtimeId: 'unknown-runtime',
    runId: 'unknown-run',
    journalEpoch: 'unknown-epoch',
    seq,
  });
  store.appendEvent({
    kind: 'mid_turn_user_prompt',
    sessionId: sid,
    content: 'Q2',
    entryId: 'unknown-q2',
    queueId: 'unknown-input2',
    turnId: 'unknown-turn',
    turnUserOrdinal: 1,
    runtimeEvent: origin(3),
  });
  store.bindUserMessageRuntimeRun(
    sid,
    useAppStore.getState().userMessagesBySession[sid]![0]!.id,
    'unknown-run',
  );
  store.appendEvent({
    kind: 'text_delta',
    sessionId: sid,
    text: 'A2',
    turnId: 'unknown-turn',
    runtimeEvent: origin(4),
  });
  store.appendEvent({
    kind: 'session_complete',
    sessionId: sid,
    turnId: 'unknown-turn',
    runtimeEvent: origin(5),
  });
  store.prependSessionHistory(
    sid,
    [
      { kind: 'history_truncation', scope: 'history', omittedItems: 2 },
      {
        kind: 'user',
        content: 'Q2',
        entryId: 'unknown-q2',
        turnId: 'unknown-turn',
        turnUserOrdinal: 1,
        canonicalIndex: 2,
      },
      {
        kind: 'assistant',
        text: 'A2',
        entryId: 'unknown-a2',
        turnId: 'unknown-turn',
        canonicalIndex: 3,
      },
    ],
    1,
    {
      replaceLoadedWindow: true,
      authoritativeNewest: true,
      conversationStatus: 'resolved',
      sourceRevision: 'unknown-source',
      settledRuntimeRuns: [{ runtimeId: 'unknown-runtime', runId: 'unknown-run', generation: 1 }],
    },
  );
  assert.deepEqual(renderedTranscript(sid), ['Q2', 'A2']);
  store.appendEvent({
    kind: 'mid_turn_user_prompt',
    sessionId: sid,
    content: 'Q1',
    entryId: 'unknown-q1',
    queueId: 'unknown-input1',
    turnId: 'unknown-turn',
    turnUserOrdinal: 0,
    runtimeEvent: origin(1),
  });
  store.appendEvent({
    kind: 'text_delta',
    sessionId: sid,
    text: 'A1',
    turnId: 'unknown-turn',
    runtimeEvent: origin(2),
  });
  assert.deepEqual(renderedTranscript(sid), ['Q1', 'A1', 'Q2', 'A2']);
});

test('a later observed journal sequence does not prove a missing delivery was applied', () => {
  const sid = 'unknown-live-delivery';
  registerSession(sid);
  const store = useAppStore.getState();
  const origin = (seq: number) => ({
    runtimeId: 'late-runtime',
    runId: 'late-run',
    journalEpoch: 'late-epoch',
    seq,
  });
  store.appendEvent({
    kind: 'mid_turn_user_prompt',
    sessionId: sid,
    content: 'Q2',
    entryId: 'late-q2',
    queueId: 'late-input2',
    turnId: 'late-turn',
    turnUserOrdinal: 1,
    runtimeEvent: origin(3),
  });
  store.appendEvent({
    kind: 'text_delta',
    sessionId: sid,
    text: 'A2',
    turnId: 'late-turn',
    runtimeEvent: origin(4),
  });
  store.appendEvent({
    kind: 'mid_turn_user_prompt',
    sessionId: sid,
    content: 'Q1',
    entryId: 'late-q1',
    queueId: 'late-input1',
    turnId: 'late-turn',
    turnUserOrdinal: 0,
    runtimeEvent: origin(1),
  });
  store.appendEvent({
    kind: 'text_delta',
    sessionId: sid,
    text: 'A1',
    turnId: 'late-turn',
    runtimeEvent: origin(2),
  });
  assert.equal(renderedTranscript(sid).filter((text) => text === 'Q1').length, 1);
  assert.ok(renderedTranscript(sid).some((text) => text.includes('A1')));
});

test('expired retirement evidence fails open instead of becoming a journal-wide deletion rule', () => {
  const sid = 'bounded-retirement-receipts';
  registerSession(sid);
  const store = useAppStore.getState();
  const boundary = (index: number) => ({
    kind: 'mid_turn_user_prompt' as const,
    sessionId: sid,
    content: `Q${index}`,
    entryId: `q-${index}`,
    queueId: `input-${index}`,
    turnId: `turn-${index}`,
    turnUserOrdinal: 0,
    runtimeEvent: {
      runtimeId: 'bounded-runtime',
      journalEpoch: 'bounded-epoch',
      runId: `run-${index}`,
      seq: index * 5 + 1,
    },
  });
  for (let index = 0; index < 80; index++) {
    const delivery = boundary(index);
    store.appendEvent(delivery);
    const owner = useAppStore
      .getState()
      .userMessagesBySession[sid]!.find((user) => user.entryId === delivery.entryId)!;
    store.bindUserMessageRuntimeRun(sid, owner.id, delivery.runtimeEvent.runId);
    store.appendEvent({
      kind: 'text_delta',
      sessionId: sid,
      turnId: delivery.turnId,
      text: `A${index}`,
      runtimeEvent: { ...delivery.runtimeEvent, seq: index * 5 + 2 },
    });
    store.appendEvent({
      kind: 'session_complete',
      sessionId: sid,
      turnId: delivery.turnId,
      runtimeEvent: { ...delivery.runtimeEvent, seq: index * 5 + 3 },
    });
    store.prependSessionHistory(sid, canonicalTurn(index), 1, {
      replaceLoadedWindow: true,
      authoritativeNewest: true,
      conversationStatus: 'resolved',
      sourceRevision: `bounded-${index}`,
      settledRuntimeRuns: [
        { runtimeId: 'bounded-runtime', runId: delivery.runtimeEvent.runId, generation: 1 },
      ],
    });
    assert.deepEqual(renderedTranscript(sid), [`Q${index}`, `A${index}`]);
  }
  store.evictRestoredSessionHistory(sid);
  store.appendEvent(boundary(79));
  assert.deepEqual(
    renderedTranscript(sid),
    [],
    'recent exact proof still rejects the covered replay',
  );
  store.appendEvent(boundary(0));
  assert.deepEqual(
    renderedTranscript(sid),
    ['Q0'],
    'expired proof cannot justify deleting an input',
  );
});

test('overlapping newest pages stay bounded while exposing the canonical revision and cursor', () => {
  const sid = 'bounded-canonical-pages';
  const store = useAppStore.getState();
  store.resetSessionMessages(sid);
  useAppStore.setState({
    sessions: [
      {
        sessionId: sid,
        projectRoot: '/repro',
        provider: 'mock',
        reasoningMode: 'auto',
        permissionMode: 'accept-edits',
        agentMode: 'ama',
        surface: 'code',
        createdAt: 1,
        lastActivityAt: 1,
      },
    ],
  });
  for (let newest = 4; newest <= 200; newest++) {
    const items: SessionHistoryItem[] = [];
    for (let ordinal = newest - 3; ordinal <= newest; ordinal++) {
      items.push(
        {
          kind: 'user',
          content: `Q${ordinal}`,
          entryId: `q-${ordinal}`,
          canonicalIndex: ordinal * 2,
          turnId: `turn-${ordinal}`,
          turnUserOrdinal: 0,
        },
        {
          kind: 'assistant',
          text: `A${ordinal}`,
          entryId: `a-${ordinal}`,
          canonicalIndex: ordinal * 2 + 1,
          turnId: `turn-${ordinal}`,
        },
      );
    }
    store.prependSessionHistory(sid, items, 1, {
      replaceLoadedWindow: true,
      authoritativeNewest: true,
      revision: `revision-${newest}`,
      sourceRevision: `source-${newest}`,
      cursor: `cursor-${newest}`,
    });
    const page = sessionCanonicalTranscriptPage(sid)!;
    assert.equal(page.userMessages.length, 4);
    assert.equal(page.revision, `revision-${newest}`);
    assert.equal(page.cursor, `cursor-${newest}`);
    assert.equal(page.userMessages[0]?.content, `Q${newest - 3}`);
  }
  store.evictRestoredSessionHistory(sid);
  assert.equal(sessionCanonicalTranscriptPage(sid), undefined);
  assert.equal(useAppStore.getState().eventsBySession[sid]?.length, 0);
});
