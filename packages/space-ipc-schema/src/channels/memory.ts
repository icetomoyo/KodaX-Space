import { z } from 'zod';

const ID = 512;
const TITLE = 512;
const PATH = 4096;
const MSG = 8192;
const BODY = 256 * 1024;
const DIFF = 256 * 1024;
const MAX_REFS = 2048;
const MAX_PROPOSALS = 512;
const MAX_FINDINGS = 512;
const MAX_HINTS = 128;

const memoryRefKindSchema = z.enum([
  'working_context',
  'session_trace',
  'artifact_ledger',
  'learning_proposal',
  'memdir',
  'skill',
  'workflow_run',
  'reasoning_report',
  'self_manual',
  'project_doc',
]);

const memoryScopeSchema = z.enum([
  'turn',
  'session',
  'project',
  'workspace',
  'agent',
  'user',
  'builtin',
]);
const memoryLifecycleSchema = z.enum([
  'pending',
  'active',
  'provisional',
  'trusted',
  'stale',
  'quarantined',
  'archived',
  'readonly',
]);
const memoryAuthoritySchema = z.enum(['read_only', 'proposal_only', 'approved_write']);
const memoryVisibilitySchema = z.enum(['prompt_safe', 'private', 'sensitive']);
const memoryProposalActionSchema = z.enum([
  'no_op',
  'link_refs',
  'write_memdir',
  'patch_memdir',
  'handoff_to_skill_loop',
  'quarantine',
  'archive',
  'conflict_report',
]);

export const memoryItemRefSchema = z.object({
  kind: memoryRefKindSchema,
  id: z.string().min(1).max(ID),
  scope: memoryScopeSchema,
  title: z.string().max(TITLE).optional(),
  owner: z.enum(['user', 'project', 'kodax', 'external']),
  lifecycle: memoryLifecycleSchema,
  authority: memoryAuthoritySchema,
  visibility: memoryVisibilitySchema,
  sourceRefs: z.array(z.string().max(ID)).max(MAX_REFS),
  relatedRefs: z.array(z.string().max(ID)).max(MAX_REFS),
  version: z.string().max(ID).optional(),
  bodyFingerprint: z.string().max(ID).optional(),
  storageUri: z.string().max(PATH).optional(),
  createdAt: z.string().max(ID).optional(),
  updatedAt: z.string().max(ID).optional(),
  lastUsedAt: z.string().max(ID).optional(),
  pinned: z.boolean().optional(),
});
export type MemoryItemRefT = z.infer<typeof memoryItemRefSchema>;

const memoryRefFilterSchema = z.object({
  kinds: z.array(memoryRefKindSchema).max(32).optional(),
  scopes: z.array(memoryScopeSchema).max(16).optional(),
  lifecycles: z.array(memoryLifecycleSchema).max(16).optional(),
  includePrivate: z.boolean().optional(),
  includeSensitive: z.boolean().optional(),
  query: z.string().max(512).optional(),
});
export type MemoryRefFilterT = z.infer<typeof memoryRefFilterSchema>;

const fingerprintMapSchema = z.record(z.string().max(ID));

export const memoryApplyPreviewSchema = z.object({
  summary: z.string().max(MSG),
  changedRefs: z.array(memoryItemRefSchema).max(MAX_REFS),
  changedPaths: z.array(z.string().max(PATH)).max(512),
  beforeFingerprints: fingerprintMapSchema,
  afterFingerprints: fingerprintMapSchema.optional(),
  diff: z.string().max(DIFF).optional(),
  warnings: z.array(z.string().max(MSG)).max(128),
});
export type MemoryApplyPreviewT = z.infer<typeof memoryApplyPreviewSchema>;

