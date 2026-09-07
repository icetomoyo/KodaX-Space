/**
 * FEATURE_275 票 5：结算即退役 + shadow 回收（P2 核心）。
 *
 * 机制基线（2026-09-07，transcript-order-real-lineage-repro L 主配方的根因链）：
 *   certified canonical 合并（decideTurnProjectionAuthority → 'canonical'）只把 live 影子行
 *   从当次 store buffer 里折叠掉，而 historyLiveBaselines 影子缓存仍保留该行的 user 行与事件。
 *   之后任何一次装页（appendSessionHistory 的 currentMsgs = liveBaseline.userMessages）都会把
 *   影子重新放进 fold 输入；settledRuntimeRuns 只含当前 reconcile 的 Run，旧 Run 永远拿不到
 *   canonical 权威 → coexist_fail_open 级联 + 段错位归属 → closed live 残件重复渲染
 *   （L 主配方失败门(c)：尾句 2 卡；a1/q2/a2 各 ×2）。
 *
 * 本票验收（fold 不再依赖 fail-closed 隐藏）：
 *   1. 认证即删除 —— canonical 权威成立时，已收编进 canonical 页的 live 影子行/事件从
 *      缓冲中物理删除（不是仅隐藏），稳态 buffer 无 hiddenProjectionDuplicate 残留；
 *   2. 墓碑 —— 被退役的同身份行在重 admission / 快照重水合 / 切走再切回时不复活；
 *   3. fail-open 不变 —— 身份不明（canonical 滞后无对手行）一律 coexist，不删；迟到尾
 *      delta 是 run 答案的一部分，必须保持可见（内容零丢失）；
 *   4. 刷新等价 —— 逐轮认证路径的终态投影 == 冷 reload 投影（逐行相等）。
 *
 * 公共观察面：store 公共 action + sessionHistoryPaging 公共函数驱动，composeMessages 输出
 * 与 userMessagesBySession/eventsBySession 公共状态断言（与 repro 家族同一 seam，不断言
 * fold 内部状态）。
 *
 * 运行：cd apps/desktop && node --test --test-concurrency=1 --import tsx
 *       "electron/test/settlement-retirement.test.ts"
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
  reconcileTerminalSessionHistory,
  resetSessionHistoryPagingLifecycle,
  restoreNewestSessionHistory,
  revalidateNewestSessionHistory,
} from '../../renderer/src/shell/sessionHistoryPaging.js';

const SID_BASE = 'settlement-retirement';
let seedCounter = 0;
let SID = SID_BASE;
const CREATED_AT = Date.parse('2026-08-16T01:05:00.000Z');

// ---- 真实时序（客户 session 20260816_110200_432759c1554ee5，与 repro L 套件同一生命线）----
const REAL_T = {
  bgDone: Date.parse('2026-08-16T01:07:52.931Z'),
  q1: Date.parse('2026-08-16T01:09:41.527Z'),
  a1: Date.parse('2026-08-16T01:10:03.394Z'),
  q2: Date.parse('2026-08-16T01:10:21.800Z'),
  a2: Date.parse('2026-08-16T01:10:38.680Z'),
  run2Terminal: Date.parse('2026-08-16T01:10:44.494Z'),
};

const TURN_BG = 'turn_8860b0bc18424193';
const TURN_1 = 'turn_4cbd9ec8cf71403b';
const TURN_2 = 'turn_041d7c13178c4975';
const RUNTIME_ID = 'rt-live';
const RUN_1 = 'run-x';
const RUN_2 = 'run-y';
const EPOCH_2 = 'epoch-run-y';

const BG_Q = '先把昨天评审会的结论整理成一条待办，同步到项目看板里';
const BG_A = '已整理完成：评审结论共 3 条已同步到看板，其中两条标记为高优先级，后续按优先级推进。';
const Q1_TEXT = '接着把这套视频的三条叙事线各自再打磨一版，重点补上数据支撑';
const A1_THINKING =
  'The user wants three narrative lines polished with data support. Plan: line 1 retention data, line 2 conversion comparison, line 3 opening hook. Draft each version and annotate the evidence source…';
const A1_TEXT =
  '三条叙事线的打磨稿已经完成：第一条线补齐了留存数据，第二条线加入了转化对比，第三条线重构了开场钩子。每一版都附上了依据和风险提示，可以直接进入评审。';
const Q2_TEXT = '很好，那第二条线先来，把转化对比那部分再展开讲讲';
const A2_THINKING =
  'Expand line 2 with conversion comparison: baseline retention, uplift after redesign, confidence interval and sample size. Close with an offer to enumerate the currently valid versions…';
const A2_HEAD =
  '第二条线的转化对比可以从三个维度展开：先看改版前的基线留存，再看改版后的转化提升幅度，最后给出置信区间和样本量说明，方便你判断结论是否站得住。';
// 真实 journal 里 a2 的最后两个 delta 恰为这句尾句（01:10:38.532 / 01:10:38.595）。
const A2_TAIL_1 = '要不要我先把这套视频的“现在到底哪几个版本是有效的”';
const A2_TAIL_2 = '理一份清单给您，再决定哪条线继续打磨？';
const A2_FULL = `${A2_HEAD}${A2_TAIL_1}${A2_TAIL_2}`;

type Revision = 'rev-0' | 'rev-1' | 'rev-2';

function buildBackgroundItems(): SessionHistoryItem[] {
  return [
    {
      kind: 'user',
      content: BG_Q,
      sentAt: REAL_T.bgDone - 120_000,
      entryId: 'entry_sr_bg_u',
      canonicalIndex: 60,
      turnId: TURN_BG,
      turnUserOrdinal: 0,
    },
    {
      kind: 'assistant',
      text: BG_A,
      thinking: '整理评审会结论为待办…',
      sentAt: REAL_T.bgDone,
      entryId: 'entry_sr_bg_a',
      canonicalIndex: 61,
      turnId: TURN_BG,
    },
  ];
}

function buildTurn1Items(): SessionHistoryItem[] {
  return [
    {
      kind: 'user',
      content: Q1_TEXT,
      sentAt: REAL_T.q1,
      entryId: 'entry_sr_q1_u',
      canonicalIndex: 62,
      turnId: TURN_1,
      turnUserOrdinal: 0,
    },
    {
      kind: 'assistant',
      text: A1_TEXT,
      thinking: A1_THINKING,
      sentAt: REAL_T.a1,
      entryId: 'entry_sr_q1_a',
      canonicalIndex: 63,
      turnId: TURN_1,
    },
  ];
}

function buildTurn2Items(): SessionHistoryItem[] {
  return [
    {
      kind: 'user',
      content: Q2_TEXT,
      sentAt: REAL_T.q2,
      entryId: 'entry_sr_q2_u',
      canonicalIndex: 64,
      turnId: TURN_2,
      turnUserOrdinal: 0,
    },
    {
      kind: 'assistant',
      text: A2_FULL,
      thinking: A2_THINKING,
      sentAt: REAL_T.a2,
      entryId: 'entry_sr_q2_a',
      canonicalIndex: 65,
      turnId: TURN_2,
    },
  ];
}

function buildPageItems(
  revision: Revision,
  options: { readonly omitTurn2?: boolean; readonly turn2UserOnly?: boolean } = {},
): SessionHistoryItem[] {
  if (revision === 'rev-0') return buildBackgroundItems();
  const items = [...buildBackgroundItems(), ...buildTurn1Items()];
  if (revision === 'rev-2' && options.omitTurn2 !== true) {
    // 204 守卫形态：canonical 只持久化了 T2 的 user 边界，assistant 行缺席（读与落盘竞速）。
    if (options.turn2UserOnly === true) items.push(buildTurn2Items()[0]!);
    else items.push(...buildTurn2Items());
  }
  return items;
}

interface PageResponse {
  readonly ok: true;
  readonly data: {
    readonly items: SessionHistoryItem[];
    readonly conversation: { readonly status: 'resolved' };
    readonly page: {
      readonly outcome: 'ready';
      readonly revision: Revision;
      readonly sourceRevision: Revision;
      readonly hasMore: false;
      readonly windowMode: 'replace';
      readonly hasNewer: false;
    };
  };
}

// 页内容用"暂存"：每次装页前 stage 一次，paging 内部读几次都拿到同一页。
let stagedRevision: Revision = 'rev-0';
let stagedOmitTurn2 = false;
let stagedTurn2UserOnly = false;

function stagePage(
  revision: Revision,
  options: { readonly omitTurn2?: boolean; readonly turn2UserOnly?: boolean } = {},
): void {
  stagedRevision = revision;
  stagedOmitTurn2 = options.omitTurn2 === true;
  stagedTurn2UserOnly = options.turn2UserOnly === true;
}

function installWindow(): void {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    writable: true,
    value: {
      kodaxSpace: {
        invoke: async (channel: string, input: unknown) => {
          const result: PageResponse = {
            ok: true,
            data: {
              items: buildPageItems(stagedRevision, {
                omitTurn2: stagedOmitTurn2,
                turn2UserOnly: stagedTurn2UserOnly,
              }),
              conversation: { status: 'resolved' },
              page: {
                outcome: 'ready',
                revision: stagedRevision,
                sourceRevision: stagedRevision,
                hasMore: false,
                windowMode: 'replace',
                hasNewer: false,
              },
            },
          };
          const owner = input as { readonly sessionId: string; readonly requestId: string };
          void channel;
          return { ...result, data: { ...result.data, sessionId: owner.sessionId, requestId: owner.requestId } };
        },
      },
    },
  });
}

async function seedSession(): Promise<void> {
  SID = `${SID_BASE}-${++seedCounter}`;
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

/** 精确文本流式：canonical 就是流式 delta 原样落盘，逐字一致（避免 certified 合并走 fail-open）。 */
function streamTurn(input: {
  readonly content: string;
  readonly sentAt: number;
  readonly runId: string;
  readonly epoch: string;
  readonly turnId: string;
  readonly thinking: string;
  readonly answerText: string;
}): void {
  const store = useAppStore.getState();
  const messageId = store.appendUserMessage(SID, input.content, input.sentAt);
  assert.ok(messageId);
  store.bindUserMessageRuntimeRun(SID, messageId, input.runId);
  let seq = 0;
  const origin = () => ({
    runtimeId: RUNTIME_ID,
    runId: input.runId,
    journalEpoch: input.epoch,
    seq: (seq += 1),
  });
  store.appendEvent({
    kind: 'session_start',
    sessionId: SID,
    provider: 'mock',
    turnId: input.turnId,
    runtimeEvent: origin(),
  });
  store.appendEvent({
    kind: 'queued_user_prompt_started',
    sessionId: SID,
    queueMode: 'after-turn',
    content: input.content,
    turnId: input.turnId,
  });
  store.appendEvent({
    kind: 'thinking_delta',
    sessionId: SID,
    text: input.thinking,
    turnId: input.turnId,
    runtimeEvent: origin(),
  });
  store.appendEvent({
    kind: 'text_delta',
    sessionId: SID,
    text: input.answerText,
    turnId: input.turnId,
    runtimeEvent: origin(),
  });
  store.appendEvent({
    kind: 'session_complete',
    sessionId: SID,
    turnId: input.turnId,
    runtimeEvent: origin(),
  });
}

