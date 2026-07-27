# KodaX Space 产品需求文档（PRD）

> Last updated: 2026-07-27
> Status: 长期产品方向文档。当前发布基线为 KodaX Space 0.1.33（package 0.1.33）/ npm 正式发布的精确 KodaX 0.7.77。Coder shared daemon、compaction v3 与精确 checkpoint/history 恢复、mailbox-driven Agent 协调、运行中输入、root/child 投影隔离、Goal 工具常驻、Runtime-owned Auto LLM 权限、Sidecar 终态修正、Windows 后台子进程隐藏、Kimi K3 路由、跨 run 的稳定提示词缓存亲和、精确持久授权、有来源/许可/补丁/完整性门禁的 Space builtin skills，以及 Windows 可见、可重开的后台托盘与安全彻底退出已接入。v0.1.33 还交付 canonical Actor/Turn 投影、完整物理请求诊断、可配置 Shell 和 F140 首次询问/记住选择的主窗口关闭行为。主 Agent 有效窗口按最终自动压缩阈值计算，累计 Provider 用量按完成态请求诊断覆盖根/子 Agent 及辅助物理调用；完整 F117/F118 桌面治理体验仍在计划中。已交付能力与边界以 [USER_MANUAL.zh-CN.md](USER_MANUAL.zh-CN.md)、[KODAX_CAPABILITY_LEDGER.md](KODAX_CAPABILITY_LEDGER.md) 和 [FEATURE_LIST.md](FEATURE_LIST.md) 为准。
> 对标：Anthropic Claude Desktop（Cowork / Code 双面板）+ OpenAI Codex Desktop App（多 agent 本机壳）

> **当前落地摘要**：Coder 与 Partner 均可用；Partner 已具备 workspace-first Outputs、Sources/KB、checkpointed writes、Office/PDF 便利产物和本地 policy/audit。0.1.30 接入 KodaX 0.7.67 Reference External Agent 管理、Workflow/Worker 路由和 Task Dock 干预；v0.1.31 已发布 inline RuntimeHostAdapter 的 managed run、transcript、compact、fork、rewind；v0.1.32 由 KodaX 0.7.76 Coder daemon 在能力协商通过后提供 Runtime 配置的 A2A；v0.1.33 对齐 KodaX 0.7.77 并收口 Actor、精确回放、用量诊断、Shell 和关闭行为。底部把“距自动压缩的活动输入压力”和“Session 累计 Token 用量”拆为两个入口，避免把模型最大上下文、绝对阈值、输出容量预留和 Provider 账单混为一谈。MCP Tasks、受治理 HTTP、通用 Connector/浏览器控制/自动化/远程任务仍未作为当前能力开放。
>
> **2026-07-12 路线重置**：从 `v0.1.31` 起，规范路线由 [FEATURE_LIST.md](FEATURE_LIST.md) 的 Runtime alignment、platform trust、workflow/review evidence、task/capability governance、Memory Agent、Learning Center 和 beta completion 版本链管理。旧 M0/M1/M2/M3 里程碑只作为产品演进历史，不再表示未交付状态或版本承诺。

---

## 0. 中文导读（一页摘要）

KodaX Space 是 KodaX 生态的**桌面客户端**——不是另一个 IDE，也不是另一个 Chatbot，而是把 KodaX 已有的能力以**桌面级体验**重新组织，并扩展到非终端用户。

- **对标定位**：本地 agent 桌面壳（对标 Claude Desktop / Codex Desktop App）+ **双面板 Code / Partner** + **Quick Ask popover**
- **不做独立 Chat 面板**：浏览器和各 provider 自家产品已覆盖 chat；桌面 app 的独特价值是本机文件 + 工具执行
- **底座复用**：直接复用 KodaX 公开 SDK/Runtime facade；Space 不通过 ACP 接入 KodaX，也不复刻 agent runtime
- **差异化**：
  1. **12+ LLM Provider 自由切换**（Claude Desktop 锁定 Anthropic、Codex Desktop 锁定 OpenAI）
  2. **Repointel 仓库智能前置注入**（专利级核心能力）
  3. **CLI ↔ Desktop session 连续性**（终端开的 session 桌面继续）
  4. **可本地离线/可自托管**（不强制云）
  5. **Skills / Hooks / Permission Mode 与 KodaX 同源**
  6. **可审计的 builtin 分发**：只打包许可证允许再分发且锁定来源/补丁/哈希的 Skill；可选外部 runtime 不伪装成内嵌能力
  7. **后台所有权可控**：Windows 关闭窗口释放 renderer，托盘明确展示后台 owner，并提供重开、保留 Runtime 退出和安全彻底退出
- **不做**：
  - 不做独立 Chat 面板（用 Quick Ask popover 替代"临时问"场景）
  - 不做新的 IDE（不与 VS Code / JetBrains 正面竞争）
  - 不做 Cloud Sandbox VM（与 ChatGPT Agent 这类云沙箱模式划清边界）
  - 不做手机版（Phase 1）
- **当前版本链**：
  - `v0.1.30`：Coder/Partner 双 surface、workspace-first Partner、Reference External Agents 已发布
  - `v0.1.31-v0.1.33`：Runtime contract alignment + `app://space`/structured logging + typed semantic Space control
  - `v0.1.35-v0.1.40`：Partner outcome workspace、Workflow/Review、Task/Capability、Memory Agent、Learning Center
  - `v0.1.43`：本地化、诊断、release channel/distribution trust 完成 0.1.x beta gate
  - `v0.2.x`：Governed Browser、正式 Partner packs、Connector read snapshots、local automations、refreshable artifacts

---

## 1. 产品定位

### 1.1 一句话定位

> **KodaX Space 是面向开发者与代码相关知识工作者的、Provider 中立的、可自托管的 AI 桌面 agent 工作台。**

它在用户机器上做三件事：

1. 提供一个**可视化的 Coding Agent**面板（Code）——基于 KodaX。
2. 提供一个面向非纯编码任务（评审、需求拆解、研究、文档、数据转换与交付）的**Partner 面板**；它已在 `v0.1.30` 作为 workspace-first working agent 发布。
3. 作为本机 MCP / Connector / Skill / Repointel 的**统一宿主**。

辅以**Quick Ask popover**——应用内热键（macOS `⌘K`，Windows/Linux `Ctrl+K`）唤出的浮动小窗，目标语义是**无正式 session、无写工具、关闭后不保留**，用于“临时问 LLM”场景（M1 起）。当前实现需要先打开项目，使用临时 plan-mode session + 关闭时 best-effort 清理 + 显式 Continue in Coder；真正全局唤起和 Runtime `sideQuery` 仍是未来目标。

