import type { SdkCustomProviderConfig, SpaceCustomProviderForSdk } from '../kodax/user-config.js';
import {
  mergeSdkCustomProviderConfig,
  normalizeSpaceCustomProviderForSdk,
} from '../kodax/user-config.js';
import { runtimeHostAdapter } from '../kodax/runtime-host-adapter.js';

export interface RuntimeCustomProviderCatalogClient {
  readonly isRuntimeSelected: () => boolean;
  readonly listRuntimeCustomProviders: () => Promise<readonly SdkCustomProviderConfig[]>;
  readonly upsertRuntimeCustomProvider: (
    config: SdkCustomProviderConfig,
  ) => Promise<SdkCustomProviderConfig>;
  readonly deleteRuntimeCustomProvider: (name: string) => Promise<boolean>;
}

export interface RuntimeCustomProviderDeletion {
  readonly runtimeSelected: boolean;
  readonly deleted: boolean;
  readonly previous?: SdkCustomProviderConfig;
}

function providerName(provider: SdkCustomProviderConfig): string | undefined {
  const name = (provider as unknown as { readonly name?: unknown }).name;
  return typeof name === 'string' ? name : undefined;
}

function cloneConfig(config: SdkCustomProviderConfig): SdkCustomProviderConfig {
  return structuredClone(config);
}

function runtimeConfigFor(provider: SpaceCustomProviderForSdk): SdkCustomProviderConfig {
  const config = normalizeSpaceCustomProviderForSdk(provider);
  if (!config) {
    throw new Error(`custom provider ${provider.id} is not valid for the KodaX Runtime catalog`);
  }
  return config;
}

async function findRuntimeProvider(
  providerId: string,
  client: RuntimeCustomProviderCatalogClient,
): Promise<SdkCustomProviderConfig | undefined> {
  const providers = await client.listRuntimeCustomProviders();
  const existing = providers.find((provider) => providerName(provider) === providerId);
  return existing ? cloneConfig(existing) : undefined;
}

async function restoreRuntimeProviderSnapshot(
  providerId: string,
  previous: SdkCustomProviderConfig | undefined,
  client: RuntimeCustomProviderCatalogClient,
): Promise<void> {
  if (previous) {
    await client.upsertRuntimeCustomProvider(previous);
    return;
  }
  await client.deleteRuntimeCustomProvider(providerId);
}

export async function upsertSpaceCustomProviderInRuntime(
  provider: SpaceCustomProviderForSdk,
  client: RuntimeCustomProviderCatalogClient = runtimeHostAdapter,
): Promise<void> {
  if (!client.isRuntimeSelected()) return;

  const previous = await findRuntimeProvider(provider.id, client);
  const next = mergeSdkCustomProviderConfig(previous, runtimeConfigFor(provider));
  try {
    await client.upsertRuntimeCustomProvider(next);
  } catch (writeError) {
    try {
      await restoreRuntimeProviderSnapshot(provider.id, previous, client);
    } catch (rollbackError) {
      throw new AggregateError(
        [writeError, rollbackError],
        `failed to update Runtime custom provider ${provider.id} and restore its previous catalog entry`,
      );
    }
    throw writeError;
  }
}

export async function deleteSpaceCustomProviderFromRuntime(
  providerId: string,
  client: RuntimeCustomProviderCatalogClient = runtimeHostAdapter,
): Promise<RuntimeCustomProviderDeletion> {
  if (!client.isRuntimeSelected()) {
    return { runtimeSelected: false, deleted: false };
  }

  const previous = await findRuntimeProvider(providerId, client);
  try {
    const deleted = await client.deleteRuntimeCustomProvider(providerId);
    return {
      runtimeSelected: true,
      deleted,
      ...(previous ? { previous } : {}),
    };
  } catch (deleteError) {
    if (!previous) throw deleteError;
    try {
      await client.upsertRuntimeCustomProvider(previous);
    } catch (rollbackError) {
      throw new AggregateError(
        [deleteError, rollbackError],
        `failed to delete Runtime custom provider ${providerId} and restore its catalog entry`,
      );
    }
    throw deleteError;
  }
}

export async function restoreDeletedSpaceCustomProviderInRuntime(
  deletion: RuntimeCustomProviderDeletion,
  fallback: SpaceCustomProviderForSdk,
  client: RuntimeCustomProviderCatalogClient = runtimeHostAdapter,
): Promise<void> {
  if (!deletion.runtimeSelected) return;
  if (deletion.previous) {
    await client.upsertRuntimeCustomProvider(deletion.previous);
    return;
  }
  await client.upsertRuntimeCustomProvider(runtimeConfigFor(fallback));
}

/**
 * Reconcile every Space-owned provider into the connected daemon catalog.
 *
 * This is intentionally sequential: each Runtime catalog mutation persists the
 * shared KodaX config, so parallel read/modify/write requests could otherwise
 * overwrite one another.
 */
export async function syncSpaceCustomProvidersToRuntime(
  providers: readonly SpaceCustomProviderForSdk[],
  client: RuntimeCustomProviderCatalogClient = runtimeHostAdapter,
): Promise<void> {
  if (!client.isRuntimeSelected()) return;

  const failures: Array<{ readonly providerId: string; readonly error: unknown }> = [];
  for (const provider of providers) {
    try {
      await upsertSpaceCustomProviderInRuntime(provider, client);
    } catch (error) {
      failures.push({ providerId: provider.id, error });
    }
  }

  if (failures.length > 0) {
    const providerIds = failures.map((failure) => failure.providerId).join(', ');
    throw new AggregateError(
      failures.map((failure) => failure.error),
      `failed to synchronize ${failures.length} custom provider(s) to the KodaX Runtime catalog: ${providerIds}`,
    );
  }
}
