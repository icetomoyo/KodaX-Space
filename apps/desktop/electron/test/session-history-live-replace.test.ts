import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';

import type {
  SessionMeta,
  SpaceRuntimeProfileProjectionT,
  SpaceSessionLiveProjectionT,
} from '@kodax-space/space-ipc-schema';
import { composeMessages } from '../../renderer/src/features/session/composeMessages.js';
import { deriveSessionStatus } from '../../renderer/src/features/session/useSessionStatus.js';
import { useAppStore } from '../../renderer/src/store/appStore.js';
import { createRuntimeProjectionState } from '../../renderer/src/store/runtimeProjectionState.js';

const sessionId = 's_repro';

const sidebarSession: SessionMeta = {
  sessionId,
  projectRoot: '/repo',
  provider: 'mock',
  reasoningMode: 'auto',
  permissionMode: 'accept-edits',
  agentMode: 'ama',
  surface: 'code',
  createdAt: 100,
  lastActivityAt: 100,
};

const profile: SpaceRuntimeProfileProjectionT = {
  connection: {
    state: 'ready',
    changedAt: 1,
    stale: false,
    runtimeId: 'rt_1',
    profile: 'default',
    capabilities: [{ id: 'runtime.live.observe', version: 1, available: true }],
  },
  projectionRevision: 1,
  cursor: { runtimeId: 'rt_1', seq: 1 },
  sessions: [],
  interactions: [],
  notifications: [],
};

function liveProjection(
  overrides: Partial<SpaceSessionLiveProjectionT>,
): SpaceSessionLiveProjectionT {
  return {
    sessionId,
    projectionRevision: 1,
    cursor: { runtimeId: 'rt_1', seq: 1 },
    transcriptRevision: 'tx_1',
    queuedRuns: [],
    activeTools: [],
    todos: [],
    queuedInputs: [],
    interactions: [],
    ...overrides,
  };
}

type TurnItem =
  | {
      kind: 'user';
      content: string;
      entryId: string;
      turnId: string;
      turnUserOrdinal: number;
      canonicalIndex: number;
      sentAt: number;
    }
  | {
      kind: 'assistant';
      text: string;
      entryId: string;
      turnId: string;
      canonicalIndex: number;
      sentAt: number;
    };

function turnItems(index: number): readonly TurnItem[] {
  return [
    {
      kind: 'user',
      content: `question ${index}`,
      entryId: `entry_user_${index}`,
      turnId: `turn_${index}`,
      turnUserOrdinal: 0,
      canonicalIndex: index * 2,
      sentAt: 1_000 + index * 100,
    },
    {
      kind: 'assistant',
      text: `answer ${index}`,
      entryId: `entry_assistant_${index}`,
      turnId: `turn_${index}`,
      canonicalIndex: index * 2 + 1,
      sentAt: 1_050 + index * 100,
    },
  ];
}

function visibleUserRows(): string[] {
  const state = useAppStore.getState();
  const rows = composeMessages({
    events: state.eventsBySession[sessionId] ?? [],
    userMessages: state.userMessagesBySession[sessionId] ?? [],
  });
  return rows
    .filter((row): row is Extract<(typeof rows)[number], { kind: 'user' }> => row.kind === 'user')
    .map((row) => row.content);
}

function visibleAssistantRows(): string[] {
  const state = useAppStore.getState();
  return composeMessages({
    events: state.eventsBySession[sessionId] ?? [],
    userMessages: state.userMessagesBySession[sessionId] ?? [],
  })
    .filter((row) => row.kind === 'assistant_text')
    .map((row) => row.text);
}

function sidebarStatus(): ReturnType<typeof deriveSessionStatus> {
  const state = useAppStore.getState();
  return deriveSessionStatus({
    pending: Boolean(state.pendingSendBySession[sessionId]),
    events: state.eventsBySession[sessionId],
    awaitingPermission: state.permissionQueue.some((request) => request.sessionId === sessionId),
    awaitingAskUser: state.askUserQueue.some((request) => request.sessionId === sessionId),
    errorSeenAt: state.errorSeenAtBySession[sessionId] ?? 0,
    errorSeenRunId: state.errorSeenRunIdBySession[sessionId],
    errorSeenRunIds: state.errorSeenRunIdsBySession[sessionId],
    runtimeLive: state.liveProjectionBySession[sessionId],
    runtimeProfileActive: false,
    runtimeProfileTerminalRun: undefined,
  });
}

beforeEach(() => {
  useAppStore.getState().resetSessionMessages(sessionId);
  const initial = createRuntimeProjectionState();
  useAppStore.setState({
    sessions: [sidebarSession],
    currentSessionId: sessionId,
    runtimeConnection: initial.connection,
    runtimeProfile: profile,
    liveProjectionBySession: initial.liveBySession,
    agentActorSnapshotBySession: {},
    runtimeSnapshotRequiredBySession: initial.snapshotRequiredBySession,
    runtimeSnapshotCursorBySession: {},
    permissionQueue: [],
    askUserQueue: [],
    eventsBySession: {},
    tokensBySession: {},
    pendingSendBySession: {},
    pendingSendRuntimeBaselineBySession: {},
  });
  useAppStore.getState().replaceRuntimeProfileProjection(profile);
});

