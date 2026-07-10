import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AdminPolicyAuditStore } from '../kodax/admin-policy-audit-store.js';

function freshStore(): { store: AdminPolicyAuditStore; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), 'admin-policy-audit-'));
  return { store: new AdminPolicyAuditStore(join(dir, 'admin-policy-audit.json')), dir };
}

test('admin policy store exposes defaults and supports partial local policy updates', async () => {
  const { store, dir } = freshStore();
  try {
    const initial = await store.getPolicy();
    assert.equal(initial.source, 'default');
    assert.equal(initial.policy.artifact.exportAllowed, true);
    assert.equal(initial.policy.workspaceDeliveries.writeAllowed, true);
    assert.equal(initial.policy.workspaceDeliveries.workspaceWriteAllowed, false);
    assert.equal(initial.policy.workspaceDeliveries.registerWorkspaceAllowed, false);

    const updated = await store.setPolicy({
      artifact: { exportAllowed: false },
      workspaceFileProposals: { applyAllowed: false },
      workspaceDeliveries: { registerWorkspaceAllowed: false },
    });
    assert.equal(updated.policy.artifact.exportAllowed, false);
    assert.equal(updated.policy.workspaceFileProposals.applyAllowed, false);
    assert.equal(updated.policy.workspaceDeliveries.registerWorkspaceAllowed, false);

    const after = await store.getPolicy();
    assert.equal(after.source, 'local-file');
    assert.match((await store.exportPolicy()).json, /space-admin-policy\/v1/);
  } finally {
    store.invalidate();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('admin audit store redacts secrets and exports JSONL', async () => {
  const { store, dir } = freshStore();
  try {
    await store.setPolicy({ redaction: { extraPatterns: ['customer-secret-[0-9]+'] } });
    await store.record({
      category: 'connector',
      action: 'connector.snapshot',
      outcome: 'allowed',
      details: 'Bearer abcdefghijklmnop and customer-secret-42',
    });
    const events = await store.listAudit({ limit: 10 });
    assert.equal(events.length, 2, 'policy.set is also audited');
    const event = events.find((item) => item.category === 'connector');
    assert.ok(event);
    assert.equal(event.redacted, true);
    assert.doesNotMatch(event.details, /abcdefghijklmnop|customer-secret-42/);
    assert.match((await store.exportAuditJsonl()).jsonl, /connector\.snapshot/);
  } finally {
    store.invalidate();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('admin policy guards can block artifact export and file proposal apply', async () => {
  const { store, dir } = freshStore();
  try {
    await store.setPolicy({
      artifact: { exportAllowed: false },
      workspaceFileProposals: { applyAllowed: false },
      workspaceDeliveries: { writeAllowed: false, workspaceWriteAllowed: false },
    });
    await assert.rejects(
      () =>
        store.assertArtifactExportAllowed({ artifactId: 'art_1', token: 'sk-abcdefghijklmnop' }),
      /blocked by local admin policy/,
    );
    await assert.rejects(
      () => store.assertFileProposalApplyAllowed({ proposalId: 'pfp_1' }),
      /blocked by local admin policy/,
    );
    await assert.rejects(
      () => store.assertDeliveryWriteAllowed({ relativePath: 'deliverables/report.md' }),
      /blocked by local admin policy/,
    );
    await assert.rejects(
      () => store.assertDeliveryWorkspaceWriteAllowed({ relativePath: 'src/generated.ts' }),
      /blocked by local admin policy/,
    );
    const blocked = await store.listAudit({ limit: 10 });
    assert.ok(
      blocked.some((event) => event.action === 'artifact.export' && event.outcome === 'blocked'),
    );
    assert.ok(
      blocked.some((event) => event.action === 'fileProposal.apply' && event.outcome === 'blocked'),
    );
    assert.ok(
      blocked.some(
        (event) => event.action === 'delivery.writeRunOutput' && event.outcome === 'blocked',
      ),
    );
    assert.ok(
      blocked.some(
        (event) => event.action === 'delivery.writeWorkspaceFile' && event.outcome === 'blocked',
      ),
    );
    assert.ok(blocked.some((event) => event.redacted));
  } finally {
    store.invalidate();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('admin policy guards enforce Partner delivery extension allowlist', async () => {
  const { store, dir } = freshStore();
  try {
    await store.setPolicy({
      workspaceDeliveries: { allowedExtensions: ['md', '.json'] },
    });
    await store.assertDeliveryWriteAllowed({ relativePath: 'deliverables/brief.md' });
    await assert.rejects(
      () => store.assertDeliveryWorkspaceWriteAllowed({ relativePath: 'src/generated.md' }),
      /blocked by local admin policy/,
    );
    await assert.rejects(
      () => store.assertDeliveryRegisterWorkspaceAllowed({ targetPath: 'exports/data.json' }),
      /blocked by local admin policy/,
    );
    await store.setPolicy({
      workspaceDeliveries: { workspaceWriteAllowed: true, registerWorkspaceAllowed: true },
    });
    await store.assertDeliveryWorkspaceWriteAllowed({ relativePath: 'src/generated.md' });
    await store.assertDeliveryRegisterWorkspaceAllowed({ targetPath: 'exports/data.json' });
    await assert.rejects(
      () => store.assertDeliveryWriteAllowed({ relativePath: 'exports/archive.zip' }),
      /extension is blocked/,
    );
    await assert.rejects(
      () => store.assertDeliveryRegisterWorkspaceAllowed({ targetPath: 'exports/report.pdf' }),
      /extension is blocked/,
    );
    const events = await store.listAudit({ category: 'workspace-file', limit: 10 });
    assert.ok(
      events.some(
        (event) => event.action === 'delivery.writeRunOutput' && event.outcome === 'blocked',
      ),
    );
    assert.ok(
      events.some(
        (event) => event.action === 'delivery.registerWorkspace' && event.outcome === 'blocked',
      ),
    );
  } finally {
    store.invalidate();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('admin policy guards enforce workspace file proposal extension allowlist', async () => {
  const { store, dir } = freshStore();
  try {
    await store.setPolicy({
      workspaceFileProposals: { allowedExtensions: ['md', '.txt'] },
    });
    await store.assertFileProposalCreateAllowed({ targetPath: 'docs/brief.md' });
    await store.assertFileProposalApplyAllowed({ targetPath: 'notes/todo.txt' });
    await assert.rejects(
      () => store.assertFileProposalCreateAllowed({ targetPath: 'docs/data.json' }),
      /extension is blocked/,
    );
    await assert.rejects(
      () => store.assertFileProposalExportAllowed({ proposalId: 'pfp_1' }),
      /extension is blocked/,
    );
    const events = await store.listAudit({ category: 'workspace-file', limit: 10 });
    assert.ok(
      events.some((event) => event.action === 'fileProposal.create' && event.outcome === 'blocked'),
    );
    assert.ok(
      events.some((event) => event.action === 'fileProposal.export' && event.outcome === 'blocked'),
    );
  } finally {
    store.invalidate();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('admin policy/audit store fails closed without overwriting corrupt durable state', async () => {
  const { store, dir } = freshStore();
  const filePath = join(dir, 'admin-policy-audit.json');
  try {
    writeFileSync(filePath, '{not-json');
    await assert.rejects(() => store.getPolicy(), /corrupt|invalid|unreadable/i);
    await assert.rejects(() => store.setPolicy({ artifact: { exportAllowed: false } }));
    await assert.rejects(() =>
      store.record({ category: 'policy', action: 'should-not-write', outcome: 'info' }),
    );
    assert.equal(readFileSync(filePath, 'utf8'), '{not-json');
  } finally {
    store.invalidate();
    rmSync(dir, { recursive: true, force: true });
  }
});
