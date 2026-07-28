// Session lifecycle channels — FEATURE_003.
//
// Renderer → main 是 request/response（invoke）：create / send / cancel / list / delete
// Main → renderer 是 push 流：session.event（discriminated union by kind）
//
// Session.send 不直接返回 LLM 输出——它只是 ACK"我已接受并把这条 prompt 排进 session"。
// 实际 token / tool call / 结果通过 session.event push 实时推。

import { z } from 'zod';
import { partnerKnowledgeScopeSchema } from './partner-knowledge.js';

// ---- Reasoning mode (镜像 @kodax-ai/llm 的 KodaXReasoningMode 闭集) ----
export const reasoningModeSchema = z.enum(['off', 'auto', 'quick', 'balanced', 'deep']);
export type ReasoningMode = z.infer<typeof reasoningModeSchema>;

// ---- Permission mode (FEATURE_029 / alpha.1) — 对齐 KodaX REPL canonical ----
// 起因 + 决策记录见 docs/ADR/ADR-005-permission-mode-canonical.md
//
// **canonical 3 mode**（与 KodaX REPL FEATURE_092 对齐）：
//   - 'plan'         只规划，所有 mutating 工具 hard-block (planModeBlockCheck 拦下)
//   - 'accept-edits' edit/write 自动批；bash / network / MCP 走 confirm
//   - 'auto'         所有 tools 由 AutoModeToolGuardrail 守门（FEATURE_030 注入）
//
// auto mode 配 sub-engine: 'llm' | 'rules' (autoModeEngineSchema, 见下)
// fallback：denial threshold (3/20) 或 circuit breaker (5/10m) 触发后 llm 自动降到 rules，
// 通过 SessionEvent 'auto_engine_change' 通知 renderer 更新 UI。
//
// **alpha.0/.1 旧 enum 已 deprecated**：
//   - 'plan-mode'          → 'plan'
//   - 'ask-permissions'    → 'accept-edits' (KodaX 没有"问每次"独立 mode)
//   - 'bypass-permissions' → 'auto' + engine 'rules' (auto-rules.jsonc allow-all 实现 bypass)
//   - 'accept-edits'       → 'accept-edits' (不变)
//
// 注意：当前 desktop sessions 仅 in-memory (host Map)，**无持久化文件**，故未实现
// migrateLegacyPermissionMode 迁移函数——zod 在 IPC 边界直接拒绝旧 enum 值。
// 未来若 F033 引入 ~/.kodax/sessions/ 持久化加载，再补迁移函数 + 单测。
export const permissionModeSchema = z.enum(['plan', 'accept-edits', 'auto']);
export type PermissionMode = z.infer<typeof permissionModeSchema>;

// ---- Auto-mode engine 子档 (FEATURE_029) ----
//
// 仅 permissionMode === 'auto' 时有意义。
//   - 'llm'   sideQuery 调 classifier 让 LLM 判断 risk
//   - 'rules' 走 ~/.kodax/auto-rules.jsonc + 内置 signals (file/bash/path) + AGENTS.md context
//
// 启动默认 'llm'；触发 denial threshold / circuit breaker → 自动 'rules'。
export const autoModeEngineSchema = z.enum(['llm', 'rules']);
export type AutoModeEngine = z.infer<typeof autoModeEngineSchema>;

// KodaX agent 形态（0.7.72 起 AMAW 已并入 AMA）:
//   - 'ama' = Adaptive Multi-Agent（仅显式 Workflow 强信号、显式命令和 SDK Workflow 入口）
//   - 'sa'  = Single Agent (单 agent loop，资源 / 并发受限时的 fallback)
// SDK 默认是 'ama'；Space 显式持有该字段，让用户能在 UI 主动切换 / 降级。
export const agentModeSchema = z.enum(['ama', 'sa']);
export type AgentMode = z.infer<typeof agentModeSchema>;

// ---- Surface (F045 Partner 批次地基) ----
//
// 工作面：'code' = Coder（编码），'partner' = Partner（文档/协作）。与 renderer
// 的 store/surface.ts 的 Surface 联合**值对齐**（'code' | 'partner'）。
//
// 持久化语义：写盘时把 surface 值原样写进 KodaX SDK 的 session tag（consumer 私有
// 自由字符串）——surface 'code'→tag 'code'，'partner'→tag 'partner'。
// 反推（mapper）：tag==='partner' ? 'partner' : 'code'。故历史无 tag 的 session 自然
// 归 Coder（向后兼容），tag 损坏/未知值也保守归 Coder。
// list 侧不把 tag 下推给 SDK（仍按 projectRoot+scope 拉），mapper 反推 surface 后由
// main 端 filter——避开"自维护索引 + all-fetch 致 session 列不全"的历史回退坑（②B）。
const surfaceSchema = z.enum(['code', 'partner']);
export type Surface = z.infer<typeof surfaceSchema>;

// ---- Provider ID (review F008 C2-sec)
//
// SDK custom provider names are broader than kebab-case. Space accepts a
// conservative token charset here; main still checks the provider exists.
//
// 限制 providerId 字符集到合法 token——避免任意字符串混进 ManagedSession.provider 字段
// （`../../etc/passwd`、`%00injected`、`<script>` 等）。允许：
//   - 'mock' for the FEATURE_003 mock adapter
//   - built-ins such as 'anthropic' and 'zhipu-coding'
//   - Space-generated custom ids such as 'custom_0123456789abcdef'
//   - SDK config custom names using letters, numbers, dot, underscore, colon, and dash
const providerIdSchema = z.union([
  z.literal('mock'),
  z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/, {
    message: 'providerId must be a provider token',
  }),
]);

// ---- 尺寸上限：防 IPC 通道被超大 payload 拖垮（DoS / 内存炸） ----
//
// MAX_PROMPT_BYTES: 1 MB——比常见编辑器粘贴 + 整文件投喂的上限宽松，足以承载真实
//   "把这 N 个文件分析一下" 类 prompt。再大需要先切片。
// MAX_TEXT_CHUNK:  256 KB——单条 text_delta/thinking_delta 上限。LLM 流式返回里
//   每个 chunk 通常只有几十到几千字节，256 KB 留一个数量级缓冲。
// MAX_TOOL_RESULT: 512 KB——tool_result.content 比 text_delta 大一档：
//   `cat` 一个文件、`grep` 一片代码、http response body 都走这里。再大该工具
//   应该 truncate（KodaX 内核已经做这个）；schema 层兜底拒绝异常巨大值。
const MAX_PROMPT_BYTES = 1_048_576;
const MAX_PARTNER_PROMPT_OVERLAY_BYTES = 131_072;
const MAX_TEXT_CHUNK = 262_144;
const MAX_TOOL_RESULT = 524_288;

