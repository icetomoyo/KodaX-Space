// Shell — F011-revised (alpha.1)
//
// Claude Desktop 风 layout 总入口，替代旧 App.tsx。
//
//   ┌───────────────────────────────────────────────────────────┐
//   │                    顶部空白 (drag region)                  │
//   ├──────┬────────────────────────────────────────────────────┤
//   │ Left │ Breadcrumb (project / session ▾)        CommandBar │
//   │ Side │ ─────────────────────────────────────────────────  │
//   │ bar  │                                                    │
//   │      │           ConversationStream (主区)                 │
//   │      │                                                    │
//   │      │ ─────────────────────────────────────────────────  │
//   │      │ ChipBar (Local · proj · branch)                    │
//   │      │ InputBox                                           │
//   │      │ Footer-row (mode · gateway · model+effort)         │
//   └──────┴────────────────────────────────────────────────────┘
//   ＋ 右上 popout overlay（按需呼出 Preview / Diff / Terminal / Tasks / Plan）
//
// 不在这里做的：
//   - IPC 连接 / store 订阅 → 留在各子组件
//   - popout 业务实现 → 留 popouts/ 子目录
//   - Permission modal / Settings overlay → 复用旧 App 的实现挂载点

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronDown,
  Copy,
  Info,
  Minus,
  PanelLeft,
  PanelRight,
  PawPrint,
  Square,
  X,
} from 'lucide-react';
import type {
  LanguageModeT,
  LicenseStatusT,
  SpaceCapabilityStatus,
  SpaceVersionOutput,
} from '@kodax-space/space-ipc-schema';
import { LeftSidebar } from './LeftSidebar.js';
import { ResizeHandle } from './ResizeHandle.js';
import { useSmartPopoutDirector } from '../features/popout-director/useSmartPopoutDirector.js';
import { Breadcrumb } from './Breadcrumb.js';
import { CommandToolbar, type PopoutKind } from './CommandToolbar.js';
import { BottomBar } from './BottomBar.js';
import { ConversationStreamV2 } from './ConversationStreamV2.js';
import { PopoutOverlay } from './popouts/PopoutOverlay.js';
import { FilesPanel } from './popouts/FilesPanel.js';
import { PermissionModal } from '../features/permission/PermissionModal.js';
import { AskUserModal } from '../features/ask-user/AskUserModal.js';
import { ConfirmDialog } from './ConfirmDialog.js';
import { ThemeToggle } from './ThemeToggle.js';
import { VisualQualityToggle } from './VisualQualityToggle.js';
import { GlassAurora } from './GlassAurora.js';
import { useSpotlight } from '../lib/useSpotlight.js';
import { RightSidebar } from './RightSidebar.js';
import { EnvironmentHub } from './EnvironmentHub.js';
import { PinnedTaskSummary } from './PinnedTaskSummary.js';
import { HelpOverlayController } from './HelpOverlay.js';
import { CommandPaletteController } from './CommandPalette.js';
import { ToastContainer } from './ToastContainer.js';
import { ZoomController } from './ZoomController.js';
import { UpdateBanner } from '../features/updater/UpdateBanner.js';
import { useAppStore, clampSidebarWidthPx } from '../store/appStore.js';
import { pushToast } from '../store/toastStore.js';
import { useSurfaceStore } from '../store/surface.js';
import { PartnerWorkspace } from '../features/partner/PartnerWorkspace.js';
import { PartnerRightSidebar } from '../features/partner/PartnerRightSidebar.js';
import { HandoffInbox } from './HandoffInbox.js';
import { SettingsModal, type SettingsTab } from '../features/settings/SettingsModal.js';
import {
  SpaceControlBroker,
  type TaskDockWidthPreset,
} from '../space-control/SpaceControlBroker.js';
import { setSpaceLanguage, setSpaceTheme } from '../space-control/semanticActions.js';
import { useI18n } from '../i18n/I18nProvider.js';
import type { MessageKey } from '../i18n/messages.js';
import { isPopoutKind, SHELL_POPOUT_EVENT, type ShellPopoutRequest } from './popoutControl.js';
import {
  isTaskDockSectionId,
  TASK_DOCK_FOCUS_EVENT,
  type TaskDockFocusRequest,
  type TaskDockFocusState,
} from './taskDockControl.js';
import type { RightSidebarWidthMode } from './RightSidebarFrame.js';
import { resolveRightSidebarToggleAction } from './sidebarToggle.js';

interface ShellProps {
  readonly version?: SpaceVersionOutput | null;
}

// 模块级 set：哪些 session 已从 SDK 拉过 history 回填 store。
// 之前用 useRef 在 Shell component 里——HMR 重挂 / Shell 卸载重挂都会丢，导致 fork/rewind
// 后 component 重新 mount 时又跑一次 session.history IPC（缓存现在帮忙省 jsonl 读，但
// store 复写 events 是真实成本）。挪到 module 级 process 级共享，跨 HMR 仍保留。
const restoredSessionIds = new Set<string>();

const RIGHT_SIDEBAR_DEFAULT_MIN_WIDTH = 320;
const RIGHT_SIDEBAR_DEFAULT_MAX_WIDTH = 520;
const RIGHT_SIDEBAR_DEFAULT_RATIO = 0.3;
const RIGHT_SIDEBAR_MIN_WIDTH = 180;
const SHELL_PANEL_HORIZONTAL_PADDING_PX = 20;
const SHELL_PANEL_GAP_PX = 10;
const RESIZE_HANDLE_WIDTH_PX = 4;
const CODER_MIN_CENTER_PX = 520;
const PARTNER_RIGHT_SIDEBAR_OPEN_KEY = 'kodax-space.partnerArtifactOpen';
type LeftSidebarMode = 'navigation' | 'files';

function readPartnerRightSidebarOpen(): boolean {
  if (typeof window === 'undefined') return true;
  try {
    return window.localStorage.getItem(PARTNER_RIGHT_SIDEBAR_OPEN_KEY) !== '0';
  } catch {
    return true;
  }
}

function persistPartnerRightSidebarOpen(open: boolean): void {
  try {
    window.localStorage.setItem(PARTNER_RIGHT_SIDEBAR_OPEN_KEY, open ? '1' : '0');
  } catch {
    // Non-critical: the panel remains usable for the current window.
  }
}

function getViewportWidth(): number {
  return typeof window !== 'undefined' && window.innerWidth ? window.innerWidth : 1440;
}

function getRendererPlatformClass(): string {
  const bridgePlatform = typeof window !== 'undefined' ? window.kodaxSpace?.platform : undefined;
  if (bridgePlatform === 'darwin') return 'platform-darwin';
  if (bridgePlatform === 'win32') return 'platform-win32';
  if (bridgePlatform === 'linux') return 'platform-linux';

  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  if (/Mac OS X/i.test(ua)) return 'platform-darwin';
  if (/Windows/i.test(ua)) return 'platform-win32';
  if (/Linux/i.test(ua)) return 'platform-linux';
  return 'platform-other';
}

function rightSidebarOpenWidth(
  leftSidebarVisible: boolean,
  leftWidth: number,
  viewportWidth = getViewportWidth(),
): number {
  const rightSideChrome = RESIZE_HANDLE_WIDTH_PX + SHELL_PANEL_GAP_PX * 2;
  const leftSideChrome = leftSidebarVisible
    ? leftWidth + RESIZE_HANDLE_WIDTH_PX + SHELL_PANEL_GAP_PX * 2
    : 0;
  const pairedWidth =
    viewportWidth - SHELL_PANEL_HORIZONTAL_PADDING_PX - leftSideChrome - rightSideChrome;
  return clampSidebarWidthPx(Math.round(pairedWidth / 2));
}

function rightSidebarDefaultWidth(
  leftSidebarVisible: boolean,
  leftWidth: number,
  viewportWidth = getViewportWidth(),
): number {
  const halfWidth = rightSidebarOpenWidth(leftSidebarVisible, leftWidth, viewportWidth);
  const proportionalWidth = Math.round(halfWidth * 2 * RIGHT_SIDEBAR_DEFAULT_RATIO);
  return Math.min(
    halfWidth,
    RIGHT_SIDEBAR_DEFAULT_MAX_WIDTH,
    Math.max(RIGHT_SIDEBAR_DEFAULT_MIN_WIDTH, proportionalWidth),
  );
}

function rightSidebarMaxWidth(
  leftSidebarVisible: boolean,
  leftWidth: number,
  viewportWidth = getViewportWidth(),
): number {
  // Max mode deliberately turns the Task Dock into the primary workspace. Unlike
  // half/custom modes, it must not reserve CODER_MIN_CENTER_PX for the transcript.
  // In max mode the center pane and right resize handle are removed from flex layout.
  // The remaining children are [left, left resize, Task Dock], or only [Task Dock].
  const leftSideChrome = leftSidebarVisible
    ? leftWidth + RESIZE_HANDLE_WIDTH_PX + SHELL_PANEL_GAP_PX * 2
    : 0;
  const width = viewportWidth - SHELL_PANEL_HORIZONTAL_PADDING_PX - leftSideChrome;
  return Math.max(RIGHT_SIDEBAR_MIN_WIDTH, Math.round(width));
}

