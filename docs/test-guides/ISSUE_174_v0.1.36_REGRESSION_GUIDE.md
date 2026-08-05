# Issue 174 v0.1.36 Regression Guide

## Purpose

Verify that active Session persistence and input admission cannot race in a
way that restores a draft after a successful interrupt or after-turn send.
Also verify the adjacent history/live identity and cross-Session recovery
guards shipped in v0.1.36.

## Preconditions

- Use a clean v0.1.36 build with exact KodaX 0.7.82.
- Configure a working Provider and open one project.
- Use Coder in the recommended Daemon mode.
- Keep DevTools closed for the ordinary user path; use the diagnostics export
  only when a failure needs evidence.

## Cases

### 1. Interrupt followed by a new input

1. Send a prompt that produces a visibly long response.
2. Interrupt it while text is streaming.
3. Immediately send a second prompt several times in quick succession.
4. Confirm the interrupted response remains attached to its original query,
   the second prompt is not restored as a draft, and the composer remains
   usable after the run settles.

Expected: no raw `session_data_changed`, `HANDLER_ERROR`, stale-run send
failure, duplicate assistant answer, or shifted query/answer pairing.

### 2. After-turn send at the persistence boundary

1. Finish a normal Coder turn.
2. Before the UI finishes settling, send the next prompt.
3. Repeat after switching away from and back to the Session.

Expected: the new input is admitted for the current Session only; the prior
answer stays above it and the composer does not regain an already accepted
draft.

### 3. Session switching and history paging

1. Open two Sessions in the same project.
2. Start work in Session A, switch to Session B while events are active, then
   scroll older history in B.
3. Return to A and verify the live transcript, activity state, and sidebar row.

Expected: B never displays A's live text or activity; A resumes from its own
source revision and cursor; stale pages do not reorder or duplicate turns.

### 4. Reconnect and stale snapshot recovery

1. With an active Session, close/reopen the Space window or force a Runtime
   reconnect through the supported recovery path.
2. Return to the active Session while a response is still settling.

Expected: the current Session's run/turn identity is preserved, stale snapshots
cannot hide the spinner or Stop control, and a missing identity is shown as an
uncertain state rather than inferred as completed.

## Evidence to record

- Space version and KodaX SDK version from Settings → Runtime.
- Session ID, run ID, and turn ID only; never copy prompts, credentials, or
  tool payloads into a bug report.
- Whether the issue reproduces after one retry and after a fresh app restart.
- A redacted diagnostics bundle if the issue remains reproducible.
