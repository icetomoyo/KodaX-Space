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

1. Start a long-running task or attach another trusted Runtime client.
2. Configure **Quit completely** and close the main window.

Expected:

- Space reports that Runtime cannot currently be stopped safely.
- Cancelling keeps Space open.
- Choosing **Quit Space, keep Runtime** exits Electron but preserves the work
  and daemon.
- No path force-kills active work or another client's daemon.

## 7. Explicit tray commands and fallback

1. Reopen Space and use tray **Close Space window**.
2. Reopen and use tray **Quit Space, keep Runtime**.
3. In a separate run, set `SPACE_DISABLE_TRAY=1` and close the window.

Expected:

- Explicit tray close affects only the window and does not show the preference
  dialog.
- Explicit keep-Runtime exit preserves the daemon regardless of the close
  preference.
- With tray disabled, ordinary quit-on-last-window behavior remains; no
  invisible Electron process or unusable prompt is left behind.
