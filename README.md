<p align="center">
  <img src="resources/icon.png" alt="KodaX Space" width="128">
</p>

<h1 align="center">KodaX Space</h1>

<p align="center">
  <b>Provider-neutral, local-first desktop workbench for KodaX coding agents.</b><br>
  Electron + React desktop client for project-aware AI sessions, review surfaces, workflow visibility, MCP, artifacts, memory governance, and the KodaX SDK runtime.
</p>

<p align="center">
  <a href="https://github.com/icetomoyo/KodaX-Space/releases/latest"><img alt="release" src="https://img.shields.io/github/v/release/icetomoyo/KodaX-Space?style=flat-square"></a>
  <a href="LICENSE"><img alt="license" src="https://img.shields.io/badge/license-KAI--FCL-orange?style=flat-square"></a>
  <a href="https://github.com/icetomoyo/KodaX-Space/actions/workflows/ci.yml"><img alt="CI" src="https://img.shields.io/github/actions/workflow/status/icetomoyo/KodaX-Space/ci.yml?style=flat-square&label=ci"></a>
  <img alt="KodaX SDK" src="https://img.shields.io/badge/KodaX_SDK-0.7.96--alpha.2-2ea44f?style=flat-square">
  <img alt="platforms" src="https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-34495e?style=flat-square">
</p>

<p align="center">
  <a href="#quick-start">Quick Start</a> ·
  <a href="#why-kodax-space">Why KodaX Space</a> ·
  <a href="#current-source-baseline">Current Source Baseline</a> ·
  <a href="#development">Development</a> ·
  <a href="#documentation">Documentation</a> ·
  <a href="README_CN.md">中文 README</a>
</p>

---

## Quick Start

### Download a release

