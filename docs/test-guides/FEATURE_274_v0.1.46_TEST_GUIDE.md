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
  This requires an advertised `toolInvocation:1`. A real rc.2 daemon omits it
  and rejects explicit commands; `runLifecycleControl` is not a substitute.
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
an endpoint is withdrawn. Managed extension commands use toolInvocation only
when the connected owner advertises that capability; rc.2 daemon does not.

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
2. With an owner exposing `toolInvocation:1`, load a trusted managed extension
   command. Invoke its alias with a quoted path; verify tool progress/history and
   permission decisions. Run `!git status --short`. With the rc.2 daemon, verify
   an explicit command is rejected before admission with no new Run created.
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
  above. At this stage live DeepSeek and packaged-desktop acceptance had not yet
  been executed; the subsequent live acceptance is recorded below.
- Full `npm test`: 3374 passed, 5 skipped, 0 failed (61 release contracts,
  2995 Desktop tests passed, 318 IPC schema tests).
- Final type checking, source lint, `build:smoke` and the final main-process build
  passed. Root and Desktop resolve one deduplicated rc.2 package; the installed
  bytes pass the locked Registry release integrity gate.
- Standards review: 0 remaining findings after shortening the Stop method and
  correcting the manual. Spec review: 0 actionable findings.

## Packaged live acceptance (2026-09-13)

Run `node --import tsx e2e/rc2-live-acceptance.mjs` after building the Windows
package. The opt-in harness launches the real executable with mock disabled,
a fresh isolated profile and the existing DeepSeek credential passed only in
memory. It checks the running daemon version, uses real `deepseek-flash` calls,
clicks UI Stop and the pending retry button when available, verifies canonical
Run/Actor state and files, and captures screenshots before profile cleanup.

The first real run exposed an incorrect Space capability inference: daemon
`runLifecycleControl:1` was treated as sufficient for explicit `toolInvocation`.
The SDK rejects `!command` before admission. Space now requires the actual
`toolInvocation:1` capability. This does not make daemon explicit commands
available; normal model-directed tool use remains the supported path.

Evidence is written to `artifacts/rc2-live-acceptance/report.json` and PNGs in
that directory. Both native children must have completed `read` and `write`
activities, and each file must contain `PNG_READ_OK` and identify the blue PNG.
The checks do not accept a parent's claim or a user-message echo as completion.

Observed results:

- The packaged rc.2 executable completed real DeepSeek calls, UI Stop, and an
  actual pending-Stop retry button click while a successor was active. The button
  cleared and the successor completed. Two native children independently executed
  `read` then `write`, with completed Actor turns and output files.
- Visual interpretation is not consistently correct: in session
  `20260913_141339_pbe9b103b3ee61`, `image_a` identified the blue PNG correctly,
  while `image_b` wrote `green`. That run remains a failed visual acceptance,
  retained in `artifacts/rc2-live-acceptance/image-color-failure.json`. No child
  crashed. The evidence does not yet distinguish provider interpretation from
  image transport; do not infer reliable vision from completed tool calls.
- The harness still fails on an incorrect color, but checks renderer reload before
  reporting that failure so a vision error does not hide the persistence result.
- Full Windows packaging passed native/asar Worker checks, cold boot, two complete
  product exits and Session history restoration. The dedicated exit smoke covers
  production shutdown; the live fixture uses its existing isolated cleanup path.
- Adapter/manual regressions: 261 passed, 0 failed. Type checking and affected-file
  lint passed. The capability regression failed before the guard fix and passed
  afterward.
- Final run `20260913_141644_39378a6cd11d5c`: all five execution/persistence checks
  passed (real response, UI Stop, retry preserving the successor, two native child
  read/write turns, renderer reload); no renderer page errors. Explicit-command
  rejection before admission also passed. Visual acceptance failed again:
  `image_a` wrote purple and `image_b` wrote green. The retained `sample.png` is
  blue on independent inspection. Overall `report.passed` remains `false`.
- A fresh run of the seven installed-SDK multimodal contract tests passed. Those
  tests prove native image-block fidelity to the Provider interface, not the
  correctness of real provider wire delivery or visual interpretation. Further
  attribution of the live vision discrepancy remains open.
