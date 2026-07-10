import { Buffer } from 'node:buffer';
import { MAX_PARTNER_DELIVERY_INLINE_BYTES } from '@kodax-space/space-ipc-schema';
import { pushToRenderer } from '../ipc/push.js';
import { registerPartnerSpaceToolPolicy } from './partner-tools.js';
import { partnerDeliveryStore, type PartnerDeliveryStore } from './partner-delivery-store.js';
import {
  resolveSessionRunContext,
  type SdkToolExecutionContextLike,
} from './session-run-context.js';
import { adminPolicyAuditStore, type AdminPolicyAuditStore } from './admin-policy-audit-store.js';
import { decodePartnerBase64Strict } from './partner-file-guards.js';

type ToolHandler = (
  input: Record<string, unknown>,
  context?: SdkToolExecutionContextLike,
) => Promise<string>;

export const WRITE_PARTNER_DELIVERABLE_TOOL = {
  name: 'write_partner_deliverable',
  description: [
    'Create or replace an arbitrary Partner deliverable file inside this session output workspace.',
    'Use this for real task outputs of any format: markdown, data files, HTML, archives, media, generated configs, or other files.',
    'This tool does not write to the project root. It writes only to the Partner run output workspace and records the file in the delivery browser.',
    '',
    'Inputs:',
    '- relativePath: path inside the Partner output workspace.',
    '- content: UTF-8 text content, OR base64Content for binary content.',
    '- title/mime/sourceRefs are optional metadata shown in Space.',
  ].join('\n'),
  sideEffect: 'mutates-state' as const,
  input_schema: {
    type: 'object' as const,
    additionalProperties: false,
    properties: {
      relativePath: { type: 'string', description: 'Output-workspace-relative file path.' },
      content: { type: 'string', description: 'UTF-8 text content to write.' },
      base64Content: { type: 'string', description: 'Base64-encoded binary content to write.' },
      title: { type: 'string', description: 'Optional display title.' },
      mime: { type: 'string', description: 'Optional MIME type.' },
      sourceRefs: {
        type: 'array',
        items: { type: 'string' },
        description: 'Optional source/citation ids or labels that support this deliverable.',
      },
    },
    required: ['relativePath'],
  },
};

function sourceRefsFromInput(input: Record<string, unknown>): string[] {
  if (!Array.isArray(input.sourceRefs)) return [];
  return input.sourceRefs.filter((ref): ref is string => typeof ref === 'string');
}

function bytesFromInput(input: Record<string, unknown>): Buffer | string {
  const hasContent = typeof input.content === 'string';
  const hasBase64 = typeof input.base64Content === 'string';
  if (hasContent === hasBase64) {
    return 'Error: provide exactly one of content or base64Content.';
  }
  if (hasContent) {
    const bytes = Buffer.from(String(input.content), 'utf8');
    if (bytes.length > MAX_PARTNER_DELIVERY_INLINE_BYTES) {
      return `Error: content exceeds ${MAX_PARTNER_DELIVERY_INLINE_BYTES} bytes.`;
    }
    return bytes;
  }
  try {
    return decodePartnerBase64Strict(
      String(input.base64Content),
      MAX_PARTNER_DELIVERY_INLINE_BYTES,
    );
  } catch (err) {
    return `Error: ${err instanceof Error ? err.message : 'invalid base64Content'}.`;
  }
}

export function makeWritePartnerDeliverableHandler(
  store: PartnerDeliveryStore,
  auditStore: AdminPolicyAuditStore = adminPolicyAuditStore,
): ToolHandler {
  return async (input, toolContext) => {
    const ctx = resolveSessionRunContext(toolContext);
    if (!ctx) return 'Error: write_partner_deliverable was called outside an active session run.';
    if (ctx.surface !== 'partner') {
      return 'Error: write_partner_deliverable is only available in Partner sessions.';
    }
    const relativePath = typeof input.relativePath === 'string' ? input.relativePath : '';
    const bytes = bytesFromInput(input);
    if (typeof bytes === 'string') return bytes;
    try {
      await auditStore.assertDeliveryWriteAllowed({ relativePath });
      const delivery = await store.writeRunOutput({
        sessionId: ctx.sessionId,
        projectRoot: ctx.projectRoot,
        relativePath,
        bytes,
        ...(typeof input.title === 'string' ? { title: input.title } : {}),
        ...(typeof input.mime === 'string' ? { mime: input.mime } : {}),
        sourceRefs: sourceRefsFromInput(input),
        producer: WRITE_PARTNER_DELIVERABLE_TOOL.name,
      });
      await auditStore.record({
        category: 'workspace-file',
        action: 'delivery.writeRunOutput',
        outcome: 'allowed',
        projectRoot: ctx.projectRoot,
        sessionId: ctx.sessionId,
        resource: delivery.relativePath,
        details: {
          deliveryId: delivery.id,
          rootKind: delivery.rootKind,
          sizeBytes: delivery.sizeBytes,
          contentHash: delivery.contentHash,
        },
      });
      try {
        pushToRenderer('partner.deliveries.changed', {
          sessionId: ctx.sessionId,
          id: delivery.id,
          reason: 'created',
        });
      } catch {
        // Renderer may be gone; the registry is persisted.
      }
      return [
        `Partner deliverable written: ${delivery.title}`,
        `Delivery id: ${delivery.id}`,
        `Path: ${delivery.absolutePath}`,
        `Relative path: ${delivery.relativePath}`,
        `Bytes: ${delivery.sizeBytes ?? 0}`,
        `Hash: ${delivery.contentHash ?? 'n/a'}`,
        'It is recorded in the Partner delivery browser.',
      ].join('\n');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await auditStore.record({
        category: 'workspace-file',
        action: 'delivery.writeRunOutput',
        outcome: 'failed',
        projectRoot: ctx.projectRoot,
        sessionId: ctx.sessionId,
        resource: relativePath,
        details: { error: message.slice(0, 240) },
      });
      return `Error writing Partner deliverable: ${message.slice(0, 240)}`;
    }
  };
}

let registered = false;

export function _resetPartnerDeliveryToolRegistrationForTesting(): void {
  registered = false;
}

export function ensurePartnerDeliveryToolsRegistered(sdk: unknown): void {
  if (registered) return;
  const reg = (sdk as { registerTool?: (def: unknown) => () => void }).registerTool;
  if (typeof reg !== 'function') {
    console.warn('[partner-delivery] sdk.registerTool unavailable; delivery tools not registered');
    return;
  }
  reg({
    ...WRITE_PARTNER_DELIVERABLE_TOOL,
    handler: makeWritePartnerDeliverableHandler(partnerDeliveryStore),
  });
  registerPartnerSpaceToolPolicy({
    name: WRITE_PARTNER_DELIVERABLE_TOOL.name,
    scope: 'workspace-delivery',
    sideEffect: WRITE_PARTNER_DELIVERABLE_TOOL.sideEffect,
    description: 'Writes arbitrary Partner deliverable files inside the session output workspace.',
  });
  registered = true;
}