// ---- Session metadata（list/create 返回） ----
//
// title 是可选——session 刚创建时为空，第一次 send 后由 host 用 prompt 头 50 字填一个临时值；
// FEATURE_006/008 时再升级成用 cheap LLM 总结成 ≤ 8 字。
// 用户可通过 session.setTitle 手工覆盖。
//
// FEATURE_033 in-memory fork 字段：
//   parentSessionId    — 仅 fork 出来的 child 有；root 不带
//   forkPointTurnIdx   — fork 时 source 的 turn idx（仅 child 有）
// KodaX SDK 0.7.42 持久化 API ready 后这两个字段会同时改由 SDK 注入。
const sessionMetaSchema = z.object({
  sessionId: z.string().min(1),
  projectRoot: z.string().min(1),
  provider: providerIdSchema,
  reasoningMode: reasoningModeSchema,
  /** F033 fork child 才有；root session 不带。*/
  parentSessionId: z.string().min(1).optional(),
  /** F033 fork 时 source 的 turn idx (>= 0)。*/
  forkPointTurnIdx: z.number().int().nonnegative().optional(),
  /**
   * FEATURE_029：canonical 3 mode。缺省 'accept-edits'——足够日常 edit/write
   * 自动批 + bash/network 仍走 confirm，对新用户最不容易出事。
   * 用户想跑全自动 → 显式切 'auto' (会触发 AutoModeToolGuardrail bootstrap)。
   */
  permissionMode: permissionModeSchema.default('accept-edits'),
  /**
   * 仅当 permissionMode === 'auto' 时实际驱动 guardrail；其他 mode 下仍持有该字段
   * （用户先选 engine 再切到 auto 是合法路径）。
   * **非 optional**：runtime ManagedSession.autoModeEngine 始终有值，default 'llm'
   * 与 IPC layer 一致——避免 main 端 "always present" 与 renderer 端 "may absent"
   * 双语义分歧（reviewer 反馈 MEDIUM）。
   */
  autoModeEngine: autoModeEngineSchema.default('llm'),
  /**
   * Agent 编排形态。默认 'ama'（多智能体协作，与 KodaX SDK 默认一致）。
   * 'sa' 是 fallback 选择（接口并发受限、需要节省 token 时显式降级）。
   */
  agentMode: agentModeSchema.default('ama'),
  /**
   * F045: 工作面归属（Coder / Partner）。session 创建时定死，持久化为 SDK session tag。
   * 缺省 'code'——无 tag 的历史 session 归 Coder（向后兼容）。决定它出现在哪个面的列表。
   */
  surface: surfaceSchema.default('code'),
  title: z.string().max(256).optional(),
  createdAt: z.number().int().nonnegative(),
  lastActivityAt: z.number().int().nonnegative(),
  /**
   * 用户消息条数。来源：
   *   - persisted session: SDK listSessions summary 的 msgCount（落盘权威值）
   *   - in-flight session: in-memory userMessages buffer 长度
   * 可选（向后兼容旧 IPC client）；缺省时 dashboard 退回 in-memory 累加。
   *
   * 让 WelcomeDashboard 重启 Space 后也能显示真实历史 Messages 数，无需逐一打开
   * 每个 session 触发 history restore。零额外 I/O：SDK 已经 fast-path 缓存 summary。
   */
  msgCount: z.number().int().nonnegative().optional(),
  /**
   * Model alias（如 'deepseek-v4-pro'）。可选——in-flight session 用户 /model 设过才有；
   * 没设时 fallback 到 provider.defaultModel；persisted session 当前 SDK summary 不暴露
   * 此字段，留空让 dashboard fallback 到 provider 维度统计。
   */
  model: z.string().max(128).optional(),
  /**
   * Whether provider/model came from the Space sidecar or from current defaults
   * because this legacy session predates runtime identity persistence.
   * In-flight sessions omit the field because their runtime is authoritative.
   */
  runtimeMetadataSource: z.enum(['persisted', 'current-default-fallback']).optional(),
});

// ---- Invoke: session.create ----
export const sessionCreateChannel = {
  name: 'session.create',
  direction: 'invoke',
  input: z.object({
    projectRoot: z.string().min(1),
    provider: providerIdSchema,
    /**
     * 生效 model（renderer 用 resolveActiveModel 解析后带上）。可选——缺省走 provider 默认。
     * 显式带上让 SDK 应用该 model 的 per-model 能力（如真实 contextWindow），避免默认模型下
     * SDK 兜底小窗口导致过早压缩（2026-06-15 用户复报）。
     */
    model: z.string().min(1).max(128).optional(),
    reasoningMode: reasoningModeSchema.optional(),
    permissionMode: permissionModeSchema.optional(),
    /** 仅 mode='auto' 生效。缺省 'llm'。*/
    autoModeEngine: autoModeEngineSchema.optional(),
    /** 缺省 'ama'。SA 是接口并发受限的 fallback。*/
    agentMode: agentModeSchema.optional(),
    /** F045: 工作面。缺省 'code'。决定 session 的 tag（写盘）/ 工具集 / 列表归属。*/
    surface: surfaceSchema.optional(),
    /**
     * Host-only temporary session marker. Ephemeral sessions may run through the
     * normal SDK stream, but they are hidden from restored user session lists
     * until explicitly promoted.
     */
    ephemeral: z.boolean().optional(),
  }),
  output: z.object({
    sessionId: z.string().min(1),
    createdAt: z.number().int().nonnegative(),
    reasoningMode: reasoningModeSchema,
    permissionMode: permissionModeSchema,
    autoModeEngine: autoModeEngineSchema,
    agentMode: agentModeSchema,
  }),
} as const;

// ---- Input artifact (OC-31 v0.1.9, image-paste / drag-drop) ----
//
// 透传给 KodaX SDK 的 KodaXContextOptions.inputArtifacts；SDK 会用
// buildPromptMessageContent(prompt, artifacts) 把每个 image 转成 multimodal
// content block ({type:'image', path, mediaType}) 拼到 user message。
//
// `path`: main 端写到 pending temp sandbox 的绝对路径；session.send 接受前由 main
//          复制到 <KODAX_HOME>/space/session-attachments/<sid>/。
//          ── renderer 不能传任意路径，path 必须是 clipboard.saveImage IPC 返回的
//          ── 受信任值；schema 只做长度兜底，main 会做路径/realpath 边界校验。
// `mediaType`: Space saveImage currently persists PNG/JPEG/WEBP. KodaX 0.7.56
//          also defines image/gif for direct SDK path artifacts; keep GIF as a
//          later Space persistence/preview follow-up.
// `source`: KodaX 0.7.56 artifact source union. Older callers that omit it keep
//          the legacy user-inline default. Current emitters are 'clipboard' (paste),
//          'drag-drop', and 'file-picker'. Every image emitter sends bytes through
//          clipboard.saveImage, so `path` stays inside the main-owned sandbox enforced
//          by assertArtifactPathInClipboardSandbox. A picker path must never be
//          forwarded directly as an image artifact.
const inputArtifactSourceSchema = z.enum(['user-inline', 'clipboard', 'drag-drop', 'file-picker']);
const inputArtifactSchema = z.object({
  kind: z.literal('image'),
  path: z.string().min(1).max(4096),
  mediaType: z.enum(['image/png', 'image/jpeg', 'image/webp']),
  source: inputArtifactSourceSchema.default('user-inline'),
});
export type InputArtifact = z.infer<typeof inputArtifactSchema>;

const SESSION_ATTACHMENT_PREVIEW_URL_RE =
  /^app:\/\/space\/session-attachment\/[A-Za-z0-9_-]{32,128}\?variant=(?:thumbnail|original)$/;

export function isSessionAttachmentPreviewUrl(value: string): boolean {
  return SESSION_ATTACHMENT_PREVIEW_URL_RE.test(value);
}

const sessionAttachmentPreviewUrlSchema = z
  .string()
  .min(1)
  .max(512)
  .refine(isSessionAttachmentPreviewUrl, 'invalid Session attachment preview URL');

const sessionImageAttachmentBaseSchema = z.object({
  id: z.string().min(1).max(128),
  kind: z.literal('image'),
  label: z.string().min(1).max(256).optional(),
  bytes: z
    .number()
    .int()
    .positive()
    .max(6 * 1024 * 1024)
    .optional(),
});
const sessionImageMediaTypeSchema = z.enum(['image/png', 'image/jpeg', 'image/webp']);

export const sessionImageAttachmentSchema = z.discriminatedUnion('status', [
  sessionImageAttachmentBaseSchema.extend({
    status: z.literal('available'),
    mediaType: sessionImageMediaTypeSchema,
    thumbnailUrl: sessionAttachmentPreviewUrlSchema,
    previewUrl: sessionAttachmentPreviewUrlSchema,
  }),
  sessionImageAttachmentBaseSchema.extend({
    status: z.literal('missing'),
    mediaType: sessionImageMediaTypeSchema.optional(),
  }),
  sessionImageAttachmentBaseSchema.extend({
    status: z.literal('unsupported'),
    mediaType: sessionImageMediaTypeSchema.optional(),
  }),
]);
export type SessionImageAttachment = z.infer<typeof sessionImageAttachmentSchema>;

