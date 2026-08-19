// Electron main process entry — FEATURE_001
//
// 架构判断（详见 docs/HLD.md §1.2 + docs/ADR/ADR-003）：
// - main 拥有 OS event loop、KodaX runtime（后续 FEATURE_003 接入）
// - renderer 仅 UI，不直接 import LLM/KodaX runtime
// - 安全基线：contextIsolation / nodeIntegration=false / sandbox / CSP

import {
  app,
  BrowserWindow,
  WebContentsView,
  Menu,
  Tray,
  shell,
  session,
  dialog,
  ipcMain,
  type IpcMainEvent,
  type MenuItemConstructorOptions,
} from 'electron';
import path from 'node:path';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import os from 'node:os';
import { registerVersionChannel } from './ipc/version.js';
import { registerSandboxChannels } from './ipc/sandbox.js';
import { registerRuntimeProjectionChannels } from './ipc/runtime.js';
import { registerRepointelChannels } from './ipc/repointel.js';
import { registerHandoffChannels } from './ipc/handoff.js';
import { registerSessionChannels } from './ipc/session.js';
import { registerProjectChannels } from './ipc/project.js';
import { registerPermissionChannels } from './ipc/permission.js';
import { registerAskUserChannels } from './ipc/ask-user.js';
import { registerSlashChannels, registerBuiltinSlashCommands } from './ipc/slash.js';
import { registerSkillChannels } from './ipc/skill.js';
import { registerAgentChannels } from './ipc/agent.js';
import { registerMcpChannels } from './ipc/mcp.js';
import { prewarmSdkMcpStore } from './mcp/config-reader.js';
import { disposeMcpManager } from './mcp/manager.js';
import { registerKodaxChannels } from './ipc/kodax.js';
import {
  drainQueueForSession,
  hasQueuedCoderPrompts,
  registerQueueChannels,
  startQueueWatch,
} from './ipc/queue.js';
import { registerAdminPolicyAuditChannels } from './ipc/admin.js';
import { prewarmKodaxUserConfig, registerKodaxCustomProviders } from './kodax/user-config.js';
import { probeKodaxSdk } from './kodax/kodax-sdk-probe.js';
import { probeSkillRegistry } from './skill/registry.js';
import {
  registerSpaceBuiltinSkills,
  resolveSpaceBuiltinSkillsPath,
} from './skill/space-builtins.js';
import { hydrateShellEnvOnce } from './kodax/shell-env-hydrate.js';
import { getKodaxDir, getScopedUserDataDir, applySdkHomeEnv } from './kodax/data-paths.js';
import { registerProviderChannels, injectAllKeysToEnv } from './ipc/provider.js';
import { syncSpaceCustomProvidersToRuntime } from './providers/runtime-catalog.js';
import { customProviderMutationQueue } from './providers/custom-provider-mutations.js';
import { autoActivateProvidersFromEnv } from './providers/auto-activate.js';
import { registerFilesChannels } from './ipc/files.js';
import { registerPartnerSourceChannels } from './ipc/partner-sources.js';
import { registerPartnerKbChannels } from './ipc/partner-kb.js';
import { registerPartnerDeliveryChannels } from './ipc/partner-deliveries.js';
import { registerPartnerCheckpointChannels } from './ipc/partner-checkpoints.js';
import { registerPartnerFileProposalChannels } from './ipc/partner-file-proposals.js';
import { registerTitlebarChannels } from './ipc/titlebar.js';
import { registerWindowChannels } from './ipc/window.js';
import { registerSettingsChannels } from './ipc/settings.js';
import { registerLicenseChannels } from './ipc/license.js';
import { registerNotificationChannels, setNotificationWindowGetter } from './ipc/notification.js';
import { registerUpdaterChannels, initAutoUpdater } from './ipc/updater.js';
import { registerMcpbChannels, installMcpbFromOsHandoff } from './ipc/mcpb.js';
import { registerTerminalChannels } from './ipc/terminal.js';
import { registerClipboardChannels } from './ipc/clipboard.js';
import { registerShellChannels } from './ipc/shell.js';
import { registerArtifactChannels } from './ipc/artifact.js';
import { registerWorkflowChannels } from './ipc/workflow.js';
import { registerMemoryChannels } from './ipc/memory.js';
import { learningEventBridge, registerLearningChannels } from './ipc/learning.js';
import { workflowController } from './kodax/workflow-controller.js';
import { workflowPolicyStore } from './kodax/workflow-policy.js';
import { registerArtifactWindowChannel } from './artifact/artifact-window.js';
import { installNavigationGuards } from './window/navigation-guards.js';
import { installWindowActivityPublisher } from './window/activity.js';
import { installTopmostGuard } from './window/topmost-guard.js';
import { resolveWindowIconPath } from './window/window-icon.js';
import {
  isStalePortableShortcut,
  resolveWindowsTaskbarIdentity,
} from './window/windows-taskbar-identity.js';
import {
  BOOT_SPLASH_CLOSE_URL,
  BOOT_SPLASH_RETRY_URL,
  createBootSplashUrl,
  describeUrlForLog,
  selectBootSplashVariant,
  type BootSplashRecoveryAction,
} from './window/boot-splash.js';
import { BootSplashOverlay } from './window/boot-splash-overlay.js';
import { cleanupOrphanKodaxSpaceDirWithLog } from './kodax/cleanup-orphan-kodax-space.js';
import { migrateLegacyMcpbStorage } from './mcpb/registry.js';
import { getPtyHost } from './terminal/ptyHost.js';
import { settingsStore } from './settings/store.js';
import { pushToRenderer, setRendererTarget } from './ipc/push.js';
import { kodaxHost } from './kodax/host.js';
import { externalAgentGateway } from './kodax/external-agent-gateway.js';
import { runtimeHostAdapter, type RuntimeExitSettlement } from './kodax/runtime-host-adapter.js';
import { startBackgroundRuntimeInitialization } from './kodax/background-runtime-startup.js';
import { CoderRuntimeModeSwitchCoordinator } from './kodax/coder-runtime-mode-switch.js';
import { isCoderOwnerRecoveryRestartRequired } from './kodax/coder-owner-recovery-error.js';
import { runRuntimeStartupBoundary } from './window/runtime-exit-recovery.js';
import { permissionRegistry } from './permission/registry.js';
import { permissionBroker } from './permission/broker.js';
import { askUserBroker } from './permission/ask-user-broker.js';
import { providerConfigStore } from './providers/config.js';
import {
  initializeDiagnostics,
  flushDiagnostics,
  refreshDiagnosticRedactionOptions,
} from './diagnostics/runtime.js';
import { registerDiagnosticsChannels } from './ipc/diagnostics.js';
import { registerSpaceControlChannels } from './ipc/space-control.js';
import { spaceControlRendererBroker } from './space-control/runtime.js';
import { installAppProtocolHandler, registerAppSchemePrivileges } from './window/app-protocol.js';
import {
  APP_PROTOCOL_INDEX_URL,
  APP_PROTOCOL_ORIGIN,
  ARTIFACT_HTML_FRAME_BOOTSTRAP_CSP,
  isArtifactHtmlFrameUrl,
} from './window/app-protocol-policy.js';
import { isProjectWebPreviewUrl } from './window/project-web-preview.js';
import {
  buildBackgroundTrayPresentation,
  resolveBackgroundTrayLocale,
  type BackgroundRuntimeStatus,
  type BackgroundTrayLocale,
} from './window/background-tray-model.js';
import {
  collectSpaceExitWorkBlockers,
  commitRelaunchBeforeDelayedQuit,
  resolveBlockedCompleteExitAction,
  resolveCompleteExitDisposition,
  resolveFailedCompleteExitAction,
  shouldRetryDaemonStopAfterFailedCompleteExit,
  runAdmittedCompleteExit,
  runForcedCompleteExit,
  runPreservedRuntimeCompleteExit,
  shouldCancelSessionWideOnForcedExit,
  shouldCountLocalSessionExitBlocker,
  shouldKeepLastWindowVisibleForCompleteExit,
  shouldRecoverRuntimeAfterShutdownTimeout,
  shouldRequestCompleteExitOnBeforeQuit,
} from './window/complete-exit-policy.js';
import {
  parseWindowClosePromptResult,
  resolveWindowCloseAction,
  type WindowClosePromptAction,
} from './window/window-close-behavior.js';
import { hideWindowsForShutdown, showWindowAfterFailedShutdown } from './window/shutdown-window.js';
import { RendererStartupGate } from './window/renderer-startup-gate.js';
import { RendererLoadScheduler } from './window/renderer-load-scheduler.js';
import { StartupShutdownCoordinator } from './window/startup-shutdown-coordinator.js';

// CJS 输出（见 scripts/build-main.mjs），__dirname 是原生 Node 全局
// 不用 import.meta.url（CJS 下不可用）

// dev 环境从 vite dev server 加载；生产从打包后的 index.html 加载
const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL;
const isDev = Boolean(VITE_DEV_SERVER_URL);
const SPACE_APP_NAME = 'KodaX Space';
const SPACE_APP_USER_MODEL_ID = 'ai.kodax.space';

// Custom-scheme privileges must be registered before Electron becomes ready.
registerAppSchemePrivileges();

function appendDisabledChromiumFeature(feature: string): void {
  const current = app.commandLine.getSwitchValue('disable-features');
  const features = current
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
  if (features.includes(feature)) return;
  app.commandLine.appendSwitch('disable-features', [...features, feature].join(','));
}

function installWindowsRenderingGuards(): void {
  if (process.platform !== 'win32') return;

  // Chromium's native Windows occlusion detector can occasionally misclassify
  // frameless/glass Electron windows as fully hidden after focus loss. When that
  // happens, compositor painting/input can stall until resize or remount forces
  // a repaint. Install before app ready so Chromium sees it.
  appendDisabledChromiumFeature('CalculateNativeWinOcclusion');
  app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
}

function installHardwareAccelerationOverride(): void {
  if (process.env.SPACE_DISABLE_HARDWARE_ACCELERATION !== '1') return;
  app.disableHardwareAcceleration();
  console.warn('[main] hardware acceleration disabled by SPACE_DISABLE_HARDWARE_ACCELERATION=1');
}

function logGpuFeatureStatus(source: string): void {
  try {
    console.info(
      `[main] GPU feature status (${source}): ${JSON.stringify(app.getGPUFeatureStatus())}`,
    );
  } catch (err) {
    console.warn(
      `[main] GPU feature status unavailable (${source}): ${err instanceof Error ? err.message : err}`,
    );
  }
}

function installChildProcessDiagnostics(): void {
  app.on('child-process-gone', (_event, details) => {
    const name = details.name ? ` name=${details.name}` : '';
    const service = details.serviceName ? ` service=${details.serviceName}` : '';
    console.error(
      `[main] child process gone: type=${details.type} reason=${details.reason} exitCode=${details.exitCode}${name}${service}`,
    );
    if (details.type === 'GPU') {
      logGpuFeatureStatus('gpu-process-gone');
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.invalidate();
      }
    }
  });
}

app.setName(SPACE_APP_NAME);
if (process.platform === 'win32') {
  app.setAppUserModelId(SPACE_APP_USER_MODEL_ID);
}

// KODAX_PROFILE_DIR 独立数据档时,把 SDK 数据根(sessions/config/agents)一并搬进该档,
// 靠设 KODAX_HOME(SDK 的 getAgentConfigHome 只读它,不读 KODAX_SESSIONS_DIR)。必须在任何
// loadSdkModule() 动态 import 之前(SDK 在模块加载时冻结 <KODAX_HOME>/sessions),所以放在
// bootstrap 最早期。测试模式强制隔离到 tmpdir；默认/便携版下是 no-op。
applySdkHomeEnv();

const scopedUserDataDir = getScopedUserDataDir();
if (scopedUserDataDir !== null) {
  // Playwright and explicit KODAX_PROFILE_DIR runs need Chromium userData to follow the
  // same data root. The single-instance lock is scoped to userData, so move it before
  // requestSingleInstanceLock().
  mkdirSync(scopedUserDataDir, { recursive: true });
  app.setPath('userData', scopedUserDataDir);
}

const SPACE_VERSION = process.env.npm_package_version ?? app.getVersion();
const diagnosticsLogger = initializeDiagnostics({
  userDataDir: app.getPath('userData'),
  spaceVersion: SPACE_VERSION,
  privatePathPrefixes: [getKodaxDir()],
  fileSinkEnabled: process.env.SPACE_DISABLE_DIAGNOSTIC_FILE_SINK !== '1',
});
installHardwareAccelerationOverride();
installWindowsRenderingGuards();
installChildProcessDiagnostics();

// 路径：dist-electron 与 apps/desktop/dist 是兄弟目录。
//
// dev:      __dirname = <root>/dist-electron      → ../apps/desktop/dist = <root>/apps/desktop/dist ✓
// prod asar: __dirname = app.asar/dist-electron   → ../apps/desktop/dist = app.asar/apps/desktop/dist ✓
//
// asar 兄弟关系成立的前提：electron-builder.yml 的 files glob 默认按项目根原样保留目录结构。
// 不改用 app.getAppPath()——dev 模式下 electron CLI 把 dist-electron 当应用目录，
// app.getAppPath() 会返回 <root>/dist-electron，再拼 apps/desktop/dist 反而错。
const RENDERER_DIST = path.join(__dirname, '../apps/desktop/dist');
const PRELOAD_PATH = path.join(__dirname, 'preload.js');
const WINDOW_ICON_PATH = resolveWindowIconPath({
  platform: process.platform,
  isPackaged: app.isPackaged,
  resourcesPath: process.resourcesPath,
  bundleDir: __dirname,
});
const BOOT_SPLASH_ICON_PATH = app.isPackaged
  ? path.join(process.resourcesPath, 'icon.png')
  : path.resolve(__dirname, '../resources/icon.png');
const WINDOWS_TASKBAR_IDENTITY = resolveWindowsTaskbarIdentity({
  platform: process.platform,
  isPackaged: app.isPackaged,
  appId: SPACE_APP_USER_MODEL_ID,
  appName: SPACE_APP_NAME,
  windowIconPath: WINDOW_ICON_PATH,
  execPath: process.execPath,
  portableExecutableFile: process.env.PORTABLE_EXECUTABLE_FILE,
});

