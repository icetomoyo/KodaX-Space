# KodaX Space

> Provider-neutral, local-first AI agent desktop client — KodaX 生态桌面客户端

[![status](https://img.shields.io/badge/status-released-green)]() [![license](https://img.shields.io/badge/license-KAI--FCL-orange)]() [![version](https://img.shields.io/badge/version-0.1.28-blue)]()

KodaX Space 是 [KodaX](../KodaX) 生态的 Electron 桌面客户端。对标 Anthropic Claude Desktop 中的 Claude Code，Provider 中立、source-available / fair-core、本地优先（[ADR-004](docs/ADR/ADR-004-panel-model.md)）。

- **12+ LLM Provider 自由切换**（不锁 Anthropic / 不锁 OpenAI）
- **本机优先**（数据默认本地，不强制云）
- **复用 KodaX 内核**（in-process import，REPL 同源演进）
- **KodaX 0.7.53 能力对齐**（Capability ledger、sidecar verifier、todo drift warning、workflow surfaces）
- **中 / 英显示语言切换**（v0.1.20，Settings + 顶部菜单，覆盖高频 chrome）
- **CLI → Space handoff receiver**（v0.1.20，`~/.kodax/handoffs/*.json` 收件箱）
- **图片粘贴多模态输入**（v0.1.9，截图直接粘到 composer → SDK `KodaXContextOptions.inputArtifacts`）
- **Smart Popout Director**（v0.1.9，session 首次出现 plan/diff/tasks 信号自动展开右侧 popout）
- **统一 Settings + Codex parity 视觉**（v0.1.9，2-tab Settings modal / 可拖侧栏 / 项目拖排）
- **真 PTY 多 tab 终端**（v0.1.7，xterm.js + node-pty）
- **PDF / docx / xlsx 富预览**（v0.1.7，lazy-loaded 不影响 main bundle）
- **⌘Shift+P 命令面板**（v0.1.7，VS Code 同款）

## Documentation

- [USAGE.md](docs/USAGE.md) — 用户使用文档（启动 / 配置 / 主要功能 / 已知限制）
- [PRD.md](docs/PRD.md) — 产品需求
- [HLD.md](docs/HLD.md) — 高层设计
- [ADR/](docs/ADR/) — 关键架构决策（Electron / 集成模式 / Rust 策略 / 面板模型 / Partner surface）
- [KODAX_CAPABILITY_LEDGER.md](docs/KODAX_CAPABILITY_LEDGER.md) — KodaX SDK 能力消费状态与降级说明
- [FEATURE_LIST.md](docs/FEATURE_LIST.md) — features 跨版本账本 + Completed / Partial / Deferred 状态
- [CHANGELOG.md](CHANGELOG.md) — 版本更新记录

## Development

```bash
# 装依赖
npm install

# 开发模式（vite HMR + esbuild watch + electron）
npm run dev

# 单元测试 + 类型检查
npm test && npm run typecheck

# 仅构建 dist (不打包安装包)
npm run build:smoke

# 完整构建 + 打包平台安装包（unsigned — 自家工具不走公开 Beta）
npm run build:win        # Windows NSIS setup .exe + portable .exe (release also uploads zipped fallbacks)
npm run build:mac        # macOS universal .dmg
npm run build:linux      # Linux AppImage + .deb
npm run build            # 当前平台（CI matrix 用）
npm run smoke:pack       # 校验 installer size + asar 内容
```

## Project Layout

```
KodaX-Space/
├── apps/
│   └── desktop/
│       ├── electron/         ← main + preload (Node)
│       │   ├── terminal/     ← F011 ptyHost (node-pty wrapper)
│       │   └── ipc/          ← all IPC handlers
│       └── renderer/         ← React UI (browser, sandbox)
│           ├── shell/        ← Shell + popouts (Terminal / Preview / Diff / Tasks / Plan / MCP)
│           ├── features/     ← terminal (xterm) / preview (pdf/docx/xlsx) / session / quick-ask
│           └── lib/          ← fuzzy / shared utils
├── packages/
│   ├── space-ipc-schema/     ← zod schemas for IPC (single source of truth)
│   └── space-ui-kit/         ← shared design primitives
├── scripts/                  ← build / dev / clean
├── docs/                     ← PRD · HLD · ADR · features · USAGE · FEATURE_LIST · CHANGELOG
└── .github/workflows/        ← CI (build · release)
```

## Status

**v0.1.22 - Provider / Queue Patch** (2026-06-22 released)

This patch keeps the v0.1.20/v0.1.21 baseline intact while fixing trusted internal custom provider compatibility, Space-owned per-session follow-up queues, ask_user modal bridge coverage, View menu polish, artifact transcript callouts, CSS spinner stability, Diff loading polish, and release metadata alignment. See [CHANGELOG.md](CHANGELOG.md) and [docs/features/v0.1.22.md](docs/features/v0.1.22.md).

### v0.1.22 Patch Highlights

| Area                  | Summary                                                                                         |
| --------------------- | ----------------------------------------------------------------------------------------------- |
| **Provider trust**    | Trusted internal custom providers can explicitly bypass URL safety checks while default HTTPS and dangerous-scheme guards stay on. |
| **Config providers**  | KodaX config custom providers keep the trusted path so existing internal gateway entries continue to work. |
| **Follow-up queue**   | User follow-up prompts now live in a Space-owned per-session queue instead of the SDK main-thread queue. |
| **Resume pairing**    | Resumed sessions only reuse a configured model when it belongs to the selected provider.          |
| **Ask user bridge**   | SDK question/select/input prompts are wired through the Space IPC modal path.                    |
| **View menu polish**  | Theme and Visual Quality can be changed from the localized View menu alongside Language.             |
| **Conversation polish** | Artifact creation now surfaces as a standalone clickable callout; the Thinking spinner no longer leaves a caret or timer-janks during streaming. |
| **Layout polish** | The right sidebar expansion toggle opens a readable review panel while preserving room for the transcript. |
| **Release hygiene**   | Package versions, lockfile metadata, docs, `space.version`, Diff loading polish, and test-mode Electron userData isolation are aligned for `0.1.22`. |

**v0.1.20 — Capability catch-up + Display Language MVP ✅**（2026-06-22 released）

本版本在 v0.1.19 应急维护基线上收口 KodaX 0.7.53 消费、workflow 可视化/恢复、Space-side handoff receiver、Quick Ask 连续性、Repointel 诊断和中/英显示语言 MVP。详见 [CHANGELOG.md](CHANGELOG.md) 和 [docs/features/v0.1.20.md](docs/features/v0.1.20.md)。

### v0.1.20 主要新增

| Feature               | 描述                                                                               |
| --------------------- | ---------------------------------------------------------------------------------- |
| **F081**              | KodaX capability ledger + `space.version` SDK/capability diagnostics               |
| **F082**              | Repointel status / trace / doctor readout，warm 明确标为 SDK-gated                 |
| **F083**              | Quick Ask 临时 session 事件本地捕获 + Continue in Coder                            |
| **F084**              | CLI/REPL handoff receiver：读取、watch、accept、dismiss `~/.kodax/handoffs/*.json` |
| **F104**              | Display Language MVP：Settings 与顶部菜单切换 `system` / `zh-CN` / `en-US`         |
| **SDK 0.7.53**        | sidecar verifier message、todo drift warning 进入 typed session IPC                |
| **Workflow surfaces** | workflow 管理面板、flow/pattern graph、transcript summary、history detail recovery |
| **Release hardening** | provider guard、shell/handoff IPC tests、通知历史回放防护、菜单浮层可读性修复      |

### 历史 release

| Version | Theme                                                            | Date       |
| ------- | ---------------------------------------------------------------- | ---------- |
| v0.1.22 | Provider trust path + per-session follow-up queue                | 2026-06-22 |
| v0.1.21 | Patch lane: workflow recovery + release artifact resilience      | 2026-06-22 |
| v0.1.20 | Capability catch-up + Display Language MVP                       | 2026-06-22 |
| v0.1.19 | Session cancellation/history fix + popout recovery               | 2026-06-18 |
| v0.1.18 | KodaX CLI custom provider bridge                                 | 2026-06-17 |
| v0.1.17 | Keychain migration + desktop UI polish                           | 2026-06-17 |
| v0.1.16 | Workflow support chain + motion layer                            | 2026-06-17 |
| v0.1.9  | Multimodal input + smart popout + Codex parity（含 v0.1.8 合并） | 2026-06-08 |
| v0.1.7  | Terminal + Preview + Command palette（含 v0.1.6）                | 2026-06-06 |
| v0.1.5  | Sidebar overhaul + review closeout（含 v0.1.4）                  | 2026-06-05 |
| v0.1.3  | UX polish（主题 / 通知 / 自动更新）                              | 2026-Q3    |
| v0.1.2  | KodaX 生态打通                                                   | 2026-06-01 |
| v0.1.1  | TUI 对齐 batch                                                   | 2026-Q2 末 |
| v0.1.0  | Alpha foundation                                                 | 2026-Q2    |

详细历史 → [CHANGELOG.md](CHANGELOG.md) / [FEATURE_LIST.md](docs/FEATURE_LIST.md)

### 当前能做什么

装好安装包（或源码 `npm run dev`）后：

1. **配 LLM provider key**（左下角设置 → Providers；13 内建 + 自定义；OS keychain 或 memory fallback）
2. **选项目目录**（左侧栏 + New / Open；F005 allowlist 保护所有 path 类 IPC）
3. **创建 session 跟 AI 对话**（流式 token + tool call 卡片 + reasoning mode 切换）
4. **粘贴截图给 AI 看**（Ctrl+V 把 PNG/JPEG/WEBP 粘到 composer，SDK 自动拼 multimodal content）
5. **Plan/Diff/Tasks 自动开**（首次出现信号时自动展开右侧 popout，Preferences 里可关）
6. **切换显示语言**（Settings → Preferences → Language，或顶部菜单 View → Language）
7. **接收 CLI/REPL handoff**（titlebar handoff inbox 打开同一 KodaX session）
8. **真 PTY 终端**（右上 Toolbar 终端图标；多 tab；cross-platform）
9. **打开任意文件预览**（PDF/docx/xlsx 走 RichPreview；其它走 Monaco read-only）
10. **⌘K Quick Ask 临时问 / ⌘Shift+P 命令面板导航**
11. **Permission 弹窗确认每个写工具**（plan / accept-edits / auto 三档模式；多请求自动批 modal）
12. **fork / rewind session**（SDK 0.7.42 持久化，跨 REPL 共享）
13. **拖排项目 + 拖宽侧栏**（lastUsedAt 默认 / 用户拖动覆盖；左 260/右 320 默认可拖到 180-520px）

### 已知限制

- F015 Repointel standalone warm API：status / trace / doctor 已有；warm start/cancel/progress 仍等 SDK 公共 API
- F017 CLI teleport：Space receiver / inbox 已有；CLI/REPL writer 仍需 KodaX 侧接入
- F018 Quick Ask：已有临时 session + Continue in Coder；真正无 session `sideQuery` 和 Partner promotion 仍等 SDK/Partner 语义
- F104 Display Language MVP：只覆盖高频 chrome；全量 typed locale、pseudo-locale、CI scanner、zh-Hant 和 assistant response language 留给 F076-F080
- F014 NAPI tokenizer：并入 F042 待性能数据驱动
- F042 NAPI helpers / Partner surface (F045-F053)：在 roadmap
- 未签名 installer：Win SmartScreen / macOS Gatekeeper 首启警告需手动 Open

### 不签名说明

KodaX Space 定位为**自家与可信用户使用**，不走"陌生人公开 Beta"路径，installer 无 OS 级签名 / 公证。
首次启动 Win SmartScreen / macOS Gatekeeper 警告需手动 Open 接受。

## License

[KodaX-AI Fair Core License (KAI-FCL)](LICENSE) © 2026 icetomoyo.

Earlier KodaX Space releases that shipped under Apache-2.0 remain under Apache-2.0 for those released copies. KAI-FCL is source-available / fair-core, not OSI open source; commercial, enterprise, managed deployment, or customer redistribution use requires KodaX-AI authorization and a valid entitlement where required.
