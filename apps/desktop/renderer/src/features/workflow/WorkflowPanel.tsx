// F061 — Workflow 进度面板（Coder-only）。
//
// REPL inline/fullscreen 工作流面的 GUI 等价物：把 store 里某 session 的工作流 run 渲染成
// phase/agent/step 树，带 status 图标、counts/progress、token 用量、digest 三态。
// 纯展示——数据来自 F060 的 workflowRuns store slice；控制动作（stop/pause/resume）F062 接。
//
// Space 零编排：本组件只画 SDK 给的 snapshot，不跑、不折叠任何工作流逻辑。
//
// 结构（避免重复 selector + hooks-order 陷阱，记忆 leftsidebar_hooks_order_whitescreen）：
//   - useSessionWorkflowRuns()  —— 唯一 selector（useShallow 作元素级比较，跨 session 事件不误触发）
//   - WorkflowSection / 调用方  —— 调一次 selector，把 runs 当 prop 传下去
//   - WorkflowPanel({ runs })    —— 纯展示，不自取 store
//   - WorkflowPanelConnected     —— popout 用（自取 runs 再渲染 WorkflowPanel）

import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from 'react';
import { useShallow } from 'zustand/react/shallow';
import {
  Loader2,
  CheckCircle2,
  XCircle,
  CircleSlash,
  PauseCircle,
  Circle,
  MinusCircle,
  Bot,
  Coins,
  Pause,
  Play,
  Square,
  Pencil,
  Trash2,
  ChevronDown,
  ChevronRight,
  Copy,
  type LucideIcon,
} from 'lucide-react';
import type {
  WorkflowRunT,
  WorkflowProcessStatusT,
  WorkflowProcessItemStatusT,
  WorkflowProcessSummaryStatusT,
  WorkflowActivityPayload,
} from '@kodax-space/space-ipc-schema';
import { useAppStore } from '../../store/appStore.js';
import { pushToast } from '../../store/toastStore.js';
import { requestConfirm } from '../../store/confirmStore.js';
import { buildItemTree, type WorkflowTreeNode } from './buildItemTree.js';
import { WorkflowRunGraph } from './WorkflowRunGraph.js';
import { WorkflowLauncher } from './WorkflowLauncher.js';
import { useI18n } from '../../i18n/I18nProvider.js';
import type { MessageKey } from '../../i18n/messages.js';
import type {} from '../../types/global.js';
import { workflowPhaseCounter } from './workflowPhaseDisplay.js';

// ---- run / item 状态 → 图标 + 颜色 ----
const RUN_ICON: Record<WorkflowProcessStatusT, LucideIcon> = {
  running: Loader2,
  paused: PauseCircle,
  completed: CheckCircle2,
  failed: XCircle,
  cancelled: CircleSlash,
};
const RUN_COLOR: Record<WorkflowProcessStatusT, string> = {
  running: 'text-warn',
  paused: 'text-fg-muted',
  completed: 'text-ok',
  failed: 'text-danger',
  cancelled: 'text-fg-faint',
};
const ITEM_ICON: Record<WorkflowProcessItemStatusT, LucideIcon> = {
  pending: Circle,
  running: Loader2,
  completed: CheckCircle2,
  failed: XCircle,
  cancelled: CircleSlash,
  skipped: MinusCircle,
};
const ITEM_COLOR: Record<WorkflowProcessItemStatusT, string> = {
  pending: 'text-fg-faint',
  running: 'text-warn',
  completed: 'text-ok',
  failed: 'text-danger',
  cancelled: 'text-fg-faint',
  skipped: 'text-fg-faint',
};
const SPIN: ReadonlySet<string> = new Set(['running']);
const TERMINAL: ReadonlySet<WorkflowProcessStatusT> = new Set(['completed', 'failed', 'cancelled']);
// 缩进每层 12px，但封顶 8 层——防 SDK 给深树时内层被推出面板（视觉饱和钳制）。
const MAX_INDENT_DEPTH = 8;
const RESULT_LOAD_TIMEOUT_MS = 3000;

const EMPTY_RUNS: readonly WorkflowRunT[] = [];
const EMPTY_ACTIVITY: readonly WorkflowActivityPayload[] = [];
type Translate = (key: MessageKey, vars?: Record<string, string | number>) => string;

