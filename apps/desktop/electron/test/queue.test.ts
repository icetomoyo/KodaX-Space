import { beforeEach, afterEach, test } from 'node:test';
import assert from 'node:assert/strict';

import { getMessageQueue, _resetMessageQueueForTests } from '@kodax-ai/kodax/agent';
import { setRendererTarget } from '../ipc/push.js';
import type { WebContents } from 'electron';
import {
  _resetQueueStateForTests,
  dequeueNextUserPromptForSession,
  drainQueueForSession,
  enqueueUserPrompt,
  startQueueWatch,
} from '../ipc/queue.js';
import { runWithSessionQueueScope } from '../kodax/session-queue-guard.js';

beforeEach(() => {
  setRendererTarget(() => null);
  _resetMessageQueueForTests();
  _resetQueueStateForTests();
});

afterEach(() => {
  _resetMessageQueueForTests();
  _resetQueueStateForTests();
});

function assertDequeued(
  sessionId: string,
  content: string,
  queueMode: 'interrupt' | 'after-turn' = 'interrupt',
): void {
  assert.deepEqual(dequeueNextUserPromptForSession(sessionId), { content, queueMode });
}

test('enqueueUserPrompt enters SDK main-thread queue but drains only its owner session', async () => {
  const queueId = await enqueueUserPrompt('s1', 'hello');
  const q = getMessageQueue();

  assert.match(queueId, /^msg-/);
  assert.equal(q.getSnapshot().length, 1);
  assert.equal(q.peek({ maxPriority: 'user', mode: 'prompt' }).length, 1);
  assert.equal(dequeueNextUserPromptForSession('s2'), undefined);
  assertDequeued('s1', 'hello');
  assert.equal(dequeueNextUserPromptForSession('s1'), undefined);
  assert.equal(q.getSnapshot().length, 0);
});
test('after-turn follow-up stays out of the SDK queue until session settles', async () => {
  const queueId = await enqueueUserPrompt('s1', 'run later', 'after-turn');
  const q = getMessageQueue();

  assert.match(queueId, /^space-after-turn-/);
  assert.equal(q.getSnapshot().length, 0);
  assert.equal(q.peek({ maxPriority: 'user', mode: 'prompt' }).length, 0);
  assert.equal(dequeueNextUserPromptForSession('s2'), undefined);
  assertDequeued('s1', 'run later', 'after-turn');
  assert.equal(dequeueNextUserPromptForSession('s1'), undefined);
});

test('after-turn prompts are invisible to SDK mid-turn drains', async () => {
  await enqueueUserPrompt('s1', 'after turn only', 'after-turn');
  await enqueueUserPrompt('s1', 'interruptible', 'interrupt');

  const q = getMessageQueue();
  const drained = await runWithSessionQueueScope('s1', async () => {
    await Promise.resolve();
    return q.dequeue({ agentId: undefined, maxPriority: 'user', mode: 'prompt' });
  });

  assert.deepEqual(
    drained.map((message) => message.content),
    ['interruptible'],
  );
  assertDequeued('s1', 'after turn only', 'after-turn');
});

test('queued user prompts preserve optional Partner prompt overlay', async () => {
  await enqueueUserPrompt('s1', 'interruptible', 'interrupt', 'overlay-a');
  await enqueueUserPrompt('s1', 'after turn only', 'after-turn', 'overlay-b');

  assert.deepEqual(dequeueNextUserPromptForSession('s1'), {
    content: 'interruptible',
    queueMode: 'interrupt',
    promptOverlay: 'overlay-a',
  });
  assert.deepEqual(dequeueNextUserPromptForSession('s1'), {
    content: 'after turn only',
    queueMode: 'after-turn',
    promptOverlay: 'overlay-b',
  });
});

