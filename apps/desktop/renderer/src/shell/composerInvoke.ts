import {
  type ChannelInput,
  type ChannelOutput,
  type InvokeChannelName,
  type IpcResult,
} from '@kodax-space/space-ipc-schema';

interface ComposerInvokeOptions<T> {
  readonly timeoutMs?: number | null;
  readonly onLateResult?: (result: IpcResult<T>) => void;
}

export type TrackedStateAction<T> = T | ((current: T) => T);

export function applyTrackedStateAction<T>(current: T, next: TrackedStateAction<T>): T {
  return typeof next === 'function' ? (next as (value: T) => T)(current) : next;
}

const DEFAULT_TIMEOUT_MS = 45_000;
const CHANNEL_TIMEOUT_MS: Partial<Record<InvokeChannelName, number>> = {
  'session.create': 45_000,
  'session.send': 30_000,
  'session.setTitle': 10_000,
  'slash.exec': 90_000,
  'skill.invoke': 60_000,
  'skill.discover': 45_000,
  'provider.test': 30_000,
  'mcp.reload': 45_000,
  'mcp.discover': 45_000,
};

function invokeFailure<T>(
  channel: InvokeChannelName,
  message: string,
  details?: unknown,
): IpcResult<T> {
  return {
    ok: false,
    error: {
      code: 'INTERNAL',
      message,
      details: details === undefined ? { channel } : { channel, cause: details },
    },
  };
}

function timeoutFailure<T>(channel: InvokeChannelName, timeoutMs: number): IpcResult<T> {
  return invokeFailure(
    channel,
    `${channel} timed out after ${Math.round(timeoutMs / 1000)}s. The request may still finish in the background.`,
    { timedOut: true },
  );
}

export function isComposerTimeoutResult<T>(result: IpcResult<T>): boolean {
  if (result.ok) return false;
  const details = result.error.details;
  if (!details || typeof details !== 'object' || !('cause' in details)) return false;
  const cause = (details as { cause?: unknown }).cause;
  return (
    !!cause && typeof cause === 'object' && (cause as { timedOut?: unknown }).timedOut === true
  );
}

export function composerResultOwnsCurrentSession(
  ownerSessionId: string,
  currentSessionId: string | null,
): boolean {
  return ownerSessionId === currentSessionId;
}

export function routeComposerFailure(
  ownerSessionId: string,
  currentSessionId: string | null,
  context: {
    readonly late: boolean;
    readonly currentComposerOccupied: boolean;
  },
  onCurrentSession: () => void,
  onBackgroundSession: () => void,
): void {
  if (
    composerResultOwnsCurrentSession(ownerSessionId, currentSessionId) &&
    (!context.late || !context.currentComposerOccupied)
  ) {
    onCurrentSession();
  } else {
    onBackgroundSession();
  }
}

export async function invokeComposerIpc<C extends InvokeChannelName>(
  channel: C,
  payload: ChannelInput<C>,
  optionsOrTimeoutMs: number | ComposerInvokeOptions<ChannelOutput<C>> = {},
): Promise<IpcResult<ChannelOutput<C>>> {
  const bridge = window.kodaxSpace;
  if (!bridge) return invokeFailure(channel, 'IPC unavailable');

  const options =
    typeof optionsOrTimeoutMs === 'number' ? { timeoutMs: optionsOrTimeoutMs } : optionsOrTimeoutMs;
  const timeoutMs =
    options.timeoutMs === null
      ? null
      : (options.timeoutMs ?? CHANNEL_TIMEOUT_MS[channel] ?? DEFAULT_TIMEOUT_MS);
  let timer: number | undefined;
  let timedOut = false;
  const timeoutResult =
    timeoutMs === null
      ? null
      : new Promise<IpcResult<ChannelOutput<C>>>((resolve) => {
          timer = window.setTimeout(() => {
            timedOut = true;
            resolve(timeoutFailure(channel, timeoutMs));
          }, timeoutMs);
        });
  const invokeResult = bridge
    .invoke(channel, payload)
    .catch((error: unknown) =>
      invokeFailure<ChannelOutput<C>>(
        channel,
        error instanceof Error ? error.message : String(error),
        error,
      ),
    )
    .then((result) => {
      if (timedOut) options.onLateResult?.(result);
      return result;
    });

  try {
    return timeoutResult === null
      ? await invokeResult
      : await Promise.race([invokeResult, timeoutResult]);
  } finally {
    if (timer !== undefined) window.clearTimeout(timer);
  }
}
