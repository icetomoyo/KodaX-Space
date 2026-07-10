import { useEffect, useState } from 'react';
import { useI18n } from '../../i18n/I18nProvider.js';
import type { PptxPreviewErrorCode, PptxPreviewSlideDto } from './pptxPreviewProtocol.js';
import { startPptxPreviewWorker } from './pptxPreviewWorkerClient.js';

interface Props {
  readonly base64: string;
}

export function PptxViewer({ base64 }: Props): JSX.Element {
  const { t } = useI18n();
  const [slides, setSlides] = useState<readonly PptxPreviewSlideDto[]>([]);
  const [busy, setBusy] = useState(true);
  const [err, setErr] = useState<PptxPreviewErrorCode | null>(null);

  useEffect(() => {
    setBusy(true);
    setErr(null);
    setSlides([]);

    return startPptxPreviewWorker(base64, (response) => {
      if (response.type === 'success') setSlides(response.slides);
      else setErr(response.code);
      setBusy(false);
    });
  }, [base64]);

  if (busy) {
    return <div className="p-3 text-xs text-fg-muted">{t('preview.parsingPresentation')}</div>;
  }
  if (err !== null) {
    const key =
      err === 'too-large'
        ? 'preview.presentationPreviewTooLarge'
        : 'preview.failedParsePresentation';
    return <div className="p-3 text-xs text-danger">{t(key)}</div>;
  }
  if (slides.length === 0) {
    return <div className="p-3 text-xs text-fg-muted">{t('preview.presentationNoSlides')}</div>;
  }

  return (
    <div className="h-full min-h-0 overflow-auto bg-surface-2 p-4" data-testid="pptx-viewer">
      <div className="mx-auto flex max-w-5xl flex-col gap-3">
        <div className="text-[11px] font-medium uppercase tracking-wide text-fg-muted">
          {t('preview.presentationSlideCount', { count: slides.length })}
        </div>
        {slides.map((slide) => {
          const title =
            slide.lines[0] ?? t('preview.presentationUntitledSlide', { index: slide.index });
          return (
            <article
              key={slide.index}
              className="rounded-md border border-border-default bg-surface p-4 shadow-sm"
            >
              <div className="mb-3 flex items-start gap-3">
                <div className="flex h-7 min-w-7 items-center justify-center rounded bg-surface-3 px-2 font-mono text-[11px] text-fg-muted">
                  {slide.index}
                </div>
                <h3 className="min-w-0 flex-1 text-sm font-semibold text-fg-primary">{title}</h3>
              </div>
              {slide.lines.length > 0 ? (
                <div className="space-y-1.5 text-[13px] leading-relaxed text-fg-secondary">
                  {slide.lines.map((line, index) => (
                    <p key={`${slide.index}-${index}`} className="whitespace-pre-wrap">
                      {line}
                    </p>
                  ))}
                </div>
              ) : (
                <div className="text-xs text-fg-muted">{t('preview.presentationNoText')}</div>
              )}
            </article>
          );
        })}
      </div>
    </div>
  );
}
