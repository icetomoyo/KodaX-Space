// Permission channels — FEATURE_007.
//
// 流向：
//   main → renderer push  permission.request   (ask)
//   renderer → main invoke permission.answer    (reply)
//   renderer → main invoke permission.list      (前端展示 / 调试用)
//   renderer → main invoke permission.revoke    (撤销一条 always-allow 规则)
//
// 为什么不像 "ask-and-wait" 协议那样把 reqId 编进 channel 名（permission.answer.<reqId>）：
//   - preload allowlist 是静态的；动态名要么放开通配（破坏白名单），要么每次注册新 channel（电耗）
//   - 改成"统一 channel + reqId 字段路由"——main 侧维护 pending Map，按 reqId resolve 等待方
//
// 风险等级（用于 UI 颜色 + 决策阈值）：
//   low      —— 只读类（read / grep / glob）
//   medium   —— 写文件 / 编辑 / 一般 bash 命令
//   high     —— 执行 + 网络 / 删除 / 提权命令
//   danger   —— 黑名单命令（rm -rf / git push --force / curl | sh 等），强制 typed confirmation
//
// 决策类型：
//   deny           —— 拒绝本次
//   allow_once     —— 允许本次（不写入持久规则）
//   allow_always   —— 允许本次 + 写入 ~/.kodax/permissions.json 的 always-allow（pattern 可选）

import { z } from 'zod';

// 共享：tool call 描述。toolName + input + 可选 pattern（如 "bash:rm -rf *"）。
// 用 z.record(z.unknown()) 而非 z.unknown()——保证 input 是个 object，
// renderer 渲染时不必再做 typeof / null 兜底。
const permissionInputSchema = z
  .record(z.unknown())
  .refine((value) => Object.keys(value).length <= 128, 'permission input has too many fields');
const permissionOperationSchema = z.enum(['read', 'write', 'execute', 'network', 'unknown']);
const permissionToolCallSchema = z.object({
  toolId: z.string().min(1),
  toolName: z.string().min(1),
  input: permissionInputSchema.optional(),
  operation: permissionOperationSchema.optional(),
  executionCwd: z.string().min(1).max(4096).optional(),
});

const riskLevelSchema = z.enum(['low', 'medium', 'high', 'danger']);
const decisionSchema = z.enum(['deny', 'allow_once', 'allow_always']);

// Structured Auto[LLM] diagnostics shared by the legacy inline askUser lane and
// the Runtime permission projection. These fields describe how a decision was
// produced; they never grant authority and never contain classifier prompt or
// response text.
const autoModeClassifierFailureKindSchema = z.enum([
  'timeout',
  'provider_error',
  'contract_error',
  'input_budget',
]);
const autoModeClassifierAttemptOutcomeSchema = z.enum([
  'allow',
  'confirm',
  'timeout',
  'provider_error',
  'contract_error',
  'input_budget',
]);
const autoModeObservedProtocolSchema = z.enum(['structured_v2', 'legacy_v1', 'unknown']);
const autoModeParseFailureCodeSchema = z.enum([
  'missing_decision',
  'invalid_decision',
  'ambiguous_decision',
  // Retained for historical Runtime events created before auxiliary fields
  // became warnings in KodaX 0.7.79.
  'missing_hazard',
  'invalid_hazard',
  'decision_hazard_conflict',
  'decision_reason_conflict',
  'missing_reason',
  'structured_format_violation',
  'legacy_format_violation',
  'tool_use',
]);
export const autoModeOutputWarningCodeSchema = z.enum([
  'missing_hazard',
  'invalid_hazard',
  'decision_hazard_conflict',
  'decision_reason_conflict',
  'missing_reason',
  'structured_format_violation',
  'legacy_format_violation',
]);
const autoModeAttemptProviderDiagnosticsSchema = z
  .object({
    provider: z.string().min(1).max(128),
    model: z.string().min(1).max(256),
    timeoutMs: z.number().int().nonnegative(),
    elapsedMs: z.number().int().nonnegative(),
    promptBytes: z.number().int().nonnegative(),
    retryCount: z.number().int().nonnegative().max(16),
    retryWaitMs: z.number().int().nonnegative(),
    terminalPhase: z.enum([
      'completed',
      'pre_output',
      'awaiting_text',
      'thinking',
      'streaming',
      'contract_error',
    ]),
  })
  .strict();
const autoModeClassifierAttemptSchema = z
  .object({
    attempt: z.number().int().positive().max(4),
    outcome: autoModeClassifierAttemptOutcomeSchema,
    diagnostics: autoModeAttemptProviderDiagnosticsSchema.optional(),
    observedProtocol: autoModeObservedProtocolSchema.optional(),
    parseFailureCode: autoModeParseFailureCodeSchema.optional(),
    outputWarnings: z.array(autoModeOutputWarningCodeSchema).max(16).optional(),
  })
  .strict();
export const autoModeDecisionDiagnosticsSchema = z
  .object({
    source: z.enum([
      'classifier_confirm',
      'classifier_failure',
      'classifier_circuit_breaker',
      'configuration',
    ]),
    classifierFailureKind: autoModeClassifierFailureKindSchema.optional(),
    classifierAttempts: z.array(autoModeClassifierAttemptSchema).max(4).optional(),
  })
  .strict();
