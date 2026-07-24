// artifact.openWindow — F059c L3: open one artifact in a separate, maximized window.
//
// The escalation is: RightSidebar Artifact tab → full-cover popout → THIS standalone
// window. The child window loads the same renderer with a `#artifact?id=…` hash;
// renderer `main.tsx` detects the hash and mounts <ArtifactWindow/> (a lean, store-free
// view that reads the artifact by id over IPC) instead of the full <App/>.
//
// Lazy electron access (BrowserWindow/shell) mirrors ipc/artifact.ts so this module
// stays importable under the tsx test loader.

import { createRequire } from 'node:module';
import { registerChannel } from '../ipc/register.js';
import { installNavigationGuards } from '../window/navigation-guards.js';
import { installTopmostGuard } from '../window/topmost-guard.js';
import { APP_PROTOCOL_INDEX_URL, APP_PROTOCOL_ORIGIN } from '../window/app-protocol-policy.js';
import type { WindowsTaskbarAppDetails } from '../window/windows-taskbar-identity.js';

function getElectron(): typeof import('electron') {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const meta = typeof require !== 'undefined' ? null : (import.meta as any);
  const req = meta ? createRequire(meta.url) : require;
  return req('electron') as typeof import('electron');
}

export interface ArtifactWindowDeps {
  /** Absolute path to the renderer preload script (same as the main window). */
  readonly preloadPath: string;
  /** Vite dev-server URL in dev; undefined in production. */
  readonly devServerUrl: string | undefined;
  /** Explicit Windows native-window icon used by the taskbar and Alt+Tab. */
  readonly iconPath?: string;
  /** Explicit Windows taskbar identity, relaunch command, and relaunch icon. */
  readonly taskbarAppDetails?: WindowsTaskbarAppDetails;
}

interface OpenInput {
  readonly id: string;
  readonly version?: number;
  readonly projectRoot?: string;
  readonly title?: string;
}

/** Build the `#artifact?…` hash that ArtifactWindow parses. */
function buildArtifactHash(input: OpenInput): string {
  const p = new URLSearchParams();
  p.set('id', input.id);
  if (input.version !== undefined) p.set('v', String(input.version));
  if (input.projectRoot) p.set('projectRoot', input.projectRoot);
  if (input.title) p.set('title', input.title);
  return `artifact?${p.toString()}`;
}

// Retain open artifact windows so the JS objects aren't GC'd and we can clean up
// on close (avoids accumulation across a long session).
const openWindows = new Set<import('electron').BrowserWindow>();

// Strip BiDi override controls from an LLM-authored title before it hits the OS
// titlebar (visual-spoofing defense). The renderer re-sanitizes once it sets
// document.title; this covers the brief pre-load flash.
const BIDI_CONTROLS = /[\u200f\u202a-\u202e\u2066-\u2069]/g;

function openArtifactWindow(input: OpenInput, deps: ArtifactWindowDeps): void {
  const { BrowserWindow, shell } = getElectron();
  const win = new BrowserWindow({
    width: 1100,
    height: 820,
    minWidth: 560,
    minHeight: 420,
    title: (input.title ?? 'Artifact').replace(BIDI_CONTROLS, ''),
    icon: deps.iconPath,
    backgroundColor: '#0b0b0c',
    show: false,
    alwaysOnTop: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: deps.preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
    },
  });
  if (deps.taskbarAppDetails) {
    win.setAppDetails(deps.taskbarAppDetails);
  }

  installNavigationGuards(win.webContents, {
    devServerUrl: deps.devServerUrl,
    allowedAppOrigin: APP_PROTOCOL_ORIGIN,
    openExternal: (url) => void shell.openExternal(url),
  });

  const hash = buildArtifactHash(input);
  if (deps.devServerUrl) {
    void win.loadURL(`${deps.devServerUrl}#${hash}`);
  } else {
    void win.loadURL(`${APP_PROTOCOL_INDEX_URL}#${hash}`);
  }

  openWindows.add(win);
  const uninstallTopmostGuard = installTopmostGuard(win, { label: 'artifact window' });
  win.on('closed', () => {
    uninstallTopmostGuard();
    openWindows.delete(win);
  });

  win.once('ready-to-show', () => {
    win.maximize(); // "单独打开 ≈ 最大化的单独页面"（用户 2026-06-15 要求）
    win.show();
  });
}

/** Register the `artifact.openWindow` IPC. Called from main with the resolved paths. */
export function registerArtifactWindowChannel(deps: ArtifactWindowDeps): void {
  registerChannel('artifact.openWindow', (input) => {
    openArtifactWindow(input, deps);
    return { ok: true };
  });
}
