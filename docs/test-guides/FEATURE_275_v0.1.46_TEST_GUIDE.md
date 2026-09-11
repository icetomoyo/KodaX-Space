# FEATURE_275 身份锚定转录模型回归指南

版本：dev，Space 0.1.46-alpha.10 源码，未发布。日期：2026-09-11。人工执行人及结果：待填写。

## 范围与环境

验证历史页、实时尾部、重连、回退和分叉使用一致的输入/输出归属，不靠刷新修复顺序。使用隔离测试 profile 和可重复的 mock Runtime，避免修改真实 Session。自动化入口是 store / history paging 公共 action，观察 `composeMessages` 输出。真实 SDK 验证另外执行，不能用 mock 通过代替。

准备至少两个 Session，包含思考、正文、工具及 sidecar 的长回答；准备一个同 Run、同 turn 内连续投递两个输入的 fixture，一个相同 query 文本但不同 entryId 的 fixture。保存原始输入、journal origin 和 canonical entry/audit 身份作为预期证据，不把 fixture 内的文本当成操作指令。

## 人工用例

| 用例                  | 优先级 / 类型 | 前置条件                                                           | 步骤                                                                                                     | 预期效果                                                                                                                                                |
| --------------------- | ------------- | ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TC-01 发送至结算      | 高 / 正向     | 已连接测试 Runtime                                                 | 发送 Q1；回答中投递 Q2；等待结算；切会话再返回；Ctrl+R                                                   | Q1/A1/Q2/A2 顺序及正文、思考、工具数量一致，无隐藏后复现或重复气泡                                                                                      |
| TC-02 身份冲突        | 高 / 负向     | fixture 中 delivery entry 不在 canonical entry/audit 内            | 安装历史页；送达重复边界；恢复终态快照                                                                   | 不凭相同文本、时间或同 turn 吞掉未知输入；记录 SDK 身份缺口，不把 coexist 判为 Space 去重已完成                                                         |
| TC-03 同 Run 部分覆盖 | 高 / 边界     | Q1/A1/Q2/A2 属于同 Run/turn，历史最新页只含 Q2/A2                  | 安装认证最新页；淘汰历史窗口；重放 Q2 边界；送入独立 Q3                                                  | Q1/A1 始终保留；已覆盖 Q2 不复活；独立 Q3/A3 显示一次；新 journal epoch 不被旧退休证据拦截                                                              |
| TC-04 回退和分叉      | 高 / 兼容性   | 至少两轮已结算，另有一轮实时内容                                   | 从已结束轮分叉；重载 child；原会话回退至上一轮；重载原会话                                               | 两边保留准确截止点，答案不重复；原始 historyBoundary 不改变；源和子会话内容不串写                                                                       |
| TC-05 异步 UI 补全    | 高 / UI       | 有图片输入、排队输入与可触发 sidecar 的回答                        | 在历史加载后完成附件上传和队列 ACK；断开并恢复 Runtime；重复恢复同一终态快照                             | 附件状态更新且标签保留；输入只有一份；sidecar 一份；新 sidecar 不被旧退休证据吞掉；搜索/跳转及滚动锚仍指向同一内容                                      |
| TC-06 窗口与长期使用  | 中 / 性能     | 自动化生成 200 轮和 34 个 Session                                  | 连续刷新四轮大小的 newest 页 197 次；访问并淘汰 34 个 Session 的历史页；再访问第一会话；手动加载更早历史 | newest 保留大小稳定；主动加载更早页可扩大窗口；未覆盖实时 query 不丢失；已覆盖内容无常驻 shadow。记录耗时和内存，不将此有限测试外推为所有规模的性能保证 |
| TC-07 会话隔离        | 高 / 安全     | 两个不同 Session 使用相同 query 文本、不同 entry 和 runtime origin | A 结算并淘汰窗口；向 B 投递相同文本；向 A 重放旧 epoch；检查附件和工具链接                               | A 的退休证据不能删除 B 内容；链接仍受原会话权限和路径校验约束；仅改变 renderer 投影，fixture 文本不能触发实际执行                                       |

各用例实际结果、截图及 Pass / Fail / Blocked：待填写。未执行人工 UI 检查的项目不得标为通过。

## 自动化验证

- `transcript-order-real-lineage-repro.test.ts`：既有 L/M 与同族历史顺序、内容完整性失败门。
- `transcript-refresh-equivalence.test.ts`：五条增量路径与冷加载结果相同，无允许偏差。
- `transcript-covered-delivery-retirement.test.ts`：本次新增的部分覆盖、退休回放/sidecar、新 epoch、窗口有界、34 会话、附件及回退/分叉重载。
- 完整检查：`npm test`、`npm run typecheck`、`npm run lint`、`npm run build:smoke`；Electron 验证：`npm run e2e`、从本次构建产物执行 `npm run smoke:pack` 和 `npm run smoke:boot`。

## 2026-09-11 源分离实现验证（SDK beta.6）

