# Issue 210: beta.3 SDK integration and compaction regression guide

Release baseline: Space `0.1.46-alpha.8`; published SDK
`@kodax-ai/kodax@0.7.96-beta.3`.

## Acceptance criteria

1. `/compact` appears immediately but its IPC command starts only after the echo write and any
   already-running notice retry finish, including when the new echo returns failure or rejects.
2. Existing Session/project/surface and credential boundaries remain enforced.
3. Manual and managed compaction use scoped broker credentials; a superseded connection becomes
   reconnectably disconnected, and a newly connected client can resume its lease.
4. Windows packages load the exact SDK-bundled ASRT from physical resources. The WFP probe repair
   survives installation with `--ignore-scripts`; required native/capability versions remain unchanged.
5. Provider timeouts remain errors. They do not establish context overflow or prove a gateway cause.

## Automated checks

Run from the repository root:

```powershell
node --test --import tsx apps/desktop/renderer/src/store/appStore.local-notice.test.ts apps/desktop/electron/test/app-store-cancel-event.test.ts
node --test scripts/test/asrt-package-resources.test.mjs
npm run typecheck
npm test
npm run build:smoke
```

The notice tests hold acknowledgement with a deferred Promise, rather than relying on timing.
They cover an immediate visible echo, a retry already holding the writer, and success/error/rejection
of the new echo. Each newly covered race was observed failing before its corresponding fix.

The resource test resolves ASRT and its dependencies from the installed SDK, then compares those
paths to the physical `extraResources` inputs. The normal packaging gate must also validate the SDK
against the npm tarball and SRI. Packaged smoke rejects nested ASRT inside ASAR, compares the
physical WFP probe bytes, and exercises real SDK Workers from the archive.

## Manual regression

Use a disposable Session with enough history and a healthy Provider whose credential exists only in
Space's system keychain. Do not copy the real Space instance identity into a diagnostic client.

1. Submit `/compact`. The echo should appear promptly, followed by the Runtime compaction result.
   Reload the Session and verify that both notices and full replayable history remain consistent.
2. Repeat after several local commands. A previous echo's writer should not cause the compact
   preflight to fail with `Session data changed during the read boundary`.
3. Run a sufficiently long task to reach the SDK's effective automatic-compaction threshold.
   Verify that managed compaction succeeds without `<ENV> not set`; full transcript replay remains
   available. Use the effective threshold displayed by Runtime, not a guessed token count.
4. For broker takeover testing, use an isolated SDK home and synthetic identity/provider. Connect A,
   connect B with that same test identity, close B, and verify A receives a reconnectable disconnect.
   Reconnect and resume the lease before compressing again. This is already covered by the SDK's
   bundled daemon regression replayed against the installed npm package.
5. In the Windows candidate, verify startup reaches renderer and Runtime readiness and complete exit
   drains its isolated daemon. Sandbox doctor should be invoked directly in a host terminal or via
   Settings; actual WFP enforcement depends on the host's installed sandbox setup.

If a real Provider still reports `Request timed out`, record only redacted timestamps, operation IDs,
elapsed time and endpoint reachability. Do not repeatedly compact on the assumption of context
overflow. The local test Provider verifies integration, not that external endpoint's health.

## Verification record — 2026-09-08

- Registry tarball/SRI and installed SDK bytes: matched beta.3, including bundled dependencies.
- Full `npm test`: 3304 passed, 5 skipped, 0 failed. Subsequent focused notice regressions: 72 passed.
- SDK bundled daemon regression replayed using installed npm exports: passed manual OpenAI and
  Anthropic compaction, managed compaction, broker takeover/disconnect/resume and provider rejection.
- SDK ASRT WFP probe regressions against the installed dependency: 7 passed (native calls mocked).
- Final renderer/Electron TypeScript checks, application lint (excluding pre-existing untracked
  `scratch/`) and production build: passed.
- Windows Setup/Portable candidates in `out-beta3-verification`: built; package smoke passed exact
  ASRT bytes, native loading and real SDK Worker execution. Boot readiness passed.
- Complete exit: the first run timed out waiting for Runtime readiness on restart. An instrumented
  isolated rerun and the unchanged official script both subsequently passed two complete exits and
  persisted history restoration. The original timeout's cause remains unproven.
- Full Electron UI end-to-end suite: 79 passed, 2 skipped, 0 failed (81 tests in 37 files).
- Independent review: Standards 0 outstanding findings; Spec 0 outstanding findings. The Spec review
  found the failed-echo bypass; it was reproduced, fixed and covered by the final focused regressions.
- A healthy real Provider, live automatic threshold behavior and host WFP enforcement: manual checks
  remain; no external Provider or real user Session was modified during this upgrade.
