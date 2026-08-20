// composeMessages —— 把 SessionEvent[] + UserMessage[] 编织成 ConversationMessage[]。
//
// 输入语义：
//   - events 是 main 推过来的有序 push 事件流（thinking_delta / text_delta / tool_start /
//     tool_progress / tool_result / iteration_end / session_complete / session_error）
//   - userMessages 是 renderer 本地记录的"用户发的 prompt"（main 不通过 push 回放）
//   - userMessages 的 sentAt 与 event 时间在同一 wall-clock；merge 时按时间穿插
//
// 输出语义：
//   - 一条 ConversationMessage 对应 UI 上一个气泡 / 卡片
//   - assistant 文本：连续 text_delta 合成一条 assistant_text 气泡（直到被
//     tool_start / iteration_end / session_complete 等"中断"）
//   - thinking：附在最近的 assistant_text 上（或独立 stub）
//   - tool_start 开新 tool_call 卡；后续 tool_progress / tool_result 更新它
//   - iteration_end / session_complete / session_error 走 system_notice
//
// 设计原则：纯函数。给定相同输入产相同输出，便于 useMemo + 单元测试。

import type { SessionEvent } from '@kodax-space/space-ipc-schema';
import type {
  LocalNoticeMessage,
  QueuedUserMessage,
  UserMessage,
  WorkflowNoticeMessage,
} from '../../store/appStore.js';
import { selectorTurnIndexesByMessageId } from './turnIndex.js';

export type ConversationMessage =
  | {
      kind: 'user';
      id: string;
      content: string;
      attachments?: UserMessage['attachments'];
      sentAt: number;
    }
  | {
      kind: 'local_notice';
      id: string;
      content: string;
      sentAt: number;
      variant: 'echo' | 'output';
    }
  | {
      kind: 'queued_user';
      id: string;
      content: string;
      attachments?: QueuedUserMessage['attachments'];
      queueMode: 'interrupt' | 'after-turn';
      status: 'pending-ack' | 'queued' | 'failed';
      failureReason?: QueuedUserMessage['failureReason'];
      sentAt: number;
    }
  | {
      kind: 'assistant_text';
      id: string;
      /** 累积的 text_delta 拼接结果；用于 markdown 渲染。*/
      text: string;
      /** 累积的 thinking_delta 拼接（如果有）。*/
      thinking?: string;
      turnIndex?: number;
      completed?: boolean;
      /**
       * 该轮对话的近似时间戳——继承自触发本轮的 user message sentAt。
       * 用于 message footer 显示 "6d ago" 之类相对时间。assistant 实际完成时间没存
       * （events 没时间戳），用 user 时间近似在 dashboard 视角无感差异。
       */
      sentAt?: number;
    }
  | {
      kind: 'tool_call';
      id: string;
      toolId: string;
      toolName: string;
      input?: Record<string, unknown>;
      result?: string;
      progress?: string;
      status: 'running' | 'done';
    }
  | {
      kind: 'system_notice';
      id: string;
      variant: 'iteration' | 'error' | 'sidecar' | 'workflow' | 'lineage';
      /** iteration: "iter 1/30 · 1280 tokens"; error: 错误文本；sidecar: verifier 可读消息；
       *  lineage: fork/rewind branch_summary 或 compaction 的历史提示条（v0.1.x）。
       *  v0.1.x: 'complete' variant 已废弃——assistant bubble footer 自带 "Xd ago"，
       *  原来的横条 "✓ complete" 视觉太重、对每轮都打断阅读节奏。 */
      text: string;
      /** lineage variant 专用。compaction 的内部累计摘要不会进入可见 text。 */
      lineageKind?: 'branch_summary' | 'compaction' | 'history_truncation';
      historyTruncationScope?: 'history' | 'turn';
      omittedItems?: number;
      /** sidecar variant 专用：true 表示这条是 session.history 回放（main 无法持久化真实
       *  verdict/delivery），渲染方应该用中性"历史记录"标签而非断言具体 verdict（v0.1.x #12）。*/
      historical?: boolean;
      /** OC-11: error variant 携带的 wrapSdkError 分类。SystemNotice 据此渲染按钮。*/
      action?: 'retry' | 'open_provider_settings' | 'check_network' | 'change_model';
      retriable?: boolean;
      /** OC-23 倒计时：retry 按钮在此 epoch ms 之前 disabled + 显示 "Retry in Ns"。
       *  Main 端在 emit session_error 时已 stamp = Date.now() + waitMs，selector 这里
       *  直接透传 evt.retryAvailableAt 不再加工，避免 composeMessages 每次重跑都让倒计时
       *  漂移 (review HIGH-2 修复后的定型形态)。*/
      retryAvailableAt?: number;
      /** Renderer-local notices (workflow) keep their own wall-clock timestamp for footer UI. */
      sentAt?: number;
    };

