// ConversationStreamV2 — alpha.1
//
// 跟 Claude Desktop 截图对齐的对话流：
//   - 工具调用聚合为 "Ran N commands ›" 折叠行（默认折叠，点开看每个 tool 卡）
//   - 用户气泡 / assistant markdown / system notice 复用原 bubbles
//   - 滚动跟进逻辑在本组件内维护 sticky-bottom / jump-to-bottom 状态
//
// 聚合规则：连续的 tool_call 折成一组；assistant_text(带正文) / user / system_notice 打断聚合。
// normal/summary 视图下 thinking-only step 不打断（推理折进工具组）；thinking/verbose 视图下 thinking 独立成行。
// 一组内 N >= 1 时显示 "Ran N commands ›"（N=1 时仍折叠，统一形态）。
// 点击聚合行展开 = 显示组里每个 tool 的细节卡。

import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent,
  type PointerEvent as ReactPointerEvent,
  type TouchEvent as ReactTouchEvent,
  type WheelEvent as ReactWheelEvent,
} from 'react';
import type { SessionEvent, SessionMeta } from '@kodax-space/space-ipc-schema';
import {
  useAppStore,
  type LocalNoticeMessage,
  type QueuedUserMessage,
  type UserMessage,
  type WorkflowNoticeMessage,
} from '../store/appStore.js';
import { composeMessages, type ConversationMessage } from '../features/session/composeMessages.js';
import {
  canRewindSelectorTurn,
  localNoticeCutoffSentAtForSelectorTurn,
  selectorTurnIndexesByMessageId,
} from '../features/session/turnIndex.js';
import { patchComposedStreamTail } from './conversationStreamIncremental.js';
import {
  FOCUS_ARTIFACT_EVENT,
  snapshotFromCreateArtifactTool,
  type TransientArtifactSnapshot,
} from '../features/artifact/transientArtifact.js';

// **稳定空数组**：useAppStore selector 里返回 `?? []` literal 会每次 render 创建新引用，
// zustand 默认 Object.is 比对触发 subscribe re-render → re-eval selector → 又新 [] → 无限循环
// (React error #185)。module-level const 让"空"case 复用同一引用。
const EMPTY_EVENTS: readonly SessionEvent[] = [];
const EMPTY_USER_MESSAGES: readonly UserMessage[] = [];
const EMPTY_LOCAL_NOTICES: readonly LocalNoticeMessage[] = [];
const EMPTY_QUEUED_USER_MESSAGES: readonly QueuedUserMessage[] = [];
const EMPTY_WORKFLOW_NOTICES: readonly WorkflowNoticeMessage[] = [];
const EMPTY_MATCH_IDS: readonly string[] = [];
const INSTANT_PROGRAMMATIC_SCROLL_GUARD_MS = 120;
const SMOOTH_PROGRAMMATIC_SCROLL_GUARD_MS = 400;
// 追底判定与 jump-to-bottom 按钮显隐共用此阈值，两者严格互补（< 阈值追底，>= 阈值显示按钮），避免双阈值死区。
// 例外：older-window-seam 历史分页恢复（restoreScrollSnapshot）刻意不追底且隐藏按钮——浏览更早历史时不打扰，另有 return-to-newest 按钮兜底。
const BOTTOM_DISTANCE_PX = 32;
const USER_SCROLL_INTENT_DELTA_PX = 4;
const HISTORY_LOAD_THRESHOLD_PX = 240;

function getDistanceFromBottom(el: HTMLDivElement): number {
  return Math.max(0, el.scrollHeight - el.scrollTop - el.clientHeight);
}

function isDocumentActiveForAutoFollow(): boolean {
  return !document.hidden && document.hasFocus();
}
import {
  AssistantBubble,
  SystemNotice,
  ToolCallCard,
  UserBubble,
  LocalNoticeBubble,
  QueuedUserBubble,
} from '../features/session/messages/bubbles.js';
import { WelcomeDashboard } from './WelcomeDashboard.js';
import { ActivitySpinner, useIsStreaming } from './ActivitySpinner.js';
import { Caret } from '../components/Caret.js';
import { Reveal } from '../components/Reveal.js';
import { Collapse } from '../components/Collapse.js';
import { ScrollCapBox } from '../components/ScrollCapBox.js';
import { ChevronDown, FileOutput, Maximize2 } from 'lucide-react';
import { shouldActivateSessionForCurrentScope } from '../lib/sessionActivation.js';
import { useSurfaceStore } from '../store/surface.js';
import { requestConfirm } from '../store/confirmStore.js';
import { pushToast } from '../store/toastStore.js';
import { useI18n } from '../i18n/I18nProvider.js';
import type { MessageKey } from '../i18n/messages.js';
import {
  loadOlderSessionHistory,
  olderHistoryWindowSeamScrollTop,
  PREPEND_ANCHOR_CORRECTION_FRAME_OFFSETS,
  preservesPrependAnchorForBoundaryInput,
  restoreNewestSessionHistory,
  useSessionHistoryPaging,
} from './sessionHistoryPaging.js';
// 聚合后的 view-only message kind —— 两层折叠对齐 Claude Desktop "Ran 6 commands ⌄":
//
//   ▸ Ran 6 commands · 12s              ← 外层 cluster (此处折叠 = 默认)
//     ▸ List workspaces and docs        ← 内层 sub-cluster (一个 LLM step 的 N 个工具)
//       [individual ToolCallCard]       ← 工具细节 (再折一次)
//     ▸ Read more README + FEATURE_LIST
//     ...
//
// Sub-cluster 切分边界 = 每个 LLM step (assistant_text 段之间)。每个 step 通常是
// "thinking → 决定调几个 tool"，所以 step 内 0..N 个 tool_call 形成一个 sub-cluster，
// title 取 step 前 assistant_text 的首句 (preceding `assistant_text.text` 或 `thinking`)。
type ToolCallMsg = Extract<ConversationMessage, { kind: 'tool_call' }>;
type SubCluster = {
  id: string;
  title: string;
  tools: ToolCallMsg[];
  turnIndex?: number;
  /** title 是不是 summarizeTools 兜底生成（"1 read"）而非真正的 assistant 文本。
   *  synthetic=true 时 UI 可以选择性隐藏 title 避免噪音；synthetic=false 时**必须**
   *  显示，否则 assistant 的真实回复内容会从对话流里消失。 */
  syntheticTitle: boolean;
  /** thinking-only step（只想了一下就调工具、没说正文）的推理文本，**折进**本 sub-cluster
   *  而不是单独成一行。这样连续的 thinking→cmd→thinking→cmd 收敛成一个 "Ran N commands"。
   *  仅在 normal/summary 视图（foldThinking）下填充；thinking/verbose 视图保留独立 thinking 行。 */
  thinking?: string;
};
type ToolClusterMessage = {
  kind: 'tool_cluster';
  id: string;
  subClusters: SubCluster[];
  totalTools: number;
  turnIndex?: number;
  /** 组内折进来的 thinking 估算 token 总量（4 chars ≈ 1 token）。groupTools 里预算一次，
   *  避免 ToolCluster 每次 render 都 reduce 全部 thinking 字符串。0 = 没折进任何推理。 */
  thinkingTokens: number;
};

type ArtifactMessage = {
  kind: 'artifact';
  id: string;
  artifactId: string | null;
  title: string;
  artifactKind: string;
  version?: number;
  status: 'running' | 'done';
  summary?: string;
  snapshot?: TransientArtifactSnapshot;
};

/**
 * Thinking-only 视图节点 —— 对齐 VSCode Claude Code 的 "Thought for Xs" 折叠行。
 * 之前 thinking 跟 text 被绑在同一个 assistant_text 上，groupTools 把后跟 tools 的整条
 * 消息吸进 sub-cluster header 只剩 title，thinking 内容丢失。现在 groupTools 把
 * thinking 拆出来在 cluster 前单独出一条折叠记录。
 */
type ThinkingMessage = {
  kind: 'thinking';
  id: string;
  thinking: string;
  turnIndex?: number;
};

type ViewMessage =
  | Exclude<ConversationMessage, { kind: 'tool_call' }>
  | ToolClusterMessage
  | ArtifactMessage
  | ThinkingMessage;

type ProcessReceiptMessage = Extract<ViewMessage, { kind: 'thinking' | 'tool_cluster' }>;
type StandardViewMessage = Exclude<ViewMessage, ProcessReceiptMessage>;
type ConversationRenderItem =
  | {
      kind: 'message';
      id: string;
      message: StandardViewMessage;
    }
  | {
      kind: 'receipts';
      id: string;
      receipts: ProcessReceiptMessage[];
    };

interface ComposeMessagesCache {
  readonly sessionId: string | null;
  readonly events: readonly SessionEvent[];
  readonly userMessages: readonly UserMessage[];
  readonly localNotices: readonly LocalNoticeMessage[];
  readonly queuedUserMessages: readonly QueuedUserMessage[];
  readonly workflowNotices: readonly WorkflowNoticeMessage[];
  readonly messages: readonly ConversationMessage[];
}

/**
 * v0.1.4: assistant_text 的 text/thinking 内容都拆成独立 view-message 渲染了
 * （AssistantBubble + ThinkingBlock），不再需要为 sub-cluster 取首句当 title。
 * sub-cluster title 现在固定走 summarizeTools 兜底，syntheticTitle=true。
 *
 * 旧 firstSentence 函数若未来重新需要"标题摘要"再恢复。
 *
 * Fallback：按 tool 名汇总 "Ran 3 reads + 1 grep"。
 */
type Translate = (key: MessageKey, vars?: Record<string, string | number>) => string;

type QueryJumpAnchor = {
  id: string;
  content: string;
  ordinal: number;
};

type ViewportScrollAnchor = {
  id: string;
  offsetTop: number;
};

type ScrollSnapshot = {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
  anchor: ViewportScrollAnchor | null;
  atBottom: boolean;
};

