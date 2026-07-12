# KodaX Space 用户说明书

适用版本：KodaX Space 0.1.30 发布候选版（KodaX 0.7.67；最终 tag/Release 等待验收）

更新日期：2026-07-12

适用对象：首次使用或评审 KodaX Space 的开发者、技术团队成员、代码相关知识工作者。

## 1. 产品定位

KodaX Space 是 KodaX 的本地优先桌面 AI Agent 工作台。它把项目、会话、模型、工具调用、权限确认、工作流、文件预览、Artifact 产物、MCP 扩展和记忆治理放在同一个 Electron 桌面界面里。

你可以把它理解为“围绕本机项目工作的 AI 协作者”：

- 不锁定单一模型服务商，可配置内置或自定义 Provider。
- 默认以本地项目目录为工作边界，围绕项目文件、git 状态和会话历史工作。
- 写文件、运行命令、调用有副作用的工具前受权限模式和确认弹窗控制。
- 右侧 Task Dock 和 popout 面板把 Plan、Diff、Tasks、Terminal、Preview、MCP、Memory、Workflow、Artifact 等状态从聊天流里分离出来。
- 复用 KodaX SDK/CLI 的 session、skill、MCP、AGENTS.md 和部分配置。

## 2. `kodax_manual` 是什么

`kodax_manual` 是应用内 AI 可调用的自说明手册。当你在 Space 里问“这个工具怎么用”“右侧面板是什么”“怎么配置 provider”“为什么 Partner 点不了”时，AI 会通过它核对 Space 当前的能力和 UI 交互。

所以它可以算是工具的“自查手册”，但更精确地说：

- 它是 AI 面向的产品能力说明和交互索引。
- 它帮助 AI 避免用 SDK/CLI 的说法回答桌面端 UI 问题。
- 它不是完整 QA 测试用例，也不能替代发布检查、安全评审或人工验收。

这份中文说明书是人读版；`apps/desktop/electron/kodax/space-manual-topics.ts` 是注入给 SDK `kodax_manual` 的机读版。

## 3. 安装与启动

从项目 Release 页面下载安装包：

<https://github.com/icetomoyo/KodaX-Space/releases/latest>

常见安装包：

| 系统    | 推荐包                                                                                   |
| ------- | ---------------------------------------------------------------------------------------- |
| Windows | `Setup.exe` 或 `Portable.exe`。如果浏览器拦截 `.exe`，下载 `Setup.zip` 或 `Portable.zip` |
| macOS   | `.dmg`                                                                                   |
| Linux   | `AppImage` 或 `.deb`                                                                     |

当前安装包未做公开发行签名，首次打开可能出现系统安全提示。请只从可信来源获取安装包。Windows SmartScreen 可选择“更多信息”后继续运行；macOS 可右键应用选择“打开”；Linux AppImage 可能需要添加可执行权限。

源码开发方式：

```bash
git clone https://github.com/icetomoyo/KodaX-Space.git
cd KodaX-Space
npm install --include=dev
npm run dev
```

## 4. 5 分钟快速上手

1. 打开 KodaX Space。
2. 进入 `Settings` -> `Preferences`，选择界面语言和默认 workspace。
3. 打开项目目录。项目目录会成为会话的工作目录，也是工具读写文件的边界。
4. 进入 `Settings` -> `Providers`，选择 Provider，填入 API Key，点击 `Test`，需要时设为默认。
5. 新建或选择一个 session，在底部 composer 输入任务并发送。

示例任务：

```text
请阅读这个项目的 README 和 package.json，告诉我如何启动它。
```

发送后，中央 transcript 会显示模型回复和工具调用；右侧 Task Dock 会汇总运行状态、计划、变更、上下文和产物。

## 5. 界面总览

KodaX Space 主界面由这些区域组成：

