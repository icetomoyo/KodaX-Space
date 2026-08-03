import assert from 'node:assert/strict';
import test from 'node:test';
import type { SessionHistoryItem } from '@kodax-space/space-ipc-schema';
import {
  limitSessionHistoryItems,
  limitSessionHistoryWithLocalNotices,
  MAX_RETAINED_LOCAL_NOTICES,
  MAX_RUNTIME_HISTORY_PAGE_ITEMS,
  MAX_SESSION_HISTORY_ITEMS,
  mergeLocalNoticeHistoryItems,
  pageSessionHistoryItems,
} from '../ipc/history-window.js';

function assistant(index: number): SessionHistoryItem {
  return { kind: 'assistant', text: `assistant-${index}` };
}

function user(content: string): SessionHistoryItem {
  return { kind: 'user', content };
}

function tool(index: number): SessionHistoryItem {
  return {
    kind: 'tool_call',
    toolId: `tool-${index}`,
    toolName: 'read',
    result: `result-${index}`,
  };
}

test('history window starts at the first complete user turn that fits', () => {
  const items: SessionHistoryItem[] = [
    ...Array.from({ length: 120 }, (_, index) => assistant(index)),
    user('first complete retained turn'),
    ...Array.from({ length: 50 }, (_, index) => assistant(120 + index)),
    user('newest turn'),
    ...Array.from({ length: 1_900 }, (_, index) => tool(index)),
  ];

  const window = limitSessionHistoryItems(items);

  assert.equal(window.length, 1_953);
  assert.deepEqual(window[0], {
    kind: 'history_truncation',
    scope: 'history',
    omittedItems: 120,
  });
  assert.deepEqual(window[1], user('first complete retained turn'));
  assert.deepEqual(window.at(-1), tool(1_899));
  assert.ok(window.some((item) => item.kind === 'user' && item.content === 'newest turn'));
});

test('oversized final turn retains its query, newest paired tools, and explicit gap markers', () => {
  const items: SessionHistoryItem[] = [
    user('old turn'),
    assistant(0),
    user('oversized turn query'),
    ...Array.from({ length: 2_100 }, (_, index) => tool(index)),
  ];

  const window = limitSessionHistoryItems(items);

  assert.equal(window.length, MAX_SESSION_HISTORY_ITEMS);
  assert.deepEqual(window.slice(0, 3), [
    { kind: 'history_truncation', scope: 'history', omittedItems: 2 },
    user('oversized turn query'),
    { kind: 'history_truncation', scope: 'turn', omittedItems: 103 },
  ]);
  assert.deepEqual(window[3], tool(103));
  assert.deepEqual(window.at(-1), tool(2_099));
  assert.ok(
    window.filter((item) => item.kind === 'tool_call').every((item) => item.result !== undefined),
  );
});

test('history without a user boundary keeps its newest tail and exposes prefix truncation', () => {
  const items = Array.from({ length: 2_100 }, (_, index) => assistant(index));

  const window = limitSessionHistoryItems(items);

  assert.equal(window.length, MAX_SESSION_HISTORY_ITEMS);
  assert.deepEqual(window[0], {
    kind: 'history_truncation',
    scope: 'history',
    omittedItems: 101,
  });
  assert.deepEqual(window[1], assistant(101));
  assert.deepEqual(window.at(-1), assistant(2_099));
});

test('history at or below the limit is preserved byte-for-byte in order', () => {
  const items: SessionHistoryItem[] = [user('query'), assistant(1), tool(1)];

  assert.deepEqual(limitSessionHistoryItems(items), items);
});

test('the exact IPC boundary is unchanged and the first overflow reserves its marker slot', () => {
  const exact = Array.from({ length: MAX_SESSION_HISTORY_ITEMS }, (_, index) => assistant(index));
  assert.deepEqual(limitSessionHistoryItems(exact), exact);

  const overflow = [...exact, assistant(MAX_SESSION_HISTORY_ITEMS)];
  const window = limitSessionHistoryItems(overflow);
  assert.equal(window.length, MAX_SESSION_HISTORY_ITEMS);
  assert.deepEqual(window[0], {
    kind: 'history_truncation',
    scope: 'history',
    omittedItems: 2,
  });
  assert.deepEqual(window[1], assistant(2));
  assert.deepEqual(window.at(-1), assistant(MAX_SESSION_HISTORY_ITEMS));
});

