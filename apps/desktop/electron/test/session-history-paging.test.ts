import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { useAppStore } from '../../renderer/src/store/appStore.js';
import { composeMessages } from '../../renderer/src/features/session/composeMessages.js';
import { messageForSelectorTurn } from '../../renderer/src/features/session/turnIndex.js';
import { runtimeTerminalEvidenceCandidates } from '../../renderer/src/store/runtimeProjectionState.js';
import {
  activateSessionHistoryPaging,
  deactivateSessionHistoryPaging,
  hasReadySessionHistory,
  historyPhaseAllowsRuntimeObservation,
  invalidateSessionHistoryPaging,
  loadOlderSessionHistory,
  olderHistoryWindowSeamScrollTop,
  PREPEND_ANCHOR_CORRECTION_FRAME_OFFSETS,
  preservesPrependAnchorForBoundaryInput,
  reconcileTerminalSessionHistory,
  refreshDeferredSessionHistory,
  revalidateNewestSessionHistory,
  resetSessionHistoryPagingLifecycle,
  restoreNewestSessionHistory,
  sessionEventInvalidatesHistoryCache,
  sessionHistoryPagingSnapshot,
  wakeWaitingSessionHistory,
} from '../../renderer/src/shell/sessionHistoryPaging.js';

test('terminal history dedupes same-Run profile/snapshot repeats but admits another Run at the same cursor', async () => {
  const sessionId = 'history-paging-terminal-evidence';
  useAppStore.setState({
    sessions: [
      {
        sessionId,
        projectRoot: '/project',
        provider: 'mock',
        reasoningMode: 'auto',
        permissionMode: 'accept-edits',
        agentMode: 'ama',
        surface: 'code',
        createdAt: 1_000,
        lastActivityAt: 1_000,
      },
    ],
    currentSessionId: sessionId,
    eventsBySession: {},
    userMessagesBySession: {},
  });
  let calls = 0;
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    writable: true,
    value: {
      kodaxSpace: {
        invoke: mockHistoryInvoke(async () => {
          calls += 1;
          return {
            ok: true as const,
            data: {
              items: [
                { kind: 'user' as const, content: 'query', canonicalIndex: 0 },
                {
                  kind: 'assistant' as const,
                  text: calls === 1 ? 'answer missing its tail' : 'complete answer tail',
                  canonicalIndex: 1,
                },
              ],
              page: {
                outcome: 'ready' as const,
                revision: `revision-${calls}`,
                sourceRevision: `source-${calls}`,
                hasMore: false,
                windowMode: 'replace' as const,
                hasNewer: false,
              },
            },
          };
        }),
      },
    },
  });

  await restoreNewestSessionHistory(sessionId, 'code');
  const connection = {
    state: 'ready' as const,
    changedAt: 1,
    stale: false,
    runtimeId: 'rt_1',
    capabilities: [],
  };
  const terminalRun = {
    runId: 'run_terminal',
    sessionId,
    phase: 'completed' as const,
    completedAt: 2,
  };
  const profileEvidence = runtimeTerminalEvidenceCandidates(
    {
      connection,
      profile: {
        connection,
        projectionRevision: 1,
        cursor: { runtimeId: 'rt_1', seq: 5 },
        sessions: [
          {
            sessionId,
            surface: 'code',
            createdAt: 1,
            lastActivityAt: 2,
            queuedRuns: [],
            lastTerminalRun: terminalRun,
          },
        ],
        interactions: [],
        notifications: [],
      },
      liveBySession: {},
    },
    sessionId,
  )[0];
  assert.notEqual(profileEvidence, undefined);
  await reconcileTerminalSessionHistory(profileEvidence!);

  const snapshotEvidence = runtimeTerminalEvidenceCandidates(
    {
      connection,
      profile: null,
      liveBySession: {
        [sessionId]: {
          sessionId,
          projectionRevision: 2,
          cursor: { runtimeId: 'rt_1', seq: 6 },
          transcriptRevision: 'terminal-transcript',
          queuedRuns: [],
          activeTools: [],
          todos: [],
          queuedInputs: [],
          interactions: [],
          lastTerminalRun: terminalRun,
        },
      },
    },
    sessionId,
  )[0];
  assert.notEqual(snapshotEvidence, undefined);
  await reconcileTerminalSessionHistory(snapshotEvidence!);
  await reconcileTerminalSessionHistory({
    ...snapshotEvidence!,
    runId: 'run_next_terminal',
  });
  await reconcileTerminalSessionHistory({
    ...snapshotEvidence!,
    runId: 'run_next_terminal',
  });

  assert.equal(calls, 3);
  assert.deepEqual(
    composeMessages({
      userMessages: useAppStore.getState().userMessagesBySession[sessionId] ?? [],
      events: useAppStore.getState().eventsBySession[sessionId] ?? [],
    })
      .filter((message) => message.kind === 'assistant_text')
      .map((message) => message.text),
    ['complete answer tail'],
  );
});

test('terminal evidence before first history is satisfied by that first post-terminal read', async () => {
  const sessionId = 'history-paging-terminal-before-history';
  useAppStore.setState({
    sessions: [
      {
        sessionId,
        projectRoot: '/project',
        provider: 'mock',
        reasoningMode: 'auto',
        permissionMode: 'accept-edits',
        agentMode: 'ama',
        surface: 'code',
        createdAt: 1_000,
        lastActivityAt: 1_000,
      },
    ],
    currentSessionId: sessionId,
    eventsBySession: {},
    userMessagesBySession: {},
  });
  let calls = 0;
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    writable: true,
    value: {
      kodaxSpace: {
        invoke: mockHistoryInvoke(async () => {
          calls += 1;
          return {
            ok: true as const,
            data: {
              items: [
                {
                  kind: 'assistant' as const,
                  text: 'complete post-terminal answer',
                  canonicalIndex: 1,
                },
              ],
              page: {
                outcome: 'ready' as const,
                revision: 'revision-terminal',
                sourceRevision: 'source-terminal',
                hasMore: false,
                windowMode: 'replace' as const,
                hasNewer: false,
              },
            },
          };
        }),
      },
    },
  });

  const terminalEvidence = {
    sessionId,
    runtimeId: 'rt_1',
    runId: 'run_terminal',
    phase: 'completed' as const,
    cursorSeq: 9,
    transcriptRevision: 'transcript-terminal',
  };
  await reconcileTerminalSessionHistory(terminalEvidence);
  assert.equal(calls, 0);
  await restoreNewestSessionHistory(sessionId, 'code');
  await reconcileTerminalSessionHistory(terminalEvidence);

  assert.equal(calls, 1, 'the initial post-terminal history read also satisfies reconciliation');
  assert.equal(sessionHistoryPagingSnapshot(sessionId).revision, 'revision-terminal');
  assert.equal(
    composeMessages({
      userMessages: useAppStore.getState().userMessagesBySession[sessionId] ?? [],
      events: useAppStore.getState().eventsBySession[sessionId] ?? [],
    }).find((message) => message.kind === 'assistant_text')?.text,
    'complete post-terminal answer',
  );
});

test('post-terminal paging certifies canonical order for parallel tool projections', async () => {
  const sessionId = 'history-paging-certified-parallel-tools';
  const runtimeId = 'runtime-history-paging-parallel';
  const runId = 'run-history-paging-parallel';
  const turnId = 'turn-history-paging-parallel';
  useAppStore.setState({
    sessions: [
      {
        sessionId,
        projectRoot: '/project',
        provider: 'mock',
        reasoningMode: 'auto',
        permissionMode: 'accept-edits',
        agentMode: 'ama',
        surface: 'code',
        createdAt: 1_000,
        lastActivityAt: 1_000,
      },
    ],
    currentSessionId: sessionId,
    eventsBySession: {},
    userMessagesBySession: {},
  });
  const store = useAppStore.getState();
  const messageId = store.appendUserMessage(sessionId, 'run both checks', 1_000);
  assert.ok(messageId);
  store.bindUserMessageRuntimeRun(sessionId, messageId, runId);
  const runtimeEvent = (seq: number) => ({ runtimeId, runId, journalEpoch: 'epoch-1', seq });
  for (const event of [
    {
      kind: 'session_start' as const,
      provider: 'mock',
      turnId,
      runtimeEvent: runtimeEvent(1),
    },
    {
      kind: 'output_segment_started' as const,
      responseId: 'response-parallel',
      providerRequestId: 'provider-parallel',
      mode: 'append' as const,
      turnId,
      runtimeEvent: runtimeEvent(2),
    },
    {
      kind: 'tool_start' as const,
      toolId: 'tool-b',
      toolName: 'tool-b',
      turnId,
      runtimeEvent: runtimeEvent(3),
    },
    {
      kind: 'tool_start' as const,
      toolId: 'tool-a',
      toolName: 'tool-a',
      turnId,
      runtimeEvent: runtimeEvent(4),
    },
    {
      kind: 'tool_result' as const,
      toolId: 'tool-a',
      toolName: 'tool-a',
      content: 'result-a',
      turnId,
      runtimeEvent: runtimeEvent(5),
    },
    {
      kind: 'tool_result' as const,
      toolId: 'tool-b',
      toolName: 'tool-b',
      content: 'result-b',
      turnId,
      runtimeEvent: runtimeEvent(6),
    },
    {
      kind: 'session_complete' as const,
      turnId,
      runtimeEvent: runtimeEvent(7),
    },
  ]) {
    store.appendEvent({ ...event, sessionId });
  }
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    writable: true,
    value: {
      kodaxSpace: {
        invoke: mockHistoryInvoke(async () => ({
          ok: true as const,
          data: {
            items: [
              {
                kind: 'user' as const,
                content: 'run both checks',
                sentAt: 1_000,
                entryId: 'entry-parallel-user',
                canonicalIndex: 0,
                turnId,
                turnUserOrdinal: 0,
              },
              {
                kind: 'tool_call' as const,
                toolId: 'tool-a',
                toolName: 'tool-a',
                result: 'result-a',
                entryId: 'entry-parallel-a',
                canonicalIndex: 1,
                turnId,
              },
              {
                kind: 'tool_call' as const,
                toolId: 'tool-b',
                toolName: 'tool-b',
                result: 'result-b',
                entryId: 'entry-parallel-b',
                canonicalIndex: 2,
                turnId,
              },
            ],
            conversation: { status: 'resolved' as const },
            page: {
              outcome: 'ready' as const,
              revision: 'revision-parallel',
              sourceRevision: 'source-parallel',
              hasMore: false,
              windowMode: 'replace' as const,
              hasNewer: false,
            },
          },
        })),
      },
    },
  });

  await reconcileTerminalSessionHistory({
    sessionId,
    runtimeId,
    runId,
    phase: 'completed',
    cursorSeq: 7,
  });
  await restoreNewestSessionHistory(sessionId, 'code');

  const visible = composeMessages({
    userMessages: useAppStore.getState().userMessagesBySession[sessionId] ?? [],
    events: useAppStore.getState().eventsBySession[sessionId] ?? [],
  });
  assert.deepEqual(
    visible.flatMap((message) => (message.kind === 'user' ? [message.content] : [])),
    ['run both checks'],
  );
  assert.deepEqual(
    visible.flatMap((message) => (message.kind === 'tool_call' ? [message.toolName] : [])),
    ['tool-a', 'tool-b'],
  );
});

test('the exact terminal history scope keeps an omitted owner without canonical proof', async () => {
  const sessionId = 'history-paging-terminal-prunes-never-folded';
  useAppStore.setState({
    sessions: [
      {
        sessionId,
        projectRoot: '/project',
        provider: 'mock',
        reasoningMode: 'auto',
        permissionMode: 'accept-edits',
        agentMode: 'ama',
        surface: 'code',
        createdAt: 1_000,
        lastActivityAt: 1_000,
      },
    ],
    currentSessionId: sessionId,
    eventsBySession: {},
    userMessagesBySession: {},
  });
  const store = useAppStore.getState();
  const messageId = store.appendUserMessage(sessionId, 'old live query', 1_100);
  assert.ok(messageId);
  store.bindUserMessageRuntimeRun(sessionId, messageId, 'run_terminal_prune');
  store.appendEvent({
    kind: 'session_start',
    sessionId,
    provider: 'mock',
    turnId: 'turn-terminal-prune',
    runtimeEvent: { runtimeId: 'rt_terminal_prune', runId: 'run_terminal_prune', seq: 1 },
  });
  store.appendEvent({
    kind: 'text_delta',
    sessionId,
    text: 'old live answer',
    turnId: 'turn-terminal-prune',
    runtimeEvent: { runtimeId: 'rt_terminal_prune', runId: 'run_terminal_prune', seq: 2 },
  });
  store.appendEvent({
    kind: 'session_complete',
    sessionId,
    turnId: 'turn-terminal-prune',
    runtimeEvent: { runtimeId: 'rt_terminal_prune', runId: 'run_terminal_prune', seq: 3 },
  });
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    writable: true,
    value: {
      kodaxSpace: {
        invoke: mockHistoryInvoke(async () => ({
          ok: true as const,
          data: {
            items: [
              { kind: 'history_truncation' as const, scope: 'history' as const, omittedItems: 105 },
              {
                kind: 'user' as const,
                content: 'current canonical query',
                sentAt: 2_000,
                canonicalIndex: 105,
              },
              {
                kind: 'assistant' as const,
                text: 'current canonical answer',
                sentAt: 2_100,
                canonicalIndex: 106,
              },
            ],
            conversation: { status: 'resolved' as const },
            page: {
              outcome: 'ready' as const,
              revision: 'revision-terminal-prune',
              sourceRevision: 'source-terminal-prune',
              hasMore: false,
              windowMode: 'replace' as const,
              hasNewer: false,
            },
          },
        })),
      },
    },
  });

  const terminal = {
    sessionId,
    runtimeId: 'rt_terminal_prune',
    runId: 'run_terminal_prune',
    phase: 'completed' as const,
    cursorSeq: 3,
  };
  await reconcileTerminalSessionHistory(terminal);
  await restoreNewestSessionHistory(sessionId, 'code');

  assert.deepEqual(
    new Set(
      composeMessages({
        userMessages: useAppStore.getState().userMessagesBySession[sessionId] ?? [],
        events: useAppStore.getState().eventsBySession[sessionId] ?? [],
      }).flatMap((message) => {
        if (message.kind === 'user') return [`user:${message.content}`];
        if (message.kind === 'assistant_text') return [`assistant:${message.text}`];
        return [];
      }),
    ),
    new Set([
      'user:current canonical query',
      'assistant:current canonical answer',
      'user:old live query',
      'assistant:old live answer',
    ]),
  );
});

test('an unresolved terminal history page cannot prune an omitted live owner', async () => {
  const sessionId = 'history-paging-partial-terminal-keeps-live';
  useAppStore.setState({
    sessions: [
      {
        sessionId,
        projectRoot: '/project',
        provider: 'mock',
        reasoningMode: 'auto',
        permissionMode: 'accept-edits',
        agentMode: 'ama',
        surface: 'code',
        createdAt: 1_000,
        lastActivityAt: 1_000,
      },
    ],
    currentSessionId: sessionId,
    eventsBySession: {},
    userMessagesBySession: {},
  });
  const store = useAppStore.getState();
  const messageId = store.appendUserMessage(sessionId, 'ambiguous live query', 1_100);
  assert.ok(messageId);
  store.bindUserMessageRuntimeRun(sessionId, messageId, 'run_partial_terminal');
  for (const event of [
    {
      kind: 'session_start' as const,
      provider: 'mock',
      turnId: 'turn-partial-terminal',
      runtimeEvent: { runtimeId: 'rt_partial_terminal', runId: 'run_partial_terminal', seq: 1 },
    },
    {
      kind: 'text_delta' as const,
      text: 'ambiguous live answer',
      turnId: 'turn-partial-terminal',
      runtimeEvent: { runtimeId: 'rt_partial_terminal', runId: 'run_partial_terminal', seq: 2 },
    },
    {
      kind: 'session_complete' as const,
      turnId: 'turn-partial-terminal',
      runtimeEvent: { runtimeId: 'rt_partial_terminal', runId: 'run_partial_terminal', seq: 3 },
    },
  ]) {
    store.appendEvent({ ...event, sessionId });
  }
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    writable: true,
    value: {
      kodaxSpace: {
        invoke: mockHistoryInvoke(async () => ({
          ok: true as const,
          data: {
            items: [
              { kind: 'history_truncation' as const, scope: 'history' as const, omittedItems: 105 },
              { kind: 'user' as const, content: 'uncertain canonical tail', canonicalIndex: 105 },
            ],
            conversation: { status: 'partial' as const },
            page: {
              outcome: 'ready' as const,
              revision: 'revision-partial-terminal',
              sourceRevision: 'source-partial-terminal',
              hasMore: false,
              windowMode: 'replace' as const,
              hasNewer: false,
            },
          },
        })),
      },
    },
  });

  await reconcileTerminalSessionHistory({
    sessionId,
    runtimeId: 'rt_partial_terminal',
    runId: 'run_partial_terminal',
    phase: 'completed',
    cursorSeq: 3,
  });
  await restoreNewestSessionHistory(sessionId, 'code');

  assert.equal(
    useAppStore
      .getState()
      .userMessagesBySession[sessionId]?.some(
        (message) => message.content === 'ambiguous live query',
      ),
    true,
  );
});

test('terminal evidence overtaking an in-flight newest read restarts from newest once', async () => {
  const sessionId = 'history-paging-terminal-overtakes-read';
  useAppStore.setState({
    sessions: [
      {
        sessionId,
        projectRoot: '/project',
        provider: 'mock',
        reasoningMode: 'auto',
        permissionMode: 'accept-edits',
        agentMode: 'ama',
        surface: 'code',
        createdAt: 1_000,
        lastActivityAt: 1_000,
      },
    ],
    currentSessionId: sessionId,
    eventsBySession: {},
    userMessagesBySession: {},
  });
  let calls = 0;
  let resolveStale!: (value: {
    readonly ok: true;
    readonly data: Readonly<Record<string, unknown>>;
  }) => void;
  const stale = new Promise<Parameters<typeof resolveStale>[0]>((resolve) => {
    resolveStale = resolve;
  });
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    writable: true,
    value: {
      kodaxSpace: {
        invoke: mockHistoryInvoke(async () => {
          calls += 1;
          if (calls === 1) return stale;
          return {
            ok: true as const,
            data: {
              items: [{ kind: 'assistant' as const, text: 'terminal tail', canonicalIndex: 1 }],
              page: {
                outcome: 'ready' as const,
                revision: 'revision-terminal',
                sourceRevision: 'source-terminal',
                hasMore: false,
                windowMode: 'replace' as const,
                hasNewer: false,
              },
            },
          };
        }),
      },
    },
  });

  const initial = restoreNewestSessionHistory(sessionId, 'code');
  const reconciliation = reconcileTerminalSessionHistory({
    sessionId,
    runtimeId: 'rt_1',
    runId: 'run_terminal',
    phase: 'completed',
    cursorSeq: 9,
  });
  resolveStale({
    ok: true,
    data: {
      items: [{ kind: 'assistant', text: 'stale tail', canonicalIndex: 1 }],
      page: {
        outcome: 'ready',
        revision: 'revision-stale',
        sourceRevision: 'source-stale',
        hasMore: false,
        windowMode: 'replace',
        hasNewer: false,
      },
    },
  });
  await Promise.all([initial, reconciliation]);
  const deadline = Date.now() + 2_000;
  while (calls < 2 && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  assert.equal(calls, 2);
  assert.equal(sessionHistoryPagingSnapshot(sessionId).revision, 'revision-terminal');
});

