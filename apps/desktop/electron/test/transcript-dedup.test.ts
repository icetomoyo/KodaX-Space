import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  dedupeTranscriptEntries,
  entryContentKey,
  isCompactedPlaceholder,
  isRewindMarker,
  orderTranscriptEntriesParentBeforeChild,
} from '../ipc/transcript-dedup.js';

test('content fingerprint is diagnostic only and excludes physical metadata', () => {
  const original = {
    entryId: 'entry_original',
    timestamp: '2026-07-29T13:41:32.593Z',
    type: 'message',
    message: { role: 'user', content: 'same bytes' },
  };
  const independent = {
    entryId: 'entry_independent',
    timestamp: '2026-07-30T08:00:00.000Z',
    type: 'message',
    message: { role: 'user', content: 'same bytes' },
  };
  assert.equal(entryContentKey(original), entryContentKey(independent));
  assert.equal(dedupeTranscriptEntries([original, independent]).length, 2);
});

test('content fingerprint separates role, body, and compaction summary', () => {
  assert.notEqual(
    entryContentKey({ type: 'message', message: { role: 'user', content: 'ok' } }),
    entryContentKey({ type: 'message', message: { role: 'assistant', content: 'ok' } }),
  );
  assert.notEqual(
    entryContentKey({ type: 'message', message: { role: 'assistant', content: 'one' } }),
    entryContentKey({ type: 'message', message: { role: 'assistant', content: 'two' } }),
  );
  assert.notEqual(
    entryContentKey({ type: 'compaction', summary: 'one' }),
    entryContentKey({ type: 'compaction', summary: 'two' }),
  );
});

test('only exact compacted placeholder shapes are hidden', () => {
  assert.equal(
    isCompactedPlaceholder({
      type: 'message',
      message: { content: [{ type: 'text', text: '[compacted]' }] },
    }),
    true,
  );
  assert.equal(
    isCompactedPlaceholder({ type: 'message', message: { content: '[compacted]' } }),
    true,
  );
  assert.equal(
    isCompactedPlaceholder({
      type: 'message',
      message: { content: [{ type: 'text', text: 'mentions [compacted]' }] },
    }),
    false,
  );
  assert.equal(
    isCompactedPlaceholder({ type: 'compaction', message: { content: '[compacted]' } }),
    false,
  );
});

test('compacted placeholder remains a canonical anchor when an exact clone supplies its body', () => {
  const entries = [
    {
      entryId: 'old_slot',
      parentId: 'parent',
      logicalId: 'logical_message',
      timestamp: '2026-07-29T07:00:00.000Z',
      type: 'message',
      active: false,
      message: { role: 'user', content: '[compacted]' },
    },
    {
      entryId: 'compaction',
      parentId: null,
      logicalId: 'compaction',
      timestamp: '2026-07-29T07:05:00.000Z',
      type: 'compaction',
      active: true,
      summary: 'summary',
      message: { role: 'system', content: 'summary' },
    },
    {
      entryId: 'exact_clone',
      parentId: 'compaction',
      logicalId: 'logical_message',
      sourceEntryId: 'old_slot',
      timestamp: '2026-07-29T07:00:00.000Z',
      type: 'message',
      active: true,
      message: { role: 'user', content: 'exact body' },
    },
  ];
  const out = dedupeTranscriptEntries(entries);
  assert.deepEqual(
    out.map((entry) => entry.entryId),
    ['old_slot', 'compaction'],
  );
  assert.equal(out[0]?.message?.content, 'exact body');
  assert.equal(out[0]?.canonicalIndex, 0);
});

test('orphan compacted placeholder without an exact copy remains hidden', () => {
  assert.deepEqual(
    dedupeTranscriptEntries([
      {
        entryId: 'placeholder',
        type: 'message',
        message: { role: 'user', content: '[compacted]' },
      },
      {
        entryId: 'visible',
        type: 'message',
        message: { role: 'user', content: 'visible' },
      },
    ]).map((entry) => entry.entryId),
    ['visible'],
  );
});

