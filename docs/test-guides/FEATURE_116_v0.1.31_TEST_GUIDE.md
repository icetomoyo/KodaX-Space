# F116 Runtime Host Adapter - 人工测试指导

## 功能概述

**功能名称**：Runtime Host Adapter and Capability Negotiation<br>
**Feature ID**：F116<br>
**目标版本**：v0.1.31<br>
**测试日期**：2026-07-12<br>
**测试人员**：待填写

F116 把 KodaX Space 的 managed run 主链迁移到 KodaX `0.7.67` 公共 Runtime facade。用户仍使用原来的 Coder、Partner、权限弹窗、队列、历史、Workflow、MCP 与 External Agent 界面；主要可见效果是运行、取消、恢复和失败收口更稳定，并产生 Runtime `runId`、事件日志与诊断信息，供后续 Memory、Learning、Automation 和运行健康功能复用。

本版本采用 inline Runtime。Worker 和 daemon 不属于 v0.1.31；Partner 工具、权限决策、MCP 进程生命周期、External Agent durable store 继续由 Space 管理。

## 测试环境

### 前置条件

- 使用包含 F116 的 v0.1.31 构建，KodaX 依赖为 `0.7.67`。
- 准备一个可写的测试项目目录和一个可正常调用的 Provider。
- 测试数据必须使用独立 profile，例如：
  - `$env:KODAX_PROFILE_DIR = "$env:TEMP\kodax-space-f116-manual"`
  - 或 `$env:KODAX_TEST_ONBOARDING = "f116-manual"`
- 默认不设置 `KODAX_SPACE_RUNTIME_HOST`，此时选择 Runtime。
- 回滚用例单独设置 `KODAX_SPACE_RUNTIME_HOST=legacy`，完成后清除。
- 测试前记录 profile 中既有 session 数量；不要使用真实生产 profile 做破坏性测试。

### 重点观察

- 每次发送只产生一轮回复，不重复执行工具。
- 每轮只有一个完成、失败或取消终态。
- 历史 session、Partner 来源、权限弹窗和 Workflow 行为保持兼容。
- 关闭应用后无持续输出、悬挂任务或重复启动的 MCP 进程。

## 测试用例

### TC-001：默认 Runtime managed run

**优先级**：高<br>
**类型**：正向测试

**步骤**：

1. 清除 `KODAX_SPACE_RUNTIME_HOST` 后启动 Space。
2. 新建 Coder session，发送“读取当前项目 package.json，并概括 scripts；不要改文件”。
3. 等待回复完成。
4. 打开版本/能力信息，检查 Runtime Host Adapter 状态。

**预期效果**：

- [ ] session 正常流式输出并只完成一次。
- [ ] 工具调用只执行一次，没有重复读取或重复回复。
- [ ] Runtime Host Adapter 显示 `supported`，详情包含 KodaX Runtime 版本和 `embedded/inline`。
- [ ] Coder、Partner、MCP、权限或 External Agent 的所有权没有被错误显示为全部 Runtime-native。

### TC-002：历史连续性和恢复

**优先级**：高<br>
**类型**：兼容性测试

**步骤**：

1. 在 TC-001 session 中继续发送一轮消息并记住回复内容。
2. 完全退出 Space，再使用同一 profile 启动。
3. 从历史列表打开该 session。
4. 发送一个依赖上一轮上下文的问题。

**预期效果**：

- [ ] 重启前的完整对话仍按原顺序显示。
- [ ] session 标题、工作面归属和项目目录正确。
- [ ] 新一轮能使用旧上下文回答，不创建重复历史 session。
- [ ] Runtime 初始化不会覆盖已有 transcript。

### TC-003：取消和单一终态

**优先级**：高<br>
**类型**：负向测试

**步骤**：

1. 发送一个会持续较久的任务，例如要求扫描多个目录并给出报告。
2. 在 token 或工具仍在运行时点击停止。
3. 等待 3 秒，再发送一个简短问题。

**预期效果**：

- [ ] 停止后不再继续产生 token 或工具活动。
- [ ] UI 只显示一个取消终态，不同时出现完成和错误。
- [ ] 排队的 after-turn 提示不会在取消后偷偷继续。
- [ ] 同一 session 随后可以正常开始新一轮。

### TC-004：权限桥接不重复

**优先级**：高<br>
**类型**：安全测试

**步骤**：

1. 将权限模式设为需要确认的模式。
2. 要求 agent 创建一个测试文件。
3. 在权限弹窗中先拒绝，确认本轮行为。
4. 再次请求并允许一次。

**预期效果**：

- [ ] 每个工具调用最多出现一个 Space 权限弹窗。
- [ ] 拒绝时文件不落盘，允许时只写一次。
- [ ] 不出现 Runtime 与 Space 两套权限决策互相竞争。
- [ ] 完成或失败终态仍只有一个。

### TC-005：fork、rewind 和 compact

**优先级**：高<br>
**类型**：正向/边界测试

**步骤**：

1. 在包含至少三轮对话的 session 上执行 fork。
2. 确认源 session 和子 session 都可继续使用。
3. 在子 session 上 rewind 到较早一轮，再发送新问题。
4. 在源 session 上执行 compact，然后重启并查看历史。

