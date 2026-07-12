# Architecture Decision Records — KodaX Space

> 主文档（[PRD](../PRD.md) / [HLD](../HLD.md)）只保留**最终结论**。这里记录**为什么选这个不选别的**——含被否决方案、关键证据、决策时点。当前实现与版本状态从[文档中心](../README.md)进入；ADR 不随每次 UI 更新重写。

| #                                                  | 决策                                                                                       | 状态     |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------ | -------- |
| [ADR-001](ADR-001-shell-electron.md)               | Shell 技术栈：Electron                                                                     | Accepted |
| [ADR-002](ADR-002-rust-integration-napi.md)        | Rust 集成策略：NAPI-RS 选择性热路径                                                        | Accepted |
| [ADR-003](ADR-003-kodax-integration-in-process.md) | KodaX 集成模式：in-process import                                                          | Accepted |
| [ADR-004](ADR-004-panel-model.md)                  | 面板模型：双面板 + Quick Ask                                                               | Accepted |
| [ADR-005](ADR-005-permission-mode-canonical.md)    | Permission Mode 对齐 KodaX REPL canonical 3 + Auto engine 子档                             | Accepted |
| [ADR-006](ADR-006-positioning-vs-opencode.md)      | 相对 opencode 的定位 + 5 gap cluster + OC-XX backlog（planning）                           | Accepted |
| [ADR-007](ADR-007-partner-surface-model.md)        | Partner Surface Model：同一 runtime 的画像组合（surface + skill + artifact），不等独立内核 | Accepted |
| [ADR-008](ADR-008-mascot-soft-rig-animation.md)    | Mascot 资产动画策略：像素基准 + soft rig                                                   | Accepted |

## 写 ADR 的约束

- 每个 ADR 一个 decision；不要把多个决策塞一份
- 必须列**被否决方案**及其原因——这是 ADR 与"设计文档"的关键差别
- 必须列**未来撤销/重审条件**——决策不应永久绑定
- 状态：`Proposed` / `Accepted` / `Superseded by ADR-NNN` / `Deprecated`
