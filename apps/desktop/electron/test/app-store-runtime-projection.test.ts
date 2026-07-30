import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';

import type {
  AgentActorTreeSnapshotT,
  SessionEvent,
  SpaceRuntimeProfileProjectionT,
  SpaceSessionLiveProjectionT,
} from '@kodax-space/space-ipc-schema';
import { useAppStore } from '../../renderer/src/store/appStore.js';
import { createRuntimeProjectionState } from '../../renderer/src/store/runtimeProjectionState.js';
import { runtimeDeltasShareSnapshotSide } from '../../renderer/src/store/runtimeSnapshotHydration.js';

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

const live: SpaceSessionLiveProjectionT = {
  sessionId: 's_1',
  projectionRevision: 1,
  cursor: { runtimeId: 'rt_1', seq: 1 },
  transcriptRevision: 'tx_1',
  queuedRuns: [],
  activeTools: [],
  todos: [{ id: 'todo_1', content: 'Wire Space state', status: 'pending' }],
  queuedInputs: [],
  interactions: [],
};

beforeEach(() => {
  const initial = createRuntimeProjectionState();
  useAppStore.setState({
    runtimeConnection: initial.connection,
    runtimeProfile: initial.profile,
    liveProjectionBySession: initial.liveBySession,
    agentActorSnapshotBySession: {},
    runtimeSnapshotRequiredBySession: initial.snapshotRequiredBySession,
    runtimeSnapshotCursorBySession: {},
    permissionQueue: [],
    askUserQueue: [],
    currentSessionId: null,
    eventsBySession: {},
    tokensBySession: {},
    pendingSendBySession: {},
  });
});

test('app store keeps only monotonic Actor snapshots from the active Runtime', () => {
  const snapshot: AgentActorTreeSnapshotT = {
    runtimeId: 'rt_1',
    sessionId: 's_1',
    rootPath: '/root',
    revision: 2,
    eventCursor: 5,
    activeNonRootTurns: 0,
    maxConcurrentThreads: 4,
    actors: [],
  };

  useAppStore.getState().replaceRuntimeProfileProjection(profile);
  useAppStore.getState().replaceAgentActorSnapshot(snapshot);
  useAppStore.getState().replaceAgentActorSnapshot({
    ...snapshot,
    revision: 1,
    eventCursor: 99,
  });
  useAppStore.getState().replaceAgentActorSnapshot({
    ...snapshot,
    runtimeId: 'rt_stale',
    revision: 9,
  });

  assert.strictEqual(useAppStore.getState().agentActorSnapshotBySession.s_1, snapshot);

  const next = { ...snapshot, revision: 3, eventCursor: 6 };
  useAppStore.getState().replaceAgentActorSnapshot(next);
  assert.strictEqual(useAppStore.getState().agentActorSnapshotBySession.s_1, next);

  useAppStore.getState().setCoderRuntimeConnection({
    state: 'disconnected',
    changedAt: 2,
    stale: true,
    capabilities: [],
  });
  assert.deepEqual(useAppStore.getState().agentActorSnapshotBySession, {});
});

test('app store exposes snapshot replacement and revision-safe live patch actions', () => {
  useAppStore.getState().replaceRuntimeProfileProjection(profile);
  useAppStore.getState().replaceSessionLiveProjection(live);

  const status = useAppStore.getState().applySessionLiveProjectionChange({
    sessionId: 's_1',
    baseProjectionRevision: 1,
    projectionRevision: 2,
    cursor: { runtimeId: 'rt_1', seq: 2 },
    change: {
      domain: 'todos',
      todos: [{ id: 'todo_1', content: 'Wire Space state', status: 'completed' }],
    },
  });

  const state = useAppStore.getState();
  assert.equal(status, 'applied');
  assert.equal(state.runtimeConnection.state, 'ready');
  assert.equal(state.runtimeProfile?.projectionRevision, 1);
  assert.equal(state.liveProjectionBySession.s_1?.projectionRevision, 2);
  assert.equal(state.liveProjectionBySession.s_1?.todos[0]?.status, 'completed');
});

