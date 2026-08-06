# Issue 175 v0.1.37 Regression Guide

This guide revalidates the safe-close and multi-Session recovery boundary in
the v0.1.37 release candidate, using exact KodaX 0.7.83 bytes.

## Automated checks

1. Run
   node --test --import tsx apps/desktop/electron/test/complete-exit-policy.test.ts apps/desktop/electron/test/runtime-host-adapter.test.ts apps/desktop/electron/test/history-replay-no-popout.test.ts.
2. Run npm run typecheck.
3. Run the full npm test suite and confirm the installed KodaX compatibility
   test reports 0.7.83.

## Manual acceptance

1. Start Space in daemon Coder mode and create several Sessions in the same
   project. Switch Sessions while one has completed output and another has
   active work.
2. Restore a persisted Session and page its history. The newest canonical
   window must appear first; older pages must prepend without moving content
   across Sessions.
3. Deliver a late snapshot or Runtime event from another Session. It must not
   hide activity, duplicate output, or change the active Session's transcript.
4. Let a daemon-backed Coder Run finish, then close Space immediately. The
   progress surface must remain visible while shutdown is verified; it must not
   disappear and later reappear with a warning.
5. Inject or reproduce a durable cleanup failure. Space must remain visible.
   Choosing Keep Open must relaunch through a controlled recovery path and must
   not reopen Coder admission inside an invalid process generation.
6. Repeat close with many completed Sessions and with no ready Runtime
   connection but a daemon owner file present. The exact captured owner must be
   verified; an owner-less or legacy uncontained success stays fail-closed.

This guide does not validate KodaX Worker-owned child leases or claim the
remaining F138 native-resource OS isolation work.
