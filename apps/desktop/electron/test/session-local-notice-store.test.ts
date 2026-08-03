import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import {
  appendSpaceOwnedLocalNotice,
  MAX_LOCAL_NOTICE_FILE_BYTES,
  SessionLocalNoticeStore,
} from '../kodax/session-local-notice-store.js';
import {
  removeFileIfUnchanged,
  replaceFileIfUnchanged,
  retireFileTransactionBackups,
  withFileTransactionLock,
} from '../kodax/atomic-file.js';

function sha256(bytes: Buffer): string {
  return `sha256:${crypto.createHash('sha256').update(bytes).digest('hex')}`;
}

function injectedFsError(code: string): NodeJS.ErrnoException {
  return Object.assign(new Error(`injected ${code}`), { code });
}

const execFileAsync = promisify(execFile);

let tmpDir = '';
let noticesDir = '';
let store: SessionLocalNoticeStore;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'kodax-session-local-notices-'));
  noticesDir = path.join(tmpDir, 'notices');
  store = new SessionLocalNoticeStore(noticesDir);
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
});

test('SessionLocalNoticeStore appends and restores local slash notices', async () => {
  await store.append('s_local-1', {
    id: 'ln_1',
    content: '/repointel status',
    sentAt: 1000,
    variant: 'echo',
  });
  await store.append('s_local-1', {
    id: 'ln_2',
    content: '[repointel] status: ok',
    sentAt: 1001,
    variant: 'output',
  });

  assert.deepEqual(await store.list('s_local-1'), [
    { id: 'ln_1', content: '/repointel status', sentAt: 1000, variant: 'echo' },
    { id: 'ln_2', content: '[repointel] status: ok', sentAt: 1001, variant: 'output' },
  ]);
});

test('Space-owned notice is durable before its optional SDK audit append runs', async () => {
  const notice = {
    id: 'ln_audit_success',
    content: '/status',
    sentAt: 1_500,
    variant: 'echo' as const,
  };
  let visibleDuringAudit = false;

  await appendSpaceOwnedLocalNotice(
    's_audit_success',
    notice,
    async () => {
      visibleDuringAudit = (await store.list('s_audit_success')).some(
        (candidate) => candidate.id === notice.id,
      );
      return { entryId: 'audit-entry' };
    },
    store,
  );

  assert.equal(visibleDuringAudit, true);
  assert.deepEqual(await store.list('s_audit_success'), [notice]);
});

test('Space-owned notice remains durable when its optional SDK audit append fails', async () => {
  const notice = {
    id: 'ln_audit_failure',
    content: '[status] local result',
    sentAt: 1_600,
    variant: 'output' as const,
  };

  const originalWarn = console.warn;
  const warnings: unknown[][] = [];
  console.warn = (...args: unknown[]) => warnings.push(args);
  try {
    await appendSpaceOwnedLocalNotice(
      's_audit_failure',
      notice,
      async () => {
        throw new Error('audit unavailable');
      },
      store,
    );
  } finally {
    console.warn = originalWarn;
  }

  assert.deepEqual(await store.list('s_audit_failure'), [notice]);
  assert.equal(warnings.length, 1);
  assert.match(String(warnings[0]?.[0]), /optional SDK audit append failed/);
});

test('Space-owned notice fails before optional audit when its primary side-store cannot persist', async () => {
  const blockedPath = path.join(tmpDir, 'not-a-directory');
  await fs.writeFile(blockedPath, 'blocking file', 'utf8');
  const blockedStore = new SessionLocalNoticeStore(blockedPath);
  let auditCalled = false;

  await assert.rejects(
    appendSpaceOwnedLocalNotice(
      's_store_failure',
      { id: 'ln_store_failure', content: '/status', sentAt: 1_700, variant: 'echo' },
      async () => {
        auditCalled = true;
      },
      blockedStore,
    ),
  );

  assert.equal(auditCalled, false);
  assert.deepEqual(await blockedStore.list('s_store_failure'), []);
});

test('Space-owned notice fails closed instead of overwriting a corrupt side-store', async () => {
  await store.append('s_corrupt', {
    id: 'before_corruption',
    content: '/before',
    sentAt: 1_800,
    variant: 'echo',
  });
  const [fileName] = await fs.readdir(noticesDir);
  const filePath = path.join(noticesDir, fileName!);
  await fs.writeFile(filePath, '{corrupt', 'utf8');
  let auditCalled = false;

  await assert.rejects(
    appendSpaceOwnedLocalNotice(
      's_corrupt',
      { id: 'after_corruption', content: '/after', sentAt: 1_801, variant: 'echo' },
      async () => {
        auditCalled = true;
      },
      store,
    ),
  );

  assert.equal(auditCalled, false);
  assert.equal(await fs.readFile(filePath, 'utf8'), '{corrupt');
});

test('SessionLocalNoticeStore replace fails closed instead of overwriting a corrupt side-store', async () => {
  const sessionId = 's_corrupt_replace';
  await store.append(sessionId, {
    id: 'before_corruption',
    content: '/before',
    sentAt: 1_900,
    variant: 'echo',
  });
  const [fileName] = await fs.readdir(noticesDir);
  const filePath = path.join(noticesDir, fileName!);
  await fs.writeFile(filePath, '{not valid json', 'utf8');

  await assert.rejects(
    store.replace(sessionId, [
      { id: 'replacement', content: '/replacement', sentAt: 1_901, variant: 'echo' },
    ]),
  );
  assert.equal(await fs.readFile(filePath, 'utf8'), '{not valid json');

  await assert.rejects(store.replace(sessionId, []));
  assert.equal(await fs.readFile(filePath, 'utf8'), '{not valid json');
});