/** 真实竞态形态：run terminal 之后才到达的迟到尾 delta（同 run、同 turn、带 providerRequestId）。 */
function appendLateTailDeltas(): void {
  const store = useAppStore.getState();
  store.appendEvent({
    kind: 'text_delta',
    sessionId: SID,
    text: A2_TAIL_1,
    turnId: TURN_2,
    providerRequestId: 'req-sr-run-y',
    runtimeEvent: { runtimeId: RUNTIME_ID, runId: RUN_2, journalEpoch: EPOCH_2, seq: 5 },
  });
  store.appendEvent({
    kind: 'text_delta',
    sessionId: SID,
    text: A2_TAIL_2,
    turnId: TURN_2,
    providerRequestId: 'req-sr-run-y',
    runtimeEvent: { runtimeId: RUNTIME_ID, runId: RUN_2, journalEpoch: EPOCH_2, seq: 6 },
  });
}

function reconcileTurn(runId: string, turnId: string, transcriptRevision: string): Promise<void> {
  return reconcileTerminalSessionHistory({
    sessionId: SID,
    runtimeId: RUNTIME_ID,
    runId,
    phase: 'completed',
    cursorSeq: 99,
    transcriptRevision,
    turnId,
  });
}

/** canonical 滞后形态：reconcile 不带 turnId，读到的页又没有该轮行（证据不带 turnId 也结清）。 */
function reconcileTurnWithoutTurnId(runId: string, transcriptRevision: string): Promise<void> {
  return reconcileTerminalSessionHistory({
    sessionId: SID,
    runtimeId: RUNTIME_ID,
    runId,
    phase: 'completed',
    cursorSeq: 99,
    transcriptRevision,
  });
}

