import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { cleanupRuntimeClientCredentialForTestProfile } from '../runtime-test-credential-cleanup.mjs';

const TEST_ACCOUNT = 'runtime_client_00000000-0000-4000-8000-000000000132';

async function writeIdentity(profileDir, account = TEST_ACCOUNT) {
  const spaceDir = path.join(profileDir, 'space');
  await fs.mkdir(spaceDir, { recursive: true });
  await fs.writeFile(
    path.join(spaceDir, 'runtime-client-identity.json'),
    JSON.stringify({ secretAccount: account }),
    'utf8',
  );
}

test('runtime test credential cleanup deletes only the account owned by an isolated test profile', async (t) => {
  const profileDir = await fs.mkdtemp(path.join(os.tmpdir(), 'kodax-test-credential-cleanup-'));
  t.after(() => fs.rm(profileDir, { recursive: true, force: true }));
  await writeIdentity(profileDir);
  const calls = [];

  const result = await cleanupRuntimeClientCredentialForTestProfile(profileDir, {
    deletePassword: async (service, account) => {
      calls.push({ service, account });
      return true;
    },
  });

  assert.deepEqual(result, { cleaned: true, account: TEST_ACCOUNT });
  assert.deepEqual(calls, [{ service: 'kodax-space', account: TEST_ACCOUNT }]);
});

test('runtime test credential cleanup rejects production paths and non-runtime accounts', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'space-credential-cleanup-'));
  const testProfile = await fs.mkdtemp(path.join(os.tmpdir(), 'kodax-test-credential-cleanup-'));
  t.after(async () => {
    await Promise.all([
      fs.rm(root, { recursive: true, force: true }),
      fs.rm(testProfile, { recursive: true, force: true }),
    ]);
  });
  await writeIdentity(root);
  await writeIdentity(testProfile, 'anthropic');
  let deletes = 0;
  const options = {
    deletePassword: async () => {
      deletes += 1;
      return true;
    },
  };

  assert.deepEqual(await cleanupRuntimeClientCredentialForTestProfile(root, options), {
    cleaned: false,
    reason: 'not_found_or_not_test_profile',
  });
  assert.deepEqual(await cleanupRuntimeClientCredentialForTestProfile(testProfile, options), {
    cleaned: false,
    reason: 'not_found_or_not_test_profile',
  });
  assert.equal(deletes, 0);
});
