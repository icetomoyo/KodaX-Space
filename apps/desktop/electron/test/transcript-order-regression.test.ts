import { test } from 'node:test';
import assert from 'node:assert/strict';

import { dedupeTranscriptEntries } from '../ipc/transcript-dedup.js';

test('s_607 model: sidecar child, rewind, multi-tool assistant, and compaction restore in lineage order', () => {
  const queryTimestamp = '2026-07-29T13:41:32.593Z';
  const raw = [
    {
      entryId: 'p0_query',
      parentId: 'retained_parent',
      logicalId: 'logical_p0',
      timestamp: queryTimestamp,
      turnId: 'turn_p0',
      type: 'message',
      active: false,
      message: { role: 'user', content: 'P0 query' },
    },
    {
      entryId: 'p0_assistant',
      parentId: 'p0_query',
      logicalId: 'logical_assistant',
      timestamp: '2026-07-29T13:42:40.287Z',
      turnId: 'turn_p0',
      type: 'message',
      active: false,
      message: {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: 'inspect all relevant code' },
          { type: 'text', text: 'I will verify both paths.' },
          { type: 'tool_use', id: 'tool_read', name: 'read', input: { path: 'PRD.md' } },
          { type: 'tool_use', id: 'tool_grep', name: 'grep', input: { pattern: 'OLAP' } },
        ],
      },
    },
    {
      entryId: 'p0_results',
      parentId: 'p0_assistant',
      logicalId: 'logical_results',
      timestamp: '2026-07-29T13:42:40.552Z',
      turnId: 'turn_p0',
      type: 'message',
      active: false,
      message: {
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 'tool_read', content: 'prd' },
          { type: 'tool_result', tool_use_id: 'tool_grep', content: 'matches' },
        ],
      },
    },
    {
      entryId: 'opening_query',
      parentId: null,
      logicalId: 'opening_query',
      timestamp: '2026-07-29T13:10:45.165Z',
      type: 'message',
      active: false,
      message: { role: 'user', content: 'opening query' },
    },
    {
      entryId: 'retained_parent',
      parentId: 'opening_query',
      logicalId: 'retained_parent',
      timestamp: '2026-07-29T13:35:00.000Z',
      type: 'message',
      active: false,
      message: { role: 'assistant', content: 'retained predecessor' },
    },
    {
      entryId: 'rewind',
      parentId: 'retained_parent',
      logicalId: 'rewind',
      timestamp: '2026-07-29T13:35:29.458Z',
      type: 'rewind_marker',
      payload: {
        rewindTargetId: 'retained_parent',
        fromId: 'abandoned',
        truncatedCount: 1,
      },
      message: { role: 'system', content: 'rewound' },
    },
    {
      entryId: 'compaction',
      parentId: null,
      logicalId: 'compaction',
      timestamp: '2026-07-29T14:41:32.645Z',
      type: 'compaction',
      active: true,
      summary: 'summary',
      message: { role: 'system', content: 'summary' },
    },
    {
      entryId: 'p0_query_clone',
      parentId: 'compaction',
      logicalId: 'logical_p0',
      sourceEntryId: 'p0_query',
      timestamp: queryTimestamp,
      turnId: 'turn_p0',
      type: 'message',
      active: true,
      message: { role: 'user', content: 'P0 query' },
    },
    {
      entryId: 'p0_assistant_clone',
      parentId: 'p0_query_clone',
      logicalId: 'logical_assistant',
      sourceEntryId: 'p0_assistant',
      timestamp: '2026-07-29T13:42:40.287Z',
      turnId: 'turn_p0',
      type: 'message',
      active: true,
      message: rawAssistantBody(),
    },
    {
      entryId: 'p0_results_clone',
      parentId: 'p0_assistant_clone',
      logicalId: 'logical_results',
      sourceEntryId: 'p0_results',
      timestamp: '2026-07-29T13:42:40.552Z',
      turnId: 'turn_p0',
      type: 'message',
      active: true,
      message: rawResultBody(),
    },
  ];

  const out = dedupeTranscriptEntries(raw);
  assert.deepEqual(
    out.map((entry) => entry.entryId),
    ['opening_query', 'retained_parent', 'p0_query', 'p0_assistant', 'p0_results', 'compaction'],
  );
  const assistant = out.find((entry) => entry.entryId === 'p0_assistant');
  const results = out.find((entry) => entry.entryId === 'p0_results');
  assert.deepEqual(
    (assistant?.message?.content as Array<{ type: string; id?: string }>).map((block) => [
      block.type,
      block.id,
    ]),
    [
      ['thinking', undefined],
      ['text', undefined],
      ['tool_use', 'tool_read'],
      ['tool_use', 'tool_grep'],
    ],
  );
  assert.deepEqual(
    (results?.message?.content as Array<{ tool_use_id: string }>).map((block) => block.tool_use_id),
    ['tool_read', 'tool_grep'],
  );
  assert.equal(out.find((entry) => entry.entryId === 'p0_query')?.canonicalIndex, 2);
});

