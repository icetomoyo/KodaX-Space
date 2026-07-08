// KodaXHost integration test — Mock adapter end-to-end.
//
// 验证：create → send → 一连串 session.event push → session_complete
// 不依赖 electron 运行时（push.ts 只 import type WebContents；测试注入一个 stub target）。

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import type { SessionEvent } from '@kodax-space/space-ipc-schema';
import { kodaxHost } from '../kodax/host.js';
import type { ManagedSession } from '../kodax/session-adapter.js';
import { setRendererTarget } from '../ipc/push.js';
import { permissionBroker } from '../permission/broker.js';
import { installSessionStoreMock, type MockSessionState } from './_helpers/session-store-mock.js';

// Stub webContents：捕获所有 session.event payload 到数组里
type CapturedSend = { channel: string; payload: unknown };
const captured: CapturedSend[] = [];

// FEATURE_038: host.delete 现在调 SDK deleteSession；测试注入 mock 避免触发
// 真 SDK 加载（tsx/esm + cli-boxes JSON-as-JS bug）。
let mockState: MockSessionState;

beforeEach(async () => {
  captured.length = 0;
  mockState = installSessionStoreMock();
  await kodaxHost.disposeAll();
  setRendererTarget(() => ({
    send: (channel: string, payload: unknown) => {
      captured.push({ channel, payload });
      // F007: Mock 通过 broker 弹窗才能继续执行工具。测试自动 allow_once。
      // 危险命令场景的 typed-confirm 由 broker.test.ts 单独验证；这里只关心事件流。
      if (channel === 'permission.request') {
        const p = payload as { reqId: string };
        // 用 setImmediate 模拟 IPC 异步——避免在 push 发送过程中递归调用 resolve
        setImmediate(() => permissionBroker.resolve(p.reqId, 'allow_once'));
      }
    },
    isDestroyed: () => false,
    // 我们只用到 send/isDestroyed——其他字段 stub 一下避免类型噪音
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as any);
});

afterEach(async () => {
  await kodaxHost.disposeAll();
  setRendererTarget(() => null);
  mockState.reset();
});

function getEvents(): readonly SessionEvent[] {
  return captured.filter((c) => c.channel === 'session.event').map((c) => c.payload as SessionEvent);
}

function waitFor(predicate: () => boolean, timeoutMs = 3000): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const tick = (): void => {
      if (predicate()) return resolve();
      if (Date.now() - start > timeoutMs) return reject(new Error('waitFor timeout'));
      setTimeout(tick, 25);
    };
    tick();
  });
}

test('createSession: returns sessionId starting with "s_" + createdAt timestamp', () => {
  const result = kodaxHost.createSession({ projectRoot: '/r', provider: 'mock' });
  assert.match(result.sessionId, /^s_/);
  assert.ok(result.createdAt > 0);
  assert.equal(kodaxHost.get(result.sessionId)?.sessionId, result.sessionId);
});

test('createSession applies default reasoningMode = auto', () => {
  const { sessionId } = kodaxHost.createSession({ projectRoot: '/r', provider: 'mock' });
  assert.equal(kodaxHost.get(sessionId)?.reasoningMode, 'auto');
});

test('list: enumerates all created sessions', () => {
  kodaxHost.createSession({ projectRoot: '/r1', provider: 'mock' });
  kodaxHost.createSession({ projectRoot: '/r2', provider: 'mock', reasoningMode: 'deep' });
  const list = kodaxHost.listInFlight();
  assert.equal(list.length, 2);
});

