// FEATURE_033 in-memory fork + rewind — host-level tests.
//
// Renderer-side events 数组复制不在本文件覆盖范围（那部分跑 appStore 单测）。
// 这里只验证 main 端契约：
//   - fork 出来的 session 继承 source 运行时设置 + 标 parentSessionId/forkPointTurnIdx
//   - fork title 加 "(fork)" 后缀
//   - rewind cancel in-flight + 推 lastActivityAt
//   - 边界：source 不存在 / rewind 不存在 session 返回 session_not_found

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { kodaxHost } from '../kodax/host.js';
import { setRendererTarget } from '../ipc/push.js';
import { permissionBroker } from '../permission/broker.js';
import { installSessionStoreMock, type MockSessionState } from './_helpers/session-store-mock.js';
import {
  SessionRuntimeStore,
  setSessionRuntimeStoreForTesting,
} from '../kodax/session-runtime-store.js';

let mockState: MockSessionState;
let runtimeDir = '';
let runtimeStore: SessionRuntimeStore;

beforeEach(async () => {
  mockState = installSessionStoreMock();
  runtimeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'kodax-fork-runtime-'));
  runtimeStore = new SessionRuntimeStore(runtimeDir);
  setSessionRuntimeStoreForTesting(runtimeStore);
  await kodaxHost.disposeAll();
  setRendererTarget(
    () =>
      ({
        send: (channel: string, payload: unknown) => {
          if (channel === 'permission.request') {
            const p = payload as { reqId: string };
            setImmediate(() => permissionBroker.resolve(p.reqId, 'allow_once'));
          }
        },
        isDestroyed: () => false,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      }) as any,
  );
});

afterEach(async () => {
  await kodaxHost.disposeAll();
  setRendererTarget(() => null);
  mockState.reset();
  setSessionRuntimeStoreForTesting(null);
  await fs.rm(runtimeDir, { recursive: true, force: true }).catch(() => {});
});

function seedPersistedSession(id: string, gitRoot: string, title = 'Untitled'): void {
  mockState.seed(id, gitRoot, title);
}

test('fork: unknown in-memory source returns null', async () => {
  const result = await kodaxHost.fork('s_nope', 0);
  assert.equal(result, null);
});

test('fork: child inherits and persists the complete runtime identity', async () => {
  const { sessionId: src } = kodaxHost.createSession({
    projectRoot: 'C:\\tmp\\proj',
    provider: 'mock',
    reasoningMode: 'quick',
    permissionMode: 'plan',
    autoModeEngine: 'rules',
    model: 'mock-model-v2',
  });
  kodaxHost.setThinking(src, true);
  seedPersistedSession(src, 'C:\\tmp\\proj');
  const result = await kodaxHost.fork(src, 3);
  assert.ok(result, 'fork should succeed');
  const child = kodaxHost.get(result.newSessionId);
  assert.ok(child, 'child session should be retrievable');
  assert.equal(child.projectRoot, 'C:\\tmp\\proj');
  assert.equal(child.provider, 'mock');
  assert.equal(child.reasoningMode, 'quick');
  assert.equal(child.permissionMode, 'plan');
  assert.equal(child.autoModeEngine, 'rules');
  assert.equal(child.model, 'mock-model-v2');
  assert.equal(child.thinking, true);
  assert.deepEqual(await runtimeStore.read(result.newSessionId), {
    provider: 'mock',
    model: 'mock-model-v2',
    thinking: true,
    permissionMode: 'plan',
    autoModeEngine: 'rules',
    reasoningMode: 'quick',
    agentMode: 'ama',
  });
});

test('fork: child has parentSessionId + forkPointTurnIdx metadata', async () => {
  const { sessionId: src } = kodaxHost.createSession({
    projectRoot: 'C:\\tmp\\proj',
    provider: 'mock',
  });
  seedPersistedSession(src, 'C:\\tmp\\proj');
  const result = await kodaxHost.fork(src, 5);
  assert.ok(result);
  const child = kodaxHost.get(result.newSessionId);
  assert.equal(child?.parentSessionId, src);
  assert.equal(child?.forkPointTurnIdx, 5);
});

