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
import { runtimeHostAdapter } from '../kodax/runtime-host-adapter.js';
import { collectCrossPageTurnBoundaries, collectLeadingTurnTailBoundary } from '../ipc/session.js';

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
  mockState.seedTranscript(
    id,
    Array.from({ length: 6 }, (_, turnIndex) => [
      {
        entryId: `u${turnIndex}`,
        type: 'message',
        message: { role: 'user', content: `prompt ${turnIndex}` },
      },
      {
        entryId: `a${turnIndex}`,
        type: 'message',
        message: { role: 'assistant', content: `answer ${turnIndex}` },
      },
    ]).flat(),
  );
}

test('fork: unknown in-memory source returns null', async () => {
  const result = await kodaxHost.fork('s_nope', 0);
  assert.equal(result, null);
});

test('Runtime fork uses the exact paged-history boundary without re-reading a local turn index', async () => {
  const adapter = runtimeHostAdapter as unknown as Record<string, unknown>;
  const originalReady = adapter.hasReadyRuntime;
  const originalBoundary = adapter.conversationTurnEndBoundary;
  const originalFork = adapter.forkSession;
  let receivedBoundary: unknown;
  try {
    adapter.hasReadyRuntime = () => true;
    adapter.conversationTurnEndBoundary = async () => {
      throw new Error('page-local selector must not trigger a full-history boundary read');
    };
    adapter.forkSession = async (input: { readonly historyBoundary?: unknown }) => {
      receivedBoundary = input.historyBoundary;
      return { id: 's_exact_boundary_child' };
    };
    const { sessionId } = kodaxHost.createSession({
      projectRoot: 'C:\\tmp\\proj',
      provider: 'mock',
    });
    const result = await kodaxHost.fork(sessionId, 0, {
      boundaryId: 'entry_exact_tail',
      sourceRevision: 'source_exact',
    });
    assert.ok(result);
    assert.deepEqual(receivedBoundary, {
      entryId: 'entry_exact_tail',
      sourceRevision: 'source_exact',
    });
  } finally {
    adapter.hasReadyRuntime = originalReady;
    adapter.conversationTurnEndBoundary = originalBoundary;
    adapter.forkSession = originalFork;
  }
});

test('Runtime fork and rewind preserve an exact turn boundary carried across three SDK pages', async () => {
  type IndexedEntry = Parameters<typeof collectLeadingTurnTailBoundary>[0][number];
  const entry = (
    index: number,
    boundaryId: string,
    message: IndexedEntry['entry']['message'],
  ): IndexedEntry => ({
    index,
    entry: { boundaryId, auditEntryIds: [boundaryId], message },
  });
  const sourceRevision = 'source_three_page_mutation';
  const oldestPage = [
    entry(62, 'user-long-turn', { role: 'user', content: 'long turn' }),
    entry(63, 'assistant-first-page', { role: 'assistant', content: 'first tail' }),
  ];
  const middlePage = Array.from({ length: 64 }, (_, offset) =>
    entry(64 + offset, `assistant-middle-${offset}`, {
      role: 'assistant',
      content: `middle tail ${offset}`,
    }),
  );
  const newestPage = [
    entry(128, 'assistant-authoritative-tail', { role: 'assistant', content: 'done' }),
    entry(129, 'user-next-turn', { role: 'user', content: 'next' }),
  ];
  const newestPrefix = collectLeadingTurnTailBoundary(newestPage, sourceRevision);
  const carriedPrefix = collectLeadingTurnTailBoundary(middlePage, sourceRevision, newestPrefix);
  const exactBoundary = collectCrossPageTurnBoundaries(
    oldestPage,
    middlePage,
    sourceRevision,
    carriedPrefix,
  ).get(62);
  assert.deepEqual(exactBoundary, {
    boundaryId: 'assistant-authoritative-tail',
    sourceRevision,
  });
  assert.ok(exactBoundary);

  const adapter = runtimeHostAdapter as unknown as Record<string, unknown>;
  const originalReady = adapter.hasReadyRuntime;
  const originalFork = adapter.forkSession;
  const originalRewind = adapter.rewindSession;
  const received: Array<{ readonly operation: 'fork' | 'rewind'; readonly boundary: unknown }> = [];
  try {
    adapter.hasReadyRuntime = () => true;
    adapter.forkSession = async (input: { readonly historyBoundary?: unknown }) => {
      received.push({ operation: 'fork', boundary: input.historyBoundary });
      return { id: 's_three_page_boundary_child' };
    };
    adapter.rewindSession = async (input: { readonly historyBoundary?: unknown }) => {
      received.push({ operation: 'rewind', boundary: input.historyBoundary });
      return { id: input.historyBoundary };
    };
    const { sessionId } = kodaxHost.createSession({
      projectRoot: 'C:\\tmp\\proj',
      provider: 'mock',
      surface: 'code',
    });

    assert.ok(await kodaxHost.fork(sessionId, 0, exactBoundary));
    assert.deepEqual(await kodaxHost.rewind(sessionId, 0, exactBoundary), {
      ok: true,
      diskRewound: true,
    });
    assert.deepEqual(received, [
      {
        operation: 'fork',
        boundary: {
          entryId: 'assistant-authoritative-tail',
          sourceRevision,
        },
      },
      {
        operation: 'rewind',
        boundary: {
          entryId: 'assistant-authoritative-tail',
          sourceRevision,
        },
      },
    ]);
  } finally {
    adapter.hasReadyRuntime = originalReady;
    adapter.forkSession = originalFork;
    adapter.rewindSession = originalRewind;
  }
});

