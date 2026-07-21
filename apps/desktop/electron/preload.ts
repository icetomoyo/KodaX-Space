// Preload script - FEATURE_001
//
// Expose the minimal, allowlisted IPC API to the renderer through contextBridge.
import { contextBridge, ipcRenderer, webFrame, webUtils } from 'electron';
import { INVOKE_CHANNEL_NAMES, PUSH_CHANNEL_NAMES } from '@kodax-space/space-ipc-schema';

// Derive channel allowlists from the schema package so preload does not keep a
// second handwritten list.
const ALLOWED_INVOKE_CHANNELS = INVOKE_CHANNEL_NAMES;
const ALLOWED_LISTEN_CHANNELS = PUSH_CHANNEL_NAMES;

// Freeze process.platform into a primitive before exposing it through the bridge.
const platformValue: NodeJS.Platform = process.platform;

const kodaxSpaceBridge = {
  /**
   * Invoke a main-process channel. Unknown channels fail before reaching IPC.
   */
  invoke: async (channel: string, payload?: unknown): Promise<unknown> => {
    if (!ALLOWED_INVOKE_CHANNELS.has(channel)) {
      throw new Error(`[preload] channel not allowed: ${channel}`);
    }
    return ipcRenderer.invoke(channel, payload);
  },

  /**
   * Subscribe to main-to-renderer events and return an unsubscribe function.
   */
  on: (channel: string, listener: (payload: unknown) => void): (() => void) => {
    if (!ALLOWED_LISTEN_CHANNELS.has(channel)) {
      throw new Error(`[preload] listen channel not allowed: ${channel}`);
    }
    const wrapped = (_: unknown, payload: unknown): void => listener(payload);
    ipcRenderer.on(channel, wrapped);
    return () => ipcRenderer.removeListener(channel, wrapped);
  },

  /**
   * Renderer platform metadata for UI adaptation.
   */
  platform: platformValue,

  /**
   * Narrow boot signal: renderer calls this after React commits and a frame has
   * had a chance to paint. It is intentionally not a generic IPC escape hatch.
   */
  rendererReady: (): void => {
    ipcRenderer.send('boot.rendererReady');
  },

  /**
   * Resolve the OS path for a user-provided File object from drag/drop.
   * The renderer never receives Electron itself; this keeps the capability
   * narrow and tied to a real browser File handle.
   */
  getPathForFile: (file: File): string | null => {
    try {
      const path = webUtils.getPathForFile(file);
      return path.length > 0 ? path : null;
    } catch {
      return null;
    }
  },

  /**
   * Chromium whole-window zoom. The renderer owns gestures and persistence.
   */
  zoom: {
    get: (): number => webFrame.getZoomFactor(),
    set: (factor: number): void => {
      const safe = Number.isFinite(factor) ? Math.min(5, Math.max(0.25, factor)) : 1;
      webFrame.setZoomFactor(safe);
    },
  },
};

const trustedRendererFrame =
  process.isMainFrame &&
  ((location.protocol === 'app:' && location.host === 'space') ||
    (location.protocol === 'http:' &&
      (location.hostname === 'localhost' ||
        location.hostname === '127.0.0.1' ||
        location.hostname === '[::1]')));

// Project previews use distinct app://preview-<capability> origins. Even if a
// future regression navigates one into a top-level frame, it must never receive
// Space's IPC bridge.
if (trustedRendererFrame) contextBridge.exposeInMainWorld('kodaxSpace', kodaxSpaceBridge);

// Renderer-side global types live in apps/desktop/renderer/src/types/global.d.ts.
