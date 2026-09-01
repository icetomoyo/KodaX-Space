import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SessionRuntimeStore } from '../kodax/session-runtime-store.js';
import { deleteSessionForIpc, resolveHistoricalRuntimeIdentity } from '../ipc/session.js';

let tmpDir = '';
let store: SessionRuntimeStore;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'kodax-session-runtime-'));
  store = new SessionRuntimeStore(path.join(tmpDir, 'runtime'));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
});

test('SessionRuntimeStore merges partial runtime patches', async () => {
  await store.set('s_runtime-1', {
    provider: 'zhipu-coding',
    model: 'glm-5.2',
    thinking: true,
    permissionMode: 'auto',
  });
  await store.set('s_runtime-1', { reasoningMode: 'ultra', agentMode: 'sa' });

  assert.deepEqual(await store.read('s_runtime-1'), {
    provider: 'zhipu-coding',
    model: 'glm-5.2',
    thinking: true,
    permissionMode: 'auto',
    reasoningMode: 'ultra',
    agentMode: 'sa',
  });
});

test('SessionRuntimeStore migrates a retired persisted AMAW mode to AMA', async () => {
  const runtimeDir = path.join(tmpDir, 'runtime');
  await fs.mkdir(runtimeDir, { recursive: true });
  await fs.writeFile(
    path.join(runtimeDir, 's_legacy-amaw.json'),
    JSON.stringify({
      version: 1,
      sessionId: 's_legacy-amaw',
      agentMode: 'amaw',
      updatedAt: '2026-07-18T00:00:00.000Z',
    }),
    'utf-8',
  );

  assert.deepEqual(await store.read('s_legacy-amaw'), { agentMode: 'ama' });
  const migrated = JSON.parse(
    await fs.readFile(path.join(runtimeDir, 's_legacy-amaw.json'), 'utf-8'),
  ) as Record<string, unknown>;
  assert.deepEqual(migrated, {
    version: 1,
    sessionId: 's_legacy-amaw',
    agentMode: 'ama',
    updatedAt: '2026-07-18T00:00:00.000Z',
  });
});

test('SessionRuntimeStore migrates the retired persisted ama-workflow alias to AMA', async () => {
  const runtimeDir = path.join(tmpDir, 'runtime');
  await fs.mkdir(runtimeDir, { recursive: true });
  await fs.writeFile(
    path.join(runtimeDir, 's_legacy-ama-workflow.json'),
    JSON.stringify({
      version: 1,
      sessionId: 's_legacy-ama-workflow',
      agentMode: 'ama-workflow',
      updatedAt: '2026-07-18T00:00:00.000Z',
    }),
    'utf-8',
  );

  assert.deepEqual(await store.read('s_legacy-ama-workflow'), { agentMode: 'ama' });
  const migrated = JSON.parse(
    await fs.readFile(path.join(runtimeDir, 's_legacy-ama-workflow.json'), 'utf-8'),
  ) as Record<string, unknown>;
  assert.deepEqual(migrated, {
    version: 1,
    sessionId: 's_legacy-ama-workflow',
    agentMode: 'ama',
    updatedAt: '2026-07-18T00:00:00.000Z',
  });
});

test('SessionRuntimeStore preserves malformed and schema-invalid bytes on update', async () => {
  const runtimeDir = path.join(tmpDir, 'runtime');
  await fs.mkdir(runtimeDir, { recursive: true });
  for (const [sessionId, original] of [
    ['s_malformed', Buffer.from('{broken json', 'utf-8')],
    [
      's_schema-invalid',
      Buffer.from(
        JSON.stringify({ version: 1, sessionId: 's_schema-invalid', unknown: true }),
        'utf-8',
      ),
    ],
  ] as const) {
    const filePath = path.join(runtimeDir, `${sessionId}.json`);
    await fs.writeFile(filePath, original);
    assert.equal(await store.read(sessionId), null);
    assert.equal(await store.set(sessionId, { provider: 'openai', model: 'gpt-5.3-codex' }), false);
    assert.deepEqual(await fs.readFile(filePath), original);
  }
});

