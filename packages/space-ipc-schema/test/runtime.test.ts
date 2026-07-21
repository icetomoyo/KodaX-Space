import assert from 'node:assert/strict';
import test from 'node:test';

import {
  INVOKE_CHANNEL_NAMES,
  PUSH_CHANNEL_NAMES,
  runtimeConnectionChangedChannel,
  runtimeProfileChangedChannel,
  runtimeProfileSnapshotChannel,
  sessionLiveChangedChannel,
  sessionLiveSnapshotChannel,
  spaceRuntimeProfileProjectionSchema,
  spaceSessionLiveChangedSchema,
  spaceSessionLiveProjectionSchema,
} from '../src/index.js';

const cursor = { runtimeId: 'rt_1', seq: 7 } as const;
const connection = {
  state: 'ready',
  changedAt: 100,
  stale: false,
  runtimeId: 'rt_1',
  profile: 'default',
  capabilities: [{ id: 'live.observe', version: 1, available: true }],
} as const;

test('runtime projection channels are registered in schema-derived allowlists', () => {
  for (const name of ['runtime.profileSnapshot', 'session.liveSnapshot'] as const) {
    assert.ok(INVOKE_CHANNEL_NAMES.has(name));
  }
  for (const name of [
    'runtime.connectionChanged',
    'runtime.profileChanged',
    'session.liveChanged',
  ] as const) {
    assert.ok(PUSH_CHANNEL_NAMES.has(name));
  }

  assert.equal(runtimeProfileSnapshotChannel.name, 'runtime.profileSnapshot');
  assert.equal(sessionLiveSnapshotChannel.name, 'session.liveSnapshot');
  assert.equal(runtimeConnectionChangedChannel.name, 'runtime.connectionChanged');
  assert.equal(runtimeProfileChangedChannel.name, 'runtime.profileChanged');
  assert.equal(sessionLiveChangedChannel.name, 'session.liveChanged');
});

test('profile projection is bounded and accepts only trusted Coder session ownership', () => {
  const valid = {
    connection,
    projectionRevision: 3,
    cursor,
    sessions: [
      {
        sessionId: 's_1',
        surface: 'code',
        title: 'Shared run',
        createdAt: 1,
        lastActivityAt: 2,
        activeRun: {
          runId: 'run_1',
          sessionId: 's_1',
          phase: 'running',
          startedAt: 2,
          initiatedBy: { clientId: 'space_1', name: 'KodaX Space' },
        },
        queuedRuns: [],
      },
    ],
    interactions: [],
    notifications: [],
  } as const;

  assert.equal(spaceRuntimeProfileProjectionSchema.safeParse(valid).success, true);
  assert.equal(runtimeProfileSnapshotChannel.output.safeParse(valid).success, true);
  assert.equal(runtimeProfileChangedChannel.payload.safeParse(valid).success, true);

  assert.equal(
    spaceRuntimeProfileProjectionSchema.safeParse({
      ...valid,
      sessions: [{ ...valid.sessions[0], surface: 'partner' }],
    }).success,
    false,
  );
  assert.equal(
    spaceRuntimeProfileProjectionSchema.safeParse({
      ...valid,
      sessions: Array.from({ length: 501 }, (_, index) => ({
        ...valid.sessions[0],
        sessionId: `s_${index}`,
      })),
    }).success,
    false,
  );
});

test('selected-session live projection carries semantic spinner, Todo and queue truth', () => {
  const live = {
    sessionId: 's_1',
    projectionRevision: 4,
    cursor,
    transcriptRevision: 'tx_4',
    activeRun: {
      runId: 'run_1',
      sessionId: 's_1',
      phase: 'waiting_permission',
      startedAt: 2,
    },
    queuedRuns: [],
    assistantDraft: { text: 'Working', startedAt: 3 },
    activeTools: [{ toolCallId: 'tool_1', name: 'read', startedAt: 4 }],
    todos: [{ id: 'todo_1', content: 'Inspect runtime', status: 'in_progress' }],
    queuedInputs: [
      {
        inputId: 'input_1',
        sessionId: 's_1',
        delivery: 'after-turn',
        state: 'queued',
        createdAt: 5,
        position: 1,
      },
    ],
    interactions: [],
  } as const;

  assert.equal(spaceSessionLiveProjectionSchema.safeParse(live).success, true);
  assert.equal(sessionLiveSnapshotChannel.output.safeParse(live).success, true);
  assert.equal(sessionLiveSnapshotChannel.input.safeParse({ sessionId: 's_1' }).success, true);
});

test('live changes require monotonic revisions and typed domain replacements', () => {
  const valid = {
    sessionId: 's_1',
    baseProjectionRevision: 4,
    projectionRevision: 5,
    cursor: { runtimeId: 'rt_1', seq: 8 },
    change: {
      domain: 'todos',
      todos: [{ id: 'todo_1', content: 'Inspect runtime', status: 'completed' }],
    },
  } as const;

  assert.equal(spaceSessionLiveChangedSchema.safeParse(valid).success, true);
  assert.equal(sessionLiveChangedChannel.payload.safeParse(valid).success, true);
  assert.equal(
    spaceSessionLiveChangedSchema.safeParse({ ...valid, projectionRevision: 4 }).success,
    false,
  );
  assert.equal(
    spaceSessionLiveChangedSchema.safeParse({
      ...valid,
      change: { domain: 'tools', todos: [] },
    }).success,
    false,
  );
});

