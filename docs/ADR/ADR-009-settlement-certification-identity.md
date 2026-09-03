# ADR-009: 会话结算认证 — 身份证据 + 源静止放行，拒绝跨域 revision 等式

- **Status**: Accepted
- **Date**: 2026-09-03
- **Companion**: [ADR-003 KodaX 集成模式](ADR-003-kodax-integration-in-process.md)
- **Source of truth**: 真实 daemon 契约探测（`e2e/verify-revision-contract.mjs`，隔离 homeDir、无 LLM）+ `@kodax-ai/kodax@0.7.96-alpha.7` conversationHistory:2 契约

## Context

Run 结束（`session_complete`/`session_error`）后，Space 需要决定 terminal-scoped newest canonical 页是否可以接管该轮的显示（认证 canonical）。认证猜错的后果是用户可见的：Issue 202（顺序）、Issue 204（raced 认证把已画的回答交给缺 assistant 行的 canonical 壳，Ctrl+R 才能找回）、Issue 205（Session not found）。202/204/205 反复修补的根因相同：**认证靠时序与代数推断（generation 计数、读次序），每种竞态都是一种新的猜错方式**。

曾提议用 revision 哈希等值做认证（"等式栅栏"：页 revision/live transcriptRevision/sourceRevision 相等才认证）。实测否决：

| 实测问题（真实 daemon） | 结果 |
| --- | --- |
| 页 `revision`、页 `sourceRevision`、live `transcriptRevision` 三者相等？ | **全 false**——三个互不相交的哈希域，同会话同时刻也不相等 |
| 追加条目后旧 revision 是否恢复？ | 否，`revision`/`sourceRevision` 永久前进（P3 追问场景等式栅栏必败） |
| 连续两次读取 revision 是否稳定？ | 是——**revision 稳定 = 持久化收敛**，可用作"源静止"证明 |
| `sessions.diagnostics` 结算见证 | `{runtimeId, sessionId, observation{cursor{journalEpoch}}, run}` 存在，但身份检查严格强于 journalEpoch 见证 |
| 对话页条目是否携带 turnId | 条目本体无，`message.turnId` 有；Space 已提取（`ipc/session.ts` `entry.turnId ?? entry.message.turnId`） |

## Decision

结算认证锚定**身份证据**与**可证明的静止**，全部失败方向 fail-open：

1. **turnId 身份认证**：terminal-scoped newest 页里存在 `kind !== 'user'` 且 `turnId` 匹配该 terminal Run 的 turn 的条目，该读才认证该 Run。证据三处构造点全部携带 turnId（live 投影 / runtime profile / 直连 terminal 事件经 live `lastTerminalRun` 补齐）；证据缺失时 presence 检查跳过，退回现状行为。
2. **源静止结构性放行**：身份未确认时，若连续两次读取 `page.revision` 相同（源已收敛）仍无该 turn 的行，判定为结构性情况（出错轮次本无可持久化内容、截断等），放行完成。至多多 1 次重读。
3. **兜底不变式独立保留**（Issue 204 修复，`decideTurnProjectionAuthority`）：durable 页为空但 live 有 assistant 内容 → 拒绝认证（`coexist_fail_open`）。它独立于认证正确性，认证错也不丢已画内容。
4. **重试预算不变**：身份未确认且源仍在前进 → 保持 pending，走现有 `scheduleRuntimeRetry` 梯（MAX 30 → phase error → 回 pending）。

### 被否决方案

- **跨域 revision 等式栅栏**：三类 revision 是不同哈希域，等值永假；追加不可逆使等式在 P3 场景必败。实测否决，不实施。
- **D1-lite diagnostics 见证（journalEpoch gate）**：数据源存在，但"行已在页里"（turnId presence）严格强于"journal 已推进"（epoch 见证）；作为未来增强记录，不在本决策实施。
- **内容哈希比对**（live 文本 vs 页文本）：内容不得参与身份判定（既有原则）；且部分尾缺失/分页边界使内容比对天然脆弱。

## Consequences

- 认证从"猜时序"变为"验身份"，同类竞态不再逐个打补丁：判不掉的情况全部 fail-open 退回现状 + 204 守卫兜底，最坏结果是"今天的系统"，不丢已画内容。
- 失败/中断轮次（无 assistant 输出）依赖源静止放行结束，至多多 1 次重读（有界，~100-300ms）。
- mock 路径（`KODAX_FORCE_MOCK`）无 runtime 证据，不走认证链，行为不变。

## 撤销/重审条件

- SDK 未来把页 revision、sourceRevision、live transcriptRevision 统一为同一哈希域 → 等式栅栏可重审（预期收益仅是少一次身份检查）。
- SDK 未来在 terminal run 投影中提供 `transcriptRevisionAtSettlement` 或在 `runtimeSessionEventOrigin` 中携带 turnId → 直连事件的 live 补齐路径可简化。
