import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  inputHistoryTargetIndex,
  isAtInputHistoryBoundary,
} from '../../renderer/src/shell/inputHistoryNavigation.js';

test('input history navigation only takes over at absolute text boundaries', () => {
  const value = 'first line\nsecond line';

  assert.equal(isAtInputHistoryBoundary('up', value, 0, 0), true);
  assert.equal(isAtInputHistoryBoundary('up', value, 3, 3), false);
  assert.equal(
    isAtInputHistoryBoundary('up', value, 'first line\n'.length, 'first line\n'.length),
    false,
  );

  assert.equal(isAtInputHistoryBoundary('down', value, value.length, value.length), true);
  assert.equal(isAtInputHistoryBoundary('down', value, value.length - 3, value.length - 3), false);
});

test('soft-wrapped visual lines remain native textarea navigation', () => {
  const value = 'a long line that wraps visually without a newline';
  const visualSecondLineStart = 18;

  assert.equal(
    isAtInputHistoryBoundary('up', value, visualSecondLineStart, visualSecondLineStart),
    false,
  );
  assert.equal(
    isAtInputHistoryBoundary('down', value, visualSecondLineStart, visualSecondLineStart),
    false,
  );
});

test('text selections do not trigger input history navigation', () => {
  assert.equal(isAtInputHistoryBoundary('up', 'query', 0, 2), false);
  assert.equal(isAtInputHistoryBoundary('down', 'query', 2, 5), false);
});

test('input history index stops when there is no previous or next query', () => {
  assert.equal(inputHistoryTargetIndex('up', -1, 3), 2);
  assert.equal(inputHistoryTargetIndex('up', 2, 3), 1);
  assert.equal(inputHistoryTargetIndex('up', 0, 3), null);

  assert.equal(inputHistoryTargetIndex('down', 0, 3), 1);
  assert.equal(inputHistoryTargetIndex('down', 2, 3), -1);
  assert.equal(inputHistoryTargetIndex('down', -1, 3), null);
});
