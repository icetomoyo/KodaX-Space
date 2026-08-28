// ModelEffortSelector — alpha.2
//
// 右下角 chip → 弹出 "二级" picker。布局采用 2 列同框（用户讨论决定的方案 A —
// 比 hover 子菜单不易误关、信息一眼全收）：
//
//   ┌────────────────────────────────────────┐
//   │ PROVIDER          │ MODEL              │
//   │   Zhipu Coding ✓  │   glm-5            │
//   │   Anthropic       │   glm-5.1     ✓    │
//   │   Volcengine Ark  │   glm-5-turbo      │
//   │   ...             │                    │
//   ├────────────────────────────────────────┤
//   │ EFFORT  ⇧Ctrl E                        │
//   │   Low / Medium ✓ / High / Extra / Max  │
//   └────────────────────────────────────────┘
//
// 点 provider → 右列即时刷新成那个 provider 的 models 列表（无需 hover）。
// 点 model → 一次性把 provider + model 都 commit 给 store / session。
// model 应用方式：
//   - 有 session：session.setProvider 切 provider；model 通过 /model <name> slash 命令 fire-and-forget
//     （main 端已有 slash registry; KodaX REPL 的 /model 标准做法）
//   - 无 session：pendingProviderId + pendingModel 暂存；下次 ensureSession 时一起设
//
// Ctrl+I 切换打开；底部 effort 块保持以前用法。

import { useEffect, useState } from 'react';
import { BrainCircuit, ChevronDown } from 'lucide-react';
import type { ProviderInfo, SessionMeta } from '@kodax-space/space-ipc-schema';
import { useAppStore } from '../store/appStore.js';
import { pushToast } from '../store/toastStore.js';
import { useI18n } from '../i18n/I18nProvider.js';
import { setSpaceReasoningDefault } from '../space-control/semanticActions.js';
import type { MessageKey } from '../i18n/messages.js';
import { resolveActiveModel } from './resolveActiveModel.js';
import { sdkEffortToReasoningMode, visibleEffortLadder } from './effortLadder.js';

// Re-export the pure ladder helpers (kept as this module's public API; logic lives in effortLadder.ts).
export { sdkEffortToReasoningMode, visibleEffortLadder };

type ReasoningMode = SessionMeta['reasoningMode'];
type Translate = (key: MessageKey, vars?: Record<string, string | number>) => string;

const EFFORT_LABEL_KEYS: Readonly<Record<string, MessageKey>> = {
  off: 'modelPicker.effort.off',
  auto: 'modelPicker.effort.auto',
  minimal: 'modelPicker.effort.minimal',
  low: 'modelPicker.effort.low',
  medium: 'modelPicker.effort.medium',
  high: 'modelPicker.effort.high',
  xhigh: 'modelPicker.effort.xhigh',
  max: 'modelPicker.effort.max',
  quick: 'modelPicker.effort.quick',
  balanced: 'modelPicker.effort.balanced',
  deep: 'modelPicker.effort.deep',
};

function effortLabel(mode: ReasoningMode, t: Translate): string {
  const key = EFFORT_LABEL_KEYS[mode];
  return key ? t(key) : mode;
}