test('SessionLocalNoticeStore retains a newest suffix within its UTF-8 file budget', async () => {
  const largeNotices = Array.from({ length: 40 }, (_, index) => ({
    id: `large_${String(index).padStart(2, '0')}`,
    content: `${index}:`.padEnd(240_000, 'x'),
    sentAt: 2_000 + index,
    variant: 'output' as const,
  }));

  await store.replace('s_bounded', largeNotices);

  const files = await fs.readdir(noticesDir);
  assert.equal(files.length, 1);
  const stat = await fs.stat(path.join(noticesDir, files[0]!));
  assert.ok(stat.size <= MAX_LOCAL_NOTICE_FILE_BYTES);
  const restored = await store.list('s_bounded');
  assert.ok(restored.length > 0 && restored.length < largeNotices.length);
  assert.equal(restored.at(-1)?.id, 'large_39');
  assert.notEqual(restored[0]?.id, 'large_00');
});

test('SessionLocalNoticeStore always retains the notice whose append is acknowledged', async () => {
  const existing = Array.from({ length: 34 }, (_, index) => ({
    id: `future_${String(index).padStart(2, '0')}`,
    content: `${index}:`.padEnd(240_000, 'x'),
    sentAt: 20_000 + index,
    variant: 'output' as const,
  }));
  await store.replace('s_clock_rollback', existing);

  await store.append('s_clock_rollback', {
    id: 'clock_rollback_append',
    content: 'required:'.padEnd(240_000, 'r'),
    sentAt: 1,
    variant: 'output',
  });

  const restored = await store.list('s_clock_rollback');
  assert.equal(
    restored.some((notice) => notice.id === 'clock_rollback_append'),
    true,
  );
  assert.equal(restored.at(-1)?.id, 'future_33');
  assert.ok(restored.length < existing.length + 1);
});

test('SessionLocalNoticeStore protects the current append at the 1000-row limit after clock rollback', async () => {
  const futureNotices = Array.from({ length: 1_000 }, (_, index) => ({
    id: `future_limit_${String(index).padStart(4, '0')}`,
    content: `/future-${index}`,
    sentAt: 100_000 + index,
    variant: 'echo' as const,
  }));
  await store.replace('s_count_limit_rollback', futureNotices);

  await store.append('s_count_limit_rollback', {
    id: 'current_after_rollback',
    content: '/current-after-rollback',
    sentAt: 1,
    variant: 'echo',
  });

  const restored = await store.list('s_count_limit_rollback');
  assert.equal(restored.length, 1_000);
  assert.equal(
    restored.some((notice) => notice.id === 'current_after_rollback'),
    true,
  );
  assert.equal(
    restored.some((notice) => notice.id === 'future_limit_0000'),
    false,
  );
});

test('SessionLocalNoticeStore rejects an oversized legacy file before parsing or overwriting it', async () => {
  await store.append('s_oversized_legacy', {
    id: 'seed',
    content: '/seed',
    sentAt: 3_000,
    variant: 'echo',
  });
  const [fileName] = await fs.readdir(noticesDir);
  const filePath = path.join(noticesDir, fileName!);
  const oversizedBytes = 17 * 1024 * 1024;
  await fs.writeFile(filePath, Buffer.alloc(oversizedBytes, 0x78));

  await assert.rejects(
    store.append('s_oversized_legacy', {
      id: 'must_not_overwrite',
      content: '/after',
      sentAt: 3_001,
      variant: 'echo',
    }),
    /bounded legacy read budget/i,
  );
  assert.equal((await fs.stat(filePath)).size, oversizedBytes);
});

test('SessionLocalNoticeStore replace trims stale notices and empty replace clears the file', async () => {
  await store.append('s_local-2', { id: 'old', content: '/old', sentAt: 1000, variant: 'echo' });
  await store.replace('s_local-2', [{ id: 'new', content: '/new', sentAt: 2000, variant: 'echo' }]);

  assert.deepEqual(await store.list('s_local-2'), [
    { id: 'new', content: '/new', sentAt: 2000, variant: 'echo' },
  ]);

  await store.replace('s_local-2', []);
  assert.deepEqual(await store.list('s_local-2'), []);
});

test('SessionLocalNoticeStore delete rejects when the canonical removal fails', async () => {
  const sessionId = 's_delete_failure';
  await store.append(sessionId, { id: 'seed', content: '/seed', sentAt: 1_000, variant: 'echo' });
  const failingStore = new SessionLocalNoticeStore(noticesDir, {
    beforeDeleteCommit: () => {
      throw injectedFsError('EACCES');
    },
  });

  await assert.rejects(failingStore.delete(sessionId), { code: 'EACCES' });
  assert.deepEqual(
    (await store.list(sessionId)).map((notice) => notice.id),
    ['seed'],
  );
});

test('SessionLocalNoticeStore hashes odd session ids instead of using them as paths', async () => {
  await store.append('../escape:sid', {
    id: 'ln_escape',
    content: '/status',
    sentAt: 1234,
    variant: 'echo',
  });

  const files = await fs.readdir(noticesDir);
  assert.equal(files.length, 1);
  assert.match(files[0] ?? '', /^[a-f0-9]{64}\.json$/);
  assert.deepEqual(await store.list('../escape:sid'), [
    { id: 'ln_escape', content: '/status', sentAt: 1234, variant: 'echo' },
  ]);
});

test('SessionLocalNoticeStore serializes concurrent appends', async () => {
  await Promise.all([
    store.append('s_local-concurrent', { id: 'a', content: '/a', sentAt: 1000, variant: 'echo' }),
    store.append('s_local-concurrent', { id: 'b', content: '/b', sentAt: 1001, variant: 'echo' }),
    store.append('s_local-concurrent', { id: 'c', content: '/c', sentAt: 1002, variant: 'echo' }),
  ]);

  assert.deepEqual(
    (await store.list('s_local-concurrent')).map((notice) => notice.id),
    ['a', 'b', 'c'],
  );
});

