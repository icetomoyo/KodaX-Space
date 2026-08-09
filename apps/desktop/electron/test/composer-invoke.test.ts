import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import type { ChannelOutput, IpcResult } from '@kodax-space/space-ipc-schema';
import {
  composerRunControls,
  applyTrackedStateAction,
  composerResultOwnsCurrentSession,
  invokeComposerIpc,
  isComposerTimeoutResult,
  pendingSendAcknowledgement,
  queueModeForRuntimePhase,
  retainComposerSendOperation,
  resolveComposerStopTarget,
  routeComposerFailure,
} from '../../renderer/src/shell/composerInvoke.js';

const originalWindow = globalThis.window;

afterEach(() => {
  if (originalWindow === undefined) Reflect.deleteProperty(globalThis, 'window');
  else Object.defineProperty(globalThis, 'window', { configurable: true, value: originalWindow });
});

test('composer send reuses an operation only for the exact ambiguous request', () => {
  let sequence = 0;
  const createOperationId = (): string => `operation-${++sequence}`;
  const first = retainComposerSendOperation(new Map(), '{"prompt":"one"}', createOperationId);
  const edited = retainComposerSendOperation(
    first.retainedOperations,
    '{"prompt":"two"}',
    createOperationId,
  );
  let retainedOperations = edited.retainedOperations;
  for (let index = 0; index < 40; index += 1) {
    retainedOperations = retainComposerSendOperation(
      retainedOperations,
      JSON.stringify({ prompt: `intervening-${index}` }),
      createOperationId,
    ).retainedOperations;
  }
  const retry = retainComposerSendOperation(
    retainedOperations,
    '{"prompt":"one"}',
    createOperationId,
  );

  assert.equal(retry.operationId, first.operationId);
  assert.notEqual(edited.operationId, first.operationId);
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
  assert.deepEqual(pendingSendAcknowledgement({ accepted: true, queued: false, runId: 'run_1' }), {
    kind: 'run',
    runId: 'run_1',
  });
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

test('composer queues input after an automatically fenced unknown Run', () => {
  assert.equal(queueModeForRuntimePhase('interrupt', 'unknown'), 'after-turn');
  assert.equal(queueModeForRuntimePhase('interrupt', 'recovering'), 'interrupt');
  assert.equal(queueModeForRuntimePhase('after-turn', 'unknown'), 'after-turn');
});

test('unknown Runtime state keeps both exact Stop and after-turn Send available', () => {
  assert.deepEqual(composerRunControls(true, false, 'unknown'), {
    showStop: true,
    showSend: true,
    canSendDuringActivity: true,
  });
  assert.deepEqual(composerRunControls(true, false, 'running'), {
    showStop: true,
    showSend: false,
    canSendDuringActivity: false,
  });
});

test('composer Stop keeps the pointer-down Run identity across a successor render', () => {
  assert.deepEqual(
    resolveComposerStopTarget(
      'run_visible_old',
      'run_successor',
      true,
      'runtime:run_visible_old',
      'runtime:run_successor',
    ),
    {
      allowed: true,
      runId: 'run_visible_old',
    },
  );
  assert.deepEqual(resolveComposerStopTarget(null, 'run_successor', true), {
    allowed: false,
  });
});

test('composer Stop refuses Runtime fallback without an exact Run identity', () => {
  assert.deepEqual(resolveComposerStopTarget(undefined, undefined, true), { allowed: false });
  assert.deepEqual(resolveComposerStopTarget(undefined, undefined, false), { allowed: true });
});

test('composer Stop rejects a legacy pointer gesture after its activity generation changes', () => {
  assert.deepEqual(
    resolveComposerStopTarget(null, undefined, false, 'turn:turn_old', 'turn:turn_successor'),
    { allowed: false },
  );
  assert.deepEqual(
    resolveComposerStopTarget(null, undefined, false, 'turn:turn_old', 'turn:turn_old'),
    { allowed: true },
  );
});

test('composer Stop rejects a legacy pointer gesture after the visible Session changes', () => {
  assert.deepEqual(
    resolveComposerStopTarget(
      null,
      undefined,
      false,
      'turn:shared',
      'turn:shared',
      'session_a',
      'session_b',
    ),
    { allowed: false },
  );
});
