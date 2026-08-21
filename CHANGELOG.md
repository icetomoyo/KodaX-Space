# Changelog

All notable changes to KodaX-Space will be documented in this file.

KodaX-Space is the Electron desktop client for the [KodaX SDK](https://github.com/icetomoyo/KodaX) — Claude Desktop-style interactive surface, GUI alternative to the `kodax` REPL.

> **Historical gap note**: this file 0.1.3 / 0.1.4 / 0.1.5 / 0.1.6 没有正式 section。
> 期间 ship 的 features (F019/F020/F021/F022 + F005 sidebar overhaul / F011 / F026 / F038 等)
> 见 `docs/FEATURE_LIST.md` 真理源 + `git log v0.1.2..v0.1.7`。本 v0.1.7 起恢复正常 changelog 流程。
>
> **v0.1.7 状态**：tagged 但**release 撤回**(installer 白屏 + sessions 加载 bug)。
> v0.1.7 内容 (F011/F023/F024/F026/F038) 跟 v0.1.8 一起发。GitHub Releases 顶部仍是 v0.1.5，
> 0.1.7 这条 section 留作历史记录、git log 引用入口。

## [Unreleased]

### Changed

- **FEATURE_032 v2 inline ask-user cards** - `ask_user_question` and guardrail
  prompts now render as focused cards in the conversation stream (composer
  dock recall strip with count + jump-to-card, keyboard 1-9/Enter/Esc on the
  head card with overlay-aware yielding) instead of a full-screen modal.
  Pure renderer change: reply IPC, askUserBroker persistence, and timeout
  semantics are unchanged; validation rules moved to a tested pure module.
  The full-screen AskUserModal is removed.

### Fixed

- **Recover admitted Runs after daemon reconnect** - Once Space has a `runId`,
  a reconnect now queries and awaits that exact Run on the replacement Runtime.
  It never calls `runs.start()` again, so a recoverable transport loss no longer
  ends the conversation or risks replaying provider/tool effects.

---

## [0.1.44] - 2026-08-20

### Added

- **F145 cross-platform native attention badge** - Unread results and pending
  permission/AskUser interactions are counted once per Session. Windows uses
  the taskbar overlay and matching tray badge; macOS and supported Linux
  launchers use the native application badge. Unsupported Linux desktops
  degrade without affecting Session work.

### Changed

- **KodaX 0.7.93 Registry alignment** - Root and Desktop manifests, the tracked
  npm lockfile, installed bytes, and release validation use the exact audited
  npm Registry package and SRI. KodaX retains the v0.1.43 exit/sandbox/runtime
  contracts and adds fail-closed recovery for a wholly canonical
  previous-boot Windows ACL marker set.
- **Live activity surfaces** - Task Dock keeps current Agent/Workflow activity
  aligned with live Runtime facts, and Runtime repo-intelligence traces now
  reach the Repointel status chip without creating a second state owner.

### Fixed

- **Actionable Windows ACL recovery** - Runtime startup still blocks before
  owner reconciliation when SDK settlement is unresolved, but foreign Windows
  sandbox ACL diagnostics now produce localized restart/support steps and a
  reachable diagnostics-folder action without exposing raw marker text. Space
  never invokes Setup or elevation from startup. Published KodaX 0.7.93 now owns
  verified previous-boot recovery inside settlement, and both Space manifests
  plus the lockfile pin its audited Registry package and integrity.
- **Responsive background complete exit** - After visible admission passes,
  Windows hides to the tray while the same SDK settlement continues. Reopening
  shows the same elapsed progress; failures restore the window and actionable
  diagnostics instead of leaving an unresponsive foreground overlay.
- **Quiet ordinary safe exit** - Successful clean/recovered complete exit no
  longer emits a prominent Windows system notification. States that require
  user action still restore the visible Space surface.
- **Canonical page-head stability** - Older live turns no longer displace the
  newest canonical page head while history and live projections converge.
- **Persisted external-task states** - A historical Session with no external
  tasks renders the normal empty state; real list failures remain retryable and
  do not turn the completed main Run into a failure.

### Documentation

- README files, Chinese user manual, usage guide, docs hub, PRD/HLD, Feature
  List, capability ledger, Known Issues, v0.1.44 design/readiness, F145 and
  Issue 189-192 guides, and the in-app `kodax_manual` now describe the same
  v0.1.44 / KodaX 0.7.93 boundary.

---

## [0.1.43] - 2026-08-19

### Changed

- **KodaX 0.7.92 Registry alignment** - Root and Desktop pin the same published
  npm Registry URL and integrity; the local candidate tarball is removed. Space
  now requires SDK and daemon `sandboxRuntime:4` plus
  `crashOutcomeModel:2`; an idle stale daemon is replaced through the existing
  fenced upgrade flow, while busy or multi-client daemons fail closed.
- **KodaX 0.7.91 exit settlement retained** - `runtimeExitSettlement:1` gives
  complete exit an SDK-owned, crash-resumable exact-owner ticket and resumes it
  before Space reconciles or starts a daemon. The package also retains the
  0.7.89 `runBoundHostTools:2` materialization of lease-bound host tools into the
  per-run model-visible tool table and the managed-context topology-transparency
  fix. Old or unverifiable daemon ownership remains fail-closed.

### Fixed

- **Filesystem-effect lock convergence** - Space consumes the SDK-owned
  same-daemon operation-lease recovery and terminal-commit ordering without
  adding a host lock cleaner, native-shell bypass, force-idle timer, or second
  Stop state machine. Ordinary-permission fallback remains available only
  inside KodaX and still acquires the shared filesystem-effect fence.

- **Packaged macOS lifecycle home** - The packaged Runtime lifecycle probe now
  creates its isolated `KODAX_HOME` on the real `/private/tmp` path. KodaX
  0.7.91+ exit settlement rejects a directory whose ancestors include a
  symbolic link, and Darwin `/tmp` is such an alias.
- **Packaged Electron SDK loading** - The CommonJS main bundle now loads KodaX's
  ESM-only SDK subpaths through dynamic import before Runtime projection work.
  A release regression test rejects static imports, re-exports, and direct
  `require()` calls that would make a packaged Space process hang before its
  diagnostics or window could initialize.
- **SDK-owned provider output replacement** - Coder now consumes KodaX
  `liveOutputSegments:1` with logical response, physical provider-request, and
  append/replace identity. Abandoned retry/fallback text remains available in
  the Runtime audit journal but is removed from the effective live projection;
  max-token continuation still appends. Reconnect and snapshot hydration use
  that projection directly, with no Space checkpoint replay or text-equality
  deduplication state machine.
- **Fenced incompatible-daemon replacement** - Space delegates capability
  replacement entirely to the KodaX SDK. An idle incompatible daemon is
  replaced only after exact owner/process identity, client/work quiescence,
  durable owner-policy transition, and verified shutdown pass. A daemon used
  by another KodaX client or carrying governed work is preserved and the new
  client fails closed; Space performs no protocol downgrade or second stop.
- **Run-scoped terminal folding** - A Runtime terminal event that omits `turnId` no longer
  blocks live/canonical folding when its `runtimeEvent.runId` matches the owner bound by
  `bindUserMessageRuntimeRun`. Previously one turnId-less terminal left its live copy in the
  baseline forever; window rebuilds then appended the stale segment at the transcript bottom
  (the "second-to-last answer + newest query sink to the bottom" shape, repaired by Ctrl+R).
- **Ambiguous history dedupe** - When `session.history` reports `conversation.status:'ambiguous'`,
  restored rows that share a `logicalId` (KodaX compaction double-books a retained suffix as both
  a re-created main entry and an archived island entry) now render exactly once instead of being
  conservatively duplicated across reloads. Resolved pages are never deduped.
- **Ambiguous dedupe prefers the canonical copy** - When both duplicate candidates of an
  ambiguous page carry `canonicalIndex`, the renderer keeps the copy with the smaller
  canonical index even if the archived duplicate arrives first; candidates without a
  canonical index keep the previous first-seen behavior. The ambiguous-history banner now
  states that proven duplicates render once instead of claiming all candidates are kept.
- **Runtime-unavailable transcript notice** - When the Coder Runtime is unavailable and the
  bounded history retry budget is exhausted (`page.outcome:'runtime_unavailable'`), the
  transcript empty state now explains that the Runtime is temporarily unavailable and the
  history file is intact, instead of showing an indefinite restore skeleton that looked like
  a broken or corrupted session. Normal daemon startup still shows the skeleton until ready.

### Documentation

- Synchronized the README files, docs hub, PRD, HLD, Feature List, capability
  ledger, known issues, usage/user manual, release design, regression guides,
  changelog, and in-app `kodax_manual` for v0.1.43.

### Verification

- The release preparation keeps system business logic unchanged; any CI
  hardening remains limited to tests, smoke probes, workflow configuration, or
  release documentation.

---

## [0.1.42] - 2026-08-16

### Changed

- **KodaX 0.7.88 Registry alignment** - Root and Desktop pin the npm `latest`
  package exactly, including `actorSettlementConvergence:2`, the phased
  canonical Actor settlement contract, and the published GLM-5.3 coding
  defaults.
- **Permission observability** - Auto[LLM] approval prompts surface a bounded,
  sanitized classifier reason without exposing prompts, full responses, or
  credentials.
- **Session lifecycle feedback** - Session deletion now shows an in-flight
  state, prevents duplicate actions, and removes the row only after the
  backend confirms deletion.

### Fixed

- **Causal transcript ordering** - Renderer reconciliation now keeps Runtime
  events attached to their exact Session/Run/Turn owner across live snapshots,
  canonical history, delayed terminals, and continued Runs; older output can
  no longer close or reorder a newer query.
- **Create-time model continuity** - An explicitly selected model remains bound
  through daemon admission instead of being replaced by a later shared default.
- **Canonical/live folding** - Leading-page recovery, terminal owner binding,
  and completion notifications preserve exact query/answer ownership without
  timestamp sorting or content-based deduplication.

### Documentation

- Synchronized the README files, docs hub, PRD, HLD, Feature List, capability
  ledger, known issues, usage/user manual, release design, regression guides,
  changelog, and in-app `kodax_manual` for v0.1.42.

### Verification

- The release preparation keeps system business logic unchanged; any CI
  hardening remains limited to tests, smoke probes, workflow configuration, or
  release documentation.

---

## [0.1.41] - 2026-08-14

### Changed

- Root and Desktop now resolve the latest npm `@kodax-ai/kodax` release,
  currently exact `0.7.87`, including the GLM-5.3 Zhipu Coding Plan defaults
  and effort mapping. The lockfile records the Registry tarball and SRI.

### Fixed

- Provider recovery no longer leaves an abandoned assistant/thinking attempt
  joined to its replacement in daemon conversations. Space now consumes the
  existing ordered recovery event in live rendering, history reconciliation,
  and active observation replay, so the transcript is identical before and
  after Ctrl+R without content-based deduplication or new SDK requirements.

### Documentation

- Synchronized the README files, PRD, HLD, Feature List, capability ledger,
  known issues, usage/user manuals, release design, regression guide, and the
  in-app `kodax_manual` for v0.1.41.

---

## [0.1.40] - 2026-08-14

### Changed

- Root and Desktop now resolve the exact npm-published
  `@kodax-ai/kodax@0.7.86` package. Coder startup requires both the SDK and the
  connected Runtime to advertise `sandboxRuntime:3`; an idle older daemon is
  retired only through KodaX's verified capability-upgrade path.
- Space's sandbox startup probe, Settings status schema, capability ledger, and
  packaged Electron smoke now consume standalone sandbox facade v3. The smoke
  executes a real contained command when doctor reports ready and independently
  verifies daemon-side sandbox v3 negotiation.
- Auto LLM compatibility coverage follows KodaX 0.7.86 sandbox-first semantics:
  unavailable containment uses the existing normal permission policy without
  replaying a command or issuing a second classifier decision.

### Fixed

- KodaX 0.7.86 repairs the packaged Electron/ASAR Windows Shell chain tracked by
  Issue 128, including staged sandbox runners, Electron Node-bootstrap
  isolation, machine-wide policy ownership, termination proof, and surfaced
  lifecycle cleanup failures.
- Daemon startup now delegates an `inline` owner fence to the SDK's atomic
  daemon-enable reconciliation instead of rejecting every owned snapshot.
  Provably abandoned inline owners recover without deleting `~/.kodax`, while
  active, unreadable, and unverifiable owners still fail closed.
- Space retains an inline owner handle when coordinated close fails, allowing
  the SDK release to be retried instead of silently orphaning the fence.

---

## [0.1.39] - 2026-08-11

### Changed

- **KodaX 0.7.85 Registry alignment** - Root/Desktop manifests and every
  lockfile view now resolve the exact published package
  (`sha512-6iDF3dgz1WehkaLGDgIBBa0r2cpTalR4SMiCEw6QVEsyBDS9zwvTQ5zBoI/VDaMFdyCyHUUs7ZLVatkeBRaj/Q==`).
- Coder startup now requires both `actorSettlementConvergence:1` and
  `sessionEventJournal:1`. Session observations retain the complete
  `(sessionId, journalEpoch, seq)` cursor and reset local watermarks when the
  journal epoch changes instead of comparing sequence numbers across Sessions.
- Coder startup now requires KodaX Runtime capability
  `actorSettlementConvergence:1`; Space will not claim compatibility from the
  package version alone.
- When the active Run is durability-unknown, every composer entry point queues
  the next query as after-turn input. The draft is cleared only after Runtime
  acknowledges that exact queued continuation.
- Ambiguous composer sends retain their operation identity across intervening
  drafts. Main-process deduplication runs before attachment validation, so an
  accepted query with a lost IPC reply cannot be duplicated or fail merely
  because its draft image was already cleaned up.
- KodaX 0.7.85 safety semantics are reflected in compatibility probes: Agent
  Home/root mutations are non-authorizable, and opaque shell execution must
  have real OS containment rather than an approval-only fallback.

### Fixed

- Stop now carries the visible exact `runId` through renderer, IPC, host, and
  Runtime receipt validation, preventing a stale click from targeting a
  successor Run.
- A terminal Runtime event no longer prunes a live query/output turn without
  exact canonical folding proof. Manual recovery therefore keeps the submitted
  query and streamed output visible when its canonical Session commit is
  absent.
- Durability-unknown UI remains active and stoppable, but now describes the
  factual automatic repair instead of promising an unspecified Space refresh.
- Same-runtime Actor self-fence is surfaced as settlement persistence failure;
  genuine `actor_owner_conflict` remains reserved for a different live owner.

### Verification

- Full workspace tests, typecheck, lint, production Windows packaging, package
  smoke, and packaged boot smoke pass against the exact Registry 0.7.85 bytes.
  The package probe starts a real daemon, observes a real Session, and validates
  its complete Session journal cursor.

---

## [0.1.38] - 2026-08-07

### Changed

- **KodaX 0.7.84 Registry alignment** - Root/Desktop manifests, workspace
  packages, lockfile views, installed bytes, and runtime compatibility tests
  now use the exact published npm Registry package and integrity pin.
- **Agent progress recovery** - The release documents the bounded progress
  merge and exact same-owner Stop reconciliation contract. Foreign ownership
  and persistent storage failures remain fail-closed.
- **Release packaging** - Space package metadata, the Windows icon resource,
  and the release documentation all describe the same `0.1.38` artifact.

### Fixed

- Reactivating an invalidated but already-rendered Session now retains its
  resolved projection while an open Run overtakes canonical history recovery.
  This prevents the newest query or answer from appearing twice, attaching to
  the previous turn, or moving within the transcript until Ctrl+R.
- Late Actor settlement after an exact same-owner Stop can now be reconciled
  before the captured executor result is applied, so a completed-looking
  answer does not leave its Session permanently stuck in `unknown`.

### Documentation

- Synchronized README files, the documentation hub, PRD/HLD, Feature List,
  capability ledger, known issues, usage guide, Chinese user manual, beginner
  guide, builtin-skill guide, release records, regression guide, and the
  in-app `kodax_manual` for Space `0.1.38` and KodaX `0.7.84`.

### Verification

- Local release checks, workspace tests, typecheck, lint, production smoke
  build, package smoke, and the GitHub main/tagged workflows are release
  gates for this version.

---

## [0.1.37] - 2026-08-06

### Changed

- **KodaX 0.7.83 Registry alignment** - Root/Desktop manifests, workspace
  packages, lockfile views, installed bytes, and the runtime compatibility
  gate now use one exact npm Registry package and integrity pin.
- **Multi-Session recovery** - Session hydration, history paging, live
  projection, and recovery now keep project, surface, Session, request, and
  Runtime identity aligned while Sessions are restored or switched.
- **Safe close and renderer surface** - Complete-exit recovery remains visible
  when Runtime shutdown cannot be proven, and the bootstrap document uses the
  semantic surface tokens used by the current UI.

### Fixed

- Prevented stale recovery snapshots or late Runtime events from hiding active
  work, moving output across Sessions, or resurrecting an invalid owner.
- Stabilized daemon shutdown and safe-close recovery after multi-Session work,
  including the Keep Open relaunch path.
- Updated compatibility tests for the published KodaX 0.7.83 package.

### Documentation

- Added the v0.1.37 feature design, release-readiness record, and Issue 175
  regression guide.
- Synchronized README files, the documentation hub, PRD/HLD, Feature List,
  capability ledger, known issues, usage guide, Chinese user manual, builtin
  skill guide, beginner guide, and in-app kodax_manual.

### Verification

- Full workspace tests, release checks, typecheck, lint, production smoke
  build, package smoke, and GitHub main/tagged workflows are release gates.

---

## [0.1.36] - 2026-08-05

### Changed

- Complete exit keeps its progress surface visible until the exact Coder daemon
  shutdown is authoritatively verified. Space now requires the SDK's
  `daemonShutdownVerification:1` fact and consumes its durable-outcome plus
  containment-boundary verifier instead of inferring success from a PID alone.

### Fixed

- A failed safe close no longer makes the window disappear and then reappear.
  If Runtime control has already been closed and recovery cannot be proven,
  choosing Keep Open performs a controlled relaunch instead of reopening a
  nonfunctional Coder admission path.

- **KodaX 0.7.82 Registry alignment** - Root/Desktop manifests, workspace
  packages, lockfile views, installed bytes, runtime capability reporting, and
  the release gate now use one exact npm Registry package and integrity pin.
- **Active Session admission** - Send, interrupt, after-turn, Session switch,
  draft restoration, and history revalidation now share a bounded admission
  boundary so transient topology changes cannot surface as generic handler
  failures or attach a new answer to an older query.
- **Live/history identity** - Accepted input keeps its exact `runId` and
  streamed `turnId`; snapshot watermarks, paging cursors, and canonical
  boundaries remain Session-scoped through reconnect and late reads.
- **Renderer recovery isolation** - Session hydration, sidebar activity, live
  transcript projection, and history paging reject stale events from another
  Session while preserving in-flight work.

### Fixed

- Prevented concurrent Session persistence and input admission from restoring
  a draft after a successful send or interrupt.
- Prevented stale Runtime snapshots and history pages from hiding activity,
  duplicating output, reordering turns, or moving content across Sessions.
- Updated the history-repair guard to the published KodaX 0.7.82 package.

### Documentation

- Added the v0.1.36 design and release-readiness record.
- Synchronized README files, the documentation hub, PRD/HLD, Feature List,
  capability ledger, known-issue baseline, user manual, and in-app
  `kodax_manual` with the v0.1.36 / KodaX 0.7.82 baseline.
- Kept F137/F139 scheduled for v0.1.42 and retained unresolved lifecycle and
  performance boundaries as explicit known issues.

### Verification

- Release checks, builtin-skill integrity, typecheck, lint, and the full local
  workspace test suite are required before tagging; GitHub `main` and tagged
  release workflow evidence belongs in the versioned readiness record.

---

## [0.1.35] - 2026-08-05

### Added

- **Learned Skill safety surface (F118)** - Task Dock and `/learn` now expose
  bounded Runtime-owned learned-Skill attention, detail, review, trust, reject,
  disable, and rollback actions. Each mutation is bound to the exact capability
  ID, revision, and fingerprint; event-cursor gaps recover from an authoritative
  snapshot, and `SPACE_DISABLE_LEARNING_MUTATIONS=1` retains a read-only view.
- **Explicit ASRT readiness and setup (F143)** - Settings → Runtime now shows
  doctor-confirmed `Ready`, `Setup required`, or `Unavailable` state together with the ASRT
  version, backend, bounded diagnostics, SDK guidance, and a refresh action. On Windows, setup is
  available only after an explicit in-app confirmation and may then show the one-time UAC prompt;
  setup is serialized, followed by a fresh doctor check, and never runs at startup or from an
  ordinary tool call. macOS/Linux remain guidance-only and Space never invokes a package manager.

### Changed

- **Official KodaX 0.7.80 Registry alignment** - Root and Desktop manifests,
  npm lockfile, installed package, and release gate use the published tarball
  (`sha512-4OuLcI6GcAO20yhsM9bCGMH7xBirLoAtqicDZqafpkSxmrwpYSrJhDItdMyKv00NKdti//1xhwNQgTjQUke20A==`),
  replacing the previous local candidate source.
- **Durable managed-Run contract** - Coder now requires
  `managedRunDurability:1` together with the existing daemon contracts. Space
  publishes the capability in its ledger, binds the precise admitted `runId` to
  each optimistic user row, and preserves Runtime `turnId` on streaming text,
  thinking, and tool events.
- **Auto LLM defaults follow the SDK** - Space no longer pins a retired timeout.
  With no explicit user setting, KodaX 0.7.80 owns the 45-second first attempt
  and 90-second retry; explicit timeout settings still win. The shared SDK/REPL
  deterministic permission analyzer improves ordinary read, search, directory,
  Git, and GET-only `web_fetch` classification.
- **Current self-documentation** - The `kodax_manual`, user manual, capability
  ledger, product docs, and release guides now describe learned-Skill control,
  explicit sandbox readiness, durable Run boundaries, and the 0.7.80 upstream
  limits without treating Worker-hosted `configuredA2A` as a Space Settings
  feature.

### Fixed

- **History/live ownership race** - Late Runtime admission, queued-input
  promotion, and streaming events now retain exact Run/Turn identity, so a
  history revalidation cannot attach a fresh answer to an older query or replace
  an active live projection beneath the user.
- **Release reproducibility** - Formal packages reject the old local tarball
  resolution and require the npm Registry integrity pin before packaging.

### Verification

- Release acceptance includes the exact dependency gate, strict SDK capability
  probe, focused Runtime/renderer regressions, workspace test suite, lint,
  typecheck, production build, package smoke, and GitHub CI for the release tag.

## [0.1.34] - 2026-07-30

### Theme

**Runtime safety, resilient integrations, visible lifecycle control, and truthful packaged
execution.**

### Added

- **Runtime integration health** - Settings and diagnostic export now expose bounded per-domain
  MCP/A2A/Extension source, revision, watcher, last-valid-reload, and diagnostic facts. Space
  follows daemon health changes without reconnecting Coder and automatically shows recovery after
  the named integration file is repaired.
- **Structured Auto and sandbox activity facts** - Auto guardrail v4 side queries project only
  bounded provider/model/stage/timing/size/retry/failure metadata. Active tools show `Sandboxed`,
  `Sandbox fallback`, or `No sandbox`; classifier prompt/response bodies and sandbox activity never
  become transcript content.
- **Space-scoped orphan recovery** - A daemon auto-started by Space negotiates
  `daemonOrphanExit:1` and receives a 30-second idle-orphan grace. Other clients cancel the reaper,
  active governed work drains to terminal state, and ordinary CLI-started persistent daemons keep
  their existing lifecycle.
- **Main-owned startup overlay** - Electron main owns the visible startup/shutdown boundary until
  the current renderer generation is ready. The duplicate renderer loading screen is removed, and
  recovery can restore the real application without a splash-to-shell flash.

### Changed

- **KodaX 0.7.78 Runtime safety baseline** - Root and Desktop install the exact npm Registry release
  (`sha512-D33K2cSFM6Xyi1x8Q2Bwjv6KEGzZIdIlqSN+Odt9MVWgoEb0TCARlaC98ds+M1S+jlhCay+8masnStzbxk6Itg==`).
  Formal builds require the same Registry bytes across both manifests, lock views, installed
  package, dependency closure, and package smoke.
- **Capability-based Runtime compatibility** - Live attachment is decided by negotiated contracts,
  not by a second semantic-version floor. Space requires the existing shared-session safety
  surface plus orphan exit, integration resilience, Skill learning-loop, and Auto guardrail v4;
  any missing required capability fails closed.
- **Auto v4 fallback semantics** - Manually or persistently selected Rules mode remains sticky.
  Classifier timeout, Provider error, or output-contract failure receives one immediate retry;
  exhaustion applies an Accept-edits-compatible fallback only to the current call while
  `engine=llm` remains unchanged.
- **Cross-platform complete-exit contract** - Windows complete exit, macOS `Cmd+Q`, Linux
  last-window exit, and tray-disabled fallback close Coder admission, drain admitted operations,
  inspect Space-local and daemon work, and perform a revision-fenced safe stop while a visible
  control surface remains available. The tray no longer offers “Quit Space, keep Runtime”.
- **Learned Skill roadmap** - F118 moves to `v0.1.35` as a minimum Runtime-owned learned-Skill
  attention/list/detail/review/trust/reject/disable/rollback surface. The unimplemented F137/F139
  native document and semantic UI lane moves intact to `v0.1.36`.
- **Current `kodax_manual` guidance** - The injected self manual now explains 0.7.78 integration
  health, Auto v4, sandbox/fallback meaning, cross-platform complete exit, orphan recovery, and
  legacy daemon cleanup while retaining every installed SDK mechanism topic.

### Fixed

- **Optional integration failures stay optional** - Invalid MCP/A2A/Extension updates retain
  KodaX's last-known-good state and return the exact bounded diagnostic. Poll failures retain the
  previous projection instead of degrading the core Runtime.
- **Transactional integration reloads** - Space validates and constructs MCP candidates before
  replacing cached managers. Invalid global or project documents leave the prior manager set live;
  Settings mutations report `applied`, `not-required`, or `failed`, and revision conflicts require
  reload-and-retry instead of overwriting newer data.
- **Packaged sandbox helper paths** - ASRT and its runtime dependency chain ship under physical
  `resources/node_modules` paths rather than inside `app.asar`, allowing Windows `srt-win.exe` and
  Linux seccomp helpers to spawn. Package smoke runs the public doctor and rejects
  `app.asar`/`ENOENT` helper diagnostics.
- **Complete-exit race and visibility gaps** - A full exit checks Partner, Workflow, permission,
  AskUser, queue, and External Agent work before irreversible teardown. Missing daemon state counts
  as stopped only after an independently verified unowned profile; blocker, timeout, malformed
  output, command failure, or late ownership restores/relaunches Space.
- **Restored interrupt history ordering** - Canonical positional replay keeps a completed interrupt
  response above the next user query after Session switching or restart instead of moving the
  previous answer below the new prompt.
- **Stale 0.7.77 CI assertions** - Runtime compatibility and release-gate tests now require exact
  KodaX 0.7.78, Auto guardrail v4, integration resilience, orphan exit, Skill learning-loop, and
  sandbox contracts instead of failing every build platform on obsolete version/permission
  expectations.

### Verification

- Workspace TypeScript and the complete `npm test` suite pass locally on Node 22.23.1, including
  21 release tests, 1,977 Desktop tests, and 287 IPC-schema tests.
- Release acceptance additionally requires lint, changed-file formatting, production
  renderer/main smoke, Windows/Linux E2E shards, the three-platform smoke-build matrix, and the
  exact evidence recorded in `docs/releases/v0.1.34-release-readiness.md`.
- Packaged macOS/Linux process-level complete-exit acceptance and the upstream asynchronous
  orphan-cleanup retry/verification gap remain explicit under Issue 133; this release does not
  overstate `daemonOrphanExit:1` as a proof of eventual process exit after every cleanup failure.

## [0.1.33] - 2026-07-28

### Added

- **Customer-selectable Coder Runtime mode (F141)** - Settings → Runtime exposes the recommended
  shared Daemon and an Embedded compatibility mode. Space performs an owner-safe transition only
  after active work drains, persists the versioned preference, and restarts automatically. Partner
  remains embedded-inline, and the legacy environment selector is only a one-time pre-v3 migration
  seed.
- **Conversation file actions (F142)** - Conversation paths retain their existing left-click
  behavior and expose the shared viewer/diff/@path/copy/reveal action menu on right-click.
- **Context composition diagnostics** - The Coder context popover now shows a privacy-safe six-part root-input breakdown for system prompt, tool schemas, combined Skills / MCP, messages, request input, and recent tool results. Only category counts cross Space IPC; no prompt, message, tool-input, or tool-output body is projected.
- **Cumulative Session token usage** - Added a separate bottom-bar indicator for Provider-reported usage across root and child Agents. On KodaX 0.7.77 it counts completed physical-request diagnostics once by request ID, including child, retry, fallback, repair, workflow-digest, and compaction-summary calls; older/mocked paths retain the iteration-summary fallback. Its popover leads with total input and distinguishes uncached input, cache-read input, output, optional cache-creation input, root/child call counts, and aggregate/latest cache-hit rates; `/cost` consumes the same cumulative source.
- **Stable prompt-cache routing visibility** - The latest root Provider diagnostic now carries KodaX's hash-only cache-affinity identity through Space IPC and reports when stable routing is active without exposing the key. Custom compatible Providers gain an explicit, default-off opt-in because strict gateways can reject unknown protocol fields.
- **Public Kimi K3 route** - Space consumes the KodaX 0.7.77 public `kimi/kimi-k3` catalog entry and its 1,048,576-token context while preserving the existing Kimi and Kimi Code defaults.
- **Canonical Agent Actor tree** - Runtime-backed Coder Sessions now expose bounded, revisioned native/constructed/Workflow/external Actor and Turn state through validated IPC. Task Dock and Agents surfaces use the canonical tree without leaking child transcript bodies into the root conversation.
- **Configurable main-window close behavior (F140)** - Preferences now offers ask every time, keep running in the tray, or request a safety-gated complete exit. The ask flow can remember a choice; complete exit still refuses to stop active/queued/pending Runtime work or a daemon retained by another client.

### Changed

- **KodaX 0.7.77 Registry alignment** - Root and Desktop manifests now require the exact npm-published 0.7.77 SDK. Space consumes its complete request-envelope/ephemeral-suffix/cache-affinity hashes, delegates interrupt-finalization admission to Runtime, and accepts the CLI bridge's normalized cached-read/cache-creation usage. The lockfile records the official Registry tarball and integrity.
- **Split KodaX integration configuration** - Space now treats `~/.kodax/config.json` as core configuration and consumes the SDK's independently versioned `integrations/mcp.json`, `integrations/extensions.json`, and Runtime-owned `integrations/a2a.json` contract. Global/project MCP discovery, `.mcpb` CRUD, Settings source reporting, and filesystem Extension discovery use public SDK readers; legacy root fields remain read-only migration fallbacks. Settings previews the SDK migration plan and can create missing MCP/Extension files without overwriting destinations or cleaning legacy fields.
- **SDK manual preservation** - The Space `kodax_manual` seeds the SDK-recommended underlying-capability topics instead of clearing all base topics. Same-id Space guidance dynamically composes the exact installed `MANUAL_REGISTRY` body, aliases, and sources, retaining valuable Provider/config/permission/tool/Skill/Extension/MCP/A2A/Session/compaction/SDK facts without copying them into a stale fork.
- **Effective context-window presentation** - The Context window meter and composition percentages now use the final automatic-compaction threshold as their denominator. Model maximum context and auto-compact threshold are presented as independent facts, remaining space is explicitly “until auto-compact,” and reserved response capacity is excluded from active input instead of being shown as compaction headroom.
- **Unified button interaction language** - All enabled application buttons now inherit the Token-usage control's soft semantic sweep, luminous edge, active feedback, and visible keyboard focus treatment. Primary, success, warning, reasoning, and dangerous actions retain distinct colors; portal-mounted dialogs are covered while Windows window controls, Monaco, xterm, disabled controls, and explicit opt-outs keep their own contracts.
- **Current-source toolchain baseline** - Development and CI now read Node 22.23.1 from `.nvmrc` with a Node 22.12 engine floor, `electron-builder` 26.15.3, `node-gyp` 12.2, and `windows-latest`. Windows PE icon/version resource editing uses the pinned pure-JavaScript `resedit` path instead of probing a cached `rcedit` executable.
- **Experimental-memory capability probing** - Space continues to fail fast on a missing or malformed `/experimental-memory` export, but it no longer treats one fixed upstream feature number as the capability identity. The exported contract and bounded policy-version shape are authoritative.
- **Shared Shell execution contract** - Terminal tabs and daemon-backed Coder command tools now resolve the same selected Shell and profile-derived PATH. Windows supports Auto, PowerShell 7, Windows PowerShell, and cmd without accepting arbitrary executables; macOS/Linux keep platform-safe login-shell behavior and sensitive environment variables remain outside the PTY projection.
- **Bounded dense-surface scrolling** - Task/Agent panels use capped scroll containers with explicit edge affordances and stable active-state emphasis, preserving responsive layout without letting long Runtime trees expand the whole sidebar.

### Fixed

- **Safe Runtime-mode switching** - One shared admission gate now covers Runtime-touching Session,
  Slash, Workflow, External Agent, MCP, and Settings operations. Active ManagedSessions,
  running/paused Workflows, non-terminal External Agent tasks, pending permission/AskUser
  interactions, queued Coder prompts, daemon work, and other clients block an unsafe owner change.
  Startup reconciles the persisted mode with owner policy before Runtime connection and fails
  closed on an active or unreadable inline owner.
- **Registry-only packaged SDK** - Packaged builds detect KodaX development staging, replace it with
  the exact lockfile Registry package before electron-builder, and reject unpublished SDK code or
  an incomplete transitive dependency tree such as the observed missing `get-tsconfig`.
- **Packaged dependency and startup verification** - Packaging requires exact agreement across
  root/desktop manifests, both lock views, Registry source/integrity, and the installed SDK. Every
  build verifies all public KodaX facades, ancestor-resolved transitive dependencies, unpacked
  native SQLite loading, and a true Windows packaged application boot.
- **Visible image attachments** - Sent and restored image attachments are visible again as bounded
  thumbnails, including queued and forked Session recovery without exposing native paths.
- **Unambiguous context state** - The context indicator distinguishes the model limit, effective
  compaction threshold, active input pressure, and latest compaction outcome instead of presenting
  one ambiguous percentage.
- **Causally idempotent daemon live reconciliation** - Runtime live-snapshot reads are pure. Daemon transcript events carry their Runtime/run cursor, and each Session pauses delivery across a bounded snapshot request. Held lifecycle, tool, and delta events drain in original order before cumulative reconciliation; per-draft cursor watermarks reject only covered content. Active tools restore causally, stale running cards clear from the authoritative set, unchanged profile refreshes no longer masquerade as connection transitions, and transcript hot-path events no longer rebuild the whole Runtime profile per token. This removes repeated Coder output across local and hosted Providers while retaining reload, reconnect, focus, revision-gap, and terminal recovery.
- **Custom Provider and Runtime catalog convergence** - Space and KodaX-config custom Provider mutations now reconcile transactionally with the shared daemon catalog, preserve Runtime/CLI-only metadata, support explicit context-window configuration, roll back on partial failure, and keep the selected Provider/model valid across startup, update, rename, and removal.
- **MCP and Extension split-file adoption** - User/project MCP reads no longer interpret `config.json` locally, `.mcpb` errors point at the canonical integration file, Settings reports dedicated/legacy/default sources, provides a validated SDK-backed migration action, and managed Extension paths participate in opt-in SDK discovery with entrypoint deduplication.
- **Packaged main-process SDK loading** - `kodax_manual` inheritance now builds from the dynamically loaded ESM-only `/coding` export instead of leaving a CommonJS `require()` in the Electron main bundle, preventing `ERR_PACKAGE_PATH_NOT_EXPORTED` during desktop startup.
- **Daemon-backed Space builtin discovery** - Composer discovery merges installer-owned `frontend-slides` and `huashu-design` with the Runtime daemon catalog by name, preferring the Space entry on collisions without duplicate slash rows and retaining both failure fallbacks.
- **File-reveal failure truthfulness** - `shell.revealPath` now distinguishes an allowed path that is missing, a path outside registered project/KodaX/Space roots, and an OS reveal failure. The renderer shows a dedicated authorization-scope message without widening the filesystem allowlist or adding an arbitrary-path existence oracle.
- **Native SQLite ABI verification** - The Node/Electron `better-sqlite3` probe now catches load failures explicitly and exits nonzero, preventing Electron versions that report an uncaught `-e` exception with status 0 from being mistaken for a compatible native binding or producing a broken package.
- **Cross-Provider token breakdown clarity** - Session usage now leads with total input and labels Provider-reported subsets as uncached, cache-read, and cache-creation input. It explicitly warns that tokenizer and cache-field conventions differ, so a Qwen Anthropic-compatible cold-cache response cannot make a 25k input request look like a six-token request.
- **Context composition snapshot semantics** - The popover now calls `pendingInput` "request input", identifies the breakdown as the latest root-model request snapshot, and keeps six categories visible at zero, with Skills and MCP combined. Completed messages and tool results no longer appear to have been replaced by a still-pending queue.
- **Exact history/live reconciliation** - Durable history and live Runtime events now fold by canonical Turn identity while preserving Runtime-only lifecycle, tool, Artifact, Todo, context and notice events. Restored compaction notices deduplicate, assistant/tool-leading history keeps structural anchors, and reconnect/replay cannot duplicate a delivered user prompt or child output.
- **Session resume and mutation races** - Resume, delete, dispose and persisted-session cache invalidation are single-flight and generation-fenced. A stale asynchronous load cannot repopulate pre-mutation state, and authoritative Runtime running/terminal projections clear stale pending-send or legacy activity indicators.
- **Clipboard image persistence** - Pasted images separate bounded source bytes from the normalized persisted result, validate safe Session ownership without eagerly resuming Provider state, and retain the canonical normalized media type/path across Session recovery.
- **Native desktop test stability** - Desktop tests remain serialized around native SQLite/PTY lifecycle, PTY tests explicitly select the lightweight platform shell where rapid PowerShell ConPTY teardown would otherwise introduce an unrelated helper race, and isolated E2E project seeding now waits for the main-process recent-project mutation before persisting the selected workspace.
- **Calendar-safe Workflow E2E** - Workflow completion receipts accept every supported relative-time unit, including months, so the release gate does not fail when a fixed fixture crosses a calendar-month boundary.

## [0.1.32] - 2026-07-25

### Added

- **F121 released-action daemon adaptation** - Completed the v0.1.31 Coder action inventory and explicit v0.1.32 owner classification. Shared daemon routes now cover session live/history/mutations, settings convergence, queue, AskUser, revisioned permission grants, Workflow observation/control, Learning Center commands, bounded Skill/slash catalogs, MCP tool discovery/reload, and Runtime-configured External Agent Actor/Turns; remaining Space product responsibilities stay explicit host-provider routes.
- **F122 Project Source Library and incremental ingestion** - Added a durable project-scoped source catalog with stable logical identities and immutable versions, backed-up v1-to-v2 migration, file and directory ingestion, bounded PDF/DOCX/PPTX/XLSX structured extraction, per-project FTS5 indexing, explicit Available/Selected/Used state, refresh/retry/rename recovery, cancellation safety, and storage-budget enforcement.
- **F123 stable evidence citations** - Added content-bound citation IDs, immutable evidence snapshots, durable citation and trace metadata independent of the rebuildable index, truthful page/slide/sheet/paragraph/line locators, current/stale/missing access decisions, and an accessible evidence-detail surface that never redirects an old citation to mutable content.
- **F124 Partner Context Broker** - Added Partner-only automatic grounded recall over permitted project material and accepted project knowledge with `project-grounded`, `selected-only`, and `general` scopes, exact selected/used/version traces, bounded evidence packs, prompt-injection delimiters, conflict and unavailable-retrieval notices, and independent rollback gates without routing Partner through the Coder daemon.
- **Runtime-issued exact permission grants** - Coder permission prompts now surface `Allow always` only when KodaX supplies a safe concrete grant suggestion. Space preserves the opaque suggestion ID, presents only a redacted label, and never expands it into a broad shell, tool, or session rule.
- **Reliable attachment projection** - The visible transcript keeps file links while Coder receives Electron-validated native absolute paths; pasted-image artifacts now carry the final normalized media type so mixed clipboard and picker images remain valid multimodal input.
- **F135 vetted Space builtin skills** - Ships `frontend-slides` and `huashu-design` as automatically registered builtin skills outside `app.asar`, with reproducible upstream revisions, approved license hashes, reviewable Space patches, exact per-file integrity locks, and package-smoke enforcement. Space's ordered Huashu adaptation removes default promotional watermark/signature markup and instructions while preserving the upstream MIT license and authorship; the locally installed `pdf`, `pptx`, `xlsx`, and `docx` skills remain excluded because their current license does not permit redistribution.
- **F136 controllable Windows background Runtime host** - Adds a notification-area owner that survives after the last Space window is destroyed, reports bounded Runtime/task/other-client state, reopens a fresh window, closes only the UI, quits Space while preserving Runtime, or requests a safety-gated complete exit.
- **Background Session attention projection** - Adds accessible waiting indicators, project-level waiting counts, and sidebar prioritization so permission or AskUser requests from background Sessions remain discoverable without consuming or misrouting their durable queue entries.

### Changed

- **KodaX SDK 0.7.76 baseline** - Updated both root and Desktop workspaces to exact `@kodax-ai/kodax@0.7.76`. The dependency resolves to the npm-published package with official Registry integrity and no developer-machine `file:` path.
- **Shared Coder contract baseline** - Requires KodaX 0.7.76, Runtime Auto LLM guardrail v3, `permission:grant-admin`, unified Actor/Turn, Learning Center, interrupt input, context compaction v3, transcript paging/search, and the released daemon capability surface; missing contracts fail closed rather than selecting a hidden inline Coder owner.
- **Truthful split ownership** - Updated capability reporting, manuals, and the application `kodax_manual` self-description for the 0.7.76 boundary: Runtime owns the consumed Coder services and exact grant candidates, while Partner, MCP process/log management, Workflow library/start/admin, Space Reference Agent execution, and product artifacts remain Space host-provider responsibilities.
- **Kimi Code direct K3 routing** - Consumes the KodaX 0.7.76 provider catalog where `kimi-code` defaults to the direct `k3-256k` wire model, K3 reasoning defaults to `high`, the `k3` 1M route remains selectable, and both K2.7 Code subscription routes remain available.
- **Explicit Auto LLM session settings** - Space now uses KodaX's typed `resolveAutoModeSettings()` resolver for engine, classifier model, timeout, and `speculativeWindowMs`; it projects missing values into revisioned Runtime settings, preserves another trusted client's explicit value, and exposes bounded timing/terminal-phase diagnostics.
- **Official KodaX 0.7.76 Registry synchronization** - Reinstalled the npm-published package, pinned its official Registry URL, SRI (`sha512-SgMNwa5S…kWzN0lw==`), and tarball SHA256 (`F247511A…0E299021`), and retained the Coder daemon contract at `contextCompaction:3`, `transcriptPaging:1`, `transcriptSearch:1`, interrupt input v1, Actor control v1, and Auto LLM guardrail v3. All 133 published files match the Registry tarball.
- **Auditable builtin-skill checkout** - Builtin sources now pin exact Git commits and force canonical LF checkout bytes, so Windows `core.autocrlf` cannot generate a lock that fails on clean Linux/macOS CI.
- **Agent mailbox and exact-history capability reporting** - Added a distinct `runtime.transcript.search` Space capability and updated the user/developer manuals, capability ledger, release design, and injected `kodax_manual` topics. Model `wait_agent` is documented as mailbox control; Space/SDK progress remains event telemetry and does not imply an Actor capability-version bump.
- **Non-empty CLI auto-resume contract** - Verified the public `findMostRecentResumableSession()` REPL export: it scans a bounded 1000-session window, skips empty ACP placeholders, and returns no candidate when every session is empty. Space keeps its own explicit project/session picker and does not create a second Session owner.
- **Deterministic Space Auto selector** - The desktop selector now displays `Auto[LLM]` or `Auto[RULES]` immediately, accepts rapid consecutive changes without dropping them behind a busy gate, and converges to the last user action while retaining Runtime-owned sticky rules fallback.
- **Session-scoped human interaction presentation** - Permission and AskUser queues stay globally durable, but only the active Session's request is shown as a modal. The current Session and background Sessions awaiting input are prioritized before the sidebar cap; Settings also remains available from both navigation and Files mode.
- **Explicit close and exit semantics** - On Windows, the title-bar close destroys BrowserWindow/renderer resources while the tray keeps the lightweight Electron main host and daemon client visible. Complete exit disconnects Space before asking Runtime to stop and never force-stops active/queued/pending work or a daemon retained by another client.

### Fixed

- **Native-free Partner PDF text Workers** - Partner source PDF extraction now uses pdfjs's non-rendering parser path instead of eagerly loading the unused `@napi-rs/canvas` N-API module in every short-lived Worker. Text, page locators, parser limits, and Worker isolation remain unchanged, while Windows full-test jobs no longer risk a native `0xC0000005` during Canvas module unload.
- **Project HTML File Viewer first-input readiness** - Project previews now capture trusted input inside the preview document until authored classic and module scripts finish initialization, bind the reported state to the exact preview URL, and replace the iframe when the document changes. A visible control can no longer consume its first click before its handler exists, inherit readiness from the preceding document, or lose that click to a lagging cross-process iframe hit-test update; release E2E treats retries as investigation evidence rather than hiding the race.
- **Interactive Artifact first-input readiness** - Interactive HTML frames now capture trusted input until their authored document finishes parsing, then remove the in-document gate before reporting readiness; ready state and iframe lifetime remain bound to the exact Artifact version. Slow runners can no longer lose the first click between control parsing and handler installation, unlock a new version with a stale message, or race a parent-side `pointer-events` transition; the Electron journey uses the same explicit readiness contract without arbitrary sleeps.
- **Paint-committed preview readiness** - Interactive Artifacts and Project HTML previews now retain the trusted-input gate through two child paint frames and publish renderer readiness only after two parent paint frames. Windows out-of-process frames can no longer expose `data-ready=true` before their interactive hit-test surface is committed, and pending readiness from a replaced document is cancelled.
- **Single-click Task Dock opening on narrow windows** - The manual right-sidebar toggle now checks the real viewport before selecting its width mode. On a 1024-pixel Windows runner the first click opens a balanced dock instead of choosing the default width and being hidden immediately by responsive layout.
- **Clean-build Windows tray icon** - Runtime icon generation is now a prerequisite of the shared Electron main build, covering clean development, smoke, E2E, and release builds. A fresh checkout can no longer disable the Windows background tray because ignored generated icon files were absent.
- **Windows extraction Worker teardown** - A successful PDF or Office extraction now lets its Worker exit naturally before the caller settles, with a bounded termination fallback for a stuck Worker. This removes a Windows native-module teardown race that could crash the unit-test process with `0xC0000005` after every assertion had passed.
- **Cross-platform Runtime identity verification** - Ubuntu Electron E2E now runs inside an ephemeral D-Bus Secret Service with a real gnome-keyring, so the suite exercises the same fail-closed OS-keychain boundary as production instead of silently running without the shared Coder Runtime. External-agent status also preserves a bounded Runtime diagnostic, and the A2A regression requires successful capability negotiation before inspecting Settings.
- **Auto permission semantics** - Auto[rules] now allows modeled edits inside the workspace without a confirmation dialog while outside/protected/unmodelled effects remain fail-closed. Auto[LLM] rejects a missing classifier model locally without a Provider request, AskUser prompt, denial/circuit-breaker mutation, or downgrade to rules.
- **Published dependency integrity** - The 0.7.76 lock entry matches the official npm Registry package and contains no sibling-checkout path; clean Registry-only installation is reproducible.
- **Daemon child isolation and admission recovery** - The published launcher filters test-runner imports/loaders from daemon child `execArgv`; normal Space shutdown no longer aborts an accepted daemon run during admission, and transient unhealthy-owner startup windows now reconnect with bounded backoff.
- **Stale Runtime behavior after upgrade** - Space rejects daemon identities older than 0.7.76 with an actionable restart diagnostic. `/auto-denials` reports the effective Runtime version, classifier model, timeout, speculative window, and bounded classifier timing facts.
- **Multi-client settings race** - Auto LLM convergence retries bounded revision conflicts against a fresh Runtime snapshot and cannot overwrite another trusted client's classifier configuration or speculative window.
- **No-session file review and attachment MIME mismatch** - Project files now use the file-viewer path without synthetic Artifact/session fields, while image persistence returns the canonical media type rather than a stale clipboard MIME label.
- **KodaX 0.7.76 Runtime behavior** - The final artifact retains idle-yield user-prompt transcript reporting, crash-recoverable root completion delivery, resident Goal lifecycle contracts, root/child live projection isolation, audited Windows non-interactive child-process hiding, and corrected Sidecar optional-follow-up/budget terminal semantics.
- **Compaction checkpoint and PowerShell boundary closure** - The latest artifact reuses the exact producer checkpoint bytes, including recovery guidance, so the compaction entry, first-kept pointer, and post-compact attachments remain on one active lineage while legacy suffix-free checkpoints still resume. Auto[rules] now escalates PowerShell bracket wildcards on path parameters while preserving exact bracket-bearing filenames supplied through `-LiteralPath` or `-PSPath`.
- **Final 0.7.74 release-review closures** - Continue-most-recent now restores the complete saved interactive state; imperative manual compaction reconciles exact flat Session history into lineage before creating its island; and a failed durable interrupt-delivery event keeps the input queued, rethrows persistence failure, and emits bounded content-free diagnostics.
- **Transcript and clipboard correctness** - Restored assistant/tool-leading history now uses a non-rendered structural anchor instead of fabricating an empty user bubble, and clipboard ingestion prefers the canonical file list so one image cannot enter through duplicate browser representations.
- **UI continuity and accessibility** - Files mode retains the shared Settings footer; full filenames remain available to assistive technology; network preview status tooltips reflect the current state; and temporarily hidden Partner Sources preserve their mounted state.
- **Windows 10/11 live-window taskbar identity** - Main and standalone Artifact windows use an explicit runtime `icon.ico` plus window-level AppID/relaunch details. Portable relaunch metadata now points to the persistent outer executable instead of its disposable `%TEMP%` extraction, and an exact stale KodaX Start Menu shortcut is repaired without touching valid or unrelated user shortcuts. Package smoke verifies the runtime file plus Setup, Portable, and unpacked application PE resources.
- **Other-instance indicator truthfulness** - The sidebar now labels SDK-discovered CLI or other Space processes as `Other KodaX instances`, explains their ownership, and refuses to route unknown peer IDs into empty orphan conversations; locally known Sessions remain openable.
- **E2E daemon teardown race** - Isolated Electron fixtures now repeat ownership-validated daemon cleanup after the app closes, catching a replacement PID created by an in-flight Runtime reconnect and preventing successful suites from ending with a worker teardown timeout.
- **Isolated-test Runtime credential leak** - E2E and packaged boot fixtures now delete only the OS-keychain Runtime client credential named by their own allowlisted temporary profile before removing that profile. Failed launches use the same bounded cleanup path, packaged boot failures report the Runtime initialization reason, and repeated test runs no longer exhaust Windows Credential Manager or strand test daemons.
- **Same-version stale daemon recovery** - A resident daemon with the expected SemVer but missing a required capability is no longer retried forever. Space may retire it and reconnect only after Runtime inspection proves there is no active/queued/pending work and no other attached client.
- **Invisible resident process after window close** - Closing Space on Windows now leaves a visible tray control surface rather than an unexplained background owner; tray initialization failure falls back to ordinary quit-on-close behavior.
- **Managed-task finalization interrupt loss** - Space closes interrupt admission when the authoritative managed-task phase reaches `verifying` or `completed`, returning `interrupt_window_closed` before Runtime can accept an input after the last root queue-drain boundary.
- **Persistent AskUser questions** - User questions no longer inherit a countdown or auto-dismiss timeout; they remain pending until the user answers, explicitly dismisses, or the owning Run terminates.
- **Composer history boundaries** - Up/Down history navigation now takes over only at the absolute collapsed-caret boundary, preserving native multiline and soft-wrapped textarea movement.
- **Historical failed-input placement** - Terminal failed interrupt bubbles are merged at their failure timestamp while live pending/accepted queue overlays remain at the active transcript tail.
- **Complete untracked-directory review** - The right-side Changes tree now expands wholly untracked directories into their individual files instead of counting and displaying the directory as one opaque row; Unicode-safe paths and the 200-file truncation guard remain intact.
- **Windows query console flashes** - KodaX 0.7.76 retains Runtime Worker non-interactive child-process hiding and packaged-host query-path auditing while preserving explicit editor, terminal, and PTY interaction.

### Verification

- The installed-package compatibility probe runs against the npm Registry package and requires KodaX 0.7.76, `runtimeAutoModeGuardrail: 3`, `permission:grant-admin`, interrupt input, Actor control v1, compaction v3, transcript paging/search, typed Auto LLM resolution, exact concrete-grant reuse, workspace-edit auto-allow, and prompt-free missing-model rejection.
- The process-distinct shared-daemon probe starts its settings-event delivery deadline only after its peer has confirmed the mutation, so slow runner startup cannot be misreported as an SDK event failure while a genuinely missing event still fails within a bounded interval.
- Focused Runtime, Sidecar, Windows child-process, permission, attachment, clipboard, schema, Kimi provider-catalog, and queue regressions cover the 0.7.76 contracts alongside the F122-F124 source/index/citation/recall suite.
- Builtin-skill verification rejects license drift, symlinks, unsafe source content, stale patches, broken or escaping local Markdown links, case-insensitive forbidden promotional text, non-Git release locks, and any packaged file-set or byte mismatch. Huashu is regenerated through three ordered reviewed patches (no-watermark baseline, builtin portability, and removal of remaining promotional signatures); branded demo finales are neutralized to `YOUR BRAND`, and the current snapshot contains exactly 260 Space builtin files plus the 8 restored SDK builtin Markdown files.
- Focused tray/daemon-control unit coverage verifies bounded status projection, packaged CLI resolution, fail-closed stop parsing, blocker preservation, and stale-daemon recovery; Electron E2E verifies that close destroys the renderer, the tray reopens a functional window, and final shutdown does not leak the fixture.
- Runtime credential cleanup coverage rejects production paths and non-Runtime accounts; a focused three-app Electron run leaves both the Runtime credential count and isolated-daemon count unchanged.
- Release verification requires workspace type checks, lint, full tests, production renderer/main smoke build, dependency deduplication, packaging, and packaged Electron boot before the `v0.1.32` tag is created.

## [0.1.32-hotfix.0] - 2026-07-17

### Theme

**Emergency multimodal follow-up reliability hotfix for Ark Coding models.**

### Fixed

- **Ark Coding image preflight** - Upgraded to exact `@kodax-ai/kodax@0.7.72-hotfix.0`, which recognizes image input for `doubao-seed-2.0-code`, `doubao-seed-2.0-pro`, `kimi-k2.7-code`, `kimi-k2.6`, and `minimax-m3` instead of rejecting supported routes as text-only.
- **Attachment/send race** - Composer send paths now synchronously wait for every clipboard, picker, drag-and-drop, and folder attachment operation to finish. Pressing Enter immediately after adding an image can no longer send the text before the image artifact has been persisted.
- **SDK compatibility gate** - Updated the published Runtime Worker/external-agent probe to require the exact emergency SDK version.

### Changed

- **Prerelease classification** - SemVer tags with a prerelease suffix, including `v0.1.32-hotfix.0`, are automatically published as GitHub prereleases so the later stable `v0.1.32` remains distinct.

### Verification

- All five Ark Coding routes report image input as supported and pass SDK image-artifact preflight after a clean `npm ci`.
- Attachment gate tests (6/6), the complete `npm test` suite, TypeScript, targeted ESLint/Prettier, and the production `build:smoke` gate pass.

## [0.1.31] - 2026-07-12

### Theme

**Runtime contract alignment, platform trust, semantic control, and exact KodaX 0.7.68 governed-memory integration, while Space keeps explicit ownership of product-specific bridges.**

### Added

- **Runtime Host Adapter (F116)** - Added a Space-owned adapter over `@kodax-ai/kodax/runtime` with process-singleton initialization, capability/ownership diagnostics, stable Runtime run IDs, abort/dispose handling, and restart-only legacy rollback selection.
- **Runtime-backed session operations** - Transcript, compact, fork, and rewind now use the public Runtime facade while preserving Space titles, list/resume filtering, notices, cleanup, sidecars, and renderer IPC contracts.
- **Runtime diagnostics** - `space.version` now reports Runtime identity, selected host mode, isolation, capability state, and explicit Space-bridge ownership without exposing raw Runtime objects or sensitive configuration.
- **Release documentation** - Added the documentation hub, contribution guide, illustrated Chinese user manual, F116 implementation plan, and a dedicated human acceptance guide covering Runtime, Partner, permissions, Workflow, rollback, failure, profile isolation, and shutdown.
- **Packaged `app://space` origin (F055)** - Packaged main and artifact windows now load immutable renderer assets through an exact privileged application origin with canonical path, MIME, symlink/alias, navigation, and CSP guards.
- **Structured diagnostics (F069)** - Added bounded rotating JSONL main-process logs, recursive secret/content/path redaction, safe renderer envelopes, direct Runtime/Workflow/updater/control events, and an explicit Settings ZIP export with reviewed categories and no remote upload.
- **Natural-language Space control (F120)** - Added governed `space_control_inspect` / `space_control_apply` SDK tools for eight desired-state actions, a complete control classification inventory, primary-renderer execution/readback, short-lived argument-bound preconditions, renderer-reload protection, and idempotent receipts.
- **KodaX 0.7.68 Memory Agent contract** - Root and desktop workspaces now resolve the exact published npm package. Startup verifies `/experimental-memory`, `createMemoryAgent`, `createMemoryControlPlane`, and policy `f260-v0.7.68.2`; `space.version` and diagnostic export expose a truthful partial capability without inferring it from the version string.

### Changed

- **Managed-run ownership** - New Coder and Partner turns start through Runtime `runs.start()` in embedded inline mode. Existing Space callbacks remain the single renderer event projection and continue to bind Partner profiles/tools, permissions, AskUser, artifacts, extensions, queues, and terminal normalization.
- **Explicit compatibility bridges** - Workflow lifecycle remains on `WorkflowController`; MCP process/log ownership remains on Space `McpManager`; External Agent durable registration/task/event storage remains on `ExternalAgentGateway`; Skills remain on the current public Skill bridge. Worker and daemon Runtime modes remain unavailable for live Space sessions.
- **Profile-scoped Runtime journal** - Runtime receives the selected Space/KodaX sessions directory and writes run/event journal data below `<profile-root>/.kodax/runtime`, following `KODAX_HOME`, `KODAX_PROFILE_DIR`, and onboarding-test isolation.
- **Project session summary loading** - Sidebar project/surface windows now share one bounded global summary-index snapshot, cache completed and empty reads with watcher-driven invalidation, coalesce duplicate requests, and retain a precise fallback when the global bound is saturated.
- **SDK tool context preservation** - Space now retains SDK `toolCallId` and `taskSurface` (`cli`/`repl`/`plan`) while keeping Coder/Partner attribution separately bound to the authoritative session.
- **Shared semantic executors** - Deterministic theme, language, Surface, Settings, sidebar/Task Dock, layout preset, and reasoning-default entry points share owner functions with F120 instead of maintaining model-only mutation paths.
- **Governed-memory lifecycle adaptation** - Top-level managed runs let KodaX own silent scoped recall, read-only `memory_recall`, Outcome Digests, and bounded review over the existing F228 plane. Space attaches metadata-only review/notice/outcome/receipt diagnostics and deliberately leaves the full F117 Episodes, Activity, correction, forget, and purge UX gated.

### Fixed

- **Runtime transcript freshness** - Runtime-backed transcript caches are invalidated after compact, fork, and rewind mutations so follow-up reads cannot project stale history.
- **Compact and terminal normalization** - Compact failures return one bounded Space error result, and Runtime completion/failure/cancellation produces exactly one renderer terminal event.
- **Workflow ownership regression** - Reverted an over-eager Runtime Workflow migration that lost Space stop reasons, immediate cancellation projection, durable restart merge, origin metadata, and result/artifact bridges.
- **Concurrent run race** - Same-session concurrent starts reserve ownership before asynchronous Runtime setup, preventing two accepted runs from bypassing the single-active-run invariant.
- **Project session scope fidelity** - Project-scoped summaries that omit workspace/git-root metadata retain the validated requested project instead of being grouped under the filesystem root.

### Documentation

- **Current capability truth** - README files, user/developer manuals, application `kodax_manual` topics, PRD, HLD, capability ledger, Feature List, known issues, feature design, and acceptance guidance now consistently describe the Runtime-native slice and Space-owned bridges.
- **Memory self-knowledge** - `kodax_manual` and release documentation explain the 0.7.68 Memory Agent ownership, silent low-authority recall, read-only deliberate query, F228 governance path, current diagnostics, and the remaining F117 boundary.
- **User-oriented guidance** - Added Mermaid flows, an interface map, first-task walkthrough, Coder/Partner/Quick Ask selection, permissions, session lineage, Task Dock/popouts, data locations, security boundaries, and troubleshooting.

### Security

- **No mid-run fallback or replay** - Runtime failures never silently replay a prompt on the legacy path, preventing duplicate tool or file side effects. The temporary rollback is selected only before process startup through `KODAX_SPACE_RUNTIME_HOST=legacy` and requires an application restart.
- **Fail-closed ownership** - Renderer inputs cannot select Runtime endpoints, callback factories, profile directories, credential brokers, or isolation modes. Unsupported Worker/daemon and Runtime-owned bridge claims remain unavailable rather than inferred from the SDK version.
- **Test profile isolation** - Automated coverage verifies Runtime data follows explicit homes/profiles and that onboarding tests override inherited user homes, preventing CI/E2E writes to the real user profile.
- **Semantic control fail-closed policy** - Missing tool IDs, stale/expired preconditions, project/session/surface mismatches, renderer reloads, auxiliary senders, conflicting retries, Plan-disallowed actions, malformed arguments, and timeouts cannot silently mutate or replay application state.
- **Diagnostic privacy boundary** - Prompts, tool/document content, credentials, authorization material, secret-like URLs, environment secrets, and private path prefixes are redacted before every file/export sink; renderer diagnostics cannot choose paths or arbitrary keys.
- **Memory diagnostics privacy** - Memory lifecycle logs record only categorical state and bounded counts; objectives, summaries, proposal IDs, evidence refs, and remembered bodies never enter ordinary diagnostics.

### Verification

- Exact KodaX 0.7.68 dependency/export/Runtime probes, 4 release-script tests, 245 IPC schema tests, 1417 passing Desktop tests (1 platform-permission skip), TypeScript, ESLint, production build, Windows Setup/Portable packaging, asar/package smoke, and packaged `app://space` boot all pass.
- Playwright Electron passes 58/58 in one clean serial run. The package smoke executes the 0.7.68 Runtime and constructed-handler Workers from `app.asar` and verifies the required `sdk-experimental-memory.js` entry.

## [0.1.30] - 2026-07-12

### Theme

**Partner workspace-first working-agent foundation plus KodaX 0.7.67 external-agent orchestration: one policy-filtered catalog, executor plane, durable task ledger, and shared Worker/Workflow dispatch path.**

### Added

- **External Agent Gateway foundation (F115)** - Added a Space-owned persistent host for KodaX's protocol-neutral `AgentExecutorPlane`, with redacted registration IPC, live dispatchability projection, durable task/event storage, main-process policy/credential/artifact boundaries, and shutdown-safe lifecycle.
- **Reference Executor management** - Runtime Settings can create, edit, enable/disable, remove, preflight, and conformance-test Reference Agent registrations. Cards expose only redacted descriptors, live dispatchability, skills, effects, and opaque IDs.
- **Workflow Agent target selection** - Workflow Launcher can select a live policy-filtered Reference Agent as the default target for ordinary child spawns, performs revision-aware preflight immediately before start, and preserves targets explicitly authored in Workflow source.
- **External tasks in Task Dock** - External child tasks now have a dedicated lifecycle surface with independent task/cancel states, output and safe artifact/usage summaries, event timeline, input-required continuation, cancellation, and unknown-state reconciliation.
- **Bilingual product UI** - All Reference Agent management, Workflow routing, lifecycle and intervention copy is available in English and Simplified Chinese, with keyboard-accessible controls and bounded long identifiers.
- **Worker and Workflow bridge** - Existing live sessions and explicit Workflow launches receive the same `agentExecutorPlane` binding. KodaX Workers can discover agents through `list_dispatchable_agents` and route opaque `agent_id` values through `dispatch_child_task`, `task_output`, and `task_stop` without Space maintaining a second task state machine.

### Changed

- **KodaX 0.7.67 SDK catch-up** - Root and desktop workspaces resolve the exact published `@kodax-ai/kodax@0.7.67` tarball. The compatibility gate now proves both the Worker hard-dispose contract and the external-agent Runtime catalog/start/wait round trip.
- **Cost-disciplined orchestration** - Space consumes KodaX 0.7.67's focused review/workflow routing, structured handoff, model-tier intent, and route telemetry through the existing SDK execution paths.

### Fixed

- **Reference continuation persistence** - Added a Reference-only reconcile after `sendInput` so a slow durable store cannot retain the intermediate `working` snapshot when the 0.7.67 conformance executor completes in the event-pump handoff microtask. Real protocol adapters keep their native event semantics.
- **Product acceptance coverage** - Added Electron journeys for management, localization, Workflow selection, input-required continuation, cancellation, audit visibility, and responsive Task Dock presets; the complete 58-test Electron E2E suite passes.
- **External-task audit pagination** - Cursor advancement now follows only the bounded page returned to the renderer, and Task Dock follows subsequent pages without skipping long-task audit events.
- **Catalog identity, window authority, and session scope** - Reference edits require an existing host-issued registration, external-agent administration is restricted to the primary application window, task starts derive project/session attribution from the main-owned KodaX session, and every task read/intervention verifies the stored parent session.
- **Task Dock race and polling control** - Session changes now clear external-task state immediately, late responses are rejected by captured-session checks, and non-overlapping polling slows for terminal or background views instead of issuing fixed full snapshots every 1.5 seconds.
- **Project Session loading feedback** - Project/session scopes now distinguish loading, loaded, and failed states, land independent project results without waiting for the slowest request, reject stale surface responses, and show bilingual skeleton/retry UI only while no restored rows are available.
- **Project Session refresh performance** - Sidebar scopes now share one bounded global summary-index snapshot instead of rescanning the full JSONL tree once per project, cache empty Coder/Partner results with watcher-driven invalidation, coalesce duplicate reads, and avoid duplicate per-session runtime sidecar work.
- **Responsive Task Dock width presets** - Default width now follows a bounded 30% comfort ratio, explicit half mode remains a true center/dock split, and max mode turns Task Dock into the full remaining workspace while keeping the hidden conversation mounted so its scroll state survives restoration.
- **Workflow routing audit** - Default-target wrappers preserve the SDK Workflow API receiver, and preflight's resolved configuration revision is snapshotted for dispatch and host metadata even when callers omit an expected revision.
- **Version-safe package smoke** - Packaged Runtime probes now derive Space and KodaX versions from root metadata instead of rejecting every version after 0.1.30 / 0.7.66.

### Documentation

- **Current capability alignment** - README files, user/usage manuals, machine-readable `kodax_manual` topics, PRD/HLD baseline notes, capability ledger, feature ledger, known issues, and F115 acceptance guidance now consistently describe 0.1.30 as the KodaX 0.7.67 Partner/Reference Agent release line.

### Security

- **Fail-closed protocol rollout** - A2A, MCP Tasks, and governed HTTP remain explicitly false in Space capability status because 0.7.67 ships only the neutral plane and Reference Executor. No renderer API receives executor config, credential references, secrets, or mutable SDK plane handles.
- **Durable local boundary** - External-agent registrations, tasks, and events use bounded, atomic files under `~/.kodax/space/external-agent-plane`; unsafe aliases, oversized store entries, remote artifacts, and credential resolution are denied by default in the Reference tranche.
- **Renderer capability boundary** - Artifact and auxiliary windows cannot call external-agent administration/task IPC, and task IDs alone are insufficient to read or mutate work outside the main-selected session.

### Partner workspace-first foundation

**Partner working-agent foundation: mode-first task entry, workspace-first delivery, controlled writes, durable knowledge, and bounded coding boosts; initially validated on KodaX 0.7.66 and shipped on 0.7.67.**

This release re-enables Partner around one composer-first mental model. The user chooses a broad work mode, provides the task and sources, and lets Partner infer the detailed capability playbook and deliverable shape. Outputs are no longer limited to a small format list: Partner has a writable run workspace, an indexed delivery browser, checkpointed project writes, strict review fallback, and small isolated helper scripts when coding materially improves knowledge work.

#### Added

- **Mode-first Partner workbench (F095)** - Added document processing, financial services, data analysis and visualization, deep research, product management, slides, design, and email editing modes. Task routes, source use, tools, and output shape are inferred from the selected mode plus the composer request; Advanced remains an override surface.
- **Workspace-first Partner delivery (F114)** - Added per-session writable run-output roots, arbitrary bounded file delivery, a durable delivery registry, known-format rich preview, and metadata/reveal/copy-path handling for unknown formats.
- **Checkpointed and reviewed writes (F113/F114)** - Added hash-guarded file checkpoints, diff previews, rollback, and reviewed proposals for strict or sensitive project-file changes. Concurrent user edits fail closed instead of being overwritten.
- **Office/PDF baseline writers (F109)** - Added deterministic DOCX, XLSX, PPTX, and Unicode PDF generation as convenient structured output paths, without making those formats the Partner ceiling.
- **Partner Sources and Knowledge Base (F070-F074)** - Sources can be staged before the first Partner session and attached on send. The project-scoped KB adds CJK-aware lexical search, source references, configurable policies, lint/freshness diagnostics, and persisted manual maintenance reports.
- **Bounded coding boost** - Partner can write task-local JavaScript helpers in its output workspace and execute them through a one-shot Worker plus capability-free VM. Helper inputs, logs, writes, time, memory, and payloads are bounded; shell, package managers, dynamic import, environment access, subagents, and unrestricted filesystem access are absent.
- **Local policy and audit (F098)** - Added Space-owned policy guards, redacted audit records/export, and a compact local Policy & Audit surface for Partner source, artifact, delivery, proposal, and workspace actions.

#### Changed

- **KodaX Runtime foundation** - The initial Partner tranche validated the 0.7.66 `/runtime` export and Worker sidecars; the final 0.1.30 package supersedes that dependency with exact KodaX 0.7.67 and extends the compatibility gate through the external-agent Runtime round trip.
- **Runtime adoption boundary** - Space validates `embedded + worker`, `requirements.hardDispose`, protocol metadata, and session-service parity, but does not migrate live 0.1.30 sessions or Partner helpers to the shared daemon. The daemon DTO boundary rejects process-local callbacks, and the SDK does not yet expose a general per-invocation execution service that directly replaces `run_partner_helper`.
- **Unified Partner composer** - Removed the separate top-level start-task interaction. Sending from the normal composer creates/resumes the Partner session and attaches any staged sources, keeping task start and follow-up conversation in one place.
- **Output selection is open by default** - The normal path is a run workspace. Office/PDF creation and reviewed workspace text are convenience/strict modes, not fixed output requirements.

#### Fixed

- **Partner write and source hardening** - Closed path traversal, symlink/hard-link alias, race, encoding, hashing, and corrupt-store edge cases across source extraction, delivery writes, checkpoints, proposals, and durable stores.
- **Office/source reliability** - Isolated PDF and Office parsing from Electron main, added ZIP expansion guards and document limits, fixed Unicode PDF output, and moved DOCX/XLSX/PPTX preview parsing into disposable bounded workers.
- **Node 20 extraction-worker compatibility** - Source-mode document extraction now boots through the programmatic tsx importer, avoiding Node 20's `.ts` Worker entrypoint resolution failure while packaged builds continue to launch the compiled sidecar directly.
- **Release and updater integrity** - Normalized installer asset names to `KodaX-Space-*`, added the ZIP payload required by the macOS updater for x64 and arm64, merged both architecture manifests without silent overwrite, and made release staging reject metadata URLs that do not resolve to an identically named asset.
- **Queue and session continuity** - Fixed active queue watchers consuming Partner follow-ups, kept session/runtime metadata coherent through rollback and deletion, and restored a usable composer after Partner session removal.
- **Partner discoverability honesty** - Suppressed unavailable executable Skills from Partner while preserving Coder discovery, and added in-app preview from the Outputs delivery browser.
- **Composer local attachments** - "Add files or photos" now supports unrestricted multi-select instead of opening the project-directory picker. PNG/JPEG/WebP use the sandboxed image-artifact path, while documents, other image formats, archives, and unknown extensions remain selectable file references. "Add folder" now attaches a directory reference instead of silently switching the current workspace.
- **Session history visibility** - ACP protocol sessions are excluded before Space applies its recent-history limit. The 200-row window is now independent per project and Coder/Partner surface, so one busy project or surface cannot make another appear empty. Cursor-capable SDK builds are consumed page by page, while KodaX 0.7.66 retains a bounded compatibility read; the project session picker loads and searches the complete bounded project history on demand. Existing JSONL records, including the SDK `_unknown` compatibility bucket, remain untouched.
- **Test data isolation** - `KODAX_TEST_ONBOARDING` now redirects the KodaX SDK home as well as Space and Electron data, preventing Electron E2E runs from reading or writing the real `~/.kodax/sessions` tree.

#### Security

- **Isolated Partner helpers** - Each helper runs in a disposable Worker with hard wall-clock termination and V8 resource limits. A capability-free VM receives only cloned input and a serialized file snapshot; the parent independently validates and applies the write journal.
- **Fail-closed file mutation** - Sensitive names/extensions, paths outside allowed roots, alias escapes, oversized content, stale hashes, and conflicting rollback targets are rejected. Durable state uses atomic writes and preserves corrupt originals for diagnosis.
- **KodaX Runtime capability verification** - A compatibility gate proves the published 0.7.67 Worker Runtime satisfies hard-dispose, rejects inline downgrade, and completes the Reference external-agent round trip, while packaged smoke prevents missing Runtime/constructed-handler sidecars.

## [0.1.29] - 2026-07-08

### Theme

**Workspace Environment Hub + Task Dock + Floating Surface Host, with Memory Governance, scoped Markdown agents, KAI-FCL licensing, and KodaX 0.7.63 baseline alignment.**

This release ships the F103 shell redesign: a Codex-inspired Environment Hub for project/location/branch/source routing, a right-side Task Dock for run/plan/agents/workflow/changes/sources/artifacts/context detail, and a Floating Surface Host for popouts and blocking modals. It also brings the Memory Governance surface over the SDK memory control plane, enables scoped Markdown agents, refreshes the manual, and aligns release metadata to `0.1.29`.

### Added

- **Workspace Environment Hub and Task Dock (F103)** - Added the compact Environment Hub for Changes, Local, Branch, Commit/Push, Sources, Task Dock, and Context routing. The right sidebar now acts as a Task Dock with Run, Plan, Agents, Workflow, Changes, Sources, Artifacts, and Context sections.
- **Floating Surface Host** - Popouts and blocking modals now share surface policy for z-index, backdrop, Escape handling, focus trap/restore, and topmost-surface behavior.
- **Memory Governance Surface (F088)** - Added a Coder-only Memory popout, `memory.*` IPC schema/service, and upgraded `/memory` slash commands over KodaX 0.7.62's `MemoryControlPlane`. Users can review pending memory proposals, approve with preview fingerprints, reject proposals, inspect approved refs, run curator reports, and test deterministic memory packs while Partner KB remains separate.
- **KodaX 0.7.62 `ask_user` custom input** - Space now supports the SDK's default-on custom input option for select questions. The ask-user modal can render an "Other" answer, collect free text, and return `{ kind: 'customInput', value }` through IPC back to the SDK, including multi-select answers.
- **Scoped Markdown agents** - Markdown agent discovery/runtime paths are wired through the SDK 0.7.63 runtime so Space can activate scoped project agents without exposing them as global state.

### Changed

- **KodaX 0.7.63 SDK catch-up** - Root and desktop workspaces resolve `@kodax-ai/kodax` `0.7.63`, while Memory Governance continues to consume the 0.7.62 controller surface introduced upstream.
- **Right sidebar opens only when useful** - The Task Dock no longer restores stale open state on startup; Environment Hub routes and task-relevant signals focus the appropriate section when needed.
- **Run projection performance** - The pinned summary and Task Dock Run section share one cached run projection so high-frequency task status updates do not repeat expensive agent/status grouping.
- **Environment Hub interaction honesty** - Commit/Push now opens an explanatory menu and clearly marks commit/push actions as not yet wired, while still offering a direct route to review changes.
- **Project license switched to KAI-FCL** - Current and future official KodaX-AI distributions for KodaX Space 0.1.27 and later use the source-available KodaX-AI Fair Core License (`KAI-FCL`) or accompanying customer terms when distributed with that notice. Historical tags, source archives, installers, or other copies already distributed with Apache-2.0 notices remain under Apache-2.0 for those specific copies; dependency license metadata is unchanged.
- **Manual refresh** - The Chinese user manual and release planning docs now describe the Environment Hub, Task Dock, Memory Governance, and current 0.1.29 behavior.

### Fixed

- **Task Dock review closeout** - Fixed stale right-sidebar preference handling, misleading Sources counts, duplicate Run projection work, and the old subagent compact view that surfaced worker rounds instead of semantic agent status.
- **Read-only file previews** - Opening project files in the Artifact surface now uses a transient preview payload instead of persisting visited files into the generated-artifact list.
- **Toolbar regression coverage** - Added E2E coverage for opening the Review popout from the Activity views toolbar, while keeping the layout-position test focused on popout geometry.
- **Workflow and React 19 type compatibility** - Workflow renderer files now import the React 19 JSX types and include renderer `.d.ts` files in the desktop TypeScript project.

## [0.1.28] - 2026-07-06

### Theme

**React 19 upgrade + KodaX 0.7.61 SDK catch-up — with a packaged-build Terminal fix (node-pty) and bash-output-compression rendering, plus a full documentation refresh.**

This release upgrades the renderer to React 19, catches up to KodaX SDK `0.7.61`, surfaces the SDK's new bash-output compression in the tool cards, and fixes the built-in Terminal in packaged installers. Documentation was refreshed across the per-version feature docs, `FEATURE_LIST`, and a new Chinese user manual.

### Changed

- **React 19** - The desktop renderer and `@kodax-space/space-ui-kit` now run on React `19.2.7` / react-dom `19.2.7` (up from 18.3), with `@types/react` / `@types/react-dom` on 19.x and the UI-kit's React peer range widened to `^18.0.0 || ^19.0.0`. A small ambient `JSX`-namespace shim (`apps/desktop/renderer/src/types/react-jsx-compat.d.ts`) preserves the pre-19 global `JSX.Element` types the renderer relies on, so the upgrade is type-transparent to existing components.
- **KodaX 0.7.61 SDK catch-up** - Root and desktop workspaces resolve `@kodax-ai/kodax` `0.7.61`.
- **Smaller installer** - `.pdb` native debug symbols are excluded from the packaged bundle.

### Added

- **Bash output compression surfaced in tool cards** - When KodaX (`0.7.61`) compresses a bash tool's output, the tool card now shows a "compressed" marker with the filter(s) that applied, and — when the full raw output was saved to disk — a clickable link to open it. The recovery-hint boilerplate is stripped from the displayed result so the card stays clean.
- **Chinese user manual** - A new `docs/USER_MANUAL.zh-CN.md`, alongside a refreshed pass over the per-version feature docs and `docs/FEATURE_LIST.md`.

### Fixed

- **Built-in Terminal works in packaged installers** - `node-pty` and its conpty/winpty helper binaries are now shipped under `resources/node_modules/node-pty` on Node's runtime module path, instead of being left to electron-builder's native rebuild (which skips this workspace-only dependency and left the packaged Terminal unable to spawn a shell). `scripts/smoke-pack.mjs` now asserts the node-pty prebuilds are present in the built installer so this can't silently regress.

## [0.1.27] - 2026-07-05

### Theme

**KodaX 0.7.57 → 0.7.60 SDK catch-up — workflow engine + Workflow Harness GUI, license-gated repo-intelligence, sandboxed interactive HTML artifacts, multi-select `ask_user`, and a focus/confirm-dialog fix — plus portable-build and release hardening. (The Partner surface ships but is disabled behind a flag until its deliverable chain lands.)**

This release consumes the KodaX `0.7.57` through `0.7.60` SDK surfaces. It lands the workflow-engine wiring with a hard Coder-only spawn fence, restores workflow result notices in-place from the SDK transcript, gates repo-intelligence behind license activation (closing a `/workflow` bypass), and fixes the portable build so workflows are visible. The Partner three-column workspace is built as a capability-composed surface on the shared runtime (per [ADR-007](docs/ADR/ADR-007-partner-surface-model.md)) but is disabled (`PARTNER_ENABLED=false`) until complete. Reviewed by code-reviewer + security-reviewer before tagging; all HIGH findings were fixed.

### Added

- **Partner Sources** - Attach workspace files/directories to a Partner session; the agent reads them through a read-only `partner_source_read` tool that re-validates the Partner surface and matching `projectRoot` from the trusted run context on every read. New `partner.sources.*` IPC channels validate paths (control-char rejection, project containment via `resolveInsideProject` + `assertAllowed`).
- **Partner Knowledge Base** - A local, per-project persistent knowledge store (`partner-kb`) with dedicated tools, scoped by canonicalized `projectRoot` and persisted atomically to Space's data dir.
- **Partner agent profile** - Partner runs bind a distinct identity + tool-visibility policy via the SDK `agentProfile` surface (KodaX FEATURE_247); `run_workflow`/subagent-spawning tools are excluded from the Partner tool schema.
- **Multi-select `ask_user`** - The ask-user modal supports single- and multi-select questions with `min_selections` / `max_selections` bounds and an optional (`min_selections: 0`) mode (KodaX FEATURE_222), with schema-level consistency validation.
- **Interactive HTML artifacts** - A new `interactive-html` artifact kind renders in a sandboxed iframe (`allow-scripts` without `allow-same-origin`, `no-referrer`) behind an injected `default-src 'none'` CSP. External scripts are HTTPS-only and require SRI; the permission schema is enforced both at the renderer→main IPC boundary and inside the `create_artifact` tool handler.
- **Custom provider reasoning effort** - The custom-provider credential form can declare a reasoning-effort default, round-tripped through the provider config without dropping it on edit.

### Changed

- **KodaX 0.7.60 SDK catch-up** - Root and desktop workspace dependencies now resolve `@kodax-ai/kodax` `0.7.60`. Space maps its existing five effort choices to the SDK's canonical `effort` field at the real-session and workflow boundaries, and reads the KodaX config `effort` default before falling back to legacy `reasoningCeiling` / `reasoningMode`. Workflow host policy forwards `tokenBudget` unconditionally (0 = unlimited, treated as unbounded by 0.7.59+, no longer clamped to a 1-token run).
- **Workflow host limits** - The workflow policy section now exposes only runtime caps (max agents / concurrency / token budget, clamped to KodaX ceilings). Host-side natural-language workflow auto-start was removed in 0.7.58 — that decision now happens inside AMAW — and the Partner surface is fenced out of every workflow-spawn path (`assertCoderSurface` at the controller `start`/`create`/`rerun` methods, the `/workflow` slash command, and the trusted server-resolved surface at the IPC layer).
- **White-label manual topics** - Space Manual topics can be white-labeled per the KodaX `0.7.58` manual surface (FEATURE_221).
- **Built-in repo-intelligence diagnostics** - `/repointel status` uses the KodaX built-in repo-intelligence inspection API for worker/cache/mode diagnostics, and `/repointel warm` triggers the SDK's best-effort prewarm path for the current project.
- **Transcript artifacts derived incrementally** - Transient (transcript-only) artifacts are now maintained in a per-session store table updated on `create_artifact` results, instead of re-scanning the full event log on every streamed token in the always-mounted right sidebar (fixes an O(n²) hot path; matches the existing derived-table pattern).
- **Partner surface temporarily disabled** - The `[Partner]` surface tab is greyed out (`PARTNER_ENABLED=false`) until its end-to-end deliverable chain is complete; the underlying Partner code (profile, sources, knowledge base) ships but is not user-reachable this release. Re-enabling is a single flag flip.
- **Repo-intelligence gated behind license** - Repointel (`/repointel` status/warm and background repo indexing) now activates only under a valid license, aligning the feature with entitlement policy.
- **Workflow token-budget policy** - The per-run token budget defaults to `0` (unlimited) and only an explicit user cap is bounded, now to a `100,000,000` ceiling (was 200k); max agents (64) and max concurrency (16) ceilings are unchanged.

### Fixed

- **Confirmation dialogs no longer trap keyboard focus** - Native `window.confirm` steals the renderer's keyboard focus under Electron's `sandbox: true` and never returns it, leaving the composer unusable after confirming. All confirmation prompts (custom-provider delete, workflow run/saved-workflow delete, workflow preflight, project context-menu actions) now use the in-app `ConfirmDialog`, which returns focus to the composer on close. The dialog also renders above every other overlay (raised above the Settings modal) so confirmations triggered from within a modal stay visible and clickable.
- **Partner Sources / Knowledge Base i18n** - The Partner Sources panel and workspace toggles are now fully bilingual (en / zh-CN) instead of English-only.
- **Repo-intelligence trace compatibility** - `session.event` accepts the built-in repo-intelligence modes (`off` / `light` / `full`) while preserving older Repointel mode values for historical events.
- **Workflow transcript ordering & dedup** - Workflow notices keep chronological position (session messages carry real per-message timestamps again), live run progress (agent spawned / phase started) is no longer duplicated into the transcript (it stays in the right-sidebar live ticker), per-agent summaries dedupe to exactly one keyed notice per agent, and phase grouping is corrected. AMAW runs are restored after an app restart.
- **Workflow result notices restore in-place** - On reopen, a workflow run's result/failure notice is restored from the SDK transcript's `<task-completed>` synthetic message at its real position, instead of being re-merged from a side-store by wall-clock time — which mis-ordered or pinned notices to the top after SDK compaction flattens transcript timestamps.
- **Portable build shows workflows** - The portable executable no longer forks Space's data directory away from `~/.kodax` (the old `PORTABLE_EXECUTABLE_DIR` redirect left workflow state in an empty folder next to the exe while the SDK still read the real home, so sessions looked fine but workflows were empty). A new `KODAX_PROFILE_DIR` override keeps Space data and the SDK's sessions dir in sync.
- **GLM-5.2 context window** - KodaX `0.7.59` fixed the `resolveModelCapabilities` default-model bug (GLM-5.2 on coding-plan providers now reports its real 1M window); Space's runtime cascade already resolved this correctly and remains the source of truth.
- **e2e stabilization** - The language-switch spec asserts on the still-present "Workflow host" section (the autostart control was removed upstream); notifications-surface hover/geometry checks are hardened; provider-delete specs drive the in-app `ConfirmDialog`; workflow-events / token-budget expectations track the new behavior; and Partner-surface specs are skipped while `PARTNER_ENABLED=false`. Mock-turn-dependent specs remain skipped on Windows CI only (they stall under CI load), with Linux CI + local retaining coverage.

### Security

- **Partner workflow spawn fence (verified)** - Confirmed the Partner surface cannot spawn workflows/subagents: the controller-level `assertCoderSurface` gate, the `/workflow` slash guard, the server-side (non-renderer-forgeable) session surface at the IPC layer, and the Partner tool-visibility policy all enforce it, backed by a dedicated test.
- **Interactive HTML sandbox** - Scripted artifacts execute only in an opaque-origin sandboxed iframe (no `allow-same-origin`) under a strict injected CSP with HTTPS-only, SRI-pinned external scripts, so a hostile artifact cannot reach the host renderer, Node, or Electron APIs.
- **Repo-intelligence license gate (closed `/workflow` bypass)** - Repo-intelligence is a licensed capability; previously only the chat-turn path was gated, so the Workflow Harness (`/workflow`, Workflow Panel IPC, generate/revise/module launches — which build their own runtime context) gave unlicensed users full repo-intel on every workflow sub-agent. The controller launch path is now gated fail-closed, and all license checks (`real-session`, `version`, `ipc/repointel`, `slash/builtin`) fail closed on a license-subsystem I/O error rather than rejecting the handler or hanging the turn.

## [0.1.26] - 2026-06-27

### Theme

**Release hardening — Electron security pin + reproducible installs, with composer drag/drop completion, an optional sprite mascot, and desktop responsiveness/i18n polish.**

This release closes out the F107 SDK catch-up / F108 composer-file-reference batch and focuses on release readiness: Electron is pinned to a CVE-clean version while preserving the existing Linux compatibility floor (Debian 10 / glibc 2.28, which keeps 麒麟/Kylin V10 enterprise targets supported), installs are made reproducible (`npm ci` + exact-pinned native dependencies), and a round of UI/navigation/artifact hardening lands.

### Added

- **Sprite mascot mode** - The composer mascot now has a three-way mode (`legacy` / `sprite` / `off`, persisted) with a new pixel-sheet sprite renderer (see [ADR-008](docs/ADR/ADR-008-mascot-soft-rig-animation.md)). The previous on/off toggle is preserved as a backward-compatible view of the new mode.
- **Native clipboard image fallback** - Pasting an image with no usable text payload now persists the bitmap through the main-process clipboard sandbox and attaches it as an image artifact, reusing the OC-31 image path. Non-image `Files` paste interception is intentionally not added.

### Changed

- **Electron pinned to 42.5.0** - The desktop runtime is pinned to an exact, currently-supported Electron version. This keeps the documented Linux runtime floor at Debian 10 / glibc 2.28 (verified by Electron's own platform-support matrix across 33/40/42), so Kylin V10 (麒麟, glibc 2.28) and other enterprise Linux targets continue to run, while clearing the security advisories below. The esbuild main-process target stays aligned with the bundled Node runtime (`node24`).
- **Reproducible installs** - CI and release prefer `npm ci` (lockfile-exact, with an `npm install` fallback for resilience), a repo-level `.npmrc` enforces `save-exact=true`, `better-sqlite3` is exact-pinned (`12.11.1`) for native-ABI stability, and the lockfile is regenerated under the CI npm major so `npm ci` stays in sync across platforms. `scripts/pack.mjs` uses `npm ci` for the published-SDK swap and asserts that `package.json` / `package-lock.json` are not mutated during packaging.
- **Desktop responsiveness & i18n polish** - Shell, session picker, theme toggle, and bottom-bar layout adapt better to narrow widths, with added/aligned zh/en strings.
- **Smaller installers** - Trimmed the packaged bundle without changing behavior: `better-sqlite3` now ships only its runtime binding plus JS API (dropping ~44 MB of MSVC build residue — intermediate `obj`/`pdb`/`lib`, the sqlite amalgamation, and test artifacts; only `build/Release/better_sqlite3.node` is loaded at runtime), and only the `en-US` / `zh-CN` Electron locales are bundled instead of all ~55. The Windows installer drops from ~133 MB to ~118 MB, with comparable reductions on macOS and Linux. (This is the part of the 0.1.25 → 0.1.26 size jump that was avoidable; the rest is the Electron 33 → 42 security upgrade.)

### Fixed

- **Navigation guard exact-match** - Trusted main-process `data:` URLs (the boot splash page) are now matched against an exact allow-list instead of a `startsWith` prefix, removing a class of prefix-appended-payload bypass. Covered by a new `navigation-guards` test.
- **Artifact cross-session isolation** - The artifact store now rejects reusing an artifact id that belongs to a different session, preventing one session from appending versions to another session's artifact.
- **Media SDK cache invalidation** - A failed dynamic import of `@kodax-ai/kodax/media` no longer poisons the cache permanently; the next clipboard image operation retries the import.
- **Long session operations no longer time out** - `/delete`, `/fork`, and `/rewind` run without the composer IPC timeout so an in-app confirmation can take as long as needed without a spurious timeout failure.
- **Runtime diagnostics Escape close**, **shortcut-hint behavior**, and **right-sidebar popout e2e stability** are corrected.

### Security

- **Electron CVE pin (18 HIGH advisories cleared)** - Pinning Electron to `42.5.0` removes a set of known Chromium/Electron security advisories (use-after-free in permission/PowerMonitor/offscreen callbacks, renderer command-line-switch injection, HTTP response-header injection in custom protocol/`webRequest`, `clipboard.readImage` crash on malformed data, named `window.open` scope, ASAR integrity bypass, and more). `npm audit` reports 0 vulnerabilities. The advisory fix floor is Electron `39.8.5`; `42.5.0` was chosen as the currently-supported, already-shipped (v0.1.25) baseline, and it does not raise the Linux glibc floor.
- **Navigation guard tightening** - As above, the trusted `data:` URL check is now exact-match.
- **Artifact ownership guard** - As above, cross-session artifact id reuse is rejected.

## [0.1.25] - 2026-06-25

### Theme

**KodaX 0.7.56 SDK catch-up — image artifact source provenance and Kimi K2.7 Code coverage.**

This release resolves `@kodax-ai/kodax` `^0.7.56` and threads the new image-artifact source provenance through the composer and managed-session send path, refreshes Kimi K2.7 Code context-window coverage, and records the public SDK media helpers as Space-owned follow-up work.

### Changed

- **KodaX 0.7.56 SDK catch-up** - Root and desktop workspace dependencies now resolve `@kodax-ai/kodax` `^0.7.56`. Image artifacts carry source provenance (`clipboard` for pasted images, `drag-drop` for dropped images) through `inputArtifacts` instead of a hardcoded `user-inline` label, with the legacy default preserved for callers that omit it. Kimi K2.7 Code (256k) is added to the context-window fallback table, and the new public SDK media helpers are recorded as planned Space-owned follow-up for native clipboard fallback, GIF direct-path handling, file artifacts, and capability preflight.

### Security

- **File-picker source reserved, not yet wired** - The `file-picker` artifact source value is reserved in the schema but has no emitter; a documented guard requires any future file-picker flow to copy picked paths into the main-owned clipboard sandbox before send, so the existing path-traversal protection cannot be bypassed.

## [0.1.24] - 2026-06-24

### Theme

**Offline customer entitlement MVP, plus streaming-scroll, session-isolation, and queued-prompt fixes.**

This release adds an offline, signed license entitlement system for managed customer deployments (no telephone-home, no prompt for community/education/research/personal use), unlocks the transcript scroll during streaming, hardens session isolation across project switches, and clarifies the queued-prompt lifecycle in the composer.

### Added

- **Offline customer timebox entitlement (F105)** - Offline signed entitlement import/verification (Ed25519, build-embedded issuer key), managed-required mode driven by signed package policy, customer trial/timebox support with `issuedAt`/`expiresAt`, and license status surfaced in Settings / About / Diagnostics. Community, education, research, and personal use are never prompted for a license.

### Changed

- **KodaX 0.7.55 SDK catch-up** - Root and desktop workspace dependencies now resolve `@kodax-ai/kodax` `^0.7.55`. This upstream release is a concurrency-safety hardening patch for same-directory sessions: per-session scratch isolation, owner-scoped managed-task checkpoints, per-process extension-store temp writes, and stricter runtime tool gating. Space already passes stable session ids into `runManagedTask`, so no additional host API wiring is required for the baseline integration.

### Fixed

- **Streaming transcript scroll unlock** - During active streaming the transcript no longer feels locked to the bottom: a wheel/keyboard/touch scroll-up now disengages auto-follow immediately (bypassing the programmatic-scroll guard that streaming kept refreshing), and auto-follow re-engages only when the user returns to the bottom or clicks Jump to bottom.
- **Session isolation on project switch** - Switching projects unconditionally clears the current session and validates both surface and project before restoring one, so a session from a previous project can no longer leak into a newly opened project, even under rapid switching.
- **Queued prompt lifecycle UI** - The composer's queued-prompt add / cancel / promote states stay consistent between main and renderer, with no orphaned queued bubbles after history reloads or session errors.

### Security

- **License signature verification hardening** - Entitlement verification is Ed25519-only; the algorithm is derived from the pinned public key, never from the envelope, and the post-failure SHA-256 fallback was removed to eliminate an algorithm-confusion footgun. Verification is fail-closed on every error path.
- **Clock-rollback floor** - The clock-rollback guard now also enforces a stateless floor from the signed `issuedAt`, so a rolled-back system clock degrades the entitlement even if the user-writable rollback baseline (`state.json`) is deleted.

## [0.1.23] - 2026-06-24

### Theme

**Durable runtime preferences, KodaX 0.7.54 SDK catch-up, and composer file references — with a green CI baseline restored.**

This release makes the Plan / Accept edits / Auto selector a durable Space preference, brings Space in line with KodaX SDK 0.7.54, adds drag-and-drop file references to the composer, and folds in the review/hardening pass. CI (typecheck + unit + cross-platform e2e) is green again after a long red stretch.

### Added

- **Runtime defaults and mode persistence (F106)** - Plan / Accept edits / Auto and the Auto engine now persist as Space-owned runtime defaults; resumed sessions prefer a per-session runtime sidecar, then Space defaults, then a read-only `~/.kodax/config.json` fallback, then safe built-ins. A main-process resolver owns precedence and exposes value sources for diagnostics.
- **KodaX 0.7.54 SDK catch-up (F107)** - Dependency + GLM 5.2/4.7 refresh, learning inbox and ledger slash commands (`/learn pending|ledger|diff|approve|reject`, `/skill|workflow|memory pending`), session recovery preview (`/recover candidate|prompt|seed`), opt-in SDK extension discovery/runtime (`/extensions sdk [load]`), a Space extensions manual topic, and completed-turn learning lifecycle wiring.
- **Composer dropped file references (F108)** - Dropping files into the composer inserts safe `@relative/path` (in-project) or `file://` (external) references with removable chips; PNG/JPEG/WEBP also attach as inline image artifacts.

### Fixed

- **Mode selector responsiveness** - The bottom mode selector no longer holds its busy lock across the global-default persistence IPC, so rapid Shift+Tab cycling through Plan / Accept edits / Auto stays responsive.
- **Session runtime sidecar safety** - Per-session sidecar writes are serialized per session with unique temp files, reject colon session ids (Windows ADS), and preserve still-valid runtime fields when one field is invalid.
- **SDK extension runtime disposal** - Extension runtimes dedupe disposal via a per-runtime guard, avoiding double-dispose races on invalidation.
- **MCPB storage migration** - The legacy `~/.kodax-space` → KodaX-home migration copies to a temp dir and atomically renames into place, re-validating the destination stays inside the extract base.
- **Provider key rename hygiene** - Renaming a custom provider moves its key transactionally with rollback, and provider error messages no longer echo caller-supplied ids.
- **Session scope guards** - Sends and slash commands assert the expected project/surface so a stale renderer cannot drive a session in the wrong project after a switch.
- **Composer dropped-image dedup** - Dropped images no longer produce both a `file://` reference and an inline image artifact for the same file.
- **Continuous integration** - Restored a fully green CI baseline (typecheck + unit tests + Windows/Linux e2e).

## [0.1.22] - 2026-06-22

### Theme

**Provider trust-path patch: internal custom providers, per-session follow-up queue, and release hygiene.**

This patch keeps the v0.1.20/v0.1.21 baseline intact while fixing the custom-provider regression for trusted internal gateways, closing the cross-session follow-up queue risk found during review, and aligning release metadata for the next patch build.

### Fixed

- **Trusted internal custom providers** - The custom-provider form can explicitly skip URL safety checks for trusted internal HTTP/IP gateways, while the default path still enforces HTTPS and dangerous-scheme guards.
- **Config-provider compatibility** - Custom providers loaded directly from KodaX config keep the trusted path so existing internal provider entries continue to run as they did before the stricter UI validation.
- **Per-session follow-up queue** - User follow-up prompts no longer enter the SDK main-thread queue; Space stores them in a session-owned queue and starts the next prompt only after the same session's current turn settles.
- **Resume model/provider pairing** - Resumed sessions only reuse a configured model when it belongs to the selected provider, avoiding stale provider/model combinations.
- **Title sanitization source hygiene** - Escaped the control-character ranges used by title sanitization so the source file no longer contains an embedded NUL byte.
- **Ask-user bridge coverage** - SDK `ask_user_question`, select, and input prompts are wired through the Space IPC modal path.
- **MCP manager lifecycle races** - Hardened init, reload, and dispose paths against overlapping lifecycle operations.
- **Playwright single-instance isolation** - E2E launches now scope Electron `userData` to the `KODAX_TEST_ONBOARDING` sandbox before acquiring the single-instance lock, so Settings interaction tests can launch reliably beside an existing app or another test process.
- **Streaming spinner caret cleanup** - Removed the v0.1.16 streaming caret from the conversation tail so the Thinking spinner no longer shows a blinking cursor on the next line.
- **Streaming spinner frame stability** - Replaced the React timer-driven text spinner with a CSS comet spinner so streaming rerenders no longer throttle animation frames.
- **Diff popout loading path** - Diff opens with path-aware loading UI and races cached tool diffs with git file diffs so the first paint is no longer a long blank state.
- **Artifact transcript surfacing** - `create_artifact` results are promoted out of collapsed command clusters into a standalone clickable Artifact callout with right-panel focus and separate-window open actions.

### Changed

- **Version alignment** - Root, desktop, IPC schema, UI kit, lockfile, docs, and `space.version` capability contract are aligned to `0.1.22` / `space-v0.1.22`.
- **View menu appearance shortcuts** - The app View menu now exposes localized Theme (`Light` / `Dark` / `System`) and Visual Quality (`Minimal` / `Balanced` / `Full`) choices alongside the language switch.
- **Right sidebar expansion** - The right sidebar width toggle now balances against the current workspace width, so Artifact focus and review flows open into a readable panel without crowding the main transcript.
- **Build verification path** - `npm run typecheck` now builds workspace packages first so generated package artifacts are available before TypeScript checks run.
- **macOS packaging script** - macOS release builds pass explicit `--x64 --arm64` architecture flags.
- **Patch-lane planning** - `v0.1.22` is consumed by this provider/queue patch; `v0.1.23` and `v0.1.25` remain patch lanes, and `v0.1.24` remains the customer timebox entitlement MVP lane.

### Verified

- `npm run typecheck`
- `$env:SKIP_PTY_TESTS='1'; npm test`
- `npm run build:smoke`
- `npx playwright test tests/e2e/settings-modal-interactions.spec.ts`

## [0.1.21] - 2026-06-22

### Theme

**Patch lane release: workflow transcript recovery, release artifact resilience, and patch-lane reset.**

This patch release keeps the v0.1.20 feature baseline intact while fixing the highest-risk post-release issues found in workflow transcript recovery, Settings e2e stability, packaged keychain inclusion, and Windows release artifact fallbacks. It also formally opens the v0.1.21 patch lane and keeps planned feature work deferred to v0.1.26+.

### Fixed

- **Workflow transcript restore notices** - Restored completed workflow child summaries and final reports into the transcript after renderer reload, without turning workflow notices into user-message bubbles.
- **Workflow final report rendering** - Preserved readable markdown in workflow completion notices and kept final reports visible instead of collapsing them into one-line summaries.
- **Workflow manager history details** - Restored completed workflow runs now show their final summary directly in the manager detail pane before users expand the durable artifact body.
- **Workflow notice affordances** - Added stable footer controls/timestamps for workflow system notices so copied/restored workflow messages behave like other transcript entries.
- **Settings modal e2e stability** - Stabilized Settings tests with scoped selectors, a dedicated settings button test id, English e2e fixture language, and a more specific "Close settings" accessibility label.
- **Packaged keychain runtime** - Included `@napi-rs/keyring` and its native bindings in Electron packaging, unpacked native `.node` modules correctly, split macOS x64/arm64 release jobs onto matching runner architectures, and extended packaged smoke checks to fail if keychain runtime files are missing.
- **Windows release downloads** - Added zipped Windows release fallbacks so users can download `Setup.zip` / `Portable.zip` when direct unsigned `.exe` downloads are blocked.

### Changed

- **Version alignment** - Root, desktop, IPC schema, UI kit, lockfile, and `space.version` capability contract are aligned to `0.1.21` / `space-v0.1.21`.
- **Release notes pipeline** - Release notes now prioritize the matching `CHANGELOG.md` section, so tag-triggered GitHub Releases publish the curated changelog first.
- **Patch reserve planning** - `v0.1.21` ships as the first patch-only release; `v0.1.22-v0.1.25` remain reserved for patch-only releases, F103 Pinned Runtime Summary moves to `v0.1.26`, and planned 0.1.x feature lanes move to `v0.1.41-v0.1.44`.

### Verified

- `npm run typecheck`
- `npm run build:smoke`
- `npm run e2e:run -- tests/e2e/settings-modal.spec.ts tests/e2e/settings-modal-interactions.spec.ts tests/e2e/workflow-events.spec.ts`

## [0.1.20] - 2026-06-22

### Theme

**KodaX capability catch-up + Display Language MVP + release cohesion.**

This release closes the post-v0.1.19 continuity lane: Space now exposes KodaX SDK capability state more honestly, consumes the KodaX 0.7.53 host events, adds the Space-side CLI handoff receiver, and ships the first user-visible English / Simplified Chinese display-language switch. It also includes workflow UI recovery fixes and release-readiness hardening found during the v0.1.20 review pass.

### Added

- **F081 capability ledger and diagnostics** — Added `docs/KODAX_CAPABILITY_LEDGER.md`, extended `space.version` with KodaX SDK version/spec, capability contract, and degraded capability states.
- **F082 Repointel status and trace surface** — Added `repointel.status`, `/repointel status`, `/repointel trace`, and chip popover diagnostics. Standalone warm remains SDK-gated and is reported as such.
- **F083 Quick Ask continuity** — Quick Ask now captures temporary-session events locally and can promote a useful answer into a normal Coder session with provenance. True no-session `sideQuery` remains SDK-gated.
- **F084 Space-side handoff receiver** — Added handoff IPC, watcher push, titlebar inbox UI, accept/dismiss flow, stale/invalid handling, and session-id guarded cleanup for `~/.kodax/handoffs/*.json`.
- **F104 Display Language MVP** — Added persisted `languageMode`, effective-locale resolution, Settings language control, top-menu language switching, and English / Simplified Chinese coverage for menu chrome, Settings, sidebar headings, right-sidebar headings, provider settings, common modal/toast text, and frequent controls.
- **KodaX 0.7.53 host events** — `onSidecarMessage` now flows through typed `sidecar_message` events and renders verifier revise/blocked output as system notices; `onTodoDriftWarning` now flows through `todo_drift_warning` and raises session-scoped notifications.
- **Workflow management surfaces** — Added workflow capability channels, workflow management panel, workflow flow graph / pattern graph, workflow summaries in transcript, and persisted workflow history detail recovery.

### Changed

- **`@kodax-ai/kodax` 0.7.52 -> 0.7.53** — Space now consumes the 0.7.53 SDK baseline from both root and desktop workspace package specs.
- **Version alignment** — Root, desktop, IPC schema, UI kit, and lockfile versions are aligned to `0.1.20`.
- **Menu and Settings UX** — The custom titlebar menu now includes localized File/Edit/View/Help entries, a View > Language quick switch, and a non-transparent menu popup layer for readability over glass panels.
- **Provider settings localization** — Provider cards, custom provider form, key-state labels, and provider settings summaries now participate in Display Language MVP coverage.

### Fixed

- **Workflow lifecycle and history recovery** — Hardened workflow lifecycle IPC, restored persisted workflow history/detail rendering, kept workflow details after completion, stabilized progress UI, recovered workflow reports/artifacts, and hardened generated workflow rerun inputs.
- **Session completion notification replay guard** — Background completion notifications now ignore restored historical prompt timestamps and only notify for fresh live prompts.
- **Settings entry ambiguity** — The left sidebar footer now keeps `KodaX Space` as the app label and exposes `gear + Settings/设置` as one clickable settings button.
- **Menu popup contrast** — The titlebar menu dropdown now uses an opaque floating surface instead of a transparent/blurred layer that allowed underlying panel text to overlap visually.

### Security / Hardening

- **Shell and handoff IPC hardening** — Shell reveal/open-external and handoff file flows now have explicit tests around path allowlists, invalid/stale payloads, and destructive operations.
- **Provider guard closure** — The v0.1.18/v0.1.19 custom-provider SSRF/env-injection risk is closed by `apiKeyEnv` and `baseUrl` validation across Space custom providers, KodaX config providers, and connection tests.
- **Workflow path defense in depth** — Generated workflow run IDs are validated before controller filesystem joins.

### Planning Notes

- `kodax sessions dedupe` remains CLI-only for now; desktop exposure is deferred until session hygiene/doctor UX.
- 0.7.53 extension/MCP resume-state preservation is tracked under F090 rather than expanded into v0.1.20 scope.
- v0.1.21-v0.1.25 are intentionally left open for patch-only releases before the next planned feature lane.
- v0.1.26 planning lane now targets F103 Pinned Runtime Summary; the previous v0.1.26-v0.1.29 planned 0.1.x features move to v0.1.41-v0.1.44.

### Verified

- `node --test --import tsx/esm apps\desktop\electron\test\session-complete-notification.test.ts`
- `node --test --import tsx/esm packages\space-ipc-schema\test\settings.test.ts apps\desktop\electron\test\settings-store.test.ts`
- `npm test -w @kodax-space/space-ipc-schema`
- `npm test --workspace @kodax-space/desktop`
- `npm run typecheck`
- `npm run build:smoke`
- `npm run build:win`
- `npm run smoke:pack`
- `npm run smoke:boot`
- `git diff --check` (Windows LF/CRLF warnings only)

## [0.1.19] - 2026-06-18

### Theme

**修掉错误/取消后的会话历史错位 + popout 浮层掉位，并升 SDK。**

紧急维护版：收口会话终止事件，修掉「500 报错后历史气泡错乱、回复被甩到列表底部」与取消后界面卡顿；顺带兜回 F060 起 popout 浮层掉到输入框下方的回归。SDK 升到 `@kodax-ai/kodax` 0.7.52（OpenAI-compat provider 健壮性 + Node floor 20）。

### Fixed

- **终止事件单点收口** — SDK AMA 错误路径一轮会触发 `onError` + `onComplete` + 外层 catch 多次，naive 实现会往事件流塞多个终止事件，让 renderer 的 user↔event 段配对整体错位（错误挂错气泡 / 回复甩到列表底部）。改为每轮至多发一个终止事件：`onError` 仅暂存、`onComplete` 见暂存错误则不报完成、`session_error` 由 `emitTerminalError` 统一发（latch 去重 + 富文案 + retry 倒计时）；renderer `findSegmentEnd` 再兜一道并入连续终止事件。
- **取消即时反馈** — 点 Stop 立刻在本地 append 一个 `cancelled` 终止事件让 UI 马上停，`session.cancel` IPC 改 fire-and-forget；`appStore` 对同轮重复的 `cancelled` 去重；竞态下与 cancel 同时到达的 SDK error 落 main 日志而非无声蒸发。
- **popout 浮层定位回归** — `.glass`（裸规则 `position: relative`）级联压过 Tailwind `.absolute`，使 plan / diff 浮层退回文档流、掉到输入框下方；用 `!absolute` important utility 精准压回（仅此一处冲突，零波及其它 glass 面板）。

### Changed

- **`@kodax-ai/kodax` 0.7.51 → 0.7.52** — 维护版：OpenAI-compat provider 健壮性（forced `tool_choice` 在 5xx / 不支持参数时回退、重放前修复畸形 tool history）、Node runtime floor 抬到 20、跨平台 CI 测试清理。无新功能、无 LLM-facing prompt 变更。
- **workflow stop 本地兜底** — `WorkflowController.stop()` 在 lifecycle 未即时回执时，本地合成一个 cancelled 快照推给 renderer（running→cancelled / pending→skipped，重算 counts/progress），避免取消 workflow 后进度树停在旧状态。

## [0.1.18] - 2026-06-17

### Theme

**打通 KodaX CLI 自定义 provider。**

让 Space 直接识别并使用 KodaX CLI 在 `~/.kodax/config.json` 的 `customProviders` 里配置的自定义 provider（如 `newapi-anthropic`、`openrouter-*`），不必再在 Space 里重复添加。之前 Space 只认自己的 `~/.kodax/custom-providers.json`，CLI 配的 provider 在 Space 完全不可见。

### Added

- **读取 KodaX `config.json` 的 customProviders** — `loadKodaxCustomProviders()` 读取并归一化 CLI 配置中的自定义 provider；provider 列表、`session.create/setProvider`、`/provider <name>` slash 命令均识别该来源，并按需注册进 SDK runtime LLM registry。

### Changed

- **`registerKodaxCustomProviders()` 合并来源** — 同时注册 config.json customProviders + Space store 自定义 provider。
- **IPC `providerId` schema 放宽** — 接受 SDK 风格的 provider 名（字母/数字/`.`/`_`/`:`/`-`），main 端仍校验 provider 真实存在。

> ⚠️ **已知安全项（紧急发版未修）**：config.json 来源的 provider 的 `apiKeyEnv` 未经 `RESERVED_ENV_VARS` 黑名单校验、`baseUrl` 未经 `validateBaseUrl` SSRF 校验。后续版本补。

## [0.1.17] - 2026-06-17

### Theme

**凭据存储去 keytar 化 + 桌面级 UI 打磨。**

修掉一类隐蔽的启动崩溃（开发机系统 Node ABI 与 Electron 内置 Node 不一致时 keytar native 崩、拖垮 app），换成自带 prebuild 的 `@napi-rs/keyring`；外加 macOS 式自动隐藏滚动条、dashboard 与 titlebar 细节打磨。

### Changed

- **凭据存储 keytar → @napi-rs/keyring** — keytar 已 archived 停维护且走 node-gyp 源码编译，开发机系统 Node ABI 与 Electron 内置 Node ABI 不一致时会编出错 ABI 的 native 模块、`require` 即 native 崩（exit `0xFFFF7003`，try/catch 拦不住）。换成纯 N-API + Rust、各平台自带 prebuild 的 `@napi-rs/keyring`：装下来即匹配运行时，不走 node-gyp、不需构建工具、无 ABI 崩溃。keychain 封装逻辑零改动（动态 import + memory fallback + probe 全保留）。新增 `.nvmrc`（Node 20）对齐 Electron 内置 Node。
- **KodaX SDK 升级 0.7.50 → 0.7.51**。

### Added

- **macOS 式自动隐藏圆角滚动条** — 滚动时浮现、停止后淡出的圆角滚动条；dashboard 缩高、titlebar 按钮间距打磨。

### Fixed

- **主题 / 特效 titlebar 图标改用 Lucide 并彻底错开** — 消除两个图标"撞脸"。

---

## [0.1.16] - 2026-06-17

### Theme

**Workflow 支持链路 + 对话流全量交互动画。**

本版本把 v0.1.15 Workflow Harness 批次落地为可用 UI/事件/结果桥接，并补上 F068 对话流 motion layer：CSS-first、无新 runtime 动画依赖、复用视觉质量三档与 reduced-motion 门控。

### Added

- **F060-F066 Workflow Harness 支持** — main→renderer workflow 事件管线、进度面板、run 生命周期控制、workflow 库/启动/preflight、AMAW 自然语言自启与 Host policy、子 agent 活动遥测面、workflow 结果桥进 artifactStore。
- **F068 对话流全量交互动画系统** — 新增 `motion.ts` 单一配置源、`Reveal`/`Collapse` 通用组件、消息入场 stagger、timeline marker pop、工具/思考折叠动画、tool running→done 高光、复制脉冲、系统通知入场、流式光标与 jump-to-bottom 图标化反馈。

### Changed

- **Recharts v3.8.1 升级** — 将 renderer 图表依赖从 v2.15.4 升到 v3.8.1。
- **LiveCanvas artifact sandbox 暂时移除** — 移除不稳定的 LC 交互 sandbox tier 与 dev 自愈噪音，保持无 LC 依赖时 install/build/typecheck 可复现。
- **F068 文档与 feature tracker** — 新增 `docs/features/v0.1.16.md`，`docs/FEATURE_LIST.md` 链接到 v0.1.16 真理源。

### Fixed

- **F068 motion 无障碍门控** — CSS reduced-motion 现在以同等选择器 + `!important` 覆盖所有 F068 动画；WAAPI 完成高光在 JS 侧同步检查 `prefers-reduced-motion` 与 `q-minimal`。
- **F068 Collapse 可访问性** — 折叠态内容用 `aria-hidden` + `inert` 移出 accessibility tree 与键盘 Tab 序，避免视觉隐藏但仍可聚焦。
- **CSP theme bootstrap hash drift** — 同步 theme-bootstrap inline hash，避免 F060 Liquid Glass 预挂载脚本与生产 CSP 不匹配。

### Verified

- `npm run typecheck`
- targeted renderer ESLint for changed TS/TSX files
- `npm run build:smoke`

## [0.1.11] - 2026-06-17

### Theme

**Liquid Glass 视觉刷新 + Windows 启动/构建修复。**

视觉质量三档（极简 / 均衡 / 全特效）+ Apple Liquid Glass / visionOS 风格的光向描边、光标 specular 高光、分层柔影、作用域微交互；修复 Windows 下 dev 窗口不显示的根因；新增 Windows portable 构建；KodaX SDK 升 0.7.50。

> **Gap note**：[0.1.10] 未单独写 section（内容为 F056–F059 Artifact 子系统：数据层 / 生成 / Panel / 三级展示 / 导出），见 `git log v0.1.9..v0.1.10` + `docs/features/`。

### Added

- **F060 Liquid Glass 视觉质量档** ([2fb9420](https://github.com/icetomoyo/KodaX-Space/commit/2fb9420)) — minimal / balanced / full 三档，localStorage 持久化 + index.html 预挂载防闪。立体感来自光·影·材质而非运动：`.glass::before` 光向渐变描边（左上亮→右下暗）、`.glass::after` 光标 specular 高光（`useSpotlight` 写 `--mx/--my`，`pointer-events:none` 不挡点击 / 不移动布局）、分层柔影 `.lift` + hover 抬升、极淡 2 团 CSS 柔光背景；full 档中央阅读区半透明。
  - 性能护栏：`backdrop-filter` 仅用于静止 chrome（标题栏 / 侧栏 / 输入框 / 模态 / 命令面板 / Popout），对话滚动区绝不挂 `.glass`。
  - 标题栏 `✦` 下拉切档，浅色模式光标高光提亮可见。
- **F060 `.ix-zone` 作用域微交互** ([63ef180](https://github.com/icetomoyo/KodaX-Space/commit/63ef180) / [164d823](https://github.com/icetomoyo/KodaX-Space/commit/164d823)) — 容器标 `.ix-zone` → 区内所有 `button`/`[role=button]` 自动获 hover 浮起 + active 按下（纯 transform，GPU，无 JS）；`.no-ix` 豁免、`.ix-pop` 图标放大、`.monaco-editor`/`.xterm` 硬豁免。
- **F010 Windows portable 免安装单文件构建 target** ([66d61ca](https://github.com/icetomoyo/KodaX-Space/commit/66d61ca)) — electron-builder portable，随安装包一起出。

### Fixed

- **Windows 下 dev 启动 Electron 窗口不显示** ([0588f71](https://github.com/icetomoyo/KodaX-Space/commit/0588f71)) — 根因：`scripts/dev.mjs` spawn Electron 时 `windowsHide: true` 让 Windows 按隐藏方式启动 GUI 进程（窗口创建并 `show()` 但永不可见，DevTools 偶尔激活才带出来，误导成 GPU / 渲染 / 离屏问题）。仅对 Electron GUI 进程传 `windowsHide: false`（vite/esbuild console 进程仍 true）。`main.ts` 加 ready-to-show / did-finish-load / did-fail-load / 超时 多路兜底显示 + did-fail-load / render-process-gone 大声报错。
- **before-quit 子进程清理** ([6f6fffa](https://github.com/icetomoyo/KodaX-Space/commit/6f6fffa)) — 统一 `await` 四路 disposal（`Promise.allSettled`）+ watchdog（`.unref()`）+ `app.exit(0)`，消除孤儿进程残留。

### Changed

- **KodaX SDK 0.7.50** ([a2aa9b8](https://github.com/icetomoyo/KodaX-Space/commit/a2aa9b8) / [73d01f6](https://github.com/icetomoyo/KodaX-Space/commit/73d01f6)) — 0.7.50 上架 npm 后从本地 tarball 切到 registry `^0.7.50`（他机 `npm ci` 可复现，lockfile 锁 registry + integrity）。
- 构建链 typecheck 与 LiveCanvas 解耦 ([c356a6f](https://github.com/icetomoyo/KodaX-Space/commit/c356a6f)) — 仓库零 LC 依赖即可 install / build / typecheck。

## [0.1.9] - 2026-06-08

### Theme

**Multimodal input + smart popout director + Codex parity polish.**

合并 release: SDK 0.7.46 publish 解锁了 v0.1.8 的 tag 阻塞,本版本同时带 9 项新增。
**v0.1.8 不单独 tag** — 内容见下方 [0.1.8] section,功能同样进 v0.1.9 binary。

详细 design doc: [`docs/features/v0.1.9.md`](docs/features/v0.1.9.md)

### Added

- **OC-31 image paste 多模态输入** ([a0933f5](https://github.com/icetomoyo/KodaX-Space/commit/a0933f5)) — composer 直接粘贴 PNG/JPEG/WEBP 截图,缩略图 chip 在 textarea 上方,发送时 SDK 通过 `KodaXContextOptions.inputArtifacts` 拼成 multimodal content block 喂给 LLM。
  - 新 IPC `clipboard.saveImage` + `clipboard.cleanupSession`: app temp dir per-session 子目录,dir 0o700 / file 0o600
  - 6 MiB / 张 + 8 张 / turn 上限;decoded buffer 主进程二次 enforce 防 base64 编码 inflation 绕过
  - `assertArtifactPathInClipboardSandbox` 在 `session.send` 处校验 artifacts[].path 在 `<root>/<本次 sid>/` 之内,防恶意 renderer 传 `/etc/passwd` 让 SDK 读任意文件
  - 12 个 clipboard 单测 (sandbox / path traversal / mime / 0o600 mode / decoded size)
- **KX-I-02 Smart Popout Director** ([708a108](https://github.com/icetomoyo/KodaX-Space/commit/708a108)) — session events 首次出现 plan/diff/tasks 信号时**自动展开**对应 right popout,每 (session, kind) 一次。
  - 优先级 tasks > plan > diff;activePopout 非 null 不抢;用户手动开/关 popout 也 mark promoted (不打扰)
  - PreferencesPanel 加 toggle, lsKey `kodax-space.smartPopoutEnabled` 持久化
  - rules.ts pure function + 20 单测
- **Sidebar resize + 宽度持久化 (Codex parity)** ([d22c935](https://github.com/icetomoyo/KodaX-Space/commit/d22c935)) — 左/右侧栏可拖,默认 260/320 px,上下限 180-520 clamp,双击 reset,Esc 取消;aside 默认基础字号 [13px] 对齐 Codex 视觉。
- **F040 项目拖排 + Archived 折叠持久化** ([5cc44ed](https://github.com/icetomoyo/KodaX-Space/commit/5cc44ed)) — LeftSidebar 项目 row HTML5 DnD 拖排,`projectOrder` 持久化 lsKey;"Archived (N)" 折叠状态走 store + LS 重启保留;projectOrder 非空时仍 pin current 到最顶。9 reducer 单测。
- **F040 项目 session cap 8 + ProjectSessionPicker** ([a57df0e](https://github.com/icetomoyo/KodaX-Space/commit/a57df0e)) — sidebar 单项目默认显示 8 条,超出 "+N more" 弹覆层全量搜索;切到那条自动归属对应 project。
- **OC-29 unified Settings modal** ([7d5f459](https://github.com/icetomoyo/KodaX-Space/commit/7d5f459)) — 旧 SettingsPopover + ProviderSettings 合并到 2-tab modal (Preferences / Providers);切 tab 用 `hidden` 不 unmount,保留 in-progress 编辑;正确 ARIA tablist/tab/aria-selected。
- **OC-21 result-side ToolRegistry** ([5cb281a](https://github.com/icetomoyo/KodaX-Space/commit/5cb281a)) — tool result 区也走 registry,跟 v0.1.8 ship 的 input-side 对称;本版不注册内置 (零行为变更),纯留扩展位。
- **8 个 e2e 测试** ([d32808a](https://github.com/icetomoyo/KodaX-Space/commit/d32808a)) — settings-modal x2, sidebar-resize x2, project-reorder x3 + 1。13/13 e2e 全绿。

### Fixed

- **SDK 0.7.46 cross-project filter** ([23ffa5e](https://github.com/icetomoyo/KodaX-Space/commit/23ffa5e) / [d410032](https://github.com/icetomoyo/KodaX-Space/commit/d410032) / [304e638](https://github.com/icetomoyo/KodaX-Space/commit/304e638)) — SDK 0.7.45 listSessions fast-path 在 caller 不传 gitRoot 时 fallback 到 process.cwd → Space 只看到自家项目 session,KodaX 项目下数百 session 消失。
  - v0.1.9 三次迭代:`includeArchived: true` workaround → `before: '2999-...'` sentinel → SDK 0.7.46 storage.list 加 `this.hostCwd ?` 守门后撤掉所有 workaround,纯净调用
- **Markdown code block copy 按钮看不清 + 缩进闪烁** ([ee91e18](https://github.com/icetomoyo/KodaX-Space/commit/ee91e18)) — hover 出来对比度太弱;包 `M packages/...` 等纯文本被 rehype-highlight 误识别成 diff/perl 让第一行变粉红。copy 按钮 opacity-60 + border 常驻;detect:false 防纯文本误识别。
- **Release review HIGH** ([69ed136](https://github.com/icetomoyo/KodaX-Space/commit/69ed136)):
  - removeSession 漏清 `inputHistoryBySession / pendingSendBySession / sessionFlags`, long-lived 累积
  - ResizeHandle 拖动中 unmount, 3 个 window listener 不 detach → closure leak
- **setCurrentSession 不同步 currentProjectPath** ([f2310c9](https://github.com/icetomoyo/KodaX-Space/commit/f2310c9)) — 用户报: 在 KodaX 项目打开下点 KodaX-Space session, RightSidebar Changes/Working folder/ChipBar 仍指着 KodaX 显示错的 git changes。
  - Store action 兜底: 找 session 对应 projectRoot canonProjectRoot 比较, 不一致就同步 + 写 LS
  - 6 个新单测覆盖 sid race / projectRoot 空 / canon trailing slash 等边界
- **文件修改 tool 卡默认折叠 + RightSidebar 按钮太小** ([dd0b119](https://github.com/icetomoyo/KodaX-Space/commit/dd0b119)):
  - write/edit/multi_edit/str_replace/insert_after_anchor 默认 expanded=true, 卡片打开即看 diff 摘要;Monaco 大块保留二级折叠不影响性能
  - RightSidebar Section ⤢ 改 toggle: active 时换 × icon 再点关闭;w-5 h-5 大点击区 + hover 反馈;Unicode ⤢/⌃/⌄ 换 Lucide-style SVG (popout / X / chevron) 易辨
  - Shell 本地 activePopout ↔ store activePopoutKind 双向同步, 守门防回路

### SDK 升级

- `@kodax-ai/kodax`: `^0.7.45` → `^0.7.46`
  - FEATURE_219 真实 archive (archiveSession / unarchiveSession + SessionSummary.archived/projectKey)
  - listSessions cross-project bug 修了 (见上方 Fixed)
  - 自动迁移 flat → `<sessionsDir>/<projectKey>/<sid>.jsonl` per-project 目录布局,Space 透明感知

### Verified

- typecheck pass
- 553/553 unit tests pass (本版 +41: 12 clipboard / 20 director / 9 reorder)
- 13/13 e2e tests pass (本版 +8)
- build:smoke pass
- renderer-boot e2e pass (Linux CI leg)
- code-reviewer: 0 CRITICAL / 0 HIGH (本版 2 HIGH 已 fix)
- security-reviewer: 0 CRITICAL / 0 HIGH (image paste sandbox + cross-project list 都 clean)

## [0.1.8] - 2026-06-07 (released as part of v0.1.9 — see above)

### Theme

**v0.1.7 dogfood 修复 + polish + project menu + tool registry + permission batch.**

v0.1.7 broken release 后立刻锁回 main，累积 7 项工作 + 把白屏类回归装上 CI gate。
原本 v0.1.6 (F011 + F026 + F038) + v0.1.7 (F023 + F024) 计划的 ship 内容随本 release 一起发。

### Added

- **CSP inline-script hash** ([0169316](https://github.com/icetomoyo/KodaX-Space/commit/0169316)) — `apps/desktop/electron/csp-config.ts` 抽常量 `THEME_BOOTSTRAP_INLINE_HASH`，注入 prod CSP `script-src`。带启动期 drift guard 单测：动 inline script 忘改 hash → CI fail + 打印新期望值。
- **HelpOverlay 跨平台快捷键显示** ([95b151f](https://github.com/icetomoyo/KodaX-Space/commit/95b151f)) — `Mod`/`Alt`/`Shift`/`Meta` sentinel，按 `window.kodaxSpace.platform` 翻译。Mac 显示 ⌘/⌥/⇧，Win/Linux 显示 Ctrl/Alt/Shift。6 个 formatKey 单测。
- **Release pipeline renderer-boot last gate** ([108c434](https://github.com/icetomoyo/KodaX-Space/commit/108c434)) — `tests/e2e/renderer-boot.spec.ts` 用 launchSpace fixture + 4 个断言（no React error / no pageerror / `#root` 有 child / preload bridge 存在）。listeners 在 `domcontentloaded` 之前挂（抓 React #310 同步首屏崩）。release.yml ubuntu leg 跑，fail 拦 release job。
- **F043 项目级 contextmenu** ([0e929a8](https://github.com/icetomoyo/KodaX-Space/commit/0e929a8) + [1dbdaa2](https://github.com/icetomoyo/KodaX-Space/commit/1dbdaa2)) — 右键项目节点：Rename (inline edit) / Archive / Remove from Space。
  - 2 新 IPC：`project.recent.rename` + `project.recent.setArchived`；都走 `projectStore.assertAllowed` （path-probing 防御）
  - `archived=false` 时 omit 字段（清洁序列化）；Archived 项目折叠到底部 "Archived (N)" 分组，opacity-60
  - Inline rename：blur=cancel, Enter=commit (review HIGH 双 fire 已修)
  - Remove 走 confirm dialog 二次确认，body 明示"不动文件夹"
  - 11 个 ProjectStore 单测
- **OC-21 ToolRegistry** ([a6ec112](https://github.com/icetomoyo/KodaX-Space/commit/a6ec112)) — `bubbles.tsx` 的 `if (toolName === ...)` if-chain 重构成 registry-driven lookup。新工具加渲染只需 `registerToolInputRenderer(toolName, fn)`，不改 bubbles。
  - Renderer 是 pure function 返 `JSX.Element | null`，需要 hooks 的 renderer (multi_edit) 让返回 JSX 内嵌使用 hooks 的子组件
  - 内置 write/edit/multi_edit 通过 side-effect import 注册
  - 任意未注册工具走 raw-JSON collapse fallback（带 Show full / Collapse）
  - 7 个 registry 单测
- **KX-I-05 智能权限批处理 modal** ([57333c1](https://github.com/icetomoyo/KodaX-Space/commit/57333c1)) — 队列头部 ≥ 2 个同 session 非 danger 请求合并成 batch view。
  - 顶部 Allow all (N) / Deny all (N) + 每行独立 Allow/Deny 兜底
  - DANGER request 永远不入 batch（hard rule）
  - 答复用 Promise.all 并发；try/finally 防 IPC throw 让 busy 卡死（review HIGH 修）
  - 10 个 selectPermissionBatch 单测

### Fixed (v0.1.7 dogfood 收尾)

- **ProjectTree React Rules of Hooks 违例** ([a74fc02](https://github.com/icetomoyo/KodaX-Space/commit/a74fc02), GPT 协助诊断) — early-return 卡在 useMemo + useCallback 中间，第一次启动空 project 时不调后续 hooks，project 加载后 hooks 顺序变 → React error #310 → renderer 崩 → 白屏。修法：early return 挪到所有 hooks 后面。
- **dev.mjs Vite 5173 端口守卫** ([a74fc02](https://github.com/icetomoyo/KodaX-Space/commit/a74fc02), GPT 协助) — 旧 vite 进程占着 5173 时 wait-on 通过、新 vite 失败，electron 加载旧 server 的状态出现白屏。`isPortOpen` 预检 + 清晰错误 + Win PowerShell 帮助命令。
- **CI `SKIP_PTY_TESTS=1`** ([1ca85be](https://github.com/icetomoyo/KodaX-Space/commit/1ca85be)) — F011 PTY spec 在 GitHub Actions headless 环境（特别是 macOS）spawn 真 shell 不稳。CI 跳过这 8 个；本地 dev + smoke-pack + 用户实际运行验证。

### Diagnostics

- **`scripts/diag-sessions-load.mjs`** ([f94bc7a](https://github.com/icetomoyo/KodaX-Space/commit/f94bc7a)) — Playwright 启 prod build Electron 指向真 `~/.kodax`，读 zustand store 也调 IPC，dump JSON。Read-only 不动用户数据。任何 release 前一键确认 renderer 真起得来 + sessions 真路径不是占位 `/`。

### Acknowledged but not fixed in 0.1.8

- F042 NAPI native helpers — 仍 deferred 等真实性能数据
- F018 PRD 全集 Quick Ask / F015 Repointel warm API — 等 KodaX SDK 暴露
- 累计 LOW 项（z-index 不一致、a11y treeitem role、HelpOverlay 静态 array key 等）— polish pass 一次性收

### Pending before tag

- KodaX SDK 0.7.46 npm publish — listSessions fast-path 漏 `gitRoot` 字段 + hard cap 10 修复在源码已 ready 但还没 publish。Space 锁回 `^0.7.46` 后 bump + tag。

## [0.1.7] - 2026-06-06

### Theme

**Terminal + Preview + Command palette.** 把 v0.1.4 / v0.1.6 plan 里"等 SDK 出 X API 才能做"的
三条主线（真 PTY 终端、多 tab、富文件预览）一次性带上，并把命令面板顺带做了。同步解决 F018 vs F026
快捷键冲突 + 大幅 FEATURE_LIST 账本校准。

v0.1.6（F011 + F026 + F038）是内部里程碑，**不单独 tag**，合并进本 release。

### Added

- **F011 真 PTY 单 tab 终端** ([6844f1f](https://github.com/icetomoyo/KodaX-Space/commit/6844f1f)) — Terminal popout 从 "bash 工具历史 viewer" 升级为真 xterm.js + node-pty shell。
  - 4 IPC channels：`terminal.create` / `.write` / `.resize` / `.kill` + push `.output` / `.exit`
  - PtyHost 单例 Map<uuid, IPty>；UUID 服务端 mint，renderer 不能伪造
  - 跨平台 shell：Win cmd.exe / Mac+Linux $SHELL；renderer 不能注 arg
  - ENV 白名单（PATH/HOME/USER/TERM/LANG/Win 必备）：剥所有 `*_KEY` `*_TOKEN`，secret 不进 PTY
  - assertAllowed + fs.realpath 双层 cwd symlink-safe
  - SIGTERM → 3s grace → POSIX SIGKILL；Windows 走 conpty close
  - before-quit disposeAll 强杀防 zombie
  - 8 单测 spawn 真 shell 验证生命周期
  - hotfix [d984719](https://github.com/icetomoyo/KodaX-Space/commit/d984719)：xterm CJS 包让 vite 二次 reload 触发 renderer 白屏；改 lazy import + optimizeDeps.include

- **F023 终端多 tab** ([160fbb3](https://github.com/icetomoyo/KodaX-Space/commit/160fbb3)) — Tab bar + 多 PTY 并存。
  - 单 useReducer 管 tabs/activeId/counter；pure reducer 抽 `tabsReducer.ts`
  - 非 active tab 用 `display:none` 隐藏，PTY 保活
  - Terminal.tsx ResizeObserver 加 0×0 guard，防 hidden tab 收到 1×1 SIGWINCH 炸 scrollback
  - MAX_TABS=10 UI cap + main 端 IPC 硬上限双层防御
  - 关闭最后一个 tab 自动开新；关 popout 走顶栏 ×
  - 12 reducer 单测

- **F024 文件富预览 PDF / docx / xlsx** ([a570c37](https://github.com/icetomoyo/KodaX-Space/commit/a570c37)) — Preview popout 按 ext 路由。
  - 新 IPC `files.readBinary`：assertAllowed + resolveInsideProject + maxBytes 兜底
  - 3 个 lazy viewer，main bundle 不变（PDF 335KB / Docx 504KB / Xlsx 368KB chunk）
  - PdfViewer: pdfjs-dist 4.10 ESM; `isEvalSupported:false` + `disableAutoFetch:true` 硬化；DPI 上限 2
  - DocxViewer: mammoth → 自写 DOMParser allowlist sanitizer（tag/attr/href scheme 三层）
  - XlsxViewer: SheetJS CE → sheet_to_json → React 渲染 table，**不**用 sheet_to_html
  - 大小上限：PDF 50MB / docx 10MB / xlsx 10MB
  - 11 utils 单测 + 4 binary-read 单测

- **F026 ⌘Shift+P 命令面板** ([85d0bf5](https://github.com/icetomoyo/KodaX-Space/commit/85d0bf5)) — 全局快捷键召出模糊搜索。
  - 4 group 候选：Actions / Sessions / Files / Slash
  - JS fzf-lite scorer 抽到 `lib/fuzzy.ts`，FuzzyMatcher 抽象方便未来 F042 NAPI 替换
  - 多起点 scan + 连续匹配累计 ramp + boundary bonus；11 单测
  - 模块私有 `inputBridge` registry 替 window CustomEvent（消除 ambient injection cap）
  - 复用 `session.list` / `project.fileSearch` / `slash.discover` 三个已有 IPC，**0 新 channel**

- **F038 Sessions 持久化升级** ([c98d4ef](https://github.com/icetomoyo/KodaX-Space/commit/c98d4ef) + review fix [1003011](https://github.com/icetomoyo/KodaX-Space/commit/1003011)) — F033 in-memory → 接 KodaX SDK 0.7.42+ 持久化 API（共享 `~/.kodax/sessions/`）。
  - in-flight session 仍 in-memory，historical session 走 SDK 持久化
  - 解决 KodaX REPL 与 Space 之间 session 共享
  - review fix：process-level 锁 + SkillPathsConfig 类型

### Changed

- **F026 命令面板快捷键 ⌘K → ⌘Shift+P** — F018 Quick Ask 早就占了 ⌘K，两个 modal 抢同键会同时弹。
  让命令面板换到 ⌘Shift+P（VS Code/GitHub/Cursor 同款 muscle memory），⌘K 留给 Quick Ask（Linear/Slack 语义）。
  Cross-platform：`e.metaKey || e.ctrlKey` 已处理；HelpOverlay 同步加 2 行 hint。

- **FEATURE_LIST.md 账本校准** — 把"实际 ship 但状态写 Planned 的项"全部纠正：
  - **Completed (newly correctly labeled)**: F015 chip 部分 / F016 lineage / F019 主题 / F020 通知 / F022 auto-update
  - **Superseded**: F012 → F037 Subagent tree / F013 → F036+F039 MCP 管理
  - **Deferred**: F014 NAPI tokenizer → 并入 F042 / F017 CLI teleport 等 SDK
  - **Partial**: F015 warm API 缺 / F018 PRD 全集留 v0.1.8

### Fixed

- **F018 Quick Ask vs F026 命令面板快捷键冲突** — 两个 listener 都听 ⌘K 同时 fire；通过 F026 改键解决（见 Changed）。

### Deps

- `node-pty` ^1.0 (F011) — Win conpty + POSIX；asarUnpack `**/node_modules/node-pty/**`
- `@xterm/xterm` / `@xterm/addon-fit` / `@xterm/addon-web-links` ^5.5 / ^0.10 / ^0.11
- `pdfjs-dist` ^4.10 (F024)
- `mammoth` ^1.8 (F024)
- `xlsx` 0.20.3 from `cdn.sheetjs.com` (F024) — SheetJS CE 官方分发渠道；npm `xlsx` 包已 deprecated

## [0.1.2] - 2026-06-01

### Theme

**KodaX ecosystem wiring.** Surfaces 4 existing-but-hidden KodaX capabilities directly in the Space UI — repo-intelligence status, fork lineage, CLI peer discovery, and one-shot Quick Ask — plus adds a CI pipeline that runs the e2e suite on every commit.

### Added

- **`⚡ Quick Ask` popover** (F018) — press `Cmd/Ctrl+K` anywhere to open a centered modal, type a one-shot question, get a markdown reply, `Esc` to close. Uses an ephemeral plan-mode session so it can't accidentally write files or run bash. Reuses your current project's provider + model.
- **`● Repointel · <mode>` chip** (F015) — repo-intelligence status pill in the ChipBar showing the resolved SDK mode (`OSS` / `Premium (shared)` / `Premium` / `off` / `idle`). Click for the last 3 trace events with engine / latency / cache-hit metadata. Color-coded dot at a glance.
- **`🌳 Show lineage` in session menu** (F016) — keyboard shortcut `L`. Expands the session menu to show the full fork tree the current session lives in (root + all descendants), indented by depth, annotated with `@turn N` for each fork point. Click any node to jump to that session.
- **`Running · N` peers panel** (F017) — shows other live KodaX processes (CLI, other Space windows, REPL) at the top of the LeftSidebar. Click a peer with a sessionId to teleport into its conversation (read-only resume via SDK session storage). 10s polling + window-focus refresh. Auto-hides when there are no other peers.
- **GitHub Actions CI** — new `ci.yml` runs typecheck + unit tests + Playwright e2e on every PR and push to `main`, across Windows + Linux runners (~3 min each). The 5-spec e2e suite (~20s) now blocks regressions automatically.

### Changed

- **`@kodax-ai/kodax` pin bumped to `^0.7.45`** (now published on npm); the catalog reads provider-capabilities.json from the live SDK package.

### Fixed

- **S2 e2e false-fail on CI** — was asserting that the isolated data dir exists right after Space launches; Space mkdir's lazily on first write. The spec now triggers a `project.recent.add` IPC call and then asserts both the dir and `projects.json` exist — a stronger isolation-alive signal that works on clean CI runners.

## [0.1.1] - 2026-06-01

### Theme

**Stability + UX hardening.** First patch release after v0.1.0 — locks in user-visible fixes from real-world dogfooding, adds a Playwright e2e suite covering 5 critical flows, switches the provider catalog to the SDK as single source of truth, and bumps `@kodax-ai/kodax` to 0.7.45.

### Added

- **Friendly SDK error envelope** (OC-11): SDK exceptions now surface as user-readable categories (`rate_limit` / `auth` / `quota` / `network` / `model_unavailable` / `bad_request` / `server_error` / `cancelled` / `unknown`) with action buttons (`Retry` / `Provider settings`) instead of raw stack frames in the conversation stream.
- **Rate-limit retry countdown** (OC-23): when the provider sends `Retry-After`, the SystemNotice shows a live `Retry in 28s` ticker and disables the button until the window passes. Works for both `429` and `5xx` responses.
- **Single-instance lock** (OC-01): double-clicking the launcher brings the existing window forward instead of starting a duplicate process (which could race-write `~/.kodax/`).
- **IPC schema error truncation** (OC-09): Zod error envelopes now keep only `{path, code, message}` per issue, redact `invalid_enum_value` / `unrecognized_keys` messages that would otherwise embed user values, and binary-search-trim to 1KB max.
- **Test-isolation env var** (OC-12): setting `KODAX_TEST_ONBOARDING` redirects `~/.kodax` to `$TMPDIR/kodax-test-<id>` so e2e specs and onboarding tests can run without polluting real user data.
- **Per-code-block copy button** (OC-25): hover any fenced code block in markdown to reveal a `📋 copy` button.
- **StashNotice realtime refresh**: the "uncommitted changes" bar in BottomBar now refreshes on window focus, visibility change, and every 30s — picks up external `git commit` immediately without re-selecting project.
- **Zero-config provider auto-activation** (KX-I-01): on first launch, if any provider API key env var is set (`ANTHROPIC_API_KEY` / `OPENAI_API_KEY` / etc.), the corresponding provider is auto-set as default — no Settings detour needed.
- **Playwright e2e suite (5 specs)**: first-launch UI, isolated data dir, send-prompt + mock-reply roundtrip, Shift+Tab mode cycle, and `/clear` slash command. Runs in ~20s on Windows; foundation for future regression coverage. `npm run e2e` / `npm run e2e:headed`.

### Changed

- **Provider catalog reads SDK truth** (`provider-capabilities.json` directly), with a hardcoded fallback so a broken `npm link` no longer crashes the main process. Future KodaX upstream provider additions propagate automatically on the next launch.
- **Markdown rendering perf** (OC-19): module-level LRU cache (cap 500) + `React.memo` on the Markdown component — re-renders of stable content (theme switch, history scroll-back) drop from 10-30ms to near-zero.
- **Auto-scroll guard** (OC-18): the conversation stream no longer false-detects "user scrolled up" during its own programmatic scroll animations (400ms guard using `performance.now()`).
- **Conversation layout**: Claude Desktop-style two-level tool cluster (`Ran 6 commands ⌄ → sub-cluster → individual tool call`), left-aligned narrow user pill, drop the `<bubble>` wrapper around assistant markdown, rose-pill inline code styling.
- **Tool card colors are status-driven** (was tool-kind based): bash success no longer reads as "error" because of a red body. Card body = `done`/`running` status color; tool kind moves to the tool name text color.
- **Provider env name updates** (KodaX upstream sync from `0.7.45`-line). `@kodax-ai/kodax` published-version pin stays at `^0.7.42` until `0.7.45` lands on npm; local dev uses `npm run link:kodax` to get the upcoming version.

### Fixed

- **Provider env name drift**: 5 coding-plan providers (kimi-code / zhipu-coding / minimax-coding / mimo-coding / ark-coding) had outdated env var names. Now mirrored from KodaX SDK.
- **PermissionModal "Always allow" UX**: was a checkbox + Allow-once button (two clicks); now a third dedicated button. Danger-class commands hide the Always button (cannot silently whitelist).
- **auto[LLM] mode double-prompting**: broker no longer pops permission modals for non-dangerous tools in `auto` mode — lets the SDK guardrail (F030) own that path. Dangerous tools (rm -rf etc.) still pop the modal.
- **skill.discover / mcp.discover from historical sessions**: switched from requiring a live SDK session to taking `projectRoot` directly. Recents-restored sessions no longer throw `session not found`.
- **Model selection persistence**: last-used model now persists across reloads via localStorage.
- **Stop-confirm toast contrast**: light-mode toasts had dark-on-dark text; all 4 tones now dual-themed.
- **Inline copy icon visibility**: replaced the near-invisible `⎘` Unicode glyph with an inline Lucide-style SVG icon.

### Security

- **API keys cannot leak via IPC error envelopes** (OC-09): Zod `invalid_enum_value` / `unrecognized_keys` issue messages — which embed the user's raw value in the template — are now redacted before flowing through the IpcError `details` field.

### Known limitations

- **`@kodax-ai/kodax@0.7.45` not yet on npm**: published-version pin stays at `^0.7.42` for installable CI/release builds. OC-23 retry-after extraction uses `parseRetryAfter` / `extractHeadersFromError` from the SDK's `/llm` subpath — if the installed SDK lacks them, `extractRetryAfterMs()` catches the load failure and returns `undefined`, gracefully degrading to a plain Retry button (no countdown). Local dev uses `npm run link:kodax` to point at the bleeding-edge KodaX repo.
- **`change_model` / `check_network` action buttons** in error notices: text tells you what to do, but the action buttons themselves are not wired yet (followups OC-37 / KX-I-02).

## [0.1.0] - 2026-05-30

### Theme

**First public release.** Claude Desktop-shape conversational shell wrapping `@kodax-ai/kodax` v0.7.44 with full coverage of the SDK's user-facing surface: streaming conversation, tool call visualization, multi-provider key management, permission gating, AGENTS.md context loading, skill + markdown-agent invocation, MCP server lifecycle, session fork/rewind/history, and rich at-input pickers (`/slash`, `@path`, `@agent`). Cross-platform distribution packages for Windows / macOS / Linux via the GitHub Releases page — unsigned in v0.1.0 (signing tracked as FEATURE_027 for v0.1.5+).

### Added

#### Conversation experience

- **Streaming response UI** — text deltas + thinking deltas + tool call cards composed into a Claude Desktop-style bubble flow; markdown rendering with code fence syntax highlighting via `rehype-highlight`
- **Tool call cards** with status icons (running / done / error), expandable input + result with diff awareness, "Ran N commands" aggregation for consecutive tool calls
- **Message footer**: always-visible relative time (`6h ago`) + copy button (icon + on-hover label) on every user / assistant bubble
- **Activity spinner** with real-time status string (`Thinking…`, `Writing…`, `Running tool…`, `Verifying…`, `Compacting context…`), elapsed seconds, iteration counter `iter N/max`, cumulative tokens + tokens/s rate, character count for thinking + tool input partial JSON
- **History restore on session click**: pulls persisted conversation from SDK storage and replays it as `text_delta` + `thinking_delta` + `tool_start` + `tool_result` events. Loading skeleton during the IPC wait. Hover-prefetch on Recents items warms the LRU cache
- **Race-safe history prepend**: if a user sends a new prompt while history is loading, the historical messages are atomically prepended rather than appended — order stays correct

#### Slash commands (11)

- `/mode <plan | accept-edits | auto>` — switch permission mode (Ctrl+M cycles)
- `/auto-engine <llm | rules>` — switch auto-mode classifier (LLM SideQuery vs rule-based)
- `/model [name | default | list]` — set / clear model override; lists provider models with current marker and "did you mean" suggestion on typo
- `/provider <id>` — switch provider mid-session
- `/reasoning <off | auto | quick | balanced | deep>` — reasoning depth ceiling
- `/thinking <on | off>` — toggle thinking output
- `/clear` — clear conversation buffer (session retained)
- `/help` — list all registered commands
- `/memory` — open Agents popout in Edit mode for `~/.kodax/AGENTS.md` or `<project>/AGENTS.md`
- `/compact` — request context compaction on next turn (spike `contextTokenSnapshot.currentTokens` to force SDK trigger)
- `/cost` — show estimated token usage / cost (renderer-side aggregation)
- `/tree` — show session fork lineage tree
- `/history` — list user messages in current session
- `/agent-mode <ama | sa>` — switch agent orchestration mode
- `/copy` — copy last assistant message
- `/new` — create new session
- `/repointel` — RepoIntelligence trace inspection
- `/doctor` — provider diagnostics (key configured + HTTP probe + latency)
- `/status` — list sibling KodaX peer instances (other Space windows / CLI / REPL)
- `/review` — pull `git diff HEAD` and insert a structured review template into the input box

#### Input box affordances

- **`@path` file autocomplete** — Tab/Enter to accept, ↑↓ to navigate, Esc to dismiss. Backed by `project.fileSearch` IPC with 30s cache; ignores `node_modules` / `.git` / `dist` etc; alphabetical ranking with basename hits prioritized
- **`@agent` markdown agent picker** — button next to attach menu lists user-level + project-level agents from `~/.kodax/agents/` and `<project>/.kodax/agents/`; click inserts `@agent-name ` at caret
- **`/slash` command picker** — fuzzy-filter popover, Tab/Enter accept, arg hint per command
- **Input history** — ↑/↓ navigation through previous prompts (per-session, in-memory)
- **Auto-grow textarea** up to 12 rows
- **Ctrl+F** transcript search with ring highlight + ↑↓ match navigation
- **Ctrl+\\** focus mode (hide both sidebars)
- **?** help overlay

#### Status surfaces (above input)

- **NotificationsSurface** — persistent inline notices (auto-mode engine fell back to rules etc), dismissable per-id
- **StashNotice** — git working tree dirty indicator (`● Uncommitted: 3 modified · 1 staged on main`) with debounced refresh on write/edit/bash tool results
- **RetryBanner** — provider 429 / overloaded / recovery countdown timer; reads `retry_after` + `provider_recovery` session events
- **AmaWorkStrip** — active AMA worker title + harness profile + round number + child fanout count + budget approval flag
- **BackgroundTaskBar** — chip strip per subagent worker with status icon (progress / completed / notification / warning)
- **QueueIndicator** — KodaX SDK MessageQueue snapshot badge (hidden when empty); popover with All / Prompts / Tasks / System filter tabs

#### Provider management

- **13 built-in providers**: Anthropic, OpenAI, DeepSeek, Kimi (Moonshot), Kimi for Coding, Qwen (Alibaba), Zhipu, Zhipu Coding Plan, MiniMax Coding, MiMo (Xiaomi), Volcengine Ark Coding, Gemini CLI, Codex CLI
- **Custom providers** (Anthropic-compat / OpenAI-compat) via UI; persisted to `~/.kodax/custom-providers.json` (shared with KodaX CLI)
- **OS keychain integration** (keytar): macOS Keychain / Windows CredMgr / Linux libsecret with in-memory fallback warning when libsecret missing
- **Shell-exported API keys** auto-detected at startup (ANTHROPIC_API_KEY / KIMI_API_KEY / ARK_API_KEY etc) — no double-config required
- **HTTP probe** ("test connection") for each provider before relying on it
- **SDK-driven context window indicator** — pulls per-provider per-model context size via `resolveContextWindow`, falls back to renderer hardcoded table when SDK unavailable
- **Auto-injection of keys** to `process.env` on default-provider change and on add/remove
- **Custom providers from `~/.kodax/config.json`** registered into SDK runtime at startup (shared with `kodax` CLI's `/provider <name>` flow)

#### Permission system (FEATURE_029)

- **Canonical 3-mode** matching KodaX REPL: `plan` (deny mutating tools) / `accept-edits` (auto-allow edit/write, gate bash/network) / `auto` (AutoModeToolGuardrail)
- **Auto-mode sub-engine** (`llm` LLM classifier / `rules` AGENTS.md + auto-rules.jsonc)
- **Denial threshold fallback**: 3 consecutive denies → auto switches `llm` to `rules`
- **Circuit breaker**: 5 LLM-classifier errors / 10min → auto fallback
- **Always-allow rules** persisted to `~/.kodax/auto-rules.jsonc` with pattern matching at broker layer
- **Risk assessment**: tool name + input keys scanned for dangerous patterns (rm -rf, sudo, fork bomb, etc); typed-confirm modal for high-risk tools
- **Plan mode hard-block** via `planModeBlockCheck` predicate passed to KodaX runtime; `exit_plan_mode` LLM-initiated escalation **always rejected** (user must manually switch mode)

#### AGENTS.md context

- Loader walks `~/.kodax/AGENTS.md` + `<project>/AGENTS.md` (KodaX SDK `loadAgentsFiles`)
- Popout viewer with file tab switcher + Edit mode (textarea + Save / Cancel + character counter)
- Create Global / Create Project buttons appear when respective scope is absent
- Atomic writeback (tmp → rename, 0o600 perms)

#### Skills + markdown agents

- Skill discovery from `~/.kodax/skills/`, `<project>/.kodax/skills/`, plugin paths, builtin paths
- Slash popover lists user-invocable skills alongside built-in commands
- Skill invocation via SDK `SkillRegistry.invoke` returning resolved prompt → injected into conversation
- **`!`cmd`` dynamic context** routed through Space's permission broker (each shell command requires user approval; shell-spawn with PATH-only env, 30s timeout, 1MB stdout cap)
- **Markdown agent discovery** (FEATURE_197) from `~/.kodax/agents/*.md` and `<project>/.kodax/agents/*.md`; provenance dots in picker UI + failed-file banner

#### MCP server lifecycle

- Read-only listing (`mcp.discover`) of servers from `~/.kodax/config.json` + `<project>/.kodax/config.json` with merge precedence
- Manager singleton (`mcp.servers`) exposing runtime status (idle / connecting / ready / error / disabled) + tool / resource / prompt counts + lastError + cachedAt
- Start / Stop buttons per server; lazy-connect on demand
- Expandable Tools list per server (capability descriptors with id + name + description)
- Reload config (dispose + reconstruct manager) for live edits to `~/.kodax/config.json`
- Concurrent-init race protection via in-flight promise guard
- Dispose hook on app quit (stdio transport children released)

#### Session management (FEATURE_033 + FEATURE_038)

- **Fork**: branch from any turn into a child session (in-memory metadata + disk lineage via SDK `forkSession`)
- **Rewind**: roll back active entry; renderer truncates event buffer
- **Delete**: graceful in-flight cancel + disk delete
- **Rename**: inline edit (double-click session title)
- **In-memory + persisted unified view**: `session.list` merges live and disk sessions; on-click resume loads disk via lazy `tryResume`
- **/status** command lists sibling KodaX peer instances (multi-window awareness via SDK `listRunningSessions`)

#### Welcome dashboard

- Sessions / messages / tokens / streak / heatmap stats
- 26-week activity heatmap (today-anchored, no trailing column bug)
- Favorite model with provider sub-label
- 30-day commit bar chart per project
- Git stats per project (commits / files changed / lines added/deleted / contributors / current branch)
- Tabs: Overview / Models / Project

#### Diagnostics

- **FileTracingProcessor** opt-in via `SPACE_TRACE_DIR` env (writes JSONL spans for offline analysis)
- **Application menu**: View (Reload / Toggle DevTools / Zoom / Fullscreen) + Window (Minimize / Close); DevTools no longer auto-opens (opt-in via `SPACE_AUTO_DEVTOOLS=1`)
- **Themes**: dark / light / system (Ctrl+Shift+T cycles), synced to OS titlebar overlay on Windows
- **Hover-prefetch** of session history on Recents items
- **Plan-mode auto-toggle** of right sidebar based on todo list state

#### Platform packaging (FEATURE_010)

- **Windows**: NSIS installer (`KodaX-Space-Setup-${version}.exe`)
- **macOS**: DMG for x64 + arm64 (universal-build via electron-builder)
- **Linux**: AppImage (portable) + deb (apt-installable)
- **Auto-update manifests** (`latest*.yml`) uploaded as release artifacts; no update server configured in v0.1.0
- **Cross-platform smoke check** (`smoke-pack.mjs`) validates installer existence, size cap (< 200MB), and asar contents

### Fixed

Pre-release internal review cycles addressed across ~20 review batches; representative items included:

- Atomic `prependSessionHistory` store action eliminated history-restore race that re-ordered messages when user sent during IPC wait
- StashNotice tool-result scan continues past non-write tool results instead of early-exiting at the first one
- AtPathPopover Esc actually closes (dismissed-key state tracks per `@token`)
- AtPathPopover 120ms debounce on per-keystroke `project.fileSearch` IPC
- Project file walker explicitly skips symlinks to prevent monorepo cycle infinite-loop
- McpManager concurrent-init race wrapped with in-flight promise guard
- RetryBanner countdown actually decrements (was recomputing `retryAt` per render)
- Skill `!`cmd`` dynamic context routed through Space permission broker instead of blanket refuse; shell-spawned with PATH-only env + 30s timeout + 1MB stdout cap
- WelcomeDashboard decoupled from `eventsBySession` (subscribes to derived `tokensBySession` slice) — background streaming no longer triggers full dashboard recompute
- `loadKodaxUserDefaults` cached at module level (was hit on every `session.list` call)
- `loadPersistedSession` 5-entry LRU cache with auto-invalidation on fork / rewind / delete
- Main startup `hydrateShellEnv` + `probeKodaxSdk` + `probeSkillRegistry` parallelized (saves 300-800ms to window-visible)
- Cancel button force-emits `session_error` so spinner doesn't hang
- Restored sessions ref moved to module-level Set (survives HMR / Shell remount)
- `/model` autocomplete with did-you-mean + truncated display for large model lists (OpenRouter-style 200+)
- `project.gitDiff` distinguishes "no changes" from "git command failed" via explicit `error` field

### Known limitations

- **No code signing**: Windows SmartScreen and macOS Gatekeeper will warn on first launch. See the release body for documented workaround. Signing tracked as FEATURE_027 for v0.1.5+.
- **No auto-update server**: `latest*.yml` manifests are uploaded but no update server is configured. Users must manually download the new release for upgrades.
- **No PTY terminal**: TerminalPanel shows bash tool history (KodaX-invoked commands), not an interactive shell. A real PTY is tracked for v0.1.x+.
- **Exit-plan-mode**: LLM-initiated plan mode escalation is unconditionally rejected. User must manually switch the Mode selector to `accept-edits` or `auto` to execute the plan. This is intentional — preserves the trust boundary that LLM cannot escalate its own permissions.
- **MCP project-scope servers**: McpManager currently only loads global `~/.kodax/config.json`. Project-level MCP servers (`<project>/.kodax/config.json`) are visible via `mcp.discover` but not actually managed.
- **No SDK-driven cost ($) display**: `/cost` shows token totals only. Real dollar amounts would require integrating SDK `calculateCost` + per-provider rate cards; deferred.
- **TypeScript errors don't block release CI**: `typecheck` is `continue-on-error: true` in the release workflow; manually verify locally before tagging.
