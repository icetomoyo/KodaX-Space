/**
 * FEATURE_275 票 4：快照重水合内容完整性。
 *
 * 机制基线（docs/features/v0.1.46.md FEATURE_275 机制基线 #2/#3）：终态快照重水合下
 * `hydrateSessionEventsFromLiveSnapshot` 对携带 providerRequestId 而扫描窗口内无
 * segment-start 标记的 delta 无条件判 stale 删除（`filterEffectiveOutputSegmentEvents`），
 * 而合成补发（`hydrateOutputSegments`）被 `projection.activeRun !== undefined` 门跳过——
 * 纯 lastTerminalRun 快照只删不补 → 已流式显示的正文丢失、孤儿工具芯片；certified
 * canonical 合并（`decideTurnProjectionAuthority` → `mergeIdentityProvenTurnProjections`）
 * 的唯一护栏只查"durable 段为空"，对"非空但内容不对应该 live 轮"的 foreign 页照样
 * 授权清洗 → live 正文被清零。
 *
 * 本文件钉死三条不变量（只经公共观察面断言：store 公共 actions + 分页公共函数驱动，
 * composeMessages 组合投影为唯一观察面，不断言 store 内部状态）：
 *
 * 1. 纯 lastTerminalRun 快照水合后，组合投影不得丢失已流式显示的正文/思考文本，
 *    工具芯片数量不得缩水（M 形态：多段工具轮的 5 段正文 + 4 芯片在快照后原样在场）。
 * 2. stale 删除收敛为"有替代证据才删"：快照段窗口（assistantTextStartOffset>0 或
 *    内容为空）不构成完整对应内容 → live delta 保留，后续窗口化快照能从保留 delta
 *    对账回全文；有完整替代证据（offset 0 + 非空文本）时照常删除并由合成收敛（每段
 *    恰好一份，不重复）。
 * 3. durable 段内容不对应 live 轮（foreign）时，certified 合并不得清洗 live 内容：
 *    宁可暂双份（coexist），由后续票的结算退役收口。
 *
 * 运行：cd apps/desktop && node --test --test-concurrency=1 --import tsx
 *       "electron/test/snapshot-rehydration-content-integrity.test.ts"
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
} from '../../renderer/src/shell/sessionHistoryPaging.js';

const SID_BASE = 'snapshot-rehydration-content-integrity';
let seedCounter = 0;
let SID = SID_BASE;
const CREATED_AT = Date.parse('2026-09-06T10:00:00.000Z');
const RUNTIME_ID = 'rt-rehydration';

// ---- fixture 文本 ----
const PREV_Q = '帮我把上周的分享提纲整理成文档';
const PREV_A = '已整理：提纲按背景、方案、数据三节落进 docs/share-outline.md。';

const Q5_TEXT = '把发布会脚本按五段结构完整写出来，每段之间插一次素材检查';
const LIVE_THINKING = 'Five-segment structure: opening, origin, architecture, cases, roadmap…';
const SEGMENTS = [
  '【第一段·开场】用 30 秒短视频把观众拉回产品诞生的那个夜晚，抛出今天要回答的三个问题。',
  '【第二段·起源】从第一版原型的三次推翻讲起，用时间线呈现关键决策点与背后的取舍逻辑。',
  '【第三段·架构】分层拆解当前的架构设计，用压测对比数据说明每一次性能取舍的代价与收益。',
  '【第四段·案例】两个代表性客户的落地故事：落地前的痛点量化，落地后的效率提升数据。',
  '【第五段·路线图】把下个版本的三个关键能力放进同一条时间线，回扣开场提出的三个问题。',
];
const TOOLS = ['bash', 'edit', 'write', 'todo_update'] as const;

// ============================================================================
// harness（复用 repro 套件纪律：精确文本流式 + 公共 action 驱动 + composed 观察面）
// ============================================================================

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

function installWindow(buildItems: (revision: string) => SessionHistoryItem[]): void {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    writable: true,
    value: {
      kodaxSpace: {
        invoke: async (_channel: string, input: unknown) => {
          const owner = input as { readonly sessionId: string; readonly requestId: string };
          const result = pageResponse(buildItems(lastRequestedRevision), lastRequestedRevision);
          return {
            ...result,
            data: {
              ...result.data,
              sessionId: owner.sessionId,
              requestId: owner.requestId,
            },
          };
        },
      },
    },
  });
}

let lastRequestedRevision = 'rev-0';

async function seedSession(label: string): Promise<void> {
  SID = `${SID_BASE}-${label}-${++seedCounter}`;
  lastRequestedRevision = 'rev-0';
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
function seedRuntimeAuthority(): void {
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
}

// ---- composed 投影观察面（全文，不截断）----
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

function assistantCardsContaining(snippet: string): number {
  const state = useAppStore.getState();
  return composeMessages({
    events: state.eventsBySession[SID] ?? [],
    userMessages: state.userMessagesBySession[SID] ?? [],
  }).filter((message) => message.kind === 'assistant_text' && message.text.includes(snippet))
    .length;
}

function thinkingCardsContaining(snippet: string): number {
  const state = useAppStore.getState();
  return composeMessages({
    events: state.eventsBySession[SID] ?? [],
    userMessages: state.userMessagesBySession[SID] ?? [],
  }).filter((message) => message.kind === 'assistant_text' && message.thinking?.includes(snippet))
    .length;
}

function dumpComposed(tag: string): void {
  console.log(`=== ${tag}: composed (${SID}) ===`);
  for (const [index, line] of composedLines().entries()) console.log(`  [${index}] ${line}`);
}

// ---- canonical 页 builders ----
function prevTurnItems(): SessionHistoryItem[] {
  return [
    {
      kind: 'user',
      content: PREV_Q,
      sentAt: CREATED_AT,
      entryId: 'entry_rh_prev_u',
      canonicalIndex: 0,
      turnId: 'turn_rh_prev',
      turnUserOrdinal: 0,
    },
    {
      kind: 'assistant',
      text: PREV_A,
      sentAt: CREATED_AT + 20_000,
      entryId: 'entry_rh_prev_a',
      canonicalIndex: 1,
      turnId: 'turn_rh_prev',
    },
  ];
}

/** query5 轮的 canonical 行：5 条 assistant item + 4 条 tool_call item，与流式逐字一致。 */
function turn5Items(turnId: string, thinkingPrefix = 'Compose segment'): SessionHistoryItem[] {
  const items: SessionHistoryItem[] = [
    {
      kind: 'user',
      content: Q5_TEXT,
      sentAt: CREATED_AT + 8 * 60_000,
      entryId: `entry_${turnId}_u`,
      canonicalIndex: 8,
      turnId,
      turnUserOrdinal: 0,
    },
  ];
  let index = 9;
  for (let segment = 0; segment < SEGMENTS.length; segment++) {
    items.push({
      kind: 'assistant',
      text: SEGMENTS[segment]!,
      thinking: `${thinkingPrefix} ${segment + 1} of the launch script…`,
      sentAt: CREATED_AT + index * 30_000,
      entryId: `entry_${turnId}_seg${segment + 1}`,
      canonicalIndex: index,
      turnId,
    });
    index += 1;
    if (segment < TOOLS.length) {
      items.push({
        kind: 'tool_call',
        toolId: `call_rh_tool_${segment + 1}`,
        toolName: TOOLS[segment]!,
        input: { target: `segment-${segment + 1}` },
        result: 'ok',
        entryId: `entry_${turnId}_tool${segment + 1}`,
        canonicalIndex: index,
        turnId,
      });
      index += 1;
    }
  }
  return items;
}

