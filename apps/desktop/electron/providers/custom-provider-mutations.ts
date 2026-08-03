import { providerConfigStore, type CustomProvider } from './config.js';
import {
  deleteSpaceCustomProviderFromRuntime,
  restoreDeletedSpaceCustomProviderInRuntime,
  upsertSpaceCustomProviderInRuntime,
  type RuntimeCustomProviderDeletion,
} from './runtime-catalog.js';

export type EditableCustomProvider = Omit<CustomProvider, 'id' | 'createdAt'>;

export interface CustomProviderMutationStore {
  readonly addCustom: (provider: EditableCustomProvider) => Promise<string>;
  readonly getCustom: (id: string) => CustomProvider | undefined;
  readonly updateCustom: (id: string, provider: EditableCustomProvider) => Promise<boolean>;
  readonly removeCustom: (id: string) => Promise<boolean>;
}

export interface CustomProviderMutationRuntime {
  readonly upsert: (provider: CustomProvider) => Promise<void>;
  readonly delete: (providerId: string) => Promise<RuntimeCustomProviderDeletion>;
  readonly restoreDeleted: (
    deletion: RuntimeCustomProviderDeletion,
    provider: CustomProvider,
  ) => Promise<void>;
}

export interface CustomProviderMutationDependencies {
  readonly store: CustomProviderMutationStore;
  readonly runtime: CustomProviderMutationRuntime;
}

const DEFAULT_DEPENDENCIES: CustomProviderMutationDependencies = {
  store: providerConfigStore,
  runtime: {
    upsert: upsertSpaceCustomProviderInRuntime,
    delete: deleteSpaceCustomProviderFromRuntime,
    restoreDeleted: restoreDeletedSpaceCustomProviderInRuntime,
  },
};

export class CustomProviderMutationQueue {
  private tail: Promise<void> = Promise.resolve();

  run<T>(mutation: () => Promise<T>): Promise<T> {
    const result = this.tail.then(mutation, mutation);
    this.tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}

/** One process-wide ordering boundary for startup reconciliation and UI mutations. */
export const customProviderMutationQueue = new CustomProviderMutationQueue();

function editableCustomProvider(provider: CustomProvider): EditableCustomProvider {
  const { id: _id, createdAt: _createdAt, ...editable } = provider;
  return editable;
}

function rollbackFailure(
  message: string,
  operationError: unknown,
  rollbackErrors: readonly unknown[],
): AggregateError {
  return new AggregateError([operationError, ...rollbackErrors], message);
}

export async function addSpaceCustomProvider(
  provider: EditableCustomProvider,
  dependencies: CustomProviderMutationDependencies = DEFAULT_DEPENDENCIES,
): Promise<string> {
  const id = await dependencies.store.addCustom(provider);
  const saved = dependencies.store.getCustom(id);
  if (!saved) {
    throw new Error('custom provider was not readable after it was saved');
  }

  try {
    await dependencies.runtime.upsert(saved);
  } catch (runtimeError) {
    const rollbackErrors: unknown[] = [];
    try {
      if (!(await dependencies.store.removeCustom(id))) {
        rollbackErrors.push(new Error('Space provider rollback target disappeared'));
      }
    } catch (error) {
      rollbackErrors.push(error);
    }
    if (rollbackErrors.length > 0) {
      throw rollbackFailure(
        `KodaX Runtime catalog sync failed and the Space provider ${id} could not be removed`,
        runtimeError,
        rollbackErrors,
      );
    }
    throw runtimeError;
  }

  return id;
}

export async function updateSpaceCustomProvider(
  providerId: string,
  update: EditableCustomProvider,
  dependencies: CustomProviderMutationDependencies = DEFAULT_DEPENDENCIES,
): Promise<boolean> {
  const previous = dependencies.store.getCustom(providerId);
  if (!previous) return false;
  if (!(await dependencies.store.updateCustom(providerId, update))) return false;

  const current = dependencies.store.getCustom(providerId);
  if (!current) {
    throw new Error('custom provider was not readable after it was updated');
  }

  try {
    await dependencies.runtime.upsert(current);
  } catch (runtimeError) {
    const rollbackErrors: unknown[] = [];
    try {
      if (!(await dependencies.store.updateCustom(providerId, editableCustomProvider(previous)))) {
        rollbackErrors.push(new Error('Space provider rollback target disappeared'));
      }
    } catch (error) {
      rollbackErrors.push(error);
    }
    if (rollbackErrors.length > 0) {
      throw rollbackFailure(
        `KodaX Runtime catalog sync failed and the Space provider ${providerId} could not be restored`,
        runtimeError,
        rollbackErrors,
      );
    }
    throw runtimeError;
  }

  return true;
}

export async function removeSpaceCustomProvider(
  providerId: string,
  dependencies: CustomProviderMutationDependencies = DEFAULT_DEPENDENCIES,
): Promise<boolean> {
  const provider = dependencies.store.getCustom(providerId);
  if (!provider) return false;

  const deletion = await dependencies.runtime.delete(providerId);
  try {
    if (!(await dependencies.store.removeCustom(providerId))) {
      throw new Error('Space provider disappeared during removal');
    }
  } catch (storeError) {
    try {
      await dependencies.runtime.restoreDeleted(deletion, provider);
    } catch (runtimeRollbackError) {
      throw rollbackFailure(
        `custom provider ${providerId} could not be removed from Space or restored in Runtime`,
        storeError,
        [runtimeRollbackError],
      );
    }
    throw storeError;
  }

  return true;
}
