// PermissionModal —— F007 工具调用授权弹窗。
//
// 行为：
//   - 全局监听 push 'permission.request' / 'permission.cancelled'，进 store 的 permissionQueue
//   - 任一时刻只显示队列头部那个；用户决策后自动 dequeue 弹下一个
//   - 危险等级（risk='danger'）强制 typed-confirm：必须键入 CONFIRM 才能 enable Allow once
//     —— danger 永不出 "Always allow" 按钮（不该让危险命令静默白名单化）
//   - Escape = Deny；Enter（非危险时）= Allow once
//
// UX 历史：之前 "Always allow" 是 checkbox + 单 Allow 按钮，用户要先勾再点 —— 心智成本高。
// 现在改成 3 个按钮 (Deny / Allow once / Always allow `pattern`)，一键搞定。
//
// 安全注意：
//   - input 字段值原样 toString，不走 dangerouslySetInnerHTML——LLM 可能把 HTML 当做参数返回
//   - reason 字段已在 main 端限到 512 字；这里多套一层 truncate 防止极端长 string 撑爆 modal
//   - typed-confirm 比较用 trim() 后大小写敏感等值——避免 "Confirm" / " CONFIRM " 通过

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  PermissionDecision,
  PermissionRequestPayload,
  PermissionRisk,
} from '@kodax-space/space-ipc-schema';
import { useAppStore } from '../../store/appStore.js';
import { FloatingSurfaceHost } from '../../shell/FloatingSurfaceHost.js';
import { floatingSurfaceForBlockingModal } from '../../shell/floatingSurfacePolicy.js';
import { selectPermissionBatch } from './permissionBatching.js';
import { useI18n } from '../../i18n/I18nProvider.js';
import type { MessageKey } from '../../i18n/messages.js';
import { permissionGrantPresentation } from './permissionGrantPresentation.js';
import { interactionsForSession } from '../session/sessionInteractionRouting.js';

// Risk badge 颜色. Dark 模式: 深色实底 + 淡色文字 (经典 badge 风);
// Light 模式: 淡色实底 + 深色文字 — 视觉等价倒置, 在白底卡片上仍清晰.
// border 双主题: dark 用同色相 *-700 (深色边); light 用 *-400 (中浓边, 跟浅底有反差).
const RISK_STYLE: Record<PermissionRisk, { badge: string; border: string; label: string }> = {
  low: {
    badge: 'bg-info/12 text-info',
    border: 'border-info/40',
    label: 'LOW',
  },
  medium: {
    badge: 'bg-warn/12 text-warn',
    border: 'border-warn/40',
    label: 'MEDIUM',
  },
  high: {
    badge: 'bg-warn/12 text-warn',
    border: 'border-warn/40',
    label: 'HIGH',
  },
  danger: {
    badge: 'bg-danger/12 text-danger',
    border: 'border-danger/40',
    label: 'DANGER',
  },
};

const RISK_LABEL_KEY: Record<PermissionRisk, MessageKey> = {
  low: 'permission.risk.low',
  medium: 'permission.risk.medium',
  high: 'permission.risk.high',
  danger: 'permission.risk.danger',
};
type PermissionOperation = NonNullable<PermissionRequestPayload['toolCall']['operation']>;
const OPERATION_LABEL_KEY: Record<PermissionOperation, MessageKey> = {
  read: 'permission.operation.read',
  write: 'permission.operation.write',
  execute: 'permission.operation.execute',
  network: 'permission.operation.network',
  unknown: 'permission.operation.unknown',
};

const DANGER_CONFIRM_PHRASE = 'CONFIRM';
const PERMISSION_SURFACE = floatingSurfaceForBlockingModal(
  'permission-modal',
  'Tool permission request',
);
const PERMISSION_BATCH_SURFACE = floatingSurfaceForBlockingModal(
  'permission-batch-modal',
  'Batch tool permission request',
);

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + '…';
}

function permissionCommand(input: Record<string, unknown> | undefined): string | null {
  if (!input) return null;
  const value = input.command ?? input.cmd ?? input.script ?? input.shellScript ?? input.shell;
  return typeof value === 'string' ? truncate(value, 8_192) : null;
}

function permissionTarget(input: Record<string, unknown> | undefined): string | null {
  if (!input) return null;
  const value = input.path ?? input.file ?? input.target;
  return typeof value === 'string' ? truncate(value, 4_096) : null;
}

