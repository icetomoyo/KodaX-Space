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
  useEffect,
  useMemo,
  useRef,
  useState,
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
const INSTANT_PROGRAMMATIC_SCROLL_GUARD_MS = 120;
const SMOOTH_PROGRAMMATIC_SCROLL_GUARD_MS = 400;
const BOTTOM_DISTANCE_PX = 32;
const JUMP_TO_BOTTOM_DISTANCE_PX = 100;
const USER_SCROLL_INTENT_DELTA_PX = 4;

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
import { ChevronDown, FileOutput, Maximize2 } from 'lucide-react';
import { shouldActivateSessionForCurrentScope } from '../lib/sessionActivation.js';
import { useSurfaceStore } from '../store/surface.js';
import { requestConfirm } from '../store/confirmStore.js';
import { pushToast } from '../store/toastStore.js';
import { useI18n } from '../i18n/I18nProvider.js';
import type { MessageKey } from '../i18n/messages.js';
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
};

type ViewMessage =
  | Exclude<ConversationMessage, { kind: 'tool_call' }>
  | ToolClusterMessage
  | ArtifactMessage
  | ThinkingMessage;

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
  messages: ConversationMessage[],
  view: 'normal' | 'thinking' | 'verbose' | 'summary',
  t: Translate,
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
      (acc, sc) => acc + (sc.thinking ? approxTokens(sc.thinking) : 0),
      0,
    );
    out.push({
      kind: 'tool_cluster',
      id: `cluster_${clusterCounter++}_${pendingCluster[0].id}`,
      subClusters: pendingCluster,
      totalTools,
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
            out.push({ kind: 'thinking', id: `${m.id}_thinking`, thinking: m.thinking! });
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
            syntheticTitle: true,
          });
        } else if (hasThinking && foldThinking) {
          // thinking-only step（只想了一下就调工具）：**不打断**，推理折进 sub-cluster。
          // 连续的 thinking→cmd→thinking→cmd 就并成一个 "Ran N commands"。
          pendingCluster.push({
            id: m.id,
            title: summarizeTools(tools, t),
            tools,
            syntheticTitle: true,
            thinking: m.thinking!,
          });
        } else {
          // thinking/verbose 视图：thinking 仍独立成行（默认展开），每个 step 各自成组。
          if (hasThinking) {
            flushCluster();
            out.push({ kind: 'thinking', id: `${m.id}_thinking`, thinking: m.thinking! });
          }
          pendingCluster.push({
            id: m.id,
            title: summarizeTools(tools, t),
            tools,
            syntheticTitle: true,
          });
        }
        i = j - 1; // 跳过 consumed tool_calls (for loop ++ 再 +1 到 j)
      } else {
        flushCluster();
        const hasThinking = Boolean(m.thinking && m.thinking.length > 0);
        const hasText = m.text.length > 0;
        if (hasThinking && !hasText) {
          out.push({ kind: 'thinking', id: `${m.id}_thinking`, thinking: m.thinking! });
        } else {
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
  const currentSessionId = useAppStore((s) => s.currentSessionId);
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

  const messages = useMemo(
    () =>
      composeMessages({
        events,
        userMessages,
        localNotices,
        queuedUserMessages,
        workflowNotices,
      }),
    [events, userMessages, localNotices, queuedUserMessages, workflowNotices],
  );
  const viewMessages = useMemo(
    () => groupTools(messages, transcriptView, t),
    [messages, transcriptView, t],
  );
  // summary 视图：滤掉 thinking 行和工具组，只保留对话正文。其余视图原样渲染。
  const displayMessages = useMemo(
    () =>
      transcriptView === 'summary'
        ? viewMessages.filter((m) => m.kind !== 'thinking' && m.kind !== 'tool_cluster')
        : viewMessages,
    [viewMessages, transcriptView],
  );
  // verbose 全展开工具组；thinking/verbose 默认展开独立 thinking 行。
  const clustersForceExpand = transcriptView === 'verbose';
  const thinkingForceExpand = transcriptView === 'thinking' || transcriptView === 'verbose';

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const wasAtBottomRef = useRef<boolean>(true);
  const touchStartYRef = useRef<number | null>(null);
  const autoFollowRafRef = useRef<number | null>(null);
  const [showJumpToBottom, setShowJumpToBottom] = useState(false);
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
    if (!q) return [];
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
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }, [currentMatchIdx, matchIds]);

  function nextMatch(): void {
    if (matchIds.length === 0) return;
    setCurrentMatchIdx((i) => (i + 1) % matchIds.length);
  }
  function prevMatch(): void {
    if (matchIds.length === 0) return;
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

  function scrollToBottomNow(
    scroller: HTMLDivElement,
    guardMs = INSTANT_PROGRAMMATIC_SCROLL_GUARD_MS,
  ): void {
    markProgrammaticScroll(guardMs);
    scroller.scrollTop = scroller.scrollHeight;
  }

  function syncFollowStateFromScrollPosition(el: HTMLDivElement): void {
    const distance = getDistanceFromBottom(el);
    const atBottom = distance < BOTTOM_DISTANCE_PX;
    wasAtBottomRef.current = atBottom;
    setShowJumpToBottom(!atBottom && distance > JUMP_TO_BOTTOM_DISTANCE_PX);
  }

  function syncJumpButtonFromScrollPosition(el: HTMLDivElement): void {
    setShowJumpToBottom(getDistanceFromBottom(el) > JUMP_TO_BOTTOM_DISTANCE_PX);
  }

  function disengageFollowForUserScrollIntent(el: HTMLDivElement): void {
    wasAtBottomRef.current = false;
    syncJumpButtonFromScrollPosition(el);
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
      if (wasAtBottomRef.current) {
        scrollToBottomNow(scroller);
        setShowJumpToBottom(false);
      } else {
        syncJumpButtonFromScrollPosition(scroller);
      }
    });
  }

  function handleScroll(e: React.UIEvent<HTMLDivElement>): void {
    // 守卫期内的 scroll 事件来自 ResizeObserver / smooth scroll 自己的 scrollTop 赋值，
    // 不视为用户上滚
    if (performance.now() < programmaticScrollIgnoreUntilRef.current) return;
    syncFollowStateFromScrollPosition(e.currentTarget);
  }

  function handleWheel(e: ReactWheelEvent<HTMLDivElement>): void {
    clearProgrammaticScrollGuard();
    const scroller = e.currentTarget;
    const deltaY = e.deltaY;
    const scrollTopBefore = scroller.scrollTop;

    if (deltaY < 0 && scrollTopBefore > 0) {
      disengageFollowForUserScrollIntent(scroller);
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
    const scroller = e.currentTarget;
    switch (e.key) {
      case 'ArrowUp':
      case 'PageUp':
      case 'Home':
        disengageFollowForUserScrollIntent(scroller);
        break;
      case ' ':
        if (e.shiftKey) disengageFollowForUserScrollIntent(scroller);
        else syncFollowStateOnNextFrame(scroller);
        break;
      case 'ArrowDown':
      case 'PageDown':
      case 'End':
        syncFollowStateOnNextFrame(scroller);
        break;
    }
  }

  function handlePointerDown(e: ReactPointerEvent<HTMLDivElement>): void {
    const scroller = e.currentTarget;
    const scrollbarWidth = scroller.offsetWidth - scroller.clientWidth;
    if (scrollbarWidth <= 0) return;
    const rect = scroller.getBoundingClientRect();
    if (e.clientX >= rect.right - scrollbarWidth) {
      disengageFollowForUserScrollIntent(scroller);
    }
  }

  function handleTouchStart(e: ReactTouchEvent<HTMLDivElement>): void {
    touchStartYRef.current = e.touches[0]?.clientY ?? null;
  }

  function handleTouchMove(e: ReactTouchEvent<HTMLDivElement>): void {
    const scroller = e.currentTarget;
    const startY = touchStartYRef.current;
    const currentY = e.touches[0]?.clientY;
    if (startY === null || currentY === undefined) return;
    const deltaY = currentY - startY;
    if (deltaY > USER_SCROLL_INTENT_DELTA_PX) {
      disengageFollowForUserScrollIntent(scroller);
    } else if (deltaY < -USER_SCROLL_INTENT_DELTA_PX) {
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
    const ro = new ResizeObserver(() => {
      if (!isDocumentActiveForAutoFollow()) return;
      scheduleAutoFollow(scroller);
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
    };
  }, [currentSessionId]);

  useEffect(() => {
    const catchUpAfterFocus = (): void => {
      if (!isDocumentActiveForAutoFollow()) return;
      const scroller = scrollRef.current;
      if (!scroller) return;
      if (wasAtBottomRef.current) scheduleAutoFollow(scroller);
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
    if (scrollRef.current) {
      scrollToBottomNow(scrollRef.current);
      wasAtBottomRef.current = true;
      setShowJumpToBottom(false);
      setExpanded(new Set());
    }
  }, [currentSessionId]);

  function jumpToBottom(): void {
    if (!scrollRef.current) return;
    markProgrammaticScroll(SMOOTH_PROGRAMMATIC_SCROLL_GUARD_MS);
    wasAtBottomRef.current = true;
    setShowJumpToBottom(false);
    scrollRef.current.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }

  function toggleGroup(id: string): void {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function forkFromTurn(turnIndex: number): Promise<void> {
    if (!currentSessionId || !window.kodaxSpace) return;
    const state = useAppStore.getState();
    const session = state.sessions.find((s) => s.sessionId === currentSessionId);
    if (!session) return;
    const userMsgs = state.userMessagesBySession[currentSessionId] ?? [];
    const forkPointTurnIdx = Math.max(0, Math.min(turnIndex, Math.max(0, userMsgs.length - 1)));
    const r = await window.kodaxSpace.invoke('session.fork', {
      sessionId: currentSessionId,
      forkPointTurnIdx,
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
  }

  async function rewindToTurn(turnIndex: number): Promise<void> {
    if (!currentSessionId || !window.kodaxSpace) return;
    const state = useAppStore.getState();
    const userMsgs = state.userMessagesBySession[currentSessionId] ?? [];
    if (turnIndex < 0 || turnIndex >= userMsgs.length - 1) return;

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
  }

  if (!currentSessionId) {
    return <WelcomeDashboard />;
  }

  return (
    <div className="relative flex-1 overflow-hidden" data-testid="conversation-stream">
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        onWheelCapture={handleWheel}
        onKeyDownCapture={handleKeyDown}
        onPointerDownCapture={handlePointerDown}
        onTouchStartCapture={handleTouchStart}
        onTouchMoveCapture={handleTouchMove}
        className={`ix-zone h-full overflow-auto px-8 py-5 ${fontClass}`}
      >
        {/* 左右只留几个字符的 padding，不限宽 —— 用户反馈 max-w-3xl 在宽屏留太多空白。
            左侧时间线 rail = 绝对定位竖线 + 每条消息圆点 marker；`pl-6` 给 marker 让位。*/}
        <div ref={contentRef} className="relative pl-6">
          {/* timeline 竖线 —— 仅有可见消息时画，避免空状态出现孤立竖线 */}
          {displayMessages.length > 0 && (
            <div
              className="absolute left-[7px] top-2 bottom-2 w-px bg-border-default/70"
              aria-hidden
            />
          )}
          <div className="space-y-4">
            {displayMessages.length === 0 &&
              (currentSessionMsgCount > 0 ? (
                // 有 SDK summary msgCount 但 buffer 空 → history IPC 正在 flight,显示骨架
                // 比 "Send a prompt to start" 更准确,也免去用户盯着空白屏幕等几百毫秒
                <HistoryRestoreSkeleton />
              ) : (
                <div className="text-fg-faint italic text-sm">{t('conversation.emptyPrompt')}</div>
              ))}
            {displayMessages.map((m, i) => {
              const isMatch = matchSet.has(m.id);
              const isCurrent = currentMatchId === m.id;
              const ringClass = isCurrent
                ? 'ring-2 ring-warn/80 rounded-md'
                : isMatch
                  ? 'ring-1 ring-warn/40 rounded-md'
                  : '';
              let inner: JSX.Element;
              let markerTone: MarkerTone = 'assistant';
              switch (m.kind) {
                case 'user':
                  inner = <UserBubble content={m.content} sentAt={m.sentAt} />;
                  markerTone = 'user';
                  break;
                case 'local_notice':
                  inner =
                    m.variant === 'echo' ? (
                      <UserBubble content={m.content} sentAt={m.sentAt} />
                    ) : (
                      <LocalNoticeBubble {...m} />
                    );
                  markerTone = m.variant === 'echo' ? 'user' : 'system';
                  break;
                case 'queued_user':
                  inner = <QueuedUserBubble {...m} />;
                  markerTone = 'queued';
                  break;
                case 'assistant_text':
                  inner = (
                    <AssistantBubble
                      text={m.text}
                      thinking={m.thinking}
                      sentAt={m.sentAt}
                      turnIndex={m.turnIndex}
                      completed={m.completed}
                      canRewind={
                        m.turnIndex !== undefined ? m.turnIndex < userMessages.length - 1 : false
                      }
                      onForkTurn={(idx) => void forkFromTurn(idx)}
                      onRewindTurn={(idx) => void rewindToTurn(idx)}
                    />
                  );
                  markerTone = 'assistant';
                  break;
                case 'system_notice':
                  inner = <SystemNotice {...m} />;
                  markerTone = 'system';
                  break;
                case 'artifact':
                  inner = <ArtifactInlineCallout artifact={m} />;
                  markerTone = 'artifact';
                  break;
                case 'tool_cluster':
                  inner = (
                    <ToolCluster
                      cluster={m}
                      expanded={expanded.has(m.id) || clustersForceExpand}
                      onToggle={() => toggleGroup(m.id)}
                    />
                  );
                  markerTone = 'tool';
                  break;
                case 'thinking':
                  inner = (
                    <ThinkingBlock
                      thinking={m.thinking}
                      expanded={expanded.has(m.id) || thinkingForceExpand}
                      onToggle={() => toggleGroup(m.id)}
                    />
                  );
                  markerTone = 'thinking';
                  break;
              }
              return (
                <div
                  key={m.id}
                  data-msg-id={m.id}
                  className={`relative search-ring-anim ${ringClass}`}
                >
                  <TimelineMarker tone={markerTone} />
                  <Reveal index={i} className="conversation-message-body">
                    {inner}
                  </Reveal>
                </div>
              );
            })}
            {/* 流式 spinner —— v0.1.4：从 BottomBar 搬到这里，对齐 VSCode Claude Code
            把"正在做什么"放在对话流末尾的位置感（更自然，能跟时间线 rail 衔接）。
            ActivitySpinner 自己 return null 时本块也不渲染 marker。 */}
            <StreamingSpinnerRow />
          </div>
        </div>
      </div>

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
// Timeline rail marker —— absolute 定位到时间线竖线上，配色按消息 kind 区分
// 让用户一眼能扫出"哪些是我说的 / 模型说的 / 系统通知 / 工具调用 / 思考"。
// 直径 9px，与 rail (1px wide @ left:7px) 居中对齐 = marker.left = 3px。
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
function TimelineMarker({ tone }: { tone: MarkerTone }): JSX.Element {
  return (
    <span
      aria-hidden
      className={`reveal-marker absolute left-[-22px] top-[10px] w-[9px] h-[9px] rounded-full ring-2 ring-surface ${MARKER_TONE_CLASS[tone]}`}
    />
  );
}
/**
 * 流式 spinner 行 —— 对话流末尾的"正在做什么"指示。
 * 跟其它消息一样在时间线 rail 上挂一个 marker；不在 streaming 时整行返 null。
 */
function StreamingSpinnerRow(): JSX.Element | null {
  const isStreaming = useIsStreaming();
  if (!isStreaming) return null;
  return (
    <div className="relative">
      <TimelineMarker tone="assistant" />
      <ActivitySpinner />
    </div>
  );
}
/**
 * ThinkingBlock — 对齐 VSCode Claude Code "Thought for Xs" 折叠行。
 * 折叠态 = 紫色一行 `▸ Thinking · ~N tokens`，展开态 = 多行 pre-wrap 文本。
 * approxTokens 复用 bubbles.tsx 的算法（4 chars ≈ 1 token），但这里 inline 实现避免循环依赖。
 */
function ThinkingBlock({
  thinking,
  expanded,
  onToggle,
}: {
  thinking: string;
  expanded: boolean;
  onToggle: () => void;
}): JSX.Element {
  const { t } = useI18n();
  const tokens = Math.max(1, Math.round(thinking.length / 4));
  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        className={[
          'text-xs font-mono flex items-center gap-1.5',
          'dark:text-thinking dark:hover:text-thinking',
          'text-thinking/80 hover:text-thinking',
        ].join(' ')}
        aria-expanded={expanded}
      >
        <Caret open={expanded} />
        <span>{t('message.thinkingSummary', { tokens })}</span>
      </button>
      <Collapse open={expanded}>
        <div
          className={[
            'mt-1.5 ml-3 pl-2 border-l text-xs whitespace-pre-wrap',
            'dark:border-thinking/60 dark:text-thinking/80',
            'border-thinking/50 text-thinking/90',
          ].join(' ')}
        >
          {thinking}
        </div>
      </Collapse>{' '}
    </div>
  );
}

interface ToolClusterProps {
  cluster: ToolClusterMessage;
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
 *   折叠态：`› Ran 6 commands · 💭 ~826 tokens`   ← 💭 段是组内折进来的推理总量，没有 thinking 则不显示
 *   展开态：按 step 顺序，每步先一段紫色 thinking（若有）再该步的工具卡，全部直接可见。
 *
 * 设计取舍（2026-06-08 用户反馈）：连续的 thinking→cmd→thinking→cmd 在 normal 视图下太占地方，
 *   把 thinking 折进工具组收敛成一个 cluster；展开逻辑保持"一次点开看全部"最简单，
 *   thinking 用整组 token 总量在 header 给个量级提示。
 *
 * 历史：v0.1.0 起曾两层折叠（外+内 sub-cluster），用户 2026-06-02 反馈两层不直观，降回单层。
 */
function ToolCluster({ cluster, expanded, onToggle }: ToolClusterProps): JSX.Element {
  const { t } = useI18n();
  const allTools = cluster.subClusters.flatMap((sc) => sc.tools);
  const allDone = allTools.every((t) => t.status === 'done');
  const running = allTools.find((t) => t.status === 'running');
  const label =
    cluster.totalTools === 1
      ? t('conversation.ranOneCommand')
      : t('conversation.ranCommands', { count: cluster.totalTools });
  const runningHint = running
    ? ` · ${t('conversation.runningTool', { tool: running.toolName })}`
    : '';
  // 组内折进来的 thinking 总 token —— header 给个量级提示，让用户知道"这组里藏了多少推理"。
  // 在 groupTools 里预算好（见 ToolClusterMessage.thinkingTokens），这里直接读。
  const thinkingTokens = cluster.thinkingTokens;
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
    <div className="text-xs">
      <button
        type="button"
        onClick={onToggle}
        className="text-fg-muted hover:text-fg-primary flex items-center gap-1.5"
      >
        <Caret open={expanded} />
        <span>{label}</span>
        {thinkingTokens > 0 && (
          <span className="text-thinking">
            · {t('conversation.thinkingTokens', { tokens: thinkingTokens })}
          </span>
        )}
        {!allDone && <span className="text-warn">{runningHint}</span>}
      </button>
      <Collapse open={expanded}>
        <div className="mt-1.5 ml-3 space-y-2 border-l border-border-default pl-3">
          {' '}
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
        </div>
      </Collapse>
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