test('end-to-end Mock stream: send → text_delta(s) → tool_start → tool_result → iteration_end → session_complete', async () => {
  const { sessionId } = kodaxHost.createSession({ projectRoot: '/r', provider: 'mock' });
  const session = kodaxHost.get(sessionId);
  assert.ok(session);

  await session.send('hello world');
  await waitFor(() => getEvents().some((e) => e.kind === 'session_complete'));

  const events = getEvents();
  const kinds = events.map((e) => e.kind);

  // F008：Mock 现在先推 harness_profile + work_budget，再走 thinking_delta
  assert.equal(kinds[0], 'harness_profile');
  // 中段必有 text_delta + tool_start + tool_result + iteration_end + thinking_delta + work_budget
  const required = [
    'thinking_delta',
    'text_delta',
    'tool_start',
    'tool_result',
    'iteration_end',
    'work_budget',
  ] as const;
  for (const k of required) {
    assert.ok(kinds.includes(k), `missing kind: ${k}`);
  }
  // 最后必是 session_complete
  assert.equal(kinds[kinds.length - 1], 'session_complete');

  // 所有事件 sessionId 都对得上
  for (const evt of events) {
    assert.equal(evt.sessionId, sessionId);
  }
});

test('cancel mid-stream emits session_error("cancelled") and aborts further events', async () => {
  const { sessionId } = kodaxHost.createSession({ projectRoot: '/r', provider: 'mock' });
  const session = kodaxHost.get(sessionId);
  assert.ok(session);

  await session.send('long task');
  // 等第一条 thinking_delta 落地，再 cancel
  await waitFor(() => getEvents().length >= 1);
  await kodaxHost.cancel(sessionId);

  await waitFor(() => getEvents().some((e) => e.kind === 'session_error'));
  const events = getEvents();
  const last = events[events.length - 1];
  assert.equal(last.kind, 'session_error');
  if (last.kind === 'session_error') {
    assert.equal(last.error, 'cancelled');
  }
  // session_complete 不应该出现在 cancel 后
  assert.equal(events.some((e) => e.kind === 'session_complete'), false);
});

test('cancel returns and emits cancelled fallback when adapter cancel never resolves', async () => {
  const never = new Promise<void>(() => {});
  kodaxHost.setFactory((opts): ManagedSession => ({
    sessionId: opts.sessionId,
    projectRoot: opts.projectRoot,
    provider: opts.provider,
    reasoningMode: opts.reasoningMode,
    permissionMode: opts.permissionMode,
    autoModeEngine: opts.autoModeEngine ?? 'llm',
    agentMode: opts.agentMode ?? 'ama',
    surface: opts.surface ?? 'code',
    createdAt: Date.now(),
    lastActivityAt: Date.now(),
    title: undefined,
    isRunning: () => true,
    send: async () => ({ queued: false }),
    cancel: () => never,
    dispose: async () => {},
  }));
  try {
    const { sessionId } = kodaxHost.createSession({ projectRoot: '/r', provider: 'mock' });
    const result = await Promise.race([
      kodaxHost.cancel(sessionId),
      new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), 100)),
    ]);
    assert.equal(result, true);
    const last = getEvents().at(-1);
    assert.equal(last?.kind, 'session_error');
    if (last?.kind === 'session_error') {
      assert.equal(last.error, 'cancelled');
      assert.equal(last.category, 'cancelled');
    }
  } finally {
    kodaxHost.setFactory(null);
  }
});

test('concurrent send on same session is rejected (no queueing in F003 Mock)', async () => {
  const { sessionId } = kodaxHost.createSession({ projectRoot: '/r', provider: 'mock' });
  const session = kodaxHost.get(sessionId);
  assert.ok(session);
  await session.send('first');
  await assert.rejects(() => session.send('second'), /in-flight/);
  // 清理：等第一个跑完
  await waitFor(() => getEvents().some((e) => e.kind === 'session_complete'));
});

test('delete: removes session from list (in-memory + persisted)', async () => {
  const { sessionId } = kodaxHost.createSession({ projectRoot: '/r', provider: 'mock' });
  assert.equal(kodaxHost.listInFlight().length, 1);
  const deleted = await kodaxHost.delete(sessionId);
  assert.equal(deleted, true);
  assert.equal(kodaxHost.listInFlight().length, 0);
  // FEATURE_038: SDK deleteSession 幂等（"ok: true even if session doesn't exist"），
  // host.delete 也是幂等的——第二次 delete 仍 ok（磁盘已确保不存在）。这与 F033
  // 旧 in-memory-only 语义（"second delete returns false"）不同；符合 REST DELETE 惯例。
  const second = await kodaxHost.delete(sessionId);
  assert.equal(second, true);
});

