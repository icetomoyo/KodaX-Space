# KodaX Space 高层设计（HLD）

> **2026-08-11 v0.1.39 发布基线**：当前 Runtime 基线为精确 npm Registry KodaX `0.7.85`；Space 要求 `actorSettlementConvergence:1` 与 `sessionEventJournal:1`，保留完整 Session journal cursor，并在 durable effect convergence 后才释放未知 Run 的路由。v0.1.38 保留为历史正式产品基线。
> `RuntimeHostAdapter` 要求 `managedRunDurability:1`，使 accepted prompt 与 completed turn
> 在事件发布前已成为 canonical managed Run；Space 仅用 returned `runId`/`turnId` 关联 UI
> optimistic state 和 history，不复制持久化职责。未设置 Auto timeout 时，SDK 默认 45 秒首次、90 秒重试。

> Last updated: 2026-08-11
> Status: 核心架构决策仍有效；当前正式发布基线为 KodaX Space 0.1.39（package 0.1.39）/ npm 正式发布的精确 KodaX 0.7.85。中间方案与否决理由见 [ADR/](ADR/)；当前能力边界见 [KODAX_CAPABILITY_LEDGER.md](KODAX_CAPABILITY_LEDGER.md)。
> Companion doc: [PRD](PRD.md)

> **0.1.30 增量**：Electron main 继续拥有特权边界，并新增一个持久、协议中立的 External Agent Executor Plane。Renderer 仅通过 zod IPC 获取脱敏 Registration/Descriptor/Task/Event 投影；管理入口仅接受主应用窗口，任务创建从 main-owned live Session 派生项目/父任务归属，读取与干预均复核任务所属 Session。实时 Session 与 Workflow 共用同一 KodaX 0.7.67 plane。Reference Executor 已接通；v0.1.32 起，Runtime 配置的 A2A 由 KodaX 0.7.76 Coder daemon 持有并按能力协商开放，MCP Tasks/受治理 HTTP 仍按 Runtime capability 门控。Partner 自 0.1.30 起已启用 workspace-first Outputs 与 checkpointed writes。
>
> **2026-07-12 架构重置**：`v0.1.31` 起以 `RuntimeHostAdapter -> @kodax-ai/kodax/runtime` 作为长期 host boundary，先采用 embedded inline facade，再以 capability negotiation 决定 Worker/daemon。旧 `KodaXHost/RealSession/KodaXClient` 路径是迁移基线，不再是长期目标。当前路线见 [FEATURE_LIST.md](FEATURE_LIST.md)。
>
> **2026-07-13 `v0.1.32` 架构边界（2026-07-19 已实现）**：F121 只把 Coder 迁入 profile-scoped shared daemon，使 Space、CLI 与 IDE 共享同一 session/run/live-state truth；Partner 明确保留 Space-owned embedded inline。Space 通过 surface router/adapter 拆分 owner，不再用 Partner 的进程内 callback/tool 约束阻塞 Coder daemon。完整合同、迁移与回滚规则见 [v0.1.32](features/v0.1.32.md)。
>
> **2026-07-21 `0.7.74` 集成（2026-07-23 已切正式包）**：根与 Desktop workspace 锁定精确版本，lockfile 现匹配 npm Registry 正式 SRI。Coder daemon 要求 Runtime-owned Auto LLM guardrail v3、公开的有效设置/时序契约、工作区编辑确定性规则、缺失 classifier model 的 prompt-free 本地拒绝、统一 Actor/Turn、Learning Center、共享设置、精确 `grantSuggestions`、interrupt input 和 daemon management 能力；缺少能力时 fail closed，不回退到隐藏 inline owner。AMAW 已并入 AMA，Workflow 只由显式命令或 KodaX 强信号策略触发。
>
> **2026-07-23 `0.7.74` 正式发布同步**：lockfile 精确绑定官方 Registry URL/SRI，安装目录的 133 个发布文件与 Registry tarball 全部一致。Coder daemon 继续要求 `contextCompaction:3`、`transcriptPaging:1` 和 `transcriptSearch:1`；模型侧 `wait_agent` 是 mailbox yield，UI/SDK 继续消费 Actor progress telemetry。idle-yield 用户提示、未确认 root completion、Goal 常驻工具和 root live-only 投影均由 KodaX Runtime 契约持有，Space 只记录/投影，不创建第二套协调状态机。正式版在不提升 capability 版本的前提下补齐精确 checkpoint/命令式 compaction lineage、PowerShell 方括号路径升级确认、完整交互式 auto-resume、确定性 Auto 设置写入，以及 durable interrupt delivery 失败后的队列保留。
>
> **2026-07-25 `0.7.76` 发布对齐**：根与 Desktop workspace 更新到官方 Registry 包。Runtime 保留 Sidecar 可选后续工作/预算终态修正和 Windows GUI host 非交互子进程隐藏，并将 Kimi Code 默认模型改为直连 `k3-256k`；Space 仍保持 owner split，并在 managed-task `verifying/completed` 投影上本地拒绝 interrupt，弥补 Runtime 关闭准入晚于最后 root drain boundary 的剩余窗口。
>
> **2026-07-26 上下文与用量投影维护（v0.1.33）**：Space 启用 KodaX `contextDiagnostics`，把不含正文的根上下文分类计数和 hash-only Provider cache 诊断投影到受校验 IPC。Renderer 用最终自动压缩阈值计算主 Agent 有效窗口，把模型最大上下文与阈值分开，并以独立累计表统计根/子 Agent 的 Provider usage。输出容量预留不属于活动输入，也不再作为压缩前空间展示。
>
> **2026-07-27 `0.7.77` npm 正式包对齐（v0.1.33）**：根与 Desktop workspace 已锁定同一 Registry tarball 并把最低 daemon 版本提升到 0.7.77。Runtime 现导出 root/child、retry、fallback、repair、workflow digest 与 compaction summary 的完成态物理请求诊断；Space 按 `requestId` 去重累计，保留有界重放 ID，并只在诊断尚未激活时回退 `iteration_end.usage`。完整 request-envelope/ephemeral-suffix/cache-affinity 哈希通过无正文 IPC，interrupt finalization 完全回归 Runtime owner。KodaX 还为逻辑 Session、retry、fallback、resume 与 compaction 提供稳定的 Provider 缓存亲和键，并归一化 CLI bridge 的缓存读取/写入用量；自定义兼容端点须由用户显式启用。
>
> **2026-07-26 全局按钮交互维护（v0.1.33）**：Renderer 以 Session Token 控件的柔和扫光与边缘亮起为视觉基准，在 `body` 级交互层统一普通、语义、弹层和键盘焦点反馈。语义色继续来自既有 token；全宽列表降低强度；Windows 窗口控件、Monaco、xterm、disabled 与显式 opt-out 保持各自契约。该层仅绘制伪元素，不改变布局、业务 action、权限或 Runtime owner。
>
> **2026-07-27 F140 与 Shell 生命周期收口（v0.1.33）**：Windows 用户驱动的主窗口关闭由 Electron main 串行决策为每次询问、保留托盘/Runtime，或进入 F136 安全彻底退出；记住选择只写入 Space 设置，显式托盘命令、app quit、OS session end 与无托盘 fallback 不进入该策略。Terminal Shell 设置由 main 解析登录环境，并为 PTY 与 Coder 命令工具提供同一脱敏执行环境。
>
> **2026-07-28 KodaX integration 配置与 self-manual 收口（v0.1.33）**：KodaX 0.7.77 的核心 `config.json` 与 `integrations/mcp.json`、`integrations/extensions.json`、`integrations/a2a.json` 已按 owner 分离。Space 的 MCP Manager、项目 MCP 兼容层、Settings 概览/迁移入口和 SDK filesystem Extension discovery 全部消费公开 reader/CRUD/migration 契约，并保留旧 `config.json#mcpServers`/`#extensions` 的只读迁移回退。`kodax_manual` 不再以 `baseTopics: []` 清空 SDK 机制手册，而是在 ESM-only `/coding` 子路径动态加载后，用 SDK 发布的底层能力主题清单做基线；同名 Space 主题动态合成当前安装 `MANUAL_REGISTRY` 的原始正文、aliases 和 sources。
>
> **2026-07-28 v0.1.33 撤回后修正架构增量**：F141 在 Settings 提供推荐 Daemon 与 Embedded 兼容 owner 的客户选择，但不提供任意 endpoint、混合 owner 或 live failover。Electron main 以一个全局 admission 边界串行化所有触碰 Coder Runtime 的 Session、Slash、Workflow、External Agent、MCP 和 Runtime-affecting Settings 操作；切换还会阻止 ManagedSession、running/paused Workflow、非终态 External Agent task、permission/AskUser 和待派发 queue。持久化模式是启动真理，启动前 reconciliation 会修复 `daemon preference + unowned inline policy`，对 active/unreadable inline owner fail closed。正式包继续精确使用 npm Registry KodaX 0.7.77，并通过依赖闭包、native SQLite load 和真实 packaged boot。
>
> **2026-07-28 跨平台 daemon 退出修正**：用户/OS 真正退出统一关闭 Coder admission、排空已准入入口并读取 daemon preflight；blocker 会恢复窗口而不是退出。断开 Space 后只有 daemon stop 返回 stopped/missing 才允许 Electron 消失，失败或超时自动 relaunch 可见 Space。KodaX 的专用 `daemonOrphanExit:1` 能力只为 Space 新拉起的 detached daemon 启用 30 秒 orphan idle-exit：最后客户端异常断开且 work 空闲时自停，活动任务进入终态后重试，其他客户端始终阻止回收。该能力按 Runtime 事实协商，不通过 KodaX 版本号或 Auto-mode guardrail 版本推断。
>
> **2026-07-29 KodaX 0.7.78 正式包接入**：当前源码精确锁定官方 Registry bytes，并把 daemon 门禁提升为 exclusive Actor owner、`daemonOrphanExit:1`、`skillLearningLoop:1`、`integrationConfigResilience:1` 与 Auto guardrail v4。Runtime management 的 MCP/A2A/Extension health 经有界 schema 投影到 Settings 和诊断导出；invalid config 继续使用 last-known-good，revision 冲突 fail closed。Auto side-query 只投影 provider/model/耗时/大小/重试/阶段元数据，不传 prompt/response。公开 `/sandbox` facade 经过启动与打包 probe，`tool.sandbox` 只更新活动工具的结构化 containment 事实，不复制 transcript，也不把 command sandbox 误称为完整 F138。
>
> **2026-07-30 v0.1.34 安全发布边界**：所有普通退出在 Electron main 的统一 coordinator 内同步关闭 Coder admission、排空已准入操作、检查 Space-local 与 daemon work，并在仍有可见控制面时执行 revision-fenced stop；失败、blocker、超时、不可读或 late-owner race 恢复/重启 Space。主进程还统一持有 boot/shutdown overlay 和 renderer generation gate，消除第二套 renderer loading shell。Space MCP Manager 以完整 candidate 构建实现事务替换；正式包把 ASRT/helper 依赖移到物理 `resources/node_modules` 并由 package smoke 运行 sandbox doctor。历史 replay 按规范位置保持已完成 interrupt 回复早于下一条用户 query。Issue 133 的 macOS/Linux process acceptance 与异步 cleanup retry/verification 缺口、F138 完整 OS 隔离仍明确未完成。
>
> **2026-07-23 F135 builtin 分发**：Space 通过公开 Skill plugin 注册接口加载安装包外置的 `frontend-slides` 与 `huashu-design`，来源 revision、许可证、补丁和逐文件哈希全部可审计；`huashu-design` 默认去除推广水印/签名。本机 `pdf`/`pptx`/`xlsx`/`docx` skill 的当前许可不允许再分发，因此不进入安装包。
>
> **0.7.68 集成**：KodaX top-level managed coding path 自有 FEATURE_260 Memory Agent 生命周期，复用 F228 durable governance。Space 验证正式 `/experimental-memory` 契约、保留 metadata-only 回调诊断并继续拥有 UI 投影；不创建第二个 Memory Agent/存储/推广策略。完整 F117 仍受 activation/rollback 和桌面 query/action contract 门控。

