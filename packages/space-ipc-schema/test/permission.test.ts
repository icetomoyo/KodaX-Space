import assert from 'node:assert/strict';
import test from 'node:test';

import { permissionListChannel, permissionRevokeChannel } from '../src/index.js';

test('permission.list carries both Space rules and revisioned Runtime grants', () => {
  const result = permissionListChannel.output.safeParse({
    rules: [
      { pattern: 'bash:npm test', createdAt: 1, origin: 'space' },
      {
        pattern: 'bash (session s_1)',
        createdAt: 2,
        origin: 'runtime',
        grantId: 'grant_1',
        revision: 7,
        toolName: 'bash',
        sessionId: 's_1',
      },
    ],
  });
  assert.equal(result.success, true);
});

test('permission.revoke accepts exactly one authority-specific identity', () => {
  assert.equal(permissionRevokeChannel.input.safeParse({ pattern: 'read' }).success, true);
  assert.equal(
    permissionRevokeChannel.input.safeParse({ grantId: 'grant_1', revision: 2 }).success,
    true,
  );
  assert.equal(permissionRevokeChannel.input.safeParse({ grantId: 'grant_1' }).success, false);
  assert.equal(
    permissionRevokeChannel.input.safeParse({ pattern: 'read', grantId: 'grant_1', revision: 2 })
      .success,
    false,
  );
});