const attachmentPathSchema = z.object({
  kind: z.enum(['file', 'directory']),
  /** Exact absolute path returned by Electron for the user-selected entry. */
  path: z.string().min(1).max(4096),
});
export type InputArtifactSource = z.infer<typeof inputArtifactSourceSchema>;

const sessionSendQueueModeSchema = z.enum(['interrupt', 'after-turn']);
export type SessionSendQueueMode = z.infer<typeof sessionSendQueueModeSchema>;

// ---- Invoke: session.send ----
export const sessionSendChannel = {
  name: 'session.send',
  direction: 'invoke',
  input: z.object({
    sessionId: z.string().min(1),
    prompt: z.string().min(1).max(MAX_PROMPT_BYTES),
    partnerPromptOverlay: z.string().min(1).max(MAX_PARTNER_PROMPT_OVERLAY_BYTES).optional(),
    /**
     * Non-image attachments keep a file:// link in the visible user message,
     * while these native OS paths are supplied to the model through a prompt
     * overlay. This prevents drive-letter/UNC/POSIX paths from being guessed
     * back from a display URL.
     */
    attachmentPaths: z.array(attachmentPathSchema).max(32).optional(),
    partnerRetrievalScope: partnerKnowledgeScopeSchema.optional(),
    /** OC-31 v0.1.9 image paste/drag-drop. 上限 8 张/turn —— 防 DoS；UI 同步限制。 */
    artifacts: z.array(inputArtifactSchema).max(8).optional(),
    /** Renderer-side guardrail: the main process rejects the send if the
     * resolved session does not still belong to this displayed project.
     * Optional for backward compatibility; not used as an authority source.
     */
    expectedProjectRoot: z.string().min(1).max(4096).optional(),
    /** Same guardrail for Coder/Partner surface routing. */
    expectedSurface: surfaceSchema.optional(),
    /**
     * Only matters when the session already has a running turn.
     * - interrupt: enqueue into SDK main-thread queue for next safe mid-turn drain.
     * - after-turn: hold in Space's per-session queue until the running turn settles.
     */
    queueMode: sessionSendQueueModeSchema.default('interrupt'),
  }),
  output: z.object({
    // 只是 ACK"已排进 session 队列"——真正结果走 session.event push
    accepted: z.literal(true),
    /**
     * When a turn is already running, RealKodaXSession accepts the prompt into
     * the requested queue mode instead of starting a concurrent run.
     * queued=true means the prompt is queued; queueId identifies that queue item.
     * queued=false means a run was started immediately.
     */
    queued: z.boolean().optional(),
    queueId: z.string().min(1).max(128).optional(),
    queueMode: sessionSendQueueModeSchema.optional(),
    /** Main-issued, path-free preview capabilities for accepted image artifacts. */
    attachments: z.array(sessionImageAttachmentSchema).max(8).optional(),
  }),
} as const;

// ---- Invoke: session.cancel ----
export const sessionCancelChannel = {
  name: 'session.cancel',
  direction: 'invoke',
  input: z.object({
    sessionId: z.string().min(1),
  }),
  output: z.object({
    cancelled: z.boolean(),
  }),
} as const;

// ---- Invoke: session.list ----
//
// 可选 projectRoot 过滤——左抽屉切换项目时拉本项目下的 session。
// 不传则返回所有 session。
export const sessionListChannel = {
  name: 'session.list',
  direction: 'invoke',
  input: z
    .object({
      projectRoot: z.string().min(1).max(4096).optional(),
      /** F045: 只返回该工作面的 session（不传 = 全部，含历史无 tag 的）。 */
      surface: surfaceSchema.optional(),
      /** 最近列表默认 200；全量会话选择器可按需扩大，仍受主进程硬上限保护。 */
      limit: z.number().int().min(1).max(50_000).optional(),
    })
    .optional(),
  output: z.object({
    sessions: z.array(sessionMetaSchema),
  }),
} as const;

// ---- Invoke: session.setTitle ----
//
// 手工设置标题。F005 让用户右键 session 卡片"Rename"用。
export const sessionSetTitleChannel = {
  name: 'session.setTitle',
  direction: 'invoke',
  input: z.object({
    sessionId: z.string().min(1),
    title: z.string().min(1).max(256),
  }),
  output: z.object({
    ok: z.boolean(),
  }),
} as const;

// ---- Invoke: session.delete ----
export const sessionDeleteChannel = {
  name: 'session.delete',
  direction: 'invoke',
  input: z.object({
    sessionId: z.string().min(1),
  }),
  output: z.object({
    deleted: z.boolean(),
    reason: z.literal('session_running').optional(),
  }),
} as const;

// ---- Invoke: session.setPermissionMode ---- (FEATURE_029)
//
// Claude Desktop Mode 切换 (Ctrl+M)。立即生效——下一次 tool call 走新 mode。
// 切到 'auto' 时如果 autoModeEngine 未先设置过，main 端用缺省 'llm' bootstrap guardrail。
export const sessionSetPermissionModeChannel = {
  name: 'session.setPermissionMode',
  direction: 'invoke',
  input: z.object({
    sessionId: z.string().min(1),
    mode: permissionModeSchema,
  }),
  output: z.object({
    ok: z.boolean(),
  }),
} as const;

// ---- Invoke: session.setAutoModeEngine ---- (FEATURE_029)
//
// 用户手动在 Auto 子菜单切 llm ↔ rules。立即生效；若当前 mode 不是 'auto' 也接受
// （记录起来，下次切到 auto 时生效），main 端不强制 mode === 'auto'。
export const sessionSetAutoModeEngineChannel = {
  name: 'session.setAutoModeEngine',
  direction: 'invoke',
  input: z.object({
    sessionId: z.string().min(1),
    engine: autoModeEngineSchema,
  }),
  output: z.object({
    ok: z.boolean(),
  }),
} as const;

// ---- Invoke: session.setAgentMode ----
//
// 切 AMA / SA。Workflow 是否可调用由 KodaX 的强信号策略决定。
// 切换不重启 session，下一条 prompt 应用新形态。
export const sessionSetAgentModeChannel = {
  name: 'session.setAgentMode',
  direction: 'invoke',
  input: z.object({
    sessionId: z.string().min(1),
    agentMode: agentModeSchema,
  }),
  output: z.object({
    ok: z.boolean(),
  }),
} as const;

// ---- Invoke: session.setReasoningMode ---- (FEATURE_008)
//
// 切 reasoning mode **不重启** session——新设置应用于下一条 prompt。
// Mock 阶段只在 main 端 ManagedSession 上更新字段；Real adapter 会把它传到 KodaX runtime。
export const sessionSetReasoningModeChannel = {
  name: 'session.setReasoningMode',
  direction: 'invoke',
  input: z.object({
    sessionId: z.string().min(1),
    mode: reasoningModeSchema,
  }),
  output: z.object({
    ok: z.boolean(),
  }),
} as const;

// ---- Invoke: session.setProvider ---- (FEATURE_008)
//
// 切 provider 同样不重启 session——下一条 prompt 走新 provider。Real adapter 接入后
// 会重新 import provider class 并 swap LLM client。
// providerId 必须是 token-shaped built-in/custom/SDK-config provider name
// （或 'mock'，用于 FEATURE_003 兼容）
//
// 注意：schema 只验格式；main 端 handler 必须再做"是否实际存在于 catalog/custom" 检查
// （review F008 C1-sec）。否则 attacker 可让 session 指向永不存在的 custom_ID，
// real adapter 接入后会静默 fallback 或抛错
export const sessionSetProviderChannel = {
  name: 'session.setProvider',
  direction: 'invoke',
  input: z.object({
    sessionId: z.string().min(1),
    providerId: providerIdSchema,
  }),
  output: z.object({
    ok: z.boolean(),
  }),
} as const;

