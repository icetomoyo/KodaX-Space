import type { AgentActorTreeSnapshotT, SessionEvent } from '@kodax-space/space-ipc-schema';
import { buildWorkerTree } from './popouts/worker-tree.js';
import { messages, type MessageKey } from '../i18n/messages.js';

type ManagedTaskStatus = Extract<SessionEvent, { kind: 'managed_task_status' }>['status'];

const EMPTY_AGENT_STATUSES: readonly AgentStatusViewModel[] = [];
type Translate = (key: MessageKey, vars?: Record<string, string | number>) => string;
const DEFAULT_TRANSLATE: Translate = (key) => messages['en-US'][key];
const AGENT_STATUS_CACHE = new WeakMap<
  NonNullable<ManagedTaskStatus>,
  Map<Translate, readonly AgentStatusViewModel[]>
>();
interface ActorStatusCacheEntry {
  withoutManaged?: readonly AgentStatusViewModel[];
  readonly byManaged: WeakMap<NonNullable<ManagedTaskStatus>, readonly AgentStatusViewModel[]>;
}
const ACTOR_STATUS_CACHE = new WeakMap<
  AgentActorTreeSnapshotT,
  Map<Translate, ActorStatusCacheEntry>
>();

export interface AgentTraceViewModel {
  readonly id: string;
  readonly kind: 'status' | 'tool' | 'assistant';
  readonly summary: string;
  readonly createdAt: string;
}

export interface AgentStatusViewModel {
  readonly id: string;
  readonly title: string;
  readonly role?: string;
  readonly state: 'active' | 'waiting' | 'idle' | 'completed' | 'interrupted' | 'error';
  readonly responsibility?: string;
  readonly phase?: string;
  readonly latest?: string;
  readonly evidenceCount?: number;
  readonly traceCount?: number;
  readonly trace?: readonly AgentTraceViewModel[];
}

export function buildAgentStatuses(
  status: ManagedTaskStatus | undefined,
  t: Translate = DEFAULT_TRANSLATE,
  actorSnapshot?: AgentActorTreeSnapshotT,
): readonly AgentStatusViewModel[] {
  if (actorSnapshot) return buildActorStatuses(actorSnapshot, t, status);
  return buildLegacyAgentStatuses(status, t);
}

function buildLegacyAgentStatuses(
  status: ManagedTaskStatus | undefined,
  t: Translate,
): readonly AgentStatusViewModel[] {
  if (!status) return EMPTY_AGENT_STATUSES;
  const cached = AGENT_STATUS_CACHE.get(status)?.get(t);
  if (cached) return cached;

  const workers = buildWorkerTree(status);
  const view = workers.map((worker) => {
    const latestKind = worker.latestKind;
    const state: AgentStatusViewModel['state'] = worker.isActive
      ? 'active'
      : latestKind === 'warning'
        ? 'error'
        : latestKind === 'completed'
          ? 'completed'
          : status?.idleWaiting
            ? 'waiting'
            : 'idle';

    const role = worker.isMain
      ? t('agent.role.main')
      : inferRole(worker.workerTitle, worker.latestPhase, t);
    const responsibility = worker.latestPhase
      ? humanizePhase(worker.latestPhase)
      : worker.isActive
        ? t('agent.working')
        : undefined;

    return {
      id: worker.workerId,
      title: sanitizeWorkerTitle(worker.workerTitle, t),
      role,
      state,
      responsibility,
      phase: worker.latestPhase,
      latest: worker.latestSummary,
      traceCount: worker.events.length,
      evidenceCount: countEvidence(worker.events),
    };
  });
  const byTranslate = AGENT_STATUS_CACHE.get(status) ?? new Map();
  byTranslate.set(t, view);
  AGENT_STATUS_CACHE.set(status, byTranslate);
  return view;
}

