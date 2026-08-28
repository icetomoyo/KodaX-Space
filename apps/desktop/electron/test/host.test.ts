// KodaXHost integration test — Mock adapter end-to-end.
//
// 验证：create → send → 一连串 session.event push → session_complete
// 不依赖 electron 运行时（push.ts 只 import type WebContents；测试注入一个 stub target）。

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { SessionEvent } from '@kodax-space/space-ipc-schema';
import { kodaxHost } from '../kodax/host.js';
import { generateKodaxSessionId } from '../kodax/session-id.js';
import type { ManagedSession, PermissionRequestFn } from '../kodax/session-adapter.js';
import { runtimeHostAdapter } from '../kodax/runtime-host-adapter.js';
import { setRendererTarget } from '../ipc/push.js';
import {
  finalizePendingClipboardArtifacts,
  prepareClipboardArtifactsForSend,
  saveClipboardImage,
} from '../ipc/clipboard.js';
import { _resetDataPathsCacheForTesting, getKodaxDir } from '../kodax/data-paths.js';
import { permissionBroker } from '../permission/broker.js';
import { askUserBroker } from '../permission/ask-user-broker.js';
import { installSessionStoreMock, type MockSessionState } from './_helpers/session-store-mock.js';
import { setSessionStoreImpl } from '../kodax/session-store.js';
import { _resetMemoryStoreForTesting, setKey } from '../providers/keychain.js';
import { getScopedProviderCredential } from '@kodax-ai/kodax/llm';

// Stub webContents：捕获所有 session.event payload 到数组里
type CapturedSend = { channel: string; payload: unknown };
const captured: CapturedSend[] = [];

// FEATURE_038: host.delete 现在调 SDK deleteSession；测试注入 mock 避免触发
// 真 SDK 与真实用户持久化状态；这里只验证 host 行为。
let mockState: MockSessionState;

beforeEach(async () => {
  captured.length = 0;
  mockState = installSessionStoreMock();
  await kodaxHost.disposeAll();
  setRendererTarget(
    () =>
      ({
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
      }) as any,
  );
});

afterEach(async () => {
  await kodaxHost.disposeAll();
  setRendererTarget(() => null);
  mockState.reset();
  _resetMemoryStoreForTesting();
});

