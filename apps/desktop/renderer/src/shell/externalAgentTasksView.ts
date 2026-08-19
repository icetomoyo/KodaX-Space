export type ExternalAgentTasksLoadState = 'loading' | 'ready' | 'error';
export type ExternalAgentTasksViewKind = 'loading' | 'empty' | 'tasks' | 'error';

export interface ExternalAgentTasksView {
  readonly kind: ExternalAgentTasksViewKind;
  readonly showCount: boolean;
  readonly showTasks: boolean;
}

export function buildExternalAgentTasksView(
  loadState: ExternalAgentTasksLoadState,
  taskCount: number,
): ExternalAgentTasksView {
  if (loadState === 'error') {
    return { kind: 'error', showCount: false, showTasks: taskCount > 0 };
  }
  if (taskCount > 0) {
    return { kind: 'tasks', showCount: true, showTasks: true };
  }
  if (loadState === 'loading') {
    return { kind: 'loading', showCount: false, showTasks: false };
  }
  return { kind: 'empty', showCount: true, showTasks: false };
}
