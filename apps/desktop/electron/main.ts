// Electron main process entry — FEATURE_001
//
// 架构判断（详见 docs/HLD.md §1.2 + docs/ADR/ADR-003）：
// - main 拥有 OS event loop、KodaX runtime（后续 FEATURE_003 接入）
// - renderer 仅 UI，不直接 import LLM/KodaX runtime
// - 安全基线：contextIsolation / nodeIntegration=false / sandbox / CSP

import {
  app,
  BrowserWindow,
  Menu,
  shell,
  session,
  dialog,
  ipcMain,
  type IpcMainEvent,
} from 'electron';
import path from 'node:path';
import { mkdirSync } from 'node:fs';
import { registerVersionChannel } from './ipc/version.js';
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
import { registerQueueChannels, startQueueWatch } from './ipc/queue.js';
import { registerAdminPolicyAuditChannels } from './ipc/admin.js';
import { prewarmKodaxUserConfig, registerKodaxCustomProviders } from './kodax/user-config.js';
import { probeKodaxSdk } from './kodax/kodax-sdk-probe.js';
import { probeSkillRegistry } from './skill/registry.js';
import { hydrateShellEnvOnce } from './kodax/shell-env-hydrate.js';
import { getKodaxDir, getScopedUserDataDir, applySdkHomeEnv } from './kodax/data-paths.js';
import { registerProviderChannels, injectAllKeysToEnv } from './ipc/provider.js';
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
import { workflowController } from './kodax/workflow-controller.js';
import { workflowPolicyStore } from './kodax/workflow-policy.js';
import { registerArtifactWindowChannel } from './artifact/artifact-window.js';
import { installNavigationGuards } from './window/navigation-guards.js';
import { installWindowActivityPublisher } from './window/activity.js';
import { installTopmostGuard } from './window/topmost-guard.js';
import {
  BOOT_SPLASH_URL_PREFIX,
  bootStatusScript,
  createBootSplashUrl,
  describeUrlForLog,
} from './window/boot-splash.js';
import { cleanupOrphanKodaxSpaceDirWithLog } from './kodax/cleanup-orphan-kodax-space.js';
import { migrateLegacyMcpbStorage } from './mcpb/registry.js';
import { getPtyHost } from './terminal/ptyHost.js';
import { settingsStore } from './settings/store.js';
import { setRendererTarget } from './ipc/push.js';
import { kodaxHost } from './kodax/host.js';
import { externalAgentGateway } from './kodax/external-agent-gateway.js';
import { runtimeHostAdapter } from './kodax/runtime-host-adapter.js';
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
import { APP_PROTOCOL_INDEX_URL, APP_PROTOCOL_ORIGIN } from './window/app-protocol-policy.js';

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

// THEME_BOOTSTRAP_INLINE_HASH 抽到 csp-config.ts 让单测无 electron 依赖也能 import
import { THEME_BOOTSTRAP_INLINE_HASH } from './csp-config.js';

let mainWindow: BrowserWindow | null = null;
setRendererTarget(() => (mainWindow && !mainWindow.isDestroyed() ? mainWindow.webContents : null));