| 区域            | 用途                                                                                 |
| --------------- | ------------------------------------------------------------------------------------ |
| 左侧栏          | 项目列表、最近 session、归档项目、会话切换与项目操作                                 |
| 顶部            | Environment Hub、activity popout 入口、Settings、Handoff inbox、全局状态             |
| 中央 transcript | 用户消息、模型回复、工具卡片、权限状态、Artifact 卡片、运行事件                      |
| 右侧 Task Dock  | Run、Plan、Agents、Workflow、Changes、Sources、Artifacts、Context 的当前状态概览     |
| 底部 composer   | 输入任务、添加文件/图片、选择模型、权限模式、agent mode、reasoning effort            |
| popout/overlay  | Preview、Diff、Terminal、Agents、MCP、Memory、Workflow、Plan、Tasks、Artifact 等详情 |

按 `?` 可打开应用内帮助；按 `Ctrl/Cmd+Shift+P` 可打开命令面板。

## 6. 项目与会话

Project 是本地工作目录。建议选择项目根目录，而不是过大的父目录。

Session 是围绕某个项目的一段连续对话。它保存上下文、工具调用、模型状态、Artifact、Workflow、Plan/Diff/Tasks 等历史。

常见操作：

- 打开项目：左侧栏或启动页选择本地目录。
- 新建会话：左侧项目区、`/new`、命令面板或发送第一条任务。
- 切换会话：左侧最近会话，或命令面板搜索 session。
- 管理会话：重命名、删除、Fork、Rewind，可通过菜单或 `/sessions`、`/load`、`/delete`、`/fork`、`/rewind` 等命令。
- 归档项目：左侧项目菜单归档，减少列表干扰。

## 7. Provider、Model 与 Reasoning

打开 `Settings` -> `Providers` 配置模型服务：

- 添加或更新 API Key。
- 点击 `Test` 验证连接。
- 设置默认 Provider。
- 添加自定义 Provider。
- 查看 key 来源、默认模型和配置状态。

API Key 会优先保存到系统 Keychain；Keychain 不可用时会退回临时内存状态。

自定义 Provider 支持 OpenAI-compatible 和 Anthropic-compatible 协议。通常需要填写：

- Display name
- Protocol
- Base URL
- Credential/API Key 或环境变量名
- Default model
- 可选模型列表
- 可选 reasoning effort 声明

会话中也可以通过底部模型选择器或命令调整：

```text
/provider <id>
/model <model-id>
/reasoning <off|auto|quick|balanced|deep>
/thinking <on|off>
```

`Ctrl+T` 可循环 reasoning effort。

## 8. 权限模式与确认

KodaX Space 有三种常用权限模式：

| 模式         | 适合场景                 | 行为                                 |
| ------------ | ------------------------ | ------------------------------------ |
| Plan         | 只想分析、读文件、做计划 | 尽量只读，不主动改文件               |
| Accept Edits | 日常推荐                 | 写文件、运行命令等风险操作由你确认   |
| Auto         | 明确信任项目和规则后使用 | 更自动地放行操作，仍受策略和工具限制 |

切换方式：

- 底部 `ModeSelector`
- `Shift+Tab` 循环切换
- `Ctrl+M` 打开模式选择器
- `/mode plan`、`/mode accept-edits`、`/mode auto`

当 AI 请求写文件、编辑、运行命令或调用有副作用的 MCP 工具时，Space 会弹出权限确认。常见选择包括 `Allow once`、`Allow always` 和 `Deny`。模型需要用户补充信息时，会通过 `ask_user` 弹出选择题或文本输入框；支持 Other/自定义输入的请求可以直接填写自由文本。

## 9. Composer 输入框

底部 composer 是主要操作入口。

快捷输入：

- `Enter`：发送。
- `Shift+Enter`：换行。
- `Ctrl/Cmd+Enter`：把消息排到当前 turn 之后。
- 运行中发送按钮会变为停止按钮，`Esc` 可停止或关闭当前 popover。
- 输入 `/` 打开 slash command 与 skill 补全。
- 输入 `@` 打开项目路径补全。
- 上下键可在补全和输入历史中导航。

