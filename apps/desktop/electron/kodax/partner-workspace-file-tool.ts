import { Buffer } from 'node:buffer';
import path from 'node:path';
import { MAX_PARTNER_DELIVERY_INLINE_BYTES } from '@kodax-space/space-ipc-schema';
import { pushToRenderer } from '../ipc/push.js';
import { adminPolicyAuditStore, type AdminPolicyAuditStore } from './admin-policy-audit-store.js';
import { partnerCheckpointStore, type PartnerCheckpointStore } from './partner-checkpoint-store.js';
import { partnerDeliveryStore, type PartnerDeliveryStore } from './partner-delivery-store.js';
import { registerPartnerSpaceToolPolicy } from './partner-tools.js';
import {
  resolveSessionRunContext,
  type SdkToolExecutionContextLike,
} from './session-run-context.js';
import { decodePartnerBase64Strict } from './partner-file-guards.js';
import {
  partnerDeliveryMarkdownLink,
  partnerDeliveryReferenceLine,
} from './partner-delivery-reference.js';

type ToolHandler = (
  input: Record<string, unknown>,
  context?: SdkToolExecutionContextLike,
) => Promise<string>;

export const WRITE_PARTNER_WORKSPACE_FILE_TOOL = {
  name: 'write_partner_workspace_file',
  description: [
    'Create or replace one project workspace file with a Partner checkpoint and rollback metadata.',
    'Use only for lightweight working-agent boosts: small generated helpers, config snippets, reports checked into the workspace, or task-specific files.',
    'Do not use for broad refactors, shell execution, dependency installs, multi-file coding tasks, or changes that need a full coding agent.',
    '',
    'Inputs:',
    '- relativePath: project-relative file path.',
    '- content: UTF-8 text content, OR base64Content for binary content.',
    '- title/mime/sourceRefs are optional delivery metadata.',
  ].join('\n'),
  sideEffect: 'mutates-state' as const,
  input_schema: {
    type: 'object' as const,
    additionalProperties: false,
    properties: {
      relativePath: { type: 'string', description: 'Project-root-relative file path.' },
      content: { type: 'string', description: 'UTF-8 text content to write.' },
      base64Content: { type: 'string', description: 'Base64-encoded binary content to write.' },
      title: { type: 'string', description: 'Optional display title.' },
      mime: { type: 'string', description: 'Optional MIME type.' },
      sourceRefs: {
        type: 'array',
        items: { type: 'string' },
        description: 'Optional source/citation ids or labels that support this workspace write.',
      },
    },
    required: ['relativePath'],
  },
};

