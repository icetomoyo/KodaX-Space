import type {
  ProviderCredentialAttribution,
  ProviderCredentialLeaseScope,
} from '@kodax-ai/kodax/llm';
import {
  listKnownProviderIds,
  readProviderCredential,
  resolveCredentialProviderIds,
} from './credentials.js';

type SdkLlmModule = typeof import('@kodax-ai/kodax/llm');

export interface ExactProviderCredentialScopeDependencies {
  readProviderCredential(provider: string): Promise<string | undefined>;
  runWithProviderCredential<T>(provider: string, credential: string, operation: () => T): T;
}

export interface ProviderCredentialLeaseDependencies {
  readProviderCredential(provider: string): Promise<string | undefined>;
  listProviderCredentialIds(): Promise<readonly string[]>;
  createProviderCredentialLeaseScope: SdkLlmModule['createProviderCredentialLeaseScope'];
  runWithProviderCredentialLeaseScope: SdkLlmModule['runWithProviderCredentialLeaseScope'];
}

export interface DetachedWorkflowCredentialScopeDependencies extends ProviderCredentialLeaseDependencies {
  deriveCurrentProviderCredentialLeaseScope: SdkLlmModule['deriveCurrentProviderCredentialLeaseScope'];
  onAcquire?(attribution: ProviderCredentialAttribution | undefined): void;
}

export interface DetachedWorkflowCredentialHandle {
  readonly done: Promise<unknown>;
}

interface DetachedWorkflowRootScopeInput {
  readonly workflowRunId: string;
  readonly providers: readonly string[];
  readonly readCredential: ExactProviderCredentialScopeDependencies['readProviderCredential'];
  readonly createLease: SdkLlmModule['createProviderCredentialLeaseScope'];
  readonly onAcquire?: (attribution: ProviderCredentialAttribution | undefined) => void;
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
  return readProviderCredential(provider);
}

async function listSpaceProviderCredentialIds(): Promise<readonly string[]> {
  return listKnownProviderIds();
}

function createDetachedWorkflowRootScope(
  input: DetachedWorkflowRootScopeInput,
): ProviderCredentialLeaseScope {
  return input.createLease({
    allowedProviders: input.providers,
    async acquire(requestedProvider, _purpose, signal, attribution) {
      if (
        !input.providers.includes(requestedProvider) ||
        attribution?.kind !== 'workflow' ||
        attribution.workflowRunId !== input.workflowRunId
      ) {
        throw new Error('Provider credential request exceeded its detached Workflow scope.');
      }
      signal.throwIfAborted();
      const credential = await input.readCredential(requestedProvider);
      signal.throwIfAborted();
      if (credential === undefined) {
        throw new MissingExactProviderCredentialError(requestedProvider);
      }
      input.onAcquire?.(attribution);
      return credential;
    },
  });
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

/** Run one Space-owned SDK operation under a lazy multi-Provider lease. */
export async function runWithSpaceProviderCredentialLease<T>(
  primaryProvider: string,
  operation: () => T,
  dependencies?: ProviderCredentialLeaseDependencies,
): Promise<Awaited<T>> {
  if (primaryProvider === 'mock') return await operation();

  const sdk = await loadSdkLlm();
  const readCredential = dependencies?.readProviderCredential ?? readSpaceProviderCredential;
  const providers = await resolveCredentialProviderIds(
    primaryProvider,
    dependencies?.listProviderCredentialIds ?? listSpaceProviderCredentialIds,
  );
  const createLease =
    dependencies?.createProviderCredentialLeaseScope ?? sdk.createProviderCredentialLeaseScope;
  const runWithLease =
    dependencies?.runWithProviderCredentialLeaseScope ?? sdk.runWithProviderCredentialLeaseScope;
  const scope = createLease({
    allowedProviders: providers,
    async acquire(requestedProvider, _purpose, signal) {
      if (!providers.includes(requestedProvider)) {
        throw new Error('Provider credential request exceeded its Space operation scope.');
      }
      signal.throwIfAborted();
      const credential = await readCredential(requestedProvider);
      signal.throwIfAborted();
      if (credential === undefined) {
        throw new MissingExactProviderCredentialError(requestedProvider);
      }
      return credential;
    },
  });

  try {
    return await runWithLease(scope, operation);
  } finally {
    scope.close('Space Provider operation settled');
  }
}

/**
 * Start detached Workflow work under a lazy, revocable SDK credential lease.
 * The derived Workflow scope stays active until the returned handle settles;
 * an exact scope cannot safely outlive a synchronous handle return.
 */
export async function runDetachedWorkflowWithProviderCredentialLease<
  T extends DetachedWorkflowCredentialHandle,
>(
  primaryProvider: string,
  workflowRunId: string,
  operation: () => T,
  dependencies?: DetachedWorkflowCredentialScopeDependencies,
): Promise<T> {
  if (primaryProvider === 'mock') return operation();

  const sdk = await loadSdkLlm();
  const readCredential = dependencies?.readProviderCredential ?? readSpaceProviderCredential;
  const providers = await resolveCredentialProviderIds(
    primaryProvider,
    dependencies?.listProviderCredentialIds ?? listSpaceProviderCredentialIds,
  );
  const createLease =
    dependencies?.createProviderCredentialLeaseScope ?? sdk.createProviderCredentialLeaseScope;
  const deriveLease =
    dependencies?.deriveCurrentProviderCredentialLeaseScope ??
    sdk.deriveCurrentProviderCredentialLeaseScope;
  const runWithLease =
    dependencies?.runWithProviderCredentialLeaseScope ?? sdk.runWithProviderCredentialLeaseScope;

  const rootScope = createDetachedWorkflowRootScope({
    workflowRunId,
    providers,
    readCredential,
    createLease,
    ...(dependencies?.onAcquire ? { onAcquire: dependencies.onAcquire } : {}),
  });

  let workflowScope: ProviderCredentialLeaseScope | undefined;
  let closed = false;
  const closeScopes = (reason: string): void => {
    if (closed) return;
    closed = true;
    workflowScope?.close(reason);
    rootScope.close(reason);
  };

  try {
    const handle = runWithLease(rootScope, () => {
      workflowScope = deriveLease(providers, { kind: 'workflow', workflowRunId });
      if (workflowScope === undefined) {
        throw new Error('KodaX did not derive a detached Workflow credential scope.');
      }
      return runWithLease(workflowScope, operation);
    });
    void handle.done.then(
      () => closeScopes('Workflow settled'),
      () => closeScopes('Workflow failed'),
    );
    return handle;
  } catch (error) {
    closeScopes('Workflow start failed');
    throw error;
  }
}