const permissionAllowAlwaysScopeSchema = z
  .object({
    /** Display-only metadata for a Runtime-issued, concrete persistent grant suggestion. */
    kind: z.literal('runtime_persistent'),
    label: z.string().min(1).max(512),
  })
  .strict();

// Always-allow rule. pattern 形如 "<toolName>" 或 "<toolName>:<input-fingerprint>"。
//   - "<toolName>" 单独：批准该工具所有调用（如 "read"）
//   - "<toolName>:<fingerprint>" 复合：精确匹配某种调用形态（如 "bash:npm install"）
// fingerprint 由 main 端从 input 生成（不在 schema 层做——schema 只承载结构）。
const permissionRuleSchema = z.object({
  pattern: z.string().min(1),
  createdAt: z.number().int().nonnegative(),
  /** Omitted by pre-0.1.32 clients; identifies the authority that owns revocation. */
  origin: z.enum(['space', 'runtime']).optional(),
  /** Runtime grant identity/CAS fields. Never synthesize these for Space-owned rules. */
  grantId: z.string().min(1).max(256).optional(),
  revision: z.number().int().nonnegative().optional(),
  toolName: z.string().min(1).max(256).optional(),
  sessionId: z.string().min(1).max(256).optional(),
});

// ---- Push: permission.request ----
// reqId 由 main 生成，renderer 必须原样回传。
// reason 是简短文字，可显示给用户（"工具调用前需要批准" / "命令包含潜在危险操作" 等）。
export const permissionRequestChannel = {
  name: 'permission.request',
  direction: 'push',
  payload: z.object({
    reqId: z.string().min(1),
    sessionId: z.string().min(1),
    risk: riskLevelSchema,
    reason: z.string().max(512),
    autoModeDiagnostics: autoModeDecisionDiagnosticsSchema.optional(),
    toolCall: permissionToolCallSchema,
    /** 已生成的 pattern 候选，给 "Always allow" 选项预填，renderer 决定要不要带 pattern。*/
    suggestedPattern: z.string().min(1).max(512).optional(),
    /**
     * Space-owned description of the persistent grant that main can safely create.
     * This is display metadata only; renderer still submits only the decision and
     * main derives the trusted Runtime scope from the pending request.
     */
    allowAlwaysScope: permissionAllowAlwaysScopeSchema.optional(),
  }),
} as const;

// ---- Push: permission.cancelled ----
// 当 session 被取消 / 删除 / 出错时，main 主动撤回 pending request。
// renderer 收到后关掉对应弹窗（即使用户还没决策也算"自动拒绝"）。
export const permissionCancelledChannel = {
  name: 'permission.cancelled',
  direction: 'push',
  payload: z.object({
    reqId: z.string().min(1),
    sessionId: z.string().min(1),
    reason: z.enum(['session_cancelled', 'session_disposed', 'timeout', 'shutdown']),
  }),
} as const;

// ---- Invoke: permission.answer ----
// 决策由 renderer 回 main。
//
// review C2-sec（2026-05-17）：去掉 pattern 字段。原本允许 renderer 提交自定义 pattern
// 持久化到 ~/.kodax/permissions.json——这是个 trust gap：renderer 如被攻陷可提交
// pattern="bash" 把整个 bash 工具批准。现在 main 端用自己生成的 trustedPattern（broker
// 在 push 时已生成 suggestedPattern 并保存到 pending entry），handler 通过 broker.peek()
// 取出来用，renderer 只能选 decision 三选一。
export const permissionAnswerChannel = {
  name: 'permission.answer',
  direction: 'invoke',
  input: z.object({
    reqId: z.string().min(1),
    decision: decisionSchema,
  }),
  output: z.object({
    accepted: z.boolean(),
  }),
} as const;

// ---- Invoke: permission.list ----
// 列出当前所有 always-allow 规则。给设置面板 / 撤销用。
export const permissionListChannel = {
  name: 'permission.list',
  direction: 'invoke',
  input: z.undefined().optional(),
  output: z.object({
    rules: z.array(permissionRuleSchema),
  }),
} as const;

// ---- Invoke: permission.revoke ----
// 删除一条 always-allow 规则。
export const permissionRevokeChannel = {
  name: 'permission.revoke',
  direction: 'invoke',
  input: z
    .object({
      pattern: z.string().min(1).max(512).optional(),
      grantId: z.string().min(1).max(256).optional(),
      revision: z.number().int().nonnegative().optional(),
    })
    .superRefine((value, ctx) => {
      const local = value.pattern !== undefined;
      const runtime = value.grantId !== undefined && value.revision !== undefined;
      if (local === runtime) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'provide either pattern or grantId with revision',
        });
      }
    }),
  output: z.object({
    removed: z.boolean(),
  }),
} as const;

export type PermissionRisk = z.infer<typeof riskLevelSchema>;
export type PermissionDecision = z.infer<typeof decisionSchema>;
export type AutoModeOutputWarningCode = z.infer<typeof autoModeOutputWarningCodeSchema>;
export type AutoModeDecisionDiagnostics = z.infer<typeof autoModeDecisionDiagnosticsSchema>;
export type PermissionToolCall = z.infer<typeof permissionToolCallSchema>;
export type PermissionRule = z.infer<typeof permissionRuleSchema>;
export type PermissionRequestPayload = z.infer<typeof permissionRequestChannel.payload>;
export type PermissionCancelledPayload = z.infer<typeof permissionCancelledChannel.payload>;