---

## 0. 中文导读

KodaX Space 不是新 agent，而是**复用 KodaX 内核的 Electron 桌面客户端**。架构 7 条核心判断：

1. **进程模型** = Electron 标准（main / preload / renderer）加 profile-scoped KodaX Runtime daemon；`v0.1.34` 的 Coder owner 默认位于 daemon，Partner owner 保留在 Electron main embedded inline。
2. **与 KodaX 的边界** = **TypeScript Runtime/SDK public contracts**（不是 ACP）。Main 以 `@kodax-ai/kodax/runtime` 作为长期 host facade；Coder 使用 transport-safe observe/control/services，Partner 使用 embedded inline adapter；Space-owned zod IPC 仍是 renderer 唯一边界。决策基线见 [ADR-003](ADR/ADR-003-kodax-integration-in-process.md)、[v0.1.31](features/v0.1.31.md) 和 [v0.1.32](features/v0.1.32.md)。
3. **Shell 选择** = Electron。理由见 [ADR-001](ADR/ADR-001-shell-electron.md)（含 OpenCode 反向迁移实证）。
4. **Native 集成** = 仅在 profile 证明 JS/Worker 路径存在实质热瓶颈时引入 NAPI-RS；历史 native-helper 提案已移入 watchlist。见 [ADR-002](ADR/ADR-002-rust-integration-napi.md)。
5. **面板模型** = 双面板（Code / Partner）+ Quick Ask popover。无独立 Chat 面板。见 [ADR-004](ADR/ADR-004-panel-model.md)。
6. **数据持久层** = 复用 KodaX 已有的 `~/.kodax/`，Space UI 偏好位于 `~/.kodax/space/`；v0.1.32 shared daemon 状态/journal 位于 `<profile-root>/runtime/`（默认 `~/.kodax/runtime/`）。v0.1.31 embedded Runtime 的历史 journal 可能仍位于 `<profile-root>/.kodax/runtime/`，但不是当前 daemon 真理源。Quick Ask 的最终目标是不落盘；当前仍使用临时 plan-mode session，并在关闭时 best-effort 清理。
7. **CLI ↔ Space session 协同** = Coder 通过 shared daemon 的 atomic live snapshot + ordered events 实时协同；handoff 仍用于显式上下文连续性。两者都不走 ACP，Partner 不进入该共享路径。

**ACP 在 KodaX 生态的定位**：KodaX 内核继续维护 ACP server，服务**第三方 host**（Zed / Claude Code Desktop / 未来 IDE）。Space 是 KodaX 的 first-party UI，**不通过 ACP 接 KodaX**。

---

## 1. 系统总览

### 1.1 全景图

下图是当前 `v0.1.33` F121 拓扑；`v0.1.31` 的双 surface inline owner 仅作为历史兼容基线保留。

```text
┌──────────────────────────────────────────────────────────────────┐
│  KodaX Space (Electron app)                                       │
│                                                                   │
│  ┌──────────────────────┐    ┌──────────────────────────────────┐ │
│  │ Renderer (React)     │◄──►│ Main (Node)                      │ │
│  │  • UI / state        │    │  • BrowserWindow / OS API        │ │
│  │  • Monaco / xterm    │    │  • IPC handlers (zod-validated)  │ │
│  │  • Zustand store     │    │  • SurfaceRuntimeRouter:         │ │
│  │  • 仅 import KodaX   │    │     - CoderDaemonAdapter         │ │
│  │    类型 + 常量       │    │     - PartnerInlineAdapter       │ │
│  └──────────────────────┘    │  • Space policy/audit/artifacts  │ │
│            ▲                 │  • credential/host-tool bridges  │ │
│            │ Electron IPC    │  • Native modules only by profile│ │
│            │ (contextBridge) │                                  │ │
│            ▼                 │                                  │ │
│  │ Preload (sandbox)    │    │  • Keychain / auto-update        │ │
│  └──────────────────────┘    └────────────┬─────────────────────┘ │
└──────────────────────────────────────────┬─┴─────────────────────┘
                                           │ local authenticated Runtime transport
                                           ▼
                                  ┌──────────────────────┐
                                  │ KodaX Runtime daemon │ ← CLI / IDE clients
                                  │ Coder owner/profile  │
                                  └──────────┬───────────┘
                                             ▼
                                      LLM / Coder MCP

Space main separately owns Partner inline Runtime, Partner tools/MCP,
Space Artifact/Control handlers, keychain, BrowserWindow and OS integration.
```

### 1.2 三条不可破坏约束

1. **No-LLM-in-renderer**：renderer 进程绝不直接调 LLM SDK 或任何 KodaX runtime；renderer 只 import 类型/常量
2. **No-tool-execution-in-renderer**：工具只在受信任的 Coder daemon 或 Space main（Partner/Space host tool）执行
3. **No-duplicate-session-truth**：Coder live truth 只在 daemon；Partner live truth 只在 Space inline owner。session 持久化仍由 KodaX 内核负责，Space 仅追加 UI 偏好与 Space-owned data

---

## 2. 进程模型

### 2.1 进程列表

