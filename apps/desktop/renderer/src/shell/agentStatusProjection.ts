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
const CURRENT_TURN_ACTOR_SNAPSHOT_CACHE = new WeakMap<
  AgentActorTreeSnapshotT,
  WeakMap<readonly SessionEvent[], AgentActorTreeSnapshotT>
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

/**
 * The Runtime Actor tree is cumulative for the lifetime of a Session. Task UI is
 * turn-scoped, so keep only Actors referenced by the latest root turn plus any
 * currently active Actors (and their ancestry/descendants).
 */
export function scopeAgentActorSnapshotToCurrentTurn(
  snapshot: AgentActorTreeSnapshotT | undefined,
  events: readonly SessionEvent[] | undefined,
): AgentActorTreeSnapshotT | undefined {
  if (!snapshot || !events || snapshot.actors.length <= 1) return snapshot;
  const cached = CURRENT_TURN_ACTOR_SNAPSHOT_CACHE.get(snapshot)?.get(events);
  if (cached) return cached;

  let turnStartIndex = -1;
  for (let index = events.length - 1; index >= 0; index--) {
    if (events[index]?.kind === 'session_start') {
      turnStartIndex = index;
      break;
    }
  }

  const actorByPath = new Map(snapshot.actors.map((actor) => [actor.path, actor]));
  const selectedPaths = new Set<string>();
  if (turnStartIndex >= 0) {
    for (let index = turnStartIndex; index < events.length; index++) {
      const event = events[index];
      if (
        event?.kind !== 'tool_result' ||
        (event.toolName !== 'spawn_agent' && event.toolName !== 'followup_task')
      ) {
        continue;
      }
      const ref = parseActorTurnRef(event.content);
      if (!ref) continue;
      const actor = actorByPath.get(ref.actorPath);
      if (
        actor &&
        (actor.currentTurnId === ref.turnId || actor.latestTurn?.turnId === ref.turnId)
      ) {
        selectedPaths.add(actor.path);
      }
    }
  }

  for (const actor of snapshot.actors) {
    if (actor.path !== snapshot.rootPath && isActorTurnActive(actor)) {
      selectedPaths.add(actor.path);
    }
  }

  const selectedPathList = Array.from(selectedPaths);
  const actors = snapshot.actors.filter(
    (actor) =>
      actor.path === snapshot.rootPath ||
      selectedPathList.some(
        (selectedPath) =>
          actor.path === selectedPath ||
          actor.path.startsWith(`${selectedPath}/`) ||
          selectedPath.startsWith(`${actor.path}/`),
      ),
  );
  const scoped =
    actors.length === snapshot.actors.length
      ? snapshot
      : {
          ...snapshot,
          actors,
          activeNonRootTurns: actors.filter(
            (actor) => actor.path !== snapshot.rootPath && isActorTurnActive(actor),
          ).length,
        };
  const byEvents = CURRENT_TURN_ACTOR_SNAPSHOT_CACHE.get(snapshot) ?? new WeakMap();
  byEvents.set(events, scoped);
  CURRENT_TURN_ACTOR_SNAPSHOT_CACHE.set(snapshot, byEvents);
  return scoped;
}

function parseActorTurnRef(
  content: string,
): { readonly actorPath: string; readonly turnId: string } | null {
  try {
    const parsed: unknown = JSON.parse(content);
    if (!isRecord(parsed)) return null;
    const value = isRecord(parsed.data) ? parsed.data : parsed;
    if (
      typeof value.actorPath !== 'string' ||
      !value.actorPath.startsWith('/root/') ||
      typeof value.turnId !== 'string' ||
      value.turnId.length === 0
    ) {
      return null;
    }
    return { actorPath: value.actorPath, turnId: value.turnId };
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isActorTurnActive(actor: AgentActorTreeSnapshotT['actors'][number]): boolean {
  return (
    actor.currentTurnId !== undefined ||
    actor.latestTurn?.state === 'accepted' ||
    actor.latestTurn?.state === 'running'
  );
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