function repairStaleWindowsPortableShortcut(): void {
  const relaunchExecutable = WINDOWS_TASKBAR_IDENTITY?.relaunchExecutable;
  if (
    process.platform !== 'win32' ||
    !app.isPackaged ||
    !process.env.PORTABLE_EXECUTABLE_FILE ||
    !relaunchExecutable ||
    !existsSync(relaunchExecutable)
  ) {
    return;
  }

  const shortcutPath = path.join(
    app.getPath('appData'),
    'Microsoft',
    'Windows',
    'Start Menu',
    'Programs',
    `${SPACE_APP_NAME}.lnk`,
  );
  if (!existsSync(shortcutPath)) return;

  try {
    const shortcut = shell.readShortcutLink(shortcutPath);
    if (
      !isStalePortableShortcut({
        shortcutTarget: shortcut.target,
        shortcutTargetExists: existsSync(shortcut.target),
        expectedExecutableName: `${SPACE_APP_NAME}.exe`,
        tempDir: os.tmpdir(),
      })
    ) {
      return;
    }

    const repaired = shell.writeShortcutLink(shortcutPath, 'replace', {
      target: relaunchExecutable,
      cwd: path.dirname(relaunchExecutable),
      description: SPACE_APP_NAME,
      icon: relaunchExecutable,
      iconIndex: 0,
      appUserModelId: SPACE_APP_USER_MODEL_ID,
    });
    if (repaired) {
      console.info(`[main] repaired stale portable Start Menu shortcut: ${shortcutPath}`);
    } else {
      console.warn(`[main] failed to repair stale portable Start Menu shortcut: ${shortcutPath}`);
    }
  } catch (error) {
    console.warn(
      `[main] could not inspect stale portable Start Menu shortcut: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

// THEME_BOOTSTRAP_INLINE_HASH 抽到 csp-config.ts 让单测无 electron 依赖也能 import
import { THEME_BOOTSTRAP_INLINE_HASH } from './csp-config.js';

let mainWindow: BrowserWindow | null = null;
const WINDOWS_BACKGROUND_TRAY_ENABLED =
  process.platform === 'win32' && process.env.SPACE_DISABLE_TRAY !== '1';
let backgroundTray: Tray | null = null;
let backgroundTrayRefreshTimer: ReturnType<typeof setInterval> | null = null;
let backgroundTrayRefreshing = false;
let backgroundTrayLocale: BackgroundTrayLocale = 'en-US';
let backgroundCloseNoticeShown = false;
let stopDaemonOnQuit = false;
let daemonStopConfirmedBeforeQuit = false;
let forcedExitCommitted = false;
let sharedRuntimeExitCommitted = false;
let coderRuntimeRestartScheduled = false;
let startupRecoveryRestartScheduled = false;
let secondaryInstanceExit = false;
let completeExitRequested = false;
let completeExitProgressActive = false;
let completeExitBackgroundStartedAt: number | undefined;
let completeExitBackgroundPhase: 'runtime' | 'finalizing-local' = 'runtime';
let runtimeExitRecoveryScheduled = false;
let runtimeExitRecoveryFallbackActive = false;
let beginCoderShutdown: (() => Promise<() => void>) | null = null;
let closeDecisionPending = false;
const backgroundCloseBypass = new WeakSet<BrowserWindow>();
const rendererStartupGate = new RendererStartupGate();
const startupShutdownCoordinator = new StartupShutdownCoordinator();
let fatalStartupStatus: string | null = null;
let bootSplashBrandDataUrl: string | undefined;
let mainWindowBootOverlay: BootSplashOverlay<WebContentsView> | null = null;
type BootRecoveryActionMode =
  | 'none'
  | 'renderer-retry'
  | 'app-restart'
  | 'runtime-exit-recovery'
  | 'close-only';
let mainWindowBootStatusUpdater:
  | ((message: string, action: BootRecoveryActionMode) => void)
  | null = null;
let mainWindowAwaitingInitialReveal = false;
let pendingMainWindowActivation = false;
let queueWatchShutdown: (() => void) | null = null;
const RUNTIME_EXIT_RECOVERY_ARG = '--space-runtime-exit-recovery';
const runtimeExitRecoveryRequested = process.argv.includes(RUNTIME_EXIT_RECOVERY_ARG);
let runtimeExitRecoverySettlement: RuntimeExitSettlement | undefined;
const testExitBypass =
  Boolean(process.env.KODAX_TEST_ONBOARDING) && process.env.SPACE_TEST_BYPASS_COMPLETE_EXIT === '1';
const testCompleteExitTrigger =
  Boolean(process.env.KODAX_TEST_ONBOARDING) &&
  process.env.SPACE_TEST_COMPLETE_EXIT_TRIGGER === '1';
const testCompleteExitBackgroundHoldCandidate = Number(
  process.env.SPACE_TEST_COMPLETE_EXIT_BACKGROUND_HOLD_MS ?? 0,
);
const testCompleteExitBackgroundHoldMs =
  Boolean(process.env.KODAX_TEST_ONBOARDING) &&
  Number.isFinite(testCompleteExitBackgroundHoldCandidate)
    ? Math.min(10_000, Math.max(0, testCompleteExitBackgroundHoldCandidate))
    : 0;
const testWindowHidden =
  Boolean(process.env.KODAX_TEST_ONBOARDING) && process.env.SPACE_TEST_WINDOW_HIDDEN === '1';
setRendererTarget(() => (mainWindow && !mainWindow.isDestroyed() ? mainWindow.webContents : null));

function loadBootSplashBrandDataUrl(): string | undefined {
  if (bootSplashBrandDataUrl !== undefined) return bootSplashBrandDataUrl;
  try {
    bootSplashBrandDataUrl = `data:image/png;base64,${readFileSync(BOOT_SPLASH_ICON_PATH).toString(
      'base64',
    )}`;
  } catch (error) {
    console.warn(
      '[main] boot splash brand image unavailable:',
      error instanceof Error ? error.message : String(error),
    );
  }
  return bootSplashBrandDataUrl;
}

function scheduleCoderRuntimeModeRestart(): void {
  if (coderRuntimeRestartScheduled) return;
  commitRelaunchBeforeDelayedQuit({
    commitRelaunch: () =>
      app.relaunch({
        args: process.argv.slice(1).filter((arg) => arg !== RUNTIME_EXIT_RECOVERY_ARG),
      }),
    markCommitted: () => {
      coderRuntimeRestartScheduled = true;
    },
    scheduleQuit: (callback, delayMs) => {
      setTimeout(callback, delayMs);
    },
    requestQuit: () => {
      stopDaemonOnQuit = false;
      daemonStopConfirmedBeforeQuit = false;
      app.quit();
    },
    delayMs: 250,
  });
}

function scheduleStartupRecoveryRestart(): boolean {
  if (startupRecoveryRestartScheduled) return true;
  try {
    commitRelaunchBeforeDelayedQuit({
      commitRelaunch: () =>
        app.relaunch({
          args: process.argv.slice(1).filter((arg) => arg !== RUNTIME_EXIT_RECOVERY_ARG),
        }),
      markCommitted: () => {
        startupRecoveryRestartScheduled = true;
      },
      scheduleQuit: (callback, delayMs) => {
        setTimeout(callback, delayMs);
      },
      requestQuit: () => {
        stopDaemonOnQuit = false;
        daemonStopConfirmedBeforeQuit = false;
        app.quit();
      },
      delayMs: 100,
    });
    return true;
  } catch (error) {
    console.error(
      '[main] startup relaunch failed:',
      error instanceof Error ? error.message : String(error),
    );
    return false;
  }
}

function applyCsp(): void {
  // CSP：renderer 只允许 self；dev 时放行 vite HMR（仅 script-src/connect-src）
  // 注：style-src 'unsafe-inline' 保留——React/shadcn/Radix 的内联 style props 需要；
  // 风险面在 Electron 本地环境足够小（无第三方 CSS 注入向量）。
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    // Capability-scoped project previews supply their own mode-specific CSP in
    // the protocol response. Replacing it with the app-shell policy would both
    // disable authored scripts and accidentally widen access to renderer assets.
    if (isProjectWebPreviewUrl(details.url)) {
      callback({ responseHeaders: details.responseHeaders });
      return;
    }
    // F009 CSP 扩项：
    //   - worker-src 'self' blob:  → Monaco editor 用 Web Worker（dev 走 module worker；prod 走 blob）
    //   - script-src 加 blob:       → 同上，Monaco esm worker 通过 blob URL 起
    //   - script-src 加 hash       → apps/desktop/index.html 的 theme-bootstrap inline 脚本（v0.1.7 修：
    //     dist build 模式下没有 'unsafe-inline'，inline 脚本被 CSP 拦截 → 首帧 light flash。
    //     hash 跟 inline 脚本字符 1:1 锁定；inline 改了 hash 也要改，否则 csp-hash test 会拦下。
    //     hash 与单测同源派生：apps/desktop/electron/test/csp-inline-hash.test.ts 启动 read +
    //     compute 一遍 assert 匹配，未来 inline 漂移 CI 立刻报错）
    // Interactive HTML uses one exact app:// child-frame endpoint. That endpoint
    // receives a separate bootstrap CSP; the main renderer never receives its
    // unsafe-inline policy. The iframe omits allow-same-origin and the generated
    // document adds its own restrictive permission-specific CSP.
    const csp = isArtifactHtmlFrameUrl(details.url)
      ? ARTIFACT_HTML_FRAME_BOOTSTRAP_CSP
      : isDev
        ? [
            "default-src 'self'",
            "script-src 'self' 'unsafe-inline' 'unsafe-eval' blob:",
            "worker-src 'self' blob:",
            "style-src 'self' 'unsafe-inline'",
            "img-src 'self' data: blob: https:",
            "media-src 'self' data: blob:",
            "font-src 'self' data:",
            "frame-src 'self' app:",
            "connect-src 'self' ws://localhost:* ws://127.0.0.1:* http://localhost:* http://127.0.0.1:*",
          ].join('; ')
        : [
            "default-src 'self'",
            `script-src 'self' '${THEME_BOOTSTRAP_INLINE_HASH}' blob:`,
            "worker-src 'self' blob:",
            "style-src 'self' 'unsafe-inline'",
            "img-src 'self' data: blob: https:",
            "media-src 'self' data: blob:",
            "font-src 'self' data:",
            "frame-src 'self' app:",
            "connect-src 'self'",
          ].join('; ');

    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [csp],
      },
    });
  });
}

function createMainWindow(): BrowserWindow {
  // 自定义 titlebar — 对齐 VSCode / Discord / Slack 现代 chrome：
  //   - titleBarStyle: 'hidden' 把系统标题栏隐掉
  //   - Windows: renderer 自绘 VS Code 风格 close/min/max（hover/press 更清晰）
  //   - macOS: 'hiddenInset' 自动 (Electron 自动 fallback) 让 traffic lights 留在左上角
  //
  // renderer 顶部 row 用 CSS `-webkit-app-region: drag` 当拖动条；按钮 'no-drag'。
  // Menu.setApplicationMenu(null) 在 app.whenReady 里彻底禁掉默认 File/Edit/View 菜单。
  const isMac = process.platform === 'darwin';
  const bootSplashVariant = selectBootSplashVariant();
  const bootSplashUrl = createBootSplashUrl({
    variant: bootSplashVariant,
    brandImageDataUrl: loadBootSplashBrandDataUrl(),
  });
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    title: 'KodaX Space',
    icon: WINDOW_ICON_PATH,
    backgroundColor: '#0b0b0c',
    show: false,
    alwaysOnTop: false,
    titleBarStyle: isMac ? 'hiddenInset' : 'hidden',
    titleBarOverlay: undefined,
    autoHideMenuBar: true, // Linux: 按 Alt 也不展开 (Win 上由 titleBarStyle:hidden 已无菜单)
    webPreferences: {
      preload: PRELOAD_PATH,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      // React paints underneath the independent boot overlay. Keep it running
      // even while Chromium considers the covered contents occluded; normal
      // throttling is restored only after the Shell-ready signal removes it.
      backgroundThrottling: false,
    },
  });
  if (WINDOWS_TASKBAR_IDENTITY) {
    win.setAppDetails(WINDOWS_TASKBAR_IDENTITY.appDetails);
  }
  mainWindow = win;
  mainWindowAwaitingInitialReveal = true;
  pendingMainWindowActivation = false;
  installWindowActivityPublisher(win);
  const uninstallTopmostGuard = installTopmostGuard(win, { label: 'main window' });
  const invalidateMainWindow = (): void => {
    if (!win.isDestroyed() && !win.webContents.isDestroyed()) win.webContents.invalidate();
  };
  win.on('show', invalidateMainWindow);
  win.on('focus', invalidateMainWindow);
  win.on('restore', invalidateMainWindow);
  // Windows fires query-session-end before logoff/shutdown, but another
  // application can veto the shutdown afterwards. Without the timeout reset a
  // vetoed shutdown would bypass the close-behavior policy on every later
  // close of this window.
  let systemSessionEnding = false;
  let systemSessionEndingTimer: NodeJS.Timeout | undefined;
  const markSystemSessionEnding = (): void => {
    systemSessionEnding = true;
    if (systemSessionEndingTimer) clearTimeout(systemSessionEndingTimer);
    systemSessionEndingTimer = setTimeout(() => {
      systemSessionEnding = false;
      systemSessionEndingTimer = undefined;
    }, 10_000);
    systemSessionEndingTimer.unref();
  };
  win.on('query-session-end', markSystemSessionEnding);
  win.on('session-end', markSystemSessionEnding);
  win.on('close', (event) => {
    if (_quitting || systemSessionEnding) return;
    if (backgroundCloseBypass.delete(win)) return;
    const hasUsableTray = hasUsableWindowsBackgroundTray();
    if (shouldKeepLastWindowVisibleForCompleteExit(process.platform, hasUsableTray)) {
      event.preventDefault();
      void requestCompleteExit();
      return;
    }
    if (!hasUsableTray) return;
    event.preventDefault();
    void handleMainWindowCloseRequest(win).catch((error) => {
      console.warn(
        '[main] window close decision failed:',
        error instanceof Error ? error.message : String(error),
      );
    });
  });

  // 外链白名单 + in-page 导航锁定 —— 与 artifact 独立窗口共用同一套守卫（F059c），
  // 避免两处窗口的安全策略漂移。理由：renderer 终会渲染 LLM/MCP 产生的内容，必须
  // 只放行应用自身资源（dev: Vite origin / prod: 精确 app://space origin），https 外链走系统
  // 浏览器，其余一律 deny（防 LLM 注入 file:///etc/passwd 等任意路径）。
  installNavigationGuards(win.webContents, {
    devServerUrl: VITE_DEV_SERVER_URL,
    allowedAppOrigin: APP_PROTOCOL_ORIGIN,
    openExternal: (url) => void shell.openExternal(url),
  });

  const isWindowUnavailable = (): boolean => win.isDestroyed() || win.webContents.isDestroyed();
  let retryBootAction = (): void => undefined;
  let startAppLoadAfterBoot = (_source: string): void => undefined;
  let revealWindow = (_source: string): void => undefined;
  let bootFallbackTimer: ReturnType<typeof setTimeout> | null = null;
  let bootSurfacePainted = false;
  let bootOverlayUnavailable = false;
  const requestedPaintHold = Number(process.env.SPACE_TEST_BOOT_PAINT_HOLD_MS ?? 0);
  const bootPaintHoldMs =
    process.env.KODAX_TEST_ONBOARDING && Number.isFinite(requestedPaintHold)
      ? Math.min(10_000, Math.max(0, requestedPaintHold))
      : 0;
  let bootStatusMessage = 'Opening your workspace';
  let bootRecoveryAction: BootRecoveryActionMode = 'none';
  const handleBootOverlayEnsureFailure = (context: string, error: unknown): void => {
    bootOverlayUnavailable = true;
    console.error(
      `[main] ${context} boot overlay load rejected:`,
      error instanceof Error ? error.message : String(error),
    );
  };
  const recoveryPresentation = (action: BootRecoveryActionMode): BootSplashRecoveryAction => {
    switch (action) {
      case 'renderer-retry':
        return 'try-again';
      case 'app-restart':
        return 'restart';
      case 'runtime-exit-recovery':
        return 'retry-restart';
      case 'close-only':
        return 'close-only';
      default:
        return 'none';
    }
  };
  const bootOverlay = new BootSplashOverlay<WebContentsView>({
    bootUrl: bootSplashUrl,
    host: win.contentView,
    getContentSize: () => win.getContentSize(),
    createView: () =>
      new WebContentsView({
        webPreferences: {
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
          webSecurity: true,
          allowRunningInsecureContent: false,
          backgroundThrottling: false,
        },
      }),
    onViewCreated: (view) => {
      const bootContents = view.webContents;
      bootContents.on('will-navigate', (event, url) => {
        if (url === BOOT_SPLASH_CLOSE_URL) {
          event.preventDefault();
          if (!win.isDestroyed()) win.close();
          return;
        }
        if (url === BOOT_SPLASH_RETRY_URL) {
          event.preventDefault();
          retryBootAction();
        }
      });
      installNavigationGuards(bootContents, {
        devServerUrl: undefined,
        allowedDataUrls: [bootSplashUrl],
        openExternal: (url) => void shell.openExternal(url),
      });
      bootContents.once('dom-ready', () => {
        if (bootOverlay.currentView() !== view) return;
        startAppLoadAfterBoot('boot-overlay-dom-ready');
      });
      bootContents.on('did-finish-load', () => {
        if (bootOverlay.currentView() !== view) return;
        console.info('[main] boot overlay ready');
        void bootOverlay.setStatus(bootStatusMessage, recoveryPresentation(bootRecoveryAction));
        void bootContents
          .executeJavaScript(
            `new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => {
              setTimeout(() => {
                document.body.dataset.bootPainted = 'true';
                resolve(true);
              }, ${bootPaintHoldMs});
            })))`,
            true,
          )
          .then(
            () => {
              if (bootOverlay.currentView() !== view) return;
              bootSurfacePainted = true;
              revealWindow('boot-overlay-painted');
            },
            (error: unknown) => {
              console.warn(
                '[main] boot overlay paint gate failed:',
                error instanceof Error ? error.message : String(error),
              );
            },
          );
      });
      bootContents.on('render-process-gone', (_event, details) => {
        if (
          details.reason === 'clean-exit' ||
          startupShutdownCoordinator.isShutdownRequested() ||
          !bootOverlay.invalidate(view)
        ) {
          return;
        }
        console.error(
          `[main] boot overlay renderer gone: reason=${details.reason} exitCode=${details.exitCode}`,
        );
        void bootOverlay.ensure().then(
          () => bootOverlay.setStatus(bootStatusMessage, recoveryPresentation(bootRecoveryAction)),
          (error: unknown) => {
            console.error(
              '[main] boot overlay recovery failed:',
              error instanceof Error ? error.message : String(error),
            );
          },
        );
      });
    },
    onError: (phase, error) => {
      console.warn(
        `[main] boot overlay ${phase} failed:`,
        error instanceof Error ? error.message : String(error),
      );
    },
  });
  mainWindowBootOverlay = bootOverlay;
  mainWindowBootStatusUpdater = (message, action) => {
    bootStatusMessage = message;
    bootRecoveryAction = action;
    void bootOverlay.ensure().then(
      () => bootOverlay.setStatus(message, recoveryPresentation(action)),
      (error: unknown) => handleBootOverlayEnsureFailure('boot-status', error),
    );
  };
  const resizeBootOverlay = (): void => bootOverlay.resize();
  win.on('resize', resizeBootOverlay);
  win.on('maximize', resizeBootOverlay);
  win.on('unmaximize', resizeBootOverlay);
  win.on('enter-full-screen', resizeBootOverlay);
  win.on('leave-full-screen', resizeBootOverlay);

  let windowShown = false;
  const appRendererLoadScheduler = new RendererLoadScheduler(() => rendererStartupGate.wait());
  revealWindow = (source: string): void => {
    if (startupShutdownCoordinator.isShutdownRequested() || windowShown || isWindowUnavailable()) {
      return;
    }
    if (!bootSurfacePainted && !bootOverlayUnavailable && source !== 'boot-timeout') return;
    windowShown = true;
    mainWindowAwaitingInitialReveal = false;
    if (bootFallbackTimer !== null) {
      clearTimeout(bootFallbackTimer);
      bootFallbackTimer = null;
    }
    if (!testWindowHidden) win.show();
    if (pendingMainWindowActivation) {
      pendingMainWindowActivation = false;
      win.focus();
    }
    win.webContents.invalidate();
    console.info(`[main] main window shown via ${source}`);
  };

  let appLoadAttempt = 0;
  let appLoadCommitted = false;
  let appLoadWatchdog: ReturnType<typeof setTimeout> | null = null;
  let rendererReadyCommitTimer: ReturnType<typeof setTimeout> | null = null;
  let bootStartedAppLoad = false;
  let rendererGoneRecoveries = 0;
  const appLoadMaxAttempts = 3;
  const appLoadTimeoutMs = isDev ? 20_000 : 12_000;
  const rendererGoneMaxRecoveries = 3;
  const rendererTargetDescription =
    isDev && VITE_DEV_SERVER_URL ? VITE_DEV_SERVER_URL : APP_PROTOCOL_INDEX_URL;

  const clearAppLoadWatchdog = (): void => {
    if (appLoadWatchdog === null) return;
    clearTimeout(appLoadWatchdog);
    appLoadWatchdog = null;
  };

  const setBootStatus = (
    message: string,
    recoveryAction: BootRecoveryActionMode = 'none',
  ): void => {
    if (isWindowUnavailable()) return;
    bootStatusMessage = message;
    bootRecoveryAction = recoveryAction;
    void bootOverlay.setStatus(message, recoveryPresentation(recoveryAction));
  };

  const markAppLoadCommitted = (source: string): void => {
    if (isWindowUnavailable()) return;
    const url = win.webContents.getURL();
    if (appLoadCommitted) return;
    appLoadCommitted = true;
    appLoadAttempt = 0;
    rendererGoneRecoveries = 0;
    clearAppLoadWatchdog();
    appRendererLoadScheduler.cancel();
    if (runtimeExitRecoveryFallbackActive) {
      appLoadCommitted = false;
      setBootStatus(
        'Runtime shutdown could not be recovered automatically. Restart KodaX Space.',
        'runtime-exit-recovery',
      );
      return;
    }
    bootOverlay.dispose();
    // Electron may publish the detached WebContentsView on the next main-loop
    // turn. Keep the renderer unthrottled until that removal is observable so
    // a shown Shell is never briefly paired with a stale boot overlay.
    setImmediate(() => {
      if (!isWindowUnavailable() && appLoadCommitted) {
        win.webContents.setBackgroundThrottling(true);
      }
    });
    revealWindow(source);
    win.webContents.invalidate();
    console.info(`[main] renderer visual-ready via ${source}: ${describeUrlForLog(url)}`);
  };

  const rendererReadyListener = (event: IpcMainEvent): void => {
    if (event.sender !== win.webContents) return;
    pushToRenderer('window.completeExitProgress', { active: completeExitProgressActive });
    if (rendererReadyCommitTimer !== null) return;
    const requestedDelay = Number(process.env.SPACE_TEST_STARTUP_OVERLAY_HOLD_MS ?? 0);
    const holdMs =
      process.env.KODAX_TEST_ONBOARDING && Number.isFinite(requestedDelay)
        ? Math.min(10_000, Math.max(0, requestedDelay))
        : 0;
    if (holdMs === 0) {
      markAppLoadCommitted('renderer-ready');
      return;
    }
    rendererReadyCommitTimer = setTimeout(() => {
      rendererReadyCommitTimer = null;
      markAppLoadCommitted('renderer-ready-test-hold');
    }, holdMs);
  };
  ipcMain.on('boot.rendererReady', rendererReadyListener);

  function retryAppLoad(reason: string): void {
    if (fatalStartupStatus !== null) {
      appRendererLoadScheduler.cancel();
      setBootStatus(fatalStartupStatus, 'app-restart');
      return;
    }
    if (
      startupShutdownCoordinator.isShutdownRequested() ||
      isWindowUnavailable() ||
      appLoadCommitted
    ) {
      return;
    }
    clearAppLoadWatchdog();
    if (appLoadAttempt >= appLoadMaxAttempts) {
      console.error(`[main] renderer did not commit after ${appLoadAttempt} attempt(s): ${reason}`);
      setBootStatus(
        'KodaX Space needs attention. Check diagnostics, then try again.',
        'renderer-retry',
      );
      revealWindow('renderer-load-failed');
      return;
    }
    console.warn(`[main] retrying renderer load: ${reason}`);
    setBootStatus('Trying that again');
    try {
      win.webContents.stop();
    } catch {
      // ignore stop races during renderer recovery
    }
    scheduleAppRendererLoad(reason, 250);
  }

  function loadAppRenderer(reason: string): void {
    if (fatalStartupStatus !== null) {
      appRendererLoadScheduler.cancel();
      setBootStatus(fatalStartupStatus, 'app-restart');
      return;
    }
    if (startupShutdownCoordinator.isShutdownRequested() || isWindowUnavailable()) return;
    appLoadAttempt += 1;
    appLoadCommitted = false;
    clearAppLoadWatchdog();
    console.info(
      `[main] renderer load attempt ${appLoadAttempt}/${appLoadMaxAttempts} (${reason}) -> ${rendererTargetDescription}`,
    );
    setBootStatus('Opening your workspace');
    const loadPromise =
      isDev && VITE_DEV_SERVER_URL
        ? win.loadURL(VITE_DEV_SERVER_URL)
        : win.loadURL(APP_PROTOCOL_INDEX_URL);
    loadPromise.catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes('ERR_ABORTED') || message.includes('(-3)')) {
        console.info(`[main] renderer load aborted by navigation: ${message}`);
        return;
      }
      console.error(`[main] renderer load rejected: ${message}`);
      retryAppLoad(`load rejected: ${message}`);
    });
    appLoadWatchdog = setTimeout(() => {
      retryAppLoad(`no renderer-ready signal after ${appLoadTimeoutMs}ms`);
    }, appLoadTimeoutMs);
    appLoadWatchdog.unref?.();
  }

  const scheduleAppRendererLoad = (source: string, delayMs: number): void => {
    appRendererLoadScheduler.schedule(() => {
      if (startupShutdownCoordinator.isShutdownRequested() || isWindowUnavailable()) return;
      loadAppRenderer(source);
    }, delayMs);
  };

  startAppLoadAfterBoot = (source: string): void => {
    if (
      startupShutdownCoordinator.isShutdownRequested() ||
      bootStartedAppLoad ||
      isWindowUnavailable()
    ) {
      return;
    }
    bootStartedAppLoad = true;
    if (fatalStartupStatus !== null) {
      setBootStatus(fatalStartupStatus, 'app-restart');
      return;
    }
    scheduleAppRendererLoad(source, 50);
  };

  bootFallbackTimer = setTimeout(() => {
    startAppLoadAfterBoot('boot-timeout');
    revealWindow('boot-timeout');
  }, 1500 + bootPaintHoldMs);
  bootFallbackTimer.unref?.();

  win.webContents.on('did-start-navigation', (_event, url, isInPlace, isMainFrame) => {
    if (isInPlace || !isMainFrame || !appLoadCommitted) return;
    appLoadCommitted = false;
    appLoadAttempt = 0;
    win.webContents.setBackgroundThrottling(false);
    if (rendererReadyCommitTimer !== null) {
      clearTimeout(rendererReadyCommitTimer);
      rendererReadyCommitTimer = null;
    }
    void bootOverlay.ensure().then(
      () => setBootStatus('Refreshing your workspace'),
      (error: unknown) => handleBootOverlayEnsureFailure('renderer-reload', error),
    );
    clearAppLoadWatchdog();
    appLoadWatchdog = setTimeout(() => {
      retryAppLoad(`no renderer-ready signal after reload of ${describeUrlForLog(url)}`);
    }, appLoadTimeoutMs);
    appLoadWatchdog.unref?.();
  });
  win.webContents.on('dom-ready', () => {
    console.info(`[main] renderer dom-ready: ${describeUrlForLog(win.webContents.getURL())}`);
    if (fatalStartupStatus !== null) setBootStatus(fatalStartupStatus, 'app-restart');
  });
  win.webContents.on(
    'did-fail-provisional-load',
    (_event, errorCode, errorDescription, validatedURL) => {
      if (errorCode === -3) return; // ERR_ABORTED is normal for cancelled dev navigations.
      console.error(
        `[main] renderer did-fail-provisional-load: code=${errorCode} ${errorDescription} url=${describeUrlForLog(validatedURL)}`,
      );
    },
  );
  win.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    if (errorCode === -3) return; // ERR_ABORTED is normal for cancelled dev navigations.
    console.error(
      `[main] renderer did-fail-load: code=${errorCode} ${errorDescription} url=${describeUrlForLog(validatedURL)}`,
    );
    revealWindow('did-fail-load');
    retryAppLoad(`did-fail-load ${errorCode} ${errorDescription}`);
  });
  win.webContents.on('render-process-gone', (_event, details) => {
    console.error(
      `[main] renderer process gone: reason=${details.reason} exitCode=${details.exitCode}`,
    );
    clearAppLoadWatchdog();
    if (rendererReadyCommitTimer !== null) {
      clearTimeout(rendererReadyCommitTimer);
      rendererReadyCommitTimer = null;
    }
    if (startupShutdownCoordinator.isShutdownRequested() || details.reason === 'clean-exit') return;
    if (fatalStartupStatus !== null) {
      appRendererLoadScheduler.cancel();
      appLoadCommitted = false;
      void bootOverlay.ensure().then(
        () => setBootStatus(fatalStartupStatus ?? 'Startup could not finish.', 'app-restart'),
        (err: unknown) => {
          const message = err instanceof Error ? err.message : String(err);
          console.error(`[main] fatal-state boot overlay load rejected: ${message}`);
        },
      );
      return;
    }
    rendererGoneRecoveries += 1;
    if (rendererGoneRecoveries > rendererGoneMaxRecoveries) {
      console.error(
        `[main] renderer crashed repeatedly; recovery stopped after ${rendererGoneMaxRecoveries} attempt(s)`,
      );
      void bootOverlay.ensure().then(
        () =>
          setBootStatus(
            'Renderer crashed repeatedly. Check diagnostics, then try again.',
            'renderer-retry',
          ),
        (error: unknown) => handleBootOverlayEnsureFailure('renderer-crash-loop', error),
      );
      revealWindow('renderer-crash-loop');
      return;
    }
    appLoadCommitted = false;
    win.webContents.setBackgroundThrottling(false);
    const recoveryDelayMs = Math.min(500 * rendererGoneRecoveries, 2_000);
    void bootOverlay.ensure().then(
      () => setBootStatus('Restoring your workspace'),
      (err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[main] recovery boot overlay load rejected: ${message}`);
      },
    );
    scheduleAppRendererLoad(`render-process-gone:${details.reason}`, recoveryDelayMs);
  });

  retryBootAction = (): void => {
    if (isWindowUnavailable()) return;
    if (bootRecoveryAction === 'runtime-exit-recovery') {
      if (scheduleRuntimeExitRecovery('the user retried recovery from the boot overlay')) {
        setBootStatus('Restarting KodaX Space');
        app.exit(0);
      }
      return;
    }
    if (startupShutdownCoordinator.isShutdownRequested()) return;
    if (bootRecoveryAction === 'app-restart') {
      if (scheduleStartupRecoveryRestart()) {
        setBootStatus('Restarting KodaX Space');
      } else {
        setBootStatus(
          'Restart could not be scheduled. Close and reopen KodaX Space.',
          'close-only',
        );
      }
      return;
    }
    if (bootRecoveryAction !== 'renderer-retry') return;
    appLoadAttempt = 0;
    rendererGoneRecoveries = 0;
    appLoadCommitted = false;
    win.webContents.setBackgroundThrottling(false);
    clearAppLoadWatchdog();
    if (rendererReadyCommitTimer !== null) {
      clearTimeout(rendererReadyCommitTimer);
      rendererReadyCommitTimer = null;
    }
    void bootOverlay.ensure().then(
      () => setBootStatus('Trying that again'),
      (error: unknown) => handleBootOverlayEnsureFailure('boot-overlay-retry', error),
    );
    scheduleAppRendererLoad('boot-overlay-retry', 0);
  };

  win.on('closed', () => {
    ipcMain.removeListener('boot.rendererReady', rendererReadyListener);
    uninstallTopmostGuard();
    if (bootFallbackTimer !== null) clearTimeout(bootFallbackTimer);
    clearAppLoadWatchdog();
    if (rendererReadyCommitTimer !== null) clearTimeout(rendererReadyCommitTimer);
    appRendererLoadScheduler.cancel();
    bootOverlay.dispose();
    if (mainWindowBootOverlay === bootOverlay) mainWindowBootOverlay = null;
    if (mainWindowBootStatusUpdater !== null) mainWindowBootStatusUpdater = null;
    if (mainWindow === win) {
      mainWindow = null;
      mainWindowAwaitingInitialReveal = false;
      pendingMainWindowActivation = false;
    }
    if (
      WINDOWS_BACKGROUND_TRAY_ENABLED &&
      backgroundTray !== null &&
      !backgroundTray.isDestroyed() &&
      !_quitting &&
      !backgroundCloseNoticeShown
    ) {
      backgroundCloseNoticeShown = true;
      const zh = backgroundTrayLocale === 'zh-CN';
      try {
        backgroundTray.displayBalloon({
          title: zh ? 'KodaX Space 正在后台运行' : 'KodaX Space is running in the background',
          content: zh
            ? '界面已关闭，Runtime 仍在运行。点击托盘图标可重新打开，右键可彻底退出。'
            : 'The window is closed while Runtime keeps running. Click the tray icon to reopen, or right-click to quit completely.',
          iconType: 'info',
        });
      } catch (error) {
        console.warn(
          '[main] background tray notice failed:',
          error instanceof Error ? error.message : error,
        );
      }
    }
    void refreshWindowsBackgroundTray();
  });

  void bootOverlay.ensure().catch((err: unknown) => {
    handleBootOverlayEnsureFailure('initial', err);
    startAppLoadAfterBoot('boot-overlay-load-rejected');
  });
  if (isDev && VITE_DEV_SERVER_URL) {
    // dev mode 也不再自动开 DevTools——用户用 View → Toggle Developer Tools 菜单或
    // Ctrl+Shift+I 快捷键按需打开。默认开会让首次启动多个浮窗显得突兀。
    // 若开发期想要自动打开，设环境变量 SPACE_AUTO_DEVTOOLS=1。
    if (process.env.SPACE_AUTO_DEVTOOLS === '1') {
      win.webContents.openDevTools({ mode: 'detach' });
    }
  }
  return win;
}