**预期效果**：

- [ ] fork 只生成一个新 session，标题带单个 `(fork)`。
- [ ] rewind 后被截断的分支不会继续影响新回复。
- [ ] compact 显示合理统计；压缩前的历史仍能在 UI 回放。
- [ ] 重启后源/子 session、lineage 和标题保持正确。

### TC-006：Partner 能力保持

**优先级**：高<br>
**类型**：兼容性测试

**步骤**：

1. 新建 Partner session，添加一个现有支持的来源。
2. 要求 Partner 基于来源生成一份结果或交付物。
3. 触发一个 Partner 专属工具或 profile 行为。
4. 重启并恢复该 session。

**预期效果**：

- [ ] Partner profile、来源上下文和工具均可用。
- [ ] 输出只生成一次，artifact 仍归属正确 session。
- [ ] 恢复后仍显示为 Partner，不被误归为 Coder。
- [ ] Runtime 没有创建第二套 Partner 或 artifact store。

### TC-007：Workflow 生命周期桥接

**优先级**：中<br>
**类型**：正向测试

**步骤**：

1. 启动一个可暂停的 Workflow。
2. 依次执行 pause、resume，最后 stop。
3. 查看 Workflow 列表、详情、结果和 artifact。

**预期效果**：

- [ ] pause/resume/stop 返回成功且状态及时更新。
- [ ] stop 后子任务不再继续运行。
- [ ] Space 的名称、origin、结果、artifact、delete/prune 能力仍可使用。
- [ ] 列表中没有同一 run 的重复记录。

### TC-008：Runtime 初始化失败前的 legacy 回滚

**优先级**：高<br>
**类型**：恢复测试

**步骤**：

1. 完全退出应用。
2. 设置 `$env:KODAX_SPACE_RUNTIME_HOST = "legacy"` 后启动。
3. 新建 session 并完成一轮只读任务。
4. 查看版本/能力信息。
5. 退出并清除该环境变量。

**预期效果**：

- [ ] 应用可启动，任务仍可正常完成。
- [ ] 能力信息明确显示内部 legacy rollback 为 `partial`，而不是伪装成 Runtime ready。
- [ ] 不创建 Runtime-managed run。
- [ ] legacy 和 Runtime 模式读取同一 profile 历史，不丢失 session。

### TC-009：失败收口和禁止中途重放

**优先级**：高<br>
**类型**：负向测试

**步骤**：

1. 使用一个无效 Provider 配置或临时撤销凭据，让 run 在 Runtime 接受后失败。
2. 发送一条会触发 Provider 调用的消息。
3. 观察终态和文件/工具副作用。

**预期效果**：

- [ ] UI 只显示一个清晰的失败终态。
- [ ] Space 不会在失败后自动用 legacy 重放同一 prompt。
- [ ] 没有重复工具调用、重复文件写入或重复用户消息。
- [ ] 修复 Provider 后，同一 session 可以开始新一轮。

### TC-010：路径隔离和关闭清理

**优先级**：高<br>
**类型**：安全/生命周期测试

**步骤**：

1. 使用独立 `KODAX_PROFILE_DIR` 启动并完成一轮任务。
2. 检查 `<profile>/sessions` 和 `<profile>/.kodax/runtime`。
3. 在一轮长任务运行中直接关闭 Space。
4. 等待 5 秒，检查进程和日志；重新启动应用。

**预期效果**：

- [ ] session 与 Runtime journal 都只写入测试 profile，不触碰真实 `~/.kodax`。
- [ ] 关闭后无残留活动 run、持续日志或悬挂子进程。
- [ ] 重启后应用能正常初始化，不报告重复 Runtime owner。
- [ ] MCP server 不因 Runtime 接入而出现双实例。

## 边界用例

### BC-001：快速连续停止

连续点击停止或在停止后立即关闭应用，不应产生多个取消终态，也不应卡住退出。

### BC-002：空白新 session

创建 session 后不发送消息就退出；重启后不应出现损坏 transcript，首次发送时 Runtime 应安全 ensure session。

### BC-003：并行 session

在两个不同 session 中同时运行任务，两边的 token、工具、权限和 artifact 不能串线；同一 session 仍由 Space 队列串行化。

## 测试总结

| 用例数            | 通过 | 失败 | 阻塞 |
| ----------------- | ---- | ---- | ---- |
| 10 + 3 个边界用例 | -    | -    | -    |

**测试结论**：待填写<br>
**发现的问题**：待填写

## 自动化验证基线

实现阶段已通过以下自动化门槛，人工测试重点验证真实 Provider、UI 反馈、权限交互与应用生命周期：

- Runtime/SDK 兼容性和适配器测试：9/9；
- 相关 session/workflow/path 回归：141/141；
- Desktop 全量单元测试：1376/1376；
- Playwright Electron E2E：58/58；
- TypeScript typecheck：通过；
- ESLint（0 warnings）：通过。

---

_测试指导生成时间：2026-07-12_<br>
_Feature：F116 / v0.1.31_
