# KodaX Space 高层设计（HLD）

> Last updated: 2026-07-21
> Status: 核心架构决策仍有效；当前源码/发布准备基线为 KodaX Space 0.1.32（package 0.1.32）/ 正式 KodaX 0.7.73。中间方案与否决理由见 [ADR/](ADR/)；当前能力边界见 [KODAX_CAPABILITY_LEDGER.md](KODAX_CAPABILITY_LEDGER.md)。
> Companion doc: [PRD](PRD.md)

> **0.1.30 增量**：Electron main 继续拥有特权边界，并新增一个持久、协议中立的 External Agent Executor Plane。Renderer 仅通过 zod IPC 获取脱敏 Registration/Descriptor/Task/Event 投影；管理入口仅接受主应用窗口，任务创建从 main-owned live Session 派生项目/父任务归属，读取与干预均复核任务所属 Session。实时 Session 与 Workflow 共用同一 KodaX 0.7.67 plane。Reference Executor 已接通，真实 A2A/MCP Tasks/HTTP adapter 仍按 Runtime capability 门控。Partner 自 0.1.30 起已启用 workspace-first Outputs 与 checkpointed writes。
>
> **2026-07-12 架构重置**：`v0.1.31` 起以 `RuntimeHostAdapter -> @kodax-ai/kodax/runtime` 作为长期 host boundary，先采用 embedded inline facade，再以 capability negotiation 决定 Worker/daemon。旧 `KodaXHost/RealSession/KodaXClient` 路径是迁移基线，不再是长期目标。当前路线见 [FEATURE_LIST.md](FEATURE_LIST.md)。
>
> **2026-07-13 `v0.1.32` 架构边界（2026-07-19 已实现）**：F121 只把 Coder 迁入 profile-scoped shared daemon，使 Space、CLI 与 IDE 共享同一 session/run/live-state truth；Partner 明确保留 Space-owned embedded inline。Space 通过 surface router/adapter 拆分 owner，不再用 Partner 的进程内 callback/tool 约束阻塞 Coder daemon。完整合同、迁移与回滚规则见 [v0.1.32](features/v0.1.32.md)。
>
> **2026-07-21 `0.7.73` 正式集成**：根与 Desktop workspace 已锁定 Registry 正式包。Coder daemon 要求 Runtime-owned Auto LLM guardrail v3、公开的有效设置/时序契约、统一 Actor/Turn、Learning Center、共享设置、精确 `grantSuggestions` 和 daemon management 能力；缺少能力时 fail closed，不回退到隐藏 inline owner。AMAW 已并入 AMA，Workflow 只由显式命令或 KodaX 强信号策略触发。
>
> **0.7.68 集成**：KodaX top-level managed coding path 自有 FEATURE_260 Memory Agent 生命周期，复用 F228 durable governance。Space 验证正式 `/experimental-memory` 契约、保留 metadata-only 回调诊断并继续拥有 UI 投影；不创建第二个 Memory Agent/存储/推广策略。完整 F117 仍受 activation/rollback 和桌面 query/action contract 门控。

---

## 0. 中文导读

KodaX Space 不是新 agent，而是**复用 KodaX 内核的 Electron 桌面客户端**。架构 7 条核心判断：

1. **进程模型** = Electron 标准（main / preload / renderer）加 profile-scoped KodaX Runtime daemon；`v0.1.32` 的 Coder owner 位于 daemon，Partner owner 保留在 Electron main embedded inline。
2. **与 KodaX 的边界** = **TypeScript Runtime/SDK public contracts**（不是 ACP）。Main 以 `@kodax-ai/kodax/runtime` 作为长期 host facade；Coder 使用 transport-safe observe/control/services，Partner 使用 embedded inline adapter；Space-owned zod IPC 仍是 renderer 唯一边界。决策基线见 [ADR-003](ADR/ADR-003-kodax-integration-in-process.md)、[v0.1.31](features/v0.1.31.md) 和 [v0.1.32](features/v0.1.32.md)。
3. **Shell 选择** = Electron。理由见 [ADR-001](ADR/ADR-001-shell-electron.md)（含 OpenCode 反向迁移实证）。
4. **Native 集成** = 仅在 profile 证明 JS/Worker 路径存在实质热瓶颈时引入 NAPI-RS；历史 native-helper 提案已移入 watchlist。见 [ADR-002](ADR/ADR-002-rust-integration-napi.md)。
5. **面板模型** = 双面板（Code / Partner）+ Quick Ask popover。无独立 Chat 面板。见 [ADR-004](ADR/ADR-004-panel-model.md)。
6. **数据持久层** = 复用 KodaX 已有的 `~/.kodax/`，Space UI 偏好位于 `~/.kodax/space/`；v0.1.31 Runtime journal 位于 `<profile-root>/.kodax/runtime/`。Quick Ask 的最终目标是不落盘；当前仍使用临时 plan-mode session，并在关闭时 best-effort 清理。
7. **CLI ↔ Space session 协同** = Coder 通过 shared daemon 的 atomic live snapshot + ordered events 实时协同；handoff 仍用于显式上下文连续性。两者都不走 ACP，Partner 不进入该共享路径。

