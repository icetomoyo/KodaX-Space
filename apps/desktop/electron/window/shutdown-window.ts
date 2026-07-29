export interface ShutdownWindowLike {
  isDestroyed(): boolean;
  hide(): void;
}

export interface FailedShutdownWindowLike {
  isDestroyed(): boolean;
  isMinimized(): boolean;
  restore(): void;
  show(): void;
  focus(): void;
}

/**
 * Remove every application window from the desktop as soon as shutdown is
 * committed. The Electron process may remain alive briefly while bounded
 * asynchronous cleanup finishes, but the user's close action must look
 * immediate.
 */
export function hideWindowsForShutdown(
  windows: readonly ShutdownWindowLike[],
  onHideError?: (error: unknown) => void,
): void {
  for (const window of windows) {
    if (window.isDestroyed()) continue;
    try {
      window.hide();
    } catch (error) {
      onHideError?.(error);
    }
  }
}

/**
 * Last-resort visible fail-closed surface when Electron could not register a
 * recovery relaunch after irreversible cleanup began. This intentionally
 * bypasses normal startup-reveal gates, which are already in shutdown state.
 */
export function showWindowAfterFailedShutdown<T extends FailedShutdownWindowLike>(
  windows: readonly T[],
  createWindow: () => T,
): T {
  const window = windows.find((candidate) => !candidate.isDestroyed()) ?? createWindow();
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
  return window;
}
