// ArtifactView (F056) — the artifact renderer registry: dispatch a typed artifact
// to its renderer by `kind`.
//
// STATIC tier (LC-free, the only tier): markdown/code/html/svg/image/chart +
// pdf/docx/xlsx/file (reusing F024 RichPreview). The INTERACTIVE 'react' tier (LiveCanvas
// sandbox) was removed — its runtime machinery is being re-integrated as a separate
// feature once LiveCanvas stabilizes; until then a 'react' artifact renders an
// unavailable placeholder. NO @livecanvas/* dependency anywhere in this path.

import { MonacoViewer } from '../code/MonacoViewer';
import { RichPreview } from '../preview/RichPreview';
import { detectKind } from '../preview/binaryUtils';
import { HtmlArtifact, InteractiveHtmlArtifact } from './renderers/HtmlArtifact';
import { MarkdownArtifact } from './renderers/MarkdownArtifact';
import { ChartArtifact } from './renderers/ChartArtifact';
import { SvgArtifact, ImageArtifact } from './renderers/MediaArtifact';
import { useI18n } from '../../i18n/I18nProvider.js';
import { isTextPreviewPath } from '../../lib/pathClassify.js';

export type { ArtifactContent } from './artifactContent';
import type { ArtifactContent } from './artifactContent';

function ReactTierUnavailable(): JSX.Element {
  const { t } = useI18n();
  return (
    <div className="flex-1 flex items-center justify-center p-4 text-[11px] text-fg-muted text-center leading-relaxed">
      {t('artifact.interactiveUnavailable')}
    </div>
  );
}

function Unsupported({ what }: { what: string }): JSX.Element {
  const { t } = useI18n();
  return (
    <div className="flex-1 flex items-center justify-center p-4 text-[11px] text-fg-muted text-center leading-relaxed">
      {t('artifact.unsupported', { kind: what })}
    </div>
  );
}

/**
 * Defense-in-depth on image src (content is AI-generated): allow only data:image/
 * URIs and scheme-less app-relative paths. Blocks javascript:/file:/blob:/http(s):
 * etc. (renderer CSP img-src 'self' data: already blocks most, but don't rely on
 * CSP alone in case it's relaxed later).
 */
function isSafeImageSrc(src: string): boolean {
  return src.startsWith('data:image/') || /^[^:]*$/.test(src);
}

export function ArtifactView(props: ArtifactContent): JSX.Element {
  switch (props.kind) {
    case 'markdown':
      return <MarkdownArtifact content={props.content} />;
    case 'code':
      return (
        <div className="flex-1 min-h-0">
          <MonacoViewer path={props.filename ?? 'artifact.txt'} content={props.content} />
        </div>
      );
    case 'html':
      return <HtmlArtifact html={props.content} />;
    case 'interactive-html':
      return (
        <InteractiveHtmlArtifact
          html={props.content}
          {...(props.permissions !== undefined ? { permissions: props.permissions } : {})}
        />
      );
    case 'svg':
      return <SvgArtifact svg={props.content} />;
    case 'image':
      if (!isSafeImageSrc(props.src)) return <Unsupported what="image" />;
      return <ImageArtifact src={props.src} alt={props.alt} />;
    case 'chart':
      return <ChartArtifact spec={props.spec} />;
    case 'pdf':
    case 'docx':
    case 'xlsx':
    case 'pptx':
      return (
        <div className="flex-1 min-h-0">
          <RichPreview
            projectRoot={props.projectRoot}
            path={props.path}
            kind={props.kind}
            fileSource={props.fileSource}
            artifactId={props.artifactId}
            deliveryId={props.deliveryId}
            version={props.version}
          />
        </div>
      );
    case 'file': {
      const deliveryText = props.fileSource === 'delivery-store' && isTextPreviewPath(props.path);
      const kind = detectKind(props.path) ?? (deliveryText ? 'text' : null);
      return kind === null ? (
        <Unsupported what="file" />
      ) : (
        <div className="flex-1 min-h-0">
          <RichPreview
            projectRoot={props.projectRoot}
            path={props.path}
            kind={kind}
            fileSource={props.fileSource}
            artifactId={props.artifactId}
            deliveryId={props.deliveryId}
            version={props.version}
          />
        </div>
      );
    }
    case 'react':
      // Interactive tier removed (LiveCanvas sandbox machinery extracted; re-added
      // as a separate feature). A 'react' artifact is never produced now, but keep
      // a graceful placeholder so a stray/legacy one doesn't crash the panel.
      return <ReactTierUnavailable />;
    default: {
      // Exhaustiveness guard: adding an ArtifactContent variant without a branch
      // fails to compile here instead of silently rendering nothing.
      const _exhaustive: never = props;
      void _exhaustive;
      return <Unsupported what="unknown" />;
    }
  }
}
