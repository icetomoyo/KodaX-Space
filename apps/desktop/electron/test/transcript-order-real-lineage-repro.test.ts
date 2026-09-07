/**
 * 对抗性复现：真实会话 lineage（20260905_100939_ct9f3d224aaf44，idx 150-182）驱动的
 * 渲染器排序翻转。症状：用户在旧 query X（turn_67ccd32638c345dd，已回答）约 5 分钟后
 * 发送新 query Y（turn_526ec7e082a74329），X 的 query 气泡出现在自己回答之下、Y 之上。
 * Ctrl+R（全新 restore + compose）后顺序正确。
 *
 * 复现结果（见 J）：
 *   canonical 页安装 X 段后（X query ord=0 + <system-reminder> user 行 ord=1），
 *   同 turnId 的 delivery boundary（queued_user_prompt_started / mid_turn_user_prompt）
 *   再到达且无匹配 queued 条目时：
 *     appStore.ts appendEvent(7844-7924) → promoteQueuedUserMessageForPrompt idx===-1 分支
 *     (5964,6009-6029) 以 identity{turnId, resolveLiveUserOrdinal()} 铸造新可见 user ——
 *     resolveLiveUserOrdinal(5142) 把 canonical 行也计入 → 铸出 ord=2；
 *     sentAt = nextUserMessageSentAtAfter(4400) = 墙钟 now。
 *   composeMessages(composeMessages.ts 175-200) 按 sentAt 排序 → 铸造气泡落到
 *   X 最终回答之下、Y 之上；段配对（positional）随之吃走下一段 —— 乱序。
 *
 * 运行：cd apps/desktop && node --test --test-concurrency=1 --import tsx  *       "electron/test/transcript-order-real-lineage-repro.test.ts"
 * （J 预期失败 = 缺陷在场的证明；A-I 为排除矩阵，均应通过。）
 *
 * items 语义完全按 electron/ipc/session.ts 的转换规则手工还原：
 *   - tool_result(user-role) 条目 → 不产 item（被第一步 toolResults map 吸收）
 *   - <system-reminder> 纯文本 user 条目 → 可见 user item（同 turnId、turnUserOrdinal=1）
 *   - sentAt = Date.parse(message.timestamp)；turnId = message.turnId
 *   - turnUserOrdinal 按 visibleTurnUserOrdinalsByCanonicalIndex（每 turn 的可见 user 序号）
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

const SID_BASE = 'transcript-order-real-lineage-repro';
let seedCounter = 0;
let SID = SID_BASE;
const CREATED_AT = Date.parse('2026-09-05T02:09:39.000Z'); // session id 里的本地启动时间

// ---- 真实 lineage 时间戳（epoch ms）----
const T = {
  prevUser: Date.parse('2026-09-05T03:36:42.248Z'), // idx 151 turn_98527ad23b7e45a0
  prevWork: Date.parse('2026-09-05T03:38:10.323Z'), // idx 152
  prevWork2: Date.parse('2026-09-05T03:38:49.933Z'), // idx 154
  prevWork3: Date.parse('2026-09-05T03:39:11.376Z'), // idx 156
  xQuery: Date.parse('2026-09-05T03:39:33.399Z'), // idx 158 X query
  xWork1: Date.parse('2026-09-05T03:41:43.921Z'), // idx 159
  xReminder: Date.parse('2026-09-05T03:41:54.404Z'), // idx 161 <system-reminder>
  xWork2: Date.parse('2026-09-05T03:42:09.565Z'), // idx 162
  xWork3: Date.parse('2026-09-05T03:42:48.324Z'), // idx 164
  xWork4: Date.parse('2026-09-05T03:43:34.578Z'), // idx 166
  xWork5: Date.parse('2026-09-05T03:43:50.985Z'), // idx 168
  xWork6: Date.parse('2026-09-05T03:44:05.647Z'), // idx 170
  xWork7: Date.parse('2026-09-05T03:44:26.387Z'), // idx 172
  xWork8: Date.parse('2026-09-05T03:44:37.033Z'), // idx 174
  xWork9: Date.parse('2026-09-05T03:44:48.282Z'), // idx 176
  xWork10: Date.parse('2026-09-05T03:45:16.008Z'), // idx 178
  xFinal: Date.parse('2026-09-05T03:45:34.966Z'), // idx 180 X 最终回答
  yServer: Date.parse('2026-09-05T03:50:37.710Z'), // idx 182 Y query（canonical）
};

const TURN_PREV = 'turn_98527ad23b7e45a0';
const TURN_X = 'turn_67ccd32638c345dd';
const TURN_Y = 'turn_526ec7e082a74329';
const RUN_Y = 'run-y-live';

const X_QUERY_TEXT = '原来你改的代码的问题，请你恢复，我要用despseek原始的源码，然后你更新好插件，然后保证能运行';
const X_REMINDER_TEXT =
  '<system-reminder>\nYou just completed a real work tool call (bash) while the visible todo list has pending items but no item marked in_progress.\nFirst pending item: todo_1: 恢复 deepseek-harness 原始源码.\n…</system-reminder>';
const X_FINAL_TEXT = '全部完成，按你的要求执行：\n\n## ① deepseek-harness 已恢复原始源码\n- 还原了 apps/cli/src/bin.ts…';
const Y_TEXT = '请你看下 dsh 的代码和远端是不是一致了。 插件更新完没问题后提交并推送。插件该更新的就更新完。';

// ---- canonical window 的 canonicalIndex：与 lineage idx 对齐（151-182）----

function buildXSegmentItems(): SessionHistoryItem[] {
  const items: SessionHistoryItem[] = [];
  // —— 前一轮 tail（turn_98527ad23b7e45a0），让页面不是从 turn 边界开始 ——
  items.push({
    kind: 'user',
    content: '这个插件源代码应该在这个地址，也是我开发的： C:\\Works\\GitProj\\dsh_workflow',
    sentAt: T.prevUser,
    entryId: 'entry_f2301d0f7f27',
    canonicalIndex: 151,
    turnId: TURN_PREV,
    turnUserOrdinal: 0,
  });
  items.push({
    kind: 'assistant',
    text: '明白,方向转到插件侧。先摸清 `dsh_workflow` 当前状态。',
    thinking: 'The user confirms: the plugin source code is at dsh_workflow…',
    sentAt: T.prevWork,
    entryId: 'entry_0dd63a88e103',
    canonicalIndex: 152,
    turnId: TURN_PREV,
  });
  items.push({
    kind: 'tool_call',
    toolId: 'call_47d7426b516141509abbf868',
    toolName: 'bash',
    input: { command: 'git -C … log --oneline -6' },
    result: 'Command: git -C … 804e4c3 chore: release v0.1.3',
    entryId: 'entry_a0fd1b74902d',
    canonicalIndex: 153,
    turnId: TURN_PREV,
  });
  items.push({
    kind: 'assistant',
    text: '插件仓库已经领先了:本地 HEAD 是 **v0.1.3**，已迁移到 public harness。',
    sentAt: T.prevWork2,
    entryId: 'entry_90dade13a5c9',
    canonicalIndex: 154,
    turnId: TURN_PREV,
  });
  items.push({
    kind: 'tool_call',
    toolId: 'call_b0ecf71a6761477c962d0e9d',
    toolName: 'bash',
    input: { command: 'Move-Item node_modules node_modules.dev-residue-bak' },
    result: 'MOVED=0',
    entryId: 'entry_9152cd8956d7',
    canonicalIndex: 155,
    turnId: TURN_PREV,
  });
  items.push({
    kind: 'assistant',
    text: '残留已隔离,bundle 的全部 peer 现在解析到**当前 harness workspace**。现在启动验证 `pnpm dsh web`。',
    sentAt: T.prevWork3,
    entryId: 'entry_affa4b9f5db1',
    canonicalIndex: 156,
    turnId: TURN_PREV,
  });
  // idx 157 是前一轮 tool_result（user-role）→ 不产 item。

  // —— X turn（turn_67ccd32638c345dd）——
  items.push({
    kind: 'user',
    content: X_QUERY_TEXT,
    sentAt: T.xQuery,
    entryId: 'entry_277648fd47b0',
    canonicalIndex: 158,
    turnId: TURN_X,
    turnUserOrdinal: 0,
  });
  items.push({
    kind: 'assistant',
    text: '收到，按你的要求执行：① 恢复 deepseek-harness 原始源码 ② 更新插件 ③ 保证能运行。',
    thinking: 'The user now says clearly: 1. revert… 2. update plugin… 3. ensure it runs…',
    sentAt: T.xWork1,
    entryId: 'entry_04008b84d5b5',
    canonicalIndex: 159,
    turnId: TURN_X,
  });
  items.push({
    kind: 'tool_call',
    toolId: 'call_8df1584c4a6c481481da41e0',
    toolName: 'todo_create',
    result: '{"ok":true,"id":"todo_1"}',
    entryId: 'entry_b0cbabb4756b',
    canonicalIndex: 160,
    turnId: TURN_X,
  });
  // idx 160/163/165/167/169/171/173/175/177/179 tool_result（user-role）→ 不产 item。
  // idx 161 <system-reminder>：纯文本 user 条目 → 可见 user item（同 turn，ordinal 1）。
  items.push({
    kind: 'user',
    content: X_REMINDER_TEXT,
    sentAt: T.xReminder,
    entryId: 'entry_5bdec7ee79da',
    canonicalIndex: 161,
    turnId: TURN_X,
    turnUserOrdinal: 1,
  });
  items.push({
    kind: 'assistant',
    text: 'PowerShell 需要引号包住 @{u}。重试 push 状态探测，同时标记 todo_1 in_progress 并开始还原。',
    thinking: 'PowerShell choked on @{u} (hash literal). Quote it…',
    sentAt: T.xWork2,
    entryId: 'entry_42cb669f2c37',
    canonicalIndex: 162,
    turnId: TURN_X,
  });
  items.push({
    kind: 'tool_call',
    toolId: 'call_34c2db3ca30d4f0bbdca91f3',
    toolName: 'todo_update',
    result: '{"ok":true}',
    entryId: 'entry_6ce972907e50',
    canonicalIndex: 163,
    turnId: TURN_X,
  });
  items.push({
    kind: 'assistant',
    text: 'harness 已恢复原始(只剩会话暂存目录)，插件 v0.1.3 tag 已在 GitHub。检查远端默认分支。',
    sentAt: T.xWork3,
    entryId: 'entry_17eb06817772',
    canonicalIndex: 164,
    turnId: TURN_X,
  });
  items.push({
    kind: 'assistant',
    text: '远端有 **v0.1.3 tag**(804e4c3,与本地一致)。改 profile 依赖到该 tag。',
    sentAt: T.xWork4,
    entryId: 'entry_d215a9d6145f',
    canonicalIndex: 166,
    turnId: TURN_X,
  });
  items.push({
    kind: 'tool_call',
    toolId: 'call_5f82d016dabe471790425728',
    toolName: 'edit',
    isError: true,
    result: '[Tool Error] edit: Trusted text mutation target is outside the Runtime write roots',
    entryId: 'entry_6b385408f5fe',
    canonicalIndex: 167,
    turnId: TURN_X,
  });
  items.push({
    kind: 'assistant',
    text: 'edit 工具写不了 workspace 外的路径，改用 PowerShell 替换 profile 里的依赖版本。',
    sentAt: T.xWork5,
    entryId: 'entry_f5d005da73c1',
    canonicalIndex: 168,
    turnId: TURN_X,
  });
  items.push({
    kind: 'tool_call',
    toolId: 'call_e43050a5a8e64c4b866e6962',
    toolName: 'bash',
    input: { command: 'pnpm install --no-frozen-lockfile' },
    result: 'Lockfile passes supply-chain policies (8 entries in 8…)',
    entryId: 'entry_17da41f76e4e',
    canonicalIndex: 170,
    turnId: TURN_X,
  });
  items.push({
    kind: 'assistant',
    text: '插件 v0.1.3 干净落地(无残留、peer 全部指向当前 harness)。检查 compatibility.json。',
    sentAt: T.xWork8,
    entryId: 'entry_a4ca65f4925c',
    canonicalIndex: 174,
    turnId: TURN_X,
  });
  items.push({
    kind: 'assistant',
    text: '构建完成。验证构建产物已无守卫残留，然后做最终运行验证。',
    sentAt: T.xWork9,
    entryId: 'entry_94c2ce0e1ac2',
    canonicalIndex: 176,
    turnId: TURN_X,
  });
  items.push({
    kind: 'tool_call',
    toolId: 'call_9c878733a2c1463797a721d3',
    toolName: 'bash',
    input: { command: 'Select-String lib/bin.js source-launch-guard' },
    result: 'lib-bin-has-guard=False; built in 3.23s',
    entryId: 'entry_8fcac7548754',
    canonicalIndex: 177,
    turnId: TURN_X,
  });
  items.push({
    kind: 'tool_call',
    toolId: 'call_5ad9bdd897334feca570de27',
    toolName: 'todo_update',
    result: '{"ok":true,"reminder":"All plan-list items are now in a terminal state…"}',
    entryId: 'entry_e1b560aa8780',
    canonicalIndex: 179,
    turnId: TURN_X,
  });
  items.push({
    kind: 'assistant',
    text: X_FINAL_TEXT,
    thinking: 'All done and verified. Write the final summary in Chinese, no more tool calls.',
    sentAt: T.xFinal,
    entryId: 'entry_ad890c5602b1',
    canonicalIndex: 180,
    turnId: TURN_X,
  });
  // idx 181 memory_outcome_digest → 无 message，不产 item。
  return items;
}


/** canonical 里 X 发出之前的状态（只有前一轮 tail，rev-0）。 */
function buildPrevTurnItems(): SessionHistoryItem[] {
  return buildXSegmentItems().slice(0, 6); // 前 6 项 = turn_98527ad23b7e45a0 tail
}