| 进程                 | 角色                   | 持久                  | 内含                                                                         |
| -------------------- | ---------------------- | --------------------- | ---------------------------------------------------------------------------- |
| `space-main`         | Electron main（Node）  | 应用/Windows 托盘周期 | IPC、Coder daemon client、Partner inline Runtime、Space host tools、后台托盘 |
| `space-preload`      | Electron preload       | 每窗口                | 安全桥（contextBridge）                                                      |
| `space-renderer`     | React UI               | 每窗口                | UI only，无 KodaX runtime                                                    |
| `quick-ask-window`   | 独立 BrowserWindow     | 按需                  | Quick Ask renderer；Coder session 由 daemon 拥有                             |
| KodaX Runtime daemon | Coder Runtime owner    | profile 周期          | Coder session/run/live truth；供 Space/CLI/IDE 共享                          |
| MCP server children  | MCP server             | owner 按需 spawn      | Coder 由 daemon 管；Partner/Space residual 由 main 管                        |
| Repointel daemon     | 系统级（用户提前安装） | 系统周期              | KodaX 内核已通过 loopback HTTP 接，Space 无关                                |

### 2.2 关键差别（与 sidecar+ACP 模型对比）

- **没有独立 kodax-acp 子进程**——F121 的 Coder daemon 使用 KodaX Runtime transport；Partner owner 仍处于 Electron main 信任边界
- **没有 stdio + ACP 协议层**——main 通过公开 Runtime facade 接入 daemon；renderer 仍只看 Space zod IPC
- **MCP lifecycle 按 surface 单 owner**——Coder children 由 daemon 管；Partner/Space-owned residual 才由 Space MCP Manager 管
- **Repointel daemon 是独立系统服务**——KodaX 内核连接它，Space 透过 KodaX 看其状态
- **Windows 可配置关闭行为仍由 main 决策**——F140 在可用托盘下把用户关闭串行为 ask/minimize-to-tray/quit-completely；BrowserWindow/renderer 按窗口周期释放，Electron main 作为可见托盘 owner 继续持有 Runtime client。`v0.1.33` 没有独立 tray helper，因此不声称关闭窗口后 main 也已退出

### 2.3 Electron 安全基线

| 项                            | 值                                                          |
| ----------------------------- | ----------------------------------------------------------- |
| `contextIsolation`            | `true`                                                      |
| `nodeIntegration`             | `false`                                                     |
| `sandbox` (renderer)          | `true`                                                      |
| `webSecurity`                 | `true`                                                      |
| `allowRunningInsecureContent` | `false`                                                     |
| 远程模块                      | 关闭                                                        |
| CSP（renderer）               | `default-src 'self'; script-src 'self'; connect-src 'self'` |
| preload                       | 仅暴露白名单 IPC channel                                    |

---

## 3. 仓库结构

```
KodaX-Space/
├── apps/
│   └── desktop/
│       ├── electron/                ← Electron main + preload
│       │   ├── main.ts              ← BrowserWindow, lifecycle
│       │   ├── preload.ts           ← contextBridge
│       │   ├── kodax/runtime-host-adapter.ts ← inline Runtime owner、能力快照、runId/abort、回滚选择
│       │   ├── kodax/host.ts        ← Space session registry 与兼容投影
│       │   ├── skill/space-builtins.ts ← Space builtin 注册、路径解析与启动隔离
│       │   ├── ipc/                 ← zod-validated IPC handlers
│       │   │   ├── session.ts
│       │   │   ├── permission.ts
│       │   │   ├── mcp.ts
│       │   │   └── provider.ts
│       │   ├── providers/keychain.ts← OS keychain (@napi-rs/keyring)
│       │   ├── auto-update.ts
│       │   └── menus.ts
│       └── renderer/                ← React renderer
│           ├── main.tsx
│           ├── App.tsx
│           ├── features/
│           │   ├── session/         ← Coder 对话/消息/工具视图
│           │   ├── partner/         ← 已发布 Partner workbench/surface
│           │   ├── quick-ask/       ← 已发布 Quick Ask popover
│           │   ├── permission/
│           │   ├── provider/
│           │   ├── mcp/
│           │   ├── repointel/
│           │   ├── session/
│           │   └── terminal/
│           ├── components/
│           ├── stores/              ← Zustand
│           └── theme/
├── packages/
│   ├── space-ipc-schema/            ← zod schemas (renderer↔main 通信契约)
│   └── space-ui-kit/                ← design system
├── resources/
│   ├── builtin-skills/               ← 生成的可再分发 builtin 快照
│   ├── builtin-skill-patches/        ← Space 审查补丁
│   ├── builtin-skills.sources.json   ← 上游/许可声明
│   └── builtin-skills.lock.json      ← revision + 逐文件完整性
├── scripts/
└── docs/
    ├── PRD.md
    ├── HLD.md   ← 本文档
    └── ADR/
```

---

## 4. KodaX 集成

### 4.1 Runtime Host Adapter

```typescript
import path from 'node:path';
import { createKodaXRuntime, type KodaXRuntime } from '@kodax-ai/kodax/runtime';

const runtime: KodaXRuntime = await createKodaXRuntime({
  mode: 'embedded',
  isolation: 'inline', // v0.1.31 migration baseline
  sessionsDir: path.join(profileRoot, 'sessions'),
  clientInfo: { name: 'kodax-space', version: SPACE_VERSION },
  capabilities: {
    richEvents: true,
    permissionPrompts: true,
    commandCatalog: true,
    skillCatalog: true,
    artifactUpload: true,
    contextDiagnostics: true,
  },
});
```

`RuntimeHostAdapter` wraps the public facade and presents a bounded Space-owned compatibility surface. The corrected `v0.1.33` release coordinates:

- Coder daemon initialization/identity, capability validation, subscription readiness and detach-only close;
- Coder session/run/live projection, transcript, compact, fork, rewind, queue and shared settings routes;
- Runtime interaction, Workflow read/control, Learning, catalog/MCP and configured Agent Actor/Turn services;
- compaction v3 durability, revision-bound transcript paging/search, root/child history ownership,
  privacy-safe root context-budget snapshots, and Provider usage/cache diagnostics;
- mailbox-driven model coordination while Space keeps Actor progress on the UI/SDK telemetry path;
- Partner inline initialization plus the customer-selectable, restart-bound Coder Daemon/Embedded
  owner boundary.

The adapter does **not** claim every public Runtime service as a migrated Space route. For Coder, Runtime owns sessions/runs/settings/interactions, Workflow observation/control, Learning operations, catalog discovery, MCP tool discovery/reload, and configured External Agent Actor/Turns. Space remains authoritative for renderer projection, Partner tools/profile/policy, MCP process lifecycle/logs, Workflow library/start/admin, artifacts, and the Reference Agent executor-plane store. These residual paths are reported as host providers, not Runtime-native support.

The published `v0.1.33` default attaches Coder to the profile daemon and keeps Partner inline
because Partner injects process-local tools, profiles, callbacks and policy. F141 exposes only the
closed `daemon | embedded` Coder choice. It closes a main-process admission boundary, drains
already-entered Runtime operations, blocks ManagedSession, running/paused Workflow, non-terminal
External Agent, permission/AskUser and queued work, converts owner policy, persists the preference,
and restarts. Startup reconciles a persisted daemon preference with an unowned inline policy before
Runtime connection; an active or unreadable inline owner fails closed. Missing required Coder
capability never creates a hidden owner, and no arbitrary Runtime endpoint, mixed-owner preference,
or live failover is added.

On Windows, F136 keeps the adapter connection in the lightweight Electron main
process after the last BrowserWindow is destroyed. Tray activation recreates a
window against the same main-process services. **Quit Space, keep Runtime**
performs detach-only close; **Complete exit** inspects daemon management,
disconnects Space, and invokes the published CLI stop path only when Runtime's
idle/no-peer safety gate allows it. A same-version stale daemon may be replaced
through the same fail-closed gate. Tray creation failure restores ordinary
quit-on-close behavior so no invisible owner remains.

### 4.2 Session and run lifecycle

```typescript
await runtimeHostAdapter.ensureSession({
  sessionId,
  projectRoot,
  surface,
  ephemeral,
});

const run = await runtimeHostAdapter.startManagedRun({
  sessionId,
  prompt: userPrompt,
  mode: 'managed_task',
  permissionBroker: 'client',
  options: effectiveSpaceOptions, // existing Partner/permission/events callbacks
});

const outcome = await run.result;
```

Coder rich events are reduced into one bounded main-process live projection and pushed through Space IPC with cursor/gap recovery; the renderer never consumes the raw Runtime stream. Partner retains the existing callback translator. Both paths normalize completion/failure/cancellation into one terminal UI outcome.