**ACP 在 KodaX 生态的定位**：KodaX 内核继续维护 ACP server，服务**第三方 host**（Zed / Claude Code Desktop / 未来 IDE）。Space 是 KodaX 的 first-party UI，**不通过 ACP 接 KodaX**。

---

## 1. 系统总览

### 1.1 全景图

下图是当前 `v0.1.32` F121 拓扑；`v0.1.31` 的双 surface inline owner 仅作为历史兼容基线保留。

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

| 进程                 | 角色                   | 持久             | 内含                                                               |
| -------------------- | ---------------------- | ---------------- | ------------------------------------------------------------------ |
| `space-main`         | Electron main（Node）  | 应用周期         | IPC、Coder daemon client、Partner inline Runtime、Space host tools |
| `space-preload`      | Electron preload       | 每窗口           | 安全桥（contextBridge）                                            |
| `space-renderer`     | React UI               | 每窗口           | UI only，无 KodaX runtime                                          |
| `quick-ask-window`   | 独立 BrowserWindow     | 按需             | Quick Ask renderer；Coder session 由 daemon 拥有                   |
| KodaX Runtime daemon | Coder Runtime owner    | profile 周期     | Coder session/run/live truth；供 Space/CLI/IDE 共享                |
| MCP server children  | MCP server             | owner 按需 spawn | Coder 由 daemon 管；Partner/Space residual 由 main 管              |
| Repointel daemon     | 系统级（用户提前安装） | 系统周期         | KodaX 内核已通过 loopback HTTP 接，Space 无关                      |

### 2.2 关键差别（与 sidecar+ACP 模型对比）

- **没有独立 kodax-acp 子进程**——F121 的 Coder daemon 使用 KodaX Runtime transport；Partner owner 仍处于 Electron main 信任边界
- **没有 stdio + ACP 协议层**——main 通过公开 Runtime facade 接入 daemon；renderer 仍只看 Space zod IPC
- **MCP lifecycle 按 surface 单 owner**——Coder children 由 daemon 管；Partner/Space-owned residual 才由 Space MCP Manager 管
- **Repointel daemon 是独立系统服务**——KodaX 内核连接它，Space 透过 KodaX 看其状态

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

`RuntimeHostAdapter` wraps the public facade and presents a bounded Space-owned compatibility surface. In `v0.1.32` it coordinates:

- Coder daemon initialization/identity, capability validation, subscription readiness and detach-only close;
- Coder session/run/live projection, transcript, compact, fork, rewind, queue and shared settings routes;
- Runtime interaction, Workflow read/control, Learning, catalog/MCP and configured Agent Actor/Turn services;
- Partner inline initialization plus the temporary process-start-only legacy rollback boundary.

The adapter does **not** claim every public Runtime service as a migrated Space route. For Coder, Runtime owns sessions/runs/settings/interactions, Workflow observation/control, Learning operations, catalog discovery, MCP tool discovery/reload, and configured External Agent Actor/Turns. Space remains authoritative for renderer projection, Partner tools/profile/policy, MCP process lifecycle/logs, Workflow library/start/admin, artifacts, and the Reference Agent executor-plane store. These residual paths are reported as host providers, not Runtime-native support.

The `v0.1.32` adapter attaches Coder to the profile daemon and keeps Partner inline because Partner injects process-local tools, profiles, callbacks and policy. Missing required Coder capability fails closed; it never creates a hidden inline Coder owner. No user-facing arbitrary Runtime endpoint or mixed-owner preference is added.

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

