// F058 — create_artifact tool: handler logic (attribution via run-context ALS,
// store integration, validation), tool-def shape, Partner allow. The end-to-end
// "agent actually calls it" path needs a real LLM session (e2e/real-glm-session
// style) — these cover everything below that boundary.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ArtifactStore } from '../artifact/store.js';
import { withArtifactContext } from '../artifact/run-context.js';
import {
  makeCreateArtifactHandler,
  CREATE_ARTIFACT_TOOL,
  ensureCreateArtifactToolRegistered,
  _resetCreateArtifactRegistrationForTesting,
} from '../artifact/create-artifact-tool.js';
import {
  _clearPartnerSpaceToolPoliciesForTesting,
  getPartnerSpaceToolPolicy,
  isPartnerToolAllowed,
  PARTNER_SPACE_TOOL_ALLOW,
} from '../kodax/partner-tools.js';

function freshStore(): { store: ArtifactStore; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), 'create-artifact-tool-'));
  return { store: new ArtifactStore(join(dir, 'artifacts.json'), dir), dir };
}

function harness() {
  const { store, dir } = freshStore();
  const changes: Array<{ id: string; sessionId: string; reason: string }> = [];
  const handler = makeCreateArtifactHandler({ store, notifyChanged: (p) => changes.push(p) });
  return { store, dir, changes, handler };
}

const CTX = { sessionId: 's1', surface: 'partner' as const, projectRoot: '/proj' };

