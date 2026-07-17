import assert from 'node:assert/strict';
import test from 'node:test';

import type {
  RuntimeSessionObservationSnapshot,
  RuntimeStatusSnapshot,
  RuntimeUserInputRequest,
  RuntimeTypedEvent,
} from '@kodax-ai/kodax/runtime';
import {
  CoderSessionProjectionReducer,
  projectRuntimeProfile,
  projectRuntimeSessionSnapshot,
} from '../kodax/runtime/coder-daemon-projection.js';

const running = {
  runId: 'run_active',
  sessionId: 's_code',
  phase: 'running',
  startedAt: '2026-07-14T08:00:00.000Z',
  provider: 'anthropic',
  sessionOrder: 2,
  origin: {
    principalId: 'client:space-installation',
    clientName: 'kodax-space',
    clientVersion: '0.1.32',
  },
  requirements: { hostTools: { leaseId: 'host_1', state: 'waiting_host' } },
} as const;

const queued = {
  runId: 'run_queued',
  sessionId: 's_code',
  phase: 'queued',
  startedAt: '2026-07-14T08:01:00.000Z',
  queuedAt: '2026-07-14T08:01:00.000Z',
  provider: 'anthropic',
  sessionOrder: 3,
  continuation: {
    inputId: 'input_after_turn',
    afterRunId: 'run_active',
    delivery: 'after_turn',
    state: 'queued',
    contentPreview: 'Also update the tests.',
  },
} as const;

const permission = {
  id: 'permission_1',
  sessionId: 's_code',
  runId: 'run_active',
  toolCallId: 'tool_1',
  toolName: 'bash',
  reason: 'Run tests',
  risk: 'high',
  inputPreview: JSON.stringify({
    command: 'npm test',
    description: 'Run the project test suite',
    apiKey: 'should-not-render',
  }),
  executionCwd: 'C:\\repo',
  createdAt: '2026-07-14T08:02:00.000Z',
} as const;

const askUser = {
  id: 'input_1',
  revision: 0,
  sessionId: 's_code',
  runId: 'run_active',
  kind: 'askUser',
  options: {
    question: 'Pick a strategy',
    options: [{ label: 'Safe', value: 'safe', description: 'Prefer the conservative path.' }],
  },
  createdAt: '2026-07-14T08:03:00.000Z',
  expiresAt: '2026-07-14T08:08:00.000Z',
} as const satisfies RuntimeUserInputRequest;

const observation = {
  runtimeId: 'rt_shared',
  cursor: 41,
  transcriptRevision: 'transcript_rev_41',
  session: {
    id: 's_code',
    title: 'Shared work',
    gitRoot: 'C:\\repo',
    surface: 'code',
    createdAt: '2026-07-14T07:59:00.000Z',
  },
  transcript: { title: 'Shared work', messages: [{ role: 'user', content: 'hello' }] },
  settings: {
    revision: 3,
    value: { provider: 'anthropic', agentMode: 'amaw', autoModeEngine: 'rules' },
  },
  runs: [running, queued],
  pendingPermissions: [permission],
  live: {
    assistantTextByRun: { run_active: 'partial answer' },
    thinkingTextByRun: { run_active: 'checking' },
    activeTools: [
      {
        key: 'run_active:tool_1',
        runId: 'run_active',
        started: {
          tool: { id: 'tool_1', name: 'bash' },
          meta: { toolCallId: 'tool_1' },
        },
        progress: { update: 'running tests' },
      },
    ],
    todo: {
      items: [
        {
          id: 'todo_1',
          subject: 'Run tests',
          activeForm: 'Running tests',
          status: 'in_progress',
        },
      ],
    },
    pendingUserInputs: [{ requestId: askUser.id, runId: askUser.runId, detail: askUser }],
    managedTasks: [
      {
        runId: 'run_active',
        status: {
          agentMode: 'amaw',
          harnessProfile: 'H2_PLAN_EXECUTE_EVAL',
          phase: 'verifying',
          activeWorkerId: 'worker_1',
          activeWorkerTitle: 'Evaluator',
          note: 'Checking the result',
        },
      },
    ],
  },
} as unknown as RuntimeSessionObservationSnapshot;

