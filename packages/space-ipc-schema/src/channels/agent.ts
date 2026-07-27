// Markdown agent discovery channel — FEATURE_197 (KodaX 0.7.43).
//
// discoverMarkdownAgents is the read-only SDK API for host UI previews: it scans
// ~/.kodax/agents/*.md and <project>/.kodax/agents/*.md without admission and
// without writing the SDK registry.
//
// Space uses this channel for picker / AGENTS.md popout previews. Runtime
// activation is intentionally separate: RealKodaXSession calls SDK 0.7.63
// `loadMarkdownAgentScope` per run and passes the resulting project-scoped
// resolver through KodaXOptions.context.agentScope.

import { z } from 'zod';

// Markdown agent 来源——严格 mirror SDK DiscoveredMarkdownAgent.source 联合。
const agentSourceSchema = z.enum(['markdown:user', 'markdown:project']);

// Agent 元数据（discover 输出）。所有上限对齐 skill.discover 同类字段。
const agentMetaSchema = z.object({
  name: z
    .string()
    .regex(/^[a-z0-9][a-z0-9._:-]{0,63}$/, {
      message: 'agent name must be kebab-case (allow . : _ -)',
    })
    .min(1)
    .max(64),
  description: z.string().max(2048),
  source: agentSourceSchema,
  /** 源 markdown 文件绝对路径。给 UI "在 OS 里定位" / tooltip 用。*/
  path: z.string().min(1).max(4096),
  /** frontmatter `tools` 数组（SDK 返回的是用户原始名字，不带 builtin: 前缀）。 */
  tools: z.array(z.string().min(1).max(128)).max(64).optional(),
  /** frontmatter `model` alias，可选。 */
  model: z.string().max(128).optional(),
});

// 校验失败的 markdown 文件。reason 上限给宽点——SDK 可能给整段 yaml parse error。
const agentFailureSchema = z.object({
  path: z.string().min(1).max(4096),
  reason: z.string().max(2048),
});

// ---- Invoke: agent.discover ----
//
// 输入 projectRoot 而不是 sessionId——KodaX session 启动前 picker 就该能列；如果绑
// sessionId 就强制必须先 create session。projectRoot 跟 skill.discover 借助
// kodaxHost.get(sid).projectRoot 拿到的值同源。
export const agentDiscoverChannel = {
  name: 'agent.discover',
  direction: 'invoke',
  input: z.object({
    projectRoot: z.string().min(1).max(4096),
  }),
  output: z.object({
    /** Markdown agent metadata。256 上限对齐 skill.discover 同类 cap。*/
    agents: z.array(agentMetaSchema).max(256),
    /** 失败文件列表——给 picker 上展示 "1 agent failed to load" 警告用。 */
    failed: z.array(agentFailureSchema).max(256),
  }),
} as const;

export type AgentMeta = z.infer<typeof agentMetaSchema>;
export type AgentSource = z.infer<typeof agentSourceSchema>;
export type AgentFailure = z.infer<typeof agentFailureSchema>;

// KodaX 0.7.72+ unified Actor/Turn telemetry. This is deliberately separate
// from managed_task_status: the latter owns the foreground AMA Worker, while
// this snapshot is the canonical native/recursive/Workflow/external Agent tree.
const agentActorProgressItemSchema = z
  .object({
    sequence: z.number().int().nonnegative(),
    kind: z.enum(['status', 'tool', 'assistant']),
    summary: z.string().max(4096),
    createdAt: z.string().min(1).max(128),
  })
  .strict();

const agentActorLatestTurnSchema = z
  .object({
    turnId: z.string().min(1).max(256),
    state: z.enum(['accepted', 'running', 'completed', 'failed', 'interrupted']),
    summary: z.string().max(4096),
    summaryTruncated: z.boolean(),
    recentActivity: z.array(agentActorProgressItemSchema).max(32),
  })
  .strict();

const agentActorSummarySchema = z
  .object({
    path: z.string().min(1).max(2048),
    taskName: z.string().min(1).max(256),
    parentPath: z.string().min(1).max(2048).optional(),
    kind: z.enum(['native', 'constructed', 'workflow', 'external']),
    state: z.enum(['running', 'idle', 'closed']),
    currentTurnId: z.string().min(1).max(256).optional(),
    createdAt: z.string().min(1).max(128),
    updatedAt: z.string().min(1).max(128),
    revision: z.number().int().nonnegative(),
    latestTurn: agentActorLatestTurnSchema.optional(),
  })
  .strict();

