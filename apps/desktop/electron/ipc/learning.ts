import { promises as fs } from 'node:fs';
import path from 'node:path';

import type {
  LearnedCapabilityRecord,
  LearningEvent,
  LearningPage,
  LearningQuery,
  LearningSubscribeOptions,
  LearningSurfaceSnapshot,
} from '@kodax-ai/kodax/agent';
import type {
  LearnedCapabilityActionT,
  LearnedCapabilityProjectionT,
  LearningEventT,
  LearningSurfaceSnapshotT,
  PushPayload,
} from '@kodax-space/space-ipc-schema';

import { getSpaceDataDir } from '../kodax/data-paths.js';
import { replaceFileWithoutFollowingAliases } from '../kodax/atomic-file.js';
import { runtimeHostAdapter } from '../kodax/runtime-host-adapter.js';
import { areLearningMutationsEnabled } from '../kodax/learning-policy.js';
import { registerChannel } from './register.js';
import { pushToRenderer } from './push.js';

const CURSOR_FILE_MAX_BYTES = 4_096;
const LEARNING_CURSOR_SCHEMA_VERSION = 1;
const LEARNING_RECONNECT_MIN_MS = 500;
const LEARNING_RECONNECT_MAX_MS = 5_000;

type LearningActionInput = {
  readonly action: LearnedCapabilityActionT;
  readonly capabilityId: string;
  readonly expectedRevision: number;
  readonly expectedFingerprint?: string;
};

const EXPECTED_ACTION_LIFECYCLE: Record<
  LearnedCapabilityActionT,
  LearnedCapabilityRecord['lifecycle']
> = {
  review: 'testing',
  trust: 'active_learned',
  reject: 'rejected',
  disable: 'archived',
  rollback: 'active_learned',
};

export interface LearningRuntimePort {
  context(): Promise<{ readonly runtimeId: string }>;
  list(query?: LearningQuery): Promise<LearningPage>;
  get(capabilityId: string): Promise<LearnedCapabilityRecord>;
  snapshot(): Promise<LearningSurfaceSnapshot>;
  events(afterRevision?: number): Promise<readonly LearningEvent[]>;
  subscribe(options?: LearningSubscribeOptions): AsyncIterable<LearningEvent>;
  acknowledge(capabilityId: string): Promise<void>;
  control(action: LearnedCapabilityActionT, capabilityId: string): Promise<void>;
}

function optionalBaseFields(record: LearnedCapabilityRecord) {
  return {
    ...(record.lastAction !== undefined ? { lastAction: record.lastAction } : {}),
    ...(record.previousGoodRevision !== undefined
      ? { previousGoodRevision: record.previousGoodRevision }
      : {}),
    ...(record.previousLifecycle !== undefined
      ? { previousLifecycle: record.previousLifecycle }
      : {}),
    ...(record.diagnostics !== undefined ? { diagnostics: [...record.diagnostics] } : {}),
  };
}

function availableLearnedSkillActions(
  record: Extract<LearnedCapabilityRecord, { schemaVersion: 2 }>,
): LearnedCapabilityActionT[] {
  if (record.source.kind !== 'skill_learning_loop') return [];
  const actions: LearnedCapabilityActionT[] = [];
  if (
    record.lifecycle === 'ready' ||
    record.lifecycle === 'quarantined' ||
    record.lifecycle === 'active_learned'
  ) {
    actions.push('review');
  }
  // Space deliberately requires review/testing before trust even though Runtime remains
  // the final transition authority.
  if (record.lifecycle === 'testing') actions.push('trust');
  if (
    record.lifecycle === 'ready' ||
    record.lifecycle === 'quarantined' ||
    record.lifecycle === 'archived'
  ) {
    actions.push('reject');
  }
  if (
    record.lifecycle === 'ready' ||
    record.lifecycle === 'testing' ||
    record.lifecycle === 'active_learned' ||
    record.lifecycle === 'quarantined'
  ) {
    actions.push('disable');
  }
  if (
    record.previousGoodRevision !== undefined &&
    record.previousGoodArtifact !== undefined &&
    (record.lifecycle === 'testing' ||
      record.lifecycle === 'active_learned' ||
      record.lifecycle === 'quarantined' ||
      record.lifecycle === 'archived')
  ) {
    actions.push('rollback');
  }
  return actions;
}