function withYUserItem(items: SessionHistoryItem[]): SessionHistoryItem[] {
  return [
    ...items,
    {
      kind: 'user',
      content: Y_TEXT,
      sentAt: T.yServer,
      entryId: 'entry_b95ee05124c0',
      canonicalIndex: 182,
      turnId: TURN_Y,
      turnUserOrdinal: 0,
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

/** 与 installWindow 相同，但第 N 次调用可切换 revision 与 items（rev-1 = X 完整无 Y；rev-2 = 含 Y user 行）。
 *  boundedPage=true 时页面从 X query 项开始并带 history_truncation（模拟 64 条有界窗口）。 */
function installWindowSequential(
  options: { readonly boundedPage?: boolean } = {},
): void {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    writable: true,
    value: {
      kodaxSpace: {
        invoke: mockHistoryInvoke(() => {
          const revision = windowRevisionForCall();
          let items = revision === 'rev-0' ? buildPrevTurnItems() : buildXSegmentItems();
          if (options.boundedPage === true) {
            // 有界窗口：从 X query（canonicalIndex 158）开始，前面 158 条被省略。
            items = items.filter((item) => ('canonicalIndex' in item ? (item.canonicalIndex ?? 0) >= 158 : true));
            items = [
              { kind: 'history_truncation', scope: 'history', omittedItems: 158 },
              ...items,
            ];
          }
          return pageResponse(revision === 'rev-2' ? withYUserItem(items) : items, revision);
        }),
      },
    },
  });
}

/** 在 store 里流式直播一轮完整的 live turn（乐观 user + session_start + deltas + complete）。 */
function streamLiveTurn(input: {
  readonly content: string;
  readonly sentAt: number;
  readonly runId: string;
  readonly turnId: string;
  readonly answerText: string;
  readonly withTool?: boolean;
}): string {
  const store = useAppStore.getState();
  const messageId = store.appendUserMessage(SID, input.content, input.sentAt);
  assert.ok(messageId);
  store.bindUserMessageRuntimeRun(SID, messageId, input.runId);
  const seq = (n: number) => ({
    runtimeId: 'rt-live',
    runId: input.runId,
    journalEpoch: `epoch-${input.runId}`,
    seq: n,
  });
  // startRun 的 session_start 先绑定乐观 user 的 turn 身份，after-turn drain 的
  // queued_user_prompt_started 随后到达（此时 promoteQueuedUserMessageForPrompt 的
  // alreadyRendered 幂等检查可命中，不再新建第二个气泡）。
  store.appendEvent({
    kind: 'session_start',
    sessionId: SID,
    provider: 'mock',
    turnId: input.turnId,
    runtimeEvent: seq(1),
  });
  store.appendEvent({
    kind: 'queued_user_prompt_started',
    sessionId: SID,
    queueMode: 'after-turn',
    content: input.content,
    turnId: input.turnId,
  });
  let n = 2;
  store.appendEvent({
    kind: 'thinking_delta',
    sessionId: SID,
    text: '先分析需求…',
    turnId: input.turnId,
    runtimeEvent: seq(n++),
  });
  store.appendEvent({
    kind: 'text_delta',
    sessionId: SID,
    text: '收到，按你的要求执行：',
    turnId: input.turnId,
    runtimeEvent: seq(n++),
  });
  if (input.withTool === true) {
    store.appendEvent({
      kind: 'tool_start',
      sessionId: SID,
      toolId: `tool-${input.runId}`,
      toolName: 'bash',
      input: { command: 'git status' },
      turnId: input.turnId,
      runtimeEvent: seq(n++),
    });
    store.appendEvent({
      kind: 'tool_result',
      sessionId: SID,
      toolId: `tool-${input.runId}`,
      toolName: 'bash',
      content: 'nothing to commit',
      turnId: input.turnId,
      runtimeEvent: seq(n++),
    });
  }
  store.appendEvent({
    kind: 'text_delta',
    sessionId: SID,
    text: input.answerText,
    turnId: input.turnId,
    runtimeEvent: seq(n++),
  });
  store.appendEvent({
    kind: 'session_complete',
    sessionId: SID,
    turnId: input.turnId,
    runtimeEvent: seq(n++),
  });
  return messageId;
}

function mockHistoryInvoke(handler: (channel: string, input: unknown) => unknown) {
  return async (channel: string, input: unknown) => {
    const result = handler(channel, input) as PageResponse;
    const owner = input as { readonly sessionId: string; readonly requestId: string };
    return {
      ...result,
      data: { ...result.data, sessionId: owner.sessionId, requestId: owner.requestId },
    };
  };
}

function installWindow(): void {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    writable: true,
    value: {
      kodaxSpace: {
        invoke: mockHistoryInvoke(() => {
          const revision = windowRevisionForCall();
          const xItems = buildXSegmentItems();
          // rev-2：canonical 已落 Y 的 user 行（lineage idx 182）
          return pageResponse(
            revision === 'rev-2' ? withYUserItem(xItems) : xItems,
            revision,
          );
        }),
      },
    },
  });
}

let revisionByCall: string[] = [];
let callIndex = 0;
function windowRevisionForCall(): string {
  const revision = revisionByCall[Math.min(callIndex, revisionByCall.length - 1)] ?? 'rev-1';
  callIndex += 1;
  return revision;
}

function userBullets(): string[] {
  const state = useAppStore.getState();
  return composeMessages({
    events: state.eventsBySession[SID] ?? [],
    userMessages: state.userMessagesBySession[SID] ?? [],
  }).flatMap((message) => {
    if (message.kind === 'user') return [`user:${message.content.slice(0, 24)}`];
    if (message.kind === 'assistant_text') return [`assistant:${message.text.slice(0, 24)}`];
    if (message.kind === 'tool_call') return [`tool:${message.toolName}`];
    return [];
  });
}

