import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';

const PROBE_MARKER = 'KODAX_RUNTIME_PROBE=';
const PROBE_TIMEOUT_MS = 30_000;
const EXPECTED_KODAX_VERSION = '0.7.72-hotfix.0';
const SHARED_DAEMON_TIMEOUT_MS = 45_000;
const SHARED_DAEMON_MARKER = 'KODAX_SHARED_DAEMON_HOST=';
const require = createRequire(import.meta.url);
const KODAX_CLI_PATH = path.join(
  path.dirname(require.resolve('@kodax-ai/kodax/package.json')),
  'dist',
  'kodax_cli.js',
);

const SHARED_DAEMON_REQUIREMENTS = {
  operationDeduplication: 1,
  sessionObservation: 1,
  afterTurnInput: 1,
  askUserTransport: 1,
  permissionCas: 1,
  providerCredentialBroker: 1,
  runBoundHostTools: 1,
  coderOwnerFencing: 1,
  crashOutcomeModel: 1,
  coderFeatureMatrix: 1,
  sessionAdmission: 1,
  completeObservationSnapshot: 1,
  connectionLifecycle: 1,
  typedRuntimeEvents: 1,
  daemonSafeRunInput: 1,
  sharedSessionSettings: 1,
  durableRecoveryQueries: 1,
} as const;

const PUBLISHED_SHARED_DAEMON_PEER_PROBE = String.raw`
import path from 'node:path';
import { connectKodaXRuntime } from '@kodax-ai/kodax/runtime';

const requirements = JSON.parse(process.env.KODAX_PROBE_REQUIREMENTS);
let runtime;
let observation;
try {
  runtime = await connectKodaXRuntime({
    profile: process.env.KODAX_PROBE_PROFILE,
    autoStart: false,
    homeDir: process.env.KODAX_PROBE_HOME,
    sessionsDir: path.join(process.env.KODAX_PROBE_HOME, 'sessions'),
    clientInfo: {
      name: 'kodax-cli',
      title: 'KodaX terminal compatibility probe',
      version: '0.7.72-hotfix.0',
      instanceId: process.env.KODAX_PROBE_INSTANCE_ID,
      instanceSecret: process.env.KODAX_PROBE_INSTANCE_SECRET,
    },
    capabilities: { richEvents: true, operationDeduplication: true },
    requirements,
  });
  observation = await runtime.sessions.observe(process.env.KODAX_PROBE_SESSION_ID, () => {});
  const current = await runtime.sessions.getSettingsVersioned(process.env.KODAX_PROBE_SESSION_ID);
  const updated = await runtime.sessions.updateSettingsVersioned(
    process.env.KODAX_PROBE_SESSION_ID,
    { provider: 'published-probe', agentMode: 'amaw', autoModeEngine: 'rules' },
    { expectedRevision: current.revision },
  );
  const preflight = await runtime.status.preflight();
  let partnerError;
  try {
    await runtime.sessions.create({
      sessionId: 'partner-must-stay-inline',
      title: 'Partner must stay inline',
      projectPath: process.cwd(),
      surface: 'partner',
      tag: 'partner',
    });
  } catch (error) {
    partnerError = { code: error?.code, message: String(error?.message ?? error) };
  }
  process.stdout.write('KODAX_SHARED_DAEMON_PEER=' + JSON.stringify({
    runtimeId: runtime.identity.runtimeId,
    connectionState: runtime.connection.current().state,
    cursor: observation.snapshot.cursor,
    transcriptRevision: observation.snapshot.transcriptRevision,
    completeSnapshot: {
      managedTasks: Array.isArray(observation.snapshot.live.managedTasks),
      pendingUserInputs: Array.isArray(observation.snapshot.live.pendingUserInputs),
    },
    settingsRevision: updated.revision,
    clientCount: preflight.clientCount,
    partnerError,
  }));
} finally {
  observation?.close();
  await runtime?.close();
}
`;

