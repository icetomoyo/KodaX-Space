import { z } from 'zod';

const safePathSchema = z
  .string()
  .min(1)
  .max(4096)
  .refine((s) => !/[\x00\r\n]/.test(s), { message: 'path contains control chars' });

const sourceIdSchema = z.string().min(1).max(128);
const sessionIdSchema = z.string().min(1).max(128);

export const partnerSourceKindSchema = z.enum(['workspace_path']);
export const partnerSourceTargetKindSchema = z.enum(['file', 'dir']);

export const partnerSourceSchema = z.object({
  id: sourceIdSchema,
  sessionId: sessionIdSchema,
  kind: partnerSourceKindSchema,
  projectRoot: safePathSchema,
  path: safePathSchema,
  targetKind: partnerSourceTargetKindSchema,
  label: z.string().min(1).max(256).optional(),
  addedAt: z.number().int().nonnegative(),
});

export const partnerSourcesListChannel = {
  name: 'partner.sources.list',
  direction: 'invoke',
  input: z.object({
    sessionId: sessionIdSchema,
    projectRoot: safePathSchema,
  }),
  output: z.object({
    sources: z.array(partnerSourceSchema).max(512),
  }),
} as const;

export const partnerSourcesAddChannel = {
  name: 'partner.sources.add',
  direction: 'invoke',
  input: z.object({
    sessionId: sessionIdSchema,
    kind: z.literal('workspace_path').optional(),
    projectRoot: safePathSchema,
    path: safePathSchema,
    targetKind: partnerSourceTargetKindSchema.optional(),
    label: z.string().min(1).max(256).optional(),
  }),
  output: z.object({
    source: partnerSourceSchema,
  }),
} as const;

export const partnerSourcesRemoveChannel = {
  name: 'partner.sources.remove',
  direction: 'invoke',
  input: z.object({
    sessionId: sessionIdSchema,
    projectRoot: safePathSchema,
    sourceId: sourceIdSchema,
  }),
  output: z.object({
    removed: z.boolean(),
  }),
} as const;

export type PartnerSourceKindT = z.infer<typeof partnerSourceKindSchema>;
export type PartnerSourceTargetKindT = z.infer<typeof partnerSourceTargetKindSchema>;
export type PartnerSourceT = z.infer<typeof partnerSourceSchema>;
