import assert from 'node:assert/strict';
import test from 'node:test';

import type {
  LearnedCapabilityProjectionT,
  SpaceCoderConnectionProjectionT,
} from '@kodax-space/space-ipc-schema';
import {
  actionableLearningAttention,
  canShowLearningSafetySurface,
  learningActionNeedsDangerTone,
} from '../../renderer/src/features/learning/learningModel.js';

const connection = {
  state: 'ready',
  changedAt: 1,
  stale: false,
  runtimeId: 'runtime_1',
  profile: 'coder',
  capabilities: [
    { id: 'runtime.learning', version: 1, available: true },
    { id: 'runtime.learning.skillLoop', version: 1, available: true },
  ],
} satisfies SpaceCoderConnectionProjectionT;

function item(lifecycle: LearnedCapabilityProjectionT['lifecycle']): LearnedCapabilityProjectionT {
  const availableActions: LearnedCapabilityProjectionT['availableActions'] =
    lifecycle === 'ready'
      ? ['review', 'reject', 'disable']
      : lifecycle === 'testing'
        ? ['trust', 'disable']
        : lifecycle === 'quarantined'
          ? ['review', 'reject', 'disable']
          : [];
  return {
    schemaVersion: 1,
    capabilityId: `cap_${lifecycle}`,
    displayName: lifecycle,
    slug: lifecycle,
    carrier: 'skill',
    lifecycle,
    revision: 1,
    createdAt: '2026-07-30T00:00:00.000Z',
    updatedAt: '2026-07-30T00:00:00.000Z',
    source: { kind: 'legacy_manual' },
    availableActions,
    readOnlyReason: 'Legacy record',
  };
}

test('learning surface is gated on both negotiated Runtime contracts', () => {
  assert.equal(canShowLearningSafetySurface(connection), true);
  assert.equal(
    canShowLearningSafetySurface({
      ...connection,
      capabilities: connection.capabilities.filter(
        (capability) => capability.id !== 'runtime.learning.skillLoop',
      ),
    }),
    false,
  );
  assert.equal(canShowLearningSafetySurface({ ...connection, state: 'disconnected' }), false);
});

test('attention excludes opportunities and invocations but includes review-required safety states', () => {
  assert.equal(
    actionableLearningAttention([
      item('opportunity'),
      item('drafting'),
      item('ready'),
      item('testing'),
      item('quarantined'),
      item('active_learned'),
      { ...item('ready'), capabilityId: 'cap_read_only', availableActions: [] },
    ]),
    3,
  );
});

test('reject, disable and rollback use destructive confirmation tone', () => {
  assert.equal(learningActionNeedsDangerTone('review'), false);
  assert.equal(learningActionNeedsDangerTone('trust'), false);
  assert.equal(learningActionNeedsDangerTone('reject'), true);
  assert.equal(learningActionNeedsDangerTone('disable'), true);
  assert.equal(learningActionNeedsDangerTone('rollback'), true);
});
