import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertSessionSendScope, runIdempotentSessionSend } from '../ipc/session.js';

const codeSession = {
  sessionId: 's_code',
  projectRoot: '/Users/vincegao/project-a',
  surface: 'code' as const,
};

test('assertSessionSendScope accepts matching project and surface', () => {
  assert.doesNotThrow(() =>
    assertSessionSendScope(codeSession, {
      expectedProjectRoot: '/Users/vincegao/project-a/',
      expectedSurface: 'code',
    }),
  );
});

test('assertSessionSendScope rejects stale project root', () => {
  assert.throws(
    () =>
      assertSessionSendScope(codeSession, {
        expectedProjectRoot: '/Users/vincegao/project-b',
        expectedSurface: 'code',
      }),
    /session\/project mismatch/,
  );
});

test('assertSessionSendScope rejects stale surface', () => {
  assert.throws(
    () =>
      assertSessionSendScope(codeSession, {
        expectedProjectRoot: '/Users/vincegao/project-a',
        expectedSurface: 'partner',
      }),
    /session\/surface mismatch/,
  );
});

test('assertSessionSendScope remains backward compatible when no expected scope is supplied', () => {
  assert.doesNotThrow(() => assertSessionSendScope(codeSession, {}));
});

test('session.send reuses an accepted operation before touching removed draft attachments', async () => {
  const operationId = `session-send-retry-${crypto.randomUUID()}`;
  let starts = 0;
  let draftAttachmentExists = true;
  const send = async (): Promise<{ readonly accepted: true; readonly attachment: string }> => {
    starts += 1;
    assert.equal(draftAttachmentExists, true);
    draftAttachmentExists = false;
    return { accepted: true, attachment: 'durable://attachment' };
  };

  const accepted = await runIdempotentSessionSend(operationId, 'same-request', send);
  const retried = await runIdempotentSessionSend(operationId, 'same-request', send);

  assert.deepEqual(retried, accepted);
  assert.equal(starts, 1);
});

test('session.send rejects reusing an operation id for a different request', async () => {
  const operationId = `session-send-conflict-${crypto.randomUUID()}`;
  await runIdempotentSessionSend(operationId, 'first-request', async () => ({ accepted: true }));

  await assert.rejects(
    runIdempotentSessionSend(operationId, 'changed-request', async () => ({ accepted: true })),
    /different request/,
  );
});

test('session.send never evicts an in-flight operation at the dedupe capacity', async () => {
  const releases: Array<() => void> = [];
  let starts = 0;
  const startPending = (): Promise<{ readonly accepted: true }> => {
    starts += 1;
    return new Promise((resolve) => releases.push(() => resolve({ accepted: true })));
  };
  const operationIds = Array.from(
    { length: 256 },
    (_, index) => `session-send-pending-${crypto.randomUUID()}-${index}`,
  );
  const pending = operationIds.map((operationId) =>
    runIdempotentSessionSend(operationId, operationId, startPending),
  );

  await assert.rejects(
    runIdempotentSessionSend(
      `session-send-over-capacity-${crypto.randomUUID()}`,
      'over-capacity',
      async () => {
        starts += 1;
        throw new Error('unexpected extra operation start');
      },
    ),
    /in-flight capacity/,
  );
  const firstRetry = runIdempotentSessionSend(operationIds[0]!, operationIds[0]!, startPending);
  assert.equal(starts, 256);

  for (const release of releases) release();
  await Promise.all([...pending, firstRetry]);
});
