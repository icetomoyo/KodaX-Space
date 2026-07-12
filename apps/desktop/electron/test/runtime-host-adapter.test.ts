import assert from 'node:assert/strict';
import path from 'node:path';
import test, { afterEach } from 'node:test';

import type {
  CreateKodaXRuntimeOptions,
  KodaXRuntime,
  RuntimeRunHandle,
  RuntimeRunResult,
} from '@kodax-ai/kodax/runtime';
import { RuntimeHostAdapter, resolveRuntimeHostMode } from '../kodax/runtime-host-adapter.js';
import {
  loadPersistedTranscript,
  setSessionStoreImpl,
  type SessionStoreImpl,
} from '../kodax/session-store.js';

afterEach(() => {
  setSessionStoreImpl(null);
});

function createFakeRuntime() {
  const calls = {
    created: [] as unknown[],
    loaded: [] as string[],
    started: [] as unknown[],
    aborted: [] as string[],
    transcripts: [] as string[],
    compacted: [] as unknown[],
    forked: [] as unknown[],
    rewound: [] as unknown[],
    close: 0,
  };
  const sessions = new Set<string>();
  const pending = new Map<string, (result: RuntimeRunResult) => void>();
  let runSeq = 0;
  const runtime = {
    identity: {
      runtimeId: 'rt_test',
      mode: 'embedded',
      profile: 'default',
      startedAt: '2026-07-12T00:00:00.000Z',
      version: '0.7.67',
      isolation: 'inline',
    },
    sessions: {
      async load(sessionId: string) {
        calls.loaded.push(sessionId);
        if (!sessions.has(sessionId)) throw new Error(`Session not found: ${sessionId}`);
        return { id: sessionId, title: '' };
      },
      async create(input: { sessionId?: string }) {
        calls.created.push(input);
        const id = input.sessionId ?? `s_${sessions.size + 1}`;
        sessions.add(id);
        return { id, title: '' };
      },
      async transcript(sessionId: string) {
        calls.transcripts.push(sessionId);
        return { title: '', messages: [] };
      },
      async compact(input: unknown) {
        calls.compacted.push(input);
        return { compacted: true, tokensBefore: 200, tokensAfter: 80, messages: [] };
      },
      async fork(input: { sessionId: string }) {
        calls.forked.push(input);
        return { id: `${input.sessionId}_fork`, title: 'fork' };
      },
      async rewind(input: { sessionId: string }) {
        calls.rewound.push(input);
        return { id: input.sessionId, title: 'rewound' };
      },
      async delete() {},
    },
    runs: {
      async start(input: { sessionId: string }): Promise<RuntimeRunHandle> {
        calls.started.push(input);
        const runId = `run_${++runSeq}`;
        const result = new Promise<RuntimeRunResult>((resolve) => pending.set(runId, resolve));
        return { runId, sessionId: input.sessionId, result };
      },
      async abort(runId: string) {
        calls.aborted.push(runId);
        const resolve = pending.get(runId);
        resolve?.({ runId, sessionId: 's_1', phase: 'cancelled' });
        pending.delete(runId);
      },
    },
    events: { subscribe: () => ({ close() {} }), replay: async () => [] },
    permissions: {},
    workflows: {},
    config: {},
    catalog: {},
    mcp: {},
    artifacts: {},
    status: { snapshot: async () => ({}) },
    diagnostics: {},
    admin: { agentRegistrations: {} },
    agents: { enabled: false },
    agentTasks: {},
    async close() {
      calls.close += 1;
    },
  } as unknown as KodaXRuntime;
  return { runtime, calls, sessions, pending };
}

test('resolveRuntimeHostMode defaults to runtime and accepts explicit legacy rollback', () => {
  assert.equal(resolveRuntimeHostMode(undefined), 'runtime');
  assert.equal(resolveRuntimeHostMode('runtime'), 'runtime');
  assert.equal(resolveRuntimeHostMode('legacy'), 'legacy');
  assert.equal(resolveRuntimeHostMode('unexpected'), 'runtime');
});

