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
  <img alt="KodaX SDK" src="https://img.shields.io/badge/KodaX_SDK-0.7.77-f0a020?style=flat-square">
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
      Permission mode、ask-user 弹窗、系统 Keychain、可信 IPC schema 与本地 license gate，让 agent 工作可见、可审、可控。
    </td>
    <td valign="top">
      <h3>丰富的项目上下文</h3>
      内置多 tab 终端、PDF/docx/xlsx 预览、图片输入、Workflow 面板、Memory Governance、Scoped Markdown Agents，帮助长会话保持可检查。
    </td>
  </tr>
</table>

## 当前源码基线

**v0.1.32 发布基线精确依赖 npm 正式发布的 KodaX 0.7.76。** Coder 默认连接 profile-scoped shared daemon；会话/运行/共享设置/交互、Workflow 观察与控制、Learning Center 操作、目录发现、MCP 工具发现与 reload，以及已配置 External Agent 的 Actor/Turn 均使用 Runtime 服务。Space 要求 `contextCompaction:3`、`transcriptPaging:1`、`transcriptSearch:1` 以获得耐久化精确历史恢复，同时要求 `interruptInput:1`、Auto LLM guardrail v3 和 `actorControlPlane:1`。KodaX 0.7.76 保留经过审计的 Windows 后台子进程隐藏和 Sidecar 终态修正，并将 Kimi Code 默认路由改为直连 `k3-256k`，K3 默认推理档调整为 `high`；Space 还在验证开始后本地关闭剩余的 managed-task interrupt 窗口，明确拒绝已错过安全投递点的输入，不再允许它先被接受、随后未投递终结。正式版把模型 mailbox 等待与 UI/SDK 进度遥测分离，保证子 Agent idle-yield 期间排队的真实用户提示进入 transcript，让 Goal 生命周期工具保持常驻，阻止 child live-only 状态覆盖 root 投影，并把精确 checkpoint/恢复指引字节保留在活动 compaction lineage 上。Partner 继续由 Space 在 Electron main 中 embedded-inline 承载。MCP 进程/日志、Workflow library/start/admin、Space Reference Agent 执行和产品 Artifact 仍是明确的 host-provider 边界。

> **v0.1.32 正式 tag 之后的未发布源码维护：**当前源码要求 npm 正式发布的精确 KodaX 0.7.77。底部状态区把主 Agent 上下文与整个 Session 累计 Token 分开显示；完成态物理请求诊断按 request ID 去重，覆盖 root、child、retry、fallback、repair、workflow digest 和 compaction summary。“上下文窗口”使用最终自动压缩阈值及不含正文的构成。Space 还接入稳定的提示词缓存路由诊断和 CLI 缓存用量归一化，为兼容的自定义 Provider 提供默认关闭的缓存亲和开关，接入 public `kimi/kimi-k3`，把已修正的 interrupt finalization 边界交还 Runtime，修复 daemon 模式下 Space builtin 的 slash 发现、文件 reveal 错误分类，并对齐 Node 22 工具链。上述维护仍属于 **Unreleased**。

F122-F124 已交付 Partner 项目来源库、不可变证据/引用和自动 grounded context 闭环。F121 在最终人工多客户端发布验收完成前保持 `InProgress`；缺少必要 daemon capability 时 Coder fail closed，不会静默退回 inline owner。详见 [v0.1.32 版本设计](docs/features/v0.1.32.md)和[能力台账](docs/KODAX_CAPABILITY_LEDGER.md)。

F135 还会把许可证允许再分发的 `frontend-slides` 与 `huashu-design` 作为经审查的 Space builtin 一起打包，用户无需另行安装；Space 分发的 Huashu 适配会移除默认推广水印/签名的标记和指令，同时保留上游 MIT 许可证与作者信息。浏览器、视频、TTS、AI 评审等可选流程仍需其文档列出的外部 runtime 或凭据。本机的 `pdf`、`pptx`、`xlsx`、`docx` skill 因现有许可证禁止再分发，不进入安装包。F137 已为 `v0.1.34` 规划四个由 Space 独立创作、中文优先的替代 Skill，使用 Space 自有的文档操作与验证链，不复制或翻译 proprietary 材料。详见 [v0.1.34 设计](docs/features/v0.1.34.md)、[builtin skill 文档](docs/BUILTIN_SKILLS.md)和 [v0.1.32 发布就绪清单](docs/releases/v0.1.32-release-readiness.md)。

