// Workflow channels — F060 (Workflow Harness 支持批次地基).
//
// 对标 KodaX SDK FEATURE_217(0.7.49 动态工作流引擎)+ FEATURE_229(0.7.50 进程事件面).
// SDK 把工作流进度做成可订阅的一等进程(`WorkflowProcessSnapshot` 流);Space 订阅 →
// 转发 → renderer 渲染。**Space 零编排**,只搬运 snapshot,不折叠底层 `WorkflowEvent`。
//
// 这里的 zod schema **逐字段镜像** SDK 的 process 模型(types-chunks/process.d-*.d.ts),
// 用闭集 enum 防 drift;另加防御性 max 上限(对齐 artifact.ts 风格,避免无界 payload)。
//
// 通道:
//   - invoke  workflow.list  (renderer 切 session 时播种已知 run)
//   - invoke  workflow.get   (按 runId 取单个 snapshot)
//   - push    workflow.event (SDK 进程事件实时流,带 host 归属 sessionId/surface)

import { z } from 'zod';

// ---- 镜像 SDK 的闭集枚举(process.d-*.d.ts) ----
const workflowProcessStatusSchema = z.enum([
  'running',
  'paused',
  'completed',
  'failed',
  'cancelled',
]);
export type WorkflowProcessStatusT = z.infer<typeof workflowProcessStatusSchema>;

const workflowProcessItemStatusSchema = z.enum([
  'pending',
  'running',
  'completed',
  'failed',
  'cancelled',
  'skipped',
]);

const workflowProcessItemKindSchema = z.enum(['phase', 'agent', 'step', 'artifact']);

const workflowProcessSummaryStatusSchema = z.enum(['pending', 'result', 'notice', 'unavailable']);

const workflowProcessSourceSchema = z.enum([
  'command',
  'review',
  'sdk',
  'capsule',
  'extension',
  'automation',
]);

// 工作面归属(与 session.ts 的 surfaceSchema 值对齐:'code' = Coder / 'partner' = Partner)。
const workflowSurfaceSchema = z.enum(['code', 'partner']);

// 防御性字段上限。SDK 内部无界,但 IPC 边界是不可信输入(协议漂移/未来扩展),统一夹。
const SHORT = 256; // id / name / title
const MSG = 8192; // latestMessage / resultSummary / goal / error
const MAX_ITEMS = 4096; // 进程树节点上限(对齐 workflow 系统 maxAgents 远高于真实)
const MAX_ARTIFACTS = 512;

// ---- WorkflowProcessItem(进程树节点) ----
export const workflowProcessItemSchema = z.object({
  id: z.string().min(1).max(SHORT),
  title: z.string().max(SHORT),
  kind: workflowProcessItemKindSchema,
  status: workflowProcessItemStatusSchema,
  phaseId: z.string().max(SHORT).optional(),
  parentId: z.string().max(SHORT).optional(),
  agentId: z.string().max(SHORT).optional(),
  childAgentId: z.string().max(SHORT).optional(),
  provider: z.string().max(SHORT).optional(),
  model: z.string().max(SHORT).optional(),
  startedAt: z.string().max(SHORT).optional(),
  endedAt: z.string().max(SHORT).optional(),
  summary: z.string().max(MSG).optional(),
  summaryStatus: workflowProcessSummaryStatusSchema.optional(),
  error: z.string().max(MSG).optional(),
});
export type WorkflowProcessItemT = z.infer<typeof workflowProcessItemSchema>;
export type WorkflowProcessItemStatusT = z.infer<typeof workflowProcessItemStatusSchema>;
export type WorkflowProcessItemKindT = z.infer<typeof workflowProcessItemKindSchema>;
export type WorkflowProcessSummaryStatusT = z.infer<typeof workflowProcessSummaryStatusSchema>;

const workflowProcessCountsSchema = z.object({
  pending: z.number().int().nonnegative(),
  running: z.number().int().nonnegative(),
  completed: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  cancelled: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
});

