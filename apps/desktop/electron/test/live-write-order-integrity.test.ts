/**
 * FEATURE_275 票 3：live 写入序完整性（B1 + B2）。
 *
 * 机制基线（docs/features/v0.1.46.md FEATURE_275 机制基线 #1）：渲染配对是"位置序"、
 * user 槽是写入数组序（票 2 后 sortKey 在跨空间时保持数组序），两者的一致性靠**写入点的
 * 数组摆放**维持。本文件钉死两个写入点的不变量：
 *
 * B1 `reconcileRuntimeDeliveredInputs`（runtime delivered inputs 通道）：
 *   投递边界事件按 deliverySeq 插入 events 流的正确位置，但 owner user 行被 append 到
 *   users 数组末尾（且 sentAt 改写为服务端 deliveredAt ?? createdAt）。当一次快照携带
 *   多个已投递 interrupt 且投递顺序与投影 queuedInputs 列表顺序（入队序）不一致时
 *   （真实场景：投递门不同——X 等待用户确认后才投递、Y 到安全边界即投递——入队序
 *   [X, Y] 对应投递序 Y(seq 3) < X(seq 5)），处理顺序 = 列表序、尾部 append 使
 *   owner 数组序 = 处理序 ≠ 边界位置序 → 后处理的 owner 骑到先处理但边界更早的 owner
 *   之上，compose 的位置配对把回答拼到错误的提问之下。
 *   不变量：owner 数组索引 == 其 delivery 边界的事件段位置（owner 就位摆放）。
 *   sentAt 改写保留：仅用于 footer/notice 交织（票 2 语义），不再影响 user 槽顺序。
 *
 * B2 canonical 页安装接缝（prependSessionHistory 的 combinedHeadMsgs/historyAndLiveEvents）：
 *   两个平面各自内部有序；自然配对成立的前提是"live 平面严格新于被安装的 canonical 页"。
 *   生产论证：canonical 页读是时点一致快照——一条**已闭合**的 live 轮若未出现在
 *   无截断（无 history_truncation）的页面里，它必然晚于页面快照完成（否则它已在
 *   journal 里、必然被快照包含）→ live 轮就该排在页面行之后，接缝拼接即全局序。
 *   破坏者是 `stabilizeCanonicalPageHeadBeforeEarlierLiveTurns` 的
 *   `turn.sentAt < canonical.sentAt` 墙钟比较：服务钟超前（页面行盖到未来时间）时，
 *   比页面更新的 live 轮被误判"错位"整轮搬上页面 → live 轮骑到更早 canonical 轮之上。
 *   修复方向（本票采用）：搬迁判据改为身份证据——canonical 轮的 live 副本（同 turnId、
 *   非 restored 行）仍在装载时，任何排在其之前的未匹配 live 轮才可搬到页首之前
 *   （live-history-next-query-order 钉死的合法场景恰是此形态：页面头 = live 最新轮
 *   的 canonical 副本，更早的 unmatched live 轮在其之上）；无身份证据不搬（时钟不参与）。
 *
 * 观察缝（票 3 前置确认）：store 公共 action（appendUserMessage/appendEvent/
 * bindUserMessageRuntimeRun/replaceSessionLiveProjection）+ 分页公共函数
 * （restoreNewestSessionHistory）驱动，以 composeMessages 组合投影为唯一观察面，
 * 不断言 store 内部状态。
 *
 * 运行：cd apps/desktop && node --test --test-concurrency=1 --import tsx
 *       "electron/test/live-write-order-integrity.test.ts"
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type {
  SessionHistoryItem,
  SpaceSessionLiveProjectionT,
} from '@kodax-space/space-ipc-schema';
import { composeMessages } from '../../renderer/src/features/session/composeMessages.js';
import { useAppStore } from '../../renderer/src/store/appStore.js';
import {
  deactivateSessionHistoryPaging,
  resetSessionHistoryPagingLifecycle,
  restoreNewestSessionHistory,
} from '../../renderer/src/shell/sessionHistoryPaging.js';

const SID_BASE = 'live-write-order-integrity';
let seedCounter = 0;
let SID = SID_BASE;
const CREATED_AT = Date.parse('2026-09-06T08:00:00.000Z');

const RUNTIME_ID = 'rt-live-order';
const TURN_BG = 'turn_bg_order';
const TURN_Q1 = 'turn_q1_order';
const TURN_Q2 = 'turn_q2_order';

const BG_Q = '帮我把季度复盘的素材按三条主线归档';
const BG_A = '已归档完成：三条主线的素材分别进入对应目录，索引表已更新。';
const Q1_TEXT = '开始核对第三季度各渠道的转化数据，先把原始表拉出来';
// 流式段按"文本/工具"交替布局（连续同 kind 的 delta 会被 appendEvent 合并成一个
// buffer 事件，真实 journal 的逐 delta seq 在 renderer 侧本就不是逐条摆放的）。
// Y 边界（seq>4）切在 tB 前，X 边界（seq>6）切在 tC 前。
const T_A = '收到，原始表已就位，先核对官网渠道。';
const T_B = '继续核对：官网渠道转化率 3.2%；信息流渠道按修正口径为 2.8%。';
const T_C = '线下活动渠道按新口径并入统计；三渠道结论稍后汇总成表。';

const X_TEXT = '插播：线下活动渠道单独出';
const Y_TEXT = '插播：信息流渠道按新口径算';

// 服务端投递时钟与本地乐观时钟刻意错开（三种时钟混排的最小形态）。
const SERVER_T = {
  xQueuedAt: Date.parse('2026-09-06T08:20:00.000Z'),
  xDeliveredAt: Date.parse('2026-09-06T08:31:30.000Z'),
  yQueuedAt: Date.parse('2026-09-06T08:24:00.000Z'),
  yDeliveredAt: Date.parse('2026-09-06T08:29:10.000Z'),
};

// ---- canonical 页 fixture ----
// B2 用"服务钟超前"形态的纯背景轮页（无截断、无 hasMore）：页面行 sentAt 全部盖到未来。
function buildBackgroundItems(sentAtShift: (base: number) => number): SessionHistoryItem[] {
  return [
    {
      kind: 'user',
      content: BG_Q,
      sentAt: sentAtShift(CREATED_AT),
      entryId: 'entry_order_bg_u',
      canonicalIndex: 60,
      turnId: TURN_BG,
      turnUserOrdinal: 0,
    },
    {
      kind: 'assistant',
      text: BG_A,
      sentAt: sentAtShift(CREATED_AT + 20_000),
      entryId: 'entry_order_bg_a',
      canonicalIndex: 61,
      turnId: TURN_BG,
    },
  ];
}

interface PageResponse {
  readonly ok: true;
  readonly data: {
    readonly items: SessionHistoryItem[];
    readonly conversation: { readonly status: 'resolved' };
    readonly page: {
      readonly outcome: 'ready';
      readonly revision: string;
      readonly sourceRevision: string;
      readonly hasMore: false;
      readonly windowMode: 'replace';
      readonly hasNewer: false;
    };
  };
}

function pageResponse(items: SessionHistoryItem[], revision: string): PageResponse {
  return {
    ok: true,
    data: {
      items,
      conversation: { status: 'resolved' },
      page: {
        outcome: 'ready',
        revision,
        sourceRevision: revision,
        hasMore: false,
        windowMode: 'replace',
        hasNewer: false,
      },
    },
  };
}

let stageBackgroundSentAt: (base: number) => number = (base) => base;

function installOrderWindow(): void {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    writable: true,
    value: {
      kodaxSpace: {
        invoke: async (_channel: string, input: unknown) => {
          const result = pageResponse(
            buildBackgroundItems((base) => stageBackgroundSentAt(base)),
            'rev-bg',
          );
          const owner = input as { readonly sessionId: string; readonly requestId: string };
          return {
            ...result,
            data: { ...result.data, sessionId: owner.sessionId, requestId: owner.requestId },
          };
        },
      },
    },
  });
}

async function seedSession(label: string): Promise<void> {
  SID = `${SID_BASE}-${label}-${++seedCounter}`;
  useAppStore.setState({
    sessions: [
      {
        sessionId: SID,
        projectRoot: '/project',
        provider: 'mock',
        reasoningMode: 'auto',
        permissionMode: 'accept-edits',
        agentMode: 'ama',
        surface: 'code',
        createdAt: CREATED_AT,
        lastActivityAt: CREATED_AT,
      },
    ],
    currentSessionId: SID,
    eventsBySession: {},
    userMessagesBySession: {},
    pendingSendBySession: {},
    liveProjectionBySession: {},
    runtimeSnapshotRequiredBySession: {},
  });
}

/** replaceSessionLiveProjection 要求 fresh live authority + profile runtimeId 一致。 */
function seedRuntimeAuthority(runtimeId: string): void {
  const connection = {
    state: 'ready' as const,
    changedAt: Date.now(),
    stale: false,
    runtimeId,
    capabilities: [],
  };
  useAppStore.setState({
    runtimeConnection: connection,
    runtimeProfile: {
      connection,
      projectionRevision: 1,
      cursor: { runtimeId, seq: 0 },
      sessions: [],
      interactions: [],
      notifications: [],
    },
  });
}

