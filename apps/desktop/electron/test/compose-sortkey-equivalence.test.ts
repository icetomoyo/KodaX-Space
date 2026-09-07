/**
 * FEATURE_275 票 2：compose user 槽排序单一化（sortKey = canonicalIndex ?? historyTurnIndex ?? buffer 序）。
 *
 * 机制基线（docs/features/v0.1.46.md FEATURE_275 机制基线 #1，Issue 208 位置半边）：
 *   composeMessages 此前把 user 槽按 sentAt 平排排序，而 assistant events 按 buffer 位置
 *   消费。restore 服务器 sentAt / 本地 Date.now() / admission 序三种时钟混排时
 *   sentAt 序 ≠ 持久化序 → 后发轮次的 user 气泡骑到 canonical 页 / 前一轮之上，回答配对错位。
 *
 * 本文件用纯 composeMessages 生命线（无 store）钉死排序契约：
 *   1. canonical 行（canonicalIndex）服务钟超前于 live 行时，持久化序不被 sentAt 打翻；
 *   2. live 行本地 sentAt 倒挂时按 users 数组序（admission 序）渲染，回答跟随自己的提问；
 *   3. canonical 块内按 canonicalIndex 主键（sentAt 乱序不影响）；
 *   4. 绑定 turn 身份的行按 historyTurnIndex（sentAt 乱序不影响）；
 *   5. 同 sortKey 保持数组稳定序；
 *   6. local notice 仍按 sentAt 与 user 槽交织（sentAt 的剩余职责），但不再决定 user 槽之间的顺序；
 *   7. runId 路由（routeRuntimeOwnedEvents 的 owner 序）与 user 槽序一致，倒挂时钟下回答仍归位。
 *
 * HEAD（user 槽按 sentAt 排序）上 1/2/3/4/6/7 红；实现 sortKey 单一化后全绿。
 *
 * 运行：cd apps/desktop && node --test --test-concurrency=1 --import tsx
 *       "electron/test/compose-sortkey-equivalence.test.ts"
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { SessionEvent } from '@kodax-space/space-ipc-schema';
import {
  composeMessages,
  type ConversationMessage,
} from '../../renderer/src/features/session/composeMessages.js';
import type { LocalNoticeMessage, UserMessage } from '../../renderer/src/store/appStore.js';

const sid = 's_sortkey';

// ---- 服务器时钟（restore/canonical 页）与本地时钟（乐观 append）刻意错开：三种时钟混排 ----
const T_SERVER_PAGE = 10_000; // canonical 页行携带的服务器 sentAt（整页靠后）
const T_LOCAL_EARLIER = 5_000; // 本地钟落后服务器：后 admission 的 live 行 sentAt 反而更小

function userMsg(id: string, content: string, sentAt: number): UserMessage {
  return { id, content, sentAt };
}

function localMsg(id: string, content: string, sentAt: number): LocalNoticeMessage {
  return { id, content, sentAt };
}

function segment(text: string): SessionEvent[] {
  return [
    { kind: 'text_delta', sessionId: sid, text },
    { kind: 'session_complete', sessionId: sid },
  ];
}

function runSegment(runId: string, text: string, seq: number): SessionEvent[] {
  const origin = () => ({ runtimeId: 'rt-sortkey', runId, journalEpoch: 'epoch-sortkey', seq });
  return [
    { kind: 'text_delta', sessionId: sid, text, runtimeEvent: origin() },
    { kind: 'session_complete', sessionId: sid, runtimeEvent: origin() },
  ];
}

function composedLines(input: {
  readonly events: readonly SessionEvent[];
  readonly userMessages: readonly UserMessage[];
  readonly localNotices?: readonly LocalNoticeMessage[];
}): string[] {
  return composeMessages(input).map((message: ConversationMessage) => {
    switch (message.kind) {
      case 'user':
        return `user:${message.id}`;
      case 'assistant_text':
        return `assistant:${message.text}`;
      case 'local_notice':
        return `notice:${message.id}`;
      default:
        return `${message.kind}`;
    }
  });
}

test('canonical 页服务钟超前：live 追问按 admission 序垫底，不骑到 canonical 行之上', () => {
  // buffer 序 = 持久化序：canonical 页(60,64)在前，live 追问在后（本地钟落后服务器钟）。
  const userMessages = [
    userMsg('u_cbg', 'Q-bg', T_SERVER_PAGE), // canonicalIndex 60
    userMsg('u_cq1', 'Q-1', T_SERVER_PAGE + 100), // canonicalIndex 64
    userMsg('u_live', 'Q-live', T_LOCAL_EARLIER), // 无 canonical key，admission 在最后
  ].map((message, index) =>
    index === 0
      ? { ...message, canonicalIndex: 60 as const }
      : index === 1
        ? { ...message, canonicalIndex: 64 as const }
        : message,
  );
  const events = [...segment('A-bg'), ...segment('A-1'), ...segment('A-live')];

  const lines = composedLines({ events, userMessages });
  assert.deepEqual(lines, [
    'user:u_cbg',
    'assistant:A-bg',
    'user:u_cq1',
    'assistant:A-1',
    'user:u_live',
    'assistant:A-live',
  ]);
});

test('live 行 sentAt 倒挂（本地时钟偏移）：按数组 admission 序渲染，回答跟随自己的提问', () => {
  // 同为 live 行：第二条 admission 的本地 sentAt 反而更小（时钟偏移/重 stamp）。
  const userMessages = [userMsg('u_l1', 'first', 2_000), userMsg('u_l2', 'later', 1_500)];
  const events = [...segment('A-1'), ...segment('A-2')];

  const lines = composedLines({ events, userMessages });
  assert.deepEqual(lines, [
    'user:u_l1',
    'assistant:A-1',
    'user:u_l2',
    'assistant:A-2',
  ]);
});

test('canonical 块内按 canonicalIndex 主键：sentAt 乱序不影响持久化序', () => {
  // 纯排序契约（canonical 页行无 live events）：canonicalIndex 60 < 64 决定顺序。
  const userMessages = [
    { ...userMsg('u_idx64', 'later-page', T_SERVER_PAGE + 100), canonicalIndex: 64 as const },
    { ...userMsg('u_idx60', 'older-page', T_SERVER_PAGE + 200), canonicalIndex: 60 as const },
  ];
  const lines = composedLines({ events: [], userMessages });
  assert.deepEqual(lines, ['user:u_idx60', 'user:u_idx64']);
});

test('绑定 turn 身份的行按 historyTurnIndex：sentAt 乱序不影响 turn 序', () => {
  const userMessages = [
    { ...userMsg('u_t5', 'turn five', 900), historyTurnIndex: 5 as const },
    { ...userMsg('u_t4', 'turn four', 800), historyTurnIndex: 4 as const },
  ];
  const lines = composedLines({ events: [], userMessages });
  assert.deepEqual(lines, ['user:u_t4', 'user:u_t5']);
});

test('同 sortKey 保持数组稳定序（不打翻同 sentAt 的 admission 序）', () => {
  const userMessages = [userMsg('u_a', 'a', 1_000), userMsg('u_b', 'b', 1_000)];
  const lines = composedLines({ events: [], userMessages });
  assert.deepEqual(lines, ['user:u_a', 'user:u_b']);
});

test('local notice 仍按 sentAt 交织，但 user 槽顺序只由 sortKey 决定', () => {
  // canonical 行(c60)在前、live 行在后（sentAt 倒挂）；notice 的 sentAt 介于两者之间。
  // notice 交织锚定各 user 行自己的 sentAt：在第一个 sentAt 更大的 user 之前落位，
  // 而 user 槽之间不再按 sentAt 重排。
  const userMessages = [
    { ...userMsg('u_c', 'canonical', T_SERVER_PAGE), canonicalIndex: 60 as const },
    userMsg('u_live', 'live', T_LOCAL_EARLIER),
  ];
  const localNotices = [localMsg('n_mid', '/echo mid', 7_000)];
  const lines = composedLines({ events: [], userMessages, localNotices });
  assert.deepEqual(lines, ['notice:n_mid', 'user:u_c', 'user:u_live']);
});

test('runId 路由与 user 槽序一致：sentAt 倒挂时回答仍归位到自己的提问之下', () => {
  // routeRuntimeOwnedEvents 的 owner 序必须与 user 槽序同一把尺子：
  // l1/l2 sentAt 倒挂，events 各自带 runId 身份，倒挂下回答不得互换。
  const userMessages = [
    { ...userMsg('u_r1', 'first', 3_000), runtimeRunId: 'run_r1' as const },
    { ...userMsg('u_r2', 'later', 1_000), runtimeRunId: 'run_r2' as const },
  ];
  const events = [...runSegment('run_r1', 'A-r1', 1), ...runSegment('run_r2', 'A-r2', 2)];

  const lines = composedLines({ events, userMessages });
  assert.deepEqual(lines, [
    'user:u_r1',
    'assistant:A-r1',
    'user:u_r2',
    'assistant:A-r2',
  ]);
});
