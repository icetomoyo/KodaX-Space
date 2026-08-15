# Issue 184 v0.1.41 Regression Guide

## Automated Regression

From the repository root, run:

```powershell
node --import tsx --test apps/desktop/electron/test/coder-daemon-projection.test.ts
node --import tsx --test apps/desktop/electron/test/runtime-host-adapter.test.ts
```

Expected: every test passes. In particular:

- cumulative assistant and thinking text from an earlier root turn is not assigned to the active
  root turn of the same managed Run;
- a root `turn.started` resets the previous turn's live state even when `run.updated` already
  advertises the new `turnId`;
- transient child turn starts do not reset the root projection;
- payload-only root `turn.started` identities cross the live bridge while payload-only child turns
  remain isolated;
- missing identity (including an active Run without `turnId`), future, foreign-epoch, malformed, or
  unavailable current-root replay boundaries keep the observation usable but do not publish an
  unscoped Run-cumulative draft as the identified current turn.

## Packaged-App Scenario

1. Start one managed Coder Run and let it produce a visible answer.
2. Send an interrupt follow-up, let that root turn produce output, then send another interrupt
   follow-up without starting a separate Run.
3. While the third root turn is streaming, verify that every earlier answer stays above its own
   query and only the third turn's draft appears after the latest query.
4. Press Ctrl+R or switch away and back while the third turn is active.

Expected:

- the active draft remains scoped to the latest root turn before and after reload;
- no prior answer moves to the transcript tail;
- child-agent activity does not clear or replace the root draft;
- if the Session reports ambiguous persisted history after automatic compaction, retain the raw
  audit data and escalate the KodaX canonical-boundary requirement documented in Issue 184. Space
  must not guess-delete or content-deduplicate the ambiguous records.
