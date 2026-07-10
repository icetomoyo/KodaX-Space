export interface DisposablePreviewWorkerPort<Request, Response> {
  onmessage: ((event: MessageEvent<Response>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  postMessage(message: Request): void;
  terminate(): void;
}

type TimeoutHandle = ReturnType<typeof globalThis.setTimeout>;

export interface DisposablePreviewWorkerOptions<Request, Response> {
  readonly createWorker: () => DisposablePreviewWorkerPort<Request, Response>;
  readonly timeoutMs: number;
  readonly errorResponse: Response;
  readonly normalizeResponse?: (response: unknown) => Response;
  readonly scheduleTimeout?: (callback: () => void, delayMs: number) => TimeoutHandle;
  readonly cancelTimeout?: (handle: TimeoutHandle) => void;
}

/**
 * Run exactly one preview parse operation in a disposable Worker.
 *
 * Every terminal path (success, Worker error, postMessage failure, deadline,
 * prop change, and component unmount) detaches handlers, clears the deadline,
 * and terminates the Worker exactly once.
 */
export function startDisposablePreviewWorker<Request, Response>(
  request: Request,
  onSettled: (response: Response) => void,
  options: DisposablePreviewWorkerOptions<Request, Response>,
): () => void {
  let worker: DisposablePreviewWorkerPort<Request, Response>;
  try {
    worker = options.createWorker();
  } catch {
    onSettled(options.errorResponse);
    return () => undefined;
  }

  let active = true;
  let timeoutHandle: TimeoutHandle | undefined;
  const cancelTimeout = options.cancelTimeout ?? globalThis.clearTimeout;

  const stop = (): boolean => {
    if (!active) return false;
    active = false;
    if (timeoutHandle !== undefined) {
      cancelTimeout(timeoutHandle);
      timeoutHandle = undefined;
    }
    worker.onmessage = null;
    worker.onerror = null;
    worker.terminate();
    return true;
  };

  const settle = (response: Response): void => {
    if (!stop()) return;
    onSettled(response);
  };

  worker.onmessage = (event) => {
    let response: Response;
    try {
      response = options.normalizeResponse?.(event.data) ?? event.data;
    } catch {
      response = options.errorResponse;
    }
    settle(response);
  };
  worker.onerror = () => settle(options.errorResponse);
  const scheduleTimeout = options.scheduleTimeout ?? globalThis.setTimeout;
  timeoutHandle = scheduleTimeout(() => settle(options.errorResponse), options.timeoutMs);

  try {
    worker.postMessage(request);
  } catch {
    settle(options.errorResponse);
  }

  return () => {
    stop();
  };
}