test('handler: creates a markdown artifact within run context + notifies', async () => {
  const { store, dir, changes, handler } = harness();
  try {
    const out = await withArtifactContext(CTX, () =>
      handler({ kind: 'markdown', title: 'Report', content: '# hi' }),
    );
    assert.match(out, /created/i);
    const list = await store.list();
    assert.equal(list.length, 1);
    assert.equal(list[0]?.sessionId, 's1');
    assert.equal(list[0]?.surface, 'partner');
    assert.equal(changes.length, 1);
    assert.equal(changes[0]?.reason, 'created');
    assert.equal(changes[0]?.sessionId, 's1'); // attributed from ALS, not tool input
  } finally {
    store.invalidate();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('handler: accepts interactive-html and normalizes script-driven html', async () => {
  const { store, dir, handler } = harness();
  try {
    const explicit = await withArtifactContext(CTX, () =>
      handler({
        kind: 'interactive-html',
        title: 'Canvas',
        content: '<canvas id="c"></canvas><script>document.body.dataset.ran="1"</script>',
      }),
    );
    assert.match(explicit, /created/i);

    const auto = await withArtifactContext(CTX, () =>
      handler({
        kind: 'html',
        title: 'Auto Canvas',
        content:
          '<html><body><canvas></canvas><script>requestAnimationFrame(() => {})</script></body></html>',
      }),
    );
    assert.match(auto, /created/i);

    const kinds = (await store.list()).map((artifact) => artifact.kind).sort();
    assert.deepEqual(kinds, ['interactive-html', 'interactive-html']);
  } finally {
    store.invalidate();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('handler: normalizes html with permissions to interactive-html', async () => {
  const { store, dir, handler } = harness();
  const permissions = {
    connect: ['https://api.example.com'],
    scripts: [
      {
        url: 'https://cdn.example.com/lib/v1.js',
        integrity: 'sha384-AbCdEf0123456789+/=',
      },
    ],
  };
  try {
    const out = await withArtifactContext(CTX, () =>
      handler({
        kind: 'html',
        title: 'Networked Demo',
        content: '<html><body>demo</body></html>',
        permissions,
      }),
    );
    assert.match(out, /created/i);
    const artifact = (await store.list())[0];
    assert.equal(artifact?.kind, 'interactive-html');
    assert.deepEqual(artifact?.permissions, permissions);
  } finally {
    store.invalidate();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('handler: can attribute from SDK tool execution context without ALS', async () => {
  const { store, dir, changes, handler } = harness();
  try {
    const out = await handler(
      { kind: 'markdown', title: 'Report', content: '# hi' },
      {
        sessionId: 's_sdk',
        executionCwd: '/proj',
        agentProfile: { surface: 'partner', id: 'kodax-space.partner' },
      },
    );
    assert.match(out, /created/i);
    const list = await store.list();
    assert.equal(list[0]?.sessionId, 's_sdk');
    assert.equal(list[0]?.surface, 'partner');
    assert.equal(changes[0]?.sessionId, 's_sdk');
  } finally {
    store.invalidate();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('handler: artifactId appends a version (reason=version)', async () => {
  const { store, dir, changes, handler } = harness();
  try {
    await withArtifactContext(CTX, () => handler({ kind: 'markdown', title: 'R', content: 'v1' }));
    const id = (await store.list())[0]!.id;
    const out = await withArtifactContext(CTX, () =>
      handler({ kind: 'markdown', title: 'R', content: 'v2', artifactId: id }),
    );
    assert.match(out, /updated/i);
    assert.equal((await store.list())[0]?.currentVersion, 2);
    assert.equal(changes[1]?.reason, 'version');
  } finally {
    store.invalidate();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('handler: refuses when called outside a run context (no attribution)', async () => {
  const { store, dir, handler } = harness();
  try {
    const out = await handler({ kind: 'markdown', title: 'R', content: 'x' }); // no withArtifactContext
    assert.match(out, /outside an active session run/i);
    assert.equal((await store.list()).length, 0);
  } finally {
    store.invalidate();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('handler: rejects the gated react tier', async () => {
  const { store, dir, handler } = harness();
  try {
    const out = await withArtifactContext(CTX, () =>
      handler({ kind: 'react', title: 'X', content: 'export default()=>null' }),
    );
    assert.match(out, /not available/i);
    assert.equal((await store.list()).length, 0);
  } finally {
    store.invalidate();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('handler: invalid payload (markdown without content) → error, no write', async () => {
  const { store, dir, handler } = harness();
  try {
    const out = await withArtifactContext(CTX, () => handler({ kind: 'markdown', title: 'X' }));
    assert.match(out, /invalid artifact input/i);
    assert.equal((await store.list()).length, 0);
  } finally {
    store.invalidate();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('handler: path-backed kinds work', async () => {
  const { store, dir, handler } = harness();
  try {
    const out = await withArtifactContext(CTX, () =>
      handler({ kind: 'pdf', title: 'Doc', path: '/proj/a.pdf' }),
    );
    assert.match(out, /created/i);
    const media = await withArtifactContext(CTX, () =>
      handler({ kind: 'file', title: 'Movie', path: '/proj/demo.mp4' }),
    );
    assert.match(media, /created/i);
    const list = await store.list();
    const pdfRead = await store.read(list.find((artifact) => artifact.kind === 'pdf')!.id);
    const fileRead = await store.read(list.find((artifact) => artifact.kind === 'file')!.id);
    assert.equal(pdfRead?.path, '/proj/a.pdf');
    assert.equal(fileRead?.path, '/proj/demo.mp4');
  } finally {
    store.invalidate();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('handler: path outside the project is rejected', async () => {
  const { store, dir, handler } = harness();
  try {
    const out = await withArtifactContext(CTX, () =>
      handler({ kind: 'pdf', title: 'Doc', path: '/etc/passwd' }),
    );
    assert.match(out, /inside the project/i);
    assert.equal((await store.list()).length, 0);
  } finally {
    store.invalidate();
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---- registration path ----

test('ensureCreateArtifactToolRegistered: idempotent (registers once)', () => {
  _resetCreateArtifactRegistrationForTesting();
  _clearPartnerSpaceToolPoliciesForTesting();
  let calls = 0;
  const sdk = {
    registerTool: () => {
      calls++;
      return () => {};
    },
  };
  ensureCreateArtifactToolRegistered(sdk);
  ensureCreateArtifactToolRegistered(sdk);
  assert.equal(calls, 1);
  assert.equal(getPartnerSpaceToolPolicy('create_artifact')?.scope, 'artifact');
});

test('ensureCreateArtifactToolRegistered: no registerTool → soft no-op, can retry later', () => {
  _resetCreateArtifactRegistrationForTesting();
  ensureCreateArtifactToolRegistered({}); // missing registerTool
  let calls = 0;
  ensureCreateArtifactToolRegistered({
    registerTool: () => {
      calls++;
      return () => {};
    },
  });
  assert.equal(calls, 1); // flag wasn't locked by the failed attempt
});

test('ensureCreateArtifactToolRegistered: throwing reg() does not lock out retry', () => {
  _resetCreateArtifactRegistrationForTesting();
  assert.throws(() =>
    ensureCreateArtifactToolRegistered({
      registerTool: () => {
        throw new Error('boom');
      },
    }),
  );
  let calls = 0;
  ensureCreateArtifactToolRegistered({
    registerTool: () => {
      calls++;
      return () => {};
    },
  });
  assert.equal(calls, 1); // retried successfully after the throw
});

// ---- tool definition shape + Partner allow ----

test('CREATE_ARTIFACT_TOOL: shape + react excluded + mutates-state', () => {
  assert.equal(CREATE_ARTIFACT_TOOL.name, 'create_artifact');
  assert.equal(CREATE_ARTIFACT_TOOL.sideEffect, 'mutates-state');
  assert.deepEqual(CREATE_ARTIFACT_TOOL.input_schema.required, ['kind', 'title']);
  const kinds = (CREATE_ARTIFACT_TOOL.input_schema.properties.kind as { enum: string[] }).enum;
  assert.ok(kinds.includes('markdown') && kinds.includes('chart'));
  assert.ok(kinds.includes('interactive-html'));
  assert.ok(kinds.includes('pptx'));
  assert.ok(!kinds.includes('react')); // legacy LiveCanvas/React tier remains unavailable
  assert.ok('permissions' in CREATE_ARTIFACT_TOOL.input_schema.properties);
});

test('Partner allows create_artifact even though its capability is non-read', () => {
  assert.ok(PARTNER_SPACE_TOOL_ALLOW.has('create_artifact'));
  // resolveToolCapability fail-closes unknown custom tools to 'subagent'
  assert.equal(isPartnerToolAllowed('create_artifact', 'subagent'), true);
  assert.equal(isPartnerToolAllowed('some_other_tool', 'subagent'), false);
});
