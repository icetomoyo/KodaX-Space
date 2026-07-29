import { createHash, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

import type {
  AgentDispatchContext,
  AgentExecutorPlane,
  AgentExecutorPlaneBinding,
  AgentExecutorPlaneStore,
  AgentTaskEvent,
  AgentTaskSnapshot,
  DispatchableAgentListing,
  ExternalAgentRegistration,
  ExternalAgentRegistrationSummary,
} from '@kodax-ai/kodax/agent';
import type {
  DispatchableAgentListingT,
  ExternalAgentRegistrationSummaryT,
  ExternalAgentTaskEventT,
  ExternalAgentTaskT,
} from '@kodax-space/space-ipc-schema';

import { replaceFileWithoutFollowingAliases } from './atomic-file.js';
import { getSpaceDataDir } from './data-paths.js';

type SdkAgentModule = typeof import('@kodax-ai/kodax/agent');

const KODAX_SDK_VERSION = '0.7.78';
const REFERENCE_EXECUTOR_ID = 'kodax-space-reference-v1';
const REFERENCE_MANAGEMENT_OWNER = 'kodax-space:reference';
const MAX_STORE_FILE_BYTES = 16 * 1024 * 1024;

function stableHash(value: string): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function storageKey(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

class JsonAgentPlaneStore implements AgentExecutorPlaneStore {
  private readonly registrationsPath: string;
  private readonly taskRegistrationSnapshotsPath: string;
  private readonly tasksDir: string;
  private readonly eventsDir: string;
  private readonly writes = new Map<string, Promise<void>>();

  constructor(rootDir: string) {
    this.registrationsPath = path.join(rootDir, 'registrations.json');
    this.taskRegistrationSnapshotsPath = path.join(rootDir, 'task-registration-snapshots.json');
    this.tasksDir = path.join(rootDir, 'tasks');
    this.eventsDir = path.join(rootDir, 'events');
  }

  async loadRegistrations(): Promise<readonly ExternalAgentRegistration[]> {
    return this.readJson(this.registrationsPath, []);
  }

  async saveRegistrations(registrations: readonly ExternalAgentRegistration[]): Promise<void> {
    await this.writeJson(this.registrationsPath, registrations);
  }

  async loadTaskRegistrationSnapshots(): Promise<readonly ExternalAgentRegistration[]> {
    return this.readJson(this.taskRegistrationSnapshotsPath, []);
  }

  async saveTaskRegistrationSnapshots(
    registrations: readonly ExternalAgentRegistration[],
  ): Promise<void> {
    await this.writeJson(this.taskRegistrationSnapshotsPath, registrations);
  }

  async loadTasks(): Promise<readonly AgentTaskSnapshot[]> {
    await fs.mkdir(this.tasksDir, { recursive: true });
    const entries = await fs.readdir(this.tasksDir, { withFileTypes: true });
    const tasks: AgentTaskSnapshot[] = [];
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
      tasks.push(await this.readJson<AgentTaskSnapshot>(path.join(this.tasksDir, entry.name)));
    }
    return tasks;
  }

  async saveTask(task: AgentTaskSnapshot): Promise<void> {
    await this.writeJson(path.join(this.tasksDir, `${storageKey(task.taskId)}.json`), task);
  }

  async loadEvents(taskId: string): Promise<readonly AgentTaskEvent[]> {
    return this.readJson(path.join(this.eventsDir, `${storageKey(taskId)}.json`), []);
  }

  async appendEvent(event: AgentTaskEvent): Promise<void> {
    const filePath = path.join(this.eventsDir, `${storageKey(event.taskId)}.json`);
    await this.serialized(filePath, async () => {
      const current = await this.readJson<AgentTaskEvent[]>(filePath, []);
      current.push(event);
      await this.replaceJson(filePath, current);
    });
  }

  private async readJson<T>(filePath: string, fallback?: T): Promise<T> {
    try {
      const stat = await fs.lstat(filePath);
      if (stat.isSymbolicLink() || !stat.isFile()) {
        throw new Error(`unsafe external-agent store entry: ${filePath}`);
      }
      if (stat.size > MAX_STORE_FILE_BYTES) {
        throw new Error(`external-agent store entry exceeds ${MAX_STORE_FILE_BYTES} bytes`);
      }
      return JSON.parse(await fs.readFile(filePath, 'utf8')) as T;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT' && fallback !== undefined) {
        return structuredClone(fallback);
      }
      throw error;
    }
  }

  private async writeJson(filePath: string, value: unknown): Promise<void> {
    await this.serialized(filePath, () => this.replaceJson(filePath, value));
  }

  private async replaceJson(filePath: string, value: unknown): Promise<void> {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
    if (bytes.byteLength > MAX_STORE_FILE_BYTES) {
      throw new Error(`external-agent store entry exceeds ${MAX_STORE_FILE_BYTES} bytes`);
    }
    await replaceFileWithoutFollowingAliases(
      filePath,
      bytes,
      'external-agent store changed during atomic replacement',
    );
  }

  private async serialized(filePath: string, operation: () => Promise<void>): Promise<void> {
    const previous = this.writes.get(filePath) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(operation);
    this.writes.set(filePath, next);
    try {
      await next;
    } finally {
      if (this.writes.get(filePath) === next) this.writes.delete(filePath);
    }
  }
}

