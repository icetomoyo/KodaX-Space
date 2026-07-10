import * as XLSX from 'xlsx';
import { base64ToBytes } from './binaryUtils.js';
import {
  XLSX_PREVIEW_MAX_CELLS,
  XLSX_PREVIEW_MAX_COLUMNS,
  type XlsxPreviewSheetDto,
  type XlsxPreviewWorkerResponse,
} from './xlsxPreviewProtocol.js';

function sheetRange(worksheet: XLSX.WorkSheet): XLSX.Range | null {
  const ref = worksheet['!fullref'] ?? worksheet['!ref'];
  return ref === undefined ? null : XLSX.utils.decode_range(ref);
}

/** Convert one worksheet without first materializing its entire declared range. */
export function worksheetToXlsxPreview(
  name: string,
  worksheet: XLSX.WorkSheet,
  maxCells = XLSX_PREVIEW_MAX_CELLS,
): XlsxPreviewSheetDto {
  const sourceRange = sheetRange(worksheet);
  if (sourceRange === null) return { name, rows: [], truncated: false };

  const cellLimit = Math.max(1, Math.floor(maxCells));
  const sourceColumns = sourceRange.e.c - sourceRange.s.c + 1;
  const sourceRows = sourceRange.e.r - sourceRange.s.r + 1;
  const previewColumns = Math.min(sourceColumns, XLSX_PREVIEW_MAX_COLUMNS, cellLimit);
  const previewRows = Math.max(1, Math.floor(cellLimit / previewColumns));
  const range: XLSX.Range = {
    s: sourceRange.s,
    e: {
      c: sourceRange.s.c + previewColumns - 1,
      r: Math.min(sourceRange.e.r, sourceRange.s.r + previewRows - 1),
    },
  };
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(worksheet, {
    header: 1,
    blankrows: false,
    range,
  });
  const rows = matrix.map((row) => row.map((cell) => (cell == null ? '' : String(cell))));

  return {
    name,
    rows,
    truncated: sourceColumns > previewColumns || sourceRows > previewRows,
  };
}

/** Parse an XLSX/XLS payload into a structured-clone-safe preview DTO. */
export function parseXlsxPreview(
  bytes: Uint8Array,
  maxCells = XLSX_PREVIEW_MAX_CELLS,
): readonly XlsxPreviewSheetDto[] {
  const cellLimit = Math.max(1, Math.floor(maxCells));
  const workbook = XLSX.read(bytes, { type: 'array', sheetRows: cellLimit + 1 });
  const sheets: XlsxPreviewSheetDto[] = [];

  for (const name of workbook.SheetNames) {
    const worksheet = workbook.Sheets[name];
    if (worksheet === undefined) continue;
    sheets.push(worksheetToXlsxPreview(name, worksheet, cellLimit));
  }

  return sheets;
}

/** Decode and parse inside the Worker while preserving the viewer's two error messages. */
export function parseXlsxPreviewBase64(base64: string): XlsxPreviewWorkerResponse {
  let bytes: Uint8Array;
  try {
    bytes = base64ToBytes(base64);
  } catch {
    return { type: 'error', code: 'decode' };
  }

  try {
    return { type: 'success', sheets: parseXlsxPreview(bytes) };
  } catch {
    return { type: 'error', code: 'parse' };
  }
}
