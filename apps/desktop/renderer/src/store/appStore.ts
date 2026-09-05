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
  SpaceSessionLiveInvalidatedT,
  SpaceSessionLiveProjectionT,
  AgentActorTreeSnapshotT,
  SessionHistoryItem,
} from '@kodax-space/space-ipc-schema';
import { bufferIndexForSelectorTurn } from '../features/session/turnIndex.js';
import {
  canonProjectRoot as canonProjectRootShared,
  reasoningModeSchema,
} from '@kodax-space/space-ipc-schema';
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
  runtimeConnectionHasFreshLiveAuthority,
  runtimeTerminalEvidenceCandidates,
  type ApplySessionLiveChangeStatus,
} from './runtimeProjectionState.js';
import {
  filterEffectiveOutputSegmentEvents,
  hydrateSessionEventsFromLiveSnapshot,
  projectionTextSuffix,
  runtimeDeltasShareSnapshotSide,
} from './runtimeSnapshotHydration.js';
import {
  mergeRuntimeActivityIntoSessions,
  mergeRuntimeSettingsIntoSessions,
} from './runtimeSessionSettings.js';
import { selectTranscriptProjectionMergeStrategy } from './transcriptProjection.js';
import { pushToast, useToastStore } from './toastStore.js';
import { translateMessage } from '../i18n/I18nProvider.js';
import { isCancelledSessionError } from '../features/session/sessionError.js';

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

/** Exact Runtime Run whose canonical history read started after its terminal evidence. */
export interface SettledRuntimeHistoryRun {
  readonly runtimeId: string;
  readonly runId: string;
  readonly generation: number;
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
  /** Renderer-only admission identity captured from run.started before turnId exists. */
  readonly runtimeRunId?: string;
  /** Composer send-operation identity; deterministically claims this optimistic message
   *  when a live run projection arrives with the same originOperationId (lost-ACK recovery). */
  readonly operationId?: string;
  readonly operationReservation?: SendOperationReservation;
  readonly sendAdmissionSettled?: true;
  readonly canonicalIndex?: number;
  /** Absolute visible turn index before bounded history-window truncation. */
  readonly historyTurnIndex?: number;
  /** Exact persisted turn-end boundary used instead of a page-local turn index. */
  readonly historyBoundary?: {
    readonly boundaryId: string;
    readonly sourceRevision: string;
  };
  /** Canonical persisted transcript provenance (history-only, never used as a React key). */
  readonly entryId?: string;
  readonly auditEntryIds?: readonly string[];
  readonly parentId?: string | null;
  readonly logicalId?: string;
  readonly sourceEntryId?: string;
  readonly authoritativeEntryId?: string;
  /** Internal idempotency identity for a Runtime-delivered queued prompt. */
  readonly deliveryQueueId?: string;
  readonly deliveryQueueMode?: QueuedUserMessage['queueMode'];
  /** Interrupt deliveries require an exact canonical entry reference before live/history folding. */
  readonly deliveredInterrupt?: true;
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
  /** Original live ordering key while hiddenProjectionDuplicate temporarily follows its owner. */
  readonly hiddenProjectionOriginalSentAt?: number;
  /**
   * Internal alignment anchor for assistant/tool-leading history and history/live segment gaps.
   * It keeps positional event owners aligned without presenting a fabricated empty user bubble.
   */
  readonly hiddenHistoryAnchor?: boolean;
  /**
   * The newest bounded history page began inside this Runtime turn, before its canonical user
   * entry. The anchor may reconcile with a unique live owner for the same authoritative turnId;
   * it must remain ambiguous when one Runtime turn contains multiple live user prompts.
   */
  readonly leadingPartialHistory?: true;
  /**
   * Runtime supplied a canonical turnId but could not prove this user's ordinal within that turn.
   * A unique semantic live owner may supply only that missing ordinal; canonical content and
   * mutation boundary remain authoritative.
   */
  readonly omittedHistoryUserOrdinal?: true;
}

/** Renderer-only ownership marker for events reconstructed from a replaceable history window. */
const restoredHistoryEvents = new WeakSet<object>();

interface HistoryLiveBaseline {
  userMessages: readonly UserMessage[];
  events: readonly SessionEvent[];
  /** Live owners already proven to have one exact durable canonical counterpart. */
  readonly durableCanonicalizedUserIds: Set<string>;
  /** Canonical index namespace for canonicalIndexByUserId. */
  canonicalSourceRevision?: string;
  /** Live owners that were once proven to occupy an exact canonical transcript index. */
  canonicalIndexByUserId: Map<string, number>;
}

interface CanonicalizedLiveOwner {
  readonly messageId: string;
  readonly canonicalIndex: number;
}

/**
 * A paged history window is repeatedly rebuilt as older pages arrive. Keep the independent live
 * projection separate from the reconciled UI buffers; otherwise a suffix synthesized while the
 * newest history page was stale becomes input to the next rebuild and is rendered twice once the
 * durable page catches up.
 */
const historyLiveBaselines = new Map<string, HistoryLiveBaseline>();
const MAX_HISTORY_LIVE_BASELINES = 32;
const sessionViewLifecycleResetHandlers = new Set<() => void>();

/**
 * Renderer subsystems with module-local Session caches register here so resetSessionView can
 * invalidate them synchronously, before a project switch can reselect the same Session id.
 * Keeping the registry in the store avoids an appStore -> Shell import cycle.
 */
export function registerSessionViewLifecycleReset(handler: () => void): () => void {
  sessionViewLifecycleResetHandlers.add(handler);
  return () => sessionViewLifecycleResetHandlers.delete(handler);
}

function resetSessionViewLifecycles(): void {
  historyLiveBaselines.clear();
  for (const reset of sessionViewLifecycleResetHandlers) {
    try {
      reset();
    } catch (error) {
      // One auxiliary cache must never prevent the authoritative store reset/project switch.
      console.warn('[appStore] Session view lifecycle reset failed:', error);
    }
  }
}

function rememberHistoryLiveBaseline(sessionId: string, baseline: HistoryLiveBaseline): void {
  historyLiveBaselines.delete(sessionId);
  historyLiveBaselines.set(sessionId, baseline);
  while (historyLiveBaselines.size > MAX_HISTORY_LIVE_BASELINES) {
    const oldest = historyLiveBaselines.keys().next().value;
    if (oldest === undefined) break;
    historyLiveBaselines.delete(oldest);
  }
}

function rememberHistoryLiveEvent(
  sessionId: string,
  event: SessionEvent,
  snapshotCursor?: RuntimeSnapshotEventBarrier,
): void {
  const baseline = historyLiveBaselines.get(sessionId);
  if (!baseline) return;
  baseline.events = appendSessionEvent(baseline.events, event, snapshotCursor);
}

function liveBaselineUser(message: UserMessage): UserMessage {
  if (
    message.hiddenProjectionDuplicate !== true &&
    message.hiddenProjectionOriginalSentAt === undefined
  ) {
    return message;
  }
  const {
    hiddenProjectionDuplicate: _hidden,
    hiddenProjectionOriginalSentAt,
    ...liveMessage
  } = message;
  return hiddenProjectionOriginalSentAt === undefined
    ? liveMessage
    : { ...liveMessage, sentAt: hiddenProjectionOriginalSentAt };
}

function rememberHistoryLiveUsers(sessionId: string, users: readonly UserMessage[]): void {
  const baseline = historyLiveBaselines.get(sessionId);
  if (!baseline) return;
  const byId = new Map(
    baseline.userMessages.map((message) => {
      const liveMessage = liveBaselineUser(message);
      return [liveMessage.id, liveMessage] as const;
    }),
  );
  for (const message of users) {
    if (message.restoredFromHistory !== true) byId.set(message.id, liveBaselineUser(message));
  }
  baseline.userMessages = [...byId.values()];
}

function rememberOpenedHistoryLiveOwner(sessionId: string, message: UserMessage): void {
  const baseline = historyLiveBaselines.get(sessionId);
  if (!baseline) return;
  const {
    restoredFromHistory: _restored,
    canonicalIndex: _canonicalIndex,
    historyTurnIndex: _historyTurnIndex,
    historyBoundary: _historyBoundary,
    historyNoAssistantSegment: _emptySegment,
    hiddenProjectionDuplicate: _hiddenDuplicate,
    hiddenProjectionOriginalSentAt,
    ...liveOwner
  } = message;
  const owner = {
    ...liveOwner,
    ...(hiddenProjectionOriginalSentAt !== undefined
      ? { sentAt: hiddenProjectionOriginalSentAt }
      : {}),
    id: `${message.id}:runtime`,
  };
  baseline.userMessages = [
    ...baseline.userMessages.filter(
      (candidate) =>
        candidate.id !== owner.id &&
        !(
          candidate.entryId !== undefined &&
          owner.entryId !== undefined &&
          candidate.entryId === owner.entryId
        ),
    ),
    owner,
  ];
}

function forgetHistoryLiveUsers(sessionId: string, messageIds: readonly string[]): void {
  const baseline = historyLiveBaselines.get(sessionId);
  if (!baseline || messageIds.length === 0) return;
  const forgotten = new Set(messageIds);
  baseline.userMessages = baseline.userMessages.filter((message) => !forgotten.has(message.id));
  for (const messageId of forgotten) {
    baseline.canonicalIndexByUserId.delete(messageId);
    baseline.durableCanonicalizedUserIds.delete(messageId);
  }
}

function rememberCanonicalizedHistoryLiveOwners(
  sessionId: string,
  owners: readonly CanonicalizedLiveOwner[],
): void {
  const baseline = historyLiveBaselines.get(sessionId);
  if (!baseline || owners.length === 0) return;
  const baselineIds = new Set(baseline.userMessages.map((message) => message.id));
  for (const owner of owners) {
    if (baselineIds.has(owner.messageId)) {
      baseline.canonicalIndexByUserId.set(owner.messageId, owner.canonicalIndex);
      baseline.durableCanonicalizedUserIds.add(owner.messageId);
    }
  }
}

function pruneCanonicalizedHistoryLivePrefix(
  baseline: HistoryLiveBaseline,
  firstRetainedCanonicalIndex: number | undefined,
  prefixOmitted: boolean,
): void {
  if (!prefixOmitted || firstRetainedCanonicalIndex === undefined) return;
  const prunedIds = new Set(
    [...baseline.canonicalIndexByUserId.entries()].flatMap(([messageId, canonicalIndex]) =>
      canonicalIndex < firstRetainedCanonicalIndex ? [messageId] : [],
    ),
  );
  pruneHistoryLiveOwners(baseline, prunedIds);
}

function pruneHistoryLiveOwners(
  baseline: HistoryLiveBaseline,
  prunedIds: ReadonlySet<string>,
): void {
  if (prunedIds.size === 0) return;

  const turns = transcriptTurnSnapshots(baseline.userMessages, baseline.events);
  const prunedUserIndexes = new Set<number>();
  const prunedEventIndexes = new Set<number>();
  for (const turn of turns) {
    if (!prunedIds.has(turn.messageId)) continue;
    prunedUserIndexes.add(turn.userIndex);
    for (let index = turn.eventStart; index < turn.eventEnd; index++) {
      prunedEventIndexes.add(index);
    }
  }
  baseline.userMessages = baseline.userMessages.filter((_, index) => !prunedUserIndexes.has(index));
  baseline.events = baseline.events.filter((_, index) => !prunedEventIndexes.has(index));
  for (const messageId of prunedIds) {
    baseline.canonicalIndexByUserId.delete(messageId);
    baseline.durableCanonicalizedUserIds.delete(messageId);
  }
}

function canonicalLiveTurnRelation(
  canonicalTurns: readonly TranscriptTurnSnapshot[],
  live: TranscriptTurnSnapshot,
): 'present' | 'conflict' | 'absent' {
  return canonicalTurns.reduce<'present' | 'conflict' | 'absent'>((relation, canonical) => {
    if (relation !== 'absent') return relation;
    const entryRelation = userEntryIdentityRelation(canonical, live);
    if (entryRelation === 'match') return 'present';
    if (strongTurnIdentityMatches(canonical, live)) {
      return entryRelation === 'conflict' ? 'conflict' : 'present';
    }
    return 'absent';
  }, 'absent');
}

function pruneDurablyCanonicalizedHistoryLivePrefix(
  baseline: HistoryLiveBaseline,
  canonicalUsers: readonly UserMessage[],
  canonicalEvents: readonly SessionEvent[],
  prefixOmitted: boolean,
  authoritativeNewest: boolean,
): void {
  if (!prefixOmitted || !authoritativeNewest || baseline.durableCanonicalizedUserIds.size === 0) {
    return;
  }
  const canonicalTurns = transcriptTurnSnapshots(canonicalUsers, canonicalEvents);
  const prunedIds = new Set(
    transcriptTurnSnapshots(baseline.userMessages, baseline.events).flatMap((live) =>
      baseline.durableCanonicalizedUserIds.has(live.messageId) &&
      canonicalLiveTurnRelation(canonicalTurns, live) === 'absent'
        ? [live.messageId]
        : [],
    ),
  );
  pruneHistoryLiveOwners(baseline, prunedIds);
}

function clearHistoryLiveBaseline(sessionId: string): void {
  historyLiveBaselines.delete(sessionId);
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
  /** Exact session.send operation identity, available before the queue ACK returns. */
  readonly operationId?: string;
  readonly operationReservation?: SendOperationReservation;
  readonly sendAdmissionSettled?: true;
  readonly content: string;
  readonly matchContent: string;
  readonly attachments?: readonly UserImageAttachment[];
  readonly queueMode: 'interrupt' | 'after-turn';
  readonly status: 'pending-ack' | 'queued' | 'failed';
  readonly failureReason?: Extract<SessionEvent, { kind: 'queued_user_prompt_failed' }>['reason'];
  readonly sentAt: number;
}

export type LocalSendOperationMessage =
  | { readonly kind: 'user'; readonly id: string }
  | { readonly kind: 'queued'; readonly id: string }
  | { readonly kind: 'settled'; readonly id: string };

export type SendOperationRollbackResult = 'retained' | 'rolled-back' | 'settled' | 'stale';
export type SendOperationFailureDisposition = 'ambiguous' | 'definitive';

interface ReserveSendOperationInput {
  readonly content: string;
  readonly matchContent?: string;
  readonly queueMode: 'interrupt' | 'after-turn';
  readonly operationId: string;
  readonly requestGeneration: number;
  readonly queued: boolean;
  readonly sentAt?: number;
  readonly attachments?: readonly UserImageAttachment[];
}

interface SendOperationReservation {
  readonly requestGeneration: number;
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

interface PendingSendRuntimeBaseline {
  readonly requestGeneration: number;
  readonly runtimeId?: string;
  /** Per-Session observation sequence; never compare it with the aggregate profile cursor. */
  readonly liveCursorSeq: number;
  readonly liveCursorSessionId?: string;
  readonly liveCursorJournalEpoch?: string;
  /** Aggregate profile sequence; causal only within the profile projection stream. */
  readonly profileCursorSeq: number;
  readonly acceptedRunId?: string;
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
  /** session.delete IPC 在途的 sessionId 集合——侧栏行据此显示"删除中"（dim + spinner + 禁交互）。*/
  deletingSessionIds: ReadonlySet<string>;
  /** session.delete 已成功、行收起动画播放中；动画结束后由流程 helper 调 removeSession 收尾。*/
  removingSessionIds: ReadonlySet<string>;
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
   * 每个 sessionId「已查看过的 terminal runId」——用户切进该 session 时记下当时
   * lastTerminalRun.runId。useSessionStatus 据此熄灭 runtime 投影路径的 error 红点：
   * runId 相同视为已看过；新一轮 failed/interrupted 的 runId 不同，红点重新亮起。
   */
  errorSeenRunIdBySession: Readonly<Record<string, string>>;
  /** All terminal Runtime Runs acknowledged while visiting a Session; bounded per Session. */
  errorSeenRunIdsBySession: Readonly<Record<string, readonly string[]>>;
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
  /** Stable render-busy projection for root context compaction; avoids rescanning event history. */
  compactingBySession: Readonly<Record<string, true | undefined>>;
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
  pendingSendRuntimeBaselineBySession: Readonly<
    Record<string, PendingSendRuntimeBaseline | undefined>
  >;
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
    items: readonly SessionHistoryItem[],
    fallbackSentAt: number,
    options?: {
      readonly replaceLoadedWindow?: boolean;
      /** Older replacement windows do not mix a newer live transcript into the browsing page. */
      readonly includeLiveProjection?: boolean;
      /** Canonical index namespace for conservative live-baseline pruning. */
      readonly sourceRevision?: string;
      /** This resolved replacement is the authoritative newest canonical window. */
      readonly authoritativeNewest?: boolean;
      /** Runs proven durable by this exact post-terminal history read. */
      readonly settledRuntimeRuns?: readonly SettledRuntimeHistoryRun[];
      /** Daemon conversation projection status. Only an 'ambiguous' page carries proven clone
       * candidates that share logicalId and must be deduped; a resolved page never dedupes. */
      readonly conversationStatus?: 'resolved' | 'partial' | 'ambiguous';
    },
  ): void;
  /** Drop only the replaceable history projection while retaining independent live rows. */
  evictRestoredSessionHistory(sessionId: string): void;
  /** sentAt 可选——缺省 Date.now()；history restore 时传 session.createdAt 让旧消息显示真实时间。 */
  appendUserMessage(
    sessionId: string,
    content: string,
    sentAt?: number,
    attachments?: readonly UserImageAttachment[],
    operationId?: string,
  ): string | null;
  reserveSendOperationMessage(
    sessionId: string,
    input: ReserveSendOperationInput,
  ): LocalSendOperationMessage | null;
  rollbackSendOperationMessage(
    sessionId: string,
    operationId: string,
    expectedGeneration: number | undefined,
    failureDisposition: SendOperationFailureDisposition,
  ): SendOperationRollbackResult;
  settleSendOperationMessage(sessionId: string, operationId: string): void;
  /** Record the exact Runtime Run admitted by session.send, independent of transcript rows. */
  acknowledgePendingSendRun(sessionId: string, runId: string, expectedGeneration?: number): void;
  /** Bind the exact optimistic row to the fresh Runtime Run acknowledged by session.send. */
  bindUserMessageRuntimeRun(sessionId: string, messageId: string, runId: string): void;
  updateUserMessageAttachments(
    sessionId: string,
    messageId: string,
    attachments: readonly UserImageAttachment[],
  ): void;
  updateSendOperationAttachments(
    sessionId: string,
    operationId: string,
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
      readonly operationId?: string;
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
  promoteQueuedUserMessage(sessionId: string, localId: string, sentAt?: number): string | null;
  convertUserMessageToQueued(
    sessionId: string,
    messageId: string,
    input: {
      readonly content: string;
      readonly matchContent?: string;
      readonly queueMode: 'interrupt' | 'after-turn';
      readonly sentAt?: number;
    },
  ): string | null;
  appendWorkflowNotice(sessionId: string, content: string, sentAt?: number, key?: string): void;
  /**
   * Remove the exact optimistic row owned by a failed send. A timed-out send may settle after a
   * newer request has appended another row, so content/last-row matching is not a safe fence.
   */
  rollbackUserMessage(sessionId: string, messageId: string): void;
  upsertSession(meta: SessionMeta): void;
  removeSession(sessionId: string): void;
  markSessionDeleting(sessionId: string): void;
  unmarkSessionDeleting(sessionId: string): void;
  markSessionRemoving(sessionId: string): void;
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
  replaceSessionLiveProjection(
    projection: SpaceSessionLiveProjectionT,
    options?: { readonly allowEqualHydration?: boolean },
  ): boolean;
  applySessionLiveProjectionChange(change: SpaceSessionLiveChangedT): ApplySessionLiveChangeStatus;
  invalidateSessionLiveProjection(invalidation: SpaceSessionLiveInvalidatedT): void;
  /** 用户在无 session 时点 picker → 暂存到 pending；下次 session.create 优先用。*/
  setPendingProviderId(id: string | null): void;
  setPendingReasoningMode(mode: SessionMeta['reasoningMode'] | null): void;
  setPendingPermissionMode(mode: SessionMeta['permissionMode'] | null): void;
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
  setPendingSend(
    sessionId: string,
    pending: boolean,
    expectedGeneration?: number,
  ): number | undefined;
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
let pendingSendGenerationCounter = 0;
let lastLocalTranscriptSentAt = 0;
const MAX_LOCAL_NOTICES_PER_SESSION = 32;
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
const LS_KEY_PENDING_AGENT = 'kodax-space.pendingAgentMode';
// pendingModel 是 provider-specific 字符串 (eg "anthropic/claude-opus-4-8")，
// 不像 mode 是封闭 enum——用宽校验：非空 + 长度上限避免 LS 被改成异常长字符串。
const LS_KEY_PENDING_MODEL = 'kodax-space.pendingModel';
const LS_KEY_MASCOT_MODE = 'kodax-space.mascotMode';
const LS_KEY_MASCOT_ENABLED = 'kodax-space.mascotEnabled';
const LS_KEY_SMART_POPOUT = 'kodax-space.smartPopoutEnabled';
const LS_KEY_NATIVE_COMPLETION_NOTIFICATIONS = 'kodax-space.nativeCompletionNotificationsEnabled';
const LS_KEY_SESSION_TOKEN_USAGE = 'kodax-space.sessionTokenUsage.v1';
const LS_KEY_ERROR_SEEN_RUN_IDS = 'kodax-space.errorSeenRunIds.v1';
const MAX_PERSISTED_ERROR_SEEN_SESSIONS = 512;
const PENDING_MODEL_MAX_LEN = 256;
const MASCOT_MODE_VALUES = ['legacy', 'sprite', 'off'] as const;

// 持久化 pending* 模式时校验合法 enum 值，避免 LS 被改成非法值后崩 (typescript 编译期没法知道)
const PERMISSION_MODE_VALUES = ['plan', 'accept-edits', 'auto', 'full-access'] as const;
const AGENT_MODE_VALUES = ['ama', 'sa'] as const;

function readPersistedPermissionMode(): SessionMeta['permissionMode'] | null {
  const v = lsGet(LS_KEY_PENDING_PERMISSION);
  return v !== null && (PERMISSION_MODE_VALUES as readonly string[]).includes(v)
    ? (v as SessionMeta['permissionMode'])
    : null;
}
function readPersistedReasoningMode(): SessionMeta['reasoningMode'] | null {
  const v = lsGet(LS_KEY_PENDING_REASONING);
  const parsed = reasoningModeSchema.safeParse(v);
  return parsed.success ? parsed.data : null;
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

function readPersistedErrorSeenRunIds(): Readonly<Record<string, readonly string[]>> {
  const raw = lsGet(LS_KEY_ERROR_SEEN_RUN_IDS);
  if (raw === null) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const entries: Array<[string, readonly string[]]> = [];
    for (const [sessionId, value] of Object.entries(parsed)) {
      if (sessionId.length === 0 || sessionId.length > 256 || !Array.isArray(value)) continue;
      const runIds = value
        .filter((runId): runId is string => typeof runId === 'string' && runId.length <= 256)
        .slice(-16);
      if (runIds.length > 0) entries.push([sessionId, [...new Set(runIds)]]);
    }
    return Object.fromEntries(entries.slice(-MAX_PERSISTED_ERROR_SEEN_SESSIONS));
  } catch {
    return {};
  }
}

function persistErrorSeenRunIds(seenBySession: Readonly<Record<string, readonly string[]>>): void {
  const entries = Object.entries(seenBySession)
    .filter((entry) => entry[1].length > 0)
    .slice(-MAX_PERSISTED_ERROR_SEEN_SESSIONS);
  lsSet(
    LS_KEY_ERROR_SEEN_RUN_IDS,
    entries.length > 0 ? JSON.stringify(Object.fromEntries(entries)) : null,
  );
}

function isSessionVisiblyOpen(state: AppState, sessionId: string): boolean {
  if (state.currentSessionId !== sessionId) return false;
  if (typeof document === 'undefined') return true;
  return !document.hidden && document.hasFocus();
}

const MAX_MERGED_LIVE_EVENT_TEXT = 256 * 1024;
type StreamDeltaEvent = Extract<SessionEvent, { kind: 'text_delta' | 'thinking_delta' }>;

function isStreamDeltaEvent(event: SessionEvent): event is StreamDeltaEvent {
  return event.kind === 'text_delta' || event.kind === 'thinking_delta';
}

function liveEventRuntimeOriginsMatch(previous: SessionEvent, event: SessionEvent): boolean {
  const previousOrigin = 'runtimeEvent' in previous ? previous.runtimeEvent : undefined;
  const eventOrigin = 'runtimeEvent' in event ? event.runtimeEvent : undefined;
  if (previousOrigin === undefined || eventOrigin === undefined) {
    return previousOrigin === undefined && eventOrigin === undefined;
  }
  return (
    previousOrigin.runtimeId === eventOrigin.runtimeId &&
    previousOrigin.runId === eventOrigin.runId &&
    previousOrigin.journalEpoch === eventOrigin.journalEpoch
  );
}

function liveEventRuntimeSequenceIsContinuous(
  previous: SessionEvent,
  event: SessionEvent,
): boolean {
  const previousOrigin = 'runtimeEvent' in previous ? previous.runtimeEvent : undefined;
  const eventOrigin = 'runtimeEvent' in event ? event.runtimeEvent : undefined;
  if (previousOrigin === undefined || eventOrigin === undefined) {
    return previousOrigin === undefined && eventOrigin === undefined;
  }
  return (
    liveEventRuntimeOriginsMatch(previous, event) && eventOrigin.seq === previousOrigin.seq + 1
  );
}

function runtimeJournalEventWasApplied(
  events: readonly SessionEvent[],
  event: SessionEvent,
): boolean {
  const incoming = 'runtimeEvent' in event ? event.runtimeEvent : undefined;
  if (incoming?.journalEpoch === undefined) return false;

  for (let index = events.length - 1; index >= 0; index--) {
    const candidate = events[index]!;
    const existing = 'runtimeEvent' in candidate ? candidate.runtimeEvent : undefined;
    if (
      existing === undefined ||
      existing.runtimeId !== incoming.runtimeId ||
      existing.runId !== incoming.runId ||
      existing.journalEpoch !== incoming.journalEpoch
    ) {
      continue;
    }
    if (existing.seq > incoming.seq) return true;
    if (existing.seq < incoming.seq) return false;
    if (candidate.kind !== event.kind) continue;
    if (event.kind === 'mid_turn_user_prompt') {
      const candidateInputId =
        candidate.kind === event.kind ? (candidate.queueId ?? candidate.entryId) : undefined;
      const inputId = event.queueId ?? event.entryId;
      if (inputId === undefined || candidateInputId === undefined) continue;
      if (candidateInputId !== inputId) continue;
    }
    if (event.kind === 'queued_user_prompt_started') {
      const candidateQueueId = candidate.kind === event.kind ? candidate.queueId : undefined;
      if (event.queueId === undefined || candidateQueueId === undefined) continue;
      if (candidateQueueId !== event.queueId) continue;
    }
    return true;
  }
  return false;
}

function appendSessionEvent(
  bucket: readonly SessionEvent[],
  event: SessionEvent,
  snapshotCursor: RuntimeSnapshotEventBarrier | undefined,
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
    last !== undefined &&
    isStreamDeltaEvent(last) &&
    isStreamDeltaEvent(event) &&
    last.kind === event.kind &&
    liveEventRuntimeSequenceIsContinuous(last, event) &&
    runtimeDeltasShareSnapshotSide(last, event, snapshotCursor) &&
    last.text.length + event.text.length <= MAX_MERGED_LIVE_EVENT_TEXT
  ) {
    return [
      ...bucket.slice(0, -1),
      {
        ...event,
        text: last.text + event.text,
        textStartOffset: last.textStartOffset,
        sentAt: last.sentAt ?? event.sentAt,
      },
    ];
  }
  if (
    last?.kind === 'tool_input_delta' &&
    event.kind === 'tool_input_delta' &&
    last.toolId !== undefined &&
    last.toolId === event.toolId &&
    last.toolName === event.toolName &&
    liveEventRuntimeSequenceIsContinuous(last, event) &&
    last.partialJson.length + event.partialJson.length <= MAX_MERGED_LIVE_EVENT_TEXT
  ) {
    return [
      ...bucket.slice(0, -1),
      { ...event, partialJson: last.partialJson + event.partialJson },
    ];
  }
  if (
    last?.kind === 'tool_progress' &&
    event.kind === 'tool_progress' &&
    last.toolId === event.toolId &&
    liveEventRuntimeOriginsMatch(last, event)
  ) {
    return [...bucket.slice(0, -1), event];
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
  const origin = 'runtimeEvent' in event ? event.runtimeEvent : undefined;
  if (!origin) return false;
  const barrier = state.runtimeSnapshotCursorBySession[event.sessionId];
  const coveredSeq =
    event.kind === 'text_delta' ? barrier?.assistantDraftSeq : barrier?.thinkingDraftSeq;
  return (
    barrier?.runtimeId === origin.runtimeId &&
    barrier.runId === origin.runId &&
    barrier.journalEpoch === origin.journalEpoch &&
    coveredSeq !== undefined &&
    origin.seq <= coveredSeq
  );
}

interface TranscriptTurnSnapshot {
  readonly messageId: string;
  readonly userSemantic: string;
  readonly userIndex: number;
  readonly eventStart: number;
  readonly eventEnd: number;
  readonly sentAt: number;
  readonly turnId?: string;
  readonly turnUserOrdinal?: number;
  readonly runtimeRunId?: string;
  readonly canonicalIndex?: number;
  readonly entryId?: string;
  readonly auditEntryIds?: readonly string[];
  readonly deliveredInterrupt: boolean;
  readonly restoredFromHistory: boolean;
  readonly leadingPartialHistory: boolean;
  readonly omittedHistoryUserOrdinal: boolean;
  readonly terminal: boolean;
  readonly terminalTurnId?: string;
  readonly terminalRunId?: string;
  readonly terminalRuntimeId?: string;
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

function stableUserMessageSemantic(message: Pick<UserMessage, 'content' | 'attachments'>): string {
  return stableJson({
    content: message.content,
    attachments: (message.attachments ?? []).map((attachment) => ({
      id: attachment.id,
      kind: attachment.kind,
      mediaType: attachment.mediaType,
      bytes: attachment.bytes,
      status: attachment.status,
      // label is optimistic renderer metadata that history does not persist. Capability URLs are
      // independently re-issued for live and canonical rows. Neither is durable attachment identity.
    })),
  });
}

interface ReconciledTranscriptBuffers {
  readonly userMessages: readonly UserMessage[];
  readonly events: readonly SessionEvent[];
  readonly canonicalizedLiveOwners?: readonly CanonicalizedLiveOwner[];
}

function transcriptTurnSnapshots(
  userMessages: readonly UserMessage[],
  events: readonly SessionEvent[],
): TranscriptTurnSnapshot[] {
  const turns: TranscriptTurnSnapshot[] = [];
  let eventCursor = 0;
  for (let userIndex = 0; userIndex < userMessages.length; userIndex++) {
    const message = userMessages[userIndex]!;
    const eventStart = eventCursor;
    const eventEnd =
      message.historyNoAssistantSegment === true
        ? eventCursor
        : transcriptSegmentEnd(events, eventCursor);
    const semantic = transcriptSegmentSemantic(events.slice(eventStart, eventEnd));
    turns.push({
      messageId: message.id,
      userSemantic: stableUserMessageSemantic(message),
      userIndex,
      eventStart,
      eventEnd,
      sentAt: message.sentAt,
      ...(message.turnId !== undefined ? { turnId: message.turnId } : {}),
      ...(message.turnUserOrdinal !== undefined
        ? { turnUserOrdinal: message.turnUserOrdinal }
        : {}),
      ...(message.runtimeRunId !== undefined ? { runtimeRunId: message.runtimeRunId } : {}),
      ...(message.canonicalIndex !== undefined ? { canonicalIndex: message.canonicalIndex } : {}),
      ...(message.entryId !== undefined ? { entryId: message.entryId } : {}),
      ...(message.auditEntryIds !== undefined ? { auditEntryIds: message.auditEntryIds } : {}),
      deliveredInterrupt: message.deliveredInterrupt === true,
      restoredFromHistory: message.restoredFromHistory === true,
      leadingPartialHistory: message.leadingPartialHistory === true,
      omittedHistoryUserOrdinal: message.omittedHistoryUserOrdinal === true,
      ...semantic,
      closed: semantic.terminal || eventEnd < events.length || userIndex < userMessages.length - 1,
    });
    eventCursor = eventEnd;
  }
  return turns;
}

type CanonicalTranscriptRecordKind =
  'user' | 'assistant' | 'tool' | 'sidecar' | 'lineage' | 'workflow';

interface CanonicalTranscriptRecord {
  readonly kind: CanonicalTranscriptRecordKind;
  readonly entryId: string;
  readonly canonicalIndex: number;
  readonly turnIndex: number;
  readonly turnId?: string;
  readonly turnUserOrdinal?: number;
  readonly userSemantic?: string;
  readonly eventIndex?: number;
}

function canonicalHistoryEventKind(event: SessionEvent): CanonicalTranscriptRecordKind | undefined {
  if (event.kind === 'text_delta' || event.kind === 'thinking_delta') return 'assistant';
  if (event.kind === 'tool_start' || event.kind === 'tool_result') return 'tool';
  if (event.kind === 'sidecar_message') return 'sidecar';
  if (event.kind === 'lineage_notice') return 'lineage';
  if (event.kind === 'workflow_notice') return 'workflow';
  return undefined;
}

function canonicalHistoryEventRecord(
  event: SessionEvent,
  eventIndex: number,
  turnIndex: number,
): CanonicalTranscriptRecord | undefined {
  const kind = canonicalHistoryEventKind(event);
  if (
    kind === undefined ||
    !restoredHistoryEvents.has(event) ||
    !('entryId' in event) ||
    typeof event.entryId !== 'string' ||
    !('canonicalIndex' in event) ||
    typeof event.canonicalIndex !== 'number'
  ) {
    return undefined;
  }
  const turnId = 'turnId' in event && typeof event.turnId === 'string' ? event.turnId : undefined;
  return {
    kind,
    entryId: event.entryId,
    canonicalIndex: event.canonicalIndex,
    turnIndex,
    eventIndex,
    ...(turnId !== undefined ? { turnId } : {}),
  };
}

function canonicalTranscriptRecords(
  events: readonly SessionEvent[],
  turns: readonly TranscriptTurnSnapshot[],
): CanonicalTranscriptRecord[] {
  const records: CanonicalTranscriptRecord[] = [];
  const seen = new Set<string>();
  for (const [turnIndex, turn] of turns.entries()) {
    if (
      turn.restoredFromHistory &&
      turn.entryId !== undefined &&
      turn.canonicalIndex !== undefined
    ) {
      records.push({
        kind: 'user',
        entryId: turn.entryId,
        canonicalIndex: turn.canonicalIndex,
        turnIndex,
        userSemantic: turn.userSemantic,
        ...(turn.turnId !== undefined ? { turnId: turn.turnId } : {}),
        ...(turn.turnUserOrdinal !== undefined ? { turnUserOrdinal: turn.turnUserOrdinal } : {}),
      });
    }
    for (let eventIndex = turn.eventStart; eventIndex < turn.eventEnd; eventIndex += 1) {
      const record = canonicalHistoryEventRecord(events[eventIndex]!, eventIndex, turnIndex);
      if (record === undefined) continue;
      const key = `${record.kind}\u0000${record.entryId}\u0000${record.canonicalIndex}`;
      if (seen.has(key)) continue;
      seen.add(key);
      records.push(record);
    }
  }
  return records;
}

function sameCanonicalTranscriptRecord(
  current: CanonicalTranscriptRecord,
  incoming: CanonicalTranscriptRecord,
): boolean {
  if (
    current.kind !== incoming.kind ||
    current.entryId !== incoming.entryId ||
    current.canonicalIndex !== incoming.canonicalIndex
  ) {
    return false;
  }
  if (current.turnId !== undefined && incoming.turnId !== undefined) {
    if (current.turnId !== incoming.turnId) return false;
  }
  if (current.kind !== 'user') return true;
  return (
    current.userSemantic === incoming.userSemantic &&
    !(
      current.turnUserOrdinal !== undefined &&
      incoming.turnUserOrdinal !== undefined &&
      current.turnUserOrdinal !== incoming.turnUserOrdinal
    )
  );
}

function appendTranscriptTurn(
  users: UserMessage[],
  events: SessionEvent[],
  sourceUsers: readonly UserMessage[],
  sourceEvents: readonly SessionEvent[],
  turn: TranscriptTurnSnapshot,
): void {
  const sourceUser = sourceUsers[turn.userIndex]!;
  const previousSentAt = users[users.length - 1]?.sentAt ?? Number.NEGATIVE_INFINITY;
  const sentAt = Math.max(sourceUser.sentAt, previousSentAt + 1);
  users.push(sentAt === sourceUser.sentAt ? sourceUser : { ...sourceUser, sentAt });
  events.push(...sourceEvents.slice(turn.eventStart, turn.eventEnd));
}

function appendTranscriptTurnWithEvents(
  users: UserMessage[],
  events: SessionEvent[],
  sourceUser: UserMessage,
  turnEvents: readonly SessionEvent[],
): void {
  const previousSentAt = users[users.length - 1]?.sentAt ?? Number.NEGATIVE_INFINITY;
  const sentAt = Math.max(sourceUser.sentAt, previousSentAt + 1);
  users.push(sentAt === sourceUser.sentAt ? sourceUser : { ...sourceUser, sentAt });
  events.push(...turnEvents);
}

function retainLoadedHistoryPrefix(
  currentUsers: readonly UserMessage[],
  currentEvents: readonly SessionEvent[],
  incomingUsers: readonly UserMessage[],
  incomingEvents: readonly SessionEvent[],
): ReconciledTranscriptBuffers {
  // The canonicalIndex discipline below is self-verifying: a complete newest page starts at
  // the earliest canonical index (nothing older exists to retain), an older browsing window
  // holds only indexes below the loaded ones, and a compaction re-root restarts at zero. Do
  // not gate retention on an explicit history_truncation marker: the ordinary bounded newest
  // window omits the loaded prefix without one, and a mid-run replacement of that window
  // collapsed the conversation to the page (history shrinking until Ctrl+R).
  const incomingTurns = transcriptTurnSnapshots(incomingUsers, incomingEvents);
  const currentTurns = transcriptTurnSnapshots(currentUsers, currentEvents);
  const incomingRecords = canonicalTranscriptRecords(incomingEvents, incomingTurns);
  const firstCanonical = incomingRecords[0];
  if (firstCanonical === undefined) return { userMessages: incomingUsers, events: incomingEvents };
  const currentRecords = canonicalTranscriptRecords(currentEvents, currentTurns);
  const currentCanonical = currentRecords.find((record) =>
    sameCanonicalTranscriptRecord(record, firstCanonical),
  );
  if (currentCanonical === undefined) {
    return { userMessages: incomingUsers, events: incomingEvents };
  }
  const canonicalTurnIndexes = new Set(currentRecords.map((record) => record.turnIndex));
  const retained = currentTurns
    .slice(0, currentCanonical.turnIndex)
    .filter((turn, turnIndex) => turn.restoredFromHistory && canonicalTurnIndexes.has(turnIndex));

  const users: UserMessage[] = [];
  const events: SessionEvent[] = [];
  for (const turn of incomingTurns.slice(0, firstCanonical.turnIndex)) {
    appendTranscriptTurn(users, events, incomingUsers, incomingEvents, turn);
  }
  for (const turn of retained) {
    appendTranscriptTurn(users, events, currentUsers, currentEvents, turn);
  }
  if (firstCanonical.eventIndex !== undefined && currentCanonical.eventIndex !== undefined) {
    const currentTurn = currentTurns[currentCanonical.turnIndex]!;
    const incomingTurn = incomingTurns[firstCanonical.turnIndex]!;
    appendTranscriptTurnWithEvents(users, events, currentUsers[currentTurn.userIndex]!, [
      ...currentEvents.slice(currentTurn.eventStart, currentCanonical.eventIndex),
      ...incomingEvents.slice(incomingTurn.eventStart, incomingTurn.eventEnd),
    ]);
  } else {
    appendTranscriptTurn(
      users,
      events,
      incomingUsers,
      incomingEvents,
      incomingTurns[firstCanonical.turnIndex]!,
    );
  }
  for (const turn of incomingTurns.slice(firstCanonical.turnIndex + 1)) {
    appendTranscriptTurn(users, events, incomingUsers, incomingEvents, turn);
  }
  return { userMessages: users, events };
}

function transcriptCutForSelectorTurn(
  userMessages: readonly UserMessage[],
  events: readonly SessionEvent[],
  selectorTurnIndex: number,
): { readonly userEnd: number; readonly eventEnd: number } | null {
  const userIndex = bufferIndexForSelectorTurn(userMessages, selectorTurnIndex);
  if (userIndex < 0) return null;
  const snapshot = transcriptTurnSnapshots(userMessages, events).find(
    (turn) => turn.userIndex === userIndex,
  );
  if (!snapshot) return null;
  return { userEnd: userIndex + 1, eventEnd: snapshot.eventEnd };
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
        terminalBelongsToSameCompatibilitySegment(event, events[end]!)
      ) {
        end++;
      }
      return end;
    }
  }
  return events.length;
}