function getEvents(): readonly SessionEvent[] {
  return captured
    .filter((c) => c.channel === 'session.event')
    .map((c) => c.payload as SessionEvent);
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

test('embedded manual compact receives the exact Space keychain credential', async () => {
  _resetMemoryStoreForTesting();
  await setKey('anthropic', 'compact-credential');
  let scopedCredential: string | undefined;
  setSessionStoreImpl({
    listSessions: async () => [],
    forkSession: async () => null,
    rewindSession: async () => null,
    deleteSession: async () => ({ ok: true }),
    loadSession: async () => null,
    watchSessions: () => ({ close: () => undefined }),
    compactSession: async () => {
      scopedCredential = getScopedProviderCredential('anthropic');
      return {
        compacted: true,
        tokensBefore: 100,
        tokensAfter: 40,
        messages: [],
      };
    },
  });
  const { sessionId } = kodaxHost.createSession({
    projectRoot: '/r',
    provider: 'anthropic',
    surface: 'partner',
  });

  const result = await kodaxHost.requestCompact(sessionId);

  assert.equal(result.compacted, true);
  assert.equal(scopedCredential, 'compact-credential');
});

test('daemon manual compact fails closed for a Space keychain-only credential', async (t) => {
  _resetMemoryStoreForTesting();
  const originalEnv = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  await setKey('anthropic', 'compact-credential');
  const adapter = runtimeHostAdapter as unknown as { hasReadyRuntime(): boolean };
  const originalHasReadyRuntime = adapter.hasReadyRuntime;
  adapter.hasReadyRuntime = () => true;
  t.after(() => {
    adapter.hasReadyRuntime = originalHasReadyRuntime;
    if (originalEnv === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = originalEnv;
  });
  const { sessionId } = kodaxHost.createSession({
    projectRoot: '/r',
    provider: 'anthropic',
    surface: 'code',
  });

  const result = await kodaxHost.requestCompact(sessionId);

  assert.equal(result.ok, false);
  assert.match(result.reason ?? '', /compact credential binding/i);
  assert.match(result.reason ?? '', /automatic threshold compaction remains credential-bound/i);
});

test('daemon manual compact fails closed when no exact or external credential is available', async (t) => {
  _resetMemoryStoreForTesting();
  const originalEnv = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  const adapter = runtimeHostAdapter as unknown as { hasReadyRuntime(): boolean };
  const originalHasReadyRuntime = adapter.hasReadyRuntime;
  adapter.hasReadyRuntime = () => true;
  t.after(() => {
    adapter.hasReadyRuntime = originalHasReadyRuntime;
    if (originalEnv === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = originalEnv;
  });
  const { sessionId } = kodaxHost.createSession({
    projectRoot: '/r',
    provider: 'anthropic',
    surface: 'code',
  });

  const result = await kodaxHost.requestCompact(sessionId);

  assert.equal(result.ok, false);
  assert.match(result.reason ?? '', /compact credential binding/i);
});

test('daemon manual compact fails closed even when the Space process has an external credential', async (t) => {
  _resetMemoryStoreForTesting();
  const originalEnv = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY = 'external-compact-credential';
  let compactCalled = false;
  const adapter = runtimeHostAdapter as unknown as {
    hasReadyRuntime(): boolean;
    compactSession(input: unknown): Promise<{
      compacted: boolean;
      tokensBefore: number;
      tokensAfter: number;
    }>;
  };
  const originals = {
    hasReadyRuntime: adapter.hasReadyRuntime,
    compactSession: adapter.compactSession,
  };
  adapter.hasReadyRuntime = () => true;
  adapter.compactSession = async () => {
    compactCalled = true;
    return { compacted: true, tokensBefore: 100, tokensAfter: 40 };
  };
  t.after(() => {
    Object.assign(adapter, originals);
    if (originalEnv === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = originalEnv;
  });
  const { sessionId } = kodaxHost.createSession({
    projectRoot: '/r',
    provider: 'anthropic',
    surface: 'code',
  });

  const result = await kodaxHost.requestCompact(sessionId);

  assert.equal(result.ok, false);
  assert.match(result.reason ?? '', /compact credential binding/i);
  assert.equal(compactCalled, false);
});

test('Runtime-owned manual compact cannot fall back to embedded storage while Runtime reconnects', async (t) => {
  _resetMemoryStoreForTesting();
  let embeddedCompactCalled = false;
  let runtimeCompactCalled = false;
  setSessionStoreImpl({
    listSessions: async () => [],
    forkSession: async () => null,
    rewindSession: async () => null,
    deleteSession: async () => ({ ok: true }),
    loadSession: async () => null,
    watchSessions: () => ({ close: () => undefined }),
    compactSession: async () => {
      embeddedCompactCalled = true;
      return {
        compacted: true,
        tokensBefore: 100,
        tokensAfter: 40,
        messages: [],
      };
    },
  });
  const adapter = runtimeHostAdapter as unknown as {
    isRuntimeSelected(): boolean;
    hasReadyRuntime(): boolean;
    compactSession(input: unknown): Promise<{
      compacted: boolean;
      tokensBefore: number;
      tokensAfter: number;
    }>;
  };
  const originals = {
    isRuntimeSelected: adapter.isRuntimeSelected,
    hasReadyRuntime: adapter.hasReadyRuntime,
    compactSession: adapter.compactSession,
  };
  adapter.isRuntimeSelected = () => true;
  adapter.hasReadyRuntime = () => false;
  adapter.compactSession = async () => {
    runtimeCompactCalled = true;
    return { compacted: true, tokensBefore: 100, tokensAfter: 40 };
  };
  t.after(() => Object.assign(adapter, originals));
  const { sessionId } = kodaxHost.createSession({
    projectRoot: '/r',
    provider: 'anthropic',
    surface: 'code',
  });

  const result = await kodaxHost.requestCompact(sessionId);

  assert.equal(result.ok, false);
  assert.match(result.reason ?? '', /compact credential binding/i);
  assert.equal(embeddedCompactCalled, false);
  assert.equal(runtimeCompactCalled, false);
});

test('createSession accepts canonical KodaX IDs for both Coder and Partner', async () => {
  const coderId = await generateKodaxSessionId();
  const partnerId = await generateKodaxSessionId();
  assert.match(coderId, /^[A-Za-z0-9_-]{1,128}$/);
  assert.match(partnerId, /^[A-Za-z0-9_-]{1,128}$/);
  assert.notEqual(coderId, partnerId);

  const coder = kodaxHost.createSession({
    sessionId: coderId,
    projectRoot: '/r',
    provider: 'mock',
    surface: 'code',
  });
  const partner = kodaxHost.createSession({
    sessionId: partnerId,
    projectRoot: '/r',
    provider: 'mock',
    surface: 'partner',
  });

  assert.equal(coder.sessionId, coderId);
  assert.equal(partner.sessionId, partnerId);
  assert.equal(kodaxHost.get(coderId)?.surface, 'code');
  assert.equal(kodaxHost.get(partnerId)?.surface, 'partner');
});

test('createSession rejects duplicate and ambiguous explicit IDs', async () => {
  const sessionId = await generateKodaxSessionId();
  kodaxHost.createSession({ sessionId, projectRoot: '/r', provider: 'mock' });
  assert.throws(
    () => kodaxHost.createSession({ sessionId, projectRoot: '/r', provider: 'mock' }),
    /already exists in Space/i,
  );
  assert.throws(
    () =>
      kodaxHost.createSession({
        sessionId: 's_new',
        existingSessionId: 's_existing',
        projectRoot: '/r',
        provider: 'mock',
      }),
    /both newly allocated and resumed/i,
  );
});

test('createSession applies default reasoningMode = auto', () => {
  const { sessionId } = kodaxHost.createSession({ projectRoot: '/r', provider: 'mock' });
  assert.equal(kodaxHost.get(sessionId)?.reasoningMode, 'auto');
});

test('createSession resolves a concrete provider default model for Runtime side services', () => {
  const { sessionId } = kodaxHost.createSession({
    projectRoot: '/r',
    provider: 'zai-coding',
  });
  assert.equal(kodaxHost.get(sessionId)?.model, 'glm-5.3');
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
  assert.equal(
    events.some((e) => e.kind === 'session_complete'),
    false,
  );
});

test('cancel returns and emits cancelled fallback when adapter cancel never resolves', async () => {
  const never = new Promise<void>(() => {});
  kodaxHost.setFactory(
    (opts): ManagedSession => ({
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
      send: async () => ({ accepted: true, queued: false }),
      cancel: () => never,
      dispose: async () => {},
    }),
  );
  try {
    const { sessionId } = kodaxHost.createSession({ projectRoot: '/r', provider: 'mock' });
    const result = await Promise.race([
      kodaxHost.cancel(sessionId),
      new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), 100)),
    ]);
    assert.deepEqual(result, { cancelled: true });
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

test('permission requests honor the run-scoped mode after the live Session mode changes', async () => {
  let requestPermission: PermissionRequestFn | undefined;
  kodaxHost.setFactory((opts): ManagedSession => {
    requestPermission = opts.requestPermission;
    return {
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
      isRunning: () => false,
      send: async () => ({ accepted: true, queued: false }),
      cancel: async () => {},
      dispose: async () => {},
    };
  });

  try {
    const { sessionId } = kodaxHost.createSession({
      projectRoot: '/r',
      provider: 'mock',
      permissionMode: 'auto',
    });
    assert.equal(kodaxHost.setPermissionMode(sessionId, 'plan'), true);
    assert.ok(requestPermission);

    const result = await requestPermission({
      toolId: 'run-owned-edit',
      toolName: 'edit',
      input: { path: '/r/file.ts' },
      mode: 'auto',
    });

    assert.equal(result, 'allow_once');
    assert.equal(
      captured.some((entry) => entry.channel === 'permission.request'),
      false,
    );
  } finally {
    kodaxHost.setFactory(null);
  }
});

test('Runtime cancel preserves unknown and already-confirmed Stop receipts without synthetic terminal events', async (t) => {
  const adapter = runtimeHostAdapter as unknown as Record<string, unknown>;
  const originalIsRuntimeSelected = adapter.isRuntimeSelected;
  const originalAbortSessionRun = adapter.abortSessionRun;
  t.after(() => {
    adapter.isRuntimeSelected = originalIsRuntimeSelected;
    adapter.abortSessionRun = originalAbortSessionRun;
  });

  adapter.isRuntimeSelected = () => true;
  adapter.abortSessionRun = async (sessionId: string) =>
    sessionId.endsWith('unknown')
      ? {
          runId: 'run_unknown',
          sessionId,
          accepted: false,
          state: 'unknown',
          outcome: 'unknown',
          phase: 'unknown',
          revision: 2,
        }
      : {
          runId: 'run_confirmed',
          sessionId,
          accepted: false,
          state: 'confirmed',
          outcome: 'cancelled',
          phase: 'cancelled',
          revision: 3,
        };

  const unknown = kodaxHost.createSession({
    existingSessionId: 's_runtime_unknown',
    projectRoot: '/r',
    provider: 'zai-coding',
  });
  const unknownResult = await kodaxHost.cancel(unknown.sessionId);
  assert.deepEqual(unknownResult, {
    cancelled: false,
    stop: {
      runId: 'run_unknown',
      sessionId: 's_runtime_unknown',
      accepted: false,
      state: 'unknown',
      outcome: 'unknown',
      phase: 'unknown',
      revision: 2,
    },
  });
  assert.equal(
    getEvents().some(
      (event) => event.sessionId === unknown.sessionId && event.kind === 'session_error',
    ),
    false,
  );

  const confirmed = kodaxHost.createSession({
    existingSessionId: 's_runtime_confirmed',
    projectRoot: '/r',
    provider: 'zai-coding',
  });
  const confirmedResult = await kodaxHost.cancel(confirmed.sessionId);
  assert.deepEqual(confirmedResult, {
    cancelled: true,
    stop: {
      runId: 'run_confirmed',
      sessionId: 's_runtime_confirmed',
      accepted: false,
      state: 'confirmed',
      outcome: 'cancelled',
      phase: 'cancelled',
      revision: 3,
    },
  });
  assert.equal(
    getEvents().some(
      (event) => event.sessionId === confirmed.sessionId && event.kind === 'session_error',
    ),
    false,
  );
});

test('a stale exact Runtime Stop does not clean up interactions owned by the current Run', async (t) => {
  const adapter = runtimeHostAdapter as unknown as Record<string, unknown>;
  const originalIsRuntimeSelected = adapter.isRuntimeSelected;
  const originalAbortSessionRun = adapter.abortSessionRun;
  const originalPermissionCancel = permissionBroker.cancelSession;
  const originalAskUserCancel = askUserBroker.cancelSession;
  t.after(() => {
    adapter.isRuntimeSelected = originalIsRuntimeSelected;
    adapter.abortSessionRun = originalAbortSessionRun;
    permissionBroker.cancelSession = originalPermissionCancel;
    askUserBroker.cancelSession = originalAskUserCancel;
  });

  let permissionCancelCalls = 0;
  let askUserCancelCalls = 0;
  adapter.isRuntimeSelected = () => true;
  adapter.abortSessionRun = async (sessionId: string, runId?: string) => ({
    runId: runId ?? 'run_missing',
    sessionId,
    accepted: false,
    state: 'confirmed',
    outcome: 'completed',
    phase: 'completed',
    revision: 4,
  });
  permissionBroker.cancelSession = () => {
    permissionCancelCalls += 1;
  };
  askUserBroker.cancelSession = () => {
    askUserCancelCalls += 1;
  };

  const current = kodaxHost.createSession({
    existingSessionId: 's_runtime_successor',
    projectRoot: '/r',
    provider: 'zai-coding',
  });
  const result = await kodaxHost.cancel(current.sessionId, 'run_previous');

  assert.deepEqual(result, {
    cancelled: false,
    stop: {
      runId: 'run_previous',
      sessionId: current.sessionId,
      accepted: false,
      state: 'confirmed',
      outcome: 'completed',
      phase: 'completed',
      revision: 4,
    },
  });
  assert.equal(permissionCancelCalls, 0);
  assert.equal(askUserCancelCalls, 0);
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

test('disposeAll preserves durable attachments until the Session is deleted', async () => {
  const previousTestProfile = process.env.KODAX_TEST_ONBOARDING;
  process.env.KODAX_TEST_ONBOARDING = `host-attachments-${process.pid}`;
  _resetDataPathsCacheForTesting();
  const isolatedRoot = getKodaxDir();

  try {
    const { sessionId } = kodaxHost.createSession({ projectRoot: '/r', provider: 'mock' });
    const draft = await saveClipboardImage(
      {
        sessionId,
        base64:
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
        mediaType: 'image/png',
      },
      {
        normalizePastedImage: async (buffer) => ({
          buffer,
          mediaType: 'image/png',
          width: 1,
          height: 1,
        }),
      },
    );
    const [attachment] = await prepareClipboardArtifactsForSend(sessionId, [
      { kind: 'image', path: draft.path, mediaType: draft.mediaType },
    ]);
    await finalizePendingClipboardArtifacts(sessionId, [
      { kind: 'image', path: draft.path, mediaType: draft.mediaType },
    ]);

    await kodaxHost.disposeAll();
    await fs.stat(attachment!.path);

    assert.equal(await kodaxHost.delete(sessionId), true);
    await assert.rejects(() => fs.stat(attachment!.path), { code: 'ENOENT' });
  } finally {
    if (previousTestProfile === undefined) delete process.env.KODAX_TEST_ONBOARDING;
    else process.env.KODAX_TEST_ONBOARDING = previousTestProfile;
    _resetDataPathsCacheForTesting();

    const resolvedRoot = path.resolve(isolatedRoot);
    assert.equal(path.dirname(resolvedRoot), path.resolve(os.tmpdir()));
    assert.match(path.basename(resolvedRoot), /^kodax-test-host-attachments-/);
    await fs.rm(resolvedRoot, { recursive: true, force: true });
  }
});

test('disposeAll removes unsent draft attachments', async () => {
  const previousTestProfile = process.env.KODAX_TEST_ONBOARDING;
  process.env.KODAX_TEST_ONBOARDING = `host-drafts-${process.pid}`;
  _resetDataPathsCacheForTesting();
  const isolatedRoot = getKodaxDir();

  try {
    const { sessionId } = kodaxHost.createSession({ projectRoot: '/r', provider: 'mock' });
    const draft = await saveClipboardImage(
      {
        sessionId,
        base64:
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
        mediaType: 'image/png',
      },
      {
        normalizePastedImage: async (buffer) => ({
          buffer,
          mediaType: 'image/png',
          width: 1,
          height: 1,
        }),
      },
    );

    await kodaxHost.disposeAll();
    await assert.rejects(() => fs.stat(draft.path), { code: 'ENOENT' });
  } finally {
    if (previousTestProfile === undefined) delete process.env.KODAX_TEST_ONBOARDING;
    else process.env.KODAX_TEST_ONBOARDING = previousTestProfile;
    _resetDataPathsCacheForTesting();
    await fs.rm(isolatedRoot, { recursive: true, force: true });
  }
});

test('delete: returns false and preserves persisted state when SDK reports session_running', async () => {
  const sessionId = 's_busy_elsewhere';
  mockState.seed(sessionId, '/r', 'Busy elsewhere');
  mockState.setDeleteBusy(true);

  const deleted = await kodaxHost.delete(sessionId);

  assert.equal(deleted, false);
  assert.equal(mockState.has(sessionId), true);
});

test('delete: preserves committed attachments while SDK reports session_running', async () => {
  const previousTestProfile = process.env.KODAX_TEST_ONBOARDING;
  process.env.KODAX_TEST_ONBOARDING = `host-busy-attachments-${process.pid}`;
  _resetDataPathsCacheForTesting();
  const isolatedRoot = getKodaxDir();

  try {
    const { sessionId } = kodaxHost.createSession({ projectRoot: '/r', provider: 'mock' });
    const draft = await saveClipboardImage(
      {
        sessionId,
        base64:
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
        mediaType: 'image/png',
      },
      {
        normalizePastedImage: async (buffer) => ({
          buffer,
          mediaType: 'image/png',
          width: 1,
          height: 1,
        }),
      },
    );
    const [attachment] = await prepareClipboardArtifactsForSend(sessionId, [
      { kind: 'image', path: draft.path, mediaType: draft.mediaType },
    ]);
    await finalizePendingClipboardArtifacts(sessionId, [
      { kind: 'image', path: draft.path, mediaType: draft.mediaType },
    ]);
    mockState.setDeleteBusy(true);

    assert.equal(await kodaxHost.delete(sessionId), false);
    await fs.stat(attachment!.path);

    mockState.setDeleteBusy(false);
    assert.equal(await kodaxHost.delete(sessionId), true);
    await assert.rejects(() => fs.stat(attachment!.path), { code: 'ENOENT' });
  } finally {
    if (previousTestProfile === undefined) delete process.env.KODAX_TEST_ONBOARDING;
    else process.env.KODAX_TEST_ONBOARDING = previousTestProfile;
    _resetDataPathsCacheForTesting();
    await fs.rm(isolatedRoot, { recursive: true, force: true });
  }
});

test('delete: reattaches a local session when another KodaX process keeps disk state busy', async () => {
  const { sessionId } = kodaxHost.createSession({ projectRoot: '/r', provider: 'mock' });
  mockState.seed(sessionId, '/r', 'Busy local session');
  mockState.setDeleteBusy(true);

  assert.equal(await kodaxHost.delete(sessionId), false);
  assert.ok(kodaxHost.get(sessionId), 'busy delete should restore the disposed local session');
  assert.equal(mockState.has(sessionId), true);
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
