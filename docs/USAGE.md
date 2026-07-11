# KodaX Space - Usage Guide (v0.1.31 development candidate)

> Last aligned: 2026-07-12. Repository packages target KodaX Space `0.1.31` with `@kodax-ai/kodax@0.7.67`; the latest public installer release remains `0.1.30` until the candidate is tagged. Older version sections below are retained as historical change notes, not as the current capability boundary.

KodaX Space 是 KodaX SDK 的桌面客户端。设计目标：**不要让用户在 Space 和 KodaX CLI 之间重复配置**。绝大多数 KodaX CLI 已经配好的东西，Space 启动后会自动认。

## 1. 启动

GitHub Release 已有打好的 unsigned installer（Win NSIS .exe / macOS .dmg / Linux AppImage + deb）：
<https://github.com/icetomoyo/KodaX-Space/releases/latest>

Windows release 同时提供直接下载的 `Setup.exe` / `Portable.exe`，以及对应的 `Setup.zip` / `Portable.zip` 备用包；如果浏览器对 unsigned `.exe` 下载拦截更激进，优先改下 zip 包。

首启 SmartScreen / Gatekeeper 警告需手动 Open 接受（Space 不走公开签名 Beta 路径）。

开发期从源码起：

```bash
git clone https://github.com/icetomoyo/KodaX-Space.git
cd KodaX-Space
npm install --include=dev   # 显式带 devDependencies，避免 npm config omit=dev 漏装
npm run dev
```

`npm run dev` 同时起 Vite renderer dev server 和 Electron main，HMR 默认开。窗口出来后即可 `/help` 看可用命令。

如要本地打包验证：

```bash
npm run typecheck   # 通过才往下
npm test --workspace @kodax-space/desktop
npm test -w @kodax-space/space-ipc-schema
npm run build:smoke
npm run build:win   # Windows；mac 走 build:mac
```

## 2. 配置复用矩阵 (Space ↔ KodaX CLI)

| KodaX 配置                                                    | Space 行为                         | 备注                                                                                                        |
| ------------------------------------------------------------- | ---------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `~/.kodax/config.json` → `mcpServers`                         | ✅ 自动加载 (SDK listMcpServers)   | global server 直接出现在 MCP popout                                                                         |
| `~/.kodax/config.json` → `provider`                           | ✅ 首次自动选                      | Space `defaultProviderId === null` 时 fallback；切过下拉用 Space 的                                         |
| `~/.kodax/config.json` → `reasoningMode` / `reasoningCeiling` | ✅ 新 session 初值                 | reasoningCeiling (v0.7.29+) 优先；session 内 `/reasoning` 切                                                |
| `~/.kodax/config.json` → `permissionMode`                     | ✅ 'plan' / 'accept-edits' 1:1     | KodaX 'default'/'bypass-permissions' Space 不复刻，走 Space 默认                                            |
| `~/.kodax/config.json` → `thinking`                           | ✅ session 创建时 fill             | 之后用 `/thinking` 切                                                                                       |
| `~/.kodax/config.json` → `customProviders[]`                  | ✅ runtime 已注册 + Providers 可见 | 启动期调 SDK `registerConfiguredCustomProviders`；Provider 面板、`/provider <name>`、session 创建都能识别。 |
| `~/.kodax/config.json` → `model`                              | ❌ 暂不读                          | 跨 provider 时 model 名通常对不上；session 创建后用 `/model` 切                                             |
| `${projectRoot}/.kodax/config.json` → `mcpServers`            | ✅ 自动加载 (Space parse)          | SDK 不读项目级 config                                                                                       |
| `~/.kodax/AGENTS.md` + `${projectRoot}/AGENTS.md`             | ✅ 自动加载 (SDK loadAgentsFiles)  | 递归扫 cwd→root + .kodax/                                                                                   |
| `~/.kodax/auto-rules.jsonc` + 项目级                          | ✅ 自动加载 (SDK loadAutoRules)    | auto 模式判定用                                                                                             |
| `~/.kodax/sessions/`                                          | ✅ 共享 (SDK /session)             | KodaX CLI 跑过的 session 在 Space tree 出现                                                                 |
| **API Keys**                                                  | ⚠️ Space 这边配                    | Space 用 OS keychain（不可用时 memory fallback）；启动前 `export ANTHROPIC_API_KEY=...` 走 env 也行         |
| `~/.kodax/commands/` (user commands)                          | ⚠️ 暂不复用                        | 等 SlashCommandDef ↔ KodaXCommand 适配 (deferred v0.1.7+)                                                   |