test('SessionRuntimeStore clears an explicitly undefined identity field', async () => {
  await store.set('s_runtime-clear', {
    provider: 'openai',
    model: 'gpt-5.3-codex',
    thinking: true,
  });
  await store.set('s_runtime-clear', { model: undefined, thinking: undefined });
  assert.deepEqual(await store.read('s_runtime-clear'), { provider: 'openai' });
});

test('SessionRuntimeStore sanitizes writes to known runtime fields only', async () => {
  await store.set('s_runtime-2', {
    permissionMode: 'plan',
    sources: { permissionMode: 'explicit' },
  } as never);

  const filePath = path.join(tmpDir, 'runtime', 's_runtime-2.json');
  const raw = JSON.parse(await fs.readFile(filePath, 'utf-8')) as Record<string, unknown>;
  assert.equal(raw.permissionMode, 'plan');
  assert.equal(raw.sources, undefined);
  assert.deepEqual(await store.read('s_runtime-2'), { permissionMode: 'plan' });
});

test('SessionRuntimeStore ignores unsafe session ids', async () => {
  await store.set('../escape', { permissionMode: 'auto' });
  assert.equal(await store.read('../escape'), null);
});

test('SessionRuntimeStore serializes concurrent partial runtime writes', async () => {
  await Promise.all([
    store.set('s_runtime-concurrent', { permissionMode: 'auto' }),
    store.set('s_runtime-concurrent', { thinking: true }),
    store.set('s_runtime-concurrent', { reasoningMode: 'max' }),
    store.set('s_runtime-concurrent', { agentMode: 'sa' }),
  ]);

  assert.deepEqual(await store.read('s_runtime-concurrent'), {
    permissionMode: 'auto',
    thinking: true,
    reasoningMode: 'max',
    agentMode: 'sa',
  });
});

test('SessionRuntimeStore rejects colon session ids to avoid Windows ADS paths', async () => {
  await store.set('s:ads', { permissionMode: 'auto' });

  assert.equal(await store.read('s:ads'), null);
});

test('historical runtime identity labels only configured provider/model pairs as exact', () => {
  assert.deepEqual(
    resolveHistoricalRuntimeIdentity({
      persisted: { provider: 'openai', model: 'gpt-5.3-codex' },
      fallbackProvider: 'zhipu-coding',
      fallbackModel: 'glm-5.2',
    }),
    {
      provider: 'openai',
      model: 'gpt-5.3-codex',
      runtimeMetadataSource: 'persisted',
    },
  );

  assert.deepEqual(
    resolveHistoricalRuntimeIdentity({
      persisted: { provider: 'removed-provider', model: 'removed-model' },
      fallbackProvider: 'zhipu-coding',
      fallbackModel: 'glm-5.2',
    }),
    {
      provider: 'zhipu-coding',
      model: 'glm-5.2',
      runtimeMetadataSource: 'current-default-fallback',
    },
  );

  assert.deepEqual(
    resolveHistoricalRuntimeIdentity({
      persisted: { provider: 'openai', model: 'glm-5.2' },
      fallbackProvider: 'zhipu-coding',
      fallbackModel: 'glm-5.2',
    }),
    {
      provider: 'openai',
      runtimeMetadataSource: 'current-default-fallback',
    },
  );
});

test('busy session deletion preserves all local sidecars', async () => {
  const cleanupCalls: string[] = [];
  const result = await deleteSessionForIpc('s_busy', {
    deleteSession: async () => false,
    clearGoal: () => cleanupCalls.push('goal'),
    deleteRuntime: async () => {
      cleanupCalls.push('runtime');
    },
    deleteLocalNotices: async () => {
      cleanupCalls.push('notices');
    },
  });

  assert.deepEqual(result, { deleted: false, reason: 'session_running' });
  assert.deepEqual(cleanupCalls, []);
});

test('successful session deletion clears every local sidecar', async () => {
  const cleanupCalls: string[] = [];
  const result = await deleteSessionForIpc('s_deleted', {
    deleteSession: async () => true,
    clearGoal: () => cleanupCalls.push('goal'),
    deleteRuntime: async () => {
      cleanupCalls.push('runtime');
    },
    deleteLocalNotices: async () => {
      cleanupCalls.push('notices');
    },
  });

  assert.deepEqual(result, { deleted: true });
  assert.deepEqual(cleanupCalls, ['goal', 'runtime', 'notices']);
});