test('a history request settles only terminal evidence present when that request started', async () => {
  const sessionId = 'history-paging-terminal-request-scope';
  useAppStore.setState({
    sessions: [
      {
        sessionId,
        projectRoot: '/project',
        provider: 'mock',
        reasoningMode: 'auto',
        permissionMode: 'accept-edits',
        agentMode: 'ama',
        surface: 'code',
        createdAt: 1_000,
        lastActivityAt: 1_000,
      },
    ],
    currentSessionId: sessionId,
    eventsBySession: {},
    userMessagesBySession: {},
  });
  let calls = 0;
  let resolveRunARead!: (value: {
    readonly ok: true;
    readonly data: Readonly<Record<string, unknown>>;
  }) => void;
  const runARead = new Promise<Parameters<typeof resolveRunARead>[0]>((resolve) => {
    resolveRunARead = resolve;
  });
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    writable: true,
    value: {
      kodaxSpace: {
        invoke: mockHistoryInvoke(async () => {
          calls += 1;
          if (calls === 1) {
            return {
              ok: true as const,
              data: {
                items: [{ kind: 'assistant' as const, text: 'baseline', canonicalIndex: 1 }],
                page: {
                  outcome: 'ready' as const,
                  revision: 'revision-0',
                  sourceRevision: 'source-0',
                  hasMore: false,
                  windowMode: 'replace' as const,
                  hasNewer: false,
                },
              },
            };
          }
          if (calls === 2) return runARead;
          return {
            ok: true as const,
            data: {
              items: [
                {
                  kind: 'assistant' as const,
                  text: 'both terminal runs persisted',
                  canonicalIndex: 1,
                },
              ],
              page: {
                outcome: 'ready' as const,
                revision: 'revision-2',
                sourceRevision: 'source-2',
                hasMore: false,
                windowMode: 'replace' as const,
                hasNewer: false,
              },
            },
          };
        }),
      },
    },
  });

  await restoreNewestSessionHistory(sessionId, 'code');
  const runAReconciliation = reconcileTerminalSessionHistory({
    sessionId,
    runtimeId: 'rt_1',
    runId: 'run_a',
    phase: 'completed',
    cursorSeq: 10,
  });
  const deadline = Date.now() + 2_000;
  while (calls < 2 && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.equal(calls, 2);
  const runBReconciliation = reconcileTerminalSessionHistory({
    sessionId,
    runtimeId: 'rt_1',
    runId: 'run_b',
    phase: 'completed',
    cursorSeq: 11,
    transcriptRevision: 'transcript-2',
  });
  resolveRunARead({
    ok: true,
    data: {
      items: [{ kind: 'assistant', text: 'only run A persisted', canonicalIndex: 1 }],
      page: {
        outcome: 'ready',
        revision: 'revision-1',
        sourceRevision: 'source-1',
        hasMore: false,
        windowMode: 'replace',
        hasNewer: false,
      },
    },
  });
  await Promise.all([runAReconciliation, runBReconciliation]);
  const retryDeadline = Date.now() + 2_000;
  while (calls < 3 && Date.now() < retryDeadline) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  assert.equal(calls, 3);
  assert.equal(sessionHistoryPagingSnapshot(sessionId).revision, 'revision-2');
  assert.equal(
    composeMessages({
      userMessages: useAppStore.getState().userMessagesBySession[sessionId] ?? [],
      events: useAppStore.getState().eventsBySession[sessionId] ?? [],
    }).find((message) => message.kind === 'assistant_text')?.text,
    'both terminal runs persisted',
  );
  await reconcileTerminalSessionHistory({
    sessionId,
    runtimeId: 'rt_1',
    runId: 'run_b',
    phase: 'completed',
    cursorSeq: 12,
    transcriptRevision: 'transcript-2',
  });
  await new Promise((resolve) => setTimeout(resolve, 150));
  assert.equal(calls, 3, 'repeat evidence cannot trigger another read');
});

test('a failed terminal newest-history read retries automatically and completes exactly once', async () => {
  const sessionId = 'history-paging-terminal-auto-retry';
  useAppStore.setState({
    sessions: [
      {
        sessionId,
        projectRoot: '/project',
        provider: 'mock',
        reasoningMode: 'auto',
        permissionMode: 'accept-edits',
        agentMode: 'ama',
        surface: 'code',
        createdAt: 1_000,
        lastActivityAt: 1_000,
      },
    ],
    currentSessionId: sessionId,
    eventsBySession: {},
    userMessagesBySession: {},
  });
  let calls = 0;
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    writable: true,
    value: {
      kodaxSpace: {
        invoke: mockHistoryInvoke(async () => {
          calls += 1;
          if (calls === 2) throw new Error('transient terminal history failure');
          return {
            ok: true as const,
            data: {
              items: [
                {
                  kind: 'assistant' as const,
                  text: calls === 1 ? 'answer missing tail' : 'complete terminal answer',
                  canonicalIndex: 1,
                },
              ],
              page: {
                outcome: 'ready' as const,
                revision: `revision-${calls}`,
                sourceRevision: `source-${calls}`,
                hasMore: false,
                windowMode: 'replace' as const,
                hasNewer: false,
              },
            },
          };
        }),
      },
    },
  });

  await restoreNewestSessionHistory(sessionId, 'code');
  await assert.rejects(
    reconcileTerminalSessionHistory({
      sessionId,
      runtimeId: 'rt_1',
      runId: 'run_terminal',
      phase: 'completed',
      cursorSeq: 9,
    }),
    /transient terminal history failure/,
  );
  const deadline = Date.now() + 2_000;
  while (calls < 3 && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  assert.equal(calls, 3);
  assert.equal(sessionHistoryPagingSnapshot(sessionId).revision, 'revision-3');
  assert.equal(
    composeMessages({
      userMessages: useAppStore.getState().userMessagesBySession[sessionId] ?? [],
      events: useAppStore.getState().eventsBySession[sessionId] ?? [],
    }).find((message) => message.kind === 'assistant_text')?.text,
    'complete terminal answer',
  );

  await reconcileTerminalSessionHistory({
    sessionId,
    runtimeId: 'rt_1',
    runId: 'run_terminal',
    phase: 'completed',
    cursorSeq: 9,
  });
  await new Promise((resolve) => setTimeout(resolve, 150));
  assert.equal(calls, 3, 'duplicate terminal evidence must not schedule another canonical read');
});

test('snapshot-first terminal evidence is not repeated when the profile arrives later', async () => {
  const sessionId = 'history-paging-terminal-snapshot-first';
  useAppStore.setState({
    sessions: [
      {
        sessionId,
        projectRoot: '/project',
        provider: 'mock',
        reasoningMode: 'auto',
        permissionMode: 'accept-edits',
        agentMode: 'ama',
        surface: 'code',
        createdAt: 1_000,
        lastActivityAt: 1_000,
      },
    ],
    currentSessionId: sessionId,
    eventsBySession: {},
    userMessagesBySession: {},
  });
  let calls = 0;
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    writable: true,
    value: {
      kodaxSpace: {
        invoke: mockHistoryInvoke(async () => {
          calls += 1;
          return {
            ok: true as const,
            data: {
              items: [
                {
                  kind: 'assistant' as const,
                  text: calls === 1 ? 'answer missing tail' : 'complete answer tail',
                  canonicalIndex: 1,
                },
              ],
              page: {
                outcome: 'ready' as const,
                revision: calls === 1 ? 'revision-old' : 'revision-terminal',
                sourceRevision: calls === 1 ? 'source-old' : 'source-terminal',
                hasMore: false,
                windowMode: 'replace' as const,
                hasNewer: false,
              },
            },
          };
        }),
      },
    },
  });

  await restoreNewestSessionHistory(sessionId, 'code');
  await reconcileTerminalSessionHistory({
    sessionId,
    runtimeId: 'rt_1',
    runId: 'run_terminal',
    phase: 'completed',
    cursorSeq: 9,
    transcriptRevision: 'transcript-terminal',
  });
  assert.equal(calls, 2);
  assert.equal(sessionHistoryPagingSnapshot(sessionId).revision, 'revision-terminal');
  await reconcileTerminalSessionHistory({
    sessionId,
    runtimeId: 'rt_1',
    runId: 'run_terminal',
    phase: 'completed',
    cursorSeq: 10,
  });
  await new Promise((resolve) => setTimeout(resolve, 150));
  assert.equal(calls, 2);
  assert.equal(sessionHistoryPagingSnapshot(sessionId).revision, 'revision-terminal');
  assert.equal(
    composeMessages({
      userMessages: useAppStore.getState().userMessagesBySession[sessionId] ?? [],
      events: useAppStore.getState().eventsBySession[sessionId] ?? [],
    }).find((message) => message.kind === 'assistant_text')?.text,
    'complete answer tail',
  );
});

test('a terminal Run with no new conversation rows performs one authoritative history read', async () => {
  const sessionId = 'history-paging-terminal-unchanged';
  useAppStore.setState({
    sessions: [
      {
        sessionId,
        projectRoot: '/project',
        provider: 'mock',
        reasoningMode: 'auto',
        permissionMode: 'accept-edits',
        agentMode: 'ama',
        surface: 'code',
        createdAt: 1_000,
        lastActivityAt: 1_000,
      },
    ],
    currentSessionId: sessionId,
    eventsBySession: {},
    userMessagesBySession: {},
  });
  let calls = 0;
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    writable: true,
    value: {
      kodaxSpace: {
        invoke: mockHistoryInvoke(async () => {
          calls += 1;
          return {
            ok: true as const,
            data: {
              items: [
                {
                  kind: 'assistant' as const,
                  text: 'unchanged canonical answer',
                  canonicalIndex: 1,
                },
              ],
              page: {
                outcome: 'ready' as const,
                revision: 'revision-shared',
                sourceRevision: 'source-shared',
                hasMore: false,
                windowMode: 'replace' as const,
                hasNewer: false,
              },
            },
          };
        }),
      },
    },
  });

  await restoreNewestSessionHistory(sessionId, 'code');
  await reconcileTerminalSessionHistory({
    sessionId,
    runtimeId: 'rt_1',
    runId: 'run_terminal',
    phase: 'completed',
    cursorSeq: 9,
  });
  assert.equal(calls, 2);
  await new Promise((resolve) => setTimeout(resolve, 450));
  assert.equal(calls, 2, 'unchanged terminal history must not start a polling loop');
  assert.equal(sessionHistoryPagingSnapshot(sessionId).revision, 'revision-shared');
  assert.equal(
    composeMessages({
      userMessages: useAppStore.getState().userMessagesBySession[sessionId] ?? [],
      events: useAppStore.getState().eventsBySession[sessionId] ?? [],
    }).find((message) => message.kind === 'assistant_text')?.text,
    'unchanged canonical answer',
  );
});

test('terminal convergence ignores older evidence and preserves an explicit older window', async () => {
  const sessionId = 'history-paging-terminal-older-window';
  useAppStore.setState({
    sessions: [
      {
        sessionId,
        projectRoot: '/project',
        provider: 'mock',
        reasoningMode: 'auto',
        permissionMode: 'accept-edits',
        agentMode: 'ama',
        surface: 'code',
        createdAt: 1_000,
        lastActivityAt: 1_000,
      },
    ],
    currentSessionId: sessionId,
    eventsBySession: {},
    userMessagesBySession: {},
  });
  let calls = 0;
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    writable: true,
    value: {
      kodaxSpace: {
        invoke: mockHistoryInvoke(async () => {
          calls += 1;
          return {
            ok: true as const,
            data: {
              items: [{ kind: 'user' as const, content: 'older row', canonicalIndex: 1 }],
              page: {
                outcome: 'ready' as const,
                revision: 'older-revision',
                sourceRevision: 'older-source',
                hasMore: true,
                nextCursor: 'older-cursor',
                windowMode: 'replace' as const,
                hasNewer: true,
              },
            },
          };
        }),
      },
    },
  });

  await restoreNewestSessionHistory(sessionId, 'code');
  await reconcileTerminalSessionHistory({
    sessionId,
    runtimeId: 'rt_1',
    runId: 'run_newer_terminal',
    phase: 'completed',
    cursorSeq: 20,
  });
  await reconcileTerminalSessionHistory({
    sessionId,
    runtimeId: 'rt_1',
    runId: 'run_old_terminal',
    phase: 'completed',
    cursorSeq: 10,
  });

  assert.equal(calls, 1);
  assert.equal(sessionHistoryPagingSnapshot(sessionId).hasNewer, true);
  assert.equal(sessionHistoryPagingSnapshot(sessionId).revision, 'older-revision');
});

const originalWindow = globalThis.window;

function mockHistoryInvoke<T extends (...args: never[]) => unknown>(handler: T) {
  return async (channel: string, input: unknown) => {
    const invoke = handler as unknown as (...args: readonly unknown[]) => unknown;
    const result = (await invoke(channel, input)) as {
      readonly ok: boolean;
      readonly data?: Readonly<Record<string, unknown>>;
      readonly [key: string]: unknown;
    };
    if (!result.ok || result.data === undefined) return result;
    const owner = input as { readonly sessionId: string; readonly requestId: string };
    return {
      ...result,
      data: {
        ...result.data,
        sessionId: owner.sessionId,
        requestId: owner.requestId,
      },
    };
  };
}

function withoutHistoryRequestId(input: unknown): Readonly<Record<string, unknown>> {
  const owned = input as Readonly<Record<string, unknown>>;
  assert.equal(typeof owned.requestId, 'string');
  const { requestId: _requestId, ...rest } = owned;
  return rest;
}

afterEach(() => {
  for (const sessionId of [
    'history-paging-resync',
    'history-paging-large-turn',
    'history-paging-active-older-page',
    'history-paging-leading-partial',
    'history-paging-runtime-startup',
    'history-paging-deactivate',
    'history-paging-reactivate',
    'history-paging-same-turn',
    'history-paging-live-window',
    'history-paging-uncertain-cache',
    'history-paging-invalidated-cache',
    'history-paging-invalidation-race',
    'history-paging-invalidated-continuation',
    'history-paging-invalidated-active-continuation',
    'history-paging-warning-race',
    'history-paging-active-warning-refresh',
    'history-paging-active-warning-overtaken',
    'history-paging-partial-reactivation-overtaken',
    'history-paging-invalidated-reactivation-overtaken',
    'history-paging-older-warning-window',
    'history-paging-foreign-owner',
    'history-paging-terminal-prunes-never-folded',
    'history-paging-partial-terminal-keeps-live',
  ]) {
    deactivateSessionHistoryPaging(sessionId);
  }
  resetSessionHistoryPagingLifecycle();
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    writable: true,
    value: originalWindow,
  });
});

test('history response with foreign Session/request ownership is rejected before store install', async () => {
  const sessionId = 'history-paging-foreign-owner';
  useAppStore.setState({
    sessions: [
      {
        sessionId,
        projectRoot: '/project',
        provider: 'mock',
        reasoningMode: 'auto',
        permissionMode: 'accept-edits',
        agentMode: 'ama',
        surface: 'code',
        createdAt: 1_000,
        lastActivityAt: 1_000,
      },
    ],
    currentSessionId: sessionId,
    eventsBySession: {},
    userMessagesBySession: {},
  });
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    writable: true,
    value: {
      kodaxSpace: {
        invoke: async () => ({
          ok: true as const,
          data: {
            sessionId: 'foreign-session',
            requestId: 'foreign-request',
            items: [{ kind: 'user' as const, content: 'must never be installed' }],
            page: {
              outcome: 'ready' as const,
              revision: 'foreign-revision',
              sourceRevision: 'foreign-source',
              hasMore: false,
              windowMode: 'replace' as const,
              hasNewer: false,
            },
          },
        }),
      },
    },
  });

  await assert.rejects(
    restoreNewestSessionHistory(sessionId, 'code'),
    /history response ownership mismatch/i,
  );
  assert.equal(sessionHistoryPagingSnapshot(sessionId).phase, 'error');
  assert.deepEqual(useAppStore.getState().userMessagesBySession[sessionId] ?? [], []);
});

test('a hung history IPC times out and releases the observation gate', async (t) => {
  const sessionId = 'history-paging-timeout';
  t.mock.timers.enable({ apis: ['setTimeout'] });
  useAppStore.setState({
    sessions: [
      {
        sessionId,
        projectRoot: '/project',
        provider: 'mock',
        reasoningMode: 'auto',
        permissionMode: 'accept-edits',
        agentMode: 'ama',
        surface: 'code',
        createdAt: 1_000,
        lastActivityAt: 1_000,
      },
    ],
    currentSessionId: sessionId,
    eventsBySession: {},
    userMessagesBySession: {},
  });
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    writable: true,
    value: {
      kodaxSpace: {
        invoke: async () => await new Promise<never>(() => {}),
      },
    },
  });

  let rejection: unknown;
  void restoreNewestSessionHistory(sessionId, 'code').catch((error: unknown) => {
    rejection = error;
  });
  await Promise.resolve();
  t.mock.timers.tick(10_001);
  await new Promise<void>((resolve) => setImmediate(resolve));

  assert.match(rejection instanceof Error ? rejection.message : '', /timed out after 10s/);
  assert.equal(sessionHistoryPagingSnapshot(sessionId).phase, 'error');
});

test('resetSessionView synchronously clears paging authority and the independent live baseline', async () => {
  const sessionId = 'history-paging-project-reset';
  const session = {
    sessionId,
    projectRoot: '/project-a',
    provider: 'mock',
    reasoningMode: 'auto' as const,
    permissionMode: 'accept-edits' as const,
    agentMode: 'ama' as const,
    surface: 'code' as const,
    createdAt: 1_000,
    lastActivityAt: 1_000,
  };
  useAppStore.setState({
    sessions: [session],
    currentSessionId: sessionId,
    eventsBySession: {},
    userMessagesBySession: {},
  });
  let calls = 0;
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    writable: true,
    value: {
      kodaxSpace: {
        invoke: mockHistoryInvoke(async () => {
          calls += 1;
          return {
            ok: true as const,
            data: {
              items: [
                {
                  kind: 'user' as const,
                  content: calls === 1 ? 'project A canonical' : 'project B canonical',
                  canonicalIndex: 0,
                },
              ],
              page: {
                outcome: 'ready' as const,
                revision: `revision-${calls}`,
                sourceRevision: `source-${calls}`,
                hasMore: false as const,
                windowMode: 'replace' as const,
                hasNewer: false as const,
              },
            },
          };
        }),
      },
    },
  });

  await restoreNewestSessionHistory(sessionId, 'code');
  useAppStore.getState().appendUserMessage(sessionId, 'project A live tail', 2_000);
  assert.equal(hasReadySessionHistory(sessionId), true);

  useAppStore.getState().resetSessionView();
  assert.deepEqual(sessionHistoryPagingSnapshot(sessionId), { phase: 'idle', hasMore: false });
  assert.equal(hasReadySessionHistory(sessionId), false);

  useAppStore.setState({
    sessions: [{ ...session, projectRoot: '/project-b' }],
    currentSessionId: sessionId,
  });
  useAppStore.getState().appendUserMessage(sessionId, 'project B live tail', 3_000);
  await restoreNewestSessionHistory(sessionId, 'code');

  assert.equal(calls, 2);
  assert.deepEqual(
    (useAppStore.getState().userMessagesBySession[sessionId] ?? []).map(
      (message) => message.content,
    ),
    ['project B canonical', 'project B live tail'],
  );
});

