import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';

const RESULT_MARKER = 'F118_LEARNING_DAEMON=';
const PROBE_TIMEOUT_MS = 45_000;
const require = createRequire(import.meta.url);
const KODAX_CLI_PATH = path.join(
  path.dirname(require.resolve('@kodax-ai/kodax/package.json')),
  'dist',
  'kodax_cli.js',
);

// Run outside the tsx test loader so the daemon is a genuinely process-distinct
// Runtime owner. The two SDK connections below are separate Space/terminal-like
// clients of that shared daemon.
const LEARNING_DAEMON_PROBE = String.raw`
import { spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { connectKodaXRuntime } from '@kodax-ai/kodax/runtime';
import {
  LearnedAreaStore,
  admitLearnedSkillBinding,
  commitLearnedSkillRevision,
  completeLearnedSkillOutcome,
  createLearnedCapabilityScope,
  invokeLearnedSkillCanary,
  resolveProjectLearnedAreaRoot,
} from '@kodax-ai/kodax/agent';

const homeDir = await mkdtemp(path.join(tmpdir(), 'kodax-space-f118-daemon-'));
const configHome = path.join(homeDir, '.kodax');
const profile = 'space-f118-' + process.pid;
const requirements = {
  learningCenter: 1,
  skillLearningLoop: 1,
  operationDeduplication: 1,
  daemonManagement: 1,
  daemonOrphanExit: 1,
};
const scopeIdentity = {
  tenantId: 'space-f118-tenant',
  projectId: 'space-f118-project',
};
const scope = createLearnedCapabilityScope(configHome, scopeIdentity);
const projectRoot = resolveProjectLearnedAreaRoot(configHome, scopeIdentity);
const learnedRoot = path.join(configHome, 'learned');
const projectStore = new LearnedAreaStore(projectRoot);
const learningStore = new LearnedAreaStore(learnedRoot);

function clientInfo(name) {
  return {
    name,
    title: name,
    version: '0.1.37',
    instanceId: randomUUID(),
    instanceSecret: randomBytes(32).toString('base64url'),
  };
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
    ], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.once('error', reject);
    child.once('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error('Could not stop F118 daemon: ' + (stderr || stdout)));
    });
  });
}

async function seed(name, suffix) {
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
      jobId: 'job_f118_' + suffix,
      inputHash: suffix.repeat(64),
      decisionId: 'decision_f118_' + suffix,
      actionId: 'action_f118_' + suffix,
    },
  });
  await learningStore.writeCapability(record);
  await learningStore.ensureCurrentEvent(record);
  return record;
}

let space;
let terminal;
let result;
try {
  await projectStore.initialize();
  await learningStore.initialize();
  const primary = await seed('f118-primary-skill', 'a');
  const rejected = await seed('f118-rejected-skill', 'b');

  space = await connectKodaXRuntime({
    profile,
    autoStart: true,
    daemonOrphanExitMs: 30_000,
    homeDir,
    sessionsDir: path.join(homeDir, 'sessions'),
    clientInfo: clientInfo('kodax-space-f118-probe'),
    capabilities: { richEvents: true, operationDeduplication: true },
    requirements,
  });
  const baseline = await space.learning.get(primary.capabilityId);
  await space.learning.acknowledge(primary.capabilityId);
  const afterAcknowledge = await space.learning.get(primary.capabilityId);

  await space.learning.review(primary.capabilityId);
  const reviewed = await space.learning.get(primary.capabilityId);
  const bindingId = 'binding_f118';
  await admitLearnedSkillBinding(projectStore, primary.capabilityId, {
    bindingId,
    ownerSessionRef: 'session_f118',
  });
  const invocation = await invokeLearnedSkillCanary(projectStore, primary.capabilityId, {
    bindingId,
    invocationId: 'invocation_f118',
    usageSessionHash: 'c'.repeat(64),
    artifactRevision: reviewed.artifact.contentRevision,
    artifactFingerprint: reviewed.artifact.fingerprint,
  });
  const verified = await completeLearnedSkillOutcome(projectStore, primary.capabilityId, {
    invocationId: invocation.invocationId,
    outcome: 'verified_success',
    evidenceRefs: ['evidence:f118:verified'],
  });
  await learningStore.writeCapability(verified);
  await learningStore.ensureCurrentEvent(verified);

  await space.learning.trust(primary.capabilityId);
  const trusted = await space.learning.get(primary.capabilityId);
  await space.learning.disable(primary.capabilityId);
  const disabled = await space.learning.get(primary.capabilityId);
  await space.learning.rollback(primary.capabilityId);
  const rolledBack = await space.learning.get(primary.capabilityId);
  await space.learning.reject(rejected.capabilityId);
  const rejectedAfterAction = await space.learning.get(rejected.capabilityId);

  terminal = await connectKodaXRuntime({
    profile,
    autoStart: false,
    homeDir,
    sessionsDir: path.join(homeDir, 'sessions'),
    clientInfo: clientInfo('kodax-terminal-f118-probe'),
    capabilities: { richEvents: true, operationDeduplication: true },
    requirements,
  });
  const terminalPrimary = await terminal.learning.get(primary.capabilityId);
  const terminalRejected = await terminal.learning.get(rejected.capabilityId);
  const terminalSnapshot = await terminal.learning.getSnapshot();
  const events = await terminal.learning.events(0);

  result = {
    runtimeIdMatch: space.identity.runtimeId === terminal.identity.runtimeId,
    capabilities: {
      learningCenter: space.capabilities.learningCenter?.version,
      skillLearningLoop: space.capabilities.skillLearningLoop?.version,
    },
    primaryId: primary.capabilityId,
    rejectedId: rejected.capabilityId,
    acknowledge: {
      lifecycleUnchanged: baseline.lifecycle === afterAcknowledge.lifecycle,
      revisionUnchanged: baseline.revision === afterAcknowledge.revision,
    },
    reviewed: {
      lifecycle: reviewed.lifecycle,
      revision: reviewed.revision,
    },
    trusted: {
      lifecycle: trusted.lifecycle,
      revision: trusted.revision,
      previousGoodRevision: trusted.previousGoodRevision,
      fingerprint: trusted.artifact.fingerprint,
      previousGoodFingerprint: trusted.previousGoodArtifact?.fingerprint,
      verifiedSuccesses: trusted.canary.verifiedSuccesses,
      invocationCount: trusted.canary.invocationCount,
      evidenceRefs: trusted.canary.invocations[0]?.evidenceRefs,
    },
    disabled: {
      lifecycle: disabled.lifecycle,
      revision: disabled.revision,
    },
    rolledBack: {
      lifecycle: rolledBack.lifecycle,
      revision: rolledBack.revision,
      fingerprint: rolledBack.artifact.fingerprint,
    },
    rejected: {
      lifecycle: rejectedAfterAction.lifecycle,
      revision: rejectedAfterAction.revision,
    },
    terminal: {
      primaryLifecycle: terminalPrimary.lifecycle,
      primaryRevision: terminalPrimary.revision,
      rejectedLifecycle: terminalRejected.lifecycle,
      rejectedRevision: terminalRejected.revision,
      snapshot: terminalSnapshot,
    },
    events: events.map((event) => ({
      sequence: event.sequence,
      capabilityId: event.capabilityId,
      capabilityRevision: event.capabilityRevision,
      lifecycle: event.lifecycle,
    })),
  };
} finally {
  await terminal?.close();
  await space?.close();
  await stopDaemon();
  await rm(homeDir, { recursive: true, force: true });
}
process.stdout.write('F118_LEARNING_DAEMON=' + JSON.stringify(result));
`;

