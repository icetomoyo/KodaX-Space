// SessionList — 左抽屉下半。当前项目下的 sessions + "New session" 按钮。
//
// 数据流：
//   - currentProjectPath 变化 → invoke session.list { projectRoot } → setSessions
//   - 点 "New session" → invoke session.create → upsertSession + setCurrentSession
//   - 点 session 卡片 → setCurrentSession（仅切视图，无 IPC）
//   - 右键卡片 → 弹 Rename / Delete

import { useEffect, useMemo, useRef, useState } from 'react';
import { useAppStore } from '../../store/appStore.js';
import { resolveActiveModel } from '../../shell/resolveActiveModel.js';
import { useSurfaceStore } from '../../store/surface.js';
import { sessionMatchesScope } from '../../lib/sessionScope.js';
import { shouldActivateSessionForCurrentScope } from '../../lib/sessionActivation.js';
import { invokeWithTimeout } from '../../lib/ipcInvokeWithTimeout.js';
import type { SessionMeta } from '@kodax-space/space-ipc-schema';
import { useI18n } from '../../i18n/I18nProvider.js';
import type { MessageKey } from '../../i18n/messages.js';
import { pushToast } from '../../store/toastStore.js';

// 'mock' 永远保留——FEATURE_003 Mock adapter 的入口，未配 key 时也能跑通整个流程。
// 真 provider 列表从 store 拉（FEATURE_004 已注入）。
const MOCK_PROVIDER = 'mock';

