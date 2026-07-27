# Contributing to KodaX Space

感谢你参与 KodaX Space。提交改动前，请先阅读[文档中心](docs/README.md)、[运行与开发指南](docs/USAGE.md)和与改动相关的 [Feature List](docs/FEATURE_LIST.md) / [HLD](docs/HLD.md)。

## 开发准备

```bash
npm install --include=dev
npm run dev
```

KodaX Space 是 npm workspace monorepo。请从仓库根目录运行安装、测试和构建命令；native module 的 Node/Electron ABI 由项目脚本协调，避免并行执行会重建同一 native addon 的命令。
开发环境要求 Node.js 22.12+；优先让版本管理器读取 `.nvmrc`（当前固定 22.23.1），与 CI 保持一致。

## 改动原则

- Electron renderer 不直接执行 LLM、文件、shell、MCP 或其他特权操作；通过 typed/zod IPC 调用 main。
- Space 是 KodaX 的桌面 host，不复制一套 agent engine。使用 public SDK/Runtime contract，并通过 capability negotiation 表达可用性。
- 明确数据和生命周期 owner。当前 v0.1.33 中 Coder daemon 负责 sessions/runs/settings/interactions、Workflow 观察/控制、Learning/catalog、MCP tool discovery/reload 和已配置 External Agent Actor/Turn；Partner、renderer 投影、MCP 进程/日志、Workflow library/start/admin、artifacts 与 Space Reference Agent 仍是 Space host-provider bridge。
- 不依据版本号推断能力；验证实际 export、DTO、event、capability 和发布包。
- 不夸大未发布、未验收或 capability-gated 的功能。
- 保持 IPC payload 有界、脱敏、可验证；凭据不得进入 renderer、日志或测试 fixture。
- 修改 Space builtin skill 时，先阅读 [builtin 维护说明](docs/BUILTIN_SKILLS.md)。只接受允许复制、修改和再分发的来源；上游 revision、许可哈希、补丁与完整性 lock 必须一起审阅，不能直接手改生成目录。

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
npm run smoke:boot
```

高风险 Feature 按对应 `docs/test-guides/` 完成人工验收。不要使用真实用户 profile 做自动化测试；使用 `KODAX_TEST_ONBOARDING` 或独立的绝对 `KODAX_PROFILE_DIR`。

## 文档

用户可见行为变化时，同步更新：

1. [用户使用手册](docs/USER_MANUAL.zh-CN.md)；
2. 应用内 `apps/desktop/electron/kodax/space-manual-topics.ts`；
3. 需要时更新 PRD、HLD、能力台账、Feature List、版本设计和测试指导；
4. 发布准备可以先组装对应 CHANGELOG section 和 release checklist；只有正式发布后才把 README/文档中的“当前正式版”改为新版本。

历史 release design 和 ADR 是当时决策证据，不要静默重写；用 correction note、superseded 状态或当前文档链接说明变化。

发布维护者还应使用对应版本的 release-readiness 文档；`v0.1.33` 见
[发布就绪清单](docs/releases/v0.1.33-release-readiness.md)。

## 提交说明

- 保持提交主题聚焦，不混入无关格式化或用户已有改动。
- 说明用户效果、关键边界、验证命令和仍未完成的人工/发布步骤。
- 安全、数据丢失、权限绕过或凭据泄露问题请不要在公开 issue 中附真实敏感数据；先提供脱敏复现和最小证据。
