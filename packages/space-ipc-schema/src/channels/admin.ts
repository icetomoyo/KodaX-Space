import { z } from 'zod';

const safePathSchema = z
  .string()
  .min(1)
  .max(4096)
  .refine((s) => !/[\x00\r\n]/.test(s), { message: 'path contains control chars' });

const stringListSchema = z.array(z.string().min(1).max(256)).max(512);

export const adminPolicySchemaVersion = 'space-admin-policy/v1' as const;

const workspaceDeliveriesPolicySchema = z.object({
  writeAllowed: z.boolean(),
  workspaceWriteAllowed: z.boolean(),
  registerWorkspaceAllowed: z.boolean(),
  allowedExtensions: stringListSchema,
});

export const adminAuditCategorySchema = z.enum([
  'source',
  'connector',
  'artifact',
  'workspace-file',
  'automation',
  'remote-runner',
  'desktop-automation',
  'policy',
]);

export const adminAuditOutcomeSchema = z.enum(['allowed', 'blocked', 'failed', 'info']);

export const adminPolicySchema = z.object({
  schema: z.literal(adminPolicySchemaVersion),
  providers: z.object({
    allow: stringListSchema,
    deny: stringListSchema,
  }),
  mcp: z.object({
    allow: stringListSchema,
    deny: stringListSchema,
  }),
  connectors: z.object({
    allow: stringListSchema,
    deny: stringListSchema,
    writesAllowed: z.boolean(),
  }),
  artifact: z.object({
    generateOfficeAllowed: z.boolean(),
    exportAllowed: z.boolean(),
  }),
  workspaceFileProposals: z.object({
    createAllowed: z.boolean(),
    applyAllowed: z.boolean(),
    exportAllowed: z.boolean(),
    allowedExtensions: stringListSchema,
  }),
  workspaceDeliveries: workspaceDeliveriesPolicySchema.default({
    writeAllowed: true,
    workspaceWriteAllowed: false,
    registerWorkspaceAllowed: false,
    allowedExtensions: [],
  }),
  automation: z.object({
    enabled: z.boolean(),
    connectorWritesAllowed: z.boolean(),
    filesystemExportsAllowed: z.boolean(),
  }),
  remoteRunner: z.object({
    enabled: z.boolean(),
  }),
  desktopAutomation: z.object({
    enabled: z.boolean(),
  }),
  redaction: z.object({
    enabled: z.boolean(),
    extraPatterns: z.array(z.string().min(1).max(512)).max(128),
  }),
  userOverrides: z.object({
    allowed: z.boolean(),
    requireReason: z.boolean(),
  }),
  updatedAt: z.number().int().nonnegative(),
});

export const adminPolicyUpdateSchema = z.object({
  providers: adminPolicySchema.shape.providers.partial().optional(),
  mcp: adminPolicySchema.shape.mcp.partial().optional(),
  connectors: adminPolicySchema.shape.connectors.partial().optional(),
  artifact: adminPolicySchema.shape.artifact.partial().optional(),
  workspaceFileProposals: adminPolicySchema.shape.workspaceFileProposals.partial().optional(),
  workspaceDeliveries: workspaceDeliveriesPolicySchema.partial().optional(),
  automation: adminPolicySchema.shape.automation.partial().optional(),
  remoteRunner: adminPolicySchema.shape.remoteRunner.partial().optional(),
  desktopAutomation: adminPolicySchema.shape.desktopAutomation.partial().optional(),
  redaction: adminPolicySchema.shape.redaction.partial().optional(),
  userOverrides: adminPolicySchema.shape.userOverrides.partial().optional(),
});

export const adminAuditEventSchema = z.object({
  id: z.string().min(1).max(128),
  createdAt: z.number().int().nonnegative(),
  category: adminAuditCategorySchema,
  action: z.string().min(1).max(128),
  outcome: adminAuditOutcomeSchema,
  projectRoot: safePathSchema.optional(),
  sessionId: z.string().min(1).max(256).optional(),
  resource: z.string().min(1).max(512).optional(),
  details: z.string().max(4000),
  redacted: z.boolean(),
});

export const adminPolicyGetChannel = {
  name: 'admin.policy.get',
  direction: 'invoke',
  input: z.undefined(),
  output: z.object({
    policy: adminPolicySchema,
    source: z.enum(['default', 'local-file']),
  }),
} as const;

export const adminPolicySetChannel = {
  name: 'admin.policy.set',
  direction: 'invoke',
  input: adminPolicyUpdateSchema,
  output: z.object({
    policy: adminPolicySchema,
    diagnostics: z.array(z.string().min(1).max(1000)).max(100),
  }),
} as const;

export const adminPolicyExportChannel = {
  name: 'admin.policy.export',
  direction: 'invoke',
  input: z.undefined(),
  output: z.object({
    filename: z.string().min(1).max(256),
    json: z.string().max(512_000),
  }),
} as const;

export const adminAuditListChannel = {
  name: 'admin.audit.list',
  direction: 'invoke',
  input: z
    .object({
      category: adminAuditCategorySchema.optional(),
      limit: z.number().int().min(1).max(1000).optional(),
    })
    .optional(),
  output: z.object({
    events: z.array(adminAuditEventSchema).max(1000),
  }),
} as const;

export const adminAuditExportChannel = {
  name: 'admin.audit.export',
  direction: 'invoke',
  input: z
    .object({
      category: adminAuditCategorySchema.optional(),
      limit: z.number().int().min(1).max(10_000).optional(),
    })
    .optional(),
  output: z.object({
    filename: z.string().min(1).max(256),
    jsonl: z.string().max(10_000_000),
  }),
} as const;

export type AdminAuditCategoryT = z.infer<typeof adminAuditCategorySchema>;
export type AdminAuditOutcomeT = z.infer<typeof adminAuditOutcomeSchema>;
export type AdminPolicyT = z.infer<typeof adminPolicySchema>;
export type AdminPolicyUpdateT = z.infer<typeof adminPolicyUpdateSchema>;
export type AdminAuditEventT = z.infer<typeof adminAuditEventSchema>;
