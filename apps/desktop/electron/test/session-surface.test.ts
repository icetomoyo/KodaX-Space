// F045 — session 分面 (Coder / Partner) 单测。
//
// 覆盖三层关键不变量：
//   1. schema：sessionMetaSchema.surface 缺省 'code'；create/list input.surface optional。
//   2. mapper：sdkTagToSurface 把 SDK summary.tag 反推回 surface（partner-only，其余归 code）。
//   3. listPersistedSessions：从 mock summary.tag 派生每条 surface。
//   4. host.listMerged({surface})：合并 in-flight ∪ persisted 后按 surface 过滤；
//      无 tag 的历史 session 归 'code'（向后兼容）；不传 surface = 全量。

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { kodaxHost } from '../kodax/host.js';
import { setRendererTarget } from '../ipc/push.js';
import {
  listPersistedSessions,
  SPACE_EPHEMERAL_SESSION_TAG,
  sdkTagToSurface,
} from '../kodax/session-store.js';
import { installSessionStoreMock, type MockSessionState } from './_helpers/session-store-mock.js';

let mockState: MockSessionState;

beforeEach(async () => {
  mockState = installSessionStoreMock();
  await kodaxHost.disposeAll();
  // listMerged / delete 不真正 push 事件，但 host 内部 emit 走 pushToRenderer——给个 no-op target。
  setRendererTarget(
    () =>
      ({
        send: () => undefined,
        isDestroyed: () => false,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      }) as any,
  );
});

afterEach(async () => {
  await kodaxHost.disposeAll();
  setRendererTarget(() => null);
  mockState.reset();
});

// ---- 1. schema 缺省 ----

test('schema: sessionMeta defaults surface to "code" when omitted', async () => {
  // sessionMetaSchema 不单独 export；通过 sessionListChannel.output（其 sessions 数组即
  // sessionMetaSchema）验 default。
  const { sessionListChannel } = await import('@kodax-space/space-ipc-schema');
  const parsed = sessionListChannel.output.parse({
    sessions: [
      {
        sessionId: 's_1',
        projectRoot: '/r',
        provider: 'mock',
        reasoningMode: 'auto',
        createdAt: 1,
        lastActivityAt: 1,
      },
    ],
  });
  assert.equal(parsed.sessions[0]!.surface, 'code');
});

test('schema: create/list input.surface is optional and validates the enum', async () => {
  const { sessionCreateChannel, sessionListChannel } =
    await import('@kodax-space/space-ipc-schema');
  // 缺省合法
  assert.equal(
    sessionCreateChannel.input.safeParse({ projectRoot: '/r', provider: 'mock' }).success,
    true,
  );
  // 显式 partner 合法
  assert.equal(
    sessionCreateChannel.input.safeParse({
      projectRoot: '/r',
      provider: 'mock',
      surface: 'partner',
    }).success,
    true,
  );
  // Quick Ask uses a host-only temporary marker.
  assert.equal(
    sessionCreateChannel.input.safeParse({ projectRoot: '/r', provider: 'mock', ephemeral: true })
      .success,
    true,
  );
  // 非法值被拒
  assert.equal(
    sessionCreateChannel.input.safeParse({ projectRoot: '/r', provider: 'mock', surface: 'docs' })
      .success,
    false,
  );
  // list input.surface 同样 optional
  assert.equal(sessionListChannel.input.safeParse({ surface: 'partner' }).success, true);
  assert.equal(sessionListChannel.input.safeParse(undefined).success, true);
});

test('schema: promoteEphemeral validates a session id', async () => {
  const { sessionPromoteEphemeralChannel } = await import('@kodax-space/space-ipc-schema');
  assert.equal(sessionPromoteEphemeralChannel.input.safeParse({ sessionId: 's_1' }).success, true);
  assert.equal(sessionPromoteEphemeralChannel.input.safeParse({ sessionId: '' }).success, false);
});

// ---- 2. mapper ----

test('sdkTagToSurface: only "partner" maps to partner; everything else → code', () => {
  assert.equal(sdkTagToSurface('partner'), 'partner');
  assert.equal(sdkTagToSurface('code'), 'code');
  assert.equal(sdkTagToSurface(undefined), 'code'); // 历史无 tag
  assert.equal(sdkTagToSurface(''), 'code');
  assert.equal(sdkTagToSurface('something-else'), 'code'); // 未知值保守归 code
});

// ---- 3. listPersistedSessions 派生 surface ----

test('listPersistedSessions: derives surface from SDK summary.tag', async () => {
  mockState.seedTagged('s_partner', '/r', 'partner', 'doc work');
  mockState.seedTagged('s_codetag', '/r', 'code', 'coding');
  mockState.seed('s_legacy', '/r', 'old session'); // 无 tag

  const list = await listPersistedSessions({ projectRoot: '/r' });
  const bySid = new Map(list.map((s) => [s.sessionId, s.surface]));
  assert.equal(bySid.get('s_partner'), 'partner');
  assert.equal(bySid.get('s_codetag'), 'code');
  assert.equal(bySid.get('s_legacy'), 'code'); // 向后兼容
});

test('listPersistedSessions: hides ephemeral tagged sessions', async () => {
  mockState.seedTagged('s_quick', '/r', SPACE_EPHEMERAL_SESSION_TAG, 'quick ask');
  mockState.seedTagged('s_legacy_quick', '/r', 'quick-ask', 'quick ask');
  mockState.seedTagged('s_code', '/r', 'code', 'coding');

  const list = await listPersistedSessions({ projectRoot: '/r' });
  assert.deepEqual(
    list.map((s) => s.sessionId),
    ['s_code'],
  );
});

