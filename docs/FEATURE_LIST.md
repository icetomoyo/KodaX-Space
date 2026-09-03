# KodaX Space Feature List

> Last reviewed: 2026-09-03
> Latest published release: [`v0.1.45`](https://github.com/icetomoyo/KodaX-Space/releases/tag/v0.1.45) (`0.1.45` package baseline; exact KodaX 0.7.95 Registry, FEATURE_032 v2 inline ask-user cards, admitted-Run reconnect recovery, and KodaX 0.7.95 contract alignment)
> Current source baseline: Space `0.1.46-alpha.3` with exact published prerelease `@kodax-ai/kodax@0.7.96-alpha.7`. Root/Desktop manifests, lockfile, installed bytes, packaged ASAR, and the fully unpacked universal native bundle must resolve the same Registry URL and integrity. Space-managed daemons require explicit capability contracts in addition to the established shared-session safety surface, including local `runtimeExitSettlement:2`, `sandboxRuntime:11`, `runtimeAutoModeGuardrail:5`, `sharedSessionSettings:2`, `providerCredentialBroker:2`, `effectiveConfig:1`, `crashOutcomeModel:2`, `managedRunDurability:1`, `actorSettlementConvergence:2`, `sessionEventJournal:1`, and `conversationHistory:2`; lifecycle support is not inferred from SemVer. Space exposes only Plan, Edits, Auto[LLM], and Full Access; old Rules/engine/timing/envPass state is inert or migrated away. Alpha.6/alpha.7 advance Windows Setup to protected-cache generation 10, keep ordinary admission verify-only, add explicit no-side-effect readiness probes, expand exact-authority proxy capacity, isolate per-command temporary leaves, and reserve cold-start self-repair for the bare interactive CLI. Space diagnostics run doctor/setup at the host boundary, never through model Bash, and Space consumes exact Registry bytes without patching them. The stable Space v0.1.45 / KodaX 0.7.95 record remains historical and is not rewritten as an alpha release.
> Scope: active roadmap, recent completion audit, and reviewed-out decisions. Older release history lives in [FEATURES_ARCHIVED.md](FEATURES_ARCHIVED.md), per-version designs, and [CHANGELOG.md](../CHANGELOG.md).

## Planning rules

- Space is a desktop host, not a second agent engine. KodaX owns runtime behavior; Space owns presentation, review, recovery, policy, and user control.
- SDK-backed work enters the active table only when it has a public contract or a named capability gate. Version numbers never substitute for contract verification.
- Active status is limited to `Planned`, `InProgress`, and `Completed`. Cancelled, superseded, absorbed, decomposed, and shelved work is recorded under **Reviewed out** instead of remaining in the active lifecycle.
- Released version designs are historical records. Unreleased designs may be replaced through an explicit roadmap-rebase note.
- Space feature IDs use `Fxxx`. Upstream dependencies are written as `KX-Fxxx` to prevent ID collisions.
- Every active feature must have a target version, an outcome-oriented title, a design entry, acceptance criteria, and an SDK gate when relevant.
- Feature availability is evaluated in this order: authoritative owner capability and access/retention policy, parent feature flag, surface adapter flag, then optional route/action flag. A child flag never re-enables a disabled parent. Disabling creation or execution preserves owner records, provenance, receipts, audit, and every read-only projection current policy permits; a feature flag alone never deletes them.

## Current summary

| Item                     | Value                                                                                                                                                                                                                                               |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Planned                  | 20                                                                                                                                                                                                                                                  |
| InProgress               | 4                                                                                                                                                                                                                                                   |
| Recent Completed         | 28                                                                                                                                                                                                                                                  |
| Latest published release | [`v0.1.45`](https://github.com/icetomoyo/KodaX-Space/releases/tag/v0.1.45) (KodaX 0.7.95 Registry, FEATURE_032 v2 inline ask-user cards, admitted-Run reconnect recovery, idempotent-send bubble fix, and synchronized release documentation)       |
| 0.1.x completion target  | `v0.1.72`, followed by `v0.1.73` patch/RC reserve                                                                                                                                                                                                   |
| Far-future candidates    | F144 is scheduled after `v0.2.x`; F138 is explicitly deferred until after `v0.5.x`; other candidates remain in [KODAX_CAPABILITY_LEDGER.md](KODAX_CAPABILITY_LEDGER.md) and [FEATURES_ARCHIVED.md](FEATURES_ARCHIVED.md#watchlist-and-reopen-gates) |

## Active features

| ID   | Outcome                                                                                                                                                                                                              | Category               | Priority | Target              | Status      | SDK gate                                                                                                                                                                                                                                                                                                                                                                                                                             | Design                                                                                                                     |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- | -------- | ------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| F121 | Coder Shared Daemon and Multi-Client Live State: one daemon-owned Coder run/session truth observed and controlled by Space, terminal, and IDE clients                                                                | Enhancement / Internal | Critical | `v0.1.32`           | InProgress  | Current source requires explicit Runtime capabilities, including `daemonOrphanExit:1` for Space-scoped orphan idle exit, plus Runtime-owned interrupt finalization, mailbox-driven Agent wait, exact grants, root/child projection isolation, full physical-request diagnostics, Windows background-process hardening, stable cache affinity, and exact manual-compaction lineage; final human multi-client acceptance remains       | [v0.1.32](features/v0.1.32.md#feature_121-coder-shared-daemon-and-multi-client-live-state)                                 |
| F131 | Artifact and File Viewer Separation: Session-generated results and project/Delivery files use independent sidebar state, navigation, refresh, and error semantics while reusing safe preview renderers               | Enhancement / Refactor | High     | `v0.1.32`           | Completed   | None; Space-owned renderer and IPC presentation boundary                                                                                                                                                                                                                                                                                                                                                                             | [F131 design](features/v0.1.32-artifact-file-viewer-separation.md)                                                         |
| F132 | Codex-Aligned Sidebar Context Menus: project and task menus share one polished interaction shell, expose only working actions, and use delete instead of archive                                                     | Enhancement            | High     | `v0.1.32`           | InProgress  | None; Space-owned renderer behavior over existing safe project/session IPC                                                                                                                                                                                                                                                                                                                                                           | [F132 design](features/v0.1.32-sidebar-context-menus.md)                                                                   |
| F133 | Secure Dynamic Web Preview: project HTML runs relative assets and browser-like local interactions in a capability-scoped origin, with explicit network consent and visible diagnostics                               | Enhancement / Security | High     | `v0.1.32`           | Completed   | None; Space-owned protocol, sandbox, CSP and File Viewer boundary                                                                                                                                                                                                                                                                                                                                                                    | [F133 design](features/v0.1.32-secure-dynamic-web-preview.md)                                                              |
| F134 | Canonical Context Compaction Experience: Space consumes root-context outcomes once, rejects stale revisions, and separates effective-window pressure from cumulative Session usage                                   | Enhancement / Internal | Critical | `v0.1.32`           | Completed   | npm-published `0.7.77` diagnostics and compaction contract; `contextCompaction: 3`, durable-before-evict exact history, stable context revision, complete root/child physical-request events with request-ID dedupe, stable prompt-cache affinity, `transcriptPaging: 1`, and `transcriptSearch: 1`                                                                                                                                  | [F134 design](features/v0.1.32-context-compaction-experience.md)                                                           |
| F135 | Vetted Space Builtin Skill Distribution: redistributable skills ship without separate installation under auditable source, license, patch, trust, and exact package-integrity gates                                  | Enhancement / Internal | High     | `v0.1.32`           | Completed   | Public KodaX Skill plugin registration only; no SDK fork or new Runtime capability. User/project precedence and conservative Skill permission policy remain unchanged                                                                                                                                                                                                                                                                | [F135 design](features/v0.1.32.md#feature_135-vetted-space-builtin-skill-distribution)                                     |
| F136 | Controllable Windows Background Runtime Host: closing the Space window releases the renderer while a visible tray owner can reopen the UI, inspect Runtime activity, or request a safe complete exit                 | Enhancement / Internal | High     | `v0.1.32`           | Completed   | Public daemon inspect/preflight plus the published CLI stop contract; Space never force-stops active work or a daemon retained by another client                                                                                                                                                                                                                                                                                     | [F136 design](features/v0.1.32.md#feature_136-controllable-windows-background-runtime-host)                                |
| F140 | Cross-Platform Visible Runtime Exit: Windows can ask/keep a visible tray; every real Windows/macOS/Linux exit stops Runtime or restores Space, with orphan idle recovery after crashes                               | Enhancement            | High     | `v0.1.34` hardening | In Progress | Dedicated `daemonOrphanExit:1` plus revision-fenced safe stop; a blocked exit now offers Keep open or explicit Force close. Force close cancels only Space-owned Runs/Agents/Workflows/interactions/queues under bounded waits, preserves other clients, and commits Electron exit without re-entering the blocker loop. Packaged macOS/Linux process acceptance and the upstream asynchronous cleanup retry/verification gap remain | [F140 design](features/v0.1.33-close-behavior.md#feature_140-configurable-main-window-close-behavior)                      |
| F137 | Chinese-First Native Document Skill Suite: independently authored DOCX/PDF/XLSX/PPTX builtins provide complete governed core format workflows                                                                        | New / Internal         | High     | `v0.1.61`           | Planned     | Existing Skill and `registerTool` APIs; Space owns cancellable document jobs, bounded Worker/child-process execution, native format primitives, validation, delivery and first-party Skill snapshots. F129 reuses the PPTX service for Studio/target-Office verification; F138 is not a gate                                                                                                                                         | [v0.1.61](features/v0.1.61.md#feature_137-chinese-first-native-docxpdfxlsxpptx-builtin-skills)                             |
| F138 | OS-Enforced Document and Native Tool Sandbox Hardening: add platform backends for filesystem, network, process-tree and native-resource isolation without changing document workflows                                | Internal / Security    | Medium   | `post-v0.5.x`       | Planned     | Space owns native helpers, packaging, policy and adapter execution. KodaX 0.7.78's public sandbox facade may supply command-containment primitives, but it does not complete the broader F138 document/native-resource boundary                                                                                                                                                                                                      | [post-v0.5.x design](features/v0.5.x-plus.md#feature_138-os-enforced-document-and-native-tool-sandbox-hardening)           |
| F139 | Semantic Motion, Scroll Affordance, and State Emphasis: dense Task Dock surfaces gain stable hit targets, bounded list motion, scroll-edge cues, active rails, and semantic glows                                    | Enhancement            | High     | `v0.1.61`           | Planned     | None; Space-owned renderer/CSS behavior over existing state. No KodaX SDK, Runtime, IPC, persistence, React Bits, or other animation-runtime dependency                                                                                                                                                                                                                                                                              | [v0.1.61](features/v0.1.61.md#feature_139-semantic-motion-scroll-affordance-and-state-emphasis)                            |
| F141 | Customer-Selectable Coder Runtime Mode: Settings can switch Coder between the recommended shared daemon and an embedded compatibility owner, then restart safely                                                     | Enhancement            | High     | `v0.1.33`           | InProgress  | Public KodaX Runtime owner policy, daemon management/`stopForInline`, inline owner fence, and existing Space restart lifecycle; switching never bypasses active work or another daemon client                                                                                                                                                                                                                                        | [v0.1.33 maintenance](features/v0.1.33-maintenance.md#feature_141-customer-selectable-coder-runtime-mode-and-safe-restart) |
| F142 | Conversation File Action Menus: recognized file paths keep their existing left-click route and expose the shared viewer/diff/@path/copy/reveal menu on right-click                                                   | Enhancement            | Medium   | `v0.1.33`           | Completed   | None; Space-owned renderer behavior reusing the existing safe File Viewer, diff, composer insertion, clipboard, and reveal paths                                                                                                                                                                                                                                                                                                     | [v0.1.33 maintenance](features/v0.1.33-maintenance.md#feature_142-conversation-file-action-menus)                          |
| F143 | Explicit ASRT Setup and Readiness: users can inspect, refresh, and explicitly provision the KodaX command sandbox without startup-time or ordinary-call elevation                                                    | Enhancement / Security | High     | `v0.1.35`           | Completed   | Published KodaX 0.7.80 `@kodax-ai/kodax/sandbox` facade v1; Space uses doctor/guidance/activation contracts, preserves structured no-execution behavior, and never infers readiness from package presence or triggers setup without a user-confirmed action                                                                                                                                                                          | [v0.1.35](features/v0.1.35.md#feature_143-explicit-asrt-setup-and-readiness)                                               |
| F144 | Windowed Continuous Transcript Virtualization: arbitrarily long paged conversations retain natural bidirectional scrolling while the mounted DOM stays bounded                                                       | Enhancement / Internal | Medium   | `post-v0.2.x`       | Planned     | No new KodaX capability; consume the existing canonical newest/older page, immutable cursor, revision/source-revision, `data_changed`, and exact history-boundary contracts                                                                                                                                                                                                                                                          | [post-v0.2.x design](features/v0.2.x-plus.md#feature_144-windowed-continuous-transcript-virtualization)                    |
| F145 | Cross-Platform Attention Badge: unread and action-required Sessions appear as a numeric badge on the native Windows taskbar/tray, macOS Dock, and supported Linux launchers                                          | Enhancement            | High     | `v0.1.44`           | Completed   | None; Space-owned renderer attention projection, typed IPC, and Electron desktop integration. Linux numeric launcher badges remain desktop-environment dependent                                                                                                                                                                                                                                                                     | [v0.1.44](features/v0.1.44.md#feature_145-cross-platform-attention-badge)                                                  |
| F130 | Partner Composer-First Skill Workspace: new-task scene shortcuts write editable prompts, real installed Skills work through explicit and Auto LLM activation, and Results/Process/Files stay beside the conversation | Enhancement            | High     | `v0.1.64`           | Planned     | Existing KodaX SkillRegistry, `skill` tool, `skillDynamicContext`, Partner AgentProfile/tool policy, and F095/F109/F114/F122-F124; no new SDK API and no permission expansion                                                                                                                                                                                                                                                        | [v0.1.64](features/v0.1.64.md#feature_130-partner-composer-first-skill-workspace)                                          |
| F117 | Coder Memory Agent Desktop Host: extend the completed Memory Governance surface with runtime recall notices, outcome evidence, scope, correction, and purge semantics                                                | New                    | High     | `v0.1.68`           | Planned     | Coder-only KX-F260/F228 contract; host activation/rollback control and remaining UX/query/action contracts still gate full delivery. No Partner Context Broker adapter                                                                                                                                                                                                                                                               | [v0.1.68](features/v0.1.68.md#feature_117-memory-agent-desktop-host)                                                       |
| F118 | Learned Skill Safety Surface: a minimal Runtime-owned attention/list/detail/control path for evidence, immutable revisions, canary/validation, trust, disable, and rollback                                          | New                    | High     | `v0.1.35`           | Completed   | Published `learningCenter:1` + `skillLearningLoop:1`; learned-Skill-first, no Space store, no Memory/Extension/Workflow union, and no archive/restore without a public Runtime operation                                                                                                                                                                                                                                             | [v0.1.35](features/v0.1.35.md#feature_118-learned-skill-safety-surface)                                                    |
| F076 | Localization Completion Gate: typed `zh-CN`/`en-US`, response-language preference, pseudo-locale QA, and required hard-coded-string CI scan                                                                          | Enhancement / Internal | High     | `v0.1.72`           | Planned     | None                                                                                                                                                                                                                                                                                                                                                                                                                                 | [v0.1.72](features/v0.1.72.md#feature_076-localization-completion-gate)                                                    |
| F094 | Beta Release Readiness and Diagnostics: version cohesion, capability degradation, provider guards, packaged smoke, diagnostics bundle, and release checklist                                                         | Internal               | High     | `v0.1.72`           | Planned     | Consume `space.version` and capability ledger; no sandbox implementation or feasibility promise                                                                                                                                                                                                                                                                                                                                      | [v0.1.72](features/v0.1.72.md#feature_094-beta-release-readiness-and-diagnostics)                                          |
| F101 | Release Channels and Distribution Trust: dev/beta/stable policy, updater integrity, signing/notarization decision, and downstream npm compatibility                                                                  | Internal / Security    | High     | `v0.1.72`           | Planned     | Track KX-F262 npm/trusted-publishing changes as a downstream compatibility gate                                                                                                                                                                                                                                                                                                                                                      | [v0.1.72](features/v0.1.72.md#feature_101-release-channels-and-distribution-trust)                                         |
| F050 | Governed Browser Runtime: visible session-scoped browsing, navigation, capture, citation artifacts, permission policy, and audit for Coder and Partner                                                               | New                    | High     | `v0.2.0`            | Planned     | Space-owned Electron capability; Partner uses F116 embedded hosting, while Coder requires an authenticated F121 host-tool binding on an explicitly Space-started run                                                                                                                                                                                                                                                                 | [v0.2.0](features/v0.2.0.md#feature_050-governed-browser-runtime)                                                          |
| F051 | Partner Document Work Pack: evidence-grounded extraction, transformation, summary, and Office/PDF delivery workflows                                                                                                 | New                    | Medium   | `v0.2.0`            | Planned     | Reuse formal KodaX Skills and Space delivery writers; do not depend on learned-skill activation                                                                                                                                                                                                                                                                                                                                      | [v0.2.0](features/v0.2.0.md#feature_051-partner-document-work-pack)                                                        |
| F052 | Partner Research and Citation Pack: browser/web/project-material research, evidence comparison, citation coverage, and durable reports                                                                               | New                    | High     | `v0.2.0`            | Planned     | Local/project-material plus `web_search`/`web_fetch` research is the baseline; JS navigation, interaction, and capture are a browser-enhanced route that requires F050                                                                                                                                                                                                                                                               | [v0.2.0](features/v0.2.0.md#feature_052-partner-research-and-citation-pack)                                                |
| F096 | Connector Foundation and Read Snapshots: catalog, authorization state, scoped read snapshots, provenance, revocation, and governed project-material/knowledge adoption                                               | New                    | High     | `v0.2.3`            | Planned     | Provider-specific adapters must advertise capabilities; governed writes are a later separately reviewed feature                                                                                                                                                                                                                                                                                                                      | [v0.2.3](features/v0.2.3.md#feature_096-connector-foundation-and-read-snapshots)                                           |
| F097 | Local Automations Scheduler: manual/scheduled triggers, Runtime dispatch, permission profile, last/next run, durable task linkage, and notifications                                                                 | New                    | Medium   | `v0.2.6`            | Planned     | Partner dispatch uses F116 embedded ownership; Coder dispatch requires the F121 daemon/task owner. Definition revisions and run records remain Space-owned coordination records                                                                                                                                                                                                                                                      | [v0.2.6](features/v0.2.6.md#feature_097-local-automations-scheduler)                                                       |
| F110 | Refreshable Partner Artifacts: durable interactive HTML/dashboard artifacts, explicit data bindings, manual refresh, versions, and audit                                                                             | New                    | Medium   | `v0.2.6`            | Planned     | Depends on F055 and the existing ArtifactVersion store; connected refresh also requires F096. Manifests declare render/refresh requirements, never durable execution grants                                                                                                                                                                                                                                                          | [v0.2.6](features/v0.2.6.md#feature_110-refreshable-partner-artifacts)                                                     |
| F125 | Hybrid Retrieval and Evidence Ranking: optional dense retrieval/rerank, bounded full-context path, filters, evaluation, and explainable ranking                                                                      | Enhancement / Internal | High     | `v0.1.66`           | Planned     | FTS5 baseline ships in F122/F124; embedding and rerank providers remain explicit optional capabilities with no mandatory cloud or SDK dependency                                                                                                                                                                                                                                                                                     | [v0.1.66](features/v0.1.66.md#feature_125-hybrid-retrieval-and-evidence-ranking)                                           |
| F126 | Curated Knowledge Lifecycle and Core Project Context: proposed drafts, approval, versions, diffs, status, evidence coverage, and bounded scope-gated project context                                                 | Enhancement            | High     | `v0.1.66`           | Planned     | Space-owned evolution of F070/F072/F074; no new KodaX memory store and no automatic promotion of inferred chat content                                                                                                                                                                                                                                                                                                               | [v0.1.66](features/v0.1.66.md#feature_126-curated-knowledge-lifecycle-and-core-project-context)                            |
| F129 | Partner Presentation Project and Verified Native PPTX Delivery: template-first projects with real previews, editable verified exports, and gated user-template/creative expansion                                    | New                    | Critical | `v0.1.67`           | Planned     | No KodaX SDK gate; Space owns project/Studio/target-Office verification, pins an audited presentation engine, and reuses F137's native PPTX format service instead of adding a competing writer                                                                                                                                                                                                                                      | [v0.1.67](features/v0.1.67.md#feature_129-partner-presentation-project-and-verified-native-pptx-delivery)                  |
| F127 | Knowledge Freshness, Conflict, and Access Integrity: evidence-owner impact propagation, stale/conflict review, retention, export, deletion, and fail-closed adapters                                                 | Enhancement / Security | Critical | `v0.1.70`           | Planned     | F098 is the local audit/policy foundation; future F096 connectors must translate revocation/provenance into this contract and remain gated until they do                                                                                                                                                                                                                                                                             | [v0.1.70](features/v0.1.70.md#feature_127-knowledge-freshness-conflict-and-access-integrity)                               |
| F128 | Knowledge Quality Evaluation and Operational Diagnostics: golden queries, retrieval/citation/grounding metrics, traces, health, rollout gates, and rollback                                                          | Internal               | High     | `v0.1.72`           | Planned     | No SDK gate; integrates with F094 beta diagnostics, while graph work remains shelved under F075 unless measured repeated-query failures justify reopening it                                                                                                                                                                                                                                                                         | [v0.1.72](features/v0.1.72.md#feature_128-knowledge-quality-evaluation-and-operational-diagnostics)                        |

## Version plan

| Version           | Theme                                                                                                                 | Features                          | Exit condition                                                                                                                                                                                                                                                                                                                                                                            |
| ----------------- | --------------------------------------------------------------------------------------------------------------------- | --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `v0.1.31`         | Runtime, platform trust, and semantic control                                                                         | F116, F055, F069, F120            | Runtime migration stays stable; packaged origin, diagnostics, and the governed semantic-action plane pass their combined release gate.                                                                                                                                                                                                                                                    |
| `v0.1.32`         | Shared Coder, usable Partner knowledge, truthful review, vetted builtin skills, and controllable background ownership | F121, F122, F123, F124, F131-F136 | Coder clients converge on one daemon truth; Partner persists and cites project knowledge; files remain reviewable; compaction remains responsive; approved skills package reproducibly; Windows users can see, reopen, or safely stop the background owner.                                                                                                                               |
| `v0.1.33`         | Runtime ownership, integration-config and desktop lifecycle stabilization                                             | F140-F142 + maintenance fixes     | Both Coder owners switch safely; live snapshots are monotonic; split integration files and the SDK mechanism manual remain authoritative; conversation paths/attachments/context are truthful; exact Registry dependency closure, native load, real packaged boot, and CI pass.                                                                                                           |
| `v0.1.34`         | Runtime safety and desktop lifecycle hardening                                                                        | F140 hardening + maintenance      | Exact 0.7.78 Registry bytes, resilient integration health, Auto v4, truthful sandbox status/helpers, visible complete exit, startup UX, history replay, local release gates, and GitHub CI pass without overstating Issue 133/F138.                                                                                                                                                       |
| `v0.1.35`         | Learned Skill and command-sandbox safety surfaces                                                                     | F118, F143                        | Released 2026-08-05: ships the minimum learned-Skill control path plus explicit ASRT readiness, refresh, guidance, user-confirmed Windows setup, KodaX 0.7.80 Registry alignment, and durable Run/history ownership gates.                                                                                                                                                                |
| `v0.1.36`         | Session and Runtime reconciliation hardening                                                                          | Maintenance fixes                 | Released 2026-08-05: aligns KodaX 0.7.82, serializes active Session input admission, preserves run/turn identity through history/live reconciliation, isolates renderer recovery, and updates the user/in-app manuals.                                                                                                                                                                    |
| `v0.1.37`         | Recovery and release alignment                                                                                        | Maintenance fixes                 | Released 2026-08-06: aligns KodaX 0.7.83, preserves multi-Session/run/turn ownership through recovery, keeps failed safe close visible and recoverable, and synchronizes the public and in-app manuals.                                                                                                                                                                                   |
| `v0.1.38`         | KodaX 0.7.84 and Session recovery maintenance                                                                         | Maintenance fixes                 | Exact 0.7.84 Registry bytes, bounded Agent progress, same-owner Stop reconciliation, Session reactivation identity recovery, tracked icon packaging, local release gates, and GitHub CI pass without changing business logic in release preparation.                                                                                                                                      |
| `v0.1.39`         | KodaX 0.7.85 settlement convergence and Session journal alignment                                                     | Maintenance fixes                 | Exact 0.7.85 Registry bytes are pinned. Unknown Runs accept exactly-once after-turn input, preserve live history, and Stop only the visible exact Run; Session journal epochs remain isolated. Packaged Windows fault injection and release gates remain.                                                                                                                                 |
| `v0.1.40`         | KodaX 0.7.86 sandbox and owner-reconciliation maintenance                                                             | Maintenance fixes                 | Exact 0.7.86 Registry bytes are pinned. SDK and Runtime require sandboxRuntime v3; packaged Windows Shell and stale inline-owner recovery are covered by bounded smoke/regression gates.                                                                                                                                                                                                  |
| `v0.1.41`         | Provider recovery and latest KodaX alignment                                                                          | Maintenance / Recovery            | Exact npm latest KodaX 0.7.87 is pinned. Ordered provider.recovery events reconcile provisional drafts across live, history, reconnect, snapshot hydration, and Ctrl+R without content-based deduplication; docs and kodax_manual are synchronized.                                                                                                                                       |
| `v0.1.42`         | Causal transcript and latest KodaX alignment                                                                          | Maintenance / Recovery            | Exact npm latest KodaX 0.7.89 is pinned. Actor settlement v2, exact Session/Run/Turn owner reconciliation, continued-Run projection, Session deletion feedback, classifier-reason visibility, and the complete manual/release gate are synchronized.                                                                                                                                      |
| `v0.1.43`         | Runtime exit and filesystem-effect convergence                                                                        | Maintenance / Recovery            | Exact audited npm Registry KodaX 0.7.92 bytes, SDK-owned exit settlement, stale coordinator-ticket/recorded-release convergence, canonical managed terminal ordering, and capability-fenced daemon replacement.                                                                                                                                                                           |
| `v0.1.44`         | Native attention and recovery-surface alignment                                                                       | F145 / Maintenance                | Exact KodaX 0.7.93; unique Session attention across native surfaces; background complete exit; canonical page-head, Task Dock and Repointel alignment; recoverable external-task states; actionable previous-boot Windows ACL guidance.                                                                                                                                                   |
| `v0.1.45`         | Inline ask-user cards and KodaX 0.7.95 alignment                                                                      | FEATURE_032 v2 / Maintenance      | Exact KodaX 0.7.95 with `conversationHistory:2`, `runtimeExitSettlement:2`, and `sandboxRuntime:5`; ask_user/guardrail answers move from the deleted full-screen modal to inline conversation cards with a dock recall bar and head-card 1-9/Enter/Esc keyboard control; admitted Runs recover after daemon reconnect; one bubble per idempotent send; topology-safe history negotiation. |
| `v0.1.46-alpha.2`  | KodaX 0.7.96-alpha.5 Runtime integration                                                                              | Maintenance / SDK alignment       | Scoped credentials and effective configuration remain intact; permission profiles align to Plan/Edits/Auto[LLM]/Full Access; Runtime gates require Auto guardrail v5, shared settings v2, and sandbox v9; packaged smoke validates the native authority path and alpha.5 Windows concurrency/self-healing contract.                                                                          |
| `v0.1.46-alpha.3`  | KodaX 0.7.96-alpha.7 sandbox readiness and transcript reconciliation                                                 | Maintenance / SDK alignment       | Exact KodaX alpha.7 bytes and sandbox v11 align Space with protected-cache/setup generation 10, explicit host-side readiness probes, verify-only ordinary admission, expanded exact network authority capacity, and private command Temp leaves. Issue 202 additionally makes certified post-terminal canonical history authoritative when Runtime and presentation orders differ, without losing Runtime-only diagnostics. |
| `v0.1.47-v0.1.60` | Reserved after `v0.1.46`                                                                                              | none                              | No feature is assigned to this block; it stays available for maintenance and stabilization releases.                                                                                                                                                                                                                                                                                      |
| `v0.1.61`         | Native document Skills and semantic UI polish                                                                         | F137, F139                        | Independently authored document workflows and semantic UI gates pass without weakening file, delivery, accessibility, or validation boundaries.                                                                                                                                                                                                                                           |
| `v0.1.62`         | —                                                                                                                     | none                              | —                                                                                                                                                                                                                                                                                                                                                                                         |
| `v0.1.63`         | —                                                                                                                     | none                              | —                                                                                                                                                                                                                                                                                                                                                                                         |
| `v0.1.64`         | Partner composer-first Skill workspace                                                                                | F130                              | New tasks offer editable scene prompts above the composer; Partner can explicitly or automatically invoke installed Skills under unchanged permissions, with context and Results/Process/Files on demand.                                                                                                                                                                                 |
| `v0.1.65`         | —                                                                                                                     | none                              | —                                                                                                                                                                                                                                                                                                                                                                                         |
| `v0.1.66`         | Partner knowledge quality and curation                                                                                | F125, F126                        | Optional semantic ranking improves measured recall, while accepted project knowledge becomes reviewable, versioned, and reusable.                                                                                                                                                                                                                                                         |
| `v0.1.67`         | Partner Presentation Project                                                                                          | F129                              | Stable-template projects produce editable PPTX through one durable project with real preview, bounded engine execution, and Office verification; other authoring paths stay fidelity-gated.                                                                                                                                                                                               |
| `v0.1.68`         | Memory Agent host                                                                                                     | F117                              | Ships after the remaining host activation/rollback plus F117 Episodes/Activity/correction/forget/purge contracts are compatible.                                                                                                                                                                                                                                                          |
| `v0.1.69`         | —                                                                                                                     | none                              | —                                                                                                                                                                                                                                                                                                                                                                                         |
| `v0.1.70`         | Partner knowledge integrity                                                                                           | F127                              | Local source changes, conflicts, access loss, retention, export, and deletion propagate visibly and fail closed across retrieval.                                                                                                                                                                                                                                                         |
| `v0.1.71`         | Patch reserve                                                                                                         | none                              | Reserved after knowledge freshness, conflict, and access-integrity rollout.                                                                                                                                                                                                                                                                                                               |
| `v0.1.72`         | Beta completion                                                                                                       | F076, F094, F101, F128            | Localization, release trust, diagnostics, and measured Partner knowledge quality form one truthful 0.1.x completion gate.                                                                                                                                                                                                                                                                 |
| `v0.1.73`         | Patch/RC reserve                                                                                                      | none                              | Final 0.1.x stabilization before the connected Partner expansion.                                                                                                                                                                                                                                                                                                                         |
| `v0.2.0`          | Connected Partner                                                                                                     | F050, F051, F052                  | Browser-backed, source-faithful document/research work is governed and produces inspectable deliverables.                                                                                                                                                                                                                                                                                 |
| `v0.2.1-v0.2.2`   | Patch reserve                                                                                                         | none                              | Reserved after the browser/Partner pack lane.                                                                                                                                                                                                                                                                                                                                             |
| `v0.2.3`          | Connector foundation                                                                                                  | F096                              | Read-only connector snapshots have explicit authorization, provenance, revocation, and project-material/project-knowledge adoption boundaries.                                                                                                                                                                                                                                            |
| `v0.2.4-v0.2.5`   | Patch reserve                                                                                                         | none                              | Reserved after the connector foundation.                                                                                                                                                                                                                                                                                                                                                  |
| `v0.2.6`          | Durable artifacts and automations                                                                                     | F097, F110                        | Scheduled Runtime dispatch and refreshable artifacts are local-first, visible, and auditable.                                                                                                                                                                                                                                                                                             |
| `post-v0.2.x`     | Transcript scale hardening                                                                                            | F144                              | Very long canonical conversations keep one natural scroll surface while true bidirectional windowing bounds mounted DOM, layout, and paint work.                                                                                                                                                                                                                                          |
| `post-v0.5.x`     | Native execution security hardening                                                                                   | F138                              | Release-qualified OS backends enforce staged filesystem, network, process-tree and native-resource isolation without changing established document and presentation workflows.                                                                                                                                                                                                            |

### Roadmap rebase - 2026-07-13: pull Partner knowledge into 0.1.x (schedule superseded below; retained for history)

- User-visible Partner knowledge utility is now the scheduling constraint: the local-source grounded-answer loop ships in `v0.1.33`, immediately after the current `v0.1.32` work.
- F122-F124 no longer wait for browser, connectors, Memory, embeddings, or graph work; those capabilities integrate later through explicit adapters.
- F125-F126 and F127 were pulled into the 0.1.x knowledge lane, and F128 joined the beta completion gate.
- The former `v0.2.9-v0.2.18` knowledge schedule is superseded. One patch reserve remains after each pulled-forward knowledge feature release.

### Roadmap rebase - 2026-07-14: ship the usable Partner loop in v0.1.32

- F122-F124 move from `v0.1.33` into the current `v0.1.32` release so Partner gains a useful project-knowledge loop without waiting for the next feature version.
- `v0.1.32` now has two independently implemented lanes: F121 keeps Coder on the shared-daemon path; F122-F124 keep Partner on the existing Space-owned inline path. Neither lane may route through the other or weaken its ownership boundary.
- The release is complete only when both lanes pass their own acceptance suites and the combined Partner/Coder regression gate.
- `v0.1.33-v0.1.34` became stabilization reserves at that time. The 2026-07-26 F137 rebase temporarily assigned `v0.1.33` to the native document Skill suite; the 2026-07-27 schedule rebase restores `v0.1.33` as the reserve and moves the feature lane to `v0.1.34`.

### Roadmap rebase - 2026-07-14: dedicate v0.1.38 to verified Partner presentations

- F129 replaces the former `v0.1.38` patch reserve with one coherent Presentation Project release; after the later feature-lane rebase, `v0.1.33` and `v0.1.44` retain explicit stabilization capacity.
- The release retires the current bullet-list/hand-written-OOXML PPTX path as Partner's default without changing the accepted F109 DOCX/PDF/XLSX baseline or F114 workspace-delivery boundary.
- PPT Master is the pinned first engine implementation and research basis. Space owns the durable project, worker, template, UI, verification, and migration contracts so later engine changes do not fork the product model.
- Stable template, supplied template, and creative design are authoring choices inside one subsystem; they are not separate tools or independent artifact products. Stable template is the v0.1.38 GA gate, while supplied-template and creative choices remain hidden until their independent corpus/security/editability gates pass.

### Roadmap rebase - 2026-07-17: make the Partner workspace outcome-first

- F130 joins `v0.1.35`, after the enlarged `v0.1.32` baseline, the retained `v0.1.33` stabilization reserve, and the F137 `v0.1.34` document Skill release.
- F130 owns only the Partner shell information architecture: optional deliverable-led entry, on-demand context, conversation-focused center, and Results/Process/Files rail.
- The feature reuses F095 routing, F109/F114 delivery, and F122-F124 project-material/evidence contracts. F125-F129 and the connected Partner roadmap add capability behind the same entry/result surfaces instead of creating more permanent rails or work-mode selectors.
- Coder layout, the existing permission selector, and Auto LLM behavior remain unchanged. WorkBuddy-style Ask/Plan/Craft modes, visible Skill selection, and a general visual-creative promise are explicitly out of scope.

### Product correction - 2026-07-29: make Partner composer-first and Skill-capable

- This decision supersedes F130's five-card outcome launcher, persistent outcome receipt, and exclusion of visible/executable Partner Skills.
- New empty Partner sessions show unheaded scene shortcuts directly above the composer. Selecting one writes an editable prompt; the row disappears after the first accepted user send and creates no persistent mode.
- Partner must use real installed KodaX Skills through both explicit user selection and natural-language Auto LLM activation. A scene template is not a renamed Skill.
- Loading a Skill grants no additional authority. Partner's tool visibility, permissions, allowed roots, connectors, checkpoints, proposals, rollback, and audit continue to govern every requested action.
- The existing Partner-only empty Skills addendum is treated as a historical fail-closed repair for a mismatched tool policy, not a continuing product requirement.

### Roadmap rebase - 2026-07-30: bring learned Skill safety forward

- F118 moves from `v0.1.45` to the open `v0.1.35` slot so the Runtime learning
  loop gains a visible, reversible desktop safety path earlier.
- Scope remains the reduced attention/list/detail/review/trust/reject/disable/
  rollback surface; this rebase does not restore the overdesigned multi-carrier
  Learning Center.
- F130 remains targeted at `v0.1.40`, `v0.1.45` becomes unassigned, and no other
  feature target moves.

### Release rebase - 2026-07-30: use v0.1.34 for verified stabilization

- The actual `v0.1.34` source contains KodaX 0.7.78 Runtime safety, resilient
  integrations, complete-exit/orphan recovery, packaged sandbox helpers,
  startup/shutdown UX, and restored-history fixes. It does not contain the
  planned native document Skill implementation.
- F137 and F139 therefore move intact to the open `v0.1.36` slot. Their scope,
  design, dependencies, and acceptance gates are unchanged and now live in
  `features/v0.1.36.md`.
- F118 remains in `v0.1.35`; F130 and every later feature keep their current
  targets. `v0.1.34` passed the exact local and GitHub evidence in
  `releases/v0.1.34-release-readiness.md` and was published on 2026-07-30.

### Current-source maintenance - 2026-08-02: prioritize canonical history and continuously prepend older pages

- Selecting a Coder Session restores its bounded newest canonical conversation page before
  starting any observation work that can contend for the shared Runtime transport. A terminal
  historical Session uses canonical history plus the lightweight Runtime profile; active, queued,
  pending-interaction, and cursor-gap Sessions still request the authoritative live/Actor snapshot.
- Older canonical pages are loaded only near the top of the transcript and prepend to the existing
  newest page. Stable canonical DOM anchors preserve the viewport, so the transcript grows upward
  as one native scroll surface instead of swapping between page-sized screens. Occluded rows can
  resolve their intrinsic estimates after the first paint, so Space sparsely replays the frozen
  canonical anchor during one bounded settling window; a real position-changing gesture cancels
  that work, while an upward gesture pinned at the physical top does not cancel continuity before
  the newly prepended page becomes reachable. Wheel, keyboard, and touch follow the same rule.
- Space owns this presentation and scheduling policy. KodaX continues to own canonical ordering,
  immutable page cursors, revision/source-revision fences, and `data_changed` resynchronization.
  The UI never content-deduplicates or timestamp-sorts restored records.
- Long accumulated transcripts use browser occlusion (`content-visibility`) per rendered message,
  while Session-level restored histories remain bounded by the existing LRU eviction policy.
- Terminal observations and their Actor polling are retired after authoritative terminal state;
  active/queued Runs, pending interactions, snapshot gaps, and active compaction retain observation.
  Reconnect and invalidation paths preserve those same demand rules instead of reviving every
  historical Session.

### Current-source maintenance - 2026-08-23: stabilize live history, status, build, and shutdown

- Runtime-ready newest-page revalidation retains a loaded prefix through exact canonical item
  identity even without a truncation marker and when the overlap begins with assistant/tool output.
  Queued delivery is spliced at its causal turn; renderer reconciliation never sorts timestamps or
  deduplicates equal text.
- History loading uses a waiting spinner and factual retry state. Sidebar activity, Stop controls,
  terminal state, and compaction telemetry are fenced to the current Runtime identity. Exact
  terminal Run identity closes lagging profile activity without comparing Session-journal and
  aggregate-profile sequence domains, and later terminal events cannot erase an earlier Run fence.
  A new Session journal epoch may reset its sequence while still settling the exact pending send.
  Compaction does not present a stale token snapshot as current progress.
- Release dependency verification honors proxy environment, validates Registry URLs, and tears down
  failed sockets after its bounded timeout. App shutdown aborts pending startup-recovery waits so
  late Runtime reconciliation cannot reopen or block an exiting Space process.
- Exact KodaX 0.7.95 closes explicit-Skill durable display: Space passes `rawUserInput`, the SDK
  persists that original query once, and the prepared execution prompt remains model-only. The
  same baseline advances exit settlement to v2 and sandbox recovery to v5. No release is prepared here.

### Roadmap rebase - 2026-07-30: move the document and semantic UI lane to v0.1.37

- F137 and F139 move together from `v0.1.36` to the open `v0.1.37` slot.
- Their scope, priority, dependencies, implementation plan, and acceptance
  gates remain unchanged; the authoritative design now lives in
  `features/v0.1.61.md`.
- `v0.1.36` becomes unassigned. No other feature target moves.

### Release closure - 2026-08-05: use v0.1.36 for session reconciliation hardening

- The unassigned `v0.1.36` maintenance slot is now released with KodaX 0.7.82
  alignment, active-Session input admission, exact history/live identity, and
  renderer recovery isolation.
- F137 and F139 remain scheduled for `v0.1.61`; this release does not change
  their design, scope, priority, dependencies, or acceptance gates.
- The release is maintenance-only. No new Feature ID is marked completed by
  this closure; unresolved lifecycle and performance limits remain in
  `KNOWN_ISSUES.md`.

### Release closure - 2026-08-06: use v0.1.37 for recovery and release alignment

- The maintenance slot is released with the exact KodaX 0.7.83 Registry package,
  multi-Session recovery validation, safe-close recovery, and synchronized public
  and in-app documentation.
- No new Feature ID is marked completed by this release; F137 and F139 remain
  scheduled for `v0.1.61`, and unresolved lifecycle/performance limits remain in
  `KNOWN_ISSUES.md`.

### Release preparation - 2026-08-07: v0.1.38 KodaX 0.7.84 maintenance

- The next maintenance release aligns Space package metadata and the in-app
  manual to `v0.1.38` while consuming the exact KodaX 0.7.84 Registry package.
- The release record covers bounded Agent progress, exact same-owner Stop
  recovery, Issue 176 Session reactivation, tracked icon packaging, and the
  complete documentation set. No new Feature ID is marked completed.

### Release preparation - 2026-08-14: v0.1.41 provider recovery and latest KodaX alignment

- The candidate aligns every Space package manifest, runtime capability contract, and the in-app kodax_manual to v0.1.41 while pinning the npm latest KodaX package exactly to 0.7.87.
- Provider recovery uses the existing ordered Runtime event to replace only provisional assistant/thinking drafts and keeps live display, history, reconnect, snapshot hydration, and Ctrl+R convergent.
- Release documentation includes the v0.1.41 feature design, readiness record, Issue 181 regression guide, README/manual updates, capability ledger, known-issue resolution, and changelog entry.
- No new system business logic or KodaX SDK contract is introduced by release preparation.

### Release preparation - 2026-08-16: v0.1.42 causal transcript and latest KodaX alignment

- The candidate aligns every Space package manifest, runtime capability contract, and the in-app kodax_manual to v0.1.42 while pinning the npm latest KodaX package exactly to 0.7.89.
- Renderer reconciliation preserves exact Session/Run/Turn ownership across canonical/live folding, delayed terminals, continued Runs, reconnect, and Ctrl+R; no timestamp sorting or content-based deduplication is introduced.
- The release records Actor settlement convergence v2, explicit create-time model continuity, bounded classifier-reason visibility, Session deletion feedback, and the Issue 182-185 regression coverage.

### Release preparation - 2026-08-24: v0.1.45 inline ask-user cards and KodaX 0.7.95 alignment

- The release aligns every Space package manifest, runtime capability contract,
  lock view, public manual, and in-app `kodax_manual` to v0.1.45 while pinning
  npm `latest` KodaX exactly to audited Registry 0.7.95.
- FEATURE_032 v2 replaces the deleted full-screen AskUserModal with inline
  conversation cards: every pending card stays answerable, a dock recall bar
  above the composer shows the count and flash-locates the head card, and the
  head card owns 1-9/Enter/Esc keyboard control with four yielding layers.
  The change is renderer-only and preserves per-reqId settlement semantics.
- Maintenance scope requires `conversationHistory:2`, `runtimeExitSettlement:2`,
  and `sandboxRuntime:5`, recovers admitted Runs after daemon reconnect, keeps
  one bubble per idempotent send, negotiates history by the current Session's
  stable topology, and keeps loading/status/compaction feedback truthful.
- Release documentation includes the v0.1.45 feature design, readiness record,
  Issue 193/196/197 regression guides, README/manual updates, capability
  ledger, known-issue resolutions, and changelog entry. Release preparation
  changes only metadata, tests, release automation, and docs.

### Release preparation - 2026-08-20: v0.1.44 native attention and recovery-surface alignment

- The release aligns every Space package manifest, runtime capability contract,
  lock view, public manual, and in-app `kodax_manual` to v0.1.44 while pinning
  npm `latest` KodaX exactly to audited Registry 0.7.93.
- F145 projects one count per unread or action-required Session to the Windows
  taskbar/tray, macOS Dock, and supported Linux launchers without adding a
  second notification store.
- Maintenance scope keeps admitted Windows complete-exit settlement in the
  background, removes ordinary success balloons, aligns canonical page heads,
  Task Dock and Repointel with live Runtime facts, distinguishes persisted
  external-task empty/error states, and makes previous-boot ACL blocks
  actionable without Setup or elevation.
- Release documentation includes the v0.1.44 feature design, readiness record,
  F145 acceptance guide, Issue 189-192 regression guides, README/manual updates,
  capability ledger, known-issue resolutions, and changelog entry. Release
  preparation changes only metadata, tests, release automation, and docs.

### Release preparation - 2026-08-19: v0.1.43 Runtime exit and filesystem-effect convergence

- The candidate aligns every Space package manifest, runtime capability contract, and the in-app kodax_manual to v0.1.43 while pinning the npm latest KodaX package exactly to 0.7.92.
- Complete exit delegates to `settleKodaXRuntimeExit()`; sandboxRuntime v4 and crashOutcomeModel v2 are required from SDK and connected Runtime; live output uses SDK `liveOutputSegments:1`.
- Release documentation includes the v0.1.43 feature design, readiness record, Issue 188/256 regression guides, README/manual updates, capability ledger, known-issue resolution, and changelog entry.

### Maintenance - 2026-08-17: v0.1.43 crash-resumable complete exit

- Space requires local SDK `runtimeExitSettlement:1` and delegates complete
  Runtime exit to `settleKodaXRuntimeExit()` instead of copying owner, Job, or
  Windows ACL protocols.
- Recovery relaunch settles the durable exact-owner ticket before owner-policy
  reconciliation or daemon auto-start; unresolved post-mutation states block a
  replacement owner and stay visible.
- A failed Session/Runtime initialization can still exit an idle existing
  daemon through a temporary `autoStart:false` management connection and the
  same SDK settlement; unrelated adapter seams no longer select the legacy
  shutdown path implicitly.
- Windows exact-owner recovery is autonomous; macOS/Linux stuck-process paths
  remain fail-closed during the same boot and recover after a durable reboot
  fence. See [v0.1.43](features/v0.1.43.md) and
  [Issue 188](test-guides/ISSUE_188_v0.1.43_REGRESSION_GUIDE.md).
- Release preparation changes remain limited to version metadata, tests, CI/release configuration, and documentation; system business logic is not changed for the release.

### Release preparation - 2026-08-14: v0.1.40 KodaX 0.7.86 sandbox and owner-reconciliation maintenance

- The candidate aligns every Space package manifest and the in-app `kodax_manual`
  to package `0.1.40` while consuming the exact npm Registry KodaX `0.7.86`
  bytes and requiring `sandboxRuntime:3` from both SDK and Runtime.
- The release record covers Issue 128 packaged Electron/ASAR Windows Shell
  coverage, sandbox-first fallback semantics, Issue 180 owner reconciliation,
  retryable owner cleanup, and the complete documentation set. No new Feature ID
  is marked completed.

### Release preparation - 2026-08-11: v0.1.39 KodaX 0.7.85 maintenance

- The candidate aligns every Space package manifest and the in-app `kodax_manual`
  to package `0.1.39` while consuming the exact npm Registry KodaX `0.7.85`
  bytes.
- The release record covers Actor settlement convergence, Session journal epoch
  isolation, exact unknown-Run after-turn input and Stop ownership, live-history
  preservation, input deduplication, and the complete documentation set. No new
  Feature ID is marked completed.

### Current-release addition - 2026-07-20: separate Artifact and File Viewer ownership

- F131 joins the current `v0.1.32` release as a bounded UI/IPC correctness feature after a no-Session project file rendered successfully while the shared Artifact surface displayed an unrelated refresh failure.
- Artifact remains a real-Session generated-result workspace; File Viewer becomes a project/Delivery-scoped transient reader. They reuse safe renderers but not list, refresh, selection, version, action, or error state.
- The addition did not change F121 Runtime ownership, F122-F124 Partner knowledge, Artifact persistence, project files, or the then-current reserve plan; later roadmap entries record the temporary F137 assignment and its one-version deferral.

### Current-release addition - 2026-07-20: align sidebar project and task menus

- F132 replaces the two independently styled legacy context menus with one Codex-aligned menu shell and a tested action inventory.
- Project actions cover pin-to-top, reveal in the system file manager, rename, and remove. Task actions cover pin/read state, rename, project-folder access, safe clipboard facts, continue-as-new-task, and delete.
- Archive is deliberately removed from both menus. Worktree creation/continuation, deep links, and detached task windows remain absent until their lifecycle and ownership contracts are designed; the menu does not advertise inert actions.

### Current-release addition - 2026-07-21: consume KodaX 0.7.74 compaction truth once

- F134 upgrades the Coder host to KodaX 0.7.74's context-owned compaction contract and keeps the Runtime event stream as the sole owner for daemon-backed manual compaction lifecycle events.
- Root context identity and revision make token projection monotonic: late or compatibility events cannot overwrite a newer post-compaction value. Child context accounting remains visible to diagnostics but cannot move the root gauge.
- The context indicator preserves the active model input while exposing the latest committed or unchanged compaction outcome; paging restores oversized daemon transcripts without truncating the visible history.
- Current-source maintenance measures the effective-window bar and composition against the final auto-compaction threshold, presents the model maximum and threshold independently, and excludes reserved response capacity from active input. No percentage copy is allowed to invent a relationship between an absolute threshold and the model maximum.
- A separate Session-usage indicator accumulates Provider-reported input/output for root and child Agents, including cache subsets when available. Compact can reduce the root active context but cannot reduce usage that has already occurred.

### Current-release addition - 2026-07-23: synchronize the refreshed 0.7.74 contract

- The latest supplied 0.7.74 tgz is now the reproducible Space dependency: its SHA-512 replaces the stale same-version lock entry without introducing a local `file:` resolution.
- F134 raises the daemon gate to compaction v3 plus transcript paging/search so exact pre-compaction history is durable before eviction and every search result is revision-bound.
- F121 consumes FEATURE_273 semantics inside `actorControlPlane: 1`: model `wait_agent` is mailbox control, while Space/SDK progress remains telemetry. Resumed root prompts are recorded once, unacknowledged root completions are crash-recoverable, and child live-only state cannot replace the root projection.

### Current-release addition - 2026-07-25: finalize on KodaX 0.7.76

- Both workspaces now use the official `@kodax-ai/kodax@0.7.76` Registry bytes and reject older resident daemons.
- The installed provider catalog defaults `kimi-code` to direct `k3-256k` with `high` reasoning while retaining K3 1M and both K2.7 Code routes.
- KodaX supplies audited hidden-window coverage for Runtime Worker non-interactive Windows child processes and correct Sidecar optional-follow-up/budget terminal semantics.
- Space rejects interrupt submission once a managed task enters `verifying` or `completed`, closing the remaining gap between the last root queue-drain boundary and Runtime terminalization without silently changing the user's delivery mode.
- Goal lifecycle tools remain resident full contracts; Space documents the contract but does not create a duplicate tool-disclosure layer or advertise a fictitious Actor capability version.

### Current-source maintenance - 2026-07-27: align npm-published KodaX 0.7.77

- Root and Desktop manifests require exact `0.7.77`; the official Registry tarball has SHA256 `E30B447059F1C237B81E5896E51698D3FFD7987A8C5E1CF15F9F2354C846F63C` and lockfile SRI `sha512-doAvH966LlOk/fBvmMZCmVSBbvLNPHKWtMaEQ6C2Vqvzs6ninQEs290ECGNHvAP/dMuRh2gD6Dso76HUgzLfzw==`.
- Space consumes completed prompt-cache diagnostics for root and child physical requests, deduplicates them by `requestId`, persists a bounded replay window, and retains `iteration_end.usage` only as a legacy/mock fallback.
- IPC preserves `requestEnvelopeHash`, optional `ephemeralSuffixHash`, and optional `promptCacheAffinityHash` without exposing prompt bodies or the affinity key. The latest root diagnostic remains separate from whole-Session accounting.
- KodaX now owns the interrupt finalization boundary, so Space removed the 0.7.76 managed-task verification fence instead of maintaining a second admission rule.
- Built-in compatible Providers use stable logical-Session cache affinity across retries, fallbacks, resume, and compaction; child Agents remain isolated by canonical Agent path. Strict custom gateways stay default-off and require an explicit Space opt-in.
- The CLI bridge now preserves Provider-reported cached-read and cache-creation usage for Codex and cached usage for Gemini, so the existing Session accounting path consumes those values without a second estimator.
- Public `kimi/kimi-k3` is selectable with a 1,048,576-token context. F274 adaptive AMA and F275 governed memory intervention remain Runtime-owned; Space does not invent a second policy or topology.
- `npm ls @kodax-ai/kodax --all` resolves one deduplicated 0.7.77 package from the official Registry; local candidate-file dependencies are no longer required.

### Current-release addition - 2026-07-23: distribute vetted Space builtin skills

- F135 packages `frontend-slides` and `huashu-design` as installer-owned resources registered through the public Skill plugin bridge; clean-profile users do not copy either skill into `~/.kodax/skills`.
- Every source is pinned to an upstream Git revision and approved license hash. Reviewable Space patches remove Huashu's promotional watermark/signature and machine-specific assumptions; the generated tree is locked by exact file path, size, and SHA-256.
- Coder discovery merges Space-owned builtins with the Runtime daemon catalog by name, preferring the Space entry so both shipped skills remain available in slash completion without duplicates.
- Sync and release gates reject license drift, symlinks, unsafe source text, stale patches, temporary `installed:` revisions, and any packaged file-set/byte mismatch. Runtime scripts remain outside `app.asar`, while the trust/permission policy stays conservative.
- The locally installed `pdf`, `pptx`, `xlsx`, and `docx` skills are excluded because their current license prohibits redistribution. Optional Huashu browser/video/TTS/AI-review flows may still require external runtimes or credentials.

### Current-release addition - 2026-07-23: make background Runtime ownership visible and controllable

- F136 keeps a lightweight Windows tray owner after the last Space window closes, while destroying the BrowserWindow and renderer resources.
- The tray exposes Runtime/task/other-client status, reopens the Space window, closes only the UI, quits Space while retaining Runtime, or requests a complete exit.
- Complete exit disconnects the Space client first and stops the daemon only through Runtime's own idle/no-peer safety checks. Active/queued work, pending interactions, or another attached client preserve the daemon instead of being force-killed.
- The v0.1.32 release keeps Electron main alive as the tray owner; moving the tray into a separate helper so the main process can also exit is a future optimization, not a hidden v0.1.32 claim.

### Current-source maintenance - 2026-07-26: unify button interaction feedback

- Every enabled renderer button now receives one shared soft-sweep, luminous-edge, active, and `focus-visible` language derived from the Session Token usage control.
- Semantic action colors remain truthful: accent, success, warning, reasoning, and danger controls tint the shared material instead of all appearing informational.
- Full-width rows use lower intensity; portal-mounted Settings and Quick Ask controls are included. Windows title-bar controls, Monaco, xterm, disabled controls, and explicit opt-outs retain independent interaction behavior.
- Motion follows the visual-quality and `prefers-reduced-motion` contracts. The change adds no layout size, copy, persistence, Runtime, permission, or ownership surface.

### Roadmap rebase - 2026-07-26: independently authored native document Skills in v0.1.33 (schedule superseded below; retained for history)

- F137 assigns `v0.1.33` to four Chinese-first `docx`, `pdf`, `xlsx`, and `pptx` builtins; `v0.1.34` remains the stabilization reserve.
- The design was frozen before a capability-only comparison against Anthropic's source-available document products. Space does not copy or translate their prompts, code, examples, assets, tests, structure, or implementation recipes.
- F137 adds cancellable multi-output document jobs, bounded Worker/child-process execution, untrusted-evidence boundaries, and truthful validation receipts. Its format functionality does not wait for an OS security sandbox.
- The format suite does not replace F051's later mixed-source document-work workflows. F137 owns shared native PPTX mechanics; F129 reuses them for the durable Studio, high-fidelity authoring loop, Office compatibility matrix, and verified-editability label.
- F135 gains a first-party local-source snapshot path; authored Skill sources are separate from generated `resources/builtin-skills/` package inputs.
- Existing public KodaX Skill registration and tool registration are sufficient because long work runs as a Space-owned Document Job. Native host-tool cancellation/progress would require a future SDK enhancement only if Space later chooses a blocking host-tool design.

### Roadmap rebase - 2026-07-27: prioritize document functionality before OS sandbox hardening

- F137 `v0.1.34` and F129 `v0.1.38` keep bounded Worker/child-process execution, private staging, resource/time limits, macros/link updates disabled, cancellation, and process-tree cleanup, but no longer require an OS-enforced sandbox to expose qualified functionality.
- F138 is a separate `post-v0.5.x` security-hardening feature for platform-enforced filesystem, network, process-tree, credential and native-resource isolation. It is not a dependency of F137 or F129.
- KodaX 0.7.78 adds a public, fail-closed command-sandbox facade and structured execution observations. Space consumes the observation contract and may reuse the facade in F138, but F138 remains `Planned`: document staging, credential and native-resource isolation, packaging, platform qualification and fallback policy are still Space-owned work.
- Current releases disclose the residual native parser/renderer risk and never label Worker isolation, ordinary child processes, worktrees, or Electron renderer sandboxing as an OS security sandbox.

### Current-release addition - 2026-07-27: make motion communicate UI state (original schedule superseded below)

- F139 joins `v0.1.33` as an independent renderer-only enhancement beside F137; it has no document-job, KodaX SDK, Runtime, IPC, persistence, or release-order dependency.
- The release borrows behavior-level ideas from Animated List, Gradual Blur, Line Sidebar, Border Glow, Specular Button, and Count Up while implementing them independently with existing Space motion, visual-quality, CSS, and accessibility contracts.
- GA scope is bounded to complete sidebar hit targets, true-insertion list motion, overflow-aware scroll-edge hints, one active Task Dock rail, and semantic state emphasis. Primary-button/metric polish is non-blocking.
- Full-page animated backgrounds, cursor trails, tilted/magnetic targets, multi-layer live blur, duplicate global sheen, copied third-party component source, and new animation runtimes remain out of scope.

### Roadmap rebase - 2026-07-27: defer the v0.1.33 feature lane by one version

- F137 and F139 move together from `v0.1.33` to `v0.1.34`; their scope, priority, dependencies, and acceptance gates do not change.
- `v0.1.33` returns to the near-term stabilization reserve for the enlarged `v0.1.32` baseline, and no feature is assigned to it.
- F130 remains targeted at `v0.1.35`; the deferral consumes the former `v0.1.34` reserve without shifting later feature releases.

### Current maintenance addition - 2026-07-27: make F136 close behavior explicit

- F140 consumes a bounded part of the `v0.1.33` stabilization reserve to add a
  user-configurable close policy over F136's existing tray and safe daemon-stop
  lifecycle.
- Profiles without an effective preference ask on the first user-driven close;
  an optional remembered choice persists through Space settings, and Settings
  can restore the ask-every-time behavior.
- The change does not force-stop Runtime work, reinterpret explicit tray
  commands, or alter the `v0.1.34` F137/F139 feature lane.

### Current-release correction - 2026-08-01: add a terminal force-close escape hatch

- F140's safe path remains the default. When blockers are present, the native
  warning now offers exactly Keep Space open and Force close; dialog dismissal
  maps to Keep open.
- Force close cancels Runtime Runs and Agent Turns attributable to Space plus
  Space-owned Workflow, external-Agent, interaction, and queued-input work.
  Shared Runtime work is filtered by authenticated principal, exact accepted
  work IDs, and Workflow source-Run provenance—not Session identity—so another
  client's task remains untouched even inside the same Session.
- After bounded cancellation, Space safely stops an idle/unshared daemon when
  possible. A cancellation or daemon-stop failure is logged but cannot re-enter
  the blocker dialog: the user-confirmed Space process exit remains terminal.
- Independent review hardened the terminal branch: safe-preparation failures
  now expose the same two actions, Session disposal only detaches after exact
  cancellation, and a forced watchdog timeout can never relaunch Space.

### Current release correction - 2026-07-28: honor split integrations and preserve the SDK manual

- Space follows the public KodaX 0.7.77 integration contract: core Runtime settings remain in
  `config.json`; MCP, trusted filesystem Extension paths, and A2A live in independently versioned
  `integrations/mcp.json`, `integrations/extensions.json`, and `integrations/a2a.json`.
- Global/project MCP discovery, `.mcpb` CRUD, Settings source reporting, and embedded Extension
  discovery use SDK readers instead of interpreting the root config locally. Legacy MCP/Extension
  fields remain migration fallbacks and are never presented as the canonical write location.
- Settings shows the SDK plan and applies migration through a validated host action that creates
  only missing files, keeps the legacy fields, and reloads MCP/Extension runtime state.
- `kodax_manual` now seeds `KODAX_UNDERLYING_CAPABILITY_TOPICS`. Space overlays that share an id
  retain the exact installed SDK body, aliases, and sources, while desktop-only topics remain
  Space-authored. Composition occurs after the ESM-only SDK export is dynamically loaded, and
  regressions cover the entire curated topic list plus packaged main-process startup.
- This is a compatibility correction to existing MCP/Extension/manual functionality, not a new
  Feature ID or a second configuration owner.

### Release correction - 2026-07-28: reissue v0.1.33 after withdrawal

- The withdrawn `v0.1.33` is rebuilt from the corrected main branch. F141/F142 plus the
  integration-config/manual, attachment, context, file-action, runtime-recovery, and packaging
  corrections are part of the replacement `v0.1.33` release.
- At that time F137 and F139 remained planned together for `v0.1.34`; the
  2026-07-30 rebase moved their reviewed design to `features/v0.1.36.md`.
  No document-skill or semantic-motion implementation is claimed by `v0.1.33`
  or the actual `v0.1.34` safety release.
- The replacement tag cannot be created while the exact npm KodaX 0.7.77 dependency, packaged
  dependency-closure, native SQLite load, true application boot, or GitHub CI gate fails.

> Post-release schedule note: the 2026-07-30 release rebase above supersedes the
> then-current F137/F139 `v0.1.34` assignment and moves that unimplemented lane
> to `v0.1.36`.

### Roadmap rebase - 2026-08-05: delay the 0.1.x schedule from v0.1.37 onward by five versions

- Every feature targeted at `v0.1.37` or later inside the 0.1.x line moves five minor versions later: F137/F139 `v0.1.37 → v0.1.42`, F130 `v0.1.40 → v0.1.45`, F125/F126 `v0.1.42 → v0.1.47`, F129 `v0.1.43 → v0.1.48`, F117 `v0.1.44 → v0.1.49`, F127 `v0.1.46 → v0.1.51`, and the beta-completion set F076/F094/F101/F128 `v0.1.48 → v0.1.53`.
- The 0.1.x completion gate moves to `v0.1.53` with the final patch/RC reserve at `v0.1.54`; the dedicated stabilization reserve stays one version after F127 (`v0.1.52`). `v0.1.36` remains unassigned.
- Design files moved accordingly: `features/v0.1.37.md → v0.1.42.md`, `v0.1.40.md → v0.1.45.md`, `v0.1.42.md → v0.1.47.md`, `v0.1.43.md → v0.1.48.md`, `v0.1.44.md → v0.1.49.md`, `v0.1.46.md → v0.1.51.md`, `v0.1.48.md → v0.1.53.md`.
- The `v0.2.x` schedule (F050-F052 at `v0.2.0`, F096 at `v0.2.3`, F097/F110 at `v0.2.6`) and the post-`v0.2.x`/post-`v0.5.x` lanes are unchanged.

### Roadmap rebase - 2026-08-15: move every post-v0.1.40 feature lane after v0.1.60

- Every feature targeted after `v0.1.40` inside the 0.1.x line moves nineteen minor versions later: F137/F139 `v0.1.42 → v0.1.61`, F130 `v0.1.45 → v0.1.64`, F125/F126 `v0.1.47 → v0.1.66`, F129 `v0.1.48 → v0.1.67`, F117 `v0.1.49 → v0.1.68`, F127 `v0.1.51 → v0.1.70`, and the beta-completion set F076/F094/F101/F128 `v0.1.53 → v0.1.72`.
- The 0.1.x completion gate moves to `v0.1.72` with the final patch/RC reserve at `v0.1.73`; the dedicated stabilization reserve stays one version after F127 (`v0.1.71`). After the v0.1.42 maintenance release, `v0.1.43`-`v0.1.60` remain unassigned as a maintenance and stabilization reserve block.
- Design files moved accordingly: `features/v0.1.42.md → v0.1.61.md`, `v0.1.45.md → v0.1.64.md`, `v0.1.47.md → v0.1.66.md`, `v0.1.48.md → v0.1.67.md`, `v0.1.49.md → v0.1.68.md`, `v0.1.51.md → v0.1.70.md`, `v0.1.53.md → v0.1.72.md`.
- Scope, priority, dependencies, and acceptance gates of every moved feature are unchanged. The `v0.2.x` schedule and the post-`v0.2.x`/post-`v0.5.x` lanes are unchanged.

## Recent completed features

| ID   | Released  | Outcome                                                         | Evidence                                                                                         |
| ---- | --------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| F136 | `v0.1.32` | Controllable Windows Background Runtime Host                    | [F136 design](features/v0.1.32.md#feature_136-controllable-windows-background-runtime-host)      |
| F135 | `v0.1.32` | Vetted Space Builtin Skill Distribution                         | [F135 design](features/v0.1.32.md#feature_135-vetted-space-builtin-skill-distribution)           |
| F134 | `v0.1.32` | Canonical Context Compaction Experience                         | [F134 design](features/v0.1.32-context-compaction-experience.md)                                 |
| F122 | `v0.1.32` | Project Source Library and Incremental Ingestion                | [v0.1.32](features/v0.1.32.md#feature_122-project-source-library-and-incremental-ingestion)      |
| F123 | `v0.1.32` | Stable Evidence Locators and Citation Navigation                | [v0.1.32](features/v0.1.32.md#feature_123-stable-evidence-locators-and-citation-navigation)      |
| F124 | `v0.1.32` | Partner Context Broker and Automatic Grounded Recall            | [v0.1.32](features/v0.1.32.md#feature_124-partner-context-broker-and-automatic-grounded-recall)  |
| F116 | `v0.1.31` | Runtime Host Adapter and Capability Negotiation                 | [v0.1.31](features/v0.1.31.md)                                                                   |
| F055 | `v0.1.31` | Packaged Renderer `app://space` Origin                          | [v0.1.31](features/v0.1.31.md#feature_055-packaged-renderer-appspace-origin)                     |
| F069 | `v0.1.31` | Structured Main-Process Logging and Diagnostic Export           | [v0.1.31](features/v0.1.31.md#feature_069-structured-main-process-logging-and-diagnostic-export) |
| F120 | `v0.1.31` | Natural-Language Space Control                                  | [v0.1.31](features/v0.1.31.md#feature_120-natural-language-space-control)                        |
| F103 | `v0.1.29` | Workspace Environment Hub, Task Dock, and Floating Surface Host | [v0.1.29](features/v0.1.29.md)                                                                   |
| F088 | `v0.1.29` | Coder Memory Governance over KodaX F228                         | [design addendum](features/v0.1.29-memory-governance.md)                                         |
| F049 | `v0.1.30` | Partner code-knowledge capability playbook                      | [v0.1.30](features/v0.1.30.md)                                                                   |
| F070 | `v0.1.30` | Partner Knowledge Base                                          | [v0.1.30](features/v0.1.30.md)                                                                   |
| F071 | `v0.1.30` | Unicode-aware Partner KB lexical search                         | [v0.1.30](features/v0.1.30.md)                                                                   |
| F072 | `v0.1.30` | Manual KB maintenance and reports                               | [v0.1.30](features/v0.1.30.md)                                                                   |
| F074 | `v0.1.30` | Steerable Partner KB configuration                              | [v0.1.30](features/v0.1.30.md)                                                                   |
| F095 | `v0.1.30` | Scenario-first Partner workbench                                | [v0.1.30](features/v0.1.30.md)                                                                   |
| F098 | `v0.1.30` | Local policy and audit pack                                     | [v0.1.30](features/v0.1.30.md)                                                                   |
| F109 | `v0.1.30` | Office/PDF baseline writers                                     | [v0.1.30](features/v0.1.30.md)                                                                   |
| F113 | `v0.1.30` | Strict reviewed Partner workspace writes                        | [v0.1.30](features/v0.1.30.md)                                                                   |
| F114 | `v0.1.30` | Workspace-first delivery and checkpointed writes                | [v0.1.30](features/v0.1.30.md)                                                                   |
| F115 | `v0.1.30` | External Agent Orchestration Gateway over KodaX F258            | [external-agent design](features/v0.1.30-external-agents.md)                                     |

## Reviewed out in the 2026-07-12 roadmap rebase

| Previous item                                      | Decision                                      | Replacement or reopen gate                                                                                                                                                                                        |
| -------------------------------------------------- | --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F042 Native helpers                                | Shelved                                       | Reopen only after profiling proves a material JS hot path that cannot be solved within the existing architecture.                                                                                                 |
| F053 Partner custom profile / H1 harness           | Completed within the shipped Partner boundary | KodaX F247 profile, tool visibility, verifier contract, and Space source-faithfulness checks shipped across `v0.1.27-v0.1.30`. Stronger Partner assurance needs measured gaps, not the old SDK R1/R2 placeholder. |
| F067 LiveCanvas React tier                         | Cancelled                                     | Existing static artifacts plus sandboxed `interactive-html` remain the supported path.                                                                                                                            |
| F073 Connector snapshots                           | Absorbed                                      | F096 owns connector catalog, authorization, read snapshots, provenance, revocation, and explicit project-material/project-knowledge adoption.                                                                     |
| F075 Knowledge graph                               | Shelved                                       | Reopen only when Partner KB usage shows graph navigation materially improves a repeated maintenance or discovery task.                                                                                            |
| F077 pseudo-locale and F078 scanner                | Absorbed                                      | Both are acceptance slices of F076.                                                                                                                                                                               |
| F079 `zh-Hant`                                     | Deferred to locale watchlist                  | Reopen after `zh-CN`/`en-US` completion and user demand.                                                                                                                                                          |
| F080 response language preference                  | Absorbed                                      | F076 owns the separation between display locale and assistant response preference.                                                                                                                                |
| F085 durable crash replay UI                       | Cancelled                                     | Cross-process replay left KodaX's active roadmap when Workflow moved to maintenance-only status.                                                                                                                  |
| F086 never-run Workflow draft lifecycle            | Cancelled                                     | KodaX retained source preview, preflight, save, revise, replace, and delete without a separate draft state.                                                                                                       |
| F092 Advisor Consult                               | Cancelled                                     | A new Advisor primitive has not demonstrated enough product value; existing bounded review and verifier paths remain.                                                                                             |
| F093 Skill-only self-improvement panel             | Superseded                                    | F118 supplies a minimal Runtime-owned learned-Skill safety surface without a Space-owned parallel store; Memory, Extension, and Workflow remain outside that carrier model.                                       |
| F099 remote runner/worktree sandbox/monitor bundle | Decomposed                                    | Task monitoring is partly shipped. Local workspace isolation and remote runners return only as separately evidenced features; worktrees are not described as a security sandbox.                                  |
| F100 Notebook surface                              | Deferred                                      | Reopen after KX-F139 NotebookEdit is published or a concrete preview/cell-diff user journey is prioritized.                                                                                                       |
| F102 slot registry                                 | Shelved                                       | Reopen after at least three real internal consumers require the same typed extension seam.                                                                                                                        |
| F111 desktop automation                            | Research/ADR only                             | Reopen after governed browser and connector use produce a concrete screen-fallback need and threat model.                                                                                                         |
| F112 continuity remainder bundle                   | Decomposed                                    | Repointel warm, true side query, and CLI handoff writer remain independent capability-ledger gates.                                                                                                               |

## Maintenance

- Update this file, the target version design, and [KODAX_CAPABILITY_LEDGER.md](KODAX_CAPABILITY_LEDGER.md) together whenever an SDK-backed status changes.
- On release, move the feature to Recent Completed and update the changelog. After it falls outside the recent audit window, move it to [FEATURES_ARCHIVED.md](FEATURES_ARCHIVED.md).
- Do not restore reviewed-out work by changing only its status. Record the measured reopen gate and create a new design decision first.