// ---- composed 投影观察面 ----
function composedLines(): string[] {
  const state = useAppStore.getState();
  return composeMessages({
    events: state.eventsBySession[SID] ?? [],
    userMessages: state.userMessagesBySession[SID] ?? [],
  }).flatMap((message) => {
    switch (message.kind) {
      case 'user':
        return [`user:${message.content}`];
      case 'assistant_text':
        return [`assistant:${message.text}`];
      case 'tool_call':
        return [`tool:${message.toolName}`];
      default:
        return [];
    }
  });
}

function composedUserSentAt(content: string): number | undefined {
  const state = useAppStore.getState();
  const composed = composeMessages({
    events: state.eventsBySession[SID] ?? [],
    userMessages: state.userMessagesBySession[SID] ?? [],
  }).find((message) => message.kind === 'user' && message.content === content);
  return composed?.kind === 'user' ? composed.sentAt : undefined;
}

function dumpComposed(tag: string): void {
  console.log(`=== ${tag}: composed (${SID}) ===`);
  for (const [index, line] of composedLines().entries()) console.log(`  [${index}] ${line}`);
}

// ============================================================================
// Red 1（B1）：流式输出中途投递两个 interrupt —— 列表序（入队序）≠ 投递序时，
// owner 行必须按各自 delivery 边界的事件段位置就位摆放。
// ============================================================================