test('SessionLocalNoticeStore merges appends racing from separate process-local stores', async () => {
  const firstStore = new SessionLocalNoticeStore(noticesDir);
  const secondStore = new SessionLocalNoticeStore(noticesDir);

  await Promise.all([
    firstStore.append('s_cross_process_append', {
      id: 'from_first',
      content: '/first',
      sentAt: 1_000,
      variant: 'echo',
    }),
    secondStore.append('s_cross_process_append', {
      id: 'from_second',
      content: '/second',
      sentAt: 1_001,
      variant: 'echo',
    }),
  ]);

  assert.deepEqual(
    (await store.list('s_cross_process_append')).map((notice) => notice.id),
    ['from_first', 'from_second'],
  );
});

test('SessionLocalNoticeStore survives 50 rounds of cross-store lock contention', async () => {
  const firstStore = new SessionLocalNoticeStore(noticesDir);
  const secondStore = new SessionLocalNoticeStore(noticesDir);
  for (let round = 0; round < 50; round += 1) {
    const sessionId = `s_contention_stress_${round}`;
    await Promise.all([
      firstStore.append(sessionId, {
        id: `first_${round}`,
        content: '/first',
        sentAt: round * 2,
        variant: 'echo',
      }),
      secondStore.append(sessionId, {
        id: `second_${round}`,
        content: '/second',
        sentAt: round * 2 + 1,
        variant: 'echo',
      }),
    ]);
    assert.equal((await store.list(sessionId)).length, 2);
  }
});

test('SessionLocalNoticeStore serializes appends from an independent Node process', async () => {
  const sessionId = 's_real_cross_process_append';
  const childReadyPath = path.join(tmpDir, 'child-ready');
  const startPath = path.join(tmpDir, 'start-contention');
  const childStartedPath = path.join(tmpDir, 'child-started');
  const moduleUrl = new URL('../kodax/session-local-notice-store.ts', import.meta.url).href;
  const childScript = `
    import { SessionLocalNoticeStore } from ${JSON.stringify(moduleUrl)};
    import { promises as fs } from 'node:fs';
    const store = new SessionLocalNoticeStore(${JSON.stringify(noticesDir)});
    await fs.writeFile(${JSON.stringify(childReadyPath)}, 'ready');
    while (true) {
      try { await fs.lstat(${JSON.stringify(startPath)}); break; }
      catch (error) { if (error?.code !== 'ENOENT') throw error; }
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    await fs.writeFile(${JSON.stringify(childStartedPath)}, 'started');
    for (let index = 0; index < 8; index += 1) {
      await store.append(${JSON.stringify(sessionId)}, {
        id: \`child_\${index}\`, content: \`/child-\${index}\`, sentAt: 2000 + index, variant: 'echo'
      });
    }
  `;

  const child = execFileAsync(
    process.execPath,
    ['--import', 'tsx', '--input-type=module', '-e', childScript],
    {
      cwd: path.resolve('.'),
      windowsHide: true,
    },
  );
  const waitForFile = async (candidate: string): Promise<void> => {
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      try {
        await fs.lstat(candidate);
        return;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
      await new Promise<void>((resolve) => setTimeout(resolve, 5));
    }
    throw new Error(`timed out waiting for child barrier ${candidate}`);
  };
  await waitForFile(childReadyPath);
  await fs.writeFile(startPath, 'go');
  await waitForFile(childStartedPath);
  await Promise.all([
    child,
    (async () => {
      for (let index = 0; index < 8; index += 1) {
        await store.append(sessionId, {
          id: `parent_${index}`,
          content: `/parent-${index}`,
          sentAt: 1_000 + index,
          variant: 'echo',
        });
      }
    })(),
  ]);

  const ids = (await store.list(sessionId)).map((notice) => notice.id);
  assert.equal(ids.length, 16);
  assert.deepEqual(ids.slice(0, 8), Array.from({ length: 8 }, (_, index) => `parent_${index}`));
  assert.deepEqual(ids.slice(8), Array.from({ length: 8 }, (_, index) => `child_${index}`));
});

test('SessionLocalNoticeStore serializes replace with a competing process-local append', async () => {
  const sessionId = 's_cross_process_replace';
  await store.append(sessionId, {
    id: 'seed',
    content: '/seed',
    sentAt: 1_000,
    variant: 'echo',
  });

  const competingStore = new SessionLocalNoticeStore(noticesDir);
  let competingAppend: Promise<void> | undefined;
  const replacingStore = new SessionLocalNoticeStore(noticesDir, {
    beforeReplaceCommit: () => {
      competingAppend = competingStore.append(sessionId, {
        id: 'concurrent',
        content: '/concurrent',
        sentAt: 1_050,
        variant: 'echo',
      });
    },
  });

  await replacingStore.replace(sessionId, [
    { id: 'replacement', content: '/replacement', sentAt: 1_100, variant: 'echo' },
  ]);
  assert.ok(competingAppend);
  await competingAppend;

  assert.deepEqual(
    (await store.list(sessionId)).map((notice) => notice.id),
    ['concurrent', 'replacement'],
  );
});

test('SessionLocalNoticeStore serializes truncation with competing process-local appends', async () => {
  const sessionId = 's_cross_process_truncate';
  await store.replace(sessionId, [
    { id: 'old_seed', content: '/old-seed', sentAt: 1_000, variant: 'echo' },
    { id: 'new_seed', content: '/new-seed', sentAt: 3_000, variant: 'echo' },
  ]);

  const competingStore = new SessionLocalNoticeStore(noticesDir);
  const competingAppends: Promise<void>[] = [];
  const truncatingStore = new SessionLocalNoticeStore(noticesDir, {
    beforeTruncateCommit: async (_candidateSessionId, attempt) => {
      if (attempt !== 0) return;
      competingAppends.push(
        competingStore.append(sessionId, {
          id: 'old_concurrent',
          content: '/old-concurrent',
          sentAt: 1_500,
          variant: 'echo',
        }),
        competingStore.append(sessionId, {
          id: 'new_concurrent',
          content: '/new-concurrent',
          sentAt: 3_500,
          variant: 'echo',
        }),
      );
    },
  });

  await truncatingStore.truncateBefore(sessionId, 2_000);
  await Promise.all(competingAppends);

  assert.deepEqual(
    (await store.list(sessionId)).map((notice) => notice.id),
    ['old_seed', 'old_concurrent', 'new_concurrent'],
  );
});

