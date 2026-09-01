import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { SessionMeta } from '@kodax-space/space-ipc-schema';
import { replaceSessionsInScope, sessionMatchesScope } from '../../renderer/src/lib/sessionScope.js';

function meta(sessionId: string, projectRoot: string, surface: SessionMeta['surface']): SessionMeta {
  return {
    sessionId,
    projectRoot,
    surface,
    provider: 'mock',
    reasoningMode: 'auto',
    permissionMode: 'accept-edits',
    agentMode: 'ama',
    createdAt: 1,
    lastActivityAt: 1,
  };
}

test('replaceSessionsInScope replaces only the requested project and surface', () => {
  const existing = [
    meta('old-code-a', 'C:/Work/A', 'code'),
    meta('old-partner-a', 'C:/Work/A', 'partner'),
    meta('old-code-b', 'C:/Work/B', 'code'),
  ];
  const incoming = [meta('new-code-a', 'C:/Work/A', 'code')];

  const next = replaceSessionsInScope(
    existing,
    incoming,
    { projectRoot: 'c:/work/a', surface: 'code' },
    true,
  );

  assert.deepEqual(next.map((s) => s.sessionId), ['new-code-a', 'old-partner-a', 'old-code-b']);
});

test('replaceSessionsInScope can refresh one surface across all projects', () => {
  const existing = [
    meta('old-code-a', 'C:/Work/A', 'code'),
    meta('old-partner-a', 'C:/Work/A', 'partner'),
  ];
  const incoming = [meta('new-code-b', 'C:/Work/B', 'code')];

  const next = replaceSessionsInScope(existing, incoming, { surface: 'code' }, true);

  assert.deepEqual(next.map((s) => s.sessionId), ['new-code-b', 'old-partner-a']);
});

test('sessionMatchesScope defaults legacy missing surface to code', () => {
  const legacy = { ...meta('legacy', '/p', 'code'), surface: undefined } as unknown as SessionMeta;
  assert.equal(sessionMatchesScope(legacy, { surface: 'code' }, false), true);
  assert.equal(sessionMatchesScope(legacy, { surface: 'partner' }, false), false);
});
