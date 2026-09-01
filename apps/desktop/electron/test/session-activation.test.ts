import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { SessionMeta } from '@kodax-space/space-ipc-schema';
import { shouldActivateSessionForCurrentScope } from '../../renderer/src/lib/sessionActivation.js';

function mkSession(input: {
  readonly projectRoot: string;
  readonly surface: SessionMeta['surface'];
}): SessionMeta {
  return {
    sessionId: 's_activation',
    projectRoot: input.projectRoot,
    provider: 'mock',
    reasoningMode: 'auto',
    permissionMode: 'accept-edits',
    agentMode: 'ama',
    surface: input.surface,
    createdAt: 1700000000000,
    lastActivityAt: 1700000000000,
  };
}

test('created session activates only when current project and surface still match', () => {
  const session = mkSession({ projectRoot: '/proj/a', surface: 'code' });

  assert.equal(
    shouldActivateSessionForCurrentScope(session, {
      currentProjectPath: '/proj/a/',
      currentSurface: 'code',
    }),
    true,
  );
  assert.equal(
    shouldActivateSessionForCurrentScope(session, {
      currentProjectPath: '/proj/b',
      currentSurface: 'code',
    }),
    false,
  );
  assert.equal(
    shouldActivateSessionForCurrentScope(session, {
      currentProjectPath: '/proj/a',
      currentSurface: 'partner',
    }),
    false,
  );
  assert.equal(
    shouldActivateSessionForCurrentScope(session, {
      currentProjectPath: null,
      currentSurface: 'code',
    }),
    false,
  );
});

test('missing session surface is treated as code for activation', () => {
  const session = mkSession({ projectRoot: '/proj/a', surface: 'code' });
  delete (session as Partial<SessionMeta>).surface;

  assert.equal(
    shouldActivateSessionForCurrentScope(session, {
      currentProjectPath: '/proj/a',
      currentSurface: 'code',
    }),
    true,
  );
});

test('forked session does not activate after the user switched projects', () => {
  const session: SessionMeta = {
    ...mkSession({ projectRoot: '/proj/a', surface: 'code' }),
    sessionId: 's_activation_fork',
    parentSessionId: 's_activation_parent',
  };

  assert.equal(
    shouldActivateSessionForCurrentScope(session, {
      currentProjectPath: '/proj/b',
      currentSurface: 'code',
    }),
    false,
  );
});
