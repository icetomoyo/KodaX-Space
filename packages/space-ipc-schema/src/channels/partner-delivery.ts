import { z } from 'zod';

export const MAX_PARTNER_DELIVERY_INLINE_BYTES = 50 * 1024 * 1024;

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

export const partnerDeliveryRootKindSchema = z.enum(['run-output', 'workspace-session']);
export const partnerDeliveryKindSchema = z.enum(['file', 'folder']);

export const partnerDeliveryRefSchema = z.object({
  id: idSchema,
  sessionId: sessionIdSchema,
  projectRoot: pathSchema,
  rootKind: partnerDeliveryRootKindSchema,
  rootPath: pathSchema,
  absolutePath: pathSchema,
  relativePath: pathSchema,
  kind: partnerDeliveryKindSchema,
  title: z.string().min(1).max(256),
  mime: z.string().min(1).max(256).optional(),
  extension: z.string().max(64).optional(),
  sizeBytes: z.number().int().nonnegative().optional(),
  contentHash: sha256Schema.optional(),
  sourceRefs: z.array(z.string().min(1).max(256)).max(64),
  producer: z.string().min(1).max(128),
  checkpointId: z.string().max(128).optional(),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
});

export const partnerDeliveriesListChannel = {
  name: 'partner.deliveries.list',
  direction: 'invoke',
  input: z.object({
    sessionId: sessionIdSchema.optional(),
    projectRoot: pathSchema,
    rootKind: partnerDeliveryRootKindSchema.optional(),
  }),
  output: z.object({
    deliveries: z.array(partnerDeliveryRefSchema).max(5000),
  }),
} as const;

export const partnerDeliveriesGetChannel = {
  name: 'partner.deliveries.get',
  direction: 'invoke',
  input: z.object({ id: idSchema }),
  output: z.object({ delivery: partnerDeliveryRefSchema.nullable() }),
} as const;

export const partnerDeliveriesOutputRootChannel = {
  name: 'partner.deliveries.outputRoot',
  direction: 'invoke',
  input: z.object({
    sessionId: sessionIdSchema,
    projectRoot: pathSchema,
  }),
  output: z.object({
    rootPath: pathSchema,
  }),
} as const;

export const partnerDeliveriesReadBinaryChannel = {
  name: 'partner.deliveries.readBinary',
  direction: 'invoke',
  input: z.object({
    id: idSchema,
    maxBytes: z.number().int().positive().max(MAX_PARTNER_DELIVERY_INLINE_BYTES),
  }),
  output: z.object({
    base64: z.string(),
    size: z.number().int().nonnegative(),
    truncated: z.boolean(),
    path: pathSchema,
    contentHash: sha256Schema.optional(),
  }),
} as const;

export const partnerDeliveriesChangedChannel = {
  name: 'partner.deliveries.changed',
  direction: 'push',
  payload: z.object({
    sessionId: sessionIdSchema,
    id: idSchema.optional(),
    reason: z.enum(['created', 'updated', 'deleted', 'checkpoint', 'rollback']),
  }),
} as const;

export type PartnerDeliveryRootKindT = z.infer<typeof partnerDeliveryRootKindSchema>;
export type PartnerDeliveryKindT = z.infer<typeof partnerDeliveryKindSchema>;
export type PartnerDeliveryRefT = z.infer<typeof partnerDeliveryRefSchema>;
