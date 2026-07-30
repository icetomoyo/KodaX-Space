import assert from 'node:assert/strict';
import test from 'node:test';

import {
  INVOKE_CHANNEL_NAMES,
  PUSH_CHANNEL_NAMES,
  learningAcknowledgeChannel,
  learningActionChannel,
  learningChangedChannel,
  learningGetChannel,
  learningListChannel,
  learnedCapabilityProjectionSchema,
} from '../src/index.js';

const learnedSkill = {
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
  previousGoodRevision: 5,
  diagnostics: [],
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
    invocations: [
      {
        invocationId: 'inv_1',
        bindingId: 'binding_1',
        artifactRevision: 7,
        artifactFingerprint: 'sha256:current',
        status: 'verified_success',
        evidenceRefs: ['evidence://run/1'],
        invokedAt: '2026-07-30T01:00:00.000Z',
        completedAt: '2026-07-30T01:01:00.000Z',
      },
    ],
  },
  availableActions: ['trust', 'disable', 'rollback'],
} as const;

test('learning channels are registered in the schema-derived allowlists', () => {
  for (const name of [
    'learning.list',
    'learning.get',
    'learning.action',
    'learning.acknowledge',
  ] as const) {
    assert.ok(INVOKE_CHANNEL_NAMES.has(name));
  }
  assert.ok(PUSH_CHANNEL_NAMES.has('learning.changed'));
  assert.equal(learningListChannel.name, 'learning.list');
  assert.equal(learningGetChannel.name, 'learning.get');
  assert.equal(learningActionChannel.name, 'learning.action');
  assert.equal(learningAcknowledgeChannel.name, 'learning.acknowledge');
  assert.equal(learningChangedChannel.name, 'learning.changed');
});

test('learned Skill projection preserves immutable revision, evidence and canary facts', () => {
  assert.equal(learnedCapabilityProjectionSchema.safeParse(learnedSkill).success, true);
  assert.equal(
    learnedCapabilityProjectionSchema.safeParse({
      ...learnedSkill,
      canary: { ...learnedSkill.canary, maxInvocations: 4 },
    }).success,
    false,
  );
  assert.equal(
    learnedCapabilityProjectionSchema.safeParse({
      ...learnedSkill,
      artifact: { ...learnedSkill.artifact, relativePath: 'C:\\Users\\secret\\SKILL.md' },
    }).success,
    false,
  );
});

test('mutations require exact identity and optimistic revision authority', () => {
  assert.equal(
    learningActionChannel.input.safeParse({
      action: 'trust',
      capabilityId: learnedSkill.capabilityId,
      expectedRevision: learnedSkill.revision,
      expectedFingerprint: learnedSkill.artifact.fingerprint,
    }).success,
    true,
  );
  assert.equal(
    learningActionChannel.input.safeParse({
      action: 'promote',
      capabilityId: learnedSkill.capabilityId,
      expectedRevision: learnedSkill.revision,
    }).success,
    false,
  );
  assert.equal(
    learningActionChannel.input.safeParse({
      action: 'trust',
      capabilityId: 'release-note-verifier',
    }).success,
    false,
  );
});

test('legacy and unknown-carrier records are structurally read-only', () => {
  const legacy = {
    schemaVersion: 1,
    capabilityId: 'cap_extension_1',
    displayName: 'Legacy extension',
    slug: 'legacy-extension',
    carrier: 'future_runtime_carrier',
    lifecycle: 'ready',
    revision: 1,
    createdAt: '2026-07-30T00:00:00.000Z',
    updatedAt: '2026-07-30T00:00:00.000Z',
    source: { kind: 'future_runtime_source' },
    lastAction: 'future_runtime_action',
    availableActions: [],
    readOnlyReason: 'Only learned Skills can be controlled here.',
  } as const;
  assert.equal(learnedCapabilityProjectionSchema.safeParse(legacy).success, true);
  assert.equal(
    learnedCapabilityProjectionSchema.safeParse({
      ...legacy,
      availableActions: ['trust'],
    }).success,
    false,
  );
});

test('learning push contract distinguishes ordered events, recovery snapshots, and status', () => {
  assert.equal(
    learningChangedChannel.payload.safeParse({
      kind: 'event',
      runtimeId: 'runtime_1',
      event: {
        schemaVersion: 1,
        sequence: 9,
        eventId: 'event_9',
        capabilityId: learnedSkill.capabilityId,
        capabilityRevision: 8,
        kind: 'activated',
        lifecycle: 'active_learned',
        displayName: learnedSkill.displayName,
        slug: learnedSkill.slug,
        carrier: 'skill',
        createdAt: '2026-07-30T02:00:00.000Z',
      },
    }).success,
    true,
  );
  assert.equal(
    learningChangedChannel.payload.safeParse({
      kind: 'snapshot',
      runtimeId: 'runtime_1',
      reason: 'cursor_gap',
      snapshot: { ready: 1, newlyActive: 0, attention: 1, active: 0, revision: 11 },
    }).success,
    true,
  );
});