// ---- Invoke: session.agentsMd ---- (FEATURE_034)
//
// 拉取当前 session 已加载的 AGENTS.md 文件列表。renderer 在 AgentsMd popout 打开
// 时调一次拿数据；不缓存，每次走 disk 重新 stat + read——满足"AGENTS.md 修改后
// 下次拉取就生效"的语义（KodaX REPL 同步行为）。
//
// scope 枚举与 KodaX `@kodax-ai/coding` AgentsFile 严格对齐：
//   - 'global'    ~/.kodax/AGENTS.md
//   - 'project'   ${projectRoot}/AGENTS.md
//   - 'directory' 暂不扫，留扩展位（KodaX REPL cwd→root 递归 + .kodax 子目录 用过）
//
// content 上限：256KB / file（main loader 已 truncate + marker），数组 ≤ 16 file
// 兜底 DoS。
const agentsFileSchema = z.object({
  path: z.string().min(1).max(4096),
  content: z.string().max(262_144 + 64),
  scope: z.enum(['global', 'project', 'directory']),
});

export const sessionAgentsMdChannel = {
  name: 'session.agentsMd',
  direction: 'invoke',
  input: z.object({
    sessionId: z.string().min(1),
  }),
  output: z.object({
    files: z.array(agentsFileSchema).max(16),
  }),
} as const;

export type AgentsFileMeta = z.infer<typeof agentsFileSchema>;

// ---- Invoke: session.agentsMd.save ---- (FEATURE_034 inline edit, REPL /memory 等价)
//
// /memory 命令的写入路径: 用户在 AgentsMdPanel ContextTab 切到 edit mode → 改内容 → Save。
// main 端只允许写两个 scope:
//   - 'global'  → ~/.kodax/AGENTS.md  (KodaX 全局 context)
//   - 'project' → <session.projectRoot>/AGENTS.md
// 'directory' scope 不开放写 (递归扫的目录,任意路径不安全)。
//
// 安全:
//   - sessionId 必须存在 (host.get 命中) — 通过 IPC handler 限定 projectRoot 来源
//   - scope 是 'global' | 'project' 二选一 — 不允许 renderer 传任意路径
//   - content 256KB 上限 - DoS guard,同 agentsFileSchema.content max
//   - main 端原子写 (tmp → rename),与 KodaX REPL /memory 同语义
export const sessionAgentsMdSaveChannel = {
  name: 'session.agentsMd.save',
  direction: 'invoke',
  input: z.object({
    sessionId: z.string().min(1),
    scope: z.enum(['global', 'project']),
    /** 文件完整内容 (替换写入,不是 patch)。最大 256KB,与 agentsFile.content 限制一致 */
    content: z.string().max(262_144),
  }),
  output: z.object({
    ok: z.boolean(),
    /** 写入文件的绝对路径 (回显给 renderer 让用户看到落盘到哪)。 */
    path: z.string().max(4096),
  }),
} as const;

// ---- Invoke: session.history ---- (FEATURE_039 / 历史恢复)
//
// 用户点 Recents 里历史 session 时拉过去对话内容。Renderer 的 events / userMessages
// buffer 是 in-memory，重启后空；session 元数据由 KodaX SDK 持久化但 messages 不进
// 我们的 push channel。这里读 KodaX 的 loadSession(sid) → 按顺序拍平 content blocks →
// 喂给 renderer 让 composeMessages 重建对话。
//
// **v0.1.x: 全量回放**——除 user / assistant text 外，还回 tool_call（toolId / toolName /
// input / result）。assistant 一个 turn 内的 text/tool 顺序通过 items 数组顺序保留:
//   [user, assistant_text "Let me check", tool_call grep, assistant_text "found it", user, ...]
// renderer 收到后 prependSessionHistory 会按这个顺序发 text_delta + tool_start + tool_result
// + session_complete 进 events buffer,composeMessages 自动重建出气泡 + tool card。
//
// 上限：items 最多 2000 — 长会话也罕见超过这个；每条 user/assistant 含 content 文本上限同 text_delta。
const historyToolCallSchema = z.object({
  kind: z.literal('tool_call'),
  toolId: z.string().min(1).max(128),
  toolName: z.string().min(1).max(64),
  /** SDK 持久化的 tool_use 输入参数 (JSON 对象)。可能缺失 (历史 message 损坏 / 早期版本)。*/
  input: z.record(z.unknown()).optional(),
  /** 对应的 tool_result 内容 (拍平字符串)。空字符串 = 工具被 cancel/skip;undefined = 没匹配上 result。*/
  result: z.string().max(MAX_TOOL_RESULT).optional(),
  /** SDK 已知 toolId,但实际 tool_result 出错时的 error 字段 (string)。*/
  isError: z.boolean().optional(),
});

const historySidecarMessageSchema = z.object({
  kind: z.literal('sidecar_message'),
  message: z.object({
    source: z.literal('sidecar-verifier'),
    verdict: z.enum(['revise', 'blocked']),
    recipient: z.enum(['main-agent', 'user']),
    delivery: z.enum(['synthetic-user-message', 'budget-exhausted', 'terminal-block']),
    content: z.string().max(MAX_TEXT_CHUNK),
    suggestedFix: z.string().max(MAX_TEXT_CHUNK).optional(),
    trace: z.string().max(MAX_TEXT_CHUNK).optional(),
    /**
     * v0.1.x 修复：SDK 不持久化真实 verdict/delivery/suggestedFix——session.history 回放时
     * 这几个字段都是 main 端硬编码的占位值（见 ipc/session.ts），不是这条 sidecar 消息
     * 当时真实的判定结果。renderer 据此把回放的这条渲染成中性的"历史记录"标签，而不是
     * 断言 verdict==='revise'。true = 来自 session.history 回放；缺省/false = 实时事件。
     */
    historical: z.boolean().optional(),
  }),
  sentAt: z.number().int().nonnegative().optional(),
});

/**
 * v0.1.x 新增：fork/rewind 产生的 branch_summary、以及压缩产生的 compaction lineage entry。
 * SDK 会在 lineage 里合成一条 role==='user'(branch_summary) 或 role==='system'(compaction)
 * 的 context message 塞进 messages[]（保证 LLM 上下文正确）——但这不是用户真的打过的字，
 * 按 role 直接拍平会在滚动区里显示成一条假的用户气泡。session.history handler 用
 * loadFullTranscript 的 transcriptEntries[].type 识别出这类 entry 后改发这个 kind，
 * renderer 路由到非 user 的历史提示条（复用 sidecar 的视觉样式，见 composeMessages.ts）。
 */
const historyLineageNoticeSchema = z.object({
  kind: z.literal('lineage_notice'),
  noticeKind: z.enum(['branch_summary', 'compaction']),
  text: z.string().max(MAX_TEXT_CHUNK),
  tokensBefore: z.number().int().nonnegative().max(10_000_000).optional(),
  tokensAfter: z.number().int().nonnegative().max(10_000_000).optional(),
});

/**
 * v0.1.x: workflow 结果历史提示条（仅历史回放）。SDK 把 workflow run 的最终结果/失败作为一条
 * `_synthetic` 的 `<task-completed task_id="…">…</task-completed>` user 消息存进 transcript
 * （位置正确）。session.history handler 识别它、改发这个 kind，renderer **原位**渲染成 workflow
 * system_notice —— 而不是像以前那样把合成消息一律丢弃、再从侧存储按 wall-clock 重排（SDK 压缩会
 * 把 transcript 时间戳压平，导致 workflow 通知在 resume 后乱序/置顶）。
 */
const historyWorkflowNoticeSchema = z.object({
  kind: z.literal('workflow_notice'),
  text: z.string().max(MAX_TEXT_CHUNK),
});

const localNoticeVariantSchema = z.enum(['echo', 'output']);
const sessionLocalNoticeSchema = z.object({
  id: z.string().min(1).max(128),
  content: z.string().max(MAX_TEXT_CHUNK),
  sentAt: z.number().int().nonnegative(),
  variant: localNoticeVariantSchema.optional(),
});
export type SessionLocalNotice = z.infer<typeof sessionLocalNoticeSchema>;

