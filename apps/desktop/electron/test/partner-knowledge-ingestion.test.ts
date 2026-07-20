import assert from 'node:assert/strict';
import {
  mkdtempSync,
  readdirSync,
  rmSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { PartnerEvidenceSnapshotStore } from '../kodax/partner-evidence-snapshot-store.js';
import { PartnerCitationService } from '../kodax/partner-citation-service.js';
import { PartnerEvidenceMetadataStore } from '../kodax/partner-evidence-metadata-store.js';
import { PartnerKnowledgeIndex } from '../kodax/partner-knowledge-index.js';
import { PartnerSourceIngestionCoordinator } from '../kodax/partner-source-ingestion.js';
import { PartnerSourceStore } from '../kodax/partner-source-store.js';

function harness() {
  const dir = mkdtempSync(join(tmpdir(), 'partner-knowledge-ingestion-'));
  const projectRoot = join(dir, 'project');
  const sourceStore = new PartnerSourceStore(join(dir, 'partner-sources.json'));
  const snapshots = new PartnerEvidenceSnapshotStore(join(dir, 'snapshots'));
  const metadata = new PartnerEvidenceMetadataStore(join(dir, 'metadata'));
  const index = new PartnerKnowledgeIndex(join(dir, 'indexes'));
  const ingestion = new PartnerSourceIngestionCoordinator({ sourceStore, snapshots, index });
  return { dir, projectRoot, sourceStore, snapshots, metadata, index, ingestion };
}

test('immutable snapshots reject a conflicting rewrite and detect corruption', async () => {
  const { dir, snapshots } = harness();
  const snapshot = {
    schemaVersion: 1 as const,
    projectKey: '/project',
    sourceId: 'src_01234567',
    sourceVersionId: 'sv_01234567',
    contentHash: 'a'.repeat(64),
    parserGeneration: 'plain-v1',
    units: [
      {
        id: 'unit_01234567',
        ordinal: 0,
        text: 'immutable evidence',
        locator: { kind: 'text_line' as const, startLine: 1, endLine: 1 },
      },
    ],
    warnings: [],
  };
  try {
    const ref = await snapshots.write(snapshot);
    assert.deepEqual(await snapshots.read(ref), snapshot);
    assert.equal(await snapshots.write(snapshot), ref);
    await assert.rejects(
      snapshots.write({
        ...snapshot,
        units: [{ ...snapshot.units[0]!, text: 'different evidence' }],
      }),
      /immutable|conflict/i,
    );
    writeFileSync(snapshots.resolveRef(ref), '{"checksum":"bad"}');
    await assert.rejects(snapshots.read(ref), /corrupt|checksum|invalid/i);
  } finally {
    snapshots.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('incremental ingestion skips unchanged content and preserves old version snapshots', async () => {
  const { dir, projectRoot, sourceStore, snapshots, index, ingestion } = harness();
  try {
    await import('node:fs/promises').then((fs) => fs.mkdir(projectRoot, { recursive: true }));
    const sourcePath = join(projectRoot, 'facts.md');
    writeFileSync(sourcePath, '# Facts\n项目代号是青鸟。\nThe launch window is October.');
    const source = await sourceStore.addWorkspacePath({
      sessionId: 's1',
      projectRoot,
      path: 'facts.md',
      targetKind: 'file',
    });

    const first = await ingestion.refresh(projectRoot, source.id);
    assert.equal(first.changed, true);
    assert.equal(first.source.ingestionStatus, 'ready');
    const firstVersion = first.source.currentVersionId!;
    assert.match((await snapshots.read(first.version!.snapshotRef)).units[0]?.text ?? '', /Facts/);
    assert.match(
      (await index.search(projectRoot, '青鸟', { sourceIds: [source.id] }))[0]?.text ?? '',
      /青鸟/,
    );

    const unchanged = await ingestion.refresh(projectRoot, source.id);
    assert.equal(unchanged.changed, false);
    assert.equal(unchanged.source.currentVersionId, firstVersion);

    writeFileSync(sourcePath, '# Facts\n项目代号是朱雀。\nThe launch window is November.');
    const changed = await ingestion.refresh(projectRoot, source.id);
    assert.equal(changed.changed, true);
    assert.notEqual(changed.source.currentVersionId, firstVersion);
    assert.match(
      (await index.search(projectRoot, '朱雀', { sourceIds: [source.id] }))[0]?.text ?? '',
      /朱雀/,
    );
    assert.equal((await sourceStore.getVersion(firstVersion))?.id, firstVersion);
    assert.match((await snapshots.read(first.version!.snapshotRef)).units[0]?.text ?? '', /青鸟/);

    unlinkSync(sourcePath);
    const failed = await ingestion.refresh(projectRoot, source.id);
    assert.equal(failed.source.ingestionStatus, 'unavailable');
    assert.equal(failed.source.currentVersionId, changed.source.currentVersionId);
  } finally {
    index.close();
    snapshots.close();
    sourceStore.invalidate();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('per-project FTS index is parameterized, deterministic, and isolated', () => {
  const { dir, index } = harness();
  try {
    const common = {
      sourceVersionId: 'sv_01234567',
      sourceId: 'src_01234567',
      contentHash: 'b'.repeat(64),
      parserGeneration: 'plain-v1',
    };
    index.commitVersion('/project-a', common, [
      {
        id: 'unit_01234567',
        ordinal: 0,
        text: 'Alpha 项目使用蓝色发布通道. Release channel is blue.',
        locator: { kind: 'text_line', startLine: 1, endLine: 1 },
      },
      {
        id: 'unit_01234568',
        ordinal: 1,
        relativePath: 'src/auth-handler.ts',
        text: 'Endpoint retries use retry_count-3.',
        locator: { kind: 'text_line', startLine: 2, endLine: 2 },
      },
    ]);
    index.commitVersion('/project-b', { ...common, sourceVersionId: 'sv_76543210' }, [
      {
        id: 'unit_76543210',
        ordinal: 0,
        text: 'Beta 项目使用红色发布通道',
        locator: { kind: 'text_line', startLine: 1, endLine: 1 },
      },
    ]);

    assert.match(index.search('/project-a', '蓝色')[0]?.text ?? '', /Alpha/);
    assert.equal(index.search('/project-a', '红色').length, 0);
    assert.match(index.search('/project-a', 'auth-handler')[0]?.text ?? '', /Endpoint/);
    assert.match(index.search('/project-a', 'retry_count-3')[0]?.text ?? '', /retries/);
    assert.match(index.search('/project-a', '"release channel"')[0]?.text ?? '', /blue/);
    assert.doesNotThrow(() => index.search('/project-a', '" OR * NOT ('));
    assert.deepEqual(index.search('/project-a', '蓝色'), index.search('/project-a', '蓝色'));
  } finally {
    index.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('citations stay bound to immutable evidence after source refresh and index rebuild', async () => {
  const { dir, projectRoot, sourceStore, snapshots, metadata, index, ingestion } = harness();
  const citations = new PartnerCitationService({ sourceStore, snapshots, metadata });
  try {
    await import('node:fs/promises').then((fs) => fs.mkdir(projectRoot, { recursive: true }));
    const sourcePath = join(projectRoot, 'decision.md');
    writeFileSync(sourcePath, 'The approved color is blue.');
    const source = await sourceStore.addWorkspacePath({
      sessionId: 's1',
      projectRoot,
      path: 'decision.md',
      targetKind: 'file',
    });
    await ingestion.refresh(projectRoot, source.id);
    const match = index.search(projectRoot, 'approved color', { sourceIds: [source.id] })[0]!;
    const concurrentCitationIds = await Promise.all(
      Array.from({ length: 16 }, () => citations.create(projectRoot, match)),
    );
    const citationId = concurrentCitationIds[0]!;
    assert.deepEqual([...new Set(concurrentCitationIds)], [citationId]);
    const current = await citations.resolve(projectRoot, 's1', citationId);
    assert.equal(current?.freshness, 'current');
    assert.match(current?.excerpt ?? '', /blue/);

    writeFileSync(sourcePath, 'The approved color is green.');
    const changed = await ingestion.refresh(projectRoot, source.id);
    const stale = await citations.resolve(projectRoot, 's1', citationId);
    assert.equal(stale?.freshness, 'stale');
    assert.match(stale?.excerpt ?? '', /blue/);
    assert.equal(await citations.resolve(join(dir, 'other-project'), 's1', citationId), null);

    index.close();
    const indexFile = readdirSync(join(dir, 'indexes')).find((name) => name.endsWith('.sqlite'))!;
    writeFileSync(join(dir, 'indexes', indexFile), 'not a sqlite database');
    const rebuiltIndex = new PartnerKnowledgeIndex(join(dir, 'indexes'));
    try {
      assert.equal(rebuiltIndex.hasVersion(projectRoot, changed.source.currentVersionId!), false);
      assert.match((await citations.resolve(projectRoot, 's1', citationId))?.excerpt ?? '', /blue/);
    } finally {
      rebuiltIndex.close();
    }
  } finally {
    index.close();
    snapshots.close();
    sourceStore.invalidate();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('freshness inspection detects rename, missing origin, and recovery without changing source identity', async () => {
  const { dir, projectRoot, sourceStore, snapshots, index, ingestion } = harness();
  try {
    await import('node:fs/promises').then((fs) => fs.mkdir(projectRoot, { recursive: true }));
    const original = join(projectRoot, 'original.txt');
    const renamed = join(projectRoot, 'renamed.txt');
    writeFileSync(original, 'Stable rename evidence.');
    const source = await sourceStore.addWorkspacePath({
      sessionId: 's1',
      projectRoot,
      path: 'original.txt',
      targetKind: 'file',
    });
    await ingestion.refresh(projectRoot, source.id);

    renameSync(original, renamed);
    const moved = await ingestion.inspectFreshness(projectRoot, source.id);
    assert.equal(moved.id, source.id);
    assert.equal(moved.path, 'renamed.txt');
    assert.equal(moved.ingestionStatus, 'stale');

    unlinkSync(renamed);
    const unavailable = await ingestion.inspectFreshness(projectRoot, source.id);
    assert.equal(unavailable.ingestionStatus, 'unavailable');

    writeFileSync(renamed, 'Stable rename evidence.');
    const recovered = await ingestion.inspectFreshness(projectRoot, source.id);
    assert.equal(recovered.ingestionStatus, 'stale');
    assert.equal(recovered.currentVersionId, moved.currentVersionId);
  } finally {
    index.close();
    snapshots.close();
    sourceStore.invalidate();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('cancelled ingestion never advances the committed source version', async () => {
  const { dir, projectRoot, sourceStore, snapshots, index, ingestion } = harness();
  try {
    await import('node:fs/promises').then((fs) => fs.mkdir(projectRoot, { recursive: true }));
    const sourcePath = join(projectRoot, 'cancel.txt');
    writeFileSync(sourcePath, 'Committed evidence.');
    const source = await sourceStore.addWorkspacePath({
      sessionId: 's1',
      projectRoot,
      path: 'cancel.txt',
      targetKind: 'file',
    });
    const committed = await ingestion.refresh(projectRoot, source.id);
    writeFileSync(sourcePath, 'A cancelled replacement.');
    const controller = new AbortController();
    controller.abort();
    const cancelled = await ingestion.refresh(projectRoot, source.id, {
      signal: controller.signal,
    });
    assert.equal(cancelled.source.ingestionStatus, 'failed');
    assert.equal(cancelled.source.currentVersionId, committed.source.currentVersionId);
    assert.equal((await sourceStore.listVersions(source.id)).length, 1);
  } finally {
    index.close();
    snapshots.close();
    sourceStore.invalidate();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('directory ingestion indexes bounded child files with truthful relative paths', async () => {
  const { dir, projectRoot, sourceStore, snapshots, index, ingestion } = harness();
  try {
    const docs = join(projectRoot, 'docs');
    await import('node:fs/promises').then((fs) => fs.mkdir(docs, { recursive: true }));
    writeFileSync(join(docs, 'one.md'), 'Architecture owner is Platform.');
    writeFileSync(join(docs, 'two.txt'), 'Launch train is weekly.');
    const source = await sourceStore.addWorkspacePath({
      sessionId: 's1',
      projectRoot,
      path: 'docs',
      targetKind: 'dir',
    });
    const result = await ingestion.refresh(projectRoot, source.id);
    assert.equal(result.source.ingestionStatus, 'ready');
    const match = index.search(projectRoot, 'architecture owner', {
      sourceIds: [source.id],
    })[0];
    assert.equal(match?.relativePath, 'one.md');
    assert.match(match?.text ?? '', /Platform/);
  } finally {
    index.close();
    snapshots.close();
    sourceStore.invalidate();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('snapshot storage budget refuses new immutable evidence without evicting old data', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'partner-snapshot-budget-'));
  const snapshotRoot = join(dir, 'snapshots');
  const snapshots = new PartnerEvidenceSnapshotStore(snapshotRoot);
  try {
    const first = {
      schemaVersion: 1 as const,
      projectKey: '/project',
      sourceId: 'src_01234567',
      sourceVersionId: 'sv_01234567',
      contentHash: 'a'.repeat(64),
      parserGeneration: 'plain-v1',
      units: [
        {
          id: 'unit_01234567',
          ordinal: 0,
          text: 'first immutable evidence',
          locator: { kind: 'text_line' as const, startLine: 1, endLine: 1 },
        },
      ],
      warnings: [],
    };
    const firstRef = await snapshots.write(first);
    const firstBytes = statSync(snapshots.resolveRef(firstRef)).size;
    const constrained = new PartnerEvidenceSnapshotStore(snapshotRoot, firstBytes + 16);
    await assert.rejects(
      constrained.write({
        ...first,
        sourceVersionId: 'sv_01234568',
        contentHash: 'b'.repeat(64),
        units: [{ ...first.units[0]!, id: 'unit_01234568', text: 'second evidence' }],
      }),
      /storage budget/i,
    );
    assert.deepEqual(await snapshots.read(firstRef), first);
  } finally {
    snapshots.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
