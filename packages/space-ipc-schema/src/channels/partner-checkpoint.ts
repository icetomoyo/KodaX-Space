import { z } from 'zod';

export const MAX_PARTNER_CHECKPOINT_DIFF_BYTES = 196_608;

function hasPathControlChar(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c === 0 || c === 13 || c === 10) return true;
  }
  return false;
}

const idSchema = z.string().min(1).max(128);
const sessionIdSchema = z.string().min(1).max(128);
const pathSchema = z
  .string()
  .min(1)
  .max(4096)
  .refine((s) => !hasPathControlChar(s), { message: 'path contains control characters' });
const sha256Schema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const boundedDiffTextSchema = z.string().max(MAX_PARTNER_CHECKPOINT_DIFF_BYTES);

export const partnerCheckpointOperationSchema = z.enum(['create', 'update']);
export const partnerCheckpointStatusSchema = z.enum(['active', 'rolled-back']);

export const partnerCheckpointDiffSchema = z.object({
  before: boundedDiffTextSchema,
  after: boundedDiffTextSchema,
  unified: boundedDiffTextSchema,
  truncated: z.boolean(),
});

export const partnerCheckpointSchema = z.object({
  id: idSchema,
  sessionId: sessionIdSchema,
  projectRoot: pathSchema,
  rootPath: pathSchema,
  absolutePath: pathSchema,
  relativePath: pathSchema,
  operation: partnerCheckpointOperationSchema,
  status: partnerCheckpointStatusSchema,
  beforeHash: sha256Schema.nullable(),
  beforeSizeBytes: z.number().int().nonnegative().nullable(),
  beforeSnapshotPath: pathSchema.optional(),
  afterHash: sha256Schema,
  afterSizeBytes: z.number().int().nonnegative(),
  deliveryId: idSchema.optional(),
  producer: z.string().min(1).max(128),
  diff: partnerCheckpointDiffSchema.optional(),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
  rolledBackAt: z.number().int().nonnegative().optional(),
});

export const partnerCheckpointsListChannel = {
  name: 'partner.checkpoints.list',
  direction: 'invoke',
  input: z.object({
    sessionId: sessionIdSchema.optional(),
    projectRoot: pathSchema,
    status: partnerCheckpointStatusSchema.optional(),
  }),
  output: z.object({
    checkpoints: z.array(partnerCheckpointSchema).max(5000),
  }),
} as const;

export const partnerCheckpointsGetChannel = {
  name: 'partner.checkpoints.get',
  direction: 'invoke',
  input: z.object({ id: idSchema }),
  output: z.object({ checkpoint: partnerCheckpointSchema.nullable() }),
} as const;

export const partnerCheckpointsRollbackChannel = {
  name: 'partner.checkpoints.rollback',
  direction: 'invoke',
  input: z.object({ id: idSchema }),
  output: z.object({
    ok: z.boolean(),
    checkpoint: partnerCheckpointSchema.optional(),
    error: z.string().max(512).optional(),
  }),
} as const;

export const partnerCheckpointsChangedChannel = {
  name: 'partner.checkpoints.changed',
  direction: 'push',
  payload: z.object({
    sessionId: sessionIdSchema,
    id: idSchema.optional(),
    reason: z.enum(['created', 'updated', 'rollback']),
  }),
} as const;

export type PartnerCheckpointOperationT = z.infer<typeof partnerCheckpointOperationSchema>;
export type PartnerCheckpointStatusT = z.infer<typeof partnerCheckpointStatusSchema>;
export type PartnerCheckpointDiffT = z.infer<typeof partnerCheckpointDiffSchema>;
export type PartnerCheckpointT = z.infer<typeof partnerCheckpointSchema>;
