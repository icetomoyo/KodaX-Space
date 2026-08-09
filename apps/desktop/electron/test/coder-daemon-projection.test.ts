import assert from 'node:assert/strict';
import test from 'node:test';

import type {
  RuntimeSessionObservationSnapshot,
  RuntimeStatusSnapshot,
  RuntimeUserInputRequest,
  RuntimeTypedEvent,
} from '@kodax-ai/kodax/runtime';
import type { SpaceCoderConnectionProjectionT } from '@kodax-space/space-ipc-schema';
import {
  CoderSessionProjectionReducer,
  projectRuntimeProfile,
  projectRuntimeSessionSnapshot,
} from '../kodax/runtime/coder-daemon-projection.js';
import {
  runtimeConnectionSemanticallyEqual,
  runtimeEventChangesProfile,
  runtimeSessionEventOrigin,
} from '../kodax/runtime-host-adapter.js';

test('profile refresh classification excludes transcript hot-path events', () => {
  for (const type of [
    'assistant.delta',
    'thinking.delta',
    'thinking.finished',
    'tool.started',
    'tool.progress',
    'tool.finished',
    'run.progress',
    'todo.updated',
    'provider.cache.diagnostics',
  ] as const) {
    assert.equal(runtimeEventChangesProfile(type), false, type);
  }
  for (const type of [
    'session.created',
    'run.queued',
    'run.started',
    'run.updated',
    'run.input.queued',
    'permission.requested',
    'user_input.requested',
    'run.completed',
    'run.failed',
  ] as const) {
    assert.equal(runtimeEventChangesProfile(type), true, type);
  }
});

test('Runtime connection equality ignores refresh timestamps but detects authority changes', () => {
  const connection: SpaceCoderConnectionProjectionT = {
    state: 'ready',
    changedAt: 1,
    stale: false,
    runtimeId: 'rt_1',
    profile: 'coder',
    capabilities: [{ id: 'runtime.live.observe', version: 1, available: true }],
  };

  assert.equal(
    runtimeConnectionSemanticallyEqual(connection, { ...connection, changedAt: 2 }),
    true,
  );
  assert.equal(
    runtimeConnectionSemanticallyEqual(connection, {
      ...connection,
      runtimeId: 'rt_2',
      changedAt: 2,
    }),
    false,
  );
  assert.equal(
    runtimeConnectionSemanticallyEqual(connection, {
      ...connection,
      capabilities: [{ id: 'runtime.live.observe', version: 2, available: true }],
      changedAt: 2,
    }),
    false,
  );
  assert.equal(
    runtimeConnectionSemanticallyEqual(connection, {
      ...connection,
      changedAt: 2,
      integrations: { state: 'healthy', domains: [] },
    }),
    false,
  );
});

test('Runtime transcript events carry the daemon cursor used by snapshot reconciliation', () => {
  const event = {
    id: 'event_7',
    seq: 7,
    cursor: { sessionId: 's_1', journalEpoch: 'journal_epoch_1', seq: 7 },
    time: '2026-07-28T00:00:00.000Z',
    type: 'assistant.delta',
    sessionId: 's_1',
    runId: 'run_1',
    payload: { text: 'hello' },
  } satisfies RuntimeTypedEvent<'assistant.delta'>;

  assert.deepEqual(runtimeSessionEventOrigin('rt_1', event), {
    runtimeEvent: { runtimeId: 'rt_1', runId: 'run_1', seq: 7 },
  });
  assert.deepEqual(runtimeSessionEventOrigin(undefined, event), {});
});

