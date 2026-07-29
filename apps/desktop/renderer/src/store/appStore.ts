// Zustand 全局 store — F005 起。
//
// 设计：
//   - 三块状态：projects（recent list）/ sessions（当前项目下）/ events（按 sessionId 路由）
//   - actions 只做"应用 main 端响应"，**不**直接修改持久数据；persistence 在 main 侧
//   - 事件路由：renderer 全局订阅 `session.event` 一次，按 payload.sessionId 进
//     `eventsBySession.get(sessionId)`；切换 currentSession 不重订阅，只切视图
//
// 不放进 store 的：
//   - 临时表单状态（promptDraft 等）—— 留在组件 local state
//   - 异步进行中标志（busy）—— 同上

import { create } from 'zustand';
import type {
  Project,
  ProviderInfo,
  SessionMeta,
  SessionEvent,
  PermissionRequestPayload,
  AskUserRequestPayload,
  KodaxUserDefaults,
  QueuedMessageT,
  WorkflowRunT,
  WorkflowEventPayload,
  WorkflowActivityPayload,
  SpaceRuntimeDefaultsT,
  LicenseStatusT,
  SpaceCoderConnectionProjectionT,
  SpaceRuntimeProfileProjectionT,
  SpaceRuntimeCursorT,
  SpaceSessionLiveChangedT,
  SpaceSessionLiveProjectionT,
  AgentActorTreeSnapshotT,
} from '@kodax-space/space-ipc-schema';
import { canonProjectRoot as canonProjectRootShared } from '@kodax-space/space-ipc-schema';
import {
  type VisualQuality,
  VISUAL_QUALITY_KEY,
  readVisualQuality,
  applyVisualQualityToDocument,
} from '../lib/visualQuality.js';
import { replaceSessionsInScope, type SessionScope } from '../lib/sessionScope.js';
import {
  clearLastOpenedFileViewerSnapshotForSession,
  collectTransientArtifactsFromEvents,
  snapshotFromCreateArtifactTool,
  upsertTransientArtifact,
  type TransientArtifactSnapshot,
} from '../features/artifact/transientArtifact.js';
import { applyLiveBudgetFallback } from '../lib/liveTaskProgress.js';
import { mergeManagedTaskStatus } from '../lib/managedTaskStatusMerge.js';
import {
  applySessionLiveChange,
  createRuntimeProjectionState,
  replaceRuntimeConnection,
  replaceRuntimeProfile,
  replaceSessionLiveProjection as replaceSessionLiveProjectionState,
  type ApplySessionLiveChangeStatus,
} from './runtimeProjectionState.js';
import {
  hydrateSessionEventsFromLiveSnapshot,
  projectionTextSuffix,
} from './runtimeSnapshotHydration.js';
import { mergeRuntimeSettingsIntoSessions } from './runtimeSessionSettings.js';

export type MascotMode = 'legacy' | 'sprite' | 'off';

export interface SessionCompactionOutcome {
  readonly committed: boolean;
  readonly tokensBefore: number;
  readonly tokensAfter: number;
  readonly source?: 'manual' | 'automatic_threshold' | 'physical_capacity';
  readonly elapsedMs?: number;
  readonly strategy?: 'full_prefix' | 'map_reduce';
  readonly effectiveTriggerTokens?: number;
  readonly reason?: string;
}

export interface SessionTokenInfo {
  readonly tokens: number;
  readonly source: 'iteration_end' | 'compact_stats' | 'estimate';
  readonly tokenSource?: 'api' | 'estimate';
  /** Renderer-local ordering for root context identity handoffs. */
  readonly observedOrder?: number;
  readonly compactedFrom?: number;
  readonly contextId?: string;
  readonly contextRevision?: number;
  readonly lastCompaction?: SessionCompactionOutcome;
}

export interface SessionTokenUsageInfo {
  /** Provider-reported total input tokens. Cache reads and cache creation are subsets when known. */
  readonly inputTokens: number;
  readonly outputTokens: number;
  /** Undefined means that no provider in this session has reported this dimension yet. */
  readonly cacheReadInputTokens?: number;
  readonly cacheWriteInputTokens?: number;
  /** All Provider calls attributed to this session, including child Agents. */
  readonly sampleCount: number;
  /** Calls explicitly attributed to a child Agent by the SDK. */
  readonly childSampleCount: number;
  /**
   * KodaX 0.7.77 provider diagnostics cover every physical request. Older Runtime builds and
   * mock sessions fall back to iteration summaries until the first diagnostic is observed.
   */
  readonly accountingSource?: 'iteration' | 'provider_diagnostic';
  /** Bounded completed request ids retained across renderer reloads for replay deduplication. */
  readonly recentRequestIds?: readonly string[];
}

export type SessionContextBudgetSnapshot = Extract<
  SessionEvent,
  { kind: 'context_budget_snapshot' }
> & {
  /** Renderer-local ordering for root context identity handoffs. */
  readonly observedOrder?: number;
};

export type SessionProviderCacheDiagnostic = Extract<
  SessionEvent,
  { kind: 'provider_cache_diagnostic' }
>;

/**
 * Persistent inline notification (NotificationsSurface 渲染源)。
 *   - id: dedupe key (eg `ctx-warn:${sessionId}` / `auto-fallback:${sessionId}:${reason}`)
 *   - severity: 视觉色调 + icon
 *   - text: 用户可读单行 (UI 1-2 行可折行)
 *   - sessionId?: 仅适用于特定 session 的通知;切走 session 后不显示但保留在 store 里
 *     (回切回来时再显示);全局通知 sessionId 留空
 *   - createdAt: 排序用 (新的在前)
 */
export interface Notification {
  readonly id: string;
  readonly severity: 'info' | 'warning' | 'error';
  readonly text: string;
  readonly sessionId?: string;
  readonly createdAt: number;
  readonly dismissOnOutsideInteraction?: boolean;
}

/**
 * Recents 列表过滤 / 分组 / 排序 状态 — 对齐 Claude Desktop 截图 3。
 * alpha.1 阶段全部存 renderer 本地（不持久化重启清空）；后续需要的话再持久化到 main。
 */
export interface RecentsFilter {
  status: 'active' | 'archived' | 'all';
  /** 'current' 只显示 currentProjectPath 的；'all' 跨项目（v0.1.x main 端要按 project 拆开发） */
  projectScope: 'current' | 'all';
  lastActivity: 'today' | '7d' | '30d' | 'all';
  groupBy: 'none' | 'project' | 'status';
  sortBy: 'recency' | 'alphabetical' | 'created';
}

type SessionFlagName = 'pinned' | 'archived' | 'unread';
type SessionFlagsById = Readonly<
  Record<string, { pinned?: boolean; archived?: boolean; unread?: boolean } | undefined>
>;

const DEFAULT_RECENTS_FILTER: RecentsFilter = {
  status: 'active',
  projectScope: 'current',
  lastActivity: 'all',
  groupBy: 'none',
  sortBy: 'recency',
};

/**
 * 用户在 renderer 端发出的 prompt 记录。
 * Main 端不会把用户 prompt 通过 push channel 回放——它是 invoke 的入参，单向。
 * Renderer 自己保留一份，与 session.event push 流共同构成完整对话。
 */
export type UserImageAttachment =
  | {
      readonly id: string;
      readonly kind: 'image';
      readonly mediaType: 'image/png' | 'image/jpeg' | 'image/webp';
      readonly label?: string;
      readonly bytes?: number;
      readonly status: 'available';
      /**
       * History uses short-lived app:// capabilities; the optimistic live row uses the
       * already-normalized data URL until session.send replaces it with the capability.
       */
      readonly thumbnailUrl: string;
      readonly previewUrl: string;
    }
  | {
      readonly id: string;
      readonly kind: 'image';
      readonly mediaType?: 'image/png' | 'image/jpeg' | 'image/webp';
      readonly label?: string;
      readonly bytes?: number;
      readonly status: 'missing' | 'unsupported';
    };

export interface UserMessage {
  /** 唯一 id：sessionId + 单调 counter 拼接，保 React key 稳定。*/
  readonly id: string;
  readonly content: string;
  readonly sentAt: number;
  readonly attachments?: readonly UserImageAttachment[];
  /** Stable canonical boundary identity supplied by KodaX Runtime/history. */
  readonly turnId?: string;
  readonly turnUserOrdinal?: number;
  /** Internal idempotency identity for a Runtime-delivered queued prompt. */
  readonly deliveryQueueId?: string;
  readonly deliveryQueueMode?: QueuedUserMessage['queueMode'];
  /** Stable renderer-local identity retained when a queued bubble is promoted before its ACK. */
  readonly sourceQueuedLocalId?: string;
  readonly historyNoAssistantSegment?: boolean;
  /** Internal provenance used only to reconcile the session.history/live-stream boundary. */
  readonly restoredFromHistory?: true;
  /**
   * A complete durable projection is already visible for this canonical boundary, but the live
   * projection still needs a segment owner until its terminal arrives. Consume its events without
   * rendering a second user/assistant copy; terminal reconciliation removes this placeholder.
   */
  readonly hiddenProjectionDuplicate?: true;
  /**
   * Internal alignment anchor for assistant/tool-leading history and history/live segment gaps.
   * It keeps positional event owners aligned without presenting a fabricated empty user bubble.
   */
  readonly hiddenHistoryAnchor?: boolean;
}

export interface LocalNoticeMessage {
  readonly id: string;
  readonly content: string;
  readonly sentAt: number;
  readonly variant?: 'echo' | 'output';
}

export interface WorkflowNoticeMessage {
  readonly id: string;
  readonly content: string;
  readonly sentAt: number;
  /**
   * Stable dedup key (see workflowNotices.ts). Stored ON the notice so dedup state
   * lives in the persisted store alongside the notices it guards — it cannot desync
   * from them on hot-reload / remount / workflow re-seed the way a module-level Set
   * did (that desync re-appended every summary as a duplicate; user report).
   */
  readonly key?: string;
}

export interface QueuedUserMessage {
  readonly id: string;
  readonly queueId?: string;
  readonly content: string;
  readonly matchContent: string;
  readonly attachments?: readonly UserImageAttachment[];
  readonly queueMode: 'interrupt' | 'after-turn';
  readonly status: 'pending-ack' | 'queued' | 'failed';
  readonly failureReason?: Extract<SessionEvent, { kind: 'queued_user_prompt_failed' }>['reason'];
  readonly sentAt: number;
}

interface RuntimeSnapshotEventBarrier extends SpaceRuntimeCursorT {
  readonly runId: string;
  /**
   * Terminal Runtime projections intentionally clear run-scoped drafts. A cursor only covers a
   * queued delta up to the latest accepted snapshot that actually carried that cumulative draft.
   */
  readonly assistantDraftSeq?: number;
  readonly thinkingDraftSeq?: number;
}

interface AppState {
  // ----- 数据 -----
  projects: readonly Project[];
  /** License entitlement snapshot (boot-fetched + refreshed after import). null =
   *  not yet loaded. Gated capabilities (e.g. Repointel) read this via isLicenseActive. */
  licenseStatus: LicenseStatusT | null;
  currentProjectPath: string | null;
  /** F040: 每个项目在 LeftSidebar.ProjectTree 中的展开状态。
   *  localStorage 持久化（key 'kodax-space.expandedProjects'）。
   *  键 = project path；值 = true=用户希望展开 / false=用户希望折叠。
   *  缺省（map 里没有该键）= 走默认（当前项目展开、其它折叠）。
   *  存在显式值时**覆盖**默认 — 避免用户点 chevron 视觉无反应（review LOW-6）。*/
  expandedProjects: Readonly<Record<string, boolean>>;
  sessions: readonly SessionMeta[];
  currentSessionId: string | null;
  /** 每个 sessionId 一桶事件；append-only。Map 用 plain object 避免 zustand referential 问题。*/
  eventsBySession: Readonly<Record<string, readonly SessionEvent[]>>;
  /**
   * 每个 sessionId「已查看到的事件条数」——用户切进该 session 时记下当时的事件长度。
   * useSessionStatus 据此判定 error 状态点是否已被用户看过：若最新 session_error 的索引
   * < 已查看长度，则视为已确认、不再亮红点（避免"看完红点还在"的困惑）。新一轮 error
   * （索引 >= 已查看长度）仍会重新亮起。
   */
  errorSeenAtBySession: Readonly<Record<string, number>>;
  /**
   * #9 fix: 用户手动关掉 todo-drift 提示（NotificationsSurface × 按钮）时记下的"轮次基线"
   * ——userMessagesBySession[sid].length。SDK 在同一轮对话里常常因为同一个"todo 没标
   * in-progress"状态反复推 todo_drift_warning（每次工具调用都可能触发一次）；旧逻辑
   * dismiss 只是把通知从数组里删掉，下一条同 id 事件一来又被当"新通知"塞回去，等于用户
   * 点了关闭却立刻弹回来。有了这个基线，同一轮内的重复 drift 事件会被压下；开始新的
   * 用户轮次（turn index 前进）后自动重新武装。
   */
  todoDriftDismissedAtBySession: Readonly<Record<string, number>>;
  /**
   * #9 fix 配套字段：dismiss 那一刻的 pending todo 数量，用于识别"同一轮但明显恶化"——
   * 即便还在同一轮里，如果 pendingCount 比 dismiss 时更高，也重新弹出（不哑掉真正升级的
   * 警告）。取自 todoListBySession（跟 SDK 计算 pendingCount 用的是同一份 todo 状态）。
   */
  todoDriftDismissedPendingCountBySession: Readonly<Record<string, number>>;
  lastEvent?: SessionEvent;
  /** 每个 sessionId 一桶用户消息（renderer 本地跟踪）。*/
  userMessagesBySession: Readonly<Record<string, readonly UserMessage[]>>;
  queuedUserMessagesBySession: Readonly<Record<string, readonly QueuedUserMessage[]>>;
  /** Renderer-local slash/info/status notices. These are not user turns and should not affect history/fork indices. */
  localNoticesBySession: Readonly<Record<string, readonly LocalNoticeMessage[]>>;
  /** Renderer-local workflow notices. These are not user turns and should not affect history/fork indices. */
  workflowNoticesBySession: Readonly<Record<string, readonly WorkflowNoticeMessage[]>>;
  /**
   * 待用户决策的 permission 请求队列（FIFO）。
   * 一次只显示一个弹窗——多 session 并发时按到达顺序处理，已决策的弹下一个。
   * 不按 sessionId 桶分——弹窗永远是 modal 全屏，按全局队列处理更简单也防止用户同时
   * 看到多个弹窗时手抖点错。
   */
  permissionQueue: readonly PermissionRequestPayload[];

  /**
   * FEATURE_032: 待用户决策的 askUser 请求队列。与 permissionQueue 并行——前者是
   * "tool 调用 gate"，后者是 "agent / guardrail 主动问问题"，UI 不同 modal、不互相阻塞。
   */
  askUserQueue: readonly AskUserRequestPayload[];

  /** Provider catalog（built-in + custom）+ configured 状态。FEATURE_004。*/
  providers: readonly ProviderInfo[];
  defaultProviderId: string | null;
  /**
   * v0.1.6 cleanup：~/.kodax/config.json 的默认值（main 启动期一次性拉过来）。
   * Space defaultProviderId === null 时这里 fallback；用户改 Space 设置 / 切 picker 后用 Space 值。
   * null = 还没拉到或 SDK loadConfig 失败；undefined 字段 = config 没设那项。
   */
  kodaxDefaults: KodaxUserDefaults | null;
  runtimeDefaults: SpaceRuntimeDefaultsT;
  /** F121 daemon-derived Coder connection/profile/live truth. Not populated until main publishes it. */
  runtimeConnection: SpaceCoderConnectionProjectionT;
  runtimeProfile: SpaceRuntimeProfileProjectionT | null;
  liveProjectionBySession: Readonly<Record<string, SpaceSessionLiveProjectionT | undefined>>;
  runtimeSnapshotRequiredBySession: Readonly<Record<string, true | undefined>>;
  /** Latest accepted cumulative live-snapshot cursor; covered Runtime deltas must not replay. */
  runtimeSnapshotCursorBySession: Readonly<Record<string, RuntimeSnapshotEventBarrier | undefined>>;
  /**
   * Keychain backend 状态。'memory' 表示 key 仅在本进程内有效；
   * UI 应显著告警，否则用户以为配了 key 但重启就丢（review M1-sec）。
   */
  keychainBackend: 'keychain' | 'memory' | 'unknown';

  /**
   * F008: 每个 session 的当前 Work 预算（used / cap）。
   * 由 session-event 'work_budget' 增量更新，覆盖最新值（main 端是权威源）。
   * alpha.1：也从 managed_task_status.globalWorkBudget/budgetUsage 派生。
   */
  workBudgetBySession: Readonly<Record<string, { used: number; cap: number } | undefined>>;
  /**
   * Derived: 每个 session 的"权威"token 计数。只在 terminal event 时更新：
   *   - iteration_end → tokens = ev.tokenCount, source = 'iteration_end'
   *   - session_complete (history restore terminal) → 从 buffer 估算累计 tokens, source = 'estimate'
   *
   * WelcomeDashboard 订阅这张表而不是 raw eventsBySession——后者每个 text_delta 都
   * 改 reference 触发 dashboard 全量 re-render；前者只在 turn 结束时变 (~1/min)，几乎
   * 不触发 dashboard 重计算。
   *
   * 未出现在表里的 session：从未点开 (eventsBuffer 空) → 走 dashboard 那边 msgCount × 1500 估算路径。
   */
  tokensBySession: Readonly<Record<string, SessionTokenInfo | undefined>>;
  /**
   * Provider-reported cumulative usage for the whole session. KodaX 0.7.77 uses deduplicated
   * completed physical-request diagnostics; legacy/mock paths use iteration summaries.
   */
  sessionTokenUsageBySession: Readonly<Record<string, SessionTokenUsageInfo | undefined>>;
  /** Latest privacy-safe SDK context composition snapshot for each root session. */
  contextBudgetBySession: Readonly<Record<string, SessionContextBudgetSnapshot | undefined>>;
  /** Latest completed physical Provider request, containing hashes and Provider-reported usage only. */
  providerCacheDiagnosticBySession: Readonly<
    Record<string, SessionProviderCacheDiagnostic | undefined>
  >;
  /**
   * Derived: transient (transcript-only) artifacts per session, minted from
   * completed `create_artifact` tool calls. Updated incrementally on tool_result
   * — the always-mounted RightSidebar/ArtifactsView subscribe to this table
   * instead of raw eventsBySession, so they don't re-scan the full event log on
   * every streamed text_delta (mirrors tokensBySession's rationale).
   */
  transientArtifactsBySession: Readonly<Record<string, readonly TransientArtifactSnapshot[]>>;
  /** F008: 每个 session 的当前 harness profile（H0/H1/H2）+ round。
   *  alpha.1：也从 managed_task_status.harnessProfile/currentRound 派生（profile 名映射）。
   */
  harnessProfileBySession: Readonly<
    Record<
      string,
      | { profile: 'H0_DIRECT' | 'H1_EXECUTE_EVAL' | 'H2_PLAN_EXECUTE_EVAL'; round?: number }
      | undefined
    >
  >;
  /**
   * alpha.1: Scout-seeded todo list per session.
   * 由 session-event 'todo_update' 全量替换最新列表。空列表也是有效状态（表示 todo cleared）。
   */
  todoListBySession: Readonly<
    Record<
      string,
      | ReadonlyArray<{
          id: string;
          content: string;
          // 与 IPC todoItemSchema / SDK TodoStatus 全量对齐（含 failed/skipped/cancelled 终态）。
          status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'skipped' | 'cancelled';
          activeForm?: string;
        }>
      | undefined
    >
  >;
  /**
   * alpha.1: KodaX managed task / subagent 最新状态。
   * 由 session-event 'managed_task_status' 全量替换最新值（main 端在每次 status 变化时推一次）。
   * 字段对照 KodaXManagedTaskStatusEvent — agentMode / harnessProfile / activeWorker / budget /
   * idleWaiting / childFanoutCount / events[] 等。
   */
  managedTaskStatusBySession: Readonly<
    Record<string, Extract<SessionEvent, { kind: 'managed_task_status' }>['status'] | undefined>
  >;
  /**
   * Canonical KodaX Actor/Turn tree. Unlike managedTaskStatusBySession this
   * contains native, recursive, Workflow-owned, constructed, and external
   * Actor lifecycle state and survives root-run terminal events.
   */
  agentActorSnapshotBySession: Readonly<Record<string, AgentActorTreeSnapshotT | undefined>>;
  /**
   * Workflow Harness（F060）：已知 / 进行中的工作流 run，按 runId 扁平存（带 host 归属的 snapshot）。
   * push `workflow.event` 覆盖式 upsert（每事件带全量 snapshot，无需折叠）；切 session 时 workflow.list 播种。
   * 扁平按 runId（非按 session 嵌套）——归属在 run.sessionId 上，外部发起（REPL/CLI）的 run 也能存；
   * 视图（F061）按 currentSession 过滤。
   */
  workflowRuns: Readonly<Record<string, WorkflowRunT>>;
  /** F060：消费 push workflow.event，按 runId 覆盖式 upsert。*/
  upsertWorkflowRun: (payload: WorkflowEventPayload) => void;
  /** F060：workflow.list 播种已知 run（覆盖式合并进 workflowRuns）。*/
  seedWorkflowRuns: (runs: readonly WorkflowRunT[]) => void;
  /**
   * F062：workflow.delete 成功后从渲染层移除 run（连带其活动流）。
   * 必须显式移除——seed 是"只增不删"的覆盖合并，且删除无 push 事件，
   * 否则已删的 run 会一直留在侧栏/面板里直到重启。
   */
  removeWorkflowRun: (runId: string) => void;
  /**
   * F065：子 agent 活动遥测，按 runId 存有界活动流（每 run 最近 N 条 discrete 事件）。
   * 来自 push workflow.activity；右侧栏按 runId 显示，App 顶层另把关键活动写入中间历史流。
   */
  workflowActivityByRun: Readonly<Record<string, readonly WorkflowActivityPayload[]>>;
  /** F065：追加一条子 agent 活动（按 runId 有界）。*/
  appendWorkflowActivity: (activity: WorkflowActivityPayload) => void;
  /**
   * 当前无 session 时由 ModelEffortSelector 写入的"下一次新 session 用这些"。
   * 用户点 picker 选 glm/zai-glm-coding/effort 等 → 存这里 → 下次 BottomBar 自动建 session
   * 或 LeftSidebar 显式 + New session 时优先用这俩值。
   * null/undefined 表示"沿用 Space defaultProviderId / kodaxDefaults"。
   */
  pendingProviderId: string | null;
  pendingReasoningMode: SessionMeta['reasoningMode'] | null;
  pendingPermissionMode: SessionMeta['permissionMode'] | null;
  pendingAutoModeEngine: SessionMeta['autoModeEngine'] | null;
  /** Pending agent mode (AMA / SA)。默认 'ama'；下次 session.create 时随入参传给 main。*/
  pendingAgentMode: SessionMeta['agentMode'] | null;
  /** Pending model — 用户在右下角 picker 选的 model 名 (provider.models 之一)。
   *  无 session 时存这里；session 创建后通过 /model slash 命令应用到 KodaX 运行时。
   *  持久化到 localStorage，让用户偏好跨重启保留 (SDK 暂无 SessionMeta.model 字段，
   *  暂在 Space 这层托管)。 */
  pendingModel: string | null;
  /**
   * Session UX flags — alpha.1 阶段不持久化（重启清空）。
   *   - pinned：sidebar Recents 顶部置顶
   *   - archived：sidebar 默认隐藏（用 sort/filter 弹窗 → Archived 才显示）
   *   - unread：sidebar 标题旁加 ● 圆点（用户标记，非自动）
   * v0.1.x SDK 出持久化字段后迁移到 SessionMeta。
   */
  sessionFlags: SessionFlagsById;
  /** UI 主题。dark = 当前默认；light = zinc-100 系；'system' = 跟 OS prefers-color-scheme。
   *  持久化到 localStorage 让重启后保持。*/
  theme: 'dark' | 'light' | 'system';
  /** F060 视觉质量档（Liquid Glass 总开关）。持久化到 localStorage。
   *  minimal=实色无模糊 / balanced=玻璃+光标高光（默认）/ full=半透明中央区+更厚玻璃。 */
  visualQuality: VisualQuality;
  /** Recents 列表过滤+分组+排序选项 — alpha.1 不持久化。*/
  recentsFilter: RecentsFilter;
  /**
   * Transcript view — Claude Desktop 截图 7 同款。
   *   - normal: 默认 (assistant 消息 + tool calls)
   *   - thinking: 展开 thinking_chunk blocks
   *   - verbose: 显示所有事件 (含 system_notice / iteration_*）
   *   - summary: 每 turn 折叠成单行 (高密度浏览)
   * fontSize: 'sm' | 'base' | 'lg' — 对应 Aa Aa Aa 三档
   */
  transcriptView: 'normal' | 'thinking' | 'verbose' | 'summary';
  transcriptFontSize: 'sm' | 'base' | 'lg';
  /** P2: 右侧栏开/关。Cowork / Claude Desktop 风的"Progress / Working folder / Context"列。
   *  持久化到 localStorage，让用户偏好跨重启保留。*/
  rightSidebarOpen: boolean;
  /** 左侧栏开/关。与 rightSidebarOpen 对称，独立持久化 — 用户可单独收起任一侧。*/
  leftSidebarOpen: boolean;
  /** 2026-06: 左/右侧栏宽度（px）。用户拖动 ResizeHandle 时写入，独立持久化。
   *  默认值对齐 Codex 桌面端视觉(左 260 / 右 320)。
   *  Min/Max 在 Shell 里 clamp(180-480)，store 这层只存最新值。 */
  leftSidebarWidth: number;
  rightSidebarWidth: number;
  /**
   * v0.1.9 fix — Shell.tsx activePopout state 的 mirror (string | null)。
   * RightSidebar Section 的 ⤢ 按钮读它,当前 kind 跟 active 一致就显 "Close popout" 否则
   * "Open in full panel" — 实现 toggle 行为。不持久化(临时 UI state)。
   */
  activePopoutKind: string | null;
  /**
   * KX-I-02 Smart Popout Director — 是否启用"根据 session event 自动聚焦右侧任务栏/变更区"。
   * 默认关;用户在 Preferences 里可开。持久化 localStorage。
   */
  smartPopoutEnabled: boolean;
  /** Composer mascot mode. Default is the original mascot; persisted for quick switching. */
  mascotMode: MascotMode;
  /** Backward-compatible boolean view of mascotMode. */
  mascotEnabled: boolean;
  nativeCompletionNotificationsEnabled: boolean;
  /**
   * v0.1.9 Step 7 — 用户手动拖动排过的项目顺序 (canonProjectRoot 形态)。
   *   - 空数组 = 没拖过,LeftSidebar 走原"lastUsedAt + current 排首"逻辑
   *   - 非空 = 按本数组顺序排在前,不在本数组里的项目按 lastUsedAt 排到尾
   * 持久化到 localStorage `kodax-space.projectOrder` (JSON 数组)。
   */
  projectOrder: readonly string[];
  /** v0.1.9 Step 7 — sidebar "Archived (N)" 折叠组的展开状态。默认折叠,localStorage 持久化。*/
  archivedProjectsExpanded: boolean;
  /**
   * 该 session 已经被 director auto-promote 过的 popout kind 集合,**或**用户主动开/关
   * 过的 kind (两条路径都 mark promoted,避免再被自动抢)。
   * Map<sessionId, Set<SmartPopoutKind>>;不持久化(重启清),会话级临时记忆。
   */
  promotedPopoutsBySession: Readonly<Record<string, ReadonlySet<string>>>;
  /**
   * F009: 最后一次被 tool_call (write/edit) 触及的相对路径——FilePanel 监听这个值切到 diff 视图。
   * 用 "可读完一次就置 null" 的单值 + clearLastDiffPath 模式，避免 useEffect 反复触发。
   */
  lastDiffPath: string | null;
  /**
   * F009 内部：tool_start 的 path 暂存，等 tool_result 落地时取出 → 写 lastDiffPath。
   * Renderer 永不直接读这个字段；不导出 selector。
   */
  pendingToolPaths: Readonly<Record<string, string>>;
  /**
   * P0: 已 invoke session.send 但还没收到第一个事件的 session 集合。spinner / Send-button
   * 据此提前显示 "Sending…"，消除 user 按 Enter 到第一个事件到达之间几秒的"卡死感"。
   * appendEvent 收到任意该 session 的事件时清掉；handleSend 错误路径也手动清。
   */
  pendingSendBySession: Readonly<Record<string, true | undefined>>;
  /**
   * P0: 每个 session 用户已发送的 prompt 历史。↑/↓ 在 BottomBar 翻阅。
   * v0.1.x 不持久化（重启清空）；上限 200 条做 DoS guard。
   */
  inputHistoryBySession: Readonly<Record<string, readonly string[]>>;
  /**
   * Queue snapshot shown in the renderer. Space follow-up prompts live in the
   * SDK process-global queue and are protected by Electron-side session owner
   * guards. Main pushes updates via 'kodax.queueChanged'.
   */
  queueSnapshot: readonly QueuedMessageT[];
  queueTotalSize: number;
  /**
   * Persistent inline notifications (REPL NotificationsSurface 等价)。区别于 ToastContainer
   * 的"几秒自动消失"语义 — 这些 notice 一直挂着直到用户主动 dismiss 或来源条件消失。
   * 典型用例: context 已达 80% 提示压缩、auto engine 因 denial threshold 降到 rules、
   * provider 反复 retry 的告警等。 id 用来 dedupe (同一来源不重弹)。
   */
  notifications: readonly Notification[];
  /**
   * Slash-action 等场景下请求 Shell 打开特定 popout (eg /memory → agents 面板)。
   * 类型字符串与 Shell.PopoutKind 对齐;Shell 用 useEffect 监听这里,见到非空就 setActivePopout
   * 同时清空回 null,形成"事件式" UI 指令。null = 没人请求,Shell 不动 currentPopout。
   */
  requestedPopout: string | null;

