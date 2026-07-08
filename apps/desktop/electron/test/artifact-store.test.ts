// F057 — ArtifactStore: CRUD, versioning, filtering, persistence, caps, resilience.
// Real tmp-dir persistence (DI constructor), no mocks.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import DatabaseConstructor from 'better-sqlite3';
import type BetterSqlite3 from 'better-sqlite3';
import {
  ArtifactStore,
  isRecoverableCatalogOpenError,
  type ArtifactStoreOptions,
} from '../artifact/store.js';
import { artifactCreateChannel } from '@kodax-space/space-ipc-schema';

function freshStore(options?: ArtifactStoreOptions): {
  store: ArtifactStore;
  dir: string;
  file: string;
  catalog: string;
} {
  const dir = mkdtempSync(join(tmpdir(), 'artifact-store-'));
  const file = join(dir, 'artifacts.json');
  const catalog = join(dir, 'artifacts', 'v2', 'catalog.sqlite');
  return { store: new ArtifactStore(file, dir, options), dir, file, catalog };
}

const base = { sessionId: 's1', surface: 'partner' as const, kind: 'markdown' as const };

function artifactDir(root: string, sessionId: string, id: string): string {
  return join(
    root,
    'artifacts',
    'v2',
    'sessions',
    Buffer.from(sessionId, 'utf8').toString('base64url'),
    id,
  );
}