function composedBullets(): string[] {
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
      case 'queued_user':
        return [`queued:${message.content}`];
      case 'system_notice':
        return [`notice:${message.variant}:${message.text.slice(0, 48)}`];
      case 'local_notice':
        return [`notice:${message.content.slice(0, 48)}`];
    }
  });
}

const CANONICAL_BULLETS = [`user:${BG_Q}`, `assistant:${BG_A}`, `user:${Q1_TEXT}`, `assistant:${A1_TEXT}`, `user:${Q2_TEXT}`, `assistant:${A2_FULL}`];

function dumpState(tag: string): void {
  const state = useAppStore.getState();
  console.log(`\n=== ${tag}: composed (${SID}) ===`);
  for (const [index, line] of composedBullets().entries()) console.log(`  [${index}] ${line.slice(0, 48)}`);
  console.log(`=== ${tag}: userMessagesBySession ===`);
  for (const [index, message] of (state.userMessagesBySession[SID] ?? []).entries()) {
    console.log(
      `[${index}] restored=${message.restoredFromHistory === true} turnId=${message.turnId ?? '-'} ` +
        `run=${message.runtimeRunId ?? '-'} hidden=${message.hiddenProjectionDuplicate === true}`,
    );
  }
  console.log(
    `=== ${tag}: text events ===`,
    JSON.stringify(
      (state.eventsBySession[SID] ?? []).map((event) =>
        event.kind === 'text_delta'
          ? `text:${event.text.slice(0, 12)}(run${event.runtimeEvent?.runId ?? '-'}`
          : event.kind,
      ),
    ),
  );
}

