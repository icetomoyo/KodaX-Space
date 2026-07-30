import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronRight, Loader2, RefreshCw, ShieldCheck } from 'lucide-react';
import type {
  LearnedCapabilityActionT,
  LearnedCapabilityProjectionT,
  PushPayload,
} from '@kodax-space/space-ipc-schema';

import { useI18n } from '../../i18n/I18nProvider.js';
import type { MessageKey } from '../../i18n/messages.js';
import { useAppStore } from '../../store/appStore.js';
import { requestConfirm } from '../../store/confirmStore.js';
import {
  actionableLearningAttention,
  canShowLearningSafetySurface,
  learningActionNeedsDangerTone,
} from './learningModel.js';

const OPEN_STORAGE_KEY = 'kodax-space.learningSafety.open';
const PAGE_SIZE = 50;

const ACTION_LABEL: Record<LearnedCapabilityActionT, MessageKey> = {
  review: 'learning.action.review',
  trust: 'learning.action.trust',
  reject: 'learning.action.reject',
  disable: 'learning.action.disable',
  rollback: 'learning.action.rollback',
};

function readInitiallyOpen(): boolean {
  try {
    return window.localStorage.getItem(OPEN_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

function storeOpen(open: boolean): void {
  try {
    window.localStorage.setItem(OPEN_STORAGE_KEY, String(open));
  } catch {
    // The section remains usable when private-mode storage is unavailable.
  }
}

function mergeRecords(
  current: readonly LearnedCapabilityProjectionT[],
  incoming: readonly LearnedCapabilityProjectionT[],
): LearnedCapabilityProjectionT[] {
  const records = new Map(current.map((record) => [record.capabilityId, record]));
  for (const record of incoming) {
    const previous = records.get(record.capabilityId);
    if (!previous || record.revision >= previous.revision) records.set(record.capabilityId, record);
  }
  return [...records.values()];
}

function shortHash(value: string): string {
  return value.length <= 24 ? value : `${value.slice(0, 12)}…${value.slice(-8)}`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function LearningSafetySection(): JSX.Element | null {
  const { t, effectiveLocale } = useI18n();
  const connection = useAppStore((state) => state.runtimeConnection);
  const visible = canShowLearningSafetySurface(connection);
  const [open, setOpenState] = useState(readInitiallyOpen);
  const [items, setItems] = useState<LearnedCapabilityProjectionT[]>([]);
  const [nextCursor, setNextCursor] = useState<string | undefined>();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<LearnedCapabilityProjectionT | null>(null);
  const [loading, setLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [actionBusy, setActionBusy] = useState<LearnedCapabilityActionT | 'ack' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [streamError, setStreamError] = useState<string | null>(null);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const listRequestRef = useRef(0);
  const detailRequestRef = useRef(0);
  const selectedIdRef = useRef<string | null>(null);
  const lastRuntimeIdRef = useRef<string | undefined>(undefined);
  const runtimeId = connection.runtimeId;
  const connectionChangedAt = connection.changedAt;

  const setOpen = useCallback((next: boolean) => {
    setOpenState(next);
    storeOpen(next);
  }, []);

  const loadPage = useCallback(
    async (cursor?: string, append = false): Promise<void> => {
      const bridge = window.kodaxSpace;
      if (!visible || !bridge) return;
      const requestId = ++listRequestRef.current;
      setLoading(true);
      if (!append) setError(null);
      try {
        const result = await bridge.invoke('learning.list', {
          limit: PAGE_SIZE,
          ...(cursor ? { cursor } : {}),
        });
        if (requestId !== listRequestRef.current) return;
        if (!result.ok) {
          setError(t('learning.loadFailed', { message: result.error.message }));
          return;
        }
        const loaded = result.data.items;
        setItems((current) => (append ? mergeRecords(current, loaded) : [...loaded]));
        setDetail((current) => {
          if (!current) return current;
          const fresh = loaded.find((item) => item.capabilityId === current.capabilityId);
          return fresh && fresh.revision >= current.revision ? fresh : current;
        });
        setNextCursor(result.data.nextCursor);
        setSelectedId((current) => {
          if (current) return current;
          const preferred = loaded.find(
            (item) =>
              item.lifecycle === 'ready' ||
              item.lifecycle === 'testing' ||
              item.lifecycle === 'quarantined',
          );
          return preferred?.capabilityId ?? loaded[0]?.capabilityId ?? null;
        });
      } catch (loadError) {
        if (requestId === listRequestRef.current) {
          setError(t('learning.loadFailed', { message: errorMessage(loadError) }));
        }
      } finally {
        if (requestId === listRequestRef.current) setLoading(false);
      }
    },
    [t, visible],
  );

  const loadDetail = useCallback(
    async (capabilityId: string): Promise<void> => {
      const bridge = window.kodaxSpace;
      if (!visible || !bridge) return;
      const requestId = ++detailRequestRef.current;
      setDetailLoading(true);
      try {
        const result = await bridge.invoke('learning.get', { capabilityId });
        if (requestId !== detailRequestRef.current) return;
        if (result.ok) {
          setDetail((current) =>
            current &&
            current.capabilityId === result.data.record.capabilityId &&
            current.revision > result.data.record.revision
              ? current
              : result.data.record,
          );
          setError(null);
        } else {
          setError(t('learning.loadFailed', { message: result.error.message }));
        }
      } catch (loadError) {
        if (requestId === detailRequestRef.current) {
          setError(t('learning.loadFailed', { message: errorMessage(loadError) }));
        }
      } finally {
        if (requestId === detailRequestRef.current) setDetailLoading(false);
      }
    },
    [t, visible],
  );

  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);

  const refresh = useCallback(async (): Promise<void> => {
    await loadPage(undefined, false);
    const currentSelection = selectedIdRef.current;
    if (currentSelection) await loadDetail(currentSelection);
  }, [loadDetail, loadPage]);

  useEffect(() => {
    if (!visible) {
      listRequestRef.current += 1;
      detailRequestRef.current += 1;
      lastRuntimeIdRef.current = undefined;
      setItems([]);
      setSelectedId(null);
      setDetail(null);
      setLoading(false);
      setDetailLoading(false);
      setError(null);
      setStreamError(null);
      return;
    }
    const runtimeChanged = lastRuntimeIdRef.current !== runtimeId;
    lastRuntimeIdRef.current = runtimeId;
    if (runtimeChanged) {
      detailRequestRef.current += 1;
      setItems([]);
      setSelectedId(null);
      setDetail(null);
      setDetailLoading(false);
      void loadPage(undefined, false);
      return;
    }
    void refresh();
  }, [connectionChangedAt, loadPage, refresh, runtimeId, visible]);

  useEffect(() => {
    const bridge = window.kodaxSpace;
    if (!visible || !bridge) return;
    const scheduleRefresh = (): void => {
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = setTimeout(() => {
        refreshTimerRef.current = null;
        void refresh();
      }, 100);
    };
    const unsubscribe = bridge.on(
      'learning.changed',
      (payload: PushPayload<'learning.changed'>) => {
        if ('runtimeId' in payload && payload.runtimeId && payload.runtimeId !== runtimeId) return;
        if (payload.kind === 'status') {
          setStreamError(
            payload.state === 'reconnecting'
              ? t('learning.reconnecting', {
                  message: payload.message ?? t('common.unknownError'),
                })
              : null,
          );
          return;
        }
        setStreamError(null);
        scheduleRefresh();
      },
    );
    return () => {
      unsubscribe();
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = null;
    };
  }, [refresh, runtimeId, t, visible]);

  useEffect(() => {
    if (!visible || !selectedId) {
      detailRequestRef.current += 1;
      setDetail(null);
      setDetailLoading(false);
      return;
    }
    void loadDetail(selectedId);
  }, [loadDetail, selectedId, visible]);

  const attention = useMemo(() => actionableLearningAttention(items), [items]);

  const runAction = useCallback(
    async (action: LearnedCapabilityActionT): Promise<void> => {
      const bridge = window.kodaxSpace;
      if (!bridge || !detail || detail.schemaVersion !== 2 || actionBusy !== null) return;
      const actionLabel = t(ACTION_LABEL[action]);
      const confirmed = await requestConfirm({
        title: t('learning.actionConfirmTitle'),
        message: t('learning.actionConfirm', {
          action: actionLabel,
          name: detail.displayName,
          revision: detail.revision,
          capabilityId: detail.capabilityId,
          fingerprint: detail.artifact.fingerprint,
        }),
        confirmLabel: actionLabel,
        danger: learningActionNeedsDangerTone(action),
      });
      if (!confirmed) return;
      setActionBusy(action);
      setError(null);
      try {
        const result = await bridge.invoke('learning.action', {
          action,
          capabilityId: detail.capabilityId,
          expectedRevision: detail.revision,
          expectedFingerprint: detail.artifact.fingerprint,
        });
        if (!result.ok) {
          setError(
            t('learning.actionFailed', {
              action: actionLabel,
              message: result.error.message,
            }),
          );
          return;
        }
        setDetail(result.data.record);
        setItems((current) => mergeRecords(current, [result.data.record]));
        await refresh();
      } catch (actionError) {
        setError(
          t('learning.actionFailed', {
            action: actionLabel,
            message: errorMessage(actionError),
          }),
        );
      } finally {
        setActionBusy(null);
      }
    },
    [actionBusy, detail, refresh, t],
  );

  const acknowledge = useCallback(async (): Promise<void> => {
    const bridge = window.kodaxSpace;
    if (!bridge || !detail || actionBusy !== null) return;
    setActionBusy('ack');
    setError(null);
    try {
      const result = await bridge.invoke('learning.acknowledge', {
        capabilityId: detail.capabilityId,
      });
      if (!result.ok) {
        setError(t('learning.acknowledgeFailed', { message: result.error.message }));
      }
    } catch (ackError) {
      setError(t('learning.acknowledgeFailed', { message: errorMessage(ackError) }));
    } finally {
      setActionBusy(null);
    }
  }, [actionBusy, detail, t]);

  if (!visible) return null;

  return (
    <section className="border-b border-border-default/60" data-testid="learning-safety-section">
      <div className="flex min-h-8 items-stretch text-xs uppercase tracking-wider text-fg-muted">
        <button
          type="button"
          onClick={() => setOpen(!open)}
          className="flex min-w-0 flex-1 items-center gap-1.5 px-3 py-2 text-left hover:bg-hover-bg hover:text-fg-primary"
          aria-expanded={open}
        >
          <span className="truncate">{t('learning.title')}</span>
          {attention > 0 && (
            <span
              className="inline-flex min-w-4 items-center justify-center rounded-full bg-warning/15 px-1 text-[10px] font-semibold text-warning"
              data-testid="learning-attention-badge"
            >
              {attention}
              {nextCursor ? '+' : ''}
            </span>
          )}
        </button>
        <button
          type="button"
          onClick={() => void refresh()}
          className="m-0.5 inline-flex h-7 w-7 items-center justify-center rounded hover:bg-surface-3 hover:text-fg-primary"
          title={t('learning.refresh')}
          aria-label={t('learning.refresh')}
          disabled={loading}
        >
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} aria-hidden />
        </button>
        <button
          type="button"
          onClick={() => setOpen(!open)}
          className="m-0.5 inline-flex h-7 w-7 items-center justify-center rounded hover:bg-surface-3 hover:text-fg-primary"
          aria-label={open ? t('right.collapseSection') : t('right.expandSection')}
        >
          <ChevronRight
            size={13}
            className={`transition-transform ${open ? 'rotate-90' : ''}`}
            aria-hidden
          />
        </button>
      </div>
      {open && (
        <div className="space-y-2 px-2 pb-3" data-testid="learning-safety-content">
          {streamError && (
            <p className="rounded border border-warning/30 bg-warning/10 px-2 py-1.5 text-[11px] text-warning">
              {streamError}
            </p>
          )}
          {error && (
            <p className="rounded border border-danger/30 bg-danger/10 px-2 py-1.5 text-[11px] text-danger">
              {error}
            </p>
          )}
          {loading && items.length === 0 ? (
            <div className="flex items-center gap-1.5 py-2 text-[11px] text-fg-muted">
              <Loader2 size={12} className="animate-spin" aria-hidden />
              {t('learning.loading')}
            </div>
          ) : items.length === 0 ? (
            <p className="py-2 text-[11px] text-fg-muted">{t('learning.empty')}</p>
          ) : (
            <>
              <div
                className="max-h-44 space-y-1 overflow-y-auto pr-0.5"
                role="listbox"
                aria-label={t('learning.title')}
              >
                {items.map((item) => {
                  const selected = item.capabilityId === selectedId;
                  const needsAttention =
                    item.availableActions.length > 0 &&
                    (item.lifecycle === 'ready' ||
                      item.lifecycle === 'testing' ||
                      item.lifecycle === 'quarantined');
                  return (
                    <button
                      key={item.capabilityId}
                      type="button"
                      role="option"
                      aria-selected={selected}
                      onClick={() => setSelectedId(item.capabilityId)}
                      className={`flex w-full items-center gap-2 rounded border px-2 py-1.5 text-left ${
                        selected
                          ? 'border-accent/40 bg-accent/10 text-fg-primary'
                          : 'border-border-default/60 bg-surface-2 text-fg-secondary hover:bg-surface-3'
                      }`}
                    >
                      <ShieldCheck
                        size={13}
                        className={needsAttention ? 'text-warning' : 'text-fg-muted'}
                        aria-hidden
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[11px] font-medium">
                          {item.displayName}
                        </span>
                        <span className="block truncate font-mono text-[9px] text-fg-muted">
                          {item.lifecycle} · r{item.revision}
                        </span>
                      </span>
                      {item.availableActions.length === 0 && (
                        <span className="text-[9px] text-fg-muted">{t('learning.readOnly')}</span>
                      )}
                    </button>
                  );
                })}
              </div>
              {nextCursor && (
                <button
                  type="button"
                  onClick={() => void loadPage(nextCursor, true)}
                  disabled={loading}
                  className="w-full rounded border border-border-default px-2 py-1 text-[10px] text-fg-secondary hover:bg-surface-3 disabled:opacity-50"
                  title={t('learning.moreAvailable')}
                >
                  {loading ? t('common.loading') : t('learning.loadMore')}
                </button>
              )}
            </>
          )}
          {detailLoading && (
            <div className="flex items-center gap-1.5 py-2 text-[11px] text-fg-muted">
              <Loader2 size={12} className="animate-spin" aria-hidden />
              {t('common.loading')}
            </div>
          )}
          {!detailLoading && detail && (
            <LearningDetail
              record={detail}
              locale={effectiveLocale}
              busy={actionBusy}
              onAction={(action) => void runAction(action)}
              onAcknowledge={() => void acknowledge()}
            />
          )}
        </div>
      )}
    </section>
  );
}

function LearningDetail({
  record,
  locale,
  busy,
  onAction,
  onAcknowledge,
}: {
  readonly record: LearnedCapabilityProjectionT;
  readonly locale: string;
  readonly busy: LearnedCapabilityActionT | 'ack' | null;
  readonly onAction: (action: LearnedCapabilityActionT) => void;
  readonly onAcknowledge: () => void;
}): JSX.Element {
  const { t } = useI18n();
  return (
    <article className="space-y-2 rounded-lg border border-border-default/70 bg-surface-2 p-2">
      <div className="min-w-0">
        <h3
          className="truncate text-[12px] font-semibold text-fg-primary"
          title={record.displayName}
        >
          {record.displayName}
        </h3>
        <p className="truncate font-mono text-[9px] text-fg-muted" title={record.capabilityId}>
          {record.capabilityId}
        </p>
      </div>
      <FactGrid>
        <Fact label={t('learning.lifecycle')} value={record.lifecycle} />
        <Fact label={t('learning.revision')} value={String(record.revision)} />
        <Fact
          label={t('learning.created')}
          value={new Intl.DateTimeFormat(locale, {
            dateStyle: 'medium',
            timeStyle: 'short',
          }).format(new Date(record.createdAt))}
        />
        <Fact
          label={t('learning.updated')}
          value={new Intl.DateTimeFormat(locale, {
            dateStyle: 'medium',
            timeStyle: 'short',
          }).format(new Date(record.updatedAt))}
        />
        <Fact label="Carrier" value={record.carrier} />
        <Fact label={t('learning.source')} value={record.source.kind} />
      </FactGrid>
      {record.schemaVersion === 2 ? (
        <>
          <DetailGroup title={t('learning.artifact')}>
            <CodeFact label="Path" value={record.artifact.relativePath} />
            <CodeFact label={t('learning.fingerprint')} value={record.artifact.fingerprint} />
            <CodeFact
              label={t('learning.contentRevision')}
              value={String(record.artifact.contentRevision)}
            />
          </DetailGroup>
          <DetailGroup title={t('learning.scope')}>
            <CodeFact label="config" value={record.scope.configHomeHash} compact />
            <CodeFact label="tenant" value={record.scope.tenantHash} compact />
            <CodeFact label="project" value={record.scope.projectHash} compact />
          </DetailGroup>
          <DetailGroup title={t('learning.provenance')}>
            <CodeFact label="job" value={record.provenance.jobId} compact />
            <CodeFact label="input" value={record.provenance.inputHash} compact />
            <CodeFact label="decision" value={record.provenance.decisionId} compact />
            <CodeFact label="action" value={record.provenance.actionId} compact />
          </DetailGroup>
          <DetailGroup title={t('learning.canary')}>
            <p
              className={`text-[10px] ${
                record.canary.credibleNegatives > 0
                  ? 'text-danger'
                  : record.canary.verifiedSuccesses > 0
                    ? 'text-success'
                    : 'text-fg-muted'
              }`}
            >
              {record.canary.credibleNegatives > 0
                ? t('learning.validationNegative', {
                    count: record.canary.credibleNegatives,
                  })
                : record.canary.verifiedSuccesses > 0
                  ? t('learning.validationSuccess', {
                      count: record.canary.verifiedSuccesses,
                    })
                  : t('learning.validationPending')}
            </p>
            <p className="font-mono text-[9px] text-fg-muted">
              {record.canary.invocationCount}/{record.canary.maxInvocations} · ✓
              {record.canary.verifiedSuccesses} · !{record.canary.credibleNegatives}
            </p>
            {record.canary.invocations.map((invocation, index) => (
              <div
                key={invocation.invocationId}
                className="rounded border border-border-default/60 bg-surface-1 p-1.5"
              >
                <p className="text-[10px] text-fg-secondary">
                  {t('learning.invocation', {
                    index: index + 1,
                    revision: invocation.artifactRevision ?? record.artifact.contentRevision,
                  })}
                </p>
                <p className="font-mono text-[9px] text-fg-muted">{invocation.status}</p>
                <p className="mt-1 text-[9px] uppercase tracking-wide text-fg-muted">
                  {t('learning.evidence')}
                </p>
                {invocation.evidenceRefs.length > 0 ? (
                  invocation.evidenceRefs.map((evidence) => (
                    <p key={evidence} className="break-all font-mono text-[9px] text-fg-secondary">
                      {evidence}
                    </p>
                  ))
                ) : (
                  <p className="text-[9px] text-fg-muted">{t('learning.noEvidence')}</p>
                )}
              </div>
            ))}
          </DetailGroup>
          {record.previousGoodRevision !== undefined && (
            <DetailGroup title={t('learning.previousGood')}>
              <CodeFact label="revision" value={String(record.previousGoodRevision)} />
              {record.previousGoodArtifact && (
                <CodeFact
                  label={t('learning.fingerprint')}
                  value={record.previousGoodArtifact.fingerprint}
                />
              )}
            </DetailGroup>
          )}
        </>
      ) : (
        <p className="rounded border border-border-default/70 bg-surface-1 px-2 py-1.5 text-[10px] text-fg-muted">
          {record.readOnlyReason}
        </p>
      )}
      {record.diagnostics && record.diagnostics.length > 0 && (
        <DetailGroup title={t('learning.diagnostics')}>
          {record.diagnostics.map((diagnostic) => (
            <p key={diagnostic} className="break-words text-[10px] text-warning">
              {diagnostic}
            </p>
          ))}
        </DetailGroup>
      )}
      <div className="flex flex-wrap gap-1">
        <button
          type="button"
          onClick={onAcknowledge}
          disabled={busy !== null}
          className="inline-flex min-h-7 items-center gap-1 rounded border border-border-default px-2 py-1 text-[10px] text-fg-secondary hover:bg-surface-3 disabled:opacity-50"
        >
          {busy === 'ack' ? (
            <Loader2 size={11} className="animate-spin" aria-hidden />
          ) : (
            <Check size={11} aria-hidden />
          )}
          {t('learning.acknowledge')}
        </button>
        {record.availableActions.map((action) => (
          <button
            key={action}
            type="button"
            onClick={() => onAction(action)}
            disabled={busy !== null}
            className={`min-h-7 rounded border px-2 py-1 text-[10px] disabled:opacity-50 ${
              learningActionNeedsDangerTone(action)
                ? 'border-danger/40 text-danger hover:bg-danger/10'
                : action === 'trust'
                  ? 'border-success/40 text-success hover:bg-success/10'
                  : 'border-accent/40 text-accent hover:bg-accent/10'
            }`}
          >
            {busy === action ? '…' : t(ACTION_LABEL[action])}
          </button>
        ))}
      </div>
      {record.readOnlyReason &&
        record.availableActions.length === 0 &&
        record.schemaVersion === 2 && (
          <p className="text-[10px] text-fg-muted">{record.readOnlyReason}</p>
        )}
    </article>
  );
}

function FactGrid({ children }: { readonly children: React.ReactNode }): JSX.Element {
  return <dl className="grid grid-cols-2 gap-x-2 gap-y-1">{children}</dl>;
}

function Fact({ label, value }: { readonly label: string; readonly value: string }): JSX.Element {
  return (
    <div className="min-w-0">
      <dt className="text-[9px] uppercase tracking-wide text-fg-muted">{label}</dt>
      <dd className="truncate text-[10px] text-fg-secondary" title={value}>
        {value}
      </dd>
    </div>
  );
}

function DetailGroup({
  title,
  children,
}: {
  readonly title: string;
  readonly children: React.ReactNode;
}): JSX.Element {
  return (
    <section className="space-y-1 border-t border-border-default/60 pt-1.5">
      <h4 className="text-[9px] font-semibold uppercase tracking-wide text-fg-muted">{title}</h4>
      {children}
    </section>
  );
}

function CodeFact({
  label,
  value,
  compact = false,
}: {
  readonly label: string;
  readonly value: string;
  readonly compact?: boolean;
}): JSX.Element {
  return (
    <div className="grid grid-cols-[70px_minmax(0,1fr)] gap-1 text-[9px]">
      <span className="text-fg-muted">{label}</span>
      <code className="break-all text-fg-secondary" title={value}>
        {compact ? shortHash(value) : value}
      </code>
    </div>
  );
}
