import { useCallback, useEffect, useRef, useState } from 'react';
import type { PartnerCitationResolutionT } from '@kodax-space/space-ipc-schema';
import { AlertTriangle, BookOpenCheck, ExternalLink, Loader2, X } from 'lucide-react';
import { useAppStore } from '../../store/appStore.js';
import { useI18n } from '../../i18n/I18nProvider.js';
import { openFileSmart } from '../../lib/openPath.js';
import { PARTNER_EVIDENCE_OPEN_EVENT } from './partnerEvidenceEvents.js';

interface EvidenceOpenDetail {
  readonly citationId: string;
  readonly trigger?: HTMLElement;
}

export function PartnerEvidenceDetail(): JSX.Element | null {
  const { t } = useI18n();
  const currentProjectPath = useAppStore((state) => state.currentProjectPath);
  const currentSessionId = useAppStore((state) => state.currentSessionId);
  const [citationId, setCitationId] = useState<string | null>(null);
  const [citation, setCitation] = useState<PartnerCitationResolutionT | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const dialogRef = useRef<HTMLElement | null>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  const close = useCallback((): void => {
    setCitationId(null);
    setCitation(null);
    setError(null);
    queueMicrotask(() => returnFocusRef.current?.focus());
  }, []);

  useEffect(() => {
    const onOpen = (event: Event): void => {
      const detail = (event as CustomEvent<EvidenceOpenDetail>).detail;
      if (!detail || typeof detail.citationId !== 'string') return;
      returnFocusRef.current = detail.trigger ?? null;
      setCitationId(detail.citationId);
      setCitation(null);
      setError(null);
    };
    window.addEventListener(PARTNER_EVIDENCE_OPEN_EVENT, onOpen);
    return () => window.removeEventListener(PARTNER_EVIDENCE_OPEN_EVENT, onOpen);
  }, []);

  useEffect(() => {
    if (!citationId) return;
    const bridge = window.kodaxSpace;
    if (!bridge || !currentProjectPath || !currentSessionId) {
      setError(t('partner.evidence.outsideSession'));
      return;
    }
    let alive = true;
    setLoading(true);
    bridge
      .invoke('partner.citations.resolve', {
        projectRoot: currentProjectPath,
        sessionId: currentSessionId,
        citationId,
      })
      .then((result) => {
        if (!alive) return;
        if (result.ok && result.data.citation) setCitation(result.data.citation);
        else setError(result.ok ? t('partner.evidence.notResolved') : result.error.message);
      })
      .catch((reason: unknown) => {
        if (alive) setError(reason instanceof Error ? reason.message : String(reason));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [citationId, currentProjectPath, currentSessionId, t]);

  useEffect(() => {
    if (!citationId) return;
    closeButtonRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        close();
      } else if (event.key === 'Tab' && dialogRef.current) {
        const focusable = [
          ...dialogRef.current.querySelectorAll<HTMLElement>(
            'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
          ),
        ].filter((element) => !element.hasAttribute('hidden'));
        const first = focusable[0];
        const last = focusable.at(-1);
        if (!first || !last) {
          event.preventDefault();
          closeButtonRef.current?.focus();
        } else if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [citationId, close]);

  if (!citationId) return null;
  const degraded = citation?.freshness !== 'current';
  return (
    <div
      className="absolute inset-0 z-40 flex justify-end bg-black/20"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) close();
      }}
    >
      <section
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="partner-evidence-title"
        className="h-full w-[min(28rem,92%)] border-l border-border-default bg-surface shadow-xl flex flex-col"
        data-testid="partner-evidence-detail"
      >
        <header className="h-11 px-3 border-b border-border-default flex items-center gap-2">
          <BookOpenCheck className="w-4 h-4 text-accent-ink" aria-hidden />
          <h2 id="partner-evidence-title" className="text-sm font-medium text-fg-primary">
            {t('partner.evidence.title')}
          </h2>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={close}
            className="ml-auto w-7 h-7 rounded flex items-center justify-center text-fg-muted hover:bg-hover-bg"
            aria-label={t('partner.evidence.close')}
          >
            <X className="w-4 h-4" aria-hidden />
          </button>
        </header>
        <div className="flex-1 overflow-y-auto p-4 space-y-3 text-sm">
          {loading && (
            <div className="flex items-center gap-2 text-fg-muted" role="status">
              <Loader2 className="w-4 h-4 animate-spin" aria-hidden />
              {t('partner.evidence.resolving')}
            </div>
          )}
          {error && (
            <div className="flex gap-2 text-danger" role="alert">
              <AlertTriangle className="w-4 h-4 flex-shrink-0" aria-hidden /> {error}
            </div>
          )}
          {citation && (
            <>
              <div>
                <div className="font-medium text-fg-primary">{citation.sourceLabel}</div>
                <div className="text-xs text-fg-muted mt-1">{citation.relativePath}</div>
              </div>
              <div className="flex flex-wrap gap-2 text-xs">
                <span className="rounded bg-surface-2 px-2 py-1">{citation.locatorLabel}</span>
                <span
                  className={`rounded px-2 py-1 ${degraded ? 'bg-warning/15 text-warning' : 'bg-ok/15 text-ok'}`}
                >
                  {citation.freshness === 'current'
                    ? t('partner.evidence.current')
                    : citation.freshness === 'stale'
                      ? t('partner.evidence.stale')
                      : t('partner.evidence.missing')}
                </span>
              </div>
              {citation.excerpt ? (
                <blockquote className="whitespace-pre-wrap border-l-2 border-border-strong pl-3 text-fg-secondary leading-relaxed">
                  {citation.excerpt}
                </blockquote>
              ) : (
                <p className="text-fg-muted">{t('partner.evidence.noExcerpt')}</p>
              )}
              <div className="text-[11px] text-fg-faint">
                {t('partner.evidence.captured', {
                  time: new Date(citation.capturedAt).toLocaleString(),
                })}
              </div>
              {citation.freshness === 'current' && (
                <button
                  type="button"
                  className="inline-flex items-center gap-1.5 rounded border border-border-default px-2.5 py-1.5 text-xs text-fg-secondary hover:bg-hover-bg"
                  onClick={() =>
                    void openFileSmart(citation.relativePath, {
                      projectRoot: currentProjectPath,
                      sessionId: currentSessionId,
                      surface: 'partner',
                    })
                  }
                >
                  <ExternalLink className="w-3.5 h-3.5" aria-hidden />
                  {t('partner.evidence.openSource')}
                </button>
              )}
            </>
          )}
        </div>
      </section>
    </div>
  );
}