type DeliveredInterrupt = SpaceSessionLiveProjectionT['queuedInputs'][number];

function deliveredInterrupt(
  input: Pick<DeliveredInterrupt, 'inputId' | 'entryId'> & {
    readonly contentPreview: string;
    readonly createdAt: number;
    readonly deliveredAt: number;
    readonly deliverySeq: number;
    readonly turnUserOrdinal: number;
  },
): DeliveredInterrupt {
  return {
    ...input,
    sessionId: SID,
    delivery: 'interrupt',
    state: 'delivered',
    runId: 'run-q1-live',
    turnId: TURN_Q1,
  };
}

function pushDeliveredSnapshot(
  projectionRevision: number,
  queuedInputs: readonly DeliveredInterrupt[],
): void {
  seedRuntimeAuthority(RUNTIME_ID);
  useAppStore.getState().replaceSessionLiveProjection({
    sessionId: SID,
    projectionRevision,
    cursor: { runtimeId: RUNTIME_ID, seq: 20, sessionId: SID, journalEpoch: 'epoch-run-q1' },
    transcriptRevision: 'transcript-q1-live',
    queuedRuns: [],
    queuedInputs: [...queuedInputs],
    interactions: [],
    activeTools: [],
    todos: [],
    activeRun: {
      runId: 'run-q1-live',
      sessionId: SID,
      turnId: TURN_Q1,
      phase: 'running',
      startedAt: SERVER_T.xQueuedAt,
    },
  });
}