// Keep the process-distinct daemon probe outside the tsx/esm test loader. KodaX
// still carries CLI-only dependencies with JSON modules; loading them inside a
// highly concurrent tsx suite is a known loader hazard unrelated to Runtime.
const PUBLISHED_SHARED_DAEMON_HOST_PROBE = String.raw`
import { spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { connectKodaXRuntime } from '@kodax-ai/kodax/runtime';

const requirements = JSON.parse(process.env.KODAX_PROBE_REQUIREMENTS);
const homeDir = await mkdtemp(path.join(tmpdir(), 'kodax-space-shared-daemon-'));
const profile = 'space-f121-' + process.pid;

function runPeer(sessionId) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--input-type=module', '-'], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        KODAX_PROBE_HOME: homeDir,
        KODAX_PROBE_PROFILE: profile,
        KODAX_PROBE_SESSION_ID: sessionId,
        KODAX_PROBE_INSTANCE_ID: randomUUID(),
        KODAX_PROBE_INSTANCE_SECRET: randomBytes(32).toString('base64url'),
        KODAX_PROBE_REQUIREMENTS: JSON.stringify(requirements),
      },
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error('Shared daemon peer timed out.'));
    }, 30000);
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.once('error', reject);
    child.once('close', (code) => {
      clearTimeout(timeout);
      if (code !== 0) {
        reject(new Error('Shared daemon peer exited ' + code + ': ' + (stderr || stdout)));
        return;
      }
      const marker = 'KODAX_SHARED_DAEMON_PEER=';
      const markerIndex = stdout.lastIndexOf(marker);
      if (markerIndex < 0) {
        reject(new Error('Shared daemon peer returned no result marker: ' + stdout));
        return;
      }
      resolve(JSON.parse(stdout.slice(markerIndex + marker.length)));
    });
    child.stdin.end(process.env.KODAX_PEER_PROBE);
  });
}

function stopDaemon() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [
      process.env.KODAX_CLI_PATH,
      'daemon',
      'stop',
      '--profile',
      profile,
      '--home',
      homeDir,
      '--timeout-ms',
      '10000',
      '--force',
      '--json',
    ], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.once('error', reject);
    child.once('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error('Could not stop compatibility daemon: ' + (stderr || stdout)));
    });
  });
}

let runtime;
let observation;
let result;
try {
  runtime = await connectKodaXRuntime({
    profile,
    autoStart: true,
    homeDir,
    sessionsDir: path.join(homeDir, 'sessions'),
    clientInfo: {
      name: 'kodax-space',
      title: 'KodaX Space compatibility probe',
      version: '0.1.32',
      instanceId: randomUUID(),
      instanceSecret: randomBytes(32).toString('base64url'),
    },
    capabilities: { richEvents: true, operationDeduplication: true },
    requirements,
  });
  const session = await runtime.sessions.create({
    title: 'F121 published multi-client probe',
    projectPath: process.cwd(),
    surface: 'space-desktop',
    tag: 'code',
  });
  let eventTimeout;
  let resolveSettingsEvent;
  const settingsEvent = new Promise((resolve, reject) => {
    resolveSettingsEvent = resolve;
    eventTimeout = setTimeout(
      () => reject(new Error('Space did not receive the peer settings event.')),
      8000,
    );
  });
  observation = await runtime.sessions.observe(session.id, (event) => {
    if (event.type === 'session.settings.updated') resolveSettingsEvent(event.type);
  });
  const clientBaseline = await runtime.status.preflight();
  const peer = await runPeer(session.id);
  const eventType = await settingsEvent.finally(() => clearTimeout(eventTimeout));
  const settings = await runtime.sessions.getSettingsVersioned(session.id);
  let afterDetach = await runtime.status.preflight();
  for (let attempt = 0; attempt < 50 && afterDetach.clientCount !== clientBaseline.clientCount; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    afterDetach = await runtime.status.preflight();
  }
  result = {
    version: runtime.identity.version,
    runtimeId: runtime.identity.runtimeId,
    connectionState: runtime.connection.current().state,
    cursor: observation.snapshot.cursor,
    transcriptRevision: observation.snapshot.transcriptRevision,
    peer,
    eventType,
    settings,
    clientBaseline: clientBaseline.clientCount,
    afterDetach: afterDetach.clientCount,
  };
} finally {
  observation?.close();
  await runtime?.close();
  await stopDaemon();
  await rm(homeDir, { recursive: true, force: true });
}
process.stdout.write('KODAX_SHARED_DAEMON_HOST=' + JSON.stringify(result));
`;

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
    clientInfo: { name: 'kodax-space-runtime-compat', version: '0.1.31' },
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

