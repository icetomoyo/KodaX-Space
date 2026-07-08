import { useEffect, useMemo, useState } from 'react';
import JSZip from 'jszip';
import { base64ToBytes } from './binaryUtils.js';
import { useI18n } from '../../i18n/I18nProvider.js';

interface Props {
  readonly base64: string;
}

interface SlidePreview {
  readonly index: number;
  readonly title: string;
  readonly lines: readonly string[];
}

function slideIndex(fileName: string): number {
  const match = /slide(\d+)\.xml$/i.exec(fileName);
  return match ? Number(match[1]) : 0;
}

function textFromSlideXml(xml: string): readonly string[] {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const nodes = Array.from(doc.getElementsByTagNameNS('*', 't'));
  const lines: string[] = [];
  for (const node of nodes) {
    const text = (node.textContent ?? '').replace(/\s+/g, ' ').trim();
    if (text.length > 0) lines.push(text);
  }
  return lines;
}

export function PptxViewer({ base64 }: Props): JSX.Element {
  const { t } = useI18n();
  const bytes = useMemo(() => base64ToBytes(base64), [base64]);
  const [slides, setSlides] = useState<readonly SlidePreview[]>([]);
  const [busy, setBusy] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setBusy(true);
    setErr(null);
    setSlides([]);

    void JSZip.loadAsync(bytes)
      .then(async (zip) => {
        const slideFiles = Object.values(zip.files)
          .filter((file) => !file.dir && /^ppt\/slides\/slide\d+\.xml$/i.test(file.name))
          .sort((a, b) => slideIndex(a.name) - slideIndex(b.name));

        const parsed = await Promise.all(
          slideFiles.map(async (file, index) => {
            const xml = await file.async('string');
            const lines = textFromSlideXml(xml);
            return {
              index: index + 1,
              title: lines[0] ?? t('preview.presentationUntitledSlide', { index: index + 1 }),
              lines,
            };
          }),
        );

        if (cancelled) return;
        setSlides(parsed);
      })
      .catch(() => {
        if (!cancelled) setErr(t('preview.failedParsePresentation'));
      })
      .finally(() => {
        if (!cancelled) setBusy(false);
      });

    return () => {
      cancelled = true;
    };
  }, [bytes, t]);

  if (busy) {
    return <div className="p-3 text-xs text-fg-muted">{t('preview.parsingPresentation')}</div>;
  }
  if (err !== null) {
    return <div className="p-3 text-xs text-danger">{err}</div>;
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
        {slides.map((slide) => (
          <article
            key={slide.index}
            className="rounded-md border border-border-default bg-surface p-4 shadow-sm"
          >
            <div className="mb-3 flex items-start gap-3">
              <div className="flex h-7 min-w-7 items-center justify-center rounded bg-surface-3 px-2 font-mono text-[11px] text-fg-muted">
                {slide.index}
              </div>
              <h3 className="min-w-0 flex-1 text-sm font-semibold text-fg-primary">
                {slide.title}
              </h3>
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
        ))}
      </div>
    </div>
  );
}
