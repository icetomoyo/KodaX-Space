import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import type { ChannelOutput, IpcResult } from '@kodax-space/space-ipc-schema';
import {
  applyTrackedStateAction,
  composerResultOwnsCurrentSession,
  invokeComposerIpc,
  isComposerTimeoutResult,
  pendingSendAcknowledgement,
  routeComposerFailure,
} from '../../renderer/src/shell/composerInvoke.js';

const originalWindow = globalThis.window;

afterEach(() => {
  if (originalWindow === undefined) Reflect.deleteProperty(globalThis, 'window');
  else Object.defineProperty(globalThis, 'window', { configurable: true, value: originalWindow });
});

function installDeferredSendBridge(
  invokeResult: Promise<IpcResult<ChannelOutput<'session.send'>>>,
): void {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      kodaxSpace: { invoke: () => invokeResult },
      setTimeout,
      clearTimeout,
    },
  });
}

test('a timed-out skill send reports its exact late accepted Run once', async () => {
  let settle!: (result: IpcResult<ChannelOutput<'session.send'>>) => void;
  const invokeResult = new Promise<IpcResult<ChannelOutput<'session.send'>>>((resolve) => {
    settle = resolve;
  });
  installDeferredSendBridge(invokeResult);
  const lateResults: IpcResult<ChannelOutput<'session.send'>>[] = [];

  const result = await invokeComposerIpc(
    'session.send',
    { sessionId: 'skill-timeout', prompt: 'resolved skill prompt', queueMode: 'interrupt' },
    { timeoutMs: 1, onLateResult: (late) => lateResults.push(late) },
  );
  assert.equal(isComposerTimeoutResult(result), true);

  settle({ ok: true, data: { accepted: true, queued: false, runId: 'run-late-skill' } });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(lateResults, [
    { ok: true, data: { accepted: true, queued: false, runId: 'run-late-skill' } },
  ]);
});

test('a timed-out skill send preserves a late factual rejection', async () => {
  let settle!: (result: IpcResult<ChannelOutput<'session.send'>>) => void;
  const invokeResult = new Promise<IpcResult<ChannelOutput<'session.send'>>>((resolve) => {
    settle = resolve;
  });
  installDeferredSendBridge(invokeResult);
  const lateResults: IpcResult<ChannelOutput<'session.send'>>[] = [];

  const result = await invokeComposerIpc(
    'session.send',
    { sessionId: 'skill-rejected', prompt: 'resolved skill prompt', queueMode: 'interrupt' },
    { timeoutMs: 1, onLateResult: (late) => lateResults.push(late) },
  );
  assert.equal(isComposerTimeoutResult(result), true);

  settle({
    ok: true,
    data: { accepted: false, reason: 'stale_run', queueMode: 'interrupt' },
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(lateResults, [
    {
      ok: true,
      data: { accepted: false, reason: 'stale_run', queueMode: 'interrupt' },
    },
  ]);
});

test('a late send result cannot claim the composer after a Session switch', () => {
  assert.equal(composerResultOwnsCurrentSession('session-a', 'session-a'), true);
  assert.equal(composerResultOwnsCurrentSession('session-a', 'session-b'), false);
  assert.equal(composerResultOwnsCurrentSession('session-a', null), false);
});

test('a composer failure mutates only the owning foreground or background Session path', () => {
  const effects: string[] = [];
  routeComposerFailure(
    'session-a',
    'session-a',
    { late: false, currentComposerOccupied: false },
    () => effects.push('restore-current'),
    () => effects.push('notice-background'),
  );
  routeComposerFailure(
    'session-a',
    'session-b',
    { late: true, currentComposerOccupied: false },
    () => effects.push('wrong-current'),
    () => effects.push('notice-session-a'),
  );
  routeComposerFailure(
    'session-a',
    'session-a',
    { late: true, currentComposerOccupied: true },
    () => effects.push('wrong-generation'),
    () => effects.push('notice-old-draft'),
  );
  assert.deepEqual(effects, ['restore-current', 'notice-session-a', 'notice-old-draft']);
});

test('tracked functional updates chain synchronously from the latest value', () => {
  let current: string[] = [];
  current = applyTrackedStateAction(current, (items) => [...items, 'image']);
  current = applyTrackedStateAction(current, (items) => [...items, 'file']);

  assert.deepEqual(current, ['image', 'file']);
});

test('accepted send results always settle their optimistic pending admission', () => {
  assert.deepEqual(
    pendingSendAcknowledgement({ accepted: true, queued: false, runId: 'run_1' }),
    { kind: 'run', runId: 'run_1' },
  );
  assert.deepEqual(pendingSendAcknowledgement({ accepted: true, queued: false }), {
    kind: 'clear',
  });
  assert.deepEqual(
    pendingSendAcknowledgement({ accepted: true, queued: true, queueId: 'queue_1' }),
    { kind: 'clear' },
  );
  assert.deepEqual(
    pendingSendAcknowledgement({ accepted: true, queued: true, queueId: 'queue_1' }),
    { kind: 'clear' },
  );
});
