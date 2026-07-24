import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  isStalePortableShortcut,
  resolveWindowsTaskbarIdentity,
} from '../window/windows-taskbar-identity.js';

const baseOptions = {
  platform: 'win32' as const,
  isPackaged: true,
  appId: 'ai.kodax.space',
  appName: 'KodaX Space',
  windowIconPath: 'C:\\Temp\\portable\\resources\\icon.ico',
  execPath: 'C:\\Temp\\portable\\KodaX Space.exe',
  portableExecutableFile: 'D:\\Tools\\KodaX-Space-Portable-0.1.32.exe',
};

test('packaged portable windows relaunch through the persistent outer executable', () => {
  assert.deepEqual(resolveWindowsTaskbarIdentity(baseOptions), {
    relaunchExecutable: 'D:\\Tools\\KodaX-Space-Portable-0.1.32.exe',
    appDetails: {
      appId: 'ai.kodax.space',
      appIconPath: 'D:\\Tools\\KodaX-Space-Portable-0.1.32.exe',
      appIconIndex: 0,
      relaunchCommand: '"D:\\Tools\\KodaX-Space-Portable-0.1.32.exe"',
      relaunchDisplayName: 'KodaX Space',
    },
  });
});

test('installed windows use the packaged application executable', () => {
  assert.deepEqual(
    resolveWindowsTaskbarIdentity({
      ...baseOptions,
      execPath: 'C:\\Program Files\\KodaX Space\\KodaX Space.exe',
      portableExecutableFile: undefined,
    }),
    {
      relaunchExecutable: 'C:\\Program Files\\KodaX Space\\KodaX Space.exe',
      appDetails: {
        appId: 'ai.kodax.space',
        appIconPath: 'C:\\Program Files\\KodaX Space\\KodaX Space.exe',
        appIconIndex: 0,
        relaunchCommand: '"C:\\Program Files\\KodaX Space\\KodaX Space.exe"',
        relaunchDisplayName: 'KodaX Space',
      },
    },
  );
});

test('development windows set an explicit taskbar icon without a broken relaunch command', () => {
  assert.deepEqual(
    resolveWindowsTaskbarIdentity({
      ...baseOptions,
      isPackaged: false,
      execPath: 'C:\\repo\\node_modules\\electron\\dist\\electron.exe',
      portableExecutableFile: undefined,
    }),
    {
      appDetails: {
        appId: 'ai.kodax.space',
        appIconPath: 'C:\\Temp\\portable\\resources\\icon.ico',
        appIconIndex: 0,
      },
    },
  );
});

test('non-Windows platforms do not receive Windows taskbar details', () => {
  assert.equal(
    resolveWindowsTaskbarIdentity({
      ...baseOptions,
      platform: 'darwin',
    }),
    undefined,
  );
});

test('only missing KodaX executables inside TEMP count as stale portable shortcuts', () => {
  assert.equal(
    isStalePortableShortcut({
      shortcutTarget: 'C:\\Users\\me\\AppData\\Local\\Temp\\old\\KodaX Space.exe',
      shortcutTargetExists: false,
      expectedExecutableName: 'KodaX Space.exe',
      tempDir: 'C:\\Users\\me\\AppData\\Local\\Temp',
    }),
    true,
  );
  assert.equal(
    isStalePortableShortcut({
      shortcutTarget: 'C:\\Users\\me\\AppData\\Local\\Temp\\old\\KodaX Space.exe',
      shortcutTargetExists: true,
      expectedExecutableName: 'KodaX Space.exe',
      tempDir: 'C:\\Users\\me\\AppData\\Local\\Temp',
    }),
    false,
  );
  assert.equal(
    isStalePortableShortcut({
      shortcutTarget: 'D:\\Tools\\KodaX Space.exe',
      shortcutTargetExists: false,
      expectedExecutableName: 'KodaX Space.exe',
      tempDir: 'C:\\Users\\me\\AppData\\Local\\Temp',
    }),
    false,
  );
});
