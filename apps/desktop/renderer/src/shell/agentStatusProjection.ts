import type { SessionEvent } from '@kodax-space/space-ipc-schema';
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

export interface AgentStatusViewModel {
  readonly id: string;
  readonly title: string;
  readonly role?: string;
  readonly state: 'active' | 'waiting' | 'idle' | 'completed' | 'error';
  readonly responsibility?: string;
  readonly phase?: string;
  readonly latest?: string;
  readonly evidenceCount?: number;
  readonly traceCount?: number;
}

export function buildAgentStatuses(
  status: ManagedTaskStatus | undefined,
  t: Translate = DEFAULT_TRANSLATE,
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
