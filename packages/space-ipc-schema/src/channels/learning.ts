import { z } from 'zod';

const boundedId = z.string().trim().min(1).max(256);
const boundedHash = z.string().trim().min(1).max(256);
const boundedTimestamp = z.string().trim().min(1).max(64).datetime({ offset: true });
const boundedName = z.string().trim().min(1).max(280);
const boundedSlug = z.string().trim().min(1).max(160);
const boundedEvidenceRef = z.string().trim().min(1).max(1_024);
const boundedCount = z.number().int().nonnegative().max(1_000_000);

// These three facts are display-only compatibility data. Keeping them bounded
// but open lets future Runtime values remain read-only instead of invalidating
// an entire list. Mutation inputs stay on the closed five-action allowlist.
export const learnedCapabilityCarrierSchema = z.string().trim().min(1).max(64);
export const learnedCapabilityLifecycleSchema = z.enum([
  'opportunity',
  'drafting',
  'ready',
  'testing',
  'active_learned',
  'promoted_user',
  'quarantined',
  'archived',
  'rejected',
]);
export const learnedCapabilityActionSchema = z.enum([
  'review',
  'trust',
  'reject',
  'disable',
  'rollback',
]);
export const learnedCapabilitySourceSchema = z
  .object({
    kind: z.string().trim().min(1).max(64),
    proposalId: boundedId.optional(),
  })
  .strict();

const relativeArtifactPathSchema = z
  .string()
  .trim()
  .min(1)
  .max(1_024)
  .refine(
    (value) =>
      !value.startsWith('/') &&
      !value.startsWith('\\') &&
      !/^[A-Za-z]:[\\/]/.test(value) &&
      !value.includes('\0') &&
      !value.split(/[\\/]/).includes('..'),
    'artifact path must remain relative and traversal-free',
  );

export const learnedCapabilityArtifactSchema = z
  .object({
    kind: z.literal('skill_markdown'),
    relativePath: relativeArtifactPathSchema,
    fingerprint: boundedHash,
    contentRevision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  })
  .strict();

export const learnedCapabilityCanaryInvocationSchema = z
  .object({
    invocationId: boundedId,
    bindingId: boundedId,
    usageSessionHash: boundedHash.optional(),
    artifactRevision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(),
    artifactFingerprint: boundedHash.optional(),
    status: z.enum(['pending', 'verified_success', 'credible_negative', 'inconclusive']),
    evidenceRefs: z.array(boundedEvidenceRef).max(32),
    invokedAt: boundedTimestamp,
    completedAt: boundedTimestamp.optional(),
  })
  .strict();

const learnedCapabilityBaseShape = {
  capabilityId: boundedId,
  displayName: boundedName,
  slug: boundedSlug,
  carrier: learnedCapabilityCarrierSchema,
  lifecycle: learnedCapabilityLifecycleSchema,
  revision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  createdAt: boundedTimestamp,
  updatedAt: boundedTimestamp,
  source: learnedCapabilitySourceSchema,
  lastAction: z.string().trim().min(1).max(64).optional(),
  previousGoodRevision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(),
  previousLifecycle: learnedCapabilityLifecycleSchema.optional(),
  diagnostics: z.array(z.string().trim().min(1).max(2_048)).max(32).optional(),
  availableActions: z.array(learnedCapabilityActionSchema).max(5),
  readOnlyReason: z.string().trim().min(1).max(280).optional(),
} as const;

const learnedCapabilityProjectionV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    ...learnedCapabilityBaseShape,
    availableActions: z.array(learnedCapabilityActionSchema).length(0),
    readOnlyReason: z.string().trim().min(1).max(280),
  })
  .strict();

const learnedCapabilityProjectionV2Schema = z
  .object({
    schemaVersion: z.literal(2),
    ...learnedCapabilityBaseShape,
    carrier: z.literal('skill'),
    scope: z
      .object({
        configHomeHash: boundedHash,
        tenantHash: boundedHash,
        projectHash: boundedHash,
      })
      .strict(),
    artifact: learnedCapabilityArtifactSchema,
    previousGoodArtifact: learnedCapabilityArtifactSchema.optional(),
    provenance: z
      .object({
        jobId: boundedId,
        inputHash: boundedHash,
        decisionId: boundedId,
        actionId: boundedId,
      })
      .strict(),
    canary: z
      .object({
        maxInvocations: z.literal(3),
        invocationCount: z.number().int().nonnegative().max(3),
        verifiedSuccesses: z.number().int().nonnegative().max(3),
        credibleNegatives: z.number().int().nonnegative().max(3),
        binding: z
          .object({
            bindingId: boundedId,
            ownerSessionRef: boundedId,
            expiresAt: boundedTimestamp,
          })
          .strict()
          .optional(),
        invocations: z.array(learnedCapabilityCanaryInvocationSchema).max(3),
      })
      .strict(),
  })
  .strict();

