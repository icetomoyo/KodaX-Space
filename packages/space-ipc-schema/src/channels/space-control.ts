import { z } from 'zod';

export const spaceActionIdSchema = z.enum([
  'ui.theme.set',
  'ui.language.set',
  'ui.surface.set',
  'ui.settings.open',
  'ui.leftSidebar.setOpen',
  'ui.taskDock.setOpen',
  'ui.taskDock.widthMode.set',
  'settings.reasoningMode.setDefault',
]);
export type SpaceActionIdT = z.infer<typeof spaceActionIdSchema>;

export const spaceActionValueSchema = z.union([z.string().min(1).max(64), z.boolean()]);
export type SpaceActionValueT = z.infer<typeof spaceActionValueSchema>;

export const spaceActionArgsSchema = z.object({ value: spaceActionValueSchema }).strict();
export type SpaceActionArgsT = z.infer<typeof spaceActionArgsSchema>;

export const spaceControlRequestedChannel = {
  name: 'spaceControl.requested',
  direction: 'push',
  payload: z
    .object({
      requestId: z.string().uuid(),
      operation: z.enum(['inspect', 'apply']),
      actionId: spaceActionIdSchema,
      args: spaceActionArgsSchema.optional(),
      expectedRevision: z.number().int().min(0).optional(),
      expectedRendererInstanceId: z.string().uuid().optional(),
    })
    .strict()
    .superRefine((value, ctx) => {
      if (
        value.operation === 'inspect' &&
        (value.args !== undefined ||
          value.expectedRevision !== undefined ||
          value.expectedRendererInstanceId !== undefined)
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'inspect must not include apply-only fields',
        });
      }
      if (
        value.operation === 'apply' &&
        (!value.args ||
          value.expectedRevision === undefined ||
          value.expectedRendererInstanceId === undefined)
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'apply requires args, expectedRevision, and expectedRendererInstanceId',
        });
      }
    }),
} as const;

export const spaceControlResultSchema = z
  .object({
    requestId: z.string().uuid(),
    actionId: spaceActionIdSchema,
    status: z.enum(['available', 'applied', 'unchanged', 'denied', 'failed', 'unknown']),
    revision: z.number().int().min(0),
    rendererInstanceId: z.string().uuid().optional(),
    safeState: spaceActionValueSchema.optional(),
    summaryKey: z.string().regex(/^[a-z][a-zA-Z0-9_.-]{0,95}$/),
    reasonCode: z
      .string()
      .regex(/^[a-z][a-z0-9_.-]{0,79}$/)
      .optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      ['available', 'applied', 'unchanged', 'denied', 'failed'].includes(value.status) &&
      value.rendererInstanceId === undefined
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'renderer-owned result requires rendererInstanceId',
      });
    }
  });
export type SpaceControlResultT = z.infer<typeof spaceControlResultSchema>;

export const spaceControlResolveChannel = {
  name: 'spaceControl.resolve',
  direction: 'invoke',
  input: spaceControlResultSchema,
  output: z.object({ accepted: z.literal(true) }).strict(),
} as const;