Session transcript persistence remains KodaX-owned. Space stores UI preferences, compatibility projections/caches, Space-only session settings, Partner artifacts/KB/deliveries/policy records, and correlation metadata only where those are explicitly Space responsibilities.

### 4.3 Runtime failure and degradation

| Failure                       | Handling                                                                                                           |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Missing Runtime capability    | Fail closed; hide/disable the action and expose a redacted reason in capability health/diagnostics.                |
| LLM/provider network error    | KodaX owns retry/recovery semantics; Space renders structured state/action.                                        |
| MCP/Extension degradation     | Space bridge reports its owned health/reload result; Runtime capability diagnostics must not claim a second owner. |
| Coder daemon unavailable      | Fail Coder closed with a redacted diagnostic; never silently replay or downgrade accepted work to inline.          |
| Main process crash            | On restart, recover KodaX sessions and Space-owned durable stores; do not claim cross-process Workflow replay.     |
| Long-session/context pressure | Consume Runtime context-budget/compaction events; do not add a second compaction policy.                           |

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

- **Release/CI**：exact published `@kodax-ai/kodax` dependency and lockfile; packaging swaps/verifies the published tarball and required Worker/native sidecars.
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

KodaX 生态已有 MCP 能力。`v0.1.32` 按公开服务拆分所有权：Coder 的 tool discovery 与 reload 同步 daemon；Space MCP Manager 继续管理 server 子进程、状态和日志，并服务 Partner/明确 residual。Space 的角色：

- UI 层提供 MCP server 列表、启停开关、`.mcpb` 一键安装
- 配置写入 KodaX 认识的位置（与 CLI / REPL 共享）
- server start/stop/logs 继续由 Space main 管理；Coder `tools/reload` 优先走 daemon，并在不可用时保持明确的 host-provider/failure 语义

### 6.2 `.mcpb` Desktop Extension

`.mcpb` 安装/文件关联/拖放已发布。Space main 验证 manifest、解包边界和注册状态，renderer 仅显示脱敏结果。兼容性以 fixture/smoke 证明为准，不宣称所有第三方包 100% 可用。

### 6.3 Connector foundation（F096）

Connector 不是 “OAuth-flavored MCP” 的同义词。F096 定义 provider-specific adapter + shared catalog/auth/read snapshot/provenance/revocation boundary：

- token/credential 只进 OS credential store；renderer/model/KB/log 不接触 secret；
- OAuth/device/callback flow 由 main 受信任边界处理；
- read snapshot 是 immutable/cited source；refresh 产生新版本；
- Connector `v1` 不开放 send/comment/merge/PR 等写动作；
- MCP、browser、Connector 可以互补，但三者拥有不同 lifecycle/permission/audit contract。

### 6.4 Skill

Skill 继续通过 KodaX public Skill API 与 Space compatibility bridge 管理；F116 不迁移 Runtime catalog：

- Skill 发现路径：`~/.kodax/skills/`、`<project>/.kodax/skills/`、Space 内置
- UI 提供 Skill 浏览器和安装入口；目录发现/调用保持现有 public Skill bridge
- 自然语言触发逻辑在 KodaX；Space 在触发后显示 `skill-active` 标签

统一到 Runtime catalog/extensions reload 留给 F090 或后续有明确 parity 的版本，不能因 public facade 存在就宣称已经迁移。

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

---

## 8. 权限与审计

### 8.1 三层权限

1. **KodaX 内核层**（`confirmTools` / `Allow patterns` / 危险命令黑名单——已存在）
2. **Space UI 层**（弹窗与录入；F121 的 Coder `Always allow` 仅回传 Runtime 给出的不透明精确 grant suggestion，绝不由 UI 扩大工具或 shell 范围；Partner 保留 inline policy path）
3. **OS 层**（写入 keychain、利用 Win Credential Manager / macOS Keychain）

唯一真理面在 KodaX。Space 是显示器 + 录入器。

### 8.2 危险操作黑名单（Space 加固）

即便 KodaX 模式允许，下列命令在 Space 强制 typed-confirm（输入 `CONFIRM`）：

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
├── config.json                 ← user provider / mode 配置
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
    ├── mcp-ui-config.json      ← UI 层 MCP 顺序、禁用旗标
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