export const memoryActionProposalSchema = z.object({
  id: z.string().min(1).max(ID),
  action: memoryProposalActionSchema,
  targetRefs: z.array(memoryItemRefSchema).max(MAX_REFS),
  sourceRefs: z.array(memoryItemRefSchema).max(MAX_REFS),
  expectedFingerprints: fingerprintMapSchema,
  rationale: z.string().max(MSG),
  risk: z.enum(['low', 'medium', 'high']),
  preview: memoryApplyPreviewSchema,
  requiresApproval: z.literal(true),
  createdAt: z.string().max(ID),
});
export type MemoryActionProposalT = z.infer<typeof memoryActionProposalSchema>;

export const memoryApplyResultSchema = z.object({
  proposalId: z.string().min(1).max(ID),
  applied: z.boolean(),
  changedRefs: z.array(memoryItemRefSchema).max(MAX_REFS),
  changedPaths: z.array(z.string().max(PATH)).max(512),
  skippedReason: z.string().max(MSG).optional(),
  warnings: z.array(z.string().max(MSG)).max(128),
});
export type MemoryApplyResultT = z.infer<typeof memoryApplyResultSchema>;

const memoryReviewCandidateRefSchema = z.object({
  ref: memoryItemRefSchema,
  bodySnippet: z.string().max(MSG).optional(),
  bodyFingerprint: z.string().max(ID).optional(),
  warnings: z.array(z.string().max(MSG)).max(128),
});

const memoryReviewDraftActionSchema = z.object({
  action: memoryProposalActionSchema,
  targetRefIds: z.array(z.string().max(ID)).max(MAX_REFS),
  summary: z.string().max(MSG),
  rationale: z.string().max(MSG),
  confidence: z.enum(['low', 'medium', 'high']),
  risk: z.enum(['low', 'medium', 'high']),
  requiresApproval: z.literal(true),
  proposedBody: z.string().max(BODY).optional(),
});

export const memoryReviewPlanSchema = z.object({
  trigger: z.enum([
    'user_correction',
    'explicit_remember',
    'explicit_forget',
    'proposal_rejected',
    'conflict_detected',
    'episode_completed',
  ]),
  createdAt: z.string().max(ID),
  sourceRefs: z.array(z.string().max(ID)).max(MAX_REFS),
  candidateRefs: z.array(memoryReviewCandidateRefSchema).max(MAX_REFS),
  actions: z.array(memoryReviewDraftActionSchema).max(128),
  warnings: z.array(z.string().max(MSG)).max(128),
});
export type MemoryReviewPlanT = z.infer<typeof memoryReviewPlanSchema>;

export const memoryRejectResultSchema = z.object({
  proposalId: z.string().min(1).max(ID),
  rejected: z.boolean(),
  skippedReason: z.string().max(MSG).optional(),
  review: memoryReviewPlanSchema.optional(),
  warnings: z.array(z.string().max(MSG)).max(128),
});
export type MemoryRejectResultT = z.infer<typeof memoryRejectResultSchema>;

export const memoryBodySnapshotSchema = z.object({
  ref: memoryItemRefSchema,
  body: z.string().max(BODY),
  bodyFingerprint: z.string().max(ID),
  frontmatter: z.record(z.string().max(MSG)).optional(),
  readAt: z.string().max(ID),
  warnings: z.array(z.string().max(MSG)).max(128),
});
export type MemoryBodySnapshotT = z.infer<typeof memoryBodySnapshotSchema>;

const memoryGovernanceFindingSchema = z.object({
  kind: z.enum(['duplicate', 'conflict', 'stale', 'quarantined', 'orphaned', 'no_op']),
  severity: z.enum(['info', 'warning', 'error']),
  refIds: z.array(z.string().max(ID)).max(MAX_REFS),
  summary: z.string().max(MSG),
  suggestedAction: memoryProposalActionSchema,
});

export const memoryGovernanceReportSchema = z.object({
  reportId: z.string().min(1).max(ID),
  generatedAt: z.string().max(ID),
  findings: z.array(memoryGovernanceFindingSchema).max(MAX_FINDINGS),
  warnings: z.array(z.string().max(MSG)).max(128),
});
export type MemoryGovernanceReportT = z.infer<typeof memoryGovernanceReportSchema>;