const running = {
  runId: 'run_active',
  sessionId: 's_code',
  turnId: 'turn_active',
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
  autoModeDiagnostics: {
    source: 'classifier_failure',
    classifierFailureKind: 'timeout',
    classifierAttempts: [
      {
        attempt: 1,
        outcome: 'timeout',
        diagnostics: {
          provider: 'anthropic',
          model: 'fast-classifier',
          timeoutMs: 12_000,
          elapsedMs: 12_001,
          systemBytes: 512,
          messageBytes: 1_024,
          promptBytes: 1_536,
          retryCount: 0,
          retryWaitMs: 0,
          terminalPhase: 'pre_output',
        },
      },
      {
        attempt: 2,
        outcome: 'confirm',
        observedProtocol: 'structured_v2',
        outputWarnings: ['missing_hazard', 'missing_reason'],
        rawResponse: '<decision>ask</decision>',
      },
    ],
  },
  grantSuggestions: [
    { id: 'session_scope', kind: 'session', label: 'Allow this exact command for this task' },
    {
      id: 'persistent_scope',
      kind: 'persistent',
      label: 'Always allow this exact command: npm test',
    },
  ],
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
  cursor: {
    sessionId: 's_code',
    journalEpoch: 'journal_epoch_shared',
    seq: 41,
  },
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
    value: {
      provider: 'anthropic',
      effort: 'high',
      thinking: true,
      agentMode: 'ama',
      autoModeEngine: 'rules',
      autoModeClassifierModel: 'fast-classifier',
      autoModeTimeoutMs: 12_000,
    },
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
        sandbox: {
          update: {
            id: 'tool_1',
            observation: {
              version: 1,
              state: 'applied',
              backend: 'windows-restricted-user',
              policyId: 'kodax-workspace-shell-v1',
            },
          },
        },
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
          agentMode: 'ama',
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
  assert.equal(projection.cursor.sessionId, 's_code');
  assert.equal(projection.cursor.journalEpoch, 'journal_epoch_shared');
  assert.equal(projection.cursor.seq, 41);
  assert.equal(projection.activeRun?.runId, 'run_active');
  assert.equal(projection.activeRun?.turnId, 'turn_active');
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
      sandbox: {
        version: 1,
        state: 'applied',
        backend: 'windows-restricted-user',
        policyId: 'kodax-workspace-shell-v1',
      },
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
    assert.deepEqual(projectedPermission.request.allowAlwaysScope, {
      kind: 'runtime_persistent',
      label: 'Always allow this exact command: npm test',
    });
    assert.deepEqual(projectedPermission.request.autoModeDiagnostics, {
      source: 'classifier_failure',
      classifierFailureKind: 'timeout',
      classifierAttempts: [
        {
          attempt: 1,
          outcome: 'timeout',
          diagnostics: {
            provider: 'anthropic',
            model: 'fast-classifier',
            timeoutMs: 12_000,
            elapsedMs: 12_001,
            promptBytes: 1_536,
            retryCount: 0,
            retryWaitMs: 0,
            terminalPhase: 'pre_output',
          },
        },
        {
          attempt: 2,
          outcome: 'confirm',
          observedProtocol: 'structured_v2',
          outputWarnings: ['missing_hazard', 'missing_reason'],
        },
      ],
    });
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
    value: {
      provider: 'anthropic',
      effort: 'high',
      thinking: true,
      agentMode: 'ama',
      autoModeEngine: 'rules',
      autoModeClassifierModel: 'fast-classifier',
      autoModeTimeoutMs: 12_000,
    },
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

test('a terminal observation never projects residual or foreign Run drafts as answer text', () => {
  const terminalObservation = {
    ...observation,
    cursor: { ...observation.cursor, seq: 42 },
    runs: [
      {
        ...running,
        phase: 'completed',
        endedAt: '2026-07-14T08:04:00.000Z',
      },
    ],
    live: {
      ...observation.live,
      assistantTextByRun: {
        run_active: 'residual completed answer',
        run_foreign: 'foreign answer',
      },
      thinkingTextByRun: {
        run_active: 'residual completed thinking',
        run_foreign: 'foreign thinking',
      },
    },
  } as unknown as RuntimeSessionObservationSnapshot;

  const projection = projectRuntimeSessionSnapshot(terminalObservation, []);
  assert.equal(projection.activeRun, undefined);
  assert.equal(projection.lastTerminalRun?.runId, 'run_active');
  assert.equal(projection.assistantDraft, undefined);
  assert.equal(projection.thinkingDraft, undefined);
});

test('waiting-agent, recovering, and unknown lifecycle phases remain authoritative active Runs', () => {
  for (const phase of ['waiting_agent', 'recovering', 'unknown'] as const) {
    const projected = projectRuntimeSessionSnapshot(
      {
        ...observation,
        runs: [
          {
            ...running,
            phase,
            stage: phase,
            stageChangedAt: '2026-07-14T08:04:00.000Z',
            activeSubtaskCount: phase === 'waiting_agent' ? 2 : 0,
            ...(phase === 'unknown'
              ? {
                  lifecycleError: {
                    code: 'actor_settlement_not_persisted',
                    message: 'Actor state could not be persisted.',
                    retryable: false,
                  },
                  stop: {
                    requestedAt: '2026-07-14T08:05:00.000Z',
                    state: 'unknown',
                    outcome: 'unknown',
                    reason: 'Host outcome could not be confirmed.',
                  },
                }
              : {}),
          },
        ],
      } as unknown as RuntimeSessionObservationSnapshot,
      [],
    );

    assert.equal(projected.activeRun?.phase, phase);
    assert.equal(projected.activeRun?.stage, phase);
    assert.equal(projected.activeRun?.activeSubtaskCount, phase === 'waiting_agent' ? 2 : 0);
    if (phase === 'unknown') {
      assert.equal(projected.activeRun?.stop?.state, 'unknown');
      assert.deepEqual(projected.activeRun?.lifecycleError, {
        code: 'actor_settlement_not_persisted',
        message: 'Actor state could not be persisted.',
        retryable: false,
      });
    }
  }
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

test('permission projection never offers a persistent grant for dangerous commands', () => {
  const dangerousObservation = {
    ...observation,
    pendingPermissions: [
      {
        ...permission,
        id: 'permission_dangerous',
        inputPreview: JSON.stringify({ command: 'rm -rf /' }),
      },
    ],
  } as unknown as RuntimeSessionObservationSnapshot;

  const projected = projectRuntimeSessionSnapshot(dangerousObservation, []);
  const interaction = projected.interactions[0];
  assert.equal(interaction?.kind, 'permission');
  if (interaction?.kind === 'permission') {
    assert.equal(interaction.request.risk, 'danger');
    assert.equal(interaction.request.allowAlwaysScope, undefined);
  }
});

test('permission projection hides Always allow when Runtime omits a persistent suggestion', () => {
  const sessionOnlyObservation = {
    ...observation,
    pendingPermissions: [
      {
        ...permission,
        id: 'permission_session_only',
        grantSuggestions: [permission.grantSuggestions[0]],
      },
    ],
  } as unknown as RuntimeSessionObservationSnapshot;

  const projected = projectRuntimeSessionSnapshot(sessionOnlyObservation, []);
  const interaction = projected.interactions[0];
  assert.equal(interaction?.kind, 'permission');
  if (interaction?.kind === 'permission') {
    assert.equal(interaction.request.allowAlwaysScope, undefined);
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

test('permission projection recovers bounded display fields from a truncated object preview', () => {
  const targetPath = 'C:\\workspace\\demo.html';
  const truncatedInputPreview =
    `${JSON.stringify({ path: targetPath }).slice(0, -1)},` +
    '"content":"<!DOCTYPE html><html><body>unterminated';
  const truncatedObservation = {
    ...observation,
    pendingPermissions: [
      {
        ...permission,
        id: 'permission_truncated_object',
        toolName: 'write',
        inputPreview: truncatedInputPreview,
      },
    ],
  } as unknown as RuntimeSessionObservationSnapshot;

  const projected = projectRuntimeSessionSnapshot(truncatedObservation, []);
  const interaction = projected.interactions[0];
  assert.equal(interaction?.kind, 'permission');
  if (interaction?.kind === 'permission') {
    assert.equal(interaction.request.toolCall.operation, 'write');
    assert.equal(interaction.request.toolCall.input?.path, targetPath);
    assert.equal(interaction.request.toolCall.input?.content, undefined);
    assert.equal(interaction.request.toolCall.input?.__truncated, true);
    assert.equal(
      interaction.request.toolCall.input?._inputPreview,
      '[PARTIAL: recovered display fields from truncated permission input preview]',
    );
  }
});

test('truncated preview recovery stays top-level and preserves command redaction', () => {
  const secretCommand = 'curl -H "Authorization: Bearer private-token" https://example.test';
  const safePrefix =
    `${JSON.stringify({ command: secretCommand }).slice(0, -1)},` + '"content":"unterminated';
  const misleadingNestedPrefix =
    '{"content":"escaped \\"path\\":\\"C:\\\\secret.txt\\" remains unterminated';
  const truncatedObservation = {
    ...observation,
    pendingPermissions: [
      { ...permission, id: 'permission_recovered_command', inputPreview: safePrefix },
      {
        ...permission,
        id: 'permission_misleading_nested',
        toolName: 'write',
        inputPreview: misleadingNestedPrefix,
      },
    ],
  } as unknown as RuntimeSessionObservationSnapshot;

  const projected = projectRuntimeSessionSnapshot(truncatedObservation, []);
  const [recovered, misleading] = projected.interactions;
  assert.equal(recovered?.kind, 'permission');
  assert.equal(misleading?.kind, 'permission');
  if (recovered?.kind === 'permission') {
    assert.equal(
      recovered.request.toolCall.input?.command,
      'curl -H "Authorization: [REDACTED]" https://example.test',
    );
  }
  if (misleading?.kind === 'permission') {
    assert.equal(misleading.request.toolCall.input?.path, undefined);
    assert.equal(
      misleading.request.toolCall.input?._inputPreview,
      '[OMITTED: invalid permission input preview]',
    );
    assert.equal(JSON.stringify(misleading.request.toolCall.input).includes('secret.txt'), false);
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
      {
        id: 's_tag_only_partner',
        title: 'Legacy Partner',
        tag: 'partner',
        createdAt: '2026-07-14T07:57:00.000Z',
        msgCount: 2,
      },
      {
        id: 's_profile_partner',
        title: 'Profile Partner',
        profileId: 'kodax-space.partner',
        createdAt: '2026-07-14T07:56:00.000Z',
        msgCount: 2,
      },
    ],
    runs: [running, queued],
    pendingPermissions: [
      permission,
      { ...permission, id: 'permission_partner', sessionId: 's_tag_only_partner' },
    ],
    workflows: [],
  } as unknown as RuntimeStatusSnapshot;

  const projection = projectRuntimeProfile({
    status,
    userInputs: [askUser, { ...askUser, id: 'input_partner', sessionId: 's_profile_partner' }],
    cursor: 41,
    projectionRevision: 7,
    changedAt: 100,
    capabilities: [{ id: 'runtime.daemon', version: 1, available: true }],
    integrations: {
      state: 'degraded',
      domains: [
        {
          domain: 'extensions',
          path: 'C:\\Users\\you\\.kodax\\integrations\\extensions.json',
          source: 'user',
          watching: true,
          diagnostic: {
            code: 'activation-failed',
            message: 'Extension activation failed; last-known-good paths remain active.',
            time: '2026-07-29T08:00:00.000Z',
          },
        },
      ],
    },
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
  assert.deepEqual(
    projection.interactions.map((interaction) => interaction.request.sessionId),
    ['s_code', 's_code'],
  );
  assert.deepEqual(projection.connection.integrations, {
    state: 'degraded',
    domains: [
      {
        domain: 'extensions',
        path: 'C:\\Users\\you\\.kodax\\integrations\\extensions.json',
        source: 'user',
        watching: true,
        diagnostic: {
          code: 'activation-failed',
          message: 'Extension activation failed; last-known-good paths remain active.',
          time: Date.parse('2026-07-29T08:00:00.000Z'),
        },
      },
    ],
  });
});

test('profile projection retains verified Coder activity omitted from the bounded recent list', () => {
  const omittedRunning = {
    ...running,
    runId: 'run_omitted_active',
    sessionId: 's_omitted_active',
    startedAt: '2026-07-14T08:10:00.000Z',
    runningAt: '2026-07-14T08:10:01.000Z',
  };
  const status = {
    runtimeId: 'rt_shared',
    mode: 'daemon',
    profile: 'coder',
    startedAt: '2026-07-14T07:00:00.000Z',
    sessions: [
      {
        id: 's_recent_idle',
        title: 'Recent idle',
        surface: 'code',
        createdAt: '2026-07-14T08:09:00.000Z',
        msgCount: 2,
      },
    ],
    runs: [omittedRunning],
    pendingPermissions: [],
    workflows: [],
  } as unknown as RuntimeStatusSnapshot;

  const projection = projectRuntimeProfile({
    status,
    verifiedOutOfPageCoderSessionIds: new Set(['s_omitted_active']),
    userInputs: [],
    cursor: 42,
    projectionRevision: 8,
    changedAt: 101,
    capabilities: [{ id: 'runtime.daemon', version: 1, available: true }],
  });

  assert.deepEqual(
    projection.sessions.map((session) => session.sessionId),
    ['s_recent_idle', 's_omitted_active'],
  );
  assert.equal(projection.sessions[1]?.activeRun?.runId, 'run_omitted_active');
  assert.equal(
    projection.sessions[1]?.createdAt,
    Date.parse('2026-07-14T08:10:00.000Z'),
  );
});

test('profile projection fails closed for unverified active Sessions outside the recent list', () => {
  const status = {
    runtimeId: 'rt_shared',
    mode: 'daemon',
    profile: 'coder',
    startedAt: '2026-07-14T07:00:00.000Z',
    sessions: [
      {
        id: 's_recent_idle',
        title: 'Recent idle',
        surface: 'code',
        createdAt: '2026-07-14T08:09:00.000Z',
        msgCount: 2,
      },
    ],
    runs: [
      {
        ...running,
        runId: 'run_unknown_active',
        sessionId: 's_unknown_active',
      },
    ],
    pendingPermissions: [],
    workflows: [],
  } as unknown as RuntimeStatusSnapshot;

  const projection = projectRuntimeProfile({
    status,
    userInputs: [],
    cursor: 43,
    projectionRevision: 9,
    changedAt: 102,
    capabilities: [{ id: 'runtime.daemon', version: 1, available: true }],
  });

  assert.deepEqual(
    projection.sessions.map((session) => session.sessionId),
    ['s_recent_idle'],
  );
});

test('tool sandbox events update active-tool diagnostics without creating transcript text', () => {
  const reducer = new CoderSessionProjectionReducer(
    projectRuntimeSessionSnapshot(observation, [askUser]),
    observation.runs,
  );

  const change = reducer.apply({
    id: 'event_sandbox_42',
    seq: 42,
    time: '2026-07-14T08:04:00.000Z',
    sessionId: 's_code',
    runId: 'run_active',
    type: 'tool.sandbox',
    payload: {
      update: {
        id: 'tool_1',
        observation: {
          version: 1,
          state: 'fallback',
          reason: 'not_ready',
          execution: 'normal_permission_policy',
        },
      },
      meta: { toolCallId: 'tool_1' },
    },
  } as unknown as RuntimeTypedEvent);

  assert.equal(change?.change.domain, 'tools');
  assert.deepEqual(reducer.snapshot().activeTools[0]?.sandbox, {
    version: 1,
    state: 'fallback',
    reason: 'not_ready',
    execution: 'normal_permission_policy',
  });
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

test('event reducer keeps child activity out of the primary live projection', () => {
  const reducer = new CoderSessionProjectionReducer(
    projectRuntimeSessionSnapshot(observation, [askUser]),
    observation.runs,
  );
  const childMeta = {
    contextKind: 'child',
    contextId: 'child_context_1',
    parentContextId: 's_code',
    childAgentId: 'child_1',
    liveOnly: true,
    toolCallId: 'child_tool',
  } as const;

  assert.equal(
    reducer.apply({
      id: 'event_child_text_42',
      seq: 42,
      time: '2026-07-14T08:04:00.000Z',
      sessionId: 's_code',
      runId: 'run_active',
      type: 'assistant.delta',
      payload: { text: 'child answer', meta: childMeta },
    } as unknown as RuntimeTypedEvent),
    null,
  );
  assert.equal(
    reducer.apply({
      id: 'event_child_thinking_43',
      seq: 43,
      time: '2026-07-14T08:04:01.000Z',
      sessionId: 's_code',
      runId: 'run_active',
      type: 'thinking.delta',
      payload: { text: 'child reasoning', meta: childMeta },
    } as unknown as RuntimeTypedEvent),
    null,
  );
  assert.equal(
    reducer.apply({
      id: 'event_child_tool_44',
      seq: 44,
      time: '2026-07-14T08:04:02.000Z',
      sessionId: 's_code',
      runId: 'run_active',
      type: 'tool.started',
      payload: { tool: { id: 'child_tool', name: 'read' }, meta: childMeta },
    } as unknown as RuntimeTypedEvent),
    null,
  );
  assert.equal(
    reducer.apply({
      id: 'event_child_todo_45',
      seq: 45,
      time: '2026-07-14T08:04:03.000Z',
      sessionId: 's_code',
      runId: 'run_active',
      type: 'todo.updated',
      payload: {
        items: [{ id: 'child_todo', subject: 'Child work', status: 'in_progress' }],
        meta: childMeta,
      },
    } as unknown as RuntimeTypedEvent),
    null,
  );

  const unchanged = reducer.snapshot();
  assert.equal(unchanged.cursor.seq, 41);
  assert.equal(unchanged.assistantDraft?.text, 'partial answer');
  assert.equal(unchanged.thinkingDraft?.text, 'checking');
  assert.deepEqual(
    unchanged.activeTools.map((tool) => tool.toolCallId),
    ['tool_1'],
  );
  assert.equal(unchanged.todos[0]?.id, 'todo_1');

  reducer.apply({
    id: 'event_root_text_46',
    seq: 46,
    time: '2026-07-14T08:04:04.000Z',
    sessionId: 's_code',
    runId: 'run_active',
    type: 'assistant.delta',
    payload: { text: ' root continuation', meta: { contextKind: 'root' } },
  } as unknown as RuntimeTypedEvent);
  assert.equal(reducer.snapshot().assistantDraft?.text, 'partial answer root continuation');
  assert.equal(reducer.snapshot().cursor.seq, 46);
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
