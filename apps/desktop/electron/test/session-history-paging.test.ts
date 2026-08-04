import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { useAppStore } from '../../renderer/src/store/appStore.js';
import { composeMessages } from '../../renderer/src/features/session/composeMessages.js';
import { messageForSelectorTurn } from '../../renderer/src/features/session/turnIndex.js';
import {
  activateSessionHistoryPaging,
  deactivateSessionHistoryPaging,
  hasReadySessionHistory,
  historyPhaseAllowsRuntimeObservation,
  invalidateSessionHistoryPaging,
  loadOlderSessionHistory,
  olderHistoryWindowSeamScrollTop,
  PREPEND_ANCHOR_CORRECTION_FRAME_OFFSETS,
  preservesPrependAnchorForBoundaryInput,
  revalidateNewestSessionHistory,
  resetSessionHistoryPagingLifecycle,
  restoreNewestSessionHistory,
  sessionEventInvalidatesHistoryCache,
  sessionHistoryPagingSnapshot,
} from '../../renderer/src/shell/sessionHistoryPaging.js';

const originalWindow = globalThis.window;

function mockHistoryInvoke<T extends (...args: never[]) => unknown>(handler: T) {
  return async (channel: string, input: unknown) => {
    const invoke = handler as unknown as (...args: readonly unknown[]) => unknown;
    const result = (await invoke(channel, input)) as {
      readonly ok: boolean;
      readonly data?: Readonly<Record<string, unknown>>;
      readonly [key: string]: unknown;
    };
    if (!result.ok || result.data === undefined) return result;
    const owner = input as { readonly sessionId: string; readonly requestId: string };
    return {
      ...result,
      data: {
        ...result.data,
        sessionId: owner.sessionId,
        requestId: owner.requestId,
      },
    };
  };
}

function withoutHistoryRequestId(input: unknown): Readonly<Record<string, unknown>> {
  const owned = input as Readonly<Record<string, unknown>>;
  assert.equal(typeof owned.requestId, 'string');
  const { requestId: _requestId, ...rest } = owned;
  return rest;
}

afterEach(() => {
  for (const sessionId of [
    'history-paging-resync',
    'history-paging-large-turn',
    'history-paging-leading-partial',
    'history-paging-runtime-startup',
    'history-paging-deactivate',
    'history-paging-reactivate',
    'history-paging-same-turn',
    'history-paging-live-window',
    'history-paging-uncertain-cache',
    'history-paging-invalidated-cache',
    'history-paging-invalidation-race',
    'history-paging-invalidated-continuation',
    'history-paging-warning-race',
    'history-paging-active-warning-refresh',
    'history-paging-foreign-owner',
  ]) {
    deactivateSessionHistoryPaging(sessionId);
  }
  resetSessionHistoryPagingLifecycle();
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    writable: true,
    value: originalWindow,
  });
});

test('history response with foreign Session/request ownership is rejected before store install', async () => {
  const sessionId = 'history-paging-foreign-owner';
  useAppStore.setState({
    sessions: [
      {
        sessionId,
        projectRoot: '/project',
        provider: 'mock',
        reasoningMode: 'auto',
        permissionMode: 'accept-edits',
        autoModeEngine: 'llm',
        agentMode: 'ama',
        surface: 'code',
        createdAt: 1_000,
        lastActivityAt: 1_000,
      },
    ],
    currentSessionId: sessionId,
    eventsBySession: {},
    userMessagesBySession: {},
  });
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    writable: true,
    value: {
      kodaxSpace: {
        invoke: async () => ({
          ok: true as const,
          data: {
            sessionId: 'foreign-session',
            requestId: 'foreign-request',
            items: [{ kind: 'user' as const, content: 'must never be installed' }],
            page: {
              outcome: 'ready' as const,
              revision: 'foreign-revision',
              sourceRevision: 'foreign-source',
              hasMore: false,
              windowMode: 'replace' as const,
              hasNewer: false,
            },
          },
        }),
      },
    },
  });

  await assert.rejects(
    restoreNewestSessionHistory(sessionId, 'code'),
    /history response ownership mismatch/i,
  );
  assert.equal(sessionHistoryPagingSnapshot(sessionId).phase, 'error');
  assert.deepEqual(useAppStore.getState().userMessagesBySession[sessionId] ?? [], []);
});

test('resetSessionView synchronously clears paging authority and the independent live baseline', async () => {
  const sessionId = 'history-paging-project-reset';
  const session = {
    sessionId,
    projectRoot: '/project-a',
    provider: 'mock',
    reasoningMode: 'auto' as const,
    permissionMode: 'accept-edits' as const,
    autoModeEngine: 'llm' as const,
    agentMode: 'ama' as const,
    surface: 'code' as const,
    createdAt: 1_000,
    lastActivityAt: 1_000,
  };
  useAppStore.setState({
    sessions: [session],
    currentSessionId: sessionId,
    eventsBySession: {},
    userMessagesBySession: {},
  });
  let calls = 0;
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    writable: true,
    value: {
      kodaxSpace: {
        invoke: mockHistoryInvoke(async () => {
          calls += 1;
          return {
            ok: true as const,
            data: {
              items: [
                {
                  kind: 'user' as const,
                  content: calls === 1 ? 'project A canonical' : 'project B canonical',
                  canonicalIndex: 0,
                },
              ],
              page: {
                outcome: 'ready' as const,
                revision: `revision-${calls}`,
                sourceRevision: `source-${calls}`,
                hasMore: false as const,
                windowMode: 'replace' as const,
                hasNewer: false as const,
              },
            },
          };
        }),
      },
    },
  });

  await restoreNewestSessionHistory(sessionId, 'code');
  useAppStore.getState().appendUserMessage(sessionId, 'project A live tail', 2_000);
  assert.equal(hasReadySessionHistory(sessionId), true);

  useAppStore.getState().resetSessionView();
  assert.deepEqual(sessionHistoryPagingSnapshot(sessionId), { phase: 'idle', hasMore: false });
  assert.equal(hasReadySessionHistory(sessionId), false);

  useAppStore.setState({
    sessions: [{ ...session, projectRoot: '/project-b' }],
    currentSessionId: sessionId,
  });
  useAppStore.getState().appendUserMessage(sessionId, 'project B live tail', 3_000);
  await restoreNewestSessionHistory(sessionId, 'code');

  assert.equal(calls, 2);
  assert.deepEqual(
    (useAppStore.getState().userMessagesBySession[sessionId] ?? []).map(
      (message) => message.content,
    ),
    ['project B canonical', 'project B live tail'],
  );
});

