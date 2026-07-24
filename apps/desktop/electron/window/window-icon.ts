import path from 'node:path';

export interface WindowIconPathOptions {
  readonly platform: NodeJS.Platform;
  readonly isPackaged: boolean;
  readonly resourcesPath: string;
  readonly bundleDir: string;
}

/**
 * Windows taskbar icons come from the native window icon, not reliably from the
 * installer/launcher PE resource. Keep one explicit path for every window.
 */
export function resolveWindowIconPath(options: WindowIconPathOptions): string | undefined {
  if (options.platform !== 'win32') return undefined;
  return options.isPackaged
    ? path.join(options.resourcesPath, 'icon.ico')
    : path.resolve(options.bundleDir, '../resources/icon.ico');
}
