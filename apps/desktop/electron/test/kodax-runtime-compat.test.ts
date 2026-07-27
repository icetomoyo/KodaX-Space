import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

const PROBE_MARKER = 'KODAX_RUNTIME_PROBE=';
const PROBE_TIMEOUT_MS = 30_000;
const EXPECTED_KODAX_VERSION = '0.7.77';
const SHARED_DAEMON_TIMEOUT_MS = 45_000;
const SHARED_DAEMON_MARKER = 'KODAX_SHARED_DAEMON_HOST=';
const require = createRequire(import.meta.url);
const KODAX_CLI_PATH = path.join(
  path.dirname(require.resolve('@kodax-ai/kodax/package.json')),
  'dist',
  'kodax_cli.js',
);

const SHARED_DAEMON_REQUIREMENTS = {
  externalAgents: true,
  externalAgentAdmin: 1,
  actorControlPlane: 1,
  learningCenter: 1,
  a2aConfigReconciler: 1,
  operationDeduplication: 1,
  sessionObservation: 1,
  afterTurnInput: 1,
  interruptInput: 1,
  askUserTransport: 1,
  permissionCas: 1,
  providerCredentialBroker: 1,
  runBoundHostTools: 1,
  coderOwnerFencing: 1,
  crashOutcomeModel: 1,
  coderFeatureMatrix: 1,
  sessionAdmission: 1,
  completeObservationSnapshot: 1,
  contextCompaction: 3,
  transcriptPaging: 1,
  transcriptSearch: 1,
  connectionLifecycle: 1,
  typedRuntimeEvents: 1,
  daemonSafeRunInput: 1,
  sharedSessionSettings: 1,
  durableRecoveryQueries: 1,
  daemonManagement: 1,
  runtimeAutoModeGuardrail: 3,
} as const;

const PUBLISHED_SHARED_DAEMON_PEER_PROBE = String.raw`
import path from 'node:path';
import { connectKodaXRuntime } from '@kodax-ai/kodax/runtime';

const requirements = JSON.parse(process.env.KODAX_PROBE_REQUIREMENTS);
let runtime;
let observation;
let readinessSubscription;
try {
  runtime = await connectKodaXRuntime({
    profile: process.env.KODAX_PROBE_PROFILE,
    autoStart: false,
    homeDir: process.env.KODAX_PROBE_HOME,
    sessionsDir: path.join(process.env.KODAX_PROBE_HOME, 'sessions'),
    clientInfo: {
      name: 'kodax-cli',
      title: 'KodaX terminal compatibility probe',
      version: '0.7.77',
      instanceId: process.env.KODAX_PROBE_INSTANCE_ID,
      instanceSecret: process.env.KODAX_PROBE_INSTANCE_SECRET,
    },
    capabilities: { richEvents: true, operationDeduplication: true },
    requirements,
  });
  observation = await runtime.sessions.observe(process.env.KODAX_PROBE_SESSION_ID, () => {});
  readinessSubscription = runtime.events.subscribe(
    { sessionId: process.env.KODAX_PROBE_SESSION_ID },
    () => {},
  );
  const subscriptionReady = readinessSubscription.ready instanceof Promise;
  await readinessSubscription.ready;
  const current = await runtime.sessions.getSettingsVersioned(process.env.KODAX_PROBE_SESSION_ID);
  const shellExecution = {
    version: 1,
    shell: process.platform === 'win32'
      ? {
          kind: 'powershell',
          executable: path.join(
            process.env.SystemRoot ?? 'C:\\Windows',
            'System32',
            'WindowsPowerShell',
            'v1.0',
            'powershell.exe',
          ),
          profile: 'default',
        }
      : { kind: 'bash', executable: '/bin/bash', profile: 'login-interactive' },
    environment: {
      inherit: 'filtered',
      ...(process.platform === 'win32' ? { windowsPath: 'registry' } : {}),
    },
    cache: { ttlMs: 30000, refreshToken: 'space-compatibility-probe' },
    probeTimeoutMs: 10000,
  };
  const updated = await runtime.sessions.updateSettingsVersioned(
    process.env.KODAX_PROBE_SESSION_ID,
    {
      provider: 'published-probe',
      agentMode: 'ama',
      autoModeEngine: 'rules',
      shellExecution,
    },
    { expectedRevision: current.revision },
  );
  const preflight = await runtime.status.preflight();
  const learningSnapshot = await runtime.learning.getSnapshot();
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
    subscriptionReady,
    learningSnapshot: {
      revision: Number.isSafeInteger(learningSnapshot.revision),
      ready: Number.isSafeInteger(learningSnapshot.ready),
    },
    clientCount: preflight.clientCount,
    activeWorkflows: Array.isArray(preflight.activeWorkflows),
    activeAgentTurns: Array.isArray(preflight.activeAgentTurns),
    partnerError,
  }));
} finally {
  readinessSubscription?.close();
  observation?.close();
  await runtime?.close();
}
`;

