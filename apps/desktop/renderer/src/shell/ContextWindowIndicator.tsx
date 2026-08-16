// ContextWindowIndicator — alpha.2
//
// Claude Desktop 截图 9：底部输入框右侧 `Context window  96.1k / 200k (48%) ›`，
// 点击 › 展开 breakdown 弹窗，含进度条 + 分项 token 占用。
//
// 数据来源：
//   - tokenCount: iteration_end 事件的 tokenCount（最近一条）
//   - session usage: 累加 root + child Agent 的每条 iteration_end provider usage；
//     cached read / cache write 都是 input 子集
//   - context breakdown: SDK RuntimeContextBudgetSnapshot（只含分类 token 数，不含上下文原文）
//   - cap: 走 SDK driven IPC `provider.modelContextWindow`，按 (providerId, model) 缓存
//     —— SDK 内部 resolveContextWindow 四步级联（user override → provider per-model →
//     provider default → 200k hard fallback），UI 用同一函数 = single source of truth
//   - 历史 fallback: 查询期间 / IPC 失败时仍用 modelContextCaps 硬编码表兜底，避免空窗显示

import { useEffect, useState, type CSSProperties } from 'react';
import { useI18n } from '../i18n/I18nProvider.js';
import { useAppStore } from '../store/appStore.js';
import {
  isEstimatedContextInput,
  resolveActiveInputReading,
  resolveContextWindowReading,
  resolveProviderReportedTokens,
  type ResolvedContextWindowReading,
} from './contextWindowReading.js';
import { getModelContextCap } from './modelContextCaps.js';
import { resolveActiveModel } from './resolveActiveModel.js';

const DEFAULT_COMPACTION_TRIGGER_PERCENT = 75;
export const COMPACTION_CONFIG_CHANGED_EVENT = 'kodax:compaction-config-changed';

type ContextGaugeStyle = CSSProperties & {
  '--cw-level': string;
  '--cw-level-dim': string;
  '--cw-level-glow': string;
  '--cw-level-height': string;
};

/** 后台查 SDK 拿 contextWindow + cache; UI 同步 fallback 到硬编码表先渲染避免抖动。*/
function useResolvedContextWindow(
  providerId: string | null,
  model: string | null,
  hardcodedFallback: number,
): ResolvedContextWindowReading {
  const [configRevision, setConfigRevision] = useState(0);
  const [resolved, setResolved] = useState<ResolvedContextWindowReading>({
    contextWindow: hardcodedFallback,
    triggerPercent: DEFAULT_COMPACTION_TRIGGER_PERCENT,
  });

  useEffect(() => {
    const onChanged = (): void => setConfigRevision((revision) => revision + 1);
    window.addEventListener(COMPACTION_CONFIG_CHANGED_EVENT, onChanged);
    return () => window.removeEventListener(COMPACTION_CONFIG_CHANGED_EVENT, onChanged);
  }, []);

  useEffect(() => {
    if (!providerId || !model) {
      setResolved({
        contextWindow: hardcodedFallback,
        triggerPercent: DEFAULT_COMPACTION_TRIGGER_PERCENT,
      });
      return;
    }
    setResolved((current) => ({ ...current, contextWindow: hardcodedFallback }));
    let cancelled = false;
    // window.kodaxSpace 在 preload 注入；prod 永远 defined，但 type 上是 optional
    const api = window.kodaxSpace;
    if (!api) {
      setResolved({
        contextWindow: hardcodedFallback,
        triggerPercent: DEFAULT_COMPACTION_TRIGGER_PERCENT,
      });
      return;
    }
    void api
      .invoke('provider.modelContextWindow', { providerId, model })
      .then((r) => {
        if (cancelled) return;
        if (!r.ok) {
          setResolved({
            contextWindow: hardcodedFallback,
            triggerPercent: DEFAULT_COMPACTION_TRIGGER_PERCENT,
          });
          return;
        }
        setResolved(resolveContextWindowReading(r.data, hardcodedFallback));
      })
      .catch(() => {
        if (cancelled) return;
        setResolved({
          contextWindow: hardcodedFallback,
          triggerPercent: DEFAULT_COMPACTION_TRIGGER_PERCENT,
        });
      });
    return () => {
      cancelled = true;
    };
  }, [providerId, model, hardcodedFallback, configRevision]);

  return resolved;
}