function showOrCreateMainWindow(): BrowserWindow {
  const existing = mainWindow;
  if (existing && !existing.isDestroyed()) {
    if (mainWindowAwaitingInitialReveal) {
      pendingMainWindowActivation = true;
      return existing;
    }
    if (existing.isMinimized()) existing.restore();
    existing.show();
    existing.focus();
    return existing;
  }
  return createMainWindow();
}

function setVisibleBootStatus(
  message: string,
  action: BootRecoveryActionMode = 'close-only',
): void {
  mainWindowBootStatusUpdater?.(message, action);
}

function activateMainWindow(): void {
  if (startupShutdownCoordinator.isShutdownRequested()) return;
  if (app.isReady()) {
    showOrCreateMainWindow();
    return;
  }
  void app.whenReady().then(() => showOrCreateMainWindow());
}

function setCompleteExitProgress(active: boolean): void {
  if (completeExitProgressActive === active) return;
  completeExitProgressActive = active;
  const win = mainWindow;
  if (win !== null && !win.isDestroyed()) {
    try {
      if (active) win.setProgressBar(2, { mode: 'indeterminate' });
      else win.setProgressBar(-1);
    } catch (error) {
      console.warn(
        '[main] could not update complete-exit taskbar progress:',
        error instanceof Error ? error.message : String(error),
      );
    }
  }
  pushToRenderer('window.completeExitProgress', { active });
}

