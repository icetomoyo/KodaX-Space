import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const conversationStream = readFileSync(
  new URL('../../renderer/src/shell/ConversationStreamV2.tsx', import.meta.url),
  'utf8',
);
const bubbles = readFileSync(
  new URL('../../renderer/src/features/session/messages/bubbles.tsx', import.meta.url),
  'utf8',
);
const messages = readFileSync(
  new URL('../../renderer/src/i18n/messages.ts', import.meta.url),
  'utf8',
);

test('history paging uses an independent loading and retry status', () => {
  assert.match(
    conversationStream,
    /function HistoryPagingSentinel\(/,
    'paging feedback must not depend on a truncation row being present',
  );
  assert.match(
    conversationStream,
    /HistoryPagingSentinel[\s\S]*LoaderCircle[\s\S]*animate-spin/,
    'the history loading state must render an animated spinner',
  );
  assert.match(
    conversationStream,
    /olderHistoryFeedback\?\.phase !== 'loading'[\s\S]*lineageKind === 'history_truncation'[\s\S]*historyTruncationScope === 'history'/,
    'the loading spinner must temporarily replace the persisted older-history boundary notice',
  );
  assert.match(
    conversationStream,
    /historyPaging\.phase === 'loading'[\s\S]*lineageKind === 'history_truncation'[\s\S]*historyBoundaryLoading/,
    'initial and automatic history reads must also replace a painted truncation notice with loading feedback',
  );
  assert.match(
    conversationStream,
    /conversation\.historyLoadFailed[\s\S]*message\.action\.retry/,
    'a failed older-page read must be visible and retryable',
  );
  assert.match(
    conversationStream,
    /historyPaging\.phase === 'error'[\s\S]*restoreNewestSessionHistory/,
    'a failed newest revalidation must remain visible and retryable above stable history',
  );
  assert.doesNotMatch(
    bubbles,
    /historyLoading|isLoadingHistory/,
    'ordinary persisted truncation notices must remain historical facts outside the paging view',
  );
  assert.match(messages, /'session\.loadingEarlierHistory': 'Loading earlier history…'/);
  assert.match(messages, /'session\.loadingEarlierHistory': '正在加载较早的历史内容…'/);
  assert.match(
    messages,
    /'session\.waitingForHistoryRuntime': 'Waiting for Runtime to restore history…'/,
  );
  assert.match(messages, /'session\.waitingForHistoryRuntime': '正在等待 Runtime 恢复历史内容…'/);
  assert.match(
    conversationStream,
    /phase: 'loading' \| 'waiting' \| 'error'[\s\S]*session\.waitingForHistoryRuntime/,
    'Runtime backoff must remain an explicit history state instead of reverting to omission text',
  );
});
