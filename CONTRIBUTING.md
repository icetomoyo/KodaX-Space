# Contributing to KodaX Space

感谢你参与 KodaX Space。提交改动前，请先阅读[文档中心](docs/README.md)、[运行与开发指南](docs/USAGE.md)和与改动相关的 [Feature List](docs/FEATURE_LIST.md) / [HLD](docs/HLD.md)。

## 开发准备

```bash
npm install --include=dev
npm run dev
```

KodaX Space 是 npm workspace monorepo。请从仓库根目录运行安装、测试和构建命令；native module 的 Node/Electron ABI 由项目脚本协调，避免并行执行会重建同一 native addon 的命令。

## 改动原则

- Electron renderer 不直接执行 LLM、文件、shell、MCP 或其他特权操作；通过 typed/zod IPC 调用 main。
- Space 是 KodaX 的桌面 host，不复制一套 agent engine。使用 public SDK/Runtime contract，并通过 capability negotiation 表达可用性。
- 明确数据和生命周期 owner。当前 v0.1.31 中 RuntimeHostAdapter 负责 managed runs、transcript、compact、fork、rewind；Workflow、MCP 进程/日志、Partner policy/tools、permissions、artifacts、External Agent durable store 仍是 Space bridge。
- 不依据版本号推断能力；验证实际 export、DTO、event、capability 和发布包。
- 不夸大未发布、未验收或 capability-gated 的功能。
- 保持 IPC payload 有界、脱敏、可验证；凭据不得进入 renderer、日志或测试 fixture。

## 验证

常规提交至少运行：

```bash
npm run typecheck
npm run lint
npm test
npm run build:smoke
```

涉及 renderer 交互、main/IPC、session、Runtime 或打包行为时，还应运行：

```bash
npm run e2e
npm run smoke:pack
```

高风险 Feature 按对应 `docs/test-guides/` 完成人工验收。不要使用真实用户 profile 做自动化测试；使用 `KODAX_TEST_ONBOARDING` 或独立的绝对 `KODAX_PROFILE_DIR`。

## 文档

用户可见行为变化时，同步更新：

1. [用户使用手册](docs/USER_MANUAL.zh-CN.md)；
2. 应用内 `apps/desktop/electron/kodax/space-manual-topics.ts`；
3. 需要时更新 PRD、HLD、能力台账、Feature List、版本设计和测试指导；
4. 只有正式发布后才更新 CHANGELOG 的发布状态和 README 的当前正式版。

历史 release design 和 ADR 是当时决策证据，不要静默重写；用 correction note、superseded 状态或当前文档链接说明变化。

## 提交说明

- 保持提交主题聚焦，不混入无关格式化或用户已有改动。
- 说明用户效果、关键边界、验证命令和仍未完成的人工/发布步骤。
- 安全、数据丢失、权限绕过或凭据泄露问题请不要在公开 issue 中附真实敏感数据；先提供脱敏复现和最小证据。
