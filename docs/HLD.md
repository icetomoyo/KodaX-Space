# KodaX Space 高层设计（HLD）

> Last updated: 2026-07-12
> Status: 核心架构决策仍有效；当前实现基线为 KodaX Space 0.1.30 发布候选版 / KodaX 0.7.67，最终 tag 和 Release 等待验收。中间方案与否决理由见 [ADR/](ADR/)；当前能力边界见 [KODAX_CAPABILITY_LEDGER.md](KODAX_CAPABILITY_LEDGER.md)。
> Companion doc: [PRD](PRD.md)

> **0.1.30 增量**：Electron main 继续拥有特权边界，并新增一个持久、协议中立的 External Agent Executor Plane。Renderer 仅通过 zod IPC 获取脱敏 Registration/Descriptor/Task/Event 投影；管理入口仅接受主应用窗口，任务创建从 main-owned live Session 派生项目/父任务归属，读取与干预均复核任务所属 Session。实时 Session 与 Workflow 共用同一 KodaX 0.7.67 plane。Reference Executor 已接通，真实 A2A/MCP Tasks/HTTP adapter 仍按 Runtime capability 门控。Partner 自 0.1.30 起已启用 workspace-first Outputs 与 checkpointed writes；后文早期里程碑描述保留历史设计语境。

---

## 0. 中文导读

KodaX Space 不是新 agent，而是**复用 KodaX 内核的 Electron 桌面客户端**。架构 7 条核心判断：

1. **进程模型** = Electron 标准（main / preload / renderer），**KodaX runtime 直接 in-process import 到 main**——等同 REPL 的"同进程 import KodaX SDK + 渲染层"模型，只是把 Ink 换成 React。
2. **与 KodaX 的边界** = **TypeScript SDK import**（不是 ACP/不是 IPC）。Main `import { runKodaX, KodaXClient } from '@kodax-ai/coding'`，类型端到端，调试单栈。决策见 [ADR-003](ADR/ADR-003-kodax-integration-in-process.md)。
3. **Shell 选择** = Electron。理由见 [ADR-001](ADR/ADR-001-shell-electron.md)（含 OpenCode 反向迁移实证）。
4. **Rust 集成** = 按需 NAPI-RS 热路径模块（A+C 模式）。M0 末加第一个（`native-tokenizer`），后续按 profile 加。见 [ADR-002](ADR/ADR-002-rust-integration-napi.md)。
5. **面板模型** = 双面板（Code / Partner）+ Quick Ask popover。无独立 Chat 面板。见 [ADR-004](ADR/ADR-004-panel-model.md)。
6. **数据持久层** = 复用 KodaX 已有的 `~/.kodax/`，Space 仅追加 UI 偏好到 `~/.kodax/space/`。Quick Ask 的最终目标是不落盘；v0.1.20 在 SDK `sideQuery` 暴露前使用临时 plan-mode session，并在关闭时 best-effort 清理。
7. **CLI ↔ Space session 漂移** = 文件系统（`~/.kodax/sessions/<id>.jsonl` + `~/.kodax/handoffs/<id>.json`）。不走 ACP。

**ACP 在 KodaX 生态的定位**：KodaX 内核继续维护 ACP server，服务**第三方 host**（Zed / Claude Code Desktop / 未来 IDE）。Space 是 KodaX 的 first-party UI，**不通过 ACP 接 KodaX**。

---

## 1. 系统总览

### 1.1 全景图

```text
┌──────────────────────────────────────────────────────────────────┐
│  KodaX Space (Electron app)                                       │
│                                                                   │
│  ┌──────────────────────┐    ┌──────────────────────────────────┐ │
│  │ Renderer (React)     │◄──►│ Main (Node)                      │ │
│  │  • UI / state        │    │  • BrowserWindow / OS API        │ │
│  │  • Monaco / xterm    │    │  • IPC handlers (zod-validated)  │ │
│  │  • Zustand store     │    │  • KodaX runtime (import):       │ │
│  │  • 仅 import KodaX   │    │     - @kodax-ai/coding (agent)   │ │
│  │    类型 + 常量       │    │     - @kodax-ai/llm (providers)  │ │
│  └──────────────────────┘    │     - @kodax-ai/skills           │ │
│            ▲                 │     - @kodax-ai/mcp (host)       │ │
│            │ Electron IPC    │  • NAPI .node 模块（按需）:      │ │
│            │ (contextBridge) │     - @kodax-ai/native-tokenizer │ │
│            ▼                 │     - @kodax-ai/native-diff (M1) │ │
│  ┌──────────────────────┐    │     - …                          │ │
│  │ Preload (sandbox)    │    │  • Keychain / auto-update        │ │
│  └──────────────────────┘    └────────────┬─────────────────────┘ │
└──────────────────────────────────────────┬─┴─────────────────────┘
                                           │ spawn (KodaX 内部已有逻辑)
                          ┌────────────────┼────────────────┐
                          ▼                ▼                ▼
                  ┌────────────┐   ┌────────────┐   ┌─────────────────┐
                  │ LLM provider│   │ MCP server │   │ Repointel       │
                  │ (HTTPS)     │   │ children   │   │ daemon (loopback│
                  │             │   │ (stdio)    │   │ HTTP, KodaX 已  │
                  │             │   │            │   │ 集成)           │
                  └────────────┘   └────────────┘   └─────────────────┘
```