test('SessionLocalNoticeStore readers wait through the canonical displacement window', async () => {
  const sessionId = 's_displacement_reader';
  await store.append(sessionId, { id: 'seed', content: '/seed', sentAt: 1_000, variant: 'echo' });

  const competingReader = new SessionLocalNoticeStore(noticesDir);
  let readDuringDisplacement: Promise<readonly { id: string }[]> | undefined;
  let readerSettled = false;
  const replacingStore = new SessionLocalNoticeStore(noticesDir, {
    atomicMutation: {
      afterDisplace: async () => {
        readDuringDisplacement = competingReader.list(sessionId).then((notices) => {
          readerSettled = true;
          return notices;
        });
        await new Promise<void>((resolve) => setTimeout(resolve, 50));
        assert.equal(readerSettled, false);
      },
    },
  });

  await replacingStore.replace(sessionId, [
    { id: 'replacement', content: '/replacement', sentAt: 1_100, variant: 'echo' },
  ]);
  assert.ok(readDuringDisplacement);
  assert.deepEqual((await readDuringDisplacement).map((notice) => notice.id), ['replacement']);
});

test('conditional replace restores canonical bytes after a post-displacement EIO', async () => {
  const filePath = path.join(tmpDir, 'replace-eio.json');
  const original = Buffer.from('original bytes');
  await fs.writeFile(filePath, original);

  await assert.rejects(
    replaceFileIfUnchanged(filePath, Buffer.from('replacement'), sha256(original), 'changed', 1024, {
      beforeDisplacedRead: () => {
        throw injectedFsError('EIO');
      },
    }),
    /changed/i,
  );
  assert.deepEqual(await fs.readFile(filePath), original);
});

test('conditional remove restores canonical bytes after a post-displacement EACCES', async () => {
  const filePath = path.join(tmpDir, 'remove-eacces.json');
  const original = Buffer.from('original bytes');
  await fs.writeFile(filePath, original);

  await assert.rejects(
    removeFileIfUnchanged(filePath, sha256(original), 'changed', 1024, {
      beforeRemoveFinalize: () => {
        throw injectedFsError('EACCES');
      },
    }),
    /changed/i,
  );
  assert.deepEqual(await fs.readFile(filePath), original);
});

test('conditional replace preserves a displaced backup when recovery itself fails', async () => {
  const filePath = path.join(tmpDir, 'replace-recovery-failure.json');
  const original = Buffer.from('recoverable original');
  await fs.writeFile(filePath, original);

  await assert.rejects(
    replaceFileIfUnchanged(filePath, Buffer.from('replacement'), sha256(original), 'changed', 1024, {
      beforeDisplacedRead: () => {
        throw injectedFsError('EIO');
      },
      beforeRestore: () => {
        throw injectedFsError('EACCES');
      },
    }),
    /original retained at/i,
  );
  const backups = (await fs.readdir(tmpDir)).filter((name) => name.includes('-previous-'));
  assert.equal(backups.length, 1);
  assert.deepEqual(await fs.readFile(path.join(tmpDir, backups[0]!)), original);
  await assert.rejects(fs.lstat(filePath), { code: 'ENOENT' });

  await withFileTransactionLock(filePath, 'changed', async () => {
    assert.deepEqual(await fs.readFile(filePath), original);
  });
});

test('conditional replace never overwrites a racing canonical and retains the displaced backup', async () => {
  const filePath = path.join(tmpDir, 'replace-racing-target.json');
  const original = Buffer.from('original before race');
  await fs.writeFile(filePath, original);

  await assert.rejects(
    replaceFileIfUnchanged(filePath, Buffer.from('replacement'), sha256(original), 'changed', 1024, {
      beforeInstall: async () => {
        await fs.writeFile(filePath, 'racing writer', { flag: 'wx' });
      },
    }),
    /previous version retained at/i,
  );
  assert.equal(await fs.readFile(filePath, 'utf8'), 'racing writer');
  const backups = (await fs.readdir(tmpDir)).filter((name) => name.includes('-previous-'));
  assert.equal(backups.length, 1);
  assert.deepEqual(await fs.readFile(path.join(tmpDir, backups[0]!)), original);

  await withFileTransactionLock(filePath, 'changed', async () => {
    await retireFileTransactionBackups(filePath);
    await fs.rm(filePath);
  });
  await withFileTransactionLock(filePath, 'changed', async () => {
    await assert.rejects(fs.lstat(filePath), { code: 'ENOENT' });
  });
  const retained = (await fs.readdir(tmpDir)).filter((name) => name.includes('-retained-'));
  assert.equal(retained.length, 1);
  assert.deepEqual(await fs.readFile(path.join(tmpDir, retained[0]!)), original);
});