// ---- live 流式（多段工具轮，生产事件序：session_start → queued 排水标记 → 内容 → terminal）----
interface StreamOptions {
  readonly runId: string;
  readonly epoch: string;
  readonly turnId: string;
  /** false = 不带 after-turn 排水边界（单段轮用）。 */
  readonly withQueuedBoundary?: boolean;
  /** 段正文 delta 的 providerRequestId 前缀；undefined = 不带 providerRequestId。 */
  readonly providerRequestPrefix?: string;
  /** false = 不带工具段（单段轮用）。 */
  readonly withTools?: boolean;
  /** 单段模式：SEGMENTS[0] 拆两个 delta 流式。 */
  readonly singleSegment?: { readonly parts: readonly [string, string] };
}

function streamTurn(options: StreamOptions): void {
  const store = useAppStore.getState();
  const messageId = store.appendUserMessage(SID, Q5_TEXT, CREATED_AT + 7 * 60_000);
  assert.ok(messageId);
  store.bindUserMessageRuntimeRun(SID, messageId, options.runId);
  let seq = 0;
  const origin = () => ({
    runtimeId: RUNTIME_ID,
    runId: options.runId,
    journalEpoch: options.epoch,
    seq: (seq += 1),
  });
  store.appendEvent({
    kind: 'session_start',
    sessionId: SID,
    provider: 'mock',
    turnId: options.turnId,
    runtimeEvent: origin(),
  });
  if (options.withQueuedBoundary !== false) {
    store.appendEvent({
      kind: 'queued_user_prompt_started',
      sessionId: SID,
      queueMode: 'after-turn',
      content: Q5_TEXT,
      turnId: options.turnId,
    });
  }
  store.appendEvent({
    kind: 'thinking_delta',
    sessionId: SID,
    text: LIVE_THINKING,
    turnId: options.turnId,
    runtimeEvent: origin(),
  });
  if (options.singleSegment !== undefined) {
    const request =
      options.providerRequestPrefix === undefined
        ? undefined
        : `${options.providerRequestPrefix}-1`;
    for (const part of options.singleSegment.parts) {
      store.appendEvent({
        kind: 'text_delta',
        sessionId: SID,
        text: part,
        turnId: options.turnId,
        ...(request !== undefined ? { providerRequestId: request } : {}),
        runtimeEvent: origin(),
      });
    }
  } else {
    const segmentCount = options.withTools === false ? SEGMENTS.length : SEGMENTS.length;
    for (let segment = 0; segment < segmentCount; segment++) {
      store.appendEvent({
        kind: 'text_delta',
        sessionId: SID,
        text: SEGMENTS[segment]!,
        turnId: options.turnId,
        ...(options.providerRequestPrefix === undefined
          ? {}
          : { providerRequestId: `${options.providerRequestPrefix}-${segment + 1}` }),
        runtimeEvent: origin(),
      });
      if (options.withTools !== false && segment < TOOLS.length) {
        store.appendEvent({
          kind: 'tool_start',
          sessionId: SID,
          toolId: `call_rh_tool_${segment + 1}`,
          toolName: TOOLS[segment]!,
          input: { target: `segment-${segment + 1}` },
          turnId: options.turnId,
          runtimeEvent: origin(),
        });
        store.appendEvent({
          kind: 'tool_result',
          sessionId: SID,
          toolId: `call_rh_tool_${segment + 1}`,
          toolName: TOOLS[segment]!,
          content: 'ok',
          turnId: options.turnId,
          runtimeEvent: origin(),
        });
      }
    }
  }
  store.appendEvent({
    kind: 'session_complete',
    sessionId: SID,
    turnId: options.turnId,
    runtimeEvent: origin(),
  });
}