function runProbe(): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--input-type=module', '-'], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        KODAX_CLI_PATH,
      },
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error('F118 learning daemon probe timed out.'));
    }, PROBE_TIMEOUT_MS);
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
      clearTimeout(timeout);
      if (code !== 0) {
        reject(new Error(`F118 learning daemon probe exited ${code}: ${stderr || stdout}`));
        return;
      }
      const markerIndex = stdout.lastIndexOf(RESULT_MARKER);
      if (markerIndex < 0) {
        reject(new Error(`F118 learning daemon probe returned no marker: ${stdout}`));
        return;
      }
      resolve(JSON.parse(stdout.slice(markerIndex + RESULT_MARKER.length)));
    });
    child.stdin.end(LEARNING_DAEMON_PROBE);
  });
}

test(
  'F118 controls daemon-owned learned Skills and remains consistent across clients',
  { timeout: PROBE_TIMEOUT_MS + 5_000 },
  async () => {
    const result = (await runProbe()) as {
      runtimeIdMatch: boolean;
      capabilities: { learningCenter: number; skillLearningLoop: number };
      primaryId: string;
      rejectedId: string;
      acknowledge: { lifecycleUnchanged: boolean; revisionUnchanged: boolean };
      reviewed: { lifecycle: string; revision: number };
      trusted: {
        lifecycle: string;
        revision: number;
        previousGoodRevision: number;
        fingerprint: string;
        previousGoodFingerprint: string;
        verifiedSuccesses: number;
        invocationCount: number;
        evidenceRefs: string[];
      };
      disabled: { lifecycle: string; revision: number };
      rolledBack: { lifecycle: string; revision: number; fingerprint: string };
      rejected: { lifecycle: string; revision: number };
      terminal: {
        primaryLifecycle: string;
        primaryRevision: number;
        rejectedLifecycle: string;
        rejectedRevision: number;
        snapshot: { active: number; attention: number; revision: number };
      };
      events: Array<{
        sequence: number;
        capabilityId: string;
        capabilityRevision: number;
        lifecycle: string;
      }>;
    };

    assert.equal(result.runtimeIdMatch, true);
    assert.deepEqual(result.capabilities, {
      learningCenter: 1,
      skillLearningLoop: 1,
    });
    assert.deepEqual(result.acknowledge, {
      lifecycleUnchanged: true,
      revisionUnchanged: true,
    });
    assert.equal(result.reviewed.lifecycle, 'testing');
    assert.equal(result.trusted.lifecycle, 'active_learned');
    assert.equal(result.trusted.verifiedSuccesses, 1);
    assert.equal(result.trusted.invocationCount, 1);
    assert.deepEqual(result.trusted.evidenceRefs, ['evidence:f118:verified']);
    assert.equal(result.trusted.previousGoodRevision, 1);
    assert.equal(result.trusted.previousGoodFingerprint, result.trusted.fingerprint);
    assert.equal(result.disabled.lifecycle, 'archived');
    assert.equal(result.rolledBack.lifecycle, 'active_learned');
    assert.equal(result.rolledBack.fingerprint, result.trusted.fingerprint);
    assert.equal(result.rejected.lifecycle, 'rejected');
    assert.equal(result.terminal.primaryLifecycle, 'active_learned');
    assert.equal(result.terminal.primaryRevision, result.rolledBack.revision);
    assert.equal(result.terminal.rejectedLifecycle, 'rejected');
    assert.equal(result.terminal.rejectedRevision, result.rejected.revision);
    assert.equal(result.terminal.snapshot.active, 1);
    // Space deliberately derives its stricter actionable-only badge from the
    // records instead of inheriting Runtime's broader notification count.
    assert.ok(Number.isSafeInteger(result.terminal.snapshot.attention));
    assert.ok(result.terminal.snapshot.revision >= result.events.length);

    const sequences = result.events.map((event) => event.sequence);
    assert.deepEqual(
      sequences,
      Array.from({ length: sequences.length }, (_, index) => index + 1),
    );
    assert.ok(
      result.events.some(
        (event) =>
          event.capabilityId === result.primaryId &&
          event.capabilityRevision === result.rolledBack.revision &&
          event.lifecycle === 'active_learned',
      ),
    );
    assert.ok(
      result.events.some(
        (event) =>
          event.capabilityId === result.rejectedId &&
          event.capabilityRevision === result.rejected.revision &&
          event.lifecycle === 'rejected',
      ),
    );
  },
);
