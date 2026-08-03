// LeftSidebar — F011-revised + FEATURE_033 tree view
//
// Claude Desktop 风左侧侧栏：
//   ┌─────────────┐
//   │ [Coder][Partner]  ← surface tab (F045: Partner 可点，SurfaceTabs 组件)
//   │
//   │ + New session
//   │ ▾ More features  Coming soon  (未来功能默认折叠)
//   │
//   │ Recents ────────────────
//   │   · 项目分析
//   │     ⑂ 项目分析 (fork)         ← FEATURE_033 fork child 缩进显示
//   │   · 修个 bug
//   └─────────────┘
//
// ADR-004 v2 决策：常驻 Coder/Partner tab。F045 起 Partner 可点（抽到 SurfaceTabs 组件，
// 接 surface store）；LeftSidebar 是两 surface 共用的全局导航（项目 / session / surface tab）。

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Plus, ChevronDown, Ellipsis, FolderTree, Monitor, Pin, SquarePen } from 'lucide-react';
import { SurfaceTabs } from './SurfaceTabs.js';
import { useAppStore } from '../store/appStore.js';
import { useSurfaceStore } from '../store/surface.js';
import { Caret } from '../components/Caret.js';
import {
  canonProjectRoot,
  type SessionMeta,
  type RunningSessionInfoT,
  type SupportedLocaleT,
} from '@kodax-space/space-ipc-schema';
import { SessionContextMenu } from './SessionContextMenu.js';
import { ProjectContextMenu } from './ProjectContextMenu.js';
import { ProjectSessionPicker } from './ProjectSessionPicker.js';
import { RecentsFilterMenu } from './RecentsFilterMenu.js';
import { SidebarFooter } from './SidebarFooter.js';
import { WorkflowNavPanel } from '../features/workflow/WorkflowNavPanel.js';
import { useSessionStatusMap, type SessionStatus } from '../features/session/useSessionStatus.js';
import { SessionAwaitingIndicator } from '../features/session/SessionAwaitingIndicator.js';
import { prioritizeAttentionItems } from '../features/session/sessionInteractionRouting.js';
import { pushToast } from '../store/toastStore.js';
import type { Project } from '@kodax-space/space-ipc-schema';
import { useI18n } from '../i18n/I18nProvider.js';
import { invokeWithTimeout } from '../lib/ipcInvokeWithTimeout.js';
import { runningPeerAction } from './runningPeerAction.js';

type SessionLoadPhase = 'loading' | 'loaded' | 'error';
type SessionLoadStateByScope = Readonly<Record<string, SessionLoadPhase | undefined>>;

function sessionLoadScopeKey(projectRoot: string, surface: string): string {
  return `${surface}:${canonProjectRootBrowser(projectRoot)}`;
}

interface LeftSidebarProps {
  /** 2026-06: 动态宽度（px）。Shell 拖 ResizeHandle 实时改这个值。 */
  width?: number;
  readonly filesActive?: boolean;
  readonly onOpenFiles?: () => void;
  readonly onOpenSettings: () => void;
}

export function LeftSidebar({
  width,
  filesActive = false,
  onOpenFiles,
  onOpenSettings,
}: LeftSidebarProps): JSX.Element {
  const { t } = useI18n();
  const sessions = useAppStore((s) => s.sessions);
  const projects = useAppStore((s) => s.projects);
  const currentSessionId = useAppStore((s) => s.currentSessionId);
  const setCurrentSession = useAppStore((s) => s.setCurrentSession);
  const currentProjectPath = useAppStore((s) => s.currentProjectPath);
  // F045: 当前工作面（Coder / Partner）。session 列表按 surface 分面——切 surface 重新拉。
  const currentSurface = useSurfaceStore((s) => s.currentSurface);
  const visibleSessions = useMemo(
    () => sessions.filter((s) => (s.surface ?? 'code') === currentSurface),
    [sessions, currentSurface],
  );

  const [sessionLoadStateByScope, setSessionLoadStateByScope] = useState<
    Record<string, SessionLoadPhase | undefined>
  >({});
  const sessionListRequestIds = useRef(new Map<string, number>());

  const loadProjectSessions = useCallback(
    async (projectRoot: string): Promise<void> => {
      const bridge = window.kodaxSpace;
      if (!bridge) return;

      const scopeKey = sessionLoadScopeKey(projectRoot, currentSurface);
      const requestId = (sessionListRequestIds.current.get(scopeKey) ?? 0) + 1;
      sessionListRequestIds.current.set(scopeKey, requestId);
      setSessionLoadStateByScope((current) => ({ ...current, [scopeKey]: 'loading' }));

      try {
        const result = await bridge.invoke('session.list', {
          projectRoot,
          surface: currentSurface,
        });
        if (sessionListRequestIds.current.get(scopeKey) !== requestId) return;

        if (!result.ok) {
          setSessionLoadStateByScope((current) => ({ ...current, [scopeKey]: 'error' }));
          return;
        }

        useAppStore.getState().replaceSessionsForScope(result.data.sessions, {
          projectRoot,
          surface: currentSurface,
        });
        setSessionLoadStateByScope((current) => ({ ...current, [scopeKey]: 'loaded' }));
      } catch {
        if (sessionListRequestIds.current.get(scopeKey) !== requestId) return;
        setSessionLoadStateByScope((current) => ({ ...current, [scopeKey]: 'error' }));
      }
    },
    [currentSurface],
  );

  // 多项目 sidebar 的 recent 上限必须按项目计算。一次无 projectRoot 的全局 200 条查询会被
  // 单个活跃项目吃满，随后让其它项目错误显示“暂无会话”。逐项目拉取后，每个项目都拥有
  // 自己的 200 条最近窗口；显式“展示全部”再由 ProjectSessionPicker 按需扩大到 50,000。
  useEffect(() => {
    const bridge = window.kodaxSpace;
    if (!bridge) return;
    const candidates = [currentProjectPath, ...projects.map((project) => project.path)].filter(
      (projectPath): projectPath is string => projectPath !== null,
    );
    const roots = [
      ...new Map(
        candidates.map((projectPath) => [canonProjectRootBrowser(projectPath), projectPath]),
      ).values(),
    ];
    if (roots.length === 0) return;

    // Each project lands independently. A slow project must not keep every other
    // project looking empty while an aggregate Promise waits for the tail.
    for (const projectRoot of roots) void loadProjectSessions(projectRoot);
  }, [currentProjectPath, loadProjectSessions, projects]);

  /**
   * + New session：统一首页与新建。不再急建空 session（那会跳进零消息空白对话页，
   * 还往 RECENTS 塞一条 Untitled 空壳）；改为回到"无 session"落地态 —— WelcomeDashboard
   * + composer。真正的 session 由 BottomBar.ensureSession 在首次发送时懒建，用同一个
   * resolveSessionCreateInputs（pending → Space default → KodaX default）解析 provider/mode，
   * 所以 provider / 模式选择一点不丢（见 createSession.ts 头注释：两处调用已统一到该 helper）。
   */
  function handleNewSession(): void {
    setCurrentSession(null);
  }

  function handleOpenFiles(): void {
    onOpenFiles?.();
  }

  // open/setOpen 由 Shell 顶层 breadcrumb 行的 SidebarToggleButton 直接管理；
  // open=false 时 Shell 不会渲染本组件（不再保留竖条占位 — 避免无信息密度的 dead zone）

  return (
    <aside
      data-testid="left-sidebar"
      style={width !== undefined ? { width: `${width}px` } : undefined}
      className="glass lift ix-zone flex flex-col border border-border-default rounded-xl overflow-hidden bg-surface flex-shrink-0 text-[13px]"
    >
      {/* Surface tab — F045: [Coder][Partner] 切换（Partner 自本版起可点） */}
      <SurfaceTabs />

      {/* New session + menus */}
      <div className="p-2 space-y-1">
        <button
          type="button"
          onClick={handleNewSession}
          disabled={!currentProjectPath}
          className="w-full text-left text-xs px-2 py-1.5 rounded hover:bg-hover-bg text-fg-primary flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-transparent"
          title={!currentProjectPath ? t('sidebar.openFolderFirst') : t('sidebar.newSession')}
        >
          <Plus className="w-4 h-4 flex-shrink-0" strokeWidth={1.75} aria-hidden />
          {t('sidebar.newSession')}
        </button>
        <WorkflowNavPanel />
        <button
          type="button"
          onClick={handleOpenFiles}
          disabled={!currentProjectPath}
          className={`w-full text-left text-xs px-2 py-1.5 rounded hover:bg-hover-bg flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-transparent ${
            filesActive ? 'bg-surface-3 text-fg-primary' : 'text-fg-primary'
          }`}
          title={!currentProjectPath ? t('sidebar.openFolderFirst') : t('files.openProjectFiles')}
          aria-pressed={filesActive}
        >
          <FolderTree className="w-4 h-4 flex-shrink-0" strokeWidth={1.75} aria-hidden />
          {t('files.openProjectFiles')}
        </button>
        <FutureFeaturesDisclosure />
      </div>

      {/* F017 Running peers — 其他 KodaX 进程（CLI / 别的 Space 窗口）当前活动的 session。
          peers.length === 0 时整段隐藏不占空间。 */}
      <RunningPeersPanel />

      {/* Recents 标题 + 过滤按钮 (对齐 Claude Desktop 截图 3 的 ⚙) */}
      <RecentsHeader />

      <div className="flex-1 overflow-y-auto px-1.5 pb-2">
        {visibleSessions.length === 0 && projects.length === 0 && (
          <div className="text-xs text-fg-muted px-2 py-3">
            {currentProjectPath ? t('sidebar.noSessionsYet') : t('sidebar.openFolderToStart')}
          </div>
        )}
        {/* F040: 多项目可折叠树。currentProjectPath 默认展开 + 高亮；
            其它项目折叠。状态点驱动来自 useSessionStatusMap。 */}
        <ProjectTree
          sessions={visibleSessions}
          currentSessionId={currentSessionId}
          onSelect={setCurrentSession}
          sessionLoadStateByScope={sessionLoadStateByScope}
          onRefreshProjectSessions={loadProjectSessions}
        />
      </div>

      <SidebarFooter onOpenSettings={onOpenSettings} />
    </aside>
  );
}

