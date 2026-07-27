import assert from 'node:assert/strict';
import test from 'node:test';

import type { CustomProvider } from '../providers/config.js';
import {
  addSpaceCustomProvider,
  CustomProviderMutationQueue,
  removeSpaceCustomProvider,
  updateSpaceCustomProvider,
  type CustomProviderMutationDependencies,
  type EditableCustomProvider,
} from '../providers/custom-provider-mutations.js';
import type { RuntimeCustomProviderDeletion } from '../providers/runtime-catalog.js';

const PROVIDER_ID = 'custom_0000000000000001';

function editable(displayName = 'Ollama'): EditableCustomProvider {
  return {
    displayName,
    protocol: 'openai',
    baseUrl: 'http://127.0.0.1:11434/v1',
    skipBaseUrlValidation: true,
    apiKeyEnv: 'OLLAMA_API_KEY',
    defaultModel: 'ornith:35b',
    models: ['ornith:35b'],
    contextWindow: 131_072,
  };
}

function saved(provider: EditableCustomProvider): CustomProvider {
  return { id: PROVIDER_ID, createdAt: 1, ...provider };
}

function fakeDependencies(initial?: CustomProvider) {
  const providers = new Map<string, CustomProvider>();
  if (initial) providers.set(initial.id, structuredClone(initial));
  const calls: string[] = [];
  let runtimeUpsertError: Error | undefined;
  let storeRemoveError: Error | undefined;
  let storeRollbackUpdateError: Error | undefined;
  let runtimeRestoreError: Error | undefined;
  let updateCalls = 0;

  const deletion: RuntimeCustomProviderDeletion = {
    runtimeSelected: true,
    deleted: true,
    previous: {
      name: PROVIDER_ID,
      protocol: 'openai',
      baseUrl: 'https://runtime-before.example/v1',
      apiKeyEnv: 'OLD_KEY',
      model: 'old',
      replayReasoningContent: true,
    },
  };

  const dependencies: CustomProviderMutationDependencies = {
    store: {
      addCustom: async (provider) => {
        calls.push('store.add');
        providers.set(PROVIDER_ID, saved(provider));
        return PROVIDER_ID;
      },
      getCustom: (id) => {
        const provider = providers.get(id);
        return provider ? structuredClone(provider) : undefined;
      },
      updateCustom: async (id, provider) => {
        calls.push('store.update');
        updateCalls += 1;
        if (updateCalls > 1 && storeRollbackUpdateError) throw storeRollbackUpdateError;
        const existing = providers.get(id);
        if (!existing) return false;
        providers.set(id, { ...existing, ...structuredClone(provider), id, createdAt: existing.createdAt });
        return true;
      },
      removeCustom: async (id) => {
        calls.push('store.remove');
        if (storeRemoveError) throw storeRemoveError;
        return providers.delete(id);
      },
    },
    runtime: {
      upsert: async () => {
        calls.push('runtime.upsert');
        if (runtimeUpsertError) throw runtimeUpsertError;
      },
      delete: async () => {
        calls.push('runtime.delete');
        return structuredClone(deletion);
      },
      restoreDeleted: async (receipt) => {
        calls.push('runtime.restore');
        assert.deepEqual(receipt, deletion);
        if (runtimeRestoreError) throw runtimeRestoreError;
      },
    },
  };

  return {
    dependencies,
    providers,
    calls,
    failRuntimeUpsert(error: Error) {
      runtimeUpsertError = error;
    },
    failStoreRemove(error: Error) {
      storeRemoveError = error;
    },
    failStoreRollbackUpdate(error: Error) {
      storeRollbackUpdateError = error;
    },
    failRuntimeRestore(error: Error) {
      runtimeRestoreError = error;
    },
  };
}

test('add rolls the Space record back when Runtime catalog synchronization fails', async () => {
  const fake = fakeDependencies();
  fake.failRuntimeUpsert(new Error('runtime unavailable'));

  await assert.rejects(addSpaceCustomProvider(editable(), fake.dependencies), /runtime unavailable/);

  assert.equal(fake.providers.has(PROVIDER_ID), false);
  assert.deepEqual(fake.calls, ['store.add', 'runtime.upsert', 'store.remove']);
});

test('update restores the previous Space record when Runtime rejects the new record', async () => {
  const original = saved(editable('Before'));
  const fake = fakeDependencies(original);
  fake.failRuntimeUpsert(new Error('runtime rejected update'));

  await assert.rejects(
    updateSpaceCustomProvider(PROVIDER_ID, editable('After'), fake.dependencies),
    /runtime rejected update/,
  );

  assert.equal(fake.providers.get(PROVIDER_ID)?.displayName, 'Before');
  assert.deepEqual(fake.calls, ['store.update', 'runtime.upsert', 'store.update']);
});

test('update reports both Runtime and Space rollback failures', async () => {
  const fake = fakeDependencies(saved(editable('Before')));
  fake.failRuntimeUpsert(new Error('runtime rejected update'));
  fake.failStoreRollbackUpdate(new Error('disk rollback failed'));

  await assert.rejects(
    updateSpaceCustomProvider(PROVIDER_ID, editable('After'), fake.dependencies),
    (error: unknown) => {
      assert.ok(error instanceof AggregateError);
      assert.equal(error.errors.length, 2);
      assert.match(error.message, /could not be restored/);
      return true;
    },
  );
});

test('remove restores the exact Runtime deletion snapshot when Space persistence fails', async () => {
  const fake = fakeDependencies(saved(editable()));
  fake.failStoreRemove(new Error('Space disk write failed'));

  await assert.rejects(
    removeSpaceCustomProvider(PROVIDER_ID, fake.dependencies),
    /Space disk write failed/,
  );

  assert.equal(fake.providers.has(PROVIDER_ID), true);
  assert.deepEqual(fake.calls, ['runtime.delete', 'store.remove', 'runtime.restore']);
});

test('remove reports both store and Runtime rollback failures', async () => {
  const fake = fakeDependencies(saved(editable()));
  fake.failStoreRemove(new Error('Space disk write failed'));
  fake.failRuntimeRestore(new Error('Runtime restore failed'));

  await assert.rejects(
    removeSpaceCustomProvider(PROVIDER_ID, fake.dependencies),
    (error: unknown) => {
      assert.ok(error instanceof AggregateError);
      assert.equal(error.errors.length, 2);
      return true;
    },
  );
});

test('mutation queue serializes operations and continues after a rejection', async () => {
  const queue = new CustomProviderMutationQueue();
  const events: string[] = [];
  let releaseFirst!: () => void;
  const firstGate = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });

  const first = queue.run(async () => {
    events.push('first:start');
    await firstGate;
    events.push('first:end');
    throw new Error('expected first failure');
  });
  const second = queue.run(async () => {
    events.push('second');
    return 2;
  });

  await Promise.resolve();
  assert.deepEqual(events, ['first:start']);
  releaseFirst();
  await assert.rejects(first, /expected first failure/);
  assert.equal(await second, 2);
  assert.deepEqual(events, ['first:start', 'first:end', 'second']);
});
