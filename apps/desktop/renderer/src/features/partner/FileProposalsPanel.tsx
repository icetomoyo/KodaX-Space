import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import type {
  PartnerFileProposalOperationT,
  PartnerFileProposalStatusT,
  PartnerFileProposalSummaryT,
  PartnerFileProposalT,
} from '@kodax-space/space-ipc-schema';
import {
  AlertTriangle,
  Check,
  Download,
  FileCheck2,
  FileText,
  GitCompareArrows,
  Loader2,
  RefreshCw,
  ShieldAlert,
  X,
} from 'lucide-react';
import { useAppStore } from '../../store/appStore.js';
import { FileNameText } from '../../components/FileNameText.js';
import { pushToast } from '../../store/toastStore.js';
import { useI18n } from '../../i18n/I18nProvider.js';
import type { MessageKey } from '../../i18n/messages.js';

type Filter = 'pending' | 'all';
type SafetyRisk = PartnerFileProposalT['safety']['risk'];
type SafetyClassification = PartnerFileProposalT['safety']['classification'];
type BusyAction = 'apply' | 'reject' | 'export' | null;

type Translate = (key: MessageKey, vars?: Record<string, string | number>) => string;

const STATUS_LABEL_KEYS: Record<PartnerFileProposalStatusT, MessageKey> = {
  pending: 'partner.fileProposals.status.pending',
  applied: 'partner.fileProposals.status.applied',
  rejected: 'partner.fileProposals.status.rejected',
};

const OPERATION_LABEL_KEYS: Record<PartnerFileProposalOperationT, MessageKey> = {
  create: 'partner.fileProposals.operation.create',
  update: 'partner.fileProposals.operation.update',
};

const RISK_LABEL_KEYS: Record<SafetyRisk, MessageKey> = {
  low: 'partner.fileProposals.risk.low',
  medium: 'partner.fileProposals.risk.medium',
  high: 'partner.fileProposals.risk.high',
};

const CLASSIFICATION_LABEL_KEYS: Record<SafetyClassification, MessageKey> = {
  'safe-text': 'partner.fileProposals.class.safeText',
  code: 'partner.fileProposals.class.code',
  config: 'partner.fileProposals.class.config',
  'unknown-text': 'partner.fileProposals.class.unknownText',
};

function ipcError(
  result: {
    readonly ok: false;
    readonly error?: { readonly code?: string; readonly message?: string };
  },
  t: Translate,
): string {
  return `${result.error?.code ?? 'ERR'}: ${result.error?.message ?? t('common.unknownError')}`;
}

function statusClass(status: PartnerFileProposalStatusT): string {
  if (status === 'applied') return 'border-ok/40 bg-ok/10 text-ok';
  if (status === 'rejected') return 'border-danger/40 bg-danger/10 text-danger';
  return 'border-warn/40 bg-warn/10 text-warn';
}

function riskClass(risk: SafetyRisk): string {
  if (risk === 'high') return 'border-danger/40 bg-danger/10 text-danger';
  if (risk === 'medium') return 'border-warn/40 bg-warn/10 text-warn';
  return 'border-ok/40 bg-ok/10 text-ok';
}

function shortHash(hash: string | null): string {
  if (!hash) return '-';
  return hash.replace(/^sha256:/, '').slice(0, 12);
}

