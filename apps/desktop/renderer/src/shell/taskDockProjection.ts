import type {
  AgentActorTreeSnapshotT,
  SessionEvent,
  WorkflowRunT,
} from '@kodax-space/space-ipc-schema';
import { summarizeTodoProgress } from '../lib/liveTaskProgress.js';
import { buildAgentStatuses, type AgentStatusViewModel } from './agentStatusProjection.js';
import { messages, type MessageKey } from '../i18n/messages.js';

type TodoItem = {
  readonly id: string;
  readonly content: string;
  readonly status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'skipped' | 'cancelled';
  readonly activeForm?: string;
};

type ManagedTaskStatus = Extract<SessionEvent, { kind: 'managed_task_status' }>['status'];

export interface TaskDockMetric {
  readonly key: 'plan' | 'agents' | 'workflow' | 'budget';
  readonly label: string;
  readonly value: string;
}

export interface TaskDockRunViewModel {
  readonly mode: 'no_project' | 'idle' | 'running' | 'attention' | 'error' | 'completed';
  readonly severity: 'neutral' | 'info' | 'running' | 'warning' | 'danger' | 'success';
  readonly headline: string;
  readonly detail?: string;
  readonly metrics: readonly TaskDockMetric[];
  readonly primaryTarget?:
    | 'run'
    | 'plan'
    | 'workflow'
    | 'agents'
    | 'changes'
    | 'sources'
    | 'artifacts'
    | 'context';
  readonly attentionKind?: 'permission' | 'ask_user' | 'budget' | 'error' | 'blocked';
}

export interface BuildTaskDockRunInput {
  readonly hasProject: boolean;
  readonly hasSession: boolean;
  readonly pendingSend: boolean;
  readonly todos?: readonly TodoItem[];
  readonly managedStatus?: ManagedTaskStatus;
  readonly actorSnapshot?: AgentActorTreeSnapshotT;
  readonly workflowRuns?: readonly WorkflowRunT[];
  readonly events?: readonly SessionEvent[];
  readonly budget?: { readonly used: number; readonly cap: number };
  readonly hasPermissionRequest?: boolean;
  readonly hasAskUserRequest?: boolean;
  readonly t?: (key: MessageKey, vars?: Record<string, string | number>) => string;
}

export function buildTaskDockRunView(input: BuildTaskDockRunInput): TaskDockRunViewModel {
  const t = input.t ?? defaultTranslate;
  let agentStatuses: readonly AgentStatusViewModel[] | null = null;
  const getAgents = (): readonly AgentStatusViewModel[] => {
    if (agentStatuses === null) {
      agentStatuses = buildAgentStatuses(input.managedStatus, t, input.actorSnapshot);
    }
    return agentStatuses;
  };

  if (!input.hasProject) {
    return {
      mode: 'no_project',
      severity: 'neutral',
      headline: t('taskDock.openProjectHeadline'),
      detail: t('taskDock.openProjectDetail'),
      metrics: [],
      primaryTarget: 'run',
    };
  }

  if (input.hasPermissionRequest) {
    return attention(t('taskDock.permissionNeeded'), t('taskDock.permissionDetail'), 'permission');
  }
  if (input.hasAskUserRequest) {
    return attention(t('taskDock.answerNeeded'), t('taskDock.answerDetail'), 'ask_user');
  }
  if (input.managedStatus?.budgetApprovalRequired) {
    return attention(
      t('taskDock.budgetApprovalNeeded'),
      t('taskDock.budgetApprovalDetail'),
      'budget',
    );
  }

  const latestError = latestEventKind(input.events, 'session_error');
  if (latestError) {
    return {
      mode: 'error',
      severity: 'danger',
      headline: t('taskDock.runError'),
      detail: t('taskDock.runErrorDetail'),
      metrics: buildMetrics(input, getAgents(), t),
      primaryTarget: 'run',
      attentionKind: 'error',
    };
  }

  const activeWorkflow = input.workflowRuns?.find(
    (run) => run.status === 'running' || run.status === 'paused',
  );
  if (activeWorkflow) {
    return {
      mode: 'running',
      severity: 'running',
      headline:
        activeWorkflow.displayName || activeWorkflow.workflowName || t('taskDock.workflowRunning'),
      detail: activeWorkflow.latestMessage ?? t('taskDock.workflowActive'),
      metrics: buildMetrics(input, getAgents(), t),
      primaryTarget: 'workflow',
    };
  }

  const agents = getAgents();
  const activeAgent =
    agents.find((agent) => agent.state === 'active' && agent.id !== '/root') ??
    agents.find((agent) => agent.state === 'active');
  if (activeAgent) {
    return {
      mode: 'running',
      severity: 'running',
      headline: t('taskDock.agentWorking', { title: activeAgent.title }),
      detail: activeAgent.latest ?? activeAgent.responsibility ?? t('taskDock.agentActive'),
      metrics: buildMetrics(input, agents, t),
      primaryTarget: 'agents',
    };
  }

  const activeTodo = input.todos?.find((todo) => todo.status === 'in_progress');
  if (activeTodo) {
    return {
      mode: 'running',
      severity: 'running',
      headline: t('taskDock.planInProgress'),
      detail: activeTodo.activeForm ?? activeTodo.content,
      metrics: buildMetrics(input, agents, t),
      primaryTarget: 'plan',
    };
  }

  if (input.pendingSend) {
    return {
      mode: 'running',
      severity: 'running',
      headline: t('taskDock.sendingMessage'),
      detail: t('taskDock.turnStarting'),
      metrics: buildMetrics(input, agents, t),
      primaryTarget: 'run',
    };
  }

  if (latestEventKind(input.events, 'session_complete')) {
    return {
      mode: 'completed',
      severity: 'success',
      headline: t('taskDock.runComplete'),
      detail: t('taskDock.runCompleteDetail'),
      metrics: buildMetrics(input, agents, t),
      primaryTarget: 'changes',
    };
  }

  return {
    mode: 'idle',
    severity: input.hasSession ? 'info' : 'neutral',
    headline: input.hasSession ? t('taskDock.readyNext') : t('taskDock.ready'),
    detail: input.hasSession ? t('taskDock.contextUpdates') : t('taskDock.startSession'),
    metrics: buildMetrics(input, agents, t),
    primaryTarget: 'run',
  };
}

