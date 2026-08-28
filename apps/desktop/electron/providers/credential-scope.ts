type SdkLlmModule = typeof import('@kodax-ai/kodax/llm');

export interface ExactProviderCredentialScopeDependencies {
  readProviderCredential(provider: string): Promise<string | undefined>;
  runWithProviderCredential<T>(provider: string, credential: string, operation: () => T): T;
}

let sdkLlmModule: Promise<SdkLlmModule> | null = null;

export class MissingExactProviderCredentialError extends Error {
  constructor(provider: string) {
    super(`Provider "${provider}" has no exact Space credential; operation was refused.`);
    this.name = 'MissingExactProviderCredentialError';
  }
}

function loadSdkLlm(): Promise<SdkLlmModule> {
  sdkLlmModule ??= import('@kodax-ai/kodax/llm');
  return sdkLlmModule;
}

async function readSpaceProviderCredential(
  provider: string,
): ReturnType<ExactProviderCredentialScopeDependencies['readProviderCredential']> {
  return (await import('../ipc/provider.js')).readProviderCredential(provider);
}

/**
 * Bind one known-provider operation to Space's exact credential.
 * Do not use this around work that may route to a different Provider: the SDK
 * deliberately fails closed on a provider mismatch inside an active scope.
 */
export async function runWithExactProviderCredential<T>(
  provider: string,
  operation: () => T,
  dependencies?: ExactProviderCredentialScopeDependencies,
): Promise<Awaited<T>> {
  if (provider === 'mock') return await operation();
  const credential = await (dependencies?.readProviderCredential(provider) ??
    readSpaceProviderCredential(provider));
  if (credential === undefined) {
    throw new MissingExactProviderCredentialError(provider);
  }

  const runScoped =
    dependencies?.runWithProviderCredential ?? (await loadSdkLlm()).runWithProviderCredential;
  return await runScoped(provider, credential, operation);
}
