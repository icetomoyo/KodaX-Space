export interface ContextWindowReadingInput {
  readonly contextWindow: number;
  readonly source: 'provider' | 'fallback';
  readonly compactionTriggerPercent: number;
  readonly compactionTriggerTokens?: number;
  readonly compactionEffectiveTriggerTokens?: number;
}

export interface ResolvedContextWindowReading {
  readonly contextWindow: number;
  readonly triggerPercent: number;
  readonly triggerTokens?: number;
  readonly effectiveTriggerTokens?: number;
}

export interface ContextInputBudgetReading {
  readonly total: number;
  readonly reservedResponse: number;
}

/**
 * Keep KodaX's final threshold and the context window used to calculate it as one policy snapshot.
 * Legacy responses have no final threshold, so they retain Space's model-name fallback behavior.
 */
export function resolveContextWindowReading(
  input: ContextWindowReadingInput,
  hardcodedFallback: number,
): ResolvedContextWindowReading {
  const hasRuntimePolicy = input.compactionEffectiveTriggerTokens !== undefined;
  const contextWindow =
    input.source === 'fallback' && !hasRuntimePolicy
      ? hardcodedFallback
      : input.contextWindow > 0
        ? input.contextWindow
        : hardcodedFallback;

  return {
    contextWindow,
    triggerPercent: input.compactionTriggerPercent,
    ...(input.compactionTriggerTokens !== undefined
      ? { triggerTokens: input.compactionTriggerTokens }
      : {}),
    ...(input.compactionEffectiveTriggerTokens !== undefined
      ? { effectiveTriggerTokens: input.compactionEffectiveTriggerTokens }
      : {}),
  };
}

/**
 * The runtime budget total includes capacity reserved for the next model response.
 * That reservation is not active input and must not advance the auto-compaction meter.
 */
export function resolveActiveInputTokens(
  providerTokenCount: number | undefined,
  budget: ContextInputBudgetReading | undefined,
): number {
  if (providerTokenCount !== undefined) return Math.max(0, providerTokenCount);
  if (!budget) return 0;
  return Math.max(0, budget.total - budget.reservedResponse);
}