const memoryPackHintSchema = z.object({
  ref: memoryItemRefSchema,
  hook: z.string().max(MSG),
  reason: z.string().max(MSG),
  bodySnippet: z.string().max(MSG).optional(),
  bodyFingerprint: z.string().max(ID).optional(),
});

export const memoryPackSchema = z.object({
  generatedAt: z.string().max(ID),
  taskFingerprint: z.string().max(ID),
  hints: z.array(memoryPackHintSchema).max(MAX_HINTS),
  omitted: z.array(z.string().max(ID)).max(MAX_REFS),
  traceMetadata: z.object({
    selectedRefIds: z.array(z.string().max(ID)).max(MAX_REFS),
    omittedRefIds: z.array(z.string().max(ID)).max(MAX_REFS),
    taskFingerprint: z.string().max(ID),
    suppressed: z.boolean(),
  }),
});
export type MemoryPackT = z.infer<typeof memoryPackSchema>;

export const memoryListChannel = {
  name: 'memory.list',
  direction: 'invoke',
  input: memoryRefFilterSchema.extend({
    sessionId: z.string().min(1).max(128),
  }),
  output: z.object({
    inbox: z.array(memoryActionProposalSchema).max(MAX_PROPOSALS),
    refs: z.array(memoryItemRefSchema).max(MAX_REFS),
    warnings: z.array(z.string().max(MSG)).max(128),
  }),
} as const;

export const memoryProposalChannel = {
  name: 'memory.proposal',
  direction: 'invoke',
  input: z.object({
    sessionId: z.string().min(1).max(128),
    proposalId: z.string().min(1).max(ID),
  }),
  output: z.object({
    proposal: memoryActionProposalSchema.nullable(),
  }),
} as const;

export const memoryApproveChannel = {
  name: 'memory.approve',
  direction: 'invoke',
  input: z.object({
    sessionId: z.string().min(1).max(128),
    proposalId: z.string().min(1).max(ID),
    expectedFingerprints: fingerprintMapSchema,
  }),
  output: z.object({
    result: memoryApplyResultSchema,
  }),
} as const;

export const memoryRejectChannel = {
  name: 'memory.reject',
  direction: 'invoke',
  input: z.object({
    sessionId: z.string().min(1).max(128),
    proposalId: z.string().min(1).max(ID),
    reason: z.string().max(2048).optional(),
  }),
  output: z.object({
    result: memoryRejectResultSchema,
  }),
} as const;

export const memoryReadRefChannel = {
  name: 'memory.readRef',
  direction: 'invoke',
  input: z.object({
    sessionId: z.string().min(1).max(128),
    ref: memoryItemRefSchema,
  }),
  output: z.object({
    snapshot: memoryBodySnapshotSchema,
  }),
} as const;

export const memoryCurateChannel = {
  name: 'memory.curate',
  direction: 'invoke',
  input: z.object({
    sessionId: z.string().min(1).max(128),
    includePrivate: z.boolean().optional(),
    includeSensitive: z.boolean().optional(),
  }),
  output: z.object({
    report: memoryGovernanceReportSchema,
  }),
} as const;

export const memoryPackChannel = {
  name: 'memory.pack',
  direction: 'invoke',
  input: z.object({
    sessionId: z.string().min(1).max(128),
    task: z.string().min(1).max(MSG),
    maxHints: z.number().int().min(0).max(MAX_HINTS).optional(),
    includePrivate: z.boolean().optional(),
    includeSensitive: z.boolean().optional(),
    includeSnippets: z.boolean().optional(),
    ignoreMemory: z.boolean().optional(),
  }),
  output: z.object({
    pack: memoryPackSchema,
  }),
} as const;