test('legacy child-before-parent transcript is repaired without timestamp sorting', () => {
  const entries = [
    {
      entryId: 'child',
      parentId: 'parent',
      timestamp: '2026-07-29T13:41:32.593Z',
      type: 'message',
      message: { role: 'user', content: 'P0 query' },
    },
    {
      entryId: 'parent',
      parentId: null,
      timestamp: '2026-07-29T13:35:00.000Z',
      type: 'message',
      message: { role: 'assistant', content: 'predecessor' },
    },
    {
      entryId: 'later_root',
      parentId: null,
      timestamp: '2026-07-29T12:00:00.000Z',
      type: 'message',
      message: { role: 'user', content: 'later physical record with older timestamp' },
    },
  ];
  assert.deepEqual(
    orderTranscriptEntriesParentBeforeChild(entries).map((entry) => entry.entryId),
    ['parent', 'child', 'later_root'],
  );
});

test('corrupt parent cycle is broken inside the cycle without hoisting its descendant', () => {
  const entries = [
    {
      entryId: 'descendant',
      parentId: 'cycle_b',
      type: 'message',
      message: { role: 'user', content: 'descendant' },
    },
    {
      entryId: 'cycle_a',
      parentId: 'cycle_b',
      type: 'message',
      message: { role: 'assistant', content: 'cycle a' },
    },
    {
      entryId: 'cycle_b',
      parentId: 'cycle_a',
      type: 'message',
      message: { role: 'assistant', content: 'cycle b' },
    },
  ];

  assert.deepEqual(
    orderTranscriptEntriesParentBeforeChild(entries).map((entry) => entry.entryId),
    ['cycle_a', 'cycle_b', 'descendant'],
  );
});

test('already-correct transcript order is a byte-order pass-through', () => {
  const entries = [
    { entryId: 'a', parentId: null, type: 'message', message: { role: 'user', content: 'a' } },
    { entryId: 'b', parentId: 'a', type: 'message', message: { role: 'assistant', content: 'b' } },
    { entryId: 'c', parentId: 'b', type: 'message', message: { role: 'user', content: 'c' } },
  ];
  assert.deepEqual(
    orderTranscriptEntriesParentBeforeChild(entries).map((entry) => entry.entryId),
    ['a', 'b', 'c'],
  );
});

test('proven active clone supplies the body but cannot move the first canonical slot', () => {
  const entries = [
    {
      entryId: 'entry_original',
      parentId: 'entry_parent',
      logicalId: 'logical_query',
      timestamp: '2026-07-29T13:41:32.593Z',
      type: 'message',
      active: false,
      message: { role: 'user', content: 'original body' },
    },
    {
      entryId: 'entry_compaction',
      parentId: null,
      logicalId: 'logical_compaction',
      timestamp: '2026-07-29T14:41:32.645Z',
      type: 'compaction',
      active: true,
      summary: 'summary',
      message: { role: 'system', content: 'summary' },
    },
    {
      entryId: 'entry_clone',
      parentId: 'entry_compaction',
      logicalId: 'logical_query',
      sourceEntryId: 'entry_original',
      timestamp: '2026-07-29T14:41:32.650Z',
      type: 'message',
      active: true,
      message: { role: 'user', content: 'normalized authoritative body' },
    },
  ];

  const out = dedupeTranscriptEntries(entries);
  assert.deepEqual(
    out.map((entry) => entry.entryId),
    ['entry_original', 'entry_compaction'],
  );
  assert.equal(out[0]?.message?.content, 'normalized authoritative body');
  assert.equal(out[0]?.parentId, 'entry_parent');
  assert.equal(out[0]?.timestamp, '2026-07-29T13:41:32.593Z');
  assert.equal(out[0]?.canonicalIndex, 0);
  assert.equal(out[0]?.authoritativeEntryId, 'entry_clone');
  assert.equal(out[0]?.active, true);
});