> 注：`~/.kodax/config.json` 改动的 hot-reload 行为待 SDK 文档确认。若改完发现 Space 没拿到新值，重启 Space 兜底。

### 2.1 AGENTS.md 全自动

打开 Space 后直接点顶栏 "AGENTS.md" 弹窗就能看到当前 session 在用哪些 AGENTS.md。规则：

- `~/.kodax/AGENTS.md` 标 **global** scope (橙)
- `${projectRoot}/AGENTS.md` 标 **project** 或 **directory** scope (绿/蓝；SDK 用 directory 表示"递归扫到 projectRoot 顶上的那个")
- 改了 AGENTS.md 不用重启 Space — 下次打开 popout 就刷新

### 2.2 MCP servers 全自动 (global/project)

如果你在 KodaX CLI 用过 `kodax mcp add filesystem npx -y @modelcontextprotocol/server-filesystem`，那台机器上的 `~/.kodax/config.json` 已经有 mcpServers 段。Space 启动时直接从 SDK 读，不重复解析。

打开 MCP popout 就能看到列表。`source` 字段标 `global` 或 `project`，方便区分来源。v0.1.5 起 F039 已接入 start/stop/diag/tool catalog；如果某个 server 无法启动，优先检查 `~/.kodax/config.json` 命令、PATH 和项目级配置。

### 2.3 API Keys

Space 用 OS keychain (`@napi-rs/keyring`) 存 key，跟 KodaX CLI 的 env 写法独立。Keychain 不可用时会退回 memory backend，重启后需重新配置。**第一次启动**需要在设置面板填一次。流程：

1. 打开 "Providers" 面板（齿轮图标）
2. 选 provider (Anthropic / OpenAI / Kimi / Qwen / DeepSeek / Zhipu / 火山 Ark / Gemini / etc.)
3. 粘贴 API key → 点 "Test connection"
4. 成功后 Space 会把 key 注入 `process.env[apiKeyEnv]` (例如 `ANTHROPIC_API_KEY`)，KodaX SDK 从这里读

**安全契约**: key 永远不出 main 进程 — 不进 IPC push、不进 list 响应、不进错误 envelope、不进日志。

如果你想完全跳过 keychain，可以在启动 Space 之前自己 export 环境变量：

```bash
export ANTHROPIC_API_KEY=sk-ant-...
export OPENAI_API_KEY=sk-...
npm run dev
```

Space 会优先用 env 已有值，不会覆盖。

### 2.4 Sessions 历史

SDK 0.7.42 的 `/session` 模块统一管理持久化。KodaX CLI 跑过的 session 在 Space 的"Sessions" tree 里直接出现，反过来也成立。Space F033 + F038 实现了：

- **List** — KodaX CLI session 在 Space tree 里
- **Fork** — 从历史 session 派生新 in-memory session
- **Rewind** — 回到历史中某条 assistant turn
- **Delete** — idempotent (REST DELETE 语义)

⚠️ 当前打开的 in-flight session 是 Space 的 in-memory 状态，不在 SDK 端落盘 — 是有意为之 (F033 split)，crash recovery 走 SDK 端的 partial-write checkpoint。

## 3. 第一次跑 — 5 分钟 walkthrough

1. `npm run dev`，等窗口起来
2. 在 chat 输入框点 "Select project root" → 选个项目目录 (要 absolute path；Space main 会 reject 非绝对路径，防 SSRF / 路径穿越)
3. 输入 `/provider`，看 KodaX CLI 已经配好的 provider 是否亮起（绿色 = 有 key；灰 = 缺 key）
4. 若灰：左下角 "设置" 或菜单 File → Settings → Providers → 填 key → Test
5. 回到 chat，发第一条 prompt
6. 想用工具时选择明确的权限模式：
   - `/mode plan` — 计划和只读分析
   - `/mode accept-edits` — 日常推荐；编辑更顺畅，其它风险操作仍受确认约束
   - `/mode auto` — 可信项目下按自动策略推进

## 4. 当前能力与历史更新

### 4.0 v0.1.31 / KodaX 0.7.67