function terminalBelongsToSameCompatibilitySegment(
  first: SessionEvent,
  candidate: SessionEvent,
): boolean {
  if (
    (first.kind !== 'session_complete' && first.kind !== 'session_error') ||
    (candidate.kind !== 'session_complete' && candidate.kind !== 'session_error')
  ) {
    return false;
  }
  if (first.turnId !== undefined || candidate.turnId !== undefined) {
    return first.turnId !== undefined && first.turnId === candidate.turnId;
  }
  // Legacy embedded adapters could emit error -> complete -> wrapped error for one failed turn.
  // Preserve that exact compatibility family, but never let a successful completion swallow an
  // unowned failure from the next prompt. Modern live failures are assigned a renderer-local turn
  // identity before they enter the event buffer.
  return first.kind === 'session_error';
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
  promptSentAt?: number,
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
    const sentAt =
      promptSentAt === undefined
        ? nextUserMessageSentAtAfter(aligned)
        : Math.max(Number.MIN_SAFE_INTEGER, promptSentAt - missingOwners + index);
    aligned.push({
      ...createUserMessage(sessionId, '', sentAt),
      hiddenHistoryAnchor: true,
    });
  }
  return aligned;
}

function transcriptSegmentSemantic(
  events: readonly SessionEvent[],
): Pick<
  TranscriptTurnSnapshot,
  | 'terminal'
  | 'terminalTurnId'
  | 'terminalRunId'
  | 'terminalRuntimeId'
  | 'thinking'
  | 'text'
  | 'tools'
  | 'notices'
  | 'visibleSequence'
