// ContextWindowIndicator — alpha.2
//
// Claude Desktop 截图 9：底部输入框右侧 `Context window  96.1k / 200k (48%) ›`，
// 点击 › 展开 breakdown 弹窗，含进度条 + 分项 token 占用。
//
// 数据来源：
//   - tokenCount: iteration_end 事件的 tokenCount（最近一条）
//   - cap: 走 SDK driven IPC `provider.modelContextWindow`，按 (providerId, model) 缓存
//     —— SDK 内部 resolveContextWindow 四步级联（user override → provider per-model →
//     provider default → 200k hard fallback），UI 用同一函数 = single source of truth
//   - 历史 fallback: 查询期间 / IPC 失败时仍用 modelContextCaps 硬编码表兜底，避免空窗显示

import { useEffect, useState, type CSSProperties } from 'react';
import { useI18n } from '../i18n/I18nProvider.js';
import { useAppStore } from '../store/appStore.js';
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

interface ResolvedContextWindow {
  readonly contextWindow: number;
  readonly triggerPercent: number;
  readonly triggerTokens?: number;
}

/** 后台查 SDK 拿 contextWindow + cache; UI 同步 fallback 到硬编码表先渲染避免抖动。*/
function useResolvedContextWindow(
  providerId: string | null,
  model: string | null,
  hardcodedFallback: number,
): ResolvedContextWindow {
  const [configRevision, setConfigRevision] = useState(0);
  const [resolved, setResolved] = useState<ResolvedContextWindow>({
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
        // source === 'fallback' 表示 SDK 没真正拿到 provider-advertised window
        // (常见原因：该 provider 没配 API key,resolveProvider 直接 throw)。
        // 此时不要信 SDK 给的 200k——回退到 renderer 端 hardcoded table，因为它至少
        // 有按 model 名前缀的真实信息 (gpt-5 → 1M、deepseek-v3.2 → 1M).
        let value: number;
        let triggerPercent = DEFAULT_COMPACTION_TRIGGER_PERCENT;
        let triggerTokens: number | undefined;
        if (!r.ok) {
          value = hardcodedFallback;
        } else if (r.data.source === 'fallback') {
          value = hardcodedFallback;
          triggerPercent = r.data.compactionTriggerPercent;
          triggerTokens = r.data.compactionTriggerTokens;
        } else {
          value = r.data.contextWindow > 0 ? r.data.contextWindow : hardcodedFallback;
          triggerPercent = r.data.compactionTriggerPercent;
          triggerTokens = r.data.compactionTriggerTokens;
        }
        setResolved({ contextWindow: value, triggerPercent, triggerTokens });
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

export function ContextWindowIndicator(): JSX.Element | null {
  const { t } = useI18n();
  const currentSessionId = useAppStore((s) => s.currentSessionId);
  const tokenInfo = useAppStore((s) =>
    currentSessionId ? s.tokensBySession[currentSessionId] : undefined,
  );
  // 当前 active model — session 优先；无 session 时用 pendingModel / kodaxDefaults / provider 默认
  const sessions = useAppStore((s) => s.sessions);
  const providers = useAppStore((s) => s.providers);
  const defaultProviderId = useAppStore((s) => s.defaultProviderId);
  const kodaxDefaults = useAppStore((s) => s.kodaxDefaults);
  const pendingProviderId = useAppStore((s) => s.pendingProviderId);
  const pendingModel = useAppStore((s) => s.pendingModel);
  const [open, setOpen] = useState(false);

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
  const hardcodedCap = getModelContextCap(activeModel);
  const resolvedWindow = useResolvedContextWindow(activeProviderId, activeModel, hardcodedCap);
  const cap = resolvedWindow.contextWindow;
  const triggerPercent = resolvedWindow.triggerPercent;
  const percentageThreshold = Math.max(1, Math.round((cap * triggerPercent) / 100));
  const autoCompactThreshold =
    resolvedWindow.triggerTokens && resolvedWindow.triggerTokens > 0
      ? Math.min(percentageThreshold, resolvedWindow.triggerTokens)
      : percentageThreshold;

  const tokenCount = tokenInfo?.tokens ?? 0;
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
  const isEstimate = tokenInfo?.source === 'estimate';
  const autoCompactPercent = (tokenCount / autoCompactThreshold) * 100;
  const displayPercent = Math.min(100, autoCompactPercent);
  // 历史恢复时是 estimate（无 iteration_end）— 加 "~" 前缀让用户知道是近似
  const tokenStr = `${isEstimate ? '~' : ''}${formatTokens(tokenCount)}`;
  const capStr = formatTokens(cap);
  const thresholdStr = formatTokens(autoCompactThreshold);
  const remainingPercent = Math.max(0, 100 - displayPercent);
  const remainingTokenCount = Math.max(0, autoCompactThreshold - tokenCount);

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
  const tooltip = t('contextWindow.tooltip', {
    label: contextLabel,
    percent: remainingPercent.toFixed(0),
    used: tokenStr,
    threshold: thresholdStr,
  });

  return (
    <div className="relative">
      <button
        type="button"
        data-testid="context-window-indicator"
        onClick={() => setOpen((v) => !v)}
        className={[
          'relative w-9 h-9 rounded-full border border-border-default/70 bg-transparent flex items-center justify-center shadow-sm',
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

      {open && (
        <div
          className="absolute right-0 bottom-full mb-2 w-72 bg-surface-4 border border-border-default rounded-lg shadow-xl p-3 text-xs z-50"
          onMouseLeave={() => setOpen(false)}
        >
          <div className="text-fg-muted text-[11px] font-medium mb-2">{contextLabel}</div>
          {/* 顶部数字 */}
          <div className="flex justify-between text-fg-primary font-mono mb-1.5">
            <span>{tokenStr}</span>
            <span className="text-fg-muted">/ {thresholdStr}</span>
          </div>
          {/* 进度条 */}
          <div className="h-1.5 bg-surface-3 rounded overflow-hidden">
            <div
              className={`h-full ${barColor} transition-all`}
              style={{ width: `${displayPercent}%` }}
            />
          </div>
          {/* 百分比 + 注释 */}
          <div className="mt-2 text-[11px] text-fg-muted flex justify-between">
            <span>
              {t('contextWindow.progressToAutoCompact', {
                percent: autoCompactPercent.toFixed(1),
              })}
            </span>
            <span>
              {t('contextWindow.remainingTokens', { tokens: formatTokens(remainingTokenCount) })}
            </span>
          </div>

          <div className="mt-3 border-t border-border-default pt-2 text-[11px] text-fg-muted leading-relaxed">
            {t('contextWindow.thresholdNote', {
              triggerPercent,
              cap: capStr,
              threshold: thresholdStr,
              model: activeModel ? ` (${activeModel})` : '',
            })}
            <div className="mt-1">{t('contextWindow.activeInputNote')}</div>
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
    </div>
  );
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}