test('cumulative live snapshots hydrate missing state once without replaying text, thinking, or tools', () => {
  useAppStore.setState({
    currentSessionId: 's_1',
    eventsBySession: {
      s_1: [
        { kind: 'session_complete', sessionId: 's_1' },
        { kind: 'session_start', sessionId: 's_1', provider: 'custom' },
        { kind: 'thinking_delta', sessionId: 's_1', text: 'plan' },
        { kind: 'text_delta', sessionId: 's_1', text: 'Hello' },
      ],
    },
  });
  useAppStore.getState().replaceRuntimeProfileProjection(profile);

  const streaming: SpaceSessionLiveProjectionT = {
    ...live,
    projectionRevision: 2,
    cursor: { runtimeId: 'rt_1', seq: 2 },
    activeRun: {
      runId: 'run_1',
      sessionId: 's_1',
      phase: 'running',
      startedAt: 10,
    },
    thinkingDraft: { text: 'plan carefully', startedAt: 10 },
    assistantDraft: { text: 'Hello world', startedAt: 10 },
    activeTools: [{ toolCallId: 'tool_1', name: 'read_file', startedAt: 11, progress: 'reading' }],
  };

  useAppStore.getState().replaceSessionLiveProjection(streaming);
  useAppStore.getState().replaceSessionLiveProjection({
    ...streaming,
    projectionRevision: 3,
    cursor: { runtimeId: 'rt_1', seq: 3 },
  });

  const events = useAppStore.getState().eventsBySession.s_1 ?? [];
  assert.equal(
    events
      .filter(
        (event): event is Extract<SessionEvent, { kind: 'thinking_delta' }> =>
          event.kind === 'thinking_delta',
      )
      .map((event) => event.text)
      .join(''),
    'plan carefully',
  );
  assert.equal(
    events
      .filter(
        (event): event is Extract<SessionEvent, { kind: 'text_delta' }> =>
          event.kind === 'text_delta',
      )
      .map((event) => event.text)
      .join(''),
    'Hello world',
  );
  assert.equal(events.filter((event) => event.kind === 'tool_start').length, 1);
  assert.equal(events.filter((event) => event.kind === 'tool_progress').length, 1);
});

test('snapshot cursor reconciles a delivered suffix and rejects a covered late delta', () => {
  useAppStore.setState({ currentSessionId: 's_1', eventsBySession: { s_1: [] } });
  useAppStore.getState().replaceRuntimeProfileProjection(profile);
  useAppStore.getState().appendEvent({
    kind: 'text_delta',
    sessionId: 's_1',
    text: 'c',
    runtimeEvent: { runtimeId: 'rt_1', runId: 'run_1', seq: 3 },
  });

  const snapshot: SpaceSessionLiveProjectionT = {
    ...live,
    projectionRevision: 2,
    cursor: { runtimeId: 'rt_1', seq: 3 },
    activeRun: {
      runId: 'run_1',
      sessionId: 's_1',
      phase: 'running',
      startedAt: 10,
    },
    assistantDraft: { text: 'abc', startedAt: 10 },
  };
  useAppStore.getState().replaceSessionLiveProjection(snapshot);
  useAppStore.getState().appendEvent({
    kind: 'text_delta',
    sessionId: 's_1',
    text: 'c',
    runtimeEvent: { runtimeId: 'rt_1', runId: 'run_1', seq: 3 },
  });
  useAppStore.getState().appendEvent({
    kind: 'text_delta',
    sessionId: 's_1',
    text: 'd',
    runtimeEvent: { runtimeId: 'rt_1', runId: 'run_1', seq: 4 },
  });

  const events = useAppStore.getState().eventsBySession.s_1 ?? [];
  assert.equal(
    events
      .filter(
        (event): event is Extract<SessionEvent, { kind: 'text_delta' }> =>
          event.kind === 'text_delta',
      )
      .map((event) => event.text)
      .join(''),
    'abcd',
  );
  assert.deepEqual(useAppStore.getState().runtimeSnapshotCursorBySession.s_1, {
    runtimeId: 'rt_1',
    seq: 3,
    runId: 'run_1',
    assistantDraftSeq: 3,
  });
});

test('snapshot-first delivery drops an included delta but admits the next cursor', () => {
  useAppStore.setState({ currentSessionId: 's_1', eventsBySession: { s_1: [] } });
  useAppStore.getState().replaceRuntimeProfileProjection(profile);
  useAppStore.getState().replaceSessionLiveProjection({
    ...live,
    projectionRevision: 2,
    cursor: { runtimeId: 'rt_1', seq: 3 },
    activeRun: {
      runId: 'run_1',
      sessionId: 's_1',
      phase: 'running',
      startedAt: 10,
    },
    assistantDraft: { text: 'abc', startedAt: 10 },
  });
  useAppStore.getState().appendEvent({
    kind: 'text_delta',
    sessionId: 's_1',
    text: 'c',
    runtimeEvent: { runtimeId: 'rt_1', runId: 'run_1', seq: 3 },
  });
  useAppStore.getState().appendEvent({
    kind: 'text_delta',
    sessionId: 's_1',
    text: 'd',
    runtimeEvent: { runtimeId: 'rt_1', runId: 'run_1', seq: 4 },
  });

  const text = (useAppStore.getState().eventsBySession.s_1 ?? [])
    .filter(
      (event): event is Extract<SessionEvent, { kind: 'text_delta' }> =>
        event.kind === 'text_delta',
    )
    .map((event) => event.text)
    .join('');
  assert.equal(text, 'abcd');
});