function dumpUserMessages(tag: string): void {
  const users = useAppStore.getState().userMessagesBySession[SID] ?? [];
  console.log(`\n=== ${tag}: userMessagesBySession ===`);
  for (const [index, message] of users.entries()) {
    console.log(
      `[${index}] sentAt=${message.sentAt} (${new Date(message.sentAt).toISOString()}) ` +
        `content=${JSON.stringify(message.content.slice(0, 20))} ` +
        `restored=${message.restoredFromHistory === true} turnId=${message.turnId ?? '-'} ` +
        `ord=${message.turnUserOrdinal ?? '-'} run=${message.runtimeRunId ?? '-'} ` +
        `hidden=${message.hiddenHistoryAnchor === true || message.hiddenProjectionDuplicate === true} ` +
        `noSeg=${message.historyNoAssistantSegment === true}`,
    );
  }
  console.log(`=== ${tag}: composed ===`);
  for (const line of userBullets()) console.log(`  ${line}`);
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

test('A. restore 安装 X 段后顺序正确（基线断言）', async () => {
  await seedSession();
  revisionByCall = ['rev-1'];
  callIndex = 0;
  installWindow();
  await restoreNewestSessionHistory(SID, 'code');
  dumpUserMessages('A after restore');

  const transcript = userBullets();
  const xQueryIndex = transcript.indexOf(`user:${X_QUERY_TEXT.slice(0, 24)}`);
  const xFinalIndex = transcript.indexOf(`assistant:${X_FINAL_TEXT.slice(0, 24)}`);
  const reminderIndex = transcript.indexOf(`user:${X_REMINDER_TEXT.slice(0, 24)}`);
  assert.ok(xQueryIndex >= 0, 'X query 可见');
  assert.ok(xFinalIndex >= 0, 'X 最终回答可见');
  assert.ok(
    xQueryIndex < xFinalIndex,
    `X query 必须在 X 回答之前:\n${transcript.join('\n')}`,
  );
  assert.ok(reminderIndex > xQueryIndex, 'reminder 在 X query 之后');
  deactivateSessionHistoryPaging(SID);
  resetSessionHistoryPagingLifecycle();
});

test('B. 发送 Y（乐观 + live 流）→ 同 revision 二次读 → 检查 X 顺序', async () => {
  await seedSession();
  revisionByCall = ['rev-1'];
  callIndex = 0;
  installWindow();
  await restoreNewestSessionHistory(SID, 'code');
  const before = userBullets();

  // —— 模拟发送 Y：乐观 user message（本地时钟，≥ 服务端时间 5 分钟 + 时钟差）——
  const store = useAppStore.getState();
  const ySentAt = Date.now(); // 本地时钟：晚于一切服务端 canonical 时间
  const yMessageId = store.appendUserMessage(SID, Y_TEXT, ySentAt);
  assert.ok(yMessageId);
  store.bindUserMessageRuntimeRun(SID, yMessageId, RUN_Y);
  store.appendEvent({
    kind: 'session_start',
    sessionId: SID,
    provider: 'mock',
    turnId: TURN_Y,
    runtimeEvent: { runtimeId: 'rt-live', runId: RUN_Y, journalEpoch: 'epoch-y', seq: 1 },
  });
  store.appendEvent({
    kind: 'queued_user_prompt_started',
    sessionId: SID,
    queueMode: 'after-turn',
    content: Y_TEXT,
    turnId: TURN_Y,
  });
  store.appendEvent({
    kind: 'thinking_delta',
    sessionId: SID,
    text: '先对比本地与远端…',
    turnId: TURN_Y,
    runtimeEvent: { runtimeId: 'rt-live', runId: RUN_Y, journalEpoch: 'epoch-y', seq: 2 },
  });
  // live 投影 activeRun（Y 正在运行）
  useAppStore.setState({
    liveProjectionBySession: {
      [SID]: {
        sessionId: SID,
        projectionRevision: 1,
        cursor: { runtimeId: 'rt-live', seq: 2 },
        transcriptRevision: 'transcript-y',
        queuedRuns: [],
        activeRun: {
          runId: RUN_Y,
          sessionId: SID,
          phase: 'running' as const,
          startedAt: ySentAt,
          turnId: TURN_Y,
        },
        activeTools: [],
        todos: [],
        queuedInputs: [],
        interactions: [],
      },
    },
  });

  // —— 二次 canonical 读：同 revision（Y 尚无 canonical 条目）——
  callIndex = 0;
  await revalidateNewestSessionHistory(SID, 'code');
  dumpUserMessages('B after same-revision revalidate');
  const after = userBullets();
  const xQueryIndex = after.indexOf(`user:${X_QUERY_TEXT.slice(0, 24)}`);
  const xFinalIndex = after.indexOf(`assistant:${X_FINAL_TEXT.slice(0, 24)}`);
  const yIndex = after.findIndex((line) => line.startsWith(`user:${Y_TEXT.slice(0, 24)}`));
  assert.ok(xQueryIndex >= 0 && xFinalIndex >= 0);
  assert.ok(
    xQueryIndex < xFinalIndex,
    `翻转复现：X query 排到自己回答之下。\n-- 翻转前 --\n${before.join('\n')}\n-- 翻转后 --\n${after.join('\n')}`,
  );
  assert.ok(yIndex > xQueryIndex, 'Y 在 X 之后');
  deactivateSessionHistoryPaging(SID);
  resetSessionHistoryPagingLifecycle();
});

test('C. 发送 Y → 含 Y user item 的新 revision 二次读 → 检查 X 顺序', async () => {
  await seedSession();
  revisionByCall = ['rev-1'];
  callIndex = 0;
  installWindow();
  await restoreNewestSessionHistory(SID, 'code');
  const before = userBullets();

  const store = useAppStore.getState();
  const ySentAt = Date.now();
  const yMessageId = store.appendUserMessage(SID, Y_TEXT, ySentAt);
  assert.ok(yMessageId);
  store.bindUserMessageRuntimeRun(SID, yMessageId, RUN_Y);
  store.appendEvent({
    kind: 'session_start',
    sessionId: SID,
    provider: 'mock',
    turnId: TURN_Y,
    runtimeEvent: { runtimeId: 'rt-live', runId: RUN_Y, journalEpoch: 'epoch-y', seq: 1 },
  });
  store.appendEvent({
    kind: 'queued_user_prompt_started',
    sessionId: SID,
    queueMode: 'after-turn',
    content: Y_TEXT,
    turnId: TURN_Y,
  });
  store.appendEvent({
    kind: 'text_delta',
    sessionId: SID,
    text: '好的，开始核对远端…',
    turnId: TURN_Y,
    runtimeEvent: { runtimeId: 'rt-live', runId: RUN_Y, journalEpoch: 'epoch-y', seq: 2 },
  });
  useAppStore.setState({
    liveProjectionBySession: {
      [SID]: {
        sessionId: SID,
        projectionRevision: 1,
        cursor: { runtimeId: 'rt-live', seq: 2 },
        transcriptRevision: 'transcript-y',
        queuedRuns: [],
        activeRun: {
          runId: RUN_Y,
          sessionId: SID,
          phase: 'running' as const,
          startedAt: ySentAt,
          turnId: TURN_Y,
        },
        activeTools: [],
        todos: [],
        queuedInputs: [],
        interactions: [],
      },
    },
  });

  // —— 二次 canonical 读：新 revision，canonical 里已有 Y 的 user 行 ——
  revisionByCall = ['rev-2'];
  callIndex = 0;
  await revalidateNewestSessionHistory(SID, 'code');
  dumpUserMessages('C after new-revision revalidate (with canonical Y user)');
  const after = userBullets();
  const xQueryIndex = after.indexOf(`user:${X_QUERY_TEXT.slice(0, 24)}`);
  const xFinalIndex = after.indexOf(`assistant:${X_FINAL_TEXT.slice(0, 24)}`);
  assert.ok(xQueryIndex >= 0 && xFinalIndex >= 0);
  assert.ok(
    xQueryIndex < xFinalIndex,
    `翻转复现：X query 排到自己回答之下。\n-- 翻转前 --\n${before.join('\n')}\n-- 翻转后 --\n${after.join('\n')}`,
  );
  deactivateSessionHistoryPaging(SID);
  resetSessionHistoryPagingLifecycle();
});

test('D. 真实时序：live X 回答完 → 发送 Y → 有界 canonical 读（含 reminder 拆段 + Y user 行）', async () => {
  await seedSession();
  revisionByCall = ['rev-1', 'rev-2'];
  callIndex = 0;
  installWindowSequential({ boundedPage: true });

  // —— 阶段 1：X 是 live 流式完成的一轮（乐观 sentAt = 本地时钟 ≈ 服务端 + 小偏移）——
  streamLiveTurn({
    content: X_QUERY_TEXT,
    sentAt: T.xQuery + 800, // 本地时钟比服务端慢/快的典型毫秒级偏移
    runId: 'run-x-live',
    turnId: TURN_X,
    answerText: X_FINAL_TEXT,
    withTool: true,
  });
  // X 终态 → 触发第一次 canonical 读（rev-1，含 X 完整段、无 Y）
  await revalidateNewestSessionHistory(SID, 'code');
  dumpUserMessages('D after rev-1 (X terminal read, live X shadow check)');
  const mid = userBullets();
  const xQueryCountMid = mid.filter((line) => line === `user:${X_QUERY_TEXT.slice(0, 24)}`).length;

  // —— 阶段 2：约 5 分钟后发送 Y ——
  const store = useAppStore.getState();
  const ySentAt = T.yServer + 1_500; // 本地时钟
  const yMessageId = store.appendUserMessage(SID, Y_TEXT, ySentAt);
  assert.ok(yMessageId);
  store.bindUserMessageRuntimeRun(SID, yMessageId, RUN_Y);
  store.appendEvent({
    kind: 'queued_user_prompt_started',
    sessionId: SID,
    queueMode: 'after-turn',
    content: Y_TEXT,
    turnId: TURN_Y,
  });
  store.appendEvent({
    kind: 'session_start',
    sessionId: SID,
    provider: 'mock',
    turnId: TURN_Y,
    runtimeEvent: { runtimeId: 'rt-live', runId: RUN_Y, journalEpoch: 'epoch-run-y-live', seq: 1 },
  });

  // —— 阶段 3：Y 运行中触发第二次 canonical 读（rev-2，canonical 已含 Y user 行）——
  callIndex = 1;
  await revalidateNewestSessionHistory(SID, 'code');
  dumpUserMessages('D after rev-2 (Y user in canonical, Y streaming)');
  const after = userBullets();
  const xQueryIndex = after.indexOf(`user:${X_QUERY_TEXT.slice(0, 24)}`);
  const xFinalIndex = after.indexOf(`assistant:${X_FINAL_TEXT.slice(0, 24)}`);
  const yIndex = after.findIndex((line) => line.startsWith(`user:${Y_TEXT.slice(0, 24)}`));
  console.log(`D: xQueryCountMid=${xQueryCountMid} xQueryIndex=${xQueryIndex} xFinalIndex=${xFinalIndex} yIndex=${yIndex}`);
  assert.ok(xQueryIndex >= 0 && xFinalIndex >= 0);
  assert.ok(
    xQueryIndex < xFinalIndex,
    `翻转复现：X query 排到自己回答之下。\n${after.join('\n')}`,
  );
  deactivateSessionHistoryPaging(SID);
  resetSessionHistoryPagingLifecycle();
});

test('E. 同 revision 重复 revalidate（Issue 207 场景）：fold 重跑是否稳定', async () => {
  await seedSession();
  revisionByCall = ['rev-1'];
  callIndex = 0;
  installWindow();
  await restoreNewestSessionHistory(SID, 'code');

  // 发送 Y（live，open）
  const store = useAppStore.getState();
  const yMessageId = store.appendUserMessage(SID, Y_TEXT, Date.now());
  assert.ok(yMessageId);
  store.bindUserMessageRuntimeRun(SID, yMessageId, RUN_Y);
  store.appendEvent({
    kind: 'session_start',
    sessionId: SID,
    provider: 'mock',
    turnId: TURN_Y,
    runtimeEvent: { runtimeId: 'rt-live', runId: RUN_Y, journalEpoch: 'epoch-y', seq: 1 },
  });
  store.appendEvent({
    kind: 'queued_user_prompt_started',
    sessionId: SID,
    queueMode: 'after-turn',
    content: Y_TEXT,
    turnId: TURN_Y,
  });

  const firstUsers = useAppStore.getState().userMessagesBySession[SID];
  // 前台每分钟 ~2 次的重复 revalidate（同 revision）
  callIndex = 0;
  await revalidateNewestSessionHistory(SID, 'code');
  const secondUsers = useAppStore.getState().userMessagesBySession[SID];
  await revalidateNewestSessionHistory(SID, 'code');
  const thirdUsers = useAppStore.getState().userMessagesBySession[SID];

  const sameAsFirst =
    secondUsers === firstUsers && thirdUsers === secondUsers;
  console.log(`E: users array identity first===second: ${secondUsers === firstUsers}, second===third: ${thirdUsers === secondUsers}`);
  dumpUserMessages('E after two same-revision revalidates with open live Y');
  const after = userBullets();
  const xQueryIndex = after.indexOf(`user:${X_QUERY_TEXT.slice(0, 24)}`);
  const xFinalIndex = after.indexOf(`assistant:${X_FINAL_TEXT.slice(0, 24)}`);
  assert.ok(xQueryIndex >= 0 && xFinalIndex >= 0);
  assert.ok(
    xQueryIndex < xFinalIndex,
    `翻转复现（同 revision 重跑 fold 不稳定）：\n${after.join('\n')}`,
  );
  if (!sameAsFirst) {
    console.log('E: NOTE — fold re-run produced new arrays (non-idempotent object identity), order still correct');
  }
  deactivateSessionHistoryPaging(SID);
  resetSessionHistoryPagingLifecycle();
});

/** F：两段式 canonical 绑定 —— X 还在流式时先来一次部分 canonical 读（含 reminder 拆段），
 *  X 终态后发送 Y，再来一次完整读。这是生产里 "terminal 读取与流式窗口交叠" 的形态。 */
test('F. X 流式中先到部分 canonical 读 → X 终态 → 发 Y → 完整读', async () => {
  await seedSession();
  revisionByCall = ['rev-1'];
  callIndex = 0;
  installWindow();

  // X 乐观 + 开始流式（无 terminal）
  const store0 = useAppStore.getState();
  const xMessageId = store0.appendUserMessage(SID, X_QUERY_TEXT, T.xQuery + 800);
  assert.ok(xMessageId);
  store0.bindUserMessageRuntimeRun(SID, xMessageId, 'run-x-live');
  store0.appendEvent({
    kind: 'session_start',
    sessionId: SID,
    provider: 'mock',
    turnId: TURN_X,
    runtimeEvent: { runtimeId: 'rt-live', runId: 'run-x-live', journalEpoch: 'epoch-run-x-live', seq: 1 },
  });
  store0.appendEvent({
    kind: 'queued_user_prompt_started',
    sessionId: SID,
    queueMode: 'after-turn',
    content: X_QUERY_TEXT,
    turnId: TURN_X,
  });
  store0.appendEvent({
    kind: 'thinking_delta',
    sessionId: SID,
    text: '先分析需求…',
    turnId: TURN_X,
    runtimeEvent: { runtimeId: 'rt-live', runId: 'run-x-live', journalEpoch: 'epoch-run-x-live', seq: 2 },
  });

  // 部分读：canonical 里已有 X query + 前段工作 + reminder（前一轮 terminal 触发的读恰好赶上）
  await revalidateNewestSessionHistory(SID, 'code');
  dumpUserMessages('F after partial read while X open');

  // X 继续流式到终态
  const store = useAppStore.getState();
  let n = 3;
  const seqx = (m: number) => ({ runtimeId: 'rt-live', runId: 'run-x-live', journalEpoch: 'epoch-run-x-live', seq: m });
  store.appendEvent({
    kind: 'text_delta',
    sessionId: SID,
    text: '收到，按你的要求执行：',
    turnId: TURN_X,
    runtimeEvent: seqx(n++),
  });
  store.appendEvent({
    kind: 'tool_start',
    sessionId: SID,
    toolId: 'tool-run-x-live',
    toolName: 'bash',
    input: { command: 'git status' },
    turnId: TURN_X,
    runtimeEvent: seqx(n++),
  });
  store.appendEvent({
    kind: 'tool_result',
    sessionId: SID,
    toolId: 'tool-run-x-live',
    toolName: 'bash',
    content: 'nothing to commit',
    turnId: TURN_X,
    runtimeEvent: seqx(n++),
  });
  store.appendEvent({
    kind: 'text_delta',
    sessionId: SID,
    text: X_FINAL_TEXT,
    turnId: TURN_X,
    runtimeEvent: seqx(n++),
  });
  store.appendEvent({
    kind: 'session_complete',
    sessionId: SID,
    turnId: TURN_X,
    runtimeEvent: seqx(n++),
  });
  dumpUserMessages('F after X closed (no new read)');

  // 发送 Y
  const ySentAt = T.yServer + 1_500;
  const yMessageId = store.appendUserMessage(SID, Y_TEXT, ySentAt);
  assert.ok(yMessageId);
  store.bindUserMessageRuntimeRun(SID, yMessageId, RUN_Y);
  store.appendEvent({
    kind: 'session_start',
    sessionId: SID,
    provider: 'mock',
    turnId: TURN_Y,
    runtimeEvent: { runtimeId: 'rt-live', runId: RUN_Y, journalEpoch: 'epoch-y', seq: 1 },
  });
  store.appendEvent({
    kind: 'queued_user_prompt_started',
    sessionId: SID,
    queueMode: 'after-turn',
    content: Y_TEXT,
    turnId: TURN_Y,
  });

  // 完整读（新 revision 含 Y user 行）
  revisionByCall = ['rev-2'];
  callIndex = 0;
  await revalidateNewestSessionHistory(SID, 'code');
  dumpUserMessages('F after full read with Y');
  const after = userBullets();
  const xQueryIndexes = after
    .map((line, index) => (line === `user:${X_QUERY_TEXT.slice(0, 24)}` ? index : -1))
    .filter((index) => index >= 0);
  const xFinalIndex = after.indexOf(`assistant:${X_FINAL_TEXT.slice(0, 24)}`);
  console.log(`F: xQueryIndexes=${JSON.stringify(xQueryIndexes)} xFinalIndex=${xFinalIndex}`);
  assert.ok(xQueryIndexes.length >= 1);
  assert.ok(
    xQueryIndexes.every((index) => index < xFinalIndex),
    `翻转复现：X query 排到自己回答之下。\n${after.join('\n')}`,
  );
  deactivateSessionHistoryPaging(SID);
  resetSessionHistoryPagingLifecycle();
});

/** G：conversationStatus 'partial'（缓存未决）下的读 + Y。partial 不给 authoritativeNewest，
 *  也不跑 stabilize —— fold 前置条件最弱。 */
test('G. partial 会话缓存读 + 发送 Y', async () => {
  await seedSession();
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    writable: true,
    value: {
      kodaxSpace: {
        invoke: mockHistoryInvoke(() => {
          const revision = windowRevisionForCall();
          const xItems = buildXSegmentItems();
          return {
            ok: true as const,
            data: {
              items: revision === 'rev-2' ? withYUserItem(xItems) : xItems,
              conversation: { status: 'partial' as const },
              page: {
                outcome: 'ready' as const,
                revision,
                sourceRevision: revision,
                hasMore: false,
                windowMode: 'replace' as const,
                hasNewer: false,
              },
            },
          };
        }),
      },
    },
  });

  await restoreNewestSessionHistory(SID, 'code');
  const store = useAppStore.getState();
  const yMessageId = store.appendUserMessage(SID, Y_TEXT, Date.now());
  assert.ok(yMessageId);
  store.bindUserMessageRuntimeRun(SID, yMessageId, RUN_Y);
  store.appendEvent({
    kind: 'session_start',
    sessionId: SID,
    provider: 'mock',
    turnId: TURN_Y,
    runtimeEvent: { runtimeId: 'rt-live', runId: RUN_Y, journalEpoch: 'epoch-y', seq: 1 },
  });
  store.appendEvent({
    kind: 'queued_user_prompt_started',
    sessionId: SID,
    queueMode: 'after-turn',
    content: Y_TEXT,
    turnId: TURN_Y,
  });
  revisionByCall = ['rev-2'];
  callIndex = 0;
  await revalidateNewestSessionHistory(SID, 'code');
  dumpUserMessages('G after partial-status revalidate with Y');
  const after = userBullets();
  const xQueryIndex = after.indexOf(`user:${X_QUERY_TEXT.slice(0, 24)}`);
  const xFinalIndex = after.indexOf(`assistant:${X_FINAL_TEXT.slice(0, 24)}`);
  assert.ok(xQueryIndex >= 0 && xFinalIndex >= 0);
  assert.ok(xQueryIndex < xFinalIndex, `翻转复现：\n${after.join('\n')}`);
  deactivateSessionHistoryPaging(SID);
  resetSessionHistoryPagingLifecycle();
});

