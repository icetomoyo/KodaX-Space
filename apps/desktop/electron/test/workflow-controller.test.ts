// F060 — WorkflowController: 进程事件转发 + host 归属 + list/get + 归属持久化 + schema round-trip.
// 用 fake run manager（不碰真 SDK / LLM），real tmp-dir 持久化（DI），无 mock 文件系统。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  WorkflowController,
  _setCodingSdkForTesting,
  withDefaultWorkflowAgentTarget,
} from '../kodax/workflow-controller.js';
import { _setRepoIntelEntitlementForTesting } from '../kodax/repo-intel-gate.js';
import type {
  WorkflowRunManagerLike,
  WorkflowLifecycleLike,
} from '../kodax/workflow-controller.js';
import { workflowEventChannel, workflowProcessSnapshotSchema } from '@kodax-space/space-ipc-schema';

// ---- fake run manager（可手动 emit 进程事件 + 持有 snapshot）----
interface FakeSnap {
  runId: string;
  [k: string]: unknown;
}
type FakeEvent = {
  type: 'workflow_started' | 'workflow_updated' | 'workflow_finished';
  snapshot: FakeSnap;
  message?: string;
};

function fakeManager() {
  let listener: ((e: FakeEvent) => void) | null = null;
  const snaps = new Map<string, FakeSnap>();
  const started: Record<string, unknown>[] = [];
  const mgr: WorkflowRunManagerLike & {
    started: typeof started;
    _emit(e: FakeEvent): void;
    _seed(s: FakeSnap): void;
  } = {
    started,
    subscribeWorkflowProcess(l) {
      listener = l as (e: FakeEvent) => void;
      return () => {
        listener = null;
      };
    },
    getWorkflowProcessSnapshot(id) {
      return snaps.get(id) as never;
    },
    listWorkflowProcessSnapshots() {
      return [...snaps.values()] as never;
    },
    startFromOptions(input) {
      started.push(input);
      return { runId: (input as { runId?: string }).runId };
    },
    _emit(e) {
      snaps.set(e.snapshot.runId, e.snapshot);
      listener?.(e);
    },
    _seed(s) {
      snaps.set(s.runId, s);
    },
  };
  return mgr;
}

// 一个通过 schema 校验的最小有效 snapshot。
function sampleSnapshot(runId: string, over: Record<string, unknown> = {}): FakeSnap {
  return {
    runId,
    workflowName: 'parallel-investigation',
    status: 'running',
    startedAt: '2026-06-17T00:00:00.000Z',
    updatedAt: '2026-06-17T00:00:01.000Z',
    items: [
      { id: 'p1', title: 'Find', kind: 'phase', status: 'running' },
      { id: 'a1', title: 'finder:bugs', kind: 'agent', status: 'completed', phaseId: 'p1' },
    ],
    counts: { pending: 0, running: 1, completed: 1, failed: 0, cancelled: 0, skipped: 0 },
    progress: {
      spawnedAgents: 1,
      finishedAgents: 1,
      activeAgents: 0,
      failedAgents: 0,
      stoppedAgents: 0,
    },
    ...over,
  };
}

function freshFile(): { dir: string; file: string } {
  const dir = mkdtempSync(join(tmpdir(), 'wf-ctrl-'));
  return { dir, file: join(dir, 'workflow-origins.json') };
}

test('launcher default Agent target is injected while authored targets keep precedence', async () => {
  const calls: Array<Record<string, unknown>> = [];
  const receivers: unknown[] = [];
  const workflow = {
    async spawnAgent(input: Record<string, unknown>) {
      receivers.push(this);
      calls.push(input);
      return input;
    },
    async runAgent(input: Record<string, unknown>) {
      receivers.push(this);
      calls.push(input);
      return input;
    },
  };
  const module = withDefaultWorkflowAgentTarget(
    {
      async run(api: typeof workflow) {
        await api.spawnAgent({ task: 'catalog-default' });
        await api.runAgent({
          task: 'authored-override',
          target: { agentId: 'agent_authored', expectedConfigurationRevision: 'rev-authored' },
        });
      },
    },
    { agentId: 'agent_catalog', expectedConfigurationRevision: 'rev-catalog' },
  ) as { run(api: typeof workflow, args?: unknown): Promise<void> };

  await module.run(workflow);

  assert.deepEqual(calls[0]?.target, {
    agentId: 'agent_catalog',
    expectedConfigurationRevision: 'rev-catalog',
  });
  assert.deepEqual(calls[1]?.target, {
    agentId: 'agent_authored',
    expectedConfigurationRevision: 'rev-authored',
  });
  assert.deepEqual(receivers, [workflow, workflow]);
});