/**
 * fire-and-forget 控制调用：吞掉 IPC 拒绝（启动期无 handler / 通道未放行）避免 unhandled rejection；
 * 控制动作在 ok=false / 抛错时弹 toast。状态变化仍由 workflow.event 回流。
 */
function fireControl(p: Promise<unknown> | undefined, failMsg?: string): void {
  if (!p) return;
  void p
    .then((r) => {
      if (!failMsg) return;
      const env = r as { ok?: boolean; data?: { ok?: boolean } };
      if (env.ok === false || env.data?.ok === false) pushToast(failMsg, 'warning');
    })
    .catch(() => {
      if (failMsg) pushToast(failMsg, 'warning');
    });
}

/** 紧凑 token 格式：1234 → "1.2k"，1_200_000 → "1.2M"。 */
function fmtTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

function workflowAgentProgressLabel(run: WorkflowRunT, t: Translate): string {
  const total = Math.max(
    run.progress.plannedItems ?? 0,
    run.progress.spawnedAgents,
    run.progress.finishedAgents +
      run.progress.activeAgents +
      run.progress.failedAgents +
      run.progress.stoppedAgents,
  );
  const parts = [
    t('workflow.agentDone', {
      done: run.progress.finishedAgents,
      total: total || run.progress.spawnedAgents,
    }),
  ];
  if (run.progress.activeAgents > 0)
    parts.push(t('workflow.agentActive', { count: run.progress.activeAgents }));
  if (run.progress.failedAgents > 0)
    parts.push(t('workflow.agentFailed', { count: run.progress.failedAgents }));
  if (run.progress.stoppedAgents > 0)
    parts.push(t('workflow.agentStopped', { count: run.progress.stoppedAgents }));
  return parts.join(' · ');
}

/**
 * Selector：取归属 currentSession 的 run，按开始时间倒序（新的在前）。
 * useShallow 作元素级浅比较——workflowRuns 每个事件都换新引用（含别的 session 的事件），
 * 但只要本 session 的结果数组元素引用没变就不重渲染/重算（避免跨 session 事件误触发）。
 */
export function useSessionWorkflowRuns(): readonly WorkflowRunT[] {
  return useAppStore(
    useShallow((s) => {
      const sid = s.currentSessionId;
      if (!sid) return EMPTY_RUNS;
      return Object.values(s.workflowRuns)
        .filter((r) => r.sessionId === sid)
        .sort((a, b) => (a.startedAt < b.startedAt ? 1 : a.startedAt > b.startedAt ? -1 : 0));
    }),
  );
}

interface WorkflowPanelProps {
  /** 已 selector 出的 runs（由调用方传入，避免重复 selector）。 */
  readonly runs: readonly WorkflowRunT[];
  /** compact = RightSidebar 紧凑摘要（终态 run 折叠 tree）；full = popout 全展开。 */
  readonly variant?: 'compact' | 'full';
  /** 管理详情页已有自己的 run 标题/控制区时，隐藏卡片内重复头部。 */
  readonly hideRunHeader?: boolean;
  /** full 视图默认展开子树；详情页可改为默认折叠，让流程图/历史先露出。 */
  readonly defaultDetailsOpen?: boolean;
  readonly defaultResultOpen?: boolean;
}

/** 纯展示面板：渲染传入的 runs。空 runs 显示空态（popout 路径可达）。 */
export function WorkflowPanel({
  runs,
  variant = 'compact',
  hideRunHeader = false,
  defaultDetailsOpen,
  defaultResultOpen,
}: WorkflowPanelProps): JSX.Element {
  const { t } = useI18n();
  if (runs.length === 0) {
    return <div className="text-xs text-fg-muted px-1 py-2">{t('workflow.noRuns')}</div>;
  }
  const visibleRuns = variant === 'compact' ? runs.slice(0, 3) : runs;
  const overflow = runs.length - visibleRuns.length;
  return (
    <div className="space-y-2">
      {visibleRuns.map((run) => (
        <WorkflowRunCard
          key={run.runId}
          run={run}
          variant={variant}
          hideHeader={hideRunHeader}
          defaultDetailsOpen={defaultDetailsOpen}
          defaultResultOpen={defaultResultOpen}
        />
      ))}
      {overflow > 0 && (
        <div className="text-[11px] text-fg-faint px-1 font-mono">
          {t('workflow.moreInFullPanel', { count: overflow })}
        </div>
      )}
    </div>
  );
}

