import assert from 'node:assert/strict';
import { test } from 'node:test';

import { selectTranscriptProjectionMergeStrategy } from './transcriptProjection.js';

test('transcript projection merge strategy preserves the causal precedence order', () => {
  assert.equal(
    selectTranscriptProjectionMergeStrategy({
      hasClosedCausalAdoption: true,
      openLiveAdoptionKind: 'causal_merge',
      ownerResolutionKind: 'promote_open_live_owner',
    }),
    'closed-causal',
  );
  assert.equal(
    selectTranscriptProjectionMergeStrategy({
      hasClosedCausalAdoption: false,
      openLiveAdoptionKind: 'causal_merge',
      ownerResolutionKind: 'promote_open_live_owner',
    }),
    'open-live-causal',
  );
  assert.equal(
    selectTranscriptProjectionMergeStrategy({
      hasClosedCausalAdoption: false,
      openLiveAdoptionKind: 'merge',
      ownerResolutionKind: 'promote_open_live_owner',
    }),
    'open-live',
  );
  assert.equal(
    selectTranscriptProjectionMergeStrategy({
      hasClosedCausalAdoption: false,
      ownerResolutionKind: 'promote_open_live_owner',
    }),
    'promote-open-live-owner',
  );
  assert.equal(
    selectTranscriptProjectionMergeStrategy({
      hasClosedCausalAdoption: false,
      ownerResolutionKind: 'promote_live_owner',
    }),
    'promote-live-owner',
  );
  assert.equal(
    selectTranscriptProjectionMergeStrategy({ hasClosedCausalAdoption: false }),
    'legacy',
  );
});