/**
 * 纯 lastTerminalRun 快照（activeRun=undefined）。segments 携带 retained 段的完整
 * 文本窗口（append 协议 = 完成段累加）；undefined = 快照不带 segment 元数据。
 */
function terminalSnapshot(input: {
  readonly runId: string;
  readonly epoch: string;
  readonly turnId: string;
  readonly cursorSeq: number;
  readonly segments?: ReadonlyArray<{
    readonly providerRequestId: string;
    readonly assistantText: string;
    readonly assistantTextStartOffset: number;
  }>;
  readonly projectionRevision?: number;
}): boolean {
  seedRuntimeAuthority();
  const projection: SpaceSessionLiveProjectionT = {
    sessionId: SID,
    projectionRevision: input.projectionRevision ?? 1,
    cursor: { runtimeId: RUNTIME_ID, seq: input.cursorSeq, sessionId: SID, journalEpoch: input.epoch },
    transcriptRevision: `transcript-${input.runId}`,
    lastTerminalRun: {
      runId: input.runId,
      sessionId: SID,
      turnId: input.turnId,
      phase: 'completed',
      startedAt: CREATED_AT + 7 * 60_000,
      completedAt: CREATED_AT + 9 * 60_000,
    },
    queuedRuns: [],
    queuedInputs: [],
    interactions: [],
    activeTools: [],
    todos: [],
    ...(input.segments === undefined
      ? {}
      : {
          outputSegment: {
            retained: input.segments.map((segment) => ({
              responseId: `resp-${input.runId}`,
              mode: 'append' as const,
              startedAtSeq: undefined,
              thinkingText: '',
              thinkingTextStartOffset: 0,
              ...segment,
            })),
          },
        }),
  };
  return useAppStore.getState().replaceSessionLiveProjection(projection, {
    allowEqualHydration: true,
  });
}