const historyLocalNoticeSchema = sessionLocalNoticeSchema.extend({
  kind: z.literal('local_notice'),
});

const sessionHistoryItemSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('user'),
    content: z.string().max(MAX_TEXT_CHUNK),
    attachments: z.array(sessionImageAttachmentSchema).max(32).optional(),
    /** SDK 持久化的消息时间戳 (epoch ms)；缺失时 renderer fallback 到 sessionMeta.createdAt。
     *  让历史恢复的消息 footer "Xd ago" 显示真实时间而不是恢复瞬间 "just now"。 */
    sentAt: z.number().int().nonnegative().optional(),
    /**
     * Stable Runtime identity for this visible user boundary. A Runtime turn may consume more
     * than one real user message, so turnId alone is not unique.
     */
    turnId: z.string().min(1).max(128).optional(),
    turnUserOrdinal: z.number().int().nonnegative().max(1_000_000).optional(),
  }),
  z.object({
    kind: z.literal('assistant'),
    text: z.string().max(MAX_TEXT_CHUNK),
    thinking: z.string().max(MAX_TEXT_CHUNK).optional(),
    sentAt: z.number().int().nonnegative().optional(),
  }),
  historyToolCallSchema,
  historySidecarMessageSchema,
  historyLineageNoticeSchema,
  historyWorkflowNoticeSchema,
  historyLocalNoticeSchema,
]);

export const sessionHistoryChannel = {
  name: 'session.history',
  direction: 'invoke',
  input: z.object({
    sessionId: z.string().min(1),
  }),
  output: z.object({
    items: z.array(sessionHistoryItemSchema).max(2000),
  }),
} as const;

export type SessionHistoryItem = z.infer<typeof sessionHistoryItemSchema>;

export const sessionLocalNoticeAppendChannel = {
  name: 'session.localNotice.append',
  direction: 'invoke',
  input: z.object({
    sessionId: z.string().min(1),
    notice: sessionLocalNoticeSchema,
  }),
  output: z.object({
    ok: z.boolean(),
  }),
} as const;

// ---- Invoke: session.promoteEphemeral ----
export const sessionPromoteEphemeralChannel = {
  name: 'session.promoteEphemeral',
  direction: 'invoke',
  input: z.object({
    sessionId: z.string().min(1),
  }),
  output: z.object({
    promoted: z.boolean(),
  }),
} as const;

export const sessionLocalNoticeReplaceChannel = {
  name: 'session.localNotice.replace',
  direction: 'invoke',
  input: z.object({
    sessionId: z.string().min(1),
    notices: z.array(sessionLocalNoticeSchema).max(1000),
  }),
  output: z.object({
    ok: z.boolean(),
  }),
} as const;

// ---- Invoke: session.fork ---- (FEATURE_033 in-memory)
//
// 从 sourceSessionId 在 forkPointTurnIdx 处 fork：
//   - main 端新建 in-memory session，inherit projectRoot/provider/permissionMode 等
//   - 新 session 写 parentSessionId + forkPointTurnIdx 元数据
//   - 真实 events 拷贝由 renderer 完成（events 状态在 appStore 里）
//   - title 自动加 "(fork)" 后缀，便于用户在 sidebar 区分
//
// 持久化语义：alpha.1 仅 in-memory；KodaX SDK 0.7.42 出 forkSession() 后接磁盘。
export const sessionForkChannel = {
  name: 'session.fork',
  direction: 'invoke',
  input: z.object({
    sessionId: z.string().min(1),
    forkPointTurnIdx: z.number().int().nonnegative().max(10_000),
  }),
  output: z.object({
    newSessionId: z.string().min(1),
    createdAt: z.number().int().nonnegative(),
  }),
} as const;

// ---- Invoke: session.rewind ---- (FEATURE_033 in-memory)
//
// 把 session 回退到 rewindPastTurnIdx 处（保留 turns 0..idx 含）：
//   - main 端 cancel 正在跑的 stream + 取消 pending permission/askUser
//   - renderer 端截断 eventsBySession/userMessagesBySession 到 idx
//
// 写入语义：alpha.1 in-memory truncate；SDK 持久化 API ready 后挂磁盘 atomic write。
//
// 若 idx >= 当前 turn 数 → returns ok:false（renderer 不会切到不存在的 turn）。
export const sessionRewindChannel = {
  name: 'session.rewind',
  direction: 'invoke',
  input: z.object({
    sessionId: z.string().min(1),
    rewindPastTurnIdx: z.number().int().nonnegative().max(10_000),
  }),
  output: z.object({
    ok: z.boolean(),
    reason: z.enum(['session_not_found', 'invalid_index', 'session_busy']).optional(),
    diskRewound: z.boolean().optional(),
  }),
} as const;

// ---- Invoke: session.listRunning ---- (FEATURE_125 Team Mode, /status 用)
//
// 调用 SDK listRunningSessions(): RunningSessionInfo[]; 列出活在系统里的其他
// KodaX peer instances (排除自己进程)。包括别的 Space 窗口 / KodaX CLI / REPL 等。
// 用途: /status slash command + sidebar 上的 "N other peers" badge,让用户知道
// 不是孤立运行 (多窗口或 CLI 兼容时常见)。
//
// pid / startedAt / cwd 是 SDK 直读 instance metadata 文件来的;sessionId 在 peer 还没
// 显式 publish 时为 undefined (renderer 兜底显示 "(bootstrapping)")。
const runningSessionInfoSchema = z.object({
  pid: z.number().int().positive(),
  startedAt: z.number().int().nonnegative(),
  cwd: z.string().max(4096),
  sessionId: z.string().min(1).max(128).optional(),
});

export const sessionListRunningChannel = {
  name: 'session.listRunning',
  direction: 'invoke',
  input: z.undefined().optional(),
  output: z.object({
    peers: z.array(runningSessionInfoSchema).max(64),
  }),
} as const;

export type RunningSessionInfoT = z.infer<typeof runningSessionInfoSchema>;

// ---- Push: session.event ----
//
// Discriminated union by `kind`。每条都带 sessionId（同时跑多 session 时 renderer 路由用）。
// 字段命名贴近 @kodax-ai/coding 的 KodaXEvents，便于 Real adapter 一对一映射（详见 docs/features/v0.1.0.md FEATURE_003）。
const toolInputSchema = z.record(z.unknown());
const tokenUsageSchema = z
  .object({
    inputTokens: z.number().int().nonnegative().optional(),
    outputTokens: z.number().int().nonnegative().optional(),
    cacheReadInputTokens: z.number().int().nonnegative().optional(),
    cacheWriteInputTokens: z.number().int().nonnegative().optional(),
  })
  .optional();

const contextBudgetTokenBreakdownSchema = z.object({
  systemPrompt: z.number().int().nonnegative().max(10_000_000),
  toolSchemas: z.number().int().nonnegative().max(10_000_000),
  skillCatalog: z.number().int().nonnegative().max(10_000_000),
  mcpCatalog: z.number().int().nonnegative().max(10_000_000),
  transcript: z.number().int().nonnegative().max(10_000_000),
  pendingInput: z.number().int().nonnegative().max(10_000_000),
  recentToolResults: z.number().int().nonnegative().max(10_000_000),
  reservedResponse: z.number().int().nonnegative().max(10_000_000),
  total: z.number().int().nonnegative().max(10_000_000),
});

const sha256HexSchema = z.string().regex(/^[a-f0-9]{64}$/);

// alpha.1 KodaX 0.7.40 全 surface 接通 — todo / managed_task_status / compact_* / retry_after /
// repointel_trace / session_start / iteration_start / stream_end / thinking_end / tool_input_delta /
// provider_recovery — payload shape 对照 KodaX packages/coding/src/types.ts KodaXEvents 抽取（subset；
// 只挑 desktop UI 驱动得到的字段），具体见 apps/desktop/electron/kodax/kodax-sdk-types.d.ts。
const todoItemSchema = z.object({
  id: z.string().min(1).max(128),
  content: z.string().max(2048),
  // 与 SDK TodoStatus 全量对齐（v0.7.42+ 含 failed/skipped/cancelled 终态）。
  // 之前只列前 3 档，导致 SDK 发的 failed/cancelled 在 IPC 边界被 Zod 拒绝或被上游误映射成
  // completed（失败任务显示成 ✓ 完成，误导用户）。
  status: z.enum(['pending', 'in_progress', 'completed', 'failed', 'skipped', 'cancelled']),
  activeForm: z.string().max(2048).optional(),
});

