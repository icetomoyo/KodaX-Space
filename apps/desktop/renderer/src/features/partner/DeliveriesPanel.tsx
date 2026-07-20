import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { PartnerCheckpointT, PartnerDeliveryRefT } from '@kodax-space/space-ipc-schema';
import {
  AlertTriangle,
  ArchiveRestore,
  CheckCircle2,
  Copy,
  FileOutput,
  Folder,
  FolderOpen,
  GitCompareArrows,
  Loader2,
  RefreshCw,
  RotateCcw,
} from 'lucide-react';
import { useAppStore } from '../../store/appStore.js';
import { useI18n } from '../../i18n/I18nProvider.js';
import { pushToast } from '../../store/toastStore.js';
import { openPartnerDeliveryInViewer, revealPath } from '../../lib/openPath.js';
import { RichPreview } from '../preview/RichPreview.js';
import { detectKind, type RichPreviewKind } from '../preview/binaryUtils.js';

type ActiveTab = 'deliveries' | 'checkpoints';

function ipcError(result: {
  readonly ok: false;
  readonly error?: { readonly code?: string; readonly message?: string };
}): string {
  return `${result.error?.code ?? 'ERR'}: ${result.error?.message ?? 'Unknown error'}`;
}

function formatBytes(size: number | undefined): string {
  if (size === undefined) return '-';
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
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

function shortHash(hash: string | null | undefined): string {
  if (!hash) return '-';
  return hash.replace(/^sha256:/, '').slice(0, 12);
}

export function DeliveriesPanel(): JSX.Element {
  const { t, effectiveLocale } = useI18n();
  const currentSessionId = useAppStore((s) => s.currentSessionId);
  const currentProjectPath = useAppStore((s) => s.currentProjectPath);
  const appendLocalNotice = useAppStore((s) => s.appendLocalNotice);
  const [activeTab, setActiveTab] = useState<ActiveTab>('deliveries');
  const [deliveries, setDeliveries] = useState<readonly PartnerDeliveryRefT[]>([]);
  const [checkpoints, setCheckpoints] = useState<readonly PartnerCheckpointT[]>([]);
  const [selectedDeliveryId, setSelectedDeliveryId] = useState<string | null>(null);
  const [selectedCheckpointId, setSelectedCheckpointId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [busyCheckpointId, setBusyCheckpointId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const selectedDelivery = useMemo(
    () => deliveries.find((delivery) => delivery.id === selectedDeliveryId) ?? null,
    [deliveries, selectedDeliveryId],
  );
  const selectedCheckpoint = useMemo(
    () => checkpoints.find((checkpoint) => checkpoint.id === selectedCheckpointId) ?? null,
    [checkpoints, selectedCheckpointId],
  );

  const load = useCallback(
    async (options: { readonly quiet?: boolean } = {}): Promise<void> => {
      const bridge = window.kodaxSpace;
      if (!bridge || !currentSessionId || !currentProjectPath) {
        setDeliveries([]);
        setCheckpoints([]);
        setSelectedDeliveryId(null);
        setSelectedCheckpointId(null);
        setLoading(false);
        return;
      }
      setLoading(true);
      if (!options.quiet) setError(null);
      try {
        const [deliveriesResult, checkpointsResult] = await Promise.all([
          bridge.invoke('partner.deliveries.list', {
            sessionId: currentSessionId,
            projectRoot: currentProjectPath,
          }),
          bridge.invoke('partner.checkpoints.list', {
            sessionId: currentSessionId,
            projectRoot: currentProjectPath,
          }),
        ]);
        if (!deliveriesResult.ok) {
          setError(ipcError(deliveriesResult));
          setDeliveries([]);
        } else {
          const nextDeliveries = deliveriesResult.data.deliveries;
          setDeliveries(nextDeliveries);
          setSelectedDeliveryId((current) =>
            current && nextDeliveries.some((delivery) => delivery.id === current)
              ? current
              : (nextDeliveries[0]?.id ?? null),
          );
        }
        if (!checkpointsResult.ok) {
          setError(ipcError(checkpointsResult));
          setCheckpoints([]);
        } else {
          const nextCheckpoints = checkpointsResult.data.checkpoints;
          setCheckpoints(nextCheckpoints);
          setSelectedCheckpointId((current) =>
            current && nextCheckpoints.some((checkpoint) => checkpoint.id === current)
              ? current
              : (nextCheckpoints[0]?.id ?? null),
          );
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        setDeliveries([]);
        setCheckpoints([]);
      } finally {
        setLoading(false);
      }
    },
    [currentProjectPath, currentSessionId],
  );

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const bridge = window.kodaxSpace;
    if (!bridge) return;
    const offDeliveries = bridge.on('partner.deliveries.changed', (payload) => {
      if (payload.sessionId === currentSessionId) void load({ quiet: true });
    });
    const offCheckpoints = bridge.on('partner.checkpoints.changed', (payload) => {
      if (payload.sessionId === currentSessionId) void load({ quiet: true });
    });
    return () => {
      offDeliveries();
      offCheckpoints();
    };
  }, [currentSessionId, load]);

  async function rollback(checkpoint: PartnerCheckpointT): Promise<void> {
    const bridge = window.kodaxSpace;
    if (!bridge || checkpoint.status !== 'active') return;
    setBusyCheckpointId(checkpoint.id);
    setError(null);
    try {
      const result = await bridge.invoke('partner.checkpoints.rollback', { id: checkpoint.id });
      if (!result.ok) {
        setError(ipcError(result));
        return;
      }
      if (!result.data.ok) {
        setError(result.data.error ?? t('partner.deliveries.rollbackFailed'));
        return;
      }
      pushToast(t('partner.deliveries.rollbackDone'), 'success');
      appendLocalNotice(
        checkpoint.sessionId,
        t('partner.deliveries.notice.rollback', {
          path: checkpoint.relativePath,
          id: checkpoint.id,
        }),
        { sentAt: Date.now(), variant: 'output' },
      );
      await load({ quiet: true });
    } finally {
      setBusyCheckpointId(null);
    }
  }

  if (!currentSessionId) {
    return (
      <EmptyState
        icon={<ArchiveRestore className="h-6 w-6" strokeWidth={1.5} aria-hidden />}
        title={t('partner.deliveries.noSessionTitle')}
        body={t('partner.deliveries.noSessionBody')}
      />
    );
  }

  return (
    <div className="h-full min-h-0 flex flex-col text-xs" data-testid="partner-deliveries-panel">
      <header className="flex-shrink-0 border-b border-border-default px-2 py-2">
        <div className="flex items-center gap-2">
          <ArchiveRestore className="h-4 w-4 text-fg-muted" strokeWidth={1.75} aria-hidden />
          <div className="min-w-0 flex-1">
            <div className="truncate font-medium text-fg-primary">
              {t('partner.deliveries.title')}
            </div>
            <div className="truncate text-[11px] text-fg-muted">
              {t('partner.deliveries.counts', {
                deliveries: deliveries.length,
                checkpoints: checkpoints.length,
              })}
            </div>
          </div>
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="h-7 w-7 inline-flex items-center justify-center rounded text-fg-muted hover:bg-hover-bg hover:text-fg-primary disabled:opacity-60"
            title={t('partner.deliveries.refresh')}
            aria-label={t('partner.deliveries.refresh')}
          >
            {loading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.75} aria-hidden />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden />
            )}
          </button>
        </div>
        <div className="mt-2 grid grid-cols-2 gap-1 rounded bg-surface-2 p-0.5">
          <TabButton active={activeTab === 'deliveries'} onClick={() => setActiveTab('deliveries')}>
            {t('partner.deliveries.tab.deliveries')}
          </TabButton>
          <TabButton
            active={activeTab === 'checkpoints'}
            onClick={() => setActiveTab('checkpoints')}
          >
            {t('partner.deliveries.tab.checkpoints')}
          </TabButton>
        </div>
      </header>

      {error && (
        <div className="flex-shrink-0 border-b border-border-default px-3 py-2 text-danger">
          <div className="flex items-start gap-2">
            <AlertTriangle
              className="mt-0.5 h-3.5 w-3.5 flex-shrink-0"
              strokeWidth={1.75}
              aria-hidden
            />
            <span className="min-w-0 break-words">{error}</span>
          </div>
        </div>
      )}

      {activeTab === 'deliveries' ? (
        <DeliveryList
          deliveries={deliveries}
          selectedId={selectedDeliveryId}
          locale={effectiveLocale}
          onSelect={setSelectedDeliveryId}
        />
      ) : (
        <CheckpointList
          checkpoints={checkpoints}
          selectedId={selectedCheckpointId}
          locale={effectiveLocale}
          onSelect={setSelectedCheckpointId}
        />
      )}

      <div className="flex-1 min-h-0 overflow-y-auto border-t border-border-default">
        {activeTab === 'deliveries' ? (
          <DeliveryDetail delivery={selectedDelivery} locale={effectiveLocale} />
        ) : (
          <CheckpointDetail
            checkpoint={selectedCheckpoint}
            busy={busyCheckpointId === selectedCheckpoint?.id}
            locale={effectiveLocale}
            onRollback={selectedCheckpoint ? () => void rollback(selectedCheckpoint) : undefined}
          />
        )}
      </div>
    </div>
  );
}

