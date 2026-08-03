import {
  spaceActionArgsSchema,
  spaceActionIdSchema,
  type SpaceActionArgsT,
  type SpaceActionIdT,
} from '@kodax-space/space-ipc-schema';
import {
  registerPartnerSpaceToolPolicy,
  type PartnerToolSideEffect,
} from '../kodax/partner-tools.js';
import {
  resolveSessionRunContext,
  type SessionRunContext,
  type SdkToolExecutionContextLike,
} from '../kodax/session-run-context.js';
import { spaceControlService } from './runtime.js';
import { getDiagnosticsLogger } from '../diagnostics/runtime.js';

type ToolHandler = (
  input: Record<string, unknown>,
  context?: SdkToolExecutionContextLike,
) => Promise<string>;

export function isSpaceControlToolExposureEnabled(
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  return env.SPACE_DISABLE_SPACE_CONTROL !== '1';
}

async function resolveAuthoritativeContext(
  context: NonNullable<ReturnType<typeof resolveSessionRunContext>>,
): Promise<SessionRunContext | undefined> {
  const { kodaxHost } = await import('../kodax/host.js');
  const session = kodaxHost.get(context.sessionId);
  if (!session) return undefined;
  const normalize = (value: string): string => {
    const normalized = value.replace(/\\/g, '/').replace(/\/+$/, '');
    return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
  };
  if (
    session.surface !== context.surface ||
    normalize(session.projectRoot) !== normalize(context.projectRoot)
  ) {
    return undefined;
  }
  // The live Session is authoritative for identity and project ownership, but
  // permissionMode belongs to the run that created this tool call. Replacing
  // it with the mutable Session setting would let a mid-run UI toggle loosen
  // or tighten one execution inconsistently. The new setting applies next run.
  return context;
}

const inspectInputSchema = {
  type: 'object' as const,
  additionalProperties: false,
  properties: {
    query: { type: 'string', maxLength: 120 },
    actionId: { type: 'string', enum: spaceActionIdSchema.options },
    args: {
      type: 'object',
      additionalProperties: false,
      properties: { value: { type: ['string', 'boolean'] } },
      required: ['value'],
    },
  },
};

export const SPACE_CONTROL_INSPECT_TOOL = {
  name: 'space_control_inspect',
  description: [
    'Discover bounded KodaX Space semantic actions and inspect their current safe state.',
    'To prepare an apply, provide the exact actionId and args you intend to use; the result includes a short-lived precondition token and revision.',
    'This tool is read-only and never changes UI or settings.',
  ].join('\n'),
  sideEffect: 'readonly' as const,
  planModeAllowed: true,
  interruptBehavior: 'wait' as const,
  shouldDefer: true,
  searchHint: 'Inspect safe Space UI/settings actions before applying one.',
  toClassifierInput: () => '',
  input_schema: inspectInputSchema,
};

export const SPACE_CONTROL_APPLY_TOOL = {
  name: 'space_control_apply',
  description: [
    'Apply one bounded KodaX Space semantic action after space_control_inspect.',
    'Requires the exact actionId, args, revision, and preconditionToken returned for those args.',
    'The result is a truthful applied/unchanged/denied/failed receipt. Never invent action ids or reuse a token with different args.',
  ].join('\n'),
  sideEffect: 'mutates-state' as const,
  // Individual actions still enforce their own plan-mode rule in SpaceControlService.
  planModeAllowed: true,
  interruptBehavior: 'wait' as const,
  shouldDefer: true,
  searchHint: 'Apply a previously inspected, bounded Space UI/settings action.',
  toClassifierInput: (input: unknown) => {
    const value = input as { actionId?: unknown; args?: { value?: unknown } };
    const actionId = typeof value?.actionId === 'string' ? value.actionId.slice(0, 64) : 'unknown';
    const argument = value?.args?.value;
    const safeValue =
      typeof argument === 'boolean' || typeof argument === 'string'
        ? String(argument).slice(0, 64)
        : 'invalid';
    return `SpaceControl ${actionId}=${safeValue}`;
  },
  input_schema: {
    type: 'object' as const,
    additionalProperties: false,
    properties: {
      actionId: { type: 'string', enum: spaceActionIdSchema.options },
      args: inspectInputSchema.properties.args,
      expectedRevision: { type: 'integer', minimum: 0 },
      preconditionToken: { type: 'string', minLength: 16, maxLength: 128 },
    },
    required: ['actionId', 'args', 'expectedRevision', 'preconditionToken'],
  },
};

function parseActionId(value: unknown): SpaceActionIdT | undefined {
  const result = spaceActionIdSchema.safeParse(value);
  return result.success ? result.data : undefined;
}

