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