export const learnedCapabilityProjectionSchema = z.discriminatedUnion('schemaVersion', [
  learnedCapabilityProjectionV1Schema,
  learnedCapabilityProjectionV2Schema,
]);

export const learningSurfaceSnapshotSchema = z
  .object({
    ready: boundedCount,
    newlyActive: boundedCount,
    attention: boundedCount,
    active: boundedCount,
    revision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  })
  .strict();

export const learningEventSchema = z
  .object({
    schemaVersion: z.literal(1),
    sequence: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    eventId: boundedId,
    capabilityId: boundedId,
    capabilityRevision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    kind: z.enum([
      'opportunity',
      'drafting',
      'ready',
      'testing',
      'activated',
      'promoted',
      'attention',
      'archived',
      'rejected',
    ]),
    lifecycle: learnedCapabilityLifecycleSchema,
    displayName: boundedName,
    slug: boundedSlug,
    carrier: learnedCapabilityCarrierSchema,
    createdAt: boundedTimestamp,
  })
  .strict();

export const learningListChannel = {
  name: 'learning.list',
  direction: 'invoke',
  input: z
    .object({
      limit: z.number().int().min(1).max(100).default(50),
      cursor: z.string().trim().min(1).max(1_024).optional(),
    })
    .strict(),
  output: z
    .object({
      items: z.array(learnedCapabilityProjectionSchema).max(100),
      nextCursor: z.string().trim().min(1).max(1_024).optional(),
      revision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
      snapshot: learningSurfaceSnapshotSchema,
    })
    .strict(),
} as const;

export const learningGetChannel = {
  name: 'learning.get',
  direction: 'invoke',
  input: z.object({ capabilityId: boundedId }).strict(),
  output: z.object({ record: learnedCapabilityProjectionSchema }).strict(),
} as const;

export const learningActionChannel = {
  name: 'learning.action',
  direction: 'invoke',
  input: z
    .object({
      action: learnedCapabilityActionSchema,
      capabilityId: boundedId,
      expectedRevision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
      expectedFingerprint: boundedHash.optional(),
    })
    .strict(),
  output: z
    .object({
      record: learnedCapabilityProjectionSchema,
      snapshot: learningSurfaceSnapshotSchema,
    })
    .strict(),
} as const;

export const learningAcknowledgeChannel = {
  name: 'learning.acknowledge',
  direction: 'invoke',
  input: z.object({ capabilityId: boundedId }).strict(),
  output: z.object({ snapshot: learningSurfaceSnapshotSchema }).strict(),
} as const;

export const learningChangedChannel = {
  name: 'learning.changed',
  direction: 'push',
  payload: z.discriminatedUnion('kind', [
    z
      .object({
        kind: z.literal('event'),
        runtimeId: boundedId,
        event: learningEventSchema,
      })
      .strict(),
    z
      .object({
        kind: z.literal('snapshot'),
        runtimeId: boundedId,
        reason: z.enum(['initial', 'cursor_gap', 'runtime_changed', 'reconnected']),
        snapshot: learningSurfaceSnapshotSchema,
      })
      .strict(),
    z
      .object({
        kind: z.literal('status'),
        runtimeId: boundedId.optional(),
        state: z.enum(['connected', 'reconnecting']),
        message: z.string().trim().min(1).max(280).optional(),
      })
      .strict(),
  ]),
} as const;

export type LearnedCapabilityCarrierT = z.infer<typeof learnedCapabilityCarrierSchema>;
export type LearnedCapabilityLifecycleT = z.infer<typeof learnedCapabilityLifecycleSchema>;
export type LearnedCapabilityActionT = z.infer<typeof learnedCapabilityActionSchema>;
export type LearnedCapabilityProjectionT = z.infer<typeof learnedCapabilityProjectionSchema>;
export type LearningSurfaceSnapshotT = z.infer<typeof learningSurfaceSnapshotSchema>;
export type LearningEventT = z.infer<typeof learningEventSchema>;