const repointelTraceSchema = z.object({
  kind: z.string().min(1).max(64),
  mode: z
    .enum(['auto', 'off', 'light', 'full', 'oss', 'premium-shared', 'premium-native'])
    .optional(),
  engine: z.string().max(64).optional(),
  bridge: z.string().max(64).optional(),
  status: z.string().max(64).optional(),
  latencyMs: z.number().nonnegative().max(600_000).optional(),
  cacheHit: z.boolean().optional(),
});

const retryAfterSchema = z.object({
  provider: z.string().min(1).max(64),
  waitMs: z.number().int().nonnegative().max(3_600_000),
  reason: z.enum(['rate-limit', 'overloaded']),
  source: z.enum([
    'retry-after-seconds',
    'retry-after-date',
    'retry-after-ms',
    'exponential-backoff',
  ]),
  attempt: z.number().int().nonnegative().max(100),
  maxAttempts: z.number().int().positive().max(100),
});

const managedLiveEventSchema = z.object({
  key: z.string().min(1).max(128),
  kind: z.enum(['progress', 'completed', 'notification', 'warning']),
  presentation: z.enum(['status', 'assistant', 'thinking']).optional(),
  phase: z.string().max(64).optional(),
  workerId: z.string().max(128).optional(),
  workerTitle: z.string().max(256).optional(),
  summary: z.string().max(1024),
  detail: z.string().max(MAX_TEXT_CHUNK).optional(),
  persistToHistory: z.boolean().optional(),
});

const agentProfileSummarySchema = z.object({
  surface: z.string().min(1).max(64).optional(),
  id: z.string().min(1).max(128).optional(),
  version: z.string().min(1).max(64).optional(),
  name: z.string().min(1).max(128).optional(),
});

const verificationSummarySchema = z.object({
  summary: z.string().max(1024).optional(),
  rubricFamily: z.string().max(64).optional(),
  requiredChecks: z.array(z.string().min(1).max(128)).max(32).optional(),
});

const managedTaskStatusSchema = z.object({
  agentMode: agentModeSchema,
  harnessProfile: z.string().max(64),
  agentProfile: agentProfileSummarySchema.optional(),
  activeWorkerId: z.string().max(128).optional(),
  activeWorkerTitle: z.string().max(256).optional(),
  childFanoutClass: z.string().max(64).optional(),
  childFanoutCount: z.number().int().nonnegative().max(100).optional(),
  currentRound: z.number().int().nonnegative().max(100).optional(),
  maxRounds: z.number().int().nonnegative().max(100).optional(),
  phase: z.string().max(64).optional(),
  note: z.string().max(1024).optional(),
  detailNote: z.string().max(MAX_TEXT_CHUNK).optional(),
  events: z.array(managedLiveEventSchema).max(50).optional(),
  upgradeCeiling: z.string().max(64).optional(),
  globalWorkBudget: z.number().int().nonnegative().max(1_000_000).optional(),
  budgetUsage: z.number().int().nonnegative().max(1_000_000).optional(),
  budgetApprovalRequired: z.boolean().optional(),
  idleWaiting: z.boolean().optional(),
  idleWaitingPendingCount: z.number().int().nonnegative().max(100).optional(),
});
const sidecarMessageSchema = z.object({
  source: z.literal('sidecar-verifier'),
  verdict: z.enum(['revise', 'blocked']),
  recipient: z.enum(['main-agent', 'user']),
  delivery: z.enum(['synthetic-user-message', 'budget-exhausted', 'terminal-block']),
  content: z.string().max(MAX_TEXT_CHUNK),
  suggestedFix: z.string().max(MAX_TEXT_CHUNK).optional(),
  trace: z.string().max(MAX_TEXT_CHUNK).optional(),
  agentProfile: agentProfileSummarySchema.optional(),
  /** v0.1.x: 见 historySidecarMessageSchema 同名字段注释——true 时是 session.history 回放
   *  出来的记录（verdict 等字段是占位值），renderer 渲染中性历史标签而非真实 verdict。
   *  实时事件永远不设这个字段。 */
  historical: z.boolean().optional(),
});

const todoDriftWarningSchema = z.object({
  kind: z.literal('work_started_without_claimed_todo'),
  toolName: z.string().min(1).max(128),
  toolCallId: z.string().min(1).max(128).optional(),
  count: z.number().int().nonnegative().max(10_000),
  pendingCount: z.number().int().nonnegative().max(10_000),
  openCount: z.number().int().nonnegative().max(10_000),
  firstPendingTodoId: z.string().min(1).max(128).optional(),
  firstPendingTodoSubject: z.string().max(2048).optional(),
});

const runtimeSessionEventOriginSchema = z.object({
  runtimeId: z.string().min(1).max(128),
  runId: z.string().min(1).max(128),
  seq: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
});

const runtimeSessionEventOriginShape = {
  /**
   * Runtime provenance is optional for legacy/mock/history events. Daemon-backed live events use
   * it as the causal barrier against an authoritative cumulative session.liveSnapshot cursor.
   */
  runtimeEvent: runtimeSessionEventOriginSchema.optional(),
} as const;