**为什么不做独立 Chat 面板**：浏览器、各 provider 自家产品（claude.ai、智谱 BigModel、Kimi、深度求索 chat 等）已经把 chat 体验做到 polished；桌面 app 的独特价值是"本机文件 + 工具执行"，做独立 chat 面板会稀释这一价值并增加无回报的工作量。临时问答需求由 Quick Ask 这种 popover 形态精确覆盖。

### 1.2 在 KodaX 生态中的位置

```text
                ┌──────────────────────────┐
                │      KodaX Space         │  ← 本文档主题：桌面 GUI 壳
                │  (Electron + React)      │
                └────────┬─────────────────┘
                         │ SDK / Runtime facade
                         ▼
                  ┌──────────────┐
                  │    KodaX     │
                  │ Runtime/Core │
                  └──────┬───────┘
                         │
       ┌─────────────────┼──────────────────┐
       ▼                 ▼                  ▼
  Coder surface     Partner surface   Repointel / MCP /
  (Space profile)   (Space profile)   External Agents
```

| 层                 | 项目                              | 对标           |
| ------------------ | --------------------------------- | -------------- |
| 内核（CLI/SDK）    | **KodaX**                         | Claude Code    |
| 知识工作 Surface   | **KodaX Space Partner**（已发布） | Claude Cowork  |
| 桌面壳（统一应用） | **KodaX Space**（本文档）         | Claude Desktop |
| 仓库智能内核       | **Repointel**（KodaX-private）    | — (无对标)     |

### 1.3 与现有 KodaX CLI/REPL 的关系

KodaX Space **不取代** CLI/REPL。三者关系：

- CLI：脚本化、CI/CD、批处理
- REPL：终端交互（Ink TUI）
- Space：桌面交互（Electron + React），并且**桌面是 session 的"第一公民展示面"**——同一个 session ID 可以在任意 surface 间漂移（这是 Claude Code 4.6+ 的 `--teleport / /desktop` 模式所验证过的）。

---

## 2. 对标分析（为什么要做、做什么、不做什么）

### 2.1 Claude Desktop 当前能力（2026 Q1 状态）

| 能力                                               | Claude Desktop                                                   | Codex Desktop App            | KodaX Space 立场                                                                      |
| -------------------------------------------------- | ---------------------------------------------------------------- | ---------------------------- | ------------------------------------------------------------------------------------- |
| 面板组织                                           | 三 tab（Chat / Cowork / Code，Code 实际埋在 Chat icon hover 下） | 单壳多 agent                 | **双面板（Code / Partner）+ Quick Ask popover**；不做独立 Chat                        |
| MCP server 本地宿主                                | ✅ 原生                                                          | ✅ 通过 plugin/skill         | ✅ 必须对齐                                                                           |
| 桌面扩展（`.mcpb` 一键安装）                       | ✅                                                               | ❌ 不兼容                    | ✅ 必须兼容 `.mcpb` 标准                                                              |
| Skills / Plugins 仓库                              | 内建                                                             | 90+ plugins                  | ✅ 复用 KodaX skills + `.mcpb`；F135 随包提供审定的 `frontend-slides`/`huashu-design` |
| Connector（GitHub/Slack/Notion 等图形化接入）      | ✅                                                               | ✅ 90+                       | `v0.2.3` 先做授权清晰、可撤销的只读 snapshot foundation                               |
| Quick Entry / 全局热键                             | ✅ macOS only                                                    | —                            | ✅ Quick Ask / floating surfaces 已发布，继续做 Runtime 对齐                          |
| 集成终端（应用内 shell）                           | ✅                                                               | ✅ 多 tab                    | ✅ 已发布                                                                             |
| 文件面板（diff / PDF / docx 预览）                 | ✅                                                               | ✅ 富预览                    | ✅ diff、artifact 与 Office/PDF 预览已发布                                            |
| In-app browser plugin（agent 操控本地 dev server） | —                                                                | ✅                           | `v0.2.0` governed Electron browser；不用 MCP 代替 host policy                         |
| Routines / Automations（定时 / 事件触发）          | ✅ 云                                                            | ✅ 复用 thread               | 不做云；`v0.2.6` 建立本地、可见、可审计 scheduler                                     |
| 远端 SSH session / devbox                          | ✅                                                               | ✅ alpha                     | 观察清单；没有版本承诺，先明确权限、所有权与恢复模型                                  |
| Automatic Review Agent（高风险动作经审阅子 agent） | —                                                                | ✅                           | `v0.1.35` 做 Evidence Review，不创建第二套 Advisor primitive                          |
| 多 agent 并行可视化                                | 较新                                                             | ✅ 卖点                      | ✅ Subagent/Workflow/External Agent 投影已发布                                        |
| Cloud Sandbox / VM 执行                            | —                                                                | ✅ Cloud Tasks               | ❌ 与 ChatGPT Agent 划清                                                              |
| 模型选择                                           | Anthropic only                                                   | OpenAI only                  | **12+ provider + 自定义** ← 关键差异                                                  |
| 自托管                                             | ❌                                                               | ❌                           | ✅ ← 关键差异                                                                         |
| 数据本地化                                         | 部分（经 Anthropic 服务器）                                      | 部分（云 task 上行）         | ✅ 默认 ← 关键差异                                                                    |
| 开源                                               | ❌                                                               | ❌（CLI 开源、Desktop 闭源） | ✅ KodaX 内核 Apache 2.0                                                              |
| Linux                                              | ❌                                                               | ❌                           | ✅ AppImage + deb release path already ships; channel/signing trust remains F101      |

### 2.2 与 Cursor / Windsurf / Cline 的差异

KodaX Space **不是 IDE 替代品**。它的设计哲学是：

> "你已经有 VS Code / JetBrains 了。KodaX Space 是一个旁边的桌面助手，它能调用你的代码库，但不会试图取代你的编辑器。"

这意味着：

- 没有大型代码编辑器内核（不内嵌 Monaco 作为主面板）
- 内置的文件查看/diff 面板**为 agent 行为审计而存在**，不是编辑工作流
- 鼓励用户继续用主力 IDE 写代码、用 KodaX Space 跑 agent 与对话

### 2.3 Partner 全场景 / 全功能

> **定位修订（2026-06-08）**：早期 PRD 把 Partner 限定为"Phase 1 不直接对标 Cowork 全场景、只做 preview"，并把它绑死在"等 KodaX 出独立 Partner 内核"上。复核 KodaX SDK 后确认该内核不存在且未排期。现按 [ADR-007](ADR/ADR-007-partner-surface-model.md) 重新定位：**Partner 是 Space 在同一 KodaX runtime 上组合出来的知识工作 surface（surface spec + skill packs + artifact 三件套），不等独立内核。** 本节先列全场景全功能（不预设哪些不做），分阶段见 §9 里程碑与 [ADR-007](ADR/ADR-007-partner-surface-model.md)。

Partner 与 Coder 共用同一引擎，差异只在四件事：