const workflowProcessProgressSchema = z.object({
  spawnedAgents: z.number().int().nonnegative(),
  finishedAgents: z.number().int().nonnegative(),
  activeAgents: z.number().int().nonnegative(),
  failedAgents: z.number().int().nonnegative(),
  stoppedAgents: z.number().int().nonnegative(),
  agentCap: z.number().int().nonnegative().optional(),
  plannedItems: z.number().int().nonnegative().optional(),
});

const workflowProcessTokenUsageSchema = z.object({
  spent: z.number().nonnegative(),
  total: z.number().nonnegative().optional(),
});

const workflowHostMetadataSchema = z.record(z.string().max(MSG));

const workflowProcessArtifactSchema = z.object({
  name: z.string().min(1).max(SHORT),
  path: z.string().max(4096).optional(),
  description: z.string().max(MSG).optional(),
});

// ---- WorkflowProcessSnapshot(一次 run 的全量快照) ----
export const workflowProcessSnapshotSchema = z.object({
  runId: z.string().min(1).max(SHORT),
  workflowName: z.string().max(SHORT),
  displayName: z.string().max(SHORT).optional(),
  status: workflowProcessStatusSchema,
  startedAt: z.string().max(SHORT),
  updatedAt: z.string().max(SHORT),
  elapsedMs: z.number().nonnegative().optional(),
  goal: z.string().max(MSG).optional(),
  source: workflowProcessSourceSchema.optional(),
  hostMetadata: workflowHostMetadataSchema.optional(),
  patterns: z.array(z.string().max(SHORT)).max(16).optional(),
  savedWorkflowName: z.string().max(SHORT).optional(),
  sourceRunId: z.string().max(SHORT).optional(),
  sourceWorkflowName: z.string().max(SHORT).optional(),
  revisionOf: z.string().max(SHORT).optional(),
  activePhaseId: z.string().max(SHORT).optional(),
  activePhaseIndex: z.number().int().nonnegative().optional(),
  phaseCount: z.number().int().nonnegative().optional(),
  items: z.array(workflowProcessItemSchema).max(MAX_ITEMS),
  counts: workflowProcessCountsSchema,
  progress: workflowProcessProgressSchema,
  tokens: workflowProcessTokenUsageSchema.optional(),
  latestMessage: z.string().max(MSG).optional(),
  resultSummary: z.string().max(MSG).optional(),
  error: z.string().max(MSG).optional(),
  artifacts: z.array(workflowProcessArtifactSchema).max(MAX_ARTIFACTS).optional(),
});
export type WorkflowProcessSnapshotT = z.infer<typeof workflowProcessSnapshotSchema>;

// ---- Host 归属包装:snapshot + 发起方(sessionId/surface) ----
// SDK 的 snapshot 不带 host 归属(已开需求给 KodaX);补齐前 Space 在 main 侧用自持久化
// 映射 stamp。`sessionId` 缺席 = 外部(REPL/CLI)发起、Space 归不到 session 的 run。
export const workflowRunSchema = workflowProcessSnapshotSchema.extend({
  sessionId: z.string().min(1).max(128).optional(),
  surface: workflowSurfaceSchema.optional(),
  projectRoot: z.string().max(4096).optional(),
});
export type WorkflowRunT = z.infer<typeof workflowRunSchema>;

// ---- Push: workflow.event(进程事件实时流) ----
// SDK 的 WorkflowProcessEvent 是 3 变体判别联合(started/updated/finished);为上线方便,
// 这里展平成单对象(type 判别 + 全量 snapshot + host 归属)。每个事件都带全量 snapshot,
// renderer 直接 `runId → snapshot` 覆盖,无需自己折叠。
export const workflowEventChannel = {
  name: 'workflow.event',
  direction: 'push',
  payload: z.object({
    type: z.enum(['workflow_started', 'workflow_updated', 'workflow_finished']),
    snapshot: workflowProcessSnapshotSchema,
    /** 仅 workflow_updated 携带的人类可读进度行(SDK message)。*/
    message: z.string().max(MSG).optional(),
    /** Host 归属:发起该 run 的 session;外部发起的 run 无此字段。*/
    sessionId: z.string().min(1).max(128).optional(),
    surface: workflowSurfaceSchema.optional(),
    projectRoot: z.string().max(4096).optional(),
  }),
} as const;
export type WorkflowEventPayload = z.infer<typeof workflowEventChannel.payload>;

