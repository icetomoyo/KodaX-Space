import { AsyncLocalStorage } from 'node:async_hooks';
import type { PermissionMode, Surface } from '@kodax-space/space-ipc-schema';
import type { KodaXToolExecutionContext } from '@kodax-ai/kodax/coding';

export interface SessionRunContext {
  sessionId: string;
  surface: Surface;
  projectRoot: string;
  toolCallId?: string;
  /** SDK task-engine surface; distinct from Space's code/partner product surface. */
  taskSurface?: 'cli' | 'repl' | 'plan';
  /** Space session permission mode; authoritative for Plan-mode action policy. */
  permissionMode?: PermissionMode;
}

export type SdkToolExecutionContextLike = Pick<
  KodaXToolExecutionContext,
  'sessionId' | 'toolCallId' | 'taskSurface' | 'executionCwd' | 'gitRoot' | 'agentProfile'
>;

const storage = new AsyncLocalStorage<SessionRunContext>();

export function withSessionRunContext<T>(ctx: SessionRunContext, fn: () => Promise<T>): Promise<T> {
  return storage.run(ctx, fn);
}

export function currentSessionRunContext(): SessionRunContext | undefined {
  return storage.getStore();
}

export function resolveSessionRunContext(
  toolContext?: SdkToolExecutionContextLike,
): SessionRunContext | undefined {
  const stored = storage.getStore();
  const sessionId = toolContext?.sessionId;
  const profileSurface = toolContext?.agentProfile?.surface;
  const surface =
    profileSurface === 'partner' || profileSurface === 'code' ? profileSurface : undefined;
  const taskSurface = toolContext?.taskSurface;
  if (
    taskSurface !== undefined &&
    taskSurface !== 'cli' &&
    taskSurface !== 'repl' &&
    taskSurface !== 'plan'
  ) {
    return undefined;
  }

  if (stored) {
    if (sessionId !== undefined && sessionId !== stored.sessionId) return undefined;
    if (surface !== undefined && surface !== stored.surface) return undefined;
    return {
      ...stored,
      ...(toolContext?.toolCallId !== undefined ? { toolCallId: toolContext.toolCallId } : {}),
      ...(taskSurface !== undefined ? { taskSurface } : {}),
    };
  }

  const projectRoot = toolContext?.executionCwd ?? toolContext?.gitRoot;
  if (!sessionId || !projectRoot || !surface) return undefined;
  return {
    sessionId,
    surface,
    projectRoot,
    ...(toolContext.toolCallId !== undefined ? { toolCallId: toolContext.toolCallId } : {}),
    ...(taskSurface !== undefined ? { taskSurface } : {}),
  };
}