test('sourceEntryId chain proves clones even when legacy logicalIds differ', () => {
  const entries = [
    {
      entryId: 'source',
      logicalId: 'legacy_source',
      type: 'message',
      active: false,
      message: { role: 'assistant', content: 'first' },
    },
    {
      entryId: 'clone_a',
      logicalId: 'legacy_clone_a',
      sourceEntryId: 'source',
      type: 'message',
      active: false,
      message: { role: 'assistant', content: 'second' },
    },
    {
      entryId: 'clone_b',
      logicalId: 'legacy_clone_b',
      sourceEntryId: 'source',
      type: 'message',
      active: true,
      message: { role: 'assistant', content: 'authoritative' },
    },
    {
      entryId: 'child_of_clone',
      parentId: 'clone_b',
      logicalId: 'child_of_clone',
      type: 'message',
      active: true,
      message: { role: 'user', content: 'next' },
    },
  ];
  const out = dedupeTranscriptEntries(entries);
  assert.equal(out.length, 2);
  assert.equal(out[0]?.entryId, 'source');
  assert.equal(out[0]?.message?.content, 'authoritative');
  assert.equal(out[0]?.authoritativeEntryId, 'clone_b');
  assert.equal(out[0]?.sourceEntryId, undefined, 'canonical source must not point to itself');
  assert.equal(
    out[1]?.parentId,
    'source',
    'children of a folded clone must target its canonical row',
  );
});

test('ambiguous identical inactive and active messages fail open', () => {
  const entries = [
    {
      entryId: 'one',
      logicalId: 'one',
      type: 'message',
      active: false,
      message: { role: 'user', content: 'ok' },
    },
    {
      entryId: 'two',
      logicalId: 'two',
      type: 'message',
      active: true,
      message: { role: 'user', content: 'ok' },
    },
    {
      entryId: 'three',
      logicalId: 'three',
      type: 'message',
      active: true,
      message: { role: 'user', content: 'ok' },
    },
  ];
  assert.deepEqual(
    dedupeTranscriptEntries(entries).map((entry) => entry.entryId),
    ['one', 'two', 'three'],
  );
});

test('legacy exact copy across a compaction boundary fails open without clone provenance', () => {
  const timestamp = '2026-07-29T07:05:30.740Z';
  const entries = [
    {
      entryId: 'legacy_original',
      logicalId: 'legacy_original',
      timestamp,
      type: 'message',
      active: false,
      message: { role: 'user', content: '请移动过去' },
    },
    {
      entryId: 'compaction',
      logicalId: 'compaction',
      timestamp: '2026-07-29T07:06:50.278Z',
      type: 'compaction',
      active: true,
      summary: 'summary',
      message: { role: 'system', content: 'summary' },
    },
    {
      entryId: 'legacy_active_copy',
      parentId: 'compaction',
      logicalId: 'legacy_active_copy',
      timestamp,
      type: 'message',
      active: true,
      message: { role: 'user', content: '请移动过去' },
    },
  ];
  const out = dedupeTranscriptEntries(entries);
  assert.deepEqual(
    out.map((entry) => entry.entryId),
    ['legacy_original', 'compaction', 'legacy_active_copy'],
  );
  assert.equal(out[0]?.canonicalIndex, 0);
  assert.equal(out[0]?.authoritativeEntryId, undefined);
});

test('modern distinct identities fail open even for identical same-millisecond rows across compaction', () => {
  const timestamp = '2026-07-29T07:05:30.740Z';
  const entries = [
    {
      entryId: 'first',
      logicalId: 'stable_first',
      timestamp,
      turnId: 'turn_1',
      type: 'message',
      active: false,
      message: { role: 'user', content: 'ok' },
    },
    {
      entryId: 'compaction',
      logicalId: 'compaction',
      timestamp: '2026-07-29T07:06:50.278Z',
      type: 'compaction',
      summary: 'summary',
      message: { role: 'system', content: 'summary' },
    },
    {
      entryId: 'second',
      parentId: 'compaction',
      logicalId: 'stable_second',
      timestamp,
      turnId: 'turn_1',
      type: 'message',
      active: true,
      message: { role: 'user', content: 'ok' },
    },
  ];
  assert.deepEqual(
    dedupeTranscriptEntries(entries).map((entry) => entry.entryId),
    ['first', 'compaction', 'second'],
  );
});