function DeliveryList({
  deliveries,
  selectedId,
  locale,
  onSelect,
}: {
  readonly deliveries: readonly PartnerDeliveryRefT[];
  readonly selectedId: string | null;
  readonly locale: string;
  readonly onSelect: (id: string) => void;
}): JSX.Element {
  const { t } = useI18n();
  if (deliveries.length === 0) {
    return (
      <div className="flex-shrink-0 border-b border-border-default px-3 py-5">
        <EmptyState
          compact
          icon={<FileOutput className="h-5 w-5" strokeWidth={1.5} aria-hidden />}
          title={t('partner.deliveries.emptyDeliveries')}
        />
      </div>
    );
  }
  return (
    <div className="flex-shrink-0 max-h-52 overflow-y-auto border-b border-border-default">
      {deliveries.map((delivery) => {
        const Icon = delivery.kind === 'folder' ? Folder : FileOutput;
        return (
          <button
            key={delivery.id}
            type="button"
            onClick={() => onSelect(delivery.id)}
            className={`group w-full border-b border-border-default px-3 py-2 text-left hover:bg-hover-bg ${
              selectedId === delivery.id ? 'bg-surface-3' : ''
            }`}
            title={delivery.absolutePath}
          >
            <div className="flex items-center gap-2">
              <Icon
                className="h-3.5 w-3.5 flex-shrink-0 text-fg-muted"
                strokeWidth={1.75}
                aria-hidden
              />
              <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-fg-secondary">
                {delivery.relativePath}
              </span>
              <span className="rounded border border-border-default px-1.5 py-0.5 text-[10px] text-fg-muted">
                {delivery.rootKind === 'run-output'
                  ? t('partner.deliveries.root.runOutput')
                  : t('partner.deliveries.root.workspace')}
              </span>
            </div>
            <div className="mt-1 flex items-center gap-1.5 text-[11px] text-fg-muted">
              <span>{delivery.mime ?? delivery.extension ?? delivery.kind}</span>
              <span className="ml-auto">{formatBytes(delivery.sizeBytes)}</span>
              <span>{formatTime(delivery.updatedAt, locale)}</span>
            </div>
          </button>
        );
      })}
    </div>
  );
}

