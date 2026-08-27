import type { ReasoningMode } from '@kodax-space/space-ipc-schema';

const REASONING_MODES = new Set<ReasoningMode>([
  'off',
  'auto',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
  'quick',
  'balanced',
  'deep',
]);

export function isSpaceReasoningMode(value: unknown): value is ReasoningMode {
  return typeof value === 'string' && REASONING_MODES.has(value as ReasoningMode);
}

/** Convert Space's UI value (including persisted legacy aliases) to an SDK effort intent. */
export function reasoningModeToEffort(
  mode: ReasoningMode | string | undefined,
): string | undefined {
  switch (mode) {
    case 'off':
    case 'none':
      return 'none';
    case 'quick':
      return 'low';
    case 'balanced':
      return 'medium';
    case 'deep':
      return 'max';
    case 'auto':
    case 'minimal':
    case 'low':
    case 'medium':
    case 'high':
    case 'xhigh':
    case 'max':
      return mode;
    default:
      return undefined;
  }
}

export type ResolveWireEffortFn = (input: {
  readonly provider: string;
  readonly model?: string;
  readonly desiredEffort?: string;
  readonly rejectedEfforts?: readonly string[];
}) => { readonly effort: string | undefined };

/**
 * Resolve the actual wire effort through the SDK's canonical provider/model matrix.
 * `undefined` deliberately means "omit reasoning_effort"; it must not be replaced
 * with Space's old static high fallback for unprofiled custom providers.
 */
export function resolveSpaceWireEffort(input: {
  readonly provider: string;
  readonly model?: string;
  readonly reasoningMode: ReasoningMode | string | undefined;
  readonly rejectedEfforts?: readonly string[];
  readonly resolveWireEffort: ResolveWireEffortFn | undefined;
}): string | undefined {
  if (!input.resolveWireEffort) return undefined;
  return input.resolveWireEffort({
    provider: input.provider,
    ...(input.model ? { model: input.model } : {}),
    desiredEffort: reasoningModeToEffort(input.reasoningMode),
    ...(input.rejectedEfforts ? { rejectedEfforts: input.rejectedEfforts } : {}),
  }).effort;
}

/** Resolve against the SDK registry used by the running Space process. */
export async function resolveSdkSpaceWireEffort(input: {
  readonly provider: string;
  readonly model?: string;
  readonly reasoningMode: ReasoningMode | string | undefined;
}): Promise<string | undefined> {
  const [sdk, agent] = await Promise.all([
    import('@kodax-ai/kodax/coding'),
    import('@kodax-ai/kodax/agent'),
  ]);
  return resolveSpaceWireEffort({
    ...input,
    rejectedEfforts: agent.getCachedRejectedEfforts(input.provider, input.model),
    resolveWireEffort: sdk.resolveWireEffort,
  });
}

/** Preserve a supported `auto` intent in shared Runtime settings; omit it when unsupported. */
export function runtimeSettingEffort(
  reasoningMode: ReasoningMode | string | undefined,
  resolvedWireEffort: string | undefined,
): string | null {
  if (reasoningModeToEffort(reasoningMode) === 'auto' && resolvedWireEffort !== undefined) {
    return 'auto';
  }
  return resolvedWireEffort ?? null;
}

/** Normalize SDK effort values and legacy Space aliases to the current UI selection. */
export function effortToReasoningMode(value: unknown): ReasoningMode | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().toLowerCase();
  switch (normalized) {
    case 'off':
    case 'none':
      return 'off';
    case 'quick':
      return 'low';
    case 'balanced':
      return 'medium';
    case 'deep':
      return 'max';
    case 'auto':
    case 'minimal':
    case 'low':
    case 'medium':
    case 'high':
    case 'xhigh':
    case 'max':
      return normalized;
    default:
      return undefined;
  }
}