test('legacy replay candidates preserve every occurrence without clone provenance', () => {
  const timestamp = '2026-07-29T07:05:30.740Z';
  const entries = [
    {
      entryId: 'old',
      logicalId: 'old',
      timestamp,
      type: 'message',
      active: false,
      message: { role: 'user', content: 'ok' },
    },
    {
      entryId: 'compaction',
      logicalId: 'compaction',
      timestamp: '2026-07-29T07:06:50.278Z',
      type: 'compaction',
      summary: 'summary',
      message: { role: 'system', content: 'summary' },
    },
    {
      entryId: 'active_one',
      parentId: 'compaction',
      logicalId: 'active_one',
      timestamp,
      type: 'message',
      active: true,
      message: { role: 'user', content: 'ok' },
    },
    {
      entryId: 'active_two',
      parentId: 'active_one',
      logicalId: 'active_two',
      timestamp,
      type: 'message',
      active: true,
      message: { role: 'user', content: 'ok' },
    },
  ];
  assert.deepEqual(
    dedupeTranscriptEntries(entries).map((entry) => entry.entryId),
    ['old', 'compaction', 'active_one', 'active_two'],
  );
  assert.equal(
    dedupeTranscriptEntries(entries)[3]?.parentId,
    'active_one',
    'ambiguous legacy ancestry must remain byte-for-byte intact',
  );
});

test('all-inactive legacy post-compact replay candidates fail open', () => {
  const timestamp = '2026-07-30T00:54:24.225Z';
  const entries = [
    {
      entryId: 'source_answer',
      logicalId: 'source_answer',
      timestamp,
      type: 'message',
      active: false,
      message: { role: 'assistant', content: 'retained exact answer' },
    },
    {
      entryId: 'compaction',
      logicalId: 'compaction',
      timestamp: '2026-07-30T01:17:27.434Z',
      type: 'compaction',
      active: false,
      summary: 'checkpoint',
      message: { role: 'system', content: 'checkpoint' },
    },
    {
      entryId: 'retained_copy',
      parentId: 'compaction',
      logicalId: 'retained_copy',
      timestamp,
      type: 'message',
      active: false,
      message: { role: 'assistant', content: 'retained exact answer' },
    },
    {
      entryId: 'legacy_attachment',
      parentId: 'compaction',
      logicalId: 'legacy_attachment',
      timestamp: '2026-07-30T01:27:17.075Z',
      type: 'message',
      active: false,
      message: {
        role: 'user',
        content: '[Post-compact: recent operations]\nread file',
        _synthetic: true,
        _source: 'compaction-context',
      },
    },
    {
      entryId: 'resume_replay',
      parentId: 'legacy_attachment',
      logicalId: 'resume_replay',
      timestamp,
      type: 'message',
      active: false,
      message: { role: 'assistant', content: 'retained exact answer' },
    },
  ];

  assert.deepEqual(
    dedupeTranscriptEntries(entries).map((entry) => entry.entryId),
    ['source_answer', 'compaction', 'retained_copy', 'legacy_attachment', 'resume_replay'],
  );
});

