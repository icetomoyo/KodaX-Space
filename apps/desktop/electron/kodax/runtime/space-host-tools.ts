import type {
  KodaXRuntime,
  RuntimeHostToolDescriptor,
  RuntimeHostToolHandler,
  RuntimeHostToolLease,
} from '@kodax-ai/kodax/runtime';

import {
  CREATE_ARTIFACT_TOOL,
  makeCreateArtifactHandler,
} from '../../artifact/create-artifact-tool.js';
import {
  CREATE_OFFICE_ARTIFACT_TOOL,
  makeCreateOfficeArtifactHandler,
} from '../../artifact/office-artifact-tool.js';
import { artifactStore } from '../../artifact/store.js';
import { pushToRenderer } from '../../ipc/push.js';
import {
  SPACE_CONTROL_APPLY_TOOL,
  SPACE_CONTROL_INSPECT_TOOL,
  isSpaceControlToolExposureEnabled,
  makeSpaceControlApplyHandler,
  makeSpaceControlInspectHandler,
} from '../../space-control/tools.js';
import type { SdkToolExecutionContextLike } from '../session-run-context.js';

type SpaceToolDefinition = {
  readonly name: string;
  readonly description: string;
  readonly sideEffect: 'readonly' | 'mutates-state';
  readonly input_schema: Readonly<Record<string, unknown>>;
};

type SpaceToolHandler = (
  input: Record<string, unknown>,
  context?: SdkToolExecutionContextLike,
) => Promise<string>;

function descriptor(definition: SpaceToolDefinition): RuntimeHostToolDescriptor {
  return {
    name: definition.name,
    description: definition.description,
    inputSchema: definition.input_schema,
    sideEffect: definition.sideEffect === 'readonly' ? 'none' : 'non_idempotent',
  };
}

export function spaceHostToolDescriptors(): readonly RuntimeHostToolDescriptor[] {
  const definitions: SpaceToolDefinition[] = [
    CREATE_ARTIFACT_TOOL,
    CREATE_OFFICE_ARTIFACT_TOOL,
  ];
  if (isSpaceControlToolExposureEnabled()) {
    definitions.push(SPACE_CONTROL_INSPECT_TOOL, SPACE_CONTROL_APPLY_TOOL);
  }
  return definitions.map(descriptor);
}

function buildHandlers(): Readonly<Record<string, SpaceToolHandler>> {
  const handlers: Record<string, SpaceToolHandler> = {
    [CREATE_ARTIFACT_TOOL.name]: makeCreateArtifactHandler({
      store: artifactStore,
      notifyChanged: (payload) => pushToRenderer('artifact.changed', payload),
    }),
    [CREATE_OFFICE_ARTIFACT_TOOL.name]: makeCreateOfficeArtifactHandler({
      store: artifactStore,
      notifyChanged: (payload) => pushToRenderer('artifact.changed', payload),
    }),
  };
  if (isSpaceControlToolExposureEnabled()) {
    handlers[SPACE_CONTROL_INSPECT_TOOL.name] = makeSpaceControlInspectHandler();
    handlers[SPACE_CONTROL_APPLY_TOOL.name] = makeSpaceControlApplyHandler();
  }
  return handlers;
}

/** Register connection-bound implementations; possession is still granted per run. */
export async function registerSpaceHostTools(
  runtime: KodaXRuntime,
): Promise<RuntimeHostToolLease> {
  const implementations = buildHandlers();
  const results = new Map<string, Promise<{ content: string }>>();
  let leaseId: string | undefined;
  const handlers: Record<string, RuntimeHostToolHandler> = {};

  for (const [name, implementation] of Object.entries(implementations)) {
    handlers[name] = (invocation) => {
      const existing = results.get(invocation.invocationId);
      if (existing) return existing;
      const pending = (async () => {
        if (!leaseId || invocation.leaseId !== leaseId) {
          return { content: 'Error: invalid Space host-tool lease.' };
        }
        const [session, run, settings] = await Promise.all([
          runtime.sessions.load(invocation.sessionId),
          runtime.runs.get(invocation.runId),
          runtime.sessions.getSettings(invocation.sessionId),
        ]);
        if (
          run.sessionId !== invocation.sessionId ||
          session.surface === 'partner' ||
          session.profileId === 'kodax-space.partner'
        ) {
          return { content: 'Error: Space host tool is not authorized for this run.' };
        }
        const projectRoot = session.workspaceRoot ?? session.gitRoot;
        if (!projectRoot) return { content: 'Error: Coder session has no trusted project root.' };
        const context = {
          sessionId: invocation.sessionId,
          toolCallId: invocation.invocationId,
          taskSurface: 'repl' as const,
          executionCwd: settings.executionCwd ?? projectRoot,
          gitRoot: session.gitRoot ?? projectRoot,
          agentProfile: { surface: 'code' },
        } as SdkToolExecutionContextLike;
        return { content: await implementation({ ...invocation.input }, context) };
      })();
      results.set(invocation.invocationId, pending);
      // Bound memory without compromising retry idempotency for recent calls.
      if (results.size > 1_000) results.delete(results.keys().next().value as string);
      return pending;
    };
  }

  const lease = await runtime.hostTools.register(spaceHostToolDescriptors(), handlers);
  leaseId = lease.id;
  return lease;
}
