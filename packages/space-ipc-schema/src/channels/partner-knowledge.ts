import { z } from 'zod';

const opaqueId = (prefix: string) =>
  z
    .string()
    .min(prefix.length + 8)
    .max(128)
    .regex(new RegExp(`^${prefix}[A-Za-z0-9_-]+$`));

const safePathSchema = z
  .string()
  .min(1)
  .max(4096)
  .refine((value) => !/[\x00\r\n]/.test(value), { message: 'path contains control chars' });

const projectRootSchema = safePathSchema;
const snapshotRefSchema = z
  .string()
  .min(1)
  .max(4096)
  .refine(
    (value) =>
      !value.includes('\\') &&
      !value.startsWith('/') &&
      value.split('/').every((part) => part !== '' && part !== '.' && part !== '..'),
    { message: 'snapshotRef must be a safe relative store reference' },
  );
const sessionIdSchema = z.string().min(1).max(128);
const sourceIdSchema = opaqueId('src_');
const sourceVersionIdSchema = opaqueId('sv_');
const citationIdSchema = opaqueId('cite_');
const traceIdSchema = opaqueId('trace_');
const materialRelationIdSchema = opaqueId('rel_');

export const partnerKnowledgeScopeSchema = z.enum(['project-grounded', 'selected-only', 'general']);

export const partnerIngestionStatusSchema = z.enum([
  'pending',
  'indexing',
  'ready',
  'stale',
  'failed',
  'unavailable',
]);

export const partnerEvidenceLocatorSchema = z.union([
  z
    .object({
      kind: z.literal('text_line'),
      startLine: z.number().int().positive(),
      endLine: z.number().int().positive(),
      heading: z.string().min(1).max(512).optional(),
    })
    .refine((value) => value.endLine >= value.startLine, {
      message: 'endLine must be greater than or equal to startLine',
    }),
  z.object({ kind: z.literal('pdf_page'), page: z.number().int().positive() }),
  z.object({
    kind: z.literal('docx_paragraph'),
    paragraph: z.number().int().positive(),
    heading: z.string().min(1).max(512).optional(),
  }),
  z.object({ kind: z.literal('pptx_slide'), slide: z.number().int().positive() }),
  z.object({
    kind: z.literal('xlsx_range'),
    sheet: z.string().min(1).max(256),
    range: z.string().min(1).max(64),
  }),
  z.object({
    kind: z.literal('file'),
    reason: z.enum(['unsupported_exact_locator', 'legacy']),
  }),
]);

export const partnerSourceErrorSchema = z.object({
  code: z.string().min(1).max(96),
  message: z.string().min(1).max(512),
  occurredAt: z.number().int().nonnegative(),
});

export const partnerProjectSourceSchema = z.object({
  id: sourceIdSchema,
  projectRoot: projectRootSchema,
  path: safePathSchema,
  kind: z.literal('workspace_path'),
  targetKind: z.enum(['file', 'dir']),
  label: z.string().min(1).max(256),
  currentVersionId: sourceVersionIdSchema.optional(),
  ingestionStatus: partnerIngestionStatusSchema,
  selected: z.boolean(),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
  lastError: partnerSourceErrorSchema.optional(),
});

const builtInEvidenceOwnerSchema = z
  .object({
    kind: z.enum(['project-source', 'task-attachment-snapshot']),
    ownerId: z.string().min(1).max(128),
    adapterId: z.never().optional(),
  })
  .strict();
const externalEvidenceOwnerSchema = z
  .object({
    kind: z.enum([
      'web-fetch-snapshot',
      'browser-capture',
      'connector-snapshot',
      'result-snapshot',
    ]),
    ownerId: z.string().min(1).max(128),
    adapterId: z.string().min(1).max(128),
  })
  .strict();
export const partnerEvidenceOwnerIdentitySchema = z.union([
  builtInEvidenceOwnerSchema,
  externalEvidenceOwnerSchema,
]);

export const partnerEvidenceVersionSelectorSchema = z.discriminatedUnion('policy', [
  z.object({ policy: z.literal('pinned'), versionId: z.string().min(1).max(128) }).strict(),
  z.object({ policy: z.literal('current-at-run') }).strict(),
]);

export const partnerEvidenceSelectionRefSchema = z.union([
  builtInEvidenceOwnerSchema.extend({ version: partnerEvidenceVersionSelectorSchema }).strict(),
  externalEvidenceOwnerSchema.extend({ version: partnerEvidenceVersionSelectorSchema }).strict(),
]);

const evidenceVersionFields = {
  versionId: z.string().min(1).max(128),
  unitId: z.string().min(1).max(128).optional(),
};
export const partnerEvidenceOwnerVersionRefSchema = z.union([
  builtInEvidenceOwnerSchema.extend(evidenceVersionFields).strict(),
  externalEvidenceOwnerSchema.extend(evidenceVersionFields).strict(),
]);