function compactText(value: string | undefined, t: Translate, max = 110): string {
  const text = (value ?? '').replace(/\s+/g, ' ').trim();
  if (!text) return t('partner.fileProposals.none');
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}...`;
}

function formatTime(ms: number, locale: string): string {
  try {
    return new Intl.DateTimeFormat(locale, {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(ms));
  } catch {
    return new Date(ms).toLocaleString();
  }
}

export function FileProposalsPanel(): JSX.Element {
  const { t, effectiveLocale } = useI18n();
  const currentSessionId = useAppStore((s) => s.currentSessionId);
  const currentProjectPath = useAppStore((s) => s.currentProjectPath);
  const appendLocalNotice = useAppStore((s) => s.appendLocalNotice);
  const [filter, setFilter] = useState<Filter>('pending');
  const [proposals, setProposals] = useState<readonly PartnerFileProposalSummaryT[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<PartnerFileProposalT | null>(null);
  const [loadingList, setLoadingList] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [busy, setBusy] = useState<BusyAction>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const selectedSummary = useMemo(
    () => proposals.find((proposal) => proposal.id === selectedId) ?? null,
    [proposals, selectedId],
  );
  const activeProposal = detail ?? selectedSummary;
  const pendingCount = proposals.filter((proposal) => proposal.status === 'pending').length;

  const loadList = useCallback(
    async (options: { readonly quiet?: boolean } = {}): Promise<void> => {
      const bridge = window.kodaxSpace;
      if (!bridge || !currentSessionId || !currentProjectPath) {
        setProposals([]);
        setSelectedId(null);
        setDetail(null);
        setLoadingList(false);
        return;
      }
      setLoadingList(true);
      if (!options.quiet) {
        setError(null);
        setNotice(null);
      }
      try {
        const result = await bridge.invoke(
          'partner.fileProposals.list',
          filter === 'pending'
            ? { sessionId: currentSessionId, projectRoot: currentProjectPath, status: 'pending' }
            : { sessionId: currentSessionId, projectRoot: currentProjectPath },
        );
        if (!result.ok) {
          setError(ipcError(result, t));
          setProposals([]);
          setSelectedId(null);
          setDetail(null);
          return;
        }
        const next = result.data.proposals;
        setProposals(next);
        setSelectedId((current) => {
          if (current && next.some((proposal) => proposal.id === current)) return current;
          return next[0]?.id ?? null;
        });
        if (next.length === 0) setDetail(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        setProposals([]);
        setSelectedId(null);
        setDetail(null);
      } finally {
        setLoadingList(false);
      }
    },
    [currentProjectPath, currentSessionId, filter, t],
  );

  useEffect(() => {
    setDetail(null);
    void loadList();
  }, [loadList]);

  useEffect(() => {
    const bridge = window.kodaxSpace;
    if (
      !bridge ||
      !currentProjectPath ||
      !selectedId ||
      !proposals.some((proposal) => proposal.id === selectedId)
    ) {
      setDetail(null);
      setLoadingDetail(false);
      return;
    }
    let alive = true;
    setLoadingDetail(true);
    setError(null);
    bridge
      .invoke('partner.fileProposals.get', { id: selectedId, projectRoot: currentProjectPath })
      .then((result) => {
        if (!alive) return;
        if (!result.ok) {
          setError(ipcError(result, t));
          setDetail(null);
          return;
        }
        setDetail(result.data.proposal);
        if (!result.data.proposal) setNotice(t('partner.fileProposals.detailMissing'));
      })
      .catch((err: unknown) => {
        if (!alive) return;
        setError(err instanceof Error ? err.message : String(err));
        setDetail(null);
      })
      .finally(() => {
        if (alive) setLoadingDetail(false);
      });
    return () => {
      alive = false;
    };
  }, [currentProjectPath, proposals, selectedId, t]);

  async function applySelected(): Promise<void> {
    const bridge = window.kodaxSpace;
    if (!bridge || !currentProjectPath || !activeProposal || activeProposal.status !== 'pending')
      return;
    setBusy('apply');
    setError(null);
    setNotice(null);
    try {
      const result = await bridge.invoke('partner.fileProposals.apply', {
        id: activeProposal.id,
        projectRoot: currentProjectPath,
        expectedContentHash: activeProposal.contentHash,
      });
      if (!result.ok) {
        setError(ipcError(result, t));
        return;
      }
      if (!result.data.ok) {
        setError(result.data.error ?? t('partner.fileProposals.applyBlocked'));
        return;
      }
      pushToast(t('partner.fileProposals.applied'), 'success');
      appendLocalNotice(
        activeProposal.sessionId,
        t('partner.fileProposals.notice.applied', {
          path: activeProposal.targetPath,
          id: activeProposal.id,
        }),
        { sentAt: Date.now(), variant: 'output' },
      );
      if (filter === 'pending') {
        setSelectedId(null);
        setDetail(null);
      }
      await loadList({ quiet: true });
    } finally {
      setBusy(null);
    }
  }

  async function rejectSelected(): Promise<void> {
    const bridge = window.kodaxSpace;
    if (!bridge || !currentProjectPath || !activeProposal || activeProposal.status !== 'pending')
      return;
    setBusy('reject');
    setError(null);
    setNotice(null);
    try {
      const result = await bridge.invoke('partner.fileProposals.reject', {
        id: activeProposal.id,
        projectRoot: currentProjectPath,
        reason: t('partner.fileProposals.rejectedFromPanel'),
      });
      if (!result.ok) {
        setError(ipcError(result, t));
        return;
      }
      if (!result.data.ok) {
        setError(result.data.error ?? t('partner.fileProposals.rejectBlocked'));
        return;
      }
      pushToast(t('partner.fileProposals.rejected'), 'info');
      appendLocalNotice(
        activeProposal.sessionId,
        t('partner.fileProposals.notice.rejected', {
          path: activeProposal.targetPath,
          id: activeProposal.id,
        }),
        { sentAt: Date.now(), variant: 'output' },
      );
      if (filter === 'pending') {
        setSelectedId(null);
        setDetail(null);
      }
      await loadList({ quiet: true });
    } finally {
      setBusy(null);
    }
  }

  async function exportSelected(): Promise<void> {
    const bridge = window.kodaxSpace;
    if (!bridge || !currentProjectPath || !activeProposal) return;
    setBusy('export');
    setError(null);
    setNotice(null);
    try {
      const result = await bridge.invoke('partner.fileProposals.export', {
        id: activeProposal.id,
        projectRoot: currentProjectPath,
        expectedContentHash: activeProposal.contentHash,
      });
      if (!result.ok) {
        setError(ipcError(result, t));
        return;
      }
      if (result.data.canceled) return;
      if (!result.data.ok) {
        setError(result.data.error ?? t('partner.fileProposals.exportBlocked'));
        return;
      }
      const exportedPath = result.data.path ?? activeProposal.targetPath;
      pushToast(t('partner.fileProposals.exported', { path: exportedPath }), 'success');
      appendLocalNotice(
        activeProposal.sessionId,
        t('partner.fileProposals.notice.exported', {
          path: activeProposal.targetPath,
          savedPath: exportedPath,
          id: activeProposal.id,
        }),
        { sentAt: Date.now(), variant: 'output' },
      );
    } finally {
      setBusy(null);
    }
  }

  if (!currentSessionId || !currentProjectPath) {
    return (
      <EmptyState
        icon={<FileCheck2 className="h-6 w-6" strokeWidth={1.5} aria-hidden />}
        title={t('partner.fileProposals.noSessionTitle')}
        body={t('partner.fileProposals.noSessionBody')}
      />
    );
  }

  return (
    <div
      className="h-full min-h-0 flex flex-col text-xs"
      data-testid="partner-file-proposals-panel"
    >
      <header className="flex-shrink-0 border-b border-border-default px-2 py-2">
        <div className="flex items-center gap-2">
          <FileCheck2 className="h-4 w-4 text-fg-muted" strokeWidth={1.75} aria-hidden />
          <div className="min-w-0 flex-1">
            <div className="truncate font-medium text-fg-primary">
              {t('partner.fileProposals.title')}
            </div>
            <div className="truncate text-[11px] text-fg-muted">
              {t('partner.fileProposals.pendingCount', { count: pendingCount })}
            </div>
          </div>
          <button
            type="button"
            onClick={() => void loadList()}
            disabled={loadingList}
            className="h-7 w-7 inline-flex items-center justify-center rounded text-fg-muted hover:bg-hover-bg hover:text-fg-primary disabled:opacity-60"
            title={t('partner.fileProposals.refresh')}
            aria-label={t('partner.fileProposals.refresh')}
          >
            {loadingList ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.75} aria-hidden />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden />
            )}
          </button>
        </div>
        <div className="mt-2 grid grid-cols-2 gap-1 rounded bg-surface-2 p-0.5">
          {(['pending', 'all'] as const).map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => setFilter(item)}
              className={`h-6 rounded text-[11px] ${
                filter === item
                  ? 'bg-surface-raised text-fg-primary'
                  : 'text-fg-muted hover:bg-hover-bg hover:text-fg-primary'
              }`}
              aria-pressed={filter === item}
            >
              {item === 'pending'
                ? t('partner.fileProposals.filter.pending')
                : t('partner.fileProposals.filter.all')}
            </button>
          ))}
        </div>
      </header>

      {(error || notice) && (
        <div className="flex-shrink-0 border-b border-border-default px-3 py-2 space-y-1">
          {error && (
            <div className="flex items-start gap-2 text-danger">
              <AlertTriangle
                className="mt-0.5 h-3.5 w-3.5 flex-shrink-0"
                strokeWidth={1.75}
                aria-hidden
              />
              <span className="min-w-0 break-words">{error}</span>
            </div>
          )}
          {notice && <div className="text-warn">{notice}</div>}
        </div>
      )}

      <div className="flex-shrink-0 max-h-44 overflow-y-auto border-b border-border-default">
        {proposals.length === 0 ? (
          <div className="px-3 py-5">
            <EmptyState
              compact
              icon={<FileText className="h-5 w-5" strokeWidth={1.5} aria-hidden />}
              title={
                filter === 'pending'
                  ? t('partner.fileProposals.emptyPending')
                  : t('partner.fileProposals.emptyAll')
              }
            />
          </div>
        ) : (
          proposals.map((proposal) => (
            <button
              key={proposal.id}
              type="button"
              onClick={() => setSelectedId(proposal.id)}
              className={`group w-full border-b border-border-default px-3 py-2 text-left hover:bg-hover-bg ${
                selectedId === proposal.id ? 'bg-surface-3' : ''
              }`}
              title={proposal.targetPath}
            >
              <div className="flex items-center gap-2">
                <FileNameText
                  name={proposal.targetPath}
                  className="flex-1 font-mono text-[11px] text-fg-secondary"
                />
                <span
                  className={`rounded border px-1.5 py-0.5 text-[10px] ${statusClass(proposal.status)}`}
                >
                  {t(STATUS_LABEL_KEYS[proposal.status])}
                </span>
              </div>
              <div className="mt-1 flex items-center gap-1.5 text-[11px] text-fg-muted">
                <span className="uppercase">{t(OPERATION_LABEL_KEYS[proposal.operation])}</span>
                <span className={`rounded border px-1 py-0.5 ${riskClass(proposal.safety.risk)}`}>
                  {t(RISK_LABEL_KEYS[proposal.safety.risk])}
                </span>
                <span className="ml-auto">{formatTime(proposal.updatedAt, effectiveLocale)}</span>
              </div>
              <div className="mt-1 line-clamp-2 text-[11px] leading-snug text-fg-muted">
                {compactText(proposal.rationale, t)}
              </div>
            </button>
          ))
        )}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto">
        <ProposalDetail
          proposal={activeProposal}
          fullProposal={detail}
          loading={loadingDetail}
          busy={busy}
          locale={effectiveLocale}
          onApply={() => void applySelected()}
          onReject={() => void rejectSelected()}
          onExport={() => void exportSelected()}
        />
      </div>
    </div>
  );
}

function ProposalDetail({
  proposal,
  fullProposal,
  loading,
  busy,
  locale,
  onApply,
  onReject,
  onExport,
}: {
  proposal: PartnerFileProposalSummaryT | PartnerFileProposalT | null;
  fullProposal: PartnerFileProposalT | null;
  loading: boolean;
  busy: BusyAction;
  locale: string;
  onApply: () => void;
  onReject: () => void;
  onExport: () => void;
}): JSX.Element {
  const { t } = useI18n();
  if (!proposal) {
    return (
      <EmptyState
        icon={<GitCompareArrows className="h-6 w-6" strokeWidth={1.5} aria-hidden />}
        title={t('partner.fileProposals.select')}
      />
    );
  }

  const canMutate = proposal.status === 'pending' && !loading && busy === null;
  const applying = busy === 'apply';
  const rejecting = busy === 'reject';
  const exporting = busy === 'export';
  const canExport = !loading && busy === null;

  return (
    <div className="min-h-full p-3 space-y-3">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="truncate font-mono text-[11px] text-fg-muted">{proposal.id}</div>
          <div className="mt-1 break-words font-mono text-[12px] font-medium text-fg-primary">
            {proposal.targetPath}
          </div>
          <div className="mt-1 text-[11px] text-fg-muted">
            {t('partner.fileProposals.created')}: {formatTime(proposal.createdAt, locale)}
          </div>
        </div>
        <span
          className={`flex-shrink-0 rounded border px-1.5 py-0.5 text-[10px] ${statusClass(proposal.status)}`}
        >
          {t(STATUS_LABEL_KEYS[proposal.status])}
        </span>
      </div>

      <div className="flex flex-wrap gap-1.5">
        <Pill>{t(OPERATION_LABEL_KEYS[proposal.operation])}</Pill>
        <Pill className={riskClass(proposal.safety.risk)}>
          {t(RISK_LABEL_KEYS[proposal.safety.risk])}
        </Pill>
        <Pill>{t(CLASSIFICATION_LABEL_KEYS[proposal.safety.classification])}</Pill>
      </div>

      <Section title={t('partner.fileProposals.rationale')}>
        <div className="text-fg-secondary">
          {proposal.rationale ?? t('partner.fileProposals.none')}
        </div>
      </Section>

      <Section title={t('partner.fileProposals.safety')}>
        {proposal.safety.warnings.length > 0 ? (
          <ul className="space-y-1 text-warn">
            {proposal.safety.warnings.map((warning) => (
              <li key={warning} className="flex gap-1.5">
                <ShieldAlert
                  className="mt-0.5 h-3.5 w-3.5 flex-shrink-0"
                  strokeWidth={1.75}
                  aria-hidden
                />
                <span className="min-w-0 break-words">{warning}</span>
              </li>
            ))}
          </ul>
        ) : (
          <div className="text-fg-muted">{t('partner.fileProposals.noWarnings')}</div>
        )}
      </Section>

      <Section title={t('partner.fileProposals.sources')}>
        {proposal.sourceRefs.length > 0 ? (
          <div className="space-y-1">
            {proposal.sourceRefs.map((ref) => (
              <div key={ref} className="truncate font-mono text-[11px] text-fg-muted" title={ref}>
                {ref}
              </div>
            ))}
          </div>
        ) : (
          <div className="text-fg-muted">{t('partner.fileProposals.none')}</div>
        )}
      </Section>

      <Section title={t('partner.fileProposals.diff')}>
        {loading && !fullProposal ? (
          <LoadingLine label={t('partner.fileProposals.loadingDetail')} />
        ) : fullProposal ? (
          <>
            <pre className="max-h-72 overflow-auto rounded border border-border-default bg-surface-2 p-2 font-mono text-[11px] leading-relaxed text-fg-secondary whitespace-pre-wrap">
              {fullProposal.diff.unified}
            </pre>
            {fullProposal.diff.truncated && (
              <div className="mt-1 text-[11px] text-warn">
                {t('partner.fileProposals.truncated')}
              </div>
            )}
          </>
        ) : (
          <div className="text-fg-muted">{t('partner.fileProposals.detailMissing')}</div>
        )}
      </Section>

      <Section title={t('partner.fileProposals.hashes')}>
        <MetaRow
          label={t('partner.fileProposals.contentHash')}
          value={shortHash(proposal.contentHash)}
        />
        <MetaRow
          label={t('partner.fileProposals.baseHash')}
          value={shortHash(proposal.baseContentHash)}
        />
      </Section>

      {proposal.status === 'rejected' && proposal.rejectReason && (
        <Section title={t('partner.fileProposals.rejectReason')}>
          <div className="text-fg-secondary">{proposal.rejectReason}</div>
        </Section>
      )}

      <div className="flex items-center gap-2 border-t border-border-default pt-3">
        <button
          type="button"
          onClick={onApply}
          disabled={!canMutate}
          className="inline-flex h-8 flex-1 items-center justify-center gap-1.5 rounded border border-ok/40 bg-ok/10 px-2 text-xs text-ok hover:bg-ok/15 disabled:cursor-not-allowed disabled:opacity-60"
          title={t('partner.fileProposals.applyTitle')}
        >
          {applying ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.75} aria-hidden />
          ) : (
            <Check className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden />
          )}
          {t('partner.fileProposals.apply')}
        </button>
        <button
          type="button"
          onClick={onReject}
          disabled={!canMutate}
          className="inline-flex h-8 flex-1 items-center justify-center gap-1.5 rounded border border-border-default px-2 text-xs text-fg-secondary hover:bg-hover-bg disabled:cursor-not-allowed disabled:opacity-60"
          title={t('partner.fileProposals.rejectTitle')}
        >
          {rejecting ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.75} aria-hidden />
          ) : (
            <X className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden />
          )}
          {t('partner.fileProposals.reject')}
        </button>
        <button
          type="button"
          onClick={onExport}
          disabled={!canExport}
          className="inline-flex h-8 flex-1 items-center justify-center gap-1.5 rounded border border-border-default px-2 text-xs text-fg-secondary hover:bg-hover-bg disabled:cursor-not-allowed disabled:opacity-60"
          title={t('partner.fileProposals.exportTitle')}
        >
          {exporting ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.75} aria-hidden />
          ) : (
            <Download className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden />
          )}
          {t('partner.fileProposals.export')}
        </button>
      </div>
    </div>
  );
}

function Pill({
  children,
  className = 'border-border-default text-fg-muted',
}: {
  readonly children: ReactNode;
  readonly className?: string;
}): JSX.Element {
  return (
    <span className={`rounded border px-1.5 py-0.5 text-[10px] ${className}`}>{children}</span>
  );
}

function Section({
  title,
  children,
}: {
  readonly title: string;
  readonly children: ReactNode;
}): JSX.Element {
  return (
    <section>
      <div className="mb-1 text-[10px] uppercase tracking-wider text-fg-muted">{title}</div>
      {children}
    </section>
  );
}

function MetaRow({
  label,
  value,
}: {
  readonly label: string;
  readonly value: string;
}): JSX.Element {
  return (
    <div className="flex min-w-0 items-center gap-2 text-[11px]">
      <span className="w-16 flex-shrink-0 text-fg-muted">{label}</span>
      <span className="min-w-0 truncate font-mono text-fg-secondary" title={value}>
        {value}
      </span>
    </div>
  );
}

function LoadingLine({ label }: { readonly label: string }): JSX.Element {
  return (
    <div className="inline-flex items-center gap-2 text-fg-muted">
      <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.75} aria-hidden />
      <span>{label}</span>
    </div>
  );
}

function EmptyState({
  icon,
  title,
  body,
  compact = false,
}: {
  readonly icon: ReactNode;
  readonly title: string;
  readonly body?: string;
  readonly compact?: boolean;
}): JSX.Element {
  return (
    <div
      className={`h-full flex flex-col items-center justify-center gap-2 text-center ${
        compact ? 'p-1' : 'p-6'
      }`}
    >
      <div className="text-fg-muted">{icon}</div>
      <div className="text-[12px] font-medium text-fg-secondary">{title}</div>
      {body && (
        <div className="max-w-[220px] text-[11px] leading-relaxed text-fg-muted">{body}</div>
      )}
    </div>
  );
}