test('SessionLocalNoticeStore quarantines an abandoned lease instead of hanging', async () => {
  const sessionId = 's_abandoned_lock';
  await store.append(sessionId, { id: 'seed', content: '/seed', sentAt: 1_000, variant: 'echo' });
  const [noticeFileName] = (await fs.readdir(noticesDir)).filter((name) => name.endsWith('.json'));
  const noticePath = path.join(noticesDir, noticeFileName!);
  const resolvedNoticePath = path.resolve(noticePath);
  const key = crypto
    .createHash('sha256')
    .update(process.platform === 'win32' ? resolvedNoticePath.toLowerCase() : resolvedNoticePath)
    .digest('hex')
    .slice(0, 16);
  const lockPath = path.join(noticesDir, `.kodax-atomic-${key}-lock`);
  await fs.writeFile(
    lockPath,
    JSON.stringify({
      version: 1,
      pid: 2_147_483_647,
      processInstanceId: 'dead-process',
      token: 'dead-lock',
      createdAt: Date.now() - 60_000,
    }),
  );
  const old = new Date(Date.now() - 60_000);
  await fs.utimes(lockPath, old, old);

  assert.deepEqual(
    (await store.list(sessionId)).map((notice) => notice.id),
    ['seed'],
  );
  await assert.rejects(fs.lstat(lockPath), { code: 'ENOENT' });
});

test('an old lease with a live owner PID is never stolen', async () => {
  const filePath = path.join(tmpDir, 'live-owner.json');
  await fs.writeFile(filePath, 'live owner canonical');
  const resolvedPath = path.resolve(filePath);
  const key = crypto
    .createHash('sha256')
    .update(process.platform === 'win32' ? resolvedPath.toLowerCase() : resolvedPath)
    .digest('hex')
    .slice(0, 16);
  const lockPath = path.join(tmpDir, `.kodax-atomic-${key}-lock`);
  const owner = {
    version: 1,
    pid: process.pid,
    processInstanceId: 'suspended-but-live-process',
    token: 'must-not-be-fenced-out',
    createdAt: Date.now() - 60_000,
  };
  await fs.writeFile(lockPath, JSON.stringify(owner));
  const old = new Date(Date.now() - 60_000);
  await fs.utimes(lockPath, old, old);
  let entered = false;

  await assert.rejects(
    withFileTransactionLock(
      filePath,
      'changed',
      async () => {
        entered = true;
      },
      { waitTimeoutMs: 50 },
    ),
    /timed out waiting for the cross-process transaction lock/i,
  );

  assert.equal(entered, false);
  assert.deepEqual(JSON.parse(await fs.readFile(lockPath, 'utf8')), owner);
  assert.equal(await fs.readFile(filePath, 'utf8'), 'live owner canonical');
});

test('a losing staged initializer never removes the winning lease', async () => {
  const filePath = path.join(tmpDir, 'initializer-claim-race.json');
  await fs.writeFile(filePath, 'canonical');
  let releaseFirstStage!: () => void;
  const firstStageMayClaim = new Promise<void>((resolve) => {
    releaseFirstStage = resolve;
  });
  let firstStaged!: () => void;
  const firstIsStaged = new Promise<void>((resolve) => {
    firstStaged = resolve;
  });
  let releaseWinner!: () => void;
  const winnerMayFinish = new Promise<void>((resolve) => {
    releaseWinner = resolve;
  });
  let winnerEntered!: () => void;
  const winnerHasLease = new Promise<void>((resolve) => {
    winnerEntered = resolve;
  });
  let firstEntered = false;
  let thirdEntered = false;

  const first = withFileTransactionLock(
    filePath,
    'changed',
    async () => {
      firstEntered = true;
    },
    {
      waitTimeoutMs: 2_000,
      afterOwnerStaged: async () => {
        firstStaged();
        await firstStageMayClaim;
      },
    },
  );
  await firstIsStaged;

  const winner = withFileTransactionLock(filePath, 'changed', async () => {
    winnerEntered();
    await winnerMayFinish;
  });
  await winnerHasLease;
  releaseFirstStage();

  await assert.rejects(
    withFileTransactionLock(
      filePath,
      'changed',
      async () => {
        thirdEntered = true;
      },
      { waitTimeoutMs: 75 },
    ),
    /timed out waiting for the cross-process transaction lock/i,
  );
  assert.equal(firstEntered, false);
  assert.equal(thirdEntered, false);

  releaseWinner();
  await winner;
  await first;
  assert.equal(firstEntered, true);
  assert.equal(await fs.readFile(filePath, 'utf8'), 'canonical');
});

test('generation reapers serialize two stale-lock observers without touching a new owner', async () => {
  const filePath = path.join(tmpDir, 'double-reaper.json');
  await fs.writeFile(filePath, 'canonical');
  const resolvedPath = path.resolve(filePath);
  const key = crypto
    .createHash('sha256')
    .update(process.platform === 'win32' ? resolvedPath.toLowerCase() : resolvedPath)
    .digest('hex')
    .slice(0, 16);
  const lockPath = path.join(tmpDir, `.kodax-atomic-${key}-lock`);
  await fs.writeFile(
    lockPath,
    JSON.stringify({
      version: 1,
      pid: 2_147_483_647,
      processInstanceId: 'dead-owner',
      token: 'dead-owner-token',
      createdAt: Date.now() - 60_000,
    }),
  );

  let observationCount = 0;
  let releaseObservers!: () => void;
  const bothObserved = new Promise<void>((resolve) => {
    releaseObservers = resolve;
  });
  const options = {
    waitTimeoutMs: 2_000,
    afterAbandonedObserved: async (): Promise<void> => {
      observationCount += 1;
      if (observationCount === 2) releaseObservers();
      await bothObserved;
    },
  };
  let active = 0;
  let maxActive = 0;
  const completed: string[] = [];
  const run = (id: string): Promise<void> =>
    withFileTransactionLock(
      filePath,
      'changed',
      async () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise<void>((resolve) => setTimeout(resolve, 25));
        completed.push(id);
        active -= 1;
      },
      options,
    );

  await Promise.all([run('first'), run('second')]);
  assert.equal(observationCount, 2);
  assert.equal(maxActive, 1);
  assert.deepEqual(completed.sort(), ['first', 'second']);
  assert.equal(await fs.readFile(filePath, 'utf8'), 'canonical');
  assert.equal(
    (await fs.readdir(tmpDir)).some((name) =>
      name.startsWith(`.kodax-atomic-${key}-reaper-`),
    ),
    false,
  );
});

