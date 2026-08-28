// Builtin slash command handlers — FEATURE_031.
//
// 第一批 8 个对齐 KodaX REPL：
//   /mode <plan|accept-edits|auto>      切 permission mode
//   /auto-engine <llm|rules>            切 auto sub-engine
//   /model <name>                       switch the current provider model
//   /provider <name>                    切 provider (kodaxHost.setProvider)
//   /reasoning <SDK effort token>
//   /thinking <on|off>                  switch thinking output and reasoning mode
//   /clear                              主动 emit 'session_clear' (renderer 自决清屏)
//   /help                               列出所有命令
//
// 实现哲学：每个 handler 只调 host setter + emit 提示事件；renderer 看到事件再渲染。
// 不在 main 做"美化输出"——和 KodaX REPL 一样保持 main 端最小职责。

import type {
  PermissionMode,
  AutoModeEngine,
  AgentMode,
  WorkflowRunT,
  MemoryActionProposalT,
  MemoryApplyResultT,
  MemoryGovernanceReportT,
  MemoryItemRefT,
  MemoryRejectResultT,
  ReasoningMode,
} from '@kodax-space/space-ipc-schema';
import { reasoningModeSchema } from '@kodax-space/space-ipc-schema';
import type {
  ReviewableLearningProposal,
  SkillTrustRecord,
  SkillUsageRecord,
  StoredLearningApprovalResult,
  StoredLearningProposal,
  LearnedCapabilityRecord,
} from '@kodax-ai/kodax/agent';
import type { SlashCommandDef, SlashHandlerContext, SlashHandlerResult } from './registry.js';
import { kodaxHost, providerDescriptor } from '../kodax/host.js';
import { learningSafetyService } from '../ipc/learning.js';
import { isRepoIntelEntitled } from '../kodax/repo-intel-gate.js';
import {
  workflowController,
  type LaunchSession,
  type SavedWorkflowLite,
} from '../kodax/workflow-controller.js';
import { loadPersistedSession } from '../kodax/session-store.js';
import {
  createSpaceSdkExtensionRuntime,
  discoverSpaceSdkExtensions,
  getSpaceSdkExtensionDiagnostics,
  loadSpaceSdkCoding,
} from '../kodax/sdk-extensions.js';
import { loadKodaxCustomProviders, registerKodaxCustomProviders } from '../kodax/user-config.js';
import { isBuiltinId } from '../providers/catalog.js';
import { providerConfigStore } from '../providers/config.js';
import { listSlashCommands } from './registry.js';
import { getBuiltin } from '../providers/catalog.js';
import { memoryGovernanceService } from '../memory/memory-service.js';
import { runtimeHostAdapter } from '../kodax/runtime-host-adapter.js';

const PERMISSION_MODES: readonly PermissionMode[] = ['plan', 'accept-edits', 'auto'];
const AUTO_ENGINES: readonly AutoModeEngine[] = ['llm', 'rules'];
const AGENT_MODES: readonly AgentMode[] = ['ama', 'sa'];
const REASONING_EXAMPLES = ['off', 'auto', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];

function isPermissionMode(s: string): s is PermissionMode {
  return PERMISSION_MODES.includes(s as PermissionMode);
}

function isAutoEngine(s: string): s is AutoModeEngine {
  return AUTO_ENGINES.includes(s as AutoModeEngine);
}

function parseReasoningMode(s: string): ReasoningMode | undefined {
  const parsed = reasoningModeSchema.safeParse(s);
  return parsed.success ? parsed.data : undefined;
}

function normalizeAgentMode(s: string): AgentMode | 'toggle' | 'retired' | undefined {
  const lower = s.toLowerCase();
  if (lower === 'toggle') return 'toggle';
  if (lower === 'amaw' || lower === 'ama-workflow') return 'retired';
  return AGENT_MODES.includes(lower as AgentMode) ? (lower as AgentMode) : undefined;
}

function nextAgentMode(current: AgentMode): AgentMode {
  const idx = AGENT_MODES.indexOf(current);
  return AGENT_MODES[(idx + 1) % AGENT_MODES.length] ?? 'ama';
}

async function commitRuntimeSlashMutation(
  sessionId: string,
  mutate: () => boolean,
  successMessage: string,
): Promise<SlashHandlerResult> {
  const result = await kodaxHost.commitRuntimeMutation(sessionId, mutate);
  if (result === 'ok') return { ok: true, message: successMessage };
  if (result === 'persist-failed') {
    return {
      ok: false,
      message: `runtime metadata could not be persisted; change was rolled back: ${sessionId}`,
    };
  }
  return { ok: false, message: `session not found: ${sessionId}` };
}

function compactSlashMessage(message: string, max = 1900): string {
  if (message.length <= max) return message;
  return `${message.slice(0, max - 12)}\n... truncated`;
}

function runtimeConfigRecord(value: unknown): Readonly<Record<string, unknown>> {
  return value !== null && typeof value === 'object'
    ? (value as Readonly<Record<string, unknown>>)
    : {};
}

function fallbackChain(value: unknown): readonly string[] {
  const entries: readonly unknown[] = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(',')
      : [];
  return entries
    .filter((entry: unknown): entry is string => typeof entry === 'string')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

const RUNTIME_EFFECTIVE_CONFIG_NOTE =
  'Runtime effective environment overrides are not exposed by the current KodaX SDK; this shows persisted daemon config only.';
const RUNTIME_FALLBACK_CREDENTIAL_NOTE =
  'Cross-Provider fallback is not available for Space-started Runtime or embedded Runs because their credential binding is exact-Provider; SDK multi-Provider credential brokering is required.';

type AgentSdkModule = typeof import('@kodax-ai/kodax/agent');
let agentSdkModule: Promise<AgentSdkModule> | null = null;

function loadAgentSdk(): Promise<AgentSdkModule> {
  agentSdkModule ??= import('@kodax-ai/kodax/agent');
  return agentSdkModule;
}

type LearningFilter = 'all' | 'skill' | 'workflow' | 'memory';

const LEARNING_FILTER_LABEL: Record<LearningFilter, string> = {
  all: 'learning proposals',
  skill: 'skill learning proposals',
  workflow: 'workflow learning handoffs',
  memory: 'memory learning handoffs',
};

function learningHelp(): string {
  return [
    'Usage:',
    '  /learn pending',
    '  /learn diff <proposal-id>',
    '  /learn review <name-or-slug>       (Coder Runtime)',
    '  /learn trust <name-or-slug>        (Coder Runtime, after review)',
    '  /learn disable <name-or-slug>      (Coder Runtime)',
    '  /learn rollback <name-or-slug>     (Coder Runtime)',
    '  /learn approve <proposal-id> [--ack-impact]  (Partner proposal)',
    '  /learn reject <proposal-id> [reason]',
    '  /skill pending',
    '  /workflow pending',
    '  /memory pending',
  ].join('\n');
}

function truncateLearningText(value: string | undefined, max = 160): string {
  const normalized = (value ?? '').replace(/\s+/g, ' ').trim();
  if (!normalized) return '(none)';
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, Math.max(0, max - 14))} ... truncated`;
}

function truncateLearningBlock(value: string, max = 700): string {
  if (value.length <= max) return value;
  return `${value.slice(0, Math.max(0, max - 14))}\n... truncated`;
}

function learningKindLabel(proposal: ReviewableLearningProposal): string {
  switch (proposal.destination) {
    case 'skill_patch':
      return 'skill patch';
    case 'skill_create':
      return 'skill create';
    case 'workflow_handoff':
      return 'workflow handoff';
    case 'memdir_handoff':
      return 'memory handoff';
    case 'reasoning_handoff':
      return 'reasoning handoff';
  }
}

function learningProposalMatchesFilter(
  entry: StoredLearningProposal,
  filter: LearningFilter,
): boolean {
  if (filter === 'all') return true;
  const destination = entry.proposal.destination;
  if (filter === 'skill') return destination === 'skill_patch' || destination === 'skill_create';
  if (filter === 'workflow') return destination === 'workflow_handoff';
  return destination === 'memdir_handoff';
}

function usesRuntimeSession(sessionId: string): boolean {
  const session = kodaxHost.get(sessionId);
  return session?.surface === 'code' && runtimeHostAdapter.isRuntimeSelected();
}

function usesRuntimeLearning(sessionId: string): boolean {
  return usesRuntimeSession(sessionId);
}

function runtimeLearningMatchesFilter(
  entry: LearnedCapabilityRecord,
  filter: LearningFilter,
): boolean {
  if (filter === 'all') return true;
  if (filter === 'skill') return entry.carrier === 'skill' || entry.carrier === 'extension';
  if (filter === 'workflow') return entry.carrier === 'workflow_handoff';
  return false;
}

function formatRuntimeLearningRecord(entry: LearnedCapabilityRecord): string {
  const lines = [
    `${entry.slug}  ${entry.lifecycle}  ${entry.carrier}`,
    `  Name: ${entry.displayName}`,
    `  Revision: ${entry.revision}; updated: ${entry.updatedAt}`,
    entry.previousGoodRevision !== undefined
      ? `  Previous good revision: ${entry.previousGoodRevision}`
      : '',
    entry.diagnostics?.length ? `  Diagnostics: ${entry.diagnostics.join('; ')}` : '',
  ];
  if (entry.schemaVersion === 2) {
    const evidenceRefs = entry.canary.invocations
      .flatMap((invocation) => invocation.evidenceRefs)
      .slice(0, 6);
    lines.push(
      `  Scope: project=${entry.scope.projectHash}; tenant=${entry.scope.tenantHash}; config=${entry.scope.configHomeHash}`,
      `  Artifact: ${entry.artifact.relativePath}; content revision=${entry.artifact.contentRevision}`,
      `  Fingerprint: ${entry.artifact.fingerprint}`,
      entry.previousGoodArtifact
        ? `  Previous good artifact: revision=${entry.previousGoodArtifact.contentRevision}; fingerprint=${entry.previousGoodArtifact.fingerprint}`
        : '',
      `  Provenance: decision=${entry.provenance.decisionId}; action=${entry.provenance.actionId}; input=${entry.provenance.inputHash}`,
      `  Canary: ${entry.canary.invocationCount}/${entry.canary.maxInvocations}; verified=${entry.canary.verifiedSuccesses}; credible-negative=${entry.canary.credibleNegatives}`,
      evidenceRefs.length ? `  Canary evidence: ${evidenceRefs.join(', ')}` : '',
    );
  }
  return lines.filter(Boolean).join('\n');
}

async function handleRuntimeLearningPending(filter: LearningFilter): Promise<SlashHandlerResult> {
  try {
    const page = await runtimeHostAdapter.listLearnedCapabilities({ limit: 100 });
    const pending = page.items.filter(
      (entry) =>
        runtimeLearningMatchesFilter(entry, filter) &&
        entry.lifecycle !== 'active_learned' &&
        entry.lifecycle !== 'promoted_user' &&
        entry.lifecycle !== 'archived' &&
        entry.lifecycle !== 'rejected',
    );
    const lines = pending.length
      ? [
          `Pending ${LEARNING_FILTER_LABEL[filter]}: ${pending.length}`,
          ...pending.map(formatRuntimeLearningRecord),
          'Next: /learn diff <name-or-slug>, /learn review <name-or-slug>, /learn trust <name-or-slug>, or /learn reject <name-or-slug>.',
        ]
      : [`No pending ${LEARNING_FILTER_LABEL[filter]} in the Coder daemon.`];
    return { ok: true, message: compactSlashMessage(lines.join('\n\n')), echo: true };
  } catch {
    return {
      ok: false,
      message: 'Coder learning center is unavailable. Restart the Coder daemon and retry.',
      echo: true,
    };
  }
}

function formatConsumerImpact(impact: {
  readonly workflowCapsules: readonly string[];
  readonly savedWorkflows: readonly string[];
  readonly constructedAgents: readonly string[];
  readonly promptReferences: readonly string[];
  readonly action: string;
}): string {
  const details = [
    impact.workflowCapsules.length ? `workflow capsules: ${impact.workflowCapsules.length}` : '',
    impact.savedWorkflows.length ? `saved workflows: ${impact.savedWorkflows.length}` : '',
    impact.constructedAgents.length ? `constructed agents: ${impact.constructedAgents.length}` : '',
    impact.promptReferences.length ? `prompt references: ${impact.promptReferences.length}` : '',
  ].filter(Boolean);
  return `${impact.action}${details.length ? ` (${details.join(', ')})` : ''}`;
}

function formatLearningProposalSummary(entry: StoredLearningProposal): string {
  const proposal = entry.proposal;
  const lines = [
    `${entry.proposalId}  ${entry.status}  ${learningKindLabel(proposal)}`,
    `  Created: ${entry.createdAt}`,
  ];

  switch (proposal.destination) {
    case 'skill_patch':
    case 'skill_create':
      lines.push(
        `  Skill: ${proposal.skillName}`,
        `  Change: ${truncateLearningText(proposal.changeSummary)}`,
        `  Trigger: ${truncateLearningText(proposal.trigger, 120)}`,
        `  Confidence: ${Math.round(proposal.confidence * 100)}%`,
      );
      break;
    case 'workflow_handoff':
      lines.push(
        `  Action: ${proposal.suggestedAction}; risk: ${proposal.risk}`,
        `  Why workflow: ${truncateLearningText(proposal.whyWorkflowNotSkill)}`,
        `  Impact: ${formatConsumerImpact(proposal.consumerImpact)}`,
      );
      break;
    case 'memdir_handoff':
      lines.push(
        `  Memory: ${proposal.memoryKind}`,
        `  Body: ${truncateLearningText(proposal.body)}`,
      );
      break;
    case 'reasoning_handoff':
      lines.push(`  Title: ${proposal.title}`, `  Body: ${truncateLearningText(proposal.body)}`);
      break;
  }

  if (entry.applyPlan?.kind === 'skill') {
    lines.push(`  Apply plan: ${entry.applyPlan.changes.length} skill file change(s)`);
  } else {
    lines.push('  Apply plan: handoff only');
  }
  if (entry.rejectedReason)
    lines.push(`  Rejected reason: ${truncateLearningText(entry.rejectedReason)}`);
  return lines.join('\n');
}

async function resolveLearningStoreForSession(
  sessionId: string,
): Promise<
  | { readonly ok: true; readonly storePath: string }
  | { readonly ok: false; readonly message: string }
> {
  const session = kodaxHost.get(sessionId);
  if (!session) return { ok: false, message: `session not found: ${sessionId}` };
  const sdk = await loadAgentSdk();
  return { ok: true, storePath: sdk.resolveLearningProposalStore(session.projectRoot) };
}

function selectLearningProposal(
  entries: readonly StoredLearningProposal[],
  target: string,
):
  | { readonly ok: true; readonly entry: StoredLearningProposal }
  | { readonly ok: false; readonly message: string } {
  const normalized = target.trim().toLowerCase();
  if (!normalized) return { ok: false, message: 'proposal id is required' };
  const exact = entries.find((entry) => entry.proposalId.toLowerCase() === normalized);
  if (exact) return { ok: true, entry: exact };
  const matches = entries.filter((entry) => entry.proposalId.toLowerCase().startsWith(normalized));
  if (matches.length === 1) return { ok: true, entry: matches[0]! };
  if (matches.length > 1) {
    return {
      ok: false,
      message: `ambiguous proposal id '${target}': ${matches.map((entry) => entry.proposalId).join(', ')}`,
    };
  }
  return { ok: false, message: `learning proposal not found: ${target}` };
}

async function handleLearningPending(
  ctx: SlashHandlerContext,
  filter: LearningFilter,
): Promise<SlashHandlerResult> {
  if (usesRuntimeLearning(ctx.sessionId)) return handleRuntimeLearningPending(filter);
  const resolved = await resolveLearningStoreForSession(ctx.sessionId);
  if (!resolved.ok) return resolved;
  const sdk = await loadAgentSdk();
  const result = await sdk.readLearningProposalStore(resolved.storePath);
  const pending = result.proposals
    .filter((entry) => entry.status === 'pending' && learningProposalMatchesFilter(entry, filter))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const lines = pending.length
    ? [
        `Pending ${LEARNING_FILTER_LABEL[filter]}: ${pending.length}`,
        ...pending.map(formatLearningProposalSummary),
      ]
    : [`No pending ${LEARNING_FILTER_LABEL[filter]} for this project.`];
  if (result.warnings.length)
    lines.push('Warnings:', ...result.warnings.map((warning) => `  ${warning}`));
  if (pending.length) {
    lines.push(
      'Next: /learn diff <proposal-id>, /learn approve <proposal-id> [--ack-impact], or /learn reject <proposal-id> [reason].',
    );
  }
  return { ok: true, message: compactSlashMessage(lines.join('\n\n')), echo: true };
}

function formatSkillUsageRecord(record: SkillUsageRecord): string {
  return [
    `${record.skillName} (${record.source})`,
    `  views=${record.views} invokes=${record.invokes} patchProposals=${record.patchProposals} patchApplies=${record.patchApplies}`,
    `  first=${record.firstEventAt} last=${record.lastEventAt}`,
  ].join('\n');
}

function formatSkillTrustRecord(record: SkillTrustRecord): string {
  return [
    `${record.skillName} (${record.source})  ${record.state}`,
    `  ownership=${record.ownership} createdByAgent=${record.createdByAgent} updated=${record.updatedAt}`,
    record.reason ? `  reason=${record.reason}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