  // ----- actions -----
  setProjects(projects: readonly Project[]): void;
  setLicenseStatus(status: LicenseStatusT | null): void;
  /**
   * F040: 切某项目展开状态 — 同步写 localStorage 持久化。
   * `currentDefault` 是当前计算出的"如无显式覆盖时应该展开吗"（current project=true、others=false），
   * caller (ProjectTree) 传进来让 reducer 知道下一次"显式选择"应当指向相反方向。
   */
  toggleProjectExpanded(projectPath: string, currentDefault: boolean): void;
  setCurrentProject(path: string | null): void;
  setSessions(sessions: readonly SessionMeta[]): void;
  replaceSessionsForScope(sessions: readonly SessionMeta[], scope: SessionScope): void;
  setCurrentSession(sessionId: string | null): void;
  appendEvent(event: SessionEvent): void;
  /** main 推 'kodax.queueChanged' 时 / renderer 主动 kodax.queueGet 后调用,覆盖 snapshot。*/
  setQueueState(snapshot: readonly QueuedMessageT[], totalSize: number): void;
  /** BottomBar slash action 调,Shell 用 useEffect 消费 (置回 null + 打开 popout)。 */
  requestPopout(kind: string | null): void;
  /** 推入一条持久通知;id 重复时静默 dedupe (避免每个 event 都重弹同一条)。 */
  pushNotification(notice: Notification): void;
  /** 用户点 × 关掉一条;主动消化后不应再因同样事件重新弹出 (id 持续 dedupe)。 */
  dismissNotification(id: string): void;
  /**
   * History 恢复专用：把一段历史会话**原子前置**到 userMessages + events buckets 前面。
   *
   * 解决 race condition：session.history IPC 是异步的 (~50-200ms 读 jsonl)；如果用户在
   * await 期间就开始新对话 (appendUserMessage / appendEvent 已写入)，原本的逐条 append
   * 会把"历史用户消息"追加到"新消息"后面，导致 composeMessages 按 index 配对时全错位。
   *
   * 这里在 set(state => ...) 内部 prepend——任何并发的 appendEvent/appendUserMessage 都
   * 串行在 zustand 写锁后，前置插入与后续 append 不会撕裂（单 set 调用 atomic）。
   *
   * items 形态同 session.history IPC 出参；fallbackSentAt 给没有 sentAt 的历史 item 用。
   */
  prependSessionHistory(
    sessionId: string,
    items: readonly import('@kodax-space/space-ipc-schema').SessionHistoryItem[],
    fallbackSentAt: number,
  ): void;
  /** sentAt 可选——缺省 Date.now()；history restore 时传 session.createdAt 让旧消息显示真实时间。 */
  appendUserMessage(
    sessionId: string,
    content: string,
    sentAt?: number,
    attachments?: readonly UserImageAttachment[],
  ): string | null;
  updateUserMessageAttachments(
    sessionId: string,
    messageId: string,
    attachments: readonly UserImageAttachment[],
  ): void;
  /** 追加一条**本地提示条**(slash echo / 本地命令输出):参与时间排序,但不消费 SDK 事件段。
   *  用于所有不触发 SDK 回合的 slash 输出(见 localNoticesBySession + composeMessages)。 */
  appendLocalNotice(
    sessionId: string,
    content: string,
    options?: number | { readonly sentAt?: number; readonly variant?: 'echo' | 'output' },
  ): void;
  appendQueuedUserMessage(
    sessionId: string,
    input: {
      readonly content: string;
      readonly matchContent?: string;
      readonly queueMode: 'interrupt' | 'after-turn';
      readonly sentAt?: number;
      readonly attachments?: readonly UserImageAttachment[];
    },
  ): string | null;
  updateQueuedUserMessageAttachments(
    sessionId: string,
    localId: string,
    attachments: readonly UserImageAttachment[],
  ): void;
  markQueuedUserMessageAccepted(
    sessionId: string,
    localId: string,
    queueId?: string,
    queueMode?: 'interrupt' | 'after-turn',
  ): void;
  removeQueuedUserMessage(sessionId: string, localId: string): void;
  promoteQueuedUserMessage(sessionId: string, localId: string, sentAt?: number): void;
  convertLastUserMessageToQueued(
    sessionId: string,
    userContent: string,
    input: {
      readonly content: string;
      readonly matchContent?: string;
      readonly queueMode: 'interrupt' | 'after-turn';
      readonly sentAt?: number;
    },
  ): string | null;
  appendWorkflowNotice(sessionId: string, content: string, sentAt?: number, key?: string): void;
  /**
   * v0.1.4 B3: BottomBar optimistic appendUserMessage 后若 IPC session.send 失败
   * （session disposed / 主进程错 / 等非 queue 路径），调本 action 把刚 push 的
   * "幽灵 user message" 回滚掉。否则用户会看到一条自己说过但什么响应都没有的孤零零气泡。
   * 仅删除"最新一条"，且 content 必须匹配（防御并发场景下误删别人）。
   */
  rollbackLastUserMessage(sessionId: string, content: string): void;
  upsertSession(meta: SessionMeta): void;
  removeSession(sessionId: string): void;
  enqueuePermission(req: PermissionRequestPayload): void;
  /** 用户决策完 / main 端 cancel 推过来 / session 删除 — 都从队列里挪走。*/
  dequeuePermission(reqId: string): void;
  /** FEATURE_032: askUser 队列管理 (与 permissionQueue 同模式)。*/
  enqueueAskUser(req: AskUserRequestPayload): void;
  dequeueAskUser(reqId: string): void;
  setProviders(
    providers: readonly ProviderInfo[],
    defaultProviderId: string | null,
    keychainBackend: 'keychain' | 'memory' | 'unknown',
  ): void;
  /** Keep the renderer's provider catalog aligned after provider.setDefault succeeds. */
  setDefaultProviderId(id: string | null): void;
  /** v0.1.6 cleanup: 启动期 main 推 kodax.getDefaults 结果进来。 */
  setKodaxDefaults(defaults: KodaxUserDefaults): void;
  setRuntimeDefaults(defaults: SpaceRuntimeDefaultsT): void;
  setCoderRuntimeConnection(connection: SpaceCoderConnectionProjectionT): void;
  replaceAgentActorSnapshot(snapshot: AgentActorTreeSnapshotT): void;
  replaceRuntimeProfileProjection(profile: SpaceRuntimeProfileProjectionT): void;
  replaceSessionLiveProjection(projection: SpaceSessionLiveProjectionT): void;
  applySessionLiveProjectionChange(change: SpaceSessionLiveChangedT): ApplySessionLiveChangeStatus;
  /** 用户在无 session 时点 picker → 暂存到 pending；下次 session.create 优先用。*/
  setPendingProviderId(id: string | null): void;
  setPendingReasoningMode(mode: SessionMeta['reasoningMode'] | null): void;
  setPendingPermissionMode(mode: SessionMeta['permissionMode'] | null): void;
  setPendingAutoModeEngine(engine: SessionMeta['autoModeEngine'] | null): void;
  setPendingAgentMode(mode: SessionMeta['agentMode'] | null): void;
  setPendingModel(model: string | null): void;
  /** Session UX flags — 局部状态 (alpha.1 不持久化)。toggle 形 + 合并形 set 函数。*/
  toggleSessionFlag(sessionId: string, flag: SessionFlagName): void;
  setSessionFlag(sessionId: string, flag: SessionFlagName, value: boolean): void;
  setRecentsFilter(filter: RecentsFilter): void;
  setTheme(theme: 'dark' | 'light' | 'system'): void;
  /** F060：切视觉质量档。立即应用 <html> class + 写 localStorage。*/
  setVisualQuality(q: VisualQuality): void;
  setTranscriptView(v: AppState['transcriptView']): void;
  setTranscriptFontSize(s: AppState['transcriptFontSize']): void;
  /** 切项目时清空当前 session 选择和事件 buffer（事件留主进程的；renderer 只清缓存）。*/
  resetSessionView(): void;
  /** FEATURE_031: /clear 命令清空指定 session 的事件 / 用户消息 buffer (session 本体保留)。*/
  resetSessionMessages(sessionId: string): void;
  /**
   * FEATURE_033 fork：把 source 的 user messages [0..forkPointTurnIdx] + 全部对应 events
   * 复制到 newSessionId 的 buffer。main 端已经把新 session 加进 list (caller responsible
   * for upsertSession with new meta)；本 action 只负责 buffer 复制。
   */
  forkSessionBuffers(srcSessionId: string, newSessionId: string, forkPointTurnIdx: number): void;
  /**
   * FEATURE_033 rewind：截断 sessionId 的 buffer 到 rewindPastTurnIdx (含)。
   *   - userMessagesBySession 保留 [0..idx] 共 idx+1 条
   *   - eventsBySession 保留 [0..events-before-(idx+1)-th-user-message]
   * 越界 idx 静默 no-op（main 端不持有 events 不会报 invalid_index，校验放这层）。
   */
  rewindSessionBuffers(sessionId: string, rewindPastTurnIdx: number): void;
  /** F009: FilePanel 读完 lastDiffPath 后清掉，避免反复 jump。*/
  clearLastDiffPath(): void;
  /** F041: RightSidebar Changes 节点击文件行 → 设此 path 让 DiffPanel popout 接住。 */
  setLastDiffPath(path: string): void;
  /** P0: 标记某 session 已 invoke session.send 但还没有事件回流；spinner 据此显示 "Sending…"。*/
  setPendingSend(sessionId: string, pending: boolean): void;
  /** P0: 推一条 prompt 进 input history（用户提交时调），上限 200 条。 */
  appendInputHistory(sessionId: string, prompt: string): void;
  /** P2: Toggle the Task Dock. Open state is runtime-only; width remains persisted separately. */
  setRightSidebarOpen(open: boolean): void;
  /** 切左侧栏开/关。立即写 localStorage。*/
  setLeftSidebarOpen(open: boolean): void;
  /** 2026-06: 设左/右侧栏宽度（px），调用方自己 clamp，store 直接 set + 写 localStorage。*/
  setLeftSidebarWidth(px: number): void;
  setRightSidebarWidth(px: number): void;

  /** v0.1.9: Shell 同步 active popout 字符串到 store, 给 RightSidebar Section 用。 */
  setActivePopoutKind(kind: string | null): void;
  /** KX-I-02: 切 smart popout director 总开关。立即写 localStorage。 */
  setSmartPopoutEnabled(enabled: boolean): void;
  setMascotMode(mode: MascotMode): void;
  cycleMascotMode(): void;
  setMascotEnabled(enabled: boolean): void;
  setNativeCompletionNotificationsEnabled(enabled: boolean): void;
  /** KX-I-02: 标记某 (session, kind) 已被 promote 过(或用户主动开/关过),不再 auto。 */
  markPopoutPromoted(sessionId: string, kind: string): void;
  /**
   * v0.1.9 Step 7 — 用户拖动 src 项目到 target 位置(target 前面)。
   * 内部按当前 projects 列表算出新顺序,写 store + localStorage。
   * 路径用 canonProjectRoot 形态比较;src === target / 找不到任一时 no-op。
   */
  reorderProjects(srcCanonPath: string, targetCanonPath: string): void;
  /** v0.1.9 Step 7 — 切"Archived (N)"折叠组展开状态。立即写 localStorage。 */
  setArchivedProjectsExpanded(expanded: boolean): void;
}

// 单调 counter 用于生成 stable id——sessionId 内多条 user message 顺序唯一。
let userMessageCounter = 0;
let localNoticeCounter = 0;
let workflowNoticeCounter = 0;
let queuedUserMessageCounter = 0;
let lastLocalTranscriptSentAt = 0;
const MAX_LOCAL_NOTICES_PER_SESSION = 1000;
/**
 * 持久化 currentProjectPath 到 localStorage —— Vite HMR full reload / Electron renderer
 * 重载时，避免 zustand store 重置为 null 让 App.tsx 启动 effect 误把 currentProjectPath
 * 重置回 defaultWorkspace。
 *
 * **只持久化 projectPath，不持久化 sessionId**：sessionId 跨 Electron 主进程重启时，
 * main 端 host.sessions (in-flight Map) 是空的 — 把 stale sessionId 恢复进 store 后
 * session.send 立刻报 "session not found"。要正确处理需要 main 端 lazy resume（见
 * host.tryResume），让"点 Recents 里的 session 继续打字"能跑通；那是另一条单独路径。
 * 这里 keep simple：只保 projectPath，sessionId 重启清掉，user 走 Recents 重新点。
 */
const LS_KEY_PROJECT = 'kodax-space.currentProjectPath';
/** F040: ProjectTree 展开状态。值是 JSON.stringify(Record<projectPath, true>) */
const LS_KEY_EXPANDED_PROJECTS = 'kodax-space.expandedProjects';
const LS_KEY_PENDING_PERMISSION = 'kodax-space.pendingPermissionMode';
const LS_KEY_PENDING_REASONING = 'kodax-space.pendingReasoningMode';
const LS_KEY_PENDING_AUTO_ENGINE = 'kodax-space.pendingAutoModeEngine';
const LS_KEY_PENDING_AGENT = 'kodax-space.pendingAgentMode';
// pendingModel 是 provider-specific 字符串 (eg "anthropic/claude-opus-4-8")，
// 不像 mode 是封闭 enum——用宽校验：非空 + 长度上限避免 LS 被改成异常长字符串。
const LS_KEY_PENDING_MODEL = 'kodax-space.pendingModel';
const LS_KEY_MASCOT_MODE = 'kodax-space.mascotMode';
const LS_KEY_MASCOT_ENABLED = 'kodax-space.mascotEnabled';
const LS_KEY_SMART_POPOUT = 'kodax-space.smartPopoutEnabled';
const LS_KEY_NATIVE_COMPLETION_NOTIFICATIONS = 'kodax-space.nativeCompletionNotificationsEnabled';
const LS_KEY_SESSION_TOKEN_USAGE = 'kodax-space.sessionTokenUsage.v1';
const PENDING_MODEL_MAX_LEN = 256;
const MASCOT_MODE_VALUES = ['legacy', 'sprite', 'off'] as const;

// 持久化 pending* 模式时校验合法 enum 值，避免 LS 被改成非法值后崩 (typescript 编译期没法知道)
const PERMISSION_MODE_VALUES = ['plan', 'accept-edits', 'auto'] as const;
const REASONING_MODE_VALUES = ['off', 'auto', 'quick', 'balanced', 'deep'] as const;
const AUTO_MODE_ENGINE_VALUES = ['llm', 'rules'] as const;
const AGENT_MODE_VALUES = ['ama', 'sa'] as const;

function readPersistedPermissionMode(): SessionMeta['permissionMode'] | null {
  const v = lsGet(LS_KEY_PENDING_PERMISSION);
  return v !== null && (PERMISSION_MODE_VALUES as readonly string[]).includes(v)
    ? (v as SessionMeta['permissionMode'])
    : null;
}
function readPersistedReasoningMode(): SessionMeta['reasoningMode'] | null {
  const v = lsGet(LS_KEY_PENDING_REASONING);
  return v !== null && (REASONING_MODE_VALUES as readonly string[]).includes(v)
    ? (v as SessionMeta['reasoningMode'])
    : null;
}
function readPersistedAutoModeEngine(): SessionMeta['autoModeEngine'] | null {
  const v = lsGet(LS_KEY_PENDING_AUTO_ENGINE);
  return v !== null && (AUTO_MODE_ENGINE_VALUES as readonly string[]).includes(v)
    ? (v as SessionMeta['autoModeEngine'])
    : null;
}
function readPersistedAgentMode(): SessionMeta['agentMode'] | null {
  const v = lsGet(LS_KEY_PENDING_AGENT);
  if (v === 'amaw' || v === 'ama-workflow') {
    lsSet(LS_KEY_PENDING_AGENT, 'ama');
    return 'ama';
  }
  return v !== null && (AGENT_MODE_VALUES as readonly string[]).includes(v)
    ? (v as SessionMeta['agentMode'])
    : null;
}
function readPersistedModel(): string | null {
  const v = lsGet(LS_KEY_PENDING_MODEL);
  if (v === null) return null;
  if (v.length === 0 || v.length > PENDING_MODEL_MAX_LEN) return null;
  return v;
}

function readPersistedMascotMode(): MascotMode {
  const mode = lsGet(LS_KEY_MASCOT_MODE);
  if (mode !== null && (MASCOT_MODE_VALUES as readonly string[]).includes(mode)) {
    return mode as MascotMode;
  }
  return lsGet(LS_KEY_MASCOT_ENABLED) === '0' ? 'off' : 'legacy';
}

function persistMascotMode(mode: MascotMode): void {
  lsSet(LS_KEY_MASCOT_MODE, mode);
  lsSet(LS_KEY_MASCOT_ENABLED, mode === 'off' ? '0' : '1');
}

function nextMascotMode(mode: MascotMode): MascotMode {
  if (mode === 'legacy') return 'sprite';
  if (mode === 'sprite') return 'off';
  return 'legacy';
}

/**
 * v0.1.9 Step 7 — 读用户拖排过的项目顺序 (canonProjectRoot 路径数组,顺序意义)。
 * 坏值 (非 JSON / 非数组 / 元素非 string / 超 256 项) 一律返空,等效"按 lastUsedAt 排"。
 */
function readPersistedProjectOrder(): readonly string[] {
  const raw = lsGet('kodax-space.projectOrder');
  if (raw === null) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed) || parsed.length > 256) return [];
    const out: string[] = [];
    for (const p of parsed) {
      if (typeof p !== 'string' || p.length === 0 || p.length > 4096) continue;
      out.push(p);
    }
    return out;
  } catch {
    return [];
  }
}