test('dead generation reaper markers recover with the main lock present or absent', async () => {
  for (const lockPresent of [true, false]) {
    const filePath = path.join(tmpDir, `dead-reaper-${lockPresent ? 'with' : 'without'}-lock.json`);
    await fs.writeFile(filePath, 'canonical');
    const resolvedPath = path.resolve(filePath);
    const key = crypto
      .createHash('sha256')
      .update(process.platform === 'win32' ? resolvedPath.toLowerCase() : resolvedPath)
      .digest('hex')
      .slice(0, 16);
    const lockPath = path.join(tmpDir, `.kodax-atomic-${key}-lock`);
    const deadOwner = JSON.stringify({
      version: 1,
      pid: 2_147_483_647,
      processInstanceId: 'dead-reaper-process',
      token: `dead-reaper-${lockPresent}`,
      createdAt: Date.now() - 60_000,
    });
    if (lockPresent) await fs.writeFile(lockPath, deadOwner);
    const markerPath = path.join(
      tmpDir,
      `.kodax-atomic-${key}-reaper-crashed-${lockPresent}.lease`,
    );
    await fs.writeFile(markerPath, deadOwner);
    let entered = false;

    await withFileTransactionLock(
      filePath,
      'changed',
      async () => {
        entered = true;
      },
      { waitTimeoutMs: 1_000 },
    );

    assert.equal(entered, true);
    await assert.rejects(fs.lstat(markerPath), { code: 'ENOENT' });
    await assert.rejects(fs.lstat(lockPath), { code: 'ENOENT' });
  }
});

test('reaper cleanup exhaustion cannot poison later access in the same process', async () => {
  const filePath = path.join(tmpDir, 'reaper-cleanup-exhaustion.json');
  await fs.writeFile(filePath, 'canonical');
  const resolvedPath = path.resolve(filePath);
  const key = crypto
    .createHash('sha256')
    .update(process.platform === 'win32' ? resolvedPath.toLowerCase() : resolvedPath)
    .digest('hex')
    .slice(0, 16);
  const lockPath = path.join(tmpDir, `.kodax-atomic-${key}-lock`);
  await fs.writeFile(
    lockPath,
    JSON.stringify({
      version: 1,
      pid: 2_147_483_647,
      processInstanceId: 'dead-owner-for-reaper-cleanup',
      token: 'dead-owner-for-reaper-cleanup',
      createdAt: Date.now() - 60_000,
    }),
  );
  let operationCount = 0;

  await withFileTransactionLock(
    filePath,
    'changed',
    async () => {
      operationCount += 1;
    },
    {
      beforeLeaseUnlink: (candidate) => {
        if (candidate.includes(`.kodax-atomic-${key}-reaper-`) && candidate.endsWith('.lease')) {
          throw injectedFsError('EPERM');
        }
      },
    },
  );
  assert.equal(operationCount, 1);
  assert.equal(
    (await fs.readdir(tmpDir)).some(
      (name) => name.startsWith(`.kodax-atomic-${key}-reaper-`) && name.endsWith('.lease'),
    ),
    true,
  );

  await withFileTransactionLock(filePath, 'changed', async () => {
    operationCount += 1;
  });
  assert.equal(operationCount, 2);
  assert.equal(
    (await fs.readdir(tmpDir)).some(
      (name) => name.startsWith(`.kodax-atomic-${key}-reaper-`) && name.endsWith('.lease'),
    ),
    false,
  );
});

test('each reap attempt has a unique generation and cannot unlock the later main owner', async () => {
  const filePath = path.join(tmpDir, 'unique-reaper-generations.json');
  await fs.writeFile(filePath, 'canonical');
  const resolvedPath = path.resolve(filePath);
  const key = crypto
    .createHash('sha256')
    .update(process.platform === 'win32' ? resolvedPath.toLowerCase() : resolvedPath)
    .digest('hex')
    .slice(0, 16);
  const lockPath = path.join(tmpDir, `.kodax-atomic-${key}-lock`);
  const writeDeadOwner = async (token: string): Promise<void> => {
    await fs.writeFile(
      lockPath,
      JSON.stringify({
        version: 1,
        pid: 2_147_483_647,
        processInstanceId: `dead-owner-${token}`,
        token,
        createdAt: Date.now() - 60_000,
      }),
    );
  };
  await writeDeadOwner('first');

  let reapCount = 0;
  let firstReaperPath = '';
  let secondReaperPath = '';
  let operationEntered!: () => void;
  const operationHasLease = new Promise<void>((resolve) => {
    operationEntered = resolve;
  });
  let releaseOperation!: () => void;
  const operationMayFinish = new Promise<void>((resolve) => {
    releaseOperation = resolve;
  });
  let thirdEntered = false;

  const claimant = withFileTransactionLock(
    filePath,
    'changed',
    async () => {
      operationEntered();
      await operationMayFinish;
    },
    {
      waitTimeoutMs: 2_000,
      afterReaperClaimed: async (_claimedLockPath, reaperPath) => {
        reapCount += 1;
        if (reapCount === 1) {
          firstReaperPath = reaperPath;
          await fs.unlink(lockPath);
          await writeDeadOwner('second');
        } else if (reapCount === 2) {
          secondReaperPath = reaperPath;
        }
      },
      beforeLeaseUnlink: (candidate) => {
        if (candidate === firstReaperPath) throw injectedFsError('EPERM');
      },
    },
  );
  await operationHasLease;

  assert.equal(reapCount, 2);
  assert.notEqual(firstReaperPath, secondReaperPath);
  assert.equal((await fs.lstat(firstReaperPath)).isFile(), true);

  await assert.rejects(
    withFileTransactionLock(
      filePath,
      'changed',
      async () => {
        thirdEntered = true;
      },
      { waitTimeoutMs: 75 },
    ),
    /timed out waiting for the cross-process transaction lock/i,
  );
  assert.equal(thirdEntered, false);

  releaseOperation();
  await claimant;
  await assert.rejects(fs.lstat(lockPath), { code: 'ENOENT' });
});

