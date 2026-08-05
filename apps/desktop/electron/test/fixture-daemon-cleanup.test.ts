import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  parseOwnedTestDaemonPid,
  stopOwnedTestDaemon,
} from '../../../../tests/e2e/fixture-daemon-cleanup.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

test('test daemon cleanup accepts only a descriptor owned by the exact fixture directory', () => {
  const root = path.join(os.tmpdir(), 'kodax-owned-daemon');
  assert.equal(
    parseOwnedTestDaemonPid(
      JSON.stringify({ pid: 4242, profile: 'coder', configHome: root }),
      root,
    ),
    4242,
  );
  assert.equal(
    parseOwnedTestDaemonPid(
      JSON.stringify({ pid: 4242, profile: 'coder', configHome: `${root}-other` }),
      root,
    ),
    undefined,
  );
  assert.equal(
    parseOwnedTestDaemonPid(
      JSON.stringify({ pid: 4242, profile: 'partner', configHome: root }),
      root,
    ),
    undefined,
  );
  assert.equal(parseOwnedTestDaemonPid('{broken', root), undefined);
});

test('test daemon cleanup signals the validated isolated PID and ignores missing state', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'kodax-fixture-daemon-cleanup-'));
  roots.push(root);
  const descriptorDir = path.join(root, 'runtime', 'daemon', 'coder');
  await mkdir(descriptorDir, { recursive: true });
  const daemonPid = process.pid + 1;
  await writeFile(
    path.join(descriptorDir, 'daemon.json'),
    JSON.stringify({ pid: daemonPid, profile: 'coder', configHome: root }),
    'utf8',
  );

  const signals: Array<{ pid: number; signal?: NodeJS.Signals | number }> = [];
  assert.equal(
    await stopOwnedTestDaemon(root, (pid, signal) => {
      signals.push({ pid, signal });
      return true;
    }),
    true,
  );
  assert.deepEqual(signals, [{ pid: daemonPid, signal: 'SIGTERM' }]);
  assert.equal(await stopOwnedTestDaemon(`${root}-missing`, () => true), false);
});