test('lossless history ids distinguish a former 32-bit collision and preserve large indexes', () => {
  const sessionId = 'history-id-collision';
  useAppStore.setState({
    sessions: [
      {
        sessionId,
        projectRoot: '/project',
        provider: 'mock',
        reasoningMode: 'auto',
        permissionMode: 'accept-edits',
        autoModeEngine: 'llm',
        agentMode: 'ama',
        surface: 'code',
        createdAt: 1_000,
        lastActivityAt: 1_000,
      },
    ],
    currentSessionId: sessionId,
    eventsBySession: {},
    userMessagesBySession: {},
  });

  // FNV-1a-32("canonical:5372657") === FNV-1a-32("canonical:9076142").
  useAppStore.getState().prependSessionHistory(
    sessionId,
    [
      { kind: 'user', content: 'first colliding turn', canonicalIndex: 5_372_657 },
      { kind: 'user', content: 'second colliding turn', canonicalIndex: 9_076_142 },
    ],
    1_000,
    { replaceLoadedWindow: true },
  );

  const users = useAppStore.getState().userMessagesBySession[sessionId] ?? [];
  assert.equal(users.length, 2);
  assert.notEqual(users[0]?.id, users[1]?.id);
  assert.match(users[0]?.id ?? '', /5372657/);
  assert.match(users[1]?.id ?? '', /9076142/);
});

test('ready history revalidates on reactivation without blanking or accepting a stale generation', async () => {
  const sessionId = 'history-paging-ready-revalidation';
  useAppStore.setState({
    sessions: [
      {
        sessionId,
        projectRoot: '/project',
        provider: 'mock',
        reasoningMode: 'auto',
        permissionMode: 'accept-edits',
        autoModeEngine: 'llm',
        agentMode: 'ama',
        surface: 'code',
        createdAt: 1_000,
        lastActivityAt: 1_000,
      },
    ],
    currentSessionId: sessionId,
    eventsBySession: {},
    userMessagesBySession: {},
  });
  type ReadyResponse = {
    ok: true;
    data: {
      items: Array<{ kind: 'user'; content: string; canonicalIndex: number }>;
      page: {
        outcome: 'ready';
        revision: string;
        sourceRevision: string;
        hasMore: false;
        windowMode: 'replace';
        hasNewer: false;
      };
    };
  };
  let resolveStale!: (response: ReadyResponse) => void;
  let resolveFresh!: (response: ReadyResponse) => void;
  const stale = new Promise<ReadyResponse>((resolve) => {
    resolveStale = resolve;
  });
  const fresh = new Promise<ReadyResponse>((resolve) => {
    resolveFresh = resolve;
  });
  let calls = 0;
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    writable: true,
    value: {
      kodaxSpace: {
        invoke: mockHistoryInvoke(async () => {
          calls += 1;
          if (calls === 1) {
            return {
              ok: true as const,
              data: {
                items: [{ kind: 'user' as const, content: 'cached', canonicalIndex: 0 }],
                page: {
                  outcome: 'ready' as const,
                  revision: 'revision-cached',
                  sourceRevision: 'source-cached',
                  hasMore: false as const,
                  windowMode: 'replace' as const,
                  hasNewer: false as const,
                },
              },
            };
          }
          return calls === 2 ? stale : fresh;
        }),
      },
    },
  });

  await restoreNewestSessionHistory(sessionId, 'code');
  deactivateSessionHistoryPaging(sessionId);
  activateSessionHistoryPaging(sessionId);
  const staleRevalidation = revalidateNewestSessionHistory(sessionId, 'code');
  assert.equal(sessionHistoryPagingSnapshot(sessionId).phase, 'ready');
  assert.equal(useAppStore.getState().userMessagesBySession[sessionId]?.[0]?.content, 'cached');

  deactivateSessionHistoryPaging(sessionId);
  activateSessionHistoryPaging(sessionId);
  const freshRevalidation = revalidateNewestSessionHistory(sessionId, 'code');
  const response = (content: string, revision: string): ReadyResponse => ({
    ok: true,
    data: {
      items: [{ kind: 'user', content, canonicalIndex: 0 }],
      page: {
        outcome: 'ready',
        revision,
        sourceRevision: revision,
        hasMore: false,
        windowMode: 'replace',
        hasNewer: false,
      },
    },
  });
  resolveFresh(response('fresh external mutation', 'revision-fresh'));
  await freshRevalidation;
  resolveStale(response('stale external mutation', 'revision-stale'));
  await staleRevalidation;

  assert.equal(calls, 3);
  assert.equal(sessionHistoryPagingSnapshot(sessionId).sourceRevision, 'revision-fresh');
  assert.equal(
    useAppStore.getState().userMessagesBySession[sessionId]?.[0]?.content,
    'fresh external mutation',
  );
});

test('older bounded windows restore at their newest edge when no DOM anchor survives', () => {
  assert.equal(olderHistoryWindowSeamScrollTop(4_000, 800), 3_200);
  assert.equal(olderHistoryWindowSeamScrollTop(600, 800), 0);
});

test('prepend anchor correction remains sparse but covers delayed occlusion layout', () => {
  assert.deepEqual(PREPEND_ANCHOR_CORRECTION_FRAME_OFFSETS, [0, 1, 2, 4, 6, 9, 13, 18, 24, 32]);
});

test('only an upward no-movement boundary gesture preserves an active prepend restoration', () => {
  assert.equal(preservesPrependAnchorForBoundaryInput('restoring', true, 0), true);
  assert.equal(preservesPrependAnchorForBoundaryInput('restoring', true, 1), true);
  assert.equal(preservesPrependAnchorForBoundaryInput('restoring', true, 2), false);
  assert.equal(preservesPrependAnchorForBoundaryInput('restoring', false, 0), false);
  assert.equal(preservesPrependAnchorForBoundaryInput('loading', true, 0), false);
  assert.equal(preservesPrependAnchorForBoundaryInput(undefined, true, 0), false);
});

test('Runtime observation waits for the canonical history activation to settle', () => {
  assert.equal(historyPhaseAllowsRuntimeObservation('idle'), false);
  assert.equal(historyPhaseAllowsRuntimeObservation('waiting'), false);
  assert.equal(historyPhaseAllowsRuntimeObservation('loading'), false);
  assert.equal(historyPhaseAllowsRuntimeObservation('ready'), true);
  assert.equal(historyPhaseAllowsRuntimeObservation('error'), true);
});

test('only canonical persistence-boundary events invalidate cached history', () => {
  assert.equal(sessionEventInvalidatesHistoryCache('session_complete'), true);
  assert.equal(sessionEventInvalidatesHistoryCache('session_error'), true);
  assert.equal(sessionEventInvalidatesHistoryCache('lineage_notice'), true);
  assert.equal(sessionEventInvalidatesHistoryCache('text_delta'), false);
  assert.equal(sessionEventInvalidatesHistoryCache('tool_result'), false);
});

test('partial or ambiguous conversation diagnostics are never treated as reusable cache authority', async () => {
  const sessionId = 'history-paging-uncertain-cache';
  useAppStore.setState({
    sessions: [],
    currentSessionId: sessionId,
    eventsBySession: {},
    userMessagesBySession: {},
  });
  let call = 0;
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    writable: true,
    value: {
      kodaxSpace: {
        invoke: mockHistoryInvoke(async () => {
          call += 1;
          return {
            ok: true as const,
            data: {
              items: [],
              conversation: { status: call === 1 ? ('partial' as const) : ('resolved' as const) },
              page: {
                outcome: 'ready' as const,
                revision: `revision-${call}`,
                sourceRevision: `source-${call}`,
                hasMore: false,
                windowMode: 'replace' as const,
                hasNewer: false,
              },
            },
          };
        }),
      },
    },
  });

  await restoreNewestSessionHistory(sessionId, 'code');
  assert.equal(hasReadySessionHistory(sessionId), false);
  deactivateSessionHistoryPaging(sessionId);
  await restoreNewestSessionHistory(sessionId, 'code');
  assert.equal(call, 2);
  assert.equal(hasReadySessionHistory(sessionId), true);
});

