// F121 SDK-neutral Runtime projections.
//
// These DTOs are owned by Space. They intentionally describe sanitized product
// state instead of mirroring unpublished KodaX daemon transport payloads.

import { z } from 'zod';
import { autoModeDecisionDiagnosticsSchema } from './permission.js';

const MAX_ID = 128;
const MAX_REASON = 512;
const MAX_DRAFT = 256 * 1024;
const MAX_PROFILE_SESSIONS = 500;
const MAX_QUEUE_ITEMS = 500;
const MAX_INTERACTIONS = 500;
const MAX_NOTIFICATIONS = 500;
const MAX_TODOS = 1_000;
const MAX_ACTIVE_TOOLS = 128;

const idSchema = z.string().min(1).max(MAX_ID);
const timestampSchema = z.number().int().nonnegative();

export const spaceRuntimeCursorSchema = z
  .object({
    runtimeId: idSchema,
    seq: z.number().int().nonnegative(),
  })
  .strict();

export const spaceRuntimeInitiatorSchema = z
  .object({
    clientId: idSchema,
    name: z.string().min(1).max(128),
    title: z.string().min(1).max(160).optional(),
  })
  .strict();

export const spaceRuntimeCapabilitySchema = z
  .object({
    id: z.string().min(1).max(128),
    version: z.number().int().positive().max(10_000),
    available: z.boolean(),
    reason: z.string().min(1).max(MAX_REASON).optional(),
  })
  .strict();

const spaceRuntimeIntegrationDiagnosticSchema = z
  .object({
    code: z.enum(['invalid-config', 'activation-failed', 'watcher-degraded']),
    message: z.string().min(1).max(MAX_REASON),
    time: timestampSchema,
  })
  .strict();

const spaceRuntimeIntegrationDomainSchema = z
  .object({
    domain: z.enum(['mcp', 'a2a', 'extensions']),
    path: z.string().min(1).max(4096),
    revision: z.string().min(1).max(256).optional(),
    source: z.enum(['user', 'legacy-user', 'default']).optional(),
    lastReloadAt: timestampSchema.optional(),
    diagnostic: spaceRuntimeIntegrationDiagnosticSchema.optional(),
    watching: z.boolean(),
  })
  .strict();

export const spaceRuntimeIntegrationHealthSchema = z
  .object({
    state: z.enum(['healthy', 'degraded']),
    domains: z.array(spaceRuntimeIntegrationDomainSchema).max(3),
  })
  .strict();

export const spaceCoderConnectionStateSchema = z.enum([
  'connecting',
  'ready',
  'reconnecting',
  'degraded',
  'incompatible',
  'disconnected',
]);