附件与引用：

- 粘贴或拖入 PNG/JPEG/WEBP 图片，会生成图片 chip。单张约 6 MiB，单轮最多 8 张。
- 添加项目内文件会尽量插入 `@relative/path`。
- 添加项目外文件会插入 `file://` 链接。
- 草稿最多保留 32 个文件引用。
- `+` 菜单可添加文件/文件夹、插入 slash command、打开 connectors/MCP、查看 skills。
- Agent picker 可插入 `@agent-name`。

## 10. Slash 命令与命令面板

输入 `/` 会打开会话内命令和 skill 补全。常用命令：

| 命令                  | 用途                      |
| --------------------- | ------------------------- |
| `/help`               | 查看命令帮助              |
| `/new`                | 新建会话                  |
| `/clear`              | 清空当前视图              |
| `/copy`               | 复制会话内容              |
| `/sessions`           | 查看/管理 session         |
| `/load`               | 加载 session              |
| `/delete`             | 删除 session              |
| `/fork`               | Fork session              |
| `/rewind`             | 回退 session              |
| `/mode`               | 切换权限模式              |
| `/provider`           | 切换 provider             |
| `/model`              | 切换模型                  |
| `/reasoning`          | 设置 reasoning effort     |
| `/thinking`           | 开关 thinking 输出        |
| `/agent-mode`         | 切换 agent mode           |
| `/workflow`           | 查看、启动、管理 workflow |
| `/memory`、`/learn`   | 记忆与学习建议相关入口    |
| `/extensions`、`/mcp` | 扩展和 MCP 入口           |
| `/repointel`          | 仓库智能诊断/预热         |
| `/doctor`、`/status`  | 诊断当前运行状态          |

命令面板是全局 UI 操作入口：

- macOS：`Cmd+Shift+P`
- Windows/Linux：`Ctrl+Shift+P`

它可搜索 action、最近 session、项目文件引用和 slash 命令。

## 11. Task Dock

右侧 Task Dock 是当前会话的工作状态总览。有 Artifact 时，顶部可在 `Overview` 和 `Artifact` 之间切换。

常见分区：

- Run：当前运行、项目、session、权限模式、ask_user、workflow 摘要。
- Plan：模型当前计划。
- Agents：子 agent 或 markdown agent 状态。
- External tasks：第三方 Agent 子任务状态、独立取消状态、输入请求、输出和审计时间线。
- Workflow：当前 workflow run。
- Changes：git branch、ahead/behind、变更文件，可打开 diff/preview。
- Sources：当前 working folder，可在系统文件管理器中打开。
- Artifacts：产物摘要。
- Context：本轮引用的工具、文件和上下文。

可展开的分区右上角有详情按钮，会打开对应 popout。右侧栏左缘可拖拽调整宽度。

## 12. Popout 面板

Popout 把专业视图从聊天流里分离出来。顶部 activity 入口和 Task Dock 分区都可能打开 popout。

| 面板     | 用途                                                                           |
| -------- | ------------------------------------------------------------------------------ |
| Preview  | 预览 PDF、DOCX、XLS/XLSX 和普通文本/代码文件                                   |
| Diff     | 查看 AI 修改和 git working tree 差异                                           |
| Terminal | 项目目录下的真实 PTY 多标签终端                                                |
| Agents   | 查看 AGENTS.md/markdown agents 相关信息                                        |
| MCP      | 查看 MCP server 状态、工具、诊断和 .mcpb 扩展                                  |
| Memory   | 管理 Coder memory proposals、refs、governance、hints                           |
| Workflow | 查看 active/completed runs 和 saved workflows，执行 pause/resume/stop/rerun 等 |
| Plan     | 查看计划详情                                                                   |
| Tasks    | 查看任务列表                                                                   |
| Artifact | 查看、切换版本、复制、导出、迭代和独立打开产物                                 |