export function ContextWindowIndicator({
  compacting = false,
}: {
  readonly compacting?: boolean;
}): JSX.Element | null {
  const { t } = useI18n();
  const currentSessionId = useAppStore((s) => s.currentSessionId);
  const tokenInfo = useAppStore((s) =>
    currentSessionId ? s.tokensBySession[currentSessionId] : undefined,
  );
  const sessionUsage = useAppStore((s) =>
    currentSessionId ? s.sessionTokenUsageBySession[currentSessionId] : undefined,
  );
  const latestProviderCacheDiagnostic = useAppStore((s) =>
    currentSessionId ? s.providerCacheDiagnosticBySession[currentSessionId] : undefined,
  );
  const rawContextBudget = useAppStore((s) =>
    currentSessionId ? s.contextBudgetBySession[currentSessionId] : undefined,
  );
  // 当前 active model — session 优先；无 session 时用 pendingModel / kodaxDefaults / provider 默认
  const sessions = useAppStore((s) => s.sessions);
  const providers = useAppStore((s) => s.providers);
  const defaultProviderId = useAppStore((s) => s.defaultProviderId);
  const kodaxDefaults = useAppStore((s) => s.kodaxDefaults);
  const pendingProviderId = useAppStore((s) => s.pendingProviderId);
  const pendingModel = useAppStore((s) => s.pendingModel);
  const [contextOpen, setContextOpen] = useState(false);
  const [sessionUsageOpen, setSessionUsageOpen] = useState(false);

  // Active provider / model 必须在 early-return 之前算好，让下面的 useResolvedContextWindow
  // 永远以稳定顺序被 React 调用。即便 currentSessionId 为 null，hook 也调一次（输入 null →
  // 返回 hardcodedFallback，没有副作用）。
  const session = currentSessionId
    ? sessions.find((s) => s.sessionId === currentSessionId)
    : undefined;
  const activeProviderId =
    session?.provider ?? pendingProviderId ?? defaultProviderId ?? kodaxDefaults?.provider ?? null;
  const activeProvider = activeProviderId
    ? providers.find((p) => p.id === activeProviderId)
    : undefined;
  const preferredModel = resolveActiveModel({
    activeProviderId,
    activeProviderModels: activeProvider?.models,
    activeProviderDefaultModel: activeProvider?.defaultModel,
    pendingModel,
    kodaxDefaultsProvider: kodaxDefaults?.provider,
    kodaxDefaultsModel: kodaxDefaults?.model,
  });
  const activeModel = session
    ? (session.model ?? activeProvider?.defaultModel ?? null)
    : preferredModel !== '—'
      ? preferredModel
      : null;
  const contextBudget =
    rawContextBudget &&
    (!rawContextBudget.provider || rawContextBudget.provider === activeProviderId) &&
    (!rawContextBudget.model || rawContextBudget.model === activeModel)
      ? rawContextBudget
      : undefined;
  const hardcodedCap = getModelContextCap(activeModel);
  const resolvedWindow = useResolvedContextWindow(activeProviderId, activeModel, hardcodedCap);
  const cap = resolvedWindow.contextWindow;
  const triggerPercent = resolvedWindow.triggerPercent;
  const percentageThreshold = Math.max(1, Math.floor((cap * triggerPercent) / 100));
  const configuredThreshold =
    resolvedWindow.triggerTokens && resolvedWindow.triggerTokens > 0
      ? Math.min(percentageThreshold, resolvedWindow.triggerTokens)
      : percentageThreshold;
  const autoCompactThreshold = resolvedWindow.effectiveTriggerTokens ?? configuredThreshold;

  const inputReading = resolveActiveInputReading(
    tokenInfo
      ? {
          tokens: tokenInfo.tokens,
          contextId: tokenInfo.contextId,
          contextRevision: tokenInfo.contextRevision,
          observedOrder: tokenInfo.observedOrder,
        }
      : undefined,
    contextBudget
      ? {
          total: contextBudget.tokenBreakdown.total,
          reservedResponse: contextBudget.tokenBreakdown.reservedResponse,
          contextId: contextBudget.contextId,
          contextRevision: contextBudget.contextRevision,
          observedOrder: contextBudget.observedOrder,
        }
      : undefined,
  );
  const tokenCount = inputReading.tokens;
  const activeContextBudget = inputReading.budgetTokens !== undefined ? contextBudget : undefined;
  const providerReportedTokens = resolveProviderReportedTokens(
    inputReading,
    tokenInfo?.source,
    tokenInfo?.tokenSource,
  );
  const lastCompaction = tokenInfo?.lastCompaction;
  const compactionSourceLabel =
    lastCompaction?.source === 'manual'
      ? t('contextWindow.compactionSource.manual')
      : lastCompaction?.source === 'automatic_threshold'
        ? t('contextWindow.compactionSource.automatic')
        : lastCompaction?.source === 'physical_capacity'
          ? t('contextWindow.compactionSource.capacity')
          : null;
  const compactionDuration =
    lastCompaction?.elapsedMs !== undefined
      ? `${(lastCompaction.elapsedMs / 1_000).toFixed(1)}s`
      : null;
  const isEstimate = isEstimatedContextInput(
    inputReading.source,
    tokenInfo?.source,
    tokenInfo?.tokenSource,
  );
  const autoCompactPercent = (tokenCount / autoCompactThreshold) * 100;
  const displayPercent = Math.min(100, autoCompactPercent);
  // Runtime budget 和历史恢复都属于 estimate — 加 "≈" 前缀让用户知道是近似。
  const tokenStr = `${isEstimate ? '≈' : ''}${formatTokens(tokenCount)}`;
  const capStr = formatTokens(cap);
  const thresholdStr = formatTokens(autoCompactThreshold);
  const remainingPercent = Math.max(0, 100 - displayPercent);
  const remainingTokenCount = Math.max(0, autoCompactThreshold - tokenCount);
  const exceededTokenCount = Math.max(0, tokenCount - autoCompactThreshold);
  const thresholdExceeded = tokenCount > autoCompactThreshold;
  const thresholdReached = tokenCount >= autoCompactThreshold;
  const inputSourceLabel = isEstimate
    ? t('contextWindow.estimatedRequestInput')
    : t('contextWindow.currentContextInput');
  const progressStatus = compacting
    ? thresholdExceeded
      ? t('contextWindow.compactingExceeded', { tokens: formatTokens(exceededTokenCount) })
      : t('contextWindow.compacting')
    : thresholdExceeded
      ? t('contextWindow.thresholdExceeded', { tokens: formatTokens(exceededTokenCount) })
      : thresholdReached
        ? t('contextWindow.thresholdReached')
        : t('contextWindow.remainingTokens', { tokens: formatTokens(remainingTokenCount) });
  const sessionTotalTokens = sessionUsage
    ? Math.min(Number.MAX_SAFE_INTEGER, sessionUsage.inputTokens + sessionUsage.outputTokens)
    : undefined;
  const cachedInputTokens = sessionUsage?.cacheReadInputTokens;
  const cacheWriteTokens = sessionUsage?.cacheWriteInputTokens;
  const regularInputTokens = sessionUsage
    ? Math.max(0, sessionUsage.inputTokens - (cachedInputTokens ?? 0) - (cacheWriteTokens ?? 0))
    : undefined;
  const aggregateCacheHitPercent =
    sessionUsage && cachedInputTokens !== undefined && sessionUsage.inputTokens > 0
      ? (cachedInputTokens / sessionUsage.inputTokens) * 100
      : undefined;
  const latestCacheHitPercent =
    latestProviderCacheDiagnostic?.cacheReadInputTokens !== undefined &&
    latestProviderCacheDiagnostic.inputTokens !== undefined &&
    latestProviderCacheDiagnostic.inputTokens > 0
      ? (latestProviderCacheDiagnostic.cacheReadInputTokens /
          latestProviderCacheDiagnostic.inputTokens) *
        100
      : undefined;
  const childProviderCallCount = sessionUsage?.childSampleCount ?? 0;
  const rootProviderCallCount = sessionUsage
    ? Math.max(0, sessionUsage.sampleCount - childProviderCallCount)
    : 0;
  const inputCompositionRows = activeContextBudget
    ? [
        {
          key: 'system',
          label: t('contextWindow.breakdown.systemPrompt'),
          tokens: activeContextBudget.tokenBreakdown.systemPrompt,
          color: 'rgb(var(--context-system))',
        },
        {
          key: 'tools',
          label: t('contextWindow.breakdown.toolSchemas'),
          tokens: activeContextBudget.tokenBreakdown.toolSchemas,
          color: 'rgb(var(--context-tools))',
        },
        {
          key: 'skills',
          label: t('contextWindow.breakdown.skillCatalog'),
          tokens:
            activeContextBudget.tokenBreakdown.skillCatalog +
            activeContextBudget.tokenBreakdown.mcpCatalog,
          color: 'rgb(var(--context-skills))',
        },
        {
          key: 'transcript',
          label: t('contextWindow.breakdown.transcript'),
          tokens: activeContextBudget.tokenBreakdown.transcript,
          color: 'rgb(var(--context-transcript))',
        },
        {
          key: 'pending',
          label: t('contextWindow.breakdown.pendingInput'),
          tokens: activeContextBudget.tokenBreakdown.pendingInput,
          color: 'rgb(var(--context-request))',
        },
        {
          key: 'results',
          label: t('contextWindow.breakdown.recentToolResults'),
          tokens: activeContextBudget.tokenBreakdown.recentToolResults,
          color: 'rgb(var(--context-results))',
        },
      ]
    : [];

  const gaugeTone = remainingPercent <= 20 ? 'danger' : remainingPercent <= 40 ? 'warn' : 'ok';
  const toneClass =
    gaugeTone === 'ok' ? 'text-ok' : gaugeTone === 'warn' ? 'text-warn' : 'text-danger';
  const barColor = gaugeTone === 'ok' ? 'bg-ok' : gaugeTone === 'warn' ? 'bg-warn' : 'bg-danger';
  const gaugeStyle: ContextGaugeStyle = {
    '--cw-level':
      gaugeTone === 'ok'
        ? 'rgb(var(--ok))'
        : gaugeTone === 'warn'
          ? 'rgb(var(--warn))'
          : 'rgb(var(--danger))',
    '--cw-level-dim':
      gaugeTone === 'ok'
        ? 'rgb(var(--ok) / 0.7)'
        : gaugeTone === 'warn'
          ? 'rgb(var(--warn) / 0.68)'
          : 'rgb(var(--danger) / 0.68)',
    '--cw-level-glow':
      gaugeTone === 'ok'
        ? 'rgb(var(--ok) / 0.34)'
        : gaugeTone === 'warn'
          ? 'rgb(var(--warn) / 0.36)'
          : 'rgb(var(--danger) / 0.44)',
    '--cw-level-height': `${remainingPercent}%`,
  };
  const contextLabel = currentSessionId ? t('contextWindow.title') : t('contextWindow.title.next');
  const tooltip = thresholdReached
    ? t('contextWindow.tooltipAtThreshold', {
        label: contextLabel,
        percent: autoCompactPercent.toFixed(1),
        used: tokenStr,
        threshold: thresholdStr,
      })
    : t('contextWindow.tooltip', {
        label: contextLabel,
        percent: remainingPercent.toFixed(0),
        used: tokenStr,
        threshold: thresholdStr,
      });
  const sessionUsageTooltip = currentSessionId
    ? t('sessionTokens.tooltip', {
        total: sessionTotalTokens === undefined ? '—' : formatTokens(sessionTotalTokens),
      })
    : '';

  useEffect(() => {
    setContextOpen(false);
    setSessionUsageOpen(false);
  }, [currentSessionId]);

  return (
    <div className="relative flex items-center gap-1">
      <button
        type="button"
        data-testid="context-window-indicator"
        onClick={() => {
          setContextOpen((value) => !value);
          setSessionUsageOpen(false);
        }}
        className={[
          'relative w-9 h-9 p-1 rounded-full border border-border-default/70 bg-transparent flex items-center justify-center shadow-sm',
          'hover:bg-hover-bg hover:text-fg-primary transition-colors',
          toneClass,
        ].join(' ')}
        title={`${tooltip} - ${t('contextWindow.clickForBreakdown')}`}
        aria-label={tooltip}
      >
        <span className="sr-only">{contextLabel}</span>
        <span aria-hidden className="context-liquid-gauge h-7 w-7" style={gaugeStyle}>
          <span className="context-liquid-gauge__fill" />
          <span className="context-liquid-gauge__surface" />
          <span className="context-liquid-gauge__wave" />
        </span>
      </button>

      {currentSessionId && (
        <button
          type="button"
          data-testid="session-token-indicator"
          onClick={() => {
            setSessionUsageOpen((value) => !value);
            setContextOpen(false);
          }}
          className={[
            'session-token-indicator h-9 pl-1.5 pr-2.5 rounded-full border border-border-default/70 shadow-sm',
            'flex items-center justify-center gap-1.5 font-mono text-[10px] leading-none text-fg-secondary whitespace-nowrap',
            'hover:text-fg-primary transition-colors',
          ].join(' ')}
          title={`${sessionUsageTooltip} - ${t('contextWindow.clickForBreakdown')}`}
          aria-label={sessionUsageTooltip}
        >
          <TokenUsageGlyph
            regularInputTokens={regularInputTokens}
            cachedInputTokens={cachedInputTokens}
            outputTokens={sessionUsage?.outputTokens}
            cacheWriteTokens={cacheWriteTokens}
          />
          <span
            key={sessionTotalTokens ?? 'unavailable'}
            data-testid="session-token-total"
            className="session-token-total relative z-[1]"
          >
            {sessionTotalTokens === undefined ? '—' : formatTokens(sessionTotalTokens)}
          </span>
        </button>
      )}

      {contextOpen && (
        <div
          data-testid="context-window-breakdown"
          className="context-window-popover absolute right-0 bottom-full mb-2 w-[24rem] max-w-[calc(100vw-2rem)] max-h-[min(70vh,36rem)] overflow-y-auto bg-surface-4 border border-border-default rounded-xl shadow-xl p-3.5 text-xs z-50"
          onMouseLeave={() => setContextOpen(false)}
        >
          <div className="flex items-center gap-2 text-fg-muted text-[11px] font-medium mb-2.5">
            <span>{contextLabel}</span>
            <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${barColor}`} />
          </div>

          <div className="mb-2 flex items-end justify-between gap-3">
            <div>
              <div className="mb-1 text-[9px] leading-none text-fg-muted">{inputSourceLabel}</div>
              <div className="font-mono leading-none">
                <span
                  data-testid="context-primary-input"
                  className="text-[18px] font-semibold text-fg-primary"
                >
                  {tokenStr}
                </span>
                <span className="ml-2 text-[13px] text-fg-muted">/ {thresholdStr}</span>
              </div>
            </div>
            <span className={`font-mono text-[13px] font-medium leading-none ${toneClass}`}>
              {autoCompactPercent.toFixed(1)}%
            </span>
          </div>

          <div
            data-testid="context-effective-window-bar"
            className="context-effective-window-bar flex h-2.5 overflow-hidden rounded-full bg-surface-3"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={autoCompactThreshold}
            aria-valuenow={Math.min(tokenCount, autoCompactThreshold)}
            aria-label={t('contextWindow.progressToAutoCompact', {
              percent: autoCompactPercent.toFixed(1),
            })}
          >
            {activeContextBudget ? (
              inputCompositionRows.map((row) => (
                <div
                  key={row.key}
                  className="context-effective-window-segment"
                  title={`${row.label}: ${row.tokens.toLocaleString()} (${formatPercent(
                    row.tokens,
                    autoCompactThreshold,
                  )})`}
                  style={{
                    width: `${Math.min(100, (row.tokens / autoCompactThreshold) * 100)}%`,
                    minWidth: row.tokens > 0 ? '1px' : undefined,
                    backgroundColor: row.color,
                  }}
                />
              ))
            ) : (
              <div
                className={`context-effective-window-segment ${barColor}`}
                style={{ width: `${displayPercent}%` }}
              />
            )}
          </div>

          <div
            data-testid="context-threshold-status"
            className={`mt-2 text-[11px] ${thresholdReached || compacting ? 'text-danger' : 'text-fg-muted'}`}
          >
            {progressStatus}
          </div>
          {providerReportedTokens !== undefined && (
            <div data-testid="context-provider-reported" className="mt-1 text-[10px] text-fg-muted">
              {t('contextWindow.providerReported', {
                tokens: formatTokens(providerReportedTokens),
              })}
            </div>
          )}

          <div className="mt-3 border-t border-border-default pt-3">
            <div className="mb-2 text-[11px] font-medium text-fg-secondary">
              {t('contextWindow.composition')}
            </div>
            {activeContextBudget ? (
              <div data-testid="context-composition">
                <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
                  {inputCompositionRows.map((row) => (
                    <div
                      key={row.key}
                      data-testid={`context-composition-row-${row.key}`}
                      className="min-w-0 flex items-center gap-1.5 text-[10px]"
                    >
                      <span
                        aria-hidden
                        className="w-1.5 h-1.5 rounded-full shrink-0"
                        style={{ backgroundColor: row.color }}
                      />
                      <span className="truncate text-fg-muted">{row.label}</span>
                      <span className="ml-auto font-mono text-fg-secondary whitespace-nowrap">
                        {formatTokens(row.tokens)} ·{' '}
                        {formatPercent(row.tokens, autoCompactThreshold)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="text-[10px] text-fg-muted leading-relaxed">
                {t('contextWindow.compositionUnavailable')}
              </div>
            )}
          </div>

          <div
            data-testid="context-window-facts"
            className="context-window-facts mt-3 grid grid-cols-2 divide-x divide-border-default rounded-lg border border-border-default/60"
          >
            <div className="min-w-0 px-2.5 py-2">
              <div className="text-[9px] text-fg-muted">{t('contextWindow.modelMaximum')}</div>
              <div className="mt-0.5 font-mono text-[11px] text-fg-primary">{capStr}</div>
            </div>
            <div className="min-w-0 px-2.5 py-2">
              <div className="text-[9px] text-fg-muted">
                {t('contextWindow.autoCompactThreshold')}
              </div>
              <div className="mt-0.5 font-mono text-[11px] text-fg-primary">{thresholdStr}</div>
            </div>
          </div>

          <div className="mt-2.5 border-t border-border-default pt-2 text-[11px] text-fg-muted leading-relaxed">
            <div>{t('contextWindow.activeInputNote')}</div>
            {lastCompaction && (
              <div className="mt-1 text-fg-secondary">
                {lastCompaction.committed
                  ? t('contextWindow.lastCompaction', {
                      before: formatTokens(lastCompaction.tokensBefore),
                      after: formatTokens(lastCompaction.tokensAfter),
                    })
                  : t('contextWindow.lastCompactionUnchanged', {
                      tokens: formatTokens(lastCompaction.tokensAfter),
                    })}
                {(compactionSourceLabel || compactionDuration) && (
                  <span className="text-fg-muted">
                    {' · '}
                    {[compactionSourceLabel, compactionDuration].filter(Boolean).join(' · ')}
                  </span>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {sessionUsageOpen && currentSessionId && (
        <div
          data-testid="session-token-breakdown"
          className="absolute right-0 bottom-full mb-2 w-72 max-w-[calc(100vw-2rem)] bg-surface-4 border border-border-default rounded-lg shadow-xl p-3 text-xs z-50"
          onMouseLeave={() => setSessionUsageOpen(false)}
        >
          <div className="flex items-center justify-between gap-3 mb-2">
            <div className="text-[11px] font-medium text-fg-secondary">
              {t('sessionTokens.title')}
            </div>
            <div className="font-mono text-[11px] text-fg-secondary">
              {t('sessionTokens.total')}:{' '}
              <span className="text-fg-primary">
                {sessionTotalTokens === undefined ? '—' : sessionTotalTokens.toLocaleString()}
              </span>
            </div>
          </div>
          {sessionUsage ? (
            <>
              <div className="mb-2 rounded-md border border-border-default/60 bg-surface-3/45 px-2 py-1.5">
                <div className="text-[10px] leading-relaxed text-fg-secondary">
                  {t('sessionTokens.scope')}
                </div>
                <div
                  data-testid="session-token-call-scope"
                  className="mt-0.5 font-mono text-[9px] text-fg-muted"
                >
                  {t('sessionTokens.callBreakdown', {
                    root: rootProviderCallCount,
                    child: childProviderCallCount,
                  })}
                </div>
                <div
                  data-testid="session-token-input-total"
                  className="mt-1 flex items-center justify-between border-t border-border-default/40 pt-1 text-[10px]"
                >
                  <span className="text-fg-secondary">{t('sessionTokens.inputTotal')}</span>
                  <span className="font-mono text-fg-primary">
                    {sessionUsage.inputTokens.toLocaleString()}
                  </span>
                </div>
              </div>
              <div
                className={[
                  'grid gap-1.5',
                  cacheWriteTokens === undefined ? 'grid-cols-3' : 'grid-cols-2',
                ].join(' ')}
              >
                <TokenUsageCell
                  label={
                    cachedInputTokens === undefined && cacheWriteTokens === undefined
                      ? t('sessionTokens.input')
                      : t('sessionTokens.freshInput')
                  }
                  tokens={regularInputTokens ?? 0}
                  color="rgb(var(--info))"
                />
                <TokenUsageCell
                  label={t('sessionTokens.cachedInput')}
                  tokens={cachedInputTokens}
                  color="rgb(var(--ok))"
                />
                <TokenUsageCell
                  label={t('sessionTokens.output')}
                  tokens={sessionUsage.outputTokens}
                  color="rgb(var(--accent))"
                />
                {cacheWriteTokens !== undefined && (
                  <TokenUsageCell
                    label={t('sessionTokens.cacheWrite')}
                    tokens={cacheWriteTokens}
                    color="rgb(var(--warn))"
                  />
                )}
              </div>
              {cacheWriteTokens !== undefined && (
                <div className="mt-1.5 text-[10px] text-fg-muted">
                  {t('sessionTokens.cacheWriteNote', {
                    tokens: cacheWriteTokens.toLocaleString(),
                  })}
                </div>
              )}
              {(aggregateCacheHitPercent !== undefined || latestCacheHitPercent !== undefined) && (
                <div
                  data-testid="session-token-cache-rates"
                  className="mt-1.5 rounded-md border border-ok/40 bg-ok/10 px-2.5 py-2"
                >
                  <div className="flex items-center gap-1.5 text-[10px] font-medium text-fg-secondary">
                    <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-ok" />
                    {t('sessionTokens.cacheHitRateTitle')}
                  </div>
                  <div className="mt-1.5 flex items-end gap-4">
                    <CacheRateStat
                      testId="session-token-cache-rate-aggregate"
                      label={t('sessionTokens.cacheHitAggregate')}
                      value={aggregateCacheHitPercent}
                    />
                    <CacheRateStat
                      testId="session-token-cache-rate-latest"
                      label={t('sessionTokens.cacheHitLatest')}
                      value={latestCacheHitPercent}
                    />
                  </div>
                </div>
              )}
              <div className="mt-1.5 text-[10px] leading-relaxed text-fg-muted">
                {t('sessionTokens.providerComparabilityNote')}
              </div>
              {latestProviderCacheDiagnostic && (
                <div className="mt-1 text-[10px] text-fg-muted">
                  {t('sessionTokens.latestProviderCall', {
                    provider: latestProviderCacheDiagnostic.provider,
                    model:
                      latestProviderCacheDiagnostic.wireModel ??
                      latestProviderCacheDiagnostic.model,
                    count: latestProviderCacheDiagnostic.messagePrefixCount,
                  })}
                </div>
              )}
              {latestProviderCacheDiagnostic?.promptCacheAffinityHash && (
                <div
                  data-testid="session-token-cache-affinity"
                  className="mt-1 text-[10px] text-fg-muted"
                >
                  {t('sessionTokens.cacheAffinityActive')}
                </div>
              )}
              <div className="mt-1.5 text-[10px] text-fg-muted">
                {t(
                  sessionUsage.accountingSource === 'provider_diagnostic'
                    ? 'sessionTokens.providerDiagnosticNote'
                    : 'sessionTokens.iterationFallbackNote',
                  {
                    count: sessionUsage.sampleCount,
                  },
                )}
              </div>
            </>
          ) : (
            <div className="text-[10px] text-fg-muted">{t('sessionTokens.unavailable')}</div>
          )}
        </div>
      )}
    </div>
  );
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function formatPercent(tokens: number, total: number): string {
  if (total <= 0 || tokens <= 0) return '0%';
  const percent = (tokens / total) * 100;
  return percent < 0.1 ? '<0.1%' : `${percent.toFixed(1)}%`;
}

function TokenUsageGlyph({
  regularInputTokens,
  cachedInputTokens,
  outputTokens,
  cacheWriteTokens,
}: {
  readonly regularInputTokens: number | undefined;
  readonly cachedInputTokens: number | undefined;
  readonly outputTokens: number | undefined;
  readonly cacheWriteTokens: number | undefined;
}): JSX.Element {
  const categories = [
    { tokens: regularInputTokens ?? 0, color: 'rgb(var(--info))' },
    { tokens: cachedInputTokens ?? 0, color: 'rgb(var(--ok))' },
    { tokens: outputTokens ?? 0, color: 'rgb(var(--accent))' },
    { tokens: cacheWriteTokens ?? 0, color: 'rgb(var(--warn))' },
  ];
  const measuredTotal = categories.reduce((sum, category) => sum + category.tokens, 0);
  let angle = 0;
  const stops =
    measuredTotal > 0
      ? categories.flatMap((category) => {
          if (category.tokens <= 0) return [];
          const start = angle;
          angle += (category.tokens / measuredTotal) * 360;
          return [`${category.color} ${start.toFixed(2)}deg ${angle.toFixed(2)}deg`];
        })
      : ['rgb(var(--fg-muted) / 0.42) 0deg 360deg'];

  return (
    <span aria-hidden className="token-usage-orbit relative z-[1]">
      <span
        className="token-usage-orbit__ring"
        style={{ background: `conic-gradient(from -36deg, ${stops.join(', ')})` }}
      />
      <svg
        className="token-usage-orbit__coin"
        viewBox="0 0 16 16"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <ellipse cx="8" cy="5" rx="4.25" ry="2.1" />
        <path d="M3.75 5v3c0 1.16 1.9 2.1 4.25 2.1s4.25-.94 4.25-2.1V5" />
        <path d="M3.75 8v3c0 1.16 1.9 2.1 4.25 2.1s4.25-.94 4.25-2.1V8" />
      </svg>
    </span>
  );
}

function CacheRateStat({
  label,
  value,
  testId,
}: {
  readonly label: string;
  readonly value: number | undefined;
  readonly testId: string;
}): JSX.Element {
  return (
    <div className="min-w-0" data-testid={testId}>
      <div className="font-mono text-[15px] leading-none font-semibold text-fg-primary">
        {value === undefined ? '—' : `${value.toFixed(1)}%`}
      </div>
      <div className="mt-1 text-[9px] leading-none text-fg-muted">{label}</div>
    </div>
  );
}

function TokenUsageCell({
  label,
  tokens,
  color,
}: {
  readonly label: string;
  readonly tokens: number | undefined;
  readonly color: string;
}): JSX.Element {
  return (
    <div className="rounded-md bg-surface-3/70 px-2 py-1.5 min-w-0">
      <div className="flex items-center gap-1 text-[9px] text-fg-muted truncate">
        <span
          aria-hidden
          className="w-1.5 h-1.5 rounded-full shrink-0"
          style={{ backgroundColor: color }}
        />
        <span className="truncate">{label}</span>
      </div>
      <div className="mt-0.5 font-mono text-[11px] text-fg-primary">
        {tokens === undefined ? '—' : formatTokens(tokens)}
      </div>
    </div>
  );
}
