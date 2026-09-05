<p align="center">
  <img src="resources/icon.png" alt="KodaX Space" width="128">
</p>

<h1 align="center">KodaX Space</h1>

<p align="center">
  <b>Provider 中立、本地优先的 KodaX Coding Agent 桌面工作台。</b><br>
  基于 Electron + React，将项目会话、任务观测、代码评审、Workflow、MCP、Artifact、记忆治理与 KodaX SDK runtime 组织进统一桌面界面。
</p>

<p align="center">
  <a href="https://github.com/icetomoyo/KodaX-Space/releases/latest"><img alt="release" src="https://img.shields.io/github/v/release/icetomoyo/KodaX-Space?style=flat-square"></a>
  <a href="LICENSE"><img alt="license" src="https://img.shields.io/badge/license-KAI--FCL-orange?style=flat-square"></a>
  <a href="https://github.com/icetomoyo/KodaX-Space/actions/workflows/ci.yml"><img alt="CI" src="https://img.shields.io/github/actions/workflow/status/icetomoyo/KodaX-Space/ci.yml?style=flat-square&label=ci"></a>
  <img alt="KodaX SDK" src="https://img.shields.io/badge/KodaX_SDK-0.7.96--alpha.3-2ea44f?style=flat-square">
  <img alt="platforms" src="https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-34495e?style=flat-square">
</p>

<p align="center">
  <a href="#快速开始">快速开始</a> ·
  <a href="#为什么使用-kodax-space">为什么使用</a> ·
  <a href="#当前源码基线">当前源码基线</a> ·
  <a href="#开发">开发</a> ·
  <a href="#文档">文档</a> ·
  <a href="README.md">English README</a>
</p>

---

## 快速开始

### 下载安装包

