import type {
  AgentDetail,
  AgentEvent,
  AgentOutput,
  AgentTurn,
  DispatchableAgentListing,
  ExternalAgentRegistrationSummary,
} from '@kodax-ai/kodax/agent';
import type {
  DispatchableAgentListingT,
  ExternalAgentRegistrationSummaryT,
  ExternalAgentTaskEventT,
  ExternalAgentTaskT,
} from '@kodax-space/space-ipc-schema';

const TASK_ID_PREFIX = 'runtime-actor:';

export function isRuntimeActorTaskId(taskId: string): boolean {
  return taskId.startsWith(TASK_ID_PREFIX);
}

export interface RuntimeActorTaskIdentity {
  readonly actorPath: string;
  readonly turnId: string;
}

export function encodeRuntimeActorTaskId(identity: RuntimeActorTaskIdentity): string {
  const encoded = `${TASK_ID_PREFIX}${Buffer.from(identity.actorPath).toString('base64url')}.${Buffer.from(identity.turnId).toString('base64url')}`;
  if (encoded.length > 256) throw new Error('Runtime Actor task identity exceeds the IPC limit.');
  return encoded;
}

export function decodeRuntimeActorTaskId(taskId: string): RuntimeActorTaskIdentity {
  if (!taskId.startsWith(TASK_ID_PREFIX)) throw new Error('task is not owned by the Coder daemon');
  const separator = taskId.indexOf('.', TASK_ID_PREFIX.length);
  if (separator < 0) throw new Error('invalid Runtime Actor task identity');
  const actorPath = Buffer.from(
    taskId.slice(TASK_ID_PREFIX.length, separator),
    'base64url',
  ).toString('utf8');
  const turnId = Buffer.from(taskId.slice(separator + 1), 'base64url').toString('utf8');
  if (!actorPath.startsWith('/') || !turnId) throw new Error('invalid Runtime Actor task identity');
  return { actorPath, turnId };
}

export function projectRuntimeDispatchable(
  listing: DispatchableAgentListing,
): DispatchableAgentListingT {
  return {
    descriptor: {
      ...listing.descriptor,
      skills: [...listing.descriptor.skills].slice(0, 64),
      inputModalities: [...listing.descriptor.inputModalities].slice(0, 32),
      outputModalities: [...listing.descriptor.outputModalities].slice(0, 32),
    },
    dispatchability: projectRuntimeDispatchability(listing.dispatchability),
  };
}

export function projectRuntimeDispatchability(
  dispatchability: DispatchableAgentListing['dispatchability'],
): DispatchableAgentListingT['dispatchability'] {
  return {
    ...dispatchability,
    reasons: [...dispatchability.reasons].slice(0, 32),
  };
}

export function projectRuntimeRegistration(
  summary: ExternalAgentRegistrationSummary,
  listing?: DispatchableAgentListing,
): ExternalAgentRegistrationSummaryT {
  return {
    agentId: summary.agentId,
    displayName: summary.displayName,
    ...(summary.description ? { description: summary.description } : {}),
    enabled: summary.enabled,
    adapterKind: 'runtime',
    configurationRevision: summary.configurationRevision,
    credentialConfigured: summary.credentialConfigured,
    skills: [...(listing?.descriptor.skills ?? [])].slice(0, 64),
    inputRequired: listing?.descriptor.capabilities.inputRequired === 'supported',
    capabilities: summary.capabilities,
    effects: summary.effects,
    ...(summary.health ? { health: summary.health } : {}),
    diagnostics: [...summary.diagnostics].slice(0, 32),
  };
}