function CheckpointList({
  checkpoints,
  selectedId,
  locale,
  onSelect,
}: {
  readonly checkpoints: readonly PartnerCheckpointT[];
  readonly selectedId: string | null;
  readonly locale: string;
  readonly onSelect: (id: string) => void;
}): JSX.Element {
  const { t } = useI18n();
  if (checkpoints.length === 0) {
    return (
      <div className="flex-shrink-0 border-b border-border-default px-3 py-5">
        <EmptyState
          compact
          icon={<GitCompareArrows className="h-5 w-5" strokeWidth={1.5} aria-hidden />}
          title={t('partner.deliveries.emptyCheckpoints')}
        />
      </div>
    );
  }
  return (
    <div className="flex-shrink-0 max-h-52 overflow-y-auto border-b border-border-default">
      {checkpoints.map((checkpoint) => {
        const active = checkpoint.status === 'active';
        return (
          <button
            key={checkpoint.id}
            type="button"
            onClick={() => onSelect(checkpoint.id)}
            className={`group w-full border-b border-border-default px-3 py-2 text-left hover:bg-hover-bg ${
              selectedId === checkpoint.id ? 'bg-surface-3' : ''
            }`}
            title={checkpoint.absolutePath}
          >
            <div className="flex items-center gap-2">
              <GitCompareArrows
                className="h-3.5 w-3.5 flex-shrink-0 text-fg-muted"
                strokeWidth={1.75}
                aria-hidden
              />
              <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-fg-secondary">
                {checkpoint.relativePath}
              </span>
              <span
                className={`rounded border px-1.5 py-0.5 text-[10px] ${
                  active ? 'border-ok/40 bg-ok/10 text-ok' : 'border-border-default text-fg-muted'
                }`}
              >
                {active
                  ? t('partner.deliveries.checkpoint.active')
                  : t('partner.deliveries.checkpoint.rolledBack')}
              </span>
            </div>
            <div className="mt-1 flex items-center gap-1.5 text-[11px] text-fg-muted">
              <span className="uppercase">{checkpoint.operation}</span>
              <span className="ml-auto">{formatBytes(checkpoint.afterSizeBytes)}</span>
              <span>{formatTime(checkpoint.updatedAt, locale)}</span>
            </div>
          </button>
        );
      })}
    </div>
  );
}

