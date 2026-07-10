import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  CREATE_FILE_PROPOSAL_TOOL,
  UPDATE_FILE_PROPOSAL_TOOL,
  _resetPartnerFileProposalToolRegistrationForTesting,
  ensurePartnerFileProposalToolsRegistered,
  makeFileProposalHandler,
} from '../kodax/partner-file-proposal-tool.js';
import { PartnerFileProposalStore } from '../kodax/partner-file-proposal-store.js';
import { withSessionRunContext } from '../kodax/session-run-context.js';
import {
  _clearPartnerSpaceToolPoliciesForTesting,
  getPartnerSpaceToolPolicy,
  isPartnerToolAllowed,
} from '../kodax/partner-tools.js';

function harness() {
  const dir = mkdtempSync(join(tmpdir(), 'partner-file-proposal-tool-'));
  const root = join(dir, 'project');
  mkdirSync(join(root, 'docs'), { recursive: true });
  const store = new PartnerFileProposalStore(join(dir, 'proposals.json'));
  return { dir, root, store, create: makeFileProposalHandler(store, 'create') };
}

test('file proposal tool creates a pending proposal in a Partner run context', async () => {
  const { dir, root, store, create } = harness();
  try {
    const out = await withSessionRunContext(
      { sessionId: 's1', surface: 'partner', projectRoot: root },
      () =>
        create({
          targetPath: 'docs/brief.md',
          content: '# Brief',
          rationale: 'User asked for a persisted brief.',
          sourceRefs: ['src_1'],
        }),
    );
    assert.match(out, /File proposal created: pfp_/);
    assert.match(out, /workspace has not been modified/i);
    assert.equal((await store.list({ sessionId: 's1', status: 'pending' })).length, 1);
  } finally {
    store.invalidate();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('file proposal tools refuse non-Partner contexts', async () => {
  const { dir, root, store, create } = harness();
  try {
    assert.match(
      await create({ targetPath: 'docs/x.md', content: 'x' }),
      /outside an active session run/,
    );
    const out = await withSessionRunContext(
      { sessionId: 's1', surface: 'code', projectRoot: root },
      () => create({ targetPath: 'docs/x.md', content: 'x' }),
    );
    assert.match(out, /only available in Partner/);
  } finally {
    store.invalidate();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('ensurePartnerFileProposalToolsRegistered registers tools and Partner policy once', () => {
  _resetPartnerFileProposalToolRegistrationForTesting();
  _clearPartnerSpaceToolPoliciesForTesting();
  const names: string[] = [];
  const sdk = {
    registerTool: (def: { name?: string }) => {
      names.push(String(def.name));
      return () => {};
    },
  };
  ensurePartnerFileProposalToolsRegistered(sdk);
  ensurePartnerFileProposalToolsRegistered(sdk);
  assert.deepEqual(names, ['create_file_proposal', 'update_file_proposal']);
  assert.equal(getPartnerSpaceToolPolicy('create_file_proposal')?.scope, 'workspace-file-proposal');
  assert.equal(
    isPartnerToolAllowed('create_file_proposal', 'subagent', { sideEffect: 'mutates-state' }),
    true,
  );
  assert.equal(CREATE_FILE_PROPOSAL_TOOL.sideEffect, 'mutates-state');
  assert.equal(UPDATE_FILE_PROPOSAL_TOOL.sideEffect, 'mutates-state');
  _clearPartnerSpaceToolPoliciesForTesting();
});
