// AgentModeSelector — KodaX agent 形态切换
//
// KodaX 0.7.72 起的两种工作形态：
//   - AMA (默认) — Adaptive Multi-Agent: scout/planner/generator/evaluator 多角色协作，
//     更聪明，对复杂任务效果好；token 消耗高，需要 provider 并发余量
//   - SA — Single Agent: 单 agent loop，结构最简单，token + 并发都省。接口并发受限
//     (rate limit / 多用户共享 quota / fallback to cheaper provider) 时显式降级
//
// UI 行为：
//   - 紧贴 ModeSelector 旁的小 chip：显示 "AMA" / "SA"
//   - 点开 popup 列两个选项 + 说明
//   - 切换不重启 session — 下一条 prompt 走新形态
//   - 无 session 时存进 pendingAgentMode；session.create 时入参传给 main
//
// 默认全 ama；用户主动选 sa 才走 fallback。

import { useEffect, useState } from 'react';
import type { AgentMode } from '@kodax-space/space-ipc-schema';
import { useAppStore } from '../store/appStore.js';
import { pushToast } from '../store/toastStore.js';
import { useI18n } from '../i18n/I18nProvider.js';
import type { MessageKey } from '../i18n/messages.js';

// AMA/SA 是协议层面的形态代号（同 provider id / harness profile 一样不做翻译）；
// 完整名称 + 说明才是需要按 locale 切换的用户提示文案（#14 修复：之前 DESCRIPTIONS 混着
// 中英文，跟当前语言设置无关，导致英文界面下弹出中文 tooltip）。
const LABELS: Record<AgentMode, string> = {
  ama: 'AMA',
  sa: 'SA',
};

const FULL_NAME_KEYS: Record<AgentMode, MessageKey> = {
  ama: 'agentMode.fullName.ama',
  sa: 'agentMode.fullName.sa',
};

const DESCRIPTION_KEYS: Record<AgentMode, MessageKey> = {
  ama: 'agentMode.description.ama',
  sa: 'agentMode.description.sa',
};

const OPTIONS: readonly AgentMode[] = ['ama', 'sa'];

function nextAgentMode(current: AgentMode): AgentMode {
  const idx = OPTIONS.indexOf(current);
  return OPTIONS[(idx + 1) % OPTIONS.length] ?? 'ama';
}

export function AgentModeSelector(): JSX.Element {
  const { t } = useI18n();
  const sessions = useAppStore((s) => s.sessions);
  const currentSessionId = useAppStore((s) => s.currentSessionId);
  const upsertSession = useAppStore((s) => s.upsertSession);
  const runtimeDefaults = useAppStore((s) => s.runtimeDefaults);
  const pendingAgentMode = useAppStore((s) => s.pendingAgentMode);
  const setPendingAgentMode = useAppStore((s) => s.setPendingAgentMode);
  const setRuntimeDefaults = useAppStore((s) => s.setRuntimeDefaults);

  const session = sessions.find((x) => x.sessionId === currentSessionId);
  const current: AgentMode =
    session?.agentMode ?? pendingAgentMode ?? runtimeDefaults.agentMode ?? 'ama';

  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  async function pick(mode: AgentMode): Promise<void> {
    if (busy || mode === current) {
      setOpen(false);
      return;
    }
    setBusy(true);
    // Always update pending as the user's next-session preference.
    setPendingAgentMode(mode);
    try {
      if (session && window.kodaxSpace) {
        upsertSession({ ...session, agentMode: mode });
        const r = await window.kodaxSpace.invoke('session.setAgentMode', {
          sessionId: session.sessionId,
          agentMode: mode,
        });
        if (!r.ok) {
          upsertSession({ ...session, agentMode: current });
        }
      }
      if (window.kodaxSpace) {
        const r = await window.kodaxSpace.invoke('settings.setRuntimeDefaults', {
          runtimeDefaults: { agentMode: mode },
        });
        if (!r.ok) pushToast(r.error?.message ?? t('modelPicker.saveDefaultsFailed'), 'error');
        else setRuntimeDefaults(r.data.runtimeDefaults ?? {});
      }
    } catch (err) {
      pushToast(err instanceof Error ? err.message : t('modelPicker.saveDefaultsFailed'), 'error');
    } finally {
      setBusy(false);
      setOpen(false);
    }
  }

  // P3: Alt+M cycles AMA / SA.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.altKey && !e.ctrlKey && !e.shiftKey && (e.key === 'm' || e.key === 'M')) {
        e.preventDefault();
        void pick(nextAgentMode(current));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current, busy]);

  // 无 session 时选中的模式就是即将创建会话的模式，无需再标注“(next)”。
  const labelText = LABELS[current];

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="text-xs px-2 py-0.5 rounded bg-surface-2 border border-border-default text-fg-secondary hover:bg-hover-bg flex items-center gap-1"
        title={t('agentMode.buttonTitle', { name: t(FULL_NAME_KEYS[current]) })}
      >
        <span>{labelText}</span>
        <span className="text-fg-muted" aria-hidden>
          +
        </span>
      </button>

      {open && (
        <div
          className="absolute left-0 bottom-full mb-1 w-72 bg-surface-4 border border-border-default rounded-lg shadow-xl py-1 text-xs z-50"
          onMouseLeave={() => setOpen(false)}
        >
          <div className="px-3 py-1 text-fg-muted text-[11px] uppercase tracking-wider">
            {t('agentMode.popupTitle')}
          </div>
          {OPTIONS.map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => void pick(m)}
              className={`w-full text-left px-3 py-1.5 hover:bg-hover-bg ${
                current === m ? 'text-fg-primary' : 'text-fg-secondary'
              }`}
              title={t(DESCRIPTION_KEYS[m])}
            >
              <div className="flex items-center gap-2">
                <span className="font-mono w-12">{LABELS[m]}</span>
                <span className="flex-1 text-xs">{t(FULL_NAME_KEYS[m])}</span>
                {current === m && (
                  <span className="text-ok" aria-hidden>
                    ✓
                  </span>
                )}
              </div>
              <div className="ml-12 text-[11px] text-fg-muted leading-tight">
                {t(DESCRIPTION_KEYS[m])}
              </div>
            </button>
          ))}
          <div className="border-t border-border-default mt-1 pt-1 px-3 py-1 text-[11px] text-fg-muted leading-tight">
            {t('agentMode.footer')}
          </div>
        </div>
      )}
    </div>
  );
}