function coderCenterWidthPx(
  leftSidebarVisible: boolean,
  leftWidth: number,
  rightSidebarVisible: boolean,
  rightWidth: number,
  viewportWidth = getViewportWidth(),
): number {
  let fixedWidth = 0;
  let childCount = 1;
  if (leftSidebarVisible) {
    fixedWidth += leftWidth + RESIZE_HANDLE_WIDTH_PX;
    childCount += 2;
  }
  if (rightSidebarVisible) {
    fixedWidth += rightWidth + RESIZE_HANDLE_WIDTH_PX;
    childCount += 2;
  }
  const gapWidth = Math.max(0, childCount - 1) * SHELL_PANEL_GAP_PX;
  return viewportWidth - SHELL_PANEL_HORIZONTAL_PADDING_PX - fixedWidth - gapWidth;
}
export function Shell({ version = null }: ShellProps): JSX.Element {
  const { t } = useI18n();
  // F045: surface 一等状态（替代旧 local mode）。Partner 自本版起有真实空壳。
  const currentSurface = useSurfaceStore((s) => s.currentSurface);

  // F060: Liquid Glass 光标 specular 高光（balanced/full 档；纯 CSS 变量，pointer-events:none 不挡点击）。
  useSpotlight();

  // 侧栏开/关：button 放在 breadcrumb 行最左 / 最右；侧栏关掉时 0 占位（不再 28px 竖条）
  const leftSidebarOpen = useAppStore((s) => s.leftSidebarOpen);
  const rightSidebarOpen = useAppStore((s) => s.rightSidebarOpen);
  const mascotMode = useAppStore((s) => s.mascotMode);
  const setLeftSidebarOpen = useAppStore((s) => s.setLeftSidebarOpen);
  const setRightSidebarOpen = useAppStore((s) => s.setRightSidebarOpen);
  const cycleMascotMode = useAppStore((s) => s.cycleMascotMode);
  const mascotButtonLabel =
    mascotMode === 'legacy'
      ? t('menu.view.mascotModeLegacy')
      : mascotMode === 'sprite'
        ? t('menu.view.mascotModeSprite')
        : t('menu.view.mascotModeOff');

  // 2026-06: 侧栏宽度。store 是 commit-only (release 时一次性写),drag 中间用本地 state
  // 实时驱动 inline width style 避免 store 抖动 / localStorage 频繁写。
  const persistedLeftWidth = useAppStore((s) => s.leftSidebarWidth);
  const persistedRightWidth = useAppStore((s) => s.rightSidebarWidth);
  const setLeftSidebarWidth = useAppStore((s) => s.setLeftSidebarWidth);
  const setRightSidebarWidth = useAppStore((s) => s.setRightSidebarWidth);
  const [leftWidthDraft, setLeftWidthDraft] = useState<number | null>(null);
  const [rightWidthDraft, setRightWidthDraft] = useState<number | null>(null);
  const [leftSidebarMode, setLeftSidebarMode] = useState<LeftSidebarMode>('navigation');
  const [rightSidebarWidthMode, setRightSidebarWidthMode] =
    useState<RightSidebarWidthMode>('custom');
  const [rightSidebarWidthSettling, setRightSidebarWidthSettling] = useState(false);
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsInitialTab, setSettingsInitialTab] = useState<SettingsTab>('preferences');
  const [licenseStatus, setLicenseStatus] = useState<LicenseStatusT | null>(null);
  const popoutBoundsRef = useRef<HTMLDivElement | null>(null);
  const rightSidebarWidthSettlingTimerRef = useRef<number | null>(null);
  const rightSidebarWidthPersistTimerRef = useRef<number | null>(null);
  const [taskDockFocusRequest, setTaskDockFocusRequest] = useState<TaskDockFocusState>({
    section: null,
    nonce: 0,
  });
  const [viewportWidth, setViewportWidth] = useState(() => getViewportWidth());
  const leftWidth = clampSidebarWidthPx(leftWidthDraft ?? persistedLeftWidth);
  const rightSidebarOpenBySurfaceRef = useRef<Record<'code' | 'partner', boolean>>({
    code: rightSidebarOpen,
    partner: readPartnerRightSidebarOpen(),
  });
  const activeRightSidebarSurfaceRef = useRef<'code' | 'partner' | null>(null);
  const setRightSidebarOpenForCurrentSurface = useCallback(
    (open: boolean): void => {
      rightSidebarOpenBySurfaceRef.current[currentSurface] = open;
      if (currentSurface === 'partner') persistPartnerRightSidebarOpen(open);
      setRightSidebarOpen(open);
    },
    [currentSurface, setRightSidebarOpen],
  );
  const closeDiagnostics = useCallback((): void => {
    setDiagnosticsOpen(false);
  }, []);

  const pulseRightSidebarWidthSettling = useCallback((): void => {
    setRightSidebarWidthSettling(true);
    if (rightSidebarWidthSettlingTimerRef.current !== null) {
      window.clearTimeout(rightSidebarWidthSettlingTimerRef.current);
    }
    rightSidebarWidthSettlingTimerRef.current = window.setTimeout(() => {
      rightSidebarWidthSettlingTimerRef.current = null;
      setRightSidebarWidthSettling(false);
    }, 240);
  }, []);

  const persistRightSidebarWidthAfterPaint = useCallback(
    (px: number): void => {
      if (rightSidebarWidthPersistTimerRef.current !== null) {
        window.clearTimeout(rightSidebarWidthPersistTimerRef.current);
      }
      rightSidebarWidthPersistTimerRef.current = window.setTimeout(() => {
        rightSidebarWidthPersistTimerRef.current = null;
        setRightSidebarWidth(px);
      }, 240);
    },
    [setRightSidebarWidth],
  );

  useEffect(() => {
    return () => {
      if (rightSidebarWidthSettlingTimerRef.current !== null) {
        window.clearTimeout(rightSidebarWidthSettlingTimerRef.current);
      }
      if (rightSidebarWidthPersistTimerRef.current !== null) {
        window.clearTimeout(rightSidebarWidthPersistTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const previousSurface = activeRightSidebarSurfaceRef.current;
    if (previousSurface === currentSurface) return;
    if (previousSurface !== null) {
      rightSidebarOpenBySurfaceRef.current[previousSurface] =
        useAppStore.getState().rightSidebarOpen;
    }
    activeRightSidebarSurfaceRef.current = currentSurface;
    setRightSidebarOpen(rightSidebarOpenBySurfaceRef.current[currentSurface]);
  }, [currentSurface, setRightSidebarOpen]);

  useEffect(() => {
    if (currentSurface !== 'code') setLeftSidebarMode('navigation');
  }, [currentSurface]);

  useEffect(() => {
    let raf = 0;
    const onResize = (): void => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => setViewportWidth(getViewportWidth()));
    };
    window.addEventListener('resize', onResize);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
    };
  }, []);

  const refreshLicenseStatus = useCallback((): void => {
    if (!window.kodaxSpace) return;
    void window.kodaxSpace.invoke('license.getStatus', {}).then((result) => {
      if (result.ok) {
        setLicenseStatus(result.data);
        // Mirror into the store so entitlement-gated surfaces (e.g. the Repointel
        // chip) react to boot + activation without their own IPC round-trip. Shell
        // is always mounted with the composer, and already refetches on mount +
        // 'kodax-space.license-changed', so this is the single license-fetch owner.
        useAppStore.getState().setLicenseStatus(result.data);
      }
    });
  }, []);

  useEffect(() => {
    refreshLicenseStatus();
    window.addEventListener('kodax-space.license-changed', refreshLicenseStatus);
    return () => window.removeEventListener('kodax-space.license-changed', refreshLicenseStatus);
  }, [refreshLicenseStatus]);

  // P4a: Ctrl+\ toggles focus mode in Coder. Partner avoids this global shortcut
  // because it has a different header/side-panel structure.
  const [fullscreenRead, setFullscreenRead] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (currentSurface === 'partner') return;
      if (e.ctrlKey && !e.shiftKey && !e.altKey && e.key === '\\') {
        e.preventDefault();
        setFullscreenRead((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [currentSurface]);

  const preferredLeftSidebarVisible = leftSidebarOpen && !fullscreenRead;
  const preferredRightSidebarVisible = rightSidebarOpen && !fullscreenRead;
  const preliminaryRightSidebarHalfWidth = rightSidebarOpenWidth(
    preferredLeftSidebarVisible,
    leftWidth,
    viewportWidth,
  );
  const preliminaryRightWidth =
    rightWidthDraft !== null
      ? Math.min(clampSidebarWidthPx(rightWidthDraft), preliminaryRightSidebarHalfWidth)
      : rightSidebarWidthMode === 'max'
        ? rightSidebarMaxWidth(preferredLeftSidebarVisible, leftWidth, viewportWidth)
        : rightSidebarWidthMode === 'half'
          ? preliminaryRightSidebarHalfWidth
          : rightSidebarWidthMode === 'default'
            ? rightSidebarDefaultWidth(preferredLeftSidebarVisible, leftWidth, viewportWidth)
            : Math.min(clampSidebarWidthPx(persistedRightWidth), preliminaryRightSidebarHalfWidth);
  const responsiveHideRightSidebar =
    preferredRightSidebarVisible &&
    rightSidebarWidthMode !== 'half' &&
    rightSidebarWidthMode !== 'max' &&
    coderCenterWidthPx(
      preferredLeftSidebarVisible,
      leftWidth,
      true,
      preliminaryRightWidth,
      viewportWidth,
    ) < CODER_MIN_CENTER_PX;
  const rightSidebarVisibleBeforeLeft = preferredRightSidebarVisible && !responsiveHideRightSidebar;
  const responsiveHideLeftSidebar =
    currentSurface === 'code' &&
    preferredLeftSidebarVisible &&
    rightSidebarWidthMode !== 'max' &&
    coderCenterWidthPx(
      true,
      leftWidth,
      rightSidebarVisibleBeforeLeft,
      preliminaryRightWidth,
      viewportWidth,
    ) < CODER_MIN_CENTER_PX;
  const leftSidebarVisible = preferredLeftSidebarVisible && !responsiveHideLeftSidebar;

  const openRightSidebarAtBalancedWidth = useCallback((): void => {
    const targetWidth = rightSidebarOpenWidth(leftSidebarVisible, leftWidth, viewportWidth);
    pulseRightSidebarWidthSettling();
    setRightWidthDraft(null);
    setRightSidebarWidthMode('half');
    persistRightSidebarWidthAfterPaint(targetWidth);
    setRightSidebarOpenForCurrentSurface(true);
  }, [
    leftSidebarVisible,
    leftWidth,
    persistRightSidebarWidthAfterPaint,
    pulseRightSidebarWidthSettling,
    setRightSidebarOpenForCurrentSurface,
    viewportWidth,
  ]);

  const openRightSidebarAtDefaultWidth = useCallback((): void => {
    const targetWidth = rightSidebarDefaultWidth(leftSidebarVisible, leftWidth, viewportWidth);
    pulseRightSidebarWidthSettling();
    setRightWidthDraft(null);
    setRightSidebarWidthMode('default');
    persistRightSidebarWidthAfterPaint(targetWidth);
    setRightSidebarOpenForCurrentSurface(true);
  }, [
    leftSidebarVisible,
    leftWidth,
    persistRightSidebarWidthAfterPaint,
    pulseRightSidebarWidthSettling,
    setRightSidebarOpenForCurrentSurface,
    viewportWidth,
  ]);

  const openRightSidebarAtMaxWidth = useCallback((): void => {
    pulseRightSidebarWidthSettling();
    setRightWidthDraft(null);
    setRightSidebarWidthMode('max');
    setRightSidebarOpenForCurrentSurface(true);
  }, [pulseRightSidebarWidthSettling, setRightSidebarOpenForCurrentSurface]);

  const setTaskDockWidthPreset = useCallback(
    (mode: TaskDockWidthPreset): void => {
      if (mode === 'default') openRightSidebarAtDefaultWidth();
      else if (mode === 'half') openRightSidebarAtBalancedWidth();
      else openRightSidebarAtMaxWidth();
    },
    [openRightSidebarAtBalancedWidth, openRightSidebarAtDefaultWidth, openRightSidebarAtMaxWidth],
  );

  const openSettingsAt = useCallback((tab: SettingsTab): void => {
    setSettingsInitialTab(tab);
    setSettingsOpen(true);
  }, []);

  const showLeftSidebar = useCallback((): void => {
    if (fullscreenRead) setFullscreenRead(false);

    if (currentSurface === 'code' && rightSidebarOpen && rightSidebarWidthMode !== 'max') {
      const halfWithLeft = rightSidebarOpenWidth(true, leftWidth, viewportWidth);
      const currentWidthWithLeft =
        rightSidebarWidthMode === 'half'
          ? halfWithLeft
          : rightSidebarWidthMode === 'default'
            ? rightSidebarDefaultWidth(true, leftWidth, viewportWidth)
            : Math.min(clampSidebarWidthPx(persistedRightWidth), halfWithLeft);
      const currentCenterWithLeft = coderCenterWidthPx(
        true,
        leftWidth,
        true,
        currentWidthWithLeft,
        viewportWidth,
      );

      if (currentCenterWithLeft < CODER_MIN_CENTER_PX) {
        const defaultWithLeft = rightSidebarDefaultWidth(true, leftWidth, viewportWidth);
        const defaultCenterWithLeft = coderCenterWidthPx(
          true,
          leftWidth,
          true,
          defaultWithLeft,
          viewportWidth,
        );
        if (defaultCenterWithLeft >= CODER_MIN_CENTER_PX) {
          openRightSidebarAtDefaultWidth();
        } else {
          setRightSidebarOpenForCurrentSurface(false);
        }
      }
    }

    setLeftSidebarOpen(true);
  }, [
    currentSurface,
    fullscreenRead,
    leftWidth,
    openRightSidebarAtDefaultWidth,
    persistedRightWidth,
    rightSidebarOpen,
    rightSidebarWidthMode,
    setLeftSidebarOpen,
    setRightSidebarOpenForCurrentSurface,
    viewportWidth,
  ]);

  const toggleLeftSidebar = useCallback((): void => {
    if (leftSidebarVisible && !fullscreenRead) {
      setLeftSidebarOpen(false);
      return;
    }
    showLeftSidebar();
  }, [fullscreenRead, leftSidebarVisible, setLeftSidebarOpen, showLeftSidebar]);

  useEffect(() => {
    const onTaskDockFocus = (event: Event): void => {
      const section = (event as CustomEvent<TaskDockFocusRequest>).detail?.section;
      if (isTaskDockSectionId(section)) {
        setTaskDockFocusRequest((current) => ({ section, nonce: current.nonce + 1 }));
      }
      if (fullscreenRead) setFullscreenRead(false);
      if (!rightSidebarOpen) openRightSidebarAtDefaultWidth();
      else setRightSidebarOpenForCurrentSurface(true);
    };
    window.addEventListener(TASK_DOCK_FOCUS_EVENT, onTaskDockFocus);
    return () => window.removeEventListener(TASK_DOCK_FOCUS_EVENT, onTaskDockFocus);
  }, [
    fullscreenRead,
    openRightSidebarAtDefaultWidth,
    rightSidebarOpen,
    setRightSidebarOpenForCurrentSurface,
  ]);

  // 右侧栏跟 KodaX 计划列表（todoListBySession）联动：plan 出现 → 自动打开；
  // plan 清空 → 自动折叠。只在 hasPlan 状态切换的瞬间动一次，中间段用户的手动 toggle 不会被打扰。
  // 首次挂载只记录状态、不覆盖 localStorage 持久化值——避免用户上次手动设置被开屏一瞬间冲掉。
  const currentSessionIdForPlan = useAppStore((s) => s.currentSessionId);
  const planLength = useAppStore((s) => {
    const sid = s.currentSessionId;
    return sid
      ? (s.liveProjectionBySession[sid]?.todos.length ?? s.todoListBySession[sid]?.length ?? 0)
      : 0;
  });
  const smartPopoutEnabled = useAppStore((s) => s.smartPopoutEnabled);
  const lastAutoPlanRef = useRef<{ sessionId: string | null; hasPlan: boolean } | null>(null);
  useEffect(() => {
    const hasPlan = planLength > 0;
    if (currentSurface !== 'code') {
      lastAutoPlanRef.current = { sessionId: currentSessionIdForPlan, hasPlan };
      return;
    }
    const previous = lastAutoPlanRef.current;
    if (previous === null) {
      // 初次：记录但不触发 — 尊重 localStorage 已持久的偏好
      lastAutoPlanRef.current = { sessionId: currentSessionIdForPlan, hasPlan };
      return;
    }
    const sessionChanged = previous.sessionId !== currentSessionIdForPlan;
    const planPresenceChanged = previous.hasPlan !== hasPlan;
    if (!sessionChanged && !planPresenceChanged) return;
    if (!planPresenceChanged || !smartPopoutEnabled) {
      lastAutoPlanRef.current = { sessionId: currentSessionIdForPlan, hasPlan };
      return;
    }
    if (hasPlan) {
      if (!rightSidebarOpen) openRightSidebarAtDefaultWidth();
      else setRightSidebarOpenForCurrentSurface(true);
    } else {
      setRightSidebarOpenForCurrentSurface(false);
    }
    lastAutoPlanRef.current = { sessionId: currentSessionIdForPlan, hasPlan };
  }, [
    planLength,
    currentSessionIdForPlan,
    openRightSidebarAtDefaultWidth,
    rightSidebarOpen,
    smartPopoutEnabled,
    currentSurface,
    setRightSidebarOpenForCurrentSurface,
  ]);

  // F059c: 对话里点 artifact 卡片 → 若右侧栏关着先打开它（RightSidebar 内部再切到 Artifact
  // tab + 选中）。否则点了卡片"什么都没发生"。
  useEffect(() => {
    const onFocus = (): void => {
      openRightSidebarAtBalancedWidth();
    };
    window.addEventListener('kodax-space.focus-artifact', onFocus);
    window.addEventListener('kodax-space.open-file-viewer', onFocus);
    return () => {
      window.removeEventListener('kodax-space.focus-artifact', onFocus);
      window.removeEventListener('kodax-space.open-file-viewer', onFocus);
    };
  }, [openRightSidebarAtBalancedWidth]);

  useEffect(() => {
    const onOpenFilesWorkspace = (): void => {
      showLeftSidebar();
      setLeftSidebarMode('files');
    };
    window.addEventListener('kodax-space.open-files-workspace', onOpenFilesWorkspace);
    return () =>
      window.removeEventListener('kodax-space.open-files-workspace', onOpenFilesWorkspace);
  }, [showLeftSidebar]);

  // 历史 session 切换时按需从 KodaX SDK 拉持久化对话内容回填 store。
  // events / userMessages buffer 是 in-memory；重启 / 切到 new session 后空 → 调
  // session.history → 拍平 messages 喂回 store，让 ConversationStreamV2 能渲染。
  // 模块级 restoredSessionIds 跨 HMR / Shell remount 保留——见文件顶部。
  //
  // **race condition 修复 (2026-05)**：用 prependSessionHistory 原子前置 historical，
  // 避免 IPC 等待期用户已经发了新消息时旧逻辑(逐条 appendUserMessage)把 user array
  // 顺序打乱(新消息 Q3 跑到 historical U1/U2 前面 → composeMessages 按 index 配对全错位)。
  // 现在哪怕 race 发生,前置后变 [hist..., new]; 顺序与 composeMessages 一致。
  useEffect(() => {
    const sid = currentSessionIdForPlan;
    if (!sid || !window.kodaxSpace) return;
    if (restoredSessionIds.has(sid)) return; // 已拉过
    // 注意:不再在 IPC 调用前 short-circuit "buffer 非空"——那是旧版兜底,现在 prepend
    // 是原子的,即使 buffer 已经有 in-flight 会话也能正确插入历史在前面。
    let cancelled = false;
    void window.kodaxSpace.invoke('session.history', { sessionId: sid }).then((r) => {
      if (cancelled || !r.ok) return;
      const items = r.data.items;
      if (items.length === 0) {
        restoredSessionIds.add(sid);
        return;
      }
      const store = useAppStore.getState();
      // history fallback timestamp：用 session.createdAt（SDK 落盘时刻），让 footer
      // 显示 "Xd ago" 反映 session 创建时间而不是"恢复瞬间 just now"。SDK 未来给
      // per-message timestamp 时再走 item.sentAt。
      const sess = store.sessions.find((s) => s.sessionId === sid);
      const fallbackTs = sess?.createdAt ?? Date.now();
      store.prependSessionHistory(sid, items, fallbackTs);
      restoredSessionIds.add(sid);
    });
    return () => {
      cancelled = true;
    };
  }, [currentSessionIdForPlan]);

  // 给 body 加 platform class，让 styles.css 里 .platform-darwin 的 traffic-lights
  // 让位规则生效。navigator.userAgent 在 Electron renderer 中 reliable。
  useEffect(() => {
    const cls = getRendererPlatformClass();
    document.body.classList.add(cls);
    return () => document.body.classList.remove(cls);
  }, []);
  // popout：null 表示无 popout，按右上按钮切换。
  // v0.1.9 fix: 同步到 store activePopoutKind,让 RightSidebar Section 的 ⤢ 按钮能判断
  // 当前是否已激活 → 实现 "再点关闭" toggle 行为 (用户反馈 ⤢ 应当 toggle 不是 one-way)。
  const [activePopout, setActivePopoutRaw] = useState<PopoutKind | null>(null);
  const setActivePopoutKindInStore = useAppStore((s) => s.setActivePopoutKind);
  const activePopoutKindFromStore = useAppStore((s) => s.activePopoutKind);
  const openFilesInLeftSidebar = useCallback((): void => {
    showLeftSidebar();
    setLeftSidebarMode('files');
    setActivePopoutRaw(null);
  }, [showLeftSidebar]);
  useEffect(() => {
    setActivePopoutKindInStore(activePopout);
  }, [activePopout, setActivePopoutKindInStore]);
  // 双向同步: 其它组件 (RightSidebar Section ⤢) setActivePopoutKind(null) → 关 popout。
  // 守门: 仅当 store 跟本地 state 不一致时切,避免上面那个 effect 写 store 后立刻被读回触发再 set。
  useEffect(() => {
    if (activePopoutKindFromStore === activePopout) return;
    if (activePopoutKindFromStore === null) {
      setActivePopoutRaw(null);
      return;
    }
    if (activePopoutKindFromStore === 'files') {
      openFilesInLeftSidebar();
      setActivePopoutKindInStore(null);
      return;
    }
    if (isPopoutKind(activePopoutKindFromStore)) {
      setActivePopoutRaw(activePopoutKindFromStore);
      return;
    }
    console.warn('[kodax-space] ignored invalid active popout kind', activePopoutKindFromStore);
    setActivePopoutKindInStore(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePopoutKindFromStore, openFilesInLeftSidebar, setActivePopoutKindInStore]);

  // KX-I-02: 用户手动切 popout (CommandToolbar / RightSidebar ⤢ / slash command) 时,
  // **顺手**把该 (session, kind) 标 promoted —— 让 director 不会下一秒再"自动"打开同一个
  // 把用户刚关掉的 popout (尤其当用户 close 了 director 自动开的那个时,promoted 已经在
  // 了;但用户在 director 之前手动开 plan 时,我们也需要 mark 防止再自动 emit。)
  const currentSessionIdForPopout = useAppStore((s) => s.currentSessionId);
  const markPopoutPromoted = useAppStore((s) => s.markPopoutPromoted);
  const setActivePopout = useCallback(
    (next: PopoutKind | null) => {
      if (next === 'files') {
        openFilesInLeftSidebar();
        return;
      }
      if (currentSessionIdForPopout !== null && next !== null) {
        markPopoutPromoted(currentSessionIdForPopout, next);
      }
      setActivePopoutRaw(next);
    },
    [currentSessionIdForPopout, markPopoutPromoted, openFilesInLeftSidebar],
  );

  useEffect(() => {
    const onShellPopout = (event: Event): void => {
      const detail = (event as CustomEvent<Partial<ShellPopoutRequest>>).detail;
      if (!detail || !('kind' in detail)) return;
      const kind = detail.kind ?? null;
      if (kind !== null && !isPopoutKind(kind)) return;
      if (kind !== null && currentSurface !== 'code') return;
      setActivePopout(kind);
    };
    window.addEventListener(SHELL_POPOUT_EVENT, onShellPopout);
    return () => window.removeEventListener(SHELL_POPOUT_EVENT, onShellPopout);
  }, [currentSurface, setActivePopout]);

  // KX-I-02: director — 监听 events,首次出现 plan/diff/tasks 信号时 auto setActivePopout
  // (前提:activePopout === null 且该 kind 在本 session 未 promoted 过)。
  useSmartPopoutDirector({ activePopout });

  // BottomBar 发出的"打开 popout"请求消费 — /memory → 'agents' 等。
  // 拿到 non-null 后立即 setActivePopout + 清回 null,避免被反复消费。
  //
  // **load-bearing**: 同步把 store 的 requestedPopout 重置成 null 会触发本 useEffect 再跑一次,
  // 但 if(requestedPopout === null) return 守门 + zustand "set same value 不通知 subscriber"
  // 双重短路,不会进 setActivePopout 的反复循环。如果未来 zustand 升级 / 添加 immer 等中间件
  // 改变 set 比较语义,这条 guard 必须保留。
  const requestedPopout = useAppStore((s) => s.requestedPopout);
  const setRequestedPopout = useAppStore((s) => s.requestPopout);
  useEffect(() => {
    if (requestedPopout === null) return;
    // F046 review HIGH-3: Partner 面不挂 PopoutOverlay。若在 Partner 触发 requestPopout
    // （如某条 slash command），这里仍会 setActivePopout 但无 overlay 渲染 → 请求被静默吞掉、
    // 切回 Coder 也不会重放。Partner 下直接丢弃请求（清 null），不污染 activePopout。
    if (currentSurface !== 'code') {
      setRequestedPopout(null);
      return;
    }
    if (isPopoutKind(requestedPopout)) {
      setActivePopout(requestedPopout);
    }
    setRequestedPopout(null); // 消费完清回 null,允许下次 slash command 再次触发
  }, [requestedPopout, setRequestedPopout, setActivePopout, currentSurface]);
  const rightSidebarHalfWidth = rightSidebarOpenWidth(leftSidebarVisible, leftWidth, viewportWidth);
  const rightSidebarMaxAvailableWidth = rightSidebarMaxWidth(
    leftSidebarVisible,
    leftWidth,
    viewportWidth,
  );
  const clampRightSidebarNonMaxWidth = useCallback(
    (px: number): number => Math.min(clampSidebarWidthPx(px), rightSidebarHalfWidth),
    [rightSidebarHalfWidth],
  );
  const clampRightSidebarWidth = useCallback(
    (px: number): number => {
      const finite = Number.isFinite(px) ? px : RIGHT_SIDEBAR_DEFAULT_MIN_WIDTH;
      const max =
        rightSidebarWidthMode === 'max' ? rightSidebarMaxAvailableWidth : rightSidebarHalfWidth;
      return Math.round(Math.min(max, Math.max(RIGHT_SIDEBAR_MIN_WIDTH, finite)));
    },
    [rightSidebarHalfWidth, rightSidebarMaxAvailableWidth, rightSidebarWidthMode],
  );
  const rightWidth =
    rightWidthDraft !== null
      ? clampRightSidebarWidth(rightWidthDraft)
      : rightSidebarWidthMode === 'max'
        ? rightSidebarMaxAvailableWidth
        : rightSidebarWidthMode === 'half'
          ? rightSidebarHalfWidth
          : rightSidebarWidthMode === 'default'
            ? rightSidebarDefaultWidth(leftSidebarVisible, leftWidth, viewportWidth)
            : clampRightSidebarNonMaxWidth(persistedRightWidth);
  const rightSidebarVisible =
    rightSidebarVisibleBeforeLeft &&
    (rightSidebarWidthMode === 'half' ||
      rightSidebarWidthMode === 'max' ||
      coderCenterWidthPx(leftSidebarVisible, leftWidth, true, rightWidth, viewportWidth) >=
        CODER_MIN_CENTER_PX);
  const toggleRightSidebar = useCallback((): void => {
    if (fullscreenRead) {
      setFullscreenRead(false);
      openRightSidebarAtDefaultWidth();
    } else {
      const action = resolveRightSidebarToggleAction(rightSidebarVisible, rightSidebarOpen);
      if (action === 'close') setRightSidebarOpenForCurrentSurface(false);
      else if (action === 'open-balanced') openRightSidebarAtBalancedWidth();
      else openRightSidebarAtDefaultWidth();
    }
  }, [
    fullscreenRead,
    openRightSidebarAtBalancedWidth,
    openRightSidebarAtDefaultWidth,
    rightSidebarOpen,
    rightSidebarVisible,
    setRightSidebarOpenForCurrentSurface,
  ]);
  const rightSidebarWorkspaceMode = rightSidebarVisible && rightSidebarWidthMode === 'max';
  const platformClass = getRendererPlatformClass();
  const isWindows = platformClass === 'platform-win32';

  return (
    <div
      className={`h-screen flex flex-col bg-surface text-fg-primary overflow-hidden relative isolate ${platformClass} ${
        rightSidebarWidthSettling ? 'right-sidebar-width-settling' : ''
      }`}
    >
      {/* F060: 背景极光层（玻璃 chrome 通过 backdrop-filter 透出它）。minimal 档不渲染。
          铺在最底层 z-0；下面的 titlebar / body 用 relative z-10 浮在其上。 */}
      <GlassAurora />

      {/* 顶部自定义 titlebar — 自身做窗口拖动 + 留出 Windows overlay 控件 (close/min/max) 空间。
          Mac 上 traffic lights 占 ~78px (hiddenInset)；Windows 上 OS 把 close/min/max 画在右侧 ~138px (titleBarOverlay)。 */}
      <div className="app-titlebar glass ix-zone h-9 flex items-center px-3 flex-shrink-0 select-none relative z-20">
        <AppTopMenu
          leftSidebarOpen={leftSidebarVisible}
          rightSidebarOpen={rightSidebarVisible}
          focusMode={fullscreenRead}
          diagnosticsOpen={diagnosticsOpen}
          onToggleLeftSidebar={toggleLeftSidebar}
          onToggleRightSidebar={toggleRightSidebar}
          onToggleFocusMode={() => setFullscreenRead((v) => !v)}
          onToggleDiagnostics={() => setDiagnosticsOpen((v) => !v)}
          onOpenSettings={() => openSettingsAt('preferences')}
        />
        <div className="flex-1" />
        <div className="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            onClick={() => setDiagnosticsOpen((v) => !v)}
            className="app-no-drag inline-flex h-7 items-center gap-1.5 rounded-md border border-border-default bg-surface-2 px-2 text-[11px] font-mono text-fg-muted hover:bg-hover-bg hover:text-fg-primary"
            title={t('shell.runtimeDiagnostics')}
            aria-label={t('shell.runtimeDiagnostics')}
          >
            <Info className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden />
            <span>v{version?.spaceVersion ?? '?.?.?'}</span>
            {licenseStatus && (
              <span
                className={`rounded border px-1.5 py-0.5 font-sans text-[10px] ${licenseBadgeClass(
                  licenseStatus.status,
                )}`}
              >
                {licenseBadgeText(licenseStatus, t)}
              </span>
            )}
          </button>
          <HandoffInbox />
          <TitlebarIconButton
            label={mascotButtonLabel}
            active={mascotMode !== 'off'}
            onClick={cycleMascotMode}
          >
            <PawPrint className="h-4 w-4" strokeWidth={1.75} aria-hidden />
          </TitlebarIconButton>
          <VisualQualityToggle />
          <ThemeToggle />
        </div>
        {isWindows && <WindowsWindowControls />}
        {diagnosticsOpen && (
          <RuntimeDiagnostics
            version={version}
            licenseStatus={licenseStatus}
            onClose={closeDiagnostics}
          />
        )}
      </div>

      {/* F060: 面板区。Liquid Glass —— 立体感来自光影材质（光向描边 + 光标 specular + 分层柔影），
          不靠运动；模态/命令面板放在面板区之外保持 position:fixed 正常。 */}
      <div className="flex flex-1 min-h-0 gap-2.5 p-2.5">
        {leftSidebarVisible && (
          <>
            {leftSidebarMode === 'files' ? (
              <FilesPanel
                width={leftWidth}
                asSidebar
                onBack={() => setLeftSidebarMode('navigation')}
              />
            ) : (
              <LeftSidebar
                width={leftWidth}
                filesActive={false}
                onOpenFiles={openFilesInLeftSidebar}
              />
            )}
            <ResizeHandle
              side="left"
              width={leftWidth}
              defaultWidth={260}
              onPreview={(px) => setLeftWidthDraft(clampSidebarWidthPx(px))}
              onCommit={(px) => {
                setLeftWidthDraft(null);
                setLeftSidebarWidth(clampSidebarWidthPx(px));
              }}
            />
          </>
        )}

        {currentSurface === 'partner' ? (
          // F045: Partner surface 只替换主区（对话区）。LeftSidebar 是全局导航
          // （项目 / session / SurfaceTabs），两 surface 共用；右侧栏外壳也由 Shell 统一托管。
          <PartnerWorkspace
            rightSidebarOpen={rightSidebarVisible}
            workspaceMode={rightSidebarWorkspaceMode}
            onToggleRightSidebar={toggleRightSidebar}
          />
        ) : (
          /* 中央阅读区：悬浮圆角卡片。保持实色（bg-surface）—— aurora 只在卡片四周缝隙
              透出，对话流不被极光动画触发 re-composite，性能护栏。 */
          <div
            className="center-pane flex-1 flex flex-col min-w-0 relative bg-surface rounded-xl border border-border-default overflow-hidden lift"
            data-testid="coder-workspace"
            style={rightSidebarWorkspaceMode ? { display: 'none' } : undefined}
          >
            <div className="ix-zone flex items-center px-3 h-10 border-b border-border-default flex-shrink-0 gap-1">
              {/* 左侧栏切换按钮 — 始终常驻，让收起后仍能一键展开 */}
              <SidebarToggleButton
                side="left"
                open={leftSidebarVisible}
                onClick={toggleLeftSidebar}
              />
              <Breadcrumb />
              <CommandToolbar active={activePopout} onToggle={setActivePopout} />
              <EnvironmentHub />
              {fullscreenRead && (
                <button
                  type="button"
                  onClick={() => setFullscreenRead(false)}
                  className="ml-1 text-[11px] px-2 py-0.5 rounded border border-border-default text-fg-muted hover:text-fg-primary"
                  title={t('shell.exitFocusModeTitle')}
                >
                  ↗ {t('shell.exitFocusMode')}
                </button>
              )}
              {/* 右侧栏切换按钮 */}
              <SidebarToggleButton
                side="right"
                open={rightSidebarVisible}
                onClick={toggleRightSidebar}
              />
            </div>

            <div ref={popoutBoundsRef} className="relative flex flex-1 min-h-0 flex-col">
              <PinnedTaskSummary />
              <ConversationStreamV2 />

              {activePopout !== null && (
                <PopoutOverlay
                  kind={activePopout}
                  boundsRef={popoutBoundsRef}
                  onClose={() => setActivePopout(null)}
                />
              )}
            </div>

            <BottomBar />
          </div>
        )}

        {rightSidebarVisible && (
          <>
            {!rightSidebarWorkspaceMode && (
              <ResizeHandle
                side="right"
                width={rightWidth}
                defaultWidth={rightSidebarDefaultWidth(
                  leftSidebarVisible,
                  leftWidth,
                  viewportWidth,
                )}
                onPreview={(px) => setRightWidthDraft(clampRightSidebarWidth(px))}
                onCommit={(px) => {
                  setRightWidthDraft(null);
                  setRightSidebarWidthMode('custom');
                  setRightSidebarWidth(clampRightSidebarNonMaxWidth(px));
                }}
              />
            )}
            {currentSurface === 'partner' ? (
              <PartnerRightSidebar
                width={rightWidth}
                widthMode={rightSidebarWidthMode}
                onDefaultWidth={openRightSidebarAtDefaultWidth}
                onHalfWidth={openRightSidebarAtBalancedWidth}
                onMaxWidth={openRightSidebarAtMaxWidth}
                onClose={() => setRightSidebarOpenForCurrentSurface(false)}
              />
            ) : (
              <RightSidebar
                width={rightWidth}
                widthMode={rightSidebarWidthMode}
                onDefaultWidth={openRightSidebarAtDefaultWidth}
                onHalfWidth={openRightSidebarAtBalancedWidth}
                onMaxWidth={openRightSidebarAtMaxWidth}
                onClose={() => setRightSidebarOpenForCurrentSurface(false)}
                shellFocusRequest={taskDockFocusRequest}
              />
            )}
          </>
        )}
      </div>

      {/* 模态/命令面板：在面板区之外，保证 position:fixed 相对视口正常铺满 */}
      <PermissionModal />
      <AskUserModal />
      <ConfirmDialog />
      {settingsOpen && (
        <SettingsModal
          initialTab={settingsInitialTab}
          onTabChange={setSettingsInitialTab}
          onClose={() => setSettingsOpen(false)}
        />
      )}
      <SpaceControlBroker
        settingsOpen={settingsOpen}
        settingsTab={settingsInitialTab}
        taskDockWidthMode={rightSidebarWidthMode}
        onOpenSettings={openSettingsAt}
        onSetTaskDockWidthMode={setTaskDockWidthPreset}
      />
      <HelpOverlayController />
      <CommandPaletteController />

      <ToastContainer />
      <ZoomController />
      <UpdateBanner />
    </div>
  );
}

interface SidebarToggleButtonProps {
  side: 'left' | 'right';
  open: boolean;
  onClick: () => void;
}

type AppMenuId = 'file' | 'edit' | 'view' | 'help';

interface AppTopMenuProps {
  readonly leftSidebarOpen: boolean;
  readonly rightSidebarOpen: boolean;
  readonly focusMode: boolean;
  readonly diagnosticsOpen: boolean;
  readonly onToggleLeftSidebar: () => void;
  readonly onToggleRightSidebar: () => void;
  readonly onToggleFocusMode: () => void;
  readonly onToggleDiagnostics: () => void;
  readonly onOpenSettings: () => void;
}

interface AppMenuItem {
  readonly id: string;
  readonly label?: string;
  readonly shortcut?: string;
  readonly disabled?: boolean;
  readonly checked?: boolean;
  readonly separator?: boolean;
  readonly onSelect?: () => void | Promise<void>;
}

function isMacPlatform(): boolean {
  return /Mac|iPhone|iPad|iPod/i.test(navigator.platform) || /Mac OS X/i.test(navigator.userAgent);
}

function isPrimaryShortcut(e: KeyboardEvent): boolean {
  return isMacPlatform() ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey;
}

function isEditableTarget(target: EventTarget | null): target is HTMLElement {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  if (target instanceof HTMLTextAreaElement) return !target.disabled;
  if (!(target instanceof HTMLInputElement)) return false;
  if (target.disabled || target.readOnly) return false;
  const editableTypes = new Set([
    '',
    'email',
    'number',
    'password',
    'search',
    'tel',
    'text',
    'url',
  ]);
  return editableTypes.has(target.type);
}

function AppTopMenu({
  leftSidebarOpen,
  rightSidebarOpen,
  focusMode,
  diagnosticsOpen,
  onToggleLeftSidebar,
  onToggleRightSidebar,
  onToggleFocusMode,
  onToggleDiagnostics,
  onOpenSettings,
}: AppTopMenuProps): JSX.Element {
  const { languageMode, setLanguageMode, t } = useI18n();
  const theme = useAppStore((s) => s.theme);
  const visualQuality = useAppStore((s) => s.visualQuality);
  const setVisualQuality = useAppStore((s) => s.setVisualQuality);
  const [openMenu, setOpenMenu] = useState<AppMenuId | null>(null);
  const ref = useRef<HTMLDivElement | null>(null);
  const lastEditableTargetRef = useRef<HTMLElement | null>(null);
  const shortcutModifier = isMacPlatform() ? 'Cmd' : 'Ctrl';

  useEffect(() => {
    if (openMenu === null) return;
    const onDocDown = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpenMenu(null);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpenMenu(null);
    };
    document.addEventListener('mousedown', onDocDown);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [openMenu]);

  useEffect(() => {
    const rememberEditableFocus = (e: FocusEvent): void => {
      const target = e.target;
      if (isEditableTarget(target)) lastEditableTargetRef.current = target;
    };
    document.addEventListener('focusin', rememberEditableFocus);
    return () => document.removeEventListener('focusin', rememberEditableFocus);
  }, []);

  const startNewSession = useCallback((): void => {
    useAppStore.getState().setCurrentSession(null);
    window.dispatchEvent(new Event('kodax-space.focus-textarea'));
  }, []);

  const openProject = useCallback(async (): Promise<void> => {
    const bridge = window.kodaxSpace;
    if (!bridge) return;
    try {
      const result = await bridge.invoke('project.openDialog', undefined);
      if (!result.ok || result.data.path === null) return;
      const { path } = result.data;
      useAppStore.getState().setCurrentProject(path);
      await bridge.invoke('project.recent.add', { path });
      const listResult = await bridge.invoke('project.list', undefined);
      if (listResult.ok) useAppStore.getState().setProjects(listResult.data.projects);
    } catch {
      pushToast(t('toast.openFolderFailed'), 'error');
    }
  }, [t]);

  const runEditCommand = (command: string): void => {
    const target = lastEditableTargetRef.current;
    if (target && document.contains(target)) {
      target.focus({ preventScroll: true });
    }
    const ok = document.execCommand(command);
    if (!ok && command === 'paste') pushToast(t('toast.pasteUnavailable'), 'warning');
  };

  const openCommandPalette = (): void => {
    window.dispatchEvent(new Event('kodax-space.open-command-palette'));
  };

  const openHelp = (): void => {
    window.dispatchEvent(new Event('kodax-space.open-help'));
  };

  useEffect(() => {
    const onShortcut = (e: KeyboardEvent): void => {
      if (isEditableTarget(e.target)) return;
      if (!isPrimaryShortcut(e) || e.shiftKey || e.altKey) return;
      const key = e.key.toLowerCase();
      if (key === 'n') {
        e.preventDefault();
        startNewSession();
      } else if (key === 'o') {
        e.preventDefault();
        void openProject();
      } else if (e.key === ',') {
        e.preventDefault();
        onOpenSettings();
      }
    };
    window.addEventListener('keydown', onShortcut);
    return () => window.removeEventListener('keydown', onShortcut);
  }, [onOpenSettings, openProject, startNewSession]);

  const chooseLanguage = async (mode: LanguageModeT): Promise<void> => {
    const ok = await setSpaceLanguage(mode, setLanguageMode);
    if (ok) pushToast(t('toast.languageSaved'), 'success', 1800);
  };

  const menus: ReadonlyArray<{
    readonly id: AppMenuId;
    readonly label: string;
    readonly items: readonly AppMenuItem[];
  }> = [
    {
      id: 'file',
      label: t('menu.file'),
      items: [
        {
          id: 'new-session',
          label: t('menu.file.newSession'),
          shortcut: `${shortcutModifier}+N`,
          onSelect: startNewSession,
        },
        {
          id: 'open-folder',
          label: t('menu.file.openFolder'),
          shortcut: `${shortcutModifier}+O`,
          onSelect: openProject,
        },
        { id: 'file-separator-1', separator: true },
        {
          id: 'settings',
          label: t('menu.file.settings'),
          shortcut: `${shortcutModifier}+,`,
          onSelect: onOpenSettings,
        },
      ],
    },
    {
      id: 'edit',
      label: t('menu.edit'),
      items: [
        {
          id: 'undo',
          label: t('menu.edit.undo'),
          shortcut: `${shortcutModifier}+Z`,
          onSelect: () => runEditCommand('undo'),
        },
        {
          id: 'redo',
          label: t('menu.edit.redo'),
          shortcut: `${shortcutModifier}+Y`,
          onSelect: () => runEditCommand('redo'),
        },
        { id: 'edit-separator-1', separator: true },
        {
          id: 'cut',
          label: t('menu.edit.cut'),
          shortcut: `${shortcutModifier}+X`,
          onSelect: () => runEditCommand('cut'),
        },
        {
          id: 'copy',
          label: t('menu.edit.copy'),
          shortcut: `${shortcutModifier}+C`,
          onSelect: () => runEditCommand('copy'),
        },
        {
          id: 'paste',
          label: t('menu.edit.paste'),
          shortcut: `${shortcutModifier}+V`,
          onSelect: () => runEditCommand('paste'),
        },
        {
          id: 'select-all',
          label: t('menu.edit.selectAll'),
          shortcut: `${shortcutModifier}+A`,
          onSelect: () => runEditCommand('selectAll'),
        },
      ],
    },
    {
      id: 'view',
      label: t('menu.view'),
      items: [
        {
          id: 'command-palette',
          label: t('menu.view.commandPalette'),
          shortcut: `${shortcutModifier}+Shift+P`,
          onSelect: openCommandPalette,
        },
        { id: 'view-separator-1', separator: true },
        {
          id: 'left-sidebar',
          label: t('menu.view.leftSidebar'),
          checked: leftSidebarOpen,
          onSelect: onToggleLeftSidebar,
        },
        {
          id: 'right-sidebar',
          label: t('menu.view.rightSidebar'),
          checked: rightSidebarOpen,
          onSelect: onToggleRightSidebar,
        },
        {
          id: 'focus-mode',
          label: t('menu.view.focusMode'),
          shortcut: 'Ctrl+\\',
          checked: focusMode,
          onSelect: onToggleFocusMode,
        },
        { id: 'view-separator-2', separator: true },
        {
          id: 'theme-label',
          label: t('menu.view.theme'),
          disabled: true,
        },
        {
          id: 'theme-light',
          label: t('theme.light'),
          checked: theme === 'light',
          onSelect: () => setSpaceTheme('light'),
        },
        {
          id: 'theme-dark',
          label: t('theme.dark'),
          checked: theme === 'dark',
          onSelect: () => setSpaceTheme('dark'),
        },
        {
          id: 'theme-system',
          label: t('theme.system'),
          checked: theme === 'system',
          onSelect: () => setSpaceTheme('system'),
        },
        { id: 'view-separator-3', separator: true },
        {
          id: 'visual-quality-label',
          label: t('menu.view.visualQuality'),
          disabled: true,
        },
        {
          id: 'visual-quality-minimal',
          label: t('visualQuality.minimal'),
          checked: visualQuality === 'minimal',
          onSelect: () => setVisualQuality('minimal'),
        },
        {
          id: 'visual-quality-balanced',
          label: t('visualQuality.balanced'),
          checked: visualQuality === 'balanced',
          onSelect: () => setVisualQuality('balanced'),
        },
        {
          id: 'visual-quality-full',
          label: t('visualQuality.full'),
          checked: visualQuality === 'full',
          onSelect: () => setVisualQuality('full'),
        },
        { id: 'view-separator-4', separator: true },
        {
          id: 'language-label',
          label: t('menu.view.language'),
          disabled: true,
        },
        {
          id: 'language-system',
          label: t('language.followSystem'),
          checked: languageMode === 'system',
          onSelect: () => chooseLanguage('system'),
        },
        {
          id: 'language-zh-cn',
          label: t('language.zhCN'),
          checked: languageMode === 'zh-CN',
          onSelect: () => chooseLanguage('zh-CN'),
        },
        {
          id: 'language-en-us',
          label: t('language.enUS'),
          checked: languageMode === 'en-US',
          onSelect: () => chooseLanguage('en-US'),
        },
        { id: 'view-separator-5', separator: true },
        {
          id: 'diagnostics',
          label: t('menu.view.diagnostics'),
          checked: diagnosticsOpen,
          onSelect: onToggleDiagnostics,
        },
      ],
    },
    {
      id: 'help',
      label: t('menu.help'),
      items: [
        { id: 'shortcuts', label: t('menu.help.shortcuts'), shortcut: '?', onSelect: openHelp },
      ],
    },
  ];

  return (
    <div
      ref={ref}
      className="titlebar-brand app-no-drag flex h-7 min-w-0 items-center gap-0.5 text-[12px] text-fg-secondary"
    >
      <TitlebarIconButton
        label={leftSidebarOpen ? t('menu.view.hideLeftSidebar') : t('menu.view.showLeftSidebar')}
        active={leftSidebarOpen}
        onClick={onToggleLeftSidebar}
      >
        <PanelLeft className="h-4 w-4" strokeWidth={1.75} aria-hidden />
      </TitlebarIconButton>
      <TitlebarIconButton label={t('menu.nav.back')} disabled onClick={() => undefined}>
        <ArrowLeft className="h-4 w-4" strokeWidth={1.75} aria-hidden />
      </TitlebarIconButton>
      <TitlebarIconButton label={t('menu.nav.forward')} disabled onClick={() => undefined}>
        <ArrowRight className="h-4 w-4" strokeWidth={1.75} aria-hidden />
      </TitlebarIconButton>
      <div className="mx-1 h-4 w-px bg-border-default/70" aria-hidden />

      {menus.map((menu) => (
        <div key={menu.id} className="relative">
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => setOpenMenu((current) => (current === menu.id ? null : menu.id))}
            onMouseEnter={() => {
              if (openMenu !== null) setOpenMenu(menu.id);
            }}
            className={`inline-flex h-7 items-center gap-1 rounded-md px-2 text-[12px] hover:bg-hover-bg hover:text-fg-primary ${
              openMenu === menu.id ? 'bg-surface-3 text-fg-primary' : 'text-fg-secondary'
            }`}
            aria-haspopup="menu"
            aria-expanded={openMenu === menu.id}
          >
            <span>{menu.label}</span>
            <ChevronDown className="h-3 w-3 text-fg-faint" strokeWidth={1.75} aria-hidden />
          </button>
          {openMenu === menu.id && (
            <AppMenuDropdown items={menu.items} onClose={() => setOpenMenu(null)} />
          )}
        </div>
      ))}

      <span className="ml-2 hidden max-w-[180px] truncate text-[11px] text-fg-faint sm:inline">
        KodaX Space
      </span>
    </div>
  );
}

interface TitlebarIconButtonProps {
  readonly label: string;
  readonly active?: boolean;
  readonly disabled?: boolean;
  readonly onClick: () => void;
  readonly children: JSX.Element;
}

function WindowsWindowControls(): JSX.Element {
  const { t } = useI18n();
  const [maximized, setMaximized] = useState(false);

  const refreshState = useCallback(async (): Promise<void> => {
    if (!window.kodaxSpace) return;
    const result = await window.kodaxSpace.invoke('window.state', undefined);
    if (result.ok) setMaximized(result.data.maximized);
  }, []);

  useEffect(() => {
    void refreshState();
    const onStateHint = (): void => void refreshState();
    window.addEventListener('focus', onStateHint);
    window.addEventListener('resize', onStateHint);
    return () => {
      window.removeEventListener('focus', onStateHint);
      window.removeEventListener('resize', onStateHint);
    };
  }, [refreshState]);

  const runControl = useCallback(
    async (action: 'minimize' | 'toggleMaximize' | 'close'): Promise<void> => {
      if (!window.kodaxSpace) return;
      const result = await window.kodaxSpace.invoke('window.control', { action });
      if (result.ok) setMaximized(result.data.maximized);
    },
    [],
  );

  const maximizeLabel = maximized ? t('windowControls.restore') : t('windowControls.maximize');

  return (
    <div className="window-controls app-no-drag" aria-label={t('windowControls.group')}>
      <button
        type="button"
        className="window-control-button"
        onClick={() => void runControl('minimize')}
        title={t('windowControls.minimize')}
        aria-label={t('windowControls.minimize')}
      >
        <Minus className="h-4 w-4" strokeWidth={1.8} aria-hidden />
      </button>
      <button
        type="button"
        className="window-control-button"
        onClick={() => void runControl('toggleMaximize')}
        title={maximizeLabel}
        aria-label={maximizeLabel}
      >
        {maximized ? (
          <Copy className="h-3.5 w-3.5" strokeWidth={1.7} aria-hidden />
        ) : (
          <Square className="h-3.5 w-3.5" strokeWidth={1.7} aria-hidden />
        )}
      </button>
      <button
        type="button"
        className="window-control-button window-control-button--close"
        onClick={() => void runControl('close')}
        title={t('windowControls.close')}
        aria-label={t('windowControls.close')}
      >
        <X className="h-4 w-4" strokeWidth={1.8} aria-hidden />
      </button>
    </div>
  );
}

function TitlebarIconButton({
  label,
  active = false,
  disabled = false,
  onClick,
  children,
}: TitlebarIconButtonProps): JSX.Element {
  return (
    <button
      type="button"
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      disabled={disabled}
      className={`flex h-7 w-7 items-center justify-center rounded-md transition-colors ${
        active ? 'text-fg-primary' : 'text-fg-muted'
      } ${
        disabled
          ? 'cursor-default opacity-35'
          : 'hover:bg-hover-bg hover:text-fg-primary active:bg-surface-3'
      }`}
      title={label}
      aria-label={label}
      aria-pressed={active}
    >
      {children}
    </button>
  );
}

interface AppMenuDropdownProps {
  readonly items: readonly AppMenuItem[];
  readonly onClose: () => void;
}

function AppMenuDropdown({ items, onClose }: AppMenuDropdownProps): JSX.Element {
  return (
    <div
      className="absolute left-0 top-full z-[70] mt-1 w-56 overflow-hidden rounded-lg border border-border-default bg-surface-4 py-1 shadow-2xl"
      role="menu"
    >
      {items.map((item) =>
        item.separator ? (
          <div key={item.id} className="my-1 h-px bg-border-default" role="separator" />
        ) : (
          <button
            key={item.id}
            type="button"
            disabled={item.disabled}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              onClose();
              void item.onSelect?.();
            }}
            className="grid w-full grid-cols-[18px_minmax(0,1fr)_auto] items-center gap-2 px-2.5 py-1.5 text-left text-[12px] text-fg-secondary hover:bg-hover-bg hover:text-fg-primary disabled:pointer-events-none disabled:opacity-45"
            role="menuitem"
          >
            <span className="flex h-4 w-4 items-center justify-center">
              {item.checked && <Check className="h-3.5 w-3.5 text-accent-ink" strokeWidth={2} />}
            </span>
            <span className="truncate">{item.label}</span>
            {item.shortcut && (
              <span className="pl-4 text-[11px] text-fg-faint">{item.shortcut}</span>
            )}
          </button>
        ),
      )}
    </div>
  );
}