test('lossless history ids distinguish a former 32-bit collision and preserve large indexes', () => {
  const sessionId = 'history-id-collision';
  useAppStore.setState({
    sessions: [
      {
        sessionId,
        projectRoot: '/project',
        provider: 'mock',
        reasoningMode: 'auto',
        permissionMode: 'accept-edits',
        agentMode: 'ama',
        surface: 'code',
        createdAt: 1_000,
        lastActivityAt: 1_000,
      },
    ],
    currentSessionId: sessionId,
    eventsBySession: {},
    userMessagesBySession: {},
  });

  // FNV-1a-32("canonical:5372657") === FNV-1a-32("canonical:9076142").
  useAppStore.getState().prependSessionHistory(
    sessionId,
    [
      { kind: 'user', content: 'first colliding turn', canonicalIndex: 5_372_657 },
      { kind: 'user', content: 'second colliding turn', canonicalIndex: 9_076_142 },
    ],
    1_000,
    { replaceLoadedWindow: true },
  );

  const users = useAppStore.getState().userMessagesBySession[sessionId] ?? [];
  assert.equal(users.length, 2);
  assert.notEqual(users[0]?.id, users[1]?.id);
  assert.match(users[0]?.id ?? '', /5372657/);
  assert.match(users[1]?.id ?? '', /9076142/);
});

test('ready history revalidates on reactivation without blanking or accepting a stale generation', async () => {
  const sessionId = 'history-paging-ready-revalidation';
  useAppStore.setState({
    sessions: [
      {
        sessionId,
        projectRoot: '/project',
        provider: 'mock',
        reasoningMode: 'auto',
        permissionMode: 'accept-edits',
        agentMode: 'ama',
        surface: 'code',
        createdAt: 1_000,
        lastActivityAt: 1_000,
      },
    ],
    currentSessionId: sessionId,
    eventsBySession: {},
    userMessagesBySession: {},
  });
  type ReadyResponse = {
    ok: true;
    data: {
      items: Array<{ kind: 'user'; content: string; canonicalIndex: number }>;
      page: {
        outcome: 'ready';
        revision: string;
        sourceRevision: string;
        hasMore: false;
        windowMode: 'replace';
        hasNewer: false;
      };
    };
  };
  let resolveStale!: (response: ReadyResponse) => void;
  let resolveFresh!: (response: ReadyResponse) => void;
  const stale = new Promise<ReadyResponse>((resolve) => {
    resolveStale = resolve;
  });
  const fresh = new Promise<ReadyResponse>((resolve) => {
    resolveFresh = resolve;
  });
  let calls = 0;
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    writable: true,
    value: {
      kodaxSpace: {
        invoke: mockHistoryInvoke(async () => {
          calls += 1;
          if (calls === 1) {
            return {
              ok: true as const,
              data: {
                items: [{ kind: 'user' as const, content: 'cached', canonicalIndex: 0 }],
                page: {
                  outcome: 'ready' as const,
                  revision: 'revision-cached',
                  sourceRevision: 'source-cached',
                  hasMore: false as const,
                  windowMode: 'replace' as const,
                  hasNewer: false as const,
                },
              },
            };
          }
          return calls === 2 ? stale : fresh;
        }),
      },
    },
  });

  await restoreNewestSessionHistory(sessionId, 'code');
  deactivateSessionHistoryPaging(sessionId);
  activateSessionHistoryPaging(sessionId);
  const staleRevalidation = revalidateNewestSessionHistory(sessionId, 'code');
  assert.equal(sessionHistoryPagingSnapshot(sessionId).phase, 'ready');
  assert.equal(useAppStore.getState().userMessagesBySession[sessionId]?.[0]?.content, 'cached');

  deactivateSessionHistoryPaging(sessionId);
  activateSessionHistoryPaging(sessionId);
  const freshRevalidation = revalidateNewestSessionHistory(sessionId, 'code');
  const response = (content: string, revision: string): ReadyResponse => ({
    ok: true,
    data: {
      items: [{ kind: 'user', content, canonicalIndex: 0 }],
      page: {
        outcome: 'ready',
        revision,
        sourceRevision: revision,
        hasMore: false,
        windowMode: 'replace',
        hasNewer: false,
      },
    },
  });
  resolveFresh(response('fresh external mutation', 'revision-fresh'));
  await freshRevalidation;
  resolveStale(response('stale external mutation', 'revision-stale'));
  await staleRevalidation;

  assert.equal(calls, 3);
  assert.equal(sessionHistoryPagingSnapshot(sessionId).sourceRevision, 'revision-fresh');
  assert.equal(
    useAppStore.getState().userMessagesBySession[sessionId]?.[0]?.content,
    'fresh external mutation',
  );
});

test('ready history revalidation does not replace the painted live turn while a run is active', async () => {
  const sessionId = 'history-paging-active-revalidation';
  useAppStore.setState({
    sessions: [
      {
        sessionId,
        projectRoot: '/project',
        provider: 'mock',
        reasoningMode: 'auto',
        permissionMode: 'accept-edits',
        agentMode: 'ama',
        surface: 'code',
        createdAt: 1_000,
        lastActivityAt: 1_000,
      },
    ],
    currentSessionId: sessionId,
    eventsBySession: {},
    userMessagesBySession: {},
    liveProjectionBySession: {},
  });
  type ReadyResponse = {
    ok: true;
    data: {
      items: Array<
        | { kind: 'user'; content: string; canonicalIndex: number; turnId?: string }
        | { kind: 'assistant'; text: string; canonicalIndex: number; turnId?: string }
      >;
      page: {
        outcome: 'ready';
        revision: string;
        sourceRevision: string;
        hasMore: false;
        windowMode: 'replace';
        hasNewer: false;
      };
    };
  };
  let resolveActive!: (response: ReadyResponse) => void;
  const activeResponse = new Promise<ReadyResponse>((resolve) => {
    resolveActive = resolve;
  });
  let calls = 0;
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    writable: true,
    value: {
      kodaxSpace: {
        invoke: mockHistoryInvoke(async () => {
          calls += 1;
          if (calls === 1) {
            return {
              ok: true as const,
              data: {
                items: [
                  { kind: 'user' as const, content: 'earlier query', canonicalIndex: 0 },
                  { kind: 'assistant' as const, text: 'earlier answer', canonicalIndex: 1 },
                ],
                page: {
                  outcome: 'ready' as const,
                  revision: 'revision-cached',
                  sourceRevision: 'source-cached',
                  hasMore: false as const,
                  windowMode: 'replace' as const,
                  hasNewer: false as const,
                },
              },
            };
          }
          if (calls === 2) return activeResponse;
          return {
            ok: true as const,
            data: {
              items: [
                { kind: 'user' as const, content: 'earlier query', canonicalIndex: 0 },
                { kind: 'assistant' as const, text: 'earlier answer', canonicalIndex: 1 },
                {
                  kind: 'user' as const,
                  content: 'active query',
                  canonicalIndex: 2,
                  turnId: 'turn-active',
                },
                {
                  kind: 'assistant' as const,
                  text: 'newer live answer',
                  canonicalIndex: 3,
                  turnId: 'turn-active',
                },
              ],
              page: {
                outcome: 'ready' as const,
                revision: 'revision-terminal',
                sourceRevision: 'source-terminal',
                hasMore: false as const,
                windowMode: 'replace' as const,
                hasNewer: false as const,
              },
            },
          };
        }),
      },
    },
  });

  await restoreNewestSessionHistory(sessionId, 'code');
  useAppStore.getState().appendUserMessage(sessionId, 'active query', 2_000);
  useAppStore.getState().appendEvent({
    kind: 'session_start',
    sessionId,
    provider: 'mock',
    turnId: 'turn-active',
  });
  useAppStore.getState().appendEvent({
    kind: 'text_delta',
    sessionId,
    text: 'newer live answer',
    turnId: 'turn-active',
  });
  const activeProjection = {
    sessionId,
    projectionRevision: 1,
    cursor: { runtimeId: 'runtime-active', seq: 1 },
    transcriptRevision: 'transcript-active',
    queuedRuns: [],
    activeRun: {
      runId: 'run-active',
      sessionId,
      phase: 'running' as const,
      startedAt: 2_000,
    },
    activeTools: [],
    todos: [],
    queuedInputs: [],
    interactions: [],
  };
  useAppStore.setState({ liveProjectionBySession: { [sessionId]: activeProjection } });

  const revalidation = revalidateNewestSessionHistory(sessionId, 'code');
  // Observation invalidation can temporarily remove the live projection even though the
  // session_start + streamed transcript still prove that this turn is open.
  const runtimeConnection = {
    state: 'ready' as const,
    changedAt: 2_000,
    stale: false as const,
    runtimeId: 'runtime-active',
    profile: 'default',
    capabilities: [],
  };
  useAppStore.setState({
    liveProjectionBySession: {},
    runtimeConnection,
    runtimeProfile: {
      connection: runtimeConnection,
      projectionRevision: 2,
      cursor: { runtimeId: 'runtime-active', seq: 2 },
      sessions: [
        {
          sessionId,
          projectRoot: '/project',
          surface: 'code',
          createdAt: 1_000,
          lastActivityAt: 2_000,
          queuedRuns: [],
          activeRun: activeProjection.activeRun,
        },
      ],
      interactions: [],
      notifications: [],
    },
  });
  resolveActive({
    ok: true,
    data: {
      items: [
        { kind: 'user', content: 'earlier query', canonicalIndex: 0 },
        { kind: 'assistant', text: 'earlier answer', canonicalIndex: 1 },
        {
          kind: 'user',
          content: 'active query',
          canonicalIndex: 2,
          turnId: 'turn-active',
        },
        {
          kind: 'assistant',
          text: 'stale in-flight answer',
          canonicalIndex: 3,
          turnId: 'turn-active',
        },
      ],
      page: {
        outcome: 'ready',
        revision: 'revision-active',
        sourceRevision: 'source-active',
        hasMore: false,
        windowMode: 'replace',
        hasNewer: false,
      },
    },
  });
  await revalidation;

  assert.equal(sessionHistoryPagingSnapshot(sessionId).revision, 'revision-cached');
  assert.deepEqual(
    composeMessages({
      userMessages: useAppStore.getState().userMessagesBySession[sessionId] ?? [],
      events: useAppStore.getState().eventsBySession[sessionId] ?? [],
    }).flatMap((message) => {
      if (message.kind === 'user') return [`user:${message.content}`];
      if (message.kind === 'assistant_text') return [`assistant:${message.text}`];
      return [];
    }),
    [
      'user:earlier query',
      'assistant:earlier answer',
      'user:active query',
      'assistant:newer live answer',
    ],
  );

  invalidateSessionHistoryPaging(sessionId);
  useAppStore.getState().appendEvent({
    kind: 'session_complete',
    sessionId,
    turnId: 'turn-active',
    runtimeEvent: { runtimeId: 'runtime-active', runId: 'run-active', seq: 3 },
  });
  await refreshDeferredSessionHistory(sessionId);

  assert.equal(sessionHistoryPagingSnapshot(sessionId).revision, 'revision-terminal');
  assert.deepEqual(
    composeMessages({
      userMessages: useAppStore.getState().userMessagesBySession[sessionId] ?? [],
      events: useAppStore.getState().eventsBySession[sessionId] ?? [],
    }).flatMap((message) => {
      if (message.kind === 'user') return [`user:${message.content}`];
      if (message.kind === 'assistant_text') return [`assistant:${message.text}`];
      return [];
    }),
    [
      'user:earlier query',
      'assistant:earlier answer',
      'user:active query',
      'assistant:newer live answer',
    ],
  );
});

test('a failed deferred terminal refresh remains retryable', async () => {
  const sessionId = 'history-paging-deferred-retry';
  const session = {
    sessionId,
    projectRoot: '/project',
    provider: 'mock',
    reasoningMode: 'auto' as const,
    permissionMode: 'accept-edits' as const,
    agentMode: 'ama' as const,
    surface: 'code' as const,
    createdAt: 1_000,
    lastActivityAt: 1_000,
  };
  useAppStore.setState({
    sessions: [session],
    currentSessionId: sessionId,
    eventsBySession: {},
    userMessagesBySession: {},
    pendingSendBySession: {},
    liveProjectionBySession: {},
  });
  let calls = 0;
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    writable: true,
    value: {
      kodaxSpace: {
        invoke: mockHistoryInvoke(async () => {
          calls += 1;
          if (calls === 3) throw new Error('transient terminal refresh failure');
          return {
            ok: true as const,
            data: {
              items: [
                { kind: 'user' as const, content: 'query', canonicalIndex: 0 },
                {
                  kind: 'assistant' as const,
                  text: calls === 4 ? 'terminal answer' : 'cached answer',
                  canonicalIndex: 1,
                },
              ],
              page: {
                outcome: 'ready' as const,
                revision: calls === 4 ? 'revision-terminal' : `revision-${calls}`,
                sourceRevision: calls === 4 ? 'source-terminal' : `source-${calls}`,
                hasMore: false,
                windowMode: 'replace' as const,
                hasNewer: false,
              },
            },
          };
        }),
      },
    },
  });

  await restoreNewestSessionHistory(sessionId, 'code');
  useAppStore.setState({ pendingSendBySession: { [sessionId]: true } });
  await revalidateNewestSessionHistory(sessionId, 'code');
  useAppStore.setState({ pendingSendBySession: {} });

  await assert.rejects(refreshDeferredSessionHistory(sessionId), /transient terminal refresh/);
  await refreshDeferredSessionHistory(sessionId);

  assert.equal(calls, 4);
  assert.equal(sessionHistoryPagingSnapshot(sessionId).revision, 'revision-terminal');
});

test('a terminal refresh remains deferred when the next run starts before the read returns', async () => {
  const sessionId = 'history-paging-deferred-next-run';
  useAppStore.setState({
    sessions: [
      {
        sessionId,
        projectRoot: '/project',
        provider: 'mock',
        reasoningMode: 'auto',
        permissionMode: 'accept-edits',
        agentMode: 'ama',
        surface: 'code',
        createdAt: 1_000,
        lastActivityAt: 1_000,
      },
    ],
    currentSessionId: sessionId,
    eventsBySession: {},
    userMessagesBySession: {},
    pendingSendBySession: {},
    liveProjectionBySession: {},
    runtimeSnapshotRequiredBySession: {},
  });
  let calls = 0;
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    writable: true,
    value: {
      kodaxSpace: {
        invoke: mockHistoryInvoke(async () => {
          calls += 1;
          if (calls === 3) {
            useAppStore.setState({ pendingSendBySession: { [sessionId]: true } });
          }
          return {
            ok: true as const,
            data: {
              items: [
                { kind: 'user' as const, content: 'query', canonicalIndex: 0 },
                {
                  kind: 'assistant' as const,
                  text: `answer-${calls}`,
                  canonicalIndex: 1,
                },
              ],
              page: {
                outcome: 'ready' as const,
                revision: `revision-${calls}`,
                sourceRevision: `source-${calls}`,
                hasMore: false,
                windowMode: 'replace' as const,
                hasNewer: false,
              },
            },
          };
        }),
      },
    },
  });

  await restoreNewestSessionHistory(sessionId, 'code');
  useAppStore.setState({ pendingSendBySession: { [sessionId]: true } });
  await revalidateNewestSessionHistory(sessionId, 'code');
  useAppStore.setState({ pendingSendBySession: {} });

  await refreshDeferredSessionHistory(sessionId);
  assert.equal(calls, 3);
  assert.equal(sessionHistoryPagingSnapshot(sessionId).revision, 'revision-1');

  useAppStore.setState({ pendingSendBySession: {} });
  await refreshDeferredSessionHistory(sessionId);
  assert.equal(calls, 4, 'the next Run terminal must still find the deferred refresh marker');
  assert.equal(sessionHistoryPagingSnapshot(sessionId).revision, 'revision-4');
});

test('a snapshot-required live projection cannot block canonical history revalidation', async () => {
  const sessionId = 'history-paging-snapshot-required';
  const runtimeConnection = {
    state: 'ready' as const,
    changedAt: 2_000,
    stale: false as const,
    runtimeId: 'runtime-stale',
    profile: 'default',
    capabilities: [],
  };
  useAppStore.setState({
    sessions: [
      {
        sessionId,
        projectRoot: '/project',
        provider: 'mock',
        reasoningMode: 'auto',
        permissionMode: 'accept-edits',
        agentMode: 'ama',
        surface: 'code',
        createdAt: 1_000,
        lastActivityAt: 1_000,
      },
    ],
    currentSessionId: sessionId,
    eventsBySession: {},
    userMessagesBySession: {},
    pendingSendBySession: {},
    runtimeConnection,
    liveProjectionBySession: {},
    runtimeSnapshotRequiredBySession: {},
    runtimeProfile: null,
  });
  let calls = 0;
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    writable: true,
    value: {
      kodaxSpace: {
        invoke: mockHistoryInvoke(async () => {
          calls += 1;
          return {
            ok: true as const,
            data: {
              items: [
                { kind: 'user' as const, content: 'query', canonicalIndex: 0 },
                {
                  kind: 'assistant' as const,
                  text: `answer-${calls}`,
                  canonicalIndex: 1,
                },
              ],
              page: {
                outcome: 'ready' as const,
                revision: `revision-${calls}`,
                sourceRevision: `source-${calls}`,
                hasMore: false,
                windowMode: 'replace' as const,
                hasNewer: false,
              },
            },
          };
        }),
      },
    },
  });

  await restoreNewestSessionHistory(sessionId, 'code');
  useAppStore.getState().appendEvent({
    kind: 'session_start',
    sessionId,
    provider: 'mock',
    runtimeEvent: { runtimeId: 'runtime-stale', runId: 'run-stale', seq: 10 },
  });
  useAppStore.setState({
    runtimeSnapshotRequiredBySession: { [sessionId]: true },
    runtimeProfile: {
      connection: runtimeConnection,
      projectionRevision: 2,
      cursor: { runtimeId: 'runtime-stale', seq: 10 },
      sessions: [
        {
          sessionId,
          projectRoot: '/project',
          surface: 'code',
          createdAt: 1_000,
          lastActivityAt: 2_000,
          queuedRuns: [],
          activeRun: { sessionId, runId: 'run-stale', phase: 'running' },
        },
      ],
      interactions: [],
      notifications: [],
    },
  });
  useAppStore.getState().appendEvent({
    kind: 'session_start',
    sessionId,
    provider: 'mock',
  });

  await revalidateNewestSessionHistory(sessionId, 'code');

  assert.equal(calls, 2);
  assert.equal(sessionHistoryPagingSnapshot(sessionId).revision, 'revision-2');
});