### 1.2 三条不可破坏约束

1. **No-LLM-in-renderer**：renderer 进程绝不直接调 LLM SDK 或任何 KodaX runtime；renderer 只 import 类型/常量
2. **No-tool-execution-in-renderer**：所有 `read/write/edit/bash/grep/...` 工具的执行只在 main 进程
3. **No-duplicate-session-truth**：session 持久化由 KodaX 内核负责，写入 `~/.kodax/sessions/`。Space 仅追加 UI 偏好到 `~/.kodax/space/`

---

## 2. 进程模型

### 2.1 进程列表

| 进程                | 角色                     | 持久             | 内含                                             |
| ------------------- | ------------------------ | ---------------- | ------------------------------------------------ |
| `space-main`        | Electron main（Node）    | 应用周期         | KodaX runtime + LLM/MCP/tool 调用 + IPC handlers |
| `space-preload`     | Electron preload         | 每窗口           | 安全桥（contextBridge）                          |
| `space-renderer`    | React UI                 | 每窗口           | UI only，无 KodaX runtime                        |
| `quick-ask-window`  | 独立 BrowserWindow（M1） | 按需             | Quick Ask popover 的 renderer，共享 main 进程    |
| MCP server children | MCP server               | KodaX 按需 spawn | KodaX 内部管理，Space 不直接接                   |
| Repointel daemon    | 系统级（用户提前安装）   | 系统周期         | KodaX 内核已通过 loopback HTTP 接，Space 无关    |

### 2.2 关键差别（与 sidecar+ACP 模型对比）

- **没有独立 kodax-acp 子进程**——KodaX runtime 跑在 Electron main 里
- **没有 stdio + ACP 协议层**——main 与 KodaX runtime 之间是 function call
- **MCP children 由 KodaX 内核 spawn**——Space 不直接管子进程（除自动更新、OAuth 临时 server 等 OS 任务）
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
│       │   ├── kodax-host.ts        ← KodaX runtime wrapper（import + 事件转发）
│       │   ├── ipc/                 ← zod-validated IPC handlers
│       │   │   ├── session.ts
│       │   │   ├── permission.ts
│       │   │   ├── mcp.ts
│       │   │   └── provider.ts
│       │   ├── keychain.ts          ← OS keychain (keytar)
│       │   ├── auto-update.ts
│       │   └── menus.ts
│       └── renderer/                ← React renderer
│           ├── main.tsx
│           ├── App.tsx
│           ├── features/
│           │   ├── code/            ← Coder 面板（M0）
│           │   ├── partner/         ← Partner 面板（M2）
│           │   ├── quick-ask/       ← Quick Ask popover（M1）
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
│   ├── space-ui-kit/                ← design system
│   └── native/                      ← NAPI-RS 模块（按 ADR-002 候选）
│       ├── tokenizer/               ← @kodax-ai/native-tokenizer (M0 末)
│       ├── diff/                    ← (M1+)
│       └── fuzzy/                   ← (M1+)
├── scripts/
└── docs/
    ├── PRD.md
    ├── HLD.md   ← 本文档
    └── ADR/
```

---

## 4. KodaX 集成

### 4.1 Main 进程的 import 策略

```typescript
// space-main/kodax-host.ts

// Stateful runtime API（agent 执行、tool 调用）
import { runKodaX, KodaXClient, type KodaXEvents, type KodaXMessage } from '@kodax-ai/coding';