function stringMetadata(turn: AgentTurn, key: string): string | undefined {
  const value = turn.metadata?.[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function taskState(state: AgentTurn['state']): ExternalAgentTaskT['state'] {
  switch (state) {
    case 'accepted':
      return 'submitted';
    case 'running':
      return 'working';
    case 'completed':
      return 'completed';
    case 'failed':
      return 'failed';
    case 'interrupted':
      return 'canceled';
  }
}

export function projectRuntimeActorTask(
  sessionId: string,
  detail: AgentDetail,
  turn: AgentTurn,
  output?: AgentOutput,
): ExternalAgentTaskT {
  const protocol = stringMetadata(turn, 'protocol');
  const normalizedProtocol =
    protocol === 'a2a' || protocol === 'mcp' || protocol === 'http' ? protocol : 'native';
  const state = taskState(output?.state ?? turn.state);
  const progress = output?.progress ?? turn.progress ?? [];
  const latestProgress = progress.at(-1)?.summary;
  return {
    taskId: encodeRuntimeActorTaskId({ actorPath: detail.actor.path, turnId: turn.turnId }),
    agentId: stringMetadata(turn, 'agentId') ?? detail.actor.taskName,
    objective: turn.objective.slice(0, 4_096),
    state,
    cancellation: state === 'canceled' ? 'confirmed' : 'none',
    route: 'external',
    protocol: normalizedProtocol,
    configurationRevision: stringMetadata(turn, 'configurationRevision') ?? 'runtime-managed',
    parentTaskId: sessionId,
    createdAt: turn.createdAt,
    updatedAt: turn.completedAt ?? turn.startedAt ?? detail.actor.updatedAt,
    ...(latestProgress ? { progress: { message: latestProgress.slice(0, 4_096) } } : {}),
    ...((output?.output ?? turn.output)
      ? { output: (output?.output ?? turn.output)!.slice(0, 16_384) }
      : {}),
    ...((output?.error ?? turn.error)
      ? { error: (output?.error ?? turn.error)!.slice(0, 4_096) }
      : {}),
    ...((output?.artifactDetails ?? turn.artifactDetails)
      ? {
          artifacts: [...(output?.artifactDetails ?? turn.artifactDetails)!]
            .slice(0, 64)
            .map((artifact) => ({
              name: artifact.name.slice(0, 512),
              ...(artifact.mimeType ? { mimeType: artifact.mimeType.slice(0, 256) } : {}),
              ...(artifact.size !== undefined ? { size: artifact.size } : {}),
              ...(artifact.hash ? { hash: artifact.hash.slice(0, 256) } : {}),
              ...(artifact.provenance ? { provenance: artifact.provenance.slice(0, 1_024) } : {}),
              ...(artifact.producingAgentId
                ? { producingAgentId: artifact.producingAgentId.slice(0, 256) }
                : {}),
              ...(artifact.remoteTaskId
                ? { remoteTaskId: artifact.remoteTaskId.slice(0, 256) }
                : {}),
            })),
        }
      : {}),
  };
}

export function projectRuntimeActorEvent(event: AgentEvent): ExternalAgentTaskEventT | undefined {
  if (!event.turnId) return undefined;
  const taskId = encodeRuntimeActorTaskId({ actorPath: event.actorPath, turnId: event.turnId });
  const base = { taskId, seq: event.sequence, timestamp: event.createdAt };
  switch (event.kind) {
    case 'actor_spawned':
      return { ...base, type: 'submitted', state: 'submitted' };
    case 'turn_started':
      return { ...base, type: 'state', state: 'working' };
    case 'message_delivered':
    case 'turn_progress':
      return {
        ...base,
        type: 'progress',
        ...(event.progress
          ? { progress: { message: event.progress.summary.slice(0, 4_096) } }
          : {}),
      };
    case 'turn_completed':
      return { ...base, type: 'state', state: 'completed' };
    case 'turn_failed':
      return { ...base, type: 'state', state: 'failed' };
    case 'turn_interrupted':
      return { ...base, type: 'cancellation', state: 'canceled', cancellation: 'confirmed' };
    case 'actor_closed':
      return { ...base, type: 'state', state: 'unknown' };
  }
}