export const sessionEventChannel = {
  name: 'session.event',
  direction: 'push',
  payload: z.discriminatedUnion('kind', [
    // ---- 流式输出（v0.1.0-alpha.0 已有）----
    z.object({
      ...runtimeSessionEventOriginShape,
      kind: z.literal('text_delta'),
      sessionId: z.string().min(1),
      text: z.string().max(MAX_TEXT_CHUNK),
      /** Optional producer/store timestamp for the first chunk in one assistant text block. */
      sentAt: z.number().int().nonnegative().optional(),
    }),
    z.object({
      ...runtimeSessionEventOriginShape,
      kind: z.literal('thinking_delta'),
      sessionId: z.string().min(1),
      text: z.string().max(MAX_TEXT_CHUNK),
      /** Optional producer/store timestamp for the first chunk in one assistant thinking block. */
      sentAt: z.number().int().nonnegative().optional(),
    }),
    z.object({
      ...runtimeSessionEventOriginShape,
      kind: z.literal('thinking_end'),
      sessionId: z.string().min(1),
      // 全量 thinking trace 在大 reasoning session 可能不小，但比 tool_result 小一档。
      // 256KB = MAX_TEXT_CHUNK，与单条 text/thinking_delta 同级——KodaX 内部 thinking 是
      // 流式累积的，到 onThinkingEnd 时长度 ≈ 所有 thinking_delta 拼接。512KB 太大易 DoS。
      thinking: z.string().max(MAX_TEXT_CHUNK),
    }),
    z.object({
      ...runtimeSessionEventOriginShape,
      kind: z.literal('tool_start'),
      sessionId: z.string().min(1),
      toolId: z.string().min(1),
      toolName: z.string().min(1),
      input: toolInputSchema.optional(),
    }),
    z.object({
      ...runtimeSessionEventOriginShape,
      kind: z.literal('tool_input_delta'),
      sessionId: z.string().min(1),
      toolId: z.string().min(1).optional(),
      toolName: z.string().min(1),
      partialJson: z.string().max(MAX_TEXT_CHUNK),
    }),
    z.object({
      ...runtimeSessionEventOriginShape,
      kind: z.literal('tool_progress'),
      sessionId: z.string().min(1),
      toolId: z.string().min(1),
      message: z.string().max(MAX_TEXT_CHUNK),
    }),
    z.object({
      ...runtimeSessionEventOriginShape,
      kind: z.literal('tool_result'),
      sessionId: z.string().min(1),
      toolId: z.string().min(1),
      toolName: z.string().min(1),
      content: z.string().max(MAX_TOOL_RESULT),
    }),
    z.object({
      kind: z.literal('stream_end'),
      sessionId: z.string().min(1),
    }),
    // ---- session/iteration lifecycle ----
    z.object({
      ...runtimeSessionEventOriginShape,
      kind: z.literal('session_start'),
      sessionId: z.string().min(1),
      provider: z.string().min(1).max(64),
      turnId: z.string().min(1).max(128).optional(),
    }),
    z.object({
      kind: z.literal('mid_turn_user_prompt'),
      sessionId: z.string().min(1),
      queueId: z.string().min(1).max(128).optional(),
      content: z.string().min(1).max(MAX_PROMPT_BYTES),
      turnId: z.string().min(1).max(128).optional(),
    }),
    z.object({
      kind: z.literal('queued_user_prompt_started'),
      sessionId: z.string().min(1),
      queueId: z.string().min(1).max(128).optional(),
      queueMode: sessionSendQueueModeSchema,
      content: z.string().min(1).max(MAX_PROMPT_BYTES),
      turnId: z.string().min(1).max(128).optional(),
    }),
    z.object({
      kind: z.literal('queued_user_prompt_failed'),
      sessionId: z.string().min(1),
      queueId: z.string().min(1).max(128),
      queueMode: z.literal('interrupt'),
      content: z.string().min(1).max(MAX_PROMPT_BYTES),
      reason: z.enum(['run_completed', 'run_failed', 'run_cancelled', 'run_interrupted']),
    }),
    z.object({
      kind: z.literal('iteration_start'),
      sessionId: z.string().min(1),
      iter: z.number().int().nonnegative(),
      maxIter: z.number().int().positive(),
    }),
    z.object({
      kind: z.literal('iteration_end'),
      sessionId: z.string().min(1),
      iter: z.number().int().nonnegative(),
      maxIter: z.number().int().positive(),
      tokenCount: z.number().int().nonnegative(),
      tokenSource: z.enum(['api', 'estimate']).optional(),
      scope: z.enum(['parent', 'worker']).optional(),
      usage: tokenUsageSchema,
      contextId: z.string().min(1).max(512).optional(),
      contextKind: z.enum(['root', 'child']).optional(),
      parentContextId: z.string().min(1).max(512).optional(),
      agentId: z.string().min(1).max(256).optional(),
      contextRevision: z.number().int().nonnegative().optional(),
    }),
    z.object({
      ...runtimeSessionEventOriginShape,
      kind: z.literal('session_complete'),
      sessionId: z.string().min(1),
      turnId: z.string().min(1).max(128).optional(),
    }),
    z.object({
      ...runtimeSessionEventOriginShape,
      kind: z.literal('session_error'),
      sessionId: z.string().min(1),
      turnId: z.string().min(1).max(128).optional(),
      /** 用户可读文案 (已经过 wrapSdkError 友好化)。renderer 显示这条。*/
      error: z.string(),
      /** OC-11 wrapSdkError 分类 —— renderer 据此决定 retry / open-settings 按钮。
       *  optional 保持向后兼容：旧 'cancelled' / guardrail 失败等仍可不带 category。*/
      category: z
        .enum([
          'rate_limit',
          'auth',
          'quota',
          'network',
          'model_unavailable',
          'bad_request',
          'server_error',
          'cancelled',
          'unknown',
        ])
        .optional(),
      /** 用户该做的下一步动作；renderer 据此渲染按钮。 */
      action: z
        .enum(['retry', 'open_provider_settings', 'check_network', 'change_model'])
        .optional(),
      retriable: z.boolean().optional(),
      /** OC-23 限流重试**到点 epoch 毫秒**（绝对时间戳，**非** delta）。
       *  Main 端 stamp = Date.now() + Retry-After header 等待毫秒；renderer 用
       *  setInterval 算剩余秒数显示 "Retry in 30s"。
       *  绝对时间戳比 delta 更稳：composeMessages 是 selector，每次 events 变都重跑，
       *  delta 形式会导致每跑一次就把 retryAvailableAt 推后一格 (review HIGH-2)。
       *  上限：Date.now() + 1 小时 ≈ 1768000000000ish；下限：0 也接受 (虽然语义古怪)。
       *  超出上限走 `.catch` clamp 而非 reject —— 不让 1 个异常 header 把整条 error event 丢掉。*/
      retryAvailableAt: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
    }),
    // ---- Context budget diagnostics（KodaX RuntimeContextBudgetSnapshot）----
    // 仅包含 token 数量与类别，不携带 prompt / tool input / tool output 原文。
    z.object({
      kind: z.literal('context_budget_snapshot'),
      sessionId: z.string().min(1),
      contextId: z.string().min(1).max(512).optional(),
      contextKind: z.enum(['root', 'child']).optional(),
      parentContextId: z.string().min(1).max(512).optional(),
      agentId: z.string().min(1).max(256).optional(),
      provider: z.string().min(1).max(64).optional(),
      model: z.string().min(1).max(256).optional(),
      profile: z.enum(['off', 'report_only', 'balanced', 'small_window', 'aggressive']),
      contextWindow: z.number().int().positive().max(10_000_000),
      smallWindow: z.boolean(),
      pressure: z.enum(['low', 'medium', 'high', 'critical']),
      tokenBreakdown: contextBudgetTokenBreakdownSchema,
      usedTokens: z.number().int().nonnegative().max(10_000_000),
      availableTokens: z.number().int().nonnegative().max(10_000_000),
      usedRatio: z.number().finite().nonnegative().max(100),
      toolSchemaRatio: z.number().finite().nonnegative().max(100),
      createdAt: z.string().datetime(),
    }),
    // ---- Provider prompt-cache diagnostics（KodaX 0.7.77）----
    // Hash-only request identity + Provider-reported usage. No prompt/message text crosses IPC.
    z.object({
      kind: z.literal('provider_cache_diagnostic'),
      sessionId: z.string().min(1),
      contextId: z.string().min(1).max(512).optional(),
      contextKind: z.enum(['root', 'child']).optional(),
      parentContextId: z.string().min(1).max(512).optional(),
      agentId: z.string().min(1).max(256).optional(),
      requestId: z.string().min(1).max(128),
      requestedAt: z.string().datetime(),
      completedAt: z.string().datetime(),
      transport: z.enum(['stream', 'complete']).optional(),
      provider: z.string().min(1).max(128),
      model: z.string().min(1).max(256),
      wireModel: z.string().min(1).max(256).optional(),
      reasoningHash: sha256HexSchema.optional(),
      maxOutputTokens: z.number().int().nonnegative().max(10_000_000).optional(),
      kodaxPromptCacheEnabled: z.boolean().optional(),
      endpoint: z.string().max(2_048).optional(),
      endpointPathHash: sha256HexSchema.optional(),
      attempt: z.number().int().positive().max(10_000),
      systemPromptHash: sha256HexSchema,
      toolSchemaHash: sha256HexSchema,
      messagePrefixHash: sha256HexSchema,
      messagePrefixCount: z.number().int().nonnegative().max(10_000_000),
      requestMessagesHash: sha256HexSchema,
      requestEnvelopeHash: sha256HexSchema,
      ephemeralSuffixHash: sha256HexSchema.optional(),
      promptCacheAffinityHash: sha256HexSchema.optional(),
      messageCount: z.number().int().nonnegative().max(10_000_000),
      toolCount: z.number().int().nonnegative().max(100_000),
      inputTokens: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
      outputTokens: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
      cacheReadInputTokens: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
      cacheWriteInputTokens: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
    }),
    // ---- Context compaction（KodaX onCompact* 系列）----
    z.object({
      kind: z.literal('compact_start'),
      sessionId: z.string().min(1),
      contextId: z.string().min(1).max(512).optional(),
      contextKind: z.enum(['root', 'child']).optional(),
      parentContextId: z.string().min(1).max(512).optional(),
      agentId: z.string().min(1).max(256).optional(),
      contextRevision: z.number().int().nonnegative().optional(),
    }),
    z.object({
      kind: z.literal('compact_stats'),
      sessionId: z.string().min(1),
      tokensBefore: z.number().int().nonnegative().max(10_000_000),
      tokensAfter: z.number().int().nonnegative().max(10_000_000),
      contextId: z.string().min(1).max(512).optional(),
      contextKind: z.enum(['root', 'child']).optional(),
      parentContextId: z.string().min(1).max(512).optional(),
      agentId: z.string().min(1).max(256).optional(),
      contextRevision: z.number().int().nonnegative().optional(),
      source: z.enum(['manual', 'automatic_threshold', 'physical_capacity']).optional(),
      committed: z.boolean().optional(),
      elapsedMs: z.number().int().nonnegative().max(86_400_000).optional(),
      strategy: z.enum(['full_prefix', 'map_reduce']).optional(),
      effectiveTriggerTokens: z.number().int().nonnegative().max(10_000_000).optional(),
      protectedBudgetTokens: z.number().int().nonnegative().max(10_000_000).optional(),
      fixedInputTokens: z.number().int().nonnegative().max(10_000_000).optional(),
      eligibleTokens: z.number().int().nonnegative().max(10_000_000).optional(),
      rawTailTokens: z.number().int().nonnegative().max(10_000_000).optional(),
      summaryTokens: z.number().int().nonnegative().max(10_000_000).optional(),
      queryLedgerTokens: z.number().int().nonnegative().max(10_000_000).optional(),
      beforeRevision: z.number().int().nonnegative().optional(),
      afterRevision: z.number().int().nonnegative().optional(),
      reason: z.string().max(2_000).optional(),
    }),
    z.object({
      kind: z.literal('compact_end'),
      sessionId: z.string().min(1),
      contextId: z.string().min(1).max(512).optional(),
      contextKind: z.enum(['root', 'child']).optional(),
      parentContextId: z.string().min(1).max(512).optional(),
      agentId: z.string().min(1).max(256).optional(),
      contextRevision: z.number().int().nonnegative().optional(),
    }),
    // ---- Provider retry / recovery ----
    z.object({
      kind: z.literal('retry_after'),
      sessionId: z.string().min(1),
      payload: retryAfterSchema,
    }),
    z.object({
      kind: z.literal('provider_recovery'),
      sessionId: z.string().min(1),
      stage: z.string().max(64),
      errorClass: z.string().max(64),
      attempt: z.number().int().nonnegative().max(100),
      maxAttempts: z.number().int().positive().max(100),
      delayMs: z.number().int().nonnegative().max(3_600_000),
      recoveryAction: z.string().max(64),
      ladderStep: z.number().int().nonnegative().max(10),
      fallbackUsed: z.boolean(),
    }),
    // ---- Repointel (repo intelligence) trace ----
    z.object({
      kind: z.literal('repointel_trace'),
      sessionId: z.string().min(1),
      event: repointelTraceSchema,
    }),
    // ---- Plan / Todo (Scout-seeded todo list) ----
    z.object({
      kind: z.literal('todo_update'),
      sessionId: z.string().min(1),
      items: z.array(todoItemSchema).max(200),
    }),
    // ---- SDK sidecar / todo hygiene observability ----
    z.object({
      kind: z.literal('sidecar_message'),
      sessionId: z.string().min(1),
      message: sidecarMessageSchema,
    }),
    // ---- v0.1.x: fork/rewind branch_summary / compaction lineage notice (history replay only) ----
    // 见 historyLineageNoticeSchema 注释——main 端从不实时 push 这个 kind；appStore.
    // prependSessionHistory 在回放历史时把 session.history 的 lineage_notice item 转成这个
    // SessionEvent 形态,喂给 composeMessages 走非 user 的 system_notice 展示路径。
    z.object({
      kind: z.literal('lineage_notice'),
      sessionId: z.string().min(1),
      noticeKind: z.enum(['branch_summary', 'compaction']),
      text: z.string().max(MAX_TEXT_CHUNK),
    }),
    // v0.1.x: workflow 结果/摘要提示条。历史回放由 session.history 的 workflow_notice item
    // 转成这个 SessionEvent；live workflow.event 也会注入同一事件流，避免 renderer 侧 wall-clock
    // notice 被排到整段 assistant 回复之后。key/sentAt 仅 live 去重/展示使用。
    z.object({
      kind: z.literal('workflow_notice'),
      sessionId: z.string().min(1),
      text: z.string().max(MAX_TEXT_CHUNK),
      key: z.string().min(1).max(512).optional(),
      sentAt: z.number().int().nonnegative().optional(),
    }),
    z.object({
      kind: z.literal('todo_drift_warning'),
      sessionId: z.string().min(1),
      warning: todoDriftWarningSchema,
    }),
    z.object({
      kind: z.literal('effective_config'),
      sessionId: z.string().min(1),
      config: z.object({
        agentMode: agentModeSchema,
        agentProfile: agentProfileSummarySchema.optional(),
        toolScope: z.array(z.string().min(1).max(128)).max(512),
        verification: verificationSummarySchema.optional(),
        verifier: z
          .object({
            provider: z.string().min(1).max(64).optional(),
            model: z.string().min(1).max(128).optional(),
          })
          .optional(),
      }),
    }),
    // ---- Managed Task / Subagent status (Tasks popout) ----
    z.object({
      kind: z.literal('managed_task_status'),
      sessionId: z.string().min(1),
      status: managedTaskStatusSchema,
    }),
    // ---- FEATURE_029 Auto-mode engine change ----
    //
    // 推送时机：
    //   - user 手动 setAutoModeEngine（reason='manual'）
    //   - guardrail 触发 denial threshold（reason='denial_threshold'）
    //   - guardrail 触发 circuit breaker（reason='circuit_breaker'）
    //   - v0.1.4: bootstrapAutoMode 失败 fallback 到 accept-edits（reason='bootstrap_failed'）
    //     这条之前是 emit 一条 session_error 当通知，但 session_error 是"session 结束"
    //     语义，ActivitySpinner 误判 streaming=false 让 spinner 消失（用户报告"改 mode
    //     后 spinner 动画消失了"同一类 bug）。换走 auto_engine_change 复用现有
    //     NotificationsSurface 弹持久内联通知。
    z.object({
      kind: z.literal('auto_engine_change'),
      sessionId: z.string().min(1),
      engine: autoModeEngineSchema,
      reason: z
        .enum(['manual', 'denial_threshold', 'circuit_breaker', 'bootstrap_failed'])
        .optional(),
      /** bootstrap_failed 时携带的失败原因文案（其他 reason 缺省）。展示在 NotificationsSurface。 */
      details: z.string().max(512).optional(),
    }),
    // ---- FEATURE_008 legacy work_budget / harness_profile ----
    //
    // alpha.0 已经 wire 到 TopBar 上的两个事件。alpha.1 重构后 main 端可以
    // 从 managed_task_status (budgetUsage/globalWorkBudget/harnessProfile) 派生，
    // 但 schema 保留两个独立事件 — renderer 现有代码继续工作，不破坏向后兼容。
    z.object({
      kind: z.literal('work_budget'),
      sessionId: z.string().min(1),
      used: z.number().int().nonnegative().max(1_000_000),
      cap: z.number().int().positive().max(1_000_000),
    }),
    z.object({
      kind: z.literal('harness_profile'),
      sessionId: z.string().min(1),
      profile: z.enum(['H0_DIRECT', 'H1_EXECUTE_EVAL', 'H2_PLAN_EXECUTE_EVAL']),
      round: z.number().int().positive().max(100).optional(),
    }),
  ]),
} as const;

export type SessionMeta = z.infer<typeof sessionMetaSchema>;
export type SessionEvent = z.infer<typeof sessionEventChannel.payload>;
export type SessionEventKind = SessionEvent['kind'];
