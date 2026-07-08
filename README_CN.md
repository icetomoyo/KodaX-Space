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
  <img alt="KodaX SDK" src="https://img.shields.io/badge/KodaX_SDK-0.7.63-2ecc71?style=flat-square">
  <img alt="platforms" src="https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-34495e?style=flat-square">
</p>

<p align="center">
  <a href="#快速开始">快速开始</a> ·
  <a href="#为什么使用-kodax-space">为什么使用</a> ·
  <a href="#当前版本">当前版本</a> ·
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

## 当前版本

**v0.1.29 - Workspace Environment Hub + Task Dock**

发布日期：2026-07-08

本版本对齐 `@kodax-ai/kodax@0.7.63`，并交付 F103 Shell redesign：紧凑 Environment Hub、结构化右侧 Task Dock，以及用于 popout 和阻塞 modal 的共享 Floating Surface Host。

| 领域                   | 摘要                                                                                            |
| ---------------------- | ----------------------------------------------------------------------------------------------- |
| Environment Hub        | 将 Changes、Location、Branch、Commit/Push、Sources、Mode/Permission 路由到正确的深层界面。      |
| Task Dock              | 将 Run、Plan、Agents、Workflow、Changes、Sources、Artifacts、Context 组织成持续可见的任务侧栏。 |
| Floating Surface Host  | 统一 z-index、backdrop、Escape、focus trap/restore 与 topmost surface 行为。                    |
| Memory Governance      | 新增 Coder-only Memory popout 和基于 KodaX memory control plane 的 IPC/service surface。        |
| Scoped Markdown agents | 通过 KodaX 0.7.63 runtime path 启用 scoped project agents。                                     |
| License                | KodaX Space 0.1.27+ 的官方 KodaX-AI 分发使用 KAI-FCL 或配套客户条款。                           |

完整版本说明见 [CHANGELOG.md](CHANGELOG.md) 与 [docs/features/v0.1.29.md](docs/features/v0.1.29.md)。

## 产品界面

| 界面               | 用途                                                                                          |
| ------------------ | --------------------------------------------------------------------------------------------- |
| Coder workspace    | 主 AI Coding Session 界面，底层由 KodaX SDK runtime 驱动。                                    |
| Environment Hub    | 紧凑的项目、会话、环境路由器，承载 location、branch、changes、sources、mode context。         |
| Task Dock          | 右侧常驻任务面，显示 run 状态、plan、agents、workflow、changes、sources、artifacts、context。 |
| Review workspace   | 用于查看 diff 和文件评审。                                                                    |
| Artifact workspace | 用于预览、检查、导出生成产物。                                                                |
| Terminal workspace | 作用域绑定到当前项目的真实 PTY 多 tab 终端。                                                  |
| MCP 和 Skills      | KodaX MCP servers 与 skills 的桌面管理和展示入口。                                            |
| Memory Governance  | 评审、批准、拒绝、检查 memory proposals 和 approved references。                              |
| Partner surface    | 代码已在 flag 后发货，但用户可达的 Partner workflow 会等 deliverable chain 完成后再启用。     |

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

| 层              | 选择                                                              |
| --------------- | ----------------------------------------------------------------- |
| Shell           | Electron 42                                                       |
| Renderer        | React 19、Vite、TypeScript、Zustand                               |
| UI/runtime 分离 | Renderer 不直接执行 LLM/tool；特权工作留在 Electron main。        |
| KodaX 集成      | Electron main 中 in-process SDK import。                          |
| IPC             | 来自 `@kodax-space/space-ipc-schema` 的 zod-validated contracts。 |
| Terminal        | xterm.js + node-pty。                                             |
| Preview         | Monaco、pdfjs、mammoth/docx、SheetJS/xlsx。                       |
| Tests           | Node test runner、Playwright、typecheck、packaging smoke checks。 |

## 开发

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
| [docs/USER_MANUAL.zh-CN.md](docs/USER_MANUAL.zh-CN.md)                                                   | 面向 KodaX Space 0.1.29 的当前中文用户说明书。              |
| [docs/USAGE.md](docs/USAGE.md)                                                                           | 启动、配置复用、slash 命令和已知限制说明。                  |
| [docs/CODING_AGENT_BEGINNER_BEST_PRACTICES.zh-CN.md](docs/CODING_AGENT_BEGINNER_BEST_PRACTICES.zh-CN.md) | Coding Agent 初学者最佳实践教程，覆盖软件研发和微服务场景。 |
| [docs/PRD.md](docs/PRD.md)                                                                               | 产品需求和产品定位。                                        |
| [docs/HLD.md](docs/HLD.md)                                                                               | 高层架构与系统设计。                                        |
| [docs/ADR/](docs/ADR/)                                                                                   | 架构决策记录。                                              |
| [docs/FEATURE_LIST.md](docs/FEATURE_LIST.md)                                                             | Feature ledger、roadmap 和 release planning 状态。          |
| [docs/KODAX_CAPABILITY_LEDGER.md](docs/KODAX_CAPABILITY_LEDGER.md)                                       | KodaX SDK 能力消费和降级说明。                              |
| [CHANGELOG.md](CHANGELOG.md)                                                                             | 版本历史。                                                  |

## 路线图

近期计划以 [docs/FEATURE_LIST.md](docs/FEATURE_LIST.md) 为准。当前重点：

| 版本线   | 重点                                                                                                                            |
| -------- | ------------------------------------------------------------------------------------------------------------------------------- |
| v0.1.35  | Partner controlled workspace file writes：通过 reviewed proposals 和 explicit apply/export 落地。                               |
| v0.1.36+ | Workflow、todo、MCP/extension、provider、review 与 beta-hardening。                                                             |
| v0.2.x   | Partner workbench、connector catalog、local automations、policy/audit pack、remote/self-hosted runner、distribution expansion。 |

## License

[KodaX-AI Fair Core License (KAI-FCL)](LICENSE) - Copyright 2026 icetomoyo。

KAI-FCL 是 source-available / fair-core 协议，不是 OSI open source。商业、企业、托管部署或客户再分发用途，需要 KodaX-AI 授权，并在需要时具备有效 entitlement。

KodaX-AI 当前官方许可政策：KodaX Space 0.1.27 及之后版本，在由 KodaX-AI 带有该 notice 分发时，适用 KAI-FCL 或配套 KodaX-AI 客户条款。此前已带 Apache-2.0 notice 分发的历史 tag、source archive、installer 或其他副本，仍只对那些特定副本保留 Apache-2.0。