/**
 * F040: 多项目可折叠树外层。
 *
 * 顶层 = 已打开过的所有项目（store.projects），按 lastUsedAt 倒序。当前项目默认展开
 * 且高亮；其它项目折叠态。展开状态持久化到 localStorage（store.expandedProjects）。
 *
 * 每项目内复用 SessionTree（传 projectRootOverride 强制按本项目 path 过滤，不受
 * recentsFilter.projectScope 影响）。状态点：useSessionStatusMap 一次拍全部 session
 * 状态，按需传给每个 SessionTree。
 *
 * 折叠项目节点显示运行数计数（🟢N），让用户一眼看到哪个项目里有 agent 在跑。
 *
 * 边界：
 *   - store.projects 为空 → 不渲染（fallback 到上方"Open a folder"提示）
 *   - 某项目在 store.projects 但没 sessions → 仍渲染节点但展开后空（提示用户）
 *   - 某 session 的 projectRoot 不在 store.projects → 漏出来不渲染（orphan）；
 *     这不应发生（projectStore 用 SDK listSessions 来源 + project.recent.add），
 *     如果真发生说明 SDK 给了脏数据，安全做法是隐藏不暴露
 */
function ProjectTree({
  sessions,
  currentSessionId,
  onSelect,
  sessionLoadStateByScope,
  onRefreshProjectSessions,
}: {
  readonly sessions: readonly SessionMeta[];
  readonly currentSessionId: string | null;
  readonly onSelect: (sessionId: string) => void;
  readonly sessionLoadStateByScope: SessionLoadStateByScope;
  readonly onRefreshProjectSessions: (projectRoot: string) => Promise<void>;
}): JSX.Element | null {
  const { t } = useI18n();
  const currentSurface = useSurfaceStore((s) => s.currentSurface);
  const projects = useAppStore((s) => s.projects);
  const setProjects = useAppStore((s) => s.setProjects);
  const currentProjectPath = useAppStore((s) => s.currentProjectPath);
  const expandedProjects = useAppStore((s) => s.expandedProjects);
  const toggleProjectExpanded = useAppStore((s) => s.toggleProjectExpanded);
  // v0.1.9 Step 7 — 拖排顺序 + archived 折叠状态 (持久化)
  const projectOrder = useAppStore((s) => s.projectOrder);
  const reorderProjects = useAppStore((s) => s.reorderProjects);
  const archivedExpanded = useAppStore((s) => s.archivedProjectsExpanded);
  const setArchivedExpanded = useAppStore((s) => s.setArchivedProjectsExpanded);

  // F043: 项目级 contextmenu 状态 + inline rename
  const [projCtxMenu, setProjCtxMenu] = useState<{ project: Project; x: number; y: number } | null>(
    null,
  );
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  // v0.1.9 Step 7 — DnD: 拖动中的 source canon path (UI 高亮 + drop 时算位置)
  const [dragSrcCanon, setDragSrcCanon] = useState<string | null>(null);
  const [dragOverCanon, setDragOverCanon] = useState<string | null>(null);
  // v0.1.9: "+N more sessions" picker overlay — 哪个项目正在浏览全量
  const [pickerProject, setPickerProject] = useState<Project | null>(null);
  const [projectSessionLimits, setProjectSessionLimits] = useState<Record<string, number>>({});

  const expandProjectSessionList = useCallback((projectPath: string): void => {
    setProjectSessionLimits((prev) => {
      const current = prev[projectPath] ?? SESSIONS_PER_PROJECT_INITIAL_VISIBLE;
      const next = Math.min(SESSIONS_PER_PROJECT_INLINE_MAX, current + SESSIONS_PER_PROJECT_STEP);
      if (next === current) return prev;
      return { ...prev, [projectPath]: next };
    });
  }, []);

  const collapseProjectSessionList = useCallback((projectPath: string): void => {
    setProjectSessionLimits((prev) => {
      const current = prev[projectPath] ?? SESSIONS_PER_PROJECT_INITIAL_VISIBLE;
      if (current === SESSIONS_PER_PROJECT_INITIAL_VISIBLE) return prev;
      const next = { ...prev };
      delete next[projectPath];
      return next;
    });
  }, []);

  const toggleProjectAndRefresh = useCallback(
    (projectPath: string, defaultExpanded: boolean, isExpanded: boolean): void => {
      toggleProjectExpanded(projectPath, defaultExpanded);
      if (isExpanded) return;
      void onRefreshProjectSessions(projectPath);
    },
    [onRefreshProjectSessions, toggleProjectExpanded],
  );

  // refresh local projects from main after IPC mutation
  const refreshProjects = useCallback(async (): Promise<void> => {
    if (!window.kodaxSpace) return;
    const r = await window.kodaxSpace.invoke('project.list', undefined);
    if (r.ok) {
      setProjects(r.data.projects);
    } else {
      // MED-4 fix：原静默 drop → sidebar 跟 main 端不一致；surface error 让用户重试
      pushToast(t('sidebar.refreshFailed'), 'error');
    }
  }, [setProjects, t]);

  // 全 session id 列表 → 一次拿状态 map（reducer 内部按 id 切片，比每个 SessionRow 单独 hook 省 N 次 store subscribe）
  const allSessionIds = useMemo(() => sessions.map((s) => s.sessionId), [sessions]);
  const statusMap = useSessionStatusMap(allSessionIds);

  // 项目排序优先级:
  //   1. v0.1.9 Step 7: 用户拖排过 (projectOrder 非空) → 按 projectOrder 排,新项目追加到尾
  //   2. 旧默认: lastUsedAt 倒序
  // F043: archived 项目从主列表剔出,单独"Archived (N)"分组展示。
  const ordered = useMemo(() => {
    const active = projects.filter((p) => p.archived !== true);

    if (projectOrder.length > 0) {
      // 用户已拖排过: 按 projectOrder 索引排,不在里面的追加(按 lastUsedAt 内部排)。
      const orderIdx = new Map<string, number>();
      projectOrder.forEach((p, i) => orderIdx.set(p, i));
      return [...active].sort((a, b) => {
        const aIdx = orderIdx.get(canonProjectRootBrowser(a.path)) ?? Infinity;
        const bIdx = orderIdx.get(canonProjectRootBrowser(b.path)) ?? Infinity;
        if (aIdx !== bIdx) return aIdx - bIdx;
        return b.lastUsedAt - a.lastUsedAt;
      });
    }

    return [...active].sort((a, b) => b.lastUsedAt - a.lastUsedAt);
  }, [projects, projectOrder]);

  const archived = useMemo(
    () => projects.filter((p) => p.archived === true).sort((a, b) => b.lastUsedAt - a.lastUsedAt),
    [projects],
  );

  // 按 projectRoot 把 sessions 分组（用 canonProjectRoot 比较，避免 windows 大小写 / trailing
  // slash / 分隔符差异）。reviewer MED-2: 用不可变 spread 而非 push 原地改，遵循项目 immutability 规则。
  const sessionsByProject = useMemo(() => {
    const map = new Map<string, readonly SessionMeta[]>();
    for (const s of sessions) {
      const k = canonProjectRootBrowser(s.projectRoot);
      map.set(k, [...(map.get(k) ?? []), s]);
    }
    return map;
  }, [sessions]);

  // statusFor 闭包：从 statusMap 取，O(1)。给每个 SessionTree 共享同一个 closure。
  // reviewer MED-1: useCallback 让 reference 稳定跟 statusMap 走，避免 statusMap 没变时
  // 每次 ProjectTree 渲染都新建函数让下游 SessionTree 误重渲染。
  const statusFor = useCallback(
    (sid: string): SessionStatus => statusMap[sid] ?? 'idle',
    [statusMap],
  );

  // F043 review HIGH-1 修：blur=cancel, Enter=commit。原 onBlur 也调 submit 会让
  // Enter → setRenamingPath(null) → input unmount → blur 触发第二次 submit，并发两条 IPC。
  // 现在 onBlur 直接 setRenamingPath(null) 不动 IPC；只有 Enter 走 commit。
  const onRenameCommit = useCallback(
    async (proj: Project, newName: string): Promise<void> => {
      setRenamingPath(null);
      const trimmed = newName.trim();
      if (trimmed.length === 0 || trimmed === proj.name) return; // no-op / unchanged
      if (!window.kodaxSpace) return;
      const r = await window.kodaxSpace.invoke('project.recent.rename', {
        path: proj.path,
        name: trimmed,
      });
      if (!r.ok || !r.data.renamed) {
        pushToast(t('sidebar.renameFailed'), 'error');
        return;
      }
      await refreshProjects();
    },
    [refreshProjects, t],
  );

  // ⚠️ 早 return 必须放在所有 hooks 之后 —— 否则首次启动 (projects 空) 提前 return 会跳过
  //    下面的 onRenameCommit useCallback，项目注入后又执行，hooks 顺序不一致 → React #310 → 白屏。
  //    这是个反复踩过的坑：新增 hook 一律加在这行之前。
  if (ordered.length === 0 && archived.length === 0) return null;

  const renderProject = (proj: Project, treatAsCurrent: boolean): JSX.Element => {
    const projCanon = canonProjectRootBrowser(proj.path);
    const defaultExpanded = treatAsCurrent;
    const explicit = proj.path in expandedProjects ? expandedProjects[proj.path] : undefined;
    const isExpanded = explicit !== undefined ? explicit : defaultExpanded;
    const projSessions = sessionsByProject.get(projCanon) ?? [];
    const sessionLoadState =
      sessionLoadStateByScope[sessionLoadScopeKey(proj.path, currentSurface)] ??
      (window.kodaxSpace ? 'loading' : 'loaded');
    const isInitialSessionLoad = sessionLoadState === 'loading' && projSessions.length === 0;
    const visibleLimit = projectSessionLimits[proj.path] ?? SESSIONS_PER_PROJECT_INITIAL_VISIBLE;
    const runningCount = projSessions.reduce(
      (acc, s) => (statusMap[s.sessionId] === 'running' ? acc + 1 : acc),
      0,
    );
    const awaitingCount = projSessions.reduce(
      (acc, s) => (statusMap[s.sessionId] === 'awaiting' ? acc + 1 : acc),
      0,
    );
    const isRenaming = renamingPath === proj.path;

    // v0.1.9 Step 7 — DnD: 项目 row 整行 draggable。archived 项目不参与排序(语义上"已归档"
    // 用户的 mental model 跟主列表不同),只对 active list 启用。
    // review HIGH-3: 上下文菜单开着时禁拖 — 用户右键打开菜单后随手 mousedown 可能误触
    // dragstart,造成菜单 + drag 状态打架。
    const isArchivedRow = proj.archived === true;
    const isCtxMenuOnRow = projCtxMenu?.project.path === proj.path;
    const isDragSource = dragSrcCanon === projCanon;
    const isDragOverTarget = dragOverCanon === projCanon && dragSrcCanon !== null && !isDragSource;
    return (
      <div key={proj.path} className={`mb-1 ${isDragSource ? 'opacity-40' : ''}`}>
        <div
          draggable={!isArchivedRow && !isRenaming && !isCtxMenuOnRow}
          onDragStart={(e) => {
            if (isArchivedRow) return;
            setDragSrcCanon(projCanon);
            e.dataTransfer.effectAllowed = 'move';
            // 必须 setData 才能在 Firefox / 某些 Linux 上触发 drag (Chrome 不严要求,但写上更稳)
            try {
              e.dataTransfer.setData('text/plain', proj.path);
            } catch {
              /* fail silently */
            }
          }}
          onDragEnd={() => {
            setDragSrcCanon(null);
            setDragOverCanon(null);
          }}
          onDragOver={(e) => {
            if (isArchivedRow || dragSrcCanon === null || dragSrcCanon === projCanon) return;
            e.preventDefault(); // 允许 drop
            e.dataTransfer.dropEffect = 'move';
            if (dragOverCanon !== projCanon) setDragOverCanon(projCanon);
          }}
          onDragLeave={(e) => {
            // review HIGH-1: onDragLeave 也会在 cursor 移入 row 内子元素时触发(button / span 等),
            // 直接清 dragOverCanon 会让 outline 在 row 内闪烁。只有 cursor 真的离开整个 row
            // (relatedTarget 不在 row DOM 之内) 时才清。
            if (dragOverCanon !== projCanon) return;
            const related = e.relatedTarget as Node | null;
            if (related && (e.currentTarget as HTMLElement).contains(related)) return;
            setDragOverCanon(null);
          }}
          onDrop={(e) => {
            if (isArchivedRow) return;
            e.preventDefault();
            const src = dragSrcCanon;
            setDragSrcCanon(null);
            setDragOverCanon(null);
            if (!src || src === projCanon) return;
            reorderProjects(src, projCanon);
          }}
          className={`group/projectrow w-full text-xs px-2 py-1 rounded flex items-center gap-1.5 ${
            treatAsCurrent
              ? 'text-fg-primary font-semibold'
              : 'text-fg-secondary hover:bg-hover-bg hover:text-fg-primary'
          } ${isDragOverTarget ? 'outline outline-1 outline-info/60' : ''}`}
          onContextMenu={(e) => {
            e.preventDefault();
            setProjCtxMenu({ project: proj, x: e.clientX, y: e.clientY });
          }}
          title={proj.path}
        >
          <button
            type="button"
            onClick={() => toggleProjectAndRefresh(proj.path, defaultExpanded, isExpanded)}
            className="text-fg-muted flex-shrink-0"
            aria-label={isExpanded ? t('sidebar.collapseProject') : t('sidebar.expandProject')}
            aria-expanded={isExpanded}
          >
            <Caret open={isExpanded} />
          </button>
          {isRenaming ? (
            <input
              type="text"
              defaultValue={proj.name}
              autoFocus
              maxLength={256}
              className="flex-1 bg-surface-2 border border-border-strong rounded px-1 py-0.5 text-xs text-fg-primary outline-none focus:border-border-strong"
              onBlur={() => setRenamingPath(null)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void onRenameCommit(proj, e.currentTarget.value);
                } else if (e.key === 'Escape') {
                  e.preventDefault();
                  setRenamingPath(null);
                }
              }}
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <button
              type="button"
              onClick={() => toggleProjectAndRefresh(proj.path, defaultExpanded, isExpanded)}
              className="flex-1 text-left truncate"
              aria-expanded={isExpanded}
            >
              {proj.name}
            </button>
          )}
          {awaitingCount > 0 && !isRenaming && (
            <span
              className="text-warn text-[11px] flex-shrink-0 font-mono inline-flex items-center gap-1"
              aria-label={t('sidebar.awaitingCountAria', { count: awaitingCount })}
              title={t('sidebar.awaitingCountTitle', { count: awaitingCount })}
            >
              <SessionAwaitingIndicator
                mini
                decorative
                label={t('sidebar.awaitingCountTitle', { count: awaitingCount })}
              />
              {awaitingCount}
            </span>
          )}
          {runningCount > 0 && !isRenaming && (
            <span
              className="text-run text-[11px] flex-shrink-0 font-mono inline-flex items-center gap-1"
              aria-label={t('sidebar.runningCountAria', { count: runningCount })}
              title={t('sidebar.runningCountTitle', { count: runningCount })}
            >
              <span className="sidebar-status-spinner sidebar-status-spinner--mini" aria-hidden />
              {runningCount}
            </span>
          )}
          {isInitialSessionLoad && runningCount === 0 && awaitingCount === 0 && !isRenaming && (
            <span
              className="sidebar-session-load-spinner"
              aria-hidden
              title={t('sidebar.loadingSessions')}
            />
          )}
          {/* F132: Codex-aligned project actions — menu first, then new task. */}
          {!isRenaming && (
            <span
              className={`flex shrink-0 items-center gap-0.5 transition-opacity ${
                treatAsCurrent
                  ? 'opacity-100'
                  : 'opacity-0 group-hover/projectrow:opacity-100 group-focus-within/projectrow:opacity-100'
              }`}
            >
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  const rect = (e.currentTarget as HTMLButtonElement).getBoundingClientRect();
                  setProjCtxMenu({ project: proj, x: rect.left - 16, y: rect.bottom + 4 });
                }}
                className="inline-flex h-6 w-6 items-center justify-center rounded-md text-fg-muted hover:bg-hover-bg hover:text-fg-primary"
                aria-label={t('sidebar.projectActions', { name: proj.name })}
                title={t('sidebar.moreActions')}
              >
                <Ellipsis className="h-4 w-4" strokeWidth={1.75} aria-hidden />
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  // 切到此项目 + 清 current session → BottomBar.ensureSession 在首发时
                  // 懒建一个新 session（跟顶部 New session 按钮同一路径）。
                  const state = useAppStore.getState();
                  state.setCurrentProject(proj.path);
                  state.setCurrentSession(null);
                }}
                className="inline-flex h-6 w-6 items-center justify-center rounded-md text-fg-muted hover:bg-hover-bg hover:text-fg-primary"
                aria-label={`${t('sidebar.newSessionInProject')}: ${proj.name}`}
                title={t('sidebar.newSessionInProject')}
              >
                <SquarePen className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden />
              </button>
            </span>
          )}
        </div>
        {isExpanded && (
          <div className="ml-1">
            {isInitialSessionLoad ? (
              <SessionListSkeleton label={t('sidebar.loadingSessions')} />
            ) : sessionLoadState === 'error' && projSessions.length === 0 ? (
              <div
                className="flex items-center gap-1.5 px-3 py-1 text-[11px] text-fg-muted"
                role="alert"
              >
                <span>{t('sidebar.sessionsLoadFailed')}</span>
                <button
                  type="button"
                  className="rounded px-1 py-0.5 text-fg-secondary hover:bg-hover-bg hover:text-fg-primary"
                  onClick={() => void onRefreshProjectSessions(proj.path)}
                >
                  {t('sidebar.retrySessions')}
                </button>
              </div>
            ) : projSessions.length === 0 ? (
              <div className="text-[11px] text-fg-muted italic px-3 py-1">
                {t('sidebar.noProjectSessions')}
              </div>
            ) : (
              <SessionTree
                sessions={projSessions}
                currentSessionId={currentSessionId}
                onSelect={onSelect}
                projectRootOverride={proj.path}
                statusFor={statusFor}
                maxVisible={visibleLimit}
                initialVisible={SESSIONS_PER_PROJECT_INITIAL_VISIBLE}
                maxInlineVisible={SESSIONS_PER_PROJECT_INLINE_MAX}
                onExpandMore={() => expandProjectSessionList(proj.path)}
                onShowAll={() => setPickerProject(proj)}
                onCollapseVisible={() => collapseProjectSessionList(proj.path)}
              />
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    // review HIGH-2: 包一个 wrapper 让 onDragLeave / onDragEnd 兜底 — 用户拖出 sidebar
    // 整个 area 后 (浏览器有时不会发 row 的 onDragLeave),outline 不会被永久 stuck。
    <div
      onDragLeave={(e) => {
        const related = e.relatedTarget as Node | null;
        // related 不在 wrapper 内 = 拖出本 list
        if (related && (e.currentTarget as HTMLElement).contains(related)) return;
        if (dragOverCanon !== null) setDragOverCanon(null);
      }}
      onDragEnd={() => {
        // 浏览器有时只在 source 上发 onDragEnd,有时在 document 上 — wrapper 多挂一道,
        // 兜底清掉拖动状态。
        if (dragSrcCanon !== null) setDragSrcCanon(null);
        if (dragOverCanon !== null) setDragOverCanon(null);
      }}
    >
      {ordered.map((proj) => {
        const projCanon = canonProjectRootBrowser(proj.path);
        const isCurrent = currentProjectPath
          ? projCanon === canonProjectRootBrowser(currentProjectPath)
          : false;
        return renderProject(proj, isCurrent);
      })}

      {archived.length > 0 && (
        <div className="mt-3 pt-2 border-t border-border-default/40">
          <button
            type="button"
            onClick={() => setArchivedExpanded(!archivedExpanded)}
            className="w-full text-left text-[11px] uppercase tracking-wider text-fg-muted hover:text-fg-secondary px-2 py-1 flex items-center gap-1.5"
            aria-expanded={archivedExpanded}
          >
            <Caret open={archivedExpanded} />
            {t('sidebar.archived')} ({archived.length})
          </button>
          {archivedExpanded && (
            <div className="opacity-60">{archived.map((proj) => renderProject(proj, false))}</div>
          )}
        </div>
      )}

      {projCtxMenu && (
        <ProjectContextMenu
          project={projCtxMenu.project}
          x={projCtxMenu.x}
          y={projCtxMenu.y}
          onClose={() => setProjCtxMenu(null)}
          onPinProject={() => {
            const first = ordered[0];
            if (!first) return;
            reorderProjects(
              canonProjectRootBrowser(projCtxMenu.project.path),
              canonProjectRootBrowser(first.path),
            );
          }}
          onStartRename={() => {
            setRenamingPath(projCtxMenu.project.path);
            setProjCtxMenu(null);
          }}
          onProjectsChanged={refreshProjects}
        />
      )}

      {pickerProject && (
        <ProjectSessionPicker
          key={`${pickerProject.path}:${currentSurface}`}
          projectName={pickerProject.name}
          projectPath={pickerProject.path}
          surface={currentSurface}
          // 把本项目所有 session 按 lastActivityAt desc 排好传进去
          sessions={(sessionsByProject.get(canonProjectRootBrowser(pickerProject.path)) ?? [])
            .slice()
            .sort((a, b) => b.lastActivityAt - a.lastActivityAt)}
          currentSessionId={currentSessionId}
          onSelect={(sid) => {
            useAppStore.getState().setCurrentProject(pickerProject.path);
            onSelect(sid);
          }}
          onClose={() => setPickerProject(null)}
        />
      )}
    </div>
  );
}

function SessionListSkeleton({ label }: { readonly label: string }): JSX.Element {
  const widths = ['72%', '54%', '64%'] as const;
  return (
    <div className="space-y-0.5 px-2 py-1" role="status" aria-live="polite">
      <span className="sr-only">{label}</span>
      {widths.map((width, index) => (
        <div key={width} className="flex h-6 items-center gap-2 rounded px-1.5" aria-hidden="true">
          <span
            className="sidebar-session-skeleton sidebar-session-skeleton--dot"
            style={{ animationDelay: `${index * 90}ms` }}
          />
          <span
            className="sidebar-session-skeleton h-2 rounded-full"
            style={{ width, animationDelay: `${index * 90}ms` }}
          />
        </div>
      ))}
    </div>
  );
}

/**
 * FEATURE_033: 按 parentSessionId 把 sessions 排成 root → children 树。
 * 渲染顺序：每个 root 紧跟其 descendants（DFS pre-order）；fork child 缩进 + 用 ⑂ 图标。
 *
 * 边界处理：
 *   - parent 已被 delete 了 → orphan：当 root 渲染（仍能选中、不丢）
 *   - cycle 防御：DFS 走过的 id 不再重复进入
 */
interface SessionTreeProps {
  readonly sessions: readonly SessionMeta[];
  readonly currentSessionId: string | null;
  readonly onSelect: (sessionId: string) => void;
  /** F040: 多项目模式时由 ProjectTree 传该项目路径，覆盖 filter.projectScope 行为，
   *  让每个 SessionTree 严格只渲染自己项目的 session。缺省走原来的 projectScope filter。 */
  readonly projectRootOverride?: string;
  /** F040: 每行末尾的状态点。idle 不渲染（避免噪音）；缺省整个 sidebar 都不显示状态。 */
  readonly statusFor?: (sessionId: string) => SessionStatus;
  /** 默认显示上限。超过 cap 时下方渲染展开/全部/折叠动作；undefined = 不 cap (legacy). */
  readonly maxVisible?: number;
  readonly initialVisible?: number;
  readonly maxInlineVisible?: number;
  readonly onExpandMore?: () => void;
  readonly onShowAll?: () => void;
  readonly onCollapseVisible?: () => void;
}

// v0.1.5: canonProjectRootBrowser 替换为 schema 包共享 util（F040/F041 review MED-3）。
// 旧实现跟 main 侧 normalize 算法略有差异 (Windows UNC / 多重分隔符) → 现在两边走同一函数。
const IS_WIN = typeof navigator !== 'undefined' && /Windows/i.test(navigator.userAgent);
function canonProjectRootBrowser(p: string): string {
  return canonProjectRoot(p, IS_WIN);
}

// 项目下默认显示 5 个最近 session；每次轻量展开 5 个，最多内联 20 个。
// 再多时走中央 picker 模糊搜 + 选，避免长列表把其它项目挤出视野。
const SESSIONS_PER_PROJECT_INITIAL_VISIBLE = 5;
const SESSIONS_PER_PROJECT_STEP = 5;
const SESSIONS_PER_PROJECT_INLINE_MAX = 20;

function SessionTree({
  sessions,
  currentSessionId,
  onSelect,
  projectRootOverride,
  statusFor,
  maxVisible,
  initialVisible,
  maxInlineVisible,
  onExpandMore,
  onShowAll,
  onCollapseVisible,
}: SessionTreeProps): JSX.Element {
  const { t } = useI18n();
  const sessionFlags = useAppStore((s) => s.sessionFlags);
  const filter = useAppStore((s) => s.recentsFilter);
  const currentProjectPath = useAppStore((s) => s.currentProjectPath);

  // 应用 filter：status / lastActivity / projectScope
  // F040：projectRootOverride 设了的话 projectScope filter 被替换为强等于该路径，
  //       让 ProjectTree 多项目模式下每个 SessionTree 严格只渲染自己项目的 session。
  const visible = useMemo(() => {
    const now = Date.now();
    const cutoff =
      filter.lastActivity === 'today'
        ? now - 24 * 3600 * 1000
        : filter.lastActivity === '7d'
          ? now - 7 * 24 * 3600 * 1000
          : filter.lastActivity === '30d'
            ? now - 30 * 24 * 3600 * 1000
            : 0;
    const overrideCanon = projectRootOverride ? canonProjectRootBrowser(projectRootOverride) : null;
    const curCanon = currentProjectPath ? canonProjectRootBrowser(currentProjectPath) : null;
    return sessions.filter((s) => {
      const f = sessionFlags[s.sessionId];
      if (filter.status === 'active' && f?.archived) return false;
      if (filter.status === 'archived' && !f?.archived) return false;
      if (overrideCanon !== null) {
        if (canonProjectRootBrowser(s.projectRoot) !== overrideCanon) return false;
      } else if (filter.projectScope === 'current' && curCanon) {
        if (canonProjectRootBrowser(s.projectRoot) !== curCanon) return false;
      }
      if (cutoff > 0 && s.lastActivityAt < cutoff) return false;
      return true;
    });
  }, [sessions, sessionFlags, filter, currentProjectPath, projectRootOverride]);

  // 排序：pinned 顶部 + sortBy 选项决定二级排序
  const rendered = useMemo(() => {
    const tree = buildSessionTreeOrder(visible, (id) => Boolean(sessionFlags[id]?.pinned));
    if (filter.sortBy === 'recency') return tree;
    // 对 flat tree 二次排序（树形结构下 alphabetical/created 仅排 root；children 保 DFS 序）
    return tree.slice().sort((a, b) => {
      if (a.depth !== b.depth) return a.depth - b.depth;
      if (filter.sortBy === 'alphabetical') {
        return (a.session.title ?? '').localeCompare(b.session.title ?? '');
      }
      // created
      return b.session.createdAt - a.session.createdAt;
    });
  }, [visible, sessionFlags, filter.sortBy]);
  // 右键菜单状态：哪个 session + 屏幕坐标
  const [ctxMenu, setCtxMenu] = useState<{ session: SessionMeta; x: number; y: number } | null>(
    null,
  );
  // 内联 rename：哪个 session 正在编辑（点 Rename / 双击触发）
  const [renamingSessionId, setRenamingSessionId] = useState<string | null>(null);

  // cap visible 行数。当前 Session 优先，其次是正在等待用户处理的 Session，避免关键交互
  // 被默认展示上限藏住；其余行仍保持原有顺序。
  const cappedRendered = useMemo(() => {
    if (maxVisible === undefined || rendered.length <= maxVisible) return rendered;
    return prioritizeAttentionItems(rendered, {
      maxVisible,
      currentId: currentSessionId,
      getId: (node) => node.session.sessionId,
      isAwaiting: (node) => statusFor?.(node.session.sessionId) === 'awaiting',
    });
  }, [rendered, maxVisible, currentSessionId, statusFor]);
  const overflowCount = maxVisible !== undefined ? rendered.length - cappedRendered.length : 0;
  const effectiveInitialVisible = initialVisible ?? maxVisible ?? rendered.length;
  const effectiveMaxInlineVisible = maxInlineVisible ?? maxVisible ?? rendered.length;
  const canExpandInline =
    maxVisible !== undefined &&
    overflowCount > 0 &&
    maxVisible < effectiveMaxInlineVisible &&
    onExpandMore !== undefined;
  const canShowAll =
    maxVisible !== undefined &&
    overflowCount > 0 &&
    maxVisible >= effectiveMaxInlineVisible &&
    onShowAll !== undefined;
  const canCollapse =
    maxVisible !== undefined &&
    maxVisible > effectiveInitialVisible &&
    rendered.length > effectiveInitialVisible &&
    onCollapseVisible !== undefined;
  const showOverflowControls = canExpandInline || canShowAll || canCollapse;

  return (
    <>
      {cappedRendered.map(({ session, depth }) => (
        <SessionRow
          key={session.sessionId}
          session={session}
          depth={depth}
          isSelected={session.sessionId === currentSessionId}
          flags={sessionFlags[session.sessionId]}
          isRenaming={renamingSessionId === session.sessionId}
          status={statusFor?.(session.sessionId)}
          onSelect={onSelect}
          onContextMenu={(x, y) => setCtxMenu({ session, x, y })}
          onStartRename={() => setRenamingSessionId(session.sessionId)}
          onCancelRename={() => setRenamingSessionId(null)}
        />
      ))}
      {showOverflowControls && (
        <div className="flex items-center gap-3 px-3 py-1 text-xs text-fg-muted">
          {canExpandInline && (
            <button
              type="button"
              onClick={onExpandMore}
              className="hover:text-fg-primary"
              title={t('sidebar.showMore')}
            >
              {t('sidebar.showMore')}
            </button>
          )}
          {canShowAll && (
            <button
              type="button"
              onClick={onShowAll}
              className="hover:text-fg-primary"
              aria-label={t('sidebar.moreSessions.aria', { count: rendered.length })}
              title={t('sidebar.moreSessions.aria', { count: rendered.length })}
            >
              {t('sidebar.showAll')}
            </button>
          )}
          {canCollapse && (
            <button
              type="button"
              onClick={onCollapseVisible}
              className="hover:text-fg-primary"
              title={t('sidebar.showLess')}
            >
              {t('sidebar.showLess')}
            </button>
          )}
        </div>
      )}
      {ctxMenu && (
        <SessionContextMenu
          session={ctxMenu.session}
          x={ctxMenu.x}
          y={ctxMenu.y}
          onClose={() => setCtxMenu(null)}
          onStartRename={() => {
            setRenamingSessionId(ctxMenu.session.sessionId);
            setCtxMenu(null);
          }}
        />
      )}
    </>
  );
}

interface SessionTreeNode {
  readonly session: SessionMeta;
  readonly depth: number;
}

/** DFS pre-order，root 按 (pinned 优先) → lastActivityAt 倒序；children 同样倒序。 */
export function buildSessionTreeOrder(
  sessions: readonly SessionMeta[],
  isPinned: (sessionId: string) => boolean = () => false,
): readonly SessionTreeNode[] {
  const byId = new Map<string, SessionMeta>(sessions.map((s) => [s.sessionId, s]));
  const childrenByParent = new Map<string, SessionMeta[]>();
  const roots: SessionMeta[] = [];
  for (const s of sessions) {
    if (s.parentSessionId !== undefined && byId.has(s.parentSessionId)) {
      const bucket = childrenByParent.get(s.parentSessionId) ?? [];
      bucket.push(s);
      childrenByParent.set(s.parentSessionId, bucket);
    } else {
      roots.push(s);
    }
  }
  // pinned 在前，其后按 lastActivityAt 倒序
  const orderFn = (a: SessionMeta, b: SessionMeta): number => {
    const pa = isPinned(a.sessionId) ? 1 : 0;
    const pb = isPinned(b.sessionId) ? 1 : 0;
    if (pa !== pb) return pb - pa;
    return b.lastActivityAt - a.lastActivityAt;
  };
  roots.sort(orderFn);
  for (const list of childrenByParent.values()) list.sort(orderFn);

  const out: SessionTreeNode[] = [];
  const visited = new Set<string>();
  function walk(s: SessionMeta, depth: number): void {
    if (visited.has(s.sessionId)) return; // cycle guard
    visited.add(s.sessionId);
    out.push({ session: s, depth });
    const kids = childrenByParent.get(s.sessionId) ?? [];
    for (const c of kids) walk(c, depth + 1);
  }
  for (const r of roots) walk(r, 0);
  return out;
}

function SessionRow({
  session,
  depth,
  isSelected,
  flags,
  isRenaming,
  status,
  onSelect,
  onContextMenu,
  onStartRename,
  onCancelRename,
}: {
  session: SessionMeta;
  depth: number;
  isSelected: boolean;
  flags: { pinned?: boolean; archived?: boolean; unread?: boolean } | undefined;
  isRenaming: boolean;
  /** F040: per-session 状态点。'idle' 不渲染。 */
  status?: SessionStatus;
  onSelect: (id: string) => void;
  onContextMenu: (x: number, y: number) => void;
  onStartRename: () => void;
  onCancelRename: () => void;
}): JSX.Element {
  const { effectiveLocale, t } = useI18n();
  const upsertSession = useAppStore((s) => s.upsertSession);
  const indent = Math.min(depth, 4); // 不无限缩进；4 层就够
  const padLeft = `${1.6 + indent * 0.9}rem`;
  const timeLabel = formatSidebarTime(session.lastActivityAt, effectiveLocale);
  const runtimeFallbackLabel =
    session.runtimeMetadataSource === 'current-default-fallback'
      ? t('session.runtimeFallback')
      : null;
  const statusLabel =
    status === 'awaiting'
      ? t('sidebar.status.awaiting')
      : status === 'error'
        ? t('sidebar.status.error')
        : status === 'running'
          ? t('sidebar.status.running')
          : null;

  async function commitRename(value: string): Promise<void> {
    const trimmed = value.trim().slice(0, 256);
    onCancelRename();
    if (trimmed === '' || trimmed === (session.title ?? '')) return;
    if (!window.kodaxSpace) return;
    const r = await invokeWithTimeout(window.kodaxSpace, 'session.setTitle', {
      sessionId: session.sessionId,
      title: trimmed,
    });
    if (r.ok) upsertSession({ ...session, title: trimmed });
  }

  if (isRenaming) {
    return (
      <div
        className="grid min-h-[1.625rem] grid-cols-[minmax(0,1fr)] items-center rounded px-2 py-1 text-xs bg-surface-3 text-fg-primary"
        style={{ paddingLeft: padLeft }}
      >
        <RenameInput
          initial={session.title ?? ''}
          onCommit={(v) => void commitRename(v)}
          onCancel={onCancelRename}
        />
      </div>
    );
  }

  return (
    <button
      type="button"
      data-testid="sidebar-session-row"
      data-session-id={session.sessionId}
      onClick={() => onSelect(session.sessionId)}
      onDoubleClick={onStartRename}
      onContextMenu={(e) => {
        e.preventDefault();
        onContextMenu(e.clientX, e.clientY);
      }}
      className={`group/sessionrow w-full min-w-0 text-left text-xs px-2 py-1 rounded grid grid-cols-[minmax(0,1fr)_4.25rem] items-center gap-2 min-h-[1.625rem] ${
        isSelected
          ? 'bg-surface-3 text-fg-primary'
          : 'text-fg-secondary hover:bg-hover-bg hover:text-fg-primary'
      }`}
      style={{ paddingLeft: padLeft }}
      title={`${session.title ?? session.sessionId} - ${timeLabel}${statusLabel ? ` - ${statusLabel}` : ''}${runtimeFallbackLabel ? ` - ${runtimeFallbackLabel}` : ''} (${t('sidebar.session.renameHint')})`}
    >
      <span className="min-w-0 truncate">{session.title ?? t('sidebar.session.untitled')}</span>
      <span className="flex min-w-0 items-center justify-end gap-1.5 text-[11px] text-fg-muted">
        {status === 'running' ? (
          <span className="sidebar-status-spinner" aria-hidden title={statusLabel ?? undefined} />
        ) : (
          <>
            {flags?.unread && (
              <span
                className="h-1.5 w-1.5 rounded-full bg-ok shadow-[0_0_0_2px_rgb(var(--ok)/0.12)]"
                aria-label={t('sidebar.status.unread')}
                title={t('sidebar.status.unread')}
              />
            )}
            {status === 'awaiting' && statusLabel && (
              <SessionAwaitingIndicator label={statusLabel} />
            )}
            {status === 'error' && (
              <span
                className="h-1.5 w-1.5 rounded-full bg-danger"
                aria-label={statusLabel ?? undefined}
                title={statusLabel ?? undefined}
              />
            )}
            {flags?.pinned && (
              <span aria-label={t('sidebar.status.pinned')} title={t('sidebar.status.pinned')}>
                <Pin className="h-3 w-3 text-fg-muted" strokeWidth={1.9} aria-hidden />
              </span>
            )}
            <span className="tnum min-w-[2.15rem] text-right leading-none">{timeLabel}</span>
          </>
        )}
      </span>
    </button>
  );
}

function formatSidebarTime(timestamp: number, locale: SupportedLocaleT): string {
  const diff = Math.max(0, Date.now() - timestamp);
  const isZh = locale === 'zh-CN';
  const min = Math.max(1, Math.floor(diff / 60_000));
  if (diff < 60_000) return isZh ? '刚刚' : 'now';
  if (min < 60) return isZh ? `${min} 分` : `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return isZh ? `${hr} 小时` : `${hr}h`;
  const day = Math.floor(hr / 24);
  if (day < 7) return isZh ? `${day} 天` : `${day}d`;
  const wk = Math.floor(day / 7);
  if (wk < 5) return isZh ? `${wk} 周` : `${wk}w`;
  const mo = Math.floor(day / 30);
  if (mo < 12) return isZh ? `${mo} 个月` : `${mo}mo`;
  const yr = Math.floor(day / 365);
  return isZh ? `${yr} 年` : `${yr}y`;
}

/** Inline rename input — Enter 提交、Esc / blur 取消（避免静默改名误操作） */
function RenameInput({
  initial,
  onCommit,
  onCancel,
}: {
  initial: string;
  onCommit: (value: string) => void;
  onCancel: () => void;
}): JSX.Element {
  const { t } = useI18n();
  const [value, setValue] = useState(initial);
  return (
    <input
      type="text"
      value={value}
      autoFocus
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          onCommit(value);
        } else if (e.key === 'Escape') {
          e.preventDefault();
          onCancel();
        }
      }}
      onBlur={onCancel}
      onFocus={(e) => e.currentTarget.select()}
      className="flex-1 bg-transparent text-fg-primary text-xs outline-none border-b border-border-strong focus:border-warn px-0.5 -mx-0.5"
      placeholder={t('sidebar.session.renamePlaceholder')}
      maxLength={256}
      aria-label={t('sidebar.session.renameAria')}
    />
  );
}

// F017 Running peers panel — 列其他 KodaX 进程当前活动的 session。
//   - 数据源：SDK listRunningSessions() 通过 session.listRunning IPC
//   - 轮询：10s 一次（cheap — 走 instance-state 文件读，不开 socket）
//   - 只允许打开 renderer 权威 session 列表中已经存在的 session；未知 peer 只给解释提示，
//     避免把孤立 id 写入 currentSessionId 后进入空白会话
//   - peers 为空时 panel 不渲染（不占侧栏空间）
function RunningPeersPanel(): JSX.Element | null {
  const { t } = useI18n();
  const [peers, setPeers] = useState<readonly RunningSessionInfoT[]>(EMPTY_PEERS);
  const sessions = useAppStore((s) => s.sessions);
  const setCurrentSession = useAppStore((s) => s.setCurrentSession);
  const currentSessionId = useAppStore((s) => s.currentSessionId);
  const knownSessionIds = useMemo(
    () => new Set(sessions.map((session) => session.sessionId)),
    [sessions],
  );

  useEffect(() => {
    let cancelled = false;
    async function refresh(force = false): Promise<void> {
      if (!force && (document.hidden || !document.hasFocus())) return;
      if (!window.kodaxSpace) return;
      const r = await window.kodaxSpace.invoke('session.listRunning', undefined);
      if (cancelled) return;
      if (r.ok) setPeers(r.data.peers);
    }
    void refresh(true);
    const interval = window.setInterval(() => void refresh(), 10_000);
    // window focus 也触发一次刷新——切回 Space 立刻看到新 peer 状态
    function onFocus(): void {
      void refresh(true);
    }
    function onVisibility(): void {
      if (document.visibilityState === 'visible') void refresh(true);
    }
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  if (peers.length === 0) return null;

  return (
    <div className="border-b border-border-default px-2 py-1.5">
      <div className="text-[11px] uppercase tracking-wider text-fg-muted mb-1 px-1 flex items-center gap-1.5">
        <span aria-hidden className="w-1.5 h-1.5 rounded-full bg-ok" />
        <span>{t('sidebar.runningPeers.count', { count: peers.length })}</span>
      </div>
      <div className="mb-1 px-1 text-[10px] leading-4 text-fg-faint">
        {t('sidebar.runningPeers.hint')}
      </div>
      {peers.map((p) => {
        const cwdName = (p.cwd.split(/[\\/]/).filter(Boolean).pop() ?? p.cwd).slice(0, 32);
        const ageSec = Math.max(0, Math.floor((Date.now() - p.startedAt) / 1000));
        const ageLabel =
          ageSec < 60
            ? `${ageSec}s`
            : ageSec < 3600
              ? `${Math.floor(ageSec / 60)}m`
              : `${Math.floor(ageSec / 3600)}h`;
        const action = runningPeerAction(p.sessionId, currentSessionId, knownSessionIds);
        return (
          <button
            key={`${p.pid}-${p.sessionId ?? 'bootstrapping'}`}
            type="button"
            onClick={() => {
              if (action === 'open' && p.sessionId) {
                setCurrentSession(p.sessionId);
                return;
              }
              if (action === 'explain') {
                pushToast(t('sidebar.runningPeers.continueInPeer'), 'info', 5000);
              }
            }}
            disabled={action === 'none'}
            className={[
              'w-full text-left text-xs px-1.5 py-1 rounded flex items-center gap-1.5',
              action !== 'none'
                ? 'hover:bg-hover-bg text-fg-secondary cursor-pointer'
                : 'text-fg-muted cursor-default',
            ].join(' ')}
            title={
              action === 'open' && p.sessionId
                ? t('sidebar.runningPeers.openTitle', {
                    pid: p.pid,
                    sessionId: p.sessionId,
                    cwd: p.cwd,
                  })
                : t('sidebar.runningPeers.instanceTitle', {
                    pid: p.pid,
                    cwd: p.cwd,
                  })
            }
          >
            <Monitor size={12} aria-hidden className="flex-shrink-0 text-fg-faint" />
            <span className="truncate flex-1">{cwdName}</span>
            <span className="text-[9px] text-fg-muted font-mono flex-shrink-0">{ageLabel}</span>
          </button>
        );
      })}
    </div>
  );
}

const EMPTY_PEERS: readonly RunningSessionInfoT[] = [];

function RecentsHeader(): JSX.Element {
  const { t } = useI18n();
  const [menuOpen, setMenuOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const filter = useAppStore((s) => s.recentsFilter);
  // 显示当前过滤 summary，给用户暗示"我现在看的是哪部分"
  const filterStatusLabel =
    filter.status === 'active'
      ? ''
      : filter.status === 'archived'
        ? t('sidebar.filter.status.archived')
        : t('sidebar.filter.status.all');
  const filterSortLabel =
    filter.sortBy === 'alphabetical'
      ? t('sidebar.filter.sort.alphabetical')
      : filter.sortBy === 'created'
        ? t('sidebar.filter.sort.created')
        : t('sidebar.filter.sort.recency');
  const summary =
    filter.status !== 'active' ||
    filter.lastActivity !== 'all' ||
    filter.sortBy !== 'recency' ||
    filter.groupBy !== 'none'
      ? `${filterStatusLabel ? `${filterStatusLabel} · ` : ''}${filterSortLabel}`
      : null;
  return (
    <div className="px-3 pt-3 pb-1 text-[11px] uppercase tracking-wider text-fg-muted flex justify-between items-center flex-shrink-0 relative">
      {/* F043 v0.1.9: 改为"Projects" — 实际形态就是项目折叠树，原 Recents 概念被
          ProjectTree 取代；点 ⇅ 仍调过滤菜单（session 级 active/archived/sort 等）。 */}
      <span>{t('sidebar.projects')}</span>
      <div className="flex items-center gap-2">
        {summary && <span className="normal-case text-fg-muted text-[9px]">{summary}</span>}
        <button
          ref={buttonRef}
          type="button"
          onClick={() => setMenuOpen((v) => !v)}
          className="text-fg-muted hover:text-fg-primary normal-case"
          aria-label={t('sidebar.filter.aria')}
          title={t('sidebar.filter.title')}
        >
          ⇅
        </button>
      </div>
      <RecentsFilterMenu
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        anchorEl={buttonRef.current}
      />
    </div>
  );
}

function FutureFeaturesDisclosure(): JSX.Element {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const futureLabels = [t('sidebar.scheduled'), t('sidebar.customize'), t('sidebar.more')].join(
    ' · ',
  );

  return (
    <div className="w-full">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="w-full min-w-0 rounded px-2 py-1.5 text-left text-xs text-fg-muted hover:bg-hover-bg hover:text-fg-primary flex items-center gap-2"
        title={`${t('sidebar.moreFeatures')} — ${t('sidebar.comingSoon')}`}
      >
        <ChevronDown
          className={`h-3.5 w-3.5 flex-shrink-0 transition-transform ${open ? '' : '-rotate-90'}`}
          strokeWidth={1.75}
          aria-hidden
        />
        <span className="min-w-0 truncate">{t('sidebar.moreFeatures')}</span>
        <span className="ml-auto shrink-0 rounded border border-border-default px-1.5 py-0.5 text-[9px] leading-none text-fg-muted">
          {t('sidebar.comingSoon')}
        </span>
      </button>
      {open && (
        <div className="px-7 pb-1.5 pt-0.5 text-[11px] leading-5 text-fg-muted">{futureLabels}</div>
      )}
    </div>
  );
}
