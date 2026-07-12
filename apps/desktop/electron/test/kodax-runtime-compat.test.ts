import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import test from 'node:test';

const PROBE_MARKER = 'KODAX_RUNTIME_PROBE=';
const PROBE_TIMEOUT_MS = 30_000;

const PUBLISHED_RUNTIME_WORKER_PROBE = String.raw`
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  connectKodaXRuntime,
  createKodaXRuntime,
  KODAX_DAEMON_PROTOCOL_VERSION,
} from '@kodax-ai/kodax/runtime';
import { createReferenceAgentExecutorFactory } from '@kodax-ai/kodax/agent';

const homeDir = await mkdtemp(path.join(tmpdir(), 'kodax-space-runtime-child-'));
let runtime;
try {
  runtime = await createKodaXRuntime({
    mode: 'embedded',
    isolation: 'worker',
    requirements: { hardDispose: true },
    homeDir,
    sessionsDir: path.join(homeDir, 'sessions'),
    worker: {
      resourceLimits: { maxOldGenerationSizeMb: 128 },
      shutdownTimeoutMs: 1500,
    },
    clientInfo: { name: 'kodax-space-runtime-compat', version: '0.1.30' },
  });
  const created = await runtime.sessions.create({
    title: 'Space SDK compatibility probe',
    projectPath: process.cwd(),
    surface: 'release-probe',
  });
  const loaded = await runtime.sessions.load(created.id);
  let downgradeRejected = false;
  try {
    await createKodaXRuntime({
      mode: 'embedded',
      isolation: 'inline',
      requirements: { hardDispose: true },
      homeDir,
      sessionsDir: path.join(homeDir, 'inline-sessions'),
    });
  } catch (error) {
    downgradeRejected = /hardDispose|Worker/i.test(String(error));
  }
  const externalRuntime = await createKodaXRuntime({
    mode: 'embedded',
    isolation: 'inline',
    homeDir: path.join(homeDir, 'external-owner'),
    externalAgents: {
      factories: [createReferenceAgentExecutorFactory({
        executorId: 'space-reference',
        protocol: 'http',
      })],
      policy: ({ registration }) => ({ allowed: registration.enabled }),
      defaultContext: { actorId: 'kodax-space-runtime-compat' },
    },
    requirements: { externalAgents: true },
  });
  let externalAgentResult;
  try {
    const registration = {
      agentId: 'external:space-reference',
      displayName: 'Space Reference Agent',
      enabled: true,
      executorId: 'space-reference',
      protocol: 'http',
      configurationRevision: 'space-reference-v1',
      endpointIdentityHash: 'sha256:space-reference',
      skills: ['conformance'],
      inputModalities: ['text'],
      outputModalities: ['text'],
      capabilities: {
        streaming: 'supported',
        durableTasks: 'supported',
        inputRequired: 'conditional',
        cancellation: 'supported',
        artifacts: 'unsupported',
      },
      effects: { remote: 'none', workspace: 'none' },
    };
    await externalRuntime.admin.agentRegistrations.upsert(registration);
    const dispatchable = await externalRuntime.agents.listDispatchable({
      actorId: 'kodax-space-runtime-compat',
      readOnly: true,
    });
    const started = await externalRuntime.agentTasks.start({
      agentId: registration.agentId,
      objective: 'space-reference-round-trip',
      context: { actorId: 'kodax-space-runtime-compat' },
      readOnly: true,
      expectedConfigurationRevision: registration.configurationRevision,
    });
    const terminal = await externalRuntime.agentTasks.wait(started.taskId, 5_000);
    externalAgentResult = {
      capability: externalRuntime.agents.enabled,
      enabled: externalRuntime.agents.enabled,
      listed: dispatchable.some((item) => item.descriptor.agentId === registration.agentId),
      state: terminal.state,
      output: terminal.output,
    };
  } finally {
    await externalRuntime.close();
  }
  const inlineHome = path.join(homeDir, 'inline-owner');
  const inlineRuntime = await createKodaXRuntime({
    mode: 'embedded',
    isolation: 'inline',
    homeDir: inlineHome,
    sessionsDir: path.join(inlineHome, 'sessions'),
    clientInfo: { name: 'kodax-space-runtime-inline', version: '0.1.31' },
  });
  let inlineManagedResult;
  try {
    const inlineSession = await inlineRuntime.sessions.create({
      title: 'Space inline managed-run probe',
      projectPath: process.cwd(),
      surface: 'code',
      tag: 'code',
    });
    const settings = await inlineRuntime.sessions.updateSettings(inlineSession.id, {
      provider: 'space-probe-missing',
      permissionMode: 'accept-edits',
      executionCwd: process.cwd(),
    });
    const eventTypes = [];
    const subscription = inlineRuntime.events.subscribe(
      { sessionId: inlineSession.id },
      (event) => eventTypes.push(event.type),
    );
    let callbackErrors = 0;
    let callbackCompletes = 0;
    try {
      const handle = await inlineRuntime.runs.start({
        sessionId: inlineSession.id,
        prompt: 'exercise managed runtime failure normalization',
        mode: 'managed_task',
        permissionBroker: 'client',
        options: {
          provider: 'space-probe-missing',
          agentMode: 'sa',
          events: {
            onError: () => { callbackErrors += 1; },
            onComplete: () => { callbackCompletes += 1; },
          },
        },
      });
      const result = await handle.result;
      const failedEvents = await inlineRuntime.events.replay({
        runId: handle.runId,
        type: 'run.failed',
      });
      inlineManagedResult = {
        phase: result.phase,
        error: result.error?.message,
        failedEventCount: failedEvents.length,
        eventTypes,
        callbackErrors,
        callbackCompletes,
        settings,
      };
    } finally {
      subscription.close();
    }
  } finally {
    await inlineRuntime.close();
  }
  process.stdout.write('KODAX_RUNTIME_PROBE=' + JSON.stringify({
    createAvailable: typeof createKodaXRuntime === 'function',
    connectAvailable: typeof connectKodaXRuntime === 'function',
    protocolVersion: KODAX_DAEMON_PROTOCOL_VERSION,
    version: runtime.identity.version,
    mode: runtime.identity.mode,
    isolation: runtime.identity.isolation,
    workerThreadId: runtime.identity.workerThreadId,
    sessionRoundTrip: loaded.id === created.id,
    downgradeRejected,
    externalAgentResult,
    inlineManagedResult,
  }));
} finally {
  await runtime?.close();
  await rm(homeDir, { recursive: true, force: true });
}
`;