test('a deferred refresh preserves an explicitly older browsing window', async () => {
  const sessionId = 'history-paging-deferred-older-window';
  useAppStore.setState({
    sessions: [
      {
        sessionId,
        projectRoot: '/project',
        provider: 'mock',
        reasoningMode: 'auto',
        permissionMode: 'accept-edits',
        agentMode: 'ama',
        surface: 'code',
        createdAt: 1_000,
        lastActivityAt: 1_000,
      },
    ],
    currentSessionId: sessionId,
    eventsBySession: {},
    userMessagesBySession: {},
    pendingSendBySession: {},
    liveProjectionBySession: {},
  });
  let calls = 0;
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    writable: true,
    value: {
      kodaxSpace: {
        invoke: mockHistoryInvoke(async () => {
          calls += 1;
          return {
            ok: true as const,
            data: {
              items: [{ kind: 'user' as const, content: 'older browsing row', canonicalIndex: 5 }],
              page: {
                outcome: 'ready' as const,
                revision: `revision-${calls}`,
                sourceRevision: `source-${calls}`,
                hasMore: true,
                nextCursor: 'older-cursor',
                windowMode: 'replace' as const,
                hasNewer: true,
              },
            },
          };
        }),
      },
    },
  });

  await restoreNewestSessionHistory(sessionId, 'code');
  useAppStore.setState({ pendingSendBySession: { [sessionId]: true } });
  await revalidateNewestSessionHistory(sessionId, 'code');
  useAppStore.setState({ pendingSendBySession: {} });
  await refreshDeferredSessionHistory(sessionId);

  assert.equal(calls, 2, 'terminal refresh must not jump an older browsing window to newest');
  assert.equal(sessionHistoryPagingSnapshot(sessionId).revision, 'revision-1');
  assert.equal(sessionHistoryPagingSnapshot(sessionId).hasNewer, true);
});

test('a partial warning in an explicitly older window does not jump back to newest', async () => {
  const sessionId = 'history-paging-older-warning-window';
  useAppStore.setState({
    sessions: [
      {
        sessionId,
        projectRoot: '/project',
        provider: 'mock',
        reasoningMode: 'auto',
        permissionMode: 'accept-edits',
        agentMode: 'ama',
        surface: 'code',
        createdAt: 1_000,
        lastActivityAt: 1_000,
      },
    ],
    currentSessionId: sessionId,
    eventsBySession: {},
    userMessagesBySession: {},
    pendingSendBySession: {},
  });
  let calls = 0;
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    writable: true,
    value: {
      kodaxSpace: {
        invoke: mockHistoryInvoke(async () => {
          calls += 1;
          if (calls === 1) {
            return {
              ok: true as const,
              data: {
                items: [{ kind: 'user' as const, content: 'newest partial row' }],
                conversation: { status: 'partial' as const },
                page: {
                  outcome: 'ready' as const,
                  revision: 'newest-revision',
                  sourceRevision: 'newest-source',
                  hasMore: true as const,
                  nextCursor: 'older-cursor',
                  windowMode: 'replace' as const,
                  hasNewer: false as const,
                },
              },
            };
          }
          if (calls === 2) {
            return {
              ok: true as const,
              data: {
                items: [{ kind: 'user' as const, content: 'older partial row' }],
                conversation: { status: 'partial' as const },
                page: {
                  outcome: 'ready' as const,
                  revision: 'older-revision',
                  sourceRevision: 'older-source',
                  hasMore: false as const,
                  windowMode: 'replace' as const,
                  hasNewer: true as const,
                },
              },
            };
          }
          return {
            ok: true as const,
            data: {
              items: [{ kind: 'user' as const, content: 'unexpected newest repair' }],
              conversation: { status: 'resolved' as const },
              page: {
                outcome: 'ready' as const,
                revision: 'unexpected-revision',
                sourceRevision: 'unexpected-source',
                hasMore: false as const,
                windowMode: 'replace' as const,
                hasNewer: false as const,
              },
            },
          };
        }),
      },
    },
  });

  await restoreNewestSessionHistory(sessionId, 'code');
  await loadOlderSessionHistory(sessionId);
  assert.equal(sessionHistoryPagingSnapshot(sessionId).hasNewer, true);
  invalidateSessionHistoryPaging(sessionId);
  await new Promise((resolve) => setTimeout(resolve, 20));

  assert.equal(calls, 2);
  assert.equal(sessionHistoryPagingSnapshot(sessionId).revision, 'older-revision');
  assert.equal(sessionHistoryPagingSnapshot(sessionId).conversationStatus, 'partial');
  assert.deepEqual(
    useAppStore.getState().userMessagesBySession[sessionId]?.map((message) => message.content),
    ['older partial row'],
  );
});

test('a stale scoped session_start cannot block a canonical revalidation', async () => {
  const sessionId = 'history-paging-stale-scoped-start';
  const runtimeConnection = {
    state: 'ready' as const,
    changedAt: 2_000,
    stale: false as const,
    runtimeId: 'runtime-current',
    profile: 'default',
    capabilities: [],
  };
  useAppStore.setState({
    sessions: [
      {
        sessionId,
        projectRoot: '/project',
        provider: 'mock',
        reasoningMode: 'auto',
        permissionMode: 'accept-edits',
        agentMode: 'ama',
        surface: 'code',
        createdAt: 1_000,
        lastActivityAt: 1_000,
      },
    ],
    currentSessionId: sessionId,
    eventsBySession: {},
    userMessagesBySession: {},
    pendingSendBySession: {},
    liveProjectionBySession: {},
    runtimeConnection,
    runtimeProfile: {
      connection: runtimeConnection,
      projectionRevision: 2,
      cursor: { runtimeId: 'runtime-current', seq: 2 },
      sessions: [
        {
          sessionId,
          projectRoot: '/project',
          surface: 'code',
          createdAt: 1_000,
          lastActivityAt: 2_000,
          queuedRuns: [],
        },
      ],
      interactions: [],
      notifications: [],
    },
  });
  let calls = 0;
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    writable: true,
    value: {
      kodaxSpace: {
        invoke: mockHistoryInvoke(async () => {
          calls += 1;
          return {
            ok: true as const,
            data: {
              items: [
                {
                  kind: 'user' as const,
                  content: calls === 1 ? 'old canonical' : 'new canonical',
                  canonicalIndex: 0,
                },
              ],
              page: {
                outcome: 'ready' as const,
                revision: `revision-${calls}`,
                sourceRevision: `source-${calls}`,
                hasMore: false,
                windowMode: 'replace' as const,
                hasNewer: false,
              },
            },
          };
        }),
      },
    },
  });

  await restoreNewestSessionHistory(sessionId, 'code');
  useAppStore.getState().appendEvent({
    kind: 'session_start',
    sessionId,
    provider: 'mock',
    runtimeEvent: { runtimeId: 'runtime-old', runId: 'run-old', seq: 1 },
  });
  await revalidateNewestSessionHistory(sessionId, 'code');

  assert.equal(sessionHistoryPagingSnapshot(sessionId).revision, 'revision-2');
  assert.equal(
    useAppStore.getState().userMessagesBySession[sessionId]?.[0]?.content,
    'new canonical',
  );
});

test('older bounded windows restore at their newest edge when no DOM anchor survives', () => {
  assert.equal(olderHistoryWindowSeamScrollTop(4_000, 800), 3_200);
  assert.equal(olderHistoryWindowSeamScrollTop(600, 800), 0);
});

test('prepend anchor correction remains sparse but covers delayed occlusion layout', () => {
  assert.deepEqual(PREPEND_ANCHOR_CORRECTION_FRAME_OFFSETS, [0, 1, 2, 4, 6, 9, 13, 18, 24, 32]);
});

test('only an upward no-movement boundary gesture preserves an active prepend restoration', () => {
  assert.equal(preservesPrependAnchorForBoundaryInput('restoring', true, 0), true);
  assert.equal(preservesPrependAnchorForBoundaryInput('restoring', true, 1), true);
  assert.equal(preservesPrependAnchorForBoundaryInput('restoring', true, 2), false);
  assert.equal(preservesPrependAnchorForBoundaryInput('restoring', false, 0), false);
  assert.equal(preservesPrependAnchorForBoundaryInput('loading', true, 0), false);
  assert.equal(preservesPrependAnchorForBoundaryInput(undefined, true, 0), false);
});

test('Runtime observation waits for the canonical history activation to settle', () => {
  assert.equal(historyPhaseAllowsRuntimeObservation('idle'), false);
  assert.equal(historyPhaseAllowsRuntimeObservation('waiting'), false);
  assert.equal(historyPhaseAllowsRuntimeObservation('loading'), false);
  assert.equal(historyPhaseAllowsRuntimeObservation('ready'), true);
  assert.equal(historyPhaseAllowsRuntimeObservation('error'), true);
});

test('Runtime ready wakes waiting history immediately and cancels the old retry timer', async () => {
  const sessionId = 'history-paging-runtime-ready-wake';
  useAppStore.setState({
    sessions: [],
    currentSessionId: sessionId,
    eventsBySession: {},
    userMessagesBySession: {},
  });
  let calls = 0;
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    writable: true,
    value: {
      kodaxSpace: {
        invoke: mockHistoryInvoke(async () => {
          calls += 1;
          if (calls === 1) {
            return {
              ok: true as const,
              data: { items: [], page: { outcome: 'runtime_unavailable' as const } },
            };
          }
          return {
            ok: true as const,
            data: {
              items: [{ kind: 'user' as const, content: 'ready without timer delay' }],
              page: {
                outcome: 'ready' as const,
                revision: 'ready-revision',
                sourceRevision: 'ready-source',
                hasMore: false,
                windowMode: 'replace' as const,
                hasNewer: false,
              },
            },
          };
        }),
      },
    },
  });

  await restoreNewestSessionHistory(sessionId, 'code');
  assert.equal(sessionHistoryPagingSnapshot(sessionId).phase, 'waiting');
  await wakeWaitingSessionHistory(sessionId);
  assert.equal(calls, 2);
  assert.equal(sessionHistoryPagingSnapshot(sessionId).phase, 'ready');
  await new Promise((resolve) => setTimeout(resolve, 250));
  assert.equal(calls, 2, 'the superseded retry timer must remain cancelled');
});

test('Runtime ready coalesces behind an in-flight unavailable history read', async () => {
  const sessionId = 'history-paging-runtime-ready-inflight';
  useAppStore.setState({
    sessions: [],
    currentSessionId: sessionId,
    eventsBySession: {},
    userMessagesBySession: {},
  });
  let calls = 0;
  let resolveUnavailable!: (value: {
    ok: true;
    data: { items: never[]; page: { outcome: 'runtime_unavailable' } };
  }) => void;
  const unavailable = new Promise<{
    ok: true;
    data: { items: never[]; page: { outcome: 'runtime_unavailable' } };
  }>((resolve) => {
    resolveUnavailable = resolve;
  });
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    writable: true,
    value: {
      kodaxSpace: {
        invoke: mockHistoryInvoke(async () => {
          calls += 1;
          if (calls === 1) return unavailable;
          return {
            ok: true as const,
            data: {
              items: [{ kind: 'user' as const, content: 'single ready wake' }],
              page: {
                outcome: 'ready' as const,
                revision: 'ready-revision',
                sourceRevision: 'ready-source',
                hasMore: false,
                windowMode: 'replace' as const,
                hasNewer: false,
              },
            },
          };
        }),
      },
    },
  });

  const initial = restoreNewestSessionHistory(sessionId, 'code');
  await new Promise<void>((resolve) => setImmediate(resolve));
  const firstWake = wakeWaitingSessionHistory(sessionId);
  const secondWake = wakeWaitingSessionHistory(sessionId);
  resolveUnavailable({
    ok: true,
    data: { items: [], page: { outcome: 'runtime_unavailable' } },
  });
  await Promise.all([initial, firstWake, secondWake]);

  assert.equal(calls, 2);
  assert.equal(sessionHistoryPagingSnapshot(sessionId).phase, 'ready');
  await new Promise((resolve) => setTimeout(resolve, 250));
  assert.equal(calls, 2);
});

test('only canonical persistence-boundary events invalidate cached history', () => {
  assert.equal(sessionEventInvalidatesHistoryCache('session_complete'), true);
  assert.equal(sessionEventInvalidatesHistoryCache('session_error'), true);
  assert.equal(sessionEventInvalidatesHistoryCache('lineage_notice'), true);
  assert.equal(sessionEventInvalidatesHistoryCache('text_delta'), false);
  assert.equal(sessionEventInvalidatesHistoryCache('tool_result'), false);
});

test('partial or ambiguous conversation diagnostics are never treated as reusable cache authority', async () => {
  const sessionId = 'history-paging-uncertain-cache';
  useAppStore.setState({
    sessions: [],
    currentSessionId: sessionId,
    eventsBySession: {},
    userMessagesBySession: {},
  });
  let call = 0;
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    writable: true,
    value: {
      kodaxSpace: {
        invoke: mockHistoryInvoke(async () => {
          call += 1;
          return {
            ok: true as const,
            data: {
              items: [],
              conversation: { status: call === 1 ? ('partial' as const) : ('resolved' as const) },
              page: {
                outcome: 'ready' as const,
                revision: `revision-${call}`,
                sourceRevision: `source-${call}`,
                hasMore: false,
                windowMode: 'replace' as const,
                hasNewer: false,
              },
            },
          };
        }),
      },
    },
  });

  await restoreNewestSessionHistory(sessionId, 'code');
  assert.equal(hasReadySessionHistory(sessionId), false);
  deactivateSessionHistoryPaging(sessionId);
  await restoreNewestSessionHistory(sessionId, 'code');
  assert.equal(call, 2);
  assert.equal(hasReadySessionHistory(sessionId), true);
});

test('a persistence boundary makes an otherwise ready page ineligible for reuse', async () => {
  const sessionId = 'history-paging-invalidated-cache';
  useAppStore.setState({
    sessions: [],
    currentSessionId: sessionId,
    eventsBySession: {},
    userMessagesBySession: {},
  });
  let calls = 0;
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    writable: true,
    value: {
      kodaxSpace: {
        invoke: mockHistoryInvoke(async () => {
          calls += 1;
          return {
            ok: true as const,
            data: {
              items: [],
              conversation: { status: 'resolved' as const },
              page: {
                outcome: 'ready' as const,
                revision: `revision-${calls}`,
                sourceRevision: `source-${calls}`,
                hasMore: false,
                windowMode: 'replace' as const,
                hasNewer: false,
              },
            },
          };
        }),
      },
    },
  });

  await restoreNewestSessionHistory(sessionId, 'code');
  assert.equal(hasReadySessionHistory(sessionId), true);
  invalidateSessionHistoryPaging(sessionId);
  assert.equal(hasReadySessionHistory(sessionId), false);
  deactivateSessionHistoryPaging(sessionId);
  await restoreNewestSessionHistory(sessionId, 'code');
  assert.equal(calls, 2);
  assert.equal(hasReadySessionHistory(sessionId), true);
});

test('a persistence boundary racing an IPC read rejects the stale page and retries newest', async () => {
  const sessionId = 'history-paging-invalidation-race';
  useAppStore.setState({
    sessions: [
      {
        sessionId,
        projectRoot: '/project',
        provider: 'mock',
        reasoningMode: 'auto',
        permissionMode: 'accept-edits',
        agentMode: 'ama',
        surface: 'code',
        createdAt: 1_000,
        lastActivityAt: 1_000,
      },
    ],
    currentSessionId: sessionId,
    eventsBySession: {},
    userMessagesBySession: {},
  });
  let calls = 0;
  let resolveStale!: (value: {
    ok: true;
    data: {
      items: Array<{ kind: 'user'; content: string }>;
      conversation: { status: 'resolved' };
      page: {
        outcome: 'ready';
        revision: string;
        sourceRevision: string;
        hasMore: false;
        windowMode: 'replace';
        hasNewer: false;
      };
    };
  }) => void;
  const staleResponse = new Promise<Parameters<typeof resolveStale>[0]>((resolve) => {
    resolveStale = resolve;
  });
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    writable: true,
    value: {
      kodaxSpace: {
        invoke: mockHistoryInvoke(async () => {
          calls += 1;
          if (calls === 1) return staleResponse;
          return {
            ok: true as const,
            data: {
              items: [{ kind: 'user' as const, content: 'fresh query' }],
              conversation: { status: 'resolved' as const },
              page: {
                outcome: 'ready' as const,
                revision: 'revision-fresh',
                sourceRevision: 'source-fresh',
                hasMore: false as const,
                windowMode: 'replace' as const,
                hasNewer: false as const,
              },
            },
          };
        }),
      },
    },
  });

  const initial = restoreNewestSessionHistory(sessionId, 'code');
  invalidateSessionHistoryPaging(sessionId);
  resolveStale({
    ok: true,
    data: {
      items: [{ kind: 'user', content: 'stale query' }],
      conversation: { status: 'resolved' },
      page: {
        outcome: 'ready',
        revision: 'revision-stale',
        sourceRevision: 'source-stale',
        hasMore: false,
        windowMode: 'replace',
        hasNewer: false,
      },
    },
  });
  await initial;
  const deadline = Date.now() + 2_000;
  while (calls < 2 && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  assert.equal(calls, 2);
  assert.equal(sessionHistoryPagingSnapshot(sessionId).sourceRevision, 'source-fresh');
  assert.deepEqual(
    useAppStore.getState().userMessagesBySession[sessionId]?.map((message) => message.content),
    ['fresh query'],
  );
});

test('an invalidated older-page request restarts at newest instead of certifying the old snapshot', async () => {
  const sessionId = 'history-paging-invalidated-continuation';
  useAppStore.setState({
    sessions: [
      {
        sessionId,
        projectRoot: '/project',
        provider: 'mock',
        reasoningMode: 'auto',
        permissionMode: 'accept-edits',
        agentMode: 'ama',
        surface: 'code',
        createdAt: 1_000,
        lastActivityAt: 1_000,
      },
    ],
    currentSessionId: sessionId,
    eventsBySession: {},
    userMessagesBySession: {},
  });
  const inputs: unknown[] = [];
  const pages = [
    {
      items: [{ kind: 'user' as const, content: 'old newest' }],
      conversation: { status: 'resolved' as const },
      page: {
        outcome: 'ready' as const,
        revision: 'old-revision',
        sourceRevision: 'old-source',
        hasMore: true,
        nextCursor: 'old-cursor',
        windowMode: 'replace' as const,
        hasNewer: false,
      },
    },
    {
      items: [{ kind: 'user' as const, content: 'fresh newest' }],
      conversation: { status: 'resolved' as const },
      page: {
        outcome: 'ready' as const,
        revision: 'fresh-revision',
        sourceRevision: 'fresh-source',
        hasMore: false,
        windowMode: 'replace' as const,
        hasNewer: false,
      },
    },
  ];
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    writable: true,
    value: {
      kodaxSpace: {
        invoke: mockHistoryInvoke(async (_channel: string, input: unknown) => {
          inputs.push(input);
          return { ok: true as const, data: pages[inputs.length - 1]! };
        }),
      },
    },
  });

  await restoreNewestSessionHistory(sessionId, 'code');
  invalidateSessionHistoryPaging(sessionId);
  await loadOlderSessionHistory(sessionId);

  assert.deepEqual(inputs.map(withoutHistoryRequestId), [
    { sessionId, expectedSurface: 'code' },
    { sessionId, expectedSurface: 'code' },
  ]);
  assert.deepEqual(sessionHistoryPagingSnapshot(sessionId), {
    phase: 'ready',
    surface: 'code',
    revision: 'fresh-revision',
    sourceRevision: 'fresh-source',
    hasMore: false,
    hasNewer: false,
    conversationStatus: 'resolved',
  });
  assert.equal(hasReadySessionHistory(sessionId), true);
  assert.deepEqual(
    useAppStore.getState().userMessagesBySession[sessionId]?.map((message) => message.content),
    ['fresh newest'],
  );
});

