import { z } from 'zod';

export const MAX_PARTNER_FILE_PROPOSAL_CONTENT_BYTES = 1_048_576;
export const MAX_PARTNER_FILE_PROPOSAL_DIFF_BYTES = 196_608;

const utf8Bytes = (s: string): number => new TextEncoder().encode(s).length;

const safePathSchema = z
  .string()
  .min(1)
  .max(4096)
  .refine((s) => !/[\x00\r\n]/.test(s), { message: 'path contains control chars' });

const contentSchema = z
  .string()
  .max(MAX_PARTNER_FILE_PROPOSAL_CONTENT_BYTES)
  .refine((s) => utf8Bytes(s) <= MAX_PARTNER_FILE_PROPOSAL_CONTENT_BYTES, {
    message: 'content exceeds size limit',
  })
  .refine((s) => !s.includes('\u0000'), { message: 'content contains NUL byte' });

const boundedTextSchema = z.string().max(MAX_PARTNER_FILE_PROPOSAL_DIFF_BYTES);
const idSchema = z.string().min(1).max(128);
const sessionIdSchema = z.string().min(1).max(128);

export const partnerFileProposalOperationSchema = z.enum(['create', 'update']);
export const partnerFileProposalStatusSchema = z.enum(['pending', 'applied', 'rejected']);
export const partnerFileProposalRiskSchema = z.enum(['low', 'medium', 'high']);
export const partnerFileProposalClassificationSchema = z.enum([
  'safe-text',
  'code',
  'config',
  'unknown-text',
]);

export const partnerFileProposalSafetySchema = z.object({
  classification: partnerFileProposalClassificationSchema,
  risk: partnerFileProposalRiskSchema,
  warnings: z.array(z.string().min(1).max(240)).max(16),
});

export const partnerFileProposalDiffSchema = z.object({
  before: boundedTextSchema,
  after: boundedTextSchema,
  unified: boundedTextSchema,
  truncated: z.boolean(),
});

export const partnerFileProposalSummarySchema = z.object({
  id: idSchema,
  sessionId: sessionIdSchema,
  projectRoot: safePathSchema,
  targetPath: safePathSchema,
  operation: partnerFileProposalOperationSchema,
  status: partnerFileProposalStatusSchema,
  contentHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  baseContentHash: z
    .string()
    .regex(/^sha256:[a-f0-9]{64}$/)
    .nullable(),
  rationale: z.string().max(1024).optional(),
  sourceRefs: z.array(z.string().min(1).max(256)).max(64),
  safety: partnerFileProposalSafetySchema,
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
  appliedAt: z.number().int().nonnegative().optional(),
  rejectedAt: z.number().int().nonnegative().optional(),
  rejectReason: z.string().max(512).optional(),
});

export const partnerFileProposalSchema = partnerFileProposalSummarySchema.extend({
  content: contentSchema,
  diff: partnerFileProposalDiffSchema,
});

export const partnerFileProposalsListChannel = {
  name: 'partner.fileProposals.list',
  direction: 'invoke',
  input: z.object({
    sessionId: sessionIdSchema.optional(),
    projectRoot: safePathSchema,
    status: partnerFileProposalStatusSchema.optional(),
  }),
  output: z.object({
    proposals: z.array(partnerFileProposalSummarySchema).max(1000),
  }),
} as const;

export const partnerFileProposalsGetChannel = {
  name: 'partner.fileProposals.get',
  direction: 'invoke',
  input: z.object({ id: idSchema, projectRoot: safePathSchema }),
  output: z.object({ proposal: partnerFileProposalSchema.nullable() }),
} as const;

export const partnerFileProposalsApplyChannel = {
  name: 'partner.fileProposals.apply',
  direction: 'invoke',
  input: z.object({
    id: idSchema,
    projectRoot: safePathSchema,
    expectedContentHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  }),
  output: z.object({
    ok: z.boolean(),
    proposal: partnerFileProposalSummarySchema.optional(),
    error: z.string().max(512).optional(),
  }),
} as const;

export const partnerFileProposalsRejectChannel = {
  name: 'partner.fileProposals.reject',
  direction: 'invoke',
  input: z.object({
    id: idSchema,
    projectRoot: safePathSchema,
    reason: z.string().max(512).optional(),
  }),
  output: z.object({
    ok: z.boolean(),
    proposal: partnerFileProposalSummarySchema.optional(),
    error: z.string().max(512).optional(),
  }),
} as const;

export const partnerFileProposalsExportChannel = {
  name: 'partner.fileProposals.export',
  direction: 'invoke',
  input: z.object({
    id: idSchema,
    projectRoot: safePathSchema,
    expectedContentHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  }),
  output: z.object({
    ok: z.boolean(),
    canceled: z.boolean().optional(),
    path: safePathSchema.optional(),
    error: z.string().max(512).optional(),
  }),
} as const;

export type PartnerFileProposalOperationT = z.infer<typeof partnerFileProposalOperationSchema>;
export type PartnerFileProposalStatusT = z.infer<typeof partnerFileProposalStatusSchema>;
export type PartnerFileProposalSafetyT = z.infer<typeof partnerFileProposalSafetySchema>;
export type PartnerFileProposalDiffT = z.infer<typeof partnerFileProposalDiffSchema>;
export type PartnerFileProposalSummaryT = z.infer<typeof partnerFileProposalSummarySchema>;
export type PartnerFileProposalT = z.infer<typeof partnerFileProposalSchema>;
