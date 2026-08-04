import assert from 'node:assert/strict';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  LearnedAreaStore,
  admitLearnedSkillBinding,
  commitLearnedSkillRevision,
  completeLearnedSkillOutcome,
  createLearnedCapabilityScope,
  invokeLearnedSkillCanary,
  resolveProjectLearnedAreaRoot,
} from '@kodax-ai/kodax/agent';
import { connectKodaXRuntime } from '@kodax-ai/kodax/runtime';

import { LearningSafetyService } from '../ipc/learning.js';

const READY_MARKER = 'F118_DAEMON_READY=';
const TEST_TIMEOUT_MS = 45_000;
const MAX_DAEMON_DIAGNOSTIC_BYTES = 16 * 1024;
const require = createRequire(import.meta.url);
const KODAX_CLI_PATH = path.join(
  path.dirname(require.resolve('@kodax-ai/kodax/package.json')),
  'dist',
  'kodax_cli.js',
);

const DAEMON_HOST = String.raw`
import { randomBytes, randomUUID } from 'node:crypto';
import path from 'node:path';
import { connectKodaXRuntime } from '@kodax-ai/kodax/runtime';

let runtime;
try {
  runtime = await connectKodaXRuntime({
    profile: process.env.F118_PROFILE,
    autoStart: true,
    daemonOrphanExitMs: 30000,
    homeDir: process.env.F118_HOME,
    sessionsDir: path.join(process.env.F118_HOME, 'sessions'),
    clientInfo: {
      name: 'f118-daemon-host',
      version: '0.1.35',
      instanceId: randomUUID(),
      instanceSecret: randomBytes(32).toString('base64url'),
    },
    capabilities: { richEvents: true, operationDeduplication: true },
    requirements: JSON.parse(process.env.F118_REQUIREMENTS),
  });
  process.stdout.write('F118_DAEMON_READY=' + runtime.identity.runtimeId + '\n');
  await new Promise((resolve) => {
    process.once('SIGTERM', resolve);
    process.once('SIGINT', resolve);
  });
} finally {
  await runtime?.close();
}
`;

const requirements = {
  learningCenter: 1,
  skillLearningLoop: 1,
  operationDeduplication: 1,
  daemonManagement: 1,
  daemonOrphanExit: 1,
  managedRunDurability: 1,
} as const;

function appendDiagnosticTail(previous: string, chunk: string): string {
  const next = previous + chunk;
  return next.length > MAX_DAEMON_DIAGNOSTIC_BYTES
    ? next.slice(-MAX_DAEMON_DIAGNOSTIC_BYTES)
    : next;
}

function startDaemonHost(homeDir: string, profile: string) {
  const child = spawn(process.execPath, ['--input-type=module', '-'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      F118_HOME: homeDir,
      F118_PROFILE: profile,
      F118_REQUIREMENTS: JSON.stringify(requirements),
    },
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });
  const ready = new Promise<string>((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error('F118 daemon host timed out.'));
    }, 20_000);
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
      const marker = stdout.lastIndexOf(READY_MARKER);
      if (marker >= 0) {
        clearTimeout(timeout);
        resolve(stdout.slice(marker + READY_MARKER.length).split(/\r?\n/, 1)[0] ?? '');
      }
    });
    child.stderr.on('data', (chunk) => {
      stderr = appendDiagnosticTail(stderr, chunk);
    });
    child.once('error', reject);
    child.once('close', (code) => {
      if (stdout.includes(READY_MARKER)) return;
      clearTimeout(timeout);
      reject(new Error(`F118 daemon host exited ${code}: ${stderr || stdout}`));
    });
  });
  child.stdin.end(DAEMON_HOST);
  return { child, ready };
}

async function closeHost(child: ChildProcessWithoutNullStreams): Promise<void> {
  if (child.exitCode !== null) return;
  const closed = new Promise<void>((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`F118 daemon host exited ${code}.`));
    });
  });
  child.kill();
  await closed;
}

function stopDaemon(homeDir: string, profile: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        KODAX_CLI_PATH,
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
      ],
      { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.once('error', reject);
    child.once('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Could not stop F118 daemon: ${stderr || stdout}`));
    });
  });
}

