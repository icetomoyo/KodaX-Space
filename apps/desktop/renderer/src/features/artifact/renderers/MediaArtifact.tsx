// MediaArtifact (F056, static tier) — SVG + image artifacts.
//
// SVG renders via <img src="data:image/svg+xml,...">. An <img>-loaded SVG runs in
// the browser's "secure static mode": scripts/external refs are disabled, so an
// AI-produced SVG can't execute JS. No eval, no LiveCanvas. (Inline <svg> or
// <object> would NOT be safe — <img> specifically is.)

import { useI18n } from '../../../i18n/I18nProvider.js';

export interface SvgArtifactProps {
  svg: string;
}

export function SvgArtifact({ svg }: SvgArtifactProps): JSX.Element {
  const { t } = useI18n();
  const src = `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
  return (
    <div className="flex-1 min-h-0 flex items-center justify-center p-3 overflow-auto bg-white">
      <img src={src} alt={t('artifact.svgAlt')} className="max-w-full max-h-full" />
    </div>
  );
}

export interface ImageArtifactProps {
  /** data: URI or app-served path. */
  src: string;
  alt?: string;
}

export function ImageArtifact({ src, alt }: ImageArtifactProps): JSX.Element {
  const { t } = useI18n();
  return (
    <div className="flex-1 min-h-0 flex items-center justify-center p-3 overflow-auto">
      <img src={src} alt={alt ?? t('artifact.imageAlt')} className="max-w-full max-h-full" />
    </div>
  );
}