function logCompleteExitPresentationError(error: unknown): void {
  console.warn(
    '[main] complete exit presentation failed:',
    error instanceof Error ? error.message : String(error),
  );
}

function restoreVisibleExitControlSurface(): void {
  completeExitBackgroundStartedAt = undefined;
  completeExitBackgroundPhase = 'runtime';
  setCompleteExitProgress(false);
  try {
    installWindowsBackgroundTray();
  } catch (error) {
    console.warn(
      '[main] could not restore the background tray after cancelled exit:',
      error instanceof Error ? error.message : String(error),
    );
  }
  activateMainWindow();
  void refreshWindowsBackgroundTray();
}

function continueCompleteExitInBackground(locale: BackgroundTrayLocale): void {
  try {
    installWindowsBackgroundTray();
  } catch (error) {
    console.warn(
      '[main] could not prepare background safe-exit tray:',
      error instanceof Error ? error.message : String(error),
    );
  }
  if (!hasUsableWindowsBackgroundTray()) return;
  completeExitBackgroundStartedAt = Date.now();
  completeExitBackgroundPhase = 'runtime';
  backgroundTrayLocale = locale;
  updateWindowsBackgroundTrayMenu({
    state: 'exiting',
    activeWork: 0,
    otherClients: 0,
    canStop: false,
    blockers: [],
    exitElapsedSeconds: 0,
  });
  try {
    backgroundTray?.displayBalloon({
      title:
        locale === 'zh-CN'
          ? 'KodaX Space 正在后台安全退出'
          : 'KodaX Space is quitting safely in the background',
      content:
        locale === 'zh-CN'
          ? '正在安全清理 Runtime；完成后会自动退出。若清理失败，Space 会自动恢复窗口。'
          : 'Runtime cleanup continues safely. Space exits automatically when done and restores the window if cleanup fails.',
      iconType: 'info',
    });
  } catch (error) {
    console.warn(
      '[main] could not show background safe-exit notice:',
      error instanceof Error ? error.message : String(error),
    );
  }
  hideExitWindowsForBackgroundShutdown();
}

function markCompleteExitLocalFinalization(): void {
  const startedAt = completeExitBackgroundStartedAt;
  if (startedAt === undefined) return;
  completeExitBackgroundPhase = 'finalizing-local';
  updateWindowsBackgroundTrayMenu({
    state: 'exiting',
    activeWork: 0,
    otherClients: 0,
    canStop: false,
    blockers: [],
    exitElapsedSeconds: Math.floor((Date.now() - startedAt) / 1_000),
    exitPhase: completeExitBackgroundPhase,
  });
  hideExitWindowsForBackgroundShutdown();
}

function hideExitWindowsForBackgroundShutdown(): void {
  if (completeExitProgressActive && !forcedExitCommitted && !hasUsableWindowsBackgroundTray())
    return;
  hideWindowsForShutdown(BrowserWindow.getAllWindows(), (error) => {
    console.warn(
      '[main] could not move a window behind background safe exit:',
      error instanceof Error ? error.message : String(error),
    );
  });
}

function hideExitControlSurfaceForBackgroundShutdown(): void {
  completeExitBackgroundStartedAt = undefined;
  completeExitBackgroundPhase = 'runtime';
  hideWindowsForShutdown(BrowserWindow.getAllWindows(), (error) => {
    console.warn(
      '[main] could not hide a window during shutdown:',
      error instanceof Error ? error.message : String(error),
    );
  });
  disposeWindowsBackgroundTray();
}

function scheduleRuntimeExitRecovery(reason: string): boolean {
  if (runtimeExitRecoveryScheduled) return true;
  try {
    app.relaunch({
      args: [
        ...process.argv.slice(1).filter((arg) => arg !== RUNTIME_EXIT_RECOVERY_ARG),
        RUNTIME_EXIT_RECOVERY_ARG,
      ],
    });
    runtimeExitRecoveryScheduled = true;
    console.warn(
      `[main] reopening Space because complete Runtime exit was not confirmed: ${reason}`,
    );
    return true;
  } catch (error) {
    console.error(
      '[main] could not schedule the Runtime exit recovery relaunch:',
      error instanceof Error ? error.message : String(error),
    );
    restoreVisibleExitControlSurface();
    return false;
  }
}

function keepSpaceVisibleAfterRecoveryRelaunchFailure(): void {
  const firstFallbackActivation = !runtimeExitRecoveryFallbackActive;
  runtimeExitRecoveryFallbackActive = true;
  completeExitBackgroundStartedAt = undefined;
  completeExitBackgroundPhase = 'runtime';
  setCompleteExitProgress(false);
  stopDaemonOnQuit = false;
  daemonStopConfirmedBeforeQuit = false;
  _quitting = false;
  // Runtime/MCP cleanup may already be irreversible. Keep Coder admission
  // fail-closed rather than presenting a control surface that looks healthy.
  try {
    installWindowsBackgroundTray();
    showWindowAfterFailedShutdown(BrowserWindow.getAllWindows(), () => showOrCreateMainWindow());
    setVisibleBootStatus(
      'Runtime shutdown could not be recovered automatically. Restart KodaX Space.',
      'runtime-exit-recovery',
    );
    void refreshWindowsBackgroundTray();
  } catch (error) {
    console.error(
      '[main] could not restore the existing control surface after relaunch failure:',
      error instanceof Error ? error.message : String(error),
    );
  }
  // Repeated failures must always restore the window and fail-closed overlay.
  // Only the modal dialog itself is one-shot.
  if (!firstFallbackActivation) return;
  void dialog
    .showMessageBox({
      type: 'error',
      title: 'KodaX Space',
      message: 'Coder Runtime could not be stopped safely',
      detail:
        'Space could not register its automatic recovery relaunch. A visible fail-closed window will remain; Coder actions stay disabled. Retry the restart, or restart KodaX Space manually.',
      buttons: ['Retry restart', 'Keep fail-closed window open'],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
    })
    .then((result) => {
      if (result.response !== 0) return;
      if (scheduleRuntimeExitRecovery('the user retried recovery after relaunch failure')) {
        hideExitControlSurfaceForBackgroundShutdown();
        app.exit(0);
      }
    })
    .catch((error) => {
      console.error(
        '[main] could not show the failed-shutdown recovery dialog:',
        error instanceof Error ? error.message : String(error),
      );
    });
}

async function showRuntimeExitRecoveryNoticeIfNeeded(): Promise<void> {
  if (!runtimeExitRecoveryRequested) return;
  restoreVisibleExitControlSurface();
  const locale = await resolveCurrentTrayLocale();
  const zh = locale === 'zh-CN';
  const settlement = runtimeExitRecoverySettlement;
  const detail =
    settlement?.status === 'blocked'
      ? settlement.message
      : zh
        ? 'Runtime 停止请求尚未形成可恢复的安全提交。Space 已继续正常启动；请确认任务状态后再次尝试完整退出。'
        : 'The Runtime stop did not reach a recoverable committed state. Space continued normal startup; verify work status and retry complete exit.';
  await dialog.showMessageBox({
    type: 'warning',
    title: zh ? 'KodaX Space 已重新打开' : 'KodaX Space reopened',
    message: zh ? 'Coder Runtime 退出尚未提交' : 'Coder Runtime exit was not committed',
    detail,
    buttons: [zh ? '确定' : 'OK'],
    defaultId: 0,
    noLink: true,
  });
}