test(
  'LearningSafetyService performs list/detail and all five actions against a real daemon',
  { timeout: TEST_TIMEOUT_MS },
  async () => {
    const homeDir = await mkdtemp(path.join(tmpdir(), 'kodax-space-f118-service-'));
    const configHome = path.join(homeDir, '.kodax');
    const profile = `space-f118-service-${process.pid}`;
    const scopeIdentity = {
      tenantId: 'space-f118-service-tenant',
      projectId: 'space-f118-service-project',
    };
    const scope = createLearnedCapabilityScope(configHome, scopeIdentity);
    const projectStore = new LearnedAreaStore(
      resolveProjectLearnedAreaRoot(configHome, scopeIdentity),
    );
    const learningStore = new LearnedAreaStore(path.join(configHome, 'learned'));
    let runtime: Awaited<ReturnType<typeof connectKodaXRuntime>> | undefined;
    let host: ReturnType<typeof startDaemonHost> | undefined;

    const seed = async (name: string, suffix: string) => {
      const record = await commitLearnedSkillRevision(projectStore, {
        scope,
        spec: {
          name,
          description: 'Summarizes a supplied demonstration topic.',
          purpose: 'Produce a concise and verifiable demonstration summary.',
          triggers: ['A demonstration summary is requested.'],
          steps: ['Read the supplied topic.', 'Write a concise summary.'],
          verification: ['The summary covers the supplied topic.'],
          pitfalls: ['Avoid unrelated details.'],
        },
        disposition: 'ready',
        operation: 'create',
        provenance: {
          jobId: `job_f118_service_${suffix}`,
          inputHash: suffix.repeat(64),
          decisionId: `decision_f118_service_${suffix}`,
          actionId: `action_f118_service_${suffix}`,
        },
      });
      await learningStore.writeCapability(record);
      await learningStore.ensureCurrentEvent(record);
      return record;
    };

    try {
      await projectStore.initialize();
      await learningStore.initialize();
      const primary = await seed('f118-service-primary', 'd');
      const rejectCandidate = await seed('f118-service-reject', 'e');

      host = startDaemonHost(homeDir, profile);
      const runtimeId = await host.ready;
      assert.ok(runtimeId);
      runtime = await connectKodaXRuntime({
        profile,
        autoStart: false,
        homeDir,
        sessionsDir: path.join(homeDir, 'sessions'),
        clientInfo: {
          name: 'kodax-space-f118-service',
          version: '0.1.35',
          instanceId: randomUUID(),
          instanceSecret: randomBytes(32).toString('base64url'),
        },
        capabilities: { richEvents: true, operationDeduplication: true },
        requirements,
      });

      const service = new LearningSafetyService({
        context: async () => ({ runtimeId: runtime!.identity.runtimeId }),
        list: (query) => runtime!.learning.list(query),
        get: (capabilityId) => runtime!.learning.get(capabilityId),
        snapshot: () => runtime!.learning.getSnapshot(),
        events: (afterRevision) => runtime!.learning.events(afterRevision),
        subscribe: (options) => runtime!.learning.subscribe(options),
        acknowledge: (capabilityId) => runtime!.learning.acknowledge(capabilityId),
        control: async (action, capabilityId) => {
          await runtime!.learning[action](capabilityId);
        },
      });
      const act = async (
        action: 'review' | 'trust' | 'reject' | 'disable' | 'rollback',
        capabilityId: string,
      ) => {
        const current = (await service.get(capabilityId)).record;
        assert.equal(current.schemaVersion, 2);
        if (current.schemaVersion !== 2) throw new Error('Expected a schema-v2 learned Skill.');
        const result = await service.action({
          action,
          capabilityId,
          expectedRevision: current.revision,
          expectedFingerprint: current.artifact.fingerprint,
        });
        if (result.record.schemaVersion !== 2) {
          throw new Error('Expected a schema-v2 learned Skill action result.');
        }
        return { ...result, record: result.record };
      };

      const baseline = await service.list({ limit: 50 });
      assert.equal(baseline.items.length, 2);
      assert.ok(baseline.items.every((item) => item.schemaVersion === 2));
      assert.equal((await service.get(primary.capabilityId)).record.lifecycle, 'ready');

      const reviewed = await act('review', primary.capabilityId);
      assert.equal(reviewed.record.lifecycle, 'testing');
      assert.equal(reviewed.record.revision, 2);

      const bindingId = 'binding_f118_service';
      await admitLearnedSkillBinding(projectStore, primary.capabilityId, {
        bindingId,
        ownerSessionRef: 'session_f118_service',
      });
      const invocation = await invokeLearnedSkillCanary(projectStore, primary.capabilityId, {
        bindingId,
        invocationId: 'invocation_f118_service',
        usageSessionHash: 'f'.repeat(64),
        artifactRevision: reviewed.record.artifact.contentRevision,
        artifactFingerprint: reviewed.record.artifact.fingerprint,
      });
      const verified = await completeLearnedSkillOutcome(projectStore, primary.capabilityId, {
        invocationId: invocation.invocationId,
        outcome: 'verified_success',
        evidenceRefs: ['evidence:f118:service'],
      });
      await learningStore.writeCapability(verified);
      await learningStore.ensureCurrentEvent(verified);

      const trusted = await act('trust', primary.capabilityId);
      assert.equal(trusted.record.lifecycle, 'active_learned');
      assert.equal(trusted.record.canary.verifiedSuccesses, 1);
      const disabled = await act('disable', primary.capabilityId);
      assert.equal(disabled.record.lifecycle, 'archived');
      assert.notEqual(disabled.record.lastAction, 'disable');
      const rolledBack = await act('rollback', primary.capabilityId);
      assert.equal(rolledBack.record.lifecycle, 'active_learned');
      assert.equal(rolledBack.record.artifact.fingerprint, trusted.record.artifact.fingerprint);
      const rejected = await act('reject', rejectCandidate.capabilityId);
      assert.equal(rejected.record.lifecycle, 'rejected');
      assert.notEqual(rejected.record.lastAction, 'reject');
    } finally {
      await runtime?.close();
      if (host) await closeHost(host.child).catch(() => {});
      await stopDaemon(homeDir, profile).catch(() => {});
      await rm(homeDir, { recursive: true, force: true });
    }
  },
);