/** H：内容相同但 revision 变化的重复读（绕过同 revision no-op 守卫）——
 *  模拟生产里 conversation-cache 重写（如 memory digest 落盘）bump revision 但 X 段内容不变，
 *  前台 revalidate 强制重跑 fold，且此时 Y 已发出、正在流式（open live）。 */
test('H. 内容不变、revision 变化的重复 fold + open live Y', async () => {
  await seedSession();
  revisionByCall = ['rev-a1', 'rev-a2', 'rev-a3'];
  callIndex = 0;
  installWindow();
  await restoreNewestSessionHistory(SID, 'code');

  // 发送 Y（open：只有 session_start + 部分 thinking，无 terminal）
  const store = useAppStore.getState();
  const yMessageId = store.appendUserMessage(SID, Y_TEXT, Date.now());
  assert.ok(yMessageId);
  store.bindUserMessageRuntimeRun(SID, yMessageId, RUN_Y);
  store.appendEvent({
    kind: 'session_start',
    sessionId: SID,
    provider: 'mock',
    turnId: TURN_Y,
    runtimeEvent: { runtimeId: 'rt-live', runId: RUN_Y, journalEpoch: 'epoch-y', seq: 1 },
  });
  store.appendEvent({
    kind: 'queued_user_prompt_started',
    sessionId: SID,
    queueMode: 'after-turn',
    content: Y_TEXT,
    turnId: TURN_Y,
  });
  store.appendEvent({
    kind: 'thinking_delta',
    sessionId: SID,
    text: '先对比远端…',
    turnId: TURN_Y,
    runtimeEvent: { runtimeId: 'rt-live', runId: RUN_Y, journalEpoch: 'epoch-y', seq: 2 },
  });

  callIndex = 1;
  await revalidateNewestSessionHistory(SID, 'code');
  callIndex = 2;
  await revalidateNewestSessionHistory(SID, 'code');

  dumpUserMessages('H after two content-identical refolds with open live Y');
  const after = userBullets();
  const xQueryIndex = after.indexOf(`user:${X_QUERY_TEXT.slice(0, 24)}`);
  const xFinalIndex = after.indexOf(`assistant:${X_FINAL_TEXT.slice(0, 24)}`);
  const yCount = after.filter((line) => line.startsWith(`user:${Y_TEXT.slice(0, 24)}`)).length;
  console.log(`H: xQuery=${xQueryIndex} xFinal=${xFinalIndex} yBubbles=${yCount}`);
  assert.ok(xQueryIndex >= 0 && xFinalIndex >= 0);
  assert.ok(xQueryIndex < xFinalIndex, `翻转复现：\n${after.join('\n')}`);
  deactivateSessionHistoryPaging(SID);
  resetSessionHistoryPagingLifecycle();
});

/** I：同 H，但 Y 已终态（closed live）且 canonical 仍无 Y 行 —— 终态读之后的重复 fold。 */
test('I. 内容不变、revision 变化的重复 fold + closed live Y', async () => {
  await seedSession();
  revisionByCall = ['rev-a1', 'rev-a2', 'rev-a3'];
  callIndex = 0;
  installWindow();
  await restoreNewestSessionHistory(SID, 'code');

  streamLiveTurn({
    content: Y_TEXT,
    sentAt: T.yServer + 1_500,
    runId: RUN_Y,
    turnId: TURN_Y,
    answerText: '好的，开始核对远端…',
    withTool: true,
  });

  callIndex = 1;
  await revalidateNewestSessionHistory(SID, 'code');
  callIndex = 2;
  await revalidateNewestSessionHistory(SID, 'code');

  dumpUserMessages('I after two content-identical refolds with closed live Y');
  const after = userBullets();
  const xQueryIndex = after.indexOf(`user:${X_QUERY_TEXT.slice(0, 24)}`);
  const xFinalIndex = after.indexOf(`assistant:${X_FINAL_TEXT.slice(0, 24)}`);
  const yCount = after.filter((line) => line.startsWith(`user:${Y_TEXT.slice(0, 24)}`)).length;
  console.log(`I: xQuery=${xQueryIndex} xFinal=${xFinalIndex} yBubbles=${yCount}`);
  assert.ok(xQueryIndex >= 0 && xFinalIndex >= 0);
  assert.ok(xQueryIndex < xFinalIndex, `翻转复现：\n${after.join('\n')}`);
  deactivateSessionHistoryPaging(SID);
  resetSessionHistoryPagingLifecycle();
});

/** J：生产终态路径 —— live X 终态 → reconcileTerminalSessionHistory（certified 读 rev-1）→
 *  发 Y → Y 终态 → reconcileTerminalSessionHistory（certified 读 rev-2，canonical 含 Y user 行）。
 *  certified 路径走 projectionAuthority='canonical' 的强合并分支。 */
test('J. 【缺陷复现·当前应失败】boundary 后到 → 铸造 ord=max+1 的可见 X owner，排到回答之下、Y 之上', async () => {
  await seedSession();
  revisionByCall = ['rev-0', 'rev-1', 'rev-2'];
  callIndex = 0;
  installWindow();
  // 先恢复分页（canonical 停在 X 发出之前，rev-0）—— 生产里会话前台时 paging 常驻激活
  await restoreNewestSessionHistory(SID, 'code');

  // live X：完整流式 + 终态（乐观 sentAt 本地时钟 ≈ 服务端 + 800ms）
  streamLiveTurn({
    content: X_QUERY_TEXT,
    sentAt: T.xQuery + 800,
    runId: 'run-x-live',
    turnId: TURN_X,
    answerText: X_FINAL_TEXT,
    withTool: true,
  });

  // X 终态 → certified 读
  await reconcileTerminalSessionHistory({
    sessionId: SID,
    runtimeId: 'rt-live',
    runId: 'run-x-live',
    phase: 'completed',
    cursorSeq: 99,
    transcriptRevision: 'transcript-x-done',
  });
  callIndex = 1;
  dumpUserMessages('J after X terminal certified read');
  const mid = userBullets();
  const xDupMid = mid.filter((line) => line === `user:${X_QUERY_TEXT.slice(0, 24)}`).length;

  // 发送 Y 并到终态
  const store = useAppStore.getState();
  const yMessageId = store.appendUserMessage(SID, Y_TEXT, T.yServer + 1_500);
  assert.ok(yMessageId);
  store.bindUserMessageRuntimeRun(SID, yMessageId, RUN_Y);
  store.appendEvent({
    kind: 'session_start',
    sessionId: SID,
    provider: 'mock',
    turnId: TURN_Y,
    runtimeEvent: { runtimeId: 'rt-live', runId: RUN_Y, journalEpoch: 'epoch-y', seq: 1 },
  });
  store.appendEvent({
    kind: 'queued_user_prompt_started',
    sessionId: SID,
    queueMode: 'after-turn',
    content: Y_TEXT,
    turnId: TURN_Y,
  });
  store.appendEvent({
    kind: 'text_delta',
    sessionId: SID,
    text: '好的，开始核对远端…',
    turnId: TURN_Y,
    runtimeEvent: { runtimeId: 'rt-live', runId: RUN_Y, journalEpoch: 'epoch-y', seq: 2 },
  });
  store.appendEvent({
    kind: 'session_complete',
    sessionId: SID,
    turnId: TURN_Y,
    runtimeEvent: { runtimeId: 'rt-live', runId: RUN_Y, journalEpoch: 'epoch-y', seq: 3 },
  });

  callIndex = 1;
  await reconcileTerminalSessionHistory({
    sessionId: SID,
    runtimeId: 'rt-live',
    runId: RUN_Y,
    phase: 'completed',
    cursorSeq: 4,
    transcriptRevision: 'transcript-y-done',
  });
  dumpUserMessages('J after Y terminal certified read');
  const after = userBullets();
  const xFinalIndex = after.indexOf(`assistant:${X_FINAL_TEXT.slice(0, 24)}`);
  const yFirstIndex = after.findIndex((line) => line.startsWith(`user:${Y_TEXT.slice(0, 24)}`));
  // 症状精确断言：canonical X 之下、Y 之上不应再出现任何 X query 气泡。
  // 当前产品代码：boundary 事件（queued_user_prompt_started / mid_turn_user_prompt）到达且无
  // 匹配 queued 条目时，promoteQueuedUserMessageForPrompt 的 idx===-1 分支以
  // resolveLiveUserOrdinal（把 canonical 行也计入 → max+1）铸造新的可见 user owner，
  // sentAt = nextUserMessageSentAtAfter（墙钟 now）→ composeMessages 按 sentAt 排序后
  // 该气泡落在 X 的最终回答之下、Y 之上 —— 即工单报告的乱序。
  const xBelowAnswer = after
    .map((line, index) =>
      line === `user:${X_QUERY_TEXT.slice(0, 24)}` && index > xFinalIndex ? index : -1,
    )
    .filter((index) => index >= 0);
  console.log(
    `J: xDupMid=${xDupMid} xFinal=${xFinalIndex} xBelowAnswer=${JSON.stringify(xBelowAnswer)} yFirst=${yFirstIndex}`,
  );
  assert.deepEqual(
    xBelowAnswer,
    [],
    `翻转复现：X query 气泡出现在 X 最终回答之下、Y 之上（minted owner）。\n${after.join('\n')}`,
  );
  deactivateSessionHistoryPaging(SID);
  resetSessionHistoryPagingLifecycle();
});

