# Issue 203 v0.1.46 Regression Guide

## Goal

Verify that opening a Session from another project persists that project as the
current selection, so a renderer reload or app restart restores the project the
user actually ended up working in.

## Preconditions

- A v0.1.46 build containing the Issue 203 fix.
- At least two projects in the sidebar (for example `test` and `KodaX-Space`),
  each with at least one Session.
- Note the currently selected project before starting (the sidebar highlights
  it; `localStorage['kodax-space.currentProjectPath']` mirrors it).

## Primary scenario

1. Note the current project (project A).
2. Expand project B in the sidebar and click one of its Sessions.
3. Confirm the ChipBar/working context switched to project B.
4. Reload the renderer (Ctrl+R) or quit and restart Space.

Expected:

- After the reload/restart, project B is restored as the current project.
- `localStorage['kodax-space.currentProjectPath']` points to project B.

## Safety scenarios

- Open a Session of the SAME project: the persisted value must not change.
- Open a Session from the notification toast or Task Dock (these also route
  through `setCurrentSession`): the project switch persists the same way.
- Delete the active Session: Space returns to the dashboard without changing
  the persisted project.
- Boot with a cleared `localStorage` (fresh profile): the most-recent
  `project.list` entry still wins as before (existing boot-restore behavior).

## Automated coverage

- `apps/desktop/renderer/src/store/appStoreProjectPersistence.test.ts`
  - explicit `setCurrentProject` persists (baseline behavior),
  - cross-project `setCurrentSession` persists,
  - same-project `setCurrentSession` keeps the stored value.
- `e2e/perf-real-app.mjs` exercises the real-profile end-to-end path
  (session open → reload → project state) against `~/.kodax`.
