import { reasoningModeSchema, type ReasoningMode } from '@kodax-space/space-ipc-schema';

const MONOTONIC_EFFORT_ORDER = ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const;

function parseReasoningMode(value: unknown): ReasoningMode | undefined {
  const parsed = reasoningModeSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

export function isSpaceReasoningMode(value: unknown): value is ReasoningMode {
  return reasoningModeSchema.safeParse(value).success;
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
      return parseReasoningMode(mode);
  }
}

export interface ReasoningProfileShape {
  readonly effortStrategy?: string;
  readonly supportedEfforts?: readonly {
    readonly value: string;
    readonly isDefault?: boolean;
    readonly isUserVisible?: boolean;
  }[];
  readonly defaultEffort?: string;
  readonly supportsDisabledThinking?: boolean;
  readonly localRejectEfforts?: readonly string[];
  readonly disabledEfforts?: readonly string[];
}

/** Project SDK reasoning metadata without confusing disabled thinking with an unsupported effort. */
export function projectReasoningProfile(profile: ReasoningProfileShape | undefined): {
  readonly supportedEfforts?: string[];
  readonly defaultEffort?: string;
  readonly canDisableThinking: boolean;
} {
  const disabledEfforts = new Set(
    profile?.disabledEfforts
      ?.map((effort) => parseReasoningMode(effort))
      .filter((effort): effort is string => effort !== undefined) ?? [],
  );
  const supportedEfforts: string[] = [];
  const seen = new Set<string>();
  let hasDeclaredVisibleEffort = false;
  let hasDisabledEffort = false;
  for (const effort of profile?.supportedEfforts ?? []) {
    if (effort.isUserVisible === false) continue;
    const value = parseReasoningMode(effort.value);
    if (!value) continue;
    hasDeclaredVisibleEffort = true;
    if (value === 'none' || disabledEfforts.has(value)) {
      hasDisabledEffort = true;
      continue;
    }
    if (!seen.has(value)) {
      seen.add(value);
      supportedEfforts.push(value);
    }
  }
  const rawDefaultEffort = parseReasoningMode(
    profile?.defaultEffort ?? profile?.supportedEfforts?.find((effort) => effort.isDefault)?.value,
  );
  const canDisableThinking =
    profile?.supportsDisabledThinking !== false &&
    !profile?.localRejectEfforts?.includes('none') &&
    (profile?.supportsDisabledThinking === true || hasDisabledEffort);
  const defaultEffort =
    rawDefaultEffort === 'none' || (rawDefaultEffort && disabledEfforts.has(rawDefaultEffort))
      ? canDisableThinking
        ? 'none'
        : undefined
      : rawDefaultEffort;
  const hasKnownEffortLadder =
    profile?.supportedEfforts !== undefined ||
    profile?.effortStrategy === 'none' ||
    profile?.effortStrategy === 'prompt-only';
  return {
    ...(hasDeclaredVisibleEffort || hasKnownEffortLadder ? { supportedEfforts } : {}),
    ...(defaultEffort ? { defaultEffort } : {}),
    canDisableThinking,
  };
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
  const desiredEffort = reasoningModeToEffort(input.reasoningMode);
  const resolve = (effort: string | undefined): string | undefined =>
    input.resolveWireEffort!({
      provider: input.provider,
      ...(input.model ? { model: input.model } : {}),
      desiredEffort: effort,
      ...(input.rejectedEfforts ? { rejectedEfforts: input.rejectedEfforts } : {}),
    }).effort;
  const sdkEffort = resolve(desiredEffort);
  const desiredIndex = desiredEffort
    ? MONOTONIC_EFFORT_ORDER.indexOf(desiredEffort as (typeof MONOTONIC_EFFORT_ORDER)[number])
    : -1;
  if (desiredIndex < 0 || sdkEffort === desiredEffort) return sdkEffort;

  for (let index = desiredIndex - 1; index >= 0; index -= 1) {
    const candidate = MONOTONIC_EFFORT_ORDER[index];
    if (candidate && resolve(candidate) === candidate) return candidate;
  }
  return sdkEffort;
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
  const normalized = parseReasoningMode(value);
  if (!normalized) return undefined;
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
      return normalized;
  }
}