export function SessionList(): JSX.Element {
  const { t } = useI18n();
  const currentProjectPath = useAppStore((s) => s.currentProjectPath);
  const currentSurface = useSurfaceStore((s) => s.currentSurface);
  const sessions = useAppStore((s) => s.sessions);
  const currentSessionId = useAppStore((s) => s.currentSessionId);
  const replaceSessionsForScope = useAppStore((s) => s.replaceSessionsForScope);
  const setCurrentSession = useAppStore((s) => s.setCurrentSession);
  const upsertSession = useAppStore((s) => s.upsertSession);
  const removeSession = useAppStore((s) => s.removeSession);
  const providers = useAppStore((s) => s.providers);
  const defaultProviderId = useAppStore((s) => s.defaultProviderId);
  const kodaxDefaults = useAppStore((s) => s.kodaxDefaults);
  const runtimeDefaults = useAppStore((s) => s.runtimeDefaults);
  const pendingReasoningMode = useAppStore((s) => s.pendingReasoningMode);
  const pendingPermissionMode = useAppStore((s) => s.pendingPermissionMode);
  const pendingAutoModeEngine = useAppStore((s) => s.pendingAutoModeEngine);
  const pendingAgentMode = useAppStore((s) => s.pendingAgentMode);
  const [creating, setCreating] = useState<boolean>(false);

  // 下拉选项：Mock 永远第一项；之后按"已配 key 的 provider 在前，未配 key 的在后"
  const providerOptions = useMemo(() => {
    const configured = providers.filter((p) => p.configured);
    const unconfigured = providers.filter((p) => !p.configured);
    return [
      {
        id: MOCK_PROVIDER,
        displayName: t('session.mockProvider'),
        configured: true,
        isCustom: false,
      },
      ...configured.map((p) => ({
        id: p.id,
        displayName: p.displayName,
        configured: true,
        isCustom: p.isCustom,
      })),
      ...unconfigured.map((p) => ({
        id: p.id,
        displayName: t('session.providerNotConfigured', { name: p.displayName }),
        configured: false,
        isCustom: p.isCustom,
      })),
    ];
  }, [providers, t]);

  const [provider, setProvider] = useState<string>(MOCK_PROVIDER);

  // 默认 provider 在 store 里就绪后，自动把 picker 切到默认——只在**首次**
  // providers 列表非空 + defaultProviderId 就绪时执行一次。之后用户改了下拉，
  // 即使 store 再变也不再覆盖。
  //
  // review M4-code：原本用 `if (provider === MOCK_PROVIDER) ...` 守门，但
  // useEffect 闭包里的 provider 可能陈旧——用户改了下拉然后 providers 又刷新一次
  // 时会触发误覆盖。改用 ref 锁住"已自动选过"状态
  const hasAutoSelectedRef = useRef(false);
  useEffect(() => {
    if (hasAutoSelectedRef.current) return;
    // 优先 Space defaultProviderId；若 null 再 fallback 到 KodaX ~/.kodax/config.json 的 provider
    // （v0.1.6 cleanup —— 首次 Space 无设置时跟随 KodaX CLI 默认）
    const candidateId = defaultProviderId ?? kodaxDefaults?.provider;
    if (!candidateId) return;
    const p = providers.find((x) => x.id === candidateId);
    if (p?.configured) {
      hasAutoSelectedRef.current = true;
      setProvider(candidateId);
    }
  }, [defaultProviderId, kodaxDefaults, providers]);
  // 改名 UI：renaming = 当前正在改的 sessionId；draft = 输入框值。
  // 用 inline 输入而不是 window.prompt——后者在 Electron sandbox=true 下被禁用，会静默失败。
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState<string>('');
  const visibleSessions = useMemo(
    () =>
      currentProjectPath
        ? sessions.filter((s) =>
            sessionMatchesScope(s, { projectRoot: currentProjectPath, surface: currentSurface }),
          )
        : [],
    [currentProjectPath, currentSurface, sessions],
  );

  useEffect(() => {
    if (!currentProjectPath) return;
    void refreshSessions(currentProjectPath, replaceSessionsForScope, currentSurface);
  }, [currentProjectPath, replaceSessionsForScope, currentSurface]);

  async function handleCreate(): Promise<void> {
    if (!currentProjectPath) return;
    const bridge = window.kodaxSpace;
    if (!bridge) return;
    setCreating(true);
    // Runtime modes are only sent when the user has a pending explicit choice.
    const runtimeOverrides = {
      ...(pendingReasoningMode !== null && pendingReasoningMode !== runtimeDefaults.reasoningMode
        ? { reasoningMode: pendingReasoningMode }
        : {}),
      ...(pendingPermissionMode !== null && pendingPermissionMode !== runtimeDefaults.permissionMode
        ? { permissionMode: pendingPermissionMode }
        : {}),
      ...(pendingAutoModeEngine !== null && pendingAutoModeEngine !== runtimeDefaults.autoModeEngine
        ? { autoModeEngine: pendingAutoModeEngine }
        : {}),
      ...(pendingAgentMode !== null && pendingAgentMode !== runtimeDefaults.agentMode
        ? { agentMode: pendingAgentMode }
        : {}),
    };
    // 生效 model（与 picker 同源）：显式带上让 SDK 应用 per-model 能力（正确 contextWindow → 压缩窗口）。
    const activeProvider = providers.find((p) => p.id === provider);
    const resolvedModel = resolveActiveModel({
      activeProviderId: provider,
      activeProviderModels: activeProvider?.models,
      activeProviderDefaultModel: activeProvider?.defaultModel,
      pendingModel: null, // SessionList 用自己的 provider 下拉，不读 pendingModel
      kodaxDefaultsProvider: kodaxDefaults?.provider ?? null,
      kodaxDefaultsModel: kodaxDefaults?.model ?? null,
    });
    const model = resolvedModel && resolvedModel !== '—' ? resolvedModel : undefined;
    try {
      const result = await bridge.invoke('session.create', {
        projectRoot: currentProjectPath,
        provider,
        ...(model ? { model } : {}),
        ...runtimeOverrides,
        // F045: 新 session 归当前工作面；main 落盘成 SDK session tag。
        surface: currentSurface,
      });
      if (!result.ok) {
        console.error('[SessionList] create failed:', result.error);
        return;
      }
      // host 那边没有保存完整 SessionMeta；renderer 自己构造一个 stub，
      // 然后立刻 session.list 刷新拿权威值。
      const stub: SessionMeta = {
        sessionId: result.data.sessionId,
        projectRoot: currentProjectPath,
        provider,
        ...(model ? { model } : {}),
        reasoningMode: result.data.reasoningMode,
        permissionMode: result.data.permissionMode,
        autoModeEngine: result.data.autoModeEngine,
        agentMode: result.data.agentMode,
        surface: currentSurface,
        title: undefined,
        createdAt: result.data.createdAt,
        lastActivityAt: result.data.createdAt,
      };
      upsertSession(stub);
      const latest = useAppStore.getState();
      const latestSurface = useSurfaceStore.getState().currentSurface;
      if (
        shouldActivateSessionForCurrentScope(stub, {
          currentProjectPath: latest.currentProjectPath,
          currentSurface: latestSurface,
        })
      ) {
        setCurrentSession(stub.sessionId);
      }
      // await refresh——确保 main 端权威列表已应用，避免后续操作看到 stub 残影
      await refreshSessions(currentProjectPath, replaceSessionsForScope, currentSurface);
    } finally {
      setCreating(false);
    }
  }

  async function handleDelete(e: React.MouseEvent, sessionId: string): Promise<void> {
    e.stopPropagation();
    const bridge = window.kodaxSpace;
    if (!bridge) return;
    const result = await bridge.invoke('session.delete', { sessionId });
    if (result.ok && result.data.deleted) {
      removeSession(sessionId);
      window.dispatchEvent(new Event('kodax-space.focus-textarea'));
    } else if (result.ok && result.data.reason === 'session_running') {
      pushToast(t('menu.session.deleteBusy'), 'warning');
      if (currentProjectPath) {
        await refreshSessions(currentProjectPath, replaceSessionsForScope, currentSurface);
      }
    } else if (!result.ok) {
      pushToast(result.error?.message ?? t('common.unknownError'), 'error');
    }
  }

  function startRename(e: React.MouseEvent, sessionId: string, current: string | undefined): void {
    e.stopPropagation();
    setRenaming(sessionId);
    setRenameDraft(current ?? '');
  }

  async function commitRename(): Promise<void> {
    if (renaming === null) return;
    const trimmed = renameDraft.trim();
    if (trimmed === '') {
      setRenaming(null);
      return;
    }
    const bridge = window.kodaxSpace;
    if (!bridge) {
      setRenaming(null);
      return;
    }
    const result = await invokeWithTimeout(bridge, 'session.setTitle', {
      sessionId: renaming,
      title: trimmed,
    });
    setRenaming(null);
    if (result.ok && currentProjectPath) {
      await refreshSessions(currentProjectPath, replaceSessionsForScope, currentSurface);
    }
  }

  function cancelRename(): void {
    setRenaming(null);
    setRenameDraft('');
  }

  return (
    <div className="flex flex-col gap-2 p-3 flex-1 min-h-0">
      <div className="flex items-center justify-between">
        <h2 className="text-xs uppercase tracking-wider text-fg-muted font-semibold">
          {t('session.sessions')}
        </h2>
        <div className="flex items-center gap-1">
          <select
            value={provider}
            onChange={(e) => setProvider(e.target.value)}
            className="text-xs bg-surface-3 border border-border-strong text-fg-secondary rounded px-1 py-0.5 max-w-[160px]"
            disabled={!currentProjectPath}
            title={t('session.providerTitle')}
          >
            {providerOptions.map((p) => (
              <option key={p.id} value={p.id} disabled={!p.configured && p.id !== MOCK_PROVIDER}>
                {p.displayName}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => void handleCreate()}
            disabled={!currentProjectPath || creating}
            className="text-xs px-2 py-1 rounded bg-ok/80 hover:bg-ok disabled:opacity-40 disabled:cursor-not-allowed text-white"
            title={currentProjectPath ? t('session.createTitle') : t('session.pickProjectFirst')}
          >
            +
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-1 overflow-y-auto flex-1 min-h-0">
        {!currentProjectPath && (
          <div className="text-xs text-fg-faint italic px-1">{t('session.pickProjectAbove')}</div>
        )}
        {currentProjectPath && visibleSessions.length === 0 && (
          <div className="text-xs text-fg-faint italic px-1">{t('session.noneYet')}</div>
        )}
        {visibleSessions.map((s) => {
          const isActive = s.sessionId === currentSessionId;
          return (
            <div
              key={s.sessionId}
              role="button"
              tabIndex={0}
              onClick={() => setCurrentSession(s.sessionId)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  setCurrentSession(s.sessionId);
                }
              }}
              // 选中行: dark 用半透深蓝衬底 (与暗黑卡片层叠出蓝调); light 用实色浅蓝衬底
              // (在白底卡片上能"鼓出来"). 边线 light 用 blue-300 增强 vs blue-50 衬底的反差。
              className={`group cursor-pointer text-left px-2 py-2 rounded text-sm flex flex-col gap-0.5 ${
                isActive
                  ? 'bg-info/15 border-info/40 text-info border'
                  : 'hover:bg-hover-bg text-fg-secondary border border-transparent'
              }`}
              title={
                s.runtimeMetadataSource === 'current-default-fallback'
                  ? `${s.sessionId} \u2014 ${t('session.runtimeFallback')}`
                  : s.sessionId
              }
            >
              <div className="flex items-center gap-2">
                {renaming === s.sessionId ? (
                  <input
                    type="text"
                    autoFocus
                    value={renameDraft}
                    onChange={(e) => setRenameDraft(e.target.value)}
                    onBlur={() => void commitRename()}
                    onClick={(e) => e.stopPropagation()}
                    onKeyDown={(e) => {
                      e.stopPropagation();
                      if (e.key === 'Enter') void commitRename();
                      else if (e.key === 'Escape') cancelRename();
                    }}
                    maxLength={256}
                    className="flex-1 min-w-0 bg-surface border border-border-strong rounded px-1.5 py-0.5 text-sm font-medium text-fg-primary"
                    aria-label={t('session.newTitleAria')}
                  />
                ) : (
                  <span className="flex-1 truncate font-medium">
                    {s.title ?? t('breadcrumb.untitledSession')}
                  </span>
                )}
                <span className="opacity-0 group-hover:opacity-100 flex gap-1 text-xs">
                  <button
                    type="button"
                    onClick={(e) => startRename(e, s.sessionId, s.title)}
                    className="text-fg-muted hover:text-fg-primary px-1"
                    aria-label={t('session.renameAria')}
                  >
                    ✎
                  </button>
                  <button
                    type="button"
                    onClick={(e) => void handleDelete(e, s.sessionId)}
                    className="text-fg-muted hover:text-danger px-1"
                    aria-label={t('session.deleteAria')}
                  >
                    ×
                  </button>
                </span>
              </div>
              <div className="flex items-center gap-2 text-[11px] text-fg-muted">
                <span
                  title={
                    s.runtimeMetadataSource === 'current-default-fallback'
                      ? t('session.runtimeFallback')
                      : undefined
                  }
                >
                  {s.provider}
                  {s.runtimeMetadataSource === 'current-default-fallback' ? ' *' : ''}
                </span>
                <span>·</span>
                <span>{s.reasoningMode}</span>
                <span>·</span>
                <span>{formatRelativeTime(s.lastActivityAt, t)}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

async function refreshSessions(
  projectRoot: string,
  replaceSessionsForScope: (
    sessions: readonly SessionMeta[],
    scope: { readonly projectRoot: string; readonly surface?: SessionMeta['surface'] },
  ) => void,
  surface?: SessionMeta['surface'],
): Promise<void> {
  const bridge = window.kodaxSpace;
  if (!bridge) return;
  // F045: 按当前工作面拉，与分面列表一致（不传 surface 则回退全量，向后兼容）。
  const result = await bridge.invoke('session.list', { projectRoot, surface });
  if (result.ok) {
    replaceSessionsForScope(
      result.data.sessions,
      surface === undefined ? { projectRoot } : { projectRoot, surface },
    );
  }
}

type Translate = (key: MessageKey, vars?: Record<string, string | number>) => string;

function formatRelativeTime(timestamp: number, t: Translate): string {
  const diff = Date.now() - timestamp;
  if (diff < 60_000) return t('session.justNow');
  if (diff < 3_600_000) return t('session.minutesAgo', { count: Math.floor(diff / 60_000) });
  if (diff < 86_400_000) return t('session.hoursAgo', { count: Math.floor(diff / 3_600_000) });
  return t('session.daysAgo', { count: Math.floor(diff / 86_400_000) });
}