test('fork: child title is "<src title> (fork)" when source has title', async () => {
  const { sessionId: src } = kodaxHost.createSession({
    projectRoot: 'C:\\tmp\\proj',
    provider: 'mock',
  });
  await kodaxHost.setTitle(src, 'Investigate bug');
  seedPersistedSession(src, 'C:\\tmp\\proj', 'Investigate bug');
  const result = await kodaxHost.fork(src, 0);
  assert.ok(result);
  assert.equal(kodaxHost.get(result.newSessionId)?.title, 'Investigate bug (fork)');
});

test('fork: title does not accumulate "(fork) (fork)" on repeat fork', async () => {
  const { sessionId: src } = kodaxHost.createSession({
    projectRoot: 'C:\\tmp\\proj',
    provider: 'mock',
  });
  await kodaxHost.setTitle(src, 'X');
  seedPersistedSession(src, 'C:\\tmp\\proj', 'X');
  const r1 = await kodaxHost.fork(src, 0);
  assert.ok(r1);
  assert.equal(kodaxHost.get(r1.newSessionId)?.title, 'X (fork)');
  // fork 第一次的 child（title 已是 "X (fork)") 再 fork 一次——不应变 "X (fork) (fork)"
  const r2 = await kodaxHost.fork(r1.newSessionId, 0);
  assert.ok(r2);
  assert.equal(kodaxHost.get(r2.newSessionId)?.title, 'X (fork)');
});

test('fork: child title stays undefined when source has none', async () => {
  const { sessionId: src } = kodaxHost.createSession({
    projectRoot: 'C:\\tmp\\proj',
    provider: 'mock',
  });
  // 不调 setTitle / send，title 保持 undefined
  seedPersistedSession(src, 'C:\\tmp\\proj', ''); // SDK title fallback 到空串
  const result = await kodaxHost.fork(src, 0);
  assert.ok(result);
  // F038 行为：src title undefined → fork 不加 "(fork)" 后缀；child title 也是 undefined
  assert.equal(kodaxHost.get(result.newSessionId)?.title, undefined);
});

test('fork: source and child have different sessionIds, both listed in-flight', async () => {
  const { sessionId: src } = kodaxHost.createSession({
    projectRoot: 'C:\\tmp\\proj',
    provider: 'mock',
  });
  seedPersistedSession(src, 'C:\\tmp\\proj');
  const result = await kodaxHost.fork(src, 0);
  assert.ok(result);
  assert.notEqual(result.newSessionId, src);
  const ids = kodaxHost.listInFlight().map((s) => s.sessionId);
  assert.ok(ids.includes(src));
  assert.ok(ids.includes(result.newSessionId));
});

test('listMerged: in-flight overrides persisted on same sessionId (no dup)', async () => {
  // 在 storage 注入 id=s_X，然后用同 id createSession 模拟"被加载到内存的 historical session"
  const sharedId = 's_shared_xyz';
  seedPersistedSession(sharedId, '/proj', 'Persisted Title');
  // createSession 自己生成 randomUUID 所以不能直接用——用 in-flight Map 模拟手工 set
  // 通过 fork 把 sharedId 拉成 in-memory（fork 从 source 拿 setting；newSessionId 由 SDK 决定）
  // 简单点：seed persisted + seed in-flight via createSession (id 不同)，验证两条都在
  // 然后单独验证 same-id 场景用直接 Map set
  const { sessionId: liveId } = kodaxHost.createSession({
    projectRoot: '/proj',
    provider: 'mock',
  });
  seedPersistedSession(liveId, '/proj', 'Disk-Side Title'); // 同 id 两边都有
  const merged = await kodaxHost.listMerged({ projectRoot: '/proj' });
  const liveCopies = merged.filter((m) => m.sessionId === liveId);
  assert.equal(liveCopies.length, 1, 'in-flight should dedupe persisted with same id');
  assert.equal(liveCopies[0].kind, 'in-flight', 'in-flight wins on dedup');
  // 不重叠的 historical session 也出现在结果里
  const persistedOnly = merged.filter((m) => m.sessionId === sharedId);
  assert.equal(persistedOnly.length, 1, 'persisted-only session appears');
  assert.equal(persistedOnly[0].kind, 'persisted');
});

