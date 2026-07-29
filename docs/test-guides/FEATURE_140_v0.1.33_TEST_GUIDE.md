# FEATURE_140 v0.1.33 Human Test Guide

## Preconditions

- Run a Windows build with the notification-area tray enabled.
- Use a disposable Space data directory or back up
  `~/.kodax/space/settings.json`.
- Have one idle Runtime case and, if available, one Runtime with active work or
  another attached client.

## 1. First close and cancellation

1. Remove only `windowCloseBehavior` from the disposable settings file, or use a
   clean profile.
2. Start Space and click the custom title-bar close button.
3. Confirm one native dialog offers **Minimize to tray**, **Quit completely**,
   **Cancel**, and **Remember my choice**.
4. Click **Cancel**.

Expected:

- The main window remains open.
- `windowCloseBehavior` is not written.
- Repeated clicks while the dialog is open do not create multiple dialogs.

## 2. One-time minimize-to-tray

1. Close the main window again.
2. Leave **Remember my choice** clear and choose **Minimize to tray**.
3. Confirm the main window and taskbar entry disappear while the tray remains.
4. Activate the tray icon and confirm Space recreates a functional window.
5. Close the window again.

Expected:

- Runtime remains available throughout.
- The close-choice dialog appears again because the choice was not remembered.

## 3. Remember minimize-to-tray

1. Enable **Remember my choice** and choose **Minimize to tray**.
2. Reopen Space from the tray and close the window again.
3. Open **Settings → Preferences → Close button behavior**.

Expected:

- The second close goes directly to the tray without prompting.
- Settings displays **Minimize to tray and keep Runtime**.
- Restarting Space preserves the preference.

## 4. Reset to ask

1. In Settings, select **Ask every time**.
2. Close the main window.

Expected:

- The native choice dialog returns.

## 5. Remember complete exit with idle Runtime

1. Ensure Runtime is idle and has no other client.
2. In the choice dialog, enable **Remember my choice** and choose
   **Quit completely**.

Expected:

- Space exits through the existing cleanup sequence.
- The idle unshared daemon stops safely.
- On the next launch, Settings displays **Quit completely** and closing enters
  complete-exit flow without the first-choice dialog.

## 6. Complete exit with blockers

1. Run each blocker independently: a Coder task, Partner task, local Workflow,
   pending permission, pending AskUser, queued prompt, external Agent task, and
   another trusted Runtime client.
2. Configure **Quit completely** and close the main window.

Expected:

- Space reports that Runtime cannot currently be stopped safely.
- Space keeps or restores a visible window and does not exit.
- Finishing/cancelling the work and retrying permits a safe complete exit.
- No path force-kills active work or another client's daemon.
- The dialog/diagnostic blocker label identifies the corresponding Space or
  Runtime work class.

## 7. Explicit tray commands and fallback

1. Reopen Space and use tray **Close Space window**.
2. Confirm the tray has no **Quit Space, keep Runtime** action.
3. Use **Quit completely**.
4. In a separate run, set `SPACE_DISABLE_TRAY=1` and close the window.

Expected:

- Explicit tray close affects only the window and does not show the preference
  dialog.
- Complete exit stops an idle daemon before Electron disappears.
- With tray disabled, last-window close enters the same complete-exit gate; no
  invisible Electron process or daemon is left behind.

## 8. macOS and Linux true exit

1. On macOS start idle Coder, then press `Cmd+Q`.
2. On Linux start idle Coder, then close the final window.
3. Repeat with active work or a second daemon client.

Expected:

- Idle single-client daemon exits together with Space.
- Active work or another client blocks Space exit and restores a visible window.
- No tray is required to regain control.

## 9. Stop failure recovery

1. Exercise an inspected-revision CAS conflict, unreadable owner state, and a
   failed fallback daemon-stop command in separate runs.
2. Request complete exit.

Expected:

- The original Space process does not disappear without replacement.
- Space relaunches once with a visible recovery warning and reconnects Runtime.
- A retry after the failure is removed can exit normally.
- A CLI result of `missing` does not permit exit while owner state still reports
  an active owner.

## 10. Crash orphan recovery

1. Start Space with a KodaX Runtime that advertises `daemonOrphanExit:1` and note
   the `coder/daemon.json` PID.
2. Force-kill only the Space main process without graceful quit.
3. With no active work or other client, wait beyond the configured Space
   auto-start grace (currently requested as 30 seconds).
4. Repeat while work is active, then let that work enter a terminal state.
5. Repeat with another trusted client attached.

Expected:

- Idle orphan exits and releases state/lock after the grace period.
- Active work is not killed; daemon exits after work becomes idle.
- Another client prevents orphan exit.
- After every accepted orphan stop, the actual PID exits and both daemon state
  and owner lock are removed. An accepted request without process termination
  fails this test.
- When Space attaches to a daemon started by another client, do not assume its
  grace is 30 seconds; verify the observed host policy instead.