async function resolveCurrentTrayLocale(): Promise<BackgroundTrayLocale> {
  try {
    const settings = await settingsStore.load();
    return resolveBackgroundTrayLocale(settings.languageMode, app.getPreferredSystemLanguages());
  } catch {
    return resolveBackgroundTrayLocale('system', app.getPreferredSystemLanguages());
  }
}

function hasUsableWindowsBackgroundTray(): boolean {
  return (
    WINDOWS_BACKGROUND_TRAY_ENABLED && backgroundTray !== null && !backgroundTray.isDestroyed()
  );
}

function closeMainWindowToBackground(win: BrowserWindow): void {
  if (win.isDestroyed()) return;
  backgroundCloseBypass.add(win);
  try {
    win.close();
  } catch (error) {
    backgroundCloseBypass.delete(win);
    console.warn(
      '[main] close-to-tray failed:',
      error instanceof Error ? error.message : String(error),
    );
  }
}

async function promptForWindowCloseAction(win: BrowserWindow): Promise<WindowClosePromptAction> {
  const locale = await resolveCurrentTrayLocale();
  const zh = locale === 'zh-CN';
  const result = await dialog.showMessageBox(win, {
    type: 'question',
    title: zh ? '关闭 KodaX Space' : 'Close KodaX Space',
    message: zh
      ? '点击关闭按钮时，KodaX Space 应该怎么做？'
      : 'What should KodaX Space do when you close the window?',
    detail: zh
      ? '你可以保留托盘和 Runtime 在后台运行，也可以安全尝试彻底退出。正在执行的任务或其他客户端仍会受到 Runtime 安全检查保护。'
      : 'You can keep the tray and Runtime running in the background, or safely attempt a complete exit. Active work and other clients remain protected by the Runtime safety check.',
    buttons: zh
      ? ['最小化到托盘', '彻底退出', '取消']
      : ['Minimize to tray', 'Quit completely', 'Cancel'],
    defaultId: 0,
    cancelId: 2,
    noLink: true,
    checkboxLabel: zh ? '记住我的选择' : 'Remember my choice',
    checkboxChecked: false,
  });
  const parsed = parseWindowClosePromptResult(result);
  if ('rememberedBehavior' in parsed && parsed.rememberedBehavior !== undefined) {
    try {
      await settingsStore.setWindowCloseBehavior(parsed.rememberedBehavior);
    } catch (error) {
      console.warn(
        '[main] could not persist the remembered window close behavior:',
        error instanceof Error ? error.message : String(error),
      );
      if (!win.isDestroyed()) {
        try {
          await dialog.showMessageBox(win, {
            type: 'warning',
            title: zh ? '无法记住此选择' : 'Could not remember this choice',
            message: zh ? '退出偏好未能保存' : 'The close preference could not be saved',
            detail: zh
              ? '本次操作仍会执行；下次关闭窗口时，KodaX Space 会再次询问。'
              : 'This action will still run once. KodaX Space will ask again the next time you close the window.',
            buttons: [zh ? '确定' : 'OK'],
            defaultId: 0,
            noLink: true,
          });
        } catch (warningError) {
          console.warn(
            '[main] could not show the close-preference save warning:',
            warningError instanceof Error ? warningError.message : String(warningError),
          );
        }
      }
    }
  }
  return parsed.action;
}

async function handleMainWindowCloseRequest(win: BrowserWindow): Promise<void> {
  if (closeDecisionPending || win.isDestroyed()) return;
  closeDecisionPending = true;
  try {
    let behavior: Awaited<ReturnType<typeof settingsStore.load>>['windowCloseBehavior'] = 'ask';
    try {
      behavior = (await settingsStore.load()).windowCloseBehavior;
    } catch (error) {
      console.warn(
        '[main] could not load the window close behavior; asking this time:',
        error instanceof Error ? error.message : String(error),
      );
    }

    let action: WindowClosePromptAction | 'allow-close' | 'prompt' = resolveWindowCloseAction(
      behavior,
      hasUsableWindowsBackgroundTray(),
    );
    if (action === 'prompt') {
      action = await promptForWindowCloseAction(win);
    }

    if (action === 'allow-close' || action === 'minimize-to-tray') {
      closeMainWindowToBackground(win);
    } else if (action === 'quit-completely') {
      await requestCompleteExit();
    }
  } finally {
    closeDecisionPending = false;
  }
}

async function collectBackgroundRuntimeStatus(): Promise<BackgroundRuntimeStatus> {
  if (!runtimeHostAdapter.hasReadyRuntime()) {
    return {
      state: runtimeHostAdapter.snapshot().state === 'initializing' ? 'checking' : 'unavailable',
      activeWork: 0,
      otherClients: 0,
      canStop: false,
      blockers: [],
    };
  }
  try {
    const management = await runtimeHostAdapter.inspectDaemonStop();
    const preflight = management.preflight;
    return {
      state: 'ready',
      activeWork:
        preflight.activeRuns.length +
        preflight.queuedRuns.length +
        preflight.activeWorkflows.length +
        preflight.activeAgentTurns.length +
        preflight.pendingPermissions.length +
        preflight.pendingUserInputs.length,
      otherClients: Math.max(0, preflight.clientCount - 1),
      canStop: preflight.canStop,
      blockers: preflight.blockers,
    };
  } catch (error) {
    console.warn(
      '[main] background Runtime inspection failed:',
      error instanceof Error ? error.message : error,
    );
    return {
      state: 'unavailable',
      activeWork: 0,
      otherClients: 0,
      canStop: false,
      blockers: [],
    };
  }
}

async function collectActiveSpaceExitBlockers(
  runtimeStatus?: Promise<BackgroundRuntimeStatus>,
): Promise<readonly string[]> {
  const externalTasksPromise = externalAgentGateway.listTasks();
  const runtime = runtimeStatus === undefined ? undefined : await runtimeStatus;
  const runtimeSelected = runtimeHostAdapter.selectedHost() === 'runtime';
  const runningSessions = kodaxHost.listInFlight().filter(
    (session) =>
      session.isRunning() &&
      shouldCountLocalSessionExitBlocker({
        surface: session.surface,
        runtimeSelected,
        runtimeAuthorityReady: runtime?.state === 'ready',
      }),
  ).length;
  const runningWorkflows = workflowController
    .list()
    .filter((run) => run.status === 'running' || run.status === 'paused').length;
  const externalTasks = await externalTasksPromise;
  const activeExternalTasks = externalTasks.filter(
    (task) =>
      task.state !== 'completed' &&
      task.state !== 'failed' &&
      task.state !== 'canceled' &&
      task.state !== 'rejected',
  ).length;
  return collectSpaceExitWorkBlockers({
    runningSessions,
    runningWorkflows,
    pendingPermissions: permissionBroker.pendingCount(),
    pendingUserInputs: askUserBroker.pendingCount(),
    queuedPrompts: hasQueuedCoderPrompts() ? 1 : 0,
    activeExternalTasks,
  });
}

const FORCED_EXIT_STEP_TIMEOUT_MS = 4_000;