// Keep the process-distinct daemon probe outside the tsx test loader so this
// compatibility gate exercises the published package under plain Node, matching
// the actual daemon child process rather than the TypeScript test harness.
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
  let resolveSettingsEvent;
  const settingsEvent = new Promise((resolve) => {
    resolveSettingsEvent = resolve;
  });
  observation = await runtime.sessions.observe(session.id, (event) => {
    if (event.type === 'session.settings.updated') resolveSettingsEvent(event.type);
  });
  const clientBaseline = await runtime.status.preflight();
  const managementBaseline = await runtime.daemon.inspect();
  const peer = await runPeer(session.id);
  let eventTimeout;
  const eventType = await Promise.race([
    settingsEvent,
    new Promise((_, reject) => {
      eventTimeout = setTimeout(
        () => reject(new Error('Space did not receive the peer settings event after the peer mutation.')),
        10_000,
      );
    }),
  ]).finally(() => clearTimeout(eventTimeout));
  const settings = await runtime.sessions.getSettingsVersioned(session.id);
  let afterDetach = await runtime.status.preflight();
  for (let attempt = 0; attempt < 50 && afterDetach.clientCount !== clientBaseline.clientCount; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    afterDetach = await runtime.status.preflight();
  }
  const managementAfterDetach = await runtime.daemon.inspect();
  const managementCapability = runtime.capabilities.daemonManagement;
  const externalAgentAdminCapability = runtime.capabilities.externalAgentAdmin;
  const actorControlPlaneCapability = runtime.capabilities.actorControlPlane;
  const learningCenterCapability = runtime.capabilities.learningCenter;
  const a2aConfigCapability = runtime.capabilities.a2aConfigReconciler;
  const runtimeAutoModeGuardrailCapability = runtime.capabilities.runtimeAutoModeGuardrail;
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
    management: {
      baselineRevision: managementBaseline.revision,
      afterDetachRevision: managementAfterDetach.revision,
      runtimeId: managementAfterDetach.runtimeId,
      ownerRuntimeId: managementAfterDetach.owner.runtimeId,
      ownerKind: managementAfterDetach.owner.kind,
      ownerPolicyMode: managementAfterDetach.ownerPolicy.mode,
      ownerPolicyRevision: managementAfterDetach.ownerPolicy.revision,
      canStop: managementAfterDetach.preflight.canStop,
      activeWorkflows: Array.isArray(managementAfterDetach.preflight.activeWorkflows),
      activeAgentTurns: Array.isArray(managementAfterDetach.preflight.activeAgentTurns),
      backgroundWorkPreflight: managementCapability?.backgroundWorkPreflight === true,
      reverseBridgeDrainingFence: managementCapability?.reverseBridgeDrainingFence === true,
      externalAgents: runtime.agents.enabled,
      externalAgentAdmin: externalAgentAdminCapability?.version === 1,
      actorControlPlane: actorControlPlaneCapability?.version === 1,
      learningCenter: learningCenterCapability?.version === 1,
      a2aConfigReconciler: a2aConfigCapability?.version === 1,
      permissionGrantAdmin: runtime.grantedScopes?.includes('permission:grant-admin') === true,
      runtimeAutoModeGuardrail:
        runtimeAutoModeGuardrailCapability?.version === 3 &&
        runtimeAutoModeGuardrailCapability.owner === 'session-runtime',
    },
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
import {
  createBearerEnvA2AAuthentication,
  createOAuth2JwtA2AAuthentication,
  inspectA2AIntegration,
  migrateA2ALegacyTaskOwners,
} from '@kodax-ai/kodax/a2a';

