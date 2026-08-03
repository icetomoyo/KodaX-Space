type AgentSdkModule = typeof import('@kodax-ai/kodax/agent');

let agentSdkModule: Promise<AgentSdkModule> | undefined;

function loadAgentSdk(): Promise<AgentSdkModule> {
  agentSdkModule ??= import('@kodax-ai/kodax/agent').catch((error: unknown) => {
    agentSdkModule = undefined;
    throw error;
  });
  return agentSdkModule;
}

/**
 * Allocate an opaque Session ID from KodaX's canonical generator.
 *
 * Space's Electron main bundle is CommonJS while KodaX subpaths are ESM-only,
 * so the SDK must stay behind a dynamic import. Partner and Coder intentionally
 * share this generator; their ownership is represented by Session metadata.
 */
export async function generateKodaxSessionId(): Promise<string> {
  const sdk = await loadAgentSdk();
  // The async export exists in both the Registry-pinned 0.7.78 and local
  // 0.7.79 SDK. In 0.7.79 it delegates to the hardened synchronous generator.
  const sessionId = await sdk.generateSessionId();
  if (typeof sessionId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(sessionId)) {
    throw new Error('KodaX SDK generated an invalid Session ID.');
  }
  return sessionId;
}
