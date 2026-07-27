// Unit tests for PtyHost — F011.
//
// These tests spawn real PTY processes (cmd.exe on Windows, bash on POSIX) and
// drive write/resize/kill against them. The spawn shell echo is OS-dependent;
// we keep assertions to lifecycle invariants and id management, not output content.
//
// Skipped on CI runners that have neither cmd.exe nor /bin/sh — guard via
// `process.env.SKIP_PTY_TESTS === '1'` or platform feature check.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPtyEnvironment, PtyHost } from '../terminal/ptyHost.js';

const SKIP = process.env.SKIP_PTY_TESTS === '1';
const ifAvailable = SKIP ? test.skip.bind(test) : test;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitUntil(predicate: () => boolean, timeoutMs = 3000): Promise<boolean> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (predicate()) return true;
    await delay(50);
  }
  return predicate();
}

function createTestPty(host: PtyHost, overrides: Partial<Parameters<PtyHost['create']>[0]> = {}) {
  return host.create({
    cwd: process.cwd(),
    cols: 80,
    rows: 24,
    // Rapid PowerShell create/kill loops trigger a node-pty ConPTY helper race
    // that is unrelated to PtyHost lifecycle behavior. Shell selection itself
    // is covered by terminal-shell.test.ts and a real single-PTY smoke probe.
    shellPreference: process.platform === 'win32' ? 'cmd' : 'auto',
    ...overrides,
  });
}

test('buildPtyEnvironment: preserves Windows PATH resolution without leaking secrets', () => {
  const environment = buildPtyEnvironment(
    {
      Path: 'C:\\tools\\node',
      Pathext: '.COM;.EXE;.CMD',
      USERPROFILE: 'C:\\Users\\tester',
      OPENAI_API_KEY: 'must-not-leak',
    },
    'win32',
  );

  assert.equal(environment.PATH, 'C:\\tools\\node');
  assert.equal(environment.PATHEXT, '.COM;.EXE;.CMD');
  assert.equal(environment.USERPROFILE, 'C:\\Users\\tester');
  assert.equal(environment.OPENAI_API_KEY, undefined);
});

ifAvailable('PtyHost: create returns a unique uuid + non-zero pid', async () => {
  const host = new PtyHost();
  const a = createTestPty(host);
  const b = createTestPty(host);
  try {
    assert.notEqual(a.terminalId, b.terminalId, 'ids should be unique');
    assert.match(a.terminalId, /^[0-9a-f-]{36}$/i, 'terminalId is a uuid');
    assert.ok(a.pid > 0, 'pid > 0');
    assert.ok(b.pid > 0, 'pid > 0');
    assert.equal(host.count(), 2);
  } finally {
    host.disposeAll();
  }
});

ifAvailable('PtyHost: create rejects relative cwd', () => {
  const host = new PtyHost();
  try {
    assert.throws(() => createTestPty(host, { cwd: './relative' }), /absolute/);
  } finally {
    host.disposeAll();
  }
});

ifAvailable('PtyHost: write to unknown id returns false', () => {
  const host = new PtyHost();
  try {
    const ok = host.write('00000000-0000-4000-8000-000000000000', 'hi\n');
    assert.equal(ok, false);
  } finally {
    host.disposeAll();
  }
});

ifAvailable('PtyHost: resize to unknown id returns false', () => {
  const host = new PtyHost();
  try {
    const ok = host.resize('00000000-0000-4000-8000-000000000000', 80, 24);
    assert.equal(ok, false);
  } finally {
    host.disposeAll();
  }
});

ifAvailable('PtyHost: kill is idempotent and returns true for unknown id', () => {
  const host = new PtyHost();
  try {
    const ok1 = host.kill('00000000-0000-4000-8000-000000000000');
    assert.equal(ok1, true, 'unknown id kill returns true (idempotent)');
    const created = createTestPty(host);
    const ok2 = host.kill(created.terminalId);
    assert.equal(ok2, true);
    // 第二次 kill 同一个 id 还是 true（已 killed=true, 不再走 SIGKILL path）
    const ok3 = host.kill(created.terminalId);
    assert.equal(ok3, true);
  } finally {
    host.disposeAll();
  }
});

ifAvailable('PtyHost: onOutput fires with terminalId + non-empty data', async () => {
  const host = new PtyHost();
  let receivedId: string | null = null;
  let receivedData = '';
  host.setListeners({
    onOutput: (ev) => {
      receivedId = ev.terminalId;
      receivedData += ev.data;
    },
    onExit: () => {},
  });
  const created = createTestPty(host);
  const marker = '__KODAX_PTY_TEST__';
  // Do not rely on an initial shell prompt: cmd.exe can start quietly under
  // concurrent node:test workers. Write a deterministic command instead.
  host.write(
    created.terminalId,
    process.platform === 'win32' ? `echo ${marker}\r` : `printf '${marker}\\n'\n`,
  );
  const sawMarker = await waitUntil(() => receivedData.includes(marker));
  try {
    assert.equal(sawMarker, true, 'test marker should be echoed by the shell');
    assert.equal(receivedId, created.terminalId, 'output is tagged with terminalId');
    assert.ok(receivedData.length > 0, 'shell emitted at least one byte of prompt');
  } finally {
    host.disposeAll();
  }
});

ifAvailable('PtyHost: onExit fires after kill', async () => {
  const host = new PtyHost();
  let exitCalled = false;
  let exitId: string | null = null;
  host.setListeners({
    onOutput: () => {},
    onExit: (ev) => {
      exitCalled = true;
      exitId = ev.terminalId;
    },
  });
  const created = createTestPty(host);
  host.kill(created.terminalId);
  // Give the kernel a moment to deliver the SIGTERM + node-pty to emit exit
  await delay(1500);
  assert.equal(exitCalled, true, 'onExit should fire after kill');
  assert.equal(exitId, created.terminalId, 'exit event carries the same id');
  assert.equal(host.has(created.terminalId), false, 'entry purged on exit');
  host.disposeAll();
});

ifAvailable('PtyHost: disposeAll clears count', () => {
  const host = new PtyHost();
  host.setListeners({ onOutput: () => {}, onExit: () => {} });
  createTestPty(host);
  createTestPty(host);
  assert.equal(host.count(), 2);
  host.disposeAll();
  assert.equal(host.count(), 0);
});