interface ComposeInput {
  readonly events: readonly SessionEvent[];
  readonly userMessages: readonly UserMessage[];
  readonly localNotices?: readonly LocalNoticeMessage[];
  readonly queuedUserMessages?: readonly QueuedUserMessage[];
  readonly workflowNotices?: readonly WorkflowNoticeMessage[];
  /** Raw lineage belongs to audit/details. Ordinary chat explicitly disables this projection. */
  readonly includeAuditLineage?: boolean;
}

export function composeMessages({
  events,
  userMessages,
  localNotices = [],
  queuedUserMessages = [],
  workflowNotices = [],
  includeAuditLineage = true,
}: ComposeInput): ConversationMessage[] {
  const result: ConversationMessage[] = [];

  // 把 userMessages 转成"带时间戳的虚拟事件"——便于和 events 按时序穿插。
  // events 没有自带时间戳，但它们的顺序 = push 顺序 = 时间顺序；
  // 用户消息是用户主动 send 出去之后才有的 events，所以一个 user message 之后跟着一串 events 直到下一个 user message。
  // 简化的做法：按 sentAt 把 user messages 切片，每片之后追加对应时段的 events。
  // 但 events 没时间戳，我们没法精确切。退而求其次：先 emit 所有 user messages，再 emit
  // 所有 events，会让对话看起来"用户消息全在最前"——这不对。
  //
  // 正确做法：events 按收到顺序，user messages 也按顺序；两条流交叉时机是"用户每发一条 prompt，
  // 后续 events 都属于这条 prompt 的响应，直到下一条 prompt 出现"。换言之，第 N 条 user message
  // 之后的所有 events，在第 N+1 条 user message 之前。
  //
  // 为了实现这个，我们假设 user messages 按发送顺序，events 也按到达顺序：
  //   - 在每条 user message 后，截取属于它的 events 子序列
  //   - 子序列的边界：到 session_complete / session_error 算这段结束；或者下一条 user message 出现
  //
  // 当前 mock + future real adapter 都会在每次 send 结束时 emit session_complete 或 session_error，
  // 所以"按 session_complete/error 切段"是稳定的边界。

  // Floor for workflow-notice SORT position (not display): a workflow for a session always
  // ran after the conversation began, so a notice must never sort ABOVE the restored
  // conversation. It can though: a compaction *re-root* re-stamps every restored message to
  // the (later) re-root time, so a run that finished just BEFORE the re-root keeps its real
  // (earlier) time and pins to the very top on reopen — even after the per-message-sentAt fix,
  // because there is no restored message earlier than it (verified: session s_01213312, run
  // ended 10:33 < every re-rooted message at 10:34). Clamp the sort key to the earliest
  // restored user message so such a notice interleaves within the conversation instead of
  // floating to the top. No-op for live notices and for runs whose time is already in range
  // (e.g. 20260617_014905, run within the message span — unchanged). Display keeps the real
  // run time (footer "Xd ago").
  const userSentAts = userMessages.map((u) => u.sentAt).filter((t) => Number.isFinite(t));
  const earliestUserSentAt = userSentAts.length > 0 ? Math.min(...userSentAts) : undefined;
  const noticeSortAt = (sentAt: number): number =>
    earliestUserSentAt !== undefined && Number.isFinite(sentAt)
      ? Math.max(sentAt, earliestUserSentAt)
      : sentAt;
  const failedQueuedMessages = queuedUserMessages.filter((queued) => queued.status === 'failed');
  const liveQueuedMessages = queuedUserMessages.filter((queued) => queued.status !== 'failed');
  const selectorTurnIndexes = selectorTurnIndexesByMessageId(userMessages);
  const routedEvents = routeRuntimeOwnedEvents(events, userMessages);

  let cursor = 0;
  const localMessages = [
    ...userMessages.map((userMsg, order) => ({
      kind: 'user' as const,
      sentAt: userMsg.sentAt,
      order,
      userMsg,
    })),
    ...localNotices.map((notice, order) => ({
      kind: 'local_notice' as const,
      sentAt: notice.sentAt,
      order: userMessages.length + order,
      notice,
    })),
    ...workflowNotices.map((notice, order) => ({
      kind: 'workflow_notice' as const,
      sentAt: noticeSortAt(notice.sentAt),
      order: userMessages.length + localNotices.length + order,
      notice,
    })),
    ...failedQueuedMessages.map((queued, order) => ({
      kind: 'failed_queued_user' as const,
      sentAt: queued.sentAt,
      order: userMessages.length + localNotices.length + workflowNotices.length + order,
      queued,
    })),
  ].sort((a, b) => a.sentAt - b.sentAt || a.order - b.order);

  for (const local of localMessages) {
    if (local.kind === 'local_notice') {
      result.push({
        kind: 'local_notice',
        id: local.notice.id,
        content: local.notice.content,
        sentAt: local.notice.sentAt,
        variant:
          local.notice.variant ??
          (local.notice.content.trimStart().startsWith('/') ? 'echo' : 'output'),
      });
      continue;
    }

    if (local.kind === 'workflow_notice') {
      result.push({
        kind: 'system_notice',
        id: local.notice.id,
        variant: 'workflow',
        text: local.notice.content,
        sentAt: local.notice.sentAt,
      });
      continue;
    }

    if (local.kind === 'failed_queued_user') {
      result.push(toQueuedConversationMessage(local.queued));
      continue;
    }

    const userMsg = local.userMsg;
    if (userMsg.hiddenHistoryAnchor !== true && userMsg.hiddenProjectionDuplicate !== true) {
      result.push({
        kind: 'user',
        id: userMsg.id,
        content: userMsg.content,
        ...(userMsg.attachments !== undefined ? { attachments: userMsg.attachments } : {}),
        sentAt: userMsg.sentAt,
      });
    }
    if (userMsg.historyNoAssistantSegment === true) {
      const ownedEvents = routedEvents.eventsByUserId.get(userMsg.id);
      if (ownedEvents && userMsg.hiddenProjectionDuplicate !== true) {
        composeAssistantSegment(
          ownedEvents,
          result,
          userMsg.sentAt,
          selectorTurnIndexes.get(userMsg.id),
          includeAuditLineage,
        );
      }
      continue;
    }

    // 找这条 user message 对应的 events 段：从 cursor 起，到遇到
    // session_complete / session_error / 或所有 events 用完。
    const segmentEnd = findSegmentEnd(routedEvents.events, cursor);
    const segment = mergeRoutedEvents(
      routedEvents.events.slice(cursor, segmentEnd),
      routedEvents.eventsByUserId.get(userMsg.id),
      routedEvents.eventIndexes,
    );
    cursor = segmentEnd;
    if (userMsg.hiddenProjectionDuplicate !== true) {
      composeAssistantSegment(
        segment,
        result,
        userMsg.sentAt,
        selectorTurnIndexes.get(userMsg.id),
        includeAuditLineage,
      );
    }
  }
  if (cursor < routedEvents.events.length) {
    composeAssistantSegment(
      routedEvents.events.slice(cursor),
      result,
      undefined,
      undefined,
      includeAuditLineage,
    );
  }

  for (const queued of [...liveQueuedMessages].sort((a, b) => a.sentAt - b.sentAt)) {
    result.push(toQueuedConversationMessage(queued));
  }

  return result;
}

