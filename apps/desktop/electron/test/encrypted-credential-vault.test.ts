import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  CredentialVaultCorruptError,
  EncryptedCredentialVault,
  type CredentialVaultCipher,
} from '../providers/encrypted-credential-vault.js';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

async function fixture(options?: { readonly rotate?: boolean }) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'kodax-provider-vault-'));
  tempDirs.push(dir);
  let encryptCalls = 0;
  let decryptCalls = 0;
  const cipher: CredentialVaultCipher = {
    async encrypt(plainText) {
      encryptCalls += 1;
      return Buffer.from(`encrypted:${plainText}`, 'utf8');
    },
    async decrypt(encrypted) {
      decryptCalls += 1;
      const value = encrypted.toString('utf8');
      assert.match(value, /^encrypted:/);
      return {
        result: value.slice('encrypted:'.length),
        shouldReEncrypt: options?.rotate === true,
      };
    },
  };
  const filePath = path.join(dir, 'provider-credentials.v1.json');
  return {
    filePath,
    vault: new EncryptedCredentialVault(filePath, cipher),
    calls: () => ({ encryptCalls, decryptCalls }),
  };
}

test('stores ciphertext only and restores Provider secrets', async () => {
  const { filePath, vault } = await fixture();
  await vault.set('anthropic', 'sk-secret-value');

  const persisted = await fs.readFile(filePath, 'utf8');
  assert.doesNotMatch(persisted, /sk-secret-value/);
  assert.deepEqual(await vault.listAccounts(), ['anthropic']);
  assert.equal(await vault.get('anthropic'), 'sk-secret-value');
});

test('listing and deleting records never decrypts their secrets', async () => {
  const { vault, calls } = await fixture();
  await vault.set('anthropic', 'sk-a');
  await vault.set('openai', 'sk-b');

  assert.deepEqual([...(await vault.listAccounts())].sort(), ['anthropic', 'openai']);
  assert.equal(await vault.delete('anthropic'), true);
  assert.equal(calls().decryptCalls, 0);
  assert.equal(await vault.has('anthropic'), false);
  assert.equal(await vault.isLegacyRevoked('anthropic'), true);
  assert.equal(await vault.get('anthropic'), undefined);
  assert.equal(calls().decryptCalls, 0);
});

test('saving a replacement clears its legacy revocation tombstone', async () => {
  const { vault } = await fixture();
  assert.equal(await vault.delete('kimi-code'), false);
  assert.equal(await vault.isLegacyRevoked('kimi-code'), true);

  await vault.set('kimi-code', 'replacement');
  assert.equal(await vault.isLegacyRevoked('kimi-code'), false);
  assert.equal(await vault.get('kimi-code'), 'replacement');
});

test('serializes concurrent writes without losing Provider records', async () => {
  const { vault } = await fixture();
  await Promise.all([
    vault.set('anthropic', 'a'),
    vault.set('openai', 'b'),
    vault.set('gemini', 'c'),
  ]);
  assert.deepEqual([...(await vault.listAccounts())].sort(), ['anthropic', 'gemini', 'openai']);
});

test('rotates ciphertext after a decryptor requests re-encryption', async () => {
  const { vault, calls } = await fixture({ rotate: true });
  await vault.set('anthropic', 'a');
  assert.equal(calls().encryptCalls, 1);

  assert.equal(await vault.get('anthropic'), 'a');
  assert.equal(calls().decryptCalls, 1);
  assert.equal(calls().encryptCalls, 2);
});

test('fails closed without overwriting a corrupt credential vault', async () => {
  const { filePath, vault } = await fixture();
  await fs.writeFile(filePath, '{"version":1,"records":{"anthropic":"not base64"}}', 'utf8');

  await assert.rejects(() => vault.listAccounts(), CredentialVaultCorruptError);
  await assert.rejects(
    () => vault.set('openai', 'must-not-overwrite'),
    CredentialVaultCorruptError,
  );
  assert.match(await fs.readFile(filePath, 'utf8'), /not base64/);
});