// 五段流式的事件 seq 布局：session_start=1 thinking=2 seg1=3 t1s=4 t1r=5 seg2=6 … seg5=15 complete=16
const FIVE_SEGMENT_LAST_SEQ = 16;

// ============================================================================
// Red 1：纯 lastTerminalRun 快照水合后正文/思考/芯片完整在场（M 形态）
// ============================================================================

test('红1·纯 lastTerminalRun 快照（有完整替代证据）：正文五段与思考水合后不丢失，芯片不缩水', async () => {
  await seedSession('rehydrate-keeps-content');
  installWindow((revision) => (revision === 'rev-0' ? prevTurnItems() : [...prevTurnItems(), ...turn5Items('turn_rh_t5')]));
  await restoreNewestSessionHistory(SID, 'code');

  streamTurn({ runId: 'run-rh-1', epoch: 'epoch-rh-1', turnId: 'turn_rh_t5', providerRequestPrefix: 'req-rh' });
  dumpComposed('红1 after streaming five-segment turn');
  const streamed = composedLines();
  // 流式期间正文必须已在场（本用例的前提条件；无 segment 标记时由合成快照恢复显示）。
  assert.equal(streamed.filter((line) => line.startsWith('tool:')).length, TOOLS.length);

  const accepted = terminalSnapshot({
    runId: 'run-rh-1',
    epoch: 'epoch-rh-1',
    turnId: 'turn_rh_t5',
    cursorSeq: FIVE_SEGMENT_LAST_SEQ,
    segments: SEGMENTS.map((text, index) => ({
      providerRequestId: `req-rh-${index + 1}`,
      assistantText: text,
      assistantTextStartOffset: 0,
    })),
  });
  assert.ok(accepted);
  dumpComposed('红1 after pure-lastTerminalRun snapshot');

  const transcript = composedLines();
  const q5Index = transcript.indexOf(`user:${Q5_TEXT}`);
  assert.ok(q5Index >= 0, `query5 可见:\n${transcript.join('\n')}`);
  // 失败门 (a)：query5 之前不得出现任何携带正文段的 assistant 卡。
  const ghosts = transcript
    .slice(0, q5Index)
    .filter((line) => line.startsWith('assistant:') && SEGMENTS.some((s) => line.includes(s.slice(0, 12))));
  assert.deepEqual(ghosts, [], `正文段不得骑到 query5 之上:\n${transcript.join('\n')}`);
  // 失败门 (b)：芯片数量保持 4（不得因孤儿/合并而缩水或翻倍）。
  assert.equal(
    transcript.filter((line) => line.startsWith('tool:')).length,
    TOOLS.length,
    `tool 芯片必须保持 ${TOOLS.length} 枚:\n${transcript.join('\n')}`,
  );
  // 失败门 (c)：五段正文每段恰好一张卡、全部在 query5 之下（正文丢失 → 0，翻倍 → 2）。
  for (const segment of SEGMENTS) {
    assert.equal(
      assistantCardsContaining(segment.slice(0, 12)),
      1,
      `段正文必须恰好渲染一次:\n${transcript.join('\n')}`,
    );
    assert.ok(
      transcript.indexOf(`assistant:${segment}`) > q5Index,
      `段正文必须在 query5 之下:\n${transcript.join('\n')}`,
    );
  }
  // 思考文本不得丢失。
  assert.equal(thinkingCardsContaining(LIVE_THINKING.slice(0, 16)), 1);

  deactivateSessionHistoryPaging(SID);
  resetSessionHistoryPagingLifecycle();
});

// ============================================================================
// Red 2：无替代证据的 stale 删除不得静默删内容（保留的 delta 可被后续对账恢复）
// ============================================================================