function parseArgs(value: unknown): SpaceActionArgsT | undefined {
  const result = spaceActionArgsSchema.safeParse(value);
  return result.success ? result.data : undefined;
}

export function makeSpaceControlInspectHandler(): ToolHandler {
  return async (input, toolContext) => {
    if (!isSpaceControlToolExposureEnabled()) {
      return 'Error: Space semantic-control tools are disabled by the local rollout gate.';
    }
    const runContext = resolveSessionRunContext(toolContext);
    if (!runContext) return 'Error: space_control_inspect was called outside an active Space run.';
    const context = await resolveAuthoritativeContext(runContext);
    if (!context) {
      return 'Error: active Space session identity no longer matches this tool call.';
    }
    const actionId = input.actionId === undefined ? undefined : parseActionId(input.actionId);
    if (input.actionId !== undefined && actionId === undefined) {
      return 'Error: unknown Space actionId.';
    }
    const args = input.args === undefined ? undefined : parseArgs(input.args);
    if (input.args !== undefined && args === undefined) return 'Error: invalid Space action args.';
    const query = typeof input.query === 'string' ? input.query.slice(0, 120) : undefined;
    const result = await spaceControlService.inspect(
      {
        ...(query ? { query } : {}),
        ...(actionId ? { actionId } : {}),
        ...(args ? { args } : {}),
      },
      context,
    );
    return JSON.stringify(result);
  };
}

export function makeSpaceControlApplyHandler(): ToolHandler {
  return async (input, toolContext) => {
    if (!isSpaceControlToolExposureEnabled()) {
      return 'Error: Space semantic-control tools are disabled by the local rollout gate.';
    }
    const runContext = resolveSessionRunContext(toolContext);
    if (!runContext) return 'Error: space_control_apply was called outside an active Space run.';
    const context = await resolveAuthoritativeContext(runContext);
    if (!context) {
      return 'Error: active Space session identity no longer matches this tool call.';
    }
    const actionId = parseActionId(input.actionId);
    const args = parseArgs(input.args);
    const expectedRevision = input.expectedRevision;
    const preconditionToken = input.preconditionToken;
    if (
      !actionId ||
      !args ||
      !Number.isSafeInteger(expectedRevision) ||
      Number(expectedRevision) < 0 ||
      typeof preconditionToken !== 'string'
    ) {
      return 'Error: invalid space_control_apply input.';
    }
    const result = await spaceControlService.apply(
      {
        actionId,
        args,
        expectedRevision: Number(expectedRevision),
        preconditionToken,
      },
      context,
    );
    return JSON.stringify(result);
  };
}

let registered = false;

export function _resetSpaceControlToolRegistrationForTesting(): void {
  registered = false;
}

function registerPartnerPolicy(
  name: string,
  sideEffect: PartnerToolSideEffect,
  description: string,
): void {
  registerPartnerSpaceToolPolicy({
    name,
    scope: 'space-control',
    sideEffect,
    description,
  });
}

export function ensureSpaceControlToolsRegistered(sdk: unknown): void {
  if (registered) return;
  if (!isSpaceControlToolExposureEnabled()) {
    getDiagnosticsLogger()?.info('space-control', 'tool_registration_disabled');
    return;
  }
  const register = (sdk as { registerTool?: (definition: unknown) => unknown }).registerTool;
  if (typeof register !== 'function') {
    getDiagnosticsLogger()?.warn(
      'space-control',
      'tool_registration_unavailable',
      'SDK registerTool is unavailable',
    );
    return;
  }
  const disposers: Array<() => void> = [];
  try {
    for (const definition of [
      { ...SPACE_CONTROL_INSPECT_TOOL, handler: makeSpaceControlInspectHandler() },
      { ...SPACE_CONTROL_APPLY_TOOL, handler: makeSpaceControlApplyHandler() },
    ]) {
      const dispose = register.call(sdk, definition);
      if (typeof dispose === 'function') disposers.push(dispose as () => void);
    }
    registerPartnerPolicy(
      SPACE_CONTROL_INSPECT_TOOL.name,
      SPACE_CONTROL_INSPECT_TOOL.sideEffect,
      'Inspects the bounded semantic Space action catalog and safe UI state.',
    );
    registerPartnerPolicy(
      SPACE_CONTROL_APPLY_TOOL.name,
      SPACE_CONTROL_APPLY_TOOL.sideEffect,
      'Applies only preconditioned semantic Space UI and preference actions.',
    );
    registered = true;
  } catch (error) {
    for (const dispose of disposers.reverse()) {
      try {
        dispose();
      } catch {
        // Registration failure remains the primary error.
      }
    }
    throw error;
  }
}
