import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  invokeChannels,
  partnerFileProposalSchema,
  partnerFileProposalsApplyChannel,
  partnerFileProposalsExportChannel,
  partnerFileProposalsGetChannel,
  partnerFileProposalsListChannel,
  partnerFileProposalsRejectChannel,
} from '../src/index.js';

test('partner file proposal channels are registered', () => {
  for (const name of [
    'partner.fileProposals.list',
    'partner.fileProposals.get',
    'partner.fileProposals.apply',
    'partner.fileProposals.reject',
    'partner.fileProposals.export',
  ]) {
    assert.ok(invokeChannels[name as keyof typeof invokeChannels], `${name} should be registered`);
  }
});

test('partner file proposal schemas accept pending reviewed file proposal', () => {
  const parsed = partnerFileProposalSchema.safeParse({
    id: 'pfp_1',
    sessionId: 's_partner',
    projectRoot: '/workspace/project',
    targetPath: 'docs/spec.md',
    operation: 'create',
    status: 'pending',
    content: '# Spec',
    contentHash: 'sha256:'.concat('a'.repeat(64)),
    baseContentHash: null,
    sourceRefs: ['src_1'],
    safety: { classification: 'safe-text', risk: 'low', warnings: [] },
    diff: {
      before: '',
      after: '# Spec',
      unified: '--- a/docs/spec.md\n+++ b/docs/spec.md',
      truncated: false,
    },
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });
  assert.equal(parsed.success, true);
});

test('partner file proposal channels reject malformed paths and hashes', () => {
  assert.equal(partnerFileProposalsListChannel.input.safeParse({}).success, false);
  assert.equal(
    partnerFileProposalsListChannel.input.safeParse({ projectRoot: '/workspace/project' }).success,
    true,
  );
  assert.equal(
    partnerFileProposalsListChannel.input.safeParse({ projectRoot: '/workspace\nsecret' }).success,
    false,
  );
  assert.equal(
    partnerFileProposalsGetChannel.input.safeParse({
      id: 'pfp_1',
      projectRoot: '/workspace/project',
    }).success,
    true,
  );
  assert.equal(partnerFileProposalsGetChannel.input.safeParse({ id: 'pfp_1' }).success, false);
  assert.equal(
    partnerFileProposalsApplyChannel.input.safeParse({
      id: 'pfp_1',
      projectRoot: '/workspace/project',
      expectedContentHash: 'not-a-hash',
    }).success,
    false,
  );
  assert.equal(
    partnerFileProposalsRejectChannel.input.safeParse({
      id: 'pfp_1',
      projectRoot: '/workspace/project',
      reason: 'not needed',
    }).success,
    true,
  );
  assert.equal(
    partnerFileProposalsExportChannel.input.safeParse({
      id: 'pfp_1',
      projectRoot: '/workspace/project',
      expectedContentHash: 'sha256:'.concat('a'.repeat(64)),
    }).success,
    true,
  );
});