> {
  let terminal = false;
  let terminalTurnId: string | undefined;
  let terminalRunId: string | undefined;
  let terminalRuntimeId: string | undefined;
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
      const runScopedTerminalRunId =
        'runtimeEvent' in event ? event.runtimeEvent?.runId : undefined;
      if (runScopedTerminalRunId !== undefined) terminalRunId = runScopedTerminalRunId;
      const runScopedTerminalRuntimeId =
        'runtimeEvent' in event ? event.runtimeEvent?.runtimeId : undefined;
      if (runScopedTerminalRuntimeId !== undefined) {
        terminalRuntimeId = runScopedTerminalRuntimeId;
      }
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
    } else if (event.kind === 'history_truncation') {
      const notice = `history-truncation:${event.scope}`;
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
    ...(terminalRunId !== undefined ? { terminalRunId } : {}),
    ...(terminalRuntimeId !== undefined ? { terminalRuntimeId } : {}),
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

type UserEntryIdentityRelation = 'match' | 'conflict' | 'unknown';

function userEntryIdentityRelation(
  left: TranscriptTurnSnapshot,
  right: TranscriptTurnSnapshot,
): UserEntryIdentityRelation {
  if (left.entryId === undefined || right.entryId === undefined) return 'unknown';
  const leftIds = new Set([left.entryId, ...(left.auditEntryIds ?? [])]);
  const rightIds = [right.entryId, ...(right.auditEntryIds ?? [])];
  return rightIds.some((entryId) => leftIds.has(entryId)) ? 'match' : 'conflict';
}

type TurnProjectionAuthority = 'canonical' | 'live' | 'coexist_fail_open';

interface CertifiedCanonicalTranscriptAuthority {
  readonly sourceRevision: string;
  readonly canonicalMessageIds: ReadonlySet<string>;
  readonly settledRuntimeRuns: readonly SettledRuntimeHistoryRun[];
}

/** Identity and persistence facts decide authority; transcript content and event order never do. */
function decideTurnProjectionAuthority(
  durable: TranscriptTurnSnapshot,
  live: TranscriptTurnSnapshot,
  authority: CertifiedCanonicalTranscriptAuthority | undefined,
): TurnProjectionAuthority {
  if (authority === undefined || !durable.restoredFromHistory || live.restoredFromHistory) {
    return live.closed ? 'coexist_fail_open' : 'live';
  }
  if (
    !authority.canonicalMessageIds.has(durable.messageId) ||
    durable.canonicalIndex === undefined
  ) {
    return 'coexist_fail_open';
  }
  const entryIdentity = userEntryIdentityRelation(durable, live);
  const exactOwner =
    entryIdentity === 'match' ||
    (entryIdentity !== 'conflict' &&
      !durable.leadingPartialHistory &&
      !durable.omittedHistoryUserOrdinal &&
      strongTurnIdentityMatches(durable, live));
  if (!exactOwner || !live.terminal || live.runtimeRunId === undefined) {
    return 'coexist_fail_open';
  }
  if (
    live.terminalRunId !== live.runtimeRunId ||
    live.terminalRuntimeId === undefined ||
    (durable.runtimeRunId !== undefined && durable.runtimeRunId !== live.runtimeRunId) ||
    (live.terminalTurnId !== undefined &&
      live.turnId !== undefined &&
      live.terminalTurnId !== live.turnId)
  ) {
    return 'coexist_fail_open';
  }
  // A terminal-scoped newest read can race persistence and hold only the turn's
  // user boundary while none of its assistant rows. Certifying that page hands
  // the turn to a canonical shell that lacks the painted answer until the next
  // reload. Withhold certification so the closed-causal empty-durable adoption
  // keeps the live content under the canonical owner instead.
  const liveHasAssistantContent =
    live.text.length > 0 || live.thinking.length > 0 || live.tools.length > 0;
  if (liveHasAssistantContent && durable.eventStart === durable.eventEnd) {
    return 'coexist_fail_open';
  }
  return authority.settledRuntimeRuns.some(
    (run) => run.runtimeId === live.terminalRuntimeId && run.runId === live.runtimeRunId,
  )
    ? 'canonical'
    : 'coexist_fail_open';
}

type LeadingHistoryOwnerResolution =
  | { readonly kind: 'promote_live_owner' | 'enrich_canonical_owner' }
  | {
      readonly kind: 'promote_open_live_owner';
      readonly liveEvents: readonly SessionEvent[];
      readonly match: CausalProjectionMatch;
    };

function visibleProjectionIsSuffix(durable: readonly string[], live: readonly string[]): boolean {
  if (durable.length === 0 || durable.length > live.length) return false;
  const offset = live.length - durable.length;
  // SDK paging retains whole canonical entries, so an in-entry text suffix is not sufficient
  // identity and would make projection merging duplicate the overlapping text. Only an exact
  // sequence suffix is admissible; earlier whole thinking/tool/text entries may be absent.
  return durable.every((value, index) => live[offset + index] === value);
}

function uniqueLeadingHistoryOwnerResolution(
  durable: TranscriptTurnSnapshot,
  duplicate: TranscriptTurnSnapshot,
  turns: readonly TranscriptTurnSnapshot[],
  events: readonly SessionEvent[],
): LeadingHistoryOwnerResolution | undefined {
  if (
    !durable.restoredFromHistory ||
    (!durable.leadingPartialHistory && !durable.omittedHistoryUserOrdinal) ||
    durable.turnId === undefined ||
    durable.turnUserOrdinal !== undefined ||
    duplicate.restoredFromHistory ||
    !hasStrongTurnIdentity(duplicate) ||
    duplicate.turnId !== durable.turnId
  ) {
    return undefined;
  }
  if (durable.leadingPartialHistory) {
    const durableProjection = events.slice(durable.eventStart, durable.eventEnd);
    const effectiveCausalProjection = effectiveCausalLiveProjection(
      events.slice(duplicate.eventStart, duplicate.eventEnd),
    );
    const causalProjectionMatch =
      effectiveCausalProjection === undefined
        ? undefined
        : orderedCausalProjectionMatch(durableProjection, effectiveCausalProjection);
    if (!liveTurnCanFold(duplicate) && effectiveCausalProjection === undefined) return undefined;
    // A later mid-turn prompt cannot own the assistant prefix which precedes its user boundary.
    // The canonical response must also map to one unique contiguous live content span; turnId
    // identifies the Runtime run, not an inner user segment.
    if (
      duplicate.turnUserOrdinal !== 0 ||
      !(effectiveCausalProjection === undefined
        ? visibleProjectionIsSuffix(durable.visibleSequence, duplicate.visibleSequence)
        : causalProjectionMatch !== undefined)
    ) {
      return undefined;
    }
    // The omitted page head does not prove whether it falls before or after a later inner-user
    // boundary. While the turn is open, require exactly one same-turn live owner of any ordinal.
    const sameTurnLiveOwners = turns.filter(
      (candidate) => !candidate.restoredFromHistory && candidate.turnId === durable.turnId,
    );
    const possibleLiveOwners = duplicate.closed
      ? sameTurnLiveOwners.filter(
          (candidate) => candidate.turnUserOrdinal === undefined || candidate.turnUserOrdinal === 0,
        )
      : sameTurnLiveOwners;
    if (
      possibleLiveOwners.length !== 1 ||
      possibleLiveOwners[0]?.messageId !== duplicate.messageId
    ) {
      return undefined;
    }
    // A retained canonical ordinal zero or unidentified same-turn user is still ambiguous. A
    // retained strong ordinal greater than zero is a later boundary and cannot own this prefix.
    const hasRetainedCanonicalOwner = turns.some(
      (candidate) =>
        candidate.messageId !== durable.messageId &&
        candidate.restoredFromHistory &&
        !candidate.leadingPartialHistory &&
        candidate.turnId === durable.turnId &&
        (candidate.turnUserOrdinal === undefined || candidate.turnUserOrdinal === 0),
    );
    if (hasRetainedCanonicalOwner) return undefined;
    if (duplicate.closed) return { kind: 'promote_live_owner' };
    if (effectiveCausalProjection === undefined || causalProjectionMatch === undefined)
      return undefined;
    return {
      kind: 'promote_open_live_owner',
      liveEvents: effectiveCausalProjection,
      match: causalProjectionMatch,
    };
  }
  if (!liveTurnCanFold(duplicate)) return undefined;
  // Outside a leading partial page, one same-turn live user is required because a Runtime turn can
  // contain several real inputs and no omitted assistant prefix constrains their ownership.
  const unique =
    turns.filter(
      (candidate) =>
        !candidate.restoredFromHistory &&
        hasStrongTurnIdentity(candidate) &&
        candidate.turnId === durable.turnId,
    ).length === 1;
  if (!unique) return undefined;
  // A shared Runtime turn can contain several sequential user inputs, including history rows not
  // present in the current bounded window. Uniqueness among the live rows is therefore necessary
  // but not sufficient for a real canonical user: its visible payload must also be identical.
  if (durable.userSemantic !== duplicate.userSemantic) return undefined;
  const hasOmittedCanonicalPrefix = turns.some(
    (candidate) =>
      candidate.restoredFromHistory &&
      candidate.notices.some((notice) => notice.startsWith('history-truncation:')),
  );
  if (hasOmittedCanonicalPrefix) return undefined;
  const matchingCanonicalOwners = turns.filter(
    (candidate) =>
      candidate.restoredFromHistory &&
      !candidate.leadingPartialHistory &&
      candidate.turnId === durable.turnId &&
      candidate.userSemantic === duplicate.userSemantic,
  ).length;
  // Repeated identical prompts inside one Runtime turn are legal. Without canonical ordinals a
  // single live row cannot prove which identical canonical boundary it represents.
  return matchingCanonicalOwners === 1 ? { kind: 'enrich_canonical_owner' } : undefined;
}

function exactRestoredTurnIdentityMatches(
  left: TranscriptTurnSnapshot,
  right: TranscriptTurnSnapshot,
): boolean {
  if (!left.restoredFromHistory || !right.restoredFromHistory) return false;
  if (left.canonicalIndex !== undefined || right.canonicalIndex !== undefined) {
    return (
      left.canonicalIndex !== undefined &&
      right.canonicalIndex !== undefined &&
      left.canonicalIndex === right.canonicalIndex
    );
  }
  // Legacy full-history readers lacked canonical indexes. Their Runtime turn + visible ordinal is
  // still the strongest persisted identity available and preserves idempotency for an identical
  // replay. Paged Runtime rows always carry canonicalIndex, so ambiguous cross-page ordinals never
  // enter this compatibility branch.
  return strongTurnIdentityMatches(left, right);
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

function cumulativeProjectionTextSuffix(durable: string, live: string): string {
  if (live.length === 0 || durable.includes(live)) return '';
  return live.startsWith(durable) ? live.slice(durable.length) : '';
}

function projectionSuffixChunks(
  events: readonly SessionEvent[],
  kind: 'text_delta' | 'thinking_delta',
  suffix: string,
): ReadonlyMap<number, string> {
  const chunks = new Map<number, string>();
  let remaining = suffix.length;
  for (let index = events.length - 1; index >= 0 && remaining > 0; index--) {
    const event = events[index]!;
    if (event.kind !== kind) continue;
    const length = Math.min(event.text.length, remaining);
    if (length > 0) chunks.set(index, event.text.slice(-length));
    remaining -= length;
  }
  return chunks;
}

function projectionNoticeKey(event: SessionEvent): string | undefined {
  // History can only reconstruct a neutral Sidecar receipt: verdict/delivery are placeholders and
  // `historical` is true. Source + content are the stable semantic identity shared with the live
  // journal event; per-turn multiplicity is handled by the callers' counters.
  if (event.kind === 'sidecar_message') {
    return `sidecar:${event.message.source}:${event.message.content}`;
  }
  if (event.kind === 'lineage_notice') {
    if (event.entryId !== undefined) return `lineage-entry:${event.entryId}`;
    if (event.provisionalId !== undefined) return `lineage-provisional:${event.provisionalId}`;
    return `lineage:${event.noticeKind}:${event.text}`;
  }
  if (event.kind === 'workflow_notice') return `workflow:${event.text}`;
  if (event.kind === 'history_truncation') return `history-truncation:${event.scope}`;
  return undefined;
}

function projectionMergeKey(event: SessionEvent): string | undefined {
  const noticeKey = projectionNoticeKey(event);
  if (noticeKey !== undefined) return noticeKey;
  if (event.kind !== 'compact_stats' || event.contextKind === 'child') return undefined;
  return `compact:${stableJson({
    tokensBefore: event.tokensBefore,
    tokensAfter: event.tokensAfter,
    contextId: event.contextId,
    contextRevision: event.contextRevision,
    afterRevision: event.afterRevision,
    committed: event.committed,
  })}`;
}

type TranscriptHistoryOrigin = {
  readonly entryId?: string;
  readonly auditEntryIds?: string[];
  readonly parentId?: string | null;
  readonly logicalId?: string;
  readonly sourceEntryId?: string;
  readonly authoritativeEntryId?: string;
  readonly canonicalIndex?: number;
  readonly turnId?: string;
};

function transcriptHistoryOrigin(item: SessionHistoryItem): TranscriptHistoryOrigin {
  if (item.kind === 'local_notice' || item.kind === 'history_truncation') return {};
  return {
    ...(item.entryId !== undefined ? { entryId: item.entryId } : {}),
    ...(item.auditEntryIds !== undefined ? { auditEntryIds: [...item.auditEntryIds] } : {}),
    ...(item.parentId !== undefined ? { parentId: item.parentId } : {}),
    ...(item.logicalId !== undefined ? { logicalId: item.logicalId } : {}),
    ...(item.sourceEntryId !== undefined ? { sourceEntryId: item.sourceEntryId } : {}),
    ...(item.authoritativeEntryId !== undefined
      ? { authoritativeEntryId: item.authoritativeEntryId }
      : {}),
    ...(item.canonicalIndex !== undefined ? { canonicalIndex: item.canonicalIndex } : {}),
    ...(item.turnId !== undefined ? { turnId: item.turnId } : {}),
  };
}

type CompactionNoticeEvent = Extract<SessionEvent, { kind: 'lineage_notice' }>;

function isCompactionNotice(event: SessionEvent): event is CompactionNoticeEvent {
  return event.kind === 'lineage_notice' && event.noticeKind === 'compaction';
}

function dedupePersistedCompactionBoundaries(events: readonly SessionEvent[]): SessionEvent[] {
  const entryIndex = new Map<string, number>();
  const provisionalIndex = new Map<string, number>();
  const out: Array<SessionEvent | undefined> = [];
  for (const event of events) {
    if (!isCompactionNotice(event)) {
      out.push(event);
      continue;
    }
    if (event.entryId !== undefined) {
      const exactSlot = entryIndex.get(event.entryId);
      const provisionalSlot =
        event.provisionalId === undefined ? undefined : provisionalIndex.get(event.provisionalId);
      if (exactSlot !== undefined) {
        const exact = out[exactSlot];
        if (isCompactionNotice(exact!)) {
          // Keep the first durable/canonical position while enriching it with the live
          // provisional identity. A later exact delivery must also retire its now-proven
          // placeholder, even when history restored the same physical entry first.
          out[exactSlot] = { ...exact, ...event };
          if (provisionalSlot !== undefined && provisionalSlot !== exactSlot) {
            const provisional = out[provisionalSlot];
            if (isCompactionNotice(provisional!) && provisional.entryId === undefined) {
              out[provisionalSlot] = undefined;
            }
          }
          if (event.provisionalId !== undefined) {
            provisionalIndex.set(event.provisionalId, exactSlot);
          }
        }
        continue;
      }
      if (provisionalSlot !== undefined) {
        const existing = out[provisionalSlot];
        if (
          isCompactionNotice(existing!) &&
          existing.entryId !== undefined &&
          existing.entryId !== event.entryId
        ) {
          // One Runtime event cannot legitimately resolve to two physical rows. Preserve both
          // conflicting facts instead of silently replacing history.
          entryIndex.set(event.entryId, out.length);
          out.push(event);
          continue;
        }
        out[provisionalSlot] = event;
        entryIndex.set(event.entryId, provisionalSlot);
        continue;
      }
      entryIndex.set(event.entryId, out.length);
      if (event.provisionalId !== undefined) {
        provisionalIndex.set(event.provisionalId, out.length);
      }
      out.push(event);
      continue;
    }
    if (event.provisionalId !== undefined && provisionalIndex.has(event.provisionalId)) continue;
    if (event.provisionalId !== undefined) provisionalIndex.set(event.provisionalId, out.length);
    out.push(event);
  }
  return out.filter((event): event is SessionEvent => event !== undefined);
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
 * Merge history/live projections after identity and authority have been decided independently.
 * Compatibility callers retain proven live suffixes. A certified canonical caller keeps durable
 * transcript order while retaining Runtime-only diagnostics, state and richer keyed notices.
 */
function mergeIdentityProvenTurnProjections(
  durableEvents: readonly SessionEvent[],
  liveEvents: readonly SessionEvent[],
  exactEntryIdentity = false,
  authority: 'compatible' | 'canonical' = 'compatible',
): SessionEvent[] {
  const effectiveLiveEvents = filterEffectiveOutputSegmentEvents(liveEvents);
  const liveTerminals = effectiveLiveEvents.filter(isTranscriptTerminal);
  const durableTerminals = durableEvents.filter(isTranscriptTerminal);
  // A delivered-prompt event is both Runtime state and the positional start boundary for its
  // user-owned segment. History has already reconstructed the canonical user row, so folding must
  // retain at most one such marker and keep it at index 0. Appending it after durable text would
  // turn it into an interior boundary; the next reconciliation scan would then shift every later
  // assistant segment to the following user.
  const leadingPromptBoundary =
    durableEvents.find(isPromptSegmentBoundary) ??
    effectiveLiveEvents.find(isPromptSegmentBoundary);
  const durableBody = durableEvents.filter(
    (event) => !isTranscriptTerminal(event) && !isPromptSegmentBoundary(event),
  );
  const textSuffixProjector = exactEntryIdentity
    ? cumulativeProjectionTextSuffix
    : projectionTextSuffix;
  const textSuffix =
    authority === 'canonical'
      ? ''
      : textSuffixProjector(
          projectedEventText(durableEvents, 'text_delta'),
          projectedEventText(effectiveLiveEvents, 'text_delta'),
        );
  const thinkingSuffix =
    authority === 'canonical'
      ? ''
      : textSuffixProjector(
          projectedEventText(durableEvents, 'thinking_delta'),
          projectedEventText(effectiveLiveEvents, 'thinking_delta'),
        );
  const liveTextChunks = projectionSuffixChunks(effectiveLiveEvents, 'text_delta', textSuffix);
  const liveThinkingChunks = projectionSuffixChunks(
    effectiveLiveEvents,
    'thinking_delta',
    thinkingSuffix,
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
  const durableNoticeCounts = new Map<string, number>();
  const durableNoticeIndexes = new Map<string, number[]>();
  for (let index = 0; index < mergedBody.length; index++) {
    const event = mergedBody[index]!;
    if (event.kind === 'tool_result') durableToolResultIndex.set(event.toolId, index);
    const noticeKey = projectionNoticeKey(event);
    if (noticeKey !== undefined) {
      durableNoticeCounts.set(noticeKey, (durableNoticeCounts.get(noticeKey) ?? 0) + 1);
      const indexes = durableNoticeIndexes.get(noticeKey) ?? [];
      indexes.push(index);
      durableNoticeIndexes.set(noticeKey, indexes);
    }
  }

  const liveExtras: SessionEvent[] = [];
  for (const [eventIndex, event] of effectiveLiveEvents.entries()) {
    if (isTranscriptTerminal(event) || isPromptSegmentBoundary(event)) {
      continue;
    }
    if (
      authority === 'canonical' &&
      (event.kind === 'session_start' || event.kind === 'output_segment_started')
    ) {
      continue;
    }
    if (event.kind === 'text_delta') {
      const text = liveTextChunks.get(eventIndex);
      if (text) liveExtras.push({ ...event, text });
      continue;
    }
    if (event.kind === 'thinking_delta') {
      const text = liveThinkingChunks.get(eventIndex);
      if (text) liveExtras.push({ ...event, text });
      continue;
    }
    if (event.kind === 'tool_start') {
      if (authority !== 'canonical' && !durableToolStarts.has(event.toolId)) {
        durableToolStarts.add(event.toolId);
        liveExtras.push(event);
      }
      continue;
    }
    if (event.kind === 'tool_result') {
      const durableIndex = durableToolResultIndex.get(event.toolId);
      if (durableIndex === undefined) {
        if (authority !== 'canonical') liveExtras.push(event);
      } else if (authority !== 'canonical') {
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
      const remaining = durableNoticeCounts.get(noticeKey) ?? 0;
      if (remaining === 0) liveExtras.push(event);
      else {
        if (authority === 'canonical') {
          const durableIndex = durableNoticeIndexes.get(noticeKey)?.shift();
          if (durableIndex !== undefined) mergedBody[durableIndex] = event;
        }
        if (remaining === 1) durableNoticeCounts.delete(noticeKey);
        else durableNoticeCounts.set(noticeKey, remaining - 1);
      }
      continue;
    }
    // Lifecycle, tool progress, artifact/todo/context diagnostics and other runtime-only events
    // are not reconstructed by session.history. Retain them without trying to content-normalize.
    liveExtras.push(event);
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

function liveTurnCanFold(turn: TranscriptTurnSnapshot, exactEntryIdentity = false): boolean {
  if (!turn.closed) return false;
  if (!turn.terminal) return true;
  if (turn.restoredFromHistory) return true;
  if (exactEntryIdentity && turn.entryId !== undefined) return true;
  if (turn.turnId !== undefined && turn.terminalTurnId === turn.turnId) return true;
  // A run-scoped terminal that omits turnId still proves closure for the live owner bound to
  // that Runtime Run (bindUserMessageRuntimeRun). Without this fallback one turnId-less
  // terminal blocks the fold forever, and the stale live segment resurfaces at the transcript
  // bottom on every window rebuild (multi-session terminal contention produces such terminals).
  return (
    turn.terminalTurnId === undefined &&
    turn.terminalRunId !== undefined &&
    turn.terminalRunId === turn.runtimeRunId
  );
}

function transcriptContentSequence(turn: TranscriptTurnSnapshot): readonly string[] {
  return turn.visibleSequence.filter(
    (item) =>
      item.startsWith('thinking:') ||
      item.startsWith('text:') ||
      item.startsWith('tool-start:') ||
      item.startsWith('tool-result:'),
  );
}

function durableProjectionCoversMergedContent(
  durable: TranscriptTurnSnapshot,
  mergedEvents: readonly SessionEvent[],
): boolean {
  const durableSequence = transcriptContentSequence(durable);
  const mergedSequence = transcriptSegmentSemantic(mergedEvents).visibleSequence.filter(
    (item) =>
      item.startsWith('thinking:') ||
      item.startsWith('text:') ||
      item.startsWith('tool-start:') ||
      item.startsWith('tool-result:'),
  );
  return (
    durableSequence.length === mergedSequence.length &&
    durableSequence.every((item, index) => item === mergedSequence[index])
  );
}

function openLiveProjectionCoversDurablePrefix(
  durable: TranscriptTurnSnapshot,
  live: TranscriptTurnSnapshot,
): boolean {
  if (live.closed) return false;
  const durableSequence = transcriptContentSequence(durable);
  const liveSequence = transcriptContentSequence(live);
  if (contentProjectionIsPrefix(durableSequence, liveSequence)) return true;
  // A notice can split one text stream into two visible runs even though the other projection stores
  // the same prefix as one assistant entry. Matching the same-kind content stream remains exact;
  // notice positions are reconciled separately by content offset.
  return contentProjectionIsPrefix(
    collapseAdjacentTextContent(durableSequence),
    collapseAdjacentTextContent(liveSequence),
  );
}

function effectiveCausalLiveProjection(
  events: readonly SessionEvent[],
): readonly SessionEvent[] | undefined {
  const effective = filterEffectiveOutputSegmentEvents(events);
  return effective.some((event) => event.kind === 'output_segment_started') ? effective : undefined;
}

function contentProjectionIsPrefix(
  durableSequence: readonly string[],
  liveSequence: readonly string[],
): boolean {
  if (durableSequence.length === 0 || durableSequence.length > liveSequence.length) return false;
  return durableSequence.every((item, index) => {
    const candidate = liveSequence[index];
    if (candidate === undefined) return false;
    const finalCumulativeText =
      index === durableSequence.length - 1 &&
      (item.startsWith('thinking:') || item.startsWith('text:'));
    return finalCumulativeText ? candidate.startsWith(item) : candidate === item;
  });
}

function collapseAdjacentTextContent(sequence: readonly string[]): string[] {
  const collapsed: Array<{ readonly prefix?: 'thinking:' | 'text:'; readonly parts: string[] }> =
    [];
  for (const item of sequence) {
    const prefix = item.startsWith('thinking:')
      ? ('thinking:' as const)
      : item.startsWith('text:')
        ? ('text:' as const)
        : undefined;
    const previous = collapsed[collapsed.length - 1];
    if (prefix !== undefined && previous?.prefix === prefix) {
      previous.parts.push(item.slice(prefix.length));
    } else {
      collapsed.push({ ...(prefix !== undefined ? { prefix } : {}), parts: [item] });
    }
  }
  return collapsed.map((item) => item.parts.join(''));
}

function durableProjectionCoversOpenLiveContent(
  durable: TranscriptTurnSnapshot,
  live: TranscriptTurnSnapshot,
): boolean {
  let durableIndex = 0;
  return live.visibleSequence.every((item, liveIndex) => {
    const finalCumulativeText =
      liveIndex === live.visibleSequence.length - 1 &&
      (item.startsWith('thinking:') || item.startsWith('text:'));
    while (durableIndex < durable.visibleSequence.length) {
      const candidate = durable.visibleSequence[durableIndex++]!;
      if (finalCumulativeText ? candidate.startsWith(item) : candidate === item) return true;
    }
    return false;
  });
}

interface TranscriptContentRun {
  readonly key: string;
  readonly eventIndexes: readonly number[];
  readonly textKind?: 'thinking_delta' | 'text_delta';
}

function transcriptContentRuns(events: readonly SessionEvent[]): TranscriptContentRun[] {
  const runs: Array<{
    key: string;
    eventIndexes: number[];
    textKind?: 'thinking_delta' | 'text_delta';
  }> = [];
  let mergeableTextRun: number | undefined;
  for (let index = 0; index < events.length; index++) {
    const event = events[index]!;
    if (event.kind === 'thinking_delta' || event.kind === 'text_delta') {
      const prefix = event.kind === 'thinking_delta' ? 'thinking:' : 'text:';
      const current = mergeableTextRun === undefined ? undefined : runs[mergeableTextRun];
      if (current?.textKind === event.kind) {
        current.key += event.text;
        current.eventIndexes.push(index);
      } else {
        runs.push({ key: `${prefix}${event.text}`, eventIndexes: [index], textKind: event.kind });
        mergeableTextRun = runs.length - 1;
      }
    } else if (event.kind === 'tool_start') {
      runs.push({
        key: `tool-start:${stableJson({
          toolId: event.toolId,
          toolName: event.toolName,
          input: stableJson(event.input ?? {}),
        })}`,
        eventIndexes: [index],
      });
      mergeableTextRun = undefined;
    } else if (event.kind === 'tool_result') {
      runs.push({
        key: `tool-result:${stableJson({
          toolId: event.toolId,
          toolName: event.toolName,
          content: event.content,
        })}`,
        eventIndexes: [index],
      });
      mergeableTextRun = undefined;
    } else if (
      projectionNoticeKey(event) !== undefined ||
      (event.kind === 'compact_stats' && event.contextKind !== 'child') ||
      event.kind === 'session_error'
    ) {
      mergeableTextRun = undefined;
    }
  }
  return runs;
}

function contentRunMatches(
  durable: TranscriptContentRun,
  live: TranscriptContentRun,
  finalDurableRun: boolean,
): boolean {
  if (durable.key === live.key) return true;
  return (
    finalDurableRun &&
    durable.textKind !== undefined &&
    durable.textKind === live.textKind &&
    live.key.startsWith(durable.key)
  );
}

function uniqueContiguousContentRunMapping(
  durableRuns: readonly TranscriptContentRun[],
  liveRuns: readonly TranscriptContentRun[],
): readonly number[] | undefined {
  if (durableRuns.length === 0 || durableRuns.length > liveRuns.length) return undefined;
  let matchedStart: number | undefined;
  for (let start = 0; start <= liveRuns.length - durableRuns.length; start++) {
    const matches = durableRuns.every((durable, index) =>
      contentRunMatches(durable, liveRuns[start + index]!, index === durableRuns.length - 1),
    );
    if (!matches) continue;
    if (matchedStart !== undefined) return undefined;
    matchedStart = start;
  }
  return matchedStart === undefined
    ? undefined
    : durableRuns.map((_, index) => matchedStart + index);
}

function collapseAdjacentTextRuns(runs: readonly TranscriptContentRun[]): TranscriptContentRun[] {
  const collapsed: Array<{
    keyParts: string[];
    eventIndexes: number[];
    textKind?: 'thinking_delta' | 'text_delta';
  }> = [];
  for (const run of runs) {
    const previous = collapsed[collapsed.length - 1];
    if (run.textKind !== undefined && previous?.textKind === run.textKind) {
      const prefix = run.textKind === 'thinking_delta' ? 'thinking:' : 'text:';
      previous.keyParts.push(run.key.slice(prefix.length));
      previous.eventIndexes.push(...run.eventIndexes);
    } else {
      collapsed.push({
        keyParts: [run.key],
        eventIndexes: [...run.eventIndexes],
        ...(run.textKind !== undefined ? { textKind: run.textKind } : {}),
      });
    }
  }
  return collapsed.map((run) => ({
    key: run.keyParts.join(''),
    eventIndexes: run.eventIndexes,
    ...(run.textKind !== undefined ? { textKind: run.textKind } : {}),
  }));
}

interface ProjectionContentPosition {
  readonly runIndex: number;
  readonly startOffset: number;
  readonly endOffset: number;
}

function projectionContentPositions(
  events: readonly SessionEvent[],
  runs: readonly TranscriptContentRun[],
): ReadonlyMap<number, ProjectionContentPosition> {
  const positions = new Map<number, ProjectionContentPosition>();
  for (let runIndex = 0; runIndex < runs.length; runIndex++) {
    let offset = 0;
    for (const eventIndex of runs[runIndex]!.eventIndexes) {
      const event = events[eventIndex]!;
      const size =
        event.kind === 'thinking_delta' || event.kind === 'text_delta' ? event.text.length : 1;
      positions.set(eventIndex, {
        runIndex,
        startOffset: offset,
        endOffset: offset + size,
      });
      offset += size;
    }
  }
  return positions;
}

interface AnchoredProjectionEvent {
  readonly runIndex: number;
  readonly offset: number;
  readonly event: SessionEvent;
}

function anchoredProjectionExtras(
  events: readonly SessionEvent[],
  positions: ReadonlyMap<number, ProjectionContentPosition>,
): AnchoredProjectionEvent[] {
  const nextPositions: Array<ProjectionContentPosition | undefined> = Array.from({
    length: events.length,
  });
  let nextPosition: ProjectionContentPosition | undefined;
  for (let eventIndex = events.length - 1; eventIndex >= 0; eventIndex--) {
    nextPositions[eventIndex] = nextPosition;
    nextPosition = positions.get(eventIndex) ?? nextPosition;
  }
  const extras: AnchoredProjectionEvent[] = [];
  let previousPosition: ProjectionContentPosition | undefined;
  for (let eventIndex = 0; eventIndex < events.length; eventIndex++) {
    const event = events[eventIndex]!;
    const position = positions.get(eventIndex);
    if (position !== undefined) {
      previousPosition = position;
    } else if (!isTranscriptTerminal(event) && !isPromptSegmentBoundary(event)) {
      const followingPosition = nextPositions[eventIndex];
      let anchor: { runIndex: number; offset: number };
      if (
        previousPosition !== undefined &&
        followingPosition !== undefined &&
        previousPosition.runIndex === followingPosition.runIndex
      ) {
        anchor = { runIndex: previousPosition.runIndex, offset: previousPosition.endOffset };
      } else if (followingPosition !== undefined) {
        anchor = { runIndex: followingPosition.runIndex, offset: followingPosition.startOffset };
      } else if (previousPosition !== undefined) {
        anchor = { runIndex: previousPosition.runIndex, offset: previousPosition.endOffset };
      } else {
        anchor = { runIndex: 0, offset: 0 };
      }
      extras.push({ ...anchor, event });
    }
  }
  return extras;
}

function projectionAnchorKey(event: AnchoredProjectionEvent): string {
  return `${event.runIndex}:${event.offset}`;
}

function unmatchedDurableProjectionExtras(
  durable: readonly AnchoredProjectionEvent[],
  live: readonly AnchoredProjectionEvent[],
): AnchoredProjectionEvent[] {
  const liveCounts = new Map<string, number>();
  for (const anchored of live) {
    const mergeKey = projectionMergeKey(anchored.event);
    if (mergeKey === undefined) continue;
    const key = `${projectionAnchorKey(anchored)}:${mergeKey}`;
    liveCounts.set(key, (liveCounts.get(key) ?? 0) + 1);
  }
  return durable.filter((anchored) => {
    const mergeKey = projectionMergeKey(anchored.event);
    if (mergeKey === undefined) return true;
    const key = `${projectionAnchorKey(anchored)}:${mergeKey}`;
    const remaining = liveCounts.get(key) ?? 0;
    if (remaining === 0) return true;
    if (remaining === 1) liveCounts.delete(key);
    else liveCounts.set(key, remaining - 1);
    return false;
  });
}

interface CausalProjectionMatch {
  readonly durableExtras: readonly AnchoredProjectionEvent[];
}

type OpenLiveAdoption =
  | { readonly kind: 'replace' | 'merge' }
  | {
      readonly kind: 'causal_merge';
      readonly liveEvents: readonly SessionEvent[];
      readonly match: CausalProjectionMatch;
    };

interface ClosedCausalAdoption {
  readonly liveEvents: readonly SessionEvent[];
  readonly match: CausalProjectionMatch;
}

interface MappedDurableProjectionEvent extends AnchoredProjectionEvent {
  readonly minimumRunIndex: number;
  readonly minimumOffset: number;
  readonly maximumRunIndex: number;
  readonly maximumOffset: number;
}

function projectionRunSize(run: TranscriptContentRun): number {
  if (run.textKind === undefined) return 1;
  const prefix = run.textKind === 'thinking_delta' ? 'thinking:' : 'text:';
  return run.key.length - prefix.length;
}

function remapProjectionExtras(
  extras: readonly AnchoredProjectionEvent[],
  runMapping: readonly number[],
  durableRuns: readonly TranscriptContentRun[],
  liveRuns: readonly TranscriptContentRun[],
): MappedDurableProjectionEvent[] | undefined {
  const mapped: MappedDurableProjectionEvent[] = [];
  for (const extra of extras) {
    const runIndex = runMapping[extra.runIndex];
    if (runIndex === undefined) return undefined;
    const liveOffset = Math.min(extra.offset, projectionRunSize(liveRuns[runIndex]!));
    let minimumRunIndex = runIndex;
    let minimumOffset = liveOffset;
    let maximumRunIndex = runIndex;
    let maximumOffset = liveOffset;
    if (extra.offset === 0) {
      const previousRunIndex = extra.runIndex === 0 ? undefined : runMapping[extra.runIndex - 1];
      minimumRunIndex = previousRunIndex ?? 0;
      minimumOffset =
        previousRunIndex === undefined ? 0 : projectionRunSize(liveRuns[previousRunIndex]!);
    } else if (
      extra.runIndex === durableRuns.length - 1 &&
      extra.offset >= projectionRunSize(durableRuns[extra.runIndex]!)
    ) {
      maximumRunIndex = liveRuns.length - 1;
      maximumOffset = projectionRunSize(liveRuns[maximumRunIndex]!);
    }
    mapped.push({
      ...extra,
      runIndex,
      offset: liveOffset,
      minimumRunIndex,
      minimumOffset,
      maximumRunIndex,
      maximumOffset,
    });
  }
  return mapped;
}

function unmatchedMappedDurableExtras(
  durable: readonly MappedDurableProjectionEvent[],
  live: readonly AnchoredProjectionEvent[],
): AnchoredProjectionEvent[] | undefined {
  const liveByKey = new Map<string, AnchoredProjectionEvent[]>();
  for (const extra of live) {
    const key = projectionMergeKey(extra.event);
    if (key === undefined) continue;
    const matching = liveByKey.get(key) ?? [];
    matching.push(extra);
    liveByKey.set(key, matching);
  }
  const unmatched: AnchoredProjectionEvent[] = [];
  for (const extra of durable) {
    const key = projectionMergeKey(extra.event);
    if (key === undefined) return undefined;
    const liveCandidates = liveByKey.get(key) ?? [];
    const matchingIndex = liveCandidates.findIndex(
      (candidate) =>
        projectionPositionCompare(
          candidate.runIndex,
          candidate.offset,
          extra.minimumRunIndex,
          extra.minimumOffset,
        ) >= 0 &&
        projectionPositionCompare(
          candidate.runIndex,
          candidate.offset,
          extra.maximumRunIndex,
          extra.maximumOffset,
        ) <= 0,
    );
    if (matchingIndex !== -1) {
      liveCandidates.splice(matchingIndex, 1);
    } else if (liveCandidates.length > 0) {
      return undefined;
    } else {
      unmatched.push(extra);
    }
  }
  return unmatched;
}

function noticeOnlyCausalProjectionMatch(
  durableEvents: readonly SessionEvent[],
  liveEvents: readonly SessionEvent[],
): CausalProjectionMatch | undefined {
  const durableKeys: string[] = [];
  for (const event of durableEvents) {
    if (isTranscriptTerminal(event) || isPromptSegmentBoundary(event)) continue;
    const key = projectionMergeKey(event);
    if (key === undefined) return undefined;
    durableKeys.push(key);
  }
  if (durableKeys.length === 0) return undefined;
  const liveKeys = liveEvents.flatMap((event) => {
    const key = projectionMergeKey(event);
    return key === undefined ? [] : [key];
  });
  let matched = false;
  for (let start = 0; start <= liveKeys.length - durableKeys.length; start++) {
    if (!durableKeys.every((key, index) => liveKeys[start + index] === key)) continue;
    if (matched) return undefined;
    matched = true;
  }
  return matched ? { durableExtras: [] } : undefined;
}

function orderedCausalProjectionMatch(
  durableEvents: readonly SessionEvent[],
  liveEvents: readonly SessionEvent[],
): CausalProjectionMatch | undefined {
  const durableRuns = collapseAdjacentTextRuns(transcriptContentRuns(durableEvents));
  const liveRuns = collapseAdjacentTextRuns(transcriptContentRuns(liveEvents));
  if (durableRuns.length === 0) {
    return noticeOnlyCausalProjectionMatch(durableEvents, liveEvents);
  }
  const runMapping = uniqueContiguousContentRunMapping(durableRuns, liveRuns);
  if (runMapping === undefined) return undefined;
  const durablePositions = projectionContentPositions(durableEvents, durableRuns);
  const livePositions = projectionContentPositions(liveEvents, liveRuns);
  const mappedDurableExtras = remapProjectionExtras(
    anchoredProjectionExtras(durableEvents, durablePositions),
    runMapping,
    durableRuns,
    liveRuns,
  );
  if (mappedDurableExtras === undefined) return undefined;
  const unmatched = unmatchedMappedDurableExtras(
    mappedDurableExtras,
    anchoredProjectionExtras(liveEvents, livePositions),
  );
  return unmatched === undefined ? undefined : { durableExtras: unmatched };
}

interface ProjectionEventGroup {
  readonly runIndex: number;
  readonly offset: number;
  readonly events: SessionEvent[];
}

function anchoredProjectionGroups(
  extras: readonly AnchoredProjectionEvent[],
): ProjectionEventGroup[] {
  const groups: Array<{ runIndex: number; offset: number; events: SessionEvent[] }> = [];
  for (const extra of extras) {
    const previous = groups[groups.length - 1];
    if (previous?.runIndex === extra.runIndex && previous.offset === extra.offset) {
      previous.events.push(extra.event);
    } else {
      groups.push({ runIndex: extra.runIndex, offset: extra.offset, events: [extra.event] });
    }
  }
  return groups;
}

function projectionPositionCompare(
  leftRun: number,
  leftOffset: number,
  rightRun: number,
  rightOffset: number,
): number {
  return leftRun - rightRun || leftOffset - rightOffset;
}

function flushProjectionGroupsThrough(
  groups: readonly ProjectionEventGroup[],
  cursor: number,
  runIndex: number,
  offset: number,
  output: SessionEvent[],
): number {
  while (cursor < groups.length) {
    const group = groups[cursor]!;
    if (projectionPositionCompare(group.runIndex, group.offset, runIndex, offset) > 0) break;
    output.push(...group.events);
    cursor++;
  }
  return cursor;
}

function mergeCollapsedOpenLiveProjection(
  durableEvents: readonly SessionEvent[],
  liveEvents: readonly SessionEvent[],
  promptBoundary: SessionEvent | undefined,
): SessionEvent[] {
  const durableRuns = collapseAdjacentTextRuns(transcriptContentRuns(durableEvents));
  const liveRuns = collapseAdjacentTextRuns(transcriptContentRuns(liveEvents));
  const durablePositions = projectionContentPositions(durableEvents, durableRuns);
  const livePositions = projectionContentPositions(liveEvents, liveRuns);
  const durableExtras = anchoredProjectionExtras(durableEvents, durablePositions);
  const liveExtras = anchoredProjectionExtras(liveEvents, livePositions);
  const groups = anchoredProjectionGroups(
    unmatchedDurableProjectionExtras(durableExtras, liveExtras),
  );
  return mergeLiveProjectionWithDurableGroups(liveEvents, livePositions, groups, promptBoundary);
}

function mergeLiveProjectionWithDurableGroups(
  liveEvents: readonly SessionEvent[],
  livePositions: ReadonlyMap<number, ProjectionContentPosition>,
  groups: readonly ProjectionEventGroup[],
  promptBoundary: SessionEvent | undefined,
): SessionEvent[] {
  const merged: SessionEvent[] = promptBoundary === undefined ? [] : [promptBoundary];
  let groupCursor = 0;
  for (let eventIndex = 0; eventIndex < liveEvents.length; eventIndex++) {
    const event = liveEvents[eventIndex]!;
    if (isTranscriptTerminal(event) || isPromptSegmentBoundary(event)) continue;
    const position = livePositions.get(eventIndex);
    if (position === undefined) {
      merged.push(event);
      continue;
    }
    groupCursor = flushProjectionGroupsThrough(
      groups,
      groupCursor,
      position.runIndex,
      position.startOffset,
      merged,
    );
    if (event.kind !== 'thinking_delta' && event.kind !== 'text_delta') {
      merged.push(event);
      continue;
    }
    let textOffset = position.startOffset;
    while (
      groupCursor < groups.length &&
      groups[groupCursor]!.runIndex === position.runIndex &&
      groups[groupCursor]!.offset < position.endOffset
    ) {
      const group = groups[groupCursor]!;
      const splitAt = group.offset - position.startOffset;
      if (group.offset > textOffset) {
        merged.push({
          ...event,
          text: event.text.slice(textOffset - position.startOffset, splitAt),
        });
      }
      merged.push(...group.events);
      textOffset = group.offset;
      groupCursor++;
    }
    if (textOffset < position.endOffset) {
      merged.push({ ...event, text: event.text.slice(textOffset - position.startOffset) });
    }
  }
  while (groupCursor < groups.length) merged.push(...groups[groupCursor++]!.events);
  return merged;
}

function mergeOrderedCausalProjection(
  liveEvents: readonly SessionEvent[],
  promptBoundary: SessionEvent | undefined,
  match: CausalProjectionMatch,
): SessionEvent[] {
  const liveRuns = collapseAdjacentTextRuns(transcriptContentRuns(liveEvents));
  const livePositions = projectionContentPositions(liveEvents, liveRuns);
  return mergeLiveProjectionWithDurableGroups(
    liveEvents,
    livePositions,
    anchoredProjectionGroups(match.durableExtras),
    promptBoundary,
  );
}

function mergeClosedCausalProjection(
  durableEvents: readonly SessionEvent[],
  adoption: ClosedCausalAdoption,
): SessionEvent[] {
  const promptBoundary =
    durableEvents.find(isPromptSegmentBoundary) ??
    adoption.liveEvents.find(isPromptSegmentBoundary);
  const body = mergeOrderedCausalProjection(
    adoption.liveEvents,
    promptBoundary,
    adoption.match,
  ).filter((event) => !isTranscriptTerminal(event));
  const liveTerminals = adoption.liveEvents.filter(isTranscriptTerminal);
  const terminals =
    liveTerminals.length > 0 ? liveTerminals : durableEvents.filter(isTranscriptTerminal);
  return terminals.length > 0 ? [...body, ...terminals] : body;
}

function projectionContentGaps(
  events: readonly SessionEvent[],
  runs: readonly TranscriptContentRun[],
): SessionEvent[][] {
  const contentIndexes = new Set(runs.flatMap((run) => run.eventIndexes));
  const gaps = Array.from({ length: runs.length + 1 }, () => [] as SessionEvent[]);
  let nextRunIndex = 0;
  for (let eventIndex = 0; eventIndex < events.length; eventIndex++) {
    while (
      nextRunIndex < runs.length &&
      runs[nextRunIndex]!.eventIndexes[runs[nextRunIndex]!.eventIndexes.length - 1]! < eventIndex
    ) {
      nextRunIndex++;
    }
    const event = events[eventIndex]!;
    if (
      contentIndexes.has(eventIndex) ||
      isTranscriptTerminal(event) ||
      isPromptSegmentBoundary(event)
    ) {
      continue;
    }
    gaps[nextRunIndex]!.push(event);
  }
  return gaps;
}

function mergeOpenLiveTurnProjections(
  durable: TranscriptTurnSnapshot,
  durableEvents: readonly SessionEvent[],
  liveEvents: readonly SessionEvent[],
): SessionEvent[] {
  const promptBoundary =
    durableEvents.find(isPromptSegmentBoundary) ?? liveEvents.find(isPromptSegmentBoundary);
  const durableRuns = transcriptContentRuns(durableEvents);
  const liveRuns = transcriptContentRuns(liveEvents);
  const durableSequence = transcriptContentSequence(durable);
  const liveSequence = liveRuns.map((run) => run.key);
  if (!contentProjectionIsPrefix(durableSequence, liveSequence)) {
    return mergeCollapsedOpenLiveProjection(durableEvents, liveEvents, promptBoundary);
  }
  const liveGaps = projectionContentGaps(liveEvents, liveRuns);
  const durableGaps = projectionContentGaps(durableEvents, durableRuns).map((events, gapIndex) => {
    const liveMergeKeyCounts = new Map<string, number>();
    for (const event of liveGaps[gapIndex] ?? []) {
      const key = projectionMergeKey(event);
      if (key !== undefined) {
        liveMergeKeyCounts.set(key, (liveMergeKeyCounts.get(key) ?? 0) + 1);
      }
    }
    return events.filter((event) => {
      const key = projectionMergeKey(event);
      if (key === undefined) return true;
      const remaining = liveMergeKeyCounts.get(key) ?? 0;
      if (remaining === 0) return true;
      if (remaining === 1) liveMergeKeyCounts.delete(key);
      else liveMergeKeyCounts.set(key, remaining - 1);
      return false;
    });
  });
  const durableRunEvents = durableRuns.map((run) =>
    run.eventIndexes.map((eventIndex) => durableEvents[eventIndex]!),
  );
  const liveRunByEventIndex = new Map<number, number>();
  for (let runIndex = 0; runIndex < liveRuns.length; runIndex++) {
    for (const eventIndex of liveRuns[runIndex]!.eventIndexes) {
      liveRunByEventIndex.set(eventIndex, runIndex);
    }
  }

  const merged: SessionEvent[] = promptBoundary === undefined ? [] : [promptBoundary];
  let emittedDurableTail = false;
  const emitDurableTail = (): void => {
    if (emittedDurableTail) return;
    merged.push(...(durableGaps[durableRuns.length] ?? []));
    emittedDurableTail = true;
  };
  let remainingCumulativePrefix =
    durableSequence.length === 0
      ? 0
      : durableSequence[durableSequence.length - 1]!.slice(
          durableSequence[durableSequence.length - 1]!.indexOf(':') + 1,
        ).length;

  for (let eventIndex = 0; eventIndex < liveEvents.length; eventIndex++) {
    const event = liveEvents[eventIndex]!;
    if (isTranscriptTerminal(event) || isPromptSegmentBoundary(event)) continue;
    const runIndex = liveRunByEventIndex.get(eventIndex);
    if (runIndex === undefined) {
      merged.push(event);
      continue;
    }
    if (runIndex >= durableRuns.length) {
      emitDurableTail();
      merged.push(event);
      continue;
    }

    const liveRun = liveRuns[runIndex]!;
    const firstEventIndex = liveRun.eventIndexes[0]!;
    const lastEventIndex = liveRun.eventIndexes[liveRun.eventIndexes.length - 1]!;
    if (eventIndex === firstEventIndex) {
      merged.push(...(durableGaps[runIndex] ?? []), ...(durableRunEvents[runIndex] ?? []));
    }
    const cumulativeText =
      runIndex === durableRuns.length - 1 &&
      liveRun.textKind !== undefined &&
      liveRun.key.startsWith(durableSequence[runIndex]!);
    if (cumulativeText && event.kind === liveRun.textKind && remainingCumulativePrefix > 0) {
      if (remainingCumulativePrefix < event.text.length) {
        emitDurableTail();
        merged.push({ ...event, text: event.text.slice(remainingCumulativePrefix) });
        remainingCumulativePrefix = 0;
      } else {
        remainingCumulativePrefix -= event.text.length;
      }
    } else if (cumulativeText && event.kind === liveRun.textKind) {
      emitDurableTail();
      merged.push(event);
    }
    if (runIndex === durableRuns.length - 1 && eventIndex === lastEventIndex) emitDurableTail();
  }
  emitDurableTail();
  return merged;
}

function stabilizeAmbiguousLeadingHistoryOrder(
  userMessages: readonly UserMessage[],
  events: readonly SessionEvent[],
): ReconciledTranscriptBuffers {
  const turns = transcriptTurnSnapshots(userMessages, events);
  const durable = turns.find(
    (turn) =>
      turn.restoredFromHistory &&
      turn.leadingPartialHistory &&
      turn.turnId !== undefined &&
      turn.turnUserOrdinal === undefined,
  );
  if (!durable) return { userMessages, events };
  const liveTurns = turns.filter(
    (turn) =>
      !turn.restoredFromHistory && hasStrongTurnIdentity(turn) && turn.turnId === durable.turnId,
  );
  const liveOwners = liveTurns.filter((turn) => turn.turnUserOrdinal === 0);
  if (liveOwners.length !== 1 || liveTurns.length === 0) return { userMessages, events };
  if (
    liveTurns.some(
      (turn) => turn.userIndex <= durable.userIndex || turn.eventStart < durable.eventStart,
    )
  ) {
    return { userMessages, events };
  }
  const crossingCanonicalTurns = turns.filter(
    (turn) =>
      turn.restoredFromHistory &&
      !turn.leadingPartialHistory &&
      turn.userIndex > durable.userIndex &&
      liveTurns.some((live) => turn.userIndex < live.userIndex),
  );
  const retainedSameTurnOrdinal = crossingCanonicalTurns.reduce<number | undefined>(
    (lowest, turn) => {
      if (
        !hasStrongTurnIdentity(turn) ||
        turn.turnId !== durable.turnId ||
        turn.turnUserOrdinal === 0
      ) {
        return lowest;
      }
      return lowest === undefined ? turn.turnUserOrdinal : Math.min(lowest, turn.turnUserOrdinal);
    },
    undefined,
  );
  const exactSuffixOwner = liveOwners[0];
  const exactSuffixOwnerResolution =
    exactSuffixOwner === undefined
      ? undefined
      : uniqueLeadingHistoryOwnerResolution(durable, exactSuffixOwner, turns, events);
  const exactSuffixCanPromote =
    (exactSuffixOwnerResolution?.kind === 'promote_live_owner' ||
      exactSuffixOwnerResolution?.kind === 'promote_open_live_owner') &&
    (liveTurns.length === 1 ||
      crossingCanonicalTurns.every((turn) => turn.turnId === durable.turnId));
  const earlierLivePrefix =
    exactSuffixOwner === undefined
      ? []
      : turns.filter(
          (turn) =>
            !turn.restoredFromHistory &&
            turn.userIndex > durable.userIndex &&
            turn.userIndex < exactSuffixOwner.userIndex,
        );
  const exactSuffixCanFoldInPlace = exactSuffixCanPromote && earlierLivePrefix.length === 0;
  if (exactSuffixCanFoldInPlace) {
    return { userMessages, events };
  }
  const relocationTargets = exactSuffixCanPromote
    ? earlierLivePrefix
    : retainedSameTurnOrdinal !== undefined
      ? liveTurns.filter(
          (turn) =>
            turn.turnUserOrdinal !== undefined && turn.turnUserOrdinal < retainedSameTurnOrdinal,
        )
      : crossingCanonicalTurns.some((turn) => turn.turnId !== durable.turnId)
        ? liveTurns
        : [];
  const lastRelocationTarget = relocationTargets.at(-1);
  const relocatedLiveTurns =
    lastRelocationTarget === undefined
      ? []
      : turns.filter(
          (turn) =>
            !turn.restoredFromHistory &&
            turn.userIndex > durable.userIndex &&
            turn.userIndex <= lastRelocationTarget.userIndex,
        );
  return (
    relocateLiveTurnsBeforeDurableAnchor(userMessages, events, durable, relocatedLiveTurns) ?? {
      userMessages,
      events,
    }
  );
}

/**
 * User owners and event segments are parallel positional buffers. Moving only the matching live
 * owner across a retained canonical turn would strand any earlier live turn on the other side;
 * composeMessages then sorts owners by sentAt while events stay put and pairs every later answer
 * with the wrong query. Relocation therefore moves the complete live turn block (owner rows plus
 * event segments) before the durable anchor as one unit, clamping each relocated sentAt below
 * the anchor so the owner order matches the new segment order. When the matching suffix is
 * exact, the caller leaves that owner after the durable anchor so the normal fold can remove
 * the duplicate projection in the same reconciliation pass.
 */
function relocateLiveTurnsBeforeDurableAnchor(
  userMessages: readonly UserMessage[],
  events: readonly SessionEvent[],
  durable: TranscriptTurnSnapshot,
  relocatedLiveTurns: readonly TranscriptTurnSnapshot[],
): ReconciledTranscriptBuffers | undefined {
  if (relocatedLiveTurns.length === 0) return undefined;
  const liveUserIndexes = new Set(relocatedLiveTurns.map((turn) => turn.userIndex));
  const liveEventIndexes = new Set<number>();
  for (const turn of relocatedLiveTurns) {
    for (let index = turn.eventStart; index < turn.eventEnd; index++) liveEventIndexes.add(index);
  }
  const durableMessage = userMessages[durable.userIndex]!;
  let previousSentAt = Number.NEGATIVE_INFINITY;
  const liveMessages = relocatedLiveTurns.map((turn, index) => {
    const message = userMessages[turn.userIndex]!;
    const latestSentAt = durableMessage.sentAt - (relocatedLiveTurns.length - index);
    const sentAt = Math.min(Math.max(message.sentAt, previousSentAt + 1), latestSentAt);
    previousSentAt = sentAt;
    return sentAt === message.sentAt ? message : { ...message, sentAt };
  });
  const liveEvents = relocatedLiveTurns.flatMap((turn, index) => {
    const segment = events.slice(turn.eventStart, turn.eventEnd);
    return index === relocatedLiveTurns.length - 1
      ? preserveRelocatedSegmentClosure(segment, turn)
      : segment;
  });
  const remainingUsers = userMessages.filter((_, index) => !liveUserIndexes.has(index));
  const remainingEvents = events.filter((_, index) => !liveEventIndexes.has(index));
  return {
    userMessages: [
      ...remainingUsers.slice(0, durable.userIndex),
      ...liveMessages,
      ...remainingUsers.slice(durable.userIndex),
    ],
    events: [
      ...remainingEvents.slice(0, durable.eventStart),
      ...liveEvents,
      ...remainingEvents.slice(durable.eventStart),
    ],
  };
}

/**
 * A canonical page that begins with a complete user row never triggers
 * stabilizeAmbiguousLeadingHistoryOrder, yet its reconstructed segments are still prepended ahead
 * of live turns that are chronologically older. composeMessages sorts owners by sentAt while
 * pairing segments positionally, so that inversion splices canonical text into an earlier owner's
 * segment and leaves the latest query's segment empty at the bottom. Relocate only the truly
 * misplaced live turns (closed, strong identity, no canonical counterpart anywhere in the loaded
 * page, older than some canonical row behind them) before the earliest canonical row that is
 * newer than the block. A live turn matched by a canonical row stays behind its durable copy so
 * the fold keeps its durable-before-duplicate premise, and each re-loaded page re-derives the
 * placement, so older pagination anchors cannot resurrect the inversion. Live turns without
 * turnId keep today's behavior (no identity basis for a safe move).
 */
function stabilizeCanonicalPageHeadBeforeEarlierLiveTurns(
  userMessages: readonly UserMessage[],
  events: readonly SessionEvent[],
): ReconciledTranscriptBuffers {
  const turns = transcriptTurnSnapshots(userMessages, events);
  if (turns.length < 2) return { userMessages, events };
  const canonicalTurnIds = new Set(
    turns.flatMap((turn) =>
      turn.restoredFromHistory && turn.turnId !== undefined && turn.canonicalIndex !== undefined
        ? [turn.turnId]
        : [],
    ),
  );
  if (canonicalTurnIds.size === 0) return { userMessages, events };
  const misplacedLiveTurns = turns.filter(
    (turn) =>
      !turn.restoredFromHistory &&
      turn.turnId !== undefined &&
      !canonicalTurnIds.has(turn.turnId) &&
      turn.terminal &&
      // A live turn sitting behind a chronologically newer canonical row proves the inversion;
      // a live turn newer than every canonical row before it keeps its position (a stale page
      // head must not drag newer runs across the page).
      turns.some(
        (canonical) =>
          canonical.restoredFromHistory &&
          canonical.userIndex < turn.userIndex &&
          turn.sentAt < canonical.sentAt,
      ),
  );
  if (misplacedLiveTurns.length === 0) return { userMessages, events };
  const lastRelocationTarget = misplacedLiveTurns[misplacedLiveTurns.length - 1]!;
  const anchor = turns.find(
    (turn) =>
      turn.restoredFromHistory &&
      turn.canonicalIndex !== undefined &&
      turn.leadingPartialHistory !== true &&
      turn.sentAt > lastRelocationTarget.sentAt,
  );
  if (!anchor || anchor.userIndex >= lastRelocationTarget.userIndex) {
    return { userMessages, events };
  }
  return (
    relocateLiveTurnsBeforeDurableAnchor(userMessages, events, anchor, misplacedLiveTurns) ?? {
      userMessages,
      events,
    }
  );
}

interface DuplicateTranscriptTurnPair {
  readonly durable: TranscriptTurnSnapshot;
  readonly duplicate: TranscriptTurnSnapshot;
  readonly projectionAuthority?: 'canonical';
  readonly ownerResolution?: LeadingHistoryOwnerResolution;
  readonly openLiveAdoption?: OpenLiveAdoption;
  readonly closedCausalAdoption?: ClosedCausalAdoption;
}

function mergeDuplicateTurnProjection(
  pair: DuplicateTranscriptTurnPair,
  durableSegment: readonly SessionEvent[],
  duplicateSegment: readonly SessionEvent[],
): SessionEvent[] {
  if (pair.projectionAuthority === 'canonical') {
    return mergeIdentityProvenTurnProjections(
      durableSegment,
      duplicateSegment,
      userEntryIdentityRelation(pair.durable, pair.duplicate) === 'match',
      'canonical',
    );
  }
  const strategy = selectTranscriptProjectionMergeStrategy({
    hasClosedCausalAdoption: pair.closedCausalAdoption !== undefined,
    openLiveAdoptionKind: pair.openLiveAdoption?.kind,
    ownerResolutionKind: pair.ownerResolution?.kind,
  });
  if (strategy === 'closed-causal' && pair.closedCausalAdoption) {
    return mergeClosedCausalProjection(durableSegment, pair.closedCausalAdoption);
  }
  if (strategy === 'open-live-causal' && pair.openLiveAdoption?.kind === 'causal_merge') {
    return mergeOrderedCausalProjection(
      pair.openLiveAdoption.liveEvents,
      durableSegment.find(isPromptSegmentBoundary) ??
        pair.openLiveAdoption.liveEvents.find(isPromptSegmentBoundary),
      pair.openLiveAdoption.match,
    );
  }
  if (strategy === 'open-live' && pair.openLiveAdoption) {
    return mergeOpenLiveTurnProjections(pair.durable, durableSegment, duplicateSegment);
  }
  if (
    strategy === 'promote-open-live-owner' &&
    pair.ownerResolution?.kind === 'promote_open_live_owner'
  ) {
    return mergeOrderedCausalProjection(
      pair.ownerResolution.liveEvents,
      durableSegment.find(isPromptSegmentBoundary) ??
        pair.ownerResolution.liveEvents.find(isPromptSegmentBoundary),
      pair.ownerResolution.match,
    );
  }
  if (strategy === 'promote-live-owner') return [...duplicateSegment];
  return mergeIdentityProvenTurnProjections(
    durableSegment,
    duplicateSegment,
    userEntryIdentityRelation(pair.durable, pair.duplicate) === 'match',
  );
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
  authority?: CertifiedCanonicalTranscriptAuthority,
): ReconciledTranscriptBuffers {
  const stabilized = stabilizeAmbiguousLeadingHistoryOrder(userMessages, events);
  let nextUsers = [...stabilized.userMessages];
  let nextEvents = [...stabilized.events];
  let didFold = stabilized.userMessages !== userMessages;
  const canonicalizedLiveOwners: CanonicalizedLiveOwner[] = [];
  for (;;) {
    const turns = transcriptTurnSnapshots(nextUsers, nextEvents);
    let pair: DuplicateTranscriptTurnPair | undefined;

    for (let duplicateIndex = 0; duplicateIndex < turns.length && !pair; duplicateIndex++) {
      const duplicate = turns[duplicateIndex]!;
      if (
        duplicate.restoredFromHistory
          ? duplicate.canonicalIndex === undefined && !hasStrongTurnIdentity(duplicate)
          : duplicate.entryId === undefined && !hasStrongTurnIdentity(duplicate)
      ) {
        continue;
      }
      const closedLiveEvents =
        !duplicate.restoredFromHistory && duplicate.closed
          ? effectiveCausalLiveProjection(
              nextEvents.slice(duplicate.eventStart, duplicate.eventEnd),
            )
          : undefined;
      for (let durableIndex = 0; durableIndex < duplicateIndex; durableIndex++) {
        const durable = turns[durableIndex]!;
        const entryIdentity = userEntryIdentityRelation(durable, duplicate);
        const exactDeliveryEntryRequired =
          (durable.deliveredInterrupt || duplicate.deliveredInterrupt) &&
          (durable.entryId !== undefined || duplicate.entryId !== undefined);
        if (
          entryIdentity === 'conflict' ||
          (exactDeliveryEntryRequired && entryIdentity !== 'match')
        ) {
          continue;
        }
        const durableMessage = nextUsers[durable.userIndex];
        const sameRuntimeRun =
          durable.runtimeRunId === undefined ||
          duplicate.runtimeRunId === undefined ||
          durable.runtimeRunId === duplicate.runtimeRunId;
        const projectionAuthority = decideTurnProjectionAuthority(durable, duplicate, authority);
        const certifiedCanonical = projectionAuthority === 'canonical';
        // The newest canonical page can persist the user boundary before any assistant row.
        // Its empty durable segment and the exact open live owner are two projections of one turn,
        // not a complete history copy plus a duplicate. Move the live segment under the canonical
        // owner now so compose never hides the only draft while the Runtime is still streaming.
        const canAdoptOpenLive =
          durable.restoredFromHistory &&
          !duplicate.restoredFromHistory &&
          !duplicate.closed &&
          sameRuntimeRun &&
          (entryIdentity === 'match' || strongTurnIdentityMatches(durable, duplicate));
        let openLiveAdoption: OpenLiveAdoption | undefined;
        if (canAdoptOpenLive) {
          if (
            durableMessage?.historyNoAssistantSegment === true &&
            durable.eventStart === durable.eventEnd
          ) {
            openLiveAdoption = { kind: 'replace' };
          } else if (openLiveProjectionCoversDurablePrefix(durable, duplicate)) {
            openLiveAdoption = { kind: 'merge' };
          } else {
            const durableCandidateSegment = nextEvents.slice(durable.eventStart, durable.eventEnd);
            const effectiveLiveCandidate = effectiveCausalLiveProjection(
              nextEvents.slice(duplicate.eventStart, duplicate.eventEnd),
            );
            const causalMatch =
              effectiveLiveCandidate === undefined
                ? undefined
                : orderedCausalProjectionMatch(durableCandidateSegment, effectiveLiveCandidate);
            if (effectiveLiveCandidate !== undefined && causalMatch !== undefined) {
              openLiveAdoption = {
                kind: 'causal_merge',
                liveEvents: effectiveLiveCandidate,
                match: causalMatch,
              };
            }
          }
        }
        const ownerResolution =
          entryIdentity === 'match' && durable.omittedHistoryUserOrdinal
            ? { kind: 'enrich_canonical_owner' as const }
            : uniqueLeadingHistoryOwnerResolution(durable, duplicate, turns, nextEvents);
        if (
          !durable.restoredFromHistory ||
          (duplicate.restoredFromHistory
            ? !exactRestoredTurnIdentityMatches(durable, duplicate)
            : entryIdentity !== 'match' &&
              !strongTurnIdentityMatches(durable, duplicate) &&
              ownerResolution === undefined) ||
          (!duplicate.restoredFromHistory &&
            !certifiedCanonical &&
            openLiveAdoption === undefined &&
            ownerResolution?.kind !== 'promote_open_live_owner' &&
            !liveTurnCanFold(duplicate, entryIdentity === 'match'))
        ) {
          continue;
        }
        const durableCausalSegment = nextEvents.slice(durable.eventStart, durable.eventEnd);
        const closedCausalMatch =
          certifiedCanonical || closedLiveEvents === undefined
            ? undefined
            : durableCausalSegment.length === 0 &&
                durableMessage?.historyNoAssistantSegment === true
              ? { durableExtras: [] }
              : orderedCausalProjectionMatch(durableCausalSegment, closedLiveEvents);
        if (
          !certifiedCanonical &&
          closedLiveEvents !== undefined &&
          closedCausalMatch === undefined
        ) {
          continue;
        }
        const closedCausalAdoption =
          closedLiveEvents !== undefined && closedCausalMatch !== undefined
            ? { liveEvents: closedLiveEvents, match: closedCausalMatch }
            : undefined;
        pair = {
          durable,
          duplicate,
          ...(certifiedCanonical ? { projectionAuthority: 'canonical' as const } : {}),
          ...(ownerResolution !== undefined ? { ownerResolution } : {}),
          ...(openLiveAdoption !== undefined ? { openLiveAdoption } : {}),
          ...(closedCausalAdoption !== undefined ? { closedCausalAdoption } : {}),
        };
        break;
      }
    }
    if (!pair) break;

    const durableSegment = nextEvents.slice(pair.durable.eventStart, pair.durable.eventEnd);
    const duplicateSegment = nextEvents.slice(pair.duplicate.eventStart, pair.duplicate.eventEnd);
    // A bounded page can retain only an interior canonical span of the complete live projection.
    // Causal admission maps that unique span into live order and reanchors canonical-only notices;
    // closed legacy pages still require an exact visible suffix. Root-present open turns use the
    // same mapped merge, while unsegmented folds retain the canonical-first compatibility path.
    const promotesLiveOwner =
      pair.ownerResolution?.kind === 'promote_live_owner' ||
      pair.ownerResolution?.kind === 'promote_open_live_owner';
    const mergedProjection = mergeDuplicateTurnProjection(pair, durableSegment, duplicateSegment);
    const retainsOpenLiveProjection =
      pair.openLiveAdoption !== undefined ||
      pair.ownerResolution?.kind === 'promote_open_live_owner';
    const mergedSegment = retainsOpenLiveProjection
      ? mergedProjection.filter((event) => !isTranscriptTerminal(event))
      : preserveRelocatedSegmentClosure(mergedProjection, pair.duplicate);
    const duplicateMessage = nextUsers[pair.duplicate.userIndex];
    if (
      pair.openLiveAdoption === undefined &&
      !promotesLiveOwner &&
      !pair.duplicate.restoredFromHistory &&
      duplicateMessage !== undefined &&
      pair.durable.canonicalIndex !== undefined &&
      (pair.projectionAuthority === 'canonical' ||
        durableProjectionCoversMergedContent(pair.durable, mergedProjection))
    ) {
      canonicalizedLiveOwners.push({
        messageId: duplicateMessage.id,
        canonicalIndex: pair.durable.canonicalIndex,
      });
    }
    didFold = true;
    nextEvents = [
      ...nextEvents.slice(0, pair.durable.eventStart),
      ...mergedSegment,
      ...nextEvents.slice(pair.durable.eventEnd, pair.duplicate.eventStart),
      ...nextEvents.slice(pair.duplicate.eventEnd),
    ];

    const durableMessage = nextUsers[pair.durable.userIndex];
    nextUsers = nextUsers
      .filter((_, index) => index !== pair.duplicate.userIndex)
      .map((message, index) => {
        if (index !== pair.durable.userIndex) return message;
        const promoteLiveOwner =
          promotesLiveOwner && durableMessage?.leadingPartialHistory === true;
        const enrichCanonicalOwner =
          pair.ownerResolution?.kind === 'enrich_canonical_owner' &&
          durableMessage?.omittedHistoryUserOrdinal === true;
        const baseMessage = promoteLiveOwner && duplicateMessage ? duplicateMessage : message;
        let rest: Omit<UserMessage, 'historyNoAssistantSegment'>;
        if (promoteLiveOwner) {
          const {
            historyNoAssistantSegment: _emptySegment,
            hiddenHistoryAnchor: _hiddenAnchor,
            leadingPartialHistory: _leadingPartial,
            hiddenProjectionDuplicate: _hiddenDuplicate,
            hiddenProjectionOriginalSentAt,
            ...visibleLiveOwner
          } = baseMessage;
          rest =
            hiddenProjectionOriginalSentAt === undefined
              ? visibleLiveOwner
              : { ...visibleLiveOwner, sentAt: hiddenProjectionOriginalSentAt };
        } else if (enrichCanonicalOwner) {
          const {
            historyNoAssistantSegment: _emptySegment,
            omittedHistoryUserOrdinal: _omittedOrdinal,
            ...canonicalOwner
          } = baseMessage;
          rest = canonicalOwner;
        } else {
          const { historyNoAssistantSegment: _emptySegment, ...durableOwner } = baseMessage;
          rest = durableOwner;
        }
        const deliveryQueueId = rest.deliveryQueueId ?? duplicateMessage?.deliveryQueueId;
        const deliveryQueueMode = rest.deliveryQueueMode ?? duplicateMessage?.deliveryQueueMode;
        const deliveredInterrupt = rest.deliveredInterrupt ?? duplicateMessage?.deliveredInterrupt;
        const runtimeRunId = rest.runtimeRunId ?? duplicateMessage?.runtimeRunId;
        // operationId is renderer admission provenance, not part of the SDK history schema. Once
        // this fold has proven that both rows are the same canonical turn, carry that exact
        // idempotency owner onto the durable copy so a post-refresh retry cannot append it again.
        const operationId = rest.operationId ?? duplicateMessage?.operationId;
        const operationReservation =
          rest.operationReservation ?? duplicateMessage?.operationReservation;
        const reconciled = {
          ...rest,
          ...(promoteLiveOwner ? { restoredFromHistory: true as const } : {}),
          ...(enrichCanonicalOwner && duplicateMessage?.turnUserOrdinal !== undefined
            ? { turnUserOrdinal: duplicateMessage.turnUserOrdinal }
            : {}),
          ...(deliveryQueueId !== undefined ? { deliveryQueueId } : {}),
          ...(deliveryQueueMode !== undefined ? { deliveryQueueMode } : {}),
          ...(deliveredInterrupt === true ? { deliveredInterrupt: true as const } : {}),
          ...(runtimeRunId !== undefined ? { runtimeRunId } : {}),
          ...(operationId !== undefined ? { operationId } : {}),
          ...(operationReservation !== undefined ? { operationReservation } : {}),
        };
        return mergedSegment.length > 0
          ? reconciled
          : { ...reconciled, historyNoAssistantSegment: true };
      });
  }
  return didFold
    ? {
        userMessages: nextUsers,
        events: nextEvents,
        ...(canonicalizedLiveOwners.length > 0 ? { canonicalizedLiveOwners } : {}),
      }
    : { userMessages, events };
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
      .find((candidate) => {
        const entryIdentity = userEntryIdentityRelation(candidate, live);
        const exactDeliveryEntryRequired =
          (candidate.deliveredInterrupt || live.deliveredInterrupt) &&
          (candidate.entryId !== undefined || live.entryId !== undefined);
        const sameRuntimeRun =
          candidate.runtimeRunId === undefined ||
          live.runtimeRunId === undefined ||
          candidate.runtimeRunId === live.runtimeRunId;
        return (
          candidate.restoredFromHistory &&
          candidate.closed &&
          entryIdentity !== 'conflict' &&
          (!exactDeliveryEntryRequired || entryIdentity === 'match') &&
          sameRuntimeRun &&
          strongTurnIdentityMatches(candidate, live) &&
          durableProjectionCoversOpenLiveContent(candidate, live)
        );
      });
    if (durable) {
      sentAtByMessageId.set(live.messageId, Math.max(live.sentAt, durable.sentAt + 1));
    }
  }
  let changed = false;
  const reconciled = userMessages.map((message) => {
    const sentAt = sentAtByMessageId.get(message.id);
    if (sentAt !== undefined) {
      if (
        message.sentAt === sentAt &&
        message.hiddenProjectionDuplicate === true &&
        message.hiddenProjectionOriginalSentAt !== undefined
      ) {
        return message;
      }
      changed = true;
      return {
        ...message,
        sentAt,
        hiddenProjectionDuplicate: true as const,
        hiddenProjectionOriginalSentAt: message.hiddenProjectionOriginalSentAt ?? message.sentAt,
      };
    }
    if (
      message.hiddenProjectionDuplicate !== true &&
      message.hiddenProjectionOriginalSentAt === undefined
    ) {
      return message;
    }
    changed = true;
    const {
      hiddenProjectionDuplicate: _hidden,
      hiddenProjectionOriginalSentAt,
      ...visibleMessage
    } = message;
    return hiddenProjectionOriginalSentAt === undefined
      ? visibleMessage
      : { ...visibleMessage, sentAt: hiddenProjectionOriginalSentAt };
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

function stableHistoryHash(value: unknown): string {
  const text = typeof value === 'string' ? value : stableJson(value);
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function stableHistoryAnchorTurnId(items: readonly SessionHistoryItem[]): string {
  const leadingProjection: SessionHistoryItem[] = [];
  for (const item of items) {
    if (item.kind === 'user') break;
    if (item.kind !== 'local_notice') leadingProjection.push(item);
  }
  return `space-history-anchor:${stableHistoryHash(leadingProjection)}`;
}

function authoritativeLeadingHistoryTurnId(
  items: readonly SessionHistoryItem[],
): string | undefined {
  let turnId: string | undefined;
  for (const item of items) {
    if (item.kind === 'user') break;
    if (item.kind === 'local_notice' || item.kind === 'history_truncation') continue;
    // A missing owner is not evidence that this row belongs to a later identified turn. Mixed
    // legacy/current prefixes must retain the synthetic anchor instead of absorbing unknown rows
    // into the first Runtime turn that happens to expose a turnId.
    if (item.turnId === undefined) return undefined;
    if (turnId !== undefined && turnId !== item.turnId) return undefined;
    turnId = item.turnId;
  }
  return turnId;
}

function stableHistoryUserMessageId(
  sessionId: string,
  item: Extract<SessionHistoryItem, { readonly kind: 'user' }>,
  fallbackOrdinal: number,
): string {
  const identityParts =
    item.canonicalIndex !== undefined
      ? ['canonical', String(item.canonicalIndex)]
      : item.entryId !== undefined
        ? ['entry', item.entryId]
        : item.logicalId !== undefined
          ? ['logical', item.logicalId]
          : item.turnId !== undefined
            ? ['turn', item.turnId, String(item.turnUserOrdinal ?? 0)]
            : ['fallback', String(fallbackOrdinal)];
  const encodePart = (part: string): string => `${part.length}:${part}`;
  // Authoritative identities are encoded losslessly instead of folded into a 32-bit hash. The
  // length-prefixed tuple is injective even when values contain separators; fallback ordinals are
  // already unique within the canonical item array that is rebuilt atomically.
  return `u_history_${[sessionId, ...identityParts].map(encodePart).join('|')}`;
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

/**
 * User/reply ownership is transcript-order based, not wall-clock based. A resumed in-flight
 * Session can expose a process-local `createdAt` later than a query that was submitted while its
 * history request was still settling. History reconstruction may therefore carry a later sort
 * timestamp than the newly appended query even though the query is logically last.
 *
 * Keep an explicitly supplied display time when it already preserves append order; otherwise
 * advance it just beyond the existing user stream. This is deliberately limited to user rows:
 * workflow/local notices still use their real timestamps for interleaving.
 */
function appendedUserMessageSentAt(
  userMessages: readonly UserMessage[],
  candidateSentAt?: number,
): number {
  let latestMessageSentAt = Number.NEGATIVE_INFINITY;
  for (const message of userMessages) {
    if (Number.isFinite(message.sentAt) && message.sentAt > latestMessageSentAt) {
      latestMessageSentAt = message.sentAt;
    }
  }
  const candidate =
    typeof candidateSentAt === 'number' && Number.isFinite(candidateSentAt)
      ? candidateSentAt
      : nextLocalTranscriptSentAt();
  const sentAt = Math.max(candidate, latestMessageSentAt + 1);
  lastLocalTranscriptSentAt = Math.max(lastLocalTranscriptSentAt, sentAt);
  return sentAt;
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
  operationId?: string,
): UserMessage {
  return {
    id: `u_${sessionId}_${++userMessageCounter}`,
    content,
    sentAt: sentAt ?? nextLocalTranscriptSentAt(),
    ...(attachments && attachments.length > 0 ? { attachments } : {}),
    ...(identity ?? {}),
    ...(operationId !== undefined ? { operationId } : {}),
  };
}

function userMessageHasSettledSendAdmission(message: UserMessage): boolean {
  return (
    message.sendAdmissionSettled === true ||
    message.restoredFromHistory === true ||
    message.runtimeRunId !== undefined ||
    message.turnId !== undefined ||
    message.entryId !== undefined ||
    message.authoritativeEntryId !== undefined ||
    message.deliveryQueueId !== undefined ||
    message.sourceQueuedLocalId !== undefined
  );
}

function queuedMessageHasSettledSendAdmission(message: QueuedUserMessage): boolean {
  return (
    message.sendAdmissionSettled === true ||
    message.status !== 'pending-ack' ||
    message.queueId !== undefined
  );
}

interface SendOperationMessages {
  readonly users: readonly UserMessage[];
  readonly queued: readonly QueuedUserMessage[];
  readonly settledUser?: UserMessage;
  readonly settledQueued?: QueuedUserMessage;
  readonly provisionalUser?: UserMessage;
  readonly provisionalQueued?: QueuedUserMessage;
}

interface ExistingSendOperationOwner {
  readonly owner: LocalSendOperationMessage;
  readonly updatedUser?: UserMessage;
  readonly updatedQueued?: QueuedUserMessage;
}

function resolveSendOperationMessages(
  users: readonly UserMessage[],
  queued: readonly QueuedUserMessage[],
  operationId: string,
): SendOperationMessages {
  const matchingUsers = users.filter((message) => message.operationId === operationId);
  const matchingQueued = queued.filter((message) => message.operationId === operationId);
  return {
    users: matchingUsers,
    queued: matchingQueued,
    settledUser: matchingUsers.find(userMessageHasSettledSendAdmission),
    settledQueued: matchingQueued.find(queuedMessageHasSettledSendAdmission),
    provisionalUser: matchingUsers.find((message) => !userMessageHasSettledSendAdmission(message)),
    provisionalQueued: matchingQueued.find(
      (message) => !queuedMessageHasSettledSendAdmission(message),
    ),
  };
}

function refreshedSendOperationReservation(requestGeneration: number): SendOperationReservation {
  return { requestGeneration };
}

function existingSendOperationOwner(
  messages: SendOperationMessages,
  requestGeneration: number,
): ExistingSendOperationOwner | undefined {
  const settled = messages.settledUser ?? messages.settledQueued;
  if (settled !== undefined) return { owner: { kind: 'settled', id: settled.id } };
  if (messages.provisionalUser !== undefined) {
    const updatedUser = {
      ...messages.provisionalUser,
      operationReservation: refreshedSendOperationReservation(requestGeneration),
    };
    return { owner: { kind: 'user', id: updatedUser.id }, updatedUser };
  }
  if (messages.provisionalQueued !== undefined) {
    const updatedQueued = {
      ...messages.provisionalQueued,
      operationReservation: refreshedSendOperationReservation(requestGeneration),
    };
    return { owner: { kind: 'queued', id: updatedQueued.id }, updatedQueued };
  }
  return undefined;
}

function pendingSendCleanupPatch(
  state: Pick<AppState, 'pendingSendBySession' | 'pendingSendRuntimeBaselineBySession'>,
  sessionId: string,
  expectedGeneration: number,
): Partial<Pick<AppState, 'pendingSendBySession' | 'pendingSendRuntimeBaselineBySession'>> {
  if (
    !state.pendingSendBySession[sessionId] ||
    state.pendingSendRuntimeBaselineBySession[sessionId]?.requestGeneration !== expectedGeneration
  ) {
    return {};
  }
  const { [sessionId]: _pending, ...remainingPending } = state.pendingSendBySession;
  const { [sessionId]: _baseline, ...remainingBaselines } =
    state.pendingSendRuntimeBaselineBySession;
  return {
    pendingSendBySession: remainingPending,
    pendingSendRuntimeBaselineBySession: remainingBaselines,
  };
}

function existingSendOperationPatch(
  state: AppState,
  sessionId: string,
  existing: ExistingSendOperationOwner,
): Partial<AppState> {
  if (existing.updatedUser !== undefined) {
    rememberHistoryLiveUsers(sessionId, [existing.updatedUser]);
    return {
      userMessagesBySession: {
        ...state.userMessagesBySession,
        [sessionId]: (state.userMessagesBySession[sessionId] ?? []).map((message) =>
          message.id === existing.updatedUser?.id ? existing.updatedUser : message,
        ),
      },
    };
  }
  if (existing.updatedQueued !== undefined) {
    return {
      queuedUserMessagesBySession: {
        ...state.queuedUserMessagesBySession,
        [sessionId]: (state.queuedUserMessagesBySession[sessionId] ?? []).map((message) =>
          message.id === existing.updatedQueued?.id ? existing.updatedQueued : message,
        ),
      },
    };
  }
  return {};
}

function createReservedQueuedMessage(
  sessionId: string,
  input: ReserveSendOperationInput,
): QueuedUserMessage {
  return {
    id: `qu_${sessionId}_${++queuedUserMessageCounter}`,
    content: input.content,
    matchContent: input.matchContent ?? input.content,
    ...(input.attachments && input.attachments.length > 0
      ? { attachments: input.attachments }
      : {}),
    queueMode: input.queueMode,
    operationId: input.operationId,
    operationReservation: {
      requestGeneration: input.requestGeneration,
    },
    status: 'pending-ack',
    sentAt: input.sentAt ?? Date.now(),
  };
}

function createReservedUserMessage(
  sessionId: string,
  input: ReserveSendOperationInput,
  users: readonly UserMessage[],
): UserMessage {
  return {
    ...createUserMessage(
      sessionId,
      input.content,
      appendedUserMessageSentAt(users, input.sentAt),
      undefined,
      input.attachments,
      input.operationId,
    ),
    operationReservation: {
      requestGeneration: input.requestGeneration,
    },
  };
}

function settledSendOperationPatch(
  state: AppState,
  sessionId: string,
  operationId: string,
  messages: SendOperationMessages,
  pendingPatch: Partial<AppState>,
): Partial<AppState> {
  const removedUserIds = messages.users
    .filter((message) => !userMessageHasSettledSendAdmission(message))
    .map((message) => message.id);
  if (removedUserIds.length > 0) forgetHistoryLiveUsers(sessionId, removedUserIds);
  const removedUserIdSet = new Set(removedUserIds);
  return {
    ...pendingPatch,
    userMessagesBySession: {
      ...state.userMessagesBySession,
      [sessionId]: (state.userMessagesBySession[sessionId] ?? []).filter(
        (message) => !removedUserIdSet.has(message.id),
      ),
    },
    queuedUserMessagesBySession: {
      ...state.queuedUserMessagesBySession,
      [sessionId]: (state.queuedUserMessagesBySession[sessionId] ?? []).filter(
        (message) =>
          message.operationId !== operationId || queuedMessageHasSettledSendAdmission(message),
      ),
    },
  };
}

function removeProvisionalSendOperationPatch(
  state: AppState,
  sessionId: string,
  provisional: UserMessage | QueuedUserMessage,
  removesUser: boolean,
  pendingPatch: Partial<AppState>,
): Partial<AppState> {
  if (removesUser) forgetHistoryLiveUsers(sessionId, [provisional.id]);
  return {
    ...pendingPatch,
    userMessagesBySession: {
      ...state.userMessagesBySession,
      [sessionId]: removesUser
        ? (state.userMessagesBySession[sessionId] ?? []).filter(
            (message) => message.id !== provisional.id,
          )
        : (state.userMessagesBySession[sessionId] ?? []),
    },
    queuedUserMessagesBySession: {
      ...state.queuedUserMessagesBySession,
      [sessionId]: removesUser
        ? (state.queuedUserMessagesBySession[sessionId] ?? [])
        : (state.queuedUserMessagesBySession[sessionId] ?? []).filter(
            (message) => message.id !== provisional.id,
          ),
    },
  };
}

function pendingSendRuntimeBaseline(
  state: Pick<AppState, 'runtimeConnection' | 'runtimeProfile' | 'liveProjectionBySession'>,
  sessionId: string,
  requestGeneration: number,
): PendingSendRuntimeBaseline {
  if (
    !runtimeConnectionHasFreshLiveAuthority(state.runtimeConnection) ||
    state.runtimeConnection.runtimeId === undefined
  ) {
    return { requestGeneration, liveCursorSeq: -1, profileCursorSeq: -1 };
  }
  const runtimeId = state.runtimeConnection.runtimeId;
  const live = state.liveProjectionBySession[sessionId];
  const currentLive =
    live?.cursor.runtimeId === runtimeId &&
    (live.cursor.sessionId === undefined || live.cursor.sessionId === sessionId)
      ? live
      : undefined;
  const liveSeq = currentLive?.cursor.seq ?? -1;
  const profile =
    state.runtimeProfile?.connection.runtimeId === runtimeId ? state.runtimeProfile : null;
  const profileSeq = profile?.cursor?.runtimeId === runtimeId ? profile.cursor.seq : -1;
  return {
    requestGeneration,
    runtimeId,
    liveCursorSeq: liveSeq,
    profileCursorSeq: profileSeq,
    ...(currentLive?.cursor.sessionId !== undefined
      ? { liveCursorSessionId: currentLive.cursor.sessionId }
      : {}),
    ...(currentLive?.cursor.journalEpoch !== undefined
      ? { liveCursorJournalEpoch: currentLive.cursor.journalEpoch }
      : {}),
  };
}

function liveProjectionClearsPendingSend(
  projection: SpaceSessionLiveProjectionT,
  baseline: PendingSendRuntimeBaseline | undefined,
): boolean {
  const sameKnownLiveLineage =
    baseline?.liveCursorSessionId === undefined ||
    baseline.liveCursorJournalEpoch === undefined ||
    projection.cursor.sessionId === undefined ||
    projection.cursor.journalEpoch === undefined ||
    (projection.cursor.sessionId === baseline.liveCursorSessionId &&
      projection.cursor.journalEpoch === baseline.liveCursorJournalEpoch);
  if (
    baseline?.acceptedRunId === undefined ||
    (baseline.runtimeId !== undefined && projection.cursor.runtimeId !== baseline.runtimeId) ||
    (projection.cursor.sessionId !== undefined &&
      projection.cursor.sessionId !== projection.sessionId) ||
    (sameKnownLiveLineage && projection.cursor.seq <= baseline.liveCursorSeq)
  ) {
    return false;
  }
  if (projection.activeRun?.runId === baseline.acceptedRunId) return true;
  if (projection.queuedRuns.some((run) => run.runId === baseline.acceptedRunId)) return true;
  const terminal = projection.lastTerminalRun;
  return terminal?.runId === baseline.acceptedRunId;
}

function eventClearsPendingSend(
  event: SessionEvent,
  baseline: PendingSendRuntimeBaseline | undefined,
): boolean {
  const origin = 'runtimeEvent' in event ? event.runtimeEvent : undefined;
  if (baseline?.acceptedRunId === undefined) {
    return (
      origin === undefined &&
      (event.kind === 'session_start' ||
        event.kind === 'queued_user_prompt_started' ||
        event.kind === 'mid_turn_user_prompt')
    );
  }
  if (origin === undefined) return false;
  const sameKnownLiveLineage =
    baseline.liveCursorSessionId === undefined ||
    baseline.liveCursorJournalEpoch === undefined ||
    origin.journalEpoch === undefined ||
    (baseline.liveCursorSessionId === event.sessionId &&
      baseline.liveCursorJournalEpoch === origin.journalEpoch);
  if (
    (baseline.runtimeId !== undefined && origin.runtimeId !== baseline.runtimeId) ||
    (sameKnownLiveLineage && origin.seq <= baseline.liveCursorSeq)
  ) {
    return false;
  }
  return origin.runId === baseline.acceptedRunId;
}

function runtimeProfileClearsPendingSend(
  profile: SpaceRuntimeProfileProjectionT | null,
  sessionId: string,
  baseline: PendingSendRuntimeBaseline | undefined,
): boolean {
  if (
    baseline?.acceptedRunId === undefined ||
    profile?.cursor === undefined ||
    (baseline.runtimeId !== undefined && profile.cursor.runtimeId !== baseline.runtimeId) ||
    profile.cursor.seq <= baseline.profileCursorSeq
  ) {
    return false;
  }
  const session = profile.sessions.find((candidate) => candidate.sessionId === sessionId);
  return (
    session?.activeRun?.runId === baseline.acceptedRunId ||
    session?.queuedRuns.some((run) => run.runId === baseline.acceptedRunId) === true ||
    session?.lastTerminalRun?.runId === baseline.acceptedRunId
  );
}

function acknowledgedPendingSendAlreadyObserved(
  state: Pick<AppState, 'runtimeProfile' | 'liveProjectionBySession' | 'eventsBySession'>,
  sessionId: string,
  baseline: PendingSendRuntimeBaseline,
): boolean {
  const live = state.liveProjectionBySession[sessionId];
  return (
    (live !== undefined && liveProjectionClearsPendingSend(live, baseline)) ||
    runtimeProfileClearsPendingSend(state.runtimeProfile, sessionId, baseline) ||
    (state.eventsBySession[sessionId] ?? []).some((event) =>
      eventClearsPendingSend(event, baseline),
    )
  );
}

const LOCAL_TERMINAL_TURN_PREFIX = 'space-local-terminal:';

function initialLiveUserCandidates(
  userMessages: readonly UserMessage[],
  runId: string | undefined,
): { readonly run: readonly number[]; readonly unscoped: readonly number[] } {
  const run: number[] = [];
  const unscoped: number[] = [];
  userMessages.forEach((message, index) => {
    if (
      message.restoredFromHistory ||
      message.hiddenHistoryAnchor ||
      message.turnId !== undefined
    ) {
      return;
    }
    if (runId === undefined || message.runtimeRunId === undefined) unscoped.push(index);
    else if (message.runtimeRunId === runId) run.push(index);
  });
  return { run, unscoped };
}

function causallyProvenUnscopedRunTarget(
  userMessages: readonly UserMessage[],
  events: readonly SessionEvent[],
  candidates: readonly number[],
  runId: string,
  runStartedAt: number | undefined,
): number | undefined {
  if (candidates.length !== 1) return undefined;
  const targetIndex = candidates[0]!;
  const turn = transcriptTurnSnapshots(userMessages, events).find(
    (candidate) => candidate.userIndex === targetIndex,
  );
  if (!turn) return undefined;
  const matchingRunEvents = events
    .slice(turn.eventStart, turn.eventEnd)
    .filter((event) => 'runtimeEvent' in event && event.runtimeEvent?.runId === runId);
  const predatesAuthoritativeStart =
    runStartedAt !== undefined && userMessages[targetIndex]!.sentAt <= runStartedAt;
  if (transcriptContentRuns(matchingRunEvents).length === 0) return undefined;
  return runStartedAt !== undefined && predatesAuthoritativeStart ? targetIndex : undefined;
}

function initialLiveUserTargetIndex(
  userMessages: readonly UserMessage[],
  events: readonly SessionEvent[],
  turnId: string,
  runId: string | undefined,
  unscopedMode: 'none' | 'latest' | 'unique',
  runStartedAt: number | undefined,
): number | undefined {
  const candidates = initialLiveUserCandidates(userMessages, runId);
  if (turnId.startsWith(LOCAL_TERMINAL_TURN_PREFIX)) {
    const messageId = turnId.slice(LOCAL_TERMINAL_TURN_PREFIX.length);
    const localTarget = userMessages.findIndex((message) => message.id === messageId);
    if (localTarget >= 0) return localTarget;
  }
  if (runId !== undefined) {
    return (
      candidates.run.at(-1) ??
      (unscopedMode === 'unique'
        ? causallyProvenUnscopedRunTarget(
            userMessages,
            events,
            candidates.unscoped,
            runId,
            runStartedAt,
          )
        : undefined)
    );
  }
  if (unscopedMode === 'latest') return candidates.unscoped.at(-1);
  return unscopedMode === 'unique' && candidates.unscoped.length === 1
    ? candidates.unscoped[0]
    : undefined;
}

function bindInitialLiveUserTurnIdentity(
  userMessages: readonly UserMessage[],
  turnId: string,
  runId: string | undefined,
  unscopedMode: 'none' | 'latest' | 'unique',
  events: readonly SessionEvent[],
  runStartedAt?: number,
): readonly UserMessage[] {
  if (
    userMessages.some(
      (message) =>
        !message.restoredFromHistory && message.turnId === turnId && message.turnUserOrdinal === 0,
    )
  ) {
    return userMessages;
  }
  const targetIndex = initialLiveUserTargetIndex(
    userMessages,
    events,
    turnId,
    runId,
    unscopedMode,
    runStartedAt,
  );
  if (targetIndex !== undefined) {
    const next = userMessages.slice();
    next[targetIndex] = {
      ...next[targetIndex]!,
      turnId,
      turnUserOrdinal: 0,
      ...(runId !== undefined ? { runtimeRunId: runId } : {}),
    };
    return next;
  }
  return userMessages;
}

function openExactRestoredInitialTurn(
  userMessages: readonly UserMessage[],
  turnId: string,
  runId: string | undefined,
): readonly UserMessage[] {
  const candidates = userMessages.flatMap((message, index) => {
    if (
      message.restoredFromHistory !== true ||
      message.hiddenHistoryAnchor === true ||
      message.historyNoAssistantSegment !== true ||
      message.turnId !== turnId ||
      message.turnUserOrdinal !== 0 ||
      (runId !== undefined && message.runtimeRunId !== undefined && message.runtimeRunId !== runId)
    ) {
      return [];
    }
    return [index];
  });
  if (candidates.length !== 1) return userMessages;

  const targetIndex = candidates[0]!;
  const { historyNoAssistantSegment: _emptySegment, ...restoredOwner } = userMessages[targetIndex]!;
  const next = userMessages.slice();
  next[targetIndex] = {
    ...restoredOwner,
    ...(runId !== undefined ? { runtimeRunId: runId } : {}),
  };
  return next;
}

function knownProjectionRunTurnId(
  projection: SpaceSessionLiveProjectionT,
  runId: string,
): string | undefined {
  if (projection.activeRun?.runId === runId && projection.activeRun.turnId !== undefined) {
    return projection.activeRun.turnId;
  }
  const queued = projection.queuedRuns.find(
    (run) => run.runId === runId && run.turnId !== undefined,
  );
  if (queued?.turnId !== undefined) return queued.turnId;
  if (
    projection.lastTerminalRun?.runId === runId &&
    projection.lastTerminalRun.turnId !== undefined
  ) {
    return projection.lastTerminalRun.turnId;
  }
  return undefined;
}

function preserveKnownProjectionRunTurnIdentity(
  current: SpaceSessionLiveProjectionT | undefined,
  incoming: SpaceSessionLiveProjectionT,
): SpaceSessionLiveProjectionT {
  if (current === undefined || current.cursor.runtimeId !== incoming.cursor.runtimeId)
    return incoming;
  const activeTurnId =
    incoming.activeRun === undefined || incoming.activeRun.turnId !== undefined
      ? undefined
      : knownProjectionRunTurnId(current, incoming.activeRun.runId);
  const terminalTurnId =
    incoming.lastTerminalRun === undefined || incoming.lastTerminalRun.turnId !== undefined
      ? undefined
      : knownProjectionRunTurnId(current, incoming.lastTerminalRun.runId);
  let queuedRunsChanged = false;
  const queuedRuns = incoming.queuedRuns.map((run) => {
    const knownTurnId = knownProjectionRunTurnId(current, run.runId);
    if (run.turnId !== undefined || knownTurnId === undefined) return run;
    queuedRunsChanged = true;
    return { ...run, turnId: knownTurnId };
  });
  const activeRun =
    incoming.activeRun !== undefined &&
    activeTurnId !== undefined &&
    activeTurnId !== incoming.activeRun.turnId
      ? { ...incoming.activeRun, turnId: activeTurnId }
      : incoming.activeRun;
  const lastTerminalRun =
    incoming.lastTerminalRun !== undefined &&
    terminalTurnId !== undefined &&
    terminalTurnId !== incoming.lastTerminalRun.turnId
      ? { ...incoming.lastTerminalRun, turnId: terminalTurnId }
      : incoming.lastTerminalRun;
  if (
    activeRun === incoming.activeRun &&
    lastTerminalRun === incoming.lastTerminalRun &&
    !queuedRunsChanged
  ) {
    return incoming;
  }
  return { ...incoming, activeRun, queuedRuns, lastTerminalRun };
}

/** Deterministically claim a lost-ACK optimistic user message when a live run
 *  projection carries the same send operationId in its origin. This replaces
 *  positional matching for the exact-send recovery shape. */
function claimUserMessagesByOriginOperation(
  users: readonly UserMessage[],
  projection: SpaceSessionLiveProjectionT,
): readonly UserMessage[] {
  const runs = [projection.activeRun, projection.lastTerminalRun, ...projection.queuedRuns];
  let next: UserMessage[] | undefined;
  for (const run of runs) {
    if (run?.originOperationId === undefined) continue;
    for (let index = 0; index < users.length; index += 1) {
      // Read through the accumulated result so two runs sharing one operationId
      // cannot overwrite each other's claim within a single projection pass.
      const message = (next ?? users)[index]!;
      if (
        message.operationId !== run.originOperationId ||
        message.restoredFromHistory === true ||
        message.runtimeRunId !== undefined ||
        message.turnId !== undefined
      ) {
        continue;
      }
      (next ??= users.slice())[index] = { ...message, runtimeRunId: run.runId };
    }
  }
  return next ?? users;
}

function reconcileSnapshotInitialTurnOwners(
  sessionId: string,
  userMessages: readonly UserMessage[],
  events: readonly SessionEvent[],
  projection: SpaceSessionLiveProjectionT | undefined,
  target: 'active' | 'terminal' | 'all' = 'all',
): readonly UserMessage[] {
  if (projection === undefined) return userMessages;
  let reconciled = userMessages;
  if (target !== 'active' && projection.lastTerminalRun !== undefined) {
    reconciled = reconcileProjectionRunInitialTurnOwner(
      sessionId,
      reconciled,
      events,
      projection.lastTerminalRun,
      false,
    );
  }
  if (
    target !== 'terminal' &&
    projection.activeRun !== undefined &&
    (target === 'active' || projection.activeRun.runId !== projection.lastTerminalRun?.runId)
  ) {
    reconciled = reconcileProjectionRunInitialTurnOwner(
      sessionId,
      reconciled,
      events,
      projection.activeRun,
      true,
    );
  }
  return reconciled;
}

function reconcileProjectionRunInitialTurnOwner(
  sessionId: string,
  userMessages: readonly UserMessage[],
  events: readonly SessionEvent[],
  run: NonNullable<
    SpaceSessionLiveProjectionT['activeRun'] | SpaceSessionLiveProjectionT['lastTerminalRun']
  >,
  openRestoredOwner: boolean,
): readonly UserMessage[] {
  if (run?.turnId === undefined) return userMessages;
  const opened = openRestoredOwner
    ? openExactRestoredInitialTurn(userMessages, run.turnId, run.runId)
    : userMessages;
  const reconciled = bindInitialLiveUserTurnIdentity(
    opened,
    run.turnId,
    run.runId,
    'unique',
    events,
    run.startedAt,
  );
  const openedOwner = reconciled.find(
    (message) =>
      message.restoredFromHistory === true &&
      message.turnId === run.turnId &&
      message.turnUserOrdinal === 0 &&
      message.runtimeRunId === run.runId &&
      message.historyNoAssistantSegment !== true,
  );
  if (openedOwner !== undefined) rememberOpenedHistoryLiveOwner(sessionId, openedOwner);
  return reconciled;
}

function localTerminalTurnIdForLatestLiveUser(
  userMessages: readonly UserMessage[],
): string | undefined {
  for (let index = userMessages.length - 1; index >= 0; index--) {
    const message = userMessages[index]!;
    if (message.restoredFromHistory || message.hiddenHistoryAnchor) continue;
    const expectedLocalTurnId = `${LOCAL_TERMINAL_TURN_PREFIX}${message.id}`;
    if (message.turnId === undefined) return expectedLocalTurnId;
    if (message.turnId === expectedLocalTurnId) return message.turnId;
    // The newest live user already belongs to an authoritative Runtime turn. Never walk farther
    // back and steal an older unbound user merely because a later terminal omitted its turn id.
    return undefined;
  }
  return undefined;
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
  lastLocalTranscriptSentAt = Math.max(lastLocalTranscriptSentAt, sentAt);
  return {
    id: `ln_${sentAt}_${++localNoticeCounter}_${randomLocalNoticeSuffix()}`,
    content,
    sentAt,
    variant: normalized.variant ?? defaultLocalNoticeVariant(content),
  };
}

function mergeLocalNotices(
  buckets: readonly (readonly LocalNoticeMessage[])[],
  requiredNoticeId?: string,
): readonly LocalNoticeMessage[] {
  const byId = new Map<string, LocalNoticeMessage>();
  for (const bucket of buckets) {
    for (const notice of bucket) byId.set(notice.id, notice);
  }
  const sorted = [...byId.values()].sort((a, b) => a.sentAt - b.sentAt || a.id.localeCompare(b.id));
  if (sorted.length <= MAX_LOCAL_NOTICES_PER_SESSION) return sorted;
  const newest = sorted.slice(-MAX_LOCAL_NOTICES_PER_SESSION);
  if (requiredNoticeId === undefined || newest.some((notice) => notice.id === requiredNoticeId)) {
    return newest;
  }
  const required = byId.get(requiredNoticeId);
  if (required === undefined) return newest;
  return [required, ...sorted.slice(sorted.length - (MAX_LOCAL_NOTICES_PER_SESSION - 1))].sort(
    (a, b) => a.sentAt - b.sentAt || a.id.localeCompare(b.id),
  );
}

interface LocalNoticeIpcBridge {
  invoke(
    channel: 'session.localNotice.append',
    payload: { readonly sessionId: string; readonly notice: LocalNoticeMessage },
  ): Promise<{ readonly ok: boolean }>;
  invoke(
    channel: 'session.localNotice.replace',
    payload: { readonly sessionId: string; readonly notices: readonly LocalNoticeMessage[] },
  ): Promise<{ readonly ok: boolean }>;
}

function getLocalNoticeBridge(): LocalNoticeIpcBridge | undefined {
  if (typeof window === 'undefined') return undefined;
  return (window as Window & { readonly kodaxSpace?: LocalNoticeIpcBridge }).kodaxSpace;
}

const localNoticePersistenceFailures = new Set<string>();
const failedLocalNoticeAppends = new Map<string, Map<string, LocalNoticeMessage>>();
const failedLocalNoticeAppendNeedsReconcile = new Set<string>();
const failedLocalNoticeReplaces = new Set<string>();
const localNoticeRetryInFlight = new Set<string>();
let localNoticePersistenceFailureToastId: string | null = null;
const MAX_FAILED_LOCAL_NOTICE_BYTES = 8 * 1024 * 1024;

function reportLocalNoticePersistenceFailure(sessionId: string): void {
  console.error('[local-notice] durable persistence failed');
  localNoticePersistenceFailures.add(sessionId);
  const currentToastExists = useToastStore
    .getState()
    .toasts.some((toast) => toast.id === localNoticePersistenceFailureToastId);
  if (currentToastExists) return;
  pushToast(translateMessage('session.localNoticePersistenceFailed'), 'error', 0);
  localNoticePersistenceFailureToastId = useToastStore.getState().toasts.at(-1)?.id ?? null;
}

function clearLocalNoticePersistenceFailure(sessionId: string): void {
  localNoticePersistenceFailures.delete(sessionId);
  if (localNoticePersistenceFailures.size > 0) return;
  if (localNoticePersistenceFailureToastId !== null) {
    useToastStore.getState().dismiss(localNoticePersistenceFailureToastId);
  }
  localNoticePersistenceFailureToastId = null;
}

function recordLocalNoticeAppendFailure(sessionId: string, notice: LocalNoticeMessage): void {
  const current = failedLocalNoticeAppends.get(sessionId);
  const countBounded = mergeLocalNotices(
    [current ? [...current.values()] : [], [notice]],
    notice.id,
  );
  const encoded = new Map(
    countBounded.map((candidate) => [
      candidate.id,
      new TextEncoder().encode(JSON.stringify(candidate)).byteLength,
    ]),
  );
  const requiredBytes = encoded.get(notice.id);
  if (requiredBytes === undefined || requiredBytes > MAX_FAILED_LOCAL_NOTICE_BYTES) {
    // No bounded exact payload can be retried. Keep the warning latched until an explicit full
    // replace/reconcile succeeds; never retain an unbounded body merely to clear a toast.
    failedLocalNoticeAppendNeedsReconcile.add(sessionId);
  } else {
    const retainedIds = new Set<string>([notice.id]);
    let retainedBytes = requiredBytes;
    for (let index = countBounded.length - 1; index >= 0; index -= 1) {
      const candidate = countBounded[index]!;
      if (retainedIds.has(candidate.id)) continue;
      const candidateBytes = encoded.get(candidate.id)! + 1;
      if (retainedBytes + candidateBytes > MAX_FAILED_LOCAL_NOTICE_BYTES) break;
      retainedIds.add(candidate.id);
      retainedBytes += candidateBytes;
    }
    failedLocalNoticeAppends.set(
      sessionId,
      new Map(
        countBounded
          .filter((candidate) => retainedIds.has(candidate.id))
          .map((candidate) => [candidate.id, candidate]),
      ),
    );
  }
  reportLocalNoticePersistenceFailure(sessionId);
}

async function retryFailedLocalNoticeAppends(
  sessionId: string,
  bridge: LocalNoticeIpcBridge,
): Promise<void> {
  if (localNoticeRetryInFlight.has(sessionId)) return;
  const pending = failedLocalNoticeAppends.get(sessionId);
  if (!pending || pending.size === 0) {
    if (
      !failedLocalNoticeReplaces.has(sessionId) &&
      !failedLocalNoticeAppendNeedsReconcile.has(sessionId)
    ) {
      clearLocalNoticePersistenceFailure(sessionId);
    }
    return;
  }

  localNoticeRetryInFlight.add(sessionId);
  try {
    // The main-side store dedupes by notice id, so replaying the exact failed payload is
    // idempotent even if an IPC acknowledgement was lost after the durable write.
    for (const [noticeId, notice] of [...pending.entries()]) {
      try {
        const result = await bridge.invoke('session.localNotice.append', { sessionId, notice });
        if (!result.ok) {
          reportLocalNoticePersistenceFailure(sessionId);
          continue;
        }
        pending.delete(noticeId);
      } catch {
        reportLocalNoticePersistenceFailure(sessionId);
      }
    }
    if (pending.size === 0 && failedLocalNoticeAppends.get(sessionId) === pending) {
      failedLocalNoticeAppends.delete(sessionId);
    }
    const remaining = failedLocalNoticeAppends.get(sessionId);
    if (
      (!remaining || remaining.size === 0) &&
      !failedLocalNoticeReplaces.has(sessionId) &&
      !failedLocalNoticeAppendNeedsReconcile.has(sessionId)
    ) {
      clearLocalNoticePersistenceFailure(sessionId);
    }
  } finally {
    localNoticeRetryInFlight.delete(sessionId);
  }
}

function persistLocalNoticeAppend(sessionId: string, notice: LocalNoticeMessage): void {
  const bridge = getLocalNoticeBridge();
  if (!bridge) return;
  void bridge
    .invoke('session.localNotice.append', { sessionId, notice })
    .then((result) => {
      if (!result.ok) recordLocalNoticeAppendFailure(sessionId, notice);
      else void retryFailedLocalNoticeAppends(sessionId, bridge);
    })
    .catch(() => recordLocalNoticeAppendFailure(sessionId, notice));
}

function persistLocalNoticeReplace(
  sessionId: string,
  notices: readonly LocalNoticeMessage[],
): void {
  const bridge = getLocalNoticeBridge();
  if (!bridge) return;
  void bridge
    .invoke('session.localNotice.replace', { sessionId, notices })
    .then((result) => {
      if (!result.ok) {
        failedLocalNoticeReplaces.add(sessionId);
        reportLocalNoticePersistenceFailure(sessionId);
        return;
      }
      failedLocalNoticeReplaces.delete(sessionId);
      failedLocalNoticeAppends.delete(sessionId);
      failedLocalNoticeAppendNeedsReconcile.delete(sessionId);
      clearLocalNoticePersistenceFailure(sessionId);
    })
    .catch(() => {
      failedLocalNoticeReplaces.add(sessionId);
      reportLocalNoticePersistenceFailure(sessionId);
    });
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

interface RuntimeQueuedInputReconciliation {
  readonly userMessages: UserMessage[];
  readonly queuedMessages: QueuedUserMessage[];
}

interface RuntimeStartedAfterTurnReconciliation extends RuntimeQueuedInputReconciliation {
  readonly events: SessionEvent[];
}

function queuedMessageFromUserOwner(
  owner: UserMessage,
  input: RuntimeQueuedInputProjection,
  queueMode: QueuedUserMessage['queueMode'],
): QueuedUserMessage {
  return {
    id: owner.id,
    content: owner.content,
    matchContent: input.contentPreview ?? owner.content,
    ...(owner.attachments !== undefined ? { attachments: owner.attachments } : {}),
    queueId: input.inputId,
    queueMode,
    operationId: input.originOperationId,
    ...(owner.operationReservation !== undefined
      ? { operationReservation: owner.operationReservation }
      : {}),
    status: 'queued',
    sentAt: owner.sentAt,
  };
}

function reconcileRuntimeQueuedMessages(
  currentUsers: readonly UserMessage[],
  currentQueued: readonly QueuedUserMessage[],
  projection: SpaceSessionLiveProjectionT,
): RuntimeQueuedInputReconciliation {
  let nextUsers = [...currentUsers];
  let nextQueued = [...currentQueued];
  for (const input of projection.queuedInputs) {
    if (input.state !== 'queued' && input.state !== 'delivering') continue;
    const queueMode = input.delivery === 'after-turn' ? 'after-turn' : 'interrupt';
    const operationOwnerIndex =
      input.originOperationId === undefined
        ? -1
        : nextUsers.findIndex((message) => message.operationId === input.originOperationId);
    const operationOwner = operationOwnerIndex === -1 ? undefined : nextUsers[operationOwnerIndex];
    const matchingIndexes = nextQueued.flatMap((entry, index) =>
      (entry.queueMode === queueMode && entry.queueId === input.inputId) ||
      (input.originOperationId !== undefined && entry.operationId === input.originOperationId)
        ? [index]
        : [],
    );
    if (operationOwner !== undefined && userMessageHasSettledSendAdmission(operationOwner)) {
      const matched = new Set(matchingIndexes);
      nextQueued = nextQueued.filter((_entry, index) => !matched.has(index));
      continue;
    }
    const migratedOwner =
      operationOwner === undefined
        ? undefined
        : queuedMessageFromUserOwner(operationOwner, input, queueMode);
    if (operationOwnerIndex !== -1) nextUsers.splice(operationOwnerIndex, 1);
    if (matchingIndexes.length > 0 || migratedOwner !== undefined) {
      const preferredIndex =
        matchingIndexes.find((index) => !nextQueued[index]!.id.startsWith('runtime-queue:')) ??
        matchingIndexes[0]!;
      const existing = migratedOwner ?? nextQueued[preferredIndex]!;
      const failed = matchingIndexes
        .map((index) => nextQueued[index]!)
        .find((entry) => entry.status === 'failed');
      const merged: QueuedUserMessage = {
        ...existing,
        queueId: input.inputId,
        queueMode,
        ...(existing.operationId !== undefined
          ? { operationId: existing.operationId }
          : input.originOperationId !== undefined
            ? { operationId: input.originOperationId }
            : {}),
        status: failed ? 'failed' : 'queued',
        ...(failed?.failureReason !== undefined ? { failureReason: failed.failureReason } : {}),
      };
      const insertionIndex =
        matchingIndexes.length === 0 ? nextQueued.length : Math.min(...matchingIndexes);
      const matched = new Set(matchingIndexes);
      nextQueued = nextQueued.filter((_entry, index) => !matched.has(index));
      nextQueued.splice(insertionIndex, 0, merged);
      continue;
    }
    const content = input.contentPreview ?? '';
    nextQueued.push({
      id: `runtime-queue:${input.delivery}:${input.inputId}`,
      queueId: input.inputId,
      ...(input.originOperationId !== undefined ? { operationId: input.originOperationId } : {}),
      content,
      matchContent: content,
      queueMode,
      status: 'queued',
      sentAt: input.createdAt,
    });
  }
  return { userMessages: nextUsers, queuedMessages: nextQueued };
}

type RuntimeRunProjection = NonNullable<SpaceSessionLiveProjectionT['activeRun']>;

function startedAfterTurnOwner(
  projection: SpaceSessionLiveProjectionT,
  run: RuntimeRunProjection,
  queued: QueuedUserMessage,
  owner: UserMessage | undefined,
): UserMessage {
  const operationId = queued.operationId ?? run.originOperationId;
  const identity = run.turnId === undefined ? {} : { turnId: run.turnId, turnUserOrdinal: 0 };
  const base =
    owner ??
    createUserMessage(
      projection.sessionId,
      queued.content,
      queued.sentAt,
      run.turnId === undefined ? undefined : { turnId: run.turnId, turnUserOrdinal: 0 },
      queued.attachments,
    );
  return {
    ...base,
    ...identity,
    ...(owner === undefined ? { id: queued.id } : {}),
    ...(owner?.attachments === undefined && queued.attachments !== undefined
      ? { attachments: queued.attachments }
      : {}),
    deliveryQueueId: queued.queueId ?? run.runId,
    deliveryQueueMode: 'after-turn',
    runtimeRunId: run.runId,
    sourceQueuedLocalId: queued.id,
    ...(operationId !== undefined ? { operationId } : {}),
  };
}

function ensureStartedAfterTurnBoundary(
  events: SessionEvent[],
  projection: SpaceSessionLiveProjectionT,
  run: RuntimeRunProjection,
  queued: QueuedUserMessage,
): number {
  const existing = events.findIndex(
    (event) =>
      event.kind === 'queued_user_prompt_started' &&
      ((queued.queueId !== undefined && event.queueId === queued.queueId) ||
        (run.turnId !== undefined && event.turnId === run.turnId)),
  );
  if (existing !== -1) return existing;
  const exactTurnStart =
    run.turnId === undefined
      ? -1
      : events.findIndex((event) => 'turnId' in event && event.turnId === run.turnId);
  const insertionIndex = exactTurnStart === -1 ? events.length : exactTurnStart;
  events.splice(insertionIndex, 0, {
    kind: 'queued_user_prompt_started',
    sessionId: projection.sessionId,
    queueId: queued.queueId ?? run.runId,
    queueMode: 'after-turn',
    content: queued.content,
    ...(run.turnId !== undefined ? { turnId: run.turnId, turnUserOrdinal: 0 } : {}),
  });
  return insertionIndex;
}

function reconcileRuntimeStartedAfterTurnInputs(
  events: readonly SessionEvent[],
  currentUsers: readonly UserMessage[],
  currentQueued: readonly QueuedUserMessage[],
  projection: SpaceSessionLiveProjectionT,
): RuntimeStartedAfterTurnReconciliation {
  const runs = [projection.activeRun, projection.lastTerminalRun].filter(
    (run): run is RuntimeRunProjection => run !== undefined,
  );
  const nextEvents = [...events];
  let nextUsers = [...currentUsers];
  let nextQueued = [...currentQueued];
  for (const run of runs) {
    const matches = nextQueued.filter(
      (entry) =>
        entry.queueMode === 'after-turn' &&
        (entry.queueId === run.runId ||
          (run.originOperationId !== undefined && entry.operationId === run.originOperationId)),
    );
    if (matches.length === 0) continue;
    const queued = matches.find((entry) => !entry.id.startsWith('runtime-queue:')) ?? matches[0]!;
    const matchedIds = new Set(matches.map((entry) => entry.id));
    nextQueued = nextQueued.filter((entry) => !matchedIds.has(entry.id));
    const ownerIndex = nextUsers.findIndex(
      (message) =>
        message.runtimeRunId === run.runId ||
        (run.originOperationId !== undefined && message.operationId === run.originOperationId) ||
        (run.turnId !== undefined &&
          message.turnId === run.turnId &&
          (message.turnUserOrdinal ?? 0) === 0),
    );
    const owner = ownerIndex === -1 ? undefined : nextUsers[ownerIndex];
    const promoted = startedAfterTurnOwner(projection, run, queued, owner);
    let remainingUsers: readonly UserMessage[] = nextUsers.filter(
      (_message, index) => index !== ownerIndex,
    );
    const boundaryIndex = ensureStartedAfterTurnBoundary(nextEvents, projection, run, queued);
    remainingUsers = alignSegmentOwnersBeforePrompt(
      projection.sessionId,
      remainingUsers,
      nextEvents,
      boundaryIndex,
      promoted.sentAt,
    );
    nextUsers = [...remainingUsers, promoted];
  }
  return { events: nextEvents, userMessages: nextUsers, queuedMessages: nextQueued };
}

interface AcceptedQueuedMessageResolution {
  readonly target: QueuedUserMessage;
  readonly acceptedMode: QueuedUserMessage['queueMode'];
  readonly accepted: QueuedUserMessage;
  readonly remaining: QueuedUserMessage[];
  readonly insertionIndex: number;
}

function resolveAcceptedQueuedMessage(
  bucket: readonly QueuedUserMessage[],
  localId: string,
  queueId: string | undefined,
  queueMode: QueuedUserMessage['queueMode'] | undefined,
): AcceptedQueuedMessageResolution | undefined {
  const target = bucket.find((entry) => entry.id === localId);
  if (!target) return undefined;
  const acceptedMode = queueMode ?? target.queueMode;
  const matchingIndexes = bucket.flatMap((entry, index) =>
    entry.id === localId ||
    (entry.queueMode === acceptedMode && queueId !== undefined && entry.queueId === queueId) ||
    (target.operationId !== undefined && entry.operationId === target.operationId)
      ? [index]
      : [],
  );
  const failed = matchingIndexes
    .map((index) => bucket[index]!)
    .find((entry) => entry.status === 'failed');
  const matched = new Set(matchingIndexes);
  return {
    target,
    acceptedMode,
    accepted: {
      ...target,
      ...(queueId !== undefined ? { queueId } : {}),
      queueMode: acceptedMode,
      status: failed ? 'failed' : 'queued',
      ...(failed?.failureReason !== undefined ? { failureReason: failed.failureReason } : {}),
    },
    remaining: bucket.filter((_entry, index) => !matched.has(index)),
    insertionIndex: Math.min(...matchingIndexes),
  };
}

interface RuntimeDeliveredInputReconciliation {
  readonly events: SessionEvent[];
  readonly userMessages: UserMessage[];
  readonly queuedMessages: QueuedUserMessage[];
}

type RuntimeQueuedInputProjection = SpaceSessionLiveProjectionT['queuedInputs'][number];

function deliveredInputIdentity(
  input: RuntimeQueuedInputProjection,
): StrongUserTurnIdentity | undefined {
  return input.turnId !== undefined && input.turnUserOrdinal !== undefined
    ? { turnId: input.turnId, turnUserOrdinal: input.turnUserOrdinal }
    : undefined;
}

function createDeliveredInputUserMessage(
  projection: SpaceSessionLiveProjectionT,
  input: RuntimeQueuedInputProjection,
  queued: QueuedUserMessage | undefined,
  content: string,
): UserMessage {
  const created = createUserMessage(
    projection.sessionId,
    content,
    input.deliveredAt ?? input.createdAt,
    deliveredInputIdentity(input),
    queued?.attachments,
  );
  return {
    ...created,
    // A queued projection can migrate an ordinary provisional row before delivery. Moving it
    // back must retain that renderer owner and its attempt fence, not manufacture another row.
    ...(queued !== undefined ? { id: queued.id } : {}),
    deliveryQueueId: input.inputId,
    deliveryQueueMode: 'interrupt',
    deliveredInterrupt: true,
    ...(queued ? { sourceQueuedLocalId: queued.id } : {}),
    ...(queued?.operationId !== undefined
      ? { operationId: queued.operationId }
      : input.originOperationId !== undefined
        ? { operationId: input.originOperationId }
        : {}),
    ...(queued?.operationReservation !== undefined
      ? { operationReservation: queued.operationReservation }
      : {}),
    entryId: input.entryId,
  };
}

function deliveredInputUserMessage(
  projection: SpaceSessionLiveProjectionT,
  input: RuntimeQueuedInputProjection,
  owner: UserMessage | undefined,
  queued: QueuedUserMessage | undefined,
  content: string,
): UserMessage {
  if (owner === undefined)
    return createDeliveredInputUserMessage(projection, input, queued, content);
  return {
    ...owner,
    content,
    sentAt: input.deliveredAt ?? input.createdAt,
    ...(deliveredInputIdentity(input) ?? {}),
    deliveryQueueId: input.inputId,
    deliveryQueueMode: 'interrupt',
    deliveredInterrupt: true,
    ...(queued !== undefined ? { sourceQueuedLocalId: queued.id } : {}),
    ...(owner.operationId !== undefined
      ? { operationId: owner.operationId }
      : input.originOperationId !== undefined
        ? { operationId: input.originOperationId }
        : {}),
    ...(owner.attachments !== undefined
      ? { attachments: owner.attachments }
      : queued?.attachments !== undefined
        ? { attachments: queued.attachments }
        : {}),
    entryId: input.entryId,
  };
}

function createDeliveredInputBoundary(
  projection: SpaceSessionLiveProjectionT,
  input: RuntimeQueuedInputProjection,
  content: string,
): Extract<SessionEvent, { kind: 'mid_turn_user_prompt' }> {
  return {
    kind: 'mid_turn_user_prompt',
    sessionId: projection.sessionId,
    queueId: input.inputId,
    content,
    entryId: input.entryId,
    ...(deliveredInputIdentity(input) ?? {}),
    ...(input.deliveredAt !== undefined ? { sentAt: input.deliveredAt } : {}),
    ...(input.runId !== undefined && input.deliverySeq !== undefined
      ? {
          runtimeEvent: {
            runtimeId: projection.cursor.runtimeId,
            runId: input.runId,
            ...(projection.cursor.journalEpoch !== undefined
              ? { journalEpoch: projection.cursor.journalEpoch }
              : {}),
            seq: input.deliverySeq,
          },
        }
      : {}),
  };
}

function deliveredInputBoundaryInsertionIndex(
  events: readonly SessionEvent[],
  projection: SpaceSessionLiveProjectionT,
  input: RuntimeQueuedInputProjection,
): number {
  const deliverySeq = input.deliverySeq;
  if (deliverySeq !== undefined) {
    return events.findIndex((event) => {
      const origin = 'runtimeEvent' in event ? event.runtimeEvent : undefined;
      return (
        origin?.runtimeId === projection.cursor.runtimeId &&
        origin?.journalEpoch === projection.cursor.journalEpoch &&
        origin.seq > deliverySeq
      );
    });
  }
  const deliveredAt = input.deliveredAt;
  if (deliveredAt === undefined) return -1;
  return events.findIndex((event) => {
    const origin = 'runtimeEvent' in event ? event.runtimeEvent : undefined;
    const sentAt = 'sentAt' in event ? event.sentAt : undefined;
    const sameOwner =
      (input.runId !== undefined && origin?.runId === input.runId) ||
      (input.turnId !== undefined && 'turnId' in event && event.turnId === input.turnId);
    return sameOwner && sentAt !== undefined && sentAt >= deliveredAt;
  });
}

function reconcileRuntimeDeliveredInputs(
  events: readonly SessionEvent[],
  userMessages: readonly UserMessage[],
  queuedMessages: readonly QueuedUserMessage[],
  projection: SpaceSessionLiveProjectionT,
): RuntimeDeliveredInputReconciliation {
  const nextEvents = [...events];
  const nextUsers = [...userMessages];
  let nextQueued = [...queuedMessages];
  for (const input of projection.queuedInputs) {
    const activeRun = projection.activeRun;
    if (
      input.delivery !== 'interrupt' ||
      input.state !== 'delivered' ||
      !input.entryId ||
      (input.deliverySeq === undefined && input.deliveredAt === undefined) ||
      activeRun === undefined ||
      input.runId !== activeRun.runId ||
      (activeRun.turnId !== undefined && input.turnId !== activeRun.turnId)
    ) {
      continue;
    }
    const matchingQueued = nextQueued.filter(
      (entry) =>
        entry.queueMode === 'interrupt' &&
        (entry.queueId === input.inputId ||
          (input.originOperationId !== undefined && entry.operationId === input.originOperationId)),
    );
    const queued =
      matchingQueued.find((entry) => !entry.id.startsWith('runtime-queue:')) ?? matchingQueued[0];
    const matchingQueuedIds = new Set(matchingQueued.map((entry) => entry.id));
    nextQueued = nextQueued.filter((entry) => !matchingQueuedIds.has(entry.id));
    const matchingUserIndexes = nextUsers.flatMap((message, index) =>
      message.entryId === input.entryId ||
      (input.originOperationId !== undefined && message.operationId === input.originOperationId)
        ? [index]
        : [],
    );
    const ownerIndex =
      matchingUserIndexes.find(
        (index) =>
          input.originOperationId !== undefined &&
          nextUsers[index]?.operationId === input.originOperationId,
      ) ?? matchingUserIndexes[0];
    const owner = ownerIndex === undefined ? undefined : nextUsers[ownerIndex];
    const content = owner?.content ?? queued?.content ?? input.contentPreview ?? '';
    const delivered = deliveredInputUserMessage(projection, input, owner, queued, content);
    const matchedUsers = new Set(matchingUserIndexes);
    let remainingUsers: readonly UserMessage[] = nextUsers.filter(
      (_message, index) => !matchedUsers.has(index),
    );
    let boundaryIndex = nextEvents.findIndex(
      (event) => event.kind === 'mid_turn_user_prompt' && event.entryId === input.entryId,
    );
    if (boundaryIndex === -1) {
      const boundary = createDeliveredInputBoundary(projection, input, content);
      const insertionIndex = deliveredInputBoundaryInsertionIndex(nextEvents, projection, input);
      boundaryIndex = insertionIndex === -1 ? nextEvents.length : insertionIndex;
      nextEvents.splice(boundaryIndex, 0, boundary);
    }
    remainingUsers = alignSegmentOwnersBeforePrompt(
      projection.sessionId,
      remainingUsers,
      nextEvents,
      boundaryIndex,
      delivered.sentAt,
    );
    nextUsers.splice(0, nextUsers.length, ...remainingUsers, delivered);
  }
  return { events: nextEvents, userMessages: nextUsers, queuedMessages: nextQueued };
}

type ProjectedSidecarMessage = NonNullable<SpaceSessionLiveProjectionT['sidecarMessages']>[number];

function toProjectedSidecarEvent(
  projection: SpaceSessionLiveProjectionT,
  item: ProjectedSidecarMessage,
): Extract<SessionEvent, { kind: 'sidecar_message' }> {
  return {
    kind: 'sidecar_message',
    sessionId: projection.sessionId,
    ...(item.turnId !== undefined ? { turnId: item.turnId } : {}),
    sentAt: item.createdAt,
    runtimeEvent: {
      runtimeId: projection.cursor.runtimeId,
      runId: item.runId,
      ...(projection.cursor.journalEpoch !== undefined
        ? { journalEpoch: projection.cursor.journalEpoch }
        : {}),
      seq: item.seq,
    },
    message: item.message,
  };
}

function projectedSidecarMatches(
  event: SessionEvent,
  projected: Extract<SessionEvent, { kind: 'sidecar_message' }>,
): boolean {
  const origin = 'runtimeEvent' in event ? event.runtimeEvent : undefined;
  return (
    event.kind === 'sidecar_message' &&
    origin?.runtimeId === projected.runtimeEvent?.runtimeId &&
    origin?.runId === projected.runtimeEvent?.runId &&
    origin?.journalEpoch === projected.runtimeEvent?.journalEpoch &&
    origin?.seq === projected.runtimeEvent?.seq &&
    event.message.source === projected.message.source &&
    event.message.content === projected.message.content
  );
}

function projectedSidecarInsertionIndex(
  events: readonly SessionEvent[],
  projected: Extract<SessionEvent, { kind: 'sidecar_message' }>,
): number {
  return events.findIndex((event) => {
    const origin = 'runtimeEvent' in event ? event.runtimeEvent : undefined;
    return (
      origin?.runtimeId === projected.runtimeEvent?.runtimeId &&
      origin?.journalEpoch === projected.runtimeEvent?.journalEpoch &&
      origin !== undefined &&
      projected.runtimeEvent !== undefined &&
      origin.seq > projected.runtimeEvent.seq
    );
  });
}

function hydrateProjectedSidecarMessages(
  events: readonly SessionEvent[],
  projection: SpaceSessionLiveProjectionT,
): SessionEvent[] {
  const recoveryOwner = projection.activeRun ?? projection.lastTerminalRun;
  const sidecars = (projection.sidecarMessages ?? []).filter(
    (item) =>
      recoveryOwner !== undefined &&
      recoveryOwner.turnId !== undefined &&
      item.runId === recoveryOwner.runId &&
      item.turnId === recoveryOwner.turnId,
  );
  if (sidecars.length === 0) return events as SessionEvent[];
  const next = [...events];
  const matchedHistoryIndexes = new Set<number>();
  for (const item of sidecars) {
    const projected = toProjectedSidecarEvent(projection, item);
    if (next.some((event) => projectedSidecarMatches(event, projected))) continue;
    const historyIndex = next.findIndex(
      (event, index) =>
        !matchedHistoryIndexes.has(index) &&
        event.kind === 'sidecar_message' &&
        event.runtimeEvent === undefined &&
        event.message.source === item.message.source &&
        event.message.content === item.message.content &&
        (event.turnId === undefined || item.turnId === undefined || event.turnId === item.turnId),
    );
    if (historyIndex !== -1) {
      matchedHistoryIndexes.add(historyIndex);
      continue;
    }
    const laterIndex = projectedSidecarInsertionIndex(next, projected);
    if (laterIndex === -1) next.push(projected);
    else next.splice(laterIndex, 0, projected);
  }
  return next.length === events.length ? (events as SessionEvent[]) : next;
}

function promoteQueuedUserMessageForPrompt(
  state: AppState,
  sessionId: string,
  queueMode: QueuedUserMessage['queueMode'],
  matchContent: string,
  queueId?: string,
  identity?: StrongUserTurnIdentity,
  entryId?: string,
  ordinalSelfResolved?: boolean,
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
    operationId?: string,
  ): UserMessage => ({
    ...createUserMessage(
      sessionId,
      content,
      nextUserMessageSentAtAfter(userBucket),
      identity,
      attachments,
    ),
    ...(queueId !== undefined ? { deliveryQueueId: queueId, deliveryQueueMode: queueMode } : {}),
    ...(queueMode === 'interrupt' ? { deliveredInterrupt: true as const } : {}),
    ...(queueMode === 'after-turn' && queueId !== undefined ? { runtimeRunId: queueId } : {}),
    ...(sourceQueuedLocalId !== undefined ? { sourceQueuedLocalId } : {}),
    ...(operationId !== undefined ? { operationId } : {}),
    ...(entryId !== undefined ? { entryId } : {}),
  });

  if (idx === -1) {
    const normalized = normalizeQueuedMatchContent(matchContent);
    const alreadyRendered = entryId
      ? userBucket.some((message) => !message.restoredFromHistory && message.entryId === entryId)
      : identity !== undefined
        ? userBucket.some(
            (message) =>
              !message.restoredFromHistory &&
              message.turnId === identity.turnId &&
              message.turnUserOrdinal === identity.turnUserOrdinal,
          ) ||
          // A self-resolved ordinal (fail-open max+1) is a replay signal, not an owner
          // fact: it can never equal a canonical row's ordinal, and a live owner for the
          // same turn already carries the delivery (Issue 207 ghost bubble). An explicit
          // daemon ordinal is untouched — legal same-text interrupts keep minting fresh.
          (ordinalSelfResolved === true &&
            (userBucket.some(
              (message) =>
                !message.restoredFromHistory &&
                message.turnId === identity.turnId &&
                (message.content === matchContent || message.content === normalized),
            ) ||
              userBucket.some(
                (message) =>
                  message.restoredFromHistory === true &&
                  message.turnId === identity.turnId &&
                  (message.content === matchContent || message.content === normalized),
              )))
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
  const alreadyLiveByIdentity = entryId
    ? userBucket.some((message) => !message.restoredFromHistory && message.entryId === entryId)
    : identity !== undefined &&
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
        : [
            ...userBucket,
            createPromotedUserMessage(
              entry.content,
              entry.attachments,
              entry.id,
              entry.operationId,
            ),
          ],
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
  deletingSessionIds: new Set<string>(),
  removingSessionIds: new Set<string>(),
  currentSessionId: null,
  eventsBySession: {},
  errorSeenAtBySession: {},
  errorSeenRunIdBySession: {},
  errorSeenRunIdsBySession: readPersistedErrorSeenRunIds(),
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
  compactingBySession: {},
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
  pendingSendRuntimeBaselineBySession: {},
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
  setSessions: (sessions) =>
    set((state) => ({
      sessions: mergeRuntimeActivityIntoSessions(sessions, state.runtimeProfile),
    })),
  replaceSessionsForScope: (sessions, scope) =>
    set((state) => {
      const replaced = replaceSessionsInScope(state.sessions, sessions, scope, IS_WIN_RENDERER);
      return {
        sessions: mergeRuntimeActivityIntoSessions(replaced, state.runtimeProfile),
      };
    }),
  setCurrentSession: (sessionId) => {
    let seenBySessionToPersist: Readonly<Record<string, readonly string[]>> | null = null;
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
      // runtime 投影路径同理：记下当前 lastTerminalRun.runId，让已看过的红点熄灭。
      const seenRunId = state.liveProjectionBySession[sessionId]?.lastTerminalRun?.runId;
      const terminalRunIds = runtimeTerminalEvidenceCandidates(
        {
          connection: state.runtimeConnection,
          profile: state.runtimeProfile,
          liveBySession: state.liveProjectionBySession,
        },
        sessionId,
      ).map((terminal) => terminal.runId);
      if (seenRunId !== undefined) terminalRunIds.push(seenRunId);
      for (const event of state.eventsBySession[sessionId] ?? []) {
        if (event.kind === 'session_error' && event.runtimeEvent?.runId !== undefined) {
          terminalRunIds.push(event.runtimeEvent.runId);
        }
      }
      const seenRunIds = [...(state.errorSeenRunIdsBySession[sessionId] ?? []), ...terminalRunIds]
        .filter((runId, index, all) => all.indexOf(runId) === index)
        .slice(-16);
      const errorSeenRunIdsBySession =
        seenRunIds.length > 0
          ? { ...state.errorSeenRunIdsBySession, [sessionId]: seenRunIds }
          : state.errorSeenRunIdsBySession;
      seenBySessionToPersist = errorSeenRunIdsBySession;
      const patch = {
        ...(readFlags === state.sessionFlags ? {} : { sessionFlags: readFlags }),
        errorSeenAtBySession: {
          ...state.errorSeenAtBySession,
          [sessionId]: state.eventsBySession[sessionId]?.length ?? 0,
        },
        ...(seenRunId
          ? {
              errorSeenRunIdBySession: {
                ...state.errorSeenRunIdBySession,
                [sessionId]: seenRunId,
              },
            }
          : {}),
        ...(seenRunIds.length > 0
          ? {
              errorSeenRunIdsBySession,
            }
          : {}),
      };
      if (!found || !found.projectRoot) return { currentSessionId: sessionId, ...patch };
      const targetCanon = canonProjectRootShared(found.projectRoot, IS_WIN_RENDERER);
      const currentCanon = state.currentProjectPath
        ? canonProjectRootShared(state.currentProjectPath, IS_WIN_RENDERER)
        : null;
      if (targetCanon === currentCanon) return { currentSessionId: sessionId, ...patch };
      // Opening another project's Session switches the whole working context
      // (terminal, changes, sends). Persist it so reload/boot restores the
      // project the user actually ended up in.
      lsSet(LS_KEY_PROJECT, found.projectRoot);
      return {
        currentSessionId: sessionId,
        currentProjectPath: found.projectRoot,
        ...patch,
      };
    });
    if (seenBySessionToPersist !== null) persistErrorSeenRunIds(seenBySessionToPersist);
  },

  appendUserMessage: (sessionId, content, sentAt, attachments, operationId) => {
    let messageId: string | null = null;
    set((state) => {
      if (!state.sessions.some((s) => s.sessionId === sessionId)) return state;
      const bucket = state.userMessagesBySession[sessionId] ?? [];
      const msg = createUserMessage(
        sessionId,
        content,
        appendedUserMessageSentAt(bucket, sentAt),
        undefined,
        attachments,
        operationId,
      );
      messageId = msg.id;
      rememberHistoryLiveUsers(sessionId, [msg]);
      return {
        sessions: state.sessions.map((session) =>
          session.sessionId === sessionId && msg.sentAt > session.lastActivityAt
            ? { ...session, lastActivityAt: msg.sentAt }
            : session,
        ),
        userMessagesBySession: {
          ...state.userMessagesBySession,
          [sessionId]: [...bucket, msg],
        },
      };
    });
    return messageId;
  },

  reserveSendOperationMessage: (sessionId, input) => {
    let owner: LocalSendOperationMessage | null = null;
    set((state) => {
      if (!state.sessions.some((session) => session.sessionId === sessionId)) return state;
      const users = state.userMessagesBySession[sessionId] ?? [];
      const queued = state.queuedUserMessagesBySession[sessionId] ?? [];
      const existing = existingSendOperationOwner(
        resolveSendOperationMessages(users, queued, input.operationId),
        input.requestGeneration,
      );
      if (existing !== undefined) {
        owner = existing.owner;
        const patch = existingSendOperationPatch(state, sessionId, existing);
        return Object.keys(patch).length === 0 ? state : patch;
      }

      if (input.queued) {
        const message = createReservedQueuedMessage(sessionId, input);
        owner = { kind: 'queued', id: message.id };
        return {
          queuedUserMessagesBySession: {
            ...state.queuedUserMessagesBySession,
            [sessionId]: [...queued, message],
          },
        };
      }

      const message = createReservedUserMessage(sessionId, input, users);
      owner = { kind: 'user', id: message.id };
      rememberHistoryLiveUsers(sessionId, [message]);
      return {
        sessions: state.sessions.map((session) =>
          session.sessionId === sessionId && message.sentAt > session.lastActivityAt
            ? { ...session, lastActivityAt: message.sentAt }
            : session,
        ),
        userMessagesBySession: {
          ...state.userMessagesBySession,
          [sessionId]: [...users, message],
        },
      };
    });
    return owner;
  },

  rollbackSendOperationMessage: (
    sessionId,
    operationId,
    expectedGeneration,
    failureDisposition,
  ) => {
    let result: SendOperationRollbackResult = 'stale';
    set((state) => {
      if (expectedGeneration === undefined) return state;
      const users = state.userMessagesBySession[sessionId] ?? [];
      const queued = state.queuedUserMessagesBySession[sessionId] ?? [];
      const messages = resolveSendOperationMessages(users, queued, operationId);
      const settled = messages.settledUser ?? messages.settledQueued;
      const pendingPatch = pendingSendCleanupPatch(state, sessionId, expectedGeneration);
      if (settled !== undefined) {
        result = 'settled';
        return settledSendOperationPatch(state, sessionId, operationId, messages, pendingPatch);
      }

      const provisional = messages.provisionalUser ?? messages.provisionalQueued;
      if (provisional === undefined) {
        result = failureDisposition === 'ambiguous' ? 'retained' : 'rolled-back';
        return Object.keys(pendingPatch).length === 0 ? state : pendingPatch;
      }
      if (provisional.operationReservation?.requestGeneration !== expectedGeneration) return state;
      if (failureDisposition === 'ambiguous') {
        result = 'retained';
        return Object.keys(pendingPatch).length === 0 ? state : pendingPatch;
      }

      const removesUser = messages.provisionalUser?.id === provisional.id;
      result = 'rolled-back';
      return removeProvisionalSendOperationPatch(
        state,
        sessionId,
        provisional,
        removesUser,
        pendingPatch,
      );
    });
    return result;
  },

  settleSendOperationMessage: (sessionId, operationId) =>
    set((state) => {
      let changed = false;
      const userBucket = state.userMessagesBySession[sessionId] ?? [];
      const nextUsers = userBucket.map((message) => {
        if (message.operationId !== operationId || message.sendAdmissionSettled === true) {
          return message;
        }
        changed = true;
        return { ...message, sendAdmissionSettled: true as const };
      });
      const queuedBucket = state.queuedUserMessagesBySession[sessionId] ?? [];
      const nextQueued = queuedBucket.map((message) => {
        if (message.operationId !== operationId || message.sendAdmissionSettled === true) {
          return message;
        }
        changed = true;
        return { ...message, sendAdmissionSettled: true as const };
      });
      if (!changed) return state;
      const updatedUsers = nextUsers.filter((message) => message.operationId === operationId);
      if (updatedUsers.length > 0) rememberHistoryLiveUsers(sessionId, updatedUsers);
      return {
        userMessagesBySession: { ...state.userMessagesBySession, [sessionId]: nextUsers },
        queuedUserMessagesBySession: {
          ...state.queuedUserMessagesBySession,
          [sessionId]: nextQueued,
        },
      };
    }),

  acknowledgePendingSendRun: (sessionId, runId, expectedGeneration) =>
    set((state) => {
      if (!state.pendingSendBySession[sessionId]) return state;
      const currentBaseline = state.pendingSendRuntimeBaselineBySession[sessionId] ?? {
        requestGeneration: 0,
        liveCursorSeq: -1,
        profileCursorSeq: -1,
      };
      if (
        (expectedGeneration !== undefined &&
          currentBaseline.requestGeneration !== expectedGeneration) ||
        (currentBaseline.acceptedRunId !== undefined && currentBaseline.acceptedRunId !== runId)
      ) {
        return state;
      }
      const currentAuthority = pendingSendRuntimeBaseline(
        state,
        sessionId,
        currentBaseline.requestGeneration,
      );
      const acknowledgedBaseline = {
        ...currentBaseline,
        ...(currentBaseline.runtimeId === undefined && currentAuthority.runtimeId !== undefined
          ? { runtimeId: currentAuthority.runtimeId }
          : {}),
        acceptedRunId: runId,
      };
      if (acknowledgedPendingSendAlreadyObserved(state, sessionId, acknowledgedBaseline)) {
        const { [sessionId]: _dropPending, ...restPending } = state.pendingSendBySession;
        const { [sessionId]: _dropBaseline, ...restBaselines } =
          state.pendingSendRuntimeBaselineBySession;
        return {
          pendingSendBySession: restPending,
          pendingSendRuntimeBaselineBySession: restBaselines,
        };
      }
      return {
        pendingSendRuntimeBaselineBySession: {
          ...state.pendingSendRuntimeBaselineBySession,
          [sessionId]: acknowledgedBaseline,
        },
      };
    }),

  bindUserMessageRuntimeRun: (sessionId, messageId, runId) =>
    set((state) => {
      const users = state.userMessagesBySession[sessionId];
      if (!users) return state;
      const targetIndex = users.findIndex((message) => message.id === messageId);
      const target = users[targetIndex];
      if (
        !target ||
        target.restoredFromHistory ||
        target.hiddenHistoryAnchor ||
        (target.runtimeRunId !== undefined && target.runtimeRunId !== runId)
      ) {
        return state;
      }
      const events = state.eventsBySession[sessionId] ?? [];
      let turnId: string | undefined;
      for (const event of events) {
        if (
          'turnId' in event &&
          typeof event.turnId === 'string' &&
          'runtimeEvent' in event &&
          event.runtimeEvent?.runId === runId
        ) {
          turnId = event.turnId;
          break;
        }
      }
      if (turnId !== undefined && target.turnId !== undefined && target.turnId !== turnId) {
        return state;
      }
      const boundUsers = users.slice();
      boundUsers[targetIndex] = {
        ...target,
        runtimeRunId: runId,
        ...(turnId !== undefined ? { turnId, turnUserOrdinal: 0 } : {}),
      };
      rememberHistoryLiveUsers(sessionId, boundUsers);
      const folded = foldStrongIdentityDuplicateTurns(boundUsers, events);
      rememberCanonicalizedHistoryLiveOwners(sessionId, folded.canonicalizedLiveOwners ?? []);
      const reconciledUsers = hideOpenStrongIdentityDuplicateProjection(
        folded.userMessages,
        folded.events,
      );
      return {
        userMessagesBySession: {
          ...state.userMessagesBySession,
          [sessionId]: reconciledUsers,
        },
        ...(folded.events !== events
          ? {
              eventsBySession: {
                ...state.eventsBySession,
                [sessionId]: folded.events,
              },
              transientArtifactsBySession: {
                ...state.transientArtifactsBySession,
                [sessionId]: collectTransientArtifactsFromEvents(folded.events),
              },
            }
          : {}),
      };
    }),

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
      rememberHistoryLiveUsers(sessionId, [nextBucket[messageIndex]!]);
      return {
        userMessagesBySession: {
          ...state.userMessagesBySession,
          [sessionId]: nextBucket,
        },
      };
    }),

  updateSendOperationAttachments: (sessionId, operationId, attachments) =>
    set((state) => {
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
      const userBucket = state.userMessagesBySession[sessionId] ?? [];
      const nextUserBucket = userBucket.map((message) => {
        if (message.operationId !== operationId) return message;
        changed = true;
        return { ...message, attachments: mergeAttachments(message.attachments) };
      });
      const queuedBucket = state.queuedUserMessagesBySession[sessionId] ?? [];
      const nextQueuedBucket = queuedBucket.map((message) => {
        if (message.operationId !== operationId) return message;
        changed = true;
        return { ...message, attachments: mergeAttachments(message.attachments) };
      });
      if (!changed) return state;
      const updatedUsers = nextUserBucket.filter((message) => message.operationId === operationId);
      if (updatedUsers.length > 0) rememberHistoryLiveUsers(sessionId, updatedUsers);
      return {
        userMessagesBySession: {
          ...state.userMessagesBySession,
          [sessionId]: nextUserBucket,
        },
        queuedUserMessagesBySession: {
          ...state.queuedUserMessagesBySession,
          [sessionId]: nextQueuedBucket,
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
          [sessionId]: mergeLocalNotices([bucket, [msg]], msg.id),
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
        ...(input.operationId !== undefined ? { operationId: input.operationId } : {}),
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
      const resolution = resolveAcceptedQueuedMessage(bucket, localId, queueId, queueMode);
      if (!resolution) return state;
      const formalIndex =
        queueId === undefined
          ? -1
          : (state.userMessagesBySession[sessionId] ?? []).findIndex(
              (message) =>
                message.deliveryQueueId === queueId &&
                message.deliveryQueueMode === resolution.acceptedMode,
            );
      if (formalIndex !== -1) {
        const userBucket = state.userMessagesBySession[sessionId] ?? [];
        const formal = userBucket[formalIndex]!;
        const nextUsers = userBucket.slice();
        nextUsers[formalIndex] = {
          ...formal,
          content: resolution.target.content,
          ...(resolution.target.attachments !== undefined
            ? { attachments: resolution.target.attachments }
            : {}),
          sourceQueuedLocalId: localId,
          ...(resolution.target.operationId !== undefined
            ? { operationId: resolution.target.operationId }
            : {}),
        };
        return {
          queuedUserMessagesBySession: {
            ...state.queuedUserMessagesBySession,
            [sessionId]: resolution.remaining,
          },
          userMessagesBySession: {
            ...state.userMessagesBySession,
            [sessionId]: nextUsers,
          },
        };
      }
      resolution.remaining.splice(resolution.insertionIndex, 0, resolution.accepted);
      return {
        queuedUserMessagesBySession: {
          ...state.queuedUserMessagesBySession,
          [sessionId]: resolution.remaining,
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

  promoteQueuedUserMessage: (sessionId, localId, sentAt) => {
    let promotedMessageId: string | null = null;
    set((state) => {
      const bucket = state.queuedUserMessagesBySession[sessionId];
      if (!bucket) return state;
      const idx = bucket.findIndex((entry) => entry.id === localId);
      if (idx === -1) return state;
      const entry = bucket[idx]!;
      const userBucket = state.userMessagesBySession[sessionId] ?? [];
      const promotedMessage = {
        ...createUserMessage(
          sessionId,
          entry.content,
          sentAt,
          undefined,
          entry.attachments,
          entry.operationId,
        ),
        sourceQueuedLocalId: localId,
      };
      promotedMessageId = promotedMessage.id;
      rememberHistoryLiveUsers(sessionId, [promotedMessage]);
      return {
        queuedUserMessagesBySession: {
          ...state.queuedUserMessagesBySession,
          [sessionId]: [...bucket.slice(0, idx), ...bucket.slice(idx + 1)],
        },
        userMessagesBySession: {
          ...state.userMessagesBySession,
          [sessionId]: [...userBucket, promotedMessage],
        },
      };
    });
    return promotedMessageId;
  },

  convertUserMessageToQueued: (sessionId, messageId, input) => {
    let localId: string | null = null;
    set((state) => {
      if (!state.sessions.some((s) => s.sessionId === sessionId)) return state;
      const userBucket = state.userMessagesBySession[sessionId];
      if (!userBucket || userBucket.length === 0) return state;
      const messageIndex = userBucket.findIndex((message) => message.id === messageId);
      if (messageIndex === -1) return state;
      const message = userBucket[messageIndex];
      if (!message) return state;
      // The acknowledgement belongs to the original provisional phase. Runtime delivery or
      // canonical reconciliation may have settled that same owner while IPC was in flight; a
      // late/cached queued result must never move the admitted user turn back into the queue.
      if (userMessageHasSettledSendAdmission(message)) return state;

      forgetHistoryLiveUsers(sessionId, [message.id]);
      localId = `qu_${sessionId}_${++queuedUserMessageCounter}`;
      const queuedBucket = state.queuedUserMessagesBySession[sessionId] ?? [];
      const queued: QueuedUserMessage = {
        id: localId,
        content: input.content,
        matchContent: input.matchContent ?? input.content,
        ...(message.attachments !== undefined ? { attachments: message.attachments } : {}),
        ...(message.operationId !== undefined ? { operationId: message.operationId } : {}),
        queueMode: input.queueMode,
        status: 'queued',
        sentAt: input.sentAt ?? message.sentAt,
      };
      return {
        userMessagesBySession: {
          ...state.userMessagesBySession,
          [sessionId]: [
            ...userBucket.slice(0, messageIndex),
            ...userBucket.slice(messageIndex + 1),
          ],
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

  rollbackUserMessage: (sessionId, messageId) =>
    set((state) => {
      const bucket = state.userMessagesBySession[sessionId];
      if (!bucket || bucket.length === 0) return state;
      const messageIndex = bucket.findIndex((message) => message.id === messageId);
      if (messageIndex === -1) return state;
      forgetHistoryLiveUsers(sessionId, [messageId]);
      return {
        userMessagesBySession: {
          ...state.userMessagesBySession,
          [sessionId]: [...bucket.slice(0, messageIndex), ...bucket.slice(messageIndex + 1)],
        },
      };
    }),

  prependSessionHistory: (sessionId, items, fallbackSentAt, options) =>
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
      const leadingPartialTurnId = authoritativeLeadingHistoryTurnId(items);
      const historyAnchorTurnId = leadingPartialTurnId ?? stableHistoryAnchorTurnId(items);
      const historyPrefixAnchorTurnId = `space-history-prefix:${stableHistoryHash(items)}`;
      // Only an explicitly ambiguous projection may carry proven clone candidates (same logicalId
      // re-created and archived — verified on disk, session 20260816_132905_g1806cde81c389).
      // Resolved pages never dedupe: distinct legitimate rows can share a logicalId family.
      const seenAmbiguousLogicalIds =
        options?.conversationStatus === 'ambiguous' ? new Set<string>() : null;
      // Issue 186 review hardening: among ambiguous candidates sharing a logicalId,
      // prefer the smallest canonicalIndex when both candidates carry one; mixed or
      // index-less duplicates keep the first-seen copy (keep-first fallback).
      const skipAmbiguousItemIndex = new Set<number>();
      if (seenAmbiguousLogicalIds !== null) {
        const bestByLogicalId = new Map<string, { index: number; canonicalIndex: number }>();
        items.forEach((item, index) => {
          if (!('logicalId' in item) || typeof item.logicalId !== 'string') return;
          if (!('canonicalIndex' in item) || typeof item.canonicalIndex !== 'number') return;
          const best = bestByLogicalId.get(item.logicalId);
          if (best === undefined) {
            bestByLogicalId.set(item.logicalId, { index, canonicalIndex: item.canonicalIndex });
            return;
          }
          if (item.canonicalIndex < best.canonicalIndex) {
            skipAmbiguousItemIndex.add(best.index);
            bestByLogicalId.set(item.logicalId, { index, canonicalIndex: item.canonicalIndex });
          } else {
            skipAmbiguousItemIndex.add(index);
          }
        });
      }
      let firstCanonicalHistoricalSentAt: number | undefined;
      for (const item of items) {
        if (item.kind === 'local_notice') continue;
        if (!('sentAt' in item) || !Number.isFinite(item.sentAt)) continue;
        firstCanonicalHistoricalSentAt = item.sentAt;
        break;
      }
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
      let leadingHistoryPrefixPending = false;
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
        let needsAnchor = histMsgs.length === 0;
        if (leadingHistoryPrefixPending) {
          flushTurnIfNeeded();
          leadingHistoryPrefixPending = false;
          needsAnchor = true;
        }
        if (needsAnchor) {
          const id = `u_${sessionId}_history_anchor_${stableHistoryHash(historyAnchorTurnId)}`;
          histMsgs.push({
            id,
            content: '',
            // The Session list's fallback can describe this Runtime attachment rather than the
            // bounded page's first record. Prefer canonical item time so a leading hidden anchor
            // cannot push every restored user beyond a concurrently submitted live query.
            sentAt: nextHistoricalUserSentAt(firstCanonicalHistoricalSentAt ?? fallbackSentAt),
            restoredFromHistory: true,
            hiddenHistoryAnchor: true,
            turnId: historyAnchorTurnId,
            ...(leadingPartialTurnId !== undefined
              ? { leadingPartialHistory: true as const }
              : { turnUserOrdinal: 0 }),
          });
          openUserWithoutAssistant = true;
        }
      };
      const ensureLeadingHistoryPrefixAnchor = (): void => {
        if (histMsgs.length > 0) return;
        const sentAt = Number.MIN_SAFE_INTEGER;
        lastHistoricalUserSentAt = sentAt;
        histMsgs.push({
          id: `u_${sessionId}_history_anchor_${stableHistoryHash(historyPrefixAnchorTurnId)}`,
          content: '',
          // A history-scope truncation describes records before every retained row, including an
          // omitted live query recovered below. Keep its invisible owner first regardless of the
          // first retained assistant timestamp.
          sentAt,
          restoredFromHistory: true,
          hiddenHistoryAnchor: true,
          turnId: historyPrefixAnchorTurnId,
          turnUserOrdinal: 0,
        });
        openUserWithoutAssistant = true;
      };
      for (const [itemIndex, item] of items.entries()) {
        const historyOrigin = transcriptHistoryOrigin(item);
        const itemLogicalId =
          'logicalId' in item && typeof item.logicalId === 'string' ? item.logicalId : undefined;
        if (seenAmbiguousLogicalIds !== null) {
          // The daemon's ambiguous projection serves both the re-created and the archived copy of
          // a compaction-retained suffix. logicalId is the documented stable clone identity
          // (space-ipc-schema session.ts); drop proven duplicates instead of rendering the same
          // logical entry twice. When both candidates carry canonicalIndex the pre-scan above
          // already picked the smaller one; remaining duplicates keep the first-seen copy.
          if (skipAmbiguousItemIndex.has(itemIndex)) continue;
          if (itemLogicalId !== undefined) {
            if (seenAmbiguousLogicalIds.has(itemLogicalId)) continue;
            seenAmbiguousLogicalIds.add(itemLogicalId);
          }
        }
        if (item.kind === 'user') {
          if (assistantPendingComplete) flushTurnIfNeeded();
          else flushEmptyTurnIfNeeded();
          leadingHistoryPrefixPending = false;
          const id = stableHistoryUserMessageId(sessionId, item, histMsgs.length);
          // History pairing is transcript-order based, while composeMessages still sorts by
          // sentAt. SDK compaction/re-root and tool-result restores can collapse or backdate
          // historical timestamps, so normalize only restored user turns to keep sort order
          // equal to transcript order.
          histMsgs.push({
            id,
            content: item.content,
            sentAt: nextHistoricalUserSentAt(item.sentAt),
            restoredFromHistory: true,
            ...historyOrigin,
            ...(item.attachments !== undefined ? { attachments: item.attachments } : {}),
            ...(item.turnId !== undefined ? { turnId: item.turnId } : {}),
            ...(item.turnUserOrdinal !== undefined
              ? { turnUserOrdinal: item.turnUserOrdinal }
              : {}),
            ...(item.turnId !== undefined && item.turnUserOrdinal === undefined
              ? { omittedHistoryUserOrdinal: true as const }
              : {}),
            ...(item.historyTurnIndex !== undefined
              ? { historyTurnIndex: item.historyTurnIndex }
              : {}),
            ...(item.historyBoundary !== undefined
              ? { historyBoundary: item.historyBoundary }
              : {}),
          });
          openUserWithoutAssistant = true;
        } else if (item.kind === 'assistant') {
          ensureLeadingHistoryAnchor();
          const assistantSentAt =
            item.sentAt ?? histMsgs[histMsgs.length - 1]?.sentAt ?? fallbackSentAt;
          if (item.thinking !== undefined && item.thinking.length > 0) {
            histEvents.push({
              ...historyOrigin,
              kind: 'thinking_delta',
              sessionId,
              text: item.thinking,
              sentAt: assistantSentAt,
            });
          }
          if (item.text.length > 0) {
            histEvents.push({
              ...historyOrigin,
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
            ...historyOrigin,
            kind: 'sidecar_message',
            sessionId,
            message: item.message,
          });
          markTurnHasEvents();
        } else if (item.kind === 'lineage_notice') {
          ensureLeadingHistoryAnchor();
          histEvents.push({
            ...historyOrigin,
            kind: 'lineage_notice',
            sessionId,
            noticeKind: item.noticeKind,
            text: item.text,
            ...(item.entryId !== undefined ? { displayId: item.entryId } : {}),
            ...(item.sentAt !== undefined ? { sentAt: item.sentAt } : {}),
            ...(item.tokensBefore !== undefined ? { tokensBefore: item.tokensBefore } : {}),
            ...(item.tokensAfter !== undefined ? { tokensAfter: item.tokensAfter } : {}),
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
          ensureLeadingHistoryAnchor();
          histEvents.push({
            ...historyOrigin,
            kind: 'workflow_notice',
            sessionId,
            text: item.text,
          });
          markTurnHasEvents();
        } else if (item.kind === 'history_truncation') {
          const isLeadingHistoryPrefix = item.scope === 'history' && histMsgs.length === 0;
          if (isLeadingHistoryPrefix) ensureLeadingHistoryPrefixAnchor();
          else ensureLeadingHistoryAnchor();
          histEvents.push({
            kind: 'history_truncation',
            sessionId,
            scope: item.scope,
            omittedItems: item.omittedItems,
          });
          markTurnHasEvents();
          if (isLeadingHistoryPrefix) leadingHistoryPrefixPending = true;
        } else if (item.kind === 'local_notice') {
          lastLocalTranscriptSentAt = Math.max(lastLocalTranscriptSentAt, item.sentAt);
          histLocalNotices.push({
            id: item.id,
            content: item.content,
            sentAt: item.sentAt,
            ...(item.variant !== undefined ? { variant: item.variant } : {}),
          });
        } else {
          // A bounded page can begin after a history_truncation in the middle of a turn. Keep
          // the prefix notice on its own invisible owner and attach the leading tool segment to
          // the authoritative partial-turn anchor so live/canonical folding cannot strand a
          // duplicate tool above the query that owns it.
          ensureLeadingHistoryAnchor();
          histEvents.push({
            ...historyOrigin,
            kind: 'tool_start',
            sessionId,
            toolId: item.toolId,
            toolName: item.toolName,
            ...(item.input ? { input: item.input } : {}),
          });
          if (item.result !== undefined) {
            histEvents.push({
              ...historyOrigin,
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
      for (const event of histEvents) restoredHistoryEvents.add(event);
      const replaceLoadedWindow = options?.replaceLoadedWindow === true;
      const prefixOmitted = items.some(
        (item) => item.kind === 'history_truncation' && item.scope === 'history',
      );
      let liveBaseline = replaceLoadedWindow ? historyLiveBaselines.get(sessionId) : undefined;
      if (replaceLoadedWindow && liveBaseline === undefined) {
        liveBaseline = {
          userMessages: (state.userMessagesBySession[sessionId] ?? []).filter(
            (message) => message.restoredFromHistory !== true,
          ),
          events: (state.eventsBySession[sessionId] ?? []).filter(
            (event) => !restoredHistoryEvents.has(event),
          ),
          durableCanonicalizedUserIds: new Set(),
          canonicalIndexByUserId: new Map(),
        };
        rememberHistoryLiveBaseline(sessionId, liveBaseline);
      }
      const includeLiveProjection = options?.includeLiveProjection !== false;
      if (includeLiveProjection && liveBaseline !== undefined) {
        const sourceRevision = options?.sourceRevision;
        if (liveBaseline.canonicalSourceRevision !== sourceRevision) {
          liveBaseline.canonicalIndexByUserId.clear();
          liveBaseline.canonicalSourceRevision = sourceRevision;
        }
        const firstRetainedCanonicalIndex = histMsgs.reduce<number | undefined>(
          (first, message) =>
            message.canonicalIndex === undefined
              ? first
              : Math.min(first ?? message.canonicalIndex, message.canonicalIndex),
          undefined,
        );
        pruneCanonicalizedHistoryLivePrefix(
          liveBaseline,
          firstRetainedCanonicalIndex,
          prefixOmitted && sourceRevision !== undefined,
        );
        pruneDurablyCanonicalizedHistoryLivePrefix(
          liveBaseline,
          histMsgs,
          histEvents,
          prefixOmitted,
          options?.authoritativeNewest === true,
        );
      }
      const currentMsgs = includeLiveProjection
        ? (liveBaseline?.userMessages ?? state.userMessagesBySession[sessionId] ?? [])
        : [];
      const currentEvents = includeLiveProjection
        ? (liveBaseline?.events ?? state.eventsBySession[sessionId] ?? [])
        : [];
      const currentLocalNotices = state.localNoticesBySession[sessionId] ?? [];
      const retainedHistory = replaceLoadedWindow
        ? retainLoadedHistoryPrefix(
            state.userMessagesBySession[sessionId] ?? [],
            state.eventsBySession[sessionId] ?? [],
            histMsgs,
            histEvents,
          )
        : { userMessages: histMsgs, events: histEvents };
      let historyAndLiveEvents: readonly SessionEvent[] = [
        ...retainedHistory.events,
        ...currentEvents,
      ];
      let combinedHeadMsgs: readonly UserMessage[] = [
        ...retainedHistory.userMessages,
        ...currentMsgs,
      ];
      // An ambiguous projection's proven clone candidates flow through the logicalId dedupe
      // below; relocating them here is untested against that path, so keep today's order.
      if (options?.conversationStatus !== 'ambiguous') {
        const stabilizedHead = stabilizeCanonicalPageHeadBeforeEarlierLiveTurns(
          combinedHeadMsgs,
          historyAndLiveEvents,
        );
        combinedHeadMsgs = stabilizedHead.userMessages;
        historyAndLiveEvents = stabilizedHead.events;
      }
      const ownerOpenedMsgs = reconcileSnapshotInitialTurnOwners(
        sessionId,
        combinedHeadMsgs,
        historyAndLiveEvents,
        includeLiveProjection ? state.liveProjectionBySession[sessionId] : undefined,
      );
      const settledRuntimeRuns = options?.settledRuntimeRuns ?? [];
      const certifiedCanonicalAuthority =
        replaceLoadedWindow &&
        options?.authoritativeNewest === true &&
        options.conversationStatus === 'resolved' &&
        options.sourceRevision !== undefined &&
        settledRuntimeRuns.length > 0
          ? {
              sourceRevision: options.sourceRevision,
              canonicalMessageIds: new Set(
                histMsgs
                  .filter((message) => message.canonicalIndex !== undefined)
                  .map((message) => message.id),
              ),
              settledRuntimeRuns,
            }
          : undefined;
      const folded = foldStrongIdentityDuplicateTurns(
        ownerOpenedMsgs,
        historyAndLiveEvents,
        certifiedCanonicalAuthority,
      );
      rememberCanonicalizedHistoryLiveOwners(sessionId, folded.canonicalizedLiveOwners ?? []);
      const combinedEvents = dedupePersistedCompactionBoundaries(folded.events);
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
          [sessionId]: mergeLocalNotices([histLocalNotices, currentLocalNotices]),
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

  evictRestoredSessionHistory: (sessionId) => {
    const liveBaseline = historyLiveBaselines.get(sessionId);
    if (liveBaseline !== undefined) {
      // A closed live owner that already folded into canonical history is only a cache shadow.
      // Restoring it while dropping its durable proof would let it reappear at the tail later.
      pruneHistoryLiveOwners(liveBaseline, new Set(liveBaseline.durableCanonicalizedUserIds));
    }
    set((state) => {
      const currentUsers = state.userMessagesBySession[sessionId];
      const currentEvents = state.eventsBySession[sessionId];
      if (currentUsers === undefined && currentEvents === undefined && liveBaseline === undefined) {
        return state;
      }
      const liveUsers = (
        liveBaseline?.userMessages ??
        (currentUsers ?? []).filter((message) => message.restoredFromHistory !== true)
      ).map(liveBaselineUser);
      const liveEvents =
        liveBaseline?.events ??
        (currentEvents ?? []).filter((event) => !restoredHistoryEvents.has(event));
      return {
        userMessagesBySession: {
          ...state.userMessagesBySession,
          [sessionId]: liveUsers,
        },
        eventsBySession: {
          ...state.eventsBySession,
          [sessionId]: liveEvents,
        },
        transientArtifactsBySession: {
          ...state.transientArtifactsBySession,
          [sessionId]: collectTransientArtifactsFromEvents(liveEvents),
        },
      };
    });
    clearHistoryLiveBaseline(sessionId);
  },

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
      const liveBaselineEvents = historyLiveBaselines.get(event.sessionId)?.events;
      if (
        runtimeJournalEventWasApplied(bucket, event) ||
        (liveBaselineEvents !== undefined &&
          liveBaselineEvents !== bucket &&
          runtimeJournalEventWasApplied(liveBaselineEvents, event))
      ) {
        return state;
      }
      if (snapshotCoversRuntimeDraftEvent(state, event)) return state;
      if (isCompactionNotice(event)) {
        const provisionalIndex =
          event.provisionalId === undefined
            ? -1
            : bucket.findIndex(
                (existing) =>
                  isCompactionNotice(existing) && existing.provisionalId === event.provisionalId,
              );
        const exactIndex =
          event.entryId === undefined
            ? -1
            : bucket.findIndex(
                (existing) => isCompactionNotice(existing) && existing.entryId === event.entryId,
              );
        if (provisionalIndex >= 0) {
          const existing = bucket[provisionalIndex]!;
          if (!isCompactionNotice(existing) || event.entryId === undefined) return state;
          if (existing.entryId === undefined) {
            const storedEvent = stampLiveStreamEvent(event);
            if (exactIndex >= 0 && exactIndex !== provisionalIndex) {
              // History restored the durable row before this provisional resolved. Now that the
              // Runtime supplies the same physical entryId, retain the canonical history slot and
              // its already-rendered identity, then remove only the proven placeholder.
              const canonical = bucket[exactIndex]!;
              const reconciledEvent = isCompactionNotice(canonical)
                ? {
                    ...canonical,
                    ...storedEvent,
                    displayId:
                      canonical.displayId ??
                      canonical.entryId ??
                      event.displayId ??
                      event.provisionalId ??
                      event.entryId,
                  }
                : storedEvent;
              const reconciled = bucket.flatMap((candidate, index) => {
                if (index === provisionalIndex) return [];
                return [index === exactIndex ? reconciledEvent : candidate];
              });
              return {
                eventsBySession: {
                  ...state.eventsBySession,
                  [event.sessionId]: reconciled,
                },
                lastEvent: reconciledEvent,
              };
            }
            // Durable provenance arrived after the immediate placeholder. Upgrade the exact same
            // array slot so later text/tool/end events can never be overtaken or reparented.
            const upgraded = bucket.slice();
            upgraded[provisionalIndex] = storedEvent;
            return {
              eventsBySession: {
                ...state.eventsBySession,
                [event.sessionId]: upgraded,
              },
              lastEvent: storedEvent,
            };
          }
          // Conflicting exact rows for one provisional identity are corrupt/ambiguous. Fall
          // through and preserve the new fact instead of deleting or overwriting either row.
        }
        if (exactIndex >= 0) {
          // Physical entry identity is authoritative. This check deliberately happens after
          // provisional reconciliation so history-first delivery can retire its proven live
          // placeholder instead of leaving a duplicate behind.
          return state;
        }
      }
      // A failure may happen before Runtime admission, so there is no authoritative session_start
      // and no Runtime turnId to bind the optimistic root query. Give only that live failure a
      // renderer-local owner identity. Without it, a restored session_complete immediately before
      // the failure looks like a legacy duplicate-terminal chain and every later response shifts
      // one user bubble to the left.
      const latestLocalTerminalTurnId =
        (event.kind === 'session_error' || event.kind === 'session_complete') &&
        event.turnId === undefined
          ? localTerminalTurnIdForLatestLiveUser(currentUsers)
          : undefined;
      const previousEvent = bucket.at(-1);
      const localTerminalTurnId =
        event.kind === 'session_error'
          ? latestLocalTerminalTurnId
          : event.kind === 'session_complete' &&
              previousEvent?.kind === 'session_error' &&
              previousEvent.turnId !== undefined &&
              previousEvent.turnId === latestLocalTerminalTurnId
            ? latestLocalTerminalTurnId
            : undefined;
      const eventWithLocalOwner =
        localTerminalTurnId === undefined ? event : { ...event, turnId: localTerminalTurnId };
      const storedEvent = stampLiveStreamEvent(eventWithLocalOwner);
      if (isCancelledSessionError(event)) {
        // Deduplicate the optimistic BottomBar cancellation and the later main-process receipt.
        // Renderer-local owners make consecutive pre-admission cancellations distinguishable even
        // when neither has a session_start. Fall back to positional dedupe only when both legacy
        // events genuinely lack identity, and never cross a session_start boundary.
        const storedTerminalTurnId = 'turnId' in storedEvent ? storedEvent.turnId : undefined;
        for (let i = bucket.length - 1; i >= 0; i--) {
          const previous = bucket[i];
          if (!previous) continue;
          if (previous.kind === 'session_start') break;
          if (previous.kind === 'session_error' && isCancelledSessionError(previous)) {
            if (storedTerminalTurnId !== undefined || previous.turnId !== undefined) {
              if (storedTerminalTurnId !== undefined && storedTerminalTurnId === previous.turnId) {
                return state;
              }
              continue;
            }
            return state;
          }
        }
      }
      rememberHistoryLiveEvent(
        event.sessionId,
        storedEvent,
        state.runtimeSnapshotCursorBySession[event.sessionId],
      );
      const appendedEvents = appendSessionEvent(
        bucket,
        storedEvent,
        state.runtimeSnapshotCursorBySession[event.sessionId],
      );
      const lifecycleTurnId =
        'turnId' in storedEvent && typeof storedEvent.turnId === 'string'
          ? storedEvent.turnId
          : undefined;
      const runtimeRunId =
        'runtimeEvent' in storedEvent ? storedEvent.runtimeEvent?.runId : undefined;
      const originlessStartCanRepair =
        event.kind === 'session_start' &&
        (!('runtimeEvent' in storedEvent) || storedEvent.runtimeEvent === undefined);
      // Runtime-origin lifecycle events may only claim an owner already bound by the send ACK.
      // Their position in the live stream is not causal proof: an observation gap can replay an
      // older Run after a newer anonymous query. Legacy originless starts retain positional repair.
      const unscopedTurnBinding =
        event.kind === 'session_start'
          ? originlessStartCanRepair
            ? 'latest'
            : 'none'
          : event.kind === 'session_complete' || event.kind === 'session_error'
            ? 'unique'
            : 'none';
      const initialTurnUsers =
        event.kind === 'session_start' && lifecycleTurnId !== undefined
          ? openExactRestoredInitialTurn(currentUsers, lifecycleTurnId, runtimeRunId)
          : currentUsers;
      if (initialTurnUsers !== currentUsers && lifecycleTurnId !== undefined) {
        const openedOwner = initialTurnUsers.find(
          (message) =>
            message.restoredFromHistory === true &&
            message.turnId === lifecycleTurnId &&
            message.turnUserOrdinal === 0 &&
            message.historyNoAssistantSegment !== true,
        );
        if (openedOwner) rememberOpenedHistoryLiveOwner(event.sessionId, openedOwner);
      }
      const lifecycleBoundUsers =
        lifecycleTurnId !== undefined && !isPromptSegmentBoundary(storedEvent)
          ? bindInitialLiveUserTurnIdentity(
              initialTurnUsers,
              lifecycleTurnId,
              runtimeRunId,
              unscopedTurnBinding,
              appendedEvents,
            )
          : initialTurnUsers;
      const lifecycleIdentityChanged = lifecycleBoundUsers !== currentUsers;
      const next: Partial<AppState> = {
        eventsBySession: {
          ...state.eventsBySession,
          [event.sessionId]: appendedEvents,
        },
        ...(lifecycleIdentityChanged
          ? {
              userMessagesBySession: {
                ...state.userMessagesBySession,
                [event.sessionId]: lifecycleBoundUsers,
              },
            }
          : {}),
        lastEvent: storedEvent,
      };
      const rootContextEvent =
        !('contextKind' in event) ||
        event.contextKind === undefined ||
        event.contextKind === 'root';
      const startsCompaction = event.kind === 'compact_start' && rootContextEvent;
      const endsCompaction =
        (event.kind === 'compact_end' && rootContextEvent) ||
        event.kind === 'session_complete' ||
        event.kind === 'session_error';
      if (startsCompaction && state.compactingBySession[event.sessionId] !== true) {
        next.compactingBySession = {
          ...state.compactingBySession,
          [event.sessionId]: true,
        };
      } else if (endsCompaction && state.compactingBySession[event.sessionId] === true) {
        const { [event.sessionId]: _drop, ...restCompacting } = state.compactingBySession;
        next.compactingBySession = restCompacting;
      }
      // 只在"运行真正开始/结束"的生命周期事件到达时才清 pendingSend，把 spinner 交给 event-driven 状态。
      // ⚠️ 不能"任一事件到达就清"：repo-intelligence（repointel_trace）/ managed_task_status 等**非生命周期**
      // 事件可能先于 session_start 到达；若此时就清了 pendingSend，而 snapshotFromEvents 又只把
      // session_start / queued_user_prompt_started / mid_turn_user_prompt 当 streaming，spinner 会在
      // session_start 到达前整段消失
      // ——用户看到 query 气泡却没有任何"正在做什么"指示（新会话首个 query 期间 repo 分析最久，尤其明显）。
      // 这里的生命周期 kind 必须与 ActivitySpinner.snapshotFromEvents 认的那组保持一致。
      const clearsPendingSend =
        event.kind === 'session_start' ||
        event.kind === 'queued_user_prompt_started' ||
        event.kind === 'mid_turn_user_prompt' ||
        event.kind === 'session_complete' ||
        event.kind === 'session_error';
      if (
        clearsPendingSend &&
        state.pendingSendBySession[event.sessionId] &&
        eventClearsPendingSend(event, state.pendingSendRuntimeBaselineBySession[event.sessionId])
      ) {
        const { [event.sessionId]: _drop, ...restPending } = state.pendingSendBySession;
        const { [event.sessionId]: _dropBaseline, ...restBaselines } =
          state.pendingSendRuntimeBaselineBySession;
        next.pendingSendBySession = restPending;
        next.pendingSendRuntimeBaselineBySession = restBaselines;
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
            event.entryId,
            event.turnUserOrdinal === undefined,
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
            undefined,
            event.turnUserOrdinal === undefined,
          ),
        );
      } else if (event.kind === 'queued_user_prompt_failed') {
        Object.assign(next, failQueuedUserMessageForPrompt(state, event));
      } else if (isCancelledSessionError(event)) {
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
        lifecycleIdentityChanged ||
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
        rememberHistoryLiveUsers(event.sessionId, candidateUsers);
        const folded = foldStrongIdentityDuplicateTurns(candidateUsers, appendedEvents);
        rememberCanonicalizedHistoryLiveOwners(
          event.sessionId,
          folded.canonicalizedLiveOwners ?? [],
        );
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
        if (!isCancelledSessionError(event) && !isSessionVisiblyOpen(state, event.sessionId)) {
          const unreadFlags = setSessionFlagValue(
            next.sessionFlags ?? state.sessionFlags,
            event.sessionId,
            'unread',
            true,
          );
          if (unreadFlags !== state.sessionFlags) next.sessionFlags = unreadFlags;
        }
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
    clearHistoryLiveBaseline(sessionId);
    clearLastOpenedFileViewerSnapshotForSession(sessionId);
    failedLocalNoticeAppends.delete(sessionId);
    failedLocalNoticeAppendNeedsReconcile.delete(sessionId);
    failedLocalNoticeReplaces.delete(sessionId);
    clearLocalNoticePersistenceFailure(sessionId);
    set((state) => {
      // 同时清掉对应事件 buffer 和 user message buffer——session 不在了，留着就是泄漏
      const { [sessionId]: _evt, ...restEvents } = state.eventsBySession;
      const { [sessionId]: _esa, ...restErrorSeen } = state.errorSeenAtBySession;
      const { [sessionId]: _esr, ...restErrorSeenRun } = state.errorSeenRunIdBySession;
      const { [sessionId]: _esrs, ...restErrorSeenRuns } = state.errorSeenRunIdsBySession;
      persistErrorSeenRunIds(restErrorSeenRuns);
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
      const { [sessionId]: _compacting, ...restCompacting } = state.compactingBySession;
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
      const { [sessionId]: _pendingBaseline, ...restPendingBaselines } =
        state.pendingSendRuntimeBaselineBySession;
      const { [sessionId]: _sf, ...restFlags } = state.sessionFlags;
      return {
        sessions: state.sessions.filter((s) => s.sessionId !== sessionId),
        eventsBySession: restEvents,
        errorSeenAtBySession: restErrorSeen,
        errorSeenRunIdBySession: restErrorSeenRun,
        errorSeenRunIdsBySession: restErrorSeenRuns,
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
        compactingBySession: restCompacting,
        tokensBySession: restTokens,
        sessionTokenUsageBySession: restUsage,
        contextBudgetBySession: restContextBudgets,
        providerCacheDiagnosticBySession: restProviderCacheDiagnostics,
        promotedPopoutsBySession: restPromoted,
        inputHistoryBySession: restHistory,
        pendingSendBySession: restPending,
        pendingSendRuntimeBaselineBySession: restPendingBaselines,
        sessionFlags: restFlags,
        deletingSessionIds: new Set([...state.deletingSessionIds].filter((id) => id !== sessionId)),
        removingSessionIds: new Set([...state.removingSessionIds].filter((id) => id !== sessionId)),
        permissionQueue: state.permissionQueue.filter((p) => p.sessionId !== sessionId),
        askUserQueue: state.askUserQueue.filter((p) => p.sessionId !== sessionId),
        currentSessionId: state.currentSessionId === sessionId ? null : state.currentSessionId,
        // F009: 删 session 不能让 pending tool path / lastDiffPath 留指着已删 session
        lastDiffPath: state.currentSessionId === sessionId ? null : state.lastDiffPath,
      };
    });
    persistLocalNoticeReplace(sessionId, []);
  },

  // 删除 pending 状态：三个删除入口（SessionMenu ▾菜单/快捷键D、SessionContextMenu
  // 右键、SessionList 行内 ×）与视觉渲染（SessionList）分属不同组件，故放 store 而非组件 state。
  markSessionDeleting: (sessionId) =>
    set((state) => {
      if (state.deletingSessionIds.has(sessionId)) return state;
      return { deletingSessionIds: new Set(state.deletingSessionIds).add(sessionId) };
    }),

  unmarkSessionDeleting: (sessionId) =>
    set((state) => {
      if (!state.deletingSessionIds.has(sessionId)) return state;
      const next = new Set(state.deletingSessionIds);
      next.delete(sessionId);
      return { deletingSessionIds: next };
    }),

  markSessionRemoving: (sessionId) =>
    set((state) => {
      if (state.removingSessionIds.has(sessionId)) return state;
      return { removingSessionIds: new Set(state.removingSessionIds).add(sessionId) };
    }),

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
        runtimeConnectionHasFreshLiveAuthority(next.connection) &&
        next.connection.runtimeId !== undefined &&
        next.connection.runtimeId === state.runtimeConnection.runtimeId;
      const replacesKnownRuntime =
        state.runtimeConnection.runtimeId !== undefined &&
        state.runtimeConnection.runtimeId !== next.connection.runtimeId;
      const retiredRuntimeSessionIds = new Set<string>();
      if (replacesKnownRuntime) {
        for (const session of state.sessions) {
          if ((session.surface ?? 'code') === 'code') {
            retiredRuntimeSessionIds.add(session.sessionId);
          }
        }
        for (const session of state.runtimeProfile?.sessions ?? []) {
          retiredRuntimeSessionIds.add(session.sessionId);
        }
        for (const interaction of state.runtimeProfile?.interactions ?? []) {
          retiredRuntimeSessionIds.add(interaction.request.sessionId);
        }
        for (const sessionId of Object.keys(state.liveProjectionBySession)) {
          retiredRuntimeSessionIds.add(sessionId);
        }
      }
      const pendingSendRuntimeBaselineBySession = Object.fromEntries(
        Object.keys(state.pendingSendBySession).map((sessionId) => {
          const baseline = state.pendingSendRuntimeBaselineBySession[sessionId] ?? {
            requestGeneration: 0,
            liveCursorSeq: -1,
            profileCursorSeq: -1,
          };
          return [
            sessionId,
            baseline.runtimeId === undefined && next.connection.runtimeId !== undefined
              ? { ...baseline, runtimeId: next.connection.runtimeId }
              : baseline,
          ];
        }),
      );
      return {
        runtimeConnection: next.connection,
        liveProjectionBySession: next.liveBySession,
        runtimeSnapshotRequiredBySession: next.snapshotRequiredBySession,
        ...(keepActorSnapshots
          ? {}
          : {
              agentActorSnapshotBySession: {},
              runtimeSnapshotCursorBySession: {},
              ...(replacesKnownRuntime
                ? {
                    pendingSendBySession: {},
                    pendingSendRuntimeBaselineBySession: {},
                    permissionQueue: state.permissionQueue.filter(
                      (request) => !retiredRuntimeSessionIds.has(request.sessionId),
                    ),
                    askUserQueue: state.askUserQueue.filter(
                      (request) => !retiredRuntimeSessionIds.has(request.sessionId),
                    ),
                  }
                : { pendingSendRuntimeBaselineBySession }),
            }),
      };
    }),
  replaceAgentActorSnapshot: (snapshot) =>
    set((state) => {
      if (
        !runtimeConnectionHasFreshLiveAuthority(state.runtimeConnection) ||
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
      let pendingSendBySession = state.pendingSendBySession;
      let pendingSendRuntimeBaselineBySession = state.pendingSendRuntimeBaselineBySession;
      for (const session of next.profile?.sessions ?? []) {
        const baseline = pendingSendRuntimeBaselineBySession[session.sessionId];
        if (
          runtimeProfileClearsPendingSend(next.profile, session.sessionId, baseline) &&
          pendingSendBySession[session.sessionId]
        ) {
          const { [session.sessionId]: _drop, ...rest } = pendingSendBySession;
          const { [session.sessionId]: _dropBaseline, ...restBaselines } =
            pendingSendRuntimeBaselineBySession;
          pendingSendBySession = rest;
          pendingSendRuntimeBaselineBySession = restBaselines;
        }
      }
      return {
        sessions: mergeRuntimeActivityIntoSessions(state.sessions, next.profile),
        runtimeConnection: next.connection,
        runtimeProfile: next.profile,
        liveProjectionBySession: next.liveBySession,
        runtimeSnapshotRequiredBySession: next.snapshotRequiredBySession,
        runtimeSnapshotCursorBySession:
          next.connection.runtimeId !== undefined &&
          next.connection.runtimeId === state.runtimeConnection.runtimeId &&
          runtimeConnectionHasFreshLiveAuthority(next.connection)
            ? state.runtimeSnapshotCursorBySession
            : {},
        agentActorSnapshotBySession:
          next.connection.runtimeId !== undefined &&
          next.connection.runtimeId === state.runtimeConnection.runtimeId &&
          runtimeConnectionHasFreshLiveAuthority(next.connection)
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
        pendingSendBySession,
        pendingSendRuntimeBaselineBySession,
      };
    }),
  replaceSessionLiveProjection: (projection, options) => {
    let accepted = false;
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
      const acceptedNewProjection = next.liveBySession[projection.sessionId] === projection;
      const acceptedEqualProjection =
        (options?.allowEqualHydration === true ||
          state.runtimeSnapshotRequiredBySession[projection.sessionId] === true) &&
        currentProjection !== undefined &&
        next.liveBySession[projection.sessionId] === currentProjection &&
        runtimeConnectionHasFreshLiveAuthority(state.runtimeConnection) &&
        state.runtimeConnection.runtimeId === projection.cursor.runtimeId &&
        currentProjection.cursor.runtimeId === projection.cursor.runtimeId &&
        currentProjection.projectionRevision === projection.projectionRevision &&
        projection.cursor.seq >= currentProjection.cursor.seq &&
        next.snapshotRequiredBySession[projection.sessionId] !== true;
      // Only an explicit activation/recovery snapshot may repeat the live revision after
      // history/LRU/window reconstruction removed renderer-only transcript rows. Periodic reads
      // remain no-ops at equal revision and cannot replay cumulative drafts into a healthy view.
      const acceptedProjection = acceptedNewProjection || acceptedEqualProjection;
      accepted = acceptedProjection;
      if (!acceptedProjection) {
        if (
          next.liveBySession === state.liveProjectionBySession &&
          next.snapshotRequiredBySession === state.runtimeSnapshotRequiredBySession
        ) {
          return state;
        }
        // Rejected full snapshots may be stale, belong to another Runtime, or arrive while live
        // authority is unavailable. Preserve only the pure reducer's reconciliation marker; none
        // of the rejected payload may update settings, interactions, hydration, or cursor planes.
        return {
          liveProjectionBySession: next.liveBySession,
          runtimeSnapshotRequiredBySession: next.snapshotRequiredBySession,
        };
      }
      const identityProjection = preserveKnownProjectionRunTurnIdentity(
        currentProjection,
        projection,
      );
      const storedProjection =
        acceptedEqualProjection && currentProjection !== undefined
          ? preserveKnownProjectionRunTurnIdentity(identityProjection, currentProjection)
          : identityProjection;
      const liveProjectionBySession =
        storedProjection !== next.liveBySession[projection.sessionId]
          ? {
              ...next.liveBySession,
              [projection.sessionId]: storedProjection,
            }
          : next.liveBySession;
      const snapshotRun = identityProjection.activeRun ?? identityProjection.lastTerminalRun;
      const previousBarrier = state.runtimeSnapshotCursorBySession[projection.sessionId];
      const sameBarrierRun =
        snapshotRun !== undefined &&
        previousBarrier?.runtimeId === projection.cursor.runtimeId &&
        previousBarrier.runId === snapshotRun.runId;
      const currentEvents = state.eventsBySession[projection.sessionId] ?? [];
      const currentUsers = state.userMessagesBySession[projection.sessionId] ?? [];
      const currentQueued = state.queuedUserMessagesBySession[projection.sessionId] ?? [];
      const queuedInputs = reconcileRuntimeQueuedMessages(
        currentUsers,
        currentQueued,
        identityProjection,
      );
      const startedAfterTurnInputs = reconcileRuntimeStartedAfterTurnInputs(
        currentEvents,
        queuedInputs.userMessages,
        queuedInputs.queuedMessages,
        identityProjection,
      );
      const deliveredInputs = reconcileRuntimeDeliveredInputs(
        startedAfterTurnInputs.events,
        startedAfterTurnInputs.userMessages,
        startedAfterTurnInputs.queuedMessages,
        identityProjection,
      );
      const sidecarHydratedEvents = hydrateProjectedSidecarMessages(
        deliveredInputs.events,
        identityProjection,
      );
      const hydratedEvents = hydrateSessionEventsFromLiveSnapshot(
        sidecarHydratedEvents,
        identityProjection,
      );
      const snapshotOwnedUsers = reconcileSnapshotInitialTurnOwners(
        projection.sessionId,
        deliveredInputs.userMessages,
        hydratedEvents,
        identityProjection,
      );
      const operationClaimedUsers = claimUserMessagesByOriginOperation(
        snapshotOwnedUsers,
        identityProjection,
      );
      const folded = foldStrongIdentityDuplicateTurns(operationClaimedUsers, hydratedEvents);
      rememberCanonicalizedHistoryLiveOwners(
        projection.sessionId,
        folded.canonicalizedLiveOwners ?? [],
      );
      const reconciledUsers = hideOpenStrongIdentityDuplicateProjection(
        folded.userMessages,
        folded.events,
      );
      const reconciledEvents = folded.events;
      const liveBaseline = historyLiveBaselines.get(projection.sessionId);
      if (liveBaseline !== undefined) {
        // Page replacement is rebuilt from this independent live projection. Hydrate the same
        // authoritative Runtime snapshot into that baseline as well, otherwise loading an older
        // page would rebuild from a pre-reconnect baseline and make assistant/thinking/tool state
        // restored by the snapshot disappear.
        const queuedBaseline = reconcileRuntimeQueuedMessages(
          liveBaseline.userMessages,
          currentQueued,
          identityProjection,
        );
        const startedAfterTurnBaseline = reconcileRuntimeStartedAfterTurnInputs(
          liveBaseline.events,
          queuedBaseline.userMessages,
          queuedBaseline.queuedMessages,
          identityProjection,
        );
        const deliveredBaseline = reconcileRuntimeDeliveredInputs(
          startedAfterTurnBaseline.events,
          startedAfterTurnBaseline.userMessages,
          startedAfterTurnBaseline.queuedMessages,
          identityProjection,
        );
        const hydratedBaselineEvents = hydrateSessionEventsFromLiveSnapshot(
          hydrateProjectedSidecarMessages(deliveredBaseline.events, identityProjection),
          identityProjection,
        );
        rememberHistoryLiveBaseline(projection.sessionId, {
          ...liveBaseline,
          userMessages: reconcileSnapshotInitialTurnOwners(
            projection.sessionId,
            deliveredBaseline.userMessages,
            hydratedBaselineEvents,
            identityProjection,
          ),
          events: hydratedBaselineEvents,
        });
      }
      const clearsPendingSend =
        Boolean(state.pendingSendBySession[projection.sessionId]) &&
        liveProjectionClearsPendingSend(
          projection,
          state.pendingSendRuntimeBaselineBySession[projection.sessionId],
        );
      const pendingSendPatch = clearsPendingSend
        ? (() => {
            const { [projection.sessionId]: _drop, ...rest } = state.pendingSendBySession;
            const { [projection.sessionId]: _dropBaseline, ...restBaselines } =
              state.pendingSendRuntimeBaselineBySession;
            return {
              pendingSendBySession: rest,
              pendingSendRuntimeBaselineBySession: restBaselines,
            };
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
        liveProjectionBySession,
        runtimeSnapshotRequiredBySession: next.snapshotRequiredBySession,
        ...(snapshotRun
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
        ...(reconciledEvents !== currentEvents
          ? {
              eventsBySession: {
                ...state.eventsBySession,
                [projection.sessionId]: reconciledEvents,
              },
            }
          : {}),
        ...(reconciledUsers !== currentUsers
          ? {
              userMessagesBySession: {
                ...state.userMessagesBySession,
                [projection.sessionId]: reconciledUsers,
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
        queuedUserMessagesBySession: {
          ...state.queuedUserMessagesBySession,
          [projection.sessionId]: deliveredInputs.queuedMessages,
        },
        ...pendingSendPatch,
      };
    });
    return accepted;
  },
  applySessionLiveProjectionChange: (change) => {
    let status: ApplySessionLiveChangeStatus = 'ignored';
    set((state) => {
      const currentProjection = state.liveProjectionBySession[change.sessionId];
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
      const rawProjection = result.state.liveBySession[change.sessionId];
      const projection =
        result.status === 'applied' && rawProjection !== undefined
          ? preserveKnownProjectionRunTurnIdentity(currentProjection, rawProjection)
          : rawProjection;
      const liveProjectionBySession =
        projection !== undefined && projection !== rawProjection
          ? {
              ...result.state.liveBySession,
              [change.sessionId]: projection,
            }
          : result.state.liveBySession;
      const appliesRunIdentity =
        result.status === 'applied' &&
        projection !== undefined &&
        (change.change.domain === 'run' || change.change.domain === 'terminal');
      const appliesDeliveredInputs =
        result.status === 'applied' &&
        projection !== undefined &&
        (appliesRunIdentity || change.change.domain === 'queue');
      const appliesSidecar =
        result.status === 'applied' &&
        projection !== undefined &&
        change.change.domain === 'sidecar';
      const currentEvents = state.eventsBySession[change.sessionId] ?? [];
      const currentUsers = state.userMessagesBySession[change.sessionId] ?? [];
      const currentQueued = state.queuedUserMessagesBySession[change.sessionId] ?? [];
      const queuedInputs =
        appliesDeliveredInputs && projection !== undefined
          ? reconcileRuntimeQueuedMessages(currentUsers, currentQueued, projection)
          : { userMessages: currentUsers, queuedMessages: currentQueued };
      const startedAfterTurnInputs =
        appliesDeliveredInputs && projection !== undefined
          ? reconcileRuntimeStartedAfterTurnInputs(
              currentEvents,
              queuedInputs.userMessages,
              queuedInputs.queuedMessages,
              projection,
            )
          : { events: currentEvents, ...queuedInputs };
      const deliveredInputs =
        appliesDeliveredInputs && projection !== undefined
          ? reconcileRuntimeDeliveredInputs(
              startedAfterTurnInputs.events,
              startedAfterTurnInputs.userMessages,
              startedAfterTurnInputs.queuedMessages,
              projection,
            )
          : {
              events: currentEvents,
              userMessages: currentUsers,
              queuedMessages: currentQueued,
            };
      const sidecarHydratedEvents =
        (appliesRunIdentity || appliesSidecar) && projection !== undefined
          ? hydrateProjectedSidecarMessages(deliveredInputs.events, projection)
          : deliveredInputs.events;
      const hydratedEvents = appliesRunIdentity
        ? hydrateSessionEventsFromLiveSnapshot(sidecarHydratedEvents, projection)
        : sidecarHydratedEvents;
      const snapshotOwnedUsers = appliesRunIdentity
        ? reconcileSnapshotInitialTurnOwners(
            change.sessionId,
            deliveredInputs.userMessages,
            hydratedEvents,
            projection,
            change.change.domain === 'terminal' ? 'terminal' : 'active',
          )
        : deliveredInputs.userMessages;
      const operationClaimedUsers =
        appliesRunIdentity && projection !== undefined
          ? claimUserMessagesByOriginOperation(snapshotOwnedUsers, projection)
          : snapshotOwnedUsers;
      const folded = appliesRunIdentity
        ? foldStrongIdentityDuplicateTurns(operationClaimedUsers, hydratedEvents)
        : { userMessages: operationClaimedUsers, events: hydratedEvents };
      if (appliesRunIdentity) {
        rememberCanonicalizedHistoryLiveOwners(
          change.sessionId,
          folded.canonicalizedLiveOwners ?? [],
        );
      }
      const reconciledUsers = appliesRunIdentity
        ? hideOpenStrongIdentityDuplicateProjection(folded.userMessages, folded.events)
        : operationClaimedUsers;
      const reconciledEvents = folded.events;
      const liveBaseline = historyLiveBaselines.get(change.sessionId);
      if ((appliesDeliveredInputs || appliesSidecar) && liveBaseline !== undefined) {
        const queuedBaseline = appliesDeliveredInputs
          ? reconcileRuntimeQueuedMessages(liveBaseline.userMessages, currentQueued, projection)
          : { userMessages: liveBaseline.userMessages, queuedMessages: currentQueued };
        const startedAfterTurnBaseline = appliesDeliveredInputs
          ? reconcileRuntimeStartedAfterTurnInputs(
              liveBaseline.events,
              queuedBaseline.userMessages,
              queuedBaseline.queuedMessages,
              projection,
            )
          : { events: liveBaseline.events, ...queuedBaseline };
        const deliveredBaseline = appliesDeliveredInputs
          ? reconcileRuntimeDeliveredInputs(
              startedAfterTurnBaseline.events,
              startedAfterTurnBaseline.userMessages,
              startedAfterTurnBaseline.queuedMessages,
              projection,
            )
          : { events: liveBaseline.events, userMessages: liveBaseline.userMessages };
        const sidecarHydratedBaseline = hydrateProjectedSidecarMessages(
          deliveredBaseline.events,
          projection,
        );
        const hydratedBaselineEvents = appliesRunIdentity
          ? hydrateSessionEventsFromLiveSnapshot(sidecarHydratedBaseline, projection)
          : sidecarHydratedBaseline;
        rememberHistoryLiveBaseline(change.sessionId, {
          ...liveBaseline,
          userMessages: appliesRunIdentity
            ? reconcileSnapshotInitialTurnOwners(
                change.sessionId,
                deliveredBaseline.userMessages,
                hydratedBaselineEvents,
                projection,
                change.change.domain === 'terminal' ? 'terminal' : 'active',
              )
            : deliveredBaseline.userMessages,
          events: hydratedBaselineEvents,
        });
      }
      const clearsPendingSend =
        result.status === 'applied' &&
        projection !== undefined &&
        Boolean(state.pendingSendBySession[change.sessionId]) &&
        liveProjectionClearsPendingSend(
          projection,
          state.pendingSendRuntimeBaselineBySession[change.sessionId],
        );
      const pendingSendPatch = clearsPendingSend
        ? (() => {
            const { [change.sessionId]: _drop, ...rest } = state.pendingSendBySession;
            const { [change.sessionId]: _dropBaseline, ...restBaselines } =
              state.pendingSendRuntimeBaselineBySession;
            return {
              pendingSendBySession: rest,
              pendingSendRuntimeBaselineBySession: restBaselines,
            };
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
      const queuePatch =
        result.status === 'applied' &&
        projection !== undefined &&
        (change.change.domain === 'run' || change.change.domain === 'queue')
          ? {
              queuedUserMessagesBySession: {
                ...state.queuedUserMessagesBySession,
                [change.sessionId]: deliveredInputs.queuedMessages,
              },
            }
          : {};
      return {
        liveProjectionBySession,
        runtimeSnapshotRequiredBySession: result.state.snapshotRequiredBySession,
        ...(reconciledEvents !== currentEvents
          ? {
              eventsBySession: {
                ...state.eventsBySession,
                [change.sessionId]: reconciledEvents,
              },
            }
          : {}),
        ...(reconciledUsers !== currentUsers
          ? {
              userMessagesBySession: {
                ...state.userMessagesBySession,
                [change.sessionId]: reconciledUsers,
              },
            }
          : {}),
        ...interactionPatch,
        ...settingsPatch,
        ...queuePatch,
        ...pendingSendPatch,
      };
    });
    return status;
  },
  invalidateSessionLiveProjection: (invalidation) =>
    set((state) => {
      if (
        state.runtimeConnection.runtimeId !== invalidation.runtimeId &&
        state.liveProjectionBySession[invalidation.sessionId]?.cursor.runtimeId !==
          invalidation.runtimeId
      ) {
        return state;
      }
      const { [invalidation.sessionId]: _live, ...remainingLive } = state.liveProjectionBySession;
      const { [invalidation.sessionId]: _cursor, ...remainingCursors } =
        state.runtimeSnapshotCursorBySession;
      return {
        liveProjectionBySession: remainingLive,
        runtimeSnapshotCursorBySession: remainingCursors,
        runtimeSnapshotRequiredBySession: {
          ...state.runtimeSnapshotRequiredBySession,
          [invalidation.sessionId]: true,
        },
        permissionQueue: state.permissionQueue.filter(
          (request) => request.sessionId !== invalidation.sessionId,
        ),
        askUserQueue: state.askUserQueue.filter(
          (request) => request.sessionId !== invalidation.sessionId,
        ),
      };
    }),

  setPendingProviderId: (id) => set({ pendingProviderId: id }),
  setPendingReasoningMode: (mode) => {
    lsSet(LS_KEY_PENDING_REASONING, mode);
    set({ pendingReasoningMode: mode });
  },
  setPendingPermissionMode: (mode) => {
    lsSet(LS_KEY_PENDING_PERMISSION, mode);
    set({ pendingPermissionMode: mode });
  },
  setPendingAgentMode: (mode) => {
    lsSet(LS_KEY_PENDING_AGENT, mode);
    set({ pendingAgentMode: mode });
  },
  setPendingModel: (model) => {
    set({ pendingModel: model });
  },

  setPendingSend: (sessionId, pending, expectedGeneration) => {
    let requestGeneration: number | undefined;
    set((state) => {
      if (pending) {
        requestGeneration = ++pendingSendGenerationCounter;
        const baseline = pendingSendRuntimeBaseline(state, sessionId, requestGeneration);
        return {
          pendingSendBySession: { ...state.pendingSendBySession, [sessionId]: true as const },
          pendingSendRuntimeBaselineBySession: {
            ...state.pendingSendRuntimeBaselineBySession,
            [sessionId]: baseline,
          },
        };
      }
      if (!state.pendingSendBySession[sessionId]) return state;
      if (
        expectedGeneration !== undefined &&
        state.pendingSendRuntimeBaselineBySession[sessionId]?.requestGeneration !==
          expectedGeneration
      ) {
        return state;
      }
      const { [sessionId]: _drop, ...rest } = state.pendingSendBySession;
      const { [sessionId]: _dropBaseline, ...restBaselines } =
        state.pendingSendRuntimeBaselineBySession;
      return {
        pendingSendBySession: rest,
        pendingSendRuntimeBaselineBySession: restBaselines,
      };
    });
    return requestGeneration;
  },

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

  resetSessionView: () => {
    resetSessionViewLifecycles();
    set({
      currentSessionId: null,
      eventsBySession: {},
      compactingBySession: {},
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
    });
  },

  resetSessionMessages: (sessionId) => {
    clearHistoryLiveBaseline(sessionId);
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

  // FEATURE_033: fork = clone source buffer through the selected absolute turn.
  // Disk is authoritative, but the optimistic renderer copy must use the same cut or the child
  // briefly shows source-only turns that do not exist in its persisted transcript.
  //
  // **pendingToolPaths 不复制到 fork**（reviewer batch HIGH-2 的 follow-up）：
  // toolId 是 per-invocation UUID 全局唯一，永不复用——source 的 in-flight 工具 tool_result
  // 会路由回 source session（不是 fork），让 source 的 pending 自己清。fork 的"pending tool"
  // 概念只对 fork 自己产生的新 tool_start 才有意义。所以 fork 启动时 pendingToolPaths 自然为空。
  forkSessionBuffers: (srcSessionId, newSessionId, forkPointTurnIdx) => {
    let copiedLocalNotices: readonly LocalNoticeMessage[] | null = null;
    set((state) => {
      const srcEvents = state.eventsBySession[srcSessionId] ?? [];
      const srcMsgs = state.userMessagesBySession[srcSessionId] ?? [];
      const srcLocalNotices = state.localNoticesBySession[srcSessionId] ?? [];
      const srcNotices = state.workflowNoticesBySession[srcSessionId] ?? [];
      const cut = transcriptCutForSelectorTurn(srcMsgs, srcEvents, forkPointTurnIdx);
      // Never populate a child with a demonstrably different branch when the requested selector
      // is absent from the bounded renderer window. The authoritative child history can hydrate it.
      if (!cut) return state;
      // Every row before the fork boundary is inherited history in the child, even when that row
      // was still a live renderer projection in the source. The successful main-process fork has
      // already made this prefix durable for the child; retaining the source's live classification
      // would append the optimistic clone again when canonical child history hydrates.
      const copiedMsgs = srcMsgs
        .slice(0, cut.userEnd)
        .map((message) => ({ ...message, restoredFromHistory: true as const }));
      const copiedEvents = srcEvents.slice(0, cut.eventEnd);
      const firstRemovedSentAt = srcMsgs[cut.userEnd]?.sentAt ?? Number.POSITIVE_INFINITY;
      const copiedNotices = srcLocalNotices.filter((notice) => notice.sentAt < firstRemovedSentAt);
      const copiedWorkflowNotices = srcNotices.filter(
        (notice) => notice.sentAt < firstRemovedSentAt,
      );
      copiedLocalNotices = copiedNotices;
      // events 里的 sessionId 字段是 source 的——为新 session 重建 events 时需要改 sessionId，
      // 否则 ConversationStreamV2 按 sessionId 过滤会读不到。这里直接做映射。
      const remapped = copiedEvents.map((event) => {
        const copy = { ...event, sessionId: newSessionId } as SessionEvent;
        // History/live ownership is tracked by object identity. All optimistic fork-prefix events
        // are inherited history in the child, regardless of whether they were restored or live in
        // the source; otherwise canonical hydration can replay the copied prefix as child-live.
        restoredHistoryEvents.add(copy);
        return copy;
      });
      return {
        eventsBySession: { ...state.eventsBySession, [newSessionId]: remapped },
        transientArtifactsBySession: {
          ...state.transientArtifactsBySession,
          [newSessionId]: collectTransientArtifactsFromEvents(remapped),
        },
        userMessagesBySession: { ...state.userMessagesBySession, [newSessionId]: copiedMsgs },
        queuedUserMessagesBySession: {
          ...state.queuedUserMessagesBySession,
          [newSessionId]: [],
        },
        localNoticesBySession: {
          ...state.localNoticesBySession,
          [newSessionId]: copiedNotices,
        },
        workflowNoticesBySession: {
          ...state.workflowNoticesBySession,
          [newSessionId]: copiedWorkflowNotices,
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
    clearHistoryLiveBaseline(sessionId);
    set((state) => {
      const msgs = state.userMessagesBySession[sessionId] ?? [];
      const localNotices = state.localNoticesBySession[sessionId] ?? [];
      const notices = state.workflowNoticesBySession[sessionId] ?? [];
      const events = state.eventsBySession[sessionId] ?? [];
      const cut = transcriptCutForSelectorTurn(msgs, events, rewindPastTurnIdx);
      // selector idx 不在当前可见窗口 → 啥都不做
      if (!cut) return state;
      const newMsgs = msgs.slice(0, cut.userEnd);
      const firstRemovedSentAt = msgs[cut.userEnd]?.sentAt ?? Number.POSITIVE_INFINITY;
      const newLocalNotices = localNotices.filter((notice) => notice.sentAt < firstRemovedSentAt);
      const newNotices = notices.filter((notice) => notice.sentAt < firstRemovedSentAt);
      // A user with historyNoAssistantSegment does not consume an event segment. Use the same
      // user→event projection as compose/history reconciliation instead of a raw user-array index.
      const sliceEnd = cut.eventEnd;
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
  },
}));