export function projectLearnedCapability(
  record: LearnedCapabilityRecord,
  options: { readonly mutationsEnabled?: boolean } = {},
): LearnedCapabilityProjectionT {
  const base = {
    capabilityId: record.capabilityId,
    displayName: record.displayName,
    slug: record.slug,
    carrier: record.carrier,
    lifecycle: record.lifecycle,
    revision: record.revision,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    source: {
      kind: record.source.kind,
      ...(record.source.proposalId !== undefined ? { proposalId: record.source.proposalId } : {}),
    },
    ...optionalBaseFields(record),
  };
  if (record.schemaVersion !== 2) {
    return {
      schemaVersion: 1,
      ...base,
      availableActions: [],
      readOnlyReason:
        'Only immutable learned Skill records from the Runtime Skill learning loop can be controlled here.',
    };
  }
  const mutationsEnabled = options.mutationsEnabled ?? areLearningMutationsEnabled();
  const availableActions = mutationsEnabled ? availableLearnedSkillActions(record) : [];
  return {
    schemaVersion: 2,
    ...base,
    carrier: 'skill',
    scope: { ...record.scope },
    artifact: { ...record.artifact },
    ...(record.previousGoodArtifact !== undefined
      ? { previousGoodArtifact: { ...record.previousGoodArtifact } }
      : {}),
    provenance: { ...record.provenance },
    canary: {
      maxInvocations: record.canary.maxInvocations,
      invocationCount: record.canary.invocationCount,
      verifiedSuccesses: record.canary.verifiedSuccesses,
      credibleNegatives: record.canary.credibleNegatives,
      ...(record.canary.binding !== undefined ? { binding: { ...record.canary.binding } } : {}),
      invocations: record.canary.invocations.map((invocation) => ({
        ...invocation,
        evidenceRefs: [...invocation.evidenceRefs],
      })),
    },
    availableActions,
    ...(availableActions.length === 0
      ? {
          readOnlyReason: !mutationsEnabled
            ? 'Space learned Skill mutation controls are disabled by rollout policy.'
            : record.source.kind === 'skill_learning_loop'
              ? 'No safe control is available for this lifecycle state.'
              : 'This Skill is not owned by the Runtime Skill learning loop.',
        }
      : {}),
  };
}

function projectSnapshot(snapshot: LearningSurfaceSnapshot): LearningSurfaceSnapshotT {
  return {
    ready: snapshot.ready,
    newlyActive: snapshot.newlyActive,
    attention: snapshot.attention,
    active: snapshot.active,
    revision: snapshot.revision,
  };
}

function projectEvent(event: LearningEvent): LearningEventT {
  return {
    schemaVersion: 1,
    sequence: event.sequence,
    eventId: event.eventId,
    capabilityId: event.capabilityId,
    capabilityRevision: event.capabilityRevision,
    kind: event.kind,
    lifecycle: event.lifecycle,
    displayName: event.displayName,
    slug: event.slug,
    carrier: event.carrier,
    createdAt: event.createdAt,
  };
}

export class LearningSafetyService {
  constructor(private readonly runtime: LearningRuntimePort) {}

  async list(input: { readonly limit: number; readonly cursor?: string }) {
    await this.runtime.context();
    const [page, snapshot] = await Promise.all([
      this.runtime.list({ limit: input.limit, ...(input.cursor ? { cursor: input.cursor } : {}) }),
      this.runtime.snapshot(),
    ]);
    return {
      items: page.items.map((record) => projectLearnedCapability(record)),
      ...(page.nextCursor !== undefined ? { nextCursor: page.nextCursor } : {}),
      revision: page.revision,
      snapshot: projectSnapshot(snapshot),
    };
  }