test('subscribe forwards process events to renderer (no attribution when origin unknown)', async () => {
  const { dir, file } = freshFile();
  try {
    const pushed: unknown[] = [];
    const ctrl = new WorkflowController((p) => pushed.push(p), file);
    const mgr = fakeManager();
    await ctrl.init(mgr);

    mgr._emit({ type: 'workflow_started', snapshot: sampleSnapshot('r1') });
    assert.equal(pushed.length, 1);
    const p0 = pushed[0] as { type: string; snapshot: { runId: string }; sessionId?: string };
    assert.equal(p0.type, 'workflow_started');
    assert.equal(p0.snapshot.runId, 'r1');
    assert.equal(p0.sessionId, undefined); // 未登记归属
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('registerOrigin attributes subsequent events + list + get', async () => {
  const { dir, file } = freshFile();
  try {
    const pushed: Array<{
      sessionId?: string;
      surface?: string;
      projectRoot?: string;
      snapshot: { runId: string };
    }> = [];
    const ctrl = new WorkflowController((p) => pushed.push(p as never), file);
    const mgr = fakeManager();
    await ctrl.init(mgr);

    const projectRoot = join(dir, 'project');
    ctrl.registerOrigin('r1', { sessionId: 's_abc', surface: 'code', projectRoot });
    mgr._emit({ type: 'workflow_updated', snapshot: sampleSnapshot('r1'), message: 'phase 2' });

    assert.equal(pushed.length, 1);
    assert.equal(pushed[0]?.sessionId, 's_abc');
    assert.equal(pushed[0]?.surface, 'code');
    assert.equal(pushed[0]?.projectRoot, projectRoot);

    // list + get 也带归属
    const list = ctrl.list();
    assert.equal(list.length, 1);
    assert.equal(list[0]?.sessionId, 's_abc');
    assert.equal(list[0]?.projectRoot, projectRoot);
    const got = ctrl.get('r1');
    assert.equal(got?.sessionId, 's_abc');
    assert.equal(got?.projectRoot, projectRoot);
    assert.equal(ctrl.get('nope'), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('hostMetadata attributes events + list + get without local origin registration', async () => {
  const { dir, file } = freshFile();
  try {
    const pushed: Array<{
      sessionId?: string;
      surface?: string;
      projectRoot?: string;
      snapshot: { runId: string };
    }> = [];
    const ctrl = new WorkflowController((p) => pushed.push(p as never), file);
    const mgr = fakeManager();
    await ctrl.init(mgr);
    const projectRoot = join(dir, 'project');

    mgr._emit({
      type: 'workflow_updated',
      snapshot: sampleSnapshot('r_meta', {
        hostMetadata: { sessionId: 's_meta', surface: 'partner', projectRoot },
      }),
      message: 'phase 2',
    });

    assert.equal(pushed.length, 1);
    assert.equal(pushed[0]?.sessionId, 's_meta');
    assert.equal(pushed[0]?.surface, 'partner');
    assert.equal(pushed[0]?.projectRoot, projectRoot);
    assert.equal(ctrl.get('r_meta')?.sessionId, 's_meta');
    assert.equal(ctrl.get('r_meta')?.projectRoot, projectRoot);
    assert.equal(ctrl.list('s_meta')[0]?.runId, 'r_meta');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('list and get restore completed workflow runs from durable run.json', async () => {
  const { dir, file } = freshFile();
  const runBaseDir = join(dir, 'workflow-runs');
  const runId = 'wf_persisted_history';
  const runDir = join(runBaseDir, runId);
  const artifactsDir = join(runDir, 'artifacts');
  const projectRoot = join(dir, 'project');
  try {
    mkdirSync(artifactsDir, { recursive: true });
    writeFileSync(
      join(runDir, 'manifest.json'),
      JSON.stringify({ patterns: ['fan-out-and-synthesize'] }),
    );
    writeFileSync(
      join(runDir, 'events.jsonl'),
      [
        { seq: 1, type: 'workflow_started', data: { runId }, ts: 1781654400000 },
        { seq: 2, type: 'phase_started', data: { name: 'Collect facts' }, ts: 1781654401000 },
        {
          seq: 3,
          type: 'agent_spawned',
          data: { taskId: 'agent-1', name: 'History reviewer' },
          ts: 1781654402000,
        },
        {
          seq: 4,
          type: 'agent_completed',
          data: {
            taskId: 'agent-1',
            name: 'History reviewer',
            status: 'completed',
            provider: 'mock-provider',
            summaryKind: 'pending',
            summary: 'Raw long child result should not be surfaced as a digest yet.',
          },
          ts: 1781654403000,
        },
        {
          seq: 5,
          type: 'agent_summary_updated',
          data: {
            taskId: 'agent-1',
            name: 'History reviewer',
            summaryKind: 'digest',
            summary: 'Recovered child agent digest.',
          },
          ts: 1781654404000,
        },
        { seq: 6, type: 'phase_finished', data: { name: 'Collect facts' }, ts: 1781654405000 },
        { seq: 7, type: 'artifact_written', data: { name: 'final-report' }, ts: 1781654406000 },
        {
          seq: 8,
          type: 'workflow_completed',
          data: { resultSummary: '# Persisted final report\n\nRecovered from disk.' },
          ts: 1781654460000,
        },
      ]
        .map((event) => JSON.stringify(event))
        .join('\n'),
    );
    writeFileSync(
      join(artifactsDir, 'final-report.json'),
      JSON.stringify({ report: '# Durable artifact report\n\nFull persisted body.' }),
    );
    writeFileSync(
      join(runDir, 'run.json'),
      JSON.stringify({
        runId,
        workflow: 'Persisted Review',
        status: 'completed',
        startedAt: 1781654400000,
        endedAt: 1781654460000,
        totalSpawned: 1,
        args: { request: 'Review all current changes' },
        artifacts: ['final-report'],
        resultSummary: '# Persisted final report\n\nRecovered from disk.',
        hostMetadata: { sessionId: 's_hist', surface: 'code', projectRoot },
      }),
    );

    const ctrl = new WorkflowController(() => {}, file, runBaseDir);
    await ctrl.init(fakeManager());

    const runs = ctrl.list();
    assert.equal(runs.length, 1);
    assert.equal(runs[0]?.runId, runId);
    assert.equal(runs[0]?.workflowName, 'Persisted Review');
    assert.equal(runs[0]?.status, 'completed');
    assert.equal(runs[0]?.sessionId, 's_hist');
    assert.equal(runs[0]?.surface, 'code');
    assert.equal(runs[0]?.projectRoot, projectRoot);
    assert.deepEqual(runs[0]?.patterns, ['fan-out-and-synthesize']);
    assert.equal(runs[0]?.artifacts?.[0]?.name, 'final-report');
    assert.equal(runs[0]?.goal, 'Review all current changes');
    assert.equal(runs[0]?.items.length, 3);
    assert.equal(runs[0]?.items[0]?.title, 'Collect facts');
    assert.equal(runs[0]?.items[1]?.title, 'History reviewer');
    assert.equal(runs[0]?.items[1]?.summary, 'Recovered child agent digest.');
    assert.equal(runs[0]?.items[1]?.summaryStatus, 'result');
    assert.equal(runs[0]?.items[2]?.kind, 'artifact');

    const got = ctrl.get(runId);
    assert.equal(got?.runId, runId);
    assert.equal(got?.resultSummary, '# Persisted final report\n\nRecovered from disk.');
    assert.equal(ctrl.list('s_hist')[0]?.runId, runId);
    assert.equal(await ctrl.readResult(runId), '# Durable artifact report\n\nFull persisted body.');
    assert.deepEqual(await ctrl.readArtifact(runId, 'final-report'), {
      report: '# Durable artifact report\n\nFull persisted body.',
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('list/get restore AMAW run_workflow runs whose id has the SDK "run-" prefix (regression)', async () => {
  // Regression: the durable-scan filter + run-dir path guard used to require a `wf_` prefix, so
  // every AMAW run_workflow run (the SDK ids them `run-<...>`) was silently excluded from the
  // disk scan and from get()/result — after a restart those runs, and all their transcript
  // notices + left/right-sidebar UI, disappeared, even though run.json + hostMetadata.sessionId
  // were correctly persisted on disk (the conversation was unaffected: separate SDK transcript).
  const { dir, file } = freshFile();
  const runBaseDir = join(dir, 'workflow-runs');
  const runId = 'run-mr4oxcg4';
  const runDir = join(runBaseDir, runId);
  const projectRoot = join(dir, 'project');
  try {
    mkdirSync(runDir, { recursive: true });
    writeFileSync(
      join(runDir, 'run.json'),
      JSON.stringify({
        runId,
        workflowName: 'review-since-v0.1.26',
        status: 'completed',
        startedAt: '2026-07-03T09:24:56.000Z',
        updatedAt: '2026-07-03T09:40:00.000Z',
        items: [],
        counts: { pending: 0, running: 0, completed: 0, failed: 0, cancelled: 0, skipped: 0 },
        progress: {
          spawnedAgents: 0,
          finishedAgents: 0,
          activeAgents: 0,
          failedAgents: 0,
          stoppedAgents: 0,
        },
        hostMetadata: { sessionId: 's_amaw', surface: 'code', projectRoot },
      }),
    );
    const ctrl = new WorkflowController(() => {}, file, runBaseDir);
    assert.equal(
      ctrl.list().find((r) => r.runId === runId)?.sessionId,
      's_amaw',
      'run-<...> AMAW run must appear in list() after restart',
    );
    assert.equal(ctrl.list('s_amaw')[0]?.runId, runId);
    assert.equal(ctrl.get(runId)?.sessionId, 's_amaw');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('list and get recover completed workflow runs from durable events without run.json', async () => {
  const { dir, file } = freshFile();
  const runBaseDir = join(dir, 'workflow-runs');
  const runId = 'wf_events_only_history';
  const runDir = join(runBaseDir, runId);
  const artifactsDir = join(runDir, 'artifacts');
  try {
    mkdirSync(artifactsDir, { recursive: true });
    writeFileSync(
      join(runDir, 'manifest.json'),
      JSON.stringify({
        name: 'Events Only Review',
        phases: ['Collect facts', 'Synthesize report'],
        patterns: ['fan-out-and-synthesize'],
      }),
    );
    writeFileSync(
      join(runDir, 'events.jsonl'),
      [
        { seq: 1, type: 'workflow_started', data: { runId }, ts: 1781654400000 },
        { seq: 2, type: 'phase_started', data: { name: 'Collect facts' }, ts: 1781654401000 },
        {
          seq: 3,
          type: 'agent_spawned',
          data: { taskId: 'agent-1', name: 'History reviewer' },
          ts: 1781654402000,
        },
        {
          seq: 4,
          type: 'agent_completed',
          data: {
            taskId: 'agent-1',
            name: 'History reviewer',
            status: 'completed',
            provider: 'mock-provider',
            summaryKind: 'digest',
            summary: 'Recovered digest from events-only run.',
          },
          ts: 1781654403000,
        },
        {
          seq: 5,
          type: 'agent_spawned',
          data: { taskId: 'agent-2', name: 'Interrupted reviewer' },
          ts: 1781654403500,
        },
        {
          seq: 6,
          type: 'agent_stopped',
          data: { taskId: 'agent-2', name: 'Interrupted reviewer', error: 'Workflow aborted' },
          ts: 1781654403600,
        },
        { seq: 7, type: 'phase_finished', data: { name: 'Collect facts' }, ts: 1781654405000 },
        {
          seq: 8,
          type: 'agent_spawned',
          data: { taskId: 'agent-3', name: 'Synthesize report' },
          ts: 1781654405500,
        },
        {
          seq: 9,
          type: 'agent_completed',
          data: {
            taskId: 'agent-3',
            name: 'Synthesize report',
            status: 'completed',
            summaryKind: 'digest',
            summary: 'Synthesized a durable report.',
          },
          ts: 1781654406000,
        },
        { seq: 10, type: 'synthesis_completed', ts: 1781654406100 },
        { seq: 11, type: 'artifact_written', data: { name: 'final-report' }, ts: 1781654406200 },
      ]
        .map((event) => JSON.stringify(event))
        .join('\n'),
    );
    writeFileSync(
      join(artifactsDir, 'final-report.json'),
      JSON.stringify({ report: '# Events-only durable report\n\nRecovered from artifact.' }),
    );

    const ctrl = new WorkflowController(() => {}, file, runBaseDir);
    await ctrl.init(fakeManager());
    writeFileSync(
      file,
      JSON.stringify({
        version: 1,
        origins: { [runId]: { sessionId: 's_events', surface: 'code', projectRoot: dir } },
      }),
    );

    const runs = ctrl.list();
    assert.equal(runs.length, 1);
    assert.equal(runs[0]?.runId, runId);
    assert.equal(runs[0]?.workflowName, 'Events Only Review');
    assert.equal(runs[0]?.status, 'completed');
    assert.equal(runs[0]?.sessionId, 's_events');
    assert.equal(runs[0]?.projectRoot, dir);
    assert.deepEqual(runs[0]?.patterns, ['fan-out-and-synthesize']);
    assert.equal(runs[0]?.phaseCount, 2);
    assert.equal(runs[0]?.artifacts?.[0]?.name, 'final-report');
    assert.equal(
      runs[0]?.items.some((item) => item.title === 'Synthesize report'),
      true,
    );
    assert.equal(
      runs[0]?.items.find((item) => item.title === 'Interrupted reviewer')?.status,
      'cancelled',
    );
    assert.equal(
      runs[0]?.items.find((item) => item.title === 'History reviewer')?.summary,
      'Recovered digest from events-only run.',
    );
    assert.equal(
      await ctrl.readResult(runId),
      '# Events-only durable report\n\nRecovered from artifact.',
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('manifest patterns are surfaced on workflow snapshots', async () => {
  const { dir, file } = freshFile();
  const runBaseDir = join(dir, 'workflow-runs');
  try {
    const pushed: unknown[] = [];
    const ctrl = new WorkflowController((p) => pushed.push(p), file, runBaseDir);
    const mgr = fakeManager();
    await ctrl.init(mgr);

    const runDir = join(runBaseDir, 'wf_pattern');
    mkdirSync(runDir, { recursive: true });
    const manifestPath = join(runDir, 'manifest.json');
    writeFileSync(
      manifestPath,
      JSON.stringify({ patterns: ['fan-out-and-synthesize', 'adversarial-verification'] }),
    );

    mgr._emit({
      type: 'workflow_updated',
      snapshot: sampleSnapshot('wf_pattern', { manifestSnapshotPath: manifestPath }),
    });

    const parsed = workflowEventChannel.payload.safeParse(pushed[0]);
    assert.ok(parsed.success, parsed.success ? '' : JSON.stringify(parsed.error.issues));
    assert.deepEqual(parsed.success && parsed.data.snapshot.patterns, [
      'fan-out-and-synthesize',
      'adversarial-verification',
    ]);
    assert.deepEqual(ctrl.get('wf_pattern')?.patterns, [
      'fan-out-and-synthesize',
      'adversarial-verification',
    ]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('list filters by sessionId; external (unattributed) run excluded from a session filter', async () => {
  const { dir, file } = freshFile();
  try {
    const ctrl = new WorkflowController(() => {}, file);
    const mgr = fakeManager();
    await ctrl.init(mgr);
    mgr._seed(sampleSnapshot('r1'));
    mgr._seed(sampleSnapshot('r2'));
    ctrl.registerOrigin('r1', { sessionId: 's1', surface: 'code' });
    // r2 无归属（模拟 REPL/CLI 外部发起）

    assert.equal(ctrl.list().length, 2); // 不过滤 = 全部
    const forS1 = ctrl.list('s1');
    assert.equal(forS1.length, 1);
    assert.equal(forS1[0]?.runId, 'r1');
    assert.equal(ctrl.list('other').length, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('origins persist across controller instances (interim attribution survives restart)', async () => {
  const { dir, file } = freshFile();
  try {
    const ctrl1 = new WorkflowController(() => {}, file);
    await ctrl1.init(fakeManager());
    ctrl1.registerOrigin('r1', { sessionId: 's_persist', surface: 'partner' });
    await ctrl1.flush();
    assert.ok(existsSync(file), 'origins file written');

    // 新实例（模拟重启），同文件 + 重新 seed snapshot
    const ctrl2 = new WorkflowController(() => {}, file);
    const mgr2 = fakeManager();
    await ctrl2.init(mgr2);
    mgr2._seed(sampleSnapshot('r1'));

    const got = ctrl2.get('r1');
    assert.equal(got?.sessionId, 's_persist');
    assert.equal(got?.surface, 'partner');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---- F062 控制方法 ----
function fakeLifecycle() {
  const calls: Array<[string, unknown[]]> = [];
  const lc: WorkflowLifecycleLike & { calls: typeof calls } = {
    calls,
    async stopWorkflow(runId, reason) {
      calls.push(['stop', [runId, reason]]);
      return true;
    },
    async pauseWorkflow(runId) {
      calls.push(['pause', [runId]]);
      return true;
    },
    async resumeWorkflow(runId) {
      calls.push(['resume', [runId]]);
      return true;
    },
    async renameWorkflowRun(runId, name) {
      calls.push(['rename', [runId, name]]);
      return true;
    },
    async deleteWorkflowRun(runId, opts) {
      calls.push(['delete', [runId, opts]]);
      return true;
    },
    async pruneWorkflowRuns(opts) {
      calls.push(['prune', [opts]]);
      return {
        deleted: 2,
        protectedRuns: 1,
        candidates: ['r1', 'r2'],
        dryRun: opts.dryRun ?? false,
      };
    },
    async readWorkflowResult(runId) {
      calls.push(['readResult', [runId]]);
      return `result for ${runId}`;
    },
    async readWorkflowArtifact(runId, name) {
      calls.push(['readArtifact', [runId, name]]);
      return `# ${name}\nartifact body`;
    },
  };
  return lc;
}

test('stop/pause/resume/rename delegate to lifecycle controller', async () => {
  const { dir, file } = freshFile();
  try {
    const ctrl = new WorkflowController(() => {}, file);
    const lc = fakeLifecycle();
    await ctrl.init(fakeManager(), lc);
    assert.equal(await ctrl.stop('r1', 'because'), true);
    assert.equal(await ctrl.pause('r1'), true);
    assert.equal(await ctrl.resume('r1'), true);
    assert.equal(await ctrl.rename('r1', 'New Name'), true);
    assert.deepEqual(lc.calls, [
      ['stop', ['r1', 'because']],
      ['pause', ['r1']],
      ['resume', ['r1']],
      ['rename', ['r1', 'New Name']],
    ]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('stop pushes an immediate cancelled snapshot fallback', async () => {
  const { dir, file } = freshFile();
  try {
    const pushed: unknown[] = [];
    const ctrl = new WorkflowController((p) => pushed.push(p), file);
    const lc = fakeLifecycle();
    const mgr = fakeManager();
    await ctrl.init(mgr, lc);
    ctrl.registerOrigin('r1', { sessionId: 's1', surface: 'code' });
    await ctrl.flush();
    mgr._seed(
      sampleSnapshot('r1', {
        items: [
          { id: 'p1', title: 'Find', kind: 'phase', status: 'running' },
          { id: 'a1', title: 'finder:bugs', kind: 'agent', status: 'pending', phaseId: 'p1' },
        ],
        counts: { pending: 1, running: 1, completed: 0, failed: 0, cancelled: 0, skipped: 0 },
        progress: {
          spawnedAgents: 1,
          finishedAgents: 0,
          activeAgents: 1,
          failedAgents: 0,
          stoppedAgents: 0,
        },
      }),
    );

    assert.equal(await ctrl.stop('r1', 'user stop'), true);
    assert.equal(pushed.length, 1);
    const parsed = workflowEventChannel.payload.safeParse(pushed[0]);
    assert.ok(parsed.success, parsed.success ? '' : JSON.stringify(parsed.error.issues));
    if (parsed.success) {
      assert.equal(parsed.data.type, 'workflow_finished');
      assert.equal(parsed.data.sessionId, 's1');
      assert.equal(parsed.data.snapshot.status, 'cancelled');
      assert.deepEqual(
        parsed.data.snapshot.items.map((item) => item.status),
        ['cancelled', 'skipped'],
      );
      assert.equal(parsed.data.snapshot.counts.cancelled, 1);
      assert.equal(parsed.data.snapshot.counts.skipped, 1);
      assert.equal(parsed.data.snapshot.progress.activeAgents, 0);
      assert.equal(parsed.data.snapshot.progress.stoppedAgents, 1);
      assert.equal(parsed.data.snapshot.latestMessage, 'user stop');
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('stop returns after local fallback when lifecycle stop hangs', async () => {
  const { dir, file } = freshFile();
  try {
    const pushed: unknown[] = [];
    const ctrl = new WorkflowController((p) => pushed.push(p), file);
    const lc = fakeLifecycle();
    lc.stopWorkflow = async (runId, reason) => {
      lc.calls.push(['stop', [runId, reason]]);
      return new Promise<boolean>(() => {});
    };
    const mgr = fakeManager();
    await ctrl.init(mgr, lc);
    mgr._seed(sampleSnapshot('r1'));

    const result = await Promise.race([
      ctrl.stop('r1', 'user stop'),
      new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), 100)),
    ]);
    assert.equal(result, true);
    assert.equal(pushed.length, 1);
    assert.deepEqual(lc.calls.at(-1), ['stop', ['r1', 'user stop']]);
    const parsed = workflowEventChannel.payload.safeParse(pushed[0]);
    assert.ok(parsed.success, parsed.success ? '' : JSON.stringify(parsed.error.issues));
    if (parsed.success) {
      assert.equal(parsed.data.type, 'workflow_finished');
      assert.equal(parsed.data.snapshot.status, 'cancelled');
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('deleteRun drops local origin on success; prune returns lifecycle result', async () => {
  const { dir, file } = freshFile();
  try {
    const ctrl = new WorkflowController(() => {}, file);
    const lc = fakeLifecycle();
    const mgr = fakeManager();
    await ctrl.init(mgr, lc);
    ctrl.registerOrigin('r1', { sessionId: 's1', surface: 'code' });
    mgr._seed(sampleSnapshot('r1'));
    await ctrl.flush();

    assert.equal(await ctrl.deleteRun('r1', true), true);
    assert.deepEqual(lc.calls.at(-1), ['delete', ['r1', { force: true }]]);
    // 归属被清（get 不再带 sessionId — 虽 snapshot 还在 fake manager 里）
    assert.equal(ctrl.get('r1')?.sessionId, undefined);

    const res = await ctrl.prune({ keep: 5, dryRun: true });
    assert.equal(res.deleted, 2);
    assert.equal(res.dryRun, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('control methods degrade safely when no lifecycle injected (fake manager path)', async () => {
  const { dir, file } = freshFile();
  try {
    const ctrl = new WorkflowController(() => {}, file);
    // 只注入 manager，不注入 lifecycle → 不自动建真 SDK lifecycle（managerInjected=true）。
    await ctrl.init(fakeManager());
    assert.equal(await ctrl.stop('r1'), false);
    assert.equal(await ctrl.pause('r1'), false);
    assert.equal(await ctrl.rename('r1', 'x'), false);
    assert.equal(await ctrl.deleteRun('r1'), false);
    const res = await ctrl.prune({ keep: 1 });
    assert.deepEqual(res, { deleted: 0, protectedRuns: 0, candidates: [], dryRun: false });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---- F063 库 / 启动（用真 SDK 解析 module，但 startFromOptions 是 fake → 不跑、不花 token）----
const LAUNCH_SESSION = {
  sessionId: 's1',
  surface: 'code' as const,
  provider: 'mock',
  reasoningMode: 'auto',
  agentMode: 'ama',
  projectRoot: process.cwd(),
};

function generatedWorkflow(name = 'generated-workflow') {
  const manifest = { name, description: 'Generated workflow', patterns: ['investigate'] };
  const source = 'export default {}';
  return {
    kind: 'generated' as const,
    manifest,
    source,
    module: { meta: { name } },
    scriptSnapshot: { manifest, source },
  };
}

function generatedCapsule(name = 'generated-workflow') {
  const manifest = { name, description: 'Generated workflow', patterns: ['investigate'] };
  return { manifest, source: 'export default {}' };
}

test('generated workflow controller methods delegate to SDK and start/save successfully', async () => {
  const { dir, file } = freshFile();
  try {
    const calls: string[] = [];
    const sdk = {
      async generateWorkflowFromOptions() {
        calls.push('generate');
        return generatedWorkflow('new-flow');
      },
      async loadGeneratedWorkflowFromRun() {
        calls.push('load-run');
        return { capsule: generatedCapsule('old-flow'), module: { meta: { name: 'old-flow' } } };
      },
      async preflightWorkflowCapsule() {
        calls.push('preflight');
        return { ok: true, issues: [] };
      },
      async saveGeneratedWorkflowFromRun(input: { name: string }) {
        calls.push(`save-run:${input.name}`);
        return { name: input.name, path: '/tmp/saved.workflow.ts' };
      },
      async renameSavedWorkflow(input: { newName: string }) {
        calls.push(`rename-saved:${input.newName}`);
        return { name: input.newName, path: '/tmp/renamed.workflow.ts' };
      },
      async deleteSavedWorkflow(input: { name: string }) {
        calls.push(`delete-saved:${input.name}`);
        return { name: input.name, path: '/tmp/deleted.workflow.ts' };
      },
    };
    _setCodingSdkForTesting(sdk);

    const ctrl = new WorkflowController(() => {}, file);
    const mgr = fakeManager();
    await ctrl.init(mgr);

    const created = await ctrl.createGeneratedWorkflow('make a workflow', LAUNCH_SESSION);
    assert.ok('runId' in created, JSON.stringify(created));
    assert.equal(mgr.started.length, 1);
    assert.equal((mgr.started[0]!.processMetadata as { source?: string }).source, 'command');

    const rerun = await ctrl.rerunGeneratedWorkflow('wf_run_1', { foo: true }, LAUNCH_SESSION);
    assert.ok('runId' in rerun, JSON.stringify(rerun));
    assert.equal(mgr.started.length, 2);

    assert.deepEqual(
      await ctrl.saveGeneratedWorkflowFromRun('wf_run_1', 'saved-name', process.cwd()),
      {
        name: 'saved-name',
        path: '/tmp/saved.workflow.ts',
      },
    );
    assert.deepEqual(await ctrl.renameSavedWorkflow('saved-name', 'renamed', process.cwd()), {
      name: 'renamed',
      path: '/tmp/renamed.workflow.ts',
    });
    assert.deepEqual(await ctrl.deleteSavedWorkflow('renamed', process.cwd()), {
      name: 'renamed',
      path: '/tmp/deleted.workflow.ts',
    });
    assert.deepEqual(calls, [
      'generate',
      'load-run',
      'preflight',
      'save-run:saved-name',
      'rename-saved:renamed',
      'delete-saved:renamed',
    ]);
  } finally {
    _setCodingSdkForTesting(null);
    rmSync(dir, { recursive: true, force: true });
  }
});

test('generated workflow run helpers reject unsafe runId before filesystem access', async () => {
  const { dir, file } = freshFile();
  try {
    let loadRunCalled = false;
    let saveRunCalled = false;
    _setCodingSdkForTesting({
      async loadGeneratedWorkflowFromRun() {
        loadRunCalled = true;
        return { capsule: generatedCapsule('unsafe-flow'), module: {} };
      },
      async saveGeneratedWorkflowFromRun(input: { name: string }) {
        saveRunCalled = true;
        return { name: input.name, path: '/tmp/unsafe.workflow.ts' };
      },
      async generateWorkflowFromOptions() {
        return generatedWorkflow('unsafe-flow');
      },
    });

    const ctrl = new WorkflowController(() => {}, file);
    await ctrl.init(fakeManager());

    assert.deepEqual(await ctrl.rerunGeneratedWorkflow('../outside', {}, LAUNCH_SESSION), {
      error: 'invalid runId',
    });
    assert.deepEqual(
      await ctrl.saveGeneratedWorkflowFromRun('wf_../outside', 'saved-name', process.cwd()),
      { error: 'invalid runId' },
    );
    assert.deepEqual(
      await ctrl.reviseWorkflow({
        target: 'wf_../outside',
        request: 'revise',
        session: LAUNCH_SESSION,
      }),
      { error: 'invalid runId' },
    );
    assert.equal(loadRunCalled, false);
    assert.equal(saveRunCalled, false);
  } finally {
    _setCodingSdkForTesting(null);
    rmSync(dir, { recursive: true, force: true });
  }
});

test('reviseWorkflow handles discovery failure inside error contract', async () => {
  const { dir, file } = freshFile();
  try {
    const savedNames: string[] = [];
    _setCodingSdkForTesting({
      async loadGeneratedWorkflowFromRun() {
        return { capsule: generatedCapsule('base-flow'), module: {} };
      },
      async generateWorkflowFromOptions() {
        return generatedWorkflow('base-flow');
      },
      async discoverSavedWorkflows() {
        throw new Error('disk unavailable');
      },
      async saveGeneratedWorkflow(input: { name: string }) {
        savedNames.push(input.name);
        return { name: input.name, path: '/tmp/revision.workflow.ts' };
      },
    });

    const ctrl = new WorkflowController(() => {}, file);
    await ctrl.init(fakeManager());
    const result = await ctrl.reviseWorkflow({
      target: 'wf_run_1',
      request: 'tighten validation',
      session: LAUNCH_SESSION,
    });

    assert.ok(!('error' in result), JSON.stringify(result));
    assert.match(result.name, /^base-flow-revision-/);
    assert.deepEqual(savedNames, [result.name]);
  } finally {
    _setCodingSdkForTesting(null);
    rmSync(dir, { recursive: true, force: true });
  }
});

test('reviseWorkflow validates replace target before loading run artifacts', async () => {
  const { dir, file } = freshFile();
  try {
    let loaded = false;
    _setCodingSdkForTesting({
      async loadGeneratedWorkflowFromRun() {
        loaded = true;
        return { capsule: generatedCapsule(), module: {} };
      },
      async generateWorkflowFromOptions() {
        return generatedWorkflow();
      },
    });

    const ctrl = new WorkflowController(() => {}, file);
    await ctrl.init(fakeManager());
    const result = await ctrl.reviseWorkflow({
      target: 'wf_run_1',
      request: 'change it',
      replace: true,
      session: LAUNCH_SESSION,
    });

    assert.deepEqual(result, { error: 'revise --replace requires a saved workflow name target' });
    assert.equal(loaded, false);
  } finally {
    _setCodingSdkForTesting(null);
    rmSync(dir, { recursive: true, force: true });
  }
});

test('rerunGeneratedWorkflow logs direct preflight fallback before boxed retry', async () => {
  const { dir, file } = freshFile();
  const originalWarn = console.warn;
  const warnings: unknown[][] = [];
  try {
    console.warn = (...args: unknown[]) => {
      warnings.push(args);
    };
    let preflightCalls = 0;
    _setCodingSdkForTesting({
      async loadGeneratedWorkflowFromRun() {
        return {
          capsule: generatedCapsule('preflight-flow'),
          module: { meta: { name: 'preflight-flow' } },
        };
      },
      async preflightWorkflowCapsule(input: unknown) {
        preflightCalls += 1;
        if (!('capsule' in (input as Record<string, unknown>))) throw new Error('old signature');
        return { ok: true, issues: [] };
      },
    });

    const ctrl = new WorkflowController(() => {}, file);
    await ctrl.init(fakeManager());
    const result = await ctrl.rerunGeneratedWorkflow('wf_run_1', {}, LAUNCH_SESSION);

    assert.ok('runId' in result, JSON.stringify(result));
    assert.equal(preflightCalls, 2);
    assert.ok(
      warnings.some((args) =>
        String(args[0]).includes('preflightWorkflowCapsule direct call failed'),
      ),
      JSON.stringify(warnings),
    );
  } finally {
    console.warn = originalWarn;
    _setCodingSdkForTesting(null);
    rmSync(dir, { recursive: true, force: true });
  }
});

test('start: builtin workflow resolves via real SDK + startFromOptions + origin registered', async () => {
  const { dir, file } = freshFile();
  try {
    const ctrl = new WorkflowController(() => {}, file);
    const mgr = fakeManager();
    await ctrl.init(mgr); // fake manager, no lifecycle
    const res = await ctrl.start({
      target: 'parallel-investigation',
      source: 'builtin',
      session: LAUNCH_SESSION,
    });
    assert.ok('runId' in res, JSON.stringify(res));
    if ('runId' in res) {
      assert.ok(res.runId.startsWith('wf_'));
      assert.equal(mgr.started.length, 1);
      const call = mgr.started[0]!;
      assert.equal(call.runId, res.runId);
      assert.equal((call.options as { provider?: string }).provider, 'mock');
      const metadata = call.processMetadata as { hostMetadata?: Record<string, string> };
      assert.equal(metadata.hostMetadata?.sessionId, 's1');
      assert.equal(metadata.hostMetadata?.surface, 'code');
      assert.equal(metadata.hostMetadata?.host, 'kodax-space');
      assert.ok(call.module, 'real module passed');
      // 归属已登记
      mgr._seed(sampleSnapshot(res.runId));
      assert.equal(ctrl.get(res.runId)?.sessionId, 's1');
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('start: SDK pre-start workflow failure returns error without origin registration', async () => {
  const { dir, file } = freshFile();
  try {
    const ctrl = new WorkflowController(() => {}, file);
    const mgr = fakeManager();
    let capturedRunId = '';
    mgr.startFromOptions = (input) => {
      capturedRunId = String((input as { runId?: unknown }).runId ?? '');
      mgr._seed(sampleSnapshot(capturedRunId));
      throw new Error('workflow capsule preflight failed: unawaited wf.runAgent result');
    };
    await ctrl.init(mgr);

    const res = await ctrl.start({
      target: 'parallel-investigation',
      source: 'builtin',
      session: LAUNCH_SESSION,
    });

    assert.deepEqual(res, {
      error: 'workflow capsule preflight failed: unawaited wf.runAgent result',
    });
    assert.ok(capturedRunId.startsWith('wf_'));
    assert.equal(ctrl.get(capturedRunId)?.sessionId, undefined);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('start: unknown builtin returns error (no run started)', async () => {
  const { dir, file } = freshFile();
  try {
    const ctrl = new WorkflowController(() => {}, file);
    const mgr = fakeManager();
    await ctrl.init(mgr);
    const res = await ctrl.start({
      target: 'no-such-workflow',
      source: 'builtin',
      session: LAUNCH_SESSION,
    });
    assert.ok('error' in res);
    assert.equal(mgr.started.length, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('listLibrary: real SDK returns parallel-investigation among built-ins', async () => {
  const { dir, file } = freshFile();
  try {
    const ctrl = new WorkflowController(() => {}, file);
    await ctrl.init(fakeManager());
    const lib = await ctrl.listLibrary(process.cwd());
    assert.ok(
      lib.builtin.some((w) => w.name === 'parallel-investigation'),
      JSON.stringify(lib.builtin),
    );
    assert.ok(Array.isArray(lib.patterns));
    assert.ok(Array.isArray(lib.saved));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('forwarded payload + snapshot pass the IPC zod schema (no drift / field loss)', async () => {
  const { dir, file } = freshFile();
  try {
    const pushed: unknown[] = [];
    const ctrl = new WorkflowController((p) => pushed.push(p), file);
    const mgr = fakeManager();
    await ctrl.init(mgr);
    ctrl.registerOrigin('r1', { sessionId: 's1', surface: 'code' });

    const snap = sampleSnapshot('r1', {
      displayName: 'PR security review',
      source: 'amaw',
      hostMetadata: { sessionId: 's1', surface: 'code' },
      tokens: { spent: 1234, total: 200000 },
      latestMessage: 'verifying findings',
      artifacts: [{ name: 'report', description: 'final' }],
    });
    mgr._emit({
      type: 'workflow_finished',
      snapshot: { ...snap, status: 'completed' },
      message: 'done',
    });

    // push payload 必须过 push 通道 schema
    const parsed = workflowEventChannel.payload.safeParse(pushed[0]);
    assert.ok(parsed.success, parsed.success ? '' : JSON.stringify(parsed.error.issues));
    // snapshot 子结构也独立过 snapshot schema（不丢字段）
    const snapParsed = workflowProcessSnapshotSchema.safeParse(
      (pushed[0] as { snapshot: unknown }).snapshot,
    );
    assert.ok(snapParsed.success);
    assert.equal(snapParsed.success && snapParsed.data.tokens?.spent, 1234);
    assert.equal(snapParsed.success && snapParsed.data.hostMetadata?.sessionId, 's1');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('workflow snapshots are clamped before IPC validation', async () => {
  const { dir, file } = freshFile();
  try {
    const pushed: unknown[] = [];
    const ctrl = new WorkflowController((p) => pushed.push(p), file);
    const mgr = fakeManager();
    await ctrl.init(mgr);
    ctrl.registerOrigin('r_long', { sessionId: 's1', surface: 'code' });

    const longText = 'x'.repeat(9000);
    mgr._emit({
      type: 'workflow_finished',
      snapshot: sampleSnapshot('r_long', {
        status: 'completed',
        resultSummary: longText,
        latestMessage: longText,
        hostMetadata: { sessionId: 's1', notes: longText },
        items: [
          {
            id: 'a1',
            title: 'agent',
            kind: 'agent',
            status: 'completed',
            summary: longText,
          },
        ],
      }),
      message: longText,
    });

    const parsed = workflowEventChannel.payload.safeParse(pushed[0]);
    assert.ok(parsed.success, parsed.success ? '' : JSON.stringify(parsed.error.issues));
    assert.equal(parsed.success && parsed.data.snapshot.status, 'completed');
    assert.ok(parsed.success && (parsed.data.snapshot.resultSummary?.length ?? 0) <= 8192);
    assert.ok(parsed.success && (parsed.data.message?.length ?? 0) <= 8192);
    assert.ok(parsed.success && (parsed.data.snapshot.items[0]?.summary?.length ?? 0) <= 8192);

    const seeded = ctrl.get('r_long');
    assert.ok((seeded?.resultSummary?.length ?? 0) <= 8192);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- Repo-intelligence license gate on workflow launch ---
// Regression for a CRITICAL bypass: repo-intelligence is a licensed capability, but the
// Workflow Harness builds its OWN context in launchOptions() (separate from the chat
// path). Every /workflow + Workflow Panel launch funnels through launchOptions(), so it
// must force repo-intel OFF for unlicensed users and enable trace when licensed. This
// shipped ungated because nothing exercised it — hence these two tests.
function launchSdk(name: string): unknown {
  return {
    async generateWorkflowFromOptions() {
      return generatedWorkflow(name);
    },
  };
}

test('workflow launch forces repo-intelligence OFF when unlicensed', async () => {
  const { dir, file } = freshFile();
  _setCodingSdkForTesting(launchSdk('gated-flow'));
  _setRepoIntelEntitlementForTesting(async () => false);
  try {
    const ctrl = new WorkflowController(() => {}, file);
    const mgr = fakeManager();
    await ctrl.init(mgr);
    await ctrl.createGeneratedWorkflow('do a thing', LAUNCH_SESSION);
    assert.equal(mgr.started.length, 1);
    const context = (mgr.started[0]!.options as { context: Record<string, unknown> }).context;
    assert.equal(
      context.repoIntelligenceMode,
      'off',
      'unlicensed workflow launch must force the built-in repo-intel engine off',
    );
    assert.equal(
      context.repoIntelligenceTrace,
      undefined,
      'unlicensed workflow launch must not enable repo-intel trace',
    );
  } finally {
    _setRepoIntelEntitlementForTesting(null);
    _setCodingSdkForTesting(null);
    rmSync(dir, { recursive: true, force: true });
  }
});

test('workflow launch enables repo-intelligence trace when licensed', async () => {
  const { dir, file } = freshFile();
  _setCodingSdkForTesting(launchSdk('licensed-flow'));
  _setRepoIntelEntitlementForTesting(async () => true);
  try {
    const ctrl = new WorkflowController(() => {}, file);
    const mgr = fakeManager();
    await ctrl.init(mgr);
    await ctrl.createGeneratedWorkflow('do a thing', LAUNCH_SESSION);
    const context = (mgr.started[0]!.options as { context: Record<string, unknown> }).context;
    assert.equal(context.repoIntelligenceTrace, true, 'licensed workflow launch enables trace');
    assert.equal(
      context.repoIntelligenceMode,
      undefined,
      'licensed workflow launch must not force mode off',
    );
  } finally {
    _setRepoIntelEntitlementForTesting(null);
    _setCodingSdkForTesting(null);
    rmSync(dir, { recursive: true, force: true });
  }
});

test('workflow launch forwards tokenBudget unconditionally (0 = unlimited, KodaX 0.7.59)', async () => {
  // KodaX 0.7.59 fixed the host-policy clamp: a tokenBudget of 0 / null / negative now
  // means "unbounded" (0.7.58 clamped a literal 0 → a 1-token run). Space no longer omits
  // the field when 0 — it forwards it, so 0 must reach the SDK as an OWN property. This is
  // the regression guard against re-introducing the old omit-when-0 spread (which produced
  // no tokenBudget key at all). The controller only calls workflowPolicyStore.get() (never
  // load()/set()), so the singleton stays at DEFAULT_WORKFLOW_POLICY (tokenBudget: 0) here
  // — deterministic and no disk touch.
  const { dir, file } = freshFile();
  _setCodingSdkForTesting(launchSdk('budget-flow'));
  try {
    const ctrl = new WorkflowController(() => {}, file);
    const mgr = fakeManager();
    await ctrl.init(mgr);
    await ctrl.createGeneratedWorkflow('do a thing', LAUNCH_SESSION);
    const hostPolicy = (mgr.started[0]!.options as { workflowHostPolicy: Record<string, unknown> })
      .workflowHostPolicy;
    assert.ok(
      Object.prototype.hasOwnProperty.call(hostPolicy, 'tokenBudget'),
      'tokenBudget must be forwarded (not omitted) so an explicit 0 reaches the SDK as unbounded',
    );
    assert.equal(
      hostPolicy.tokenBudget,
      0,
      'default policy forwards tokenBudget 0 (= unlimited in KodaX 0.7.59)',
    );
  } finally {
    _setCodingSdkForTesting(null);
    rmSync(dir, { recursive: true, force: true });
  }
});
