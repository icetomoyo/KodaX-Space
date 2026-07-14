// PlanPanel — F011-revised / alpha.1
//
// 装 KodaX Scout-seeded todo list（KodaXEvents.onTodoUpdate → session.event 'todo_update'）。
// 列表是 Scout phase 决定的多步任务，Worker 跑步骤时 status 在 pending/in_progress/completed 间流转。
// 列表全量替换（每次 onTodoUpdate 都发完整列表），渲染不需要 reducer 合并。

import { ListChecks } from 'lucide-react';
import { summarizeTodoProgress } from '../../lib/liveTaskProgress.js';
import { useAppStore } from '../../store/appStore.js';
import { useI18n } from '../../i18n/I18nProvider.js';

export function PlanPanel(): JSX.Element {
  const { t } = useI18n();
  const currentSessionId = useAppStore((s) => s.currentSessionId);
  const todos = useAppStore((s) =>
    currentSessionId
      ? (s.liveProjectionBySession[currentSessionId]?.todos ??
        s.todoListBySession[currentSessionId])
      : undefined,
  );

  if (!currentSessionId) {
    return (
      <div className="h-full flex items-center justify-center text-fg-faint text-xs">
        {t('popout.plan.noSession')}
      </div>
    );
  }

  if (!todos || todos.length === 0) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-fg-faint text-xs p-4 gap-2">
        <ListChecks className="w-7 h-7 text-fg-faint" strokeWidth={1.5} aria-hidden />
        <div className="text-fg-muted">{t('popout.plan.emptyTitle')}</div>
        <div className="text-center max-w-[260px]">{t('popout.plan.emptyBody')}</div>
      </div>
    );
  }

  const progress = summarizeTodoProgress(todos);
  const total = progress.total;
  const done = progress.completed;
  const running = todos.find((t) => t.status === 'in_progress');

  return (
    <div className="h-full flex flex-col text-xs">
      <header className="px-3 py-2 border-b border-border-default/60 flex items-center justify-between">
        <div className="text-fg-secondary font-medium">
          {t('popout.plan.title')}{' '}
          <span className="text-fg-muted font-normal">
            ({done}/{total})
          </span>
        </div>
        {running?.activeForm && (
          <div className="text-fg-muted text-[11px] truncate ml-2 max-w-[160px]">
            {running.activeForm}
          </div>
        )}
      </header>

      <ul className="flex-1 overflow-y-auto p-2 space-y-1">
        {todos.map((todo) => {
          // cancelled / skipped 视觉同 completed（灰 + 删除线，已settled）；failed 用 danger 突出，不删除线。
          const settledDim =
            todo.status === 'completed' || todo.status === 'cancelled' || todo.status === 'skipped';
          const dotCls =
            todo.status === 'completed'
              ? 'bg-ok border-ok'
              : todo.status === 'failed'
                ? 'bg-danger border-danger'
                : todo.status === 'in_progress'
                  ? 'border-run bg-run/30 animate-pulse'
                  : todo.status === 'cancelled' || todo.status === 'skipped'
                    ? 'border-border-strong bg-border-strong/40'
                    : 'border-border-strong';
          const textCls =
            todo.status === 'failed'
              ? 'text-danger'
              : settledDim
                ? 'text-fg-muted line-through'
                : 'text-fg-primary';
          return (
            <li
              key={todo.id}
              className={
                'flex items-start gap-2 px-2 py-1.5 rounded ' +
                (todo.status === 'in_progress' ? 'bg-run/40' : settledDim ? 'opacity-60' : '')
              }
            >
              <span
                className={'flex-shrink-0 w-3 h-3 rounded-full mt-0.5 border ' + dotCls}
                aria-label={t('right.statusAria', { status: todo.status })}
              />
              <span className={textCls}>{todo.content}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
