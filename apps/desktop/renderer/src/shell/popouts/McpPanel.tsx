// McpPanel — FEATURE_036 + lifecycle (v0.1.x, Batch 3 #5 follow-up)
//
// 两个数据源:
//   1) mcp.servers  — McpManager.listServers (runtime status, 不触发连接)
//   2) mcp.discover — 文件级配置投影 (展示 source / command / envCount, 给"没连接过的 server
//      显示出原始命令行"用)
//
// UI:
//   - 顶部 status badge + Refresh / Reload (config) 按钮
//   - 每个 server 一行: name + transport + status + tools-count + Start/Stop + 错误显示
//   - 点 server 名展开 tools 列表 (mcp.tools 拉, lazy connect, 缓存到 expandedTools state)
//   - lastError 显示在状态行下方 (status=error 时)

import { useEffect, useState } from 'react';
import type {
  McpServerMeta,
  McpServerStatusT,
  McpRuntimeStatusT,
  McpbExtensionT,
} from '@kodax-space/space-ipc-schema';
import {
  RefreshCw,
  Circle,
  Loader2,
  CircleDot,
  CircleX,
  MinusCircle,
  ExternalLink,
  FolderOpen,
  type LucideIcon,
} from 'lucide-react';
import { useAppStore } from '../../store/appStore.js';
import { FileNameText } from '../../components/FileNameText.js';
import { pushToast } from '../../store/toastStore.js';
import { Caret } from '../../components/Caret.js';
import { openExternalUrl, revealPath } from '../../lib/openPath.js';
import { useI18n } from '../../i18n/I18nProvider.js';

const STATUS_COLOR: Record<McpRuntimeStatusT, string> = {
  idle: 'text-fg-muted',
  connecting: 'text-warn',
  ready: 'text-ok',
  error: 'text-danger',
  disabled: 'text-fg-faint',
};
const STATUS_ICON: Record<McpRuntimeStatusT, LucideIcon> = {
  idle: Circle,
  connecting: Loader2,
  ready: CircleDot,
  error: CircleX,
  disabled: MinusCircle,
};

interface ToolItem {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
}

interface DiagSnapshot {
  readonly connect: string;
  readonly status: string;
  readonly lastError?: string;
  readonly cachedAt?: string;
}

