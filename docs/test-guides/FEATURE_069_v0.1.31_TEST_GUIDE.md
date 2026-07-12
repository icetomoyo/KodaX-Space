# F069 Structured Diagnostics - 人工测试指导

## 功能概述

**功能名称**: Structured Main-Process Logging and Diagnostic Export<br>
**版本**: `v0.1.31`<br>
**测试日期**: 2026-07-12<br>
**测试人员**: [待填写]

Space 在本地保存有界、滚动、脱敏的主进程 JSONL 日志，并允许用户从 Settings 明确导出诊断 ZIP；不会自动上传。

## 测试环境

### 前置条件

- 启动开发版或打包版 Space。
- 知道当前 profile 的 `userData/diagnostics` 目录。
- 准备一个仅用于测试的假 token，如 `diag-secret-DO-NOT-USE`，禁止使用真实凭据。

## 测试用例

### TC-001: 本地结构化日志生成

**优先级**: 高<br>
**类型**: 正向测试

**测试步骤**:

1. 启动 Space，打开 Settings、切换主题并执行一次更新检查。
2. 关闭应用，检查 `diagnostics/space-main.jsonl`。

**预期效果**:

- [ ] 每行都是独立 JSON，包含时间、级别、component、event、Space/SDK 版本和平台。
- [ ] 能看到 startup/Runtime/Workflow/updater 或控制边界事件。
- [ ] 关闭应用后最后记录已刷新到磁盘。

**实际结果**: [待填写]<br>
**是否通过**: [ ] Pass / [ ] Fail

### TC-002: Settings 导出与取消

**优先级**: 高<br>
**类型**: UI测试/正向测试

**测试步骤**:

1. 打开 Settings → Diagnostics。
2. 查看导出类别说明，点击导出后取消保存框。
3. 再次导出并保存 ZIP。

**预期效果**:

- [ ] 取消是正常状态，不显示错误。
- [ ] 成功导出后显示保存结果，renderer 不能直接填写任意目标路径。
- [ ] ZIP 只含所选类别，如 manifest、logs、capabilities、release、known-degradations。

**实际结果**: [待填写]<br>
**是否通过**: [ ] Pass / [ ] Fail

### TC-003: 脱敏检查

**优先级**: 高<br>
**类型**: 安全测试

**测试步骤**:

1. 仅用假值制造包含 token、Authorization、URL secret query、用户目录路径和提示内容的可恢复错误。
2. 导出诊断 ZIP。
3. 在活动日志、轮转日志和解压内容中全文搜索假值及用户名路径。

**预期效果**:

- [ ] 假 token、Authorization/Cookie、URL secret 参数和提示/工具/文档内容均不存在。
- [ ] 私有 home/profile 前缀被替换。
- [ ] 仍保留可关联的 component、event、状态码和安全错误类别。

**实际结果**: [待填写]<br>
**是否通过**: [ ] Pass / [ ] Fail

### TC-004: 日志不可写时优雅降级

**优先级**: 中<br>
**类型**: 负向测试

**测试步骤**:

1. 在隔离测试 profile 中让 diagnostics 目录暂时不可写。
2. 启动 Space，并执行普通会话/Settings 操作。

**预期效果**:

- [ ] 应用仍能启动和使用。
- [ ] 终端出现有界 fallback 提示，不递归刷屏。
- [ ] 恢复权限后重新启动可继续记录。

**实际结果**: [待填写]<br>
**是否通过**: [ ] Pass / [ ] Fail

### TC-005: 轮转和保留

**优先级**: 中<br>
**类型**: 边界测试/性能测试

**测试步骤**:

1. 在测试 profile 中产生足量安全日志触发轮转。
2. 重启后继续产生日志。
3. 检查文件数量与应用响应。

**预期效果**:

- [ ] 活动日志保持在约 5 MiB 上限内。
- [ ] 最多保留五个轮转文件，旧文件按顺序淘汰。
- [ ] 日志压力不会阻塞 UI 或无限增长磁盘占用。

**实际结果**: [待填写]<br>
**是否通过**: [ ] Pass / [ ] Fail

## 测试总结

| 用例数 | 通过 | 失败 | 阻塞 |
| ------ | ---- | ---- | ---- |
| 5      | -    | -    | -    |

**测试结论**: [待填写]<br>
**发现的问题**: [待填写]

_Feature ID: F069 · 测试指导生成时间: 2026-07-12_
