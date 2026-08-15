# Issue 183 v0.1.41 Regression Guide

## Purpose

Verify that a successful no-retry Run is rendered once when terminal canonical history overtakes
an optimistic live turn whose send acknowledgement was not retained. This is a Space renderer
identity-reconciliation issue; it does not require a KodaX SDK change.

## Automated Gate

Run:

```powershell
node --test --import tsx `
  apps/desktop/electron/test/app-store-runtime-projection.test.ts `
  apps/desktop/electron/test/history-replay-no-popout.test.ts
```

Expected: every test passes, including these boundaries:

- a daemon-shaped terminal event folds the unique unacknowledged live owner;
- a full snapshot reconciles both a completed Run and a concurrently active next Run;
- an incremental terminal change targets its completed Run rather than the active Run;
- multiple unacknowledged owners, missing same-Run content evidence, and a delayed old terminal
  remain fail-open and never claim a newer query.

## Packaged-App Scenario

1. Start a Coder query that produces at least two assistant blocks separated by tool calls.
2. Let the Run complete successfully without Provider recovery or manual retry.
3. Keep the Session open while terminal history reconciliation finishes.

Expected before Ctrl+R:

- each assistant block is visible exactly once;
- the query bubble is visible exactly once;
- tools remain between the same assistant blocks;
- a following query is not claimed by the earlier terminal Run.

4. Press Ctrl+R and reopen the same Session.

Expected after Ctrl+R: the canonical transcript has the same query, assistant, and tool ordering as
the live transcript. Reload must not be needed to remove a duplicate.

## Incident Evidence

Session `20260815_094944_bo4d9a9bb19e31` supplied the original no-retry reproduction. Its final Run
had one Runtime journal lineage, no `provider.recovery`, and one canonical copy of each assistant
block. Duplicate output existed only in the renderer's in-memory canonical/live composition and
disappeared when Ctrl+R discarded that live buffer.
