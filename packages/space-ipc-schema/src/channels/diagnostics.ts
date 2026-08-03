import { z } from 'zod';

export const diagnosticsLevelSchema = z.enum(['debug', 'info', 'warn', 'error']);
export const diagnosticsComponentSchema = z.enum([
  'renderer',
  'react',
  'shell',
  'settings',
  'artifact',
  'partner',
  'workflow',
  'space-control',
]);
export const diagnosticsExportCategorySchema = z.enum([
  'manifest',
  'logs',
  'capabilities',
  'release',
  'degradations',
]);

const rendererDiagnosticContextSchema = z
  .record(
    z.string().regex(/^[a-z][a-zA-Z0-9_.-]{0,63}$/),
    z.union([z.string().max(512), z.number().finite(), z.boolean(), z.null()]),
  )
  .superRefine((value, ctx) => {
    if (Object.keys(value).length > 16) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'context is limited to 16 keys' });
    }
  });

export const diagnosticsReportChannel = {
  name: 'diagnostics.report',
  direction: 'invoke',
  input: z
    .object({
      level: diagnosticsLevelSchema,
      component: diagnosticsComponentSchema,
      event: z.string().regex(/^[a-z][a-z0-9_.-]{0,79}$/),
      message: z.string().max(2048).optional(),
      context: rendererDiagnosticContextSchema.optional(),
    })
    .strict(),
  output: z.object({ accepted: z.literal(true) }).strict(),
} as const;

export const diagnosticsExportChannel = {
  name: 'diagnostics.export',
  direction: 'invoke',
  input: z
    .object({
      categories: z.array(diagnosticsExportCategorySchema).min(1).max(5).optional(),
      /** Current Coder session, used only for metadata-only Runtime diagnostics. */
      sessionId: z.string().min(1).max(128).optional(),
    })
    .strict(),
  output: z.discriminatedUnion('status', [
    z.object({ status: z.literal('cancelled') }).strict(),
    z.object({ status: z.literal('saved'), fileName: z.string().min(1).max(255) }).strict(),
  ]),
} as const;

export type DiagnosticsExportCategory = z.infer<typeof diagnosticsExportCategorySchema>;
