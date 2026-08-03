import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  invokeChannels,
  INVOKE_CHANNEL_NAMES,
  pushChannels,
  PUSH_CHANNEL_NAMES,
  windowActivityChannel,
  windowCompleteExitProgressChannel,
  windowControlChannel,
  windowStateChannel,
} from '../src/index.js';

test('window.activity push channel is registered', () => {
  assert.ok(pushChannels['window.activity']);
  assert.ok(PUSH_CHANNEL_NAMES.has('window.activity'));
  assert.equal(windowActivityChannel.name, 'window.activity');
  assert.equal(windowActivityChannel.direction, 'push');
});

test('window complete-exit progress push channel is registered and boolean-only', () => {
  assert.ok(pushChannels['window.completeExitProgress']);
  assert.ok(PUSH_CHANNEL_NAMES.has('window.completeExitProgress'));
  assert.equal(windowCompleteExitProgressChannel.direction, 'push');
  assert.equal(windowCompleteExitProgressChannel.payload.safeParse({ active: true }).success, true);
  assert.equal(
    windowCompleteExitProgressChannel.payload.safeParse({ active: false }).success,
    true,
  );
  assert.equal(
    windowCompleteExitProgressChannel.payload.safeParse({ active: 'yes' }).success,
    false,
  );
});

test('window control invoke channels are registered', () => {
  assert.ok(invokeChannels['window.state']);
  assert.ok(invokeChannels['window.control']);
  assert.ok(INVOKE_CHANNEL_NAMES.has('window.state'));
  assert.ok(INVOKE_CHANNEL_NAMES.has('window.control'));
  assert.equal(windowStateChannel.direction, 'invoke');
  assert.equal(windowControlChannel.direction, 'invoke');
});

test('window.control accepts only known actions', () => {
  assert.equal(windowControlChannel.input.safeParse({ action: 'minimize' }).success, true);
  assert.equal(windowControlChannel.input.safeParse({ action: 'toggleMaximize' }).success, true);
  assert.equal(windowControlChannel.input.safeParse({ action: 'close' }).success, true);
  assert.equal(windowControlChannel.input.safeParse({ action: 'fullscreen' }).success, false);
});

test('window.activity payload accepts active, passive, and hidden states', () => {
  assert.equal(
    windowActivityChannel.payload.safeParse({
      state: 'active',
      active: true,
      focused: true,
      visible: true,
      minimized: false,
    }).success,
    true,
  );
  assert.equal(
    windowActivityChannel.payload.safeParse({
      state: 'passive',
      active: false,
      focused: false,
      visible: true,
      minimized: false,
    }).success,
    true,
  );
  assert.equal(
    windowActivityChannel.payload.safeParse({
      state: 'hidden',
      active: false,
      focused: false,
      visible: false,
      minimized: true,
    }).success,
    true,
  );
});

test('window.activity payload rejects unknown state and non-boolean flags', () => {
  assert.equal(
    windowActivityChannel.payload.safeParse({
      state: 'background',
      active: false,
      focused: false,
      visible: true,
      minimized: false,
    }).success,
    false,
  );
  assert.equal(
    windowActivityChannel.payload.safeParse({
      state: 'passive',
      active: 'no',
      focused: false,
      visible: true,
      minimized: false,
    }).success,
    false,
  );
});
