import assert from 'node:assert/strict';
import test from 'node:test';

import {
  clampTextWithMarker,
  collectLeadingTurnTailBoundary,
  collectCrossPageToolResults,
  collectCrossPageTurnBoundaries,
  consumeRuntimePresentationContinuation,
  conversationHistoryAsTranscript,
  truncateLocalNoticesAfterSuccessfulRewind,
} from '../ipc/session.js';
import { MAX_RUNTIME_HISTORY_PAGE_ITEMS, pageSessionHistoryItems } from '../ipc/history-window.js';
import type { SessionHistoryItem } from '@kodax-space/space-ipc-schema';

test('history truncation marker stays inside the IPC schema character budget', () => {
  const marker = '\n[truncated]';
  const result = clampTextWithMarker('x'.repeat(101), 100, marker);

  assert.equal(result.length, 100);
  assert.ok(result.endsWith(marker));
});

test('history truncation preserves text already inside the budget', () => {
  assert.equal(clampTextWithMarker('unchanged', 100), 'unchanged');
});

test('history truncation also bounds a marker larger than the whole budget', () => {
  assert.equal(clampTextWithMarker('too long', 4, '[truncated]'), '[tru');
  assert.equal(clampTextWithMarker('too long', 0, '[truncated]'), '');
});

test('conversation page seam preserves an exact tool result split after the 64th entry', () => {
  const olderMessages = [
    ...Array.from({ length: 63 }, (_, index) => ({
      role: 'assistant',
      content: `answer-${index}`,
    })),
    {
      role: 'assistant',
      content: [{ type: 'tool_use', id: 'tool-at-page-seam', name: 'read', input: {} }],
    },
  ];
  const newerMessages = [
    {
      role: 'user',
      content: [
        {
          type: 'tool_result',
          tool_use_id: 'tool-at-page-seam',
          content: 'exact result after page seam',
        },
      ],
    },
    { role: 'assistant', content: 'final answer' },
  ];

  assert.deepEqual(
    collectCrossPageToolResults(olderMessages, newerMessages).get('tool-at-page-seam'),
    {
      content: 'exact result after page seam',
      isError: false,
    },
  );
});

test('conversation page seam preserves the exact boundary when a user is split from its tail', () => {
  const olderEntries: Parameters<typeof collectCrossPageTurnBoundaries>[0] = [
    {
      index: 63,
      entry: {
        boundaryId: 'user-at-page-seam',
        auditEntryIds: ['user-at-page-seam'],
        message: { role: 'user', content: 'query split from its answer' },
      },
    },
  ];
  const newerEntries: Parameters<typeof collectCrossPageTurnBoundaries>[1] = [
    {
      index: 64,
      entry: {
        boundaryId: 'assistant-tool-use',
        auditEntryIds: ['assistant-tool-use'],
        message: {
          role: 'assistant',
          content: [{ type: 'tool_use', id: 'tool-1', name: 'read', input: {} }],
        },
      },
    },
    {
      index: 65,
      entry: {
        boundaryId: 'tool-result',
        auditEntryIds: ['tool-result'],
        message: {
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: 'tool-1', content: 'ok' }],
        },
      },
    },
    {
      index: 66,
      entry: {
        boundaryId: 'assistant-final',
        auditEntryIds: ['assistant-final'],
        message: { role: 'assistant', content: 'answer complete' },
      },
    },
    {
      index: 67,
      entry: {
        boundaryId: 'next-user',
        auditEntryIds: ['next-user'],
        message: { role: 'user', content: 'next query' },
      },
    },
  ];

  assert.deepEqual(
    [...collectCrossPageTurnBoundaries(olderEntries, newerEntries, 'source-seam')],
    [
      [
        63,
        {
          boundaryId: 'assistant-final',
          sourceRevision: 'source-seam',
        },
      ],
    ],
  );

  const seamBoundaries = collectCrossPageTurnBoundaries(olderEntries, newerEntries, 'source-seam');
  const history: Parameters<typeof conversationHistoryAsTranscript>[0] = {
    revision: 'revision-seam',
    sourceRevision: 'source-seam',
    status: 'resolved',
    issues: [],
    entries: olderEntries.map(({ entry }) => entry),
  };
  const transcript = conversationHistoryAsTranscript(
    history,
    olderEntries,
    olderEntries,
    false,
    seamBoundaries,
  );
  assert.deepEqual(transcript.transcriptEntries[0]?.historyBoundary, {
    boundaryId: 'assistant-final',
    sourceRevision: 'source-seam',
  });
});