test('a mid-run replacement window with omitted older history keeps the loaded turns visible', () => {
  const store = useAppStore.getState();

  // Initial full-history load: three completed turns.
  store.prependSessionHistory(
    sessionId,
    [...turnItems(0), ...turnItems(1), ...turnItems(2)],
    1_000,
    {
      replaceLoadedWindow: true,
    },
  );
  assert.deepEqual(visibleUserRows(), ['question 0', 'question 1', 'question 2']);

  // Open a live run for a fourth query.
  store.appendUserMessage(sessionId, 'live question', 5_000, undefined, 'operation_live');
  store.appendEvent({ kind: 'session_start', sessionId, provider: 'mock' });
  useAppStore.getState().replaceSessionLiveProjection(
    liveProjection({
      cursor: { runtimeId: 'rt_1', seq: 40 },
      activeRun: { runId: 'run_live', sessionId, phase: 'running', startedAt: 5_010 },
    }),
  );
  store.appendEvent({
    kind: 'text_delta',
    sessionId,
    text: 'streaming reply',
    sentAt: 5_020,
    runtimeEvent: { runtimeId: 'rt_1', runId: 'run_live', journalEpoch: 'journal_1', seq: 41 },
  });
  assert.deepEqual(visibleUserRows(), ['question 0', 'question 1', 'question 2', 'live question']);

  // Runtime-recovery revalidation can install a bounded newest page without a
  // history_truncation item while the run is still open.
  useAppStore.getState().prependSessionHistory(
    sessionId,
    [
      ...turnItems(2),
      {
        kind: 'user',
        content: 'live question',
        entryId: 'entry_user_live',
        turnId: 'turn_live',
        turnUserOrdinal: 0,
        canonicalIndex: 6,
        sentAt: 5_000,
      },
    ],
    1_000,
    { replaceLoadedWindow: true, includeLiveProjection: false },
  );

  // The already-loaded older turns must stay visible; a mid-run page replacement may not
  // collapse the conversation to the newest bounded window.
  assert.deepEqual(visibleUserRows(), ['question 0', 'question 1', 'question 2', 'live question']);
});

test('an assistant-leading replacement keeps the already loaded owner and earlier turns', () => {
  const store = useAppStore.getState();
  store.prependSessionHistory(
    sessionId,
    [...turnItems(0), ...turnItems(1), ...turnItems(2)],
    1_000,
    { replaceLoadedWindow: true },
  );

  store.prependSessionHistory(
    sessionId,
    [
      { kind: 'history_truncation', scope: 'history', omittedItems: 5 },
      {
        kind: 'assistant',
        text: 'answer 2 refreshed',
        entryId: 'entry_assistant_2',
        turnId: 'turn_2',
        canonicalIndex: 5,
        sentAt: 1_250,
      },
    ],
    1_000,
    { replaceLoadedWindow: true, includeLiveProjection: false },
  );

  assert.deepEqual(visibleUserRows(), ['question 0', 'question 1', 'question 2']);
  assert.deepEqual(visibleAssistantRows(), ['answer 0', 'answer 1', 'answer 2 refreshed']);
});

test('a tool-leading replacement keeps the already loaded turn prefix without duplicating the tool', () => {
  const store = useAppStore.getState();
  store.prependSessionHistory(
    sessionId,
    [
      ...turnItems(0),
      {
        kind: 'user',
        content: 'question with tool',
        entryId: 'entry_user_tool',
        turnId: 'turn_tool',
        turnUserOrdinal: 0,
        canonicalIndex: 2,
        sentAt: 1_200,
      },
      {
        kind: 'assistant',
        text: 'checking',
        entryId: 'entry_assistant_tool',
        turnId: 'turn_tool',
        canonicalIndex: 3,
        sentAt: 1_250,
      },
      {
        kind: 'tool_call',
        toolId: 'tool_1',
        toolName: 'read',
        input: { path: 'README.md' },
        result: 'old result',
        entryId: 'entry_tool_1',
        turnId: 'turn_tool',
        canonicalIndex: 4,
      },
    ],
    1_000,
    { replaceLoadedWindow: true },
  );

  store.prependSessionHistory(
    sessionId,
    [
      { kind: 'history_truncation', scope: 'history', omittedItems: 4 },
      {
        kind: 'tool_call',
        toolId: 'tool_1',
        toolName: 'read',
        input: { path: 'README.md' },
        result: 'refreshed result',
        entryId: 'entry_tool_1',
        turnId: 'turn_tool',
        canonicalIndex: 4,
      },
    ],
    1_000,
    { replaceLoadedWindow: true, includeLiveProjection: false },
  );

  const state = useAppStore.getState();
  const rows = composeMessages({
    events: state.eventsBySession[sessionId] ?? [],
    userMessages: state.userMessagesBySession[sessionId] ?? [],
  });
  assert.deepEqual(visibleUserRows(), ['question 0', 'question with tool']);
  assert.deepEqual(visibleAssistantRows(), ['answer 0', 'checking']);
  assert.deepEqual(
    rows
      .filter((row) => row.kind === 'tool_call')
      .map((row) => ({ toolId: row.toolId, result: row.result })),
    [{ toolId: 'tool_1', result: 'refreshed result' }],
  );
});

