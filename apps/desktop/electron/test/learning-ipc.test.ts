import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import type { LearnedCapabilityRecord, LearningEvent } from '@kodax-ai/kodax/agent';
import {
  LearningCursorStore,
  LearningEventBridge,
  LearningEventCursor,
  LearningSafetyService,
  projectLearnedCapability,
} from '../ipc/learning.js';

function record(
  patch: Partial<Extract<LearnedCapabilityRecord, { schemaVersion: 2 }>> = {},
): Extract<LearnedCapabilityRecord, { schemaVersion: 2 }> {
  return {
    schemaVersion: 2,
    capabilityId: 'cap_skill_1',
    displayName: 'Release note verifier',
    slug: 'release-note-verifier',
    carrier: 'skill',
    lifecycle: 'testing',
    revision: 7,
    createdAt: '2026-07-29T00:00:00.000Z',
    updatedAt: '2026-07-30T00:00:00.000Z',
    source: { kind: 'skill_learning_loop' },
    lastAction: 'review',
    artifactPath: 'C:\\Users\\secret\\.kodax\\learned\\SKILL.md',
    previousGoodRevision: 5,
    scope: {
      configHomeHash: 'sha256:config',
      tenantHash: 'sha256:tenant',
      projectHash: 'sha256:project',
    },
    artifact: {
      kind: 'skill_markdown',
      relativePath: 'skills/release-note-verifier/SKILL.md',
      fingerprint: 'sha256:current',
      contentRevision: 7,
    },
    previousGoodArtifact: {
      kind: 'skill_markdown',
      relativePath: 'skills/release-note-verifier/SKILL.md',
      fingerprint: 'sha256:previous',
      contentRevision: 5,
    },
    provenance: {
      jobId: 'job_1',
      inputHash: 'sha256:input',
      decisionId: 'decision_1',
      actionId: 'action_1',
    },
    canary: {
      maxInvocations: 3,
      invocationCount: 1,
      verifiedSuccesses: 1,
      credibleNegatives: 0,
      invocations: [],
    },
    ...patch,
  };
}

test('projection exposes exact safety facts but never the Runtime absolute artifact path', () => {
  const projected = projectLearnedCapability(record());
  assert.equal(projected.schemaVersion, 2);
  assert.equal(projected.revision, 7);
  assert.deepEqual(projected.availableActions, ['trust', 'disable', 'rollback']);
  assert.equal('artifactPath' in projected, false);
  assert.equal(projected.artifact.fingerprint, 'sha256:current');
  const rollbackMode = projectLearnedCapability(record(), { mutationsEnabled: false });
  assert.deepEqual(rollbackMode.availableActions, []);
  assert.match(rollbackMode.readOnlyReason ?? '', /rollout policy/i);

  const foreign = projectLearnedCapability({
    ...record(),
    schemaVersion: 1,
    carrier: 'extension',
  } as LearnedCapabilityRecord);
  assert.deepEqual(foreign.availableActions, []);
  assert.match(foreign.readOnlyReason ?? '', /learned Skill/i);
});

test('mutation re-reads exact identity and rejects stale revision or fingerprint before control', async () => {
  let current = record();
  const controls: Array<{ action: string; capabilityId: string }> = [];
  const service = new LearningSafetyService({
    context: async () => ({ runtimeId: 'runtime_1' }),
    list: async () => ({ items: [current], revision: current.revision }),
    get: async () => current,
    snapshot: async () => ({ ready: 0, newlyActive: 0, attention: 0, active: 0, revision: 8 }),
    events: async () => [],
    subscribe: () => ({
      [Symbol.asyncIterator]() {
        return {
          next: async () => ({ done: true as const, value: undefined }),
        };
      },
    }),
    acknowledge: async () => {},
    control: async (action, capabilityId) => {
      controls.push({ action, capabilityId });
      current = {
        ...current,
        revision: current.revision + 1,
        lifecycle: action === 'trust' ? 'active_learned' : current.lifecycle,
        lastAction: action,
      };
    },
  });

  await assert.rejects(
    service.action({
      action: 'trust',
      capabilityId: current.capabilityId,
      expectedRevision: 6,
      expectedFingerprint: current.artifact.fingerprint,
    }),
    /changed before.*trust/i,
  );
  await assert.rejects(
    service.action({
      action: 'trust',
      capabilityId: current.capabilityId,
      expectedRevision: 7,
      expectedFingerprint: 'sha256:stale',
    }),
    /fingerprint changed/i,
  );
  assert.deepEqual(controls, []);

  const result = await service.action({
    action: 'trust',
    capabilityId: current.capabilityId,
    expectedRevision: 7,
    expectedFingerprint: current.artifact.fingerprint,
  });
  assert.deepEqual(controls, [{ action: 'trust', capabilityId: 'cap_skill_1' }]);
  assert.equal(result.record.lifecycle, 'active_learned');
  assert.equal(result.record.revision, 8);
});

