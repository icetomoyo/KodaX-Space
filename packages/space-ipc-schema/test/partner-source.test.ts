import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  invokeChannels,
  partnerSourceSchema,
  partnerSourcesAddChannel,
  partnerSourcesListChannel,
  partnerSourcesRemoveChannel,
} from '../src/index.js';

test('partner source channels are registered', () => {
  for (const name of ['partner.sources.list', 'partner.sources.add', 'partner.sources.remove']) {
    assert.ok(invokeChannels[name as keyof typeof invokeChannels], `${name} should be registered`);
  }
});

test('partner source add accepts a workspace file source', () => {
  const parsed = partnerSourcesAddChannel.input.safeParse({
    sessionId: 's_partner',
    kind: 'workspace_path',
    projectRoot: '/workspace/project',
    path: 'docs/spec.md',
    targetKind: 'file',
  });
  assert.equal(parsed.success, true);
});

test('partner source schemas reject control characters in paths', () => {
  const parsed = partnerSourcesAddChannel.input.safeParse({
    sessionId: 's_partner',
    projectRoot: '/workspace/project',
    path: 'docs\nsecret.md',
  });
  assert.equal(parsed.success, false);
});

test('partner source list/remove shapes', () => {
  assert.equal(partnerSourcesListChannel.input.safeParse({ sessionId: 's1' }).success, false);
  assert.equal(
    partnerSourcesListChannel.input.safeParse({
      sessionId: 's1',
      projectRoot: '/workspace/project',
    }).success,
    true,
  );
  assert.equal(
    partnerSourcesRemoveChannel.input.safeParse({ sessionId: 's1', sourceId: 'src_1' }).success,
    false,
  );
  assert.equal(
    partnerSourcesRemoveChannel.input.safeParse({
      sessionId: 's1',
      projectRoot: '/workspace/project',
      sourceId: 'src_1',
    }).success,
    true,
  );
});

test('partner source output shape caps core fields', () => {
  const source = {
    id: 'src_1',
    sessionId: 's1',
    kind: 'workspace_path',
    projectRoot: '/workspace/project',
    path: 'README.md',
    targetKind: 'file',
    label: 'README.md',
    addedAt: Date.now(),
  };
  assert.equal(partnerSourceSchema.safeParse(source).success, true);
});
