import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  linkSync,
  mkdirSync,
  mkdtempSync,
  promises as fs,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { AdminPolicyAuditStore } from '../kodax/admin-policy-audit-store.js';
import { PartnerCheckpointStore } from '../kodax/partner-checkpoint-store.js';
import { PartnerFileProposalStore } from '../kodax/partner-file-proposal-store.js';
import { PartnerKbStore } from '../kodax/partner-kb-store.js';
import { PartnerSourceStore } from '../kodax/partner-source-store.js';

async function withForcedMetadataFallback(
  name: string,
  initialJson: string,
  run: (input: { dir: string; metadataPath: string }) => Promise<void>,
): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), `partner-${name}-atomic-`));
  const outsidePath = join(dir, 'outside.json');
  const metadataPath = join(dir, `${name}.json`);
  writeFileSync(outsidePath, initialJson);
  linkSync(outsidePath, metadataPath);

  const originalRename = fs.rename;
  let forcedFallback = false;
  fs.rename = (async (oldPath, newPath) => {
    if (!forcedFallback && resolve(String(newPath)) === resolve(metadataPath)) {
      forcedFallback = true;
      throw Object.assign(new Error('forced Windows replacement fallback'), { code: 'EPERM' });
    }
    return originalRename(oldPath, newPath);
  }) as typeof fs.rename;

  try {
    await run({ dir, metadataPath });
    assert.equal(forcedFallback, true);
    assert.equal(readFileSync(outsidePath, 'utf8'), initialJson);
    const persisted = readFileSync(metadataPath, 'utf8');
    assert.notEqual(persisted, initialJson);
    assert.doesNotThrow(() => JSON.parse(persisted));
  } finally {
    fs.rename = originalRename;
    rmSync(dir, { recursive: true, force: true });
  }
}

test('Partner durable stores never write through a hard-link metadata alias on Windows fallback', async (t) => {
  await t.test('admin policy/audit registry', async () => {
    await withForcedMetadataFallback(
      'admin-policy-audit',
      JSON.stringify({ version: 1, auditEvents: [] }),
      async ({ metadataPath }) => {
        const store = new AdminPolicyAuditStore(metadataPath);
        const result = await store.setPolicy({ artifact: { exportAllowed: false } });
        assert.equal(result.policy.artifact.exportAllowed, false);
      },
    );
  });

  await t.test('checkpoint registry and exclusive before-snapshot', async () => {
    await withForcedMetadataFallback(
      'partner-checkpoints',
      JSON.stringify({ version: 1, checkpoints: [] }),
      async ({ dir, metadataPath }) => {
        const projectRoot = join(dir, 'project');
        const targetPath = join(projectRoot, 'src', 'note.txt');
        mkdirSync(join(projectRoot, 'src'), { recursive: true });
        writeFileSync(targetPath, 'before');
        const store = new PartnerCheckpointStore(metadataPath, join(dir, 'checkpoint-snapshots'));
        const result = await store.writeWorkspaceFile({
          sessionId: 's1',
          projectRoot,
          relativePath: 'src/note.txt',
          bytes: Buffer.from('after'),
          producer: 'atomic-regression',
        });
        assert.equal(result.checkpoint.operation, 'update');
        assert.equal(readFileSync(targetPath, 'utf8'), 'after');
        assert.equal(readFileSync(result.checkpoint.beforeSnapshotPath!, 'utf8'), 'before');
      },
    );
  });

  await t.test('file proposal registry', async () => {
    await withForcedMetadataFallback(
      'partner-file-proposals',
      JSON.stringify({ version: 1, proposals: [] }),
      async ({ dir, metadataPath }) => {
        const projectRoot = join(dir, 'project');
        mkdirSync(join(projectRoot, 'docs'), { recursive: true });
        const store = new PartnerFileProposalStore(metadataPath);
        const proposal = await store.create({
          sessionId: 's1',
          projectRoot,
          operation: 'create',
          targetPath: 'docs/spec.md',
          content: '# Reviewed spec',
        });
        assert.equal(proposal.status, 'pending');
      },
    );
  });

  await t.test('knowledge base registry', async () => {
    await withForcedMetadataFallback(
      'partner-kb',
      JSON.stringify({
        version: 1,
        pages: [],
        events: [],
        configs: [],
        maintenanceReports: [],
      }),
      async ({ metadataPath }) => {
        const store = new PartnerKbStore(metadataPath);
        const result = await store.upsert({
          projectRoot: '/project',
          title: 'Atomic note',
          content: 'Preserved content',
        });
        assert.equal(result.created, true);
      },
    );
  });

  await t.test('source registry', async () => {
    await withForcedMetadataFallback(
      'partner-sources',
      JSON.stringify({ version: 1, sources: [] }),
      async ({ metadataPath }) => {
        const store = new PartnerSourceStore(metadataPath);
        const source = await store.addWorkspacePath({
          sessionId: 's1',
          projectRoot: '/project',
          path: 'docs/input.md',
          targetKind: 'file',
        });
        assert.equal(source.path, 'docs/input.md');
      },
    );
  });
});
