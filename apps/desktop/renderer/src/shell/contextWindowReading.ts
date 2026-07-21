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
