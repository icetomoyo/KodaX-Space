import { Suspense, lazy, useEffect, useState } from 'react';
import { PREVIEW_SIZE_CAPS, formatBytes, type RichPreviewKind } from './binaryUtils.js';
import { useI18n } from '../../i18n/I18nProvider.js';

const PdfViewer = lazy(() => import('./PdfViewer.js').then((m) => ({ default: m.PdfViewer })));
const DocxViewer = lazy(() => import('./DocxViewer.js').then((m) => ({ default: m.DocxViewer })));
const XlsxViewer = lazy(() => import('./XlsxViewer.js').then((m) => ({ default: m.XlsxViewer })));
const PptxViewer = lazy(() => import('./PptxViewer.js').then((m) => ({ default: m.PptxViewer })));
const MediaFileViewer = lazy(() =>
  import('./MediaFileViewer.js').then((m) => ({ default: m.MediaFileViewer })),
);
const TextFileViewer = lazy(() =>
  import('./TextFileViewer.js').then((m) => ({ default: m.TextFileViewer })),
);

interface Props {
  readonly projectRoot: string;
  readonly path: string;
  readonly kind: RichPreviewKind;
}

export function RichPreview({ projectRoot, path, kind }: Props): JSX.Element {
  const { t } = useI18n();
  const [base64, setBase64] = useState<string | null>(null);
  const [truncated, setTruncated] = useState<{ size: number } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!window.kodaxSpace) return;
    let cancelled = false;
    setBusy(true);
    setErr(null);
    setBase64(null);
    setTruncated(null);

    void window.kodaxSpace
      .invoke('files.readBinary', {
        projectRoot,
        path,
        maxBytes: PREVIEW_SIZE_CAPS[kind],
      })
      .then((r) => {
        if (cancelled) return;
        if (!r.ok) {
          setErr(t('preview.failedLoadFile'));
          return;
        }
        if (r.data.truncated) {
          setTruncated({ size: r.data.size });
          return;
        }
        setBase64(r.data.base64);
      })
      .finally(() => {
        if (!cancelled) setBusy(false);
      });

    return () => {
      cancelled = true;
    };
  }, [projectRoot, path, kind, t]);

  if (busy && base64 === null) {
    return <div className="p-3 text-xs text-fg-muted">{t('preview.loading')}</div>;
  }
  if (err !== null) {
    return <div className="p-3 text-xs text-danger">{err}</div>;
  }
  if (truncated !== null) {
    return (
      <div className="p-4 text-xs text-fg-muted text-center">
        {t('preview.fileTooLarge', {
          size: formatBytes(truncated.size),
          kind: kind.toUpperCase(),
          cap: formatBytes(PREVIEW_SIZE_CAPS[kind]),
        })}
      </div>
    );
  }
  if (base64 === null)
    return <div className="p-3 text-xs text-fg-muted">{t('preview.noContent')}</div>;

  return (
    <div className="h-full min-h-0" data-testid="rich-preview" data-preview-kind={kind}>
      <Suspense
        fallback={<div className="p-3 text-xs text-fg-muted">{t('preview.loadingViewer')}</div>}
      >
        {kind === 'pdf' && <PdfViewer base64={base64} />}
        {kind === 'docx' && <DocxViewer base64={base64} />}
        {kind === 'xlsx' && <XlsxViewer base64={base64} />}
        {kind === 'pptx' && <PptxViewer base64={base64} />}
        {kind === 'text' && <TextFileViewer base64={base64} path={path} />}
        {(kind === 'image' || kind === 'video' || kind === 'audio') && (
          <MediaFileViewer base64={base64} path={path} kind={kind} />
        )}
      </Suspense>
    </div>
  );
}
