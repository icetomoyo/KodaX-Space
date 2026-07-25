import { useEffect, useState, type RefObject } from 'react';
import { ShieldAlert, X } from 'lucide-react';
import { useI18n } from '../../i18n/I18nProvider.js';
import {
  parseWebPreviewDiagnostic,
  webPreviewDiagnosticKey,
  type WebPreviewDiagnostic,
} from './webPreviewDiagnostics.js';

const MAX_DIAGNOSTICS = 8;

export function useWebPreviewDiagnostics(
  frameRef: RefObject<HTMLIFrameElement | null>,
  resetKey: string,
): readonly [readonly WebPreviewDiagnostic[], () => void, boolean] {
  const [diagnostics, setDiagnostics] = useState<readonly WebPreviewDiagnostic[]>([]);
  const [readyKey, setReadyKey] = useState<string | null>(null);

  useEffect(() => {
    setDiagnostics([]);
  }, [resetKey]);
  useEffect(() => {
    const receive = (event: MessageEvent<unknown>): void => {
      if (!frameRef.current || event.source !== frameRef.current.contentWindow) return;
      const diagnostic = parseWebPreviewDiagnostic(event.data);
      if (!diagnostic) return;
      if (diagnostic.kind === 'ready') {
        setReadyKey(resetKey);
        return;
      }
      setDiagnostics((current) => {
        const key = webPreviewDiagnosticKey(diagnostic);
        if (current.some((item) => webPreviewDiagnosticKey(item) === key)) return current;
        return [...current, diagnostic].slice(-MAX_DIAGNOSTICS);
      });
    };
    window.addEventListener('message', receive);
    return () => window.removeEventListener('message', receive);
  }, [frameRef, resetKey]);

  return [diagnostics, () => setDiagnostics([]), readyKey === resetKey] as const;
}

interface WebPreviewDiagnosticBannerProps {
  readonly diagnostics: readonly WebPreviewDiagnostic[];
  readonly networkAccess?: boolean;
  readonly canEnableNetwork?: boolean;
  readonly onDismiss: () => void;
}

export function WebPreviewDiagnosticBanner({
  diagnostics,
  networkAccess = false,
  canEnableNetwork = false,
  onDismiss,
}: WebPreviewDiagnosticBannerProps): JSX.Element | null {
  const { t } = useI18n();
  const diagnostic = diagnostics.at(-1);
  if (!diagnostic) return null;

  const text =
    diagnostic.kind === 'policy'
      ? t('webPreview.policyBlocked', {
          directive: diagnostic.directive || 'content-security-policy',
        })
      : diagnostic.kind === 'resource'
        ? t('webPreview.resourceFailed', { resource: diagnostic.message || 'resource' })
        : t('webPreview.runtimeFailed', { message: diagnostic.message || 'Script error' });
  const showNetworkHint =
    canEnableNetwork &&
    !networkAccess &&
    diagnostic.kind === 'policy' &&
    /^(?:connect|script|style|img|media|font|worker)-src/.test(diagnostic.directive);

  return (
    <div
      className="flex flex-shrink-0 items-start gap-2 border-b border-warning/20 bg-warning/10 px-3 py-2 text-[11px] text-fg-secondary"
      role="status"
      data-testid="web-preview-diagnostic"
    >
      <ShieldAlert
        className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-warning"
        strokeWidth={1.75}
        aria-hidden
      />
      <div className="min-w-0 flex-1 leading-relaxed">
        <div className="break-words text-fg-primary">{text}</div>
        {showNetworkHint && (
          <div className="text-fg-muted">{t('webPreview.enableNetworkHint')}</div>
        )}
        {diagnostics.length > 1 && (
          <div className="text-fg-muted">
            {t('webPreview.moreDiagnostics', { count: diagnostics.length - 1 })}
          </div>
        )}
      </div>
      <button
        type="button"
        onClick={onDismiss}
        className="inline-flex h-5 w-5 flex-shrink-0 items-center justify-center rounded text-fg-muted hover:bg-surface-3 hover:text-fg-primary"
        title={t('webPreview.dismissDiagnostics')}
        aria-label={t('webPreview.dismissDiagnostics')}
      >
        <X className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden />
      </button>
    </div>
  );
}
