import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';

import { resolveWindowIconPath } from '../window/window-icon.js';

test('packaged Windows windows use the installer-owned runtime icon', () => {
  assert.equal(
    resolveWindowIconPath({
      platform: 'win32',
      isPackaged: true,
      resourcesPath: 'C:\\Program Files\\KodaX Space\\resources',
      bundleDir: 'C:\\ignored\\app.asar\\dist-electron',
    }),
    path.join('C:\\Program Files\\KodaX Space\\resources', 'icon.ico'),
  );
});

test('development Windows windows resolve the repository icon beside dist-electron', () => {
  assert.equal(
    resolveWindowIconPath({
      platform: 'win32',
      isPackaged: false,
      resourcesPath: 'C:\\ignored\\resources',
      bundleDir: 'C:\\repo\\dist-electron',
    }),
    path.resolve('C:\\repo\\dist-electron', '../resources/icon.ico'),
  );
});

test('non-Windows windows keep the platform application icon behavior', () => {
  assert.equal(
    resolveWindowIconPath({
      platform: 'darwin',
      isPackaged: true,
      resourcesPath: '/Applications/KodaX Space.app/Contents/Resources',
      bundleDir: '/Applications/KodaX Space.app/Contents/Resources/app.asar/dist-electron',
    }),
    undefined,
  );
});
