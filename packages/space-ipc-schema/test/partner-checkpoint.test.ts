import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  invokeChannels,
  pushChannels,
  partnerCheckpointSchema,
  partnerCheckpointsChangedChannel,
  partnerCheckpointsGetChannel,
  partnerCheckpointsListChannel,
  partnerCheckpointsRollbackChannel,
} from '../src/index.js';

test('partner checkpoint channels are registered', () => {
  for (const name of [
    'partner.checkpoints.list',
    'partner.checkpoints.get',
    'partner.checkpoints.rollback',
  ]) {
    assert.ok(invokeChannels[name as keyof typeof invokeChannels], `${name} should be registered`);
  }
  assert.ok(pushChannels[partnerCheckpointsChangedChannel.name]);
});

test('partner checkpoint schema accepts checkpointed workspace writes', () => {
  const parsed = partnerCheckpointSchema.safeParse({
    id: 'pc_1',
    sessionId: 's_partner',
    projectRoot: '/workspace/project',
    rootPath: '/workspace/project',
    absolutePath: '/workspace/project/src/generated.ts',
    relativePath: 'src/generated.ts',
    operation: 'update',
    status: 'active',
    beforeHash: 'sha256:'.concat('a'.repeat(64)),
    beforeSizeBytes: 12,
    beforeSnapshotPath: '/tmp/checkpoints/pc_1/before.bin',
    afterHash: 'sha256:'.concat('b'.repeat(64)),
    afterSizeBytes: 24,
    deliveryId: 'pd_1',
    producer: 'write_partner_workspace_file',
    diff: {
      before: 'old',
      after: 'new',
      unified: '--- a/src/generated.ts\n+++ b/src/generated.ts',
      truncated: false,
    },
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });
  assert.equal(parsed.success, true);
});

test('partner checkpoint channels reject malformed input', () => {
  assert.equal(
    partnerCheckpointsListChannel.input.safeParse({ sessionId: 's_partner' }).success,
    false,
  );
  assert.equal(
    partnerCheckpointsListChannel.input.safeParse({
      projectRoot: '/workspace/project',
      sessionId: 's_partner',
    }).success,
    true,
  );
  assert.equal(
    partnerCheckpointsListChannel.input.safeParse({ projectRoot: '/workspace\nsecret' }).success,
    false,
  );
  assert.equal(partnerCheckpointsGetChannel.input.safeParse({ id: 'pc_1' }).success, true);
  assert.equal(partnerCheckpointsRollbackChannel.input.safeParse({ id: 'pc_1' }).success, true);
  assert.equal(
    partnerCheckpointSchema.safeParse({
      id: 'pc_1',
      sessionId: 's_partner',
      projectRoot: '/workspace/project',
      rootPath: '/workspace/project',
      absolutePath: '/workspace/project/a.txt',
      relativePath: 'a.txt',
      operation: 'create',
      status: 'active',
      beforeHash: null,
      beforeSizeBytes: null,
      afterHash: 'not-a-hash',
      afterSizeBytes: 1,
      producer: 'test',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }).success,
    false,
  );
});
