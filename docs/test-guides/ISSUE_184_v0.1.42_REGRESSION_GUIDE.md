# Issue 184 v0.1.42 Regression Guide

## Purpose

Verify that a continued managed Run scopes live assistant/thinking drafts to
the current root turn and does not hide an ambiguous canonical compaction by
guessing an order.

## Automated regression

```powershell
node --import tsx --test apps/desktop/electron/test/coder-daemon-projection.test.ts
node --import tsx --test apps/desktop/electron/test/runtime-host-adapter.test.ts
```

Expected: old root-turn text is not assigned to the current root turn; a new
root `turn.started` resets the previous draft even after `run.updated`; child
turns remain isolated; missing, future, foreign-epoch, malformed, or
unavailable boundaries omit an unscoped cumulative draft.

## Packaged-app scenario

1. Start one managed Coder Run and let it produce a visible answer.
2. Send two interrupt follow-ups without starting a separate Run.
3. While the third root turn streams, verify that prior answers remain above
   their own queries and only the third draft appears after the latest query.
4. Switch away and back or press Ctrl+R.

The active draft remains scoped to the latest root turn. If canonical history
reports an ambiguous compaction boundary, retain audit data and escalate the
KodaX requirement; do not guess-delete or content-deduplicate records.
