import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  truncateSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PartnerDeliveryStore } from '../kodax/partner-delivery-store.js';

function harness() {
  const dir = mkdtempSync(join(tmpdir(), 'partner-delivery-store-'));
  const projectRoot = join(dir, 'project');
  const runsDir = join(dir, 'partner-runs');
  mkdirSync(projectRoot, { recursive: true });
  const store = new PartnerDeliveryStore(join(dir, 'deliveries.json'), runsDir);
  return { dir, projectRoot, runsDir, store };
}

test('PartnerDeliveryStore writes arbitrary deliverables into the session output workspace', async () => {
  const { dir, projectRoot, store } = harness();
  try {
    const delivery = await store.writeRunOutput({
      sessionId: 's1',
      projectRoot,
      relativePath: 'analysis/custom.weird',
      bytes: Buffer.from([0, 1, 2, 3, 255]),
      title: 'Custom binary',
      mime: 'application/x-weird',
      sourceRefs: ['src_1'],
      producer: 'write_partner_deliverable',
    });

    assert.match(delivery.id, /^pd_/);
    assert.equal(delivery.kind, 'file');
    assert.equal(delivery.rootKind, 'run-output');
    assert.equal(delivery.relativePath, 'analysis/custom.weird');
    assert.equal(delivery.extension, '.weird');
    assert.equal(delivery.mime, 'application/x-weird');
    assert.equal(delivery.sizeBytes, 5);
    assert.match(delivery.contentHash ?? '', /^sha256:[a-f0-9]{64}$/);
    assert.deepEqual(delivery.sourceRefs, ['src_1']);
    assert.equal(existsSync(delivery.absolutePath), true);

    const read = await store.readBinary(delivery.id, 1024);
    assert.equal(read.base64, Buffer.from([0, 1, 2, 3, 255]).toString('base64'));
    assert.equal(read.truncated, false);
  } finally {
    store.invalidate();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('PartnerDeliveryStore upserts an existing delivery path', async () => {
  const { dir, projectRoot, store } = harness();
  try {
    const first = await store.writeRunOutput({
      sessionId: 's1',
      projectRoot,
      relativePath: 'report.md',
      bytes: Buffer.from('v1', 'utf8'),
      producer: 'write_partner_deliverable',
    });
    const second = await store.writeRunOutput({
      sessionId: 's1',
      projectRoot,
      relativePath: 'report.md',
      bytes: Buffer.from('v2', 'utf8'),
      producer: 'write_partner_deliverable',
    });
    assert.equal(second.id, first.id);
    assert.equal(readFileSync(second.absolutePath, 'utf8'), 'v2');
    assert.equal((await store.list({ sessionId: 's1' })).length, 1);
  } finally {
    store.invalidate();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('PartnerDeliveryStore Windows fallback replaces normal files without a partial copy', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'partner-delivery-store-fallback-'));
  const projectRoot = join(dir, 'project');
  const runsDir = join(dir, 'partner-runs');
  mkdirSync(projectRoot, { recursive: true });
  const store = new PartnerDeliveryStore(join(dir, 'deliveries.json'), runsDir, {
    deliveryWrite: { forceRenameFallback: true },
  });
  try {
    const first = await store.writeRunOutput({
      sessionId: 's1',
      projectRoot,
      relativePath: 'report.md',
      bytes: Buffer.from('v1'),
      producer: 'write_partner_deliverable',
    });
    const second = await store.writeRunOutput({
      sessionId: 's1',
      projectRoot,
      relativePath: 'report.md',
      bytes: Buffer.from('v2'),
      producer: 'write_partner_deliverable',
    });
    assert.equal(second.id, first.id);
    assert.equal(readFileSync(second.absolutePath, 'utf8'), 'v2');
  } finally {
    store.invalidate();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('PartnerDeliveryStore never writes through a hard-link raced into the fallback target', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'partner-delivery-store-hardlink-'));
  const projectRoot = join(dir, 'project');
  const runsDir = join(dir, 'partner-runs');
  const outsidePath = join(dir, 'outside.txt');
  mkdirSync(projectRoot, { recursive: true });
  writeFileSync(outsidePath, 'outside-must-not-change');
  let injected = false;
  const store = new PartnerDeliveryStore(join(dir, 'deliveries.json'), runsDir, {
    deliveryWrite: {
      forceRenameFallback: true,
      beforeFallbackDisplace: (targetPath) => {
        assert.equal(injected, false);
        linkSync(outsidePath, targetPath);
        injected = true;
      },
    },
  });
  try {
    const delivery = await store.writeRunOutput({
      sessionId: 's1',
      projectRoot,
      relativePath: 'raced.txt',
      bytes: Buffer.from('inside-output'),
      producer: 'write_partner_deliverable',
    });
    assert.equal(injected, true);
    assert.equal(readFileSync(outsidePath, 'utf8'), 'outside-must-not-change');
    assert.equal(readFileSync(delivery.absolutePath, 'utf8'), 'inside-output');
  } finally {
    store.invalidate();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('PartnerDeliveryStore preserves a concurrent creator and the displaced output', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'partner-delivery-store-conflict-'));
  const projectRoot = join(dir, 'project');
  const runsDir = join(dir, 'partner-runs');
  mkdirSync(projectRoot, { recursive: true });
  let injected = false;
  const store = new PartnerDeliveryStore(join(dir, 'deliveries.json'), runsDir, {
    deliveryWrite: {
      forceRenameFallback: true,
      beforeFallbackInstall: (targetPath) => {
        writeFileSync(targetPath, 'concurrent-writer');
        injected = true;
      },
    },
  });
  try {
    const root = await store.ensureOutputRoot('s1');
    const targetPath = join(root, 'report.md');
    writeFileSync(targetPath, 'previous-output');
    await assert.rejects(
      () =>
        store.writeRunOutput({
          sessionId: 's1',
          projectRoot,
          relativePath: 'report.md',
          bytes: Buffer.from('replacement'),
          producer: 'write_partner_deliverable',
        }),
      /changed during atomic replacement.*original retained/,
    );
    assert.equal(injected, true);
    assert.equal(readFileSync(targetPath, 'utf8'), 'concurrent-writer');
    const retained = readdirSync(root).filter((name) => name.includes('-previous-'));
    assert.equal(retained.length, 1);
    assert.equal(readFileSync(join(root, retained[0]!), 'utf8'), 'previous-output');
  } finally {
    store.invalidate();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('PartnerDeliveryStore refreshes mutated registered files and drops missing targets', async () => {
  const { dir, projectRoot, store } = harness();
  try {
    const workspaceRoot = join(dir, 'workspace-session');
    mkdirSync(join(workspaceRoot, 'exports'), { recursive: true });
    const target = join(workspaceRoot, 'exports', 'summary.json');
    writeFileSync(target, '{"ok":true}');

    const delivery = await store.register({
      sessionId: 's1',
      projectRoot,
      rootKind: 'workspace-session',
      rootPath: workspaceRoot,
      absolutePath: target,
      producer: 'workspace-session',
    });
    writeFileSync(target, '{"ok":false}');

    const refreshed = await store.refresh(delivery.id);
    assert.ok(refreshed);
    assert.equal(refreshed.id, delivery.id);
    assert.equal(refreshed.createdAt, delivery.createdAt);
    assert.notEqual(refreshed.contentHash, delivery.contentHash);
    const read = await store.readBinary(delivery.id, 1024);
    assert.equal(Buffer.from(read.base64, 'base64').toString('utf8'), '{"ok":false}');
    assert.equal(read.contentHash, refreshed.contentHash);

    rmSync(target, { force: true });
    assert.equal(await store.refresh(delivery.id), null);
    assert.equal(await store.get(delivery.id), null);
  } finally {
    store.invalidate();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('PartnerDeliveryStore rejects traversal, sensitive names, and symlink parents', async () => {
  const { dir, projectRoot, store } = harness();
  try {
    await assert.rejects(
      () =>
        store.writeRunOutput({
          sessionId: 's1',
          projectRoot,
          relativePath: '../escape.md',
          bytes: Buffer.from('nope'),
          producer: 'write_partner_deliverable',
        }),
      /dot segments|escapes output root/,
    );
    await assert.rejects(
      () =>
        store.writeRunOutput({
          sessionId: 's1',
          projectRoot,
          relativePath: 'secrets/.env',
          bytes: Buffer.from('nope'),
          producer: 'write_partner_deliverable',
        }),
      /blocked filename/,
    );

    const root = await store.ensureOutputRoot('s1');
    const outsideFile = join(dir, 'outside.txt');
    writeFileSync(outsideFile, 'outside');
    let fileSymlinkCreated = false;
    try {
      symlinkSync(outsideFile, join(root, 'linked-file.md'), 'file');
      fileSymlinkCreated = true;
    } catch {
      // Symlink creation can require elevated privileges on Windows.
    }
    if (fileSymlinkCreated) {
      await assert.rejects(
        () =>
          store.writeRunOutput({
            sessionId: 's1',
            projectRoot,
            relativePath: 'linked-file.md',
            bytes: Buffer.from('nope'),
            producer: 'write_partner_deliverable',
          }),
        /symbolic link/,
      );
    }

    const outside = join(dir, 'outside');
    mkdirSync(outside, { recursive: true });
    try {
      symlinkSync(outside, join(root, 'linked'), 'dir');
    } catch {
      return;
    }
    await assert.rejects(
      () =>
        store.writeRunOutput({
          sessionId: 's1',
          projectRoot,
          relativePath: 'linked/new.md',
          bytes: Buffer.from('nope'),
          producer: 'write_partner_deliverable',
        }),
      /symbolic link parent|symlink parent|escapes output root/,
    );
    await assert.rejects(
      () =>
        store.writeRunOutput({
          sessionId: 's1',
          projectRoot,
          relativePath: 'linked/nested/new.md',
          bytes: Buffer.from('nope'),
          producer: 'write_partner_deliverable',
        }),
      /symbolic link parent|symlink parent|escapes output root/,
    );
    assert.equal(existsSync(join(outside, 'nested')), false);
  } finally {
    store.invalidate();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('PartnerDeliveryStore registers existing workspace-session files', async () => {
  const { dir, projectRoot, store } = harness();
  try {
    const workspaceRoot = join(dir, 'workspace-session');
    mkdirSync(workspaceRoot, { recursive: true });
    const target = join(workspaceRoot, 'exports', 'summary.json');
    mkdirSync(join(workspaceRoot, 'exports'), { recursive: true });
    writeFileSync(target, '{"ok":true}');

    const delivery = await store.register({
      sessionId: 's1',
      projectRoot,
      rootKind: 'workspace-session',
      rootPath: workspaceRoot,
      absolutePath: target,
      producer: 'workspace-session',
    });
    assert.equal(delivery.rootKind, 'workspace-session');
    assert.equal(delivery.relativePath, 'exports/summary.json');
    assert.equal(delivery.mime, 'application/json');

    const outsideFile = join(dir, 'outside-register.json');
    const linkedTarget = join(workspaceRoot, 'exports', 'linked.json');
    writeFileSync(outsideFile, '{"outside":true}');
    let fileSymlinkCreated = false;
    try {
      symlinkSync(outsideFile, linkedTarget, 'file');
      fileSymlinkCreated = true;
    } catch {
      // Symlink creation can require elevated privileges on Windows.
    }
    if (fileSymlinkCreated) {
      await assert.rejects(
        () =>
          store.register({
            sessionId: 's1',
            projectRoot,
            rootKind: 'workspace-session',
            rootPath: workspaceRoot,
            absolutePath: linkedTarget,
            producer: 'workspace-session',
          }),
        /symbolic link/,
      );
    }
  } finally {
    store.invalidate();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('PartnerDeliveryStore blocks expanded credential paths', async () => {
  const { dir, projectRoot, store } = harness();
  try {
    for (const relativePath of [
      '.env.development',
      '.aws/credentials',
      'keys/client.pem',
      '.npmrc',
    ]) {
      await assert.rejects(
        () =>
          store.writeRunOutput({
            sessionId: 's1',
            projectRoot,
            relativePath,
            bytes: Buffer.from('secret'),
            producer: 'write_partner_deliverable',
          }),
        /blocked (segment|filename|file type)/,
      );
    }
  } finally {
    store.invalidate();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('PartnerDeliveryStore rejects oversized registrations without loading the file', async () => {
  const { dir, projectRoot, store } = harness();
  try {
    const workspaceRoot = join(dir, 'workspace-session');
    const target = join(workspaceRoot, 'large.bin');
    mkdirSync(workspaceRoot, { recursive: true });
    writeFileSync(target, 'x');
    truncateSync(target, 50 * 1024 * 1024 + 1);
    await assert.rejects(
      () =>
        store.register({
          sessionId: 's1',
          projectRoot,
          rootKind: 'workspace-session',
          rootPath: workspaceRoot,
          absolutePath: target,
          producer: 'workspace-session',
        }),
      /exceeds.*bytes/i,
    );
  } finally {
    store.invalidate();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('PartnerDeliveryStore fails closed when persisted metadata is corrupt', async () => {
  const { dir, projectRoot, store } = harness();
  const metadataPath = join(dir, 'deliveries.json');
  try {
    writeFileSync(metadataPath, '{not-json');
    await assert.rejects(() => store.list(), /corrupt|invalid|failed to read/i);
    await assert.rejects(() =>
      store.writeRunOutput({
        sessionId: 's1',
        projectRoot,
        relativePath: 'new.txt',
        bytes: Buffer.from('new'),
        producer: 'write_partner_deliverable',
      }),
    );
    assert.equal(readFileSync(metadataPath, 'utf8'), '{not-json');
  } finally {
    store.invalidate();
    rmSync(dir, { recursive: true, force: true });
  }
});
