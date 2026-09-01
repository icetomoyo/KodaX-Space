// Standalone Auto[LLM] bootstrap for embedded/Partner runs.
//
// KodaX 0.7.96 owns the fixed reviewer contract. Auto[RULES], selectable
// engines, configurable reviewer deadlines, and the automatic AskUser fallback
// no longer exist. Keep this wrapper small so Space follows the public REPL
// bootstrap instead of reconstructing the permission pipeline.

import path from 'node:path';
import type { AutoModeToolGuardrail } from '@kodax-ai/kodax/coding';

type SdkReplModule = typeof import('@kodax-ai/kodax/repl');
let sdkReplCache: SdkReplModule | null = null;

async function loadSdkRepl(): Promise<SdkReplModule> {
  if (sdkReplCache === null) sdkReplCache = await import('@kodax-ai/kodax/repl');
  return sdkReplCache;
}

export interface SpaceAutoModeBootstrapDeps {
  readonly projectRoot: string;
  readonly getCurrentProviderName: () => string;
  readonly getCurrentModel: () => string;
  readonly log?: (level: 'info' | 'warn', message: string) => void;
}

export interface SpaceAutoModeBootstrapResult {
  readonly getGuardrail: () => AutoModeToolGuardrail;
}

export async function bootstrapAutoMode(
  deps: SpaceAutoModeBootstrapDeps,
): Promise<SpaceAutoModeBootstrapResult> {
  const projectRoot = path.isAbsolute(deps.projectRoot)
    ? deps.projectRoot
    : path.resolve(deps.projectRoot);
  const sdk = await loadSdkRepl();
  const settings = sdk.loadAutoModeSettings();
  const bootstrap = await sdk.bootstrapAutoMode({
    projectRoot,
    executionCwd: projectRoot,
    getCurrentProviderName: deps.getCurrentProviderName,
    getCurrentModel: deps.getCurrentModel,
    getCurrentPermissionMode: () => 'auto',
    autoModeSettings: settings,
    log: deps.log,
  });
  return { getGuardrail: bootstrap.getGuardrail };
}