function projectRegistration(
  summary: ExternalAgentRegistrationSummary,
  registration?: ExternalAgentRegistration,
): ExternalAgentRegistrationSummaryT {
  return {
    agentId: summary.agentId,
    displayName: summary.displayName,
    ...(summary.description !== undefined ? { description: summary.description } : {}),
    enabled: summary.enabled,
    adapterKind: 'reference',
    configurationRevision: summary.configurationRevision,
    credentialConfigured: summary.credentialConfigured,
    skills: [...(registration?.skills ?? [])].slice(0, 64),
    inputRequired: registration?.executorConfig?.inputRequired === true,
    capabilities: summary.capabilities,
    effects: summary.effects,
    ...(summary.health !== undefined ? { health: summary.health } : {}),
    diagnostics: [...summary.diagnostics].slice(0, 32),
  };
}

function projectDescriptor(
  descriptor: DispatchableAgentListing['descriptor'],
): DispatchableAgentListingT['descriptor'] {
  return {
    agentId: descriptor.agentId,
    displayName: descriptor.displayName,
    ...(descriptor.description !== undefined ? { description: descriptor.description } : {}),
    origin: descriptor.origin,
    protocol: descriptor.protocol,
    configurationRevision: descriptor.configurationRevision,
    skills: [...descriptor.skills].slice(0, 64),
    inputModalities: [...descriptor.inputModalities].slice(0, 32),
    outputModalities: [...descriptor.outputModalities].slice(0, 32),
    capabilities: descriptor.capabilities,
    effects: descriptor.effects,
  };
}

function projectDispatchability(
  dispatchability: DispatchableAgentListing['dispatchability'],
): DispatchableAgentListingT['dispatchability'] {
  return {
    status: dispatchability.status,
    checkedAt: dispatchability.checkedAt,
    reasons: [...dispatchability.reasons].slice(0, 32),
    ...(dispatchability.retryAfterMs !== undefined
      ? { retryAfterMs: dispatchability.retryAfterMs }
      : {}),
  };
}

function projectDispatchable(listing: DispatchableAgentListing): DispatchableAgentListingT {
  return {
    descriptor: projectDescriptor(listing.descriptor),
    dispatchability: {
      ...projectDispatchability(listing.dispatchability),
    },
  };
}

function projectTask(task: AgentTaskSnapshot): ExternalAgentTaskT {
  return {
    taskId: task.taskId,
    agentId: task.agentId,
    objective: task.objective.slice(0, 4096),
    state: task.state,
    cancellation: task.cancellation,
    route: task.route,
    protocol: task.registration.protocol,
    configurationRevision: task.registration.configurationRevision,
    ...(task.parentTaskId !== undefined ? { parentTaskId: task.parentTaskId.slice(0, 256) } : {}),
    ...(task.workflowId !== undefined ? { workflowId: task.workflowId.slice(0, 256) } : {}),
    ...(task.runId !== undefined ? { runId: task.runId.slice(0, 256) } : {}),
    ...(task.nodeId !== undefined ? { nodeId: task.nodeId.slice(0, 256) } : {}),
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    ...(task.progress !== undefined
      ? {
          progress: {
            ...(task.progress.message !== undefined
              ? { message: task.progress.message.slice(0, 4096) }
              : {}),
            ...(task.progress.percent !== undefined ? { percent: task.progress.percent } : {}),
          },
        }
      : {}),
    ...(task.output !== undefined ? { output: task.output.slice(0, 16_384) } : {}),
    ...(task.error !== undefined ? { error: task.error.slice(0, 4096) } : {}),
    ...(task.cancellationError !== undefined
      ? { cancellationError: task.cancellationError.slice(0, 4096) }
      : {}),
    ...(task.artifacts !== undefined
      ? {
          artifacts: task.artifacts.slice(0, 64).map((artifact) => ({
            name: artifact.name.slice(0, 512),
            ...(artifact.mimeType !== undefined
              ? { mimeType: artifact.mimeType.slice(0, 256) }
              : {}),
            ...(artifact.size !== undefined ? { size: artifact.size } : {}),
            ...(artifact.hash !== undefined ? { hash: artifact.hash.slice(0, 256) } : {}),
            ...(artifact.provenance !== undefined
              ? { provenance: artifact.provenance.slice(0, 1024) }
              : {}),
            ...(artifact.producingAgentId !== undefined
              ? { producingAgentId: artifact.producingAgentId.slice(0, 256) }
              : {}),
            ...(artifact.remoteTaskId !== undefined
              ? { remoteTaskId: artifact.remoteTaskId.slice(0, 256) }
              : {}),
          })),
        }
      : {}),
    ...(task.usage !== undefined ? { usage: task.usage } : {}),
  };
}