test('a bounded replacement without exact physical overlap cannot retain another lineage prefix', () => {
  const store = useAppStore.getState();
  store.prependSessionHistory(
    sessionId,
    [...turnItems(0), ...turnItems(1), ...turnItems(2)],
    1_000,
    { replaceLoadedWindow: true },
  );

  store.prependSessionHistory(
    sessionId,
    [
      {
        kind: 'user',
        content: 'question 2',
        // Re-rooted histories may reuse the same canonical position and text. Without the
        // physical entry identity this is not proof that the old prefix belongs to this lineage.
        turnId: 'turn_2',
        turnUserOrdinal: 1,
        canonicalIndex: 4,
        sentAt: 9_000,
      },
      {
        kind: 'assistant',
        text: 'replacement answer',
        entryId: 'entry_re_rooted_answer',
        turnId: 'turn_re_rooted',
        canonicalIndex: 5,
        sentAt: 9_050,
      },
    ],
    1_000,
    { replaceLoadedWindow: true },
  );

  assert.deepEqual(visibleUserRows(), ['question 2']);
});

test('a completed run settles the sidebar status after a mid-run canonical copy arrives', () => {
  const store = useAppStore.getState();

  store.prependSessionHistory(sessionId, [...turnItems(0), ...turnItems(1)], 1_000, {
    replaceLoadedWindow: true,
  });
  store.appendUserMessage(sessionId, 'live question', 5_000, undefined, 'operation_live');
  store.appendEvent({ kind: 'session_start', sessionId, provider: 'mock' });
  useAppStore.getState().replaceSessionLiveProjection(
    liveProjection({
      cursor: { runtimeId: 'rt_1', seq: 40 },
      activeRun: { runId: 'run_live', sessionId, phase: 'running', startedAt: 5_010 },
    }),
  );

  // Mid-run revalidation returns the full window plus the canonical copy of the still-open turn.
  useAppStore.getState().prependSessionHistory(
    sessionId,
    [
      ...turnItems(0),
      ...turnItems(1),
      {
        kind: 'user',
        content: 'live question',
        entryId: 'entry_user_live',
        turnId: 'turn_live',
        turnUserOrdinal: 0,
        canonicalIndex: 4,
        sentAt: 5_000,
      },
      {
        kind: 'assistant',
        text: 'partial canonical reply',
        entryId: 'entry_assistant_live',
        turnId: 'turn_live',
        canonicalIndex: 5,
        sentAt: 5_030,
      },
    ],
    1_000,
    { replaceLoadedWindow: true, includeLiveProjection: true },
  );

  // The run reaches its terminal boundary.
  useAppStore.getState().replaceSessionLiveProjection(
    liveProjection({
      cursor: { runtimeId: 'rt_1', seq: 60 },
      lastTerminalRun: {
        runId: 'run_live',
        sessionId,
        phase: 'completed',
        completedAt: 5_100,
      },
    }),
  );
  store.appendEvent({ kind: 'session_complete', sessionId });

  // The sidebar must settle; a stale running spinner until Ctrl+R is the reported bug.
  assert.equal(sidebarStatus(), 'idle');
});

test('a completed run settles the sidebar status after the collapsing replacement window', () => {
  const store = useAppStore.getState();

  store.prependSessionHistory(
    sessionId,
    [...turnItems(0), ...turnItems(1), ...turnItems(2)],
    1_000,
    {
      replaceLoadedWindow: true,
    },
  );
  store.appendUserMessage(sessionId, 'live question', 5_000, undefined, 'operation_live');
  store.appendEvent({ kind: 'session_start', sessionId, provider: 'mock' });
  useAppStore.getState().replaceSessionLiveProjection(
    liveProjection({
      cursor: { runtimeId: 'rt_1', seq: 40 },
      activeRun: { runId: 'run_live', sessionId, phase: 'running', startedAt: 5_010 },
    }),
  );

  // The same collapsing replacement window as the first test.
  useAppStore.getState().prependSessionHistory(
    sessionId,
    [
      ...turnItems(2),
      {
        kind: 'user',
        content: 'live question',
        entryId: 'entry_user_live',
        turnId: 'turn_live',
        turnUserOrdinal: 0,
        canonicalIndex: 6,
        sentAt: 5_000,
      },
    ],
    1_000,
    { replaceLoadedWindow: true, includeLiveProjection: false },
  );

  // The run reaches its terminal boundary.
  useAppStore.getState().replaceSessionLiveProjection(
    liveProjection({
      cursor: { runtimeId: 'rt_1', seq: 60 },
      lastTerminalRun: {
        runId: 'run_live',
        sessionId,
        phase: 'completed',
        completedAt: 5_100,
      },
    }),
  );
  store.appendEvent({ kind: 'session_complete', sessionId });

  // The sidebar must settle to idle after the terminal boundary.
  assert.equal(sidebarStatus(), 'idle');
});
