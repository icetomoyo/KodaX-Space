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
const deliveryUriIdSchema = idSchema.regex(/^[A-Za-z0-9_-]+$/);
const sessionIdSchema = z.string().min(1).max(128);
const pathSchema = z
  .string()
  .min(1)
  .max(4096)
  .refine((s) => !hasPathControlChar(s), { message: 'path contains control characters' });

const sha256Schema = z.string().regex(/^sha256:[a-f0-9]{64}$/);

export const PARTNER_DELIVERY_URI_PREFIX = 'kodax-space://partner-delivery/';

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

export const partnerDeliveryReferenceSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('id'), id: idSchema }),
  z.object({ type: z.literal('path'), path: pathSchema }),
]);

export const partnerDeliveryResolveStatusSchema = z.enum([
  'found',
  'not-found',
  'missing',
  'ambiguous',
]);

export function formatPartnerDeliveryUri(id: string): string {
  return `${PARTNER_DELIVERY_URI_PREFIX}${encodeURIComponent(deliveryUriIdSchema.parse(id))}`;
}

export function parsePartnerDeliveryUri(uri: string): string | null {
  if (!uri.toLowerCase().startsWith(PARTNER_DELIVERY_URI_PREFIX)) return null;
  const encoded = uri.slice(PARTNER_DELIVERY_URI_PREFIX.length);
  if (!encoded || /[/?#]/.test(encoded)) return null;
  try {
    const parsed = deliveryUriIdSchema.safeParse(decodeURIComponent(encoded));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function comparableDeliveryPaths(rawPath: string): ReadonlySet<string> {
  let decoded = rawPath.trim();
  try {
    decoded = decodeURIComponent(decoded);
  } catch {
    // A literal '%' in an agent-produced path is still a valid filename candidate.
  }
  const normalized = decoded.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '');
  const lower = normalized.toLowerCase();
  const aliases = new Set([lower]);
  if (lower.startsWith('partner-output/')) aliases.add(lower.slice('partner-output/'.length));
  return aliases;
}

/** True when a chat-visible path belongs to Partner's reserved logical output namespace. */
export function isPartnerOutputLogicalPath(rawPath: string): boolean {
  const normalized = rawPath.trim().replace(/\\/g, '/').replace(/^\.\//, '').toLowerCase();
  return normalized.startsWith('partner-output/');
}

/** Match a chat-visible Partner output path to its delivery-registry record. */
export function partnerDeliveryPathMatches(
  delivery: { readonly relativePath: string; readonly absolutePath: string },
  rawPath: string,
): boolean {
  const targetAliases = comparableDeliveryPaths(rawPath);
  const deliveryAliases = new Set([
    ...comparableDeliveryPaths(delivery.relativePath),
    ...comparableDeliveryPaths(delivery.absolutePath),
  ]);
  for (const candidate of targetAliases) {
    if (deliveryAliases.has(candidate)) return true;
  }
  return false;
}

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

export const partnerDeliveriesResolveChannel = {
  name: 'partner.deliveries.resolve',
  direction: 'invoke',
  input: z.object({
    projectRoot: pathSchema,
    sessionId: sessionIdSchema.optional(),
    reference: partnerDeliveryReferenceSchema,
  }),
  output: z.object({
    status: partnerDeliveryResolveStatusSchema,
    delivery: partnerDeliveryRefSchema.nullable(),
  }),
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
export type PartnerDeliveryReferenceT = z.infer<typeof partnerDeliveryReferenceSchema>;
export type PartnerDeliveryResolveStatusT = z.infer<typeof partnerDeliveryResolveStatusSchema>;