/** 结算稳态断言：buffer 无 live 残留行、无 hiddenProjectionDuplicate、canonical 文本各恰 1 份。 */
function assertSettledBuffers(label: string): void {
  const state = useAppStore.getState();
  const users = state.userMessagesBySession[SID] ?? [];
  const events = state.eventsBySession[SID] ?? [];
  const liveRows = users.filter((message) => message.restoredFromHistory !== true);
  assert.deepEqual(
    liveRows.map((message) => [message.turnId ?? '-', message.runtimeRunId ?? '-']),
    [],
    `[${label}] 结算后 userMessagesBySession 仍残留 live 行（删除而非隐藏被违反）`,
  );
  const hiddenFlags = users.filter(
    (message) =>
      message.hiddenProjectionDuplicate === true ||
      message.hiddenHistoryAnchor === true ||
      message.historyNoAssistantSegment === true,
  );
  assert.equal(
    hiddenFlags.length,
    0,
    `[${label}] 结算后 buffer 存在 hiddenProjectionDuplicate 族隐藏残件: ${JSON.stringify(hiddenFlags.map((message) => message.id))}`,
  );
  for (const [name, text] of [
    ['a0', BG_A],
    ['a1', A1_TEXT],
    ['a2', A2_FULL],
  ] as const) {
    const copies = events.filter(
      (event) => event.kind === 'text_delta' && event.text.includes(text),
    ).length;
    assert.equal(
      copies,
      1,
      `[${label}] ${name} 正文在 eventsBySession 中出现 ${copies} 次（应恰 1 —— canonical 页，已收编 live 影子事件应被删除）`,
    );
  }
}