test('B1·delivered interrupt 就位绑定：owner 不得尾部 append 到后投递边界之上（列表序≠投递序）', async () => {
  await seedSession('b1');
  installOrderWindow();
  stageBackgroundSentAt = (base) => base;
  await restoreNewestSessionHistory(SID, 'code');

  // live 轮 q1 流式进行中（run-q1-live，epoch seq 1..6，无 terminal）。
  const store = useAppStore.getState();
  const q1MessageId = store.appendUserMessage(SID, Q1_TEXT, Date.now());
  assert.ok(q1MessageId);
  store.bindUserMessageRuntimeRun(SID, q1MessageId, 'run-q1-live');
  const origin = (seq: number) => ({
    runtimeId: RUNTIME_ID,
    runId: 'run-q1-live',
    journalEpoch: 'epoch-run-q1',
    seq,
  });
  store.appendEvent({
    kind: 'session_start',
    sessionId: SID,
    provider: 'mock',
    turnId: TURN_Q1,
    runtimeEvent: origin(1),
  });
  store.appendEvent({
    kind: 'thinking_delta',
    sessionId: SID,
    text: 'Pull raw tables first, then reconcile per channel…',
    turnId: TURN_Q1,
    runtimeEvent: origin(2),
  });
  store.appendEvent({
    kind: 'text_delta',
    sessionId: SID,
    text: T_A,
    turnId: TURN_Q1,
    runtimeEvent: origin(3),
  });
  store.appendEvent({
    kind: 'tool_start',
    sessionId: SID,
    toolId: 'tool-order-bash',
    toolName: 'bash',
    input: { command: 'kodax metrics pull --q3' },
    turnId: TURN_Q1,
    runtimeEvent: origin(4),
  });
  store.appendEvent({
    kind: 'tool_result',
    sessionId: SID,
    toolId: 'tool-order-bash',
    toolName: 'bash',
    content: 'rows=214',
    turnId: TURN_Q1,
    runtimeEvent: origin(4),
  });
  store.appendEvent({
    kind: 'text_delta',
    sessionId: SID,
    text: T_B,
    turnId: TURN_Q1,
    runtimeEvent: origin(5),
  });
  store.appendEvent({
    kind: 'tool_start',
    sessionId: SID,
    toolId: 'tool-order-todo',
    toolName: 'todo_update',
    input: { id: 'todo_order_1' },
    turnId: TURN_Q1,
    runtimeEvent: origin(6),
  });
  store.appendEvent({
    kind: 'tool_result',
    sessionId: SID,
    toolId: 'tool-order-todo',
    toolName: 'todo_update',
    content: '{"ok":true}',
    turnId: TURN_Q1,
    runtimeEvent: origin(6),
  });
  store.appendEvent({
    kind: 'text_delta',
    sessionId: SID,
    text: T_C,
    turnId: TURN_Q1,
    runtimeEvent: origin(7),
  });

  // 权威快照：两个已投递 interrupt。投影列表按入队序 = [X, Y]，但投递门不同：
  // X 等待确认后才投递（deliverySeq 6），Y 到安全边界即投递（deliverySeq 4，更早）。
  // reconcile 依列表序处理：X 边界落在 seq>6（T_C 之前），
  // Y 边界落在 seq>4（T_B 之前）——Y 的边界段在 X 之前。
  pushDeliveredSnapshot(1, [
    deliveredInterrupt({
      inputId: 'input-x',
      entryId: 'entry_order_x',
      contentPreview: X_TEXT,
      createdAt: SERVER_T.xQueuedAt,
      deliveredAt: SERVER_T.xDeliveredAt,
      deliverySeq: 6,
      turnUserOrdinal: 2,
    }),
    deliveredInterrupt({
      inputId: 'input-y',
      entryId: 'entry_order_y',
      contentPreview: Y_TEXT,
      createdAt: SERVER_T.yQueuedAt,
      deliveredAt: SERVER_T.yDeliveredAt,
      deliverySeq: 4,
      turnUserOrdinal: 1,
    }),
  ]);
  dumpComposed('B1 after delivered-interrupt snapshot');

  // 不变量（组合投影形态）：每个 user 气泡紧邻自己的回答段——
  // q1 拿到 seq≤4 的开段，Y 的边界段（seq 5/6）在 Y 之下，X 的边界段（seq 7）在 X 之下。
  assert.deepEqual(composedLines(), [
    `user:${BG_Q}`,
    `assistant:${BG_A}`,
    `user:${Q1_TEXT}`,
    `assistant:${T_A}`,
    'tool:bash',
    `user:${Y_TEXT}`,
    `assistant:${T_B}`,
    'tool:todo_update',
    `user:${X_TEXT}`,
    `assistant:${T_C}`,
  ]);

  // footer 显示契约保留：owner 的 sentAt = 服务端 deliveredAt（仅展示/交织，不决定 user 槽序）。
  assert.equal(composedUserSentAt(Y_TEXT), SERVER_T.yDeliveredAt);
  assert.equal(composedUserSentAt(X_TEXT), SERVER_T.xDeliveredAt);

  deactivateSessionHistoryPaging(SID);
  resetSessionHistoryPagingLifecycle();
});

