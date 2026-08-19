import type { BrowserWindow } from 'electron';
import { registerChannel } from './register.js';

function projectWindowState(win: BrowserWindow | null): {
  maximized: boolean;
  minimized: boolean;
  focused: boolean;
} {
  if (!win || win.isDestroyed()) {
    return { maximized: false, minimized: false, focused: false };
  }
  return {
    maximized: win.isMaximized(),
    minimized: win.isMinimized(),
    focused: win.isFocused(),
  };
}

export function registerWindowChannels(
  getMainWindow: () => BrowserWindow | null,
  setBadgeCount: (count: number) => boolean,
): void {
  registerChannel('window.state', () => projectWindowState(getMainWindow()));

  registerChannel('window.setBadgeCount', ({ count }) => ({
    applied: setBadgeCount(count),
  }));

  registerChannel('window.control', ({ action }) => {
    const win = getMainWindow();
    if (!win || win.isDestroyed()) return projectWindowState(null);

    if (action === 'minimize') {
      win.minimize();
    } else if (action === 'toggleMaximize') {
      if (win.isMaximized()) win.unmaximize();
      else win.maximize();
    } else if (action === 'close') {
      win.close();
    }

    return projectWindowState(win);
  });
}