const workflowTaskVerificationResultSchema = z.object({
  ok: z.boolean(),
  enforcement: z.enum(['hard', 'warn']).optional(),
  reasons: z.array(z.string().max(MSG)).max(32),
  changedPaths: z.array(z.string().max(4096)).max(128).optional(),
  mutationToolCalls: z.array(z.string().max(SHORT)).max(64).optional(),
  mutationEvidence: z.boolean().optional(),
});

// ---- Push: workflow.activity（F065 子 agent 活动遥测） ----
// SDK 0.7.50 给 KodaXEvents 回调加了 workflowCorrelation 尾参——带 workflowRunId 的事件
// 来自工作流子 agent。Space 把这些归到对应 run + 子 agent 的有界活动桶，不淹主 transcript。
export const workflowActivityChannel = {
  name: 'workflow.activity',
  direction: 'push',
  payload: z.object({
    runId: z.string().min(1).max(SHORT),
    childAgentId: z.string().max(SHORT).optional(),
    childAgentName: z.string().max(SHORT).optional(),
    // 仅 discrete 事件（text/thinking 流不推——控量、由 snapshot.latestMessage 体现）。
    kind: z.enum(['tool_use', 'tool_result', 'end', 'digest']),
    toolName: z.string().max(SHORT).optional(),
    summary: z.string().max(MSG).optional(),
    summaryKind: z.enum(['digest', 'excerpt', 'digest-failed']).optional(),
    verification: workflowTaskVerificationResultSchema.optional(),
  }),
} as const;
export type WorkflowActivityPayload = z.infer<typeof workflowActivityChannel.payload>;

// ---- Invoke: workflow.list(切 session 时播种;可按 sessionId 过滤) ----
export const workflowListChannel = {
  name: 'workflow.list',
  direction: 'invoke',
  input: z
    .object({
      /** 过滤到归属此 session 的 run;省略 = 全部(含外部发起)。*/
      sessionId: z.string().min(1).max(128).optional(),
    })
    .optional(),
  // .max 上限与 WorkflowController.list 的 limit / renderer MAX_WORKFLOW_RUNS 对齐,
  // 防一次 list 返回过大 payload 阻塞 IPC。
  output: z.object({ runs: z.array(workflowRunSchema).max(500) }),
} as const;

// ---- Invoke: workflow.get(按 runId 取单个) ----
export const workflowGetChannel = {
  name: 'workflow.get',
  direction: 'invoke',
  input: z.object({ runId: z.string().min(1).max(SHORT) }),
  output: z.object({ run: workflowRunSchema.nullable() }),
} as const;

// ============================================================================
// F062 — Run 生命周期控制（stop/pause/resume/rename/delete/prune）。
// 控制后状态由 workflow.event 自然回流（如 stop → 后续 workflow_finished status=cancelled），
// renderer 不乐观假设，等事件。
// ============================================================================

const okResult = z.object({ ok: z.boolean() });
const runIdInput = z.object({ runId: z.string().min(1).max(SHORT) });

export const workflowStopChannel = {
  name: 'workflow.stop',
  direction: 'invoke',
  input: z.object({
    runId: z.string().min(1).max(SHORT),
    reason: z.string().max(SHORT).optional(),
  }),
  output: okResult,
} as const;

export const workflowPauseChannel = {
  name: 'workflow.pause',
  direction: 'invoke',
  input: runIdInput,
  output: okResult,
} as const;

export const workflowResumeChannel = {
  name: 'workflow.resume',
  direction: 'invoke',
  input: runIdInput,
  output: okResult,
} as const;

export const workflowRenameChannel = {
  name: 'workflow.rename',
  direction: 'invoke',
  input: z.object({
    runId: z.string().min(1).max(SHORT),
    displayName: z.string().min(1).max(SHORT),
  }),
  output: okResult,
} as const;