test('an invalidated older-page request defers its newest replacement while a live turn is open', async () => {
  const sessionId = 'history-paging-invalidated-active-continuation';
  useAppStore.setState({
    sessions: [
      {
        sessionId,
        projectRoot: '/project',
        provider: 'mock',
        reasoningMode: 'auto',
        permissionMode: 'accept-edits',
        agentMode: 'ama',
        surface: 'code',
        createdAt: 1_000,
        lastActivityAt: 1_000,
      },
    ],
    currentSessionId: sessionId,
    eventsBySession: {},
    userMessagesBySession: {},
    pendingSendBySession: {},
  });
  const inputs: unknown[] = [];
  let calls = 0;
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    writable: true,
    value: {
      kodaxSpace: {
        invoke: mockHistoryInvoke(async (_channel: string, input: unknown) => {
          inputs.push(input);
          calls += 1;
          return {
            ok: true as const,
            data: {
              items: [
                {
                  kind: 'user' as const,
                  content:
                    calls === 1
                      ? 'visible newest row'
                      : calls === 2
                        ? 'overtaken newest row'
                        : 'settled newest row',
                },
              ],
              conversation: { status: 'resolved' as const },
              page: {
                outcome: 'ready' as const,
                revision: `revision-${calls}`,
                sourceRevision: `source-${calls}`,
                hasMore: calls === 1,
                ...(calls === 1 ? { nextCursor: 'older-cursor' } : {}),
                windowMode: 'replace' as const,
                hasNewer: false as const,
              },
            },
          };
        }),
      },
    },
  });

  await restoreNewestSessionHistory(sessionId, 'code');
  invalidateSessionHistoryPaging(sessionId);
  useAppStore.setState({ pendingSendBySession: { [sessionId]: true } });
  await loadOlderSessionHistory(sessionId);

  assert.deepEqual(withoutHistoryRequestId(inputs[1]), {
    sessionId,
    expectedSurface: 'code',
  });
  assert.equal(sessionHistoryPagingSnapshot(sessionId).phase, 'ready');
  assert.equal(sessionHistoryPagingSnapshot(sessionId).revision, 'revision-1');
  assert.deepEqual(
    useAppStore.getState().userMessagesBySession[sessionId]?.map((message) => message.content),
    ['visible newest row'],
  );

  useAppStore.setState({ pendingSendBySession: {} });
  await refreshDeferredSessionHistory(sessionId);

  assert.equal(calls, 3);
  assert.equal(sessionHistoryPagingSnapshot(sessionId).revision, 'revision-3');
  assert.deepEqual(
    useAppStore.getState().userMessagesBySession[sessionId]?.map((message) => message.content),
    ['settled newest row'],
  );
});

test('an uncertain warning remains visible while a raced refresh waits for Runtime', async () => {
  const sessionId = 'history-paging-warning-race';
  useAppStore.setState({
    sessions: [
      {
        sessionId,
        projectRoot: '/project',
        provider: 'mock',
        reasoningMode: 'auto',
        permissionMode: 'accept-edits',
        agentMode: 'ama',
        surface: 'code',
        createdAt: 1_000,
        lastActivityAt: 1_000,
      },
    ],
    currentSessionId: sessionId,
    eventsBySession: {},
    userMessagesBySession: {},
  });
  let calls = 0;
  let resolveRaced!: (value: {
    ok: true;
    data: {
      items: Array<{ kind: 'user'; content: string }>;
      conversation: { status: 'partial' };
      page: {
        outcome: 'ready';
        revision: string;
        sourceRevision: string;
        hasMore: false;
        windowMode: 'replace';
        hasNewer: false;
      };
    };
  }) => void;
  const racedResponse = new Promise<Parameters<typeof resolveRaced>[0]>((resolve) => {
    resolveRaced = resolve;
  });
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    writable: true,
    value: {
      kodaxSpace: {
        invoke: mockHistoryInvoke(async () => {
          calls += 1;
          if (calls === 1) {
            return {
              ok: true as const,
              data: {
                items: [{ kind: 'user' as const, content: 'visible partial row' }],
                conversation: { status: 'partial' as const },
                page: {
                  outcome: 'ready' as const,
                  revision: 'partial-revision',
                  sourceRevision: 'partial-source',
                  hasMore: false as const,
                  windowMode: 'replace' as const,
                  hasNewer: false as const,
                },
              },
            };
          }
          if (calls === 2) return racedResponse;
          return {
            ok: true as const,
            data: { items: [], page: { outcome: 'runtime_unavailable' as const } },
          };
        }),
      },
    },
  });

  await restoreNewestSessionHistory(sessionId, 'code');
  const refresh = restoreNewestSessionHistory(sessionId, 'code');
  invalidateSessionHistoryPaging(sessionId);
  resolveRaced({
    ok: true,
    data: {
      items: [{ kind: 'user', content: 'raced partial row' }],
      conversation: { status: 'partial' },
      page: {
        outcome: 'ready',
        revision: 'raced-revision',
        sourceRevision: 'raced-source',
        hasMore: false,
        windowMode: 'replace',
        hasNewer: false,
      },
    },
  });
  await refresh;
  const deadline = Date.now() + 2_000;
  while (calls < 3 && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  assert.equal(calls, 3);
  assert.deepEqual(sessionHistoryPagingSnapshot(sessionId), {
    phase: 'waiting',
    surface: 'code',
    hasMore: false,
    conversationStatus: 'partial',
    runtimeUnavailable: true,
  });
  assert.deepEqual(
    useAppStore.getState().userMessagesBySession[sessionId]?.map((message) => message.content),
    ['visible partial row'],
  );
});

test('an active uncertain warning revalidates immediately at a persistence boundary', async () => {
  const sessionId = 'history-paging-active-warning-refresh';
  useAppStore.setState({
    sessions: [
      {
        sessionId,
        projectRoot: '/project',
        provider: 'mock',
        reasoningMode: 'auto',
        permissionMode: 'accept-edits',
        agentMode: 'ama',
        surface: 'code',
        createdAt: 1_000,
        lastActivityAt: 1_000,
      },
    ],
    currentSessionId: sessionId,
    eventsBySession: {},
    userMessagesBySession: {},
  });
  let calls = 0;
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    writable: true,
    value: {
      kodaxSpace: {
        invoke: mockHistoryInvoke(async () => {
          calls += 1;
          return {
            ok: true as const,
            data: {
              items: [
                {
                  kind: 'user' as const,
                  content: calls === 1 ? 'partial query' : 'resolved query',
                },
              ],
              conversation: {
                status: calls === 1 ? ('partial' as const) : ('resolved' as const),
              },
              page: {
                outcome: 'ready' as const,
                revision: `revision-${calls}`,
                sourceRevision: `source-${calls}`,
                hasMore: false as const,
                windowMode: 'replace' as const,
                hasNewer: false as const,
              },
            },
          };
        }),
      },
    },
  });

  await restoreNewestSessionHistory(sessionId, 'code');
  assert.equal(sessionHistoryPagingSnapshot(sessionId).conversationStatus, 'partial');
  invalidateSessionHistoryPaging(sessionId);
  const deadline = Date.now() + 2_000;
  while (
    sessionHistoryPagingSnapshot(sessionId).conversationStatus !== 'resolved' &&
    Date.now() < deadline
  ) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  assert.equal(calls, 2);
  assert.equal(sessionHistoryPagingSnapshot(sessionId).conversationStatus, 'resolved');
  assert.equal(hasReadySessionHistory(sessionId), true);
  assert.deepEqual(
    useAppStore.getState().userMessagesBySession[sessionId]?.map((message) => message.content),
    ['resolved query'],
  );
});

test('an active warning refresh overtaken by the next Run defers canonical replacement', async () => {
  const sessionId = 'history-paging-active-warning-overtaken';
  useAppStore.setState({
    sessions: [
      {
        sessionId,
        projectRoot: '/project',
        provider: 'mock',
        reasoningMode: 'auto',
        permissionMode: 'accept-edits',
        agentMode: 'ama',
        surface: 'code',
        createdAt: 1_000,
        lastActivityAt: 1_000,
      },
    ],
    currentSessionId: sessionId,
    eventsBySession: {},
    userMessagesBySession: {},
    pendingSendBySession: {},
  });
  let calls = 0;
  let resolveOvertaken!: (value: {
    ok: true;
    data: {
      items: Array<{ kind: 'user'; content: string }>;
      conversation: { status: 'resolved' };
      page: {
        outcome: 'ready';
        revision: string;
        sourceRevision: string;
        hasMore: false;
        windowMode: 'replace';
        hasNewer: false;
      };
    };
  }) => void;
  const overtakenResponse = new Promise<Parameters<typeof resolveOvertaken>[0]>((resolve) => {
    resolveOvertaken = resolve;
  });
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    writable: true,
    value: {
      kodaxSpace: {
        invoke: mockHistoryInvoke(async () => {
          calls += 1;
          if (calls === 1) {
            return {
              ok: true as const,
              data: {
                items: [{ kind: 'user' as const, content: 'visible partial row' }],
                conversation: { status: 'partial' as const },
                page: {
                  outcome: 'ready' as const,
                  revision: 'revision-1',
                  sourceRevision: 'source-1',
                  hasMore: false as const,
                  windowMode: 'replace' as const,
                  hasNewer: false as const,
                },
              },
            };
          }
          if (calls === 2) return overtakenResponse;
          return {
            ok: true as const,
            data: {
              items: [{ kind: 'user' as const, content: 'settled row' }],
              conversation: { status: 'resolved' as const },
              page: {
                outcome: 'ready' as const,
                revision: 'revision-3',
                sourceRevision: 'source-3',
                hasMore: false as const,
                windowMode: 'replace' as const,
                hasNewer: false as const,
              },
            },
          };
        }),
      },
    },
  });

  await restoreNewestSessionHistory(sessionId, 'code');
  invalidateSessionHistoryPaging(sessionId);
  const deadline = Date.now() + 2_000;
  while (calls < 2 && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.equal(calls, 2);
  useAppStore.setState({ pendingSendBySession: { [sessionId]: true } });
  resolveOvertaken({
    ok: true,
    data: {
      items: [{ kind: 'user', content: 'overtaken row' }],
      conversation: { status: 'resolved' },
      page: {
        outcome: 'ready',
        revision: 'revision-2',
        sourceRevision: 'source-2',
        hasMore: false,
        windowMode: 'replace',
        hasNewer: false,
      },
    },
  });
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(sessionHistoryPagingSnapshot(sessionId).revision, 'revision-1');
  assert.equal(sessionHistoryPagingSnapshot(sessionId).conversationStatus, 'partial');
  useAppStore.setState({ pendingSendBySession: {} });
  await refreshDeferredSessionHistory(sessionId);

  assert.equal(calls, 3);
  assert.equal(sessionHistoryPagingSnapshot(sessionId).revision, 'revision-3');
  assert.equal(sessionHistoryPagingSnapshot(sessionId).conversationStatus, 'resolved');
  assert.deepEqual(
    useAppStore.getState().userMessagesBySession[sessionId]?.map((message) => message.content),
    ['settled row'],
  );
});

test('reactivating an uncertain ready page during a live turn stays ready until settlement', async () => {
  const sessionId = 'history-paging-partial-reactivation-overtaken';
  useAppStore.setState({
    sessions: [
      {
        sessionId,
        projectRoot: '/project',
        provider: 'mock',
        reasoningMode: 'auto',
        permissionMode: 'accept-edits',
        agentMode: 'ama',
        surface: 'code',
        createdAt: 1_000,
        lastActivityAt: 1_000,
      },
    ],
    currentSessionId: sessionId,
    eventsBySession: {},
    userMessagesBySession: {},
    pendingSendBySession: {},
  });
  let calls = 0;
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    writable: true,
    value: {
      kodaxSpace: {
        invoke: mockHistoryInvoke(async () => {
          calls += 1;
          return {
            ok: true as const,
            data: {
              items: [
                {
                  kind: 'user' as const,
                  content: calls === 1 ? 'visible partial row' : `replacement row ${calls}`,
                },
              ],
              conversation: {
                status: calls === 1 ? ('partial' as const) : ('resolved' as const),
              },
              page: {
                outcome: 'ready' as const,
                revision: `revision-${calls}`,
                sourceRevision: `source-${calls}`,
                hasMore: false as const,
                windowMode: 'replace' as const,
                hasNewer: false as const,
              },
            },
          };
        }),
      },
    },
  });

  await restoreNewestSessionHistory(sessionId, 'code');
  deactivateSessionHistoryPaging(sessionId);
  invalidateSessionHistoryPaging(sessionId);
  useAppStore.setState({ pendingSendBySession: { [sessionId]: true } });
  await restoreNewestSessionHistory(sessionId, 'code');

  assert.equal(calls, 2);
  assert.equal(sessionHistoryPagingSnapshot(sessionId).phase, 'ready');
  assert.equal(sessionHistoryPagingSnapshot(sessionId).revision, 'revision-1');
  assert.equal(sessionHistoryPagingSnapshot(sessionId).conversationStatus, 'partial');
  assert.deepEqual(
    useAppStore.getState().userMessagesBySession[sessionId]?.map((message) => message.content),
    ['visible partial row'],
  );

  useAppStore.setState({ pendingSendBySession: {} });
  await refreshDeferredSessionHistory(sessionId);

  assert.equal(calls, 3);
  assert.equal(sessionHistoryPagingSnapshot(sessionId).phase, 'ready');
  assert.equal(sessionHistoryPagingSnapshot(sessionId).revision, 'revision-3');
  assert.deepEqual(
    useAppStore.getState().userMessagesBySession[sessionId]?.map((message) => message.content),
    ['replacement row 3'],
  );
});

test('reactivating an invalidated ready page defers an in-flight canonical duplicate', async () => {
  const sessionId = 'history-paging-invalidated-reactivation-overtaken';
  useAppStore.setState({
    sessions: [
      {
        sessionId,
        projectRoot: '/project',
        provider: 'mock',
        reasoningMode: 'auto',
        permissionMode: 'accept-edits',
        agentMode: 'ama',
        surface: 'code',
        createdAt: 1_000,
        lastActivityAt: 1_000,
      },
    ],
    currentSessionId: sessionId,
    eventsBySession: {},
    userMessagesBySession: {},
    pendingSendBySession: {},
  });
  let calls = 0;
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    writable: true,
    value: {
      kodaxSpace: {
        invoke: mockHistoryInvoke(async () => {
          calls += 1;
          const secondAnswer = calls === 2 ? 'stale partial second answer' : 'second answer';
          return {
            ok: true as const,
            data: {
              items: [
                {
                  kind: 'user' as const,
                  content: 'first query',
                  canonicalIndex: 0,
                  turnId: 'turn-first',
                  turnUserOrdinal: 0,
                },
                {
                  kind: 'assistant' as const,
                  text: 'first answer',
                  canonicalIndex: 1,
                  turnId: 'turn-first',
                },
                ...(calls === 1
                  ? []
                  : [
                      {
                        kind: 'user' as const,
                        content: 'second query',
                        canonicalIndex: 2,
                        turnId: 'turn-second',
                        turnUserOrdinal: 0,
                      },
                      {
                        kind: 'assistant' as const,
                        text: secondAnswer,
                        canonicalIndex: 3,
                        turnId: 'turn-second',
                      },
                    ]),
              ],
              conversation: { status: 'resolved' as const },
              page: {
                outcome: 'ready' as const,
                revision: `revision-${calls}`,
                sourceRevision: `source-${calls}`,
                hasMore: false as const,
                windowMode: 'replace' as const,
                hasNewer: false as const,
              },
            },
          };
        }),
      },
    },
  });

  await restoreNewestSessionHistory(sessionId, 'code');
  deactivateSessionHistoryPaging(sessionId);
  invalidateSessionHistoryPaging(sessionId);

  const messageId = useAppStore.getState().appendUserMessage(sessionId, 'second query', 2_000);
  assert.ok(messageId);
  useAppStore.getState().appendEvent({
    kind: 'session_start',
    sessionId,
    provider: 'mock',
    turnId: 'turn-second',
    runtimeEvent: { runtimeId: 'runtime-active', runId: 'run-second', seq: 1 },
  });
  useAppStore.getState().bindUserMessageRuntimeRun(sessionId, messageId, 'run-second');
  useAppStore.getState().appendEvent({
    kind: 'text_delta',
    sessionId,
    text: 'second answer',
    turnId: 'turn-second',
    runtimeEvent: { runtimeId: 'runtime-active', runId: 'run-second', seq: 2 },
  });
  const runtimeConnection = {
    state: 'ready' as const,
    changedAt: 2_000,
    stale: false as const,
    runtimeId: 'runtime-active',
    capabilities: [],
  };
  const activeRun = {
    runId: 'run-second',
    sessionId,
    phase: 'running' as const,
    startedAt: 2_000,
  };
  useAppStore.setState({
    runtimeConnection,
    runtimeProfile: {
      connection: runtimeConnection,
      projectionRevision: 1,
      cursor: { runtimeId: 'runtime-active', seq: 2 },
      sessions: [
        {
          sessionId,
          projectRoot: '/project',
          surface: 'code',
          createdAt: 1_000,
          lastActivityAt: 2_000,
          queuedRuns: [],
          activeRun,
        },
      ],
      interactions: [],
      notifications: [],
    },
    liveProjectionBySession: {
      [sessionId]: {
        sessionId,
        projectionRevision: 1,
        cursor: { runtimeId: 'runtime-active', seq: 2 },
        transcriptRevision: 'transcript-active',
        queuedRuns: [],
        activeRun,
        activeTools: [],
        todos: [],
        queuedInputs: [],
        interactions: [],
      },
    },
  });

  await restoreNewestSessionHistory(sessionId, 'code');

  assert.equal(calls, 2);
  assert.equal(sessionHistoryPagingSnapshot(sessionId).revision, 'revision-1');
  assert.deepEqual(
    composeMessages({
      userMessages: useAppStore.getState().userMessagesBySession[sessionId] ?? [],
      events: useAppStore.getState().eventsBySession[sessionId] ?? [],
    }).flatMap((message) => {
      if (message.kind === 'user') return [`user:${message.content}`];
      if (message.kind === 'assistant_text') return [`assistant:${message.text}`];
      return [];
    }),
    ['user:first query', 'assistant:first answer', 'user:second query', 'assistant:second answer'],
  );

  useAppStore.getState().appendEvent({
    kind: 'session_complete',
    sessionId,
    turnId: 'turn-second',
    runtimeEvent: { runtimeId: 'runtime-active', runId: 'run-second', seq: 3 },
  });
  useAppStore.setState({ liveProjectionBySession: {}, runtimeProfile: null });
  invalidateSessionHistoryPaging(sessionId);
  await refreshDeferredSessionHistory(sessionId);

  assert.equal(calls, 3);
  assert.equal(sessionHistoryPagingSnapshot(sessionId).revision, 'revision-3');
  const terminalTranscript = composeMessages({
    userMessages: useAppStore.getState().userMessagesBySession[sessionId] ?? [],
    events: useAppStore.getState().eventsBySession[sessionId] ?? [],
  }).flatMap((message) => {
    if (message.kind === 'user') return [`user:${message.content}`];
    if (message.kind === 'assistant_text') return [`assistant:${message.text}`];
    return [];
  });
  assert.equal(terminalTranscript.filter((item) => item === 'user:second query').length, 1);
  assert.equal(terminalTranscript.filter((item) => item === 'assistant:second answer').length, 1);
});

