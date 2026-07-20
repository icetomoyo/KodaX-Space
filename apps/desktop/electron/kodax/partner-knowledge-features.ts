export interface PartnerKnowledgeFeatureSet {
  readonly catalogV2: boolean;
  readonly structuredSnapshots: boolean;
  readonly fts5Index: boolean;
  readonly citations: boolean;
  readonly automaticRecall: boolean;
}

type FeatureEnv = Readonly<Record<string, string | undefined>>;

function enabled(env: FeatureEnv, key: string, fallback = true): boolean {
  const raw = env[key]?.trim().toLowerCase();
  if (!raw) return fallback;
  if (raw === '0' || raw === 'false' || raw === 'off' || raw === 'no') return false;
  if (raw === '1' || raw === 'true' || raw === 'on' || raw === 'yes') return true;
  return fallback;
}

export function resolvePartnerKnowledgeFeatures(env: FeatureEnv): PartnerKnowledgeFeatureSet {
  const catalogV2 = enabled(env, 'KODAX_SPACE_PARTNER_KNOWLEDGE_CATALOG_V2');
  const structuredSnapshots = catalogV2 && enabled(env, 'KODAX_SPACE_PARTNER_KNOWLEDGE_SNAPSHOTS');
  const fts5Index = structuredSnapshots && enabled(env, 'KODAX_SPACE_PARTNER_KNOWLEDGE_FTS5');
  const citations = fts5Index && enabled(env, 'KODAX_SPACE_PARTNER_KNOWLEDGE_CITATIONS');
  const automaticRecall = citations && enabled(env, 'KODAX_SPACE_PARTNER_KNOWLEDGE_AUTO_RECALL');
  return { catalogV2, structuredSnapshots, fts5Index, citations, automaticRecall };
}

export const partnerKnowledgeFeatures = resolvePartnerKnowledgeFeatures(process.env);