test('a persistence boundary makes an otherwise ready page ineligible for reuse', async () => {
  const sessionId = 'history-paging-invalidated-cache';
  useAppStore.setState({
    sessions: [],
    currentSessionId: sessionId,
    eventsBySession: {},
    userMessagesBySession: {},
  });
  let calls = 0;
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    writable: true,
    value: {
      kodaxSpace: {
        invoke: mockHistoryInvoke(async () => {
          calls += 1;
          return {
            ok: true as const,
            data: {
              items: [],
              conversation: { status: 'resolved' as const },
              page: {
                outcome: 'ready' as const,
                revision: `revision-${calls}`,
                sourceRevision: `source-${calls}`,
                hasMore: false,
                windowMode: 'replace' as const,
                hasNewer: false,
              },
            },
          };
        }),
      },
    },
  });

  await restoreNewestSessionHistory(sessionId, 'code');
  assert.equal(hasReadySessionHistory(sessionId), true);
  invalidateSessionHistoryPaging(sessionId);
  assert.equal(hasReadySessionHistory(sessionId), false);
  deactivateSessionHistoryPaging(sessionId);
  await restoreNewestSessionHistory(sessionId, 'code');
  assert.equal(calls, 2);
  assert.equal(hasReadySessionHistory(sessionId), true);
});

test('a persistence boundary racing an IPC read rejects the stale page and retries newest', async () => {
  const sessionId = 'history-paging-invalidation-race';
  useAppStore.setState({
    sessions: [
      {
        sessionId,
        projectRoot: '/project',
        provider: 'mock',
        reasoningMode: 'auto',
        permissionMode: 'accept-edits',
        autoModeEngine: 'llm',
        agentMode: 'ama',
        surface: 'code',
        createdAt: 1_000,
        lastActivityAt: 1_000,
      },
    ],
    currentSessionId: sessionId,
    eventsBySession: {},
    userMessagesBySession: {},
  });
  let calls = 0;
  let resolveStale!: (value: {
    ok: true;
    data: {
      items: Array<{ kind: 'user'; content: string }>;
      conversation: { status: 'resolved' };
      page: {
        outcome: 'ready';
        revision: string;
        sourceRevision: string;
        hasMore: false;
        windowMode: 'replace';
        hasNewer: false;
      };
    };
  }) => void;
  const staleResponse = new Promise<Parameters<typeof resolveStale>[0]>((resolve) => {
    resolveStale = resolve;
  });
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    writable: true,
    value: {
      kodaxSpace: {
        invoke: mockHistoryInvoke(async () => {
          calls += 1;
          if (calls === 1) return staleResponse;
          return {
            ok: true as const,
            data: {
              items: [{ kind: 'user' as const, content: 'fresh query' }],
              conversation: { status: 'resolved' as const },
              page: {
                outcome: 'ready' as const,
                revision: 'revision-fresh',
                sourceRevision: 'source-fresh',
                hasMore: false as const,
                windowMode: 'replace' as const,
                hasNewer: false as const,
              },
            },
          };
        }),
      },
    },
  });

  const initial = restoreNewestSessionHistory(sessionId, 'code');
  invalidateSessionHistoryPaging(sessionId);
  resolveStale({
    ok: true,
    data: {
      items: [{ kind: 'user', content: 'stale query' }],
      conversation: { status: 'resolved' },
      page: {
        outcome: 'ready',
        revision: 'revision-stale',
        sourceRevision: 'source-stale',
        hasMore: false,
        windowMode: 'replace',
        hasNewer: false,
      },
    },
  });
  await initial;
  const deadline = Date.now() + 2_000;
  while (calls < 2 && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  assert.equal(calls, 2);
  assert.equal(sessionHistoryPagingSnapshot(sessionId).sourceRevision, 'source-fresh');
  assert.deepEqual(
    useAppStore.getState().userMessagesBySession[sessionId]?.map((message) => message.content),
    ['fresh query'],
  );
});

test('an invalidated older-page request restarts at newest instead of certifying the old snapshot', async () => {
  const sessionId = 'history-paging-invalidated-continuation';
  useAppStore.setState({
    sessions: [
      {
        sessionId,
        projectRoot: '/project',
        provider: 'mock',
        reasoningMode: 'auto',
        permissionMode: 'accept-edits',
        autoModeEngine: 'llm',
        agentMode: 'ama',
        surface: 'code',
        createdAt: 1_000,
        lastActivityAt: 1_000,
      },
    ],
    currentSessionId: sessionId,
    eventsBySession: {},
    userMessagesBySession: {},
  });
  const inputs: unknown[] = [];
  const pages = [
    {
      items: [{ kind: 'user' as const, content: 'old newest' }],
      conversation: { status: 'resolved' as const },
      page: {
        outcome: 'ready' as const,
        revision: 'old-revision',
        sourceRevision: 'old-source',
        hasMore: true,
        nextCursor: 'old-cursor',
        windowMode: 'replace' as const,
        hasNewer: false,
      },
    },
    {
      items: [{ kind: 'user' as const, content: 'fresh newest' }],
      conversation: { status: 'resolved' as const },
      page: {
        outcome: 'ready' as const,
        revision: 'fresh-revision',
        sourceRevision: 'fresh-source',
        hasMore: false,
        windowMode: 'replace' as const,
        hasNewer: false,
      },
    },
  ];
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    writable: true,
    value: {
      kodaxSpace: {
        invoke: mockHistoryInvoke(async (_channel: string, input: unknown) => {
          inputs.push(input);
          return { ok: true as const, data: pages[inputs.length - 1]! };
        }),
      },
    },
  });

  await restoreNewestSessionHistory(sessionId, 'code');
  invalidateSessionHistoryPaging(sessionId);
  await loadOlderSessionHistory(sessionId);

  assert.deepEqual(inputs.map(withoutHistoryRequestId), [
    { sessionId, expectedSurface: 'code' },
    { sessionId, expectedSurface: 'code' },
  ]);
  assert.deepEqual(sessionHistoryPagingSnapshot(sessionId), {
    phase: 'ready',
    surface: 'code',
    revision: 'fresh-revision',
    sourceRevision: 'fresh-source',
    hasMore: false,
    hasNewer: false,
    conversationStatus: 'resolved',
  });
  assert.equal(hasReadySessionHistory(sessionId), true);
  assert.deepEqual(
    useAppStore.getState().userMessagesBySession[sessionId]?.map((message) => message.content),
    ['fresh newest'],
  );
});