Permission and AskUser queues remain durable across Session switches, but renderer presentation is
Session-scoped: foreground modals select only the active Session's requests. Sidebar attention is a
separate projection that prioritizes the current Session and then every background Session waiting
for a human before applying the bounded list cap. `awaiting_user` outranks transient run/error frames,
and answering one request never consumes another Session's queue entry.

Session transcript persistence remains KodaX-owned. Before large compaction evicts raw context, compaction v3 durably commits the exact lineage; the canonical producer checkpoint bytes, recovery guidance, first-kept pointer, and post-compact attachments remain on one active path, while legacy suffix-free checkpoints remain readable. Space consumes revision-bound pages/chunks/search and never lets child or live-only state replace the root transcript projection. Model `wait_agent` and SDK `runtime.agents.wait()` deliberately have different semantics: the first waits for mailbox/user/interruption/timeout control signals, while the second remains event telemetry for UI and diagnostics.

Context pressure and cumulative usage deliberately use separate derived stores:

- `tokensBySession` holds only the accepted root-context count/revision used by the context gauge.
- `contextBudgetBySession` holds the latest matching root `context_budget_snapshot`. The IPC payload
  contains category counts and policy facts, never prompt/message/tool bodies.
- `sessionTokenUsageBySession` sums Provider-reported physical calls attributed to the Session,
  including child Agents. On 0.7.77, completed `provider_cache_diagnostic` events are authoritative
  and deduplicated by request ID; `iteration_end.usage` is only the legacy/mock fallback before
  diagnostics activate. Cache-read and cache-write values remain input subsets.
- `providerCacheDiagnosticBySession` holds only the latest completed root diagnostic with bounded
  request identity hashes, counts, Provider/Model facts, and usage.

The effective context denominator is the final automatic-compaction threshold carried with the
resolved model-policy snapshot. Provider root token count is authoritative; a context-budget
fallback subtracts reserved response capacity because that capacity is not active input. Model
maximum context remains a separate capability fact. Cumulative usage is locally persisted across a
renderer restart and deleted with its Session; it is a UI continuity cache, not a Provider billing
ledger.

Space stores UI preferences, compatibility projections/caches, Space-only session settings, Partner artifacts/KB/deliveries/policy records, and correlation metadata only where those are explicitly Space responsibilities.

### 4.3 Runtime failure and degradation

| Failure                                 | Handling                                                                                                                                                                                                                                                                                     |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Missing Runtime capability              | Fail closed; hide/disable the action and expose a redacted reason in capability health/diagnostics.                                                                                                                                                                                          |
| LLM/provider network error              | KodaX owns retry/recovery semantics; Space renders structured state/action.                                                                                                                                                                                                                  |
| Invalid MCP/A2A/Extension configuration | Space reports the SDK/Runtime validation error and identifies the authoritative split file without deleting, rewriting, or silently resetting user configuration. The user repairs or migrates the named file; inbound A2A authority changes may still require the Runtime owner to restart. |
| Coder daemon unavailable                | Fail Coder closed with a redacted diagnostic; never silently replay or downgrade accepted work to inline.                                                                                                                                                                                    |
| Main process crash                      | On restart, recover KodaX sessions and Space-owned durable stores, then reconcile persisted Coder mode with owner policy before Runtime connection; do not claim cross-process Workflow replay.                                                                                              |
| Long-session/context pressure           | Consume Runtime context-budget/compaction events; measure against the final effective threshold and do not add a second policy.                                                                                                                                                              |
| Missing Provider usage fields           | Show unavailable cache/usage categories as unknown; never estimate billing or merge diagnostic duplicates.                                                                                                                                                                                   |
| Stale same-version daemon               | Inspect advertised capabilities; retire and reconnect only when no work, pending interaction, or other client remains.                                                                                                                                                                       |
| Windows tray unavailable                | Route last-window close through the same complete-exit gate; daemon stop must be confirmed or a visible Space surface is restored.                                                                                                                                                           |
| macOS Cmd+Q / Linux last-window exit    | Close Coder admission, block on active work/other clients, then stop daemon; stop failure relaunches Space instead of leaving an invisible daemon.                                                                                                                                           |
| Space crash / SIGKILL                   | A Space-started daemon advertising `daemonOrphanExit:1` waits 30 seconds after the last client disconnects, preserves active work/other clients, and self-stops once idle.                                                                                                                   |

### 4.4 ACP 与 Space 的关系

**Space 不用 ACP**。KodaX 内核的 ACP server (`src/acp_server.ts`) 继续维护，但服务对象是：

- Zed editor
- Claude Code Desktop
- 未来其他第三方 IDE / 桌面 host

KodaX ACP 演进（如新增 notification / endpoint）对 Space **没有直接影响**——Space 是 SDK 消费者，跟 SDK 走，不跟 ACP 走。

---

## 5. 复用 KodaX SDK

### 5.1 包级用法

| Public export             | Main 进程                                                                                  | Renderer                        |
| ------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------- |
| `@kodax-ai/kodax/runtime` | ✅ F116 长期 host boundary                                                                 | ❌                              |
| `@kodax-ai/kodax/coding`  | ✅ Space-owned tools/profile integration and compatibility bridge                          | 仅类型，且应尽量经 Space schema |
| `@kodax-ai/kodax/agent`   | ✅ Agent/Profile/External Agent public contracts                                           | 仅安全 DTO 类型                 |
| `@kodax-ai/kodax/llm`     | ✅ provider/capability utilities                                                           | 仅安全类型/静态 metadata        |
| `@kodax-ai/kodax/skills`  | ✅ daemon-first Coder discovery；install/invoke 与 Partner residual 留 Space host provider | ❌ runtime                      |
| `@kodax-ai/kodax/mcp`     | ✅ Coder tool discovery/reload 同步 daemon；进程/日志与 Partner residual 留 main           | ❌                              |
| `@kodax-ai/kodax/session` | ✅ persisted-session utilities where Runtime lacks an equivalent                           | ❌                              |
| `@kodax-ai/kodax/repl`    | ❌ terminal UI only                                                                        | ❌                              |

Space pins the root package and uses its documented public subpath exports. Internal workspace-package paths and generated chunk filenames are not contracts.

### 5.2 SDK 拉入方式

- **Release/CI**：exact `@kodax-ai/kodax` dependency and lockfile; normal releases require the Registry. Pre-release validation may use a repository-vendored, versioned tgz pinned by lockfile SRI, but only through the explicit local-test packaging entry point. Packaging verifies the locked physical package and required Worker/native sidecars.
- **同仓开发**：`npm run link:kodax` links the adjacent checkout temporarily; release checks must prove no source link remains.
- **Contract policy**：capability negotiation and compatibility probes determine support. Version comparisons may select compatibility code but may not invent a capability.

### 5.3 CI 不变量

允许：

- ✅ `space-main` imports documented `@kodax-ai/kodax/*` public exports
- ✅ `space-renderer` imports only erased types or explicitly reviewed static metadata; preferred UI contracts come from `space-ipc-schema`

禁止：

- ❌ `space-renderer` 的 bundle 含 `@anthropic-ai/sdk` / `openai` / 任何 LLM SDK runtime
- ❌ `space-renderer` bundle contains Runtime/KodaXClient/tool execution code
- ❌ Space 任意进程含 KodaX 内部 coding tool 实现的 fork

CI 加 `depcheck` + `ts-prune` + 自定义 ESLint 规则（`no-restricted-imports`）阻断。

---

## 6. MCP / Connector / Skill / 扩展生态

### 6.1 MCP

KodaX 生态已有 MCP 能力。`v0.1.33` 按公开服务拆分所有权：Coder 的 tool discovery 与 reload 同步 daemon；Space MCP Manager 继续管理 server 子进程、状态和日志，并服务 Partner/明确 residual。Space 的角色：

- UI 层提供 MCP server 列表、启停开关、`.mcpb` 一键安装
- 用户配置读写 `~/.kodax/integrations/mcp.json`（严格 `version: 1` + `servers`），与 CLI/REPL/SDK 共享；项目兼容层使用 `<project>/.kodax/integrations/mcp.json`，项目同名 server 覆盖用户声明
- 旧 `config.json#mcpServers` 只由 SDK reader 作只读迁移回退；首次 SDK CRUD 会把旧条目 staged 到独立文件，新代码不再手写根配置
- Settings 通过受校验 IPC 调用 SDK migration plan/apply；apply 固定 `cleanupLegacy: false`，只创建缺失文件，之后走既有 MCP reload/Extension runtime invalidation 边界
- server start/stop/logs 继续由 Space main 管理；Coder `tools/reload` 优先走 daemon，并在不可用时保持明确的 host-provider/failure 语义

### 6.2 `.mcpb` Desktop Extension