test('snapshot recovery fills a missing middle delta without replaying delivered chunks', () => {
  useAppStore.setState({ currentSessionId: 's_1', eventsBySession: { s_1: [] } });
  useAppStore.getState().replaceRuntimeProfileProjection(profile);
  useAppStore.getState().appendEvent({
    kind: 'text_delta',
    sessionId: 's_1',
    text: 'a',
    runtimeEvent: { runtimeId: 'rt_1', runId: 'run_1', seq: 2 },
  });
  useAppStore.getState().appendEvent({
    kind: 'text_delta',
    sessionId: 's_1',
    text: 'c',
    runtimeEvent: { runtimeId: 'rt_1', runId: 'run_1', seq: 4 },
  });

  const snapshot: SpaceSessionLiveProjectionT = {
    ...live,
    projectionRevision: 2,
    cursor: { runtimeId: 'rt_1', seq: 4 },
    activeRun: {
      runId: 'run_1',
      sessionId: 's_1',
      phase: 'running',
      startedAt: 10,
    },
    assistantDraft: { text: 'abc', startedAt: 10 },
  };
  useAppStore.getState().replaceSessionLiveProjection(snapshot);
  useAppStore.getState().replaceSessionLiveProjection({
    ...snapshot,
    projectionRevision: 3,
    cursor: { runtimeId: 'rt_1', seq: 5 },
  });

  assert.equal(
    (useAppStore.getState().eventsBySession.s_1 ?? [])
      .filter(
        (event): event is Extract<SessionEvent, { kind: 'text_delta' }> =>
          event.kind === 'text_delta',
      )
      .map((event) => event.text)
      .join(''),
    'abc',
  );
});

test('snapshot recovery never treats another run text as current-run cumulative coverage', () => {
  useAppStore.setState({ currentSessionId: 's_1', eventsBySession: { s_1: [] } });
  useAppStore.getState().replaceRuntimeProfileProjection(profile);
  useAppStore.getState().appendEvent({
    kind: 'text_delta',
    sessionId: 's_1',
    text: 'sa',
    runtimeEvent: { runtimeId: 'rt_1', runId: 'run_old', seq: 2 },
  });
  useAppStore.getState().appendEvent({
    kind: 'text_delta',
    sessionId: 's_1',
    text: 'me',
    runtimeEvent: { runtimeId: 'rt_1', runId: 'run_2', seq: 4 },
  });

  useAppStore.getState().replaceSessionLiveProjection({
    ...live,
    projectionRevision: 2,
    cursor: { runtimeId: 'rt_1', seq: 4 },
    activeRun: {
      runId: 'run_2',
      sessionId: 's_1',
      phase: 'running',
      startedAt: 10,
    },
    assistantDraft: { text: 'same', startedAt: 10 },
  });

  const currentRunText = (useAppStore.getState().eventsBySession.s_1 ?? [])
    .filter(
      (event): event is Extract<SessionEvent, { kind: 'text_delta' }> =>
        event.kind === 'text_delta' && event.runtimeEvent?.runId === 'run_2',
    )
    .map((event) => event.text)
    .join('');
  assert.equal(currentRunText, 'same');
});

test('snapshot barrier remains scoped to its run when the next run starts', () => {
  useAppStore.setState({ currentSessionId: 's_1', eventsBySession: { s_1: [] } });
  useAppStore.getState().replaceRuntimeProfileProjection(profile);
  useAppStore.getState().replaceSessionLiveProjection({
    ...live,
    projectionRevision: 2,
    cursor: { runtimeId: 'rt_1', seq: 3 },
    activeRun: {
      runId: 'run_1',
      sessionId: 's_1',
      phase: 'running',
      startedAt: 10,
    },
    assistantDraft: { text: 'first', startedAt: 10 },
  });
  useAppStore.getState().appendEvent({
    kind: 'text_delta',
    sessionId: 's_1',
    text: '-late-old',
    runtimeEvent: { runtimeId: 'rt_1', runId: 'run_1', seq: 3 },
  });
  useAppStore.getState().appendEvent({
    kind: 'text_delta',
    sessionId: 's_1',
    text: '-new-run',
    runtimeEvent: { runtimeId: 'rt_1', runId: 'run_2', seq: 2 },
  });

  const text = (useAppStore.getState().eventsBySession.s_1 ?? [])
    .filter(
      (event): event is Extract<SessionEvent, { kind: 'text_delta' }> =>
        event.kind === 'text_delta',
    )
    .map((event) => event.text)
    .join('');
  assert.equal(text, 'first-new-run');
});

