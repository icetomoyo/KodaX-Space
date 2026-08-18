import { z } from 'zod';

export const MAX_SANDBOX_DIAGNOSTICS = 8;
export const MAX_SANDBOX_GUIDANCE = 6;
export const MAX_SANDBOX_STATUS_TEXT = 320;

export const sandboxReadinessSchema = z.enum([
  'checking',
  'ready',
  'setup-required',
  'unavailable',
]);

export const sandboxBackendSchema = z.enum([
  'windows-restricted-user',
  'macos-seatbelt',
  'linux-bubblewrap',
  'unsupported',
]);

export const sandboxLastOperationSchema = z
  .object({
    kind: z.enum(['refresh', 'setup']),
    outcome: z.enum([
      'ready',
      'setup-required',
      'cancelled',
      'unavailable',
      'not-needed',
      'failed',
    ]),
    attempted: z.boolean(),
    message: z.string().min(1).max(MAX_SANDBOX_STATUS_TEXT).optional(),
  })
  .strict();

export const sandboxStatusSchema = z
  .object({
    contractVersion: z.literal(1),
    sandboxVersion: z.literal(4),
    asrtVersion: z
      .string()
      .regex(/^\d+\.\d+\.\d+$/)
      .max(32),
    platform: z.enum(['darwin', 'linux', 'win32']),
    backend: sandboxBackendSchema,
    readiness: sandboxReadinessSchema,
    setup: z
      .object({
        canSetup: z.boolean(),
        mayElevate: z.boolean(),
        requiresElevation: z.boolean(),
      })
      .strict(),
    diagnosticCount: z.number().int().min(0).max(99),
    diagnostics: z
      .array(z.string().min(1).max(MAX_SANDBOX_STATUS_TEXT))
      .max(MAX_SANDBOX_DIAGNOSTICS),
    guidance: z.array(z.string().min(1).max(MAX_SANDBOX_STATUS_TEXT)).max(MAX_SANDBOX_GUIDANCE),
    revision: z.number().int().nonnegative(),
    checkedAt: z.string().datetime({ offset: true }),
    lastOperation: sandboxLastOperationSchema.nullable(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.diagnostics.length > value.diagnosticCount) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['diagnostics'],
        message: 'visible diagnostics cannot exceed diagnosticCount',
      });
    }
    if (value.setup.canSetup && value.readiness !== 'setup-required') {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['setup', 'canSetup'],
        message: 'setup is only available when readiness is setup-required',
      });
    }
    if (value.setup.canSetup && value.platform !== 'win32') {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['setup', 'canSetup'],
        message: 'automatic setup is only available on Windows',
      });
    }
    if (value.setup.requiresElevation && !value.setup.mayElevate) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['setup', 'requiresElevation'],
        message: 'required elevation must be advertised by the capability',
      });
    }
    if (value.setup.requiresElevation !== value.setup.canSetup) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['setup', 'requiresElevation'],
        message: 'the current setup path requires an explicit Windows elevation confirmation',
      });
    }
  });

export const sandboxStatusChannel = {
  name: 'sandbox.status',
  direction: 'invoke',
  input: z.undefined(),
  output: sandboxStatusSchema,
} as const;

export const sandboxRefreshChannel = {
  name: 'sandbox.refresh',
  direction: 'invoke',
  input: z.undefined(),
  output: sandboxStatusSchema,
} as const;

export const sandboxSetupChannel = {
  name: 'sandbox.setup',
  direction: 'invoke',
  input: z
    .object({
      expectedRevision: z.number().int().nonnegative(),
      confirmation: z.literal('allow-sandbox-setup'),
    })
    .strict(),
  output: sandboxStatusSchema,
} as const;

export type SandboxReadinessT = z.infer<typeof sandboxReadinessSchema>;
export type SandboxBackendT = z.infer<typeof sandboxBackendSchema>;
export type SandboxLastOperationT = z.infer<typeof sandboxLastOperationSchema>;
export type SandboxStatusT = z.infer<typeof sandboxStatusSchema>;