/** Popout 连接版：顶部启动器（F063）+ 当前 session 的 runs。 */
export function WorkflowPanelConnected({
  variant = 'full',
}: {
  variant?: 'compact' | 'full';
}): JSX.Element {
  const runs = useSessionWorkflowRuns();
  return (
    <div>
      <WorkflowLauncher />
      <WorkflowPanel runs={runs} variant={variant} />
    </div>
  );
}

// 头部控制簇：pause/resume/stop（按 status）+ rename（full）+ delete（终态 + full）。
// 控制后状态由 workflow.event 自然回流，按钮不乐观改本地态。
function WorkflowControls({
  run,
  variant,
  isTerminal,
  hasPhaseCounter,
  onRename,
}: {
  run: WorkflowRunT;
  variant: 'compact' | 'full';
  isTerminal: boolean;
  hasPhaseCounter: boolean;
  onRename: () => void;
}): JSX.Element {
  const { t } = useI18n();
  const runId = run.runId;
  const active = run.status === 'running' || run.status === 'paused';
  // #1 fix: window.confirm 在 Electron sandbox=true 下会夺走 webContents 键盘焦点且拿不回来
  // ——改用应用内 requestConfirm。
  async function handleDelete(): Promise<void> {
    const confirmed = await requestConfirm({
      message: t('workflow.deleteRunConfirm', { name: run.displayName ?? run.workflowName }),
      danger: true,
      confirmLabel: t('workflow.delete'),
    });
    if (!confirmed) return;
    const res = await window.kodaxSpace?.invoke('workflow.delete', { runId });
    const env = res as { ok?: boolean; data?: { ok?: boolean } } | undefined;
    if (!res || env?.ok === false || env?.data?.ok === false) {
      pushToast(t('workflow.deleteFailed'), 'warning');
      return;
    }
    // 删除无 push 事件、seed 只增不删——必须显式从 store 移除，否则面板里删不掉。
    useAppStore.getState().removeWorkflowRun(runId);
  }
  return (
    <div
      className={`flex items-center gap-0.5 flex-shrink-0 ${hasPhaseCounter ? 'ml-1.5' : 'ml-auto'}`}
    >
      {run.status === 'running' && (
        <CtlBtn
          label={t('workflow.pause')}
          onClick={() =>
            fireControl(
              window.kodaxSpace?.invoke('workflow.pause', { runId }),
              t('workflow.pauseFailed'),
            )
          }
        >
          <Pause size={12} />
        </CtlBtn>
      )}
      {run.status === 'paused' && (
        <CtlBtn
          label={t('workflow.resume')}
          onClick={() =>
            fireControl(
              window.kodaxSpace?.invoke('workflow.resume', { runId }),
              t('workflow.resumeFailed'),
            )
          }
        >
          <Play size={12} />
        </CtlBtn>
      )}
      {active && (
        <CtlBtn
          label={t('workflow.stop')}
          danger
          onClick={() =>
            fireControl(
              window.kodaxSpace?.invoke('workflow.stop', { runId }),
              t('workflow.stopFailed'),
            )
          }
        >
          <Square size={12} />
        </CtlBtn>
      )}
      {variant === 'full' && (
        <CtlBtn label={t('workflow.rename')} onClick={onRename}>
          <Pencil size={11} />
        </CtlBtn>
      )}
      {variant === 'full' && isTerminal && (
        <CtlBtn label={t('workflow.delete')} danger onClick={() => void handleDelete()}>
          <Trash2 size={11} />
        </CtlBtn>
      )}
    </div>
  );
}

function CtlBtn({
  label,
  danger,
  onClick,
  children,
}: {
  label: string;
  danger?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className={`w-5 h-5 inline-flex items-center justify-center rounded text-fg-muted hover:bg-surface-3 ${
        danger ? 'hover:text-danger' : 'hover:text-fg-primary'
      }`}
    >
      {children}
    </button>
  );
}