test('history paging preserves surface routing and restarts from newest after data_changed', async () => {
  const sessionId = 'history-paging-resync';
  useAppStore.setState({
    sessions: [
      {
        sessionId,
        projectRoot: '/project',
        provider: 'mock',
        reasoningMode: 'auto',
        permissionMode: 'accept-edits',
        agentMode: 'ama',
        surface: 'code',
        createdAt: 1_000,
        lastActivityAt: 1_000,
      },
    ],
    currentSessionId: sessionId,
    eventsBySession: {},
    userMessagesBySession: {},
  });

  const inputs: unknown[] = [];
  let call = 0;
  const invoke = async (_channel: string, input: unknown) => {
    inputs.push(input);
    call += 1;
    if (call === 1) {
      return {
        ok: true as const,
        data: {
          items: [{ kind: 'user' as const, content: 'stale newest' }],
          page: {
            outcome: 'ready' as const,
            revision: 'revision-1',
            sourceRevision: 'source-1',
            hasMore: true,
            nextCursor: 'older-1',
            windowMode: 'replace' as const,
            hasNewer: false,
          },
        },
      };
    }
    if (call === 2) {
      return {
        ok: true as const,
        data: { items: [], page: { outcome: 'data_changed' as const } },
      };
    }
    return {
      ok: true as const,
      data: {
        items: [{ kind: 'user' as const, content: 'fresh newest' }],
        page: {
          outcome: 'ready' as const,
          revision: 'revision-2',
          sourceRevision: 'source-2',
          hasMore: false,
          windowMode: 'replace' as const,
          hasNewer: false,
        },
      },
    };
  };
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    writable: true,
    value: { kodaxSpace: { invoke: mockHistoryInvoke(invoke) } },
  });

  await restoreNewestSessionHistory(sessionId, 'code');
  await loadOlderSessionHistory(sessionId);
  const deadline = Date.now() + 2_000;
  while (call < 3 && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  assert.deepEqual(inputs.map(withoutHistoryRequestId), [
    { sessionId, expectedSurface: 'code' },
    {
      sessionId,
      expectedSurface: 'code',
      cursor: 'older-1',
      revision: 'revision-1',
      sourceRevision: 'source-1',
    },
    { sessionId, expectedSurface: 'code' },
  ]);
  assert.deepEqual(sessionHistoryPagingSnapshot(sessionId), {
    phase: 'ready',
    surface: 'code',
    revision: 'revision-2',
    sourceRevision: 'source-2',
    hasMore: false,
    hasNewer: false,
  });
  assert.deepEqual(
    useAppStore.getState().userMessagesBySession[sessionId]?.map((message) => message.content),
    ['fresh newest'],
  );
});

test('history paging paints one bounded newest window and reads older windows only on demand', async () => {
  const sessionId = 'history-paging-large-turn';
  useAppStore.setState({
    sessions: [
      {
        sessionId,
        projectRoot: '/project',
        provider: 'mock',
        reasoningMode: 'auto',
        permissionMode: 'accept-edits',
        agentMode: 'ama',
        surface: 'code',
        createdAt: 1_000,
        lastActivityAt: 1_000,
      },
    ],
    currentSessionId: sessionId,
    eventsBySession: {},
    userMessagesBySession: {},
  });

  const inputs: unknown[] = [];
  const pages = [
    {
      items: [
        { kind: 'history_truncation' as const, scope: 'history' as const, omittedItems: 2 },
        { kind: 'assistant' as const, text: 'new answer tail', canonicalIndex: 3 },
      ],
      page: {
        outcome: 'ready' as const,
        revision: 'revision-large',
        sourceRevision: 'source-large',
        hasMore: true,
        nextCursor: 'cursor-1',
        windowMode: 'replace' as const,
        hasNewer: false,
      },
    },
    {
      items: [
        { kind: 'history_truncation' as const, scope: 'history' as const, omittedItems: 1 },
        { kind: 'user' as const, content: 'new query', canonicalIndex: 2 },
      ],
      page: {
        outcome: 'ready' as const,
        revision: 'revision-large',
        sourceRevision: 'source-large',
        hasMore: true,
        nextCursor: 'cursor-2',
        windowMode: 'prepend' as const,
        hasNewer: false,
      },
    },
    {
      items: [
        { kind: 'user' as const, content: 'old query', canonicalIndex: 0 },
        { kind: 'assistant' as const, text: 'old answer', canonicalIndex: 1 },
      ],
      page: {
        outcome: 'ready' as const,
        revision: 'revision-large',
        sourceRevision: 'source-large',
        hasMore: false,
        windowMode: 'prepend' as const,
        hasNewer: false,
      },
    },
  ];
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    writable: true,
    value: {
      kodaxSpace: {
        invoke: mockHistoryInvoke(async (_channel: string, input: unknown) => {
          inputs.push(input);
          return { ok: true as const, data: pages[inputs.length - 1]! };
        }),
      },
    },
  });

  await restoreNewestSessionHistory(sessionId, 'code');
  assert.equal(inputs.length, 1, 'the newest restore must never chase an unbounded owning query');
  await loadOlderSessionHistory(sessionId);
  assert.deepEqual(
    useAppStore
      .getState()
      .userMessagesBySession[sessionId]?.filter((message) => message.hiddenHistoryAnchor !== true)
      .map((message) => message.content),
    ['new query'],
  );
  await loadOlderSessionHistory(sessionId);

  assert.deepEqual(
    useAppStore.getState().userMessagesBySession[sessionId]?.map((message) => message.content),
    ['old query', 'new query'],
  );
  assert.deepEqual(withoutHistoryRequestId(inputs[2]), {
    sessionId,
    expectedSurface: 'code',
    cursor: 'cursor-2',
    revision: 'revision-large',
    sourceRevision: 'source-large',
  });
  assert.equal(sessionHistoryPagingSnapshot(sessionId).hasMore, false);
});

test('history paging installs an explicitly requested older page while a live turn is open', async () => {
  const sessionId = 'history-paging-active-older-page';
  useAppStore.setState({
    sessions: [
      {
        sessionId,
        projectRoot: '/project',
        provider: 'mock',
        reasoningMode: 'auto',
        permissionMode: 'accept-edits',
        agentMode: 'ama',
        surface: 'code',
        createdAt: 1_000,
        lastActivityAt: 1_000,
      },
    ],
    currentSessionId: sessionId,
    eventsBySession: {},
    userMessagesBySession: {},
    pendingSendBySession: {},
  });
  const pages = [
    {
      items: [{ kind: 'user' as const, content: 'newest query', canonicalIndex: 2 }],
      page: {
        outcome: 'ready' as const,
        revision: 'revision-active-older',
        sourceRevision: 'source-active-older',
        hasMore: true,
        nextCursor: 'older-cursor',
        windowMode: 'replace' as const,
        hasNewer: false,
      },
    },
    {
      items: [{ kind: 'user' as const, content: 'older query', canonicalIndex: 0 }],
      page: {
        outcome: 'ready' as const,
        revision: 'revision-active-older',
        sourceRevision: 'source-active-older',
        hasMore: false,
        windowMode: 'prepend' as const,
        hasNewer: false,
      },
    },
  ];
  let calls = 0;
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    writable: true,
    value: {
      kodaxSpace: {
        invoke: mockHistoryInvoke(async () => ({
          ok: true as const,
          data: pages[calls++]!,
        })),
      },
    },
  });

  await restoreNewestSessionHistory(sessionId, 'code');
  useAppStore.setState({ pendingSendBySession: { [sessionId]: true } });
  await loadOlderSessionHistory(sessionId);

  assert.deepEqual(sessionHistoryPagingSnapshot(sessionId), {
    phase: 'ready',
    surface: 'code',
    revision: 'revision-active-older',
    sourceRevision: 'source-active-older',
    hasMore: false,
    hasNewer: false,
  });
  assert.deepEqual(
    useAppStore.getState().userMessagesBySession[sessionId]?.map((message) => message.content),
    ['older query', 'newest query'],
  );
});

test('history paging keeps a leading partial live turn ordered before and after its query page loads', async () => {
  const sessionId = 'history-paging-leading-partial';
  useAppStore.setState({
    sessions: [
      {
        sessionId,
        projectRoot: '/project',
        provider: 'mock',
        reasoningMode: 'auto',
        permissionMode: 'accept-edits',
        agentMode: 'ama',
        surface: 'code',
        createdAt: 1_000,
        lastActivityAt: 20_100,
      },
    ],
    currentSessionId: sessionId,
    eventsBySession: {},
    userMessagesBySession: {},
  });

  const store = useAppStore.getState();
  const liveToken = 'a'.repeat(32);
  const canonicalToken = 'b'.repeat(32);
  store.appendUserMessage(sessionId, 'older query', 10_000, [
    {
      id: 'older-image',
      kind: 'image',
      mediaType: 'image/png',
      label: 'evidence.png',
      bytes: 123,
      status: 'available',
      thumbnailUrl: `app://space/session-attachment/${liveToken}?variant=thumbnail`,
      previewUrl: `app://space/session-attachment/${liveToken}?variant=original`,
    },
  ]);
  store.appendEvent({
    kind: 'session_start',
    sessionId,
    provider: 'mock',
    turnId: 'turn-older',
  });
  store.appendEvent({ kind: 'text_delta', sessionId, text: 'older answer', sentAt: 10_100 });
  store.appendEvent({ kind: 'session_complete', sessionId, turnId: 'turn-older' });
  store.appendUserMessage(sessionId, 'newer query', 20_000);
  store.appendEvent({
    kind: 'session_start',
    sessionId,
    provider: 'mock',
    turnId: 'turn-newer',
  });
  store.appendEvent({ kind: 'text_delta', sessionId, text: 'newer answer', sentAt: 20_100 });
  store.appendEvent({ kind: 'session_complete', sessionId, turnId: 'turn-newer' });

  const pages = [
    {
      items: [
        { kind: 'history_truncation' as const, scope: 'history' as const, omittedItems: 55 },
        {
          kind: 'assistant' as const,
          text: 'older answer',
          sentAt: 10_100,
          canonicalIndex: 56,
          turnId: 'turn-older',
        },
        {
          kind: 'user' as const,
          content: 'newer query',
          sentAt: 20_000,
          canonicalIndex: 57,
          turnId: 'turn-newer',
          turnUserOrdinal: 0,
        },
        {
          kind: 'assistant' as const,
          text: 'newer answer',
          sentAt: 20_100,
          canonicalIndex: 58,
          turnId: 'turn-newer',
        },
      ],
      page: {
        outcome: 'ready' as const,
        revision: 'revision-leading-partial',
        sourceRevision: 'source-leading-partial',
        hasMore: true,
        nextCursor: 'older-query-page',
        windowMode: 'replace' as const,
        hasNewer: false,
      },
    },
    {
      items: [
        {
          kind: 'user' as const,
          content: 'older query',
          sentAt: 10_000,
          canonicalIndex: 55,
          historyTurnIndex: 55,
          historyBoundary: {
            boundaryId: 'older-answer-boundary',
            sourceRevision: 'source-leading-partial',
          },
          turnId: 'turn-older',
          attachments: [
            {
              id: 'older-image',
              kind: 'image' as const,
              mediaType: 'image/png' as const,
              bytes: 123,
              status: 'available' as const,
              thumbnailUrl: `app://space/session-attachment/${canonicalToken}?variant=thumbnail`,
              previewUrl: `app://space/session-attachment/${canonicalToken}?variant=original`,
            },
          ],
        },
      ],
      page: {
        outcome: 'ready' as const,
        revision: 'revision-leading-partial',
        sourceRevision: 'source-leading-partial',
        hasMore: false,
        windowMode: 'prepend' as const,
        hasNewer: false,
      },
    },
  ];
  let call = 0;
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    writable: true,
    value: {
      kodaxSpace: {
        invoke: mockHistoryInvoke(async () => ({ ok: true as const, data: pages[call++]! })),
      },
    },
  });

  const visibleSequence = (): readonly string[] => {
    const state = useAppStore.getState();
    return composeMessages({
      events: state.eventsBySession[sessionId] ?? [],
      userMessages: state.userMessagesBySession[sessionId] ?? [],
    }).flatMap((message) => {
      if (message.kind === 'user') return [`user:${message.content}`];
      if (message.kind === 'assistant_text') return [`assistant:${message.text}`];
      if (message.kind === 'system_notice' && message.lineageKind === 'history_truncation') {
        return ['notice:history_truncation'];
      }
      return [];
    });
  };
  const expected = [
    'notice:history_truncation',
    'user:older query',
    'assistant:older answer',
    'user:newer query',
    'assistant:newer answer',
  ];

  await restoreNewestSessionHistory(sessionId, 'code');
  assert.deepEqual(visibleSequence(), expected);

  await loadOlderSessionHistory(sessionId);
  assert.deepEqual(visibleSequence(), expected.slice(1));
  const olderOwner = useAppStore
    .getState()
    .userMessagesBySession[sessionId]?.find((message) => message.content === 'older query');
  assert.deepEqual(
    olderOwner && {
      canonicalIndex: olderOwner.canonicalIndex,
      historyTurnIndex: olderOwner.historyTurnIndex,
      historyBoundary: olderOwner.historyBoundary,
      turnId: olderOwner.turnId,
      turnUserOrdinal: olderOwner.turnUserOrdinal,
      restoredFromHistory: olderOwner.restoredFromHistory,
      attachmentId: olderOwner.attachments?.[0]?.id,
      attachmentPreviewUrl:
        olderOwner.attachments?.[0]?.status === 'available'
          ? olderOwner.attachments[0].previewUrl
          : undefined,
    },
    {
      canonicalIndex: 55,
      historyTurnIndex: 55,
      historyBoundary: {
        boundaryId: 'older-answer-boundary',
        sourceRevision: 'source-leading-partial',
      },
      turnId: 'turn-older',
      turnUserOrdinal: 0,
      restoredFromHistory: true,
      attachmentId: 'older-image',
      attachmentPreviewUrl: `app://space/session-attachment/${canonicalToken}?variant=original`,
    },
  );
});

test('history paging waits for Runtime instead of falling back to a full persisted read', async () => {
  const sessionId = 'history-paging-runtime-startup';
  useAppStore.setState({
    sessions: [
      {
        sessionId,
        projectRoot: '/project',
        provider: 'mock',
        reasoningMode: 'auto',
        permissionMode: 'accept-edits',
        agentMode: 'ama',
        surface: 'code',
        createdAt: 1_000,
        lastActivityAt: 1_000,
      },
    ],
    currentSessionId: sessionId,
    eventsBySession: {},
    userMessagesBySession: {},
  });

  let calls = 0;
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    writable: true,
    value: {
      kodaxSpace: {
        invoke: mockHistoryInvoke(async () => {
          calls += 1;
          return calls === 1
            ? {
                ok: true as const,
                data: { items: [], page: { outcome: 'runtime_unavailable' as const } },
              }
            : {
                ok: true as const,
                data: {
                  items: [{ kind: 'user' as const, content: 'ready query' }],
                  page: {
                    outcome: 'ready' as const,
                    revision: 'revision-ready',
                    sourceRevision: 'source-ready',
                    hasMore: false,
                    windowMode: 'replace' as const,
                    hasNewer: false,
                  },
                },
              };
        }),
      },
    },
  });

  await restoreNewestSessionHistory(sessionId, 'code');
  assert.equal(sessionHistoryPagingSnapshot(sessionId).phase, 'waiting');
  const deadline = Date.now() + 2_000;
  while (calls < 2 && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.equal(calls, 2);
  assert.equal(sessionHistoryPagingSnapshot(sessionId).phase, 'ready');
  assert.equal(
    useAppStore.getState().userMessagesBySession[sessionId]?.[0]?.content,
    'ready query',
  );
});

test('same Runtime turn users across pages retain both canonical queries and boundaries', async () => {
  const sessionId = 'history-paging-same-turn';
  useAppStore.setState({
    sessions: [
      {
        sessionId,
        projectRoot: '/project',
        provider: 'mock',
        reasoningMode: 'auto',
        permissionMode: 'accept-edits',
        agentMode: 'ama',
        surface: 'code',
        createdAt: 1_000,
        lastActivityAt: 1_000,
      },
    ],
    currentSessionId: sessionId,
    eventsBySession: {},
    userMessagesBySession: {},
  });
  const olderBoundary = { boundaryId: 'boundary-old', sourceRevision: 'source-shared' };
  const newerBoundary = { boundaryId: 'boundary-new', sourceRevision: 'source-shared' };
  const pages = [
    {
      items: [
        {
          kind: 'user' as const,
          content: 'newer query',
          canonicalIndex: 20,
          historyTurnIndex: 20,
          historyBoundary: newerBoundary,
          turnId: 'turn-1',
          // This deliberately collides with the older row to prove two durable rows are never
          // folded merely because a page-local ordinal was ambiguous.
          turnUserOrdinal: 0,
        },
        { kind: 'assistant' as const, text: 'newer answer', canonicalIndex: 21 },
      ],
      page: {
        outcome: 'ready' as const,
        revision: 'revision-shared',
        sourceRevision: 'source-shared',
        hasMore: true,
        nextCursor: 'older-shared',
        windowMode: 'replace' as const,
        hasNewer: false,
      },
    },
    {
      items: [
        {
          kind: 'user' as const,
          content: 'older query',
          canonicalIndex: 10,
          historyTurnIndex: 10,
          historyBoundary: olderBoundary,
          turnId: 'turn-1',
          turnUserOrdinal: 0,
        },
        { kind: 'assistant' as const, text: 'older answer', canonicalIndex: 11 },
      ],
      page: {
        outcome: 'ready' as const,
        revision: 'revision-shared',
        sourceRevision: 'source-shared',
        hasMore: false,
        windowMode: 'prepend' as const,
        hasNewer: false,
      },
    },
  ];
  let call = 0;
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    writable: true,
    value: {
      kodaxSpace: {
        invoke: mockHistoryInvoke(async () => ({ ok: true as const, data: pages[call++]! })),
      },
    },
  });

  await restoreNewestSessionHistory(sessionId, 'code');
  await loadOlderSessionHistory(sessionId);

  const state = useAppStore.getState();
  const users = state.userMessagesBySession[sessionId] ?? [];
  const events = state.eventsBySession[sessionId] ?? [];
  assert.deepEqual(
    users.map((message) => message.content),
    ['older query', 'newer query'],
  );
  assert.strictEqual(messageForSelectorTurn(users, 10)?.historyBoundary, olderBoundary);
  assert.strictEqual(messageForSelectorTurn(users, 20)?.historyBoundary, newerBoundary);
  assert.deepEqual(
    composeMessages({ events, userMessages: users })
      .filter((message) => message.kind === 'assistant_text')
      .map((message) => message.text),
    ['older answer', 'newer answer'],
  );
});

