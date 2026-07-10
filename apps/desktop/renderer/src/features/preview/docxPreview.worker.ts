import { parseDocxPreviewBase64 } from './docxPreviewParser.js';
import type { DocxPreviewParseRequest, DocxPreviewWorkerResponse } from './docxPreviewProtocol.js';

interface DocxPreviewWorkerScope {
  onmessage: ((event: MessageEvent<DocxPreviewParseRequest>) => void) | null;
  postMessage(message: DocxPreviewWorkerResponse): void;
}

const scope = globalThis as unknown as DocxPreviewWorkerScope;

scope.onmessage = (event): void => {
  const request = event.data;
  if (request.type !== 'parse') {
    scope.postMessage({ type: 'error', code: 'convert' });
    return;
  }

  void parseDocxPreviewBase64(request.base64).then(
    (response) => scope.postMessage(response),
    () => scope.postMessage({ type: 'error', code: 'convert' }),
  );
};
