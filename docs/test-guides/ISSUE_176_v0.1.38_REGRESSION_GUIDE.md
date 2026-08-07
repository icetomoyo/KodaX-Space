# Issue 176 v0.1.38 Regression Guide

This guide validates the v0.1.38 release path for duplicate or misplaced
newest turns during multi-Session reactivation.

## Automated checks

1. Run `node --test --import tsx apps/desktop/electron/test/session-history-paging.test.ts`.
2. Confirm `reactivating an invalidated ready page defers an in-flight canonical duplicate` passes.
3. Run `npm run typecheck` and the production smoke build.

## Manual acceptance

1. Start two or more daemon Coder Sessions and leave one producing output.
2. Switch to another Session, then return while the first Session is still running and after it
   finishes.
3. Repeat the switch after a lineage notice or another event invalidates the first Session's
   newest history page.
4. Confirm each query and answer appears once, remains attached to its own turn, and does not move
   after terminal convergence.
5. Repeat with a partial or ambiguous legacy Session. Its warning and retry behavior must remain
   visible; an old uncertain projection must not be retained as canonical authority.
6. Press Ctrl+R and confirm the transcript is identical before and after refresh.

The acceptance test must use exact repeated prompt text at least once. The fix is identity- and
state-based; it must not remove intentional duplicate user content.