test('an uncertain warning remains visible while a raced refresh waits for Runtime', async () => {
  const sessionId = 'history-paging-warning-race';
  useAppStore.setState({
    sessions: [
      {
        sessionId,
        projectRoot: '/project',
        provider: 'mock',
        reasoningMode: 'auto',
        permissionMode: 'accept-edits',
        autoModeEngine: 'llm',
        agentMode: 'ama',
        surface: 'code',
        createdAt: 1_000,
        lastActivityAt: 1_000,
      },
    ],
    currentSessionId: sessionId,
    eventsBySession: {},
    userMessagesBySession: {},
  });
  let calls = 0;
  let resolveRaced!: (value: {
    ok: true;
    data: {
      items: Array<{ kind: 'user'; content: string }>;
      conversation: { status: 'partial' };
      page: {
        outcome: 'ready';
        revision: string;
        sourceRevision: string;
        hasMore: false;
        windowMode: 'replace';
        hasNewer: false;
      };
    };
  }) => void;
  const racedResponse = new Promise<Parameters<typeof resolveRaced>[0]>((resolve) => {
    resolveRaced = resolve;
  });
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    writable: true,
    value: {
      kodaxSpace: {
        invoke: mockHistoryInvoke(async () => {
          calls += 1;
          if (calls === 1) {
            return {
              ok: true as const,
              data: {
                items: [{ kind: 'user' as const, content: 'visible partial row' }],
                conversation: { status: 'partial' as const },
                page: {
                  outcome: 'ready' as const,
                  revision: 'partial-revision',
                  sourceRevision: 'partial-source',
                  hasMore: false as const,
                  windowMode: 'replace' as const,
                  hasNewer: false as const,
                },
              },
            };
          }
          if (calls === 2) return racedResponse;
          return {
            ok: true as const,
            data: { items: [], page: { outcome: 'runtime_unavailable' as const } },
          };
        }),
      },
    },
  });

  await restoreNewestSessionHistory(sessionId, 'code');
  const refresh = restoreNewestSessionHistory(sessionId, 'code');
  invalidateSessionHistoryPaging(sessionId);
  resolveRaced({
    ok: true,
    data: {
      items: [{ kind: 'user', content: 'raced partial row' }],
      conversation: { status: 'partial' },
      page: {
        outcome: 'ready',
        revision: 'raced-revision',
        sourceRevision: 'raced-source',
        hasMore: false,
        windowMode: 'replace',
        hasNewer: false,
      },
    },
  });
  await refresh;
  const deadline = Date.now() + 2_000;
  while (calls < 3 && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  assert.equal(calls, 3);
  assert.deepEqual(sessionHistoryPagingSnapshot(sessionId), {
    phase: 'waiting',
    surface: 'code',
    hasMore: false,
    conversationStatus: 'partial',
  });
  assert.deepEqual(
    useAppStore.getState().userMessagesBySession[sessionId]?.map((message) => message.content),
    ['visible partial row'],
  );
});

test('an active uncertain warning revalidates immediately at a persistence boundary', async () => {
  const sessionId = 'history-paging-active-warning-refresh';
  useAppStore.setState({
    sessions: [
      {
        sessionId,
        projectRoot: '/project',
        provider: 'mock',
        reasoningMode: 'auto',
        permissionMode: 'accept-edits',
        autoModeEngine: 'llm',
        agentMode: 'ama',
        surface: 'code',
        createdAt: 1_000,
        lastActivityAt: 1_000,
      },
    ],
    currentSessionId: sessionId,
    eventsBySession: {},
    userMessagesBySession: {},
  });
  let calls = 0;
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    writable: true,
    value: {
      kodaxSpace: {
        invoke: mockHistoryInvoke(async () => {
          calls += 1;
          return {
            ok: true as const,
            data: {
              items: [
                {
                  kind: 'user' as const,
                  content: calls === 1 ? 'partial query' : 'resolved query',
                },
              ],
              conversation: {
                status: calls === 1 ? ('partial' as const) : ('resolved' as const),
              },
              page: {
                outcome: 'ready' as const,
                revision: `revision-${calls}`,
                sourceRevision: `source-${calls}`,
                hasMore: false as const,
                windowMode: 'replace' as const,
                hasNewer: false as const,
              },
            },
          };
        }),
      },
    },
  });

  await restoreNewestSessionHistory(sessionId, 'code');
  assert.equal(sessionHistoryPagingSnapshot(sessionId).conversationStatus, 'partial');
  invalidateSessionHistoryPaging(sessionId);
  const deadline = Date.now() + 2_000;
  while (
    sessionHistoryPagingSnapshot(sessionId).conversationStatus !== 'resolved' &&
    Date.now() < deadline
  ) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  assert.equal(calls, 2);
  assert.equal(sessionHistoryPagingSnapshot(sessionId).conversationStatus, 'resolved');
  assert.equal(hasReadySessionHistory(sessionId), true);
  assert.deepEqual(
    useAppStore.getState().userMessagesBySession[sessionId]?.map((message) => message.content),
    ['resolved query'],
  );
});

test('history paging preserves surface routing and restarts from newest after data_changed', async () => {
  const sessionId = 'history-paging-resync';
  useAppStore.setState({
    sessions: [
      {
        sessionId,
        projectRoot: '/project',
        provider: 'mock',
        reasoningMode: 'auto',
        permissionMode: 'accept-edits',
        autoModeEngine: 'llm',
        agentMode: 'ama',
        surface: 'code',
        createdAt: 1_000,
        lastActivityAt: 1_000,
      },
    ],
    currentSessionId: sessionId,
    eventsBySession: {},
    userMessagesBySession: {},
  });

  const inputs: unknown[] = [];
  let call = 0;
  const invoke = async (_channel: string, input: unknown) => {
    inputs.push(input);
    call += 1;
    if (call === 1) {
      return {
        ok: true as const,
        data: {
          items: [{ kind: 'user' as const, content: 'stale newest' }],
          page: {
            outcome: 'ready' as const,
            revision: 'revision-1',
            sourceRevision: 'source-1',
            hasMore: true,
            nextCursor: 'older-1',
            windowMode: 'replace' as const,
            hasNewer: false,
          },
        },
      };
    }
    if (call === 2) {
      return {
        ok: true as const,
        data: { items: [], page: { outcome: 'data_changed' as const } },
      };
    }
    return {
      ok: true as const,
      data: {
        items: [{ kind: 'user' as const, content: 'fresh newest' }],
        page: {
          outcome: 'ready' as const,
          revision: 'revision-2',
          sourceRevision: 'source-2',
          hasMore: false,
          windowMode: 'replace' as const,
          hasNewer: false,
        },
      },
    };
  };
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    writable: true,
    value: { kodaxSpace: { invoke: mockHistoryInvoke(invoke) } },
  });

  await restoreNewestSessionHistory(sessionId, 'code');
  await loadOlderSessionHistory(sessionId);
  const deadline = Date.now() + 2_000;
  while (call < 3 && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  assert.deepEqual(inputs.map(withoutHistoryRequestId), [
    { sessionId, expectedSurface: 'code' },
    {
      sessionId,
      expectedSurface: 'code',
      cursor: 'older-1',
      revision: 'revision-1',
      sourceRevision: 'source-1',
    },
    { sessionId, expectedSurface: 'code' },
  ]);
  assert.deepEqual(sessionHistoryPagingSnapshot(sessionId), {
    phase: 'ready',
    surface: 'code',
    revision: 'revision-2',
    sourceRevision: 'source-2',
    hasMore: false,
    hasNewer: false,
  });
  assert.deepEqual(
    useAppStore.getState().userMessagesBySession[sessionId]?.map((message) => message.content),
    ['fresh newest'],
  );
});

