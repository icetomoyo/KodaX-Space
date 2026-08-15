# Issue 182 v0.1.41 Regression Guide

## Purpose

Verify that a bounded newest history page cannot pair an earlier live answer with a later query.
This guide targets the transient renderer state that previously disappeared after Ctrl+R.

## Preconditions

- Build KodaX Space from source containing the Issue 182 fix.
- Use KodaX 0.7.87, matching the v0.1.41 baseline.
- Keep Developer Tools closed during the timing-sensitive observation unless diagnostics are needed.

## Automated Gate

Run:

```powershell
node --test --test-concurrency=1 --import tsx `
  apps/desktop/electron/test/live-history-next-query-order.test.ts `
  apps/desktop/electron/test/history-replay-no-popout.test.ts `
  apps/desktop/electron/test/session-history-paging.test.ts
```

Expected: every test passes. The dedicated regression must retain the exact visible order:

1. interrupted review query and its partial answer;
2. restarted review query, tool receipt, and completed answer;
3. commit query and completed answer.

## Packaged-App Scenario

1. Open a Session with enough history that its newest conversation page begins inside an assistant
   turn rather than at that turn's user query.
2. Start a query, interrupt it after visible assistant output, then submit the same query again and
   let the second Run complete with at least one tool call.
3. Submit a distinct third query immediately after the second Run completes.
4. Observe the conversation without switching Sessions or pressing Ctrl+R.

Expected:

- the interrupted output remains under the first query;
- the successful tool and answer remain under the second query;
- the third query stays below the complete second answer;
- no query bubble moves while later events arrive;
- no answer appears twice.

5. Press Ctrl+R after recording the live order.

Expected: the canonical post-refresh transcript has the same query/answer ownership and order as the
live transcript. A refresh may replace provisional interrupted details with canonical history, but
it must not repair any owner/answer mispairing because no such mispairing should be present.

## Fail-Open Boundary

Repeat with a canonical assistant suffix that is textually different from the retained live draft
(for example, a bounded or recovery-normalized representation).

Expected: Space may conservatively retain both ambiguous candidates, but every old candidate stays
before the later query. It must not guess-delete content or pair an old answer with the later query.