test('create → list (meta only) → read (content)', async () => {
  const { store, dir } = freshStore();
  try {
    const { id, version } = await store.upsert({ ...base, title: 'Doc', content: '# hi' });
    assert.equal(version, 1);

    const list = await store.list();
    assert.equal(list.length, 1);
    assert.equal(list[0]?.id, id);
    assert.equal(list[0]?.kind, 'markdown');
    assert.equal(list[0]?.currentVersion, 1);
    // list carries metadata only (hasContent flag), not the content itself
    assert.equal(list[0]?.versions[0]?.hasContent, true);
    assert.equal((list[0]?.versions[0] as unknown as { content?: string }).content, undefined);

    const read = await store.read(id);
    assert.equal(read?.content, '# hi');
    assert.equal(read?.version, 1);
  } finally {
    store.invalidate();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('interactive-html permissions persist through list/read and catalog reload', async () => {
  const { store, dir, file } = freshStore();
  let store2: ArtifactStore | null = null;
  const permissions = {
    connect: ['https://api.example.com'],
    style: ['https://styles.example.com'],
    scripts: [
      {
        url: 'https://cdn.example.com/lib/v1.js',
        integrity: 'sha384-AbCdEf0123456789+/=',
      },
    ],
    forms: ['https://forms.example.com'],
    popups: 'confirm-external' as const,
  };
  try {
    const { id } = await store.upsert({
      sessionId: 's1',
      surface: 'partner',
      kind: 'interactive-html',
      title: 'Interactive',
      content: '<canvas></canvas><script></script>',
      permissions,
    });

    assert.deepEqual((await store.list())[0]?.permissions, permissions);
    assert.deepEqual((await store.read(id))?.ref.permissions, permissions);

    store.invalidate();
    store2 = new ArtifactStore(file, dir);
    assert.deepEqual((await store2.list())[0]?.permissions, permissions);
    assert.deepEqual((await store2.read(id))?.ref.permissions, permissions);
  } finally {
    store2?.invalidate();
    store.invalidate();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('upsert with existing id appends a version (iterate)', async () => {
  const { store, dir } = freshStore();
  try {
    const { id } = await store.upsert({ ...base, title: 'Doc', content: 'v1' });
    const { version } = await store.upsert({ ...base, id, title: 'Doc', content: 'v2' });
    assert.equal(version, 2);

    const list = await store.list();
    assert.equal(list[0]?.currentVersion, 2);
    assert.equal(list[0]?.versions.length, 2);

    assert.equal((await store.read(id))?.content, 'v2'); // default = current
    assert.equal((await store.read(id, 1))?.content, 'v1'); // explicit old version
  } finally {
    store.invalidate();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('upsert rejects an existing id from another session', async () => {
  const { store, dir } = freshStore();
  try {
    const { id } = await store.upsert({
      sessionId: 'session-a',
      surface: 'partner',
      kind: 'markdown',
      title: 'Owned',
      content: 'v1',
    });

    await assert.rejects(
      () =>
        store.upsert({
          sessionId: 'session-b',
          surface: 'partner',
          kind: 'markdown',
          id,
          title: 'Hijack',
          content: 'v2',
        }),
      /different session/,
    );

    assert.equal((await store.list({ sessionId: 'session-b' })).length, 0);
    const owned = await store.read(id);
    assert.equal(owned?.ref.sessionId, 'session-a');
    assert.equal(owned?.ref.currentVersion, 1);
    assert.equal(owned?.content, 'v1');
  } finally {
    store.invalidate();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('list filters by sessionId and surface', async () => {
  const { store, dir } = freshStore();
  try {
    await store.upsert({
      sessionId: 'a',
      surface: 'partner',
      kind: 'markdown',
      title: 'A',
      content: 'x',
    });
    await store.upsert({ sessionId: 'b', surface: 'code', kind: 'code', title: 'B', content: 'y' });
    assert.equal((await store.list({ sessionId: 'a' })).length, 1);
    assert.equal((await store.list({ surface: 'code' })).length, 1);
    assert.equal((await store.list({ sessionId: 'a', surface: 'code' })).length, 0);
    assert.equal((await store.list()).length, 2);
  } finally {
    store.invalidate();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('path-backed kind stores a path reference (no inline content)', async () => {
  const { store, dir } = freshStore();
  try {
    const { id } = await store.upsert({
      sessionId: 's1',
      surface: 'partner',
      kind: 'pdf',
      title: 'Report',
      path: '/proj/report.pdf',
    });
    const meta = (await store.list())[0];
    assert.equal(meta?.versions[0]?.hasContent, false);
    assert.equal(meta?.versions[0]?.path, '/proj/report.pdf');
    const read = await store.read(id);
    assert.equal(read?.path, '/proj/report.pdf');
    assert.equal(read?.content, undefined);
  } finally {
    store.invalidate();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('delete removes the artifact', async () => {
  const { store, dir } = freshStore();
  try {
    const { id } = await store.upsert({ ...base, title: 'Doc', content: 'x' });
    assert.equal(await store.delete(id), true);
    assert.equal(await store.delete(id), false); // idempotent
    assert.equal((await store.list()).length, 0);
    assert.equal(await store.read(id), null);
  } finally {
    store.invalidate();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('persists across store instances (file source + catalog reload)', async () => {
  const { store, dir, file, catalog } = freshStore();
  let store2: ArtifactStore | null = null;
  try {
    const { id } = await store.upsert({ ...base, title: 'Doc', content: 'persisted' });
    assert.equal(existsSync(file), false); // new artifacts do not revive the v1 monolith
    assert.ok(existsSync(catalog));
    // A fresh instance on the same file reloads it.
    store2 = new ArtifactStore(file, dir);
    const read = await store2.read(id);
    assert.equal(read?.content, 'persisted');
  } finally {
    store2?.invalidate();
    store.invalidate();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('corrupt catalog is discarded and rebuilt from v2 files', async () => {
  const { store, dir, file, catalog } = freshStore();
  let store2: ArtifactStore | null = null;
  try {
    const { id } = await store.upsert({ ...base, title: 'Doc', content: 'still here' });
    store.invalidate();
    writeFileSync(catalog, 'not a sqlite database');

    store2 = new ArtifactStore(file, dir);
    assert.equal((await store2.read(id))?.content, 'still here');
  } finally {
    store2?.invalidate();
    store.invalidate();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('catalog open recovery is limited to SQLite catalog corruption', () => {
  const malformed = Object.assign(new Error('database disk image is malformed'), {
    code: 'SQLITE_CORRUPT',
  });
  assert.equal(isRecoverableCatalogOpenError(malformed), true);

  const notDatabase = Object.assign(new Error('file is not a database'), { code: 'SQLITE_NOTADB' });
  assert.equal(isRecoverableCatalogOpenError(notDatabase), true);

  const abiMismatch = new Error(
    'The module better_sqlite3.node was compiled against a different Node.js version using NODE_MODULE_VERSION 137.',
  );
  assert.equal(isRecoverableCatalogOpenError(abiMismatch), false);
});

test('list self-heals when catalog row metadata is malformed', async () => {
  const { store, dir, catalog } = freshStore();
  let db: BetterSqlite3.Database | null = null;
  try {
    const { id } = await store.upsert({ ...base, title: 'Doc', content: 'still indexed' });
    db = new DatabaseConstructor(catalog);
    db.prepare('UPDATE artifacts SET versionsJson = ? WHERE id = ?').run('not-json', id);
    db.close();
    db = null;

    const list = await store.list();
    assert.equal(list.length, 1);
    assert.equal(list[0]?.id, id);
    assert.equal((await store.read(id))?.content, 'still indexed');
  } finally {
    db?.close();
    store.invalidate();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('read self-heals stale catalog rows when source files are gone', async () => {
  const { store, dir } = freshStore();
  try {
    const { id } = await store.upsert({ ...base, title: 'Doc', content: 'delete me' });
    rmSync(artifactDir(dir, base.sessionId, id), { recursive: true, force: true });

    assert.equal(await store.read(id), null);
    assert.deepEqual(await store.list(), []);
  } finally {
    store.invalidate();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('read self-heals stale catalog rows when meta files are invalid', async () => {
  const { store, dir } = freshStore();
  try {
    const { id } = await store.upsert({ ...base, title: 'Doc', content: 'bad meta' });
    writeFileSync(join(artifactDir(dir, base.sessionId, id), 'meta.json'), '{ bad json');

    assert.equal(await store.read(id), null);
    assert.deepEqual(await store.list(), []);
  } finally {
    store.invalidate();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('list self-heals stale catalog rows when source meta files are gone', async () => {
  const { store, dir } = freshStore();
  try {
    const { id } = await store.upsert({ ...base, title: 'Doc', content: 'delete meta' });
    rmSync(join(artifactDir(dir, base.sessionId, id), 'meta.json'), { force: true });

    assert.deepEqual(await store.list(), []);
    assert.equal(await store.read(id), null);
  } finally {
    store.invalidate();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('list self-heals stale catalog rows when source meta files are invalid', async () => {
  const { store, dir } = freshStore();
  try {
    const { id } = await store.upsert({ ...base, title: 'Doc', content: 'bad meta' });
    writeFileSync(join(artifactDir(dir, base.sessionId, id), 'meta.json'), '{ bad json');

    assert.deepEqual(await store.list(), []);
    assert.equal(await store.read(id), null);
  } finally {
    store.invalidate();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('quota cleanup prunes old artifacts before the count hard cap', async () => {
  const { store, dir } = freshStore({
    maxArtifacts: 3,
    targetArtifacts: 2,
    maxBytes: 1024 * 1024 * 1024,
    targetBytes: 1024 * 1024 * 1024,
  });
  try {
    await store.upsert({ ...base, title: 'A', content: 'a' });
    await store.upsert({ ...base, title: 'B', content: 'b' });
    await store.upsert({ ...base, title: 'C', content: 'c' });
    const latest = await store.upsert({ ...base, title: 'D', content: 'd' });

    const list = await store.list();
    assert.equal(list.length, 2);
    assert.ok(list.some((artifact) => artifact.id === latest.id));
  } finally {
    store.invalidate();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('catalog rebuild removes uncommitted artifact dirs and unreferenced version files', async () => {
  const { store, dir, file } = freshStore();
  let store2: ArtifactStore | null = null;
  try {
    const { id } = await store.upsert({ ...base, title: 'Doc', content: 'v1' });
    const committedDir = artifactDir(dir, base.sessionId, id);
    const unreferenced = join(committedDir, 'versions', '9999.md');
    writeFileSync(unreferenced, 'orphan version');

    const orphanDir = artifactDir(dir, base.sessionId, 'never-committed');
    mkdirSync(join(orphanDir, 'versions'), { recursive: true });
    writeFileSync(join(orphanDir, 'versions', '0001.md'), 'partial write');

    store.invalidate();
    store2 = new ArtifactStore(file, dir);
    assert.equal((await store2.list()).length, 1);
    assert.equal(existsSync(unreferenced), false);
    assert.equal(existsSync(orphanDir), false);
  } finally {
    store2?.invalidate();
    store.invalidate();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('catalog upsert recovery returns success when rebuild indexes the written meta', async () => {
  const { store, dir } = freshStore();
  type RecoverableStore = {
    upsertCatalog: (...args: unknown[]) => void;
  };
  const internal = store as unknown as RecoverableStore;
  const originalUpsertCatalog = internal.upsertCatalog.bind(store);
  let failOnce = true;
  internal.upsertCatalog = (...args: unknown[]) => {
    if (failOnce) {
      failOnce = false;
      throw new Error('simulated catalog write failure');
    }
    originalUpsertCatalog(...args);
  };

  try {
    const { id, version, created } = await store.upsert({ ...base, title: 'Doc', content: 'v1' });
    assert.equal(created, true);
    assert.equal(version, 1);
    const list = await store.list({ sessionId: base.sessionId });
    assert.equal(list.length, 1);
    assert.equal(list[0]?.id, id);
    assert.equal((await store.read(id))?.content, 'v1');
  } finally {
    internal.upsertCatalog = originalUpsertCatalog;
    store.invalidate();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('corrupt file → starts empty, does not throw', async () => {
  const { store, dir, file } = freshStore();
  try {
    writeFileSync(file, '{ this is not valid json');
    const list = await store.list();
    assert.deepEqual(list, []);
    // still writable after recovering
    const { id } = await store.upsert({ ...base, title: 'Doc', content: 'ok' });
    assert.equal((await store.read(id))?.content, 'ok');
  } finally {
    store.invalidate();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('migrates legacy artifacts.json into v2 files and keeps a backup', async () => {
  const { store, dir, file } = freshStore();
  try {
    writeFileSync(
      file,
      JSON.stringify({
        version: 1,
        artifacts: [
          {
            id: 'legacy-a',
            sessionId: 's-legacy',
            surface: 'partner',
            kind: 'markdown',
            title: 'Legacy',
            currentVersion: 2,
            versions: [
              { v: 1, createdAt: 100, content: 'v1', summary: 'first' },
              { v: 2, createdAt: 200, content: 'v2', summary: 'second' },
            ],
            createdAt: 100,
            updatedAt: 200,
          },
        ],
      }),
    );

    const list = await store.list({ sessionId: 's-legacy' });
    assert.equal(list.length, 1);
    assert.equal(list[0]?.id, 'legacy-a');
    assert.equal(list[0]?.currentVersion, 2);
    assert.equal((await store.read('legacy-a'))?.content, 'v2');
    assert.equal((await store.read('legacy-a', 1))?.content, 'v1');
    assert.equal(existsSync(file), false);
    assert.ok(existsSync(join(dir, 'artifacts.v1.backup.json')));
  } finally {
    store.invalidate();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('legacy migration rejects unsafe artifact ids before using them as paths', async () => {
  const { store, dir, file } = freshStore();
  try {
    writeFileSync(
      file,
      JSON.stringify({
        version: 1,
        artifacts: [
          {
            id: '../escape',
            sessionId: 'legacy-s',
            surface: 'partner',
            kind: 'markdown',
            title: 'Unsafe',
            currentVersion: 1,
            versions: [{ v: 1, createdAt: 1, content: 'owned' }],
            createdAt: 1,
            updatedAt: 1,
          },
        ],
      }),
    );

    assert.deepEqual(await store.list(), []);
    assert.equal(existsSync(join(dir, 'escape')), false);
    assert.equal(existsSync(file), true);
  } finally {
    store.invalidate();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('rejects content over the size cap', async () => {
  const { store, dir } = freshStore();
  try {
    const huge = 'a'.repeat(1_048_577); // > 1 MB
    await assert.rejects(
      () => store.upsert({ ...base, title: 'Big', content: huge }),
      /size limit/,
    );
  } finally {
    store.invalidate();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('upsert enforces content/path invariants before writing metadata', async () => {
  const { store, dir } = freshStore();
  try {
    await assert.rejects(
      () => store.upsert({ ...base, title: 'Missing content' }),
      /content artifact kinds require content/,
    );
    await assert.rejects(
      () => store.upsert({ ...base, title: 'Mixed', content: 'x', path: '/proj/x.md' }),
      /content artifact kinds do not accept a path/,
    );
    await assert.rejects(
      () => store.upsert({ sessionId: 's1', surface: 'partner', kind: 'pdf', title: 'No path' }),
      /path-backed artifact kinds require a path/,
    );
    await assert.rejects(
      () =>
        store.upsert({
          sessionId: 's1',
          surface: 'partner',
          kind: 'pdf',
          title: 'Mixed',
          path: '/proj/a.pdf',
          content: 'x',
        }),
      /path-backed artifact kinds do not accept inline content/,
    );
    assert.deepEqual(await store.list(), []);
  } finally {
    store.invalidate();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('upsert: created flag + fresh id on unknown id (no resurrection)', async () => {
  const { store, dir } = freshStore();
  try {
    const r1 = await store.upsert({ ...base, title: 'A', content: 'a' });
    assert.equal(r1.created, true);

    const r2 = await store.upsert({ ...base, id: r1.id, title: 'A', content: 'b' });
    assert.equal(r2.created, false); // appended a version
    assert.equal(r2.id, r1.id);

    // unknown id → brand-new artifact with a FRESH id, never the stale one
    const r3 = await store.upsert({ ...base, id: 'does-not-exist', title: 'C', content: 'c' });
    assert.equal(r3.created, true);
    assert.notEqual(r3.id, 'does-not-exist');
  } finally {
    store.invalidate();
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---- schema (IPC boundary) validation ----

const parseCreate = (v: unknown) => artifactCreateChannel.input.safeParse(v);

test('create schema: valid content artifact passes', () => {
  assert.equal(
    parseCreate({
      sessionId: 's',
      surface: 'partner',
      kind: 'markdown',
      title: 'T',
      content: '# x',
    }).success,
    true,
  );
  assert.equal(
    parseCreate({
      sessionId: 's',
      surface: 'partner',
      kind: 'interactive-html',
      title: 'Playable',
      content: '<canvas></canvas><script></script>',
    }).success,
    true,
  );
});

test('create schema: validates interactive-html permissions', () => {
  assert.equal(
    parseCreate({
      sessionId: 's',
      surface: 'partner',
      kind: 'interactive-html',
      title: 'Playable',
      content: '<script src="https://cdn.example.com/lib/v1.js"></script>',
      permissions: {
        connect: ['https://api.example.com'],
        style: ['https://styles.example.com'],
        img: ['https://images.example.com'],
        media: ['https://media.example.com'],
        font: ['https://fonts.example.com'],
        forms: ['https://forms.example.com'],
        scripts: [
          {
            url: 'https://cdn.example.com/lib/v1.js',
            integrity: 'sha384-AbCdEf0123456789+/=',
          },
        ],
        popups: 'confirm-external',
      },
    }).success,
    true,
  );

  assert.equal(
    parseCreate({
      sessionId: 's',
      surface: 'partner',
      kind: 'markdown',
      title: 'T',
      content: '# x',
      permissions: { connect: ['https://api.example.com'] },
    }).success,
    false,
  );
  assert.equal(
    parseCreate({
      sessionId: 's',
      surface: 'partner',
      kind: 'interactive-html',
      title: 'T',
      content: '<script></script>',
      permissions: { connect: ['http://api.example.com'] },
    }).success,
    false,
  );
  assert.equal(
    parseCreate({
      sessionId: 's',
      surface: 'partner',
      kind: 'interactive-html',
      title: 'T',
      content: '<script></script>',
      permissions: {
        scripts: [
          {
            url: 'https://cdn.example.com/lib.js?v=1',
            integrity: 'sha384-AbCdEf0123456789+/=',
          },
        ],
      },
    }).success,
    false,
  );
  assert.equal(
    parseCreate({
      sessionId: 's',
      surface: 'partner',
      kind: 'interactive-html',
      title: 'T',
      content: '<script></script>',
      permissions: {
        scripts: [{ url: 'https://cdn.example.com/lib.js', integrity: 'not-sri' }],
      },
    }).success,
    false,
  );
});

test('create schema: path-backed kind requires path, content kind requires content', () => {
  assert.equal(
    parseCreate({ sessionId: 's', surface: 'partner', kind: 'pdf', title: 'T' }).success,
    false,
  ); // pdf, no path
  assert.equal(
    parseCreate({ sessionId: 's', surface: 'partner', kind: 'pdf', title: 'T', path: '/p/a.pdf' })
      .success,
    true,
  );
  assert.equal(
    parseCreate({
      sessionId: 's',
      surface: 'partner',
      kind: 'pdf',
      title: 'T',
      path: '/p/a.pdf',
      content: 'x',
    }).success,
    false,
  );
  assert.equal(
    parseCreate({ sessionId: 's', surface: 'partner', kind: 'file', title: 'Movie', path: 'a.mp4' })
      .success,
    true,
  );
  assert.equal(
    parseCreate({ sessionId: 's', surface: 'partner', kind: 'file', title: 'Movie' }).success,
    false,
  );
  assert.equal(
    parseCreate({ sessionId: 's', surface: 'partner', kind: 'markdown', title: 'T' }).success,
    false,
  ); // md, no content
  assert.equal(
    parseCreate({
      sessionId: 's',
      surface: 'partner',
      kind: 'markdown',
      title: 'T',
      content: '# x',
      path: '/p/a.md',
    }).success,
    false,
  );
});

test('create schema: rejects NUL/CR/LF in path', () => {
  assert.equal(
    parseCreate({
      sessionId: 's',
      surface: 'partner',
      kind: 'pdf',
      title: 'T',
      path: `/p/a${String.fromCharCode(0)}.pdf`,
    }).success,
    false,
  );
  assert.equal(
    parseCreate({ sessionId: 's', surface: 'partner', kind: 'pdf', title: 'T', path: '/p/a\n.pdf' })
      .success,
    false,
  );
});

test('create schema: content cap is UTF-8 bytes (multibyte over byte budget rejected)', () => {
  // 600k '中' chars = 1.8 MB UTF-8 (>1 MB) but < 1,048,576 chars → byte refine must reject.
  const multibyte = '中'.repeat(600_000);
  assert.equal(
    parseCreate({
      sessionId: 's',
      surface: 'partner',
      kind: 'markdown',
      title: 'T',
      content: multibyte,
    }).success,
    false,
  );
});

test('concurrent upserts all land (write-lock serialization)', async () => {
  const { store, dir } = freshStore();
  try {
    await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        store.upsert({ ...base, title: `T${i}`, content: `c${i}` }),
      ),
    );
    assert.equal((await store.list()).length, 10);
  } finally {
    store.invalidate();
    rmSync(dir, { recursive: true, force: true });
  }
});
