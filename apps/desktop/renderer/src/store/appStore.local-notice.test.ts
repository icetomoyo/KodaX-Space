import assert from 'node:assert/strict';
import test from 'node:test';
import { useAppStore } from './appStore.js';

test('awaiting a compact echo waits for its durable write while showing it immediately', async () => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const sessionId = 's_compact_echo';
  useAppStore.setState({
    sessions: [
      {
        sessionId,
        projectRoot: '/test',
        provider: 'mock',
        surface: 'code',
        reasoningMode: 'auto',
        permissionMode: 'accept-edits',
        agentMode: 'ama',
        createdAt: 1,
        lastActivityAt: 1,
      },
    ],
    localNoticesBySession: {},
  });
  let releaseWrite = () => {};
  const write = new Promise<void>((resolve) => {
    releaseWrite = resolve;
  });
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      kodaxSpace: {
        invoke: async () => {
          await write;
          return { ok: true };
        },
      },
    },
  });
  let compactStarted = false;
  const operation = (async () => {
    await useAppStore.getState().appendLocalNotice(sessionId, '/compact');
    compactStarted = true;
  })();
  try {
    assert.equal(useAppStore.getState().localNoticesBySession[sessionId]?.[0]?.content, '/compact');
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(compactStarted, false, 'compaction must not read while its echo is being written');
    releaseWrite();
    await operation;
    assert.equal(compactStarted, true);
  } finally {
    releaseWrite();
    await operation;
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow);
    else Reflect.deleteProperty(globalThis, 'window');
  }
});

for (const echoResult of ['success', 'failed', 'rejected']) {
  test(`compact echo ${echoResult} waits for an already running notice retry`, async () => {
    const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
    const sessionId = `s_compact_retry_${echoResult}`;
    useAppStore.setState({
      sessions: [
        {
          sessionId,
          projectRoot: '/test',
          provider: 'mock',
          surface: 'code',
          reasoningMode: 'auto',
          permissionMode: 'accept-edits',
          agentMode: 'ama',
          createdAt: 1,
          lastActivityAt: 1,
        },
      ],
      localNoticesBySession: {},
    });
    let releaseRetry = () => {};
    const retry = new Promise<void>((resolve) => {
      releaseRetry = resolve;
    });
    let retryStarted = () => {};
    const started = new Promise<void>((resolve) => {
      retryStarted = resolve;
    });
    let calls = 0;
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        kodaxSpace: {
          invoke: async () => {
            calls += 1;
            if (calls === 1) return { ok: false };
            if (calls === 4 && echoResult === 'failed') return { ok: false };
            if (calls === 4 && echoResult === 'rejected') throw new Error('notice write rejected');
            if (calls === 3) {
              retryStarted();
              await retry;
            }
            return { ok: true };
          },
        },
      },
    });
    const operations: Promise<void>[] = [];
    try {
      await useAppStore.getState().appendLocalNotice(sessionId, 'previous failed notice');
      operations.push(useAppStore.getState().appendLocalNotice(sessionId, 'trigger retry'));
      await started;
      let compactStarted = false;
      operations.push(
        useAppStore
          .getState()
          .appendLocalNotice(sessionId, '/compact')
          .then(() => {
            compactStarted = true;
          }),
      );
      await new Promise<void>((resolve) => setImmediate(resolve));
      assert.equal(compactStarted, false, 'the retry still holds a Session writer');
      releaseRetry();
      await Promise.all(operations);
      assert.equal(compactStarted, true);
    } finally {
      releaseRetry();
      await Promise.all(operations);
      if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow);
      else Reflect.deleteProperty(globalThis, 'window');
    }
  });
}
