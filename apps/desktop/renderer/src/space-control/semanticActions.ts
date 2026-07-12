import type { LanguageModeT, ReasoningMode, Surface } from '@kodax-space/space-ipc-schema';
import { useAppStore } from '../store/appStore.js';
import { useSurfaceStore } from '../store/surface.js';

export type SpaceTheme = 'dark' | 'light' | 'system';

export function setSpaceTheme(theme: SpaceTheme): void {
  useAppStore.getState().setTheme(theme);
}

export function setSpaceSurface(surface: Surface): void {
  useSurfaceStore.getState().setSurface(surface);
}

export function setSpaceLeftSidebarOpen(open: boolean): void {
  useAppStore.getState().setLeftSidebarOpen(open);
}

export function setSpaceTaskDockOpen(open: boolean): void {
  useAppStore.getState().setRightSidebarOpen(open);
}

export async function setSpaceLanguage(
  mode: LanguageModeT,
  persist: (mode: LanguageModeT) => Promise<boolean>,
): Promise<boolean> {
  return persist(mode);
}

export async function setSpaceReasoningDefault(mode: ReasoningMode): Promise<boolean> {
  const bridge = window.kodaxSpace;
  if (!bridge) return false;
  const result = await bridge.invoke('settings.setRuntimeDefaults', {
    runtimeDefaults: { reasoningMode: mode },
  });
  if (!result.ok) return false;
  useAppStore.getState().setRuntimeDefaults(result.data.runtimeDefaults ?? {});
  return true;
}