async function handleLearningLedger(ctx: SlashHandlerContext): Promise<SlashHandlerResult> {
  const session = kodaxHost.get(ctx.sessionId);
  if (!session) return { ok: false, message: `session not found: ${ctx.sessionId}` };
  if (usesRuntimeLearning(ctx.sessionId)) {
    try {
      const [snapshot, page] = await Promise.all([
        runtimeHostAdapter.learningSnapshot(),
        runtimeHostAdapter.listLearnedCapabilities({ limit: 10 }),
      ]);
      return {
        ok: true,
        echo: true,
        message: compactSlashMessage(
          [
            'Coder daemon learning center',
            `Revision: ${snapshot.revision}; ready=${snapshot.ready}; newlyActive=${snapshot.newlyActive}; attention=${snapshot.attention}; active=${snapshot.active}`,
            '',
            'Recent capabilities:',
            ...(page.items.length ? page.items.map(formatRuntimeLearningRecord) : ['  (none)']),
          ].join('\n'),
          3200,
        ),
      };
    } catch {
      return {
        ok: false,
        message: 'Coder learning center is unavailable. Restart the Coder daemon and retry.',
        echo: true,
      };
    }
  }
  const sdk = await loadAgentSdk();
  const usagePath = sdk.resolveSkillUsageLedger(session.projectRoot);
  const trustPath = sdk.resolveSkillTrustLedger(session.projectRoot);
  const [usage, trust] = await Promise.all([
    sdk.readSkillUsageLedger(usagePath),
    sdk.readSkillTrustLedger(trustPath),
  ]);
  const usageRecords = usage.records
    .slice()
    .sort((a, b) => b.lastEventAt.localeCompare(a.lastEventAt))
    .slice(0, 10);
  const trustRecords = trust.records
    .slice()
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 10);
  const lines = [
    'Skill learning ledgers',
    `Project: ${session.projectRoot}`,
    `Usage ledger: ${usage.records.length} record(s) at ${usagePath}`,
    `Trust ledger: ${trust.records.length} record(s) at ${trustPath}`,
    '',
    'Recent usage:',
    ...(usageRecords.length ? usageRecords.map(formatSkillUsageRecord) : ['  (none)']),
    '',
    'Trust records:',
    ...(trustRecords.length ? trustRecords.map(formatSkillTrustRecord) : ['  (none)']),
  ];
  if (usage.warnings.length || trust.warnings.length) {
    lines.push(
      '',
      'Warnings:',
      ...usage.warnings.map((warning) => `  usage: ${warning}`),
      ...trust.warnings.map((warning) => `  trust: ${warning}`),
    );
  }
  return { ok: true, message: compactSlashMessage(lines.join('\n'), 3200), echo: true };
}

function formatLearningDiff(entry: StoredLearningProposal): string {
  const lines = ['Learning proposal:', formatLearningProposalSummary(entry)];
  if (entry.applyPlan?.kind !== 'skill') {
    lines.push(
      '',
      'No direct apply plan. Approving this records the SDK handoff state; downstream workflow, memory, or reasoning work still needs its dedicated surface.',
    );
    return lines.join('\n');
  }

  const plan = entry.applyPlan;
  lines.push(
    '',
    `Apply plan: ${plan.kind}`,
    `Skill root: ${plan.skillRoot}`,
    `Governance: ${plan.governance.action}/${plan.governance.ownership} from ${plan.governance.source}`,
  );
  for (const change of plan.changes) {
    if (change.kind === 'write') {
      lines.push(
        '',
        `--- write ${change.relativePath} (${change.content.length} chars)`,
        truncateLearningBlock(change.content),
      );
    } else {
      lines.push('', `--- delete ${change.relativePath}`);
    }
  }
  return lines.join('\n');
}

function formatLearningApproval(
  entry: StoredLearningProposal,
  result: StoredLearningApprovalResult,
): string {
  switch (result.status) {
    case 'approved_applied':
      return [
        `Approved and applied ${entry.proposalId}.`,
        result.changedPaths.length ? `Changed: ${result.changedPaths.join(', ')}` : '',
        result.snapshotPath ? `Snapshot: ${result.snapshotPath}` : '',
      ]
        .filter(Boolean)
        .join('\n');
    case 'approved_already_applied':
      return [
        `Approved ${entry.proposalId}; changes were already applied.`,
        result.changedPaths.length ? `Changed: ${result.changedPaths.join(', ')}` : '',
        result.snapshotPath ? `Snapshot: ${result.snapshotPath}` : '',
      ]
        .filter(Boolean)
        .join('\n');
    case 'approved_handoff':
      return `Approved ${entry.proposalId}; handoff recorded.`;
    case 'blocked_not_pending':
      return `Cannot approve ${entry.proposalId}; current status is ${result.reviewStatus}.`;
    case 'blocked_missing_apply_plan':
      return `Cannot apply ${entry.proposalId}; this proposal has no safe apply plan.`;
    case 'blocked_snapshot_conflict':
      return `Cannot apply ${entry.proposalId}; snapshot conflict at ${result.relativePath}. Snapshot: ${result.snapshotPath}`;
    case 'blocked_consumer_impact':
      return [
        `Approval blocked for ${entry.proposalId} by consumer impact: ${formatConsumerImpact(result.impact)}.`,
        `Review /learn diff ${entry.proposalId}; rerun /learn approve ${entry.proposalId} --ack-impact only after checking downstream consumers.`,
      ].join('\n');
  }
}

async function handleLearningDiff(ctx: SlashHandlerContext): Promise<SlashHandlerResult> {
  const target = ctx.args[1];
  if (!target) return { ok: false, message: learningHelp() };
  if (usesRuntimeLearning(ctx.sessionId)) {
    try {
      const entry = await runtimeHostAdapter.getLearnedCapability(target);
      return { ok: true, message: formatRuntimeLearningRecord(entry), echo: true };
    } catch {
      return { ok: false, message: `learned capability not found: ${target}`, echo: true };
    }
  }
  const resolved = await resolveLearningStoreForSession(ctx.sessionId);
  if (!resolved.ok) return resolved;
  const sdk = await loadAgentSdk();
  const result = await sdk.readLearningProposalStore(resolved.storePath);
  const selected = selectLearningProposal(result.proposals, target);
  if (!selected.ok) return { ok: false, message: selected.message };
  return { ok: true, message: compactSlashMessage(formatLearningDiff(selected.entry)), echo: true };
}

async function handleLearningApprove(ctx: SlashHandlerContext): Promise<SlashHandlerResult> {
  const acknowledgeImpact = ctx.args.includes('--ack-impact');
  const target = ctx.args.slice(1).find((arg) => arg !== '--ack-impact');
  if (!target) return { ok: false, message: learningHelp() };
  if (usesRuntimeLearning(ctx.sessionId)) {
    return {
      ok: false,
      message:
        `Coder learned capabilities keep review and trust separate. ` +
        `Run /learn review ${target}, inspect the result, then run /learn trust ${target}.`,
      echo: true,
    };
  }
  const resolved = await resolveLearningStoreForSession(ctx.sessionId);
  if (!resolved.ok) return resolved;
  const sdk = await loadAgentSdk();
  const store = await sdk.readLearningProposalStore(resolved.storePath);
  const selected = selectLearningProposal(store.proposals, target);
  if (!selected.ok) return { ok: false, message: selected.message };
  const approval = await sdk.approveStoredLearningProposal(resolved.storePath, selected.entry, {
    acknowledgeImpact,
  });
  return {
    ok: approval.status.startsWith('approved_'),
    message: formatLearningApproval(selected.entry, approval),
    echo: true,
  };
}

async function handleRuntimeLearningAction(
  ctx: SlashHandlerContext,
  action: 'review' | 'trust' | 'disable' | 'rollback',
): Promise<SlashHandlerResult> {
  const target = ctx.args[1];
  if (!target) return { ok: false, message: learningHelp() };
  if (!usesRuntimeLearning(ctx.sessionId)) {
    return {
      ok: false,
      message: `/learn ${action} is available only for Coder Runtime learned capabilities.`,
      echo: true,
    };
  }
  try {
    const record = await runtimeHostAdapter.getLearnedCapability(target);
    await learningSafetyService.action({
      action,
      capabilityId: record.capabilityId,
      expectedRevision: record.revision,
      ...(record.schemaVersion === 2 ? { expectedFingerprint: record.artifact.fingerprint } : {}),
    });
    const verb =
      action === 'review'
        ? 'Reviewed'
        : action === 'trust'
          ? 'Trusted'
          : action === 'disable'
            ? 'Disabled'
            : 'Rolled back';
    return { ok: true, message: `${verb} learned capability ${target}.`, echo: true };
  } catch {
    return {
      ok: false,
      message: `Cannot ${action} learned capability ${target}; inspect it with /learn diff ${target}.`,
      echo: true,
    };
  }
}

async function handleLearningReject(ctx: SlashHandlerContext): Promise<SlashHandlerResult> {
  const target = ctx.args[1];
  if (!target) return { ok: false, message: learningHelp() };
  if (usesRuntimeLearning(ctx.sessionId)) {
    try {
      const record = await runtimeHostAdapter.getLearnedCapability(target);
      await learningSafetyService.action({
        action: 'reject',
        capabilityId: record.capabilityId,
        expectedRevision: record.revision,
        ...(record.schemaVersion === 2 ? { expectedFingerprint: record.artifact.fingerprint } : {}),
      });
      return { ok: true, message: `Rejected learned capability ${target}.`, echo: true };
    } catch {
      return { ok: false, message: `Cannot reject learned capability ${target}.`, echo: true };
    }
  }
  const resolved = await resolveLearningStoreForSession(ctx.sessionId);
  if (!resolved.ok) return resolved;
  const sdk = await loadAgentSdk();
  const store = await sdk.readLearningProposalStore(resolved.storePath);
  const selected = selectLearningProposal(store.proposals, target);
  if (!selected.ok) return { ok: false, message: selected.message };
  if (selected.entry.status !== 'pending') {
    return {
      ok: false,
      message: `Cannot reject ${selected.entry.proposalId}; current status is ${selected.entry.status}.`,
    };
  }
  const reason = ctx.args.slice(2).join(' ').trim();
  const updated = await sdk.updateLearningProposalStatus(
    resolved.storePath,
    selected.entry.proposalId,
    'rejected',
    {
      ...(reason ? { rejectedReason: reason } : {}),
    },
  );
  return {
    ok: true,
    message: `Rejected ${updated.proposalId}${reason ? `: ${reason}` : '.'}`,
    echo: true,
  };
}

async function handleLearningCommand(ctx: SlashHandlerContext): Promise<SlashHandlerResult> {
  const sub = ctx.args[0]?.toLowerCase();
  if (!sub || sub === 'pending' || sub === 'list' || sub === 'ls')
    return handleLearningPending(ctx, 'all');
  if (sub === 'ledger' || sub === 'ledgers') return handleLearningLedger(ctx);
  if (sub === 'skill' || sub === 'skills') return handleLearningPending(ctx, 'skill');
  if (sub === 'workflow' || sub === 'workflows') return handleLearningPending(ctx, 'workflow');
  if (sub === 'memory' || sub === 'memories') return handleLearningPending(ctx, 'memory');
  if (sub === 'diff' || sub === 'show') return handleLearningDiff(ctx);
  if (sub === 'review') return handleRuntimeLearningAction(ctx, 'review');
  if (sub === 'trust') return handleRuntimeLearningAction(ctx, 'trust');
  if (sub === 'disable') return handleRuntimeLearningAction(ctx, 'disable');
  if (sub === 'rollback') return handleRuntimeLearningAction(ctx, 'rollback');
  if (sub === 'approve') return handleLearningApprove(ctx);
  if (sub === 'reject') return handleLearningReject(ctx);
  if (sub === 'help' || sub === '--help' || sub === '-h')
    return { ok: true, message: learningHelp(), echo: true };
  return { ok: false, message: learningHelp() };
}

function memoryHelp(): string {
  return [
    'Usage:',
    '  /memory inbox',
    '  /memory list',
    '  /memory show <proposal-or-ref-id>',
    '  /memory approve <proposal-id>',
    '  /memory reject <proposal-id> [reason]',
    '  /memory curate',
    '  /memory open',
    '  /memory help',
  ].join('\n');
}

function formatMemoryRef(ref: MemoryItemRefT): string {
  const title = ref.title ? `  ${truncateLearningText(ref.title, 96)}` : '';
  const storage = ref.storageUri ? `\n  Path: ${truncateLearningText(ref.storageUri, 140)}` : '';
  const sources = ref.sourceRefs.length
    ? `\n  Sources: ${ref.sourceRefs.slice(0, 4).join(', ')}`
    : '';
  return `${ref.id}  ${ref.lifecycle}  ${ref.kind}/${ref.scope}${title}${storage}${sources}`;
}

function formatMemoryProposalSummary(proposal: MemoryActionProposalT): string {
  const targets =
    proposal.targetRefs
      .map((ref) => ref.id)
      .slice(0, 4)
      .join(', ') || '(none)';
  const sources =
    proposal.sourceRefs
      .map((ref) => ref.id)
      .slice(0, 4)
      .join(', ') || '(none)';
  return [
    `${proposal.id}  ${proposal.action}  risk=${proposal.risk}`,
    `  Created: ${proposal.createdAt}`,
    `  Preview: ${truncateLearningText(proposal.preview.summary, 180)}`,
    `  Rationale: ${truncateLearningText(proposal.rationale, 180)}`,
    `  Targets: ${targets}`,
    `  Sources: ${sources}`,
  ].join('\n');
}

