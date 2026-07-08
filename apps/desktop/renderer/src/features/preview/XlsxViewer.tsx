// XlsxViewer — F024 .xlsx / .xls 渲染
//
// 用 SheetJS Community Edition (0.20.3 from cdn.sheetjs.com)。多 sheet 时给 tab 切换。
// 单 sheet 解析成 cell matrix 渲染 table — 不用 sheet_to_html 避免 SheetJS 内部 HTML
// 模板可能输出的标签直接进 DOM；自己控制渲染 = 安全 + 样式可控。

import { useEffect, useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import { base64ToBytes } from './binaryUtils.js';
import { useI18n } from '../../i18n/I18nProvider.js';
import type { MessageKey } from '../../i18n/messages.js';

interface Props {
  readonly base64: string;
}

interface SheetView {
  readonly name: string;
  readonly rows: readonly (readonly string[])[];
}

const MAX_CELLS = 50_000; // 防巨表炸渲染（≈ 200 cols × 250 rows）

type Translate = (key: MessageKey, vars?: Record<string, string | number>) => string;

function parseWorkbook(bytes: Uint8Array, t: Translate): readonly SheetView[] {
  const wb = XLSX.read(bytes, { type: 'array' });
  const sheets: SheetView[] = [];
  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name];
    if (ws === undefined) continue;
    // header:1 → 二维数组而非键值对象；blankrows:false 跳过空行
    const matrix = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, blankrows: false });
    let cellCount = 0;
    const rows: string[][] = [];
    for (const row of matrix) {
      const stringified = row.map((cell) => (cell == null ? '' : String(cell)));
      cellCount += stringified.length;
      if (cellCount > MAX_CELLS) {
        rows.push([t('preview.truncatedCells', { count: MAX_CELLS.toLocaleString() })]);
        break;
      }
      rows.push(stringified);
    }
    sheets.push({ name, rows });
  }
  return sheets;
}

export function XlsxViewer({ base64 }: Props): JSX.Element {
  const { t } = useI18n();
  const [sheets, setSheets] = useState<readonly SheetView[]>([]);
  const [activeSheet, setActiveSheet] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);

  // Guard base64ToBytes — malformed base64 throws DOMException; uncaught throw
  // out of useMemo crashes component without ErrorBoundary (review HIGH-1)
  const bytes = useMemo(() => {
    try {
      return base64ToBytes(base64);
    } catch {
      return null;
    }
  }, [base64]);

  useEffect(() => {
    if (bytes === null) {
      setErr(t('preview.failedDecodeSpreadsheet'));
      setBusy(false);
      return;
    }
    let cancelled = false;
    setBusy(true);
    setErr(null);
    setActiveSheet(0);
    // 用 microtask 让 UI 显示 "loading..." 一下
    // NOTE (review MEDIUM-1/2 deferred): parseWorkbook 当前同步阻塞 UI 线程，10MB xlsx
    // 会卡 200-800ms；MAX_CELLS=50000 也是 post-parse cap，SheetJS 内部已经全部解析。
    // 升级路径：把 parseWorkbook 搬到 Web Worker，并先看 ws['!ref'] 范围预先 reject 巨表。
    queueMicrotask(() => {
      if (cancelled) return;
      try {
        const parsed = parseWorkbook(bytes, t);
        setSheets(parsed);
      } catch {
        setErr(t('preview.failedParseSpreadsheet'));
      }
      setBusy(false);
    });
    return () => {
      cancelled = true;
    };
  }, [bytes, t]);

  if (err !== null) return <div className="p-3 text-xs text-danger">{err}</div>;
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
          {sheets.map((s, i) => {
            const isActive = i === activeSheet;
            return (
              <button
                key={s.name + i}
                type="button"
                className={`px-2 py-1 border-r border-border-default/60 whitespace-nowrap ${
                  isActive ? 'bg-surface-2 text-fg-primary' : 'text-fg-muted hover:bg-hover-bg'
                }`}
                onClick={() => setActiveSheet(i)}
              >
                {s.name}
              </button>
            );
          })}
        </div>
      )}
      <div className="flex-1 min-h-0 overflow-auto">
        <table className="text-xs font-mono border-collapse">
          <tbody>
            {current.rows.map((row, ri) => (
              <tr key={ri}>
                <th className="bg-surface-2 text-fg-muted px-2 border border-border-default sticky left-0">
                  {ri + 1}
                </th>
                {row.map((cell, ci) => (
                  <td
                    key={ci}
                    className="px-2 py-0.5 border border-border-default text-fg-secondary max-w-[240px] truncate"
                    title={cell}
                  >
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
