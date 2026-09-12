# Space / KodaX 0.7.96-rc.1 alignment

Baseline: Space 0.1.46-alpha.10, exact Registry SDK 0.7.96-rc.1. Scope is the
beta.7–rc.1 increment applicable to Space, not every previously planned SDK UX.

## Acceptance requirements

- User Stop uses one `sessions.cancel({ sessionId, expectedRunId, requestId })`
  operation. The SDK owns its durable queue frontier; later submissions survive.
  Transport retries retain the same identity and binding. After the active Run
  becomes terminal, retry requires a previously received owner receipt; ambiguous
  acceptance without that evidence is rejected (see SDK boundary below).
  A fresh Stop already known to be stale must not select a successor.
  Preserve every returned receipt, and never present an unknown outcome as stopped.
  Narrow Run cleanup, redirection and forced-exit ownership retain `runs.abort`.
- Resolve extension commands from the owner catalog. Canonical names and aliases
  route to `extension_command__<name>` using `toolInvocation`; `!command` routes
  to `bash` with the original command text. Both use ordinary Run settings,
  credentials, permissions, events, history, cancellation and operation identity.
  No model guesses dispatch and no ungoverned local-process fallback is allowed.
  Space currently requires an idle Session for explicit commands, as for Skills;
  the Runtime remains authoritative if another client races admission.
- Require connected `sessionCancellation:1` / `toolInvocation:1` when using these
  operations. These facts are absent from the SDK's static capability constant
  and typed connect requirements; validate the owner rather than inventing flags.
- `/repair-identity <source-entry> <target-entry> <revision> <run> <input> <event>
  <confirmation-ref>` is an explicit Coder repair operation. Forward the original
  delivery proof and expected revision; the SDK validates and audits them. Never
  infer an alias from text/time or retry a changed revision automatically. Clear
  Space's history cache after success; reloading displays the canonical history.
- Preserve permission authority v6, native text/image results, local-execution
  error facts, interrupt provenance and large-metadata paging from the SDK.

## Deliberate SDK boundary

rc.1 has no replay-only cancellation or cancellation-request lookup API. If a
transport fails before Space receives any cancellation receipt and the bound Run
then becomes terminal, Space cannot prove that the SDK recorded the first frontier.
It retains the pending request but refuses an unconfirmed terminal retry, because
an unknown request ID would create a new frontier and include successor Runs.
SDK follow-up: expose replay-only/request-status or atomically reject a fresh
terminal expectedRunId. The first-request active-check-to-cancel race also needs
that owner-side guard; client preflight cannot provide an atomic guarantee.
Normal current-Run Stop remains separate from the pending-request retry action.

`execution: 'configuration'` extension commands have neither a managed tool nor
a public daemon command-execution endpoint in rc.1. Space excludes them from its
executable catalog and rejects manual attempts with a CLI-owner instruction.
It does not execute configuration handlers in a second extension instance.
This is an upstream API limitation, not completed desktop execution support.
SDK-managed extension scopes, drain/reload isolation, MCP multimodal conversion,
wire-cache diagnostics and metadata paging are inherited runtime behavior.
Existing planned product features in the capability ledger remain separate.

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

1. Start a Coder task and queue a continuation. Stop; both pre-existing Runs must
   settle, with unknown cleanup staying visibly pending. Submit a new task after
   Stop acceptance and verify it survives. Repeat with a disconnected/reconnected UI.
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
  The two upstream API boundaries above remain explicit limitations.
- Live DeepSeek and packaged-desktop acceptance were not executed in this run.
