import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AdminPolicyAuditStore } from '../kodax/admin-policy-audit-store.js';
import { PartnerCheckpointStore } from '../kodax/partner-checkpoint-store.js';
import { PartnerDeliveryStore } from '../kodax/partner-delivery-store.js';
import {
  ROLLBACK_PARTNER_CHECKPOINT_TOOL,
  WRITE_PARTNER_WORKSPACE_FILE_TOOL,
  _resetPartnerWorkspaceFileToolRegistrationForTesting,
  ensurePartnerWorkspaceFileToolsRegistered,
  makeRollbackPartnerCheckpointHandler,
  makeWritePartnerWorkspaceFileHandler,
} from '../kodax/partner-workspace-file-tool.js';
import { withSessionRunContext } from '../kodax/session-run-context.js';
import {
  _clearPartnerSpaceToolPoliciesForTesting,
  getPartnerSpaceToolPolicy,
  isPartnerToolAllowed,
} from '../kodax/partner-tools.js';
import { setRendererTarget } from '../ipc/push.js';

setRendererTarget(() => null);

function harness() {
  const dir = mkdtempSync(join(tmpdir(), 'partner-workspace-file-tool-'));
  const projectRoot = join(dir, 'project');
  mkdirSync(join(projectRoot, 'src'), { recursive: true });
  const checkpointStore = new PartnerCheckpointStore(
    join(dir, 'checkpoints.json'),
    join(dir, 'partner-checkpoints'),
  );
  const deliveryStore = new PartnerDeliveryStore(join(dir, 'deliveries.json'), join(dir, 'runs'));
  const auditStore = new AdminPolicyAuditStore(join(dir, 'admin-policy-audit.json'));
  const write = makeWritePartnerWorkspaceFileHandler(checkpointStore, deliveryStore, auditStore);
  const rollback = makeRollbackPartnerCheckpointHandler(checkpointStore, deliveryStore, auditStore);
  return { dir, projectRoot, checkpointStore, deliveryStore, auditStore, write, rollback };
}