test('active queue watcher preserves Partner overlays and unsubscribe stops SDK events', async () => {
  const sent: Array<{ channel: string; payload: unknown }> = [];
  const fakeWebContents = {
    isDestroyed: () => false,
    send: (channel: string, payload: unknown) => {
      sent.push({ channel, payload });
    },
  } as unknown as WebContents;
  setRendererTarget(() => fakeWebContents);
  const unsubscribe = await startQueueWatch();
  let subscribed = true;

  try {
    await enqueueUserPrompt('s1', 'interrupt with watcher', 'interrupt', 'overlay-interrupt');
    await enqueueUserPrompt('s1', 'after turn with watcher', 'after-turn', 'overlay-after-turn');

    assert.deepEqual(dequeueNextUserPromptForSession('s1'), {
      content: 'interrupt with watcher',
      queueMode: 'interrupt',
      promptOverlay: 'overlay-interrupt',
    });
    assert.deepEqual(dequeueNextUserPromptForSession('s1'), {
      content: 'after turn with watcher',
      queueMode: 'after-turn',
      promptOverlay: 'overlay-after-turn',
    });
    assert.ok(
      sent.some(({ payload }) => {
        const event = payload as {
          kind?: string;
          affected?: Array<{ content?: string }>;
        };
        return (
          event.kind === 'dequeued' &&
          event.affected?.some((message) => message.content === 'interrupt with watcher')
        );
      }),
      'the active watcher should continue publishing SDK dequeue events to the renderer',
    );

    await new Promise<void>((resolve) => queueMicrotask(resolve));
    unsubscribe();
    subscribed = false;
    const eventCountAfterUnsubscribe = sent.length;

    _resetMessageQueueForTests();
    const drainedQueueId = await enqueueUserPrompt(
      's1',
      'SDK-drained after unsubscribe',
      'interrupt',
      'overlay-must-be-cleaned',
    );
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    assert.equal(sent.length, eventCountAfterUnsubscribe);
    const q = getMessageQueue();
    const sdkDrained = runWithSessionQueueScope('s1', () =>
      q.dequeue({ agentId: undefined, maxPriority: 'user', mode: 'prompt' }),
    );
    assert.deepEqual(
      sdkDrained.map((message) => message.content),
      ['SDK-drained after unsubscribe'],
    );

    // The SDK test reset intentionally reuses msg-1. If metadata from the
    // externally drained prompt leaked after watcher unsubscribe, the fresh
    // prompt would inherit its stale Partner overlay.
    _resetMessageQueueForTests();
    const freshQueueId = await enqueueUserPrompt('s1', 'fresh prompt without overlay');
    assert.equal(freshQueueId, drainedQueueId);
    assert.deepEqual(dequeueNextUserPromptForSession('s1'), {
      content: 'fresh prompt without overlay',
      queueMode: 'interrupt',
    });
    assert.equal(sent.length, eventCountAfterUnsubscribe);
  } finally {
    if (subscribed) unsubscribe();
  }
});

test('session queue scope lets SDK mid-turn drain only the current session prompt', async () => {
  await enqueueUserPrompt('s1', 'follow up from s1');
  await enqueueUserPrompt('s2', 'follow up from s2');

  const q = getMessageQueue();
  const drainedByS2 = await runWithSessionQueueScope('s2', async () => {
    await Promise.resolve();
    return q.dequeue({ agentId: undefined, maxPriority: 'user', mode: 'prompt' });
  });

  assert.deepEqual(
    drainedByS2.map((message) => message.content),
    ['follow up from s2'],
  );
  assert.equal(dequeueNextUserPromptForSession('s2'), undefined);
  assertDequeued('s1', 'follow up from s1');
});

test('drainQueueForSession clears only that session across both queues', async () => {
  await enqueueUserPrompt('s1', 'one');
  await enqueueUserPrompt('s1', 'two');
  await enqueueUserPrompt('s2', 'other', 'interrupt', 'discarded-interrupt-overlay');
  await enqueueUserPrompt('s2', 'later', 'after-turn', 'discarded-after-turn-overlay');

  assert.equal(await drainQueueForSession('s2'), 2);
  assert.equal(dequeueNextUserPromptForSession('s2'), undefined);
  assertDequeued('s1', 'one');
  assertDequeued('s1', 'two');
});

test('queue reset clears interrupt and after-turn Partner metadata', async () => {
  await enqueueUserPrompt('s1', 'stale interrupt', 'interrupt', 'stale-interrupt-overlay');
  await enqueueUserPrompt('s1', 'stale after turn', 'after-turn', 'stale-after-turn-overlay');

  _resetMessageQueueForTests();
  _resetQueueStateForTests();

  await enqueueUserPrompt('s1', 'fresh interrupt');
  await enqueueUserPrompt('s1', 'fresh after turn', 'after-turn');
  assertDequeued('s1', 'fresh interrupt');
  assertDequeued('s1', 'fresh after turn', 'after-turn');
  assert.equal(dequeueNextUserPromptForSession('s1'), undefined);
});

test('queue IPC preview clamps large prompts while preserving raw prompt', async () => {
  const sent: { current: { channel: string; payload: unknown } | null } = { current: null };
  const fakeWebContents = {
    isDestroyed: () => false,
    send: (channel: string, payload: unknown) => {
      sent.current = { channel, payload };
    },
  } as unknown as WebContents;
  setRendererTarget(() => fakeWebContents);
  const unsubscribe = await startQueueWatch();

  try {
    const longPrompt = 'x'.repeat(40_000);
    await enqueueUserPrompt('s1', longPrompt);

    assert.equal(sent.current?.channel, 'kodax.queueChanged');
    const payload = sent.current?.payload as { affected: Array<{ content: string }> };
    assert.equal(payload.affected[0]?.content.length, 32 * 1024);
    assert.ok(payload.affected[0]?.content.endsWith('\n[truncated]'));
    assert.equal(
      (payload.affected[0] as { queueMode?: string } | undefined)?.queueMode,
      'interrupt',
    );
    assertDequeued('s1', longPrompt);
  } finally {
    unsubscribe();
  }
});

test('queue depth is enforced per session across both queue modes, not globally', async () => {
  for (let i = 0; i < 5; i += 1) {
    await enqueueUserPrompt('s1', `interrupt-${i}`, 'interrupt');
    await enqueueUserPrompt('s1', `after-turn-${i}`, 'after-turn');
  }

  await assert.rejects(
    () => enqueueUserPrompt('s1', 'too much'),
    /Message queue full for session s1/,
  );
  await assert.doesNotReject(() => enqueueUserPrompt('s2', 'still allowed'));
});