test('history paging paints one bounded newest window and reads older windows only on demand', async () => {
  const sessionId = 'history-paging-large-turn';
  useAppStore.setState({
    sessions: [
      {
        sessionId,
        projectRoot: '/project',
        provider: 'mock',
        reasoningMode: 'auto',
        permissionMode: 'accept-edits',
        autoModeEngine: 'llm',
        agentMode: 'ama',
        surface: 'code',
        createdAt: 1_000,
        lastActivityAt: 1_000,
      },
    ],
    currentSessionId: sessionId,
    eventsBySession: {},
    userMessagesBySession: {},
  });

  const inputs: unknown[] = [];
  const pages = [
    {
      items: [
        { kind: 'history_truncation' as const, scope: 'history' as const, omittedItems: 2 },
        { kind: 'assistant' as const, text: 'new answer tail', canonicalIndex: 3 },
      ],
      page: {
        outcome: 'ready' as const,
        revision: 'revision-large',
        sourceRevision: 'source-large',
        hasMore: true,
        nextCursor: 'cursor-1',
        windowMode: 'replace' as const,
        hasNewer: false,
      },
    },
    {
      items: [
        { kind: 'history_truncation' as const, scope: 'history' as const, omittedItems: 1 },
        { kind: 'user' as const, content: 'new query', canonicalIndex: 2 },
      ],
      page: {
        outcome: 'ready' as const,
        revision: 'revision-large',
        sourceRevision: 'source-large',
        hasMore: true,
        nextCursor: 'cursor-2',
        windowMode: 'prepend' as const,
        hasNewer: false,
      },
    },
    {
      items: [
        { kind: 'user' as const, content: 'old query', canonicalIndex: 0 },
        { kind: 'assistant' as const, text: 'old answer', canonicalIndex: 1 },
      ],
      page: {
        outcome: 'ready' as const,
        revision: 'revision-large',
        sourceRevision: 'source-large',
        hasMore: false,
        windowMode: 'prepend' as const,
        hasNewer: false,
      },
    },
  ];
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    writable: true,
    value: {
      kodaxSpace: {
        invoke: mockHistoryInvoke(async (_channel: string, input: unknown) => {
          inputs.push(input);
          return { ok: true as const, data: pages[inputs.length - 1]! };
        }),
      },
    },
  });

  await restoreNewestSessionHistory(sessionId, 'code');
  assert.equal(inputs.length, 1, 'the newest restore must never chase an unbounded owning query');
  await loadOlderSessionHistory(sessionId);
  assert.deepEqual(
    useAppStore
      .getState()
      .userMessagesBySession[sessionId]?.filter((message) => message.hiddenHistoryAnchor !== true)
      .map((message) => message.content),
    ['new query'],
  );
  await loadOlderSessionHistory(sessionId);

  assert.deepEqual(
    useAppStore.getState().userMessagesBySession[sessionId]?.map((message) => message.content),
    ['old query', 'new query'],
  );
  assert.deepEqual(withoutHistoryRequestId(inputs[2]), {
    sessionId,
    expectedSurface: 'code',
    cursor: 'cursor-2',
    revision: 'revision-large',
    sourceRevision: 'source-large',
  });
  assert.equal(sessionHistoryPagingSnapshot(sessionId).hasMore, false);
});

test('history paging keeps a leading partial live turn ordered before and after its query page loads', async () => {
  const sessionId = 'history-paging-leading-partial';
  useAppStore.setState({
    sessions: [
      {
        sessionId,
        projectRoot: '/project',
        provider: 'mock',
        reasoningMode: 'auto',
        permissionMode: 'accept-edits',
        autoModeEngine: 'llm',
        agentMode: 'ama',
        surface: 'code',
        createdAt: 1_000,
        lastActivityAt: 20_100,
      },
    ],
    currentSessionId: sessionId,
    eventsBySession: {},
    userMessagesBySession: {},
  });

  const store = useAppStore.getState();
  const liveToken = 'a'.repeat(32);
  const canonicalToken = 'b'.repeat(32);
  store.appendUserMessage(sessionId, 'older query', 10_000, [
    {
      id: 'older-image',
      kind: 'image',
      mediaType: 'image/png',
      label: 'evidence.png',
      bytes: 123,
      status: 'available',
      thumbnailUrl: `app://space/session-attachment/${liveToken}?variant=thumbnail`,
      previewUrl: `app://space/session-attachment/${liveToken}?variant=original`,
    },
  ]);
  store.appendEvent({
    kind: 'session_start',
    sessionId,
    provider: 'mock',
    turnId: 'turn-older',
  });
  store.appendEvent({ kind: 'text_delta', sessionId, text: 'older answer', sentAt: 10_100 });
  store.appendEvent({ kind: 'session_complete', sessionId, turnId: 'turn-older' });
  store.appendUserMessage(sessionId, 'newer query', 20_000);
  store.appendEvent({
    kind: 'session_start',
    sessionId,
    provider: 'mock',
    turnId: 'turn-newer',
  });
  store.appendEvent({ kind: 'text_delta', sessionId, text: 'newer answer', sentAt: 20_100 });
  store.appendEvent({ kind: 'session_complete', sessionId, turnId: 'turn-newer' });

  const pages = [
    {
      items: [
        { kind: 'history_truncation' as const, scope: 'history' as const, omittedItems: 55 },
        {
          kind: 'assistant' as const,
          text: 'older answer',
          sentAt: 10_100,
          canonicalIndex: 56,
          turnId: 'turn-older',
        },
        {
          kind: 'user' as const,
          content: 'newer query',
          sentAt: 20_000,
          canonicalIndex: 57,
          turnId: 'turn-newer',
          turnUserOrdinal: 0,
        },
        {
          kind: 'assistant' as const,
          text: 'newer answer',
          sentAt: 20_100,
          canonicalIndex: 58,
          turnId: 'turn-newer',
        },
      ],
      page: {
        outcome: 'ready' as const,
        revision: 'revision-leading-partial',
        sourceRevision: 'source-leading-partial',
        hasMore: true,
        nextCursor: 'older-query-page',
        windowMode: 'replace' as const,
        hasNewer: false,
      },
    },
    {
      items: [
        {
          kind: 'user' as const,
          content: 'older query',
          sentAt: 10_000,
          canonicalIndex: 55,
          historyTurnIndex: 55,
          historyBoundary: {
            boundaryId: 'older-answer-boundary',
            sourceRevision: 'source-leading-partial',
          },
          turnId: 'turn-older',
          attachments: [
            {
              id: 'older-image',
              kind: 'image' as const,
              mediaType: 'image/png' as const,
              bytes: 123,
              status: 'available' as const,
              thumbnailUrl: `app://space/session-attachment/${canonicalToken}?variant=thumbnail`,
              previewUrl: `app://space/session-attachment/${canonicalToken}?variant=original`,
            },
          ],
        },
      ],
      page: {
        outcome: 'ready' as const,
        revision: 'revision-leading-partial',
        sourceRevision: 'source-leading-partial',
        hasMore: false,
        windowMode: 'prepend' as const,
        hasNewer: false,
      },
    },
  ];
  let call = 0;
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    writable: true,
    value: {
      kodaxSpace: {
        invoke: mockHistoryInvoke(async () => ({ ok: true as const, data: pages[call++]! })),
      },
    },
  });

  const visibleSequence = (): readonly string[] => {
    const state = useAppStore.getState();
    return composeMessages({
      events: state.eventsBySession[sessionId] ?? [],
      userMessages: state.userMessagesBySession[sessionId] ?? [],
    }).flatMap((message) => {
      if (message.kind === 'user') return [`user:${message.content}`];
      if (message.kind === 'assistant_text') return [`assistant:${message.text}`];
      if (message.kind === 'system_notice' && message.lineageKind === 'history_truncation') {
        return ['notice:history_truncation'];
      }
      return [];
    });
  };
  const expected = [
    'notice:history_truncation',
    'user:older query',
    'assistant:older answer',
    'user:newer query',
    'assistant:newer answer',
  ];

  await restoreNewestSessionHistory(sessionId, 'code');
  assert.deepEqual(visibleSequence(), expected);

  await loadOlderSessionHistory(sessionId);
  assert.deepEqual(visibleSequence(), expected.slice(1));
  const olderOwner = useAppStore
    .getState()
    .userMessagesBySession[sessionId]?.find((message) => message.content === 'older query');
  assert.deepEqual(
    olderOwner && {
      canonicalIndex: olderOwner.canonicalIndex,
      historyTurnIndex: olderOwner.historyTurnIndex,
      historyBoundary: olderOwner.historyBoundary,
      turnId: olderOwner.turnId,
      turnUserOrdinal: olderOwner.turnUserOrdinal,
      restoredFromHistory: olderOwner.restoredFromHistory,
      attachmentId: olderOwner.attachments?.[0]?.id,
      attachmentPreviewUrl:
        olderOwner.attachments?.[0]?.status === 'available'
          ? olderOwner.attachments[0].previewUrl
          : undefined,
    },
    {
      canonicalIndex: 55,
      historyTurnIndex: 55,
      historyBoundary: {
        boundaryId: 'older-answer-boundary',
        sourceRevision: 'source-leading-partial',
      },
      turnId: 'turn-older',
      turnUserOrdinal: 0,
      restoredFromHistory: true,
      attachmentId: 'older-image',
      attachmentPreviewUrl: `app://space/session-attachment/${canonicalToken}?variant=original`,
    },
  );
});