test('legacy selection never constructs a KodaX Runtime', async () => {
  let factoryCalls = 0;
  const adapter = new RuntimeHostAdapter({
    mode: 'legacy',
    profileRoot: 'C:\\isolated-profile',
    runtimeFactory: async () => {
      factoryCalls += 1;
      return createFakeRuntime().runtime;
    },
  });

  await adapter.initialize();
  assert.equal(factoryCalls, 0);
  assert.equal(adapter.snapshot().selectedHost, 'legacy');
  assert.equal(adapter.snapshot().state, 'legacy');
  assert.equal(
    adapter.snapshot().capabilities.find((item) => item.id === 'runtime.runs')?.owner,
    'legacy',
  );
});

test('runtime selection constructs one inline Runtime with the isolated sessions directory', async () => {
  const fake = createFakeRuntime();
  const options: CreateKodaXRuntimeOptions[] = [];
  const profileRoot = path.resolve('C:\\isolated-profile');
  const adapter = new RuntimeHostAdapter({
    mode: 'runtime',
    profileRoot,
    runtimeFactory: async (input) => {
      options.push(input);
      return fake.runtime;
    },
  });

  await Promise.all([adapter.initialize('0.1.30'), adapter.initialize('ignored-after-start')]);
  assert.equal(options.length, 1);
  assert.equal(options[0]?.mode, 'embedded');
  assert.equal(options[0]?.isolation, 'inline');
  assert.equal(options[0]?.sessionsDir, path.join(profileRoot, 'sessions'));
  assert.equal(options[0]?.clientInfo?.version, '0.1.30');
  assert.equal(adapter.snapshot().state, 'ready');
  assert.equal(adapter.snapshot().identity?.runtimeId, 'rt_test');
  assert.equal(
    adapter.snapshot().capabilities.find((item) => item.id === 'runtime.runs')?.owner,
    'runtime',
  );
  assert.deepEqual(
    adapter.snapshot().capabilities.find((item) => item.id === 'runtime.sessions'),
    {
      id: 'runtime.sessions',
      support: 'partial',
      owner: 'space-bridge',
      reason:
        'Runtime owns transcript, compact, fork, and rewind; Space retains compatible list, resume, title, and delete projections.',
    },
  );
  assert.equal(
    adapter.snapshot().capabilities.find((item) => item.id === 'runtime.externalAgents')?.owner,
    'space-bridge',
  );
});

test('supported session operations use the Runtime facade', async () => {
  const fake = createFakeRuntime();
  const adapter = new RuntimeHostAdapter({
    mode: 'runtime',
    profileRoot: path.resolve('C:\\isolated-profile'),
    runtimeFactory: async () => fake.runtime,
  });

  await adapter.transcript('s_1');
  await adapter.compactSession({ sessionId: 's_1', provider: 'mock' });
  await adapter.forkSession({ sessionId: 's_1', selector: 'entry_1' });
  await adapter.rewindSession({ sessionId: 's_1', selector: 'entry_0' });

  assert.deepEqual(fake.calls.transcripts, ['s_1']);
  assert.deepEqual(fake.calls.compacted, [{ sessionId: 's_1', provider: 'mock' }]);
  assert.deepEqual(fake.calls.forked, [{ sessionId: 's_1', selector: 'entry_1' }]);
  assert.deepEqual(fake.calls.rewound, [{ sessionId: 's_1', selector: 'entry_0' }]);
});

test('Runtime session mutations invalidate the Space transcript compatibility cache', async () => {
  let transcriptReads = 0;
  setSessionStoreImpl({
    listSessions: async () => [],
    forkSession: async () => null,
    rewindSession: async () => null,
    deleteSession: async () => ({ ok: true }),
    loadSession: async () => null,
    loadFullTranscript: async () => {
      transcriptReads += 1;
      return { title: '', messages: [] } as never;
    },
    watchSessions: () => ({ close() {} }),
  } as SessionStoreImpl);
  const fake = createFakeRuntime();
  const adapter = new RuntimeHostAdapter({
    mode: 'runtime',
    profileRoot: path.resolve('C:\\isolated-profile'),
    runtimeFactory: async () => fake.runtime,
  });

  await loadPersistedTranscript('s_1');
  await loadPersistedTranscript('s_1');
  assert.equal(transcriptReads, 1);

  await adapter.compactSession({ sessionId: 's_1', provider: 'mock' });
  await loadPersistedTranscript('s_1');
  assert.equal(transcriptReads, 2);

  await adapter.rewindSession({ sessionId: 's_1', selector: 'entry_0' });
  await loadPersistedTranscript('s_1');
  assert.equal(transcriptReads, 3);
});

