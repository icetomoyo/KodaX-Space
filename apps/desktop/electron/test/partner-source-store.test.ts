import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PartnerSourceStore } from '../kodax/partner-source-store.js';

function freshStore(): { store: PartnerSourceStore; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), 'partner-source-store-'));
  return { store: new PartnerSourceStore(join(dir, 'partner-sources.json')), dir };
}

test('PartnerSourceStore adds, lists, and de-duplicates workspace sources', async () => {
  const { store, dir } = freshStore();
  try {
    const first = await store.addWorkspacePath({
      sessionId: 's1',
      projectRoot: '/project',
      path: 'docs/spec.md',
      targetKind: 'file',
    });
    const duplicate = await store.addWorkspacePath({
      sessionId: 's1',
      projectRoot: '/project',
      path: 'docs/spec.md',
      targetKind: 'file',
    });
    assert.equal(duplicate.id, first.id);
    const list = await store.list('s1');
    assert.equal(list.length, 1);
    assert.equal(list[0]?.label, 'spec.md');
  } finally {
    store.invalidate();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('PartnerSourceStore removes sources within the owning session only', async () => {
  const { store, dir } = freshStore();
  try {
    const s1 = await store.addWorkspacePath({
      sessionId: 's1',
      projectRoot: '/project',
      path: 'a.md',
      targetKind: 'file',
    });
    const s2 = await store.addWorkspacePath({
      sessionId: 's2',
      projectRoot: '/project',
      path: 'a.md',
      targetKind: 'file',
    });
    assert.equal(await store.remove('s2', s1.id), false);
    assert.equal((await store.list('s1')).length, 1);
    assert.equal(await store.remove('s1', s1.id), true);
    assert.equal((await store.list('s1')).length, 0);
    assert.equal((await store.list('s2'))[0]?.id, s2.id);
  } finally {
    store.invalidate();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('PartnerSourceStore fails closed when persisted metadata is corrupt', async () => {
  const { store, dir } = freshStore();
  const metadataPath = join(dir, 'partner-sources.json');
  try {
    writeFileSync(metadataPath, '{not-json');
    await assert.rejects(() => store.list('s1'), /corrupt|invalid|failed to read/i);
    await assert.rejects(() =>
      store.addWorkspacePath({
        sessionId: 's1',
        projectRoot: '/project',
        path: 'new.md',
        targetKind: 'file',
      }),
    );
    assert.equal(readFileSync(metadataPath, 'utf8'), '{not-json');
  } finally {
    store.invalidate();
    rmSync(dir, { recursive: true, force: true });
  }
});
