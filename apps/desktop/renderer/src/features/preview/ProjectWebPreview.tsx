import { useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useI18n } from '../../i18n/I18nProvider.js';
import {
  WebPreviewDiagnosticBanner,
  useWebPreviewDiagnostics,
} from './WebPreviewDiagnosticBanner.js';

interface ProjectWebPreviewProps {
  readonly projectRoot: string;
  readonly path: string;
  readonly revision: number;
  readonly networkAccess: boolean;
}

function withRevision(url: string, revision: number): string {
  const parsed = new URL(url);
  parsed.searchParams.set('v', String(revision));
  return parsed.toString();
}

export function ProjectWebPreview({
  projectRoot,
  path,
  revision,
  networkAccess,
}: ProjectWebPreviewProps): JSX.Element {
  const { t } = useI18n();
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const requestKey = `${projectRoot}\u0000${path}\u0000${revision}\u0000${networkAccess}`;
  const [diagnostics, dismissDiagnostics] = useWebPreviewDiagnostics(frameRef, url ?? requestKey);

  useEffect(() => {
    let cancelled = false;
    setUrl(null);
    setError(null);
    const bridge = window.kodaxSpace;
    if (!bridge) {
      setError(t('artifact.runtimeUnavailable'));
      return () => {
        cancelled = true;
      };
    }
    void bridge
      .invoke('files.webPreview', { projectRoot, path, networkAccess })
      .then((result) => {
        if (cancelled) return;
        if (!result.ok) {
          setError(result.error?.message ?? t('common.unknownError'));
          return;
        }
        setUrl(withRevision(result.data.url, revision));
      })
      .catch((reason: unknown) => {
        if (cancelled) return;
        setError(
          reason instanceof Error && reason.message ? reason.message : t('common.unknownError'),
        );
      });
    return () => {
      cancelled = true;
    };
  }, [networkAccess, path, projectRoot, revision, t]);

  if (error) {
    return (
      <div className="flex flex-1 items-center justify-center p-4 text-center text-[11px] text-danger">
        {t('webPreview.loadFailed', { message: error })}
      </div>
    );
  }

  if (!url) {
    return (
      <div className="flex flex-1 items-center justify-center gap-2 text-[11px] text-fg-muted">
        <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.75} aria-hidden />
        {t('webPreview.loading')}
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="project-web-preview">
      <WebPreviewDiagnosticBanner
        diagnostics={diagnostics}
        networkAccess={networkAccess}
        canEnableNetwork
        onDismiss={dismissDiagnostics}
      />
      <iframe
        ref={frameRef}
        title={t('webPreview.projectTitle')}
        src={url}
        sandbox="allow-scripts allow-same-origin allow-forms"
        referrerPolicy="no-referrer"
        className="h-full min-h-0 w-full flex-1 border-0 bg-white"
      />
    </div>
  );
}
