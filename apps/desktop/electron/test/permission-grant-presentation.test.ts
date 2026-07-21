import assert from 'node:assert/strict';
import test from 'node:test';

import type { PermissionRequestPayload } from '@kodax-space/space-ipc-schema';
import { permissionGrantPresentation } from '../../renderer/src/features/permission/permissionGrantPresentation.js';

function request(overrides: Partial<PermissionRequestPayload> = {}): PermissionRequestPayload {
  return {
    reqId: 'req_1',
    sessionId: 'session_1',
    risk: 'medium',
    reason: 'Run a command',
    toolCall: { toolId: 'tool_1', toolName: 'bash' },
    ...overrides,
  };
}

test('persistent grant presentation preserves Partner patterns', () => {
  assert.deepEqual(permissionGrantPresentation(request({ suggestedPattern: 'bash:npm test' })), {
    kind: 'pattern',
    target: 'bash:npm test',
  });
});

test('persistent grant presentation exposes Runtime-issued concrete grant labels', () => {
  assert.deepEqual(
    permissionGrantPresentation(
      request({
        allowAlwaysScope: {
          kind: 'runtime_persistent',
          label: 'Always allow this exact command: npm test',
        },
      }),
    ),
    { kind: 'runtime_persistent', target: 'Always allow this exact command: npm test' },
  );
});

test('persistent grant presentation stays hidden without a trusted grant scope', () => {
  assert.equal(permissionGrantPresentation(request()), null);
});