export const ROLLBACK_PARTNER_CHECKPOINT_TOOL = {
  name: 'rollback_partner_checkpoint',
  description: [
    'Roll back a Partner workspace-file checkpoint if the current file still matches the checkpoint after-hash.',
    'Use when a just-created Partner workspace write should be reverted safely.',
    'If the user or another tool changed the file after the checkpoint, rollback is refused and must be reviewed manually.',
  ].join('\n'),
  sideEffect: 'mutates-state' as const,
  input_schema: {
    type: 'object' as const,
    additionalProperties: false,
    properties: {
      checkpointId: {
        type: 'string',
        description: 'Partner checkpoint id returned by write_partner_workspace_file.',
      },
    },
    required: ['checkpointId'],
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

function requirePartnerContext(
  toolContext?: SdkToolExecutionContextLike,
): { sessionId: string; projectRoot: string } | string {
  const ctx = resolveSessionRunContext(toolContext);
  if (!ctx) return 'Error: Partner workspace file tool was called outside an active session run.';
  if (ctx.surface !== 'partner') {
    return 'Error: Partner workspace file tools are only available in Partner sessions.';
  }
  return { sessionId: ctx.sessionId, projectRoot: ctx.projectRoot };
}

export function makeWritePartnerWorkspaceFileHandler(
  checkpointStore: PartnerCheckpointStore,
  deliveryStore: PartnerDeliveryStore,
  auditStore: AdminPolicyAuditStore = adminPolicyAuditStore,
): ToolHandler {
  return async (input, toolContext) => {
    const ctx = requirePartnerContext(toolContext);
    if (typeof ctx === 'string') return ctx;
    const relativePath = typeof input.relativePath === 'string' ? input.relativePath : '';
    const bytes = bytesFromInput(input);
    if (typeof bytes === 'string') return bytes;
    try {
      await auditStore.assertDeliveryWorkspaceWriteAllowed({
        sessionId: ctx.sessionId,
        projectRoot: ctx.projectRoot,
        relativePath,
      });
      await auditStore.assertDeliveryRegisterWorkspaceAllowed({
        sessionId: ctx.sessionId,
        projectRoot: ctx.projectRoot,
        targetPath: relativePath,
      });
      const { checkpoint } = await checkpointStore.writeWorkspaceFile({
        sessionId: ctx.sessionId,
        projectRoot: ctx.projectRoot,
        relativePath,
        bytes,
        producer: WRITE_PARTNER_WORKSPACE_FILE_TOOL.name,
      });
      const delivery = await deliveryStore.register({
        sessionId: ctx.sessionId,
        projectRoot: ctx.projectRoot,
        rootKind: 'workspace-session',
        rootPath: checkpoint.rootPath,
        absolutePath: checkpoint.absolutePath,
        ...(typeof input.title === 'string' ? { title: input.title } : {}),
        ...(typeof input.mime === 'string' ? { mime: input.mime } : {}),
        sourceRefs: sourceRefsFromInput(input),
        producer: WRITE_PARTNER_WORKSPACE_FILE_TOOL.name,
        checkpointId: checkpoint.id,
      });
      await checkpointStore.attachDelivery(checkpoint.id, delivery.id);
      await auditStore.record({
        category: 'workspace-file',
        action: 'delivery.writeWorkspaceFile',
        outcome: 'allowed',
        projectRoot: ctx.projectRoot,
        sessionId: ctx.sessionId,
        resource: checkpoint.relativePath,
        details: {
          checkpointId: checkpoint.id,
          deliveryId: delivery.id,
          operation: checkpoint.operation,
          afterHash: checkpoint.afterHash,
        },
      });
      try {
        pushToRenderer('partner.deliveries.changed', {
          sessionId: ctx.sessionId,
          id: delivery.id,
          reason: 'checkpoint',
        });
        pushToRenderer('partner.checkpoints.changed', {
          sessionId: ctx.sessionId,
          id: checkpoint.id,
          reason: 'created',
        });
      } catch {
        // Renderer may be gone; stores are persisted.
      }
      return [
        `Partner workspace file written: ${checkpoint.relativePath}`,
        `Checkpoint id: ${checkpoint.id}`,
        `Delivery id: ${delivery.id}`,
        `Relative path: ${delivery.relativePath}`,
        partnerDeliveryReferenceLine(delivery),
        `Use this exact link when referencing the output: ${partnerDeliveryMarkdownLink(delivery)}`,
        `Operation: ${checkpoint.operation}`,
        `Hash: ${checkpoint.afterHash}`,
        'Rollback is available with rollback_partner_checkpoint while the file remains unchanged.',
      ].join('\n');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await auditStore.record({
        category: 'workspace-file',
        action: 'delivery.writeWorkspaceFile',
        outcome: 'failed',
        projectRoot: ctx.projectRoot,
        sessionId: ctx.sessionId,
        resource: relativePath,
        details: { error: message.slice(0, 240) },
      });
      return `Error writing Partner workspace file: ${message.slice(0, 240)}`;
    }
  };
}

export function makeRollbackPartnerCheckpointHandler(
  checkpointStore: PartnerCheckpointStore,
  deliveryStore: PartnerDeliveryStore,
  auditStore: AdminPolicyAuditStore = adminPolicyAuditStore,
): ToolHandler {
  return async (input, toolContext) => {
    const ctx = requirePartnerContext(toolContext);
    if (typeof ctx === 'string') return ctx;
    const checkpointId = typeof input.checkpointId === 'string' ? input.checkpointId : '';
    try {
      const checkpoint = await checkpointStore.get(checkpointId);
      if (!checkpoint) return `Error rolling back Partner checkpoint: checkpoint not found`;
      if (checkpoint.sessionId !== ctx.sessionId) {
        return 'Error rolling back Partner checkpoint: checkpoint belongs to a different session.';
      }
      if (path.resolve(checkpoint.projectRoot) !== path.resolve(ctx.projectRoot)) {
        return 'Error rolling back Partner checkpoint: checkpoint belongs to a different project.';
      }
      const result = await checkpointStore.rollback(checkpoint.id);
      await auditStore.record({
        category: 'workspace-file',
        action: 'delivery.rollbackCheckpoint',
        outcome: result.ok ? 'allowed' : 'failed',
        projectRoot: ctx.projectRoot,
        sessionId: ctx.sessionId,
        resource: checkpoint.relativePath,
        details: { checkpointId: checkpoint.id, error: result.error },
      });
      if (!result.ok) {
        return `Error rolling back Partner checkpoint: ${result.error ?? 'rollback failed'}`;
      }
      let deliverySyncError: string | undefined;
      if (checkpoint.deliveryId) {
        try {
          await deliveryStore.refresh(checkpoint.deliveryId);
        } catch (err) {
          deliverySyncError = err instanceof Error ? err.message : String(err);
        }
      }
      try {
        pushToRenderer('partner.checkpoints.changed', {
          sessionId: ctx.sessionId,
          id: checkpoint.id,
          reason: 'rollback',
        });
        if (checkpoint.deliveryId) {
          pushToRenderer('partner.deliveries.changed', {
            sessionId: ctx.sessionId,
            id: checkpoint.deliveryId,
            reason: 'rollback',
          });
        }
      } catch {
        // Renderer may be gone; stores are persisted.
      }
      return [
        `Partner checkpoint rolled back: ${checkpoint.relativePath}`,
        `Checkpoint id: ${checkpoint.id}`,
        ...(deliverySyncError
          ? [`Delivery registry sync warning: ${deliverySyncError.slice(0, 180)}`]
          : []),
      ].join('\n');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await auditStore.record({
        category: 'workspace-file',
        action: 'delivery.rollbackCheckpoint',
        outcome: 'failed',
        projectRoot: ctx.projectRoot,
        sessionId: ctx.sessionId,
        resource: checkpointId,
        details: { error: message.slice(0, 240) },
      });
      return `Error rolling back Partner checkpoint: ${message.slice(0, 240)}`;
    }
  };
}

let registered = false;

export function _resetPartnerWorkspaceFileToolRegistrationForTesting(): void {
  registered = false;
}

export function ensurePartnerWorkspaceFileToolsRegistered(sdk: unknown): void {
  if (registered) return;
  const reg = (sdk as { registerTool?: (def: unknown) => () => void }).registerTool;
  if (typeof reg !== 'function') {
    console.warn(
      '[partner-workspace-file] sdk.registerTool unavailable; workspace file tools not registered',
    );
    return;
  }
  reg({
    ...WRITE_PARTNER_WORKSPACE_FILE_TOOL,
    handler: makeWritePartnerWorkspaceFileHandler(partnerCheckpointStore, partnerDeliveryStore),
  });
  reg({
    ...ROLLBACK_PARTNER_CHECKPOINT_TOOL,
    handler: makeRollbackPartnerCheckpointHandler(partnerCheckpointStore, partnerDeliveryStore),
  });
  registerPartnerSpaceToolPolicy({
    name: WRITE_PARTNER_WORKSPACE_FILE_TOOL.name,
    scope: 'workspace-delivery',
    sideEffect: WRITE_PARTNER_WORKSPACE_FILE_TOOL.sideEffect,
    description:
      'Checkpointed lightweight project-file write for Partner workspace-session deliverables.',
  });
  registerPartnerSpaceToolPolicy({
    name: ROLLBACK_PARTNER_CHECKPOINT_TOOL.name,
    scope: 'workspace-delivery',
    sideEffect: ROLLBACK_PARTNER_CHECKPOINT_TOOL.sideEffect,
    description: 'Rolls back a Partner checkpoint when the target file is unchanged since write.',
  });
  registered = true;
}
