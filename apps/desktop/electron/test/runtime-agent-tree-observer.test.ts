import assert from 'node:assert/strict';
import test from 'node:test';

import type { AgentEvent, AgentTreeSnapshot } from '@kodax-ai/kodax/agent';
import {
  RuntimeAgentTreeObserver,
  type RuntimeAgentTelemetrySource,
} from '../kodax/runtime/runtime-agent-tree-observer.js';

function actorTree(revision: number, childState?: 'running' | 'idle'): AgentTreeSnapshot {
  return {
    rootPath: '/root',
    actors: [
      {
        path: '/root',
        taskName: 'root',
        kind: 'native',
        state: 'running',
        capabilities: {
          tools: [],
          filesystem: 'write',
          network: true,
          providers: [],
          canAskUser: true,
        },
        turnIds: ['turn_root'],
        currentTurnId: 'turn_root',
        mailboxCursor: 0,
        createdAt: '2026-07-27T00:00:00.000Z',
        updatedAt: '2026-07-27T00:00:02.000Z',
        revision,
      },
      ...(childState
        ? [
            {
              path: '/root/reviewer',
              taskName: 'reviewer',
              parentPath: '/root',
              kind: 'native' as const,
              state: childState,
              capabilities: {
                tools: [],
                filesystem: 'read' as const,
                network: false,
                providers: [],
                canAskUser: false,
              },
              turnIds: ['turn_review'],
              ...(childState === 'running' ? { currentTurnId: 'turn_review' } : {}),
              mailboxCursor: 0,
              createdAt: '2026-07-27T00:00:01.000Z',
              updatedAt: '2026-07-27T00:00:02.000Z',
              revision,
              latestTurn: {
                turnId: 'turn_review',
                state: childState === 'running' ? ('running' as const) : ('completed' as const),
                summary: childState === 'running' ? 'Reviewing' : 'Review complete',
                summaryTruncated: false,
                recentActivity: [],
              },
            },
          ]
        : []),
    ],
    activeNonRootTurns: childState === 'running' ? 1 : 0,
    maxConcurrentThreads: 4,
    revision,
  };
}

function event(sequence: number, kind: AgentEvent['kind'] = 'turn_progress'): AgentEvent {
  return {
    sequence,
    kind,
    actorPath: '/root/reviewer',
    turnId: 'turn_review',
    createdAt: '2026-07-27T00:00:02.000Z',
  };
}

test('Actor tree observer long-polls one cursor and coalesces a burst into one snapshot', async () => {
  let tree = actorTree(1);
  const events: AgentEvent[] = [];
  let wake: ((value: AgentEvent | undefined) => void) | undefined;
  const source: RuntimeAgentTelemetrySource = {
    tree: async () => tree,
    events: async (_sessionId, afterSequence = 0) =>
      events.filter((item) => item.sequence > afterSequence),
    wait: async (_sessionId, afterSequence = 0) => {
      const available = events.find((item) => item.sequence > afterSequence);
      if (available) return available;
      return new Promise<AgentEvent | undefined>((resolve) => {
        wake = resolve;
      });
    },
  };
  const snapshots: Array<ReturnType<RuntimeAgentTreeObserver['current']>> = [];
  const observer = new RuntimeAgentTreeObserver({
    runtimeId: 'rt_1',
    sessionId: 's_1',
    source,
    onSnapshot: (snapshot) => snapshots.push(snapshot),
  });

  await observer.start();
  await until(() => wake !== undefined);
  tree = actorTree(2, 'running');
  events.push(event(1, 'actor_spawned'), event(2, 'turn_started'), event(3));
  const release = wake;
  wake = undefined;
  release?.(events[0]);

  await until(() => observer.current()?.eventCursor === 3);
  observer.stop();
  (wake as ((value: AgentEvent | undefined) => void) | undefined)?.(undefined);

  assert.equal(snapshots.length, 2);
  assert.equal(snapshots[1]?.revision, 2);
  assert.equal(snapshots[1]?.eventCursor, 3);
  assert.equal(snapshots[1]?.actors[1]?.currentTurnId, 'turn_review');
});

test('Actor tree observer reconciles terminal state after a long-poll timeout', async () => {
  let tree = actorTree(1, 'running');
  let wake: ((value: AgentEvent | undefined) => void) | undefined;
  const source: RuntimeAgentTelemetrySource = {
    tree: async () => tree,
    events: async () => [],
    wait: async () =>
      new Promise<AgentEvent | undefined>((resolve) => {
        wake = resolve;
      }),
  };
  const observer = new RuntimeAgentTreeObserver({
    runtimeId: 'rt_1',
    sessionId: 's_1',
    source,
    onSnapshot: () => {},
  });

  await observer.start();
  await until(() => wake !== undefined);
  tree = actorTree(2, 'idle');
  const release = wake;
  wake = undefined;
  release?.(undefined);

  await until(() => observer.current()?.revision === 2);
  observer.stop();
  (wake as ((value: AgentEvent | undefined) => void) | undefined)?.(undefined);

  assert.equal(observer.current()?.actors[1]?.latestTurn?.state, 'completed');
});

test('Actor tree observer does not advance its event cursor when tree refresh fails', async () => {
  const afterSequences: number[] = [];
  let treeCalls = 0;
  const source: RuntimeAgentTelemetrySource = {
    events: async (_sessionId, afterSequence = 0) => {
      afterSequences.push(afterSequence);
      return [event(5)];
    },
    tree: async () => {
      treeCalls += 1;
      if (treeCalls === 1) throw new Error('transient tree failure');
      return actorTree(2, 'running');
    },
    wait: async () => undefined,
  };
  const observer = new RuntimeAgentTreeObserver({
    runtimeId: 'rt_1',
    sessionId: 's_1',
    source,
    onSnapshot: () => {},
  });

  await assert.rejects(observer.refreshNow(), /transient tree failure/);
  const recovered = await observer.refreshNow();
  observer.stop();

  assert.deepEqual(afterSequences, [0, 0]);
  assert.equal(recovered?.eventCursor, 5);
});

test('Actor tree observer suppresses a late snapshot after stop', async () => {
  let releaseTree: ((tree: AgentTreeSnapshot) => void) | undefined;
  const source: RuntimeAgentTelemetrySource = {
    events: async () => [],
    tree: async () =>
      new Promise<AgentTreeSnapshot>((resolve) => {
        releaseTree = resolve;
      }),
    wait: async () => undefined,
  };
  let publishCount = 0;
  const observer = new RuntimeAgentTreeObserver({
    runtimeId: 'rt_1',
    sessionId: 's_1',
    source,
    onSnapshot: () => {
      publishCount += 1;
    },
  });

  const start = observer.start();
  await until(() => releaseTree !== undefined);
  observer.stop();
  releaseTree?.(actorTree(1));
  await start;

  assert.equal(observer.current(), undefined);
  assert.equal(publishCount, 0);
});

test('Actor tree observer surfaces a permanent bootstrap failure', async () => {
  const source: RuntimeAgentTelemetrySource = {
    events: async () => {
      throw new Error('session not found');
    },
    tree: async () => actorTree(1),
    wait: async () => undefined,
  };
  const observer = new RuntimeAgentTreeObserver({
    runtimeId: 'rt_1',
    sessionId: 'missing',
    source,
    onSnapshot: () => {},
    shouldRetry: () => false,
  });

  await assert.rejects(observer.start(), /session not found/);
});

async function until(predicate: () => boolean, timeoutMs = 1_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('condition timed out');
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
}
