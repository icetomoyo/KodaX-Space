// Provider tests stay in memory. Real Runtime tests persist their client secret
// in a separate native keyring namespace and remove their exact owned entry.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

process.env.KODAX_TEST_ONBOARDING = 'keychain-isolation';

const { getBackendStatus, setKey, getKey, _resetMemoryStoreForTesting } =
  await import('../providers/keychain.js');
const { RuntimeClientIdentityStore } = await import('../kodax/runtime/runtime-client-identity.js');

test('test mode keeps Provider credentials in memory', async () => {
  assert.equal(await getBackendStatus(), 'memory');
});

test(
  'test Runtime identities persist separately while Provider credentials stay in memory',
  {
    skip: process.platform !== 'win32',
  },
  async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'kodax-test-runtime-keychain-'));
    const file = path.join(dir, 'runtime-client-identity.json');
    const keyring = await import('@napi-rs/keyring/keytar.js');
    let account: string | undefined;
    try {
      await setKey('anthropic', 'test-provider-only');
      const first = await new RuntimeClientIdentityStore(file, dir, randomUUID).openInstance({
        name: 'isolated-test',
        version: 'test',
      });
      account = (JSON.parse(await readFile(file, 'utf8')) as { secretAccount: string })
        .secretAccount;
      assert.ok(
        (await keyring.getPassword('kodax-space-test-runtime', account)) === first.instanceSecret,
      );
      assert.equal(await keyring.getPassword('kodax-space', account), null);
      _resetMemoryStoreForTesting();
      assert.equal(await getKey('anthropic'), undefined);
      const reopened = await new RuntimeClientIdentityStore(file, dir, randomUUID).openInstance({
        name: 'isolated-test',
        version: 'test',
      });
      assert.ok(reopened.instanceSecret === first.instanceSecret);
      assert.equal(reopened.instanceId, first.instanceId);
      assert.equal(await getBackendStatus(), 'memory');
    } finally {
      if (account) await keyring.deletePassword('kodax-space-test-runtime', account);
      await rm(dir, { recursive: true, force: true });
    }
  },
);
