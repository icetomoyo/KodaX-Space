# KodaX Space Archived Feature Index

> Created by the 2026-07-12 roadmap rebase.
> This file preserves the compact historical index and reviewed-out decisions. Per-version design documents and [CHANGELOG.md](../CHANGELOG.md) remain the detailed release record.
> For current product, architecture, and active roadmap documents, start from the [documentation hub](README.md).

## Status normalization

The pre-rebase list used `Completed`, `Done`, `Merged`, `Partial`, `Deferred`, `Blocked`, and `Planned` in one lifecycle. The active list now uses only `Planned`, `InProgress`, and `Completed`. Other outcomes are historical decisions:

- `Done` was normalized to `Completed` for released work.
- `Merged` and `Partial` are recorded as release-history relationships, not active states.
- `Blocked` work without a stable public contract moved to a capability gate or reviewed-out record.
- `Deferred` work without a committed release moved to the watchlist.

## Unreleased roadmap rebases

| Date       | Previous decision                                                       | Replacement                                                                                                                                                                 |
| ---------- | ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-07-13 | `v0.1.32` was a patch reserve after the consolidated `v0.1.31` release. | The unreleased reserve was replaced by F121 Coder Shared Daemon and Multi-Client Live State. Partner remains embedded inline; `v0.1.33-v0.1.34` remain regression reserves. |

## Released feature index

| Release          | Feature IDs                                        | Release/design record                                                                                                                      |
| ---------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `v0.1.0`         | F001-F010                                          | [CHANGELOG](../CHANGELOG.md#010---2026-05-30), [design](features/v0.1.0.md)                                                                |
| `v0.1.0-alpha.1` | F029                                               | [design](features/v0.1.0.md)                                                                                                               |
| `v0.1.1`         | F030-F037                                          | [CHANGELOG](../CHANGELOG.md#011---2026-06-01), [design](features/v0.1.1.md)                                                                |
| `v0.1.3`         | F019, F020, F022                                   | [design](features/v0.1.3.md)                                                                                                               |
| `v0.1.5`         | F016, F021, F039-F041                              | [design](features/v0.1.5.md)                                                                                                               |
| `v0.1.6`         | F038                                               | [design](features/v0.1.6.md)                                                                                                               |
| `v0.1.7`         | F011, F023, F024, F026                             | [design](features/v0.1.7.md)                                                                                                               |
| `v0.1.8`         | F043                                               | [design](features/v0.1.8.md)                                                                                                               |
| `v0.1.10`        | F044, F054                                         | [design](features/v0.1.10.md)                                                                                                              |
| `v0.1.11`        | F045-F047                                          | [design](features/v0.1.11.md)                                                                                                              |
| `v0.1.12`        | F056-F059                                          | [design](features/v0.1.12.md)                                                                                                              |
| `v0.1.15`        | F060-F066                                          | [design](features/v0.1.15.md)                                                                                                              |
| `v0.1.16`        | F068                                               | [design](features/v0.1.16.md)                                                                                                              |
| `v0.1.20`        | F081-F084, F104                                    | [design](features/v0.1.20.md)                                                                                                              |
| `v0.1.23`        | F106                                               | [design](features/v0.1.23.md)                                                                                                              |
| `v0.1.24`        | F105                                               | [design](features/v0.1.24.md)                                                                                                              |
| `v0.1.26`        | F107, F108                                         | [design](features/v0.1.26.md)                                                                                                              |
| `v0.1.29`        | F088, F103                                         | [F103 design](features/v0.1.29.md), [F088 addendum](features/v0.1.29-memory-governance.md), [CHANGELOG](../CHANGELOG.md#0129---2026-07-08) |
| `v0.1.30`        | F049, F070-F072, F074, F095, F098, F109, F113-F115 | [Partner design](features/v0.1.30.md), [External Agents](features/v0.1.30-external-agents.md)                                              |
| `v0.1.31`        | F116                                               | [Runtime Host design](features/v0.1.31.md), [implementation record](features/v0.1.31-implementation-plan.md)                               |

## Historical merge and carry-forward records

| Historical ID | Outcome                                                                                                                  |
| ------------- | ------------------------------------------------------------------------------------------------------------------------ |
| F014          | Merged into F042's native-helper proposal; F042 is now shelved pending profiling evidence.                               |
| F015          | Repointel status/warm delivered through F082; any missing warm contract is a capability-ledger gate.                     |
| F017          | CLI-to-Space receive path delivered through F084; CLI/REPL writer support is a separate upstream gate.                   |
| F018          | Quick Ask delivered through F083 with an explicitly temporary session implementation; true side-query remains SDK-gated. |
| F036          | Read-only MCP listing upgraded by completed F039.                                                                        |
| F048          | Superseded by the static Artifact baseline F056-F059.                                                                    |

## 2026-07-12 reviewed-out decisions

| Feature        | Decision                       | Reason / reopen gate                                                                                          |
| -------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| F042           | Shelved                        | Profile first; do not maintain NAPI packages without a material measured hot path.                            |
| F053           | Completed within shipped scope | KodaX F247 and Space's Partner profile/verification contract replaced the historical SDK R1/R2 placeholder.   |
| F067           | Cancelled                      | LiveCanvas is not required for current static and sandboxed HTML artifact paths.                              |
| F073           | Absorbed by F096               | Connector snapshots are part of the connector foundation.                                                     |
| F075           | Shelved                        | No repeated graph-navigation use case has been established.                                                   |
| F077/F078/F080 | Absorbed by F076               | They are localization acceptance slices, not independent product outcomes.                                    |
| F079           | Watchlist                      | Revisit after the current two-locale completion gate and demonstrated demand.                                 |
| F085           | Cancelled                      | KodaX removed cross-process Workflow crash replay.                                                            |
| F086           | Cancelled                      | KodaX removed the separate never-run draft lifecycle.                                                         |
| F092           | Cancelled                      | An Advisor primitive did not demonstrate enough product value.                                                |
| F093           | Superseded by F118             | A minimal Runtime-owned learned-Skill safety surface replaces a Skill-only Space-owned review queue.          |
| F099           | Decomposed                     | Monitoring partially shipped; local isolation and remote runners require separate outcomes and threat models. |
| F100           | Watchlist                      | Gate on KX-F139 or a prioritized user journey.                                                                |
| F102           | Shelved                        | Reopen after three real internal consumers.                                                                   |
| F111           | Research/ADR                   | Screen automation requires a concrete need after browser/connector delivery.                                  |
| F112           | Decomposed                     | Its three unrelated SDK/CLI gaps belong in the capability ledger.                                             |

## Watchlist and reopen gates

The following are not version commitments:

- The published KodaX Learning Center/Skill-loop contracts are consumed without a Space-owned store; the remaining minimal F118 desktop safety surface is tracked in the active feature list. KodaX F260 is published and tracked as the partial runtime integration plus planned F117 desktop host.
- KodaX F263/F264 learned Skill/Extension actions until `runtime.learning` advertises them.
- KodaX F265 assurance/route telemetry until public DTOs exist.
- A2A, MCP Tasks, and governed HTTP External Agent adapters until KodaX advertises conformant factories.
- `zh-Hant`, NotebookEdit, remote SSH/Docker runners, local workspace isolation, and desktop screen automation until their documented reopen gates pass.
- Governed GitHub write/PR actions until read-only connector snapshots and revocation behavior are proven.