test('s_11 model: already-correct old island keeps originals and ambiguous legacy copies in place', () => {
  const timestamp = '2026-07-29T07:05:30.740Z';
  const raw = [
    {
      entryId: 'query_original',
      parentId: null,
      logicalId: 'query_original',
      timestamp,
      type: 'message',
      active: false,
      message: { role: 'user', content: '请移动过去' },
    },
    {
      entryId: 'answer_original',
      parentId: 'query_original',
      logicalId: 'answer_original',
      timestamp: '2026-07-29T07:05:31.000Z',
      type: 'message',
      active: false,
      message: { role: 'assistant', content: 'done' },
    },
    {
      entryId: 'compaction',
      parentId: null,
      logicalId: 'compaction',
      timestamp: '2026-07-29T07:06:50.278Z',
      type: 'compaction',
      active: true,
      summary: 'summary',
      message: { role: 'system', content: 'summary' },
    },
    {
      entryId: 'query_active_clone',
      parentId: 'compaction',
      logicalId: 'query_active_clone',
      timestamp,
      type: 'message',
      active: true,
      message: { role: 'user', content: '请移动过去' },
    },
    {
      entryId: 'answer_active_clone',
      parentId: 'query_active_clone',
      logicalId: 'answer_active_clone',
      timestamp: '2026-07-29T07:05:31.000Z',
      type: 'message',
      active: true,
      message: { role: 'assistant', content: 'done' },
    },
  ];
  assert.deepEqual(
    dedupeTranscriptEntries(raw).map((entry) => entry.entryId),
    [
      'query_original',
      'answer_original',
      'compaction',
      'query_active_clone',
      'answer_active_clone',
    ],
  );
});

test('s_ca model: an already-correct uncompacted transcript remains unchanged', () => {
  const raw = [
    {
      entryId: 'q1',
      parentId: null,
      logicalId: 'q1',
      type: 'message',
      active: true,
      message: { role: 'user', content: 'first' },
    },
    {
      entryId: 'a1',
      parentId: 'q1',
      logicalId: 'a1',
      type: 'message',
      active: true,
      message: { role: 'assistant', content: 'answer' },
    },
    {
      entryId: 'q2',
      parentId: 'a1',
      logicalId: 'q2',
      type: 'message',
      active: true,
      message: { role: 'user', content: 'last query' },
    },
  ];
  assert.deepEqual(
    dedupeTranscriptEntries(raw).map((entry) => entry.entryId),
    ['q1', 'a1', 'q2'],
  );
});

function rawAssistantBody() {
  return {
    role: 'assistant',
    content: [
      { type: 'thinking', thinking: 'inspect all relevant code' },
      { type: 'text', text: 'I will verify both paths.' },
      { type: 'tool_use', id: 'tool_read', name: 'read', input: { path: 'PRD.md' } },
      { type: 'tool_use', id: 'tool_grep', name: 'grep', input: { pattern: 'OLAP' } },
    ],
  };
}

function rawResultBody() {
  return {
    role: 'user',
    content: [
      { type: 'tool_result', tool_use_id: 'tool_read', content: 'prd' },
      { type: 'tool_result', tool_use_id: 'tool_grep', content: 'matches' },
    ],
  };
}