function formatMemoryProposalDetail(proposal: MemoryActionProposalT): string {
  const lines = [
    'Memory proposal',
    `${proposal.id}  ${proposal.action}  risk=${proposal.risk}`,
    `Created: ${proposal.createdAt}`,
    `Rationale: ${proposal.rationale}`,
    '',
    `Preview: ${proposal.preview.summary}`,
    '',
    'Target refs:',
    ...(proposal.targetRefs.length
      ? proposal.targetRefs.map((ref) => `  - ${formatMemoryRef(ref).replace(/\n/g, '\n    ')}`)
      : ['  (none)']),
    '',
    'Source refs:',
    ...(proposal.sourceRefs.length
      ? proposal.sourceRefs.map((ref) => `  - ${formatMemoryRef(ref).replace(/\n/g, '\n    ')}`)
      : ['  (none)']),
    '',
    'Changed paths:',
    ...(proposal.preview.changedPaths.length
      ? proposal.preview.changedPaths.map((p) => `  - ${p}`)
      : ['  (none)']),
  ];
  const warnings = proposal.preview.warnings;
  if (warnings.length) lines.push('', 'Warnings:', ...warnings.map((warning) => `  - ${warning}`));
  const fingerprintKeys = Object.keys(proposal.expectedFingerprints);
  if (fingerprintKeys.length)
    lines.push('', 'Fingerprint guard:', ...fingerprintKeys.map((key) => `  - ${key}`));
  if (proposal.preview.diff) {
    lines.push('', 'Diff preview:', truncateLearningBlock(proposal.preview.diff, 1600));
  }
  lines.push('', `Next: /memory approve ${proposal.id} or /memory reject ${proposal.id} [reason].`);
  return lines.join('\n');
}

function formatMemoryApplyResult(result: MemoryApplyResultT): string {
  if (!result.applied) {
    return [
      `Approval blocked for ${result.proposalId}: ${result.skippedReason ?? 'not applied'}`,
      'Re-run /memory show before approving if the preview changed.',
      ...(result.warnings.length
        ? ['', 'Warnings:', ...result.warnings.map((warning) => `  - ${warning}`)]
        : []),
    ].join('\n');
  }
  return [
    `Applied ${result.proposalId}.`,
    ...(result.changedPaths.length
      ? ['Changed paths:', ...result.changedPaths.map((p) => `  - ${p}`)]
      : ['No path changes reported.']),
    ...(result.warnings.length
      ? ['', 'Warnings:', ...result.warnings.map((warning) => `  - ${warning}`)]
      : []),
  ].join('\n');
}

function formatMemoryRejectResult(result: MemoryRejectResultT): string {
  if (!result.rejected) {
    return `Reject skipped for ${result.proposalId}: ${result.skippedReason ?? 'not rejected'}`;
  }
  const lines = [`Rejected ${result.proposalId}.`];
  if (result.warnings.length)
    lines.push('', 'Warnings:', ...result.warnings.map((warning) => `  - ${warning}`));
  if (result.review?.warnings.length) {
    lines.push('', 'Review:', ...result.review.warnings.map((warning) => `  - ${warning}`));
  }
  return lines.join('\n');
}

function formatMemoryReport(report: MemoryGovernanceReportT): string {
  return [
    `Memory governance report ${report.reportId}`,
    `Generated: ${report.generatedAt}`,
    '',
    'Findings:',
    ...(report.findings.length
      ? report.findings.map((finding) => {
          const refs = finding.refIds.length ? ` refs=${finding.refIds.join(',')}` : '';
          return `  - ${finding.kind}/${finding.severity}: ${finding.summary} -> ${finding.suggestedAction}${refs}`;
        })
      : ['  (none)']),
    ...(report.warnings.length
      ? ['', 'Warnings:', ...report.warnings.map((warning) => `  - ${warning}`)]
      : []),
  ].join('\n');
}

function selectMemoryProposal(
  proposals: readonly MemoryActionProposalT[],
  target: string,
):
  | { readonly ok: true; readonly proposal: MemoryActionProposalT }
  | { readonly ok: false; readonly message: string } {
  const normalized = target.trim().toLowerCase();
  if (!normalized) return { ok: false, message: 'memory proposal id is required' };
  const exact = proposals.find((proposal) => proposal.id.toLowerCase() === normalized);
  if (exact) return { ok: true, proposal: exact };
  const matches = proposals.filter((proposal) => proposal.id.toLowerCase().startsWith(normalized));
  if (matches.length === 1) return { ok: true, proposal: matches[0]! };
  if (matches.length > 1) {
    return {
      ok: false,
      message: `ambiguous memory proposal id '${target}': ${matches.map((p) => p.id).join(', ')}`,
    };
  }
  return { ok: false, message: `memory proposal not found: ${target}` };
}

function selectMemoryRef(
  refs: readonly MemoryItemRefT[],
  target: string,
):
  | { readonly ok: true; readonly ref: MemoryItemRefT }
  | { readonly ok: false; readonly message: string } {
  const normalized = target.trim().toLowerCase();
  if (!normalized) return { ok: false, message: 'memory ref id is required' };
  const exact = refs.find((ref) => ref.id.toLowerCase() === normalized);
  if (exact) return { ok: true, ref: exact };
  const matches = refs.filter((ref) => ref.id.toLowerCase().startsWith(normalized));
  if (matches.length === 1) return { ok: true, ref: matches[0]! };
  if (matches.length > 1) {
    return {
      ok: false,
      message: `ambiguous memory ref id '${target}': ${matches.map((ref) => ref.id).join(', ')}`,
    };
  }
  return { ok: false, message: `memory ref not found: ${target}` };
}

async function handleMemoryInbox(ctx: SlashHandlerContext): Promise<SlashHandlerResult> {
  const result = await memoryGovernanceService.list({ sessionId: ctx.sessionId });
  const lines = result.inbox.length
    ? [
        `Memory inbox: ${result.inbox.length}`,
        ...result.inbox.map(formatMemoryProposalSummary),
        'Next: /memory show <proposal-id>, /memory approve <proposal-id>, or /memory reject <proposal-id> [reason].',
      ]
    : ['No pending memory proposals for this project.'];
  if (result.warnings.length)
    lines.push('', 'Warnings:', ...result.warnings.map((warning) => `  - ${warning}`));
  return { ok: true, message: compactSlashMessage(lines.join('\n\n'), 3200), echo: true };
}

async function handleMemoryList(ctx: SlashHandlerContext): Promise<SlashHandlerResult> {
  const query = ctx.args.slice(1).join(' ').trim();
  const result = await memoryGovernanceService.list({
    sessionId: ctx.sessionId,
    ...(query ? { query } : {}),
  });
  const lines = result.refs.length
    ? [`Memory refs: ${result.refs.length}`, ...result.refs.map(formatMemoryRef)]
    : ['No governed memory refs for this project yet.'];
  if (result.inbox.length)
    lines.push('', `Pending proposals: ${result.inbox.length} (run /memory inbox)`);
  return { ok: true, message: compactSlashMessage(lines.join('\n\n'), 3200), echo: true };
}

async function handleMemoryShow(ctx: SlashHandlerContext): Promise<SlashHandlerResult> {
  const target = ctx.args[1];
  if (!target) return { ok: false, message: memoryHelp() };
  const listed = await memoryGovernanceService.list({ sessionId: ctx.sessionId });
  const proposal = selectMemoryProposal(listed.inbox, target);
  if (proposal.ok) {
    return {
      ok: true,
      message: compactSlashMessage(formatMemoryProposalDetail(proposal.proposal), 4200),
      echo: true,
    };
  }
  const ref = selectMemoryRef(listed.refs, target);
  if (!ref.ok) return { ok: false, message: `${proposal.message}\n${ref.message}` };
  const snapshot = await memoryGovernanceService.readRef({
    sessionId: ctx.sessionId,
    ref: ref.ref,
  });
  const lines = [
    'Memory ref',
    formatMemoryRef(snapshot.snapshot.ref),
    `Fingerprint: ${snapshot.snapshot.bodyFingerprint}`,
    `Read at: ${snapshot.snapshot.readAt}`,
    ...(snapshot.snapshot.warnings.length
      ? ['', 'Warnings:', ...snapshot.snapshot.warnings.map((warning) => `  - ${warning}`)]
      : []),
    '',
    truncateLearningBlock(snapshot.snapshot.body, 2200),
  ];
  return { ok: true, message: compactSlashMessage(lines.join('\n'), 4200), echo: true };
}

async function handleMemoryApprove(ctx: SlashHandlerContext): Promise<SlashHandlerResult> {
  const target = ctx.args[1];
  if (!target) return { ok: false, message: memoryHelp() };
  const listed = await memoryGovernanceService.list({ sessionId: ctx.sessionId });
  const selected = selectMemoryProposal(listed.inbox, target);
  if (!selected.ok) return { ok: false, message: selected.message };
  const approved = await memoryGovernanceService.approve({
    sessionId: ctx.sessionId,
    proposalId: selected.proposal.id,
    expectedFingerprints: selected.proposal.expectedFingerprints,
  });
  return {
    ok: approved.result.applied,
    message: compactSlashMessage(formatMemoryApplyResult(approved.result), 3200),
    echo: true,
  };
}

async function handleMemoryReject(ctx: SlashHandlerContext): Promise<SlashHandlerResult> {
  const target = ctx.args[1];
  if (!target) return { ok: false, message: memoryHelp() };
  const listed = await memoryGovernanceService.list({ sessionId: ctx.sessionId });
  const selected = selectMemoryProposal(listed.inbox, target);
  if (!selected.ok) return { ok: false, message: selected.message };
  const reason = ctx.args.slice(2).join(' ').trim();
  const rejected = await memoryGovernanceService.reject({
    sessionId: ctx.sessionId,
    proposalId: selected.proposal.id,
    ...(reason ? { reason } : {}),
  });
  return {
    ok: rejected.result.rejected,
    message: compactSlashMessage(formatMemoryRejectResult(rejected.result), 3200),
    echo: true,
  };
}

async function handleMemoryCurate(ctx: SlashHandlerContext): Promise<SlashHandlerResult> {
  const report = await memoryGovernanceService.curate({ sessionId: ctx.sessionId });
  return {
    ok: true,
    message: compactSlashMessage(formatMemoryReport(report.report), 4200),
    echo: true,
  };
}

async function handleMemoryCommand(ctx: SlashHandlerContext): Promise<SlashHandlerResult> {
  const session = kodaxHost.get(ctx.sessionId);
  if (!session) return { ok: false, message: `session not found: ${ctx.sessionId}` };
  if (session.surface === 'partner') {
    return {
      ok: false,
      message:
        'Memory Governance is available from the Coder surface. Partner KB remains separate.',
    };
  }
  const sub = ctx.args[0]?.toLowerCase();
  if (!sub || sub === 'inbox' || sub === 'pending') return handleMemoryInbox(ctx);
  if (sub === 'list' || sub === 'ls') return handleMemoryList(ctx);
  if (sub === 'show' || sub === 'read') return handleMemoryShow(ctx);
  if (sub === 'approve') return handleMemoryApprove(ctx);
  if (sub === 'reject') return handleMemoryReject(ctx);
  if (sub === 'curate' || sub === 'governance') return handleMemoryCurate(ctx);
  if (sub === 'open') return { ok: true, message: '__action__:show-memory', echo: false };
  if (sub === 'help' || sub === '--help' || sub === '-h')
    return { ok: true, message: memoryHelp(), echo: true };
  return { ok: false, message: memoryHelp() };
}

function formatSdkExtensionDiagnostics(
  diag: Awaited<ReturnType<typeof getSpaceSdkExtensionDiagnostics>>,
): string[] {
  if (!diag) return ['Runtime: inactive'];
  return [
    'Runtime: active',
    `Loaded extensions: ${diag.loadedExtensions.length}`,
    `Capability providers: ${diag.capabilityProviders.length}`,
    `Commands: ${diag.commands.length}`,
    `Tools: ${diag.tools.length}`,
    `Hooks: ${diag.hooks.length}`,
    `Failures: ${diag.failures.length}`,
    ...(diag.failures.length
      ? [
          'Recent failures:',
          ...diag.failures
            .slice(0, 5)
            .map((failure) => `  - ${failure.stage} ${failure.target}: ${failure.message}`),
        ]
      : []),
  ];
}

async function handleSdkExtensionsCommand(ctx: SlashHandlerContext): Promise<SlashHandlerResult> {
  const session = kodaxHost.get(ctx.sessionId);
  if (!session) return { ok: false, message: `session not found: ${ctx.sessionId}` };
  const action = ctx.args[1]?.toLowerCase();
  const shouldLoad = action === 'load' || action === 'enable' || action === 'activate';
  const loaded = shouldLoad
    ? await createSpaceSdkExtensionRuntime(
        { projectRoot: session.projectRoot, setActive: true },
        { env: { KODAX_SPACE_ENABLE_SDK_EXTENSIONS: '1' } },
      )
    : undefined;
  const discovery = loaded?.discovery ?? (await discoverSpaceSdkExtensions());
  const diagnostics = loaded?.diagnostics ?? (await getSpaceSdkExtensionDiagnostics());
  const lines = [
    'SDK extension discovery',
    `Default dir: ${discovery.defaultDirectory}`,
    `Discovered: ${discovery.paths.length}`,
    ...(discovery.paths.length
      ? discovery.paths.slice(0, 12).map((p) => `  - ${p}`)
      : ['  (none)']),
    ...(discovery.paths.length > 12 ? [`  ... ${discovery.paths.length - 12} more`] : []),
    ...(discovery.skipped.length
      ? [
          '',
          'Skipped:',
          ...discovery.skipped
            .slice(0, 8)
            .map((entry) => `  - ${entry.path}: ${entry.reason} (${entry.message})`),
        ]
      : []),
    '',
    ...formatSdkExtensionDiagnostics(diagnostics),
  ];
  if (!shouldLoad && !diagnostics) {
    lines.push(
      '',
      'Load explicitly with /extensions sdk load, or set KODAX_SPACE_ENABLE_SDK_EXTENSIONS=1 before launching Space.',
    );
  }
  return { ok: true, message: compactSlashMessage(lines.join('\n'), 3200), echo: true };
}

function recoveryHelp(): string {
  return [
    'Usage:',
    '  /recover seed [reason]',
    '  /recover prompt [reason]',
    '  /recover candidate <message-count> <error text>',
  ].join('\n');
}

function extractMessageText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  let text = '';
  for (const block of content) {
    if (!block || typeof block !== 'object') continue;
    const candidate = block as { type?: unknown; text?: unknown; thinking?: unknown };
    if (candidate.type === 'text' && typeof candidate.text === 'string') text += candidate.text;
    if (candidate.type === 'thinking' && typeof candidate.thinking === 'string')
      text += candidate.thinking;
  }
  return text;
}