/** 步骤编排：restore rev-0 → live q1 → certified rev-1 → live q2 + 迟到尾 delta → certified rev-2。 */
async function runSettledLifeline(options: { readonly omitTurn2Rows?: boolean } = {}): Promise<void> {
  await seedSession();
  installWindow();
  stagePage('rev-0');
  await restoreNewestSessionHistory(SID, 'code');

  streamTurn({
    content: Q1_TEXT,
    sentAt: REAL_T.q1 + 800,
    runId: RUN_1,
    epoch: 'epoch-run-x',
    turnId: TURN_1,
    thinking: A1_THINKING,
    answerText: A1_TEXT,
  });
  stagePage('rev-1');
  await reconcileTurn(RUN_1, TURN_1, 'transcript-run-x');
  dumpState('after q1 certified rev-1');

  streamTurn({
    content: Q2_TEXT,
    sentAt: REAL_T.q2 + 1_200,
    runId: RUN_2,
    epoch: EPOCH_2,
    turnId: TURN_2,
    thinking: A2_THINKING,
    answerText: A2_HEAD,
  });
  appendLateTailDeltas();
  stagePage('rev-2', { omitTurn2: options.omitTurn2Rows === true });
  if (options.omitTurn2Rows === true) {
    // canonical 滞后：证据里带不上 turnId 行，读取照常结清（页不含该轮行）。
    await reconcileTurnWithoutTurnId(RUN_2, 'transcript-run-y');
  } else {
    await reconcileTurn(RUN_2, TURN_2, 'transcript-run-y');
  }
  dumpState('after q2 certified rev-2');
}

/** 步骤 5：注入权威 live 快照（重水合入口，模拟 Runtime 重连/恢复后再发同一份终态快照）。 */
function pushTerminalSnapshot(): boolean {
  const connection = {
    state: 'ready' as const,
    changedAt: Date.now(),
    stale: false,
    runtimeId: RUNTIME_ID,
    capabilities: [],
  };
  useAppStore.setState({
    runtimeConnection: connection,
    runtimeProfile: {
      connection,
      projectionRevision: 1,
      cursor: { runtimeId: RUNTIME_ID, seq: 0 },
      sessions: [],
      interactions: [],
      notifications: [],
    },
  });
  const projection: SpaceSessionLiveProjectionT = {
    sessionId: SID,
    projectionRevision: 1,
    cursor: { runtimeId: RUNTIME_ID, seq: 7, sessionId: SID, journalEpoch: EPOCH_2 },
    transcriptRevision: 'transcript-run-y',
    lastTerminalRun: {
      runId: RUN_2,
      sessionId: SID,
      turnId: TURN_2,
      phase: 'completed',
      startedAt: Date.parse('2026-08-16T01:10:20.000Z'),
      completedAt: REAL_T.run2Terminal,
    },
    queuedRuns: [],
    queuedInputs: [],
    interactions: [],
    activeTools: [],
    todos: [],
  };
  return useAppStore.getState().replaceSessionLiveProjection(projection, {
    allowEqualHydration: true,
  });
}

