import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  invokeChannels,
  pushChannels,
  partnerDeliveryRefSchema,
  partnerDeliveriesGetChannel,
  partnerDeliveriesListChannel,
  partnerDeliveriesOutputRootChannel,
  partnerDeliveriesReadBinaryChannel,
  partnerDeliveriesChangedChannel,
} from '../src/index.js';

test('partner delivery channels are registered', () => {
  for (const name of [
    'partner.deliveries.list',
    'partner.deliveries.get',
    'partner.deliveries.outputRoot',
    'partner.deliveries.readBinary',
  ]) {
    assert.ok(invokeChannels[name as keyof typeof invokeChannels], `${name} should be registered`);
  }
  assert.ok(pushChannels[partnerDeliveriesChangedChannel.name]);
});

test('partner delivery schema accepts arbitrary file deliverables', () => {
  const parsed = partnerDeliveryRefSchema.safeParse({
    id: 'pd_1',
    sessionId: 's_partner',
    projectRoot: '/workspace/project',
    rootKind: 'run-output',
    rootPath: '/home/user/.kodax/space/partner-runs/s_partner',
    absolutePath: '/home/user/.kodax/space/partner-runs/s_partner/data/custom.weird',
    relativePath: 'data/custom.weird',
    kind: 'file',
    title: 'custom.weird',
    mime: 'application/octet-stream',
    extension: '.weird',
    sizeBytes: 123,
    contentHash: 'sha256:'.concat('a'.repeat(64)),
    sourceRefs: ['src_1'],
    producer: 'write_partner_deliverable',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });
  assert.equal(parsed.success, true);
});

test('partner delivery channels reject malformed paths and hashes', () => {
  assert.equal(
    partnerDeliveriesListChannel.input.safeParse({ sessionId: 's_partner' }).success,
    false,
  );
  assert.equal(
    partnerDeliveriesListChannel.input.safeParse({
      projectRoot: '/workspace/project',
      sessionId: 's_partner',
    }).success,
    true,
  );
  assert.equal(
    partnerDeliveriesListChannel.input.safeParse({ projectRoot: '/workspace\nsecret' }).success,
    false,
  );
  assert.equal(partnerDeliveriesGetChannel.input.safeParse({ id: 'pd_1' }).success, true);
  assert.equal(
    partnerDeliveriesOutputRootChannel.input.safeParse({
      sessionId: 's_partner',
      projectRoot: '/workspace/project',
    }).success,
    true,
  );
  assert.equal(
    partnerDeliveriesReadBinaryChannel.input.safeParse({ id: 'pd_1', maxBytes: 1024 }).success,
    true,
  );
  assert.equal(
    partnerDeliveryRefSchema.safeParse({
      id: 'pd_1',
      sessionId: 's_partner',
      projectRoot: '/workspace/project',
      rootKind: 'run-output',
      rootPath: '/tmp/out',
      absolutePath: '/tmp/out/a.bin',
      relativePath: 'a.bin',
      kind: 'file',
      title: 'a.bin',
      contentHash: 'not-a-hash',
      sourceRefs: [],
      producer: 'test',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }).success,
    false,
  );
});