function routeRuntimeOwnedEvents(
  events: readonly SessionEvent[],
  userMessages: readonly UserMessage[],
): {
  readonly events: readonly SessionEvent[];
  readonly eventsByUserId: ReadonlyMap<string, readonly SessionEvent[]>;
  readonly eventIndexes: ReadonlyMap<SessionEvent, number>;
} {
  const owners = [...userMessages]
    .sort((a, b) => a.sentAt - b.sentAt)
    .filter((message) => message.historyNoAssistantSegment !== true);
  const kept: SessionEvent[] = [];
  const eventsByUserId = new Map<string, SessionEvent[]>();
  const eventIndexes = new Map(events.map((event, index) => [event, index] as const));
  let ownerIndex = 0;
  let segmentStart = 0;
  let terminalGroup:
    | { readonly first: SessionEvent; readonly ownerIndex: number; readonly keptEnd: number }
    | undefined;

  for (const event of events) {
    // Delivery markers remain in the positional stream because they split multiple user
    // segments inside one Runtime Run. Other uniquely owned modern events can be detached from
    // a foreign segment, then merged back by their original event index.
    if (isUserDeliveryBoundary(event)) {
      if (kept.length > segmentStart) {
        ownerIndex++;
        segmentStart = kept.length;
      }
      kept.push(event);
      terminalGroup = undefined;
      continue;
    }
    const targetIndex = eventOwnerIndex(event, owners);
    const targetOwner = targetIndex === undefined ? undefined : owners[targetIndex];
    if (
      targetOwner !== undefined &&
      (targetIndex !== ownerIndex || eventsByUserId.has(targetOwner.id))
    ) {
      const routed = eventsByUserId.get(targetOwner.id) ?? [];
      routed.push(event);
      eventsByUserId.set(targetOwner.id, routed);
      terminalGroup = undefined;
      continue;
    }
    if (!isTerminalEvent(event)) {
      kept.push(event);
      terminalGroup = undefined;
      continue;
    }

    const previousGroup = terminalGroup;
    if (
      previousGroup !== undefined &&
      previousGroup.keptEnd === kept.length &&
      (targetIndex === undefined || targetIndex === previousGroup.ownerIndex) &&
      terminalBelongsToSameCompatibilitySegment(previousGroup.first, event)
    ) {
      kept.push(event);
      segmentStart = kept.length;
      terminalGroup = {
        first: previousGroup.first,
        ownerIndex: previousGroup.ownerIndex,
        keptEnd: kept.length,
      };
      continue;
    }
    const closedOwnerIndex = ownerIndex;
    kept.push(event);
    ownerIndex++;
    segmentStart = kept.length;
    terminalGroup = { first: event, ownerIndex: closedOwnerIndex, keptEnd: kept.length };
  }

  return { events: kept, eventsByUserId, eventIndexes };
}

