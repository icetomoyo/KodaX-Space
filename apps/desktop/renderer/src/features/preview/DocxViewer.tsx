// DocxViewer — F024 .docx 渲染
//
// 用 mammoth 转换为简化 HTML（保留标题/段落/列表/表格基本结构，丢图片/复杂样式）。
// 渲染时通过受限 prose 样式包裹，避免外来 HTML 影响周边布局。
//
// 安全：
//   - mammoth 输出"plain HTML"（已无 script/style/iframe，但仍要 sanitize）
//   - 走 DOMParser + 显式 element allowlist，剥掉任何 on* 属性 + javascript: URL

import { useEffect, useMemo, useState } from 'react';
import mammoth from 'mammoth';
import { base64ToBytes } from './binaryUtils.js';
import { useI18n } from '../../i18n/I18nProvider.js';

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

/** Sanitize mammoth-generated HTML — drop unknown tags, strip event handlers, neutralize unsafe URLs. */
function sanitizeHtml(rawHtml: string): string {
  const parser = new DOMParser();
  const doc = parser.parseFromString(`<div>${rawHtml}</div>`, 'text/html');
  const container = doc.body.firstChild as HTMLElement | null;
  if (container === null) return '';
  walkAndSanitize(container);
  return container.innerHTML;
}

function walkAndSanitize(node: Element): void {
  // 拍快照防 mutation 期间 HTMLCollection 跳 child
  const children = Array.from(node.children);
  for (const child of children) {
    if (!ALLOWED_TAGS.has(child.tagName)) {
      // 不在白名单 → 用其 textContent 替代（保留文本，丢标签）
      // 用当前 renderer document 创建 text node — 避免 orphan HTMLDocument 分配
      // (review HIGH-2 / sec review MEDIUM)
      const text = document.createTextNode(child.textContent ?? '');
      child.replaceWith(text);
      continue;
    }
    // 剥不允许的属性
    for (const attr of Array.from(child.attributes)) {
      if (!ALLOWED_ATTRS.has(attr.name.toLowerCase())) {
        child.removeAttribute(attr.name);
        continue;
      }
      // href: 只允许 http / https / mailto / #-anchor；其余删
      if (attr.name.toLowerCase() === 'href') {
        const val = attr.value.trim().toLowerCase();
        const safe =
          val.startsWith('http://') ||
          val.startsWith('https://') ||
          val.startsWith('mailto:') ||
          val.startsWith('#');
        if (!safe) child.removeAttribute('href');
      }
    }
    walkAndSanitize(child);
  }
}

export function DocxViewer({ base64 }: Props): JSX.Element {
  const { t } = useI18n();
  const [html, setHtml] = useState<string | null>(null);
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
      setErr(t('preview.failedDecodeDocument'));
      setBusy(false);
      return;
    }
    let cancelled = false;
    setBusy(true);
    setErr(null);

    // mammoth 需要 ArrayBuffer
    const ab = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer;
    mammoth
      .convertToHtml({ arrayBuffer: ab })
      .then((result) => {
        if (cancelled) return;
        const safe = sanitizeHtml(result.value);
        setHtml(safe);
        setBusy(false);
      })
      .catch(() => {
        if (cancelled) return;
        setErr(t('preview.failedRenderDocx'));
        setBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [bytes, t]);

  if (err !== null) return <div className="p-3 text-xs text-danger">{err}</div>;
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