Smart Popout Director 会在第一次出现 plan、diff 或 task 信号时自动打开对应面板。可在 `Settings` -> `Preferences` 关闭。

## 13. Artifact 产物

Artifact 是 AI 生成的独立成果，不等于项目文件。常见类型包括：

- Markdown 报告
- 代码片段
- HTML / interactive HTML
- SVG
- Image
- PDF
- DOCX
- XLSX
- Chart

Artifact 面板支持：

- 选择不同 artifact。
- 切换版本。
- Copy。
- Save/Export。
- “再改一版”迭代。
- 打开 standalone window。

interactive HTML 会进入 sandbox 预览。React artifact 当前是占位类型，不作为可交互 LiveCanvas 运行。

## 14. Workflow 工作流

Workflow 适合多步骤任务，例如分析、执行、验证、生成产物、保存流程、复跑历史。

入口：

- `/workflow`
- Workflow Launcher
- Task Dock 的 Workflow 分区
- Workflow popout

Workflow manager 可执行：

- 查看 active/completed runs。
- 查看 saved workflows。
- pause/resume/stop 当前 run。
- rerun 历史 run 或 saved workflow。
- rename/delete run。
- 将已完成 run 保存为 workflow。
- 运行 saved workflow，并在启动前做 preflight 和应用内确认。
- 当 Runtime 提供可调度的 External Agent 时，可为未显式声明 target 的子任务选择默认 Agent；启动前会再次检查实时资格与配置修订。

当前 workflow 面向 Coder session。Partner 入口仍处于开发中。危险工具调用仍遵循权限模式和确认弹窗。

## 15. Memory Governance

Memory popout 是 Coder-only 的记忆治理界面，需要当前有活跃 Coder session。

四个主要标签：

- Inbox：查看待批准 memory proposals，approve 或 reject，可填写拒绝原因。
- Refs：检查已批准记忆引用。
- Governance：运行 curator/report，发现过期、冲突或可合并信息。
- Hints：为当前任务构建 memory pack/hints。

Partner 的 Knowledge Base 是另一个产品面，不等同于 Coder memory governance。Partner 已启用，并提供 Sources、KB、Outputs、checkpoint 写入和本地 policy/audit 控制。

## 16. MCP、Extensions、Skills 与 Agents

MCP 面板可查看：

- server 状态：idle、connecting、ready、error、disabled。
- command 或 URL。
- start/stop。
- tool 列表。
- diagnostics。
- 已安装 `.mcpb` 扩展和 uninstall。
- 配置错误与 reveal path。

`Settings` -> `Runtime` 可 reload MCP 配置，也可查看 global/project MCP 配置。

Extensions 分两类：

- MCP/.mcpb 扩展：通过 MCP 面板安装和管理。
- SDK filesystem extensions：通过 `/extensions sdk` 查看发现和诊断。默认偏 discovery-only，执行第三方扩展代码需要显式启用，并应只使用可信来源。

Skills 是 SDK 级能力：

- 用户级：`~/.kodax/skills/`
- 项目级：`<project>/.kodax/skills/`
- 在 composer 输入 `/` 时会和 slash command 一起出现。
- 若与 slash command 重名，可用 `/skill:<name>` 消歧。
- `Settings` -> `Runtime` -> `Skills` 可查看目录并安装文件夹、zip 或 archive。

Agents：

- `AGENTS.md` 和 markdown agents 给模型补充角色、规则和项目约定。
- Agent picker 可插入 `@agent-name`。
- Agent mode 支持 AMA、AMAW、SA，实际能力由 SDK 和当前工具状态决定。

External Agents（0.1.30 Reference 基线）：

