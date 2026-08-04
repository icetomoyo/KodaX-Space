// host.tryResume — bring a persisted-only session back into the in-flight Map.
//
// 用户场景：重启 Space 后 main 进程 in-flight Map 是空的，但磁盘 ~/.kodax/sessions/ 仍
// 有 jsonl。Sidebar 的 Recents 把 persisted session 也列出来。点击它 → setCurrentSession
// → 用户打字 → session.send IPC handler 走 tryResume() 把它接管回 in-flight。

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { kodaxHost } from '../kodax/host.js';
import { deletePersistedSession, loadPersistedSession } from '../kodax/session-store.js';
import { assertClipboardImageOwnerSession } from '../ipc/clipboard.js';
import { setRendererTarget } from '../ipc/push.js';
import { installSessionStoreMock, type MockSessionState } from './_helpers/session-store-mock.js';
import { setUserConfigImpl, type KodaxUserConfigImpl } from '../kodax/user-config.js';
import { providerConfigStore } from '../providers/config.js';
import type { ManagedSession } from '../kodax/session-adapter.js';
import {
  SessionRuntimeStore,
  setSessionRuntimeStoreForTesting,
} from '../kodax/session-runtime-store.js';

let mockState: MockSessionState;
let tmpDir = '';
let runtimeStore: SessionRuntimeStore;

const mutableProviderConfigStore = providerConfigStore as unknown as {
  spaceCache: unknown;
  customCache: unknown;
  spaceFile: string;
  spaceDir: string;
  customFile: string;
  customDir: string;
};

beforeEach(async () => {
  mockState = installSessionStoreMock();
  mockUserConfig({});
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'kodax-host-resume-test-'));
  mutableProviderConfigStore.spaceCache = null;
  mutableProviderConfigStore.customCache = null;
  mutableProviderConfigStore.spaceFile = path.join(tmpDir, 'space.json');
  mutableProviderConfigStore.spaceDir = tmpDir;
  mutableProviderConfigStore.customFile = path.join(tmpDir, 'custom.json');
  mutableProviderConfigStore.customDir = tmpDir;
  runtimeStore = new SessionRuntimeStore(path.join(tmpDir, 'session-runtime'));
  setSessionRuntimeStoreForTesting(runtimeStore);
  await kodaxHost.disposeAll();
  // 不需要真 push；测试只看 host.sessions Map 的状态变化
  setRendererTarget(() => null);
});

afterEach(async () => {
  await kodaxHost.disposeAll();
  setRendererTarget(() => null);
  setUserConfigImpl(null);
  setSessionRuntimeStoreForTesting(null);
  mockState.reset();
  try {
    await fs.rm(tmpDir, { recursive: true, force: true });
  } catch {
    // ignore cleanup errors
  }
});

function mockUserConfig(
  config: Record<string, unknown>,
  opts: { registerCalls?: Array<{ customProviders?: unknown[] }> } = {},
): void {
  const impl: KodaxUserConfigImpl = {
    loadConfig: (() => config) as never,
    registerCustomProviders: ((payload: { customProviders?: unknown[] }) => {
      opts.registerCalls?.push(payload);
    }) as never,
  };
  setUserConfigImpl(impl);
}

test('tryResume returns false for sessionId that exists neither in-flight nor on disk', async () => {
  const ok = await kodaxHost.tryResume('s_does-not-exist');
  assert.equal(ok, false);
  assert.equal(kodaxHost.get('s_does-not-exist'), undefined);
});

test('tryResume rejects an unsafe Session ID before persisted lookup', async () => {
  assert.equal(await kodaxHost.tryResume('../session'), false);
  assert.equal(await kodaxHost.hasSession('../session'), false);
});