function mergeRoutedEvents(
  positional: readonly SessionEvent[],
  owned: readonly SessionEvent[] | undefined,
  eventIndexes: ReadonlyMap<SessionEvent, number>,
): readonly SessionEvent[] {
  if (!owned || owned.length === 0) return positional;
  if (positional.length === 0) return owned;
  return [...positional, ...owned].sort(
    (left, right) =>
      (eventIndexes.get(left) ?? Number.MAX_SAFE_INTEGER) -
      (eventIndexes.get(right) ?? Number.MAX_SAFE_INTEGER),
  );
}

function eventOwnerIndex(event: SessionEvent, owners: readonly UserMessage[]): number | undefined {
  const runId = 'runtimeEvent' in event ? event.runtimeEvent?.runId : undefined;
  const turnId = 'turnId' in event ? event.turnId : undefined;
  const indexedOwners = owners.map((owner, index) => ({ owner, index }));
  if (runId !== undefined) {
    const runOwners = indexedOwners.filter(({ owner }) => owner.runtimeRunId === runId);
    if (turnId !== undefined) {
      const exactOwners = indexedOwners.filter(
        ({ owner }) =>
          owner.turnId === turnId &&
          owner.hiddenProjectionDuplicate !== true &&
          (owner.runtimeRunId === undefined || owner.runtimeRunId === runId),
      );
      if (exactOwners.length === 1) return exactOwners[0]?.index;
      // A Runtime Run may deliver more than one user input mid-turn. Once that happens,
      // run identity alone cannot choose an owner: the delivery boundary in the positional
      // event stream is authoritative. Falling through to the sole run-bound root owner
      // would pull every event after that boundary back above the delivered user.
      if (exactOwners.length > 1) return undefined;
    }
    if (runOwners.length === 1) return runOwners[0]?.index;
  }
  if (runId === undefined && !isTerminalEvent(event)) return undefined;
  if (turnId === undefined) return undefined;
  const visibleTurnOwners = indexedOwners.filter(
    ({ owner }) =>
      owner.turnId === turnId &&
      owner.hiddenProjectionDuplicate !== true &&
      (runId === undefined || owner.runtimeRunId === undefined),
  );
  return visibleTurnOwners.length === 1 ? visibleTurnOwners[0]?.index : undefined;
}