test('conversation page seam carries an exact visible-turn tail across three SDK pages', () => {
  type IndexedEntry = Parameters<typeof collectLeadingTurnTailBoundary>[0][number];
  const entry = (
    index: number,
    boundaryId: string,
    message: IndexedEntry['entry']['message'],
  ): IndexedEntry => ({
    index,
    entry: { boundaryId, auditEntryIds: [boundaryId], message },
  });
  const oldestPage: IndexedEntry[] = [
    entry(62, 'user-three-page', { role: 'user', content: 'long-running query' }),
    entry(63, 'assistant-page-one', { role: 'assistant', content: 'page one tail' }),
  ];
  const middlePage: IndexedEntry[] = Array.from({ length: 64 }, (_, offset) =>
    entry(64 + offset, `assistant-page-two-${offset}`, {
      role: 'assistant',
      content: `page two tail ${offset}`,
    }),
  );
  const newestPage: IndexedEntry[] = [
    entry(128, 'assistant-exact-final', { role: 'assistant', content: 'final answer' }),
    entry(129, 'next-visible-user', { role: 'user', content: 'next query' }),
  ];
  const sourceRevision = 'source-three-page';

  const newestPrefix = collectLeadingTurnTailBoundary(newestPage, sourceRevision);
  assert.deepEqual(newestPrefix, {
    boundaryId: 'assistant-exact-final',
    sourceRevision,
  });
  const middleAndNewestPrefix = collectLeadingTurnTailBoundary(
    middlePage,
    sourceRevision,
    newestPrefix,
  );
  assert.strictEqual(
    middleAndNewestPrefix,
    newestPrefix,
    'a user-free middle page must carry the farther exact boundary instead of its local tail',
  );

  const seamBoundaries = collectCrossPageTurnBoundaries(
    oldestPage,
    middlePage,
    sourceRevision,
    middleAndNewestPrefix,
  );
  assert.deepEqual(
    [...seamBoundaries],
    [
      [
        62,
        {
          boundaryId: 'assistant-exact-final',
          sourceRevision,
        },
      ],
    ],
  );

  const history: Parameters<typeof conversationHistoryAsTranscript>[0] = {
    revision: 'revision-three-page',
    sourceRevision,
    status: 'resolved',
    issues: [],
    entries: oldestPage.map(({ entry: value }) => value),
  };
  const transcript = conversationHistoryAsTranscript(
    history,
    oldestPage,
    oldestPage,
    false,
    seamBoundaries,
  );
  assert.deepEqual(transcript.transcriptEntries[0]?.historyBoundary, {
    boundaryId: 'assistant-exact-final',
    sourceRevision,
  });
});

