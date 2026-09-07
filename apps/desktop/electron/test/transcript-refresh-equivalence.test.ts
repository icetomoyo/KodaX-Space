/**
 * FEATURE_275 票 1：刷新等价性属性测试（Ctrl+R 等价）+ golden fixture。
 *
 * 属性定义：
 *   同一 session 生命线（背景轮 turn_BG → T1 → T2），任意渐增路径到达同一终态
 *   （canonical rev-2 页安装完毕）后的最终 composed 投影，必须与冷 reload
 *   （fresh store + restoreNewestSessionHistory 装同一 rev-2 终态页）的投影逐行相等。
 *
 * golden fixture：对齐真实客户 session 20260816_110200_432759c1554ee5 的时序（真实毫秒）：
 *   turn_8860b0bc18424193 背景轮（1 user + 1 assistant + 2 tool_call，canonicalIndex 60-63）
 *   turn_4cbd9ec8cf71403b q1 01:09:41.527Z → a1（单 assistant entry：thinking+text）01:10:03.394Z
 *   turn_041d7c13178c4975 q2 01:10:21.800Z → a2（thinking+text，尾句 = 最后两个 delta）
 *     01:10:38.680Z
 *   终态 canonical 页 rev-2 = 上述全部 item（canonicalIndex 连续）；
 *   rev-1 = rev-2 减去 T2 行；rev-0 = 仅背景轮。
 *
 * reminder 建模（T0 遗留偏差的修正，只在本文件按正确语义建模）：
 *   真实管线里 <system-reminder> 纯文本 user 条目是 SDK 合成消息，electron/ipc/session.ts
 *   拍平 items 时被 `if (synthetic) continue` 丢弃 —— canonical 页里根本没有对应 item，
 *   永不出现为可见 user 卡。本 fixture 因此不构造 reminder user item（T0 repro 套件把
 *   reminder 建成可见 user item 属 harness 失真，旧套件按原状保留、不改）。
 *
 * 渐增路径清单（每条路径独立 seedSession，终态都到 rev-2，最终投影互比 + 与冷 restore 比）：
 *   pathA·逐轮认证：restore rev-0 → live T1 → reconcile 装 rev-1 → live T2 → reconcile 装 rev-2
 *   pathB·迟读：restore rev-0 → live T1 → live T2（中间不读页）→ 最后一次 revalidate 装 rev-2
 *   pathC·同 revision 重验：pathA 中每次装页后追加 2 次 revalidate（同 revision 重读，
 *     验证幂等不引入偏差）
 *   pathD·先 live 后 canonical：不预先 restore，纯 live 流完 T1+T2 → restore 装 rev-2
 *   pathE·切走再切回：pathA 中途 deactivateSessionHistoryPaging + 重新
 *     restoreNewestSessionHistory（模拟切会话往返）再继续
 *
 * 冷基线：独立 sessionId 的 fresh store + restoreNewestSessionHistory 装 rev-2 终态页
 *   → userBullets()。fixture 自检测试额外把冷基线钉在 canonical 顺序上，防止基线本身
 *   空洞导致等价断言退化为 vacuous。
 *
 * allowlist 语义（HEAD 已知偏差门）：
 *   每条路径 final vs 冷基线做 LCS 逐行 diff。diff 为空 → 该路径通过；
 *   非空 → 必须与 ALLOWLIST[path]（排序后的 "expected:<行>||actual:<行>" 数组）完全一致，
 *   否则红（新偏差 = 回归）。P1 排序单一化 / P2 结算即退役 / P3 双平面拆分落地后
 *   ALLOWLIST 应逐步清零（票 2/5/6 验收）。
 *
 * allowlist 现状（2026-09-07，FEATURE_275 票 4 后保持 5 路径 × 3 行）：
 *   票 1 落地时 5 条路径全部命中同一 3 行残件 diff（closed live 轮在 canonical rev-2 装页后
 *   不被清除 → 渐增终态 11 行 vs 冷基线 8 行，a1 ×2、q2 ×2、a2 ×2，Issue 208 机制族）。
 *   票 4 的主验收是 M 失败门簇（芯片 8≠4、正文丢失）转绿，由水合补发 + 空壳段的孤儿尾
 *   归属（transcriptTurnSnapshots，见 appStore 票 4 注释）+ 工具执行痕迹认证护栏达成；
 *   本名单描述的多轮 live 尾装页残差属于另一机制分支（跨轮错位段，票 4 的归属规则刻意
 *   不碰它），按 DAG 由票 5 结算即退役 / 票 6 双平面拆分收口。位置翻转族（B1 interrupt
 *   delivery 等）由 L/M 失败门负责证明；本测试当前形态 = 等价性红门（名单外 diff 即回归）。
 *
 * live 流式保真：text_delta 逐段拼接与 canonical assistant item 的 text 逐字一致
 *   （canonical 就是流式 delta 原样落盘；拼固定前缀会让 certified 合并走 fail-open，
 *   属于 harness 失真 —— 与 L 套件 streamLTurn 同一纪律）。a2 的最后两个 delta 恰为
 *   尾句，与真实 journal（01:10:38.532 / 01:10:38.595）一致。
 *
 * 运行：cd apps/desktop && node --test --test-concurrency=1 --import tsx
 *       "electron/test/transcript-refresh-equivalence.test.ts"
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { SessionHistoryItem } from '@kodax-space/space-ipc-schema';
import { composeMessages } from '../../renderer/src/features/session/composeMessages.js';
import { useAppStore } from '../../renderer/src/store/appStore.js';
import {
  deactivateSessionHistoryPaging,
  reconcileTerminalSessionHistory,
  resetSessionHistoryPagingLifecycle,
  restoreNewestSessionHistory,
  revalidateNewestSessionHistory,
} from '../../renderer/src/shell/sessionHistoryPaging.js';

const SID_BASE = 'transcript-refresh-equivalence';
let seedCounter = 0;
let SID = SID_BASE;
const CREATED_AT = Date.parse('2026-08-16T01:05:00.000Z'); // 客户 session 的本地启动时间

// ---- golden fixture 真实时序（epoch ms，客户 session 20260816_110200_432759c1554ee5）----
const GOLD_T = {
  bgDone: Date.parse('2026-08-16T01:07:52.931Z'), // turn_8860 终态
  q1: Date.parse('2026-08-16T01:09:41.527Z'), // T1 query
  a1: Date.parse('2026-08-16T01:10:03.394Z'), // T1 回答（单 assistant entry）
  q2: Date.parse('2026-08-16T01:10:21.800Z'), // T2 query
  a2: Date.parse('2026-08-16T01:10:38.680Z'), // T2 回答
  run2Terminal: Date.parse('2026-08-16T01:10:44.494Z'), // run_mtqjnc8r_38e86d14 terminal
};
const BG_QUERY = GOLD_T.bgDone - 180_000;
const BG_ANSWER = GOLD_T.bgDone - 120_000;

const TURN_BG = 'turn_8860b0bc18424193';
const TURN_T1 = 'turn_4cbd9ec8cf71403b';
const TURN_T2 = 'turn_041d7c13178c4975';
const RUNTIME_ID = 'rt-golden';
const RUN_1 = 'run-gold-t1';
const RUN_2 = 'run-gold-t2';

// ---- golden fixture 文本（q1/q2/尾句为客户原话；assistant 正文为对位占位）----
const GOLD_BG_Q = '把昨天评审会定下的三条叙事线整理成待办，同步到项目看板里';
const GOLD_BG_A =
  '已整理完成：三条叙事线全部进入待办清单，并标注了优先级与责任区块，后续按顺序推进。';
const GOLD_Q1 = '9分钟？这么长时间？会不会太不紧凑了？';
const GOLD_A1_THINKING =
  'The video currently runs 9 minutes. The user worries it feels stretched. Plan: tighten the opening to 30 seconds, drop one example per segment, target under 6 minutes without losing key data…';
const GOLD_A1 =
  '确实偏长。可以把开场压到 30 秒、三段各删一个例子，总时长收回到 6 分钟以内，数据支撑不受影响。';
const GOLD_Q2 = '你说的2分钟的视频又是什么？';
const GOLD_A2_THINKING =
  'Clarify the 2-minute cut: same script, condensed to conclusion sentences and data points only, suited for social channels. Close with an offer to enumerate valid versions…';
const GOLD_A2_HEAD =
  '2 分钟版是同一套脚本的高浓缩剪辑：只保留三条叙事线的结论句和数据点，去掉过程叙述，适合社媒投放。';
// 真实 journal 里 a2 的最后两个 delta 恰为这两句尾句（01:10:38.532 / 01:10:38.595）。
const GOLD_A2_TAIL_1 = '要不要我先把这套视频的“现在到底哪几个版本是有效的”';
const GOLD_A2_TAIL_2 = '理一份清单给您，再决定哪条线继续打磨？';
const GOLD_A2_FULL = `${GOLD_A2_HEAD}${GOLD_A2_TAIL_1}${GOLD_A2_TAIL_2}`;

type GoldenRevision = 'rev-0' | 'rev-1' | 'rev-2';

/** golden canonical 页：rev-0 = 背景轮；rev-1 = +T1；rev-2 = +T2（canonicalIndex 连续 60-67）。 */
function buildGoldenItems(revision: GoldenRevision): SessionHistoryItem[] {
  const bg: SessionHistoryItem[] = [
    {
      kind: 'user',
      content: GOLD_BG_Q,
      sentAt: BG_QUERY,
      entryId: 'entry_gold_bg_u',
      canonicalIndex: 60,
      turnId: TURN_BG,
      turnUserOrdinal: 0,
    },
    {
      kind: 'assistant',
      text: GOLD_BG_A,
      thinking: '整理评审会结论为待办清单…',
      sentAt: BG_ANSWER,
      entryId: 'entry_gold_bg_a',
      canonicalIndex: 61,
      turnId: TURN_BG,
    },
    {
      kind: 'tool_call',
      toolId: 'call_gold_bg_todo',
      toolName: 'todo_create',
      result: '{"ok":true,"id":"todo_gold_1"}',
      entryId: 'entry_gold_bg_t1',
      canonicalIndex: 62,
      turnId: TURN_BG,
    },
    {
      kind: 'tool_call',
      toolId: 'call_gold_bg_bash',
      toolName: 'bash',
      input: { command: 'kodax board sync --board review-2026-08-15' },
      result: 'synced 3 items',
      entryId: 'entry_gold_bg_t2',
      canonicalIndex: 63,
      turnId: TURN_BG,
    },
  ];
  const t1: SessionHistoryItem[] = [
    {
      kind: 'user',
      content: GOLD_Q1,
      sentAt: GOLD_T.q1,
      entryId: 'entry_gold_q1_u',
      canonicalIndex: 64,
      turnId: TURN_T1,
      turnUserOrdinal: 0,
    },
    {
      kind: 'assistant',
      text: GOLD_A1,
      thinking: GOLD_A1_THINKING,
      sentAt: GOLD_T.a1,
      entryId: 'entry_gold_q1_a',
      canonicalIndex: 65,
      turnId: TURN_T1,
    },
  ];
  const t2: SessionHistoryItem[] = [
    {
      kind: 'user',
      content: GOLD_Q2,
      sentAt: GOLD_T.q2,
      entryId: 'entry_gold_q2_u',
      canonicalIndex: 66,
      turnId: TURN_T2,
      turnUserOrdinal: 0,
    },
    {
      kind: 'assistant',
      text: GOLD_A2_FULL,
      thinking: GOLD_A2_THINKING,
      sentAt: GOLD_T.a2,
      entryId: 'entry_gold_q2_a',
      canonicalIndex: 67,
      turnId: TURN_T2,
    },
  ];
  return revision === 'rev-0' ? bg : revision === 'rev-1' ? [...bg, ...t1] : [...bg, ...t1, ...t2];
}

