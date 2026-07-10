import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ensurePartnerKbToolsRegistered,
  makePartnerKbListHandler,
  makePartnerKbMaintenanceHandler,
  makePartnerKbReadHandler,
  makePartnerKbSearchHandler,
  makePartnerKbWriteHandler,
  PARTNER_KB_LIST_TOOL,
  PARTNER_KB_MAINTENANCE_TOOL,
  PARTNER_KB_READ_TOOL,
  PARTNER_KB_SEARCH_TOOL,
  PARTNER_KB_WRITE_TOOL,
  _resetPartnerKbToolRegistrationForTesting,
} from '../kodax/partner-kb-tools.js';
import { PartnerKbStore } from '../kodax/partner-kb-store.js';
import { withSessionRunContext } from '../kodax/session-run-context.js';
import {
  _clearPartnerSpaceToolPoliciesForTesting,
  getPartnerSpaceToolPolicy,
  isPartnerToolAllowed,
} from '../kodax/partner-tools.js';

function harness() {
  const dir = mkdtempSync(join(tmpdir(), 'partner-kb-tools-'));
  const store = new PartnerKbStore(join(dir, 'partner-kb.json'));
  return {
    dir,
    store,
    list: makePartnerKbListHandler(store),
    read: makePartnerKbReadHandler(store),
    search: makePartnerKbSearchHandler(store),
    maintenance: makePartnerKbMaintenanceHandler(store),
    write: makePartnerKbWriteHandler(store),
  };
}

test('Partner KB tools write, list, and read pages in a Partner run context', async () => {
  const { dir, store, list, read, write } = harness();
  try {
    const ctx = { sessionId: 's1', surface: 'partner' as const, projectRoot: '/project' };
    const writeOut = await withSessionRunContext(ctx, () =>
      write({ title: 'Decision Log', content: '# Decision\nUse Partner KB.', slug: 'decisions' }),
    );
    assert.match(writeOut, /created/);
    assert.match(writeOut, /slug=decisions/);

    const listOut = await withSessionRunContext(ctx, () => list({}));
    assert.match(listOut, /Decision Log/);
    assert.match(listOut, /decisions/);

    const readOut = await withSessionRunContext(ctx, () => read({ slug: 'decisions' }));
    assert.match(readOut, /# Decision/);
    assert.match(readOut, /Use Partner KB/);
  } finally {
    store.invalidate();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Partner KB search tool returns matching wiki pages', async () => {
  const { dir, store, search, write } = harness();
  try {
    const ctx = { sessionId: 's1', surface: 'partner' as const, projectRoot: '/project' };
    await withSessionRunContext(ctx, () =>
      write({
        title: 'Vendor Fit',
        content: '# Vendor Fit\nMid-market selection memo. [src_1]',
        slug: 'vendor-fit',
      }),
    );
    const out = await withSessionRunContext(ctx, () => search({ query: 'mid-market' }));
    assert.match(out, /Vendor Fit/);
    assert.match(out, /mid-market/i);
    assert.match(out, /reasons=/);
    assert.match(out, /sources=src_1/);
  } finally {
    store.invalidate();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Partner KB maintenance tool returns a persisted maintenance report', async () => {
  const { dir, store, maintenance, write } = harness();
  try {
    const ctx = { sessionId: 's1', surface: 'partner' as const, projectRoot: '/project' };
    await withSessionRunContext(ctx, () =>
      write({
        title: 'Review Notes',
        content: '# Review\n\n## Key Claims\n\n- Needs citation.',
        slug: 'review-notes',
      }),
    );
    const out = await withSessionRunContext(ctx, () => maintenance({}));
    assert.match(out, /maintenance completed/i);
    assert.match(out, /Uncited claim/);
    assert.ok(await store.lastMaintenance('/project'));
  } finally {
    store.invalidate();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Partner KB tools can use SDK tool execution context without ALS', async () => {
  const { dir, store, list, write } = harness();
  try {
    const toolContext = {
      sessionId: 's_sdk',
      executionCwd: '/project',
      agentProfile: { surface: 'partner', id: 'kodax-space.partner' },
    };
    const writeOut = await write(
      { title: 'SDK Context', content: 'from tool ctx', slug: 'sdk-context' },
      toolContext,
    );
    assert.match(writeOut, /created/);
    const listOut = await list({}, toolContext);
    assert.match(listOut, /SDK Context/);
  } finally {
    store.invalidate();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Partner KB tools refuse non-Partner contexts', async () => {
  const { dir, store, list, write } = harness();
  try {
    assert.match(await list({}), /outside an active session run/);
    const out = await withSessionRunContext(
      { sessionId: 's1', surface: 'code', projectRoot: '/project' },
      () => write({ title: 'X', content: 'Y' }),
    );
    assert.match(out, /only available in Partner/);
  } finally {
    store.invalidate();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('ensurePartnerKbToolsRegistered registers all tools and policies once', () => {
  _resetPartnerKbToolRegistrationForTesting();
  _clearPartnerSpaceToolPoliciesForTesting();
  const names: string[] = [];
  const sdk = {
    registerTool: (def: { name?: string }) => {
      names.push(String(def.name));
      return () => {};
    },
  };
  ensurePartnerKbToolsRegistered(sdk);
  ensurePartnerKbToolsRegistered(sdk);
  assert.deepEqual(names, [
    'partner_kb_list_pages',
    'partner_kb_read_page',
    'partner_kb_search_pages',
    'partner_kb_run_maintenance',
    'partner_kb_write_page',
  ]);
  assert.equal(getPartnerSpaceToolPolicy('partner_kb_list_pages')?.sideEffect, 'readonly');
  assert.equal(
    getPartnerSpaceToolPolicy('partner_kb_run_maintenance')?.sideEffect,
    'mutates-state',
  );
  assert.equal(getPartnerSpaceToolPolicy('partner_kb_write_page')?.sideEffect, 'mutates-state');
  assert.equal(
    isPartnerToolAllowed('partner_kb_write_page', 'subagent', { sideEffect: 'mutates-state' }),
    true,
  );
  _clearPartnerSpaceToolPoliciesForTesting();
});

test('Partner KB tool definitions declare expected side effects', () => {
  assert.equal(PARTNER_KB_LIST_TOOL.sideEffect, 'readonly');
  assert.equal(PARTNER_KB_READ_TOOL.sideEffect, 'readonly');
  assert.equal(PARTNER_KB_SEARCH_TOOL.sideEffect, 'readonly');
  assert.equal(PARTNER_KB_MAINTENANCE_TOOL.sideEffect, 'mutates-state');
  assert.equal(PARTNER_KB_WRITE_TOOL.sideEffect, 'mutates-state');
  assert.deepEqual(PARTNER_KB_WRITE_TOOL.input_schema.required, ['title', 'content']);
});
