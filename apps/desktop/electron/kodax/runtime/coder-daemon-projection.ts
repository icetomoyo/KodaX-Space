import type {
  RuntimePermissionRequest,
  RuntimeRunStatus,
  RuntimeSessionSettings,
  RuntimeSessionObservationSnapshot,
  RuntimeStatusSnapshot,
  RuntimeUserInputRequest,
  RuntimeTypedEvent,
} from '@kodax-ai/kodax/runtime';
import {
  spaceRuntimeProfileProjectionSchema,
  spaceSessionLiveChangedSchema,
  spaceSessionLiveProjectionSchema,
  type SpaceRuntimeCapabilityT,
  type SpaceRuntimeInteractionT,
  type SpaceRuntimeProfileProjectionT,
  type SpaceRuntimeRunProjectionT,
  type SpaceSessionLiveChangedT,
  type SpaceSessionLiveProjectionT,
} from '@kodax-space/space-ipc-schema';

const MAX_DRAFT = 256 * 1024;
const MAX_REASON = 512;
const MAX_TODOS = 1_000;
const MAX_TOOLS = 128;
const ACTIVE_PHASES = new Set(['running', 'waiting_permission', 'waiting_user_input'] as const);
const TERMINAL_PHASES = new Set(['completed', 'failed', 'cancelled', 'interrupted'] as const);
const TODO_STATUSES = new Set([
  'pending',
  'in_progress',
  'completed',
  'failed',
  'skipped',
  'cancelled',
] as const);

function record(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : undefined;
}

function text(value: unknown, max = MAX_REASON): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value.slice(0, max) : undefined;
}

