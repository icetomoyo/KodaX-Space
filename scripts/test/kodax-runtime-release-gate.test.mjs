import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { assertKodaxRuntimeReleaseContract } from '../kodax-runtime-release-gate.mjs';

test('release gate rejects a KodaX package without the integration resilience contract', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'space-kodax-release-gate-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(root, { recursive: true });
  await writeFile(
    path.join(root, 'package.json'),
    JSON.stringify({ name: '@kodax-ai/kodax', version: '0.7.77' }),
    'utf8',
  );

  assert.throws(() => assertKodaxRuntimeReleaseContract(root), /integrationConfigResilience v1/i);
});

test('release gate accepts an explicitly compatible KodaX package', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'space-kodax-release-gate-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(
    path.join(root, 'package.json'),
    JSON.stringify({
      name: '@kodax-ai/kodax',
      version: '0.7.78',
      kodaxRuntimeContracts: { integrationConfigResilience: 1 },
    }),
    'utf8',
  );

  assert.deepEqual(assertKodaxRuntimeReleaseContract(root), {
    version: '0.7.78',
    integrationConfigResilience: 1,
  });
});