export const workflowDeleteChannel = {
  name: 'workflow.delete',
  direction: 'invoke',
  input: z.object({ runId: z.string().min(1).max(SHORT), force: z.boolean().optional() }),
  output: okResult,
} as const;

export const workflowRerunChannel = {
  name: 'workflow.rerun',
  direction: 'invoke',
  input: z.object({
    runId: z.string().min(1).max(SHORT),
    sessionId: z.string().min(1).max(128),
    args: z.unknown().optional(),
  }),
  output: z.object({
    runId: z.string().max(SHORT).optional(),
    error: z.string().max(MSG).optional(),
  }),
} as const;

export const workflowPruneChannel = {
  name: 'workflow.prune',
  direction: 'invoke',
  // 至少给一个保留策略——防 `{}` / 只带 dryRun 触发无界清理（依赖 SDK 行为不可控）。
  input: z
    .object({
      keep: z.number().int().nonnegative().max(100000).optional(),
      olderThanDays: z.number().nonnegative().max(36500).optional(),
      dryRun: z.boolean().optional(),
    })
    .refine((o) => o.keep !== undefined || o.olderThanDays !== undefined || o.dryRun === true, {
      message: 'prune requires keep, olderThanDays, or dryRun',
    }),
  output: z.object({
    deleted: z.number().int().nonnegative(),
    protectedRuns: z.number().int().nonnegative(),
    candidates: z.array(z.string().max(SHORT)).max(100000),
    dryRun: z.boolean(),
  }),
} as const;

// ============================================================================
// F063 — Workflow 库 + 启动 + capsule preflight。
// ============================================================================

const workflowMetaLiteSchema = z.object({
  name: z.string().max(SHORT),
  description: z.string().max(MSG),
  plannedAgents: z.number().int().nonnegative().optional(),
  maxAgents: z.number().int().nonnegative().optional(),
  readOnly: z.boolean().optional(),
  phases: z.array(z.string().max(SHORT)).max(256).optional(),
});
const savedWorkflowLiteSchema = z.object({
  name: z.string().max(SHORT),
  path: z.string().max(4096),
  source: z.string().max(SHORT).optional(),
  execution: z.string().max(SHORT).optional(),
});
const workflowPatternLiteSchema = z.object({
  name: z.string().max(SHORT),
  pattern: z.string().max(SHORT),
  description: z.string().max(MSG),
});

// ---- Invoke: workflow.library（built-in + saved 发现） ----
export const workflowLibraryChannel = {
  name: 'workflow.library',
  direction: 'invoke',
  input: z.object({ projectRoot: z.string().max(4096).optional() }).optional(),
  output: z.object({
    builtin: z.array(workflowMetaLiteSchema).max(256),
    patterns: z.array(workflowPatternLiteSchema).max(256),
    saved: z.array(savedWorkflowLiteSchema).max(1000),
  }),
} as const;

// ---- Invoke: workflow.preflight（saved capsule 需求校验） ----
export const workflowPreflightChannel = {
  name: 'workflow.preflight',
  direction: 'invoke',
  // sessionId 用于在 main 侧取**可信** projectRoot 做路径白名单（防任意文件加载执行）。
  input: z.object({ path: z.string().min(1).max(4096), sessionId: z.string().min(1).max(128) }),
  output: z.object({
    ok: z.boolean(),
    issues: z
      .array(z.object({ severity: z.string().max(SHORT).optional(), message: z.string().max(MSG) }))
      .max(256),
  }),
} as const;

// ---- Invoke: workflow.start（从 session 发起） ----
export const workflowStartChannel = {
  name: 'workflow.start',
  direction: 'invoke',
  input: z.object({
    /** built-in name 或 saved 文件路径。 */
    target: z.string().min(1).max(4096),
    source: z.enum(['builtin', 'saved']),
    /** 发起方 session（main 据此取 provider/model/projectRoot 建 options）。 */
    sessionId: z.string().min(1).max(128),
    /** 透传给工作流脚本的 args（JSON 值）。 */
    args: z.unknown().optional(),
    /** Default catalog target for workflow child spawns that do not already declare a target. */
    agentTarget: z
      .object({
        agentId: z.string().min(1).max(256),
        expectedConfigurationRevision: z.string().min(1).max(256).optional(),
      })
      .optional(),
  }),
  output: z.object({
    runId: z.string().max(SHORT).optional(),
    /** 启动失败时的诊断（runId 缺省时present）。 */
    error: z.string().max(MSG).optional(),
  }),
} as const;