// ---- FEATURE_005: title + filtered list + setTitle ----

test('newly created session has no title', () => {
  const { sessionId } = kodaxHost.createSession({ projectRoot: '/r', provider: 'mock' });
  const session = kodaxHost.get(sessionId);
  assert.equal(session?.title, undefined);
});

test('ensureTitle: fills title from prompt the first time, no-op on subsequent', () => {
  const { sessionId } = kodaxHost.createSession({ projectRoot: '/r', provider: 'mock' });
  kodaxHost.ensureTitle(sessionId, 'Read package.json and explain it briefly');
  const first = kodaxHost.get(sessionId)?.title;
  assert.equal(first, 'Read package.json and explain it briefly');
  // 第二次调 ensureTitle 用不同 prompt 不应覆盖
  kodaxHost.ensureTitle(sessionId, 'a totally different prompt');
  assert.equal(kodaxHost.get(sessionId)?.title, first);
});

test('ensureTitle: long prompts get truncated to ~50 chars with ellipsis', () => {
  const { sessionId } = kodaxHost.createSession({ projectRoot: '/r', provider: 'mock' });
  const long = 'a'.repeat(200);
  kodaxHost.ensureTitle(sessionId, long);
  const title = kodaxHost.get(sessionId)?.title;
  assert.ok(title);
  assert.ok(title!.length <= 50, `title too long: ${title!.length}`);
  assert.ok(title!.endsWith('...'));
});

test('ensureTitle: collapses whitespace / newlines into single spaces', () => {
  const { sessionId } = kodaxHost.createSession({ projectRoot: '/r', provider: 'mock' });
  kodaxHost.ensureTitle(sessionId, '  hello\n\n  world  \tfoo  ');
  assert.equal(kodaxHost.get(sessionId)?.title, 'hello world foo');
});

test('ensureTitle: empty/whitespace-only prompt yields "Untitled"', () => {
  const { sessionId } = kodaxHost.createSession({ projectRoot: '/r', provider: 'mock' });
  kodaxHost.ensureTitle(sessionId, '   \n\t   ');
  assert.equal(kodaxHost.get(sessionId)?.title, 'Untitled');
});

test('setTitle: replaces an existing title', async () => {
  const { sessionId } = kodaxHost.createSession({ projectRoot: '/r', provider: 'mock' });
  kodaxHost.ensureTitle(sessionId, 'first');
  const ok = await kodaxHost.setTitle(sessionId, 'manual override');
  assert.equal(ok, true);
  assert.equal(kodaxHost.get(sessionId)?.title, 'manual override');
});

test('setTitle: returns false for non-existent session', async () => {
  const ok = await kodaxHost.setTitle('s_does_not_exist', 'whatever');
  assert.equal(ok, false);
});

test('setTitle: persists rename for a persisted-only session', async () => {
  const sessionId = 's_persisted_rename';
  mockState.seed(sessionId, '/r', 'Old title');

  const ok = await kodaxHost.setTitle(sessionId, 'Renamed title');
  assert.equal(ok, true);

  const merged = await kodaxHost.listMerged({ projectRoot: '/r' });
  const renamed = merged.find((m) => m.sessionId === sessionId);
  assert.equal(renamed?.kind, 'persisted');
  assert.equal(renamed?.title, 'Renamed title');
});

test('setTitle: in-flight rename survives fallback to persisted list', async () => {
  const { sessionId } = kodaxHost.createSession({ projectRoot: '/r', provider: 'mock' });
  mockState.seed(sessionId, '/r', 'Old disk title');

  const ok = await kodaxHost.setTitle(sessionId, 'Live renamed title');
  assert.equal(ok, true);
  assert.equal(kodaxHost.get(sessionId)?.title, 'Live renamed title');

  await kodaxHost.disposeAll();
  const merged = await kodaxHost.listMerged({ projectRoot: '/r' });
  const renamed = merged.find((m) => m.sessionId === sessionId);
  assert.equal(renamed?.kind, 'persisted');
  assert.equal(renamed?.title, 'Live renamed title');
});