function DeliveryDetail({
  delivery,
  locale,
}: {
  readonly delivery: PartnerDeliveryRefT | null;
  readonly locale: string;
}): JSX.Element {
  const { t } = useI18n();
  if (!delivery) {
    return (
      <EmptyState
        icon={<FileOutput className="h-6 w-6" strokeWidth={1.5} aria-hidden />}
        title={t('partner.deliveries.selectDelivery')}
      />
    );
  }
  const selectedDelivery = delivery;
  const previewKind: RichPreviewKind | null =
    delivery.kind === 'file'
      ? (detectKind(delivery.relativePath) ??
        (delivery.mime?.startsWith('text/') ||
        delivery.mime === 'application/json' ||
        delivery.mime === 'application/xml' ||
        delivery.mime === 'image/svg+xml'
          ? 'text'
          : null))
      : null;

  async function copyPath(): Promise<void> {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('clipboard unavailable');
      await navigator.clipboard.writeText(selectedDelivery.absolutePath);
      pushToast(t('fileActions.copySucceeded'), 'success', 1400);
    } catch {
      pushToast(t('fileActions.copyFailed'), 'error');
    }
  }

  return (
    <div className="min-h-full p-3 space-y-3">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <HeaderLine title={delivery.relativePath} subtitle={delivery.id} />
        </div>
        <div className="flex flex-shrink-0 items-center gap-1">
          {delivery.kind === 'file' && (
            <button
              type="button"
              onClick={() => void openPartnerDeliveryInViewer(selectedDelivery)}
              className="h-7 w-7 inline-flex items-center justify-center rounded border border-border-default text-fg-muted hover:bg-hover-bg hover:text-fg-primary"
              title={t('fileActions.openInFileViewer')}
              aria-label={t('fileActions.openInFileViewer')}
            >
              <FileOutput className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden />
            </button>
          )}
          <button
            type="button"
            onClick={() => void copyPath()}
            className="h-7 w-7 inline-flex items-center justify-center rounded border border-border-default text-fg-muted hover:bg-hover-bg hover:text-fg-primary"
            title={t('partner.deliveries.copyPath')}
            aria-label={t('partner.deliveries.copyPath')}
          >
            <Copy className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden />
          </button>
          <button
            type="button"
            onClick={() => void revealPath(selectedDelivery.absolutePath)}
            className="h-7 w-7 inline-flex items-center justify-center rounded border border-border-default text-fg-muted hover:bg-hover-bg hover:text-fg-primary"
            title={t('partner.deliveries.reveal')}
            aria-label={t('partner.deliveries.reveal')}
          >
            <FolderOpen className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden />
          </button>
        </div>
      </div>
      <Section title={t('partner.deliveries.location')}>
        <pre className="whitespace-pre-wrap break-words rounded border border-border-default bg-surface-2 p-2 font-mono text-[11px] text-fg-secondary">
          {delivery.absolutePath}
        </pre>
      </Section>
      <Section title={t('partner.deliveries.metadata')}>
        <MetaRow label={t('partner.deliveries.kind')} value={delivery.kind} />
        <MetaRow label={t('partner.deliveries.root')} value={delivery.rootKind} />
        <MetaRow label={t('partner.deliveries.size')} value={formatBytes(delivery.sizeBytes)} />
        <MetaRow label={t('partner.deliveries.mime')} value={delivery.mime ?? '-'} />
        <MetaRow label={t('partner.deliveries.hash')} value={shortHash(delivery.contentHash)} />
        <MetaRow
          label={t('partner.deliveries.updated')}
          value={formatTime(delivery.updatedAt, locale)}
        />
      </Section>
      <Section title={t('partner.deliveries.sources')}>
        {delivery.sourceRefs.length > 0 ? (
          <div className="space-y-1">
            {delivery.sourceRefs.map((ref) => (
              <div key={ref} className="truncate font-mono text-[11px] text-fg-muted" title={ref}>
                {ref}
              </div>
            ))}
          </div>
        ) : (
          <div className="text-fg-muted">{t('partner.fileProposals.none')}</div>
        )}
      </Section>
      <Section title={t('partner.deliveries.preview')}>
        {previewKind ? (
          <div className="h-80 min-h-0 overflow-hidden rounded border border-border-default bg-surface-2">
            <RichPreview
              path={delivery.relativePath}
              kind={previewKind}
              fileSource="delivery-store"
              deliveryId={delivery.id}
            />
          </div>
        ) : (
          <div className="text-fg-muted">{t('partner.deliveries.previewUnavailable')}</div>
        )}
      </Section>
    </div>
  );
}