F136 让 Windows 后台 owner 变得可见、可控。关闭最后一个窗口会销毁 renderer，但保留任务栏通知区域图标；用户可以重新打开 Space、查看有界的 Runtime/任务/其他客户端状态、只退出 Space 并保留 Runtime，或请求“彻底退出”。彻底退出会先断开 Space，再仅在没有 active/queued/pending 工作和其他客户端时请求 Runtime 安全停止。0.1.32 的托盘仍由轻量 Electron main 持有；拆成独立 helper 以便 main 也退出属于后续优化。

已解决的发布阻断项：KodaX 0.7.76 保留 0.7.75 引入的集中式 Windows `windowsHide` 加固，普通 daemon-backed Coder query 不再闪出短暂子进程控制台。Space 只消费官方 Registry 包，没有内置 SDK 源码补丁。详见 [Issue 091](docs/KNOWN_ISSUES.md#091-ordinary-windows-queries-can-flash-several-short-lived-command-windows-from-kodax-runtime-child-processes)。

## 当前正式版本

**v0.1.32 - Shared Coder and Usable Partner Knowledge**

正式发布：2026-07-25，tag 为 [`v0.1.32`](https://github.com/icetomoyo/KodaX-Space/releases/tag/v0.1.32)，精确对齐 npm 正式发布的 KodaX 0.7.76。

本版本把 Coder 迁移到 profile-scoped shared daemon，同时继续由 Space 明确持有 Partner 与产品特有边界。

| 领域               | 摘要                                                                                                                                                           |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Shared Coder       | Session、run、共享设置、交互、精确历史恢复、Workflow 控制、Learning/catalog/MCP 发现和已配置 Actor/Turn 收敛到一个 daemon 真理源。                             |
| Partner knowledge  | F122-F124 提供耐久项目来源、本地 FTS5 检索、不可变证据、稳定引用、精确使用轨迹和自动 Partner grounding；Partner 不迁移到 daemon。                              |
| Review 与可靠性    | Artifact/File Viewer 分离、真实 Changes 投影、安全 Web Preview、响应式 compact、Sidecar 终态修正和 finalization-safe interrupt 关闭本次发布竞态。              |
| Builtin 与 Windows | 受审且可再分发的 builtin 可复现打包；Windows Setup/Portable 使用 KodaX 图标、提供可控托盘 owner，并隐藏 SDK 非交互子进程。                                     |
| KodaX 0.7.76       | 精确 Registry 包提供直连 Kimi Code `k3-256k`、默认 K3 `high` 推理、mailbox-safe Agent 协调、compaction v3、transcript paging/search 与 Auto LLM guardrail v3。 |
| 验证               | 最终 main CI 与 Build 全绿且没有测试重试；四平台生产发布工作流发布了 18 个通过校验的 Windows、Linux、macOS x64/arm64 资产。                                    |

完整说明见 [CHANGELOG.md](CHANGELOG.md)、[v0.1.32 设计](docs/features/v0.1.32.md)和[v0.1.32 发布记录](docs/releases/v0.1.32-release-readiness.md)。发布记录继续如实保留未执行的人工 journey；Issue 043（未签名 macOS 提示）与 Issue 022（未来 Partner Runtime 迁移）仍是已披露边界。

## 历史正式版本

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
| 能力真实性         | Runtime 配置的 A2A 在 KodaX 0.7.76 Coder daemon 能力协商通过后可用；MCP Tasks 与受治理 HTTP 在各自适配器交付并通过合规验证前保持隐藏。 |
| KodaX 0.7.67       | 兼容测试覆盖 Runtime Worker hard-dispose，以及外部 Agent 注册、发现、启动和终态结果闭环。                                              |

完整版本说明见 [CHANGELOG.md](CHANGELOG.md)、[docs/features/v0.1.30.md](docs/features/v0.1.30.md) 与 [F115 External Agent 设计](docs/features/v0.1.30-external-agents.md)。

## 产品界面

| 界面               | 用途                                                                                                                                                                    |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Coder workspace    | 主 AI Coding Session 界面，底层由 KodaX SDK runtime 驱动；当前源码把有效上下文与累计会话 Token 分为两个状态入口。                                                       |
| Environment Hub    | 紧凑的项目、会话、环境路由器，承载 location、branch、changes、sources、mode context。                                                                                   |
| Task Dock          | 右侧常驻任务面，显示 run 状态、plan、agents、workflow、changes、sources、artifacts、context。                                                                           |
| Review workspace   | 用于查看 diff 和文件评审。                                                                                                                                              |
| Artifact workspace | 用于预览、检查、导出生成产物。                                                                                                                                          |
| Terminal workspace | 作用域绑定到当前项目的真实 PTY 多 tab 终端。                                                                                                                            |
| MCP 和 Skills      | KodaX MCP servers 与 skills 的桌面管理和展示入口，并随包提供经审查的 `frontend-slides` 与 `huashu-design` builtin。                                                     |
| Memory Governance  | 评审、批准、拒绝、检查 memory proposals 和 approved references。                                                                                                        |
| Partner surface    | 已启用 workspace-first 知识工作界面，提供 Sources、KB、Outputs、checkpoint 写入、Office/PDF 便利生成与本地 policy/audit。                                               |
| External Agents    | KodaX 0.7.76 Runtime 配置的 Coder Agent 使用统一 Actor/Turn 任务；Space Reference Agent 保留主窗口管理和 durable Task Dock 干预路径。MCP Tasks 与受治理 HTTP 继续门控。 |

## 配置模型

KodaX Space 会尽量复用 KodaX 生态状态；桌面 UI 特有状态则由 Space 自己管理。

| 状态                             | 行为                                                                                                        |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `~/.kodax/config.json`           | 用于 provider defaults、MCP servers、permission defaults、custom providers，以及 KodaX runtime 支持的配置。 |
| `~/.kodax/sessions/`             | 与 KodaX CLI/REPL 共享 session 历史。                                                                       |
| `~/.kodax/handoffs/`             | 桌面 handoff inbox，用于 session continuity。                                                               |
| `~/.kodax/skills/` 和项目 skills | 由 KodaX skills runtime 发现。                                                                              |
| API keys                         | 优先进入系统 Keychain；仍支持环境变量。                                                                     |
| `~/.kodax/space/`                | Space 自有偏好、项目、UI 状态和桌面元数据。                                                                 |
| `<profile-root>/runtime/`        | Shared Runtime daemon 状态与 run/event journal；默认 profile 下实际为 `~/.kodax/runtime/`。                 |

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

| 层              | 选择                                                                                                                        |
| --------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Shell           | Electron 42                                                                                                                 |
| Renderer        | React 19、Vite、TypeScript、Zustand                                                                                         |
| UI/runtime 分离 | Renderer 不直接执行 LLM/tool；特权工作留在 Electron main。                                                                  |
| KodaX 集成      | Electron main 使用公开 Runtime facade；Coder 连接 profile daemon，Partner 与明确的 host-provider 服务保持 embedded inline。 |
| IPC             | 来自 `@kodax-space/space-ipc-schema` 的 zod-validated contracts。                                                           |
| Terminal        | xterm.js + node-pty。                                                                                                       |
| Preview         | Monaco、pdfjs、mammoth/docx、SheetJS/xlsx。                                                                                 |
| Tests           | Node test runner、Playwright、typecheck、packaging smoke checks。                                                           |

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

| 文档                                                                                                     | 用途                                                        |
| -------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| [README.md](README.md)                                                                                   | 英文 README。                                               |
| [CONTRIBUTING.md](CONTRIBUTING.md)                                                                       | 贡献边界、验证要求和文档同步规则。                          |
| [docs/README.md](docs/README.md)                                                                         | 文档中心，以及当前文档/历史文档索引。                       |
| [docs/USER_MANUAL.zh-CN.md](docs/USER_MANUAL.zh-CN.md)                                                   | 面向 v0.1.32 发布基线并标注当前源码维护差异的图解中文手册。 |
| [docs/USAGE.md](docs/USAGE.md)                                                                           | 源码启动、profile、Runtime Host、测试、打包与排障。         |
| [docs/BUILTIN_SKILLS.md](docs/BUILTIN_SKILLS.md)                                                         | builtin skill 的来源、许可、更新、补丁和打包完整性流程。    |
| [docs/releases/v0.1.32-release-readiness.md](docs/releases/v0.1.32-release-readiness.md)                 | v0.1.32 的发布门禁、产物要求、人工验收与发布步骤。          |
| [docs/CODING_AGENT_BEGINNER_BEST_PRACTICES.zh-CN.md](docs/CODING_AGENT_BEGINNER_BEST_PRACTICES.zh-CN.md) | Coding Agent 初学者最佳实践教程，覆盖软件研发和微服务场景。 |
| [docs/PRD.md](docs/PRD.md)                                                                               | 产品需求和产品定位。                                        |
| [docs/HLD.md](docs/HLD.md)                                                                               | 高层架构与系统设计。                                        |
| [docs/ADR/](docs/ADR/)                                                                                   | 架构决策记录。                                              |
| [docs/FEATURE_LIST.md](docs/FEATURE_LIST.md)                                                             | Feature ledger、roadmap 和 release planning 状态。          |
| [docs/FEATURES_ARCHIVED.md](docs/FEATURES_ARCHIVED.md)                                                   | 已归档版本索引、reviewed-out 决策和 reopen gates。          |
| [docs/KODAX_CAPABILITY_LEDGER.md](docs/KODAX_CAPABILITY_LEDGER.md)                                       | KodaX SDK 能力消费和降级说明。                              |
| [CHANGELOG.md](CHANGELOG.md)                                                                             | 版本历史。                                                  |

## 路线图

近期计划以 [docs/FEATURE_LIST.md](docs/FEATURE_LIST.md) 为准。当前重点：

| 版本线            | 重点                                                                                                         |
| ----------------- | ------------------------------------------------------------------------------------------------------------ |
| `v0.1.32`         | 已发布 Shared-daemon Coder、Partner 项目知识/引用、受审 builtin、精确历史体验、Windows 图标/托盘与发布加固。 |
| `v0.1.33`         | 扩大后的 v0.1.32 source/parser/citation/retrieval/runtime/control 稳定化预留。                           |
| `v0.1.34`         | 独立创作、中文优先的 DOCX/PDF/XLSX/PPTX builtin 与语义 UI polish：有界执行和如实验证 receipt。          |
| `v0.1.35-v0.1.40` | Workflow/Review 证据面、Task/Capability 治理，以及 SDK-gated Memory Agent/Learning Center host。             |
| `v0.1.43`         | 本地化完成、beta diagnostics、release channel、updater/distribution trust。                                  |
| `v0.2.x`          | Governed Browser 与 Partner packs、只读 Connector snapshots、本地 Automations、可刷新 Artifacts。            |

Remote runner、Notebook、Knowledge Graph、桌面 screen automation 和未发布 External Agent adapter 都是带 reopen gate 的 watchlist，不是已承诺版本 feature。

## License

[KodaX-AI Fair Core License (KAI-FCL)](LICENSE) - Copyright 2026 icetomoyo。

KAI-FCL 是 source-available / fair-core 协议，不是 OSI open source。商业、企业、托管部署或客户再分发用途，需要 KodaX-AI 授权，并在需要时具备有效 entitlement。

KodaX-AI 当前官方许可政策：KodaX Space 0.1.27 及之后版本，在由 KodaX-AI 带有该 notice 分发时，适用 KAI-FCL 或配套 KodaX-AI 客户条款。此前已带 Apache-2.0 notice 分发的历史 tag、source archive、installer 或其他副本，仍只对那些特定副本保留 Apache-2.0。