export const spaceCoderConnectionProjectionSchema = z
  .object({
    state: spaceCoderConnectionStateSchema,
    changedAt: timestampSchema,
    stale: z.boolean(),
    runtimeId: idSchema.optional(),
    profile: z.string().min(1).max(256).optional(),
    reason: z.string().min(1).max(MAX_REASON).optional(),
    capabilities: z.array(spaceRuntimeCapabilitySchema).max(128),
    integrations: spaceRuntimeIntegrationHealthSchema.optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.state === 'ready' && value.stale) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'ready Runtime projections cannot be stale',
        path: ['stale'],
      });
    }
    if ((value.state === 'ready' || value.state === 'degraded') && !value.runtimeId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${value.state} Runtime projections require runtimeId`,
        path: ['runtimeId'],
      });
    }
  });

export const spaceRuntimeRunPhaseSchema = z.enum([
  'queued',
  'starting',
  'running',
  'waiting_agent',
  'recovering',
  'waiting_permission',
  'waiting_user_input',
  'waiting_credential',
  'cancelling',
  'unknown',
  'completed',
  'cancelled',
  'failed',
  'interrupted',
]);

export const spaceRuntimeRunStopReceiptSchema = z
  .object({
    runId: idSchema,
    sessionId: idSchema,
    accepted: z.boolean(),
    state: z.enum(['unknown', 'confirmed']),
    outcome: z.enum(['unknown', 'cancelled', 'interrupted', 'completed', 'failed']),
    phase: z.enum([
      'queued',
      'running',
      'waiting_agent',
      'recovering',
      'waiting_permission',
      'waiting_user_input',
      'unknown',
      'completed',
      'failed',
      'cancelled',
      'interrupted',
    ]),
    revision: z.number().int().nonnegative(),
  })
  .strict();

export const spaceRuntimeRunStageSchema = z.enum([
  'queued',
  'executing',
  'waiting_agent',
  'recovering',
  'finalizing',
  'terminal',
  'unknown',
  'starting',
  'routing',
  'preflight',
  'round',
  'worker',
  'upgrade',
  'verifying',
]);

export const spaceRuntimeRunProjectionSchema = z
  .object({
    runId: idSchema,
    sessionId: idSchema,
    phase: spaceRuntimeRunPhaseSchema,
    stage: spaceRuntimeRunStageSchema.optional(),
    stageChangedAt: timestampSchema.optional(),
    activeSubtaskCount: z.number().int().nonnegative().optional(),
    queuedAt: timestampSchema.optional(),
    startedAt: timestampSchema.optional(),
    completedAt: timestampSchema.optional(),
    queuePosition: z.number().int().positive().max(MAX_QUEUE_ITEMS).optional(),
    terminalReason: z.string().min(1).max(MAX_REASON).optional(),
    lifecycleError: z
      .object({
        code: z.enum(['actor_settlement_retrying', 'actor_settlement_not_persisted']),
        message: z.string().min(1).max(MAX_REASON),
        retryable: z.boolean(),
      })
      .strict()
      .optional(),
    initiatedBy: spaceRuntimeInitiatorSchema.optional(),
    requirements: z
      .object({
        credential: z.enum(['ready', 'expired', 'terminal']).optional(),
        hostTools: z.enum(['ready', 'waiting_host', 'expired', 'terminal']).optional(),
      })
      .strict()
      .optional(),
    stop: z
      .object({
        requestedAt: timestampSchema,
        state: z.enum(['unknown', 'confirmed']),
        outcome: z.enum(['unknown', 'cancelled', 'interrupted', 'completed', 'failed']),
        reason: z.string().min(1).max(MAX_REASON),
        resolvedAt: timestampSchema.optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

const ACTIVE_RUN_PHASES: ReadonlySet<z.infer<typeof spaceRuntimeRunPhaseSchema>> = new Set([
  'starting',
  'running',
  'waiting_agent',
  'recovering',
  'waiting_permission',
  'waiting_user_input',
  'waiting_credential',
  'cancelling',
  'unknown',
]);
const TERMINAL_RUN_PHASES: ReadonlySet<z.infer<typeof spaceRuntimeRunPhaseSchema>> = new Set([
  'completed',
  'cancelled',
  'failed',
  'interrupted',
]);

function addRunOwnershipIssues(
  sessionId: string,
  activeRun: z.infer<typeof spaceRuntimeRunProjectionSchema> | undefined,
  queuedRuns: readonly z.infer<typeof spaceRuntimeRunProjectionSchema>[],
  lastTerminalRun: z.infer<typeof spaceRuntimeRunProjectionSchema> | undefined,
  ctx: z.RefinementCtx,
): void {
  const runs = [activeRun, lastTerminalRun, ...queuedRuns].filter(
    (run): run is z.infer<typeof spaceRuntimeRunProjectionSchema> => run !== undefined,
  );
  if (runs.some((run) => run.sessionId !== sessionId)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'all run projections must belong to their containing session',
      path: ['activeRun'],
    });
  }
  if (activeRun && !ACTIVE_RUN_PHASES.has(activeRun.phase)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'activeRun must have an active phase',
      path: ['activeRun', 'phase'],
    });
  }
  if (queuedRuns.some((run) => run.phase !== 'queued')) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'queuedRuns must have the queued phase',
      path: ['queuedRuns'],
    });
  }
  if (lastTerminalRun && !TERMINAL_RUN_PHASES.has(lastTerminalRun.phase)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'lastTerminalRun must have a terminal phase',
      path: ['lastTerminalRun', 'phase'],
    });
  }
}

export const spaceRuntimeSessionProfileSchema = z
  .object({
    sessionId: idSchema,
    surface: z.literal('code'),
    title: z.string().max(256).optional(),
    projectRoot: z.string().min(1).max(4096).optional(),
    createdAt: timestampSchema,
    lastActivityAt: timestampSchema,
    activeRun: spaceRuntimeRunProjectionSchema.optional(),
    queuedRuns: z.array(spaceRuntimeRunProjectionSchema).max(MAX_QUEUE_ITEMS),
    lastTerminalRun: spaceRuntimeRunProjectionSchema.optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    addRunOwnershipIssues(
      value.sessionId,
      value.activeRun,
      value.queuedRuns,
      value.lastTerminalRun,
      ctx,
    );
  });

const interactionBaseSchema = z.object({
  source: z.literal('coder-runtime'),
  runId: idSchema.optional(),
  createdAt: timestampSchema,
  state: z.enum(['pending', 'resolved', 'dismissed', 'expired']),
});

// Restorable Runtime interactions carry only the bounded, display-sanitized
// fields required by the permission modal. Daemon-private fields are stripped
// while parsing into the Space-owned projection.
const runtimeInteractionInputSchema = z
  .record(z.unknown())
  .refine((value) => Object.keys(value).length <= 128, 'permission input has too many fields');
const runtimeInteractionToolCallSchema = z.object({
  toolId: idSchema,
  toolName: z.string().min(1).max(128),
  input: runtimeInteractionInputSchema.optional(),
  operation: z.enum(['read', 'write', 'execute', 'network', 'unknown']).optional(),
  executionCwd: z.string().min(1).max(4096).optional(),
});
const runtimePermissionAllowAlwaysScopeSchema = z
  .object({
    kind: z.literal('runtime_persistent'),
    label: z.string().min(1).max(512),
  })
  .strict();
const runtimePermissionRequestSchema = z.object({
  reqId: idSchema,
  sessionId: idSchema,
  risk: z.enum(['low', 'medium', 'high', 'danger']),
  reason: z.string().max(512),
  toolCall: runtimeInteractionToolCallSchema,
  autoModeDiagnostics: autoModeDecisionDiagnosticsSchema.optional(),
  suggestedPattern: z.string().min(1).max(512).optional(),
  allowAlwaysScope: runtimePermissionAllowAlwaysScopeSchema.optional(),
});
const runtimeAskUserSignalSchema = z.object({
  type: z.string().min(1).max(64),
  severity: z.enum(['info', 'warning', 'danger']),
  message: z.string().max(512),
});
const runtimeAskUserOptionSchema = z.object({
  label: z.string().min(1).max(160),
  description: z.string().max(512).optional(),
  value: z.string().min(1).max(512),
});
const runtimeAskUserGuardrailSchema = z.object({
  kind: z.literal('guardrail').optional(),
  reqId: idSchema,
  sessionId: idSchema,
  reason: z.string().min(1).max(2048),
  toolCall: runtimeInteractionToolCallSchema,
  signals: z.array(runtimeAskUserSignalSchema).max(20).optional(),
});
const runtimeAskUserQuestionSchema = z
  .object({
    kind: z.enum(['select', 'input']),
    reqId: idSchema,
    sessionId: idSchema,
    question: z.string().min(1).max(2048),
    header: z.string().min(1).max(96).optional(),
    options: z.array(runtimeAskUserOptionSchema).max(20).optional(),
    multiSelect: z.boolean().optional(),
    minSelections: z.number().int().min(0).max(20).optional(),
    maxSelections: z.number().int().min(0).max(20).optional(),
    default: z.string().max(4096).optional(),
    allowCustomInput: z.boolean().optional(),
    customInputLabel: z.string().min(1).max(160).optional(),
    customInputPrompt: z.string().max(512).optional(),
    customInputDefault: z.string().max(4096).optional(),
  })
  .superRefine((request, ctx) => {
    if (request.kind === 'select' && (!request.options || request.options.length === 0)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'select askUser requests require at least one option',
        path: ['options'],
      });
    }
    if (
      request.minSelections !== undefined &&
      request.maxSelections !== undefined &&
      request.minSelections > request.maxSelections
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'minSelections cannot exceed maxSelections',
        path: ['maxSelections'],
      });
    }
  });
const runtimeAskUserMultiQuestionSchema = z
  .object({
    question: z.string().min(1).max(2048),
    header: z.string().min(1).max(96).optional(),
    options: z.array(runtimeAskUserOptionSchema).min(1).max(20),
    multiSelect: z.boolean().optional(),
    minSelections: z.number().int().min(0).max(20).optional(),
    maxSelections: z.number().int().min(0).max(20).optional(),
    allowCustomInput: z.boolean().optional(),
    customInputLabel: z.string().min(1).max(160).optional(),
    customInputPrompt: z.string().max(512).optional(),
    customInputDefault: z.string().max(4096).optional(),
  })
  .superRefine((request, ctx) => {
    if (
      request.minSelections !== undefined &&
      request.maxSelections !== undefined &&
      request.minSelections > request.maxSelections
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'minSelections cannot exceed maxSelections',
        path: ['maxSelections'],
      });
    }
  });
const runtimeAskUserMultiSchema = z.object({
  kind: z.literal('multi'),
  reqId: idSchema,
  sessionId: idSchema,
  questions: z.array(runtimeAskUserMultiQuestionSchema).min(1).max(20),
});
const runtimeAskUserRequestSchema = z.union([
  runtimeAskUserGuardrailSchema,
  runtimeAskUserQuestionSchema,
  runtimeAskUserMultiSchema,
]);

export const spaceRuntimeInteractionSchema = z.discriminatedUnion('kind', [
  interactionBaseSchema
    .extend({
      kind: z.literal('permission'),
      request: runtimePermissionRequestSchema,
    })
    .strict(),
  interactionBaseSchema
    .extend({
      kind: z.literal('ask-user'),
      request: runtimeAskUserRequestSchema,
    })
    .strict(),
]);

export const spaceRuntimeNotificationSchema = z
  .object({
    notificationId: idSchema,
    kind: z.enum(['run_terminal', 'permission', 'ask_user']),
    sessionId: idSchema,
    runId: idSchema.optional(),
    createdAt: timestampSchema,
    title: z.string().min(1).max(280),
    body: z.string().max(280).optional(),
    acknowledged: z.boolean(),
  })
  .strict();

export const spaceRuntimeProfileProjectionSchema = z
  .object({
    connection: spaceCoderConnectionProjectionSchema,
    projectionRevision: z.number().int().nonnegative(),
    cursor: spaceRuntimeCursorSchema.optional(),
    sessions: z.array(spaceRuntimeSessionProfileSchema).max(MAX_PROFILE_SESSIONS),
    interactions: z.array(spaceRuntimeInteractionSchema).max(MAX_INTERACTIONS),
    notifications: z.array(spaceRuntimeNotificationSchema).max(MAX_NOTIFICATIONS),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      (value.connection.state === 'ready' || value.connection.state === 'degraded') &&
      !value.cursor
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'connected profile projections require a Runtime cursor',
        path: ['cursor'],
      });
    }
    if (
      value.cursor &&
      value.connection.runtimeId &&
      value.cursor.runtimeId !== value.connection.runtimeId
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'profile cursor runtimeId must match the connection runtimeId',
        path: ['cursor', 'runtimeId'],
      });
    }
  });

export const spaceRuntimeDraftSchema = z
  .object({
    text: z.string().max(MAX_DRAFT),
    startedAt: timestampSchema,
  })
  .strict();

export const spaceRuntimeToolSandboxSchema = z.discriminatedUnion('state', [
  z
    .object({
      version: z.literal(1),
      state: z.literal('applied'),
      backend: z.enum([
        'windows-restricted-user',
        'macos-seatbelt',
        'linux-bubblewrap',
        'unsupported',
      ]),
      policyId: z.literal('kodax-workspace-shell-v1'),
    })
    .strict(),
  z
    .object({
      version: z.literal(1),
      state: z.literal('fallback'),
      reason: z.enum(['not_ready', 'prepare_failed', 'backend_failed']),
      execution: z.literal('normal_permission_policy'),
    })
    .strict(),
  z
    .object({
      version: z.literal(1),
      state: z.literal('not_selected'),
    })
    .strict(),
]);

export const spaceRuntimeActiveToolSchema = z
  .object({
    toolCallId: idSchema,
    name: z.string().min(1).max(128),
    startedAt: timestampSchema,
    progress: z.string().max(1024).optional(),
    sandbox: spaceRuntimeToolSandboxSchema.optional(),
  })
  .strict();

export const spaceRuntimeTodoSchema = z
  .object({
    id: idSchema,
    content: z.string().min(1).max(2048),
    activeForm: z.string().max(2048).optional(),
    status: z.enum(['pending', 'in_progress', 'completed', 'failed', 'skipped', 'cancelled']),
  })
  .strict();

export const spaceRuntimeManagedTaskSchema = z
  .object({
    phase: z.string().min(1).max(64),
    activeWorkerId: idSchema.optional(),
    activeWorkerTitle: z.string().max(256).optional(),
    summary: z.string().max(1024).optional(),
    updatedAt: timestampSchema,
  })
  .strict();

export const spaceRuntimeSessionSettingsSchema = z
  .object({
    revision: z.number().int().nonnegative(),
    value: z
      .object({
        provider: z.string().min(1).max(64).optional(),
        model: z.string().min(1).max(128).optional(),
        effort: z.string().min(1).max(64).optional(),
        thinking: z.boolean().optional(),
        reasoningMode: z.enum(['off', 'auto', 'quick', 'balanced', 'deep']).optional(),
        permissionMode: z.enum(['plan', 'accept-edits', 'auto']).optional(),
        executionCwd: z.string().min(1).max(4096).optional(),
        agentMode: z.enum(['ama', 'sa']).optional(),
        autoModeEngine: z.enum(['llm', 'rules']).optional(),
        autoModeClassifierModel: z.string().min(1).max(128).optional(),
        autoModeTimeoutMs: z.number().int().positive().max(3_600_000).optional(),
        compactionTriggerPercent: z.number().min(15).max(90).optional(),
        compactionTriggerTokens: z.number().int().positive().max(10_000_000).optional(),
      })
      .strict(),
  })
  .strict();

export const spaceRuntimeQueuedInputSchema = z
  .object({
    inputId: idSchema,
    sessionId: idSchema,
    delivery: z.enum(['interrupt', 'after-turn']),
    state: z.enum(['queued', 'delivering', 'delivered', 'cancelled', 'failed']),
    createdAt: timestampSchema,
    contentPreview: z.string().max(4096).optional(),
    position: z.number().int().positive().max(MAX_QUEUE_ITEMS).optional(),
    initiatedBy: spaceRuntimeInitiatorSchema.optional(),
  })
  .strict();

export const spaceSessionLiveProjectionSchema = z
  .object({
    sessionId: idSchema,
    projectionRevision: z.number().int().nonnegative(),
    cursor: spaceRuntimeCursorSchema,
    transcriptRevision: z.string().min(1).max(256),
    activeRun: spaceRuntimeRunProjectionSchema.optional(),
    queuedRuns: z.array(spaceRuntimeRunProjectionSchema).max(MAX_QUEUE_ITEMS),
    lastTerminalRun: spaceRuntimeRunProjectionSchema.optional(),
    assistantDraft: spaceRuntimeDraftSchema.optional(),
    thinkingDraft: spaceRuntimeDraftSchema.optional(),
    activeTools: z.array(spaceRuntimeActiveToolSchema).max(MAX_ACTIVE_TOOLS),
    todos: z.array(spaceRuntimeTodoSchema).max(MAX_TODOS),
    managedTask: spaceRuntimeManagedTaskSchema.optional(),
    settings: spaceRuntimeSessionSettingsSchema.optional(),
    queuedInputs: z.array(spaceRuntimeQueuedInputSchema).max(MAX_QUEUE_ITEMS),
    interactions: z.array(spaceRuntimeInteractionSchema).max(MAX_INTERACTIONS),
  })
  .strict()
  .superRefine((value, ctx) => {
    addRunOwnershipIssues(
      value.sessionId,
      value.activeRun,
      value.queuedRuns,
      value.lastTerminalRun,
      ctx,
    );
    if (value.queuedInputs.some((input) => input.sessionId !== value.sessionId)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'all queued inputs must belong to the selected session',
        path: ['queuedInputs'],
      });
    }
    if (
      value.interactions.some((interaction) => interaction.request.sessionId !== value.sessionId)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'all interactions must belong to the selected session',
        path: ['interactions'],
      });
    }
  });

const runChangeSchema = z
  .object({
    domain: z.literal('run'),
    activeRun: spaceRuntimeRunProjectionSchema.nullable(),
    queuedRuns: z.array(spaceRuntimeRunProjectionSchema).max(MAX_QUEUE_ITEMS),
    queuedInputs: z.array(spaceRuntimeQueuedInputSchema).max(MAX_QUEUE_ITEMS).optional(),
    resetRunScopedState: z.boolean().optional(),
  })
  .strict();
const draftChangeSchema = z
  .object({
    domain: z.literal('draft'),
    assistantDraft: spaceRuntimeDraftSchema.nullable(),
    thinkingDraft: spaceRuntimeDraftSchema.nullable(),
  })
  .strict();
const toolsChangeSchema = z
  .object({
    domain: z.literal('tools'),
    activeTools: z.array(spaceRuntimeActiveToolSchema).max(MAX_ACTIVE_TOOLS),
  })
  .strict();
const todosChangeSchema = z
  .object({
    domain: z.literal('todos'),
    todos: z.array(spaceRuntimeTodoSchema).max(MAX_TODOS),
  })
  .strict();
const managedTaskChangeSchema = z
  .object({
    domain: z.literal('managedTask'),
    managedTask: spaceRuntimeManagedTaskSchema.nullable(),
  })
  .strict();
const settingsChangeSchema = z
  .object({
    domain: z.literal('settings'),
    settings: spaceRuntimeSessionSettingsSchema,
  })
  .strict();
const queueChangeSchema = z
  .object({
    domain: z.literal('queue'),
    queuedInputs: z.array(spaceRuntimeQueuedInputSchema).max(MAX_QUEUE_ITEMS),
  })
  .strict();
const terminalChangeSchema = z
  .object({
    domain: z.literal('terminal'),
    lastTerminalRun: spaceRuntimeRunProjectionSchema,
  })
  .strict();
const interactionChangeSchema = z
  .object({
    domain: z.literal('interaction'),
    interactions: z.array(spaceRuntimeInteractionSchema).max(MAX_INTERACTIONS),
  })
  .strict();

export const spaceSessionLiveDomainChangeSchema = z.discriminatedUnion('domain', [
  runChangeSchema,
  draftChangeSchema,
  toolsChangeSchema,
  todosChangeSchema,
  managedTaskChangeSchema,
  settingsChangeSchema,
  queueChangeSchema,
  terminalChangeSchema,
  interactionChangeSchema,
]);

export const spaceSessionLiveChangedSchema = z
  .object({
    sessionId: idSchema,
    baseProjectionRevision: z.number().int().nonnegative(),
    projectionRevision: z.number().int().nonnegative(),
    cursor: spaceRuntimeCursorSchema,
    change: spaceSessionLiveDomainChangeSchema,
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.projectionRevision <= value.baseProjectionRevision) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'projectionRevision must advance beyond baseProjectionRevision',
        path: ['projectionRevision'],
      });
    }
    switch (value.change.domain) {
      case 'run':
        addRunOwnershipIssues(
          value.sessionId,
          value.change.activeRun ?? undefined,
          value.change.queuedRuns,
          undefined,
          ctx,
        );
        if (value.change.queuedInputs?.some((input) => input.sessionId !== value.sessionId)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'all queued inputs must belong to the selected session',
            path: ['change', 'queuedInputs'],
          });
        }
        break;
      case 'queue':
        if (value.change.queuedInputs.some((input) => input.sessionId !== value.sessionId)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'all queued inputs must belong to the selected session',
            path: ['change', 'queuedInputs'],
          });
        }
        break;
      case 'terminal':
        addRunOwnershipIssues(value.sessionId, undefined, [], value.change.lastTerminalRun, ctx);
        break;
      case 'interaction':
        if (
          value.change.interactions.some(
            (interaction) => interaction.request.sessionId !== value.sessionId,
          )
        ) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'all interactions must belong to the selected session',
            path: ['change', 'interactions'],
          });
        }
        break;
      default:
        break;
    }
  });

export const runtimeProfileSnapshotChannel = {
  name: 'runtime.profileSnapshot',
  direction: 'invoke',
  input: z.undefined(),
  output: spaceRuntimeProfileProjectionSchema,
} as const;

export const runtimeProfileChangedChannel = {
  name: 'runtime.profileChanged',
  direction: 'push',
  payload: spaceRuntimeProfileProjectionSchema,
} as const;

export const runtimeConnectionChangedChannel = {
  name: 'runtime.connectionChanged',
  direction: 'push',
  payload: spaceCoderConnectionProjectionSchema,
} as const;

export const sessionLiveSnapshotChannel = {
  name: 'session.liveSnapshot',
  direction: 'invoke',
  input: z.object({ sessionId: idSchema }).strict(),
  output: spaceSessionLiveProjectionSchema,
} as const;

export const sessionLiveChangedChannel = {
  name: 'session.liveChanged',
  direction: 'push',
  payload: spaceSessionLiveChangedSchema,
} as const;

export const spaceSessionLiveInvalidatedSchema = z
  .object({
    sessionId: idSchema,
    runtimeId: idSchema,
    reason: z.enum([
      'event_overflow',
      'event_order',
      'delivery_failed',
      'runtime_changed',
      'transport_disconnected',
    ]),
    message: z.string().min(1).max(MAX_REASON),
  })
  .strict();

export const sessionLiveInvalidatedChannel = {
  name: 'session.liveInvalidated',
  direction: 'push',
  payload: spaceSessionLiveInvalidatedSchema,
} as const;

export type SpaceRuntimeCursorT = z.infer<typeof spaceRuntimeCursorSchema>;
export type SpaceRuntimeInitiatorT = z.infer<typeof spaceRuntimeInitiatorSchema>;
export type SpaceRuntimeCapabilityT = z.infer<typeof spaceRuntimeCapabilitySchema>;
export type SpaceCoderConnectionStateT = z.infer<typeof spaceCoderConnectionStateSchema>;
export type SpaceCoderConnectionProjectionT = z.infer<typeof spaceCoderConnectionProjectionSchema>;
export type SpaceRuntimeRunPhaseT = z.infer<typeof spaceRuntimeRunPhaseSchema>;
export type SpaceRuntimeRunStopReceiptT = z.infer<typeof spaceRuntimeRunStopReceiptSchema>;
export type SpaceRuntimeRunStageT = z.infer<typeof spaceRuntimeRunStageSchema>;
export type SpaceRuntimeRunProjectionT = z.infer<typeof spaceRuntimeRunProjectionSchema>;
export type SpaceRuntimeInteractionT = z.infer<typeof spaceRuntimeInteractionSchema>;
export type SpaceRuntimeIntegrationHealthT = z.infer<typeof spaceRuntimeIntegrationHealthSchema>;
export type SpaceRuntimeProfileProjectionT = z.infer<typeof spaceRuntimeProfileProjectionSchema>;
export type SpaceRuntimeToolSandboxT = z.infer<typeof spaceRuntimeToolSandboxSchema>;
export type SpaceSessionLiveProjectionT = z.infer<typeof spaceSessionLiveProjectionSchema>;
export type SpaceRuntimeSessionSettingsT = z.infer<typeof spaceRuntimeSessionSettingsSchema>;
export type SpaceSessionLiveDomainChangeT = z.infer<typeof spaceSessionLiveDomainChangeSchema>;
export type SpaceSessionLiveChangedT = z.infer<typeof spaceSessionLiveChangedSchema>;
export type SpaceSessionLiveInvalidatedT = z.infer<typeof spaceSessionLiveInvalidatedSchema>;
