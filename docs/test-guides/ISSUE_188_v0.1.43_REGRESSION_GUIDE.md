# Issue 188 / v0.1.43 Complete-Exit Recovery Regression Guide

## Automated checks

Run the Runtime host adapter and startup recovery tests, Electron TypeScript
check, package smoke syntax check, and the KodaX 0.7.91 settlement suites.

Required assertions:

1. Active daemon work returns `keep-open`; Space keeps the Runtime projection
   ready and does not close or relaunch.
2. Production complete exit delegates stop, containment verification, and
   repair to the SDK exactly once.
3. A recovery relaunch calls settlement before owner reconciliation or daemon
   initialization.
4. `clean/recovered` exits, `keep-open` starts normally, and every other block
   prevents replacement-owner startup while leaving a visible diagnostic.
5. The packaged SDK exports `runtimeExitSettlement:1` and
   `settleKodaXRuntimeExit`, and the packaged lifecycle probe returns `clean`.
6. Existing complete-exit other-client, active-work, timeout, and relaunch tests
   remain green.
7. The public SDK settlement type exposes no host-controlled timeout. The
   packaged lifecycle smoke requires both initial and restarted daemons to
   return exactly `clean`; KodaX's CLI cleanup regression test supplies the
   deterministic memory-review drain beyond the former generic phase cap.
8. When Runtime initialization failed, Space reconnects management with
   `autoStart:false`, settles the existing daemon, and leaves no temporary
   Runtime client behind.
9. A timed-out prepared stop is retried with a fresh attempt identity; transport
   loss cannot schedule a replacement while settlement is active, and a late
   draining transition is captured by one no-Runtime re-scan.
10. A Runtime close singleflight that remains pending after SDK settlement is
    never awaited again by the adapter or allowed to hide `clean/recovered`.
11. `node e2e/complete-exit-packaged.mjs` launches the hidden packaged app,
    executes the real complete-exit product path twice, verifies the exact
    daemon/Job owner and lifecycle files disappear, then proves the same Coder
    Session history reloads without `runtime_unavailable`.

## Windows manual acceptance

1. Start Space and open a historical Coder Session; verify its content loads.
2. With no active Space task, request complete exit and fault-inject a Runtime
   close failure after stop acceptance.
3. Verify Space relaunches visibly and does not start a replacement daemon
   before recovery.
4. When exact Job/ACL evidence is recoverable, verify Space finishes exiting.
   Restart Space normally and confirm the Session content loads.
5. Repeat with active work, a foreign ACL marker, and a simulated reused PID.
   Active work must keep Space open; the latter two must remain blocked without
   killing a process or deleting residue.
6. After every test, verify no Space instance launched by the test remains
   running.

## macOS/Linux acceptance

Verify an orderly complete exit returns `clean`. Fault-inject a stuck retained
daemon and verify the app remains/relaunches visibly with no PID/PGID signal
from the relaunched host. Reboot without deleting the ticket or profile, launch
Space normally, and verify changed-boot recovery completes before Session
history becomes available.
