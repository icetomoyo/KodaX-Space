# Issue 189 / v0.1.44 Background Complete-Exit Regression Guide

## Automated checks

1. Admitted complete exit transfers the control surface to background before
   awaiting Runtime settlement and commits exit only after settlement succeeds.
2. A rejected preflight stays visible; a settlement failure remains uncommitted
   so the main process can restore the window.
3. The Windows tray exposes a dedicated `exiting` state with elapsed seconds,
   safe-cleanup wording, and automatic-exit wording.
4. Duplicate close and complete-exit commands are disabled while settlement is
   active; opening the tray surface remains available.
5. Non-macOS no-tray close policy keeps the last window for complete-exit
   coordination, and local finalization has a distinct tray presentation.
6. The renderer overlay reports elapsed time, and renderer-ready replays the
   main-owned active progress snapshot after reload or recreation.
7. `e2e/complete-exit-packaged.mjs` starts with a visible real Electron window,
   delays admitted settlement, proves that exact window transfers to a live
   background process, and then retains the existing two-lifecycle residue and
   Session-history checks.

## Windows manual acceptance

1. Start Space with no active task and request complete exit.
2. Verify preflight feedback appears immediately. After preflight admits the
   exit, the main window should hide and the tray should remain available.
3. Open the tray menu. Verify it says Runtime is being cleaned safely in the
   background, shows an increasing elapsed time, and says Space will exit
   automatically.
4. Reopen Space from the tray and verify the overlay shows the same autonomous
   safe-cleanup intent and an increasing elapsed timer.
5. Let settlement succeed. Space and all Runtime descendants must exit without
   another click. While Electron-local resources finish closing, the tray must
   remain available and change to the application-finalization phase.
6. Fault-inject settlement failure. The window must return with an actionable
   diagnostic instead of leaving an invisible background process.
7. Repeat with active work. Space must keep the foreground control surface and
   ask the user to resolve the blocker before any background transfer.

## No-tray acceptance

Disable or make the Windows tray unavailable, then repeat an idle complete
exit. Space must retain the visible overlay until settlement completes or
fails; it must never hide into an unreachable background process.
