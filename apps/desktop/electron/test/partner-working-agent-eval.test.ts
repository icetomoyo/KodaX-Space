import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setRendererTarget } from '../ipc/push.js';
import { AdminPolicyAuditStore } from '../kodax/admin-policy-audit-store.js';
import { PartnerDeliveryStore } from '../kodax/partner-delivery-store.js';
import { makeWritePartnerDeliverableHandler } from '../kodax/partner-delivery-tool.js';
import { makeRunPartnerHelperHandler } from '../kodax/partner-helper-runner-tool.js';
import { withSessionRunContext } from '../kodax/session-run-context.js';

setRendererTarget(() => null);

function harness() {
  const dir = mkdtempSync(join(tmpdir(), 'partner-working-agent-eval-'));
  const projectRoot = join(dir, 'project');
  mkdirSync(projectRoot, { recursive: true });
  const store = new PartnerDeliveryStore(join(dir, 'deliveries.json'), join(dir, 'partner-runs'));
  const auditStore = new AdminPolicyAuditStore(join(dir, 'admin-policy-audit.json'));
  const write = makeWritePartnerDeliverableHandler(store, auditStore);
  const run = makeRunPartnerHelperHandler(store, auditStore);
  return { dir, projectRoot, store, auditStore, write, run };
}

test('Partner working-agent eval creates multi-format deliverables through a bounded helper', async () => {
  const { dir, projectRoot, store, auditStore, write, run } = harness();
  try {
    const csv = [
      'id,status',
      'u1,visited',
      'u2,activated',
      'u3,activated',
      'u4,paid',
      'u5,paid',
      'u6,visited',
    ].join('\n');
    const helperScript = [
      "const lines = files.readText('data/signups.csv').trim().split(/\\r?\\n/);",
      "const rows = lines.slice(1).map((line) => line.split(','));",
      'const total = rows.length;',
      "const activated = rows.filter((row) => row[1] === 'activated' || row[1] === 'paid').length;",
      "const paid = rows.filter((row) => row[1] === 'paid').length;",
      'const summary = {',
      '  total,',
      '  activated,',
      '  paid,',
      '  activationRate: activated / total,',
      '  paidRate: paid / total,',
      '};',
      "files.writeJson('reports/funnel-summary.json', summary);",
      "files.writeText('reports/funnel.md', [",
      "  '# Signup funnel',",
      "  '',",
      '  `- Total users: ${total}` ,',
      '  `- Activated: ${activated}` ,',
      '  `- Paid: ${paid}` ,',
      "].join('\\n'));",
      "files.writeText('charts/funnel.html', `<!doctype html><html><body><h1>Signup funnel</h1><p>${paid}/${total} paid</p></body></html>`);",
      "log('computed funnel', JSON.stringify(summary));",
      'return summary;',
    ].join('\n');

    const context = { sessionId: 's_eval', surface: 'partner' as const, projectRoot };
    const dataOut = await withSessionRunContext(context, () =>
      write({
        relativePath: 'data/signups.csv',
        content: csv,
        title: 'Signup source data',
        sourceRefs: ['src_csv'],
      }),
    );
    assert.match(dataOut, /Partner deliverable written: Signup source data/);

    const helperOut = await withSessionRunContext(context, () =>
      write({
        relativePath: 'helpers/analyze-funnel.js',
        content: helperScript,
        title: 'Funnel helper',
      }),
    );
    assert.match(helperOut, /Partner deliverable written: Funnel helper/);

    const runOut = await withSessionRunContext(context, () =>
      run({
        scriptPath: 'helpers/analyze-funnel.js',
        input: { title: 'Signup funnel' },
        sourceRefs: ['src_csv'],
      }),
    );
    assert.match(runOut, /Partner helper executed: helpers\/analyze-funnel\.js/);
    assert.match(runOut, /reports\/funnel-summary\.json/);
    assert.match(runOut, /reports\/funnel\.md/);
    assert.match(runOut, /charts\/funnel\.html/);

    const deliveries = await store.list({ sessionId: 's_eval' });
    const byPath = new Map(deliveries.map((delivery) => [delivery.relativePath, delivery]));
    assert.equal(byPath.get('data/signups.csv')?.producer, 'write_partner_deliverable');
    assert.equal(byPath.get('helpers/analyze-funnel.js')?.producer, 'write_partner_deliverable');
    assert.equal(byPath.get('reports/funnel-summary.json')?.producer, 'run_partner_helper');
    assert.equal(byPath.get('reports/funnel.md')?.producer, 'run_partner_helper');
    assert.equal(byPath.get('charts/funnel.html')?.producer, 'run_partner_helper');
    assert.deepEqual(byPath.get('reports/funnel-summary.json')?.sourceRefs, ['src_csv']);
    assert.equal(byPath.get('reports/funnel.md')?.rootKind, 'run-output');
    assert.equal(byPath.get('reports/funnel.md')?.rootPath, store.outputRootForSession('s_eval'));
    assert.match(readFileSync(byPath.get('reports/funnel.md')!.absolutePath, 'utf8'), /Paid: 2/);
    assert.match(
      readFileSync(byPath.get('charts/funnel.html')!.absolutePath, 'utf8'),
      /Signup funnel/,
    );

    const audit = await auditStore.listAudit({ category: 'workspace-file', limit: 20 });
    assert.ok(
      audit.some(
        (event) => event.action === 'delivery.writeRunOutput' && event.outcome === 'allowed',
      ),
    );
    assert.ok(
      audit.some((event) => event.action === 'delivery.runHelper' && event.outcome === 'allowed'),
    );
  } finally {
    store.invalidate();
    auditStore.invalidate();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Partner working-agent eval blocks helper attempts to mutate outside run-output', async () => {
  const { dir, projectRoot, store, auditStore, write, run } = harness();
  try {
    const context = { sessionId: 's_eval_escape', surface: 'partner' as const, projectRoot };
    await withSessionRunContext(context, () =>
      write({
        relativePath: 'helpers/escape.js',
        content: "files.writeText('../project-root.txt', 'bad'); return 'done';",
      }),
    );

    const out = await withSessionRunContext(context, () =>
      run({ scriptPath: 'helpers/escape.js' }),
    );
    assert.match(out, /dot segments/);
    assert.equal(existsSync(join(projectRoot, 'project-root.txt')), false);
    assert.equal(
      (await store.list({ sessionId: 's_eval_escape' })).filter(
        (delivery) => delivery.producer === 'run_partner_helper',
      ).length,
      0,
    );

    const audit = await auditStore.listAudit({ category: 'workspace-file', limit: 20 });
    assert.ok(
      audit.some((event) => event.action === 'delivery.runHelper' && event.outcome === 'failed'),
    );
  } finally {
    store.invalidate();
    auditStore.invalidate();
    rmSync(dir, { recursive: true, force: true });
  }
});