- Runtime Settings 提供 Reference External Agent 注册、编辑、启停、删除、实时 preflight 和本地 conformance task。
- Workflow Launcher 可为普通子任务选择实时可调度的默认 External Agent，并在启动前校验 opaque `agentId` 与配置修订；Workflow 源码显式 target 优先。
- KodaX Worker 和 Workflow 共用一个 `agentExecutorPlane`、目录和持久 task ledger。
- Task Dock 显示 External task/cancel 独立状态、输出、审计事件、`input-required` 回复、取消与 `unknown` reconcile。
- External task 操作必须绑定当前 live session：main 从 session 派生项目/父任务归属并在读取或干预前复核；辅助 Artifact 窗口不具备管理权限。
- Task Dock 切换会话时立即清空旧任务并拒绝迟到响应；轮询不重入，并在终态或后台视图自动降频。
- Reference Executor 不访问网络、不直接写工作区。A2A、MCP Tasks 和受治理 HTTP 适配器尚未交付，因此 UI 保持隐藏。
- External Agent 产品 UI 完整覆盖 English / 简体中文。

### 4.0.1 v0.1.30 Partner workspace-first foundation

- Partner 已启用，提供 Sources、Conversation、Knowledge Base、workspace-first Outputs、checkpoint/diff/rollback、reviewed strict fallback 和本地 policy/audit。
- 支持 Unicode PDF 与基础 DOCX/XLSX/PPTX 便利写入，以及受限的一次性 JavaScript coding boost。
- Executable Partner Skills、通用 Connector/MCP 动作、浏览器/电脑控制、自动化、远程任务、并行专家和模板级 Office 设计不属于 0.1.30/0.1.31 当前能力。

### 4.0.2 Historical v0.1.22 patch release

v0.1.22 is a patch release for trusted internal provider workflows and queue correctness:

- Custom providers added through Settings can explicitly skip URL safety validation for trusted internal HTTP/IP gateways, while default custom providers still require HTTPS and block dangerous schemes.
- Custom providers loaded from KodaX config keep the trusted path, preserving existing direct-config internal provider behavior.
- Follow-up prompts sent while a session is running use Space's per-session queue and run only after that same session settles.
- SDK ask-user question/select/input prompts now surface through the Space modal path.
- At that release, package versions, lockfile metadata, docs, and the runtime capability contract were aligned to `0.1.22` / `space-v0.1.22`.
- The top View menu exposes Theme (`Light` / `Dark` / `System`) and Visual Quality (`Minimal` / `Balanced` / `Full`) shortcuts in the active display language.
- The Thinking spinner no longer shows the inherited blinking streaming caret on the next line.
- Artifact creation results stay visible as standalone transcript callouts instead of being hidden inside collapsed command runs; click the row to focus the Artifact panel or the corner icon to open a separate window.
- Streaming activity uses a CSS comet spinner, so token/tool rerenders do not drive animation frames through React timers.
- The Diff popout shows the target path while loading and fetches cached tool diffs and git file diffs concurrently for faster content display.
- The right sidebar width toggle expands to a workspace-aware review width, which makes focused Artifact and review flows readable without permanently taking over the layout.
- E2E test launches isolate Electron `userData` under `KODAX_TEST_ONBOARDING`, so the single-instance lock no longer blocks Settings interaction coverage.

### 4.0.1 v0.1.21 patch release

v0.1.21 是为补丁发布预留出的第一条 patch lane，不新增 planned feature；主要修复 release 后发现的高风险问题：

- Workflow 完成后 reload，transcript 会恢复 child summary 与 final report notice；Workflow manager 的历史详情也会直接显示恢复出的 final summary，且不会把 workflow notice 误显示成 user message。
- Workflow completion notice 保留可读 markdown final report，并补齐复制按钮与相对时间 footer。
- Settings e2e 改用稳定 test id / scoped selector，避免系统语言和同名按钮导致 CI 误红。
- Electron 打包显式包含 `@napi-rs/keyring` 与 native binding；macOS x64/arm64 release jobs 分别在匹配架构 runner 上打包，`smoke:pack` 会检查 keychain runtime 是否进入 `app.asar.unpacked`。
- Windows release 除直接 `.exe` 外，也提供 `Setup.zip` / `Portable.zip` 备用下载。
- Historical planning note: `v0.1.21` was the first patch-only release lane; `v0.1.22` is now consumed by the provider/queue patch, `v0.1.23` and `v0.1.26` remain patch reserves, and F103 still starts at `v0.1.27`.

### 4.1 Display Language MVP

现在可以在两处切换界面语言：

- Settings → Preferences → Language
- 顶部菜单 View → Language
- 顶部菜单 View → Theme / Visual Quality

可选值：

| 选项          | 行为                                               |
| ------------- | -------------------------------------------------- |
| Follow system | 系统首选语言是简体中文时走 `zh-CN`，否则走 `en-US` |
| 简体中文      | 强制中文界面                                       |
| English       | 强制英文界面                                       |

