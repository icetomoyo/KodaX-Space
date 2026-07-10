import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getDiff } from '../ipc/files-core.js';
import { PartnerCheckpointStore } from '../kodax/partner-checkpoint-store.js';

function harness() {
  const dir = mkdtempSync(join(tmpdir(), 'partner-checkpoint-store-'));
  const projectRoot = join(dir, 'project');
  mkdirSync(join(projectRoot, 'src'), { recursive: true });
  const store = new PartnerCheckpointStore(
    join(dir, 'checkpoints.json'),
    join(dir, 'partner-checkpoints'),
  );
  return { dir, projectRoot, store };
}

test('PartnerCheckpointStore creates a checkpointed workspace file and rolls it back', async () => {
  const { dir, projectRoot, store } = harness();
  try {
    const result = await store.writeWorkspaceFile({
      sessionId: 's1',
      projectRoot,
      relativePath: 'src/generated.ts',
      bytes: Buffer.from('export const value = 1;\n', 'utf8'),
      producer: 'write_partner_workspace_file',
    });
    const target = join(projectRoot, 'src', 'generated.ts');
    assert.equal(readFileSync(target, 'utf8'), 'export const value = 1;\n');
    assert.equal(result.checkpoint.operation, 'create');
    assert.equal(result.checkpoint.beforeHash, null);
    assert.match(result.checkpoint.afterHash, /^sha256:[a-f0-9]{64}$/);
    assert.ok(result.checkpoint.diff);
    assert.equal(
      getDiff(result.checkpoint.rootPath, 'src/generated.ts')?.after,
      'export const value = 1;\n',
    );

    const rollback = await store.rollback(result.checkpoint.id);
    assert.equal(rollback.ok, true);
    assert.equal(existsSync(target), false);
    assert.equal((await store.get(result.checkpoint.id))?.status, 'rolled-back');
  } finally {
    store.invalidate();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('PartnerCheckpointStore restores previous bytes for updates', async () => {
  const { dir, projectRoot, store } = harness();
  try {
    const target = join(projectRoot, 'src', 'note.txt');
    writeFileSync(target, 'before');
    const result = await store.writeWorkspaceFile({
      sessionId: 's1',
      projectRoot,
      relativePath: 'src/note.txt',
      bytes: Buffer.from('after', 'utf8'),
      producer: 'write_partner_workspace_file',
    });
    assert.equal(result.checkpoint.operation, 'update');
    assert.equal(readFileSync(target, 'utf8'), 'after');
    const rollback = await store.rollback(result.checkpoint.id);
    assert.equal(rollback.ok, true);
    assert.equal(readFileSync(target, 'utf8'), 'before');
  } finally {
    store.invalidate();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('PartnerCheckpointStore refuses stale rollback after user changes', async () => {
  const { dir, projectRoot, store } = harness();
  try {
    const target = join(projectRoot, 'src', 'note.txt');
    writeFileSync(target, 'before');
    const result = await store.writeWorkspaceFile({
      sessionId: 's1',
      projectRoot,
      relativePath: 'src/note.txt',
      bytes: Buffer.from('after', 'utf8'),
      producer: 'write_partner_workspace_file',
    });
    writeFileSync(target, 'changed elsewhere');
    const rollback = await store.rollback(result.checkpoint.id);
    assert.equal(rollback.ok, false);
    assert.match(rollback.error ?? '', /changed after Partner write/);
    assert.equal(readFileSync(target, 'utf8'), 'changed elsewhere');
  } finally {
    store.invalidate();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('PartnerCheckpointStore rejects traversal, secrets, and symlink parents', async () => {
  const { dir, projectRoot, store } = harness();
  try {
    await assert.rejects(
      () =>
        store.writeWorkspaceFile({
          sessionId: 's1',
          projectRoot,
          relativePath: '../escape.md',
          bytes: Buffer.from('nope'),
          producer: 'write_partner_workspace_file',
        }),
      /dot segments|escapes project root/,
    );
    await assert.rejects(
      () =>
        store.writeWorkspaceFile({
          sessionId: 's1',
          projectRoot,
          relativePath: '.git/config',
          bytes: Buffer.from('nope'),
          producer: 'write_partner_workspace_file',
        }),
      /blocked segment/,
    );
    for (const sensitivePath of [
      '.env.development',
      '.aws/credentials',
      'config/client.pem',
      '.npmrc',
    ]) {
      await assert.rejects(
        () =>
          store.writeWorkspaceFile({
            sessionId: 's1',
            projectRoot,
            relativePath: sensitivePath,
            bytes: Buffer.from('nope'),
            producer: 'write_partner_workspace_file',
          }),
        /blocked (segment|filename|file type)/,
      );
    }

    const outsideFile = join(dir, 'outside.txt');
    writeFileSync(outsideFile, 'outside');
    let fileSymlinkCreated = false;
    try {
      symlinkSync(outsideFile, join(projectRoot, 'src', 'linked-file.txt'), 'file');
      fileSymlinkCreated = true;
    } catch {
      // Symlink creation can require elevated privileges on Windows.
    }
    if (fileSymlinkCreated) {
      await assert.rejects(
        () =>
          store.writeWorkspaceFile({
            sessionId: 's1',
            projectRoot,
            relativePath: 'src/linked-file.txt',
            bytes: Buffer.from('nope'),
            producer: 'write_partner_workspace_file',
          }),
        /symbolic link/,
      );
    }

    const outside = join(dir, 'outside');
    mkdirSync(outside, { recursive: true });
    try {
      symlinkSync(outside, join(projectRoot, 'src', 'linked'), 'dir');
    } catch {
      return;
    }
    await assert.rejects(
      () =>
        store.writeWorkspaceFile({
          sessionId: 's1',
          projectRoot,
          relativePath: 'src/linked/new.md',
          bytes: Buffer.from('nope'),
          producer: 'write_partner_workspace_file',
        }),
      /symbolic link parent|symlink parent|escapes project root/,
    );
    await assert.rejects(
      () =>
        store.writeWorkspaceFile({
          sessionId: 's1',
          projectRoot,
          relativePath: 'src/linked/nested/new.md',
          bytes: Buffer.from('nope'),
          producer: 'write_partner_workspace_file',
        }),
      /symbolic link parent|symlink parent|escapes project root/,
    );
    assert.equal(existsSync(join(outside, 'nested')), false);
  } finally {
    store.invalidate();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('PartnerCheckpointStore refuses a concurrent user edit immediately before commit', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'partner-checkpoint-cas-'));
  const projectRoot = join(dir, 'project');
  const target = join(projectRoot, 'note.txt');
  mkdirSync(projectRoot, { recursive: true });
  writeFileSync(target, 'previewed');
  const store = new PartnerCheckpointStore(
    join(dir, 'checkpoints.json'),
    join(dir, 'partner-checkpoints'),
    {
      beforeWorkspaceCommit: async () => {
        writeFileSync(target, 'user edit');
      },
    },
  );
  try {
    await assert.rejects(
      () =>
        store.writeWorkspaceFile({
          sessionId: 's1',
          projectRoot,
          relativePath: 'note.txt',
          bytes: Buffer.from('partner edit'),
          producer: 'write_partner_workspace_file',
        }),
      /changed before Partner write/,
    );
    assert.equal(readFileSync(target, 'utf8'), 'user edit');
    assert.equal((await store.list()).length, 0);
  } finally {
    store.invalidate();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('PartnerCheckpointStore fails closed when persisted metadata is corrupt', async () => {
  const { dir, projectRoot, store } = harness();
  const metadataPath = join(dir, 'checkpoints.json');
  try {
    writeFileSync(metadataPath, '{not-json');
    await assert.rejects(() => store.list(), /corrupt|invalid|failed to read/i);
    await assert.rejects(() =>
      store.writeWorkspaceFile({
        sessionId: 's1',
        projectRoot,
        relativePath: 'src/new.txt',
        bytes: Buffer.from('new'),
        producer: 'write_partner_workspace_file',
      }),
    );
    assert.equal(readFileSync(metadataPath, 'utf8'), '{not-json');
  } finally {
    store.invalidate();
    rmSync(dir, { recursive: true, force: true });
  }
});