async function handleRecoveryCommand(ctx: SlashHandlerContext): Promise<SlashHandlerResult> {
  const session = kodaxHost.get(ctx.sessionId);
  if (!session) return { ok: false, message: `session not found: ${ctx.sessionId}` };
  const sub = ctx.args[0]?.toLowerCase() ?? 'seed';
  if (sub === 'help' || sub === '--help' || sub === '-h')
    return { ok: true, message: recoveryHelp(), echo: true };
  if (sub === 'prompt') {
    const agent = await loadAgentSdk();
    const prompt = agent.normalizeRecoveryPrompt(ctx.args.slice(1).join(' ').trim() || undefined);
    return { ok: true, message: prompt, echo: true };
  }
  if (sub === 'candidate') {
    const count = Number(ctx.args[1]);
    const errorText = ctx.args.slice(2).join(' ').trim();
    if (!Number.isInteger(count) || count < 0 || !errorText)
      return { ok: false, message: recoveryHelp() };
    const coding = await loadSpaceSdkCoding();
    const candidate = coding.isSessionRecoveryCandidateError(new Error(errorText), count);
    return {
      ok: true,
      message: `Recovery candidate: ${candidate ? 'yes' : 'no'} (messageCount=${count})`,
      echo: true,
    };
  }
  if (sub !== 'seed') return { ok: false, message: recoveryHelp() };
  const data = await loadPersistedSession(ctx.sessionId);
  if (!data || !Array.isArray(data.messages) || data.messages.length === 0) {
    return {
      ok: false,
      message:
        'No persisted transcript is available for this session yet. Send a turn first, then retry /recover seed.',
    };
  }
  const agent = await loadAgentSdk();
  const reason = ctx.args.slice(1).join(' ').trim();
  const seed = agent.buildRecoverySeed({
    sourceSessionId: ctx.sessionId,
    messages: data.messages,
    ...(data.lineage ? { lineage: data.lineage } : {}),
    ...(data.artifactLedger ? { artifactLedger: data.artifactLedger } : {}),
    ...(reason ? { reason } : {}),
  });
  const roleCounts = seed.messages.reduce<Record<string, number>>((acc, msg) => {
    acc[msg.role] = (acc[msg.role] ?? 0) + 1;
    return acc;
  }, {});
  const firstUser = data.messages.find((msg) => msg.role === 'user');
  const lastAssistant = [...data.messages].reverse().find((msg) => msg.role === 'assistant');
  const lines = [
    'Recovery seed preview',
    `Session: ${ctx.sessionId}`,
    `Source messages: ${data.messages.length}; seed messages: ${seed.messages.length}`,
    `Seed title: ${seed.title}`,
    `Roles: ${
      Object.entries(roleCounts)
        .map(([role, count]) => `${role}=${count}`)
        .join(', ') || '(none)'
    }`,
    firstUser
      ? `First user: ${truncateLearningText(extractMessageText(firstUser.content), 180)}`
      : '',
    lastAssistant
      ? `Last assistant: ${truncateLearningText(extractMessageText(lastAssistant.content), 180)}`
      : '',
    '',
    'Summary:',
    truncateLearningBlock(seed.summary, 900),
  ].filter(Boolean);
  return { ok: true, message: compactSlashMessage(lines.join('\n'), 3200), echo: true };
}

function isFinalWorkflowStatus(status: WorkflowRunT['status']): boolean {
  return status === 'completed' || status === 'failed' || status === 'cancelled';
}

function workflowTitle(run: WorkflowRunT): string {
  return run.displayName || run.workflowName || run.runId;
}

function formatWorkflowRun(run: WorkflowRunT): string {
  const title = workflowTitle(run);
  const progress = run.progress
    ? ` agents ${run.progress.finishedAgents}/${Math.max(
        run.progress.plannedItems ?? run.progress.spawnedAgents,
        run.progress.finishedAgents,
      )}`
    : '';
  const message = run.latestMessage ? ` - ${run.latestMessage}` : '';
  return `${run.runId}  ${run.status}  ${title}${progress}${message}`;
}

function latestWorkflowRun(sessionId: string, preferActive = false): WorkflowRunT | undefined {
  const runs = workflowController.list(sessionId).sort((a, b) => {
    const at = Date.parse(a.updatedAt || a.startedAt || '');
    const bt = Date.parse(b.updatedAt || b.startedAt || '');
    return bt - at;
  });
  if (!preferActive) return runs[0];
  return runs.find((r) => !isFinalWorkflowStatus(r.status)) ?? runs[0];
}

type WorkflowInvocation =
  | { readonly kind: 'help' }
  | { readonly kind: 'list' }
  | { readonly kind: 'runs'; readonly rawArgs: readonly string[] }
  | { readonly kind: 'show'; readonly runId: string; readonly full?: boolean }
  | { readonly kind: 'pause'; readonly runId: string }
  | { readonly kind: 'resume'; readonly runId: string }
  | { readonly kind: 'stop'; readonly runId: string }
  | {
      readonly kind: 'delete';
      readonly target: string;
      readonly force?: boolean;
      readonly scope?: 'run' | 'saved' | 'conflict';
    }
  | { readonly kind: 'prune'; readonly rawArgs: readonly string[] }
  | { readonly kind: 'save'; readonly runId: string; readonly name: string }
  | { readonly kind: 'rename'; readonly target: string; readonly newName: string }
  | {
      readonly kind: 'revise';
      readonly target: string;
      readonly request: string;
      readonly replace?: boolean;
    }
  | { readonly kind: 'rerun'; readonly runId: string; readonly rawArgs: string }
  | { readonly kind: 'create'; readonly request: string }
  | { readonly kind: 'start'; readonly name: string; readonly rawArgs: string };

/**
 * Read-only `/workflow` subcommands that never spawn child agents. Everything
 * else is execution-class (create/start/rerun/revise) or run-lifecycle
 * (pause/resume/stop/delete/prune/save/rename) and is fenced off from the
 * Partner surface — a Partner workflow would spawn full-tool-access children
 * that bypass the Partner toolVisibilityPolicy / agentProfile entirely. This
 * mirrors the SDK's own posture (SA strips the workflow tool cluster and rejects
 * execution-class `/workflow` subcommands; FEATURE_246 / ADR-047).
 */
const WORKFLOW_INSPECTION_KINDS: ReadonlySet<WorkflowInvocation['kind']> = new Set([
  'help',
  'list',
  'runs',
  'show',
]);

export function isPartnerAllowedWorkflowKind(kind: WorkflowInvocation['kind']): boolean {
  return WORKFLOW_INSPECTION_KINDS.has(kind);
}

const DEFAULT_WORKFLOW_RUNS_LIMIT = 20;
const DEFAULT_WORKFLOW_PRUNE_KEEP = 50;
const MAX_WORKFLOW_RUNS_LIMIT = 200;
const WORKFLOW_ARG_HINT =
  'pending | help | list | runs [--all|--limit N] | show [runId] | pause <runId> | resume <runId> | stop [runId] | delete [--force] [--run|--saved] <runId|savedName> | prune --dry-run|--keep N|--older-than Nd | rerun <runId|savedName> [args] | save <runId> <name> | rename <runId|alias|savedName> <newName> | revise [--replace] <runId|alias|savedName> <change> | create <request> | <name> [args]';

function parseWorkflowInvocation(args: readonly string[]): WorkflowInvocation {
  const first = args[0]?.toLowerCase();
  if (first === 'help' || first === '--help' || first === '-h') return { kind: 'help' };
  if (!first || first === 'list' || first === 'ls') return { kind: 'list' };
  if (first === 'runs') return { kind: 'runs', rawArgs: args.slice(1) };
  if (first === 'show') {
    const rest = args.slice(1);
    const full = rest.includes('--full');
    const runId = rest.find((arg) => arg !== '--full') ?? '';
    return full ? { kind: 'show', runId, full: true } : { kind: 'show', runId };
  }
  if (first === 'pause') return { kind: 'pause', runId: args[1] ?? '' };
  if (first === 'resume') return { kind: 'resume', runId: args[1] ?? '' };
  if (first === 'stop') return { kind: 'stop', runId: args[1] ?? '' };
  if (first === 'delete') {
    const rest = args.slice(1);
    const force = rest.includes('--force');
    const saved = rest.includes('--saved');
    const run = rest.includes('--run');
    const target =
      rest.find((arg) => arg !== '--force' && arg !== '--saved' && arg !== '--run') ?? '';
    const scope = saved && run ? 'conflict' : saved ? 'saved' : run ? 'run' : undefined;
    return {
      kind: 'delete',
      target,
      ...(force ? { force: true } : {}),
      ...(scope ? { scope } : {}),
    };
  }
  if (first === 'prune') return { kind: 'prune', rawArgs: args.slice(1) };
  if (first === 'save') return { kind: 'save', runId: args[1] ?? '', name: args[2] ?? '' };
  if (first === 'rename')
    return { kind: 'rename', target: args[1] ?? '', newName: args.slice(2).join(' ').trim() };
  if (first === 'revise') {
    const raw = args.slice(1);
    const replace = raw.includes('--replace');
    const cleaned = raw.filter((arg) => arg !== '--replace');
    return {
      kind: 'revise',
      target: cleaned[0] ?? '',
      request: cleaned.slice(1).join(' ').trim(),
      ...(replace ? { replace: true } : {}),
    };
  }
  if (first === 'rerun')
    return { kind: 'rerun', runId: args[1] ?? '', rawArgs: args.slice(2).join(' ').trim() };
  if (first === 'create') return { kind: 'create', request: args.slice(1).join(' ').trim() };
  return { kind: 'start', name: args[0]!, rawArgs: args.slice(1).join(' ').trim() };
}

function parseWorkflowArgs(raw: string): unknown {
  const trimmed = raw.trim();
  if (!trimmed) return {};
  if (trimmed.startsWith('{')) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return { question: trimmed };
    }
  }
  return { question: trimmed };
}

function parseNonNegativeInteger(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

function parseOlderThanMs(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const match = /^(\d+)([dh]?)$/i.exec(value.trim());
  if (!match) return undefined;
  const amount = Number(match[1]);
  if (!Number.isInteger(amount) || amount <= 0) return undefined;
  return (match[2]?.toLowerCase() === 'h' ? amount * 60 * 60 : amount * 24 * 60 * 60) * 1000;
}

function parseWorkflowRunsOptions(args: readonly string[]): {
  readonly all: boolean;
  readonly limit: number;
  readonly error?: string;
} {
  let all = false;
  let limit = DEFAULT_WORKFLOW_RUNS_LIMIT;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--all') {
      all = true;
      continue;
    }
    if (arg === '--limit') {
      const parsed = parseNonNegativeInteger(args[index + 1]);
      if (parsed === undefined || parsed < 1)
        return { all, limit, error: '--limit expects a positive integer' };
      limit = Math.min(parsed, MAX_WORKFLOW_RUNS_LIMIT);
      index += 1;
      continue;
    }
    return { all, limit, error: `unknown option: ${arg ?? ''}` };
  }
  return { all, limit };
}

function parseWorkflowPruneOptions(args: readonly string[]): {
  readonly dryRun: boolean;
  readonly keep?: number;
  readonly olderThanDays?: number;
  readonly error?: string;
} {
  let dryRun = false;
  let keep: number | undefined;
  let olderThanDays: number | undefined;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--dry-run') {
      dryRun = true;
      continue;
    }
    if (arg === '--keep') {
      const parsed = parseNonNegativeInteger(args[index + 1]);
      if (parsed === undefined) return { dryRun, error: '--keep expects a non-negative integer' };
      keep = parsed;
      index += 1;
      continue;
    }
    if (arg === '--older-than') {
      const parsed = parseOlderThanMs(args[index + 1]);
      if (parsed === undefined)
        return { dryRun, error: '--older-than expects a value like 7d or 24h' };
      olderThanDays = Math.ceil(parsed / (24 * 60 * 60 * 1000));
      index += 1;
      continue;
    }
    return { dryRun, error: `unknown option: ${arg ?? ''}` };
  }
  if (dryRun && keep === undefined && olderThanDays === undefined) {
    return { dryRun, keep: DEFAULT_WORKFLOW_PRUNE_KEEP };
  }
  return {
    dryRun,
    ...(keep !== undefined ? { keep } : {}),
    ...(olderThanDays !== undefined ? { olderThanDays } : {}),
  };
}

function workflowHelp(): string {
  return [
    'Usage:',
    '  /workflow pending',
    '  /workflow help',
    '  /workflow list',
    '  /workflow runs [--all|--limit N]',
    '  /workflow show [--full] [runId]',
    '  /workflow pause <runId>',
    '  /workflow resume <runId>',
    '  /workflow stop [runId]',
    '  /workflow delete [--force] [--run|--saved] <runId|savedName>',
    '  /workflow prune --dry-run|--keep N|--older-than Nd',
    '  /workflow rerun <runId|savedName> [args]',
    '  /workflow save <runId> <name>',
    '  /workflow rename <runId|savedName> <newName>',
    '  /workflow revise [--replace] <runId|savedName> <change>',
    '  /workflow create <request>',
    '  /workflow <name> [args]',
  ].join('\n');
}

function sessionToLaunchSession(s: ReturnType<typeof kodaxHost.get>): LaunchSession | null {
  if (!s) return null;
  return {
    sessionId: s.sessionId,
    surface: s.surface,
    provider: s.provider,
    ...(s.model ? { model: s.model } : {}),
    reasoningMode: s.reasoningMode,
    agentMode: s.agentMode,
    projectRoot: s.projectRoot,
  };
}

function workflowRunsForSession(sessionId: string): WorkflowRunT[] {
  return workflowController.list(sessionId).sort((a, b) => {
    const at = Date.parse(a.updatedAt || a.startedAt || '');
    const bt = Date.parse(b.updatedAt || b.startedAt || '');
    return bt - at;
  });
}

function findWorkflowRun(sessionId: string, target: string): WorkflowRunT | undefined {
  if (!target || target === 'latest') return latestWorkflowRun(sessionId);
  const lower = target.toLowerCase();
  const direct = workflowController.get(target);
  if (direct?.sessionId === sessionId) return direct;
  return workflowRunsForSession(sessionId).find((run) => {
    const title = workflowTitle(run).toLowerCase();
    return run.runId === target || run.workflowName.toLowerCase() === lower || title === lower;
  });
}

function findSavedWorkflow(
  saved: readonly SavedWorkflowLite[],
  target: string,
): SavedWorkflowLite | undefined {
  const lower = target.toLowerCase();
  return saved.find(
    (w) => w.name === target || w.name.toLowerCase() === lower || w.path === target,
  );
}

function workflowRunDetails(run: WorkflowRunT, full = false): string {
  const lines = [
    formatWorkflowRun(run),
    run.goal ? `Goal: ${run.goal}` : '',
    run.resultSummary ? `Result: ${run.resultSummary}` : '',
    run.error ? `Error: ${run.error}` : '',
  ];
  if (full) {
    if (run.artifacts?.length)
      lines.push(`Artifacts: ${run.artifacts.map((a) => a.name).join(', ')}`);
    if (run.items?.length) {
      lines.push('Items:');
      lines.push(
        ...run.items.slice(0, 24).map((item) => `  ${item.status} ${item.kind} ${item.title}`),
      );
      if (run.items.length > 24) lines.push(`  ... ${run.items.length - 24} more`);
    }
  }
  return lines.filter(Boolean).join('\n');
}

