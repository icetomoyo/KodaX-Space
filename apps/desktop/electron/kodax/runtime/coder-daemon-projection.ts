import type {
  RuntimeIntegrationHealth,
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
  spaceRuntimeToolSandboxSchema,
  spaceSessionLiveChangedSchema,
  spaceSessionLiveProjectionSchema,
  providerRecoveryReplacesDraft,
  type SpaceRuntimeCapabilityT,
  type SpaceRuntimeIntegrationHealthT,
  type SpaceRuntimeInteractionT,
  type SpaceRuntimeProfileProjectionT,
  type SpaceRuntimeRunProjectionT,
  type SpaceSessionLiveChangedT,
  type SpaceSessionLiveProjectionT,
  type SpaceRuntimeToolSandboxT,
} from '@kodax-space/space-ipc-schema';
import { assessRisk } from '../../permission/risk.js';
import { sanitizeForDisplay, sanitizeInputForDisplay } from '../../permission/sanitize.js';
import { projectAutoModeDiagnostics } from '../../permission/auto-mode-diagnostics.js';
import { isTransientChildEvent, type ChildMeta } from '../workflow-activity.js';

const MAX_DRAFT = 256 * 1024;
const MAX_REASON = 512;
const MAX_PERMISSION_INPUT_PREVIEW = 8_192;
const MAX_TODOS = 1_000;
const MAX_TOOLS = 128;
const MAX_PROFILE_SESSIONS = 500;
const ACTIVE_PHASES = new Set([
  'running',
  'waiting_agent',
  'recovering',
  'waiting_permission',
  'waiting_user_input',
  'unknown',
] as const);
const TERMINAL_PHASES = new Set(['completed', 'failed', 'cancelled', 'interrupted'] as const);
const TODO_STATUSES = new Set([
  'pending',
  'in_progress',
  'completed',
  'failed',
  'skipped',
  'cancelled',
] as const);
const READ_OPERATIONS = new Set([
  'read',
  'read_file',
  'read_pdf',
  'grep',
  'glob',
  'list',
  'ls',
  'search',
  'view',
  'web_search',
]);
const WRITE_OPERATIONS = new Set(['write', 'edit', 'patch', 'multi_edit', 'apply_diff']);
const EXECUTE_OPERATIONS = new Set(['bash', 'shell', 'exec', 'skill_dynamic_context']);
const NETWORK_OPERATIONS = new Set(['fetch', 'http', 'curl', 'network', 'web_fetch']);

function record(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : undefined;
}

function recoveryReplacesProvisionalAttempt(
  payload: Readonly<Record<string, unknown>> | undefined,
): boolean {
  const recovery = record(payload?.event);
  const stage = recovery?.stage;
  const action = recovery?.recoveryAction;
  return (
    typeof stage === 'string' &&
    typeof action === 'string' &&
    providerRecoveryReplacesDraft({ stage, recoveryAction: action })
  );
}

export function isTransientChildRuntimeEvent(event: RuntimeTypedEvent): boolean {
  const payload = record(event.payload);
  return (
    isTransientChildEvent(payload as ChildMeta) ||
    isTransientChildEvent(record(payload?.meta) as ChildMeta)
  );
}

export function runtimeTurnStartedId(event: RuntimeTypedEvent): string | undefined {
  if (event.type !== 'turn.started') return undefined;
  if (event.turnId !== undefined) return event.turnId;
  const payload = record(event.payload);
  return typeof payload?.turnId === 'string' ? payload.turnId : undefined;
}

/**
 * Runtime summaries from older Sessions may expose only the persisted Space
 * tag. Treat every available ownership marker as authoritative so a legacy
 * Partner Session is never projected onto the Coder surface.
 */
export function isPartnerRuntimeSessionIdentity(value: unknown): boolean {
  const session = record(value);
  const runtimeInfo = record(session?.runtimeInfo);
  return (
    session?.tag === 'partner' ||
    session?.surface === 'partner' ||
    session?.profileId === 'kodax-space.partner' ||
    runtimeInfo?.surface === 'partner'
  );
}

/**
 * `status.snapshot()` bounds its recent Session summaries independently from its Run index. An
 * out-of-page Run has no surface identity, so include it only after main has independently verified
 * the persisted Session as Coder. Unknown identities fail closed at the Coder/Partner boundary.
 */