test('an unsafe non-file reaper marker fails closed until the bounded deadline', async () => {
  const filePath = path.join(tmpDir, 'unsafe-reaper-marker.json');
  await fs.writeFile(filePath, 'canonical');
  const resolvedPath = path.resolve(filePath);
  const key = crypto
    .createHash('sha256')
    .update(process.platform === 'win32' ? resolvedPath.toLowerCase() : resolvedPath)
    .digest('hex')
    .slice(0, 16);
  const unsafeMarkerPath = path.join(tmpDir, `.kodax-atomic-${key}-reaper-unsafe.lease`);
  await fs.mkdir(unsafeMarkerPath);
  let entered = false;

  await assert.rejects(
    withFileTransactionLock(
      filePath,
      'changed',
      async () => {
        entered = true;
      },
      { waitTimeoutMs: 50 },
    ),
    /timed out waiting for the cross-process transaction lock/i,
  );

  assert.equal(entered, false);
  assert.equal((await fs.lstat(unsafeMarkerPath)).isDirectory(), true);
  assert.equal(await fs.readFile(filePath, 'utf8'), 'canonical');
});

test('a leftover reaper staging temp is not mistaken for an active marker', async () => {
  const filePath = path.join(tmpDir, 'leftover-reaper-stage.json');
  await fs.writeFile(filePath, 'canonical');
  const resolvedPath = path.resolve(filePath);
  const key = crypto
    .createHash('sha256')
    .update(process.platform === 'win32' ? resolvedPath.toLowerCase() : resolvedPath)
    .digest('hex')
    .slice(0, 16);
  const leftoverStagePath = path.join(
    tmpDir,
    `.kodax-atomic-${key}-reaper-owner-old-staging.tmp`,
  );
  await fs.writeFile(
    leftoverStagePath,
    JSON.stringify({
      version: 1,
      pid: process.pid,
      processInstanceId: 'current-process-old-stage',
      token: 'old-stage-token',
      createdAt: Date.now(),
    }),
  );
  let entered = false;

  await withFileTransactionLock(
    filePath,
    'changed',
    async () => {
      entered = true;
    },
    { waitTimeoutMs: 250 },
  );

  assert.equal(entered, true);
  assert.equal(await fs.readFile(filePath, 'utf8'), 'canonical');
  assert.equal((await fs.lstat(leftoverStagePath)).isFile(), true);
});

test('release retry exhaustion leaves a recoverable intent instead of poisoning the live PID', async () => {
  const filePath = path.join(tmpDir, 'release-exhaustion.json');
  await fs.writeFile(filePath, 'canonical');
  const resolvedPath = path.resolve(filePath);
  const key = crypto
    .createHash('sha256')
    .update(process.platform === 'win32' ? resolvedPath.toLowerCase() : resolvedPath)
    .digest('hex')
    .slice(0, 16);
  const lockPath = path.join(tmpDir, `.kodax-atomic-${key}-lock`);
  let firstEntered = false;
  let intentPublishing = false;
  let mainUnlinkAttempts = 0;

  await withFileTransactionLock(
    filePath,
    'changed',
    async () => {
      firstEntered = true;
    },
    {
      beforeLeaseUnlink: (candidate) => {
        if (candidate !== lockPath) return;
        assert.equal(intentPublishing, false, 'old owner unlinked after intent became visible');
        mainUnlinkAttempts += 1;
        throw injectedFsError('EPERM');
      },
      beforeReleaseIntentPublish: () => {
        intentPublishing = true;
      },
    },
  );
  assert.equal(firstEntered, true);
  assert.equal(mainUnlinkAttempts, 8);
  assert.equal((await fs.lstat(lockPath)).isFile(), true);
  assert.equal(
    (await fs.readdir(tmpDir)).some((name) =>
      name.startsWith(`.kodax-atomic-${key}-released-`),
    ),
    true,
  );

  let recoveredEntered = false;
  await withFileTransactionLock(
    filePath,
    'changed',
    async () => {
      recoveredEntered = true;
    },
    { waitTimeoutMs: 1_000 },
  );

  assert.equal(recoveredEntered, true);
  await assert.rejects(fs.lstat(lockPath), { code: 'ENOENT' });
  assert.equal(
    (await fs.readdir(tmpDir)).some((name) =>
      name.startsWith(`.kodax-atomic-${key}-released-`),
    ),
    false,
  );
});

test('intent staging cleanup exhaustion cannot flip the logical release commit', async () => {
  const filePath = path.join(tmpDir, 'intent-stage-cleanup-exhaustion.json');
  await fs.writeFile(filePath, 'canonical');
  const resolvedPath = path.resolve(filePath);
  const key = crypto
    .createHash('sha256')
    .update(process.platform === 'win32' ? resolvedPath.toLowerCase() : resolvedPath)
    .digest('hex')
    .slice(0, 16);
  const lockPath = path.join(tmpDir, `.kodax-atomic-${key}-lock`);
  let operationCount = 0;

  await withFileTransactionLock(
    filePath,
    'changed',
    async () => {
      operationCount += 1;
    },
    {
      beforeLeaseUnlink: (candidate) => {
        if (candidate === lockPath || candidate.includes('-release-owner-')) {
          throw injectedFsError('EBUSY');
        }
      },
    },
  );
  assert.equal(operationCount, 1);
  assert.equal((await fs.lstat(lockPath)).isFile(), true);
  assert.equal(
    (await fs.readdir(tmpDir)).some((name) => name.includes('-release-owner-')),
    true,
  );

  await withFileTransactionLock(
    filePath,
    'changed',
    async () => {
      operationCount += 1;
    },
    { waitTimeoutMs: 1_000 },
  );
  assert.equal(operationCount, 2);
});

