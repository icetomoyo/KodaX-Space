import assert from 'node:assert/strict';
import test from 'node:test';
import {
  bufferIndexForSelectorTurn,
  canRewindSelectorTurn,
  latestSelectorTurnIndex,
  localNoticeCutoffSentAtForSelectorTurn,
  messageForSelectorTurn,
  previousSelectorTurnIndex,
  selectorTurnIndexesByMessageId,
} from '../../renderer/src/features/session/turnIndex.js';

test('selector turn indexes preserve absolute history position across truncation and live append', () => {
  const messages = [
    { id: 'prefix-anchor', hiddenHistoryAnchor: true },
    { id: 'restored-42', historyTurnIndex: 42 },
    { id: 'restored-43', historyTurnIndex: 43 },
    { id: 'hidden-live-copy', hiddenProjectionDuplicate: true },
    { id: 'live-44' },
    { id: 'live-45' },
  ];

  assert.deepEqual(
    [...selectorTurnIndexesByMessageId(messages)],
    [
      ['restored-42', 42],
      ['restored-43', 43],
      ['live-44', 44],
      ['live-45', 45],
    ],
  );
  assert.equal(bufferIndexForSelectorTurn(messages, 42), 1);
  assert.equal(bufferIndexForSelectorTurn(messages, 44), 4);
  assert.equal(bufferIndexForSelectorTurn(messages, 41), -1);
  assert.equal(latestSelectorTurnIndex(messages), 45);
  assert.equal(previousSelectorTurnIndex(messages), 44);
  assert.equal(canRewindSelectorTurn(messages, 42), true);
  assert.equal(canRewindSelectorTurn(messages, 44), true);
  assert.equal(canRewindSelectorTurn(messages, 45), false);
});

test('selector lookup returns the exact persisted boundary carried by the chosen loaded turn', () => {
  const boundary = { boundaryId: 'entry-turn-end', sourceRevision: 'source-revision' };
  const messages = [
    { id: 'restored-42', historyTurnIndex: 42, historyBoundary: boundary },
    { id: 'restored-43', historyTurnIndex: 43 },
  ];

  assert.strictEqual(messageForSelectorTurn(messages, 42)?.historyBoundary, boundary);
  assert.equal(messageForSelectorTurn(messages, 41), undefined);
});

test('rewind eligibility ignores hidden anchors and uses absolute restored turn indexes', () => {
  const messages = [
    { id: 'prefix-anchor', hiddenHistoryAnchor: true },
    { id: 'restored-42', historyTurnIndex: 42 },
    { id: 'hidden-live-copy', hiddenProjectionDuplicate: true },
    { id: 'restored-43', historyTurnIndex: 43 },
  ];

  assert.equal(canRewindSelectorTurn(messages, 42), true);
  assert.equal(canRewindSelectorTurn(messages, 43), false);
  assert.equal(previousSelectorTurnIndex(messages), 42);
});

test('hidden-only history has no selector turn', () => {
  const messages = [
    { id: 'prefix-anchor', hiddenHistoryAnchor: true },
    { id: 'hidden-live-copy', hiddenProjectionDuplicate: true },
  ];

  assert.equal(latestSelectorTurnIndex(messages), undefined);
  assert.equal(previousSelectorTurnIndex(messages), undefined);
  assert.equal(canRewindSelectorTurn(messages, 0), false);
});

test('local notice rewind cutoff is the first buffer row removed after the selected turn', () => {
  const messages = [
    { id: 'restored-42', historyTurnIndex: 42, sentAt: 1_000 },
    { id: 'restored-43', historyTurnIndex: 43, sentAt: 2_000 },
    { id: 'live-44', sentAt: 3_000 },
  ];

  assert.equal(localNoticeCutoffSentAtForSelectorTurn(messages, 42), 2_000);
  assert.equal(localNoticeCutoffSentAtForSelectorTurn(messages, 43), 3_000);
  assert.equal(localNoticeCutoffSentAtForSelectorTurn(messages, 44), undefined);
  assert.equal(localNoticeCutoffSentAtForSelectorTurn(messages, 41), undefined);
});