test('connection projection rejects ready states that still claim stale data', () => {
  assert.equal(runtimeConnectionChangedChannel.payload.safeParse(connection).success, true);
  assert.equal(
    runtimeConnectionChangedChannel.payload.safeParse({ ...connection, stale: true }).success,
    false,
  );
  assert.equal(
    runtimeConnectionChangedChannel.payload.safeParse({
      state: 'incompatible',
      changedAt: 100,
      stale: true,
      reason: 'SDK capability unavailable',
      capabilities: [],
    }).success,
    true,
  );
});

test('session-scoped Runtime projections reject cross-session run, queue and interaction data', () => {
  const baseLive = {
    sessionId: 's_1',
    projectionRevision: 4,
    cursor,
    transcriptRevision: 'tx_4',
    queuedRuns: [],
    activeTools: [],
    todos: [],
    queuedInputs: [],
    interactions: [],
  } as const;
  const foreignRun = {
    runId: 'run_foreign',
    sessionId: 's_2',
    phase: 'running',
  } as const;
  const foreignInteraction = {
    source: 'coder-runtime',
    kind: 'permission',
    createdAt: 1,
    state: 'pending',
    request: {
      reqId: 'req_1',
      sessionId: 's_2',
      risk: 'low',
      reason: 'Read file',
      toolCall: { toolId: 'tool_1', toolName: 'read' },
    },
  } as const;

  assert.equal(
    spaceRuntimeProfileProjectionSchema.safeParse({
      connection,
      projectionRevision: 4,
      cursor,
      sessions: [
        {
          sessionId: 's_1',
          surface: 'code',
          createdAt: 1,
          lastActivityAt: 2,
          activeRun: foreignRun,
          queuedRuns: [],
        },
      ],
      interactions: [],
      notifications: [],
    }).success,
    false,
  );
  assert.equal(
    spaceSessionLiveProjectionSchema.safeParse({
      ...baseLive,
      interactions: [foreignInteraction],
    }).success,
    false,
  );

  for (const change of [
    { domain: 'run', activeRun: foreignRun, queuedRuns: [] },
    {
      domain: 'queue',
      queuedInputs: [
        {
          inputId: 'input_foreign',
          sessionId: 's_2',
          delivery: 'interrupt',
          state: 'queued',
          createdAt: 1,
        },
      ],
    },
    { domain: 'terminal', lastTerminalRun: { ...foreignRun, phase: 'completed' } },
    { domain: 'interaction', interactions: [foreignInteraction] },
  ] as const) {
    assert.equal(
      spaceSessionLiveChangedSchema.safeParse({
        sessionId: 's_1',
        baseProjectionRevision: 4,
        projectionRevision: 5,
        cursor: { runtimeId: 'rt_1', seq: 8 },
        change,
      }).success,
      false,
    );
  }
});

test('Runtime interaction projections preserve bounded display input and strip transport fields', () => {
  const parsed = spaceSessionLiveProjectionSchema.parse({
    sessionId: 's_1',
    projectionRevision: 1,
    cursor,
    transcriptRevision: 'tx_1',
    queuedRuns: [],
    activeTools: [],
    todos: [],
    queuedInputs: [],
    interactions: [
      {
        source: 'coder-runtime',
        kind: 'permission',
        createdAt: 1,
        state: 'pending',
        request: {
          reqId: 'req_1',
          sessionId: 's_1',
          risk: 'high',
          reason: 'Run command',
          allowAlwaysScope: {
            kind: 'runtime_persistent',
            label: 'Always allow this exact command: npm test',
          },
          toolCall: {
            toolId: 'tool_1',
            toolName: 'bash',
            input: { command: 'echo secret', apiKey: 'secret' },
            operation: 'execute',
            executionCwd: 'C:\\repo',
            transportSecret: 'secret',
          },
          daemonInternal: 'secret',
        },
      },
    ],
  });
  const interaction = parsed.interactions[0];
  assert.ok(interaction?.kind === 'permission');
  assert.deepEqual(interaction.request.toolCall.input, {
    command: 'echo secret',
    apiKey: 'secret',
  });
  assert.equal(interaction.request.toolCall.operation, 'execute');
  assert.equal(interaction.request.toolCall.executionCwd, 'C:\\repo');
  assert.deepEqual(interaction.request.allowAlwaysScope, {
    kind: 'runtime_persistent',
    label: 'Always allow this exact command: npm test',
  });
  assert.equal('transportSecret' in interaction.request.toolCall, false);
  assert.equal('daemonInternal' in interaction.request, false);

  assert.equal(
    spaceSessionLiveProjectionSchema.safeParse({
      ...parsed,
      interactions: [
        {
          ...interaction,
          request: { ...interaction.request, reqId: 'x'.repeat(129) },
        },
      ],
    }).success,
    false,
  );
});
