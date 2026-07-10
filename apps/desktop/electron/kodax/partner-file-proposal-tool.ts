import { registerPartnerSpaceToolPolicy } from './partner-tools.js';
import {
  resolveSessionRunContext,
  type SdkToolExecutionContextLike,
} from './session-run-context.js';
import {
  partnerFileProposalStore,
  type PartnerFileProposalStore,
} from './partner-file-proposal-store.js';
import { adminPolicyAuditStore } from './admin-policy-audit-store.js';

type ToolHandler = (
  input: Record<string, unknown>,
  context?: SdkToolExecutionContextLike,
) => Promise<string>;

export const CREATE_FILE_PROPOSAL_TOOL = {
  name: 'create_file_proposal',
  description: [
    'Propose creating a text-like workspace file for the user to review and apply.',
    'This does not write the workspace directly. Space stores a proposal with a diff preview.',
    'Use for markdown, text, JSON, YAML, CSV, HTML, CSS, and reviewed code/config files.',
  ].join('\n'),
  sideEffect: 'mutates-state' as const,
  input_schema: {
    type: 'object' as const,
    properties: {
      targetPath: {
        type: 'string',
        description: 'Project-relative target path for the new file.',
      },
      content: { type: 'string', description: 'Full UTF-8 file content to propose.' },
      rationale: { type: 'string', description: 'Why this file should be created.' },
      sourceRefs: {
        type: 'array',
        items: { type: 'string' },
        description: 'Optional source/citation ids or labels that support this proposal.',
      },
    },
    required: ['targetPath', 'content'],
  },
};

export const UPDATE_FILE_PROPOSAL_TOOL = {
  name: 'update_file_proposal',
  description: [
    'Propose replacing the content of an existing text-like workspace file.',
    'This does not write the workspace directly. Space stores a proposal with a diff preview.',
    'Use this instead of write/edit/multi_edit in the Partner surface.',
  ].join('\n'),
  sideEffect: 'mutates-state' as const,
  input_schema: {
    type: 'object' as const,
    properties: {
      targetPath: {
        type: 'string',
        description: 'Project-relative target path for the existing file.',
      },
      content: { type: 'string', description: 'Full replacement UTF-8 file content to propose.' },
      rationale: { type: 'string', description: 'Why this update should be applied.' },
      sourceRefs: {
        type: 'array',
        items: { type: 'string' },
        description: 'Optional source/citation ids or labels that support this proposal.',
      },
    },
    required: ['targetPath', 'content'],
  },
};

function requirePartnerContext(
  toolContext?: SdkToolExecutionContextLike,
): { sessionId: string; projectRoot: string } | string {
  const ctx = resolveSessionRunContext(toolContext);
  if (!ctx) return 'Error: file proposal tool was called outside an active session run.';
  if (ctx.surface !== 'partner')
    return 'Error: file proposal tools are only available in Partner sessions.';
  return { sessionId: ctx.sessionId, projectRoot: ctx.projectRoot };
}

function sourceRefsFromInput(input: Record<string, unknown>): string[] {
  if (!Array.isArray(input.sourceRefs)) return [];
  return input.sourceRefs.filter((ref): ref is string => typeof ref === 'string');
}

export function makeFileProposalHandler(
  store: PartnerFileProposalStore,
  operation: 'create' | 'update',
): ToolHandler {
  return async (input, toolContext) => {
    const ctx = requirePartnerContext(toolContext);
    if (typeof ctx === 'string') return ctx;
    const targetPath = typeof input.targetPath === 'string' ? input.targetPath : '';
    const content = typeof input.content === 'string' ? input.content : '';
    const rationale = typeof input.rationale === 'string' ? input.rationale : undefined;
    try {
      await adminPolicyAuditStore.assertFileProposalCreateAllowed({
        sessionId: ctx.sessionId,
        projectRoot: ctx.projectRoot,
        targetPath,
        operation,
      });
      const proposal = await store.create({
        sessionId: ctx.sessionId,
        projectRoot: ctx.projectRoot,
        operation,
        targetPath,
        content,
        ...(rationale !== undefined ? { rationale } : {}),
        sourceRefs: sourceRefsFromInput(input),
      });
      await adminPolicyAuditStore.record({
        category: 'workspace-file',
        action: 'fileProposal.create',
        outcome: 'allowed',
        projectRoot: ctx.projectRoot,
        sessionId: ctx.sessionId,
        resource: proposal.targetPath,
        details: {
          proposalId: proposal.id,
          operation: proposal.operation,
          safety: proposal.safety,
        },
      });
      const warning =
        proposal.safety.warnings.length > 0
          ? ` Warnings: ${proposal.safety.warnings.join(' ')}`
          : '';
      return [
        `File proposal created: ${proposal.id}`,
        `Operation: ${proposal.operation}`,
        `Target: ${proposal.targetPath}`,
        `Content hash: ${proposal.contentHash}`,
        `Safety: ${proposal.safety.classification}/${proposal.safety.risk}.${warning}`,
        'The workspace has not been modified. The user must review and apply this proposal in Space.',
      ].join('\n');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return `Error creating file proposal: ${message.slice(0, 240)}`;
    }
  };
}

let registered = false;

export function _resetPartnerFileProposalToolRegistrationForTesting(): void {
  registered = false;
}

export function ensurePartnerFileProposalToolsRegistered(sdk: unknown): void {
  if (registered) return;
  const reg = (sdk as { registerTool?: (def: unknown) => () => void }).registerTool;
  if (typeof reg !== 'function') {
    console.warn(
      '[partner-file-proposal] sdk.registerTool unavailable; file proposal tools not registered',
    );
    return;
  }
  reg({
    ...CREATE_FILE_PROPOSAL_TOOL,
    handler: makeFileProposalHandler(partnerFileProposalStore, 'create'),
  });
  reg({
    ...UPDATE_FILE_PROPOSAL_TOOL,
    handler: makeFileProposalHandler(partnerFileProposalStore, 'update'),
  });
  registerPartnerSpaceToolPolicy({
    name: CREATE_FILE_PROPOSAL_TOOL.name,
    scope: 'workspace-file-proposal',
    sideEffect: CREATE_FILE_PROPOSAL_TOOL.sideEffect,
    description: 'Creates reviewed workspace file proposals without direct Partner file writes.',
  });
  registerPartnerSpaceToolPolicy({
    name: UPDATE_FILE_PROPOSAL_TOOL.name,
    scope: 'workspace-file-proposal',
    sideEffect: UPDATE_FILE_PROPOSAL_TOOL.sideEffect,
    description: 'Creates reviewed workspace file update proposals without direct Partner edits.',
  });
  registered = true;
}
