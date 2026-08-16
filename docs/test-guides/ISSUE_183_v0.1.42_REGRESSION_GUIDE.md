# Issue 183 v0.1.42 Regression Guide

## Purpose

Verify that a successful no-retry Run is rendered once when canonical history
overtakes an optimistic live turn whose send acknowledgement was not retained.
This is a Space renderer identity-reconciliation issue and requires no SDK
change beyond the v0.1.42 compatibility boundary.

## Automated gate

```powershell
node --test --import tsx `
  apps/desktop/electron/test/app-store-runtime-projection.test.ts `
  apps/desktop/electron/test/history-replay-no-popout.test.ts
```

Expected: exact Run/Turn owners fold once; anonymous owners, missing causal
evidence, canonical revalidation races, and delayed old events remain fail-open.

## Packaged-app scenario

1. Start a Coder query producing two assistant blocks separated by tools.
2. Let it complete without Provider recovery or manual retry.
3. Keep the Session open while terminal history reconciliation finishes.

Before Ctrl+R, each assistant block, the query, and the tools must appear once.
A following query must not be claimed by the earlier terminal Run. After Ctrl+R
the canonical transcript must retain the same ownership and order.