|              | **Coder**                      | **Partner**                                       |
| ------------ | ------------------------------ | ------------------------------------------------- |
| 工作对象     | 代码库（git repo）             | 任意知识源（本地文档 + 网络 + Connector）         |
| 主工具       | edit / bash / test / Repointel | read / synthesize / generate / 富格式 IO / 强 web |
| 证据标准     | diff / 测试 / verifier         | **引用与来源核验**（不杜撰、有出处）              |
| 产出物       | 代码变更（落进 repo）          | **Artifact**（报告 / slides / 表格 / 文档）       |
| Harness 目标 | correctness                    | **completeness + faithfulness**                   |

按"一份知识工作从输入到交付"的链路拆成 6 层，每层列全功能：

**1️⃣ 知识输入层（Sources）**

- 本地文件 / 文件夹作用域：任意目录（含非 git 的 Documents / Downloads），多目录混合
- 富格式读取：PDF、docx、pptx、xlsx、csv、md、图片
- 图像 / 扫描件理解：图表解读、UI 截图、OCR
- Web 研究：联网搜索 + 网页抓取 + 引用留存；并向**浏览器引擎级 web 能力**演进（JS 渲染 / 导航 / 交互 / 截图 / 结构化抽取）——由 **Space 自有 in-process 有头浏览器工具**（Electron Chromium，经 `registerTool` 注册，不走 MCP、不劳内核）提供，服务 Coder + Partner 双 surface，见 [ADR-007](ADR/ADR-007-partner-surface-model.md)
- Connector 知识源：邮件、Slack、Notion、Drive、GitHub Issues / PR（与 Connector 路线合流）
- 多源汇聚：把上述来源聚成一个带出处的"研究上下文"

**2️⃣ 任务 / 能力层（Skill Packs）—— Partner 的"应用面"**

- 总结类：folder/doc 摘要、会议纪要整理、长文档压缩
- 研究类：deep-research（多源对抗核验报告）、竞品 / 文献调研
- 生成类：draft-RFC、写 PRD、周报 / 状态更新、邮件起草、生成 slides
- 抽取 / 转换类：PDF 抽表、文档格式互转、数据清洗
- 数据分析类：Excel 分析 + 图表 / 数据可视化
- 代码相关知识工作（近场，复用 Repointel）：架构文档、API 文档、changelog、PR 描述、需求拆解、评审摘要 —— **Partner 与 Coder 的天然交界，也是最先吃的差异化场景**

**3️⃣ 产出 / Artifact 层**

- Artifact 一等概念：生成的 docx/pptx/xlsx/md/报告作为可预览、可迭代、可导出的产物
- 富预览（只读渲染 PDF/docx/xlsx/pptx）
- 迭代："再改一版" —— artifact 带版本，不是一次性输出
- 导出：到指定格式 / 目录 / 直接贴进 PR、Issue、Slack

**4️⃣ 执行 / Harness 层（engine concern，依赖 KodaX）**

- Partner verification profile：以 completeness + faithfulness 为验收目标，已通过 KodaX Agent Profile/Verifier contract 接入；不再等待独立 H1-Partner 内核
- 来源核验：deep-research 那套"对抗验证 + 引用"内化进 harness
- 工具白名单：`non-bash-subset`，默认不开 bash；受控放开转换工具
- Oversight：文档写盘 / web 外呼 / Connector 访问各自的权限确认（复用 Space 现有 permission UX）

**5️⃣ 交互 / UI 层（outcome-first doc workspace）**

- 当前已发布的 `Sources（左）| 对话 + 任务进度（中）| Artifact 预览（右）` 是 F130 之前的兼容基线；`v0.1.35` 默认布局不再保留嵌套 Partner 左栏
- 新任务可选 `分析报告 / 表格与数据 / PPT 演示 / 文档写作 / 文件整理` 结果入口，也可直接自然语言输入；入口不新增工作模式、Skill 选择器或权限状态
- 资料通过 `Add material` 按需进入统一上下文抽屉；中间保持对话、澄清与简短回执；右栏固定为 `成果 / 过程 / 文件`
- 隐式入口（极简且智能）：拖一个 PDF/docx 进来、或在非 git 目录开 session → 自动判定为知识工作并切到 doc-workspace，tab 只作锚点不作唯一入口
- 多步进度（"读 3 个源 → 抽表 → 生成报告"）进入右栏 `过程`，不得由 assistant 文本臆造，也不长期占用中间对话空间

**6️⃣ 复用层（不重造）**

- 直接复用 Space 已有：provider 切换、permission UX、observability、session lineage、cross-surface 漂移
- 直接复用已存在的 skill / MCP：docx / pdf / pptx / xlsx / deep-research / frontend-slides / web-search / 图像理解 —— Partner 的"引擎"其实已经散落存在，缺的是把它们**组织成一个 surface**

**与 Cowork 的边界**：不使用 "Cowork" 商标；术语用 "Partner" / "Knowledge Work"。Partner 的人群从近场（代码相关知识工作者 P2）起步，向远场（非编码知识工作者 P4）扩展。

---

## 3. 用户与场景

### 3.1 目标用户分层

| 层                                 | 画像                                           | 主要使用                               |
| ---------------------------------- | ---------------------------------------------- | -------------------------------------- |
| **P0 个人开发者**                  | 已经会用 KodaX CLI / Claude Code 的开发者      | Coder 面板 + MCP + Quick Ask           |
| **P1 团队开发者**                  | 小团队，关心 provider 切换、可观测性、可审计性 | Code + Repointel + 审计日志            |
| **P2 代码相关知识工作者**          | TL / 架构师 / 产品 / TPM                       | Code（评审）+ Partner 预览 + Quick Ask |
| **P3 企业管理员**（M3）            | 想把 KodaX 部署给一支团队                      | 策略管理、扩展白名单、provider 网关    |
| **P4 非编码知识工作者**（Phase 2） | 法务、HR、运营                                 | 等 KodaX Partner 成熟                  |

### 3.2 高优先级场景（P0-P1 必须）

| ID  | 场景                     | 现状痛点                        | Space 的解法                    |
| --- | ------------------------ | ------------------------------- | ------------------------------- |
| S1  | 多仓多 session 并行      | CLI 一窗一 session              | 桌面侧栏 + 多窗口/多 tab        |
| S2  | 切换 provider            | 改 config → 重启                | 顶栏下拉切换 + per-session 锁定 |
| S3  | 长任务进度监控           | CLI 滚屏丢失上下文              | Work 仪表盘 + 工具调用时间线    |
| S4  | Diff 审查 + 一次 approve | CLI 多次 y/n                    | 文件级 diff 面板 + 批准/驳回    |
| S5  | MCP 装好不报错           | JSON 手编                       | 一键 `.mcpb` 安装 + 健康检查    |
| S6  | Repointel 状态可见       | CLI 仅 `/status`                | 状态条 + 缓存可视化             |
| S7  | 与终端混用               | CLI 与 desktop 各自一份 session | session 跨 surface 漂移         |