test('history paging waits for Runtime instead of falling back to a full persisted read', async () => {
  const sessionId = 'history-paging-runtime-startup';
  useAppStore.setState({
    sessions: [
      {
        sessionId,
        projectRoot: '/project',
        provider: 'mock',
        reasoningMode: 'auto',
        permissionMode: 'accept-edits',
        autoModeEngine: 'llm',
        agentMode: 'ama',
        surface: 'code',
        createdAt: 1_000,
        lastActivityAt: 1_000,
      },
    ],
    currentSessionId: sessionId,
    eventsBySession: {},
    userMessagesBySession: {},
  });

  let calls = 0;
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    writable: true,
    value: {
      kodaxSpace: {
        invoke: mockHistoryInvoke(async () => {
          calls += 1;
          return calls === 1
            ? {
                ok: true as const,
                data: { items: [], page: { outcome: 'runtime_unavailable' as const } },
              }
            : {
                ok: true as const,
                data: {
                  items: [{ kind: 'user' as const, content: 'ready query' }],
                  page: {
                    outcome: 'ready' as const,
                    revision: 'revision-ready',
                    sourceRevision: 'source-ready',
                    hasMore: false,
                    windowMode: 'replace' as const,
                    hasNewer: false,
                  },
                },
              };
        }),
      },
    },
  });

  await restoreNewestSessionHistory(sessionId, 'code');
  assert.equal(sessionHistoryPagingSnapshot(sessionId).phase, 'waiting');
  const deadline = Date.now() + 2_000;
  while (calls < 2 && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.equal(calls, 2);
  assert.equal(sessionHistoryPagingSnapshot(sessionId).phase, 'ready');
  assert.equal(
    useAppStore.getState().userMessagesBySession[sessionId]?.[0]?.content,
    'ready query',
  );
});

test('same Runtime turn users across pages retain both canonical queries and boundaries', async () => {
  const sessionId = 'history-paging-same-turn';
  useAppStore.setState({
    sessions: [
      {
        sessionId,
        projectRoot: '/project',
        provider: 'mock',
        reasoningMode: 'auto',
        permissionMode: 'accept-edits',
        autoModeEngine: 'llm',
        agentMode: 'ama',
        surface: 'code',
        createdAt: 1_000,
        lastActivityAt: 1_000,
      },
    ],
    currentSessionId: sessionId,
    eventsBySession: {},
    userMessagesBySession: {},
  });
  const olderBoundary = { boundaryId: 'boundary-old', sourceRevision: 'source-shared' };
  const newerBoundary = { boundaryId: 'boundary-new', sourceRevision: 'source-shared' };
  const pages = [
    {
      items: [
        {
          kind: 'user' as const,
          content: 'newer query',
          canonicalIndex: 20,
          historyTurnIndex: 20,
          historyBoundary: newerBoundary,
          turnId: 'turn-1',
          // This deliberately collides with the older row to prove two durable rows are never
          // folded merely because a page-local ordinal was ambiguous.
          turnUserOrdinal: 0,
        },
        { kind: 'assistant' as const, text: 'newer answer', canonicalIndex: 21 },
      ],
      page: {
        outcome: 'ready' as const,
        revision: 'revision-shared',
        sourceRevision: 'source-shared',
        hasMore: true,
        nextCursor: 'older-shared',
        windowMode: 'replace' as const,
        hasNewer: false,
      },
    },
    {
      items: [
        {
          kind: 'user' as const,
          content: 'older query',
          canonicalIndex: 10,
          historyTurnIndex: 10,
          historyBoundary: olderBoundary,
          turnId: 'turn-1',
          turnUserOrdinal: 0,
        },
        { kind: 'assistant' as const, text: 'older answer', canonicalIndex: 11 },
      ],
      page: {
        outcome: 'ready' as const,
        revision: 'revision-shared',
        sourceRevision: 'source-shared',
        hasMore: false,
        windowMode: 'prepend' as const,
        hasNewer: false,
      },
    },
  ];
  let call = 0;
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    writable: true,
    value: {
      kodaxSpace: {
        invoke: mockHistoryInvoke(async () => ({ ok: true as const, data: pages[call++]! })),
      },
    },
  });

  await restoreNewestSessionHistory(sessionId, 'code');
  await loadOlderSessionHistory(sessionId);

  const state = useAppStore.getState();
  const users = state.userMessagesBySession[sessionId] ?? [];
  const events = state.eventsBySession[sessionId] ?? [];
  assert.deepEqual(
    users.map((message) => message.content),
    ['older query', 'newer query'],
  );
  assert.strictEqual(messageForSelectorTurn(users, 10)?.historyBoundary, olderBoundary);
  assert.strictEqual(messageForSelectorTurn(users, 20)?.historyBoundary, newerBoundary);
  assert.deepEqual(
    composeMessages({ events, userMessages: users })
      .filter((message) => message.kind === 'assistant_text')
      .map((message) => message.text),
    ['older answer', 'newer answer'],
  );
});