test('atomic observation maps run, draft, tool, Todo, and interaction truth', () => {
  const projection = projectRuntimeSessionSnapshot(observation, [askUser]);

  assert.equal(projection.cursor.runtimeId, 'rt_shared');
  assert.equal(projection.cursor.seq, 41);
  assert.equal(projection.activeRun?.runId, 'run_active');
  assert.equal(projection.activeRun?.initiatedBy?.name, 'kodax-space');
  assert.equal(projection.activeRun?.requirements?.hostTools, 'waiting_host');
  assert.deepEqual(
    projection.queuedRuns.map((run) => run.runId),
    ['run_queued'],
  );
  assert.equal(projection.assistantDraft?.text, 'partial answer');
  assert.equal(projection.thinkingDraft?.text, 'checking');
  assert.deepEqual(projection.activeTools, [
    {
      toolCallId: 'tool_1',
      name: 'bash',
      startedAt: Date.parse(running.startedAt),
      progress: 'running tests',
    },
  ]);
  assert.deepEqual(projection.todos, [
    {
      id: 'todo_1',
      content: 'Run tests',
      activeForm: 'Running tests',
      status: 'in_progress',
    },
  ]);
  assert.equal(projection.interactions.length, 2);
  const projectedPermission = projection.interactions.find((item) => item.kind === 'permission');
  assert.equal(projectedPermission?.kind, 'permission');
  if (projectedPermission?.kind === 'permission') {
    assert.equal(projectedPermission.request.reason, 'Run tests');
    assert.deepEqual(projectedPermission.request.toolCall, {
      toolId: 'tool_1',
      toolName: 'bash',
      operation: 'execute',
      executionCwd: 'C:\\repo',
      input: {
        command: 'npm test',
        description: 'Run the project test suite',
        apiKey: '[REDACTED]',
      },
    });
  }
  assert.deepEqual(projection.settings, {
    revision: 3,
    value: { provider: 'anthropic', agentMode: 'amaw', autoModeEngine: 'rules' },
  });
  assert.equal(projection.managedTask?.phase, 'verifying');
  assert.equal(projection.managedTask?.activeWorkerTitle, 'Evaluator');
  assert.equal(projection.transcriptRevision, 'transcript_rev_41');
  assert.deepEqual(projection.queuedInputs, [
    {
      inputId: 'input_after_turn',
      sessionId: 's_code',
      delivery: 'after-turn',
      state: 'queued',
      createdAt: Date.parse(queued.queuedAt),
      position: 1,
      contentPreview: 'Also update the tests.',
    },
  ]);
});

test('permission projection uses sanitized description, assessed risk, and settings cwd as fallbacks', () => {
  const fallbackObservation = {
    ...observation,
    settings: {
      ...observation.settings,
      value: { ...observation.settings.value, executionCwd: 'C:\\fallback-project' },
    },
    pendingPermissions: [
      {
        id: 'permission_fallback',
        sessionId: 's_code',
        runId: 'run_active',
        toolCallId: 'tool_fallback',
        toolName: 'bash',
        inputPreview: JSON.stringify({
          command: 'python -c "print(1)"',
          description: 'Inspect\u202e Python environment',
        }),
        createdAt: '2026-07-14T08:02:00.000Z',
      },
    ],
  } as unknown as RuntimeSessionObservationSnapshot;

  const projected = projectRuntimeSessionSnapshot(fallbackObservation, []);
  const interaction = projected.interactions[0];
  assert.equal(interaction?.kind, 'permission');
  if (interaction?.kind === 'permission') {
    assert.equal(interaction.request.reason, 'Inspect Python environment');
    assert.equal(interaction.request.risk, 'medium');
    assert.equal(interaction.request.toolCall.operation, 'execute');
    assert.equal(interaction.request.toolCall.executionCwd, 'C:\\fallback-project');
    assert.equal(interaction.request.toolCall.input?.command, 'python -c "print(1)"');
  }
});

