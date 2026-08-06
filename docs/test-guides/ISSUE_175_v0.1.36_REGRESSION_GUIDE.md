# Issue 175 safe-close regression guide

## Automated checks

1. Run
   `node --test --import tsx apps/desktop/electron/test/complete-exit-policy.test.ts apps/desktop/electron/test/runtime-host-adapter.test.ts`.
2. Run `npm run typecheck`.
3. Build against a KodaX source/package that advertises
   `KODAX_RUNTIME_SDK_CAPABILITIES.daemonShutdownVerification === 1`.

## Manual acceptance on Windows

1. Start Space in daemon Coder mode and run commands that create several shell or MCP child
   processes. Let the Run finish.
2. Close Space once. The progress surface must remain visible while cleanup is being verified; it
   must not disappear and later reappear with a warning.
3. On verified cleanup, Space must close and the daemon plus its containment supervisor must be
   gone.
4. Inject or reproduce a durable cleanup failure. Space must remain visible. Choosing Keep Open
   after Runtime control has closed must relaunch Space; it must not reopen Coder admission inside
   the invalid process generation.
5. Let a daemon-backed Coder Run finish, confirm Runtime reports no active/queued work, then close
   Space immediately. A stale local stream cleanup flag must not produce a false “cannot close
   safely” prompt on the first attempt. Partner/Embedded work and unavailable Runtime authority
   must still block conservatively.
6. Repeat close with many completed Sessions. Listener warnings and old managed-child records must
   not make verified daemon shutdown fail.
7. Repeat while Space has no ready Runtime connection but the daemon owner file is present. Space
   must verify the exact owner captured before CLI stop; a legacy uncontained owner or an
   owner-less CLI success must stay fail-closed instead of being accepted as a safe exit.

This guide does not validate KodaX Worker-owned child leases, and it does not exercise Session
history/rendering paths because the implementation adds no work to those paths.