test('an accumulated older page retains canonical newest rows and the distinct live tail', async () => {
  const sessionId = 'history-paging-live-window';
  useAppStore.setState({
    sessions: [
      {
        sessionId,
        projectRoot: '/project',
        provider: 'mock',
        reasoningMode: 'auto',
        permissionMode: 'accept-edits',
        autoModeEngine: 'llm',
        agentMode: 'ama',
        surface: 'code',
        createdAt: 1_000,
        lastActivityAt: 1_000,
      },
    ],
    currentSessionId: sessionId,
    eventsBySession: {},
    userMessagesBySession: {},
  });
  const store = useAppStore.getState();
  store.appendUserMessage(sessionId, 'newest live query', 2_000);
  store.appendEvent({ kind: 'text_delta', sessionId, text: 'newest live answer' });

  let call = 0;
  const pages = [
    {
      items: [{ kind: 'user' as const, content: 'newest canonical query', canonicalIndex: 20 }],
      page: {
        outcome: 'ready' as const,
        revision: 'revision-live-window',
        sourceRevision: 'source-live-window',
        hasMore: true,
        nextCursor: 'older-live-window',
        windowMode: 'replace' as const,
        hasNewer: false,
      },
    },
    {
      items: [
        { kind: 'user' as const, content: 'older canonical query', canonicalIndex: 10 },
        { kind: 'assistant' as const, text: 'older canonical answer', canonicalIndex: 11 },
      ],
      page: {
        outcome: 'ready' as const,
        revision: 'revision-live-window',
        sourceRevision: 'source-live-window',
        hasMore: false,
        windowMode: 'prepend' as const,
        hasNewer: false,
      },
    },
  ];
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    writable: true,
    value: {
      kodaxSpace: {
        invoke: mockHistoryInvoke(async () => ({ ok: true as const, data: pages[call++]! })),
      },
    },
  });

  await restoreNewestSessionHistory(sessionId, 'code');
  await loadOlderSessionHistory(sessionId);

  const next = useAppStore.getState();
  assert.deepEqual(
    (next.userMessagesBySession[sessionId] ?? []).map((message) => message.content),
    ['older canonical query', 'newest canonical query', 'newest live query'],
  );
  assert.deepEqual(
    composeMessages({
      events: next.eventsBySession[sessionId] ?? [],
      userMessages: next.userMessagesBySession[sessionId] ?? [],
    })
      .filter((message) => message.kind === 'assistant_text')
      .map((message) => message.text),
    ['older canonical answer', 'newest live answer'],
  );
});

test('deactivating a Session cancels Runtime startup retries and ignores late lifecycle work', async () => {
  const sessionId = 'history-paging-deactivate';
  useAppStore.setState({
    sessions: [],
    currentSessionId: sessionId,
    eventsBySession: {},
    userMessagesBySession: {},
  });
  let calls = 0;
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    writable: true,
    value: {
      kodaxSpace: {
        invoke: mockHistoryInvoke(async () => {
          calls += 1;
          return {
            ok: true as const,
            data: { items: [], page: { outcome: 'runtime_unavailable' as const } },
          };
        }),
      },
    },
  });

  await restoreNewestSessionHistory(sessionId, 'code');
  deactivateSessionHistoryPaging(sessionId);
  await new Promise((resolve) => setTimeout(resolve, 250));
  assert.equal(calls, 1);
});

test('reactivating a Session does not reuse an in-flight request from its stale lifecycle', async () => {
  const sessionId = 'history-paging-reactivate';
  useAppStore.setState({
    sessions: [
      {
        sessionId,
        projectRoot: '/project',
        provider: 'mock',
        reasoningMode: 'auto',
        permissionMode: 'accept-edits',
        autoModeEngine: 'llm',
        agentMode: 'ama',
        surface: 'code',
        createdAt: 1_000,
        lastActivityAt: 1_000,
      },
    ],
    currentSessionId: sessionId,
    eventsBySession: {},
    userMessagesBySession: {},
  });
  let calls = 0;
  let resolveStale!: (value: {
    ok: true;
    data: { items: never[]; page: { outcome: 'runtime_unavailable' } };
  }) => void;
  const staleResponse = new Promise<{
    ok: true;
    data: { items: never[]; page: { outcome: 'runtime_unavailable' } };
  }>((resolve) => {
    resolveStale = resolve;
  });
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    writable: true,
    value: {
      kodaxSpace: {
        invoke: mockHistoryInvoke(async () => {
          calls += 1;
          if (calls === 1) return staleResponse;
          return {
            ok: true as const,
            data: {
              items: [{ kind: 'user' as const, content: 'fresh lifecycle query' }],
              page: {
                outcome: 'ready' as const,
                revision: 'revision-fresh',
                sourceRevision: 'source-fresh',
                hasMore: false,
                windowMode: 'replace' as const,
                hasNewer: false,
              },
            },
          };
        }),
      },
    },
  });

  const staleLoad = restoreNewestSessionHistory(sessionId, 'code');
  deactivateSessionHistoryPaging(sessionId);
  const freshLoad = restoreNewestSessionHistory(sessionId, 'code');
  assert.equal(calls, 2);

  resolveStale({
    ok: true,
    data: { items: [], page: { outcome: 'runtime_unavailable' } },
  });
  await Promise.all([staleLoad, freshLoad]);

  assert.equal(sessionHistoryPagingSnapshot(sessionId).phase, 'ready');
  assert.equal(
    useAppStore.getState().userMessagesBySession[sessionId]?.[0]?.content,
    'fresh lifecycle query',
  );
});

