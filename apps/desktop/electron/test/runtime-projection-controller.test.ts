import assert from 'node:assert/strict';
import test from 'node:test';

import type { InvokeChannelName } from '@kodax-space/space-ipc-schema';
import {
  RuntimeProjectionController,
  RuntimeProjectionUnavailableError,
  createPendingSdkRuntimeProjection,
} from '../kodax/runtime/runtime-projection-controller.js';
import { registerRuntimeProjectionChannels } from '../ipc/runtime.js';

test('pending SDK controller reports an explicit incompatible profile without fake Runtime identity', () => {
  const controller = createPendingSdkRuntimeProjection(100);
  const snapshot = controller.profileSnapshot();

  assert.equal(snapshot.connection.state, 'incompatible');
  assert.equal(snapshot.connection.stale, true);
  assert.equal(snapshot.connection.runtimeId, undefined);
  assert.match(snapshot.connection.reason ?? '', /published KodaX daemon SDK/i);
  assert.equal(snapshot.cursor, undefined);
  assert.deepEqual(snapshot.sessions, []);
});

test('controller refuses selected-session snapshots until an authoritative projection exists', () => {
  const controller = createPendingSdkRuntimeProjection(100);
  assert.throws(
    () => controller.sessionLiveSnapshot('s_missing'),
    (error: unknown) => {
      assert.ok(error instanceof RuntimeProjectionUnavailableError);
      assert.equal(error.code, 'LIVE_SNAPSHOT_UNAVAILABLE');
      assert.equal(error.sessionId, 's_missing');
      return true;
    },
  );
});

test('controller accepts authoritative profile/live replacements for the future daemon adapter', () => {
  const controller = new RuntimeProjectionController(
    createPendingSdkRuntimeProjection(100).profileSnapshot(),
  );
  controller.replaceProfile({
    connection: {
      state: 'ready',
      changedAt: 101,
      stale: false,
      runtimeId: 'rt_1',
      profile: 'default',
      capabilities: [{ id: 'runtime.live.observe', version: 1, available: true }],
    },
    projectionRevision: 1,
    cursor: { runtimeId: 'rt_1', seq: 1 },
    sessions: [],
    interactions: [],
    notifications: [],
  });
  controller.replaceSessionLive({
    sessionId: 's_1',
    projectionRevision: 1,
    cursor: { runtimeId: 'rt_1', seq: 1 },
    transcriptRevision: 'tx_1',
    queuedRuns: [],
    activeTools: [],
    todos: [],
    queuedInputs: [],
    interactions: [],
  });

  assert.equal(controller.profileSnapshot().connection.state, 'ready');
  assert.equal(controller.sessionLiveSnapshot('s_1').transcriptRevision, 'tx_1');
});

test('runtime IPC bootstrap registers both snapshot handlers against the controller', async () => {
  const controller = createPendingSdkRuntimeProjection(100);
  const handlers = new Map<string, (input: unknown) => unknown>();
  const register = ((name: InvokeChannelName, handler: (input: unknown) => unknown) => {
    handlers.set(name, handler);
  }) as never;

  registerRuntimeProjectionChannels(controller, register);

  assert.deepEqual([...handlers.keys()].sort(), [
    'runtime.profileSnapshot',
    'session.liveSnapshot',
  ]);
  const profileHandler = handlers.get('runtime.profileSnapshot');
  assert.ok(profileHandler);
  const profile = await profileHandler(undefined);
  assert.equal((profile as { connection: { state: string } }).connection.state, 'incompatible');
});

test('controller rejects rich snapshots before a ready matching Runtime profile exists', () => {
  const controller = createPendingSdkRuntimeProjection(100);
  assert.equal(
    controller.replaceSessionLive({
      sessionId: 's_1',
      projectionRevision: 1,
      cursor: { runtimeId: 'rt_untrusted', seq: 1 },
      transcriptRevision: 'tx_1',
      queuedRuns: [],
      activeTools: [],
      todos: [],
      queuedInputs: [],
      interactions: [],
    }),
    false,
  );
  assert.throws(() => controller.sessionLiveSnapshot('s_1'), RuntimeProjectionUnavailableError);
});

test('controller invalidates rich state when Runtime authority is lost', () => {
  const controller = createPendingSdkRuntimeProjection(100);
  controller.replaceProfile({
    connection: {
      state: 'ready',
      changedAt: 101,
      stale: false,
      runtimeId: 'rt_1',
      capabilities: [],
    },
    projectionRevision: 1,
    cursor: { runtimeId: 'rt_1', seq: 1 },
    sessions: [],
    interactions: [],
    notifications: [],
  });
  controller.replaceSessionLive({
    sessionId: 's_1',
    projectionRevision: 1,
    cursor: { runtimeId: 'rt_1', seq: 1 },
    transcriptRevision: 'tx_1',
    queuedRuns: [],
    activeTools: [],
    todos: [],
    queuedInputs: [],
    interactions: [],
  });

  assert.equal(
    controller.replaceProfile({
      connection: {
        state: 'disconnected',
        changedAt: 102,
        stale: true,
        reason: 'daemon exited',
        capabilities: [],
      },
      projectionRevision: 2,
      sessions: [],
      interactions: [],
      notifications: [],
    }),
    true,
  );
  assert.throws(() => controller.sessionLiveSnapshot('s_1'), RuntimeProjectionUnavailableError);
});

test('connection-only replacement updates bootstrap truth and invalidates stale live state', () => {
  const controller = createPendingSdkRuntimeProjection(100);
  controller.replaceProfile({
    connection: {
      state: 'ready',
      changedAt: 101,
      stale: false,
      runtimeId: 'rt_1',
      capabilities: [],
    },
    projectionRevision: 1,
    cursor: { runtimeId: 'rt_1', seq: 1 },
    sessions: [],
    interactions: [],
    notifications: [],
  });
  controller.replaceSessionLive({
    sessionId: 's_1',
    projectionRevision: 1,
    cursor: { runtimeId: 'rt_1', seq: 1 },
    transcriptRevision: 'tx_1',
    queuedRuns: [],
    activeTools: [],
    todos: [],
    queuedInputs: [],
    interactions: [],
  });

  assert.equal(
    controller.replaceConnection({
      state: 'reconnecting',
      changedAt: 102,
      stale: true,
      runtimeId: 'rt_1',
      reason: 'transport closed',
      capabilities: [],
    }),
    true,
  );
  assert.equal(controller.profileSnapshot().connection.state, 'reconnecting');
  assert.throws(() => controller.sessionLiveSnapshot('s_1'), RuntimeProjectionUnavailableError);
});

test('profile refresh may advance revision at the same daemon cursor', () => {
  const controller = createPendingSdkRuntimeProjection(100);
  const first = {
    connection: {
      state: 'ready' as const,
      changedAt: 101,
      stale: false,
      runtimeId: 'rt_1',
      capabilities: [],
    },
    projectionRevision: 1,
    cursor: { runtimeId: 'rt_1', seq: 1 },
    sessions: [],
    interactions: [],
    notifications: [],
  };
  assert.equal(controller.replaceProfile(first), true);
  assert.equal(
    controller.replaceProfile({
      ...first,
      connection: { ...first.connection, changedAt: 102 },
      projectionRevision: 2,
    }),
    true,
  );
});

test('controller snapshots cannot mutate its internal authoritative cache', () => {
  const controller = createPendingSdkRuntimeProjection(100);
  const first = controller.profileSnapshot();
  (first.sessions as unknown[]).push({ sessionId: 'injected' });

  assert.deepEqual(controller.profileSnapshot().sessions, []);
});
