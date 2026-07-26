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
  <img alt="KodaX SDK" src="https://img.shields.io/badge/KodaX_SDK-0.7.77_candidate-f0a020?style=flat-square">
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
      Permission modes, ask-user modals, keychain-backed credentials, trusted IPC schemas, and local license gates keep agent work visible and reviewable.
    </td>
    <td valign="top">
      <h3>Rich project context</h3>
      Built-in terminal tabs, PDF/docx/xlsx preview, image input, workflow panels, memory governance, and scoped Markdown agents help long sessions stay inspectable.
    </td>
  </tr>
</table>

## Current Source Baseline

**v0.1.32 release baseline on the exact npm-published KodaX 0.7.76 package.** Coder is default-routed to the profile-scoped shared daemon; sessions/runs/settings/interactions, Workflow observation/control, Learning Center operations, catalog discovery, MCP tool discovery/reload, and configured External Agent Actor/Turns use Runtime services. Space requires `contextCompaction:3`, `transcriptPaging:1`, and `transcriptSearch:1` for durable exact-history recovery, plus `interruptInput:1`, Auto LLM guardrail v3, and `actorControlPlane:1`. KodaX 0.7.76 retains the audited Windows background-process hardening and corrected Sidecar terminal semantics while making Kimi Code's direct `k3-256k` route the default, with K3 reasoning defaulting to `high`. Space also closes the remaining managed-task finalization gap locally: interrupts are rejected truthfully once verification starts instead of being accepted and later terminalized without delivery. The release separates model mailbox waits from UI/SDK progress telemetry, preserves queued user prompts across sub-Agent idle yield, keeps Goal lifecycle tools resident, prevents child live-only state from replacing the root projection, and retains exact checkpoint/recovery-guidance bytes on the active compaction lineage. Partner remains an embedded-inline Space owner. MCP processes/logs, Workflow library/start/admin, Space Reference Agent execution, and product artifacts remain explicit host-provider boundaries.

> **Unreleased source maintenance after the published v0.1.32 tag:** current source requires the exact local KodaX 0.7.77 candidate; it is not yet available from npm. The bottom bar separates root-Agent context pressure from cumulative Session token usage. Completed physical-request diagnostics are deduplicated by request ID across root, child, retry, fallback, repair, workflow-digest, and compaction-summary calls; the Context window meter uses the final automatic-compaction threshold and a privacy-safe composition. Space also consumes public `kimi/kimi-k3`, delegates the corrected interrupt-finalization boundary to Runtime, restores Space builtins in daemon-backed slash discovery, distinguishes unauthorized file-reveal scope from a missing file, and moves development/CI to Node 22. These changes remain **Unreleased**, and clean Registry installation is blocked until the reviewed 0.7.77 bytes are published.

F122-F124 deliver the Partner project-source, immutable evidence/citation, and automatic grounded-context loop. F121 remains `InProgress` until the final human multi-client release acceptance is complete; missing required daemon capabilities fail Coder closed rather than silently falling back to an inline owner. See the [v0.1.32 release design](docs/features/v0.1.32.md) and [capability ledger](docs/KODAX_CAPABILITY_LEDGER.md).

F135 also packages the redistributable `frontend-slides` and `huashu-design` skills as vetted Space builtins, so users do not install the skills separately. The distributed Huashu adaptation removes default promotional watermark/signature markup and instructions while retaining the upstream MIT license and authorship. Optional browser/video/TTS/AI-review pipelines still need their documented external runtimes or credentials. The locally installed `pdf`, `pptx`, `xlsx`, and `docx` skills are not bundled because their current license prohibits redistribution. F137 now plans independently authored, Chinese-first replacements for `v0.1.33`, using Space-owned document operations and validation rather than copied or translated proprietary materials. See the [v0.1.33 design](docs/features/v0.1.33.md), [builtin skill maintenance](docs/BUILTIN_SKILLS.md), and the [v0.1.32 release-readiness checklist](docs/releases/v0.1.32-release-readiness.md).

F136 makes the Windows background owner visible and controllable. Closing the last window destroys its renderer but leaves a notification-area icon that can reopen Space, show bounded Runtime/task/other-client status, quit Space while preserving Runtime, or request a complete exit. Complete exit asks Runtime to stop only after Space disconnects and only when no active/queued/pending work or other client remains. The lightweight Electron main process still owns the tray in 0.1.32; moving it to a separate helper is future optimization.