  async get(capabilityId: string) {
    await this.runtime.context();
    const record = await this.runtime.get(capabilityId);
    if (record.capabilityId !== capabilityId) {
      throw new Error('Runtime returned a different learned capability identity.');
    }
    return { record: projectLearnedCapability(record) };
  }

  async action(input: LearningActionInput) {
    await this.runtime.context();
    const current = await this.runtime.get(input.capabilityId);
    if (current.capabilityId !== input.capabilityId) {
      throw new Error('Runtime returned a different learned capability identity.');
    }
    if (current.revision !== input.expectedRevision) {
      throw new Error(
        `Learned Skill changed before ${input.action}; refresh revision ${current.revision} and review it again.`,
      );
    }
    const projected = projectLearnedCapability(current);
    if (!projected.availableActions.includes(input.action)) {
      throw new Error(
        `${input.action} is not available for this learned Skill lifecycle; refresh and review its current state.`,
      );
    }
    if (current.schemaVersion === 2) {
      if (!input.expectedFingerprint) {
        throw new Error('An exact learned Skill artifact fingerprint is required for this action.');
      }
      if (current.artifact.fingerprint !== input.expectedFingerprint) {
        throw new Error(
          `Learned Skill artifact fingerprint changed before ${input.action}; refresh and review it again.`,
        );
      }
    }

    await this.runtime.control(input.action, input.capabilityId);
    const [updated, snapshot] = await Promise.all([
      this.runtime.get(input.capabilityId),
      this.runtime.snapshot(),
    ]);
    if (updated.capabilityId !== input.capabilityId) {
      throw new Error('Runtime returned a different learned capability after the action.');
    }
    if (updated.revision !== current.revision + 1) {
      throw new Error(
        `Runtime published an unexpected learned Skill revision after ${input.action}; refresh and review its current state.`,
      );
    }
    if (updated.lifecycle !== EXPECTED_ACTION_LIFECYCLE[input.action]) {
      throw new Error(
        `Runtime published an unexpected learned Skill lifecycle after ${input.action}; refresh and review its current state.`,
      );
    }
    return {
      record: projectLearnedCapability(updated),
      snapshot: projectSnapshot(snapshot),
    };
  }

  async acknowledge(capabilityId: string) {
    await this.runtime.context();
    const current = await this.runtime.get(capabilityId);
    if (current.capabilityId !== capabilityId) {
      throw new Error('Runtime returned a different learned capability identity.');
    }
    await this.runtime.acknowledge(capabilityId);
    return { snapshot: projectSnapshot(await this.runtime.snapshot()) };
  }
}

export interface LearningCursorRecord {
  readonly runtimeId: string;
  readonly revision: number;
}

function parseCursorRecord(value: unknown): LearningCursorRecord | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (
    record.schemaVersion !== LEARNING_CURSOR_SCHEMA_VERSION ||
    typeof record.runtimeId !== 'string' ||
    record.runtimeId.length < 1 ||
    record.runtimeId.length > 256 ||
    !Number.isSafeInteger(record.revision) ||
    (record.revision as number) < 0
  ) {
    return null;
  }
  return { runtimeId: record.runtimeId, revision: record.revision as number };
}

export class LearningCursorStore {
  constructor(
    private readonly filePath: string = path.join(
      getSpaceDataDir(),
      'runtime-learning-cursor.json',
    ),
  ) {}

  async read(): Promise<LearningCursorRecord | null> {
    try {
      const stat = await fs.lstat(this.filePath);
      if (stat.isSymbolicLink() || !stat.isFile() || stat.size > CURSOR_FILE_MAX_BYTES) return null;
      return parseCursorRecord(JSON.parse(await fs.readFile(this.filePath, 'utf8')));
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ENOENT' || code === 'ENOTDIR' || error instanceof SyntaxError) return null;
      throw error;
    }
  }