interface SharedDaemonHostResult {
  readonly version: string;
  readonly runtimeId: string;
  readonly connectionState: string;
  readonly cursor: number;
  readonly transcriptRevision: string;
  readonly peer: {
    readonly runtimeId: string;
    readonly connectionState: string;
    readonly cursor: number;
    readonly transcriptRevision: string;
    readonly completeSnapshot: {
      readonly managedTasks: boolean;
      readonly pendingUserInputs: boolean;
    };
    readonly settingsRevision: number;
    readonly clientCount: number;
    readonly partnerError?: { readonly code?: string; readonly message?: string };
  };
  readonly eventType: string;
  readonly settings: { readonly revision: number; readonly value: Record<string, unknown> };
  readonly clientBaseline: number;
  readonly afterDetach: number;
}

function runPublishedSharedDaemonProbe(): Promise<SharedDaemonHostResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--input-type=module', '-'], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        KODAX_PROBE_REQUIREMENTS: JSON.stringify(SHARED_DAEMON_REQUIREMENTS),
        KODAX_PEER_PROBE: PUBLISHED_SHARED_DAEMON_PEER_PROBE,
        KODAX_CLI_PATH,
      },
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const timeout = setTimeout(() => {
      child.kill();
      rejectOnce(new Error(`Shared daemon host exceeded ${SHARED_DAEMON_TIMEOUT_MS} ms`));
    }, SHARED_DAEMON_TIMEOUT_MS);
    const rejectOnce = (error: Error): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
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
      clearTimeout(timeout);
      if (code !== 0) {
        reject(new Error(`Shared daemon host exited ${code}: ${stderr || stdout}`));
        return;
      }
      const markerIndex = stdout.lastIndexOf(SHARED_DAEMON_MARKER);
      if (markerIndex < 0) {
        reject(new Error(`Shared daemon host returned no result marker: ${stdout}`));
        return;
      }
      try {
        resolve(
          JSON.parse(
            stdout.slice(markerIndex + SHARED_DAEMON_MARKER.length),
          ) as SharedDaemonHostResult,
        );
      } catch (error) {
        reject(new Error(`Shared daemon host returned invalid JSON: ${stdout}`, { cause: error }));
      }
    });
    child.stdin.end(PUBLISHED_SHARED_DAEMON_HOST_PROBE);
  });
}

test(
  `KodaX ${EXPECTED_KODAX_VERSION} Runtime satisfies Worker and external-agent compatibility`,
  {
    timeout: PROBE_TIMEOUT_MS + 5_000,
  },
  async () => {
    const result = await runPublishedRuntimeWorkerProbe();
    assert.equal(result.version, EXPECTED_KODAX_VERSION);
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

test(
  `published KodaX ${EXPECTED_KODAX_VERSION} daemon shares one Coder session across processes`,
  { timeout: SHARED_DAEMON_TIMEOUT_MS + 15_000 },
  async () => {
    const result = await runPublishedSharedDaemonProbe();
    assert.equal(result.version, EXPECTED_KODAX_VERSION);
    assert.equal(result.peer.runtimeId, result.runtimeId);
    assert.equal(result.peer.connectionState, 'connected');
    assert.equal(result.peer.cursor, result.cursor);
    assert.equal(result.peer.transcriptRevision, result.transcriptRevision);
    assert.deepEqual(result.peer.completeSnapshot, {
      managedTasks: true,
      pendingUserInputs: true,
    });
    assert.equal(result.eventType, 'session.settings.updated');
    assert.equal(result.settings.revision, result.peer.settingsRevision);
    assert.deepEqual(result.settings.value, {
      provider: 'published-probe',
      agentMode: 'amaw',
      autoModeEngine: 'rules',
    });
    // Compare against the post-auto-start baseline so this probe catches a
    // peer connection leak independently of the SDK's absolute preflight count.
    assert.ok(result.clientBaseline >= 1);
    assert.ok(result.peer.clientCount >= result.clientBaseline + 1);
    assert.equal(result.afterDetach, result.clientBaseline);
    assert.equal(result.connectionState, 'connected');
    assert.equal(result.peer.partnerError?.code, 'session_not_admitted');
  },
);