function projectTaskEvent(event: AgentTaskEvent): ExternalAgentTaskEventT {
  return {
    taskId: event.taskId,
    seq: event.seq,
    timestamp: event.timestamp,
    type: event.type,
    ...(event.state !== undefined ? { state: event.state } : {}),
    ...(event.cancellation !== undefined ? { cancellation: event.cancellation } : {}),
    ...(event.progress !== undefined
      ? {
          progress: {
            ...(event.progress.message !== undefined
              ? { message: event.progress.message.slice(0, 4096) }
              : {}),
            ...(event.progress.percent !== undefined ? { percent: event.progress.percent } : {}),
          },
        }
      : {}),
    ...(event.output !== undefined ? { output: event.output.slice(0, 16_384) } : {}),
    ...(event.error !== undefined ? { error: event.error.slice(0, 4096) } : {}),
  };
}

export class ExternalAgentGateway {
  private planePromise: Promise<AgentExecutorPlane> | null = null;
  private plane: AgentExecutorPlane | null = null;

  private readonly store: JsonAgentPlaneStore;

  constructor(storeDir = path.join(getSpaceDataDir(), 'external-agent-plane')) {
    this.store = new JsonAgentPlaneStore(storeDir);
  }

  async getBinding(context: AgentDispatchContext): Promise<AgentExecutorPlaneBinding | undefined> {
    try {
      return { plane: await this.ensurePlane(), context };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn('[external-agent] plane unavailable:', message);
      return undefined;
    }
  }

  async status(): Promise<{
    sdkVersion: string;
    enabled: boolean;
    referenceExecutor: boolean;
    adapters: { a2a: boolean; mcpTasks: boolean; governedHttp: boolean };
    registrationCount: number;
    taskCount: number;
    error?: string;
  }> {
    try {
      const plane = await this.ensurePlane();
      const [registrations, tasks] = await Promise.all([
        plane.registrations.list(),
        plane.tasks.list(),
      ]);
      return {
        sdkVersion: KODAX_SDK_VERSION,
        enabled: true,
        referenceExecutor: true,
        // 0.7.67 ships the neutral plane + Reference Executor only. Do not
        // inflate protocol claims until separately delivered adapters exist.
        adapters: { a2a: false, mcpTasks: false, governedHttp: false },
        registrationCount: registrations.length,
        taskCount: tasks.length,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        sdkVersion: KODAX_SDK_VERSION,
        enabled: false,
        referenceExecutor: false,
        adapters: { a2a: false, mcpTasks: false, governedHttp: false },
        registrationCount: 0,
        taskCount: 0,
        error: message.slice(0, 2048),
      };
    }
  }

  async listRegistrations(): Promise<ExternalAgentRegistrationSummaryT[]> {
    const [summaries, registrations] = await Promise.all([
      (await this.ensurePlane()).registrations.list(),
      this.store.loadRegistrations(),
    ]);
    const byId = new Map(registrations.map((registration) => [registration.agentId, registration]));
    return summaries.map((summary) => projectRegistration(summary, byId.get(summary.agentId)));
  }

