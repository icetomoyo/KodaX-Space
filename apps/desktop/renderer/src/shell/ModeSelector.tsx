// ModeSelector — FEATURE_029 canonical 3 mode + auto engine 子档
//
// 对齐 KodaX REPL (ADR-005)：
//
//   ┌──────────────────────────────┐
//   │ Mode                Ctrl+M   │
//   │   Plan                 1     │
//   │   Accept edits  ✓      2     │
//   │   Auto                 3     │
//   │     ┌─ engine ──────────┐    │
//   │     │ ● llm             │    │  (auto 选中时显示子菜单)
//   │     │ ○ rules           │    │
//   │     └───────────────────┘    │
//   └──────────────────────────────┘
//
// 切 mode 立即生效（main 端 broker 下次 tool call 走新短路）。
// 切 engine 同上 — 即便当前 mode 不是 auto 也接受（下次切到 auto 时按新 engine bootstrap guardrail）。
// Shift-Tab / Ctrl+M 循环 3 档；数字键 1/2/3 直接切。

import { useEffect, useRef, useState } from 'react';
import type { AutoModeEngine, PermissionMode } from '@kodax-space/space-ipc-schema';
import { useAppStore } from '../store/appStore.js';
import { pushToast } from '../store/toastStore.js';
import { useI18n } from '../i18n/I18nProvider.js';
import type { MessageKey } from '../i18n/messages.js';
import { useIsStreaming } from './ActivitySpinner.js';

// #14 fix: MODE_DESCRIPTIONS / ENGINE_DESCRIPTIONS / 底部说明之前硬编码中文，跟当前语言
// 设置无关——英文界面下弹出中文 tooltip。llm/rules 是引擎配置项标识符（同 ~/.kodax/
// auto-rules.jsonc 里的字面量），保持原样不翻译。
const MODE_LABEL_KEYS: Record<PermissionMode, MessageKey> = {
  plan: 'mode.label.plan',
  'accept-edits': 'mode.label.acceptEdits',
  auto: 'mode.label.auto',
};

const MODE_DESCRIPTION_KEYS: Record<PermissionMode, MessageKey> = {
  plan: 'mode.description.plan',
  'accept-edits': 'mode.description.acceptEdits',
  auto: 'mode.description.auto',
};

const MODE_ORDER: readonly PermissionMode[] = ['plan', 'accept-edits', 'auto'];

const ENGINE_LABELS: Record<AutoModeEngine, string> = {
  llm: 'llm',
  rules: 'rules',
};

const ENGINE_DESCRIPTION_KEYS: Record<AutoModeEngine, MessageKey> = {
  llm: 'mode.engineDescription.llm',
  rules: 'mode.engineDescription.rules',
};

interface OptimisticMutationState<T> {
  acknowledged: T;
  intended: T;
  latestSequence: number;
  pending: number;
  tail: Promise<void>;
}

function mutationStateFor<T>(
  states: Map<string, OptimisticMutationState<T>>,
  key: string,
  authoritative: T,
): OptimisticMutationState<T> {
  const existing = states.get(key);
  if (!existing) {
    const created = {
      acknowledged: authoritative,
      intended: authoritative,
      latestSequence: 0,
      pending: 0,
      tail: Promise.resolve(),
    };
    states.set(key, created);
    return created;
  }
  // Store updates received while no local mutation is pending are authoritative
  // (for example a Rules engine explicitly selected by another Runtime client).
  if (existing.pending === 0 && existing.intended !== authoritative) {
    existing.acknowledged = authoritative;
    existing.intended = authoritative;
  }
  return existing;
}

