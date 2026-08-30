import type { ProviderInfo } from '@kodax-space/space-ipc-schema';

import { loadKodaxCustomProviders } from '../kodax/user-config.js';
import { BUILTIN_PROVIDERS, getBuiltin, isBuiltinId } from './catalog.js';
import { providerConfigStore } from './config.js';
import { validateApiKeyEnv } from './env-guard.js';
import { getKey, hasKey } from './keychain.js';
import {
  externalProviderEnvValue,
  restoreManagedProviderEnv,
  setManagedProviderEnv,
} from './managed-env.js';

type ConfiguredSource = ProviderInfo['configuredSource'];

interface TrustedSharedCredentialAccount {
  readonly providerId: string;
  readonly apiKeyEnv: string;
  readonly accountId: string;
}

// Explicit security policy: equal environment-variable names alone never authorize
// keychain sharing. Only these reviewed builtin identities may share an account.
const TRUSTED_SHARED_CREDENTIAL_ACCOUNTS: readonly TrustedSharedCredentialAccount[] = [
  { providerId: 'openai', apiKeyEnv: 'OPENAI_API_KEY', accountId: 'codex-cli' },
  { providerId: 'codex-cli', apiKeyEnv: 'OPENAI_API_KEY', accountId: 'openai' },
];

function hasNonEmptyValue(value: string | undefined): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

function trustedSharedCredentialAccounts(providerId: string, apiKeyEnv: string): readonly string[] {
  return TRUSTED_SHARED_CREDENTIAL_ACCOUNTS.filter(
    (entry) => entry.providerId === providerId && entry.apiKeyEnv === apiKeyEnv,
  ).map((entry) => entry.accountId);
}

export function providerCredentialSource(
  providerId: string,
  apiKeyEnv: string,
  keychainAccounts: ReadonlySet<string>,
): ConfiguredSource {
  const hasKeychain = keychainAccounts.has(providerId);
  const hasEnv = externalProviderEnvValue(apiKeyEnv) !== undefined;
  const hasTrustedSharedKeychain = trustedSharedCredentialAccounts(providerId, apiKeyEnv).some(
    (account) => keychainAccounts.has(account),
  );
  if (hasKeychain && hasEnv) return 'both';
  if (hasKeychain) return 'keychain';
  if (hasEnv) return 'env';
  if (hasTrustedSharedKeychain) return 'runtime';
  return 'none';
}

export function setManagedProviderCredentialEnv(apiKeyEnv: string, value: string): void {
  const envError = validateApiKeyEnv(apiKeyEnv);
  if (envError) {
    console.warn(`[provider] refusing to inject unsafe apiKeyEnv "${apiKeyEnv}": ${envError}`);
    return;
  }
  setManagedProviderEnv(apiKeyEnv, value);
}

export async function listKnownProviderIds(): Promise<readonly string[]> {
  await providerConfigStore.load();
  const ids = new Set(BUILTIN_PROVIDERS.map((provider) => provider.id));
  for (const provider of providerConfigStore.listCustom()) ids.add(provider.id);
  for (const provider of await loadKodaxCustomProviders()) ids.add(provider.id);
  return [...ids];
}

export async function resolveCredentialProviderIds(
  primaryProvider: string,
  resolver: () => Promise<readonly string[]>,
): Promise<readonly string[]> {
  const configuredProviders = await resolver();
  return [...new Set([primaryProvider, ...configuredProviders])].filter(
    (provider) => provider !== 'mock' && provider.trim().length > 0,
  );
}

export async function resolveProviderCredentialInfo(
  providerId: string,
): Promise<{ readonly apiKeyEnv: string } | undefined> {
  if (isBuiltinId(providerId)) {
    const builtin = getBuiltin(providerId);
    return builtin ? { apiKeyEnv: builtin.apiKeyEnv } : undefined;
  }
  await providerConfigStore.load();
  const custom = providerConfigStore.getCustom(providerId);
  if (custom) return { apiKeyEnv: custom.apiKeyEnv };
  const sdkCustom = (await loadKodaxCustomProviders()).find(
    (provider) => provider.id === providerId,
  );
  return sdkCustom ? { apiKeyEnv: sdkCustom.apiKeyEnv } : undefined;
}

async function resolveCredentialAccount(
  providerId: string,
  apiKeyEnv: string,
): Promise<string | undefined> {
  if (await hasKey(providerId)) return providerId;
  for (const accountId of trustedSharedCredentialAccounts(providerId, apiKeyEnv)) {
    if (await hasKey(accountId)) return accountId;
  }
  return undefined;
}

/** Main-process-only lookup. The returned secret must never cross renderer IPC. */
export async function readProviderCredential(providerId: string): Promise<string | undefined> {
  if (providerId === 'mock') return undefined;
  const info = await resolveProviderCredentialInfo(providerId);
  if (!info) return undefined;
  const accountId = await resolveCredentialAccount(providerId, info.apiKeyEnv);
  const stored = accountId ? await getKey(accountId) : undefined;
  if (hasNonEmptyValue(stored)) return stored;
  return externalProviderEnvValue(info.apiKeyEnv);
}

export async function ensureProviderKeyInjected(providerId: string): Promise<boolean> {
  if (providerId === 'mock') return false;
  const info = await resolveProviderCredentialInfo(providerId);
  if (!info) return false;
  const credential = await readProviderCredential(providerId);
  if (!credential) {
    restoreManagedProviderEnv(info.apiKeyEnv);
    return false;
  }
  setManagedProviderCredentialEnv(info.apiKeyEnv, credential);
  return true;
}