test('permission projection does not parse oversized daemon previews', () => {
  const oversizedObservation = {
    ...observation,
    pendingPermissions: [
      {
        ...permission,
        id: 'permission_oversized',
        inputPreview: JSON.stringify({ command: 'x'.repeat(9_000) }),
      },
    ],
  } as unknown as RuntimeSessionObservationSnapshot;

  const projected = projectRuntimeSessionSnapshot(oversizedObservation, []);
  const interaction = projected.interactions[0];
  assert.equal(interaction?.kind, 'permission');
  if (interaction?.kind === 'permission') {
    assert.equal(interaction.request.toolCall.input?.command, undefined);
    assert.equal(interaction.request.toolCall.input?.__truncated, true);
    assert.equal(typeof interaction.request.toolCall.input?._inputPreview === 'string', true);
  }
});

test('permission projection omits non-object previews and marks truncated objects', () => {
  const malformedObservation = {
    ...observation,
    pendingPermissions: [
      {
        ...permission,
        id: 'permission_non_object',
        inputPreview: JSON.stringify('bare-secret-value'),
      },
      {
        ...permission,
        id: 'permission_many_keys',
        inputPreview: JSON.stringify(
          Object.fromEntries(Array.from({ length: 300 }, (_, index) => [`key-${index}`, index])),
        ),
      },
    ],
  } as unknown as RuntimeSessionObservationSnapshot;

  const projected = projectRuntimeSessionSnapshot(malformedObservation, []);
  const [nonObject, manyKeys] = projected.interactions;
  assert.equal(nonObject?.kind, 'permission');
  assert.equal(manyKeys?.kind, 'permission');
  if (nonObject?.kind === 'permission') {
    assert.equal(
      nonObject.request.toolCall.input?._inputPreview,
      '[OMITTED: non-object permission input preview]',
    );
    assert.equal(
      JSON.stringify(nonObject.request.toolCall.input).includes('bare-secret-value'),
      false,
    );
  }
  if (manyKeys?.kind === 'permission') {
    assert.equal(Object.keys(manyKeys.request.toolCall.input ?? {}).length, 128);
    assert.equal(manyKeys.request.toolCall.input?.__truncated, true);
  }
});

test('profile projection excludes Partner and attributes active/queued runs', () => {
  const status = {
    runtimeId: 'rt_shared',
    mode: 'daemon',
    profile: 'coder',
    startedAt: '2026-07-14T07:00:00.000Z',
    sessions: [
      {
        id: 's_code',
        title: 'Coder',
        gitRoot: 'C:\\repo',
        surface: 'code',
        createdAt: '2026-07-14T07:59:00.000Z',
        msgCount: 2,
      },
      {
        id: 's_partner',
        title: 'Partner',
        surface: 'partner',
        createdAt: '2026-07-14T07:58:00.000Z',
        msgCount: 2,
      },
    ],
    runs: [running, queued],
    pendingPermissions: [permission],
    workflows: [],
  } as unknown as RuntimeStatusSnapshot;

  const projection = projectRuntimeProfile({
    status,
    userInputs: [askUser],
    cursor: 41,
    projectionRevision: 7,
    changedAt: 100,
    capabilities: [{ id: 'runtime.daemon', version: 1, available: true }],
  });

  assert.deepEqual(
    projection.sessions.map((session) => session.sessionId),
    ['s_code'],
  );
  assert.equal(projection.sessions[0]?.activeRun?.runId, 'run_active');
  assert.deepEqual(
    projection.sessions[0]?.queuedRuns.map((run) => run.runId),
    ['run_queued'],
  );
  assert.equal(projection.interactions.length, 2);
});