export const agentActorTreeSnapshotSchema = z
  .object({
    runtimeId: z.string().min(1).max(256),
    sessionId: z.string().min(1).max(256),
    rootPath: z.literal('/root'),
    revision: z.number().int().nonnegative(),
    eventCursor: z.number().int().nonnegative(),
    activeNonRootTurns: z.number().int().nonnegative(),
    maxConcurrentThreads: z.number().int().positive(),
    actors: z.array(agentActorSummarySchema).max(256),
  })
  .strict();

export const agentActorSnapshotChannel = {
  name: 'agent.actor.snapshot',
  direction: 'invoke',
  input: z
    .object({
      sessionId: z.string().min(1).max(256),
    })
    .strict(),
  output: agentActorTreeSnapshotSchema,
} as const;

export const agentActorChangedChannel = {
  name: 'agent.actor.changed',
  direction: 'push',
  payload: agentActorTreeSnapshotSchema,
} as const;

export type AgentActorTreeSnapshotT = z.infer<typeof agentActorTreeSnapshotSchema>;
export type AgentActorSummaryT = z.infer<typeof agentActorSummarySchema>;
export type AgentActorLatestTurnT = z.infer<typeof agentActorLatestTurnSchema>;
export type AgentActorProgressItemT = z.infer<typeof agentActorProgressItemSchema>;

// KodaX 0.7.67 external-agent plane. The renderer receives only redacted
// registration summaries and normalized task snapshots; executor config and
// credential references remain in the main process / SDK-owned store.
const capabilitySupportSchema = z.enum(['supported', 'unsupported', 'conditional']);
const externalAgentCapabilitiesSchema = z.object({
  streaming: capabilitySupportSchema,
  durableTasks: capabilitySupportSchema,
  inputRequired: capabilitySupportSchema,
  cancellation: capabilitySupportSchema,
  artifacts: capabilitySupportSchema,
});

const externalAgentEffectsSchema = z.object({
  remote: z.enum(['none', 'read', 'write', 'unknown']),
  workspace: z.enum(['none', 'proposal']),
});

const externalAgentRegistrationSummarySchema = z.object({
  agentId: z.string().min(1).max(256),
  displayName: z.string().min(1).max(128),
  description: z.string().max(2048).optional(),
  enabled: z.boolean(),
  adapterKind: z.enum(['reference', 'runtime']),
  configurationRevision: z.string().min(1).max(256),
  credentialConfigured: z.boolean(),
  skills: z.array(z.string().min(1).max(128)).max(64),
  inputRequired: z.boolean(),
  capabilities: externalAgentCapabilitiesSchema,
  effects: externalAgentEffectsSchema,
  health: z
    .object({
      status: z.enum(['healthy', 'degraded', 'unhealthy']),
      checkedAt: z.string().min(1).max(128),
      retryAfterMs: z.number().int().nonnegative().optional(),
      diagnostic: z.string().max(1024).optional(),
    })
    .optional(),
  diagnostics: z.array(z.string().max(1024)).max(32),
});

const dispatchableAgentDescriptorSchema = z.object({
  agentId: z.string().min(1).max(256),
  displayName: z.string().min(1).max(128),
  description: z.string().max(2048).optional(),
  origin: z.enum(['native', 'constructed', 'external']),
  protocol: z.enum(['native', 'a2a', 'mcp', 'http']),
  configurationRevision: z.string().min(1).max(256),
  skills: z.array(z.string().min(1).max(128)).max(64),
  inputModalities: z.array(z.string().min(1).max(64)).max(32),
  outputModalities: z.array(z.string().min(1).max(64)).max(32),
  capabilities: externalAgentCapabilitiesSchema,
  effects: z.object({
    remote: z.enum(['none', 'read', 'write', 'unknown']),
    workspace: z.enum(['none', 'proposal', 'direct']),
  }),
});