export const workflowSaveChannel = {
  name: 'workflow.save',
  direction: 'invoke',
  input: z.object({
    runId: z.string().min(1).max(SHORT),
    name: z.string().min(1).max(SHORT),
    sessionId: z.string().min(1).max(128),
  }),
  output: z.object({
    name: z.string().max(SHORT).optional(),
    path: z.string().max(4096).optional(),
    error: z.string().max(MSG).optional(),
  }),
} as const;

export const workflowSavedRenameChannel = {
  name: 'workflow.saved.rename',
  direction: 'invoke',
  input: z.object({
    name: z.string().min(1).max(SHORT),
    newName: z.string().min(1).max(SHORT),
    sessionId: z.string().min(1).max(128),
    source: z.string().max(SHORT).optional(),
  }),
  output: z.object({
    name: z.string().max(SHORT).optional(),
    path: z.string().max(4096).optional(),
    previousPath: z.string().max(4096).optional(),
    error: z.string().max(MSG).optional(),
  }),
} as const;

export const workflowSavedDeleteChannel = {
  name: 'workflow.saved.delete',
  direction: 'invoke',
  input: z.object({
    name: z.string().min(1).max(SHORT),
    sessionId: z.string().min(1).max(128),
    source: z.string().max(SHORT).optional(),
  }),
  output: z.object({
    name: z.string().max(SHORT).optional(),
    path: z.string().max(4096).optional(),
    previousPath: z.string().max(4096).optional(),
    error: z.string().max(MSG).optional(),
  }),
} as const;

// ============================================================================
// F064 — Workflow Host Policy（runtime caps only; KodaX 0.7.58 removed host NL autostart）。
// ============================================================================

const workflowPolicySchema = z.object({
  maxAgents: z.number().int().positive(),
  maxConcurrency: z.number().int().positive(),
  // 0 = unlimited (the default; see DEFAULT_WORKFLOW_POLICY). Must be nonnegative, NOT
  // positive — the store returns 0 by default, and a `.positive()` output schema made
  // workflow.policy.get/set fail output validation (OUTPUT_INVALID), silently breaking
  // the advanced-limits panel for every user who had not set an explicit cap.
  tokenBudget: z.number().int().nonnegative(),
});
export type WorkflowPolicyT = z.infer<typeof workflowPolicySchema>;

// ============================================================================
// F066 — Workflow 结果读取（artifacts 走方案 A 自动桥进 artifactStore，无需单独通道）。
// ============================================================================
export const workflowResultChannel = {
  name: 'workflow.result',
  direction: 'invoke',
  input: z.object({ runId: z.string().min(1).max(SHORT) }),
  output: z.object({ result: z.string().max(1_048_576).optional() }), // 1MB 上限
} as const;

export const workflowPolicyGetChannel = {
  name: 'workflow.policy.get',
  direction: 'invoke',
  input: z.undefined().optional(),
  output: workflowPolicySchema,
} as const;

export const workflowPolicySetChannel = {
  name: 'workflow.policy.set',
  direction: 'invoke',
  // 部分更新（main 侧 normalize + 钳到硬上限后回完整策略）。
  input: z.object({
    // 上界不强约束（main 侧 normalize 钳到硬上限）；floor 与 normalizeWorkflowPolicy 对齐。
    maxAgents: z.number().int().min(1).optional(),
    maxConcurrency: z.number().int().min(1).optional(),
    // Allow 0 so the user can reset the cap back to "unlimited"; normalizeTokenBudget
    // maps 0/negatives → 0 (unlimited) and floors any positive to a sane minimum.
    // (Previously `.min(1000)` made "unlimited" unreachable once any value was set.)
    tokenBudget: z.number().int().min(0).optional(),
  }),
  output: workflowPolicySchema,
} as const;