function timestamp(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return Math.trunc(value);
  if (typeof value !== 'string') return fallback;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function runtimePhase(phase: RuntimeRunStatus['phase']): SpaceRuntimeRunProjectionT['phase'] {
  return phase;
}

export function projectRuntimeRun(
  run: RuntimeRunStatus,
  queuePosition?: number,
): SpaceRuntimeRunProjectionT {
  const origin = run.origin;
  return {
    runId: run.runId,
    sessionId: run.sessionId,
    phase: runtimePhase(run.phase),
    ...(run.queuedAt !== undefined
      ? { queuedAt: timestamp(run.queuedAt) }
      : run.phase === 'queued'
        ? { queuedAt: timestamp(run.acceptedAt ?? run.startedAt) }
        : {}),
    ...(run.runningAt !== undefined || run.startedAt !== undefined
      ? { startedAt: timestamp(run.runningAt ?? run.startedAt) }
      : {}),
    ...(run.endedAt !== undefined ? { completedAt: timestamp(run.endedAt) } : {}),
    ...(queuePosition !== undefined ? { queuePosition } : {}),
    ...(run.terminal?.message !== undefined || run.terminal?.code !== undefined
      ? { terminalReason: (run.terminal?.message ?? run.terminal?.code ?? '').slice(0, MAX_REASON) }
      : run.error
        ? { terminalReason: run.error.slice(0, MAX_REASON) }
        : {}),
    ...(origin !== undefined
      ? {
          initiatedBy: {
            clientId: origin.principalId.slice(0, 128),
            name: (origin.clientName ?? origin.principalId).slice(0, 128),
          },
        }
      : {}),
    ...(run.requirements?.credential || run.requirements?.hostTools
      ? {
          requirements: {
            ...(run.requirements.credential
              ? { credential: run.requirements.credential.state }
              : {}),
            ...(run.requirements.hostTools ? { hostTools: run.requirements.hostTools.state } : {}),
          },
        }
      : {}),
  };
}

function runsForSession(
  runs: readonly RuntimeRunStatus[],
  sessionId: string,
): {
  activeRun?: SpaceRuntimeRunProjectionT;
  queuedRuns: SpaceRuntimeRunProjectionT[];
  lastTerminalRun?: SpaceRuntimeRunProjectionT;
} {
  const own = runs.filter((run) => run.sessionId === sessionId);
  const active = own
    .filter((run) => ACTIVE_PHASES.has(run.phase as never))
    .sort((a, b) => (b.sessionOrder ?? 0) - (a.sessionOrder ?? 0))[0];
  const queued = own
    .filter((run) => run.phase === 'queued')
    .sort((a, b) => (a.sessionOrder ?? 0) - (b.sessionOrder ?? 0));
  const terminal = own
    .filter((run) => TERMINAL_PHASES.has(run.phase as never))
    .sort((a, b) => timestamp(b.endedAt ?? b.startedAt) - timestamp(a.endedAt ?? a.startedAt))[0];
  return {
    ...(active !== undefined ? { activeRun: projectRuntimeRun(active) } : {}),
    queuedRuns: queued.map((run, index) => projectRuntimeRun(run, index + 1)),
    ...(terminal !== undefined ? { lastTerminalRun: projectRuntimeRun(terminal) } : {}),
  };
}

function permissionInteraction(request: RuntimePermissionRequest): SpaceRuntimeInteractionT {
  const reason = text(request.reason, 512) ?? `Permission requested for ${request.toolName}`;
  return {
    source: 'coder-runtime',
    kind: 'permission',
    ...(request.runId ? { runId: request.runId } : {}),
    createdAt: timestamp(request.createdAt),
    state: 'pending',
    request: {
      reqId: request.id,
      sessionId: request.sessionId,
      risk: request.risk ?? 'medium',
      reason,
      toolCall: {
        toolId: request.toolCallId ?? request.id,
        toolName: request.toolName,
      },
    },
  };
}

function normalizeQuestionOption(value: unknown): {
  label: string;
  value: string;
  description?: string;
} | null {
  const item = record(value);
  if (!item) return null;
  const label = text(item.label, 160);
  const optionValue = text(item.value, 512);
  if (!label || !optionValue) return null;
  const description = text(item.description, 512);
  return { label, value: optionValue, ...(description ? { description } : {}) };
}

function normalizeMultiQuestion(value: unknown) {
  const item = record(value);
  const question = text(item?.question, 2_048);
  const normalizedOptions = Array.isArray(item?.options)
    ? item.options
        .map(normalizeQuestionOption)
        .filter((option) => option !== null)
        .slice(0, 20)
    : [];
  if (!question || normalizedOptions.length === 0) return null;
  const minSelections = Number.isInteger(item?.minSelections)
    ? Math.max(0, Math.min(20, Number(item?.minSelections)))
    : undefined;
  const maxSelections = Number.isInteger(item?.maxSelections)
    ? Math.max(0, Math.min(20, Number(item?.maxSelections)))
    : undefined;
  if (minSelections !== undefined && maxSelections !== undefined && minSelections > maxSelections) {
    return null;
  }
  const header = text(item?.header, 96);
  return {
    question,
    options: normalizedOptions,
    ...(header ? { header } : {}),
    ...(typeof item?.multiSelect === 'boolean' ? { multiSelect: item.multiSelect } : {}),
    ...(minSelections !== undefined ? { minSelections } : {}),
    ...(maxSelections !== undefined ? { maxSelections } : {}),
    ...(typeof item?.allowCustomInput === 'boolean'
      ? { allowCustomInput: item.allowCustomInput }
      : {}),
    ...(text(item?.customInputLabel, 160)
      ? { customInputLabel: text(item?.customInputLabel, 160)! }
      : {}),
    ...(text(item?.customInputPrompt, 512)
      ? { customInputPrompt: text(item?.customInputPrompt, 512)! }
      : {}),
    ...(typeof item?.customInputDefault === 'string'
      ? { customInputDefault: item.customInputDefault.slice(0, 4_096) }
      : {}),
  };
}

function userInputInteraction(request: RuntimeUserInputRequest): SpaceRuntimeInteractionT | null {
  const options = record(request.options);
  if (request.kind === 'askUserMulti') {
    const rawQuestions = Array.isArray(options?.questions) ? options.questions.slice(0, 20) : [];
    const questions = rawQuestions.map(normalizeMultiQuestion);
    if (questions.length === 0 || questions.some((question) => question === null)) return null;
    return {
      source: 'coder-runtime',
      kind: 'ask-user',
      runId: request.runId,
      createdAt: timestamp(request.createdAt),
      state: 'pending',
      request: {
        kind: 'multi',
        reqId: request.id,
        sessionId: request.sessionId,
        questions: questions.filter(
          (question): question is NonNullable<typeof question> => question !== null,
        ),
      },
    };
  }
  const question = text(options?.question, 2_048);
  if (!question) return null;
  const kind = request.kind === 'askUserInput' || options?.kind === 'input' ? 'input' : 'select';
  const normalizedOptions = Array.isArray(options?.options)
    ? options.options
        .map(normalizeQuestionOption)
        .filter((item) => item !== null)
        .slice(0, 20)
    : [];
  if (kind === 'select' && normalizedOptions.length === 0) return null;
  const header = text(options?.header, 96);
  const defaultValue =
    typeof options?.default === 'string' ? options.default.slice(0, 4_096) : undefined;
  const minSelections = Number.isInteger(options?.minSelections)
    ? Math.max(0, Math.min(20, Number(options?.minSelections)))
    : undefined;
  const maxSelections = Number.isInteger(options?.maxSelections)
    ? Math.max(0, Math.min(20, Number(options?.maxSelections)))
    : undefined;
  return {
    source: 'coder-runtime',
    kind: 'ask-user',
    runId: request.runId,
    createdAt: timestamp(request.createdAt),
    state: 'pending',
    request: {
      kind,
      reqId: request.id,
      sessionId: request.sessionId,
      question,
      ...(header ? { header } : {}),
      ...(kind === 'select' ? { options: normalizedOptions } : {}),
      ...(typeof options?.multiSelect === 'boolean' ? { multiSelect: options.multiSelect } : {}),
      ...(minSelections !== undefined ? { minSelections } : {}),
      ...(maxSelections !== undefined ? { maxSelections } : {}),
      ...(defaultValue !== undefined ? { default: defaultValue } : {}),
      ...(typeof options?.allowCustomInput === 'boolean'
        ? { allowCustomInput: options.allowCustomInput }
        : {}),
      ...(text(options?.customInputLabel, 160)
        ? { customInputLabel: text(options?.customInputLabel, 160)! }
        : {}),
      ...(text(options?.customInputPrompt, 512)
        ? { customInputPrompt: text(options?.customInputPrompt, 512)! }
        : {}),
      ...(typeof options?.customInputDefault === 'string'
        ? { customInputDefault: options.customInputDefault.slice(0, 4_096) }
        : {}),
    },
  };
}

export function projectRuntimeInteractions(
  permissions: readonly RuntimePermissionRequest[],
  userInputs: readonly RuntimeUserInputRequest[],
  sessionId?: string,
): SpaceRuntimeInteractionT[] {
  const permissionItems = permissions
    .filter((request) => sessionId === undefined || request.sessionId === sessionId)
    .map(permissionInteraction);
  const inputItems = userInputs
    .filter((request) => sessionId === undefined || request.sessionId === sessionId)
    .map(userInputInteraction)
    .filter((item): item is SpaceRuntimeInteractionT => item !== null);
  return [...permissionItems, ...inputItems]
    .sort((a, b) => a.createdAt - b.createdAt)
    .slice(0, 500);
}

function latestTextForRun(
  drafts: Readonly<Record<string, string>>,
  runs: readonly RuntimeRunStatus[],
): { text: string; startedAt: number } | undefined {
  const candidates = Object.entries(drafts)
    .filter(([, value]) => value.length > 0)
    .map(([runId, value]) => {
      const run = runs.find((item) => item.runId === runId);
      return {
        text: value.slice(-MAX_DRAFT),
        startedAt: timestamp(run?.runningAt ?? run?.startedAt),
      };
    })
    .sort((a, b) => b.startedAt - a.startedAt);
  return candidates[0];
}

function toolProjection(
  value: RuntimeSessionObservationSnapshot['live']['activeTools'][number],
  runs: readonly RuntimeRunStatus[],
): SpaceSessionLiveProjectionT['activeTools'][number] | null {
  const started = record(value.started);
  const tool = record(started?.tool) ?? started;
  const meta = record(started?.meta);
  const keyTail = value.key.split(':').at(-1);
  const toolCallId = text(meta?.toolCallId, 128) ?? text(tool?.id, 128) ?? text(keyTail, 128);
  const name = text(tool?.name, 128) ?? text(started?.toolName, 128);
  if (!toolCallId || !name) return null;
  const progressRecord = record(value.progress);
  const progress =
    text(progressRecord?.update, 1_024) ??
    text(progressRecord?.partialJson, 1_024) ??
    text(value.progress, 1_024);
  const run = runs.find((item) => item.runId === value.runId);
  return {
    toolCallId,
    name,
    startedAt: timestamp(run?.runningAt ?? run?.startedAt),
    ...(progress ? { progress } : {}),
  };
}

function todoProjection(value: unknown): SpaceSessionLiveProjectionT['todos'] {
  const payload = record(value);
  const items = Array.isArray(payload?.items) ? payload.items : Array.isArray(value) ? value : [];
  return items
    .map((raw) => {
      const item = record(raw);
      const id = text(item?.id, 128);
      const content = text(item?.subject ?? item?.content, 2_048);
      const status = item?.status;
      if (!id || !content || typeof status !== 'string' || !TODO_STATUSES.has(status as never)) {
        return null;
      }
      const activeForm = text(item?.activeForm, 2_048);
      return {
        id,
        content,
        status: status as SpaceSessionLiveProjectionT['todos'][number]['status'],
        ...(activeForm ? { activeForm } : {}),
      };
    })
    .filter((item): item is SpaceSessionLiveProjectionT['todos'][number] => item !== null)
    .slice(0, MAX_TODOS);
}

function pendingUserInputsFromSnapshot(
  snapshot: RuntimeSessionObservationSnapshot,
): RuntimeUserInputRequest[] {
  return snapshot.live.pendingUserInputs
    .map((item): RuntimeUserInputRequest | null => {
      const value = record(item.detail);
      if (!value) return null;
      const kind = value.kind;
      if (kind !== 'askUser' && kind !== 'askUserMulti' && kind !== 'askUserInput') return null;
      if (typeof value.id === 'string') return item.detail as RuntimeUserInputRequest;

      // Older emitters use the compact typed event payload. Observation still
      // carries its authoritative request/run identity; response always reloads
      // the current request/revision from userInputs.listPending().
      const run = snapshot.runs.find((candidate) => candidate.runId === item.runId);
      const createdAt = run?.runningAt ?? run?.startedAt ?? run?.acceptedAt ?? run?.queuedAt;
      return {
        id: item.requestId,
        revision: 0,
        sessionId: snapshot.session.id,
        runId: item.runId,
        ...(item.turnId ? { turnId: item.turnId } : {}),
        kind,
        options: value.options,
        createdAt: createdAt ?? new Date(0).toISOString(),
        expiresAt: '',
      };
    })
    .filter((item): item is RuntimeUserInputRequest => item !== null);
}

function queuedInputsProjection(
  runs: readonly RuntimeRunStatus[],
  sessionId: string,
): SpaceSessionLiveProjectionT['queuedInputs'] {
  return runs
    .filter(
      (run) =>
        run.sessionId === sessionId &&
        run.continuation?.delivery === 'after_turn' &&
        run.continuation.state === 'queued',
    )
    .sort((a, b) => (a.sessionOrder ?? 0) - (b.sessionOrder ?? 0))
    .slice(0, 500)
    .map((run, index) => ({
      inputId: run.continuation!.inputId,
      sessionId: run.sessionId,
      delivery: 'after-turn' as const,
      state: 'queued' as const,
      createdAt: timestamp(run.queuedAt ?? run.acceptedAt ?? run.startedAt),
      position: index + 1,
      contentPreview: run.continuation!.contentPreview.slice(0, 4_096),
      ...(run.origin
        ? {
            initiatedBy: {
              clientId: run.origin.principalId.slice(0, 128),
              name: (run.origin.clientName ?? run.origin.principalId).slice(0, 128),
            },
          }
        : {}),
    }));
}

const REASONING_MODES = new Set(['off', 'auto', 'quick', 'balanced', 'deep']);
const PERMISSION_MODES = new Set(['plan', 'accept-edits', 'auto']);

function settingsProjection(
  revision: number,
  value: RuntimeSessionSettings,
): NonNullable<SpaceSessionLiveProjectionT['settings']> {
  return {
    revision: Math.max(0, Math.trunc(revision)),
    value: {
      ...(text(value.provider, 64) ? { provider: text(value.provider, 64)! } : {}),
      ...(text(value.model, 128) ? { model: text(value.model, 128)! } : {}),
      ...(text(value.effort, 64) ? { effort: text(value.effort, 64)! } : {}),
      ...(typeof value.thinking === 'boolean' ? { thinking: value.thinking } : {}),
      ...(typeof value.reasoningMode === 'string' && REASONING_MODES.has(value.reasoningMode)
        ? {
            reasoningMode: value.reasoningMode as 'off' | 'auto' | 'quick' | 'balanced' | 'deep',
          }
        : {}),
      ...(typeof value.permissionMode === 'string' && PERMISSION_MODES.has(value.permissionMode)
        ? { permissionMode: value.permissionMode as 'plan' | 'accept-edits' | 'auto' }
        : {}),
      ...(text(value.executionCwd, 4_096)
        ? { executionCwd: text(value.executionCwd, 4_096)! }
        : {}),
      ...(value.agentMode === 'ama' || value.agentMode === 'amaw' || value.agentMode === 'sa'
        ? { agentMode: value.agentMode }
        : {}),
      ...(value.autoModeEngine === 'llm' || value.autoModeEngine === 'rules'
        ? { autoModeEngine: value.autoModeEngine }
        : {}),
    },
  };
}

function managedTaskProjection(
  snapshot: RuntimeSessionObservationSnapshot,
): SpaceSessionLiveProjectionT['managedTask'] {
  const candidate = snapshot.live.managedTasks
    .filter((item) => item.runId && snapshot.runs.some((run) => run.runId === item.runId))
    .sort((a, b) => {
      const runA = snapshot.runs.find((run) => run.runId === a.runId);
      const runB = snapshot.runs.find((run) => run.runId === b.runId);
      return (
        timestamp(runB?.runningAt ?? runB?.startedAt) -
        timestamp(runA?.runningAt ?? runA?.startedAt)
      );
    })[0];
  if (!candidate) return undefined;
  const status = candidate.status;
  const run = snapshot.runs.find((item) => item.runId === candidate.runId);
  const phase = text(status.phase ?? status.harnessProfile, 64);
  if (!phase) return undefined;
  return {
    phase,
    ...(text(status.activeWorkerId, 128)
      ? { activeWorkerId: text(status.activeWorkerId, 128)! }
      : {}),
    ...(text(status.activeWorkerTitle, 256)
      ? { activeWorkerTitle: text(status.activeWorkerTitle, 256)! }
      : {}),
    ...(text(status.note ?? status.detailNote, 1_024)
      ? { summary: text(status.note ?? status.detailNote, 1_024)! }
      : {}),
    updatedAt: timestamp(run?.runningAt ?? run?.startedAt),
  };
}

export function projectRuntimeSessionSnapshot(
  snapshot: RuntimeSessionObservationSnapshot,
  userInputs: readonly RuntimeUserInputRequest[] = pendingUserInputsFromSnapshot(snapshot),
): SpaceSessionLiveProjectionT {
  const runs = runsForSession(snapshot.runs, snapshot.session.id);
  const assistantDraft = latestTextForRun(snapshot.live.assistantTextByRun, snapshot.runs);
  const thinkingDraft = latestTextForRun(snapshot.live.thinkingTextByRun, snapshot.runs);
  const managedTask = managedTaskProjection(snapshot);
  return spaceSessionLiveProjectionSchema.parse({
    sessionId: snapshot.session.id,
    projectionRevision: 1,
    cursor: { runtimeId: snapshot.runtimeId, seq: snapshot.cursor },
    transcriptRevision: snapshot.transcriptRevision,
    ...runs,
    ...(assistantDraft ? { assistantDraft } : {}),
    ...(thinkingDraft ? { thinkingDraft } : {}),
    activeTools: snapshot.live.activeTools
      .map((item) => toolProjection(item, snapshot.runs))
      .filter((item): item is NonNullable<typeof item> => item !== null)
      .slice(0, MAX_TOOLS),
    todos: todoProjection(snapshot.live.todo),
    ...(managedTask ? { managedTask } : {}),
    settings: settingsProjection(snapshot.settings.revision, snapshot.settings.value),
    queuedInputs: queuedInputsProjection(snapshot.runs, snapshot.session.id),
    interactions: projectRuntimeInteractions(
      snapshot.pendingPermissions,
      userInputs,
      snapshot.session.id,
    ),
  });
}

export function projectRuntimeProfile(input: {
  readonly status: RuntimeStatusSnapshot;
  readonly userInputs: readonly RuntimeUserInputRequest[];
  readonly cursor: number;
  readonly projectionRevision: number;
  readonly changedAt: number;
  readonly capabilities: readonly SpaceRuntimeCapabilityT[];
  readonly connectionState?: 'ready' | 'degraded';
  readonly reason?: string;
}): SpaceRuntimeProfileProjectionT {
  const codeSessions = input.status.sessions.filter((session) => session.surface !== 'partner');
  return spaceRuntimeProfileProjectionSchema.parse({
    connection: {
      state: input.connectionState ?? 'ready',
      changedAt: input.changedAt,
      stale: input.connectionState === 'degraded',
      runtimeId: input.status.runtimeId,
      profile: input.status.profile,
      ...(input.reason ? { reason: input.reason.slice(0, MAX_REASON) } : {}),
      capabilities: input.capabilities,
    },
    projectionRevision: input.projectionRevision,
    cursor: { runtimeId: input.status.runtimeId, seq: input.cursor },
    sessions: codeSessions.slice(0, 500).map((session) => {
      const runs = runsForSession(input.status.runs, session.id);
      const createdAt = timestamp(session.createdAt);
      const ownRuns = input.status.runs.filter((run) => run.sessionId === session.id);
      const lastActivityAt = Math.max(
        createdAt,
        ...ownRuns.map((run) => timestamp(run.endedAt ?? run.runningAt ?? run.startedAt)),
      );
      return {
        sessionId: session.id,
        surface: 'code' as const,
        ...(session.title ? { title: session.title.slice(0, 256) } : {}),
        ...(session.workspaceRoot || session.gitRoot
          ? { projectRoot: (session.workspaceRoot ?? session.gitRoot)!.slice(0, 4_096) }
          : {}),
        createdAt,
        lastActivityAt,
        ...runs,
      };
    }),
    interactions: projectRuntimeInteractions(input.status.pendingPermissions, input.userInputs),
    notifications: [],
  });
}

function runStatusFromEvent(event: RuntimeTypedEvent): RuntimeRunStatus | undefined {
  const value = record(event.payload);
  if (
    !value ||
    typeof value.runId !== 'string' ||
    typeof value.sessionId !== 'string' ||
    typeof value.phase !== 'string' ||
    typeof value.startedAt !== 'string' ||
    typeof value.provider !== 'string'
  ) {
    return undefined;
  }
  return event.payload as RuntimeRunStatus;
}

export class CoderSessionProjectionReducer {
  #projection: SpaceSessionLiveProjectionT;
  readonly #runs = new Map<string, RuntimeRunStatus>();

  constructor(projection: SpaceSessionLiveProjectionT, runs: readonly RuntimeRunStatus[] = []) {
    this.#projection = spaceSessionLiveProjectionSchema.parse(projection);
    for (const run of runs) this.#runs.set(run.runId, run);
  }

  snapshot(): SpaceSessionLiveProjectionT {
    return structuredClone(this.#projection);
  }

  replaceInteractions(
    seq: number,
    permissions: readonly RuntimePermissionRequest[],
    userInputs: readonly RuntimeUserInputRequest[],
  ): SpaceSessionLiveChangedT {
    return this.#commit(seq, {
      domain: 'interaction',
      interactions: projectRuntimeInteractions(permissions, userInputs, this.#projection.sessionId),
    });
  }

  apply(event: RuntimeTypedEvent): SpaceSessionLiveChangedT | null {
    if (event.sessionId !== this.#projection.sessionId) return null;
    if (event.seq <= this.#projection.cursor.seq) return null;
    const payload = record(event.payload);
    if (event.type === 'assistant.delta' && typeof payload?.text === 'string') {
      const current = this.#projection.assistantDraft?.text ?? '';
      const startedAt = this.#runStartedAt(event.runId, event.time);
      return this.#commit(event.seq, {
        domain: 'draft',
        assistantDraft: { text: `${current}${payload.text}`.slice(-MAX_DRAFT), startedAt },
        thinkingDraft: this.#projection.thinkingDraft ?? null,
      });
    }
    if (event.type === 'thinking.delta' && typeof payload?.text === 'string') {
      const current = this.#projection.thinkingDraft?.text ?? '';
      return this.#commit(event.seq, {
        domain: 'draft',
        assistantDraft: this.#projection.assistantDraft ?? null,
        thinkingDraft: {
          text: `${current}${payload.text}`.slice(-MAX_DRAFT),
          startedAt: this.#runStartedAt(event.runId, event.time),
        },
      });
    }
    if (event.type === 'thinking.finished' && typeof payload?.thinking === 'string') {
      return this.#commit(event.seq, {
        domain: 'draft',
        assistantDraft: this.#projection.assistantDraft ?? null,
        thinkingDraft: {
          text: payload.thinking.slice(-MAX_DRAFT),
          startedAt: this.#runStartedAt(event.runId, event.time),
        },
      });
    }
    if (event.type === 'tool.started') {
      const meta = record(payload?.meta);
      const tool = record(payload?.tool);
      const toolCallId = text(meta?.toolCallId, 128) ?? text(tool?.id, 128) ?? event.id;
      const name = text(tool?.name, 128) ?? text(payload?.toolName, 128) ?? 'tool';
      const activeTools = [
        ...this.#projection.activeTools.filter((item) => item.toolCallId !== toolCallId),
        { toolCallId, name, startedAt: timestamp(event.time) },
      ].slice(-MAX_TOOLS);
      return this.#commit(event.seq, { domain: 'tools', activeTools });
    }
    if (event.type === 'tool.progress') {
      const meta = record(payload?.meta);
      const update = record(payload?.update);
      const toolCallId = text(meta?.toolCallId, 128) ?? text(update?.id, 128);
      const progress = text(update?.message, 1_024) ?? text(payload?.partialJson, 1_024);
      const index = toolCallId
        ? this.#projection.activeTools.findIndex((item) => item.toolCallId === toolCallId)
        : this.#projection.activeTools.length - 1;
      if (index < 0) return null;
      const activeTools = [...this.#projection.activeTools];
      activeTools[index] = { ...activeTools[index]!, ...(progress ? { progress } : {}) };
      return this.#commit(event.seq, { domain: 'tools', activeTools });
    }
    if (event.type === 'tool.finished') {
      const meta = record(payload?.meta);
      const result = record(payload?.result);
      const toolCallId =
        text(meta?.toolCallId, 128) ?? text(result?.id, 128) ?? text(result?.toolCallId, 128);
      const activeTools = toolCallId
        ? this.#projection.activeTools.filter((item) => item.toolCallId !== toolCallId)
        : this.#projection.activeTools.slice(0, -1);
      return this.#commit(event.seq, { domain: 'tools', activeTools });
    }
    if (event.type === 'todo.updated') {
      return this.#commit(event.seq, { domain: 'todos', todos: todoProjection(event.payload) });
    }
    if (event.type === 'run.progress' && payload?.kind === 'managed_task_status') {
      const status = record(payload.status);
      const phase = text(status?.phase, 64);
      if (!phase) return null;
      return this.#commit(event.seq, {
        domain: 'managedTask',
        managedTask: {
          phase,
          ...(text(status?.activeWorkerId, 128)
            ? { activeWorkerId: text(status?.activeWorkerId, 128)! }
            : {}),
          ...(text(status?.activeWorkerTitle, 256)
            ? { activeWorkerTitle: text(status?.activeWorkerTitle, 256)! }
            : {}),
          ...(text(status?.note ?? status?.detailNote, 1_024)
            ? { summary: text(status?.note ?? status?.detailNote, 1_024)! }
            : {}),
          updatedAt: timestamp(event.time),
        },
      });
    }
    if (event.type === 'session.settings.updated') {
      const revision = payload?.revision;
      const settings = record(payload?.settings);
      if (!Number.isInteger(revision) || !settings) return null;
      return this.#commit(event.seq, {
        domain: 'settings',
        settings: settingsProjection(Number(revision), settings as RuntimeSessionSettings),
      });
    }
    if (event.type.startsWith('run.')) {
      const previousActiveRunId = this.#projection.activeRun?.runId;
      const run = runStatusFromEvent(event);
      if (!run) return null;
      this.#runs.set(run.runId, run);
      const runs = runsForSession([...this.#runs.values()], this.#projection.sessionId);
      const nextActiveRunId = runs.activeRun?.runId;
      const resetRunScopedState =
        (TERMINAL_PHASES.has(run.phase as never) && previousActiveRunId === run.runId) ||
        (nextActiveRunId !== undefined && nextActiveRunId !== previousActiveRunId);
      return this.#commit(
        event.seq,
        {
          domain: 'run',
          activeRun: runs.activeRun ?? null,
          queuedRuns: runs.queuedRuns,
          queuedInputs: queuedInputsProjection(
            [...this.#runs.values()],
            this.#projection.sessionId,
          ),
          ...(resetRunScopedState ? { resetRunScopedState: true } : {}),
        },
        runs.lastTerminalRun,
      );
    }
    return null;
  }

  #runStartedAt(runId: string, fallback: string): number {
    const run = this.#runs.get(runId);
    return timestamp(run?.runningAt ?? run?.startedAt, timestamp(fallback));
  }

  #commit(
    seq: number,
    change: SpaceSessionLiveChangedT['change'],
    lastTerminalRun?: SpaceRuntimeRunProjectionT,
  ): SpaceSessionLiveChangedT {
    const baseProjectionRevision = this.#projection.projectionRevision;
    const projectionRevision = baseProjectionRevision + 1;
    const cursor = { runtimeId: this.#projection.cursor.runtimeId, seq };
    switch (change.domain) {
      case 'run':
        this.#projection = {
          ...this.#projection,
          projectionRevision,
          cursor,
          activeRun: change.activeRun ?? undefined,
          queuedRuns: change.queuedRuns,
          ...(change.queuedInputs !== undefined ? { queuedInputs: change.queuedInputs } : {}),
          ...(change.resetRunScopedState
            ? {
                assistantDraft: undefined,
                thinkingDraft: undefined,
                activeTools: [],
                managedTask: undefined,
                interactions: [],
              }
            : {}),
          ...(lastTerminalRun ? { lastTerminalRun } : {}),
        };
        break;
      case 'draft':
        this.#projection = {
          ...this.#projection,
          projectionRevision,
          cursor,
          assistantDraft: change.assistantDraft ?? undefined,
          thinkingDraft: change.thinkingDraft ?? undefined,
        };
        break;
      case 'tools':
        this.#projection = {
          ...this.#projection,
          projectionRevision,
          cursor,
          activeTools: change.activeTools,
        };
        break;
      case 'todos':
        this.#projection = { ...this.#projection, projectionRevision, cursor, todos: change.todos };
        break;
      case 'managedTask':
        this.#projection = {
          ...this.#projection,
          projectionRevision,
          cursor,
          managedTask: change.managedTask ?? undefined,
        };
        break;
      case 'settings':
        this.#projection = {
          ...this.#projection,
          projectionRevision,
          cursor,
          settings: change.settings,
        };
        break;
      case 'interaction':
        this.#projection = {
          ...this.#projection,
          projectionRevision,
          cursor,
          interactions: change.interactions,
        };
        break;
      case 'queue':
        this.#projection = {
          ...this.#projection,
          projectionRevision,
          cursor,
          queuedInputs: change.queuedInputs,
        };
        break;
      case 'terminal':
        this.#projection = {
          ...this.#projection,
          projectionRevision,
          cursor,
          lastTerminalRun: change.lastTerminalRun,
        };
        break;
    }
    this.#projection = spaceSessionLiveProjectionSchema.parse(this.#projection);
    return spaceSessionLiveChangedSchema.parse({
      sessionId: this.#projection.sessionId,
      baseProjectionRevision,
      projectionRevision,
      cursor,
      change,
    });
  }
}