export function PermissionModal(): JSX.Element | null {
  const { t } = useI18n();
  const queue = useAppStore((s) => s.permissionQueue);
  const currentSessionId = useAppStore((s) => s.currentSessionId);
  const dequeue = useAppStore((s) => s.dequeuePermission);
  const sessionQueue = useMemo(
    () => interactionsForSession(queue, currentSessionId),
    [queue, currentSessionId],
  );
  // KX-I-05: queue 头部"同 session + 非 danger"连续 ≥ 2 条时合并成 batch 视图。
  const selection = useMemo(() => selectPermissionBatch(sessionQueue), [sessionQueue]);
  const head = selection.mode === 'single' ? selection.head : selection.items[0]!;

  // 每次切换 head（新弹窗）重置本地状态
  const [confirmText, setConfirmText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setConfirmText('');
    setBusy(false);
    setErr(null);
  }, [head?.reqId]);

  const display = useMemo(() => {
    const input = head?.toolCall.input;
    if (!input) {
      return { command: null, description: null, target: null, inputPreview: null };
    }
    const command = permissionCommand(input);
    const description =
      typeof input.description === 'string' ? truncate(input.description, 512) : null;
    const target = permissionTarget(input);
    const additionalInput = { ...input };
    for (const key of [
      'command',
      'cmd',
      'script',
      'shellScript',
      'shell',
      'description',
      'path',
      'file',
      'target',
    ]) {
      delete additionalInput[key];
    }
    if (Object.keys(additionalInput).length === 0) {
      return { command, description, target, inputPreview: null };
    }
    try {
      return {
        command,
        description,
        target,
        inputPreview: truncate(JSON.stringify(additionalInput, null, 2), 2_000),
      };
    } catch {
      return {
        command,
        description,
        target,
        inputPreview: t('permission.unserializableInput'),
      };
    }
  }, [head, t]);

  // 提前算这些 derived state，answer/keydown 都要用
  const style = head ? RISK_STYLE[head.risk] : null;
  const isDanger = head?.risk === 'danger';
  const dangerConfirmed = !isDanger || confirmText.trim() === DANGER_CONFIRM_PHRASE;
  const persistentGrant = head ? permissionGrantPresentation(head) : null;
  const dangerInputRef = useRef<HTMLInputElement | null>(null);
  const allowOnceButtonRef = useRef<HTMLButtonElement | null>(null);

  // review M3-code：用 useCallback 锁住 answer 的依赖关系，避免 keydown handler
  // 闭包陈旧的风险（queue shift 时仍调用陈旧 head 的 answer）
  const answer = useCallback(
    async (decision: PermissionDecision): Promise<void> => {
      if (!head || !window.kodaxSpace) return;
      if (busy) return;
      if (decision !== 'deny' && !dangerConfirmed) return;
      setBusy(true);
      setErr(null);
      try {
        // review C2-sec：不再发 pattern 字段——main 端用自己生成的 trustedPattern。
        // renderer 只能 toggle decision（deny / allow_once / allow_always）。
        // suggestedPattern 仍然存在但只用于 UI 显示（"Always allow bash:npm" 的文字）。
        const result = await window.kodaxSpace.invoke('permission.answer', {
          reqId: head.reqId,
          decision,
        });
        if (!result.ok) {
          // defensive (FEATURE_032 review): optional chaining 防 envelope error 字段缺失
          const code = result.error?.code ?? 'ERR_UNKNOWN';
          const message = result.error?.message ?? 'unknown error';
          setErr(`${code}: ${message}`);
          setBusy(false);
          return;
        }
        // result.data.accepted=false 表示 main 端已经把这条 reqId 撤回（超时 / session 取消）；
        // 视觉上同样 dequeue——弹窗已无意义
        dequeue(head.reqId);
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
        setBusy(false);
      }
    },
    [head, busy, dangerConfirmed, dequeue],
  );

  if (!head || !style) return null;

  // KX-I-05 batch view 分支：N 个连续同 session 非 danger 请求一次决策
  if (selection.mode === 'batch') {
    return <PermissionBatchView items={selection.items} dequeue={dequeue} />;
  }

  return (
    <FloatingSurfaceHost
      surface={PERMISSION_SURFACE}
      role="dialog"
      ariaLabelledBy="permission-modal-title"
      onEscapeKey={() => {
        void answer('deny');
      }}
      onEnterKey={() => {
        if (head.risk !== 'danger' && !busy) void answer('allow_once');
      }}
      initialFocusRef={isDanger ? dangerInputRef : allowOnceButtonRef}
      contentClassName="absolute inset-0 flex items-center justify-center pointer-events-none"
    >
      <div
        className={`glass lift ix-zone pointer-events-auto w-[520px] max-w-[95vw] max-h-[90vh] flex flex-col bg-surface-2 border ${style.border} rounded-lg`}
      >
        <div className="px-5 py-3 border-b border-border-default flex items-center gap-3 flex-shrink-0">
          <span
            className={`px-2 py-0.5 text-[11px] font-mono font-semibold rounded ${style.badge}`}
          >
            {t(RISK_LABEL_KEY[head.risk])}
          </span>
          <h2 id="permission-modal-title" className="text-sm font-semibold text-fg-primary">
            {t('permission.title')}
          </h2>
          {sessionQueue.length > 1 && (
            <span className="ml-auto text-[11px] font-mono text-fg-muted">
              {t('permission.pendingCount', { count: sessionQueue.length - 1 })}
            </span>
          )}
        </div>

        <div className="px-5 py-4 space-y-3 flex-1 overflow-y-auto">
          <div className="text-xs text-fg-muted leading-relaxed">{truncate(head.reason, 256)}</div>

          <div className="space-y-1">
            <div className="text-[11px] font-mono uppercase text-fg-muted">
              {t('permission.tool')}
            </div>
            <div className="text-sm font-mono text-warn">{head.toolCall.toolName}</div>
          </div>

          <div className="grid grid-cols-[7rem_minmax(0,1fr)] gap-x-3 gap-y-2 text-xs">
            <div className="font-mono uppercase text-fg-muted">{t('permission.operation')}</div>
            <div className="text-fg-primary">
              {t(OPERATION_LABEL_KEY[head.toolCall.operation ?? 'unknown'])}
            </div>
            {display.description && (
              <>
                <div className="font-mono uppercase text-fg-muted">
                  {t('permission.description')}
                </div>
                <div className="text-fg-primary break-words">{display.description}</div>
              </>
            )}
            {head.toolCall.executionCwd && (
              <>
                <div className="font-mono uppercase text-fg-muted">
                  {t('permission.workingDirectory')}
                </div>
                <code className="text-fg-primary break-all">{head.toolCall.executionCwd}</code>
              </>
            )}
            {display.target && (
              <>
                <div className="font-mono uppercase text-fg-muted">{t('permission.target')}</div>
                <code className="text-fg-primary break-all">{display.target}</code>
              </>
            )}
          </div>

          {display.command && (
            <div className="space-y-1">
              <div className="text-[11px] font-mono uppercase text-fg-muted">
                {t('permission.command')}
              </div>
              <pre className="text-xs font-mono bg-surface border border-border-default rounded p-2 overflow-x-auto max-h-48 whitespace-pre-wrap break-all">
                {display.command}
              </pre>
            </div>
          )}

          {display.inputPreview && (
            <div className="space-y-1">
              <div className="text-[11px] font-mono uppercase text-fg-muted">
                {t('permission.input')}
              </div>
              <pre className="text-xs font-mono bg-surface border border-border-default rounded p-2 overflow-x-auto max-h-48">
                {display.inputPreview}
              </pre>
            </div>
          )}

          {isDanger && (
            <div className="space-y-1 border-t border-danger pt-3">
              <label className="text-[11px] font-mono uppercase text-danger block">
                {t('permission.typeConfirm', { phrase: DANGER_CONFIRM_PHRASE })}
              </label>
              <input
                ref={dangerInputRef}
                type="text"
                autoFocus
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                placeholder={DANGER_CONFIRM_PHRASE}
                className="w-full bg-surface border border-danger rounded px-2 py-1 text-sm font-mono text-fg-primary outline-none focus:border-danger"
              />
              <div className="text-[11px] text-danger">{t('permission.dangerConfirmHint')}</div>
            </div>
          )}

          {err && <div className="text-xs text-danger font-mono">{err}</div>}
        </div>

        <div className="px-5 py-3 border-t border-border-default dark:bg-transparent bg-surface flex items-center justify-end gap-2 flex-shrink-0 flex-wrap">
          <button
            type="button"
            disabled={busy}
            onClick={() => void answer('deny')}
            className="px-3 py-1.5 text-xs rounded dark:bg-surface-3 dark:text-fg-primary dark:hover:bg-hover-bg bg-surface-3 text-fg-secondary hover:bg-hover-bg disabled:opacity-50"
          >
            {t('permission.denyEsc')}
          </button>
          {/* danger 永不出 Always allow——危险命令不能进白名单 */}
          {!isDanger && persistentGrant && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void answer('allow_always')}
              title={
                persistentGrant.kind === 'runtime_persistent'
                  ? t('permission.alwaysAllowRuntimeTitle', { scope: persistentGrant.target })
                  : t('permission.alwaysAllowTitle', { pattern: persistentGrant.target })
              }
              className="px-3 py-1.5 text-xs rounded font-medium border border-ok text-ok hover:bg-ok/15 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {persistentGrant.kind === 'runtime_persistent'
                ? t('permission.alwaysAllowRuntime', { scope: persistentGrant.target })
                : t('permission.alwaysAllow')}{' '}
              {persistentGrant.kind === 'pattern' && (
                <code className="font-mono text-xs text-warn">{persistentGrant.target}</code>
              )}
            </button>
          )}
          <button
            ref={allowOnceButtonRef}
            type="button"
            disabled={busy || !dangerConfirmed}
            onClick={() => void answer('allow_once')}
            className={`px-3 py-1.5 text-xs rounded font-medium ${
              isDanger
                ? 'bg-danger/15 text-danger border border-danger/50 hover:bg-danger/25'
                : 'bg-ok/15 text-ok border border-ok/50 hover:bg-ok/25'
            } disabled:opacity-50 disabled:cursor-not-allowed`}
          >
            {isDanger ? t('permission.allowDanger') : t('permission.allowOnceEnter')}
          </button>
        </div>
      </div>
    </FloatingSurfaceHost>
  );
}