test('history-window replacement does not resurrect an optimistic query after rollback', () => {
  const sessionId = 'history-paging-rollback-baseline';
  useAppStore.setState({
    sessions: [
      {
        sessionId,
        projectRoot: '/project',
        provider: 'mock',
        reasoningMode: 'auto',
        permissionMode: 'accept-edits',
        autoModeEngine: 'llm',
        agentMode: 'ama',
        surface: 'code',
        createdAt: 1_000,
        lastActivityAt: 1_000,
      },
    ],
    currentSessionId: sessionId,
    eventsBySession: {},
    userMessagesBySession: {},
  });
  const store = useAppStore.getState();
  store.prependSessionHistory(
    sessionId,
    [{ kind: 'user', content: 'durable newest', canonicalIndex: 10 }],
    1_000,
    { replaceLoadedWindow: true },
  );
  store.appendUserMessage(sessionId, 'optimistic ghost', 2_000);
  store.rollbackLastUserMessage(sessionId, 'optimistic ghost');
  store.prependSessionHistory(
    sessionId,
    [{ kind: 'user', content: 'durable older', canonicalIndex: 5 }],
    1_000,
    { replaceLoadedWindow: true },
  );

  assert.deepEqual(
    (useAppStore.getState().userMessagesBySession[sessionId] ?? []).map(
      (message) => message.content,
    ),
    ['durable older'],
  );
});

test('history-window replacement does not resurrect a query converted back to queued', () => {
  const sessionId = 'history-paging-queued-baseline';
  useAppStore.setState({
    sessions: [
      {
        sessionId,
        projectRoot: '/project',
        provider: 'mock',
        reasoningMode: 'auto',
        permissionMode: 'accept-edits',
        autoModeEngine: 'llm',
        agentMode: 'ama',
        surface: 'code',
        createdAt: 1_000,
        lastActivityAt: 1_000,
      },
    ],
    currentSessionId: sessionId,
    eventsBySession: {},
    userMessagesBySession: {},
    queuedUserMessagesBySession: {},
  });
  const store = useAppStore.getState();
  store.prependSessionHistory(
    sessionId,
    [{ kind: 'user', content: 'durable newest', canonicalIndex: 10 }],
    1_000,
    { replaceLoadedWindow: true },
  );
  store.appendUserMessage(sessionId, 'queued query', 2_000);
  assert.notEqual(
    store.convertLastUserMessageToQueued(sessionId, 'queued query', {
      content: 'queued query',
      queueMode: 'after-turn',
      sentAt: 2_000,
    }),
    null,
  );
  store.prependSessionHistory(
    sessionId,
    [{ kind: 'user', content: 'durable older', canonicalIndex: 5 }],
    1_000,
    { replaceLoadedWindow: true },
  );

  const next = useAppStore.getState();
  assert.deepEqual(
    (next.userMessagesBySession[sessionId] ?? []).map((message) => message.content),
    ['durable older'],
  );
  assert.deepEqual(
    (next.queuedUserMessagesBySession[sessionId] ?? []).map((message) => message.content),
    ['queued query'],
  );
});

test('same-turn users with different attachment identities fail open instead of merging', () => {
  const sessionId = 'history-paging-ambiguous-live-identity';
  useAppStore.setState({
    sessions: [
      {
        sessionId,
        projectRoot: '/project',
        provider: 'mock',
        reasoningMode: 'auto',
        permissionMode: 'accept-edits',
        autoModeEngine: 'llm',
        agentMode: 'ama',
        surface: 'code',
        createdAt: 1_000,
        lastActivityAt: 1_000,
      },
    ],
    currentSessionId: sessionId,
    eventsBySession: {},
    userMessagesBySession: {},
  });
  const store = useAppStore.getState();
  const liveToken = 'c'.repeat(32);
  const canonicalToken = 'd'.repeat(32);
  store.appendUserMessage(sessionId, 'same visible query', 1_000, [
    {
      id: 'live-image',
      kind: 'image',
      mediaType: 'image/png',
      status: 'available',
      thumbnailUrl: `app://space/session-attachment/${liveToken}?variant=thumbnail`,
      previewUrl: `app://space/session-attachment/${liveToken}?variant=original`,
    },
  ]);
  store.appendEvent({
    kind: 'session_start',
    sessionId,
    provider: 'mock',
    turnId: 'turn-shared',
  });
  store.appendEvent({ kind: 'text_delta', sessionId, text: 'root answer' });
  store.appendEvent({ kind: 'session_complete', sessionId, turnId: 'turn-shared' });
  store.prependSessionHistory(
    sessionId,
    [
      {
        kind: 'user',
        content: 'same visible query',
        canonicalIndex: 10,
        turnId: 'turn-shared',
        attachments: [
          {
            id: 'different-canonical-image',
            kind: 'image',
            mediaType: 'image/png',
            status: 'available',
            thumbnailUrl: `app://space/session-attachment/${canonicalToken}?variant=thumbnail`,
            previewUrl: `app://space/session-attachment/${canonicalToken}?variant=original`,
          },
        ],
      },
      { kind: 'assistant', text: 'later answer', canonicalIndex: 11 },
    ],
    1_000,
    { replaceLoadedWindow: true },
  );

  assert.deepEqual(
    (useAppStore.getState().userMessagesBySession[sessionId] ?? []).map((message) => ({
      content: message.content,
      attachmentId: message.attachments?.[0]?.id,
    })),
    [
      { content: 'same visible query', attachmentId: 'different-canonical-image' },
      { content: 'same visible query', attachmentId: 'live-image' },
    ],
  );
});

test('paging cache eviction releases restored store rows and reselect reloads canonically', async () => {
  const sessionIds = Array.from({ length: 33 }, (_, index) => `history-paging-cache-${index}`);
  useAppStore.setState({
    sessions: sessionIds.map((sessionId) => ({
      sessionId,
      projectRoot: '/project',
      provider: 'mock',
      reasoningMode: 'auto' as const,
      permissionMode: 'accept-edits' as const,
      autoModeEngine: 'llm' as const,
      agentMode: 'ama' as const,
      surface: 'code' as const,
      createdAt: 1_000,
      lastActivityAt: 1_000,
    })),
    currentSessionId: sessionIds.at(-1)!,
    eventsBySession: {},
    userMessagesBySession: {},
  });
  const calls = new Map<string, number>();
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    writable: true,
    value: {
      kodaxSpace: {
        invoke: mockHistoryInvoke(
          async (_channel: string, input: { readonly sessionId: string }) => {
            calls.set(input.sessionId, (calls.get(input.sessionId) ?? 0) + 1);
            return {
              ok: true as const,
              data: {
                items: [{ kind: 'user' as const, content: `query:${input.sessionId}` }],
                page: {
                  outcome: 'ready' as const,
                  revision: `revision:${input.sessionId}`,
                  sourceRevision: `source:${input.sessionId}`,
                  hasMore: false,
                  windowMode: 'replace' as const,
                  hasNewer: false,
                },
              },
            };
          },
        ),
      },
    },
  });

  for (const sessionId of sessionIds) {
    await restoreNewestSessionHistory(sessionId, 'code');
    deactivateSessionHistoryPaging(sessionId);
  }
  const evicted = sessionIds[0]!;
  assert.equal(hasReadySessionHistory(evicted), false);
  assert.deepEqual(useAppStore.getState().userMessagesBySession[evicted], []);

  await restoreNewestSessionHistory(evicted, 'code');
  deactivateSessionHistoryPaging(evicted);
  assert.equal(calls.get(evicted), 2);
  assert.deepEqual(
    useAppStore.getState().userMessagesBySession[evicted]?.map((message) => message.content),
    [`query:${evicted}`],
  );
});