function formatSavedAction(
  prefix: string,
  result: { readonly name?: string; readonly path?: string; readonly previousPath?: string },
): string {
  return [
    `${prefix}: ${result.name ?? ''}`.trim(),
    result.path ? `Path: ${result.path}` : '',
    result.previousPath ? `Previous: ${result.previousPath}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

type ToggleValue = 'on' | 'off';

function parseToggleValue(value: string | undefined): ToggleValue | undefined {
  const lower = value?.toLowerCase();
  if (lower === 'on' || lower === 'true' || lower === '1') return 'on';
  if (lower === 'off' || lower === 'false' || lower === '0') return 'off';
  return undefined;
}

function formatSlashCommandUsage(c: {
  readonly name: string;
  readonly aliases?: readonly string[];
  readonly argsHint?: string;
  readonly description: string;
}): string {
  const hint = c.argsHint ? ` ${c.argsHint}` : '';
  const aliases = c.aliases?.length
    ? ` (aliases: ${c.aliases.map((a) => `/${a}`).join(', ')})`
    : '';
  return `/${c.name}${hint}${aliases} - ${c.description}`;
}

function shellAction(action: string): { ok: true; message: string; echo: false } {
  return { ok: true, message: `__action__:${action}`, echo: false };
}

type GoalStatus = 'active' | 'paused' | 'complete' | 'blocked';
interface SlashGoalState {
  readonly objective: string;
  readonly status: GoalStatus;
  readonly tokenBudget: number | null;
  readonly tokensUsed: number;
  readonly createdAt: number;
  readonly updatedAt: number;
}

const goalBySession = new Map<string, SlashGoalState>();

export function clearSlashGoalForSession(sessionId: string): void {
  goalBySession.delete(sessionId);
}

function parseGoalCreateArgs(args: readonly string[]):
  | {
      readonly objective: string;
      readonly tokenBudget: number | null;
    }
  | { readonly error: string } {
  let tokenBudget: number | null = null;
  const objectiveParts: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--tokens') {
      const raw = args[index + 1];
      const parsed = raw ? Number(raw) : NaN;
      if (!Number.isInteger(parsed) || parsed <= 0)
        return { error: '--tokens requires a positive integer' };
      tokenBudget = parsed;
      index += 1;
      continue;
    }
    if (arg?.startsWith('--tokens=')) {
      const parsed = Number(arg.slice('--tokens='.length));
      if (!Number.isInteger(parsed) || parsed <= 0)
        return { error: '--tokens requires a positive integer' };
      tokenBudget = parsed;
      continue;
    }
    if (arg?.startsWith('--')) return { error: `unknown flag: ${arg}` };
    if (arg) objectiveParts.push(arg);
  }
  const objective = objectiveParts.join(' ').trim();
  return objective ? { objective, tokenBudget } : { error: 'objective is required' };
}

function formatGoalStatus(goal: SlashGoalState | undefined): string {
  if (!goal) return 'No goal set. Use /goal <objective> [--tokens N] to create one.';
  const lines = [
    `Goal: ${goal.objective}`,
    `Status: ${goal.status}`,
    `Tokens used: ${goal.tokensUsed}`,
    goal.tokenBudget === null
      ? 'Token budget: none'
      : `Token budget: ${goal.tokenBudget} (remaining ${Math.max(0, goal.tokenBudget - goal.tokensUsed)})`,
  ];
  return lines.join('\n');
}

function goalHelp(): string {
  return [
    'Usage:',
    '  /goal <objective> [--tokens N]',
    '  /goal status',
    '  /goal pause',
    '  /goal resume',
    '  /goal clear',
    '  /goal help',
  ].join('\n');
}

export const BUILTIN_SLASH_COMMANDS: readonly SlashCommandDef[] = [
  {
    name: 'mode',
    description: 'Show or switch permission mode (plan / accept-edits / auto)',
    argsHint: '[plan|accept-edits|auto]',
    source: 'builtin',
    handler: async (ctx) => {
      const target = ctx.args[0] === 'auto-in-project' ? 'auto' : ctx.args[0];
      const session = kodaxHost.get(ctx.sessionId);
      if (!session) return { ok: false, message: `session not found: ${ctx.sessionId}` };
      if (!target) {
        return {
          ok: true,
          message: `Current mode: ${session.permissionMode}\nUsage: /mode [plan|accept-edits|auto]`,
          echo: true,
        };
      }
      if (!isPermissionMode(target)) {
        return {
          ok: false,
          message: `unknown mode '${target}'; valid: ${PERMISSION_MODES.join(', ')}`,
        };
      }
      return commitRuntimeSlashMutation(
        ctx.sessionId,
        () => kodaxHost.setPermissionMode(ctx.sessionId, target),
        `mode -> ${target}`,
      );
    },
  },

  {
    name: 'auto-engine',
    description: 'Show or switch auto-mode classifier engine (llm / rules)',
    argsHint: '[llm|rules]',
    source: 'builtin',
    handler: async (ctx) => {
      const session = kodaxHost.get(ctx.sessionId);
      if (!session) return { ok: false, message: `session not found: ${ctx.sessionId}` };
      const target = ctx.args[0];
      if (!target) {
        return {
          ok: true,
          message: `Classifier engine: ${session.autoModeEngine}\nUsage: /auto-engine [llm|rules]`,
          echo: true,
        };
      }
      if (!isAutoEngine(target)) {
        return {
          ok: false,
          message: `unknown engine '${target}'; valid: ${AUTO_ENGINES.join(', ')}`,
        };
      }
      return commitRuntimeSlashMutation(
        ctx.sessionId,
        () => kodaxHost.setAutoModeEngine(ctx.sessionId, target),
        `auto-engine -> ${target}`,
      );
    },
  },

  {
    name: 'provider',
    description: 'Show or switch provider (must exist in catalog or custom)',
    argsHint: '[provider-id[/model]]',
    source: 'builtin',
    handler: async (ctx) => {
      const session = kodaxHost.get(ctx.sessionId);
      if (!session) return { ok: false, message: `session not found: ${ctx.sessionId}` };
      const target = ctx.args[0];
      if (!target) {
        await providerConfigStore.load();
        const custom = providerConfigStore.listCustom().map((p) => p.id);
        return {
          ok: true,
          message: [
            `Current provider: ${session.provider}${session.model ? ` / ${session.model}` : ''}`,
            'Usage: /provider [provider-id[/model]]',
            `Custom providers: ${custom.length ? custom.join(', ') : '(none)'}`,
          ].join('\n'),
          echo: true,
        };
      }
      const slashIdx = target.indexOf('/');
      const targetProvider = slashIdx >= 0 ? target.slice(0, slashIdx) : target;
      const targetModel = slashIdx >= 0 ? target.slice(slashIdx + 1) : undefined;
      if (!targetProvider || targetModel === '') {
        return { ok: false, message: 'Usage: /provider <provider-id[/model]>' };
      }
      // 走 session.setProvider 等价的 catalog 检查 (review F008 C1-sec)
      let shouldRefreshCustomRegistry = false;
      let kodaxCustomProviders: Awaited<ReturnType<typeof loadKodaxCustomProviders>> = [];
      if (targetProvider !== 'mock' && !isBuiltinId(targetProvider)) {
        await providerConfigStore.load();
        const existsInSpaceStore = Boolean(providerConfigStore.getCustom(targetProvider));
        kodaxCustomProviders = await loadKodaxCustomProviders();
        const existsInKodaxConfig = kodaxCustomProviders.some((p) => p.id === targetProvider);
        if (!existsInSpaceStore && !existsInKodaxConfig) {
          return { ok: false, message: `unknown providerId: ${targetProvider}` };
        }
        shouldRefreshCustomRegistry = true;
      }
      if (shouldRefreshCustomRegistry) {
        await registerKodaxCustomProviders(providerConfigStore.listCustom());
      }
      const providerInfo = getBuiltin(targetProvider);
      const effectiveTargetModel =
        targetModel ?? providerDescriptor(targetProvider, kodaxCustomProviders)?.defaultModel;
      if (
        targetModel &&
        providerInfo?.models?.length &&
        !providerInfo.models.includes(targetModel)
      ) {
        return {
          ok: false,
          message: `Unknown model "${targetModel}" for provider ${targetProvider}.\nAvailable: ${providerInfo.models.join(', ')}`,
        };
      }
      return commitRuntimeSlashMutation(
        ctx.sessionId,
        () => {
          const providerOk = kodaxHost.setProvider(ctx.sessionId, targetProvider);
          return providerOk && kodaxHost.setModel(ctx.sessionId, effectiveTargetModel);
        },
        `provider -> ${targetProvider}${targetModel ? ` / ${targetModel}` : ''}`,
      );
    },
  },

  {
    name: 'reasoning',
    aliases: ['reason'],
    description: 'Show or switch reasoning mode',
    argsHint: '[SDK effort]',
    source: 'builtin',
    handler: async (ctx) => {
      const session = kodaxHost.get(ctx.sessionId);
      if (!session) return { ok: false, message: `session not found: ${ctx.sessionId}` };
      const target = ctx.args[0];
      if (!target) {
        return {
          ok: true,
          message: `Reasoning mode: ${session.reasoningMode}\nUsage: /reasoning <SDK effort>; common: ${REASONING_EXAMPLES.join(', ')}`,
          echo: true,
        };
      }
      const normalizedTarget = parseReasoningMode(target);
      if (!normalizedTarget) {
        return {
          ok: false,
          message: `invalid reasoning effort token '${target}'`,
        };
      }
      return commitRuntimeSlashMutation(
        ctx.sessionId,
        () => kodaxHost.setReasoningMode(ctx.sessionId, normalizedTarget),
        `reasoning -> ${normalizedTarget}`,
      );
    },
  },

  {
    name: 'model',
    aliases: ['m'],
    description: 'Show or switch provider/model. Use /model default to clear the model override.',
    argsHint: '[provider[/model] | /model | default | list]',
    source: 'builtin',
    handler: async (ctx) => {
      const target = ctx.args[0];
      const session = kodaxHost.get(ctx.sessionId);
      if (!session) return { ok: false, message: `session not found: ${ctx.sessionId}` };

      // Provider model list 来自 built-in catalog（已在启动期从 SDK init）。
      // 未识别的 provider id（custom_xxx）→ providerInfo = undefined，退化为"接受任意 string"
      // 不阻塞用户；成功时校验 + 给"did you mean"提示。
      const providerId = session.provider;
      const providerInfo = (() => {
        const b = getBuiltin(providerId);
        return b ? { defaultModel: b.defaultModel, models: b.models ?? [] } : null;
      })();

      if (!target) {
        // 无参数: 列出当前 provider 下的可用 model + 当前选中值
        const currentModel = session.model ?? providerInfo?.defaultModel ?? '(provider default)';
        const list = providerInfo?.models ?? [];
        if (list.length === 0) {
          return {
            ok: true,
            message: `Usage: /model [provider[/model] | /model | default | list]\nCurrent: ${currentModel} (no model list for provider ${providerId})`,
            echo: true,
          };
        }
        return {
          ok: true,
          message: [
            'Usage: /model [provider[/model] | /model | default | list]',
            `Current: ${currentModel}`,
            `Available for ${providerId}:`,
            ...list.map((m) => `  • ${m}${m === currentModel ? ' ← current' : ''}`),
          ].join('\n'),
          echo: true,
        };
      }

      // 'list' 等价于无参 — 输出可用 model 列表。OpenRouter 这种 provider 可能给 200+ model,
      // 输出超 2048 字符 schema 上限会被 envelope 拒。取前 30 个 + 提示总数。
      if (target === 'list') {
        const list = providerInfo?.models ?? [];
        if (list.length === 0) {
          return { ok: false, message: `No model list available for provider ${providerId}` };
        }
        const currentModel = session.model ?? providerInfo?.defaultModel;
        const MAX_DISPLAY = 30;
        const shown = list.slice(0, MAX_DISPLAY);
        const overflow = list.length - shown.length;
        return {
          ok: true,
          message: [
            `Models for ${providerId} (${list.length} total):`,
            ...shown.map((m) => `  • ${m}${m === currentModel ? ' ← current' : ''}`),
            ...(overflow > 0
              ? [`  … +${overflow} more (use /model <name> to switch directly)`]
              : []),
            `(use /model <name> to switch, /model default to clear)`,
          ].join('\n'),
          echo: true,
        };
      }

      // 'default' 清除 override
      const isClear = target === 'default';
      if (isClear) {
        const defaultModel = providerDescriptor(
          providerId,
          await loadKodaxCustomProviders(),
        )?.defaultModel;
        return commitRuntimeSlashMutation(
          ctx.sessionId,
          () => kodaxHost.setModel(ctx.sessionId, defaultModel),
          'model -> provider default (cleared override)',
        );
      }

      if (target.startsWith('/')) {
        const targetModel = target.slice(1);
        if (!targetModel) return { ok: false, message: 'Usage: /model /<model-name>' };
        if (
          providerInfo &&
          providerInfo.models.length > 0 &&
          !providerInfo.models.includes(targetModel)
        ) {
          return {
            ok: false,
            message: `Unknown model "${targetModel}" for provider ${providerId}.\nAvailable: ${providerInfo.models.join(', ')}`,
          };
        }
        return commitRuntimeSlashMutation(
          ctx.sessionId,
          () => kodaxHost.setModel(ctx.sessionId, targetModel),
          `model -> ${providerId}/${targetModel} (applies on next send)`,
        );
      }

      if (target.includes('/')) {
        const slashIdx = target.indexOf('/');
        const targetProvider = target.slice(0, slashIdx);
        const targetModel = target.slice(slashIdx + 1);
        if (!targetProvider || !targetModel)
          return { ok: false, message: 'Usage: /model <provider>/<model>' };
        if (targetProvider !== 'mock' && !isBuiltinId(targetProvider)) {
          await providerConfigStore.load();
          const existsInSpaceStore = Boolean(providerConfigStore.getCustom(targetProvider));
          const existsInKodaxConfig = (await loadKodaxCustomProviders()).some(
            (p) => p.id === targetProvider,
          );
          if (!existsInSpaceStore && !existsInKodaxConfig) {
            return { ok: false, message: `unknown providerId: ${targetProvider}` };
          }
          await registerKodaxCustomProviders(providerConfigStore.listCustom());
        }
        const targetProviderInfo = getBuiltin(targetProvider);
        if (
          targetProviderInfo?.models?.length &&
          !targetProviderInfo.models.includes(targetModel)
        ) {
          return {
            ok: false,
            message: `Unknown model "${targetModel}" for provider ${targetProvider}.\nAvailable: ${targetProviderInfo.models.join(', ')}`,
          };
        }
        return commitRuntimeSlashMutation(
          ctx.sessionId,
          () => {
            const providerOk = kodaxHost.setProvider(ctx.sessionId, targetProvider);
            return providerOk && kodaxHost.setModel(ctx.sessionId, targetModel);
          },
          `model -> ${targetProvider}/${targetModel} (applies on next send)`,
        );
      }

      if (target === 'mock' || isBuiltinId(target)) {
        return commitRuntimeSlashMutation(
          ctx.sessionId,
          () => {
            const providerOk = kodaxHost.setProvider(ctx.sessionId, target);
            return providerOk && kodaxHost.setModel(ctx.sessionId, undefined);
          },
          `provider -> ${target} (model cleared to provider default)`,
        );
      }

      // 真实 model 名 — 校验在可用列表里。如果 provider 没暴露列表则放过 (保守 fallback)。
      if (providerInfo && providerInfo.models.length > 0 && !providerInfo.models.includes(target)) {
        // 简单 prefix-match suggest 一个最接近的
        const lower = target.toLowerCase();
        const suggestion =
          providerInfo.models.find((m) => m.toLowerCase().startsWith(lower)) ??
          providerInfo.models.find((m) => m.toLowerCase().includes(lower));
        return {
          ok: false,
          message: [
            `Unknown model "${target}" for provider ${providerId}.`,
            suggestion ? `Did you mean: ${suggestion}?` : '',
            `Available: ${providerInfo.models.join(', ')}`,
          ]
            .filter(Boolean)
            .join('\n'),
        };
      }

      return commitRuntimeSlashMutation(
        ctx.sessionId,
        () => kodaxHost.setModel(ctx.sessionId, target),
        `model -> ${target} (applies on next send)`,
      );
    },
  },

  {
    name: 'thinking',
    aliases: ['think', 't'],
    description: 'Show or change thinking/reasoning output for next turn.',
    argsHint: '[on|off|<SDK effort>]',
    source: 'builtin',
    handler: async (ctx) => {
      const target = ctx.args[0];
      const session = kodaxHost.get(ctx.sessionId);
      if (!session) return { ok: false, message: `session not found: ${ctx.sessionId}` };
      if (!target) {
        return {
          ok: true,
          message: `Thinking: ${session.thinking === undefined ? 'default' : session.thinking ? 'on' : 'off'}\nReasoning mode: ${session.reasoningMode}\nUsage: /thinking [on|off|<SDK effort>]; common: ${REASONING_EXAMPLES.join(', ')}`,
          echo: true,
        };
      }
      const normalizedTarget = parseReasoningMode(target);
      if (normalizedTarget === 'on' || normalizedTarget === 'off') {
        return commitRuntimeSlashMutation(
          ctx.sessionId,
          () => {
            const thinkingOk = kodaxHost.setThinking(ctx.sessionId, normalizedTarget === 'on');
            return (
              thinkingOk &&
              kodaxHost.setReasoningMode(ctx.sessionId, normalizedTarget === 'on' ? 'auto' : 'off')
            );
          },
          `thinking -> ${normalizedTarget}; reasoning -> ${normalizedTarget === 'on' ? 'auto' : 'off'} (applies on next send)`,
        );
      }
      if (normalizedTarget) {
        return commitRuntimeSlashMutation(
          ctx.sessionId,
          () => kodaxHost.setReasoningMode(ctx.sessionId, normalizedTarget),
          `reasoning -> ${normalizedTarget} (applies on next send)`,
        );
      }
      return {
        ok: false,
        message: `Usage: /thinking [on|off|<SDK effort>]; common: ${REASONING_EXAMPLES.join(', ')}`,
      };
    },
  },

  {
    name: 'clear',
    description: 'Clear current session message view (does not delete session)',
    source: 'builtin',
    handler: async (ctx) => {
      // 实际清屏由 renderer 端决定——main 仅确认 sessionId 有效并通过 clearStream=true
      // 显式请求 renderer 清空 eventsBySession/userMessagesBySession。
      // 用独立 flag 而非 name 匹配是为了 F035 user 命令可能同名 'clear' 时不出歧义。
      if (!kodaxHost.get(ctx.sessionId)) {
        return { ok: false, message: `session not found: ${ctx.sessionId}` };
      }
      return { ok: true, message: 'cleared', echo: true, clearStream: true };
    },
  },

  {
    name: 'agent-mode',
    aliases: ['am'],
    description: 'Switch agent mode (ama=adaptive multi-agent / sa=single-agent)',
    argsHint: '[ama|sa|toggle]',
    source: 'builtin',
    handler: async (ctx) => {
      const session = kodaxHost.get(ctx.sessionId);
      if (!session) return { ok: false, message: `session not found: ${ctx.sessionId}` };
      const raw = ctx.args[0];
      if (!raw) {
        return {
          ok: true,
          message: `Agent mode: ${session.agentMode.toUpperCase()}\nUsage: /agent-mode [ama|sa|toggle]`,
          echo: true,
        };
      }
      const parsed = normalizeAgentMode(raw);
      if (parsed === 'retired') {
        return {
          ok: false,
          message:
            'AMAW was retired in KodaX 0.7.72; use AMA. Workflow remains available through explicit Workflow intent, /workflow, named patterns, and SDK requests.',
        };
      }
      if (!parsed) {
        return {
          ok: false,
          message: `unknown agent mode '${raw}'; valid: ${AGENT_MODES.join(', ')}, toggle`,
        };
      }
      const target = parsed === 'toggle' ? nextAgentMode(session.agentMode) : parsed;
      return commitRuntimeSlashMutation(
        ctx.sessionId,
        () => kodaxHost.setAgentMode(ctx.sessionId, target),
        `agent mode -> ${target}`,
      );
    },
  },

  {
    name: 'workflow',
    description: 'Run and inspect workflows for the current session',
    argsHint: WORKFLOW_ARG_HINT,
    source: 'builtin',
    handler: async (ctx) => {
      const session = kodaxHost.get(ctx.sessionId);
      const launchSession = sessionToLaunchSession(session);
      if (!session || !launchSession)
        return { ok: false, message: `session not found: ${ctx.sessionId}` };

      if (ctx.args[0]?.toLowerCase() === 'pending') return handleLearningPending(ctx, 'workflow');

      const invocation = parseWorkflowInvocation(ctx.args);

      // Partner boundary: only read-only inspection is reachable from a Partner
      // session. Blocks the /workflow create|start|rerun|revise|pause|resume|
      // stop|delete|prune|save|rename escape hatch that would otherwise spawn
      // full-tool-access child agents outside the Partner tool policy.
      if (session.surface === 'partner' && !isPartnerAllowedWorkflowKind(invocation.kind)) {
        return {
          ok: false,
          message:
            '[partner] Workflows run under the Coder surface. In Partner, /workflow supports only inspection (list / runs / show / help). Switch to a Coder session to create, run, or manage a workflow.',
          echo: true,
        };
      }

      if (invocation.kind === 'help') {
        return { ok: true, message: workflowHelp(), echo: true };
      }

      if (invocation.kind === 'list') {
        const library = await workflowController.listLibrary(session.projectRoot);
        const lines = ['Available workflows:'];
        if (library.builtin.length > 0) {
          lines.push('Built-in:');
          lines.push(
            ...library.builtin
              .slice(0, 12)
              .map((w) => `  ${w.name}${w.description ? ` - ${w.description}` : ''}`),
          );
        }
        if (library.patterns.length > 0) {
          lines.push('Pattern templates:');
          lines.push(
            ...library.patterns
              .slice(0, 12)
              .map((w) => `  ${w.name} (${w.pattern}) - ${w.description}`),
          );
        }
        if (library.saved.length > 0) {
          lines.push('Saved:');
          lines.push(
            ...library.saved
              .slice(0, 12)
              .map(
                (w) =>
                  `  ${w.name}${w.source ? ` (${w.source}${w.execution ? `, ${w.execution}` : ''})` : ''} - ${w.path}`,
              ),
          );
        }
        if (
          library.builtin.length === 0 &&
          library.patterns.length === 0 &&
          library.saved.length === 0
        ) {
          lines.push('  none found');
        }
        lines.push('Run with: /workflow <name> [args]');
        return { ok: true, message: compactSlashMessage(lines.join('\n')), echo: true };
      }

      if (invocation.kind === 'runs') {
        const options = parseWorkflowRunsOptions(invocation.rawArgs);
        if (options.error)
          return {
            ok: false,
            message: `Usage: /workflow runs [--all] [--limit N]\n${options.error}`,
          };
        const runs = workflowRunsForSession(ctx.sessionId);
        if (runs.length === 0) {
          return { ok: true, message: 'No workflow runs for this session.', echo: true };
        }
        const shown = options.all ? runs : runs.slice(0, options.limit);
        const overflow =
          !options.all && runs.length > shown.length
            ? [`... ${runs.length - shown.length} more; use /workflow runs --all`]
            : [];
        return {
          ok: true,
          message: compactSlashMessage(
            ['Workflow runs:', ...shown.map(formatWorkflowRun), ...overflow].join('\n'),
          ),
          echo: true,
        };
      }

      if (invocation.kind === 'show') {
        const selected = invocation.runId
          ? findWorkflowRun(ctx.sessionId, invocation.runId)
          : latestWorkflowRun(ctx.sessionId);
        if (!selected) return { ok: false, message: 'No workflow run found for this session.' };
        if (selected.sessionId !== ctx.sessionId) {
          return {
            ok: false,
            message: `workflow run does not belong to this session: ${selected.runId}`,
          };
        }
        return {
          ok: true,
          message: compactSlashMessage(workflowRunDetails(selected, invocation.full === true)),
          echo: true,
        };
      }

      if (
        invocation.kind === 'pause' ||
        invocation.kind === 'resume' ||
        invocation.kind === 'stop'
      ) {
        if (invocation.kind !== 'stop' && !invocation.runId) {
          return { ok: false, message: `Usage: /workflow ${invocation.kind} <runId>` };
        }
        const selected = invocation.runId
          ? findWorkflowRun(ctx.sessionId, invocation.runId)
          : latestWorkflowRun(ctx.sessionId, true);
        if (!selected) return { ok: false, message: 'No workflow run found for this session.' };
        if (selected.sessionId !== ctx.sessionId) {
          return {
            ok: false,
            message: `workflow run does not belong to this session: ${selected.runId}`,
          };
        }
        const ok =
          invocation.kind === 'stop'
            ? await workflowController.stop(selected.runId, 'stopped from /workflow')
            : invocation.kind === 'pause'
              ? await workflowController.pause(selected.runId)
              : await workflowController.resume(selected.runId);
        return ok
          ? { ok: true, message: `workflow ${invocation.kind}: ${selected.runId}`, echo: true }
          : { ok: false, message: `workflow ${invocation.kind} failed: ${selected.runId}` };
      }

      if (invocation.kind === 'delete') {
        if (!invocation.target)
          return {
            ok: false,
            message: 'Usage: /workflow delete [--force] [--run|--saved] <runId|savedName>',
          };
        if (invocation.scope === 'conflict')
          return { ok: false, message: 'choose only one delete scope: --run or --saved' };
        const library = await workflowController.listLibrary(session.projectRoot);
        const run =
          invocation.scope === 'saved'
            ? undefined
            : findWorkflowRun(ctx.sessionId, invocation.target);
        const saved =
          invocation.scope === 'run'
            ? undefined
            : findSavedWorkflow(library.saved, invocation.target);
        if (run && saved && invocation.scope === undefined) {
          return {
            ok: false,
            message: `ambiguous delete target: ${invocation.target}; use --run or --saved`,
          };
        }
        if (saved && !run) {
          const result = await workflowController.deleteSavedWorkflow(
            saved.name,
            session.projectRoot,
            saved.source,
          );
          return 'error' in result
            ? { ok: false, message: result.error }
            : {
                ok: true,
                message: formatSavedAction('Deleted saved workflow', result),
                echo: true,
              };
        }
        if (!run) return { ok: false, message: `workflow target not found: ${invocation.target}` };
        const ok = await workflowController.deleteRun(run.runId, invocation.force);
        return ok
          ? {
              ok: true,
              message: `Deleted workflow run ${run.runId}${invocation.force ? ' with --force' : ''}.`,
              echo: true,
            }
          : { ok: false, message: `workflow delete failed: ${run.runId}` };
      }

      if (invocation.kind === 'prune') {
        const options = parseWorkflowPruneOptions(invocation.rawArgs);
        if (options.error)
          return {
            ok: false,
            message: `Usage: /workflow prune --dry-run | --keep N | --older-than Nd\n${options.error}`,
          };
        if (!options.dryRun && options.keep === undefined && options.olderThanDays === undefined) {
          return {
            ok: false,
            message:
              'Usage: /workflow prune --dry-run | --keep N | --older-than Nd\nNo cleanup rule was provided.',
          };
        }
        const result = await workflowController.prune(options);
        const lines = [
          options.dryRun ? 'Workflow prune preview:' : 'Workflow prune:',
          `Candidates: ${result.candidates.length ? result.candidates.join(', ') : '(none)'}`,
          `Protected active runs: ${result.protectedRuns}`,
          options.dryRun ? 'Dry run only.' : `Deleted: ${result.deleted}`,
        ];
        return { ok: true, message: compactSlashMessage(lines.join('\n')), echo: true };
      }

      if (invocation.kind === 'save') {
        if (!invocation.runId || !invocation.name)
          return { ok: false, message: 'Usage: /workflow save <runId> <name>' };
        const run = findWorkflowRun(ctx.sessionId, invocation.runId);
        if (!run) return { ok: false, message: `workflow run not found: ${invocation.runId}` };
        const result = await workflowController.saveGeneratedWorkflowFromRun(
          run.runId,
          invocation.name,
          session.projectRoot,
        );
        return 'error' in result
          ? { ok: false, message: result.error }
          : { ok: true, message: formatSavedAction('Saved workflow', result), echo: true };
      }

      if (invocation.kind === 'rename') {
        if (!invocation.target || !invocation.newName)
          return { ok: false, message: 'Usage: /workflow rename <runId|savedName> <newName>' };
        const library = await workflowController.listLibrary(session.projectRoot);
        const run = findWorkflowRun(ctx.sessionId, invocation.target);
        const saved = findSavedWorkflow(library.saved, invocation.target);
        if (run && saved)
          return {
            ok: false,
            message: `ambiguous rename target: ${invocation.target}; use the concrete runId or saved workflow name`,
          };
        if (run) {
          const ok = await workflowController.rename(run.runId, invocation.newName);
          return ok
            ? {
                ok: true,
                message: `Renamed workflow run ${run.runId} to ${invocation.newName}.`,
                echo: true,
              }
            : { ok: false, message: `workflow rename failed: ${run.runId}` };
        }
        if (saved) {
          const result = await workflowController.renameSavedWorkflow(
            saved.name,
            invocation.newName,
            session.projectRoot,
            saved.source,
          );
          return 'error' in result
            ? { ok: false, message: result.error }
            : {
                ok: true,
                message: formatSavedAction('Renamed saved workflow', result),
                echo: true,
              };
        }
        return { ok: false, message: `workflow target not found: ${invocation.target}` };
      }

      if (invocation.kind === 'revise') {
        if (!invocation.target || !invocation.request) {
          return {
            ok: false,
            message: 'Usage: /workflow revise [--replace] <runId|savedName> <change request>',
          };
        }
        const library = await workflowController.listLibrary(session.projectRoot);
        const run = findWorkflowRun(ctx.sessionId, invocation.target);
        const saved = findSavedWorkflow(library.saved, invocation.target);
        if (run && saved)
          return {
            ok: false,
            message: `ambiguous revise target: ${invocation.target}; use the concrete runId or saved workflow name`,
          };
        if (invocation.replace && !saved)
          return { ok: false, message: 'revise --replace requires a saved workflow name target' };
        if (!run && !saved)
          return { ok: false, message: `workflow target not found: ${invocation.target}` };
        const result = await workflowController.reviseWorkflow({
          target: run?.runId ?? saved!.name,
          request: invocation.request,
          ...(invocation.replace ? { replace: true } : {}),
          session: launchSession,
          ...(saved ? { saved } : {}),
        });
        return 'error' in result
          ? { ok: false, message: result.error }
          : {
              ok: true,
              message: formatSavedAction(
                invocation.replace ? 'Replaced saved workflow' : 'Saved workflow revision',
                result,
              ),
              echo: true,
            };
      }

      if (invocation.kind === 'rerun') {
        if (!invocation.runId)
          return { ok: false, message: 'Usage: /workflow rerun <runId|savedName> [args]' };
        const library = await workflowController.listLibrary(session.projectRoot);
        const run = findWorkflowRun(ctx.sessionId, invocation.runId);
        const saved = findSavedWorkflow(library.saved, invocation.runId);
        if (run && saved)
          return {
            ok: false,
            message: `ambiguous rerun target: ${invocation.runId}; use /workflow ${saved.name} for saved or a concrete runId`,
          };
        const args = parseWorkflowArgs(invocation.rawArgs);
        const result = saved
          ? await workflowController.start({
              target: saved.path,
              source: 'saved',
              args,
              session: launchSession,
            })
          : run
            ? await workflowController.rerunGeneratedWorkflow(run.runId, args, launchSession)
            : { error: `workflow target not found: ${invocation.runId}` };
        return 'error' in result
          ? { ok: false, message: result.error }
          : {
              ok: true,
              message: `workflow started: ${saved?.name ?? run?.workflowName ?? invocation.runId} (${result.runId})`,
              echo: true,
            };
      }

      if (invocation.kind === 'create') {
        if (!invocation.request) return { ok: false, message: 'Usage: /workflow create <request>' };
        const result = await workflowController.createGeneratedWorkflow(
          invocation.request,
          launchSession,
        );
        return 'error' in result
          ? { ok: false, message: result.error }
          : { ok: true, message: `workflow started: generated (${result.runId})`, echo: true };
      }

      const library = await workflowController.listLibrary(session.projectRoot);
      const targetName = invocation.name;
      const targetLower = targetName.toLowerCase();
      const builtin = library.builtin.find(
        (w) => w.name === targetName || w.name.toLowerCase() === targetLower,
      );
      const saved = library.saved.find(
        (w) =>
          w.name === targetName || w.name.toLowerCase() === targetLower || w.path === targetName,
      );
      if (!builtin && !saved) {
        // SDK parity (FEATURE_246 / ADR-047): `/workflow <free text>` whose first
        // word is neither a subcommand nor a known builtin/saved name is shorthand
        // for `create` — author a workflow from the request rather than hard-failing
        // as "not found". (In an AMA session, authoring natural-language workflow
        // requests to the Worker via run_workflow is the richer scout-then-author
        // path; this host command uses the SDK generator, its sanctioned fallback.)
        const request = `${targetName} ${invocation.rawArgs}`.trim();
        const created = await workflowController.createGeneratedWorkflow(request, launchSession);
        return 'error' in created
          ? { ok: false, message: created.error }
          : { ok: true, message: `workflow started: generated (${created.runId})`, echo: true };
      }

      const result = await workflowController.start({
        target: builtin ? builtin.name : saved!.path,
        source: builtin ? 'builtin' : 'saved',
        args: parseWorkflowArgs(invocation.rawArgs),
        session: launchSession,
      });
      if ('error' in result) return { ok: false, message: result.error };
      return {
        ok: true,
        message: `workflow started: ${builtin?.name ?? saved!.name} (${result.runId})`,
        echo: true,
      };
    },
  },

  {
    name: 'new',
    description: 'Start a new session in the current project (current chat remains in Recents)',
    source: 'builtin',
    handler: async (ctx) => {
      // 实际"新建 session"动作在 renderer 端做（需要 provider/reasoningMode 等当前
      // pending 值）。slash 这里只 echo 一个 system_notice，renderer 监听 message 含
      // `__action__:new-session` 触发 LeftSidebar.handleNewSession 等价逻辑。
      if (!kodaxHost.get(ctx.sessionId)) {
        return { ok: false, message: `session not found: ${ctx.sessionId}` };
      }
      return {
        ok: true,
        message: '__action__:new-session',
        echo: false,
      };
    },
  },

  {
    name: 'copy',
    description: 'Copy the last assistant message to clipboard (renderer handles)',
    source: 'builtin',
    handler: async (ctx) => {
      if (!kodaxHost.get(ctx.sessionId)) {
        return { ok: false, message: `session not found: ${ctx.sessionId}` };
      }
      // renderer 端 SlashCommandPopover/onSlashPick 监听到 __action__:copy-last 时执行 clipboard 拷贝
      return { ok: true, message: '__action__:copy-last', echo: false };
    },
  },

  {
    name: 'cost',
    description: 'Show estimated token usage / cost for current session',
    source: 'builtin',
    handler: async (ctx) => {
      const s = kodaxHost.get(ctx.sessionId);
      if (!s) return { ok: false, message: `session not found: ${ctx.sessionId}` };
      // 本地汇总 iter / token 数据走 renderer (它有 events buffer)；main 端
      // 没有 token 累加器，发个 action 让 renderer 自己渲染。
      return { ok: true, message: '__action__:show-cost', echo: false };
    },
  },

  {
    name: 'compact',
    description: 'Compact the current persisted session now',
    argsHint: '[instructions]',
    source: 'builtin',
    handler: async (ctx) => {
      const s = kodaxHost.get(ctx.sessionId);
      if (!s) return { ok: false, message: `session not found: ${ctx.sessionId}` };
      const instructions = ctx.args.join(' ').trim();
      const result = await kodaxHost.requestCompact(ctx.sessionId, instructions);
      if (!result.ok) {
        return { ok: false, message: result.reason ?? 'Compaction failed.' };
      }
      if (!result.compacted) {
        return {
          ok: true,
          message: `Compaction skipped${result.reason ? `: ${result.reason}` : '.'}`,
          echo: true,
        };
      }
      const tokensBefore = result.tokensBefore ?? 0;
      const tokensAfter = result.tokensAfter ?? 0;
      const reductionPercent =
        tokensBefore > 0 ? Math.max(0, ((tokensBefore - tokensAfter) / tokensBefore) * 100) : 0;
      return {
        ok: true,
        message: `Compacted context: ${tokensBefore.toLocaleString('en-US')} → ${tokensAfter.toLocaleString('en-US')} tokens (${reductionPercent.toFixed(1)}% reduction).`,
        echo: true,
      };
    },
  },

  {
    name: 'tree',
    description: 'Show current session fork lineage tree',
    argsHint: '[entry-id|label] | label <entry-id|label> <name> | unlabel <entry-id|label>',
    source: 'builtin',
    handler: async (ctx) => {
      if (!kodaxHost.get(ctx.sessionId)) {
        return { ok: false, message: `session not found: ${ctx.sessionId}` };
      }
      return { ok: true, message: '__action__:show-tree', echo: false };
    },
  },

  {
    name: 'history',
    aliases: ['hist'],
    description: 'List user messages in current session',
    source: 'builtin',
    handler: async (ctx) => {
      if (!kodaxHost.get(ctx.sessionId)) {
        return { ok: false, message: `session not found: ${ctx.sessionId}` };
      }
      return { ok: true, message: '__action__:show-history', echo: false };
    },
  },

  {
    name: 'help',
    aliases: ['h', '?'],
    description: 'List all available slash commands',
    argsHint: '[command]',
    source: 'builtin',
    handler: async (ctx) => {
      const cmds = listSlashCommands();
      const topic = ctx.args[0]?.toLowerCase();
      if (topic) {
        const cmd = cmds.find((c) => c.name === topic || c.aliases?.includes(topic));
        if (!cmd) {
          return {
            ok: false,
            message: `Unknown help topic: ${topic}\nUse /help to list available commands.`,
          };
        }
        return {
          ok: true,
          message: formatSlashCommandUsage(cmd),
          echo: true,
        };
      }
      // 把命令列表当 message 文本返回——renderer 渲染时按行 split 显示
      const lines = cmds.map(formatSlashCommandUsage);
      return {
        ok: true,
        message: compactSlashMessage(`Available commands (${cmds.length}):\n${lines.join('\n')}`),
        echo: true,
      };
    },
  },

  {
    name: 'repointel',
    aliases: ['ri'],
    description: 'Show recent KodaX repo-intelligence trace events',
    argsHint: '[status|mode|trace|warm|endpoint|bin]',
    source: 'builtin',
    handler: async (ctx) => {
      const session = kodaxHost.get(ctx.sessionId);
      if (!session) {
        return { ok: false, message: `session not found: ${ctx.sessionId}` };
      }
      // renderer 端 dispatchSlashAction 读 events buffer 抽 repointel_trace
      const detailMode = ctx.args[0]?.toLowerCase();
      if (!detailMode || detailMode === 'status' || detailMode === 'doctor') {
        return { ok: true, message: '__action__:show-repointel-status', echo: false };
      }
      if (detailMode === 'trace') {
        if (ctx.args[1]) {
          return {
            ok: true,
            message:
              '[repointel] trace is read-only in Space v0.1.22; use /repointel trace to show recent session trace events.',
            echo: true,
          };
        }
        return { ok: true, message: '__action__:show-repointel-trace', echo: false };
      }
      if (detailMode === 'warm') {
        // Repo-intelligence is a licensed capability — don't prewarm the built-in engine
        // without an active license (matches the run gate + chip lock). Fail-closed via
        // repo-intel-gate.ts.
        if (!(await isRepoIntelEntitled())) {
          return {
            ok: true,
            message:
              '[repointel] repo-intelligence is a licensed capability. Activate a license (Settings → License) to enable prewarm and repo-aware assistance.',
            echo: true,
          };
        }
        const sdk = await loadSpaceSdkCoding();
        sdk.prewarmRepoIntelligenceCaches({
          gitRoot: session.projectRoot,
          executionCwd: session.projectRoot,
        });
        return {
          ok: true,
          message:
            '[repointel] repo-intelligence prewarm started for this project. It is best-effort; use /repointel status or /repointel trace to inspect results.',
          echo: true,
        };
      }
      if (detailMode === 'mode' || detailMode === 'endpoint' || detailMode === 'bin') {
        return {
          ok: true,
          message: `[repointel] ${detailMode} is read-only in Space v0.1.22; manage it through KodaX config until a stable SDK setter exists.`,
          echo: true,
        };
      }
      return { ok: true, message: '__action__:show-repointel-status', echo: false };
    },
  },

  {
    name: 'doctor',
    description: 'Diagnose providers (key configured + HTTP probe + context window)',
    source: 'builtin',
    handler: async () => {
      // renderer 端汇总 provider.list + provider.test 结果做诊断报告
      return { ok: true, message: '__action__:show-doctor', echo: false };
    },
  },

  {
    name: 'status',
    aliases: ['info', 'ctx'],
    description: 'Show current session status',
    argsHint: '[workspace|worktree|runtime|peers]',
    source: 'builtin',
    handler: async (ctx) => {
      const detailMode = ctx.args[0]?.toLowerCase();
      if (detailMode === 'peers') {
        return shellAction('show-status');
      }
      const session = kodaxHost.get(ctx.sessionId);
      if (!session) return { ok: false, message: `session not found: ${ctx.sessionId}` };
      const lines = [
        'Session Status:',
        `  Provider:    ${session.provider}${session.model ? ` / ${session.model}` : ''}`,
        `  Permission:  ${session.permissionMode}`,
        `  Auto engine: ${session.autoModeEngine}`,
        `  Reasoning:   ${session.reasoningMode}`,
        `  Thinking:    ${session.thinking === undefined ? 'default' : session.thinking ? 'on' : 'off'}`,
        `  Agent Mode:  ${session.agentMode.toUpperCase()}`,
        `  Session ID:  ${session.sessionId}`,
        `  Surface:     ${session.surface}`,
        `  Project:     ${session.projectRoot}`,
        `  Created:     ${new Date(session.createdAt).toISOString()}`,
        `  Last Active: ${new Date(session.lastActivityAt).toISOString()}`,
      ];
      if (session.parentSessionId) lines.push(`  Parent:      ${session.parentSessionId}`);
      if (session.forkPointTurnIdx !== undefined)
        lines.push(`  Fork point:  ${session.forkPointTurnIdx}`);
      if (detailMode === 'workspace' || detailMode === 'worktree' || detailMode === 'runtime') {
        lines.push('  Runtime:     KodaX Space desktop host');
      }
      lines.push('  Peers:       use /status peers');
      return { ok: true, message: lines.join('\n'), echo: true };
      // renderer 调 session.listRunning + 输出格式化的 peer 列表
    },
  },

  {
    name: 'review',
    description: 'Insert a review template + current uncommitted diff for LLM review',
    argsHint: '[--workflow] [base | sha <hash>]',
    source: 'builtin',
    handler: async () => {
      // renderer 端拉 git diff (project.gitDiff IPC) → 拼模板 → 塞入输入框
      // SDK 的 runLlmReview 是给 self-modify handler 安全审查用的 (FEATURE_088 capability whitelist),
      // 对 Space 用户场景不适用; 这里实现 user-facing /review = "review my changes" 助手。
      return { ok: true, message: '__action__:insert-review-template', echo: false };
    },
  },

  {
    name: 'auto',
    aliases: ['a'],
    description: 'Switch the current session to auto permission mode',
    source: 'builtin',
    handler: async (ctx) => {
      const session = kodaxHost.get(ctx.sessionId);
      if (!session) return { ok: false, message: `session not found: ${ctx.sessionId}` };
      return commitRuntimeSlashMutation(
        ctx.sessionId,
        () => kodaxHost.setPermissionMode(ctx.sessionId, 'auto'),
        `mode -> auto; auto-engine -> ${session.autoModeEngine}`,
      );
    },
  },

  {
    name: 'auto-denials',
    description: 'Show auto-mode classifier denial thresholds and current engine',
    source: 'builtin',
    handler: async (ctx) => {
      const session = kodaxHost.get(ctx.sessionId);
      if (!session) return { ok: false, message: `session not found: ${ctx.sessionId}` };
      if (session.permissionMode !== 'auto') {
        return {
          ok: true,
          message: `[auto-denials] not in auto mode. Current mode: ${session.permissionMode}. Use /mode auto first.`,
          echo: true,
        };
      }
      const usesRuntime = usesRuntimeSession(ctx.sessionId);
      const runtimeSnapshot = usesRuntime ? runtimeHostAdapter.snapshot() : undefined;
      const runtimeSettings = usesRuntime
        ? await runtimeHostAdapter
            .getSessionSettingsVersioned(ctx.sessionId)
            .then((snapshot) => snapshot.value)
            .catch(() => undefined)
        : undefined;
      const timeoutMs = runtimeSettings?.autoModeTimeoutMs;
      const classifierModel =
        runtimeSettings?.autoModeClassifierModel ??
        runtimeSettings?.model ??
        session.model ??
        '(provider default)';
      return {
        ok: true,
        message: [
          '[auto-mode classifier stats]',
          `  engine: ${session.autoModeEngine}`,
          `  host: ${runtimeSnapshot ? `Runtime ${runtimeSnapshot.identity?.version ?? runtimeSnapshot.state}` : 'embedded'}`,
          `  classifier model: ${classifierModel}`,
          `  timeout: ${timeoutMs !== undefined ? `${timeoutMs}ms (configured)` : 'SDK default (45s first / 90s retry)'}`,
          '  thresholds:',
          '    consecutive blocks: 3',
          '    cumulative blocks: 20',
          '    circuit breaker: 5 errors / 10 min',
          '  counters: not exposed by the Space host yet',
        ].join('\n'),
        echo: true,
      };
    },
  },

  {
    name: 'fallback',
    description: 'Configure the child-task provider fallback chain',
    argsHint: '[status | <p1,p2,...> | off]',
    source: 'builtin',
    handler: async (ctx) => {
      const usesRuntime = usesRuntimeSession(ctx.sessionId);
      const configured = usesRuntime
        ? runtimeConfigRecord(await runtimeHostAdapter.readRuntimeConfig()).fallbackProviders
        : undefined;
      const currentSource = usesRuntime
        ? Array.isArray(configured)
          ? configured
          : []
        : (process.env.KODAX_FALLBACK_PROVIDERS ?? '');
      const current = fallbackChain(currentSource);
      const fallbackNotes = [
        ...(usesRuntime ? [RUNTIME_EFFECTIVE_CONFIG_NOTE] : []),
        RUNTIME_FALLBACK_CREDENTIAL_NOTE,
      ];
      const sub = ctx.args[0]?.toLowerCase();
      if (!sub || sub === 'status') {
        const status =
          current.length === 0
            ? 'Child-task provider fallback: off (no chain configured)'
            : `Child-task provider fallback: on\n  Order: ${current.join(' -> ')}`;
        return {
          ok: true,
          message: [status, ...fallbackNotes].join('\n'),
          echo: true,
        };
      }
      if (sub === 'off' || sub === 'clear' || sub === 'none') {
        if (usesRuntime) await runtimeHostAdapter.patchRuntimeConfig({ fallbackProviders: [] });
        else delete process.env.KODAX_FALLBACK_PROVIDERS;
        return {
          ok: true,
          message: usesRuntime
            ? `Child-task provider fallback disabled in persisted Coder daemon config.\n${RUNTIME_EFFECTIVE_CONFIG_NOTE}`
            : 'Child-task provider fallback disabled for this Space process.',
          echo: true,
        };
      }
      const chain = ctx.args
        .join(',')
        .split(',')
        .map((entry) => entry.trim())
        .filter(Boolean);
      if (chain.length === 0) {
        return { ok: false, message: 'Usage: /fallback ark-coding,kimi-code (or /fallback off)' };
      }
      if (usesRuntime) await runtimeHostAdapter.patchRuntimeConfig({ fallbackProviders: chain });
      else process.env.KODAX_FALLBACK_PROVIDERS = chain.join(',');
      return {
        ok: true,
        message: [
          `Child-task fallback order: ${chain.join(' -> ')}\n${usesRuntime ? 'Saved to persisted Coder daemon config.' : 'Applied to the current Space process.'}`,
          ...fallbackNotes,
        ].join('\n'),
        echo: true,
      };
    },
  },

  {
    name: 'verifier-log',
    description: 'Show or toggle Sidecar Verifier one-line logs',
    argsHint: '[on|off]',
    source: 'builtin',
    handler: async (ctx) => {
      const usesRuntime = usesRuntimeSession(ctx.sessionId);
      const runtimeConfig = usesRuntime
        ? runtimeConfigRecord(await runtimeHostAdapter.readRuntimeConfig())
        : undefined;
      const parsed = parseToggleValue(ctx.args[0]);
      if (!ctx.args[0]) {
        const enabled = usesRuntime
          ? runtimeConfig?.verifierLog === true
          : process.env.KODAX_VERIFIER_LOG === '1';
        return {
          ok: true,
          message: usesRuntime
            ? `Sidecar Verifier log config: ${enabled ? 'on' : 'off'}\n${RUNTIME_EFFECTIVE_CONFIG_NOTE}\nUsage: /verifier-log [on|off]`
            : `Sidecar Verifier log: ${enabled ? 'on' : 'off'}\nUsage: /verifier-log [on|off]`,
          echo: true,
        };
      }
      if (!parsed) return { ok: false, message: 'Usage: /verifier-log [on|off]' };
      if (usesRuntime) {
        await runtimeHostAdapter.patchRuntimeConfig({ verifierLog: parsed === 'on' });
      } else if (parsed === 'on') process.env.KODAX_VERIFIER_LOG = '1';
      else delete process.env.KODAX_VERIFIER_LOG;
      return {
        ok: true,
        message: usesRuntime
          ? `Sidecar Verifier log config saved: ${parsed}.\n${RUNTIME_EFFECTIVE_CONFIG_NOTE}`
          : `Sidecar Verifier log: ${parsed} for this Space process`,
        echo: true,
      };
    },
  },

  {
    name: 'stall-log',
    description: 'Show or toggle Stall Sidecar one-line logs',
    argsHint: '[on|off]',
    source: 'builtin',
    handler: async (ctx) => {
      const usesRuntime = usesRuntimeSession(ctx.sessionId);
      const runtimeConfig = usesRuntime
        ? runtimeConfigRecord(await runtimeHostAdapter.readRuntimeConfig())
        : undefined;
      const parsed = parseToggleValue(ctx.args[0]);
      if (!ctx.args[0]) {
        const enabled = usesRuntime
          ? runtimeConfig?.stallLog === true
          : process.env.KODAX_STALL_LOG === '1';
        return {
          ok: true,
          message: usesRuntime
            ? `Stall Sidecar log config: ${enabled ? 'on' : 'off'}\n${RUNTIME_EFFECTIVE_CONFIG_NOTE}\nUsage: /stall-log [on|off]`
            : `Stall Sidecar log: ${enabled ? 'on' : 'off'}\nUsage: /stall-log [on|off]`,
          echo: true,
        };
      }
      if (!parsed) return { ok: false, message: 'Usage: /stall-log [on|off]' };
      if (usesRuntime) {
        await runtimeHostAdapter.patchRuntimeConfig({ stallLog: parsed === 'on' });
      } else if (parsed === 'on') process.env.KODAX_STALL_LOG = '1';
      else delete process.env.KODAX_STALL_LOG;
      return {
        ok: true,
        message: usesRuntime
          ? `Stall Sidecar log config saved: ${parsed}.\n${RUNTIME_EFFECTIVE_CONFIG_NOTE}`
          : `Stall Sidecar log: ${parsed} for this Space process`,
        echo: true,
      };
    },
  },

  {
    name: 'goal',
    description: 'Track a lightweight active goal for the current session',
    argsHint: '[status|pause|resume|complete|blocked|clear|help|<objective> [--tokens N]]',
    source: 'builtin',
    handler: async (ctx) => {
      if (!kodaxHost.get(ctx.sessionId)) {
        return { ok: false, message: `session not found: ${ctx.sessionId}` };
      }
      const sub = ctx.args[0]?.toLowerCase();
      const current = goalBySession.get(ctx.sessionId);
      if (!sub || sub === 'status') {
        return { ok: true, message: formatGoalStatus(current), echo: true };
      }
      if (sub === 'help' || sub === '--help' || sub === '-h') {
        return { ok: true, message: goalHelp(), echo: true };
      }
      if (sub === 'clear') {
        goalBySession.delete(ctx.sessionId);
        return { ok: true, message: 'Goal cleared.', echo: true };
      }
      if (sub === 'pause' || sub === 'resume' || sub === 'complete' || sub === 'blocked') {
        if (!current)
          return { ok: false, message: 'No goal set. Use /goal <objective> [--tokens N] first.' };
        const status: GoalStatus =
          sub === 'resume'
            ? 'active'
            : sub === 'pause'
              ? 'paused'
              : sub === 'complete'
                ? 'complete'
                : 'blocked';
        goalBySession.set(ctx.sessionId, { ...current, status, updatedAt: Date.now() });
        return {
          ok: true,
          message: formatGoalStatus(goalBySession.get(ctx.sessionId)),
          echo: true,
        };
      }
      const parsed = parseGoalCreateArgs(ctx.args);
      if ('error' in parsed) return { ok: false, message: `${goalHelp()}\n${parsed.error}` };
      const now = Date.now();
      goalBySession.set(ctx.sessionId, {
        objective: parsed.objective,
        tokenBudget: parsed.tokenBudget,
        tokensUsed: current?.tokensUsed ?? 0,
        status: 'active',
        createdAt: now,
        updatedAt: now,
      });
      return { ok: true, message: formatGoalStatus(goalBySession.get(ctx.sessionId)), echo: true };
    },
  },

  {
    name: 'learn',
    description: 'Review SDK learning proposals for this project',
    argsHint:
      'pending|ledger|diff <id>|review|trust|disable|rollback <id>|approve <id> [--ack-impact]|reject <id> [reason]',
    source: 'builtin',
    handler: handleLearningCommand,
  },
  {
    name: 'exit',
    aliases: ['quit', 'q', 'bye'],
    description: 'Close the KodaX Space window',
    source: 'builtin',
    handler: async () => shellAction('exit-app'),
  },

  {
    name: 'paste',
    description: 'Inspect pasted text stored by the composer',
    argsHint: '[list|show <id>|help]',
    source: 'builtin',
    handler: async (ctx) => {
      if (!kodaxHost.get(ctx.sessionId)) {
        return { ok: false, message: `session not found: ${ctx.sessionId}` };
      }
      const sub = ctx.args[0]?.toLowerCase();
      if (!sub || sub === 'help') {
        return {
          ok: true,
          message:
            'Usage: /paste list | /paste show <id>\nKodaX Space currently sends pasted text directly from the composer; no paste registry is exposed yet.',
          echo: true,
        };
      }
      if (sub === 'list') {
        return {
          ok: true,
          message:
            '[paste] No paste registry is active in KodaX Space yet. Text and images pasted in the composer are sent inline.',
          echo: true,
        };
      }
      if (sub === 'show') {
        return { ok: false, message: 'KodaX Space does not expose saved paste ids yet.' };
      }
      return { ok: false, message: 'Usage: /paste list | /paste show <id>' };
    },
  },

  {
    name: 'reload',
    description: 'Reload runtime context shown by Space panels',
    source: 'builtin',
    handler: async (ctx) => {
      if (!kodaxHost.get(ctx.sessionId)) {
        return { ok: false, message: `session not found: ${ctx.sessionId}` };
      }
      return shellAction('reload-context');
    },
  },

  {
    name: 'extensions',
    aliases: ['ext'],
    description: 'Show configured MCP/plugin extensions',
    argsHint: '[sdk [load]|status]',
    source: 'builtin',
    handler: async (ctx) => {
      if (!kodaxHost.get(ctx.sessionId)) {
        return { ok: false, message: `session not found: ${ctx.sessionId}` };
      }
      const sub = ctx.args[0]?.toLowerCase();
      if (sub === 'sdk' || sub === 'discover' || sub === 'discovery')
        return handleSdkExtensionsCommand(ctx);
      if (sub && sub !== 'status' && sub !== 'refresh') {
        return { ok: false, message: 'Usage: /extensions [status|refresh|sdk [load]]' };
      }
      return shellAction('show-extensions');
    },
  },

  {
    name: 'mcp',
    description: 'Show MCP server runtime status',
    argsHint: '[status|refresh]',
    source: 'builtin',
    handler: async (ctx) => {
      if (!kodaxHost.get(ctx.sessionId)) {
        return { ok: false, message: `session not found: ${ctx.sessionId}` };
      }
      const sub = ctx.args[0]?.toLowerCase();
      if (sub && sub !== 'status' && sub !== 'refresh') {
        return { ok: false, message: 'Usage: /mcp [status|refresh]' };
      }
      return shellAction('show-mcp');
    },
  },

  {
    name: 'recover',
    aliases: ['recovery'],
    description: 'Preview SDK session recovery for the current transcript',
    argsHint: 'seed [reason]|prompt [reason]|candidate <count> <error>',
    source: 'builtin',
    handler: handleRecoveryCommand,
  },

  {
    name: 'save',
    description: 'Save current session',
    source: 'builtin',
    handler: async (ctx) => {
      if (!kodaxHost.get(ctx.sessionId)) {
        return { ok: false, message: `session not found: ${ctx.sessionId}` };
      }
      return {
        ok: true,
        message:
          'Session is auto-saved by KodaX Space after each message. Current in-memory state is active.',
        echo: true,
      };
    },
  },

  {
    name: 'load',
    aliases: ['resume'],
    description: 'Load a session by id, or list sessions when no id is provided',
    argsHint: '[session-id]',
    source: 'builtin',
    handler: async (ctx) =>
      ctx.args[0] ? shellAction('load-session') : shellAction('list-sessions'),
  },

  {
    name: 'sessions',
    aliases: ['ls', 'list'],
    description: 'List recent sessions',
    source: 'builtin',
    handler: async () => shellAction('list-sessions'),
  },

  {
    name: 'delete',
    aliases: ['rm', 'del'],
    description: 'Delete a saved session',
    argsHint: '<session-id>',
    source: 'builtin',
    handler: async (ctx) => {
      const target = ctx.args[0];
      if (!target) return shellAction('list-sessions');
      if (target.toLowerCase() === 'all') {
        return {
          ok: false,
          message:
            '/delete all is intentionally not available from KodaX Space slash commands. Delete sessions individually.',
        };
      }
      return shellAction('delete-session');
    },
  },

  {
    name: 'fork',
    description: 'Fork the current branch into a new session',
    argsHint: '[entry-id|label]',
    source: 'builtin',
    handler: async (ctx) => {
      if (!kodaxHost.get(ctx.sessionId)) {
        return { ok: false, message: `session not found: ${ctx.sessionId}` };
      }
      return shellAction('fork-session');
    },
  },

  {
    name: 'rewind',
    description: 'Rewind the current session to a previous turn',
    argsHint: '[entry-id|label]',
    source: 'builtin',
    handler: async (ctx) => {
      if (!kodaxHost.get(ctx.sessionId)) {
        return { ok: false, message: `session not found: ${ctx.sessionId}` };
      }
      return shellAction('rewind-session');
    },
  },

  {
    name: 'skills',
    description: 'List available skills',
    argsHint: '[pending|ledger]',
    source: 'builtin',
    handler: async (ctx) => {
      if (!kodaxHost.get(ctx.sessionId)) {
        return { ok: false, message: `session not found: ${ctx.sessionId}` };
      }
      if (ctx.args[0]?.toLowerCase() === 'pending') return handleLearningPending(ctx, 'skill');
      if (ctx.args[0]?.toLowerCase() === 'ledger') return handleLearningLedger(ctx);
      return shellAction('list-skills');
    },
  },

  {
    name: 'skill',
    description: 'List skills; invoke a skill with /skill:<name> [args]',
    argsHint: '[pending|ledger|:name] [args]',
    source: 'builtin',
    handler: async (ctx) => {
      if (!kodaxHost.get(ctx.sessionId)) {
        return { ok: false, message: `session not found: ${ctx.sessionId}` };
      }
      if (ctx.args[0]?.toLowerCase() === 'pending') return handleLearningPending(ctx, 'skill');
      if (ctx.args[0]?.toLowerCase() === 'ledger') return handleLearningLedger(ctx);
      return shellAction('list-skills');
    },
  },

  {
    name: 'memory',
    description: 'Review governed memory proposals and refs',
    argsHint: '[inbox|list|show|approve|reject|curate|open|help]',
    source: 'builtin',
    handler: handleMemoryCommand,
  },
];
