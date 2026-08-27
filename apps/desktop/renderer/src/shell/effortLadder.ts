// Pure effort-ladder helpers shared by the picker and Runtime projections.

import type { ReasoningMode } from '@kodax-space/space-ipc-schema';

export const EFFORT_ORDER: readonly ReasoningMode[] = [
  'off',
  'auto',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
];

const UNKNOWN_CAPABILITY_ORDER: readonly ReasoningMode[] = ['auto', 'low', 'medium', 'high'];

/** Preserve real SDK effort levels while accepting persisted Space aliases. */
export function sdkEffortToReasoningMode(effort: string): ReasoningMode | null {
  switch (effort.trim().toLowerCase()) {
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
      return effort.trim().toLowerCase() as ReasoningMode;
    default:
      return null;
  }
}

/** Build an exact, provider-aware picker ladder without collapsing xhigh/max. */
export function visibleEffortLadder(
  supportedEfforts: readonly string[] | undefined,
  canDisableThinking = false,
): readonly ReasoningMode[] {
  if (!supportedEfforts || supportedEfforts.length === 0) {
    return canDisableThinking ? ['off', ...UNKNOWN_CAPABILITY_ORDER] : UNKNOWN_CAPABILITY_ORDER;
  }

  const allowed = new Set<ReasoningMode>(['auto']);
  if (canDisableThinking) allowed.add('off');
  for (const effort of supportedEfforts) {
    const mode = sdkEffortToReasoningMode(effort);
    if (mode && (mode !== 'off' || canDisableThinking)) allowed.add(mode);
  }
  return EFFORT_ORDER.filter((mode) => allowed.has(mode));
}