- `Settings` -> `Runtime` -> `External Agents` 可创建、编辑、启停、删除和预检本地 Reference Agent 注册。
- Workflow Launcher 可把实时可调度的 Reference Agent 选为默认子任务目标；Workflow 源码显式声明的 target 仍优先。
- Task Dock 的 External tasks 支持查看事件、回答 `input-required`、取消任务和对 `unknown` 状态执行 reconcile。
- 这些任务始终绑定当前会话：切换会话会立即清除旧卡片，迟到响应不会覆盖新会话；main 会在读取和操作前复核任务归属。
- Reference Executor 是 KodaX 0.7.67 的本地合规适配器，不访问网络、不直接写工作区，也不代表真实 HTTP Agent 已接通。
- A2A、MCP Tasks 和受治理 HTTP 适配器尚未交付，因此对应注册入口保持隐藏。

## 17. Environment Hub、Quick Ask 与 Handoff

Environment Hub 位于顶部，显示当前项目、git branch、变更数量、ahead/behind、本地工作位置、sources 和 session context。点击后可跳转到 Task Dock 的 Changes、Sources、Run、Context 等分区。

Quick Ask：

- macOS：`Cmd+K`
- Windows/Linux：`Ctrl+K`

Quick Ask 会创建临时 plan-mode code session，用于快速问一次。它不是完全无 session 的 side query。回答有用时可选择 `Continue in Coder`，把内容提升到正常 Coder 会话。

Handoff inbox 会在 `~/.kodax/handoffs/*.json` 存在时出现在标题栏。它可显示有效/总数、stale/error 状态，并支持 accept 或 dismiss。Accept 会验证目标 session 是否仍存在，成功后切换到对应会话并移除 descriptor。

## 18. Repo-intelligence 与本地上下文

Repo-intelligence 为当前项目提供只读仓库理解能力，包括仓库概览、符号查找、模块上下文和文件/引用理解。

常见入口：

```text
/repointel status
/repointel warm
```

composer 首次输入时，Space 可能对当前项目做 best-effort 预热。该能力不直接修改文件。可用性可能受项目结构、SDK 状态、license 或 policy 控制。

## 19. 安全与隐私

KodaX Space 的默认原则是本地优先和显式授权。

- 项目文件默认在本机目录中读取和处理。
- API Key 不会通过 renderer 状态、IPC 列表响应、错误消息或日志暴露。
- 写文件、运行命令和有副作用工具调用受权限模式控制。
- 终端会剥离常见 `*_KEY`、`*_TOKEN` 等敏感环境变量。
- 第三方 Provider 会收到你发送给模型的内容，请按团队数据规则选择 Provider 和模型。
- 只从可信来源安装 MCP、SDK 扩展和 skill。

## 20. 当前限制

适用于当前 0.1.30 发布候选工作树：

- Partner 已启用，但 executable Partner Skills、通用 Connector/MCP 动作、浏览器/电脑控制、自动化、远程任务和模板级 Office 排版不属于当前能力。
- Display Language 覆盖产品 UI，包括 External Agent 管理、Workflow picker 和 Task Dock；模型输出、工具日志和第三方内容仍可能显示英文。
- External Agent 当前只提供 KodaX 0.7.67 Reference Executor；A2A、MCP Tasks 和受治理 HTTP 不可用。
- External Agent 管理仅在主应用窗口开放；Artifact 等辅助窗口不获得该管理/任务 IPC 权限。
- Quick Ask 使用临时 plan-mode session，不是完全无 session 的 side query。
- React artifact 当前不是可交互 LiveCanvas。
- GIF、视频和普通文件的结构化输入仍有限；普通文件主要作为路径引用。
- Worktree/cloud 工作位置入口仍是后续能力，当前以本地 workspace 为主。
- 未签名安装包可能触发 SmartScreen 或 Gatekeeper。
- Repo-intelligence、Workflow、Memory、MCP 的可用性可能受 SDK、license、项目状态和配置影响。

## 21. 常用快捷键

