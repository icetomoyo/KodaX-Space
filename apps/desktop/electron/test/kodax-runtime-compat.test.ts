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
        resolve(JSON.parse(stdout.slice(markerIndex + PROBE_MARKER.length)) as Record<string, unknown>);
      } catch (error) {
        reject(new Error(`KodaX Runtime Worker probe returned invalid JSON: ${stdout}`, {
          cause: error,
        }));
      }
    });
    timeout = setTimeout(() => {
      child.kill();
      rejectOnce(new Error(`KodaX Runtime Worker probe exceeded ${PROBE_TIMEOUT_MS} ms`));
    }, PROBE_TIMEOUT_MS);
    child.stdin.end(PUBLISHED_RUNTIME_WORKER_PROBE);
  });
}

test('KodaX 0.7.66 Runtime Worker satisfies hard-dispose and session parity', {
  timeout: PROBE_TIMEOUT_MS + 5_000,
}, async () => {
  const result = await runPublishedRuntimeWorkerProbe();
  assert.equal(result.version, '0.7.66');
  assert.equal(result.createAvailable, true);
  assert.equal(result.connectAvailable, true);
  assert.ok(Number.isSafeInteger(result.protocolVersion));
  assert.equal(result.mode, 'embedded');
  assert.equal(result.isolation, 'worker');
  assert.ok(Number.isSafeInteger(result.workerThreadId));
  assert.equal(result.sessionRoundTrip, true);
  assert.equal(result.downgradeRejected, true);
});
