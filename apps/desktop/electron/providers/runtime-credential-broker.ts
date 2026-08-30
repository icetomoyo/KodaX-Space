import type {
  RuntimeScopedCredentialBroker,
  RuntimeScopedCredentialRequest,
} from '@kodax-ai/kodax/runtime';

interface ScopedRuntimeCredentialBrokerInput {
  readonly leaseBinding: { readonly leaseId?: string };
  readonly providers: readonly string[];
  readonly sessionId: string;
  readonly authorize: (request: RuntimeScopedCredentialRequest) => boolean;
  readonly readCredential: (provider: string) => Promise<string | undefined>;
}

/** Apply the common immutable envelope fences before an operation-specific policy. */
export function createScopedRuntimeCredentialBroker(
  input: ScopedRuntimeCredentialBrokerInput,
): RuntimeScopedCredentialBroker {
  return async (request) => {
    if (
      request.leaseId !== input.leaseBinding.leaseId ||
      request.sessionId !== input.sessionId ||
      !input.providers.includes(request.provider) ||
      !input.authorize(request)
    ) {
      return undefined;
    }
    return input.readCredential(request.provider);
  };
}