`.mcpb` 安装/文件关联/拖放已发布。Space main 验证 manifest、解包边界和注册状态，renderer 仅显示脱敏结果。兼容性以 fixture/smoke 证明为准，不宣称所有第三方包 100% 可用。

### 6.3 SDK filesystem Extensions 与 A2A

- `~/.kodax/integrations/extensions.json` 是严格 `version: 1` + `paths` 文档。Space 通过 SDK reader 合并默认 `~/.kodax/extensions` discovery 与受管理 paths，再按 entrypoint 去重；加载进程内代码仍受 `KODAX_SPACE_ENABLE_SDK_EXTENSIONS=1` 显式 opt-in 约束。
- `~/.kodax/integrations/a2a.json` 是 Runtime-owned A2A 配置。Space 只消费 daemon 的版本化 registration/dispatchability 与 Actor/Turn 投影，不复制 A2A migration/auth/resource-server owner。
- Settings 会展示同一 SDK dry-run plan 并提供迁移按钮；`kodax integrations migrate` / `--apply` 是等价 CLI 路径。两者都不会覆盖已有目标，Space 也不会自动清理旧字段；`--cleanup-legacy` 只能在新文件验证后显式执行。

### 6.4 Connector foundation（F096）

Connector 不是 “OAuth-flavored MCP” 的同义词。F096 定义 provider-specific adapter + shared catalog/auth/read snapshot/provenance/revocation boundary：

- token/credential 只进 OS credential store；renderer/model/KB/log 不接触 secret；
- OAuth/device/callback flow 由 main 受信任边界处理；
- read snapshot 是 immutable/cited source；refresh 产生新版本；
- Connector `v1` 不开放 send/comment/merge/PR 等写动作；
- MCP、browser、Connector 可以互补，但三者拥有不同 lifecycle/permission/audit contract。

### 6.5 Skill

Skill 继续通过 KodaX public Skill API 与 Space compatibility bridge 管理；F116 不迁移 Runtime catalog：

- Skill 发现路径：`~/.kodax/skills/`、`<project>/.kodax/skills/`、Space 内置；用户/项目同名项保持 KodaX 既有优先级，不修改安装包内容
- UI 提供 Skill 浏览器和安装入口；目录发现/调用保持现有 public Skill bridge
- 自然语言触发逻辑在 KodaX；Space 在触发后显示 `skill-active` 标签
- F135 把 `frontend-slides` 与 `huashu-design` 作为 Space-owned plugin root 注册，并在 UI 中映射为 `builtin`。资源位于安装包 `resources/builtin-skills` 而非 `app.asar`，使 Python/Node/shell/二进制资产获得普通文件系统路径；启动注册 best-effort，单个 builtin 故障不会阻止应用启动；Coder daemon 模式下，Space-owned builtin 目录与 Runtime 目录按名称合并并由 Space builtin 优先去重
- builtin 来源由上游 Git revision、许可哈希、Space 补丁和逐文件 SHA-256 lock 固定；同步拒绝许可漂移、symlink、secret/dynamic shell 风险和 release 中的 `installed:` 临时 revision，package smoke 要求文件集与字节完全一致
- `huashu-design` 依次应用 no-watermark、builtin portability、remaining-signature-removal 三个可审查补丁；分发默认不含推广水印/签名标记、指令或悬空代码，但保留上游 MIT 许可与作者信息。其可选浏览器/视频/TTS/AI-review pipeline 仍由外部依赖和凭据提供，不伪装成安装包已内嵌能力
- 本地 `pdf`/`pptx`/`xlsx`/`docx` skill 的当前许可不允许再分发，因此不进入 Space builtin；文件预览/现有 Office writer 与是否分发同名 skill 是独立能力

Space 将 plugin-root 内容标成 `builtin` 只是产品来源分类，不降低信任边界：权限、
工具副作用和可执行脚本仍按第三方 Skill 的保守策略处理。完整维护流程见
[BUILTIN_SKILLS.md](BUILTIN_SKILLS.md)。

Runtime catalog 与 Extension reload 继续按 Coder daemon、Partner embedded 和 Space residual owner 分离；不能因 public facade 存在就宣称已经统一迁移。

---

## 7. 文件系统抽象

### 7.1 Project 模型

```typescript
type Project = {
  rootPath: string;
  isGit: boolean;
  gitBranch?: string;
  recentSessionsIds: string[];
  pinnedFiles?: string[];
};
```

存储：`~/.kodax/space/projects.json`（Space 独占）。

### 7.2 文件读取与 diff

- Main 用 `fs.promises.readFile` 读文件给 renderer 做 diff 展示
- Renderer 永不直接 `fs`（contextIsolation）
- 写文件由 KodaX 内核 `write` / `edit` tool 完成，受 permission 守护

### 7.3 路径安全

- Renderer 显示的文件读取限定在 `Project.rootPath` 子树（main 侧防 path traversal）
- 拖拽外部文件要求二次确认才注入 session
- Workspace/worktree isolation 不是当前承诺，也不等同安全 sandbox；只有独立 feature/threat model 通过 reopen gate 后才实现。

### 7.4 文档与原生工具执行

- F137/F129 的解析、Office render/recalculation 和 OCR 不占用 Electron main：纯 JS 解析走
  有 heap/输入/时间限制的 Worker，原生 adapter 走 job-scoped 子进程、私有 staging/profile、
  禁宏/链接更新、取消和整树清理。
- 该基线用于先完成功能和故障隔离，不宣称 OS 层文件系统/网络/进程/native-resource
  containment，也不因缺少 OS backend 禁用已经通过功能/保真测试的 adapter。
- F138 在 `post-v0.5.x` 以可替换 backend 增加平台强制隔离；可复用 KodaX 0.7.78
  的公开 command-sandbox facade，但文档 staging、凭据、native-resource、打包和平台验收
  仍由 Space 持有，也不回溯改变 Document Job、Presentation Project 或 Delivery 契约。

---

## 8. 权限与审计

### 8.1 三层权限

1. **KodaX 内核层**（Auto[LLM] classifier、Auto[Rules]、Accept-edits fallback 与权限 grant）
2. **Space UI 层**（弹窗与录入；F121 的 Coder `Always allow` 仅回传 Runtime 给出的不透明精确 grant suggestion，绝不由 UI 扩大工具或 shell 范围；Partner 保留 inline policy path）
3. **OS 层**（写入 keychain、利用 Win Credential Manager / macOS Keychain）

唯一真理面在 KodaX。Space 是显示器 + 录入器。

### 8.2 静态危险操作边界（非 Auto[LLM] 决策路径）

Space 的静态检测仅用于 `accept-edits`、未安装 Auto guardrail 的 fallback 和其他由本地 broker
拥有决策权的路径。成功安装 Auto guardrail 后，KodaX 先完成工具裁决；Space 不得再用下列
模式覆盖合法的 LLM `allow`，只负责展示并录入 KodaX 明确发出的 `ask`：

- `rm -rf` / `rmdir /S` 任何变体
- `git push --force` / `git push -f`
- `git reset --hard` 到远程同步分支
- `chmod 777` / `chmod -R`
- 任何越过项目根的写
- 任何对 `~/.kodax/` / `~/.aws/` / `~/.ssh/` 的写

### 8.3 审计

- KodaX 内核已写 `~/.kodax/sessions/<id>.jsonl`（含 tool calls）
- Space 不另写；提供 GUI 检索视图
- Long-term enterprise: any syslog/SIEM forwarder requires a separate privacy/redaction/tenant policy and consumes bounded Runtime/audit events.

---

## 9. UI 架构

### 9.1 Renderer 技术栈

| 选择                  | 理由                                                         |
| --------------------- | ------------------------------------------------------------ |
| React 19 + TypeScript | 当前 renderer 与 UI kit 基线；KodaX REPL 也使用 React 19/Ink |
| Vite                  | HMR 快                                                       |
| Zustand               | 轻量 store                                                   |
| Tailwind + shadcn/ui  | 主题与组件库                                                 |
| Monaco Editor         | diff + 只读浏览（非主编辑工作流）                            |
| xterm.js + node-pty   | 内置终端                                                     |
| Mermaid / Recharts    | session lineage 图、token 仪表盘                             |

### 9.2 State 模型

```typescript
type RootState = {
  app:        { theme, locale, version, updateAvailable };
  providers:  Record<ProviderId, ProviderState>;
  projects:   Project[];
  sessions:   Record<SessionId, SessionState>;
  activeSessionId: SessionId | null;
  mcp:        { servers: McpServerState[], extensions: McpbExtension[] };
  repointel:  { mode, engine, transport, daemonStatus, traceEnabled };
  permissions:{ history: PermissionRecord[], rules: PermissionRule[] };
  workBudget: { used, cap } per session;
};
```

