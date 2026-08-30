import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

import { resolveCredentialProviderIds } from '../providers/credentials.js';

test('Provider credential modules do not depend on IPC adapters', async () => {
  const [scopeSource, credentialSource, runtimeSource] = await Promise.all([
    readFile(new URL('../providers/credential-scope.ts', import.meta.url), 'utf8'),
    readFile(new URL('../providers/credentials.ts', import.meta.url), 'utf8'),
    readFile(new URL('../kodax/runtime-host-adapter.ts', import.meta.url), 'utf8'),
  ]);

  assert.doesNotMatch(scopeSource, /\.\.\/ipc\/provider/);
  assert.doesNotMatch(credentialSource, /\.\.\/ipc\//);
  assert.doesNotMatch(runtimeSource, /import\(['"]\.\.\/ipc\/provider/);
});

test('credential Provider allowlists are deduplicated and exclude unusable identities', async () => {
  assert.deepEqual(
    await resolveCredentialProviderIds('anthropic', async () => [
      'anthropic',
      'openai',
      'mock',
      ' ',
    ]),
    ['anthropic', 'openai'],
  );
});