export function ModelEffortSelector(): JSX.Element {
  const { t } = useI18n();
  const sessions = useAppStore((s) => s.sessions);
  const currentSessionId = useAppStore((s) => s.currentSessionId);
  const providers = useAppStore((s) => s.providers);
  const defaultProviderId = useAppStore((s) => s.defaultProviderId);
  const kodaxDefaults = useAppStore((s) => s.kodaxDefaults);
  const runtimeDefaults = useAppStore((s) => s.runtimeDefaults);
  const pendingProviderId = useAppStore((s) => s.pendingProviderId);
  const pendingReasoningMode = useAppStore((s) => s.pendingReasoningMode);
  const pendingModel = useAppStore((s) => s.pendingModel);
  const setPendingProviderId = useAppStore((s) => s.setPendingProviderId);
  const setPendingReasoningMode = useAppStore((s) => s.setPendingReasoningMode);
  const setPendingModel = useAppStore((s) => s.setPendingModel);
  const setDefaultProviderId = useAppStore((s) => s.setDefaultProviderId);
  const setRuntimeDefaults = useAppStore((s) => s.setRuntimeDefaults);
  const upsertSession = useAppStore((s) => s.upsertSession);

  const session = sessions.find((x) => x.sessionId === currentSessionId);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  // 右列展示哪个 provider 的 models — 默认跟随 active provider；
  // 用户在左列点别的 provider 时只改这个，不立即 commit (等点 model 才 commit)。
  const [previewProviderId, setPreviewProviderId] = useState<string | null>(null);
  // Per-model reasoning ladder from the SDK (resolveModelCapabilities), kept warm
  // for the active model so keyboard cycling is correct even while the picker is closed.
  // null → not yet known (stable fallback ladder shown).
  const [modelEfforts, setModelEfforts] = useState<{
    readonly supportedEfforts?: readonly string[];
    readonly defaultEffort?: string;
    readonly canDisableThinking?: boolean;
  } | null>(null);

  // Ctrl+I 打开/关闭
  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (e.ctrlKey && !e.shiftKey && !e.altKey && !e.metaKey && e.key.toLowerCase() === 'i') {
        e.preventDefault();
        setOpen((v) => !v);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // 当前 active provider/model/effort（用 session > pending > defaults）
  const activeProviderId =
    session?.provider ?? pendingProviderId ?? defaultProviderId ?? kodaxDefaults?.provider ?? null;
  const activeProvider: ProviderInfo | undefined = activeProviderId
    ? providers.find((p) => p.id === activeProviderId)
    : undefined;
  // Preference/default model is only a preview source. For an active session,
  // runtime session.model is authoritative; when it is unset the SDK will use
  // the provider default, regardless of pendingModel or KodaX config defaults.
  const preferredModel: string = resolveActiveModel({
    activeProviderId,
    activeProviderModels: activeProvider?.models,
    activeProviderDefaultModel: activeProvider?.defaultModel,
    pendingModel,
    kodaxDefaultsProvider: kodaxDefaults?.provider,
    kodaxDefaultsModel: kodaxDefaults?.model,
  });
  const runtimeModel = session ? (session.model ?? activeProvider?.defaultModel ?? '—') : undefined;
  const activeModel = runtimeModel ?? preferredModel;
  const configuredEffort: ReasoningMode =
    session?.reasoningMode ??
    pendingReasoningMode ??
    runtimeDefaults.reasoningMode ??
    kodaxDefaults?.reasoningMode ??
    'auto';
  const activeEffort = sdkEffortToReasoningMode(configuredEffort) ?? 'auto';

  // Effort ladder built from the active model's SDK-declared efforts (falls back
  // to a stable fallback ladder when unknown). The model's own default rung is
  // annotated so the user can see "what this model prefers".
  const visibleEfforts = visibleEffortLadder(
    modelEfforts?.supportedEfforts,
    modelEfforts?.canDisableThinking ?? false,
  );
  const modelDefaultMode = modelEfforts?.defaultEffort
    ? sdkEffortToReasoningMode(modelEfforts.defaultEffort)
    : null;

  // 右列正在预览的 provider — 打开时初始化为 active；用户左列点别的就更新 preview
  const previewProvider = providers.find((p) => p.id === (previewProviderId ?? activeProviderId));
  const previewModels =
    previewProvider?.models ??
    (previewProvider?.defaultModel ? [previewProvider.defaultModel] : []);

  const configuredProviders = providers
    .filter((p) => p.configured)
    .slice()
    .sort((a, b) => a.id.localeCompare(b.id));

  async function commitProviderAndModel(providerId: string, model: string): Promise<void> {
    if (busy) return;
    setBusy(true);
    try {
      if (session && window.kodaxSpace) {
        const providerChanged = providerId !== session.provider;
        const currentRuntimeModel = providerChanged
          ? undefined
          : (session.model ?? activeProvider?.defaultModel ?? '—');
        if (model !== currentRuntimeModel || session.model === undefined || providerChanged) {
          const modelArg = providerChanged ? `${providerId}/${model}` : model;
          const r = await window.kodaxSpace.invoke('slash.exec', {
            sessionId: session.sessionId,
            name: 'model',
            args: [modelArg],
            expectedProjectRoot: session.projectRoot,
            expectedSurface: session.surface,
          });
          if (!r.ok) {
            console.warn('[picker] /model failed:', r.error);
            pushToast(r.error?.message ?? t('modelPicker.saveDefaultsFailed'), 'error');
            return;
          }
          if (!r.data.ok) {
            console.warn('[picker] /model failed:', r.data.message);
            pushToast(r.data.message ?? t('modelPicker.saveDefaultsFailed'), 'error');
            return;
          }
          upsertSession({ ...session, provider: providerId, model });
        }
        // The picker also defines the next-Session model preference. Keep this
        // fresh even when the selected model was already active and no slash
        // command was necessary.
        setPendingModel(model);
      } else {
        setPendingProviderId(providerId);
        setPendingModel(model);
      }

      // Persist only after the current/pending selection has been applied. This
      // keeps a slow credential/config write from making the picker look inert,
      // and avoids changing the global default when a live-session switch fails.
      if (window.kodaxSpace && providerId !== defaultProviderId) {
        try {
          const r = await window.kodaxSpace.invoke('provider.setDefault', { providerId });
          if (!r.ok) {
            console.warn('[picker] provider.setDefault failed:', r.error);
            pushToast(r.error?.message ?? t('modelPicker.saveDefaultsFailed'), 'error');
          } else if (!r.data.ok) {
            console.warn('[picker] provider.setDefault was not applied');
            pushToast(t('modelPicker.saveDefaultsFailed'), 'error');
          } else {
            setDefaultProviderId(providerId);
          }
        } catch (err) {
          console.warn('[picker] provider.setDefault threw:', err);
          pushToast(
            err instanceof Error ? err.message : t('modelPicker.saveDefaultsFailed'),
            'error',
          );
        }
      }
    } finally {
      setBusy(false);
      setOpen(false);
    }
  }

  async function pickEffort(mode: ReasoningMode): Promise<void> {
    if (busy) return;
    setBusy(true);
    // Always update pending as the user's next-session preference.
    setPendingReasoningMode(mode);
    try {
      if (session && window.kodaxSpace) {
        const r = await window.kodaxSpace.invoke('session.setReasoningMode', {
          sessionId: session.sessionId,
          mode,
        });
        if (r.ok) upsertSession({ ...session, reasoningMode: mode });
      }
      if (!(await setSpaceReasoningDefault(mode))) {
        pushToast(t('modelPicker.saveDefaultsFailed'), 'error');
      } else {
        setRuntimeDefaults(useAppStore.getState().runtimeDefaults);
      }
    } catch (err) {
      pushToast(err instanceof Error ? err.message : t('modelPicker.saveDefaultsFailed'), 'error');
    } finally {
      setBusy(false);
    }
  }

  // Fetch the active model's reasoning ladder (SDK resolveModelCapabilities via
  // provider.modelContextWindow) for both the picker and the global effort shortcut.
  useEffect(() => {
    // Clear any prior model's ladder synchronously on provider/model change so a
    // slow/failed fetch never leaves the previous model's efforts attributed to the
    // new one (falls back to the stable fallback ladder until the fresh fetch resolves).
    setModelEfforts(null);
    if (!activeProviderId || !activeModel || activeModel === '—') return;
    let cancelled = false;
    void (async () => {
      try {
        if (!window.kodaxSpace) return;
        const r = await window.kodaxSpace.invoke('provider.modelContextWindow', {
          providerId: activeProviderId,
          model: activeModel,
        });
        if (cancelled || !r.ok) return;
        setModelEfforts(r.data);
      } catch {
        // Non-fatal — the selector falls back to the stable fallback ladder.
        if (!cancelled) setModelEfforts(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeProviderId, activeModel]);

  // Ctrl+Shift+E matches the Effort shortcut shown in the picker.
  // Keep Ctrl+T as a legacy cycle shortcut. Cycles only the model-supported rungs.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const key = e.key.toLowerCase();
      const isLegacyCycle = e.ctrlKey && !e.shiftKey && !e.altKey && !e.metaKey && key === 't';
      const isEffortCycle = e.ctrlKey && e.shiftKey && !e.altKey && !e.metaKey && key === 'e';
      if (isLegacyCycle || isEffortCycle) {
        e.preventDefault();
        const ladder = visibleEffortLadder(
          modelEfforts?.supportedEfforts,
          modelEfforts?.canDisableThinking ?? false,
        );
        const idx = ladder.indexOf(activeEffort);
        const next = ladder[(idx + 1) % ladder.length] ?? ladder[0];
        if (next) void pickEffort(next);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeEffort, session, busy, modelEfforts]);

  // Button label 拆两行：long provider name 不再挤掉 model/effort
  // Top: provider displayName
  // Bottom: model · effort + (next) 后缀
  const providerLabel =
    activeProvider?.displayName ?? activeProviderId ?? t('modelPicker.pickProvider');
  // 同 ModeSelector：用 currentSessionId 判定，避免 sessions[] race 误显示 (next)
  const activeEffortLabel = effortLabel(activeEffort, t);
  const modelEffortLine = currentSessionId
    ? `${activeModel} · ${activeEffortLabel}`
    : `${activeModel} · ${activeEffortLabel} (${t('modelPicker.nextSuffix')})`;
  const compactSuffix = currentSessionId
    ? activeEffortLabel
    : `${activeEffortLabel} (${t('modelPicker.nextSuffix')})`;
  const selectorTitle = `${providerLabel} · ${modelEffortLine}`;

  // 打开时把 preview 重置到 active provider
  function openPicker(): void {
    if (!open) {
      setPreviewProviderId(activeProviderId);
    }
    setOpen((v) => !v);
  }

  return (
    <div className="relative min-w-0">
      <button
        type="button"
        data-testid="model-effort-selector"
        onClick={openPicker}
        className={[
          'h-7 max-w-[240px] min-w-0 px-2 rounded-md border border-border-default',
          'bg-surface-2 text-fg-secondary hover:bg-hover-bg hover:text-fg-primary',
          'flex items-center gap-1.5 transition-colors',
        ].join(' ')}
        title={`${session ? t('modelPicker.title.active') : t('modelPicker.title.next')} - ${selectorTitle}`}
        aria-label={session ? t('modelPicker.title.active') : t('modelPicker.title.next')}
      >
        <BrainCircuit
          className="w-3.5 h-3.5 shrink-0 text-fg-muted"
          strokeWidth={1.8}
          aria-hidden
        />
        <span className="font-mono text-[11px] truncate min-w-0">{activeModel}</span>
        <span className="text-fg-muted shrink-0" aria-hidden>
          ·
        </span>
        <span className="text-[11px] shrink-0 text-fg-muted">{compactSuffix}</span>
        <ChevronDown className="w-3 h-3 shrink-0 text-fg-muted" strokeWidth={2} aria-hidden />
      </button>

      {open && (
        <div
          className="absolute right-0 bottom-full mb-2 w-[460px] bg-surface-4 border border-border-default rounded-lg shadow-xl text-xs z-50"
          onMouseLeave={() => setOpen(false)}
        >
          {/* 2 列：Provider | Model */}
          <div className="grid grid-cols-2 gap-0">
            <div className="border-r border-border-default">
              <div className="px-3 py-1 flex justify-between items-center text-fg-muted text-[11px] uppercase tracking-wider">
                <span>{t('modelPicker.provider')}</span>
                <span className="font-mono text-fg-muted flex items-center gap-1">
                  <kbd className="px-1 border border-border-strong rounded">Ctrl</kbd>
                  <kbd className="px-1 border border-border-strong rounded">I</kbd>
                </span>
              </div>
              <div className="max-h-64 overflow-y-auto">
                {configuredProviders.length === 0 ? (
                  <div className="px-3 py-1 text-fg-muted text-[11px]">
                    {t('modelPicker.noConfiguredProviders')}
                  </div>
                ) : (
                  configuredProviders.map((p, idx) => {
                    const isPreviewing = (previewProviderId ?? activeProviderId) === p.id;
                    const isActive = activeProviderId === p.id;
                    return (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => setPreviewProviderId(p.id)}
                        className={`w-full text-left px-3 py-1 hover:bg-hover-bg flex items-center gap-2 ${
                          isPreviewing ? 'bg-surface-3/60 text-fg-primary' : 'text-fg-secondary'
                        }`}
                        title={p.displayName}
                      >
                        <span className="truncate flex-1">{p.displayName}</span>
                        {isActive && (
                          <span className="text-ok" aria-hidden>
                            ✓
                          </span>
                        )}
                        {idx < 9 && (
                          <span className="text-fg-muted text-[11px] font-mono w-3 text-right">
                            {idx + 1}
                          </span>
                        )}
                      </button>
                    );
                  })
                )}
              </div>
            </div>

            <div>
              <div className="px-3 py-1 flex justify-between items-center text-fg-muted text-[11px] uppercase tracking-wider">
                <span>{t('modelPicker.model')}</span>
                {!session && (
                  <span className="text-warn normal-case">{t('modelPicker.nextSession')}</span>
                )}
              </div>
              <div className="max-h-64 overflow-y-auto">
                {previewModels.length === 0 ? (
                  <div className="px-3 py-1 text-fg-muted text-[11px]">
                    {t('modelPicker.noModels')}
                  </div>
                ) : (
                  previewModels.map((m) => {
                    const isActive = activeProviderId === previewProvider?.id && activeModel === m;
                    return (
                      <button
                        key={m}
                        type="button"
                        onClick={() => void commitProviderAndModel(previewProvider?.id ?? '', m)}
                        disabled={!previewProvider}
                        className={`w-full text-left px-3 py-1 hover:bg-hover-bg flex items-center gap-2 ${
                          isActive ? 'text-fg-primary' : 'text-fg-secondary'
                        }`}
                      >
                        <span className="truncate flex-1 font-mono">{m}</span>
                        {isActive && (
                          <span className="text-ok" aria-hidden>
                            ✓
                          </span>
                        )}
                      </button>
                    );
                  })
                )}
              </div>
            </div>
          </div>

          {/* Effort 行（横跨 2 列底部） */}
          <div className="border-t border-border-default pt-1">
            <div className="px-3 py-1 flex justify-between items-center text-fg-muted text-[11px] uppercase tracking-wider">
              <span>{t('modelPicker.effort')}</span>
              <span className="font-mono text-fg-muted flex items-center gap-1">
                <kbd className="px-1 border border-border-strong rounded">⇧</kbd>
                <kbd className="px-1 border border-border-strong rounded">Ctrl</kbd>
                <kbd className="px-1 border border-border-strong rounded">E</kbd>
              </span>
            </div>
            <div className="flex flex-wrap px-2 pb-1 gap-1">
              {visibleEfforts.map((m) => {
                const selected = activeEffort === m;
                const isModelDefault = modelDefaultMode === m;
                return (
                  <button
                    key={m}
                    type="button"
                    onClick={() => void pickEffort(m)}
                    title={isModelDefault ? t('modelPicker.effort.modelDefault') : undefined}
                    className={`min-w-14 flex-1 text-center px-1 py-1 rounded hover:bg-hover-bg ${
                      selected ? 'bg-surface-3 text-fg-primary' : 'text-fg-secondary'
                    }`}
                  >
                    {effortLabel(m, t)}
                    {selected && (
                      <span className="ml-0.5 text-ok" aria-hidden>
                        ✓
                      </span>
                    )}
                    {isModelDefault && !selected && (
                      <span className="ml-0.5 text-fg-muted" aria-hidden>
                        ·
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