test('tryResume returns true immediately when session is already in-flight (no-op)', async () => {
  // Use mock provider 走 Mock factory，不依赖真 SDK 加载
  const { sessionId } = kodaxHost.createSession({
    projectRoot: 'C:/proj/example',
    provider: 'mock',
  });
  const sessionBefore = kodaxHost.get(sessionId);
  assert.ok(sessionBefore, 'session should be in-flight after createSession');

  const ok = await kodaxHost.tryResume(sessionId);
  assert.equal(ok, true);
  // Should be the SAME instance — tryResume must not recreate when already in-flight
  assert.equal(kodaxHost.get(sessionId), sessionBefore);
});

test('tryResume rehydrates a persisted-only session into the in-flight Map', async () => {
  // Seed mock storage 模拟磁盘上有这个 session
  const id = 's_persisted-only';
  mockState.seed(id, 'C:/proj/example', '你好');
  assert.equal(kodaxHost.get(id), undefined, 'precondition: not in-flight');

  const ok = await kodaxHost.tryResume(id);
  assert.equal(ok, true);
  const resumed = kodaxHost.get(id);
  assert.ok(resumed, 'tryResume should have added to in-flight Map');
  assert.equal(resumed!.sessionId, id);
  assert.equal(resumed!.projectRoot, 'C:/proj/example');
  // title 从 persisted 拉过来
  assert.equal(resumed!.title, '你好');
});

test('concurrent tryResume calls share one Session construction', async () => {
  const id = 's_concurrent-resume';
  mockState.seed(id, 'C:/proj/example', 'concurrent resume');
  let creates = 0;
  let disposes = 0;
  kodaxHost.setFactory((opts): ManagedSession => {
    creates += 1;
    return {
      sessionId: opts.sessionId,
      projectRoot: opts.projectRoot,
      provider: opts.provider,
      reasoningMode: opts.reasoningMode,
      permissionMode: opts.permissionMode,
      autoModeEngine: opts.autoModeEngine ?? 'llm',
      agentMode: opts.agentMode ?? 'ama',
      surface: opts.surface ?? 'code',
      ephemeral: opts.ephemeral,
      model: opts.model,
      createdAt: Date.now(),
      lastActivityAt: Date.now(),
      title: undefined,
      isRunning: () => false,
      send: async () => ({ accepted: true, queued: false }),
      cancel: async () => {},
      dispose: async () => {
        disposes += 1;
      },
    };
  });
  try {
    const results = await Promise.all([kodaxHost.tryResume(id), kodaxHost.tryResume(id)]);
    assert.deepEqual(results, [true, true]);
    assert.equal(creates, 1);
    assert.equal(kodaxHost.get(id)?.sessionId, id);
  } finally {
    await kodaxHost.disposeAll();
    kodaxHost.setFactory(null);
  }
  assert.equal(disposes, 1);
});

test('delete serializes with an in-flight tryResume and prevents Session resurrection', async () => {
  const id = 's_delete-resume-race';
  mockState.seed(id, 'C:/proj/example', 'delete resume race');
  let notifyLoadEntered: () => void = () => {};
  let releaseLoad: () => void = () => {};
  const loadEntered = new Promise<void>((resolve) => {
    notifyLoadEntered = resolve;
  });
  const loadRelease = new Promise<void>((resolve) => {
    releaseLoad = resolve;
  });
  mockState.setLoadSessionHook(async () => {
    notifyLoadEntered();
    await loadRelease;
  });

  const resume = kodaxHost.tryResume(id);
  await loadEntered;
  const deletion = kodaxHost.delete(id);
  releaseLoad();

  assert.equal(await resume, false);
  assert.equal(await deletion, true);
  assert.equal(kodaxHost.get(id), undefined);
  assert.equal(mockState.has(id), false);
  mockState.setLoadSessionHook(null);
});