Prebuilt installers are published on the [KodaX Space Releases](https://github.com/icetomoyo/KodaX-Space/releases/latest) page.

| Platform | Package                                                 |
| -------- | ------------------------------------------------------- |
| Windows  | NSIS `Setup.exe`, `Portable.exe`, plus zipped fallbacks |
| macOS    | universal `.dmg`                                        |
| Linux    | `AppImage` and `.deb`                                   |

Current public builds are unsigned. On first launch, Windows SmartScreen or macOS Gatekeeper may ask for manual confirmation. Only install builds from a trusted KodaX-AI distribution channel.

### Run from source

```bash
git clone https://github.com/icetomoyo/KodaX-Space.git
cd KodaX-Space
npm install --include=dev
npm run dev
```

`npm run dev` starts the Vite renderer, the bundled Electron main process, and the KodaX runtime integration used by the desktop client.

---

## Why KodaX Space

<table>
  <tr>
    <td width="33%" valign="top">
      <h3>Local-first desktop shell</h3>
      Project state, sessions, preferences, MCP configuration, skills, and artifacts are centered on the user's machine and shared with the wider KodaX ecosystem.
    </td>
    <td width="33%" valign="top">
      <h3>Provider neutrality</h3>
      Space consumes KodaX provider aliases and custom OpenAI/Anthropic-compatible providers instead of binding the desktop experience to one model vendor.
    </td>
    <td width="33%" valign="top">
      <h3>Task-oriented UI</h3>
      The Environment Hub, Task Dock, review workspace, artifact workspace, terminal, and floating-surface policy separate status, evidence, review, and decisions.
    </td>
  </tr>
  <tr>
    <td valign="top">
      <h3>KodaX SDK native surface</h3>
      Space uses the KodaX Runtime daemon for shared Coder sessions and keeps Partner plus explicit host-provider integrations in Electron main, all through published KodaX contracts.
    </td>
    <td valign="top">
      <h3>Governed automation</h3>
      Permission modes, inline ask-user cards in the conversation stream, keychain-backed credentials, trusted IPC schemas, and local license gates keep agent work visible and reviewable.
    </td>
    <td valign="top">
      <h3>Rich project context</h3>
      Built-in terminal tabs, PDF/docx/xlsx preview, image input, workflow panels, memory governance, and scoped Markdown agents help long sessions stay inspectable.
    </td>
  </tr>
</table>

## Current Source Baseline

**The current source pins the published prerelease KodaX 0.7.96-alpha.2 and requires `sandboxRuntime:6`; support is never inferred from SemVer.** Root/Desktop manifests, lockfile, installed bytes, packaged ASAR, and the fully unpacked universal native bundle resolve one Registry URL and SRI. Startup and daemon gates verify the v6 trusted-text/native-Windows authority markers. Release smoke validates manifest-pinned native hashes before exercising the real command sandbox. The alpha.2 republish restores the Windows lifecycle PowerShell executable resolver that was missing from alpha.1; Space consumes the exact Registry bytes without patching them. The latest published Space release remains v0.1.45 with KodaX 0.7.95; this source alignment does not relabel that historical artifact.

KodaX 0.7.95 retains `conversationHistory:2`, `actorSettlementConvergence:2`, and `crashOutcomeModel:2`, and advances exit settlement to v2 and the Windows sandbox to v5. Same-boot `unconfirmed-owner` tickets are self-healing: the SDK retries process drain, ACL reset, and effect-fence release automatically, clearing the ticket only after an exact sandbox-user SID probe proves the account idle. A failed proof stays diagnosable and fail-closed for sandbox work without blocking unrelated non-sandbox work. Stale zero-byte authority locks are reclaimed through unchanged-byte/stat proof, and valid live or successor owners remain protected. The existing `sessionEventJournal:1` cursor `(sessionId, journalEpoch, seq)` remains explicit. Runtime Shell is sandbox-first; unavailable containment follows the existing permission policy without replay or a second classifier decision, and catastrophic destructive operations remain hard denials. `worker.configuredA2A` remains a KodaX CLI Worker-hosted embedded-runtime option, not a Space Settings toggle.

KodaX 0.7.89 keeps the canonical interrupt `entryId` and ordered Runtime identity. v0.1.42 tightens Space-side causal reconciliation so live snapshots, canonical history, delayed terminals, continued Runs, reconnect hydration, and Ctrl+R preserve exact Session/Run/Turn ownership without timestamp sorting or content-based deduplication. Explicit create-time provider/model choices remain bound through daemon admission.

v0.1.45 additionally keeps already painted canonical history across Runtime-ready revalidation, including pages whose first overlap is an assistant or tool entry. Queued delivery remains attached to its causal turn, history paging uses a loading/retry state, and activity or terminal evidence is accepted only from the current Runtime identity. During compaction, the context meter is intentionally indeterminate until a new factual reading arrives. The release dependency gate honors proxy environment with bounded teardown, while app shutdown cancels any pending startup-recovery delay. Explicit Skill admission passes the exact `rawUserInput`; KodaX 0.7.95 now persists that original query and keeps the prepared `User request:` overlay model-only. A request containing multiple registered Skill references is rejected before expansion, hooks, or Run admission. Admitted Runs survive a daemon reconnect by exact `runId` recovery, an idempotent send produces exactly one conversation bubble, and a pending Run-recovery wait keeps its reconnect timer scheduled instead of draining the host event loop.

The bottom bar separates root-Agent context pressure from cumulative Session token usage. The Context window meter uses the final automatic-compaction threshold and a privacy-safe six-part composition; completed physical requests are deduplicated by request ID across root, child, retry, fallback, repair, workflow-digest, and compaction-summary calls. F140 adds an Ask/keep-in-tray/complete-exit preference. A real quit on Windows, macOS, or Linux first attempts to stop the Coder daemon safely. If work blocks that attempt, Space offers Keep open or Force close; Force close cancels only this Space's work, preserves other clients, and exits without returning to the blocker loop. A Space-started orphan daemon still self-reaps after its final client disconnects and work becomes idle. Terminal plus Coder command tools share one selected Shell/profile-PATH contract without projecting arbitrary executables or secrets.

F122-F124 continue to provide the Partner project-source, immutable evidence/citation, and automatic grounded-context loop. F121 remains `InProgress` only for the final human multi-client acceptance ledger; v0.1.45 still fails closed on missing daemon capabilities, including durable managed-Run, Actor settlement convergence v2, Session journal, conversation history v2, sandbox v5, crash-outcome v2, and exit-settlement contracts. See the [v0.1.45 release design](docs/features/v0.1.45.md) and [capability ledger](docs/KODAX_CAPABILITY_LEDGER.md).

F135 also packages the redistributable `frontend-slides` and `huashu-design` skills as vetted Space builtins, so users do not install the skills separately. The distributed Huashua adaptation removes default promotional watermark/signature markup and instructions while retaining the upstream MIT license and authorship. Optional browser/video/TTS/AI-review pipelines still need their documented external runtimes or credentials. The locally installed `pdf`, `pptx`, `xlsx`, and `docx` skills are not bundled because their current license prohibits redistribution. F137 plans independently authored, Chinese-first replacements for `v0.1.61`; they are not part of this v0.1.45 maintenance release. See the [v0.1.61 design](docs/features/v0.1.61.md), [builtin skill maintenance](docs/BUILTIN_SKILLS.md), and the [v0.1.45 release-readiness record](docs/releases/v0.1.45-release-readiness.md).

F136 makes the Windows background owner visible and controllable; F140 lets users choose Ask, keep running in the tray, or complete exit. Once complete exit passes its visible admission checks, Windows hides to the tray while SDK settlement continues, and reopening Space shows the same elapsed progress; ordinary successful exit stays quiet, while a failure restores the window with diagnostics. F145 projects unique unread or action-required Sessions to the Windows taskbar/tray, macOS Dock, and supported Linux launchers, clearing each Session only when it is read or its interaction is resolved. KodaX's opt-in `daemonOrphanExit:1` lifecycle adds a 30-second idle orphan grace only to daemons auto-started by Space.

Resolved release blocker: KodaX 0.7.76 retains the centralized Windows
`windowsHide` hardening introduced in 0.7.75, so ordinary daemon-backed Coder
queries no longer flash short-lived child-process consoles. Space consumes the
official Registry package without vendoring an SDK patch. See
[Issue 091](docs/KNOWN_ISSUES.md#091-ordinary-windows-queries-can-flash-several-short-lived-command-windows-from-kodax-runtime-child-processes).

## Current Release

**v0.1.45 - Inline Ask-User Cards and Exact KodaX 0.7.95**

Released on 2026-08-24 as [`v0.1.45`](https://github.com/icetomoyo/KodaX-Space/releases/tag/v0.1.45), with package version `0.1.45` and the latest npm `@kodax-ai/kodax` release pinned exactly to `0.7.95`. The release replaces the full-screen ask-user modal with inline conversation cards, aligns to `conversationHistory:2`/`runtimeExitSettlement:2`/`sandboxRuntime:5`, and recovers admitted Runs after a daemon reconnect.

| Area              | Summary                                                                                                                                                                                                           |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Runtime contract  | Exact Registry KodaX 0.7.95 bytes; Space requires conversation-history v2, exit-settlement v2, and sandbox v5 before the corresponding lifecycle paths are used.                                                  |
| Ask-user flow     | `ask_user_question` and guardrail prompts render as focusable inline cards in the conversation stream; a dock recall bar counts pending answers and flash-locates the head card, which accepts 1-9/Enter/Esc keys. |
| Run recovery      | Admitted Runs resume by exact `runId` across daemon reconnects, idempotent sends keep one bubble, and history revalidation keeps the painted canonical prefix.                                                     |
| Documentation     | README files, manuals, capability ledger, release design/readiness, regression guides, changelog, and `kodax_manual` share the v0.1.45 boundary.                                                                   |

See [CHANGELOG.md](CHANGELOG.md), the [v0.1.45 design](docs/features/v0.1.45.md), and the [v0.1.45 release record](docs/releases/v0.1.45-release-readiness.md).

### Historical releases

**v0.1.44 - Native Attention and Background Settlement**

Released on 2026-08-20 as [`v0.1.44`](https://github.com/icetomoyo/KodaX-Space/releases/tag/v0.1.44), with package version `0.1.44` and the latest npm `@kodax-ai/kodax` release pinned exactly to `0.7.93`. The release adds a cross-platform native attention badge, keeps admitted complete-exit settlement in the background, aligns Task Dock and Repointel with live Runtime activity, and improves recoverable external-task and Windows ACL guidance.

| Area              | Summary                                                                                                                                                |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Runtime contract  | KodaX 0.7.93 exact Registry bytes retain the explicit exit, sandbox, crash-outcome, Actor-settlement, journal, and live-output gates.                  |
| Native attention  | One count per unread/action-required Session is projected to Windows taskbar/tray, macOS Dock, and supported Linux launchers.                          |
| Exit and recovery | Admitted Windows settlement continues in the tray; ordinary success stays quiet, failures restore the UI, and previous-boot ACL blocks are actionable. |
| Activity surfaces | Canonical page heads, Task Dock live activity, Repointel repo-intel traces, and persisted external-task empty/error states remain aligned.             |
| Documentation     | README files, manuals, capability ledger, release design/readiness, regression guides, changelog, and `kodax_manual` share the v0.1.44 boundary.       |

See [CHANGELOG.md](CHANGELOG.md), the [v0.1.44 design](docs/features/v0.1.44.md), and the [v0.1.44 release record](docs/releases/v0.1.44-release-readiness.md).

**v0.1.43 - Runtime Exit and Filesystem-Effect Convergence**

Released on 2026-08-19 as [`v0.1.43`](https://github.com/icetomoyo/KodaX-Space/releases/tag/v0.1.43), with package version `0.1.43` and exact Registry KodaX `0.7.92`. It introduced SDK-owned crash-resumable complete-exit settlement, sandbox Runtime v4, crash-outcome v2, and SDK effective live-output segments. See the [v0.1.43 design](docs/features/v0.1.43.md) and [release record](docs/releases/v0.1.43-release-readiness.md).

**v0.1.42 - Causal Transcript and Latest KodaX Alignment**

Released on 2026-08-16 as a source snapshot with package version `0.1.42` and npm `@kodax-ai/kodax` pinned to `0.7.89`. The snapshot preserves causal Session/Run/Turn ownership across renderer reconciliation and adopts Actor settlement convergence v2.

| Area                 | Summary                                                                                                                                          |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Runtime contract     | KodaX 0.7.89 exact Registry bytes; Space requires explicit Actor settlement convergence v2 and never infers support from SemVer.                 |
| Transcript integrity | Exact Session/Run/Turn ownership survives canonical/live folding, delayed terminals, continued Runs, reconnect, and Ctrl+R.                      |
| Documentation        | README files, manuals, capability ledger, release design/readiness, regression guides, changelog, and `kodax_manual` share the v0.1.42 boundary. |

See [CHANGELOG.md](CHANGELOG.md), the [v0.1.42 design](docs/features/v0.1.42.md), and the [v0.1.42 release record](docs/releases/v0.1.42-release-readiness.md).

**v0.1.40 - KodaX 0.7.86 Sandbox and Owner-Reconciliation Release**

Released on 2026-08-14 as [`v0.1.40`](https://github.com/icetomoyo/KodaX-Space/releases/tag/v0.1.40), with package version `0.1.40` aligned to the exact npm-published KodaX 0.7.86 package. The release requires SDK and Runtime `sandboxRuntime:3`, covers the packaged Electron/ASAR Windows Shell chain, and delegates stale inline-owner recovery to the SDK's atomic owner-policy reconciliation.

| Area                 | Summary                                                                                                                                                              |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Runtime contract     | KodaX 0.7.86 exact Registry bytes; `sandboxRuntime:3`, `actorSettlementConvergence:1`, and `sessionEventJournal:1` are negotiated explicitly.                        |
| Shell safety         | Sandbox-first Runtime Shell uses real containment when ready; unavailable containment keeps the normal permission policy without replay or a second classifier call. |
| Packaged Windows     | Issue 128 coverage verifies staged helper paths, a real contained marker command, daemon sandbox v3, and shell behavior after restart.                               |
| Owner reconciliation | Abandoned inline owners recover through the SDK; active, unreadable, and unverifiable owners fail closed, while close failures remain retryable.                     |
| Documentation        | README files, manuals, capability ledger, release design/readiness, regression guides, changelog, and `kodax_manual` share the same boundary.                        |

See [CHANGELOG.md](CHANGELOG.md), the [v0.1.40 design](docs/features/v0.1.40.md), and the [v0.1.40 release record](docs/releases/v0.1.40-release-readiness.md).

**v0.1.39 - KodaX 0.7.85 Runtime Convergence Maintenance Release**

Released on 2026-08-11 as [`v0.1.39`](https://github.com/icetomoyo/KodaX-Space/releases/tag/v0.1.39), with package version `0.1.39` aligned to
the exact npm-published KodaX 0.7.85 package. The release carries Actor
settlement convergence, Session journal epoch isolation, durable-unknown
after-turn admission, exact visible-Run Stop validation, input operation
deduplication, history/live protection, and idle-exit client preservation.

| Area                 | Summary                                                                                                                               |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Runtime contract     | KodaX 0.7.85 exact Registry bytes; `actorSettlementConvergence:1` and `sessionEventJournal:1` are negotiated explicitly.              |
| Unknown Run behavior | Input queues as after-turn work while the visible Run remains unknown; Space does not replay rejected drafts or fabricate completion. |
| Session journal      | Live watermarks use `(sessionId, journalEpoch, seq)` and never compare sequence values across journal lineages or Sessions.           |
| Runtime lifecycle    | Idle exit preserves the shared Runtime when only other clients remain active; Space-owned blockers remain visible and recoverable.    |
| Documentation        | README files, manuals, capability ledger, release design/readiness, regression guide, and `kodax_manual` share the same boundary.     |

See [CHANGELOG.md](CHANGELOG.md), the [v0.1.39 design](docs/features/v0.1.39.md), and the [v0.1.39 release record](docs/releases/v0.1.39-release-readiness.md).

**v0.1.38 - KodaX 0.7.84 Maintenance Release**

Released on 2026-08-07 as [`v0.1.38`](https://github.com/icetomoyo/KodaX-Space/releases/tag/v0.1.38), with package version `0.1.38` aligned to
the exact npm-published KodaX 0.7.84 package. The release carries the
already-landed Session reactivation correction, bounded Agent progress and
same-owner Stop reconciliation contract, tracked icon packaging, and the
matching documentation/manual update.

| Area             | Summary                                                                                                                           |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Runtime contract | KodaX 0.7.84 exact Registry bytes; Agent progress remains bounded and same-owner Stop can reconcile late Actor settlement.        |
| Session recovery | An invalidated but rendered active Session keeps its projection while canonical history recovery is overtaken by an open Run.     |
| Documentation    | README files, manuals, capability ledger, release design/readiness, regression guide, and `kodax_manual` share the same boundary. |
| Packaging        | All Space workspace versions are 0.1.38 and the tracked Windows icon resource is included in the release path.                    |

See [CHANGELOG.md](CHANGELOG.md), the [v0.1.38 design](docs/features/v0.1.38.md), and the [v0.1.38 release record](docs/releases/v0.1.38-release-readiness.md).

**v0.1.37 - Recovery and Release Alignment**

Released on 2026-08-06 as [`v0.1.37`](https://github.com/icetomoyo/KodaX-Space/releases/tag/v0.1.37), with package version `0.1.37` aligned to the exact npm-published KodaX 0.7.83 package.

| Area           | Summary                                                                                                                                                  |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Recovery       | Session hydration, history paging, live projection, and Runtime recovery preserve project, surface, Session, request, and owner identity.                |
| Safe close     | Shutdown remains visible until verified; Keep Open relaunches through a controlled path after Runtime authority closes.                                  |
| KodaX baseline | Historical v0.1.37 used KodaX 0.7.83; the published v0.1.45 release now uses exact Registry KodaX 0.7.95 bytes documented above.                         |
| Documentation  | The Chinese manual, capability ledger, release design, readiness record, regression guide, and in-app `kodax_manual` describe the same current boundary. |

See [CHANGELOG.md](CHANGELOG.md), the [v0.1.37 design](docs/features/v0.1.37.md), and the [v0.1.37 release record](docs/releases/v0.1.37-release-readiness.md).

**v0.1.36 - Session and Runtime Reconciliation Hardening**

Released on 2026-08-05 as [`v0.1.36`](https://github.com/icetomoyo/KodaX-Space/releases/tag/v0.1.36), with package version `0.1.36` aligned to KodaX 0.7.82. See the [v0.1.36 design](docs/features/v0.1.36.md) and [release record](docs/releases/v0.1.36-release-readiness.md).

**v0.1.35 - Durable Managed Runs and Session History Integrity**

Released on 2026-08-05 as [`v0.1.35`](https://github.com/icetomoyo/KodaX-Space/releases/tag/v0.1.35), with package version `0.1.35` aligned to the exact npm-published KodaX 0.7.80 package.

| Area              | Summary                                                                                                                                                                       |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| KodaX 0.7.80      | Exact Registry package and SRI; `managedRunDurability:1` is negotiated instead of inferred from SemVer.                                                                       |
| Coder correctness | The admitted `runId` and streamed `turnId` bind optimistic queries to canonical durable history, preventing late refreshes from attaching output to an older query.           |
| Auto mode         | Space preserves an explicit classifier timeout and otherwise uses the SDK's 45-second initial and 90-second retry defaults.                                                   |
| Documentation     | README, manuals, capability ledger, design/test guide, developer docs, and `kodax_manual` describe the same boundary and keep Worker-hosted A2A separate from Space settings. |

See [CHANGELOG.md](CHANGELOG.md), the [v0.1.35 design](docs/features/v0.1.35.md), and the [v0.1.35 release record](docs/releases/v0.1.35-release-readiness.md).

## Previous Releases

**v0.1.34 - Runtime Safety and Desktop Lifecycle Hardening**

Released on 2026-07-30 as [`v0.1.34`](https://github.com/icetomoyo/KodaX-Space/releases/tag/v0.1.34), with package version `0.1.34` aligned to the exact npm-published KodaX 0.7.78 package. The required `main`, four-platform preflight, and tagged release workflows all passed; the complete evidence and published artifact digests are recorded in the release-readiness document.

| Area               | Summary                                                                                                                                                                                          |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Runtime safety     | Explicit capability negotiation adds orphan exit, resilient integration configuration, Auto guardrail v4, Skill learning-loop, and bounded sandbox observations without a SemVer-only live gate. |
| Integration health | MCP/A2A/Extension last-known-good state, watcher/revision/reload diagnostics, transactional Space MCP swaps, and reload-result truth keep optional failures optional.                            |
| Desktop lifecycle  | Real Windows/macOS/Linux exit drains admission and stops Runtime or restores Space; Space-started orphan daemons gain a scoped 30-second idle grace.                                             |
| Packaged execution | ASRT and sandbox helper dependencies resolve from physical resources, while UI labels distinguish sandbox success, ordinary permission fallback, and no sandbox.                                 |
| Startup/history    | One main-owned startup/shutdown overlay removes duplicate loading flashes, and positional replay keeps completed interrupt responses above the next user query.                                  |
| Verification       | Local and GitHub gates are recorded in the versioned readiness document; Issue 133 and F138 limitations remain explicit instead of being described as completed.                                 |

See [CHANGELOG.md](CHANGELOG.md), the [v0.1.34 design](docs/features/v0.1.34.md), and the [v0.1.34 release record](docs/releases/v0.1.34-release-readiness.md).

**v0.1.32 - Shared Coder and Usable Partner Knowledge**

Released: 2026-07-25 as [`v0.1.32`](https://github.com/icetomoyo/KodaX-Space/releases/tag/v0.1.32), aligned to KodaX 0.7.76. It moved Coder to the shared profile daemon, delivered F122-F124 Partner knowledge/citation grounding, vetted builtins, exact-history UX, and the controllable Windows tray owner. See the [v0.1.32 design](docs/features/v0.1.32.md) and [release record](docs/releases/v0.1.32-release-readiness.md).

**v0.1.31 - Runtime Contract Alignment and Semantic Control**

Released: 2026-07-12 as `v0.1.31`. F116, F055, F069, and F120 shipped together on exact KodaX 0.7.68.

This release adopted the public KodaX Runtime facade as Space's managed-run boundary while preserving explicit Space ownership for product-specific behavior. See the [v0.1.31 design](docs/features/v0.1.31.md) and [F116 implementation record](docs/features/v0.1.31-implementation-plan.md).

**v0.1.30 - External Agent Orchestration Gateway Foundation**

Released: 2026-07-12 as `v0.1.30`.

This release aligns KodaX Space with `@kodax-ai/kodax@0.7.67` and connects its protocol-neutral external-agent substrate to Space's existing live sessions and Workflow host.

| Area                      | Summary                                                                                                                                                                                                 |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Shared dispatch           | Workers and explicit Workflows use one `agentExecutorPlane`, one policy-filtered catalog, opaque `agent_id` routing, and one durable task ledger.                                                       |
| Main-process governance   | Registration writes, policy, credential brokerage, artifact denial/quarantine boundaries, and durable storage stay outside the renderer.                                                                |
| Reference product surface | Runtime Settings manages and preflights registrations; Workflow Launcher selects a live default child target; Task Dock presents lifecycle, audit events, input, cancel, and reconcile actions.         |
| Bilingual acceptance      | The complete Reference Agent surface is localized in English and Simplified Chinese and covered by Electron E2E.                                                                                        |
| Capability honesty        | Runtime-configured A2A is available through the KodaX 0.7.77 Coder daemon after capability negotiation; MCP Tasks and governed HTTP remain hidden until separately delivered adapters pass conformance. |
| KodaX 0.7.67              | Compatibility tests cover Runtime Worker hard-dispose plus external registration, discovery, task start, event handling, and terminal results.                                                          |

See [CHANGELOG.md](CHANGELOG.md), [docs/features/v0.1.30.md](docs/features/v0.1.30.md), and the [F115 External Agent design](docs/features/v0.1.30-external-agents.md) for the full release notes and capability boundary.

**v0.1.29 - Workspace Environment Hub + Task Dock**

Released: 2026-07-08

This release aligns KodaX Space with `@kodax-ai/kodax@0.7.63` and ships the F103 shell redesign. The app now has a compact Environment Hub, a structured right-side Task Dock, and a shared Floating Surface Host for popouts and blocking modals.

| Area                   | Summary                                                                                                              |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Environment Hub        | Routes Changes, Location, Branch, Commit/Push, Sources, and Mode/Permission to the correct deeper surfaces.          |
| Task Dock              | Organizes Run, Plan, Agents, Workflow, Changes, Sources, Artifacts, and Context into a persistent task side surface. |
| Floating Surface Host  | Centralizes z-index, backdrop, Escape handling, focus trap/restore, and topmost-surface behavior.                    |
| Memory Governance      | Adds a Coder-only Memory popout and IPC/service surface over the KodaX memory control plane.                         |
| Scoped Markdown agents | Enables scoped project agents through the KodaX 0.7.63 runtime path.                                                 |
| Licensing              | KodaX Space 0.1.27+ official KodaX-AI distributions use KAI-FCL or accompanying customer terms.                      |

See [CHANGELOG.md](CHANGELOG.md) and [docs/features/v0.1.29.md](docs/features/v0.1.29.md) for the full release notes.

## Product Surface

| Surface            | Purpose                                                                                                                                                                                                                                                  |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Coder workspace    | Main AI coding session surface, backed by the KodaX SDK runtime, with separate effective-context and cumulative Session-token indicators in current source.                                                                                              |
| Environment Hub    | Compact project/session/environment router for location, branch, changes, sources, and mode context.                                                                                                                                                     |
| Task Dock          | Persistent right-side task surface for run status, plan, agents, workflow, changes, sources, artifacts, and context.                                                                                                                                     |
| Review workspace   | Diff and file-review surface for changes that need inspection.                                                                                                                                                                                           |
| Artifact workspace | Preview, inspect, and export generated artifacts.                                                                                                                                                                                                        |
| Terminal workspace | Real PTY terminal tabs scoped to the selected project.                                                                                                                                                                                                   |
| MCP and Skills     | Desktop management and display paths for KodaX MCP servers and skills, plus vetted builtin `frontend-slides` and `huashu-design` distributions.                                                                                                          |
| Memory Governance  | Review, approve, reject, and inspect memory proposals and approved references.                                                                                                                                                                           |
| Partner surface    | Enabled workspace-first knowledge-work surface with Sources, KB, Outputs, checkpointed writes, Office/PDF convenience writers, and local policy/audit controls.                                                                                          |
| External Agents    | KodaX 0.7.78 Runtime-configured Coder Agents use exclusive Actor ownership and unified Actor/Turn tasks; Space Reference Agents retain main-window administration and the durable Task Dock intervention path. MCP Tasks and governed HTTP remain gated. |

## Configuration Model

KodaX Space intentionally reuses KodaX ecosystem state where it should, and owns desktop-only state where the UI needs it.

| State                                    | Behavior                                                                                                                                                                                                          |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `~/.kodax/config.json`                   | Core provider/model/effort/permission/custom-provider/compaction plus `sandbox.envPass` variable-name allow-list shared with KodaX. Values are never stored; MCP, A2A, and Extensions are not newly written here. |
| `~/.kodax/integrations/mcp.json`         | Versioned user MCP server declarations shared by CLI/SDK/Space; Settings can migrate the read-only legacy `config.json#mcpServers` fallback without deleting it.                                                  |
| `~/.kodax/integrations/extensions.json`  | Versioned trusted filesystem-extension paths. Space loads them only when `KODAX_SPACE_ENABLE_SDK_EXTENSIONS=1`; the default is discovery-only.                                                                    |
| `~/.kodax/integrations/a2a.json`         | Versioned Runtime-owned A2A registration configuration.                                                                                                                                                           |
| `<project>/.kodax/integrations/mcp.json` | Space project MCP compatibility layer; same-name project servers override the global declaration.                                                                                                                 |
| `~/.kodax/sessions/`                     | Shared session history with KodaX CLI/REPL.                                                                                                                                                                       |
| `~/.kodax/handoffs/`                     | Desktop handoff inbox for session continuity.                                                                                                                                                                     |
| `~/.kodax/skills/` and project skills    | Discovered by the KodaX skills runtime.                                                                                                                                                                           |
| API keys                                 | Stored through OS keychain when available; environment variables remain supported.                                                                                                                                |
| `~/.kodax/space/`                        | Space-owned preferences, projects, UI state, and desktop-specific metadata.                                                                                                                                       |
| `<profile-root>/runtime/`                | Shared Runtime daemon state and run/event journal; with the default profile this resolves to `~/.kodax/runtime/`.                                                                                                 |

## Architecture

KodaX Space is an npm workspace monorepo with an Electron main process, a sandboxed React renderer, and shared IPC/UI packages.

```text
KodaX-Space/
├── apps/
│   └── desktop/
│       ├── electron/          # Electron main, preload, IPC handlers, KodaX host integration
│       └── renderer/          # React UI, shell, features, stores, visual surfaces
├── packages/
│   ├── space-ipc-schema/      # zod schemas for renderer <-> main IPC contracts
│   └── space-ui-kit/          # shared UI primitives
├── docs/                      # PRD, HLD, ADR, feature notes, manuals, ledgers
├── e2e/ and tests/            # Playwright and integration coverage
├── scripts/                   # dev, build, packaging, smoke helpers
└── resources/                 # app icon and license policy resources
```

Key technical choices:

| Layer                 | Choice                                                                                                                                                                                                            |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Shell                 | Electron 42                                                                                                                                                                                                       |
| Renderer              | React 19, Vite, TypeScript, Zustand                                                                                                                                                                               |
| UI/runtime separation | Renderer has no direct LLM/tool execution; privileged work stays in Electron main.                                                                                                                                |
| KodaX integration     | Electron main uses published owner contracts; Coder defaults to the profile daemon and can use the Settings-selected Embedded fallback, while Partner and explicit host-provider services remain embedded inline. |
| IPC                   | zod-validated contracts from `@kodax-space/space-ipc-schema`.                                                                                                                                                     |
| Terminal              | xterm.js + node-pty.                                                                                                                                                                                              |
| Preview               | Monaco, pdfjs, mammoth/docx, SheetJS/xlsx.                                                                                                                                                                        |
| Tests                 | Node test runner, Playwright, typecheck, smoke packaging checks.                                                                                                                                                  |

## Development

Use Node.js 22.12 or newer. The repository pins Node 22.23.1 in `.nvmrc`, and CI reads the same file.

```bash
# Install dependencies
npm install --include=dev

# Start Vite + Electron in development mode
npm run dev

# Typecheck Electron main, renderer, and workspace packages
npm run typecheck

# Run workspace unit tests
npm test

# Build renderer + main + workspace packages without packaging installers
npm run build:smoke

# Package installers
npm run build:win
npm run build:mac
npm run build:linux

# Validate packaged output
npm run smoke:pack
```

Useful focused commands:

```bash
npm test -w @kodax-space/desktop
npm test -w @kodax-space/space-ipc-schema
npm run e2e
npm run e2e:headed
```

## Documentation

| Document                                                                                                         | Purpose                                                                                  |
| ---------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| [README_CN.md](README_CN.md)                                                                                     | Chinese README.                                                                          |
| [CONTRIBUTING.md](CONTRIBUTING.md)                                                                               | Contribution boundaries, validation, and documentation requirements.                     |
| [docs/README.md](docs/README.md)                                                                                 | Documentation hub and current-vs-historical document map.                                |
| [docs/USER_MANUAL.zh-CN.md](docs/USER_MANUAL.zh-CN.md)                                                           | Illustrated Chinese manual for the v0.1.45 release baseline.                             |
| [docs/USAGE.md](docs/USAGE.md)                                                                                   | Source launch, profiles, Runtime Host, testing, packaging, and troubleshooting.          |
| [docs/BUILTIN_SKILLS.md](docs/BUILTIN_SKILLS.md)                                                                 | Builtin skill provenance, licensing, update, patch, and package-integrity workflow.      |
| [docs/releases/v0.1.34-release-readiness.md](docs/releases/v0.1.34-release-readiness.md)                         | v0.1.34 gates, production evidence, artifact digests, and known-risk record.             |
| [docs/releases/v0.1.37-release-readiness.md](docs/releases/v0.1.37-release-readiness.md)                         | v0.1.37 gates, KodaX 0.7.83 contract, and release evidence.                              |
| [docs/features/v0.1.45.md](docs/features/v0.1.45.md)                                                             | v0.1.45 inline ask-user cards and KodaX 0.7.95 boundary.                                 |
| [docs/releases/v0.1.45-release-readiness.md](docs/releases/v0.1.45-release-readiness.md)                         | v0.1.45 gates, exact KodaX 0.7.95 contract, and release evidence.                        |
| [docs/test-guides/ISSUE_193_v0.1.45_REGRESSION_GUIDE.md](docs/test-guides/ISSUE_193_v0.1.45_REGRESSION_GUIDE.md) | v0.1.45 causal order and Sidecar/Interrupt refresh recovery coverage.                    |
| [docs/test-guides/ISSUE_196_v0.1.45_REGRESSION_GUIDE.md](docs/test-guides/ISSUE_196_v0.1.45_REGRESSION_GUIDE.md) | v0.1.45 Session history, queue, status, loading, and compaction coverage.                |
| [docs/test-guides/ISSUE_197_v0.1.45_REGRESSION_GUIDE.md](docs/test-guides/ISSUE_197_v0.1.45_REGRESSION_GUIDE.md) | v0.1.45 build proxy and shutdown recovery coverage.                                      |
| [docs/features/v0.1.44.md](docs/features/v0.1.44.md)                                                             | Historical v0.1.44 native attention, background settlement, and KodaX 0.7.93 boundary.   |
| [docs/releases/v0.1.44-release-readiness.md](docs/releases/v0.1.44-release-readiness.md)                         | Historical v0.1.44 gates, exact KodaX 0.7.93 contract, and release evidence.             |
| [docs/test-guides/FEATURE_145_v0.1.44_TEST_GUIDE.md](docs/test-guides/FEATURE_145_v0.1.44_TEST_GUIDE.md)         | Historical v0.1.44 native attention badge acceptance coverage.                           |
| [docs/test-guides/ISSUE_189_v0.1.44_REGRESSION_GUIDE.md](docs/test-guides/ISSUE_189_v0.1.44_REGRESSION_GUIDE.md) | Historical v0.1.44 background complete-exit settlement coverage.                         |
| [docs/test-guides/ISSUE_190_v0.1.44_REGRESSION_GUIDE.md](docs/test-guides/ISSUE_190_v0.1.44_REGRESSION_GUIDE.md) | Historical v0.1.44 previous-boot Windows ACL recovery coverage.                          |
| [docs/test-guides/ISSUE_191_v0.1.44_REGRESSION_GUIDE.md](docs/test-guides/ISSUE_191_v0.1.44_REGRESSION_GUIDE.md) | Historical v0.1.44 external-task empty and retry state coverage.                         |
| [docs/test-guides/ISSUE_192_v0.1.44_REGRESSION_GUIDE.md](docs/test-guides/ISSUE_192_v0.1.44_REGRESSION_GUIDE.md) | Historical v0.1.44 quiet safe-exit notification coverage.                                |
| [docs/features/v0.1.43.md](docs/features/v0.1.43.md)                                                             | v0.1.43 Runtime exit, KodaX 0.7.92, sandbox v4, and release boundary.                    |
| [docs/releases/v0.1.43-release-readiness.md](docs/releases/v0.1.43-release-readiness.md)                         | v0.1.43 gates, exact KodaX 0.7.92 contract, and release evidence.                        |
| [docs/test-guides/ISSUE_188_v0.1.43_REGRESSION_GUIDE.md](docs/test-guides/ISSUE_188_v0.1.43_REGRESSION_GUIDE.md) | v0.1.43 complete-exit settlement and recovery coverage.                                  |
| [docs/test-guides/ISSUE_256_v0.1.43_REGRESSION_GUIDE.md](docs/test-guides/ISSUE_256_v0.1.43_REGRESSION_GUIDE.md) | v0.1.43 sandbox v4 / crash-outcome v2 filesystem-effect coverage.                        |
| [docs/features/v0.1.42.md](docs/features/v0.1.42.md)                                                             | Historical v0.1.42 causal transcript, KodaX 0.7.89, and release boundary.                |
| [docs/releases/v0.1.42-release-readiness.md](docs/releases/v0.1.42-release-readiness.md)                         | Historical v0.1.42 gates, exact KodaX 0.7.89 contract, and release evidence.             |
| [docs/test-guides/ISSUE_182_v0.1.42_REGRESSION_GUIDE.md](docs/test-guides/ISSUE_182_v0.1.42_REGRESSION_GUIDE.md) | v0.1.42 canonical/live ordering regression coverage.                                     |
| [docs/test-guides/ISSUE_183_v0.1.42_REGRESSION_GUIDE.md](docs/test-guides/ISSUE_183_v0.1.42_REGRESSION_GUIDE.md) | v0.1.42 terminal owner reconciliation coverage.                                          |
| [docs/test-guides/ISSUE_184_v0.1.42_REGRESSION_GUIDE.md](docs/test-guides/ISSUE_184_v0.1.42_REGRESSION_GUIDE.md) | v0.1.42 continued-Run projection coverage.                                               |
| [docs/test-guides/ISSUE_185_v0.1.42_REGRESSION_GUIDE.md](docs/test-guides/ISSUE_185_v0.1.42_REGRESSION_GUIDE.md) | v0.1.42 completion notification and Actor v2 coverage.                                   |
| [docs/features/v0.1.40.md](docs/features/v0.1.40.md)                                                             | v0.1.40 maintenance scope and KodaX 0.7.86 sandbox boundary.                             |
| [docs/releases/v0.1.40-release-readiness.md](docs/releases/v0.1.40-release-readiness.md)                         | v0.1.40 gates, KodaX 0.7.86 contract, and release evidence.                              |
| [docs/features/v0.1.39.md](docs/features/v0.1.39.md)                                                             | Historical v0.1.39 scope and KodaX 0.7.85 boundary.                                      |
| [docs/releases/v0.1.39-release-readiness.md](docs/releases/v0.1.39-release-readiness.md)                         | Historical v0.1.39 gates, KodaX 0.7.85 contract, and release evidence.                   |
| [docs/features/v0.1.38.md](docs/features/v0.1.38.md)                                                             | Historical v0.1.38 maintenance scope and KodaX 0.7.84 boundary.                          |
| [docs/releases/v0.1.38-release-readiness.md](docs/releases/v0.1.38-release-readiness.md)                         | Historical v0.1.38 gates, KodaX 0.7.84 contract, and release evidence.                   |
| [docs/CODING_AGENT_BEGINNER_BEST_PRACTICES.zh-CN.md](docs/CODING_AGENT_BEGINNER_BEST_PRACTICES.zh-CN.md)         | Chinese beginner guide for coding-agent practice in software and microservice workflows. |
| [docs/PRD.md](docs/PRD.md)                                                                                       | Product requirements and product positioning.                                            |
| [docs/HLD.md](docs/HLD.md)                                                                                       | High-level architecture and system design.                                               |
| [docs/ADR/](docs/ADR/)                                                                                           | Architecture decision records.                                                           |
| [docs/FEATURE_LIST.md](docs/FEATURE_LIST.md)                                                                     | Feature ledger, roadmap, and release planning status.                                    |
| [docs/FEATURES_ARCHIVED.md](docs/FEATURES_ARCHIVED.md)                                                           | Archived release index, reviewed-out decisions, and reopen gates.                        |
| [docs/KODAX_CAPABILITY_LEDGER.md](docs/KODAX_CAPABILITY_LEDGER.md)                                               | KodaX SDK capability consumption and fallback notes.                                     |
| [CHANGELOG.md](CHANGELOG.md)                                                                                     | Release history.                                                                         |

## Roadmap

Near-term planned work is tracked in [docs/FEATURE_LIST.md](docs/FEATURE_LIST.md). Current highlights:

| Lane                         | Focus                                                                                                                                                                                     |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `v0.1.32`                    | Published shared-daemon Coder, Partner project knowledge/citations, vetted builtins, exact-history UX, Windows icon/tray, and release hardening.                                          |
| `v0.1.33`                    | Corrected KodaX 0.7.77 release with safe Daemon/Embedded selection, conversation file actions, attachment/context fixes, and packaged Runtime gates.                                      |
| `v0.1.34`                    | KodaX 0.7.78 Runtime safety, resilient integrations, visible complete exit, packaged sandbox helpers, startup UX, and history replay hardening.                                           |
| `v0.1.35`                    | Published KodaX 0.7.80, durable managed-Run negotiation, session-history integrity, Auto timeout defaults, and the matching manual/test contract.                                         |
| `v0.1.36`                    | Session input-admission, history/live reconciliation, renderer recovery, and KodaX 0.7.82 maintenance hardening.                                                                          |
| `v0.1.37`                    | KodaX 0.7.83, multi-Session recovery, safe-close relaunch, semantic bootstrap surface, and release documentation alignment.                                                               |
| `v0.1.38`                    | KodaX 0.7.84, Agent progress/Stop convergence, Session reactivation recovery, tracked icon packaging, and complete release documentation alignment.                                       |
| `v0.1.39`                    | KodaX 0.7.85, Actor settlement convergence, Session journal epoch isolation, unknown Run admission, exact Stop, input deduplication, and complete release documentation alignment.        |
| `v0.1.40`                    | KodaX 0.7.86, sandboxRuntime v3, Issue 128 packaged Shell coverage, stale owner recovery, retryable owner cleanup, and complete release documentation alignment.                          |
| `v0.1.42`                    | Latest KodaX 0.7.89, Actor settlement convergence v2, causal transcript ownership, Session deletion feedback, permission reason visibility, and complete release documentation alignment. |
| `v0.1.43`                    | Latest KodaX 0.7.92, SDK-owned complete-exit settlement, sandboxRuntime v4, crashOutcomeModel v2, live output segments, and complete release documentation alignment.                     |
| `v0.1.44`                    | Exact KodaX 0.7.93, F145 native attention, background complete exit, Task Dock/Repointel/history alignment, and recoverable external-task states.                                         |
| `v0.1.45`                    | Exact KodaX 0.7.95, inline ask-user/guardrail cards, conversation-history v2, sandbox v5, admitted-Run reconnect recovery, and idempotent single-bubble sends.                            |
| `v0.1.61`                    | Independently authored Chinese-first DOCX/PDF/XLSX/PPTX builtins plus semantic UI polish, with bounded execution and truthful validation receipts.                                        |
| `v0.1.64`、`v0.1.66-v0.1.68` | Partner Skill workspace, knowledge quality/curation, Presentation Project, and the SDK-gated Memory Agent host.                                                                           |
| `v0.1.72`                    | Localization completion, beta diagnostics, release channels, updater/distribution trust.                                                                                                  |
| `v0.2.x`                     | Governed browser and Partner packs, read-only connector snapshots, local automations, and refreshable artifacts.                                                                          |

Remote runners, notebooks, knowledge graphs, desktop screen automation, and unshipped External Agent adapters are reopen-gated watchlist items, not committed release features.

## License

[KodaX-AI Fair Core License (KAI-FCL)](LICENSE) - Copyright 2026 icetomoyo.

KAI-FCL is source-available / fair-core, not OSI open source. Commercial, enterprise, managed deployment, or customer redistribution use requires KodaX-AI authorization and a valid entitlement where required.

KodaX-AI's current official licensing policy is that KodaX Space 0.1.27 and later are provided under KAI-FCL or accompanying KodaX-AI customer terms when distributed by KodaX-AI with that notice. Historical tags, source archives, installers, or other copies already distributed with Apache-2.0 notices remain under Apache-2.0 for those specific copies.
