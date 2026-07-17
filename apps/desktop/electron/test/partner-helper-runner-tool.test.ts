import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AdminPolicyAuditStore } from '../kodax/admin-policy-audit-store.js';
import { PartnerDeliveryStore } from '../kodax/partner-delivery-store.js';
import {
  RUN_PARTNER_HELPER_TOOL,
  _resetPartnerHelperRunnerRegistrationForTesting,
  ensurePartnerHelperRunnerToolsRegistered,
  makeRunPartnerHelperHandler,
} from '../kodax/partner-helper-runner-tool.js';
import { withSessionRunContext } from '../kodax/session-run-context.js';
import {
  _clearPartnerSpaceToolPoliciesForTesting,
  getPartnerSpaceToolPolicy,
  isPartnerToolAllowed,
} from '../kodax/partner-tools.js';
import { setRendererTarget } from '../ipc/push.js';

setRendererTarget(() => null);

function harness() {
  const dir = mkdtempSync(join(tmpdir(), 'partner-helper-runner-tool-'));
  const projectRoot = join(dir, 'project');
  mkdirSync(projectRoot, { recursive: true });
  const store = new PartnerDeliveryStore(join(dir, 'deliveries.json'), join(dir, 'partner-runs'));
  const auditStore = new AdminPolicyAuditStore(join(dir, 'admin-policy-audit.json'));
  const run = makeRunPartnerHelperHandler(store, auditStore);
  return { dir, projectRoot, store, auditStore, run };
}

