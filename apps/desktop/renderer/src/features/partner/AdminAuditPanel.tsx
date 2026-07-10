import { useCallback, useEffect, useState } from 'react';
import type { AdminAuditEventT, AdminPolicyT } from '@kodax-space/space-ipc-schema';
import { AlertTriangle, Download, FileJson, Loader2, RefreshCw, ShieldCheck } from 'lucide-react';
import { useI18n } from '../../i18n/I18nProvider.js';

function downloadText(filename: string, content: string, mime: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function compactTime(ts: number): string {
  return new Date(ts).toLocaleTimeString();
}

export function AdminAuditPanel(): JSX.Element {
  const { t } = useI18n();
  const [policy, setPolicy] = useState<AdminPolicyT | null>(null);
  const [events, setEvents] = useState<readonly AdminAuditEventT[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback((): (() => void) | void => {
    const bridge = window.kodaxSpace;
    if (!bridge) return;
    let alive = true;
    setBusy(true);
    setError(null);
    Promise.all([
      bridge.invoke('admin.policy.get', undefined),
      bridge.invoke('admin.audit.list', { limit: 8 }),
    ])
      .then(([policyResult, auditResult]) => {
        if (!alive) return;
        if (policyResult.ok) setPolicy(policyResult.data.policy);
        else setError(policyResult.error.message);
        if (auditResult.ok) setEvents(auditResult.data.events);
        else setError(auditResult.error.message);
      })
      .catch((err: unknown) => {
        if (!alive) return;
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (alive) setBusy(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => load(), [load]);

  async function exportPolicy(): Promise<void> {
    const result = await window.kodaxSpace?.invoke('admin.policy.export', undefined);
    if (result?.ok) downloadText(result.data.filename, result.data.json, 'application/json');
    else if (result) setError(result.error.message);
  }

  async function exportAudit(): Promise<void> {
    const result = await window.kodaxSpace?.invoke('admin.audit.export', { limit: 1000 });
    if (result?.ok) downloadText(result.data.filename, result.data.jsonl, 'application/x-ndjson');
    else if (result) setError(result.error.message);
  }

  return (
    <section className="border-b border-border-default" data-testid="partner-admin-audit-panel">
      <div className="px-3 py-2 flex items-center gap-2">
        <ShieldCheck className="w-3.5 h-3.5 text-fg-muted" strokeWidth={1.75} aria-hidden />
        <span className="text-[11px] uppercase tracking-wider text-fg-muted">
          {t('partner.audit.title')}
        </span>
        {busy && (
          <Loader2
            className="w-3.5 h-3.5 text-fg-muted animate-spin"
            strokeWidth={1.75}
            aria-hidden
          />
        )}
        <button
          type="button"
          className="ml-auto w-5 h-5 inline-flex items-center justify-center rounded text-fg-muted hover:text-fg-primary hover:bg-hover-bg"
          title={t('partner.audit.refresh')}
          aria-label={t('partner.audit.refresh')}
          onClick={() => void load()}
        >
          <RefreshCw className="w-3.5 h-3.5" strokeWidth={1.75} aria-hidden />
        </button>
        <button
          type="button"
          className="w-5 h-5 inline-flex items-center justify-center rounded text-fg-muted hover:text-fg-primary hover:bg-hover-bg"
          title={t('partner.audit.exportPolicy')}
          aria-label={t('partner.audit.exportPolicy')}
          onClick={() => void exportPolicy()}
        >
          <FileJson className="w-3.5 h-3.5" strokeWidth={1.75} aria-hidden />
        </button>
        <button
          type="button"
          className="w-5 h-5 inline-flex items-center justify-center rounded text-fg-muted hover:text-fg-primary hover:bg-hover-bg"
          title={t('partner.audit.exportAudit')}
          aria-label={t('partner.audit.exportAudit')}
          onClick={() => void exportAudit()}
        >
          <Download className="w-3.5 h-3.5" strokeWidth={1.75} aria-hidden />
        </button>
      </div>

      <div className="px-3 pb-2 space-y-2">
        {policy && (
          <div className="grid grid-cols-2 gap-1 text-[10px] text-fg-muted">
            <span className="truncate">
              {t('partner.audit.artifactExport', {
                value: policy.artifact.exportAllowed ? 'on' : 'off',
              })}
            </span>
            <span className="truncate">
              {t('partner.audit.fileApply', {
                value: policy.workspaceFileProposals.applyAllowed ? 'on' : 'off',
              })}
            </span>
          </div>
        )}
        <div className="max-h-24 overflow-y-auto">
          {events.length > 0 ? (
            events.map((event) => (
              <div key={event.id} className="py-0.5 text-[10px] text-fg-muted leading-snug">
                <span className="text-fg-secondary">{compactTime(event.createdAt)}</span>{' '}
                <span>{event.category}</span> <span>{event.action}</span>{' '}
                <span>{event.outcome}</span>
              </div>
            ))
          ) : (
            <div className="text-[10px] text-fg-faint">{t('partner.audit.empty')}</div>
          )}
        </div>
        {error && (
          <div className="flex items-start gap-1.5 text-[10px] text-danger leading-snug">
            <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" strokeWidth={1.75} aria-hidden />
            <span>{error}</span>
          </div>
        )}
      </div>
    </section>
  );
}
