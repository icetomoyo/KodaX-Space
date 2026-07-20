import assert from 'node:assert/strict';
import test from 'node:test';

import { resolvePartnerKnowledgeFeatures } from '../kodax/partner-knowledge-features.js';

test('Partner knowledge feature defaults enable the complete local vertical slice', () => {
  assert.deepEqual(resolvePartnerKnowledgeFeatures({}), {
    catalogV2: true,
    structuredSnapshots: true,
    fts5Index: true,
    citations: true,
    automaticRecall: true,
  });
});

test('disabling a parent Partner knowledge feature disables every child', () => {
  assert.deepEqual(
    resolvePartnerKnowledgeFeatures({ KODAX_SPACE_PARTNER_KNOWLEDGE_CATALOG_V2: '0' }),
    {
      catalogV2: false,
      structuredSnapshots: false,
      fts5Index: false,
      citations: false,
      automaticRecall: false,
    },
  );
  assert.deepEqual(
    resolvePartnerKnowledgeFeatures({ KODAX_SPACE_PARTNER_KNOWLEDGE_FTS5: 'false' }),
    {
      catalogV2: true,
      structuredSnapshots: true,
      fts5Index: false,
      citations: false,
      automaticRecall: false,
    },
  );
});

test('a child override never re-enables a disabled parent', () => {
  const features = resolvePartnerKnowledgeFeatures({
    KODAX_SPACE_PARTNER_KNOWLEDGE_CITATIONS: '0',
    KODAX_SPACE_PARTNER_KNOWLEDGE_AUTO_RECALL: '1',
  });
  assert.equal(features.citations, false);
  assert.equal(features.automaticRecall, false);
});

test('each Partner knowledge rollout gate can be disabled without mutating earlier data layers', () => {
  assert.deepEqual(
    resolvePartnerKnowledgeFeatures({ KODAX_SPACE_PARTNER_KNOWLEDGE_SNAPSHOTS: 'off' }),
    {
      catalogV2: true,
      structuredSnapshots: false,
      fts5Index: false,
      citations: false,
      automaticRecall: false,
    },
  );
  assert.deepEqual(
    resolvePartnerKnowledgeFeatures({ KODAX_SPACE_PARTNER_KNOWLEDGE_CITATIONS: 'no' }),
    {
      catalogV2: true,
      structuredSnapshots: true,
      fts5Index: true,
      citations: false,
      automaticRecall: false,
    },
  );
  assert.deepEqual(
    resolvePartnerKnowledgeFeatures({ KODAX_SPACE_PARTNER_KNOWLEDGE_AUTO_RECALL: '0' }),
    {
      catalogV2: true,
      structuredSnapshots: true,
      fts5Index: true,
      citations: true,
      automaticRecall: false,
    },
  );
});