  async upsertReference(input: {
    agentId?: string;
    displayName: string;
    description?: string;
    enabled: boolean;
    skills: string[];
    inputRequired: boolean;
  }): Promise<ExternalAgentRegistrationSummaryT> {
    const persistedRegistrations = await this.store.loadRegistrations();
    let existing: ExternalAgentRegistration | undefined;
    if (input.agentId !== undefined) {
      existing = persistedRegistrations.find(
        (registration) => registration.agentId === input.agentId,
      );
      if (existing === undefined || existing.executorId !== REFERENCE_EXECUTOR_ID) {
        throw new Error('Reference Agent updates require an existing host-issued registration.');
      }
      if (
        existing.managementOwner !== undefined &&
        existing.managementOwner !== REFERENCE_MANAGEMENT_OWNER
      ) {
        throw new Error('Reference Agent registration is owned by another manager.');
      }
    }
    const agentId = input.agentId ?? `external:${randomUUID()}`;
    const registration: ExternalAgentRegistration = {
      agentId,
      displayName: input.displayName,
      ...(input.description ? { description: input.description } : {}),
      enabled: input.enabled,
      managementOwner: REFERENCE_MANAGEMENT_OWNER,
      executorId: REFERENCE_EXECUTOR_ID,
      // The upstream Reference Executor implements an ExternalAgentProtocol
      // contract but performs no network I/O. UI labels it by adapterKind and
      // never advertises governed HTTP support from this protocol marker.
      protocol: 'http',
      configurationRevision: `space-reference/${Date.now()}-${randomUUID()}`,
      endpointIdentityHash: stableHash(`kodax-space-reference:${agentId}`),
      executorConfig: { inputRequired: input.inputRequired },
      skills: [...new Set(input.skills)],
      inputModalities: ['text'],
      outputModalities: ['text'],
      capabilities: {
        streaming: 'supported',
        durableTasks: 'supported',
        inputRequired: input.inputRequired ? 'supported' : 'conditional',
        cancellation: 'supported',
        artifacts: 'unsupported',
      },
      effects: { remote: 'none', workspace: 'none' },
      health: { status: 'healthy', checkedAt: new Date().toISOString() },
      maxConcurrency: 4,
    };
    const summary = await (
      await this.ensurePlane()
    ).registrations.upsert(registration, {
      expectedConfigurationRevision: existing?.configurationRevision ?? null,
      expectedManagementOwner: existing?.managementOwner ?? null,
    });
    return projectRegistration(summary, registration);
  }

  async remove(agentId: string): Promise<boolean> {
    const registrations = (await this.ensurePlane()).registrations;
    const current = (await registrations.list()).find((item) => item.agentId === agentId);
    if (!current) return false;
    if (
      current.managementOwner !== undefined &&
      current.managementOwner !== REFERENCE_MANAGEMENT_OWNER
    ) {
      throw new Error('Reference Agent registration is owned by another manager.');
    }
    return registrations.remove(agentId, {
      expectedConfigurationRevision: current.configurationRevision,
      expectedManagementOwner: current.managementOwner ?? null,
    });
  }

  async listDispatchable(input: {
    projectRoot?: string;
    readOnly: boolean;
  }): Promise<DispatchableAgentListingT[]> {
    const listings = await (
      await this.ensurePlane()
    ).listDispatchable({
      actorId: 'space:renderer',
      ...(input.projectRoot ? { projectId: input.projectRoot } : {}),
      readOnly: input.readOnly,
    });
    return listings.map(projectDispatchable);
  }

  async preflight(input: {
    agentId: string;
    projectRoot?: string;
    readOnly: boolean;
    expectedConfigurationRevision?: string;
  }): Promise<{
    ok: boolean;
    descriptor?: DispatchableAgentListingT['descriptor'];
    dispatchability: DispatchableAgentListingT['dispatchability'];
    reasons: string[];
  }> {
    const result = await (
      await this.ensurePlane()
    ).preflight({
      agentId: input.agentId,
      query: {
        actorId: 'space:renderer',
        ...(input.projectRoot ? { projectId: input.projectRoot } : {}),
        readOnly: input.readOnly,
      },
      ...(input.expectedConfigurationRevision
        ? { expectedConfigurationRevision: input.expectedConfigurationRevision }
        : {}),
    });
    return {
      ok: result.ok,
      ...(result.descriptor !== undefined
        ? { descriptor: projectDescriptor(result.descriptor) }
        : {}),
      dispatchability: projectDispatchability(result.dispatchability),
      reasons: [...result.reasons].slice(0, 32),
    };
  }

  async listTasks(filter?: {
    agentId?: string;
    parentTaskId?: string;
  }): Promise<ExternalAgentTaskT[]> {
    const tasks = await (await this.ensurePlane()).tasks.list(filter);
    return tasks.slice(-256).reverse().map(projectTask);
  }

  async assertTaskParent(taskId: string, expectedParentTaskId: string): Promise<void> {
    const task = await (await this.ensurePlane()).tasks.get(taskId);
    if (task.parentTaskId !== expectedParentTaskId) {
      throw new Error('external-agent task does not belong to the selected session');
    }
  }

