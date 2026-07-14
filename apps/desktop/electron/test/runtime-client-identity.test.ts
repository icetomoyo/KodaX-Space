import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { RuntimeClientIdentityStore } from '../kodax/runtime/runtime-client-identity.js';

async function tempStore(): Promise<{
  dir: string;
  file: string;
  store: RuntimeClientIdentityStore;
}> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'space-runtime-client-'));
  const file = path.join(dir, 'runtime-client-identity.json');
  return { dir, file, store: new RuntimeClientIdentityStore(file, dir) };
}

test('Runtime client identity persists clientId and rotates instanceId per process attachment', async (t) => {
  const { dir, file, store } = await tempStore();
  t.after(() => fs.rm(dir, { recursive: true, force: true }));

  const first = await store.openInstance({ name: 'KodaX Space', version: '0.1.32' });
  const second = await new RuntimeClientIdentityStore(file, dir).openInstance({
    name: 'KodaX Space',
    version: '0.1.32',
  });

  assert.match(first.clientId, /^space_[0-9a-f-]{36}$/);
  assert.equal(second.clientId, first.clientId);
  assert.notEqual(second.instanceId, first.instanceId);
  assert.equal(second.name, 'KodaX Space');
  assert.equal(second.version, '0.1.32');
});

test('concurrent first-start stores converge on the identity installed in the file', async (t) => {
  const { dir, file } = await tempStore();
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const a = new RuntimeClientIdentityStore(file, dir);
  const b = new RuntimeClientIdentityStore(file, dir);

  const [first, second] = await Promise.all([a.loadOrCreate(), b.loadOrCreate()]);
  const disk = JSON.parse(await fs.readFile(file, 'utf8')) as { clientId: string };

  assert.equal(first.clientId, disk.clientId);
  assert.equal(second.clientId, disk.clientId);
});

test('invalid regular identity files are replaced instead of inheriting malformed authority', async (t) => {
  const { dir, file, store } = await tempStore();
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  await fs.writeFile(file, JSON.stringify({ schemaVersion: 1, clientId: 'model-controlled' }));

  const identity = await store.loadOrCreate();
  const persisted = JSON.parse(await fs.readFile(file, 'utf8')) as { clientId: string };

  assert.match(identity.clientId, /^space_[0-9a-f-]{36}$/);
  assert.equal(persisted.clientId, identity.clientId);
});

test('identity store refuses symbolic-link targets', async (t) => {
  const { dir, file, store } = await tempStore();
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const target = path.join(dir, 'attacker.json');
  await fs.writeFile(
    target,
    JSON.stringify({
      schemaVersion: 1,
      clientId: `space_${randomUUID()}`,
      createdAt: 1,
    }),
  );
  try {
    await fs.symlink(target, file, 'file');
  } catch (error) {
    if (process.platform === 'win32') {
      t.skip(`symlink unavailable on this Windows environment: ${String(error)}`);
      return;
    }
    throw error;
  }

  await assert.rejects(() => store.loadOrCreate(), /symbolic link/i);
});

test('callers cannot mutate the cached stable Runtime client identity', async (t) => {
  const { dir, store } = await tempStore();
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const identity = await store.loadOrCreate();

  assert.throws(() => {
    (identity as { clientId: string }).clientId = 'space_attacker';
  });
  assert.equal((await store.loadOrCreate()).clientId, identity.clientId);
});
