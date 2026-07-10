import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PartnerFileProposalStore } from '../kodax/partner-file-proposal-store.js';
import { getDiff } from '../ipc/files-core.js';

function harness() {
  const dir = mkdtempSync(join(tmpdir(), 'partner-file-proposal-store-'));
  const root = join(dir, 'project');
  mkdirSync(join(root, 'docs'), { recursive: true });
  return { dir, root, store: new PartnerFileProposalStore(join(dir, 'proposals.json')) };
}

test('PartnerFileProposalStore creates a pending proposal and applies it explicitly', async () => {
  const { dir, root, store } = harness();
  try {
    const target = join(root, 'docs', 'spec.md');
    const proposal = await store.create({
      sessionId: 's1',
      projectRoot: root,
      operation: 'create',
      targetPath: 'docs/spec.md',
      content: '# Spec\nreviewed output',
      rationale: 'Need a persisted spec.',
      sourceRefs: ['src_1'],
    });

    assert.equal(proposal.status, 'pending');
    assert.equal(proposal.safety.risk, 'low');
    assert.equal(existsSync(target), false);

    const applied = await store.apply({
      id: proposal.id,
      expectedContentHash: proposal.contentHash,
    });
    assert.equal(applied.ok, true);
    assert.equal(readFileSync(target, 'utf-8'), '# Spec\nreviewed output');
    assert.equal((await store.get(proposal.id))?.status, 'applied');
    assert.equal(getDiff(realpathSync(root), 'docs/spec.md')?.after, '# Spec\nreviewed output');
  } finally {
    store.invalidate();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('PartnerFileProposalStore blocks stale updates and binary targets', async () => {
  const { dir, root, store } = harness();
  try {
    writeFileSync(join(root, 'docs', 'notes.md'), 'v1');
    const proposal = await store.create({
      sessionId: 's1',
      projectRoot: root,
      operation: 'update',
      targetPath: 'docs/notes.md',
      content: 'v2',
    });
    writeFileSync(join(root, 'docs', 'notes.md'), 'changed elsewhere');
    const stale = await store.apply({
      id: proposal.id,
      expectedContentHash: proposal.contentHash,
    });
    assert.equal(stale.ok, false);
    assert.match(stale.error ?? '', /changed after proposal/);

    writeFileSync(join(root, 'docs', 'image.bin'), Buffer.from([0, 1, 2, 3]));
    await assert.rejects(
      () =>
        store.create({
          sessionId: 's1',
          projectRoot: root,
          operation: 'update',
          targetPath: 'docs/image.bin',
          content: 'text',
        }),
      /binary|unsupported/,
    );
  } finally {
    store.invalidate();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('PartnerFileProposalStore rejects traversal, hidden paths, and symlink parents', async () => {
  const { dir, root, store } = harness();
  try {
    await assert.rejects(
      () =>
        store.create({
          sessionId: 's1',
          projectRoot: root,
          operation: 'create',
          targetPath: '../escape.md',
          content: 'nope',
        }),
      /dot segments/,
    );
    await assert.rejects(
      () =>
        store.create({
          sessionId: 's1',
          projectRoot: root,
          operation: 'create',
          targetPath: 'docs/.secret.md',
          content: 'nope',
        }),
      /hidden path segment/,
    );
    await assert.rejects(
      () =>
        store.create({
          sessionId: 's1',
          projectRoot: root,
          operation: 'create',
          targetPath: 'docs/client.pem',
          content: 'private key material',
        }),
      /blocked file type/,
    );

    const outside = join(dir, 'outside');
    mkdirSync(outside, { recursive: true });
    try {
      symlinkSync(outside, join(root, 'linked'), 'dir');
    } catch {
      return;
    }
    await assert.rejects(
      () =>
        store.create({
          sessionId: 's1',
          projectRoot: root,
          operation: 'create',
          targetPath: 'linked/new.md',
          content: 'nope',
        }),
      /symlink parent|escapes project root/,
    );
  } finally {
    store.invalidate();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('PartnerFileProposalStore rejects symlink file targets before preview and apply', async () => {
  const { dir, root, store } = harness();
  try {
    const outsideFile = join(dir, 'outside.md');
    const linkedTarget = join(root, 'docs', 'linked.md');
    writeFileSync(outsideFile, 'outside original');
    try {
      symlinkSync(outsideFile, linkedTarget, 'file');
    } catch {
      return;
    }

    await assert.rejects(
      () =>
        store.create({
          sessionId: 's1',
          projectRoot: root,
          operation: 'update',
          targetPath: 'docs/linked.md',
          content: 'should not write outside',
        }),
      /symbolic link/,
    );

    unlinkSync(linkedTarget);
    const realTarget = join(root, 'docs', 'notes.md');
    writeFileSync(realTarget, 'v1');
    const proposal = await store.create({
      sessionId: 's1',
      projectRoot: root,
      operation: 'update',
      targetPath: 'docs/notes.md',
      content: 'v2',
    });
    unlinkSync(realTarget);
    symlinkSync(outsideFile, realTarget, 'file');

    const applied = await store.apply({
      id: proposal.id,
      expectedContentHash: proposal.contentHash,
    });
    assert.equal(applied.ok, false);
    assert.match(applied.error ?? '', /symbolic link/);
    assert.equal(readFileSync(outsideFile, 'utf-8'), 'outside original');
  } finally {
    store.invalidate();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('PartnerFileProposalStore refuses a concurrent edit immediately before apply commit', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'partner-proposal-cas-'));
  const root = join(dir, 'project');
  const target = join(root, 'docs', 'notes.md');
  mkdirSync(join(root, 'docs'), { recursive: true });
  writeFileSync(target, 'previewed');
  const store = new PartnerFileProposalStore(join(dir, 'proposals.json'), {
    beforeApplyCommit: async () => {
      writeFileSync(target, 'user edit');
    },
  });
  try {
    const proposal = await store.create({
      sessionId: 's1',
      projectRoot: root,
      operation: 'update',
      targetPath: 'docs/notes.md',
      content: 'partner edit',
    });
    const result = await store.apply({
      id: proposal.id,
      expectedContentHash: proposal.contentHash,
    });
    assert.equal(result.ok, false);
    assert.match(result.error ?? '', /changed before proposal apply/);
    assert.equal(readFileSync(target, 'utf8'), 'user edit');
    assert.equal((await store.get(proposal.id))?.status, 'pending');
  } finally {
    store.invalidate();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('PartnerFileProposalStore fails closed when persisted metadata is corrupt', async () => {
  const { dir, root, store } = harness();
  const metadataPath = join(dir, 'proposals.json');
  try {
    writeFileSync(metadataPath, '{not-json');
    await assert.rejects(() => store.list(), /corrupt|invalid|failed to read/i);
    await assert.rejects(() =>
      store.create({
        sessionId: 's1',
        projectRoot: root,
        operation: 'create',
        targetPath: 'docs/new.md',
        content: 'new',
      }),
    );
    assert.equal(readFileSync(metadataPath, 'utf8'), '{not-json');
  } finally {
    store.invalidate();
    rmSync(dir, { recursive: true, force: true });
  }
});