/** F040: 从 localStorage 读 expanded projects map。坏值（非 object / 非 boolean） 一律返空。
 *  v0.1.5：接受 true/false 两种用户显式选择；缺省值（map 里没有）= 走默认。
 *  v0.1.4 旧 LS 数据只有 true 值仍然 forward-compatible（true=展开，跟原语义一致）。 */
function readPersistedExpandedProjects(): Record<string, boolean> {
  const raw = lsGet(LS_KEY_EXPANDED_PROJECTS);
  if (raw === null) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: Record<string, boolean> = {};
    for (const [k, v] of Object.entries(parsed)) {
      // 接 true / false；防 LS 被改成奇怪 shape
      if (typeof v !== 'boolean') continue;
      if (typeof k !== 'string' || k.length === 0 || k.length >= 4096) continue;
      out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

// pushNotification 的 set-callback 版本: dedupe id + 上限 50 截断,返回新 array。
// appendEvent 等内部 reducer 路径用 — 比从外层调 store.getState().pushNotification() 更省一次 set。
function pushNotificationLocal(
  current: readonly Notification[],
  notice: Notification,
): readonly Notification[] {
  const existingIndex = current.findIndex((n) => n.id === notice.id);
  if (existingIndex >= 0) {
    const existing = current[existingIndex]!;
    if (
      existing.severity === notice.severity &&
      existing.text === notice.text &&
      existing.sessionId === notice.sessionId &&
      existing.dismissOnOutsideInteraction === notice.dismissOnOutsideInteraction
    ) {
      return current;
    }
    return [notice, ...current.slice(0, existingIndex), ...current.slice(existingIndex + 1)].slice(
      0,
      50,
    );
  }
  return [notice, ...current].slice(0, 50);
}

function setSessionFlagValue(
  flags: SessionFlagsById,
  sessionId: string,
  flag: SessionFlagName,
  value: boolean,
): SessionFlagsById {
  const cur = flags[sessionId] ?? {};
  if (Boolean(cur[flag]) === value) return flags;
  const next = { ...cur, [flag]: value };
  if (!next.pinned && !next.archived && !next.unread) {
    const { [sessionId]: _drop, ...rest } = flags;
    return rest;
  }
  return { ...flags, [sessionId]: next };
}

function isSessionVisiblyOpen(state: AppState, sessionId: string): boolean {
  if (state.currentSessionId !== sessionId) return false;
  if (typeof document === 'undefined') return true;
  return !document.hidden && document.hasFocus();
}

function appendSessionEvent(
  bucket: readonly SessionEvent[],
  event: SessionEvent,
): readonly SessionEvent[] {
  if (event.kind === 'workflow_notice' && event.key !== undefined) {
    const existingIndex = bucket.findIndex(
      (item) => item.kind === 'workflow_notice' && item.key === event.key,
    );
    if (existingIndex !== -1) {
      return bucket.map((item, index) =>
        index === existingIndex && item.kind === 'workflow_notice'
          ? { ...event, sentAt: item.sentAt ?? event.sentAt }
          : item,
      );
    }
  }
  if (event.kind === 'tool_start' && event.runtimeEvent !== undefined) {
    for (let index = bucket.length - 1; index >= 0; index--) {
      const previous = bucket[index]!;
      if (previous.kind === 'session_complete' || previous.kind === 'session_error') break;
      if (
        previous.kind === 'tool_start' &&
        previous.toolId === event.toolId &&
        previous.runtimeEvent?.runtimeId === event.runtimeEvent.runtimeId &&
        previous.runtimeEvent.runId === event.runtimeEvent.runId
      ) {
        return bucket.map((item, itemIndex) => (itemIndex === index ? event : item));
      }
    }
  }
  const last = bucket[bucket.length - 1];
  if (
    event.kind === 'text_delta' &&
    last?.kind === 'text_delta' &&
    event.runtimeEvent === undefined &&
    last.runtimeEvent === undefined
  ) {
    return [
      ...bucket.slice(0, -1),
      { ...event, text: last.text + event.text, sentAt: last.sentAt ?? event.sentAt },
    ];
  }
  if (
    event.kind === 'thinking_delta' &&
    last?.kind === 'thinking_delta' &&
    event.runtimeEvent === undefined &&
    last.runtimeEvent === undefined
  ) {
    return [
      ...bucket.slice(0, -1),
      { ...event, text: last.text + event.text, sentAt: last.sentAt ?? event.sentAt },
    ];
  }
  return [...bucket, event];
}

function snapshotCoversRuntimeDraftEvent(state: AppState, event: SessionEvent): boolean {
  if (
    event.kind !== 'text_delta' &&
    event.kind !== 'thinking_delta' &&
    event.kind !== 'thinking_end'
  ) {
    return false;
  }
  const origin = event.runtimeEvent;
  if (!origin) return false;
  const barrier = state.runtimeSnapshotCursorBySession[event.sessionId];
  const coveredSeq =
    event.kind === 'text_delta' ? barrier?.assistantDraftSeq : barrier?.thinkingDraftSeq;
  return (
    barrier?.runtimeId === origin.runtimeId &&
    barrier.runId === origin.runId &&
    coveredSeq !== undefined &&
    origin.seq <= coveredSeq
  );
}

interface TranscriptTurnSnapshot {
  readonly messageId: string;
  readonly userIndex: number;
  readonly eventStart: number;
  readonly eventEnd: number;
  readonly sentAt: number;
  readonly turnId?: string;
  readonly turnUserOrdinal?: number;
  readonly restoredFromHistory: boolean;
  readonly terminal: boolean;
  readonly terminalTurnId?: string;
  readonly closed: boolean;
  readonly thinking: string;
  readonly text: string;
  readonly tools: readonly {
    readonly toolId: string;
    readonly toolName: string;
    readonly input: string;
    readonly result?: string;
  }[];
  readonly notices: readonly string[];
  readonly visibleSequence: readonly string[];
}

interface ReconciledTranscriptBuffers {
  readonly userMessages: readonly UserMessage[];
  readonly events: readonly SessionEvent[];
}

function transcriptTurnSnapshots(
  userMessages: readonly UserMessage[],
  events: readonly SessionEvent[],
): TranscriptTurnSnapshot[] {
  const turns: TranscriptTurnSnapshot[] = [];
  let eventCursor = 0;
  for (let userIndex = 0; userIndex < userMessages.length; userIndex++) {
    const message = userMessages[userIndex]!;
    if (message.hiddenHistoryAnchor === true) {
      const eventEnd =
        message.historyNoAssistantSegment === true
          ? eventCursor
          : transcriptSegmentEnd(events, eventCursor);
      eventCursor = eventEnd;
      continue;
    }
    const eventStart = eventCursor;
    const eventEnd =
      message.historyNoAssistantSegment === true
        ? eventCursor
        : transcriptSegmentEnd(events, eventCursor);
    const semantic = transcriptSegmentSemantic(events.slice(eventStart, eventEnd));
    turns.push({
      messageId: message.id,
      userIndex,
      eventStart,
      eventEnd,
      sentAt: message.sentAt,
      ...(message.turnId !== undefined ? { turnId: message.turnId } : {}),
      ...(message.turnUserOrdinal !== undefined
        ? { turnUserOrdinal: message.turnUserOrdinal }
        : {}),
      restoredFromHistory: message.restoredFromHistory === true,
      ...semantic,
      closed: semantic.terminal || eventEnd < events.length || userIndex < userMessages.length - 1,
    });
    eventCursor = eventEnd;
  }
  return turns;
}

function transcriptSegmentEnd(events: readonly SessionEvent[], cursor: number): number {
  for (let index = cursor; index < events.length; index++) {
    const event = events[index]!;
    if (
      index > cursor &&
      (event.kind === 'mid_turn_user_prompt' || event.kind === 'queued_user_prompt_started')
    ) {
      return index;
    }
    if (event.kind === 'session_complete' || event.kind === 'session_error') {
      let end = index + 1;
      while (
        end < events.length &&
        (events[end]!.kind === 'session_complete' || events[end]!.kind === 'session_error')
      ) {
        end++;
      }
      return end;
    }
  }
  return events.length;
}

/**
 * A history-first observation can place Runtime-only events between the restored history suffix
 * and the first live delivery marker. Those events still need a positional segment owner: without
 * one, the promoted live user consumes the pre-delivery segment, is considered closed at its own
 * marker, and a later prompt steals the response that follows that marker.
 *
 * Add invisible owners only for the proven segment deficit before the marker. The anchors still
 * compose their segment, so an unmatched live-only tool/text prefix remains visible; they merely
 * prevent later user boundaries from shifting left.
 */
function alignSegmentOwnersBeforePrompt(
  sessionId: string,
  userMessages: readonly UserMessage[],
  events: readonly SessionEvent[],
  deliveryBoundaryIndex: number,
): readonly UserMessage[] {
  if (
    deliveryBoundaryIndex < 0 ||
    deliveryBoundaryIndex >= events.length ||
    (events[deliveryBoundaryIndex]?.kind !== 'mid_turn_user_prompt' &&
      events[deliveryBoundaryIndex]?.kind !== 'queued_user_prompt_started')
  ) {
    return userMessages;
  }

  let eventCursor = 0;
  let requiredOwners = 0;
  while (eventCursor < deliveryBoundaryIndex) {
    const eventEnd = transcriptSegmentEnd(events, eventCursor);
    if (eventEnd <= eventCursor || eventEnd > deliveryBoundaryIndex) break;
    requiredOwners++;
    eventCursor = eventEnd;
  }
  const existingOwners = userMessages.reduce(
    (count, message) => count + (message.historyNoAssistantSegment === true ? 0 : 1),
    0,
  );
  const missingOwners = requiredOwners - existingOwners;
  if (missingOwners <= 0) return userMessages;

  const aligned = [...userMessages];
  for (let index = 0; index < missingOwners; index++) {
    aligned.push({
      ...createUserMessage(sessionId, '', nextUserMessageSentAtAfter(aligned)),
      hiddenHistoryAnchor: true,
    });
  }
  return aligned;
}

function transcriptSegmentSemantic(
  events: readonly SessionEvent[],
): Pick<
  TranscriptTurnSnapshot,
  'terminal' | 'terminalTurnId' | 'thinking' | 'text' | 'tools' | 'notices' | 'visibleSequence'
> {
  let terminal = false;
  let terminalTurnId: string | undefined;
  let thinking = '';
  let text = '';
  const tools: Array<{
    toolId: string;
    toolName: string;
    input: string;
    result?: string;
  }> = [];
  const toolIndexById = new Map<string, number>();
  const notices: string[] = [];
  const visibleSequence: string[] = [];
  const pushVisibleText = (kind: 'thinking' | 'text', value: string): void => {
    const prefix = `${kind}:`;
    const last = visibleSequence[visibleSequence.length - 1];
    if (last?.startsWith(prefix)) {
      visibleSequence[visibleSequence.length - 1] = `${last}${value}`;
    } else {
      visibleSequence.push(`${prefix}${value}`);
    }
  };
  for (const event of events) {
    if (event.kind === 'session_complete' || event.kind === 'session_error') {
      terminal = true;
      terminalTurnId = event.turnId;
      if (event.kind === 'session_error') {
        const error = `error:${event.error}`;
        notices.push(error);
        visibleSequence.push(error);
      }
    } else if (event.kind === 'thinking_delta') {
      thinking += event.text;
      pushVisibleText('thinking', event.text);
    } else if (event.kind === 'text_delta') {
      text += event.text;
      pushVisibleText('text', event.text);
    } else if (event.kind === 'tool_start') {
      toolIndexById.set(event.toolId, tools.length);
      const tool = {
        toolId: event.toolId,
        toolName: event.toolName,
        input: stableJson(event.input ?? {}),
      };
      tools.push(tool);
      visibleSequence.push(`tool-start:${stableJson(tool)}`);
    } else if (event.kind === 'tool_result') {
      const toolIndex = toolIndexById.get(event.toolId);
      if (toolIndex !== undefined) {
        tools[toolIndex] = { ...tools[toolIndex]!, result: event.content };
      }
      visibleSequence.push(
        `tool-result:${stableJson({
          toolId: event.toolId,
          toolName: event.toolName,
          content: event.content,
        })}`,
      );
    } else if (event.kind === 'sidecar_message') {
      const notice = `sidecar:${stableJson(event.message)}`;
      notices.push(notice);
      visibleSequence.push(notice);
    } else if (event.kind === 'lineage_notice') {
      const notice = `lineage:${event.noticeKind}:${event.text}`;
      notices.push(notice);
      visibleSequence.push(notice);
    } else if (event.kind === 'workflow_notice') {
      const notice = `workflow:${event.text}`;
      notices.push(notice);
      visibleSequence.push(notice);
    } else if (event.kind === 'compact_stats' && event.contextKind !== 'child') {
      visibleSequence.push(
        `compact:${stableJson({
          tokensBefore: event.tokensBefore,
          tokensAfter: event.tokensAfter,
          contextId: event.contextId,
          contextRevision: event.contextRevision,
          afterRevision: event.afterRevision,
          committed: event.committed,
        })}`,
      );
    }
  }
  return {
    terminal,
    ...(terminalTurnId !== undefined ? { terminalTurnId } : {}),
    thinking,
    text,
    tools,
    notices,
    visibleSequence,
  };
}

function hasStrongTurnIdentity(
  turn: TranscriptTurnSnapshot,
): turn is TranscriptTurnSnapshot & { readonly turnId: string; readonly turnUserOrdinal: number } {
  return turn.turnId !== undefined && turn.turnUserOrdinal !== undefined;
}

function strongTurnIdentityMatches(
  left: TranscriptTurnSnapshot,
  right: TranscriptTurnSnapshot,
): boolean {
  return (
    hasStrongTurnIdentity(left) &&
    hasStrongTurnIdentity(right) &&
    left.turnId === right.turnId &&
    left.turnUserOrdinal === right.turnUserOrdinal
  );
}

function projectedEventText(
  events: readonly SessionEvent[],
  kind: 'text_delta' | 'thinking_delta',
): string {
  return events
    .filter((event): event is Extract<SessionEvent, { kind: typeof kind }> => event.kind === kind)
    .map((event) => event.text)
    .join('');
}

function projectionNoticeKey(event: SessionEvent): string | undefined {
  if (event.kind === 'sidecar_message') return `sidecar:${stableJson(event.message)}`;
  if (event.kind === 'lineage_notice') {
    return `lineage:${event.noticeKind}:${event.text}`;
  }
  if (event.kind === 'workflow_notice') return `workflow:${event.text}`;
  return undefined;
}

function isPromptSegmentBoundary(
  event: SessionEvent,
): event is Extract<SessionEvent, { kind: 'mid_turn_user_prompt' | 'queued_user_prompt_started' }> {
  return event.kind === 'mid_turn_user_prompt' || event.kind === 'queued_user_prompt_started';
}

function isTranscriptTerminal(
  event: SessionEvent,
): event is Extract<SessionEvent, { kind: 'session_complete' | 'session_error' }> {
  return event.kind === 'session_complete' || event.kind === 'session_error';
}

/**
 * Durable history and Runtime live events are two projections of one canonical turn. History
 * contains canonical root tool calls (including todo tools); live contains runtime-only state
 * such as artifacts, diagnostics and todo snapshots. Keep the durable visible ordering, add only
 * live-visible information that history does not contain, and retain every live-only state event.
 */
function mergeCanonicalTurnProjections(
  durableEvents: readonly SessionEvent[],
  liveEvents: readonly SessionEvent[],
): SessionEvent[] {
  const liveTerminals = liveEvents.filter(isTranscriptTerminal);
  const durableTerminals = durableEvents.filter(isTranscriptTerminal);
  // A delivered-prompt event is both Runtime state and the positional start boundary for its
  // user-owned segment. History has already reconstructed the canonical user row, so folding must
  // retain at most one such marker and keep it at index 0. Appending it after durable text would
  // turn it into an interior boundary; the next reconciliation scan would then shift every later
  // assistant segment to the following user.
  const leadingPromptBoundary =
    durableEvents.find(isPromptSegmentBoundary) ?? liveEvents.find(isPromptSegmentBoundary);
  const durableBody = durableEvents.filter(
    (event) => !isTranscriptTerminal(event) && !isPromptSegmentBoundary(event),
  );
  const mergedBody = [...durableBody];
  const durableToolStarts = new Set(
    durableBody
      .filter(
        (event): event is Extract<SessionEvent, { kind: 'tool_start' }> =>
          event.kind === 'tool_start',
      )
      .map((event) => event.toolId),
  );
  const durableToolResultIndex = new Map<string, number>();
  const durableNoticeKeys = new Set<string>();
  for (let index = 0; index < mergedBody.length; index++) {
    const event = mergedBody[index]!;
    if (event.kind === 'tool_result') durableToolResultIndex.set(event.toolId, index);
    const noticeKey = projectionNoticeKey(event);
    if (noticeKey !== undefined) durableNoticeKeys.add(noticeKey);
  }

  const liveExtras: SessionEvent[] = [];
  for (const event of liveEvents) {
    if (
      isTranscriptTerminal(event) ||
      isPromptSegmentBoundary(event) ||
      event.kind === 'text_delta' ||
      event.kind === 'thinking_delta'
    ) {
      continue;
    }
    if (event.kind === 'tool_start') {
      if (!durableToolStarts.has(event.toolId)) {
        durableToolStarts.add(event.toolId);
        liveExtras.push(event);
      }
      continue;
    }
    if (event.kind === 'tool_result') {
      const durableIndex = durableToolResultIndex.get(event.toolId);
      if (durableIndex === undefined) {
        liveExtras.push(event);
      } else {
        const durableResult = mergedBody[durableIndex];
        if (
          durableResult?.kind === 'tool_result' &&
          (durableResult.content !== event.content || durableResult.toolName !== event.toolName)
        ) {
          // The live receipt is later than an in-flight history snapshot. Replace in place so
          // the tool card keeps canonical ordering and receives the final result exactly once.
          mergedBody[durableIndex] = event;
        }
      }
      continue;
    }
    const noticeKey = projectionNoticeKey(event);
    if (noticeKey !== undefined) {
      if (!durableNoticeKeys.has(noticeKey)) {
        durableNoticeKeys.add(noticeKey);
        liveExtras.push(event);
      }
      continue;
    }
    // Lifecycle, tool progress, artifact/todo/context diagnostics and other runtime-only events
    // are not reconstructed by session.history. Retain them without trying to content-normalize.
    liveExtras.push(event);
  }

  const textSuffix = projectionTextSuffix(
    projectedEventText(durableEvents, 'text_delta'),
    projectedEventText(liveEvents, 'text_delta'),
  );
  const thinkingSuffix = projectionTextSuffix(
    projectedEventText(durableEvents, 'thinking_delta'),
    projectedEventText(liveEvents, 'thinking_delta'),
  );
  const liveTextEvent = liveEvents.find((event) => event.kind === 'text_delta');
  const liveThinkingEvent = liveEvents.find((event) => event.kind === 'thinking_delta');
  if (thinkingSuffix.length > 0) {
    liveExtras.push({
      kind: 'thinking_delta',
      sessionId: liveEvents[0]?.sessionId ?? durableEvents[0]?.sessionId ?? '',
      text: thinkingSuffix,
      ...(liveThinkingEvent?.kind === 'thinking_delta' && liveThinkingEvent.sentAt !== undefined
        ? { sentAt: liveThinkingEvent.sentAt }
        : {}),
    });
  }
  if (textSuffix.length > 0) {
    liveExtras.push({
      kind: 'text_delta',
      sessionId: liveEvents[0]?.sessionId ?? durableEvents[0]?.sessionId ?? '',
      text: textSuffix,
      ...(liveTextEvent?.kind === 'text_delta' && liveTextEvent.sentAt !== undefined
        ? { sentAt: liveTextEvent.sentAt }
        : {}),
    });
  }

  const body =
    leadingPromptBoundary !== undefined
      ? [leadingPromptBoundary, ...mergedBody, ...liveExtras]
      : [...mergedBody, ...liveExtras];
  // Runtime terminals are authoritative when available. Preserve the whole consecutive sequence:
  // older adapters/reconnect paths may emit error -> complete -> wrapped error, and the selector
  // intentionally renders both errors while treating every terminal as one segment delimiter.
  // Durable history contributes only a synthetic complete today, so mixing both projections would
  // add a redundant delimiter.
  const terminals = liveTerminals.length > 0 ? liveTerminals : durableTerminals;
  return terminals.length > 0 ? [...body, ...terminals] : body;
}

function preserveRelocatedSegmentClosure(
  events: readonly SessionEvent[],
  turn: TranscriptTurnSnapshot,
): SessionEvent[] {
  if (events.length === 0 || events.some(isTranscriptTerminal)) return [...events];
  const sessionId = events[0]?.sessionId;
  if (!sessionId) return [...events];
  // A closed live segment can be delimited only by the following prompt marker. Folding relocates
  // the segment to its durable owner and leaves that marker with the next owner, so reproduce the
  // lost structural boundary explicitly. This renderer-only terminal is the same delimiter used
  // by session.history reconstruction; it does not claim that a separate Runtime run completed.
  return [
    ...events,
    {
      kind: 'session_complete',
      sessionId,
      ...(turn.turnId !== undefined ? { turnId: turn.turnId } : {}),
    },
  ];
}

function liveTurnCanFold(turn: TranscriptTurnSnapshot): boolean {
  if (!turn.closed) return false;
  if (!turn.terminal) return true;
  if (turn.restoredFromHistory) return true;
  return turn.turnId !== undefined && turn.terminalTurnId === turn.turnId;
}

/**
 * Fold duplicate projections only with canonical identity. No content/timestamp heuristic is
 * allowed here: a fast, intentional repeat must remain a distinct turn even when its text and
 * answer are identical. The loop also handles multi-turn history snapshots whose last turn is
 * still in flight; every already-closed identity is folded independently.
 */
function foldStrongIdentityDuplicateTurns(
  userMessages: readonly UserMessage[],
  events: readonly SessionEvent[],
): ReconciledTranscriptBuffers {
  let nextUsers = [...userMessages];
  let nextEvents = [...events];
  let didFold = false;
  for (;;) {
    const turns = transcriptTurnSnapshots(nextUsers, nextEvents);
    let pair:
      | {
          readonly durable: TranscriptTurnSnapshot;
          readonly duplicate: TranscriptTurnSnapshot;
        }
      | undefined;

    for (let duplicateIndex = 0; duplicateIndex < turns.length && !pair; duplicateIndex++) {
      const duplicate = turns[duplicateIndex]!;
      if (!hasStrongTurnIdentity(duplicate) || !liveTurnCanFold(duplicate)) continue;
      for (let durableIndex = 0; durableIndex < duplicateIndex; durableIndex++) {
        const durable = turns[durableIndex]!;
        if (
          !durable.restoredFromHistory ||
          !strongTurnIdentityMatches(durable, duplicate) ||
          (!duplicate.restoredFromHistory && !liveTurnCanFold(duplicate))
        ) {
          continue;
        }
        pair = { durable, duplicate };
        break;
      }
    }
    if (!pair) break;

    const durableSegment = nextEvents.slice(pair.durable.eventStart, pair.durable.eventEnd);
    const duplicateSegment = nextEvents.slice(pair.duplicate.eventStart, pair.duplicate.eventEnd);
    const mergedSegment = preserveRelocatedSegmentClosure(
      mergeCanonicalTurnProjections(durableSegment, duplicateSegment),
      pair.duplicate,
    );
    const duplicateMessage = nextUsers[pair.duplicate.userIndex];
    didFold = true;
    nextEvents = [
      ...nextEvents.slice(0, pair.durable.eventStart),
      ...mergedSegment,
      ...nextEvents.slice(pair.durable.eventEnd, pair.duplicate.eventStart),
      ...nextEvents.slice(pair.duplicate.eventEnd),
    ];

    nextUsers = nextUsers
      .filter((_, index) => index !== pair.duplicate.userIndex)
      .map((message, index) => {
        if (index !== pair.durable.userIndex) return message;
        const { historyNoAssistantSegment: _emptySegment, ...rest } = message;
        const deliveryQueueId = rest.deliveryQueueId ?? duplicateMessage?.deliveryQueueId;
        const deliveryQueueMode = rest.deliveryQueueMode ?? duplicateMessage?.deliveryQueueMode;
        const reconciled = {
          ...rest,
          ...(deliveryQueueId !== undefined ? { deliveryQueueId } : {}),
          ...(deliveryQueueMode !== undefined ? { deliveryQueueMode } : {}),
        };
        return mergedSegment.length > 0
          ? reconciled
          : { ...reconciled, historyNoAssistantSegment: true };
      });
  }
  return didFold ? { userMessages: nextUsers, events: nextEvents } : { userMessages, events };
}

function hideOpenStrongIdentityDuplicateProjection(
  userMessages: readonly UserMessage[],
  events: readonly SessionEvent[],
): readonly UserMessage[] {
  const turns = transcriptTurnSnapshots(userMessages, events);
  const sentAtByMessageId = new Map<string, number>();
  for (let liveIndex = 0; liveIndex < turns.length; liveIndex++) {
    const live = turns[liveIndex]!;
    if (live.restoredFromHistory || live.closed || !hasStrongTurnIdentity(live)) continue;
    const durable = turns
      .slice(0, liveIndex)
      .reverse()
      .find(
        (candidate) =>
          candidate.restoredFromHistory &&
          candidate.closed &&
          strongTurnIdentityMatches(candidate, live),
      );
    if (durable) {
      sentAtByMessageId.set(live.messageId, Math.max(live.sentAt, durable.sentAt + 1));
    }
  }
  let changed = false;
  const reconciled = userMessages.map((message) => {
    const sentAt = sentAtByMessageId.get(message.id);
    if (sentAt !== undefined) {
      if (message.sentAt === sentAt && message.hiddenProjectionDuplicate === true) return message;
      changed = true;
      return { ...message, sentAt, hiddenProjectionDuplicate: true as const };
    }
    if (message.hiddenProjectionDuplicate !== true) return message;
    changed = true;
    const { hiddenProjectionDuplicate: _hidden, ...visibleMessage } = message;
    return visibleMessage;
  });
  return changed ? reconciled : userMessages;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Readonly<Record<string, unknown>>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'undefined';
}

function stampLiveStreamEvent(event: SessionEvent): SessionEvent {
  if (
    (event.kind === 'text_delta' || event.kind === 'thinking_delta') &&
    event.sentAt === undefined
  ) {
    return { ...event, sentAt: Date.now() };
  }
  return event;
}

let rootContextReadingOrder = 0;

function nextRootContextReadingOrder(): number {
  rootContextReadingOrder += 1;
  return rootContextReadingOrder;
}

function acceptsRootContextUpdate(
  current: SessionTokenInfo | undefined,
  contextId: string | undefined,
  contextRevision: number | undefined,
): boolean {
  if (!current) return true;
  if (current.contextId && contextId && current.contextId !== contextId) return true;
  if (current.contextRevision === undefined) return true;
  // Once the 0.7.74 revisioned stream is established, a revision-less compatibility event must
  // not be allowed to roll it back. Equal revisions remain valid because token use grows between
  // iterations inside one context revision.
  return contextRevision !== undefined && contextRevision >= current.contextRevision;
}

function tokenInfoFromCompaction(
  event: Extract<SessionEvent, { kind: 'compact_stats' }>,
): SessionTokenInfo {
  const committed = event.committed !== false;
  return {
    tokens: event.tokensAfter,
    source: 'compact_stats',
    ...(committed ? { compactedFrom: event.tokensBefore } : {}),
    ...(event.contextId ? { contextId: event.contextId } : {}),
    ...((event.afterRevision ?? event.contextRevision) !== undefined
      ? { contextRevision: event.afterRevision ?? event.contextRevision }
      : {}),
    lastCompaction: {
      committed,
      tokensBefore: event.tokensBefore,
      tokensAfter: event.tokensAfter,
      ...(event.source ? { source: event.source } : {}),
      ...(event.elapsedMs !== undefined ? { elapsedMs: event.elapsedMs } : {}),
      ...(event.strategy ? { strategy: event.strategy } : {}),
      ...(event.effectiveTriggerTokens !== undefined
        ? { effectiveTriggerTokens: event.effectiveTriggerTokens }
        : {}),
      ...(event.reason ? { reason: event.reason } : {}),
    },
  };
}

// 粗略 token 估算 — 同 bubbles.tsx / ContextWindowIndicator 公式（ASCII/4 + non-ASCII × 1）。
// 用于 session_complete 时一次性给 tokensBySession 填 estimate，让 Dashboard 不必扫 buffer。
function approxTokensForStats(text: string): number {
  let ascii = 0;
  let nonAscii = 0;
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) < 128) ascii++;
    else nonAscii++;
  }
  return Math.max(0, Math.round(ascii / 4 + nonAscii));
}