export const partnerProjectMaterialTargetSchema = z.union([
  z.object({ kind: z.literal('project-source'), sourceId: sourceIdSchema }).strict(),
  z
    .object({
      kind: z.literal('evidence'),
      evidenceRef: partnerEvidenceOwnerVersionRefSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal('result'),
      resultOwner: z.enum(['artifact', 'delivery', 'presentation-project']),
      resultOwnerId: z.string().min(1).max(128),
      resultOwnerVersionId: z.string().min(1).max(128),
      ownerSubresourceId: z.string().min(1).max(128).optional(),
      searchable: z.boolean(),
      resultSnapshotRef: partnerEvidenceOwnerVersionRefSchema.optional(),
    })
    .strict()
    .superRefine((value, context) => {
      if (value.searchable && value.resultSnapshotRef?.kind !== 'result-snapshot') {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'searchable results require an exact result-snapshot reference',
          path: ['resultSnapshotRef'],
        });
      }
      if (!value.searchable && value.resultSnapshotRef !== undefined) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'non-searchable results cannot carry a result snapshot',
          path: ['resultSnapshotRef'],
        });
      }
    }),
]);

export const partnerProjectMaterialRelationSchema = z
  .object({
    id: materialRelationIdSchema,
    projectRoot: projectRootSchema,
    target: partnerProjectMaterialTargetSchema,
    createdAt: z.number().int().nonnegative(),
    createdBy: z.enum(['user', 'migration']),
    supersedesRelationId: materialRelationIdSchema.optional(),
    lifecycle: z.enum(['active', 'removed']),
    removedAt: z.number().int().nonnegative().optional(),
    removalReasonCode: z.string().min(1).max(96).optional(),
  })
  .superRefine((value, context) => {
    if (value.lifecycle === 'active' && value.removedAt !== undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'active relation cannot be removed',
      });
    }
    if (value.lifecycle === 'removed' && value.removedAt === undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'removed relation needs removedAt',
      });
    }
  });

export const partnerMaterialSelectionSchema = z.object({
  sessionId: sessionIdSchema,
  projectRoot: projectRootSchema,
  materialRelationId: materialRelationIdSchema,
  selectedTarget: partnerProjectMaterialTargetSchema,
  version: partnerEvidenceVersionSelectorSchema.optional(),
  selectedAt: z.number().int().nonnegative(),
});

export const partnerEvidenceAccessObservationSchema = z.object({
  ownerRef: partnerEvidenceOwnerIdentitySchema,
  versionId: z.string().min(1).max(128),
  liveAvailability: z.enum(['current', 'stale', 'missing', 'deleted']),
  originAccess: z.enum(['authorized', 'revoked', 'unknown']),
  retainedSnapshotUse: z.enum(['permitted', 'audit-only', 'restricted']),
  retainedContentAvailability: z.enum(['present', 'missing', 'forgotten', 'corrupt']),
  reasonCode: z.string().min(1).max(96).optional(),
  observedAt: z.number().int().nonnegative(),
});

export const partnerEvidenceAccessDecisionSchema = z.object({
  observation: partnerEvidenceAccessObservationSchema,
  decision: z.enum(['include', 'metadata-only', 'exclude']),
  boundedReasonCode: z.string().min(1).max(96),
});

export const partnerSourceVersionSchema = z.object({
  id: sourceVersionIdSchema,
  sourceId: sourceIdSchema,
  contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  parserGeneration: z.string().min(1).max(64),
  chunkerGeneration: z.string().min(1).max(64),
  snapshotRef: snapshotRefSchema,
  byteSize: z
    .number()
    .int()
    .nonnegative()
    .max(1024 * 1024 * 1024),
  modifiedAt: z.number().int().nonnegative().optional(),
  createdAt: z.number().int().nonnegative(),
  indexedAt: z.number().int().nonnegative().optional(),
});

export const partnerEvidenceUnitSchema = z.object({
  id: opaqueId('unit_'),
  ordinal: z.number().int().nonnegative(),
  relativePath: safePathSchema.optional(),
  text: z.string().min(1).max(64_000),
  locator: partnerEvidenceLocatorSchema,
});

export const partnerKnowledgeTraceItemSchema = z.object({
  citationId: citationIdSchema,
  sourceId: sourceIdSchema,
  sourceVersionId: sourceVersionIdSchema,
  label: z.string().min(1).max(512),
  matchReason: z.string().min(1).max(256),
  freshness: z.enum(['current', 'stale']),
});

export const partnerKnowledgePageVersionRefSchema = z.object({
  pageId: z.string().min(1).max(128),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  updatedAt: z.number().int().nonnegative(),
});