/** K：Y 以 interrupt（mid_turn_user_prompt）插入 X 的长运行 —— 打断场景。 */
test('K. Y 用 interrupt 边界插入', async () => {
  await seedSession();
  revisionByCall = ['rev-1', 'rev-2'];
  callIndex = 0;
  installWindow();
  await restoreNewestSessionHistory(SID, 'code');

  const store = useAppStore.getState();
  const yMessageId = store.appendUserMessage(SID, Y_TEXT, Date.now());
  assert.ok(yMessageId);
  store.bindUserMessageRuntimeRun(SID, yMessageId, RUN_Y);
  store.appendEvent({
    kind: 'session_start',
    sessionId: SID,
    provider: 'mock',
    turnId: TURN_Y,
    runtimeEvent: { runtimeId: 'rt-live', runId: RUN_Y, journalEpoch: 'epoch-y', seq: 1 },
  });
  store.appendEvent({
    kind: 'mid_turn_user_prompt',
    sessionId: SID,
    content: Y_TEXT,
    turnId: TURN_Y,
  });
  callIndex = 1;
  await revalidateNewestSessionHistory(SID, 'code');
  dumpUserMessages('K after interrupt delivery + revalidate');
  const after = userBullets();
  const xQueryIndex = after.indexOf(`user:${X_QUERY_TEXT.slice(0, 24)}`);
  const xFinalIndex = after.indexOf(`assistant:${X_FINAL_TEXT.slice(0, 24)}`);
  assert.ok(xQueryIndex >= 0 && xFinalIndex >= 0);
  assert.ok(xQueryIndex < xFinalIndex, `翻转复现：\n${after.join('\n')}`);
  deactivateSessionHistoryPaging(SID);
  resetSessionHistoryPagingLifecycle();
});

/** J2：J 的逐步 bisect —— 定位 [3]（ord=2 的 X 重复 owner）在哪一步产生。 */
test('J2. 逐步 bisect 重复 owner 的产生点', async () => {
  await seedSession();
  revisionByCall = ['rev-0', 'rev-1', 'rev-2'];
  callIndex = 0;
  installWindow();
  await restoreNewestSessionHistory(SID, 'code');
  console.log('J2 step1 after restore rev-0:', JSON.stringify((useAppStore.getState().userMessagesBySession[SID] ?? []).map((m) => [m.content.slice(0, 10), m.turnId ?? '-', m.turnUserOrdinal ?? '-'])));

  const store = useAppStore.getState();
  const xMessageId = store.appendUserMessage(SID, X_QUERY_TEXT, T.xQuery + 800);
  store.bindUserMessageRuntimeRun(SID, xMessageId!, 'run-x-live');
  console.log('J2 step2 after optimistic append:', JSON.stringify((useAppStore.getState().userMessagesBySession[SID] ?? []).map((m) => [m.id.slice(-6), m.content.slice(0, 10), m.turnId ?? '-', m.turnUserOrdinal ?? '-'])));
  store.appendEvent({
    kind: 'session_start',
    sessionId: SID,
    provider: 'mock',
    turnId: TURN_X,
    runtimeEvent: { runtimeId: 'rt-live', runId: 'run-x-live', journalEpoch: 'epoch-run-x-live', seq: 1 },
  });
  console.log('J2 step3 after session_start:', JSON.stringify((useAppStore.getState().userMessagesBySession[SID] ?? []).map((m) => [m.id.slice(-6), m.content.slice(0, 10), m.turnId ?? '-', m.turnUserOrdinal ?? '-'])));
  store.appendEvent({
    kind: 'queued_user_prompt_started',
    sessionId: SID,
    queueMode: 'after-turn',
    content: X_QUERY_TEXT,
    turnId: TURN_X,
  });
  console.log('J2 step4 after boundary:', JSON.stringify((useAppStore.getState().userMessagesBySession[SID] ?? []).map((m) => [m.id.slice(-6), m.content.slice(0, 10), m.turnId ?? '-', m.turnUserOrdinal ?? '-'])));
  store.appendEvent({
    kind: 'thinking_delta',
    sessionId: SID,
    text: '先分析需求…',
    turnId: TURN_X,
    runtimeEvent: { runtimeId: 'rt-live', runId: 'run-x-live', journalEpoch: 'epoch-run-x-live', seq: 2 },
  });
  store.appendEvent({
    kind: 'text_delta',
    sessionId: SID,
    text: X_FINAL_TEXT,
    turnId: TURN_X,
    runtimeEvent: { runtimeId: 'rt-live', runId: 'run-x-live', journalEpoch: 'epoch-run-x-live', seq: 3 },
  });
  store.appendEvent({
    kind: 'session_complete',
    sessionId: SID,
    turnId: TURN_X,
    runtimeEvent: { runtimeId: 'rt-live', runId: 'run-x-live', journalEpoch: 'epoch-run-x-live', seq: 4 },
  });
  console.log('J2 step5 after stream+complete:', JSON.stringify((useAppStore.getState().userMessagesBySession[SID] ?? []).map((m) => [m.id.slice(-6), m.content.slice(0, 10), m.turnId ?? '-', m.turnUserOrdinal ?? '-'])));

  await reconcileTerminalSessionHistory({
    sessionId: SID,
    runtimeId: 'rt-live',
    runId: 'run-x-live',
    phase: 'completed',
    cursorSeq: 99,
  });
  console.log('J2 step6 after certified read:', JSON.stringify((useAppStore.getState().userMessagesBySession[SID] ?? []).map((m) => [m.id.slice(-6), m.content.slice(0, 10), m.turnId ?? '-', m.turnUserOrdinal ?? '-', m.restoredFromHistory === true ? 'canon' : 'live'])));
  deactivateSessionHistoryPaging(SID);
  resetSessionHistoryPagingLifecycle();
});

// ============================================================================
// L / M：真实客户时序（客户 session 20260816_110200_432759c1554ee5，canonical 已验证干净）
//
// 真实时序：
//   turn_8860b0bc18424193  完成于 01:07:52.931Z（背景轮）
//   turn_4cbd9ec8cf71403b  q1 01:09:41.527Z → a1 01:10:03.394Z（单 assistant entry：thinking+text）
//   turn_041d7c13178c4975  q2 01:10:21.800Z → a2 01:10:38.680Z（thinking+text，尾句 = 最后两个 delta）
//   q2 的 run run_mtqjnc8r_38e86d14 terminal 于 01:10:44.494Z；journal 里 assistant.delta 的
//   turnId 全部正确；最后两个 delta 恰为尾句（01:10:38.532 / 01:10:38.595）。
//
// 症状一（L）：a2 的尾句作为独立 assistant 卡（显示 a2 的 canonical 时间戳）画在 q1 之上
//   （turn_8860 区域）；同时 a1 整轮消失（q1、q2 直接相邻）；q2 下方 a2 完整正常。
// 症状二（M）：一轮 5 段 text + 4 个 tool 的回答，5 段文本合并成一张大卡骑到 query5 之上，
//   4 个工具芯片消失。
//
// 复现判定（2026-09-07 运行，详细观察见各场景注释）：
//   - L 主配方 GREEN（未复现"尾句 ghost 骑到 q1/a1 被吞"的位置翻转），但 composed 里留有
//     同族缺陷残件：closed live 轮在 certified canonical 安装后不被清除 → a1 答案卡 ×2、
//     q2 气泡 ×2、live a2 卡残件（见 dumpUserMessages 输出）。
//   - L 变体 B（B1：interrupt deliveredAt 服务钟偏早）RED：canonical a1/a2 卡骑到 q1 之上。
//   - L 变体 C（canonical 滞后 + 服务钟超前）RED：迟到尾 delta 被快照重水合永久删除，
//     canonical 页又没有它 → 尾句在全局 0 次渲染（内容丢失形态）。
//   - L 变体 D（cursor 部分覆盖）RED：合成 cumulative 全文卡与 canonical a2 并存 →
//     尾句全局渲染 2 次（ghost 复制形态）。
//   - M 主配方 RED：终态快照把带 providerRequestId 的已覆盖 text_delta 全部删除
//     （filterEffectiveOutputSegmentEvents 的 stale 扫描），而合成补发因
//     hydrateSessionEventsFromLiveSnapshot 的 activeRun 门被跳过 → live 轮只剩
//     thinking + 4 个孤儿 tool 段；canonical 安装后芯片 4+4=8（失败门 b）。
//   - M 变体（activeRun 在场驱动合成 / startedAtSeq 错位）：合成重建本身正确还原 5 段，
//     但 fold 依旧不清 live 残件 → 门(b) 同样 RED（芯片 8）。
// ============================================================================

// ---- 真实时序时间戳（epoch ms）----
const REAL_T = {
  bgDone: Date.parse('2026-08-16T01:07:52.931Z'),
  q1: Date.parse('2026-08-16T01:09:41.527Z'),
  a1: Date.parse('2026-08-16T01:10:03.394Z'),
  q2: Date.parse('2026-08-16T01:10:21.800Z'),
  a2: Date.parse('2026-08-16T01:10:38.680Z'),
  run2Terminal: Date.parse('2026-08-16T01:10:44.494Z'),
};

const TURN_BG = 'turn_8860b0bc18424193';
const L_TURN_1 = 'turn_4cbd9ec8cf71403b';
const L_TURN_2 = 'turn_041d7c13178c4975';
const L_RUN_1 = 'run-x';
const L_RUN_2 = 'run-y';
const L_EPOCH_2 = 'epoch-run-y';
const L_RUNTIME_ID = 'rt-live';

const L_BG_Q = '先把昨天评审会的结论整理成一条待办，同步到项目看板里';
const L_BG_A = '已整理完成：评审结论共 3 条已同步到看板，其中两条标记为高优先级，后续按优先级推进。';
const L_Q1_TEXT = '接着把这套视频的三条叙事线各自再打磨一版，重点补上数据支撑';
const L_A1_THINKING =
  'The user wants three narrative lines polished with data support. Plan: line 1 retention data, line 2 conversion comparison, line 3 opening hook. Draft each version and annotate the evidence source…';
const L_A1_TEXT =
  '三条叙事线的打磨稿已经完成：第一条线补齐了留存数据，第二条线加入了转化对比，第三条线重构了开场钩子。每一版都附上了依据和风险提示，可以直接进入评审。';
const L_Q2_TEXT = '很好，那第二条线先来，把转化对比那部分再展开讲讲';
const L_A2_THINKING =
  'Expand line 2 with conversion comparison: baseline retention, uplift after redesign, confidence interval and sample size. Close with an offer to enumerate the currently valid versions…';
const L_A2_HEAD =
  '第二条线的转化对比可以从三个维度展开：先看改版前的基线留存，再看改版后的转化提升幅度，最后给出置信区间和样本量说明，方便你判断结论是否站得住。';
// 真实 journal 里 a2 的最后两个 delta 恰为这句尾句（01:10:38.532 / 01:10:38.595）。
const L_A2_TAIL_1 = '要不要我先把这套视频的“现在到底哪几个版本是有效的”';
const L_A2_TAIL_2 = '理一份清单给您，再决定哪条线继续打磨？';
const L_A2_FULL = `${L_A2_HEAD}${L_A2_TAIL_1}${L_A2_TAIL_2}`;

function buildLBackgroundItems(clockAheadMs = 0): SessionHistoryItem[] {
  return [
    {
      kind: 'user',
      content: L_BG_Q,
      sentAt: REAL_T.bgDone - 120_000 + clockAheadMs,
      entryId: 'entry_l_bg_u',
      canonicalIndex: 60,
      turnId: TURN_BG,
      turnUserOrdinal: 0,
    },
    {
      kind: 'assistant',
      text: L_BG_A,
      thinking: '整理评审会结论为待办…',
      sentAt: REAL_T.bgDone + clockAheadMs,
      entryId: 'entry_l_bg_a',
      canonicalIndex: 61,
      turnId: TURN_BG,
    },
  ];
}

function buildLQ1Items(clockAheadMs = 0): SessionHistoryItem[] {
  return [
    {
      kind: 'user',
      content: L_Q1_TEXT,
      sentAt: REAL_T.q1 + clockAheadMs,
      entryId: 'entry_l_q1_u',
      canonicalIndex: 62,
      turnId: L_TURN_1,
      turnUserOrdinal: 0,
    },
    {
      kind: 'assistant',
      text: L_A1_TEXT,
      thinking: L_A1_THINKING,
      sentAt: REAL_T.a1 + clockAheadMs,
      entryId: 'entry_l_q1_a',
      canonicalIndex: 63,
      turnId: L_TURN_1,
    },
  ];
}

function buildLQ2Items(clockAheadMs = 0, a2SentAt = REAL_T.a2): SessionHistoryItem[] {
  return [
    {
      kind: 'user',
      content: L_Q2_TEXT,
      sentAt: REAL_T.q2 + clockAheadMs,
      entryId: 'entry_l_q2_u',
      canonicalIndex: 64,
      turnId: L_TURN_2,
      turnUserOrdinal: 0,
    },
    {
      kind: 'assistant',
      text: L_A2_FULL,
      thinking: L_A2_THINKING,
      sentAt: a2SentAt + clockAheadMs,
      entryId: 'entry_l_q2_a',
      canonicalIndex: 65,
      turnId: L_TURN_2,
    },
  ];
}

