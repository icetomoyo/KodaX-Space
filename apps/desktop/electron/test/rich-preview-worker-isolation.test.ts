import assert from 'node:assert/strict';
import { test } from 'node:test';
import JSZip from 'jszip';
import { createOfficeArtifactBytes } from '../artifact/office-writers.js';
import {
  DOCX_PREVIEW_MAX_HTML_BYTES,
  DOCX_PREVIEW_MAX_MARKUP_TOKENS,
  isDocxPreviewHtmlWithinLimit,
  normalizeDocxPreviewWorkerResponse,
  type DocxPreviewParseRequest,
  type DocxPreviewWorkerResponse,
} from '../../renderer/src/features/preview/docxPreviewProtocol.js';
import { parseDocxPreviewBase64 } from '../../renderer/src/features/preview/docxPreviewParser.js';
import {
  DOCX_PREVIEW_WORKER_TIMEOUT_MS,
  startDocxPreviewWorker,
  type DocxPreviewWorkerPort,
} from '../../renderer/src/features/preview/docxPreviewWorkerClient.js';
import {
  isPdfPageCountSupported,
  PDF_MAX_PAGE_COUNT,
} from '../../renderer/src/features/preview/pdfPreviewLimits.js';
import {
  extractPptxSlideText,
  parsePptxPreview,
  PptxPreviewLimitError,
} from '../../renderer/src/features/preview/pptxPreviewParser.js';
import {
  PPTX_PREVIEW_MAX_LINES_PER_SLIDE,
  PPTX_PREVIEW_MAX_SLIDES,
  PPTX_PREVIEW_MAX_TEXT_BYTES_PER_SLIDE,
  normalizePptxPreviewWorkerResponse,
  type PptxPreviewParseRequest,
  type PptxPreviewWorkerResponse,
} from '../../renderer/src/features/preview/pptxPreviewProtocol.js';
import {
  PPTX_PREVIEW_WORKER_TIMEOUT_MS,
  startPptxPreviewWorker,
  type PptxPreviewWorkerPort,
} from '../../renderer/src/features/preview/pptxPreviewWorkerClient.js';

type TimeoutHandle = ReturnType<typeof setTimeout>;

function fakeTimers(): {
  readonly options: {
    scheduleTimeout: (callback: () => void, delayMs: number) => TimeoutHandle;
    cancelTimeout: (handle: TimeoutHandle) => void;
  };
  readonly delays: number[];
  readonly callbacks: (() => void)[];
  readonly cancelled: TimeoutHandle[];
} {
  const delays: number[] = [];
  const callbacks: (() => void)[] = [];
  const cancelled: TimeoutHandle[] = [];
  return {
    options: {
      scheduleTimeout: (callback, delayMs) => {
        callbacks.push(callback);
        delays.push(delayMs);
        return callbacks.length as unknown as TimeoutHandle;
      },
      cancelTimeout: (handle) => cancelled.push(handle),
    },
    delays,
    callbacks,
    cancelled,
  };
}