test('stream batching never merges covered and post-snapshot Runtime deltas', () => {
  const covered = {
    kind: 'text_delta' as const,
    sessionId: 's_1',
    text: 'c',
    runtimeEvent: { runtimeId: 'rt_1', runId: 'run_1', seq: 3 },
  };
  const after = {
    ...covered,
    text: 'd',
    runtimeEvent: { ...covered.runtimeEvent, seq: 4 },
  };
  const later = {
    ...after,
    text: 'e',
    runtimeEvent: { ...after.runtimeEvent, seq: 5 },
  };
  const cursor = { runtimeId: 'rt_1', runId: 'run_1', seq: 3, assistantDraftSeq: 3 };

  assert.equal(runtimeDeltasShareSnapshotSide(covered, after, cursor), false);
  assert.equal(runtimeDeltasShareSnapshotSide(after, later, cursor), true);
});

test('app store keeps live Runtime drafts bounded across frames without crossing a snapshot', () => {
  useAppStore.setState({ currentSessionId: 's_1', eventsBySession: { s_1: [] } });
  useAppStore.getState().replaceRuntimeProfileProjection(profile);
  useAppStore.getState().replaceSessionLiveProjection({
    ...live,
    projectionRevision: 2,
    cursor: { runtimeId: 'rt_1', seq: 3 },
    activeRun: {
      runId: 'run_1',
      sessionId: 's_1',
      phase: 'running',
      startedAt: 10,
    },
    assistantDraft: { text: 'abc', startedAt: 10 },
  });

  for (let seq = 4; seq <= 1_003; seq += 1) {
    useAppStore.getState().appendEvent({
      kind: 'text_delta',
      sessionId: 's_1',
      text: String(seq % 10),
      runtimeEvent: { runtimeId: 'rt_1', runId: 'run_1', seq },
    });
  }

  const textEvents = (useAppStore.getState().eventsBySession.s_1 ?? []).filter(
    (event): event is Extract<SessionEvent, { kind: 'text_delta' }> => event.kind === 'text_delta',
  );
  assert.equal(textEvents.length, 2, 'snapshot-covered and post-snapshot text stay separate');
  assert.equal(textEvents[0]?.text, 'abc');
  assert.equal(
    textEvents[1]?.text,
    Array.from({ length: 1_000 }, (_, index) => String((index + 4) % 10)).join(''),
  );
  assert.equal(textEvents[1]?.runtimeEvent?.seq, 1_003);
});

test('app store coalesces adjacent tool input and replaces adjacent progress across frames', () => {
  useAppStore.setState({ currentSessionId: 's_1', eventsBySession: { s_1: [] } });
  useAppStore.getState().replaceRuntimeProfileProjection(profile);
  const runtimeEvent = { runtimeId: 'rt_1', runId: 'run_1', seq: 1 };

  useAppStore.getState().appendEvent({
    kind: 'tool_input_delta',
    sessionId: 's_1',
    toolId: 'tool_1',
    toolName: 'write',
    partialJson: '{"path":',
    runtimeEvent,
  });
  useAppStore.getState().appendEvent({
    kind: 'tool_input_delta',
    sessionId: 's_1',
    toolId: 'tool_1',
    toolName: 'write',
    partialJson: '"README.md"}',
    runtimeEvent: { ...runtimeEvent, seq: 2 },
  });
  useAppStore.getState().appendEvent({
    kind: 'tool_progress',
    sessionId: 's_1',
    toolId: 'tool_1',
    message: 'writing 10%',
    runtimeEvent: { ...runtimeEvent, seq: 3 },
  });
  useAppStore.getState().appendEvent({
    kind: 'tool_progress',
    sessionId: 's_1',
    toolId: 'tool_1',
    message: 'writing 90%',
    runtimeEvent: { ...runtimeEvent, seq: 4 },
  });

  const events = useAppStore.getState().eventsBySession.s_1 ?? [];
  assert.equal(events.length, 2);
  assert.equal(
    events[0]?.kind === 'tool_input_delta' ? events[0].partialJson : undefined,
    '{"path":"README.md"}',
  );
  assert.equal(events[1]?.kind === 'tool_progress' ? events[1].message : undefined, 'writing 90%');
});

