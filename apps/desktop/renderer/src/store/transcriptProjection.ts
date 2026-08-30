export type TranscriptProjectionMergeStrategy =
  | 'closed-causal'
  | 'open-live-causal'
  | 'open-live'
  | 'promote-open-live-owner'
  | 'promote-live-owner'
  | 'legacy';

interface TranscriptProjectionMergeFacts {
  readonly hasClosedCausalAdoption: boolean;
  readonly openLiveAdoptionKind?: 'replace' | 'merge' | 'causal_merge';
  readonly ownerResolutionKind?:
    | 'promote_live_owner'
    | 'enrich_canonical_owner'
    | 'promote_open_live_owner';
}

export function selectTranscriptProjectionMergeStrategy(
  facts: TranscriptProjectionMergeFacts,
): TranscriptProjectionMergeStrategy {
  if (facts.hasClosedCausalAdoption) return 'closed-causal';
  if (facts.openLiveAdoptionKind === 'causal_merge') return 'open-live-causal';
  if (facts.openLiveAdoptionKind !== undefined) return 'open-live';
  if (facts.ownerResolutionKind === 'promote_open_live_owner') {
    return 'promote-open-live-owner';
  }
  if (facts.ownerResolutionKind === 'promote_live_owner') return 'promote-live-owner';
  return 'legacy';
}