async function runForcedExitStep<T>(label: string, operation: Promise<T>): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      reject(new Error(`${label} exceeded ${FORCED_EXIT_STEP_TIMEOUT_MS}ms`));
    }, FORCED_EXIT_STEP_TIMEOUT_MS);
    timeout.unref?.();
  });
  try {
    return await Promise.race([operation, deadline]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

async function stopSpaceOwnedWorkForForcedExit(): Promise<void> {
  const sessions = kodaxHost.listInFlight();
  const sessionIds = sessions.map((session) => session.sessionId);
  const runningSessions = sessions.filter((session) => session.isRunning());
  // A daemon-backed Coder Session may also be attached by another client.
  // Never use its Session-wide Stop path during Space force-close; the Runtime
  // adapter below cancels only principal/run identities attributable to Space.
  const locallyOwnedRunningSessions = runningSessions.filter((session) =>
    shouldCancelSessionWideOnForcedExit({
      surface: session.surface,
      runtimeSelected: runtimeHostAdapter.isRuntimeSelected(),
    }),
  );
  const runningWorkflows = workflowController
    .list()
    .filter((run) => run.status === 'running' || run.status === 'paused');
  const externalTasks = await externalAgentGateway.listTasks();
  const activeExternalTasks = externalTasks.filter(
    (task) =>
      task.state !== 'completed' &&
      task.state !== 'failed' &&
      task.state !== 'canceled' &&
      task.state !== 'rejected',
  );

  permissionBroker.cancelAll('shutdown');
  askUserBroker.cancelAll('shutdown');
  const localStops = await Promise.allSettled([
    ...locallyOwnedRunningSessions.map((session) => kodaxHost.cancel(session.sessionId)),
    ...sessionIds.map((sessionId) => drainQueueForSession(sessionId)),
    ...runningWorkflows.map((run) => workflowController.stop(run.runId, 'KodaX Space force close')),
    ...activeExternalTasks.map((task) =>
      externalAgentGateway.cancelTask(task.taskId, 'KodaX Space force close'),
    ),
  ]);
  const runtimeStop = await runtimeHostAdapter.stopSpaceOwnedRuntimeWorkForForcedExit();
  const failures = localStops.filter((result) => result.status === 'rejected');
  if (failures.length > 0 || runtimeStop.failed > 0) {
    throw new AggregateError(
      [
        ...failures.map((result) => result.reason),
        ...(runtimeStop.failed > 0
          ? [new Error(`${runtimeStop.failed} Runtime cancellation operation(s) failed`)]
          : []),
      ],
      'Some Space-owned work did not confirm cancellation before forced exit.',
    );
  }
}

async function tryStopDaemonAfterForcedExitCancellation(): Promise<boolean> {
  const runtime = await collectBackgroundRuntimeStatus();
  if (runtime.state === 'ready' && !runtime.canStop) {
    return false;
  }
  await runtimeHostAdapter.stopDaemonForCompleteExit();
  return true;
}

async function forceCompleteExit(
  options: { readonly skipDaemonStop?: boolean } = {},
): Promise<void> {
  const result = await runForcedCompleteExit({
    hideControlSurface: hideExitControlSurfaceForBackgroundShutdown,
    stopOwnedWork: () =>
      runForcedExitStep('Space task cancellation', stopSpaceOwnedWorkForForcedExit()),
    tryStopDaemon:
      options.skipDaemonStop === true
        ? async () => false
        : () =>
            runForcedExitStep(
              'Runtime shutdown after forced cancellation',
              tryStopDaemonAfterForcedExitCancellation(),
            ),
    commitExit: (outcome) => {
      forcedExitCommitted = true;
      daemonStopConfirmedBeforeQuit = outcome.daemonStopConfirmed;
      stopDaemonOnQuit = outcome.daemonStopConfirmed;
      app.quit();
    },
  });
  for (const failure of result.failures) {
    console.warn(
      '[main] forced exit cleanup did not finish:',
      failure instanceof Error ? failure.message : String(failure),
    );
  }
}

async function requestCompleteExit(): Promise<void> {
  if (completeExitRequested) return;
  completeExitRequested = true;
  setCompleteExitProgress(true);
  const requestStartedAt = Date.now();
  console.info('[main] complete exit requested; preparing safe shutdown');
  let reopenCoderAdmission: (() => void) | undefined;
  let exitCommitted = false;
  let keepCoderAdmissionClosed = false;
  try {
    reopenCoderAdmission = await beginCoderShutdown?.();
    const locale = await resolveCurrentTrayLocale();
    const runtimeStatus = collectBackgroundRuntimeStatus();
    const [runtime, spaceBlockers] = await Promise.all([
      runtimeStatus,
      collectActiveSpaceExitBlockers(runtimeStatus),
    ]);
    const runtimeBlockers = runtime.state === 'ready' && !runtime.canStop ? runtime.blockers : [];
    const blockers = [...spaceBlockers, ...runtimeBlockers];
    const disposition = resolveCompleteExitDisposition({ spaceBlockers, runtimeBlockers });
    console.info(`[main] complete exit preflight settled in ${Date.now() - requestStartedAt}ms`);
    if (disposition === 'exit-preserve-runtime') {
      exitCommitted = true;
      sharedRuntimeExitCommitted = true;
      runPreservedRuntimeCompleteExit({
        beginBackgroundExit: () => continueCompleteExitInBackground(locale),
        beginLocalFinalization: markCompleteExitLocalFinalization,
        handlePresentationError: logCompleteExitPresentationError,
        commitExit: () => app.quit(),
      });
      return;
    }
    if (disposition === 'confirm-blocked-exit') {
      const blockerSummary = blockers.join(', ');
      const zh = locale === 'zh-CN';
      restoreVisibleExitControlSurface();
      const result = await dialog.showMessageBox({
        type: 'warning',
        title: zh ? 'Runtime 仍在使用中' : 'Runtime is still in use',
        message: zh
          ? '仍有任务正在运行，是否强行关闭 KodaX Space？'
          : 'Work is still running. Force KodaX Space to close?',
        detail: zh
          ? `Runtime 或 Space 仍有工作、交互或其他客户端（${blockerSummary}）。选择“强行关闭”会立即停止当前 Space 所属的任务并完全退出；其他客户端的任务不会被停止，其 Runtime 会继续保留。`
          : `Runtime or Space still has work, interactions, or other clients (${blockerSummary}). “Force close” stops work owned by this Space and exits completely. Work owned by other clients is preserved with their Runtime.`,
        buttons: zh ? ['保持 Space 开启', '强行关闭'] : ['Keep Space open', 'Force close'],
        defaultId: 0,
        cancelId: 0,
        noLink: true,
      });
      if (resolveBlockedCompleteExitAction(result.response) === 'force-close') {
        exitCommitted = true;
        await forceCompleteExit();
      }
      return;
    }
    await runAdmittedCompleteExit({
      hideControlSurface: () => continueCompleteExitInBackground(locale),
      stopDaemon: async () => {
        if (testCompleteExitBackgroundHoldMs > 0) {
          await new Promise<void>((resolve) =>
            setTimeout(resolve, testCompleteExitBackgroundHoldMs),
          );
        }
        await runtimeHostAdapter.stopDaemonForCompleteExit();
      },
      beginLocalFinalization: markCompleteExitLocalFinalization,
      handlePresentationError: logCompleteExitPresentationError,
      commitExit: () => {
        daemonStopConfirmedBeforeQuit = true;
        stopDaemonOnQuit = true;
        exitCommitted = true;
        app.quit();
      },
    });
  } catch (error) {
    restoreVisibleExitControlSurface();
    const locale = await resolveCurrentTrayLocale().catch((localeError) => {
      console.warn(
        '[main] complete exit failure locale resolution failed:',
        localeError instanceof Error ? localeError.message : String(localeError),
      );
      return 'en-US' as const;
    });
    const zh = locale === 'zh-CN';
    console.warn(
      '[main] complete exit preparation failed:',
      error instanceof Error ? error.message : String(error),
    );
    const result = await dialog.showMessageBox({
      type: 'warning',
      title: zh ? '暂时无法安全退出' : 'Space cannot quit safely yet',
      message: zh
        ? '退出准备没有安全完成，是否强行关闭？'
        : 'The complete-exit preparation did not finish safely. Force close?',
      detail: zh
        ? '选择“强行关闭”会停止当前 Space 所属的任务并完全退出。无法确认归属的其他客户端任务不会被终止，共享 Runtime 可能继续保留。'
        : '“Force close” stops work owned by this Space and exits completely. Work whose ownership cannot be proven is preserved, and the shared Runtime may remain available.',
      buttons: zh ? ['保持 Space 开启', '强行关闭'] : ['Keep Space open', 'Force close'],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    });
    const failureAction = resolveFailedCompleteExitAction(
      result.response,
      isCoderOwnerRecoveryRestartRequired(error),
    );
    if (failureAction === 'force-close') {
      exitCommitted = true;
      await forceCompleteExit({
        skipDaemonStop: !shouldRetryDaemonStopAfterFailedCompleteExit(
          isCoderOwnerRecoveryRestartRequired(error),
        ),
      });
    } else if (failureAction === 'restart-recovery') {
      if (scheduleRuntimeExitRecovery('daemon shutdown recovery requires a restart')) {
        exitCommitted = true;
        hideExitControlSurfaceForBackgroundShutdown();
        app.exit(0);
      } else {
        keepCoderAdmissionClosed = true;
        keepSpaceVisibleAfterRecoveryRelaunchFailure();
      }
    }
  } finally {
    if (!exitCommitted) {
      if (!keepCoderAdmissionClosed) reopenCoderAdmission?.();
      setCompleteExitProgress(false);
    }
    completeExitRequested = false;
  }
}

function installTestCompleteExitTrigger(): void {
  if (!testCompleteExitTrigger) return;
  const triggerFile = path.join(getKodaxDir(), 'space', 'complete-exit.trigger');
  const timer = setInterval(() => {
    if (!existsSync(triggerFile)) return;
    clearInterval(timer);
    void requestCompleteExit();
  }, 100);
  timer.unref();
  app.once('before-quit', () => clearInterval(timer));
}

function updateWindowsBackgroundTrayMenu(runtime: BackgroundRuntimeStatus): void {
  const tray = backgroundTray;
  if (tray === null || tray.isDestroyed()) return;
  const copy = buildBackgroundTrayPresentation(backgroundTrayLocale, runtime);
  tray.setToolTip(copy.tooltip);
  const template: MenuItemConstructorOptions[] = [
    { label: copy.status, enabled: false },
    { label: copy.details, enabled: false },
    { type: 'separator' },
    { label: copy.open, enabled: copy.openEnabled, click: activateMainWindow },
    {
      label: copy.closeWindow,
      enabled: runtime.state !== 'exiting' && mainWindow !== null && !mainWindow.isDestroyed(),
      click: () => {
        const win = mainWindow;
        if (win && !win.isDestroyed()) closeMainWindowToBackground(win);
      },
    },
    { type: 'separator' },
    {
      label: copy.quitCompletely,
      enabled: runtime.state !== 'exiting',
      click: () => void requestCompleteExit(),
    },
  ];
  tray.setContextMenu(Menu.buildFromTemplate(template));
}

async function refreshWindowsBackgroundTray(): Promise<void> {
  if (!WINDOWS_BACKGROUND_TRAY_ENABLED || backgroundTray === null || backgroundTrayRefreshing) {
    return;
  }
  backgroundTrayRefreshing = true;
  try {
    backgroundTrayLocale = await resolveCurrentTrayLocale();
    const backgroundStartedAt = completeExitBackgroundStartedAt;
    if (backgroundStartedAt !== undefined) {
      updateWindowsBackgroundTrayMenu({
        state: 'exiting',
        activeWork: 0,
        otherClients: 0,
        canStop: false,
        blockers: [],
        exitElapsedSeconds: Math.floor((Date.now() - backgroundStartedAt) / 1_000),
        exitPhase: completeExitBackgroundPhase,
      });
    } else {
      const runtime = await collectBackgroundRuntimeStatus();
      if (completeExitBackgroundStartedAt !== backgroundStartedAt) return;
      updateWindowsBackgroundTrayMenu(runtime);
    }
  } catch (error) {
    console.warn(
      '[main] Windows background tray refresh failed:',
      error instanceof Error ? error.message : String(error),
    );
  } finally {
    backgroundTrayRefreshing = false;
  }
}

function installWindowsBackgroundTray(): void {
  if (!WINDOWS_BACKGROUND_TRAY_ENABLED || backgroundTray !== null) return;
  if (!WINDOW_ICON_PATH) {
    console.warn('[main] Windows background tray disabled because no runtime icon was resolved.');
    return;
  }
  try {
    const tray = new Tray(WINDOW_ICON_PATH);
    backgroundTray = tray;
    tray.on('click', activateMainWindow);
    tray.on('double-click', activateMainWindow);
    updateWindowsBackgroundTrayMenu({
      state: 'checking',
      activeWork: 0,
      otherClients: 0,
      canStop: false,
      blockers: [],
    });
    void refreshWindowsBackgroundTray();
    backgroundTrayRefreshTimer = setInterval(() => void refreshWindowsBackgroundTray(), 5_000);
    backgroundTrayRefreshTimer.unref?.();
  } catch (error) {
    // Tray support is a Windows convenience, not a startup dependency. If the
    // shell rejects it, last-window close still enters the cross-platform
    // complete-exit gate and must stop Runtime before the process disappears.
    console.warn(
      '[main] Windows background tray unavailable; falling back to normal window exit:',
      error instanceof Error ? error.message : String(error),
    );
    disposeWindowsBackgroundTray();
  }
}

function disposeWindowsBackgroundTray(): void {
  if (backgroundTrayRefreshTimer !== null) {
    clearInterval(backgroundTrayRefreshTimer);
    backgroundTrayRefreshTimer = null;
  }
  if (backgroundTray !== null) {
    try {
      backgroundTray.destroy();
    } catch (error) {
      console.warn(
        '[main] Windows background tray cleanup failed:',
        error instanceof Error ? error.message : String(error),
      );
    }
    backgroundTray = null;
  }
}

// OC-01 单实例锁：HLD §10.3「No-duplicate-session-truth」要求同时只能有一个 Space 进程
// 写 ~/.kodax/，否则 projects.json / sessions 可能被并发写花。
// app.requestSingleInstanceLock() 必须在 app.whenReady() 之前调，第二个进程会立即 quit。
// 第一个进程收到 second-instance 事件 → show + focus 已有窗口（Slack/Discord 同款行为）。
const gotInstanceLock = app.requestSingleInstanceLock();
if (!gotInstanceLock) {
  secondaryInstanceExit = true;
  app.quit();
} else {
  app.on('second-instance', (_event, argv) => {
    activateMainWindow();
    // F021 v0.1.5：Windows / Linux 上"双击 .mcpb"会以 second-instance 启动并把 path
    // 塞进 argv。第一个进程在这里挑出 mcpb-like 路径转给 installer。
    // argv 第 0 项是 electron / Space binary 自身，1 之后才是用户传入。
    const mcpbPath = pickMcpbPathFromArgv(argv);
    if (mcpbPath !== null) {
      void installMcpbFromOsHandoff(mcpbPath);
    }
  });
}

/**
 * F021 v0.1.5：从 process.argv / second-instance argv 里挑 .mcpb / .dxt 后缀路径。
 * 跳过非 path 前缀 (--switch=value)；只接受第一个匹配（再多视为用户误操作）。
 * security review MED-1：必须 abs path —— 相对路径可能被 cwd 攻击者误指（启动 Space 时
 * cwd 由 OS 决定，但 second-instance 触发时 cwd = 调用方进程当前目录，可能不可信）。
 */
function pickMcpbPathFromArgv(argv: readonly string[]): string | null {
  for (const arg of argv.slice(1)) {
    if (arg.startsWith('-')) continue; // 跳过 electron flags
    const lower = arg.toLowerCase();
    if (!lower.endsWith('.mcpb') && !lower.endsWith('.dxt')) continue;
    if (!path.isAbsolute(arg)) continue; // 拒绝 ../evil.mcpb 等相对路径
    return arg;
  }
  return null;
}

/**
 * F021 v0.1.5：macOS 文件关联 / open-file 事件。
 * 必须在 app.whenReady() 之前注册才能接到冷启动 open-file（用户双击 .mcpb 启动 Space 时，
 * open-file 在 ready 前就发出，错过 listener 就丢）。
 * 已运行时再 open-file 一并接到这里。
 */
app.on('open-file', (event, filePath) => {
  event.preventDefault();
  // app 还没 ready 时（冷启动场景）也合法 — installMcpbFromOsHandoff 内部 await Notification
  // 的 Electron API 会在 ready 后才生效；我们用 whenReady() 等一下再调
  void app.whenReady().then(() => installMcpbFromOsHandoff(filePath));
});

const startupPromise = app
  .whenReady()
  .then(async () => {
    // Minimal application menu — App(mac) / Edit / View / Window。
    // Edit 菜单是 macOS 上 Cmd+C/V/X/A/Z 等编辑快捷键能工作的必要条件（经 role 分发），
    // 不构造则这些快捷键在 mac 上完全失效；Win/Linux 由 Chromium 原生处理，菜单仅作展示。
    // File / Help 等没有真实操作，不构造避免视觉噪音。
    //
    // Mac 上 macOS 强制顶部 menubar；Windows / Linux 上呈现为窗口顶部菜单条。
    const isMac = process.platform === 'darwin';
    const menu = Menu.buildFromTemplate([
      // macOS 习惯首项为 app 菜单（含 Quit / Hide 等系统 role）。
      ...(isMac
        ? [
            {
              label: app.name,
              submenu: [
                { role: 'about' as const },
                { type: 'separator' as const },
                { role: 'hide' as const },
                { role: 'hideOthers' as const },
                { role: 'unhide' as const },
                { type: 'separator' as const },
                { role: 'quit' as const },
              ],
            },
          ]
        : []),
      // Edit 菜单：macOS 上 Cmd+C/V/X/A/Z 等标准编辑快捷键是经由这些 role 分发的，
      // 没有 Edit 菜单则这些快捷键在 mac 上完全失效（Win/Linux 由 Chromium 原生处理，不依赖菜单）。
      {
        label: 'Edit',
        submenu: [
          { role: 'undo' as const },
          { role: 'redo' as const },
          { type: 'separator' as const },
          { role: 'cut' as const },
          { role: 'copy' as const },
          { role: 'paste' as const },
          ...(isMac
            ? [
                { role: 'pasteAndMatchStyle' as const },
                { role: 'delete' as const },
                { role: 'selectAll' as const },
              ]
            : [
                { role: 'delete' as const },
                { type: 'separator' as const },
                { role: 'selectAll' as const },
              ]),
        ],
      },
      {
        label: 'View',
        // Zoom 不放菜单 role —— 缩放由 renderer 的 ZoomController 统一接管（Ctrl+滚轮 / Ctrl+± /
        // Ctrl+0 + 持久化系数 + 角标）。菜单 role 与 renderer keydown 会双触发导致一次按两档，故移除。
        submenu: [
          { role: 'reload' },
          { role: 'forceReload' },
          { role: 'toggleDevTools' },
          { type: 'separator' },
          { role: 'togglefullscreen' },
        ],
      },
      {
        label: 'Window',
        submenu: [{ role: 'minimize' }, { role: 'close' }],
      },
    ]);
    Menu.setApplicationMenu(menu);
    installAppProtocolHandler(RENDERER_DIST);
    diagnosticsLogger?.info('renderer', 'app_protocol_installed', undefined, {
      origin: APP_PROTOCOL_ORIGIN,
    });
    applyCsp();
    logGpuFeatureStatus('app-ready');
    // Show the trusted, dependency-free boot surface before Runtime/SDK/store
    // initialization. The React renderer remains behind rendererStartupGate,
    // so it cannot race IPC registration even though the window is visible.
    showOrCreateMainWindow();
    installWindowsBackgroundTray();
    app.on('activate', () => {
      if (startupShutdownCoordinator.isShutdownRequested()) return;
      if (BrowserWindow.getAllWindows().length === 0) {
        showOrCreateMainWindow();
      }
    });
    repairStaleWindowsPortableShortcut();
    const spaceBuiltinSkillsRoot = resolveSpaceBuiltinSkillsPath({
      isPackaged: app.isPackaged,
      mainDirectory: __dirname,
      resourcesPath: process.resourcesPath,
    });
    try {
      const spaceBuiltinSkills = await registerSpaceBuiltinSkills(spaceBuiltinSkillsRoot);
      diagnosticsLogger?.info('skills', 'space_builtins_registered', undefined, {
        root: spaceBuiltinSkills.root,
        skillNames: spaceBuiltinSkills.skillNames,
      });
    } catch (err) {
      // A damaged optional resource must not brick the whole app. Release smoke
      // catches this before shipping; an installed copy degrades to SDK/user skills.
      diagnosticsLogger?.warn('skills', 'space_builtins_registration_failed', undefined, {
        root: spaceBuiltinSkillsRoot,
        error: err,
      });
      console.warn(
        '[main] Space builtin skills are unavailable:',
        err instanceof Error ? err.message : err,
      );
    }
    if (startupShutdownCoordinator.isShutdownRequested()) return;
    // Shell PATH must be ready before the shared Coder daemon starts. On Windows
    // version managers commonly initialize only from a PowerShell/bash profile;
    // starting Runtime in parallel would permanently give the daemon the stale
    // Explorer PATH even if hydration completed a few milliseconds later.
    const startupSettings = await settingsStore.load();
    if (startupShutdownCoordinator.isShutdownRequested()) return;
    runtimeHostAdapter.configureStartupMode(
      startupSettings.coderRuntimeMode === 'embedded' ? 'legacy' : 'runtime',
    );
    await hydrateShellEnvOnce({
      preference: startupSettings.terminalShell,
      cwd: startupSettings.defaultWorkspace,
    });
    if (startupShutdownCoordinator.isShutdownRequested()) return;

    let startupBoundary: Awaited<ReturnType<typeof runRuntimeStartupBoundary>>;
    try {
      startupBoundary = await runRuntimeStartupBoundary({
        recoveryRequested: runtimeExitRecoveryRequested,
        scanPendingExit:
          runtimeExitRecoveryRequested || startupSettings.coderRuntimeMode !== 'embedded',
        settle: () => runtimeHostAdapter.resumePendingRuntimeExitSettlement(),
        reconcileOwnerPolicy: () =>
          runtimeHostAdapter
            .reconcileStartupOwnerPolicy()
            .then(() => true)
            .catch((err) => {
              diagnosticsLogger?.warn(
                'runtime',
                'owner_policy_reconciliation_failed',
                undefined,
                err,
              );
              console.warn(
                '[main] Shared Coder Runtime owner policy could not be reconciled; Coder is unavailable:',
                err instanceof Error ? err.message : err,
              );
              return false;
            }),
        prepareStartup: async () => {
          await Promise.all([
            probeKodaxSdk(),
            probeSkillRegistry(),
            // F064: 在窗口/首跑前 await 加载 Workflow Host Policy——real-session 同步 get() 读缓存，
            // 否则首个 session 可能撞上默认值而非用户持久化的策略（~100µs 文件读，零额外延迟）。
            workflowPolicyStore.load().catch((err) => {
              console.warn(
                '[main] workflow policy load failed:',
                err instanceof Error ? err.message : err,
              );
            }),
          ]);
        },
        initializeRuntime: (runtimeOwnerPolicyReady) => {
          if (startupShutdownCoordinator.isShutdownRequested()) return;
          const runtimeInitializationReady = runtimeOwnerPolicyReady
            ? startBackgroundRuntimeInitialization({
                // initialize() changes the adapter to its explicit initializing state
                // synchronously. Later Coder calls join the same initializePromise.
                initialize: () => runtimeHostAdapter.initialize(app.getVersion()),
                onReady: () => {
                  // POSIX SDK hydration can add provider secrets while Runtime attaches.
                  refreshDiagnosticRedactionOptions();
                  diagnosticsLogger?.info('runtime', 'host_initialized');
                },
                onFailure: (err) => {
                  diagnosticsLogger?.warn('runtime', 'host_initialization_failed', undefined, err);
                  console.warn(
                    '[main] Shared Coder Runtime initialization failed; Coder is unavailable:',
                    err instanceof Error ? err.message : err,
                  );
                },
              })
            : Promise.resolve(false);
          void startupShutdownCoordinator.trackStartupTask(runtimeInitializationReady);
        },
      });
    } catch (error) {
      if (!runtimeExitRecoveryRequested) throw error;
      const message = error instanceof Error ? error.message : String(error);
      restoreVisibleExitControlSurface();
      setVisibleBootStatus(
        'Runtime exit recovery could not be verified. Coder startup remains blocked.',
        'close-only',
      );
      await dialog.showMessageBox({
        type: 'error',
        title: 'Runtime exit recovery failed',
        message: 'Space did not start a competing Coder Runtime',
        detail: message,
        buttons: ['OK'],
        defaultId: 0,
        noLink: true,
      });
      return;
    }
    runtimeExitRecoverySettlement = startupBoundary.settlement;
    if (startupBoundary.action === 'exit') {
      console.info(
        `[main] Runtime exit ${startupBoundary.settlement.status}; completing the original quit request`,
      );
      daemonStopConfirmedBeforeQuit = true;
      stopDaemonOnQuit = true;
      app.quit();
      return;
    }
    if (startupBoundary.action === 'block') {
      const locale = await resolveCurrentTrayLocale();
      const zh = locale === 'zh-CN';
      restoreVisibleExitControlSurface();
      setVisibleBootStatus(
        zh
          ? 'Runtime 退出恢复仍被安全边界阻止。'
          : 'Runtime exit recovery remains blocked by its safety boundary.',
        'close-only',
      );
      await dialog.showMessageBox({
        type: 'error',
        title: zh ? 'Runtime 退出恢复被阻止' : 'Runtime exit recovery blocked',
        message: zh
          ? 'Space 未启动新的 Coder Runtime'
          : 'Space did not start a competing Coder Runtime',
        detail: startupBoundary.settlement.message,
        buttons: [zh ? '确定' : 'OK'],
        defaultId: 0,
        noLink: true,
      });
      return;
    }
    if (startupShutdownCoordinator.isShutdownRequested()) return;

    // POSIX SDK hydration may add provider secrets after diagnostics was initialized.
    refreshDiagnosticRedactionOptions();
    // v0.1.10 chore: best-effort 清理早期残留的 ~/.kodax_space 孤儿目录。
    // fire-and-forget,never throws,不阻塞 UI 启动;详见 cleanup-orphan-kodax-space.ts。
    void cleanupOrphanKodaxSpaceDirWithLog();
    const mcpbMigration = await migrateLegacyMcpbStorage();
    if (startupShutdownCoordinator.isShutdownRequested()) return;
    if (mcpbMigration.kind === 'migrated') {
      console.log(
        `[startup] Migrated ${mcpbMigration.migrated} MCP bundle(s) to ~/.kodax/mcpb (${mcpbMigration.registered} registered).`,
      );
    } else if (mcpbMigration.kind === 'error') {
      console.warn(`[startup] MCP bundle migration skipped: ${mcpbMigration.message}`);
    }

    // IPC handlers must be registered before rendererStartupGate is released;
    // the already-visible trusted boot page does not invoke application IPC.
    registerVersionChannel();
    registerSandboxChannels();
    // F121 Part 1: explicit SDK-pending snapshot handlers. They report a
    // connecting projection until the published daemon adapter replaces it.
    registerRuntimeProjectionChannels();
    registerLearningChannels();
    registerDiagnosticsChannels({
      getMainWindow: () => mainWindow,
      spaceVersion: SPACE_VERSION,
    });
    registerSpaceControlChannels();
    registerRepointelChannels();
    registerHandoffChannels();
    const coderRuntimeModeSwitchCoordinator = new CoderRuntimeModeSwitchCoordinator({
      currentHost: () => runtimeHostAdapter.selectedHost(),
      hasActiveSpaceRun: async () => (await collectActiveSpaceExitBlockers()).length > 0,
      prepareEmbeddedRestart: () => runtimeHostAdapter.prepareEmbeddedRestart(),
      prepareDaemonRestart: () => runtimeHostAdapter.prepareDaemonRestart(),
      restoreDaemonOwner: () => runtimeHostAdapter.restoreDaemonOwner(),
      persist: (mode) => settingsStore.setCoderRuntimeMode(mode),
      scheduleRestart: scheduleCoderRuntimeModeRestart,
    });
    beginCoderShutdown = () =>
      coderRuntimeModeSwitchCoordinator.beginShutdown({ drainTimeoutMs: 10_000 });
    registerSessionChannels({
      beginCoderAdmission: () => coderRuntimeModeSwitchCoordinator.beginCoderAdmission(),
    });
    registerProjectChannels();
    registerPermissionChannels();
    registerAskUserChannels();
    registerBuiltinSlashCommands();
    registerSlashChannels({
      beginCoderAdmission: () => coderRuntimeModeSwitchCoordinator.beginCoderAdmission(),
    });
    registerSkillChannels();
    registerAgentChannels({
      beginCoderAdmission: () => coderRuntimeModeSwitchCoordinator.beginCoderAdmission(),
    });
    registerMcpChannels({
      beginCoderAdmission: () => coderRuntimeModeSwitchCoordinator.beginCoderAdmission(),
    });
    registerKodaxChannels();
    registerAdminPolicyAuditChannels();
    registerQueueChannels();
    // v0.1.6 cleanup: 预热 SDK MCP module 让首次 mcp.discover 不命中空 fallback
    // （DEFAULT_IMPL 首次同步调返回 {}，prewarm 异步触发后续调用走真 SDK）
    void prewarmSdkMcpStore().catch((err) =>
      console.warn('[main] SDK MCP prewarm failed:', err instanceof Error ? err.message : err),
    );
    // v0.1.6 cleanup: 同上，预热 root SDK module + 把 ~/.kodax/config.json 的 customProviders
    // 注册进 SDK runtime LLM registry。完成后 `/provider <name>` 可切到 KodaX-CLI 配的
    // 自定义 provider（如用户的 newapi-anthropic / openrouter-xxx）。失败不阻塞启动。
    try {
      await prewarmKodaxUserConfig();
      if (startupShutdownCoordinator.isShutdownRequested()) return;
      await providerConfigStore.load();
      if (startupShutdownCoordinator.isShutdownRequested()) return;
      const customProviders = providerConfigStore.listCustom();
      await registerKodaxCustomProviders(customProviders);
      if (startupShutdownCoordinator.isShutdownRequested()) return;
      // Reconcile the latest store state after every authoritative Runtime
      // attachment, including internal reconnects. Sharing the UI mutation
      // queue prevents an old startup snapshot from overwriting a newer
      // add/update/remove while a cold daemon is still connecting.
      runtimeHostAdapter.subscribeRuntimeReady(() => {
        const synchronization = customProviderMutationQueue.run(async () => {
          if (startupShutdownCoordinator.isShutdownRequested()) return;
          await providerConfigStore.load();
          if (startupShutdownCoordinator.isShutdownRequested()) return;
          await syncSpaceCustomProvidersToRuntime(providerConfigStore.listCustom());
        });
        void startupShutdownCoordinator.trackStartupTask(
          synchronization.catch((err) => {
            console.warn(
              '[main] Runtime custom provider synchronization failed:',
              err instanceof Error ? err.message : err,
            );
          }),
        );
      });
    } catch (err) {
      console.warn(
        '[main] Custom provider bootstrap failed:',
        err instanceof Error ? err.message : err,
      );
    }
    registerProviderChannels();
    registerFilesChannels();
    registerPartnerSourceChannels();
    registerPartnerKbChannels();
    registerPartnerDeliveryChannels();
    registerPartnerCheckpointChannels();
    registerPartnerFileProposalChannels();
    registerTitlebarChannels();
    registerWindowChannels(() => (mainWindow && !mainWindow.isDestroyed() ? mainWindow : null));
    registerSettingsChannels({
      switchCoderRuntimeMode: (target) => coderRuntimeModeSwitchCoordinator.switchMode(target),
      beginCoderAdmission: () => coderRuntimeModeSwitchCoordinator.beginCoderAdmission(),
    });
    registerLicenseChannels();
    // F020 native OS notification — renderer 调 notification.show 弹 OS 原生通知
    registerNotificationChannels();
    setNotificationWindowGetter(() =>
      mainWindow && !mainWindow.isDestroyed() ? mainWindow : null,
    );
    // F022 auto-updater — packaged 模式下走 GitHub Releases feed；dev 模式 idle
    // initAutoUpdater 内部判断 app.isPackaged + 异步触发首次 check，不阻塞窗口创建
    registerUpdaterChannels();
    void initAutoUpdater().catch((err) =>
      console.warn(
        '[main] updater initialization failed:',
        err instanceof Error ? err.message : err,
      ),
    );
    // F021 .mcpb / .dxt bundle install — IPC handlers，UI 点 "Install extension..." 走
    registerMcpbChannels();
    // F011 内置终端 (xterm.js + node-pty) — terminal.create/write/resize/kill + output/exit push
    registerTerminalChannels();
    // OC-31 v0.1.9 clipboard image paste — renderer 把粘贴板图片落到 app temp dir
    registerClipboardChannels({
      sessionExists: (sessionId) => kodaxHost.hasSession(sessionId),
    });
    // Shell exits: reveal files, enter allowlisted directories, and open http(s) URLs.
    // 让 renderer 里到处的文件路径 / URL 死文本变成可点击（用户反馈）。
    registerShellChannels();
    // Artifact 数据层（F057，LC-free）：create/list/read/delete/export + openWindow。
    // LC sandbox（路径 D）的 loopback server 已移除，待 LiveCanvas 稳定后作为独立 feature 重接。
    registerArtifactChannels();
    registerMemoryChannels();
    // F060 Workflow Harness 支持：list/get IPC + 订阅 SDK 进程事件流转发到 renderer（workflow.event）。
    // init 是 best-effort（lazy-load SDK run manager + 加载持久化归属）；失败只降级为"无实时工作流面"。
    registerWorkflowChannels({
      beginCoderAdmission: () => coderRuntimeModeSwitchCoordinator.beginCoderAdmission(),
    });
    void startupShutdownCoordinator.trackStartupTask(
      workflowController
        .init()
        .then(() => diagnosticsLogger?.info('workflow', 'controller_initialized'))
        .catch((err) => {
          diagnosticsLogger?.warn('workflow', 'controller_initialization_failed', undefined, err);
          console.warn(
            '[main] workflow controller init failed:',
            err instanceof Error ? err.message : err,
          );
        }),
    );
    // F064 Workflow Host Policy 已在上面启动期 Promise.all 里 await 加载（早于窗口/首跑）。
    // F059c L3：artifact.openWindow → 独立最大化窗口（复用同一 renderer + preload，走 #artifact hash）。
    registerArtifactWindowChannel({
      preloadPath: PRELOAD_PATH,
      devServerUrl: VITE_DEV_SERVER_URL,
      iconPath: WINDOW_ICON_PATH,
      taskbarAppDetails: WINDOWS_TASKBAR_IDENTITY?.appDetails,
    });
    // F021 v0.1.5 冷启动 file association：用户双击 .mcpb 启动 Space 时，path 在 process.argv 里。
    // mainWindow 还没创建，但 installMcpbFromOsHandoff 内部会拉 BrowserWindow.getAllWindows()[0]
    // ——等 createMainWindow() 跑完才有 window。fire-and-forget，让 window 先建好。
    const initialMcpb = pickMcpbPathFromArgv(process.argv);
    if (initialMcpb !== null) {
      void installMcpbFromOsHandoff(initialMcpb);
    }
    // 启动期保证默认 workspace 目录存在 (~/kodax_workspace 或用户改过的路径)。
    // 不阻塞窗口创建——mkdir 失败 (磁盘满 / 权限) 不致命，UI 仍能用 + 用户可走 Open folder.
    void settingsStore.ensureWorkspaceExists();
    // KodaX SDK MessageQueue (process-global) 订阅 — 实时把 enqueued/dequeued/cleared 推 renderer.
    // 失败 (SDK chunk import 错) 不阻塞启动,renderer 仍能调 kodax.queueGet 轮询。
    void startupShutdownCoordinator
      .trackStartupTask(
        startQueueWatch().then((unsubscribe) => {
          queueWatchShutdown?.();
          queueWatchShutdown = unsubscribe;
        }),
      )
      .catch((err) => {
        console.warn('[main] startQueueWatch failed:', err instanceof Error ? err.message : err);
      });
    // FEATURE_083 FileTracingProcessor (opt-in): 设 SPACE_TRACE_DIR=/some/abs/path 后启动期注册,
    // SDK 把 span/trace lifecycle JSONL 写入该目录。默认不写 (避免文件落盘而用户不知情)。
    void startupShutdownCoordinator.trackStartupTask(startFileTracingIfEnabled()).catch((err) => {
      console.warn('[main] file tracing init failed:', err instanceof Error ? err.message : err);
    });
    // 预加载 always-allow 规则 — broker.request 走 matches() 是同步路径，必须事先 load。
    // 失败不阻塞启动（registry.load 内部 catch 后 cached 落为 []）。
    void permissionRegistry.load();
    // FEATURE_004 启动期把 keychain 里的 key 注入 process.env，
    // 让 KodaX SDK（getProvider）从 env 读到。失败不阻塞启动——provider 配置 UI 仍能用
    // KX-I-01：injectAllKeysToEnv 后 process.env 是最新状态，autoActivate 检测 shell-set
    // 的 env key 并在 defaultProviderId 为 null 时自动选首个匹配的 built-in 为默认。
    void providerConfigStore
      .load()
      .then(() => injectAllKeysToEnv())
      .then(() => autoActivateProvidersFromEnv())
      .then(() => injectAllKeysToEnv())
      .catch((err) => {
        console.error(
          '[main] inject keychain keys / auto-activate failed:',
          err instanceof Error ? err.message : err,
        );
      });
    if (startupShutdownCoordinator.isShutdownRequested()) return;
    rendererStartupGate.release();
    installTestCompleteExitTrigger();
    void showRuntimeExitRecoveryNoticeIfNeeded().catch((error) => {
      console.warn(
        '[main] could not show the Runtime exit recovery notice:',
        error instanceof Error ? error.message : String(error),
      );
    });
  })
  .catch((err) => {
    // 启动链兜底：whenReady 内任一步抛错（如 SDK chunk 缺运行时文件、动态 import 失败）原本会变成
    // unhandledRejection，且 createMainWindow() 不再执行 → 窗口永不出现，而 Windows GUI 子系统下
    // 控制台又收不到日志，用户只看到"app 打不开 / session 都没了"。这里捕获后：① 写日志
    // ② 弹原生错误框让失败可见 ③ 若尚无窗口则补建一个，让 app 至少起来（SDK 依赖型功能再各自经 IPC
    // 优雅报错，而非整个 app 静默消失）。
    // console 写完整信息（含 stack，供开发者在日志里排查）；给用户的 dialog 文案经
    // sanitizeForDialog 抹掉绝对路径（Win 下含用户名）并截断，避免共享屏幕/录屏时泄漏路径或
    // 错误对象里夹带的敏感串。
    console.error('[main] fatal during whenReady startup:', sanitizeError(err));
    if (startupShutdownCoordinator.isShutdownRequested()) return;
    try {
      dialog.showErrorBox(
        'KodaX Space 启动出错',
        `主进程启动时发生错误（完整信息见 ~/.kodax/space/logs/）：\n\n${sanitizeForDialog(err)}`,
      );
    } catch {
      /* dialog 不可用时也别再抛 */
    }
    if (BrowserWindow.getAllWindows().length === 0) {
      try {
        showOrCreateMainWindow();
        installWindowsBackgroundTray();
      } catch (e) {
        console.error('[main] createMainWindow() in startup catch also failed:', sanitizeError(e));
      }
    }
    // The React renderer assumes that every preload IPC channel is registered.
    // Keep the dependency-free trusted surface visible on fatal bootstrap
    // errors rather than releasing an incomplete renderer that will fail again.
    fatalStartupStatus = 'Startup could not finish. Restart KodaX Space to try again.';
    setVisibleBootStatus(fatalStartupStatus, 'app-restart');
  });
startupShutdownCoordinator.setStartupPromise(startupPromise);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin' && !hasUsableWindowsBackgroundTray()) {
    app.quit();
  }
});