test('app store keeps ambiguous tool input without a call id as separate events', () => {
  useAppStore.setState({ currentSessionId: 's_1', eventsBySession: { s_1: [] } });

  useAppStore.getState().appendEvent({
    kind: 'tool_input_delta',
    sessionId: 's_1',
    toolName: 'write',
    partialJson: '{"first":true}',
  });
  useAppStore.getState().appendEvent({
    kind: 'tool_input_delta',
    sessionId: 's_1',
    toolName: 'write',
    partialJson: '{"second":true}',
  });

  const events = useAppStore.getState().eventsBySession.s_1 ?? [];
  assert.deepEqual(
    events.map((event) => (event.kind === 'tool_input_delta' ? event.partialJson : undefined)),
    ['{"first":true}', '{"second":true}'],
  );
});

test('app store exposes a stable root-compaction render-busy projection', () => {
  useAppStore.setState({
    currentSessionId: 's_1',
    eventsBySession: { s_1: [] },
    compactingBySession: {},
  });

  useAppStore.getState().appendEvent({
    kind: 'compact_start',
    sessionId: 's_1',
    contextKind: 'child',
  });
  assert.equal(useAppStore.getState().compactingBySession.s_1, undefined);

  useAppStore.getState().appendEvent({
    kind: 'compact_start',
    sessionId: 's_1',
    contextKind: 'root',
  });
  assert.equal(useAppStore.getState().compactingBySession.s_1, true);

  useAppStore.getState().appendEvent({
    kind: 'compact_end',
    sessionId: 's_1',
    contextKind: 'root',
  });
  assert.equal(useAppStore.getState().compactingBySession.s_1, undefined);
});

test('removing a session clears only its compaction render-busy projection', () => {
  useAppStore.setState({
    currentSessionId: 's_1',
    eventsBySession: { s_1: [], s_2: [] },
    compactingBySession: { s_1: true, s_2: true },
  });

  useAppStore.getState().removeSession('s_1');

  assert.equal(useAppStore.getState().compactingBySession.s_1, undefined);
  assert.equal(useAppStore.getState().compactingBySession.s_2, true);
});

test('snapshot inserts a missing tool start before orphan progress and remains idempotent', () => {
  useAppStore.setState({ currentSessionId: 's_1', eventsBySession: { s_1: [] } });
  useAppStore.getState().replaceRuntimeProfileProjection(profile);
  useAppStore.getState().appendEvent({
    kind: 'tool_progress',
    sessionId: 's_1',
    toolId: 'tool_1',
    message: 'reading',
    runtimeEvent: { runtimeId: 'rt_1', runId: 'run_1', seq: 3 },
  });

  const snapshot: SpaceSessionLiveProjectionT = {
    ...live,
    projectionRevision: 2,
    cursor: { runtimeId: 'rt_1', seq: 3 },
    activeRun: {
      runId: 'run_1',
      sessionId: 's_1',
      phase: 'running',
      startedAt: 10,
    },
    activeTools: [{ toolCallId: 'tool_1', name: 'read_file', startedAt: 11, progress: 'reading' }],
  };
  useAppStore.getState().replaceSessionLiveProjection(snapshot);
  useAppStore.getState().replaceSessionLiveProjection({
    ...snapshot,
    projectionRevision: 3,
  });

  const toolEvents = (useAppStore.getState().eventsBySession.s_1 ?? []).filter(
    (event) =>
      (event.kind === 'tool_start' || event.kind === 'tool_progress') && event.toolId === 'tool_1',
  );
  assert.deepEqual(
    toolEvents.map((event) => event.kind),
    ['tool_start', 'tool_progress'],
  );
  assert.equal(toolEvents.filter((event) => event.kind === 'tool_start').length, 1);
  assert.equal(toolEvents.filter((event) => event.kind === 'tool_progress').length, 1);
});

test('authoritative active-tool set removes covered orphan running cards', () => {
  useAppStore.setState({ currentSessionId: 's_1', eventsBySession: { s_1: [] } });
  useAppStore.getState().replaceRuntimeProfileProjection(profile);
  useAppStore.getState().appendEvent({
    kind: 'tool_start',
    sessionId: 's_1',
    toolId: 'tool_stale',
    toolName: 'read_file',
    input: {},
    runtimeEvent: { runtimeId: 'rt_1', runId: 'run_1', seq: 2 },
  });
  useAppStore.getState().appendEvent({
    kind: 'tool_progress',
    sessionId: 's_1',
    toolId: 'tool_stale',
    message: 'reading',
    runtimeEvent: { runtimeId: 'rt_1', runId: 'run_1', seq: 3 },
  });
  useAppStore.getState().replaceSessionLiveProjection({
    ...live,
    projectionRevision: 2,
    cursor: { runtimeId: 'rt_1', seq: 4 },
    activeRun: {
      runId: 'run_1',
      sessionId: 's_1',
      phase: 'running',
      startedAt: 10,
    },
    activeTools: [],
  });

  assert.equal(
    (useAppStore.getState().eventsBySession.s_1 ?? []).some(
      (event) =>
        (event.kind === 'tool_start' || event.kind === 'tool_progress') &&
        event.toolId === 'tool_stale',
    ),
    false,
  );
});