  async startTask(input: {
    agentId: string;
    objective: string;
    projectRoot?: string;
    parentTaskId?: string;
    readOnly: boolean;
    expectedConfigurationRevision?: string;
  }): Promise<ExternalAgentTaskT> {
    const task = await (
      await this.ensurePlane()
    ).tasks.start({
      agentId: input.agentId,
      objective: input.objective,
      context: {
        actorId: 'space:renderer',
        ...(input.projectRoot ? { projectId: input.projectRoot } : {}),
        ...(input.parentTaskId ? { parentTaskId: input.parentTaskId } : {}),
      },
      readOnly: input.readOnly,
      ...(input.expectedConfigurationRevision
        ? { expectedConfigurationRevision: input.expectedConfigurationRevision }
        : {}),
    });
    return projectTask(task);
  }

  async taskEvents(
    taskId: string,
    cursor: number,
  ): Promise<{
    events: ExternalAgentTaskEventT[];
    nextCursor: number;
  }> {
    const plane = await this.ensurePlane();
    const [task, persistedEvents] = await Promise.all([
      plane.tasks.get(taskId),
      plane.tasks.events(taskId, 0),
    ]);
    const terminalStates = new Set<AgentTaskSnapshot['state']>([
      'completed',
      'failed',
      'canceled',
      'rejected',
    ]);
    const allEvents = [...persistedEvents];
    if (
      terminalStates.has(task.state) &&
      !allEvents.some((event) => event.type === 'state' && event.state === task.state)
    ) {
      // KodaX 0.7.78 can persist the terminal task snapshot immediately after
      // the output event without a matching terminal state event. Derive one
      // from the durable snapshot so the audit stream cannot stop one entry
      // short. Its sequence is stable across paginated reads.
      allEvents.push({
        taskId,
        seq: allEvents.reduce((next, event) => Math.max(next, event.seq), 0) + 1,
        timestamp: task.updatedAt,
        type: 'state',
        state: task.state,
      });
    }
    const events = allEvents.filter((event) => event.seq > cursor).slice(0, 512);
    return {
      events: events.map(projectTaskEvent),
      nextCursor: events.reduce((next, event) => Math.max(next, event.seq), cursor),
    };
  }

  async sendTaskInput(taskId: string, content: string): Promise<ExternalAgentTaskT> {
    return projectTask(await (await this.ensurePlane()).tasks.sendInput(taskId, { content }));
  }

  async cancelTask(taskId: string, reason?: string): Promise<ExternalAgentTaskT> {
    return projectTask(await (await this.ensurePlane()).tasks.cancel(taskId, reason));
  }

  async reconcileTask(taskId: string): Promise<ExternalAgentTaskT> {
    return projectTask(await (await this.ensurePlane()).tasks.reconcile(taskId));
  }

  async dispose(): Promise<void> {
    const plane = this.plane;
    this.plane = null;
    this.planePromise = null;
    if (plane) await plane.close();
  }

  private ensurePlane(): Promise<AgentExecutorPlane> {
    if (this.plane !== null) return Promise.resolve(this.plane);
    if (this.planePromise === null) {
      this.planePromise = this.initialize().then((plane) => {
        this.plane = plane;
        return plane;
      });
    }
    return this.planePromise;
  }

  private async initialize(): Promise<AgentExecutorPlane> {
    const sdk: SdkAgentModule = await import('@kodax-ai/kodax/agent');
    const plane = await sdk.createAgentExecutorPlane({
      factories: [
        sdk.createReferenceAgentExecutorFactory({
          executorId: REFERENCE_EXECUTOR_ID,
          protocol: 'http',
        }),
      ],
      policy: ({ registration }) => ({
        allowed: registration.enabled && registration.executorId === REFERENCE_EXECUTOR_ID,
        reasons:
          registration.enabled && registration.executorId === REFERENCE_EXECUTOR_ID
            ? []
            : ['Registration is disabled or its host executor is unavailable.'],
      }),
      credentialBroker: {
        isAvailable: () => false,
        async withCredential(): Promise<never> {
          throw new Error('The KodaX Reference Executor does not accept credentials.');
        },
      },
      artifactPolicy: () => ({
        allowed: false,
        reason: 'Reference Executor artifacts are disabled until Space quarantine is connected.',
      }),
      store: this.store,
      closeTimeoutMs: 30_000,
      onBackgroundError(error, context) {
        console.warn(`[external-agent] background ${context.operation} failed:`, error.message);
      },
    });
    return plane;
  }
}

export const externalAgentGateway = new ExternalAgentGateway();