test('a full transcript reserves bounded space for durable Space-owned notices', () => {
  const base: SessionHistoryItem[] = [
    { kind: 'user', content: 'newest query', sentAt: 10_000 },
    ...Array.from({ length: MAX_SESSION_HISTORY_ITEMS - 1 }, (_, index) => tool(index)),
  ];
  const localNotices = [
    { id: 'old-slash', content: '/history', sentAt: 1_000, variant: 'echo' as const },
  ];

  const window = limitSessionHistoryWithLocalNotices(base, localNotices);
  assert.equal(window.length, MAX_SESSION_HISTORY_ITEMS);
  assert.deepEqual(window[0], {
    kind: 'local_notice',
    id: 'old-slash',
    content: '/history',
    sentAt: 1_000,
    variant: 'echo',
  });
  assert.deepEqual(window[1], base[0]);
  assert.ok(window.some((item) => item.kind === 'history_truncation' && item.scope === 'turn'));
  assert.deepEqual(window.at(-1), base.at(-1));
});

test('local notice reservation is capped and keeps only the newest notices', () => {
  const base: SessionHistoryItem[] = [
    { kind: 'user', content: 'query', sentAt: 1_000 },
    ...Array.from({ length: MAX_SESSION_HISTORY_ITEMS - 1 }, (_, index) => tool(index)),
  ];
  const localNotices = Array.from({ length: 40 }, (_, index) => ({
    id: `notice-${index}`,
    content: `notice ${index}`,
    sentAt: 2_000 + index,
    variant: 'output' as const,
  }));

  const window = limitSessionHistoryWithLocalNotices(base, localNotices);
  const retainedIds = window.flatMap((item) => (item.kind === 'local_notice' ? [item.id] : []));
  assert.equal(window.length, MAX_SESSION_HISTORY_ITEMS);
  assert.equal(retainedIds.length, MAX_RETAINED_LOCAL_NOTICES);
  assert.deepEqual(
    retainedIds,
    Array.from({ length: MAX_RETAINED_LOCAL_NOTICES }, (_, index) => `notice-${index + 8}`),
  );
});

test('side-store notices use remaining capacity and are inserted at display-time boundaries', () => {
  const base: SessionHistoryItem[] = [
    { kind: 'user', content: 'first query', sentAt: 1_000 },
    { kind: 'assistant', text: 'first answer', sentAt: 1_100 },
    { kind: 'user', content: 'second query', sentAt: 2_000 },
  ];
  const localNotices = [
    { id: 'newer', content: '[status] newer', sentAt: 1_500, variant: 'output' as const },
    { id: 'older', content: '/status', sentAt: 900, variant: 'echo' as const },
  ];

  assert.deepEqual(
    mergeLocalNoticeHistoryItems(base, localNotices).map((item) =>
      item.kind === 'local_notice' ? item.id : item.kind,
    ),
    ['older', 'user', 'assistant', 'newer', 'user'],
  );
});

test('runtime projection paging keeps every item reachable when one canonical entry expands past the IPC cap', () => {
  const source: SessionHistoryItem[] = [
    user('oversized turn'),
    ...Array.from({ length: 2_100 }, (_, index) => tool(index)),
  ];
  const visited: SessionHistoryItem[] = [];
  let endExclusive: number | undefined;
  do {
    const page = pageSessionHistoryItems(source, endExclusive ?? source.length);
    assert.ok(page.items.length <= MAX_RUNTIME_HISTORY_PAGE_ITEMS);
    visited.unshift(...page.items.filter((item) => item.kind !== 'history_truncation'));
    endExclusive = page.nextEndExclusive;
  } while (endExclusive !== undefined);

  assert.deepEqual(visited, source);
});