Resolved release blocker: KodaX 0.7.76 retains the centralized Windows
`windowsHide` hardening introduced in 0.7.75, so ordinary daemon-backed Coder
queries no longer flash short-lived child-process consoles. Space consumes the
official Registry package without vendoring an SDK patch. See
[Issue 091](docs/KNOWN_ISSUES.md#091-ordinary-windows-queries-can-flash-several-short-lived-command-windows-from-kodax-runtime-child-processes).

## Current Release

**v0.1.32 - Shared Coder and Usable Partner Knowledge**

Released: 2026-07-25 as [`v0.1.32`](https://github.com/icetomoyo/KodaX-Space/releases/tag/v0.1.32), aligned to the exact npm-published KodaX 0.7.76 package.

This release moves Coder to a profile-scoped shared daemon while keeping Partner and product-specific boundaries explicitly Space-owned.

| Area                   | Summary                                                                                                                                                                                                  |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Shared Coder Runtime   | Sessions, runs, settings, interactions, exact transcript recovery, Workflow control, Learning/catalog/MCP discovery, and configured Actor/Turns converge on one daemon truth.                            |
| Partner knowledge      | F122-F124 add durable project sources, local FTS5 retrieval, immutable evidence, stable citations, exact usage traces, and automatic Partner grounding without moving Partner into the daemon.           |
| Review and reliability | Artifact/File Viewer separation, truthful Changes projection, secure web previews, responsive compaction, Sidecar terminal correction, and finalization-safe interrupt handling close the release races. |
| Builtins and Windows   | Audited redistributable builtins package reproducibly; Windows Setup/Portable use the KodaX icon, expose a controllable tray owner, and hide noninteractive SDK child processes.                         |
| KodaX 0.7.76           | The exact Registry package provides direct Kimi Code `k3-256k`, K3 `high` reasoning by default, mailbox-safe Agent coordination, compaction v3, transcript paging/search, and Auto LLM guardrail v3.     |
| Verification           | Final main CI and Build passed without test retries; the four-platform production workflow published 18 validated Windows, Linux, and macOS x64/arm64 assets.                                            |

See [CHANGELOG.md](CHANGELOG.md), the [v0.1.32 design](docs/features/v0.1.32.md), and the [v0.1.32 release record](docs/releases/v0.1.32-release-readiness.md). The record keeps unexecuted human journeys unchecked; Issue 043 (unsigned macOS prompts) and Issue 022 (future Partner Runtime migration) remain disclosed boundaries.

## Previous Releases

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
| Capability honesty        | Runtime-configured A2A is available through the KodaX 0.7.76 Coder daemon after capability negotiation; MCP Tasks and governed HTTP remain hidden until separately delivered adapters pass conformance. |
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

| Surface            | Purpose                                                                                                                                                                                                                    |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Coder workspace    | Main AI coding session surface, backed by the KodaX SDK runtime, with separate effective-context and cumulative Session-token indicators in current source.                                                                |
| Environment Hub    | Compact project/session/environment router for location, branch, changes, sources, and mode context.                                                                                                                       |
| Task Dock          | Persistent right-side task surface for run status, plan, agents, workflow, changes, sources, artifacts, and context.                                                                                                       |
| Review workspace   | Diff and file-review surface for changes that need inspection.                                                                                                                                                             |
| Artifact workspace | Preview, inspect, and export generated artifacts.                                                                                                                                                                          |
| Terminal workspace | Real PTY terminal tabs scoped to the selected project.                                                                                                                                                                     |
| MCP and Skills     | Desktop management and display paths for KodaX MCP servers and skills, plus vetted builtin `frontend-slides` and `huashu-design` distributions.                                                                            |
| Memory Governance  | Review, approve, reject, and inspect memory proposals and approved references.                                                                                                                                             |
| Partner surface    | Enabled workspace-first knowledge-work surface with Sources, KB, Outputs, checkpointed writes, Office/PDF convenience writers, and local policy/audit controls.                                                            |
| External Agents    | KodaX 0.7.76 Runtime-configured Coder Agents use unified Actor/Turn tasks; Space Reference Agents retain main-window administration and the durable Task Dock intervention path. MCP Tasks and governed HTTP remain gated. |

## Configuration Model

KodaX Space intentionally reuses KodaX ecosystem state where it should, and owns desktop-only state where the UI needs it.

| State                                 | Behavior                                                                                                                                      |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `~/.kodax/config.json`                | Used for provider defaults, MCP server configuration, permission defaults, custom providers, and KodaX runtime configuration where supported. |
| `~/.kodax/sessions/`                  | Shared session history with KodaX CLI/REPL.                                                                                                   |
| `~/.kodax/handoffs/`                  | Desktop handoff inbox for session continuity.                                                                                                 |
| `~/.kodax/skills/` and project skills | Discovered by the KodaX skills runtime.                                                                                                       |
| API keys                              | Stored through OS keychain when available; environment variables remain supported.                                                            |
| `~/.kodax/space/`                     | Space-owned preferences, projects, UI state, and desktop-specific metadata.                                                                   |
| `<profile-root>/runtime/`             | Shared Runtime daemon state and run/event journal; with the default profile this resolves to `~/.kodax/runtime/`.                             |

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

| Layer                 | Choice                                                                                                                                                       |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Shell                 | Electron 42                                                                                                                                                  |
| Renderer              | React 19, Vite, TypeScript, Zustand                                                                                                                          |
| UI/runtime separation | Renderer has no direct LLM/tool execution; privileged work stays in Electron main.                                                                           |
| KodaX integration     | Electron main uses the public Runtime facade; Coder attaches to the profile daemon while Partner and explicit host-provider services remain embedded inline. |
| IPC                   | zod-validated contracts from `@kodax-space/space-ipc-schema`.                                                                                                |
| Terminal              | xterm.js + node-pty.                                                                                                                                         |
| Preview               | Monaco, pdfjs, mammoth/docx, SheetJS/xlsx.                                                                                                                   |
| Tests                 | Node test runner, Playwright, typecheck, smoke packaging checks.                                                                                             |

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

| Document                                                                                                 | Purpose                                                                                                |
| -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| [README_CN.md](README_CN.md)                                                                             | Chinese README.                                                                                        |
| [CONTRIBUTING.md](CONTRIBUTING.md)                                                                       | Contribution boundaries, validation, and documentation requirements.                                   |
| [docs/README.md](docs/README.md)                                                                         | Documentation hub and current-vs-historical document map.                                              |
| [docs/USER_MANUAL.zh-CN.md](docs/USER_MANUAL.zh-CN.md)                                                   | Illustrated Chinese manual for the v0.1.32 baseline plus explicitly marked current-source maintenance. |
| [docs/USAGE.md](docs/USAGE.md)                                                                           | Source launch, profiles, Runtime Host, testing, packaging, and troubleshooting.                        |
| [docs/BUILTIN_SKILLS.md](docs/BUILTIN_SKILLS.md)                                                         | Builtin skill provenance, licensing, update, patch, and package-integrity workflow.                    |
| [docs/releases/v0.1.32-release-readiness.md](docs/releases/v0.1.32-release-readiness.md)                 | v0.1.32 gates, production evidence, artifact hashes, and recorded manual acceptance.                   |
| [docs/CODING_AGENT_BEGINNER_BEST_PRACTICES.zh-CN.md](docs/CODING_AGENT_BEGINNER_BEST_PRACTICES.zh-CN.md) | Chinese beginner guide for coding-agent practice in software and microservice workflows.               |
| [docs/PRD.md](docs/PRD.md)                                                                               | Product requirements and product positioning.                                                          |
| [docs/HLD.md](docs/HLD.md)                                                                               | High-level architecture and system design.                                                             |
| [docs/ADR/](docs/ADR/)                                                                                   | Architecture decision records.                                                                         |
| [docs/FEATURE_LIST.md](docs/FEATURE_LIST.md)                                                             | Feature ledger, roadmap, and release planning status.                                                  |
| [docs/FEATURES_ARCHIVED.md](docs/FEATURES_ARCHIVED.md)                                                   | Archived release index, reviewed-out decisions, and reopen gates.                                      |
| [docs/KODAX_CAPABILITY_LEDGER.md](docs/KODAX_CAPABILITY_LEDGER.md)                                       | KodaX SDK capability consumption and fallback notes.                                                   |
| [CHANGELOG.md](CHANGELOG.md)                                                                             | Release history.                                                                                       |

## Roadmap

Near-term planned work is tracked in [docs/FEATURE_LIST.md](docs/FEATURE_LIST.md). Current highlights:

| Lane              | Focus                                                                                                                                            |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `v0.1.32`         | Published shared-daemon Coder, Partner project knowledge/citations, vetted builtins, exact-history UX, Windows icon/tray, and release hardening. |
| `v0.1.33`         | Independently authored Chinese-first DOCX/PDF/XLSX/PPTX builtins with sandboxed inspection, controlled create/edit slices, and truthful validation receipts. |
| `v0.1.35-v0.1.40` | Workflow/review evidence, task/capability governance, then SDK-gated Memory Agent and Learning Center hosts.                                     |
| `v0.1.43`         | Localization completion, beta diagnostics, release channels, updater/distribution trust.                                                         |
| `v0.2.x`          | Governed browser and Partner packs, read-only connector snapshots, local automations, and refreshable artifacts.                                 |

Remote runners, notebooks, knowledge graphs, desktop screen automation, and unshipped External Agent adapters are reopen-gated watchlist items, not committed release features.

## License

[KodaX-AI Fair Core License (KAI-FCL)](LICENSE) - Copyright 2026 icetomoyo.

KAI-FCL is source-available / fair-core, not OSI open source. Commercial, enterprise, managed deployment, or customer redistribution use requires KodaX-AI authorization and a valid entitlement where required.

KodaX-AI's current official licensing policy is that KodaX Space 0.1.27 and later are provided under KAI-FCL or accompanying KodaX-AI customer terms when distributed by KodaX-AI with that notice. Historical tags, source archives, installers, or other copies already distributed with Apache-2.0 notices remain under Apache-2.0 for those specific copies.