// ---- KX-I-05 PermissionBatchView ----
//
// 同 session 连续 ≥ 2 条非 danger 请求合并显示。提供 batch 顶部操作（Allow all/Deny all）
// + 每条独立按钮兜底。Esc=Deny all, Enter=Allow all once。danger 永远不入 batch。

interface PermissionBatchViewProps {
  readonly items: readonly PermissionRequestPayload[];
  readonly dequeue: (reqId: string) => void;
}

function PermissionBatchView({ items, dequeue }: PermissionBatchViewProps): JSX.Element {
  const { t } = useI18n();
  // 用 items 里 highest risk 决定外层 badge 颜色
  const maxRisk: PermissionRisk = useMemo(() => {
    const order: PermissionRisk[] = ['low', 'medium', 'high'];
    let m: PermissionRisk = 'low';
    for (const it of items) {
      if (order.indexOf(it.risk) > order.indexOf(m)) m = it.risk;
    }
    return m;
  }, [items]);
  const style = RISK_STYLE[maxRisk];
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const allowAllButtonRef = useRef<HTMLButtonElement | null>(null);

  const answerOne = useCallback(
    async (reqId: string, decision: PermissionDecision): Promise<void> => {
      if (!window.kodaxSpace) return;
      const r = await window.kodaxSpace.invoke('permission.answer', { reqId, decision });
      if (!r.ok) {
        setErr(`${r.error?.code ?? 'ERR'}: ${r.error?.message ?? 'unknown'}`);
        return;
      }
      dequeue(reqId);
    },
    [dequeue],
  );

  const answerAll = useCallback(
    async (decision: PermissionDecision): Promise<void> => {
      if (busy) return;
      setBusy(true);
      setErr(null);
      // 并发发 N 条 — main 端 broker 各自 resolve，dequeue 各自更新。
      // review HIGH 修：try/finally 保证 busy 一定回归 false。
      // 否则 IPC 层 throw（channel closed / preload 缺失）会让 Promise.all reject，
      // setBusy(false) 永远不跑，整个 batch modal 卡死直到 session 结束。
      try {
        const reqIds = items.map((i) => i.reqId);
        await Promise.all(reqIds.map((id) => answerOne(id, decision)));
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
    },
    [busy, items, answerOne],
  );

  return (
    <FloatingSurfaceHost
      surface={PERMISSION_BATCH_SURFACE}
      role="dialog"
      ariaLabelledBy="permission-batch-title"
      onEscapeKey={() => {
        void answerAll('deny');
      }}
      onEnterKey={() => {
        if (!busy) void answerAll('allow_once');
      }}
      initialFocusRef={allowAllButtonRef}
      contentClassName="absolute inset-0 flex items-center justify-center pointer-events-none"
    >
      <div
        className={`pointer-events-auto w-[620px] max-w-[95vw] max-h-[90vh] flex flex-col bg-surface-2 border ${style.border} rounded-lg shadow-xl`}
      >
        <div className="px-5 py-3 border-b border-border-default flex items-center gap-3 flex-shrink-0">
          <span
            className={`px-2 py-0.5 text-[11px] font-mono font-semibold rounded ${style.badge}`}
          >
            {t(RISK_LABEL_KEY[maxRisk])}
          </span>
          <h2 id="permission-batch-title" className="text-sm font-semibold text-fg-primary">
            {t('permission.batchTitle', { count: items.length })}
          </h2>
        </div>

        <div className="px-5 py-3 flex-1 overflow-y-auto space-y-2">
          {items.map((it) => {
            const command = permissionCommand(it.toolCall.input);
            const target = permissionTarget(it.toolCall.input);
            return (
              <div
                key={it.reqId}
                className="flex items-start gap-2 border border-border-default rounded px-3 py-2 hover:bg-hover-bg"
              >
                <span
                  className={`mt-0.5 px-1.5 py-0.5 text-[9px] font-mono font-semibold rounded ${RISK_STYLE[it.risk].badge}`}
                  title={t('permission.riskTitle', { risk: t(RISK_LABEL_KEY[it.risk]) })}
                >
                  {t(RISK_LABEL_KEY[it.risk])}
                </span>
                <span className="mt-0.5 text-xs font-mono text-warn flex-shrink-0">
                  {it.toolCall.toolName}
                </span>
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="text-[10px] font-mono uppercase text-fg-muted break-all">
                    {t(OPERATION_LABEL_KEY[it.toolCall.operation ?? 'unknown'])}
                    {it.toolCall.executionCwd ? ` · ${it.toolCall.executionCwd}` : ''}
                  </div>
                  <div className="text-xs text-fg-muted break-words" title={it.reason}>
                    {truncate(it.reason, 200)}
                  </div>
                  {command && (
                    <code className="block text-[11px] text-fg-primary whitespace-pre-wrap break-all">
                      {command}
                    </code>
                  )}
                  {target && !command && (
                    <code className="block text-[11px] text-fg-primary break-all">{target}</code>
                  )}
                </div>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void answerOne(it.reqId, 'deny')}
                  className="px-2 py-0.5 text-xs rounded dark:bg-surface-3 dark:text-fg-primary dark:hover:bg-hover-bg bg-surface-3 text-fg-secondary hover:bg-hover-bg disabled:opacity-50"
                >
                  {t('permission.deny')}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void answerOne(it.reqId, 'allow_once')}
                  className="px-2 py-0.5 text-xs rounded font-medium bg-ok/15 text-ok border border-ok/50 hover:bg-ok/25 disabled:opacity-50"
                >
                  {t('permission.allow')}
                </button>
              </div>
            );
          })}
          {err && <div className="text-xs text-danger font-mono">{err}</div>}
        </div>

        <div className="px-5 py-3 border-t border-border-default dark:bg-transparent bg-surface flex items-center justify-end gap-2 flex-shrink-0">
          <button
            type="button"
            disabled={busy}
            onClick={() => void answerAll('deny')}
            className="px-3 py-1.5 text-xs rounded dark:bg-surface-3 dark:text-fg-primary dark:hover:bg-hover-bg bg-surface-3 text-fg-secondary hover:bg-hover-bg disabled:opacity-50"
          >
            {t('permission.denyAll', { count: items.length })}{' '}
            <span className="ml-1 text-fg-muted">Esc</span>
          </button>
          <button
            ref={allowAllButtonRef}
            type="button"
            disabled={busy}
            onClick={() => void answerAll('allow_once')}
            className="px-3 py-1.5 text-xs rounded font-medium bg-ok/15 text-ok border border-ok/50 hover:bg-ok/25 disabled:opacity-50"
          >
            {t('permission.allowAllOnce', { count: items.length })}{' '}
            <span className="ml-1 text-ok/70">Enter</span>
          </button>
        </div>
      </div>
    </FloatingSurfaceHost>
  );
}