interface RuntimeDiagnosticsProps {
  readonly version: SpaceVersionOutput | null;
  readonly licenseStatus: LicenseStatusT | null;
  readonly onClose: () => void;
}

function statusClass(status: SpaceCapabilityStatus): string {
  switch (status) {
    case 'supported':
      return 'border-ok/40 bg-ok/10 text-ok';
    case 'partial':
      return 'border-warn/40 bg-warn/10 text-warn';
    case 'blocked':
      return 'border-danger/40 bg-danger/10 text-danger';
    case 'planned':
      return 'border-border-default bg-surface-3 text-fg-muted';
  }
}

type Translate = (key: MessageKey, vars?: Record<string, string | number>) => string;

const LICENSE_EDITION_KEY: Record<LicenseStatusT['edition'], MessageKey> = {
  community: 'license.edition.community',
  professional: 'license.edition.professional',
  enterprise: 'license.edition.enterprise',
};

const LICENSE_STATUS_KEY: Record<
  Exclude<LicenseStatusT['status'], 'licensed' | 'community'>,
  MessageKey
> = {
  required: 'license.status.required',
  expired: 'license.status.expired',
  invalid: 'license.status.invalid',
  degraded: 'license.status.degraded',
};

function licenseBadgeText(status: LicenseStatusT, t: Translate): string {
  if (status.status === 'licensed') {
    return t(LICENSE_EDITION_KEY[status.edition]);
  }
  if (status.status === 'community') return t('license.edition.community');
  return t(LICENSE_STATUS_KEY[status.status]);
}