const homeDir = await mkdtemp(path.join(tmpdir(), 'kodax-space-runtime-child-'));
let runtime;
try {
  runtime = await createKodaXRuntime({
    mode: 'embedded',
    isolation: 'worker',
    requirements: { hardDispose: true, learningCenter: 1, actorControlPlane: 1 },
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
  const learningSnapshot = await runtime.learning.getSnapshot();
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
    requirements: { externalAgents: true, externalAgentAdmin: 1, actorControlPlane: 1 },
  });
  let externalAgentResult;
  try {
    const registration = {
      agentId: 'external:space-reference',
      displayName: 'Space Reference Agent',
      enabled: true,
      managementOwner: 'kodax-space-runtime-compat',
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
    await externalRuntime.admin.agentRegistrations.upsert(registration, {
      expectedConfigurationRevision: null,
      expectedManagementOwner: null,
    });
    const disabled = await externalRuntime.admin.agentRegistrations.setEnabled(
      registration.agentId,
      false,
      {
        expectedConfigurationRevision: registration.configurationRevision,
        expectedManagementOwner: registration.managementOwner,
      },
    );
    const enabled = await externalRuntime.admin.agentRegistrations.setEnabled(
      registration.agentId,
      true,
      {
        expectedConfigurationRevision: registration.configurationRevision,
        expectedManagementOwner: registration.managementOwner,
      },
    );
    const dispatchable = await externalRuntime.agents.listDispatchable({
      actorId: 'kodax-space-runtime-compat',
      readOnly: true,
    });
    const externalSession = await externalRuntime.sessions.create({
      title: 'Space external Actor compatibility probe',
      projectPath: process.cwd(),
      surface: 'release-probe',
    });
    const started = await externalRuntime.agents.spawn(externalSession.id, {
      taskName: 'reference',
      kind: 'external',
      objective: 'space-reference-round-trip',
      metadata: { agentId: registration.agentId },
    });
    const deadline = Date.now() + 5_000;
    let terminal = await externalRuntime.agents.output(
      externalSession.id,
      started.actorPath,
      started.turnId,
    );
    while (terminal.state === 'accepted' || terminal.state === 'running') {
      if (Date.now() >= deadline) throw new Error('Timed out waiting for the external Actor turn.');
      await new Promise((resolve) => setTimeout(resolve, 10));
      terminal = await externalRuntime.agents.output(
        externalSession.id,
        started.actorPath,
        started.turnId,
      );
    }
    const actorEvents = await externalRuntime.agents.events(externalSession.id, 0);
    const actorControlPlaneCapability = externalRuntime.capabilities.actorControlPlane;
    externalAgentResult = {
      capability: externalRuntime.agents.enabled,
      actorControlPlane: actorControlPlaneCapability?.version === 1,
      disabled: disabled?.enabled === false,
      enabled: externalRuntime.agents.enabled,
      reenabled: enabled?.enabled === true,
      listed: dispatchable.some((item) => item.descriptor.agentId === registration.agentId),
      state: terminal.state,
      output: terminal.output,
      events: actorEvents.length > 0,
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
    learningCenter: {
      capability: runtime.capabilities.learningCenter?.version === 1,
      revision: Number.isSafeInteger(learningSnapshot.revision),
      ready: Number.isSafeInteger(learningSnapshot.ready),
    },
    downgradeRejected,
    a2aExports: {
      bearerAuth: typeof createBearerEnvA2AAuthentication === 'function',
      oauthJwtAuth: typeof createOAuth2JwtA2AAuthentication === 'function',
      inspectConfig: typeof inspectA2AIntegration === 'function',
      migrateTaskOwners: typeof migrateA2ALegacyTaskOwners === 'function',
    },
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
    readonly subscriptionReady: boolean;
    readonly learningSnapshot: { readonly revision: boolean; readonly ready: boolean };
    readonly clientCount: number;
    readonly activeWorkflows: boolean;
    readonly activeAgentTurns: boolean;
    readonly partnerError?: { readonly code?: string; readonly message?: string };
  };
  readonly eventType: string;
  readonly settings: { readonly revision: number; readonly value: Record<string, unknown> };
  readonly clientBaseline: number;
  readonly afterDetach: number;
  readonly management: {
    readonly baselineRevision: number;
    readonly afterDetachRevision: number;
    readonly runtimeId: string;
    readonly ownerRuntimeId: string;
    readonly ownerKind?: string;
    readonly ownerPolicyMode: string;
    readonly ownerPolicyRevision: number;
    readonly canStop: boolean;
    readonly activeWorkflows: boolean;
    readonly activeAgentTurns: boolean;
    readonly backgroundWorkPreflight: boolean;
    readonly reverseBridgeDrainingFence: boolean;
    readonly externalAgents: boolean;
    readonly externalAgentAdmin: boolean;
    readonly actorControlPlane: boolean;
    readonly learningCenter: boolean;
    readonly a2aConfigReconciler: boolean;
    readonly permissionGrantAdmin: boolean;
    readonly runtimeAutoModeGuardrail: boolean;
  };
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
    assert.deepEqual(result.learningCenter, {
      capability: true,
      revision: true,
      ready: true,
    });
    assert.equal(result.downgradeRejected, true);
    assert.deepEqual(result.a2aExports, {
      bearerAuth: true,
      oauthJwtAuth: true,
      inspectConfig: true,
      migrateTaskOwners: true,
    });
    assert.deepEqual(result.externalAgentResult, {
      capability: true,
      actorControlPlane: true,
      disabled: true,
      enabled: true,
      reenabled: true,
      listed: true,
      state: 'completed',
      output: 'space-reference-round-trip',
      events: true,
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

test(`KodaX ${EXPECTED_KODAX_VERSION} Auto guardrail keeps the required permission semantics`, async () => {
  const projectRoot = await mkdtemp(path.join(tmpdir(), 'kodax-space-auto-guardrail-'));
  const previousKodaxHome = process.env.KODAX_HOME;
  process.env.KODAX_HOME = path.join(projectRoot, '.isolated-kodax-home');

  try {
    const [{ bootstrapAutoMode }, { createKodaXRuntime }] = await Promise.all([
      import('@kodax-ai/kodax/repl'),
      import('@kodax-ai/kodax/runtime'),
    ]);
    const context = { agent: {} as never };
    let rulesPrompts = 0;
    const rulesBootstrap = await bootstrapAutoMode({
      askUser: async () => {
        rulesPrompts += 1;
        return 'block';
      },
      projectRoot,
      executionCwd: projectRoot,
      getCurrentProviderName: () => 'unused-rules-provider',
      getCurrentModel: () => 'unused-rules-model',
      getCurrentPermissionMode: () => 'auto',
      autoModeSettings: { engine: 'rules', timeoutMs: 20_000 },
      log: () => {},
    });
    const rulesGuardrail = rulesBootstrap.getGuardrail();
    const rulesBeforeTool = rulesGuardrail.beforeTool?.bind(rulesGuardrail);
    assert.ok(rulesBeforeTool);

    const workspaceEdit = await rulesBeforeTool(
      {
        id: 'workspace-edit',
        name: 'edit',
        input: {
          path: path.join(projectRoot, 'inside-workspace.txt'),
          old_string: 'before',
          new_string: 'after',
        },
      },
      context,
    );
    assert.deepEqual(workspaceEdit, { action: 'allow' });
    assert.equal(rulesPrompts, 0, 'workspace edit must not request user confirmation');

    const outsideEdit = await rulesBeforeTool(
      {
        id: 'outside-edit',
        name: 'edit',
        input: {
          path: path.join(
            path.parse(projectRoot).root,
            `kodax-space-outside-${path.basename(projectRoot)}.txt`,
          ),
          old_string: 'before',
          new_string: 'after',
        },
      },
      context,
    );
    assert.equal(outsideEdit.action, 'block');
    assert.equal(rulesPrompts, 1, 'outside-workspace edit must still escalate');
    assert.equal(rulesGuardrail.getEngine(), 'rules');

    const bracketWildcard = await rulesBeforeTool(
      {
        id: 'powershell-bracket-wildcard',
        name: 'bash',
        input: {
          command: 'Set-Content -Path "[.]kodax/config.json" -Value data',
        },
      },
      context,
    );
    assert.equal(bracketWildcard.action, 'block');
    assert.equal(rulesPrompts, 2, 'PowerShell bracket wildcards on path parameters must escalate');

    const bracketLiteral = await rulesBeforeTool(
      {
        id: 'powershell-bracket-literal',
        name: 'bash',
        input: {
          command: 'Set-Content -LiteralPath "build/file[12].txt" -Value data',
        },
      },
      context,
    );
    assert.deepEqual(bracketLiteral, { action: 'allow' });
    assert.equal(
      rulesPrompts,
      2,
      'an exact LiteralPath filename containing brackets must stay fully modeled',
    );

    let llmPrompts = 0;
    const llmBootstrap = await bootstrapAutoMode({
      askUser: async () => {
        llmPrompts += 1;
        return 'allow';
      },
      projectRoot,
      executionCwd: projectRoot,
      getCurrentProviderName: () => 'missing-provider-must-not-be-resolved',
      getCurrentModel: () => '',
      getCurrentPermissionMode: () => 'auto',
      autoModeSettings: { engine: 'llm', timeoutMs: 20_000 },
      log: () => {},
    });
    const llmGuardrail = llmBootstrap.getGuardrail();
    const llmBeforeTool = llmGuardrail.beforeTool?.bind(llmGuardrail);
    assert.ok(llmBeforeTool);

    const missingModel = await llmBeforeTool(
      { id: 'missing-model', name: 'bash', input: { command: 'python verify.py' } },
      context,
    );
    assert.equal(missingModel.action, 'block');
    assert.match(
      'reason' in missingModel ? missingModel.reason : '',
      /classifier model is not configured/i,
    );
    assert.equal(llmPrompts, 0, 'missing classifier model must not request user confirmation');
    assert.equal(llmGuardrail.getEngine(), 'llm');
    assert.deepEqual(llmGuardrail.getStats().denials, { consecutive: 0, cumulative: 0 });
    assert.deepEqual(llmGuardrail.getStats().breaker.timestamps, []);

    const runtimeHome = path.join(projectRoot, 'runtime-home');
    const runtime = await createKodaXRuntime({
      mode: 'embedded',
      isolation: 'inline',
      homeDir: runtimeHome,
      sessionsDir: path.join(runtimeHome, 'sessions'),
      defaultProvider: 'missing-provider-must-not-be-resolved',
      sharedDaemonHost: true,
      requirements: { runtimeAutoModeGuardrail: 3 },
    });
    try {
      const session = await runtime.sessions.create({
        title: 'Space missing Auto LLM model compatibility probe',
        projectPath: projectRoot,
        surface: 'space-desktop',
        tag: 'code',
      });
      await runtime.sessions.updateSettings(session.id, {
        permissionMode: 'auto',
        autoModeEngine: 'llm',
        executionCwd: projectRoot,
      });
      await assert.rejects(
        runtime.runs.start({ sessionId: session.id, prompt: 'inspect the workspace' }),
        (error: unknown) => {
          assert.equal((error as { code?: unknown }).code, 'auto_mode_classifier_model_required');
          assert.equal((error as { recoverable?: unknown }).recoverable, true);
          return true;
        },
      );
      assert.deepEqual(await runtime.permissions.listPending({ sessionId: session.id }), []);
    } finally {
      await runtime.close();
    }
  } finally {
    if (previousKodaxHome === undefined) delete process.env.KODAX_HOME;
    else process.env.KODAX_HOME = previousKodaxHome;
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test(`KodaX ${EXPECTED_KODAX_VERSION} exports a bounded non-empty auto-resume selector`, async () => {
  const { findMostRecentResumableSession } = await import('@kodax-ai/kodax/repl');
  let requestedRoot: string | undefined;
  let requestedLimit: number | undefined;
  const found = await findMostRecentResumableSession(
    {
      async list(root?: string, options?: { limit?: number }) {
        requestedRoot = root;
        requestedLimit = options?.limit;
        return [
          { id: 'empty-acp-placeholder', msgCount: 0 },
          { id: 'latest-real-conversation', msgCount: 3 },
        ];
      },
    },
    'C:\\workspace',
  );

  assert.deepEqual(found, { id: 'latest-real-conversation', msgCount: 3 });
  assert.equal(requestedRoot, 'C:\\workspace');
  assert.equal(requestedLimit, 1000);
});

test(
  `tarball KodaX ${EXPECTED_KODAX_VERSION} daemon shares one Coder session across processes`,
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
    const { shellExecution, ...settings } = result.settings.value;
    assert.deepEqual(settings, {
      provider: 'published-probe',
      agentMode: 'ama',
      autoModeEngine: 'rules',
    });
    assert.deepEqual(shellExecution, {
      version: 1,
      shell:
        process.platform === 'win32'
          ? {
              kind: 'powershell',
              executable: path.join(
                process.env.SystemRoot ?? 'C:\\Windows',
                'System32',
                'WindowsPowerShell',
                'v1.0',
                'powershell.exe',
              ),
              profile: 'default',
            }
          : { kind: 'bash', executable: '/bin/bash', profile: 'login-interactive' },
      environment: {
        inherit: 'filtered',
        ...(process.platform === 'win32' ? { windowsPath: 'registry' } : {}),
      },
      cache: { ttlMs: 30_000, refreshToken: 'space-compatibility-probe' },
      probeTimeoutMs: 10_000,
    });
    assert.equal(result.peer.subscriptionReady, true);
    assert.deepEqual(result.peer.learningSnapshot, { revision: true, ready: true });
    assert.equal(result.clientBaseline, 1);
    assert.equal(result.peer.clientCount, 2);
    assert.equal(result.afterDetach, 1);
    assert.equal(result.peer.activeWorkflows, true);
    assert.equal(result.peer.activeAgentTurns, true);
    assert.ok(result.management.afterDetachRevision > result.management.baselineRevision);
    assert.equal(result.management.runtimeId, result.runtimeId);
    assert.equal(result.management.ownerRuntimeId, result.runtimeId);
    assert.equal(result.management.ownerKind, 'daemon');
    assert.equal(result.management.ownerPolicyMode, 'daemon');
    assert.ok(Number.isSafeInteger(result.management.ownerPolicyRevision));
    assert.equal(result.management.canStop, true);
    assert.equal(result.management.activeWorkflows, true);
    assert.equal(result.management.activeAgentTurns, true);
    assert.equal(result.management.backgroundWorkPreflight, true);
    assert.equal(result.management.reverseBridgeDrainingFence, true);
    assert.equal(result.management.externalAgents, true);
    assert.equal(result.management.externalAgentAdmin, true);
    assert.equal(result.management.actorControlPlane, true);
    assert.equal(result.management.learningCenter, true);
    assert.equal(result.management.a2aConfigReconciler, true);
    assert.equal(result.management.permissionGrantAdmin, true);
    assert.equal(result.management.runtimeAutoModeGuardrail, true);
    assert.equal(result.connectionState, 'connected');
    assert.equal(result.peer.partnerError?.code, 'session_not_admitted');
  },
);