const QUERY_JUMP_MIN_ANCHORS = 3;
const QUERY_JUMP_TOP_PADDING_PX = 10;
const QUERY_JUMP_TITLE_CHARS = 44;
const QUERY_JUMP_BODY_CHARS = 116;
const RESTORED_REVEAL_TAIL_ITEMS = 24;
function compactInlineText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function truncateText(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - 1)).trimEnd()}...`;
}

function formatCompactCount(value: number): string {
  if (!Number.isFinite(value)) return '0';
  if (value < 1000) return String(value);
  const precision = value < 10000 ? 1 : 0;
  return `${(value / 1000).toFixed(precision).replace(/\.0$/, '')}k`;
}

function messageTopWithinScroller(scroller: HTMLDivElement, target: HTMLElement): number {
  return (
    target.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop
  );
}

function findMessageNodeNearViewportPoint(
  scroller: HTMLDivElement,
  viewportFraction: number,
): HTMLElement | null {
  const rect = scroller.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;
  const x = Math.min(rect.right - 8, rect.left + Math.max(72, Math.min(144, rect.width * 0.25)));
  const centerY = rect.top + Math.max(1, Math.min(rect.height - 1, rect.height * viewportFraction));
  for (const offset of [0, -6, 6, -14, 14, -28, 28]) {
    const y = Math.max(rect.top + 1, Math.min(rect.bottom - 1, centerY + offset));
    for (const element of document.elementsFromPoint(x, y)) {
      if (!scroller.contains(element)) continue;
      const message = element.closest<HTMLElement>('[data-msg-id]');
      if (message && scroller.contains(message)) return message;
    }
  }
  return null;
}

function findNearbyStableScrollAnchor(
  scroller: HTMLDivElement,
  visibleNode: HTMLElement,
): HTMLElement | null {
  const visibleRow = visibleNode.closest<HTMLElement>('[data-testid="conversation-render-row"]');
  if (!visibleRow || !scroller.contains(visibleRow)) return null;
  let previous = visibleRow.previousElementSibling;
  let next = visibleRow.nextElementSibling;
  // Page seams normally need only the adjacent assistant/user row. Keep the fallback bounded so
  // ordinary wheel events can never turn into a full-DOM geometry scan on very long transcripts.
  for (let distance = 0; distance < 32 && (previous !== null || next !== null); distance += 1) {
    const previousAnchor = previous?.querySelector<HTMLElement>(
      '[data-stable-scroll-anchor="true"]',
    );
    const nextAnchor = next?.querySelector<HTMLElement>('[data-stable-scroll-anchor="true"]');
    if (previousAnchor && nextAnchor) {
      const viewportCenter =
        scroller.getBoundingClientRect().top + scroller.getBoundingClientRect().height * 0.42;
      return Math.abs(previousAnchor.getBoundingClientRect().top - viewportCenter) <=
        Math.abs(nextAnchor.getBoundingClientRect().top - viewportCenter)
        ? previousAnchor
        : nextAnchor;
    }
    if (previousAnchor) return previousAnchor;
    if (nextAnchor) return nextAnchor;
    previous = previous?.previousElementSibling ?? null;
    next = next?.nextElementSibling ?? null;
  }
  return null;
}

function findActiveQueryAnchorId(
  scroller: HTMLDivElement,
  anchors: readonly QueryJumpAnchor[],
): string | null {
  if (anchors.length === 0) return null;
  const message = findMessageNodeNearViewportPoint(
    scroller,
    Math.min(0.25, (QUERY_JUMP_TOP_PADDING_PX + 24) / Math.max(1, scroller.clientHeight)),
  );
  return (
    message?.closest<HTMLElement>('[data-query-anchor-id]')?.dataset.queryAnchorId ??
    anchors[0]?.id ??
    null
  );
}

function isProcessReceiptMessage(message: ViewMessage): message is ProcessReceiptMessage {
  return message.kind === 'thinking' || message.kind === 'tool_cluster';
}

function makeReceiptRowId(receipts: readonly ProcessReceiptMessage[]): string {
  return `receipts_${receipts.map((receipt) => receipt.id).join('_')}`;
}

function buildConversationRenderItems(messages: readonly ViewMessage[]): ConversationRenderItem[] {
  const items: ConversationRenderItem[] = [];
  let pendingReceipts: ProcessReceiptMessage[] = [];

  const flushReceipts = (): void => {
    if (pendingReceipts.length === 0) return;
    items.push({
      kind: 'receipts',
      id: makeReceiptRowId(pendingReceipts),
      receipts: pendingReceipts,
    });
    pendingReceipts = [];
  };

  for (const message of messages) {
    if (isProcessReceiptMessage(message)) {
      pendingReceipts.push(message);
      continue;
    }
    if (message.kind === 'assistant_text' && !message.text.trim() && !message.thinking?.trim()) {
      continue;
    }

    flushReceipts();
    items.push({ kind: 'message', id: message.id, message });
  }

  flushReceipts();

  return items;
}

function subClustersShareProjection(
  previous: readonly SubCluster[],
  next: readonly SubCluster[],
): boolean {
  if (previous.length !== next.length) return false;
  return previous.every((left, index) => {
    const right = next[index];
    return (
      right !== undefined &&
      left.id === right.id &&
      left.title === right.title &&
      left.turnIndex === right.turnIndex &&
      left.syntheticTitle === right.syntheticTitle &&
      left.thinking === right.thinking &&
      left.tools.length === right.tools.length &&
      left.tools.every((tool, toolIndex) => tool === right.tools[toolIndex])
    );
  });
}

function viewMessagesShareProjection(previous: ViewMessage, next: ViewMessage): boolean {
  if (previous === next) return true;
  if (previous.kind !== next.kind || previous.id !== next.id) return false;
  switch (previous.kind) {
    case 'user':
      return (
        next.kind === 'user' &&
        previous.content === next.content &&
        previous.attachments === next.attachments &&
        previous.sentAt === next.sentAt
      );
    case 'local_notice':
      return (
        next.kind === 'local_notice' &&
        previous.content === next.content &&
        previous.variant === next.variant &&
        previous.sentAt === next.sentAt
      );
    case 'queued_user':
      return (
        next.kind === 'queued_user' &&
        previous.content === next.content &&
        previous.attachments === next.attachments &&
        previous.queueMode === next.queueMode &&
        previous.status === next.status &&
        previous.failureReason === next.failureReason &&
        previous.sentAt === next.sentAt
      );
    case 'assistant_text':
      return (
        next.kind === 'assistant_text' &&
        previous.text === next.text &&
        previous.thinking === next.thinking &&
        previous.turnIndex === next.turnIndex &&
        previous.completed === next.completed &&
        previous.sentAt === next.sentAt
      );
    case 'system_notice':
      return (
        next.kind === 'system_notice' &&
        previous.variant === next.variant &&
        previous.text === next.text &&
        previous.lineageKind === next.lineageKind &&
        previous.historyTruncationScope === next.historyTruncationScope &&
        previous.omittedItems === next.omittedItems &&
        previous.historical === next.historical &&
        previous.action === next.action &&
        previous.retriable === next.retriable &&
        previous.retryAvailableAt === next.retryAvailableAt &&
        previous.sentAt === next.sentAt
      );
    case 'tool_cluster':
      return (
        next.kind === 'tool_cluster' &&
        previous.totalTools === next.totalTools &&
        previous.turnIndex === next.turnIndex &&
        previous.thinkingTokens === next.thinkingTokens &&
        subClustersShareProjection(previous.subClusters, next.subClusters)
      );
    case 'thinking':
      return (
        next.kind === 'thinking' &&
        previous.thinking === next.thinking &&
        previous.turnIndex === next.turnIndex
      );
    case 'artifact':
      return (
        next.kind === 'artifact' &&
        previous.artifactId === next.artifactId &&
        previous.title === next.title &&
        previous.artifactKind === next.artifactKind &&
        previous.version === next.version &&
        previous.status === next.status &&
        previous.summary === next.summary &&
        previous.snapshot === next.snapshot
      );
  }
}

function retainStableViewMessages(
  previous: readonly ViewMessage[],
  next: readonly ViewMessage[],
): ViewMessage[] {
  if (previous.length === 0 || next.length === 0) return [...next];
  const previousById = new Map(previous.map((message) => [message.id, message]));
  return next.map((message) => {
    const prior = previousById.get(message.id);
    return prior !== undefined && viewMessagesShareProjection(prior, message) ? prior : message;
  });
}

function retainStableRenderItems(
  previous: readonly ConversationRenderItem[],
  next: readonly ConversationRenderItem[],
): ConversationRenderItem[] {
  if (previous.length === 0 || next.length === 0) return [...next];
  const previousById = new Map(previous.map((item) => [item.id, item]));
  return next.map((item) => {
    const prior = previousById.get(item.id);
    if (prior === undefined || prior.kind !== item.kind) return item;
    if (prior.kind === 'message' && item.kind === 'message') {
      return prior.message === item.message ? prior : item;
    }
    if (prior.kind === 'receipts' && item.kind === 'receipts') {
      return prior.receipts.length === item.receipts.length &&
        prior.receipts.every((receipt, index) => receipt === item.receipts[index])
        ? prior
        : item;
    }
    return item;
  });
}

const HEIGHT_ESTIMATE_SAMPLE_CHARS = 4_096;
const HEIGHT_ESTIMATE_HALF_SAMPLE_CHARS = HEIGHT_ESTIMATE_SAMPLE_CHARS / 2;

function sampledNewlineEstimate(text: string): number {
  const countNewlines = (start: number, end: number): number => {
    let count = 0;
    for (let index = start; index < end; index += 1) {
      if (text.charCodeAt(index) === 10) count += 1;
    }
    return count;
  };
  if (text.length <= HEIGHT_ESTIMATE_SAMPLE_CHARS) {
    return countNewlines(0, text.length);
  }
  const sampled =
    countNewlines(0, HEIGHT_ESTIMATE_HALF_SAMPLE_CHARS) +
    countNewlines(text.length - HEIGHT_ESTIMATE_HALF_SAMPLE_CHARS, text.length);
  return Math.round((sampled * text.length) / HEIGHT_ESTIMATE_SAMPLE_CHARS);
}

function estimateTextLengthHeight(length: number, minimum: number): number {
  const wrappedLines = Math.ceil(Math.max(0, length) / 92);
  return Math.min(12_000, Math.max(minimum, wrappedLines * 21 + 38));
}

function estimateTextBlockHeight(text: string, minimum: number): number {
  if (text.length === 0) return minimum;
  const explicitLines = sampledNewlineEstimate(text) + 1;
  const wrappedLines = Math.ceil(Math.max(0, text.length - explicitLines + 1) / 92);
  return Math.min(12_000, Math.max(minimum, (explicitLines + wrappedLines) * 21 + 38));
}

function estimateToolCallHeight(tool: ToolCallMsg): number {
  let approximateChars = tool.toolName.length;
  if (typeof tool.result === 'string') approximateChars += tool.result.length;
  if (tool.input !== undefined) {
    let inspectedKeys = 0;
    for (const key in tool.input) {
      if (!Object.prototype.hasOwnProperty.call(tool.input, key)) continue;
      const value = tool.input[key];
      approximateChars +=
        key.length +
        (typeof value === 'string'
          ? value.length
          : Array.isArray(value)
            ? Math.min(4_096, value.length * 24)
            : value !== null && typeof value === 'object'
              ? 512
              : String(value).length);
      inspectedKeys += 1;
      if (inspectedKeys >= 64 || approximateChars >= 16_384) break;
    }
  }
  return Math.min(280, estimateTextLengthHeight(approximateChars, 72));
}

function estimateReceiptHeight(
  receipt: ProcessReceiptMessage,
  expanded: ReadonlySet<string>,
  clustersForceExpand: boolean,
  thinkingForceExpand: boolean,
): number {
  if (receipt.kind === 'thinking') {
    return expanded.has(receipt.id) || thinkingForceExpand
      ? Math.min(720, estimateTextBlockHeight(receipt.thinking, 52))
      : 34;
  }
  if (!expanded.has(receipt.id) && !clustersForceExpand) return 34;
  let expandedHeight = 64;
  for (const subCluster of receipt.subClusters) {
    expandedHeight += estimateTextBlockHeight(subCluster.title, 28);
    if (expandedHeight >= 720) return 720;
    if (subCluster.thinking) {
      expandedHeight += Math.min(420, estimateTextBlockHeight(subCluster.thinking, 32));
      if (expandedHeight >= 720) return 720;
    }
    for (const tool of subCluster.tools) {
      expandedHeight += estimateToolCallHeight(tool);
      if (expandedHeight >= 720) return 720;
    }
  }
  return Math.min(720, expandedHeight);
}

function estimateRenderItemHeight(
  item: ConversationRenderItem,
  expanded: ReadonlySet<string>,
  clustersForceExpand: boolean,
  thinkingForceExpand: boolean,
): number {
  if (item.kind === 'receipts') {
    let receiptsHeight = 16;
    for (const receipt of item.receipts) {
      receiptsHeight += estimateReceiptHeight(
        receipt,
        expanded,
        clustersForceExpand,
        thinkingForceExpand,
      );
      if (receiptsHeight >= 720) return 720;
    }
    return receiptsHeight;
  }
  const message = item.message;
  switch (message.kind) {
    case 'user':
    case 'local_notice':
    case 'queued_user':
      return estimateTextBlockHeight(message.content, 64);
    case 'assistant_text':
      return estimateTextBlockHeight(message.text, 72);
    case 'system_notice':
      return estimateTextBlockHeight(message.text, 48);
    case 'artifact':
      return 96;
  }
}

function summarizeTools(tools: readonly ToolCallMsg[], t: Translate): string {
  const counts = new Map<string, number>();
  for (const tool of tools) counts.set(tool.toolName, (counts.get(tool.toolName) ?? 0) + 1);
  const parts = [...counts.entries()].map(([name, n]) => (n > 1 ? `${n} ${name}s` : `1 ${name}`));
  return t('conversation.ranToolSummary', { tools: parts.join(' + ') });
}
const ARTIFACT_RESULT_RE = /\(id=([^,]+), v(\d+)\)/;

function pickToolString(input: Record<string, unknown> | undefined, key: string): string | null {
  if (!input) return null;
  const value = input[key];
  return typeof value === 'string' ? value : null;
}

function artifactMessageFromTool(tool: ToolCallMsg): ArtifactMessage | null {
  if (tool.toolName !== 'create_artifact') return null;
  const match = typeof tool.result === 'string' ? ARTIFACT_RESULT_RE.exec(tool.result) : null;
  if (tool.status === 'done' && !match) return null;

  const artifactId = match?.[1]?.trim() ?? null;
  const parsedVersion = match ? Number(match[2]) : undefined;
  const version = Number.isFinite(parsedVersion) ? parsedVersion : undefined;
  const title = pickToolString(tool.input, 'title') ?? 'Artifact';
  const artifactKind = pickToolString(tool.input, 'kind') ?? 'artifact';
  const summary = pickToolString(tool.input, 'summary');
  const snapshot = snapshotFromCreateArtifactTool({
    status: tool.status,
    input: tool.input,
    result: tool.result,
  });

  return {
    kind: 'artifact',
    id: `${tool.id}_artifact`,
    artifactId,
    title,
    artifactKind,
    ...(version !== undefined ? { version } : {}),
    status: tool.status,
    ...(summary ? { summary } : {}),
    ...(snapshot ? { snapshot } : {}),
  };
}

function groupTools(
  messages: readonly ConversationMessage[],
  view: 'normal' | 'thinking' | 'verbose' | 'summary',
  t: Translate,
  countThinkingTokens: (id: string, thinking: string) => number = (_id, thinking) =>
    approxTokens(thinking),
): ViewMessage[] {
  // normal/summary = 紧凑：thinking-only step 的推理折进工具组，连续 thinking→cmd 收敛成一个 cluster。
  // thinking/verbose = 摊开：thinking 仍是独立可读行，每个 step 各自成组（看清每一步在想什么）。
  const foldThinking = view === 'normal' || view === 'summary';
  const out: ViewMessage[] = [];
  let pendingCluster: SubCluster[] = [];
  let clusterCounter = 0;

  const flushCluster = (): void => {
    if (pendingCluster.length === 0) return;
    const totalTools = pendingCluster.reduce((acc, sc) => acc + sc.tools.length, 0);
    const thinkingTokens = pendingCluster.reduce(
      (acc, sc) => acc + (sc.thinking ? countThinkingTokens(sc.id, sc.thinking) : 0),
      0,
    );
    const turnIndex = pendingCluster.find((sc) => sc.turnIndex !== undefined)?.turnIndex;
    out.push({
      kind: 'tool_cluster',
      id: `cluster_${clusterCounter++}_${pendingCluster[0].id}`,
      subClusters: pendingCluster,
      totalTools,
      ...(turnIndex !== undefined ? { turnIndex } : {}),
      thinkingTokens,
    });
    pendingCluster = [];
  };

  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];

    if (
      m.kind === 'user' ||
      m.kind === 'local_notice' ||
      m.kind === 'queued_user' ||
      m.kind === 'system_notice'
    ) {
      flushCluster();
      out.push(m);
      continue;
    }

    if (m.kind === 'assistant_text') {
      // 前看：紧跟的 tool_call 序列归入本 step 的 sub-cluster；
      // 若不跟 tool 则当成 final answer 独立渲染。
      const tools: ToolCallMsg[] = [];
      let j = i + 1;
      while (j < messages.length && messages[j].kind === 'tool_call') {
        const tool = messages[j] as ToolCallMsg;
        if (artifactMessageFromTool(tool)) break;
        tools.push(tool);
        j++;
      }
      if (tools.length > 0) {
        // v0.1.4 修复：thinking 和 text 之前都被 sub-cluster 吸进 title 只剩首句 80 char。
        // assistant 真说了 200 字也只剩第一句 —— 用户报告"正常输出，过一会消失了"就是这。
        const hasThinking = Boolean(m.thinking && m.thinking.length > 0);
        const hasText = m.text.length > 0;
        if (hasText) {
          // 有正文 = 一段有意义的 assistant 回复，**打断**工具组单独渲染（thinking 在其前一行）。
          flushCluster();
          if (hasThinking) {
            out.push({
              kind: 'thinking',
              id: `${m.id}_thinking`,
              thinking: m.thinking!,
              ...(m.turnIndex !== undefined ? { turnIndex: m.turnIndex } : {}),
            });
          }
          // 复用现有 assistant_text view-kind —— AssistantBubble 已经会渲染 markdown + footer
          out.push({
            kind: 'assistant_text',
            id: `${m.id}_text`,
            text: m.text,
            sentAt: m.sentAt,
            ...(m.turnIndex !== undefined ? { turnIndex: m.turnIndex } : {}),
            ...(m.completed !== undefined ? { completed: m.completed } : {}),
          });
          pendingCluster.push({
            id: m.id,
            title: summarizeTools(tools, t),
            tools,
            ...(m.turnIndex !== undefined ? { turnIndex: m.turnIndex } : {}),
            syntheticTitle: true,
          });
        } else if (hasThinking && foldThinking) {
          // thinking-only step（只想了一下就调工具）：**不打断**，推理折进 sub-cluster。
          // 连续的 thinking→cmd→thinking→cmd 就并成一个 "Ran N commands"。
          pendingCluster.push({
            id: m.id,
            title: summarizeTools(tools, t),
            tools,
            ...(m.turnIndex !== undefined ? { turnIndex: m.turnIndex } : {}),
            syntheticTitle: true,
            thinking: m.thinking!,
          });
        } else {
          // thinking/verbose 视图：thinking 仍独立成行（默认展开），每个 step 各自成组。
          if (hasThinking) {
            flushCluster();
            out.push({
              kind: 'thinking',
              id: `${m.id}_thinking`,
              thinking: m.thinking!,
              ...(m.turnIndex !== undefined ? { turnIndex: m.turnIndex } : {}),
            });
          }
          pendingCluster.push({
            id: m.id,
            title: summarizeTools(tools, t),
            tools,
            ...(m.turnIndex !== undefined ? { turnIndex: m.turnIndex } : {}),
            syntheticTitle: true,
          });
        }
        i = j - 1; // 跳过 consumed tool_calls (for loop ++ 再 +1 到 j)
      } else {
        flushCluster();
        const hasThinking = Boolean(m.thinking && m.thinking.length > 0);
        const hasText = m.text.length > 0;
        if (hasThinking) {
          out.push({
            kind: 'thinking',
            id: `${m.id}_thinking`,
            thinking: m.thinking!,
            ...(m.turnIndex !== undefined ? { turnIndex: m.turnIndex } : {}),
          });
        }
        if (hasText && hasThinking) {
          out.push({
            kind: 'assistant_text',
            id: `${m.id}_text`,
            text: m.text,
            sentAt: m.sentAt,
            ...(m.turnIndex !== undefined ? { turnIndex: m.turnIndex } : {}),
            ...(m.completed !== undefined ? { completed: m.completed } : {}),
          });
        } else if (hasText || !hasThinking) {
          out.push(m);
        }
      }
      continue;
    }

    if (m.kind === 'tool_call') {
      const artifact = artifactMessageFromTool(m);
      if (artifact) {
        flushCluster();
        out.push(artifact);
        continue;
      }
      // 没前置 assistant_text 的 tool (罕见，首轮 thinking 直接出工具)：
      // 单独成一个 sub-cluster，标题用 tool 汇总（syntheticTitle=true）。
      pendingCluster.push({
        id: m.id,
        title: summarizeTools([m], t),
        tools: [m],
        syntheticTitle: true,
      });
    }
  }
  flushCluster();
  return out;
}

export function ConversationStreamV2(): JSX.Element {
  const { t } = useI18n();
  const isStreaming = useIsStreaming();
  const currentSessionId = useAppStore((s) => s.currentSessionId);
  const historyPaging = useSessionHistoryPaging(currentSessionId);
  const events = useAppStore((s) =>
    currentSessionId ? (s.eventsBySession[currentSessionId] ?? EMPTY_EVENTS) : EMPTY_EVENTS,
  );
  const userMessages = useAppStore((s) =>
    currentSessionId
      ? (s.userMessagesBySession[currentSessionId] ?? EMPTY_USER_MESSAGES)
      : EMPTY_USER_MESSAGES,
  );
  const queuedUserMessages = useAppStore((s) =>
    currentSessionId
      ? (s.queuedUserMessagesBySession[currentSessionId] ?? EMPTY_QUEUED_USER_MESSAGES)
      : EMPTY_QUEUED_USER_MESSAGES,
  );
  const localNotices = useAppStore((s) =>
    currentSessionId
      ? (s.localNoticesBySession[currentSessionId] ?? EMPTY_LOCAL_NOTICES)
      : EMPTY_LOCAL_NOTICES,
  );
  const workflowNotices = useAppStore((s) =>
    currentSessionId
      ? (s.workflowNoticesBySession[currentSessionId] ?? EMPTY_WORKFLOW_NOTICES)
      : EMPTY_WORKFLOW_NOTICES,
  );
  // 用来判断 "is this session loading history?" — persisted session 在 SDK summary
  // 有 msgCount > 0,而 in-memory buffer 还是空的 → history.IPC 在 flight,显示骨架更友好
  const currentSessionMsgCount = useAppStore((s) => {
    const sid = s.currentSessionId;
    if (!sid) return 0;
    return s.sessions.find((x) => x.sessionId === sid)?.msgCount ?? 0;
  });
  const transcriptFontSize = useAppStore((s) => s.transcriptFontSize);
  // 字号映射 — TranscriptViewMenu 的 sm / base / lg → Tailwind class
  const fontClass =
    transcriptFontSize === 'sm' ? 'text-xs' : transcriptFontSize === 'lg' ? 'text-base' : 'text-sm';

  // transcriptView 决定折叠策略（之前这个状态存了但渲染层从没读 → 4 个视图点了没反应）：
  //   normal   = 紧凑：thinking 折进工具组，cluster 默认折叠
  //   thinking = 突出推理：thinking 独立成行且默认展开，cluster 折叠
  //   verbose  = 全摊开：thinking + 工具卡全默认展开
  //   summary  = 只看结论：thinking / 工具组全部隐藏，只留 user / assistant 正文
  const transcriptView = useAppStore((s) => s.transcriptView);
  const composeCacheRef = useRef<ComposeMessagesCache | null>(null);
  const viewMessagesCacheRef = useRef<{
    readonly sessionId: string | null;
    readonly messages: readonly ViewMessage[];
  } | null>(null);
  const renderItemsCacheRef = useRef<{
    readonly sessionId: string | null;
    readonly items: readonly ConversationRenderItem[];
  } | null>(null);
  const thinkingTokenCacheRef = useRef<{
    sessionId: string | null;
    entries: Map<string, { readonly source: string; readonly tokens: number }>;
  }>({ sessionId: null, entries: new Map() });

  const messages = useMemo(() => {
    const cache = composeCacheRef.current;
    const inputsUnchangedExceptEvents =
      cache?.sessionId === currentSessionId &&
      cache.userMessages === userMessages &&
      cache.localNotices === localNotices &&
      cache.queuedUserMessages === queuedUserMessages &&
      cache.workflowNotices === workflowNotices;
    const nextMessages =
      inputsUnchangedExceptEvents && cache !== null
        ? (patchComposedStreamTail(cache.events, cache.messages, events) ??
          composeMessages({
            events,
            userMessages,
            localNotices,
            queuedUserMessages,
            workflowNotices,
            includeAuditLineage: false,
          }))
        : composeMessages({
            events,
            userMessages,
            localNotices,
            queuedUserMessages,
            workflowNotices,
            includeAuditLineage: false,
          });
    return nextMessages;
  }, [currentSessionId, events, userMessages, localNotices, queuedUserMessages, workflowNotices]);
  useLayoutEffect(() => {
    composeCacheRef.current = {
      sessionId: currentSessionId,
      events,
      userMessages,
      localNotices,
      queuedUserMessages,
      workflowNotices,
      messages,
    };
  }, [
    currentSessionId,
    events,
    userMessages,
    localNotices,
    queuedUserMessages,
    workflowNotices,
    messages,
  ]);
  const groupedProjection = useMemo(() => {
    const pendingTokenEntries = new Map<
      string,
      { readonly source: string; readonly tokens: number }
    >();
    const countThinkingTokens = (id: string, thinking: string): number => {
      const committed = thinkingTokenCacheRef.current;
      const cached =
        committed.sessionId === currentSessionId ? committed.entries.get(id) : undefined;
      if (cached?.source === thinking) return cached.tokens;
      const pending = pendingTokenEntries.get(id);
      if (pending?.source === thinking) return pending.tokens;
      const tokens = approxTokens(thinking);
      pendingTokenEntries.set(id, { source: thinking, tokens });
      return tokens;
    };
    const fresh = groupTools(messages, transcriptView, t, countThinkingTokens);
    const previous = viewMessagesCacheRef.current;
    const viewMessages =
      previous?.sessionId === currentSessionId
        ? retainStableViewMessages(previous.messages, fresh)
        : fresh;
    return { viewMessages, pendingTokenEntries };
  }, [messages, transcriptView, t, currentSessionId]);
  const viewMessages = groupedProjection.viewMessages;
  useLayoutEffect(() => {
    let cache = thinkingTokenCacheRef.current;
    if (cache.sessionId !== currentSessionId) {
      cache = { sessionId: currentSessionId, entries: new Map() };
      thinkingTokenCacheRef.current = cache;
    }
    for (const [id, entry] of groupedProjection.pendingTokenEntries) {
      if (cache.entries.size >= 2_500 && !cache.entries.has(id)) {
        const oldest = cache.entries.keys().next().value;
        if (oldest !== undefined) cache.entries.delete(oldest);
      }
      cache.entries.set(id, entry);
    }
    viewMessagesCacheRef.current = { sessionId: currentSessionId, messages: viewMessages };
  }, [currentSessionId, groupedProjection.pendingTokenEntries, viewMessages]);
  // summary 视图：滤掉 thinking 行和工具组，只保留对话正文。其余视图原样渲染。
  const displayMessages = useMemo(
    () =>
      transcriptView === 'summary'
        ? viewMessages.filter((m) => m.kind !== 'thinking' && m.kind !== 'tool_cluster')
        : viewMessages,
    [viewMessages, transcriptView],
  );
  const renderItems = useMemo(() => {
    const fresh = buildConversationRenderItems(displayMessages);
    const previous = renderItemsCacheRef.current;
    const stable =
      previous?.sessionId === currentSessionId
        ? retainStableRenderItems(previous.items, fresh)
        : fresh;
    return stable;
  }, [displayMessages, currentSessionId]);
  useLayoutEffect(() => {
    renderItemsCacheRef.current = { sessionId: currentSessionId, items: renderItems };
  }, [currentSessionId, renderItems]);
  const queryJumpAnchors = useMemo<readonly QueryJumpAnchor[]>(() => {
    const anchors: QueryJumpAnchor[] = [];
    for (const m of displayMessages) {
      if (m.kind !== 'user' && !(m.kind === 'local_notice' && m.variant === 'echo')) continue;
      const content = compactInlineText(m.content);
      if (!content) continue;
      anchors.push({ id: m.id, content, ordinal: anchors.length + 1 });
    }
    return anchors;
  }, [displayMessages]);
  const queryOwnerByRenderItemId = useMemo(() => {
    const anchorIds = new Set(queryJumpAnchors.map((anchor) => anchor.id));
    const owners = new Map<string, string>();
    let currentOwner: string | undefined;
    for (const item of renderItems) {
      if (item.kind === 'message' && anchorIds.has(item.message.id)) {
        currentOwner = item.message.id;
      }
      if (currentOwner !== undefined) owners.set(item.id, currentOwner);
    }
    return owners;
  }, [queryJumpAnchors, renderItems]);
  const showQueryJumpRail = queryJumpAnchors.length >= QUERY_JUMP_MIN_ANCHORS;
  // verbose 全展开工具组；thinking/verbose 默认展开独立 thinking 行。
  const clustersForceExpand = transcriptView === 'verbose';
  const thinkingForceExpand = transcriptView === 'thinking' || transcriptView === 'verbose';

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const wasAtBottomRef = useRef<boolean>(true);
  const viewportScrollAnchorRef = useRef<ViewportScrollAnchor | null>(null);
  const scrollSnapshotRef = useRef<ScrollSnapshot | null>(null);
  const observedScrollerSizeRef = useRef<{ width: number; height: number } | null>(null);
  const scrollerWasHiddenRef = useRef(false);
  const touchStartYRef = useRef<number | null>(null);
  const autoFollowRafRef = useRef<number | null>(null);
  const jumpToBottomRafRef = useRef<number | null>(null);
  const scrollSyncRafRef = useRef<number | null>(null);
  const prependAnchorRestoreRef = useRef<{
    readonly token: symbol;
    phase: 'loading' | 'restoring';
    rafId: number | null;
    snapshot: ScrollSnapshot;
    readonly scroller: HTMLDivElement;
  } | null>(null);
  const restoreScrollSnapshotRef = useRef<
    | ((
        scroller: HTMLDivElement,
        snapshot: ScrollSnapshot,
        missingAnchorFallback?: 'ratio' | 'older-window-seam',
      ) => boolean)
    | null
  >(null);
  const scheduleAutoFollowRef = useRef<((scroller: HTMLDivElement) => void) | null>(null);
  const scrollToBottomNowRef = useRef<
    ((scroller: HTMLDivElement, guardMs?: number) => void) | null
  >(null);
  const [showJumpToBottom, setShowJumpToBottom] = useState(false);
  const [activeQueryAnchorId, setActiveQueryAnchorId] = useState<string | null>(null);
  const [hoverQueryAnchorId, setHoverQueryAnchorId] = useState<string | null>(null);
  // 每个 tool_group 的展开状态；默认折叠
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // P4a: Ctrl+F 全 transcript 搜索 — Electron 自带 find-in-page 不接 renderer 上下文，
  // 自己实现"按消息文本子串匹配 + ring 高亮 + ↑↓ 导航"。
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [currentMatchIdx, setCurrentMatchIdx] = useState(0);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  // 全局 Ctrl+F 打开搜索框（焦点不在 input 也行）。BottomBar textarea 上 Ctrl+F
  // 默认就 no-op（Electron BrowserWindow 没有 native find），window 层 preventDefault 即可。
  // Esc 关闭并清空 query。
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        setSearchOpen(true);
        // focus 落到搜索框（下一帧，等 input 挂载）
        requestAnimationFrame(() => searchInputRef.current?.focus());
      }
      if (e.key === 'Escape' && searchOpen) {
        setSearchOpen(false);
        setSearchQuery('');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [searchOpen]);

  // 计算匹配的 message id 列表（按 displayMessages 顺序），用于 ring 高亮 + nav。
  // 必须用 displayMessages 而非 viewMessages：summary 视图滤掉了 thinking / tool_cluster，
  // 若仍按 viewMessages 索引会数到屏幕上根本不存在的 DOM 节点（计数虚高、跳转/高亮失效）。
  // 大小写不敏感；空 query → 空数组。
  const matchIds = useMemo<readonly string[]>(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return EMPTY_MATCH_IDS;
    const ids: string[] = [];
    for (const m of displayMessages) {
      let txt = '';
      switch (m.kind) {
        case 'user':
          txt = m.content;
          break;
        case 'queued_user':
          txt = m.content;
          break;
        case 'assistant_text':
          txt = m.text + (m.thinking ?? '');
          break;
        case 'system_notice':
          txt = m.text;
          break;
        case 'artifact':
          txt = [
            m.title,
            m.artifactKind,
            m.summary ?? '',
            m.artifactId ?? '',
            m.version !== undefined ? `v${m.version}` : '',
            m.status,
          ].join(' ');
          break;
        case 'tool_cluster':
          txt = m.subClusters
            .flatMap((sc) => [
              sc.title,
              sc.thinking ?? '',
              ...sc.tools.map(
                (t) => `${t.toolName} ${JSON.stringify(t.input ?? {})} ${t.result ?? ''}`,
              ),
            ])
            .join(' ');
          break;
      }
      if (txt.toLowerCase().includes(q)) ids.push(m.id);
    }
    return ids;
  }, [searchQuery, displayMessages]);

  const captureViewportScrollAnchor = useCallback(
    (scroller: HTMLDivElement): ViewportScrollAnchor | null => {
      const visibleNode = findMessageNodeNearViewportPoint(scroller, 0.42);
      if (!visibleNode) return null;
      // A tool/thinking receipt can be regrouped when the preceding page completes its turn, which
      // changes the receipt-cluster ID even though the conversation is unchanged. Prefer a normal
      // canonical message row in that case; those IDs are stable across page prepends.
      const visibleStableNode = visibleNode.closest<HTMLElement>(
        '[data-stable-scroll-anchor="true"]',
      );
      const nearestStableNode =
        visibleStableNode === null ? findNearbyStableScrollAnchor(scroller, visibleNode) : null;
      // Only the exceptional all-receipt fragment needs a global owner lookup. Ordinary message
      // scroll frames return above, and normal receipt seams find an adjacent stable row in <=32
      // steps, keeping the hot path independent of accumulated transcript length.
      const ownerId =
        visibleStableNode === null && nearestStableNode === null
          ? visibleNode.closest<HTMLElement>('[data-query-anchor-id]')?.dataset.queryAnchorId
          : undefined;
      const ownerNode = ownerId
        ? scroller.querySelector<HTMLElement>(`[data-msg-id="${CSS.escape(ownerId)}"]`)
        : null;
      const node = visibleStableNode ?? nearestStableNode ?? ownerNode ?? visibleNode;
      const id = node.dataset.msgId;
      if (!id) return null;
      const top = messageTopWithinScroller(scroller, node);
      return {
        id,
        offsetTop: top - scroller.scrollTop,
      };
    },
    [],
  );

  const rememberScrollSnapshot = useCallback(
    (scroller: HTMLDivElement): ScrollSnapshot => {
      const distance = getDistanceFromBottom(scroller);
      const atBottom = distance < BOTTOM_DISTANCE_PX;
      const anchor = atBottom ? null : captureViewportScrollAnchor(scroller);
      const snapshot: ScrollSnapshot = {
        scrollTop: scroller.scrollTop,
        scrollHeight: scroller.scrollHeight,
        clientHeight: scroller.clientHeight,
        anchor,
        atBottom,
      };
      viewportScrollAnchorRef.current = anchor;
      scrollSnapshotRef.current = snapshot;
      return snapshot;
    },
    [captureViewportScrollAnchor],
  );

  // query 变化时重置当前位置
  useEffect(() => {
    setCurrentMatchIdx(0);
  }, [searchQuery]);

  // 当前匹配滚到中间
  useEffect(() => {
    if (matchIds.length === 0) return;
    const id = matchIds[Math.min(currentMatchIdx, matchIds.length - 1)];
    const el = scrollRef.current?.querySelector(`[data-msg-id="${CSS.escape(id)}"]`);
    if (el && el instanceof HTMLElement) {
      const pendingPrepend = prependAnchorRestoreRef.current;
      const loadingPrepend = pendingPrepend?.phase === 'loading';
      el.scrollIntoView({ block: 'center', behavior: loadingPrepend ? 'auto' : 'smooth' });
      if (loadingPrepend && pendingPrepend.scroller === scrollRef.current) {
        pendingPrepend.snapshot = rememberScrollSnapshot(pendingPrepend.scroller);
      }
    }
  }, [currentMatchIdx, matchIds, rememberScrollSnapshot]);

  function nextMatch(): void {
    if (matchIds.length === 0) return;
    handlePrependUserScrollIntent();
    setCurrentMatchIdx((i) => (i + 1) % matchIds.length);
  }
  function prevMatch(): void {
    if (matchIds.length === 0) return;
    handlePrependUserScrollIntent();
    setCurrentMatchIdx((i) => (i - 1 + matchIds.length) % matchIds.length);
  }
  function closeSearch(): void {
    setSearchOpen(false);
    setSearchQuery('');
  }

  const currentMatchId = matchIds[Math.min(currentMatchIdx, matchIds.length - 1)];
  const matchSet = useMemo(() => new Set(matchIds), [matchIds]);

  // OC-18 markAuto guard：区分**程序滚动**和**用户滚动**。
  //
  // 之前的 bug 时序：
  //   1. ResizeObserver fires：内容增长 → 程序设 scrollTop = scrollHeight (跳到底)
  //   2. 几乎同时 ResizeObserver fires 又一次：又长了几像素 → 再设 scrollTop
  //   3. (1) 的 scroll 事件异步派发，此时已经到 (2) 状态，distanceFromBottom > 32
  //   4. handleScroll 误以为用户上滚了 → wasAtBottomRef.current = false
  //   5. 后续 observer 看到 false → 停止 follow → 屏幕卡在中间
  //
  // 守卫：程序滚动前记录 ignore-until，handleScroll 在窗口内跳过更新。
  // 用户真的上滚时无 timestamp / 已过期 → 正常处理。
  //
  // 时钟源：performance.now() 而非 Date.now() —— 后者随系统时钟可跳变 (NTP / DST)，
  //   监测短时间间隔 (<1s) 必须用单调 monotonic clock.
  // ResizeObserver 的 instant follow 只需要短守卫；jumpToBottom 的 smooth scroll 用 400ms。
  const programmaticScrollIgnoreUntilRef = useRef<number>(0);

  function markProgrammaticScroll(guardMs = INSTANT_PROGRAMMATIC_SCROLL_GUARD_MS): void {
    programmaticScrollIgnoreUntilRef.current = performance.now() + guardMs;
  }

  function clearProgrammaticScrollGuard(): void {
    programmaticScrollIgnoreUntilRef.current = 0;
  }

  function cancelJumpToBottomAnimation(): void {
    if (jumpToBottomRafRef.current === null) return;
    cancelAnimationFrame(jumpToBottomRafRef.current);
    jumpToBottomRafRef.current = null;
  }

  function cancelPrependAnchorRestore(): void {
    const active = prependAnchorRestoreRef.current;
    if (active?.rafId !== null && active?.rafId !== undefined) {
      cancelAnimationFrame(active.rafId);
    }
    prependAnchorRestoreRef.current = null;
  }

  function handlePrependUserScrollIntent(): void {
    const active = prependAnchorRestoreRef.current;
    if (active === null) return;
    // The continuation cannot be cancelled after dispatch without also preventing its DOM apply.
    // While it is in flight, real scroll events refresh the pending snapshot for either direction.
    // Once layout restoration starts, every new gesture wins and cancels the remaining RAFs.
    if (active.phase === 'loading') return;
    cancelPrependAnchorRestore();
  }

  function refreshPendingPrependSnapshot(scroller: HTMLDivElement): void {
    const pending = prependAnchorRestoreRef.current;
    if (pending?.phase === 'loading' && pending.scroller === scroller) {
      pending.snapshot = rememberScrollSnapshot(scroller);
    }
  }

  function scrollToBottomNow(
    scroller: HTMLDivElement,
    guardMs = INSTANT_PROGRAMMATIC_SCROLL_GUARD_MS,
  ): void {
    cancelJumpToBottomAnimation();
    handlePrependUserScrollIntent();
    markProgrammaticScroll(guardMs);
    scroller.scrollTop = scroller.scrollHeight;
    refreshPendingPrependSnapshot(scroller);
    viewportScrollAnchorRef.current = null;
    scrollSnapshotRef.current = null;
  }

  function restoreViewportScrollAnchor(
    scroller: HTMLDivElement,
    anchor = viewportScrollAnchorRef.current,
  ): boolean {
    if (!anchor) return false;
    const target = scroller.querySelector(`[data-msg-id="${CSS.escape(anchor.id)}"]`);
    if (!(target instanceof HTMLElement)) return false;

    const targetTop = messageTopWithinScroller(scroller, target);
    const maxTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
    const nextTop = Math.max(0, Math.min(maxTop, targetTop - anchor.offsetTop));
    markProgrammaticScroll();
    scroller.scrollTop = nextTop;
    // 恢复落点按距离实时判定追底：内容收缩或窗口拉高使落点 <阈值 时恢复追底。
    // 程序滚动的 scroll 事件被守卫吞掉，若这里无条件置 false 会形成"按钮隐藏+追底关闭"的稳态死区。
    wasAtBottomRef.current = maxTop - nextTop < BOTTOM_DISTANCE_PX;
    setShowJumpToBottom(maxTop - nextTop >= BOTTOM_DISTANCE_PX);
    syncActiveQueryAnchorFromScrollPosition(scroller);
    rememberScrollSnapshot(scroller);
    return true;
  }

  function restoreScrollSnapshot(
    scroller: HTMLDivElement,
    snapshot: ScrollSnapshot,
    missingAnchorFallback: 'ratio' | 'older-window-seam' = 'ratio',
  ): boolean {
    if (snapshot.atBottom) return false;
    if (restoreViewportScrollAnchor(scroller, snapshot.anchor)) return true;

    if (missingAnchorFallback === 'older-window-seam') {
      // A bounded older window can intentionally have no canonical row in common with the page
      // it replaces. The semantic seam is the bottom/newest edge of that older window, not the
      // same scroll-height ratio (which would jump a user loading at top to another arbitrary top).
      const nextMaxTop = olderHistoryWindowSeamScrollTop(
        scroller.scrollHeight,
        scroller.clientHeight,
      );
      markProgrammaticScroll();
      scroller.scrollTop = nextMaxTop;
      wasAtBottomRef.current = false;
      viewportScrollAnchorRef.current = captureViewportScrollAnchor(scroller);
      setShowJumpToBottom(false);
      syncActiveQueryAnchorFromScrollPosition(scroller);
      return true;
    }

    const previousMaxTop = Math.max(1, snapshot.scrollHeight - snapshot.clientHeight);
    const nextMaxTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
    const ratio = Math.max(0, Math.min(1, snapshot.scrollTop / previousMaxTop));
    const nextTop = Math.max(0, Math.min(nextMaxTop, nextMaxTop * ratio));
    markProgrammaticScroll();
    scroller.scrollTop = nextTop;
    wasAtBottomRef.current = nextMaxTop - nextTop < BOTTOM_DISTANCE_PX;
    setShowJumpToBottom(nextMaxTop - nextTop >= BOTTOM_DISTANCE_PX);
    syncActiveQueryAnchorFromScrollPosition(scroller);
    rememberScrollSnapshot(scroller);
    return true;
  }

  function animateJumpToBottom(scroller: HTMLDivElement): void {
    cancelJumpToBottomAnimation();

    const startTop = scroller.scrollTop;
    const initialTargetTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
    const distance = initialTargetTop - startTop;
    if (Math.abs(distance) < 2 || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      scrollToBottomNow(scroller, SMOOTH_PROGRAMMATIC_SCROLL_GUARD_MS);
      scrollSnapshotRef.current = null;
      wasAtBottomRef.current = true;
      setShowJumpToBottom(false);
      setActiveQueryAnchorId(queryJumpAnchors[queryJumpAnchors.length - 1]?.id ?? null);
      return;
    }

    const durationMs = Math.min(760, Math.max(260, Math.abs(distance) * 0.18));
    const startedAt = performance.now();
    const easeOutCubic = (t: number): number => 1 - Math.pow(1 - t, 3);

    const step = (now: number): void => {
      if (scrollRef.current !== scroller) {
        jumpToBottomRafRef.current = null;
        return;
      }

      const progress = Math.min(1, (now - startedAt) / durationMs);
      const eased = easeOutCubic(progress);
      const targetTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
      markProgrammaticScroll(120);
      scroller.scrollTop = startTop + (targetTop - startTop) * eased;

      if (progress < 1) {
        jumpToBottomRafRef.current = requestAnimationFrame(step);
        return;
      }

      jumpToBottomRafRef.current = null;
      markProgrammaticScroll(INSTANT_PROGRAMMATIC_SCROLL_GUARD_MS);
      scroller.scrollTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
      wasAtBottomRef.current = true;
      viewportScrollAnchorRef.current = null;
      scrollSnapshotRef.current = null;
      setShowJumpToBottom(false);
      setActiveQueryAnchorId(queryJumpAnchors[queryJumpAnchors.length - 1]?.id ?? null);
    };

    jumpToBottomRafRef.current = requestAnimationFrame(step);
  }

  function syncFollowStateFromScrollPosition(el: HTMLDivElement): void {
    const distance = getDistanceFromBottom(el);
    const atBottom = distance < BOTTOM_DISTANCE_PX;
    wasAtBottomRef.current = atBottom;
    rememberScrollSnapshot(el);
    setShowJumpToBottom(!atBottom);
  }

  function syncJumpButtonFromScrollPosition(el: HTMLDivElement): void {
    setShowJumpToBottom(getDistanceFromBottom(el) >= BOTTOM_DISTANCE_PX);
  }

  function syncActiveQueryAnchorFromScrollPosition(el: HTMLDivElement): void {
    if (!showQueryJumpRail) return;
    setActiveQueryAnchorId(findActiveQueryAnchorId(el, queryJumpAnchors));
  }

  function disengageFollowForUserScrollIntent(el: HTMLDivElement): void {
    wasAtBottomRef.current = false;
    rememberScrollSnapshot(el);
    syncJumpButtonFromScrollPosition(el);
    syncActiveQueryAnchorFromScrollPosition(el);
  }

  function syncFollowStateOnNextFrame(scroller: HTMLDivElement): void {
    requestAnimationFrame(() => {
      if (scrollRef.current !== scroller) return;
      syncFollowStateFromScrollPosition(scroller);
    });
  }

  function scheduleAutoFollow(scroller: HTMLDivElement): void {
    if (autoFollowRafRef.current !== null) return;
    autoFollowRafRef.current = requestAnimationFrame(() => {
      autoFollowRafRef.current = null;
      if (scrollRef.current !== scroller) return;
      if (!isDocumentActiveForAutoFollow()) return;
      if (jumpToBottomRafRef.current !== null) return;
      if (wasAtBottomRef.current) {
        scrollToBottomNow(scroller);
        setShowJumpToBottom(false);
      } else {
        syncJumpButtonFromScrollPosition(scroller);
      }
    });
  }

  restoreScrollSnapshotRef.current = restoreScrollSnapshot;
  scheduleAutoFollowRef.current = scheduleAutoFollow;
  scrollToBottomNowRef.current = scrollToBottomNow;

  function requestOlderHistoryAtCurrentAnchor(scroller: HTMLDivElement): void {
    if (
      currentSessionId === null ||
      !historyPaging.hasMore ||
      historyPaging.phase === 'loading' ||
      prependAnchorRestoreRef.current !== null
    ) {
      return;
    }
    const requestedSessionId = currentSessionId;
    const token = Symbol(`prepend-anchor:${requestedSessionId}`);
    const restoreState: {
      readonly token: symbol;
      phase: 'loading' | 'restoring';
      rafId: number | null;
      snapshot: ScrollSnapshot;
      readonly scroller: HTMLDivElement;
    } = {
      token,
      phase: 'loading',
      rafId: null,
      snapshot: rememberScrollSnapshot(scroller),
      scroller,
    };
    prependAnchorRestoreRef.current = restoreState;
    wasAtBottomRef.current = false;
    void loadOlderSessionHistory(requestedSessionId)
      .then(() => {
        if (prependAnchorRestoreRef.current?.token !== token) return;
        const snapshot = restoreState.snapshot;
        restoreState.phase = 'restoring';
        let layoutWaitFrames = 2;
        const correctionFrames =
          snapshot.anchor === null && !snapshot.atBottom
            ? ([0] as const)
            : PREPEND_ANCHOR_CORRECTION_FRAME_OFFSETS;
        let settleFrame = 0;
        const restoreAfterLayout = (): void => {
          restoreState.rafId = null;
          if (
            prependAnchorRestoreRef.current?.token !== token ||
            scrollRef.current !== scroller ||
            useAppStore.getState().currentSessionId !== requestedSessionId
          ) {
            if (prependAnchorRestoreRef.current?.token === token) cancelPrependAnchorRestore();
            return;
          }
          if (layoutWaitFrames > 0) {
            layoutWaitFrames -= 1;
            restoreState.rafId = requestAnimationFrame(restoreAfterLayout);
            return;
          }
          if (correctionFrames.some((frame) => frame === settleFrame)) {
            // `content-visibility` can replace intrinsic estimates only after the first restored
            // scroll exposes the seam. Re-apply the original canonical anchor at sparse checkpoints
            // across a bounded settling window so delayed corrections cannot move the user's view.
            if (snapshot.atBottom) {
              markProgrammaticScroll();
              scroller.scrollTop = scroller.scrollHeight;
              wasAtBottomRef.current = true;
              viewportScrollAnchorRef.current = null;
              scrollSnapshotRef.current = null;
              setShowJumpToBottom(false);
            } else {
              restoreScrollSnapshotRef.current?.(scroller, snapshot, 'older-window-seam');
            }
          }
          const finalSettleFrame = correctionFrames[correctionFrames.length - 1];
          if (settleFrame < finalSettleFrame) {
            settleFrame += 1;
            restoreState.rafId = requestAnimationFrame(restoreAfterLayout);
          } else {
            prependAnchorRestoreRef.current = null;
          }
        };
        restoreState.rafId = requestAnimationFrame(restoreAfterLayout);
      })
      .catch(() => {
        if (prependAnchorRestoreRef.current?.token === token) cancelPrependAnchorRestore();
        // The paging state records the failure. Keep the current stable window visible.
      });
  }

  function handleScroll(e: React.UIEvent<HTMLDivElement>): void {
    // 守卫期内的 scroll 事件来自 ResizeObserver / smooth scroll 自己的 scrollTop 赋值，
    // 不视为用户上滚
    if (performance.now() < programmaticScrollIgnoreUntilRef.current) return;
    const scroller = e.currentTarget;
    if (scrollSyncRafRef.current !== null) return;
    scrollSyncRafRef.current = requestAnimationFrame(() => {
      scrollSyncRafRef.current = null;
      if (scrollRef.current !== scroller) return;
      if (performance.now() < programmaticScrollIgnoreUntilRef.current) return;
      // Freeze at the user's latest real position, not the threshold position where the async
      // request happened to start. The snapshot becomes immutable when phase turns restoring.
      refreshPendingPrependSnapshot(scroller);
      syncFollowStateFromScrollPosition(scroller);
      syncActiveQueryAnchorFromScrollPosition(scroller);
      if (scroller.scrollTop <= HISTORY_LOAD_THRESHOLD_PX) {
        requestOlderHistoryAtCurrentAnchor(scroller);
      }
    });
  }

  function handleWheel(e: ReactWheelEvent<HTMLDivElement>): void {
    const nestedScroller =
      e.target instanceof Element ? e.target.closest<HTMLElement>('[data-scrollcapbox]') : null;
    if (
      nestedScroller &&
      ((e.deltaY < 0 && nestedScroller.scrollTop > 1) ||
        (e.deltaY > 0 &&
          nestedScroller.scrollTop + nestedScroller.clientHeight < nestedScroller.scrollHeight - 1))
    ) {
      // The nested block consumes this gesture. The transcript itself has not
      // moved, so this must not disengage transcript auto-follow.
      return;
    }
    cancelJumpToBottomAnimation();
    clearProgrammaticScrollGuard();
    const scroller = e.currentTarget;
    const deltaY = e.deltaY;
    const scrollTopBefore = scroller.scrollTop;
    const preserveBoundaryRestore = preservesPrependAnchorForBoundaryInput(
      prependAnchorRestoreRef.current?.phase,
      deltaY < 0,
      scrollTopBefore,
    );
    if (deltaY !== 0 && !preserveBoundaryRestore) handlePrependUserScrollIntent();

    if (deltaY < 0 && scrollTopBefore > 0) {
      disengageFollowForUserScrollIntent(scroller);
    } else if (deltaY < 0 && scrollTopBefore <= HISTORY_LOAD_THRESHOLD_PX) {
      requestOlderHistoryAtCurrentAnchor(scroller);
    }

    requestAnimationFrame(() => {
      if (scrollRef.current !== scroller) return;
      if (deltaY < 0) {
        const movedUp = scroller.scrollTop < scrollTopBefore;
        const leftBottom = getDistanceFromBottom(scroller) >= BOTTOM_DISTANCE_PX;
        if (!movedUp && !leftBottom && scrollTopBefore <= 0) return;
        disengageFollowForUserScrollIntent(scroller);
      } else if (deltaY > 0) {
        syncFollowStateFromScrollPosition(scroller);
      }
    });
  }

  function handleKeyDown(e: ReactKeyboardEvent<HTMLDivElement>): void {
    cancelJumpToBottomAnimation();
    const scroller = e.currentTarget;
    switch (e.key) {
      case 'ArrowUp':
      case 'PageUp':
      case 'Home':
        if (
          !preservesPrependAnchorForBoundaryInput(
            prependAnchorRestoreRef.current?.phase,
            true,
            scroller.scrollTop,
          )
        ) {
          handlePrependUserScrollIntent();
        }
        disengageFollowForUserScrollIntent(scroller);
        break;
      case ' ':
        if (e.shiftKey) {
          if (
            !preservesPrependAnchorForBoundaryInput(
              prependAnchorRestoreRef.current?.phase,
              true,
              scroller.scrollTop,
            )
          ) {
            handlePrependUserScrollIntent();
          }
          disengageFollowForUserScrollIntent(scroller);
        } else {
          handlePrependUserScrollIntent();
          syncFollowStateOnNextFrame(scroller);
        }
        break;
      case 'ArrowDown':
      case 'PageDown':
      case 'End':
        handlePrependUserScrollIntent();
        syncFollowStateOnNextFrame(scroller);
        break;
    }
  }

  function handlePointerDown(e: ReactPointerEvent<HTMLDivElement>): void {
    cancelJumpToBottomAnimation();
    const scroller = e.currentTarget;
    const scrollbarWidth = scroller.offsetWidth - scroller.clientWidth;
    if (scrollbarWidth <= 0) return;
    const rect = scroller.getBoundingClientRect();
    if (e.clientX >= rect.right - scrollbarWidth) {
      handlePrependUserScrollIntent();
      disengageFollowForUserScrollIntent(scroller);
    }
  }

  function handleTouchStart(e: ReactTouchEvent<HTMLDivElement>): void {
    cancelJumpToBottomAnimation();
    touchStartYRef.current = e.touches[0]?.clientY ?? null;
  }

  function handleTouchMove(e: ReactTouchEvent<HTMLDivElement>): void {
    const scroller = e.currentTarget;
    const startY = touchStartYRef.current;
    const currentY = e.touches[0]?.clientY;
    if (startY === null || currentY === undefined) return;
    const deltaY = currentY - startY;
    if (deltaY > USER_SCROLL_INTENT_DELTA_PX) {
      if (
        !preservesPrependAnchorForBoundaryInput(
          prependAnchorRestoreRef.current?.phase,
          true,
          scroller.scrollTop,
        )
      ) {
        handlePrependUserScrollIntent();
      }
      disengageFollowForUserScrollIntent(scroller);
    } else if (deltaY < -USER_SCROLL_INTENT_DELTA_PX) {
      handlePrependUserScrollIntent();
      syncFollowStateOnNextFrame(scroller);
    }
  }

  // ResizeObserver 是真正的 sticky-bottom 实现：
  // 流式 assistant_chunk 来时 message length 不变（在同一 bubble 上累积 text），
  // 之前用 useLayoutEffect([viewMessages.length]) 不触发滚动。
  //
  // 必须 observe 一个**包裹所有内容的 inner wrapper**——之前 observe firstElementChild
  // (= 第一条 message) 在新消息追加时其高度根本不变 → observer 不触发 → spinner 看着
  // 像没追底。contentRef 指向 wrapper，它的高度=所有消息累加，无论是 list 长度变化还是
  // 单 bubble 文字累积都会触发。
  useEffect(() => {
    const scroller = scrollRef.current;
    const content = contentRef.current;
    if (!scroller || !content) return;
    observedScrollerSizeRef.current = {
      width: scroller.clientWidth,
      height: scroller.clientHeight,
    };
    const ro = new ResizeObserver(() => {
      if (!isDocumentActiveForAutoFollow()) return;
      const previousSize = observedScrollerSizeRef.current;
      const nextSize = {
        width: scroller.clientWidth,
        height: scroller.clientHeight,
      };
      // Max Task Dock mode keeps the conversation mounted but hides its parent. Restoring a
      // snapshot against the resulting 0x0 viewport clamps scrollTop to zero, then later
      // treats that zero-sized snapshot as being at the bottom. Keep the last visible
      // snapshot intact and restore it once the conversation has dimensions again.
      if (nextSize.width === 0 || nextSize.height === 0) {
        scrollerWasHiddenRef.current = true;
        return;
      }
      const restoredFromHidden = scrollerWasHiddenRef.current;
      scrollerWasHiddenRef.current = false;
      observedScrollerSizeRef.current = nextSize;
      const viewportResized =
        restoredFromHidden ||
        (previousSize !== null &&
          (Math.abs(previousSize.width - nextSize.width) > 1 ||
            Math.abs(previousSize.height - nextSize.height) > 1));

      const snapshot = scrollSnapshotRef.current;
      if (viewportResized && snapshot && !snapshot.atBottom) {
        requestAnimationFrame(() => {
          if (scrollRef.current !== scroller) return;
          restoreScrollSnapshotRef.current?.(scroller, snapshot);
        });
        return;
      }

      scheduleAutoFollowRef.current?.(scroller);
    });
    // Composer growth shrinks the scroller without changing message content height.
    ro.observe(scroller);
    ro.observe(content);
    return () => {
      ro.disconnect();
      if (autoFollowRafRef.current !== null) {
        cancelAnimationFrame(autoFollowRafRef.current);
        autoFollowRafRef.current = null;
      }
      if (scrollSyncRafRef.current !== null) {
        cancelAnimationFrame(scrollSyncRafRef.current);
        scrollSyncRafRef.current = null;
      }
      cancelJumpToBottomAnimation();
    };
  }, [currentSessionId]);

  useEffect(() => {
    const catchUpAfterFocus = (): void => {
      if (!isDocumentActiveForAutoFollow()) return;
      const scroller = scrollRef.current;
      if (!scroller) return;
      if (wasAtBottomRef.current) scheduleAutoFollowRef.current?.(scroller);
      else syncJumpButtonFromScrollPosition(scroller);
    };
    window.addEventListener('focus', catchUpAfterFocus);
    document.addEventListener('visibilitychange', catchUpAfterFocus);
    return () => {
      window.removeEventListener('focus', catchUpAfterFocus);
      document.removeEventListener('visibilitychange', catchUpAfterFocus);
    };
  }, [currentSessionId]);

  useEffect(() => {
    cancelPrependAnchorRestore();
    if (scrollRef.current) {
      scrollToBottomNowRef.current?.(scrollRef.current);
      wasAtBottomRef.current = true;
      setShowJumpToBottom(false);
      setExpanded(new Set());
    }
    return () => cancelPrependAnchorRestore();
  }, [currentSessionId]);

  useEffect(() => {
    if (!showQueryJumpRail) {
      setActiveQueryAnchorId(null);
      setHoverQueryAnchorId(null);
      return;
    }

    const scroller = scrollRef.current;
    const fallbackId = queryJumpAnchors[queryJumpAnchors.length - 1]?.id ?? null;
    if (!scroller || wasAtBottomRef.current) {
      setActiveQueryAnchorId(fallbackId);
      return;
    }
    setActiveQueryAnchorId(findActiveQueryAnchorId(scroller, queryJumpAnchors));
  }, [currentSessionId, queryJumpAnchors, showQueryJumpRail]);

  function jumpToBottom(): void {
    const scroller = scrollRef.current;
    if (!scroller) return;
    handlePrependUserScrollIntent();
    if (prependAnchorRestoreRef.current?.phase === 'loading') {
      scrollToBottomNow(scroller);
      wasAtBottomRef.current = true;
      setShowJumpToBottom(false);
      setActiveQueryAnchorId(queryJumpAnchors[queryJumpAnchors.length - 1]?.id ?? null);
      return;
    }
    markProgrammaticScroll(SMOOTH_PROGRAMMATIC_SCROLL_GUARD_MS);
    wasAtBottomRef.current = true;
    viewportScrollAnchorRef.current = null;
    setShowJumpToBottom(false);
    setActiveQueryAnchorId(queryJumpAnchors[queryJumpAnchors.length - 1]?.id ?? null);
    animateJumpToBottom(scroller);
  }

  function returnToNewestHistory(): void {
    if (!currentSessionId) return;
    // This replaces the paging lifecycle token, so the stale continuation cannot apply data.
    // Its viewport RAF must be fenced independently before the newest request starts.
    cancelPrependAnchorRestore();
    const session = useAppStore
      .getState()
      .sessions.find((candidate) => candidate.sessionId === currentSessionId);
    const surface = session?.surface ?? useSurfaceStore.getState().currentSurface;
    void restoreNewestSessionHistory(currentSessionId, surface)
      .then(() => {
        const scroller = scrollRef.current;
        if (scroller) scrollToBottomNow(scroller);
      })
      .catch(() => pushToast(t('conversation.historyLoadFailed'), 'error'));
  }

  function jumpToQueryAnchor(id: string): void {
    const scroller = scrollRef.current;
    if (!scroller) return;
    handlePrependUserScrollIntent();
    const target = scroller.querySelector(`[data-msg-id="${CSS.escape(id)}"]`);
    if (!(target instanceof HTMLElement)) return;

    const maxTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
    const targetTop = messageTopWithinScroller(scroller, target);
    const top = Math.max(0, Math.min(maxTop, targetTop - QUERY_JUMP_TOP_PADDING_PX));
    markProgrammaticScroll(SMOOTH_PROGRAMMATIC_SCROLL_GUARD_MS);
    wasAtBottomRef.current = maxTop - top < BOTTOM_DISTANCE_PX;
    const anchor = wasAtBottomRef.current ? null : { id, offsetTop: targetTop - top };
    viewportScrollAnchorRef.current = anchor;
    scrollSnapshotRef.current = {
      scrollTop: top,
      scrollHeight: scroller.scrollHeight,
      clientHeight: scroller.clientHeight,
      anchor,
      atBottom: wasAtBottomRef.current,
    };
    setShowJumpToBottom(maxTop - top >= BOTTOM_DISTANCE_PX);
    setActiveQueryAnchorId(id);
    const loadingPrepend = prependAnchorRestoreRef.current?.phase === 'loading';
    scroller.scrollTo({ top, behavior: loadingPrepend ? 'auto' : 'smooth' });
    if (loadingPrepend) refreshPendingPrependSnapshot(scroller);
  }

  const toggleGroup = useCallback((id: string): void => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const forkFromTurn = useCallback(
    async (turnIndex: number): Promise<void> => {
      if (!currentSessionId || !window.kodaxSpace) return;
      const state = useAppStore.getState();
      const session = state.sessions.find((s) => s.sessionId === currentSessionId);
      if (!session) return;
      const userMsgs = state.userMessagesBySession[currentSessionId] ?? [];
      const selectorIndexes = selectorTurnIndexesByMessageId(userMsgs);
      const selectedMessage = userMsgs.find(
        (message) => selectorIndexes.get(message.id) === turnIndex,
      );
      const localNoticeCutoffSentAt = localNoticeCutoffSentAtForSelectorTurn(userMsgs, turnIndex);
      if (session.surface === 'code' && selectedMessage?.historyBoundary === undefined) {
        pushToast(t('session.historyBoundaryUnavailable'), 'warning');
        return;
      }
      const forkPointTurnIdx = Math.max(0, turnIndex);
      const r = await window.kodaxSpace.invoke('session.fork', {
        sessionId: currentSessionId,
        forkPointTurnIdx,
        ...(selectedMessage?.historyBoundary !== undefined
          ? { historyBoundary: selectedMessage.historyBoundary }
          : {}),
        ...(localNoticeCutoffSentAt !== undefined ? { localNoticeCutoffSentAt } : {}),
      });
      if (!r.ok) {
        pushToast(
          t('menu.session.forkFailed', {
            message: r.error?.message ?? t('common.unknownError'),
          }),
          'error',
        );
        return;
      }

      const childTitle =
        session.title !== undefined
          ? `${session.title.replace(/( \(fork\))+$/, '')} (fork)`
          : t('menu.session.forkedTitle');
      const childSession: SessionMeta = {
        sessionId: r.data.newSessionId,
        projectRoot: session.projectRoot,
        provider: session.provider,
        reasoningMode: session.reasoningMode,
        permissionMode: session.permissionMode,
        autoModeEngine: session.autoModeEngine,
        agentMode: session.agentMode,
        surface: session.surface,
        title: childTitle,
        createdAt: r.data.createdAt,
        lastActivityAt: r.data.createdAt,
        parentSessionId: currentSessionId,
        forkPointTurnIdx,
      };
      state.upsertSession(childSession);
      state.forkSessionBuffers(currentSessionId, r.data.newSessionId, forkPointTurnIdx);
      const latest = useAppStore.getState();
      const latestSurface = useSurfaceStore.getState().currentSurface;
      if (
        shouldActivateSessionForCurrentScope(childSession, {
          currentProjectPath: latest.currentProjectPath,
          currentSurface: latestSurface,
        })
      ) {
        latest.setCurrentSession(r.data.newSessionId);
      }
    },
    [currentSessionId, t],
  );

  const rewindToTurn = useCallback(
    async (turnIndex: number): Promise<void> => {
      if (!currentSessionId || !window.kodaxSpace) return;
      const state = useAppStore.getState();
      const session = state.sessions.find((candidate) => candidate.sessionId === currentSessionId);
      if (!session) return;
      const userMsgs = state.userMessagesBySession[currentSessionId] ?? [];
      if (turnIndex < 0 || !canRewindSelectorTurn(userMsgs, turnIndex)) return;
      const selectorIndexes = selectorTurnIndexesByMessageId(userMsgs);
      const selectedMessage = userMsgs.find(
        (message) => selectorIndexes.get(message.id) === turnIndex,
      );
      if (session.surface === 'code' && selectedMessage?.historyBoundary === undefined) {
        pushToast(t('session.historyBoundaryUnavailable'), 'warning');
        return;
      }

      const confirmed = await requestConfirm({
        title: t('menu.session.rewindToTurnTitle'),
        message: t('menu.session.rewindToTurnMessage', { turn: String(turnIndex + 1) }),
        confirmLabel: t('menu.session.rewindToTurnConfirm'),
        danger: true,
      });
      if (!confirmed) return;

      const r = await window.kodaxSpace.invoke('session.rewind', {
        sessionId: currentSessionId,
        rewindPastTurnIdx: turnIndex,
        ...(selectedMessage?.historyBoundary !== undefined
          ? { historyBoundary: selectedMessage.historyBoundary }
          : {}),
      });
      if (!r.ok) {
        pushToast(
          t('menu.session.rewindFailed', {
            message: r.error?.message ?? t('common.unknownError'),
          }),
          'error',
        );
        return;
      }
      if (!r.data.ok || r.data.diskRewound === false) {
        pushToast(
          t('menu.session.rewindRejected', {
            message: r.data.reason ?? 'disk history was not rewound',
          }),
          'error',
        );
        return;
      }
      state.rewindSessionBuffers(currentSessionId, turnIndex);
    },
    [currentSessionId, t],
  );

  if (!currentSessionId) {
    return <WelcomeDashboard />;
  }

  return (
    <div className="relative flex-1 overflow-hidden" data-testid="conversation-stream">
      <div
        ref={scrollRef}
        data-testid="conversation-scroll-container"
        onScroll={handleScroll}
        onWheelCapture={handleWheel}
        onKeyDownCapture={handleKeyDown}
        onPointerDownCapture={handlePointerDown}
        onTouchStartCapture={handleTouchStart}
        onTouchMoveCapture={handleTouchMove}
        className={`ix-zone h-full overflow-auto px-8 py-5 ${fontClass}`}
      >
        {/* 左右只留几个字符的 padding，不限宽 —— 用户反馈 max-w-3xl 在宽屏留太多空白。
            左侧保留 transcript timeline marker，query jump rail 独立悬浮在更靠左的位置。*/}
        <div ref={contentRef} className="relative pl-10 sm:pl-12">
          {renderItems.length > 0 && (
            <div
              className="absolute left-[20px] top-2 bottom-2 w-px bg-border-default/55 sm:left-[28px]"
              aria-hidden
            />
          )}
          <div className="space-y-3">
            {displayMessages.length === 0 &&
              (historyPaging.phase === 'error' && historyPaging.runtimeUnavailable === true ? (
                // Runtime 不可用导致正文读不到:重试已终止。明确告知文件未损坏,避免被当成空白/损坏。
                <div
                  className="text-fg-faint text-sm"
                  role="status"
                  data-testid="history-runtime-unavailable"
                >
                  {t('conversation.historyRuntimeUnavailable')}
                </div>
              ) : currentSessionMsgCount > 0 ? (
                // 有 SDK summary msgCount 但 buffer 空 → history IPC 正在 flight,显示骨架
                // 比 "Send a prompt to start" 更准确,也免去用户盯着空白屏幕等几百毫秒
                <HistoryRestoreSkeleton />
              ) : (
                <div className="text-fg-faint italic text-sm">{t('conversation.emptyPrompt')}</div>
              ))}
            {renderItems.map((item, index) => (
              <ConversationRenderRow
                key={item.id}
                item={item}
                index={index}
                animateEntry={index >= renderItems.length - RESTORED_REVEAL_TAIL_ITEMS}
                liveTail={isStreaming && index === renderItems.length - 1}
                queryOwnerId={queryOwnerByRenderItemId.get(item.id)}
                expanded={expanded}
                clustersForceExpand={clustersForceExpand}
                thinkingForceExpand={thinkingForceExpand}
                currentMatchId={currentMatchId}
                matchSet={matchSet}
                userMessages={userMessages}
                onToggle={toggleGroup}
                onForkTurn={forkFromTurn}
                onRewindTurn={rewindToTurn}
              />
            ))}
            {/* 流式 spinner —— v0.1.4：从 BottomBar 搬到这里，把"正在做什么"
            放在对话流末尾。ActivitySpinner 自己 return null 时本块也不渲染。 */}
            <StreamingSpinnerRow />
          </div>
        </div>
      </div>

      {showQueryJumpRail && (
        <QueryJumpRail
          anchors={queryJumpAnchors}
          activeId={activeQueryAnchorId}
          hoverId={hoverQueryAnchorId}
          onHover={setHoverQueryAnchorId}
          onJump={jumpToQueryAnchor}
        />
      )}

      {/* P4a 搜索框 — 右上角浮窗 */}
      {searchOpen && (
        <div className="absolute top-2 right-4 z-30 flex items-center gap-1 bg-surface-2 border border-border-strong rounded shadow-xl px-2 py-1">
          <input
            ref={searchInputRef}
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                if (e.shiftKey) prevMatch();
                else nextMatch();
              } else if (e.key === 'Escape') {
                e.preventDefault();
                closeSearch();
              }
            }}
            placeholder={t('conversation.searchPlaceholder')}
            className="bg-transparent text-xs outline-none w-44 text-fg-primary placeholder:text-fg-muted"
          />
          <span className="text-[11px] text-fg-muted font-mono w-12 text-right select-none">
            {searchQuery
              ? matchIds.length === 0
                ? '0/0'
                : `${currentMatchIdx + 1}/${matchIds.length}`
              : ''}
          </span>
          <button
            type="button"
            onClick={prevMatch}
            disabled={matchIds.length === 0}
            className="text-fg-muted hover:text-fg-primary px-1 disabled:opacity-30"
            title={t('conversation.previousMatchTitle')}
            aria-label={t('conversation.previousMatch')}
          >
            ↑
          </button>
          <button
            type="button"
            onClick={nextMatch}
            disabled={matchIds.length === 0}
            className="text-fg-muted hover:text-fg-primary px-1 disabled:opacity-30"
            title={t('conversation.nextMatchTitle')}
            aria-label={t('conversation.nextMatch')}
          >
            ↓
          </button>
          <button
            type="button"
            onClick={closeSearch}
            className="text-fg-muted hover:text-fg-primary px-1"
            title={t('conversation.closeSearchTitle')}
            aria-label={t('conversation.closeSearch')}
          >
            ✕
          </button>
        </div>
      )}

      {/* 跳到底：对标 Codex —— 悬浮圆形 chevron。用 surface-4（float 浮层级：浅色纯白 / 深色提亮灰）
          + .lift 柔影，明确浮在对话流之上，深浅两色都清晰可见（旧用 surface-3 在深色里几乎隐形）。
          chevron 用 2.5 描边补足「细 V 不够显眼」；hover 时 outline 微光环（用 outline 不用 ring，
          避免和 .lift 的 box-shadow 抢同一属性、hover 反而丢掉浮影）。
          外层 div 负责居中定位，内层 button 的 .ix-pop 悬停缩放不和居中 translate 打架。 */}
      {historyPaging.hasNewer === true && (
        <button
          type="button"
          onClick={returnToNewestHistory}
          className="absolute bottom-14 left-1/2 z-10 -translate-x-1/2 rounded-full border border-border-default bg-surface-4 px-3 py-1.5 text-xs text-fg-secondary lift hover:text-fg-primary"
        >
          {t('conversation.returnToNewest')}
        </button>
      )}
      {showJumpToBottom && (
        <div className="reveal-marker absolute bottom-4 left-1/2 -ml-4 z-10">
          <button
            type="button"
            onClick={jumpToBottom}
            aria-label={t('conversation.jumpToBottom')}
            title={t('conversation.jumpToBottom')}
            className="ix-pop w-8 h-8 rounded-full flex items-center justify-center bg-surface-4 border border-border-default lift text-fg-secondary hover:text-fg-primary hover:outline hover:outline-2 hover:outline-offset-2 hover:outline-border-strong"
          >
            <ChevronDown className="w-4 h-4" strokeWidth={2.5} aria-hidden />
          </button>
        </div>
      )}
    </div>
  );
}

interface QueryJumpRailProps {
  anchors: readonly QueryJumpAnchor[];
  activeId: string | null;
  hoverId: string | null;
  onHover: (id: string | null) => void;
  onJump: (id: string) => void;
}

function queryAnchorMetrics(
  index: number,
  hoverIndex: number | null,
  active: boolean,
): { width: number; opacity: number } {
  if (hoverIndex === null) return { width: active ? 7 : 5, opacity: active ? 0.72 : 0.26 };

  const distance = Math.abs(index - hoverIndex);
  if (distance === 0) return { width: 27, opacity: 0.95 };
  if (distance === 1) return { width: 22, opacity: 0.76 };
  if (distance === 2) return { width: 16, opacity: 0.56 };
  if (distance === 3) return { width: 11, opacity: 0.4 };
  if (distance === 4) return { width: 7, opacity: 0.3 };
  return { width: 5, opacity: 0.22 };
}

function QueryJumpRail({
  anchors,
  activeId,
  hoverId,
  onHover,
  onJump,
}: QueryJumpRailProps): JSX.Element | null {
  const { t } = useI18n();
  if (anchors.length < QUERY_JUMP_MIN_ANCHORS) return null;

  const rawHoverIndex = anchors.findIndex((anchor) => anchor.id === hoverId);
  const hoverIndex = rawHoverIndex >= 0 ? rawHoverIndex : null;

  return (
    <nav
      className="absolute left-3 top-1/2 z-20 -translate-y-1/2"
      aria-label={t('conversation.queryJumpPoints')}
      onMouseLeave={() => onHover(null)}
    >
      <div className="flex flex-col items-start gap-1 py-2">
        {anchors.map((anchor, index) => {
          const isActive = anchor.id === activeId;
          const isHovered = anchor.id === hoverId;
          const metrics = queryAnchorMetrics(index, hoverIndex, isActive);
          const previewTitle = truncateText(anchor.content, QUERY_JUMP_TITLE_CHARS);
          const previewBody = truncateText(anchor.content, QUERY_JUMP_BODY_CHARS);
          return (
            <button
              key={anchor.id}
              type="button"
              aria-label={`Jump to query ${anchor.ordinal}`}
              aria-current={anchor.id === activeId ? 'location' : undefined}
              onClick={() => onJump(anchor.id)}
              onFocus={() => onHover(anchor.id)}
              onBlur={() => onHover(null)}
              onMouseEnter={() => onHover(anchor.id)}
              className="group relative flex h-2.5 w-12 items-center justify-start rounded-sm outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-strong"
            >
              <span
                className={[
                  'h-px rounded-full transition-all duration-150 ease-out',
                  isHovered || isActive ? 'bg-fg-primary' : 'bg-fg-muted group-hover:bg-fg-primary',
                ].join(' ')}
                style={{ width: `${metrics.width}px`, opacity: metrics.opacity }}
                aria-hidden
              />
              {isHovered && (
                <span className="pointer-events-none absolute left-12 top-1/2 z-30 w-80 max-w-[calc(100vw-7rem)] -translate-y-1/2 rounded-lg border border-border-default bg-surface-2/95 px-3 py-2 text-left shadow-2xl backdrop-blur">
                  <span className="block truncate text-[13px] font-semibold leading-5 text-fg-primary">
                    {previewTitle}
                  </span>
                  <span className="mt-0.5 block line-clamp-2 text-[12px] leading-5 text-fg-muted">
                    {previewBody}
                  </span>
                  <span className="mt-1.5 block font-mono text-[11px] leading-4 text-fg-faint">
                    #{anchor.ordinal}
                  </span>
                </span>
              )}
            </button>
          );
        })}
      </div>
    </nav>
  );
}

function searchRingClassFor(
  id: string,
  currentMatchId: string | undefined,
  matchSet: ReadonlySet<string>,
): string {
  if (currentMatchId === id) return 'ring-2 ring-warn/80 rounded-md';
  if (matchSet.has(id)) return 'ring-1 ring-warn/40 rounded-md';
  return '';
}

function ProcessReceiptRow({
  receipts,
  followTail,
  expanded,
  clustersForceExpand,
  thinkingForceExpand,
  currentMatchId,
  matchSet,
  onToggle,
}: {
  receipts: readonly ProcessReceiptMessage[];
  followTail: boolean;
  expanded: ReadonlySet<string>;
  clustersForceExpand: boolean;
  thinkingForceExpand: boolean;
  currentMatchId: string | undefined;
  matchSet: ReadonlySet<string>;
  onToggle: (id: string) => void;
}): JSX.Element | null {
  if (receipts.length === 0) return null;
  // Expanded tool clusters grow below their summary. Keep sibling receipts anchored to that
  // summary line instead of vertically centering them against the expanded tool details.
  return (
    <div
      className="flex min-w-0 max-w-full flex-wrap content-start items-start gap-1.5 overflow-visible py-px"
      data-testid="process-receipt-row"
    >
      {receipts.map((receipt) => {
        const ringClass = searchRingClassFor(receipt.id, currentMatchId, matchSet);
        const receiptStyle: CSSProperties =
          receipt.kind === 'tool_cluster'
            ? { flex: '0 1 auto', minWidth: 0, maxWidth: 'min(30rem, 100%)' }
            : { flex: '0 0 auto', minWidth: 0, maxWidth: '100%' };
        return (
          <div
            key={receipt.id}
            data-msg-id={receipt.id}
            data-testid={`process-receipt-${receipt.kind}`}
            className={`relative min-w-0 max-w-full search-ring-anim hover:z-10 focus-within:z-10 ${ringClass}`}
            style={receiptStyle}
          >
            {receipt.kind === 'tool_cluster' ? (
              <ToolCluster
                cluster={receipt}
                followTail={followTail && receipt === receipts.at(-1)}
                expanded={expanded.has(receipt.id) || clustersForceExpand}
                onToggle={() => onToggle(receipt.id)}
              />
            ) : (
              <ThinkingBlock
                thinking={receipt.thinking}
                followTail={followTail && receipt === receipts.at(-1)}
                expanded={expanded.has(receipt.id) || thinkingForceExpand}
                onToggle={() => onToggle(receipt.id)}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

type ConversationIntrinsicStyle = CSSProperties & {
  readonly '--conversation-intrinsic-size': string;
};

const ConversationRenderRow = memo(function ConversationRenderRow({
  item,
  index,
  animateEntry,
  liveTail,
  queryOwnerId,
  expanded,
  clustersForceExpand,
  thinkingForceExpand,
  currentMatchId,
  matchSet,
  userMessages,
  onToggle,
  onForkTurn,
  onRewindTurn,
}: {
  readonly item: ConversationRenderItem;
  readonly index: number;
  readonly animateEntry: boolean;
  readonly liveTail: boolean;
  readonly queryOwnerId: string | undefined;
  readonly expanded: ReadonlySet<string>;
  readonly clustersForceExpand: boolean;
  readonly thinkingForceExpand: boolean;
  readonly currentMatchId: string | undefined;
  readonly matchSet: ReadonlySet<string>;
  readonly userMessages: readonly UserMessage[];
  readonly onToggle: (id: string) => void;
  readonly onForkTurn: (turnIndex: number) => Promise<void>;
  readonly onRewindTurn: (turnIndex: number) => Promise<void>;
}): JSX.Element {
  const intrinsicStyle = useMemo<ConversationIntrinsicStyle>(
    () => ({
      '--conversation-intrinsic-size': `${estimateRenderItemHeight(
        item,
        expanded,
        clustersForceExpand,
        thinkingForceExpand,
      )}px`,
    }),
    [item, expanded, clustersForceExpand, thinkingForceExpand],
  );

  if (item.kind === 'receipts') {
    return (
      <div
        className="relative"
        data-query-anchor-id={queryOwnerId}
        data-testid="conversation-render-row"
      >
        <TimelineMarker tone={receiptMarkerTone(item.receipts)} animate={animateEntry} />
        <div
          className="conversation-occlusion-item"
          data-live-tail={liveTail ? 'true' : undefined}
          style={intrinsicStyle}
        >
          <ProcessReceiptRow
            receipts={item.receipts}
            followTail={liveTail}
            expanded={expanded}
            clustersForceExpand={clustersForceExpand}
            thinkingForceExpand={thinkingForceExpand}
            currentMatchId={currentMatchId}
            matchSet={matchSet}
            onToggle={onToggle}
          />
        </div>
      </div>
    );
  }

  const message = item.message;
  const ringClass = searchRingClassFor(message.id, currentMatchId, matchSet);
  let inner: JSX.Element;
  switch (message.kind) {
    case 'user':
      inner = (
        <UserBubble
          content={message.content}
          attachments={message.attachments}
          sentAt={message.sentAt}
        />
      );
      break;
    case 'local_notice':
      inner =
        message.variant === 'echo' ? (
          <UserBubble content={message.content} sentAt={message.sentAt} />
        ) : (
          <LocalNoticeBubble {...message} />
        );
      break;
    case 'queued_user':
      inner = <QueuedUserBubble {...message} />;
      break;
    case 'assistant_text':
      inner = (
        <AssistantBubble
          text={message.text}
          thinking={message.thinking}
          sentAt={message.sentAt}
          turnIndex={message.turnIndex}
          completed={message.completed}
          canRewind={
            message.turnIndex !== undefined
              ? canRewindSelectorTurn(userMessages, message.turnIndex)
              : false
          }
          onForkTurn={(turnIndex) => void onForkTurn(turnIndex)}
          onRewindTurn={(turnIndex) => void onRewindTurn(turnIndex)}
        />
      );
      break;
    case 'system_notice':
      inner = <SystemNotice {...message} />;
      break;
    case 'artifact':
      inner = <ArtifactInlineCallout artifact={message} />;
      break;
  }
  return (
    <div
      className="relative"
      data-query-anchor-id={queryOwnerId}
      data-testid="conversation-render-row"
    >
      <TimelineMarker tone={messageMarkerTone(message)} animate={animateEntry} />
      <div
        data-msg-id={message.id}
        data-stable-scroll-anchor="true"
        data-live-tail={liveTail ? 'true' : undefined}
        className={`conversation-occlusion-item search-ring-anim ${ringClass}`}
        style={intrinsicStyle}
      >
        <Reveal index={index} animate={animateEntry} className="conversation-message-body">
          {inner}
        </Reveal>
      </div>
    </div>
  );
});

type MarkerTone = 'user' | 'queued' | 'assistant' | 'system' | 'tool' | 'artifact' | 'thinking';

const MARKER_TONE_CLASS: Record<MarkerTone, string> = {
  user: 'bg-run',
  queued: 'bg-warn',
  assistant: 'bg-ok',
  system: 'bg-warn',
  tool: 'bg-fg-faint dark:bg-fg-muted',
  artifact: 'bg-accent-ink',
  thinking: 'bg-thinking',
};

function messageMarkerTone(message: StandardViewMessage): MarkerTone {
  switch (message.kind) {
    case 'user':
      return 'user';
    case 'local_notice':
      return message.variant === 'echo' ? 'user' : 'system';
    case 'queued_user':
      return 'queued';
    case 'assistant_text':
      return 'assistant';
    case 'system_notice':
      return 'system';
    case 'artifact':
      return 'artifact';
  }
}

function receiptMarkerTone(receipts: readonly ProcessReceiptMessage[]): MarkerTone {
  if (receipts.some((receipt) => receipt.kind === 'thinking')) return 'thinking';
  return 'tool';
}

function TimelineMarker({
  tone,
  animate = true,
}: {
  tone: MarkerTone;
  animate?: boolean;
}): JSX.Element {
  return (
    <span
      aria-hidden
      className={`${animate ? 'reveal-marker' : ''} absolute left-[-25px] top-[0.65rem] z-10 h-2.5 w-2.5 rounded-full border border-surface ring-1 ring-border-default/60 ${MARKER_TONE_CLASS[tone]}`}
    />
  );
}

function ArtifactInlineCallout({ artifact }: { artifact: ArtifactMessage }): JSX.Element {
  const { t } = useI18n();
  const projectRoot = useAppStore((s) => {
    const cur = s.currentSessionId;
    return cur ? (s.sessions.find((x) => x.sessionId === cur)?.projectRoot ?? null) : null;
  });
  const canOpen = artifact.status === 'done' && Boolean(artifact.artifactId);
  const kindLabel = artifact.artifactKind.trim() ? artifact.artifactKind.toUpperCase() : 'ARTIFACT';
  const meta = [kindLabel, artifact.version !== undefined ? `v${artifact.version}` : null]
    .filter(Boolean)
    .join(' / ');

  function focusInPanel(): void {
    if (!artifact.artifactId) return;
    window.dispatchEvent(
      new CustomEvent(FOCUS_ARTIFACT_EVENT, {
        detail: { id: artifact.artifactId, snapshot: artifact.snapshot },
      }),
    );
  }

  function openWindow(e: MouseEvent<HTMLButtonElement>): void {
    e.stopPropagation();
    if (!artifact.artifactId) return;
    window.kodaxSpace
      ?.invoke('artifact.openWindow', {
        id: artifact.artifactId,
        ...(artifact.version !== undefined ? { version: artifact.version } : {}),
        ...(projectRoot ? { projectRoot } : {}),
        title: artifact.title,
      })
      .catch(() => {});
  }

  return (
    <div
      className={[
        'group/artifact flex min-h-11 w-full items-center gap-1 rounded-md border px-1 py-1 text-xs',
        canOpen
          ? 'border-border-default bg-surface-2/45 hover:border-accent/45 hover:bg-surface-3/55 transition-colors'
          : 'border-border-default bg-surface-2/35',
      ].join(' ')}
    >
      <button
        type="button"
        onClick={focusInPanel}
        disabled={!canOpen}
        className="flex min-w-0 flex-1 items-center gap-2 rounded px-1.5 py-1 text-left disabled:cursor-default"
        title={canOpen ? t('conversation.viewArtifact') : t('conversation.creatingArtifact')}
      >
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-accent/30 bg-accent/10 text-accent-ink">
          {canOpen ? (
            <FileOutput className="h-4 w-4" strokeWidth={1.8} aria-hidden />
          ) : (
            <span className="activity-spinner-comet" aria-hidden />
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[10px] font-medium uppercase tracking-wide text-fg-muted">
            {canOpen ? t('conversation.artifactCreated') : t('conversation.creatingArtifact')}
          </span>
          <span className="block truncate text-sm font-medium text-fg-primary">
            {artifact.title}
          </span>
          <span className="block truncate text-[11px] text-fg-muted">
            <span className="uppercase tracking-wide">{meta}</span>
            {artifact.summary ? <span> / {artifact.summary}</span> : null}
          </span>
        </span>
        {canOpen && (
          <span className="shrink-0 pr-1 text-[11px] font-medium text-accent-ink opacity-85 group-hover/artifact:opacity-100">
            {t('conversation.open')}
          </span>
        )}
      </button>
      {canOpen && (
        <button
          type="button"
          onClick={openWindow}
          title={t('conversation.openArtifactWindow')}
          aria-label={t('conversation.openArtifactWindow')}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded text-fg-muted hover:bg-surface-3 hover:text-fg-primary"
        >
          <Maximize2 className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden />
        </button>
      )}
    </div>
  );
}
/**
 * 流式 spinner 行 —— 对话流末尾的"正在做什么"指示。
 * 不在 streaming 时整行返 null。
 */
function StreamingSpinnerRow(): JSX.Element | null {
  const isStreaming = useIsStreaming();
  if (!isStreaming) return null;
  return (
    <div className="relative">
      <ActivitySpinner />
    </div>
  );
}
/**
 * ThinkingBlock — receipt strip + expandable pre-wrap text.
 * approxTokens 复用 bubbles.tsx 的算法（4 chars ≈ 1 token），但这里 inline 实现避免循环依赖。
 */
function ThinkingBlock({
  thinking,
  followTail,
  expanded,
  onToggle,
}: {
  thinking: string;
  followTail: boolean;
  expanded: boolean;
  onToggle: () => void;
}): JSX.Element {
  const { t } = useI18n();
  const tokens = Math.max(1, Math.round(thinking.length / 4));
  const tokenLabel = t('message.thinkingSummary', { tokens: formatCompactCount(tokens) });
  return (
    <div className="inline-flex w-fit min-w-0 max-w-full flex-col">
      <button
        type="button"
        onClick={onToggle}
        className={[
          'inline-flex h-8 w-fit max-w-full items-center gap-1.5 whitespace-nowrap rounded-md border px-2 py-1',
          'border-border-default/70 bg-surface-2/45 font-mono text-[11px] text-fg-muted',
          'transition-colors hover:border-thinking/35 hover:bg-hover-bg hover:text-fg-primary',
          'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-strong',
        ].join(' ')}
        aria-expanded={expanded}
      >
        <Caret open={expanded} />
        <span className="rounded border border-thinking/20 bg-thinking/10 px-1.5 py-0.5 text-thinking/90">
          {tokenLabel}
        </span>
      </button>
      {expanded ? (
        <Collapse open={expanded}>
          <ScrollCapBox
            onCollapse={onToggle}
            followTail={followTail}
            labels={{
              collapse: t('message.collapse'),
              expandAll: t('message.expandAll'),
              restoreCap: t('message.restoreCap'),
            }}
            className={[
              'mt-1.5 ml-3 pl-2 border-l text-xs whitespace-pre-wrap',
              'dark:border-thinking/60 dark:text-thinking/80',
              'border-thinking/50 text-thinking/90',
            ].join(' ')}
          >
            {thinking}
          </ScrollCapBox>
        </Collapse>
      ) : null}
    </div>
  );
}

interface ToolClusterProps {
  cluster: ToolClusterMessage;
  followTail: boolean;
  expanded: boolean;
  onToggle: () => void;
}

/** 4 chars ≈ 1 token —— 跟 ThinkingBlock 同一套估算（避免引 bubbles 造成循环依赖）。 */
function approxTokens(text: string): number {
  return Math.max(1, Math.round(text.length / 4));
}

/**
 * 单层折叠 cluster：一次点击 = 全部展开（thinking + 所有 ToolCallCard），不再有内层 ▸/⌄。
 *
 *   折叠态：`› Ran 6 commands · bash/read · Thinking (~826 tokens)`
 *   展开态：按 step 顺序，每步先一段紫色 thinking（若有）再该步的工具卡，全部直接可见。
 *
 * 设计取舍（2026-06-08 用户反馈）：连续的 thinking→cmd→thinking→cmd 在 normal 视图下太占地方，
 *   把 thinking 折进工具组收敛成一个 cluster；展开逻辑保持"一次点开看全部"最简单，
 *   thinking 用整组 token 总量在 header 给个量级提示。
 *
 * 历史：v0.1.0 起曾两层折叠（外+内 sub-cluster），用户 2026-06-02 反馈两层不直观，降回单层。
 */
function ToolCluster({ cluster, followTail, expanded, onToggle }: ToolClusterProps): JSX.Element {
  const { t } = useI18n();
  const allTools = cluster.subClusters.flatMap((sc) => sc.tools);
  const running = allTools.find((t) => t.status === 'running');
  const label =
    cluster.totalTools === 1
      ? t('conversation.ranOneCommand')
      : t('conversation.ranCommands', { count: cluster.totalTools });
  // 组内折进来的 thinking 总 token —— header 给个量级提示，让用户知道"这组里藏了多少推理"。
  // 在 groupTools 里预算好（见 ToolClusterMessage.thinkingTokens），这里直接读。
  const thinkingTokens = cluster.thinkingTokens;
  const thinkingLabel =
    thinkingTokens > 0
      ? t('message.thinkingSummary', { tokens: formatCompactCount(thinkingTokens) })
      : null;
  const toolNames = Array.from(new Set(allTools.map((tool) => tool.toolName))).filter(Boolean);
  const visibleToolNames = toolNames.slice(0, 3);
  const hiddenToolNameCount = Math.max(0, toolNames.length - visibleToolNames.length);
  const toolNameSummary =
    visibleToolNames.length > 0
      ? `${visibleToolNames.join(' · ')}${hiddenToolNameCount > 0 ? ` +${hiddenToolNameCount}` : ''}`
      : '';
  // step 标签是否展示：
  //   - syntheticTitle=true ("1 read" 这种 summarizeTools 兜底) 且单 sub-cluster
  //     时省略 —— 跟外层 "Ran 1 command" 信息重复
  //   - syntheticTitle=false (assistant 真说了话作为前导) 时**必须**显示，
  //     否则 assistant 真实回复内容会从对话流消失（v0.1.4 回归 bug 修复）
  const showStepLabel = (sc: SubCluster): boolean => {
    if (!sc.syntheticTitle) return true;
    if (cluster.subClusters.length > 1) return true; // 多 sub-cluster 时仍需区分边界
    return false;
  };

  return (
    <div className="inline-flex w-fit min-w-0 max-w-full flex-col items-start text-xs">
      <button
        type="button"
        onClick={onToggle}
        className={[
          'group/receipt inline-flex h-8 w-fit min-w-0 max-w-full items-center gap-1.5 overflow-hidden whitespace-nowrap rounded-md border px-2 py-1',
          'border-border-default/70 bg-surface-2/45 font-mono text-[11px] text-fg-muted',
          'transition-colors hover:border-border-strong hover:bg-hover-bg hover:text-fg-primary',
          'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-strong',
        ].join(' ')}
        aria-expanded={expanded}
      >
        <Caret open={expanded} />
        <span className="shrink-0 text-fg-secondary group-hover/receipt:text-fg-primary">
          {label}
        </span>
        {toolNameSummary && (
          <span className="min-w-0 truncate text-fg-faint">
            <span className="mr-1">·</span>
            {toolNameSummary}
          </span>
        )}
        {thinkingLabel && (
          <span className="shrink-0 rounded border border-thinking/20 bg-thinking/10 px-1.5 py-0.5 text-thinking/90">
            {thinkingLabel}
          </span>
        )}
        {running && (
          <span className="shrink-0 rounded border border-warn/25 bg-warn/10 px-1.5 py-0.5 text-warn">
            {t('conversation.runningTool', { tool: running.toolName })}
          </span>
        )}
      </button>
      {expanded ? (
        <Collapse open={expanded}>
          <ScrollCapBox
            onCollapse={onToggle}
            followTail={followTail}
            labels={{
              collapse: t('message.collapse'),
              expandAll: t('message.expandAll'),
              restoreCap: t('message.restoreCap'),
            }}
            className="mt-1.5 ml-3 border-l border-border-default pl-3"
            contentClassName="space-y-2"
          >
            {cluster.subClusters.map((sc) => {
              const subRunning = sc.tools.find((t) => t.status === 'running');
              return (
                <div key={sc.id} className="space-y-1.5">
                  {/* 折进来的 thinking：随 cluster 一起展开，无需二次点击。紫色 quote 块对齐 ThinkingBlock 配色。 */}
                  {sc.thinking && (
                    <div
                      className={[
                        'pl-2 border-l text-xs whitespace-pre-wrap',
                        'dark:border-thinking/60 dark:text-thinking/80',
                        'border-thinking/50 text-thinking/90',
                      ].join(' ')}
                    >
                      {sc.thinking}
                    </div>
                  )}
                  {showStepLabel(sc) && (
                    <div className="flex items-start gap-1.5 text-fg-secondary">
                      <span className="whitespace-pre-wrap break-words">{sc.title}</span>
                      {subRunning && (
                        <span className="text-warn text-[11px] flex-shrink-0 mt-px">
                          · {t('conversation.runningTool', { tool: subRunning.toolName })}
                        </span>
                      )}
                    </div>
                  )}
                  <div className="space-y-2">
                    {sc.tools.map((t) => (
                      <ToolCallCard key={t.id} {...t} />
                    ))}
                  </div>
                </div>
              );
            })}
          </ScrollCapBox>
        </Collapse>
      ) : null}
    </div>
  );
}

// 历史会话加载骨架 — 点旧 session 后 jsonl IPC 在 flight 时显示 (~50-200ms)。
// 一组 user/assistant 气泡 shimmer,让用户知道"正在加载"而不是"空白会话"。
// 用 animate-pulse + 几条灰度 bar 模拟消息形态,无额外 CSS keyframe。
function HistoryRestoreSkeleton(): JSX.Element {
  const { t } = useI18n();
  return (
    <div className="space-y-4 animate-pulse" aria-label={t('conversation.loadingHistory')}>
      {/* user 气泡 (右对齐) */}
      <div className="flex justify-end">
        <div className="bg-surface-3/60 rounded-lg px-3 py-2 max-w-[60%]">
          <div className="h-3 w-48 bg-surface-3/60 rounded" />
        </div>
      </div>
      {/* assistant 气泡 (左对齐,多行) */}
      <div className="space-y-2">
        <div className="h-3 w-3/4 bg-surface-3/60 rounded" />
        <div className="h-3 w-2/3 bg-surface-3/60 rounded" />
        <div className="h-3 w-1/2 bg-surface-3/60 rounded" />
      </div>
      {/* user 气泡 #2 */}
      <div className="flex justify-end">
        <div className="bg-surface-3/60 rounded-lg px-3 py-2 max-w-[40%]">
          <div className="h-3 w-32 bg-surface-3/60 rounded" />
        </div>
      </div>
      <div className="space-y-2">
        <div className="h-3 w-5/6 bg-surface-3/60 rounded" />
        <div className="h-3 w-2/3 bg-surface-3/60 rounded" />
      </div>
      <div className="pt-2 text-[11px] text-fg-faint italic">
        {t('conversation.loadingConversation')}
      </div>
    </div>
  );
}