test('an accumulated older page retains canonical newest rows and the distinct live tail', async () => {
  const sessionId = 'history-paging-live-window';
  useAppStore.setState({
    sessions: [
      {
        sessionId,
        projectRoot: '/project',
        provider: 'mock',
        reasoningMode: 'auto',
        permissionMode: 'accept-edits',
        agentMode: 'ama',
        surface: 'code',
        createdAt: 1_000,
        lastActivityAt: 1_000,
      },
    ],
    currentSessionId: sessionId,
    eventsBySession: {},
    userMessagesBySession: {},
  });
  const store = useAppStore.getState();
  store.appendUserMessage(sessionId, 'newest live query', 2_000);
  store.appendEvent({ kind: 'text_delta', sessionId, text: 'newest live answer' });

  let call = 0;
  const pages = [
    {
      items: [{ kind: 'user' as const, content: 'newest canonical query', canonicalIndex: 20 }],
      page: {
        outcome: 'ready' as const,
        revision: 'revision-live-window',
        sourceRevision: 'source-live-window',
        hasMore: true,
        nextCursor: 'older-live-window',
        windowMode: 'replace' as const,
        hasNewer: false,
      },
    },
    {
      items: [
        { kind: 'user' as const, content: 'older canonical query', canonicalIndex: 10 },
        { kind: 'assistant' as const, text: 'older canonical answer', canonicalIndex: 11 },
      ],
      page: {
        outcome: 'ready' as const,
        revision: 'revision-live-window',
        sourceRevision: 'source-live-window',
        hasMore: false,
        windowMode: 'prepend' as const,
        hasNewer: false,
      },
    },
  ];
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    writable: true,
    value: {
      kodaxSpace: {
        invoke: mockHistoryInvoke(async () => ({ ok: true as const, data: pages[call++]! })),
      },
    },
  });

  await restoreNewestSessionHistory(sessionId, 'code');
  await loadOlderSessionHistory(sessionId);

  const next = useAppStore.getState();
  assert.deepEqual(
    (next.userMessagesBySession[sessionId] ?? []).map((message) => message.content),
    ['older canonical query', 'newest canonical query', 'newest live query'],
  );
  assert.deepEqual(
    composeMessages({
      events: next.eventsBySession[sessionId] ?? [],
      userMessages: next.userMessagesBySession[sessionId] ?? [],
    })
      .filter((message) => message.kind === 'assistant_text')
      .map((message) => message.text),
    ['older canonical answer', 'newest live answer'],
  );
});

test('deactivating a Session cancels Runtime startup retries and ignores late lifecycle work', async () => {
  const sessionId = 'history-paging-deactivate';
  useAppStore.setState({
    sessions: [],
    currentSessionId: sessionId,
    eventsBySession: {},
    userMessagesBySession: {},
  });
  let calls = 0;
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    writable: true,
    value: {
      kodaxSpace: {
        invoke: mockHistoryInvoke(async () => {
          calls += 1;
          return {
            ok: true as const,
            data: { items: [], page: { outcome: 'runtime_unavailable' as const } },
          };
        }),
      },
    },
  });

  await restoreNewestSessionHistory(sessionId, 'code');
  deactivateSessionHistoryPaging(sessionId);
  await new Promise((resolve) => setTimeout(resolve, 250));
  assert.equal(calls, 1);
});

test('reactivating a Session does not reuse an in-flight request from its stale lifecycle', async () => {
  const sessionId = 'history-paging-reactivate';
  useAppStore.setState({
    sessions: [
      {
        sessionId,
        projectRoot: '/project',
        provider: 'mock',
        reasoningMode: 'auto',
        permissionMode: 'accept-edits',
        agentMode: 'ama',
        surface: 'code',
        createdAt: 1_000,
        lastActivityAt: 1_000,
      },
    ],
    currentSessionId: sessionId,
    eventsBySession: {},
    userMessagesBySession: {},
  });
  let calls = 0;
  let resolveStale!: (value: {
    ok: true;
    data: { items: never[]; page: { outcome: 'runtime_unavailable' } };
  }) => void;
  const staleResponse = new Promise<{
    ok: true;
    data: { items: never[]; page: { outcome: 'runtime_unavailable' } };
  }>((resolve) => {
    resolveStale = resolve;
  });
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    writable: true,
    value: {
      kodaxSpace: {
        invoke: mockHistoryInvoke(async () => {
          calls += 1;
          if (calls === 1) return staleResponse;
          return {
            ok: true as const,
            data: {
              items: [{ kind: 'user' as const, content: 'fresh lifecycle query' }],
              page: {
                outcome: 'ready' as const,
                revision: 'revision-fresh',
                sourceRevision: 'source-fresh',
                hasMore: false,
                windowMode: 'replace' as const,
                hasNewer: false,
              },
            },
          };
        }),
      },
    },
  });

  const staleLoad = restoreNewestSessionHistory(sessionId, 'code');
  deactivateSessionHistoryPaging(sessionId);
  const freshLoad = restoreNewestSessionHistory(sessionId, 'code');
  assert.equal(calls, 2);

  resolveStale({
    ok: true,
    data: { items: [], page: { outcome: 'runtime_unavailable' } },
  });
  await Promise.all([staleLoad, freshLoad]);

  assert.equal(sessionHistoryPagingSnapshot(sessionId).phase, 'ready');
  assert.equal(
    useAppStore.getState().userMessagesBySession[sessionId]?.[0]?.content,
    'fresh lifecycle query',
  );
});

test('history-window replacement does not resurrect an optimistic query after rollback', () => {
  const sessionId = 'history-paging-rollback-baseline';
  useAppStore.setState({
    sessions: [
      {
        sessionId,
        projectRoot: '/project',
        provider: 'mock',
        reasoningMode: 'auto',
        permissionMode: 'accept-edits',
        agentMode: 'ama',
        surface: 'code',
        createdAt: 1_000,
        lastActivityAt: 1_000,
      },
    ],
    currentSessionId: sessionId,
    eventsBySession: {},
    userMessagesBySession: {},
  });
  const store = useAppStore.getState();
  store.prependSessionHistory(
    sessionId,
    [{ kind: 'user', content: 'durable newest', canonicalIndex: 10 }],
    1_000,
    { replaceLoadedWindow: true },
  );
  const optimisticMessageId = store.appendUserMessage(sessionId, 'optimistic ghost', 2_000);
  assert.ok(optimisticMessageId);
  store.rollbackUserMessage(sessionId, optimisticMessageId);
  store.prependSessionHistory(
    sessionId,
    [{ kind: 'user', content: 'durable older', canonicalIndex: 5 }],
    1_000,
    { replaceLoadedWindow: true },
  );

  assert.deepEqual(
    (useAppStore.getState().userMessagesBySession[sessionId] ?? []).map(
      (message) => message.content,
    ),
    ['durable older'],
  );
});

test('history-window replacement does not resurrect a query converted back to queued', () => {
  const sessionId = 'history-paging-queued-baseline';
  useAppStore.setState({
    sessions: [
      {
        sessionId,
        projectRoot: '/project',
        provider: 'mock',
        reasoningMode: 'auto',
        permissionMode: 'accept-edits',
        agentMode: 'ama',
        surface: 'code',
        createdAt: 1_000,
        lastActivityAt: 1_000,
      },
    ],
    currentSessionId: sessionId,
    eventsBySession: {},
    userMessagesBySession: {},
    queuedUserMessagesBySession: {},
  });
  const store = useAppStore.getState();
  store.prependSessionHistory(
    sessionId,
    [{ kind: 'user', content: 'durable newest', canonicalIndex: 10 }],
    1_000,
    { replaceLoadedWindow: true },
  );
  const optimisticMessageId = store.appendUserMessage(sessionId, 'queued query', 2_000);
  assert.ok(optimisticMessageId);
  assert.notEqual(
    store.convertUserMessageToQueued(sessionId, optimisticMessageId, {
      content: 'queued query',
      queueMode: 'after-turn',
      sentAt: 2_000,
    }),
    null,
  );
  store.prependSessionHistory(
    sessionId,
    [{ kind: 'user', content: 'durable older', canonicalIndex: 5 }],
    1_000,
    { replaceLoadedWindow: true },
  );

  const next = useAppStore.getState();
  assert.deepEqual(
    (next.userMessagesBySession[sessionId] ?? []).map((message) => message.content),
    ['durable older'],
  );
  assert.deepEqual(
    (next.queuedUserMessagesBySession[sessionId] ?? []).map((message) => message.content),
    ['queued query'],
  );
});

test('same-turn users with different attachment identities fail open instead of merging', () => {
  const sessionId = 'history-paging-ambiguous-live-identity';
  useAppStore.setState({
    sessions: [
      {
        sessionId,
        projectRoot: '/project',
        provider: 'mock',
        reasoningMode: 'auto',
        permissionMode: 'accept-edits',
        agentMode: 'ama',
        surface: 'code',
        createdAt: 1_000,
        lastActivityAt: 1_000,
      },
    ],
    currentSessionId: sessionId,
    eventsBySession: {},
    userMessagesBySession: {},
  });
  const store = useAppStore.getState();
  const liveToken = 'c'.repeat(32);
  const canonicalToken = 'd'.repeat(32);
  store.appendUserMessage(sessionId, 'same visible query', 1_000, [
    {
      id: 'live-image',
      kind: 'image',
      mediaType: 'image/png',
      status: 'available',
      thumbnailUrl: `app://space/session-attachment/${liveToken}?variant=thumbnail`,
      previewUrl: `app://space/session-attachment/${liveToken}?variant=original`,
    },
  ]);
  store.appendEvent({
    kind: 'session_start',
    sessionId,
    provider: 'mock',
    turnId: 'turn-shared',
  });
  store.appendEvent({ kind: 'text_delta', sessionId, text: 'root answer' });
  store.appendEvent({ kind: 'session_complete', sessionId, turnId: 'turn-shared' });
  store.prependSessionHistory(
    sessionId,
    [
      {
        kind: 'user',
        content: 'same visible query',
        canonicalIndex: 10,
        turnId: 'turn-shared',
        attachments: [
          {
            id: 'different-canonical-image',
            kind: 'image',
            mediaType: 'image/png',
            status: 'available',
            thumbnailUrl: `app://space/session-attachment/${canonicalToken}?variant=thumbnail`,
            previewUrl: `app://space/session-attachment/${canonicalToken}?variant=original`,
          },
        ],
      },
      { kind: 'assistant', text: 'later answer', canonicalIndex: 11 },
    ],
    1_000,
    { replaceLoadedWindow: true },
  );

  assert.deepEqual(
    (useAppStore.getState().userMessagesBySession[sessionId] ?? []).map((message) => ({
      content: message.content,
      attachmentId: message.attachments?.[0]?.id,
    })),
    [
      { content: 'same visible query', attachmentId: 'different-canonical-image' },
      { content: 'same visible query', attachmentId: 'live-image' },
    ],
  );
});

test('paging cache eviction releases restored store rows and reselect reloads canonically', async () => {
  const sessionIds = Array.from({ length: 33 }, (_, index) => `history-paging-cache-${index}`);
  useAppStore.setState({
    sessions: sessionIds.map((sessionId) => ({
      sessionId,
      projectRoot: '/project',
      provider: 'mock',
      reasoningMode: 'auto' as const,
      permissionMode: 'accept-edits' as const,
      agentMode: 'ama' as const,
      surface: 'code' as const,
      createdAt: 1_000,
      lastActivityAt: 1_000,
    })),
    currentSessionId: sessionIds.at(-1)!,
    eventsBySession: {},
    userMessagesBySession: {},
  });
  const calls = new Map<string, number>();
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    writable: true,
    value: {
      kodaxSpace: {
        invoke: mockHistoryInvoke(
          async (_channel: string, input: { readonly sessionId: string }) => {
            calls.set(input.sessionId, (calls.get(input.sessionId) ?? 0) + 1);
            return {
              ok: true as const,
              data: {
                items: [{ kind: 'user' as const, content: `query:${input.sessionId}` }],
                page: {
                  outcome: 'ready' as const,
                  revision: `revision:${input.sessionId}`,
                  sourceRevision: `source:${input.sessionId}`,
                  hasMore: false,
                  windowMode: 'replace' as const,
                  hasNewer: false,
                },
              },
            };
          },
        ),
      },
    },
  });

  for (const sessionId of sessionIds) {
    await restoreNewestSessionHistory(sessionId, 'code');
    deactivateSessionHistoryPaging(sessionId);
  }
  const evicted = sessionIds[0]!;
  assert.equal(hasReadySessionHistory(evicted), false);
  assert.deepEqual(useAppStore.getState().userMessagesBySession[evicted], []);

  await restoreNewestSessionHistory(evicted, 'code');
  deactivateSessionHistoryPaging(evicted);
  assert.equal(calls.get(evicted), 2);
  assert.deepEqual(
    useAppStore.getState().userMessagesBySession[evicted]?.map((message) => message.content),
    [`query:${evicted}`],
  );
});

test('paging cache does not evict a background Session with known Runtime activity', async () => {
  const sessionIds = Array.from({ length: 34 }, (_, index) => `history-paging-active-${index}`);
  const protectedSessionId = sessionIds[0]!;
  useAppStore.setState({
    sessions: sessionIds.map((sessionId) => ({
      sessionId,
      projectRoot: '/project',
      provider: 'mock',
      reasoningMode: 'auto' as const,
      permissionMode: 'accept-edits' as const,
      agentMode: 'ama' as const,
      surface: 'code' as const,
      createdAt: 1_000,
      lastActivityAt: 1_000,
    })),
    currentSessionId: sessionIds.at(-1)!,
    eventsBySession: {},
    userMessagesBySession: {},
    liveProjectionBySession: {
      [protectedSessionId]: {
        sessionId: protectedSessionId,
        projectionRevision: 1,
        cursor: { runtimeId: 'rt_1', seq: 1 },
        transcriptRevision: 'tx_1',
        activeRun: {
          runId: 'run_active',
          sessionId: protectedSessionId,
          phase: 'running',
          startedAt: 1,
        },
        queuedRuns: [],
        activeTools: [],
        todos: [],
        queuedInputs: [],
        interactions: [],
      },
    },
  });
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    writable: true,
    value: {
      kodaxSpace: {
        invoke: mockHistoryInvoke(
          async (_channel: string, input: { readonly sessionId: string }) => ({
            ok: true as const,
            data: {
              items: [{ kind: 'user' as const, content: `query:${input.sessionId}` }],
              page: {
                outcome: 'ready' as const,
                revision: `revision:${input.sessionId}`,
                sourceRevision: `source:${input.sessionId}`,
                hasMore: false,
                windowMode: 'replace' as const,
                hasNewer: false,
              },
            },
          }),
        ),
      },
    },
  });

  for (const sessionId of sessionIds) {
    await restoreNewestSessionHistory(sessionId, 'code');
    deactivateSessionHistoryPaging(sessionId);
  }

  assert.equal(hasReadySessionHistory(protectedSessionId), true);
  assert.deepEqual(
    useAppStore
      .getState()
      .userMessagesBySession[protectedSessionId]?.map((message) => message.content),
    [`query:${protectedSessionId}`],
  );
});

test('paging cache remains hard-bounded when every cached Session has Runtime activity', async () => {
  const sessionIds = Array.from({ length: 33 }, (_, index) => `history-paging-all-active-${index}`);
  useAppStore.setState({
    sessions: sessionIds.map((sessionId) => ({
      sessionId,
      projectRoot: '/project',
      provider: 'mock',
      reasoningMode: 'auto' as const,
      permissionMode: 'accept-edits' as const,
      agentMode: 'ama' as const,
      surface: 'code' as const,
      createdAt: 1_000,
      lastActivityAt: 1_000,
    })),
    currentSessionId: sessionIds.at(-1)!,
    eventsBySession: {},
    userMessagesBySession: {},
    liveProjectionBySession: Object.fromEntries(
      sessionIds.map((sessionId, index) => [
        sessionId,
        {
          sessionId,
          projectionRevision: 1,
          cursor: { runtimeId: 'rt_1', seq: index + 1 },
          transcriptRevision: `tx_${index}`,
          activeRun: {
            runId: `run_${index}`,
            sessionId,
            phase: 'running' as const,
            startedAt: 1,
          },
          queuedRuns: [],
          activeTools: [],
          todos: [],
          queuedInputs: [],
          interactions: [],
        },
      ]),
    ),
  });
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    writable: true,
    value: {
      kodaxSpace: {
        invoke: mockHistoryInvoke(
          async (_channel: string, input: { readonly sessionId: string }) => ({
            ok: true as const,
            data: {
              items: [{ kind: 'user' as const, content: `query:${input.sessionId}` }],
              page: {
                outcome: 'ready' as const,
                revision: `revision:${input.sessionId}`,
                sourceRevision: `source:${input.sessionId}`,
                hasMore: false,
                windowMode: 'replace' as const,
                hasNewer: false,
              },
            },
          }),
        ),
      },
    },
  });

  for (const sessionId of sessionIds) {
    await restoreNewestSessionHistory(sessionId, 'code');
    deactivateSessionHistoryPaging(sessionId);
  }

  assert.equal(sessionIds.filter(hasReadySessionHistory).length, 32);
  assert.equal(hasReadySessionHistory(sessionIds[0]!), false);
  assert.equal(hasReadySessionHistory(sessionIds.at(-1)!), true);
});

