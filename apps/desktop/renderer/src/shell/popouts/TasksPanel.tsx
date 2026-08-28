import { useEffect, useMemo, useState } from 'react';
import { Caret } from '../../components/Caret.js';
import { useAppStore } from '../../store/appStore.js';
import {
  buildAgentStatuses,
  scopeAgentActorSnapshotToCurrentTurn,
  type AgentStatusViewModel,
} from '../agentStatusProjection.js';
import { buildWorkerTree, type WorkerNode } from './worker-tree.js';
import { useI18n } from '../../i18n/I18nProvider.js';
import type { MessageKey } from '../../i18n/messages.js';

type ManagedLiveKind = WorkerNode['latestKind'];
type AgentTraceKind = NonNullable<AgentStatusViewModel['trace']>[number]['kind'];

export function TasksPanel(): JSX.Element {
  const { t } = useI18n();
  const currentSessionId = useAppStore((s) => s.currentSessionId);
  const status = useAppStore((s) =>
    currentSessionId ? s.managedTaskStatusBySession[currentSessionId] : undefined,
  );
  const actorSnapshot = useAppStore((s) =>
    currentSessionId ? s.agentActorSnapshotBySession[currentSessionId] : undefined,
  );
  const events = useAppStore((s) =>
    currentSessionId ? s.eventsBySession[currentSessionId] : undefined,
  );
  const harness = useAppStore((s) =>
    currentSessionId ? s.harnessProfileBySession[currentSessionId] : undefined,
  );

  const currentTurnActorSnapshot = useMemo(
    () => scopeAgentActorSnapshotToCurrentTurn(actorSnapshot, events),
    [actorSnapshot, events],
  );
  const agents = useMemo(
    () => buildAgentStatuses(status, t, currentTurnActorSnapshot),
    [currentTurnActorSnapshot, status, t],
  );
  const workerById = useMemo(() => {
    const map = new Map<string, WorkerNode>();
    for (const worker of buildWorkerTree(status)) map.set(worker.workerId, worker);
    return map;
  }, [status]);

  if (!currentSessionId) {
    return (
      <div className="h-full flex items-center justify-center text-fg-faint text-xs">
        {t('tasks.noSession')}
      </div>
    );
  }

  const runningCount = agents.filter((agent) => agent.state === 'active').length;
  const completedCount = agents.filter((agent) => agent.state === 'completed').length;
  const interruptedCount = agents.filter((agent) => agent.state === 'interrupted').length;
  const waitingText = status?.idleWaiting
    ? t('tasks.waitingPendingResults', { count: status.idleWaitingPendingCount ?? 0 })
    : !actorSnapshot && status?.childFanoutCount !== undefined && status.childFanoutCount > 0
      ? status.childFanoutClass
        ? t('right.agentFanoutWithClass', {
            count: status.childFanoutCount,
            className: status.childFanoutClass,
          })
        : t('right.agentFanout', { count: status.childFanoutCount })
      : null;

  return (
    <div className="h-full overflow-y-auto p-3 space-y-4 text-xs">
      <section className="rounded-lg border border-border-default bg-surface-2 p-3">
        <div className="mb-2 flex items-center justify-between gap-3">
          <div>
            <div className="text-[11px] uppercase tracking-wider text-fg-muted">
              {t('tasks.agents')}
            </div>
            <div className="mt-0.5 text-sm font-medium text-fg-primary">
              {agents.length > 0
                ? t('tasks.delegatedAgentsCount', { count: agents.length })
                : t('tasks.noDelegatedAgentsYet')}
            </div>
          </div>
          <div className="flex flex-wrap justify-end gap-1">
            {runningCount > 0 && <Metric label={t('right.running')} value={runningCount} />}
            {completedCount > 0 && <Metric label={t('right.done')} value={completedCount} />}
            {interruptedCount > 0 && (
              <Metric label={t('right.interrupted')} value={interruptedCount} />
            )}
            {waitingText && <Metric label={t('tasks.state')} value={waitingText} />}
            {status?.budgetApprovalRequired && (
              <Metric label={t('tasks.state')} value={t('right.budgetApprovalNeeded')} />
            )}
          </div>
        </div>
        <HarnessCard harness={harness} status={status} />
      </section>

      <section>
        {agents.length === 0 ? (
          <div className="rounded-lg border border-border-default bg-surface-2 p-3 text-fg-muted">
            {t('tasks.agentsEmpty')}
          </div>
        ) : (
          <ul className="space-y-2">
            {agents.map((agent) => (
              <AgentPanelRow key={agent.id} agent={agent} worker={workerById.get(agent.id)} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function HarnessCard({
  harness,
  status,
}: {
  readonly harness:
    | {
        readonly profile: string;
        readonly round?: number;
      }
    | undefined;
  readonly status:
    | {
        readonly harnessProfile?: string;
        readonly currentRound?: number;
        readonly upgradeCeiling?: string;
      }
    | undefined;
}): JSX.Element {
  const { t } = useI18n();
  const profile = harness?.profile ?? status?.harnessProfile ?? t('tasks.unknown');
  const round = harness?.round ?? status?.currentRound;

  return (
    <div className="rounded-md border border-border-default bg-surface p-2">
      <div className="text-[11px] uppercase tracking-wider text-fg-muted">{t('tasks.harness')}</div>
      <div className="mt-1 font-mono text-fg-secondary">
        {profile}
        {round !== undefined && (
          <span className="text-fg-muted"> / {t('tasks.round', { round })}</span>
        )}
      </div>
      {status?.upgradeCeiling && status.upgradeCeiling !== profile && (
        <div className="mt-1 text-[11px] text-fg-muted">
          {t('tasks.ceiling', { ceiling: status.upgradeCeiling })}
        </div>
      )}
    </div>
  );
}

function AgentPanelRow({
  agent,
  worker,
}: {
  readonly agent: AgentStatusViewModel;
  readonly worker: WorkerNode | undefined;
}): JSX.Element {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(agent.state === 'active');

  useEffect(() => {
    if (agent.state === 'active') setExpanded(true);
  }, [agent.state]);

  return (
    <li
      className={`rounded-lg border ${agentBorderClass(agent.state)} bg-surface-2`}
      data-testid="task-panel-agent-card"
    >
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        aria-expanded={expanded}
        className="flex w-full items-start gap-2 rounded-lg px-3 py-2 text-left hover:bg-hover-bg"
      >
        <span
          className={`mt-1.5 h-2 w-2 flex-shrink-0 rounded-full ${agentDotClass(agent.state)}`}
          aria-hidden
        />
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-center gap-2">
            <span className="truncate text-[13px] font-medium text-fg-primary" title={agent.title}>
              {agent.title}
            </span>
            <span className="flex-shrink-0 rounded bg-surface-3 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-fg-muted">
              {t(agentStateLabelKey(agent.state))}
            </span>
          </span>
          <span className="mt-0.5 block truncate text-[11px] text-fg-muted">
            {[agent.role, agent.responsibility].filter(Boolean).join(' / ') ||
              t('tasks.delegatedWork')}
          </span>
          {agent.latest && (
            <span className="mt-1 block text-[12px] leading-4 text-fg-secondary">
              {agent.latest}
            </span>
          )}
        </span>
        <Caret open={expanded} className="mt-0.5 flex-shrink-0 text-fg-faint" />
      </button>
      {expanded && (
        <div className="border-t border-border-default/60 px-3 py-2">
          <div className="mb-2 flex flex-wrap gap-1 text-[10px] text-fg-faint">
            {agent.evidenceCount !== undefined && (
              <span>{t('right.notesCount', { count: agent.evidenceCount })}</span>
            )}
            {agent.traceCount !== undefined && (
              <span>{t('right.traceEventsCount', { count: agent.traceCount })}</span>
            )}
          </div>
          {agent.trace && agent.trace.length > 0 ? (
            <ul className="space-y-1 border-l border-border-default/60 pl-2">
              {agent.trace.map((event) => (
                <li key={event.id} className="flex items-start gap-2">
                  <span
                    className={`mt-1.5 h-1 w-1 flex-shrink-0 rounded-full ${actorTraceDotClass(
                      event.kind,
                    )}`}
                    aria-hidden
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block text-fg-secondary">{event.summary}</span>
                    <span className="block text-[11px] text-fg-faint">
                      {new Date(event.createdAt).toLocaleTimeString()}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          ) : worker && worker.events.length > 0 ? (
            <ul className="space-y-1 border-l border-border-default/60 pl-2">
              {worker.events.map((event) => (
                <li key={event.key} className="flex items-start gap-2">
                  <span
                    className={`mt-1.5 h-1 w-1 flex-shrink-0 rounded-full ${traceDotClass(
                      event.kind,
                    )}`}
                    aria-hidden
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-fg-secondary" title={event.summary}>
                      {event.summary || event.kind}
                    </span>
                    {event.phase && (
                      <span className="block text-[11px] text-fg-faint">{event.phase}</span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <div className="text-[11px] text-fg-faint">{t('tasks.noTraceEvents')}</div>
          )}
        </div>
      )}
    </li>
  );
}

function Metric({
  label,
  value,
}: {
  readonly label: string;
  readonly value: string | number;
}): JSX.Element {
  return (
    <span className="rounded border border-border-default bg-surface px-1.5 py-0.5 text-[11px] text-fg-secondary">
      <span className="text-fg-faint">{label}</span>{' '}
      <span className="font-mono text-fg-primary">{value}</span>
    </span>
  );
}

function agentBorderClass(state: AgentStatusViewModel['state']): string {
  switch (state) {
    case 'active':
      return 'border-run/40';
    case 'waiting':
      return 'border-warn/40';
    case 'completed':
      return 'border-ok/35';
    case 'interrupted':
      return 'border-warn/40';
    case 'error':
      return 'border-danger/40';
    case 'idle':
      return 'border-border-default';
  }
}

function agentDotClass(state: AgentStatusViewModel['state']): string {
  switch (state) {
    case 'active':
      return 'bg-run animate-pulse';
    case 'waiting':
      return 'bg-warn';
    case 'completed':
      return 'bg-ok';
    case 'interrupted':
      return 'bg-warn';
    case 'error':
      return 'bg-danger';
    case 'idle':
      return 'bg-fg-faint';
  }
}

function actorTraceDotClass(kind: AgentTraceKind): string {
  switch (kind) {
    case 'tool':
      return 'bg-run';
    case 'assistant':
      return 'bg-ok';
    case 'status':
      return 'bg-fg-muted';
  }
}

function traceDotClass(kind: ManagedLiveKind): string {
  switch (kind) {
    case 'completed':
      return 'bg-ok';
    case 'warning':
      return 'bg-warn';
    case 'notification':
      return 'bg-run';
    case 'progress':
      return 'bg-fg-faint';
    default:
      return 'bg-fg-muted';
  }
}

function agentStateLabelKey(state: AgentStatusViewModel['state']): MessageKey {
  switch (state) {
    case 'active':
      return 'right.running';
    case 'waiting':
      return 'right.waiting';
    case 'completed':
      return 'right.done';
    case 'interrupted':
      return 'right.interrupted';
    case 'error':
      return 'right.issue';
    case 'idle':
      return 'right.idle';
  }
}