function lsGet(key: string): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function readOptInBoolean(raw: string | null): boolean {
  return raw === '1';
}

function lsSet(key: string, value: string | null): void {
  if (typeof window === 'undefined') return;
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    // localStorage 不可用（隐私模式 / 配额满）—— 静默；store 仍能跑，只是不持久化
  }
}

const MAX_PERSISTED_SESSION_USAGE = 500;
const MAX_RECENT_USAGE_REQUEST_IDS = 256;

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function readPersistedSessionTokenUsage(): Record<string, SessionTokenUsageInfo | undefined> {
  const raw = lsGet(LS_KEY_SESSION_TOKEN_USAGE);
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const entries = Object.entries(parsed as Record<string, unknown>).slice(
      -MAX_PERSISTED_SESSION_USAGE,
    );
    const result: Record<string, SessionTokenUsageInfo> = {};
    for (const [sessionId, value] of entries) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
      const record = value as Record<string, unknown>;
      if (
        !isNonNegativeSafeInteger(record.inputTokens) ||
        !isNonNegativeSafeInteger(record.outputTokens) ||
        !isNonNegativeSafeInteger(record.sampleCount)
      ) {
        continue;
      }
      if (
        record.cacheReadInputTokens !== undefined &&
        !isNonNegativeSafeInteger(record.cacheReadInputTokens)
      ) {
        continue;
      }
      if (
        record.cacheWriteInputTokens !== undefined &&
        !isNonNegativeSafeInteger(record.cacheWriteInputTokens)
      ) {
        continue;
      }
      result[sessionId] = {
        inputTokens: record.inputTokens,
        outputTokens: record.outputTokens,
        sampleCount: record.sampleCount,
        childSampleCount: isNonNegativeSafeInteger(record.childSampleCount)
          ? Math.min(record.childSampleCount, record.sampleCount)
          : 0,
        ...(record.cacheReadInputTokens !== undefined
          ? { cacheReadInputTokens: record.cacheReadInputTokens }
          : {}),
        ...(record.cacheWriteInputTokens !== undefined
          ? { cacheWriteInputTokens: record.cacheWriteInputTokens }
          : {}),
        ...(record.accountingSource === 'iteration' ||
        record.accountingSource === 'provider_diagnostic'
          ? { accountingSource: record.accountingSource }
          : {}),
        ...(Array.isArray(record.recentRequestIds)
          ? {
              recentRequestIds: record.recentRequestIds
                .filter(
                  (requestId): requestId is string =>
                    typeof requestId === 'string' &&
                    requestId.length > 0 &&
                    requestId.length <= 128,
                )
                .slice(-MAX_RECENT_USAGE_REQUEST_IDS),
            }
          : {}),
      };
    }
    return result;
  } catch {
    return {};
  }
}

function persistSessionTokenUsage(
  usageBySession: Readonly<Record<string, SessionTokenUsageInfo | undefined>>,
): void {
  const entries = Object.entries(usageBySession)
    .filter((entry): entry is [string, SessionTokenUsageInfo] => entry[1] !== undefined)
    .slice(-MAX_PERSISTED_SESSION_USAGE);
  lsSet(
    LS_KEY_SESSION_TOKEN_USAGE,
    entries.length > 0 ? JSON.stringify(Object.fromEntries(entries)) : null,
  );
}

function safeTokenSum(left: number, right: number): number {
  return Math.min(Number.MAX_SAFE_INTEGER, left + right);
}

function accumulateSessionTokenUsage(
  current: SessionTokenUsageInfo | undefined,
  usage: NonNullable<Extract<SessionEvent, { kind: 'iteration_end' }>['usage']>,
  isChildAgent: boolean,
  options: {
    readonly source: 'iteration' | 'provider_diagnostic';
    readonly requestId?: string;
    readonly countWhenUsageMissing?: boolean;
  },
): SessionTokenUsageInfo | undefined {
  if (
    options.source === 'provider_diagnostic' &&
    options.requestId &&
    current?.recentRequestIds?.includes(options.requestId)
  ) {
    return current;
  }
  const hasReportedValue =
    usage.inputTokens !== undefined ||
    usage.outputTokens !== undefined ||
    usage.cacheReadInputTokens !== undefined ||
    usage.cacheWriteInputTokens !== undefined;
  if (!hasReportedValue && !options.countWhenUsageMissing) return current;

  const cacheReadKnown =
    current?.cacheReadInputTokens !== undefined || usage.cacheReadInputTokens !== undefined;
  const cacheWriteKnown =
    current?.cacheWriteInputTokens !== undefined || usage.cacheWriteInputTokens !== undefined;
  const recentRequestIds =
    options.source === 'provider_diagnostic' && options.requestId
      ? [...(current?.recentRequestIds ?? []), options.requestId].slice(
          -MAX_RECENT_USAGE_REQUEST_IDS,
        )
      : current?.recentRequestIds;
  return {
    inputTokens: safeTokenSum(current?.inputTokens ?? 0, usage.inputTokens ?? 0),
    outputTokens: safeTokenSum(current?.outputTokens ?? 0, usage.outputTokens ?? 0),
    sampleCount: safeTokenSum(current?.sampleCount ?? 0, 1),
    childSampleCount: safeTokenSum(current?.childSampleCount ?? 0, isChildAgent ? 1 : 0),
    accountingSource:
      options.source === 'provider_diagnostic'
        ? 'provider_diagnostic'
        : (current?.accountingSource ?? 'iteration'),
    ...(recentRequestIds ? { recentRequestIds } : {}),
    ...(cacheReadKnown
      ? {
          cacheReadInputTokens: safeTokenSum(
            current?.cacheReadInputTokens ?? 0,
            usage.cacheReadInputTokens ?? 0,
          ),
        }
      : {}),
    ...(cacheWriteKnown
      ? {
          cacheWriteInputTokens: safeTokenSum(
            current?.cacheWriteInputTokens ?? 0,
            usage.cacheWriteInputTokens ?? 0,
          ),
        }
      : {}),
  };
}

// v0.1.9 Step 7 — 模块加载时一次性算 IS_WIN, 跟 LeftSidebar `IS_WIN` 同源 (review
// MEDIUM-2)。reorderProjects 之前在 action 闭包里读 navigator.userAgent,跟 LeftSidebar
// 的 IS_WIN module-const 双实现,逻辑上一致但脆弱;统一拉模块级常量。
const IS_WIN_RENDERER = typeof navigator !== 'undefined' && /Windows/i.test(navigator.userAgent);

// 2026-06: sidebar 宽度下限——拖到很窄时还能识别 icon + 一两个字符。
const SIDEBAR_WIDTH_MIN = 180;

/** 动态上限 = 窗口宽度的一半（用户 2026-06-15 指定）。窗口越宽，侧栏越能拉宽，但最多占一半。 */
export function sidebarWidthMax(): number {
  const w = typeof window !== 'undefined' && window.innerWidth ? window.innerWidth : 1440;
  return Math.max(SIDEBAR_WIDTH_MIN + 120, Math.round(w * 0.5));
}

/** Clamp a (finite) drag px to [MIN, dynamicMax]。拖动预览 + commit 共用，避免越界后回弹。 */
export function clampSidebarWidthPx(px: number): number {
  return Math.round(Math.min(sidebarWidthMax(), Math.max(SIDEBAR_WIDTH_MIN, px)));
}

// 只有非有限值(NaN — 如 localStorage 缺值)才退回 fallback；有限值一律 clamp 到边界
// 而不是弹回 default —— 否则用户拖过界一松手就跳回默认宽，看着像"拖不动"(用户复报 2026-06-15)。
function clampSidebarWidth(raw: number, fallback: number): number {
  if (!Number.isFinite(raw)) return fallback;
  return clampSidebarWidthPx(raw);
}

// F060：renderer 侧 workflowRuns 上限——长跑桌面 session 可能处理大量 run，无界增长会拖慢
// 每次涉及 workflowRuns 的 store 更新。与 main 侧 WorkflowController 的 MAX_ORIGINS 对齐。
// 超限时按插入序（JS 对象 string key 保序）淘汰最旧的；更新已存在 run 不改其插入位（不 churn）。
const MAX_WORKFLOW_RUNS = 500;
// F065：每个 run 保留的子 agent 活动条数上限（有界，防长跑无界增长）。
const MAX_ACTIVITY_PER_RUN = 40;
function capWorkflowRuns(runs: Record<string, WorkflowRunT>): Record<string, WorkflowRunT> {
  const keys = Object.keys(runs);
  if (keys.length <= MAX_WORKFLOW_RUNS) return runs;
  const trimmed: Record<string, WorkflowRunT> = {};
  for (const k of keys.slice(keys.length - MAX_WORKFLOW_RUNS)) trimmed[k] = runs[k]!;
  return trimmed;
}

function nextLocalTranscriptSentAt(): number {
  const now = Date.now();
  const next = now > lastLocalTranscriptSentAt ? now : lastLocalTranscriptSentAt + 1;
  lastLocalTranscriptSentAt = next;
  return next;
}

function nextUserMessageSentAtAfter(userMessages: readonly UserMessage[]): number {
  let latestMessageSentAt = Number.NEGATIVE_INFINITY;
  for (const message of userMessages) {
    if (Number.isFinite(message.sentAt) && message.sentAt > latestMessageSentAt) {
      latestMessageSentAt = message.sentAt;
    }
  }
  const next = Math.max(nextLocalTranscriptSentAt(), latestMessageSentAt + 1);
  lastLocalTranscriptSentAt = Math.max(lastLocalTranscriptSentAt, next);
  return next;
}

interface StrongUserTurnIdentity {
  readonly turnId: string;
  readonly turnUserOrdinal: number;
}

function createUserMessage(
  sessionId: string,
  content: string,
  sentAt?: number,
  identity?: StrongUserTurnIdentity,
  attachments?: readonly UserImageAttachment[],
): UserMessage {
  return {
    id: `u_${sessionId}_${++userMessageCounter}`,
    content,
    sentAt: sentAt ?? nextLocalTranscriptSentAt(),
    ...(attachments && attachments.length > 0 ? { attachments } : {}),
    ...(identity ?? {}),
  };
}

function liveProjectionClearsPendingSend(
  current: SpaceSessionLiveProjectionT | undefined,
  projection: SpaceSessionLiveProjectionT,
): boolean {
  if (projection.activeRun || projection.queuedRuns.length > 0) return true;
  const terminal = projection.lastTerminalRun;
  if (!terminal) return false;
  const currentTerminal = current?.lastTerminalRun;
  return (
    currentTerminal?.runId !== terminal.runId ||
    currentTerminal.phase !== terminal.phase ||
    currentTerminal.completedAt !== terminal.completedAt
  );
}

function bindInitialLiveUserTurnIdentity(
  userMessages: readonly UserMessage[],
  turnId: string,
): readonly UserMessage[] {
  if (
    userMessages.some(
      (message) =>
        !message.restoredFromHistory && message.turnId === turnId && message.turnUserOrdinal === 0,
    )
  ) {
    return userMessages;
  }
  for (let index = userMessages.length - 1; index >= 0; index--) {
    const message = userMessages[index]!;
    if (
      message.restoredFromHistory ||
      message.hiddenHistoryAnchor ||
      message.turnId !== undefined
    ) {
      continue;
    }
    const next = userMessages.slice();
    next[index] = { ...message, turnId, turnUserOrdinal: 0 };
    return next;
  }
  return userMessages;
}

function resolveLiveUserOrdinal(userMessages: readonly UserMessage[], turnId: string): number {
  // The Runtime adapter supplies turnUserOrdinal when it observed the canonical turn from its
  // start. If that fact is absent (for example, observation attached mid-turn after reconnect),
  // text/queue/alignment metadata cannot distinguish a replay from a legal same-text prompt.
  // Always fail open with a fresh ordinal; a duplicate is recoverable, a deleted prompt is not.
  let maxOrdinal = -1;
  for (const message of userMessages) {
    if (
      message.turnId === turnId &&
      message.turnUserOrdinal !== undefined &&
      message.turnUserOrdinal > maxOrdinal
    ) {
      maxOrdinal = message.turnUserOrdinal;
    }
  }
  return maxOrdinal + 1;
}

function normalizeLocalNoticeOptions(
  options?: number | { readonly sentAt?: number; readonly variant?: 'echo' | 'output' },
): { sentAt?: number; variant?: 'echo' | 'output' } {
  if (typeof options === 'number') return { sentAt: options };
  return options ?? {};
}

function defaultLocalNoticeVariant(content: string): 'echo' | 'output' {
  return content.trimStart().startsWith('/') ? 'echo' : 'output';
}

function randomLocalNoticeSuffix(): string {
  const cryptoObj = globalThis.crypto;
  if (cryptoObj && typeof cryptoObj.randomUUID === 'function') {
    return cryptoObj.randomUUID();
  }
  return Math.random().toString(36).slice(2, 10);
}

function createLocalNotice(
  content: string,
  options?: number | { readonly sentAt?: number; readonly variant?: 'echo' | 'output' },
): LocalNoticeMessage {
  const normalized = normalizeLocalNoticeOptions(options);
  const sentAt = normalized.sentAt ?? nextLocalTranscriptSentAt();
  return {
    id: `ln_${sentAt}_${++localNoticeCounter}_${randomLocalNoticeSuffix()}`,
    content,
    sentAt,
    variant: normalized.variant ?? defaultLocalNoticeVariant(content),
  };
}

function mergeLocalNotices(
  ...buckets: readonly (readonly LocalNoticeMessage[])[]
): readonly LocalNoticeMessage[] {
  const byId = new Map<string, LocalNoticeMessage>();
  for (const bucket of buckets) {
    for (const notice of bucket) byId.set(notice.id, notice);
  }
  return [...byId.values()]
    .sort((a, b) => a.sentAt - b.sentAt || a.id.localeCompare(b.id))
    .slice(-MAX_LOCAL_NOTICES_PER_SESSION);
}

interface LocalNoticeIpcBridge {
  invoke(
    channel: 'session.localNotice.append',
    payload: { readonly sessionId: string; readonly notice: LocalNoticeMessage },
  ): Promise<unknown>;
  invoke(
    channel: 'session.localNotice.replace',
    payload: { readonly sessionId: string; readonly notices: readonly LocalNoticeMessage[] },
  ): Promise<unknown>;
}

function getLocalNoticeBridge(): LocalNoticeIpcBridge | undefined {
  if (typeof window === 'undefined') return undefined;
  return (window as Window & { readonly kodaxSpace?: LocalNoticeIpcBridge }).kodaxSpace;
}

function persistLocalNoticeAppend(sessionId: string, notice: LocalNoticeMessage): void {
  const bridge = getLocalNoticeBridge();
  if (!bridge) return;
  void bridge.invoke('session.localNotice.append', { sessionId, notice }).catch(() => undefined);
}

function persistLocalNoticeReplace(
  sessionId: string,
  notices: readonly LocalNoticeMessage[],
): void {
  const bridge = getLocalNoticeBridge();
  if (!bridge) return;
  void bridge.invoke('session.localNotice.replace', { sessionId, notices }).catch(() => undefined);
}

function normalizeQueuedMatchContent(content: string): string {
  const marker = '\n\n[truncated]';
  if (content.endsWith(marker)) return content.slice(0, -marker.length);
  return content.endsWith('…') ? content.slice(0, -1) : content;
}

function queuedMessageMatches(entry: QueuedUserMessage, matchContent: string): boolean {
  const normalized = normalizeQueuedMatchContent(matchContent);
  return (
    entry.matchContent === matchContent ||
    entry.content === matchContent ||
    entry.matchContent === normalized ||
    entry.content === normalized ||
    entry.matchContent.startsWith(normalized) ||
    normalized.startsWith(`${entry.matchContent}\n\n`) ||
    normalized.startsWith(`${entry.content}\n\n`)
  );
}

function promoteQueuedUserMessageForPrompt(
  state: AppState,
  sessionId: string,
  queueMode: QueuedUserMessage['queueMode'],
  matchContent: string,
  queueId?: string,
  identity?: StrongUserTurnIdentity,
): Partial<AppState> {
  const queued = state.queuedUserMessagesBySession[sessionId] ?? [];
  const queueIdIndex =
    queueId === undefined
      ? -1
      : queued.findIndex((entry) => entry.queueMode === queueMode && entry.queueId === queueId);
  const idx =
    queueIdIndex !== -1
      ? queueIdIndex
      : queued.findIndex(
          (entry) =>
            entry.queueMode === queueMode &&
            (queueId === undefined || entry.queueId === undefined) &&
            queuedMessageMatches(entry, matchContent),
        );
  const userBucket = state.userMessagesBySession[sessionId] ?? [];
  const createPromotedUserMessage = (
    content: string,
    attachments?: readonly UserImageAttachment[],
    sourceQueuedLocalId?: string,
  ): UserMessage => ({
    ...createUserMessage(
      sessionId,
      content,
      nextUserMessageSentAtAfter(userBucket),
      identity,
      attachments,
    ),
    ...(queueId !== undefined ? { deliveryQueueId: queueId, deliveryQueueMode: queueMode } : {}),
    ...(sourceQueuedLocalId !== undefined ? { sourceQueuedLocalId } : {}),
  });

  if (idx === -1) {
    const normalized = normalizeQueuedMatchContent(matchContent);
    const alreadyRendered =
      identity !== undefined
        ? userBucket.some(
            (message) =>
              !message.restoredFromHistory &&
              message.turnId === identity.turnId &&
              message.turnUserOrdinal === identity.turnUserOrdinal,
          )
        : userBucket.some(
            (message) => message.content === matchContent || message.content === normalized,
          );
    if (alreadyRendered) return {};
    return {
      userMessagesBySession: {
        ...state.userMessagesBySession,
        [sessionId]: [...userBucket, createPromotedUserMessage(matchContent)],
      },
    };
  }

  const entry = queued[idx]!;
  const nextQueued = [...queued.slice(0, idx), ...queued.slice(idx + 1)];
  const alreadyLiveByIdentity =
    identity !== undefined &&
    userBucket.some(
      (message) =>
        !message.restoredFromHistory &&
        message.turnId === identity.turnId &&
        message.turnUserOrdinal === identity.turnUserOrdinal,
    );
  return {
    queuedUserMessagesBySession: {
      ...state.queuedUserMessagesBySession,
      [sessionId]: nextQueued,
    },
    userMessagesBySession: {
      ...state.userMessagesBySession,
      [sessionId]: alreadyLiveByIdentity
        ? userBucket
        : [...userBucket, createPromotedUserMessage(entry.content, entry.attachments, entry.id)],
    },
  };
}