test('ensureSession loads first and creates only an absent session', async () => {
  const fake = createFakeRuntime();
  fake.sessions.add('s_existing');
  const adapter = new RuntimeHostAdapter({
    mode: 'runtime',
    profileRoot: path.resolve('C:\\isolated-profile'),
    runtimeFactory: async () => fake.runtime,
  });

  await adapter.ensureSession({
    sessionId: 's_existing',
    projectRoot: 'C:\\repo',
    surface: 'code',
    ephemeral: false,
  });
  await adapter.ensureSession({
    sessionId: 's_new',
    projectRoot: 'C:\\repo',
    surface: 'partner',
    ephemeral: false,
  });

  assert.deepEqual(fake.calls.loaded, ['s_existing', 's_new']);
  assert.equal(fake.calls.created.length, 1);
  assert.deepEqual(fake.calls.created[0], {
    sessionId: 's_new',
    projectPath: 'C:\\repo',
    gitRoot: 'C:\\repo',
    surface: 'partner',
    profileId: 'kodax-space.partner',
    tag: 'partner',
  });
});

test('managed run tracking aborts the active Runtime run and close is idempotent', async () => {
  const fake = createFakeRuntime();
  const adapter = new RuntimeHostAdapter({
    mode: 'runtime',
    profileRoot: path.resolve('C:\\isolated-profile'),
    runtimeFactory: async () => fake.runtime,
  });
  await adapter.ensureSession({
    sessionId: 's_1',
    projectRoot: 'C:\\repo',
    surface: 'code',
    ephemeral: false,
  });

  const handle = await adapter.startManagedRun({
    sessionId: 's_1',
    prompt: 'hello',
    mode: 'managed_task',
    permissionBroker: 'client',
    options: { provider: 'mock' },
  });
  assert.equal(handle.runId, 'run_1');
  assert.equal(adapter.activeRunId('s_1'), 'run_1');
  await adapter.abortSessionRun('s_1');
  assert.deepEqual(fake.calls.aborted, ['run_1']);
  await handle.result;
  assert.equal(adapter.activeRunId('s_1'), undefined);

  await adapter.close();
  await adapter.close();
  assert.equal(fake.calls.close, 1);
});

test('concurrent starts reserve the session before Runtime start resolves', async () => {
  const fake = createFakeRuntime();
  const adapter = new RuntimeHostAdapter({
    mode: 'runtime',
    profileRoot: path.resolve('C:\\isolated-profile'),
    runtimeFactory: async () => fake.runtime,
  });
  await adapter.initialize();

  const firstStart = adapter.startManagedRun({
    sessionId: 's_1',
    prompt: 'first',
    options: { provider: 'mock' },
  });
  await assert.rejects(
    adapter.startManagedRun({
      sessionId: 's_1',
      prompt: 'second',
      options: { provider: 'mock' },
    }),
    /already has an active Space run/,
  );

  const handle = await firstStart;
  assert.equal(fake.calls.started.length, 1);
  await adapter.abortSessionRun('s_1');
  await handle.result;
});

test('close racing initialization closes the late Runtime exactly once', async () => {
  const fake = createFakeRuntime();
  let releaseFactory: ((runtime: KodaXRuntime) => void) | undefined;
  const adapter = new RuntimeHostAdapter({
    mode: 'runtime',
    profileRoot: path.resolve('C:\\isolated-profile'),
    runtimeFactory: () =>
      new Promise<KodaXRuntime>((resolve) => {
        releaseFactory = resolve;
      }),
  });

  const initialization = adapter.initialize();
  const closing = adapter.close();
  releaseFactory?.(fake.runtime);
  await Promise.all([initialization, closing]);

  assert.equal(adapter.snapshot().state, 'closed');
  assert.equal(adapter.hasReadyRuntime(), false);
  assert.equal(fake.calls.close, 1);
});