/** L 变体开关：默认主配方；C 变体改 canonical 行数与时间基准。 */
interface LVariantOptions {
  /** 变体 C：canonical 滞后 —— rev-2 页不含 q2/a2 行（live q2 无 canonical 对手）。 */
  readonly rev2OmitQ2?: boolean;
  /** 变体 C：服务钟超前 —— canonical sentAt 全部改为 Date.now()+ahead-偏移（本地钟落后）。 */
  readonly canonicalClockAheadMs?: number;
}

/** 只改写带 sentAt 的 history item（tool_call 等无 sentAt 的行原样返回）。 */
function stampLHistorySentAt(item: SessionHistoryItem, sentAt: number): SessionHistoryItem {
  return 'sentAt' in item && item.sentAt !== undefined ? { ...item, sentAt } : item;
}

function installWindowL(options: LVariantOptions = {}): void {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    writable: true,
    value: {
      kodaxSpace: {
        invoke: mockHistoryInvoke(() => {
          const revision = windowRevisionForCall();
          const ahead = options.canonicalClockAheadMs ?? 0;
          // ahead=0 → 保留 builders 里的真实 canonical 时间；ahead>0 → 服务钟超前形态。
          const clock = (item: SessionHistoryItem, secondsAgo: number): SessionHistoryItem =>
            ahead === 0
              ? item
              : stampLHistorySentAt(item, Date.now() + ahead - secondsAgo * 1_000);
          const bg = buildLBackgroundItems().map((item) => clock(item, 180));
          const q1 = buildLQ1Items().map((item) => clock(item, 60));
          const q2 = buildLQ2Items().map((item) =>
            clock(item, 0),
          );
          const items =
            revision === 'rev-0'
              ? bg
              : revision === 'rev-1'
                ? [...bg, ...q1]
                : options.rev2OmitQ2 === true
                  ? [...bg, ...q1]
                  : [...bg, ...q1, ...q2];
          return pageResponse(items, revision);
        }),
      },
    },
  });
}

/** replaceSessionLiveProjectionState 要求 fresh live authority + profile runtimeId 一致。 */
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

/** 指定文本出现在多少张 assistant 卡里（userBullets 只截 24 字符，这里扫全文）。 */
function assistantCardsContaining(snippet: string): number {
  const state = useAppStore.getState();
  return composeMessages({
    events: state.eventsBySession[SID] ?? [],
    userMessages: state.userMessagesBySession[SID] ?? [],
  }).filter((message) => message.kind === 'assistant_text' && message.text.includes(snippet))
    .length;
}

/**
 * L 的失败门（对应真实症状一）：
 *  (a) q1 之前（背景轮回答之后）不得出现任何 assistant 卡 —— 尾句 ghost 骑到 q1 之上；
 *  (b) a1 的卡必须存在于 q1 与 q2 之间 —— a1 整轮消失（q1、q2 相邻）；
 *  (c) 尾句文本全局只出现在 1 张 assistant 卡里 —— ghost + 正牌 a2 = 2、或 0（内容丢失）即失败。
 * mode='observe' 只记录不抛错（用于穷尽变体时的观察运行），默认硬断言。
 */
function assertLFailureGates(
  label: string,
  mode: 'assert' | 'observe' = 'assert',
): void {
  const failures: string[] = [];
  const check = (ok: boolean, message: string): void => {
    if (ok) return;
    if (mode === 'observe') failures.push(message);
    else assert.fail(message);
  };
  const transcript = userBullets();
  console.log(`\n[L/${label}] composed transcript:`);
  for (const line of transcript) console.log(`  ${line}`);
  const q1Index = transcript.indexOf(`user:${L_Q1_TEXT.slice(0, 24)}`);
  const q2Index = transcript.indexOf(`user:${L_Q2_TEXT.slice(0, 24)}`);
  const a0Index = transcript.indexOf(`assistant:${L_BG_A.slice(0, 24)}`);
  const a1Index = transcript.indexOf(`assistant:${L_A1_TEXT.slice(0, 24)}`);
  const a2HeadIndex = transcript.indexOf(`assistant:${L_A2_HEAD.slice(0, 24)}`);
  const tailPrefix = L_A2_TAIL_1.slice(0, 24);
  const tailBullets = transcript.filter(
    (line) => line.startsWith('assistant:') && line.includes(tailPrefix),
  );
  console.log(
    `[L/${label}] indexes: q1=${q1Index} q2=${q2Index} a0=${a0Index} a1=${a1Index} ` +
      `a2Head=${a2HeadIndex} tailBullets=${JSON.stringify(tailBullets)} ` +
      `tailCardCount=${assistantCardsContaining(L_A2_TAIL_1)}`,
  );
  check(q1Index >= 0, `[L/${label}] q1 可见:\n${transcript.join('\n')}`);
  check(q2Index > q1Index, `[L/${label}] q2 在 q1 之后:\n${transcript.join('\n')}`);
  const afterA0 = a0Index >= 0 ? transcript.slice(a0Index + 1, q1Index) : [];
  const strayAssistants = afterA0.filter((line) => line.startsWith('assistant:'));
  check(
    strayAssistants.length === 0,
    `[L/${label}] 失败门(a)：q1 之前出现异常 assistant 卡（尾句 ghost 骑到 q1 之上）:\n${transcript.join('\n')}`,
  );
  check(
    a1Index > q1Index && a1Index < q2Index,
    `[L/${label}] 失败门(b)：a1 卡不在 q1 与 q2 之间（a1 整轮消失）(a1=${a1Index}, q1=${q1Index}, q2=${q2Index}):\n${transcript.join('\n')}`,
  );
  const tailCardCount = assistantCardsContaining(L_A2_TAIL_1);
  check(
    tailCardCount === 1,
    `[L/${label}] 失败门(c)：尾句文本出现在 ${tailCardCount} 张 assistant 卡中（应为 1，ghost+正牌=2 或丢失=0）:\n${transcript.join('\n')}`,
  );
  check(
    a2HeadIndex > q2Index,
    `[L/${label}] a2 主体在 q2 之下 (a2Head=${a2HeadIndex}, q2=${q2Index}):\n${transcript.join('\n')}`,
  );
  if (failures.length > 0) {
    console.log(`[L/${label}] OBSERVED gate failures (${failures.length}):`);
    for (const failure of failures) console.log(`  - ${failure.split('\n')[0]}`);
  }
}

/**
 * L 专用的精确文本流式：不用 streamLiveTurn（它会在回答前拼固定前缀，导致 live 文本
 * ≠ canonical 持久化文本，certified 合并走 fail-open，属于 harness 失真）。生产里
 * canonical 就是流式 delta 原样落盘，这里保证逐字一致。
 */