function applyCsp(): void {
  // CSP：renderer 只允许 self；dev 时放行 vite HMR（仅 script-src/connect-src）
  // 注：style-src 'unsafe-inline' 保留——React/shadcn/Radix 的内联 style props 需要；
  // 风险面在 Electron 本地环境足够小（无第三方 CSS 注入向量）。
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    // F009 CSP 扩项：
    //   - worker-src 'self' blob:  → Monaco editor 用 Web Worker（dev 走 module worker；prod 走 blob）
    //   - script-src 加 blob:       → 同上，Monaco esm worker 通过 blob URL 起
    //   - script-src 加 hash       → apps/desktop/index.html 的 theme-bootstrap inline 脚本（v0.1.7 修：
    //     dist build 模式下没有 'unsafe-inline'，inline 脚本被 CSP 拦截 → 首帧 light flash。
    //     hash 跟 inline 脚本字符 1:1 锁定；inline 改了 hash 也要改，否则 csp-hash test 会拦下。
    //     hash 与单测同源派生：apps/desktop/electron/test/csp-inline-hash.test.ts 启动 read +
    //     compute 一遍 assert 匹配，未来 inline 漂移 CI 立刻报错）
    // frame-src 收紧为 'self'：LC sandbox 的 loopback iframe（路径 D，需 http://127.0.0.1:*）
    // 已随交互层移除（见 F067）。现存唯一 iframe 是 HtmlArtifact 的 srcdoc（sandbox=""，
    // 'self' 即可）；artifact-window(F059c L3) 是独立 BrowserWindow 不经 iframe。LC 重接时
    // 在此重新放行 loopback origin（届时配合 F055 app:// 做 frame-ancestors pinning）。
    const csp = isDev
      ? [
          "default-src 'self'",
          "script-src 'self' 'unsafe-inline' 'unsafe-eval' blob:",
          "worker-src 'self' blob:",
          "style-src 'self' 'unsafe-inline'",
          "img-src 'self' data: blob: https:",
          "media-src 'self' data: blob:",
          "font-src 'self' data:",
          "frame-src 'self'",
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
          "frame-src 'self'",
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

function createMainWindow(): void {
  // 自定义 titlebar — 对齐 VSCode / Discord / Slack 现代 chrome：
  //   - titleBarStyle: 'hidden' 把系统标题栏隐掉
  //   - Windows: renderer 自绘 VS Code 风格 close/min/max（hover/press 更清晰）
  //   - macOS: 'hiddenInset' 自动 (Electron 自动 fallback) 让 traffic lights 留在左上角
  //
  // renderer 顶部 row 用 CSS `-webkit-app-region: drag` 当拖动条；按钮 'no-drag'。
  // Menu.setApplicationMenu(null) 在 app.whenReady 里彻底禁掉默认 File/Edit/View 菜单。
  const isMac = process.platform === 'darwin';
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    title: 'KodaX Space',
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
      // Some Windows/GPU combinations throttle hidden windows enough that
      // ready-to-show never fires. Keep boot navigation moving while show:false;
      // revealWindow restores Chromium's default background throttling.
      backgroundThrottling: false,
    },
  });
  mainWindow = win;
  installWindowActivityPublisher(win);
  const uninstallTopmostGuard = installTopmostGuard(win, { label: 'main window' });
  const invalidateMainWindow = (): void => {
    if (!win.isDestroyed()) win.webContents.invalidate();
  };
  win.on('show', invalidateMainWindow);
  win.on('focus', invalidateMainWindow);
  win.on('restore', invalidateMainWindow);

  // 外链白名单 + in-page 导航锁定 —— 与 artifact 独立窗口共用同一套守卫（F059c），
  // 避免两处窗口的安全策略漂移。理由：renderer 终会渲染 LLM/MCP 产生的内容，必须
  // 只放行应用自身资源（dev: Vite origin / prod: 精确 app://space origin），https 外链走系统
  // 浏览器，其余一律 deny（防 LLM 注入 file:///etc/passwd 等任意路径）。
  installNavigationGuards(win.webContents, {
    devServerUrl: VITE_DEV_SERVER_URL,
    allowedAppOrigin: APP_PROTOCOL_ORIGIN,
    allowedDataUrls: [createBootSplashUrl()],
    openExternal: (url) => void shell.openExternal(url),
  });

  let windowShown = false;
  const revealWindow = (source: string): void => {
    if (windowShown || win.isDestroyed()) return;
    windowShown = true;
    win.show();
    win.webContents.setBackgroundThrottling(true);
    win.webContents.invalidate();
    console.info(`[main] main window shown via ${source}`);
  };

  let appLoadAttempt = 0;
  let appLoadCommitted = false;
  let appLoadWatchdog: ReturnType<typeof setTimeout> | null = null;
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

  const setBootStatus = (message: string): void => {
    if (!win.webContents.getURL().startsWith(BOOT_SPLASH_URL_PREFIX)) return;
    void win.webContents.executeJavaScript(bootStatusScript(message), true).catch(() => undefined);
  };

  const markAppLoadCommitted = (source: string): void => {
    if (win.isDestroyed()) return;
    const url = win.webContents.getURL();
    if (url.startsWith(BOOT_SPLASH_URL_PREFIX)) return;
    if (appLoadCommitted) return;
    appLoadCommitted = true;
    appLoadAttempt = 0;
    rendererGoneRecoveries = 0;
    clearAppLoadWatchdog();
    revealWindow(source);
    console.info(`[main] renderer visual-ready via ${source}: ${describeUrlForLog(url)}`);
  };

  const rendererReadyListener = (event: IpcMainEvent): void => {
    if (event.sender !== win.webContents) return;
    markAppLoadCommitted('renderer-ready');
  };
  ipcMain.on('boot.rendererReady', rendererReadyListener);

  function retryAppLoad(reason: string): void {
    if (win.isDestroyed() || appLoadCommitted) return;
    clearAppLoadWatchdog();
    if (appLoadAttempt >= appLoadMaxAttempts) {
      console.error(`[main] renderer did not commit after ${appLoadAttempt} attempt(s): ${reason}`);
      setBootStatus('Renderer did not start. Check terminal logs, then reload.');
      revealWindow('renderer-load-failed');
      return;
    }
    console.warn(`[main] retrying renderer load: ${reason}`);
    setBootStatus(`Retrying renderer load ${appLoadAttempt + 1}/${appLoadMaxAttempts}`);
    try {
      win.webContents.stop();
    } catch {
      // ignore stop races during renderer recovery
    }
    const retryTimer = setTimeout(() => loadAppRenderer(reason), 250);
    retryTimer.unref?.();
  }

  function loadAppRenderer(reason: string): void {
    if (win.isDestroyed()) return;
    appLoadAttempt += 1;
    appLoadCommitted = false;
    clearAppLoadWatchdog();
    console.info(
      `[main] renderer load attempt ${appLoadAttempt}/${appLoadMaxAttempts} (${reason}) -> ${rendererTargetDescription}`,
    );
    setBootStatus(`Loading renderer ${appLoadAttempt}/${appLoadMaxAttempts}`);
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

  const startAppLoadAfterBoot = (source: string): void => {
    if (bootStartedAppLoad || win.isDestroyed()) return;
    bootStartedAppLoad = true;
    clearTimeout(bootFallbackTimer);
    revealWindow(source);
    const startTimer = setTimeout(() => loadAppRenderer(source), 50);
    startTimer.unref?.();
  };

  const bootFallbackTimer = setTimeout(() => startAppLoadAfterBoot('boot-timeout'), 1500);
  bootFallbackTimer.unref?.();

  const revealTimer = setTimeout(() => revealWindow('timeout'), 2500);
  revealTimer.unref?.();

  win.once('ready-to-show', () => revealWindow('ready-to-show'));
  win.webContents.once('dom-ready', () => startAppLoadAfterBoot('boot-dom-ready'));
  win.webContents.on('dom-ready', () => {
    console.info(`[main] renderer dom-ready: ${describeUrlForLog(win.webContents.getURL())}`);
  });
  win.webContents.once('did-finish-load', () => revealWindow('did-finish-load'));
  win.webContents.on('did-finish-load', () => {
    console.info(`[main] renderer did-finish-load: ${describeUrlForLog(win.webContents.getURL())}`);
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
    if (validatedURL.startsWith(BOOT_SPLASH_URL_PREFIX)) {
      startAppLoadAfterBoot('boot-did-fail-load');
    } else {
      retryAppLoad(`did-fail-load ${errorCode} ${errorDescription}`);
    }
  });
  win.webContents.on('render-process-gone', (_event, details) => {
    console.error(
      `[main] renderer process gone: reason=${details.reason} exitCode=${details.exitCode}`,
    );
    clearAppLoadWatchdog();
    if (details.reason === 'clean-exit') return;
    rendererGoneRecoveries += 1;
    if (rendererGoneRecoveries > rendererGoneMaxRecoveries) {
      console.error(
        `[main] renderer crashed repeatedly; recovery stopped after ${rendererGoneMaxRecoveries} attempt(s)`,
      );
      setBootStatus('Renderer crashed repeatedly. Check terminal logs, then reload.');
      revealWindow('renderer-crash-loop');
      return;
    }
    appLoadCommitted = false;
    const recoveryDelayMs = Math.min(500 * rendererGoneRecoveries, 2_000);
    void win.loadURL(createBootSplashUrl()).then(
      () =>
        setBootStatus(`Recovering renderer ${rendererGoneRecoveries}/${rendererGoneMaxRecoveries}`),
      (err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[main] recovery boot splash load rejected: ${message}`);
      },
    );
    const reloadTimer = setTimeout(
      () => loadAppRenderer(`render-process-gone:${details.reason}`),
      recoveryDelayMs,
    );
    reloadTimer.unref?.();
  });

  win.on('closed', () => {
    ipcMain.removeListener('boot.rendererReady', rendererReadyListener);
    uninstallTopmostGuard();
    clearTimeout(bootFallbackTimer);
    clearAppLoadWatchdog();
    clearTimeout(revealTimer);
    if (mainWindow === win) mainWindow = null;
  });

  if (isDev && VITE_DEV_SERVER_URL) {
    void win.loadURL(createBootSplashUrl()).catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[main] boot splash load rejected: ${message}`);
      startAppLoadAfterBoot('boot-load-rejected');
    });
    // dev mode 也不再自动开 DevTools——用户用 View → Toggle Developer Tools 菜单或
    // Ctrl+Shift+I 快捷键按需打开。默认开会让首次启动多个浮窗显得突兀。
    // 若开发期想要自动打开，设环境变量 SPACE_AUTO_DEVTOOLS=1。
    if (process.env.SPACE_AUTO_DEVTOOLS === '1') {
      win.webContents.openDevTools({ mode: 'detach' });
    }
  } else {
    void win.loadURL(createBootSplashUrl()).catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[main] boot splash load rejected: ${message}`);
      startAppLoadAfterBoot('boot-load-rejected');
    });
  }
}

// OC-01 单实例锁：HLD §10.3「No-duplicate-session-truth」要求同时只能有一个 Space 进程
// 写 ~/.kodax/，否则 projects.json / sessions 可能被并发写花。
// app.requestSingleInstanceLock() 必须在 app.whenReady() 之前调，第二个进程会立即 quit。
// 第一个进程收到 second-instance 事件 → show + focus 已有窗口（Slack/Discord 同款行为）。
const gotInstanceLock = app.requestSingleInstanceLock();
if (!gotInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', (_event, argv) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
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

app
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
    // 启动期 3 个 async 任务无强依赖关系，并行跑省 300-800ms 才到窗口创建：
    //   - hydrateShellEnvOnce: 读 user shell rc 把 export 的 API key 流进 process.env
    //   - probeKodaxSdk: SDK shape 漂移 fail-fast (FEATURE shipper guard)
    //   - probeSkillRegistry: SkillRegistry subpath fail-fast
    // 三个都是 fail-fast 类，只决定"是否致命错误终止启动"，没有 ordering 依赖。
    // shell env hydration 与 keychain key 注入的 ordering 还是保留——后者跟在
    // providerConfigStore.load 后面，本块完成时一定还没跑到，env 已经填好可读。
    await Promise.all([
      hydrateShellEnvOnce(),
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
      // F116: warm the inline Runtime before IPC starts. Initialization failure is
      // a pre-run rollback condition, not an application-start failure; live sessions
      // will use the legacy driver and space.version will expose the degraded state.
      runtimeHostAdapter
        .initialize(app.getVersion())
        .then(() => {
          diagnosticsLogger?.info('runtime', 'host_initialized');
        })
        .catch((err) => {
          diagnosticsLogger?.warn('runtime', 'host_initialization_failed', undefined, err);
          console.warn(
            '[main] Runtime host initialization failed; legacy rollback remains active:',
            err instanceof Error ? err.message : err,
          );
        }),
    ]);
    // Shell hydration may add provider secrets after diagnostics was initialized.
    refreshDiagnosticRedactionOptions();
    // v0.1.10 chore: best-effort 清理早期残留的 ~/.kodax_space 孤儿目录。
    // fire-and-forget,never throws,不阻塞 UI 启动;详见 cleanup-orphan-kodax-space.ts。
    void cleanupOrphanKodaxSpaceDirWithLog();
    const mcpbMigration = await migrateLegacyMcpbStorage();
    if (mcpbMigration.kind === 'migrated') {
      console.log(
        `[startup] Migrated ${mcpbMigration.migrated} MCP bundle(s) to ~/.kodax/mcpb (${mcpbMigration.registered} registered).`,
      );
    } else if (mcpbMigration.kind === 'error') {
      console.warn(`[startup] MCP bundle migration skipped: ${mcpbMigration.message}`);
    }

    // IPC handlers 必须在窗口创建前注册——否则 renderer 启动后立刻调 invoke 会撞上 "No handler registered"
    registerVersionChannel();
    registerDiagnosticsChannels({
      getMainWindow: () => mainWindow,
      spaceVersion: SPACE_VERSION,
    });
    registerSpaceControlChannels();
    registerRepointelChannels();
    registerHandoffChannels();
    registerSessionChannels();
    registerProjectChannels();
    registerPermissionChannels();
    registerAskUserChannels();
    registerBuiltinSlashCommands();
    registerSlashChannels();
    registerSkillChannels();
    registerAgentChannels();
    registerMcpChannels();
    registerKodaxChannels();
    registerAdminPolicyAuditChannels();
    registerQueueChannels();
    // v0.1.6 cleanup: 预热 SDK MCP module 让首次 mcp.discover 不命中空 fallback
    // （DEFAULT_IMPL 首次同步调返回 {}，prewarm 异步触发后续调用走真 SDK）
    void prewarmSdkMcpStore();
    // v0.1.6 cleanup: 同上，预热 root SDK module + 把 ~/.kodax/config.json 的 customProviders
    // 注册进 SDK runtime LLM registry。完成后 `/provider <name>` 可切到 KodaX-CLI 配的
    // 自定义 provider（如用户的 newapi-anthropic / openrouter-xxx）。失败不阻塞启动。
    void prewarmKodaxUserConfig()
      .then(() => providerConfigStore.load())
      .then(() => registerKodaxCustomProviders(providerConfigStore.listCustom()));
    registerProviderChannels();
    registerFilesChannels();
    registerPartnerSourceChannels();
    registerPartnerKbChannels();
    registerPartnerDeliveryChannels();
    registerPartnerCheckpointChannels();
    registerPartnerFileProposalChannels();
    registerTitlebarChannels();
    registerWindowChannels(() => (mainWindow && !mainWindow.isDestroyed() ? mainWindow : null));
    registerSettingsChannels();
    registerLicenseChannels();
    // F020 native OS notification — renderer 调 notification.show 弹 OS 原生通知
    registerNotificationChannels();
    setNotificationWindowGetter(() =>
      mainWindow && !mainWindow.isDestroyed() ? mainWindow : null,
    );
    // F022 auto-updater — packaged 模式下走 GitHub Releases feed；dev 模式 idle
    // initAutoUpdater 内部判断 app.isPackaged + 异步触发首次 check，不阻塞窗口创建
    registerUpdaterChannels();
    void initAutoUpdater();
    // F021 .mcpb / .dxt bundle install — IPC handlers，UI 点 "Install extension..." 走
    registerMcpbChannels();
    // F011 内置终端 (xterm.js + node-pty) — terminal.create/write/resize/kill + output/exit push
    registerTerminalChannels();
    // OC-31 v0.1.9 clipboard image paste — renderer 把粘贴板图片落到 app temp dir
    registerClipboardChannels();
    // 2026-06-18 shell 出口：shell.revealPath（文件管理器定位）+ shell.openExternal（系统浏览器开 URL）。
    // 让 renderer 里到处的文件路径 / URL 死文本变成可点击（用户反馈）。
    registerShellChannels();
    // Artifact 数据层（F057，LC-free）：create/list/read/delete/export + openWindow。
    // LC sandbox（路径 D）的 loopback server 已移除，待 LiveCanvas 稳定后作为独立 feature 重接。
    registerArtifactChannels();
    registerMemoryChannels();
    // F060 Workflow Harness 支持：list/get IPC + 订阅 SDK 进程事件流转发到 renderer（workflow.event）。
    // init 是 best-effort（lazy-load SDK run manager + 加载持久化归属）；失败只降级为"无实时工作流面"。
    registerWorkflowChannels();
    void workflowController
      .init()
      .then(() => diagnosticsLogger?.info('workflow', 'controller_initialized'))
      .catch((err) => {
        diagnosticsLogger?.warn('workflow', 'controller_initialization_failed', undefined, err);
        console.warn(
          '[main] workflow controller init failed:',
          err instanceof Error ? err.message : err,
        );
      });
    // F064 Workflow Host Policy 已在上面启动期 Promise.all 里 await 加载（早于窗口/首跑）。
    // F059c L3：artifact.openWindow → 独立最大化窗口（复用同一 renderer + preload，走 #artifact hash）。
    registerArtifactWindowChannel({
      preloadPath: PRELOAD_PATH,
      devServerUrl: VITE_DEV_SERVER_URL,
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
    void startQueueWatch().catch((err) => {
      console.warn('[main] startQueueWatch failed:', err instanceof Error ? err.message : err);
    });
    // FEATURE_083 FileTracingProcessor (opt-in): 设 SPACE_TRACE_DIR=/some/abs/path 后启动期注册,
    // SDK 把 span/trace lifecycle JSONL 写入该目录。默认不写 (避免文件落盘而用户不知情)。
    void startFileTracingIfEnabled().catch((err) => {
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
    createMainWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createMainWindow();
      }
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
        createMainWindow();
      } catch (e) {
        console.error('[main] createMainWindow() in startup catch also failed:', sanitizeError(e));
      }
    }
  });

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
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
  // 同步 + 幂等的清理先做（每次 before-quit 触发都安全重入）。
  permissionBroker.cancelAll('shutdown');
  askUserBroker.cancelAll('shutdown');
  spaceControlRendererBroker.cancelAll('shutdown');
  // F011: kill all PTYs before exit so shells don't outlive Electron as zombies.
  // disposeAll is synchronous + idempotent, never throws.
  try {
    getPtyHost().disposeAll();
  } catch (err) {
    console.warn('[main] ptyHost dispose:', err instanceof Error ? err.message : err);
  }

  // 第二次 before-quit（理论上不会——app.exit 跳过 before-quit；防 electron quirk）直接放行。
  if (_quitting) return;
  _quitting = true;
  // 异步清理需要 await 完才能让进程死，否则子进程 kill 与进程退出赛跑 → 孤儿残留。
  event.preventDefault();

  const tracingShutdown = _fileTracingShutdown;
  _fileTracingShutdown = null;

  // 所有会 spawn 子进程 / 持有句柄的异步清理，统一收口后 allSettled。每个自带 catch，
  // 不让单个失败短路其它清理。
  const disposals: Promise<unknown>[] = [
    // McpManager: 释放 stdio transport 子进程,免得 quit 后 server 进程作为 zombie 留着。
    disposeMcpManager().catch((err) =>
      console.warn('[main] mcp shutdown:', err instanceof Error ? err.message : err),
    ),
    // KodaX in-flight session：abort + drain queue（dispose 本身很快，不 await SDK 后台 run）。
    kodaxHost
      .disposeAll()
      .catch((err) =>
        console.error('[main] disposeAll on quit:', err instanceof Error ? err.message : err),
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
  // FileTracingProcessor.shutdown(): 刷 pending write 到磁盘（opt-in，多数用户为 null）。
  if (tracingShutdown !== null) {
    disposals.push(
      tracingShutdown().catch((err) =>
        console.warn('[main] tracing shutdown:', err instanceof Error ? err.message : err),
      ),
    );
  }

  // 兜底看门狗：任一清理卡死也不让 app 永远不退。unref 不让它本身把 event loop 拖住。
  const watchdog = setTimeout(() => {
    console.warn('[main] shutdown disposals exceeded 2.5s; forcing exit');
    app.exit(0);
  }, 2500);
  watchdog.unref?.();

  void Promise.allSettled(disposals)
    .then(() => flushDiagnostics())
    .finally(() => {
      clearTimeout(watchdog);
      app.exit(0);
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