test('successive legacy resume epochs remain distinct without SDK provenance', () => {
  const timestamp = '2026-07-30T01:22:00.000Z';
  const entries = [
    {
      entryId: 'compaction',
      logicalId: 'compaction',
      timestamp: '2026-07-30T01:17:27.434Z',
      type: 'compaction',
      summary: 'checkpoint',
      message: { role: 'system', content: 'checkpoint' },
    },
    {
      entryId: 'canonical_after_compaction',
      parentId: 'compaction',
      logicalId: 'canonical_after_compaction',
      timestamp,
      type: 'message',
      message: { role: 'assistant', content: 'one factual answer' },
    },
    {
      entryId: 'attachment_a',
      parentId: 'compaction',
      logicalId: 'attachment_a',
      timestamp: '2026-07-30T01:27:17.075Z',
      type: 'message',
      message: {
        role: 'user',
        content: '[Post-compact: recent operations]\nA',
        _synthetic: true,
        _source: 'compaction-context',
      },
    },
    {
      entryId: 'replay_a',
      parentId: 'attachment_a',
      logicalId: 'replay_a',
      timestamp,
      type: 'message',
      message: { role: 'assistant', content: 'one factual answer' },
    },
    {
      entryId: 'attachment_b',
      parentId: 'attachment_a',
      logicalId: 'attachment_b',
      timestamp: '2026-07-30T01:35:00.000Z',
      type: 'message',
      message: {
        role: 'user',
        content: '[Post-compact: recent operations]\nB',
        _synthetic: true,
        _source: 'compaction-context',
      },
    },
    {
      entryId: 'replay_b',
      parentId: 'attachment_b',
      logicalId: 'replay_b',
      timestamp,
      type: 'message',
      message: { role: 'assistant', content: 'one factual answer' },
    },
  ];

  assert.deepEqual(
    dedupeTranscriptEntries(entries).map((entry) => entry.entryId),
    [
      'compaction',
      'canonical_after_compaction',
      'attachment_a',
      'replay_a',
      'attachment_b',
      'replay_b',
    ],
  );
});

test('legacy attachment-transparent sibling writers fail open without SDK provenance', () => {
  const queryTimestamp = '2026-07-30T04:53:03.710Z';
  const answerTimestamp = '2026-07-30T04:54:12.300Z';
  const entries = [
    {
      entryId: 'compaction',
      logicalId: 'compaction',
      timestamp: '2026-07-30T04:00:00.000Z',
      type: 'compaction',
      summary: 'checkpoint',
      message: { role: 'system', content: 'checkpoint' },
    },
    {
      entryId: 'old_attachment',
      parentId: 'compaction',
      logicalId: 'old_attachment',
      timestamp: '2026-07-30T04:45:00.000Z',
      type: 'message',
      message: {
        role: 'user',
        content: '[Post-compact: recent operations]\nold',
        _synthetic: true,
        _source: 'compaction-context',
      },
    },
    {
      entryId: 'new_attachment',
      parentId: 'old_attachment',
      logicalId: 'new_attachment',
      timestamp: '2026-07-30T04:52:56.946Z',
      type: 'message',
      message: {
        role: 'user',
        content: '[Post-compact: recent operations]\nnew',
        _synthetic: true,
        _source: 'compaction-context',
      },
    },
    {
      entryId: 'with_attachment_query',
      parentId: 'new_attachment',
      logicalId: 'with_attachment_query',
      timestamp: queryTimestamp,
      type: 'message',
      message: { role: 'user', content: 'same query' },
    },
    {
      entryId: 'with_attachment_answer',
      parentId: 'with_attachment_query',
      logicalId: 'with_attachment_answer',
      timestamp: answerTimestamp,
      type: 'message',
      message: { role: 'assistant', content: 'same answer' },
    },
    {
      entryId: 'without_attachment_query',
      parentId: 'old_attachment',
      logicalId: 'without_attachment_query',
      timestamp: queryTimestamp,
      type: 'message',
      message: { role: 'user', content: 'same query' },
    },
    {
      entryId: 'without_attachment_answer',
      parentId: 'without_attachment_query',
      logicalId: 'without_attachment_answer',
      timestamp: answerTimestamp,
      type: 'message',
      message: { role: 'assistant', content: 'same answer' },
    },
  ];

  assert.deepEqual(
    dedupeTranscriptEntries(entries).map((entry) => entry.entryId),
    [
      'compaction',
      'old_attachment',
      'new_attachment',
      'with_attachment_query',
      'with_attachment_answer',
      'without_attachment_query',
      'without_attachment_answer',
    ],
  );
});

