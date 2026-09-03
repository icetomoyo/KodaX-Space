# Issue 202 v0.1.46 Regression Guide

## Goal

Verify that a completed Run with parallel tools renders once after canonical history replaces the
live projection, while Runtime-only diagnostics remain available.

## Preconditions

- Use a v0.1.46 development build containing the Issue 202 fix.
- Attach to a managed Coder Runtime with conversation history v2 and managed Run durability.
- Open a project where two read-only tools can run in parallel.

## Primary scenario

1. Submit one prompt that causes two independent tools to start concurrently.
2. While the Run is active, confirm that the query appears once and both tool cards update.
3. Wait for the Run terminal event and the automatic history reconciliation to finish.
4. Switch to another Session and back, then reload the renderer once.

Expected:

- The submitted query appears exactly once at every stage.
- Each tool appears exactly once after settlement.
- After settlement, tool-card order is stable across Session switching and reload.
- The final assistant response appears exactly once.
- No abandoned output-segment text or stale running state reappears.

## Failure and diagnostics scenario

1. Run a prompt whose Provider produces partial output and then a terminal error.
2. Wait for canonical history reconciliation.

Expected:

- The query appears once.
- Persisted partial assistant content appears once.
- The exact Runtime error remains visible once.
- Provider recovery, sandbox, or other activity diagnostics remain available when emitted.

## Safety scenarios

- Load history while the Run is still active: live output must not be destructively removed.
- Load a partial or ambiguous history projection: both uncertain projections remain fail-open.
- Deliver two user inputs in one Runtime turn: each `(turnId, turnUserOrdinal)` stays distinct.
- Reconcile a history read associated with another Run: the current live projection remains.
- Repeat the same prompt intentionally in a later Run: both real turns remain visible.

## Automated coverage

- `apps/desktop/electron/test/history-replay-no-popout.test.ts`
- `apps/desktop/electron/test/session-history-paging.test.ts`
