import test from 'node:test';
import assert from 'node:assert/strict';
import { updateConversationHistoryWarnings } from '../../renderer/src/shell/conversationHistoryWarning.js';

test('conversation history warnings remain Session-scoped and resolved reads clear only their Session', () => {
  const first = updateConversationHistoryWarnings(new Map(), 's_a', 'ambiguous');
  const second = updateConversationHistoryWarnings(first, 's_b', 'partial');

  assert.deepEqual(
    [...second],
    [
      ['s_a', 'ambiguous'],
      ['s_b', 'partial'],
    ],
  );

  const resolvedA = updateConversationHistoryWarnings(second, 's_a', 'resolved');
  assert.deepEqual([...resolvedA], [['s_b', 'partial']]);
  assert.deepEqual(
    [...second],
    [
      ['s_a', 'ambiguous'],
      ['s_b', 'partial'],
    ],
  );

  const failedReadLeavesStateUntouched = resolvedA;
  assert.deepEqual([...failedReadLeavesStateUntouched], [['s_b', 'partial']]);
});