test('persisted load invalidation cannot repopulate a deleted Session from a stale snapshot', async () => {
  const id = 's_delete-cache-race';
  mockState.seed(id, 'C:/proj/example', 'delete cache race');
  let notifyLoadEntered: () => void = () => {};
  let releaseLoad: () => void = () => {};
  const loadEntered = new Promise<void>((resolve) => {
    notifyLoadEntered = resolve;
  });
  const loadRelease = new Promise<void>((resolve) => {
    releaseLoad = resolve;
  });
  let loadCalls = 0;
  mockState.setLoadSessionAfterReadHook(async () => {
    loadCalls += 1;
    if (loadCalls !== 1) return;
    notifyLoadEntered();
    await loadRelease;
  });

  const staleLoad = loadPersistedSession(id);
  await loadEntered;
  assert.equal(await deletePersistedSession({ sessionId: id }), 'ok');
  releaseLoad();

  assert.equal(await staleLoad, null);
  assert.equal(loadCalls, 2, 'the invalidated in-flight read should be retried once');
  assert.equal(await loadPersistedSession(id), null);
  assert.equal(loadCalls, 3, 'a null result must not be cached as a durable Session');
  mockState.setLoadSessionAfterReadHook(null);
});

test('delete drains an in-flight ownership probe and rejects its stale result', async () => {
  const id = 's_owner-delete-race';
  mockState.seed(id, 'C:/proj/example', 'owner delete race');
  let notifyLoadEntered: () => void = () => {};
  let releaseLoad: () => void = () => {};
  const loadEntered = new Promise<void>((resolve) => {
    notifyLoadEntered = resolve;
  });
  const loadRelease = new Promise<void>((resolve) => {
    releaseLoad = resolve;
  });
  mockState.setLoadSessionAfterReadHook(async () => {
    notifyLoadEntered();
    await loadRelease;
  });

  const ownership = kodaxHost.hasSession(id);
  await loadEntered;
  const deletion = kodaxHost.delete(id);
  releaseLoad();

  assert.equal(await ownership, false);
  assert.equal(await deletion, true);
  assert.equal(await kodaxHost.hasSession(id), false);
  assert.equal(mockState.has(id), false);
  mockState.setLoadSessionAfterReadHook(null);
});

test('disposeAll drains an in-flight tryResume and leaves the Host empty', async () => {
  const id = 's_dispose-resume-race';
  mockState.seed(id, 'C:/proj/example', 'dispose resume race');
  let notifyLoadEntered: () => void = () => {};
  let releaseLoad: () => void = () => {};
  const loadEntered = new Promise<void>((resolve) => {
    notifyLoadEntered = resolve;
  });
  const loadRelease = new Promise<void>((resolve) => {
    releaseLoad = resolve;
  });
  mockState.setLoadSessionHook(async () => {
    notifyLoadEntered();
    await loadRelease;
  });

  const resume = kodaxHost.tryResume(id);
  await loadEntered;
  const disposal = kodaxHost.disposeAll();
  releaseLoad();

  assert.equal(await resume, false);
  await disposal;
  assert.equal(kodaxHost.get(id), undefined);
  assert.equal(kodaxHost.listInFlight().length, 0);
  assert.equal(mockState.has(id), true, 'shutdown must preserve the durable Session');
  mockState.setLoadSessionHook(null);
});

test('disposeAll drains an in-flight ownership probe and rejects its stale result', async () => {
  const id = 's_owner-dispose-race';
  mockState.seed(id, 'C:/proj/example', 'owner dispose race');
  let notifyLoadEntered: () => void = () => {};
  let releaseLoad: () => void = () => {};
  const loadEntered = new Promise<void>((resolve) => {
    notifyLoadEntered = resolve;
  });
  const loadRelease = new Promise<void>((resolve) => {
    releaseLoad = resolve;
  });
  mockState.setLoadSessionAfterReadHook(async () => {
    notifyLoadEntered();
    await loadRelease;
  });

  const ownership = kodaxHost.hasSession(id);
  await loadEntered;
  const disposal = kodaxHost.disposeAll();
  releaseLoad();

  assert.equal(await ownership, false);
  await disposal;
  assert.equal(kodaxHost.get(id), undefined);
  assert.equal(mockState.has(id), true, 'shutdown must preserve the durable Session');
  mockState.setLoadSessionAfterReadHook(null);
});

