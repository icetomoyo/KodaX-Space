import {
  startDisposablePreviewWorker,
  type DisposablePreviewWorkerPort,
} from './disposablePreviewWorkerClient.js';
import {
  normalizeDocxPreviewWorkerResponse,
  type DocxPreviewParseRequest,
  type DocxPreviewWorkerResponse,
} from './docxPreviewProtocol.js';

export type DocxPreviewWorkerPort = DisposablePreviewWorkerPort<
  DocxPreviewParseRequest,
  DocxPreviewWorkerResponse
>;

export type DocxPreviewWorkerFactory = () => DocxPreviewWorkerPort;
export const DOCX_PREVIEW_WORKER_TIMEOUT_MS = 15_000;

type TimeoutHandle = ReturnType<typeof globalThis.setTimeout>;

interface DocxPreviewWorkerOptions {
  readonly createWorker?: DocxPreviewWorkerFactory;
  readonly timeoutMs?: number;
  readonly scheduleTimeout?: (callback: () => void, delayMs: number) => TimeoutHandle;
  readonly cancelTimeout?: (handle: TimeoutHandle) => void;
}

function createDocxPreviewWorker(): DocxPreviewWorkerPort {
  return new Worker(new URL('./docxPreview.worker.ts', import.meta.url), { type: 'module' });
}

export function startDocxPreviewWorker(
  base64: string,
  onSettled: (response: DocxPreviewWorkerResponse) => void,
  options: DocxPreviewWorkerOptions = {},
): () => void {
  return startDisposablePreviewWorker({ type: 'parse', base64 }, onSettled, {
    createWorker: options.createWorker ?? createDocxPreviewWorker,
    timeoutMs: options.timeoutMs ?? DOCX_PREVIEW_WORKER_TIMEOUT_MS,
    errorResponse: { type: 'error', code: 'convert' },
    normalizeResponse: normalizeDocxPreviewWorkerResponse,
    scheduleTimeout: options.scheduleTimeout,
    cancelTimeout: options.cancelTimeout,
  });
}