事件来源：

- KodaX 事件（`KodaXEvents`）→ main 转发 IPC `session-event` → store reducer
- 用户 action → IPC `intent` → main 调用 KodaX SDK → 结果回写

### 9.3 Renderer 不变量

- 无 `import '@anthropic-ai/sdk'` / `openai` / 任何 LLM SDK runtime
- 无 `import { runKodaX }` / `KodaXClient` runtime
- 无 `import 'electron'`
- 无 `child_process` / `fs` 直接调用
- 外部 URL 经 main 的 `shell.openExternal` 白名单

### 9.4 Surface 抽象

> Partner surface 的完整决策见 [ADR-007](ADR/ADR-007-partner-surface-model.md)：Partner = 同一 KodaX SDK substrate 上的**画像组合**（surface spec + skill packs + artifact），不等于与 Coder 共用同一个 daemon owner。本节给数据形态。

```typescript
type Surface = 'code' | 'partner';

interface SurfaceSpec {
  sessionKind: 'code' | 'partner';
  // 工具白名单：理想态由 SDK 工具能力维度元数据驱动（依赖 R3），
  // 交付前 Space 侧按名单裁剪（参照 plan-mode blocklist 先例）。
  tools: ToolPolicy;
  layout: 'code-workspace' | 'doc-workspace';
  // Partner 专属：作用域不限 git，artifact 为一等产物
  scope?: 'git-root' | 'any-dir'; // partner = any-dir（含 Documents/Downloads）
  artifacts?: boolean; // partner = true
  // Partner 的自定义画像（instructions + 工具子集 + faithfulness reasoning），
  // 经 SDK「自定义画像 + 完整 harness」入口下发（依赖 R1/R2）。
  agentProfile?: 'coding-default' | 'partner';
}

const SURFACES: Record<Surface, SurfaceSpec> = {
  code: {
    sessionKind: 'code',
    tools: 'all-coding',
    layout: 'code-workspace',
    scope: 'git-root',
    artifacts: false,
    agentProfile: 'coding-default',
  },
  partner: {
    sessionKind: 'partner',
    tools: 'non-bash-subset', // read/grep/glob + 富格式 IO + web；默认无 bash
    layout: 'doc-workspace', // 三栏：Sources | 对话+任务进度 | Artifact 预览
    scope: 'any-dir',
    artifacts: true,
    agentProfile: 'partner',
  },
};

// Quick Ask 不是 Surface，是 transient popover：
type QuickAskParams = {
  mode: 'plan';
  mcpServers: [];
  persist: false;
  ephemeral: true;
  inheritProvider: 'last';
};
```

**`agentProfile='partner'` 的下发路径**：KodaX KX-F247 已提供公开 Agent Profile contract。Space 在 `PartnerInlineAdapter` 中绑定 Partner identity/instructions/tool visibility/verification contract，并叠加仅含当前 Sources 与 Space-owned tool policy 的动态 run context。它与 Coder 共用 SDK substrate，但不进入 Coder daemon。

**Artifact 模型**：Partner 产出（report/slides/sheet/doc）登记为可预览、可迭代（带版本）、可导出的 Space Artifact，由 Space store 持久化并由 renderer 在右栏 `doc-workspace` 预览。SDK 的 input artifact handle 仅是模型输入概念，不是 Space Artifact store。

- 当前：Coder/Partner surface switcher、独立 session scope、Partner Sources/KB/Outputs/checkpointed writes 已发布。
- Quick Ask 是独立 frameless `BrowserWindow`，使用显式 temporary plan-mode session 语义；true side-query 仍是 watchlist gate。
- 后续 Partner 能力通过正式 packs、governed browser、Connector snapshots 和 refreshable artifacts 扩展，不改造成第二套 runtime。

### 9.5 三个 BrowserWindow

- `mainWindow`：托管当前 `code` 或 `partner` surface，完整布局与 Task Dock。
- `quickAskWindow`：按需创建，frameless；F121 使用 daemon-owned ephemeral Coder session，晋升时保留同一 session/transcript identity。
- 辅助预览/浮层窗口遵守主窗口所有权、最小 preload/IPC 和 surface policy；multi-window 扩展需单独验证 session single-writer 规则。

### 9.6 共享按钮交互层

- `styles.css` 在应用 `body` 上为 enabled `<button>` 提供统一的 hover 扫光、内描边、active 与 `focus-visible` 反馈，因此 React root 与 portal-mounted Settings/Quick Ask/确认弹层使用同一语言。
- 交互色由现有 `--accent`、`--ok`、`--info`、`--thinking`、`--warn`、`--danger` token 派生；组件原有背景、阴影、尺寸、圆角和文案仍是 owner。
- `.session-token-indicator` 保留其专用蓝绿 sweep/orbit；`.window-control-button`、`.monaco-editor`、`.xterm`、`.no-ix`、`.no-button-sheen` 与 disabled 控件不接管。
- 普通按钮保持无 JS 的伪元素绘制；宽列表/菜单降低 opacity，避免重复行产生闪烁噪声。`prefers-reduced-motion` 取消 sweep travel，保留静态可见反馈。
- 全局层不能重写 action、ARIA label、权限、可用性或 positioning。absolute/fixed/sticky 按钮保留原定位，只把伪元素 inset 到自身 box。

---

## 10. 跨 Surface（Space ↔ CLI/REPL）

### 10.1 Session ID 全局唯一

KodaX 内核 `generateSessionId()` 已存在；Space 使用同一函数，session 文件 / lineage 完全互通。

### 10.2 文件级 Teleport 兼容协议（不走 ACP）

下列“退出/接管”流程是 `v0.1.31` 的兼容基线，不是 F121 的目标 owner 模型：

```text
CLI → Space:
  $ kodax --session abc123 --teleport space
    → KodaX 写 ~/.kodax/handoffs/abc123.json
       { cwd, provider, mode, last-message-id, pid }
    → CLI 进程退出

Space main 周期性 watch ~/.kodax/handoffs/
  → 发现 abc123.json → 弹通知 "Continue session abc123 from terminal?"
  → 用户确认 → RuntimeHostAdapter 加载 session
  → handoff 文件删除

Space → CLI:
  Space UI: "Continue in terminal"
    → main 写 ~/.kodax/handoffs/abc123-to-cli.json
    → 启动 OS terminal (`open -a Terminal` / `wt.exe` / `gnome-terminal`)
    → 终端跑 `kodax --session abc123 --pickup`
```

### 10.3 并发安全