test('票5·认证即删除：certified 合并后已收编 live 行/事件从 buffer 物理删除，重装页不复活', async () => {
  await runSettledLifeline();

  // 认证后的稳态 buffer：删除而非隐藏。
  assertSettledBuffers('certified rev-2');
  // composed 投影 == canonical 页（无残件卡）。
  assert.deepEqual(composedBullets(), CANONICAL_BULLETS);

  // 同 revision 重复 revalidate（前台每分钟形态）不引入偏差。
  await revalidateNewestSessionHistory(SID, 'code');
  await revalidateNewestSessionHistory(SID, 'code');
  assertSettledBuffers('after same-revision revalidates');
  assert.deepEqual(composedBullets(), CANONICAL_BULLETS);

  deactivateSessionHistoryPaging(SID);
  resetSessionHistoryPagingLifecycle();
});

test('票5·墓碑防复活：结算后重 admission（快照重水合 + 切走再切回）同身份行不再入场', async () => {
  await runSettledLifeline();
  assert.deepEqual(composedBullets(), CANONICAL_BULLETS);

  // 重 admission 1：同终态快照再次重水合（Runtime 重连后重发同一份投影）。
  const accepted = pushTerminalSnapshot();
  console.log(`tombstone rehydration accepted=${accepted}`);
  dumpState('after snapshot rehydration');
  await revalidateNewestSessionHistory(SID, 'code');
  dumpState('after revalidate post-rehydration');

  // 重 admission 2：切走再切回（deactivate + 重新 restore，重放 rev-2 页）。
  deactivateSessionHistoryPaging(SID);
  stagePage('rev-2');
  await restoreNewestSessionHistory(SID, 'code');
  dumpState('after re-restore rev-2');

  // 墓碑生效：不复活、不重复、不丢内容。
  assertSettledBuffers('after re-admission attempts');
  assert.deepEqual(composedBullets(), CANONICAL_BULLETS);

  deactivateSessionHistoryPaging(SID);
  resetSessionHistoryPagingLifecycle();
});

test('票5·fail-open 不删：canonical 滞后无对手行时 live 轮 coexist 存活，迟到尾 delta 不丢', async () => {
  await runSettledLifeline({ omitTurn2Rows: true });

  // q1 已认证退役；q2 无 canonical 对手（fail-open）→ live 轮保留且完整（含迟到尾句）。
  const state = useAppStore.getState();
  const users = state.userMessagesBySession[SID] ?? [];
  const liveTurn2Rows = users.filter(
    (message) => message.restoredFromHistory !== true && message.turnId === TURN_2,
  );
  assert.equal(
    liveTurn2Rows.length,
    1,
    `fail-open：无 canonical 对手行的 live 轮必须 coexist 存活，实际 ${liveTurn2Rows.length} 行`,
  );
  const bullets = composedBullets();
  console.log(`[fail-open] composed:\n  ${bullets.map((line) => line.slice(0, 40)).join('\n  ')}`);
  const a2Cards = bullets.filter((line) => line.startsWith('assistant:') && line.includes(A2_TAIL_1));
  assert.equal(
    a2Cards.length,
    1,
    `迟到尾 delta 必须在唯一 a2 卡中可见（内容零丢失），实际 ${a2Cards.length} 张卡含尾句`,
  );
  assert.ok(
    bullets.some((line) => line === `assistant:${A2_FULL}` || line.includes(A2_TAIL_2)),
    'a2 卡必须包含迟到尾句全文',
  );
  // q1 已认证退役：无 a1 残件。
  const a1Cards = bullets.filter((line) => line.startsWith('assistant:') && line.includes(A1_TEXT));
  assert.equal(a1Cards.length, 1, `已认证 q1 的 a1 正文应恰 1 卡（影子已退役），实际 ${a1Cards.length}`);

  deactivateSessionHistoryPaging(SID);
  resetSessionHistoryPagingLifecycle();
});

