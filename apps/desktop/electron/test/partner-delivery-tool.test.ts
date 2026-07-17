import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  WRITE_PARTNER_DELIVERABLE_TOOL,
  _resetPartnerDeliveryToolRegistrationForTesting,
  ensurePartnerDeliveryToolsRegistered,
  makeWritePartnerDeliverableHandler,
} from '../kodax/partner-delivery-tool.js';
import { AdminPolicyAuditStore } from '../kodax/admin-policy-audit-store.js';
import { PartnerDeliveryStore } from '../kodax/partner-delivery-store.js';
import { withSessionRunContext } from '../kodax/session-run-context.js';
import {
  _clearPartnerSpaceToolPoliciesForTesting,
  getPartnerSpaceToolPolicy,
  isPartnerToolAllowed,
} from '../kodax/partner-tools.js';
import { setRendererTarget } from '../ipc/push.js';

setRendererTarget(() => null);

function harness() {
  const dir = mkdtempSync(join(tmpdir(), 'partner-delivery-tool-'));
  const projectRoot = join(dir, 'project');
  mkdirSync(projectRoot, { recursive: true });
  const store = new PartnerDeliveryStore(join(dir, 'deliveries.json'), join(dir, 'partner-runs'));
  const auditStore = new AdminPolicyAuditStore(join(dir, 'admin-policy-audit.json'));
  const write = makeWritePartnerDeliverableHandler(store, auditStore);
  return { dir, projectRoot, store, auditStore, write };
}

test('write_partner_deliverable writes an arbitrary file in a Partner run context', async () => {
  const { dir, projectRoot, store, auditStore, write } = harness();
  try {
    const out = await withSessionRunContext(
      { sessionId: 's1', surface: 'partner', projectRoot },
      () =>
        write({
          relativePath: 'reports/brief.md',
          content: '# Brief',
          title: 'Brief',
          sourceRefs: ['src_1'],
        }),
    );
    assert.match(out, /Partner deliverable written: Brief/);
    assert.match(out, /Delivery reference: \{"type":"partner-delivery"/);
    assert.match(out, /kodax-space:\/\/partner-delivery\/pd_/);
    const deliveries = await store.list({ sessionId: 's1' });
    assert.equal(deliveries.length, 1);
    assert.equal(deliveries[0]!.relativePath, 'reports/brief.md');
    assert.equal(readFileSync(deliveries[0]!.absolutePath, 'utf8'), '# Brief');
    const audit = await auditStore.listAudit({ category: 'workspace-file', limit: 10 });
    assert.ok(
      audit.some(
        (event) => event.action === 'delivery.writeRunOutput' && event.outcome === 'allowed',
      ),
    );
  } finally {
    store.invalidate();
    auditStore.invalidate();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('write_partner_deliverable supports SDK tool execution context without ALS', async () => {
  const { dir, projectRoot, store, auditStore, write } = harness();
  try {
    const out = await write(
      {
        relativePath: 'data/blob.bin',
        base64Content: Buffer.from([9, 8, 7]).toString('base64'),
      },
      {
        sessionId: 's_sdk',
        executionCwd: projectRoot,
        agentProfile: { surface: 'partner', id: 'kodax-space.partner' },
      },
    );
    assert.match(out, /Partner deliverable written/);
    const delivery = (await store.list({ sessionId: 's_sdk' }))[0]!;
    assert.equal(delivery.relativePath, 'data/blob.bin');
    assert.equal(
      (await store.readBinary(delivery.id, 1024)).base64,
      Buffer.from([9, 8, 7]).toString('base64'),
    );
  } finally {
    store.invalidate();
    auditStore.invalidate();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('write_partner_deliverable refuses non-Partner contexts and invalid payloads', async () => {
  const { dir, projectRoot, store, auditStore, write } = harness();
  try {
    assert.match(
      await write({ relativePath: 'x.md', content: 'x' }),
      /outside an active session run/,
    );
    const out = await withSessionRunContext({ sessionId: 's1', surface: 'code', projectRoot }, () =>
      write({ relativePath: 'x.md', content: 'x' }),
    );
    assert.match(out, /only available in Partner/);
    const invalid = await withSessionRunContext(
      { sessionId: 's1', surface: 'partner', projectRoot },
      () => write({ relativePath: 'x.md', content: 'x', base64Content: 'eA==' }),
    );
    assert.match(invalid, /exactly one/);
    for (const malformed of ['Zm9v***', 'Zg', '====', 'A===']) {
      const malformedResult = await withSessionRunContext(
        { sessionId: 's1', surface: 'partner', projectRoot },
        () => write({ relativePath: 'invalid.bin', base64Content: malformed }),
      );
      assert.match(malformedResult, /invalid base64Content/);
    }
  } finally {
    store.invalidate();
    auditStore.invalidate();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('write_partner_deliverable honors admin delivery policy', async () => {
  const { dir, projectRoot, store, auditStore, write } = harness();
  try {
    await auditStore.setPolicy({ workspaceDeliveries: { allowedExtensions: ['md'] } });
    const out = await withSessionRunContext(
      { sessionId: 's1', surface: 'partner', projectRoot },
      () => write({ relativePath: 'archive.zip', content: 'nope' }),
    );
    assert.match(out, /extension is blocked/);
    assert.equal((await store.list({ sessionId: 's1' })).length, 0);
    const audit = await auditStore.listAudit({ category: 'workspace-file', limit: 10 });
    assert.ok(
      audit.some(
        (event) => event.action === 'delivery.writeRunOutput' && event.outcome === 'blocked',
      ),
    );
  } finally {
    store.invalidate();
    auditStore.invalidate();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('ensurePartnerDeliveryToolsRegistered registers the tool and Partner policy once', () => {
  _resetPartnerDeliveryToolRegistrationForTesting();
  _clearPartnerSpaceToolPoliciesForTesting();
  const names: string[] = [];
  const sdk = {
    registerTool: (def: { name?: string }) => {
      names.push(String(def.name));
      return () => {};
    },
  };
  ensurePartnerDeliveryToolsRegistered(sdk);
  ensurePartnerDeliveryToolsRegistered(sdk);
  assert.deepEqual(names, ['write_partner_deliverable']);
  assert.equal(getPartnerSpaceToolPolicy('write_partner_deliverable')?.scope, 'workspace-delivery');
  assert.equal(
    isPartnerToolAllowed('write_partner_deliverable', 'subagent', { sideEffect: 'mutates-state' }),
    true,
  );
  assert.equal(WRITE_PARTNER_DELIVERABLE_TOOL.sideEffect, 'mutates-state');
  _clearPartnerSpaceToolPoliciesForTesting();
});
