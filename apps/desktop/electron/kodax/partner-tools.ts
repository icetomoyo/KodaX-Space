// F047 — Partner (non-bash-subset) 工具策略。
import type { PermissionMode, Surface } from '@kodax-space/space-ipc-schema';
import type {
  KodaXToolVisibilityMeta,
  KodaXToolVisibilityPolicy,
  ToolSideEffect,
} from '@kodax-ai/kodax/coding';

export type PartnerToolSideEffect = ToolSideEffect;

export type PartnerToolScope =
  | 'artifact'
  | 'knowledge-base'
  | 'source'
  | 'workspace-delivery'
  | 'workspace-file-proposal'
  | 'space-control'
  | 'network-research'
  | 'readonly';

export interface PartnerRegisteredToolMetadata {
  readonly sideEffect?: string;
  readonly planModeAllowed?: boolean;
}

export type PartnerToolVisibilityMeta = KodaXToolVisibilityMeta;
export type PartnerToolVisibilityPolicy = KodaXToolVisibilityPolicy;

export interface PartnerSpaceToolPolicy {
  readonly name: string;
  readonly scope: PartnerToolScope;
  readonly sideEffect: PartnerToolSideEffect;
  readonly description: string;
}

//
// Partner is a gated working surface, not a raw Coder session.
//
// It allows read/search/code-intelligence tools, web research, and explicitly
// registered Space-owned tools such as artifacts, KB, sources, delivery
// outputs, reviewed proposals, and checkpointed workspace writes. It does not
// inherit arbitrary SDK edit/write/bash/subagent tools.
//
// SDK tool capability metadata remains the base line: read-tier tools flow
// through, web tools are explicitly allowed for research, and stateful Partner
// tools must register a PartnerSpaceToolPolicy. Unknown mutation/shell/subagent
// tools fail closed unless a Partner policy opts them into a bounded scope.
/** Partner 显式允许的网络研究工具（tier 非 'read'，但 Partner 研究需要）。 */
export const PARTNER_NETWORK_ALLOW: ReadonlySet<string> = new Set(['web_fetch', 'web_search']);

/**
 * Partner 显式允许的 Space 自有工具（F058）。`create_artifact` 是 Space 注册的
 * in-process 工具（sideEffect='mutates-state'，写 Space 自有 artifact store，不碰项目 FS），
 * resolveToolCapability 对它 fail-closed 到 'subagent' → 不显式放行就会被拦。Partner 产出
 * 报告/文档/图表正是核心场景,故放行。
 */
export const PARTNER_SPACE_TOOL_ALLOW: ReadonlySet<string> = new Set([
  'create_artifact',
  'create_office_artifact',
]);

/**
 * Space-side fallback for Coder plan mode. SDK metadata is still the primary source
 * of truth, but some read-only research tools expose shell/network capabilities.
 */
export const PLAN_MODE_READONLY_TOOL_ALLOW: ReadonlySet<string> = new Set([
  'read',
  'read_file',
  'read_pdf',
  'glob',
  'grep',
  'ripgrep',
  'search',
  'code_search',
  'semantic_lookup',
  'ls',
  'list',
  'list_directory',
  'list_files',
  'view',
  'repo_overview',
  'module_context',
  'symbol_context',
  'process_context',
  'impact_estimate',
  'changed_scope',
  'changed_diff',
  'changed_diff_bundle',
  'kodax_manual',
  'mcp_describe',
  'mcp_search',
  'mcp_read_resource',
  'mcp_get_prompt',
  'web_fetch',
  'web_search',
]);

const partnerSpaceToolPolicies = new Map<string, PartnerSpaceToolPolicy>();

export function registerPartnerSpaceToolPolicy(policy: PartnerSpaceToolPolicy): void {
  partnerSpaceToolPolicies.set(policy.name, policy);
}

export function getPartnerSpaceToolPolicy(name: string): PartnerSpaceToolPolicy | undefined {
  return partnerSpaceToolPolicies.get(name);
}