test('an older-page request waits for an in-flight newest revalidation and then prepends', async () => {
  const sessionId = 'history-paging-older-after-newest';
  useAppStore.setState({
    sessions: [
      {
        sessionId,
        projectRoot: '/project',
        provider: 'mock',
        reasoningMode: 'auto',
        permissionMode: 'accept-edits',
        agentMode: 'ama',
        surface: 'code',
        createdAt: 1_000,
        lastActivityAt: 1_000,
      },
    ],
    currentSessionId: sessionId,
    eventsBySession: {},
    userMessagesBySession: {},
  });
  let calls = 0;
  let releaseNewest!: () => void;
  const newestHeld = new Promise<void>((resolve) => {
    releaseNewest = resolve;
  });
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    writable: true,
    value: {
      kodaxSpace: {
        invoke: mockHistoryInvoke(async (_channel: string, input: { readonly cursor?: string }) => {
          calls += 1;
          if (calls === 2) await newestHeld;
          if (calls === 3) {
            assert.equal(input.cursor, 'older-cursor');
            return {
              ok: true as const,
              data: {
                items: [
                  { kind: 'user' as const, content: 'older query', canonicalIndex: 0 },
                  { kind: 'assistant' as const, text: 'older answer', canonicalIndex: 1 },
                ],
                page: {
                  outcome: 'ready' as const,
                  revision: 'revision-newest',
                  sourceRevision: 'source-newest',
                  hasMore: false,
                  windowMode: 'prepend' as const,
                  hasNewer: false,
                },
              },
            };
          }
          return {
            ok: true as const,
            data: {
              items: [
                { kind: 'user' as const, content: 'latest query', canonicalIndex: 2 },
                { kind: 'assistant' as const, text: 'latest answer', canonicalIndex: 3 },
              ],
              page: {
                outcome: 'ready' as const,
                revision: 'revision-newest',
                sourceRevision: 'source-newest',
                hasMore: true,
                nextCursor: 'older-cursor',
                windowMode: 'replace' as const,
                hasNewer: false,
              },
            },
          };
        }),
      },
    },
  });

  await restoreNewestSessionHistory(sessionId, 'code');
  const newest = revalidateNewestSessionHistory(sessionId, 'code');
  await Promise.resolve();
  assert.equal(calls, 2);
  const older = loadOlderSessionHistory(sessionId);
  releaseNewest();
  await Promise.all([newest, older]);

  assert.equal(calls, 3);
  assert.deepEqual(
    useAppStore.getState().userMessagesBySession[sessionId]?.map((message) => message.content),
    ['older query', 'latest query'],
  );
});

test('a retained newest revalidation stitches older pages until canonical overlap before replacing', async () => {
  const sessionId = 'history-paging-stitches-newest-overlap';
  useAppStore.setState({
    sessions: [
      {
        sessionId,
        projectRoot: '/project',
        provider: 'mock',
        reasoningMode: 'auto',
        permissionMode: 'accept-edits',
        agentMode: 'ama',
        surface: 'code',
        createdAt: 1_000,
        lastActivityAt: 1_000,
      },
    ],
    currentSessionId: sessionId,
    eventsBySession: {},
    userMessagesBySession: {},
  });
  const inputs: unknown[] = [];
  let calls = 0;
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    writable: true,
    value: {
      kodaxSpace: {
        invoke: mockHistoryInvoke(async (_channel: string, input: { readonly cursor?: string }) => {
          inputs.push(input);
          calls += 1;
          if (calls === 1) {
            return {
              ok: true as const,
              data: {
                items: [
                  {
                    kind: 'user' as const,
                    content: 'loaded query',
                    entryId: 'entry-loaded-user',
                    turnId: 'turn-loaded',
                    turnUserOrdinal: 0,
                    canonicalIndex: 64,
                  },
                  {
                    kind: 'assistant' as const,
                    text: 'loaded answer',
                    entryId: 'entry-loaded-assistant',
                    turnId: 'turn-loaded',
                    canonicalIndex: 65,
                  },
                ],
                conversation: { status: 'resolved' as const },
                page: {
                  outcome: 'ready' as const,
                  revision: 'revision-before-append',
                  sourceRevision: 'source-before-append',
                  hasMore: false,
                  windowMode: 'replace' as const,
                  hasNewer: false,
                },
              },
            };
          }
          if (calls === 2) {
            assert.equal(input.cursor, undefined);
            return {
              ok: true as const,
              data: {
                items: [
                  {
                    kind: 'history_truncation' as const,
                    scope: 'history' as const,
                    omittedItems: 192,
                  },
                  {
                    kind: 'user' as const,
                    content: 'newest query',
                    entryId: 'entry-newest-user',
                    turnId: 'turn-newest',
                    turnUserOrdinal: 0,
                    canonicalIndex: 192,
                  },
                  {
                    kind: 'assistant' as const,
                    text: 'newest answer',
                    entryId: 'entry-newest-assistant',
                    turnId: 'turn-newest',
                    canonicalIndex: 193,
                  },
                ],
                conversation: { status: 'resolved' as const },
                page: {
                  outcome: 'ready' as const,
                  revision: 'revision-after-append',
                  sourceRevision: 'source-after-append',
                  hasMore: true,
                  nextCursor: 'cursor-middle',
                  windowMode: 'replace' as const,
                  hasNewer: false,
                },
              },
            };
          }
          if (calls === 3) {
            assert.equal(input.cursor, 'cursor-middle');
            assert.deepEqual(
              useAppStore
                .getState()
                .userMessagesBySession[sessionId]?.map((message) => message.content),
              ['loaded query'],
              'unproven newest and middle pages must remain staged',
            );
            return {
              ok: true as const,
              data: {
                items: [
                  {
                    kind: 'history_truncation' as const,
                    scope: 'history' as const,
                    omittedItems: 128,
                  },
                  {
                    kind: 'user' as const,
                    content: 'middle query',
                    entryId: 'entry-middle-user',
                    turnId: 'turn-middle',
                    turnUserOrdinal: 0,
                    canonicalIndex: 128,
                  },
                  {
                    kind: 'assistant' as const,
                    text: 'middle answer',
                    entryId: 'entry-middle-assistant',
                    turnId: 'turn-middle',
                    canonicalIndex: 129,
                  },
                ],
                conversation: { status: 'resolved' as const },
                page: {
                  outcome: 'ready' as const,
                  revision: 'revision-after-append',
                  sourceRevision: 'source-after-append',
                  hasMore: true,
                  nextCursor: 'cursor-overlap',
                  windowMode: 'prepend' as const,
                  hasNewer: false,
                },
              },
            };
          }
          assert.equal(input.cursor, 'cursor-overlap');
          assert.deepEqual(
            useAppStore
              .getState()
              .userMessagesBySession[sessionId]?.map((message) => message.content),
            ['loaded query'],
            'no staged page may install before exact overlap proof',
          );
          return {
            ok: true as const,
            data: {
              items: [
                {
                  kind: 'history_truncation' as const,
                  scope: 'history' as const,
                  omittedItems: 64,
                },
                {
                  kind: 'user' as const,
                  content: 'loaded query',
                  entryId: 'entry-loaded-user',
                  turnId: 'turn-loaded',
                  turnUserOrdinal: 0,
                  canonicalIndex: 64,
                },
                {
                  kind: 'assistant' as const,
                  text: 'loaded answer',
                  entryId: 'entry-loaded-assistant',
                  turnId: 'turn-loaded',
                  canonicalIndex: 65,
                },
              ],
              conversation: { status: 'resolved' as const },
              page: {
                outcome: 'ready' as const,
                revision: 'revision-after-append',
                sourceRevision: 'source-after-append',
                hasMore: true,
                nextCursor: 'cursor-before-loaded',
                windowMode: 'prepend' as const,
                hasNewer: false,
              },
            },
          };
        }),
      },
    },
  });

  await restoreNewestSessionHistory(sessionId, 'code');
  await revalidateNewestSessionHistory(sessionId, 'code');

  assert.equal(calls, 4);
  assert.deepEqual(inputs.slice(1).map(withoutHistoryRequestId), [
    { sessionId, expectedSurface: 'code' },
    {
      sessionId,
      expectedSurface: 'code',
      cursor: 'cursor-middle',
      revision: 'revision-after-append',
      sourceRevision: 'source-after-append',
    },
    {
      sessionId,
      expectedSurface: 'code',
      cursor: 'cursor-overlap',
      revision: 'revision-after-append',
      sourceRevision: 'source-after-append',
    },
  ]);
  assert.deepEqual(
    useAppStore
      .getState()
      .userMessagesBySession[sessionId]?.filter((message) => message.hiddenHistoryAnchor !== true)
      .map((message) => message.content),
    ['loaded query', 'middle query', 'newest query'],
  );
  assert.equal(sessionHistoryPagingSnapshot(sessionId).nextCursor, 'cursor-before-loaded');
});

test('a retained newest revalidation accepts an assistant-only canonical overlap page', async () => {
  const sessionId = 'history-paging-stitches-assistant-overlap';
  useAppStore.setState({
    sessions: [
      {
        sessionId,
        projectRoot: '/project',
        provider: 'mock',
        reasoningMode: 'auto',
        permissionMode: 'accept-edits',
        agentMode: 'ama',
        surface: 'code',
        createdAt: 1_000,
        lastActivityAt: 1_000,
      },
    ],
    currentSessionId: sessionId,
    eventsBySession: {},
    userMessagesBySession: {},
  });
  let calls = 0;
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    writable: true,
    value: {
      kodaxSpace: {
        invoke: mockHistoryInvoke(async (_channel: string, input: { readonly cursor?: string }) => {
          calls += 1;
          if (calls === 1) {
            return {
              ok: true as const,
              data: {
                items: [
                  {
                    kind: 'user' as const,
                    content: 'loaded query',
                    entryId: 'entry-loaded-user',
                    turnId: 'turn-loaded',
                    turnUserOrdinal: 0,
                    canonicalIndex: 64,
                  },
                  {
                    kind: 'assistant' as const,
                    text: 'loaded answer',
                    entryId: 'entry-loaded-assistant',
                    turnId: 'turn-loaded',
                    canonicalIndex: 65,
                  },
                ],
                conversation: { status: 'resolved' as const },
                page: {
                  outcome: 'ready' as const,
                  revision: 'revision-before-append',
                  sourceRevision: 'source-before-append',
                  hasMore: false,
                  windowMode: 'replace' as const,
                  hasNewer: false,
                },
              },
            };
          }
          if (calls === 2) {
            assert.equal(input.cursor, undefined);
            return {
              ok: true as const,
              data: {
                items: [
                  {
                    kind: 'history_truncation' as const,
                    scope: 'history' as const,
                    omittedItems: 192,
                  },
                  {
                    kind: 'user' as const,
                    content: 'newest query',
                    entryId: 'entry-newest-user',
                    turnId: 'turn-newest',
                    turnUserOrdinal: 0,
                    canonicalIndex: 192,
                  },
                ],
                conversation: { status: 'resolved' as const },
                page: {
                  outcome: 'ready' as const,
                  revision: 'revision-after-append',
                  sourceRevision: 'source-after-append',
                  hasMore: true,
                  nextCursor: 'cursor-assistant-overlap',
                  windowMode: 'replace' as const,
                  hasNewer: false,
                },
              },
            };
          }
          assert.equal(calls, 3, 'assistant identity should finish the bounded overlap scan');
          assert.equal(input.cursor, 'cursor-assistant-overlap');
          return {
            ok: true as const,
            data: {
              items: [
                {
                  kind: 'history_truncation' as const,
                  scope: 'history' as const,
                  omittedItems: 65,
                },
                {
                  kind: 'assistant' as const,
                  text: 'loaded answer refreshed',
                  entryId: 'entry-loaded-assistant',
                  turnId: 'turn-loaded',
                  canonicalIndex: 65,
                },
              ],
              conversation: { status: 'resolved' as const },
              page: {
                outcome: 'ready' as const,
                revision: 'revision-after-append',
                sourceRevision: 'source-after-append',
                hasMore: true,
                nextCursor: 'cursor-before-loaded',
                windowMode: 'prepend' as const,
                hasNewer: false,
              },
            },
          };
        }),
      },
    },
  });

  await restoreNewestSessionHistory(sessionId, 'code');
  await revalidateNewestSessionHistory(sessionId, 'code');

  assert.equal(calls, 3);
  const state = useAppStore.getState();
  const transcript = composeMessages({
    events: state.eventsBySession[sessionId] ?? [],
    userMessages: state.userMessagesBySession[sessionId] ?? [],
  });
  assert.deepEqual(
    transcript.flatMap((message) => {
      if (message.kind === 'user') return [`user:${message.content}`];
      if (message.kind === 'assistant_text') return [`assistant:${message.text}`];
      return [];
    }),
    ['user:loaded query', 'assistant:loaded answer refreshed', 'user:newest query'],
  );
  assert.equal(sessionHistoryPagingSnapshot(sessionId).nextCursor, 'cursor-before-loaded');
});

test('a root scan without overlap resets newest before replacing a changed lineage', async () => {
  const sessionId = 'history-paging-newest-root-proof';
  useAppStore.setState({
    sessions: [
      {
        sessionId,
        projectRoot: '/project',
        provider: 'mock',
        reasoningMode: 'auto',
        permissionMode: 'accept-edits',
        agentMode: 'ama',
        surface: 'code',
        createdAt: 1_000,
        lastActivityAt: 1_000,
      },
    ],
    currentSessionId: sessionId,
    eventsBySession: {},
    userMessagesBySession: {},
  });
  const inputs: { readonly cursor?: string }[] = [];
  let calls = 0;
  const oldItems = [
    {
      kind: 'user' as const,
      content: 'old lineage query',
      entryId: 'entry-old-user',
      turnId: 'turn-old',
      turnUserOrdinal: 0,
      canonicalIndex: 64,
    },
  ];
  const newestItems = [
    { kind: 'history_truncation' as const, scope: 'history' as const, omittedItems: 64 },
    {
      kind: 'user' as const,
      // Same canonical position and text is not overlap proof when physical identity changed.
      content: 'old lineage query',
      entryId: 'entry-new-user',
      turnId: 'turn-new',
      turnUserOrdinal: 0,
      canonicalIndex: 64,
    },
  ];
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    writable: true,
    value: {
      kodaxSpace: {
        invoke: mockHistoryInvoke(async (_channel: string, input: { readonly cursor?: string }) => {
          inputs.push(input);
          calls += 1;
          if (calls === 1) {
            return {
              ok: true as const,
              data: {
                items: oldItems,
                conversation: { status: 'resolved' as const },
                page: {
                  outcome: 'ready' as const,
                  revision: 'revision-old',
                  sourceRevision: 'source-old',
                  hasMore: false,
                  windowMode: 'replace' as const,
                  hasNewer: false,
                },
              },
            };
          }
          if (calls === 3) {
            assert.equal(input.cursor, 'cursor-scan-root');
            return {
              ok: true as const,
              data: {
                items: [
                  {
                    kind: 'user' as const,
                    content: 'new lineage root',
                    entryId: 'entry-new-root',
                    turnId: 'turn-new-root',
                    turnUserOrdinal: 0,
                    canonicalIndex: 0,
                  },
                ],
                conversation: { status: 'resolved' as const },
                page: {
                  outcome: 'ready' as const,
                  revision: 'revision-new',
                  sourceRevision: 'source-new',
                  hasMore: false,
                  windowMode: 'prepend' as const,
                  hasNewer: false,
                },
              },
            };
          }
          assert.equal(input.cursor, undefined);
          return {
            ok: true as const,
            data: {
              items: newestItems,
              conversation: { status: 'resolved' as const },
              page: {
                outcome: 'ready' as const,
                revision: 'revision-new',
                sourceRevision: 'source-new',
                hasMore: true,
                nextCursor: 'cursor-scan-root',
                windowMode: 'replace' as const,
                hasNewer: false,
              },
            },
          };
        }),
      },
    },
  });

  await restoreNewestSessionHistory(sessionId, 'code');
  await revalidateNewestSessionHistory(sessionId, 'code');

  assert.equal(calls, 4);
  assert.deepEqual(
    inputs.map((input) => input.cursor),
    [undefined, undefined, 'cursor-scan-root', undefined],
  );
  assert.deepEqual(
    useAppStore
      .getState()
      .userMessagesBySession[sessionId]?.filter((message) => message.hiddenHistoryAnchor !== true)
      .map((message) => message.content),
    ['old lineage query'],
  );
  assert.equal(
    useAppStore
      .getState()
      .userMessagesBySession[sessionId]?.find((message) => message.hiddenHistoryAnchor !== true)
      ?.entryId,
    'entry-new-user',
  );
  assert.equal(sessionHistoryPagingSnapshot(sessionId).nextCursor, 'cursor-scan-root');
});

test('a newest stitch that reaches its scan cap fails visibly without installing staged pages', async () => {
  const sessionId = 'history-paging-newest-stitch-cap';
  useAppStore.setState({
    sessions: [
      {
        sessionId,
        projectRoot: '/project',
        provider: 'mock',
        reasoningMode: 'auto',
        permissionMode: 'accept-edits',
        agentMode: 'ama',
        surface: 'code',
        createdAt: 1_000,
        lastActivityAt: 1_000,
      },
    ],
    currentSessionId: sessionId,
    eventsBySession: {},
    userMessagesBySession: {},
  });
  let calls = 0;
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    writable: true,
    value: {
      kodaxSpace: {
        invoke: mockHistoryInvoke(async (_channel: string, input: { readonly cursor?: string }) => {
          calls += 1;
          if (calls === 1) {
            return {
              ok: true as const,
              data: {
                items: [
                  {
                    kind: 'user' as const,
                    content: 'loaded query before capped scan',
                    entryId: 'entry-loaded-before-cap',
                    turnId: 'turn-loaded-before-cap',
                    turnUserOrdinal: 0,
                    canonicalIndex: 0,
                  },
                ],
                conversation: { status: 'resolved' as const },
                page: {
                  outcome: 'ready' as const,
                  revision: 'revision-before-cap',
                  sourceRevision: 'source-before-cap',
                  hasMore: false,
                  windowMode: 'replace' as const,
                  hasNewer: false,
                },
              },
            };
          }
          const scanPage = calls - 2;
          assert.equal(input.cursor, scanPage === 0 ? undefined : `cursor-cap-${scanPage}`);
          return {
            ok: true as const,
            data: {
              items: [
                { kind: 'history_truncation' as const, scope: 'history' as const, omittedItems: 1 },
                {
                  kind: 'user' as const,
                  content: `unproven staged query ${scanPage}`,
                  entryId: `entry-staged-cap-${scanPage}`,
                  turnId: `turn-staged-cap-${scanPage}`,
                  turnUserOrdinal: 0,
                  canonicalIndex: 1_000 - scanPage * 2,
                },
              ],
              conversation: { status: 'resolved' as const },
              page: {
                outcome: 'ready' as const,
                revision: 'revision-capped-scan',
                sourceRevision: 'source-capped-scan',
                hasMore: true,
                nextCursor: `cursor-cap-${scanPage + 1}`,
                windowMode: scanPage === 0 ? ('replace' as const) : ('prepend' as const),
                hasNewer: false,
              },
            },
          };
        }),
      },
    },
  });

  await restoreNewestSessionHistory(sessionId, 'code');
  await revalidateNewestSessionHistory(sessionId, 'code');
  await new Promise((resolve) => setTimeout(resolve, 150));

  assert.equal(calls, 17, 'one newest page plus fifteen bounded older pages exhaust the cap');
  assert.equal(sessionHistoryPagingSnapshot(sessionId).phase, 'error');
  assert.deepEqual(
    useAppStore.getState().userMessagesBySession[sessionId]?.map((message) => message.content),
    ['loaded query before capped scan'],
    'no unproven staged page may become visible',
  );
});