test('clipboard ownership accepts a persisted Session without instantiating its Runtime', async () => {
  const id = 's_persisted-attachment-owner';
  mockState.seed(id, 'C:/proj/example', 'attachment owner');
  assert.equal(kodaxHost.get(id), undefined, 'precondition: selected Session is persisted only');

  await assertClipboardImageOwnerSession(id, (sessionId) => kodaxHost.hasSession(sessionId));

  assert.equal(kodaxHost.get(id), undefined);
});

test('tryResume hydrates configured model when it belongs to the resolved provider', async () => {
  mockUserConfig({ provider: 'zhipu-coding', model: 'glm-5.2' });
  const id = 's_resume-model';
  mockState.seed(id, 'C:/proj/example', 'model resume');

  const ok = await kodaxHost.tryResume(id);
  assert.equal(ok, true);
  const resumed = kodaxHost.get(id);
  assert.ok(resumed);
  assert.equal(resumed.provider, 'zhipu-coding');
  assert.equal(resumed.model, 'glm-5.2');
});

test('tryResume prefers exact provider, model, and thinking from the session sidecar', async () => {
  mockUserConfig({ provider: 'zhipu-coding', model: 'glm-5.2', thinking: false });
  const id = 's_resume-exact-runtime';
  mockState.seed(id, 'C:/proj/example', 'exact runtime');
  await runtimeStore.set(id, {
    provider: 'openai',
    model: 'gpt-5.3-codex',
    thinking: true,
    reasoningMode: 'deep',
  });

  assert.equal(await kodaxHost.tryResume(id), true);
  const resumed = kodaxHost.get(id);
  assert.ok(resumed);
  assert.equal(resumed.provider, 'openai');
  assert.equal(resumed.model, 'gpt-5.3-codex');
  assert.equal(resumed.thinking, true);
  assert.equal(resumed.reasoningMode, 'deep');
});

test('tryResume falls back when a persisted provider is no longer configured', async () => {
  mockUserConfig({ provider: 'zhipu-coding', model: 'glm-5.2' });
  const id = 's_resume-removed-provider';
  mockState.seed(id, 'C:/proj/example', 'removed provider');
  await runtimeStore.set(id, { provider: 'removed-provider', model: 'removed-model' });

  assert.equal(await kodaxHost.tryResume(id), true);
  assert.equal(kodaxHost.get(id)?.provider, 'zhipu-coding');
  assert.equal(kodaxHost.get(id)?.model, 'glm-5.2');
});

test('tryResume accepts an arbitrary persisted model for a custom provider without a model allowlist', async () => {
  mockUserConfig({
    provider: 'custom-runtime',
    model: 'runtime-model-v2',
    customProviders: [
      {
        name: 'custom-runtime',
        protocol: 'openai',
        baseUrl: 'https://llm.example.com/v1',
        apiKeyEnv: 'CUSTOM_RUNTIME_KEY',
        model: 'runtime-default',
      },
    ],
  });
  const id = 's_resume-custom-model';
  mockState.seed(id, 'C:/proj/example', 'custom model');
  await runtimeStore.set(id, { provider: 'custom-runtime', model: 'runtime-model-v2' });

  assert.equal(await kodaxHost.tryResume(id), true);
  assert.equal(kodaxHost.get(id)?.provider, 'custom-runtime');
  assert.equal(kodaxHost.get(id)?.model, 'runtime-model-v2');
});