test('event reducer advances one semantic domain per Runtime cursor', () => {
  const reducer = new CoderSessionProjectionReducer(
    projectRuntimeSessionSnapshot(observation, [askUser]),
    observation.runs,
  );
  const todoEvent = {
    id: 'event_42',
    seq: 42,
    time: '2026-07-14T08:04:00.000Z',
    sessionId: 's_code',
    runId: 'run_active',
    type: 'todo.updated',
    payload: {
      items: [{ id: 'todo_1', subject: 'Run tests', status: 'completed' }],
    },
  } as unknown as RuntimeTypedEvent;

  const update = reducer.apply(todoEvent);
  assert.equal(update?.change.domain, 'todos');
  assert.equal(update?.cursor.seq, 42);
  assert.equal(reducer.snapshot().todos[0]?.status, 'completed');
});

test('terminal and next-run events reset run-scoped live state before new deltas', () => {
  const reducer = new CoderSessionProjectionReducer(
    projectRuntimeSessionSnapshot(observation, [askUser]),
    observation.runs,
  );
  const terminal = reducer.apply({
    id: 'event_terminal_42',
    seq: 42,
    time: '2026-07-14T08:04:00.000Z',
    sessionId: 's_code',
    runId: 'run_active',
    type: 'run.completed',
    payload: {
      ...running,
      phase: 'completed',
      endedAt: '2026-07-14T08:04:00.000Z',
    },
  } as unknown as RuntimeTypedEvent);

  assert.equal(terminal?.change.domain, 'run');
  if (terminal?.change.domain === 'run') {
    assert.equal(terminal.change.resetRunScopedState, true);
  }
  assert.equal(reducer.snapshot().assistantDraft, undefined);
  assert.equal(reducer.snapshot().thinkingDraft, undefined);
  assert.deepEqual(reducer.snapshot().activeTools, []);
  assert.equal(reducer.snapshot().managedTask, undefined);
  assert.deepEqual(reducer.snapshot().interactions, []);
  assert.equal(reducer.snapshot().todos[0]?.id, 'todo_1');

  reducer.apply({
    id: 'event_next_run_43',
    seq: 43,
    time: '2026-07-14T08:05:00.000Z',
    sessionId: 's_code',
    runId: 'run_queued',
    type: 'run.started',
    payload: {
      ...queued,
      phase: 'running',
      runningAt: '2026-07-14T08:05:00.000Z',
    },
  } as unknown as RuntimeTypedEvent);
  reducer.apply({
    id: 'event_next_delta_44',
    seq: 44,
    time: '2026-07-14T08:05:01.000Z',
    sessionId: 's_code',
    runId: 'run_queued',
    type: 'assistant.delta',
    payload: { text: 'new answer' },
  } as unknown as RuntimeTypedEvent);

  assert.equal(reducer.snapshot().assistantDraft?.text, 'new answer');
});

test('projection restores multi-question input and advances revisioned settings', () => {
  const multi = {
    ...askUser,
    id: 'input_multi',
    kind: 'askUserMulti',
    options: {
      questions: [
        {
          question: 'Choose a strategy',
          header: 'Strategy',
          options: [{ label: 'Safe', value: 'safe' }],
        },
        {
          question: 'Choose checks',
          options: [{ label: 'Tests', value: 'tests' }],
          multiSelect: true,
        },
      ],
    },
  } as const satisfies RuntimeUserInputRequest;
  const reducer = new CoderSessionProjectionReducer(
    projectRuntimeSessionSnapshot(observation, [multi]),
    observation.runs,
  );
  const request = reducer.snapshot().interactions[1];
  assert.equal(request?.kind, 'ask-user');
  assert.equal(request?.request.kind, 'multi');

  const update = reducer.apply({
    id: 'event_settings_42',
    seq: 42,
    time: '2026-07-14T08:04:00.000Z',
    sessionId: 's_code',
    runId: 's_code',
    type: 'session.settings.updated',
    payload: {
      sessionId: 's_code',
      revision: 4,
      settings: { provider: 'openai', model: 'gpt-next', permissionMode: 'plan' },
    },
  } as unknown as RuntimeTypedEvent);
  assert.equal(update?.change.domain, 'settings');
  assert.deepEqual(reducer.snapshot().settings, {
    revision: 4,
    value: { provider: 'openai', model: 'gpt-next', permissionMode: 'plan' },
  });
});