test('ordinary same-content sibling branches remain separate without a legacy replay path', () => {
  const entries = [
    {
      entryId: 'root',
      logicalId: 'root',
      timestamp: '2026-07-30T05:00:00.000Z',
      type: 'message',
      message: { role: 'assistant', content: 'root' },
    },
    {
      entryId: 'branch_a',
      parentId: 'root',
      logicalId: 'branch_a',
      timestamp: '2026-07-30T05:01:00.000Z',
      type: 'message',
      message: { role: 'user', content: 'same branch text' },
    },
    {
      entryId: 'branch_b',
      parentId: 'root',
      logicalId: 'branch_b',
      timestamp: '2026-07-30T05:01:00.000Z',
      type: 'message',
      message: { role: 'user', content: 'same branch text' },
    },
  ];

  assert.deepEqual(
    dedupeTranscriptEntries(entries).map((entry) => entry.entryId),
    ['root', 'branch_a', 'branch_b'],
  );
});

test('sequential identical messages beneath a legacy attachment preserve both occurrences', () => {
  const timestamp = '2026-07-30T05:10:00.000Z';
  const entries = [
    {
      entryId: 'compaction',
      logicalId: 'compaction',
      timestamp: '2026-07-30T05:00:00.000Z',
      type: 'compaction',
      summary: 'checkpoint',
      message: { role: 'system', content: 'checkpoint' },
    },
    {
      entryId: 'attachment',
      parentId: 'compaction',
      logicalId: 'attachment',
      timestamp: '2026-07-30T05:05:00.000Z',
      type: 'message',
      message: {
        role: 'user',
        content: '[Post-compact: recent operations]\nresume',
        _synthetic: true,
        _source: 'compaction-context',
      },
    },
    {
      entryId: 'first_ok',
      parentId: 'attachment',
      logicalId: 'first_ok',
      timestamp,
      type: 'message',
      message: { role: 'assistant', content: 'OK' },
    },
    {
      entryId: 'second_ok',
      parentId: 'first_ok',
      logicalId: 'second_ok',
      timestamp,
      type: 'message',
      message: { role: 'assistant', content: 'OK' },
    },
  ];

  assert.deepEqual(
    dedupeTranscriptEntries(entries).map((entry) => entry.entryId),
    ['compaction', 'attachment', 'first_ok', 'second_ok'],
  );
});

test('post-compact-looking user text without SDK synthetic provenance is not a replay boundary', () => {
  const timestamp = '2026-07-30T02:00:00.000Z';
  const entries = [
    {
      entryId: 'first',
      logicalId: 'first',
      timestamp,
      type: 'message',
      message: { role: 'assistant', content: 'same' },
    },
    {
      entryId: 'user_text',
      parentId: 'first',
      logicalId: 'user_text',
      timestamp: '2026-07-30T02:01:00.000Z',
      type: 'message',
      message: { role: 'user', content: '[Post-compact: recent operations]\nnot SDK data' },
    },
    {
      entryId: 'second',
      parentId: 'user_text',
      logicalId: 'second',
      timestamp,
      type: 'message',
      message: { role: 'assistant', content: 'same' },
    },
  ];

  assert.deepEqual(
    dedupeTranscriptEntries(entries).map((entry) => entry.entryId),
    ['first', 'user_text', 'second'],
  );
});