| 快捷键                        | 作用                       |
| ----------------------------- | -------------------------- |
| `Enter`                       | 发送消息                   |
| `Shift+Enter`                 | 换行                       |
| `Ctrl/Cmd+Enter`              | after-turn 排队发送        |
| `/`                           | slash command / skill 补全 |
| `@`                           | 项目路径补全               |
| `Esc`                         | 停止运行或关闭当前浮层     |
| `Ctrl/Cmd+K`                  | Quick Ask                  |
| `Ctrl/Cmd+Shift+P`            | 命令面板                   |
| `?`                           | 帮助                       |
| `Shift+Tab`                   | 循环权限模式               |
| `Ctrl+M`                      | 权限模式选择器             |
| `Ctrl+T`                      | 循环 reasoning effort      |
| `Ctrl+Shift+O`                | Transcript view menu       |
| `Ctrl+Shift+V`                | Preview 面板               |
| `Ctrl+Shift+D`                | Diff 面板                  |
| `Ctrl+Backtick`               | Terminal 面板              |
| `Ctrl+wheel` / `Ctrl+=` / `-` | 全局缩放                   |
| `Ctrl+0`                      | 重置缩放                   |

## 22. 常见问题

### 22.1 Provider 显示 No key

进入 `Settings` -> `Providers`，为对应 Provider 添加 API Key，或在启动前设置环境变量。

### 22.2 Test connection 失败

检查 API Key、Base URL、协议、公司代理、防火墙和 provider 当前服务状态。自定义 provider 尤其要确认协议是 OpenAI-compatible 还是 Anthropic-compatible。

### 22.3 AI 不能读取项目文件

确认已经打开项目目录。输入框如果提示先打开文件夹，说明当前没有项目上下文。也要确认引用路径在 workspace 内。

### 22.4 为什么修改文件前会弹确认

这是权限模式的安全设计。日常推荐 `Accept Edits`，让 AI 可以提出修改，但关键操作由你确认。

### 22.5 Partner 有哪些当前边界

Partner 已启用，支持 workspace-first Outputs、Sources、Knowledge Base、checkpointed writes、Office/PDF 便利产物、reviewed strict fallback 和本地 policy/audit。若某个项目中入口不可用，请检查应用版本、当前 surface 和本地状态；不要把尚未交付的 Connector、浏览器控制或自动化能力当成当前功能。

### 22.6 Quick Ask 为什么不是完全独立查询

Quick Ask 为了复用项目上下文和安全策略，会创建临时 plan-mode session。关闭时会清理；需要继续时可 `Continue in Coder`。

### 22.7 MCP 工具不可见

打开 MCP 面板，点击 Refresh 或 Reload config，查看 server 状态和 diagnostics。也可在 `Settings` -> `Runtime` 检查 global/project MCP 配置。

### 22.8 粘贴图片失败

确认图片格式为 PNG/JPEG/WEBP，大小不超过限制。GIF、视频或某些剪贴板格式当前可能无法作为图片输入。

### 22.9 语言切换后仍有英文

这是当前限制。菜单、Settings、侧栏和常用弹窗优先覆盖；模型输出、工具日志和部分专业面板可能仍保留英文。

## 23. 建议的第一次体验任务

项目理解：

```text
请阅读这个项目，给我一份模块结构、启动方式和主要风险摘要。
```

代码审查：

```text
请检查当前改动有没有明显 bug，先不要修改文件。
```

小修复：

```text
请修复一个你能确认的问题，修改前先说明计划。
```

文档生成：

```text
请根据 README 和 package.json 生成一份开发者快速上手文档，并作为 Artifact 展示。
```

图片理解：

```text
请根据这张截图指出界面上的主要问题，并给出修改建议。
```

## 24. 获取帮助与反馈

- 应用内：按 `?` 打开帮助，或输入 `/help`。
- 普通问题或 Bug：提交 GitHub Issue，并附版本号、复现步骤、日志和截图。
- 安全相关问题：不要公开提交 Issue，请通过维护者指定的私下渠道反馈。