test('terminal snapshot closes stale tools without moving or replaying completed text', () => {
  useAppStore.setState({
    currentSessionId: 's_1',
    eventsBySession: {
      s_1: [
        {
          kind: 'session_start',
          sessionId: 's_1',
          provider: 'custom',
          runtimeEvent: { runtimeId: 'rt_1', runId: 'run_1', seq: 1 },
        },
        {
          kind: 'text_delta',
          sessionId: 's_1',
          text: 'abc',
          runtimeEvent: { runtimeId: 'rt_1', runId: 'run_1', seq: 2 },
        },
        {
          kind: 'tool_start',
          sessionId: 's_1',
          toolId: 'tool_stale',
          toolName: 'read_file',
          input: {},
          runtimeEvent: { runtimeId: 'rt_1', runId: 'run_1', seq: 3 },
        },
        {
          kind: 'session_complete',
          sessionId: 's_1',
          runtimeEvent: { runtimeId: 'rt_1', runId: 'run_1', seq: 4 },
        },
      ],
    },
  });
  useAppStore.getState().replaceRuntimeProfileProjection(profile);
  useAppStore.getState().replaceSessionLiveProjection({
    ...live,
    projectionRevision: 2,
    cursor: { runtimeId: 'rt_1', seq: 4 },
    assistantDraft: { text: 'abc', startedAt: 10 },
    lastTerminalRun: {
      runId: 'run_1',
      sessionId: 's_1',
      phase: 'completed',
      startedAt: 10,
      completedAt: 20,
    },
    activeTools: [],
  });

  const events = useAppStore.getState().eventsBySession.s_1 ?? [];
  assert.equal(
    events
      .filter(
        (event): event is Extract<SessionEvent, { kind: 'text_delta' }> =>
          event.kind === 'text_delta',
      )
      .map((event) => event.text)
      .join(''),
    'abc',
  );
  assert.equal(
    events.some((event) => event.kind === 'tool_start'),
    false,
  );
  assert.equal(events.at(-1)?.kind, 'session_complete');
});

test('terminal snapshot without drafts does not discard covered deltas still queued in the renderer', () => {
  useAppStore.setState({ currentSessionId: 's_1', eventsBySession: { s_1: [] } });
  useAppStore.getState().replaceRuntimeProfileProjection(profile);
  const state = useAppStore.getState();
  state.replaceSessionLiveProjection({
    ...live,
    projectionRevision: 2,
    cursor: { runtimeId: 'rt_1', seq: 42 },
    lastTerminalRun: {
      runId: 'run_terminal_queue',
      sessionId: 's_1',
      phase: 'completed',
      startedAt: 10,
      completedAt: 20,
    },
    activeTools: [],
  });

  state.appendEvent({
    kind: 'thinking_delta',
    sessionId: 's_1',
    text: 'queued thought',
    runtimeEvent: {
      runtimeId: 'rt_1',
      runId: 'run_terminal_queue',
      seq: 40,
    },
  });
  state.appendEvent({
    kind: 'text_delta',
    sessionId: 's_1',
    text: 'queued answer',
    runtimeEvent: {
      runtimeId: 'rt_1',
      runId: 'run_terminal_queue',
      seq: 41,
    },
  });

  assert.equal(
    useAppStore
      .getState()
      .eventsBySession.s_1?.filter((event) => event.kind === 'thinking_delta')
      .map((event) => event.text)
      .join(''),
    'queued thought',
  );
  assert.equal(
    useAppStore
      .getState()
      .eventsBySession.s_1?.filter((event) => event.kind === 'text_delta')
      .map((event) => event.text)
      .join(''),
    'queued answer',
  );
});

