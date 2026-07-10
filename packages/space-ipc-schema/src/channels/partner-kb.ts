import { z } from 'zod';

const safePathSchema = z
  .string()
  .min(1)
  .max(4096)
  .refine((s) => !/[\x00\r\n]/.test(s), { message: 'path contains control chars' });

const idSchema = z.string().min(1).max(128);
const slugSchema = z.string().min(1).max(128);

export const partnerKbPageTypeSchema = z.enum([
  'source',
  'entity',
  'concept',
  'synthesis',
  'decision',
  'timeline',
  'note',
]);
export const partnerKbConfidenceSchema = z.enum(['low', 'medium', 'high']);
export const partnerKbPageStatusSchema = z.enum(['active', 'draft', 'stale', 'archived']);

export const partnerKbPageRefSchema = z.object({
  id: idSchema,
  projectRoot: safePathSchema,
  slug: slugSchema,
  title: z.string().min(1).max(256),
  pageType: partnerKbPageTypeSchema,
  summary: z.string().max(2000),
  sources: z.array(idSchema).max(128),
  tags: z.array(z.string().min(1).max(64)).max(64),
  confidence: partnerKbConfidenceSchema.optional(),
  status: partnerKbPageStatusSchema,
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
});

export const partnerKbPageSchema = partnerKbPageRefSchema.extend({
  content: z.string().max(512_000),
});

export const partnerKbSearchMatchSchema = z.object({
  page: partnerKbPageRefSchema,
  snippet: z.string().max(4000),
  score: z.number(),
  reasons: z.array(z.string().min(1).max(80)).max(16),
  sourceIds: z.array(idSchema).max(128),
  matchKind: z.enum(['hybrid-text']),
  fallback: z.enum(['none', 'text']),
});

export const partnerKbLintIssueSchema = z.object({
  kind: z.enum(['broken-link', 'uncited-claim', 'orphan-page']),
  pageId: idSchema,
  slug: slugSchema,
  title: z.string().min(1).max(256),
  message: z.string().min(1).max(1000),
  target: z.string().min(1).max(256).optional(),
});

export const partnerKbClaimPolicySchema = z.enum(['off', 'warn', 'strict']);

export const partnerKbConfigSchema = z.object({
  projectRoot: safePathSchema,
  pageGroups: z.array(partnerKbPageTypeSchema).min(1).max(16),
  pinnedSources: z.array(idSchema).max(128),
  preferredSynthesisPages: z.array(slugSchema).max(128),
  ignoredPaths: z.array(z.string().min(1).max(512)).max(256),
  claimPolicy: partnerKbClaimPolicySchema,
  freshnessWindowDays: z.number().int().min(1).max(3650),
  updatedAt: z.number().int().nonnegative(),
});

export const partnerKbConfigDiagnosticSchema = z.object({
  level: z.enum(['info', 'warning', 'error']),
  message: z.string().min(1).max(1000),
  path: z.string().min(1).max(256).optional(),
});

export const partnerKbStaleSourceSchema = z.object({
  pageId: idSchema,
  slug: slugSchema,
  title: z.string().min(1).max(256),
  ageDays: z.number().int().nonnegative(),
  message: z.string().min(1).max(1000),
});

export const partnerKbDuplicateTopicSchema = z.object({
  title: z.string().min(1).max(256),
  slugs: z.array(slugSchema).min(2).max(50),
});

export const partnerKbMaintenanceReportSchema = z.object({
  projectRoot: safePathSchema,
  runAt: z.number().int().nonnegative(),
  issueCount: z.number().int().nonnegative(),
  lintIssues: z.array(partnerKbLintIssueSchema).max(2000),
  staleSources: z.array(partnerKbStaleSourceSchema).max(512),
  duplicateTopics: z.array(partnerKbDuplicateTopicSchema).max(512),
  configDiagnostics: z.array(partnerKbConfigDiagnosticSchema).max(100),
  summaryMarkdown: z.string().max(128_000),
});

export const partnerKbSummaryChannel = {
  name: 'partner.kb.summary',
  direction: 'invoke',
  input: z.object({
    projectRoot: safePathSchema,
  }),
  output: z.object({
    projectRoot: safePathSchema,
    pageCount: z.number().int().nonnegative(),
    sourcePageCount: z.number().int().nonnegative(),
    updatedAt: z.number().int().nonnegative().nullable(),
    indexMarkdown: z.string().max(512_000),
    recentLog: z.string().max(128_000),
  }),
} as const;

export const partnerKbPagesChannel = {
  name: 'partner.kb.pages',
  direction: 'invoke',
  input: z.object({
    projectRoot: safePathSchema,
    query: z.string().min(1).max(512).optional(),
  }),
  output: z.object({
    pages: z.array(partnerKbPageRefSchema).max(512),
  }),
} as const;