test('same content with different timestamps remains two legitimate messages across compaction', () => {
  const entries = [
    {
      entryId: 'first_ok',
      timestamp: '2026-07-29T07:00:00.000Z',
      type: 'message',
      active: false,
      message: { role: 'user', content: 'ok' },
    },
    {
      entryId: 'compaction',
      timestamp: '2026-07-29T07:05:00.000Z',
      type: 'compaction',
      summary: 'summary',
      message: { role: 'system', content: 'summary' },
    },
    {
      entryId: 'second_ok',
      timestamp: '2026-07-29T07:10:00.000Z',
      type: 'message',
      active: true,
      message: { role: 'user', content: 'ok' },
    },
  ];
  assert.deepEqual(
    dedupeTranscriptEntries(entries).map((entry) => entry.entryId),
    ['first_ok', 'compaction', 'second_ok'],
  );
});

test('rewind hides only the exact abandoned physical path and keeps the new child', () => {
  const entries = [
    {
      entryId: 'target',
      parentId: null,
      type: 'message',
      message: { role: 'assistant', content: 'target' },
    },
    {
      entryId: 'abandoned',
      parentId: 'target',
      type: 'message',
      message: { role: 'user', content: 'abandoned query' },
    },
    {
      entryId: 'rewind',
      parentId: 'target',
      type: 'rewind_marker',
      summary: 'rewound',
      payload: { rewindTargetId: 'target', fromId: 'abandoned', truncatedCount: 1 },
      message: { role: 'system', content: 'rewound' },
    },
    {
      entryId: 'replacement',
      parentId: 'target',
      type: 'message',
      message: { role: 'user', content: 'replacement query' },
    },
  ];
  assert.equal(isRewindMarker(entries[2]!), true);
  assert.deepEqual(
    dedupeTranscriptEntries(entries).map((entry) => entry.entryId),
    ['target', 'replacement'],
  );
});

test('corrupt rewind path fails open instead of deleting unrelated history', () => {
  const entries = [
    {
      entryId: 'unrelated',
      parentId: null,
      type: 'message',
      message: { role: 'user', content: 'keep me' },
    },
    {
      entryId: 'rewind',
      parentId: null,
      type: 'rewind_marker',
      payload: { rewindTargetId: 'missing_target', fromId: 'unrelated' },
      message: { role: 'system', content: 'rewound' },
    },
  ];
  assert.deepEqual(
    dedupeTranscriptEntries(entries).map((entry) => entry.entryId),
    ['unrelated'],
  );
});

test('corrupt later rewind cannot undo an earlier marker proven abandoned path', () => {
  const entries = [
    {
      entryId: 'root',
      parentId: null,
      type: 'message',
      message: { role: 'assistant', content: 'root' },
    },
    {
      entryId: 'abandoned',
      parentId: 'root',
      type: 'message',
      message: { role: 'user', content: 'abandoned' },
    },
    {
      entryId: 'valid_rewind',
      parentId: 'root',
      type: 'rewind_marker',
      payload: { rewindTargetId: 'root', fromId: 'abandoned' },
      message: { role: 'system', content: 'rewound' },
    },
    {
      entryId: 'corrupt_rewind',
      parentId: 'root',
      type: 'rewind_marker',
      payload: { rewindTargetId: 'missing', fromId: 'abandoned' },
      message: { role: 'system', content: 'rewound' },
    },
  ];
  assert.deepEqual(
    dedupeTranscriptEntries(entries).map((entry) => entry.entryId),
    ['root'],
  );
});

test('storage-only rows and compacted placeholders are classified before clone folding', () => {
  const entries = [
    {
      entryId: 'placeholder',
      type: 'message',
      message: { role: 'user', content: '[compacted]' },
    },
    { entryId: 'archive', type: 'archive_marker', message: { role: 'system', content: 'x' } },
    { entryId: 'label', type: 'label', message: { role: 'system', content: 'x' } },
    { entryId: 'goal', type: 'goal', message: { role: 'system', content: 'x' } },
    {
      entryId: 'visible',
      type: 'message',
      message: { role: 'user', content: 'visible' },
    },
  ];
  assert.deepEqual(
    dedupeTranscriptEntries(entries).map((entry) => entry.entryId),
    ['visible'],
  );
});
