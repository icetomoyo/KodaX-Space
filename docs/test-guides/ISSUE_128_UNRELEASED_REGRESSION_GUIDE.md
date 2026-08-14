# Issue 128 regression guide

## Automated gates

1. Run `npm exec -- tsx --test apps/desktop/electron/test/kodax-runtime-compat.test.ts apps/desktop/electron/test/kodax-sdk-probe.test.ts apps/desktop/electron/test/runtime-host-adapter.test.ts apps/desktop/electron/test/sandbox-controller.test.ts`.
2. On Windows, point `KODAX_HOME` at a dedicated temporary test home and call
   `setupKodaXSandbox()` once before `npm run build` or `npm run smoke:pack`.
   The packaged probe must report standalone sandbox version 3, execute the
   contained marker command, negotiate daemon `sandboxRuntime:3`, and release
   the daemon owner. Release CI performs this preparation explicitly.
3. Run `npm run typecheck`, `npm run lint`, `npm test`, and `npm run build`.

## Manual Windows check

1. Stop every pre-0.7.86 KodaX or Space process before the first upgraded run.
2. Start the packaged Space build, select PowerShell, and open a Coder Session
   in Auto[LLM].
3. Ask Coder to run a minimal read-only PowerShell marker command, then run a
   normal workspace command that resolves a tool from the configured PATH.
4. Confirm both commands start normally. The activity state may be
   `Sandboxed` or `Sandbox fallback`; fallback must mean normal permission
   enforcement, not that Bash or PowerShell is disabled.
5. Exit Space cleanly, immediately launch the same executable again, and run a
   third marker command. It must not fail with a framed-payload, stale ACL,
   owner-marker, or Electron/ASAR helper-path error.

Do not delete `~/.kodax` as a recovery step. A live, unreadable, or
unverifiable owner must remain visibly fail-closed.