test('all five Space actions accept the exact Runtime lifecycle transition without lastAction', async () => {
  const cases = [
    { action: 'review', from: 'ready', to: 'testing' },
    { action: 'trust', from: 'testing', to: 'active_learned' },
    { action: 'reject', from: 'ready', to: 'rejected' },
    { action: 'disable', from: 'active_learned', to: 'archived' },
    { action: 'rollback', from: 'archived', to: 'active_learned' },
  ] as const;

  for (const entry of cases) {
    let current = record({
      lifecycle: entry.from,
      revision: 20,
      lastAction: undefined,
    });
    const service = new LearningSafetyService({
      context: async () => ({ runtimeId: 'runtime_1' }),
      list: async () => ({ items: [current], revision: current.revision }),
      get: async () => current,
      snapshot: async () => ({
        ready: 0,
        newlyActive: 0,
        attention: 0,
        active: 0,
        revision: 21,
      }),
      events: async () => [],
      subscribe: () => ({
        [Symbol.asyncIterator]() {
          return {
            next: async () => ({ done: true as const, value: undefined }),
          };
        },
      }),
      acknowledge: async () => {},
      control: async () => {
        current = {
          ...current,
          lifecycle: entry.to,
          revision: current.revision + 1,
          lastAction: undefined,
        };
      },
    });

    const result = await service.action({
      action: entry.action,
      capabilityId: current.capabilityId,
      expectedRevision: current.revision,
      expectedFingerprint: current.artifact.fingerprint,
    });
    assert.equal(result.record.lifecycle, entry.to);
    assert.equal(result.record.revision, 21);
  }
});

test('shared safety service blocks trust before review and non-learning-loop records', async () => {
  let current = record({ lifecycle: 'ready' });
  const controls: string[] = [];
  const service = new LearningSafetyService({
    context: async () => ({ runtimeId: 'runtime_1' }),
    list: async () => ({ items: [current], revision: current.revision }),
    get: async () => current,
    snapshot: async () => ({
      ready: 1,
      newlyActive: 0,
      attention: 1,
      active: 0,
      revision: current.revision,
    }),
    events: async () => [],
    subscribe: () => ({
      [Symbol.asyncIterator]() {
        return {
          next: async () => ({ done: true as const, value: undefined }),
        };
      },
    }),
    acknowledge: async () => {},
    control: async (action) => {
      controls.push(action);
    },
  });
  await assert.rejects(
    service.action({
      action: 'trust',
      capabilityId: current.capabilityId,
      expectedRevision: current.revision,
      expectedFingerprint: current.artifact.fingerprint,
    }),
    /trust is not available/i,
  );

  current = record({
    lifecycle: 'testing',
    source: { kind: 'f224_proposal', proposalId: 'proposal_1' },
  });
  await assert.rejects(
    service.action({
      action: 'trust',
      capabilityId: current.capabilityId,
      expectedRevision: current.revision,
      expectedFingerprint: current.artifact.fingerprint,
    }),
    /trust is not available/i,
  );
  assert.deepEqual(controls, []);
});

