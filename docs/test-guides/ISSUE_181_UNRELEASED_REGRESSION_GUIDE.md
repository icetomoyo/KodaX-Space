# Issue 181 — Provider Recovery Duplicate Output Regression Guide

## Automated gates

1. Run the Provider recovery projection and renderer regressions:
   `node --test --test-concurrency=1 --import tsx apps/desktop/electron/test/coder-daemon-projection.test.ts apps/desktop/electron/test/composeMessages.test.ts apps/desktop/electron/test/history-replay-no-popout.test.ts`.
2. Run the daemon bridge and active-observation regressions:
   `node --test --test-concurrency=1 --import tsx apps/desktop/electron/test/runtime-host-adapter.test.ts`.
3. Run the renderer invalidation/reconnect regressions:
   `node --test --test-concurrency=1 --import tsx apps/desktop/electron/test/app-store-runtime-projection.test.ts`.
4. Run `npm test --workspace @kodax-space/space-ipc-schema`, `npm run typecheck`,
   `npm run lint`, and `npm run build:smoke`.

The gates must prove that replacement recoveries discard only the provisional
assistant/thinking attempt; completed output and tool receipts remain visible;
fresh-connection retries and manual continuation do not clear drafts; malformed
or child recovery events cannot enter the root transcript; and reconnect replay
does not apply events beyond the observation cursor, discard a retained stable
prefix, or make a healthy observation depend on supplemental replay succeeding.

## Manual packaged-app regression

1. Start a Coder conversation in daemon mode with a Provider/model that streams
   output. Use diagnostic fault injection or a controlled test Provider to make
   the first attempt emit visible text and then trigger `stable_boundary_retry`.
2. While recovery is in progress, confirm the abandoned text disappears. When
   the replacement succeeds, confirm only the replacement answer is visible.
3. Repeat with `non_streaming_fallback` and with a thinking-content sanitization
   recovery. Confirm only the replacement assistant/thinking content remains.
4. During an active recovered run, switch away from the Session and back, or
   restart the daemon connection. Confirm the transcript remains single-copy.
5. Press Ctrl+R after completion. Confirm the visible answer is unchanged and
   still appears exactly once.
6. Send a prompt that intentionally produces repeated identical text without a
   Provider recovery. Confirm the repetition is preserved.

Do not validate this issue by manually deleting Runtime state. The acceptance
criterion is parity among live display, reconnect hydration, terminal history,
and Ctrl+R while using the same Session journal.
