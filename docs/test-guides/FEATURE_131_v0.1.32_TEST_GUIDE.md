# F131 Artifact 与 File Viewer 分离 - 人工测试指导

## 功能概览

**功能名称**: Artifact and File Viewer Separation<br>
**版本**: `v0.1.32`<br>
**测试日期**: 2026-07-20<br>
**测试人员**: [待填写]

项目文件和 Partner Delivery 现在进入独立的 File Viewer；Artifact 只表示真实 Session 生成、可版本化的结果。两者复用安全预览渲染器，但不共享列表、刷新、选择、版本、操作或错误状态。

## 测试环境

### 前置条件

- 使用 `v0.1.32` 当前源码构建并启动桌面端。
- 准备一个尚无 Session 的临时项目，至少包含 `README.md`、一张图片和一个 PDF。
- 准备一个可产生 Artifact 的测试 Session。
- Partner 侧准备一个可预览的 Markdown Delivery。
- 建议窗口尺寸覆盖 `1500×900` 和较窄桌面窗口各一次。

### 已有自动化证据

- IPC schema：File Viewer 不调用 `artifact.previewFile`；该兼容通道仍要求真实 Session identity，265 项 schema 测试通过。
- Renderer model：File/Delivery 快照与 Artifact 快照分类测试 4 项通过。
- TypeScript、目标文件 ESLint、renderer/main production smoke build 均通过。
- Electron 关键交互断言已通过；现有测试运行器仍可能在全部界面断言之后卡于 `Close context` 清理。

## 测试用例

### TC-001: 无 Session 打开项目文件

**优先级**: 高<br>
**类型**: 正向测试 / 回归测试

**测试步骤**:

1. 打开一个新项目目录，确认项目内没有 Session。
2. 从 Files 面板打开 `README.md`。
3. 查看右侧面板的页签、正文和错误区域。

**预期结果**:

- [ ] 右侧出现 `Overview | File Viewer`，并自动选中 File Viewer。
- [ ] Markdown 内容正常渲染。
- [ ] 不出现 Artifact 页签、`Artifact (!)` 或 `Artifact refresh failed`。
- [ ] 打开文件不会创建 Session，也不会在 Artifact 列表中新增条目。

**实际结果**: [待填写]<br>
**是否通过**: [ ] Pass / [ ] Fail

### TC-002: 真实 Artifact 保持原有能力

**优先级**: 高<br>
**类型**: 正向测试 / 回归测试

**测试步骤**:

1. 创建或进入一个真实 Session。
2. 让 Agent 创建一个至少包含两个版本的 Artifact。
3. 检查 Artifact 页签、选择器、版本、导出/保存和独立窗口入口。

**预期结果**:

- [ ] Agent 生成结果仍自动激活 Artifact。
- [ ] Artifact 列表、版本选择和现有操作可用。
- [ ] Artifact 不被误放入 File Viewer。
- [ ] Artifact 的刷新错误只显示在 Artifact 模式内。

**实际结果**: [待填写]<br>
**是否通过**: [ ] Pass / [ ] Fail

### TC-003: File Viewer 与 Artifact 可并存切换

**优先级**: 高<br>
**类型**: 交互测试 / 状态测试

**测试步骤**:

1. 在已有 Artifact 的 Session 中打开一个项目文件。
2. 依次点击 Overview、Artifact 和 File Viewer。
3. 在 Artifact 中切换版本，再回到 File Viewer，然后再次返回 Artifact。

**预期结果**:

- [ ] 三个页签按 `Overview | Artifact (n) | File Viewer` 排列。
- [ ] File Viewer 中不显示 Artifact selector、版本或 iterate 操作。
- [ ] 往返切换不会丢失当前文件，也不会把文件加入 Artifact 数量。
- [ ] Artifact 的选择和版本状态保持正确。

**实际结果**: [待填写]<br>
**是否通过**: [ ] Pass / [ ] Fail

### TC-004: Session 与项目切换边界

**优先级**: 高<br>
**类型**: 边界测试 / 状态测试

**测试步骤**:

1. 在项目 A 打开文件，使 File Viewer 可见。
2. 在项目 A 内新建或切换 Session。
3. 再切换到项目 B。

**预期结果**:

- [ ] 在同一项目内切换 Session 后，File Viewer 和当前文件保持。
- [ ] Session 切换清除旧 Artifact focus，不泄漏另一个 Session 的 Artifact。
- [ ] 切换到项目 B 后，项目 A 的 File Viewer 被清除并回到安全的 Overview 状态。