### 3.3 反场景（明确不优化）

- 移动端（Phase 1 不做）
- 浏览器扩展（Phase 1 不做）
- 多人协作实时同编辑（Phase 1 不做，session 仍是单人）
- AI 自主网购、自主转账等高风险事务（永远要求显式人工确认，不做"全自动"宣传）

---

## 4. 产品原则

### 4.1 KodaX Space 五条原则

1. **Shell, not engine** — Space 是壳，不是新引擎。所有 agent 逻辑回到 KodaX 内核。
2. **Provider neutrality is sacred** — provider 切换永远是顶级操作；任何模型功能必须对 ≥ 2 个 provider 验证。
3. **Local first, cloud optional** — 默认全本地。云能力（如 Routines）是可选项，不是默认值。
4. **Oversight by design** — 任何不可逆操作（写文件、跑 bash、调网络）默认进入 review queue；用户可批量批准并配置规则。
5. **One session, many surfaces** — 同一 session 在 CLI / REPL / Space 之间无缝漂移；Space 不囤积自有状态。

### 4.2 与 KodaX 内核 PRD 的一致性

KodaX 内核的核心承诺（[KodaX/docs/PRD.md](../../KodaX/docs/PRD.md)）继续生效：

- Single-Agent First
- Harness On Demand（H0/H1/H2）
- Evidence Before Confidence
- Work-First UX

Space 仅在 UI/UX 层把这些概念**可视化**，不引入新的执行语义。

### 4.3 与 KodaX-private 的一致性

Repointel 的核心调用契约（`status / warm / preturn / context-pack / impact / symbol / process`）继续仅经本地 daemon，Space 仅作为 status 查看 + 一键 warm 的图形入口，**不直接读取 Repointel 内部数据结构**——这点对 KodaX-private 的专利布局至关重要。

---

## 5. 核心能力清单

### 5.1 核心能力（已发布基线与剩余加固）

#### 5.1.1 Code Workspace（核心面板）

- 项目选择器：列出最近打开的项目（git root + 工作区目录）
- 多 session 抽屉：每个 session 一行卡片（标题 / provider / 当前模式 / 最后活动）
- 主交互区：
  - 对话流（含 tool call 折叠卡片）
  - Work 进度条 + 当前 H0/H1/H2 模式徽标
  - 当前 reasoning mode（off/auto/quick/balanced/deep）下拉
- 工具调用面板（右抽屉）：
  - bash：完整命令 + 输出 + 退出码
  - read/write/edit：路径 + diff
  - grep/glob：pattern + scope
  - dispatch_child_task：子 agent 树状嵌套
- 文件面板（右抽屉）：
  - 点击 diff 文件名打开
  - 内置 Monaco 只读模式 + diff 模式
  - 不做主编辑工作流（教育用户回 IDE 编辑）
- 内置终端（底部抽屉）：复用系统 shell，与 KodaX bash tool **共享 cwd**

#### 5.1.2 Quick Ask（全局轻量入口，M1 起）

替代“独立 Chat 面板”。长期设计目标是全局唤起；当前已交付的是 KodaX Space 应用内浮动小窗，问一个临时问题，发完即关。

**形态**：

- 当前应用内热键：macOS `⌘K`，Windows / Linux `Ctrl+K`；全局系统热键与自定义映射尚未交付
- 单输入框 + 单回答区，**无 session 抽屉、无 tool 调用面板、无文件抽屉**
- 顶部展示当前 provider；可临时切换且**不影响 Coder 面板**正在用的 provider
- 失焦自动收起；Esc 关闭并丢弃；窗口尺寸约 480 × 360 px

**行为**：

- 通过现有 Space session bridge 创建受限临时会话：固定 `mode='plan'`；不提供写操作入口。它当前不是 v0.1.31 RuntimeHostAdapter 的正式 managed-run surface
- 流式回答；用户回车连发可累积一次性对话上下文，但**关闭即销毁**
- 临时 session 可能短暂写入共享 session store；关闭时 best-effort 清理。只有未来公开 `sideQuery` contract 才能承诺严格不落盘
- 想多聊？提供 "Continue in Coder panel as new session" 按钮：转换为正式 Coder session（此时才落盘）

**为什么不做独立 Chat 面板**：

- 任何浏览器都能拿到 polished LLM chat（claude.ai、chatgpt.com、智谱 BigModel、Kimi、深度求索 chat、通义、豆包 等）；桌面 app 重新做 chat 没有差异化
- 桌面 app 的独特价值 = **本机文件 + 工具执行**；独立 Chat 面板把这个价值稀释，且增加后端逻辑（HLD 之前埋的"Chat 不共享 Code 后端"复杂度由此移除）
- Quick Ask 的"临时问、不持久"语义已经覆盖 Chat 面板的真实使用场景
- 国内开发者的 chat UI 习惯已被 provider 自家产品满足（智谱 / Kimi / 通义 / 豆包），桌面 app 再做一份是负产出

#### 5.1.3 Permission UX

| 模式         | UI 表现                             | KodaX 对应     |
| ------------ | ----------------------------------- | -------------- |
| Plan         | 灰底顶栏 "Read-only planning"       | `plan`         |
| Accept Edits | 蓝底顶栏 + "Auto-accept file edits" | `accept-edits` |
| Auto         | 绿底顶栏 + 项目根目录提示           | `auto`         |

权限确认弹窗组件：

```
┌────────────────────────────────────────┐
│  ⚠ Agent requests permission           │
│                                        │
│  Tool: bash                            │
│  Command: npm install -D vitest        │
│  Risk: low (project-local install)     │
│                                        │
│  ▢ Always allow `npm install`          │
│                                        │
│  [Deny]  [Allow once]  [Allow]         │
└────────────────────────────────────────┘
```

行为对齐 KodaX REPL 的 `confirmTools` / `Allow patterns`，规则写入 `~/.kodax/permissions.json`。

#### 5.1.4 Provider 管理

- 内置 12 provider 的开箱可用展示（已配 key 才亮起）
- 自定义 provider（OpenAI/Anthropic-compatible）的图形化表单
- API key 写入 OS keychain（Windows Credential Manager / macOS Keychain），不落 plain text
- 每 provider 卡片显示：模型清单 / capability matrix / 最近一次延迟
- 一键"测试连接"

#### 5.1.5 MCP 管理

- MCP server 列表 + 状态灯
- `.mcpb` 一键安装（与 Claude Desktop 兼容的扩展格式）
- 手动 JSON 模式（不强制 GUI）
- 进程崩溃自动重启 + 最近日志查看
- 工具级开关：在 session 内禁用某 MCP server 的某个 tool