test('红2·无替代证据（段窗口 offset>0）：live delta 保留，窗口化合成从保留 delta 对账回全文', async () => {
  await seedSession('stale-needs-evidence');
  installWindow(() => prevTurnItems());
  await restoreNewestSessionHistory(SID, 'code');

  const head = '第一段正文的前半句，';
  const tail = '描述窗口外内容的后半句。';
  streamTurn({
    runId: 'run-rh-2',
    epoch: 'epoch-rh-2',
    turnId: 'turn_rh_t2',
    providerRequestPrefix: 'req-rh2',
    withQueuedBoundary: false,
    withTools: false,
    singleSegment: { parts: [head, tail] },
  });
  // seq: session_start=1 thinking=2 part1=3 part2=4 complete=5
  // 快照 A：无替代证据（retained 段的 assistantText 为空）→ HEAD 无条件删除 delta；
  // 修复后必须保留（live delta 是渲染端唯一的该段内容副本）。
  assert.ok(
    terminalSnapshot({
      runId: 'run-rh-2',
      epoch: 'epoch-rh-2',
      turnId: 'turn_rh_t2',
      cursorSeq: 5,
      segments: [{ providerRequestId: 'req-rh2-1', assistantText: '', assistantTextStartOffset: 0 }],
      projectionRevision: 1,
    }),
  );
  // 快照 B：窗口化合成（SDK 段窗口丢失头部：assistantText 只含尾段，startOffset 标记
  // 窗口起点）。有保留 delta 时对账必须还原全文；HEAD 因快照 A 已删 delta 只剩尾段。
  assert.ok(
    terminalSnapshot({
      runId: 'run-rh-2',
      epoch: 'epoch-rh-2',
      turnId: 'turn_rh_t2',
      cursorSeq: 5,
      segments: [
        {
          providerRequestId: 'req-rh2-1',
          assistantText: tail,
          assistantTextStartOffset: head.length,
        },
      ],
      projectionRevision: 2,
    }),
  );
  dumpComposed('红2 after windowed synthesis snapshot');

  const cards = composeMessages({
    events: useAppStore.getState().eventsBySession[SID] ?? [],
    userMessages: useAppStore.getState().userMessagesBySession[SID] ?? [],
  }).filter((message) => message.kind === 'assistant_text' && message.text.length > 0);
  const full = cards.filter((message) =>
    message.kind === 'assistant_text' && message.text.includes(`${head}${tail}`),
  );
  assert.equal(
    full.length,
    1,
    `窗口外正文必须从保留 delta 对账恢复（无替代证据不得删）。\n-- cards --\n${cards
      .map((message) => (message.kind === 'assistant_text' ? message.text : ''))
      .join('\n')}`,
  );

  deactivateSessionHistoryPaging(SID);
  resetSessionHistoryPagingLifecycle();
});

// ============================================================================
// Red 3：durable 段为 foreign 内容时，certified 合并不得清洗 live 内容
// ============================================================================

test('红3·certified 合并内容对应性：durable 段是 foreign 内容时 live 正文不得被清零', async () => {
  await seedSession('foreign-durable');
  const FOREIGN_A = '（foreign）这一页记录的是另一条会话的回答，与本 live 轮内容无对应关系。';
  installWindow((revision) => {
    if (revision === 'rev-0') return prevTurnItems();
    // 同一 turnId/同 user 内容的行，但 assistant 正文与工具全是 foreign 内容。
    return [
      ...prevTurnItems(),
      {
        kind: 'user' as const,
        content: Q5_TEXT,
        sentAt: CREATED_AT + 8 * 60_000,
        entryId: 'entry_rh_foreign_u',
        canonicalIndex: 8,
        turnId: 'turn_rh_foreign',
        turnUserOrdinal: 0,
      },
      {
        kind: 'assistant' as const,
        text: FOREIGN_A,
        thinking: 'Foreign thinking that never corresponds to the live draft.',
        sentAt: CREATED_AT + 9 * 60_000,
        entryId: 'entry_rh_foreign_a',
        canonicalIndex: 9,
        turnId: 'turn_rh_foreign',
      },
      {
        kind: 'tool_call' as const,
        toolId: 'call_foreign_x',
        toolName: 'read',
        input: { path: 'somewhere/else' },
        result: 'foreign result',
        entryId: 'entry_rh_foreign_t',
        canonicalIndex: 10,
        turnId: 'turn_rh_foreign',
      },
    ];
  });
  await restoreNewestSessionHistory(SID, 'code');

  // live 轮：与 foreign 页同 turnId（身份配对成立），但内容完全自分。
  streamTurn({
    runId: 'run-rh-3',
    epoch: 'epoch-rh-3',
    turnId: 'turn_rh_foreign',
    withQueuedBoundary: false,
    withTools: false,
    singleSegment: { parts: ['真实回答：发布会脚本的五段正文', '已经按你的要求全部写完。'] },
  });
  // terminal 认证读：page 携带该 turn 的 assistant 行（身份确认 → settled run →
  // certified authority 在场），但 durable 内容与 live 不对应。
  lastRequestedRevision = 'rev-1';
  await reconcileTerminalSessionHistory({
    sessionId: SID,
    runtimeId: RUNTIME_ID,
    runId: 'run-rh-3',
    phase: 'completed',
    cursorSeq: 5,
    transcriptRevision: 'transcript-rh-3',
    turnId: 'turn_rh_foreign',
  });
  dumpComposed('红3 after certified foreign page');

  // live 正文必须仍在场（HEAD 症状：certified 清洗把 live 文本清零 → 0 张卡）。
  assert.equal(
    assistantCardsContaining('真实回答：发布会脚本的五段正文'),
    1,
    `foreign durable 不得清洗 live 正文:\n${composedLines().join('\n')}`,
  );
  deactivateSessionHistoryPaging(SID);
  resetSessionHistoryPagingLifecycle();
});

