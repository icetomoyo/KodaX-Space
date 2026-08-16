import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { forkSessionForIpc, rewindSessionForIpc } from '../ipc/session.js';
import { kodaxHost } from '../kodax/host.js';
import { runtimeHostAdapter } from '../kodax/runtime-host-adapter.js';
import {
  SessionRuntimeStore,
  setSessionRuntimeStoreForTesting,
} from '../kodax/session-runtime-store.js';
import { setUserConfigImpl, type KodaxUserConfigImpl } from '../kodax/user-config.js';
import { providerConfigStore } from '../providers/config.js';
import { installSessionStoreMock, type MockSessionState } from './_helpers/session-store-mock.js';

const mutableProviderConfigStore = providerConfigStore as unknown as {
  spaceCache: unknown;
  customCache: unknown;
  spaceFile: string;
  spaceDir: string;
  customFile: string;
  customDir: string;
};

let mockState: MockSessionState;
let tmpDir = '';
let runtimeStore: SessionRuntimeStore;
let originalProviderConfigStore: typeof mutableProviderConfigStore;

beforeEach(async () => {
  originalProviderConfigStore = { ...mutableProviderConfigStore };
  mockState = installSessionStoreMock();
  const userConfig: KodaxUserConfigImpl = {
    loadConfig: (() => ({ provider: 'mock' })) as never,
    registerCustomProviders: (() => undefined) as never,
  };
  setUserConfigImpl(userConfig);
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'kodax-historical-mutation-ipc-'));
  mutableProviderConfigStore.spaceCache = null;
  mutableProviderConfigStore.customCache = null;
  mutableProviderConfigStore.spaceFile = path.join(tmpDir, 'space.json');
  mutableProviderConfigStore.spaceDir = tmpDir;
  mutableProviderConfigStore.customFile = path.join(tmpDir, 'custom.json');
  mutableProviderConfigStore.customDir = tmpDir;
  runtimeStore = new SessionRuntimeStore(path.join(tmpDir, 'session-runtime'));
  setSessionRuntimeStoreForTesting(runtimeStore);
  await kodaxHost.disposeAll();
});

afterEach(async () => {
  const cleanupErrors: unknown[] = [];
  try {
    await kodaxHost.disposeAll();
  } catch (error) {
    cleanupErrors.push(error);
  }
  const synchronousCleanups: readonly (() => void)[] = [
    () => setUserConfigImpl(null),
    () => setSessionRuntimeStoreForTesting(null),
    () => mockState.reset(),
    () => Object.assign(mutableProviderConfigStore, originalProviderConfigStore),
  ];
  for (const cleanup of synchronousCleanups) {
    try {
      cleanup();
    } catch (error) {
      cleanupErrors.push(error);
    }
  }
  try {
    await fs.rm(tmpDir, { recursive: true, force: true });
  } catch (error) {
    cleanupErrors.push(error);
  }
  if (cleanupErrors.length > 0) {
    throw new AggregateError(cleanupErrors, 'Failed to clean up historical Session IPC test');
  }
});

test('session.fork resumes a persisted-only Session and preserves its exact history boundary', async () => {
  const sessionId = 's_persisted_fork_source';
  const historyBoundary = {
    boundaryId: 'entry_exact_fork_tail',
    sourceRevision: 'source_exact_fork',
  };
  mockState.seedTagged(sessionId, 'C:/proj/example', 'code', 'historical fork source');
  await runtimeStore.set(sessionId, { provider: 'mock' });
  assert.equal(kodaxHost.get(sessionId), undefined);

  const adapter = runtimeHostAdapter as unknown as Record<string, unknown>;
  const originalReady = adapter.hasReadyRuntime;
  const originalFork = adapter.forkSession;
  let receivedBoundary: unknown;
  try {
    adapter.hasReadyRuntime = () => true;
    adapter.forkSession = async (input: { readonly historyBoundary?: unknown }) => {
      receivedBoundary = input.historyBoundary;
      return { id: 's_persisted_fork_child' };
    };

    const result = await forkSessionForIpc({
      sessionId,
      forkPointTurnIdx: 4,
      historyBoundary,
    });

    assert.equal(result.newSessionId, 's_persisted_fork_child');
    assert.equal(kodaxHost.get(sessionId)?.sessionId, sessionId);
    assert.deepEqual(receivedBoundary, {
      entryId: historyBoundary.boundaryId,
      sourceRevision: historyBoundary.sourceRevision,
    });
  } finally {
    adapter.hasReadyRuntime = originalReady;
    adapter.forkSession = originalFork;
  }
});

test('session.rewind resumes a persisted-only Session and preserves its exact history boundary', async () => {
  const sessionId = 's_persisted_rewind_source';
  const historyBoundary = {
    boundaryId: 'entry_exact_rewind_tail',
    sourceRevision: 'source_exact_rewind',
  };
  mockState.seedTagged(sessionId, 'C:/proj/example', 'code', 'historical rewind source');
  await runtimeStore.set(sessionId, { provider: 'mock' });
  assert.equal(kodaxHost.get(sessionId), undefined);

  const adapter = runtimeHostAdapter as unknown as Record<string, unknown>;
  const originalReady = adapter.hasReadyRuntime;
  const originalRewind = adapter.rewindSession;
  let receivedBoundary: unknown;
  try {
    adapter.hasReadyRuntime = () => true;
    adapter.rewindSession = async (input: { readonly historyBoundary?: unknown }) => {
      receivedBoundary = input.historyBoundary;
      return { id: sessionId };
    };

    const result = await rewindSessionForIpc({
      sessionId,
      rewindPastTurnIdx: 4,
      historyBoundary,
    });

    assert.deepEqual(result, { ok: true, diskRewound: true });
    assert.equal(kodaxHost.get(sessionId)?.sessionId, sessionId);
    assert.deepEqual(receivedBoundary, {
      entryId: historyBoundary.boundaryId,
      sourceRevision: historyBoundary.sourceRevision,
    });
  } finally {
    adapter.hasReadyRuntime = originalReady;
    adapter.rewindSession = originalRewind;
  }
});