test('terminal snapshot preserves only the earlier draft coverage watermark for the same run', () => {
  useAppStore.setState({ currentSessionId: 's_1', eventsBySession: { s_1: [] } });
  useAppStore.getState().replaceRuntimeProfileProjection(profile);
  const state = useAppStore.getState();
  const activeRun = {
    runId: 'run_terminal_rerun',
    sessionId: 's_1',
    phase: 'running' as const,
    startedAt: 10,
  };
  state.replaceSessionLiveProjection({
    ...live,
    projectionRevision: 2,
    cursor: { runtimeId: 'rt_1', seq: 10 },
    activeRun,
    assistantDraft: { text: 'covered', startedAt: 10 },
  });
  state.replaceSessionLiveProjection({
    ...live,
    projectionRevision: 3,
    cursor: { runtimeId: 'rt_1', seq: 20 },
    lastTerminalRun: {
      ...activeRun,
      phase: 'completed',
      completedAt: 20,
    },
  });

  assert.deepEqual(useAppStore.getState().runtimeSnapshotCursorBySession.s_1, {
    runtimeId: 'rt_1',
    seq: 20,
    runId: 'run_terminal_rerun',
    assistantDraftSeq: 10,
  });

  state.appendEvent({
    kind: 'text_delta',
    sessionId: 's_1',
    text: 'covered',
    runtimeEvent: {
      runtimeId: 'rt_1',
      runId: 'run_terminal_rerun',
      seq: 9,
    },
  });
  state.appendEvent({
    kind: 'text_delta',
    sessionId: 's_1',
    text: ' post',
    runtimeEvent: {
      runtimeId: 'rt_1',
      runId: 'run_terminal_rerun',
      seq: 15,
    },
  });

  assert.equal(
    useAppStore
      .getState()
      .eventsBySession.s_1?.filter((event) => event.kind === 'text_delta')
      .map((event) => event.text)
      .join(''),
    'covered post',
  );
});

test('authoritative run and terminal projections clear stale pending-send state', () => {
  useAppStore.getState().replaceRuntimeProfileProjection(profile);
  useAppStore.getState().replaceSessionLiveProjection(live);
  useAppStore.getState().setPendingSend('s_1', true);

  const admitted = useAppStore.getState().applySessionLiveProjectionChange({
    sessionId: 's_1',
    baseProjectionRevision: 1,
    projectionRevision: 2,
    cursor: { runtimeId: 'rt_1', seq: 2 },
    change: {
      domain: 'run',
      activeRun: {
        runId: 'run_1',
        sessionId: 's_1',
        phase: 'running',
        startedAt: 10,
      },
      queuedRuns: [],
    },
  });

  assert.equal(admitted, 'applied');
  assert.equal(useAppStore.getState().pendingSendBySession.s_1, undefined);

  useAppStore.getState().setPendingSend('s_1', true);
  useAppStore.getState().replaceSessionLiveProjection({
    ...live,
    projectionRevision: 3,
    cursor: { runtimeId: 'rt_1', seq: 3 },
    lastTerminalRun: {
      runId: 'run_1',
      sessionId: 's_1',
      phase: 'completed',
      startedAt: 10,
      completedAt: 20,
    },
  });

  assert.equal(useAppStore.getState().pendingSendBySession.s_1, undefined);
});

test('app store marks revision gaps for snapshot reload without mutating live data', () => {
  useAppStore.getState().replaceRuntimeProfileProjection(profile);
  useAppStore.getState().replaceSessionLiveProjection(live);

  const status = useAppStore.getState().applySessionLiveProjectionChange({
    sessionId: 's_1',
    baseProjectionRevision: 3,
    projectionRevision: 4,
    cursor: { runtimeId: 'rt_1', seq: 4 },
    change: { domain: 'tools', activeTools: [] },
  });

  const state = useAppStore.getState();
  assert.equal(status, 'snapshot-required');
  assert.equal(state.liveProjectionBySession.s_1?.projectionRevision, 1);
  assert.equal(state.runtimeSnapshotRequiredBySession.s_1, true);
});

test('app store ignores connection events older than its latest Runtime transition', () => {
  useAppStore.getState().replaceRuntimeProfileProjection(profile);
  useAppStore.getState().setCoderRuntimeConnection({
    state: 'disconnected',
    changedAt: 2,
    stale: true,
    capabilities: [],
  });
  useAppStore.getState().setCoderRuntimeConnection(profile.connection);

  assert.equal(useAppStore.getState().runtimeConnection.state, 'disconnected');
  assert.equal(useAppStore.getState().runtimeConnection.changedAt, 2);
});

