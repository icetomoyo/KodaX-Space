# F115 External Agent Orchestration Gateway - 人工测试指导

## 功能概览

**功能名称**：KodaX 0.7.67 Reference External Agent 对接
**版本**：v0.1.30
**测试日期**：2026-07-12
**测试人员**：待填写

本指导覆盖 Reference Agent 注册与管理、实时预检、Workflow 默认子 Agent 路由、Task Dock 生命周期与人工干预，以及中英文本地化。A2A、MCP Tasks 和 Governed HTTP 尚未由 KodaX 0.7.67 提供适配器，界面必须保持隐藏或明确不可用。

## 测试环境

### 前置条件

- Windows 桌面环境，可启动 KodaX Space v0.1.30。
- 依赖解析为 `@kodax-ai/kodax@0.7.67`。
- 新建或选择一个可用项目与会话。
- 测试期间无需安装 Figma，也无需第三方网络端点或凭据。

## 测试用例

### TC-001：Reference Agent 注册与安全展示

**优先级**：高
**类型**：正向/UI/安全

**测试步骤**：

1. 打开 Settings → Runtime → External Agents。
2. 点击 Add Reference Agent。
3. 输入显示名称、描述与两个技能，保存。
4. 检查新注册卡片。

**预期结果**：

- [ ] 卡片显示启用状态、可调度状态、技能、输入能力及“不访问网络/不写工作区”说明。
- [ ] 仅显示不透明 `agentId`，不显示 endpoint、credential、executorConfig 或其他秘密。
- [ ] Reference 标为可用；A2A、MCP Tasks、Governed HTTP 不提供可操作入口。

### TC-002：编辑、禁用与删除

**优先级**：高
**类型**：正向/负向

**测试步骤**：

1. 编辑 TC-001 的 Agent 名称和技能后保存。
2. 禁用该 Agent，并刷新列表。
3. 打开 Workflow 启动器。
4. 重新启用该 Agent，然后删除，确认危险操作。

**预期结果**：

- [ ] 编辑后卡片立即显示新配置修订与内容。
- [ ] 禁用项保留在管理列表，但不出现在 Workflow 可调度列表。
- [ ] 删除前有明确确认；删除后管理与可调度列表均不再出现该项。

### TC-003：实时预检与一致性保护

**优先级**：高
**类型**：正向/边界

**测试步骤**：

1. 注册并启用一个 Reference Agent。
2. 点击 Test / Preflight。
3. 在 Workflow 启动器选择该 Agent。
4. 返回设置修改 Agent 配置，再尝试使用旧选择启动。

**预期结果**：

- [ ] 预检给出可用状态与安全效果声明。
- [ ] 启动前再次执行实时预检。
- [ ] 配置修订不一致时明确失败，不静默使用已变化配置或切换目标。

### TC-004：Workflow 默认子 Agent 路由

**优先级**：高
**类型**：正向/兼容性

**测试步骤**：

1. 打开 Workflow 启动器。
2. 选择一个内置或已保存 Workflow。
3. 在 Default child Agent 中选择 Reference Agent 并启动。
4. 使用含显式子 Agent target 的 Workflow 重复测试。

**预期结果**：

- [ ] 选择项来自当前实时可调度列表，并显示技能与状态。
- [ ] 未显式指定目标的子任务继承所选 Reference Agent。
- [ ] Workflow 源码中的显式 target 保持优先，不被启动器默认项覆盖。
- [ ] 不选择外部 Agent 时，现有 native child 行为不变。

### TC-005：Task Dock 完整任务与审计时间线

**优先级**：高
**类型**：正向/UI

**测试步骤**：

1. 从设置页运行 Reference conformance task，或从 Workflow 启动任务。
2. 打开右侧 Task Dock → External tasks。
3. 展开任务详情。

**预期结果**：

- [ ] 任务独立显示 Agent、状态、取消状态、配置修订、run 归属和协议标记。
- [ ] 完成后显示输出，以及安全的 artifact 数量/usage 信息（如有）。
- [ ] Event timeline 按顺序显示生命周期事件，不泄漏秘密或原始配置。

### TC-006：input-required 原任务续跑

**优先级**：高
**类型**：正向/生命周期

**测试步骤**：

1. 注册一个启用 Simulate input required 的 Reference Agent。
2. 启动任务并打开 Task Dock。
3. 在 Input required 表单输入回复并发送。

**预期结果**：

- [ ] 状态进入 Input required，并显示可访问的输入表单。
- [ ] 发送后同一个 `taskId` 继续运行，不创建重复任务。
- [ ] 最终进入 Completed，时间线保留 Input required 与 Completed 记录。

### TC-007：取消与未知状态对账

**优先级**：高
**类型**：负向/恢复

**测试步骤**：

1. 启动一个尚未完成的 Reference task。
2. 点击 Cancel。
3. 对处于 Unknown 的测试任务点击 Reconcile。

**预期结果**：

- [ ] Task State 与 Cancel State 分开显示。
- [ ] 取消请求只有在 executor 确认后显示 Canceled / Confirmed。
- [ ] Reconcile 沿用原 `taskId`，不重新 start，也不静默切换 Agent。

### TC-008：中英文与可访问性

**优先级**：高
**类型**：UI/可访问性

**测试步骤**：

1. 在英文界面浏览 External Agents、Workflow picker 和 Task Dock。
2. 切换为简体中文，重复浏览与一次 input-required 操作。
3. 仅用键盘在表单、按钮、选择项和详情之间导航。

**预期结果**：

- [ ] 两种语言下没有缺失 key、占位符或关键文案仍为错误语言。
- [ ] 协议名与 opaque ID 可保持技术原文，其解释性文案正确本地化。
- [ ] 所有可交互控件都有可识别名称、可见焦点并可由键盘操作。
- [ ] 长配置修订不会撑破 Task Dock 布局。

## 边界与回归检查

- [ ] Runtime 未声明兼容 externalAgents 能力时，F115 操作入口隐藏。
- [ ] 名称/描述/技能达到 IPC 长度或数量上限时，表单和主进程都能有界拒绝。
- [ ] 刷新、重启 Space 后，注册、任务身份、事件游标和终态仍可恢复。
- [ ] 设置页其他 Provider 表单、语言切换、Task Dock 本地 Agent 和原 Workflow 功能无回归。

## 测试总结

| 用例数 | 通过 | 失败 | 阻塞 |
| ------ | ---- | ---- | ---- |
| 8      | -    | -    | -    |

**测试结论**：待填写
**发现的问题**：待填写

---

测试指导生成时间：2026-07-12
Feature ID：F115