test('same-page projection continuation retains a huge turn query exact boundary', () => {
  const sourceRevision = 'source-large-single-turn';
  const toolBlocks = Array.from({ length: MAX_RUNTIME_HISTORY_PAGE_ITEMS + 1 }, (_, index) => ({
    type: 'tool_use' as const,
    id: `large-turn-tool-${index}`,
    name: 'read',
    input: { index },
  }));
  const indexedEntries: Parameters<typeof conversationHistoryAsTranscript>[1] = [
    {
      index: 0,
      entry: {
        boundaryId: 'large-turn-user',
        auditEntryIds: ['large-turn-user'],
        message: { role: 'user', content: 'query before a very large single assistant entry' },
      },
    },
    {
      index: 1,
      entry: {
        boundaryId: 'large-turn-exact-tail',
        auditEntryIds: ['large-turn-exact-tail'],
        message: { role: 'assistant', content: toolBlocks },
      },
    },
  ];
  const itemCount = 1 + toolBlocks.length;
  const newestSlice = pageSessionHistoryItems([
    { kind: 'user', content: 'query' },
    ...toolBlocks.map(
      (block): SessionHistoryItem => ({
        kind: 'tool_call',
        toolId: block.id,
        toolName: block.name,
        input: block.input,
      }),
    ),
  ]);
  assert.ok(newestSlice.nextEndExclusive !== undefined);

  const windowState = {
    newerSdkPageOmitted: false,
    projectionContinuation: {
      cursor: 'space-projection:large-turn',
      endExclusive: newestSlice.nextEndExclusive,
      itemCount,
    },
  };
  const continuation = consumeRuntimePresentationContinuation(
    windowState,
    'space-projection:large-turn',
  );
  assert.deepEqual(continuation, {
    endExclusive: newestSlice.nextEndExclusive,
    itemCount,
  });
  assert.equal(
    windowState.newerSdkPageOmitted,
    false,
    'a Space slice of one SDK page must not masquerade as an omitted newer SDK page',
  );

  const history: Parameters<typeof conversationHistoryAsTranscript>[0] = {
    revision: 'revision-large-single-turn',
    sourceRevision,
    status: 'resolved',
    issues: [],
    entries: indexedEntries.map(({ entry }) => entry),
  };
  const transcript = conversationHistoryAsTranscript(
    history,
    indexedEntries,
    indexedEntries,
    !windowState.newerSdkPageOmitted,
  );
  const queryBoundary = transcript.transcriptEntries[0]?.historyBoundary;
  assert.deepEqual(queryBoundary, {
    boundaryId: 'large-turn-exact-tail',
    sourceRevision,
  });

  const projectedItems: SessionHistoryItem[] = [
    {
      kind: 'user',
      content: 'query before a very large single assistant entry',
      ...(queryBoundary !== undefined ? { historyBoundary: queryBoundary } : {}),
    },
    ...toolBlocks.map((block) => ({
      kind: 'tool_call' as const,
      toolId: block.id,
      toolName: block.name,
      input: block.input,
    })),
  ];
  const olderSlice = pageSessionHistoryItems(projectedItems, continuation!.endExclusive);
  const restoredQuery = olderSlice.items.find((item) => item.kind === 'user');
  assert.deepEqual(restoredQuery?.historyBoundary, {
    boundaryId: 'large-turn-exact-tail',
    sourceRevision,
  });
});

test('rewind truncates main-owned notices only after a successful durable mutation', async () => {
  const calls: Array<{ readonly sessionId: string; readonly cutoffSentAt: number }> = [];
  const store = {
    truncateBefore: async (sessionId: string, cutoffSentAt: number) => {
      calls.push({ sessionId, cutoffSentAt });
    },
  };
  const input = { sessionId: 's_rewind', localNoticeCutoffSentAt: 2_000 };

  await truncateLocalNoticesAfterSuccessfulRewind(input, { ok: false }, store);
  await truncateLocalNoticesAfterSuccessfulRewind(input, { ok: true, diskRewound: false }, store);
  await truncateLocalNoticesAfterSuccessfulRewind(
    { sessionId: input.sessionId },
    { ok: true, diskRewound: true },
    store,
  );
  assert.deepEqual(calls, []);

  await truncateLocalNoticesAfterSuccessfulRewind(input, { ok: true, diskRewound: true }, store);
  assert.deepEqual(calls, [{ sessionId: 's_rewind', cutoffSentAt: 2_000 }]);
});