const agentDispatchabilitySchema = z.object({
  status: z.enum(['dispatchable', 'degraded', 'busy', 'unavailable']),
  checkedAt: z.string().min(1).max(128),
  reasons: z.array(z.string().max(1024)).max(32),
  retryAfterMs: z.number().int().nonnegative().optional(),
});

const dispatchableAgentListingSchema = z.object({
  descriptor: dispatchableAgentDescriptorSchema,
  dispatchability: agentDispatchabilitySchema,
});

const externalAgentTaskSchema = z.object({
  taskId: z.string().min(1).max(256),
  agentId: z.string().min(1).max(256),
  objective: z.string().max(4096),
  state: z.enum([
    'submitted',
    'working',
    'input-required',
    'auth-required',
    'completed',
    'failed',
    'canceled',
    'rejected',
    'unknown',
  ]),
  cancellation: z.enum(['none', 'requested', 'confirmed', 'unsupported', 'failed', 'unknown']),
  route: z.enum(['local', 'external']),
  protocol: z.enum(['native', 'a2a', 'mcp', 'http']),
  configurationRevision: z.string().min(1).max(256),
  parentTaskId: z.string().max(256).optional(),
  workflowId: z.string().max(256).optional(),
  runId: z.string().max(256).optional(),
  nodeId: z.string().max(256).optional(),
  createdAt: z.string().min(1).max(128),
  updatedAt: z.string().min(1).max(128),
  progress: z
    .object({
      message: z.string().max(4096).optional(),
      percent: z.number().min(0).max(100).optional(),
    })
    .optional(),
  output: z.string().max(16_384).optional(),
  error: z.string().max(4096).optional(),
  cancellationError: z.string().max(4096).optional(),
  artifacts: z
    .array(
      z.object({
        name: z.string().min(1).max(512),
        mimeType: z.string().max(256).optional(),
        size: z.number().int().nonnegative().optional(),
        hash: z.string().max(256).optional(),
        provenance: z.string().max(1024).optional(),
        producingAgentId: z.string().max(256).optional(),
        remoteTaskId: z.string().max(256).optional(),
      }),
    )
    .max(64)
    .optional(),
  usage: z
    .object({
      inputTokens: z.number().int().nonnegative().optional(),
      outputTokens: z.number().int().nonnegative().optional(),
      totalTokens: z.number().int().nonnegative().optional(),
      cost: z.number().nonnegative().optional(),
      currency: z.string().max(32).optional(),
    })
    .optional(),
});

const externalAgentTaskEventSchema = z.object({
  taskId: z.string().min(1).max(256),
  seq: z.number().int().nonnegative(),
  timestamp: z.string().min(1).max(128),
  type: z.enum([
    'submitted',
    'state',
    'progress',
    'output',
    'artifact',
    'usage',
    'error',
    'cancellation',
  ]),
  state: externalAgentTaskSchema.shape.state.optional(),
  cancellation: externalAgentTaskSchema.shape.cancellation.optional(),
  progress: externalAgentTaskSchema.shape.progress,
  output: z.string().max(16_384).optional(),
  error: z.string().max(4096).optional(),
});

export const externalAgentStatusChannel = {
  name: 'agent.external.status',
  direction: 'invoke',
  input: z.object({}),
  output: z.object({
    sdkVersion: z.string().min(1).max(64),
    enabled: z.boolean(),
    referenceExecutor: z.boolean(),
    adapters: z.object({
      a2a: z.boolean(),
      mcpTasks: z.boolean(),
      governedHttp: z.boolean(),
    }),
    registrationCount: z.number().int().nonnegative(),
    taskCount: z.number().int().nonnegative(),
    error: z.string().max(2048).optional(),
  }),
} as const;

export const externalAgentRegistrationListChannel = {
  name: 'agent.external.registration.list',
  direction: 'invoke',
  input: z.object({}),
  output: z.object({ registrations: z.array(externalAgentRegistrationSummarySchema).max(256) }),
} as const;