// FileTracingProcessor 启用入口 — opt-in via env SPACE_TRACE_DIR (绝对路径)。
// 设置后 SDK 把所有 span lifecycle 写到该目录的 JSONL。诊断诡异 bug 时启用。
let _fileTracingShutdown: (() => Promise<void>) | null = null;
async function startFileTracingIfEnabled(): Promise<void> {
  const traceDir = process.env.SPACE_TRACE_DIR;
  if (!traceDir || traceDir.length === 0) return;
  // 安全: 必须 abs path (避免相对路径在 unpacked Electron app 路径误指向 app.asar)
  if (!path.isAbsolute(traceDir)) {
    console.warn(`[main] SPACE_TRACE_DIR must be absolute (got: ${traceDir}); tracing disabled`);
    return;
  }
  try {
    const agentMod = await import('@kodax-ai/kodax/agent');
    const processor = new agentMod.FileTracingProcessor({ traceDir });
    agentMod.addTracingProcessor(processor);
    _fileTracingShutdown = () => processor.shutdown();
    console.info(`[main] FileTracingProcessor enabled → ${traceDir}`);
  } catch (err) {
    console.warn(
      '[main] FileTracingProcessor failed to load:',
      err instanceof Error ? err.message : err,
    );
  }
}

// 关闭前清空所有活跃 session——Mock 阶段只是 abort 内存里的 AbortController，
// Real adapter 接入后会负责 kill 工具子进程、关 FileSessionStorage 句柄、断 HTTP 流。
// 不放在 will-quit 是因为那时 event loop 即将停，async dispose 容易跑不完。
//
// review H3-code（2026-05-17）：先 cancelAll pending 权限请求——disposeAll 会
// 逐 session cancelSession，但循环被打断时（before-quit 第二次触发等）仍有 pending
// 可能残留。先一把扫光，幂等
//
// 进程残留修复（2026-06-16）：MCP stdio server / sandbox server 这些**会 spawn OS 子进程**
// 的子系统，之前是 fire-and-forget（`void dispose()`）。退出时序里没有 in-flight session
// 时 before-quit 直接 return → app.quit() 立刻拆主进程，子进程 kill 还没跑完 → MCP server
// 等 node 子进程变孤儿残留；有 in-flight 时 app.exit(0) 也只等了 kodaxHost.disposeAll()。
// 现在统一拦一次，把所有会杀子进程的异步清理一起 await 完再硬退；带看门狗兜底，避免任一
// 清理卡死导致无窗口僵尸主进程（dev 链路下还会连累 vite/esbuild 跟着挂）。
let _quitting = false;
app.on('before-quit', (event) => {
  // Every user/OS quit path (macOS Cmd+Q, Linux last-window close, Windows
  // complete exit) first passes the same Runtime safety gate. A user-confirmed
  // forced exit and internal mode restarts deliberately bypass re-admission.
  if (
    shouldRequestCompleteExitOnBeforeQuit({
      cleanupStarted: _quitting,
      daemonStopCommitted: stopDaemonOnQuit,
      forcedExitCommitted,
      sharedRuntimeExitCommitted,
      runtimeModeRestartScheduled: coderRuntimeRestartScheduled || startupRecoveryRestartScheduled,
      secondaryInstanceExit: secondaryInstanceExit || testExitBypass,
    })
  ) {
    event.preventDefault();
    if (!hasUsableWindowsBackgroundTray()) activateMainWindow();
    void requestCompleteExit();
    return;
  }

  // 同步 + 幂等的清理先做（每次 before-quit 触发都安全重入）。
  // 第二次 before-quit（理论上不会——app.exit 跳过 before-quit；防 electron quirk）直接放行。
  if (_quitting) return;
  _quitting = true;
  startupShutdownCoordinator.requestShutdown();
  // 异步清理需要 await 完才能让进程死，否则子进程 kill 与进程退出赛跑 → 孤儿残留。
  event.preventDefault();
  // The process may remain alive for bounded Runtime/child-process cleanup.
  // A usable tray owns that background interval. Without one, safe complete
  // exit keeps the progress window reachable until final process disposal.
  hideExitWindowsForBackgroundShutdown();

  // Run synchronous, idempotent cleanup after the background handoff (or while
  // the no-tray progress surface remains visible).
  permissionBroker.cancelAll('shutdown');
  askUserBroker.cancelAll('shutdown');
  spaceControlRendererBroker.cancelAll('shutdown');
  try {
    getPtyHost().disposeAll();
  } catch (err) {
    console.warn('[main] ptyHost dispose:', err instanceof Error ? err.message : err);
  }

  const disposalPromise = startupShutdownCoordinator.disposeAfterStartup(() => {
    const tracingShutdown = _fileTracingShutdown;
    _fileTracingShutdown = null;
    const stopQueueWatch = queueWatchShutdown;
    queueWatchShutdown = null;
    // Startup must settle before any close() call: otherwise an early user quit
    // can race Runtime initialize() and leave a newly spawned resource behind.
    const disposals: Promise<unknown>[] = [
      Promise.resolve()
        .then(() => stopQueueWatch?.())
        .catch((err) =>
          console.warn('[main] queue watch shutdown:', err instanceof Error ? err.message : err),
        ),
      Promise.resolve()
        .then(() => workflowController.dispose())
        .catch((err) =>
          console.warn('[main] workflow shutdown:', err instanceof Error ? err.message : err),
        ),
      disposeMcpManager().catch((err) =>
        console.warn('[main] mcp shutdown:', err instanceof Error ? err.message : err),
      ),
      kodaxHost
        // Runtime cancellation was already filtered by principal/run identity
        // in the force-close admission step. Session disposal must only detach;
        // a Session-wide abort could stop another client's same-Session Run.
        .disposeAll({ detachRuntimeRuns: true })
        .catch((err) =>
          console.error('[main] disposeAll on quit:', err instanceof Error ? err.message : err),
        ),
      learningEventBridge
        .stop()
        .catch((err) =>
          console.warn(
            '[main] learning stream shutdown:',
            err instanceof Error ? err.message : err,
          ),
        ),
      runtimeHostAdapter
        .close()
        .catch((err) =>
          console.warn('[main] Runtime host shutdown:', err instanceof Error ? err.message : err),
        ),
      externalAgentGateway
        .dispose()
        .catch((err) =>
          console.warn('[main] external-agent shutdown:', err instanceof Error ? err.message : err),
        ),
    ];
    if (tracingShutdown !== null) {
      disposals.push(
        tracingShutdown().catch((err) =>
          console.warn('[main] tracing shutdown:', err instanceof Error ? err.message : err),
        ),
      );
    }
    return disposals;
  });

  // Safe complete exit gets enough time for local cleanup plus the daemon's
  // own safety gate and recovers a visible Space if that confirmation stalls.
  // User-confirmed force close remains terminal and uses the short watchdog.
  let mayExitProcess = true;
  const watchdogMs = forcedExitCommitted ? 2_500 : stopDaemonOnQuit ? 25_000 : 2_500;
  const watchdog = setTimeout(() => {
    console.warn(`[main] shutdown disposals exceeded ${watchdogMs}ms`);
    if (
      !shouldRecoverRuntimeAfterShutdownTimeout({
        forcedExitCommitted,
        daemonStopCommitted: stopDaemonOnQuit,
      })
    ) {
      hideExitControlSurfaceForBackgroundShutdown();
      app.exit(0);
      return;
    }
    if (scheduleRuntimeExitRecovery('shutdown timed out before daemon stop was confirmed')) {
      hideExitControlSurfaceForBackgroundShutdown();
      app.exit(0);
      return;
    }
    mayExitProcess = false;
    keepSpaceVisibleAfterRecoveryRelaunchFailure();
  }, watchdogMs);
  watchdog.unref?.();

  void disposalPromise
    .then(() => {
      if (stopDaemonOnQuit && !daemonStopConfirmedBeforeQuit) {
        console.warn(
          '[main] complete exit reached cleanup without prior daemon-stop confirmation.',
        );
        mayExitProcess = scheduleRuntimeExitRecovery(
          'daemon stop was not confirmed before local shutdown',
        );
      }
    })
    .then(() => flushDiagnostics())
    .finally(() => {
      clearTimeout(watchdog);
      if (mayExitProcess) {
        hideExitControlSurfaceForBackgroundShutdown();
        app.exit(0);
        return;
      }
      keepSpaceVisibleAfterRecoveryRelaunchFailure();
    });
});