function WorkflowRunCard({
  run,
  variant,
  hideHeader,
  defaultDetailsOpen,
  defaultResultOpen,
}: {
  run: WorkflowRunT;
  variant: 'compact' | 'full';
  hideHeader: boolean;
  defaultDetailsOpen: boolean | undefined;
  defaultResultOpen: boolean | undefined;
}): JSX.Element {
  const { t } = useI18n();
  const RunIcon = RUN_ICON[run.status];
  const tree = useMemo(() => buildItemTree(run.items), [run.items]);
  const isTerminal = TERMINAL.has(run.status);
  const [detailsOpen, setDetailsOpen] = useState(defaultDetailsOpen ?? variant === 'full');
  const showTree = detailsOpen;
  const phaseCounter = workflowPhaseCounter(run);

  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState('');
  // 防双触发:Enter 提交后 setRenaming(false) 卸载 input → 触发 blur 又调一次 commitRename。
  // ref 跨 Enter+blur 序列守一次（state 重置在同事件内读不到，必须用 ref）。
  const committingRef = useRef(false);
  const name = run.displayName ?? run.workflowName;
  function startRename(): void {
    committingRef.current = false;
    setDraft(name);
    setRenaming(true);
  }
  function commitRename(): void {
    if (committingRef.current) return;
    committingRef.current = true;
    const next = draft.trim();
    setRenaming(false);
    if (next && next !== name) {
      fireControl(
        window.kodaxSpace?.invoke('workflow.rename', { runId: run.runId, displayName: next }),
        t('workflow.renameFailed'),
      );
    }
  }

  return (
    <div className="rounded-lg border border-border-default/70 bg-surface-2 p-2">
      {/* 头部：状态图标 + 名称（可改名）+ phase 进度 + 控制 */}
      {!hideHeader && (
        <div className="flex items-center gap-1.5 min-w-0">
          <RunIcon
            size={13}
            className={`flex-shrink-0 ${RUN_COLOR[run.status]} ${SPIN.has(run.status) ? 'animate-spin' : ''}`}
            aria-hidden
          />
          {renaming ? (
            <input
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commitRename}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitRename();
                else if (e.key === 'Escape') setRenaming(false);
              }}
              className="flex-1 min-w-0 text-[12px] bg-surface-3 border border-border-default rounded px-1 py-0.5 text-fg-primary"
              aria-label={t('workflow.renameAria')}
            />
          ) : (
            <span className="text-[12px] font-medium text-fg-primary truncate" title={name}>
              {name}
            </span>
          )}
          {phaseCounter !== undefined && !renaming && (
            <span className="ml-auto flex-shrink-0 text-[10px] font-mono text-fg-muted">
              {phaseCounter}
            </span>
          )}
          {!renaming && (
            <WorkflowControls
              run={run}
              variant={variant}
              isTerminal={isTerminal}
              hasPhaseCounter={phaseCounter !== undefined}
              onRename={startRename}
            />
          )}
        </div>
      )}

      {/* 进度计量行：agents + token */}
      <div
        className={`${hideHeader ? '' : 'mt-1'} flex items-center gap-2 text-[10px] font-mono text-fg-muted`}
      >
        <span className="inline-flex items-center gap-1" title={t('workflow.agentsMetricTitle')}>
          <Bot size={10} aria-hidden />
          {workflowAgentProgressLabel(run, t)}
        </span>
        {run.tokens && (
          <span className="inline-flex items-center gap-1" title={t('workflow.tokenMetricTitle')}>
            <Coins size={10} aria-hidden />
            {fmtTokens(run.tokens.spent)}
          </span>
        )}
        {run.counts.failed > 0 && <span className="text-danger">✗ {run.counts.failed}</span>}
      </div>

      <WorkflowRunGraph run={run} />

      {/* 最新活动行（live ticker）——单行原地刷新，放在 RUNTIME STATUS 下方 */}
      {run.latestMessage && !isTerminal && (
        <div className="mt-1.5 text-[11px] text-fg-secondary truncate" title={run.latestMessage}>
          {run.latestMessage}
        </div>
      )}

      {(tree.length > 0 || !isTerminal) && (
        <button
          type="button"
          onClick={() => setDetailsOpen((v) => !v)}
          className="mt-1 inline-flex items-center gap-1 text-[10px] text-fg-muted hover:text-fg-primary"
          aria-expanded={detailsOpen}
          data-testid="workflow-details-toggle"
        >
          {detailsOpen ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
          阶段详情
        </button>
      )}

      {showTree && tree.length > 0 && (
        <ul className="mt-1.5 space-y-0.5">
          {tree.map((node) => (
            <WorkflowItemRow key={node.item.id} node={node} depth={0} />
          ))}
        </ul>
      )}

      {/* 结果 / 错误（终态） */}
      {run.status === 'failed' && run.error && (
        <div className="mt-1 text-[11px] text-danger break-words">{run.error}</div>
      )}
      {run.resultSummary && isTerminal && run.status !== 'completed' && (
        <WorkflowSummaryView summary={run.resultSummary} variant={variant} />
      )}

      {/* F066 完整结果（终态懒取）；artifacts 已自动桥进 artifact 面板（方案 A）。 */}
      {isTerminal && run.status === 'completed' && (
        <WorkflowResultView
          runId={run.runId}
          fallback={run.resultSummary}
          defaultOpen={defaultResultOpen}
        />
      )}

      {/* F065 子 agent 活动遥测（活跃 / full 时显示，不淹主 transcript） */}
      {showTree && <WorkflowActivityStrip runId={run.runId} />}
    </div>
  );
}