export function McpPanel(): JSX.Element {
  const { t } = useI18n();
  const currentProjectPath = useAppStore((s) => s.currentProjectPath);
  const [statusList, setStatusList] = useState<readonly McpServerStatusT[]>([]);
  const [meta, setMeta] = useState<readonly McpServerMeta[]>([]);
  const [discoverErrors, setDiscoverErrors] = useState<
    ReadonlyArray<{ path: string; error: string }>
  >([]);
  const [loading, setLoading] = useState(false);
  const [topErr, setTopErr] = useState<string | null>(null);
  // 操作中的 serverId (start/stop 期间禁按钮)
  const [busyServer, setBusyServer] = useState<string | null>(null);
  // F021 .mcpb 已安装 extensions
  const [extensions, setExtensions] = useState<readonly McpbExtensionT[]>([]);
  const [installing, setInstalling] = useState(false);
  // 哪些 server 当前展开 tools 列表 (Map<serverId, ToolItem[] | 'loading'>)
  const [expandedTools, setExpandedTools] = useState<
    Record<string, ToolItem[] | 'loading' | 'error'>
  >({});
  // F039 v0.1.7：每个 server 的 diagnostic snapshot（mcp.logs IPC）展开态。
  // 'loading' = IPC in-flight；object = 实际 diag；'error' = IPC 失败。
  // SDK 当前 surface 比较保守（status + lastError + cachedAt + connect mode），
  // 比 stdout/stderr 滚动简单 —— 等 SDK 暴露日志流后再升级成滚动 tab。
  const [diagState, setDiagState] = useState<Record<string, DiagSnapshot | 'loading' | 'error'>>(
    {},
  );
  const mcpScope = currentProjectPath ? { projectRoot: currentProjectPath } : undefined;

  async function refresh(): Promise<void> {
    if (!window.kodaxSpace) return;
    setLoading(true);
    setTopErr(null);
    try {
      // 并发拉 servers (lifecycle status) + discover (config 投影)。两者独立: 没启动过的 server
      // discover 出现但 statusList 缺 — UI 用 meta 补 command 等展示。
      const [statusR, discoverR] = await Promise.all([
        window.kodaxSpace.invoke('mcp.servers', mcpScope),
        currentProjectPath
          ? window.kodaxSpace.invoke('mcp.discover', { projectRoot: currentProjectPath })
          : Promise.resolve(null),
      ]);
      if (!statusR.ok) {
        setTopErr(t('mcp.serversFailed', { message: statusR.error?.message ?? t('mcp.unknown') }));
        setStatusList([]);
      } else {
        setStatusList(statusR.data.servers);
      }
      if (discoverR && discoverR.ok) {
        setMeta(discoverR.data.servers);
        setDiscoverErrors(discoverR.data.errors);
      } else {
        setMeta([]);
        setDiscoverErrors([]);
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentProjectPath]);

  // F021 拉一次 mcpb extensions + 订阅 changed push。
  //
  // 故意空 dep（不跟着 currentProjectPath 变）：mcpb extensions 是**全局** registry
  // (~/.kodax/mcpb/registry.json)，不分项目；切项目时列表不变。如果未来要
  // 引入 per-project mcpb 安装位置，需要把 currentProjectPath 加进 dep 并改后端
  // mcpb.list 接受 projectRoot 参数 —— v0.1.4 不做。
  useEffect(() => {
    if (!window.kodaxSpace) return;
    void window.kodaxSpace.invoke('mcpb.list', {}).then((r) => {
      if (r.ok) setExtensions(r.data.extensions);
    });
    const unsub = window.kodaxSpace.on('mcpb.changed', (payload) => {
      setExtensions(payload.extensions);
    });
    return () => unsub();
  }, []);

  async function installExtension(): Promise<void> {
    if (!window.kodaxSpace) return;
    setInstalling(true);
    try {
      const r = await window.kodaxSpace.invoke('mcpb.install', {});
      if (!r.ok) {
        pushToast(
          t('mcp.installFailed', { message: r.error?.message ?? t('mcp.unknown') }),
          'error',
        );
        return;
      }
      if ('cancelled' in r.data && r.data.cancelled) return;
      if ('extension' in r.data) {
        pushToast(
          t('mcp.installed', {
            name: r.data.extension.displayName,
            version: r.data.extension.version,
          }),
          'success',
        );
      }
    } finally {
      setInstalling(false);
    }
  }

  async function uninstallExtension(extensionId: string, name: string): Promise<void> {
    if (!window.kodaxSpace) return;
    const r = await window.kodaxSpace.invoke('mcpb.uninstall', { extensionId });
    if (r.ok && r.data.ok) {
      pushToast(t('mcp.uninstalled', { name }), 'info');
    } else {
      pushToast(t('mcp.uninstallFailed'), 'error');
    }
  }

  async function startServer(serverId: string): Promise<void> {
    if (!window.kodaxSpace) return;
    setBusyServer(serverId);
    try {
      const r = await window.kodaxSpace.invoke('mcp.start', { serverId, ...mcpScope });
      if (r.ok) {
        setStatusList((cur) =>
          cur.some((s) => s.serverId === serverId)
            ? cur.map((s) => (s.serverId === serverId ? r.data.status : s))
            : [...cur, r.data.status],
        );
      } else {
        setTopErr(
          t('mcp.startFailed', { serverId, message: r.error?.message ?? t('common.unknownError') }),
        );
      }
    } finally {
      setBusyServer(null);
    }
  }

  async function stopServer(serverId: string): Promise<void> {
    if (!window.kodaxSpace) return;
    setBusyServer(serverId);
    try {
      const r = await window.kodaxSpace.invoke('mcp.stop', { serverId, ...mcpScope });
      if (r.ok) {
        setStatusList((cur) =>
          cur.some((s) => s.serverId === serverId)
            ? cur.map((s) => (s.serverId === serverId ? r.data.status : s))
            : [...cur, r.data.status],
        );
      } else {
        setTopErr(
          t('mcp.stopFailed', { serverId, message: r.error?.message ?? t('common.unknownError') }),
        );
      }
    } finally {
      setBusyServer(null);
    }
  }

  async function reload(): Promise<void> {
    if (!window.kodaxSpace) return;
    setLoading(true);
    setTopErr(null);
    try {
      const r = await window.kodaxSpace.invoke('mcp.reload', mcpScope);
      if (!r.ok) {
        setTopErr(t('mcp.reloadFailed'));
      }
      // 不管成功失败,重新拉一次 — reload 后状态全 reset 了
      await refresh();
    } finally {
      setLoading(false);
    }
  }

  async function toggleTools(serverId: string): Promise<void> {
    if (!window.kodaxSpace) return;
    const current = expandedTools[serverId];
    // 'loading' 状态下点击 = 用户改主意要取消,不进入"折叠"分支否则 race 后 IPC reply 会复活
    // 它认为已经折叠的 tool 列表 (审查 M2)。直接 noop,等 in-flight 自然 resolve。
    if (current === 'loading') return;
    if (current !== undefined) {
      // 已展开 (array) / 报错 (error) → 折叠
      setExpandedTools((cur) => {
        const next = { ...cur };
        delete next[serverId];
        return next;
      });
      return;
    }
    setExpandedTools((cur) => ({ ...cur, [serverId]: 'loading' }));
    const r = await window.kodaxSpace.invoke('mcp.tools', { serverId, ...mcpScope });
    // setter form 防 stale closure;另外若用户在 in-flight 期再次点击 toggle (上面 noop 已挡)
    // 或 reload (mcp.reload → 我们不清 expandedTools,但下次 IPC 结果仍是新 manager 的),
    // 这里照写最新结果即可。
    setExpandedTools((cur) => {
      // 如果 in-flight 期间 cur 里这一项已被外部 (eg session switch + remount) 清理,我们就别
      // 再灌回去——避免被用户视为"自己刚关掉的卡又跳出来"
      if (cur[serverId] !== 'loading') return cur;
      if (!r.ok) return { ...cur, [serverId]: 'error' };
      return { ...cur, [serverId]: r.data.tools as ToolItem[] };
    });
  }

  /**
   * F039：拉 mcp.logs diagnostic envelope。toggle 语义跟 toggleTools 对称：
   * 折叠 → loading → 拉 IPC → fill object / error。再点折叠。
   */
  async function toggleDiag(serverId: string): Promise<void> {
    if (!window.kodaxSpace) return;
    const current = diagState[serverId];
    if (current === 'loading') return; // in-flight 不重复触发
    if (current !== undefined) {
      // 已展开 → 折叠
      setDiagState((cur) => {
        const next = { ...cur };
        delete next[serverId];
        return next;
      });
      return;
    }
    setDiagState((cur) => ({ ...cur, [serverId]: 'loading' }));
    const r = await window.kodaxSpace.invoke('mcp.logs', { serverId, ...mcpScope });
    setDiagState((cur) => {
      if (cur[serverId] !== 'loading') return cur; // 中间用户切其它 server / unmount
      if (!r.ok) return { ...cur, [serverId]: 'error' };
      const snap: DiagSnapshot = {
        connect: r.data.connect,
        status: r.data.status,
        ...(r.data.lastError !== undefined ? { lastError: r.data.lastError } : {}),
        ...(r.data.cachedAt !== undefined ? { cachedAt: r.data.cachedAt } : {}),
      };
      return { ...cur, [serverId]: snap };
    });
  }

  // 合并 statusList + meta(discover) 成统一视图:status 优先,meta 仅给"command/url"补展示
  const metaById = new Map(meta.map((m) => [m.name, m]));
  const allServerIds = new Set<string>();
  for (const s of statusList) allServerIds.add(s.serverId);
  for (const m of meta) allServerIds.add(m.name);
  const merged = Array.from(allServerIds).map((id) => ({
    serverId: id,
    status: statusList.find((s) => s.serverId === id),
    meta: metaById.get(id),
  }));

  return (
    <div className="h-full flex flex-col text-xs">
      <header className="px-3 py-2 border-b border-border-default/60 flex items-center justify-between flex-shrink-0">
        <div className="text-fg-secondary font-medium">
          {t('mcp.title')} <span className="text-fg-muted font-normal">({merged.length})</span>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={loading}
            className="px-2 py-0.5 text-[11px] rounded text-fg-muted hover:text-fg-primary hover:bg-hover-bg disabled:opacity-50 inline-flex items-center gap-1"
            title={t('mcp.refreshStatus')}
          >
            <RefreshCw
              className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`}
              strokeWidth={2}
              aria-hidden
            />
            {t('common.refresh')}
          </button>
          <button
            type="button"
            onClick={() => void reload()}
            disabled={loading}
            className="px-2 py-0.5 text-[11px] rounded bg-warn/15 text-warn hover:bg-warn/25 disabled:opacity-50 inline-flex items-center gap-1"
            title={t('mcp.reloadConfigTitle')}
          >
            <RefreshCw
              className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`}
              strokeWidth={2}
              aria-hidden
            />
            {t('mcp.reloadConfig')}
          </button>
          <button
            type="button"
            onClick={() => void installExtension()}
            disabled={installing}
            className="px-2 py-0.5 text-[11px] rounded bg-ok/15 text-ok hover:bg-ok/25 disabled:opacity-50"
            title={t('mcp.installExtTitle')}
          >
            {installing ? t('mcp.installing') : t('mcp.installExt')}
          </button>
        </div>
      </header>

      {topErr !== null && (
        <div className="px-3 py-1 text-xs text-danger font-mono border-b border-border-default">
          {topErr}
        </div>
      )}

      <div className="flex-1 overflow-auto px-2 py-2 space-y-1.5">
        {merged.length === 0 && !loading && (
          <div className="text-fg-faint text-center py-8 text-xs">
            {t('mcp.noServersPrefix')}{' '}
            <code className="text-fg-muted bg-surface-2 px-1 rounded">mcpServers</code>{' '}
            {t('mcp.noServersSuffix')}{' '}
            <code className="text-fg-muted bg-surface-2 px-1 rounded">~/.kodax/config.json</code>.
          </div>
        )}

        {merged.map((row) => {
          const status = row.status;
          const m = row.meta;
          const sStatus: McpRuntimeStatusT = status?.status ?? 'idle';
          const StatusIcon = STATUS_ICON[sStatus];
          const tools = status?.tools ?? 0;
          const isBusy = busyServer === row.serverId;
          const toolsState = expandedTools[row.serverId];
          return (
            <div
              key={row.serverId}
              className="border border-border-default/60 rounded bg-surface-2/30"
            >
              <div className="px-2 py-1.5">
                <div className="flex items-center gap-2">
                  <StatusIcon
                    className={`w-3.5 h-3.5 flex-shrink-0 ${STATUS_COLOR[sStatus]} ${sStatus === 'connecting' ? 'animate-spin' : ''}`}
                    strokeWidth={2}
                    aria-hidden
                  />
                  <span className="sr-only">{sStatus}</span>
                  <span className="font-mono text-fg-primary truncate flex-1">{row.serverId}</span>
                  <span className={`text-[11px] font-mono ${STATUS_COLOR[sStatus]}`}>
                    {sStatus}
                  </span>
                  {tools > 0 && (
                    <span className="text-[11px] text-fg-muted font-mono">
                      {t('mcp.toolsCount', { count: tools })}
                    </span>
                  )}
                  {status === undefined && (
                    <span className="text-[11px] text-fg-faint italic">
                      {t('mcp.notInManager')}
                    </span>
                  )}
                </div>
                {m && m.transport === 'stdio' && (
                  <div
                    className="mt-1 text-fg-muted font-mono text-[11px] truncate"
                    title={`${m.command ?? ''} ${(m.args ?? []).join(' ')}`}
                  >
                    {m.command} {(m.args ?? []).join(' ')}
                  </div>
                )}
                {m && m.transport === 'http' && m.url && (
                  <button
                    type="button"
                    onClick={() => {
                      if (m.url) void openExternalUrl(m.url);
                    }}
                    title={t('mcp.openInBrowser', { url: m.url })}
                    className="mt-1 max-w-full inline-flex items-center gap-1 text-info/80 hover:text-info font-mono text-[11px] underline decoration-info/40 underline-offset-2"
                  >
                    <span className="truncate">{m.url}</span>
                    <ExternalLink
                      className="w-3 h-3 flex-shrink-0"
                      strokeWidth={1.75}
                      aria-hidden
                    />
                  </button>
                )}
                {status?.lastError && (
                  <div className="mt-1 text-danger/80 text-[11px] font-mono break-words">
                    {status.lastError}
                  </div>
                )}
                <div className="mt-1.5 flex gap-1.5 items-center">
                  {status && status.status !== 'ready' && status.status !== 'connecting' && (
                    <button
                      type="button"
                      onClick={() => void startServer(row.serverId)}
                      disabled={isBusy}
                      className="px-2 py-0.5 text-[11px] rounded bg-ok/15 text-ok hover:bg-ok/25 disabled:opacity-50"
                    >
                      {isBusy ? t('mcp.installing') : t('mcp.start')}
                    </button>
                  )}
                  {status && (status.status === 'ready' || status.status === 'connecting') && (
                    <button
                      type="button"
                      onClick={() => void stopServer(row.serverId)}
                      disabled={isBusy}
                      className="px-2 py-0.5 text-[11px] rounded bg-surface-3/60 text-fg-primary hover:bg-hover-bg disabled:opacity-50"
                    >
                      {isBusy ? t('mcp.installing') : t('mcp.stop')}
                    </button>
                  )}
                  {status && tools > 0 && (
                    <button
                      type="button"
                      onClick={() => void toggleTools(row.serverId)}
                      className="px-2 py-0.5 text-[11px] rounded text-fg-muted hover:text-fg-primary hover:bg-hover-bg inline-flex items-center gap-1"
                    >
                      <Caret open={!!toolsState} /> {t('mcp.tools')}
                    </button>
                  )}
                  {/* F039：Diag 按钮拉 mcp.logs，展示 connect mode / status / lastError / cachedAt。
                      所有 server (含 idle / disabled) 都允许 ——是诊断窗口，不依赖正在跑。 */}
                  <button
                    type="button"
                    onClick={() => void toggleDiag(row.serverId)}
                    className="px-2 py-0.5 text-[11px] rounded text-fg-muted hover:text-fg-primary hover:bg-hover-bg inline-flex items-center gap-1"
                  >
                    <Caret open={!!diagState[row.serverId]} /> {t('mcp.diag')}
                  </button>
                </div>
              </div>
              {Array.isArray(toolsState) && (
                <div className="border-t border-border-default px-2 py-1.5 space-y-0.5">
                  {toolsState.length === 0 ? (
                    <div className="text-fg-muted italic text-[11px]">{t('mcp.noTools')}</div>
                  ) : (
                    toolsState.map((t) => (
                      <div key={t.id} className="text-[11px]">
                        <span className="font-mono text-fg-secondary">{t.name}</span>
                        {t.description && (
                          <span className="text-fg-muted ml-2">{t.description}</span>
                        )}
                      </div>
                    ))
                  )}
                </div>
              )}
              {toolsState === 'loading' && (
                <div className="border-t border-border-default px-2 py-1 text-fg-muted italic text-[11px]">
                  {t('mcp.loadingTools')}
                </div>
              )}
              {toolsState === 'error' && (
                <div className="border-t border-border-default px-2 py-1 text-danger/80 text-[11px]">
                  {t('mcp.loadToolsFailed')}
                </div>
              )}
              {/* F039 Diag panel —— mcp.logs IPC 拿到的 diagnostic envelope。
                  字段都是 string，列表式渲染足够。lastError 是关键 debug 信息，单独大段显示。 */}
              {diagState[row.serverId] === 'loading' && (
                <div className="border-t border-border-default px-2 py-1 text-fg-muted italic text-[11px]">
                  {t('mcp.loadingDiagnostics')}
                </div>
              )}
              {diagState[row.serverId] === 'error' && (
                <div className="border-t border-border-default px-2 py-1 text-danger/80 text-[11px]">
                  {t('mcp.loadDiagnosticsFailed')}
                </div>
              )}
              {typeof diagState[row.serverId] === 'object' &&
                diagState[row.serverId] !== null &&
                (() => {
                  const diag = diagState[row.serverId] as DiagSnapshot;
                  return (
                    <div className="border-t border-border-default px-2 py-1.5 space-y-1 text-[11px]">
                      <div className="grid grid-cols-[80px_1fr] gap-x-2 gap-y-0.5">
                        <span className="text-fg-muted">connect</span>
                        <span className="font-mono text-fg-secondary">{diag.connect}</span>
                        <span className="text-fg-muted">status</span>
                        <span className="font-mono text-fg-secondary">{diag.status}</span>
                        {diag.cachedAt && (
                          <>
                            <span className="text-fg-muted">cachedAt</span>
                            <span className="font-mono text-fg-muted">{diag.cachedAt}</span>
                          </>
                        )}
                      </div>
                      {diag.lastError && (
                        <div>
                          <div className="text-fg-muted uppercase tracking-wider mt-1">
                            {t('mcp.lastError')}
                          </div>
                          <pre className="mt-0.5 text-danger/80 whitespace-pre-wrap break-words font-mono">
                            {diag.lastError}
                          </pre>
                        </div>
                      )}
                    </div>
                  );
                })()}
            </div>
          );
        })}

        {extensions.length > 0 && (
          <div className="mt-3">
            <div className="text-[11px] uppercase tracking-wider text-fg-muted mb-1.5">
              {t('mcp.installedExtensions', { count: extensions.length })}
            </div>
            <ul className="space-y-1">
              {extensions.map((ext) => (
                <li
                  key={ext.extensionId}
                  className="border border-border-default/60 rounded bg-surface-2/30 px-2 py-1.5"
                >
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-fg-primary truncate flex-1">
                      {ext.displayName} <span className="text-fg-muted">v{ext.version}</span>
                    </span>
                    {ext.toolCount > 0 && (
                      <span className="text-[11px] text-fg-muted font-mono">
                        {t('mcp.toolsCount', { count: ext.toolCount })}
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => void uninstallExtension(ext.extensionId, ext.displayName)}
                      className="px-1.5 py-0.5 text-[11px] rounded text-fg-muted hover:text-danger hover:bg-hover-bg"
                      title={t('mcp.uninstall')}
                    >
                      {t('mcp.remove')}
                    </button>
                  </div>
                  {ext.description && (
                    <div
                      className="mt-0.5 text-[11px] text-fg-muted truncate"
                      title={ext.description}
                    >
                      {ext.description}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}

        {discoverErrors.length > 0 && (
          <div className="mt-3">
            <div className="text-[11px] uppercase tracking-wider text-warn mb-1.5">
              {t('mcp.configErrors', { count: discoverErrors.length })}
            </div>
            <ul className="space-y-1">
              {discoverErrors.map((e, idx) => (
                <li key={`${e.path}:${idx}`} className="text-[11px] text-warn/70 font-mono">
                  {/* 2026-06-18: 配置出错时最该做的是"打开那个文件去修" → 路径可点击定位。 */}
                  <button
                    type="button"
                    onClick={() => void revealPath(e.path, currentProjectPath)}
                    title={t('mcp.revealConfigErrorPath', { path: e.path })}
                    className="w-full text-left flex items-center gap-1 hover:text-warn"
                  >
                    <FileNameText name={e.path} className="flex-1" />
                    <FolderOpen
                      className="w-3 h-3 flex-shrink-0 opacity-70"
                      strokeWidth={1.75}
                      aria-hidden
                    />
                  </button>
                  <div className="text-warn/50 pl-2 truncate" title={e.error}>
                    {e.error}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
