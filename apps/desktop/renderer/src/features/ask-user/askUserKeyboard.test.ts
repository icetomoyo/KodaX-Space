import assert from 'node:assert/strict';
import { test } from 'node:test';

import { resolveAskUserCardKey, resolveAskUserTextInputKey } from './askUserKeyboard.js';

test('Enter on a focused option or action button is left to native activation', () => {
  assert.deepEqual(
    resolveAskUserCardKey({
      key: 'Enter',
      kind: 'select',
      focusedButton: true,
      keyboardOptionCount: 3,
    }),
    { type: 'ignore' },
  );
  assert.deepEqual(
    resolveAskUserCardKey({
      key: 'Enter',
      kind: 'guardrail',
      focusedButton: true,
      keyboardOptionCount: 0,
    }),
    { type: 'ignore' },
  );
});

test('card-level Enter, Escape, and numeric shortcuts retain their documented meaning', () => {
  assert.deepEqual(
    resolveAskUserCardKey({
      key: 'Enter',
      kind: 'guardrail',
      focusedButton: false,
      keyboardOptionCount: 0,
    }),
    { type: 'allow' },
  );
  assert.deepEqual(
    resolveAskUserCardKey({
      key: 'Escape',
      kind: 'select',
      focusedButton: true,
      keyboardOptionCount: 3,
    }),
    { type: 'cancel' },
  );
  assert.deepEqual(
    resolveAskUserCardKey({
      key: '2',
      kind: 'select',
      focusedButton: false,
      keyboardOptionCount: 3,
    }),
    { type: 'select-option', index: 1 },
  );
});

test('text inputs expose explicit submit and cancel shortcuts without consuming ordinary Enter', () => {
  assert.deepEqual(resolveAskUserTextInputKey({ key: 'Enter', controlOrMeta: false }), {
    type: 'ignore',
  });
  assert.deepEqual(resolveAskUserTextInputKey({ key: 'Enter', controlOrMeta: true }), {
    type: 'submit',
  });
  assert.deepEqual(resolveAskUserTextInputKey({ key: 'Escape', controlOrMeta: false }), {
    type: 'cancel',
  });
});
