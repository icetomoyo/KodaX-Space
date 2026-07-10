import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as XLSX from 'xlsx';
import {
  parseXlsxPreview,
  parseXlsxPreviewBase64,
  worksheetToXlsxPreview,
} from '../../renderer/src/features/preview/xlsxPreviewParser.js';
import type {
  XlsxPreviewParseRequest,
  XlsxPreviewWorkerResponse,
} from '../../renderer/src/features/preview/xlsxPreviewProtocol.js';
import {
  startXlsxPreviewWorker,
  XLSX_PREVIEW_WORKER_TIMEOUT_MS,
  type XlsxPreviewWorkerPort,
} from '../../renderer/src/features/preview/xlsxPreviewWorkerClient.js';

function workbookBytes(): Uint8Array {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet([
      ['Name', 'Value'],
      ['\u4e2d\u6587', 42],
    ]),
    'Data',
  );
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['Second']]), 'Notes');
  return new Uint8Array(XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }));
}

class FakeWorker implements XlsxPreviewWorkerPort {
  onmessage: ((event: MessageEvent<XlsxPreviewWorkerResponse>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  readonly messages: XlsxPreviewParseRequest[] = [];
  terminateCount = 0;

  postMessage(message: XlsxPreviewParseRequest): void {
    this.messages.push(message);
  }

  terminate(): void {
    this.terminateCount += 1;
  }

  emit(response: XlsxPreviewWorkerResponse): void {
    this.onmessage?.({ data: response } as MessageEvent<XlsxPreviewWorkerResponse>);
  }

  emitError(): void {
    this.onerror?.({} as ErrorEvent);
  }
}

function fakeTimers(): {
  readonly options: {
    scheduleTimeout: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
    cancelTimeout: (handle: ReturnType<typeof setTimeout>) => void;
  };
  readonly delays: number[];
  readonly callbacks: (() => void)[];
  readonly cancelled: ReturnType<typeof setTimeout>[];
} {
  const delays: number[] = [];
  const callbacks: (() => void)[] = [];
  const cancelled: ReturnType<typeof setTimeout>[] = [];
  return {
    options: {
      scheduleTimeout: (callback, delayMs) => {
        callbacks.push(callback);
        delays.push(delayMs);
        return callbacks.length as unknown as ReturnType<typeof setTimeout>;
      },
      cancelTimeout: (handle) => cancelled.push(handle),
    },
    delays,
    callbacks,
    cancelled,
  };
}

test('xlsx preview parser returns serializable multi-sheet string matrices', () => {
  const sheets = parseXlsxPreview(workbookBytes());
  assert.deepEqual(sheets, [
    {
      name: 'Data',
      rows: [
        ['Name', 'Value'],
        ['\u4e2d\u6587', '42'],
      ],
      truncated: false,
    },
    { name: 'Notes', rows: [['Second']], truncated: false },
  ]);
  assert.doesNotThrow(() => structuredClone(sheets));
});

test('xlsx preview parser preserves the cell cap as a truncation marker', () => {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet([
      ['a', 'b', 'c'],
      ['d', 'e'],
    ]),
    'Capped',
  );
  const bytes = new Uint8Array(XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }));

  assert.deepEqual(parseXlsxPreview(bytes, 3), [
    { name: 'Capped', rows: [['a', 'b', 'c']], truncated: true },
  ]);
});

test('xlsx preview parser bounds a huge sparse declared range before matrix creation', () => {
  const worksheet: XLSX.WorkSheet = {
    A1: { t: 's', v: 'first' },
    '!ref': 'A1:XFD1048576',
  };

  const sheet = worksheetToXlsxPreview('Sparse', worksheet, 50_000);
  assert.deepEqual(sheet.rows, [['first']]);
  assert.equal(sheet.truncated, true);
  assert.ok(sheet.rows.length * (sheet.rows[0]?.length ?? 0) <= 50_000);
});

test('xlsx preview worker parser distinguishes decode and workbook parse errors', () => {
  assert.deepEqual(parseXlsxPreviewBase64('not base64!'), { type: 'error', code: 'decode' });
  assert.deepEqual(parseXlsxPreviewBase64('UEsDBA=='), {
    type: 'error',
    code: 'parse',
  });
});

test('xlsx preview worker client sends a DTO and terminates after success', () => {
  const worker = new FakeWorker();
  const timers = fakeTimers();
  const settled: XlsxPreviewWorkerResponse[] = [];
  const cleanup = startXlsxPreviewWorker('YWJj', (response) => settled.push(response), {
    createWorker: () => worker,
    ...timers.options,
  });

  assert.deepEqual(worker.messages, [{ type: 'parse', base64: 'YWJj' }]);
  assert.deepEqual(timers.delays, [XLSX_PREVIEW_WORKER_TIMEOUT_MS]);
  worker.emit({ type: 'success', sheets: [] });
  assert.deepEqual(settled, [{ type: 'success', sheets: [] }]);
  assert.equal(worker.terminateCount, 1);
  assert.equal(timers.cancelled.length, 1);

  cleanup();
  assert.equal(worker.terminateCount, 1);
  assert.equal(timers.cancelled.length, 1);
});

test('xlsx preview worker client cleanup terminates and suppresses a stale response', () => {
  const worker = new FakeWorker();
  const timers = fakeTimers();
  const settled: XlsxPreviewWorkerResponse[] = [];
  const cleanup = startXlsxPreviewWorker('YWJj', (response) => settled.push(response), {
    createWorker: () => worker,
    ...timers.options,
  });

  cleanup();
  worker.emit({ type: 'success', sheets: [] });
  assert.deepEqual(settled, []);
  assert.equal(worker.terminateCount, 1);
  assert.equal(timers.cancelled.length, 1);
});

test('xlsx preview worker client clears its deadline on Worker error', () => {
  const worker = new FakeWorker();
  const timers = fakeTimers();
  const settled: XlsxPreviewWorkerResponse[] = [];
  startXlsxPreviewWorker('YWJj', (response) => settled.push(response), {
    createWorker: () => worker,
    ...timers.options,
  });

  worker.emitError();
  assert.deepEqual(settled, [{ type: 'error', code: 'parse' }]);
  assert.equal(worker.terminateCount, 1);
  assert.equal(timers.cancelled.length, 1);
});

test('xlsx preview worker client deadline terminates a stuck Worker', () => {
  const worker = new FakeWorker();
  const timers = fakeTimers();
  const settled: XlsxPreviewWorkerResponse[] = [];
  startXlsxPreviewWorker('YWJj', (response) => settled.push(response), {
    createWorker: () => worker,
    ...timers.options,
  });

  timers.callbacks[0]?.();
  assert.deepEqual(settled, [{ type: 'error', code: 'parse' }]);
  assert.equal(worker.terminateCount, 1);
  assert.equal(timers.cancelled.length, 1);
});
