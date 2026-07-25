# KodaX Space 文档中心

> 当前源码/发布基线：KodaX Space [`v0.1.32`](https://github.com/icetomoyo/KodaX-Space/releases/tag/v0.1.32)（package `0.1.32`）/ npm 正式发布的 KodaX `0.7.76`；稳定 tag 与 18 个跨平台资产已于 2026-07-25 发布。

这里是文档的统一入口。当前源码已采用 npm 正式发布的 KodaX 0.7.76：Coder 默认连接共享 daemon，并强制 compaction v3、transcript paging/search、interrupt input、Actor/Turn v1 和 Auto LLM guardrail v3。0.7.76 保留 Sidecar 可选后续工作/预算终态修正和 Windows GUI host 非交互子进程隐藏，并将 Kimi Code 默认模型改为直连 `k3-256k`、K3 默认推理档改为 `high`；Space 在 managed-task `verifying` 阶段本地关闭 interrupt 准入，避免已错过 root drain boundary 的输入先被接受再未投递终结。正式版还提供 mailbox-driven Agent 协调、idle-yield 用户提示的 transcript 回填、Goal 工具常驻、root/child 投影隔离、精确 checkpoint 活动 lineage、确定性的 Auto 切换，以及 Windows 可见托盘/重开/安全彻底退出；Partner 继续由 Space inline owner 管理。完整 F117/F118 桌面管理体验仍在后续路线中。历史设计和 release 记录保留当时语境。

## 我想要……

| 目标                                | 从这里开始                                                                                                                                            |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| 安装、配置、第一次完成任务          | [用户使用手册](USER_MANUAL.zh-CN.md)                                                                                                                  |
| 快速理解界面和功能                  | [用户使用手册：界面地图](USER_MANUAL.zh-CN.md#5-界面地图)                                                                                             |
| 理解 v0.1.32 的 Runtime 所有权      | [用户使用手册：Runtime Host](USER_MANUAL.zh-CN.md#v0132-的-runtime-host-对用户有什么影响)                                                             |
| 理解 Windows 关闭与后台退出语义     | [用户使用手册：后台托盘](USER_MANUAL.zh-CN.md#windows-关闭窗口后台托盘与彻底退出)                                                                     |
| 从源码运行、测试、打包              | [运行与开发指南](USAGE.md)                                                                                                                            |
| 了解产品目标和边界                  | [PRD](PRD.md)                                                                                                                                         |
| 理解进程、IPC、Runtime 和数据所有权 | [HLD](HLD.md)                                                                                                                                         |
| 查看 KodaX 能力是否已接入           | [KodaX 能力台账](KODAX_CAPABILITY_LEDGER.md)                                                                                                          |
| 查看当前和未来 Feature              | [Feature List](FEATURE_LIST.md)                                                                                                                       |
| 查看 v0.1.31 的设计与实施           | [版本设计](features/v0.1.31.md) / [实施计划](features/v0.1.31-implementation-plan.md) / [人工测试指导](test-guides/FEATURE_116_v0.1.31_TEST_GUIDE.md) |
| 查看 v0.1.32 的设计与发布证据       | [版本设计与实施状态](features/v0.1.32.md) / [发布记录](releases/v0.1.32-release-readiness.md) / [Feature List](FEATURE_LIST.md)                       |
| 维护或更新 Space builtin skills     | [Builtin skill 维护说明](BUILTIN_SKILLS.md)                                                                                                           |
| 报告或核对已知问题                  | [Known Issues](KNOWN_ISSUES.md) / [已归档问题](ISSUES_ARCHIVED.md)                                                                                    |
| 参与贡献                            | [Contributing](../CONTRIBUTING.md)                                                                                                                    |

## 当前有效文档

| 文档                                                 | 性质             | 更新规则                                       |
| ---------------------------------------------------- | ---------------- | ---------------------------------------------- |
| `README.md` / `README_CN.md`                         | 项目入口         | 只概括公开版本和下一开发基线                   |
| `USER_MANUAL.zh-CN.md`                               | 面向用户         | 必须与当前 UI、快捷键和实际能力一致            |
| `USAGE.md`                                           | 面向开发/运维    | 必须与 package scripts、数据路径和验证流程一致 |
| `PRD.md`                                             | 产品目标与路线   | 保留长期方向，明确已交付/开发中/观察项         |
| `HLD.md`                                             | 当前高层架构     | 反映真实 owner、边界和降级策略                 |
| `KODAX_CAPABILITY_LEDGER.md`                         | 能力接入事实     | 每次 SDK/Runtime 接入后更新状态与证据          |
| `FEATURE_LIST.md`                                    | 版本路线图       | 只有可交付、可验证的版本项进入 active list     |
| `KNOWN_ISSUES.md`                                    | 当前问题         | 已解决项保留结论，新增问题需有复现和状态       |
| `BUILTIN_SKILLS.md`                                  | builtin 分发维护 | 固定来源、许可、补丁、更新和打包完整性         |
| `releases/v0.1.32-release-readiness.md`              | 发布记录         | 记录门禁、生产工作流、产物哈希和未执行人工项   |
| `apps/desktop/electron/kodax/space-manual-topics.ts` | 应用内 AI 自说明 | 与用户手册同步更新，防止 AI 给出旧操作说明     |

## 历史文档

以下文档是历史证据，不按当前 UI 重写：

- `CHANGELOG.md`：已发布版本的变更记录；
- `features/v*.md`：对应版本当时的目标、决策和验收；
- `ADR/`：架构决策及其 superseded/rejected 状态；
- `FEATURES_ARCHIVED.md`：已经交付、取消或进入 watchlist 的 Feature；
- `ISSUES_ARCHIVED.md`：超过 30 天且已解决问题的完整调查证据；
- `docs/known-issues/`：具体问题的调查与修复记录。

阅读历史文档时，请以文档日期和版本为准，不要用它判断当前 UI。当前事实优先看用户手册、HLD、能力台账和 Feature List。

## 文档与实现的关系

```mermaid
flowchart LR
    Code["当前代码与测试"] --> Ledger["能力台账"]
    Code --> HLD["HLD"]
    Product["PRD / Feature List"] --> Design["版本设计与实施计划"]
    Design --> Code
    Code --> Manual["用户手册"]
    Manual --> InApp["应用内 kodax_manual"]
    Release["正式发布"] --> Change["CHANGELOG / README 正式版"]
```

文档不能仅依据计划声称“已支持”。只有代码路径、自动化测试和必要人工验收都满足后，能力台账才能标为 `supported`；只有发布完成后，README/CHANGELOG 才能把它写成公开正式版。

## 更新检查清单

涉及用户可见能力、Runtime/SDK 边界或版本状态的改动，至少检查：

1. 用户手册是否说明入口、效果、限制和风险；
2. `space-manual-topics.ts` 是否给 AI 相同答案；
3. PRD/HLD/能力台账的 owner 和状态是否一致；
4. Feature List、版本设计、测试指导是否能互相链接；
5. README 是否仍准确区分开发版与正式版；
6. Mermaid、相对链接、标题锚点和代码命令是否可用；
7. 发布后是否同步 CHANGELOG、版本号和 release links。
