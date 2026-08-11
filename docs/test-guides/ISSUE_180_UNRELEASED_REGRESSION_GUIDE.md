# Issue 180 — Stale Inline Owner Startup Recovery Guide

## Automated gates

1. Run the targeted owner-policy tests:
   `node --test --test-concurrency=1 --import tsx --test-name-pattern "daemon startup delegates stale owned inline recovery|daemon startup stays fail-closed|adapter close" apps/desktop/electron/test/runtime-host-adapter.test.ts`.
2. Run `npm run typecheck` and `npm run lint`.

The tests must prove that Space delegates an owned inline snapshot to the SDK,
continues only after SDK success, blocks Runtime construction after SDK
rejection, retries transient inline release conflicts, and retains both the
inline handle and Runtime close target when either close operation must retry.

## Manual macOS regression

1. Use a build containing the matching fixed KodaX SDK.
2. Leave the `coder` profile in Embedded mode, then terminate Space without
   normal inline-owner cleanup.
3. Select/start Daemon mode for the same profile.
4. Confirm Coder reaches ready without deleting `~/.kodax`, and confirm prior
   sessions and provider configuration remain available.
5. Repeat with a genuinely live Embedded owner. Daemon startup must fail with
   an owner diagnostic and must not start a competing Runtime.

Never use deletion of the whole `~/.kodax` directory as the regression step;
that bypasses the recovery protocol and removes unrelated customer data.