export const externalAgentReferenceUpsertChannel = {
  name: 'agent.external.reference.upsert',
  direction: 'invoke',
  input: z.object({
    agentId: z.string().min(1).max(256).optional(),
    displayName: z.string().trim().min(1).max(128),
    description: z.string().trim().max(2048).optional(),
    enabled: z.boolean().default(true),
    skills: z.array(z.string().trim().min(1).max(128)).max(64).default(['general']),
    inputRequired: z.boolean().default(false),
  }),
  output: externalAgentRegistrationSummarySchema,
} as const;

export const externalAgentRegistrationRemoveChannel = {
  name: 'agent.external.registration.remove',
  direction: 'invoke',
  input: z.object({ agentId: z.string().min(1).max(256) }),
  output: z.object({ removed: z.boolean() }),
} as const;

export const externalAgentDispatchableListChannel = {
  name: 'agent.external.dispatchable.list',
  direction: 'invoke',
  input: z.object({
    projectRoot: z.string().min(1).max(4096).optional(),
    readOnly: z.boolean().default(true),
  }),
  output: z.object({ agents: z.array(dispatchableAgentListingSchema).max(256) }),
} as const;

export const externalAgentPreflightChannel = {
  name: 'agent.external.preflight',
  direction: 'invoke',
  input: z.object({
    agentId: z.string().min(1).max(256),
    projectRoot: z.string().min(1).max(4096).optional(),
    readOnly: z.boolean().default(true),
    expectedConfigurationRevision: z.string().min(1).max(256).optional(),
  }),
  output: z.object({
    ok: z.boolean(),
    descriptor: dispatchableAgentDescriptorSchema.optional(),
    dispatchability: agentDispatchabilitySchema,
    reasons: z.array(z.string().max(1024)).max(32),
  }),
} as const;

export const externalAgentTaskListChannel = {
  name: 'agent.external.task.list',
  direction: 'invoke',
  input: z.object({
    sessionId: z.string().min(1).max(256),
    agentId: z.string().min(1).max(256).optional(),
  }),
  output: z.object({ tasks: z.array(externalAgentTaskSchema).max(256) }),
} as const;

export const externalAgentTaskStartChannel = {
  name: 'agent.external.task.start',
  direction: 'invoke',
  input: z.object({
    sessionId: z.string().min(1).max(256),
    agentId: z.string().min(1).max(256),
    objective: z.string().trim().min(1).max(4096),
    readOnly: z.boolean().default(true),
    expectedConfigurationRevision: z.string().min(1).max(256).optional(),
  }),
  output: externalAgentTaskSchema,
} as const;

export const externalAgentTaskEventsChannel = {
  name: 'agent.external.task.events',
  direction: 'invoke',
  input: z.object({
    sessionId: z.string().min(1).max(256),
    taskId: z.string().min(1).max(256),
    cursor: z.number().int().nonnegative().default(0),
  }),
  output: z.object({
    events: z.array(externalAgentTaskEventSchema).max(512),
    nextCursor: z.number().int().nonnegative(),
  }),
} as const;

export const externalAgentTaskSendInputChannel = {
  name: 'agent.external.task.sendInput',
  direction: 'invoke',
  input: z.object({
    sessionId: z.string().min(1).max(256),
    taskId: z.string().min(1).max(256),
    content: z.string().trim().min(1).max(16_384),
  }),
  output: externalAgentTaskSchema,
} as const;

export const externalAgentTaskCancelChannel = {
  name: 'agent.external.task.cancel',
  direction: 'invoke',
  input: z.object({
    sessionId: z.string().min(1).max(256),
    taskId: z.string().min(1).max(256),
    reason: z.string().trim().max(1024).optional(),
  }),
  output: externalAgentTaskSchema,
} as const;

export const externalAgentTaskReconcileChannel = {
  name: 'agent.external.task.reconcile',
  direction: 'invoke',
  input: z.object({
    sessionId: z.string().min(1).max(256),
    taskId: z.string().min(1).max(256),
  }),
  output: externalAgentTaskSchema,
} as const;

export type ExternalAgentRegistrationSummaryT = z.infer<
  typeof externalAgentRegistrationSummarySchema
>;
export type DispatchableAgentListingT = z.infer<typeof dispatchableAgentListingSchema>;
export type ExternalAgentTaskT = z.infer<typeof externalAgentTaskSchema>;
export type ExternalAgentTaskEventT = z.infer<typeof externalAgentTaskEventSchema>;