function CheckpointDetail({
  checkpoint,
  busy,
  locale,
  onRollback,
}: {
  readonly checkpoint: PartnerCheckpointT | null;
  readonly busy: boolean;
  readonly locale: string;
  readonly onRollback?: () => void;
}): JSX.Element {
  const { t } = useI18n();
  if (!checkpoint) {
    return (
      <EmptyState
        icon={<GitCompareArrows className="h-6 w-6" strokeWidth={1.5} aria-hidden />}
        title={t('partner.deliveries.selectCheckpoint')}
      />
    );
  }
  const active = checkpoint.status === 'active';
  return (
    <div className="min-h-full p-3 space-y-3">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <HeaderLine title={checkpoint.relativePath} subtitle={checkpoint.id} />
        </div>
        {active ? (
          <button
            type="button"
            onClick={onRollback}
            disabled={busy}
            className="h-8 inline-flex items-center gap-1.5 rounded border border-border-default px-2 text-xs text-fg-secondary hover:bg-hover-bg disabled:cursor-not-allowed disabled:opacity-60"
            title={t('partner.deliveries.rollback')}
          >
            {busy ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.75} aria-hidden />
            ) : (
              <RotateCcw className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden />
            )}
            {t('partner.deliveries.rollback')}
          </button>
        ) : (
          <span className="inline-flex h-8 items-center gap-1.5 rounded border border-ok/40 bg-ok/10 px-2 text-xs text-ok">
            <CheckCircle2 className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden />
            {t('partner.deliveries.checkpoint.rolledBack')}
          </span>
        )}
      </div>
      <Section title={t('partner.deliveries.metadata')}>
        <MetaRow label={t('partner.deliveries.operation')} value={checkpoint.operation} />
        <MetaRow label={t('partner.deliveries.status')} value={checkpoint.status} />
        <MetaRow label={t('partner.deliveries.before')} value={shortHash(checkpoint.beforeHash)} />
        <MetaRow label={t('partner.deliveries.after')} value={shortHash(checkpoint.afterHash)} />
        <MetaRow
          label={t('partner.deliveries.size')}
          value={formatBytes(checkpoint.afterSizeBytes)}
        />
        <MetaRow
          label={t('partner.deliveries.updated')}
          value={formatTime(checkpoint.updatedAt, locale)}
        />
      </Section>
      <Section title={t('partner.fileProposals.diff')}>
        {checkpoint.diff ? (
          <>
            <pre className="max-h-72 overflow-auto rounded border border-border-default bg-surface-2 p-2 font-mono text-[11px] leading-relaxed text-fg-secondary whitespace-pre-wrap">
              {checkpoint.diff.unified}
            </pre>
            {checkpoint.diff.truncated && (
              <div className="mt-1 text-[11px] text-warn">
                {t('partner.fileProposals.truncated')}
              </div>
            )}
          </>
        ) : (
          <div className="text-fg-muted">{t('partner.deliveries.binaryDiff')}</div>
        )}
      </Section>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  readonly active: boolean;
  readonly onClick: () => void;
  readonly children: ReactNode;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`h-6 rounded text-[11px] ${
        active
          ? 'bg-surface-raised text-fg-primary'
          : 'text-fg-muted hover:bg-hover-bg hover:text-fg-primary'
      }`}
      aria-pressed={active}
    >
      {children}
    </button>
  );
}

function HeaderLine({
  title,
  subtitle,
}: {
  readonly title: string;
  readonly subtitle: string;
}): JSX.Element {
  return (
    <>
      <div className="truncate font-mono text-[11px] text-fg-muted">{subtitle}</div>
      <div className="mt-1 break-words font-mono text-[12px] font-medium text-fg-primary">
        {title}
      </div>
    </>
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
      <span className="w-20 flex-shrink-0 text-fg-muted">{label}</span>
      <span className="min-w-0 truncate font-mono text-fg-secondary" title={value}>
        {value}
      </span>
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
      className={`h-full flex flex-col items-center justify-center gap-2 text-center ${compact ? 'p-1' : 'p-6'}`}
    >
      <div className="text-fg-muted">{icon}</div>
      <div className="text-[12px] font-medium text-fg-secondary">{title}</div>
      {body && (
        <div className="max-w-[220px] text-[11px] leading-relaxed text-fg-muted">{body}</div>
      )}
    </div>
  );
}
