import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dedupeTranscriptEntries } from '../ipc/transcript-dedup.js';

test('repeated logicalId is strong clone proof and preserves the first slot', () => {
  const entries = [
    {
      entryId: 'first',
      parentId: 'parent',
      logicalId: 'logical',
      type: 'message',
      active: false,
      message: { role: 'assistant', content: 'old island copy' },
    },
    {
      entryId: 'boundary',
      parentId: null,
      logicalId: 'boundary',
      type: 'compaction',
      summary: 'boundary',
      message: { role: 'system', content: 'boundary' },
    },
    {
      entryId: 'active',
      parentId: 'boundary',
      logicalId: 'logical',
      type: 'message',
      active: true,
      message: { role: 'assistant', content: 'active normalized copy' },
    },
  ];

  const out = dedupeTranscriptEntries(entries);
  assert.deepEqual(
    out.map((entry) => entry.entryId),
    ['first', 'boundary'],
  );
  assert.equal(out[0]?.message?.content, 'active normalized copy');
  assert.equal(out[0]?.parentId, 'parent');
  assert.equal(out[0]?.authoritativeEntryId, 'active');
});

test('unique logicalIds never fall back to content-hash deletion', () => {
  const entries = [
    {
      entryId: 'entry-1',
      logicalId: 'entry-1',
      type: 'message',
      active: false,
      message: { role: 'user', content: 'same legitimate prompt' },
    },
    {
      entryId: 'entry-2',
      logicalId: 'entry-2',
      type: 'message',
      active: false,
      message: { role: 'user', content: 'same legitimate prompt' },
    },
  ];

  assert.deepEqual(
    dedupeTranscriptEntries(entries).map((entry) => entry.entryId),
    ['entry-1', 'entry-2'],
  );
});

test('same timestamp neither proves a clone nor changes order', () => {
  const entries = [
    {
      entryId: 'tool',
      logicalId: 'tool',
      timestamp: '2026-07-29T13:41:32.593Z',
      type: 'message',
      message: { role: 'assistant', content: 'tool call' },
    },
    {
      entryId: 'result',
      logicalId: 'result',
      timestamp: '2026-07-29T13:41:32.593Z',
      type: 'message',
      message: { role: 'user', content: 'tool result' },
    },
  ];
  assert.deepEqual(
    dedupeTranscriptEntries(entries).map((entry) => entry.entryId),
    ['tool', 'result'],
  );
});
