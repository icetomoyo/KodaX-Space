// DOCX conversion runs in a one-shot Web Worker. Only its bounded HTML result
// reaches this component, where an explicit allowlist sanitizer remains the
// final defense before rendering.
import { useEffect, useState } from 'react';
import { useI18n } from '../../i18n/I18nProvider.js';
import { isDocxPreviewHtmlWithinLimit, type DocxPreviewErrorCode } from './docxPreviewProtocol.js';
import { startDocxPreviewWorker } from './docxPreviewWorkerClient.js';

interface Props {
  readonly base64: string;
}

const ALLOWED_TAGS = new Set([
  'P',
  'BR',
  'STRONG',
  'EM',
  'B',
  'I',
  'U',
  'H1',
  'H2',
  'H3',
  'H4',
  'H5',
  'H6',
  'UL',
  'OL',
  'LI',
  'TABLE',
  'THEAD',
  'TBODY',
  'TR',
  'TD',
  'TH',
  'BLOCKQUOTE',
  'CODE',
  'PRE',
  'A',
  'SPAN',
  'DIV',
]);

const ALLOWED_ATTRS = new Set(['href', 'title', 'colspan', 'rowspan']);

/** Sanitize bounded mammoth HTML: drop unknown tags, handlers, and unsafe URLs. */
export function sanitizeDocxPreviewHtml(rawHtml: string): string | null {
  // Defense in depth: a malformed or compromised Worker response must never
  // make DOMParser process more than the documented 4 MiB output budget.
  if (!isDocxPreviewHtmlWithinLimit(rawHtml)) return null;

  const parser = new DOMParser();
  const doc = parser.parseFromString(`<div>${rawHtml}</div>`, 'text/html');
  const container = doc.body.firstChild as HTMLElement | null;
  if (container === null) return '';
  walkAndSanitize(container);
  return container.innerHTML;
}

function walkAndSanitize(node: Element): void {
  const children = Array.from(node.children);
  for (const child of children) {
    if (!ALLOWED_TAGS.has(child.tagName)) {
      const text = document.createTextNode(child.textContent ?? '');
      child.replaceWith(text);
      continue;
    }

    for (const attr of Array.from(child.attributes)) {
      if (!ALLOWED_ATTRS.has(attr.name.toLowerCase())) {
        child.removeAttribute(attr.name);
        continue;
      }
      if (attr.name.toLowerCase() === 'href') {
        const value = attr.value.trim().toLowerCase();
        const safe =
          value.startsWith('http://') ||
          value.startsWith('https://') ||
          value.startsWith('mailto:') ||
          value.startsWith('#');
        if (!safe) child.removeAttribute('href');
      }
    }
    walkAndSanitize(child);
  }
}

export function DocxViewer({ base64 }: Props): JSX.Element {
  const { t } = useI18n();
  const [html, setHtml] = useState<string | null>(null);
  const [err, setErr] = useState<DocxPreviewErrorCode | null>(null);
  const [busy, setBusy] = useState(true);

  useEffect(() => {
    setBusy(true);
    setErr(null);
    setHtml(null);

    return startDocxPreviewWorker(base64, (response) => {
      if (response.type === 'error') {
        setErr(response.code);
      } else {
        const safe = sanitizeDocxPreviewHtml(response.html);
        if (safe === null) setErr('too-large');
        else setHtml(safe);
      }
      setBusy(false);
    });
  }, [base64]);

  if (err !== null) {
    const key =
      err === 'decode'
        ? 'preview.failedDecodeDocument'
        : err === 'too-large'
          ? 'preview.docxPreviewTooLarge'
          : 'preview.failedRenderDocx';
    return <div className="p-3 text-xs text-danger">{t(key)}</div>;
  }
  if (busy) return <div className="p-3 text-xs text-fg-muted">{t('preview.renderingDocx')}</div>;
  if (html === null)
    return <div className="p-3 text-xs text-fg-muted">{t('preview.emptyDocument')}</div>;

  return (
    <div
      className="h-full overflow-auto p-4 bg-surface text-fg-primary text-sm leading-relaxed docx-preview"
      data-testid="docx-viewer"
    >
      <div dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
}
