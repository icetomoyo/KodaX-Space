# FEATURE_143 v0.1.35 Human Test Guide

## Preconditions

- Install the exact published `@kodax-ai/kodax@0.7.80` dependency and verify
  `KODAX_ASRT_VERSION` is `0.0.65`.
- Use an unpackaged or packaged Space build whose startup SDK probe succeeds.
- For the Windows setup-required cases, use a disposable test machine or VM
  where the one-time KodaX sandbox account/network policy has not been
  provisioned. Do not remove a working sandbox account from a production
  machine solely to exercise this guide.
- Keep a second run with an already-ready Windows sandbox, or the current
  machine if `doctorKodaXSandbox({ refresh: true })` reports `ready`.
- Run the macOS and Linux cases on their native platform when release
  candidates are available. Injected unit tests are not a substitute for final
  cross-platform package acceptance.

## Readiness and side-effect boundary

1. Launch Space and open **Settings → Runtime → Command sandbox (ASRT)**.
2. Confirm the section shows ASRT version, platform, backend, checked time, a
   readiness badge, bounded diagnostics, setup guidance, and the F138 boundary.
3. Close and reopen Settings, then use **Refresh** several times. Confirm these
   reads do not open UAC, create an account, install a dependency, or run a
   package manager.
4. Confirm the capability row exposed by `space.version` agrees with the
   detailed status: ready is doctor-confirmed, setup-required is blocked, and
   unavailable never claims containment.
5. Disconnect or make doctor fail in a disposable fixture. Confirm the UI
   reports a retryable generic failure/unavailable state and does not display
   raw exception text, credentials, usernames, absolute paths, UNC paths,
   `~` paths, environment-variable paths, or file URIs.
6. With a screen reader, refresh the section and trigger a fixture error.
   Confirm readiness updates are announced politely, failures are announced as
   alerts, and the controls expose their busy/disabled state.

## Explicit Windows setup

1. On a Windows setup-required machine, confirm **Set up sandbox** appears only
   after doctor reports `setupRequired:true`.
2. Click **Set up sandbox**. Confirm Space first shows an in-app explanation
   that setup is explicit, may request one-time UAC, and does not require
   launching Space or the terminal as Administrator.
3. Cancel the in-app confirmation. Confirm no UAC prompt appears and readiness
   remains retryable.
4. Confirm again, then decline UAC. Confirm the UI reports cancellation without
   claiming success and a subsequent refresh remains available.
5. Repeat and approve UAC. Confirm exactly one elevation prompt/activation is
   attempted, Space re-runs doctor, and success is shown only after the fresh
   doctor result is ready.
6. Double-click or invoke the action twice from an automation fixture using the
   same observed revision. Confirm only one activation runs and the stale
   request is rejected.
7. Change readiness from a second process between display and confirmation.
   Confirm the revision mismatch fails closed and asks for a fresh review
   instead of performing setup against stale state.

## macOS and Linux guidance-only behavior

1. On macOS with a missing dependency, confirm the section shows Seatbelt /
   `sandbox-exec` guidance and a safe ripgrep install command.
2. Confirm no setup button, sudo execution, Homebrew invocation, or automatic
   installation occurs.
3. On Linux with missing dependencies, confirm the section explains
   bubblewrap, socat, and ripgrep and tells the user to use the supported host
   package manager.
4. Confirm no setup button, sudo execution, apt/dnf/pacman invocation, or
   automatic installation occurs.
5. Install dependencies outside Space, refresh, and confirm readiness changes
   only after doctor verifies the backend.

## Failure, compatibility, and rollback

1. Inject a malformed capability, doctor result, diagnostics array, guidance
   array, and activation result one at a time. Confirm each fails closed with a
   bounded generic state or fixed error and never leaks the malformed value.
2. Make the SDK loader fail once with a path-bearing error, then recover.
   Confirm the first result is a fixed generic error and a later refresh retries
   the loader successfully.
3. Return `activation.status: unavailable` or `cancelled`, then make the fresh
   doctor report ready. Confirm the final doctor is authoritative and the UI
   does not show a contradictory unavailable readiness result.
4. Return `activation.status: ready` while fresh doctor is unavailable.
   Confirm Space reports unavailable and never infers readiness from activation
   status alone.
5. Launch with a KodaX package that fails the sandbox facade probe. Confirm the
   renderer is not released as a compatible application surface; do not fall
   back to a lower-level setup API.
6. To roll back F143 at the product layer, remove the three sandbox IPC
   registrations and Runtime settings section while retaining the existing
   fail-closed KodaX sandbox probe/command behavior. Confirm ordinary commands
   still never auto-run setup.

## Automated evidence

- Strict, bounded IPC contract and explicit confirmation/revision:
  `packages/space-ipc-schema/test/sandbox.test.ts`
- Controller caching, refresh, zero-activation reads, Windows-only setup,
  cancellation, stale revision, serialization, fixed error projection,
  malformed SDK data, path-safe guidance, and doctor-authoritative outcomes:
  `apps/desktop/electron/test/sandbox-controller.test.ts`
- Published KodaX facade and side-effect-free shape probe:
  `apps/desktop/electron/test/kodax-sdk-probe.test.ts`
- Real 0.7.80 doctor result and shared `space.version` projection:
  `apps/desktop/electron/test/sandbox-ipc-integration.test.ts`
- Settings readiness and refresh desktop smoke:
  `tests/e2e/settings-modal.spec.ts`
- Packaged helper/facade verification:
  `scripts/smoke-pack.mjs`
