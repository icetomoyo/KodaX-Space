import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  PartnerEffectiveConfigStore,
  type PartnerEffectiveConfigSeed,
} from '../kodax/runtime/partner-effective-config-store.js';

const SEED: PartnerEffectiveConfigSeed = {
  providerId: 'anthropic',
  model: 'claude-sonnet',
  reasoningMode: 'balanced',
  permissionMode: 'accept-edits',
  autoModeEngine: 'llm',
  agentMode: 'ama',
  toolPolicyId: 'partner-inline-v1',
};

async function fixture(): Promise<{
  dir: string;
  file: string;
  backup: string;
  store: PartnerEffectiveConfigStore;
}> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'space-partner-config-'));
  const file = path.join(dir, 'partner-effective-config.json');
  const backup = path.join(dir, 'partner-effective-config.last-known-good.json');
  return { dir, file, backup, store: new PartnerEffectiveConfigStore(file, backup) };
}

test('Partner effective config seeds a strictly Partner-owned revisioned snapshot', async (t) => {
  const { dir, file, store } = await fixture();
  t.after(() => fs.rm(dir, { recursive: true, force: true }));

  const loaded = await store.loadOrSeed(SEED);
  const disk = JSON.parse(await fs.readFile(file, 'utf8')) as Record<string, unknown>;

  assert.equal(loaded.status, 'seeded');
  assert.equal(loaded.snapshot.revision, 1);
  assert.equal(loaded.snapshot.surface, 'partner');
  assert.equal(loaded.snapshot.profileId, 'kodax-space.partner');
  assert.deepEqual(loaded.snapshot.effective, SEED);
  assert.equal(disk.surface, 'partner');
  assert.equal('runtimeId' in disk, false);
});

test('updates use revision CAS and preserve the previous snapshot as last known good', async (t) => {
  const { dir, backup, store } = await fixture();
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const initial = await store.loadOrSeed(SEED);

  const updated = await store.update(initial.snapshot.revision, (effective) => ({
    ...effective,
    model: 'claude-opus',
  }));
  const previous = JSON.parse(await fs.readFile(backup, 'utf8')) as {
    revision: number;
    effective: { model?: string };
  };

  assert.equal(updated.revision, 2);
  assert.equal(updated.effective.model, 'claude-opus');
  assert.equal(previous.revision, 1);
  assert.equal(previous.effective.model, 'claude-sonnet');
  await assert.rejects(() => store.update(1, (effective) => effective), /revision conflict/i);
});

test('a corrupt primary loads last known good read-only until explicit repair', async (t) => {
  const { dir, file, store } = await fixture();
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const initial = await store.loadOrSeed(SEED);
  await store.update(initial.snapshot.revision, (effective) => ({ ...effective, model: 'new' }));
  await fs.writeFile(file, '{corrupt');

  const recoveredStore = new PartnerEffectiveConfigStore(
    file,
    path.join(dir, 'partner-effective-config.last-known-good.json'),
  );
  const recovered = await recoveredStore.loadOrSeed(SEED);

  assert.equal(recovered.status, 'recovered-read-only');
  assert.equal(recovered.snapshot.revision, 1);
  assert.match(recovered.reason ?? '', /primary/i);
  await assert.rejects(
    () => recoveredStore.update(recovered.snapshot.revision, (effective) => effective),
    /repair/i,
  );

  const repaired = await recoveredStore.repairFromLastKnownGood();
  assert.equal(repaired.revision, 1);
  const afterRepair = await recoveredStore.update(repaired.revision, (effective) => ({
    ...effective,
    model: 'after-repair',
  }));
  assert.equal(afterRepair.revision, 2);
});

test('an invalid primary cannot silently fall back to a new seed when no recovery exists', async (t) => {
  const { dir, file, store } = await fixture();
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  await fs.writeFile(file, JSON.stringify({ surface: 'code', revision: 99 }));

  await assert.rejects(() => store.loadOrSeed(SEED), /invalid.*no last-known-good/i);
});

test('a valid primary repairs an invalid last-known-good recovery copy', async (t) => {
  const { dir, backup, store } = await fixture();
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  await store.loadOrSeed(SEED);
  await fs.writeFile(backup, '{corrupt');

  const reloaded = await new PartnerEffectiveConfigStore(
    path.join(dir, 'partner-effective-config.json'),
    backup,
  ).loadOrSeed(SEED);
  const repairedBackup = JSON.parse(await fs.readFile(backup, 'utf8')) as {
    revision: number;
  };

  assert.equal(reloaded.status, 'healthy');
  assert.equal(repairedBackup.revision, reloaded.snapshot.revision);
});

test('cross-process stale revisions cannot overwrite a newer Partner config', async (t) => {
  const { dir, file, backup } = await fixture();
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const first = new PartnerEffectiveConfigStore(file, backup);
  const second = new PartnerEffectiveConfigStore(file, backup);
  const [a, b] = await Promise.all([first.loadOrSeed(SEED), second.loadOrSeed(SEED)]);

  await first.update(a.snapshot.revision, (effective) => ({ ...effective, model: 'newer' }));
  await assert.rejects(
    () => second.update(b.snapshot.revision, (effective) => ({ ...effective, model: 'stale' })),
    /revision conflict/i,
  );

  const disk = JSON.parse(await fs.readFile(file, 'utf8')) as {
    revision: number;
    effective: { model?: string };
  };
  assert.equal(disk.revision, 2);
  assert.equal(disk.effective.model, 'newer');
});

test('callers cannot mutate a cached Partner config snapshot outside revision CAS', async (t) => {
  const { dir, store } = await fixture();
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const loaded = await store.loadOrSeed(SEED);

  assert.throws(() => {
    (loaded.snapshot.effective as { model?: string }).model = 'injected';
  });
  assert.equal((await store.loadOrSeed(SEED)).snapshot.effective.model, 'claude-sonnet');
});