function isTerminalEvent(
  event: SessionEvent,
): event is Extract<SessionEvent, { kind: 'session_complete' | 'session_error' }> {
  return event.kind === 'session_complete' || event.kind === 'session_error';
}

function isUserDeliveryBoundary(event: SessionEvent): boolean {
  return event.kind === 'mid_turn_user_prompt' || event.kind === 'queued_user_prompt_started';
}

function toQueuedConversationMessage(
  queued: QueuedUserMessage,
): Extract<ConversationMessage, { kind: 'queued_user' }> {
  return {
    kind: 'queued_user',
    id: queued.id,
    content: queued.content,
    ...(queued.attachments !== undefined ? { attachments: queued.attachments } : {}),
    queueMode: queued.queueMode,
    status: queued.status,
    ...(queued.failureReason !== undefined ? { failureReason: queued.failureReason } : {}),
    sentAt: queued.sentAt,
  };
}

/** events[cursor..] 里找下一段的结束位置（不包含）：到 session_complete / session_error 之后 */
function findSegmentEnd(events: readonly SessionEvent[], cursor: number): number {
  for (let i = cursor; i < events.length; i++) {
    const e = events[i];
    // A user turn's segment ends at the next *user-delivery* boundary — an
    // explicit mid-turn / queued prompt marker — or a terminal event. The
    // boundary event at cursor still belongs to the next segment.
    //
    // `session_start` is deliberately NOT a boundary (#5 fix). The SDK emits
    // exactly one session_start per run (CAP-003), and Space's after-turn drain
    // emits that run's session_start immediately AFTER `queued_user_prompt_started`
    // for the SAME delivery (startQueuedPromptIfIdle → startRun). When session_start
    // was also treated as a boundary, that second boundary stole a *later* prompt's
    // segment slot: e.g. after-turn prompt B starts a new run, then an interrupt C
    // arrives mid-run — C's bubble landed above content ("cB") that had already
    // streamed for B, and B lost its reply. Every genuine new turn is already bounded
    // by a terminal (separate turns) or a delivery marker (mid-run / after-turn), so
    // absorbing session_start is safe. History restore uses session_complete
    // separators and emits no session_start, so it is unaffected.
    if (
      i > cursor &&
      (e.kind === 'mid_turn_user_prompt' || e.kind === 'queued_user_prompt_started')
    ) {
      return i;
    }
    if (e.kind === 'session_complete' || e.kind === 'session_error') {
      // 防御性：把**紧跟的连续终止事件**一并并入本段，而不是只吃一个。
      // 单个用户轮次理论上只产一个终止事件，但 SDK AMA 错误路径曾一次冒出
      // error + complete（+ 重复 error）多个终止事件（见 real-session.ts 收口注释）。
      // 若只 return i+1，多出来的终止事件会被算进**下一条** user message 的段里，
      // 导致后续 user ↔ event 配对整体错位（错误挂错气泡、回复被甩到列表底部）。
      // 主修复在 main 端收口；这里再兜一道，保证即便多终止事件也留在同一段、位置正确。
      let end = i + 1;
      while (end < events.length && terminalBelongsToSameCompatibilitySegment(e, events[end])) {
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
  return first.kind === 'session_error';
}

/** 把一段 events 编织成 assistant 气泡 + tool cards + system notice 序列 */
function composeAssistantSegment(
  segment: readonly SessionEvent[],
  out: ConversationMessage[],
  parentSentAt?: number,
  turnIndex?: number,
  includeAuditLineage = true,
): void {
  let currentText: {
    kind: 'assistant_text';
    id: string;
    text: string;
    thinking?: string;
    turnIndex?: number;
    completed?: boolean;
    sentAt?: number;
  } | null = null;
  let activeResponseId: string | undefined;
  let activeProviderRequestId: string | undefined;
  let activeSegmentTextIds = new Set<string>();
  const responseSegmentTextIds = new Set<string>();
  let lastTextBubble: Extract<ConversationMessage, { kind: 'assistant_text' }> | null = null;
  let segmentHadError = false;
  // tool_call 卡片按 toolId 查找——同一个 toolId 的 start/progress/result 合并到一张卡
  const toolCardsByToolId = new Map<string, Extract<ConversationMessage, { kind: 'tool_call' }>>();

  // 每段开头计数器从 0 起，id 用 segment idx + offset，避免不同段的 id 冲撞
  const segmentTag = `seg${out.length}`;
  const eventOccurrences = new Map<string, number>();

  const eventTag = (event: SessionEvent, fallback: string): string => {
    if ('canonicalIndex' in event && typeof event.canonicalIndex === 'number') {
      return `history_c${event.canonicalIndex}`;
    }
    if ('entryId' in event && typeof event.entryId === 'string') {
      return `history_e${encodeURIComponent(event.entryId)}`;
    }
    if ('logicalId' in event && typeof event.logicalId === 'string') {
      return `history_l${encodeURIComponent(event.logicalId)}`;
    }
    return fallback;
  };
  const nextEventId = (event: SessionEvent, kind: string): string => {
    const tag = eventTag(event, segmentTag);
    const key = `${tag}_${kind}`;
    const occurrence = eventOccurrences.get(key) ?? 0;
    eventOccurrences.set(key, occurrence + 1);
    return `${key}${occurrence}`;
  };

  function flushTextBubble(): Extract<ConversationMessage, { kind: 'assistant_text' }> | null {
    if (currentText) {
      const flushed = currentText;
      out.push(currentText);
      lastTextBubble = flushed;
      currentText = null;
      return flushed;
    }
    return null;
  }

  function discardTextBubbles(textIds: ReadonlySet<string>): void {
    if (currentText && textIds.has(currentText.id)) currentText = null;
    if (textIds.size > 0) {
      for (let index = out.length - 1; index >= 0; index--) {
        const message = out[index];
        if (message?.kind === 'assistant_text' && textIds.has(message.id)) out.splice(index, 1);
      }
    }
    lastTextBubble = null;
  }

  for (const evt of segment) {
    switch (evt.kind) {
      case 'output_segment_started': {
        if (
          evt.responseId === activeResponseId &&
          evt.providerRequestId === activeProviderRequestId
        ) {
          break;
        }
        if (activeResponseId !== undefined && evt.responseId !== activeResponseId) {
          discardTextBubbles(responseSegmentTextIds);
          responseSegmentTextIds.clear();
        } else if (evt.mode === 'replace') {
          discardTextBubbles(activeSegmentTextIds);
          for (const textId of activeSegmentTextIds) responseSegmentTextIds.delete(textId);
        } else {
          flushTextBubble();
        }
        activeResponseId = evt.responseId;
        activeProviderRequestId = evt.providerRequestId;
        activeSegmentTextIds = new Set();
        break;
      }
      case 'text_delta': {
        if (
          evt.providerRequestId !== undefined &&
          evt.providerRequestId !== activeProviderRequestId
        ) {
          break;
        }
        if (!currentText) {
          currentText = {
            kind: 'assistant_text',
            id: nextEventId(evt, 'text'),
            text: '',
            ...(turnIndex !== undefined ? { turnIndex } : {}),
            sentAt: evt.sentAt ?? parentSentAt,
          };
          if (evt.providerRequestId !== undefined) {
            activeSegmentTextIds.add(currentText.id);
            responseSegmentTextIds.add(currentText.id);
          }
        }
        currentText.text += evt.text;
        break;
      }
      case 'thinking_delta': {
        if (
          evt.providerRequestId !== undefined &&
          evt.providerRequestId !== activeProviderRequestId
        ) {
          break;
        }
        if (!currentText) {
          currentText = {
            kind: 'assistant_text',
            id: nextEventId(evt, 'text'),
            text: '',
            ...(turnIndex !== undefined ? { turnIndex } : {}),
            sentAt: evt.sentAt ?? parentSentAt,
          };
          if (evt.providerRequestId !== undefined) {
            activeSegmentTextIds.add(currentText.id);
            responseSegmentTextIds.add(currentText.id);
          }
        }
        currentText.thinking = (currentText.thinking ?? '') + evt.text;
        break;
      }
      case 'provider_recovery': {
        break;
      }
      case 'tool_start': {
        flushTextBubble();
        lastTextBubble = null;
        const card: Extract<ConversationMessage, { kind: 'tool_call' }> = {
          kind: 'tool_call',
          id: `${eventTag(evt, segmentTag)}_tool_${evt.toolId}`,
          toolId: evt.toolId,
          toolName: evt.toolName,
          input: evt.input,
          status: 'running',
        };
        toolCardsByToolId.set(evt.toolId, card);
        out.push(card);
        break;
      }
      case 'tool_progress': {
        const card = toolCardsByToolId.get(evt.toolId);
        if (card) card.progress = evt.message;
        break;
      }
      case 'tool_result': {
        const card = toolCardsByToolId.get(evt.toolId);
        if (card) {
          card.result = evt.content;
          card.status = 'done';
        }
        break;
      }
      case 'iteration_end': {
        // iter/token 数据由 BottomBar 的 ActivitySpinner + ContextWindowIndicator
        // 持续显示，对话流不再插 system_notice — 避免每轮中间出现 "iter 1/200 · 14k tokens"
        // 分隔线打断阅读节奏（用户反馈：状态栏有就够了）。
        //
        // 只有主循环（parent / 旧版 undefined scope）的 iteration_end 才结束当前气泡。
        // 工作流 / dispatch 子 agent 的 `scope: 'worker'` 迭代事件不属于主 transcript——
        // 主端已在 real-session 过滤，这里再兜一道：否则并行子 agent 的 worker 迭代会在主
        // agent 流式输出中途 flush，把一条回复切成多个断句气泡（见 real-session onIterationEnd）。
        if (evt.scope === 'worker') break;
        flushTextBubble();
        break;
      }
      case 'session_complete': {
        // v0.1.x: 不再 push '✓ complete' 横条；assistant bubble footer 显示 "Xd ago"
        // + copy 按钮替代，视觉更轻。consume 但不 emit。
        const completedText = flushTextBubble() ?? lastTextBubble;
        if (!segmentHadError && completedText && completedText.text.length > 0) {
          completedText.completed = true;
        }
        break;
      }
      case 'sidecar_message': {
        flushTextBubble();
        // #12 fix: historical=true 表示这条来自 session.history 回放——main 端没法持久化真实
        // verdict/delivery/suggestedFix，硬编码的占位值不能拿来断言"这条是要求修改还是拦截"。
        // composeMessages 是纯函数、没有 i18n context，这里只透传 content + historical 标记，
        // 不烤入英文 title；SystemNotice 组件（有 useI18n）据 historical 决定标签文案 + 语言。
        // 实时事件（historical 缺省）保持原样——title 直接烤进 text，Live path 完全不变。
        const suggestedFix = evt.message.suggestedFix
          ? ` Suggested fix: ${evt.message.suggestedFix}`
          : '';
        if (evt.message.historical === true) {
          out.push({
            kind: 'system_notice',
            id: nextEventId(evt, 'sidecar'),
            variant: 'sidecar',
            text: `${evt.message.content}${suggestedFix}`,
            historical: true,
          });
          break;
        }
        const title =
          evt.message.delivery === 'budget-exhausted'
            ? 'Sidecar budget exhausted'
            : evt.message.verdict === 'revise'
              ? 'Sidecar verifier requested revision'
              : 'Sidecar verifier blocked completion';
        out.push({
          kind: 'system_notice',
          id: nextEventId(evt, 'sidecar'),
          variant: 'sidecar',
          text: `${title}: ${evt.message.content}${suggestedFix}`,
        });
        break;
      }
      case 'lineage_notice': {
        if (!includeAuditLineage) break;
        // #3 fix: branch_summary/compaction lineage entry 的历史提示条——不是用户消息,
        // 复用 sidecar 的视觉样式(SystemNotice 的 warn 配色)。compaction 的完整摘要是
        // Runtime 内部上下文，通常有上万字符且多次压缩之间高度重叠；只显示本地化边界标签。
        // 多次压缩之间若没有任何可见内容，只合成一个可见边界。底层 lineage 与 compact_stats
        // 仍完整保留，避免根据 active/时间顺序猜测 fork/rewind 的祖先关系。
        flushTextBubble();
        const previousMessage = out[out.length - 1];
        if (
          evt.noticeKind === 'compaction' &&
          previousMessage?.kind === 'system_notice' &&
          previousMessage.variant === 'lineage' &&
          previousMessage.lineageKind === 'compaction'
        ) {
          break;
        }
        out.push({
          kind: 'system_notice',
          id:
            evt.displayId !== undefined ||
            evt.provisionalId !== undefined ||
            evt.entryId !== undefined
              ? `lineage_${evt.displayId ?? evt.provisionalId ?? evt.entryId}`
              : nextEventId(evt, 'lineage'),
          variant: 'lineage',
          lineageKind: evt.noticeKind,
          text: evt.noticeKind === 'branch_summary' ? evt.text : '',
        });
        break;
      }
      case 'history_truncation': {
        flushTextBubble();
        out.push({
          kind: 'system_notice',
          id: nextEventId(evt, 'history_truncation'),
          variant: 'lineage',
          lineageKind: 'history_truncation',
          historyTruncationScope: evt.scope,
          omittedItems: evt.omittedItems,
          text: '',
        });
        break;
      }
      case 'workflow_notice': {
        // Workflow notices must stay in the assistant event stream. History replay creates
        // this event from transcript `<task-completed>` entries; live workflow.event injects
        // the same kind before the main-agent report that follows it.
        flushTextBubble();
        out.push({
          kind: 'system_notice',
          id: nextEventId(evt, 'workflow'),
          variant: 'workflow',
          text: evt.text,
          ...(evt.sentAt !== undefined ? { sentAt: evt.sentAt } : {}),
        });
        break;
      }
      case 'session_error': {
        flushTextBubble();
        segmentHadError = true;
        out.push({
          kind: 'system_notice',
          id: nextEventId(evt, 'error'),
          variant: 'error',
          text: evt.error,
          // OC-11 透传分类信息 —— SystemNotice 据此渲染 retry / open-settings 按钮
          ...(evt.action !== undefined ? { action: evt.action } : {}),
          ...(evt.retriable !== undefined ? { retriable: evt.retriable } : {}),
          // OC-23 retry-after 倒计时；retryAvailableAt 已经是 main 端 stamp 的绝对
          // 时间戳，直接透传，不在 selector 里重 stamp 防漂移 (review HIGH-2)
          ...(evt.retryAvailableAt !== undefined ? { retryAvailableAt: evt.retryAvailableAt } : {}),
        });
        break;
      }
      case 'mid_turn_user_prompt': {
        flushTextBubble();
        lastTextBubble = null;
        break;
      }
      case 'queued_user_prompt_started': {
        flushTextBubble();
        lastTextBubble = null;
        break;
      }
      case 'queued_user_prompt_failed': {
        break;
      }
    }
  }

  // 段末如果还有 buffered text（理论上 session_complete 之前应该 flush 了，但防御性）
  flushTextBubble();
}