当前覆盖范围是高频 chrome：菜单栏、Settings、左侧栏、右侧栏标题、Provider 设置、常用弹窗/Toast。模型回复、工具输出、文件内容、路径、provider/model 名不会被翻译。

### 4.2 KodaX 0.7.53+ host events

Space 已消费 KodaX 0.7.53+ 的两个 host event：

- `onSidecarMessage` → `sidecar_message`：verifier revise/blocked 信息会作为系统提示进入会话。
- `onTodoDriftWarning` → `todo_drift_warning`：在没有进行中 todo 时启动工作，会出现 session-scoped 通知。

`kodax sessions dedupe` 仍是 CLI maintenance；桌面不会在本版加按钮。

### 4.3 Workflow surfaces

Workflow 现在不只是底部 live strip：

- 右侧 Workflow 面板可看 run 列表、生命周期、子步骤状态。
- Workflow graph / pattern graph 显示流程拓扑。
- Workflow summary 可进入 transcript。
- 已完成 workflow 的 detail/history 会从持久化记录恢复。
- 取消/失败路径有本地兜底，避免 UI 停在旧状态。

### 4.4 Repointel diagnostics

Repointel 状态不再只靠一个模糊 chip。现在有：

- `repointel.status` IPC
- `/repointel status`
- `/repointel trace`
- chip popover 里展示项目/git/trace/warm 支持状态

Standalone warm start/cancel/progress 仍等 SDK 暴露公共 API；Space 会明确显示 SDK-gated，而不是偷偷跑隐藏 warm 动作。

### 4.5 Quick Ask continuity

Quick Ask 仍是临时问答入口，但在 SDK 暴露真正 `sideQuery` 前，本版把过渡语义说清楚：

- 使用临时 plan-mode session。
- 窗口关闭时 best-effort 清理。
- 回答有用时可点 Continue in Coder，晋升为普通 Coder session。
- Partner promotion 和真正无 session side query 仍是后续项。

### 4.6 CLI / REPL handoff receiver

Space 会监听 `~/.kodax/handoffs/*.json`。当 CLI/REPL 以后写入 handoff descriptor 时，Space titlebar inbox 可接收并打开同一 KodaX session。

本版已具备 receiver / watcher / accept / dismiss / stale-invalid 状态；CLI writer 仍是 KodaX 侧后续接入。

## 5. v0.1.9+ 持续可用能力

### 5.1 图片粘贴（多模态输入）

输入框直接 Ctrl+V 粘贴 PNG/JPEG/WEBP 截图，也可以拖入 PNG/JPEG/WEBP 图片。缩略图 chip 显示在 textarea 上方,× 可删,8 张/turn × 6 MiB/张 上限。发送时 SDK `KodaXContextOptions.inputArtifacts` 自动拼成 multimodal content block 喂给 provider；Space 会把来源标为 `clipboard` 或 `drag-drop`。

落盘位置: `app.getPath('temp')/kodax-space/clipboard/<sessionId>/<ts>.png`,session 删除时 best-effort 清理。

### 5.2 Smart Popout Director

Session 首次出现下列信号时,右侧对应 popout **自动展开一次** (per session × per kind 只一次,不打扰):

| 信号                                                                  | 自动开       |
| --------------------------------------------------------------------- | ------------ |
| `todo_update`(items > 0)                                              | Plan popout  |
| `tool_start` 是 write/edit/multi_edit/str_replace/insert_after_anchor | Diff popout  |
| `managed_task_status.activeWorkerId`                                  | Tasks popout |

优先级 tasks > plan > diff (一帧多触发取一个)。用户已开别的 popout 不抢,手动开/关也算"已处理"不再 auto-open。Preferences 里可关 director 总开关。

### 5.3 项目拖排 + 可调侧栏 (Codex parity)

- 左侧栏项目 row HTML5 DnD 拖排,顺序持久化 lsKey;current project 仍 pin 顶
- "Archived (N)" 折叠状态持久化
- 左右侧栏 1px 视觉/4px 命中区 ResizeHandle 可拖,默认 260/320px,上下限 180-520,双击 reset / Esc 取消
- aside 默认基础字号 [13px] 对齐 Codex 视觉
- 项目 session 默认显示 8 条,超出 "+N more" 弹 ProjectSessionPicker overlay 全量搜索

### 5.4 内置终端（多 tab）

右上 Toolbar 第 3 个图标 → 弹出真 PTY shell（不是工具日志 viewer，是真 `cmd.exe` / `zsh` / `bash`）。

