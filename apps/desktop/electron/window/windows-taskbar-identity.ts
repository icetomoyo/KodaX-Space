import path from 'node:path';

export interface WindowsTaskbarAppDetails {
  readonly appId: string;
  readonly appIconPath: string;
  readonly appIconIndex: number;
  readonly relaunchCommand?: string;
  readonly relaunchDisplayName?: string;
}

export interface WindowsTaskbarIdentity {
  readonly appDetails: WindowsTaskbarAppDetails;
  readonly relaunchExecutable?: string;
}

export interface WindowsTaskbarIdentityOptions {
  readonly platform: NodeJS.Platform;
  readonly isPackaged: boolean;
  readonly appId: string;
  readonly appName: string;
  readonly windowIconPath: string | undefined;
  readonly execPath: string;
  readonly portableExecutableFile: string | undefined;
}

function quoteWindowsCommandArgument(value: string): string {
  return `"${value.replaceAll('"', '\\"')}"`;
}

/**
 * BrowserWindow.icon controls WM_SETICON, but Windows can still render a stale
 * taskbar shortcut icon for an explicit AppUserModelID. Window-level app
 * details make the relaunch identity and icon source unambiguous.
 */
export function resolveWindowsTaskbarIdentity(
  options: WindowsTaskbarIdentityOptions,
): WindowsTaskbarIdentity | undefined {
  if (options.platform !== 'win32' || !options.windowIconPath) return undefined;

  if (!options.isPackaged) {
    return {
      appDetails: {
        appId: options.appId,
        appIconPath: options.windowIconPath,
        appIconIndex: 0,
      },
    };
  }

  const portableExecutableFile = options.portableExecutableFile?.trim();
  const relaunchExecutable =
    portableExecutableFile && path.win32.isAbsolute(portableExecutableFile)
      ? portableExecutableFile
      : options.execPath;

  return {
    relaunchExecutable,
    appDetails: {
      appId: options.appId,
      appIconPath: relaunchExecutable,
      appIconIndex: 0,
      relaunchCommand: quoteWindowsCommandArgument(relaunchExecutable),
      relaunchDisplayName: options.appName,
    },
  };
}

export interface StalePortableShortcutOptions {
  readonly shortcutTarget: string;
  readonly shortcutTargetExists: boolean;
  readonly expectedExecutableName: string;
  readonly tempDir: string;
}

/**
 * Portable apps have historically left Windows-generated shortcuts pointing
 * at their disposable extraction directory. Only repair that exact stale case;
 * never rewrite a valid shortcut or an arbitrary user-owned target.
 */
export function isStalePortableShortcut(options: StalePortableShortcutOptions): boolean {
  if (options.shortcutTargetExists || !options.shortcutTarget) return false;
  if (
    path.win32.basename(options.shortcutTarget).toLowerCase() !==
    options.expectedExecutableName.toLowerCase()
  ) {
    return false;
  }

  const relativeToTemp = path.win32.relative(options.tempDir, options.shortcutTarget);
  return (
    relativeToTemp.length > 0 &&
    relativeToTemp !== '..' &&
    !relativeToTemp.startsWith(`..${path.win32.sep}`) &&
    !path.win32.isAbsolute(relativeToTemp)
  );
}