function failQueuedUserMessageForPrompt(
  state: AppState,
  event: Extract<SessionEvent, { kind: 'queued_user_prompt_failed' }>,
): Partial<AppState> {
  const queued = state.queuedUserMessagesBySession[event.sessionId] ?? [];
  const queueIdIndex = queued.findIndex(
    (entry) => entry.queueMode === event.queueMode && entry.queueId === event.queueId,
  );
  const idx =
    queueIdIndex !== -1
      ? queueIdIndex
      : queued.findIndex(
          (entry) =>
            entry.queueMode === event.queueMode &&
            entry.queueId === undefined &&
            queuedMessageMatches(entry, event.content),
        );
  if (idx === -1) return {};

  const entry = queued[idx]!;
  if (
    entry.status === 'failed' &&
    entry.queueId === event.queueId &&
    entry.failureReason === event.reason
  ) {
    return {};
  }
  const nextQueued = queued.slice();
  nextQueued[idx] = {
    ...entry,
    queueId: event.queueId,
    status: 'failed',
    failureReason: event.reason,
  };
  return {
    queuedUserMessagesBySession: {
      ...state.queuedUserMessagesBySession,
      [event.sessionId]: nextQueued,
    },
  };
}

const initialMascotMode = readPersistedMascotMode();
const initialRuntimeProjectionState = createRuntimeProjectionState();

