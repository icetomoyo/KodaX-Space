# KodaX Space 用户使用手册

<p align="center">
  <img src="../resources/icon.png" alt="KodaX Space 应用图标" width="96">
</p>

> 当前源码/发布准备基线：KodaX Space `v0.1.32`（package `0.1.32`）/ npm 正式发布的 KodaX `0.7.74`；最近已发布稳定 Space 版本仍为 `v0.1.31`。
>
> 更新日期：2026-07-23
>
> 如果你的界面与本文不同，请先在 Settings → License/版本信息中确认构建版本。

这份手册面向第一次使用 KodaX Space 的开发者、技术团队成员和代码相关知识工作者。它以“完成一件真实工作”为主线；架构和开发细节分别放在 [HLD](HLD.md) 与 [USAGE](USAGE.md)。

## 1. 先用一句话理解 KodaX Space

KodaX Space 是运行在你电脑上的 KodaX 桌面工作台：你选择一个本地项目或工作目录，告诉 AI 想完成什么，然后在同一个界面里观察计划、工具调用、文件变化、Workflow、产物和需要你确认的风险操作。

```mermaid
flowchart LR
    A["选择本地项目"] --> B["创建 Coder 或 Partner 会话"]
    B --> C["描述目标并发送"]
    C --> D["KodaX Runtime 执行任务"]
    D --> E{"需要你的决定?"}
    E -->|权限或问题| F["确认、拒绝或补充信息"]
    F --> D
    E -->|不需要| G["查看回复、Diff、Workflow 与产物"]
    G --> H["继续、回退、Fork 或导出"]
```

它不是另一个完整 IDE，也不是云端沙箱。代码编辑仍可回到 VS Code、JetBrains 等 IDE；Space 的价值是让本机 Agent 的执行过程、证据和决定更容易看懂和控制。

## 2. 该选 Coder、Partner 还是 Quick Ask

```mermaid
flowchart TD
    Q["你现在想做什么?"] --> C{"需要修改或理解代码?"}
    C -->|是| Coder["Coder"]
    C -->|否| P{"需要来源、知识库、报告或 Office 产物?"}
    P -->|是| Partner["Partner"]
    P -->|否| T{"只是临时问一句?"}
    T -->|是| Quick["Quick Ask"]
    T -->|否| Coder
```

| 入口          | 适合任务                                                       | 当前边界                                                                 |
| ------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------ |
| **Coder**     | 阅读代码、改文件、运行命令、排查问题、评审 Diff、长任务        | 主要软件研发工作面                                                       |
| **Partner**   | 研究、文档、需求、数据分析、演示、知识库、workspace-first 交付 | 已启用；浏览器、通用 Connector 写操作和远程自动化尚未交付                |
| **Quick Ask** | 临时解释、快速确认、短问题                                     | 当前使用临时 Plan session；可提升到 Coder，不是真正无 session side query |

## 3. 安装与首次启动

