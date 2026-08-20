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
import type { KodaXOutputSegmentProjection } from '@kodax-ai/kodax/coding';
import {
  spaceRuntimeProfileProjectionSchema,
  spaceRuntimeSidecarMessagePayloadSchema,
  spaceRuntimeToolSandboxSchema,
  spaceSessionLiveChangedSchema,
  spaceSessionLiveProjectionSchema,
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

type OutputSegmentSdk = Pick<
  typeof import('@kodax-ai/kodax/coding'),
  'createOutputSegmentProjection' | 'effectiveOutputSegmentText' | 'reduceOutputSegmentProjection'
>;

let outputSegmentSdk: OutputSegmentSdk | undefined;
let outputSegmentSdkPromise: Promise<OutputSegmentSdk> | undefined;

export async function initializeCoderDaemonProjectionSdk(): Promise<void> {
  if (outputSegmentSdk !== undefined) return;
  const loading = outputSegmentSdkPromise ?? import('@kodax-ai/kodax/coding');
  outputSegmentSdkPromise = loading;
  try {
    outputSegmentSdk = await loading;
  } finally {
    if (outputSegmentSdkPromise === loading) outputSegmentSdkPromise = undefined;
  }
}

function requireOutputSegmentSdk(): OutputSegmentSdk {
  if (outputSegmentSdk === undefined) {
    throw new Error('KodaX output-segment projection SDK was not initialized.');
  }
  return outputSegmentSdk;
}

function createOutputSegmentProjection(): KodaXOutputSegmentProjection {
  return requireOutputSegmentSdk().createOutputSegmentProjection();
}

function effectiveOutputSegmentText(
  state: KodaXOutputSegmentProjection,
  kind: 'assistant' | 'thinking',
): string {
  return requireOutputSegmentSdk().effectiveOutputSegmentText(state, kind);
}

function reduceOutputSegmentProjection(
  state: KodaXOutputSegmentProjection,
  event: Parameters<OutputSegmentSdk['reduceOutputSegmentProjection']>[1],
): ReturnType<OutputSegmentSdk['reduceOutputSegmentProjection']> {
  return requireOutputSegmentSdk().reduceOutputSegmentProjection(state, event);
}

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
    ...(origin?.operationId !== undefined ? { originOperationId: origin.operationId } : {}),
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

function boundedOutputSegmentProjection(
  projection: KodaXOutputSegmentProjection,
): NonNullable<SpaceSessionLiveProjectionT['outputSegment']> {
  const source = [...projection.retained, ...(projection.active ? [projection.active] : [])].slice(
    -MAX_TOOLS,
  );
  let assistantRemaining = MAX_DRAFT;
  let thinkingRemaining = MAX_DRAFT;
  const bounded = [...source]
    .reverse()
    .map((segment) => {
      const assistantText =
        assistantRemaining === 0 ? '' : segment.assistantText.slice(-assistantRemaining);
      const thinkingText =
        thinkingRemaining === 0 ? '' : segment.thinkingText.slice(-thinkingRemaining);
      assistantRemaining -= assistantText.length;
      thinkingRemaining -= thinkingText.length;
      return {
        ...segment,
        assistantText,
        thinkingText,
        assistantTextStartOffset: segment.assistantText.length - assistantText.length,
        thinkingTextStartOffset: segment.thinkingText.length - thinkingText.length,
      };
    })
    .reverse();
  const hasActive = projection.active !== undefined;
  return {
    retained: hasActive ? bounded.slice(0, -1) : bounded,
    ...(hasActive && bounded.length > 0 ? { active: bounded.at(-1)! } : {}),
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
  const afterTurn = runs
    .filter(
      (run) =>
        run.sessionId === sessionId &&
        run.continuation?.delivery === 'after_turn' &&
        run.continuation.state === 'queued',
    )
    .sort((a, b) => (a.sessionOrder ?? 0) - (b.sessionOrder ?? 0))
    .slice(0, 500)
    .map((run, index) => ({
      // session.send and queued_user_prompt_started both expose the continuation Run id as the
      // public after-turn queue identity. Keep the live projection on that same identity.
      inputId: run.runId,
      sessionId: run.sessionId,
      delivery: 'after-turn' as const,
      state: 'queued' as const,
      createdAt: timestamp(run.queuedAt ?? run.acceptedAt ?? run.startedAt),
      runId: run.runId,
      position: index + 1,
      contentPreview: run.continuation!.contentPreview.slice(0, 4_096),
      ...(run.origin?.operationId ? { originOperationId: run.origin.operationId } : {}),
      ...(run.origin
        ? {
            initiatedBy: {
              clientId: run.origin.principalId.slice(0, 128),
              name: (run.origin.clientName ?? run.origin.principalId).slice(0, 128),
            },
          }
        : {}),
    }));
  const interrupts = runs.flatMap((run) =>
    run.sessionId !== sessionId
      ? []
      : (run.interruptInputs ?? []).flatMap((input) => {
          // Delivered input is durable transcript history, not session-wide live queue state.
          // The reducer emits it once from run.input.delivered with an exact journal position;
          // snapshots must never resurrect old owners from completed or earlier turns.
          if (input.state !== 'queued') return [];
          const origin = input.origin ?? run.origin;
          return [
            {
              inputId: input.inputId,
              sessionId: run.sessionId,
              delivery: 'interrupt' as const,
              state: input.state,
              createdAt: timestamp(input.queuedAt),
              ...(input.deliveredAt ? { deliveredAt: timestamp(input.deliveredAt) } : {}),
              runId: run.runId,
              contentPreview: input.contentPreview.slice(0, 4_096),
              ...(run.turnId ? { turnId: run.turnId } : {}),
              // Per-input operation identity is authoritative for interrupts. Falling back to the
              // root Run origin would alias every interrupt submitted to that Run.
              ...(input.origin?.operationId ? { originOperationId: input.origin.operationId } : {}),
              ...(origin
                ? {
                    initiatedBy: {
                      clientId: origin.principalId.slice(0, 128),
                      name: (origin.clientName ?? origin.principalId).slice(0, 128),
                    },
                  }
                : {}),
            },
          ];
        }),
  );
  return [...afterTurn, ...interrupts]
    .sort((left, right) => left.createdAt - right.createdAt)
    .slice(0, 500)
    .map((input, index) => ({ ...input, position: index + 1 }));
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
  const runId = runs.activeRun?.runId;
  const rawOutputSegment = runId ? snapshot.live.outputSegmentsByRun[runId] : undefined;
  const outputSegment = rawOutputSegment
    ? boundedOutputSegmentProjection(rawOutputSegment)
    : undefined;
  const legacyAssistantDraft = textForRun(snapshot.live.assistantTextByRun, snapshot.runs, runId);
  const legacyThinkingDraft = textForRun(snapshot.live.thinkingTextByRun, snapshot.runs, runId);
  if (outputSegment === undefined && (legacyAssistantDraft || legacyThinkingDraft)) {
    throw new Error('KodaX Runtime live draft is missing its liveOutputSegments projection.');
  }
  const startedAt = timestamp(
    snapshot.runs.find((run) => run.runId === runId)?.runningAt ??
      snapshot.runs.find((run) => run.runId === runId)?.startedAt,
  );
  const assistantText = outputSegment ? effectiveOutputSegmentText(outputSegment, 'assistant') : '';
  const thinkingText = outputSegment ? effectiveOutputSegmentText(outputSegment, 'thinking') : '';
  const assistantDraft = assistantText ? { text: assistantText, startedAt } : undefined;
  const thinkingDraft = thinkingText ? { text: thinkingText, startedAt } : undefined;
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
    ...(outputSegment ? { outputSegment } : {}),
    activeTools: snapshot.live.activeTools
      .map((item) => toolProjection(item, snapshot.runs))
      .filter((item): item is NonNullable<typeof item> => item !== null)
      .slice(0, MAX_TOOLS),
    todos: todoProjection(snapshot.live.todo),
    ...(managedTask ? { managedTask } : {}),
    settings: settingsProjection(snapshot.settings.revision, snapshot.settings.value),
    queuedInputs: queuedInputsProjection(snapshot.runs, snapshot.session.id),
    sidecarMessages: [],
    interactions: projectRuntimeInteractions(
      snapshot.pendingPermissions,
      userInputs,
      snapshot.session.id,
      snapshot.settings.value.executionCwd,
    ),
  });
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
  #outputSegment: KodaXOutputSegmentProjection | undefined;
  readonly #runs = new Map<string, RuntimeRunStatus>();

  constructor(
    projection: SpaceSessionLiveProjectionT,
    runs: readonly RuntimeRunStatus[] = [],
    outputSegment?: KodaXOutputSegmentProjection,
  ) {
    this.#projection = spaceSessionLiveProjectionSchema.parse(projection);
    this.#draftTurnId = this.#projection.activeRun?.turnId;
    this.#outputSegment = structuredClone(outputSegment ?? this.#projection.outputSegment);
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
    if (
      isTransientChildRuntimeEvent(event) &&
      (event.type === 'turn.started' ||
        event.type === 'output.segment.started' ||
        event.type === 'assistant.delta' ||
        event.type === 'thinking.delta' ||
        event.type === 'thinking.finished' ||
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
      this.#outputSegment = createOutputSegmentProjection();
      this.#draftTurnId = startedTurnId;
      return this.#commit(event.seq, {
        domain: 'run',
        activeRun,
        queuedRuns: this.#projection.queuedRuns,
        queuedInputs: this.#projection.queuedInputs.filter((input) => input.state !== 'delivered'),
        resetRunScopedState: true,
      });
    }
    if (
      event.type === 'output.segment.started' &&
      typeof payload?.responseId === 'string' &&
      typeof payload?.providerRequestId === 'string' &&
      (payload.mode === 'append' || payload.mode === 'replace')
    ) {
      return this.#applyOutputSegmentEvent(event, {
        type: 'segment.started',
        responseId: payload.responseId,
        providerRequestId: payload.providerRequestId,
        mode: payload.mode,
        startedAtSeq: event.seq,
      });
    }
    if (
      (event.type === 'assistant.delta' || event.type === 'thinking.delta') &&
      typeof payload?.text === 'string'
    ) {
      const meta = record(payload.meta);
      const providerRequestId = text(payload.providerRequestId ?? meta?.providerRequestId, 256);
      if (!providerRequestId) {
        throw new Error(`${event.type} is missing liveOutputSegments providerRequestId.`);
      }
      return this.#applyOutputSegmentEvent(event, {
        type: event.type,
        providerRequestId,
        text: payload.text,
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
    if (event.type === 'sidecar.message') {
      const recoveryRun = this.#projection.activeRun ?? this.#projection.lastTerminalRun;
      if (
        recoveryRun === undefined ||
        recoveryRun.runId !== event.runId ||
        recoveryRun.turnId === undefined ||
        event.turnId === undefined ||
        recoveryRun.turnId !== event.turnId
      ) {
        return null;
      }
      const message = spaceRuntimeSidecarMessagePayloadSchema.safeParse(event.payload);
      if (!message.success) return null;
      const sidecarMessages = [
        ...(this.#projection.sidecarMessages ?? []).filter((item) => item.eventId !== event.id),
        {
          eventId: event.id.slice(0, 128),
          runId: event.runId.slice(0, 128),
          ...(text(event.turnId, 256) ? { turnId: text(event.turnId, 256)! } : {}),
          seq: event.seq,
          createdAt: timestamp(event.time),
          message: message.data,
        },
      ].slice(-100);
      return this.#commit(event.seq, { domain: 'sidecar', sidecarMessages });
    }
    if (event.type === 'run.input.delivered') {
      const activeRun = this.#projection.activeRun;
      if (
        activeRun === undefined ||
        activeRun.runId !== event.runId ||
        activeRun.turnId === undefined ||
        event.turnId === undefined ||
        activeRun.turnId !== event.turnId
      ) {
        return null;
      }
      const inputs = Array.isArray(payload?.inputs) ? payload.inputs : [];
      const delivered = new Map<string, Readonly<Record<string, unknown>>>();
      for (const value of inputs) {
        const input = record(value);
        const inputId = text(input?.inputId, 128);
        if (inputId) delivered.set(inputId, input!);
      }
      if (delivered.size === 0) return null;
      let changed = false;
      const queuedInputs = this.#projection.queuedInputs.map((input) => {
        const delivery = delivered.get(input.inputId);
        if (!delivery) return input;
        changed = true;
        const deliveredAt = text(delivery.deliveredAt, 128);
        const entryId = text(delivery.entryId, 256);
        return {
          ...input,
          state: 'delivered' as const,
          runId: event.runId,
          deliverySeq: event.seq,
          ...(event.turnId !== undefined ? { turnId: event.turnId } : {}),
          ...(deliveredAt ? { deliveredAt: timestamp(deliveredAt) } : {}),
          ...(entryId ? { entryId } : {}),
        };
      });
      return changed ? this.#commit(event.seq, { domain: 'queue', queuedInputs }) : null;
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
        this.#outputSegment = createOutputSegmentProjection();
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

  #applyOutputSegmentEvent(
    runtimeEvent: RuntimeTypedEvent,
    event: Parameters<typeof reduceOutputSegmentProjection>[1],
  ): SpaceSessionLiveChangedT | null {
    if (this.#projection.activeRun?.runId !== runtimeEvent.runId) return null;
    const reduced = reduceOutputSegmentProjection(
      this.#outputSegment ?? createOutputSegmentProjection(),
      event,
    );
    if (!reduced.accepted) return null;
    this.#outputSegment = reduced.state;
    const outputSegment = boundedOutputSegmentProjection(reduced.state);
    const startedAt = this.#runStartedAt(runtimeEvent.runId, runtimeEvent.time);
    const assistantText = effectiveOutputSegmentText(outputSegment, 'assistant');
    const thinkingText = effectiveOutputSegmentText(outputSegment, 'thinking');
    return this.#commit(runtimeEvent.seq, {
      domain: 'draft',
      assistantDraft: assistantText ? { text: assistantText, startedAt } : null,
      thinkingDraft: thinkingText ? { text: thinkingText, startedAt } : null,
      outputSegment: {
        retained: [...outputSegment.retained],
        ...(outputSegment.active ? { active: outputSegment.active } : {}),
      },
    });
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
                outputSegment: undefined,
                activeTools: [],
                managedTask: undefined,
                interactions: [],
                ...(change.activeRun !== null ? { sidecarMessages: [] } : {}),
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
          outputSegment: change.outputSegment,
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
      case 'sidecar':
        this.#projection = {
          ...this.#projection,
          projectionRevision,
          cursor,
          sidecarMessages: change.sidecarMessages,
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
