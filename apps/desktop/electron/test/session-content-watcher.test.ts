import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  SESSION_CONTENT_POLL_INTERVAL_MS,
  watchPersistedSessionContents,
} from '../kodax/session-content-watcher.js';

async function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('timed out waiting for Session content event');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

test('production full-tree reconciliation is low-frequency', () => {
  assert.ok(SESSION_CONTENT_POLL_INTERVAL_MS >= 10_000);
});

test('content watcher detects rewrites of an existing Windows-style Session path', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'kodax-space-session-watch-'));
  const projectDir = path.join(root, 'project-key');
  await mkdir(projectDir, { recursive: true });
  const sessionPath = path.join(projectDir, 'existing.jsonl');
  await writeFile(sessionPath, '{"revision":1}\n', 'utf8');

  const events: Array<{ kind: string; sessionId: string }> = [];
  const watcher = watchPersistedSessionContents(root, (event) => events.push(event), {
    pollIntervalMs: 20,
  });
  try {
    await watcher.ready;
    // Preserve the ID set: this is the exact case KodaX 0.7.79's Windows watcher misses.
    await writeFile(sessionPath, '{"revision":2,"larger":true}\n', 'utf8');
    await waitFor(() => events.some((event) => event.kind === 'change'));
    assert.deepEqual(
      events.find((event) => event.kind === 'change'),
      {
        kind: 'change',
        sessionId: 'existing',
      },
    );
  } finally {
    watcher.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('content watcher attributes island sidecar changes to the owning Session', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'kodax-space-session-watch-'));
  const projectDir = path.join(root, 'project-key');
  await mkdir(projectDir, { recursive: true });
  const mainPath = path.join(projectDir, 'with-islands.jsonl');
  const sidecarPath = path.join(projectDir, 'with-islands.islands.jsonl');
  await writeFile(mainPath, '{"main":1}\n', 'utf8');
  await writeFile(sidecarPath, '{"island":1}\n', 'utf8');

  const events: Array<{ kind: string; sessionId: string }> = [];
  const watcher = watchPersistedSessionContents(root, (event) => events.push(event), {
    pollIntervalMs: 20,
  });
  try {
    await watcher.ready;
    await writeFile(sidecarPath, '{"island":2,"larger":true}\n', 'utf8');
    await waitFor(() => events.some((event) => event.kind === 'change'));
    assert.ok(
      events.some((event) => event.kind === 'change' && event.sessionId === 'with-islands'),
    );
  } finally {
    watcher.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('large Session snapshots yield the event loop and never overlap poll work', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'kodax-space-session-watch-'));
  const projectDir = path.join(root, 'linux-project-key');
  await mkdir(projectDir, { recursive: true });
  await Promise.all(
    Array.from({ length: 512 }, (_, index) =>
      writeFile(path.join(projectDir, `session-${index}.jsonl`), `${index}\n`, 'utf8'),
    ),
  );

  let heartbeats = 0;
  const heartbeat = setInterval(() => {
    heartbeats += 1;
  }, 0);
  const watcher = watchPersistedSessionContents(root, () => undefined, {
    pollIntervalMs: 20,
  });
  try {
    await watcher.ready;
    assert.ok(heartbeats > 0, 'asynchronous stat batches must yield the Electron main loop');
  } finally {
    clearInterval(heartbeat);
    watcher.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('unreadable startup root fails open, then invalidates when a baseline recovers', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'kodax-space-session-watch-'));
  const blockedPath = path.join(root, 'sessions');
  await writeFile(blockedPath, 'not a directory', 'utf8');
  let recoveries = 0;
  const watcher = watchPersistedSessionContents(blockedPath, () => undefined, {
    pollIntervalMs: 20,
    readyTimeoutMs: 30,
    onBaselineRecovered: () => {
      recoveries += 1;
    },
  });
  try {
    await Promise.race([
      watcher.ready,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('watcher readiness did not fail open')), 500),
      ),
    ]);
    assert.equal(recoveries, 0);
    await rm(blockedPath, { force: true });
    await mkdir(blockedPath);
    await writeFile(path.join(blockedPath, 'recovered.jsonl'), '{}\n', 'utf8');
    await waitFor(() => recoveries === 1);
    assert.equal(recoveries, 1);
  } finally {
    watcher.close();
    await rm(root, { recursive: true, force: true });
  }
});