function streamLTurn(input: {
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
    runtimeId: L_RUNTIME_ID,
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

/** L 的公共编排：rev-0 恢复 → live q1 + certified rev-1 → live q2 + 迟到尾 delta → 待快照。 */
async function runLCoreFlow(options: LVariantOptions = {}): Promise<void> {
  await seedSession();
  revisionByCall = ['rev-0', 'rev-1', 'rev-2'];
  callIndex = 0;
  installWindowL(options);
  // 步骤 2：装 rev-0（只有 turn_8860 背景轮，canonical 停在 q1 之前）
  await restoreNewestSessionHistory(SID, 'code');

  // 步骤 3：live q1（run-x）→ terminal certified 读 rev-1
  streamLTurn({
    content: L_Q1_TEXT,
    sentAt: options.canonicalClockAheadMs === undefined ? REAL_T.q1 + 800 : Date.now() - 65_000,
    runId: L_RUN_1,
    epoch: 'epoch-run-x',
    turnId: L_TURN_1,
    thinking: L_A1_THINKING,
    answerText: L_A1_TEXT,
  });
  await reconcileTerminalSessionHistory({
    sessionId: SID,
    runtimeId: L_RUNTIME_ID,
    runId: L_RUN_1,
    phase: 'completed',
    cursorSeq: 99,
    transcriptRevision: 'transcript-run-x',
    turnId: L_TURN_1,
  });
  dumpUserMessages('L core after q1 certified rev-1');
  console.log(
    'L core events after q1 certified rev-1:',
    JSON.stringify(
      (useAppStore.getState().eventsBySession[SID] ?? []).map((event) =>
        event.kind === 'text_delta'
          ? `text:${event.text.slice(0, 12)}(seq${event.runtimeEvent?.seq})`
          : event.kind,
      ),
    ),
  );

  // 步骤 4：live q2（run-y）→ session_complete 之后追加两个迟到尾 delta。
  // appendSessionEvent 不跨 terminal 合并 → 独立松散段（生产 journal 里 turnId 正确）。
  streamLTurn({
    content: L_Q2_TEXT,
    sentAt: options.canonicalClockAheadMs === undefined ? REAL_T.q2 + 1_200 : Date.now() - 5_000,
    runId: L_RUN_2,
    epoch: L_EPOCH_2,
    turnId: L_TURN_2,
    thinking: L_A2_THINKING,
    answerText: L_A2_HEAD,
  });
  const store = useAppStore.getState();
  store.appendEvent({
    kind: 'text_delta',
    sessionId: SID,
    text: L_A2_TAIL_1,
    turnId: L_TURN_2,
    providerRequestId: 'req-l-run-y',
    runtimeEvent: { runtimeId: L_RUNTIME_ID, runId: L_RUN_2, journalEpoch: L_EPOCH_2, seq: 5 },
  });
  store.appendEvent({
    kind: 'text_delta',
    sessionId: SID,
    text: L_A2_TAIL_2,
    turnId: L_TURN_2,
    providerRequestId: 'req-l-run-y',
    runtimeEvent: { runtimeId: L_RUNTIME_ID, runId: L_RUN_2, journalEpoch: L_EPOCH_2, seq: 6 },
  });
}

/** 步骤 5：注入权威 live 快照（allowEqualHydration，重水合入口）。 */
function pushLSnapshot(projection: SpaceSessionLiveProjectionT): boolean {
  seedRuntimeAuthority(L_RUNTIME_ID);
  return useAppStore.getState().replaceSessionLiveProjection(projection, {
    allowEqualHydration: true,
  });
}

function lBaseProjection(cursorSeq = 7): SpaceSessionLiveProjectionT {
  return {
    sessionId: SID,
    projectionRevision: 1,
    cursor: { runtimeId: L_RUNTIME_ID, seq: cursorSeq, sessionId: SID, journalEpoch: L_EPOCH_2 },
    transcriptRevision: 'transcript-run-y',
    queuedRuns: [],
    queuedInputs: [],
    interactions: [],
    activeTools: [],
    todos: [],
  };
}

test('L. 真实时序：terminal 后迟到尾 delta + 快照重水合 → a2 尾句 ghost 骑到 q1 之上且 a1 被吞（失败门）', { skip: 'FEATURE_275 失败门：20260816 session 实测 RED（主配方暴露 closed live 残件重复渲染；变体 B 复现 canonical a1/a2 骑到 q1 之上，变体 C/D 复现尾句丢失/ghost 复制）。P1 排序单一化 + P2 结算即退役落地后移除 skip 转绿。' }, async () => {
  // ---------- 主配方 ----------
  // 步骤 5（主配方）：activeRun=undefined、lastTerminalRun=run-y；cursor 覆盖到尾 delta；
  // assistantDraft/合成段 startedAt = a2 canonical 完成时间（复现 ghost 显示 canonical 时间戳）。
  await runLCoreFlow();
  pushLSnapshot({
    ...lBaseProjection(),
    lastTerminalRun: {
      runId: L_RUN_2,
      sessionId: SID,
      turnId: L_TURN_2,
      phase: 'completed',
      startedAt: Date.parse('2026-08-16T01:10:20.000Z'),
      completedAt: REAL_T.run2Terminal,
    },
    assistantDraft: { text: L_A2_FULL, startedAt: Date.parse('2026-08-16T01:10:38.680Z') },
    outputSegment: {
      retained: [
        {
          responseId: 'resp-l-run-y',
          providerRequestId: 'req-l-run-y',
          mode: 'replace',
          startedAtSeq: 3,
          assistantText: L_A2_FULL,
          thinkingText: '',
          assistantTextStartOffset: 0,
          thinkingTextStartOffset: 0,
        },
      ],
    },
  });
  dumpUserMessages('L main after snapshot hydration');
  console.log(
    'L main events after snapshot:',
    JSON.stringify(
      (useAppStore.getState().eventsBySession[SID] ?? []).map((event) =>
        event.kind === 'text_delta'
          ? `text:${event.text.slice(0, 12)}(seq${event.runtimeEvent?.seq})`
          : event.kind,
      ),
    ),
  );

  // 步骤 6：terminal certified 读 rev-2（canonical 含 q2/a2 完整行）
  await reconcileTerminalSessionHistory({
    sessionId: SID,
    runtimeId: L_RUNTIME_ID,
    runId: L_RUN_2,
    phase: 'completed',
    cursorSeq: 7,
    transcriptRevision: 'transcript-run-y',
    turnId: L_TURN_2,
    startedAt: Date.parse('2026-08-16T01:10:20.000Z'),
    completedAt: REAL_T.run2Terminal,
  });
  dumpUserMessages('L main after certified rev-2');
  assertLFailureGates('main');
  deactivateSessionHistoryPaging(SID);
  resetSessionHistoryPagingLifecycle();

  // ---------- 变体 B：快照 queuedInputs 携带已投递 interrupt，踩 B1 ----------
  // B1 事实：reconcileRuntimeDeliveredInputs 的 boundary 按 deliverySeq 定位在流中部，
  // 但 owner 行 append 到 users 末尾且 sentAt 改写为服务器 deliveredAt（早于 q1 canonical）。
  {
    await runLCoreFlow();
    pushLSnapshot({
      ...lBaseProjection(),
      activeRun: {
        runId: L_RUN_2,
        sessionId: SID,
        turnId: L_TURN_2,
        phase: 'running',
        startedAt: Date.parse('2026-08-16T01:10:20.000Z'),
      },
      lastTerminalRun: {
        runId: L_RUN_2,
        sessionId: SID,
        turnId: L_TURN_2,
        phase: 'completed',
        startedAt: Date.parse('2026-08-16T01:10:20.000Z'),
        completedAt: REAL_T.run2Terminal,
      },
      queuedInputs: [
        {
          inputId: 'input-l-interrupt',
          sessionId: SID,
          delivery: 'interrupt',
          state: 'delivered',
          createdAt: REAL_T.q1 - 3_600_000,
          deliveredAt: REAL_T.q1 - 60_000, // 早于 q1 canonical sentAt 的服务器时间
          runId: L_RUN_2,
          deliverySeq: 3, // 落在 T1 段中部的 seq 数值
          entryId: 'entry_l_interrupt',
          contentPreview: '插播：先只看第二条线',
          turnId: L_TURN_2,
        },
      ],
    });
    dumpUserMessages('L variant B after snapshot with delivered interrupt');
    await reconcileTerminalSessionHistory({
      sessionId: SID,
      runtimeId: L_RUNTIME_ID,
      runId: L_RUN_2,
      phase: 'completed',
      cursorSeq: 7,
      transcriptRevision: 'transcript-run-y',
      turnId: L_TURN_2,
    });
    dumpUserMessages('L variant B after certified rev-2');
    assertLFailureGates('variantB');
    deactivateSessionHistoryPaging(SID);
    resetSessionHistoryPagingLifecycle();
  }

  // ---------- 变体 C：服务钟超前 + canonical 滞后，踩 stabilize 误搬移 ----------
  // L3621-3626 的 turn.sentAt < canonical.sentAt 时间比较：canonical（服务钟）超前本地墙钟、
  // rev-2 又不含 q2 行时，已闭合的 live q2 轮被判为"错位"整体搬到 turn_8860 之前。
  {
    await runLCoreFlow({ canonicalClockAheadMs: 600_000, rev2OmitQ2: true });
    pushLSnapshot({
      ...lBaseProjection(),
      lastTerminalRun: {
        runId: L_RUN_2,
        sessionId: SID,
        turnId: L_TURN_2,
        phase: 'completed',
        startedAt: Date.now() - 30_000,
        completedAt: Date.now() - 20_000,
      },
    });
    dumpUserMessages('L variant C after snapshot (server clock ahead)');
    // canonical 滞后：读不到 q2 行 → 证据不带 turnId（fail-open 结清）
    await reconcileTerminalSessionHistory({
      sessionId: SID,
      runtimeId: L_RUNTIME_ID,
      runId: L_RUN_2,
      phase: 'completed',
      cursorSeq: 7,
      transcriptRevision: 'transcript-run-y',
    });
    dumpUserMessages('L variant C after certified rev-2 (no q2 rows)');
    assertLFailureGates('variantC');
    deactivateSessionHistoryPaging(SID);
    resetSessionHistoryPagingLifecycle();
  }

  // ---------- 变体 D：cursor 只覆盖一半尾 delta → 合成/原文并存 ----------
  {
    await runLCoreFlow();
    pushLSnapshot({
      ...lBaseProjection(6),
      cursor: { runtimeId: L_RUNTIME_ID, seq: 6, sessionId: SID, journalEpoch: L_EPOCH_2 },
      activeRun: {
        runId: L_RUN_2,
        sessionId: SID,
        turnId: L_TURN_2,
        phase: 'running',
        startedAt: Date.parse('2026-08-16T01:10:20.000Z'),
      },
      assistantDraft: { text: L_A2_FULL, startedAt: Date.parse('2026-08-16T01:10:38.680Z') },
      outputSegment: {
        retained: [
          {
            responseId: 'resp-l-run-y',
            providerRequestId: 'req-l-run-y',
            mode: 'replace',
            startedAtSeq: 3,
            assistantText: L_A2_FULL,
            thinkingText: '',
            assistantTextStartOffset: 0,
            thinkingTextStartOffset: 0,
          },
        ],
      },
    });
    dumpUserMessages('L variant D after partial-coverage snapshot');
    console.log(
      'L variant D events after snapshot:',
      JSON.stringify(
        (useAppStore.getState().eventsBySession[SID] ?? []).map((event) =>
          event.kind === 'text_delta'
            ? `text:${event.text.slice(0, 12)}(seq${event.runtimeEvent?.seq})`
            : event.kind,
        ),
      ),
    );
    await reconcileTerminalSessionHistory({
      sessionId: SID,
      runtimeId: L_RUNTIME_ID,
      runId: L_RUN_2,
      phase: 'completed',
      cursorSeq: 6,
      transcriptRevision: 'transcript-run-y',
      turnId: L_TURN_2,
    });
    dumpUserMessages('L variant D after certified rev-2');
    assertLFailureGates('variantD');
    deactivateSessionHistoryPaging(SID);
    resetSessionHistoryPagingLifecycle();
  }
});

// ============================================================================
// M：多段 tool 轮快照重水合（真实症状二）
// ============================================================================

const M_TURN_5 = 'turn_m50000005';
const M_RUN_5 = 'run-5';
const M_EPOCH_5 = 'epoch-run-5';

const M_Q1_TEXT = '先把发布会的整体节奏排一下';
const M_A1_TEXT = '整体节奏已经排好：开场 5 分钟，主体三段各 15 分钟，收尾 10 分钟，含一次中场互动。';
const M_Q2_TEXT = '主体第一段展开讲讲';
const M_A2_TEXT = '主体第一段围绕产品起源展开：从最初的原型讲起，中间插入创始人决策的关键节点，结尾落到今天的版本。';
const M_Q3_TEXT = '第二段呢';
const M_A3_TEXT = '第二段聚焦技术架构：先讲清楚分层设计，再用一组对比数据说明性能取舍，最后演示压测结果。';
const M_Q4_TEXT = '第三段收个尾';
const M_A4_TEXT = '第三段收尾用客户案例：挑两个代表性客户，讲落地前后的量化差异，再带出下个版本的路线图。';

const M_Q5_TEXT = '把发布会脚本按五段结构完整写出来，每段之间插一次素材检查';
const M_SEGMENTS = [
  '【第一段·开场】用 30 秒短视频把观众拉回产品诞生的那个夜晚，抛出今天要回答的三个问题。',
  '【第二段·起源】从第一版原型的三次推翻讲起，用时间线呈现关键决策点与背后的取舍逻辑。',
  '【第三段·架构】分层拆解当前的架构设计，用压测对比数据说明每一次性能取舍的代价与收益。',
  '【第四段·案例】两个代表性客户的落地故事：落地前的痛点量化，落地后的效率提升数据。',
  '【第五段·路线图】把下个版本的三个关键能力放进同一条时间线，回扣开场提出的三个问题。',
];
const M_TOOLS = ['bash', 'edit', 'write', 'todo_update'] as const;

function buildMEarlierTurnItems(): SessionHistoryItem[] {
  const items: SessionHistoryItem[] = [];
  const turns: readonly {
    readonly turnId: string;
    readonly rows: readonly { readonly kind: 'user' | 'assistant'; readonly text: string }[];
  }[] = [
    {
      turnId: 'turn_m50000001',
      rows: [
        { kind: 'user', text: M_Q1_TEXT },
        { kind: 'assistant', text: M_A1_TEXT },
      ],
    },
    {
      turnId: 'turn_m50000002',
      rows: [
        { kind: 'user', text: M_Q2_TEXT },
        { kind: 'assistant', text: M_A2_TEXT },
      ],
    },
    {
      turnId: 'turn_m50000003',
      rows: [
        { kind: 'user', text: M_Q3_TEXT },
        { kind: 'assistant', text: M_A3_TEXT },
      ],
    },
    {
      turnId: 'turn_m50000004',
      rows: [
        { kind: 'user', text: M_Q4_TEXT },
        { kind: 'assistant', text: M_A4_TEXT },
      ],
    },
  ];
  let index = 0;
  for (const turn of turns) {
    for (const row of turn.rows) {
      items.push(
        row.kind === 'user'
          ? {
              kind: 'user',
              content: row.text,
              sentAt: REAL_T.bgDone + index * 60_000,
              entryId: `entry_m${index}`,
              canonicalIndex: index,
              turnId: turn.turnId,
              turnUserOrdinal: 0,
            }
          : {
              kind: 'assistant',
              text: row.text,
              sentAt: REAL_T.bgDone + index * 60_000 + 30_000,
              entryId: `entry_m${index}`,
              canonicalIndex: index,
              turnId: turn.turnId,
            },
      );
      index += 1;
    }
  }
  return items;
}

/** canonical 里 query5 轮：5 条 assistant item + 4 条 tool_call item，交错排列。 */
function buildMTurn5Items(): SessionHistoryItem[] {
  const items: SessionHistoryItem[] = [
    {
      kind: 'user',
      content: M_Q5_TEXT,
      sentAt: REAL_T.bgDone + 8 * 60_000,
      entryId: 'entry_m_q5',
      canonicalIndex: 8,
      turnId: M_TURN_5,
      turnUserOrdinal: 0,
    },
  ];
  let index = 9;
  for (let segment = 0; segment < M_SEGMENTS.length; segment++) {
    items.push({
      kind: 'assistant',
      text: M_SEGMENTS[segment]!,
      thinking: `Compose segment ${segment + 1} of the launch script…`,
      sentAt: REAL_T.bgDone + index * 30_000,
      entryId: `entry_m_seg${segment + 1}`,
      canonicalIndex: index,
      turnId: M_TURN_5,
    });
    index += 1;
    if (segment < M_TOOLS.length) {
      items.push({
        kind: 'tool_call',
        toolId: `call_m_tool_${segment + 1}`,
        toolName: M_TOOLS[segment]!,
        input: { target: `segment-${segment + 1}` },
        result: 'ok',
        entryId: `entry_m_tool${segment + 1}`,
        canonicalIndex: index,
        turnId: M_TURN_5,
      });
      index += 1;
    }
  }
  return items;
}

function installWindowM(): void {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    writable: true,
    value: {
      kodaxSpace: {
        invoke: mockHistoryInvoke(() => {
          const revision = windowRevisionForCall();
          const items =
            revision === 'rev-0'
              ? buildMEarlierTurnItems()
              : [...buildMEarlierTurnItems(), ...buildMTurn5Items()];
          return pageResponse(items, revision);
        }),
      },
    },
  });
}