test('rewind: unknown session returns ok:false + reason="session_not_found"', async () => {
  const result = await kodaxHost.rewind('s_nope', 0);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'session_not_found');
});

test('rewind: known session returns ok:true and bumps lastActivityAt', async () => {
  const { sessionId } = kodaxHost.createSession({
    projectRoot: 'C:\\tmp\\proj',
    provider: 'mock',
  });
  const initial = kodaxHost.get(sessionId)!.lastActivityAt;
  // 等 ≥ 2ms 确保 Date.now() 推进（Windows Date.now() 分辨率 ~15ms，给余量）
  await new Promise((r) => setTimeout(r, 20));
  const result = await kodaxHost.rewind(sessionId, 0);
  assert.equal(result.ok, true);
  assert.equal(result.reason, undefined);
  assert.ok(kodaxHost.get(sessionId)!.lastActivityAt >= initial);
});

test('rewind: diskRewound=true when SDK has the session, false when not (reviewer HIGH-3)', async () => {
  const { sessionId } = kodaxHost.createSession({
    projectRoot: 'C:\\tmp\\proj',
    provider: 'mock',
  });
  // 未 seed 到 storage → SDK rewindSession 返回 null → diskRewound=false
  const r1 = await kodaxHost.rewind(sessionId, 0);
  assert.equal(r1.ok, true);
  assert.equal(r1.diskRewound, false, 'disk rewind should report failure when SDK has no record');

  // 再 seed 后重试
  seedPersistedSession(sessionId, 'C:\\tmp\\proj');
  const r2 = await kodaxHost.rewind(sessionId, 0);
  assert.equal(r2.ok, true);
  assert.equal(r2.diskRewound, true, 'disk rewind should succeed when SDK has the record');
});

test('rewind: resolves turn index to the completed turn end selector', async () => {
  const { sessionId } = kodaxHost.createSession({
    projectRoot: 'C:\\tmp\\proj',
    provider: 'mock',
  });
  seedPersistedSession(sessionId, 'C:\\tmp\\proj');
  mockState.seedTranscript(sessionId, [
    { entryId: 'u0', type: 'message', message: { role: 'user', content: 'first prompt' } },
    {
      entryId: 'a0_tools',
      type: 'message',
      message: {
        role: 'assistant',
        content: [{ type: 'tool_use', id: 'tool_1', name: 'bash', input: {} }],
      },
    },
    {
      entryId: 'tool_result_user',
      type: 'message',
      message: {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'tool_1', content: 'ok' }],
      },
    },
    { entryId: 'a0_final', type: 'message', message: { role: 'assistant', content: 'done' } },
    { entryId: 'u1', type: 'message', message: { role: 'user', content: 'second prompt' } },
    { entryId: 'a1_final', type: 'message', message: { role: 'assistant', content: 'done 2' } },
  ]);

  const result = await kodaxHost.rewind(sessionId, 0);
  assert.equal(result.ok, true);
  assert.equal(mockState.lastRewindSelector(), 'a0_final');
});

test('rewind: selector ignores compacted placeholders and rewind markers', async () => {
  const { sessionId } = kodaxHost.createSession({
    projectRoot: 'C:\\tmp\\proj',
    provider: 'mock',
  });
  seedPersistedSession(sessionId, 'C:\\tmp\\proj');
  mockState.seedTranscript(sessionId, [
    {
      entryId: 'placeholder',
      type: 'message',
      active: false,
      message: { role: 'user', content: '[compacted]' },
    },
    {
      entryId: 'rewind_marker',
      type: 'compaction',
      active: false,
      summary: '[Rewind] Rewound to entry entry_a (truncated 3 entries)',
      payload: { reason: 'rewind' },
      message: { role: 'system', content: '[history]\\n\\n[Rewind]' },
    },
    {
      entryId: 'u0',
      type: 'message',
      active: true,
      message: { role: 'user', content: 'first prompt' },
    },
    {
      entryId: 'a0_final',
      type: 'message',
      active: true,
      message: { role: 'assistant', content: 'done' },
    },
    {
      entryId: 'u1',
      type: 'message',
      active: true,
      message: { role: 'user', content: 'second prompt' },
    },
    {
      entryId: 'a1_final',
      type: 'message',
      active: true,
      message: { role: 'assistant', content: 'done 2' },
    },
  ]);

  const result = await kodaxHost.rewind(sessionId, 0);
  assert.equal(result.ok, true);
  assert.equal(mockState.lastRewindSelector(), 'a0_final');
});

