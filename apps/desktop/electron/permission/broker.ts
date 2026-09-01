// PermissionBroker — main 端的 ask-and-wait 协调器 — FEATURE_007
//
// 职责：
//   1) KodaX runtime 触发 permission callback → broker.request({...}) → 返回 Promise<decision>
//   2) Broker 生成 reqId、推 permission.request 给 renderer、把 (reqId → { resolve, sessionId })
//      记入 pending Map
//   3) Renderer 走 invoke 'permission.answer' → handler 调 broker.resolve(reqId, decision)
//      → 等待的 Promise resolve
//   4) Session 取消 / 删除 / 进程退出时调 broker.cancelSession(sid) → 自动 deny 所有该 session
//      pending + 推 permission.cancelled 让 UI 关弹窗
//
// 设计点：
//   - reqId 用 randomUUID()——避免 renderer 端竞态时把答案对到错的 request
//   - Always-allow 规则在 broker.request() 第一步检查；命中则**完全不**弹窗，直接 resolve
//     'allow_once'（不重新写规则）。这是 F007 验收里"下次同 pattern 不再弹"的实现点
//   - 危险命令（assessment.dangerous=true）在本 broker 确实拥有决策权时仍然弹窗；
//     已由 Auto SDK guardrail 裁决的调用不会再次进入本 broker
//   - 超时：默认 5 分钟无响应自动 deny（防 renderer 崩了导致 KodaX 永远卡住）

import { randomUUID } from 'node:crypto';
import type {
  PermissionDecision,
  PermissionMode,
  PermissionRisk,
  Surface,
} from '@kodax-space/space-ipc-schema';
import { pushToRenderer } from '../ipc/push.js';
import { assessRisk, suggestAlwaysAllowPattern } from './risk.js';
import { permissionRegistry } from './registry.js';
import { sanitizeForDisplay, sanitizeInputForDisplay } from './sanitize.js';

const DEFAULT_TIMEOUT_MS = 5 * 60_000;

export interface PermissionRequestInput {
  readonly sessionId: string;
  readonly toolId: string;
  readonly toolName: string;
  readonly input?: Record<string, unknown>;
  /** KodaX canonical four profiles；缺省 'accept-edits'（schema 缺省同步）。*/
  readonly mode?: PermissionMode;
  /** Surface-aware policy extension; omitted callers keep Coder semantics. */
  readonly surface?: Surface;
  /** True only after the owning session's Partner tool policy has allowed this call. */
  readonly partnerToolAllowed?: boolean;
  /** 超时毫秒数；不传走 DEFAULT_TIMEOUT_MS。测试可调小。*/
  readonly timeoutMs?: number;
}

// FEATURE_029 mode 行为表：accept-edits 时这些工具名自动 allow_once
//（dangerous 仍走弹窗）。
// 命名贴近 KodaX 内核约定 + Claude Code 通用名。
// Auto 正常路径由 FEATURE_030 AutoModeToolGuardrail 接管且不进入本 broker。兼容调用者
// 仍可能把已由 SDK guardrail 裁决的 Auto 调用转到本 broker，因此 Auto 的非危险调用
// 必须直接通过，避免重新弹窗形成第二个决策者；危险调用继续 fail closed。
const EDIT_TOOLS = new Set(['edit', 'write', 'multi_edit', 'str_replace', 'insert_after_anchor']);

