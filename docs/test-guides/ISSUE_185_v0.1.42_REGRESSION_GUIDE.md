# Issue 185 v0.1.42 Regression Guide

## Automated checks

1. Install exact Registry `@kodax-ai/kodax@0.7.88` and confirm
   `KODAX_RUNTIME_SDK_CAPABILITIES.actorSettlementConvergence === 2`.
2. From `apps/desktop`, run:
   `node --test --test-concurrency=1 --import tsx electron/test/composeMessages.test.ts electron/test/session-complete-notification.test.ts electron/test/app-store-runtime-projection.test.ts electron/test/coder-daemon-projection.test.ts electron/test/runtime-host-adapter.test.ts`.
3. From the repository root, run `npm run typecheck`, `npm run lint`,
   `npm test`, and `npm run build:smoke`.

## Manual regression

1. Start a Coder query and stop its Run after visible output.
2. Submit a second query in the same Session and let it complete.
3. Force history/live revalidation by switching away and back or reconnecting.
4. Confirm the old interruption stays under the stopped query.
5. Confirm the second query displays its complete answer and its completion
   notification refers to the active Run; the old terminal must not consume or
   replace the current notification record.
6. Restart Space and confirm canonical history keeps the same order.

## Compatibility regression

1. Start Space with an SDK or daemon advertising
   `actorSettlementConvergence:1`.
2. Confirm Coder startup fails with an actionable v2 compatibility message.
3. Restart with exact npm Registry KodaX 0.7.88 and confirm Coder connects normally.
