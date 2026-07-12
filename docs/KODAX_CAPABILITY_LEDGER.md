# KodaX Capability Ledger

Last reviewed: 2026-07-12

This file is the Space-side source of truth for capabilities that depend on the upstream KodaX SDK. It exists to keep desktop feature planning honest: a feature is either supported by the current SDK contract, partially implemented through an available event/API, planned on the Space side, or blocked until KodaX exposes a contract.

## Version Baseline

| Component          | Current baseline       | Notes                                                                                                    |
| ------------------ | ---------------------- | -------------------------------------------------------------------------------------------------------- |
| KodaX Space app    | 0.1.30 current release | Published as `v0.1.30` from the final `main` release commit.                                             |
| Desktop package    | 0.1.30                 | `@kodax-space/desktop`.                                                                                  |
| IPC schema package | 0.1.30                 | Aligned with app package metadata.                                                                       |
| UI kit package     | 0.1.30                 | Aligned with app package metadata.                                                                       |
| KodaX SDK          | exact published 0.7.67 | Root, desktop specs and lockfile resolve the same npm tarball; local source linking is development-only. |

## Capability Contract

Runtime IPC contract: `space-v0.1.30`

`space.version` now exposes:

| Field                 | Purpose                                                                                |
| --------------------- | -------------------------------------------------------------------------------------- |
| `kodaxSdkVersion`     | The installed `@kodax-ai/kodax` package version resolved by the Electron main process. |
| `kodaxDependencySpec` | The dependency range Space was installed/launched with.                                |
| `capabilityContract`  | Space's own interpretation contract for SDK-backed desktop features.                   |
| `capabilities[]`      | Per-feature support ledger consumed by diagnostics UI and later by status panels.      |

## Current Ledger

| Capability                    | Status     | Evidence / next action                                                                                                                                                                                                                                                                                                                               |
| ----------------------------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `repointel.trace`             | supported  | KodaX SDK session trace events are mapped into `repointel_trace` session events and shown by the chip and `/repointel trace`.                                                                                                                                                                                                                        |
| `repointel.status`            | supported  | Space exposes local status/doctor/readout for project, git root, trace source, and warm support. Standalone warm remains SDK-gated.                                                                                                                                                                                                                  |
| `quickAsk.tempSession`        | supported  | Quick Ask uses a temporary plan-mode session, captures events locally, cleans up on close, and can promote the persisted session into Coder.                                                                                                                                                                                                         |
| `quickAsk.sideQuery`          | blocked    | Current SDK does not expose a true side-query API. Do not claim isolated side-query behavior until KodaX ships it.                                                                                                                                                                                                                                   |
| `handoff.receive`             | supported  | Space reads, watches, accepts, and dismisses `~/.kodax/handoffs/*.json` files; CLI-side emit remains a separate SDK/CLI integration gate.                                                                                                                                                                                                            |
| `sidecar.message`             | supported  | KodaX 0.7.53+ exposes `KodaXEvents.onSidecarMessage`; Space maps revise/blocked verifier messages into `sidecar_message` session events and renders them as system notices.                                                                                                                                                                          |
| `todoDrift.warning`           | supported  | KodaX 0.7.53+ exposes `KodaXEvents.onTodoDriftWarning`; Space maps it into `todo_drift_warning` session events and raises a session-scoped notification.                                                                                                                                                                                             |
| `workflow.visibility`         | supported  | Space renders workflow management, graph/pattern topology, transcript summaries, and persisted detail/history recovery from SDK workflow events and local run metadata.                                                                                                                                                                              |
| `displayLanguage.mvp`         | supported  | Space stores `languageMode`, resolves effective locale, and covers the product UI for `zh-CN` and `en-US`, including External Agent management, Workflow target selection, and Task Dock interventions. Model/tool/third-party content is not translated.                                                                                            |
| `composer.imageArtifacts`     | supported  | Space sends PNG/JPEG/WEBP image artifacts through `KodaXContextOptions.inputArtifacts`, preserves KodaX 0.7.56 source provenance (`clipboard`, `drag-drop`, `file-picker`, `user-inline`), supports native clipboard-image fallback, and preflights image artifacts against the selected provider/model before send.                                 |
| `composer.mediaHelpers`       | partial    | Space now uses public `@kodax-ai/kodax/media` helpers for clipboard normalization, sandboxed image artifact construction, and model input validation. GIF direct-path handling, structured file artifacts, and video semantics remain planned.                                                                                                       |
| `sessions.dedupe`             | not-needed | KodaX 0.7.53+ includes the `kodax sessions dedupe` maintenance CLI. Space should not add a desktop button until session hygiene/doctor UX needs it.                                                                                                                                                                                                  |
| `extension.resumeState`       | planned    | KodaX 0.7.53+ preserves interactive extension/MCP state on host-owned resume. Space does not own that state yet; keep visibility planned under F090.                                                                                                                                                                                                 |
| `partner.workspaceFirst`      | supported  | Space 0.1.30+ enables Partner Sources, Knowledge Base, workspace-first Outputs, checkpointed writes, Office/PDF convenience writers, bounded coding boost, and local policy/audit. This does not imply executable Partner Skills, connectors, browser/computer use, automations, or remote tasks.                                                    |
| `externalAgents.reference`    | supported  | KodaX 0.7.67 supplies the protocol-neutral catalog/executor/task ledger plus Reference Executor. Space connects primary-window-only redacted administration, live dispatchability/preflight, main-owned session/task correlation, Worker/Workflow routing, race-safe adaptive Task Dock lifecycle/interventions, durable identity, and bilingual UI. |
| `externalAgents.a2a`          | blocked    | KodaX 0.7.67 does not ship an A2A adapter. Space keeps all A2A registration and dispatch UI hidden until Runtime advertises the adapter and conformance passes.                                                                                                                                                                                      |
| `externalAgents.mcpTasks`     | blocked    | Ordinary MCP remains a tool/data integration. No MCP Agent Profile/Tasks adapter is advertised by 0.7.67, so Space does not claim durable MCP-agent support.                                                                                                                                                                                         |
| `externalAgents.governedHttp` | blocked    | Reference uses an internal HTTP protocol marker but performs no network I/O. A real declarative governed-HTTP adapter is not shipped or exposed.                                                                                                                                                                                                     |

## Review Rules

- Do not mark an SDK-backed capability as `supported` unless there is a stable API/event path in the current SDK.
- If a feature is simulated through existing sessions or local files, mark it `partial` unless the UX and cleanup guarantees match the intended contract.
- If the missing piece is upstream SDK surface, mark it `blocked` and link the later KodaX-side requirement from the feature design.
- Update this file and `space.version` together when capability status changes.