function sameStringSet(left: readonly string[], right: readonly string[]): boolean {
  const normalizedLeft = [...new Set(left)].sort();
  const normalizedRight = [...new Set(right)].sort();
  return (
    normalizedLeft.length === normalizedRight.length &&
    normalizedLeft.every((value, index) => value === normalizedRight[index])
  );
}

export const partnerKnowledgeTraceSchema = z
  .object({
    traceId: traceIdSchema,
    sessionId: sessionIdSchema,
    scope: partnerKnowledgeScopeSchema,
    createdAt: z.number().int().nonnegative(),
    notices: z
      .array(
        z.enum([
          'no_evidence',
          'unavailable_evidence',
          'retrieval_unavailable',
          'conflict',
          'truncated',
        ]),
      )
      .max(16),
    selectedMaterialRelationIds: z.array(materialRelationIdSchema).max(512),
    selectedEvidenceOwnerRefs: z.array(partnerEvidenceSelectionRefSchema).max(512),
    usedEvidenceOwnerVersionRefs: z.array(partnerEvidenceOwnerVersionRefSchema).max(64),
    usedKnowledgePageVersionRefs: z.array(partnerKnowledgePageVersionRefSchema).max(64),
    accessDecisions: z.array(partnerEvidenceAccessDecisionSchema).max(512),
    // Read-only compatibility projections for the built-in project-source adapter.
    selectedSourceIds: z.array(sourceIdSchema).max(512),
    usedSourceIds: z.array(sourceIdSchema).max(64),
    usedSourceVersionIds: z.array(sourceVersionIdSchema).max(64),
    items: z.array(partnerKnowledgeTraceItemSchema).max(64),
    budget: z.object({
      usedChars: z.number().int().nonnegative(),
      maxChars: z.number().int().positive().max(1_000_000),
    }),
  })
  .superRefine((value, context) => {
    const selectedSourceIds = value.selectedEvidenceOwnerRefs.flatMap((ref) =>
      ref.kind === 'project-source' ? [ref.ownerId] : [],
    );
    const usedSourceRefs = value.usedEvidenceOwnerVersionRefs.filter(
      (ref) => ref.kind === 'project-source',
    );
    if (!sameStringSet(value.selectedSourceIds, selectedSourceIds)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'selectedSourceIds must be derived from selectedEvidenceOwnerRefs',
        path: ['selectedSourceIds'],
      });
    }
    if (
      !sameStringSet(
        value.usedSourceIds,
        usedSourceRefs.map((ref) => ref.ownerId),
      )
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'usedSourceIds must be derived from usedEvidenceOwnerVersionRefs',
        path: ['usedSourceIds'],
      });
    }
    if (
      !sameStringSet(
        value.usedSourceVersionIds,
        usedSourceRefs.map((ref) => ref.versionId),
      )
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'usedSourceVersionIds must be derived from usedEvidenceOwnerVersionRefs',
        path: ['usedSourceVersionIds'],
      });
    }
  });

export const partnerCitationResolutionSchema = z.object({
  citationId: citationIdSchema,
  sourceId: sourceIdSchema,
  sourceVersionId: sourceVersionIdSchema,
  sourceLabel: z.string().min(1).max(256),
  relativePath: safePathSchema,
  locator: partnerEvidenceLocatorSchema,
  locatorLabel: z.string().min(1).max(512),
  excerpt: z.string().max(8_000),
  freshness: z.enum(['current', 'stale', 'missing']),
  capturedAt: z.number().int().nonnegative(),
  accessDecision: partnerEvidenceAccessDecisionSchema,
});

export const partnerKnowledgeCatalogChannel = {
  name: 'partner.sources.catalog',
  direction: 'invoke',
  input: z
    .object({ projectRoot: projectRootSchema, sessionId: sessionIdSchema.optional() })
    .strict(),
  output: z.object({
    sources: z.array(partnerProjectSourceSchema).max(512),
    truncated: z.boolean(),
  }),
} as const;

export const partnerKnowledgeSelectChannel = {
  name: 'partner.sources.select',
  direction: 'invoke',
  input: z
    .object({
      projectRoot: projectRootSchema,
      sessionId: sessionIdSchema,
      sourceId: sourceIdSchema,
      selected: z.boolean(),
    })
    .strict(),
  output: z.object({ source: partnerProjectSourceSchema }),
} as const;

export const partnerKnowledgeRefreshChannel = {
  name: 'partner.sources.refresh',
  direction: 'invoke',
  input: z.object({ projectRoot: projectRootSchema, sourceId: sourceIdSchema }).strict(),
  output: z.object({ source: partnerProjectSourceSchema }),
} as const;