#### 5.1.6 Repointel 集成

- 状态条（顶栏右侧）只展示 Runtime 已公开的 repository-intelligence 状态/诊断
- warm/trace 操作仅在 Runtime capability 明确提供时出现；不把内部 hook 包装成稳定的“一键 warm”合同
- 不暴露 Repointel 内部结果对象；只展示 KodaX 内核已公开的状态字段
- 安装/未安装的引导：未安装时给一键安装指引（指向 KodaX-private 官方 release artifact）

#### 5.1.7 Session Lineage 可视化

- 把 KodaX 的 `branchable session tree` 画成图（节点 = checkpoint，边 = continuation）
- 支持回放到某 checkpoint、从某节点分叉新 session
- 与 CLI session ID 完全互通

#### 5.1.8 Cross-Surface Continuity

- "Continue in terminal" 按钮：把当前桌面 session 推到一个新 terminal 窗口
- "Pull from terminal" 命令：在 CLI 跑 `kodax --teleport-to-desktop`，桌面接收
- 协议：使用 KodaX 已发布的文件级 session/handoff 数据；CLI writer 只有在公开契约交付并通过 capability negotiation 后启用，不扩展 Space 私有 ACP 消息

#### 5.1.9 Observability 抽屉

- **当前已落地的紧凑入口**：
  - 上下文窗口按最终自动压缩阈值展示主 Agent 活动输入和分类构成；模型最大上下文与阈值分别陈述，输出容量预留不作为活动输入。
  - 会话 Token 用量累计根/子 Agent 的 Provider-reported input/output，并在可用时展示 cache read/write 与调用范围；Compact 不回退已发生用量。
  - 诊断只投影分类计数、哈希和 usage，不投影 Prompt、消息或工具正文。
- **完整抽屉仍保留的后续范围**：
  - 按 provider/模型/时间范围聚合，而不是把当前单 Session 紧凑入口冒充完整账单面板。
- 时间线视图：每一步 tool call 的开始/结束时刻
- 导出 JSON / Markdown 报告（粘到 PR/Issue）

#### 5.1.10 全局按钮反馈

- 所有 enabled 应用按钮使用同一套柔和扫光、边缘亮起、active 与键盘焦点语言，视觉基准来自 Session Token usage 控件。
- 反馈不改变动作语义：主操作、成功、警告、推理和危险操作分别使用既有语义色；全宽菜单/列表降低强度。
- Settings、Quick Ask、确认弹层等 portal surface 也必须覆盖；Windows 窗口控件、Monaco、xterm、disabled 与显式 opt-out 不被全局层接管。
- hover 只提供瞬时 sweep，键盘焦点必须稳定可见；`prefers-reduced-motion` 关闭位移动画但不移除状态提示。

### 5.2 近中期扩展（以 Feature List 为准）