test('delete clears a persisted title override', async () => {
  const sessionId = 's_deleted_rename';
  mockState.seed(sessionId, '/r', 'Old title');
  await kodaxHost.setTitle(sessionId, 'Temporary title');

  const deleted = await kodaxHost.delete(sessionId);
  assert.equal(deleted, true);

  mockState.seed(sessionId, '/r', 'Old title');
  const merged = await kodaxHost.listMerged({ projectRoot: '/r' });
  const row = merged.find((m) => m.sessionId === sessionId);
  assert.equal(row?.title, 'Old title');
});

// ---- Review fixes: Unicode-safe title + sanitization ----

test('ensureTitle: does not split surrogate-pair emoji at truncation boundary', () => {
  const { sessionId } = kodaxHost.createSession({ projectRoot: '/r', provider: 'mock' });
  // 50 个 a + 1 个 emoji——按 UTF-16 code unit slice 会切到 emoji 第一个 surrogate
  const prompt = 'a'.repeat(50) + '🔥end';
  kodaxHost.ensureTitle(sessionId, prompt);
  const title = kodaxHost.get(sessionId)?.title;
  assert.ok(title);
  // 不应出现孤立 surrogate（半个 emoji 编码非法）
  for (const ch of title!) {
    const code = ch.codePointAt(0)!;
    assert.ok(code < 0xd800 || code > 0xdfff, `lone surrogate at U+${code.toString(16)}`);
  }
});

test('sanitizeTitle path: strips RTL override character', () => {
  const { sessionId } = kodaxHost.createSession({ projectRoot: '/r', provider: 'mock' });
  // U+202E = RIGHT-TO-LEFT OVERRIDE
  kodaxHost.ensureTitle(sessionId, 'hello‮evil');
  const title = kodaxHost.get(sessionId)?.title;
  assert.ok(!title!.includes('‮'), `title contains RTL override: ${JSON.stringify(title)}`);
  assert.equal(title, 'helloevil');
});

test('sanitizeTitle path: strips zero-width chars and BOM', () => {
  const { sessionId } = kodaxHost.createSession({ projectRoot: '/r', provider: 'mock' });
  kodaxHost.ensureTitle(sessionId, 'h​e‌l﻿lo');
  assert.equal(kodaxHost.get(sessionId)?.title, 'hello');
});

test('sanitizeTitle path: strips C0 control chars', () => {
  const { sessionId } = kodaxHost.createSession({ projectRoot: '/r', provider: 'mock' });
  kodaxHost.ensureTitle(sessionId, 'hi\x00\x01\x07world');
  assert.equal(kodaxHost.get(sessionId)?.title, 'hiworld');
});

test('setTitle: same sanitization applies to user-supplied renames', async () => {
  const { sessionId } = kodaxHost.createSession({ projectRoot: '/r', provider: 'mock' });
  await kodaxHost.setTitle(sessionId, 'evil‮txt');
  assert.equal(kodaxHost.get(sessionId)?.title, 'eviltxt');
});

test('push payload: every captured event passes session.event schema', async () => {
  // 这个 test 保险 — push.ts 已经在发出前 zod 校验，但我们再确认捕获的 payload 形状对
  const { sessionId } = kodaxHost.createSession({ projectRoot: '/r', provider: 'mock' });
  const session = kodaxHost.get(sessionId);
  assert.ok(session);
  await session.send('test');
  await waitFor(() => getEvents().some((e) => e.kind === 'session_complete'));

  const { sessionEventChannel } = await import('@kodax-space/space-ipc-schema');
  for (const evt of getEvents()) {
    const result = sessionEventChannel.payload.safeParse(evt);
    assert.equal(result.success, true, `payload failed schema: ${JSON.stringify(evt)}`);
  }
});