// ============================================================================
// Red 2（B2）：存在多条 live 基线轮时装入 canonical 页（服务钟超前、页面滞后
// 且无截断）→ 接缝自然配对成立（live 平面严格新于页面快照），live 轮不得被
// 墙钟比较误搬到更早 canonical 轮之上。
// ============================================================================

function streamClosedTurn(input: {
  readonly content: string;
  readonly sentAt: number;
  readonly runId: string;
  readonly epoch: string;
  readonly turnId: string;
  readonly answer: string;
}): void {
  const store = useAppStore.getState();
  const messageId = store.appendUserMessage(SID, input.content, input.sentAt);
  assert.ok(messageId);
  store.bindUserMessageRuntimeRun(SID, messageId, input.runId);
  const origin = (seq: number) => ({
    runtimeId: RUNTIME_ID,
    runId: input.runId,
    journalEpoch: input.epoch,
    seq,
  });
  store.appendEvent({
    kind: 'session_start',
    sessionId: SID,
    provider: 'mock',
    turnId: input.turnId,
    runtimeEvent: origin(1),
  });
  store.appendEvent({
    kind: 'text_delta',
    sessionId: SID,
    text: input.answer,
    turnId: input.turnId,
    runtimeEvent: origin(2),
  });
  store.appendEvent({
    kind: 'session_complete',
    sessionId: SID,
    turnId: input.turnId,
    runtimeEvent: origin(3),
  });
}

test('B2·canonical 页安装在多条 live 基线轮之上：服务钟超前不得把更新的 live 轮搬到页面行之前', async () => {
  await seedSession('b2');
  installOrderWindow();

  // 纯 live 先行：两条已闭合轮（本地钟），全程无 canonical 读。
  streamClosedTurn({
    content: Q1_TEXT,
    sentAt: Date.now() - 300_000,
    runId: 'run-b2-q1',
    epoch: 'epoch-b2-q1',
    turnId: TURN_Q1,
    answer: T_B,
  });
  streamClosedTurn({
    content: '再核对线下活动渠道的到场转化',
    sentAt: Date.now() - 100_000,
    runId: 'run-b2-q2',
    epoch: 'epoch-b2-q2',
    turnId: TURN_Q2,
    answer: '线下活动渠道到场转化率 12.5%，口径已并入。',
  });

  // 迟到的 canonical 页（无截断）只覆盖背景轮：两条 live 轮晚于页面快照完成。
  // 服务钟超前：页面行 sentAt 盖到未来（比两条 live 轮的本地 sentAt 更大）。
  const ahead = Date.now() + 600_000;
  stageBackgroundSentAt = (base) => ahead + (base - CREATED_AT);
  await restoreNewestSessionHistory(SID, 'code');
  dumpComposed('B2 after late page install (server clock ahead)');

  // 组合投影：users 顺序 == events 位置序——canonical 背景轮在最前，
  // 每条 live 轮的 user 紧邻其 assistant 段之前，无轮次骑跳。
  assert.deepEqual(composedLines(), [
    `user:${BG_Q}`,
    `assistant:${BG_A}`,
    `user:${Q1_TEXT}`,
    `assistant:${T_B}`,
    `user:再核对线下活动渠道的到场转化`,
    `assistant:线下活动渠道到场转化率 12.5%，口径已并入。`,
  ]);

  deactivateSessionHistoryPaging(SID);
  resetSessionHistoryPagingLifecycle();
});
