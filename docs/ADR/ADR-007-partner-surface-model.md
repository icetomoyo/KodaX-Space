# ADR-007: Partner Surface Model — 同一 runtime 的画像组合，不等独立内核

- **Status**: Accepted
- **Date**: 2026-06-08
- **Companion**: [ADR-004](ADR-004-panel-model.md)（面板模型）、[ADR-003](ADR-003-kodax-integration-in-process.md)（in-process）、[PRD §2.3](../PRD.md#23-关于-claude-cowork-的对标取舍)、[HLD §9.4](../HLD.md#94-surface-抽象)
- **Partially supersedes**: [HLD §19.1](../HLD.md#191-kodax-partner-接入m2) 的"内核加 Partner profile"叙述

## Context

ADR-004 把 Partner 定为"对标 Claude Cowork 的第二面板，M2 起，紧绑 KodaX Partner 内核"。HLD §19.1 进一步写"KodaX 内核加 Partner profile（不同 system prompt + 工具白名单 + skill 子集），Space 用同一 SDK 起 Partner-flavored client"。

2026-06-08 复核时核了 KodaX 内核与 `@kodax-ai/kodax` SDK，确认：

1. **内核里没有任何"Partner profile / Partner 内核"**——`partner` 只是 agent 包里一处注释词（消息配对 "orphaning its partner"），不是能力。
2. 真正存在的是 `Agent`「画像即数据」类型（`instructions` + `tools` + `reasoning` + `guardrails` + `model`/`provider`）、`createDefaultCodingAgent()`、`runManagedTask()`、`CapabilityProvider` 这些**通用砖**。
3. 但 Space 用的 `runKodaX(options, prompt)` 入口的 `KodaXOptions` 收不下自定义画像（无 `agent`/`systemPrompt`/`allowedTools` 字段）；且历史上自定义 Agent 走"残血 Runner"（无 managed-task harness）。

把 Partner 死绑"等一个不存在、且 Space [不能碰](#)的 KodaX 内核"，会让整个面板被一个虚依赖卡死，违背 *Shell, not engine*。

## Decision

**Partner 不是"等 KodaX 新造的独立内核"，而是 Space 在同一个 KodaX runtime 上组合出来的一个知识工作 surface。**

Partner = 三件套，全部在 Space 侧组装：

1. **Surface spec** —— 工具白名单（`non-bash-subset`，默认无 bash）+ `doc-workspace` 布局 + 文件作用域（任意目录，含非 git）。
2. **Skill packs** —— 一组非编码 skill（总结 / 研究 / 生成 / 抽取转换 / 数据分析 / 代码相关知识工作），复用 Space 已存在的 docx/pdf/pptx/xlsx/deep-research/web 等能力。
3. **Artifact 层** —— 生成物（报告 / slides / 表格 / 文档）作为可预览、可迭代、可导出的一等产物。

**唯一真正需要 KodaX 内核的，是一条通路**：同一引擎能跑一份 Space 自定义的非编码画像，且这份画像拿到与内置 Coder **完全相同的完整 harness**（managed-task / verifier / AMA 升级）。这条通路已写成 SDK 需求转交岸边（见下「依赖」），**但它只阻塞 Partner 的"全 harness 判官"那一层，不阻塞 surface / skill / artifact 三件套先行落地**。

全场景 / 全功能（6 层地图）见 [PRD §2.3](../PRD.md#23-partner-全场景--全功能)，本 ADR 只定架构决策。

## 2026-07-09 Amendment: Workspace-First Working Agent

The original ADR framed Partner as `surface spec + skill packs + artifact layer`. That was directionally useful, but both "skill" and the artifact boundary were over-applied. In v0.1.30 the built-in packs are prompt capability playbooks, not executable SDK Skills, and F114 supersedes the fixed artifact boundary.

Partner is now defined as a workspace-first working agent:

1. **Workspace boundary** - Partner may write directly only inside explicit writable roots: a run output workspace by default, and an opt-in workspace session root when checkpointing and policy allow it.
2. **Delivery registry** - a deliverable is any file or folder Partner creates inside an allowed root. Extension/kind lists are preview affordances, not capability limits.
3. **Checkpointed writes** - workspace-session mutation must be preceded by a local shadow checkpoint, with diff, changed-file summary, rollback, and single-file restore.
4. **Review fallback** - source/config edits, destructive operations, sensitive globs, external writes, and enterprise-restricted paths route through explicit approval or F113 proposals.
5. **Lightweight coding boost** - Partner can use coding capabilities for reading code, summarizing repo context, writing small helper-code deliverables, executing bounded JavaScript transforms/validators through `run_partner_helper`, rendering previews, packaging files, and verifying generated deliverables. It escalates to Coder for implementation, refactors, package/dependency changes, branch/commit/PR flows, or broad codebase mutation.

F109 Office/PDF writers and F113 reviewed file proposals remain valid Partner tools, but they are no longer the ceiling of Partner output. They are modes within the wider working-agent model.

The amendment does not claim Cowork/WorkBuddy parity. v0.1.30 has a local workspace/file foundation; scoped executable Skills, Partner MCP/connectors, browser/computer use, scheduled/remote work, user-visible expert teams, and template-grade Office design remain separate future capabilities. The Partner tool policy intentionally blocks the SDK `skill`, subagent-dispatch, workflow, and MCP mutation surfaces until each has a Partner-scoped authority model.

## 2026-07-29 Amendment: Executable Partner Skills Are Required

The v0.1.30 `skill` suppression was a fail-closed repair, not a permanent product boundary.

The sequence was:

1. v0.1.27 introduced the Partner read/research-oriented tool allowlist while the shared Skills prompt was still injected.
2. The model could therefore see installed Skills, but Partner rejected the SDK `skill` tool used to load them.
3. v0.1.30 resolved that inconsistent advertisement by returning an empty Skills addendum for Partner.
4. Documentation then carried the temporary suppression forward as future capability work.

That choice is superseded. Partner must consume installed KodaX Skills through both explicit user selection and natural-language Auto LLM activation.

The authority model is:

- `skill` is admitted as a capability loader that expands Skill instructions.
- Loading a Skill grants no file, shell, network, connector, MCP, workflow, subagent, or mutation authority.
- Every action requested by the loaded instructions remains independently governed by Partner tool visibility, permission, allowed-root, connector, checkpoint, proposal, rollback, and audit policy.
- Skill dynamic-context execution must use a Partner-aware host policy and permission broker or be explicitly disabled; it must never fall back to unbrokered host execution.
- Skills that cannot run under the current Partner boundary remain discoverable with a truthful compatibility reason rather than being silently hidden or misleadingly advertised.
- Scene shortcuts and prompt templates are a learning and task-entry layer, not a replacement for executable Skills.

F130 is the first required consumer of this amendment. It closes the explicit-versus-automatic Skill gap without turning Partner into Coder or weakening the Partner action boundary.

## Rationale

- **同构于 Quick Ask**：Quick Ask 已经证明"同一 main 进程 runtime、不同临时 KodaXClient 实例"可行（ADR-004）。Partner 只是把这个模式从 transient popover 升级为持久 surface + 自定义画像。
- **历史估计已废弃**：原先“90% 能力已散落存在”的判断混淆了 Coder/SDK 全局能力与 Partner 实际可调用能力。v0.1.30 只按 Partner tool policy、真实输入解析、真实产出验证和 UI 闭环计算已交付范围。
- **解依赖**：把"等内核"缩小为"一条可转交的 SDK 入口需求"，Partner 的进度不再被一个未排期的内核项目绑架。
- **符合 Shell, not engine / 极简且智能**：Space 不引入新执行语义；Partner 的入口可隐式（拖文件 / 非 git 目录自动判定），不强迫用户先理解 Coder vs Partner 概念分野。

## 被否决的方案

| 方案 | 否决理由 |
|---|---|
| 等 KodaX 出独立"Partner 内核"再做 Partner（原 HLD §19.1） | 该内核不存在且未排期；Space 不能碰 KodaX 源码；会把面板无限期卡死 |
| Space 自己 fork 一套非编码 agent runtime | 直接违背 ADR-003（in-process 复用）与 *Shell, not engine*；维护双引擎 |
| 把 Partner 能力塞进 Coder（用 skill 触发，不做独立 surface） | 工具集 / 布局 / 作用域 / 判官目标都不同；硬塞稀释两边体验，违 ADR-004 双面板初衷 |
| **同一 runtime + Space 侧画像组合 + 一条 SDK 全-harness 入口** | ✅ 采纳 |

## Consequences

### 接受
- Partner 的"完整 faithfulness 判官"层依赖 KodaX 交付「自定义画像走全 harness」入口（R1/R2）；交付前该层用 Space 侧 workaround 或降级。
- Space 需新增 Surface 抽象的真实实现（目前是隐式单 surface）、`doc-workspace` 布局、artifact 模型——工作量真实存在，但都内核无关。
- 画像内容（Partner system prompt、工具子集清单）由 Space 维护，需与 KodaX REPL 行为做一致性校验。

### 获得
- Partner 的 surface / prompt capability playbook / artifact-workspace 三件套可先行；可执行 Skills 与连接器必须等待独立的 Partner 权限边界。
- 与 Coder 共用同一 runtime / provider / permission / observability / lineage，零重复。
- 把模糊的"内核依赖"收敛成 3 条精确、可验收的 SDK 需求（R1–R3，见依赖段）；web 引擎彻底从内核依赖里移出，归 Space 自有。

## 依赖（转交 KodaX 的 SDK 需求）

并入 2026-05-21 那份 SDK gap 清单，标「Partner 批次」（共 3 条；web 引擎不在内，见下）：

- **R1（P0，阻塞）** 完整 harness 的自定义画像入口：让 `runManagedTask`/`Runner` 收一个自定义 `Agent`，走与内置 Coder **同一条 substrate 全管线**（managed-task / verifier / AMA），不是残血 Runner。**含确认点**：embedder 经 `extensionRuntime.registerTool` 注册的 in-process 工具，在该全 harness 下能被 agent 调用且受 permission 门控（这是 Space 把有头浏览器作为自有工具注册进来的依据）。
- **R2（P0）** 画像可完整定义：`instructions`（system prompt）必须可覆盖——现 `createDefaultCodingAgent` 的 `Omit<Agent,'name'|'instructions'>` 恰好排除了它。
- **R3（P1）** 工具按能力维度（readonly/mutation/network/shell）声明白名单，替代硬编码工具名 blocklist；同维度标签用于把 Space 注册的浏览器工具识别为 `network`、纳入 Partner 白名单。

**Web 引擎不找 KodaX**：有头浏览器需显示面，内核结构上托不了；Space 是 Electron、自带 Chromium，**把有头浏览器实现成 in-process 自有工具，直接 `registerTool` 注册，不走 MCP、不劳内核**（MCP 仅作 fallback）。`toolWebFetch` 保留作 CLI 的 headless 轻量档。由此给 *Shell, not engine* 补一条边界：**凡结构上需 GUI / 显示面的能力（有头浏览器、屏幕、原生文件选择器）归壳，不归内核。**

## Reconsider When

- KodaX 决定**官方提供** Partner 内置画像（而非只提供"跑任意画像"的通路）——此时 Space 改为消费官方画像，本 ADR 的"Space 侧组合"退为可选。
- R1/R2 长期无法交付——Partner 退化为"Coder 内的 skill 集合 + 富预览"，撤掉独立 surface（与 ADR-004 退化条款衔接）。
- 出现第三类 surface（如 BI / 数据 agent）——把本 ADR 的"三件套"抽象为通用 Surface 框架。

## References

- [ADR-004 面板模型](ADR-004-panel-model.md)
- [ADR-003 in-process 集成](ADR-003-kodax-integration-in-process.md)
- [PRD §2.3 Partner 全场景](../PRD.md)
- [HLD §9.4 Surface 抽象](../HLD.md)
- SDK 调研证据：`Agent` 类型（`types.d-D2RNa5Y7.d.ts:115`）、`createDefaultCodingAgent`（`sdk-coding.d.ts:2917`）、`KodaXOptions`（无画像字段）、`toolWebFetch/toolWebSearch`（`sdk-coding.d.ts:452-454`）、`CapabilityProvider`（`capability.d:12`）
