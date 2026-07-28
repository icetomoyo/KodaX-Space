# FEATURE_141 v0.1.33 Human Test Guide

## Preconditions

- Use a disposable Space profile, or back up `~/.kodax/space/settings.json`.
- Have one idle Daemon case and one long-running Coder task available.
- If possible, prepare a second trusted KodaX client attached to the same Coder profile.
- Use a package built with exact npm Registry `@kodax-ai/kodax@0.7.77`; a local SDK link is not
  valid release evidence.

## 1. Default Daemon presentation

1. Start Space with a clean profile and `KODAX_SPACE_RUNTIME_HOST` unset.
2. Open **Settings → Runtime → Coder runtime mode**.

Expected:

- **Daemon** is selected and marked **Recommended**.
- **Daemon** is also marked **Current**; selecting Embedded moves only the radio selection until the
  switch succeeds.
- **Embedded** is marked **Compatibility**.
- The panel tells customers that Embedded is the fallback when Daemon mode has a problem.
- **Switch and restart** is disabled until a different mode is selected.

## 2. Daemon to Embedded

1. Ensure no Space task or other Runtime client is active.
2. Select **Embedded** and click **Switch and restart**.
3. Wait for Space to restart, then reopen the Runtime settings.
4. Run a simple Coder prompt.

Expected:

- Space performs the daemon safety check, restarts automatically, and selects **Embedded**.
- `~/.kodax/space/settings.json` contains version `3` and
  `"coderRuntimeMode": "embedded"`.
- Coder remains usable without a competing daemon owner.

## 3. Embedded to Daemon

1. Select **Daemon** and click **Switch and restart**.
2. Wait for Space to restart and reopen the Runtime settings.
3. Run a simple Coder prompt.

Expected:

- Space releases the inline owner, restores daemon policy, and restarts.
- Settings selects **Daemon** and Coder attaches to the shared Runtime.
- No stale inline owner remains.

## 4. Active Space task blocks switching

1. Start a long-running Coder task.
2. While it is running, open Runtime settings, select the other mode, and click
   **Switch and restart**.

Expected:

- Space remains open and reports that the active task must finish or stop first.
- The persisted mode and current owner do not change.
- The task is not cancelled or force-stopped.

## 5. Other client or pending work blocks Daemon stop

1. In Daemon mode, attach another trusted client or create pending Runtime work.
2. Attempt to switch to Embedded.

Expected:

- The daemon safety gate refuses the transition.
- Space explains that Coder is still in use or ownership cannot be verified.
- Neither settings nor owner policy is partially changed.

## 6. Daemon startup failure fallback

1. In a disposable environment, make the Daemon connection fail without
   creating active work.
2. Start Space, open Runtime settings, and switch to Embedded.

Expected:

- The settings page remains available despite Daemon initialization failure.
- Space uses the safe CLI/owner gate, saves Embedded, and restarts.
- Coder works in Embedded mode after restart.

## 7. Persistence and legacy migration

1. Restart Space several times in each selected mode.
2. Test a version `2` settings file once with
   `KODAX_SPACE_RUNTIME_HOST=legacy`, then restart after version `3` is written
   with the environment changed to `runtime`.
3. Remove `settings.json` in the disposable profile, start once with
   `KODAX_SPACE_RUNTIME_HOST=legacy`, then restart with the environment unset.

Expected:

- The explicit version `3` preference survives every restart.
- The old environment value seeds the one-time migration only.
- A missing file is created as version `3` on the first launch and remains
  `embedded` after the environment is removed.
- Once version `3` exists, the Settings preference wins over the environment.

## 8. Bilingual copy

1. Repeat the settings check in English and Simplified Chinese.

Expected:

- Both locales describe Daemon as recommended, Embedded as the compatibility
  fallback, automatic restart, and active-work safety.
- Customer-facing copy never exposes the internal `legacy` host name.
- A partial-recovery error does not claim that no mode was saved; it tells the
  customer to confirm the selected mode after Space reopens.

## 9. Double recovery failure

Run the focused coordinator and Runtime-owner tests with daemon policy enable
and inline-owner reacquisition both faulted.

Expected:

- Space schedules a recovery restart even if restoring the Embedded preference
  also fails.
- New Coder create/resume/send/queue admissions remain rejected until restart.
- An Embedded send with no verified inline owner rejects before it reports
  acceptance.

## 10. Admission has no executable side door

Hold one already-admitted Coder operation open, request a mode switch, and while
the switch is draining attempt each Runtime-touching path:

- Session list/create/send/history/mutation;
- Slash discovery or execution;
- Workflow list/start/rerun/resume/pause/stop;
- Runtime External Agent list/control/start/sendInput;
- MCP tools/reload and Runtime-affecting Settings changes.

Expected:

- each new operation is rejected with the bounded switching/restarting error;
- none reaches the Runtime or acquires an Embedded owner;
- Space-only diagnostics remain available;
- after an ordinary failed switch whose owner was safely restored, admission
  reopens; after a successful or recovery-restart transition, it stays closed
  until the new Space process starts.

## 11. Complete active-work blockers

Attempt a switch separately while each of the following exists:

- one running ManagedSession;
- one paused Workflow;
- one non-terminal Runtime External Agent task;
- one pending permission request;
- one pending AskUser request; and
- one queued, not-yet-dispatched Coder prompt.

Expected:

- every case blocks the switch before owner mutation;
- ending only that case allows the next safety check to proceed; and
- unknown External Agent state fails closed.

## 12. Startup owner reconciliation

In a disposable profile, simulate a process interruption after the Daemon
preference is saved but before daemon owner policy is restored.

Expected:

- the next launch repairs an unowned inline policy before connecting to Runtime;
- an active or unreadable inline owner fails closed rather than starting a
  second owner; and
- a reconnect advertises the current Space version `0.1.33`.

## 13. Packaged Daemon and Embedded boot

1. Run the production build after the exact supporting Registry SDK is pinned.
2. Launch the generated unpacked application in Daemon mode and send one Coder
   prompt.
3. Switch to Embedded through Settings, let Space restart, and send another
   prompt.
4. Switch back to Daemon and repeat.

Expected:

- both modes start from the packaged executable and complete a real Coder turn;
- both directions restart once and preserve the selected mode;
- Partner stays embedded-inline throughout; and
- no JavaScript main-process dialog reports missing `get-tsconfig`,
  `better-sqlite3`, or another packaged dependency.

## 14. Packaged dependency evidence

Confirm the build log proves:

- root/desktop manifests, both lock views, installed SDK version, Registry
  tarball URL, and integrity are exact and equal;
- no KodaX development marker, symlink, junction, or realpath escape remains;
- every public KodaX facade imports;
- Node ancestor resolution finds the complete transitive dependency closure;
- native `.node` bytes are under `app.asar.unpacked`;
- packaged Electron-as-Node loads `better-sqlite3` and executes a `:memory:`
  query; and
- the actual unpacked application reaches its boot-smoke ready signal.

Any missing item blocks the release.
