// XlsxViewer — F024 .xlsx / .xls rendering.
// SheetJS parsing runs in a disposable Web Worker; this component only renders
// structured-clone-safe sheet DTOs and owns the Worker lifecycle.
import { useEffect, useState } from 'react';
import { useI18n } from '../../i18n/I18nProvider.js';
import {
  XLSX_PREVIEW_MAX_CELLS,
  type XlsxPreviewErrorCode,
  type XlsxPreviewSheetDto,
} from './xlsxPreviewProtocol.js';
import { startXlsxPreviewWorker } from './xlsxPreviewWorkerClient.js';

interface Props {
  readonly base64: string;
}

export function XlsxViewer({ base64 }: Props): JSX.Element {
  const { t } = useI18n();
  const [sheets, setSheets] = useState<readonly XlsxPreviewSheetDto[]>([]);
  const [activeSheet, setActiveSheet] = useState(0);
  const [err, setErr] = useState<XlsxPreviewErrorCode | null>(null);
  const [busy, setBusy] = useState(true);

  useEffect(() => {
    setBusy(true);
    setErr(null);
    setActiveSheet(0);

    return startXlsxPreviewWorker(base64, (response) => {
      if (response.type === 'success') {
        setSheets(response.sheets);
      } else {
        setErr(response.code);
      }
      setBusy(false);
    });
  }, [base64]);

  if (err !== null) {
    const key =
      err === 'decode' ? 'preview.failedDecodeSpreadsheet' : 'preview.failedParseSpreadsheet';
    return <div className="p-3 text-xs text-danger">{t(key)}</div>;
  }
  if (busy)
    return <div className="p-3 text-xs text-fg-muted">{t('preview.parsingSpreadsheet')}</div>;
  if (sheets.length === 0)
    return <div className="p-3 text-xs text-fg-muted">{t('preview.emptyWorkbook')}</div>;

  const current = sheets[activeSheet];
  if (current === undefined)
    return <div className="p-3 text-xs text-fg-muted">{t('preview.noSheet')}</div>;

  return (
    <div className="h-full flex flex-col" data-testid="xlsx-viewer">
      {sheets.length > 1 && (
        <div className="flex items-stretch border-b border-border-default/60 bg-surface text-xs flex-shrink-0 overflow-x-auto">
          {sheets.map((sheet, index) => {
            const isActive = index === activeSheet;
            return (
              <button
                key={sheet.name + index}
                type="button"
                className={`px-2 py-1 border-r border-border-default/60 whitespace-nowrap ${
                  isActive ? 'bg-surface-2 text-fg-primary' : 'text-fg-muted hover:bg-hover-bg'
                }`}
                onClick={() => setActiveSheet(index)}
              >
                {sheet.name}
              </button>
            );
          })}
        </div>
      )}
      <div className="flex-1 min-h-0 overflow-auto">
        <table className="text-xs font-mono border-collapse">
          <tbody>
            {current.rows.map((row, rowIndex) => (
              <tr key={rowIndex}>
                <th className="bg-surface-2 text-fg-muted px-2 border border-border-default sticky left-0">
                  {rowIndex + 1}
                </th>
                {row.map((cell, cellIndex) => (
                  <td
                    key={cellIndex}
                    className="px-2 py-0.5 border border-border-default text-fg-secondary max-w-[240px] truncate"
                    title={cell}
                  >
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
            {current.truncated && (
              <tr>
                <th className="bg-surface-2 text-fg-muted px-2 border border-border-default sticky left-0">
                  {current.rows.length + 1}
                </th>
                <td className="px-2 py-0.5 border border-border-default text-fg-secondary">
                  {t('preview.truncatedCells', {
                    count: XLSX_PREVIEW_MAX_CELLS.toLocaleString(),
                  })}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