// Stateless utilities + 元数据
import { estimateTokens, KODAX_PROVIDERS, getProvider, type KodaXProviderId } from '@kodax-ai/llm';

import { type KodaXToolDefinition, KODAX_TOOL_REQUIRED_PARAMS } from '@kodax-ai/coding';

// Skill 系统
import { SkillRegistry, discoverSkills } from '@kodax-ai/skills';

// Agent 框架（如需直接用 Runner / runFanOut）
import { Runner, generateSessionId } from '@kodax-ai/agent';

// Native 加速器（按需，NAPI-RS）
import { encode } from '@kodax-ai/native-tokenizer'; // M0 末
```

### 4.2 Session 生命周期

```typescript
// 创建 session
const client = new KodaXClient({
  provider: 'zhipu-coding',
  reasoningMode: 'auto',
  session: {
    id: generateSessionId(),
    storage: new FileSessionStorage(), // 写到 ~/.kodax/sessions/
  },
  events: {
    onTextDelta: (text) => mainWindow.webContents.send('session.textDelta', { id, text }),
    onToolUse: (call) => mainWindow.webContents.send('session.toolCall', { id, call }),
    onToolResult: (result) => mainWindow.webContents.send('session.toolResult', { id, result }),
    onComplete: () => mainWindow.webContents.send('session.complete', { id }),
    onError: (err) => mainWindow.webContents.send('session.error', { id, error: err.message }),
  },
});

// 用户发消息
await client.send(userPrompt);

