import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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

test('PartnerSourceStore shares project sources while keeping session selections isolated', async () => {
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
    assert.equal(s2.id, s1.id);
    assert.equal(await store.remove('s2', s1.id), true);
    assert.equal((await store.list('s1')).length, 1);
    assert.equal((await store.list('s2')).length, 0);
    assert.equal(await store.remove('s1', s1.id), true);
    assert.equal((await store.list('s1')).length, 0);
    const catalog = await store.catalog('/project', 's2');
    assert.equal(catalog.length, 1);
    assert.equal(catalog[0]?.id, s2.id);
    assert.equal(catalog[0]?.selected, false);
  } finally {
    store.invalidate();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('PartnerSourceStore migrates v1 session rows into a backed-up v2 project catalog', async () => {
  const { store, dir } = freshStore();
  const metadataPath = join(dir, 'partner-sources.json');
  const legacy = {
    version: 1,
    sources: [
      {
        id: 'src_first-source',
        sessionId: 's1',
        kind: 'workspace_path',
        projectRoot: '/project',
        path: 'docs/spec.md',
        targetKind: 'file',
        label: 'Specification',
        addedAt: 10,
      },
      {
        id: 'src_second-source',
        sessionId: 's2',
        kind: 'workspace_path',
        projectRoot: '/project/',
        path: 'docs/spec.md',
        targetKind: 'file',
        label: 'Spec',
        addedAt: 20,
      },
    ],
  };
  try {
    writeFileSync(metadataPath, JSON.stringify(legacy));

    const catalog = await store.catalog('/project', 's2');
    assert.equal(catalog.length, 1);
    assert.equal(catalog[0]?.id, 'src_first-source');
    assert.equal(catalog[0]?.selected, true);
    assert.equal((await store.get('s2', 'src_second-source'))?.id, 'src_first-source');

    const persisted = JSON.parse(readFileSync(metadataPath, 'utf8')) as { version: number };
    assert.equal(persisted.version, 2);
    assert.equal(existsSync(`${metadataPath}.v1.backup`), true);
    assert.deepEqual(JSON.parse(readFileSync(`${metadataPath}.v1.backup`, 'utf8')), legacy);
    const materials = await store.catalogMaterials('/project', 's2');
    assert.equal(materials.relations.length, 1);
    assert.equal(materials.relations[0]?.lifecycle, 'active');
    assert.equal(materials.selections.length, 1);
  } finally {
    store.invalidate();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('project material removal preserves task selection and re-adoption creates a new relation', async () => {
  const { store, dir } = freshStore();
  try {
    const source = await store.addWorkspacePath({
      sessionId: 's1',
      projectRoot: '/project',
      path: 'docs/spec.md',
      targetKind: 'file',
    });
    const first = (await store.catalogMaterials('/project', 's1')).relations[0]!;
    const removed = await store.removeMaterial('/project', first.id, 'user_confirmed');
    assert.equal(removed.lifecycle, 'removed');
    assert.equal((await store.catalogMaterials('/project', 's1')).selections.length, 1);
    assert.equal((await store.list('s1'))[0]?.id, source.id);

    await store.select('s1', '/project', source.id, false);
    await assert.rejects(
      store.select('s1', '/project', source.id, true),
      /added to project materials/i,
    );

    const next = await store.adoptMaterial('/project', {
      kind: 'project-source',
      sourceId: source.id,
    });
    assert.notEqual(next.id, first.id);
    assert.equal(next.supersedesRelationId, first.id);
    assert.equal((await store.activeProjectSourceIds('/project')).length, 1);
    assert.equal((await store.select('s1', '/project', source.id, true))?.selected, true);
  } finally {
    store.invalidate();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('PartnerSourceStore persists scope and immutable source versions', async () => {
  const { store, dir } = freshStore();
  try {
    const source = await store.addWorkspacePath({
      sessionId: 's1',
      projectRoot: '/project',
      path: 'docs/spec.md',
      targetKind: 'file',
    });
    assert.equal(await store.getScope('s1', '/project'), 'project-grounded');
    assert.equal(await store.setScope('s1', '/project', 'selected-only'), 'selected-only');

    const version = await store.commitVersion({
      sourceId: source.id,
      contentHash: 'a'.repeat(64),
      parserGeneration: 'parser-v1',
      chunkerGeneration: 'chunker-v1',
      snapshotRef: 'snapshots/a.json',
      byteSize: 42,
      modifiedAt: 123,
    });
    assert.equal(
      (await store.getProjectSource('/project', source.id))?.currentVersionId,
      version.id,
    );

    store.invalidate();
    assert.equal(await store.getScope('s1', '/project'), 'selected-only');
    assert.deepEqual(await store.getVersion(version.id), version);
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