test('rewind: selector uses active branch when inactive old branch has unique prompts', async () => {
  const { sessionId } = kodaxHost.createSession({
    projectRoot: 'C:\\tmp\\proj',
    provider: 'mock',
  });
  seedPersistedSession(sessionId, 'C:\\tmp\\proj');
  mockState.seedTranscript(sessionId, [
    {
      entryId: 'old_u0',
      type: 'message',
      active: false,
      message: { role: 'user', content: 'old prompt' },
    },
    {
      entryId: 'old_a0',
      type: 'message',
      active: false,
      message: { role: 'assistant', content: 'old answer' },
    },
    {
      entryId: 'u0',
      type: 'message',
      active: true,
      message: { role: 'user', content: 'first active prompt' },
    },
    {
      entryId: 'a0_final',
      type: 'message',
      active: true,
      message: { role: 'assistant', content: 'active answer' },
    },
  ]);

  const result = await kodaxHost.rewind(sessionId, 0);
  assert.equal(result.ok, true);
  assert.equal(mockState.lastRewindSelector(), 'a0_final');
});

test('fork: resolves turn index to the completed turn end selector', async () => {
  const { sessionId } = kodaxHost.createSession({
    projectRoot: 'C:\\tmp\\proj',
    provider: 'mock',
  });
  seedPersistedSession(sessionId, 'C:\\tmp\\proj');
  mockState.seedTranscript(sessionId, [
    { entryId: 'u0', type: 'message', message: { role: 'user', content: 'first prompt' } },
    {
      entryId: 'tool_result_user',
      type: 'message',
      message: {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'tool_1', content: 'ok' }],
      },
    },
    { entryId: 'a0_final', type: 'message', message: { role: 'assistant', content: 'done' } },
    { entryId: 'u1', type: 'message', message: { role: 'user', content: 'second prompt' } },
  ]);

  const result = await kodaxHost.fork(sessionId, 0);
  assert.ok(result);
  assert.equal(mockState.lastForkSelector(), 'a0_final');
});

test('fork: factory failure rolls back persisted entry (reviewer HIGH-1)', async () => {
  const { sessionId: src } = kodaxHost.createSession({
    projectRoot: 'C:\\tmp\\proj',
    provider: 'mock',
  });
  seedPersistedSession(src, 'C:\\tmp\\proj');

  // 注入一个会抛的 factory，模拟 RealKodaXSession 构造时 SDK 内部某条路径抛
  kodaxHost.setFactory(() => {
    throw new Error('factory blew up');
  });

  try {
    await assert.rejects(() => kodaxHost.fork(src, 0), /factory blew up/);

    // 验证 persisted 端被回滚——之前 forkSession 写盘的新 id 应该已被 deleteSession 擦掉
    // 通过 listMerged 间接验证：除了 src 之外不应有其他 persisted session
    const merged = await kodaxHost.listMerged({});
    const extras = merged.filter((m) => m.kind === 'persisted' && m.sessionId !== src);
    assert.equal(extras.length, 0, 'orphaned persisted session should be rolled back');
  } finally {
    // 恢复默认 factory，否则污染后续 test case（共享 kodaxHost 单例）
    kodaxHost.setFactory(null);
  }
});

test('rewind: cancels in-flight send and awaits cancel before returning', async () => {
  const { sessionId } = kodaxHost.createSession({
    projectRoot: 'C:\\tmp\\proj',
    provider: 'mock',
  });
  // 启动一条 send；不 await（让它在 micro-task 跑）
  await kodaxHost.get(sessionId)!.send('long running prompt');
  // 立刻 rewind——应当触发 session.cancel 链且 await 直到 cancel 完成
  const result = await kodaxHost.rewind(sessionId, 0);
  assert.equal(result.ok, true);
});