从 [GitHub Releases](https://github.com/icetomoyo/KodaX-Space/releases/latest) 获取安装包。

| 系统    | 推荐包                                 | 说明                            |
| ------- | -------------------------------------- | ------------------------------- |
| Windows | `Setup.exe`；免安装可用 `Portable.exe` | 浏览器拦截时可使用对应 zip      |
| macOS   | `.dmg`                                 | 首次打开可能需要右键 → 打开     |
| Linux   | `AppImage` 或 `.deb`                   | AppImage 可能需要添加可执行权限 |

当前公开安装包可能未签名。只从可信的 KodaX-AI 发布渠道下载安装；SmartScreen 或 Gatekeeper 提示并不等于文件一定安全，仍需核对来源和版本。

源码启动面向开发者：

```bash
git clone https://github.com/icetomoyo/KodaX-Space.git
cd KodaX-Space
npm install --include=dev
npm run dev
```

## 4. 十分钟完成第一项任务

### 第一步：打开一个项目

点击启动页或左侧栏的打开文件夹入口，选择项目根目录。建议选择仓库根目录，不要直接选择整个用户主目录。

### 第二步：配置 Provider

打开 Settings → Providers：

1. 选择内置 Provider，或点击 Add custom 添加兼容网关。
2. 填入 API Key；Keychain 可用时会保存在系统凭据存储中。
3. 点击 Test connection。
4. 需要时设为默认 Provider。

### 第三步：选择权限模式

第一次体验建议选择 **Plan**，确认 AI 能正确理解项目后，再切到 **Accept Edits**。

### 第四步：发送任务

在底部输入：

```text
请阅读 README、package.json 和主要目录，告诉我这个项目如何启动、核心模块在哪里。
```

你会在中央对话区看到回复和工具卡；右侧 Task Dock 会显示运行、计划、变化和上下文。

### 第五步：试一次受控修改

切换为 Accept Edits，然后发送：

```text
请给 README 增加一个“本地开发”小节。先说明计划，修改后展示 Diff，不要提交 Git。
```

出现权限请求时先阅读工具名、目标路径和参数，再选择 Allow once 或 Deny。完成后从 Task Dock → Changes 打开 Diff。

## 5. 界面地图

```text
┌──────────────────────────────────────────────────────────────────────┐
│ 顶部：Environment Hub │ 活动入口 │ Handoff │ Settings               │
├───────────────┬──────────────────────────────────┬───────────────────┤
│ 左侧栏        │ 中央 Transcript                  │ 右侧 Task Dock    │
│               │                                  │                   │
│ Projects      │ 用户消息                         │ Run / Plan        │
│ Sessions      │ AI 回复                          │ Agents / Workflow │
│ Archived      │ 工具卡 / 权限状态 / 产物卡       │ Changes / Sources │
│               │                                  │ Artifacts/Context │
├───────────────┴──────────────────────────────────┴───────────────────┤
│ 底部 Composer：附件 │ Agent │ Model/Effort │ Mode │ 输入框 │ 发送   │
└──────────────────────────────────────────────────────────────────────┘
```

| 区域            | 你通常在这里做什么                                                                         |
| --------------- | ------------------------------------------------------------------------------------------ |
| 左侧栏          | 打开项目、切换会话、重命名、Fork、Rewind、删除或归档；导航/Files 模式底部都可打开 Settings |
| Environment Hub | 看当前目录、Git branch/changes、来源和运行上下文，并跳到对应 Task Dock 分区                |
| Transcript      | 阅读对话、工具调用、系统提示、Workflow notice 与 Artifact 卡片                             |
| Task Dock       | 快速查看 Run、Plan、Agents、Workflow、Changes、Sources、Artifacts、Context                 |
| Composer        | 输入任务、添加图片/文件、选择 Provider/Model、Effort、Agent Mode 和权限模式                |
| Popout          | 深入查看 Preview、Diff、Terminal、Agents、MCP、Memory、Workflow、Tasks、Artifact           |

按 `?` 打开应用内快捷键帮助；按 `Ctrl/Cmd+Shift+P` 打开命令面板。

如果后台 Session 正在等待权限或 AskUser 回答，左侧栏会显示醒目的等待标记和项目级数量，并在有界列表中优先保留这些 Session。阻塞弹窗只显示当前可见 Session 的请求；切换到带标记的 Session 后才会看到并回答它。请求仍保存在全局耐久队列中，切换 Session 不会丢失或误消费。

## 6. 理解项目、会话和一次运行

- **Project**：本地工作目录，也是文件工具的主要边界。
- **Session**：围绕一个项目持续进行的对话，保存 transcript 和上下文。
- **Turn**：你发送一条消息，到这一轮完成、失败或取消。
- **Run**：KodaX Runtime 对一轮任务的执行记录；Coder daemon 为运行提供稳定 `runId`、有序事件和多客户端共享状态。
- **Artifact**：独立于项目文件的生成物，例如报告、HTML、SVG、PDF、DOCX、XLSX。
- **Workflow**：可观察、可暂停/恢复/停止、可保存和复跑的多步骤任务。

### v0.1.32 的 Runtime Host 对用户有什么影响

没有新增“Runtime 模式”开关。默认仍按原来的 Coder/Partner 方式使用，但底层所有权已经按 surface 拆分：Coder 连接当前 profile 的共享 daemon，Partner 继续在 Space 内 embedded-inline 运行。

```mermaid
flowchart LR
    UI["Renderer UI"] --> IPC["受校验的 Space IPC"]
    IPC --> Host["RuntimeHostAdapter"]
    Host --> RT["KodaX Runtime daemon<br/>Coder shared truth"]
    RT --> Run["session/run/settings/interactions<br/>Workflow observe/control<br/>Learning/catalog/Agent Actor-Turn"]
    Bridge["Space host providers"] --> Host
    Bridge --- P["Partner inline / MCP processes+logs<br/>Workflow library+start+admin / Reference Agent / Artifacts"]
```

多个受信任的 KodaX 客户端可以观察同一 Coder 会话；Space 会同步 provider/model/effort/mode 等共享设置，并通过 Runtime 处理权限 grant、AskUser、队列、Workflow 观察/暂停/恢复/停止、Learning Center 命令、MCP 工具发现/reload 和已配置 External Agent 的 Actor/Turn。Space 要求 `interruptInput:1`、`actorControlPlane:1`、`contextCompaction:3`、`transcriptPaging:1`、`transcriptSearch:1` 与 Auto LLM guardrail v3；Runtime 不可用或能力版本不足时 Coder fail closed，不会在背后重放到 inline owner。Partner 不受该 daemon 可用性影响。

Space 0.1.32 还会核对 daemon 的实际版本和能力，而不只看已经安装的 npm 包：低于 `0.7.74` 或缺少上述契约的长驻 daemon 会被拒绝并提示重启。compaction v3 会先耐久化精确 pre-compaction lineage，再缩减活动上下文；正式版还会复用精确 checkpoint/恢复指引字节，并在命令式手动压缩前把精确 flat Session history 对齐进 lineage，使 compaction entry、first-kept pointer 与压缩后附件留在同一 active path，同时继续读取旧的无后缀 checkpoint。Space 使用 revision-bound page/chunk/search 恢复可见历史，root 与持久 child 的历史保持隔离。Coder Session 使用 KodaX 的公开 `resolveAutoModeSettings()` 解析 `engine`、classifier model、timeout 与 `speculativeWindowMs`，并把缺失值写入可修订的 Runtime 设置；`0` 是有效的 speculative window 值。未配置时 classifier timeout 为 `20000ms`。底部会直接显示 `Auto[LLM]` 或 `Auto[RULES]`；快速连续切换按最后一次动作收敛，自动降级或手动选择后的 `Auto[RULES]` 保持粘性，需用 `/auto-engine llm` 显式切回。Auto[rules] 会对工作区内可完整建模的编辑直接放行，对工作区外、受保护、动态或无法完整建模的效果继续请求确认；Auto[LLM] 缺失 classifier model 时在本地拒绝，不请求 Provider、不弹权限窗、也不触发 rules 降级。输入 `/auto-denials` 可以查看当前 Runtime 版本、classifier model、timeout、speculative window 及不含提示正文的 classifier 时序/终止阶段。若看到 `8000ms exceeded`，说明实际执行的仍是升级前进程；若是 `20000ms exceeded`，则表示当前 provider/model 在包含排队、重试等待和完整 side query 的 20 秒 deadline 内没有完成，可配置更快的 `autoMode.classifierModel` 或审视 provider 延迟。

### Windows 关闭窗口、后台托盘与彻底退出

Windows 上点击右上角关闭会销毁主窗口和 renderer，不会默认停止共享
Runtime。任务栏右下角的 KodaX Space 托盘图标就是后台 owner 的可见控制面：

- 单击托盘图标或选择“打开 KodaX Space”会重建主窗口；
- “关闭窗口”只关闭界面；
- “退出 Space，保留 Runtime”会退出 Electron，但让 daemon 继续服务其他
  KodaX 客户端或后台任务；
- “彻底退出”会先断开 Space，再通过 Runtime 自身的安全检查尝试停止 daemon。
  如果仍有 active/queued 任务、待处理交互或其他客户端，daemon 会保留；
- 菜单只显示有界的任务/连接数量，不展示提示词、项目路径或凭据。

  0.1.32 的托盘仍由轻量 Electron main 持有，因此关闭窗口后主进程还在，但
  BrowserWindow/React renderer 的主要资源已经释放。要让 Electron main 也退出，需要
  未来增加独立托盘 helper；当前版本没有伪装成已经做到这一点。若托盘初始化失败，
  Space 会退回普通的关闭即退出，避免留下不可见后台进程。

升级后若驻留着“版本号相同但能力较旧”的 daemon，Space 只会在确认它完全空闲、
没有其他客户端后安全替换并重连；否则明确保留，不会强制结束别人的任务。

## 7. 权限：什么时候该允许

| 模式             | 建议用途                 | 实际含义                                                |
| ---------------- | ------------------------ | ------------------------------------------------------- |
| **Plan**         | 陌生项目、审阅、先分析   | 以只读分析和计划为主                                    |
| **Accept Edits** | 日常开发，推荐默认       | 文件编辑更顺畅；命令和高风险动作仍可能确认              |
| **Auto**         | 你信任项目、规则和工具时 | 由 LLM/rules guardrail 自动判断，仍受策略和安全边界限制 |

切换方式：底部 ModeSelector、`Shift+Tab`、`Ctrl+M` 或 `/mode`。

```mermaid
flowchart TD
    T["Agent 请求工具"] --> R{"只读且策略允许?"}
    R -->|是| X["执行"]
    R -->|否| M{"当前模式/规则允许?"}
    M -->|允许| X
    M -->|需要确认| D["显示权限弹窗"]
    D --> A["Allow once"]
    D --> AA["Allow always（按范围）"]
    D --> N["Deny"]
    A --> X
    AA --> X
    N --> S["返回拒绝，任务可调整"]
```

不要只看按钮颜色。允许前检查：工具名称、命令、目标路径、是否访问网络、是否会删除/覆盖数据。`Allow always` 仅在 Runtime 为当前安全操作给出具体授权建议时显示；它只记住所示的精确命令/工作目录/解释器/后台组合，或精确工具/路径范围，危险或动态 shell 操作仍只能单次确认。Auto 不是 OS 安全沙箱，也不是“允许一切”。

权限和 AskUser 请求按 Session 归属：当前弹窗只代表当前可见 Session。后台 Session 的请求会留在队列并在左侧栏显示等待标记；切换到对应 Session 后再处理。这样可以避免一个后台任务的确认窗盖住另一个正在阅读的会话。

PowerShell 的 `-Path` 支持 `[...]` 通配符。最新版 KodaX 会把这类方括号路径视为不完整并升级确认，防止 `[.]kodax/config.json` 解析到受保护路径后绕过 Auto 审查；如果目标确实是名称中带方括号的普通文件，请使用 `-LiteralPath` 或 `-PSPath`，例如 `build/file[12].txt`，它仍会按精确目标建模。

## 8. Composer、附件与排队

| 操作             | 结果                                      |
| ---------------- | ----------------------------------------- |
| `Enter`          | 发送；运行中按 interrupt 模式排入当前 Run |
| `Shift+Enter`    | 换行                                      |
| `Ctrl/Cmd+Enter` | 排到当前 turn 之后发送                    |
| `Esc` 或停止按钮 | 停止当前运行或关闭最上层浮窗              |
| 输入 `/`         | 打开 slash command 与 Skill 补全          |
| 输入 `@`         | 打开项目路径补全                          |

附件规则：

- PNG/JPEG/WEBP 可粘贴或拖入，单轮最多 8 张、单张约 6 MiB。
- 项目内文件优先成为 `@relative/path` 引用。
- 项目外文件以受控文件引用处理，不会自动变成项目文件。
- PDF、DOCX、XLS/XLSX 和文本/代码文件可在 Preview 查看；大文件受大小和单元格数量限制。
- 运行中普通发送使用 `interruptInput:1`：Runtime 返回公开 `inputId`，并在下一个安全 Runner 边界按 FIFO 把它作为真实用户消息交给当前 Run；`Ctrl/Cmd+Enter` 明确使用 after-turn，在当前 turn 后创建后续执行。
- interrupt 真正进入 transcript 后，黄色排队气泡由 canonical 用户消息替换。若最终安全窗口已经关闭，发送会被拒绝并恢复原草稿；若极端终态中已接受但仍未交付，Space 会保留红色“未送达”气泡和复制重试提示，而不是永久显示排队中。
- 若 Runtime 无法持久化 durable `run.input.delivered` 事件，该 input 仍保持 queued，发送调用返回错误并由 Space 恢复草稿；Runtime 只记录不含用户输入正文的有界 `runtime.warning`，不能把这次失败当作已送达。
- 停止任务会清理不应继续的后续提示；不要把 queue 气泡是否消失当作唯一交付依据，排障时同时记录 `sessionId`、`runId` 和 `inputId`。

## 9. Provider、Model、Effort 与 Agent Mode

Settings 有四个主标签：Preferences、Providers、Runtime、License。

### Provider

内置 Provider 和自定义 OpenAI-compatible/Anthropic-compatible Provider 都从 Providers 管理。环境变量也可提供凭据；UI 会尽量说明凭据来源。自定义 Provider 的 Base URL、协议和模型名必须与服务端实际兼容。

### Model 与 Reasoning Effort

- 会话可覆盖 Provider 和 Model。
- Effort 使用 `off / auto / quick / balanced / deep` 的 Space 抽象，再映射到模型支持的参数。
- `Ctrl+Shift+E` 打开/循环可用 effort；`Ctrl+T` 保留为旧式循环快捷键。
- Thinking 是模型输出行为，不等于 Effort。

### Agent Mode

- **SA**：单 Agent 路径，适合直接、小型任务。
- **AMA**：默认的自适应多 Agent 协作方式。AMAW 已退出并合并到 AMA；旧配置会自动迁移。

Workflow 只在显式 Workflow 强信号、`/workflow`、命名 Workflow 或 SDK 请求下开放，普通复杂任务、并行或审查等弱信号不会自动启动。不同 Provider、工具和任务并不保证两种模式产生相同效果；不确定时保留默认值，用 `Alt+M` 或 `/agent-mode` 调整。

### 子 Agent 与 mailbox 协调

- 模型侧 `wait_agent` 是 mailbox yield，只等待当前调用者范围内的 Agent 消息/完成、root 用户输入、中断或超时；它只返回小型唤醒确认，不携带整批进度或重复结果。
- Space 和 SDK 仍通过 Actor event snapshot/replay/long-poll 展示 progress、thinking 和 tool activity。普通进度不会唤醒父模型；`actorControlPlane` 仍是 v1，这是一项语义加固，不是新的 v2 capability。
- `list_agents` 用于读取有界 Actor 树状态；`agent_output` 只读取已知 Actor/Turn 的定向结果或 artifact，不能轮询它模拟等待。
- 在父 Agent 等待子 Agent 时发送的新提示仍是真实用户消息，会在下一安全边界交给当前 Agent并写入 transcript；每条队列消息只出队一次。未确认的 root completion 可在硬重启后恢复一次，同进程重建会按 child turnId 去重。
- 主 transcript 与 root live draft 只显示 root 的正文、thinking、工具和 Todo。Child 活动保留在 Agents/Workflow 专用面；子正文不应看起来像父 Agent 的回复。
- `get_goal`、`create_goal`、`update_goal` 保持完整常驻工具契约。Goal 必须由用户显式请求创建；完成仍需证据验证，blocked 仍要求连续三轮同类 blocker。

## 10. 会话历史、Fork、Rewind 与 Compact

| 操作    | 用途                   | 注意                             |
| ------- | ---------------------- | -------------------------------- |
| Rename  | 给会话一个容易找的名字 | 标题由 Space 兼容层维护          |
| Fork    | 从当前分支派生新会话   | 源会话不变，新会话继承运行设置   |
| Rewind  | 回到较早的用户轮次     | 会先停止当前运行，再截断活动分支 |
| Compact | 压缩长会话上下文       | UI 仍回放完整 append-order 历史  |
| Delete  | 删除会话               | 先确认没有其他 KodaX 进程占用    |

Compact 只缩减下一次模型请求使用的活动上下文，不等于删除完整历史。0.7.74 的 compaction v3 采用 durable-before-evict：精确历史先写入 lineage/sidecar，再发布精简快照；正式版同时保证精确 checkpoint/恢复指引、first-kept pointer 和压缩后附件位于同一活动 lineage，命令式手动压缩也会先从精确 flat Session history 对齐 lineage，旧的无后缀 checkpoint 仍能恢复。Space 通过有界 page/chunk/search 读取，历史搜索结果绑定具体 revision。旧版已经丢弃且从未保存的字节无法凭空恢复。

Space 与 KodaX CLI/REPL 共用 `~/.kodax/sessions/`。KodaX CLI 的 `-c`/auto-resume 会在最近 1000 个候选中跳过空 ACP 占位，只选择最近的非空会话；全部为空时不创建虚假的恢复结果，显式 session ID 始终优先。交互式恢复会在下一轮前恢复保存的 workspace runtime、messages、UI history、lineage、artifacts、extensions、title、tag 和 session identity。Space 左侧栏仍使用自己的显式项目/会话选择入口。如果 CLI 改写了正在显示的同一 session，Space 不保证实时文件级同步；切换会话或重启可重新读取。

Quick Ask 的临时 session 会尽力在关闭时清理；选择 Continue in Coder 后会提升为正常 Coder 会话。

## 11. Task Dock 与常用 Popout

| 面板           | 主要用途                                        |
| -------------- | ----------------------------------------------- |
| Plan           | 当前计划与进度                                  |
| Diff / Changes | AI 修改和 Git working tree 差异                 |
| Tasks / Agents | 子 Agent、markdown agents 和外部任务            |
| Workflow       | 多步骤 run、历史与保存的流程                    |
| Preview        | PDF、DOCX、XLS/XLSX、代码和文本预览             |
| Terminal       | 当前项目下的真实 PTY 多标签终端                 |
| MCP            | Server 状态、启停、工具、诊断、`.mcpb`          |
| Memory         | Coder memory proposals、refs、governance、hints |
| Artifact       | 版本、复制、导出、迭代、独立窗口                |

Smart Popout Director 在首次出现 plan、diff 或 task 信号时自动打开一次对应面板。可在 Settings → Preferences 关闭。

## 12. Partner：从来源到可交付成果

Partner 适合把资料整理成可复核的工作成果。推荐流程：

```mermaid
flowchart LR
    S["添加 Sources"] --> K["建立/搜索 Knowledge Base"]
    K --> W["在 Conversation 描述目标"]
    W --> O["生成 Outputs / Artifact"]
    O --> C["Checkpoint + Diff"]
    C --> R{"接受结果?"}
    R -->|继续修改| W
    R -->|需要回退| B["Rollback checkpoint"]
    R -->|完成| E["导出或交付"]
```

Partner 已支持 Sources、KB、workspace-first Outputs、checkpointed writes、基础 Office/PDF 便利写入和本地 policy/audit。它不会自动获得 Coder 的全部工具，也不应被当成浏览器、邮件发送器或远程办公自动化平台。

## 13. Artifact、Preview 与 Workspace 文件

三类对象不要混淆：

- **项目文件**：属于当前 workspace，由文件工具修改，通常在 Diff 中审阅。
- **Artifact**：由 Space 管理的独立生成物，有自己的版本、复制和导出行为。
- **Partner Output**：面向知识工作的 workspace-first 交付物，可带 checkpoint/diff/rollback。

interactive HTML 在沙箱中预览；React artifact 当前不是 LiveCanvas。Office writer 提供的是可靠基础文件，不承诺品牌模板级排版。

## 14. Workflow、Memory、MCP、Skills 与 External Agents

### Workflow

Workflow 管理多步骤任务和历史。入口包括 `/workflow`、Workflow Launcher、Task Dock 和 Workflow popout。可查看 run、pause/resume/stop、rerun、rename/delete，以及保存/运行 workflow。Space 的 Workflow Controller 保留 durable history、origin、立即停止投影和 Artifact 关联。

### Memory Governance

Memory 是 Coder-only 治理界面：

- Inbox：批准或拒绝 memory proposal。
- Refs：查看已批准引用。
- Governance：检查过期、冲突和合并建议。
- Hints：为当前任务构建 memory pack。

Partner Knowledge Base 与 Coder Memory 是两套不同职责，不能互相替代。

KodaX 0.7.68 新增 FEATURE_260 Memory Agent。它不会创建第二套记忆库，而是在普通 managed run 内复用 F228：已准备好的相关记忆可作为零等待、低权威、默认静默的提示；模型确有需要时可调用只读 `memory_recall({ need })`，但不能自行指定 tenant/user/project 等 scope。任务结束后可形成有界 Outcome Digest，并继续通过 proposal、preview、fingerprint 和 apply 进入现有治理流程。

Space 0.1.32 保留并验证真实 `/experimental-memory` 导出和 policy，在版本/诊断中如实报告，并记录不含记忆正文的生命周期元数据。普通 recall 不生成“记忆思考”消息；完整 Episodes、Activity、纠正、forget/purge 界面仍属于 F117 计划。现有 Inbox、Refs、Governance、Hints 继续由 F228 提供。

### MCP 与 `.mcpb`

MCP 面板展示 server 状态、命令/URL、start/stop、工具、日志/诊断和扩展卸载。`v0.1.32` 的 Coder 工具目录与 reload 会同步 Runtime；server 进程、状态和日志仍由 Space MCP Manager 负责，不会启动第二套桌面 manager。只安装可信来源的扩展。

### Skills 与 Markdown Agents

- 用户 Skill：`~/.kodax/skills/`
- 项目 Skill：`<project>/.kodax/skills/`
- Space builtin：安装包自带 `frontend-slides` 与 `huashu-design`，应用启动时自动注册，无需复制到用户目录。Space 分发的 Huashu 适配已移除默认推广水印/签名的标记与指令，但仍保留上游 MIT 许可证和作者信息。
- 在 `/` 补全中调用；重名时使用 `/skill:<name>`。
- 用户/项目 Skill 可按 KodaX 的发现优先级覆盖同名 builtin；覆盖只影响当前发现结果，不会改写安装包内文件。
- builtin 表示 skill 本体随应用提供，不表示所有可选工具都被嵌入。Huashu 的浏览器、视频、TTS、AI 评审等扩展流程仍可能需要 Node/Python package、Playwright 浏览器、`ffmpeg`、POSIX-compatible shell 或 API 凭据；不使用这些流程时无需准备。
- 本机可能存在的 `pdf`、`pptx`、`xlsx`、`docx` skill 不随 Space 分发，因为当前来源许可证禁止复制、修改或再分发。Space 仍可预览这些文件格式；这与是否打包同名 skill 是两件事。
- `AGENTS.md` 与 markdown agents 提供项目规则和角色，Agent picker 用 `@agent-name` 插入。

### External Agents

Settings → Runtime → External Agents 同时展示 Space Reference Agent 与 Runtime 配置的 External Agent。Reference 项可创建、编辑、启停和删除；Runtime 项由 daemon 的版本化配置持有，Space 只做发现、预检和任务操作。Coder 对 Runtime 项使用统一 Actor/Turn 路径，Task Dock 可查看事件、回复 `input-required`、取消或 reconcile；模型协调走 mailbox，UI 进度走 Actor telemetry，两者不混用。Reference 任务继续使用本地合规执行器。MCP Tasks 和 governed HTTP 仍不是通用产品承诺。

## 15. Quick Ask、Handoff 与 CLI 连续性

- `Ctrl/Cmd+K` 打开 Quick Ask。
- `Ctrl/Cmd+Shift+P` 打开命令面板，两者不是同一个功能。
- Quick Ask 需要项目上下文，当前使用临时 Plan session；有价值的回答可 Continue in Coder。
- Handoff inbox 读取 `~/.kodax/handoffs/*.json`；Accept 前会验证目标 session，Dismiss 会移除 descriptor。
- 当前 Space 已实现 handoff receiver；CLI writer 是否可用取决于 KodaX 的公开契约。

## 16. 常用 Slash 命令

以应用内 `/help` 为最终准确信息。高频命令：

| 命令                                        | 作用                          |
| ------------------------------------------- | ----------------------------- |
| `/mode`                                     | 查看或切换权限模式            |
| `/provider`、`/model`                       | 切换 Provider/Model           |
| `/reasoning`、`/thinking`                   | 调整 Effort/Thinking          |
| `/agent-mode`                               | 切换 SA/AMA                   |
| `/workflow`                                 | 启动或查看 Workflow           |
| `/compact`                                  | 立即压缩当前持久会话上下文    |
| `/tree`、`/history`                         | 查看 lineage 或用户消息历史   |
| `/fork`、`/rewind`                          | 派生或回退会话                |
| `/memory`、`/skills`、`/mcp`、`/extensions` | 打开对应能力入口              |
| `/doctor`、`/status`、`/repointel`          | 诊断 Provider、会话与仓库智能 |
| `/review`                                   | 插入评审模板和当前未提交 Diff |

## 17. 快捷键速查

`Mod` 表示 macOS 的 `Cmd`、Windows/Linux 的 `Ctrl`。

| 快捷键                    | 作用                   |
| ------------------------- | ---------------------- |
| `Mod+K`                   | Quick Ask              |
| `Mod+Shift+P`             | 命令面板               |
| `Mod+N`                   | 新建会话               |
| `Mod+O`                   | 打开文件夹             |
| `Mod+,`                   | Settings               |
| `Shift+Tab`               | 循环权限模式           |
| `Ctrl+M`                  | 权限模式选择器         |
| `Ctrl+Shift+E`            | Reasoning Effort       |
| `Alt+M`                   | Agent Mode             |
| `Mod+F`                   | Transcript 搜索        |
| `Ctrl+Shift+O`            | Transcript 视图菜单    |
| `Ctrl+\`                  | Coder 专注模式         |
| `Ctrl+Shift+V`            | Preview                |
| `Ctrl+Shift+D`            | Diff                   |
| Ctrl + 反引号（`）        | Terminal（按平台映射） |
| `Ctrl+Shift+T`            | 循环主题               |
| `Ctrl+滚轮`、`Ctrl+=/-/0` | 全局缩放               |
| `?`                       | 帮助                   |

## 18. 数据、安全与隐私

```mermaid
flowchart TD
    Session["~/.kodax/sessions"] --> K["KodaX session truth"]
    Config["~/.kodax/config.json"] --> K
    Skills["~/.kodax/skills + project .kodax"] --> K
    Runtime["~/.kodax/runtime"] --> Events["Shared Runtime daemon state / run-event journal"]
    Space["~/.kodax/space"] --> UI["Space projects/preferences/metadata"]
    Keychain["OS Keychain"] --> Secret["Provider credentials"]
```

说明：默认 profile 根是 `~/.kodax`；因此 0.1.32 shared daemon 的 Runtime 状态/journal 实际默认位置是 `~/.kodax/runtime`。自定义 `KODAX_HOME` 或 `KODAX_PROFILE_DIR` 时路径随 profile 移动。0.1.31 embedded Runtime 可能留下历史的 `~/.kodax/.kodax/runtime`，0.1.32 不再把它作为当前 daemon 真理源。

- Renderer 不直接执行 LLM、文件工具或 shell。
- API Key 不应进入 renderer、普通 IPC 列表、日志或错误消息。
- Terminal 会剥离常见 `*_KEY`、`*_TOKEN` 环境变量。
- 第三方 Provider 会收到你实际提交给模型的内容；敏感代码仍应遵循组织政策。
- Worker isolation 不是 OS sandbox；本版本的 Coder 由独立 shared daemon 持有，Partner 仍由 Electron main 中的 embedded-inline Runtime 持有。

## 19. 常见问题

| 问题                        | 建议检查                                                                                                                                                                 |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Provider 显示 No key        | Settings → Providers、环境变量名、Keychain 可用性                                                                                                                        |
| Test connection 失败        | Base URL、协议、模型名、网络代理、服务端鉴权                                                                                                                             |
| AI 看不到文件               | 是否已打开正确项目、路径是否在 workspace、是否正确使用 `@path`                                                                                                           |
| 为什么一直弹权限            | 当前 Mode、工具风险、Allow always 的 scope、项目是否可信                                                                                                                 |
| 停止后仍看到旧输出          | 等待取消终态；若持续出现，记录 session、时间和日志报告问题                                                                                                               |
| 排队气泡一直不消失          | 核对 transcript 是否已有对应用户消息或“未送达”状态；记录 session/run/inputId                                                                                             |
| 子 Agent 进度反复唤醒父模型 | 普通 progress 不应结束 `wait_agent`；记录 actorPath/turnId 和 Runtime 日志                                                                                               |
| 子 Agent 正文混入父回复     | 检查 Agents/Workflow 活动面；主 transcript 只应显示 root 内容                                                                                                            |
| 历史看起来不完整            | 重开 session；检查是否 compact/rewind；确认 CLI 是否同时改写                                                                                                             |
| PowerShell 方括号路径被确认 | `-Path` 的 `[]` 是通配符；精确文件名改用 `-LiteralPath`/`-PSPath`                                                                                                        |
| CLI 自动恢复到了空会话      | 新版会跳过空 ACP 占位；核对实际包 SHA256、版本和是否仍有旧进程                                                                                                           |
| 普通 query 会闪出多个 cmd   | 这是 v0.1.32 shared daemon 稳定暴露的 KodaX 上游 Windows 子进程隐藏缺口；0.1.31 embedded-inline 路径不明显。发布前需安装修复后的 KodaX 包，Space 不内置未审 SDK 源码补丁 |
| MCP 工具不可见              | MCP 面板 Refresh/Reload、server 状态、PATH、配置来源和 diagnostics                                                                                                       |
| Partner 没有浏览器/邮件发送 | 当前未交付，不是配置错误                                                                                                                                                 |
| External Agent 不可选       | Reference 注册需 enabled 且 preflight 通过；真实网络适配器尚未交付                                                                                                       |
| Quick Ask 不能打开          | 先打开项目；使用 `Mod+K`，不要与命令面板混淆                                                                                                                             |
| 语言切换后仍有英文          | 模型输出、工具日志、文件内容和第三方数据不会被强制翻译                                                                                                                   |
| UI 白屏或状态异常           | 记录版本、打开 DevTools、查看 `~/.kodax/space/logs`，不要直接删除整个 `~/.kodax`                                                                                         |

## 20. 当前限制与诚实边界

- 当前 `v0.1.32` 源码默认让 Coder 连接 profile-scoped shared daemon；Partner、其工具、权限、知识与交付仍由 Space embedded inline owner 管理，不会迁入 Coder daemon。
- Runtime Learning Center 的兼容契约已接入，但完整 F118 管理界面尚未交付；Memory Agent 的 0.7.68 起始运行契约继续由正式 0.7.74 包保留，完整 F117 桌面管理体验尚未交付。
- Partner 浏览器、通用 Connector、远程任务、桌面电脑控制和自动化尚未交付。
- External Agent 的本地 Reference Executor 可用；Coder daemon 的 A2A 取决于显式配置与能力协商，MCP Tasks/governed HTTP 尚未作为通用能力开放。
- Quick Ask 不是完全无 session side query。
- React artifact 不是可交互 LiveCanvas。
- Office/PDF writer 是基础可靠输出，不是品牌模板级设计系统。
- 安装包签名、release channel 与诊断导出仍在后续版本计划中。
- 当前 KodaX 0.7.74 在 Windows 上仍可能让普通 Coder query 闪出短暂 `cmd.exe`/console 窗口；这是稳定版 0.1.32 的发布阻断项，修复由 KodaX 维护线程提供，Space 仅更新正式依赖并复验。

## 21. 获取帮助与反馈

提交问题时尽量提供：

1. Space 与 KodaX 版本；
2. 操作系统和安装方式；
3. Coder/Partner/Quick Ask 与 session 状态；
4. 可重复的步骤；
5. 脱敏后的日志、错误和截图；
6. 是否设置 `KODAX_HOME`、`KODAX_PROFILE_DIR` 或 Runtime rollback 环境变量。

普通问题可使用 GitHub Issues。安全漏洞、凭据泄露或未公开数据请不要提交公开 Issue，应通过私密渠道联系维护者。

更多入口：

- [文档中心](README.md)
- [开发与运行指南](USAGE.md)
- [能力台账](KODAX_CAPABILITY_LEDGER.md)
- [当前路线图](FEATURE_LIST.md)
- [v0.1.31 人工测试指导](test-guides/FEATURE_116_v0.1.31_TEST_GUIDE.md)