function WorkflowSummaryView({
  summary,
  variant,
}: {
  summary: string;
  variant: 'compact' | 'full';
}): JSX.Element {
  const { t } = useI18n();
  const long = summary.length > 700 || summary.split('\n').length > 8;
  const [open, setOpen] = useState(!long && variant === 'full');
  if (!long) {
    return <div className="mt-1 text-[11px] text-fg-secondary break-words">{summary}</div>;
  }
  const preview = summary.slice(0, variant === 'compact' ? 320 : 520).trimEnd();
  return (
    <div className="mt-1 rounded border border-border-default/45 bg-surface/30 p-1.5">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="mb-1 inline-flex items-center gap-1 text-[10px] text-fg-muted hover:text-fg-primary"
        aria-expanded={open}
        data-testid="workflow-summary-toggle"
      >
        {open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
        {t('workflow.summary')}
      </button>
      <pre
        className={`text-[11px] text-fg-secondary whitespace-pre-wrap break-words ${
          open ? 'max-h-64 overflow-auto' : 'max-h-20 overflow-hidden'
        }`}
      >
        {open ? summary : `${preview}${preview.length < summary.length ? '\n...' : ''}`}
      </pre>
    </div>
  );
}

/** F066 完整结果视图：终态懒取 workflow.result，可展开 + 复制。 */
function WorkflowResultView({
  runId,
  fallback,
  defaultOpen = false,
}: {
  runId: string;
  fallback?: string;
  defaultOpen?: boolean;
}): JSX.Element {
  const { t } = useI18n();
  const [open, setOpen] = useState(defaultOpen);
  const [result, setResult] = useState<string | null>(fallback ?? null);
  const [loading, setLoading] = useState(false);
  const fetchAttemptedRef = useRef(false);
  const mountedRef = useRef(true);
  const resultRef = useRef<string | null>(result);
  useEffect(() => () => void (mountedRef.current = false), []);
  useEffect(() => {
    resultRef.current = result;
  }, [result]);
  useEffect(() => {
    if (fallback) setResult((current) => current ?? fallback);
  }, [fallback]);
  const loadResult = useCallback(async (): Promise<void> => {
    if (fetchAttemptedRef.current) return;
    fetchAttemptedRef.current = true;
    // Only show the loading state (which disables the copy button) when there is no
    // fallback result already displayed. A run with a resultSummary shows immediately and
    // its copy affordance stays usable; the ref above still guards the fetch reentrancy race.
    setLoading(resultRef.current === null);
    const resultPromise =
      window.kodaxSpace?.invoke('workflow.result', { runId }).catch(() => null) ??
      Promise.resolve(null);
    const timeoutPromise = new Promise<null>((resolve) =>
      window.setTimeout(() => resolve(null), RESULT_LOAD_TIMEOUT_MS),
    );
    try {
      const r = await Promise.race([resultPromise, timeoutPromise]);
      if (!mountedRef.current) return;
      setResult(r?.ok ? (r.data.result ?? fallback ?? '') : (fallback ?? ''));
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [fallback, runId]);
  useEffect(() => {
    if (open) void loadResult();
  }, [loadResult, open]);
  function toggle(): void {
    const next = !open;
    setOpen(next);
    if (next) void loadResult();
  }
  const copyDisabled = loading || !result;
  return (
    <div className="mt-1">
      <button
        type="button"
        onClick={toggle}
        className="inline-flex items-center gap-1 text-[10px] text-fg-muted hover:text-fg-primary"
        aria-expanded={open}
        data-testid="workflow-result-toggle"
      >
        {open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
        完整结果
      </button>
      {open && (
        <div className="mt-1">
          {loading && !result ? (
            <div className="text-[10px] text-fg-faint">{t('workflow.loadingResult')}</div>
          ) : result ? (
            <div className="relative">
              <pre
                className="max-h-48 overflow-auto rounded bg-surface-3 p-1.5 text-[10px] text-fg-secondary whitespace-pre-wrap break-words"
                data-testid="workflow-result-body"
              >
                {result}
              </pre>
              <button
                type="button"
                onClick={() => {
                  if (copyDisabled || !result) return;
                  void navigator.clipboard
                    ?.writeText(result)
                    .then(() => pushToast(t('workflow.resultCopied'), 'success'));
                }}
                disabled={copyDisabled}
                title={loading ? t('workflow.resultLoadingTitle') : t('workflow.copy')}
                aria-label={loading ? t('workflow.resultLoadingAria') : t('workflow.copyResult')}
                className="absolute top-1 right-1 w-5 h-5 inline-flex items-center justify-center rounded text-fg-muted hover:text-fg-primary hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent disabled:hover:text-fg-muted"
              >
                <Copy size={11} />
              </button>
            </div>
          ) : (
            <div className="text-[10px] text-fg-faint">{t('workflow.noResult')}</div>
          )}
        </div>
      )}
    </div>
  );
}

const ACTIVITY_ICON: Record<WorkflowActivityPayload['kind'], string> = {
  tool_use: '▸',
  tool_result: '✓',
  end: '■',
  digest: '≡',
};
const ACTIVITY_WINDOW = 6;

function workflowActivityLabel(activity: WorkflowActivityPayload, t: Translate): string {
  if (activity.kind === 'end') return t('workflow.activityDone');
  if (activity.kind === 'digest') {
    if (activity.summary)
      return t('workflow.activitySummaryWithText', { summary: activity.summary });
    if (activity.verification) {
      const reason = activity.verification.reasons[0];
      return activity.verification.ok
        ? t('workflow.activityVerified')
        : t('workflow.activityVerificationFailed', { reason: reason ? `: ${reason}` : '' });
    }
    return t('workflow.activitySummary');
  }
  return activity.toolName ?? activity.kind;
}

/** 子 agent 活动条：显示最近几条 discrete 活动（工具调用/结果/封口），按子 agent 标注。 */
function WorkflowActivityStrip({ runId }: { runId: string }): JSX.Element | null {
  const { t } = useI18n();
  const activity = useAppStore(useShallow((s) => s.workflowActivityByRun[runId] ?? EMPTY_ACTIVITY));
  if (activity.length === 0) return null;
  // 用 bucket 内绝对位置作 key——滑动窗口下保持稳定（不随 slice 起点漂移）。
  const base = Math.max(0, activity.length - ACTIVITY_WINDOW);
  const recent = activity.slice(base);
  return (
    <div className="mt-1.5 border-t border-border-default/40 pt-1 space-y-0.5">
      {recent.map((a, i) => (
        <div
          key={`${a.runId}-${base + i}`}
          className="flex items-center gap-1.5 text-[10px] text-fg-muted min-w-0"
        >
          <span className="text-fg-faint flex-shrink-0">{ACTIVITY_ICON[a.kind]}</span>
          {a.childAgentName && (
            <span className="text-fg-faint flex-shrink-0 max-w-[90px] truncate">
              {a.childAgentName}
            </span>
          )}
          <span className="truncate">{workflowActivityLabel(a, t)}</span>
        </div>
      ))}
    </div>
  );
}

function WorkflowItemRow({ node, depth }: { node: WorkflowTreeNode; depth: number }): JSX.Element {
  const { t } = useI18n();
  const { item, children } = node;
  const Icon = ITEM_ICON[item.status];
  const indentPx = Math.min(depth, MAX_INDENT_DEPTH) * 12;
  const hasChildren = children.length > 0;
  const [childrenOpen, setChildrenOpen] = useState(true);
  return (
    <li>
      <div
        className="flex items-center gap-1.5 text-[11px] min-w-0"
        style={{ paddingLeft: `${indentPx}px` }}
      >
        {hasChildren ? (
          <button
            type="button"
            onClick={() => setChildrenOpen((value) => !value)}
            className="flex-shrink-0 text-fg-faint hover:text-fg-primary"
            aria-expanded={childrenOpen}
            aria-label={t('workflow.toggleItem', { name: item.title || item.id })}
            data-testid="workflow-item-toggle"
          >
            {childrenOpen ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
          </button>
        ) : (
          <span className="w-2.5 flex-shrink-0" aria-hidden />
        )}
        <Icon
          size={11}
          className={`flex-shrink-0 ${ITEM_COLOR[item.status]} ${SPIN.has(item.status) ? 'animate-spin' : ''}`}
          aria-hidden
        />
        <span
          className={`truncate ${item.status === 'running' ? 'text-fg-primary' : 'text-fg-secondary'}`}
          title={item.title}
        >
          {item.title || item.id}
        </span>
        {item.model && (
          <span
            className="ml-auto flex-shrink-0 text-[9px] font-mono text-fg-faint truncate max-w-[80px]"
            title={`${item.provider ?? ''} ${item.model}`}
          >
            {item.model}
          </span>
        )}
      </div>
      {/* digest 三态：result/notice 显文本 / pending 显生成中 / unavailable 诚实标不可用 */}
      {item.summaryStatus !== undefined && (
        <DigestLine status={item.summaryStatus} summary={item.summary} indentPx={indentPx} />
      )}
      {hasChildren && childrenOpen && (
        <ul className="space-y-0.5">
          {children.map((c) => (
            <WorkflowItemRow key={c.item.id} node={c} depth={depth + 1} />
          ))}
        </ul>
      )}
    </li>
  );
}

function DigestLine({
  status,
  summary,
  indentPx,
}: {
  status: WorkflowProcessSummaryStatusT;
  summary?: string;
  indentPx: number;
}): JSX.Element | null {
  const { t } = useI18n();
  const pad = { paddingLeft: `${indentPx + 16}px` };
  switch (status) {
    case 'pending':
      return (
        <div className="text-[10px] text-fg-faint italic" style={pad}>
          {t('workflow.digestPending')}
        </div>
      );
    case 'unavailable':
      return (
        <div className="text-[10px] text-fg-faint italic" style={pad}>
          {t('workflow.digestUnavailable')}
        </div>
      );
    case 'notice':
      // 非最终摘要的提示性信息——与 result 区分：弱化 + 前缀标记。
      if (!summary) return null;
      return (
        <CollapsibleDigest
          text={summary}
          className="text-[10px] text-fg-faint break-words"
          style={pad}
          prefix="ⓘ "
        />
      );
    case 'result':
      if (!summary) return null;
      return (
        <CollapsibleDigest
          text={summary}
          className="text-[10px] text-fg-muted break-words"
          style={pad}
        />
      );
    default:
      // 穷尽性保险：SDK 若加新 summaryStatus，编译期会在此报错。
      return assertNever(status);
  }
}

function CollapsibleDigest({
  text,
  className,
  style,
  prefix = '',
}: {
  text: string;
  className: string;
  style: React.CSSProperties;
  prefix?: string;
}): JSX.Element {
  const { t } = useI18n();
  const long = text.length > 520 || text.split('\n').length > 5;
  const [open, setOpen] = useState(false);
  if (!long) {
    return (
      <div className={className} style={style} title={text}>
        {prefix}
        {text}
      </div>
    );
  }
  const preview = text.slice(0, 260).trimEnd();
  return (
    <div style={style}>
      <div
        className={`${className} ${open ? t('workflow.collapseDigest') : t('workflow.expandDigest')}`}
        title={text}
      >
        {prefix}
        {open ? text : `${preview}${preview.length < text.length ? '\n...' : ''}`}
      </div>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="mt-0.5 inline-flex items-center gap-1 text-[10px] text-fg-faint hover:text-fg-primary"
        aria-expanded={open}
        data-testid="workflow-digest-toggle"
      >
        {open ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
        {open ? '收起摘要' : '展开摘要'}
      </button>
    </div>
  );
}

function assertNever(x: never): null {
  void x;
  return null;
}