function defaultTranslate(key: MessageKey, vars?: Record<string, string | number>): string {
  const message = messages['en-US'][key];
  if (!vars) return message;
  return message.replace(/\{([a-zA-Z0-9_]+)\}/g, (match, name) => {
    const value = vars[name];
    return value === undefined ? match : String(value);
  });
}

function attention(
  headline: string,
  detail: string,
  kind: NonNullable<TaskDockRunViewModel['attentionKind']>,
): TaskDockRunViewModel {
  return {
    mode: 'attention',
    severity: 'warning',
    headline,
    detail,
    metrics: [],
    primaryTarget: 'run',
    attentionKind: kind,
  };
}

function buildMetrics(
  input: BuildTaskDockRunInput,
  agents: readonly AgentStatusViewModel[],
  t: (key: MessageKey, vars?: Record<string, string | number>) => string,
): readonly TaskDockMetric[] {
  const metrics: TaskDockMetric[] = [];
  const todos = input.todos ?? [];
  if (todos.length > 0) {
    const progress = summarizeTodoProgress(todos);
    metrics.push({
      key: 'plan',
      label: t('taskDock.metric.plan'),
      value: `${progress.completed}/${progress.total}`,
    });
  }
  if (agents.length > 0) {
    metrics.push({
      key: 'agents',
      label: t('taskDock.metric.agents'),
      value: formatAgentMetricValue(agents, t),
    });
  }
  const activeWorkflowCount =
    input.workflowRuns?.filter((run) => run.status === 'running' || run.status === 'paused')
      .length ?? 0;
  if (activeWorkflowCount > 0) {
    metrics.push({
      key: 'workflow',
      label: t('taskDock.metric.workflow'),
      value: String(activeWorkflowCount),
    });
  }
  if (input.budget) {
    metrics.push({
      key: 'budget',
      label: t('taskDock.metric.budget'),
      value: `${input.budget.used}/${input.budget.cap}`,
    });
  }
  return metrics;
}

function formatAgentMetricValue(
  agents: readonly AgentStatusViewModel[],
  t: (key: MessageKey, vars?: Record<string, string | number>) => string,
): string {
  const total = agents.length;
  const active = agents.filter((agent) => agent.state === 'active').length;
  const completed = agents.filter((agent) => agent.state === 'completed').length;
  if (active > 0 && completed > 0) {
    return t('taskDock.metric.agentsActiveDone', { total, active, completed });
  }
  if (active > 0) return t('taskDock.metric.agentsActive', { total, active });
  if (completed > 0) return t('taskDock.metric.agentsDone', { total, completed });
  return String(total);
}

function latestEventKind(
  events: readonly SessionEvent[] | undefined,
  kind: SessionEvent['kind'],
): boolean {
  if (!events || events.length === 0) return false;
  for (let i = events.length - 1; i >= Math.max(0, events.length - 8); i--) {
    if (events[i]?.kind === kind) return true;
  }
  return false;
}