// 权限请求
events.onPermissionRequest = async (req) => {
  mainWindow.webContents.send('permission.request', { id, req });
  return await new Promise<PermissionDecision>((resolve) => {
    ipcMain.once(`permission.answer.${id}`, (_, decision) => resolve(decision));
  });
};
```

### 4.3 KodaX runtime 失败处理

| 失败                   | 处理                                                                             |
| ---------------------- | -------------------------------------------------------------------------------- |
| `runKodaX` 抛 uncaught | main 进程 `uncaughtException` handler 兜底；UI 显示错误 + 提供 "restart session" |
| LLM 网络错误           | KodaX 内核已有重试；Space 仅显示状态                                             |
| MCP server 崩溃        | KodaX 内核已有重启逻辑；Space 仅显示状态                                         |
| Main 进程崩溃          | Squirrel auto-update 检测；下次启动恢复 session                                  |
| 长 session 内存压力    | M0 不优化；M2 评估切 utilityProcess（见 ADR-003 reconsider 触发器）              |

### 4.4 ACP 与 Space 的关系

**Space 不用 ACP**。KodaX 内核的 ACP server (`src/acp_server.ts`) 继续维护，但服务对象是：

- Zed editor
- Claude Code Desktop
- 未来其他第三方 IDE / 桌面 host

KodaX ACP 演进（如新增 notification / endpoint）对 Space **没有直接影响**——Space 是 SDK 消费者，跟 SDK 走，不跟 ACP 走。

---

## 5. 复用 KodaX SDK

### 5.1 包级用法

| KodaX 包                                                  | Main 进程 import?                  | Renderer 进程 import?             |
| --------------------------------------------------------- | ---------------------------------- | --------------------------------- |
| `@kodax-ai/coding` (runKodaX, KodaXClient, tools)         | ✅ 完整                            | ❌ 仅类型                         |
| `@kodax-ai/llm` (provider catalog, estimateTokens, types) | ✅ 完整                            | ✅ 类型 + 常量（KODAX_PROVIDERS） |
| `@kodax-ai/skills` (SkillRegistry, discoverSkills)        | ✅                                 | ❌ 仅类型                         |
| `@kodax-ai/agent` (Runner, generateSessionId, types)      | ✅                                 | ✅ 仅类型                         |
| `@kodax-ai/repl` (Ink TUI)                                | ❌ terminal-only                   | ❌                                |
| `kodax` (root, CLI binary + `runKodaX` 总入口聚合)        | 可选；通常按需 import 各 scoped 包 | ❌                                |

注：KodaX 在 monorepo 中以 `@kodax-ai/*` 多包形式发布，每个包独立 scope，**不是** `@kodax-ai/kodax` 的子路径。
本仓库中 ADR-003、HLD 早期描述用过 `@kodax-ai/kodax/coding` 这种命名 —— 已经修正为正确的 scoped 包名。

### 5.2 SDK 拉入方式

- **推荐**：`npm install @kodax-ai/coding @kodax-ai/llm @kodax-ai/agent @kodax-ai/skills` 按需拉，pin 同一版本
- **同仓开发**：`file:../KodaX/packages/<name>` 指向相邻 KodaX checkout（npm 自动符号链接；KodaX 自身 node_modules 提供 sibling deps）
- **CI**：在 KodaX 发到公开 npm 前，Space CI 用 Mock adapter，不依赖 KodaX checkout；Real adapter 接入后 CI 加 KodaX 拉取步骤

Space 与 KodaX 走 npm semver 兼容；不引入协议版本协商（无 ACP）。

### 5.3 CI 不变量

允许：

- ✅ `space-main` import `@kodax-ai/{coding,llm,skills,agent}` 全部 API
- ✅ `space-renderer` import `@kodax-ai/{llm,agent}` 的**类型 + 常量**（bundle 时仅保留类型，runtime 不进 renderer）

禁止：

- ❌ `space-renderer` 的 bundle 含 `@anthropic-ai/sdk` / `openai` / 任何 LLM SDK runtime
- ❌ `space-renderer` 的 bundle 含 `runKodaX` / `KodaXClient` / `executeTool` runtime
- ❌ Space 任意进程含 KodaX 内部 coding tool 实现的 fork

CI 加 `depcheck` + `ts-prune` + 自定义 ESLint 规则（`no-restricted-imports`）阻断。

---

## 6. MCP / Connector / Skill / 扩展生态

### 6.1 MCP

KodaX 内核已有 `@kodax-ai/mcp` 包，统一管 MCP server 子进程。Space 的角色：

- UI 层提供 MCP server 列表、启停开关、`.mcpb` 一键安装
- 配置写入 KodaX 认识的位置（与 CLI / REPL 共享）
- MCP server 进程由 KodaX 内核 spawn / 监督——Space 不直接管子进程

### 6.2 `.mcpb` Desktop Extension

`.mcpb` 是 Anthropic 推动的桌面扩展格式。实现：

1. UI: "Install extension..." → 文件选择 / 拖拽
2. Main 解析 manifest，写入临时目录
3. Main 调用 `KodaX.mcp.installExtension(manifestPath)` （KodaX 内核新增 API，可与 CLI 共享）
4. KodaX 验证 + 注册 + 重启相关 server
5. UI 渲染新增 server

兼容性：Anthropic 官方 `.mcpb` 包未魔改时 100% 可用。

### 6.3 Connector（OAuth-flavored MCP）

M2 实现：

- 内置 Connector 目录（metadata only）
- 用户点 "Connect GitHub" → main 起本机 loopback HTTP 接 OAuth 回调
- token 写入 keychain → main 把 token 注入对应 MCP server 的 env

### 6.4 Skill

由 KodaX 已有的 `@kodax-ai/skills` 包管理：

- Skill 发现路径：`~/.kodax/skills/`、`<project>/.kodax/skills/`、Space 内置
- UI 提供 Skill 浏览器：直接调 `discoverSkills()` + `SkillRegistry`
- 自然语言触发逻辑在 KodaX；Space 在触发后显示 `skill-active` 标签

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
- M2 引入 Agent sandbox 模式：worktree 复制到 `.kodax/sandbox-<id>/`，agent 在副本执行

---

## 8. 权限与审计

### 8.1 三层权限

1. **KodaX 内核层**（`confirmTools` / `Allow patterns` / 危险命令黑名单——已存在）
2. **Space UI 层**（弹窗组件、"Always allow" 持久化——写回 `~/.kodax/permissions.json`）
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
- M3 企业：syslog forwarder（main 进程 tap KodaX 事件流）

---

## 9. UI 架构

### 9.1 Renderer 技术栈

| 选择                  | 理由                              |
| --------------------- | --------------------------------- |
| React 18 + TypeScript | 与 KodaX REPL (Ink) 同源          |
| Vite                  | HMR 快                            |
| Zustand               | 轻量 store                        |
| Tailwind + shadcn/ui  | 主题与组件库                      |
| Monaco Editor         | diff + 只读浏览（非主编辑工作流） |
| xterm.js + node-pty   | 内置终端                          |
| Mermaid / Recharts    | session lineage 图、token 仪表盘  |

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

> Partner surface 的完整决策见 [ADR-007](ADR/ADR-007-partner-surface-model.md)：Partner = 同一 KodaX runtime 上的**画像组合**（surface spec + skill packs + artifact），不等独立内核。本节给数据形态。

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

**`agentProfile='partner'` 的下发路径**：不是 KodaX 预置的内核画像，而是 Space 用 `createAgent({ instructions, tools, reasoning })` 构造、经 SDK「自定义画像走完整 harness」入口（R1/R2）运行——与 Coder 共用同一 substrate 管线。SDK 入口就绪前，该层用 Space 侧 workaround / 降级（参 [ADR-007](ADR/ADR-007-partner-surface-model.md) 依赖段）。

**Artifact 模型**：Partner 产出（report/slides/sheet/doc）登记为可预览、可迭代（带版本）、可导出的 artifact 对象，由 renderer 在右栏 `doc-workspace` 预览；底层可复用 SDK 已有的 artifact / `KodaXInputArtifact` 概念。

- M0：renderer 只渲染 Code surface，顶部无 tab 切换器
- M1：加 Quick Ask popover（独立 frameless `BrowserWindow`）
- M2：Partner surface（spec + doc-workspace + skill packs + artifact 三件套先行）上线，顶部 `[Coder] [Partner]` tab；隐式入口（拖文件 / 非 git 目录自动判定）作主入口，tab 作锚点
- 后续：H1-Partner 完整 harness 随 SDK R1/R2 接通

### 9.5 三个 BrowserWindow

- `mainWindow`：托管 `surface='code'`（M2 起 `'partner'`），完整布局
- `quickAskWindow`：M1 起按需创建，frameless，与 mainWindow 共享同一 main 进程的 KodaX runtime——只是用不同临时 KodaXClient 实例
- 其他独立窗口：multi-window（M1）允许用户拆分 session 到不同窗口

---

## 10. 跨 Surface（Space ↔ CLI/REPL）

### 10.1 Session ID 全局唯一

KodaX 内核 `generateSessionId()` 已存在；Space 使用同一函数，session 文件 / lineage 完全互通。

### 10.2 文件级 Teleport 协议（不走 ACP）

```text
CLI → Space:
  $ kodax --session abc123 --teleport space
    → KodaX 写 ~/.kodax/handoffs/abc123.json
       { cwd, provider, mode, last-message-id, pid }
    → CLI 进程退出

Space main 周期性 watch ~/.kodax/handoffs/
  → 发现 abc123.json → 弹通知 "Continue session abc123 from terminal?"
  → 用户确认 → main 用 KodaXClient resume(sessionId=abc123)
  → handoff 文件删除

Space → CLI:
  Space UI: "Continue in terminal"
    → main 写 ~/.kodax/handoffs/abc123-to-cli.json
    → 启动 OS terminal (`open -a Terminal` / `wt.exe` / `gnome-terminal`)
    → 终端跑 `kodax --session abc123 --pickup`
```

### 10.3 并发安全

- 同一 sessionId 在 CLI / Space 不能同时**写**——基于 `~/.kodax/sessions/<id>.lock`（pid + start time）
- 写者必须持锁；只读 mirror 允许多个

---

## 11. 技术栈决策（最终）

| 层                | 选择                                                                                                |
| ----------------- | --------------------------------------------------------------------------------------------------- |
| Shell             | **Electron 30+** ([ADR-001](ADR/ADR-001-shell-electron.md))                                         |
| Renderer          | **React 18 + Vite + TypeScript + Zustand + Tailwind + shadcn/ui**                                   |
| Editor 组件       | Monaco（只读 + diff）                                                                               |
| 终端组件          | xterm.js + node-pty                                                                                 |
| KodaX 集成        | **in-process import**（不 ACP，不 sidecar）([ADR-003](ADR/ADR-003-kodax-integration-in-process.md)) |
| Rust 加速         | **按需 NAPI-RS 热路径模块**（A+C 模式）([ADR-002](ADR/ADR-002-rust-integration-napi.md))            |
| Native 第一 crate | `@kodax-ai/native-tokenizer`（M0 末，tiktoken-rs 10×）                                              |
| IPC schema        | zod，验证所有 renderer↔main channel                                                                 |
| Keychain          | `keytar`（Win Credential Manager / macOS Keychain / libsecret）                                     |
| 自动更新          | Squirrel.Mac + Squirrel.Windows                                                                     |
| 安装包            | NSIS (Win) + .dmg + .pkg (macOS notarized) + AppImage/.deb (Linux M3)                               |
| 测试              | Vitest（unit）+ Playwright for Electron（E2E）                                                      |

### 11.1 不引入

- 不引入 Tauri（见 ADR-001）
- 不引入 Next.js（renderer 不是 SSR）
- 不引入 GraphQL（IPC 用 zod 已足够）
- 不引入 SQLite（M0 不需要；M2 评估 audit log 索引）
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
- `~/.kodax/<其他>` 由 KodaX runtime 写（在 main 进程内）
- 不在 renderer 进程写盘
- 备份策略：M2 引入 `~/.kodax/space/backup/<date>/`

### 12.2 配置版本化

每个 JSON 含 `schemaVersion`；启动时 main 跑 `migrators[][]` 链；失败回滚到上一版（保留 `.bak`）。

---

## 13. 安全模型

### 13.1 威胁模型（简化 STRIDE）

| 威胁                   | 场景                   | 缓解                                         |
| ---------------------- | ---------------------- | -------------------------------------------- |
| Spoofing               | 假 MCP server 冒充官方 | M2 扩展签名 + 显式列表                       |
| Tampering              | 恶意 skill 改用户文件  | Skill sandbox / Permission gating            |
| Repudiation            | 用户否认操作           | Tamper-evident audit log + signed transcript |
| Information disclosure | API key 泄露           | OS keychain + redact in logs                 |
| DoS                    | MCP fork bomb          | child_process resource limits + watchdog     |
| Privilege escalation   | 利用 IPC 突破 sandbox  | contextIsolation + zod schema 校验           |

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

- macOS：Squirrel.Mac + Sparkle 风格 channel；签名 + notarize 必须
- Windows：Squirrel.Windows + EV 证书
- Linux（M3）：AppImage 自更，deb 走系统包
- 通道：`stable` / `beta`

---

## 14. 可观测性

| 层            | 路径                                    | 内容                                        |
| ------------- | --------------------------------------- | ------------------------------------------- |
| Electron main | `~/.kodax/space/logs/main-YYYYMMDD.log` | 启动、IPC schema reject、KodaX runtime 异常 |
| Renderer      | 经 IPC 转发到 main 日志                 | UI 错误                                     |
| KodaX runtime | 复用 KodaX 已有日志栈（同 main 进程）   | tool call / LLM 元信息                      |
| Repointel     | 由 Repointel daemon 管理                | —                                           |

- Tracing：KodaX 已有 `@kodax-ai/tracing`；Space 直接订阅 span event 渲染时间线
- Trace 导出：OTLP JSON（M2）
- Crash 报告：Electron `crashReporter`，M0 写本地 dump；M1 上传到自有 Sentry（不含任务内容）

---

## 15. 构建与发布

### 15.1 构建 pipeline

```text
1. monorepo install (npm/pnpm workspaces)
2. NAPI crates build:
   - cargo build per platform target → .node binaries
   - 发到 npm 为 platform-specific packages (M0 末从 1 个 crate 开始)
3. Electron renderer: vite build
4. Electron main: esbuild bundle
5. electron-builder 打包:
   - macOS: .dmg + .pkg (notarized)
   - Windows: NSIS .exe + .msi
   - Linux (M3): AppImage + .deb
6. 代码签名
7. 自动更新清单生成
8. 发布到 GitHub Releases + 官网 channel
```

### 15.2 平台支持

| 平台          | M0  | M1  | M2  | M3  |
| ------------- | --- | --- | --- | --- |
| macOS arm64   | ✅  | ✅  | ✅  | ✅  |
| macOS x64     | ✅  | ✅  | ✅  | ✅  |
| Windows x64   | ✅  | ✅  | ✅  | ✅  |
| Windows arm64 | —   | ✅  | ✅  | ✅  |
| Linux x64     | —   | —   | —   | ✅  |
| Linux arm64   | —   | —   | —   | —   |

### 15.3 NAPI crate 发布矩阵

每个 NAPI crate 发布 6 个 platform-specific npm package + 1 metapackage：

```
@kodax-ai/native-tokenizer            ← metapackage with optionalDependencies
@kodax-ai/native-tokenizer-win32-x64
@kodax-ai/native-tokenizer-win32-arm64
@kodax-ai/native-tokenizer-darwin-x64
@kodax-ai/native-tokenizer-darwin-arm64
@kodax-ai/native-tokenizer-linux-x64
@kodax-ai/native-tokenizer-linux-arm64
```

CI 用 GitHub Actions matrix per platform 构建。

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
| Intent Gate / Direct Path | 在 KodaX runtime 内（in-process）；UI 仅看结果                                                                  |
| Scout / AMA Control Plane | 仅以"模式徽标 + Round"体现；不绘制内部图                                                                        |
| Coding Runtime            | 全部在 main 进程 KodaX runtime                                                                                  |
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

### 19.1 KodaX Partner 接入（M2）

无需新协议层：

- KodaX 内核加 Partner profile（不同 system prompt + 工具白名单 + skill 子集）
- Space 在 main 进程用同一 KodaX SDK 起 Partner-flavored client
- Renderer 渲染 Partner surface spec

### 19.2 Routines / Automations（M3）

不做云托管。本地路径：

- Space 提供 schedule 编辑器
- 写入 OS 任务（launchd / Task Scheduler / systemd timer）
- 到期 spawn `kodax --session ... --once` one-shot
- 完成后写 handoff 文件，Space 启动时通知

### 19.3 Enterprise（M3）

- 团队配置文件下发（policy JSON via MDM）
- Provider 网关（公司自托管 endpoint，按用户接到自己的 key）
- 中央审计（SIEM 导出）
- RBAC（参考 Claude Cowork 企业版 6 件套）

---

## 20. 路线图

### M0 — 内核打通（4-6 周）

| 任务                                                  | 类别 |
| ----------------------------------------------------- | ---- |
| Electron 骨架 + Vite + React + TypeScript + Zustand   | 工程 |
| Main 进程 KodaX runtime wrapper（`kodax-host.ts`）    | 工程 |
| IPC schema (zod)                                      | 工程 |
| 对话流 UI + tool call 折叠                            | UI   |
| Work 进度条 + reasoning mode 切换                     | UI   |
| Subagent tree 视图                                    | UI   |
| 文件面板（Monaco read-only / diff）                   | UI   |
| Provider 配置 GUI（写 keychain）                      | 工程 |
| MCP 管理 v1（列表 + 启停）                            | 工程 |
| Permission 弹窗组件                                   | UI   |
| 内置终端（xterm.js + node-pty 单 tab）                | 工程 |
| **第一个 NAPI crate**（`@kodax-ai/native-tokenizer`） | 工程 |
| 安装包：Win .exe + macOS .dmg unsigned                | 发布 |

### M1 — 公开 Beta（6-8 周）

| 任务                                                          | 类别      |
| ------------------------------------------------------------- | --------- |
| Quick Ask popover（全局热键 + 浮窗 + 临时 plan-mode session） | UI/工程   |
| Repointel 状态条 + 一键 warm                                  | 工程      |
| Session lineage 图                                            | UI        |
| CLI ↔ Space 文件级 teleport                                   | 工程      |
| `.mcpb` 一键安装                                              | 工程      |
| 自动更新（Squirrel）                                          | 工程      |
| 桌面通知                                                      | 工程      |
| 内置终端多 tab                                                | 工程      |
| 文件富预览（PDF / docx / xlsx）                               | 工程      |
| 主题（明/暗/跟随）                                            | UI        |
| NAPI: `native-diff` / `native-fuzzy`（按 profile）            | 工程      |
| 代码签名（macOS notarize / Win EV）                           | 发布      |
| 隐私政策 + 文档站                                             | 法务/文档 |

### M2 — Partner + 拓展（2026-Q4）

| 任务                                       | 类别 |
| ------------------------------------------ | ---- |
| Partner 面板骨架 + `[Coder] [Partner]` tab | UI   |
| 非编码 skill 包（3 个起步）                | 内容 |
| Connector：GitHub / GitLab / Slack         | 工程 |
| Automatic Review Agent                     | 工程 |
| Hook 编辑器 v1                             | UI   |
| Skill 市场（只读浏览）                     | 工程 |
| 远端 KodaX runner（SSH/Docker exec）       | 工程 |
| Agent sandbox（worktree 自动复用）         | 工程 |

### M3 — GA & 企业（2027-Q1）

| 任务                                  | 类别 |
| ------------------------------------- | ---- |
| 企业策略（provider 网关、扩展白名单） | 工程 |
| 中央审计（syslog / SIEM 导出）        | 工程 |
| 团队配置文件下发                      | 工程 |
| 本地 Automations（webhook / cron 桥） | 工程 |
| MSI 安装 + AD/MDM 集成                | 发布 |
| Linux 支持（AppImage + deb）          | 发布 |

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
