import type {
  ChannelInput,
  ChannelOutput,
  InvokeChannelName,
  IpcResult,
} from '@kodax-space/space-ipc-schema';

type Bridge = NonNullable<Window['kodaxSpace']>;

export async function invokeWithTimeout<C extends InvokeChannelName>(
  bridge: Bridge,
  channel: C,
  payload: ChannelInput<C>,
  timeoutMs = 10_000,
): Promise<IpcResult<ChannelOutput<C>>> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeoutResult = new Promise<IpcResult<ChannelOutput<C>>>((resolve) => {
    timer = globalThis.setTimeout(() => {
      resolve({
        ok: false,
        error: {
          code: 'INTERNAL',
          message: `${channel} timed out after ${Math.round(timeoutMs / 1000)}s. The request may still finish in the background.`,
          details: { channel, timedOut: true },
        },
      });
    }, timeoutMs);
  });

  const invokeResult = bridge.invoke(channel, payload).catch(
    (error: unknown): IpcResult<ChannelOutput<C>> => ({
      ok: false,
      error: {
        code: 'INTERNAL',
        message: error instanceof Error ? error.message : String(error),
        details: { channel, cause: error },
      },
    }),
  );

  try {
    return await Promise.race([invokeResult, timeoutResult]);
  } finally {
    if (timer !== undefined) globalThis.clearTimeout(timer);
  }
}