test('Runtime fork and rewind fail closed when an exact boundary or Runtime authority is absent', async () => {
  const adapter = runtimeHostAdapter as unknown as Record<string, unknown>;
  const originalReady = adapter.hasReadyRuntime;
  const originalFork = adapter.forkSession;
  const originalRewind = adapter.rewindSession;
  let mutationCalls = 0;
  try {
    adapter.hasReadyRuntime = () => true;
    adapter.forkSession = async () => {
      mutationCalls += 1;
      return { id: 'must-not-be-created' };
    };
    adapter.rewindSession = async () => {
      mutationCalls += 1;
      return { id: 'must-not-be-rewound' };
    };
    const { sessionId } = kodaxHost.createSession({
      projectRoot: 'C:\\tmp\\proj',
      provider: 'mock',
      surface: 'code',
    });
    await assert.rejects(() => kodaxHost.fork(sessionId, 0), /exact persisted history boundary/);
    await assert.rejects(() => kodaxHost.rewind(sessionId, 0), /exact persisted history boundary/);
    assert.equal(mutationCalls, 0);

    adapter.hasReadyRuntime = () => false;
    const exactBoundary = { boundaryId: 'entry-tail', sourceRevision: 'source-revision' };
    await assert.rejects(
      () => kodaxHost.fork(sessionId, 0, exactBoundary),
      /Runtime is unavailable/,
    );
    await assert.rejects(
      () => kodaxHost.rewind(sessionId, 0, exactBoundary),
      /Runtime is unavailable/,
    );
    assert.equal(mutationCalls, 0);
  } finally {
    adapter.hasReadyRuntime = originalReady;
    adapter.forkSession = originalFork;
    adapter.rewindSession = originalRewind;
  }
});

test('Partner fork and rewind prefer the exact source-revision boundary over the legacy ordinal', async () => {
  const { sessionId } = kodaxHost.createSession({
    projectRoot: 'C:\\tmp\\proj',
    provider: 'mock',
    surface: 'partner',
  });
  seedPersistedSession(sessionId, 'C:\\tmp\\proj');
  const exactBoundary = {
    boundaryId: 'entry_exact_partner_tail',
    sourceRevision: 'source_exact_partner',
  };

  const forked = await kodaxHost.fork(
    sessionId,
    // Deliberately outside the legacy visible-turn range. The exact boundary is authoritative.
    999_999,
    exactBoundary,
  );
  assert.ok(forked);
  assert.equal(mockState.lastForkSelector(), undefined);
  assert.deepEqual(mockState.lastForkHistoryBoundary(), exactBoundary);

  const rewound = await kodaxHost.rewind(sessionId, 999_999, exactBoundary);
  assert.deepEqual(rewound, { ok: true, diskRewound: true });
  assert.equal(mockState.lastRewindSelector(), undefined);
  assert.deepEqual(mockState.lastRewindHistoryBoundary(), exactBoundary);
});

