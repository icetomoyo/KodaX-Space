// HtmlArtifact (F056, static tier) — render AI-produced static HTML safely.
//
// `sandbox=""` (empty allow-list) is the whole safety story: it disables scripts,
// forms, popups, top-navigation, and same-origin access. So even if the HTML
// carries a <script> or inline handlers, nothing executes — it renders as inert
// static markup. No JS eval, no LiveCanvas, no dompurify needed (the sandbox is
// the boundary). Verified by e2e/artifact-static-render.mjs.

import {
  ARTIFACT_HTML_FRAME_MESSAGE_TYPE,
  ARTIFACT_HTML_FRAME_URL,
  type ArtifactHtmlPermissionsT,
} from '@kodax-space/space-ipc-schema';
import { useMemo, useRef } from 'react';
import { buildInteractiveHtmlSrcDoc, sandboxForInteractiveHtml } from '../htmlSandbox';
import { useI18n } from '../../../i18n/I18nProvider';
import {
  WebPreviewDiagnosticBanner,
  useWebPreviewDiagnostics,
} from '../../preview/WebPreviewDiagnosticBanner.js';

export interface HtmlArtifactProps {
  html: string;
}

export interface InteractiveHtmlArtifactProps extends HtmlArtifactProps {
  permissions?: ArtifactHtmlPermissionsT;
}

function documentVersionToken(documentHtml: string): string {
  let hash = 2166136261;
  for (let i = 0; i < documentHtml.length; i += 1) {
    hash ^= documentHtml.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return `${documentHtml.length.toString(36)}-${hash.toString(36)}`;
}

export function HtmlArtifact({ html }: HtmlArtifactProps): JSX.Element {
  const { t } = useI18n();
  return (
    <iframe
      title={t('artifact.htmlTitle')}
      srcDoc={html}
      sandbox=""
      className="w-full h-full flex-1 border-0 bg-white"
    />
  );
}

export function InteractiveHtmlArtifact({
  html,
  permissions,
}: InteractiveHtmlArtifactProps): JSX.Element {
  const { t } = useI18n();
  const documentHtml = useMemo(
    () => buildInteractiveHtmlSrcDoc(html, permissions),
    [html, permissions],
  );
  const frameUrl = useMemo(
    () => `${ARTIFACT_HTML_FRAME_URL}?v=${documentVersionToken(documentHtml)}`,
    [documentHtml],
  );
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [diagnostics, dismissDiagnostics, documentReady] = useWebPreviewDiagnostics(
    frameRef,
    frameUrl,
  );
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <WebPreviewDiagnosticBanner diagnostics={diagnostics} onDismiss={dismissDiagnostics} />
      <iframe
        key={frameUrl}
        ref={frameRef}
        title={t('artifact.interactiveHtmlTitle')}
        src={frameUrl}
        sandbox={sandboxForInteractiveHtml(permissions)}
        referrerPolicy="no-referrer"
        aria-busy={!documentReady}
        data-ready={documentReady ? 'true' : 'false'}
        data-testid="interactive-html-frame"
        tabIndex={documentReady ? 0 : -1}
        onLoad={(event) => {
          event.currentTarget.contentWindow?.postMessage(
            {
              type: ARTIFACT_HTML_FRAME_MESSAGE_TYPE,
              documentHtml,
            },
            '*',
          );
        }}
        className="h-full min-h-0 w-full flex-1 border-0 bg-white"
      />
    </div>
  );
}