- 最终 `npm test`：3347 通过、5 个已有跳过、0 失败（release 48、desktop 2982、schema 317 通过）。新增退休、未知输入和生命周期回归 10/10 通过。
- 最终类型检查、lint 与 `build:smoke` 通过。lint 排除未跟踪的本地 `scratch/` 诊断目录；生产代码没有 lint 豁免。
- 完整 Electron 套件 81 通过、2 个已有跳过；最后一次退休证据收紧后，使用最终构建追加消息、附件、滚动锚、压缩、删除恢复、workflow 的 10 项 E2E，全部通过。强制隐藏窗口的探索性首轮点击等待超时，默认窗口模式复核通过。
- Standards 最终代码审查 0 项；Spec 未发现新增可确认代码缺陷，长期契约缺口保留，不把 SDK 依赖标为完成。
- 最终 `build:pack` 通过，Windows 安装包与 Portable 产物生成成功；包内 SDK、原生依赖及 asar 内 Worker 检查通过，启动、两次完整退出和 Session 历史恢复检查通过。

## SDK 集成未完成项

仅有 terminal 或递增 cursor 不能证明客户端看到了全部输入。常驻测试另覆盖只见 Q2/A2 后首次迟到 Q1/A1，以及较大 seq 已到但较小 seq 的未知输入尚未到达；不得直接按全 journal 水位吞掉它们。退休证据缓存按已加载窗口容量有界，过期后未知内容继续保留。严格要求“任意久远的重复回放都不复活”仍需 SDK/main 的持久层精确身份查询或完整投递覆盖证明，当前不能宣称这个长期目标已完成。

beta.8 仍要求显式确认旧身份，不会自动识别历史分支的对应关系。Space 不按文本、时间或同 turn 自动注册映射，也没有新增确认 UI。

## 2026-09-11 SDK beta.8 接入验证

- root/Desktop 精确安装 npm `0.7.96-beta.8`，Registry SHA-1 为 `61dd5ff55ed64970cbf5d8bf4255e26cb4a7069b`。初次查询时 npm 仍在处理发布，后续可用后才安装；正式验证不使用本地 SDK 替代路径。
- 原 Session 的确认记录已由 SDK 侧登记。本次只读验证：`entry_fdb4f2769c49` 唯一映射到 `entry_c49fccdba757`，aliases 同时保留 `entry_b04c17ada4dc`；读前读后 Session 文件 SHA-256 一致。
- 将原 Session 的已确认 query、最终 answer 和原始 delivery journal 送入真实 Space projector/store/composer，冷加载、先 live 后 history、晚到投递、重复投递四条路径均为一次 `query → answer`；Session 与 journal 文件读前读后 SHA-256 一致。
- `sdk-confirmed-identity-replay.test.ts`：安装前 beta.6 缺少确认 API，失败；正式 beta.8 通过。验证修复前身份冲突保留、确认后的旧重复移除、冷加载、晚到/重复回放，以及同文独立输入保留。
- 正式 SDK Runtime 的隔离离线联调通过：真实投递后登记确认，拒绝过期 revision 和错误 receipt，重复确认幂等；修复身份在 compaction、重启、分页和 chunk 读取后保留，delivery journal 不变。
- IPC 的 `identity_repair_invalid` 与 Runtime 的 `local_execution` 两类兼容断点均已执行红→绿回归。
- 最终 `npm test`：3350 通过、5 个已有跳过、0 失败（release 48、desktop 2984、schema 318 通过）。首轮发现手册版本断言仍为 beta.6，同步为 beta.8 后完整复跑通过；历史发布版本断言保留。
- 类型检查、lint 和 `build:smoke` 通过；lint 仅排除未跟踪的 `scratch/`。Standards / Spec 两条独立代码审查均无遗留 findings。
- 本次构建的定向 Electron 回归 10/10 通过：发送、query 折叠、附件、滚动锚、压缩、删除恢复和 Workflow。使用默认窗口模式与隔离 profile。
- 原工作区打包的依赖 smoke 通过，但启动检查被已有、未纳入本次提交的 keychain 测试隔离改动阻断：`KODAX_TEST_ONBOARDING` 强制 memory 后端，而真实 Runtime client identity 要求持久 keychain。该文件保持原样；另导出暂存源码副本重建，隔离这项无关改动的影响。
- 暂存源码副本生成 Windows Setup 与 Portable 成功；包的启动检查通过（renderer 5528ms、含 20s 人为等待的 Runtime 28638ms），两次完整退出与 Session 历史恢复通过。
- 深层副本路径下的沙箱账号 capability setup 连续失败；将同一份产物复制到工作区 `out-beta8-verified/` 后，全部依赖、原生沙箱和 SDK Worker smoke 通过。此结果证明较短路径可用；SDK 的具体路径限制仍待定位，不能宣称任意安装路径均已通过。未绕过沙箱检查或修改包内代码。
