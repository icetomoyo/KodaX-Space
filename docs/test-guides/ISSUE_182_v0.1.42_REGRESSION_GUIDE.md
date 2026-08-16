# Issue 182 v0.1.42 Regression Guide

## Purpose

Verify that a bounded newest history page cannot pair an earlier live answer
with a later query. This guide targets the transient renderer state that
previously disappeared after Ctrl+R.

## Preconditions

- Build KodaX Space from source containing the Issue 182 fix.
- Use the exact npm Registry KodaX 0.7.88 package.
- Keep Developer Tools closed during the timing-sensitive observation unless diagnostics are needed.

## Automated gate

```powershell
node --test --test-concurrency=1 --import tsx `
  apps/desktop/electron/test/live-history-next-query-order.test.ts `
  apps/desktop/electron/test/history-replay-no-popout.test.ts `
  apps/desktop/electron/test/session-history-paging.test.ts
```

Expected: every test passes and the visible order remains interrupted A,
completed review B, then commit query C. The earlier live prefix and its event
segment must move together.

## Packaged-app scenario

1. Start a query, interrupt it after visible output, submit it again, and let
   the second Run complete with a tool call.
2. Submit a distinct third query immediately after the second Run completes.
3. Observe the conversation without switching Sessions or pressing Ctrl+R.

Expected: A remains under its query, B remains under its query, C stays below
B, no query moves, and no answer is duplicated. Ctrl+R must preserve the same
ownership and order rather than repairing a live mispairing.

## Fail-open boundary

With a canonical assistant suffix that is textually different from the live
draft, Space may retain ambiguous candidates, but it must not guess-delete
content or pair an old answer with the later query.