**实际结果**: [待填写]<br>
**是否通过**: [ ] Pass / [ ] Fail

### TC-005: 刷新、复制路径和失败隔离

**优先级**: 高<br>
**类型**: 正向测试 / 负向测试 / UI 测试

**测试步骤**:

1. 在 File Viewer 打开一个文本文件并修改其磁盘内容。
2. 点击刷新，确认内容更新。
3. 点击复制路径并核对剪贴板。
4. 保持 Viewer 打开后临时移动或删除文件，再点击刷新。

**预期结果**:

- [ ] 刷新期间按钮有忙碌反馈，成功后显示新内容。
- [ ] 复制按钮给出成功反馈，剪贴板内容为当前文件路径。
- [ ] 刷新失败时保留最后一次成功内容，并显示 File Viewer 专属错误。
- [ ] 失败不会出现 Artifact 错误、Artifact `(!)` 或清空 Artifact 状态。

**实际结果**: [待填写]<br>
**是否通过**: [ ] Pass / [ ] Fail

### TC-006: 富格式和智能路由回归

**优先级**: 中<br>
**类型**: 兼容性测试 / 回归测试

**测试步骤**:

1. 依次打开 Markdown、图片、PDF、DOCX、XLSX、PPTX、音频和视频文件。
2. 打开一个有未提交变更的代码文件。
3. 打开同类型但无 diff 的代码文件。

**预期结果**:

- [ ] 可支持的富格式继续使用现有安全预览器正常渲染。
- [ ] 有变更的代码仍优先进入 Diff。
- [ ] 无 diff 的代码可进入 File Viewer。
- [ ] 不支持或超限文件按现有策略给出文件错误或回退到系统定位，不创建 Artifact。

**实际结果**: [待填写]<br>
**是否通过**: [ ] Pass / [ ] Fail

### TC-007: Partner Delivery 使用独立预览

**优先级**: 高<br>
**类型**: 正向测试 / 跨 Surface 测试

**测试步骤**:

1. 切换到 Partner，进入 Outputs 并选中一个 Markdown Delivery。
2. 点击“在文件查看器中打开”。
3. 在右侧 rail 的 Artifact、预览、文件提案和输出之间切换。

**预期结果**:

- [ ] Delivery 打开到独立的“预览”页签，并显示 File Viewer 内容。
- [ ] “预览”与“文件”提案页签名称不重复。
- [ ] Delivery 不加入 Artifact 列表，不获得 Artifact 版本/iterate 操作。
- [ ] Coder 和 Partner 对同类文件的能力边界一致。

**实际结果**: [待填写]<br>
**是否通过**: [ ] Pass / [ ] Fail

### TC-008: 可访问性和窄窗口

**优先级**: 中<br>
**类型**: UI 测试 / 可访问性测试

**测试步骤**:

1. 仅用键盘在 Overview、Artifact、File Viewer、刷新和复制按钮间移动并激活。
2. 使用屏幕阅读器或无障碍检查器核对名称与 pressed 状态。
3. 缩窄桌面窗口，检查页签和文件路径头部。

**预期结果**:

- [ ] 页签是可聚焦的语义按钮，并正确报告 `aria-pressed`。
- [ ] 刷新和复制按钮具有明确可访问名称。
- [ ] 活动状态不只依赖颜色表达。
- [ ] 文件路径可截断但不挤坏控制按钮，预览正文仍可滚动。

**实际结果**: [待填写]<br>
**是否通过**: [ ] Pass / [ ] Fail

## 边界用例

### BC-001: 路径越界

- 尝试通过相对路径穿越或项目外绝对路径预览文件。
- 预期：main 端路径边界继续拒绝，不读取项目外数据，也不创建 Artifact。

### BC-002: 文件在查看期间变化

- 快速连续修改文件并多次刷新。
- 预期：Viewer 最终显示一次成功读取的完整快照，不把部分内容写入 ArtifactStore。

### BC-003: Artifact 与文件同时失败

- 在真实 Session 模拟 Artifact list 失败，同时让当前文件刷新失败。
- 预期：两个页签分别显示自己的错误；File Viewer 保留旧文件内容，错误不串台。

## 测试总结

| 用例数 | 通过 | 失败 | 阻塞 |
| ------ | ---- | ---- | ---- |
| 8      | -    | -    | -    |

**测试结论**: [待填写]<br>
**发现的问题**: [待填写]

_Feature ID: F131 · 测试指导生成时间: 2026-07-20_