function licenseBadgeClass(status: LicenseStatusT['status']): string {
  if (status === 'licensed' || status === 'community') return 'border-ok/40 bg-ok/10 text-ok';
  if (status === 'expired' || status === 'required' || status === 'degraded') {
    return 'border-warn/40 bg-warn/10 text-warn';
  }
  return 'border-danger/40 bg-danger/10 text-danger';
}

function licenseDiagnosticsText(status: LicenseStatusT, t: Translate): string {
  const parts = [licenseBadgeText(status, t)];
  if (status.customer) parts.push(t('license.customer', { customer: status.customer }));
  if (status.expiresAt) parts.push(t('license.expiresOn', { date: shortDate(status.expiresAt) }));
  return parts.join(' / ');
}

function shortDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toISOString().slice(0, 10);
}

function RuntimeDiagnostics({
  version,
  licenseStatus,
  onClose,
}: RuntimeDiagnosticsProps): JSX.Element {
  const { t } = useI18n();
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="app-no-drag absolute right-3 top-8 z-50 w-[min(420px,calc(100vw-24px))] rounded-lg border border-border-default bg-surface/95 p-3 text-xs text-fg-secondary shadow-2xl backdrop-blur-xl">
      <div className="mb-2 flex items-start justify-between gap-3">
        <div>
          <div className="text-[11px] uppercase text-fg-faint">{t('shell.runtime')}</div>
          <div className="mt-0.5 font-mono text-fg-primary">
            Space v{version?.spaceVersion ?? '?.?.?'} / KodaX SDK{' '}
            {version?.kodaxSdkVersion ?? 'unknown'}
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md px-1.5 py-0.5 text-[11px] text-fg-muted hover:bg-hover-bg hover:text-fg-primary"
          aria-label={t('shell.closeDiagnostics')}
          title={t('common.close')}
        >
          Esc
        </button>
      </div>

      <div className="mb-2 grid grid-cols-[96px_1fr] gap-x-2 gap-y-1 font-mono text-[11px]">
        <span className="text-fg-faint">{t('shell.license')}</span>
        <span>{licenseStatus ? licenseDiagnosticsText(licenseStatus, t) : t('shell.loading')}</span>
        <span className="text-fg-faint">{t('shell.contract')}</span>
        <span>{version?.capabilityContract ?? t('shell.loading')}</span>
        <span className="text-fg-faint">{t('shell.dependency')}</span>
        <span>{version?.kodaxDependencySpec ?? 'unknown'}</span>
        <span className="text-fg-faint">{t('shell.platform')}</span>
        <span>
          {version
            ? `${version.platform} / electron ${version.electronVersion} / chromium ${version.chromeVersion}`
            : t('shell.loading')}
        </span>
      </div>

      <div className="max-h-60 space-y-1 overflow-auto pr-1">
        {(version?.capabilities ?? []).map((capability) => (
          <div
            key={capability.id}
            className="rounded-md border border-border-default bg-surface-2 px-2 py-1.5"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="min-w-0 truncate font-medium text-fg-primary">
                {capability.label}
              </span>
              <span
                className={`flex-shrink-0 rounded border px-1.5 py-0.5 font-mono text-[10px] ${statusClass(
                  capability.status,
                )}`}
              >
                {capability.status}
              </span>
            </div>
            <div className="mt-1 text-[11px] leading-4 text-fg-muted">{capability.detail}</div>
          </div>
        ))}
        {!version && (
          <div className="rounded-md border border-border-default bg-surface-2 px-2 py-2 text-fg-muted">
            {t('shell.loadingDiagnostics')}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * 侧栏切换按钮 — 放在 breadcrumb 行的两端，常驻显示。
 * - icon: ◧ (left) / ◨ (right)，对应侧的紧凑指示
 * - open 时图标 text-fg-primary；close 时 text-fg-muted（让用户一眼看出当前状态）
 */
function SidebarToggleButton({ side, open, onClick }: SidebarToggleButtonProps): JSX.Element {
  const { t } = useI18n();
  const Icon = side === 'left' ? PanelLeft : PanelRight;
  const sideLabel = t(side === 'left' ? 'shell.side.left' : 'shell.side.right');
  const label = t(open ? 'shell.hideSidebar' : 'shell.showSidebar', { side: sideLabel });
  return (
    <button
      type="button"
      onClick={onClick}
      className={`ix-pop w-7 h-7 rounded-md flex items-center justify-center flex-shrink-0 hover:bg-hover-bg ${
        open ? 'text-fg-primary' : 'text-fg-muted hover:text-fg-primary'
      }`}
      title={label}
      aria-label={label}
      aria-pressed={open}
    >
      <Icon className="w-4 h-4" strokeWidth={1.75} />
    </button>
  );
}
