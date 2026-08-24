# Issue 197 构建网络与退出恢复回归指导

## 目标

确认正式构建能在代理或直连环境中有界结束，并确认用户退出会取消尚未完成的 Runtime 启动恢复。

## 前置能力

1. 确认 root、Desktop、lockfile 和物理安装均为精确 KodaX `0.7.95`。
2. 确认 SDK 报告 `runtimeExitSettlement:2`，SDK 与 daemon 报告 `sandboxRuntime:5`。

预期：任一层仍为 0.7.94、exit v1 或 sandbox v4 时，Space 在启动/打包门明确失败，不复用旧 daemon。

## 场景一：代理构建

1. 设置有效的 `HTTPS_PROXY`，运行 `npm run build`。
2. 确认 release gate 下载并校验 lockfile 锁定的 KodaX tarball。
3. 使用不可达代理再次运行 release-gate 回归测试，而不是等待人工终止完整打包。

预期：有效代理下构建继续完成；不可达代理在有界超时后失败并退出进程，不停留在 `scripts/pack.mjs`。

## 场景二：无代理与非法配置

1. 在可直连网络中清除代理变量并运行 release-gate 回归测试。
2. 分别提供非法代理 URL 和非 HTTPS Registry tarball URL。

预期：直连仍可工作；非法配置在网络访问前返回明确错误；日志不得输出代理凭据。

## 场景三：恢复等待期间退出

1. 使用测试夹具让 Runtime 返回可自动重试的临时 exit-settlement 结果。
2. 在恢复延迟期间立即退出 Space。
3. 重复在 settlement 完成后、reconcile 前和 prepare 前触发退出。

预期：Space 取消恢复等待并正常退出；不再出现延迟的 blocker 弹窗、不重新打开窗口，也不继续启动 Runtime。

## 发布边界

本指导只验证源码和构建闭环，不包含版本号修改、tag、SDK publish 或 Space release。