test('write_partner_workspace_file creates checkpointed workspace delivery and rollback restores it', async () => {
  const { dir, projectRoot, checkpointStore, deliveryStore, auditStore, write, rollback } =
    harness();
  try {
    await auditStore.setPolicy({
      workspaceDeliveries: { workspaceWriteAllowed: true, registerWorkspaceAllowed: true },
    });
    const target = join(projectRoot, 'src', 'note.txt');
    writeFileSync(target, 'before');
    const writeOut = await withSessionRunContext(
      { sessionId: 's1', surface: 'partner', projectRoot },
      () =>
        write({
          relativePath: 'src/note.txt',
          content: 'after',
          title: 'note.txt',
          sourceRefs: ['src_1'],
        }),
    );
    assert.match(writeOut, /Partner workspace file written: src\/note\.txt/);
    assert.equal(readFileSync(target, 'utf8'), 'after');
    const checkpoint = (await checkpointStore.list({ sessionId: 's1' }))[0]!;
    const delivery = (await deliveryStore.list({ sessionId: 's1' }))[0]!;
    assert.equal(checkpoint.deliveryId, delivery.id);
    assert.equal(delivery.rootKind, 'workspace-session');
    assert.equal(delivery.checkpointId, checkpoint.id);

    const rollbackOut = await withSessionRunContext(
      { sessionId: 's1', surface: 'partner', projectRoot },
      () => rollback({ checkpointId: checkpoint.id }),
    );
    assert.match(rollbackOut, /Partner checkpoint rolled back/);
    assert.equal(readFileSync(target, 'utf8'), 'before');
    assert.equal((await checkpointStore.get(checkpoint.id))?.status, 'rolled-back');
    const refreshedDelivery = await deliveryStore.get(delivery.id);
    assert.equal(
      refreshedDelivery?.contentHash,
      (await deliveryStore.readBinary(delivery.id, 1024)).contentHash,
    );
    assert.equal(
      Buffer.from((await deliveryStore.readBinary(delivery.id, 1024)).base64, 'base64').toString(
        'utf8',
      ),
      'before',
    );
    const audit = await auditStore.listAudit({ category: 'workspace-file', limit: 20 });
    assert.ok(
      audit.some(
        (event) => event.action === 'delivery.writeWorkspaceFile' && event.outcome === 'allowed',
      ),
    );
    assert.ok(
      audit.some(
        (event) => event.action === 'delivery.rollbackCheckpoint' && event.outcome === 'allowed',
      ),
    );
  } finally {
    checkpointStore.invalidate();
    deliveryStore.invalidate();
    auditStore.invalidate();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('rollback_partner_checkpoint removes delivery registry for rolled-back created files', async () => {
  const { dir, projectRoot, checkpointStore, deliveryStore, auditStore, write, rollback } =
    harness();
  try {
    await auditStore.setPolicy({
      workspaceDeliveries: { workspaceWriteAllowed: true, registerWorkspaceAllowed: true },
    });
    const target = join(projectRoot, 'src', 'created.txt');
    const writeOut = await withSessionRunContext(
      { sessionId: 's1', surface: 'partner', projectRoot },
      () => write({ relativePath: 'src/created.txt', content: 'created' }),
    );
    assert.match(writeOut, /Partner workspace file written: src\/created\.txt/);
    assert.equal(readFileSync(target, 'utf8'), 'created');
    const checkpoint = (await checkpointStore.list({ sessionId: 's1' }))[0]!;
    const delivery = (await deliveryStore.list({ sessionId: 's1' }))[0]!;
    assert.equal(checkpoint.operation, 'create');
    assert.equal(checkpoint.deliveryId, delivery.id);

    const rollbackOut = await withSessionRunContext(
      { sessionId: 's1', surface: 'partner', projectRoot },
      () => rollback({ checkpointId: checkpoint.id }),
    );
    assert.match(rollbackOut, /Partner checkpoint rolled back/);
    assert.equal(existsSync(target), false);
    assert.equal((await checkpointStore.get(checkpoint.id))?.status, 'rolled-back');
    assert.equal(await deliveryStore.get(delivery.id), null);
  } finally {
    checkpointStore.invalidate();
    deliveryStore.invalidate();
    auditStore.invalidate();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('write_partner_workspace_file refuses non-Partner contexts and policy-blocked paths', async () => {
  const { dir, projectRoot, checkpointStore, deliveryStore, auditStore, write } = harness();
  try {
    assert.match(
      await write({ relativePath: 'src/x.txt', content: 'x' }),
      /outside an active session run/,
    );
    const codeOut = await withSessionRunContext(
      { sessionId: 's1', surface: 'code', projectRoot },
      () => write({ relativePath: 'src/x.txt', content: 'x' }),
    );
    assert.match(codeOut, /only available in Partner/);

    const defaultBlocked = await withSessionRunContext(
      { sessionId: 's1', surface: 'partner', projectRoot },
      () => write({ relativePath: 'src/x.txt', content: 'x' }),
    );
    assert.match(defaultBlocked, /blocked by local admin policy/);

    await auditStore.setPolicy({
      workspaceDeliveries: {
        workspaceWriteAllowed: true,
        registerWorkspaceAllowed: true,
        allowedExtensions: ['md'],
      },
    });
    const blocked = await withSessionRunContext(
      { sessionId: 's1', surface: 'partner', projectRoot },
      () => write({ relativePath: 'src/x.ts', content: 'x' }),
    );
    assert.match(blocked, /extension is blocked/);
    assert.equal((await checkpointStore.list({ sessionId: 's1' })).length, 0);

    const malformed = await withSessionRunContext(
      { sessionId: 's1', surface: 'partner', projectRoot },
      () => write({ relativePath: 'src/x.md', base64Content: 'Zm9v***' }),
    );
    assert.match(malformed, /invalid base64Content/);
  } finally {
    checkpointStore.invalidate();
    deliveryStore.invalidate();
    auditStore.invalidate();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('rollback_partner_checkpoint refuses stale rollback', async () => {
  const { dir, projectRoot, checkpointStore, deliveryStore, auditStore, write, rollback } =
    harness();
  try {
    await auditStore.setPolicy({
      workspaceDeliveries: { workspaceWriteAllowed: true, registerWorkspaceAllowed: true },
    });
    const target = join(projectRoot, 'src', 'note.txt');
    writeFileSync(target, 'before');
    const writeOut = await withSessionRunContext(
      { sessionId: 's1', surface: 'partner', projectRoot },
      () => write({ relativePath: 'src/note.txt', content: 'after' }),
    );
    assert.match(writeOut, /Checkpoint id:/);
    const checkpoint = (await checkpointStore.list({ sessionId: 's1' }))[0]!;
    writeFileSync(target, 'changed elsewhere');
    const rollbackOut = await withSessionRunContext(
      { sessionId: 's1', surface: 'partner', projectRoot },
      () => rollback({ checkpointId: checkpoint.id }),
    );
    assert.match(rollbackOut, /changed after Partner write/);
    assert.equal(readFileSync(target, 'utf8'), 'changed elsewhere');
  } finally {
    checkpointStore.invalidate();
    deliveryStore.invalidate();
    auditStore.invalidate();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('ensurePartnerWorkspaceFileToolsRegistered registers tools and policies once', () => {
  _resetPartnerWorkspaceFileToolRegistrationForTesting();
  _clearPartnerSpaceToolPoliciesForTesting();
  const names: string[] = [];
  const sdk = {
    registerTool: (def: { name?: string }) => {
      names.push(String(def.name));
      return () => {};
    },
  };
  ensurePartnerWorkspaceFileToolsRegistered(sdk);
  ensurePartnerWorkspaceFileToolsRegistered(sdk);
  assert.deepEqual(names, ['write_partner_workspace_file', 'rollback_partner_checkpoint']);
  assert.equal(
    getPartnerSpaceToolPolicy('write_partner_workspace_file')?.scope,
    'workspace-delivery',
  );
  assert.equal(
    getPartnerSpaceToolPolicy('rollback_partner_checkpoint')?.scope,
    'workspace-delivery',
  );
  assert.equal(
    isPartnerToolAllowed('write_partner_workspace_file', 'subagent', {
      sideEffect: 'mutates-state',
    }),
    true,
  );
  assert.equal(
    isPartnerToolAllowed('rollback_partner_checkpoint', 'subagent', {
      sideEffect: 'mutates-state',
    }),
    true,
  );
  assert.equal(WRITE_PARTNER_WORKSPACE_FILE_TOOL.sideEffect, 'mutates-state');
  assert.equal(ROLLBACK_PARTNER_CHECKPOINT_TOOL.sideEffect, 'mutates-state');
  _clearPartnerSpaceToolPoliciesForTesting();
});
