export interface ShutdownWindowLike {
  isDestroyed(): boolean;
  hide(): void;
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
