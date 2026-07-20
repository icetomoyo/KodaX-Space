// AmaWorkStrip — P5
//
// Compact 一行指示器，AMA agent 形态时显示当前活跃 worker / harness / 子任务计数。
// 数据来源：managed_task_status 事件（appStore.managedTaskStatusBySession）。
//
// 显示规则：
//   - 仅 session.agentMode === 'ama' 时渲染
//   - 状态字段都缺时静默隐藏（避免空 strip 占位）
//   - 部分字段缺时只显示已有的，无 placeholder dash
//
// 视觉：font-mono、zinc-500、紫色 ✦ 前缀。
//
// #10 fix: 之前直接显示裸 harnessProfile 枚举值（"H1_EXECUTE_EVAL"），整行没有 title
// tooltip（截断/等宽字体下不好读），budget-approval 提示只是纯文本、点不动。这里补人类
// 可读映射 + 完整 tooltip + 让 budget-approval 段可点击跳 TasksPanel（同 Section ⤢ 用的
// requestShellPopout）。

import { Sparkles } from 'lucide-react';
import { useAppStore } from '../store/appStore.js';
import { requestShellPopout } from './popoutControl.js';
import { useI18n } from '../i18n/I18nProvider.js';

// SDK KodaXHarnessProfile 已知字面量的人类可读标签；未知/自定义 profile 原样透传兜底
// （managedTaskStatusSchema.harnessProfile 是自由字符串，SDK 允许 consumer 扩展）。
const HARNESS_PROFILE_LABELS: Readonly<Record<string, string>> = {
  H0_DIRECT: 'Direct',
  H1_EXECUTE_EVAL: 'Iterate',
  H2_PLAN_EXECUTE_EVAL: 'Plan → Execute → Eval',
  PLANNED: 'Planned',
};

function harnessProfileLabel(profile: string): string {
  return HARNESS_PROFILE_LABELS[profile] ?? profile;
}

export function AmaWorkStrip(): JSX.Element | null {
  const { t } = useI18n();
  const currentSessionId = useAppStore((s) => s.currentSessionId);
  const sessions = useAppStore((s) => s.sessions);
  const status = useAppStore((s) =>
    currentSessionId ? s.managedTaskStatusBySession[currentSessionId] : undefined,
  );

  const session = sessions.find((x) => x.sessionId === currentSessionId);
  if (!session || session.agentMode !== 'ama') return null;
  if (!status) return null;

  const parts: string[] = [];
  if (status.activeWorkerTitle) {
    parts.push(status.activeWorkerTitle);
  }
  if (status.harnessProfile) {
    parts.push(harnessProfileLabel(status.harnessProfile));
  }
  if (status.currentRound !== undefined) {
    const round = status.maxRounds
      ? t('amaWork.roundOf', { round: status.currentRound, max: status.maxRounds })
      : t('amaWork.round', { round: status.currentRound });
    parts.push(round);
  }
  if (status.childFanoutCount !== undefined && status.childFanoutCount > 0) {
    const label = status.childFanoutClass
      ? `${status.childFanoutCount} ${status.childFanoutClass}`
      : t('amaWork.active', { count: status.childFanoutCount });
    parts.push(label);
  }
  if (status.idleWaiting) {
    parts.push(t('amaWork.idlePending', { count: status.idleWaitingPendingCount ?? 0 }));
  }

  if (parts.length === 0 && !status.budgetApprovalRequired) return null;

  const modeLabel = session.agentMode.toUpperCase();
  const tooltip = [
    modeLabel,
    ...parts,
    ...(status.budgetApprovalRequired ? [t('amaWork.budgetApprovalNeeded')] : []),
  ].join(' · ');

  return (
    <div
      className="px-3 text-[11px] font-mono text-fg-muted flex items-center gap-1.5 select-none"
      role="status"
      aria-label={t('amaWork.aria')}
      title={tooltip}
    >
      <Sparkles className="w-3 h-3 text-thinking flex-shrink-0" strokeWidth={2} aria-hidden />
      <span className="text-fg-muted">{modeLabel}</span>
      {parts.length > 0 && (
        <>
          <span className="text-fg-faint">·</span>
          <span className="truncate">{parts.join(' · ')}</span>
        </>
      )}
      {status.budgetApprovalRequired && (
        <button
          type="button"
          onClick={() => requestShellPopout('tasks')}
          className="text-warn hover:underline flex-shrink-0"
          title={t('amaWork.budgetApprovalOpen')}
        >
          {t('amaWork.budgetApprovalShort')} ⚠
        </button>
      )}
    </div>
  );
}