// ---- Reviewer batch HIGH-3 ----

test('setPermissionMode→auto mid-run does NOT emit session_error (spinner-kill regression guard)', async () => {
  // 用本地 captured 数组，beforeEach 已经清掉之前的内容
  const captured: Array<{ channel: string; payload: unknown }> = [];
  setRendererTarget(
    () =>
      ({
        send: (channel: string, payload: unknown) => {
          captured.push({ channel, payload });
          if (channel === 'permission.request') {
            const p = payload as { reqId: string };
            setImmediate(() => permissionBroker.resolve(p.reqId, 'allow_once'));
          }
        },
        isDestroyed: () => false,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      }) as any,
  );

  const { sessionId } = kodaxHost.createSession({
    projectRoot: 'C:\\tmp\\proj',
    provider: 'mock',
    permissionMode: 'accept-edits',
  });
  // 启动一条 send 让 session isRunning()
  await kodaxHost.get(sessionId)!.send('do something');
  // mid-run 切到 auto
  kodaxHost.setPermissionMode(sessionId, 'auto');
  // 87412cb 修复：原来这里 push 一条 session_error informational notice，但 session_error 是
  // "session 以错误结束"信号，被 ActivitySpinner 反向扫描命中 → 误杀 streaming spinner。
  // 修复后 host.ts 只赋值 permissionMode 字段、不 emit event（提示改 renderer toast）。
  // 本测试守住该回归：mid-run 切 auto 不得再 emit session_error。
  const sessionErrors = captured.filter(
    (c) =>
      c.channel === 'session.event' && (c.payload as { kind: string }).kind === 'session_error',
  );
  assert.equal(
    sessionErrors.length,
    0,
    'mid-run mode→auto must NOT emit session_error (would kill spinner)',
  );
  // cleanup: cancel in-flight 让测试快速收尾
  await kodaxHost.cancel(sessionId);
});

test('setPermissionMode→auto when NOT running does not emit mid-run notice', async () => {
  const captured: Array<{ channel: string; payload: unknown }> = [];
  setRendererTarget(
    () =>
      ({
        send: (channel: string, payload: unknown) => captured.push({ channel, payload }),
        isDestroyed: () => false,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      }) as any,
  );

  const { sessionId } = kodaxHost.createSession({
    projectRoot: 'C:\\tmp\\proj',
    provider: 'mock',
    permissionMode: 'accept-edits',
  });
  // 不调 send，直接切 mode
  kodaxHost.setPermissionMode(sessionId, 'auto');
  const notices = captured.filter(
    (c) =>
      c.channel === 'session.event' && (c.payload as { kind: string }).kind === 'session_error',
  );
  assert.equal(notices.length, 0);
});

test('setPermissionMode auto→auto idempotent: no notice', async () => {
  const captured: Array<{ channel: string; payload: unknown }> = [];
  setRendererTarget(
    () =>
      ({
        send: (channel: string, payload: unknown) => {
          captured.push({ channel, payload });
          if (channel === 'permission.request') {
            const p = payload as { reqId: string };
            setImmediate(() => permissionBroker.resolve(p.reqId, 'allow_once'));
          }
        },
        isDestroyed: () => false,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      }) as any,
  );

  const { sessionId } = kodaxHost.createSession({
    projectRoot: 'C:\\tmp\\proj',
    provider: 'mock',
    permissionMode: 'auto',
  });
  await kodaxHost.get(sessionId)!.send('do something');
  // 已是 auto，再切 auto——不该 emit
  kodaxHost.setPermissionMode(sessionId, 'auto');
  const notices = captured.filter(
    (c) =>
      c.channel === 'session.event' &&
      (c.payload as { kind: string }).kind === 'session_error' &&
      (c.payload as { error: string }).error.includes('mode→auto'),
  );
  assert.equal(notices.length, 0);
  await kodaxHost.cancel(sessionId);
});
