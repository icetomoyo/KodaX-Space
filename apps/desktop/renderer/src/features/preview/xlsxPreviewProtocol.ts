export const XLSX_PREVIEW_MAX_CELLS = 50_000;
export const XLSX_PREVIEW_MAX_COLUMNS = 512;

export type XlsxPreviewErrorCode = 'decode' | 'parse';

export interface XlsxPreviewSheetDto {
  readonly name: string;
  readonly rows: readonly (readonly string[])[];
  readonly truncated: boolean;
}

export interface XlsxPreviewParseRequest {
  readonly type: 'parse';
  readonly base64: string;
}

export type XlsxPreviewWorkerResponse =
  | {
      readonly type: 'success';
      readonly sheets: readonly XlsxPreviewSheetDto[];
    }
  | {
      readonly type: 'error';
      readonly code: XlsxPreviewErrorCode;
    };
