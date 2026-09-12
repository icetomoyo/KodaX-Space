import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { rm } from 'node:fs/promises';

// data-paths 是无副作用的叶子模块,可以静态 import;真正会冻结数据目录的
// providers/config.js 等必须等下面 env 设好后动态 import(见 assertIsolatedTestHome)。
import { getKodaxDir } from '../kodax/data-paths.js';

const TEST_PROFILE = 'provider-credential-isolation';
const SHARED_ENV = 'SPACE_SHARED_PROVIDER_KEY';
const testHome = path.resolve(os.tmpdir(), `kodax-test-${TEST_PROFILE}`);

process.env.KODAX_TEST_ONBOARDING = TEST_PROFILE;
process.env.NODE_ENV = 'test';
delete process.env[SHARED_ENV];

const [
  { providerConfigStore },
  keychain,
  providerIpc,
  { runWithExactProviderCredential },
  { getDiagnosticRedactionOptions },
  { redactDiagnosticText },
] = await Promise.all([
  import('../providers/config.js'),
  import('../providers/keychain.js'),
  import('../ipc/provider.js'),
  import('../providers/credential-scope.js'),
  import('../diagnostics/runtime.js'),
  import('../diagnostics/redaction.js'),
]);

let providerA = '';
let providerB = '';

function assertIsolatedTestHome(): void {
  assert.equal(path.dirname(testHome), path.resolve(os.tmpdir()));
  assert.equal(path.basename(testHome), `kodax-test-${TEST_PROFILE}`);
  // 防"写穿":config.ts 等在模块求值时冻结数据目录。若 app 模块在本文件设置
  // KODAX_TEST_ONBOARDING 之前被(静态)import,getKodaxDir() 已缓存真实 ~/.kodax。
  assert.equal(path.resolve(getKodaxDir()), testHome);
}

before(async () => {
  assertIsolatedTestHome();
  await rm(testHome, { recursive: true, force: true });
  keychain._resetMemoryStoreForTesting();
  await providerConfigStore.load();
  providerA = await providerConfigStore.addCustom({
    displayName: 'Credential Isolation A',
    protocol: 'openai',
    baseUrl: 'https://provider-a.invalid/v1',
    apiKeyEnv: SHARED_ENV,
    defaultModel: 'model-a',
  });
  providerB = await providerConfigStore.addCustom({
    displayName: 'Credential Isolation B',
    protocol: 'openai',
    baseUrl: 'https://provider-b.invalid/v1',
    apiKeyEnv: SHARED_ENV,
    defaultModel: 'model-b',
  });
});

after(async () => {
  providerIpc._restoreManagedEnvsForTesting();
  delete process.env[SHARED_ENV];
  keychain._resetMemoryStoreForTesting();
  assertIsolatedTestHome();
  await rm(testHome, { recursive: true, force: true });
});

test('custom Providers never reuse another keychain account solely by apiKeyEnv', async () => {
  await keychain.setKey(providerA, 'credential-a');

  assert.equal(await providerIpc.readProviderCredential(providerB), undefined);
});

test('credential lease allowlists use known Provider identities without requiring a stored secret', async () => {
  const providerIds = await providerIpc.listKnownProviderIds();

  assert.ok(providerIds.includes(providerA));
  assert.ok(providerIds.includes(providerB));
});

test('a managed key for one custom Provider does not configure another custom Provider', () => {
  providerIpc._setManagedEnvForTesting(SHARED_ENV, 'credential-a');

  assert.equal(
    providerIpc._credentialSourceForTesting(providerB, SHARED_ENV, new Set([providerA])),
    'none',
  );
});

test('preparing an unconfigured custom Provider removes another Provider managed value', async () => {
  providerIpc._setManagedEnvForTesting(SHARED_ENV, 'credential-a');

  assert.equal(await providerIpc.ensureProviderKeyInjected(providerB), false);
  assert.equal(process.env[SHARED_ENV], undefined);
});

test('an explicit external env remains available to every Provider using that env name', async () => {
  providerIpc._restoreManagedEnvsForTesting();
  process.env[SHARED_ENV] = 'external-credential';
  providerIpc._setManagedEnvForTesting(SHARED_ENV, 'credential-a');

  assert.equal(await providerIpc.readProviderCredential(providerB), 'external-credential');
});

test('diagnostic redaction retains both the original external and current managed secrets', () => {
  providerIpc._restoreManagedEnvsForTesting();
  process.env[SHARED_ENV] = 'external-credential';
  providerIpc._setManagedEnvForTesting(SHARED_ENV, 'credential-a');

  const redacted = redactDiagnosticText(
    'external-credential and credential-a',
    getDiagnosticRedactionOptions(),
  );

  assert.doesNotMatch(redacted, /external-credential/);
  assert.doesNotMatch(redacted, /credential-a/);
});

test('a managed-only collision fails closed before the unrelated Provider operation starts', async () => {
  providerIpc._restoreManagedEnvsForTesting();
  delete process.env[SHARED_ENV];
  providerIpc._setManagedEnvForTesting(SHARED_ENV, 'credential-a');
  let operated = false;

  await assert.rejects(
    runWithExactProviderCredential(providerB, () => {
      operated = true;
      return 'unexpected';
    }),
    /no exact Space credential/i,
  );

  assert.equal(operated, false);
});

test('the explicit openai and codex-cli builtin alias remains compatible', async () => {
  await keychain.setKey('openai', 'openai-credential');

  assert.equal(await providerIpc.readProviderCredential('codex-cli'), 'openai-credential');
});

test('the explicit codex-cli and openai builtin alias is bidirectional', async () => {
  await keychain.deleteKey('openai');
  await keychain.setKey('codex-cli', 'codex-cli-credential');

  assert.equal(await providerIpc.readProviderCredential('openai'), 'codex-cli-credential');
});