test('票5·刷新等价：逐轮认证渐增路径终态 == 冷 reload 投影', async () => {
  await runSettledLifeline();
  const incrementalFinal = composedBullets();
  deactivateSessionHistoryPaging(SID);
  resetSessionHistoryPagingLifecycle();

  // 冷基线：独立 session 的 fresh store + restore rev-2 终态页。
  await seedSession();
  installWindow();
  stagePage('rev-2');
  await restoreNewestSessionHistory(SID, 'code');
  const coldBaseline = composedBullets();
  deactivateSessionHistoryPaging(SID);
  resetSessionHistoryPagingLifecycle();

  console.log(
    `[equivalence] incremental(${incrementalFinal.length}) vs cold(${coldBaseline.length})`,
  );
  assert.deepEqual(
    incrementalFinal,
    coldBaseline,
    `渐增认证路径终态 ≠ 冷 reload 投影。\n-- 渐增 --\n${incrementalFinal.join('\n')}\n-- 冷 --\n${coldBaseline.join('\n')}`,
  );
  // 双向都钉在 canonical 形状上，防止基线空洞让等价断言 vacuous。
  assert.deepEqual(coldBaseline, CANONICAL_BULLETS);
});

// ---- FEATURE_275 票 6：canonicalPage / liveTail 双平面拆分（P3，装页平面切割）----
//
// 机制：replace 窗口装页时，canonical 页对 closed live 轮的覆盖本身就是结算证据 ——
// authoritative newest 读返回了该 turn 的非 user durable 行（身份在场判据，与 ADR-009
// 认证链同一证据类），据此在装页接缝把页面覆盖区的 live 影子确定性移交 canonical 平面
// （经既有 certified fold：合并 + 物理退役 + 墓碑），live 尾只保留切割点之后的开放轮与
// 身份未收编轮。内存有界：稳态 buffer 无已收编内容的重复副本。

/** 票 6 生命线：restore rev-0 → 纯 live 流完 T1+T2（中间不读页，迟读形态）。 */
async function runLateReadLifeline(): Promise<void> {
  await seedSession();
  installWindow();
  stagePage('rev-0');
  await restoreNewestSessionHistory(SID, 'code');
  streamTurn({
    content: Q1_TEXT,
    sentAt: REAL_T.q1 + 800,
    runId: RUN_1,
    epoch: 'epoch-run-x',
    turnId: TURN_1,
    thinking: A1_THINKING,
    answerText: A1_TEXT,
  });
  streamTurn({
    content: Q2_TEXT,
    sentAt: REAL_T.q2 + 1_200,
    runId: RUN_2,
    epoch: EPOCH_2,
    turnId: TURN_2,
    thinking: A2_THINKING,
    answerText: A2_HEAD,
  });
}

test('票6·装页平面拆分：迟读装页把页面覆盖的 closed live 轮移交 canonical 平面（影子物理退役、内存有界）', async () => {
  await runLateReadLifeline();

  // 一次 revalidate 装 rev-2（覆盖 T1+T2）：无 terminal workflow、无 settledRuntimeRuns，
  // 装页平面切割应把两轮影子整体移交 canonical 平面 —— 删除而非隐藏。
  stagePage('rev-2');
  await revalidateNewestSessionHistory(SID, 'code');
  dumpState('ticket6 after late revalidate rev-2');

  assertSettledBuffers('ticket6 late install rev-2');
  assert.deepEqual(composedBullets(), CANONICAL_BULLETS);

  // 同 revision 重复 revalidate（前台每分钟形态）幂等，不引入偏差、不复活影子。
  await revalidateNewestSessionHistory(SID, 'code');
  assertSettledBuffers('ticket6 after same-revision revalidate');
  assert.deepEqual(composedBullets(), CANONICAL_BULLETS);

  deactivateSessionHistoryPaging(SID);
  resetSessionHistoryPagingLifecycle();
});