// ============================================================================
// 红4：M 形态完整链路——快照重水合 + terminal 认证读之后芯片与正文收敛
// ============================================================================

test('红4·M 形态：纯 lastTerminalRun 快照 + 认证读后，五段正文一份不少、芯片 4 不翻倍', async () => {
  await seedSession('m-shape-settled');
  installWindow((revision) =>
    revision === 'rev-0' ? prevTurnItems() : [...prevTurnItems(), ...turn5Items('turn_rh_t5')],
  );
  await restoreNewestSessionHistory(SID, 'code');

  streamTurn({ runId: 'run-rh-4', epoch: 'epoch-rh-4', turnId: 'turn_rh_t5', providerRequestPrefix: 'req-rh4' });
  assert.ok(
    terminalSnapshot({
      runId: 'run-rh-4',
      epoch: 'epoch-rh-4',
      turnId: 'turn_rh_t5',
      cursorSeq: FIVE_SEGMENT_LAST_SEQ,
      segments: SEGMENTS.map((text, index) => ({
        providerRequestId: `req-rh4-${index + 1}`,
        assistantText: text,
        assistantTextStartOffset: 0,
      })),
    }),
  );

  lastRequestedRevision = 'rev-1';
  await reconcileTerminalSessionHistory({
    sessionId: SID,
    runtimeId: RUNTIME_ID,
    runId: 'run-rh-4',
    phase: 'completed',
    cursorSeq: FIVE_SEGMENT_LAST_SEQ,
    transcriptRevision: 'transcript-rh-4',
    turnId: 'turn_rh_t5',
  });
  dumpComposed('红4 after certified rev-1');

  const transcript = composedLines();
  const q5Index = transcript.indexOf(`user:${Q5_TEXT}`);
  assert.ok(q5Index >= 0, `query5 可见:\n${transcript.join('\n')}`);
  const ghosts = transcript
    .slice(0, q5Index)
    .filter((line) => line.startsWith('assistant:') && SEGMENTS.some((s) => line.includes(s.slice(0, 12))));
  assert.deepEqual(ghosts, [], `正文段不得骑到 query5 之上:\n${transcript.join('\n')}`);
  assert.equal(
    transcript.filter((line) => line.startsWith('tool:')).length,
    TOOLS.length,
    `认证读后芯片必须收敛为 ${TOOLS.length} 枚（8≠4 缺陷形态不得复现）:\n${transcript.join('\n')}`,
  );
  for (const segment of SEGMENTS) {
    assert.equal(
      assistantCardsContaining(segment.slice(0, 12)),
      1,
      `认证读后每段正文恰好一次（live 残件不得翻倍正文）:\n${transcript.join('\n')}`,
    );
  }
  deactivateSessionHistoryPaging(SID);
  resetSessionHistoryPagingLifecycle();
});