test('listPersistedSessions: ACP placeholders do not consume the visible session limit', async () => {
  for (let index = 0; index < 240; index += 1) {
    mockState.seedSurface(`acp-${index}`, '/r', 'acp', 'ACP Session');
  }
  for (let index = 0; index < 205; index += 1) {
    mockState.seed(`code-${index}`, '/r', `Real session ${index}`);
  }

  const list = await listPersistedSessions({ projectRoot: '/r' });

  assert.equal(list.length, 200);
  assert.equal(
    list.some((session) => session.title === 'ACP Session'),
    false,
  );
  assert.deepEqual(
    list.slice(0, 3).map((session) => session.sessionId),
    ['code-0', 'code-1', 'code-2'],
  );
});

test('listPersistedSessions: explicit limits apply after filtering non-interactive surfaces', async () => {
  mockState.seedSurface('acp-1', '/r', 'acp', 'ACP Session');
  mockState.seed('code-1', '/r', 'First real session');
  mockState.seedSurface('acp-2', '/r', 'acp', 'ACP Session');
  mockState.seed('code-2', '/r', 'Second real session');

  const list = await listPersistedSessions({ projectRoot: '/r', limit: 1 });
  assert.deepEqual(
    list.map((session) => session.sessionId),
    ['code-1'],
  );
});

test('listPersistedSessions: limits apply after Coder/Partner surface filtering', async () => {
  for (let index = 0; index < 240; index += 1) {
    mockState.seedTagged(`code-${index}`, '/r', 'code', `Code ${index}`);
  }
  for (let index = 0; index < 205; index += 1) {
    mockState.seedTagged(`partner-${index}`, '/r', 'partner', `Partner ${index}`);
  }

  const list = await listPersistedSessions({ projectRoot: '/r', surface: 'partner' });

  assert.equal(list.length, 200);
  assert.equal(
    list.every((session) => session.surface === 'partner'),
    true,
  );
  assert.deepEqual(
    list.slice(0, 3).map((session) => session.sessionId),
    ['partner-0', 'partner-1', 'partner-2'],
  );
});

// ---- 4. host.createSession + listMerged 过滤 ----

test('createSession: defaults surface to "code" and persists explicit surface', () => {
  const a = kodaxHost.createSession({ projectRoot: '/r', provider: 'mock' });
  assert.equal(kodaxHost.get(a.sessionId)?.surface, 'code');
  const b = kodaxHost.createSession({ projectRoot: '/r', provider: 'mock', surface: 'partner' });
  assert.equal(kodaxHost.get(b.sessionId)?.surface, 'partner');
});

test('listMerged({surface}): filters in-flight sessions by surface', async () => {
  kodaxHost.createSession({ projectRoot: '/r', provider: 'mock' }); // code
  kodaxHost.createSession({ projectRoot: '/r', provider: 'mock', surface: 'partner' });

  const all = await kodaxHost.listMerged();
  assert.equal(all.length, 2);

  const coder = await kodaxHost.listMerged({ surface: 'code' });
  assert.equal(coder.length, 1);
  assert.equal(coder[0]!.surface, 'code');

  const partner = await kodaxHost.listMerged({ surface: 'partner' });
  assert.equal(partner.length, 1);
  assert.equal(partner[0]!.surface, 'partner');
});

test('listMerged: hides in-flight ephemeral sessions', async () => {
  kodaxHost.createSession({ projectRoot: '/r', provider: 'mock', ephemeral: true });
  const visible = kodaxHost.createSession({ projectRoot: '/r', provider: 'mock' });

  const all = await kodaxHost.listMerged();
  assert.deepEqual(
    all.map((m) => m.sessionId),
    [visible.sessionId],
  );
});

test('promoteEphemeral: retags hidden persisted session back to Coder', async () => {
  mockState.seedTagged('s_tmp', '/r', SPACE_EPHEMERAL_SESSION_TAG, 'quick ask');
  kodaxHost.createSession({
    projectRoot: '/r',
    provider: 'mock',
    ephemeral: true,
    existingSessionId: 's_tmp',
  });

  const promoted = await kodaxHost.promoteEphemeral('s_tmp');
  assert.equal(promoted, true);
  assert.equal(kodaxHost.get('s_tmp')?.ephemeral, false);

  const list = await listPersistedSessions({ projectRoot: '/r' });
  assert.deepEqual(
    list.map((s) => [s.sessionId, s.surface]),
    [['s_tmp', 'code']],
  );
});

test('listMerged({surface}): filters persisted (tag-derived) sessions and treats untagged as code', async () => {
  mockState.seedTagged('s_p', '/r', 'partner');
  mockState.seed('s_legacy', '/r'); // 无 tag → code

  const partner = await kodaxHost.listMerged({ surface: 'partner' });
  assert.deepEqual(
    partner.map((m) => m.sessionId),
    ['s_p'],
  );

  const coder = await kodaxHost.listMerged({ surface: 'code' });
  assert.deepEqual(coder.map((m) => m.sessionId).sort(), ['s_legacy']);

  // 不传 surface = 全量（含历史无 tag 的）
  const all = await kodaxHost.listMerged();
  assert.equal(all.length, 2);
});