/** M 的事件序：session_start → thinking → 4×[text(段i,独立 providerRequestId)+tool_start+tool_result] → text(段5) → complete。 */
function streamMultiSegmentToolTurn(): void {
  const store = useAppStore.getState();
  const messageId = store.appendUserMessage(SID, M_Q5_TEXT, REAL_T.bgDone + 7 * 60_000);
  assert.ok(messageId);
  store.bindUserMessageRuntimeRun(SID, messageId, M_RUN_5);
  let seq = 0;
  const origin = () => ({
    runtimeId: L_RUNTIME_ID,
    runId: M_RUN_5,
    journalEpoch: M_EPOCH_5,
    seq: (seq += 1),
  });
  store.appendEvent({
    kind: 'session_start',
    sessionId: SID,
    provider: 'mock',
    turnId: M_TURN_5,
    runtimeEvent: origin(),
  });
  store.appendEvent({
    kind: 'queued_user_prompt_started',
    sessionId: SID,
    queueMode: 'after-turn',
    content: M_Q5_TEXT,
    turnId: M_TURN_5,
  });
  store.appendEvent({
    kind: 'thinking_delta',
    sessionId: SID,
    text: 'Five-segment structure: opening, origin, architecture, cases, roadmap…',
    turnId: M_TURN_5,
    runtimeEvent: origin(),
  });
  for (let segment = 0; segment < M_SEGMENTS.length; segment++) {
    store.appendEvent({
      kind: 'text_delta',
      sessionId: SID,
      text: M_SEGMENTS[segment]!,
      turnId: M_TURN_5,
      providerRequestId: `req-m-seg${segment + 1}`,
      runtimeEvent: origin(),
    });
    if (segment < M_TOOLS.length) {
      store.appendEvent({
        kind: 'tool_start',
        sessionId: SID,
        toolId: `call_m_tool_${segment + 1}`,
        toolName: M_TOOLS[segment]!,
        input: { target: `segment-${segment + 1}` },
        turnId: M_TURN_5,
        runtimeEvent: origin(),
      });
      store.appendEvent({
        kind: 'tool_result',
        sessionId: SID,
        toolId: `call_m_tool_${segment + 1}`,
        toolName: M_TOOLS[segment]!,
        content: 'ok',
        turnId: M_TURN_5,
        runtimeEvent: origin(),
      });
    }
  }
  store.appendEvent({
    kind: 'session_complete',
    sessionId: SID,
    turnId: M_TURN_5,
    runtimeEvent: origin(),
  });
}

/**
 * M 的失败门（对应真实症状二）：
 *  (a) query5 之前不得出现任何携带正文段的 assistant 卡；
 *  (b) tool 卡计数 == 4（芯片不得消失/重复）；
 *  (c) query5 之下的 assistant 段卡计数 == 5（不得合并成 1 张大卡）。
 * mode='observe' 只记录不抛错（用于穷尽变体时的观察运行），默认硬断言。
 */
function assertMFailureGates(
  label: string,
  mode: 'assert' | 'observe' = 'assert',
): void {
  const failures: string[] = [];
  const check = (ok: boolean, message: string): void => {
    if (ok) return;
    if (mode === 'observe') failures.push(message);
    else assert.fail(message);
  };
  const transcript = userBullets();
  console.log(`\n[M/${label}] composed transcript:`);
  for (const line of transcript) console.log(`  ${line}`);
  const q5Index = transcript.indexOf(`user:${M_Q5_TEXT.slice(0, 24)}`);
  check(q5Index >= 0, `[M/${label}] query5 可见:\n${transcript.join('\n')}`);
  if (q5Index === -1) {
    if (failures.length > 0) {
      console.log(`[M/${label}] OBSERVED gate failures (${failures.length})`);
    }
    return;
  }
  const seg1Prefix = M_SEGMENTS[0]!.slice(0, 24);
  const ghostsBeforeQ5 = transcript
    .slice(0, q5Index)
    .filter((line) => line.startsWith('assistant:') && line.includes(seg1Prefix));
  check(
    ghostsBeforeQ5.length === 0,
    `[M/${label}] 失败门(a)：query5 之前出现携带正文段的 assistant 卡（合并大卡骑到 query5 之上）:\n${transcript.join('\n')}`,
  );
  const toolCount = transcript.filter((line) => line.startsWith('tool:')).length;
  check(
    toolCount === M_TOOLS.length,
    `[M/${label}] 失败门(b)：tool 芯片数量为 ${toolCount}（应为 ${M_TOOLS.length}）:\n${transcript.join('\n')}`,
  );
  const segmentCards = M_SEGMENTS.map((segment) =>
    transcript.indexOf(`assistant:${segment.slice(0, 24)}`),
  );
  const cardsAfterQ5 = segmentCards.filter((index) => index > q5Index).length;
  check(
    cardsAfterQ5 === M_SEGMENTS.length,
    `[M/${label}] 失败门(c)：query5 之下的 assistant 段卡为 ${cardsAfterQ5}/${M_SEGMENTS.length}（合并成大卡即 <5）:\n${transcript.join('\n')}`,
  );
  console.log(
    `[M/${label}] gates: q5=${q5Index} toolCount=${toolCount} segmentCardIndexes=${JSON.stringify(segmentCards)}`,
  );
  if (failures.length > 0) {
    console.log(`[M/${label}] OBSERVED gate failures (${failures.length}):`);
    for (const failure of failures) console.log(`  - ${failure.split('\n')[0]}`);
  }
}

test('M. 多段 tool 轮快照重水合 → 整轮文本合并大卡骑到 query5 之上且芯片消失（失败门）', { skip: 'FEATURE_275 失败门：20260816 session 实测 RED（快照覆盖删除无条件清 delta、合成补发被 activeRun 门跳过、fold 不清孤儿 live 段 → 芯片 8≠4 且正文丢失）。P2 结算即退役落地后移除 skip 转绿。' }, async () => {
  // 步骤 1-2：起步页含 query1..answer4（全部 canonical），恢复 rev-0
  await seedSession();
  revisionByCall = ['rev-0', 'rev-1'];
  callIndex = 0;
  installWindowM();
  await restoreNewestSessionHistory(SID, 'code');
  dumpUserMessages('M after restore rev-0');

  // 步骤 3：手工事件序流 query5 轮（5 段 text + 4 个 tool）
  streamMultiSegmentToolTurn();
  dumpUserMessages('M after streaming query5 turn');

  // 步骤 4：快照重水合 —— lastTerminalRun=run-5；retained=5 段；cursor 覆盖全部（纯文本合成重建）
  seedRuntimeAuthority(L_RUNTIME_ID);
  const lastSeq = 3 + M_SEGMENTS.length * 3;
  const projection: SpaceSessionLiveProjectionT = {
    sessionId: SID,
    projectionRevision: 1,
    cursor: { runtimeId: L_RUNTIME_ID, seq: lastSeq, sessionId: SID, journalEpoch: M_EPOCH_5 },
    transcriptRevision: 'transcript-run-5',
    lastTerminalRun: {
      runId: M_RUN_5,
      sessionId: SID,
      turnId: M_TURN_5,
      phase: 'completed',
      startedAt: REAL_T.bgDone + 7 * 60_000,
      completedAt: REAL_T.bgDone + 9 * 60_000,
    },
    queuedRuns: [],
    queuedInputs: [],
    interactions: [],
    activeTools: [],
    todos: [],
    outputSegment: {
      retained: M_SEGMENTS.map((text, segment) => ({
        responseId: 'resp-m-run-5',
        providerRequestId: `req-m-seg${segment + 1}`,
        mode: 'replace' as const,
        startedAtSeq: 4 + segment * 3,
        assistantText: text,
        thinkingText: '',
        assistantTextStartOffset: 0,
        thinkingTextStartOffset: 0,
      })),
    },
  };
  const accepted = useAppStore.getState().replaceSessionLiveProjection(projection, {
    allowEqualHydration: true,
  });
  console.log(`M snapshot accepted=${accepted}`);
  dumpUserMessages('M after snapshot hydration');
  console.log(
    'M events after snapshot:',
    JSON.stringify(
      (useAppStore.getState().eventsBySession[SID] ?? []).map((event) =>
        event.kind === 'text_delta'
          ? `text[${event.providerRequestId ?? '-'}]:${event.text.slice(0, 12)}(seq${event.runtimeEvent?.seq})`
          : event.kind === 'tool_start'
            ? `tool_start:${event.toolId}`
            : event.kind,
      ),
    ),
  );

  // 步骤 5：terminal 认证读（rev-1 页含 query5 + 5 条 assistant item + 4 条 tool_call item）
  await reconcileTerminalSessionHistory({
    sessionId: SID,
    runtimeId: L_RUNTIME_ID,
    runId: M_RUN_5,
    phase: 'completed',
    cursorSeq: lastSeq,
    transcriptRevision: 'transcript-run-5',
    turnId: M_TURN_5,
  });
  dumpUserMessages('M after certified rev-1');
  assertMFailureGates('main');
  deactivateSessionHistoryPaging(SID);
  resetSessionHistoryPagingLifecycle();

  // ---------- M 变体 1：activeRun 在场 → 驱动 hydrateOutputSegments 纯文本合成重建 ----------
  // 主配方里 activeRun=undefined 时 L860 的门跳过合成、只做覆盖删除（文本丢失、孤儿芯片）。
  // 此变体补上 activeRun，观察合成路径能否把 5 段重建回 query5 之下、芯片是否保留。
  {
    await seedSession();
    revisionByCall = ['rev-0', 'rev-1'];
    callIndex = 0;
    installWindowM();
    await restoreNewestSessionHistory(SID, 'code');
    streamMultiSegmentToolTurn();
    seedRuntimeAuthority(L_RUNTIME_ID);
    const synthesis: SpaceSessionLiveProjectionT = {
      ...projection,
      sessionId: SID,
      activeRun: {
        runId: M_RUN_5,
        sessionId: SID,
        turnId: M_TURN_5,
        phase: 'running',
        startedAt: REAL_T.bgDone + 7 * 60_000,
      },
    };
    useAppStore.getState().replaceSessionLiveProjection(synthesis, { allowEqualHydration: true });
    dumpUserMessages('M variant synthesis activeRun after snapshot');
    console.log(
      'M variant synthesis events after snapshot:',
      JSON.stringify(
        (useAppStore.getState().eventsBySession[SID] ?? []).map((event) =>
          event.kind === 'text_delta'
            ? `text[${event.providerRequestId ?? '-'}]:${event.text.slice(0, 12)}(seq${event.runtimeEvent?.seq})`
            : event.kind === 'tool_start'
              ? `tool_start:${event.toolId}`
              : event.kind,
        ),
      ),
    );
    await reconcileTerminalSessionHistory({
      sessionId: SID,
      runtimeId: L_RUNTIME_ID,
      runId: M_RUN_5,
      phase: 'completed',
      cursorSeq: lastSeq,
      transcriptRevision: 'transcript-run-5',
      turnId: M_TURN_5,
    });
    dumpUserMessages('M variant synthesis activeRun after certified rev-1');
    assertMFailureGates('synthesisActiveRun');
    deactivateSessionHistoryPaging(SID);
    resetSessionHistoryPagingLifecycle();
  }

  // ---------- M 变体 2：retained 段 startedAtSeq 错位（全部挤到第 1 段之前） ----------
  // 同样带 activeRun 驱动合成，但 startedAtSeq 交错 —— 观察合成插入点漂移是否把 5 段
  // 合并成一张大卡、或把正文搬到 query5 之上（生产症状二的直接形态）。
  {
    await seedSession();
    revisionByCall = ['rev-0', 'rev-1'];
    callIndex = 0;
    installWindowM();
    await restoreNewestSessionHistory(SID, 'code');
    streamMultiSegmentToolTurn();
    seedRuntimeAuthority(L_RUNTIME_ID);
    const misaligned: SpaceSessionLiveProjectionT = {
      ...projection,
      sessionId: SID,
      activeRun: {
        runId: M_RUN_5,
        sessionId: SID,
        turnId: M_TURN_5,
        phase: 'running',
        startedAt: REAL_T.bgDone + 7 * 60_000,
      },
      outputSegment: {
        retained: M_SEGMENTS.map((text, segment) => ({
          responseId: 'resp-m-run-5',
          providerRequestId: `req-m-seg${segment + 1}`,
          mode: 'replace' as const,
          // 错位：除第 1 段外全部挤到 startedAtSeq=3（thinking 之后、第 1 段之前）
          startedAtSeq: segment === 0 ? 4 : 3,
          assistantText: text,
          thinkingText: '',
          assistantTextStartOffset: 0,
          thinkingTextStartOffset: 0,
        })),
      },
    };
    useAppStore.getState().replaceSessionLiveProjection(misaligned, { allowEqualHydration: true });
    dumpUserMessages('M variant misaligned startedAtSeq after snapshot');
    console.log(
      'M variant misaligned events after snapshot:',
      JSON.stringify(
        (useAppStore.getState().eventsBySession[SID] ?? []).map((event) =>
          event.kind === 'text_delta'
            ? `text[${event.providerRequestId ?? '-'}]:${event.text.slice(0, 12)}(seq${event.runtimeEvent?.seq})`
            : event.kind === 'tool_start'
              ? `tool_start:${event.toolId}`
              : event.kind,
        ),
      ),
    );
    await reconcileTerminalSessionHistory({
      sessionId: SID,
      runtimeId: L_RUNTIME_ID,
      runId: M_RUN_5,
      phase: 'completed',
      cursorSeq: lastSeq,
      transcriptRevision: 'transcript-run-5',
      turnId: M_TURN_5,
    });
    dumpUserMessages('M variant misaligned startedAtSeq after certified rev-1');
    assertMFailureGates('misalignedStartedAtSeq');
    deactivateSessionHistoryPaging(SID);
    resetSessionHistoryPagingLifecycle();
  }
});