- 主题（明 / 暗 / 跟随系统）
- 多窗口（不同窗口 = 不同 session）
- macOS Stage Manager / Mission Control 友好
- 自动更新（Squirrel for Mac, NSIS / Squirrel for Win）
- 桌面通知（长任务完成、需要审批时）
- 内置终端多 tab（对标 Codex Desktop）
- 文件富预览：PDF / docx / xlsx / pptx 只读渲染（对标 Codex Desktop）
- Connector foundation：先交付 catalog、授权状态、可撤销的只读 snapshot、provenance 与 Partner KB ingestion；写动作另行建项和威胁建模
- **Partner surface（当前已发布，继续扩展）** —— 见 [ADR-007](ADR/ADR-007-partner-surface-model.md)：
  - _Surface spec + 当前兼容布局_（已交付）：Surface 抽象、F130 前三栏基线、受限工具策略、非 git 作用域与隐式入口
  - _Outcome-first workspace_（`v0.1.35`）：五个可选结果入口、按需项目资料、对话居中、`成果 / 过程 / 文件` 右栏；不改变 Coder、Auto LLM 或权限/自治契约
  - _Skill packs + Artifact 层_（`v0.2.0` 扩展）：在已发布 artifact/Office writers 上增加 governed browser、document pack 与 research/citation pack
  - _Partner verification contract_（已交付）：Agent Profile、工具可见性、source-faithfulness/citation-completeness 规则；后续只按真实 eval 缺口增强，不再保留 SDK R1/R2 Blocked 占位
  - 全场景全功能见 [§2.3](#23-partner-全场景--全功能)

### 5.3 观察清单（没有版本承诺）

- 远端 KodaX runner / workspace isolation（必须先有明确执行所有权、权限和恢复模型；worktree 不作为安全沙箱）
- 社区 Skill 市场（正式 skill catalog 与 Learning Center 生命周期稳定后再评估）
- Hooks 编辑器（PreToolUse / PostToolUse）
- 更强自动审阅（优先扩展 F119 Evidence Review，不创建第二套 Advisor/Review Agent primitive）
- 外部事件触发器（GitHub / Slack / Linear webhook）；本地显式 scheduler 由 F097 先建立可见、可审计的基线
- Enterprise 策略（团队 provider 网关、扩展白名单、审计日志中央化）

### 5.4 Won't-have（Phase 1 - 2 内）

- 独立 Chat 面板（由 Quick Ask popover 替代）
- 内置代码编辑器作为主工作流（不与 IDE 竞争）
- Cloud Sandbox VM / 云端 agent 执行（与 ChatGPT Agent / Codex Cloud Tasks 划清边界）
- 实时多人协作
- 移动端
- 任何把"用户全自动信任 AI 跑 1 小时无人介入"作为卖点的演示

---

## 6. 用户旅程

### 6.1 首次启动（P0 个人开发者）

```
启动应用
  → Welcome 屏：选择主语言（英 / 中）+ 主题
  → Provider 配置向导（最少配 1 个）
       展示 12 provider 卡片 + "Skip if you'll use env vars"
       env var 检测：已设的 provider 自动亮起
  → 项目选择：当前工作目录 / 浏览 / 跳过
  → Repointel 引导：已安装则一键 warm；未安装则给安装指引
  → 第一条消息引导："试试问：分析本项目结构"
```

### 6.2 日常开发（多 session 并行）

```
开窗 → 左侧抽屉点 "+ New session"
  → 选择项目根目录 / provider / reasoning mode
  → 在对话框写任务
  → Work 进度条显示 H0_DIRECT，3 秒完成
  → 中等任务自动 escalate 到 H1，顶栏出现 "Round 1/2"
  → 复杂改动 escalate 到 H2，左侧 session 卡片标志变更
  → 期间打开第二个 session，跑另一个仓库的评审
```

### 6.3 Code Review 旅程

```
File panel 内点击 git diff
  → KodaX agent 看到 dirty workspace，自动跑 Repointel preturn
  → 桌面端展示推荐先看的 8 个文件 + 影响面胶囊
  → 用户在文件面板批量浏览 diff
  → 在对话区问"对 packages/llm 的改动给出风险点"
  → agent 用 Repointel impact 工具补全
```

### 6.4 Quick Ask 旅程（M1）

```
用户在 VS Code 写代码遇到陌生 shell 命令
  → 在 Space 内按 ⌘K / Ctrl+K 唤出 Quick Ask 浮窗
  → 输入 "what does `tar xzf -C` do?"
  → 流式回答 3 秒返回
  → Esc 关闭，临时 session best-effort 清理
  → 不打扰当前 Coder session；严格不落盘仍等待 sideQuery contract
```

进阶：

```
用户问着问着想动手实现
  → 点击回答下方 "Continue in Coder panel as new session"
  → Quick Ask 浮窗关闭，Coder 面板新建 session 并自动注入刚才对话作为 context
  → 生成可长期保留的正式 Coder session；临时 Quick Ask session 继续 best-effort 清理
```

### 6.5 Partner 预览（M2，对标 Cowork 入口）

```
顶部使用已发布的 `[Coder] [Partner]` surface switcher；每个 surface 保持独立 session scope，Task Dock/Artifact/Sources 按 surface 语义投影。
  → 切到 Partner
  → 提示：这是 preview；适合非编码、文档/分析类任务
  → 选择工作区目录（默认排除 .git）
  → 内置 skill：summarize-folder / draft-rfc / extract-table-from-pdf
  → 任务进入 Partner Agent Profile（区别于 Coder profile）：
       - 工具集子集：read / grep / glob / pdf-extract / docx-write
       - 不暴露 bash（除非用户显式打开）
```

---

## 7. 信任与安全

### 7.1 数据流约束

- 所有用户文件读取**默认本地**，不上传任何 LLM provider 之外的服务
- LLM provider 流量受 KodaX 内核已有的 redact-pii 规则（如 provider 配置启用）
- API key 永不进入日志 / Span / 报错堆栈
- 桌面 telemetry 默认关闭；开启需用户显式 opt-in，仅含错误堆栈与崩溃信号，无任务内容

### 7.2 权限模型

继承 KodaX 内核三模式（`plan` / `accept-edits` / `auto`），桌面侧追加：

- **写文件**：在项目根之外要二次确认（与 KodaX `isPathInsideProject` 对齐）
- **bash**：默认按 `Allow patterns` 评估；通配越权要二次确认
- **网络**：MCP server 的网络外呼按 server 粒度展示，可按 session 关闭
- **危险命令**：`rm -rf` / `git push --force` / `chmod 777` / 等内建黑名单永远要求显式 typed confirmation（输入 `CONFIRM`）

### 7.3 Agent 工作区隔离（参考 Windows Agent Workspace）

- 默认 session 工作目录是项目 root
- "Agent sandbox" 可选模式：把工作区复制到 `.kodax/sandbox-<id>/`，agent 在副本中执行，结果用 diff 合并回主仓库（适合 untrusted skill / 实验任务）
- 与 KodaX 现有 `worktree_create` 工具集成（同一底层机制）

### 7.4 审计

- 每个 session 自动落地完整 transcript（JSONL）至 `~/.kodax/sessions/<id>.jsonl`
- "Audit view" 抽屉：按 tool 类型筛选、按时间窗筛选、导出
- 企业版（M3）：日志可远程汇集到内部 SIEM

### 7.5 内容真实性

- **不夸大自主性**：UI 文案禁止使用 "fully autonomous" / "no oversight needed" 等措辞
- 长任务进度条与 KodaX Work budget 一一对应；不显示假进度

---

## 8. 差异化竞争力（vs Claude Desktop）

| 维度          | Claude Desktop      | KodaX Space                        | 价值主张                                 |
| ------------- | ------------------- | ---------------------------------- | ---------------------------------------- |
| Provider 选择 | Anthropic only      | 12+ + 自定义                       | 抵抗 vendor lock-in；本地/合规模型可接入 |
| 数据驻留      | 经 Anthropic 服务器 | 本地默认                           | 国内/合规场景可用                        |
| 代码理解      | 通用                | **Repointel 仓库智能**前置         | 减少试探性阅读、降低 token、提升精度     |
| 桌面扩展      | `.mcpb`             | `.mcpb` 兼容 + KodaX skill         | 双格式                                   |
| 与 CLI 联动   | 单向 `/desktop`     | 双向 teleport，同一 session 持久化 | 终端 + 桌面无缝                          |
| 开源          | 闭源                | KodaX 内核开源（Apache 2.0）       | 可审计、可 fork、可自托管                |
| 模型成本控制  | 单一定价            | provider 切换 + token 预算面板     | 成本可见、可压                           |

---

## 9. 发布节奏与里程碑

### 9.1 已完成基线

`v0.1.30` 已超过旧 M0/M1/M2 的大量目标：Coder/Partner、Quick Ask、权限、MCP/.mcpb、Workflow、Task Dock、终端、富预览、主题、Windows/macOS/Linux 包、自动更新清单、Partner workspace-first delivery、Memory Governance 和 Reference External Agents 均已存在。旧里程碑表已归档到 Git 历史，不再作为当前 backlog。

### 9.2 当前 0.1.x 版本链

| Version lane      | Outcome                                                                                                                        |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `v0.1.31`         | 已交付 Runtime/platform trust、`app://space`、redacted diagnostics 与 typed semantic actions                                   |
| `v0.1.32`         | Shared Coder daemon/live state，以及 Space-owned Partner 本地 Sources、稳定引用、自动 grounded recall                          |
| `v0.1.33`         | KodaX 0.7.77 Runtime/Actor/history/usage 稳定化、Shell 控制与 F140 可配置关闭行为（已发布）                                  |
| `v0.1.34`         | F137 中文优先 DOCX/PDF/XLSX/PPTX builtin 与 F139 语义 UI polish：有界执行、验证和受治理交付                                  |
| `v0.1.35`         | Partner outcome-first workspace、按需项目资料、成果/过程/文件右栏，以及 Workflow provenance 与 object-attached review receipts |
| `v0.1.36`         | Task Plan/Completion Receipt、Runtime Capability Health、Effort/Assurance/Route facts                                          |
| `v0.1.37`         | Partner hybrid retrieval/evidence ranking 与 curated knowledge lifecycle                                                       |
| `v0.1.38`         | F129 Partner Presentation Project：复用 F137 PPTX format service，增加模板优先 Studio、真实预览和目标 Office 引擎验证         |
| `v0.1.39`         | Memory Agent Desktop Host；硬门槛为已发布、兼容的 KX-F260 contract                                                             |
| `v0.1.40`         | Learning Center Desktop Host；硬门槛为已发布的 KX-F266 `runtime.learning`                                                      |
| `v0.1.41`         | Partner knowledge freshness、conflict 与 access integrity                                                                      |
| `v0.1.42`         | Partner knowledge integrity 稳定化预留                                                                                         |
| `v0.1.43`         | Localization、beta/release diagnostics、distribution trust 与 Partner knowledge quality                                        |
| `v0.1.44`         | 0.1.x patch/RC reserve                                                                                                         |

KX-F260/F266 未按时发布时，Space 调换 feature lane，不绕过 capability gate。

### 9.3 0.2.x Desktop-native expansion

| Version lane    | Outcome                                                                    |
| --------------- | -------------------------------------------------------------------------- |
| `v0.2.0`        | Governed Browser Runtime + Partner Document/Research packs                 |
| `v0.2.1-v0.2.2` | Connected Partner patch reserve                                            |
| `v0.2.3`        | Connector catalog/auth/read snapshots/provenance/revocation；不含写操作    |
| `v0.2.4-v0.2.5` | Connector patch reserve                                                    |
| `v0.2.6`        | Runtime-backed local automations + refreshable/versioned Partner artifacts |

Remote runner、Notebook、knowledge graph、desktop screen automation、`zh-Hant`、local workspace isolation 和 Connector 写操作均有价值，但在满足 [FEATURES_ARCHIVED.md](FEATURES_ARCHIVED.md#watchlist-and-reopen-gates) 的 reopen gate 前不是版本承诺。

### 9.4 post-v0.5.x security hardening

F138 在 `v0.5.x` 产品线完成后，为已成熟的文档、Presentation 和 native adapter 执行面增加
OS 强制的文件系统、网络、进程树、凭据和 native-resource 隔离。F137/F129 先使用有界
Worker/独立子进程、私有 staging、超时取消、禁宏/链接更新和整树清理完成功能；F138 不回溯
阻塞这些功能，也不需要 KodaX SDK 改动。

---

## 10. 成功指标

### 10.1 北极星指标

> **"过去 30 天有完成 ≥ 3 个 session 的本地用户数"**

它衡量了：装得上 + 装完真用 + 用得满意会再开 session。

### 10.2 体验指标

| 指标                                               | 目标（M1 GA） |
| -------------------------------------------------- | ------------- |
| 冷启动时间（点击图标到能输入）                     | < 3.0 s       |
| 首条 tool 调用渲染延迟（从内核 stream 到 UI 可见） | < 200 ms      |
| MCP 安装失败率                                     | < 5%          |
| Permission 弹窗 P95 处理耗时（用户决策时间不算）   | < 50 ms       |
| Provider 切换需重启次数                            | 0             |

### 10.3 业务/生态指标

| 指标                                                  | 目标（M1 GA） |
| ----------------------------------------------------- | ------------- |
| Repointel 启用率（已安装用户中默认开 premium-native） | > 60%         |
| CLI ↔ Space teleport 使用率（活跃用户）               | > 25%         |
| 12 provider 中至少 2 个被使用的用户占比               | > 35%         |
| `.mcpb` 安装的扩展数（平均每用户）                    | > 2           |

### 10.4 可信任度指标

| 指标                         | 目标 |
| ---------------------------- | ---- |
| 危险操作（黑名单命令）误漏率 | 0    |
| API key 泄露事件             | 0    |
| 静默上传任何用户文件         | 0    |

---

## 11. 非目标 / 反向声明

明确不做、不承诺：

1. **不做 IDE**：编辑器只在 review 流读取使用，不与 VS Code / JetBrains 竞争编辑工作流。
2. **不做云服务**：M3 之前不上线托管 SaaS；M3 后任何托管模块必须可关闭、可自部。
3. **不做 LLM 转发代理**：用户 key 直接打到 provider，KodaX Space 不代理（除非未来企业网关）。
4. **不做手机端**。
5. **不做"全自动 1 小时无人值守"宣传**：所有市场材料须如实体现 oversight queue。
6. **不实现** Anthropic-only 的功能为"独占卖点"：所有跨 provider 兼容是底线。

---

## 12. 风险与缓解

| 风险                               | 影响                                   | 缓解                                                                                               |
| ---------------------------------- | -------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Electron RAM/启动慢                | 用户体验差                             | 紧凑首屏 + KodaX 内核懒加载（见 [ADR-001](ADR/ADR-001-shell-electron.md) 重审条件）                |
| KodaX runtime 崩溃拖累 Space       | 用户丢失未保存对话                     | 监控崩溃工单，>5% 时切 utilityProcess（见 [ADR-003](ADR/ADR-003-kodax-integration-in-process.md)） |
| Repointel 安装失败                 | "premium-native" 永远 fallback OSS     | 安装引导带 doctor 自检；trace 显式                                                                 |
| Provider key 误存 plain text       | 安全事故                               | 必须走 OS keychain；CI 静态扫描禁字符串持久化                                                      |
| MCP 第三方扩展恶意行为             | 用户机器被破坏                         | 默认拒绝、显式 allow-list、扩展签名验证（M2）                                                      |
| 与 Claude Desktop `.mcpb` 标准漂移 | 生态隔离                               | 紧跟上游格式；不为"差异化"而魔改                                                                   |
| Anthropic 法务对"Cowork-like"宣传  | 合规风险                               | 不使用 "Cowork" 商标；术语用 "Partner" 或 "Knowledge Work"                                         |
| KodaX-private 专利保护             | 不能在 Space 中暴露 Repointel 内部对象 | Space 严格只调用 KodaX 已暴露的 status/控制接口                                                    |

---

## 13. 开放问题（需要早期决策）

| #       | 问题                                                       | 决策                                                                                         |
| ------- | ---------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| ~~Q1~~  | ~~Electron vs Tauri？~~                                    | **Electron**，见 [ADR-001](ADR/ADR-001-shell-electron.md)                                    |
| Q2      | 是否在 Space 内置 Node runtime？                           | 是，与 KodaX bundle 同源                                                                     |
| Q3      | Linux 当前状态？                                           | AppImage/deb 与 release staging 已存在；签名、channel policy 和持续平台 smoke 由 F101 完成。 |
| ~~Q4~~  | ~~Chat 面板是否复用 Coder session 后端？~~                 | **作废**：用 Quick Ask popover 替代独立 Chat 面板，见 [ADR-004](ADR/ADR-004-panel-model.md)  |
| Q5      | 是否提供官方"Anthropic 兼容" connectors（GitHub、Slack）？ | 是，M2，作为可选                                                                             |
| Q6      | 名称 "Partner" 是否最终化？                                | 暂定；M2 前与法务/品牌确认                                                                   |
| Q7      | 与 Claude Desktop 的 `.mcpb` 是否做到 100% 二进制兼容？    | 是；不兼容时降级为半自动安装                                                                 |
| Q8      | Session 持久化路径是否复用 `~/.kodax/sessions/`？          | 是；Space 不引入新目录                                                                       |
| ~~Q9~~  | ~~KodaX 集成是 in-process 还是 ACP？~~                     | **in-process**，见 [ADR-003](ADR/ADR-003-kodax-integration-in-process.md)                    |
| ~~Q10~~ | ~~是否引入 Rust？~~                                        | **按需 NAPI-RS 热路径**，见 [ADR-002](ADR/ADR-002-rust-integration-napi.md)                  |

---

## 14. 与 KodaX 内核 PRD 的对照表

| KodaX 内核 PRD 概念             | KodaX Space 中的体现                                                  |
| ------------------------------- | --------------------------------------------------------------------- |
| Single-Agent First              | Coder 面板默认显示 H0/SA；不渲染多角色图                              |
| Harness On Demand（H0/H1/H2）   | 顶栏徽标 + Work 进度，仅在升级时显示 Round                            |
| Evidence Before Confidence      | 任务完成展示 contract / handoff / verdict 摘要卡片（可折叠）          |
| Work-First UX                   | Work 进度条作主预算                                                   |
| Scout-first AMA                 | UI 仅在 "Scout escalated" 时短暂高亮，不暴露 Scout/Planner 等内部角色 |
| Skill as Progressive Disclosure | Skill 显示为 "skill-active" 标签，不渲染 workflow tree                |

---

## 15. 相关参考

- [KodaX Space HLD](HLD.md)
- [ADR 索引](ADR/README.md)
- [KodaX PRD](../../KodaX/docs/PRD.md)
- [KodaX HLD](../../KodaX/docs/HLD.md)
- [KodaX ADR](../../KodaX/docs/ADR.md)
- [KodaX-private 技术交底书（Repointel）](../../KodaX-private/技术交底书.md)
- Claude Desktop 桌面扩展规范（`.mcpb`，参 Anthropic 公开文档）

---

## 附录 A：术语对齐

| Space 术语                   | KodaX 内核术语               | Anthropic 对应    |
| ---------------------------- | ---------------------------- | ----------------- |
| Session                      | Session / Task               | Conversation      |
| Project                      | Working directory / git root | Workspace         |
| Permission Mode              | PermissionMode               | Operating mode    |
| Provider                     | LLM Provider                 | Model             |
| Skill                        | Skill                        | Skill             |
| Connector                    | MCP server with OAuth UI     | Connector         |
| Desktop Extension（`.mcpb`） | MCP package                  | Desktop Extension |
| Work                         | Work budget                  | Tokens / steps    |
| Repointel premium-native     | Repo intelligence engine     | （无对应）        |

---

## 附录 B：UI 草图（ASCII）

### B.1 主窗口（M0：仅 Code，无 tab 切换器）

M0 状态——Partner 还没上线，所以不显示 tab，直接是 Coder workspace：

```
┌──────────────────────────────────────────────────────────────────────┐
│  KodaX Space · Code                              Provider:[zhipu▼]   │
│                                                  Mode:[auto-in-proj▼]│
├────────────┬──────────────────────────────────────────┬──────────────┤
│ Sessions   │  Session: review-auth                     │  Files       │
│            │  Repo: ~/work/myapp                       │              │
│ ● review-  │  Repointel ● premium-native               │  ▾ src/      │
│   auth     │                                           │    auth.ts   │
│ ○ refactor │  > Find security issues in src/auth.ts    │    middle.ts │
│   db       │                                           │              │
│ ○ todo-app │  ▸ read src/auth.ts (offset=0, limit=200) │  ▾ tests/    │
│            │  ▸ grep "password" src/                   │    auth.test │
│ + New      │  ▸ semantic_lookup "session token"        │              │
│            │                                           │  [open diff] │
│ Token use: │  Found 3 issues:                          │              │
│ in   12.4k │  1) Token stored in localStorage…         ├──────────────┤
│ out   3.1k │  2) Missing CSRF on /login…               │  Subagents   │
│ cache 41%  │  3) Plain-text password log…              │  · child-1   │
│            │                                           │    grep ✓    │
│ Work 28/200│  > Fix issue 1 with httpOnly cookie       │  · child-2   │
│ Round —    │                                           │    read ⟳    │
├────────────┴──────────────────────────────────────────┴──────────────┤
│  Terminal: ~/work/myapp $ ▮                                          │
└──────────────────────────────────────────────────────────────────────┘
```

M2+ 状态——Partner 上线后顶部出现 tab 切换器：

```
┌──────────────────────────────────────────────────────────────────────┐
│  KodaX Space    [Code●] [Partner]                Provider:[zhipu▼]   │
│                                                  Mode:[auto-in-proj▼]│
│  ...（其余布局同上）                                                  │
```

### B.2 权限确认弹窗

```
┌──────────────────────────────────────┐
│  ⚠ Permission requested              │
│                                      │
│  Tool      bash                      │
│  Command   npm test                  │
│  Risk      low                       │
│  Reason    Run after editing auth.ts │
│                                      │
│  ▢ Always allow `npm test`           │
│  ▢ Always allow `npm` (any args)     │
│                                      │
│         [Deny]    [Allow]            │
└──────────────────────────────────────┘
```

### B.3 Repointel 状态条

```
┌──────────────────────────────────────────────────────────┐
│ Repointel ● premium-native  warm  cache 73%  daemon ✓   │
│   [mode▼]  [warm]  [open trace]                          │
└──────────────────────────────────────────────────────────┘
```

### B.4 Quick Ask popover（M1）

当前在 Space 内按 ⌘K / Ctrl+K 唤出；系统级全局唤起是未来目标：

```
                                    ┌───────────────────────────────────┐
                                    │  Quick Ask          provider: zhipu│
                                    ├───────────────────────────────────┤
                                    │  > what does `tar xzf -C` do?     │
                                    │                                   │
                                    │  -x  extract                       │
                                    │  -z  gzip-compressed               │
                                    │  -f  read from archive file        │
                                    │  -C  change to directory before    │
                                    │      extracting                    │
                                    │                                   │
                                    │  Example:                          │
                                    │  tar xzf app.tgz -C /opt/app       │
                                    │                                   │
                                    ├───────────────────────────────────┤
                                    │  [Continue in Coder panel]  [Esc ✕]│
                                    └───────────────────────────────────┘

特性：
- 无 session 抽屉、无 tool 调用面板、无文件抽屉
- 失焦自动收起；Esc 销毁记录
- 不写入 ~/.kodax/sessions/
- 想多聊点击 "Continue in Coder panel" → 转 Coder session（此时才落盘）
```

---

> 文档结束。工程边界见 [HLD](HLD.md)，当前实施顺序与 capability gate 见 [FEATURE_LIST.md](FEATURE_LIST.md) 和 [KODAX_CAPABILITY_LEDGER.md](KODAX_CAPABILITY_LEDGER.md)。