预构建安装包发布在 [KodaX Space Releases](https://github.com/icetomoyo/KodaX-Space/releases/latest) 页面。

| 平台    | 安装包                                            |
| ------- | ------------------------------------------------- |
| Windows | NSIS `Setup.exe`、`Portable.exe`，以及 zip 备用包 |
| macOS   | universal `.dmg`                                  |
| Linux   | `AppImage` 和 `.deb`                              |

当前公开构建未做系统级公开签名。首次启动时，Windows SmartScreen 或 macOS Gatekeeper 可能需要手动确认。请只从可信的 KodaX-AI 分发渠道获取安装包。

### 从源码启动

```bash
git clone https://github.com/icetomoyo/KodaX-Space.git
cd KodaX-Space
npm install --include=dev
npm run dev
```

`npm run dev` 会同时启动 Vite renderer、Electron main 进程，以及桌面客户端所用的 KodaX runtime 集成。

---

## 为什么使用 KodaX Space

<table>
  <tr>
    <td width="33%" valign="top">
      <h3>本地优先的桌面壳</h3>
      Project、Session、偏好、MCP 配置、Skills、Artifact 与 KodaX 生态状态围绕用户本机组织，不强制进入云端工作流。
    </td>
    <td width="33%" valign="top">
      <h3>Provider 中立</h3>
      Space 消费 KodaX provider aliases 和自定义 OpenAI/Anthropic-compatible provider，不把桌面体验绑定到单一模型厂商。
    </td>
    <td width="33%" valign="top">
      <h3>任务导向 UI</h3>
      Environment Hub、Task Dock、Review Workspace、Artifact Workspace、Terminal 与 Floating Surface Policy 将状态、证据、评审和决策分层。
    </td>
  </tr>
  <tr>
    <td valign="top">
      <h3>KodaX SDK 一等桌面面</h3>
      Space 在 Electron main 进程中 in-process import KodaX SDK，和 KodaX CLI/REPL 共享 session、workflow、skill、MCP 与 runtime event 语义。
    </td>
    <td valign="top">
      <h3>受治理的自动化</h3>
      Permission mode、对话流内联提问卡、系统 Keychain、可信 IPC schema 与本地 license gate，让 agent 工作可见、可审、可控。
    </td>
    <td valign="top">
      <h3>丰富的项目上下文</h3>
      内置多 tab 终端、PDF/docx/xlsx 预览、图片输入、Workflow 面板、Memory Governance、Scoped Markdown Agents，帮助长会话保持可检查。
    </td>
  </tr>
</table>

## 当前源码基线

**当前源码为 Space 0.1.46-alpha.6，精确锁定已发布的 KodaX 0.7.96-beta.1，并要求 `sandboxRuntime:11`、`runtimeAutoModeGuardrail:5`、`sharedSessionSettings:2`、`providerCredentialBroker:2` 与 `effectiveConfig:1`；能力支持不通过语义版本号推断。** root/Desktop manifest、lockfile、物理安装、打包 ASAR 与整体解包的跨平台 native bundle 使用同一 Registry URL/SRI。Space 暴露 Plan、Edits、Auto[LLM]、Full Access 四档。0.7.96 beta 线保留 sandbox-first 语义，并携带 Windows native protocol/setup generation 10、显式 doctor/setup 的真实 target-start 证明、setup 持有的宽 profile ACL 收敛、支持最多 32 个精确网络 authority 的 64 端口范围、逐命令私有 Temp，以及由 `sandboxRuntime:11` 隔离的安全 daemon 替换。`kodax sandbox doctor` 必须在宿主终端直接运行，也可使用 Space Settings，不要让模型通过 Bash 工具嵌套运行。Space 直接消费精确 Registry 字节，不做依赖补丁。当前稳定发布版仍是 Space v0.1.45 / KodaX 0.7.95，该历史产物保持不变。

v0.1.45 锁定的 KodaX 0.7.95 保留 `actorSettlementConvergence:2`、`sessionEventJournal:1`、`conversationHistory:2` 与 `crashOutcomeModel:2`，并把退出结算提升到 v2、Windows sandbox 提升到 v5。同一 boot 的 `unconfirmed-owner` 票据由 SDK 后台自动重试进程排空、ACL 复原和 effect-fence 释放，只在精确 sandbox-user SID 探针证明账号空闲后清除；探针暂时失败时仅对 sandbox 工作 fail closed，不阻塞无关的非 sandbox 工作。崩溃遗留的零字节 authority lock 也会在字节/stat 未变化证明后自动回收，仍存活或已被继任者接管的 owner 不会被误删。Runtime Shell 仍是 sandbox-first；containment 无法准备时沿用普通权限策略，但普通权限执行仍取得同一 filesystem-effect fence，不重放命令、不重复 classifier，灾难性破坏操作继续硬拒绝。`worker.configuredA2A` 仍是 KodaX CLI Worker-hosted embedded Runtime 配置，不是 Space Settings 开关。

当前源码还会在 Runtime-ready 重验时保留已经绘制的 canonical 历史，包括首个重叠项是 assistant 或 tool 的分页；queue query 与恢复回复保持同一因果 turn，历史分页显示加载/重试状态，活动和终态只接受当前 Runtime 身份的证据。压缩期间上下文表盘保持不确定进度，直到新的事实读数到达。发布依赖闸门会读取代理环境并在超时后有界销毁连接，应用退出则取消尚未完成的启动恢复等待。显式 Skill 准入传递原始 `rawUserInput`；KodaX 0.7.95 已只把它持久化为用户 query，并把 prepared `User request:` 保留为模型执行 overlay。包含多个已注册 Skill 引用的请求会在展开、Hook 和 Run 准入前被事实性拒绝。已准入的 Run 在 daemon 重连后按精确 `runId` 恢复，幂等发送只产生一个会话气泡；等待 Run 恢复期间重连定时器保持调度，不会让宿主事件循环提前退出。

底部状态区把主 Agent 上下文压力与整个 Session 累计 Token 分开显示。“上下文窗口”使用最终自动压缩阈值和不含正文的六类构成；完成态物理请求按 request ID 去重，覆盖 root、child、retry、fallback、repair、workflow digest 和 compaction summary。F140 新增“每次询问 / 保留托盘和 Runtime / 彻底退出”偏好。Windows、macOS 或 Linux 真正退出时，Space 会先尝试安全停止 Coder daemon；若有 blocker，则提供默认的“保持开启”和显式“强行关闭”。强行关闭只终止当前 Space 的任务、保留其他客户端的 Runtime 工作，并保证退出不再回到阻塞弹窗。Space 自动拉起的孤儿 daemon 仍会在最后客户端断开且任务空闲后自回收。Terminal 与 Coder 命令工具共享同一个所选 Shell/profile PATH 契约，不接受任意可执行文件，也不把敏感变量投影给 PTY。

F122-F124 继续提供 Partner 项目来源库、不可变证据/引用和自动 grounded context 闭环。F121 仅因最终人工多客户端验收台账保持 `InProgress`；v0.1.45 对缺失 daemon capability（包括 durable managed Run、Actor settlement convergence v2、Session journal、conversationHistory v2、sandboxRuntime v5、crashOutcomeModel v2 和 runtimeExitSettlement v2）明确失败，并继续保护活动 Session 的输入准入、history/live 对齐和 journal epoch 隔离。详见 [v0.1.45 发布设计](docs/features/v0.1.45.md)和[能力台账](docs/KODAX_CAPABILITY_LEDGER.md)。

F135 继续把许可证允许再分发的 `frontend-slides` 与 `huashu-design` 作为经审查的 Space builtin 一起打包。F137 改排到 `v0.1.61`，由 Space 独立创作四个中文优先的替代 Skill；本次 v0.1.45 不包含文档 Skill。详见 [v0.1.61 设计](docs/features/v0.1.61.md)、[builtin skill 文档](docs/BUILTIN_SKILLS.md)和 [v0.1.45 发布记录](docs/releases/v0.1.45-release-readiness.md)。

F136 让 Windows 后台 owner 可见、可控；F140 允许选择“每次询问”“保留托盘运行”或“彻底退出”。完整退出通过可见准入检查后，Windows 会隐藏到托盘继续 SDK settlement；重新打开仍显示同一条已用时进度，普通成功退出保持安静，失败则恢复窗口并显示诊断。F145 把未读结果或待处理交互按唯一 Session 计数投影到 Windows 任务栏/托盘、macOS Dock 与受支持的 Linux launcher；查看 Session 或解决交互后清除。KodaX 的专用 `daemonOrphanExit:1` 能力只为 Space 自动拉起的 daemon 增加 30 秒空闲孤儿回收期。

已解决的发布阻断项：KodaX 0.7.76 保留 0.7.75 引入的集中式 Windows `windowsHide` 加固，普通 daemon-backed Coder query 不再闪出短暂子进程控制台。Space 只消费官方 Registry 包，没有内置 SDK 源码补丁。详见 [Issue 091](docs/KNOWN_ISSUES.md#091-ordinary-windows-queries-can-flash-several-short-lived-command-windows-from-kodax-runtime-child-processes)。

## 当前正式版本

**v0.1.45 - 内联提问卡与精确 KodaX 0.7.95 发布**

已于 2026-08-24 正式发布 [`v0.1.45`](https://github.com/icetomoyo/KodaX-Space/releases/tag/v0.1.45)：Space package `0.1.45` 精确锁定 npm `latest` KodaX `0.7.95`。本版本把 ask_user 与 guardrail 授权从全屏模态改为对话流内的聚焦提问卡，对齐 `conversationHistory:2`、`runtimeExitSettlement:2` 与 `sandboxRuntime:5`，并恢复 daemon 重连后已准入的 Runs、保证幂等发送只产生一个气泡。

| 范围       | 摘要                                                                                                                                     |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| 最新 SDK   | npm `latest` 在发布准备时核验为 `0.7.95`，manifest、lockfile、安装包和 SRI 均精确一致。                                                  |
| 内联提问卡 | `ask_user_question` 与 guardrail 提示渲染为对话流内的聚焦卡片；召回停靠条统计待答数量并闪定位队首卡，队首卡支持 1-9/Enter/Esc 键盘操作。 |
| Run 恢复   | daemon 重连后已准入的 Run 按精确 `runId` 恢复，幂等发送只产生一个气泡，历史重验保留已绘制的 canonical 前缀。                             |
| 文档与手册 | README、用户手册、PRD/HLD、Feature List、能力台账、Known Issues、release 记录、回归指南和 `kodax_manual` 统一到 v0.1.45。                |

详细内容见 [v0.1.45 设计](docs/features/v0.1.45.md)、[发布记录](docs/releases/v0.1.45-release-readiness.md)、[Issue 193 回归指南](docs/test-guides/ISSUE_193_v0.1.45_REGRESSION_GUIDE.md)、[Issue 196 回归指南](docs/test-guides/ISSUE_196_v0.1.45_REGRESSION_GUIDE.md)和 [Issue 197 回归指南](docs/test-guides/ISSUE_197_v0.1.45_REGRESSION_GUIDE.md)。

**v0.1.44 - 原生提醒与后台退出结算发布**

已于 2026-08-20 正式发布 [`v0.1.44`](https://github.com/icetomoyo/KodaX-Space/releases/tag/v0.1.44)：Space package `0.1.44` 精确锁定 npm `latest` KodaX `0.7.93`。本版本新增跨平台原生数字角标，让已准入的完整退出在后台继续，并对齐 Task Dock、Repointel、历史页头、外部任务恢复态与 Windows ACL 排障指引。

| 范围           | 摘要                                                                                                                      |
| -------------- | ------------------------------------------------------------------------------------------------------------------------- |
| 最新 SDK       | npm `latest` 在发布准备时核验为 `0.7.93`，manifest、lockfile、安装包和 SRI 均精确一致。                                   |
| 原生提醒       | 未读结果和待处理交互按唯一 Session 计数，同步到 Windows 任务栏/托盘、macOS Dock 与受支持的 Linux launcher。               |
| 后台退出与恢复 | Windows 后台继续已准入 settlement，普通成功退出不发系统通知；失败恢复窗口，previous-boot ACL 阻断提供可执行指引。         |
| 文档与手册     | README、用户手册、PRD/HLD、Feature List、能力台账、Known Issues、release 记录、回归指南和 `kodax_manual` 统一到 v0.1.44。 |

详细内容见 [v0.1.44 设计](docs/features/v0.1.44.md)、[发布记录](docs/releases/v0.1.44-release-readiness.md)、[F145 验收指南](docs/test-guides/FEATURE_145_v0.1.44_TEST_GUIDE.md)和 [Issue 189-192 回归指南](docs/test-guides/ISSUE_189_v0.1.44_REGRESSION_GUIDE.md)。

**v0.1.43 - Runtime 退出与 filesystem-effect 收敛发布**

已于 2026-08-19 发布 [`v0.1.43`](https://github.com/icetomoyo/KodaX-Space/releases/tag/v0.1.43)，package `0.1.43` 精确锁定 KodaX `0.7.92`，引入 SDK-owned crash-resumable 完整退出、sandbox Runtime v4、crash-outcome v2 与 SDK 有效 live-output segment。详见 [v0.1.43 设计](docs/features/v0.1.43.md)与[发布记录](docs/releases/v0.1.43-release-readiness.md)。

**v0.1.42 - 因果 Transcript 与最新 KodaX 对齐发布**

2026-08-16 源码快照 `0.1.42` 精确锁定 KodaX `0.7.89`。该快照保持 Session/Run/Turn 因果归属，收口 canonical/live、延迟 terminal、continued Run、重连与 Ctrl+R 的顺序一致性，并同步 Actor settlement v2。

详细内容见 [v0.1.42 设计](docs/features/v0.1.42.md) 与 [v0.1.42 发布记录](docs/releases/v0.1.42-release-readiness.md)。

**v0.1.40 - KodaX 0.7.86 Sandbox 与 Owner 收敛发布**

2026-08-14 正式发布 [`v0.1.40`](https://github.com/icetomoyo/KodaX-Space/releases/tag/v0.1.40)：package `0.1.40` 精确对齐 npm 正式发布的 KodaX `0.7.86`，SDK 与 Runtime 同时要求 `sandboxRuntime:3`。本版本覆盖 Issue 128 打包 Electron/ASAR Windows Shell 链路、sandbox-first 普通权限 fallback，以及 stale inline owner 的 SDK 原子恢复和可重试清理。

| 区域          | 内容                                                                                                                       |
| ------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Runtime 合约  | KodaX 0.7.86 精确 Registry bytes，并显式协商 `sandboxRuntime:3`、`actorSettlementConvergence:1`、`sessionEventJournal:1`。 |
| Windows Shell | 打包烟测执行真实 contained marker command，检查 helper 物理路径、daemon sandbox v3 和重启后的 Shell。                      |
| Owner 恢复    | abandoned inline owner 由 SDK 原子协议恢复；active、不可读和不可验证 owner 继续 fail closed，close 失败可重试。            |
| 文档          | README、中文手册、能力台账、release 设计/记录、回归指南、CHANGELOG 和 `kodax_manual` 同步。                                |

详细内容见 [v0.1.40 设计](docs/features/v0.1.40.md) 与
[v0.1.40 发布记录](docs/releases/v0.1.40-release-readiness.md)。

**v0.1.39 - KodaX 0.7.85 Runtime Convergence Maintenance Release**

2026-08-11 正式发布 [`v0.1.39`](https://github.com/icetomoyo/KodaX-Space/releases/tag/v0.1.39)：package `0.1.39` 精确对齐 npm 正式发布的
KodaX `0.7.85`。本版本同步 Actor settlement convergence、Session journal
epoch 隔离、unknown Run 的 after-turn 输入、精确 Stop、输入操作去重、history/live
保护和 idle-exit client preservation，并更新 README/手册与应用内 `kodax_manual`。
详细内容见 [v0.1.39 设计](docs/features/v0.1.39.md) 与
[v0.1.39 发布记录](docs/releases/v0.1.39-release-readiness.md)。

**v0.1.38 - KodaX 0.7.84 Maintenance Release**

2026-08-07 正式发布 [`v0.1.38`](https://github.com/icetomoyo/KodaX-Space/releases/tag/v0.1.38)：package `0.1.38` 精确对齐 npm 正式发布的
KodaX `0.7.84`。本版本同步已落地的 Session 重新激活修复、Agent progress
有界持久化与同 owner Stop 收敛、图标打包资源、README/手册和应用内
`kodax_manual`。详细内容见 [v0.1.38 设计](docs/features/v0.1.38.md) 与
[v0.1.38 发布记录](docs/releases/v0.1.38-release-readiness.md)。

**v0.1.37 - Recovery and Release Alignment**

[`v0.1.37`](https://github.com/icetomoyo/KodaX-Space/releases/tag/v0.1.37) 已于 2026-08-06 正式发布，package 版本为 `0.1.37`，精确对齐 npm 正式发布的 KodaX 0.7.83。Space 继续收紧多 Session 恢复、历史分页、跨 Session 事件隔离和安全退出恢复边界。详见 [CHANGELOG.md](CHANGELOG.md)、[v0.1.37 设计](docs/features/v0.1.37.md)和[v0.1.37 发布记录](docs/releases/v0.1.37-release-readiness.md)。

**v0.1.36 - Session and Runtime Reconciliation Hardening**

[`v0.1.36`](https://github.com/icetomoyo/KodaX-Space/releases/tag/v0.1.36) 已于 2026-08-05 正式发布，package 版本为 `0.1.36`，精确对齐 KodaX 0.7.82。详见 [v0.1.36 设计](docs/features/v0.1.36.md)和[v0.1.36 发布记录](docs/releases/v0.1.36-release-readiness.md)。

## 历史发布

**v0.1.35 - Durable Managed Runs and Session History Integrity**

[`v0.1.35`](https://github.com/icetomoyo/KodaX-Space/releases/tag/v0.1.35) 已于 2026-08-05 发布，package 版本为 `0.1.35`，精确对齐 KodaX 0.7.80。Space 通过 `managedRunDurability:1` 保护 canonical Run 边界，以 `runId`/`turnId` 保持实时与历史对应。

**v0.1.34 - Runtime Safety and Desktop Lifecycle Hardening**

[`v0.1.34`](https://github.com/icetomoyo/KodaX-Space/releases/tag/v0.1.34) 已于 2026-07-30 正式发布，package 版本为 `0.1.34`，精确对齐 npm 正式发布的 KodaX 0.7.78。必需的 `main`、四平台预检和 tag release workflow 已全部通过；完整证据与公开产物摘要记录在发布就绪文档中。

| 领域         | 摘要                                                                                                                          |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| Runtime 安全 | 显式能力协商新增 orphan exit、集成韧性、Auto v4、Skill learning-loop 与有界 sandbox observation，不使用仅 SemVer 的在线门禁。 |
| 集成健康     | MCP/A2A/Extension 保留 last-known-good，投影 watcher/revision/reload 诊断，并对 Space MCP manager 做事务切换。                |
| 桌面生命周期 | Windows/macOS/Linux 真正退出会停止 Runtime 或恢复 Space；仅 Space 自动拉起的 daemon 获得 30 秒空闲孤儿回收。                  |
| 正式包执行   | ASRT/sandbox helper 从物理 resources 解析；界面区分 sandbox 成功、普通权限 fallback 和未使用 sandbox。                        |
| 启动与历史   | main-owned overlay 消除重复 loading 闪烁，位置化 replay 保证 interrupt 回复仍位于下一条用户 query 之前。                      |
| 验证         | 本地与 GitHub 证据写入版本化 readiness 文档；Issue 133 与 F138 的未完成边界继续明确保留。                                     |

完整说明见 [CHANGELOG.md](CHANGELOG.md)、[v0.1.34 设计](docs/features/v0.1.34.md)和[v0.1.34 发布记录](docs/releases/v0.1.34-release-readiness.md)。

## 历史正式版本

**v0.1.32 - Shared Coder and Usable Partner Knowledge**

正式发布：2026-07-25，精确对齐 KodaX 0.7.76。该版本把 Coder 迁到共享 profile daemon，交付 F122-F124 Partner 知识/引用 grounding、受审 builtin、精确历史体验和 Windows 可控托盘 owner。详见 [v0.1.32 设计](docs/features/v0.1.32.md)与[发布记录](docs/releases/v0.1.32-release-readiness.md)。

**v0.1.31 - Runtime Contract Alignment and Semantic Control**

正式发布：2026-07-12，tag 为 `v0.1.31`。F116、F055、F069、F120 在精确 KodaX 0.7.68 基线上一并交付。详见 [v0.1.31 设计](docs/features/v0.1.31.md)和[F116 实施记录](docs/features/v0.1.31-implementation-plan.md)。

**v0.1.30 - External Agent Orchestration Gateway Foundation**

正式发布：2026-07-12，tag 为 `v0.1.30`。

本版本对齐 `@kodax-ai/kodax@0.7.67`，并把协议中立的 External Agent Executor Plane 接入 Space 现有实时会话和 Workflow Host。

| 领域               | 摘要                                                                                                                                   |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| 统一调度           | Worker 与显式 Workflow 共用一个 `agentExecutorPlane`、策略过滤目录、不透明 `agent_id` 路由和持久任务账本。                             |
| Main 进程治理      | 注册写入、策略、凭据代理、Artifact 边界和持久化均留在 main；renderer 只接收脱敏摘要。                                                  |
| Reference 产品界面 | Runtime 设置页管理和预检注册；Workflow 启动器选择实时默认子 Agent；Task Dock 展示生命周期、审计事件、输入、取消与对账操作。            |
| 双语验收           | 完整 Reference Agent 界面已适配英文和简体中文，并由 Electron E2E 覆盖。                                                                |
| 能力真实性         | Runtime 配置的 A2A 在 KodaX 0.7.77 Coder daemon 能力协商通过后可用；MCP Tasks 与受治理 HTTP 在各自适配器交付并通过合规验证前保持隐藏。 |
| KodaX 0.7.67       | 兼容测试覆盖 Runtime Worker hard-dispose，以及外部 Agent 注册、发现、启动和终态结果闭环。                                              |

完整版本说明见 [CHANGELOG.md](CHANGELOG.md)、[docs/features/v0.1.30.md](docs/features/v0.1.30.md) 与 [F115 External Agent 设计](docs/features/v0.1.30-external-agents.md)。

## 产品界面

| 界面               | 用途                                                                                                                                                                                                            |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Coder workspace    | 主 AI Coding Session 界面，底层由 KodaX SDK runtime 驱动；当前源码把有效上下文与累计会话 Token 分为两个状态入口。                                                                                               |
| Environment Hub    | 紧凑的项目、会话、环境路由器，承载 location、branch、changes、sources、mode context。                                                                                                                           |
| Task Dock          | 右侧常驻任务面，显示 run 状态、plan、agents、workflow、changes、sources、artifacts、context。                                                                                                                   |
| Review workspace   | 用于查看 diff 和文件评审。                                                                                                                                                                                      |
| Artifact workspace | 用于预览、检查、导出生成产物。                                                                                                                                                                                  |
| Terminal workspace | 作用域绑定到当前项目的真实 PTY 多 tab 终端。                                                                                                                                                                    |
| MCP 和 Skills      | KodaX MCP servers 与 skills 的桌面管理和展示入口，并随包提供经审查的 `frontend-slides` 与 `huashu-design` builtin。                                                                                             |
| Memory Governance  | 评审、批准、拒绝、检查 memory proposals 和 approved references。                                                                                                                                                |
| Partner surface    | 已启用 workspace-first 知识工作界面，提供 Sources、KB、Outputs、checkpoint 写入、Office/PDF 便利生成与本地 policy/audit。                                                                                       |
| External Agents    | KodaX 0.7.89 Runtime 配置的 Coder Agent 使用独占 Actor owner、durable managed Run 和统一 Actor/Turn 任务；Space Reference Agent 保留主窗口管理和 durable Task Dock 干预路径。MCP Tasks 与受治理 HTTP 继续门控。 |

## 配置模型

KodaX Space 会尽量复用 KodaX 生态状态；桌面 UI 特有状态则由 Space 自己管理。

| 状态                                     | 行为                                                                                                                      |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `~/.kodax/config.json`                   | CLI/SDK/Space 共享的 provider/model/effort/permission/custom provider/compaction 等核心配置；不再新写 MCP/A2A/Extension。 |
| `~/.kodax/integrations/mcp.json`         | 版本化的用户 MCP server 声明；Settings 可迁移只读回退的旧 `config.json#mcpServers`，且默认保留旧字段。                    |
| `~/.kodax/integrations/extensions.json`  | 版本化的可信 filesystem Extension 路径；Space 默认只发现，设置 `KODAX_SPACE_ENABLE_SDK_EXTENSIONS=1` 后才加载。           |
| `~/.kodax/integrations/a2a.json`         | 版本化、由 Runtime 持有的 A2A registration 配置。                                                                         |
| `<project>/.kodax/integrations/mcp.json` | Space 项目 MCP 兼容层；同名项目 server 覆盖全局声明。                                                                     |
| `~/.kodax/sessions/`                     | 与 KodaX CLI/REPL 共享 session 历史。                                                                                     |
| `~/.kodax/handoffs/`                     | 桌面 handoff inbox，用于 session continuity。                                                                             |
| `~/.kodax/skills/` 和项目 skills         | 由 KodaX skills runtime 发现。                                                                                            |
| API keys                                 | 优先进入系统 Keychain；仍支持环境变量。                                                                                   |
| `~/.kodax/space/`                        | Space 自有偏好、项目、UI 状态和桌面元数据。                                                                               |
| `<profile-root>/runtime/`                | Shared Runtime daemon 状态与 run/event journal；默认 profile 下实际为 `~/.kodax/runtime/`。                               |

## 架构

KodaX Space 是 npm workspace monorepo，包含 Electron main、沙箱化 React renderer，以及共享 IPC/UI 包。

```text
KodaX-Space/
├── apps/
│   └── desktop/
│       ├── electron/          # Electron main、preload、IPC handlers、KodaX host integration
│       └── renderer/          # React UI、shell、features、stores、visual surfaces
├── packages/
│   ├── space-ipc-schema/      # renderer <-> main IPC 的 zod schema
│   └── space-ui-kit/          # 共享 UI primitives
├── docs/                      # PRD、HLD、ADR、feature notes、manuals、ledgers
├── e2e/ and tests/            # Playwright 与集成覆盖
├── scripts/                   # dev、build、packaging、smoke helpers
└── resources/                 # app icon 与 license policy resources
```

关键技术选择：

| 层              | 选择                                                                                                                                                                |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Shell           | Electron 42                                                                                                                                                         |
| Renderer        | React 19、Vite、TypeScript、Zustand                                                                                                                                 |
| UI/runtime 分离 | Renderer 不直接执行 LLM/tool；特权工作留在 Electron main。                                                                                                          |
| KodaX 集成      | Electron main 使用公开 owner 契约；Coder 默认连接 profile daemon，也可使用 Settings 选择的 Embedded 回退；Partner 与明确的 host-provider 服务保持 embedded inline。 |
| IPC             | 来自 `@kodax-space/space-ipc-schema` 的 zod-validated contracts。                                                                                                   |
| Terminal        | xterm.js + node-pty。                                                                                                                                               |
| Preview         | Monaco、pdfjs、mammoth/docx、SheetJS/xlsx。                                                                                                                         |
| Tests           | Node test runner、Playwright、typecheck、packaging smoke checks。                                                                                                   |

## 开发

请使用 Node.js 22.12 或更高版本。仓库在 `.nvmrc` 中固定 Node 22.23.1，CI 读取同一文件。

```bash
# 安装依赖
npm install --include=dev

# 启动 Vite + Electron 开发模式
npm run dev

# 类型检查 Electron main、renderer 和 workspace packages
npm run typecheck

# 运行 workspace 单元测试
npm test

# 构建 renderer + main + workspace packages，不打安装包
npm run build:smoke

# 打包安装包
npm run build:win
npm run build:mac
npm run build:linux

# 校验打包结果
npm run smoke:pack
```

常用定向命令：

```bash
npm test -w @kodax-space/desktop
npm test -w @kodax-space/space-ipc-schema
npm run e2e
npm run e2e:headed
```

## 文档

| 文档                                                                                                             | 用途                                                                       |
| ---------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| [README.md](README.md)                                                                                           | 英文 README。                                                              |
| [CONTRIBUTING.md](CONTRIBUTING.md)                                                                               | 贡献边界、验证要求和文档同步规则。                                         |
| [docs/README.md](docs/README.md)                                                                                 | 文档中心，以及当前文档/历史文档索引。                                      |
| [docs/USER_MANUAL.zh-CN.md](docs/USER_MANUAL.zh-CN.md)                                                           | 面向 v0.1.45 发布基线的图解中文手册。                                      |
| [docs/USAGE.md](docs/USAGE.md)                                                                                   | 源码启动、profile、Runtime Host、测试、打包与排障。                        |
| [docs/BUILTIN_SKILLS.md](docs/BUILTIN_SKILLS.md)                                                                 | builtin skill 的来源、许可、更新、补丁和打包完整性流程。                   |
| [docs/releases/v0.1.34-release-readiness.md](docs/releases/v0.1.34-release-readiness.md)                         | v0.1.34 的发布门禁、产物摘要、已知风险与发布证据。                         |
| [docs/releases/v0.1.37-release-readiness.md](docs/releases/v0.1.37-release-readiness.md)                         | v0.1.37 的 KodaX 0.7.83 合约、门禁与发布证据。                             |
| [docs/features/v0.1.45.md](docs/features/v0.1.45.md)                                                             | v0.1.45 内联提问卡与 KodaX 0.7.95 边界。                                   |
| [docs/releases/v0.1.45-release-readiness.md](docs/releases/v0.1.45-release-readiness.md)                         | v0.1.45 门禁、精确 KodaX 0.7.95 合约与发布证据。                           |
| [docs/test-guides/ISSUE_193_v0.1.45_REGRESSION_GUIDE.md](docs/test-guides/ISSUE_193_v0.1.45_REGRESSION_GUIDE.md) | v0.1.45 对话因果顺序及 Sidecar/Interrupt 刷新恢复覆盖。                    |
| [docs/test-guides/ISSUE_196_v0.1.45_REGRESSION_GUIDE.md](docs/test-guides/ISSUE_196_v0.1.45_REGRESSION_GUIDE.md) | v0.1.45 Session 历史、queue、状态、加载与压缩反馈覆盖。                    |
| [docs/test-guides/ISSUE_197_v0.1.45_REGRESSION_GUIDE.md](docs/test-guides/ISSUE_197_v0.1.45_REGRESSION_GUIDE.md) | v0.1.45 构建代理与退出恢复覆盖。                                           |
| [docs/features/v0.1.44.md](docs/features/v0.1.44.md)                                                             | 历史 v0.1.44 原生提醒、后台退出结算与 KodaX 0.7.93 边界。                  |
| [docs/releases/v0.1.44-release-readiness.md](docs/releases/v0.1.44-release-readiness.md)                         | 历史 v0.1.44 门禁、精确 KodaX 0.7.93 合约与发布证据。                      |
| [docs/test-guides/FEATURE_145_v0.1.44_TEST_GUIDE.md](docs/test-guides/FEATURE_145_v0.1.44_TEST_GUIDE.md)         | 历史 v0.1.44 原生数字角标验收覆盖。                                        |
| [docs/test-guides/ISSUE_189_v0.1.44_REGRESSION_GUIDE.md](docs/test-guides/ISSUE_189_v0.1.44_REGRESSION_GUIDE.md) | 历史 v0.1.44 后台完整退出结算覆盖。                                        |
| [docs/test-guides/ISSUE_190_v0.1.44_REGRESSION_GUIDE.md](docs/test-guides/ISSUE_190_v0.1.44_REGRESSION_GUIDE.md) | 历史 v0.1.44 previous-boot Windows ACL 恢复覆盖。                          |
| [docs/test-guides/ISSUE_191_v0.1.44_REGRESSION_GUIDE.md](docs/test-guides/ISSUE_191_v0.1.44_REGRESSION_GUIDE.md) | 历史 v0.1.44 外部任务空态与重试态覆盖。                                    |
| [docs/test-guides/ISSUE_192_v0.1.44_REGRESSION_GUIDE.md](docs/test-guides/ISSUE_192_v0.1.44_REGRESSION_GUIDE.md) | 历史 v0.1.44 安静安全退出通知覆盖。                                        |
| [docs/features/v0.1.43.md](docs/features/v0.1.43.md)                                                             | v0.1.43 Runtime 退出、KodaX 0.7.92、sandbox v4 与发布边界。                |
| [docs/releases/v0.1.43-release-readiness.md](docs/releases/v0.1.43-release-readiness.md)                         | v0.1.43 门禁、精确 KodaX 0.7.92 合约与发布证据。                           |
| [docs/test-guides/ISSUE_188_v0.1.43_REGRESSION_GUIDE.md](docs/test-guides/ISSUE_188_v0.1.43_REGRESSION_GUIDE.md) | v0.1.43 完整退出结算与恢复覆盖。                                           |
| [docs/test-guides/ISSUE_256_v0.1.43_REGRESSION_GUIDE.md](docs/test-guides/ISSUE_256_v0.1.43_REGRESSION_GUIDE.md) | v0.1.43 sandbox v4 / crash-outcome v2 覆盖。                               |
| [docs/features/v0.1.42.md](docs/features/v0.1.42.md)                                                             | 历史 v0.1.42 causal transcript, latest KodaX 0.7.89, and release boundary. |
| [docs/releases/v0.1.42-release-readiness.md](docs/releases/v0.1.42-release-readiness.md)                         | 历史 v0.1.42 gates, exact KodaX 0.7.89 contract, and release evidence.     |
| [docs/test-guides/ISSUE_182_v0.1.42_REGRESSION_GUIDE.md](docs/test-guides/ISSUE_182_v0.1.42_REGRESSION_GUIDE.md) | v0.1.42 canonical/live ordering regression coverage.                       |
| [docs/test-guides/ISSUE_183_v0.1.42_REGRESSION_GUIDE.md](docs/test-guides/ISSUE_183_v0.1.42_REGRESSION_GUIDE.md) | v0.1.42 terminal owner reconciliation coverage.                            |
| [docs/test-guides/ISSUE_184_v0.1.42_REGRESSION_GUIDE.md](docs/test-guides/ISSUE_184_v0.1.42_REGRESSION_GUIDE.md) | v0.1.42 continued-Run projection coverage.                                 |
| [docs/test-guides/ISSUE_185_v0.1.42_REGRESSION_GUIDE.md](docs/test-guides/ISSUE_185_v0.1.42_REGRESSION_GUIDE.md) | v0.1.42 completion notification and Actor v2 coverage.                     |
| [docs/features/v0.1.40.md](docs/features/v0.1.40.md)                                                             | v0.1.40 维护范围与 KodaX 0.7.86 sandbox 边界。                             |
| [docs/releases/v0.1.40-release-readiness.md](docs/releases/v0.1.40-release-readiness.md)                         | v0.1.40 门禁、KodaX 0.7.86 合约与发布证据。                                |
| [docs/features/v0.1.39.md](docs/features/v0.1.39.md)                                                             | 历史 v0.1.39 维护范围与 KodaX 0.7.85 边界。                                |
| [docs/releases/v0.1.39-release-readiness.md](docs/releases/v0.1.39-release-readiness.md)                         | 历史 v0.1.39 门禁、KodaX 0.7.85 合约与发布证据。                           |
| [docs/features/v0.1.38.md](docs/features/v0.1.38.md)                                                             | 历史 v0.1.38 维护范围与 KodaX 0.7.84 边界。                                |
| [docs/releases/v0.1.38-release-readiness.md](docs/releases/v0.1.38-release-readiness.md)                         | 历史 v0.1.38 门禁、KodaX 0.7.84 合约与发布证据。                           |
| [docs/CODING_AGENT_BEGINNER_BEST_PRACTICES.zh-CN.md](docs/CODING_AGENT_BEGINNER_BEST_PRACTICES.zh-CN.md)         | Coding Agent 初学者最佳实践教程，覆盖软件研发和微服务场景。                |
| [docs/PRD.md](docs/PRD.md)                                                                                       | 产品需求和产品定位。                                                       |
| [docs/HLD.md](docs/HLD.md)                                                                                       | 高层架构与系统设计。                                                       |
| [docs/ADR/](docs/ADR/)                                                                                           | 架构决策记录。                                                             |
| [docs/FEATURE_LIST.md](docs/FEATURE_LIST.md)                                                                     | Feature ledger、roadmap 和 release planning 状态。                         |
| [docs/FEATURES_ARCHIVED.md](docs/FEATURES_ARCHIVED.md)                                                           | 已归档版本索引、reviewed-out 决策和 reopen gates。                         |
| [docs/KODAX_CAPABILITY_LEDGER.md](docs/KODAX_CAPABILITY_LEDGER.md)                                               | KodaX SDK 能力消费和降级说明。                                             |
| [CHANGELOG.md](CHANGELOG.md)                                                                                     | 版本历史。                                                                 |

## 路线图

近期计划以 [docs/FEATURE_LIST.md](docs/FEATURE_LIST.md) 为准。当前重点：

| 版本线                       | 重点                                                                                                                              |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `v0.1.32`                    | 已发布 Shared-daemon Coder、Partner 项目知识/引用、受审 builtin、精确历史体验、Windows 图标/托盘与发布加固。                      |
| `v0.1.33`                    | 修正后的 KodaX 0.7.77 正式版：Daemon/Embedded 安全选择、会话文件操作、附件/上下文修复与打包 Runtime 门禁。                        |
| `v0.1.34`                    | KodaX 0.7.78 Runtime 安全、集成韧性、可见彻底退出、sandbox helper 打包、启动 UX 和历史回放加固。                                  |
| `v0.1.35`                    | npm 正式 KodaX 0.7.80、durable managed Run 协商、会话历史完整性、Auto timeout 默认值与对应手册/测试。                             |
| `v0.1.35`                    | 基于已发布 Runtime 学习闭环的最小 learned Skill 安全控制面，不建设第二套存储或多 carrier Learning Center。                        |
| `v0.1.36`                    | KodaX 0.7.82、活动 Session 输入准入、history/live 对齐、跨 Session 恢复隔离与发布文档收口。                                       |
| `v0.1.37`                    | KodaX 0.7.83、多 Session 恢复、安全退出重启、语义启动背景和发布文档对齐。                                                         |
| `v0.1.44`                    | 精确 KodaX 0.7.93、F145 原生提醒、后台完整退出、Task Dock/Repointel/历史对齐与外部任务恢复态。                                    |
| `v0.1.45`                    | 精确 KodaX 0.7.95、内联 ask_user/guardrail 提问卡、conversationHistory v2、sandbox v5、已准入 Run 重连恢复与幂等发送单气泡。      |
| `v0.1.43`                    | 精确 KodaX 0.7.92、SDK-owned 完整退出、sandboxRuntime v4、crashOutcomeModel v2 与有效 live-output segment。                       |
| `v0.1.42`                    | 精确 KodaX 0.7.89、Actor settlement v2 与 Session/Run/Turn 因果 transcript 对齐。                                                 |
| `v0.1.40`                    | KodaX 0.7.86、sandboxRuntime v3、Issue 128 打包 Shell、stale owner 恢复、可重试 owner 清理与完整发布文档同步。                    |
| `v0.1.39`                    | KodaX 0.7.85、Actor settlement convergence、Session journal epoch 隔离、unknown Run 输入、精确 Stop、输入去重与完整发布文档同步。 |
| `v0.1.38`                    | KodaX 0.7.84、Agent progress/Stop 收敛、Session 重新激活恢复、图标打包与完整发布文档同步。                                        |
| `v0.1.61`                    | Space 独立实现的中文优先 DOCX/PDF/XLSX/PPTX builtin 与语义 UI 精修，并提供有界执行和真实验证回执。                                |
| `v0.1.64`、`v0.1.66-v0.1.68` | Partner Skill workspace、knowledge quality/curation、Presentation Project 与 SDK-gated Memory Agent host。                        |
| `v0.1.72`                    | 本地化完成、beta diagnostics、release channel、updater/distribution trust。                                                       |
| `v0.2.x`                     | Governed Browser 与 Partner packs、只读 Connector snapshots、本地 Automations、可刷新 Artifacts。                                 |

Remote runner、Notebook、Knowledge Graph、桌面 screen automation 和未发布 External Agent adapter 都是带 reopen gate 的 watchlist，不是已承诺版本 feature。

## License

[KodaX-AI Fair Core License (KAI-FCL)](LICENSE) - Copyright 2026 icetomoyo。

KAI-FCL 是 source-available / fair-core 协议，不是 OSI open source。商业、企业、托管部署或客户再分发用途，需要 KodaX-AI 授权，并在需要时具备有效 entitlement。

KodaX-AI 当前官方许可政策：KodaX Space 0.1.27 及之后版本，在由 KodaX-AI 带有该 notice 分发时，适用 KAI-FCL 或配套 KodaX-AI 客户条款。此前已带 Apache-2.0 notice 分发的历史 tag、source archive、installer 或其他副本，仍只对那些特定副本保留 Apache-2.0。