每个 JSON 含 `schemaVersion`；启动时 main 跑 `migrators[][]` 链；失败回滚到上一版（保留 `.bak`）。

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

| 层            | 路径                                       | 内容                                                  |
| ------------- | ------------------------------------------ | ----------------------------------------------------- |
| Electron main | F069 target: bounded rotated/redacted logs | 启动、IPC reject、Runtime/capability/updater failures |
| Renderer      | 经 capped zod IPC 转发到 F069 logger       | UI error metadata, no task/document bodies by default |
| KodaX runtime | 复用 KodaX 已有日志栈（同 main 进程）      | tool call / LLM 元信息                                |
| Repointel     | 由 Repointel daemon 管理                   | —                                                     |

- Tracing：KodaX tracing/runtime events remain KodaX-owned; Space correlates identifiers and renders supported projections.
- F069 diagnostic export is explicit, local, bounded, and redacted. No remote upload is implied.
- Remote crash/Sentry upload is not active roadmap work without a separate privacy/consent design.

---

## 15. 构建与发布

### 15.1 构建 pipeline

```text
1. exact npm workspace install and lockfile verification
2. typecheck/lint/unit/E2E/build
3. Electron renderer (Vite) + main/preload sidecar builds
4. swap/verify the exact published KodaX tarball; reject local links
5. electron-builder package:
   - macOS DMG + updater ZIP (x64/arm64)
   - Windows NSIS installer
   - Linux AppImage + deb (x64)
6. packaged smoke verifies app.asar, node-pty/keyring/native/Runtime Worker sidecars, boot, and core journeys
7. stage/validate updater manifests, asset names, checksums, and architecture merge
8. publish GitHub Release according to F101 channel/signing policy
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

| 层级                    | 工具                        | 覆盖                                                    |
| ----------------------- | --------------------------- | ------------------------------------------------------- |
| Unit（main + renderer） | Vitest                      | reducer、zod schema、IPC handler、KodaX runtime wrapper |
| Integration             | Vitest + 真实 KodaX runtime | 起 KodaX session、跑工具、断言事件流                    |
| E2E                     | Playwright for Electron     | 用户旅程 S1–S7（见 PRD §3.2）                           |
| Smoke                   | per-platform install runner | 装包 + 首启 + 跑 1 个 session                           |
| Compat                  | per-OS sample               | Anthropic `.mcpb` 抽样跑                                |

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
| Skill 集成                | 直接调 `@kodax-ai/skills` API                                                                                   |
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

### 19.1 Memory Agent 与 Learning Center

- 0.1.31 已验证 KodaX 0.7.68 `/experimental-memory`、policy shape 和 managed-run lifecycle，并只向 `space.version`/脱敏诊断投影 bounded metadata；KodaX/F228 仍分别是 runtime 与 durable governance owner。
- F117 通过已发布 KX-F260 contract 扩展现有 F088 Memory Governance；完整 Episodes/Activity/correction/forget/purge 和 activation/rollback 仍受精确 host contract 门控。
- F118 通过 KX-F266 `runtime.learning` 承载学习生命周期；Space 不写第二套 learning store。
- KX-F263/F264 的 Skill/Extension action 按 capability 独立启用。
- 未发布 design 不被当作 SDK；缺失时保持当前功能并显示 unavailable reason。

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

| Lane      | Architectural change                                                                                                |
| --------- | ------------------------------------------------------------------------------------------------------------------- |
| `v0.1.31` | `RuntimeHostAdapter` released for managed runs/transcript/compact/fork/rewind with explicit Space bridge ownership. |
| `v0.1.32` | Move Coder to one shared profile daemon with multi-client live state/control; keep Partner embedded inline.         |
| `v0.1.35` | Extend Workflow snapshot schema for same-session replay provenance; attach evidence review receipts to objects.     |
| `v0.1.36` | Derive Task Dock plan/capability/effective-run projections from Runtime facts.                                      |
| `v0.1.39` | Host KX-F260 Memory Agent over existing F228/F088 governance when published.                                        |
| `v0.1.40` | Host KX-F266 Learning Center; carrier actions remain capability-gated.                                              |
| `v0.1.43` | Complete locale gates, release diagnostics, channels/updater/distribution trust.                                    |

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