test('票6·live 尾边界：装页未覆盖的 closed live 轮留在 live 尾（fail-open，不删不丢），后续装页继续收编', async () => {
  await runLateReadLifeline();

  // 装 rev-1（只覆盖 T1）：T1 影子退役；T2 页面无对手行 → 留在 live 尾完整可见。
  stagePage('rev-1');
  await revalidateNewestSessionHistory(SID, 'code');
  dumpState('ticket6 after revalidate rev-1 (T2 uncovered)');

  const state = useAppStore.getState();
  const users = state.userMessagesBySession[SID] ?? [];
  const liveRows = users.filter((message) => message.restoredFromHistory !== true);
  assert.deepEqual(
    liveRows.map((message) => message.turnId ?? '-'),
    [TURN_2],
    `rev-1 装页后 live 尾应恰剩未覆盖的 T2，实际 ${JSON.stringify(liveRows.map((message) => message.turnId ?? '-'))}`,
  );
  const bullets = composedBullets();
  const a1Cards = bullets.filter((line) => line.startsWith('assistant:') && line.includes(A1_TEXT));
  const a2Cards = bullets.filter((line) => line.startsWith('assistant:') && line.includes(A2_HEAD));
  assert.equal(a1Cards.length, 1, `已收编 T1 的 a1 应恰 1 卡，实际 ${a1Cards.length}`);
  assert.equal(a2Cards.length, 1, `未收编 T2 的 a2 应恰 1 卡（fail-open 保留），实际 ${a2Cards.length}`);
  assert.equal(
    bullets.filter((line) => line === `user:${Q2_TEXT}`).length,
    1,
    'q2 user 行不得出现重复气泡',
  );
  assert.ok(
    bullets.some((line) => line === `assistant:${A2_HEAD}`),
    'live 尾 T2 的已流式正文必须可见',
  );

  // 后续装 rev-2（覆盖 T2）：live 尾继续收编，终态 == canonical 页。
  stagePage('rev-2');
  await revalidateNewestSessionHistory(SID, 'code');
  dumpState('ticket6 after follow-up revalidate rev-2');
  assertSettledBuffers('ticket6 follow-up install rev-2');
  assert.deepEqual(composedBullets(), CANONICAL_BULLETS);

  deactivateSessionHistoryPaging(SID);
  resetSessionHistoryPagingLifecycle();
});

test('票6·204 守卫：user-only 页不结算 —— 页面缺该轮非 user durable 行时 live 内容原样保留', async () => {
  await runLateReadLifeline();

  // 页面只含 T2 的 user 边界（读与落盘竞速形态）：turnId 在场但非 user 行缺席。
  // 认证被扣住（204 守卫），live 内容经 closed-causal 空壳收养保持在 canonical owner 之下
  // —— 观察契约：内容零丢失、无重复气泡、已收编的 T1 照常退役。
  stagePage('rev-2', { turn2UserOnly: true });
  await revalidateNewestSessionHistory(SID, 'code');
  dumpState('ticket6 after user-only-page revalidate');

  const bullets = composedBullets();
  const a1Cards = bullets.filter((line) => line.startsWith('assistant:') && line.includes(A1_TEXT));
  assert.equal(a1Cards.length, 1, `页面完整覆盖的 T1 照常收编，a1 应恰 1 卡，实际 ${a1Cards.length}`);
  const a2Cards = bullets.filter((line) => line.startsWith('assistant:') && line.includes(A2_HEAD));
  assert.equal(a2Cards.length, 1, `a2 正文必须恰 1 卡（user-only 页不得吞掉 live 回答），实际 ${a2Cards.length}`);
  assert.equal(
    bullets.filter((line) => line === `user:${Q2_TEXT}`).length,
    1,
    'q2 user 行不得出现重复气泡',
  );
  assert.ok(
    bullets.includes(`assistant:${A2_HEAD}`),
    'user-only 页缺该轮回答行时 live 内容必须完整可见（Issue 204 红线）',
  );

  deactivateSessionHistoryPaging(SID);
  resetSessionHistoryPagingLifecycle();
});
