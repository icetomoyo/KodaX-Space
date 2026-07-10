import {
  startDisposablePreviewWorker,
  type DisposablePreviewWorkerPort,
} from './disposablePreviewWorkerClient.js';
import {
  normalizePptxPreviewWorkerResponse,
  type PptxPreviewParseRequest,
  type PptxPreviewWorkerResponse,
} from './pptxPreviewProtocol.js';

export type PptxPreviewWorkerPort = DisposablePreviewWorkerPort<
  PptxPreviewParseRequest,
  PptxPreviewWorkerResponse
>;

export type PptxPreviewWorkerFactory = () => PptxPreviewWorkerPort;
export const PPTX_PREVIEW_WORKER_TIMEOUT_MS = 15_000;

type TimeoutHandle = ReturnType<typeof globalThis.setTimeout>;

interface PptxPreviewWorkerOptions {
  readonly createWorker?: PptxPreviewWorkerFactory;
  readonly timeoutMs?: number;
  readonly scheduleTimeout?: (callback: () => void, delayMs: number) => TimeoutHandle;
  readonly cancelTimeout?: (handle: TimeoutHandle) => void;
}

function createPptxPreviewWorker(): PptxPreviewWorkerPort {
  return new Worker(new URL('./pptxPreview.worker.ts', import.meta.url), { type: 'module' });
}

export function startPptxPreviewWorker(
  base64: string,
  onSettled: (response: PptxPreviewWorkerResponse) => void,
  options: PptxPreviewWorkerOptions = {},
): () => void {
  return startDisposablePreviewWorker({ type: 'parse', base64 }, onSettled, {
    createWorker: options.createWorker ?? createPptxPreviewWorker,
    timeoutMs: options.timeoutMs ?? PPTX_PREVIEW_WORKER_TIMEOUT_MS,
    errorResponse: { type: 'error', code: 'parse' },
    normalizeResponse: normalizePptxPreviewWorkerResponse,
    scheduleTimeout: options.scheduleTimeout,
    cancelTimeout: options.cancelTimeout,
  });
}