export const useAppStore = create<AppState>((set) => ({
  projects: [],
  licenseStatus: null,
  currentProjectPath: lsGet(LS_KEY_PROJECT),
  expandedProjects: readPersistedExpandedProjects(),
  sessions: [],
  currentSessionId: null,
  eventsBySession: {},
  errorSeenAtBySession: {},
  todoDriftDismissedAtBySession: {},
  todoDriftDismissedPendingCountBySession: {},
  transientArtifactsBySession: {},
  userMessagesBySession: {},
  queuedUserMessagesBySession: {},
  localNoticesBySession: {},
  workflowNoticesBySession: {},
  permissionQueue: [],
  askUserQueue: [],
  providers: [],
  defaultProviderId: null,
  keychainBackend: 'unknown',
  kodaxDefaults: null,
  runtimeDefaults: {},
  runtimeConnection: initialRuntimeProjectionState.connection,
  runtimeProfile: initialRuntimeProjectionState.profile,
  liveProjectionBySession: initialRuntimeProjectionState.liveBySession,
  runtimeSnapshotRequiredBySession: initialRuntimeProjectionState.snapshotRequiredBySession,
  runtimeSnapshotCursorBySession: {},
  workBudgetBySession: {},
  harnessProfileBySession: {},
  tokensBySession: {},
  sessionTokenUsageBySession: readPersistedSessionTokenUsage(),
  contextBudgetBySession: {},
  providerCacheDiagnosticBySession: {},
  todoListBySession: {},
  managedTaskStatusBySession: {},
  agentActorSnapshotBySession: {},
  workflowRuns: {},
  workflowActivityByRun: {},
  lastDiffPath: null,
  pendingToolPaths: {},
  pendingSendBySession: {},
  inputHistoryBySession: {},
  queueSnapshot: [],
  queueTotalSize: 0,
  notifications: [],
  requestedPopout: null,
  pendingProviderId: null,
  // 持久化用户上次手动选择的 mode — 不再"用一次就消费"，而是变成"下次开 session 的默认偏好"。
  // 用户在 Settings / picker 切的值落 localStorage；新 session 创建时如不显式给值就用这个。
  pendingReasoningMode: readPersistedReasoningMode(),
  pendingPermissionMode: readPersistedPermissionMode(),
  pendingAutoModeEngine: readPersistedAutoModeEngine(),
  pendingAgentMode: readPersistedAgentMode(),
  pendingModel: readPersistedModel(),
  sessionFlags: {},
  recentsFilter: DEFAULT_RECENTS_FILTER,
  theme:
    (typeof window !== 'undefined' &&
      (localStorage.getItem('kodax-space.theme') as 'dark' | 'light' | 'system' | null)) ||
    'dark',
  visualQuality: typeof window !== 'undefined' ? readVisualQuality() : 'balanced',
  transcriptView: 'normal',
  transcriptFontSize: 'base',
  // 默认关：右侧栏存在意义=KodaX 计划列表，没 plan 时空着没价值；plan 来时由 Shell
  // 的 useEffect (planLength transition) 自动开。'1' 才视作"用户主动开过"。
  // Task Dock starts closed; Shell opens it for explicit focus requests and task-relevant events.
  rightSidebarOpen: false,
  leftSidebarOpen: lsGet('kodax-space.leftSidebarOpen') !== '0', // 默认开，"0" 表示用户主动关过
  // 2026-06: 默认对齐 Codex 桌面端 — 左 260, 右 320。坏值（NaN / <100 / >800）退回默认。
  leftSidebarWidth: clampSidebarWidth(
    parseInt(lsGet('kodax-space.leftSidebarWidth') ?? '', 10),
    260,
  ),
  rightSidebarWidth: clampSidebarWidth(
    parseInt(lsGet('kodax-space.rightSidebarWidth') ?? '', 10),
    320,
  ),
  // v0.1.9 fix: Shell activePopout 镜像 (临时 UI state,不持久化)
  activePopoutKind: null,
  // KX-I-02: smart director 默认 off。"1" 表示用户主动开过。
  smartPopoutEnabled: readOptInBoolean(lsGet(LS_KEY_SMART_POPOUT)),
  mascotMode: initialMascotMode,
  mascotEnabled: initialMascotMode !== 'off',
  nativeCompletionNotificationsEnabled: readOptInBoolean(
    lsGet(LS_KEY_NATIVE_COMPLETION_NOTIFICATIONS),
  ),
  promotedPopoutsBySession: {},
  projectOrder: readPersistedProjectOrder(),
  archivedProjectsExpanded: lsGet('kodax-space.archivedProjectsExpanded') === '1',

  setProjects: (projects) => set({ projects }),

  setLicenseStatus: (licenseStatus) => set({ licenseStatus }),

  toggleProjectExpanded: (projectPath, currentDefault) =>
    set((state) => {
      const next = { ...state.expandedProjects };
      // 当前生效值 = 显式值（若有） else default。新值 = 反过来。
      const effective = projectPath in next ? next[projectPath] : currentDefault;
      const desired = !effective;
      // 优化：新值等于 default → 清掉显式记录，map 占地少 + 后续 default 变化时跟着走
      if (desired === currentDefault) {
        delete next[projectPath];
      } else {
        next[projectPath] = desired;
      }
      // 持久化 —— map 长度上限 256 防 LS 涨太大（不应到这种规模，纯防御）
      const keys = Object.keys(next);
      if (keys.length > 256) {
        const drop = keys.slice(0, keys.length - 256);
        for (const k of drop) delete next[k];
      }
      lsSet(LS_KEY_EXPANDED_PROJECTS, JSON.stringify(next));
      return { expandedProjects: next };
    }),
  setCurrentProject: (path) => {
    lsSet(LS_KEY_PROJECT, path);
    set((state) => {
      if (path === null) {
        return { currentProjectPath: null, currentSessionId: null };
      }
      const nextCanon = canonProjectRootShared(path, IS_WIN_RENDERER);
      const currentCanon = state.currentProjectPath
        ? canonProjectRootShared(state.currentProjectPath, IS_WIN_RENDERER)
        : null;
      if (currentCanon === nextCanon) return { currentProjectPath: path };

      return {
        currentProjectPath: path,
        currentSessionId: null,
        lastDiffPath: null,
        pendingToolPaths: {},
      };
    });
  },
  setSessions: (sessions) => set({ sessions }),
  replaceSessionsForScope: (sessions, scope) =>
    set((state) => ({
      sessions: replaceSessionsInScope(state.sessions, sessions, scope, IS_WIN_RENDERER),
    })),
  setCurrentSession: (sessionId) =>
    set((state) => {
      // v0.1.9 fix: 切 session 时同步把 currentProjectPath 调到该 session 的 projectRoot。
      // 否则 ChangesSection / WorkingFolderSection / ChipBar / BottomBar 在多项目 sidebar
      // 下"用户从 KodaX 项目点 KodaX-Space 的 session" 时仍指着 KodaX,显示错的 git changes /
      // 错的发送目录。
      // sessionId=null → 回 dashboard,不动 currentProjectPath (用户还能继续看当前项目)。
      if (sessionId === null) return { currentSessionId: null };
      const readFlags = setSessionFlagValue(state.sessionFlags, sessionId, 'unread', false);
      const found = state.sessions.find((s) => s.sessionId === sessionId);
      // 查看即确认：记下当前事件长度，让已看过的 error 状态点熄灭（新 error 会再亮）。
      const patch = {
        ...(readFlags === state.sessionFlags ? {} : { sessionFlags: readFlags }),
        errorSeenAtBySession: {
          ...state.errorSeenAtBySession,
          [sessionId]: state.eventsBySession[sessionId]?.length ?? 0,
        },
      };
      if (!found || !found.projectRoot) return { currentSessionId: sessionId, ...patch };
      const targetCanon = canonProjectRootShared(found.projectRoot, IS_WIN_RENDERER);
      const currentCanon = state.currentProjectPath
        ? canonProjectRootShared(state.currentProjectPath, IS_WIN_RENDERER)
        : null;
      if (targetCanon === currentCanon) return { currentSessionId: sessionId, ...patch };
      // 跟 setCurrentProject 同款 LS 持久化 — 重启后 sidebar 仍在该项目
      lsSet(LS_KEY_PROJECT, found.projectRoot);
      return {
        currentSessionId: sessionId,
        currentProjectPath: found.projectRoot,
        ...patch,
      };
    }),

  appendUserMessage: (sessionId, content, sentAt, attachments) => {
    let messageId: string | null = null;
    set((state) => {
      if (!state.sessions.some((s) => s.sessionId === sessionId)) return state;
      const bucket = state.userMessagesBySession[sessionId] ?? [];
      const msg = createUserMessage(sessionId, content, sentAt, undefined, attachments);
      messageId = msg.id;
      return {
        userMessagesBySession: {
          ...state.userMessagesBySession,
          [sessionId]: [...bucket, msg],
        },
      };
    });
    return messageId;
  },

  updateUserMessageAttachments: (sessionId, messageId, attachments) =>
    set((state) => {
      const bucket = state.userMessagesBySession[sessionId];
      if (!bucket) return state;
      const messageIndex = bucket.findIndex((message) => message.id === messageId);
      if (messageIndex === -1) return state;
      const current = bucket[messageIndex]!;
      const previousAttachments = current.attachments ?? [];
      const nextAttachments = attachments.map((attachment, index) => {
        const previousLabel = previousAttachments[index]?.label;
        return attachment.label === undefined && previousLabel !== undefined
          ? { ...attachment, label: previousLabel }
          : attachment;
      });
      const nextBucket = bucket.slice();
      nextBucket[messageIndex] = {
        ...current,
        attachments: nextAttachments,
      };
      return {
        userMessagesBySession: {
          ...state.userMessagesBySession,
          [sessionId]: nextBucket,
        },
      };
    }),

  appendLocalNotice: (sessionId, content, options) => {
    let persistedNotice: LocalNoticeMessage | null = null;
    set((state) => {
      if (!state.sessions.some((s) => s.sessionId === sessionId)) return state;
      const bucket = state.localNoticesBySession[sessionId] ?? [];
      const msg = createLocalNotice(content, options);
      persistedNotice = msg;
      return {
        localNoticesBySession: {
          ...state.localNoticesBySession,
          [sessionId]: mergeLocalNotices(bucket, [msg]),
        },
      };
    });
    if (persistedNotice !== null) persistLocalNoticeAppend(sessionId, persistedNotice);
  },

  appendQueuedUserMessage: (sessionId, input) => {
    const localId = `qu_${sessionId}_${++queuedUserMessageCounter}`;
    let appended = false;
    set((state) => {
      if (!state.sessions.some((s) => s.sessionId === sessionId)) return state;
      appended = true;
      const bucket = state.queuedUserMessagesBySession[sessionId] ?? [];
      const msg: QueuedUserMessage = {
        id: localId,
        content: input.content,
        matchContent: input.matchContent ?? input.content,
        ...(input.attachments && input.attachments.length > 0
          ? { attachments: input.attachments }
          : {}),
        queueMode: input.queueMode,
        status: 'pending-ack',
        sentAt: input.sentAt ?? Date.now(),
      };
      return {
        queuedUserMessagesBySession: {
          ...state.queuedUserMessagesBySession,
          [sessionId]: [...bucket, msg],
        },
      };
    });
    return appended ? localId : null;
  },

  updateQueuedUserMessageAttachments: (sessionId, localId, attachments) =>
    set((state) => {
      const bucket = state.queuedUserMessagesBySession[sessionId];
      let changed = false;
      const mergeAttachments = (
        previousAttachments: readonly UserImageAttachment[] | undefined,
      ): readonly UserImageAttachment[] =>
        attachments.map((attachment, index) => {
          const previousLabel = previousAttachments?.[index]?.label;
          return attachment.label === undefined && previousLabel !== undefined
            ? { ...attachment, label: previousLabel }
            : attachment;
        });
      const nextBucket = (bucket ?? []).map((entry) => {
        if (entry.id !== localId) return entry;
        changed = true;
        return {
          ...entry,
          attachments: mergeAttachments(entry.attachments),
        };
      });
      const userBucket = state.userMessagesBySession[sessionId] ?? [];
      const nextUserBucket = userBucket.map((message) => {
        if (message.sourceQueuedLocalId !== localId) return message;
        changed = true;
        return {
          ...message,
          attachments: mergeAttachments(message.attachments),
        };
      });
      if (!changed) return state;
      return {
        queuedUserMessagesBySession: {
          ...state.queuedUserMessagesBySession,
          [sessionId]: nextBucket,
        },
        userMessagesBySession: {
          ...state.userMessagesBySession,
          [sessionId]: nextUserBucket,
        },
      };
    }),

  markQueuedUserMessageAccepted: (sessionId, localId, queueId, queueMode) =>
    set((state) => {
      const bucket = state.queuedUserMessagesBySession[sessionId];
      if (!bucket) return state;
      let changed = false;
      const nextBucket = bucket.map((entry) => {
        if (entry.id !== localId) return entry;
        changed = true;
        return {
          ...entry,
          ...(queueId !== undefined ? { queueId } : {}),
          ...(queueMode !== undefined ? { queueMode } : {}),
          status: entry.status === 'failed' ? ('failed' as const) : ('queued' as const),
        };
      });
      if (!changed) return state;
      return {
        queuedUserMessagesBySession: {
          ...state.queuedUserMessagesBySession,
          [sessionId]: nextBucket,
        },
      };
    }),

  removeQueuedUserMessage: (sessionId, localId) =>
    set((state) => {
      const bucket = state.queuedUserMessagesBySession[sessionId];
      if (!bucket) return state;
      const nextBucket = bucket.filter((entry) => entry.id !== localId);
      if (nextBucket.length === bucket.length) return state;
      return {
        queuedUserMessagesBySession: {
          ...state.queuedUserMessagesBySession,
          [sessionId]: nextBucket,
        },
      };
    }),

  promoteQueuedUserMessage: (sessionId, localId, sentAt) =>
    set((state) => {
      const bucket = state.queuedUserMessagesBySession[sessionId];
      if (!bucket) return state;
      const idx = bucket.findIndex((entry) => entry.id === localId);
      if (idx === -1) return state;
      const entry = bucket[idx]!;
      const userBucket = state.userMessagesBySession[sessionId] ?? [];
      return {
        queuedUserMessagesBySession: {
          ...state.queuedUserMessagesBySession,
          [sessionId]: [...bucket.slice(0, idx), ...bucket.slice(idx + 1)],
        },
        userMessagesBySession: {
          ...state.userMessagesBySession,
          [sessionId]: [
            ...userBucket,
            {
              ...createUserMessage(sessionId, entry.content, sentAt, undefined, entry.attachments),
              sourceQueuedLocalId: localId,
            },
          ],
        },
      };
    }),

  convertLastUserMessageToQueued: (sessionId, userContent, input) => {
    let localId: string | null = null;
    set((state) => {
      if (!state.sessions.some((s) => s.sessionId === sessionId)) return state;
      const userBucket = state.userMessagesBySession[sessionId];
      if (!userBucket || userBucket.length === 0) return state;
      const last = userBucket[userBucket.length - 1];
      if (!last || last.content !== userContent) return state;

      localId = `qu_${sessionId}_${++queuedUserMessageCounter}`;
      const queuedBucket = state.queuedUserMessagesBySession[sessionId] ?? [];
      const queued: QueuedUserMessage = {
        id: localId,
        content: input.content,
        matchContent: input.matchContent ?? input.content,
        ...(last.attachments !== undefined ? { attachments: last.attachments } : {}),
        queueMode: input.queueMode,
        status: 'queued',
        sentAt: input.sentAt ?? last.sentAt,
      };
      return {
        userMessagesBySession: {
          ...state.userMessagesBySession,
          [sessionId]: userBucket.slice(0, -1),
        },
        queuedUserMessagesBySession: {
          ...state.queuedUserMessagesBySession,
          [sessionId]: [...queuedBucket, queued],
        },
      };
    });
    return localId;
  },

  appendWorkflowNotice: (sessionId, content, sentAt, key) =>
    set((state) => {
      const knownSession = state.sessions.some((s) => s.sessionId === sessionId);
      const knownWorkflowSession = Object.values(state.workflowRuns).some(
        (run) => run.sessionId === sessionId,
      );
      if (!knownSession && state.currentSessionId !== sessionId && !knownWorkflowSession)
        return state;
      const bucket = state.workflowNoticesBySession[sessionId] ?? [];
      // Keyed notices are unique per logical workflow event (agent summary / run
      // finished). If one with the same key already exists, REPLACE its content in
      // place — keeping the original id + sentAt so it stays at its chronological
      // position — instead of appending a near-duplicate. This collapses an agent's
      // evolving summary (excerpt → result) to a single bubble and is idempotent under
      // event replay / restore / hot-reload. Keyless callers (activity digests,
      // optimistic slash notices) keep append-always semantics.
      if (key !== undefined) {
        const idx = bucket.findIndex((n) => n.key === key);
        if (idx !== -1) {
          if (bucket[idx]!.content === content) return state;
          const nextBucket = bucket.slice();
          nextBucket[idx] = { ...bucket[idx]!, content };
          return {
            workflowNoticesBySession: {
              ...state.workflowNoticesBySession,
              [sessionId]: nextBucket,
            },
          };
        }
      }
      const id = `wf_${sessionId}_${++workflowNoticeCounter}`;
      const msg: WorkflowNoticeMessage = {
        id,
        content,
        sentAt: sentAt ?? Date.now(),
        ...(key !== undefined ? { key } : {}),
      };
      return {
        workflowNoticesBySession: {
          ...state.workflowNoticesBySession,
          [sessionId]: [...bucket, msg],
        },
      };
    }),

  rollbackLastUserMessage: (sessionId, content) =>
    set((state) => {
      const bucket = state.userMessagesBySession[sessionId];
      if (!bucket || bucket.length === 0) return state;
      const last = bucket[bucket.length - 1];
      // content 匹配兜底防御：如果 last 的 content 不是我们刚 append 的那条
      // （理论上不可能 —— BottomBar busy 状态 + IPC await 期间不会有别的 user
      // message 进来；但磁盘 history restore 等罕见时序仍可能命中），就 noop。
      if (last.content !== content) return state;
      return {
        userMessagesBySession: {
          ...state.userMessagesBySession,
          [sessionId]: bucket.slice(0, -1),
        },
      };
    }),

  prependSessionHistory: (sessionId, items, fallbackSentAt) =>
    set((state) => {
      if (!state.sessions.some((s) => s.sessionId === sessionId)) return state;
      // 在 set callback 内构造 historical buckets,确保读到最新 currentBucket,避免 await 期
      // user 已经 append 了新消息后被覆盖。
      //
      // v0.1.x 全量回放: items 可能是 user / assistant / tool_call 交替序列。
      //   一个 turn = 一段从 user 到下一个 user 之前的 events; session_complete 在 turn 末尾插。
      //   composeMessages 按 session_complete 切段配对 user message ↔ events。
      const histMsgs: UserMessage[] = [];
      const histEvents: SessionEvent[] = [];
      const histLocalNotices: LocalNoticeMessage[] = [];
      let lastHistoricalUserSentAt = Number.NEGATIVE_INFINITY;
      const nextHistoricalUserSentAt = (candidateSentAt?: number): number => {
        const fallback =
          typeof fallbackSentAt === 'number' && Number.isFinite(fallbackSentAt)
            ? fallbackSentAt
            : Date.now();
        const base =
          typeof candidateSentAt === 'number' && Number.isFinite(candidateSentAt)
            ? candidateSentAt
            : fallback;
        const sentAt = Math.max(base, lastHistoricalUserSentAt + 1);
        lastHistoricalUserSentAt = sentAt;
        return sentAt;
      };
      // 用来跟踪"上一项是否为 user (turn 边界)"-- 在 user 到来前如果有 pending assistant
      // events 还没 session_complete,先 flush 一个 complete
      let assistantPendingComplete = false;
      let openUserWithoutAssistant = false;
      const flushTurnIfNeeded = (): void => {
        if (assistantPendingComplete) {
          histEvents.push({ kind: 'session_complete', sessionId });
          assistantPendingComplete = false;
          openUserWithoutAssistant = false;
        }
      };
      const flushEmptyTurnIfNeeded = (): void => {
        if (!assistantPendingComplete && openUserWithoutAssistant) {
          const lastIndex = histMsgs.length - 1;
          const last = histMsgs[lastIndex];
          if (last) {
            histMsgs[lastIndex] = { ...last, historyNoAssistantSegment: true };
          }
          openUserWithoutAssistant = false;
        }
      };
      const markTurnHasEvents = (): void => {
        assistantPendingComplete = true;
        openUserWithoutAssistant = false;
      };
      // composeMessages 按 userMessages 索引配对 events 段。如果 items 以 assistant
      // 或 tool_call 开头 (KodaX 偶尔会有 greeting / initiative turn 没有 user prompt),
      // 这些前置 events 会落到 tail 块,把后续真正 turn 的 (user, events) 配对全推错位。
      // 解决: 第一条非 user item 触发前如果 histMsgs 还空,先塞一条隐藏的历史锚点
      // (sentAt 用 fallback),让索引对齐，但不把内部锚点渲染成空白 user 气泡。
      const ensureLeadingHistoryAnchor = (): void => {
        if (histMsgs.length === 0) {
          const id = `u_${sessionId}_${++userMessageCounter}`;
          histMsgs.push({
            id,
            content: '',
            sentAt: nextHistoricalUserSentAt(fallbackSentAt),
            restoredFromHistory: true,
            hiddenHistoryAnchor: true,
          });
          openUserWithoutAssistant = true;
        }
      };
      for (const item of items) {
        if (item.kind === 'user') {
          if (assistantPendingComplete) flushTurnIfNeeded();
          else flushEmptyTurnIfNeeded();
          const id = `u_${sessionId}_${++userMessageCounter}`;
          // History pairing is transcript-order based, while composeMessages still sorts by
          // sentAt. SDK compaction/re-root and tool-result restores can collapse or backdate
          // historical timestamps, so normalize only restored user turns to keep sort order
          // equal to transcript order.
          histMsgs.push({
            id,
            content: item.content,
            sentAt: nextHistoricalUserSentAt(item.sentAt),
            restoredFromHistory: true,
            ...(item.attachments !== undefined ? { attachments: item.attachments } : {}),
            ...(item.turnId !== undefined ? { turnId: item.turnId } : {}),
            ...(item.turnUserOrdinal !== undefined
              ? { turnUserOrdinal: item.turnUserOrdinal }
              : {}),
          });
          openUserWithoutAssistant = true;
        } else if (item.kind === 'assistant') {
          ensureLeadingHistoryAnchor();
          const assistantSentAt =
            item.sentAt ?? histMsgs[histMsgs.length - 1]?.sentAt ?? fallbackSentAt;
          if (item.thinking !== undefined && item.thinking.length > 0) {
            histEvents.push({
              kind: 'thinking_delta',
              sessionId,
              text: item.thinking,
              sentAt: assistantSentAt,
            });
          }
          if (item.text.length > 0) {
            histEvents.push({
              kind: 'text_delta',
              sessionId,
              text: item.text,
              sentAt: assistantSentAt,
            });
          }
          markTurnHasEvents();
        } else if (item.kind === 'sidecar_message') {
          ensureLeadingHistoryAnchor();
          histEvents.push({
            kind: 'sidecar_message',
            sessionId,
            message: item.message,
          });
          markTurnHasEvents();
        } else if (item.kind === 'lineage_notice') {
          // #3 fix: fork/rewind 产生的 branch_summary / compaction 摘要——不是用户消息，
          // 路由到非 user 的 lineage_notice 事件，composeMessages 渲染成 system_notice
          // (variant='lineage')，不再显示成假的用户气泡。
          ensureLeadingHistoryAnchor();
          histEvents.push({
            kind: 'lineage_notice',
            sessionId,
            noticeKind: item.noticeKind,
            text: item.text,
          });
          if (
            item.noticeKind === 'compaction' &&
            item.tokensBefore !== undefined &&
            item.tokensAfter !== undefined
          ) {
            histEvents.push({
              kind: 'compact_stats',
              sessionId,
              tokensBefore: item.tokensBefore,
              tokensAfter: item.tokensAfter,
            });
          }
          markTurnHasEvents();
        } else if (item.kind === 'workflow_notice') {
          // Workflow 结果/失败提示条:SDK 把它作为 `<task-completed>` 合成消息存进 transcript,
          // session.history 识别后发这个 kind。路由成 workflow_notice 事件 → composeMessages
          // 原位渲染成 system_notice(variant='workflow'),不再走侧存储按 wall-clock 重排。
          ensureLeadingHistoryAnchor();
          histEvents.push({ kind: 'workflow_notice', sessionId, text: item.text });
          markTurnHasEvents();
        } else if (item.kind === 'local_notice') {
          histLocalNotices.push({
            id: item.id,
            content: item.content,
            sentAt: item.sentAt,
            ...(item.variant !== undefined ? { variant: item.variant } : {}),
          });
        } else {
          // tool_call: emit tool_start + (optional) tool_result。 result 缺失时 (history 损坏
          // 或 tool_use 没匹配上 tool_result) 仍 emit tool_start 让 UI 显示一张 "running" 卡片。
          ensureLeadingHistoryAnchor();
          histEvents.push({
            kind: 'tool_start',
            sessionId,
            toolId: item.toolId,
            toolName: item.toolName,
            ...(item.input ? { input: item.input } : {}),
          });
          if (item.result !== undefined) {
            histEvents.push({
              kind: 'tool_result',
              sessionId,
              toolId: item.toolId,
              toolName: item.toolName,
              content: item.result,
            });
          }
          markTurnHasEvents();
        }
      }
      // tail: 最后一项是 assistant/tool_call 时补一个 session_complete 让段闭合
      if (assistantPendingComplete) flushTurnIfNeeded();
      else flushEmptyTurnIfNeeded();
      const currentMsgs = state.userMessagesBySession[sessionId] ?? [];
      const currentEvents = state.eventsBySession[sessionId] ?? [];
      const currentLocalNotices = state.localNoticesBySession[sessionId] ?? [];
      const folded = foldStrongIdentityDuplicateTurns(
        [...histMsgs, ...currentMsgs],
        [...histEvents, ...currentEvents],
      );
      const combinedEvents = folded.events;
      const combinedMsgs = hideOpenStrongIdentityDuplicateProjection(
        folded.userMessages,
        combinedEvents,
      );
      let restoredTokenInfo = state.tokensBySession[sessionId];
      if (restoredTokenInfo === undefined) {
        const latestCompactStats = [...histEvents]
          .reverse()
          .find(
            (event): event is Extract<SessionEvent, { kind: 'compact_stats' }> =>
              event.kind === 'compact_stats' && event.contextKind !== 'child',
          );
        if (latestCompactStats) {
          restoredTokenInfo = tokenInfoFromCompaction(latestCompactStats);
        } else {
          let total = 0;
          for (const message of combinedMsgs) total += approxTokensForStats(message.content);
          for (const event of combinedEvents) {
            if (event.kind === 'text_delta' || event.kind === 'thinking_delta') {
              total += approxTokensForStats(event.text);
            } else if (event.kind === 'tool_result') {
              total += approxTokensForStats(event.content);
            }
          }
          if (total > 0) restoredTokenInfo = { tokens: total, source: 'estimate' };
        }
      }
      // v0.1.9 fix: 历史 events 已经发生过,director 不应该再"自动展开"那些信号触发的
      // popout (用户点已有 session 不该弹 worker/diff/plan popout)。 扫一遍 histEvents,
      // 提前 mark 该 session 已经"促发"过的 SmartPopoutKind,让 director 视为 already
      // promoted = 不触发。逻辑跟 popout-director/rules.ts decideAutoPromote 同构,
      // 但避免跨模块循环 import (store 不能 import rules.ts,rules.ts 已 import 不了 store)。
      const FILE_MUTATION_TOOLS = new Set([
        'write',
        'edit',
        'multi_edit',
        'str_replace',
        'insert_after_anchor',
      ]);
      const histPromoted = new Set<string>(state.promotedPopoutsBySession[sessionId] ?? []);
      for (const ev of histEvents) {
        if (ev.kind === 'tool_start' && FILE_MUTATION_TOOLS.has(ev.toolName))
          histPromoted.add('diff');
        else if (ev.kind === 'todo_update' && ev.items.length > 0) histPromoted.add('plan');
        else if (ev.kind === 'managed_task_status' && ev.status.activeWorkerId)
          histPromoted.add('tasks');
      }
      return {
        userMessagesBySession: {
          ...state.userMessagesBySession,
          // 历史前置——若 race 期 user 已 append 了 Q3,结果是 [hist..., Q3]
          [sessionId]: combinedMsgs,
        },
        eventsBySession: {
          ...state.eventsBySession,
          [sessionId]: combinedEvents,
        },
        localNoticesBySession: {
          ...state.localNoticesBySession,
          [sessionId]: mergeLocalNotices(histLocalNotices, currentLocalNotices),
        },
        transientArtifactsBySession: {
          ...state.transientArtifactsBySession,
          [sessionId]: collectTransientArtifactsFromEvents(combinedEvents),
        },
        ...(restoredTokenInfo
          ? {
              tokensBySession: {
                ...state.tokensBySession,
                [sessionId]: restoredTokenInfo,
              },
            }
          : {}),
        promotedPopoutsBySession: {
          ...state.promotedPopoutsBySession,
          [sessionId]: histPromoted,
        },
      };
    }),

  setQueueState: (snapshot, totalSize) =>
    set({ queueSnapshot: snapshot, queueTotalSize: totalSize }),

  requestPopout: (kind) => set({ requestedPopout: kind }),

  pushNotification: (notice) =>
    set((state) => {
      // dedupe: 同 id 已存在 → 不重弹 (避免每次 iteration_end 都重新插入 ctx-warn)
      if (state.notifications.some((n) => n.id === notice.id)) return state;
      // 上限 50 条防内存涨;新通知插前面,旧的挤出去
      const next = [notice, ...state.notifications].slice(0, 50);
      return { notifications: next };
    }),

  dismissNotification: (id) =>
    set((state) => {
      const notifications = state.notifications.filter((n) => n.id !== id);
      // #9 fix: dismiss 一条 todo-drift 提示时记下"轮次基线" + 当时的 pending 数——见
      // AppState.todoDriftDismissedAtBySession 注释。appendEvent 的 todo_drift_warning
      // 分支据此判断"同一轮未恶化"的重复事件要不要压下。
      if (!id.startsWith('todo-drift:')) return { notifications };
      const sessionId = id.slice('todo-drift:'.length);
      const pendingCount = (state.todoListBySession[sessionId] ?? []).filter(
        (item) => item.status === 'pending',
      ).length;
      return {
        notifications,
        todoDriftDismissedAtBySession: {
          ...state.todoDriftDismissedAtBySession,
          [sessionId]: state.userMessagesBySession[sessionId]?.length ?? 0,
        },
        todoDriftDismissedPendingCountBySession: {
          ...state.todoDriftDismissedPendingCountBySession,
          [sessionId]: pendingCount,
        },
      };
    }),

  // F060 Workflow Harness：push workflow.event → 覆盖式 upsert（每事件带全量 snapshot）。
  upsertWorkflowRun: (payload) =>
    set((state) => {
      const { snapshot, sessionId, surface, projectRoot } = payload;
      const eventMessage = payload.message?.trim();
      const run: WorkflowRunT = {
        ...snapshot,
        ...(eventMessage ? { latestMessage: eventMessage } : {}),
        ...(sessionId !== undefined ? { sessionId } : {}),
        ...(surface !== undefined ? { surface } : {}),
        ...(projectRoot !== undefined ? { projectRoot } : {}),
      };
      return { workflowRuns: capWorkflowRuns({ ...state.workflowRuns, [run.runId]: run }) };
    }),

  // F060：workflow.list 播种——覆盖式合并（已存在的 runId 用新值覆盖，保留其它）。
  seedWorkflowRuns: (runs) =>
    set((state) => {
      if (runs.length === 0) return state;
      // immutable：用 Object.fromEntries 构造增量，再一次性 spread（不原地 mutate 中间对象）。
      const additions = Object.fromEntries(runs.map((r) => [r.runId, r]));
      return { workflowRuns: capWorkflowRuns({ ...state.workflowRuns, ...additions }) };
    }),

  // F062：删除成功后从渲染层移除该 run（immutable：重建不含该 key 的对象），并清其活动流。
  removeWorkflowRun: (runId) =>
    set((state) => {
      if (!(runId in state.workflowRuns) && !(runId in state.workflowActivityByRun)) {
        return state;
      }
      const { [runId]: _removedRun, ...workflowRuns } = state.workflowRuns;
      const { [runId]: _removedActivity, ...workflowActivityByRun } = state.workflowActivityByRun;
      return { workflowRuns, workflowActivityByRun };
    }),

  // F065：子 agent 活动——按 runId 有界追加（每 run 最近 MAX_ACTIVITY_PER_RUN 条）。
  appendWorkflowActivity: (activity) =>
    set((state) => {
      const bucket = state.workflowActivityByRun[activity.runId] ?? [];
      const nextBucket = [...bucket, activity].slice(-MAX_ACTIVITY_PER_RUN);
      const next: Record<string, readonly WorkflowActivityPayload[]> = {
        ...state.workflowActivityByRun,
        [activity.runId]: nextBucket,
      };
      // 上限 run 数（与 workflowRuns 对齐），按插入序淘汰最旧的（immutable 构造）。
      const keys = Object.keys(next);
      if (keys.length > MAX_WORKFLOW_RUNS) {
        return {
          workflowActivityByRun: Object.fromEntries(
            keys.slice(keys.length - MAX_WORKFLOW_RUNS).map((k) => [k, next[k]!]),
          ),
        };
      }
      return { workflowActivityByRun: next };
    }),

  appendEvent: (event) =>
    set((state) => {
      // 切项目 / 删除 session 后，旧 session 的迟到事件仍会通过同一 push channel 到达。
      // 如果 renderer 没有这条 session 的记录就 drop——否则会累积无人引用的 bucket。
      // main 端事件是权威；renderer 只缓存自己 UI 里能见到的部分。
      if (
        !state.sessions.some((s) => s.sessionId === event.sessionId) &&
        state.currentSessionId !== event.sessionId
      ) {
        return state;
      }
      const currentUsers = state.userMessagesBySession[event.sessionId] ?? [];
      if (
        (event.kind === 'mid_turn_user_prompt' || event.kind === 'queued_user_prompt_started') &&
        event.queueId !== undefined
      ) {
        const deliveryQueueMode =
          event.kind === 'mid_turn_user_prompt' ? 'interrupt' : event.queueMode;
        if (
          currentUsers.some(
            (message) =>
              message.deliveryQueueId === event.queueId &&
              message.deliveryQueueMode === deliveryQueueMode,
          )
        ) {
          // Reconnect/replay may redeliver an already-consumed Runtime input. Drop the entire
          // boundary event: suppressing only the user bubble would still shift every later event
          // segment to the next visible prompt.
          return state;
        }
      }
      const bucket = state.eventsBySession[event.sessionId] ?? [];
      if (snapshotCoversRuntimeDraftEvent(state, event)) return state;
      const storedEvent = stampLiveStreamEvent(event);
      if (event.kind === 'session_error' && event.error === 'cancelled') {
        // 乐观取消(BottomBar handleCancel)与 main 端真实 cancelled 去重,防同一次取消显示两条。
        // 倒序回溯到本 turn 起点(session_start)为止;命中已存在的 cancelled 即判定重复 drop。
        //
        // 已知边界 (review MEDIUM-2(b)):序列 `cancelled,session_start,cancelled` 有二义——
        // 既可能是"取消→重发→再取消"两次独立取消(都要保留,见 app-store-cancel-event 测试),
        // 也可能是"乐观 cancelled→重发→main 迟到 cancelled"同一次取消(该去重)。两者事件结构
        // 完全相同,纯位置扫描无法区分,故此处**保留** session_start 边界(优先不误删合法的两次
        // 独立取消)。彻底根治需给事件唯一序号 / 乐观标记,属独立 feature,不在本修复范围。
        for (let i = bucket.length - 1; i >= 0; i--) {
          const previous = bucket[i];
          if (!previous) continue;
          if (previous.kind === 'session_start') break;
          if (previous.kind === 'session_error' && previous.error === 'cancelled') return state;
        }
      }
      const appendedEvents = appendSessionEvent(bucket, storedEvent);
      const lifecycleBoundUsers =
        event.kind === 'session_start' && event.turnId !== undefined
          ? bindInitialLiveUserTurnIdentity(currentUsers, event.turnId)
          : currentUsers;
      const next: Partial<AppState> = {
        eventsBySession: {
          ...state.eventsBySession,
          [event.sessionId]: appendedEvents,
        },
        ...(lifecycleBoundUsers !== currentUsers
          ? {
              userMessagesBySession: {
                ...state.userMessagesBySession,
                [event.sessionId]: lifecycleBoundUsers,
              },
            }
          : {}),
        lastEvent: storedEvent,
      };
      // 只在"运行真正开始/结束"的生命周期事件到达时才清 pendingSend，把 spinner 交给 event-driven 状态。
      // ⚠️ 不能"任一事件到达就清"：repo-intelligence（repointel_trace）/ managed_task_status 等**非生命周期**
      // 事件可能先于 session_start 到达；若此时就清了 pendingSend，而 snapshotFromEvents 又只把
      // session_start / queued_user_prompt_started 当 streaming，spinner 会在 session_start 到达前整段消失
      // ——用户看到 query 气泡却没有任何"正在做什么"指示（新会话首个 query 期间 repo 分析最久，尤其明显）。
      // 这里的生命周期 kind 必须与 ActivitySpinner.snapshotFromEvents 认的那组保持一致。
      const clearsPendingSend =
        event.kind === 'session_start' ||
        event.kind === 'queued_user_prompt_started' ||
        event.kind === 'session_complete' ||
        event.kind === 'session_error';
      if (clearsPendingSend && state.pendingSendBySession[event.sessionId]) {
        const { [event.sessionId]: _drop, ...restPending } = state.pendingSendBySession;
        next.pendingSendBySession = restPending;
      }
      if (event.kind === 'mid_turn_user_prompt') {
        const currentPromptUsers =
          next.userMessagesBySession?.[event.sessionId] ??
          state.userMessagesBySession[event.sessionId] ??
          [];
        const userMessages = alignSegmentOwnersBeforePrompt(
          event.sessionId,
          currentPromptUsers,
          appendedEvents,
          appendedEvents.length - 1,
        );
        const identity =
          event.turnId !== undefined
            ? {
                turnId: event.turnId,
                turnUserOrdinal:
                  event.turnUserOrdinal ?? resolveLiveUserOrdinal(userMessages, event.turnId),
              }
            : undefined;
        const promotionState =
          userMessages === state.userMessagesBySession[event.sessionId]
            ? state
            : ({
                ...state,
                userMessagesBySession: {
                  ...state.userMessagesBySession,
                  [event.sessionId]: userMessages,
                },
              } as AppState);
        Object.assign(
          next,
          promoteQueuedUserMessageForPrompt(
            promotionState,
            event.sessionId,
            'interrupt',
            event.content,
            event.queueId,
            identity,
          ),
        );
      } else if (event.kind === 'queued_user_prompt_started') {
        const currentPromptUsers =
          next.userMessagesBySession?.[event.sessionId] ??
          state.userMessagesBySession[event.sessionId] ??
          [];
        const userMessages = alignSegmentOwnersBeforePrompt(
          event.sessionId,
          currentPromptUsers,
          appendedEvents,
          appendedEvents.length - 1,
        );
        const identity =
          event.turnId !== undefined
            ? {
                turnId: event.turnId,
                turnUserOrdinal:
                  event.turnUserOrdinal ?? resolveLiveUserOrdinal(userMessages, event.turnId),
              }
            : undefined;
        const promotionState =
          userMessages === state.userMessagesBySession[event.sessionId]
            ? state
            : ({
                ...state,
                userMessagesBySession: {
                  ...state.userMessagesBySession,
                  [event.sessionId]: userMessages,
                },
              } as AppState);
        Object.assign(
          next,
          promoteQueuedUserMessageForPrompt(
            promotionState,
            event.sessionId,
            event.queueMode,
            event.content,
            event.queueId,
            identity,
          ),
        );
      } else if (event.kind === 'queued_user_prompt_failed') {
        Object.assign(next, failQueuedUserMessageForPrompt(state, event));
      } else if (event.kind === 'session_error' && event.error === 'cancelled') {
        const queued = state.queuedUserMessagesBySession[event.sessionId];
        if (queued && queued.length > 0) {
          const retained = queued.filter((entry) => entry.status === 'failed');
          next.queuedUserMessagesBySession = {
            ...state.queuedUserMessagesBySession,
            [event.sessionId]: retained,
          };
        }
      }
      if (
        event.kind === 'session_start' ||
        event.kind === 'mid_turn_user_prompt' ||
        event.kind === 'queued_user_prompt_started' ||
        event.kind === 'session_complete' ||
        event.kind === 'session_error'
      ) {
        const candidateUsers =
          next.userMessagesBySession?.[event.sessionId] ??
          state.userMessagesBySession[event.sessionId] ??
          [];
        const folded = foldStrongIdentityDuplicateTurns(candidateUsers, appendedEvents);
        const reconciledUsers = hideOpenStrongIdentityDuplicateProjection(
          folded.userMessages,
          folded.events,
        );
        if (folded.events !== appendedEvents) {
          next.eventsBySession = {
            ...state.eventsBySession,
            [event.sessionId]: folded.events,
          };
          next.transientArtifactsBySession = {
            ...state.transientArtifactsBySession,
            [event.sessionId]: collectTransientArtifactsFromEvents(folded.events),
          };
        }
        if (reconciledUsers !== candidateUsers) {
          next.userMessagesBySession = {
            ...state.userMessagesBySession,
            [event.sessionId]: reconciledUsers,
          };
        }
      }
      // F008: 同步抽取 work_budget / harness_profile 到 derived maps
      // —— 视图不必每次 scan 整条 bucket
      if (event.kind === 'iteration_end') {
        if (event.contextKind !== 'child') {
          // Context window belongs to the root Agent only. Child context sizes must never
          // overwrite the gauge, even though their Provider usage contributes to session cost.
          const current = state.tokensBySession[event.sessionId];
          if (acceptsRootContextUpdate(current, event.contextId, event.contextRevision)) {
            next.tokensBySession = {
              ...state.tokensBySession,
              [event.sessionId]: {
                tokens: event.tokenCount,
                source: 'iteration_end',
                ...(event.tokenSource !== undefined ? { tokenSource: event.tokenSource } : {}),
                ...(event.contextId ? { observedOrder: nextRootContextReadingOrder() } : {}),
                ...(event.contextId ? { contextId: event.contextId } : {}),
                ...(event.contextRevision !== undefined
                  ? { contextRevision: event.contextRevision }
                  : {}),
                ...(current?.lastCompaction ? { lastCompaction: current.lastCompaction } : {}),
              },
            };
          }
        }

        // KodaX 0.7.77 diagnostics are emitted before iteration_end and cover physical calls
        // that have no iteration summary (child/retry/fallback/repair/compaction helpers).
        // Keep iteration_end only as the compatibility source until diagnostics activate.
        const currentUsage = state.sessionTokenUsageBySession[event.sessionId];
        if (event.usage && currentUsage?.accountingSource !== 'provider_diagnostic') {
          const accumulated = accumulateSessionTokenUsage(
            currentUsage,
            event.usage,
            event.contextKind === 'child',
            { source: 'iteration' },
          );
          if (accumulated) {
            const usageBySession = {
              ...state.sessionTokenUsageBySession,
              [event.sessionId]: accumulated,
            };
            next.sessionTokenUsageBySession = usageBySession;
            persistSessionTokenUsage(usageBySession);
          }
        }
      } else if (event.kind === 'context_budget_snapshot' && event.contextKind !== 'child') {
        next.contextBudgetBySession = {
          ...state.contextBudgetBySession,
          [event.sessionId]: {
            ...event,
            ...(event.contextId ? { observedOrder: nextRootContextReadingOrder() } : {}),
          },
        };
      } else if (event.kind === 'provider_cache_diagnostic') {
        const accumulated = accumulateSessionTokenUsage(
          state.sessionTokenUsageBySession[event.sessionId],
          event,
          event.contextKind === 'child',
          {
            source: 'provider_diagnostic',
            requestId: event.requestId,
            countWhenUsageMissing: true,
          },
        );
        if (accumulated !== state.sessionTokenUsageBySession[event.sessionId]) {
          const usageBySession = {
            ...state.sessionTokenUsageBySession,
            [event.sessionId]: accumulated,
          };
          next.sessionTokenUsageBySession = usageBySession;
          persistSessionTokenUsage(usageBySession);
        }
        if (event.contextKind !== 'child') {
          next.providerCacheDiagnosticBySession = {
            ...state.providerCacheDiagnosticBySession,
            [event.sessionId]: event,
          };
        }
      } else if (event.kind === 'compact_stats' && event.contextKind !== 'child') {
        // Compaction changes the active model context without deleting visible scrollback.
        // Keep the authoritative post-compaction value separate from transcript history.
        const current = state.tokensBySession[event.sessionId];
        const contextRevision = event.afterRevision ?? event.contextRevision;
        // A revision-less compact_stats event is only safe to apply over a
        // revisioned reading when it explicitly confirms both commitment and
        // ownership of the current root context. Legacy events that omit
        // either signal may be stale and must not roll the gauge backwards.
        const compatibleCommittedCompaction =
          event.committed === true &&
          contextRevision === undefined &&
          current?.contextRevision !== undefined &&
          event.contextId !== undefined &&
          current.contextId !== undefined &&
          current.contextId === event.contextId;
        if (
          compatibleCommittedCompaction ||
          acceptsRootContextUpdate(current, event.contextId, contextRevision)
        ) {
          next.tokensBySession = {
            ...state.tokensBySession,
            [event.sessionId]: {
              ...tokenInfoFromCompaction(event),
              ...(compatibleCommittedCompaction && current?.contextId
                ? { contextId: current.contextId }
                : {}),
              ...(compatibleCommittedCompaction && current?.contextRevision !== undefined
                ? { contextRevision: current.contextRevision }
                : {}),
            },
          };
          if (event.committed !== false && state.contextBudgetBySession[event.sessionId]) {
            const { [event.sessionId]: _staleBudget, ...remainingBudgets } =
              state.contextBudgetBySession;
            next.contextBudgetBySession = remainingBudgets;
          }
        }
      } else if (event.kind === 'session_complete') {
        if (!isSessionVisiblyOpen(state, event.sessionId)) {
          const unreadFlags = setSessionFlagValue(
            next.sessionFlags ?? state.sessionFlags,
            event.sessionId,
            'unread',
            true,
          );
          if (unreadFlags !== state.sessionFlags) next.sessionFlags = unreadFlags;
        }
        // History restore 的 terminal — 若到此还没有 iteration_end 写入 tokensBySession，
        // 从已有 buffer 累加一次给 dashboard 用。只算一次（已有真实 tokens 时不覆盖）。
        const existing = state.tokensBySession[event.sessionId];
        const terminalUsers =
          next.userMessagesBySession?.[event.sessionId] ??
          state.userMessagesBySession[event.sessionId] ??
          [];
        const terminalEvents = next.eventsBySession?.[event.sessionId] ?? appendedEvents;
        const foldedHistoryBoundary = terminalEvents !== appendedEvents;
        if (existing === undefined || (foldedHistoryBoundary && existing.source === 'estimate')) {
          // Count the reconciled buffers. In the history-first race the pre-terminal state
          // temporarily contains both copies; counting `state`/`bucket` would double the
          // estimate even though this terminal atomically folds the duplicate boundary.
          let total = 0;
          for (const um of terminalUsers) total += approxTokensForStats(um.content);
          for (const ev of terminalEvents) {
            if (ev.kind === 'text_delta' || ev.kind === 'thinking_delta') {
              total += approxTokensForStats(ev.text);
            } else if (ev.kind === 'tool_result') {
              total += approxTokensForStats(ev.content);
            }
          }
          if (total > 0) {
            next.tokensBySession = {
              ...state.tokensBySession,
              [event.sessionId]: { tokens: total, source: 'estimate' },
            };
          }
        }
        // #4 fix: run 结束时清掉 managed_task_status 快照——否则 AMA strip / BackgroundTaskBar /
        // Workers popout 会一直把这个已完成的 run 当作 still-active 展示(快照从来没被清过,
        // 一直停在最后一次收到的 status)。AmaWorkStrip / WorkersSection / TasksPanel 在
        // snapshot 为 undefined 时已经渲染空闲态,直接删掉这个 key 即可。
        if (state.managedTaskStatusBySession[event.sessionId] !== undefined) {
          const { [event.sessionId]: _droppedMtsComplete, ...restMtsComplete } =
            state.managedTaskStatusBySession;
          next.managedTaskStatusBySession = restMtsComplete;
        }
      } else if (event.kind === 'session_error') {
        // #4 fix: 同 session_complete——出错终止时也清掉 managed_task_status 快照,不让已经
        // 结束(哪怕是异常结束)的 run 一直显示成活跃状态。
        if (state.managedTaskStatusBySession[event.sessionId] !== undefined) {
          const { [event.sessionId]: _droppedMtsError, ...restMtsError } =
            state.managedTaskStatusBySession;
          next.managedTaskStatusBySession = restMtsError;
        }
      } else if (event.kind === 'work_budget') {
        next.workBudgetBySession = {
          ...state.workBudgetBySession,
          [event.sessionId]: { used: event.used, cap: event.cap },
        };
      } else if (event.kind === 'harness_profile') {
        next.harnessProfileBySession = {
          ...state.harnessProfileBySession,
          [event.sessionId]: { profile: event.profile, round: event.round },
        };
      } else if (event.kind === 'todo_update') {
        // alpha.1: 全量替换；空列表表示 cleared
        next.todoListBySession = {
          ...state.todoListBySession,
          [event.sessionId]: event.items,
        };
      } else if (event.kind === 'managed_task_status') {
        // alpha.1: 直接覆盖最新值。同时派生 legacy work_budget / harness_profile
        // 以便老 TasksPanel/Tabs 仍能渲染。
        //
        // #4 fix: SDK 有时会在收尾时先推一条 phase==='completed' 的 managed_task_status
        // 快照,再推 session_complete/session_error。若原样存下这条"completed"快照,
        // 两条事件之间会有一帧 UI 显示"看起来还在跑但 phase=completed"的过渡怪状态。
        // 这里直接不存 completed 快照(等同于清空),让下游的空闲态立即生效,不必等
        // session_complete 分支来清。
        if (event.status.phase === 'completed') {
          if (state.managedTaskStatusBySession[event.sessionId] !== undefined) {
            const { [event.sessionId]: _droppedMtsPhase, ...restMtsPhase } =
              state.managedTaskStatusBySession;
            next.managedTaskStatusBySession = restMtsPhase;
          }
        } else {
          const previousStatus = state.managedTaskStatusBySession[event.sessionId];
          next.managedTaskStatusBySession = {
            ...state.managedTaskStatusBySession,
            [event.sessionId]: mergeManagedTaskStatus(previousStatus, event.status),
          };
        }
        const ws = event.status;
        if (ws.budgetUsage !== undefined && ws.globalWorkBudget !== undefined) {
          next.workBudgetBySession = {
            ...state.workBudgetBySession,
            [event.sessionId]: { used: ws.budgetUsage, cap: ws.globalWorkBudget },
          };
        }
        // KodaX harnessProfile 是字符串（KodaXHarnessProfile）；老 enum 限 H0/H1/H2。
        // 已知映射：'H0_DIRECT' / 'H1_EXECUTE_EVAL' / 'H2_PLAN_EXECUTE_EVAL' 字面量直接通过；
        // 其他 KodaX 自定义 profile 留 undefined（保留旧值，避免抖动）。
        const profile = ws.harnessProfile;
        if (
          profile === 'H0_DIRECT' ||
          profile === 'H1_EXECUTE_EVAL' ||
          profile === 'H2_PLAN_EXECUTE_EVAL'
        ) {
          next.harnessProfileBySession = {
            ...state.harnessProfileBySession,
            [event.sessionId]: { profile, round: ws.currentRound },
          };
        }
      } else if (event.kind === 'todo_drift_warning') {
        const driftNoticeId = `todo-drift:${event.sessionId}`;
        const legacyDriftNoticePrefix = `${driftNoticeId}:`;
        const notificationsWithoutLegacyDrift = (next.notifications ?? state.notifications).filter(
          (notice) => !notice.id.startsWith(legacyDriftNoticePrefix),
        );
        // #9 fix: 用户关掉这条提示后，SDK 同一轮里常因为同样的"todo 没标 in-progress"状态
        // 反复再推 todo_drift_warning（每次工具调用都可能触发一次）——之前的实现里 dismiss
        // 只是从 notifications 数组删掉，下一条同 id 事件一来 pushNotificationLocal 找不到
        // 旧 id 就当"新通知"塞回去，等于用户点了关闭却立刻弹回来。这里按"同一轮 + 没有明显
        // 恶化"压下重复事件；开始新一轮（用户发了新消息）或 pendingCount 涨了则照常弹出，
        // 并清掉过期的 dismiss 标记（下次再关闭会用新的基线重新武装抑制）。
        const dismissedTurn = state.todoDriftDismissedAtBySession[event.sessionId];
        const dismissedPendingCount =
          state.todoDriftDismissedPendingCountBySession[event.sessionId];
        const currentTurn =
          (next.userMessagesBySession ?? state.userMessagesBySession)[event.sessionId]?.length ?? 0;
        const sameTurn = dismissedTurn !== undefined && currentTurn <= dismissedTurn;
        const notEscalated =
          dismissedPendingCount !== undefined &&
          event.warning.pendingCount <= dismissedPendingCount;
        if (sameTurn && notEscalated) {
          next.notifications = notificationsWithoutLegacyDrift;
        } else {
          const subject = event.warning.firstPendingTodoSubject
            ? ` Pending item: "${event.warning.firstPendingTodoSubject.slice(0, 120)}".`
            : '';
          next.notifications = pushNotificationLocal(notificationsWithoutLegacyDrift, {
            id: driftNoticeId,
            severity: 'info',
            text:
              `Todo list drift detected while running ${event.warning.toolName}: ` +
              `${event.warning.pendingCount} pending item(s), none marked in progress.` +
              `${subject} KodaX nudged the agent to update todos.`,
            sessionId: event.sessionId,
            createdAt: Date.now(),
            dismissOnOutsideInteraction: true,
          });
          if (dismissedTurn !== undefined || dismissedPendingCount !== undefined) {
            const { [event.sessionId]: _droppedDriftTurn, ...restDriftTurn } =
              state.todoDriftDismissedAtBySession;
            const { [event.sessionId]: _droppedDriftPending, ...restDriftPending } =
              state.todoDriftDismissedPendingCountBySession;
            next.todoDriftDismissedAtBySession = restDriftTurn;
            next.todoDriftDismissedPendingCountBySession = restDriftPending;
          }
        }
      } else if (event.kind === 'auto_engine_change') {
        // FEATURE_029: auto-mode engine 切换（user manual / denial threshold / circuit breaker
        // / bootstrap_failed）。更新 session.autoModeEngine 让 ModeSelector 立即反映；
        // 本地 store 不持久化，重启后 main 端 list 重新拉权威值。
        next.sessions = state.sessions.map((s) =>
          s.sessionId === event.sessionId ? { ...s, autoModeEngine: event.engine } : s,
        );
        // Non-manual fallback (denial_threshold / circuit_breaker / bootstrap_failed)
        // → 推一条持久通知。"manual" 是用户主动切换不弹。
        if (event.reason && event.reason !== 'manual') {
          // v0.1.4：bootstrap_failed 带 details 的话用 details 全文（含失败原因 + 排查指引）；
          // denial_threshold / circuit_breaker 沿用 reason→label 模板。
          let text: string;
          if (event.reason === 'bootstrap_failed') {
            text =
              event.details ?? `Auto-mode bootstrap failed; engine fell back to ${event.engine}.`;
          } else {
            const reasonLabel =
              event.reason === 'denial_threshold' ? 'denial threshold' : 'circuit breaker';
            text = `Auto-mode engine fell back to ${event.engine} (${reasonLabel}).`;
          }
          // 用 next.notifications ?? state.notifications 作输入: 防止未来其他分支也写
          // next.notifications 时本分支误覆盖。当前只有这一处写,fragile-defense (审查 L1)。
          next.notifications = pushNotificationLocal(next.notifications ?? state.notifications, {
            id: `auto-fallback:${event.sessionId}:${event.reason}`,
            severity: event.reason === 'bootstrap_failed' ? 'error' : 'warning',
            text,
            sessionId: event.sessionId,
            createdAt: Date.now(),
          });
        }
      } else if (event.kind === 'tool_start') {
        // F009：记 toolId → path 暂存；等 tool_result 来配对决定要不要 jump 到 diff
        // input.path 由 mock-session / real adapter 在 tool_start 时附上
        if (
          (event.toolName === 'write' || event.toolName === 'edit') &&
          event.input &&
          typeof event.input.path === 'string'
        ) {
          next.pendingToolPaths = {
            ...state.pendingToolPaths,
            [event.toolId]: event.input.path,
          };
        }
      } else if (event.kind === 'tool_result') {
        // F009：write/edit 完成 + tool_start 暂存了 path → 触发 FilePanel 跳 diff
        const pendingPath = state.pendingToolPaths[event.toolId];
        if (pendingPath && (event.toolName === 'write' || event.toolName === 'edit')) {
          next.lastDiffPath = pendingPath;
          // 同时清掉 pending（防止内存累积）
          const { [event.toolId]: _drop, ...restPending } = state.pendingToolPaths;
          next.pendingToolPaths = restPending;
        }
        // Derived transient-artifact table (see AppState.transientArtifactsBySession):
        // when a create_artifact tool completes, mint/merge its snapshot once, here,
        // rather than re-scanning the whole event log per streamed token in the view.
        // The matching tool_start (with input) is already in `bucket` — start always
        // precedes result — so we read it back (scanning from the end: it's recent).
        let artifactInput: Record<string, unknown> | undefined;
        let isArtifactResult = false;
        for (let i = bucket.length - 1; i >= 0; i--) {
          const started = bucket[i];
          if (started.kind === 'tool_start' && started.toolId === event.toolId) {
            isArtifactResult = started.toolName === 'create_artifact';
            artifactInput = started.input;
            break;
          }
        }
        if (isArtifactResult) {
          const snapshot = snapshotFromCreateArtifactTool({
            status: 'done',
            input: artifactInput,
            result: event.content,
          });
          if (snapshot) {
            next.transientArtifactsBySession = {
              ...state.transientArtifactsBySession,
              [event.sessionId]: upsertTransientArtifact(
                state.transientArtifactsBySession[event.sessionId] ?? [],
                snapshot,
              ),
            };
          }
        }
      }
      const currentBudget = (next.workBudgetBySession ?? state.workBudgetBySession)[
        event.sessionId
      ];
      const liveBudget = applyLiveBudgetFallback(currentBudget, event);
      if (liveBudget && liveBudget !== currentBudget) {
        next.workBudgetBySession = {
          ...(next.workBudgetBySession ?? state.workBudgetBySession),
          [event.sessionId]: liveBudget,
        };
      }
      return next;
    }),

  upsertSession: (meta) =>
    set((state) => {
      const existingIdx = state.sessions.findIndex((s) => s.sessionId === meta.sessionId);
      if (existingIdx < 0) {
        return { sessions: [meta, ...state.sessions] };
      }
      const next = state.sessions.slice();
      next[existingIdx] = meta;
      return { sessions: next };
    }),

  removeSession: (sessionId) => {
    clearLastOpenedFileViewerSnapshotForSession(sessionId);
    set((state) => {
      // 同时清掉对应事件 buffer 和 user message buffer——session 不在了，留着就是泄漏
      const { [sessionId]: _evt, ...restEvents } = state.eventsBySession;
      const { [sessionId]: _esa, ...restErrorSeen } = state.errorSeenAtBySession;
      // #9 fix: todo-drift dismiss 基线也是 per-session 派生态，session 删了要一起清。
      const { [sessionId]: _tdda, ...restTodoDriftDismissedAt } =
        state.todoDriftDismissedAtBySession;
      const { [sessionId]: _tddp, ...restTodoDriftDismissedPending } =
        state.todoDriftDismissedPendingCountBySession;
      const { [sessionId]: _ta, ...restTransientArtifacts } = state.transientArtifactsBySession;
      const { [sessionId]: _msg, ...restMsgs } = state.userMessagesBySession;
      const { [sessionId]: _queuedMsg, ...restQueuedMsgs } = state.queuedUserMessagesBySession;
      const { [sessionId]: _localNotice, ...restLocalNotices } = state.localNoticesBySession;
      const { [sessionId]: _wfn, ...restWorkflowNotices } = state.workflowNoticesBySession;
      const { [sessionId]: _bud, ...restBudgets } = state.workBudgetBySession;
      const { [sessionId]: _prof, ...restProfiles } = state.harnessProfileBySession;
      const { [sessionId]: _todo, ...restTodos } = state.todoListBySession;
      const { [sessionId]: _mts, ...restMts } = state.managedTaskStatusBySession;
      const { [sessionId]: _actors, ...restActorSnapshots } = state.agentActorSnapshotBySession;
      const { [sessionId]: _snapshotCursor, ...restSnapshotCursors } =
        state.runtimeSnapshotCursorBySession;
      const { [sessionId]: _tok, ...restTokens } = state.tokensBySession;
      const { [sessionId]: _usage, ...restUsage } = state.sessionTokenUsageBySession;
      const { [sessionId]: _contextBudget, ...restContextBudgets } = state.contextBudgetBySession;
      const { [sessionId]: _providerCache, ...restProviderCacheDiagnostics } =
        state.providerCacheDiagnosticBySession;
      persistSessionTokenUsage(restUsage);
      // KX-I-02 review HIGH-3 — director 的 per-session promoted set 同样跟着 session
      // 走,session 删了就清掉,避免 long-lived 进程下泄漏。
      const { [sessionId]: _prom, ...restPromoted } = state.promotedPopoutsBySession;
      // v0.1.9 release review HIGH-1 — 漏清 3 个 session-keyed map:
      //   - inputHistoryBySession (200 string * N session 累积)
      //   - pendingSendBySession (失败路径删 session 时 true 永留 spinner)
      //   - sessionFlags (pinned/archived/unread 残留)
      const { [sessionId]: _ih, ...restHistory } = state.inputHistoryBySession;
      const { [sessionId]: _ps, ...restPending } = state.pendingSendBySession;
      const { [sessionId]: _sf, ...restFlags } = state.sessionFlags;
      return {
        sessions: state.sessions.filter((s) => s.sessionId !== sessionId),
        eventsBySession: restEvents,
        errorSeenAtBySession: restErrorSeen,
        todoDriftDismissedAtBySession: restTodoDriftDismissedAt,
        todoDriftDismissedPendingCountBySession: restTodoDriftDismissedPending,
        transientArtifactsBySession: restTransientArtifacts,
        userMessagesBySession: restMsgs,
        queuedUserMessagesBySession: restQueuedMsgs,
        localNoticesBySession: restLocalNotices,
        workflowNoticesBySession: restWorkflowNotices,
        workBudgetBySession: restBudgets,
        harnessProfileBySession: restProfiles,
        todoListBySession: restTodos,
        managedTaskStatusBySession: restMts,
        agentActorSnapshotBySession: restActorSnapshots,
        runtimeSnapshotCursorBySession: restSnapshotCursors,
        tokensBySession: restTokens,
        sessionTokenUsageBySession: restUsage,
        contextBudgetBySession: restContextBudgets,
        providerCacheDiagnosticBySession: restProviderCacheDiagnostics,
        promotedPopoutsBySession: restPromoted,
        inputHistoryBySession: restHistory,
        pendingSendBySession: restPending,
        sessionFlags: restFlags,
        permissionQueue: state.permissionQueue.filter((p) => p.sessionId !== sessionId),
        askUserQueue: state.askUserQueue.filter((p) => p.sessionId !== sessionId),
        currentSessionId: state.currentSessionId === sessionId ? null : state.currentSessionId,
        // F009: 删 session 不能让 pending tool path / lastDiffPath 留指着已删 session
        lastDiffPath: state.currentSessionId === sessionId ? null : state.lastDiffPath,
      };
    });
    persistLocalNoticeReplace(sessionId, []);
  },

  enqueuePermission: (req) =>
    set((state) => {
      // 防 main 端重发同 reqId（push 不应当重发，但兜底）
      if (state.permissionQueue.some((p) => p.reqId === req.reqId)) return state;
      return { permissionQueue: [...state.permissionQueue, req] };
    }),

  dequeuePermission: (reqId) =>
    set((state) => ({
      permissionQueue: state.permissionQueue.filter((p) => p.reqId !== reqId),
    })),

  enqueueAskUser: (req) =>
    set((state) => {
      if (state.askUserQueue.some((p) => p.reqId === req.reqId)) return state;
      return { askUserQueue: [...state.askUserQueue, req] };
    }),

  dequeueAskUser: (reqId) =>
    set((state) => ({
      askUserQueue: state.askUserQueue.filter((p) => p.reqId !== reqId),
    })),

  setProviders: (providers, defaultProviderId, keychainBackend) =>
    set({ providers, defaultProviderId, keychainBackend }),
  setDefaultProviderId: (id) =>
    set((state) => ({
      defaultProviderId: id,
      providers: state.providers.map((provider) => {
        const isDefault = provider.id === id;
        return provider.isDefault === isDefault ? provider : { ...provider, isDefault };
      }),
    })),

  setKodaxDefaults: (defaults) => set({ kodaxDefaults: defaults }),
  setRuntimeDefaults: (defaults) => set({ runtimeDefaults: { ...defaults } }),
  setCoderRuntimeConnection: (connection) =>
    set((state) => {
      const next = replaceRuntimeConnection(
        {
          connection: state.runtimeConnection,
          profile: state.runtimeProfile,
          liveBySession: state.liveProjectionBySession,
          snapshotRequiredBySession: state.runtimeSnapshotRequiredBySession,
        },
        connection,
      );
      if (next.connection === state.runtimeConnection) return state;
      const keepActorSnapshots =
        (next.connection.state === 'ready' || next.connection.state === 'degraded') &&
        next.connection.runtimeId !== undefined &&
        next.connection.runtimeId === state.runtimeConnection.runtimeId;
      return {
        runtimeConnection: next.connection,
        ...(keepActorSnapshots
          ? {}
          : {
              agentActorSnapshotBySession: {},
              runtimeSnapshotCursorBySession: {},
            }),
      };
    }),
  replaceAgentActorSnapshot: (snapshot) =>
    set((state) => {
      if (
        (state.runtimeConnection.state !== 'ready' &&
          state.runtimeConnection.state !== 'degraded') ||
        state.runtimeConnection.runtimeId !== snapshot.runtimeId
      ) {
        return state;
      }
      const current = state.agentActorSnapshotBySession[snapshot.sessionId];
      if (
        current?.runtimeId === snapshot.runtimeId &&
        (current.revision > snapshot.revision ||
          (current.revision === snapshot.revision && current.eventCursor >= snapshot.eventCursor))
      ) {
        return state;
      }
      return {
        agentActorSnapshotBySession: {
          ...state.agentActorSnapshotBySession,
          [snapshot.sessionId]: snapshot,
        },
      };
    }),
  replaceRuntimeProfileProjection: (profile) =>
    set((state) => {
      const next = replaceRuntimeProfile(
        {
          connection: state.runtimeConnection,
          profile: state.runtimeProfile,
          liveBySession: state.liveProjectionBySession,
          snapshotRequiredBySession: state.runtimeSnapshotRequiredBySession,
        },
        profile,
      );
      const codeSessionIds = new Set(next.profile?.sessions.map((session) => session.sessionId));
      for (const interaction of next.profile?.interactions ?? []) {
        codeSessionIds.add(interaction.request.sessionId);
      }
      const runtimePermissions = (next.profile?.interactions ?? [])
        .filter(
          (interaction): interaction is Extract<typeof interaction, { kind: 'permission' }> =>
            interaction.kind === 'permission' && interaction.state === 'pending',
        )
        .map((interaction) => interaction.request);
      const runtimeAskUser = (next.profile?.interactions ?? [])
        .filter(
          (interaction): interaction is Extract<typeof interaction, { kind: 'ask-user' }> =>
            interaction.kind === 'ask-user' && interaction.state === 'pending',
        )
        .map((interaction) => interaction.request);
      return {
        runtimeConnection: next.connection,
        runtimeProfile: next.profile,
        liveProjectionBySession: next.liveBySession,
        runtimeSnapshotRequiredBySession: next.snapshotRequiredBySession,
        runtimeSnapshotCursorBySession:
          next.connection.runtimeId !== undefined &&
          next.connection.runtimeId === state.runtimeConnection.runtimeId &&
          (next.connection.state === 'ready' || next.connection.state === 'degraded')
            ? state.runtimeSnapshotCursorBySession
            : {},
        agentActorSnapshotBySession:
          next.connection.runtimeId !== undefined &&
          next.connection.runtimeId === state.runtimeConnection.runtimeId &&
          (next.connection.state === 'ready' || next.connection.state === 'degraded')
            ? state.agentActorSnapshotBySession
            : {},
        permissionQueue: [
          ...state.permissionQueue.filter((request) => !codeSessionIds.has(request.sessionId)),
          ...runtimePermissions,
        ],
        askUserQueue: [
          ...state.askUserQueue.filter((request) => !codeSessionIds.has(request.sessionId)),
          ...runtimeAskUser,
        ],
      };
    }),
  replaceSessionLiveProjection: (projection) =>
    set((state) => {
      const currentProjection = state.liveProjectionBySession[projection.sessionId];
      const next = replaceSessionLiveProjectionState(
        {
          connection: state.runtimeConnection,
          profile: state.runtimeProfile,
          liveBySession: state.liveProjectionBySession,
          snapshotRequiredBySession: state.runtimeSnapshotRequiredBySession,
        },
        projection,
      );
      const acceptedProjection = next.liveBySession[projection.sessionId] === projection;
      const snapshotRun = projection.activeRun ?? projection.lastTerminalRun;
      const previousBarrier = state.runtimeSnapshotCursorBySession[projection.sessionId];
      const sameBarrierRun =
        snapshotRun !== undefined &&
        previousBarrier?.runtimeId === projection.cursor.runtimeId &&
        previousBarrier.runId === snapshotRun.runId;
      const currentEvents = state.eventsBySession[projection.sessionId] ?? [];
      const hydratedEvents = acceptedProjection
        ? hydrateSessionEventsFromLiveSnapshot(currentEvents, projection)
        : currentEvents;
      const clearsPendingSend =
        acceptedProjection &&
        Boolean(state.pendingSendBySession[projection.sessionId]) &&
        liveProjectionClearsPendingSend(currentProjection, projection);
      const pendingSendPatch = clearsPendingSend
        ? (() => {
            const { [projection.sessionId]: _drop, ...rest } = state.pendingSendBySession;
            return { pendingSendBySession: rest };
          })()
        : {};
      const runtimePermissions = projection.interactions
        .filter(
          (interaction): interaction is Extract<typeof interaction, { kind: 'permission' }> =>
            interaction.kind === 'permission' && interaction.state === 'pending',
        )
        .map((interaction) => interaction.request);
      const runtimeAskUser = projection.interactions
        .filter(
          (interaction): interaction is Extract<typeof interaction, { kind: 'ask-user' }> =>
            interaction.kind === 'ask-user' && interaction.state === 'pending',
        )
        .map((interaction) => interaction.request);
      return {
        sessions: mergeRuntimeSettingsIntoSessions(state.sessions, projection),
        liveProjectionBySession: next.liveBySession,
        runtimeSnapshotRequiredBySession: next.snapshotRequiredBySession,
        ...(acceptedProjection && snapshotRun
          ? {
              runtimeSnapshotCursorBySession: {
                ...state.runtimeSnapshotCursorBySession,
                [projection.sessionId]: {
                  ...projection.cursor,
                  runId: snapshotRun.runId,
                  ...(projection.assistantDraft !== undefined
                    ? { assistantDraftSeq: projection.cursor.seq }
                    : sameBarrierRun && previousBarrier.assistantDraftSeq !== undefined
                      ? { assistantDraftSeq: previousBarrier.assistantDraftSeq }
                      : {}),
                  ...(projection.thinkingDraft !== undefined
                    ? { thinkingDraftSeq: projection.cursor.seq }
                    : sameBarrierRun && previousBarrier.thinkingDraftSeq !== undefined
                      ? { thinkingDraftSeq: previousBarrier.thinkingDraftSeq }
                      : {}),
                },
              },
            }
          : {}),
        ...(hydratedEvents !== currentEvents
          ? {
              eventsBySession: {
                ...state.eventsBySession,
                [projection.sessionId]: hydratedEvents,
              },
            }
          : {}),
        permissionQueue: [
          ...state.permissionQueue.filter((request) => request.sessionId !== projection.sessionId),
          ...runtimePermissions,
        ],
        askUserQueue: [
          ...state.askUserQueue.filter((request) => request.sessionId !== projection.sessionId),
          ...runtimeAskUser,
        ],
        ...pendingSendPatch,
      };
    }),
  applySessionLiveProjectionChange: (change) => {
    let status: ApplySessionLiveChangeStatus = 'ignored';
    set((state) => {
      const result = applySessionLiveChange(
        {
          connection: state.runtimeConnection,
          profile: state.runtimeProfile,
          liveBySession: state.liveProjectionBySession,
          snapshotRequiredBySession: state.runtimeSnapshotRequiredBySession,
        },
        change,
      );
      status = result.status;
      if (
        result.state.liveBySession === state.liveProjectionBySession &&
        result.state.snapshotRequiredBySession === state.runtimeSnapshotRequiredBySession
      ) {
        return state;
      }
      const projection = result.state.liveBySession[change.sessionId];
      const clearsPendingSend =
        result.status === 'applied' &&
        projection !== undefined &&
        Boolean(state.pendingSendBySession[change.sessionId]) &&
        liveProjectionClearsPendingSend(
          state.liveProjectionBySession[change.sessionId],
          projection,
        );
      const pendingSendPatch = clearsPendingSend
        ? (() => {
            const { [change.sessionId]: _drop, ...rest } = state.pendingSendBySession;
            return { pendingSendBySession: rest };
          })()
        : {};
      const interactionPatch =
        (change.change.domain === 'interaction' ||
          (change.change.domain === 'run' && change.change.resetRunScopedState === true)) &&
        projection
          ? {
              permissionQueue: [
                ...state.permissionQueue.filter(
                  (request) => request.sessionId !== change.sessionId,
                ),
                ...projection.interactions
                  .filter(
                    (
                      interaction,
                    ): interaction is Extract<typeof interaction, { kind: 'permission' }> =>
                      interaction.kind === 'permission' && interaction.state === 'pending',
                  )
                  .map((interaction) => interaction.request),
              ],
              askUserQueue: [
                ...state.askUserQueue.filter((request) => request.sessionId !== change.sessionId),
                ...projection.interactions
                  .filter(
                    (
                      interaction,
                    ): interaction is Extract<typeof interaction, { kind: 'ask-user' }> =>
                      interaction.kind === 'ask-user' && interaction.state === 'pending',
                  )
                  .map((interaction) => interaction.request),
              ],
            }
          : {};
      const settingsPatch =
        change.change.domain === 'settings' && projection
          ? { sessions: mergeRuntimeSettingsIntoSessions(state.sessions, projection) }
          : {};
      return {
        liveProjectionBySession: result.state.liveBySession,
        runtimeSnapshotRequiredBySession: result.state.snapshotRequiredBySession,
        ...interactionPatch,
        ...settingsPatch,
        ...pendingSendPatch,
      };
    });
    return status;
  },

  setPendingProviderId: (id) => set({ pendingProviderId: id }),
  setPendingReasoningMode: (mode) => {
    lsSet(LS_KEY_PENDING_REASONING, mode);
    set({ pendingReasoningMode: mode });
  },
  setPendingPermissionMode: (mode) => {
    lsSet(LS_KEY_PENDING_PERMISSION, mode);
    set({ pendingPermissionMode: mode });
  },
  setPendingAutoModeEngine: (engine) => {
    lsSet(LS_KEY_PENDING_AUTO_ENGINE, engine);
    set({ pendingAutoModeEngine: engine });
  },
  setPendingAgentMode: (mode) => {
    lsSet(LS_KEY_PENDING_AGENT, mode);
    set({ pendingAgentMode: mode });
  },
  setPendingModel: (model) => {
    // model 名是 provider-specific 字符串；写 LS 让重启后默认沿用上次选择。
    lsSet(LS_KEY_PENDING_MODEL, model);
    set({ pendingModel: model });
  },

  setPendingSend: (sessionId, pending) =>
    set((state) => {
      if (pending) {
        if (state.pendingSendBySession[sessionId]) return state;
        return {
          pendingSendBySession: { ...state.pendingSendBySession, [sessionId]: true as const },
        };
      }
      if (!state.pendingSendBySession[sessionId]) return state;
      const { [sessionId]: _drop, ...rest } = state.pendingSendBySession;
      return { pendingSendBySession: rest };
    }),

  setRightSidebarOpen: (open) => {
    set({ rightSidebarOpen: open });
  },

  setLeftSidebarOpen: (open) => {
    lsSet('kodax-space.leftSidebarOpen', open ? '1' : '0');
    set({ leftSidebarOpen: open });
  },

  setLeftSidebarWidth: (px) => {
    const clamped = clampSidebarWidth(px, 260);
    lsSet('kodax-space.leftSidebarWidth', String(clamped));
    set({ leftSidebarWidth: clamped });
  },

  setRightSidebarWidth: (px) => {
    const clamped = clampSidebarWidth(px, 320);
    lsSet('kodax-space.rightSidebarWidth', String(clamped));
    set({ rightSidebarWidth: clamped });
  },

  setActivePopoutKind: (kind) => set({ activePopoutKind: kind }),

  setSmartPopoutEnabled: (enabled) => {
    lsSet(LS_KEY_SMART_POPOUT, enabled ? '1' : '0');
    set({ smartPopoutEnabled: enabled });
  },

  setMascotMode: (mode) => {
    persistMascotMode(mode);
    set({ mascotMode: mode, mascotEnabled: mode !== 'off' });
  },

  cycleMascotMode: () =>
    set((state) => {
      const mode = nextMascotMode(state.mascotMode);
      persistMascotMode(mode);
      return { mascotMode: mode, mascotEnabled: mode !== 'off' };
    }),

  setMascotEnabled: (enabled) => {
    const mode: MascotMode = enabled ? 'legacy' : 'off';
    persistMascotMode(mode);
    set({ mascotMode: mode, mascotEnabled: enabled });
  },

  setNativeCompletionNotificationsEnabled: (enabled) => {
    lsSet(LS_KEY_NATIVE_COMPLETION_NOTIFICATIONS, enabled ? '1' : '0');
    set({ nativeCompletionNotificationsEnabled: enabled });
  },

  markPopoutPromoted: (sessionId, kind) =>
    set((state) => {
      const prev = state.promotedPopoutsBySession[sessionId];
      // 已有同 kind 就 short-circuit,避免无谓 setState 触发 selector re-fire
      if (prev && prev.has(kind)) return state;
      const next = new Set(prev ?? []);
      next.add(kind);
      return {
        promotedPopoutsBySession: {
          ...state.promotedPopoutsBySession,
          [sessionId]: next,
        },
      };
    }),

  reorderProjects: (srcCanonPath, targetCanonPath) =>
    set((state) => {
      if (srcCanonPath === targetCanonPath) return state;
      // 当前激活的 active projects (canon 形态),archived 不参与排序
      const allCanon = state.projects
        .filter((p) => p.archived !== true)
        .map((p) => canonProjectRootShared(p.path, IS_WIN_RENDERER));

      // 现有 order 把 archived/已不存在的 canon path 过滤掉,跟新 active 列表对齐
      const validSet = new Set(allCanon);
      const filteredOrder = state.projectOrder.filter((p) => validSet.has(p));
      // 不在 filteredOrder 里的 active project (新加 / 之前不在 order) 按 store 顺序追加
      const inOrder = new Set(filteredOrder);
      const tail = allCanon.filter((p) => !inOrder.has(p));
      const combined = [...filteredOrder, ...tail];

      // 把 src 拿出来,插到 target 之前
      const srcIdx = combined.indexOf(srcCanonPath);
      const tgtIdx = combined.indexOf(targetCanonPath);
      if (srcIdx === -1 || tgtIdx === -1) return state;
      const without = combined.filter((_, i) => i !== srcIdx);
      // 拿掉 src 后 target 位置变化:若原 target 在 src 之后,index 不变;否则减 1
      const newTgt = tgtIdx > srcIdx ? tgtIdx - 1 : tgtIdx;
      const next = [...without.slice(0, newTgt), srcCanonPath, ...without.slice(newTgt)];
      lsSet('kodax-space.projectOrder', JSON.stringify(next));
      return { projectOrder: next };
    }),

  setArchivedProjectsExpanded: (expanded) => {
    lsSet('kodax-space.archivedProjectsExpanded', expanded ? '1' : '0');
    set({ archivedProjectsExpanded: expanded });
  },

  appendInputHistory: (sessionId, prompt) =>
    set((state) => {
      const trimmed = prompt.trim();
      if (trimmed === '') return state;
      const bucket = state.inputHistoryBySession[sessionId] ?? [];
      // 去重：连续两次同 prompt 只留一条，跟 shell history 行为对齐
      if (bucket.length > 0 && bucket[bucket.length - 1] === trimmed) return state;
      const next = [...bucket, trimmed].slice(-200); // 上限 200 条
      return {
        inputHistoryBySession: { ...state.inputHistoryBySession, [sessionId]: next },
      };
    }),

  setRecentsFilter: (filter) => set({ recentsFilter: filter }),
  setTheme: (theme) => {
    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem('kodax-space.theme', theme);
      } catch {
        /* SSR / private mode */
      }
    }
    set({ theme });
  },
  setVisualQuality: (q) => {
    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem(VISUAL_QUALITY_KEY, q);
      } catch {
        /* private mode */
      }
      applyVisualQualityToDocument(q);
    }
    set({ visualQuality: q });
  },
  setTranscriptView: (v) => set({ transcriptView: v }),
  setTranscriptFontSize: (s) => set({ transcriptFontSize: s }),

  toggleSessionFlag: (sessionId, flag) =>
    set((state) => {
      const cur = state.sessionFlags[sessionId] ?? {};
      return {
        sessionFlags: setSessionFlagValue(state.sessionFlags, sessionId, flag, !cur[flag]),
      };
    }),
  setSessionFlag: (sessionId, flag, value) =>
    set((state) => {
      const sessionFlags = setSessionFlagValue(state.sessionFlags, sessionId, flag, value);
      if (sessionFlags === state.sessionFlags) return state;
      return { sessionFlags };
    }),

  clearLastDiffPath: () => set({ lastDiffPath: null }),
  setLastDiffPath: (path) => set({ lastDiffPath: path }),

  resetSessionView: () =>
    set({
      currentSessionId: null,
      eventsBySession: {},
      transientArtifactsBySession: {},
      userMessagesBySession: {},
      queuedUserMessagesBySession: {},
      localNoticesBySession: {},
      workflowNoticesBySession: {},
      permissionQueue: [],
      askUserQueue: [],
      workBudgetBySession: {},
      harnessProfileBySession: {},
      tokensBySession: {},
      contextBudgetBySession: {},
      providerCacheDiagnosticBySession: {},
      todoListBySession: {},
      managedTaskStatusBySession: {},
      agentActorSnapshotBySession: {},
      runtimeSnapshotCursorBySession: {},
      sessions: [],
      lastDiffPath: null,
      pendingToolPaths: {},
    }),

  resetSessionMessages: (sessionId) => {
    set((state) => {
      // 同步剥掉本 session 在 pendingToolPaths 中暂存的 tool_id → path 记录
      // 否则 /clear 后若一个迟来的 tool_result 带相同 toolId，会触发 FilePanel
      // 跳到一个用户刚清掉的 diff（F031+F009 交互回归 — reviewer batch HIGH-1）。
      const events = state.eventsBySession[sessionId] ?? [];
      const toolIdsInThisSession = new Set<string>();
      for (const ev of events) {
        if (ev.kind === 'tool_start') toolIdsInThisSession.add(ev.toolId);
      }
      const nextPending: Record<string, string> = {};
      for (const [tid, path] of Object.entries(state.pendingToolPaths)) {
        if (!toolIdsInThisSession.has(tid)) nextPending[tid] = path;
      }
      return {
        eventsBySession: { ...state.eventsBySession, [sessionId]: [] },
        transientArtifactsBySession: { ...state.transientArtifactsBySession, [sessionId]: [] },
        userMessagesBySession: { ...state.userMessagesBySession, [sessionId]: [] },
        queuedUserMessagesBySession: { ...state.queuedUserMessagesBySession, [sessionId]: [] },
        localNoticesBySession: { ...state.localNoticesBySession, [sessionId]: [] },
        workflowNoticesBySession: { ...state.workflowNoticesBySession, [sessionId]: [] },
        contextBudgetBySession: {
          ...state.contextBudgetBySession,
          [sessionId]: undefined,
        },
        providerCacheDiagnosticBySession: {
          ...state.providerCacheDiagnosticBySession,
          [sessionId]: undefined,
        },
        runtimeSnapshotCursorBySession: {
          ...state.runtimeSnapshotCursorBySession,
          [sessionId]: undefined,
        },
        pendingToolPaths: nextPending,
      };
    });
    persistLocalNoticeReplace(sessionId, []);
  },

  // FEATURE_033: fork = clone full buffer 到 newSessionId。
  // forkPointTurnIdx 当前仅作 metadata 记录（main 端已经写 session 上）；不在 renderer 层
  // 按 turn 切，因为 in-memory 阶段 UX 是 "在当前对话末尾分叉一条平行线"。
  // KodaX SDK 0.7.42 出 forkSession() 后 main 端会接磁盘，renderer 这层直接 setSessions 即可。
  //
  // **pendingToolPaths 不复制到 fork**（reviewer batch HIGH-2 的 follow-up）：
  // toolId 是 per-invocation UUID 全局唯一，永不复用——source 的 in-flight 工具 tool_result
  // 会路由回 source session（不是 fork），让 source 的 pending 自己清。fork 的"pending tool"
  // 概念只对 fork 自己产生的新 tool_start 才有意义。所以 fork 启动时 pendingToolPaths 自然为空。
  forkSessionBuffers: (srcSessionId, newSessionId, _forkPointTurnIdx) => {
    let copiedLocalNotices: readonly LocalNoticeMessage[] | null = null;
    set((state) => {
      const srcEvents = state.eventsBySession[srcSessionId] ?? [];
      const srcMsgs = state.userMessagesBySession[srcSessionId] ?? [];
      const srcLocalNotices = state.localNoticesBySession[srcSessionId] ?? [];
      const srcNotices = state.workflowNoticesBySession[srcSessionId] ?? [];
      copiedLocalNotices = srcLocalNotices.slice();
      // events 里的 sessionId 字段是 source 的——为新 session 重建 events 时需要改 sessionId，
      // 否则 ConversationStreamV2 按 sessionId 过滤会读不到。这里直接做映射。
      const remapped = srcEvents.map((e) => ({ ...e, sessionId: newSessionId }) as SessionEvent);
      return {
        eventsBySession: { ...state.eventsBySession, [newSessionId]: remapped },
        transientArtifactsBySession: {
          ...state.transientArtifactsBySession,
          [newSessionId]: collectTransientArtifactsFromEvents(remapped),
        },
        userMessagesBySession: { ...state.userMessagesBySession, [newSessionId]: srcMsgs.slice() },
        queuedUserMessagesBySession: {
          ...state.queuedUserMessagesBySession,
          [newSessionId]: [],
        },
        localNoticesBySession: {
          ...state.localNoticesBySession,
          [newSessionId]: srcLocalNotices.slice(),
        },
        workflowNoticesBySession: {
          ...state.workflowNoticesBySession,
          [newSessionId]: srcNotices.slice(),
        },
      };
    });
    if (copiedLocalNotices !== null) persistLocalNoticeReplace(newSessionId, copiedLocalNotices);
  },

  // FEATURE_033 rewind: 截断 userMessages 与 events buffer 到 rewindPastTurnIdx (含)。
  //   - userMessages 保留前 idx+1 条
  //   - events 按 session_complete / session_error 分 turn：保留前 idx+1 个 turn 的全部 events
  //   - idx >= 现有 turn 数 → silent no-op (renderer 校验，main 不持有 events)
  //
  // **同时清空 derived state maps**（reviewer F033 HIGH-1）：
  // todoList / workBudget / managedTaskStatus / harnessProfile 都是 per-session 派生状态，
  // 由 appendEvent 累积。rewind 跨过 turn 边界后，这些值不再对应剩余 events——若不重置会
  // 在 UI 上显示 stale 数据（如已被截掉那轮的 todo list、过高的 work budget 计数）。
  // 重置后用户继续 send 时自然由新 events 重新填充。
  rewindSessionBuffers: (sessionId, rewindPastTurnIdx) => {
    let persistedLocalNotices: readonly LocalNoticeMessage[] | null = null;
    set((state) => {
      const msgs = state.userMessagesBySession[sessionId] ?? [];
      const localNotices = state.localNoticesBySession[sessionId] ?? [];
      const notices = state.workflowNoticesBySession[sessionId] ?? [];
      const events = state.eventsBySession[sessionId] ?? [];
      // idx 越界 → 啥都不做
      if (rewindPastTurnIdx < 0 || rewindPastTurnIdx >= msgs.length) return state;
      const newMsgs = msgs.slice(0, rewindPastTurnIdx + 1);
      const firstRemovedSentAt = msgs[rewindPastTurnIdx + 1]?.sentAt ?? Number.POSITIVE_INFINITY;
      const newLocalNotices = localNotices.filter((notice) => notice.sentAt < firstRemovedSentAt);
      persistedLocalNotices = newLocalNotices;
      const newNotices = notices.filter((notice) => notice.sentAt < firstRemovedSentAt);
      // events 按 session_complete/session_error 分段，保留前 (rewindPastTurnIdx + 1) 段。
      //
      // 命名说明：`completedTurnsBefore` 表示"在当前位置之前已经完成的 turn 数"——
      // 第一次见到 session_complete 时为 0（处理 turn 0），第二次为 1（turn 1）...
      // 当 completedTurnsBefore === rewindPastTurnIdx 时即在处理目标 turn 末尾，
      // 切到 i+1 (含本条 session_complete) 即"保留 turns 0..idx 共 idx+1 个"。
      let completedTurnsBefore = 0;
      let sliceEnd = events.length; // 默认保留全部（last turn 还没 complete 时）
      for (let i = 0; i < events.length; i++) {
        const k = events[i].kind;
        if (k === 'session_complete' || k === 'session_error') {
          if (completedTurnsBefore === rewindPastTurnIdx) {
            sliceEnd = i + 1;
            break;
          }
          completedTurnsBefore++;
        }
      }
      // 同步清掉 derived state（不区分 turn 边界——简单一致，让 events 重新驱动）
      const { [sessionId]: _todo, ...restTodos } = state.todoListBySession;
      const { [sessionId]: _bud, ...restBudgets } = state.workBudgetBySession;
      const { [sessionId]: _mts, ...restMts } = state.managedTaskStatusBySession;
      const { [sessionId]: _actors, ...restActorSnapshots } = state.agentActorSnapshotBySession;
      const { [sessionId]: _prof, ...restProfiles } = state.harnessProfileBySession;
      const { [sessionId]: _tok, ...restTokens } = state.tokensBySession;
      const { [sessionId]: _contextBudget, ...restContextBudgets } = state.contextBudgetBySession;
      const { [sessionId]: _providerCache, ...restProviderCacheDiagnostics } =
        state.providerCacheDiagnosticBySession;
      return {
        userMessagesBySession: { ...state.userMessagesBySession, [sessionId]: newMsgs },
        queuedUserMessagesBySession: { ...state.queuedUserMessagesBySession, [sessionId]: [] },
        localNoticesBySession: {
          ...state.localNoticesBySession,
          [sessionId]: newLocalNotices,
        },
        workflowNoticesBySession: {
          ...state.workflowNoticesBySession,
          [sessionId]: newNotices,
        },
        eventsBySession: { ...state.eventsBySession, [sessionId]: events.slice(0, sliceEnd) },
        transientArtifactsBySession: {
          ...state.transientArtifactsBySession,
          [sessionId]: collectTransientArtifactsFromEvents(events.slice(0, sliceEnd)),
        },
        todoListBySession: restTodos,
        workBudgetBySession: restBudgets,
        managedTaskStatusBySession: restMts,
        agentActorSnapshotBySession: restActorSnapshots,
        harnessProfileBySession: restProfiles,
        tokensBySession: restTokens,
        contextBudgetBySession: restContextBudgets,
        providerCacheDiagnosticBySession: restProviderCacheDiagnostics,
      };
    });
    if (persistedLocalNotices !== null) {
      persistLocalNoticeReplace(sessionId, persistedLocalNotices);
    }
  },
}));
