import assert from 'node:assert/strict';
import { test } from 'node:test';

import { getScopedProviderCredential, runWithProviderCredential } from '@kodax-ai/kodax/llm';
import { runWithExactProviderCredential } from '../providers/credential-scope.js';

test('an exact Space credential remains scoped across asynchronous work', async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });

  const operation = runWithExactProviderCredential(
    'provider-a',
    async () => {
      await gate;
      return getScopedProviderCredential('provider-a');
    },
    {
      readProviderCredential: async () => 'credential-a',
      runWithProviderCredential,
    },
  );
  release();

  assert.equal(await operation, 'credential-a');
  assert.equal(getScopedProviderCredential('provider-a'), undefined);
});

test('keychain credential wins and remains scoped when a real external env also exists', async () => {
  const calls: string[] = [];
  const result = await runWithExactProviderCredential(
    'anthropic',
    () => {
      calls.push('operation');
      return 'done';
    },
    {
      readProviderCredential: async () => 'keychain-secret',
      runWithProviderCredential: (provider, credential, operation) => {
        calls.push(`${provider}:${credential}`);
        return operation();
      },
    },
  );

  assert.equal(result, 'done');
  assert.deepEqual(calls, ['anthropic:keychain-secret', 'operation']);
});

test('a detached workflow-style done chain keeps the scope after its handle is returned', async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });

  const handle = await runWithExactProviderCredential(
    'provider-a',
    () => ({
      done: (async () => {
        await gate;
        return getScopedProviderCredential('provider-a');
      })(),
    }),
    {
      readProviderCredential: async () => 'credential-a',
      runWithProviderCredential,
    },
  );
  release();

  assert.equal(await handle.done, 'credential-a');
});

test('an absent exact credential fails closed before the Provider operation starts', async () => {
  let operated = false;
  await assert.rejects(
    runWithExactProviderCredential(
      'provider-a',
      () => {
        operated = true;
        return 'missing-path';
      },
      {
        readProviderCredential: async () => undefined,
        runWithProviderCredential,
      },
    ),
    /no exact Space credential/i,
  );

  assert.equal(operated, false);
});

test('an external env credential is exact-scoped for the full asynchronous operation', async () => {
  const calls: string[] = [];
  const value = await runWithExactProviderCredential('provider-a', () => 'external-env-path', {
    readProviderCredential: async () => 'external-credential',
    runWithProviderCredential: (provider, credential, operation) => {
      calls.push(`${provider}:${credential}`);
      return operation();
    },
  });

  assert.equal(value, 'external-env-path');
  assert.deepEqual(calls, ['provider-a:external-credential']);
});

test('an external env credential is scoped when Space currently manages the same env name', async () => {
  const calls: string[] = [];
  const value = await runWithExactProviderCredential('provider-b', () => 'external-env-path', {
    readProviderCredential: async () => 'external-credential-b',
    runWithProviderCredential: (provider, credential, operation) => {
      calls.push(`${provider}:${credential}`);
      return operation();
    },
  });

  assert.equal(value, 'external-env-path');
  assert.deepEqual(calls, ['provider-b:external-credential-b']);
});