export const partnerKnowledgeScopeSetChannel = {
  name: 'partner.knowledge.scope.set',
  direction: 'invoke',
  input: z
    .object({
      projectRoot: projectRootSchema,
      sessionId: sessionIdSchema,
      scope: partnerKnowledgeScopeSchema,
    })
    .strict(),
  output: z.object({ scope: partnerKnowledgeScopeSchema }),
} as const;

export const partnerMaterialsCatalogChannel = {
  name: 'partner.materials.catalog',
  direction: 'invoke',
  input: z
    .object({ projectRoot: projectRootSchema, sessionId: sessionIdSchema.optional() })
    .strict(),
  output: z.object({
    relations: z.array(partnerProjectMaterialRelationSchema).max(10_000),
    selections: z.array(partnerMaterialSelectionSchema).max(10_000),
    scope: partnerKnowledgeScopeSchema.optional(),
    latestTrace: partnerKnowledgeTraceSchema.optional(),
  }),
} as const;

export const partnerMaterialsSelectChannel = {
  name: 'partner.materials.select',
  direction: 'invoke',
  input: z
    .object({
      projectRoot: projectRootSchema,
      sessionId: sessionIdSchema,
      materialRelationId: materialRelationIdSchema,
      selected: z.boolean(),
      version: partnerEvidenceVersionSelectorSchema.optional(),
    })
    .strict(),
  output: z.object({ selection: partnerMaterialSelectionSchema.nullable() }),
} as const;

export const partnerMaterialsAdoptChannel = {
  name: 'partner.materials.adopt',
  direction: 'invoke',
  input: z
    .object({
      projectRoot: projectRootSchema,
      sessionId: sessionIdSchema,
      target: partnerProjectMaterialTargetSchema,
      confirmed: z.literal(true),
    })
    .strict(),
  output: z.object({ relation: partnerProjectMaterialRelationSchema }),
} as const;

export const partnerMaterialsRemoveChannel = {
  name: 'partner.materials.remove',
  direction: 'invoke',
  input: z
    .object({
      projectRoot: projectRootSchema,
      sessionId: sessionIdSchema,
      materialRelationId: materialRelationIdSchema,
      confirmed: z.literal(true),
      reasonCode: z.string().min(1).max(96).optional(),
    })
    .strict(),
  output: z.object({ relation: partnerProjectMaterialRelationSchema }),
} as const;

export const partnerKnowledgeTraceReadChannel = {
  name: 'partner.knowledge.trace.read',
  direction: 'invoke',
  input: z
    .object({
      projectRoot: projectRootSchema,
      sessionId: sessionIdSchema,
      traceId: traceIdSchema,
    })
    .strict(),
  output: z.object({ trace: partnerKnowledgeTraceSchema.nullable() }),
} as const;

export const partnerCitationResolveChannel = {
  name: 'partner.citations.resolve',
  direction: 'invoke',
  input: z
    .object({
      projectRoot: projectRootSchema,
      sessionId: sessionIdSchema,
      citationId: citationIdSchema,
    })
    .strict(),
  output: z.object({ citation: partnerCitationResolutionSchema.nullable() }),
} as const;

export type PartnerKnowledgeScopeT = z.infer<typeof partnerKnowledgeScopeSchema>;
export type PartnerIngestionStatusT = z.infer<typeof partnerIngestionStatusSchema>;
export type PartnerEvidenceLocatorT = z.infer<typeof partnerEvidenceLocatorSchema>;
export type PartnerProjectSourceT = z.infer<typeof partnerProjectSourceSchema>;
export type PartnerEvidenceOwnerIdentityT = z.infer<typeof partnerEvidenceOwnerIdentitySchema>;
export type PartnerEvidenceVersionSelectorT = z.infer<typeof partnerEvidenceVersionSelectorSchema>;
export type PartnerEvidenceOwnerVersionRefT = z.infer<typeof partnerEvidenceOwnerVersionRefSchema>;
export type PartnerProjectMaterialTargetT = z.infer<typeof partnerProjectMaterialTargetSchema>;
export type PartnerProjectMaterialRelationT = z.infer<typeof partnerProjectMaterialRelationSchema>;
export type PartnerMaterialSelectionT = z.infer<typeof partnerMaterialSelectionSchema>;
export type PartnerEvidenceAccessObservationT = z.infer<
  typeof partnerEvidenceAccessObservationSchema
>;
export type PartnerEvidenceAccessDecisionT = z.infer<typeof partnerEvidenceAccessDecisionSchema>;
export type PartnerSourceVersionT = z.infer<typeof partnerSourceVersionSchema>;
export type PartnerEvidenceUnitT = z.infer<typeof partnerEvidenceUnitSchema>;
export type PartnerKnowledgeTraceT = z.infer<typeof partnerKnowledgeTraceSchema>;
export type PartnerCitationResolutionT = z.infer<typeof partnerCitationResolutionSchema>;
