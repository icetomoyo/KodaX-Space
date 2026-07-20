import type {
  AgentMode,
  AutoModeEngine,
  PermissionMode,
  ReasoningMode,
  SpaceRuntimeDefaultsT,
} from '@kodax-space/space-ipc-schema';
import { settingsStore, type SpaceSettings } from '../settings/store.js';
import { loadKodaxUserDefaults, type KodaxUserDefaults } from './user-config.js';
import { getSessionRuntimeStore, type SessionRuntimeSettings } from './session-runtime-store.js';

export type RuntimeDefaultSource = 'explicit' | 'session' | 'space' | 'kodax' | 'builtin';

export interface RuntimeDefaultOverrides {
  readonly permissionMode?: PermissionMode;
  readonly autoModeEngine?: AutoModeEngine;
  readonly reasoningMode?: ReasoningMode;
  readonly agentMode?: AgentMode;
}

export interface ResolvedRuntimeDefaults {
  readonly permissionMode: PermissionMode;
  readonly autoModeEngine: AutoModeEngine;
  readonly reasoningMode: ReasoningMode;
  readonly agentMode: AgentMode;
  readonly sources: {
    readonly permissionMode: RuntimeDefaultSource;
    readonly autoModeEngine: RuntimeDefaultSource;
    readonly reasoningMode: RuntimeDefaultSource;
    readonly agentMode: RuntimeDefaultSource;
  };
}

interface RuntimeDefaultsDeps {
  readonly loadSettings?: () => Promise<SpaceSettings>;
  readonly loadKodaxDefaults?: () => Promise<KodaxUserDefaults>;
  readonly loadSessionRuntime?: (sessionId: string) => Promise<SessionRuntimeSettings | null>;
}

const BUILTIN = {
  permissionMode: 'accept-edits' as PermissionMode,
  autoModeEngine: 'llm' as AutoModeEngine,
  reasoningMode: 'auto' as ReasoningMode,
  agentMode: 'ama' as AgentMode,
};

function pick<T>(
  candidates: readonly [T | undefined, RuntimeDefaultSource][],
  fallback: T,
): { value: T; source: RuntimeDefaultSource } {
  for (const [value, source] of candidates) {
    if (value !== undefined) return { value, source };
  }
  return { value: fallback, source: 'builtin' };
}

async function safeLoadSettings(deps?: RuntimeDefaultsDeps): Promise<SpaceRuntimeDefaultsT> {
  try {
    const settings = deps?.loadSettings ? await deps.loadSettings() : await settingsStore.load();
    return settings.runtimeDefaults ?? {};
  } catch (err) {
    console.warn(
      '[runtime-defaults] settings load failed:',
      err instanceof Error ? err.message : err,
    );
    return {};
  }
}

async function safeLoadKodaxDefaults(deps?: RuntimeDefaultsDeps): Promise<KodaxUserDefaults> {
  try {
    return deps?.loadKodaxDefaults ? await deps.loadKodaxDefaults() : await loadKodaxUserDefaults();
  } catch (err) {
    console.warn(
      '[runtime-defaults] KodaX defaults load failed:',
      err instanceof Error ? err.message : err,
    );
    return { customProvidersCount: 0 };
  }
}

async function safeLoadSessionRuntime(
  sessionId: string | undefined,
  includeSessionSidecar: boolean | undefined,
  deps?: RuntimeDefaultsDeps,
): Promise<SessionRuntimeSettings | null> {
  if (!sessionId || includeSessionSidecar !== true) return null;
  try {
    if (deps?.loadSessionRuntime) return await deps.loadSessionRuntime(sessionId);
    return await getSessionRuntimeStore().read(sessionId);
  } catch (err) {
    console.warn(
      `[runtime-defaults] session runtime load failed for ${sessionId}:`,
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}

export async function resolveRuntimeDefaults(
  input: {
    readonly explicit?: RuntimeDefaultOverrides;
    readonly sessionId?: string;
    readonly includeSessionSidecar?: boolean;
  } = {},
  deps?: RuntimeDefaultsDeps,
): Promise<ResolvedRuntimeDefaults> {
  const [sessionRuntime, spaceDefaults, kodaxDefaults] = await Promise.all([
    safeLoadSessionRuntime(input.sessionId, input.includeSessionSidecar, deps),
    safeLoadSettings(deps),
    safeLoadKodaxDefaults(deps),
  ]);

  const permissionMode = pick<PermissionMode>(
    [
      [input.explicit?.permissionMode, 'explicit'],
      [sessionRuntime?.permissionMode, 'session'],
      [spaceDefaults.permissionMode, 'space'],
      [kodaxDefaults.permissionMode, 'kodax'],
    ],
    BUILTIN.permissionMode,
  );

  const autoModeEngine = pick<AutoModeEngine>(
    [
      [input.explicit?.autoModeEngine, 'explicit'],
      [sessionRuntime?.autoModeEngine, 'session'],
      [spaceDefaults.autoModeEngine, 'space'],
      [kodaxDefaults.autoModeEngine, 'kodax'],
    ],
    BUILTIN.autoModeEngine,
  );

  const reasoningMode = pick<ReasoningMode>(
    [
      [input.explicit?.reasoningMode, 'explicit'],
      [sessionRuntime?.reasoningMode, 'session'],
      [spaceDefaults.reasoningMode, 'space'],
      [kodaxDefaults.reasoningMode, 'kodax'],
    ],
    BUILTIN.reasoningMode,
  );

  const agentMode = pick<AgentMode>(
    [
      [input.explicit?.agentMode, 'explicit'],
      [sessionRuntime?.agentMode, 'session'],
      [spaceDefaults.agentMode, 'space'],
    ],
    BUILTIN.agentMode,
  );

  return {
    permissionMode: permissionMode.value,
    autoModeEngine: autoModeEngine.value,
    reasoningMode: reasoningMode.value,
    agentMode: agentMode.value,
    sources: {
      permissionMode: permissionMode.source,
      autoModeEngine: autoModeEngine.source,
      reasoningMode: reasoningMode.source,
      agentMode: agentMode.source,
    },
  };
}