class FakeDocxWorker implements DocxPreviewWorkerPort {
  onmessage: ((event: MessageEvent<DocxPreviewWorkerResponse>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  readonly messages: DocxPreviewParseRequest[] = [];
  terminateCount = 0;

  postMessage(message: DocxPreviewParseRequest): void {
    this.messages.push(message);
  }

  terminate(): void {
    this.terminateCount += 1;
  }

  emit(response: DocxPreviewWorkerResponse): void {
    this.onmessage?.({ data: response } as MessageEvent<DocxPreviewWorkerResponse>);
  }

  emitRaw(response: unknown): void {
    this.onmessage?.({ data: response } as MessageEvent<DocxPreviewWorkerResponse>);
  }
}

class FakePptxWorker implements PptxPreviewWorkerPort {
  onmessage: ((event: MessageEvent<PptxPreviewWorkerResponse>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  readonly messages: PptxPreviewParseRequest[] = [];
  terminateCount = 0;

  postMessage(message: PptxPreviewParseRequest): void {
    this.messages.push(message);
  }

  terminate(): void {
    this.terminateCount += 1;
  }

  emit(response: PptxPreviewWorkerResponse): void {
    this.onmessage?.({ data: response } as MessageEvent<PptxPreviewWorkerResponse>);
  }

  emitRaw(response: unknown): void {
    this.onmessage?.({ data: response } as MessageEvent<PptxPreviewWorkerResponse>);
  }

  emitError(): void {
    this.onerror?.({} as ErrorEvent);
  }
}

test('docx HTML budget counts UTF-8 bytes, not only JavaScript code units', () => {
  assert.equal(isDocxPreviewHtmlWithinLimit('a'.repeat(DOCX_PREVIEW_MAX_HTML_BYTES)), true);
  assert.equal(isDocxPreviewHtmlWithinLimit('a'.repeat(DOCX_PREVIEW_MAX_HTML_BYTES + 1)), false);
  assert.equal(
    isDocxPreviewHtmlWithinLimit('\u4e2d'.repeat(DOCX_PREVIEW_MAX_HTML_BYTES / 3)),
    true,
  );
  assert.equal(
    isDocxPreviewHtmlWithinLimit('\u4e2d'.repeat(Math.floor(DOCX_PREVIEW_MAX_HTML_BYTES / 3) + 1)),
    false,
  );
});

test('docx HTML budget linearly caps markup before DOMParser allocation', () => {
  assert.equal(isDocxPreviewHtmlWithinLimit('<br>'.repeat(DOCX_PREVIEW_MAX_MARKUP_TOKENS)), true);
  assert.equal(
    isDocxPreviewHtmlWithinLimit('<br>'.repeat(DOCX_PREVIEW_MAX_MARKUP_TOKENS + 1)),
    false,
  );
  assert.deepEqual(
    normalizeDocxPreviewWorkerResponse({
      type: 'success',
      html: '<i></i>'.repeat(Math.floor(DOCX_PREVIEW_MAX_MARKUP_TOKENS / 2) + 1),
    }),
    { type: 'error', code: 'too-large' },
  );
});

test('docx Worker parser reports malformed base64 without running mammoth', async () => {
  assert.deepEqual(await parseDocxPreviewBase64('not base64!'), {
    type: 'error',
    code: 'decode',
  });
});

test('docx Worker parser converts a real generated document into bounded HTML', async () => {
  const artifact = await createOfficeArtifactBytes({
    kind: 'docx',
    title: 'Worker fixture',
    content: '# Heading\n\nHello from the disposable Worker path.',
  });
  const response = await parseDocxPreviewBase64(Buffer.from(artifact.bytes).toString('base64'));

  assert.equal(response.type, 'success');
  if (response.type === 'success') {
    assert.match(response.html, /Hello from the disposable Worker path\./u);
    assert.equal(isDocxPreviewHtmlWithinLimit(response.html), true);
  }
});

test('docx Worker client sends one request and terminates after success', () => {
  const worker = new FakeDocxWorker();
  const timers = fakeTimers();
  const settled: DocxPreviewWorkerResponse[] = [];
  const cleanup = startDocxPreviewWorker('YWJj', (response) => settled.push(response), {
    createWorker: () => worker,
    ...timers.options,
  });

  assert.deepEqual(worker.messages, [{ type: 'parse', base64: 'YWJj' }]);
  assert.deepEqual(timers.delays, [DOCX_PREVIEW_WORKER_TIMEOUT_MS]);
  worker.emit({ type: 'success', html: '<p>safe</p>' });
  assert.deepEqual(settled, [{ type: 'success', html: '<p>safe</p>' }]);
  assert.equal(worker.terminateCount, 1);
  assert.equal(timers.cancelled.length, 1);

  cleanup();
  assert.equal(worker.terminateCount, 1);
});

test('docx Worker client deadline terminates a stuck conversion', () => {
  const worker = new FakeDocxWorker();
  const timers = fakeTimers();
  const settled: DocxPreviewWorkerResponse[] = [];
  startDocxPreviewWorker('YWJj', (response) => settled.push(response), {
    createWorker: () => worker,
    ...timers.options,
  });

  timers.callbacks[0]?.();
  assert.deepEqual(settled, [{ type: 'error', code: 'convert' }]);
  assert.equal(worker.terminateCount, 1);
  assert.equal(timers.cancelled.length, 1);
});

test('docx Worker client rejects malformed or amplification-heavy responses', () => {
  const worker = new FakeDocxWorker();
  const settled: DocxPreviewWorkerResponse[] = [];
  startDocxPreviewWorker('YWJj', (response) => settled.push(response), {
    createWorker: () => worker,
  });

  worker.emitRaw({
    type: 'success',
    html: '<br>'.repeat(DOCX_PREVIEW_MAX_MARKUP_TOKENS + 1),
  });
  assert.deepEqual(settled, [{ type: 'error', code: 'too-large' }]);
  assert.equal(worker.terminateCount, 1);
});

test('PPTX text extraction is namespace-neutral, entity-aware, and clone-safe', () => {
  const result = extractPptxSlideText(
    '<p:sld><a:t>  First &amp; second  </a:t><x:t>\u4e2d\u6587 &#x1f600;</x:t></p:sld>',
  );
  assert.deepEqual(result.lines, ['First & second', '\u4e2d\u6587 \ud83d\ude00']);
  assert.doesNotThrow(() => structuredClone(result));
});

test('PPTX text extraction rejects per-slide byte and line explosions', () => {
  assert.throws(
    () =>
      extractPptxSlideText(`<a:t>${'x'.repeat(PPTX_PREVIEW_MAX_TEXT_BYTES_PER_SLIDE + 1)}</a:t>`),
    PptxPreviewLimitError,
  );

  const tooManyLines = Array.from(
    { length: PPTX_PREVIEW_MAX_LINES_PER_SLIDE + 1 },
    (_, index) => `<a:t>${index}</a:t>`,
  ).join('');
  assert.throws(() => extractPptxSlideText(tooManyLines), PptxPreviewLimitError);
});

test('PPTX parser orders slide files and extracts them sequentially into DTOs', async () => {
  const zip = new JSZip();
  zip.file('ppt/slides/slide2.xml', '<p:sld><a:t>Second</a:t></p:sld>');
  zip.file('ppt/slides/slide1.xml', '<p:sld><a:t>First</a:t></p:sld>');
  zip.file('ppt/notesSlides/notesSlide1.xml', '<a:t>Ignored</a:t>');
  const bytes = await zip.generateAsync({ type: 'uint8array' });

  assert.deepEqual(await parsePptxPreview(bytes), [
    { index: 1, lines: ['First'] },
    { index: 2, lines: ['Second'] },
  ]);
});

test('PPTX parser rejects presentations above the slide-count limit', async () => {
  const zip = new JSZip();
  for (let index = 1; index <= PPTX_PREVIEW_MAX_SLIDES + 1; index += 1) {
    zip.file(`ppt/slides/slide${index}.xml`, '<p:sld/>');
  }
  const bytes = await zip.generateAsync({ type: 'uint8array' });

  await assert.rejects(() => parsePptxPreview(bytes), PptxPreviewLimitError);
});

test('PPTX Worker cleanup terminates and suppresses a stale response', () => {
  const worker = new FakePptxWorker();
  const timers = fakeTimers();
  const settled: PptxPreviewWorkerResponse[] = [];
  const cleanup = startPptxPreviewWorker('YWJj', (response) => settled.push(response), {
    createWorker: () => worker,
    ...timers.options,
  });

  assert.deepEqual(timers.delays, [PPTX_PREVIEW_WORKER_TIMEOUT_MS]);
  cleanup();
  worker.emit({ type: 'success', slides: [] });
  assert.deepEqual(settled, []);
  assert.equal(worker.terminateCount, 1);
  assert.equal(timers.cancelled.length, 1);
});

test('PPTX Worker error terminates and clears its deadline', () => {
  const worker = new FakePptxWorker();
  const timers = fakeTimers();
  const settled: PptxPreviewWorkerResponse[] = [];
  startPptxPreviewWorker('YWJj', (response) => settled.push(response), {
    createWorker: () => worker,
    ...timers.options,
  });

  worker.emitError();
  assert.deepEqual(settled, [{ type: 'error', code: 'parse' }]);
  assert.equal(worker.terminateCount, 1);
  assert.equal(timers.cancelled.length, 1);
});

test('PPTX Worker client validates DTO shape and output caps before rendering', () => {
  assert.deepEqual(
    normalizePptxPreviewWorkerResponse({
      type: 'success',
      slides: [{ index: 99, lines: ['wrong index'] }],
    }),
    { type: 'error', code: 'parse' },
  );

  const worker = new FakePptxWorker();
  const settled: PptxPreviewWorkerResponse[] = [];
  startPptxPreviewWorker('YWJj', (response) => settled.push(response), {
    createWorker: () => worker,
  });
  worker.emitRaw({
    type: 'success',
    slides: [
      {
        index: 1,
        lines: Array.from({ length: PPTX_PREVIEW_MAX_LINES_PER_SLIDE + 1 }, () => ''),
      },
    ],
  });

  assert.deepEqual(settled, [{ type: 'error', code: 'too-large' }]);
  assert.equal(worker.terminateCount, 1);
});

test('PDF page-count limit accepts the boundary and rejects unsafe values', () => {
  assert.equal(isPdfPageCountSupported(1), true);
  assert.equal(isPdfPageCountSupported(PDF_MAX_PAGE_COUNT), true);
  assert.equal(isPdfPageCountSupported(PDF_MAX_PAGE_COUNT + 1), false);
  assert.equal(isPdfPageCountSupported(0), false);
  assert.equal(isPdfPageCountSupported(1.5), false);
  assert.equal(isPdfPageCountSupported(Number.POSITIVE_INFINITY), false);
});