// 兜底 — 未捕获异常不静默，但**不打印原对象**：
// Error 对象的字段（`.cause` / `.config` / 自定义属性）可能携带 API key、prompt、用户文件内容等。
// 只取 message + stack（堆栈是开发者已知敏感信息但远比整对象低风险）。
function sanitizeError(input: unknown): { name: string; message: string; stack?: string } {
  if (input instanceof Error) {
    return { name: input.name, message: input.message, stack: input.stack };
  }
  return { name: typeof input, message: String(input) };
}
// 给用户 dialog 看的文案：只取 message（不含完整 stack），抹掉绝对路径（Win `C:\Users\<name>\…`、
// UNC `\\…`、POSIX `/a/b/c`），并截断到 500 字。完整 stack 仍写 console（开发者排查）。
function sanitizeForDialog(input: unknown): string {
  const raw = input instanceof Error ? input.message : String(input);
  const redacted = raw
    .replace(/[A-Za-z]:\\[^\s'"]+/g, '<path>')
    .replace(/\\\\[^\s'"]+/g, '<path>')
    // POSIX 绝对路径：至少含一个分隔符（覆盖 /Users/<name>/… 这类含用户名的家目录路径，
    // 单段如 /coding 不算敏感、不匹配）。比旧 [\w.-] 段宽，能吃到含空格/括号的路径剩余部分。
    .replace(/\/[\w.-]+\/[^\s'"]*/g, '<path>')
    .trim();
  const capped = redacted.length > 500 ? `${redacted.slice(0, 500)}…` : redacted;
  return capped || 'unknown startup error';
}
process.on('uncaughtException', (err) => {
  console.error('[main] uncaughtException:', sanitizeError(err));
});
process.on('unhandledRejection', (reason) => {
  console.error('[main] unhandledRejection:', sanitizeError(reason));
});