test('compact_stats replaces transcript estimates with the active post-compaction context', () => {
  useAppStore.setState({
    currentSessionId: 's_1',
    eventsBySession: { s_1: [] },
    tokensBySession: { s_1: { tokens: 483_200, source: 'estimate' } },
  });

  useAppStore.getState().appendEvent({
    kind: 'compact_stats',
    sessionId: 's_1',
    tokensBefore: 322_973,
    tokensAfter: 222_460,
    committed: true,
    source: 'manual',
  });

  assert.deepEqual(useAppStore.getState().tokensBySession.s_1, {
    tokens: 222_460,
    source: 'compact_stats',
    compactedFrom: 322_973,
    lastCompaction: {
      committed: true,
      tokensBefore: 322_973,
      tokensAfter: 222_460,
      source: 'manual',
    },
  });

  useAppStore.getState().appendEvent({
    kind: 'compact_stats',
    sessionId: 's_1',
    tokensBefore: 40_000,
    tokensAfter: 8_000,
    contextId: 's_1/agent/reviewer',
    contextKind: 'child',
    parentContextId: 's_1',
    agentId: 'reviewer',
    contextRevision: 1,
  });
  assert.deepEqual(useAppStore.getState().tokensBySession.s_1, {
    tokens: 222_460,
    source: 'compact_stats',
    compactedFrom: 322_973,
    lastCompaction: {
      committed: true,
      tokensBefore: 322_973,
      tokensAfter: 222_460,
      source: 'manual',
    },
  });
});

test('root context revisions reject stale iteration and revision-less compatibility updates', () => {
  useAppStore.setState({ currentSessionId: 's_1', eventsBySession: { s_1: [] } });

  useAppStore.getState().appendEvent({
    kind: 'compact_stats',
    sessionId: 's_1',
    tokensBefore: 489_491,
    tokensAfter: 291_718,
    contextId: 's_1',
    contextKind: 'root',
    contextRevision: 3,
    beforeRevision: 2,
    afterRevision: 3,
    source: 'automatic_threshold',
    committed: true,
  });
  useAppStore.getState().appendEvent({
    kind: 'iteration_end',
    sessionId: 's_1',
    iter: 10,
    maxIter: 500,
    tokenCount: 483_200,
    contextId: 's_1',
    contextKind: 'root',
    contextRevision: 2,
  });
  useAppStore.getState().appendEvent({
    kind: 'compact_stats',
    sessionId: 's_1',
    tokensBefore: 489_491,
    tokensAfter: 483_200,
  });

  assert.equal(useAppStore.getState().tokensBySession.s_1?.tokens, 291_718);
  assert.equal(useAppStore.getState().tokensBySession.s_1?.contextRevision, 3);

  useAppStore.getState().appendEvent({
    kind: 'iteration_end',
    sessionId: 's_1',
    iter: 11,
    maxIter: 500,
    tokenCount: 300_000,
    contextId: 's_1',
    contextKind: 'root',
    contextRevision: 3,
  });
  assert.equal(useAppStore.getState().tokensBySession.s_1?.tokens, 300_000);
});

test('unchanged canonical compaction updates the gauge without claiming a reduction', () => {
  useAppStore.setState({ currentSessionId: 's_1', eventsBySession: { s_1: [] } });
  useAppStore.getState().appendEvent({
    kind: 'compact_stats',
    sessionId: 's_1',
    tokensBefore: 205_000,
    tokensAfter: 205_000,
    contextId: 's_1',
    contextKind: 'root',
    contextRevision: 4,
    committed: false,
    source: 'manual',
    elapsedMs: 90,
  });

  assert.deepEqual(useAppStore.getState().tokensBySession.s_1, {
    tokens: 205_000,
    source: 'compact_stats',
    contextId: 's_1',
    contextRevision: 4,
    lastCompaction: {
      committed: false,
      tokensBefore: 205_000,
      tokensAfter: 205_000,
      source: 'manual',
      elapsedMs: 90,
    },
  });
});

test('run reset removes terminal Runtime interactions from modal queues', () => {
  useAppStore.getState().replaceRuntimeProfileProjection(profile);
  useAppStore.getState().replaceSessionLiveProjection({
    ...live,
    interactions: [
      {
        kind: 'ask-user',
        source: 'coder-runtime',
        runId: 'run_1',
        createdAt: 1,
        state: 'pending',
        request: {
          kind: 'input',
          reqId: 'ask_1',
          sessionId: 's_1',
          question: 'Continue?',
        },
      },
    ],
  });
  assert.equal(useAppStore.getState().askUserQueue.length, 1);

  const status = useAppStore.getState().applySessionLiveProjectionChange({
    sessionId: 's_1',
    baseProjectionRevision: 1,
    projectionRevision: 2,
    cursor: { runtimeId: 'rt_1', seq: 2 },
    change: {
      domain: 'run',
      activeRun: null,
      queuedRuns: [],
      queuedInputs: [],
      resetRunScopedState: true,
    },
  });

  assert.equal(status, 'applied');
  assert.deepEqual(useAppStore.getState().askUserQueue, []);
});
