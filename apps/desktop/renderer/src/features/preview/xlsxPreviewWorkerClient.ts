import type { XlsxPreviewParseRequest, XlsxPreviewWorkerResponse } from './xlsxPreviewProtocol.js';
import {
  startDisposablePreviewWorker,
  type DisposablePreviewWorkerPort,
} from './disposablePreviewWorkerClient.js';

export type XlsxPreviewWorkerPort = DisposablePreviewWorkerPort<
  XlsxPreviewParseRequest,
  XlsxPreviewWorkerResponse
>;

export type XlsxPreviewWorkerFactory = () => XlsxPreviewWorkerPort;
export const XLSX_PREVIEW_WORKER_TIMEOUT_MS = 15_000;

type TimeoutHandle = ReturnType<typeof globalThis.setTimeout>;

interface XlsxPreviewWorkerOptions {
  readonly createWorker?: XlsxPreviewWorkerFactory;
  readonly timeoutMs?: number;
  readonly scheduleTimeout?: (callback: () => void, delayMs: number) => TimeoutHandle;
  readonly cancelTimeout?: (handle: TimeoutHandle) => void;
}

function createXlsxPreviewWorker(): XlsxPreviewWorkerPort {
  return new Worker(new URL('./xlsxPreview.worker.ts', import.meta.url), { type: 'module' });
}

/**
 * Start one parse operation. The returned cleanup always terminates its Worker and
 * suppresses late responses, so prop changes and component unmounts cannot race UI state.
 */
export function startXlsxPreviewWorker(
  base64: string,
  onSettled: (response: XlsxPreviewWorkerResponse) => void,
  options: XlsxPreviewWorkerOptions = {},
): () => void {
  return startDisposablePreviewWorker({ type: 'parse', base64 }, onSettled, {
    createWorker: options.createWorker ?? createXlsxPreviewWorker,
    timeoutMs: options.timeoutMs ?? XLSX_PREVIEW_WORKER_TIMEOUT_MS,
    errorResponse: { type: 'error', code: 'parse' },
    scheduleTimeout: options.scheduleTimeout,
    cancelTimeout: options.cancelTimeout,
  });
}