export function coderRuntimeSessionIds(
  status: RuntimeStatusSnapshot,
  verifiedOutOfPageCoderSessionIds: ReadonlySet<string> = new Set(),
): ReadonlySet<string> {
  const sessionById = new Map(status.sessions.map((session) => [session.id, session]));
  const sessionIds = new Set(
    status.sessions
      .filter((session) => !isPartnerRuntimeSessionIdentity(session))
      .map((session) => session.id),
  );
  for (const run of status.runs) {
    if (run.phase !== 'queued' && !ACTIVE_PHASES.has(run.phase as never)) continue;
    const knownSession = sessionById.get(run.sessionId);
    if (knownSession !== undefined && isPartnerRuntimeSessionIdentity(knownSession)) continue;
    if (knownSession === undefined && !verifiedOutOfPageCoderSessionIds.has(run.sessionId))
      continue;
    sessionIds.add(run.sessionId);
  }
  return sessionIds;
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

function nonNegativeInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

function runtimePhase(phase: RuntimeRunStatus['phase']): SpaceRuntimeRunProjectionT['phase'] {
  return phase;
}

export function projectRuntimeRun(
  run: RuntimeRunStatus,
  queuePosition?: number,
): SpaceRuntimeRunProjectionT {
  const origin = run.origin;
  const activeSubtaskCount = nonNegativeInteger(run.activeSubtaskCount);
  return {
    runId: run.runId,
    sessionId: run.sessionId,
    ...(run.turnId !== undefined ? { turnId: run.turnId } : {}),
    phase: runtimePhase(run.phase),
    ...(run.stage !== undefined ? { stage: run.stage } : {}),
    ...(run.stageChangedAt !== undefined ? { stageChangedAt: timestamp(run.stageChangedAt) } : {}),
    ...(activeSubtaskCount !== undefined ? { activeSubtaskCount } : {}),
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
    ...(run.lifecycleError !== undefined
      ? {
          lifecycleError: {
            code: run.lifecycleError.code,
            message: run.lifecycleError.message.slice(0, MAX_REASON),
            retryable: run.lifecycleError.retryable,
          },
        }
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
    ...(run.stop !== undefined
      ? {
          stop: {
            requestedAt: timestamp(run.stop.requestedAt),
            state: run.stop.state,
            outcome: run.stop.outcome,
            reason: run.stop.reason.slice(0, MAX_REASON) || 'Stop outcome is unknown.',
            ...(run.stop.resolvedAt !== undefined
              ? { resolvedAt: timestamp(run.stop.resolvedAt) }
              : {}),
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

const RECOVERABLE_PERMISSION_INPUT_FIELDS = new Set([
  'command',
  'description',
  'path',
  'cwd',
  'url',
]);

function skipWhitespace(source: string, from: number): number {
  let index = from;
  while (index < source.length && /\s/.test(source[index] ?? '')) index += 1;
  return index;
}

function jsonStringEnd(source: string, from: number): number | undefined {
  if (source[from] !== '"') return undefined;
  let escaped = false;
  for (let index = from + 1; index < source.length; index += 1) {
    const character = source[index];
    if (escaped) {
      escaped = false;
    } else if (character === '\\') {
      escaped = true;
    } else if (character === '"') {
      return index + 1;
    }
  }
  return undefined;
}

function jsonValueEnd(source: string, from: number): number | undefined {
  const start = skipWhitespace(source, from);
  if (source[start] === '"') return jsonStringEnd(source, start);
  if (source[start] === '{' || source[start] === '[') {
    const stack = [source[start] === '{' ? '}' : ']'];
    let stringStart: number | undefined;
    for (let index = start + 1; index < source.length; index += 1) {
      if (stringStart !== undefined) {
        const end = jsonStringEnd(source, stringStart);
        if (end === undefined) return undefined;
        index = end - 1;
        stringStart = undefined;
        continue;
      }
      const character = source[index];
      if (character === '"') stringStart = index;
      else if (character === '{') stack.push('}');
      else if (character === '[') stack.push(']');
      else if (character === stack.at(-1)) {
        stack.pop();
        if (stack.length === 0) return index + 1;
      }
    }
    return undefined;
  }
  for (let index = start; index < source.length; index += 1) {
    if (source[index] === ',' || source[index] === '}') return index;
  }
  return undefined;
}

function permissionPreviewSizeLabel(length: number): string {
  return length >= 1024 ? `${(length / 1024).toFixed(1)} KB` : `${length} chars`;
}

function recoverPermissionInputPrefix(inputPreview: string): Record<string, unknown> | undefined {
  let index = skipWhitespace(inputPreview, 0);
  if (inputPreview[index] !== '{') return undefined;
  index += 1;
  const recovered: Record<string, unknown> = {};

  while (index < inputPreview.length) {
    index = skipWhitespace(inputPreview, index);
    if (inputPreview[index] === ',') {
      index = skipWhitespace(inputPreview, index + 1);
    }
    if (inputPreview[index] === '}') break;
    const keyEnd = jsonStringEnd(inputPreview, index);
    if (keyEnd === undefined) break;
    let key: unknown;
    try {
      key = JSON.parse(inputPreview.slice(index, keyEnd)) as unknown;
    } catch {
      break;
    }
    index = skipWhitespace(inputPreview, keyEnd);
    if (inputPreview[index] !== ':') break;
    const valueStart = skipWhitespace(inputPreview, index + 1);
    const valueEnd = jsonValueEnd(inputPreview, valueStart);
    if (valueEnd === undefined) break;
    if (typeof key === 'string' && RECOVERABLE_PERMISSION_INPUT_FIELDS.has(key)) {
      try {
        const value = JSON.parse(inputPreview.slice(valueStart, valueEnd)) as unknown;
        if (typeof value === 'string') recovered[key] = value;
      } catch {
        break;
      }
    }
    index = skipWhitespace(inputPreview, valueEnd);
    if (inputPreview[index] === '}') break;
    if (inputPreview[index] !== ',') break;
  }

  if (Object.keys(recovered).length === 0) return undefined;
  return {
    ...recovered,
    _inputPreview: `[PARTIAL: recovered display fields from truncated permission input preview (${permissionPreviewSizeLabel(inputPreview.length)})]`,
    __truncated: true,
  };
}

function parsePermissionInput(inputPreview: unknown): Record<string, unknown> | undefined {
  if (typeof inputPreview !== 'string' || inputPreview.length === 0) return undefined;
  if (inputPreview.length > MAX_PERMISSION_INPUT_PREVIEW) {
    return {
      _inputPreview: `[OMITTED: oversized permission input preview (${permissionPreviewSizeLabel(inputPreview.length)})]`,
      __truncated: true,
    };
  }
  try {
    const parsed = JSON.parse(inputPreview) as unknown;
    const input = record(parsed);
    if (!input) {
      return {
        _inputPreview: '[OMITTED: non-object permission input preview]',
        __truncated: true,
      };
    }
    return { ...input };
  } catch {
    return (
      recoverPermissionInputPrefix(inputPreview) ?? {
        _inputPreview: '[OMITTED: invalid permission input preview]',
        __truncated: true,
      }
    );
  }
}

function permissionOperation(
  toolName: string,
): 'read' | 'write' | 'execute' | 'network' | 'unknown' {
  const normalized = toolName.toLowerCase();
  if (READ_OPERATIONS.has(normalized)) return 'read';
  if (WRITE_OPERATIONS.has(normalized)) return 'write';
  if (EXECUTE_OPERATIONS.has(normalized)) return 'execute';
  if (NETWORK_OPERATIONS.has(normalized)) return 'network';
  return 'unknown';
}

function permissionInteraction(
  request: RuntimePermissionRequest,
  fallbackExecutionCwd?: string,
): SpaceRuntimeInteractionT {
  const rawInput = parsePermissionInput(request.inputPreview);
  const safeInput = sanitizeInputForDisplay(rawInput);
  const safeToolName = sanitizeForDisplay(request.toolName, 128) || '(unnamed)';
  const assessment = assessRisk(request.toolName, rawInput);
  const description =
    typeof safeInput?.description === 'string' ? safeInput.description : undefined;
  const reasonSource = assessment.dangerous
    ? assessment.reason
    : (text(request.reason, 512) ?? description ?? assessment.reason);
  const reason =
    sanitizeForDisplay(reasonSource, 512) || `Permission requested for ${safeToolName}`;
  const extendedRequest = request as RuntimePermissionRequest & {
    readonly executionCwd?: unknown;
  };
  const executionCwd = sanitizeForDisplay(
    text(extendedRequest.executionCwd, 4_096) ?? fallbackExecutionCwd ?? '',
    4_096,
  );
  const persistentGrantSuggestion = request.grantSuggestions?.find(
    (suggestion) => suggestion.kind === 'persistent',
  );
  const persistentGrantLabel = persistentGrantSuggestion
    ? sanitizeForDisplay(persistentGrantSuggestion.label, 512)
    : '';
  const autoModeDiagnostics = projectAutoModeDiagnostics(request.autoModeDiagnostics);
  return {
    source: 'coder-runtime',
    kind: 'permission',
    ...(request.runId ? { runId: request.runId } : {}),
    createdAt: timestamp(request.createdAt),
    state: 'pending',
    request: {
      reqId: request.id,
      sessionId: request.sessionId,
      risk: assessment.dangerous ? 'danger' : (request.risk ?? assessment.risk),
      reason,
      ...(autoModeDiagnostics ? { autoModeDiagnostics } : {}),
      toolCall: {
        toolId: request.toolCallId ?? request.id,
        toolName: safeToolName,
        operation: permissionOperation(request.toolName),
        ...(executionCwd ? { executionCwd } : {}),
        ...(safeInput ? { input: safeInput } : {}),
      },
      ...(!assessment.dangerous && persistentGrantLabel
        ? {
            allowAlwaysScope: {
              kind: 'runtime_persistent' as const,
              label: persistentGrantLabel,
            },
          }
        : {}),
    },
  };
}

function projectSandboxObservation(value: unknown): SpaceRuntimeToolSandboxT | undefined {
  const parsed = spaceRuntimeToolSandboxSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
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
  executionCwd?: string,
): SpaceRuntimeInteractionT[] {
  const permissionItems = permissions
    .filter((request) => sessionId === undefined || request.sessionId === sessionId)
    .map((request) => permissionInteraction(request, executionCwd));
  const inputItems = userInputs
    .filter((request) => sessionId === undefined || request.sessionId === sessionId)
    .map(userInputInteraction)
    .filter((item): item is SpaceRuntimeInteractionT => item !== null);
  return [...permissionItems, ...inputItems]
    .sort((a, b) => a.createdAt - b.createdAt)
    .slice(0, 500);
}

function textForRun(
  drafts: Readonly<Record<string, string>>,
  runs: readonly RuntimeRunStatus[],
  runId: string | undefined,
): { text: string; startedAt: number } | undefined {
  if (runId === undefined) return undefined;
  const value = drafts[runId];
  if (value === undefined || value.length === 0) return undefined;
  const run = runs.find((item) => item.runId === runId);
  return {
    text: value.slice(-MAX_DRAFT),
    startedAt: timestamp(run?.runningAt ?? run?.startedAt),
  };
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
  const sandboxUpdate = record(record(value.sandbox)?.update);
  const sandbox = projectSandboxObservation(sandboxUpdate?.observation);
  return {
    toolCallId,
    name,
    startedAt: timestamp(run?.runningAt ?? run?.startedAt),
    ...(progress ? { progress } : {}),
    ...(sandbox ? { sandbox } : {}),
  };
}

function projectIntegrationHealth(
  value: RuntimeIntegrationHealth | undefined,
): SpaceRuntimeIntegrationHealthT | undefined {
  if (!value) return undefined;
  return {
    state: value.state,
    domains: value.domains.slice(0, 3).map((domain) => {
      const diagnosticMessage = domain.diagnostic
        ? sanitizeForDisplay(domain.diagnostic.message, MAX_REASON)
        : '';
      return {
        domain: domain.domain,
        path: domain.path.slice(0, 4_096),
        ...(domain.revision ? { revision: domain.revision.slice(0, 256) } : {}),
        ...(domain.source ? { source: domain.source } : {}),
        ...(domain.lastReloadAt !== undefined
          ? { lastReloadAt: timestamp(domain.lastReloadAt) }
          : {}),
        ...(domain.diagnostic && diagnosticMessage
          ? {
              diagnostic: {
                code: domain.diagnostic.code,
                message: diagnosticMessage,
                time: timestamp(domain.diagnostic.time),
              },
            }
          : {}),
        watching: domain.watching,
      };
    }),
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
      ...(value.agentMode === 'ama' || value.agentMode === 'sa'
        ? { agentMode: value.agentMode }
        : {}),
      ...(value.autoModeEngine === 'llm' || value.autoModeEngine === 'rules'
        ? { autoModeEngine: value.autoModeEngine }
        : {}),
      ...(text(value.autoModeClassifierModel, 128)
        ? { autoModeClassifierModel: text(value.autoModeClassifierModel, 128)! }
        : {}),
      ...(typeof value.autoModeTimeoutMs === 'number' &&
      Number.isInteger(value.autoModeTimeoutMs) &&
      value.autoModeTimeoutMs > 0 &&
      value.autoModeTimeoutMs <= 3_600_000
        ? { autoModeTimeoutMs: value.autoModeTimeoutMs }
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
  // Drafts repair only an active Run. Terminal answer tails converge through canonical history;
  // projecting a leftover draft after terminal would both bypass persistence and risk assigning a
  // different Run's keyed text to lastTerminalRun.
  const assistantDraft = textForRun(
    snapshot.live.assistantTextByRun,
    snapshot.runs,
    runs.activeRun?.runId,
  );
  const thinkingDraft = textForRun(
    snapshot.live.thinkingTextByRun,
    snapshot.runs,
    runs.activeRun?.runId,
  );
  const managedTask = managedTaskProjection(snapshot);
  return spaceSessionLiveProjectionSchema.parse({
    sessionId: snapshot.session.id,
    projectionRevision: 1,
    cursor: {
      runtimeId: snapshot.runtimeId,
      sessionId: snapshot.cursor.sessionId,
      journalEpoch: snapshot.cursor.journalEpoch,
      seq: snapshot.cursor.seq,
    },
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
      snapshot.settings.value.executionCwd,
    ),
  });
}

/**
 * Replace Runtime's cumulative text/thinking snapshot with an attempt-aware projection rebuilt
 * from the same active Run's journal. Other live domains remain owned by the observation snapshot.
 */
export function projectRuntimeSessionSnapshotWithDraftReplay(
  snapshot: RuntimeSessionObservationSnapshot,
  replayEvents: readonly RuntimeTypedEvent[],
): SpaceSessionLiveProjectionT {
  const projected = projectRuntimeSessionSnapshot(snapshot);
  return new CoderSessionProjectionReducer(projected, snapshot.runs, replayEvents).snapshot();
}

export function projectRuntimeProfile(input: {
  readonly status: RuntimeStatusSnapshot;
  readonly verifiedOutOfPageCoderSessionIds?: ReadonlySet<string>;
  readonly userInputs: readonly RuntimeUserInputRequest[];
  readonly cursor: number;
  readonly projectionRevision: number;
  readonly changedAt: number;
  readonly capabilities: readonly SpaceRuntimeCapabilityT[];
  readonly integrations?: RuntimeIntegrationHealth;
  readonly connectionState?: 'ready' | 'degraded';
  readonly reason?: string;
}): SpaceRuntimeProfileProjectionT {
  const codeSessions = input.status.sessions.filter(
    (session) => !isPartnerRuntimeSessionIdentity(session),
  );
  const codeSessionIds = coderRuntimeSessionIds(
    input.status,
    input.verifiedOutOfPageCoderSessionIds,
  );
  const recentCodeSessionIds = new Set(codeSessions.map((session) => session.id));
  const activeSessionIdsOutsideRecentPage = [...codeSessionIds].filter(
    (sessionId) => !recentCodeSessionIds.has(sessionId),
  );
  const retainedRecentSessions = codeSessions.slice(
    0,
    Math.max(0, MAX_PROFILE_SESSIONS - activeSessionIdsOutsideRecentPage.length),
  );
  const projectedSessions = [
    ...retainedRecentSessions.map((session) => ({ sessionId: session.id, session })),
    ...activeSessionIdsOutsideRecentPage
      .slice(0, MAX_PROFILE_SESSIONS)
      .map((sessionId) => ({ sessionId, session: undefined })),
  ];
  return spaceRuntimeProfileProjectionSchema.parse({
    connection: {
      state: input.connectionState ?? 'ready',
      changedAt: input.changedAt,
      stale: input.connectionState === 'degraded',
      runtimeId: input.status.runtimeId,
      profile: input.status.profile,
      ...(input.reason ? { reason: input.reason.slice(0, MAX_REASON) } : {}),
      capabilities: input.capabilities,
      ...(input.integrations ? { integrations: projectIntegrationHealth(input.integrations) } : {}),
    },
    projectionRevision: input.projectionRevision,
    cursor: { runtimeId: input.status.runtimeId, seq: input.cursor },
    sessions: projectedSessions.map(({ sessionId, session }) => {
      const runs = runsForSession(input.status.runs, sessionId);
      const ownRuns = input.status.runs.filter((run) => run.sessionId === sessionId);
      const createdAt =
        session !== undefined
          ? timestamp(session.createdAt)
          : Math.min(...ownRuns.map((run) => timestamp(run.acceptedAt ?? run.startedAt)));
      const lastActivityAt = Math.max(
        createdAt,
        ...ownRuns.map((run) => timestamp(run.endedAt ?? run.runningAt ?? run.startedAt)),
      );
      return {
        sessionId,
        surface: 'code' as const,
        ...(session?.title ? { title: session.title.slice(0, 256) } : {}),
        ...(session?.workspaceRoot || session?.gitRoot
          ? { projectRoot: (session.workspaceRoot ?? session.gitRoot)!.slice(0, 4_096) }
          : {}),
        createdAt,
        lastActivityAt,
        ...runs,
      };
    }),
    interactions: projectRuntimeInteractions(
      input.status.pendingPermissions.filter((request) => codeSessionIds.has(request.sessionId)),
      input.userInputs.filter((request) => codeSessionIds.has(request.sessionId)),
    ),
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
  #draftTurnId: string | undefined;
  #draftCheckpoint:
    | {
        runId: string;
        seq: number;
        assistantDraft: SpaceSessionLiveProjectionT['assistantDraft'];
        thinkingDraft: SpaceSessionLiveProjectionT['thinkingDraft'];
      }
    | undefined;
  readonly #runs = new Map<string, RuntimeRunStatus>();

  constructor(
    projection: SpaceSessionLiveProjectionT,
    runs: readonly RuntimeRunStatus[] = [],
    replayEvents: readonly RuntimeTypedEvent[] = [],
  ) {
    this.#projection = spaceSessionLiveProjectionSchema.parse(projection);
    this.#draftTurnId = this.#projection.activeRun?.turnId;
    for (const run of runs) this.#runs.set(run.runId, run);
    this.#bootstrapDraftAttempt(replayEvents);
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
    if (
      isTransientChildRuntimeEvent(event) &&
      (event.type === 'turn.started' ||
        event.type === 'assistant.delta' ||
        event.type === 'thinking.delta' ||
        event.type === 'thinking.finished' ||
        event.type === 'provider.recovery' ||
        (event.type === 'run.progress' && payload?.kind === 'iteration_start') ||
        event.type === 'tool.started' ||
        event.type === 'tool.progress' ||
        event.type === 'tool.sandbox' ||
        event.type === 'tool.finished' ||
        event.type === 'todo.updated')
    ) {
      return null;
    }
    const startedTurnId = runtimeTurnStartedId(event);
    if (
      event.type === 'turn.started' &&
      event.runId === this.#projection.activeRun?.runId &&
      startedTurnId !== undefined &&
      startedTurnId !== this.#draftTurnId
    ) {
      const activeRun = { ...this.#projection.activeRun, turnId: startedTurnId };
      const run = this.#runs.get(event.runId);
      if (run) this.#runs.set(event.runId, { ...run, turnId: startedTurnId });
      this.#draftCheckpoint = undefined;
      this.#draftTurnId = startedTurnId;
      return this.#commit(event.seq, {
        domain: 'run',
        activeRun,
        queuedRuns: this.#projection.queuedRuns,
        resetRunScopedState: true,
      });
    }
    if (event.type === 'run.progress' && payload?.kind === 'iteration_start') {
      if (this.#checkpointDrafts(event.runId, event.seq)) {
        return this.#commit(event.seq, {
          domain: 'draft',
          assistantDraft: this.#projection.assistantDraft ?? null,
          thinkingDraft: this.#projection.thinkingDraft ?? null,
          draftRecoveries: this.#projection.draftRecoveries ?? [],
          draftCheckpoints: this.#projection.draftCheckpoints ?? [],
        });
      }
      return null;
    }
    if (event.type === 'provider.recovery' && recoveryReplacesProvisionalAttempt(payload)) {
      const checkpoint = this.#draftCheckpoint;
      if (!checkpoint || checkpoint.runId !== event.runId) return null;
      const draftRecoveries = [
        ...(this.#projection.draftRecoveries ?? []),
        {
          runId: event.runId,
          checkpointSeq: checkpoint.seq,
          recoverySeq: event.seq,
          assistantCheckpointLength: checkpoint.assistantDraft?.text.length ?? 0,
          thinkingCheckpointLength: checkpoint.thinkingDraft?.text.length ?? 0,
        },
      ];
      const metadataAvailable = draftRecoveries.length <= 512;
      return this.#commit(event.seq, {
        domain: 'draft',
        assistantDraft: checkpoint.assistantDraft ?? null,
        thinkingDraft: checkpoint.thinkingDraft ?? null,
        draftRecoveries: metadataAvailable ? draftRecoveries : [],
        draftCheckpoints: metadataAvailable ? (this.#projection.draftCheckpoints ?? []) : [],
      });
    }
    if (event.type === 'assistant.delta' && typeof payload?.text === 'string') {
      const current = this.#projection.assistantDraft?.text ?? '';
      const combined = `${current}${payload.text}`;
      const next = combined.slice(-MAX_DRAFT);
      const startedAt = this.#runStartedAt(event.runId, event.time);
      return this.#commit(event.seq, {
        domain: 'draft',
        assistantDraft: { text: next, startedAt },
        thinkingDraft: this.#projection.thinkingDraft ?? null,
        ...(this.#trimDraftRecoveryCheckpoints('assistant', combined.length - next.length) ?? {}),
      });
    }
    if (event.type === 'thinking.delta' && typeof payload?.text === 'string') {
      const current = this.#projection.thinkingDraft?.text ?? '';
      const combined = `${current}${payload.text}`;
      const next = combined.slice(-MAX_DRAFT);
      return this.#commit(event.seq, {
        domain: 'draft',
        assistantDraft: this.#projection.assistantDraft ?? null,
        thinkingDraft: {
          text: next,
          startedAt: this.#runStartedAt(event.runId, event.time),
        },
        ...(this.#trimDraftRecoveryCheckpoints('thinking', combined.length - next.length) ?? {}),
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
    if (event.type === 'tool.sandbox') {
      const meta = record(payload?.meta);
      const update = record(payload?.update);
      const toolCallId = text(meta?.toolCallId, 128) ?? text(update?.id, 128);
      const sandbox = projectSandboxObservation(record(update?.observation));
      if (!toolCallId || !sandbox) return null;
      const index = this.#projection.activeTools.findIndex(
        (item) => item.toolCallId === toolCallId,
      );
      if (index < 0) return null;
      const activeTools = [...this.#projection.activeTools];
      activeTools[index] = { ...activeTools[index]!, sandbox };
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
      this.#checkpointDrafts(event.runId, event.seq);
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
      if (resetRunScopedState) {
        this.#draftCheckpoint = undefined;
        this.#draftTurnId = runs.activeRun?.turnId;
      }
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

  #checkpointDrafts(runId: string, seq: number): boolean {
    if (this.#projection.activeRun?.runId !== runId) return false;
    this.#draftCheckpoint = {
      runId,
      seq,
      assistantDraft: this.#projection.assistantDraft,
      thinkingDraft: this.#projection.thinkingDraft,
    };
    if (!this.#projection.draftRecoveries?.length) return false;
    const checkpoint = {
      runId,
      seq,
      assistantLength: this.#projection.assistantDraft?.text.length ?? 0,
      thinkingLength: this.#projection.thinkingDraft?.text.length ?? 0,
    };
    const checkpoints = [...(this.#projection.draftCheckpoints ?? [])];
    const previous = checkpoints.at(-1);
    if (
      previous?.assistantLength === checkpoint.assistantLength &&
      previous.thinkingLength === checkpoint.thinkingLength
    ) {
      checkpoints[checkpoints.length - 1] = checkpoint;
    } else {
      checkpoints.push(checkpoint);
    }
    if (checkpoints.length > 512) {
      this.#projection = {
        ...this.#projection,
        draftRecoveries: undefined,
        draftCheckpoints: undefined,
      };
      return true;
    }
    this.#projection = { ...this.#projection, draftCheckpoints: checkpoints };
    return true;
  }

  #trimDraftRecoveryCheckpoints(
    kind: 'assistant' | 'thinking',
    dropped: number,
  ):
    | {
        draftRecoveries: NonNullable<SpaceSessionLiveProjectionT['draftRecoveries']>;
        draftCheckpoints: NonNullable<SpaceSessionLiveProjectionT['draftCheckpoints']>;
      }
    | undefined {
    const recoveries = this.#projection.draftRecoveries;
    if (dropped <= 0 || !recoveries?.length) return undefined;
    return {
      draftRecoveries: recoveries.map((recovery) =>
        kind === 'assistant'
          ? {
              ...recovery,
              assistantCheckpointLength: Math.max(0, recovery.assistantCheckpointLength - dropped),
            }
          : {
              ...recovery,
              thinkingCheckpointLength: Math.max(0, recovery.thinkingCheckpointLength - dropped),
            },
      ),
      draftCheckpoints: (this.#projection.draftCheckpoints ?? []).map((checkpoint) =>
        kind === 'assistant'
          ? { ...checkpoint, assistantLength: Math.max(0, checkpoint.assistantLength - dropped) }
          : { ...checkpoint, thinkingLength: Math.max(0, checkpoint.thinkingLength - dropped) },
      ),
    };
  }

  #bootstrapDraftAttempt(replayEvents: readonly RuntimeTypedEvent[]): void {
    const runId = this.#projection.activeRun?.runId;
    if (!runId) return;
    const retainedEvents = replayEvents
      .filter(
        (event) =>
          event.sessionId === this.#projection.sessionId &&
          event.runId === runId &&
          event.cursor.sessionId === this.#projection.cursor.sessionId &&
          event.cursor.journalEpoch === this.#projection.cursor.journalEpoch &&
          event.seq <= this.#projection.cursor.seq,
      )
      .sort((left, right) => left.seq - right.seq);
    if (this.#rebuildCurrentTurnDrafts(retainedEvents)) return;
    let checkpointAvailable = false;
    let hasReplayableRecovery = false;
    let awaitingCompleteCheckpoint = false;
    let replayStart = 0;
    for (let index = 0; index < retainedEvents.length; index++) {
      const event = retainedEvents[index]!;
      if (isTransientChildRuntimeEvent(event)) continue;
      const payload = record(event.payload);
      if (
        (event.type === 'run.progress' && payload?.kind === 'iteration_start') ||
        event.type === 'tool.finished'
      ) {
        checkpointAvailable = true;
        if (awaitingCompleteCheckpoint) {
          replayStart = index;
          awaitingCompleteCheckpoint = false;
          hasReplayableRecovery = false;
        }
        continue;
      }
      if (event.type !== 'provider.recovery' || !recoveryReplacesProvisionalAttempt(payload)) {
        continue;
      }
      if (!checkpointAvailable) {
        awaitingCompleteCheckpoint = true;
        continue;
      }
      hasReplayableRecovery = true;
    }
    if (!checkpointAvailable || awaitingCompleteCheckpoint) return;
    const events = retainedEvents.slice(replayStart);

    const replayedText = events
      .filter((event) => !isTransientChildRuntimeEvent(event) && event.type === 'assistant.delta')
      .map((event) => record(event.payload)?.text)
      .filter((value): value is string => typeof value === 'string')
      .join('')
      .slice(-MAX_DRAFT);
    const replayedThinking = events
      .filter((event) => !isTransientChildRuntimeEvent(event) && event.type === 'thinking.delta')
      .map((event) => record(event.payload)?.text)
      .filter((value): value is string => typeof value === 'string')
      .join('')
      .slice(-MAX_DRAFT);
    const cumulativeText = this.#projection.assistantDraft?.text ?? '';
    const cumulativeThinking = this.#projection.thinkingDraft?.text ?? '';
    if (!cumulativeText.endsWith(replayedText) || !cumulativeThinking.endsWith(replayedThinking)) {
      return;
    }
    const stableText = cumulativeText.slice(0, cumulativeText.length - replayedText.length);
    const stableThinking = cumulativeThinking.slice(
      0,
      cumulativeThinking.length - replayedThinking.length,
    );
    const firstSeq = events[0]?.seq ?? 1;
    const seed = spaceSessionLiveProjectionSchema.parse({
      ...this.#projection,
      cursor: { ...this.#projection.cursor, seq: Math.max(0, firstSeq - 1) },
      assistantDraft:
        stableText.length > 0
          ? { text: stableText, startedAt: this.#projection.assistantDraft?.startedAt ?? 0 }
          : undefined,
      thinkingDraft:
        stableThinking.length > 0
          ? { text: stableThinking, startedAt: this.#projection.thinkingDraft?.startedAt ?? 0 }
          : undefined,
      draftRecoveries: undefined,
      draftCheckpoints: undefined,
    });
    const replay = new CoderSessionProjectionReducer(seed, [...this.#runs.values()]);
    for (const event of events) replay.apply(event);
    this.#draftCheckpoint = replay.#draftCheckpoint;
    if (!hasReplayableRecovery) return;
    const rebuilt = replay.snapshot();
    this.#projection = spaceSessionLiveProjectionSchema.parse({
      ...this.#projection,
      assistantDraft: rebuilt.assistantDraft,
      thinkingDraft: rebuilt.thinkingDraft,
      draftRecoveries: rebuilt.draftRecoveries,
      draftCheckpoints: rebuilt.draftCheckpoints,
    });
  }

  #rebuildCurrentTurnDrafts(retainedEvents: readonly RuntimeTypedEvent[]): boolean {
    const activeTurnId = this.#projection.activeRun?.turnId;
    if (!activeTurnId) return false;
    let turnStartIndex = -1;
    for (let index = retainedEvents.length - 1; index >= 0; index--) {
      const event = retainedEvents[index]!;
      if (
        !isTransientChildRuntimeEvent(event) &&
        event.type === 'turn.started' &&
        runtimeTurnStartedId(event) === activeTurnId
      ) {
        turnStartIndex = index;
        break;
      }
    }
    if (turnStartIndex < 0) return false;
    const events = retainedEvents.slice(turnStartIndex);
    const firstSeq = events[0]!.seq;
    const seed = spaceSessionLiveProjectionSchema.parse({
      ...this.#projection,
      cursor: { ...this.#projection.cursor, seq: Math.max(0, firstSeq - 1) },
      assistantDraft: undefined,
      thinkingDraft: undefined,
      draftRecoveries: undefined,
      draftCheckpoints: undefined,
    });
    const replay = new CoderSessionProjectionReducer(seed, [...this.#runs.values()]);
    for (const event of events) replay.apply(event);
    this.#draftCheckpoint = replay.#draftCheckpoint;
    const rebuilt = replay.snapshot();
    this.#projection = spaceSessionLiveProjectionSchema.parse({
      ...this.#projection,
      assistantDraft: rebuilt.assistantDraft,
      thinkingDraft: rebuilt.thinkingDraft,
      draftRecoveries: rebuilt.draftRecoveries,
      draftCheckpoints: rebuilt.draftCheckpoints,
    });
    return true;
  }

  #commit(
    seq: number,
    change: SpaceSessionLiveChangedT['change'],
    lastTerminalRun?: SpaceRuntimeRunProjectionT,
  ): SpaceSessionLiveChangedT {
    const baseProjectionRevision = this.#projection.projectionRevision;
    const projectionRevision = baseProjectionRevision + 1;
    const cursor = { ...this.#projection.cursor, seq };
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
                draftRecoveries: undefined,
                draftCheckpoints: undefined,
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
          ...(change.draftRecoveries !== undefined
            ? { draftRecoveries: change.draftRecoveries }
            : {}),
          ...(change.draftCheckpoints !== undefined
            ? { draftCheckpoints: change.draftCheckpoints }
            : {}),
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
