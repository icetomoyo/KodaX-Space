import assert from 'node:assert/strict';
import test from 'node:test';

import {
  sessionLoadScopeKey,
  unloadedProjectSessionRoots,
} from '../../renderer/src/shell/sidebarSessionLoading.js';

test('cross-project selection does not reload project Session scopes already settled', () => {
  const roots = ['C:\\Works\\A', 'C:\\Works\\B'];
  const loadState = {
    [sessionLoadScopeKey(roots[0]!, 'code', true)]: 'loaded' as const,
    [sessionLoadScopeKey(roots[1]!, 'code', true)]: 'loaded' as const,
  };

  assert.deepEqual(unloadedProjectSessionRoots(roots, 'code', loadState, true), []);
  assert.deepEqual(unloadedProjectSessionRoots([...roots].reverse(), 'code', loadState, true), []);
});

test('Session scope loading selects only new roots and deduplicates canonical paths', () => {
  const loadState = {
    [sessionLoadScopeKey('C:\\Works\\A', 'code', true)]: 'loaded' as const,
    [sessionLoadScopeKey('C:\\Works\\B', 'code', true)]: 'loading' as const,
    [sessionLoadScopeKey('C:\\Works\\C', 'code', true)]: 'error' as const,
  };

  assert.deepEqual(
    unloadedProjectSessionRoots(
      ['C:\\Works\\A', 'c:/works/a/', 'C:\\Works\\B', 'C:\\Works\\C', 'C:\\Works\\D'],
      'code',
      loadState,
      true,
    ),
    ['C:\\Works\\D'],
  );
  assert.deepEqual(unloadedProjectSessionRoots(['C:\\Works\\A'], 'partner', loadState, true), [
    'C:\\Works\\A',
  ]);
});