  async write(cursor: LearningCursorRecord): Promise<void> {
    const normalized = parseCursorRecord({
      schemaVersion: LEARNING_CURSOR_SCHEMA_VERSION,
      ...cursor,
    });
    if (!normalized) throw new Error('Invalid Runtime learning cursor.');
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    const bytes = Buffer.from(
      `${JSON.stringify({
        schemaVersion: LEARNING_CURSOR_SCHEMA_VERSION,
        runtimeId: normalized.runtimeId,
        revision: normalized.revision,
      })}\n`,
      'utf8',
    );
    await replaceFileWithoutFollowingAliases(
      this.filePath,
      bytes,
      'Runtime learning cursor changed during persistence',
    );
  }
}

type LearningCursorDecision =
  | { readonly kind: 'duplicate' }
  | { readonly kind: 'accepted'; readonly revision: number }
  | { readonly kind: 'gap'; readonly expected: number; readonly actual: number }
  | { readonly kind: 'runtime_changed'; readonly runtimeId: string };

export class LearningEventCursor {
  constructor(
    public readonly runtimeId: string,
    public revision: number,
  ) {}

  accept(runtimeId: string, event: Pick<LearningEvent, 'sequence'>): LearningCursorDecision {
    if (runtimeId !== this.runtimeId) return { kind: 'runtime_changed', runtimeId };
    if (event.sequence <= this.revision) return { kind: 'duplicate' };
    if (event.sequence !== this.revision + 1) {
      return { kind: 'gap', expected: this.revision + 1, actual: event.sequence };
    }
    this.revision = event.sequence;
    return { kind: 'accepted', revision: this.revision };
  }
}

type LearningPush = (payload: PushPayload<'learning.changed'>) => void;

function boundedError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.replace(/\s+/g, ' ').trim();
  return (normalized || 'Runtime learning stream disconnected.').slice(0, 280);
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
  });
}

export class LearningEventBridge {
  private cursor: LearningEventCursor | null = null;
  private startPromise: Promise<void> | null = null;
  private running = false;
  private iterator: AsyncIterator<LearningEvent> | null = null;

  constructor(
    private readonly runtime: LearningRuntimePort,
    private readonly cursorStore: LearningCursorStore,
    private readonly push: LearningPush,
  ) {}

  ensureStarted(): Promise<void> {
    if (this.startPromise !== null) return this.startPromise;
    this.running = true;
    this.startPromise = this.bootstrap()
      .catch((error) => {
        if (!this.running) return;
        this.push({
          kind: 'status',
          ...(this.cursor ? { runtimeId: this.cursor.runtimeId } : {}),
          state: 'reconnecting',
          message: boundedError(error),
        });
      })
      .then(() => {
        if (this.running) void this.subscriptionLoop();
      });
    return this.startPromise;
  }

  async stop(): Promise<void> {
    this.running = false;
    this.startPromise = null;
    const iterator = this.iterator;
    this.iterator = null;
    if (iterator?.return) await iterator.return();
  }

  private async recover(
    runtimeId: string,
    reason: 'initial' | 'cursor_gap' | 'runtime_changed' | 'reconnected',
    snapshot?: LearningSurfaceSnapshot,
  ): Promise<void> {
    const current = snapshot ?? (await this.runtime.snapshot());
    this.cursor = new LearningEventCursor(runtimeId, current.revision);
    await this.cursorStore.write({ runtimeId, revision: current.revision });
    this.push({
      kind: 'snapshot',
      runtimeId,
      reason,
      snapshot: projectSnapshot(current),
    });
  }

  private async acceptEvent(runtimeId: string, event: LearningEvent): Promise<boolean> {
    if (this.cursor === null) {
      await this.recover(runtimeId, 'initial');
      return false;
    }
    const decision = this.cursor.accept(runtimeId, event);
    if (decision.kind === 'duplicate') return true;
    if (decision.kind === 'runtime_changed') {
      await this.recover(runtimeId, 'runtime_changed');
      return false;
    }
    if (decision.kind === 'gap') {
      await this.recover(runtimeId, 'cursor_gap');
      return false;
    }
    await this.cursorStore.write({ runtimeId, revision: decision.revision });
    this.push({ kind: 'event', runtimeId, event: projectEvent(event) });
    return true;
  }