- 顶栏 + 按钮新增 tab，最多 10 个；× 关 tab；点 tab 切换
- 每个 tab 自己的 shell 进程，切走不丢状态（运行中的 `npm run dev` 持续滚日志）
- 关闭 popout 不杀 PTY；关掉最后一个 tab 自动开新；要彻底关走 popout 顶栏 ×
- 跨平台：Win11 cmd.exe / Mac zsh / Linux bash
- Env 已剥所有 `*_KEY` `*_TOKEN`，shell 里 `echo $ANTHROPIC_API_KEY` 拿不到

### 5.5 ⌘Shift+P 命令面板（Win/Linux: Ctrl+Shift+P）

VS Code 同款 muscle memory，全局快捷键召出模糊搜索框。4 个分组：

| 分组         | 干啥                                                 |
| ------------ | ---------------------------------------------------- |
| **Actions**  | New session / Toggle theme / Clear conversation view |
| **Sessions** | 当前项目最近 30 个 session（选中切过去）             |
| **Files**    | 项目下所有文件（选中在输入框插 `@path`）             |
| **Slash**    | 所有 slash 命令（选中插 `/cmd` 待执行）              |

输入框模糊匹配，↑↓ 跨组导航，Enter 触发，Esc 关。

**⌘K vs ⌘Shift+P 区分**：

- **⌘K** = F018 Quick Ask（临时问一句；默认不加入正常 session，关闭会清理，点 Continue in Coder 后晋升）
- **⌘Shift+P** = F026 Command Palette（导航 / 执行 / 插入）

### 5.6 文件富预览（PDF / docx / xlsx）

Preview popout（右上 Toolbar 第 1 个图标）输入文件路径自动按 ext 路由：

- `.pdf` → 单页 canvas 渲染 + 上下翻页（pdfjs-dist；50MB 上限）
- `.docx` → 简化 HTML（保留标题/段落/表格/链接，安全 sanitize；10MB 上限）
- `.xlsx` / `.xls` → 多 sheet tab + 单元格 table（50000 cell 上限；10MB 上限）
- 其它扩展名走原 Monaco 文本 viewer
- 超限文件给清晰错误提示，不会卡死 renderer

3 个 viewer 都是 **lazy 加载** — 不点开对应文件就不下载依赖；main bundle 不受影响。

## 6. Slash 命令清单（0.1.31 当前常用项）

| 命令                                | 作用                                                |
| ----------------------------------- | --------------------------------------------------- |
| `/mode <plan\|accept-edits\|auto>`  | 切权限模式                                          |
| `/auto-engine <local\|sdk\|hybrid>` | 控 auto 模式判定引擎                                |
| `/provider <id>`                    | 切当前 session 的 provider                          |
| `/model <id\|default>`              | 切模型；`default` 清掉 override 回 provider default |
| `/thinking <on\|off>`               | 切 extended thinking                                |
| `/reasoning <effort>`               | 控 reasoning depth (OpenAI 系列)                    |
| `/clear`                            | 清当前会话历史                                      |
| `/help`                             | 显示所有命令                                        |

除此之外 `/` 触发命令搜索 popover — F035 已经把 SDK skills 也合到这个 picker 里，可以同时搜内建命令 + skill。

## 7. 当前已知限制（0.1.31）

- **External Agent 协议**：当前只提供 KodaX 0.7.67 Reference Executor。A2A、MCP Tasks 和受治理 HTTP 等到对应上游适配器与 conformance capability 后才显示。
- **Partner 边界**：Partner 已启用，但 executable Skills、通用 Connector/MCP 动作、浏览器/电脑控制、自动化、远程任务和模板级 Office 设计尚未交付。
- **Quick Ask**：仍使用临时 plan-mode session，支持关闭清理与 Continue in Coder；不宣称完全无 session。
- **媒体输入**：PNG/JPEG/WEBP 与普通文件引用已支持；GIF/video 的结构化媒体语义仍有限。
- **工作位置**：以本地 workspace 为主；完整 worktree/cloud 位置切换仍是后续能力。
- **语言**：产品 UI 覆盖 English / 简体中文；模型回复、工具日志、文件内容、provider/model 名和第三方内容不会被强制翻译。
- **安装签名**：安装包未公开签名，SmartScreen / Gatekeeper 可能要求用户确认可信来源。
- **授权能力**：Repo-intelligence 等能力仍可能受 SDK、license、项目状态与本地 policy 控制。

## 8. 报问题

- Bug: GitHub Issues
- 安全相关: 不要走 issue；私下 contact
