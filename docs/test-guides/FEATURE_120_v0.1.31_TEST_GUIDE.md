# F120 Natural-Language Space Control - 人工测试指导

## 功能概述

**功能名称**: Natural-Language Space Control<br>
**版本**: `v0.1.31`<br>
**测试日期**: 2026-07-12<br>
**测试人员**: [待填写]

配置 Provider 后，Coder/Partner 可通过两个受治理工具检查并应用八类 Space 语义动作。它不是 DOM/坐标自动化，也不开放任意 IPC、路径、凭据、权限答案或删除操作。

## 测试环境

### 前置条件

- 配置一个可调用工具的真实或 mock Provider。
- 准备 Coder 与 Partner session 各一个。
- 保留 Settings、主题、左右侧栏和 Task Dock 的确定性入口用于对照。

## 测试用例

### TC-001: 检查后设置主题

**优先级**: 高<br>
**类型**: 正向测试

**测试步骤**:

1. 在 Coder 中明确要求“把 Space 主题设置成深色”。
2. 观察工具先调用 inspect，再调用 apply。
3. 用主题菜单切回浅色，再次用自然语言设为深色。

**预期效果**:

- [ ] apply 使用 inspect 返回的相同 action/args、revision 和前置令牌。
- [ ] 主题变为深色并返回 applied 或 unchanged 的真实回执。
- [ ] 菜单和自然语言路径的最终状态一致。

**实际结果**: [待填写]<br>
**是否通过**: [ ] Pass / [ ] Fail

### TC-002: Settings、语言和 Surface

**优先级**: 高<br>
**类型**: 正向测试/UI测试

**测试步骤**:

1. 要求打开 Diagnostics Settings。
2. 要求语言切换为 English，再切回系统语言。
3. 要求切到 Partner，然后从 Partner 切回 Coder。

**预期效果**:

- [ ] 只打开注册的 Settings tab，不执行诊断导出或配置写入。
- [ ] 语言持久化并立即刷新 UI。
- [ ] Surface 切换不把原始 run 重新绑定到另一产品面。

**实际结果**: [待填写]<br>
**是否通过**: [ ] Pass / [ ] Fail

### TC-003: 侧栏和 Task Dock 布局

**优先级**: 高<br>
**类型**: 正向测试/兼容性测试

**测试步骤**:

1. 在 Coder 中要求关闭左侧栏，再打开 Task Dock。
2. 依次要求 Task Dock 使用 default、half、max 宽度。
3. 调整窗口宽度并重复。

**预期效果**:

- [ ] 使用显式 desired-state，不发生盲目 toggle。
- [ ] 宽度预设和现有按钮结果一致，中央工作区仍可用。
- [ ] Partner inspect 不暴露 Coder-only Task Dock 动作。

**实际结果**: [待填写]<br>
**是否通过**: [ ] Pass / [ ] Fail

### TC-004: 默认推理模式与 Plan 限制

**优先级**: 高<br>
**类型**: 安全测试/持久化测试

**测试步骤**:

1. 在普通 Coder run 中要求默认推理模式设为 `deep`。
2. 重启并创建新 session，检查默认值。
3. 把当前 session 的 Permission Mode 切到 Plan，再尝试同一动作。

**预期效果**:

- [ ] 普通 run 写入现有 runtime defaults 并在重启后保持。
- [ ] Plan 上下文拒绝该偏好写入，UI 临时动作仍按描述符策略处理。
- [ ] SDK `taskSurface`、Permission Mode 和 Coder/Partner `surface` 三者不会混淆。

**实际结果**: [待填写]<br>
**是否通过**: [ ] Pass / [ ] Fail

### TC-005: 重放、过期和页面重载

**优先级**: 高<br>
**类型**: 负向测试/安全测试

**测试步骤**:

1. inspect 一个动作后，先手工改变同一状态，再提交旧 apply。
2. inspect 后刷新主 renderer，再提交旧 apply。
3. 尝试用同一 toolCallId 更换 args，或等待令牌过期。

**预期效果**:

- [ ] stale revision、renderer instance changed、conflicting replay 和 expired precondition 均被拒绝。
- [ ] 不发生重复突变或自动重放。
- [ ] ack 丢失/超时返回 unknown，而不是虚构 applied。

**实际结果**: [待填写]<br>
**是否通过**: [ ] Pass / [ ] Fail

### TC-006: 敏感与越界请求

**优先级**: 高<br>
**类型**: 安全测试

**测试步骤**:

1. 要求读取/设置 API key、Provider header、权限答案或任意路径。
2. 要求删除 session、退出/重启、安装扩展、接受更新或调用任意 IPC。
3. 要求点击某坐标或 DOM selector。

**预期效果**:

- [ ] inspect 不返回这些动作，apply 不能猜测隐藏 action ID。
- [ ] 模型只能导航到安全 Settings 区域或解释需要用户操作。
- [ ] Partner 不因此获得 Coder shell/edit/write/workflow/subagent 能力。

**实际结果**: [待填写]<br>
**是否通过**: [ ] Pass / [ ] Fail

### TC-007: 缺少上下文时降级

**优先级**: 中<br>
**类型**: 负向测试

**测试步骤**:

1. 在无 active session/project 的 UI 中使用确定性主题/语言/Settings 控件。
2. 模拟缺少 `toolCallId` 或 primary renderer broker 不可用。

**预期效果**:

- [ ] 确定性控件继续工作。
- [ ] apply 因缺少 tool ID 或 broker 超时而拒绝/unknown，不合成身份。
- [ ] 应用不崩溃，不切到正则意图解析或其他 Runtime 重放。

**实际结果**: [待填写]<br>
**是否通过**: [ ] Pass / [ ] Fail

## 测试总结

| 用例数 | 通过 | 失败 | 阻塞 |
| ------ | ---- | ---- | ---- |
| 7      | -    | -    | -    |

**测试结论**: [待填写]<br>
**发现的问题**: [待填写]

_Feature ID: F120 · 测试指导生成时间: 2026-07-12_
