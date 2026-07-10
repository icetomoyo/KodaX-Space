import { parseXlsxPreviewBase64 } from './xlsxPreviewParser.js';
import type { XlsxPreviewParseRequest, XlsxPreviewWorkerResponse } from './xlsxPreviewProtocol.js';

interface XlsxPreviewWorkerScope {
  onmessage: ((event: MessageEvent<XlsxPreviewParseRequest>) => void) | null;
  postMessage(message: XlsxPreviewWorkerResponse): void;
}

const scope = globalThis as unknown as XlsxPreviewWorkerScope;

scope.onmessage = (event) => {
  if (event.data.type !== 'parse') return;
  scope.postMessage(parseXlsxPreviewBase64(event.data.base64));
};
