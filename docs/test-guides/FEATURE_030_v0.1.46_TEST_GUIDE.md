# F030 权限模式回归：KodaX 0.7.96-rc.1

需求：Auto 审批后应能写工作区外普通目标；Full Access 在 Runtime 和直接 SDK 入口一致；模型应依据当前有效权限解释能力，不能把全局默认配置当成当前 Session 模式。

## 自动验证

`node --test scripts/test/kodax-permission-authority.test.mjs`

测试使用离线模型及仓库 scratch 下新建的隔离目录。目标既在模拟工作区外，也在系统临时目录外，不修改用户文件或真实 Session。覆盖 Runtime Full Access、Auto allow 后的外部写入、同目录后续 ask 不继承授权、直接 runKodaX/runManagedTask Full Access，以及带 prompt override 时从 Full Access 切换 Plan 后模型上下文刷新。

`node --test --import tsx apps/desktop/electron/test/runtime-host-adapter.test.ts apps/desktop/electron/test/release-smoke-contract.test.ts`

确认启动要求 v6、运行中的旧 v5 daemon 被拒绝，以及存在 active_runs/pending_interactions 时仍不强制重启。

## 人工验收

1. 安装新构建并连接支持权限能力 v6 的 daemon；全局配置保持 accept-edits，当前 Session 选择 Full Access。询问当前模式，应依据 Effective permissions 回答。
2. 对自己新建的工作区外空目录，要求用 write 写入普通文本；Full Access 应成功。Auto 应经过 reviewer，allow 后成功，ask 后不得写入。
3. Runtime 运行中切换 Plan；下一次模型请求的模式应更新，写入应受 Plan 限制。嵌入式会话则按 Run 绑定模式执行，下一 Run 更新。
4. 显式禁止规则和受保护控制文件仍应被拒绝；不要用真实配置或重要文件做破坏性测试。

自动集成验证与人工 UI 验收分开记录；自动测试通过不代表已执行以上人工操作。

## 2026-09-12 验证记录

- 上述三项真实 SDK 权限回归通过；Runtime/手册/发布契约集成测试通过。
- 类型检查、排除非源码 scratch 目录的 lint、51 项发布脚本测试通过。
- `npm run build` 完整通过：打包依赖检查、Windows renderer/Runtime 启动检查、两次完整退出及 Session 历史恢复检查均通过，加载版本为 `0.7.96-rc.1`。
- 人工 UI 用例尚未执行。