export const partnerKbReadPageChannel = {
  name: 'partner.kb.readPage',
  direction: 'invoke',
  input: z.object({
    projectRoot: safePathSchema,
    pageId: idSchema.optional(),
    slug: slugSchema.optional(),
  }),
  output: z.object({
    page: partnerKbPageSchema.nullable(),
  }),
} as const;

export const partnerKbWritePageChannel = {
  name: 'partner.kb.writePage',
  direction: 'invoke',
  input: z.object({
    projectRoot: safePathSchema,
    title: z.string().min(1).max(256),
    content: z.string().min(1).max(512_000),
    slug: slugSchema.optional(),
    pageType: partnerKbPageTypeSchema.optional(),
    summary: z.string().max(2000).optional(),
    sources: z.array(idSchema).max(128).optional(),
    tags: z.array(z.string().min(1).max(64)).max(64).optional(),
    confidence: partnerKbConfidenceSchema.optional(),
    status: partnerKbPageStatusSchema.optional(),
  }),
  output: z.object({
    page: partnerKbPageSchema,
    created: z.boolean(),
    indexMarkdown: z.string().max(512_000),
  }),
} as const;

export const partnerKbSearchChannel = {
  name: 'partner.kb.search',
  direction: 'invoke',
  input: z.object({
    projectRoot: safePathSchema,
    query: z.string().min(1).max(512),
    limit: z.number().int().min(1).max(50).optional(),
  }),
  output: z.object({
    matches: z.array(partnerKbSearchMatchSchema).max(50),
  }),
} as const;

export const partnerKbRebuildIndexChannel = {
  name: 'partner.kb.rebuildIndex',
  direction: 'invoke',
  input: z.object({
    projectRoot: safePathSchema,
  }),
  output: z.object({
    indexMarkdown: z.string().max(512_000),
    pageCount: z.number().int().nonnegative(),
    rebuiltAt: z.number().int().nonnegative(),
  }),
} as const;

export const partnerKbLintChannel = {
  name: 'partner.kb.lint',
  direction: 'invoke',
  input: z.object({
    projectRoot: safePathSchema,
  }),
  output: z.object({
    issues: z.array(partnerKbLintIssueSchema).max(2000),
  }),
} as const;

export const partnerKbConfigGetChannel = {
  name: 'partner.kb.config.get',
  direction: 'invoke',
  input: z.object({
    projectRoot: safePathSchema,
  }),
  output: z.object({
    config: partnerKbConfigSchema,
    diagnostics: z.array(partnerKbConfigDiagnosticSchema).max(100),
  }),
} as const;

export const partnerKbConfigSetChannel = {
  name: 'partner.kb.config.set',
  direction: 'invoke',
  input: z.object({
    projectRoot: safePathSchema,
    pageGroups: z.array(partnerKbPageTypeSchema).min(1).max(16).optional(),
    pinnedSources: z.array(idSchema).max(128).optional(),
    preferredSynthesisPages: z.array(slugSchema).max(128).optional(),
    ignoredPaths: z.array(z.string().min(1).max(512)).max(256).optional(),
    claimPolicy: partnerKbClaimPolicySchema.optional(),
    freshnessWindowDays: z.number().int().min(1).max(3650).optional(),
  }),
  output: z.object({
    config: partnerKbConfigSchema,
    diagnostics: z.array(partnerKbConfigDiagnosticSchema).max(100),
  }),
} as const;

export const partnerKbMaintenanceRunChannel = {
  name: 'partner.kb.maintenance.run',
  direction: 'invoke',
  input: z.object({
    projectRoot: safePathSchema,
  }),
  output: z.object({
    report: partnerKbMaintenanceReportSchema,
  }),
} as const;

export const partnerKbMaintenanceLastChannel = {
  name: 'partner.kb.maintenance.last',
  direction: 'invoke',
  input: z.object({
    projectRoot: safePathSchema,
  }),
  output: z.object({
    report: partnerKbMaintenanceReportSchema.nullable(),
  }),
} as const;

export type PartnerKbPageTypeT = z.infer<typeof partnerKbPageTypeSchema>;
export type PartnerKbConfidenceT = z.infer<typeof partnerKbConfidenceSchema>;
export type PartnerKbPageStatusT = z.infer<typeof partnerKbPageStatusSchema>;
export type PartnerKbPageRefT = z.infer<typeof partnerKbPageRefSchema>;
export type PartnerKbPageT = z.infer<typeof partnerKbPageSchema>;
export type PartnerKbSearchMatchT = z.infer<typeof partnerKbSearchMatchSchema>;
export type PartnerKbLintIssueT = z.infer<typeof partnerKbLintIssueSchema>;
export type PartnerKbClaimPolicyT = z.infer<typeof partnerKbClaimPolicySchema>;
export type PartnerKbConfigT = z.infer<typeof partnerKbConfigSchema>;
export type PartnerKbConfigDiagnosticT = z.infer<typeof partnerKbConfigDiagnosticSchema>;
export type PartnerKbMaintenanceReportT = z.infer<typeof partnerKbMaintenanceReportSchema>;
