import { useMemo } from 'react';
import {
  Activity,
  AlertTriangle,
  Bot,
  CheckSquare,
  CircleDot,
  GitCompare,
  Workflow,
} from 'lucide-react';
import type { TaskDockRunViewModel } from './taskDockProjection.js';
import { requestTaskDockFocus, type TaskDockSectionId } from './taskDockControl.js';
import { useI18n } from '../i18n/I18nProvider.js';
import type { MessageKey } from '../i18n/messages.js';
import { useTaskDockRunView } from './useTaskDockRunView.js';

interface SummaryChip {
  readonly key: string;
  readonly label: string;
  readonly value?: string;
  readonly section: TaskDockSectionId;
  readonly icon: JSX.Element;
}

export function PinnedTaskSummary(): JSX.Element | null {
  const { t } = useI18n();
  const { view, hasProject, hasSession } = useTaskDockRunView();

  const chips = useMemo(() => buildSummaryChips(view, t), [view, t]);
  const primaryTarget = view.primaryTarget ?? 'run';
  const primaryTargetLabel = sectionLabel(primaryTarget, t);
  const shouldRender =
    hasProject || hasSession || view.mode === 'attention' || view.mode === 'running';
  if (!shouldRender) return null;

  return (
    <div
      className="ix-zone flex min-h-10 flex-shrink-0 items-center gap-2 border-b border-border-default bg-surface px-3 py-1.5 text-[12px]"
      data-testid="pinned-task-summary"
    >
      <button
        type="button"
        onClick={() => requestTaskDockFocus(primaryTarget)}
        className={`group grid min-w-0 flex-1 grid-cols-[18px_minmax(0,1fr)] items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-hover-bg ${summaryToneClass(
          view.severity,
        )}`}
        title={summaryTitle(view)}
        aria-label={t('pinned.openTarget', { target: primaryTargetLabel })}
        data-testid="pinned-summary-primary"
      >
        <span className="flex h-4 w-4 items-center justify-center">
          <CircleDot className={`h-3.5 w-3.5 ${summaryIconClass(view.severity)}`} strokeWidth={2} />
        </span>
        <span className="flex min-w-0 items-baseline gap-2">
          <span className="truncate font-medium text-fg-primary">{view.headline}</span>
          {view.detail && (
            <span className="hidden min-w-0 truncate text-fg-muted md:inline">{view.detail}</span>
          )}
        </span>
      </button>

      {chips.length > 0 && (
        <div className="flex flex-shrink-0 items-center gap-1 overflow-hidden">
          {chips.map((chip) => (
            <SummaryChipButton key={chip.key} chip={chip} />
          ))}
        </div>
      )}
    </div>
  );
}

function SummaryChipButton({ chip }: { readonly chip: SummaryChip }): JSX.Element {
  const { t } = useI18n();
  return (
    <button
      type="button"
      onClick={() => requestTaskDockFocus(chip.section)}
      className={`inline-flex h-7 items-center gap-1.5 rounded-md border border-border-default bg-surface-2 px-2 text-fg-secondary transition-colors hover:bg-hover-bg hover:text-fg-primary ${
        chip.key === 'agents' ? 'max-w-[190px]' : 'max-w-[120px]'
      }`}
      title={t('pinned.openChip', { label: chip.label })}
      aria-label={t('pinned.openChip', { label: chip.label })}
      data-testid={`pinned-summary-${chip.key}`}
    >
      <span className="flex h-3.5 w-3.5 flex-shrink-0 items-center justify-center text-fg-muted">
        {chip.icon}
      </span>
      <span className="truncate">{chip.label}</span>
      {chip.value && <span className="font-mono tabular-nums text-fg-primary">{chip.value}</span>}
    </button>
  );
}

type Translate = (key: MessageKey, vars?: Record<string, string | number>) => string;

function buildSummaryChips(view: TaskDockRunViewModel, t: Translate): readonly SummaryChip[] {
  const chips = view.metrics.map((metric): SummaryChip => {
    const section = sectionForMetric(metric.key);
    const key = metric.key;
    return {
      key,
      label: metric.label,
      value: metric.value,
      section,
      icon: iconForSection(section),
    };
  });

  if (view.mode === 'completed' && !chips.some((chip) => chip.section === 'changes')) {
    return [
      ...chips,
      {
        key: 'changes',
        label: t('pinned.review'),
        section: 'changes',
        icon: <GitCompare className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden />,
      },
    ];
  }
  if (view.mode === 'attention' && view.attentionKind) {
    return [
      {
        key: 'attention',
        label: attentionLabel(view.attentionKind, t),
        section: 'run',
        icon: <AlertTriangle className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden />,
      },
      ...chips,
    ];
  }
  return chips;
}

function sectionForMetric(key: TaskDockRunViewModel['metrics'][number]['key']): TaskDockSectionId {
  switch (key) {
    case 'plan':
      return 'plan';
    case 'agents':
      return 'agents';
    case 'workflow':
      return 'workflow';
    case 'budget':
      return 'agents';
  }
}

function iconForSection(section: TaskDockSectionId): JSX.Element {
  switch (section) {
    case 'plan':
      return <CheckSquare className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden />;
    case 'agents':
      return <Bot className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden />;
    case 'workflow':
      return <Workflow className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden />;
    case 'changes':
      return <GitCompare className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden />;
    default:
      return <Activity className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden />;
  }
}

function attentionLabel(
  kind: NonNullable<TaskDockRunViewModel['attentionKind']>,
  t: Translate,
): string {
  switch (kind) {
    case 'permission':
      return t('pinned.attention.permission');
    case 'ask_user':
      return t('pinned.attention.answer');
    case 'budget':
      return t('pinned.attention.budget');
    case 'error':
      return t('pinned.attention.error');
    case 'blocked':
      return t('pinned.attention.blocked');
  }
}

function sectionLabel(section: TaskDockSectionId, t: Translate): string {
  const key: Record<TaskDockSectionId, MessageKey> = {
    run: 'taskDock.section.run',
    plan: 'taskDock.section.plan',
    workflow: 'taskDock.section.workflow',
    agents: 'taskDock.section.agents',
    changes: 'taskDock.section.changes',
    sources: 'taskDock.section.sources',
    artifacts: 'taskDock.section.artifacts',
    context: 'taskDock.section.context',
  };
  return t(key[section]);
}

function summaryTitle(view: TaskDockRunViewModel): string {
  return view.detail ? `${view.headline} - ${view.detail}` : view.headline;
}

function summaryToneClass(severity: TaskDockRunViewModel['severity']): string {
  switch (severity) {
    case 'running':
      return 'text-fg-primary';
    case 'warning':
      return 'text-warn';
    case 'danger':
      return 'text-danger';
    case 'success':
      return 'text-ok';
    case 'info':
    case 'neutral':
      return 'text-fg-secondary';
  }
}

function summaryIconClass(severity: TaskDockRunViewModel['severity']): string {
  switch (severity) {
    case 'running':
      return 'animate-pulse text-run';
    case 'warning':
      return 'text-warn';
    case 'danger':
      return 'text-danger';
    case 'success':
      return 'text-ok';
    case 'info':
      return 'text-accent-ink';
    case 'neutral':
      return 'text-fg-faint';
  }
}
