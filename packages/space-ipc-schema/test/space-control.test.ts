import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  spaceActionArgsSchema,
  spaceActionIdSchema,
  spaceControlRequestedChannel,
  spaceControlResolveChannel,
} from '../src/channels/space-control.js';

test('space control action IDs and args are closed bounded schemas', () => {
  assert.equal(spaceActionIdSchema.safeParse('ui.theme.set').success, true);
  assert.equal(spaceActionIdSchema.safeParse('ipc.invoke').success, false);
  assert.equal(spaceActionArgsSchema.safeParse({ value: 'dark' }).success, true);
  assert.equal(spaceActionArgsSchema.safeParse({ value: 'dark', path: '/tmp' }).success, false);
  assert.equal(spaceActionArgsSchema.safeParse({ value: 'x'.repeat(65) }).success, false);
});

test('space control apply push requires args and expected revision', () => {
  const base = {
    requestId: '11111111-1111-4111-8111-111111111111',
    actionId: 'ui.theme.set',
  };
  assert.equal(
    spaceControlRequestedChannel.payload.safeParse({ ...base, operation: 'inspect' }).success,
    true,
  );
  assert.equal(
    spaceControlRequestedChannel.payload.safeParse({
      ...base,
      operation: 'inspect',
      args: { value: 'dark' },
    }).success,
    false,
  );
  assert.equal(
    spaceControlRequestedChannel.payload.safeParse({ ...base, operation: 'apply' }).success,
    false,
  );
  assert.equal(
    spaceControlRequestedChannel.payload.safeParse({
      ...base,
      operation: 'apply',
      args: { value: 'dark' },
      expectedRevision: 0,
      expectedRendererInstanceId: '22222222-2222-4222-8222-222222222222',
    }).success,
    true,
  );
});

test('space control resolution contains only canonical safe fields', () => {
  assert.equal(
    spaceControlResolveChannel.input.safeParse({
      requestId: '11111111-1111-4111-8111-111111111111',
      actionId: 'ui.theme.set',
      status: 'applied',
      revision: 1,
      rendererInstanceId: '22222222-2222-4222-8222-222222222222',
      safeState: 'dark',
      summaryKey: 'spaceControl.theme.applied',
    }).success,
    true,
  );
  assert.equal(
    spaceControlResolveChannel.input.safeParse({
      requestId: '11111111-1111-4111-8111-111111111111',
      actionId: 'ui.theme.set',
      status: 'failed',
      revision: 0,
      rendererInstanceId: '22222222-2222-4222-8222-222222222222',
      summaryKey: 'spaceControl.failed',
      rawError: 'secret',
    }).success,
    false,
  );
});