export function ModeSelector(): JSX.Element {
  const { t } = useI18n();
  const sessions = useAppStore((s) => s.sessions);
  const currentSessionId = useAppStore((s) => s.currentSessionId);
  const upsertSession = useAppStore((s) => s.upsertSession);
  const kodaxDefaults = useAppStore((s) => s.kodaxDefaults);
  const runtimeDefaults = useAppStore((s) => s.runtimeDefaults);
  const pendingPermissionMode = useAppStore((s) => s.pendingPermissionMode);
  const pendingAutoModeEngine = useAppStore((s) => s.pendingAutoModeEngine);
  const setPendingPermissionMode = useAppStore((s) => s.setPendingPermissionMode);
  const setPendingAutoModeEngine = useAppStore((s) => s.setPendingAutoModeEngine);
  const setRuntimeDefaults = useAppStore((s) => s.setRuntimeDefaults);
  const session = sessions.find((x) => x.sessionId === currentSessionId);

  const [open, setOpen] = useState(false);
  const modeMutations = useRef(new Map<string, OptimisticMutationState<PermissionMode>>());
  const engineMutations = useRef(new Map<string, OptimisticMutationState<AutoModeEngine>>());
  // v0.1.4：spinner 修复 —— "切 auto 时 session 还在跑"的提示从 main 端 push
  // session_error 改成 renderer 端 pushToast，避免 ActivitySpinner 误判 session 已结束
  const isStreaming = useIsStreaming();

  // 有 session 走 session.permissionMode；无 session 走 pendingPermissionMode；fallback 'accept-edits'
  const current: PermissionMode =
    session?.permissionMode ??
    pendingPermissionMode ??
    runtimeDefaults.permissionMode ??
    kodaxDefaults?.permissionMode ??
    'accept-edits';
  const engine: AutoModeEngine =
    session?.autoModeEngine ?? pendingAutoModeEngine ?? runtimeDefaults.autoModeEngine ?? 'llm';
  const mutationKey = session?.sessionId ?? '__next-session__';
  mutationStateFor(modeMutations.current, mutationKey, current);
  mutationStateFor(engineMutations.current, mutationKey, engine);

  // Ctrl+M 切换打开；数字键 1/2/3 切 mode；L/R 切 engine（auto 时）
  // Shift+Tab 循环 mode（对齐 KodaX TUI）。
  // 不再 gate 在 session 上——无 session 时也能 toggle pending mode
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.ctrlKey && !e.shiftKey && !e.altKey && !e.metaKey && e.key.toLowerCase() === 'm') {
        e.preventDefault();
        setOpen((v) => !v);
        return;
      }
      // P3: Shift+Tab 在任意位置循环 permission mode（含 input 框 — 用户切完继续打字）
      if (e.shiftKey && e.key === 'Tab') {
        e.preventDefault();
        // The effect closure can still hold the previous render's `current` when
        // multiple key events arrive in one browser task. The mutation state was
        // initialized during render and is updated synchronously before IPC, so
        // read it directly here instead of reconciling against that stale value.
        const activeMutation =
          modeMutations.current.get(mutationKey) ??
          mutationStateFor(modeMutations.current, mutationKey, current);
        const idx = MODE_ORDER.indexOf(activeMutation.intended);
        const next = MODE_ORDER[(idx + 1) % MODE_ORDER.length];
        void setMode(next);
        return;
      }
      if (open && !e.ctrlKey && !e.altKey && !e.shiftKey && !e.metaKey) {
        const idx = ['1', '2', '3'].indexOf(e.key);
        if (idx >= 0) {
          e.preventDefault();
          void setMode(MODE_ORDER[idx]);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, open, current, mutationKey]);

  async function persistRuntimeDefaults(runtimeDefaults: {
    readonly permissionMode?: PermissionMode;
    readonly autoModeEngine?: AutoModeEngine;
  }): Promise<void> {
    if (!window.kodaxSpace) return;
    try {
      const r = await window.kodaxSpace.invoke('settings.setRuntimeDefaults', { runtimeDefaults });
      if (!r.ok) {
        pushToast(r.error?.message ?? t('modelPicker.saveDefaultsFailed'), 'error');
      } else {
        setRuntimeDefaults(r.data.runtimeDefaults ?? {});
      }
    } catch (err) {
      pushToast(err instanceof Error ? err.message : t('modelPicker.saveDefaultsFailed'), 'error');
    }
  }

  async function setMode(mode: PermissionMode): Promise<void> {
    const state =
      modeMutations.current.get(mutationKey) ??
      mutationStateFor(modeMutations.current, mutationKey, current);
    if (mode === state.intended) return;
    state.intended = mode;
    state.latestSequence += 1;
    state.pending += 1;
    const sequence = state.latestSequence;
    const enteredAuto = mode === 'auto' && state.acknowledged !== 'auto';
    if (mode !== 'auto') setOpen(false);
    // Always update pending as the user's next-session preference.
    setPendingPermissionMode(mode);
    if (session) {
      const latestSession = useAppStore
        .getState()
        .sessions.find((candidate) => candidate.sessionId === session.sessionId);
      if (latestSession) upsertSession({ ...latestSession, permissionMode: mode });
    }
    // Keep the next-Session preference in the same user-action order. The main
    // settings store serializes writes, so a later action cannot be overwritten
    // by an earlier response.
    void persistRuntimeDefaults({ permissionMode: mode });
    const operation = state.tail.then(async () => {
      try {
        if (session && window.kodaxSpace) {
          const r = await window.kodaxSpace.invoke('session.setPermissionMode', {
            sessionId: session.sessionId,
            mode,
          });
          if (!r.ok) {
            if (sequence === state.latestSequence) {
              state.intended = state.acknowledged;
              const latestSession = useAppStore
                .getState()
                .sessions.find((candidate) => candidate.sessionId === session.sessionId);
              if (latestSession) {
                upsertSession({ ...latestSession, permissionMode: state.acknowledged });
              }
            }
            pushToast(r.error?.message ?? t('mode.sessionModeUpdateFailed'), 'error');
          } else {
            state.acknowledged = mode;
          }
          if (r.ok && enteredAuto && isStreaming) {
            // Keep this as a toast instead of a session_error event; the current run
            // continues under its existing permission flow until the next send.
            pushToast(t('mode.autoGuardrailNextSend'), 'info', 6000);
          }
        } else {
          state.acknowledged = mode;
        }
      } catch (error) {
        if (sequence === state.latestSequence) {
          state.intended = state.acknowledged;
          const latestSession = useAppStore
            .getState()
            .sessions.find((candidate) => candidate.sessionId === session?.sessionId);
          if (latestSession) {
            upsertSession({ ...latestSession, permissionMode: state.acknowledged });
          }
        }
        pushToast(
          error instanceof Error ? error.message : t('mode.sessionModeUpdateFailed'),
          'error',
        );
      } finally {
        state.pending = Math.max(0, state.pending - 1);
      }
    });
    // Session mutations must reach Runtime in click/key order. Without this
    // queue, an older IPC response could finish last and silently overwrite the
    // user's newest rapid Shift+Tab choice.
    state.tail = operation;
    await operation;
  }

  async function setEngine(next: AutoModeEngine): Promise<void> {
    const state =
      engineMutations.current.get(mutationKey) ??
      mutationStateFor(engineMutations.current, mutationKey, engine);
    if (next === state.intended) return;
    state.intended = next;
    state.latestSequence += 1;
    state.pending += 1;
    const sequence = state.latestSequence;
    setPendingAutoModeEngine(next);
    if (session) {
      const latestSession = useAppStore
        .getState()
        .sessions.find((candidate) => candidate.sessionId === session.sessionId);
      if (latestSession) upsertSession({ ...latestSession, autoModeEngine: next });
    }
    void persistRuntimeDefaults({ autoModeEngine: next });
    const operation = state.tail.then(async () => {
      try {
        if (session && window.kodaxSpace) {
          const r = await window.kodaxSpace.invoke('session.setAutoModeEngine', {
            sessionId: session.sessionId,
            engine: next,
          });
          if (!r.ok) {
            if (sequence === state.latestSequence) {
              state.intended = state.acknowledged;
              const latestSession = useAppStore
                .getState()
                .sessions.find((candidate) => candidate.sessionId === session.sessionId);
              if (latestSession) {
                upsertSession({ ...latestSession, autoModeEngine: state.acknowledged });
              }
            }
            pushToast(r.error?.message ?? t('mode.autoEngineUpdateFailed'), 'error');
          } else {
            state.acknowledged = next;
          }
        } else {
          state.acknowledged = next;
        }
      } catch (error) {
        if (sequence === state.latestSequence) {
          state.intended = state.acknowledged;
          const latestSession = useAppStore
            .getState()
            .sessions.find((candidate) => candidate.sessionId === session?.sessionId);
          if (latestSession) {
            upsertSession({ ...latestSession, autoModeEngine: state.acknowledged });
          }
        }
        pushToast(
          error instanceof Error ? error.message : t('mode.autoEngineUpdateFailed'),
          'error',
        );
      } finally {
        state.pending = Math.max(0, state.pending - 1);
      }
    });
    state.tail = operation;
    await operation;
  }

  const baseLabel =
    current === 'auto'
      ? `${t('mode.label.auto')}[${ENGINE_LABELS[engine].toUpperCase()}]`
      : t(MODE_LABEL_KEYS[current]);
  // 无 session 时这个选择会直接用于即将创建的会话，所以仍显示普通模式名；
  // 附加“(next) / 下次”会让用户误以为它不会对即将发送的首条消息生效。
  const statusLabel = baseLabel;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="text-xs px-2 py-0.5 rounded bg-surface-2 border border-border-default text-fg-secondary hover:bg-hover-bg flex items-center gap-1"
        title={t('mode.buttonTitle', { status: statusLabel })}
      >
        <span>{statusLabel}</span>
        <span className="text-fg-muted" aria-hidden>
          +
        </span>
      </button>

      {open && (
        <div
          className="absolute left-0 bottom-full mb-1 w-64 bg-surface-4 border border-border-default rounded-lg shadow-xl py-1 text-xs z-50"
          onMouseLeave={() => setOpen(false)}
        >
          <div className="px-3 py-1 flex justify-between items-center text-fg-muted text-[11px] uppercase tracking-wider">
            <span>{t('mode.header')}</span>
            <span className="font-mono text-fg-muted flex items-center gap-1">
              <kbd className="px-1 border border-border-strong rounded">Ctrl</kbd>
              <kbd className="px-1 border border-border-strong rounded">M</kbd>
            </span>
          </div>
          {MODE_ORDER.map((m, idx) => (
            <button
              key={m}
              type="button"
              onClick={() => void setMode(m)}
              className={`w-full text-left px-3 py-1 hover:bg-hover-bg flex items-center gap-2 ${
                current === m ? 'text-fg-primary' : 'text-fg-secondary'
              }`}
              title={t(MODE_DESCRIPTION_KEYS[m])}
            >
              <span className="flex-1">{t(MODE_LABEL_KEYS[m])}</span>
              {current === m && (
                <span className="text-ok" aria-hidden>
                  ✓
                </span>
              )}
              <span className="text-fg-muted text-[11px] font-mono w-3 text-right">{idx + 1}</span>
            </button>
          ))}

          {current === 'auto' && (
            <div className="border-t border-border-default mt-1 pt-1">
              <div className="px-3 py-1 text-fg-muted text-[11px] uppercase tracking-wider">
                {t('mode.autoEngineHeader')}
              </div>
              {(['llm', 'rules'] as const).map((eng) => (
                <button
                  key={eng}
                  type="button"
                  onClick={() => void setEngine(eng)}
                  className={`w-full text-left px-3 py-1 hover:bg-hover-bg flex items-center gap-2 ${
                    engine === eng ? 'text-fg-primary' : 'text-fg-secondary'
                  }`}
                  title={t(ENGINE_DESCRIPTION_KEYS[eng])}
                >
                  <span className="flex-1">{ENGINE_LABELS[eng]}</span>
                  {engine === eng && (
                    <span className="text-ok" aria-hidden>
                      ✓
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}

          {/* 底部说明：Space Auto = KodaX guardrail；Claude Desktop "Bypass" 没有 1:1 对应 */}
          <div className="border-t border-border-default mt-1 pt-1 px-3 py-1 text-[11px] text-fg-muted leading-tight">
            {t('mode.footer')}
          </div>
        </div>
      )}
    </div>
  );
}
