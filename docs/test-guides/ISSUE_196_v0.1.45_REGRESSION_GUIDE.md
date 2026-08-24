# Issue 196 Session 历史、队列与状态显示回归指导

## 目标

确认运行中的历史重验不会再收缩或乱序，排队 query 保持因果位置，加载、完成和压缩状态均如实显示。

## 前置条件

- 使用包含 Issue 196 修复的开发构建和独立测试 profile。
- 准备一个至少 60 条可见历史、包含 assistant/tool 输出的 Coder Session。
- 保留 DevTools Console，记录任何 history/runtime 错误，但不要手工修改持久化数据。

## 场景一：运行中接受 queue query

1. 发起一个会产生多段回复和工具调用的长任务。
2. 第一段回复可见后提交 follow-up，使其进入 queue。
3. 等待当前 turn 完成及 queue 自动交付。
4. 在整个过程中记录 query 上下各三条可见内容，再按 Ctrl+R 对比。

预期：此前已显示的回复不消失；queue query 只出现一次并固定在所属 turn；其后回复只出现在它之后；刷新前后顺序和数量一致。

## 场景二：有界历史重验

1. 在长 Session 运行期间保持页面打开，等待 Runtime reconnect 或历史 newest-page 重验。
2. 分别观察以 user、assistant、tool 为第一页首个 canonical item 的测试夹具。
3. 滚动到较早内容并等待分页完成。

预期：已加载前缀不收缩；canonical item 不重复；加载期间显示 spinner/等待说明，不显示会被误解为永久删除的“省略较早历史内容”；失败时显示可重试状态。

## 场景三：状态与压缩

1. 让 Session 完成，确认左侧栏蓝色运行 spinner 消失，无需 Ctrl+R。
2. 替换或重连 Runtime，确认旧 Runtime 的 Run 不会给当前 Session 带来 Stop 按钮或运行 spinner。
3. 触发上下文压缩并打开上下文窗口。

预期：压缩期间显示无具体百分比的活动状态和不确定进度；旧 token 读数不作为本次压缩进度；完成后恢复新的事实读数。

## 失败证据

记录 Session ID、当前 Runtime ID、发生时间、刷新前后截图，以及 Console 中最早的 history/runtime 错误。不要只记录刷新后的正常画面。
