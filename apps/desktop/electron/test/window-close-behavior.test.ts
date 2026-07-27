import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseWindowClosePromptResult,
  resolveWindowCloseAction,
} from '../window/window-close-behavior.js';

test('window close policy only applies when a usable tray exists', () => {
  assert.equal(resolveWindowCloseAction('ask', true), 'prompt');
  assert.equal(resolveWindowCloseAction('minimize-to-tray', true), 'minimize-to-tray');
  assert.equal(resolveWindowCloseAction('quit-completely', true), 'quit-completely');

  for (const behavior of ['ask', 'minimize-to-tray', 'quit-completely'] as const) {
    assert.equal(resolveWindowCloseAction(behavior, false), 'allow-close');
  }
});

test('close prompt remembers only an executed close action', () => {
  assert.deepEqual(parseWindowClosePromptResult({ response: 0, checkboxChecked: true }), {
    action: 'minimize-to-tray',
    rememberedBehavior: 'minimize-to-tray',
  });
  assert.deepEqual(parseWindowClosePromptResult({ response: 1, checkboxChecked: true }), {
    action: 'quit-completely',
    rememberedBehavior: 'quit-completely',
  });
  assert.deepEqual(parseWindowClosePromptResult({ response: 2, checkboxChecked: true }), {
    action: 'cancel',
  });
  assert.deepEqual(parseWindowClosePromptResult({ response: -1, checkboxChecked: true }), {
    action: 'cancel',
  });
});

test('close prompt executes without persistence when remember is clear', () => {
  assert.deepEqual(parseWindowClosePromptResult({ response: 0, checkboxChecked: false }), {
    action: 'minimize-to-tray',
  });
  assert.deepEqual(parseWindowClosePromptResult({ response: 1, checkboxChecked: false }), {
    action: 'quit-completely',
  });
});