  private async bootstrap(reconnect = false): Promise<void> {
    const { runtimeId } = await this.runtime.context();
    const [persisted, snapshot] = await Promise.all([
      this.cursorStore.read(),
      this.runtime.snapshot(),
    ]);
    if (persisted === null) {
      await this.recover(runtimeId, reconnect ? 'reconnected' : 'initial', snapshot);
      return;
    }
    if (persisted.runtimeId !== runtimeId) {
      await this.recover(runtimeId, 'runtime_changed', snapshot);
      return;
    }
    if (persisted.revision > snapshot.revision) {
      await this.recover(runtimeId, 'cursor_gap', snapshot);
      return;
    }

    this.cursor = new LearningEventCursor(runtimeId, persisted.revision);
    const replay = await this.runtime.events(persisted.revision);
    for (const event of replay) {
      if (!(await this.acceptEvent(runtimeId, event))) return;
    }
    if ((this.cursor?.revision ?? 0) < snapshot.revision) {
      await this.recover(runtimeId, 'cursor_gap');
      return;
    }
    this.push({ kind: 'status', runtimeId, state: 'connected' });
  }

  private async subscriptionLoop(): Promise<void> {
    let delayMs = LEARNING_RECONNECT_MIN_MS;
    while (this.running) {
      try {
        if (this.cursor === null) await this.bootstrap();
        const runtimeId = this.cursor?.runtimeId;
        if (!runtimeId) throw new Error('Runtime learning cursor was not initialized.');
        const iterable = this.runtime.subscribe({ afterRevision: this.cursor?.revision ?? 0 });
        const iterator = iterable[Symbol.asyncIterator]();
        this.iterator = iterator;
        while (this.running) {
          const next = await iterator.next();
          if (next.done) throw new Error('Runtime learning subscription ended.');
          await this.acceptEvent(runtimeId, next.value);
        }
      } catch (error) {
        this.iterator = null;
        if (!this.running) return;
        this.push({
          kind: 'status',
          ...(this.cursor ? { runtimeId: this.cursor.runtimeId } : {}),
          state: 'reconnecting',
          message: boundedError(error),
        });
        await wait(delayMs);
        if (!this.running) return;
        try {
          await this.bootstrap(true);
          delayMs = LEARNING_RECONNECT_MIN_MS;
        } catch {
          delayMs = Math.min(delayMs * 2, LEARNING_RECONNECT_MAX_MS);
        }
      }
    }
  }
}

const defaultLearningRuntimePort: LearningRuntimePort = {
  context: () => runtimeHostAdapter.learningContext(),
  list: (query) => runtimeHostAdapter.listLearnedCapabilities(query),
  get: (capabilityId) => runtimeHostAdapter.getLearnedCapability(capabilityId),
  snapshot: () => runtimeHostAdapter.learningSnapshot(),
  events: (afterRevision) => runtimeHostAdapter.learningEvents(afterRevision),
  subscribe: (options) => runtimeHostAdapter.subscribeToLearning(options),
  acknowledge: (capabilityId) => runtimeHostAdapter.acknowledgeLearnedCapability(capabilityId),
  control: (action, capabilityId) =>
    runtimeHostAdapter.controlLearnedCapability(action, capabilityId),
};

export const learningSafetyService = new LearningSafetyService(defaultLearningRuntimePort);
export const learningEventBridge = new LearningEventBridge(
  defaultLearningRuntimePort,
  new LearningCursorStore(),
  (payload) => pushToRenderer('learning.changed', payload),
);

export function registerLearningChannels(
  service: LearningSafetyService = learningSafetyService,
  bridge: LearningEventBridge = learningEventBridge,
): void {
  registerChannel('learning.list', async (input) => {
    const output = await service.list(input);
    void bridge.ensureStarted().catch((error) => {
      console.warn('[learning] event bridge failed:', boundedError(error));
    });
    return output;
  });
  registerChannel('learning.get', ({ capabilityId }) => service.get(capabilityId));
  registerChannel('learning.action', (input) => service.action(input));
  registerChannel('learning.acknowledge', ({ capabilityId }) => service.acknowledge(capabilityId));
}