function runPublishedRuntimeWorkerProbe(): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--input-type=module', '-'], {
      cwd: process.cwd(),
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    let timeout: NodeJS.Timeout | undefined;
    const rejectOnce = (error: Error): void => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      reject(error);
    };
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });
    child.once('error', rejectOnce);
    child.stdin.once('error', rejectOnce);
    child.once('close', (code) => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      if (code !== 0) {
        reject(new Error(`KodaX Runtime Worker probe exited ${code}: ${stderr || stdout}`));
        return;
      }
      const markerIndex = stdout.lastIndexOf(PROBE_MARKER);
      if (markerIndex < 0) {
        reject(new Error(`KodaX Runtime Worker probe returned no result marker: ${stdout}`));
        return;
      }
      try {
        resolve(
          JSON.parse(stdout.slice(markerIndex + PROBE_MARKER.length)) as Record<string, unknown>,
        );
      } catch (error) {
        reject(
          new Error(`KodaX Runtime Worker probe returned invalid JSON: ${stdout}`, {
            cause: error,
          }),
        );
      }
    });
    timeout = setTimeout(() => {
      child.kill();
      rejectOnce(new Error(`KodaX Runtime Worker probe exceeded ${PROBE_TIMEOUT_MS} ms`));
    }, PROBE_TIMEOUT_MS);
    child.stdin.end(PUBLISHED_RUNTIME_WORKER_PROBE);
  });
}

test(
  'KodaX 0.7.67 Runtime satisfies Worker and external-agent compatibility',
  {
    timeout: PROBE_TIMEOUT_MS + 5_000,
  },
  async () => {
    const result = await runPublishedRuntimeWorkerProbe();
    assert.equal(result.version, '0.7.67');
    assert.equal(result.createAvailable, true);
    assert.equal(result.connectAvailable, true);
    assert.ok(Number.isSafeInteger(result.protocolVersion));
    assert.equal(result.mode, 'embedded');
    assert.equal(result.isolation, 'worker');
    assert.ok(Number.isSafeInteger(result.workerThreadId));
    assert.equal(result.sessionRoundTrip, true);
    assert.equal(result.downgradeRejected, true);
    assert.deepEqual(result.externalAgentResult, {
      capability: true,
      enabled: true,
      listed: true,
      state: 'completed',
      output: 'space-reference-round-trip',
    });
    const inlineManagedResult = result.inlineManagedResult as {
      phase?: unknown;
      error?: unknown;
      failedEventCount?: unknown;
      eventTypes?: unknown;
      callbackErrors?: unknown;
      callbackCompletes?: unknown;
      settings?: Record<string, unknown>;
    };
    assert.equal(inlineManagedResult.phase, 'failed');
    assert.match(String(inlineManagedResult.error), /Unknown provider: space-probe-missing/);
    assert.equal(inlineManagedResult.failedEventCount, 1);
    // Provider resolution fails before the coding loop owns callbacks. Space must
    // therefore normalize RuntimeRunResult.error instead of relying on onError/onComplete.
    assert.equal(inlineManagedResult.callbackErrors, 0);
    assert.equal(inlineManagedResult.callbackCompletes, 0);
    assert.ok(
      Array.isArray(inlineManagedResult.eventTypes) &&
        inlineManagedResult.eventTypes.includes('run.started') &&
        inlineManagedResult.eventTypes.includes('run.failed'),
    );
    assert.deepEqual(inlineManagedResult.settings, {
      provider: 'space-probe-missing',
      permissionMode: 'accept-edits',
      executionCwd: process.cwd(),
    });
  },
);