test('run_partner_helper executes bounded JavaScript over Partner run-output files', async () => {
  const { dir, projectRoot, store, auditStore, run } = harness();
  try {
    await store.writeRunOutput({
      sessionId: 's1',
      projectRoot,
      relativePath: 'data/input.csv',
      bytes: Buffer.from('name\na\nb\n', 'utf8'),
      producer: 'seed',
    });
    await store.writeRunOutput({
      sessionId: 's1',
      projectRoot,
      relativePath: 'helpers/summarize.js',
      bytes: Buffer.from(
        [
          "const rows = files.readText('data/input.csv').trim().split(/\\n/);",
          "files.writeJson('reports/summary.json', { rows: rows.length, label: input.label });",
          "log('rows', rows.length);",
          'return { ok: true, rows: rows.length };',
        ].join('\n'),
        'utf8',
      ),
      producer: 'seed',
    });

    const out = await withSessionRunContext(
      { sessionId: 's1', surface: 'partner', projectRoot },
      () =>
        run({
          scriptPath: 'helpers/summarize.js',
          input: { label: 'demo' },
          sourceRefs: ['src_1'],
        }),
    );
    assert.match(out, /Partner helper executed: helpers\/summarize\.js/);
    assert.match(out, /rows 3/);
    assert.match(out, /reports\/summary\.json/);
    assert.match(out, /Delivery reference: \{"type":"partner-delivery"/);
    assert.match(out, /kodax-space:\/\/partner-delivery\/pd_/);

    const delivery = (await store.list({ sessionId: 's1' })).find(
      (item) => item.relativePath === 'reports/summary.json',
    );
    assert.ok(delivery);
    assert.equal(delivery.producer, 'run_partner_helper');
    assert.deepEqual(delivery.sourceRefs, ['src_1']);
    assert.equal(
      readFileSync(delivery.absolutePath, 'utf8'),
      '{\n  "rows": 3,\n  "label": "demo"\n}',
    );
    const audit = await auditStore.listAudit({ category: 'workspace-file', limit: 10 });
    assert.ok(
      audit.some((event) => event.action === 'delivery.runHelper' && event.outcome === 'allowed'),
    );
  } finally {
    store.invalidate();
    auditStore.invalidate();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('run_partner_helper preserves safe pure helpers without exposing host objects', async () => {
  const { dir, projectRoot, store, auditStore, run } = harness();
  try {
    await store.writeRunOutput({
      sessionId: 's1',
      projectRoot,
      relativePath: 'helpers/pure-helpers.js',
      bytes: Buffer.from(
        [
          "const text = new TextDecoder().decode(new TextEncoder().encode('中文'));",
          "files.writeText('reports/pure.txt', text);",
          'return Promise.resolve({',
          '  text,',
          '  epoch: new Date(0).toISOString(),',
          '  maximum: Math.max(2, 7, 4),',
          "  exists: files.exists('reports/pure.txt'),",
          "  listed: files.list('reports').includes('pure.txt'),",
          '});',
        ].join('\n'),
        'utf8',
      ),
      producer: 'seed',
    });

    const out = await withSessionRunContext(
      { sessionId: 's1', surface: 'partner', projectRoot },
      () => run({ scriptPath: 'helpers/pure-helpers.js' }),
    );
    assert.match(out, /Partner helper executed/);
    assert.match(out, /"text": "中文"/);
    assert.match(out, /"epoch": "1970-01-01T00:00:00.000Z"/);
    assert.match(out, /"maximum": 7/);
    assert.match(out, /"exists": true/);
    assert.match(out, /"listed": true/);
    const delivery = (await store.list({ sessionId: 's1' })).find(
      (item) => item.relativePath === 'reports/pure.txt',
    );
    assert.ok(delivery);
    assert.equal(readFileSync(delivery.absolutePath, 'utf8'), '中文');
  } finally {
    store.invalidate();
    auditStore.invalidate();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('run_partner_helper registers microtask writes before returning', async () => {
  const { dir, projectRoot, store, auditStore, run } = harness();
  try {
    await store.writeRunOutput({
      sessionId: 's1',
      projectRoot,
      relativePath: 'helpers/microtask.js',
      bytes: Buffer.from(
        [
          "Promise.resolve().then(() => files.writeText('reports/late.txt', 'late write'));",
          "return 'queued';",
        ].join('\n'),
        'utf8',
      ),
      producer: 'seed',
    });

    const out = await withSessionRunContext(
      { sessionId: 's1', surface: 'partner', projectRoot },
      () => run({ scriptPath: 'helpers/microtask.js' }),
    );
    assert.match(out, /Partner helper executed: helpers\/microtask\.js/);
    assert.match(out, /reports\/late\.txt/);

    const delivery = (await store.list({ sessionId: 's1' })).find(
      (item) => item.relativePath === 'reports/late.txt',
    );
    assert.ok(delivery);
    assert.equal(delivery.producer, 'run_partner_helper');
    assert.equal(readFileSync(delivery.absolutePath, 'utf8'), 'late write');
  } finally {
    store.invalidate();
    auditStore.invalidate();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('run_partner_helper records files written before helper failure', async () => {
  const { dir, projectRoot, store, auditStore, run } = harness();
  try {
    await store.writeRunOutput({
      sessionId: 's1',
      projectRoot,
      relativePath: 'helpers/partial.js',
      bytes: Buffer.from(
        [
          "files.writeText('reports/partial.txt', 'partial output');",
          "throw new Error('boom');",
        ].join('\n'),
        'utf8',
      ),
      producer: 'seed',
    });

    const out = await withSessionRunContext(
      { sessionId: 's1', surface: 'partner', projectRoot },
      () => run({ scriptPath: 'helpers/partial.js' }),
    );
    assert.match(out, /Error running Partner helper: Error: boom/);
    assert.match(out, /Partial deliveries:/);
    assert.match(out, /reports\/partial\.txt/);

    const delivery = (await store.list({ sessionId: 's1' })).find(
      (item) => item.relativePath === 'reports/partial.txt',
    );
    assert.ok(delivery);
    assert.equal(delivery.producer, 'run_partner_helper');
    assert.equal(readFileSync(delivery.absolutePath, 'utf8'), 'partial output');
    const audit = await auditStore.listAudit({ category: 'workspace-file', limit: 10 });
    assert.ok(
      audit.some(
        (event) =>
          event.action === 'delivery.runHelper' &&
          event.outcome === 'failed' &&
          typeof event.details === 'string' &&
          event.details.includes('reports/partial.txt'),
      ),
    );
  } finally {
    store.invalidate();
    auditStore.invalidate();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('run_partner_helper preserves timeout, script-size, and partial-delivery limits', async () => {
  const { dir, projectRoot, store, auditStore, run } = harness();
  try {
    await store.writeRunOutput({
      sessionId: 's1',
      projectRoot,
      relativePath: 'helpers/timeout.js',
      bytes: Buffer.from(
        ["files.writeText('reports/before-timeout.txt', 'saved');", 'while (true) {}'].join('\n'),
        'utf8',
      ),
      producer: 'seed',
    });
    const timedOut = await withSessionRunContext(
      { sessionId: 's1', surface: 'partner', projectRoot },
      () => run({ scriptPath: 'helpers/timeout.js', timeoutMs: 100 }),
    );
    assert.match(timedOut, /Script execution timed out/);
    assert.match(timedOut, /Partial deliveries:/);
    const partial = (await store.list({ sessionId: 's1' })).find(
      (item) => item.relativePath === 'reports/before-timeout.txt',
    );
    assert.ok(partial);
    assert.equal(readFileSync(partial.absolutePath, 'utf8'), 'saved');

    await store.writeRunOutput({
      sessionId: 's1',
      projectRoot,
      relativePath: 'helpers/oversized.js',
      bytes: Buffer.alloc(512 * 1024 + 1, 0x20),
      producer: 'seed',
    });
    const oversized = await withSessionRunContext(
      { sessionId: 's1', surface: 'partner', projectRoot },
      () => run({ scriptPath: 'helpers/oversized.js' }),
    );
    assert.match(oversized, /helper script exceeds 524288 bytes/);
  } finally {
    store.invalidate();
    auditStore.invalidate();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('run_partner_helper refuses non-Partner contexts and unavailable host APIs', async () => {
  const { dir, projectRoot, store, auditStore, run } = harness();
  try {
    await store.writeRunOutput({
      sessionId: 's1',
      projectRoot,
      relativePath: 'helpers/require.js',
      bytes: Buffer.from("return require('node:fs');", 'utf8'),
      producer: 'seed',
    });
    assert.match(await run({ scriptPath: 'helpers/require.js' }), /outside an active session run/);
    const codeOut = await withSessionRunContext(
      { sessionId: 's1', surface: 'code', projectRoot },
      () => run({ scriptPath: 'helpers/require.js' }),
    );
    assert.match(codeOut, /only available in Partner/);
    const out = await withSessionRunContext(
      { sessionId: 's1', surface: 'partner', projectRoot },
      () => run({ scriptPath: 'helpers/require.js' }),
    );
    assert.match(out, /require is not defined/);
    assert.equal(
      (await store.list({ sessionId: 's1' })).filter(
        (item) => item.producer === 'run_partner_helper',
      ).length,
      0,
    );
  } finally {
    store.invalidate();
    auditStore.invalidate();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('run_partner_helper cannot escape through host constructors to process or arbitrary files', async () => {
  const { dir, projectRoot, store, auditStore, run } = harness();
  try {
    const hostSecret = join(dir, 'host-secret.txt');
    writeFileSync(hostSecret, 'must-not-be-readable', 'utf8');
    await store.writeRunOutput({
      sessionId: 's1',
      projectRoot,
      relativePath: 'helpers/host-escape.js',
      bytes: Buffer.from(
        [
          "const hostProcess = Date.constructor('return process')();",
          "const fs = hostProcess.getBuiltinModule('node:fs');",
          "return { node: hostProcess.version, secret: fs.readFileSync(input.hostSecret, 'utf8') };",
        ].join('\n'),
        'utf8',
      ),
      producer: 'seed',
    });

    const out = await withSessionRunContext(
      { sessionId: 's1', surface: 'partner', projectRoot },
      () => run({ scriptPath: 'helpers/host-escape.js', input: { hostSecret } }),
    );
    assert.match(out, /Error running Partner helper:/);
    assert.doesNotMatch(out, /must-not-be-readable/);
    assert.equal(
      (await store.list({ sessionId: 's1' })).filter(
        (item) => item.producer === 'run_partner_helper',
      ).length,
      0,
    );
  } finally {
    store.invalidate();
    auditStore.invalidate();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('run_partner_helper blocks constructor and prototype escape variants', async () => {
  const { dir, projectRoot, store, auditStore, run } = harness();
  try {
    await store.writeRunOutput({
      sessionId: 's1',
      projectRoot,
      relativePath: 'helpers/escape-variants.js',
      bytes: Buffer.from(
        [
          'const probes = {',
          "  date: () => Date.constructor('return process')(),",
          "  files: () => files.readText.constructor('return process')(),",
          "  input: () => input.constructor.constructor('return process')(),",
          "  log: () => log.constructor('return process')(),",
          "  console: () => console.log.constructor('return process')(),",
          "  encoder: () => TextEncoder.constructor('return process')(),",
          "  global: () => globalThis.constructor.constructor('return process')(),",
          "  globalPrototype: () => Object.getPrototypeOf(globalThis).constructor.constructor('return process')(),",
          "  objectPrototype: () => ({}).constructor.constructor('return process')(),",
          "  lexicalThis: () => this.constructor.constructor('return process')(),",
          '};',
          'const results = {};',
          'for (const [name, probe] of Object.entries(probes)) {',
          '  try {',
          '    probe();',
          '    results[name] = { escaped: true };',
          '  } catch (error) {',
          '    results[name] = { blocked: true, error: String(error) };',
          '  }',
          '}',
          'return results;',
        ].join('\n'),
        'utf8',
      ),
      producer: 'seed',
    });

    const out = await withSessionRunContext(
      { sessionId: 's1', surface: 'partner', projectRoot },
      () => run({ scriptPath: 'helpers/escape-variants.js', input: { value: 1 } }),
    );
    assert.match(out, /Partner helper executed/);
    assert.doesNotMatch(out, /"escaped": true/);
    assert.equal(out.match(/"blocked": true/g)?.length, 10);
    assert.doesNotMatch(out, /"version": "v\d/);
  } finally {
    store.invalidate();
    auditStore.invalidate();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('run_partner_helper cannot dynamically import host builtins', async () => {
  const { dir, projectRoot, store, auditStore, run } = harness();
  try {
    await store.writeRunOutput({
      sessionId: 's1',
      projectRoot,
      relativePath: 'helpers/import.js',
      bytes: Buffer.from(
        [
          "return import('node:fs').then(",
          '  () => ({ escaped: true }),',
          '  (error) => ({ blocked: true, error: String(error) }),',
          ');',
        ].join('\n'),
        'utf8',
      ),
      producer: 'seed',
    });

    const out = await withSessionRunContext(
      { sessionId: 's1', surface: 'partner', projectRoot },
      () => run({ scriptPath: 'helpers/import.js' }),
    );
    assert.doesNotMatch(out, /"escaped": true/);
    assert.match(out, /blocked|dynamic import|did not settle/i);
  } finally {
    store.invalidate();
    auditStore.invalidate();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('run_partner_helper keeps file access under run-output and honors delivery policy', async () => {
  const { dir, projectRoot, store, auditStore, run } = harness();
  try {
    await auditStore.setPolicy({ workspaceDeliveries: { allowedExtensions: ['js'] } });
    await store.writeRunOutput({
      sessionId: 's1',
      projectRoot,
      relativePath: 'helpers/write-txt.js',
      bytes: Buffer.from("files.writeText('reports/out.txt', 'blocked'); return 'done';", 'utf8'),
      producer: 'seed',
    });
    const blockedByPolicy = await withSessionRunContext(
      { sessionId: 's1', surface: 'partner', projectRoot },
      () => run({ scriptPath: 'helpers/write-txt.js' }),
    );
    assert.match(blockedByPolicy, /extension is blocked/);

    await auditStore.setPolicy({ workspaceDeliveries: { allowedExtensions: [] } });
    await store.writeRunOutput({
      sessionId: 's1',
      projectRoot,
      relativePath: 'helpers/escape.js',
      bytes: Buffer.from("files.writeText('../escape.txt', 'bad'); return 'done';", 'utf8'),
      producer: 'seed',
    });
    const escape = await withSessionRunContext(
      { sessionId: 's1', surface: 'partner', projectRoot },
      () => run({ scriptPath: 'helpers/escape.js' }),
    );
    assert.match(escape, /dot segments/);
    assert.equal(
      (await store.list({ sessionId: 's1' })).filter(
        (item) => item.producer === 'run_partner_helper',
      ).length,
      0,
    );
  } finally {
    store.invalidate();
    auditStore.invalidate();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('run_partner_helper blocks credential paths while allowing benign near matches', async () => {
  const { dir, projectRoot, store, auditStore, run } = harness();
  try {
    await store.writeRunOutput({
      sessionId: 's1',
      projectRoot,
      relativePath: 'helpers/write-path.js',
      bytes: Buffer.from("files.writeText(input.path, 'content'); return input.path;", 'utf8'),
      producer: 'seed',
    });
    const blockedPaths = [
      '.env',
      '.env.development',
      'config/.ENV.Staging',
      '.env.production/notes.txt',
      '.aws/credentials',
      '.azure/accessTokens.json',
      '.gcloud/credentials.json',
      '.config/gcloud/application_default_credentials.json',
      '.kube/config',
      '.docker/config.json',
      '.gnupg/private-keys-v1.d/key',
      '.terraform/terraform.tfstate',
      '.git-credentials',
      '.netrc',
      '.npmrc',
      '.npmrc/cache.txt',
      '.pypirc',
      'credentials.json',
      'client_secret_demo.json',
      'service-account-prod.json',
      'certs/client.pem',
      'keys/private.key',
      'certs/client.p12',
      'certs/client.pfx',
      'certs/client.jks',
      'certs/client.keystore',
    ];
    for (const blockedPath of blockedPaths) {
      const out = await withSessionRunContext(
        { sessionId: 's1', surface: 'partner', projectRoot },
        () => run({ scriptPath: 'helpers/write-path.js', input: { path: blockedPath } }),
      );
      assert.match(out, /Error running Partner helper: .*blocked/i, blockedPath);
    }
    assert.equal(
      (await store.list({ sessionId: 's1' })).filter(
        (item) => item.producer === 'run_partner_helper',
      ).length,
      0,
    );

    const allowedPaths = [
      'reports/environment.txt',
      'reports/.envrc',
      'reports/client.pem.txt',
      'reports/credential-summary.json',
      'reports/gcloud-notes.txt',
      'reports/.config/gcloud-notes/guide.txt',
    ];
    for (const allowedPath of allowedPaths) {
      const out = await withSessionRunContext(
        { sessionId: 's1', surface: 'partner', projectRoot },
        () => run({ scriptPath: 'helpers/write-path.js', input: { path: allowedPath } }),
      );
      assert.match(out, /Partner helper executed/, allowedPath);
    }
    const delivered = (await store.list({ sessionId: 's1' })).filter(
      (item) => item.producer === 'run_partner_helper',
    );
    assert.deepEqual(delivered.map((item) => item.relativePath).sort(), allowedPaths.sort());
  } finally {
    store.invalidate();
    auditStore.invalidate();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('run_partner_helper validates base64 canonically before writing', async () => {
  const { dir, projectRoot, store, auditStore, run } = harness();
  try {
    await store.writeRunOutput({
      sessionId: 's1',
      projectRoot,
      relativePath: 'helpers/base64.js',
      bytes: Buffer.from(
        "files.writeBase64('reports/value.bin', input.value); return 'written';",
        'utf8',
      ),
      producer: 'seed',
    });
    for (const invalid of ['aGVsbG8$', 'aGVsbG8', 'AB==', 'a=bc']) {
      const out = await withSessionRunContext(
        { sessionId: 's1', surface: 'partner', projectRoot },
        () => run({ scriptPath: 'helpers/base64.js', input: { value: invalid } }),
      );
      assert.match(out, /invalid base64 content/);
    }
    assert.equal(
      (await store.list({ sessionId: 's1' })).filter(
        (item) => item.producer === 'run_partner_helper',
      ).length,
      0,
    );

    const valid = await withSessionRunContext(
      { sessionId: 's1', surface: 'partner', projectRoot },
      () => run({ scriptPath: 'helpers/base64.js', input: { value: 'aGVs\nbG8=' } }),
    );
    assert.match(valid, /Partner helper executed/);
    const delivery = (await store.list({ sessionId: 's1' })).find(
      (item) => item.relativePath === 'reports/value.bin',
    );
    assert.ok(delivery);
    assert.equal(readFileSync(delivery.absolutePath, 'utf8'), 'hello');
  } finally {
    store.invalidate();
    auditStore.invalidate();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('run_partner_helper caps aggregate writes while preserving accepted outputs', async () => {
  const { dir, projectRoot, store, auditStore } = harness();
  const run = makeRunPartnerHelperHandler(store, auditStore, { maxTotalWriteBytes: 12 });
  try {
    await store.writeRunOutput({
      sessionId: 's1',
      projectRoot,
      relativePath: 'helpers/aggregate-limit.js',
      bytes: Buffer.from(
        [
          "files.writeText('reports/first.txt', '12345678');",
          'let blocked = false;',
          'try {',
          "  files.writeText('reports/second.txt', 'abcdefgh');",
          '} catch (error) {',
          '  blocked = /total write output exceeds 12 bytes/.test(String(error));',
          '}',
          'return { blocked };',
        ].join('\n'),
        'utf8',
      ),
      producer: 'seed',
    });

    const out = await withSessionRunContext(
      { sessionId: 's1', surface: 'partner', projectRoot },
      () => run({ scriptPath: 'helpers/aggregate-limit.js' }),
    );
    assert.match(out, /Partner helper executed/);
    assert.match(out, /"blocked": true/);
    const deliveries = await store.list({ sessionId: 's1' });
    const first = deliveries.find((item) => item.relativePath === 'reports/first.txt');
    assert.ok(first);
    assert.equal(readFileSync(first.absolutePath, 'utf8'), '12345678');
    assert.equal(
      deliveries.some((item) => item.relativePath === 'reports/second.txt'),
      false,
    );
  } finally {
    store.invalidate();
    auditStore.invalidate();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('run_partner_helper rejects oversized input and expanded VM configuration', async () => {
  const { dir, projectRoot, store, auditStore, run } = harness();
  try {
    await store.writeRunOutput({
      sessionId: 's1',
      projectRoot,
      relativePath: 'helpers/limits.js',
      bytes: Buffer.from("return 'ok';", 'utf8'),
      producer: 'seed',
    });
    const oversizedInput = await withSessionRunContext(
      { sessionId: 's1', surface: 'partner', projectRoot },
      () =>
        run({
          scriptPath: 'helpers/limits.js',
          input: { value: 'x'.repeat(1024 * 1024 + 1) },
        }),
    );
    assert.match(oversizedInput, /helper input exceeds 1048576 bytes/);

    await store.writeRunOutput({
      sessionId: 's1',
      projectRoot,
      relativePath: 'data/config-expansion.txt',
      bytes: Buffer.alloc(6 * 1024 * 1024, 0),
      producer: 'seed',
    });
    const oversizedConfig = await withSessionRunContext(
      { sessionId: 's1', surface: 'partner', projectRoot },
      () => run({ scriptPath: 'helpers/limits.js' }),
    );
    assert.match(oversizedConfig, /helper VM config exceeds 33554432 bytes/);
  } finally {
    store.invalidate();
    auditStore.invalidate();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('run_partner_helper atomically replaces a raced target alias without following it', async () => {
  const { dir, projectRoot, store, auditStore } = harness();
  const hostSecret = join(dir, 'host-secret.txt');
  writeFileSync(hostSecret, 'host-secret-must-survive', 'utf8');
  let raced = false;
  const run = makeRunPartnerHelperHandler(store, auditStore, {
    beforeOutputCommit: ({ relativePath, absolutePath }) => {
      if (relativePath !== 'reports/race.txt') return;
      unlinkSync(absolutePath);
      linkSync(hostSecret, absolutePath);
      raced = true;
    },
  });
  try {
    await store.writeRunOutput({
      sessionId: 's1',
      projectRoot,
      relativePath: 'reports/race.txt',
      bytes: Buffer.from('old output', 'utf8'),
      producer: 'seed',
    });
    await store.writeRunOutput({
      sessionId: 's1',
      projectRoot,
      relativePath: 'helpers/race.js',
      bytes: Buffer.from(
        "files.writeText('reports/race.txt', 'new output'); return 'done';",
        'utf8',
      ),
      producer: 'seed',
    });

    const out = await withSessionRunContext(
      { sessionId: 's1', surface: 'partner', projectRoot },
      () => run({ scriptPath: 'helpers/race.js' }),
    );
    assert.equal(raced, true);
    assert.match(out, /Partner helper executed/);
    assert.equal(readFileSync(hostSecret, 'utf8'), 'host-secret-must-survive');
    const delivery = (await store.list({ sessionId: 's1' })).find(
      (item) => item.relativePath === 'reports/race.txt',
    );
    assert.ok(delivery);
    assert.equal(readFileSync(delivery.absolutePath, 'utf8'), 'new output');
  } finally {
    store.invalidate();
    auditStore.invalidate();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('run_partner_helper terminates an infinite microtask worker without starving main', async () => {
  const { dir, projectRoot, store, auditStore, run } = harness();
  try {
    await store.writeRunOutput({
      sessionId: 's1',
      projectRoot,
      relativePath: 'helpers/microtask-loop.js',
      bytes: Buffer.from(
        [
          'Promise.resolve().then(function spin() { Promise.resolve().then(spin); });',
          "return 'queued';",
        ].join('\n'),
        'utf8',
      ),
      producer: 'seed',
    });

    const startedAt = Date.now();
    const out = await withSessionRunContext(
      { sessionId: 's1', surface: 'partner', projectRoot },
      () => run({ scriptPath: 'helpers/microtask-loop.js', timeoutMs: 50 }),
    );
    const elapsedMs = Date.now() - startedAt;
    assert.match(out, /Script execution timed out|hard deadline/i);
    assert.ok(elapsedMs < 5_000, `helper returned after ${elapsedMs} ms`);
    assert.equal(
      (await store.list({ sessionId: 's1' })).filter(
        (item) => item.producer === 'run_partner_helper',
      ).length,
      0,
    );
  } finally {
    store.invalidate();
    auditStore.invalidate();
    rmSync(dir, { recursive: true, force: true });
  }
});
test('run_partner_helper bounds large result and log serialization', async () => {
  const { dir, projectRoot, store, auditStore, run } = harness();
  try {
    await store.writeRunOutput({
      sessionId: 's1',
      projectRoot,
      relativePath: 'helpers/large-preview.js',
      bytes: Buffer.from(
        [
          "const values = new Array(100000).fill('value');",
          'log({ values });',
          'return { values };',
        ].join('\n'),
        'utf8',
      ),
      producer: 'seed',
    });
    const bounded = await withSessionRunContext(
      { sessionId: 's1', surface: 'partner', projectRoot },
      () => run({ scriptPath: 'helpers/large-preview.js' }),
    );
    assert.match(bounded, /Partner helper executed/);
    assert.match(bounded, /result preview exceeded 4000 characters/);
    assert.match(bounded, /\[log value truncated\]/);
    assert.ok(bounded.length < 30_000);
  } finally {
    store.invalidate();
    auditStore.invalidate();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('run_partner_helper keeps its journal intact under intrinsic prototype poisoning', async () => {
  const { dir, projectRoot, store, auditStore, run } = harness();
  try {
    await store.writeRunOutput({
      sessionId: 's1',
      projectRoot,
      relativePath: 'helpers/prototype-poison.js',
      bytes: Buffer.from(
        [
          "Array.prototype.push = () => { throw new Error('poisoned push'); };",
          "JSON.stringify = () => { throw new Error('poisoned stringify'); };",
          "files.writeText('reports/prototype-safe.txt', 'safe');",
          "return 'done';",
        ].join('\n'),
        'utf8',
      ),
      producer: 'seed',
    });

    const out = await withSessionRunContext(
      { sessionId: 's1', surface: 'partner', projectRoot },
      () => run({ scriptPath: 'helpers/prototype-poison.js' }),
    );
    assert.match(out, /Partner helper executed/);
    const delivery = (await store.list({ sessionId: 's1' })).find(
      (item) => item.relativePath === 'reports/prototype-safe.txt',
    );
    assert.ok(delivery);
    assert.equal(readFileSync(delivery.absolutePath, 'utf8'), 'safe');
  } finally {
    store.invalidate();
    auditStore.invalidate();
    rmSync(dir, { recursive: true, force: true });
  }
});
test('ensurePartnerHelperRunnerToolsRegistered registers tool and Partner policy once', () => {
  _resetPartnerHelperRunnerRegistrationForTesting();
  _clearPartnerSpaceToolPoliciesForTesting();
  const names: string[] = [];
  const sdk = {
    registerTool: (def: { name?: string }) => {
      names.push(String(def.name));
      return () => {};
    },
  };
  ensurePartnerHelperRunnerToolsRegistered(sdk);
  ensurePartnerHelperRunnerToolsRegistered(sdk);
  assert.deepEqual(names, ['run_partner_helper']);
  assert.equal(getPartnerSpaceToolPolicy('run_partner_helper')?.scope, 'workspace-delivery');
  assert.equal(
    isPartnerToolAllowed('run_partner_helper', 'subagent', { sideEffect: 'mutates-state' }),
    true,
  );
  assert.equal(RUN_PARTNER_HELPER_TOOL.sideEffect, 'mutates-state');
  _clearPartnerSpaceToolPoliciesForTesting();
});
