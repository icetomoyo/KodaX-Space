import { parsePptxPreviewBase64 } from './pptxPreviewParser.js';
import type { PptxPreviewParseRequest, PptxPreviewWorkerResponse } from './pptxPreviewProtocol.js';

interface PptxPreviewWorkerScope {
  onmessage: ((event: MessageEvent<PptxPreviewParseRequest>) => void) | null;
  postMessage(message: PptxPreviewWorkerResponse): void;
}

const scope = globalThis as unknown as PptxPreviewWorkerScope;

scope.onmessage = (event): void => {
  const request = event.data;
  if (request.type !== 'parse') {
    scope.postMessage({ type: 'error', code: 'parse' });
    return;
  }

  void parsePptxPreviewBase64(request.base64).then(
    (response) => scope.postMessage(response),
    () => scope.postMessage({ type: 'error', code: 'parse' }),
  );
};