test('durable cursor is scoped to Runtime identity and rejects aliases or oversized files', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'learning-cursor-'));
  const file = path.join(dir, 'cursor.json');
  try {
    const store = new LearningCursorStore(file);
    assert.equal(await store.read(), null);
    await store.write({ runtimeId: 'runtime_1', revision: 9 });
    assert.deepEqual(await store.read(), { runtimeId: 'runtime_1', revision: 9 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('event cursor deduplicates replay and detects a sequence gap without advancing', () => {
  const cursor = new LearningEventCursor('runtime_1', 7);
  const event = (sequence: number): LearningEvent => ({
    schemaVersion: 1,
    sequence,
    eventId: `event_${sequence}`,
    capabilityId: 'cap_skill_1',
    capabilityRevision: sequence,
    kind: 'testing',
    lifecycle: 'testing',
    displayName: 'Release note verifier',
    slug: 'release-note-verifier',
    carrier: 'skill',
    createdAt: '2026-07-30T00:00:00.000Z',
  });

  assert.deepEqual(cursor.accept('runtime_1', event(7)), { kind: 'duplicate' });
  assert.deepEqual(cursor.accept('runtime_1', event(8)), { kind: 'accepted', revision: 8 });
  assert.deepEqual(cursor.accept('runtime_1', event(10)), {
    kind: 'gap',
    expected: 9,
    actual: 10,
  });
  assert.equal(cursor.revision, 8);
  assert.deepEqual(cursor.accept('runtime_2', event(1)), {
    kind: 'runtime_changed',
    runtimeId: 'runtime_2',
  });
});

test('event bridge replays every contiguous revision once and persists before live subscribe', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'learning-bridge-'));
  const store = new LearningCursorStore(path.join(dir, 'cursor.json'));
  const pushes: unknown[] = [];
  const replay = [3, 4].map(
    (sequence): LearningEvent => ({
      schemaVersion: 1,
      sequence,
      eventId: `event_${sequence}`,
      capabilityId: 'cap_skill_1',
      capabilityRevision: sequence,
      kind: sequence === 3 ? 'testing' : 'activated',
      lifecycle: sequence === 3 ? 'testing' : 'active_learned',
      displayName: 'Release note verifier',
      slug: 'release-note-verifier',
      carrier: 'skill',
      createdAt: '2026-07-30T00:00:00.000Z',
    }),
  );
  try {
    await store.write({ runtimeId: 'runtime_1', revision: 2 });
    const bridge = new LearningEventBridge(
      {
        context: async () => ({ runtimeId: 'runtime_1' }),
        list: async () => ({ items: [], revision: 4 }),
        get: async () => record(),
        snapshot: async () => ({
          ready: 0,
          newlyActive: 1,
          attention: 0,
          active: 1,
          revision: 4,
        }),
        events: async (afterRevision) =>
          replay.filter((event) => event.sequence > (afterRevision ?? 0)),
        subscribe: () => ({
          [Symbol.asyncIterator]() {
            return {
              next: () => new Promise<IteratorResult<LearningEvent>>(() => {}),
              return: async () => ({ done: true as const, value: undefined }),
            };
          },
        }),
        acknowledge: async () => {},
        control: async () => {},
      },
      store,
      (payload) => pushes.push(payload),
    );
    await bridge.ensureStarted();
    assert.deepEqual(await store.read(), { runtimeId: 'runtime_1', revision: 4 });
    assert.deepEqual(
      pushes.map((payload) => (payload as { kind: string }).kind),
      ['event', 'event', 'status'],
    );
    assert.deepEqual(
      pushes
        .filter((payload) => (payload as { kind: string }).kind === 'event')
        .map((payload) => (payload as { event: { sequence: number } }).event.sequence),
      [3, 4],
    );
    await bridge.stop();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('event bridge replaces a missing replay range with an authoritative snapshot', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'learning-gap-'));
  const store = new LearningCursorStore(path.join(dir, 'cursor.json'));
  const pushes: unknown[] = [];
  try {
    await store.write({ runtimeId: 'runtime_1', revision: 2 });
    const bridge = new LearningEventBridge(
      {
        context: async () => ({ runtimeId: 'runtime_1' }),
        list: async () => ({ items: [], revision: 4 }),
        get: async () => record(),
        snapshot: async () => ({
          ready: 1,
          newlyActive: 0,
          attention: 1,
          active: 0,
          revision: 4,
        }),
        events: async () => [
          {
            schemaVersion: 1,
            sequence: 4,
            eventId: 'event_4',
            capabilityId: 'cap_skill_1',
            capabilityRevision: 4,
            kind: 'ready',
            lifecycle: 'ready',
            displayName: 'Release note verifier',
            slug: 'release-note-verifier',
            carrier: 'skill',
            createdAt: '2026-07-30T00:00:00.000Z',
          },
        ],
        subscribe: () => ({
          [Symbol.asyncIterator]() {
            return {
              next: () => new Promise<IteratorResult<LearningEvent>>(() => {}),
              return: async () => ({ done: true as const, value: undefined }),
            };
          },
        }),
        acknowledge: async () => {},
        control: async () => {},
      },
      store,
      (payload) => pushes.push(payload),
    );
    await bridge.ensureStarted();
    assert.equal(
      pushes.some(
        (payload) =>
          (payload as { kind: string; reason?: string }).kind === 'snapshot' &&
          (payload as { reason?: string }).reason === 'cursor_gap',
      ),
      true,
    );
    assert.deepEqual(await store.read(), { runtimeId: 'runtime_1', revision: 4 });
    await bridge.stop();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('event bridge reports an initial failure and retries without another renderer request', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'learning-retry-'));
  const store = new LearningCursorStore(path.join(dir, 'cursor.json'));
  const pushes: unknown[] = [];
  let contextAttempts = 0;
  try {
    const bridge = new LearningEventBridge(
      {
        context: async () => {
          contextAttempts += 1;
          if (contextAttempts === 1) throw new Error('temporary Runtime disconnect');
          return { runtimeId: 'runtime_1' };
        },
        list: async () => ({ items: [], revision: 0 }),
        get: async () => record(),
        snapshot: async () => ({
          ready: 0,
          newlyActive: 0,
          attention: 0,
          active: 0,
          revision: 0,
        }),
        events: async () => [],
        subscribe: () => ({
          [Symbol.asyncIterator]() {
            return {
              next: () => new Promise<IteratorResult<LearningEvent>>(() => {}),
              return: async () => ({ done: true as const, value: undefined }),
            };
          },
        }),
        acknowledge: async () => {},
        control: async () => {},
      },
      store,
      (payload) => pushes.push(payload),
    );
    await bridge.ensureStarted();
    let persisted = await store.read();
    for (let attempt = 0; attempt < 20 && persisted === null; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5));
      persisted = await store.read();
    }
    assert.ok(contextAttempts >= 2);
    assert.equal(
      pushes.some(
        (payload) =>
          (payload as { kind: string; state?: string }).kind === 'status' &&
          (payload as { state?: string }).state === 'reconnecting',
      ),
      true,
    );
    assert.deepEqual(persisted, { runtimeId: 'runtime_1', revision: 0 });
    await bridge.stop();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