- `v0.1.31`：同一 sessionId 在 CLI / Space 不能同时写，handoff 表示 writer 迁移。
- F121：handoff 文件只作为 session discovery hint；Space、CLI、IDE 可同时 attach/control，唯一 writer 是 Coder daemon。
- F121 打开 handoff 后附着 canonical daemon session，成功后才删除 hint；不导入 transcript、不创建第二 session，也不要求 CLI 退出。
- Partner 不使用共享 daemon；`partner` tag 与 Coder tag/历史无 tag 的分类及双向 mutation guard 见 [v0.1.32](features/v0.1.32.md#surface-runtime-router)。

---

## 11. 技术栈决策（最终）

| 层          | 选择                                                                                                                                       |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Shell       | **Electron 30+** ([ADR-001](ADR/ADR-001-shell-electron.md))                                                                                |
| Renderer    | **React 19 + Vite 6 + TypeScript + Zustand 5 + Tailwind + shadcn-derived UI**                                                              |
| Editor 组件 | Monaco（只读 + diff）                                                                                                                      |
| 终端组件    | xterm.js + node-pty                                                                                                                        |
| KodaX 集成  | **双 owner**：Coder 通过 Runtime facade 连接 profile daemon；Partner 在 Electron main inline；均不走 ACP（[v0.1.32](features/v0.1.32.md)） |
| Native 加速 | 仅按 profile 引入 NAPI-RS 热路径；无已承诺 native-helper feature ([ADR-002](ADR/ADR-002-rust-integration-napi.md))                         |
| IPC schema  | zod，验证所有 renderer↔main channel                                                                                                        |
| Keychain    | `@napi-rs/keyring`（Win Credential Manager / macOS Keychain / Linux Secret Service）                                                       |
| 自动更新    | Squirrel.Mac + Squirrel.Windows                                                                                                            |
| 安装包      | NSIS (Win) + DMG/ZIP (macOS x64/arm64) + AppImage/deb (Linux x64); signing/notarization/channel trust tracked by F101                      |
| 测试        | Vitest（unit）+ Playwright for Electron（E2E）                                                                                             |

### 11.1 不引入

- 不引入 Tauri（见 ADR-001）
- 不引入 Next.js（renderer 不是 SSR）
- 不引入 GraphQL（IPC 用 zod 已足够）
- 不为路线图预先引入 SQLite；只有真实查询/retention/profile 证明现有原子文件存储不足时再立项
- 不引入 Cargo workspace 跨 crate 依赖（每个 NAPI crate 独立 cargo 项目）

---

## 12. 数据持久化布局

```
~/.kodax/                       ← KodaX 内核共享区
├── config.json                 ← provider / mode / permission / compaction 等核心配置
├── integrations/
│   ├── mcp.json                ← version 1 MCP servers
│   ├── extensions.json         ← version 1 trusted extension paths
│   └── a2a.json                ← Runtime-owned A2A registration
├── permissions.json            ← Allow patterns
├── sessions/
│   ├── <session-id>.jsonl      ← 完整 transcript
│   └── <session-id>.meta.json
├── lineage/                    ← session-lineage 树
├── handoffs/                   ← teleport handoff 文件（CLI ↔ Space）
├── skills/                     ← user skills
└── space/                      ← Space 独占
    ├── preferences.json        ← 主题 / 窗口位置 / 面板布局
    ├── projects.json           ← 最近项目
    ├── connectors/             ← Connector metadata（OAuth state 加密）
    ├── quick-ask.json          ← Quick Ask 最近 provider 选择
    └── telemetry.json          ← telemetry 设置
```

### 12.1 写入策略

- `~/.kodax/space/*` 由 Space main 写，atomic rename (tmp → 目标)
- `~/.kodax/<其他>` 由对应 KodaX owner 写：Coder 域由 daemon，Partner session 域由 main inline；跨 surface mutation 被拒绝
- 不在 renderer 进程写盘
- 备份/retention is store-specific. New global backup behavior requires an explicit feature with content, secret, quota, restore, and deletion semantics.

### 12.2 配置版本化

Space-owned stores use their declared schemas/migrators. KodaX integration files use the SDK's strict domain version (`mcp`/`extensions` currently `version: 1`; A2A follows its published domain contract) and public migration APIs; Space does not reinterpret those documents as one root `config.json` schema.

---

## 13. 安全模型

### 13.1 威胁模型（简化 STRIDE）

| 威胁                   | 场景                                | 缓解                                                                                                 |
| ---------------------- | ----------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Spoofing               | 假 MCP/Connector/Agent 冒充可信能力 | 显式 catalog/source/capability/preflight；签名与 distribution trust 由 F101/后续 adapter policy 管理 |
| Tampering              | 恶意 skill 改用户文件               | Skill sandbox / Permission gating                                                                    |
| Repudiation            | 用户否认操作                        | Tamper-evident audit log + signed transcript                                                         |
| Information disclosure | API key 泄露                        | OS keychain + redact in logs                                                                         |
| DoS                    | MCP fork bomb                       | child_process resource limits + watchdog                                                             |
| Privilege escalation   | 利用 IPC 突破 sandbox               | contextIsolation + zod schema 校验                                                                   |

### 13.2 IPC 防护

- 所有 renderer→main 消息经 zod schema 校验（`space-ipc-schema`）
- 拒绝任何未在 schema 声明的 channel
- main→renderer 仅在已注册 listener 路径发送，不广播

### 13.3 网络

- Main 默认无监听端口
- LLM / MCP 流量从 KodaX runtime 出（受 KodaX 自身策略）
- OAuth 回调使用临时进程内 server（完成即关）
- 自动更新仅访问官方 endpoint（白名单）

### 13.4 自动更新

- Windows/macOS/Linux updater manifests 与 release assets 已进入当前 release staging。
- `dev` / `beta` / `stable` channel policy、跨 channel eligibility、签名/notarization 与稳定发布信任门槛由 F101 完成。
- Manifest URL/asset name 必须一致，架构合并不得覆盖，缺失 payload/sidecar/native binary 时 release staging 失败。

---

## 14. 可观测性

| 层            | 路径                                       | 内容                                                                         |
| ------------- | ------------------------------------------ | ---------------------------------------------------------------------------- |
| Electron main | F069 target: bounded rotated/redacted logs | 启动、IPC reject、Runtime/capability/updater failures                        |
| Renderer      | 经 capped zod IPC 转发到 F069 logger       | UI error metadata, no task/document bodies by default                        |
| KodaX runtime | 复用 KodaX 已有日志栈（同 main 进程）      | tool call / LLM 元信息、context category counts、hash-only cache diagnostics |
| Repointel     | 由 Repointel daemon 管理                   | —                                                                            |

- Tracing：KodaX tracing/runtime events remain KodaX-owned; Space correlates identifiers and renders supported projections.
- F069 diagnostic export is explicit, local, bounded, and redacted. No remote upload is implied.
- Remote crash/Sentry upload is not active roadmap work without a separate privacy/consent design.

---

## 15. 构建与发布

### 15.1 构建 pipeline

```text
1. exact npm workspace install and lockfile verification under the `.nvmrc` Node 22 toolchain
2. verify Space builtin source/license/patch/per-file locks; reject local installed revisions
3. typecheck/lint/unit/E2E/build
4. Electron renderer (Vite) + main/preload sidecar builds
5. swap/verify the exact published KodaX tarball; reject local links
6. electron-builder package:
   - macOS DMG + updater ZIP (x64/arm64)
   - Windows NSIS installer
   - Linux AppImage + deb (x64)
   - Windows PE icon/version resources patched through pinned pure-JavaScript `resedit`
7. packaged smoke verifies app.asar, restored KodaX builtin Markdown, the exact external Space builtin tree, node-pty/keyring/native/Runtime Worker sidecars, boot, and core journeys
8. stage/validate updater manifests, asset names, checksums, and architecture merge
9. publish GitHub Release according to F101 channel/signing policy
```

### 15.2 平台支持

| Platform      | Current release artifact | Trust/coverage note                             |
| ------------- | ------------------------ | ----------------------------------------------- |
| macOS arm64   | DMG + updater ZIP        | signing/notarization policy tracked by F101     |
| macOS x64     | DMG + updater ZIP        | signing/notarization policy tracked by F101     |
| Windows x64   | NSIS EXE                 | signing policy tracked by F101                  |
| Windows arm64 | not currently committed  | reopen through distribution evidence            |
| Linux x64     | AppImage + deb           | existing release/staging path; keep smoke green |
| Linux arm64   | not currently committed  | reopen through user/platform demand             |

### 15.3 Native dependency policy

Space currently packages required native dependencies such as node-pty and `@napi-rs/keyring` and verifies platform binaries in smoke. New native acceleration packages are not roadmap commitments: profile first, require a material measured hot path, preserve a JS/Worker fallback where feasible, and add a complete platform/package matrix only when the feature is approved.

---

## 16. 测试策略

| 层级                    | 工具                           | 覆盖                                                    |
| ----------------------- | ------------------------------ | ------------------------------------------------------- |
| Unit（main + renderer） | Node test runner + `tsx`       | reducer、zod schema、IPC handler、KodaX runtime wrapper |
| Integration             | Node test + 真实 KodaX runtime | 起 KodaX session、跑工具、断言事件流                    |
| E2E                     | Playwright for Electron        | 用户旅程 S1–S7（见 PRD §3.2）                           |
| Smoke                   | per-platform install runner    | 装包 + 首启 + 跑 1 个 session                           |
| Compat                  | per-OS sample                  | Anthropic `.mcpb` 抽样跑                                |

NAPI crate 独立 Rust 单测 + 与 TS wrapper 的集成测。

---

## 17. 与 KodaX 内核 HLD 的对照

| KodaX 内核 HLD 概念       | KodaX Space 中的体现                                                                                            |
| ------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Surfaces                  | Space 是 KodaX 的 first-party 桌面 surface；不挪用任务逻辑                                                      |
| Intent Gate / Direct Path | 在对应 KodaX Runtime owner 内；UI 仅看 Space main 的 sanitized projection                                       |
| Scout / AMA Control Plane | 仅以"模式徽标 + Round"体现；不绘制内部图                                                                        |
| Coding Runtime            | F121 起 Coder 在 profile daemon；Partner 保留 main inline                                                       |
| Durable Task State        | 写盘真理面在 KodaX runtime（`~/.kodax/sessions/`）；Space 是读视图                                              |
| Skill 集成                | 通过 public Skill registry/catalog；F135 以 SDK plugin API 注册审定的 Space builtin root                        |
| 证据分层                  | UI 在 verdict 卡片浏览，不重新组织                                                                              |
| Project + SA / AMA        | UI 用 surface（code / partner）+ mode（plan / edits / auto）；Quick Ask 是固定 `mode=plan` 的 transient session |
| npm 发布 scoped 包        | Space 把 `@kodax-ai/{coding,llm,agent,skills}` 作为 dependency 按需拉                                           |

---

## 18. 与 KodaX-private（Repointel）的边界

Space 严格遵守：

1. **不读取 Repointel 内部对象**——仅经 KodaX 暴露的 status 字段（`mode / engine / bridge / status / transport`）
2. **不重实现** `preturn` / `context-pack` / `impact` / `symbol` / `process` 逻辑
3. **GUI 入口只有** "warm" / "switch mode" / "open trace"
4. **不打包** KodaX-private 代码到 Space 安装包；引导用户从 KodaX-private 官方 release artifact 安装

---

## 19. 未来扩展点

### 19.1 Memory Agent 与 Learned Skill Safety Surface

- 0.1.31 已验证 KodaX 0.7.68 `/experimental-memory`、policy shape 和 managed-run lifecycle，并只向 `space.version`/脱敏诊断投影 bounded metadata；KodaX/F228 仍分别是 runtime 与 durable governance owner。
- F117 通过已发布 KX-F260 contract 扩展现有 F088 Memory Governance；完整 Episodes/Activity/correction/forget/purge 和 activation/rollback 仍受精确 host contract 门控。
- F118 通过已发布的 `learningCenter:1` + `skillLearningLoop:1` 承载 learned Skill 生命周期；Space 不写第二套 learning store。
- 首版只做 attention/list/detail 与 review/trust/reject/disable/rollback 的最小安全控制面，展示 Runtime 返回的 evidence、immutable revision、fingerprint、canary、validation 与 previous-good；不建设 Memory/Extension/Workflow carrier union。
- archive/restore 不在公开 Runtime facade 中，Extension self-learning 已从 KodaX 路线移除；二者都不能作为 F118 隐藏验收项。

#### F118 implemented boundary (`v0.1.35`)

- Renderer access is gated by negotiated `learningCenter:1` and
  `skillLearningLoop:1`. `LearningSafetySection` consumes only the strict
  `learning.*` IPC projection; unknown records remain read-only.
- `LearningSafetyService` in `apps/desktop/electron/ipc/learning.ts` re-reads an
  exact capability ID and verifies revision/fingerprint before one Runtime
  action. The public daemon facade has no caller-supplied mutation CAS token, so
  Space treats Runtime as the serialized authority and verifies exactly the
  next revision plus the action-specific lifecycle after the call instead of
  claiming atomic client-side CAS. `lastAction` is not used as proof because
  lifecycle transitions do not guarantee that it is rewritten.
- Space has no learned-capability database. Its sole durable learning state is
  `{ runtimeId, revision }` in `runtime-learning-cursor.json`; replay is
  deduplicated and any identity change or sequence gap recovers from the Runtime
  snapshot.
- IPC never exposes Runtime absolute artifact paths or promotion/archive/restore
  mutations. Review, trust, reject, disable, and rollback use exact capability
  IDs and explicit confirmation; acknowledgement is a separate read-state
  operation.
- `SPACE_DISABLE_LEARNING_MUTATIONS=1` is the product rollback boundary:
  Runtime records remain readable while desktop and `/learn` mutation paths fail
  closed.

### 19.2 Governed Browser 与 Connectors

- Browser 是 Space-owned Electron capability，以 bounded tool contract 暴露，页面内容与 application origin 隔离。
- Connector 是 provider-specific API adapter + shared catalog/auth/snapshot/provenance/revocation，不与浏览器会话混为一体。
- Connector `v1` read-only；写操作需要独立 captured target/action preview/idempotency/reconciliation/audit 设计。

### 19.3 Local Automations 与 Refreshable Artifacts

- Space owns schedule/OS wake；KodaX Runtime owns run/task/event/permission execution truth。
- 每次 automation 都有 Runtime session/run/task correlation，不以 untracked CLI spawn 为主架构。
- Refreshable artifacts 复用 sandboxed `interactive-html`、artifact versions 和 explicit data bindings；不重接 LiveCanvas。

### 19.4 Enterprise（长期）

- 团队配置文件下发（policy JSON via MDM）
- Provider 网关（公司自托管 endpoint，按用户接到自己的 key）
- 中央审计（SIEM 导出）
- RBAC（需要独立身份/策略架构，不作为本地 F098 的隐含范围）

---

## 20. 路线图

### 20.1 Active 0.1.x architecture lanes

| Lane                | Architectural change                                                                                                                                                                          |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `v0.1.31`           | `RuntimeHostAdapter` released for managed runs/transcript/compact/fork/rewind with explicit Space bridge ownership.                                                                           |
| `v0.1.32`           | Move Coder to one shared profile daemon with multi-client live state/control; keep Partner embedded inline.                                                                                   |
| `v0.1.33`           | Stabilize KodaX 0.7.77 Actor/history/usage contracts and add bounded Shell/F140 desktop lifecycle control.                                                                                    |
| corrected `v0.1.33` | Add safe customer-selectable Coder ownership and exact packaged Runtime dependency/boot gates before reissuing the withdrawn release.                                                         |
| `v0.1.34`           | Adopt KodaX 0.7.78 safety contracts, resilient integration health, visible complete exit/orphan recovery, physical sandbox helpers, one startup overlay, and exact positional history replay. |
| `v0.1.42`           | Add the independently authored F137 native document Skill suite and F139 semantic UI polish without weakening F138 boundaries.                                                                |
| `v0.1.45`           | Extend Workflow snapshot schema for same-session replay provenance; attach evidence review receipts to objects.                                                                               |
| `v0.1.49`           | Host KX-F260 Memory Agent over existing F228/F088 governance when published.                                                                                                                  |
| `v0.1.35`           | Host the minimum learned-Skill safety surface over published `learningCenter:1` + `skillLearningLoop:1`.                                                                                      |
| `v0.1.36`           | Harden active-Session input admission, exact run/turn ownership, paged history reconciliation, and renderer recovery without adding a second Runtime store.                                   |
| `v0.1.37`           | Align the exact KodaX 0.7.83 package and release docs while preserving multi-Session recovery, safe-close recovery, and renderer ownership boundaries.                                        |
| `v0.1.39`           | Align the exact KodaX 0.7.85 package and manual while preserving Actor settlement convergence, Session journal epoch isolation, unknown Run admission, exact Stop, and idle-exit client boundaries. |
| `v0.1.38`           | Align the exact KodaX 0.7.84 package and manual while preserving bounded Agent progress, same-owner Stop recovery, and Session reactivation identity boundaries.                              |
| `v0.1.53`           | Complete locale gates, release diagnostics, channels/updater/distribution trust.                                                                                                              |

### 20.2 Active 0.2.x architecture lanes

| Lane     | Architectural change                                                                                       |
| -------- | ---------------------------------------------------------------------------------------------------------- |
| `v0.2.0` | Add isolated governed browser sessions and formal Partner document/research packs.                         |
| `v0.2.3` | Add connector adapter boundary, authorization state, immutable read snapshots, provenance, and revocation. |
| `v0.2.6` | Add Space-owned scheduling over Runtime dispatch and explicitly refreshable/versioned artifacts.           |

### 20.3 Non-committed watchlist

Native helpers, `zh-Hant`, knowledge graph, remote runners, local workspace isolation, NotebookEdit, desktop screen automation, External Agent A2A/MCP Tasks/governed HTTP adapters, and Connector writes remain reopen-gated in [FEATURES_ARCHIVED.md](FEATURES_ARCHIVED.md#watchlist-and-reopen-gates). A worktree is workspace isolation, not a security sandbox.

---

## 21. ADR 索引

所有"中间决策"与"为什么不选 X"在 [ADR/](ADR/)：

- [ADR-001 — Shell 技术栈：Electron](ADR/ADR-001-shell-electron.md)
- [ADR-002 — Rust 集成策略：NAPI-RS 选择性热路径](ADR/ADR-002-rust-integration-napi.md)
- [ADR-003 — KodaX 集成模式：in-process import](ADR/ADR-003-kodax-integration-in-process.md)
- [ADR-004 — 面板模型：双面板 + Quick Ask](ADR/ADR-004-panel-model.md)

---

## 22. 相关参考

- [KodaX PRD](../../KodaX/docs/PRD.md)
- [KodaX HLD](../../KodaX/docs/HLD.md)
- [KodaX ADR](../../KodaX/docs/ADR.md)
- [KodaX-private 技术交底书（Repointel）](../../KodaX-private/技术交底书.md)
- [KodaX REPL 实现（同进程 import 参考）](../../KodaX/packages/repl/)
- Electron Best Practices（contextIsolation / sandbox / CSP）
- [napi-rs](https://napi.rs/)