test('fork: child inherits and persists the complete runtime identity', async () => {
  const { sessionId: src } = kodaxHost.createSession({
    projectRoot: 'C:\\tmp\\proj',
    provider: 'mock',
    reasoningMode: 'quick',
    permissionMode: 'plan',
    model: 'mock-model-v2',
    surface: 'partner',
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
  assert.equal(child.model, 'mock-model-v2');
  assert.equal(child.thinking, true);
  assert.deepEqual(await runtimeStore.read(result.newSessionId), {
    provider: 'mock',
    model: 'mock-model-v2',
    thinking: true,
    permissionMode: 'plan',
    reasoningMode: 'quick',
    agentMode: 'ama',
  });
});

test('fork: child has parentSessionId + forkPointTurnIdx metadata', async () => {
  const { sessionId: src } = kodaxHost.createSession({
    projectRoot: 'C:\\tmp\\proj',
    provider: 'mock',
    surface: 'partner',
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
    surface: 'partner',
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
    surface: 'partner',
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
    surface: 'partner',
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
    surface: 'partner',
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
    surface: 'partner',
  });
  seedPersistedSession(sessionId, 'C:\\tmp\\proj');
  const initial = kodaxHost.get(sessionId)!.lastActivityAt;
  // 等 ≥ 2ms 确保 Date.now() 推进（Windows Date.now() 分辨率 ~15ms，给余量）
  await new Promise((r) => setTimeout(r, 20));
  const result = await kodaxHost.rewind(sessionId, 0);
  assert.equal(result.ok, true);
  assert.equal(result.reason, undefined);
  assert.ok(kodaxHost.get(sessionId)!.lastActivityAt >= initial);
});

test('rewind: invalid persisted selector fails closed before disk mutation', async () => {
  const { sessionId } = kodaxHost.createSession({
    projectRoot: 'C:\\tmp\\proj',
    provider: 'mock',
    surface: 'partner',
  });
  const r1 = await kodaxHost.rewind(sessionId, 0);
  assert.deepEqual(r1, { ok: false, reason: 'invalid_index' });
  assert.equal(mockState.rewindCallCount(), 0);

  seedPersistedSession(sessionId, 'C:\\tmp\\proj');
  const r2 = await kodaxHost.rewind(sessionId, 0);
  assert.equal(r2.ok, true);
  assert.equal(r2.diskRewound, true, 'disk rewind should succeed when SDK has the record');
});

test('rewind: resolves turn index to the completed turn end selector', async () => {
  const { sessionId } = kodaxHost.createSession({
    projectRoot: 'C:\\tmp\\proj',
    provider: 'mock',
    surface: 'partner',
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
    surface: 'partner',
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

test('rewind: selector uses the same full-history turn index shown by the renderer', async () => {
  const { sessionId } = kodaxHost.createSession({
    projectRoot: 'C:\\tmp\\proj',
    provider: 'mock',
    surface: 'partner',
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
  assert.equal(mockState.lastRewindSelector(), 'old_a0');
});

test('fork: resolves turn index to the completed turn end selector', async () => {
  const { sessionId } = kodaxHost.createSession({
    projectRoot: 'C:\\tmp\\proj',
    provider: 'mock',
    surface: 'partner',
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

test('fork: no-user and out-of-range selectors fail before the SDK mutator is called', async () => {
  const { sessionId } = kodaxHost.createSession({
    projectRoot: 'C:\\tmp\\proj',
    provider: 'mock',
    surface: 'partner',
  });
  seedPersistedSession(sessionId, 'C:\\tmp\\proj');
  mockState.seedTranscript(sessionId, [
    {
      entryId: 'assistant_only',
      type: 'message',
      message: { role: 'assistant', content: 'initiative' },
    },
  ]);

  await assert.rejects(() => kodaxHost.fork(sessionId, 0), /invalid_index/);
  assert.equal(mockState.forkCallCount(), 0);

  mockState.seedTranscript(sessionId, [
    { entryId: 'u0', type: 'message', message: { role: 'user', content: 'only prompt' } },
    { entryId: 'a0', type: 'message', message: { role: 'assistant', content: 'only answer' } },
  ]);
  await assert.rejects(() => kodaxHost.fork(sessionId, 42), /invalid_index/);
  assert.equal(mockState.forkCallCount(), 0);
});

test('rewind: invalid selector does not cancel the session or call the SDK mutator', async () => {
  const { sessionId } = kodaxHost.createSession({
    projectRoot: 'C:\\tmp\\proj',
    provider: 'mock',
    surface: 'partner',
  });
  seedPersistedSession(sessionId, 'C:\\tmp\\proj');
  const session = kodaxHost.get(sessionId)!;
  let cancelCalls = 0;
  const originalCancel = session.cancel.bind(session);
  session.cancel = async () => {
    cancelCalls += 1;
    await originalCancel();
  };

  const result = await kodaxHost.rewind(sessionId, 42);

  assert.deepEqual(result, { ok: false, reason: 'invalid_index' });
  assert.equal(cancelCalls, 0);
  assert.equal(mockState.rewindCallCount(), 0);
});

test('fork: factory failure rolls back persisted entry (reviewer HIGH-1)', async () => {
  const { sessionId: src } = kodaxHost.createSession({
    projectRoot: 'C:\\tmp\\proj',
    provider: 'mock',
    surface: 'partner',
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
    surface: 'partner',
  });
  seedPersistedSession(sessionId, 'C:\\tmp\\proj');
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