export function listPartnerSpaceToolPolicies(): PartnerSpaceToolPolicy[] {
  return [...partnerSpaceToolPolicies.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** Test hook: clears runtime policy registrations without changing legacy allow sets. */
export function _clearPartnerSpaceToolPoliciesForTesting(): void {
  partnerSpaceToolPolicies.clear();
}

function partnerPolicyAllows(toolName: string): boolean {
  const policy = getPartnerSpaceToolPolicy(toolName);
  if (!policy) return false;
  if (policy.sideEffect === 'readonly' || policy.sideEffect === 'reads-network') return true;
  if (
    policy.scope === 'artifact' ||
    policy.scope === 'knowledge-base' ||
    policy.scope === 'space-control' ||
    policy.scope === 'workspace-delivery' ||
    policy.scope === 'workspace-file-proposal'
  ) {
    return policy.sideEffect === 'mutates-state';
  }
  if (policy.scope === 'network-research') {
    return policy.sideEffect === 'mutates-network';
  }
  return false;
}

/**
 * Partner surface 是否允许调用某工具。
 *
 * @param toolName  SDK 工具名（planModeBlockCheck 收到的同款名）
 * @param capability  SDK `resolveToolCapability(toolName)` 的结果（caller 注入，便于纯单测）
 */
export function isPartnerToolAllowed(
  toolName: string,
  capability: string,
  registeredTool?: PartnerRegisteredToolMetadata,
): boolean {
  if (PARTNER_NETWORK_ALLOW.has(toolName)) return true;
  if (PARTNER_SPACE_TOOL_ALLOW.has(toolName)) return true;
  if (partnerPolicyAllows(toolName)) return true;
  if (registeredTool?.sideEffect === 'readonly' || registeredTool?.sideEffect === 'reads-network') {
    return true;
  }
  return capability === 'read';
}

function isRegisteredReadOnlyTool(registeredTool?: PartnerRegisteredToolMetadata): boolean {
  return (
    registeredTool?.sideEffect === 'readonly' || registeredTool?.sideEffect === 'reads-network'
  );
}

function isPlanModeReadOnlyTool(
  toolName: string,
  capability: string,
  registeredTool?: PartnerRegisteredToolMetadata,
): boolean {
  if (PLAN_MODE_READONLY_TOOL_ALLOW.has(toolName.toLowerCase())) return true;
  if (isRegisteredReadOnlyTool(registeredTool)) return true;
  return capability === 'read';
}

function capabilityFromVisibilityMeta(meta: PartnerToolVisibilityMeta): string {
  if (meta.sideEffect === 'readonly') return 'read';
  if (meta.sideEffect === 'reads-network') return 'read';
  return 'subagent';
}

export const partnerToolVisibilityPolicy: PartnerToolVisibilityPolicy = (tool) =>
  isPartnerToolAllowed(tool.name, capabilityFromVisibilityMeta(tool), tool);

/**
 * 统一的工具拦截决策——real-session 的 `context.planModeBlockCheck` 闭包调它。返回 block
 * reason（喂回 LLM 让它别再调），null = 放行。把 Partner 白名单 + plan-mode 两种限制收敛到
 * 一处纯函数，便于单测两者交互。
 *
 * **关键（review HIGH）**：Partner surface 下，Partner 白名单**就是最严约束**（只 read+web），
 * plan-mode **不再二次裁剪**——否则 plan mode 会把 web_fetch/web_search 也拦掉（它们 plan-mode
 * 不允许），违背 Partner"web 研究恒可用"的设计。故 Partner-allowed 直接 return null。
 *
 * SDK 查询用 thunk 注入，保持惰性（capability 仅 Partner 求值；planModeAllowed 仅 Coder+plan
 * 求值）+ 可单测（注入 fake）。
 */
export function computeToolBlockReason(args: {
  readonly surface: Surface;
  readonly permissionMode: PermissionMode;
  readonly tool: string;
  readonly resolveCapability: () => string;
  readonly resolveRegisteredTool?: () => PartnerRegisteredToolMetadata | undefined;
  readonly isPlanModeAllowed: () => boolean;
}): string | null {
  const {
    surface,
    permissionMode,
    tool,
    resolveCapability,
    resolveRegisteredTool,
    isPlanModeAllowed,
  } = args;
  if (surface === 'partner') {
    if (!isPartnerToolAllowed(tool, resolveCapability(), resolveRegisteredTool?.())) {
      return `[partner] tool '${tool}' is not available in the Partner working workspace (read / search / web / delivery / artifact / checkpointed workspace tools only). Describe the outcome instead of running it.`;
    }
    return null; // Partner 白名单已是最严约束；plan-mode 不再二次裁剪（否则误拦 web 研究）
  }
  if (permissionMode !== 'plan') return null;
  // SDK isToolPlanModeAllowed: readonly / planModeAllowed:true → allowed; 其他 → blocked
  // Fail-closed: 未知 tool 返回 false（一律 block）
  if (isPlanModeAllowed()) return null;
  if (isPlanModeReadOnlyTool(tool, resolveCapability(), resolveRegisteredTool?.())) return null;
  return `[plan] tool '${tool}' is blocked. Plan mode allows only read/search tools — describe the plan instead of executing it.`;
}