interface GoldenPageResponse {
  readonly ok: true;
  readonly data: {
    readonly items: SessionHistoryItem[];
    readonly conversation: { readonly status: 'resolved' };
    readonly page: {
      readonly outcome: 'ready';
      readonly revision: GoldenRevision;
      readonly sourceRevision: GoldenRevision;
      readonly hasMore: false;
      readonly windowMode: 'replace';
      readonly hasNewer: false;
    };
  };
}

function goldenPageResponse(revision: GoldenRevision): GoldenPageResponse {
  return {
    ok: true,
    data: {
      items: buildGoldenItems(revision),
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

function mockHistoryInvoke(handler: (channel: string, input: unknown) => unknown) {
  return async (channel: string, input: unknown) => {
    const result = handler(channel, input) as GoldenPageResponse;
    const owner = input as { readonly sessionId: string; readonly requestId: string };
    return {
      ...result,
      data: { ...result.data, sessionId: owner.sessionId, requestId: owner.requestId },
    };
  };
}

// 页内容用"暂存"而非按调用序号调度：每次装页前 stage 一次， paging 函数内部读几次都拿到
// 同一页，harness 与分页函数的调用次数解耦。
let stagedRevision: GoldenRevision = 'rev-0';
function stagePage(revision: GoldenRevision): void {
  stagedRevision = revision;
}

function installGoldenWindow(): void {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    writable: true,
    value: {
      kodaxSpace: {
        invoke: mockHistoryInvoke(() => goldenPageResponse(stagedRevision)),
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

/**
 * 精确文本流式：optimistic user → session_start → queued_user_prompt_started →
 * thinking_delta → text_delta×N（拼接 == canonical text）→ session_complete。
 * 乐观 sentAt = canonical 服务端时间 + 典型本地钟偏移（生产三种时钟混排的最小形态）。
 */
function streamGoldenTurn(input: {
  readonly content: string;
  readonly sentAt: number;
  readonly runId: string;
  readonly epoch: string;
  readonly turnId: string;
  readonly thinking: string;
  readonly textParts: readonly string[];
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
  for (const part of input.textParts) {
    store.appendEvent({
      kind: 'text_delta',
      sessionId: SID,
      text: part,
      turnId: input.turnId,
      runtimeEvent: origin(),
    });
  }
  store.appendEvent({
    kind: 'session_complete',
    sessionId: SID,
    turnId: input.turnId,
    runtimeEvent: origin(),
  });
}

/** composed 投影逐行化（全文，不截断：等价性属性同时看顺序与内容完整性）。 */
function userBullets(): string[] {
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

function dumpProjection(tag: string): void {
  console.log(`=== ${tag}: composed (${SID}) ===`);
  for (const [index, line] of userBullets().entries()) console.log(`  [${index}] ${line}`);
}

/** 冷基线：独立 sessionId 的 fresh store + restore rev-2 终态页。 */
async function coldBaselineBullets(): Promise<string[]> {
  await seedSession('cold');
  stagePage('rev-2');
  await restoreNewestSessionHistory(SID, 'code');
  const bullets = userBullets();
  deactivateSessionHistoryPaging(SID);
  resetSessionHistoryPagingLifecycle();
  return bullets;
}

/** 逐行 diff（LCS 最小编辑）。返回排序后的偏差记录；单边缺失记 ∅。 */
function diffProjectionLines(expected: readonly string[], actual: readonly string[]): string[] {
  const n = expected.length;
  const m = actual.length;
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      lcs[i][j] =
        expected[i] === actual[j]
          ? lcs[i + 1][j + 1] + 1
          : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  const deletions: string[] = [];
  const insertions: string[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (expected[i] === actual[j]) {
      i += 1;
      j += 1;
      continue;
    }
    if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      deletions.push(expected[i]);
      i += 1;
    } else {
      insertions.push(actual[j]);
      j += 1;
    }
  }
  while (i < n) {
    deletions.push(expected[i]);
    i += 1;
  }
  while (j < m) {
    insertions.push(actual[j]);
    j += 1;
  }
  const lines: string[] = [];
  const paired = Math.min(deletions.length, insertions.length);
  for (let k = 0; k < paired; k += 1) {
    lines.push(`expected:${deletions[k]}||actual:${insertions[k]}`);
  }
  for (let k = paired; k < deletions.length; k += 1) {
    lines.push(`expected:${deletions[k]}||actual:∅`);
  }
  for (let k = paired; k < insertions.length; k += 1) {
    lines.push(`expected:∅||actual:${insertions[k]}`);
  }
  return lines.sort();
}

type EquivalencePath = 'pathA' | 'pathB' | 'pathC' | 'pathD' | 'pathE';

/**
 * HEAD（2026-09-07 实测）5 条路径共同命中的残件 diff（排序后）：
 * closed live 轮的 3 行（live a1 残件、live q2、live a2）在 canonical rev-2 装页后不被清除。
 * 最终投影 = 冷基线 8 行 + 这 3 行 live 残件；行内容来自 fixture 常量，避免转写漂移。
 */
// FEATURE_275 票 4（2026-09-07）：closed live 轮的 3 行残件在本票后保持原样 —— 票 4 的
// 段归属修复（transcriptTurnSnapshots 在"段不含外来轮内容且尾全同 turnId"时重新归属孤儿尾）
// 只作用于单 live 轮尾形态（M 失败门的芯片 8≠4 / 正文丢失簇，已转绿）；多轮 live 尾的
// 渐增装页残差（本名单）按 DAG 属于票 5 结算即退役 / 票 6 双平面拆分的收口范围。
// 行内容来自 fixture 常量，避免转写漂移；任何名单之外的 diff = 回归红门。
const HEAD_RESIDUE_DIFF: readonly string[] = [
  `expected:∅||actual:assistant:${GOLD_A2_FULL}`,
  `expected:∅||actual:assistant:${GOLD_A1}`,
  `expected:∅||actual:user:${GOLD_Q2}`,
];

/**
 * HEAD 已知 live/canonical 投影偏差按路径登记；出现 allowlist 之外的新偏差 → 测试红。
 * P2/P3 落地后逐路径清零（票 4 修复的是 M 失败门簇，本名单留给票 5/6）。
 */
const ALLOWLIST: Record<EquivalencePath, readonly string[]> = {
  pathA: HEAD_RESIDUE_DIFF,
  pathB: HEAD_RESIDUE_DIFF,
  pathC: HEAD_RESIDUE_DIFF,
  pathD: HEAD_RESIDUE_DIFF,
  pathE: HEAD_RESIDUE_DIFF,
};

async function assertRefreshEquivalence(
  path: EquivalencePath,
  pathFinal: readonly string[],
): Promise<void> {
  const baseline = await coldBaselineBullets();
  const diff = diffProjectionLines(baseline, pathFinal);
  console.log(`[${path}] final(${pathFinal.length} 行) vs 冷基线(${baseline.length} 行)：diff ${diff.length} 条`);
  for (const line of diff) console.log(`  [${path}] ${line}`);
  assert.deepEqual(
    diff,
    [...ALLOWLIST[path]].sort(),
    `路径 ${path} 出现 allowlist 之外的刷新等价性偏差（渐增终态 ≠ 冷 reload）。\n` +
      `-- 冷基线 --\n${baseline.join('\n')}\n` +
      `-- 渐增终态 --\n${pathFinal.join('\n')}\n` +
      `-- diff --\n${diff.join('\n')}`,
  );
}

// ---- golden fixture 各轮的 live 流式参数（文本与 canonical item 逐字一致）----
function streamTurn1(): void {
  streamGoldenTurn({
    content: GOLD_Q1,
    sentAt: GOLD_T.q1 + 800, // 本地钟典型毫秒偏移
    runId: RUN_1,
    epoch: 'epoch-run-gold-t1',
    turnId: TURN_T1,
    thinking: GOLD_A1_THINKING,
    textParts: [GOLD_A1],
  });
}

function streamTurn2(): void {
  streamGoldenTurn({
    content: GOLD_Q2,
    sentAt: GOLD_T.q2 + 1_200,
    runId: RUN_2,
    epoch: 'epoch-run-gold-t2',
    turnId: TURN_T2,
    thinking: GOLD_A2_THINKING,
    textParts: [GOLD_A2_HEAD, GOLD_A2_TAIL_1, GOLD_A2_TAIL_2], // 尾句 = 最后两个 delta
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

// fixture 自检钉死冷基线形状：canonical 页 restore 的投影必须就是 canonical 顺序，
// 防止基线空洞（如 restore 静默失败）让等价断言退化为 vacuous。
const GOLDEN_CANONICAL_BULLETS = [
  `user:${GOLD_BG_Q}`,
  `assistant:${GOLD_BG_A}`,
  'tool:todo_create',
  'tool:bash',
  `user:${GOLD_Q1}`,
  `assistant:${GOLD_A1}`,
  `user:${GOLD_Q2}`,
  `assistant:${GOLD_A2_FULL}`,
];

test('fixture·冷基线自检：rev-2 终态页 restore 投影 == canonical 顺序', async () => {
  installGoldenWindow();
  const baseline = await coldBaselineBullets();
  dumpProjection('fixture cold baseline');
  assert.deepEqual(baseline, GOLDEN_CANONICAL_BULLETS);
});

test('pathA·逐轮认证：restore rev-0 → live T1 → reconcile rev-1 → live T2 → reconcile rev-2', async () => {
  await seedSession('pathA');
  installGoldenWindow();
  stagePage('rev-0');
  await restoreNewestSessionHistory(SID, 'code');

  streamTurn1();
  stagePage('rev-1');
  await reconcileTurn(RUN_1, TURN_T1, 'transcript-run-gold-t1');
  dumpProjection('pathA after T1 certified rev-1');

  streamTurn2();
  stagePage('rev-2');
  await reconcileTurn(RUN_2, TURN_T2, 'transcript-run-gold-t2');
  dumpProjection('pathA after T2 certified rev-2');

  const pathFinal = userBullets();
  deactivateSessionHistoryPaging(SID);
  resetSessionHistoryPagingLifecycle();
  await assertRefreshEquivalence('pathA', pathFinal);
});

test('pathB·迟读：restore rev-0 → live T1 → live T2 → 一次 revalidate 装 rev-2', async () => {
  await seedSession('pathB');
  installGoldenWindow();
  stagePage('rev-0');
  await restoreNewestSessionHistory(SID, 'code');

  streamTurn1();
  streamTurn2(); // 中间不读页
  stagePage('rev-2');
  await revalidateNewestSessionHistory(SID, 'code');
  dumpProjection('pathB after late revalidate rev-2');

  const pathFinal = userBullets();
  deactivateSessionHistoryPaging(SID);
  resetSessionHistoryPagingLifecycle();
  await assertRefreshEquivalence('pathB', pathFinal);
});

test('pathC·同 revision 重验：pathA 每次装页后追加 2 次 revalidate（幂等）', async () => {
  await seedSession('pathC');
  installGoldenWindow();
  stagePage('rev-0');
  await restoreNewestSessionHistory(SID, 'code');

  streamTurn1();
  stagePage('rev-1');
  await reconcileTurn(RUN_1, TURN_T1, 'transcript-run-gold-t1');
  // 同 revision 重读 ×2（前台每分钟 ~2 次的重复 revalidate；alpha.6 幂等守卫应使投影不动）
  await revalidateNewestSessionHistory(SID, 'code');
  await revalidateNewestSessionHistory(SID, 'code');
  dumpProjection('pathC after T1 certified rev-1 + 2 same-revision revalidates');

  streamTurn2();
  stagePage('rev-2');
  await reconcileTurn(RUN_2, TURN_T2, 'transcript-run-gold-t2');
  await revalidateNewestSessionHistory(SID, 'code');
  await revalidateNewestSessionHistory(SID, 'code');
  dumpProjection('pathC after T2 certified rev-2 + 2 same-revision revalidates');

  const pathFinal = userBullets();
  deactivateSessionHistoryPaging(SID);
  resetSessionHistoryPagingLifecycle();
  await assertRefreshEquivalence('pathC', pathFinal);
});

test('pathD·先 live 后 canonical：不 restore，纯 live 流完 T1+T2 → restore 装 rev-2', async () => {
  await seedSession('pathD');
  installGoldenWindow();

  streamTurn1();
  streamTurn2(); // 两轮都到 session_complete，全程无 canonical 读
  stagePage('rev-2');
  await restoreNewestSessionHistory(SID, 'code');
  dumpProjection('pathD after post-hoc restore rev-2');

  const pathFinal = userBullets();
  deactivateSessionHistoryPaging(SID);
  resetSessionHistoryPagingLifecycle();
  await assertRefreshEquivalence('pathD', pathFinal);
});

test('pathE·切走再切回：pathA 中途 deactivate + 重新 restore（rev-1）再继续', async () => {
  await seedSession('pathE');
  installGoldenWindow();
  stagePage('rev-0');
  await restoreNewestSessionHistory(SID, 'code');

  streamTurn1();
  stagePage('rev-1');
  await reconcileTurn(RUN_1, TURN_T1, 'transcript-run-gold-t1');

  // 模拟切会话往返：离开当前视图（deactivate）→ 切回（重新 restore，仍读到 rev-1）
  deactivateSessionHistoryPaging(SID);
  stagePage('rev-1');
  await restoreNewestSessionHistory(SID, 'code');
  dumpProjection('pathE after deactivate + re-restore rev-1');

  streamTurn2();
  stagePage('rev-2');
  await reconcileTurn(RUN_2, TURN_T2, 'transcript-run-gold-t2');
  dumpProjection('pathE after T2 certified rev-2');

  const pathFinal = userBullets();
  deactivateSessionHistoryPaging(SID);
  resetSessionHistoryPagingLifecycle();
  await assertRefreshEquivalence('pathE', pathFinal);
});
