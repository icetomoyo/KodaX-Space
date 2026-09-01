// Session setters tests — FEATURE_008
//
// 验证：
//   - host.setReasoningMode / setProvider 修改字段而不重启 session
//   - session 完整运行后字段仍是新值
//   - Mock emit work_budget + harness_profile（顺序 + 内容）

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import type { SessionEvent } from '@kodax-space/space-ipc-schema';
import { kodaxHost } from '../kodax/host.js';
import { setRendererTarget } from '../ipc/push.js';
import { permissionBroker } from '../permission/broker.js';
import {
  SessionRuntimeStore,
  setSessionRuntimeStoreForTesting,
} from '../kodax/session-runtime-store.js';

const captured: Array<{ channel: string; payload: unknown }> = [];

beforeEach(async () => {
  captured.length = 0;
  await kodaxHost.disposeAll();
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
});

afterEach(async () => {
  setSessionRuntimeStoreForTesting(null);
  await kodaxHost.disposeAll();
  setRendererTarget(() => null);
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

test('setReasoningMode updates field; returns true', () => {
  const { sessionId } = kodaxHost.createSession({ projectRoot: '/r', provider: 'mock' });
  assert.equal(kodaxHost.get(sessionId)?.reasoningMode, 'auto');
  assert.equal(kodaxHost.setReasoningMode(sessionId, 'deep'), true);
  assert.equal(kodaxHost.get(sessionId)?.reasoningMode, 'deep');
});

test('setReasoningMode returns false for unknown session', () => {
  assert.equal(kodaxHost.setReasoningMode('no-such-session', 'deep'), false);
});

test('setProvider updates field; returns true', () => {
  const { sessionId } = kodaxHost.createSession({ projectRoot: '/r', provider: 'mock' });
  assert.equal(kodaxHost.get(sessionId)?.provider, 'mock');
  assert.equal(kodaxHost.setProvider(sessionId, 'anthropic'), true);
  assert.equal(kodaxHost.get(sessionId)?.provider, 'anthropic');
});

test('setProvider replaces a stale override with the new provider default model', () => {
  const { sessionId } = kodaxHost.createSession({
    projectRoot: '/r',
    provider: 'openai',
    model: 'gpt-5.3-codex',
  });
  assert.equal(kodaxHost.setProvider(sessionId, 'anthropic'), true);
  assert.equal(kodaxHost.get(sessionId)?.model, 'claude-sonnet-4-6');
});

test('setProvider preserves a model override when the provider is unchanged', () => {
  const { sessionId } = kodaxHost.createSession({
    projectRoot: '/r',
    provider: 'openai',
    model: 'gpt-5.3-codex',
  });
  assert.equal(kodaxHost.setProvider(sessionId, 'openai'), true);
  assert.equal(kodaxHost.get(sessionId)?.model, 'gpt-5.3-codex');
});

test('setModel materializes the provider default when an override is cleared', () => {
  const { sessionId } = kodaxHost.createSession({
    projectRoot: '/r',
    provider: 'anthropic',
    model: 'claude-opus-4-7',
  });
  assert.equal(kodaxHost.setModel(sessionId, undefined), true);
  assert.equal(kodaxHost.get(sessionId)?.model, 'claude-sonnet-4-6');
});

test('setProvider returns false for unknown session', () => {
  assert.equal(kodaxHost.setProvider('no-such', 'openai'), false);
});

test('runtime mutations serialize and a failed write rolls back only its own change', async () => {
  let releaseFirstWrite: (() => void) | undefined;
  let signalFirstWrite: (() => void) | undefined;
  const firstWriteEntered = new Promise<void>((resolve) => {
    signalFirstWrite = resolve;
  });
  const firstWriteGate = new Promise<void>((resolve) => {
    releaseFirstWrite = resolve;
  });
  let writes = 0;

  class ControlledRuntimeStore extends SessionRuntimeStore {
    override async set(): Promise<boolean> {
      writes += 1;
      if (writes === 1) {
        signalFirstWrite?.();
        await firstWriteGate;
        return false;
      }
      return true;
    }
  }

  setSessionRuntimeStoreForTesting(new ControlledRuntimeStore('/unused'));
  const { sessionId } = kodaxHost.createSession({ projectRoot: '/r', provider: 'mock' });
  const first = kodaxHost.commitRuntimeMutation(sessionId, () =>
    kodaxHost.setPermissionMode(sessionId, 'plan'),
  );
  await firstWriteEntered;
  const second = kodaxHost.commitRuntimeMutation(sessionId, () =>
    kodaxHost.setReasoningMode(sessionId, 'deep'),
  );

  releaseFirstWrite?.();

  assert.equal(await first, 'persist-failed');
  assert.equal(await second, 'ok');
  assert.equal(kodaxHost.get(sessionId)?.permissionMode, 'accept-edits');
  assert.equal(kodaxHost.get(sessionId)?.reasoningMode, 'deep');
  assert.equal(writes, 2);
});

test('Mock emits work_budget at least 3 times during a session run', async () => {
  const { sessionId } = kodaxHost.createSession({ projectRoot: '/r', provider: 'mock' });
  const session = kodaxHost.get(sessionId);
  assert.ok(session);
  await session.send('hello');
  await waitFor(() => getEvents().some((e) => e.kind === 'session_complete'));

  const budgets = getEvents().filter((e) => e.kind === 'work_budget');
  assert.ok(budgets.length >= 3, `expected ≥3 budget events, got ${budgets.length}`);
});

test('Mock work_budget values are non-decreasing within a session', async () => {
  const { sessionId } = kodaxHost.createSession({ projectRoot: '/r', provider: 'mock' });
  const session = kodaxHost.get(sessionId);
  assert.ok(session);
  await session.send('hello');
  await waitFor(() => getEvents().some((e) => e.kind === 'session_complete'));

  const budgets = getEvents().filter((e) => e.kind === 'work_budget');
  let prev = -1;
  for (const b of budgets) {
    if (b.kind !== 'work_budget') continue;
    assert.ok(b.used >= prev, `budget went down: ${prev} → ${b.used}`);
    prev = b.used;
  }
});

test('Mock emits harness_profile = H0_DIRECT by default', async () => {
  const { sessionId } = kodaxHost.createSession({ projectRoot: '/r', provider: 'mock' });
  const session = kodaxHost.get(sessionId);
  assert.ok(session);
  await session.send('do something simple');
  await waitFor(() => getEvents().some((e) => e.kind === 'session_complete'));

  const harness = getEvents().find((e) => e.kind === 'harness_profile');
  assert.ok(harness);
  if (harness.kind === 'harness_profile') {
    assert.equal(harness.profile, 'H0_DIRECT');
    assert.equal(harness.round, undefined);
  }
});

test('Mock upgrades to H2 when prompt contains "plan"', async () => {
  const { sessionId } = kodaxHost.createSession({ projectRoot: '/r', provider: 'mock' });
  const session = kodaxHost.get(sessionId);
  assert.ok(session);
  await session.send('plan a refactor of the auth module');
  await waitFor(() => getEvents().some((e) => e.kind === 'session_complete'));

  const harness = getEvents().find((e) => e.kind === 'harness_profile');
  assert.ok(harness);
  if (harness.kind === 'harness_profile') {
    assert.equal(harness.profile, 'H2_PLAN_EXECUTE_EVAL');
    assert.equal(harness.round, 1);
  }
});

test('Mock upgrades to H1 when prompt contains "review"', async () => {
  const { sessionId } = kodaxHost.createSession({ projectRoot: '/r', provider: 'mock' });
  const session = kodaxHost.get(sessionId);
  assert.ok(session);
  await session.send('review this PR for security issues');
  await waitFor(() => getEvents().some((e) => e.kind === 'session_complete'));

  const harness = getEvents().find((e) => e.kind === 'harness_profile');
  assert.ok(harness);
  if (harness.kind === 'harness_profile') {
    assert.equal(harness.profile, 'H1_EXECUTE_EVAL');
  }
});

test('setReasoningMode persists across subsequent send (does not get reset by run)', async () => {
  const { sessionId } = kodaxHost.createSession({ projectRoot: '/r', provider: 'mock' });
  kodaxHost.setReasoningMode(sessionId, 'deep');
  const session = kodaxHost.get(sessionId);
  assert.ok(session);
  await session.send('hello');
  await waitFor(() => getEvents().some((e) => e.kind === 'session_complete'));
  // 跑完一轮后 reasoningMode 仍是 'deep'
  assert.equal(kodaxHost.get(sessionId)?.reasoningMode, 'deep');
});