test('tryResume falls back to the resolved provider default when configured model does not belong', async () => {
  mockUserConfig({ provider: 'zhipu-coding', model: 'mimo-v2.5-pro' });
  const id = 's_resume-stale-model';
  mockState.seed(id, 'C:/proj/example', 'stale model');

  const ok = await kodaxHost.tryResume(id);
  assert.equal(ok, true);
  const resumed = kodaxHost.get(id);
  assert.ok(resumed);
  assert.equal(resumed.provider, 'zhipu-coding');
  assert.equal(resumed.model, 'glm-5.2');
});

test('tryResume registers Space custom default provider before rehydrating session', async () => {
  const registerCalls: Array<{ customProviders?: unknown[] }> = [];
  mockUserConfig({}, { registerCalls });
  const customId = await providerConfigStore.addCustom({
    displayName: 'Internal Gateway',
    protocol: 'openai',
    baseUrl: 'http://10.8.0.12:8080/v1',
    skipBaseUrlValidation: true,
    apiKeyEnv: 'INTERNAL_GATEWAY_API_KEY',
    defaultModel: 'gateway-model',
    models: ['gateway-model'],
  });
  await providerConfigStore.setDefault(customId);

  const id = 's_resume-custom-provider';
  mockState.seed(id, 'C:/proj/example', 'custom provider resume');

  const ok = await kodaxHost.tryResume(id);
  assert.equal(ok, true);
  assert.equal(kodaxHost.get(id)?.provider, customId);
  assert.equal(registerCalls.length, 1);
  const registeredNames = registerCalls[0]?.customProviders?.map(
    (p) => (p as { name?: string }).name,
  );
  assert.deepEqual(registeredNames, [customId]);
});

test('tryResume recovers surface from persisted SDK tag (Partner stays Partner)', async () => {
  // F045: 重启后 resume 一个 tag='partner' 的 session，必须恢复成 surface='partner'，
  // 否则它会被默认成 Coder 并在 in-flight 优先 dedup 下整段串面。
  const id = 's_partner-resumed';
  mockState.seedTagged(id, 'C:/proj/example', 'partner', 'doc work');
  const ok = await kodaxHost.tryResume(id);
  assert.equal(ok, true);
  assert.equal(kodaxHost.get(id)?.surface, 'partner');
});

test('tryResume defaults surface to "code" for legacy untagged persisted session', async () => {
  const id = 's_legacy-resumed';
  mockState.seed(id, 'C:/proj/example', 'old session'); // 无 tag
  const ok = await kodaxHost.tryResume(id);
  assert.equal(ok, true);
  assert.equal(kodaxHost.get(id)?.surface, 'code');
});

test('tryResume restores runtime modes from the session sidecar before KodaX defaults', async () => {
  mockUserConfig({ permissionMode: 'plan', reasoningMode: 'deep' });
  const id = 's_runtime-sidecar';
  mockState.seed(id, 'C:/proj/example', 'runtime sidecar');
  await runtimeStore.set(id, {
    permissionMode: 'auto',
    autoModeEngine: 'rules',
    reasoningMode: 'quick',
    agentMode: 'sa',
  });

  const ok = await kodaxHost.tryResume(id);
  assert.equal(ok, true);
  const resumed = kodaxHost.get(id);
  assert.ok(resumed);
  assert.equal(resumed.permissionMode, 'auto');
  assert.equal(resumed.autoModeEngine, 'rules');
  assert.equal(resumed.reasoningMode, 'quick');
  assert.equal(resumed.agentMode, 'sa');
});

test('tryResume bails out when persisted session lacks gitRoot', async () => {
  const id = 's_no-gitroot';
  // 不通过 seed 走，而是直接往 mock 里塞一个缺 gitRoot 的条目。当前 mock helper 不支持
  // 这种 shape，但我们可以通过空 string gitRoot 模拟近似 case：
  mockState.seed(id, '', 'broken');
  const ok = await kodaxHost.tryResume(id);
  assert.equal(ok, false, '空 gitRoot 应当被 tryResume 视为不可恢复');
  assert.equal(kodaxHost.get(id), undefined);
});