// Readonly tools — 在 accept-edits / Auto bootstrap-fallback 下 hard-code 自动允许。
// Auto 正常路径中的只读语义由 SDK guardrail 负责，本集合不参与二次复审。
// 名字覆盖 KodaX 内置 read 类工具 + Claude Code 通用名 — 三方一致。
const READONLY_TOOLS = new Set([
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

function normalizeToolName(toolName: string): string {
  return toolName.toLowerCase();
}

function isReadonlyToolName(toolName: string): boolean {
  return READONLY_TOOLS.has(normalizeToolName(toolName));
}

export interface PermissionResolved {
  readonly decision: PermissionDecision;
  readonly pattern?: string;
  readonly risk: PermissionRisk;
}

interface PendingEntry {
  readonly reqId: string;
  readonly sessionId: string;
  readonly risk: PermissionRisk;
  /** main 端为本次调用生成的 allow-always pattern；renderer 提交的 pattern 一律忽略（C2-sec）。*/
  readonly trustedPattern: string | undefined;
  readonly resolve: (r: PermissionResolved) => void;
  readonly timer: NodeJS.Timeout;
}

class PermissionBroker {
  private readonly pending = new Map<string, PendingEntry>();

  /**
   * 工具调用前的 gate。返回 decision；调用方根据 decision 决定是否真的执行 tool。
   *
   * 'allow_once' / 'allow_always' → 调用方继续执行
   * 'deny'                         → 调用方放弃，emit tool_result 带 "permission denied"
   *
   * review H2-code（2026-05-17）：在 matches() 前显式 await load()。
   * registry.load() 是 idempotent 的（cached !== null 时立即返回），后续调用零成本。
   * 这关闭了"启动早期 main.ts void load() 还没完成但 session 已经发起 tool 调用"的窗口——
   * 该窗口里 matches() 会返回 false 然后强弹窗（安全侧），但显式 await 杜绝未来误优化的风险
   */
  async request(req: PermissionRequestInput): Promise<PermissionResolved> {
    const assessment = assessRisk(req.toolName, req.input);
    const mode: PermissionMode = req.mode ?? 'accept-edits';
    const toolName = normalizeToolName(req.toolName);

    // Permission-profile shortcuts for the legacy embedded path:
    //
    //   plan         → Coder 全 deny，agent 只能 plan 不能执行
    //                  (planModeBlockCheck 也会拦下 mutating tools，本钩子双闸防 TOCTOU)。
    //                  Partner 只放行已经由 Partner tool policy admitted 的工具。
    //   accept-edits → edit/write 自动批，readonly 自动批，其他走 always-allow 规则 + 弹窗
    //   auto         → 正常路径已由 KodaXOptions.guardrails 完成裁决，不会进入这里。
    //                  兼容路径只拦 dangerous，非 dangerous 直接通过，避免对同一
    //                  Auto 调用再做一次静态审批。
    //   full-access  → 直接通过本层；不可授权边界仍由 SDK Exec Policy 负责。
    if (req.surface === 'partner' && req.partnerToolAllowed === true && !assessment.dangerous) {
      return { decision: 'allow_once', risk: assessment.risk };
    }
    if (mode === 'plan') {
      if (!assessment.dangerous && isReadonlyToolName(toolName)) {
        return { decision: 'allow_once', risk: assessment.risk };
      }
      return { decision: 'deny', risk: assessment.risk };
    }
    if (mode === 'full-access') {
      return { decision: 'allow_once', risk: assessment.risk };
    }
    if (mode === 'auto' && !assessment.dangerous) {
      return { decision: 'allow_once', risk: assessment.risk };
    }
    if (
      mode === 'accept-edits' &&
      !assessment.dangerous &&
      (EDIT_TOOLS.has(toolName) || isReadonlyToolName(toolName))
    ) {
      return { decision: 'allow_once', risk: assessment.risk };
    }

    // accept-edits 中 dangerous / 非 edit/read 工具，或 Auto 中 dangerous：
    // 走 always-allow 规则 + 弹窗。

    // 确保规则已加载——idempotent，已加载时立即返回
    await permissionRegistry.load();

    // 已批准且非危险 — 跳过弹窗
    if (!assessment.dangerous && permissionRegistry.matches(req.toolName, req.input)) {
      return { decision: 'allow_once', risk: assessment.risk };
    }

    const reqId = randomUUID();
    const suggestedPattern = suggestAlwaysAllowPattern(req.toolName, req.input, assessment);

    return new Promise<PermissionResolved>((resolve) => {
      const timer = setTimeout(() => {
        if (this.pending.delete(reqId)) {
          pushToRenderer('permission.cancelled', {
            reqId,
            sessionId: req.sessionId,
            reason: 'timeout',
          });
          resolve({ decision: 'deny', risk: assessment.risk });
        }
      }, req.timeoutMs ?? DEFAULT_TIMEOUT_MS);

      // unref 防止 setTimeout 阻止进程退出（broker 的超时不应当 keep-alive event loop）
      if (typeof timer.unref === 'function') timer.unref();

      this.pending.set(reqId, {
        reqId,
        sessionId: req.sessionId,
        risk: assessment.risk,
        trustedPattern: suggestedPattern,
        resolve: (r) => {
          clearTimeout(timer);
          resolve(r);
        },
        timer,
      });

      // review H3-sec：清洗显示用字段。原始 input 已经被 assessRisk 用过，
      // 这里清洗只影响 modal 显示——不影响危险检测结果
      const safeToolName = sanitizeForDisplay(req.toolName, 128) || '(unnamed)';
      const safeReason = sanitizeForDisplay(assessment.reason, 512);
      const safeInput = sanitizeInputForDisplay(req.input);

      pushToRenderer('permission.request', {
        reqId,
        sessionId: req.sessionId,
        risk: assessment.risk,
        reason: safeReason,
        toolCall: {
          toolId: req.toolId,
          toolName: safeToolName,
          input: safeInput,
        },
        suggestedPattern,
      });
    });
  }

  /**
   * 查询某 pending entry 的可信元数据。
   * Handler 在调用 resolve 前用这个拿 trustedPattern——renderer 提交的 pattern 字段一律忽略。
   * 不存在时返回 undefined。
   */
  peek(
    reqId: string,
  ): { trustedPattern: string | undefined; sessionId: string; risk: PermissionRisk } | undefined {
    const entry = this.pending.get(reqId);
    if (!entry) return undefined;
    return {
      trustedPattern: entry.trustedPattern,
      sessionId: entry.sessionId,
      risk: entry.risk,
    };
  }

  /**
   * Renderer 回答时调用。reqId 不存在（超时 / session 已取消）返回 false。
   *
   * 注意（review C2-sec）：不再接受 renderer-supplied pattern。Handler 应当先
   * 调 peek() 拿 trustedPattern，自己处理持久化，再调 resolve 通知 session 继续。
   * Broker 只承诺把 decision + risk 传回等待的 promise。
   */
  resolve(reqId: string, decision: PermissionDecision): boolean {
    const entry = this.pending.get(reqId);
    if (!entry) return false;
    this.pending.delete(reqId);
    entry.resolve({
      decision,
      pattern: decision === 'allow_always' ? entry.trustedPattern : undefined,
      risk: entry.risk,
    });
    return true;
  }

  /**
   * Session 取消 / 删除时调用：所有该 session 的 pending 自动 deny。
   * renderer 收到 permission.cancelled 后应关闭弹窗。
   */
  cancelSession(
    sessionId: string,
    reason: 'session_cancelled' | 'session_disposed' | 'shutdown',
  ): void {
    const toCancel: PendingEntry[] = [];
    for (const entry of this.pending.values()) {
      if (entry.sessionId === sessionId) toCancel.push(entry);
    }
    for (const entry of toCancel) {
      this.pending.delete(entry.reqId);
      clearTimeout(entry.timer);
      pushToRenderer('permission.cancelled', {
        reqId: entry.reqId,
        sessionId,
        reason,
      });
      entry.resolve({ decision: 'deny', risk: entry.risk });
    }
  }

  /**
   * 进程退出兜底：所有 pending 全部 deny + 推 permission.cancelled 给 renderer
   * 关弹窗（review M2-sec：原本不推 cancelled，renderer modal queue 残留）。
   * 在 app.before-quit 调用——保证 disposeAll 循环被中断时也能清理。
   */
  cancelAll(reason: 'shutdown'): void {
    const entries = [...this.pending.values()];
    for (const entry of entries) {
      this.pending.delete(entry.reqId);
      clearTimeout(entry.timer);
      pushToRenderer('permission.cancelled', {
        reqId: entry.reqId,
        sessionId: entry.sessionId,
        reason,
      });
      entry.resolve({ decision: 'deny', risk: entry.risk });
    }
  }

  /** 测试 / 调试：当前 pending 数。*/
  pendingCount(): number {
    return this.pending.size;
  }
}

export const permissionBroker = new PermissionBroker();
