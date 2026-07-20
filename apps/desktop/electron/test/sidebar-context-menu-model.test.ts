import assert from 'node:assert/strict';
import test from 'node:test';
import {
  clampSidebarContextMenuPosition,
  PROJECT_CONTEXT_MENU_GROUPS,
  SESSION_CONTEXT_MENU_GROUPS,
} from '../../renderer/src/shell/sidebarContextMenuModel.js';

test('project context menu exposes the supported Codex-aligned actions without archive', () => {
  assert.deepEqual(PROJECT_CONTEXT_MENU_GROUPS, [
    ['pin-project', 'open-project-folder', 'rename-project'],
    ['remove-project'],
  ]);
  assert.equal(
    PROJECT_CONTEXT_MENU_GROUPS.flat().some((id) => id.includes('archive')),
    false,
  );
});

test('session context menu groups task state, project facts, continuation, and deletion', () => {
  assert.deepEqual(SESSION_CONTEXT_MENU_GROUPS, [
    ['pin-session', 'rename-session', 'toggle-session-unread'],
    ['open-session-folder', 'copy-working-directory', 'copy-session-id'],
    ['continue-in-new-session'],
    ['delete-session'],
  ]);
  assert.equal(
    SESSION_CONTEXT_MENU_GROUPS.flat().some((id) => id.includes('archive')),
    false,
  );
});

test('context menu placement keeps every edge inside the viewport gutter', () => {
  assert.deepEqual(
    clampSidebarContextMenuPosition({
      x: -20,
      y: -10,
      menuWidth: 208,
      menuHeight: 240,
      viewportWidth: 800,
      viewportHeight: 600,
    }),
    { left: 8, top: 8 },
  );

  assert.deepEqual(
    clampSidebarContextMenuPosition({
      x: 760,
      y: 580,
      menuWidth: 208,
      menuHeight: 240,
      viewportWidth: 800,
      viewportHeight: 600,
    }),
    { left: 584, top: 352 },
  );
});