function buildActorStatuses(
  snapshot: AgentActorTreeSnapshotT,
  t: Translate,
  managedStatus: ManagedTaskStatus | undefined,
): readonly AgentStatusViewModel[] {
  const byTranslate = ACTOR_STATUS_CACHE.get(snapshot) ?? new Map();
  const cacheEntry = byTranslate.get(t);
  const cached = managedStatus
    ? cacheEntry?.byManaged.get(managedStatus)
    : cacheEntry?.withoutManaged;
  if (cached) return cached;
  const foregroundRootStatus = selectForegroundRootStatus(managedStatus, t);
  const view = snapshot.actors.map((actor) => {
    const latestTurn = actor.latestTurn;
    const trace = latestTurn?.recentActivity.map((activity) => ({
      id: `${actor.path}:${latestTurn.turnId}:${activity.sequence}`,
      kind: activity.kind,
      summary: activity.summary,
      createdAt: activity.createdAt,
    }));
    const latestActivity = trace?.at(-1)?.summary;
    const state: AgentStatusViewModel['state'] =
      actor.currentTurnId !== undefined ||
      latestTurn?.state === 'accepted' ||
      latestTurn?.state === 'running'
        ? 'active'
        : latestTurn?.state === 'failed'
          ? 'error'
          : latestTurn?.state === 'interrupted'
            ? 'interrupted'
            : latestTurn?.state === 'completed'
              ? 'completed'
              : 'idle';
    const isRoot = actor.path === snapshot.rootPath;
    const actorStatus: AgentStatusViewModel = {
      id: actor.path,
      title: isRoot ? t('agent.rootTitle') : sanitizeWorkerTitle(actor.taskName, t),
      role: isRoot ? t('agent.role.main') : inferRole(actor.taskName, actor.kind, t),
      state,
      responsibility:
        state === 'active' && (isRoot || actor.kind === 'native')
          ? t('agent.working')
          : actor.kind === 'native'
            ? undefined
            : humanizePhase(actor.kind),
      phase: latestTurn?.state ?? actor.state,
      latest:
        latestActivity ??
        (latestTurn?.summary && latestTurn.summary !== latestTurn.state
          ? latestTurn.summary
          : undefined),
      traceCount: trace?.length,
      trace,
    };
    if (!isRoot || !foregroundRootStatus) return actorStatus;

    // KodaX's /root Actor is a permanent control Actor: it stays `running` and
    // deliberately owns no Turn. The foreground managed Worker remains the
    // canonical source for the root task's live phase, activity and completion.
    // Only merge it into /root; recursive/non-root lifecycle stays Actor-owned.
    return {
      ...actorStatus,
      state: foregroundRootStatus.state,
      responsibility: foregroundRootStatus.responsibility,
      phase: foregroundRootStatus.phase,
      latest: foregroundRootStatus.latest,
      evidenceCount: foregroundRootStatus.evidenceCount,
      traceCount: foregroundRootStatus.traceCount,
    };
  });
  const nextCacheEntry: ActorStatusCacheEntry = cacheEntry ?? {
    byManaged: new WeakMap(),
  };
  if (managedStatus) nextCacheEntry.byManaged.set(managedStatus, view);
  else nextCacheEntry.withoutManaged = view;
  byTranslate.set(t, nextCacheEntry);
  ACTOR_STATUS_CACHE.set(snapshot, byTranslate);
  return view;
}

function selectForegroundRootStatus(
  status: ManagedTaskStatus | undefined,
  t: Translate,
): AgentStatusViewModel | undefined {
  const legacyStatuses = buildLegacyAgentStatuses(status, t);
  return (
    legacyStatuses.find((worker) => worker.state === 'active') ??
    legacyStatuses.find((worker) => worker.state === 'waiting') ??
    legacyStatuses[0]
  );
}

function sanitizeWorkerTitle(title: string, t: Translate): string {
  const trimmed = title.trim();
  if (trimmed.length === 0) return t('agent.fallbackTitle');
  if (/^[a-f0-9_-]{10,}$/i.test(trimmed)) return t('agent.fallbackTitle');
  return trimmed;
}

function inferRole(title: string, phase: string | undefined, t: Translate): string {
  const source = `${title} ${phase ?? ''}`.toLowerCase();
  if (source.includes('research') || source.includes('source')) return t('agent.role.research');
  if (source.includes('review') || source.includes('verify')) return t('agent.role.review');
  if (source.includes('write') || source.includes('edit')) return t('agent.role.implementation');
  if (source.includes('test')) return t('agent.role.verification');
  return t('agent.role.worker');
}

function humanizePhase(phase: string): string {
  return phase
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^./, (ch) => ch.toUpperCase());
}

function countEvidence(
  events: readonly NonNullable<ManagedTaskStatus['events']>[number][],
): number | undefined {
  let count = 0;
  for (const event of events) {
    if (event.summary && event.summary.trim().length > 0) count++;
  }
  return count > 0 ? count : undefined;
}
