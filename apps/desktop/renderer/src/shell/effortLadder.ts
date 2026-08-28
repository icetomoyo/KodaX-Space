// Pure effort-ladder helpers shared by the picker and Runtime projections.

import { reasoningModeSchema, type ReasoningMode } from '@kodax-space/space-ipc-schema';

const UNKNOWN_CAPABILITY_ORDER: readonly ReasoningMode[] = ['auto', 'low', 'medium', 'high'];

/** Preserve real SDK effort levels while accepting persisted Space aliases. */
export function sdkEffortToReasoningMode(effort: string): ReasoningMode | null {
  const normalized = reasoningModeSchema.safeParse(effort);
  if (!normalized.success) return null;
  switch (normalized.data) {
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
      return normalized.data;
    default:
      return normalized.data;
  }
}

/** Build an exact, provider-aware picker ladder without collapsing xhigh/max. */
export function visibleEffortLadder(
  supportedEfforts: readonly string[] | undefined,
  canDisableThinking = false,
): readonly ReasoningMode[] {
  if (supportedEfforts === undefined) {
    return canDisableThinking ? ['off', ...UNKNOWN_CAPABILITY_ORDER] : UNKNOWN_CAPABILITY_ORDER;
  }

  const visible: ReasoningMode[] = canDisableThinking ? ['off', 'auto'] : ['auto'];
  const seen = new Set<ReasoningMode>(visible);
  for (const effort of supportedEfforts) {
    const mode = sdkEffortToReasoningMode(effort);
    if (!mode || (mode === 'off' && !canDisableThinking) || seen.has(mode)) continue;
    seen.add(mode);
    visible.push(mode);
  }
  return visible;
}
