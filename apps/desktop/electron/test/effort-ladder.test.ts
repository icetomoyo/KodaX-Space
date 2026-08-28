import assert from 'node:assert/strict';
import test from 'node:test';

import {
  sdkEffortToReasoningMode,
  visibleEffortLadder,
} from '../../renderer/src/shell/effortLadder.js';

test('provider-declared xhigh and max remain distinct visible choices', () => {
  assert.deepEqual(visibleEffortLadder(['low', 'medium', 'high', 'xhigh', 'max'], false), [
    'auto',
    'low',
    'medium',
    'high',
    'xhigh',
    'max',
  ]);
});

test('provider-declared custom effort stays visible in SDK order', () => {
  assert.deepEqual(visibleEffortLadder(['low', 'medium', 'high', 'xhigh', 'max', 'ultra'], false), [
    'auto',
    'low',
    'medium',
    'high',
    'xhigh',
    'max',
    'ultra',
  ]);
  assert.equal(sdkEffortToReasoningMode('ultra'), 'ultra');
});

test('thinking off and minimal are shown only when supported', () => {
  assert.deepEqual(visibleEffortLadder(['none', 'minimal', 'low', 'medium', 'xhigh'], true), [
    'off',
    'auto',
    'minimal',
    'low',
    'medium',
    'xhigh',
  ]);
  assert.deepEqual(visibleEffortLadder(['low', 'high'], false), ['auto', 'low', 'high']);
  assert.deepEqual(visibleEffortLadder(['none', 'low'], false), ['auto', 'low']);
});

test('unknown capability uses stable intents and does not claim xhigh/max support', () => {
  assert.deepEqual(visibleEffortLadder(undefined, false), ['auto', 'low', 'medium', 'high']);
});

test('known empty strength ladder does not invent unsupported efforts', () => {
  assert.deepEqual(visibleEffortLadder([], true), ['off', 'auto']);
  assert.deepEqual(visibleEffortLadder([], false), ['auto']);
});

test('SDK effort projection preserves canonical levels and normalizes legacy buckets', () => {
  assert.equal(sdkEffortToReasoningMode('none'), 'off');
  assert.equal(sdkEffortToReasoningMode('minimal'), 'minimal');
  assert.equal(sdkEffortToReasoningMode('low'), 'low');
  assert.equal(sdkEffortToReasoningMode('medium'), 'medium');
  assert.equal(sdkEffortToReasoningMode('high'), 'high');
  assert.equal(sdkEffortToReasoningMode('xhigh'), 'xhigh');
  assert.equal(sdkEffortToReasoningMode('max'), 'max');
  assert.equal(sdkEffortToReasoningMode('quick'), 'low');
  assert.equal(sdkEffortToReasoningMode('balanced'), 'medium');
  assert.equal(sdkEffortToReasoningMode('deep'), 'max');
  assert.equal(sdkEffortToReasoningMode('../unsafe'), null);
});
