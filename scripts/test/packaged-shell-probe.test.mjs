import assert from 'node:assert/strict';
import test from 'node:test';

import { createPackagedShellProbeToolInput } from '../packaged-shell-probe.mjs';

test('packaged shell probe reserves a Windows sandbox lifecycle budget', () => {
  assert.deepEqual(createPackagedShellProbeToolInput('Write-Output ok', 'win32'), {
    command: 'Write-Output ok',
    timeout: 180,
  });
});

test('packaged shell probe keeps the SDK timeout on other platforms', () => {
  assert.deepEqual(createPackagedShellProbeToolInput('printf ok', 'linux'), {
    command: 'printf ok',
  });
});