test('successful physical release does not publish or clean a release intent', async () => {
  const filePath = path.join(tmpDir, 'intent-cleanup-exhaustion.json');
  await fs.writeFile(filePath, 'canonical');
  let operationCount = 0;
  let publishCalled = false;

  await withFileTransactionLock(
    filePath,
    'changed',
    async () => {
      operationCount += 1;
    },
    {
      beforeReleaseIntentPublish: () => {
        publishCalled = true;
      },
    },
  );

  assert.equal(operationCount, 1);
  await withFileTransactionLock(filePath, 'changed', async () => {
    operationCount += 1;
  });
  assert.equal(operationCount, 2);
  assert.equal(publishCalled, false);
});

test('a mismatched release-intent EEXIST never proves a live owner abandoned', async () => {
  const filePath = path.join(tmpDir, 'mismatched-release-intent.json');
  await fs.writeFile(filePath, 'canonical');
  const resolvedPath = path.resolve(filePath);
  const key = crypto
    .createHash('sha256')
    .update(process.platform === 'win32' ? resolvedPath.toLowerCase() : resolvedPath)
    .digest('hex')
    .slice(0, 16);
  const token = 'live-owner-with-invalid-intent';
  const lockPath = path.join(tmpDir, `.kodax-atomic-${key}-lock`);
  const intentPath = path.join(tmpDir, `.kodax-atomic-${key}-released-${token}.lease`);
  const owner = {
    version: 1,
    pid: process.pid,
    processInstanceId: 'live-owner-process',
    token,
    createdAt: Date.now(),
  };
  await fs.writeFile(lockPath, JSON.stringify(owner));
  await fs.writeFile(intentPath, '{mismatched intent');
  let entered = false;

  await assert.rejects(
    withFileTransactionLock(
      filePath,
      'changed',
      async () => {
        entered = true;
      },
      { waitTimeoutMs: 50 },
    ),
    /timed out waiting for the cross-process transaction lock/i,
  );

  assert.equal(entered, false);
  assert.equal(JSON.parse(await fs.readFile(lockPath, 'utf8')).token, token);
  assert.equal(await fs.readFile(intentPath, 'utf8'), '{mismatched intent');
});

test('successful physical unlink bypasses release-intent publication', async () => {
  const filePath = path.join(tmpDir, 'intent-publish-failure.json');
  await fs.writeFile(filePath, 'canonical');
  let operationCount = 0;
  let publishCalled = false;

  await withFileTransactionLock(
    filePath,
    'changed',
    async () => {
      operationCount += 1;
    },
    {
      beforeReleaseIntentPublish: () => {
        publishCalled = true;
        throw injectedFsError('EACCES');
      },
    },
  );
  await withFileTransactionLock(filePath, 'changed', async () => {
    operationCount += 1;
  });

  assert.equal(operationCount, 2);
  assert.equal(publishCalled, false);
});

test('same-process generation fencing recovers when intent publish and main unlink both fail', async () => {
  const filePath = path.join(tmpDir, 'intent-and-unlink-failure.json');
  await fs.writeFile(filePath, 'canonical');
  const resolvedPath = path.resolve(filePath);
  const key = crypto
    .createHash('sha256')
    .update(process.platform === 'win32' ? resolvedPath.toLowerCase() : resolvedPath)
    .digest('hex')
    .slice(0, 16);
  const lockPath = path.join(tmpDir, `.kodax-atomic-${key}-lock`);
  let operationCount = 0;

  await assert.rejects(
    withFileTransactionLock(
      filePath,
      'changed',
      async () => {
        operationCount += 1;
      },
      {
        beforeReleaseIntentPublish: async (intentPath) => {
          await fs.writeFile(intentPath, '{mismatched release intent', { flag: 'wx' });
        },
        beforeLeaseUnlink: (candidate) => {
          if (candidate === lockPath) throw injectedFsError('EPERM');
        },
      },
    ),
    /main lease release and release intent publication both failed/i,
  );
  assert.equal((await fs.lstat(lockPath)).isFile(), true);

  await withFileTransactionLock(
    filePath,
    'changed',
    async () => {
      operationCount += 1;
    },
    { waitTimeoutMs: 1_000 },
  );
  assert.equal(operationCount, 2);
  await assert.rejects(fs.lstat(lockPath), { code: 'ENOENT' });
});

test('a new lease archives a crash-after-install backup instead of leaving it active', async () => {
  const filePath = path.join(tmpDir, 'crash-after-install.json');
  await fs.writeFile(filePath, 'committed replacement');
  const resolvedPath = path.resolve(filePath);
  const key = crypto
    .createHash('sha256')
    .update(process.platform === 'win32' ? resolvedPath.toLowerCase() : resolvedPath)
    .digest('hex')
    .slice(0, 16);
  const activeBackupPath = path.join(tmpDir, `.kodax-atomic-${key}-previous-crashed.tmp`);
  await fs.writeFile(activeBackupPath, 'pre-install original');

  await withFileTransactionLock(filePath, 'changed', async () => {
    assert.equal(await fs.readFile(filePath, 'utf8'), 'committed replacement');
  });

  await assert.rejects(fs.lstat(activeBackupPath), { code: 'ENOENT' });
  const retained = (await fs.readdir(tmpDir)).filter((name) => name.includes('-retained-'));
  assert.equal(retained.length, 1);
  assert.equal(await fs.readFile(path.join(tmpDir, retained[0]!), 'utf8'), 'pre-install original');
});
