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
  readonly contextId?: string;
  readonly contextRevision?: number;
  readonly observedOrder?: number;
}

export interface ProviderContextInputReading {
  readonly tokens: number;
  readonly contextId?: string;
  readonly contextRevision?: number;
  readonly observedOrder?: number;
}

export interface ResolvedContextInputReading {
  readonly tokens: number;
  readonly source: 'provider' | 'budget' | 'unavailable';
  readonly providerTokens?: number;
  readonly budgetTokens?: number;
}

export function isEstimatedContextInput(
  readingSource: ResolvedContextInputReading['source'],
  snapshotSource: 'iteration_end' | 'compact_stats' | 'estimate' | undefined,
  tokenSource: 'api' | 'estimate' | undefined,
): boolean {
  return (
    readingSource === 'budget' ||
    snapshotSource === 'estimate' ||
    snapshotSource === 'compact_stats' ||
    tokenSource === 'estimate'
  );
}

export function resolveProviderReportedTokens(
  reading: ResolvedContextInputReading,
  snapshotSource: 'iteration_end' | 'compact_stats' | 'estimate' | undefined,
  tokenSource: 'api' | 'estimate' | undefined,
): number | undefined {
  if (
    reading.source !== 'budget' ||
    snapshotSource !== 'iteration_end' ||
    tokenSource !== 'api' ||
    reading.providerTokens === undefined ||
    reading.providerTokens === reading.tokens
  ) {
    return undefined;
  }
  return reading.providerTokens;
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
 * The Runtime budget is the complete request estimate used for compaction admission, while the
 * Provider count describes the last request it actually received. A current Runtime budget is
 * therefore the primary meter reading; Provider tokens are retained only as a secondary fact.
 *
 * A compact_stats snapshot advances the root context revision before the next budget snapshot
 * arrives. Ignore an older budget during that gap instead of briefly restoring the pre-compaction
 * estimate.
 */
export function resolveActiveInputReading(
  provider: ProviderContextInputReading | undefined,
  budget: ContextInputBudgetReading | undefined,
): ResolvedContextInputReading {
  const providerTokens = provider?.tokens !== undefined ? Math.max(0, provider.tokens) : undefined;
  const contextMismatch =
    provider?.contextId !== undefined &&
    budget?.contextId !== undefined &&
    provider.contextId !== budget.contextId;
  const budgetArrivedAfterProvider =
    budget?.observedOrder !== undefined &&
    (provider?.observedOrder === undefined || budget.observedOrder > provider.observedOrder);
  const budgetIsStale = Boolean(
    budget &&
    provider &&
    ((contextMismatch && !budgetArrivedAfterProvider) ||
      (provider.contextRevision !== undefined &&
        !contextMismatch &&
        (budget.contextRevision === undefined ||
          budget.contextRevision < provider.contextRevision))),
  );
  const budgetTokens =
    budget && !budgetIsStale ? Math.max(0, budget.total - budget.reservedResponse) : undefined;

  if (budgetTokens !== undefined) {
    return {
      tokens: budgetTokens,
      source: 'budget',
      ...(providerTokens !== undefined && !contextMismatch ? { providerTokens } : {}),
      budgetTokens,
    };
  }
  if (providerTokens !== undefined) {
    return {
      tokens: providerTokens,
      source: 'provider',
      providerTokens,
    };
  }
  return { tokens: 0, source: 'unavailable' };
}

/** Compatibility wrapper for consumers that only need the selected token count. */
export function resolveActiveInputTokens(
  providerTokenCount: number | undefined,
  budget: ContextInputBudgetReading | undefined,
): number {
  return resolveActiveInputReading(
    providerTokenCount !== undefined ? { tokens: providerTokenCount } : undefined,
    budget,
  ).tokens;
}
