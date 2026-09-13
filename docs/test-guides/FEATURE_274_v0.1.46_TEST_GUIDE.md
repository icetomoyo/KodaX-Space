# Space / KodaX 0.7.96-rc.2 alignment

Baseline: Space 0.1.46-alpha.11 source, exact Registry SDK 0.7.96-rc.2. Scope is the
beta.7–rc.2 increment applicable to Space, not every previously planned SDK UX.

## Acceptance requirements

- Owners advertising `sessionCancellation:1` use one
  `sessions.cancel({ sessionId, expectedRunId, requestId })` operation. The SDK owns its durable queue frontier; later submissions survive.
  Transport retries retain the same identity and binding. After the active Run
  becomes terminal, rc.2 replays accepted requests or atomically rejects a stale
  first request with `conflict / stale_run / retryable:false`. Space treats that
  exact rejection as a settled no-op and never substitutes a successor.
  No client acceptance ledger or preliminary Run-status check is required.
  Preserve every returned receipt, and never present an unknown outcome as stopped.
  Narrow Run cleanup, redirection and forced-exit ownership retain `runs.abort`.
- Resolve extension commands from the owner catalog. Canonical names and aliases
  route to `extension_command__<name>` using `toolInvocation`; `!command` routes
  to `bash` with the original command text. Both use ordinary Run settings,
  credentials, permissions, events, history, cancellation and operation identity.
  No model guesses dispatch and no ungoverned local-process fallback is allowed.
  Space currently requires an idle Session for explicit commands, as for Skills;
  the Runtime remains authoritative if another client races admission.
- Validate connected capabilities. The rc.2 daemon exposes `runLifecycleControl`
  but still omits `sessionCancellation`; its public Session Stop guard rejects
  the call. Preserve the existing exact-Run `runs.abort` fallback in this mode,
  including terminal receipt retries. This fallback does not cancel queued Runs.
- `/repair-identity <source-entry> <target-entry> <revision> <run> <input> <event>
<confirmation-ref>` is an explicit Coder repair operation. Forward the original
  delivery proof and expected revision; the SDK validates and audits them. Never
  infer an alias from text/time or retry a changed revision automatically. Clear
  Space's history cache after success; reloading displays the canonical history.
- Preserve permission authority v6, native text/image results, local-execution
  error facts, interrupt provenance and large-metadata paging from the SDK.

## SDK boundary and corrected scope

rc.2 fixes the stale first-request race inside the existing cancellation API.
The rc.1 proposal to require a new replay-only or request-status API is withdrawn.
Space persists the original request identity in the renderer for transport retries;
the owner alone determines whether that request was accepted.

A real isolated rc.2 daemon probe reports `sessionCancellation: null` (absent)
and `runLifecycleControl.version:1`. Calling its public `sessions.cancel` returns
`client_upgrade_required` before request delivery. Thus the embedded SDK fix is
verified, but it does not make daemon Session-frontier Stop usable by Space.
Space retains its exact-Run fallback and does not patch the SDK capability object
or bypass the public client. This is separate from the stale-run fix.

`execution: 'configuration'` commands deliberately run in their extension host
without a Session Run. They have no public daemon command-execution endpoint in
rc.2 and remain excluded from Space's executable catalog. No concrete desktop
requirement was established for them: the earlier claim that SDK must add such
an endpoint is withdrawn. Managed extension commands continue to use toolInvocation.

## Automated verification

- `npm test`: release-package contracts plus Desktop and IPC schema regressions.
- `npm run typecheck`, `npm run build:smoke`.
- `npm run lint -- --ignore-pattern 'scratch/**'`: exclude pre-existing untracked
  review copies; no source lint rules are weakened.
- Runtime adapter tests exercise stable cancellation identity, receipt retention,
  exact Run ownership, and original identity-repair revision/proof forwarding.
- `runtime-command*.test.ts` checks aliases, quoted path arguments, shell command
  preservation, Skill separation and actual `session.send` Run admission.
- F121 retains seven installed-package PNG/child/local-error regression cases.

## Desktop acceptance

1. With an owner exposing Session cancellation, start a task and queue a continuation:
   Stop settles the accepted frontier; later Runs survive. Retry after disconnect.
   In rc.2 daemon mode, verify the narrower existing behavior: only the bound Run
   is stopped, and a retry for an already terminal Run returns its terminal receipt.
2. Load a trusted managed extension command. Invoke its alias with a quoted path;
   verify tool progress/history and permission decisions. Run `!git status --short`.
3. With reviewed historical delivery IDs, invoke `/repair-identity`. A stale revision
   or conflicting claim must fail; a confirmed repair must converge after reload.
4. Repeat the original DeepSeek image/child task to evaluate live model behavior.
   Offline contract tests do not claim a live-provider or packaged-desktop run.

## Verification result (2026-09-12)

- Registry `latest` is `0.7.96-rc.1`; the installed SDK passes the locked Registry
  release integrity gate.
- Full `npm test`: 3372 passed, 5 skipped, 0 failed (60 release contracts,
  2994 Desktop tests passed, 318 IPC schema tests).
- Type checking, source lint excluding existing `scratch/**` review copies,
  and `build:smoke` passed. The final pending-request UI also passed its focused
  tests, renderer type checking, lint and renderer build.
- Standards and Spec reviews completed; the Space findings were corrected.
  This historical review overstated two mandatory API gaps; the corrected scope
  and the separate daemon capability boundary are recorded above.
- Live DeepSeek and packaged-desktop acceptance were not executed in this run.

## rc.2 verification (2026-09-13)

- Before upgrade, the original isolated rc.1 probe failed: stopping terminal A
  with a previously unseen requestId aborted running successor B.
- With rc.2, the same scenario rejects with `conflict / stale_run / retryable:false`;
  B completes normally. The published-package regression now locks this behavior.
- Installed SDK controls and multimodal regressions: 10 passed, including accepted
  Stop replay, managed extension execution, child PNG delivery and local errors.
- Space regressions prove unconfirmed terminal retries reach the owner, stale
  rejection settles without retargeting, unrelated errors propagate, and daemon
  exact-Run retries return terminal receipts.
- Real isolated daemon connection confirms version rc.2 and the capability boundary
  above. Live DeepSeek and packaged-desktop acceptance have not been executed.
- Full `npm test`: 3374 passed, 5 skipped, 0 failed (61 release contracts,
  2995 Desktop tests passed, 318 IPC schema tests).
- Final type checking, source lint, `build:smoke` and the final main-process build
  passed. Root and Desktop resolve one deduplicated rc.2 package; the installed
  bytes pass the locked Registry release integrity gate.
- Standards review: 0 remaining findings after shortening the Stop method and
  correcting the manual. Spec review: 0 actionable findings.
