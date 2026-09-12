# ADR-005: Permission Profiles — 对齐 KodaX canonical 4 profiles

- **Status**: Accepted
- **Date**: 2026-09-03
- **Supersedes**: 本 ADR 的 canonical 3 mode + Auto engine 决策
- **Companion**: [ADR-003 KodaX 集成模式](ADR-003-kodax-integration-in-process.md)
- **Source of truth**: `@kodax-ai/kodax@0.7.96-rc.1` public permission and Runtime contracts

## Context

KodaX 0.7.96 移除了可选择的 Auto Rules engine，把权限用户面统一为四个 profile：Plan、Edits、Auto[LLM] 和 Full Access。`auto-in-project`、Rules、engine、timeout 与 speculative window 仅作为旧数据迁移输入；它们不能恢复旧权限路径。

Space 如果继续保存或展示 Auto engine，会制造 SDK 不再拥有的状态，并让 daemon、embedded Coder、Partner、IPC 与 Renderer 对同一 Session 得出不同权限语义。旧 `sandbox.envPass` 同样已经失效：sandbox 默认继承宿主环境，同时固定阻止 KodaX/Electron 执行控制变量。

## Decision

Space 只暴露并持久化四个 canonical profile：

```ts
export const permissionModeSchema = z.enum([
  'plan',
  'accept-edits',
  'auto',
  'full-access',
]);
```

| Profile | Space 用户面 | 执行边界 |
| --- | --- | --- |
| `plan` | Plan | 只读规划；mutating 工具 fail closed |
| `accept-edits` | Edits | 编辑可直接批准；shell、network 与其他副作用仍走边界确认 |
| `auto` | Auto[LLM] | sandbox-first；只有可证明命令尚未启动的宿主边界才进入 Exec Policy 与固定 LLM reviewer |
| `full-access` | Full Access | 跳过 sandbox 与 Auto review，直接在宿主执行；Exec Policy 仍然有效 |

### Auto 固定为 Auto[LLM]

- 删除 Auto engine setter、事件、slash command、selector 子菜单和 Runtime timing/window 投影。
- 旧 `auto-in-project` 与 Rules 选择迁移为 `auto`。
- 旧 engine/timing/window 字段可在兼容解析时被读取，但必须在下一次规范化写入时移除。
- Auto 先尝试 sandbox。sandbox 成功即静默完成；started 或 uncertain 命令绝不重放。
- reviewer 基础设施失败时 fail closed，不自动打开审批提示，也不切换到 Rules。

### Full Access 不是 bypass-everything

`full-access` 直接宿主执行，不经过内置危险命令兜底确认。显式 forbid 仍拒绝；prompt 规则在 Never 审批语义下拒绝执行。Space 不复制或弱化该策略。

### 文本写入与模型权限事实（0.7.96-rc.1）

- Runtime 与直接 SDK 的 Full Access 文本操作可写工作区外普通目标；Auto 审批只授权本次具体调用的精确目标，不向后续调用或整个目录扩权。控制文件保护和原生事务完整性仍由 SDK 持有。
- Space 启动、daemon 协商和打包验证要求 `runtimeAutoModeGuardrail` v6；旧 daemon 不能继续提供 v5 权限语义。
- 模型请求中的有效权限事实由 SDK 生成，不从 `config.json` 默认值推断。Runtime 使用实时 Session settings；嵌入式执行显式提供与本次 Run guardrails/broker 一致的模式快照，下一 Run 重新绑定。

### Sandbox 配置归属

Space 保留 doctor/setup/readiness 界面，但不再编辑、写入或向 Run 投影 `sandbox.envPass`。旧字段可在只读兼容视图中出现，用于解释迁移状态；它不产生权限或环境透传效果。

### Capability gates

当前集成要求：

- `sandboxRuntime:11`
- `runtimeAutoModeGuardrail:6`
- `sharedSessionSettings:2`
- `providerCredentialBroker:2`
- `effectiveConfig:1`

这些能力在 SDK 启动、daemon 准入、连接后 Runtime 和发布 smoke 边界显式验证，不由 SemVer 推断。

## Migration

| Legacy value | Canonical result |
| --- | --- |
| `plan-mode` | `plan` |
| `default`, `ask-permissions` | `accept-edits` |
| `auto-in-project`, Auto Rules | `auto` |
| `bypass-permissions` | `full-access` |

Legacy Auto engine/timing/window 与 `sandbox.envPass` 不迁移成新的控制项；规范化保存时移除。

## Consequences

- IPC、Runtime 设置、持久化、slash、ModeSelector 与手册使用同一四档语义。
- Space 不再维护第二套 Auto engine 状态，也不再承担 sandbox 环境 allow-list 写路径。
- Embedded Partner 仍可使用 Space broker；Runtime Coder 的 sandbox、Auto reviewer 与 Exec Policy authority 归 KodaX SDK/daemon。
- Shift+Tab 循环与 `/mode` 接受四个 canonical profile。

## Reconsider When

仅当 KodaX 发布新的 canonical permission profile 或公开能力契约时重新审议；不为假设性 engine、timing 或 sandbox 配置预留扩展点。
